# BTI Voice — Admin Portal Plan (draft 2026-09-30)

Danny's ask: a portal **only BTI can reach** that shows customer usage (by organization, filterable per user) and has an **Accounts** section to enable/disable features per customer, change a customer user's username/password, and set an **"enabled through" date** tied to billing / invoice renewal.

## 1. The constraint that shapes everything

BTI Voice is **single-tenant**: every customer gets their own Railway service + their own Postgres. That was a deliberate decision (Productization Plan §1) and it stays. It means no single database knows about more than one customer, so "one screen showing all customers" needs a small piece that sits *above* the customer deploys.

Three ways to get there:

| | A. Control plane, **pull model** (recommended) | B. Control plane, push/heartbeat | C. No central piece — per-deploy admin only |
|---|---|---|---|
| How it works | One small BTI-only service holds a **tenant registry** (name, URL, secret key). When BTI opens the portal it calls each tenant's `/api/tenant/*` endpoints live and aggregates. Toggles are written straight to the tenant. | Each tenant phones home every N minutes with usage + pulls its config. Central DB stores everything. | Each deploy gets an owner-only admin section. BTI logs into each customer separately. |
| Cross-customer view | Yes | Yes | **No** |
| New infrastructure | 1 tiny service, registry table only | 1 service + full usage schema + sync jobs | None |
| Works when central is down | Tenants unaffected (settings live in tenant DB) | Needs grace logic | n/a |
| Effort | ~2 sessions after Phase 1 | ~3–4 sessions | ~2 sessions (this *is* Phase 1) |

**Recommendation: build C first (it's the foundation either way), then add A on top.** A's portal is basically a page that loops over tenants calling the endpoints C creates. B only pays off with dozens of tenants; at 1–5 pilots live-pull is instant and far simpler.

A multi-tenant rewrite (one deploy, `org_id` on every table) would make the portal trivial but is the rewrite we already rejected — not revisited here.

## 2. Phase 1 — per-tenant admin foundation (inside the existing app)

### 2a. `deploy_settings` table (one row per deploy)
Overrides env-var defaults so BTI can flip things without a Railway redeploy:

- `features` JSON — `{ zoho, recording, ai_summaries, sms, voicemail_transcription, mobile_apps }` (booleans). `GET /api/features` (built 2026-09-30) starts reading this, falling back to env. Zoho stays doubly gated: toggle **and** credentials must both exist.
- `seat_limit` — max active agents; creating an agent past it is refused with a friendly message.
- `enabled_through` DATE + `grace_days` INT (default 14).
- `company_name`, `brand_name` — moved here from env over time.
- `notes` — BTI-internal (plan tier, invoice #, contact).

### 2b. Enforcement of `enabled_through` (customer-visible behaviour — Danny to confirm)
1. **≤ 14 days before:** amber banner for the customer's admin only: "Your BTI Voice subscription renews on <date>."
2. **Past the date, inside grace:** banner for everyone; app fully works.
3. **Past grace:** **outbound calls + SMS disabled**, inbound still rings and logs (so a late payer never misses a customer call — that would be the thing they remember). Login still works, data readable.
4. **Past grace + 30 days:** login blocked with a "contact BTI" screen. Nothing deleted.
BTI can override any of this from the portal (extend date, set `suspended=true` immediately).

### 2c. Tenant admin API — `/api/tenant/*`, authenticated by `TENANT_ADMIN_KEY` (per-deploy secret, BTI-held; never a customer login)
- `GET /settings`, `PATCH /settings` — the table above.
- `GET /usage?from=&to=&agent_id=` — aggregates only, **never message bodies or recordings**: calls in/out (count, minutes), SMS in/out, recordings + transcription minutes (≈ OpenAI cost), AI summaries, active agents (last login), storage used. Per-agent rows + org totals.
- `GET /agents`, `PATCH /agents/:id` (rename, username, reset password → returns a one-time temporary password and forces change on next login, activate/deactivate).
- `GET /health-extended` — version, DB size, Twilio numbers, last webhook seen (spot a broken deploy from the portal).

### 2d. ~~Owner-only UI in the app itself~~ — DROPPED 2026-09-30 (see §4a #4: portal-only)
A hidden **Account** section in Settings visible only when logged in with an `owner`-role agent (new role; BTI's login on each deploy). Shows settings + usage. This alone satisfies "we can see and control each customer" for the pilots, and the portal reuses the same endpoints.

## 3. Phase 2 — the BTI portal (Option A)
- Separate tiny Railway service, `bti-voice-admin`, one table: `tenants (id, name, url, tenant_admin_key, plan, notes)`. BTI-only login (2 users; TOTP later).
- **Dashboard:** all tenants, status pill (OK / renews soon / in grace / suspended / unreachable), this month's calls, SMS, AI minutes, active users.
- **Accounts → tenant page:** tabs Usage (date range + per-user filter), Users (reset/rename/deactivate), Features (toggles → `PATCH /settings`), Billing (`enabled_through`, grace, plan, invoice notes, "extend 30 days" button), Health.
- **Onboarding shortcut:** "Add tenant" = paste URL + key. Later: button that creates the Railway service from a template (Railway API) — not Phase 2.
- Usage feeds the invoice: export CSV per tenant per month → Zoho Billing (BTI's own Zoho, on the BTI side only).

## 4. Decisions for Danny before build
1. Go with **C then A** (per-deploy foundation first, portal second)? Or portal-first?
2. **Which features are toggleable** — proposed: Zoho, call recording, AI summaries, SMS, voicemail transcription, mobile apps, seat limit. Anything else (e.g. after-hours auto-text, IVR)?
3. **Expiry behaviour** in §2b — agree with "outbound off, inbound stays on" past grace? Grace 14 days?
4. Is the **owner-only section inside the customer app** acceptable, or must all BTI admin live outside the customer's UI from day one?
5. Portal login: Danny + Paul only? Rick?

## 4a. DECISIONS — Danny, 2026-09-30
1. **Order: C then A** — per-deploy admin foundation (Phase 1) first, BTI portal (Phase 2) on top. ✅
2. **Toggleable features as proposed:** Zoho, call recording, AI summaries, SMS, voicemail transcription, mobile apps, seat limit. ✅
3. **Expiry behaviour — LOCKED IN (Danny asked this be noted so he remembers):**
   - 14 days before `enabled_through`: renewal banner for the customer's admin.
   - Past the date → **14-day grace**: banner for everyone, app fully works.
   - Past grace: **outbound calls + SMS OFF; inbound still rings and logs**; login + data reading still work.
   - Grace + 30 days: login blocked ("contact BTI" screen). **Nothing is ever deleted.**
   - BTI can extend the date or suspend immediately from the portal at any time.
4. **Where BTI's controls live: PORTAL ONLY.** Danny: "I'd like all that to be toggleable from the portal, so when I make a pilot account I can decide what they have access to. No need to stuff it in the app." → **§2d (owner-only in-app section) is DROPPED.** Phase 1 is backend-only: `deploy_settings` table, expiry enforcement, `/api/tenant/*` endpoints keyed by `TENANT_ADMIN_KEY`. Every control (features, seats, renewal date, user resets) is exercised only from the Phase 2 portal. Consequence: nothing is *usable* by BTI until the portal exists, so Phase 1 and Phase 2 should be built back-to-back; a bare-bones portal (tenant list + settings form + usage table) is the minimum before the first pilot account is created. **Pilot onboarding flow:** portal → Add tenant (URL + key) → tick features + seat limit + enabled_through → customer logs in for the first time already scoped. ✅
5. **Portal logins: Danny, Paul, Rick, Shawn.** ✅

## 5. Not in scope (noted so they aren't forgotten)
Per-customer branded installers · Railway-API automated provisioning · multi-tenancy · customer self-service billing/Stripe.
