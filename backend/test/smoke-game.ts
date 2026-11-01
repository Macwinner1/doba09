/**
 * End-to-end smoke test: drives a complete game against a running server the
 * way real clients would — over HTTP for auth and Socket.IO for the game.
 *
 * Run with the server up:  pnpm --filter @feyi/backend smoke
 *
 * This deliberately does not import any server code. It exercises the wire
 * contract, so a broken payload shape or a missing broadcast fails it.
 */
import { GAME_EVENTS } from '@feyi/shared';
import { io, type Socket } from 'socket.io-client';

const API = process.env.SMOKE_API ?? 'http://localhost:4000';
const WS = `${API}/game`;

const DEMO_EMAIL = 'demo@feyi.local';
const DEMO_PASSWORD = 'Demo1234';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function waitFor<T>(socket: Socket, event: string, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emit<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No ack for "${event}"`)),
      10_000,
    );
    const handler = (ack: { ok: boolean; data?: T; error?: string }) => {
      clearTimeout(timer);
      ack.ok ? resolve(ack.data as T) : reject(new Error(`${event}: ${ack.error}`));
    };
    payload === undefined
      ? socket.emit(event, handler)
      : socket.emit(event, payload, handler);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('\n=== Feyi end-to-end game smoke test ===\n');

  // --- 1. host signs in over REST ----------------------------------------
  console.log('1. Host authentication');
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  check('login returns 200', loginRes.status === 200, `got ${loginRes.status}`);

  const cookies = loginRes.headers.getSetCookie();
  check(
    'access_token is httpOnly',
    cookies.some((c) => c.startsWith('access_token=') && /HttpOnly/i.test(c)),
  );

  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

  const mintTicket = async (): Promise<string> => {
    const res = await fetch(`${API}/api/auth/socket-ticket`, {
      method: 'POST',
      headers: { cookie: cookieHeader },
    });
    return ((await res.json()) as { ticket: string }).ticket;
  };

  const anonTicket = await fetch(`${API}/api/auth/socket-ticket`, { method: 'POST' });
  check('socket ticket requires authentication', anonTicket.status === 401, `got ${anonTicket.status}`);

  // --- 2. fetch a quiz ----------------------------------------------------
  console.log('\n2. Quiz library');
  const quizzesRes = await fetch(`${API}/api/quizzes`, {
    headers: { cookie: cookieHeader },
  });
  const quizzes = (await quizzesRes.json()) as { id: string; title: string }[];
  check('quiz list returns the seeded quiz', quizzes.length > 0);
  const quizId = quizzes[0]!.id;

  const unauthed = await fetch(`${API}/api/quizzes`);
  check('quiz list rejects anonymous callers', unauthed.status === 401, `got ${unauthed.status}`);

  // --- 3. host opens a game ----------------------------------------------
  console.log('\n3. Host creates a game');
  const host = io(WS, { transports: ['websocket'] });
  await waitFor(host, 'connect');

  const noTicket = await emit(host, GAME_EVENTS.HOST_CREATE_GAME, { quizId }).catch(
    (e: Error) => e.message,
  );
  check('hosting without a ticket is refused', String(noTicket).includes('signed in'), String(noTicket));

  const forged = await emit(host, GAME_EVENTS.HOST_CREATE_GAME, {
    quizId,
    ticket: 'not-a-real-ticket',
  }).catch((e: Error) => e.message);
  check('forged ticket is refused', String(forged).includes('expired'), String(forged));

  const ticket = await mintTicket();
  const game = await emit<{ pin: string; questionCount: number; quizTitle: string }>(
    host,
    GAME_EVENTS.HOST_CREATE_GAME,
    { quizId, ticket },
  );
  check('game PIN is 6 digits', /^\d{6}$/.test(game.pin), game.pin);
  check('question count carried through', game.questionCount === 5, String(game.questionCount));

  // The whole point of a single-use ticket: redeeming it destroys it, so a
  // ticket captured from a log or history is worthless.
  const replayed = await emit(host, GAME_EVENTS.HOST_CREATE_GAME, { quizId, ticket }).catch(
    (e: Error) => e.message,
  );
  check('a redeemed ticket cannot be replayed', String(replayed).includes('expired'), String(replayed));

  // --- 4. players join ----------------------------------------------------
  console.log('\n4. Players join the lobby');
  const nicknames = ['Ada', 'Bem', 'Chi'];
  const players: { name: string; socket: Socket; playerId: string }[] = [];

  for (const nickname of nicknames) {
    const socket = io(WS, { transports: ['websocket'] });
    await waitFor(socket, 'connect');
    const joined = await emit<{ playerId: string; rejoinToken: string }>(
      socket,
      GAME_EVENTS.PLAYER_JOIN,
      { pin: game.pin, nickname },
    );
    players.push({ name: nickname, socket, playerId: joined.playerId });
  }
  check('all three players joined', players.length === 3);

  // Duplicate nickname must be refused — two "Ada"s make the leaderboard a lie.
  const dupSocket = io(WS, { transports: ['websocket'] });
  await waitFor(dupSocket, 'connect');
  const dupError = await emit(dupSocket, GAME_EVENTS.PLAYER_JOIN, {
    pin: game.pin,
    nickname: 'Ada',
  }).catch((e: Error) => e.message);
  check('duplicate nickname rejected', String(dupError).includes('already took that name'), String(dupError));

  const badPin = await emit(dupSocket, GAME_EVENTS.PLAYER_JOIN, {
    pin: '000001',
    nickname: 'Ghost',
  }).catch((e: Error) => e.message);
  check('unknown PIN rejected', String(badPin).includes('No game with that PIN'), String(badPin));
  dupSocket.disconnect();

  // --- 5. play every question --------------------------------------------
  console.log('\n5. Playing through the quiz');

  const podiumPromise = waitFor<{
    podium: { nickname: string; score: number; rank: number }[];
    standings: { nickname: string; score: number; rank: number }[];
  }>(
    host,
    GAME_EVENTS.GAME_PODIUM,
    120_000,
  );

  let leakDetected = false;
  players.forEach((p) => {
    p.socket.on(GAME_EVENTS.QUESTION_START, (payload: { question: { choices: unknown[] } }) => {
      // The answer key must never reach a player socket.
      const serialized = JSON.stringify(payload.question);
      if (serialized.includes('isCorrect') || serialized.includes('correctChoiceIndex')) {
        leakDetected = true;
      }
    });
  });

  // The seeded quiz's correct answers, in order.
  const correctAnswers = [0, 1, 0, 3, 1];

  for (let q = 0; q < game.questionCount; q++) {
    // Waiters are registered before the game is told to advance, so the
    // question:start broadcast cannot land before anyone is listening.
    const starts = players.map((p) =>
      waitFor<{ question: { id: string; index: number } }>(p.socket, GAME_EVENTS.QUESTION_START, 30_000),
    );
    if (q === 0) await emit(host, GAME_EVENTS.HOST_START);

    const started = await Promise.all(starts);
    const questionId = started[0]!.question.id;
    check(`Q${q + 1} broadcast to every player`, started.every((s) => s.question.index === q));

    const results = players.map((p) =>
      waitFor<{ yourResult: { isCorrect: boolean; pointsAwarded: number; rank: number } }>(
        p.socket,
        GAME_EVENTS.QUESTION_END,
        30_000,
      ),
    );

    // Ada answers correctly and fast, Bem correctly but slow, Chi always wrong.
    // That ordering is what the final standings are asserted against.
    await sleep(150);
    await emit(players[0]!.socket, GAME_EVENTS.PLAYER_ANSWER, {
      questionId,
      choiceIndex: correctAnswers[q]!,
      clientElapsedMs: 150,
    });

    await sleep(1_500);
    await emit(players[1]!.socket, GAME_EVENTS.PLAYER_ANSWER, {
      questionId,
      choiceIndex: correctAnswers[q]!,
      clientElapsedMs: 1_650,
    });

    // A second answer from the same player must be refused.
    const double = await emit(players[0]!.socket, GAME_EVENTS.PLAYER_ANSWER, {
      questionId,
      choiceIndex: 1,
      clientElapsedMs: 1_700,
    }).catch((e: Error) => e.message);
    if (q === 0) {
      check('second answer from same player rejected', String(double).includes('already answered'), String(double));
    }

    await emit(players[2]!.socket, GAME_EVENTS.PLAYER_ANSWER, {
      questionId,
      choiceIndex: (correctAnswers[q]! + 1) % 2,
      clientElapsedMs: 1_800,
    });

    const ended = await Promise.all(results);
    if (q === 0) {
      check('fast correct answer scores', ended[0]!.yourResult.pointsAwarded > 0);
      check(
        'faster correct beats slower correct',
        ended[0]!.yourResult.pointsAwarded > ended[1]!.yourResult.pointsAwarded,
        `${ended[0]!.yourResult.pointsAwarded} vs ${ended[1]!.yourResult.pointsAwarded}`,
      );
      check('wrong answer scores zero', ended[2]!.yourResult.pointsAwarded === 0);
    }

    // results -> leaderboard -> next question
    await emit(host, GAME_EVENTS.HOST_NEXT);
    await sleep(200);
    await emit(host, GAME_EVENTS.HOST_NEXT);
  }

  // --- 6. podium ----------------------------------------------------------
  console.log('\n6. Podium and persistence');
  const podium = await podiumPromise;
  check('podium has three entries', podium.podium.length === 3, String(podium.podium.length));
  check('fastest correct player wins', podium.podium[0]?.nickname === 'Ada', podium.podium[0]?.nickname);
  check('always-wrong player is last', podium.podium[2]?.nickname === 'Chi', podium.podium[2]?.nickname);
  check('last place scored nothing', podium.podium[2]?.score === 0, String(podium.podium[2]?.score));
  check(
    'final standings list every player',
    podium.standings?.length === nicknames.length,
    String(podium.standings?.length),
  );
  check('answer key never reached a player socket', !leakDetected);

  await sleep(1_000);
  const reportsRes = await fetch(`${API}/api/reports`, { headers: { cookie: cookieHeader } });
  const reports = (await reportsRes.json()) as { id: string; playerCount: number }[];
  check('finished game was persisted to Postgres', reports.length > 0);

  if (reports.length > 0) {
    const detailRes = await fetch(`${API}/api/reports/${reports[0]!.id}`, {
      headers: { cookie: cookieHeader },
    });
    const detail = (await detailRes.json()) as {
      standings: { nickname: string; rank: number }[];
      questions: { accuracy: number | null }[];
    };
    check('report records all three players', detail.standings.length === 3);
    check('report has per-question accuracy', detail.questions.length === 5);
    check(
      'accuracy reflects 2 of 3 correct',
      detail.questions.every((q) => q.accuracy !== null && Math.abs(q.accuracy - 2 / 3) < 0.01),
    );
  }

  await emit(host, GAME_EVENTS.HOST_END).catch(() => undefined);
  [host, ...players.map((p) => p.socket)].forEach((s) => s.disconnect());

  console.log(
    failures === 0
      ? '\n=== ALL CHECKS PASSED ===\n'
      : `\n=== ${failures} CHECK(S) FAILED ===\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
