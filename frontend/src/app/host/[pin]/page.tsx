'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { AnswerShape, SLOT_BG } from '@/components/answer-shapes';
import { Confetti } from '@/components/confetti';
import { Countdown } from '@/components/countdown';
import { JoinQr } from '@/components/join-qr';
import { PlayerAvatar } from '@/components/player-avatar';
import { SoundToggle } from '@/components/sound-toggle';
import { Button } from '@/components/ui/button';
import { useHostGame } from '@/hooks/use-host-game';
import { useCountUp } from '@/hooks/use-count-up';
import { playSound } from '@/lib/sound';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/game-store';

/**
 * The presenter screen — this is what goes on the projector.
 *
 * Everything here is sized to be read from the back of a room, and the phase
 * comes straight from the server so the big screen and every phone are always
 * describing the same moment.
 */
export default function HostPage() {
  const { pin } = useParams<{ pin: string }>();
  const host = useHostGame(pin);
  const state = useGameStore();

  if (host.fatal) {
    return (
      <Stage>
        <h1 className="font-display text-4xl font-extrabold text-white">{host.fatal}</h1>
        <Button variant="light" size="lg" className="mt-6" onClick={() => (window.location.href = '/dashboard')}>
          Back to my quizzes
        </Button>
      </Stage>
    );
  }

  switch (state.phase) {
    case 'LOBBY':
      return <Lobby pin={pin} onStart={host.start} onKick={host.kick} />;

    case 'QUESTION_INTRO':
      return (
        <Stage>
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-xl font-extrabold uppercase tracking-widest text-white/60"
          >
            Question {state.currentQuestionIndex + 1} of {state.questionCount}
          </motion.p>
          <motion.h1
            key={state.currentQuestionIndex}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 13 }}
            className="mt-6 text-center font-display text-6xl font-extrabold text-white drop-shadow-[0_5px_0_rgba(0,0,0,0.2)]"
          >
            Get ready…
          </motion.h1>
        </Stage>
      );

    case 'QUESTION_ACTIVE':
      return <LiveQuestion onSkip={host.skip} />;

    case 'QUESTION_RESULTS':
      return <QuestionResults onNext={host.next} />;

    case 'LEADERBOARD':
      return <Leaderboard onNext={host.next} />;

    case 'PODIUM':
      return <Podium onEnd={host.end} />;

    default:
      return (
        <Stage>
          <h1 className="font-display text-4xl font-extrabold text-white">Game over</h1>
          <Button variant="light" size="lg" className="mt-6" onClick={() => (window.location.href = '/dashboard')}>
            Back to my quizzes
          </Button>
        </Stage>
      );
  }
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <main className="feyi-bg relative flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <SoundToggle className="absolute right-4 top-4 z-30" />
      {children}
    </main>
  );
}

function Lobby({
  pin,
  onStart,
  onKick,
}: {
  pin: string;
  onStart: () => void;
  onKick: (id: string) => void;
}) {
  const players = useGameStore((s) => s.players);
  const quizTitle = useGameStore((s) => s.quizTitle);

  return (
    <main className="feyi-bg relative flex min-h-screen flex-col px-6 py-8">
      <SoundToggle className="absolute right-4 top-4 z-30" />

      {/* Two ways in, side by side: scan the code, or type the PIN. Neither is
          a fallback for the other — a phone with a dead camera and a laptop
          without one both need to work. */}
      <div className="flex flex-col items-center justify-center gap-8 sm:flex-row sm:items-start sm:gap-14">
        <div className="flex flex-col items-center">
          <p className="font-display text-lg font-extrabold uppercase tracking-widest text-white/60">
            Game PIN
          </p>
          <motion.p
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 16 }}
            className="feyi-sheen mt-2 font-display text-8xl font-extrabold tracking-[0.12em] text-white drop-shadow-[0_6px_0_rgba(0,0,0,0.25)] tabular-nums sm:text-9xl"
          >
            {pin}
          </motion.p>
          <p className="mt-3 text-xl font-bold text-white/75">{quizTitle}</p>
        </div>

        <JoinQr pin={pin} />
      </div>

      <div className="mt-10 flex-1">
        <motion.p
          key={players.length}
          initial={{ scale: 1.25 }}
          animate={{ scale: 1 }}
          className="mb-5 text-center font-display text-3xl font-extrabold text-white"
        >
          {players.length} {players.length === 1 ? 'player' : 'players'}
        </motion.p>

        <ul className="flex flex-wrap justify-center gap-3">
          <AnimatePresence mode="popLayout">
            {players.map((player) => (
              <motion.li
                key={player.id}
                layout
                initial={{ scale: 0.4, opacity: 0, y: 12 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 340, damping: 22 }}
              >
                <button
                  onClick={() => onKick(player.id)}
                  title="Remove this player"
                  className={cn(
                    'group flex items-center gap-2 rounded-2xl bg-white/95 py-2 pl-2 pr-4 font-display text-lg font-extrabold text-feyi-purple shadow-chunk transition hover:bg-feyi-red hover:text-white',
                    !player.connected && 'opacity-50',
                  )}
                >
                  <PlayerAvatar nickname={player.nickname} size={30} />
                  {player.nickname}
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <Button
        size="xl"
        variant="light"
        onClick={onStart}
        disabled={players.length === 0}
        className="mx-auto mt-8"
      >
        Start
      </Button>
    </main>
  );
}

function LiveQuestion({ onSkip }: { onSkip: () => void }) {
  const { question, questionEndsAt, clockOffset, answerCount } = useGameStore();

  // A tick that speeds up as the clock runs out. The interval is rebuilt each
  // second so the cadence can change with the remaining time.
  useEffect(() => {
    if (questionEndsAt === null) return;

    const id = setInterval(() => {
      const remaining = questionEndsAt + clockOffset - Date.now();
      if (remaining <= 0) return;
      playSound(remaining <= 5_000 ? 'tickUrgent' : 'tick');
    }, 1_000);

    return () => clearInterval(id);
  }, [questionEndsAt, clockOffset]);

  if (!question) return null;

  return (
    <main className="flex min-h-screen flex-col bg-feyi-ink px-6 py-6">
      <SoundToggle className="absolute right-4 top-4 z-30" />

      <p className="text-center font-display text-lg font-extrabold uppercase tracking-widest text-white/50">
        Question {question.index + 1} of {question.total}
      </p>

      <motion.h1
        key={question.id}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="mx-auto mt-4 max-w-5xl text-center font-display text-5xl font-extrabold text-white"
      >
        {question.text}
      </motion.h1>

      <div className="mt-8 flex items-center justify-between">
        {questionEndsAt !== null && (
          <Countdown endsAt={questionEndsAt} clockOffset={clockOffset} totalSeconds={question.timeLimit} />
        )}

        <div className="text-center">
          <motion.p
            key={answerCount.answered}
            initial={{ scale: 1.4 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            className="font-display text-6xl font-extrabold text-white tabular-nums"
          >
            {answerCount.answered}
          </motion.p>
          <p className="text-sm font-bold uppercase tracking-widest text-white/50">answers in</p>
        </div>

        <Button variant="ghost" onClick={onSkip}>
          Skip
        </Button>
      </div>

      <div className="mt-8 grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
        {question.choices.map((choice, i) => (
          <motion.div
            key={choice.index}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.07, type: 'spring', stiffness: 280, damping: 22 }}
            className={cn(
              'flex items-center gap-4 rounded-chunk px-6 py-6 text-white shadow-chunk',
              SLOT_BG[choice.index] ?? 'bg-slate-600',
            )}
          >
            <span className="h-10 w-10 shrink-0 drop-shadow">
              <AnswerShape index={choice.index} />
            </span>
            <span className="font-display text-3xl font-extrabold">{choice.text}</span>
          </motion.div>
        ))}
      </div>
    </main>
  );
}

function QuestionResults({ onNext }: { onNext: () => void }) {
  const { question, distribution, correctChoiceIndex } = useGameStore();

  useEffect(() => playSound('correct'), []);

  if (!question) return null;

  const maxCount = Math.max(1, ...distribution.map((d) => d.count));

  return (
    <main className="flex min-h-screen flex-col bg-feyi-ink px-6 py-6">
      <SoundToggle className="absolute right-4 top-4 z-30" />

      <h1 className="mx-auto max-w-5xl text-center font-display text-4xl font-extrabold text-white">
        {question.text}
      </h1>

      {/* Bars are keyed to the same colours and shapes as the answer buttons, so
          the room can read the result without re-reading the options. */}
      <div className="mx-auto mt-10 flex w-full max-w-4xl flex-1 items-end justify-center gap-6">
        {distribution.map((entry) => (
          <div key={entry.choiceIndex} className="flex flex-1 flex-col items-center justify-end">
            <span className="mb-2 font-display text-3xl font-extrabold text-white tabular-nums">
              {entry.count}
            </span>

            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(8, (entry.count / maxCount) * 100)}%` }}
              transition={{ type: 'spring', stiffness: 90, damping: 18, delay: 0.15 }}
              className={cn(
                'w-full rounded-t-2xl',
                SLOT_BG[entry.choiceIndex] ?? 'bg-slate-600',
                entry.choiceIndex !== correctChoiceIndex && 'opacity-35',
              )}
            />

            <div className="mt-3 flex items-center gap-2 text-white">
              <span className="h-6 w-6">
                <AnswerShape index={entry.choiceIndex} />
              </span>
              <span className="font-bold">
                {question.choices[entry.choiceIndex]?.text}
                {entry.choiceIndex === correctChoiceIndex && ' ✓'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <Button size="lg" variant="light" onClick={onNext} className="mx-auto mt-8">
        Next
      </Button>
    </main>
  );
}

function Leaderboard({ onNext }: { onNext: () => void }) {
  const leaderboard = useGameStore((s) => s.leaderboard);

  useEffect(() => playSound('whoosh'), []);

  return (
    <Stage>
      <h1 className="font-display text-5xl font-extrabold text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.2)]">
        Scoreboard
      </h1>

      {/*
       * The `layout` prop is doing the important work here. When the server
       * sends a new ordering, framer-motion measures each row's old and new
       * position and animates the difference — so players visibly overtake one
       * another instead of the list blinking into a new order. This is the
       * moment the room reacts to, and it is worth the extra machinery.
       */}
      <ol className="mt-10 w-full max-w-2xl space-y-3">
        {leaderboard.map((entry) => (
          <motion.li
            key={entry.playerId}
            layout
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ layout: { type: 'spring', stiffness: 260, damping: 26 } }}
            className="flex items-center gap-4 rounded-chunk bg-white px-6 py-4 shadow-chunk"
          >
            <span className="w-8 text-center font-display text-2xl font-extrabold text-slate-400 tabular-nums">
              {entry.rank}
            </span>
            <PlayerAvatar nickname={entry.nickname} size={44} />
            <span className="flex-1 truncate font-display text-2xl font-extrabold text-slate-900">
              {entry.nickname}
            </span>

            {entry.streak > 1 && (
              <span className="rounded-full bg-orange-100 px-2 py-1 text-sm font-extrabold text-orange-600">
                🔥 {entry.streak}
              </span>
            )}
            {entry.gained > 0 && (
              <motion.span
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="font-bold text-feyi-green"
              >
                +{entry.gained}
              </motion.span>
            )}

            <LeaderboardScore score={entry.score} />
          </motion.li>
        ))}
      </ol>

      <Button size="lg" variant="light" onClick={onNext} className="mt-10">
        Next
      </Button>
    </Stage>
  );
}

function LeaderboardScore({ score }: { score: number }) {
  const value = useCountUp(score);
  return (
    <span className="w-24 text-right font-display text-2xl font-extrabold text-slate-900 tabular-nums">
      {value}
    </span>
  );
}

function Podium({ onEnd }: { onEnd: () => void }) {
  const podium = useGameStore((s) => s.podium);

  useEffect(() => playSound('fanfare'), []);

  // Second, first, third — the classic arrangement, tallest in the middle.
  const order = [podium[1], podium[0], podium[2]];
  const heights = ['h-44', 'h-60', 'h-32'];
  const medals = ['🥈', '🥇', '🥉'];
  // Build up to the winner: third rises first, the champion last.
  const delays = [0.35, 0.75, 0];

  return (
    <Stage>
      <Confetti />

      <h1 className="font-display text-5xl font-extrabold text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.2)]">
        Final results
      </h1>

      <div className="mt-12 flex items-end gap-4">
        {order.map((entry, i) =>
          entry ? (
            <motion.div
              key={entry.playerId}
              initial={{ y: 220, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: delays[i], type: 'spring', stiffness: 120, damping: 16 }}
              className="flex flex-col items-center"
            >
              <span className="mb-2 text-4xl" aria-hidden="true">
                {medals[i]}
              </span>
              <PlayerAvatar nickname={entry.nickname} size={56} className="mb-2" />
              <span className="mb-1 font-display text-2xl font-extrabold text-white">
                {entry.nickname}
              </span>
              <span className="mb-2 font-bold text-white/70 tabular-nums">{entry.score}</span>
              <div
                className={cn(
                  'flex w-28 items-start justify-center rounded-t-chunk bg-white pt-4 font-display text-4xl font-extrabold text-feyi-purple shadow-lift sm:w-36',
                  heights[i],
                )}
              >
                {entry.rank}
              </div>
            </motion.div>
          ) : (
            <div key={i} className="w-28 sm:w-36" />
          ),
        )}
      </div>

      <Button size="lg" variant="light" onClick={onEnd} className="mt-12">
        Finish
      </Button>
    </Stage>
  );
}
