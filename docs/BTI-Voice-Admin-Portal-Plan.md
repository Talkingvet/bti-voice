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

## 6. Phase 1 — BUILT 2026-09-30 (Danny, desktop). What exists now

Backend-only, exactly per §4a #4 (no customer-facing admin UI). Everything is in the customer's own deploy; the Phase 2 portal just calls it.

### 6a. Storage
- `deploy_settings` (single row, id=1): `features` JSONB, `seat_limit`, `enabled_through` DATE, `grace_days` (14), `suspended`, `company_name`, `brand_name`, `notes`. Created + seeded by `migrate()`; existing deploys pick it up on next boot with everything "on"/unlimited/no expiry — **zero behaviour change until BTI sets something.**
- `agents.must_change_password`, `agents.last_login_at`.

### 6b. `server/helpers/deploySettings.js` — the brain
- In-memory cache of the row, primed at boot, refreshed every 30s and instantly after any `PATCH`. Read synchronously from auth + TwiML (no DB hit on hot paths).
- `resolveFeatures()` → `{ zoho, zoho_widget, recording, ai_summaries, sms, voicemail_transcription, mobile_apps }`. Rule: **a toggle can only turn a feature OFF**; env credentials still gate everything (toggling `zoho:true` on a deploy with no Zoho vars does nothing). Missing key = on.
- `computeAccountStatus(row, now)` — pure, unit-tested (`server/test/deploySettings.test.js`, 15 cases). States: `active` → `renews_soon` (≤14 d) → `grace` (14 d after `enabled_through`, inclusive of that day) → `restricted` (outbound off) → `blocked` (grace + 30 d, or `suspended`). Each carries `outbound_allowed`, `login_allowed`, and the customer-facing `message`.

### 6c. Where it's enforced (all server-side)
| What | Where | Behaviour |
|---|---|---|
| Login | `routes/auth.js` | `blocked` → 403 `{code:'account_blocked'}` before the password is even checked. iOS/Android login with `mobile_apps=false` → 403 `mobile_disabled`. |
| Existing sessions | `auth.js requireAuth` | `blocked` → every API call 403 `account_blocked`; client signs out and shows the message on the login screen. |
| Outbound calls | `webhooks/voice.js /outbound` | `restricted`/`blocked` → agent hears "Outbound calling is paused… contact BTI", call ends. **Inbound path untouched — still rings and logs.** |
| Outbound SMS (all 6 send sites) | `messages.js /send + /schedule`, `conversations.js /new-message`, `zohoWidget.js /send`, missed-call auto-text (`voice.js`), after-hours auto-reply (`sms.js`), scheduled sweep | `sms=false` or `restricted` → 403 `sms_blocked` with the reason; auto-texts skipped; due scheduled texts marked failed with the reason. |
| Recording | `helpers/recordingNotice.js recordingActive()` (shared by `<Dial record>` + spoken disclosure) | `recording=false` → no recording, no disclosure. |
| Transcription | `voice.js /recording-complete` | voicemails need `voicemail_transcription`; calls need `recording`. Audio still saved. |
| AI summaries | same | `ai_summaries=false` → transcript kept, summary skipped. |
| Zoho | `zoho.js isZohoConfigured()` now = creds **and** toggle | every sync path + wrap-up sweep (per-tick check) go quiet; client hides CRM UI via `/api/features`. |
| Seats | `routes/tenant.js` | creating or re-activating a user past `seat_limit` → 409 `seat_limit`. |

### 6d. `/api/tenant/*` (auth: `X-Tenant-Key: <TENANT_ADMIN_KEY>`; unset key ⇒ 404)
- `GET /settings` → `{ settings, resolved_features, feature_keys, account, env_defaults }`
- `PATCH /settings` — any of `features` (merged, booleans only), `seat_limit` (int|null), `enabled_through` (`YYYY-MM-DD`|null), `grace_days`, `suspended`, `company_name`, `brand_name`, `notes`. Validated; returns the same shape as GET.
- `POST /settings/extend {days}` — the "extend 30 days" button; from `enabled_through` if still future, else from today; also clears `suspended`.
- `GET /usage?from&to&agent_id` — defaults to month-to-date. Per-agent rows + org totals: calls in/out + minutes (Twilio-style ceil per call), missed, voicemails, recordings + recorded minutes, transcriptions, AI summaries, SMS in/out, MMS; storage (db + media bytes); counts (contacts, conversations, active agents, logged-in-this-period, seat limit). **Aggregates only — no bodies, transcripts, recordings, names.**
- `GET /agents` (incl. inactive) · `POST /agents {name, username, password?, phone_number?}` → returns a one-time `temporary_password` when none given · `PATCH /agents/:id {name?, username?, phone_number?, is_active?, reset_password:true}` → `temporary_password`; the user gets the existing "change your password" banner and the flag clears when they do.
- `GET /health-extended` — server/desktop versions, uptime, which integrations are configured (booleans), numbers (routing table + agent numbers), DB size, last call/message/login, last genuine Twilio webhook seen (voice/sms), resolved features, account status.

### 6e. Client (`client/src`)
- `features.js` defaults gained `sms, ai_summaries, voicemail_transcription, mobile_apps, account`.
- `App.jsx`: server-driven banner — amber for `renews_soon`/`grace`, red for `restricted` ("outbound paused, incoming still rings"). Not dismissable; disappears when BTI extends the date.
- `Login.jsx` shows the server's blocked/suspended message after a forced sign-out; `api.js` passes `platform` (ios/android via `window.Capacitor`) and surfaces `err.code`.

### 6f. Pilot-onboarding flow this enables (once Phase 2 exists)
Railway service from template → set `TENANT_ADMIN_KEY` → portal "Add tenant" (URL + key) → tick features, seat limit, `enabled_through` → `POST /agents` for their first user (temp password) → customer logs in already scoped. Until the portal exists the same thing works with curl (DEPLOY-RUNBOOK).

### 6g. Not done / next
- **Phase 2 portal** (`bti-voice-admin`, §3) — the only thing standing between this plumbing and a usable pilot.
- Runtime test on a scratch Railway service: set `enabled_through` to yesterday-minus-15-days, confirm outbound blocked + inbound rings; set `suspended`, confirm login message; reset a password, confirm banner + forced change.
- Client dial-pad could pre-empt the spoken "paused" message by reading `account.outbound_allowed` — cosmetic, deferred.
- `company_name`/`brand_name` overrides are stored and returned (`/api/features.brand`) but AI-summary prompts and after-hours texts still read `COMPANY_NAME` from env — wire `displayNames()` in when Phase 2 lands.

## 7. Phase 2 — BUILT 2026-09-30 (Danny, desktop). The portal exists

Lives in the same repo at **`bti-voice/admin/`** and deploys as a **second Railway service, `bti-voice-admin`**, with its own tiny Postgres. Plain Node/Express + static HTML/JS (no build step, no framework) — Railway just runs `npm start`. 15 files, ~1,400 lines. Setup steps: **DEPLOY-RUNBOOK §8**.

### 7a. What it stores (3 tables, that's all)
- `portal_users` — Danny/Paul/Rick/Shawn. bcrypt passwords, `must_change_password`, `last_login_at`. First user bootstrapped from `PORTAL_ADMIN_USERNAME/PASSWORD` env vars when the table is empty (same pattern as the customer app's `ADMIN_USERNAME`).
- `tenants` — one row per customer deploy: name, url, **`key_enc`** (the deploy's `TENANT_ADMIN_KEY`, AES-256-GCM encrypted with a key derived from `PORTAL_SECRET` — never stored or returned in the clear; only a `…last4` hint is shown), plan, notes, `is_active` (archive), `last_ok_at`, `last_error`.
- `portal_audit` — who did what to which tenant (login, settings patch, extend, agent create/reset, usage export, tenant add/edit…). Shown per tenant in the **Activity log** tab. This is the paper trail for billing disputes.

**Nothing about a customer's usage or settings is stored in the portal** — every screen pulls live from that deploy's `/api/tenant/*` (§6d). Pull model exactly as §1 option A.

### 7b. Screens
- **Login** → forced password change on temp passwords.
- **Dashboard** — all active tenants sorted by severity: status pill (Unreachable / Blocked / Suspended / Outbound off / In grace / Renews in Nd / OK), renewal date, users vs seats, MTD calls/minutes/texts/AI minutes, which features are off. Company-wide totals across tenants at the top. Fan-out is parallel with an 8 s timeout per tenant (`TENANT_TIMEOUT_MS`), so one dead deploy shows "Unreachable" and never hangs the page.
- **Add tenant** — name + URL + key (+ plan/notes). The portal **verifies the key against the deploy before saving** (`GET /settings`); a wrong key or URL is rejected with the exact reason. "Save anyway" checkbox for a deploy that isn't up yet. Duplicate URLs refused.
- **Tenant page**, tabs:
  - **Usage** — date range (This month / Last month presets), per-user filter, 13 stat tiles, per-user table with Unattributed + Total rows, **⬇ Export CSV** (one row per user + totals, filename `bti-voice-usage-<tenant>-<from>-to-<to>.csv`) for Zoho Billing.
  - **Users** — the customer's agents: add (returns one-time temp password in a copyable modal), edit name/username/number, reset password (temp password), deactivate/reactivate (seat-limit errors surface from the deploy). Seat count shown.
  - **Features** — the six toggles (Zoho, recording, AI summaries, SMS, voicemail transcription, mobile apps) as switches with a plain-English line each; a toggle the deploy can't support (no Zoho creds / no OpenAI key) is marked **not available**. Seat limit field. "Resolved right now" list. Changes save instantly on flip (PATCH per toggle) and take effect on the deploy within 30 s.
  - **Billing** — `enabled_through` date picker, **+30 / +90 / +1 year** extend buttons, "No expiry", grace days, **Suspend / Lift suspension** (with confirm), plan (portal-side), billing notes (deploy-side). The **locked-in expiry rules from §4a #3 are printed on this tab** so nobody has to remember them.
  - **Health** — server/desktop versions, uptime, DB size, last call/text/login, last Twilio webhooks, integrations configured, number routing table, **Test connection**.
  - **Activity log** — audit rows for this tenant.
  - **Setup** — rename, change URL, **rotate key** (paste new one), portal notes, **Archive** (hides from dashboard; deploy untouched; un-archive any time).
- **Portal users** — add (temp password), reset, deactivate. Can't deactivate yourself or the last active user.

### 7c. Security posture
- Session = 12 h JWT signed with `PORTAL_SECRET`; user row re-read on every request so deactivation is immediate. 10 failed logins per username → 15-min lockout. `must_change_password` blocks every route except change-password.
- `PORTAL_SECRET` is **required in production** (boot refuses without it) because a per-boot random value would make every stored tenant key undecryptable. **Losing/rotating it means re-entering every tenant key via Setup → rotate key.**
- Tenant keys are decrypted only in memory for the outbound call; never logged, never returned.
- `X-Frame-Options: DENY`, `nosniff`, `no-store` on API, `noindex`. No TOTP yet (§3 said "later").
- Everything mutating is audited with username + IP.

### 7d. API (portal's own, all under `/api`, Bearer JWT)
`POST auth/login` · `GET auth/me` · `POST auth/change-password` · `GET/POST users` · `PATCH users/:id` · `GET dashboard` · `GET/POST tenants` · `PATCH tenants/:id` · `POST tenants/:id/test` · `GET/PATCH tenants/:id/settings` · `POST tenants/:id/settings/extend` · `GET tenants/:id/usage[.csv]` · `GET/POST tenants/:id/agents` · `PATCH tenants/:id/agents/:aid` · `GET tenants/:id/health` · `GET tenants/:id/audit` · `GET health` (unauthenticated, for Railway).
The `tenants/:id/*` routes are thin passthroughs to §6d — the deploy does the validation, the portal relays its status code and error text unchanged.

### 7e. Verification (2026-09-30, in Claude's sandbox — real Postgres 16, two mock tenants + one deliberately dead)
`node --test` 5/5 (crypto round-trip + tamper detection, pill mapping, CSV shape). Runtime: boot → migrations → bootstrap user → login → forced password change → add tenant with WRONG key correctly refused → add with right key → dead tenant saved with `force` → dashboard shows OK/OK/Unreachable → toggle Zoho off + seat limit 3 → extend 30 d → reset agent password → create agent → CSV download with correct filename → audit trail complete → portal user add + self-deactivate guard → 401 unauth + 400 bad JSON → keys confirmed encrypted in the DB → SPA deep-link reload works. Headless Chromium walked every screen with **zero JS errors**. Two bugs found and fixed during this: array-as-attrs in the DOM helper; date-only strings rendering a day early in US time zones.
**NOT yet done against a real Railway deploy** — that's DEPLOY-RUNBOOK §8 step 9.

### 7f. Not done / next
- **Deploy it** (DEPLOY-RUNBOOK §8) and register BTI's own deploy as tenant #1.
- §6g leftovers still stand: runtime-test the lifecycle on a scratch deploy; wire `displayNames()` into AI prompts/after-hours texts.
- TOTP for portal logins; Railway-API "create tenant service from template" button; automatic monthly CSV → Zoho Billing (today it's a manual download).
- Main Railway service redeploys on every push, including admin-only commits (harmless — same code). Optional tidy: set Watch Paths on each service.
