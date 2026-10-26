# Feyi

Live, game-based learning. A host builds a quiz, projects it on a shared screen,
and players join from their phones with a 6-digit PIN. Points are awarded for
being right *and* being fast.

---

## What's here

```
feyi/
├── frontend/   Next.js 15 · React 19 · Tailwind 4 · Zustand · socket.io-client
├── backend/    NestJS 11 · Socket.IO · Prisma · PostgreSQL · Redis
├── shared/     Socket event contract, Zod schemas, scoring — imported by both
└── docker-compose.yml
```

`shared/` is the reason frontend and backend can't drift: both sides type their
socket against the same event map, and both validate with the same Zod schemas.
Change a payload on one side and the other fails to compile.

---

## Running it

Requires Docker, pnpm, and **Node 22+** (see `.nvmrc`). With nvm:

```bash
nvm use     # or `nvm install` the first time
```

`engine-strict=true` is set, so a wrong Node version fails immediately with a
clear message rather than surfacing as a strange error deep inside Nest or Next.

```bash
pnpm setup     # install, build shared, start Postgres+Redis, migrate, seed
pnpm dev       # backend on :4000, frontend on :3000
```

Then open <http://localhost:3000>.

A demo host is seeded:

| | |
|---|---|
| Email | `demo@feyi.local` |
| Password | `Demo1234` |

**To play through a game:** sign in at `/login` and hit **Host** on the demo
quiz. The lobby shows a PIN *and* a QR code — players either scan the code,
which drops them straight on the nickname screen, or type the PIN at the home
page. Both work; neither is a fallback for the other, since a phone with a dead
camera and a laptop without one both have to get in.

### Playing on real phones

Present from your machine's **network address**, not `localhost` — a phone
cannot reach a laptop's loopback, and a QR code encoding `localhost` fails for
everyone in the room. The lobby says so on screen if you forget.

```bash
ip route get 1.1.1.1 | grep -oP 'src \K[\d.]+'   # find your LAN IP
```

Then browse to `http://<that-ip>:3000` and add the same origin to `CORS_ORIGIN`
in `backend/.env`:

```
CORS_ORIGIN=http://localhost:3000,http://192.168.1.5:3000
```

Nothing else needs configuring. `NEXT_PUBLIC_API_URL` is a loopback address, so
the browser keeps its port but follows the hostname the page came from — a phone
loading `192.168.1.5:3000` dials `192.168.1.5:4000` for its socket rather than
its own loopback. Override the QR's base with `NEXT_PUBLIC_APP_URL` if you need
it to point somewhere else entirely.

### Individual commands

```bash
pnpm infra:up      # Postgres :5433, Redis :6380
pnpm infra:reset   # wipe volumes and start fresh
pnpm db:migrate
pnpm db:seed
pnpm db:studio     # browse the database
pnpm build
pnpm typecheck
pnpm test          # unit tests (scoring)
pnpm --filter @feyi/backend smoke   # full game, end to end, against a running server
```

The infra ports are deliberately non-default (5433/6380) so the project never
collides with a Postgres or Redis you already run.

---

## How a game works

The server owns the state machine absolutely. Clients render the phase they're
told they're in and nothing else.

```
LOBBY → QUESTION_INTRO → QUESTION_ACTIVE → QUESTION_RESULTS → LEADERBOARD
          ↑                                                        │
          └────────────────────────────────────────────────────────┘
                                          (after last question) → PODIUM → ENDED
```

Live game state lives in **Redis**, not Postgres — a 200-player game writes
nothing to the database until the podium, at which point one transaction
persists the whole session for reporting.

### Scoring

```
points = round( (1 − (responseMs / timeLimitMs) / 2) × pointsPossible )
```

A correct answer is worth between 50% and 100% of face value depending on speed;
a wrong answer is worth nothing. Answers inside a 500ms grace window get full
marks. Streaks are tracked and displayed but award no bonus.

### Four things this design takes seriously

**Timing is server-authoritative.** The server stamps the moment an answer packet
lands and scores off its own clock. The client sends its own elapsed time too,
but it's stored for tamper analytics and never scored — trusting it would let
anyone claim a 10ms response.

**Latency is compensated, but capped.** The server measures each player's RTT
with its own ping handshake and credits back half of it, up to 500ms. Both
halves matter: measuring it server-side and capping it stop a player from faking
huge lag to buy thinking time.

**Reconnection is a non-event.** Players get a rejoin token; their score lives in
Redis, not browser memory. On reconnect the server replays a full `game:state`
snapshot and they land exactly where the game is. Phones lock and networks drop
constantly in a room of 40 people — the seat and score are held either way.

**The answer key never reaches a player socket.** Host and players are in separate
Socket.IO rooms. Questions are stripped to `{index, text}` per choice before
broadcast, and the correct index only goes to the host room until the reveal.
The smoke test asserts this.

---

## API

REST is for the creator side; everything live is on the socket.

| Method | Path | |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` · `/refresh` | httpOnly cookies |
| POST | `/api/auth/forgot-password` · `/reset-password` | always 204 — never reveals whether an address is registered |
| GET | `/api/auth/me` | |
| POST | `/api/auth/socket-ticket` | single-use credential for opening a host socket |
| GET/POST/PUT/DELETE | `/api/quizzes[/:id]` | |
| POST | `/api/quizzes/:id/duplicate` | |
| GET | `/api/reports[/:sessionId]` | per-question accuracy, standings — browsable at `/reports`, with CSV export generated client-side |
| GET | `/health` | checks Postgres *and* Redis |

Socket events live in [`shared/src/events.ts`](shared/src/events.ts).

### Host socket authentication

Auth uses httpOnly cookies, so page scripts can never read a token. But the
socket connects to a different origin than the page, so the cookie never rides
along with the handshake. Rather than hand the access token to JavaScript, the
host redeems a **ticket**:

1. `POST /api/auth/socket-ticket` (cookie-authenticated) returns 32 random bytes.
   The server stores only its SHA-256 hash in Redis, with a 60-second TTL.
2. The host sends it in the `host:create-game` payload.
3. The gateway redeems it with `GETDEL` — read and destroy in one atomic step.

Three properties fall out of that. It is **opaque, not a JWT**, so a ticket
captured from a proxy log or browser history is not a bearer credential anyone
can replay. It is **single-use**, so redemption invalidates it immediately, and
two tabs racing for the same ticket means exactly one wins. And it is the **only**
credential the gateway accepts — an access token will not open a host socket,
which keeps one narrow, revocable path into hosting.

The ticket travels in the event payload rather than the socket handshake because
a tab hosting a second game reuses its existing socket, whose handshake still
carries the first, already-redeemed ticket.

`CORS_ORIGIN` is enforced on the socket handshake as well as on REST — an origin
not on the list gets no `Access-Control-Allow-Origin` header and the browser
blocks it.

---

## Deploying

⚠️ **The backend cannot go on serverless.** WebSockets need a long-lived process.

| Piece | Where |
|---|---|
| Frontend | Vercel |
| Backend | Render / Railway / Fly.io — a persistent process |
| Postgres | Neon or Supabase |
| Redis | Upstash |

Set real secrets before shipping — the server refuses to boot in production if
`JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` still holds its dev placeholder:

```bash
openssl rand -base64 48
```

Pick the region closest to your players. In a speed-scored game, 100ms of RTT is
a competitive disadvantage, not just a UX nit — for West Africa, Fly.io's
Johannesburg region or EU-West both beat US-East.

The Socket.IO Redis adapter is wired up from the start, so running more than one
backend instance needs no code change.

---

## Commercial

- [docs/pricing.md](docs/pricing.md) — the plans, the prices, and how someone pays
- [docs/billing.md](docs/billing.md) — the technical design behind them

Neither is implemented. Both are written to be argued with.

---

## Known limitations

- **Question timers are in-process.** The instance holding the host's socket
  starts and closes each question. This is correct for a single instance, and for
  multi-instance as long as the host stays put; a host reconnecting to a
  different instance re-arms the timer from `questionEndsAt`.
- **Late joining is closed.** Once a game leaves the lobby, no one else gets in —
  joining at question 6 means never catching up.
- **No email verification.** Addresses are taken on trust at registration, so
  receipts and dunning mail could go nowhere. Small to add now the mail
  infrastructure exists — and a prerequisite for billing.
- **Build needs network for fonts.** `next/font/google` fetches Baloo 2 and
  Nunito at build time and self-hosts them, so the running app makes no
  third-party request — but a flaky network fails the *build*. Vendoring the
  woff2 files and switching to `next/font/local` removes that dependency.
- **Not built yet:** self-paced/homework mode, team mode, image upload (the
  `imageUrl` column exists but nothing writes it), question types beyond
  multiple-choice and true/false, question bank, LMS integrations, profanity
  filtering on nicknames, billing (designed in [docs/billing.md](docs/billing.md)).
- **Never load-tested.** The design targets 200 concurrent players and nothing
  in it should stop that, but it has not been proven at scale.
