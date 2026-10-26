# Pricing — the plans

Companion to [billing.md](./billing.md), which covers the technical design. This
one is the commercial decision: what the plans are, why, and how someone pays
with the least possible friction.

> The figures here are **reasoned anchors, not market research.** The reasoning
> is shown so you can argue with it. Validate against what Lagos schools
> actually pay for edtech before you commit to a price list.

---

## The plans

| | **Free** | **Day Pass** | **Pro** | **School** |
|---|---|---|---|---|
| **Price** | ₦0 | **₦1,500** once | **₦3,500**/mo or **₦30,000**/yr | from **₦180,000**/yr |
| Billing | — | one-off, 24 hours | card / transfer, auto-renews | invoice, bank transfer |
| Live games | Unlimited | Unlimited | Unlimited | Unlimited |
| Players per game | 50 | 200 | 200 | 300 |
| Saved quizzes | 10 | Unlimited | Unlimited | Unlimited |
| Live leaderboard + podium | ✅ | ✅ | ✅ | ✅ |
| **Saved reports + CSV export** | ❌ | ✅ | ✅ | ✅ |
| All question types | ❌ | ✅ | ✅ | ✅ |
| WAEC / JAMB question bank | ❌ | ✅ | ✅ | ✅ |
| Remove Feyi branding | ❌ | ❌ | ✅ | ✅ |
| Teacher accounts | 1 | 1 | 1 | 10 (+₦15,000 each) |
| Shared school library | ❌ | ❌ | ❌ | ✅ |
| Support | Community | Email | Priority email | Named contact + onboarding |

Annual Pro works out at ₦2,500/month — about **29% off**, which is enough to
move people onto a plan that only has to survive one payment a year instead of
twelve.

---

## Why the free tier is shaped this way

**Games are unlimited, deliberately.** An earlier draft of this metered free
users at 3 games a month. That was a mistake: Kahoot's free tier allows
unlimited games, so a stingier free tier gives nobody a reason to switch. The
free plan has to be *competitive*, not merely a trailer.

**What free doesn't get is the record.** Play the game, see the podium, and
that's it — the results aren't kept. This is the right line to draw because it
maps exactly onto who pays. A teacher playing for fun on a Friday genuinely
doesn't need reports. A school that wants to know which topics the class failed
does, and that's the school with a budget.

**50 players covers a normal class.** Not a cap designed to bite — a cap that
happens to sit above a typical class of 40–50 and below a whole-year assembly.
Charging a teacher for having a full class is the fastest way to be resented.

**In one line:** free gets you the *game*, paid gets you the *data*.

---

## Why a Day Pass exists

This is the plan that fits Nigeria better than it fits Kahoot's home market.

- Recurring card debits fail often here, and plenty of buyers won't put a card
  on file at all. A one-off payment sidesteps the entire problem.
- It matches how a lot of people actually work: a trainer with four workshops a
  year, a school with one revision week before WAEC.
- It's the trust builder. Someone who won't commit to a subscription from a
  young product will risk ₦1,500 once.

At ₦1,500, **2.3 passes cost the same as a month of Pro.** Anyone buying a third
pass in a month is being shown the maths — that's the nudge, and it should be
literally on screen at that moment: *"You've bought 3 passes this month. Pro is
₦3,500 and unlimited."*

⚠️ **Keep the Day Pass under ₦2,500.** Paystack's local fee is roughly 1.5% + a
₦100 flat fee, and the flat fee is waived on small transactions. Crossing that
threshold roughly quadruples your processing cost on a low-value sale. *Confirm
Paystack's current thresholds before setting the final price.*

---

## Where the money actually is

**School, by a distance.** ₦180,000/year for ten teachers is ₦18,000 per seat —
a 40% discount on Pro annual, which is what makes it an easy yes for a head
teacher, and it's still 5× a single Pro subscription in revenue.

Schools also buy the way you want to be bought from: **once a year, against a
budget line, by bank transfer, on an invoice.** No card to expire, no failed
renewal, no monthly churn decision. One good school relationship is worth
dozens of individual subscribers and costs less to keep.

Sell Pro to individuals so teachers become advocates inside their school. Sell
School to the people with the budget.

---

## Making it easy to pay

Five things matter more than the price:

**1. Never surprise anyone with a wall.** The dashboard shows the plan and what
it includes at all times. A free user who tries to open a report sees *why* it's
locked and what it costs, before they need it — not a dead button.

**2. Ask at the moment of value, not in a settings page.** The right time to
offer Pro is the second after a game ends, when the host is looking at a
report preview they can't open. Not a banner they scroll past on Tuesday.

**3. Take the money the way people actually pay.** Paystack gives you **card,
bank transfer and USSD** in one integration. Show all three. A meaningful share
of your buyers cannot or will not use a card, and losing them at the last step
is the most expensive kind of loss.

**4. Keep them on your page.** Use Paystack's inline popup rather than a
redirect. Every hop to another domain costs conversions, and a redirect to an
unfamiliar page costs more here than most places.

**5. Be honest about renewal.** Email seven days before an auto-renewal with the
amount and a one-click cancel. Auto-renew that arrives as a surprise debit
produces a chargeback and a bad story told to other teachers — far more
expensive than the month you'd have lost.

### When payment fails

Don't lock the account. Mark it `PAST_DUE`, keep full access for **3 days**, and
email once a day with a link to retry. Nigerian cards decline for reasons that
have nothing to do with the customer's intent — bank downtime, a daily limit, an
international-transaction block. Locking a teacher out mid-term over a bank
glitch loses the customer *and* the payment.

And never interrupt a live game. Ever. Entitlement is checked when the game is
created; if a subscription lapses at 10:31 during a lesson, that game runs to
the podium.

---

## What has to exist before you charge

| | |
|---|---|
| ✅ Password reset | Done. You cannot bill someone you might lock out permanently. |
| ⬜ Email verification | Receipts and renewal warnings must arrive. Small now the mail layer exists. |
| ⬜ Saved reports gated by plan | This is the thing being sold. It has to be real before it can be withheld. |
| ⬜ Error monitoring + backups | Losing a paying customer's data is a different category of problem. |
| ⬜ Terms and refund policy | Needed for Paystack onboarding anyway. |

**Then meter before you enforce.** Ship the counters, charge nobody, and watch
real usage for a month. You cannot price a limit you have never measured — and
the 50-player line in particular should be checked against what class sizes
actually turn up.

---

## A note on the question bank

The plans above list a WAEC/JAMB question bank as a paid feature and it does not
exist yet. It is listed because it is the strongest reason to choose Feyi over
Kahoot in this market, and because pricing built around a content library ages
better than pricing built around features Kahoot can copy in a quarter.

If you only build one thing from this document, build that.
