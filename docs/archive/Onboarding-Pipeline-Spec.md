# Talkingvet Customer Onboarding Pipeline — Design Spec

**Purpose:** Give you and your team one shared, glanceable view of where every new customer is in the journey from payment-entered to live — and, critically, what is blocking anyone who isn't moving.

**Build target:** A dedicated **"Customer Onboarding"** custom module in Zoho CRM, separate from the sales pipeline. Discovery and onboarding calls flow in from Zoho Bookings; payment status reconciles against Zoho Books.

> Review this before we build anything. Nothing below touches Zoho until you approve it.

---

## 1. The stages

Seven stages, matching your real flow. Each card (one per customer/practice) lives in exactly one stage and moves left-to-right.

| # | Stage | What it means | Owner typically |
|---|-------|---------------|-----------------|
| 1 | **Payment Entered** | Doctor has entered payment; not yet captured. Clock starts. | Sales / you |
| 2 | **Discovery Scheduled** | First discovery call booked with the practice manager. | Onboarding |
| 3 | **Discovery In Progress** | One or more discovery calls happening; assessing PIMS & integration feasibility. | Onboarding / Integrations |
| 4 | **Integration Build** | PIMS is being configured/built or validated to work. | Integrations |
| 5 | **Integration Confirmed** | Integration tested and working. Payment can now be captured. | Integrations |
| 6 | **Onboarding Scheduled** | 1:1 onboarding call booked with the doctor. | Onboarding |
| 7 | **Live** | Onboarding call done, doctor trained, software running. Deal complete. | — |

Plus two "off-ramp" statuses that can be set from any stage so stalled/dead deals don't pollute the board:

- **On Hold** — customer paused (with a reason + follow-up date).
- **Lost / Refunded** — didn't work out (with a reason).

---

## 2. Fields on every record

**Core identity**
- Practice / Account name
- Primary doctor (contact)
- Practice manager (contact — your discovery-call counterpart)
- Owner (the team member responsible right now)

**The two fields that kill the falloff problem** — visible on the Kanban card itself:
- **Current Blocker** — short text: what is stopping this customer from advancing right now ("waiting on manager to confirm PIMS version", "needs 2nd discovery call", "none").
- **Next Action + Due Date** — what happens next and by when. If a card has no next action, that's the signal something's been dropped.

**Integration assessment** (filled during discovery)
- PIMS / practice software (picklist — grows as you encounter new ones)
- PIMS supported? (Yes / No / Needs build)
- Complexity (Standard / Complex / New PIMS)
- Number of discovery calls held (counter)
- Integration notes (layout, quirks, what's needed to make it work)

**Money**
- Payment entered date
- Payment captured? (Yes / No) — gated to only flip Yes at/after Integration Confirmed
- Amount (syncs from / reconciles with Zoho Books)

**Dates (mostly auto-filled from Bookings)**
- Discovery call date(s)
- Integration confirmed date
- Onboarding call date
- Went live date

---

## 3. Blueprint rules (this is what enforces the process)

Blueprint is the Zoho feature that makes the pipeline self-policing: stages become sequential, and each transition can *require* fields before it's allowed. This is what stops things slipping through cracks.

| Transition | Required before it's allowed |
|------------|------------------------------|
| Payment Entered → Discovery Scheduled | Discovery call booked (date set) |
| Discovery Scheduled → Discovery In Progress | (automatic when first call happens) |
| Discovery In Progress → Integration Build | PIMS named, "PIMS supported?" set, complexity set |
| Integration Build → Integration Confirmed | Integration notes filled; confirmation that it's tested working |
| Integration Confirmed → Onboarding Scheduled | Payment captured = Yes; onboarding call booked |
| Onboarding Scheduled → Live | Onboarding call marked complete |
| Any stage → On Hold | Hold reason + follow-up date required |
| Any stage → Lost / Refunded | Reason required |

**Multiple discovery calls** are handled naturally: the card simply stays in **Discovery In Progress** with the call counter incremented and the blocker noted ("scheduling 2nd discovery — complex PIMS layout"). It never advances to Integration Build until the assessment is genuinely complete, so a complex customer can't be mistaken for ready.

**Unsupported PIMS** path: if "PIMS supported?" = No, the card routes to On Hold (or Lost) with a reason, rather than dead-ending invisibly in Discovery.

---

## 4. Automations (catch the falloff automatically)

- **Stale-deal alert:** if a card sits in any stage past a threshold (e.g. 7 days with no activity), notify the owner. This is the single biggest fix for "we forgot who's where."
- **Missing next-action alert:** any active card with no Next Action set → flag.
- **Bookings sync:** when a discovery or onboarding call is completed in Zoho Bookings, auto-stamp the date and (for onboarding) prompt the move to Live.
- **Integration-confirmed nudge:** the moment a card hits Integration Confirmed, auto-create the task/notification to book the onboarding call and capture payment.
- **Payment guardrail:** "Payment captured" can't be set to Yes before Integration Confirmed — protects the money-timing rule you described.

---

## 5. The views your team uses

- **Kanban board** — the default. Every customer as a card under their stage, with Owner, Current Blocker, and Next Action visible at a glance. This is the "see the status of everyone" view you asked for.
- **My Open Onboardings** — filtered to each team member's owned cards.
- **Stalled / Needs Attention** — cards flagged stale or missing a next action.
- **Ready to Capture Payment** — cards at Integration Confirmed where payment hasn't been captured.

---

## 6. Open questions for you

1. **Stale threshold** — how many days in a stage with no movement before it gets flagged? (Default suggestion: 7.)
2. **Discovery vs. onboarding owners** — is it the same person handling both, or separate roles? (Affects who automations notify.)
3. **Payment capture** — is that a manual step your team does in Zoho Books, or should it trigger automatically at Integration Confirmed?
4. **Who needs board access** — just you, or the whole team? (Affects permissions setup.)

---

*Next step after your review: I build this as the live custom module in Zoho CRM — stages, fields, Blueprint, automations, and the four views.*
