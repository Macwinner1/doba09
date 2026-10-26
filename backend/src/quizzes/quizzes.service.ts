import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { QuizInput } from '@feyi/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Shape the game engine needs: questions in order, with the answer key. */
const gameQuizInclude = {
  questions: {
    orderBy: { order: 'asc' },
    include: { choices: { orderBy: { order: 'asc' } } },
  },
} as const;

@Injectable()
export class QuizzesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForOwner(ownerId: string) {
    return this.prisma.quiz.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        coverImage: true,
        visibility: true,
        updatedAt: true,
        _count: { select: { questions: true, sessions: true } },
      },
    });
  }

  async findOneForOwner(id: string, ownerId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: gameQuizInclude,
    });

    if (!quiz) throw new NotFoundException('Quiz not found');
    if (quiz.ownerId !== ownerId) throw new ForbiddenException('Not your quiz');

    return quiz;
  }

  /** Used by the game engine at launch — needs the answer key, skips ownership UI concerns. */
  async findForGame(id: string, hostId: string) {
    return this.findOneForOwner(id, hostId);
  }

  async create(ownerId: string, input: QuizInput) {
    return this.prisma.quiz.create({
      data: {
        ownerId,
        title: input.title,
        description: input.description ?? '',
        coverImage: input.coverImage ?? null,
        visibility: input.visibility,
        questions: {
          create: input.questions.map((q, qIndex) => ({
            order: qIndex,
            type: q.type,
            text: q.text,
            imageUrl: q.imageUrl ?? null,
            timeLimit: q.timeLimit,
            points: q.points,
            choices: {
              create: q.choices.map((c, cIndex) => ({
                order: cIndex,
                text: c.text,
                isCorrect: c.isCorrect,
              })),
            },
          })),
        },
      },
      include: gameQuizInclude,
    });
  }

  /**
   * Replaces the question set wholesale rather than diffing it.
   *
   * Reordering and deleting questions in a builder UI produces changes that are
   * genuinely painful to diff correctly, and a quiz is small. The cascade takes
   * the old choices with it, and the whole thing is one transaction so a failure
   * can't leave a quiz with no questions.
   */
  async update(id: string, ownerId: string, input: QuizInput) {
    await this.assertOwnership(id, ownerId);

    return this.prisma.$transaction(async (tx) => {
      await tx.question.deleteMany({ where: { quizId: id } });

      return tx.quiz.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description ?? '',
          coverImage: input.coverImage ?? null,
          visibility: input.visibility,
          questions: {
            create: input.questions.map((q, qIndex) => ({
              order: qIndex,
              type: q.type,
              text: q.text,
              imageUrl: q.imageUrl ?? null,
              timeLimit: q.timeLimit,
              points: q.points,
              choices: {
                create: q.choices.map((c, cIndex) => ({
                  order: cIndex,
                  text: c.text,
                  isCorrect: c.isCorrect,
                })),
              },
            })),
          },
        },
        include: gameQuizInclude,
      });
    });
  }

  async duplicate(id: string, ownerId: string) {
    const source = await this.findOneForOwner(id, ownerId);

    return this.prisma.quiz.create({
      data: {
        ownerId,
        title: `${source.title} (copy)`,
        description: source.description,
        coverImage: source.coverImage,
        visibility: 'PRIVATE',
        questions: {
          create: source.questions.map((q) => ({
            order: q.order,
            type: q.type,
            text: q.text,
            imageUrl: q.imageUrl,
            timeLimit: q.timeLimit,
            points: q.points,
            choices: {
              create: q.choices.map((c) => ({
                order: c.order,
                text: c.text,
                isCorrect: c.isCorrect,
              })),
            },
          })),
        },
      },
      include: gameQuizInclude,
    });
  }

  async remove(id: string, ownerId: string): Promise<void> {
    await this.assertOwnership(id, ownerId);
    await this.prisma.quiz.delete({ where: { id } });
  }

  private async assertOwnership(id: string, ownerId: string): Promise<void> {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!quiz) throw new NotFoundException('Quiz not found');
    if (quiz.ownerId !== ownerId) throw new ForbiddenException('Not your quiz');
  }
}
