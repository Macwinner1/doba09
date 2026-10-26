'use client';

import { NICKNAME_MAX_LENGTH, nicknameSchema } from '@feyi/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnswerShape, SLOT_BG, slotName } from '@/components/answer-shapes';
import { Confetti } from '@/components/confetti';
import { Countdown } from '@/components/countdown';
import { PlayerAvatar } from '@/components/player-avatar';
import { SoundToggle } from '@/components/sound-toggle';
import { Button } from '@/components/ui/button';
import { usePlayerGame } from '@/hooks/use-player-game';
import { useCountUp } from '@/hooks/use-count-up';
import { playSound } from '@/lib/sound';
import { cn, storage } from '@/lib/utils';
import { useGameStore } from '@/store/game-store';

/**
 * The player's whole game, on their phone.
 *
 * Note what is deliberately absent once a question is live: the question text
 * and the answer text. Players read those off the shared screen — that is the
 * mechanic that makes the room look up together instead of down at phones.
 */
export default function PlayPage() {
  const params = useParams<{ pin: string }>();
  const pin = params.pin;

  const { join, answer } = usePlayerGame(pin);
  const state = useGameStore();
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joined, setJoined] = useState(() => Boolean(storage.loadPlayer(pin)));

  async function submitNickname(e: React.FormEvent) {
    e.preventDefault();
    const parsed = nicknameSchema.safeParse(nickname);
    if (!parsed.success) {
      setJoinError(parsed.error.issues[0]?.message ?? 'Pick another name');
      return;
    }

    setJoining(true);
    setJoinError(null);
    try {
      await join(parsed.data);
      playSound('join');
      setJoined(true);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join');
    } finally {
      setJoining(false);
    }
  }

  if (!joined) {
    return (
      <Shell>
        {/* CSS entrance, same reasoning as the join screen: a scanned QR lands
            a player here, and the nickname box must be on screen even if the
            JS bundle is still crawling in over mobile data. */}
        <form
          onSubmit={submitNickname}
          className="feyi-pop w-full max-w-sm rounded-chunk bg-white p-6 shadow-lift"
        >
          <p className="mb-4 text-center text-sm font-bold uppercase tracking-widest text-slate-400">
            Game PIN {pin}
          </p>

          {/* Live preview of the avatar they'll be spotted by on the big screen. */}
          <div className="mb-4 flex justify-center">
            <motion.div key={nickname.trim() || 'blank'} initial={{ scale: 0.8 }} animate={{ scale: 1 }}>
              <PlayerAvatar nickname={nickname.trim() || '?'} size={72} />
            </motion.div>
          </div>

          <label htmlFor="nickname" className="sr-only">
            Your nickname
          </label>
          <input
            id="nickname"
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value.slice(0, NICKNAME_MAX_LENGTH));
              setJoinError(null);
            }}
            placeholder="Nickname"
            autoFocus
            autoComplete="off"
            aria-invalid={Boolean(joinError)}
            className="w-full rounded-2xl border-4 border-slate-200 bg-slate-50 px-4 py-4 text-center font-display text-2xl font-extrabold outline-none transition focus:border-feyi-purple focus:bg-white"
          />

          {joinError && (
            <motion.p
              animate={{ x: [6, -5, 4, -2, 0] }}
              transition={{ duration: 0.35 }}
              role="alert"
              className="mt-3 text-center text-sm font-bold text-feyi-red"
            >
              {joinError}
            </motion.p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={joining || nickname.trim().length < 2}
            className="mt-4 w-full"
          >
            {joining ? 'Joining…' : "OK, let's go!"}
          </Button>
        </form>
      </Shell>
    );
  }

  switch (state.phase) {
    case 'LOBBY':
      return (
        <Shell>
          {state.me && (
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16 }}
              className="feyi-bob mb-6"
            >
              <PlayerAvatar nickname={state.me.nickname} size={96} />
            </motion.div>
          )}
          <Banner>You&apos;re in!</Banner>
          {state.me && (
            <p className="mt-4 rounded-full bg-white px-6 py-2 font-display text-xl font-extrabold text-feyi-purple">
              {state.me.nickname}
            </p>
          )}
          <p className="mt-6 text-center text-lg text-white/75">
            See your name on the screen? Sit tight — the host starts it.
          </p>
        </Shell>
      );

    case 'QUESTION_INTRO':
      return (
        <Shell>
          <motion.div
            key={state.currentQuestionIndex}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 14 }}
          >
            <Banner>Question {state.currentQuestionIndex + 1}</Banner>
          </motion.div>
          <p className="mt-4 text-center text-lg text-white/75">Get ready…</p>
        </Shell>
      );

    case 'QUESTION_ACTIVE':
      return <AnswerPad onAnswer={answer} />;

    case 'QUESTION_RESULTS':
      return <ResultScreen />;

    case 'LEADERBOARD':
      return <PlayerLeaderboard />;

    case 'PODIUM':
      return <PlayerPodium />;

    default:
      return (
        <Shell>
          <Banner>That&apos;s a wrap</Banner>
          {state.error && <p className="mt-4 text-center text-white/75">{state.error}</p>}
          <Button
            variant="light"
            size="lg"
            className="mt-8"
            onClick={() => {
              window.location.href = '/';
            }}
          >
            Join another game
          </Button>
        </Shell>
      );
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  const connected = useGameStore((s) => s.connected);
  return (
    <main className="feyi-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <SoundToggle className="absolute right-4 top-4 z-30" />

      <AnimatePresence>
        {!connected && (
          <motion.div
            initial={{ y: -40 }}
            animate={{ y: 0 }}
            exit={{ y: -40 }}
            role="status"
            className="fixed inset-x-0 top-0 z-40 bg-feyi-yellow py-2 text-center text-sm font-extrabold text-black"
          >
            Reconnecting… your score is safe
          </motion.div>
        )}
      </AnimatePresence>

      {children}
    </main>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-center font-display text-5xl font-extrabold text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.2)] sm:text-6xl">
      {children}
    </h1>
  );
}

/**
 * The answer pad. Four full-bleed buttons, thumb-sized, no text — the whole
 * screen is the target because players are looking up, not down.
 */
function AnswerPad({ onAnswer }: { onAnswer: (index: number) => void }) {
  const { question, questionEndsAt, clockOffset, answeredChoice } = useGameStore();
  if (!question) return null;

  if (answeredChoice !== null) {
    return (
      <Shell>
        <motion.div
          initial={{ scale: 0.5, rotate: -8, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 14 }}
          className={cn(
            'mb-6 flex h-28 w-28 items-center justify-center rounded-chunk text-white shadow-lift',
            SLOT_BG[answeredChoice] ?? 'bg-slate-600',
          )}
        >
          <span className="h-14 w-14">
            <AnswerShape index={answeredChoice} />
          </span>
        </motion.div>

        <Banner>Locked in</Banner>
        <p className="mt-4 text-center text-lg text-white/75">
          You picked {slotName(answeredChoice)}. Eyes on the screen.
        </p>
      </Shell>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-feyi-ink">
      <header className="flex items-center justify-between px-4 py-3 text-white">
        <span className="font-display text-sm font-extrabold uppercase tracking-widest text-white/60">
          Q{question.index + 1} / {question.total}
        </span>
        {questionEndsAt !== null && (
          <Countdown
            endsAt={questionEndsAt}
            clockOffset={clockOffset}
            totalSeconds={question.timeLimit}
          />
        )}
      </header>

      <div className="grid flex-1 grid-cols-2 gap-3 p-3">
        {question.choices.map((choice, i) => (
          <motion.button
            key={choice.index}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 20 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => {
              playSound('lock');
              onAnswer(choice.index);
            }}
            aria-label={`Answer ${slotName(choice.index)}`}
            className={cn(
              'flex items-center justify-center rounded-chunk text-white shadow-chunk',
              'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70',
              SLOT_BG[choice.index] ?? 'bg-slate-600',
            )}
          >
            <span className="h-16 w-16 drop-shadow-lg">
              <AnswerShape index={choice.index} />
            </span>
          </motion.button>
        ))}
      </div>
    </main>
  );
}

function ResultScreen() {
  const result = useGameStore((s) => s.myResult);
  const total = useCountUp(result?.totalScore ?? 0);

  // Fires once per result, on the transition into this screen.
  useEffect(() => {
    if (!result) return;
    playSound(result.isCorrect ? 'correct' : 'wrong');
  }, [result]);

  if (!result) {
    return (
      <Shell>
        <Banner>Time&apos;s up</Banner>
      </Shell>
    );
  }

  if (!result.answered) {
    return (
      <Shell>
        <Banner>Too slow!</Banner>
        <p className="mt-4 text-center text-white/75">No answer this round.</p>
        <p className="mt-6 text-center font-display text-4xl font-extrabold text-white tabular-nums">
          {total}
        </p>
      </Shell>
    );
  }

  return (
    <main
      className={cn(
        'relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10',
        result.isCorrect ? 'bg-feyi-green' : 'bg-feyi-red',
      )}
    >
      <SoundToggle className="absolute right-4 top-4 z-30" />

      <motion.div
        initial={{ scale: 0.4, rotate: result.isCorrect ? -12 : 0, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 13 }}
        className="mb-4 text-7xl"
        aria-hidden="true"
      >
        {result.isCorrect ? '🎉' : '💔'}
      </motion.div>

      <h1 className="text-center font-display text-5xl font-extrabold text-white drop-shadow-[0_4px_0_rgba(0,0,0,0.2)]">
        {result.isCorrect ? 'Correct!' : 'Incorrect'}
      </h1>

      {/* The points float up and away — the reward reads as something earned
          and banked, rather than a number that was simply always there. */}
      <AnimatePresence>
        {result.pointsAwarded > 0 && (
          <motion.p
            initial={{ y: 20, opacity: 0, scale: 0.7 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 300, damping: 18 }}
            className="mt-4 rounded-full bg-black/25 px-6 py-2 font-display text-2xl font-extrabold text-white tabular-nums"
          >
            +{result.pointsAwarded}
          </motion.p>
        )}
      </AnimatePresence>

      {result.streak > 1 && (
        <motion.p
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 15 }}
          className="mt-3 text-lg font-extrabold text-white/90"
        >
          🔥 {result.streak} in a row
        </motion.p>
      )}

      <div className="mt-8 text-center text-white/90">
        <span className="block font-display text-5xl font-extrabold tabular-nums">{total}</span>
        <span className="text-sm font-bold uppercase tracking-widest">
          points · rank #{result.rank}
        </span>
      </div>

      {result.pointsBehindNext !== null && result.pointsBehindNext > 0 && (
        <p className="mt-4 text-sm font-bold text-white/75">
          {result.pointsBehindNext} points behind the player above
        </p>
      )}
    </main>
  );
}

function PlayerLeaderboard() {
  const { leaderboard, myLeaderboardEntry } = useGameStore();
  const score = useCountUp(myLeaderboardEntry?.score ?? 0);

  useEffect(() => playSound('whoosh'), []);

  return (
    <Shell>
      <Banner>{myLeaderboardEntry ? `#${myLeaderboardEntry.rank}` : 'Scores'}</Banner>
      <p className="mt-2 text-center font-display text-3xl font-extrabold text-white tabular-nums">
        {score}
      </p>

      <ol className="mt-8 w-full max-w-sm space-y-2">
        {leaderboard.map((entry) => {
          const isMe = entry.playerId === myLeaderboardEntry?.playerId;
          return (
            <motion.li
              key={entry.playerId}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className={cn(
                'flex items-center gap-3 rounded-2xl px-4 py-3 font-extrabold backdrop-blur',
                isMe ? 'bg-white text-feyi-purple' : 'bg-white/15 text-white',
              )}
            >
              <span className="w-6 text-center tabular-nums opacity-70">{entry.rank}</span>
              <PlayerAvatar nickname={entry.nickname} size={32} />
              <span className="flex-1 truncate">{entry.nickname}</span>
              <span className="tabular-nums">{entry.score}</span>
            </motion.li>
          );
        })}
      </ol>
    </Shell>
  );
}

function PlayerPodium() {
  const { myPodium } = useGameStore();
  const score = useCountUp(myPodium?.score ?? 0, 1200);

  useEffect(() => playSound('fanfare'), []);

  const won = myPodium?.rank === 1;

  return (
    <Shell>
      {won && <Confetti />}

      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 12 }}
        className="mb-4 text-7xl"
        aria-hidden="true"
      >
        {won ? '🏆' : myPodium && myPodium.rank <= 3 ? '🥳' : '👏'}
      </motion.div>

      <Banner>{myPodium ? podiumLabel(myPodium.rank) : 'Game over'}</Banner>

      <p className="mt-3 text-center font-display text-5xl font-extrabold text-white tabular-nums">
        {score}
      </p>
      <p className="mt-1 text-center text-sm font-bold uppercase tracking-widest text-white/60">
        final score
      </p>
    </Shell>
  );
}

function podiumLabel(rank: number): string {
  if (rank === 1) return 'You won!';
  if (rank === 2) return '2nd place';
  if (rank === 3) return '3rd place';
  return `#${rank}`;
}
