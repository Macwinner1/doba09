import { Injectable } from '@nestjs/common';
import { rankPlayers } from '@feyi/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  GameMeta,
  GameQuizSnapshot,
  StoredAnswer,
  StoredPlayer,
} from './game.types';

interface PersistInput {
  meta: GameMeta;
  quiz: GameQuizSnapshot;
  players: StoredPlayer[];
  /** Indexed by question order; each entry is that question's answers. */
  answersByQuestion: StoredAnswer[][];
}

/**
 * The single point where a finished game crosses from Redis into Postgres.
 *
 * Doing this once, at the end, is what keeps the hot path free of database
 * writes — a 200-player game writes nothing to Postgres until the podium.
 */
@Injectable()
export class GameResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async persist({ meta, quiz, players, answersByQuestion }: PersistInput): Promise<string> {
    const ranked = rankPlayers(players);

    // Choice ids are stored per question; we need index -> id to turn a stored
    // answer back into a real foreign key.
    const choiceIdByQuestionAndIndex = new Map<string, string>();
    quiz.questions.forEach((q) => {
      q.choices.forEach((c) => {
        choiceIdByQuestionAndIndex.set(`${q.id}:${c.index}`, c.id);
      });
    });

    const answerByPlayerAndQuestion = new Map<string, StoredAnswer>();
    answersByQuestion.forEach((answers, questionIndex) => {
      const question = quiz.questions[questionIndex];
      if (!question) return;
      answers.forEach((a) => {
        answerByPlayerAndQuestion.set(`${a.playerId}:${question.id}`, a);
      });
    });

    // One transaction: a half-written report is worse than none, because it
    // reads as a real result.
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.gameSession.create({
        data: {
          quizId: meta.quizId,
          hostId: meta.hostId,
          pin: meta.pin,
          quizTitle: meta.quizTitle,
          startedAt: new Date(meta.startedAt),
          endedAt: new Date(),
          playerCount: players.length,
          questionCount: quiz.questions.length,
        },
      });

      for (const player of ranked) {
        const answers = quiz.questions
          .map((q) => {
            const answer = answerByPlayerAndQuestion.get(`${player.id}:${q.id}`);
            if (!answer) return null;
            return {
              questionId: q.id,
              choiceId: choiceIdByQuestionAndIndex.get(`${q.id}:${answer.choiceIndex}`) ?? null,
              responseMs: answer.responseMs,
              isCorrect: answer.isCorrect,
              pointsAwarded: answer.pointsAwarded,
            };
          })
          .filter((a): a is NonNullable<typeof a> => a !== null);

        await tx.gamePlayer.create({
          data: {
            sessionId: created.id,
            nickname: player.nickname,
            finalScore: player.score,
            rank: player.rank,
            correctCount: player.correctCount,
            longestStreak: player.longestStreak,
            answers: { create: answers },
          },
        });
      }

      return created;
    });

    return session.id;
  }

  async listSessionsForHost(hostId: string) {
    return this.prisma.gameSession.findMany({
      where: { hostId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        quizTitle: true,
        pin: true,
        startedAt: true,
        endedAt: true,
        playerCount: true,
        questionCount: true,
      },
    });
  }

  /** Per-question accuracy plus the final standings, for the host's report view. */
  async getSessionReport(sessionId: string, hostId: string) {
    const session = await this.prisma.gameSession.findFirst({
      where: { id: sessionId, hostId },
      include: {
        players: {
          orderBy: { rank: 'asc' },
          include: { answers: true },
        },
      },
    });

    if (!session) return null;

    const questions = await this.prisma.question.findMany({
      where: { quizId: session.quizId },
      orderBy: { order: 'asc' },
      include: { choices: { orderBy: { order: 'asc' } } },
    });

    const allAnswers = session.players.flatMap((p) => p.answers);

    return {
      session: {
        id: session.id,
        quizTitle: session.quizTitle,
        pin: session.pin,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        playerCount: session.playerCount,
        questionCount: session.questionCount,
      },
      standings: session.players.map((p) => ({
        rank: p.rank,
        nickname: p.nickname,
        score: p.finalScore,
        correctCount: p.correctCount,
        longestStreak: p.longestStreak,
      })),
      questions: questions.map((q) => {
        const answers = allAnswers.filter((a) => a.questionId === q.id);
        const correct = answers.filter((a) => a.isCorrect).length;
        return {
          id: q.id,
          order: q.order,
          text: q.text,
          answered: answers.length,
          correct,
          // Reported against players who answered, not everyone present — a
          // question nobody reached shouldn't read as 0% understood.
          accuracy: answers.length > 0 ? correct / answers.length : null,
          averageResponseMs:
            answers.length > 0
              ? Math.round(
                  answers.reduce((sum, a) => sum + (a.responseMs ?? 0), 0) / answers.length,
                )
              : null,
        };
      }),
    };
  }
}
