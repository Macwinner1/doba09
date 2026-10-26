# Billing — design

Status: **design only, nothing implemented.** This is the plan to argue with
before any code gets written.

---

## 1. What we charge for

**The game is free. The record is paid.**

Two levers were rejected on the way here. Capping free games at ~10 players
means the product cannot do the job it exists for — a Nigerian classroom is
40–60 students, so people leave before they ever reach the paywall, and it
charges the teacher for having a full class. Metering free users at a few games
a month fails differently: Kahoot's free tier is unlimited, so a stingier one
gives nobody a reason to switch.

Gating **saved reports** avoids both. It costs a casual user nothing they wanted,
and it lands squarely on the school that needs to know which topics the class
failed — which is the buyer with a budget.

> **Plans and prices:** The plans, prices and free-tier shape now live in
> [pricing.md](./pricing.md). The short version:
>
> | Tier | Price | Shape |
> |---|---|---|
> | Free | ₦0 | unlimited games · 50 players · **no saved reports** |
> | Day Pass | ₦1,500 once | Pro for 24 hours |
> | Pro | ₦3,500/mo · ₦30,000/yr | 200 players · reports + CSV · all question types |
> | School | from ₦180,000/yr | 10 teachers · shared library · invoiced |
>
> An earlier version of this document metered free users at 3 games/month. That
> was wrong: Kahoot's free tier allows unlimited games, so a stingier free tier
> gives nobody a reason to switch. The paywall now falls on **saved reports**
> rather than frequency — the game is free, the record is paid.
>
> That change also simplifies enforcement: there is no monthly game counter to
> maintain, only a plan check on report access and on the player cap.

---

## 2. Provider: Paystack

Stripe is not practically available to Nigerian businesses. Paystack is
Nigerian, has a real subscriptions API, and supports **card, bank transfer and
USSD** — which matters, because a large share of buyers will not put a card on
file. Flutterwave is the alternative if the target widens across Africa.

Charge in **Naira**, with USD as a secondary currency for international users.

---

## 3. Data model

```prisma
enum PlanTier { FREE  PRO  SCHOOL }
enum SubscriptionStatus { ACTIVE  PAST_DUE  CANCELLED  EXPIRED }

model Subscription {
  id                   String   @id @default(cuid())
  userId               String   @unique
  tier                 PlanTier @default(FREE)
  status               SubscriptionStatus @default(ACTIVE)
  /// Paystack's identifiers, so we can reconcile against their dashboard.
  paystackCustomerCode String?
  paystackSubCode      String?
  /// Access runs to here. A Day Pass is just a short window.
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean  @default(false)
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

/// Analytics, not enforcement. Nothing is capped by frequency — this exists so
/// the 50-player free cap can be checked against reality before it is trusted.
model UsageCounter {
  id             String @id @default(cuid())
  userId         String
  /// "2026-08"
  period         String
  gamesHosted    Int    @default(0)
  peakPlayers    Int    @default(0)
  @@unique([userId, period])
}

/// Every webhook we have already processed, so retries are harmless.
model ProcessedWebhook {
  id         String   @id           // Paystack event id
  processedAt DateTime @default(now())
}
```

---

## 4. Enforcement

**Server-side, in `GameEngineService.createGame`.** Never in the UI — a limit
enforced in React is one devtools edit away from gone. `createGame` is the
single choke point through which every game must pass, which is exactly why it
is the right place.

Two checks, in two places:

```
createGame(hostId, quizId)
  ├─ load subscription (default FREE)
  ├─ entitled = status ACTIVE && (currentPeriodEnd == null || > now)
  └─ maxPlayers = entitled ? tierCap : 50      ← stored on the game

joinPlayer(pin, nickname)
  └─ if playerCount >= game.maxPlayers → GameError('GAME_FULL')

persistIfNeeded(pin)  /  GET /api/reports
  └─ free tier: play the game, don't keep the record
```

The player cap belongs on the **game**, resolved at creation, not looked up per
join — otherwise every one of 200 players triggers a subscription query during
the busiest second of the session.

**Never interrupt a game in progress.** Entitlement is checked once, when the
game is created. If a subscription lapses at 10:31 during a live lesson, the
game runs to the podium. Killing a room of 40 students mid-question to enforce
billing would be indefensible, and the revenue saved is nil.

**Decide what "no reports" means before building it.** Two options: don't write
the session at all, or write it and gate reading. Writing it is better — the
data costs almost nothing to keep, and *"upgrade to see the 6 games you've
already played"* is a far stronger offer than an empty page. `GAME_FULL` already
exists in `GameErrorCode`; add `PLAN_LIMIT_REACHED` for the report gate.

---

## 5. Payment flow

```
Host clicks Upgrade
  └─ POST /api/billing/checkout          → initialise Paystack transaction
       └─ redirect to Paystack           → card / transfer / USSD
            └─ Paystack redirects back   → /billing/callback (optimistic UI only)
            └─ Paystack calls webhook    → the ONLY source of truth
```

**The redirect back is not proof of payment.** A user can close the tab, or hand-
craft that URL. Entitlement is granted by the webhook and nothing else; the
callback page only says "we're confirming your payment".

### Webhooks

`POST /api/billing/webhook` — and it must be:

1. **Signature-verified.** HMAC-SHA512 of the raw body with the Paystack secret,
   compared in constant time. This needs the **raw** body, so the route must
   bypass Nest's JSON parser — a route that verifies a re-serialised body will
   pass in testing and fail on the first unicode character.
2. **Idempotent.** Paystack retries. Insert the event id into
   `ProcessedWebhook` first; a unique-constraint violation means "already done",
   return 200 and stop. Without this, a retry of `charge.success` can extend a
   subscription twice.
3. **Fast.** Acknowledge with 200 immediately and do the work; a slow handler
   gets retried, which multiplies the load.

Events to handle: `charge.success`, `subscription.create`,
`subscription.disable`, `invoice.payment_failed`.

---

## 6. Failure modes worth deciding now

| Case | Decision |
|---|---|
| Card fails on renewal | `PAST_DUE`, keep access for a 3-day grace, email each day. Locking out a teacher mid-term over a bank glitch loses the customer, not the payment. |
| Subscription lapses mid-game | Game finishes. Always. |
| Refund request | Manual for the first year. Automating refunds before you understand why people ask for them is premature. |
| Double payment | Idempotency keys on checkout init; reconcile against Paystack weekly. |
| User deletes account with an active sub | Cancel at Paystack first, then soft-delete. An orphaned live subscription keeps charging a card for nothing. |
| Currency | Store amounts in **kobo** as integers. Never floats for money. |

---

## 7. Order of work

1. `Subscription` + `UsageCounter` + `ProcessedWebhook` models, everyone on FREE
2. **Metering without enforcement** — record player counts and games per host,
   enforce nothing, and watch for a month. The 50-player free cap is a guess
   until you know what class sizes actually turn up; if the median game has 60
   players it is punitive, and if it has 12 it earns nothing.
3. Enforcement + the upgrade prompt
4. Paystack checkout and webhooks
5. Day Pass
6. School tier — largely invoicing and an admin screen, not payment code

## 8. Prerequisites

- ✅ **Password reset** — done. You cannot bill someone you might lock out
  permanently.
- ⬜ **Email verification.** Billing to an unverified address means receipts and
  dunning mail going nowhere. The mail infrastructure now exists, so this is
  small.
- ⬜ **Error monitoring and database backups.** Losing a paying customer's data
  is a different category of problem from losing a free user's.

**Do not build any of this until retention shows people coming back a second and
third week.** Charging for something nobody has returned to twice buys refund
requests, not revenue.
