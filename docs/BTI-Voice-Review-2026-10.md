# BTI Voice — Code, Security & UI/UX Review (2026-10-05)

**Pass 1 of 2: read-only audit. Nothing in the code was changed.** This is the report to read and decide from; fixes happen in Pass 2, one approved batch per session.

- **Snapshot reviewed:** desktop repo at commit `772c924` (2026-10-05, 12:08 ET).
- **Method:** three independent reviewers in parallel — a senior-engineer code-health pass, an application-security pass, and a product-designer UI/UX pass. The UI pass ran the real build (Postgres 16, server with **no Twilio/Zoho/OpenAI** configured, a seeded fictional customer "Acme Plumbing"), took 187 screenshots at 470×805 (Electron default), 1280×800 and 390×844 (touch), and the critique is grounded in those. Key screenshots are in `docs/review-2026-10/`.
- **Design direction used (Danny to confirm or override):** *"A clean, calm, modern business tool — think OpenPhone/Dialpad. Dense but not cluttered, consistent spacing and type, obvious primary actions, polished empty/error states. Should feel trustworthy to an MSP customer's receptionist who's never seen it."*
- **Severity:** Critical / High / Medium / Low. **Effort:** S (< 1 h) · M (half-day) · L (multi-day).

---

## 1. Executive summary

1. **The product core is sound for a two-customer pilot, but not yet "sellable without a developer on call."** SQL is parameterised everywhere, Twilio webhook signatures are validated, media tokens are scoped and short-lived, and the admin portal is built the right way. The main server, though, has no roles, no session revocation, no login throttling, and ~80 routes that return raw internal error text.
2. **Two things to do this week regardless of anything else:** (a) rotate the Railway Postgres password — the live connection string with password is in the *current* docs, not just git history; (b) make deactivating or resetting a user actually log them out — today a removed employee's desktop app keeps working for 30 days and renews itself on every launch.
3. **UI/UX grade against the brief: C.** Capable and feature-dense, but there is no visual system (81 hex colours, 23 font sizes, 19 radii, 106 emoji-as-icons across 21 files each with their own inline styles), and three findings are *trust* bugs rather than polish: the message list attributes the customer's texts to the agent ("Dana: STOP"), outbound SMS shows as "sent" when nothing was delivered, and voicemail transcripts are never shown.
4. **Talkingvet/BTI leaks into every customer deploy:** wrap-up outcomes are "Demo scheduled / Existing customer — support", placeholders say "e.g. shawn" and "e.g. Florida vets — no PIMS", About credits Danny and links to BTI's site, and the Login wordmark ignores the brand setting.
5. **Testing and build hygiene are thin where it matters:** 45 tests cover pure helpers only (zero for auth, webhooks, routes, Zoho, migrations), no CI, no lint, and `.gitignore` drops *every* `package-lock.json` so Railway builds aren't reproducible. Dependencies have known vulnerabilities (server: 12, 7 high; client: 14 incl. one critical).

---

## 2. Do these first (recommended Pass 2 batch order)

| # | Item | Sev | Effort | Why first |
|---|------|-----|--------|-----------|
| 1 | Rotate the Railway Postgres password; strip credentials, the Zoho port-out PIN and usernames/default-password notes from `docs/` (§5 A1, A2) | Critical | S | Live secret in the working tree |
| 2 | Session revocation: check `is_active` + a `token_version` on every request and on `/auth/refresh`; bump it on deactivate / password reset (§5 A3) | Critical | M | Removed employees keep access |
| 3 | Login throttle + global rate limit + helmet + real CORS on the customer app (copy the portal's) (§5 A4, B8) | High | S | Credential stuffing, log flooding |
| 4 | TwiML injection in `/api/calls/resume` + `/transfer`; validate agent IDs, build TwiML with the Twilio helper (§5 A5) | High | S | Insider toll fraud / call hijack |
| 5 | Allow-list Twilio media/recording URLs before storing/fetching (§5 A6) | High | S | Credential leak if webhooks ever go soft |
| 6 | `npm audit fix` server + client; commit lockfiles (`/package-lock.json` instead of bare pattern); add `admin/package-lock.json` (§4 D1, D2) | High | S | Known CVEs reachable from the socket layer |
| 7 | Trust bugs in the UI: preview-prefix attribution, undeliverable-SMS-shown-as-sent, voicemail transcripts + "played on play" (§6 F1–F3, F26) | High | S each | Receptionist will act on wrong info |
| 8 | Brand/identity sweep for customer deploys: Login wordmark, placeholders, About credits, wrap-up outcomes become a per-deploy setting (§6 F5–F7) | High | S | CBIA sees Talkingvet sales dispositions today |
| 9 | Roles (`admin`/`agent`) + "Add teammate" in Settings (§5 B1, §6 F8) | High | L | Every agent can re-route the main number; users are created by SQL today |
| 10 | Design tokens session 0: `ui/tokens.css`, `useColors()` returns CSS vars, fix contrast, drop the `zoom` hack, add `:focus-visible`, nav labels, voice-offline banner (§7) | High | M | Unblocks every later UI batch with zero JSX rewrites |

Then: README + CI (§4 C1, C2), the call-logging consolidation (§3 A1), the Electron server-address installer (already planned), and the tab-by-tab UI migration (§7).

---

## 3. Code health (senior-engineer lens)

### A. Architecture & duplication

**A1. Three copies of the call-logging pipeline** — High — L
`server/webhooks/voice.js:15-117` (`autoLogCall`), `:508-614` (`/status`), `:679-721` (voicemail), `server/routes/calls.js:92-170` (`/log-by-phone`). Each re-implements phone normalisation inline (ignoring `helpers/phone.js`), contact lookup, conversation lookup and insert with different dedup windows. No `UNIQUE(twilio_call_sid)`, no `ON CONFLICT` — which is why `scripts/dedup-calls.js` exists; concurrent `/no-answer` + `/status` can double-insert, and a concurrent contact insert throws and silently drops the call.
**Fix:** `helpers/callLog.js` with `findOrCreateContact`, `findOrCreateConversation`, `recordCall` using `phoneVariants()` and `ON CONFLICT`; partial unique index on `calls(twilio_call_sid)`; thin webhook handlers.

**A2. Six independent SMS-send implementations** — High — M
`routes/messages.js`, `routes/conversations.js`, `routes/zohoWidget.js`, `jobs/scheduledSmsSweep.js`, `webhooks/sms.js` (after-hours), `webhooks/voice.js` (missed-call text). Each builds its own Twilio client, handles 21610, records consent, inserts, emits sockets. Quiet-hours gating exists only on `/messages/schedule`.
**Fix:** one `helpers/sendSms.js` that all six call; all compliance gating lives there.

**A3. Zoho sync via HTTP self-calls to localhost** — Medium — M
`helpers/syncCallToZoho.js:78-92`, `webhooks/sms.js:8-20`, `routes/messages.js:9-21`, `routes/calls.js:383-425`: the server calls its own `/api/zoho/*` with an `x-internal-token`. No timeout, errors swallowed, logic tied to HTTP.
**Fix:** move `zohoSync.js` handler bodies into `helpers/zohoOps.js`; call directly; delete `INTERNAL_TOKEN`.

**A4. Three oversized client components** — Medium — L
`SettingsTab.jsx` (1,968 lines, 60 `useState`), `ChatPanel.jsx` (1,210), `App.jsx` (914: Twilio Device lifecycle, call-end, unread tracking, sockets, routing). Settings sections are already separate functions in one file.
**Fix:** `components/settings/<Section>.jsx`; extract `useTwilioDevice()`, `useCallLifecycle()`, `useBreakpoint()` (8 duplicate `innerWidth>=900` listeners exist).

**A5. Huddle duplicates the Voice client shell** — Low — M
`huddle/src/{api,socket}.js`, `pages/Login.jsx` copies; `electron-huddle/afterPack.js` byte-identical to `electron/afterPack.js`. Every shared change (e.g. the planned server-address screen) is done twice. **Fix:** `packages/shared/` or at least `electron-common/`.

**A6. Hard-coded BTI URL in both desktop shells and mobile build scripts** — High (for selling) — M
`electron/main.js:30`, `electron-huddle/main.js:18`, `client/package.json` build scripts. Already planned as the 1.6.0 installer work.

### B. Correctness risks

**B1. Unassigning a number crashes** — Medium — S — `routes/agents.js:35-37` writes `null` into `phone_number NOT NULL DEFAULT 'TBD'` → 500 with the Postgres message. `tenant.js:365` does it right. **Fix:** write `'TBD'` now; later make the column nullable and kill the magic string (`messages.js:71`, `conversations.js:172`).

**B2. Messages from agents with no number are stored as sent, never delivered** — Medium — S — `routes/messages.js:68-74`, `routes/conversations.js:169-191`. **Fix:** 409 `sms_not_configured` like `/messages/schedule` already does (`:276-278`). (UI side: §6 F1.)

**B3. Process swallows `uncaughtException`; no graceful shutdown; sweep rows stuck in `sending`** — Medium — S — `index.js:115-120`; no SIGTERM/`pool.end()`; `jobs/scheduledSmsSweep.js:109-114` marks `sending` before the Twilio call, so a redeploy mid-send strands rows forever. **Fix:** exit(1) on uncaught (Railway restarts); SIGTERM drain; reclaim `sending` rows older than 5 min.

**B4. Realtime socket dies silently when the token rotates** — Medium — S — `client/src/socket.js:10-16` reads the token once; `App.jsx:260` refreshes it but never updates `socket.auth`; no `connect_error` handler. Matches gotcha #12 (stale tray-resident app). **Fix:** set `socket.auth` on `reconnect_attempt`; handle `connect_error` → refresh or logout.

**B5. Password change broken on iOS/Android** — Medium — S — `SettingsTab.jsx:212` uses a relative `fetch('/api/agents/me/password')` instead of `api.request`; Capacitor serves from `capacitor://localhost`. **Fix:** add `changePassword` to `api.js`.

**B6. Unhandled async errors hang requests** — Medium — S — `routes/conversations.js:278-297`, `routes/agents.js:9-24,70-78` have no try/catch; Express 4 doesn't catch rejected promises. **Fix:** `express-async-errors` or a `wrap()` helper → central handler.

**B7. Input validation is ad hoc** — Medium — M — `routes/ivr.js:18-62, 75-91` (free-form timezone/digit/destination, `VARCHAR(5)` overflow = 500), `routes/calls.js:38-56` (free-text `direction`/`status`), `routes/auth.js:11` (undefined username → TypeError). **Fix:** small `validate()` helper or `zod` on every `req.body`; whitelist enums.

**B8. ~80 routes return `e.message` to the client** — Medium — M — leaks table/column/constraint names, Twilio/Zoho details. `tenant.js` and `admin/` do it right. **Fix:** `respondError(res, e, label)` or `next(e)` to the existing central handler.

**B9. Migrations: unversioned, mixed `TIMESTAMP`/`TIMESTAMPTZ`, missing indexes** — Medium — M — `db.js:8-465`; no migrations table; `calls.started_at`/`messages.sent_at` are naive timestamps (DST risk in the wrap-up sweep and quiet hours); no indexes on `messages(conversation_id, sent_at)`, `calls(conversation_id)`, `conversations(contact_id)`, `calls(twilio_call_sid)`. **Fix:** `node-pg-migrate` or numbered `migrations/`; add indexes now while tables are small.

**B10. Unbounded list endpoints** — Low now / Medium at scale — `routes/conversations.js:13-67` (5 correlated subqueries per row, no LIMIT), `routes/calls.js` (hard LIMIT 100, no paging — history silently truncates), client refetches the whole list on every `conversation_updated`. **Fix:** cursor paging; emit the changed row in the socket payload.

**B11. Zoho client hard-codes the US accounts host; no refresh lock or timeouts** — Medium — S — `server/zoho.js:36-54`. EU/IN/AU customers would fail; concurrent first calls each refresh. **Fix:** derive from `ZOHO_API_DOMAIN`; memoise the refresh promise; `AbortSignal.timeout(15000)`.

**B12. `trust proxy: true` makes logged IPs spoofable** — Low — S — `index.js:17`, `helpers/logActivity.js`. Portal uses `trust proxy: 1` (correct). 

### C. Testing, CI, docs

**C1. No tests for anything touching HTTP, Twilio, Zoho or Postgres** — High — L
45 tests = pure helpers only. Zero for login/refresh/`requireAuth`, `/webhooks/voice/*` TwiML + dedup, `/webhooks/sms` opt-out + after-hours, `/messages/send` gating, wrap-up → Zoho, tenant lifecycle, migrations. **Fix:** `supertest` + throwaway Postgres; Twilio-signature fixture; mock `fetch` for Zoho. Priority order: auth, voice webhooks, sms webhook, messages/send.

**C2. No CI, no lint, no format** — Medium — M
No `.github/workflows`, no ESLint/Prettier. With a non-developer owner, CI is the only thing that catches a broken `vite build` before Railway deploys it. ESLint `react-hooks` would have caught the §8v toast-loop bug. **Fix:** one workflow: `npm ci` ×3, `node --check`, `npm test`, `vite build` client + huddle, `npm audit --audit-level=high`.

**C3. No root README; the system map is a 524-line session log** — High — S
A second developer has no 10-minute orientation. **Fix:** root `README.md` (services diagram, local run, test, deploy, env table → `server/.env.example`) and `docs/ARCHITECTURE.md` for the call-logging flow (webhook vs. frontend logging, dedup, wrap-up sweep) — the most confusing part of the codebase.

**C4. Behaviour lives in comments and the handoff, not in constants + tests** — Medium — L — wrap-up deferral rules, lifecycle states, dedup windows ("30 min" vs variables named "two minutes" in `routes/calls.js:107`). **Fix:** named constants + a test per rule.

### D. Dependencies & repo hygiene

**D1. `.gitignore:54` ignores every `package-lock.json`** — High — S — bare pattern intended for the root junk lockfile matches all of them; `admin/`, `huddle/`, `electron-huddle/` have none. Railway re-resolves `^` ranges on every build. **Fix:** `/package-lock.json`; commit lockfiles; `npm ci` in builds.

**D2. Vulnerable dependencies** — High — S — server lockfile: 12 (7 high: `ws`, `socket.io-parser`, `form-data`, `axios`, `qs`, `follow-redirects`, `ip-address` via `geoip-lite`); client: 14 incl. critical `tar`, high `ws`/`socket.io-parser`/`postcss`/`nanoid`. `ws`/`socket.io-parser` are reachable by any client that opens a socket. **Fix:** `npm audit fix` both; replace or pin `geoip-lite`.

**D3. Major-version-behind SDKs** — Medium — M — `twilio@4` (v5 current; `require('twilio')(sid, token)` inline in 10 places — centralise into `helpers/twilioClient.js` while upgrading), `openai@4`, `vite@5`, `@capacitor/*@6`. Unused: `node-fetch`, `form-data` in `server/package.json`.

**D4. Files that don't belong in the repo** — Low — S — `App-Audit-Handoff.md` (another product, contains a StatiCrypt password), `_claude-context/` (April snapshots), `docs/BTI-Voice-voicemail-review.csv` (16 real phone numbers + transcripts), `server/scripts/bti-notes-deletion-list.csv`, `server/scripts/fix-sms-urls.js` (hard-codes Rick's and Paul's numbers), `scripts/dedup-calls.js`, `server/migrate-agents.js`, root `.env.example` (stale; `server/.env.example` is the good one), `SETUP.md` (superseded by the runbook). Customer PII in a repo cloned onto more machines is a liability. **Fix:** delete; note what the one-off scripts did in the handoff.

**D5. Config/boot** — Medium — S — only `JWT_SECRET` is validated at boot; missing `SERVER_URL` silently breaks recording callbacks; boot banner prints `https://YOUR-DOMAIN/...` (`index.js:143-144`). Seed data (`server/seed.js:38-45`) creates real employee names with `username123` passwords if `SEED_DEMO` is ever mis-set on a customer deploy. **Fix:** `config.js` validating runbook §2's required vars; print real webhook URLs; refuse `SEED_DEMO` in production unless brand is BTI's.

**D6. Logging** — Low — M — 221 unstructured `console.*` calls with mixed prefixes/emoji; fine for one tenant, painful across N. **Fix:** `pino` with `{tenant, module}` later.

---

## 4. What's done well (keep these patterns)

- **`admin/` is the reference implementation:** DB-checked sessions, login throttle, JSON body limits, hardening headers, AES-256-GCM tenant keys with scrypt KDF + random IVs, timing-safe compares, generic errors, audit log on every mutation. Port these to the main server; don't rewrite the portal.
- Parameterised SQL everywhere; the only dynamic SQL builds column names from fixed whitelists.
- Twilio webhook signatures strict by default in production; TwiML in webhooks built with the Twilio helper (auto-escaped).
- Media access: 10-min `scope:'media'` tokens; full JWTs rejected in query strings; MMS content-type whitelist; `nosniff`.
- `/api/tenant/*`: `timingSafeEqual`, 404 when unconfigured, aggregates only, temp passwords force a change.
- Electron: `contextIsolation`, no `nodeIntegration`, popups denied, off-origin navigation to system browser.
- No `dangerouslySetInnerHTML` / data-bearing `innerHTML` in React, portal, widget or Electron banner.
- A2P/TCPA plumbing: opt-out on all send paths, append-only consent records, quiet-hours and auto-reply throttles; wrap-up sweep backoff + attempt cap.
- `helpers/deploySettings.js` and `helpers/phone.js` are right — the fix is to use them everywhere.
- `server/.env.example` and `docs/DEPLOY-RUNBOOK.md` are good operational docs.
- Dark/light theming exists, keypad is 44 px on touch, split views ≥900 px, Lists tab is well put together, toast system is real.

---

## 5. Security (defensive review)

### A. Critical / High

**A1. Live production `DATABASE_URL` (with password) in the current tree** — Critical — S
`docs/BTI-Voice-Session-Handoff-3.md:23`, `docs/archive/BTI-Voice-Session-Handoff.md:39` — the Railway *public* proxy URL. Anyone with repo read (any clone, laptop, context dump in `_claude-context/`) has full read/write to every message, transcript and password hash. **Fix:** rotate in Railway now; delete both lines; `git filter-repo` before the repo is cloned anywhere new; add a pre-commit secret scanner (gitleaks).

**A2. Other secrets in docs** — Medium — S — `docs/BTI-Voice-TODO.md:22` (Zoho Voice port-out account number + PIN — a port-out PIN lets someone slam the numbers to another carrier), `App-Audit-Handoff.md:34`, handoff §4 Twilio SIDs/campaign IDs, handoff + TODO confirming all team accounts use `username123` and listing usernames, `docs/BTI-Voice-Employee-Switch-Guide.md:46`. **Fix:** password manager; delete from docs.

**A3. No session revocation** — Critical — M
`server/auth.js` `requireAuth` only verifies the JWT; `routes/auth.js:60-64` `/refresh` re-mints from the token payload with no DB lookup; portal deactivate/reset (`routes/tenant.js:370-381`) never touches sessions. A deactivated employee's desktop app (token in `localStorage`, refreshed every launch) keeps reading all SMS/calls and sending as that agent indefinitely. **Fix:** cheap `SELECT is_active, token_version FROM agents` in `requireAuth` (30 s cache); bump `token_version` on deactivate / portal reset / self password change; `/auth/logout` bumps it. Compare `admin/auth.js:14-33`, which does this right.

**A4. No login brute-force protection on the customer app** — High — S
`routes/auth.js` — no throttle anywhere under `server/` (portal has 10 fails / 15 min at `admin/auth.js`). Predictable usernames + documented default passwords. **Fix:** port the portal throttle; `express-rate-limit` on `/api`; force a change when `default_password` is true instead of a dismissible banner; enforce min length in `PATCH /agents/me/password` (none today).

**A5. Authenticated TwiML injection + arbitrary call redirect** — High — S
`routes/calls.js:357` (`/resume`), `:376` (`/transfer`): `` `<Client>agent_${agentId}</Client>` `` from `req.body`, unvalidated; `callSid` ownership unchecked (`/hold` too). An agent can inject `</Client><Number>+1900…</Number>` to send a live PSTN leg anywhere, or hold/transfer another agent's call by SID. **Fix:** integer-validate + verify agent exists; build with `twilio.twiml.VoiceResponse`; verify the call belongs to the requester.

**A6. Server-side fetch of attacker-influenceable URLs with Twilio creds attached** — High — S
`routes/messages.js:215`, `routes/calls.js:277`, `webhooks/voice.js:755`: `MediaUrl0` / `RecordingUrl` from webhook bodies are stored verbatim and later fetched with `Basic SID:TOKEN`. If webhook validation is ever soft (`TWILIO_STRICT_WEBHOOKS=false`, token unset, non-production `NODE_ENV`), a forged POST exfiltrates the Twilio credentials. **Fix:** require `^https://api\.twilio\.com/` (+ account SID) before storing and before fetching.

**A7. Vulnerable dependencies** — High — S — see §3 D2.

### B. Medium

**B1. No roles — every agent is effectively admin** — High — L
`routes/ivr.js:18,149,176` (after-hours/auto-text copy, hours, number routing), `routes/agents.js:28` (reassign anyone's number — comment says "the app has no roles"), `routes/contacts.js:33` (consent CSV), `routes/diagnostics.js:55,73` (other users' device logs), `routes/conversations.js:259`, `routes/messages.js:320` (cancel anyone's scheduled SMS). **Fix:** `agents.role` + `requireAdmin`; bootstrap account is admin.

**B2. `ZOHO_WIDGET_KEY`: static bearer in a URL, shared by every CRM user, send-as-anyone** — Medium — M — `routes/zohoWidget.js:25-31` (accepts `?key=`), `:100-217` (SMS as any `agent_id`), `:226` (Voice tokens as any agent). **Fix:** header-only; per-request HMAC + timestamp or exchange for a short JWT; log the Zoho user id.

**B3. Stored XSS in `/admin/activity` via `/api/track`** — Medium — S — `routes/track.js:9-12` stores arbitrary `detail`; `routes/adminActivity.js:133-140` interpolates it unescaped into HTML, with `ADMIN_KEY` in the query string and a non-timing-safe compare. **Fix:** escape every field; whitelist events; key via header.

**B4. Socket.io accepts media-scope tokens and skips the lifecycle check** — Medium — S — `server/socket.js:223-232`. A leaked 10-min media token can `join_conversation` any room; suspended tenants keep realtime traffic. **Fix:** reject payloads without `id` or with `scope`; apply `loginAllowed()`.

**B5. Unauthenticated updater + unverified installer execution** — Medium — M — `routes/updates.js` (`/download-url` hands anyone a signed S3 URL for the private repo asset); `electron/main.js:553-606` runs the downloaded `.exe` with no hash check from a predictable temp path. **Fix:** auth on `/download-url`; publish SHA-256 (or electron-updater with signed `latest.yml`); verify before exec; random temp dir. Plan together with the 1.6.0 installer.

**B6. Error responses leak internals** — Medium — S — see §3 B8.

**B7. Unhandled async → hung requests** — Medium — S — see §3 B6.

**B8. No rate limiting, no helmet, wildcard CORS, unbounded diagnostics/track bodies** — Medium — S — `index.js:17-20`, `socket.js:218` (`origin: '*'`). Electron loads same-origin, so `*` is unnecessary. **Fix:** `helmet()`, `express-rate-limit` (tight on login/track/diagnostics), CORS = `SERVER_URL` + `capacitor://localhost` + `http://localhost`.

**B9. Portal posts the decrypted tenant key to any URL a portal user types, incl. `http:`** — Medium — S — `admin/routes/tenants.js:65,147-152`. **Fix:** require `https:`; deny private/loopback hosts; re-verify the key against the old URL before accepting a change.

**B10. CSV formula injection** — Medium — S — `routes/contacts.js:43-48`, `routes/callLists.js:313-318`. A contact named `=HYPERLINK(...)` executes in Excel. **Fix:** prefix cells starting with `= + - @ \t \r` with `'`.

### C. Low

- **C1.** `/api/features` (unauthenticated) exposes renewal/grace dates; `/api/zoho/status`/`/test` show any agent which env vars exist + a sample CRM contact. Strip/gate.
- **C2.** PII in Railway logs: phone numbers, event detail, note bodies (`voice.js:152,187`, `sms.js:156,205,212`, `track.js:11`, `diagnostics.js:258-263`). Mask numbers; drop bodies.
- **C3.** AI pipeline sends full transcripts to OpenAI (`voice.js:744-792`) with no documented retention/DPA stance or customer disclosure. Document in onboarding; default off for new tenants.
- **C4.** No backup/restore or offboarding procedure anywhere in docs; no tenant delete/export endpoint; recordings stay in Twilio indefinitely. Enable Railway backups and test a restore; write an offboarding script.
- **C5.** No graceful shutdown (see §3 B3). **C6.** Spoofable client IP (§3 B12). **C7.** `rejectUnauthorized: false` on Postgres TLS (`db.js:5`, `admin/db.js:4`) — fine on Railway's private network, a risk once the public proxy URL is in use. **C8.** Outbound dial has no destination policy (`voice.js:158-172`) — any agent can dial premium/international; add E.164 + per-tenant country allow-list in `deploy_settings`.

### Not verified
Live Railway env (`TWILIO_STRICT_WEBHOOKS`, `NODE_ENV`) — code defaults are correct but handoff §9 still lists "set strict" as pending. Whether the DB password has already been rotated — treat as live until confirmed. `npm audit` was run against lockfiles without installing; admin has no lockfile so wasn't audited.

---

## 6. UI/UX (product-designer lens)

**Grade vs. the brief: C.** The bones are right; there is no visual system, and several findings are trust bugs.

### What the receptionist sees on day one
*(fresh deploy, no Twilio — `docs/review-2026-10/01-empty-login.png`, `02-empty-dialpad.png`)*

She opens a 470-px window and gets a dark login card with a 📞 emoji logo and the placeholder **"e.g. shawn"**. She lands on the **Dialpad**: a grey disabled Call button, a tiny red dot top-right she'll never hover ("Voice: connection error"), a "Don't record this call" checkbox although recording isn't on, and "Calling from Dana Reyes" with no number. Six unlabelled bottom-nav icons — she has to guess which is Lists and which is Dialpad. Messages is a black void with "No conversations yet" at 1.8:1 contrast and a filter called "All Agents". She texts a customer; the modal says "no number yet" but lets her Send, and the bubble shows as **sent** — it was never delivered. Settings tells her "Not assigned — Contact admin to change" (she *is* the admin), there is no way to add a teammate, and About says "Created by Danny Roche · Business Technology Insight, LLC" with a Need Help link to BTI's site. Nothing says: *your number isn't connected yet, here's who to call.*

### Trust / correctness
**F1. Outbound SMS silently "sent" with nothing delivered** — High — S — `conversations.js:169-191`, `messages.js:71-74`, `ChatPanel.jsx:895-908`. **Fix:** 409 `sms_not_configured` + inline "Texting isn't set up for your number yet" in the composer (reuse the opted-out block); render non-`sent` bubbles with "Not delivered · Retry".

**F2. Conversation preview attributes the customer's words to an agent** — High — S — `ConvList.jsx:223-226` prefixes with `last_agent_name` (last agent *on the thread*), not the sender. Result: **"Dana: STOP"**, "Dana: Thank you! Also can I get the invoice…" (`03-sms-list-dana-stop.png`). **Fix:** select `last_message_direction` in `conversations.js:13-21`; prefix only outbound ("You:" / "Mike:").

**F3. Voicemail transcripts never shown; voicemails duplicated in Logs as answered calls** — High — S — `calls.js:200-215` doesn't select the transcript; `CallsTab.jsx:538-600` shows name/time/duration only. **Fix:** add transcript to the API + 2-line clamp; give `status='voicemail'` its own label in Logs.

**F4. Voice-unavailable state is a 7-px dot** — High — S — `TitleBar.jsx:152-170`, `DialpadTab.jsx:325-327`. Day one and every Wi-Fi blip look identical. **Fix:** status strip under the title bar ("Phone line not connected · Retry / Get help") using the renewal-banner component; reason under the disabled Call button.

**F5. Wrap-up outcomes are Talkingvet sales dispositions** — High — S — `PostCallScreen.jsx:23-31` ("Demo scheduled", "Existing customer — support"), `:331` "Account / Hospital", `CallListsTab.jsx:16-20`; shown after *every* connected call ≥15 s (`App.jsx:582`). **Fix:** per-deploy dispositions setting (seed "Booked job / Quote requested / Question answered / Callback / Wrong number / Other"); make wrap-up opt-in per deploy or list-calls only.

**F6. Login wordmark ignores `VITE_BRAND_NAME`; "e.g. shawn"** — High — S — `pages/Login.jsx:51,57`. **Fix:** `{BRAND}` + a `COMPANY_NAME` line; placeholder "Username".

**F7. BTI identity leaks into customer deploys** — High — S — `SettingsTab.jsx:1850-1859` (Danny credit, BTI Need Help link), `CallListsTab.jsx:425` ("Florida vets — no PIMS"), `CallsTab.jsx:503`, splash logo hard-coded "B" (`App.jsx:663`). **Fix:** `SUPPORT_URL`/`SUPPORT_NAME` env, optional `BRAND_LOGO_URL`; strip personal credits.

**F8. No way to add a teammate; "Contact admin" shown to the admin** — High — M — `SettingsTab.jsx:240, 294-349`; runbook §4.1 confirms users are created by SQL. **Fix:** "Add teammate" (name, username, temp password, number) via the existing `must_change_password` flow. (Pairs with roles, §5 B1.)

### Layout breakage
**F9. New-message FAB covers the Send button in split view** — High — S — `App.jsx:902-909` vs `ChatPanel.jsx:1187` (`04-wide-fab-covers-send.png`). **Fix:** hide the FAB when a thread is open (`App.jsx:838` only checks `smsOpenChat`, forced false ≥900 px), or move "New" into the list header.

**F10. Thread header collapses to "+12…" on phone and to nothing at 330 px** — High — S — `ChatPanel.jsx:361-485` (back + name + Messages/Notes + assign + call in one row); raw E.164 shown twice (`:390,:403`). **Fix:** name first with `flex:1; minWidth:0`; Messages/Notes into ⋯ below 480 px; `formatPhone`.

**F11. Calls filter chips overflow on phone** — Med — S — `CallsTab.jsx:629-630`. `overflowX:auto; flexShrink:0`.

**F12. Phone-pattern bottom nav on a 1280-px desktop** — Med — M — six icon-only tabs 213 px wide each. A dead `NavSidebar.jsx` (left rail with labels) already exists. **Fix:** left rail ≥900 px (OpenPhone/Dialpad convention); bottom bar with labels below.

**F13. Settings content stretches to 1280 px** — Med — S — `SettingsTab.jsx:1933-1935`; `maxWidth: 640`.

### Visual system
**F14. No tokens** — High — S to start, L to finish — 81 hex + 82 rgba, 23 font sizes (7.5–40 px), 19 radii, per-file `S` objects in 21 files. Six blues coexist (`#4f9cf9` ×95, `#3b82f6` ×20, `#1d4ed8`, `#2563eb`, `#0ea5e9`, `#60a5fa`). `huddle/src/styles.css:1-18` already defines the right CSS variables — Voice doesn't use them. See §7.

**F15. 106 emoji/Unicode glyphs as icons** — Med — M — `SettingsTab.jsx` 43 (tab strip 👤🔊🎨📞ℹ️ renders monochrome under colour overrides), `CallsTab.jsx` 17, `ChatPanel.jsx` 12, 📞 as call avatar, favicon is an emoji SVG. Renders differently per OS, can't be tinted. **Fix:** `ui/Icon.jsx` with the ~25 Lucide paths already inlined.

**F16. Contrast failures** — High — S — measured: `emptyText` 1.76:1, `textMuted` 2.53:1 (dark) / 2.55:1 (light), white on `#4f9cf9` buttons 2.82:1, white on `#22c55e` Answer/Call 2.28:1, white on `#10b981` agent bubble 2.54:1 (`useColors.js:25,42`). **Fix tokens:** muted `#8a94a6` dark / `#5f6b7d` light; primary `#2f7df6`; green `#16a34a`.

**F17. Micro type** — Med — S — 40 uses of 10 px, 11 of 9 px, 4 of 8 px, 1 of 7.5 px; body is 12–13 px (OpenPhone rows are 14/13). Nothing under 11 px except badges.

**F18. Bottom nav has no labels** — Med — S — `BottomNav.jsx:32-45`. 11-px labels, 56-px bar.

**F19. Active-call screen ignores theme, loses the contact name, spinner keyframe undefined** — Med — S — `ActiveCallPanel.jsx:404-408` hard-coded navy; `App.jsx:614,771,799` null the name so a saved contact shows as raw E.164; `:396` animates `spin` which doesn't exist (`btiSpin` does); hold/transfer failures only `console.error`.

**F20–F22.** Status pill → bare dot <400 px (`TitleBar.jsx:51`); renewal/password banners stack and push content with no dismiss (`App.jsx:694-735`); **three products, three design languages** (Voice bottom nav/system font/`#4f9cf9`; Huddle left rail/Lato; Admin 260-px sidebar/Lato 17 px/cyan `#3fc1e3`) plus the Zoho widget and Electron banner HTML as 4th/5th styling islands.

### States & flows
**F23. Empty states are one line of 1.8:1 grey** — Med — S — none has an action or explains setup. `ui/EmptyState`: "Send your first text", "Calls will appear here once your number is connected → Check setup".
**F24. Destructive actions without confirmation, or via `window.confirm`/`alert`** — Med — S — no confirm on delete note / quick-dial / IVR option / routing rule; `window.confirm` ×3 in `CallListsTab.jsx`, `alert` ×3. One `ui/ConfirmDialog`.
**F25. Toasts: no dismiss, no `aria-live`, raw backend strings** ("Send failed: Twilio Voice not yet configured") — Low — S.
**F26. Opening the Voicemails tab marks ALL voicemails played** — Med — S — `CallsTab.jsx:178-185`; mark on actual play.
**F27. Wrap-up and New-message are bottom-right popovers, not dialogs; no focus trap/Esc on New Message** — Low — S — `ui/Dialog` (centred ≥900, bottom sheet on touch).
**F28.** Duplicate raw numbers and numeric date headers in Calls (`CallsTab.jsx:414,446,120`; ChatPanel already does "Today/Yesterday"). **F29.** `body { user-select:none }` with the `.selectable` exceptions never applied — nobody can copy a phone number or gate code from a bubble (`index.css:16,56`).

### Forms & accessibility
**F30. No `<label for>`, 4 `aria-label`s total, 70+ icon buttons rely on `title`, list rows are click-divs, `outline:none` ×20 with no `:focus-visible`** — High — M. `ui/Button`/`IconButton` with mandatory label; rows become `<button>`; global focus ring.
**F31. Touch targets under 44 px despite the 1.18 zoom** (bell 35×33, window buttons, voicemail play 31 px); the zoom also divides `100dvh` and safe-area insets — `index.css:41-50` calls itself "a broad first pass". **Fix:** token-level `@media (pointer:coarse)` overrides instead of `zoom`.
**F32.** Login: no `autocomplete`, no show-password. **F33.** Dialpad hijacks global keydown/paste while mounted (`DialpadTab.jsx:98-137`).

### Copy
**F34. Mixed vocabulary** — Med — S — Agents/Team/users; Logs/Calls/Recent; Messages/Chat/SMS/Text; Phone Tree/IVR; "Twilio number" and "Amazon Polly Neural" in customer-facing tooltips. **Glossary:** *Teammate* (never agent), *Calls* (never Logs), *Messages*, *Phone menu*, *Favorites* (quick dial), *Follow-up* (wrap-up).

### Performance
**F35.** 637 kB JS (176 kB gzip) in one chunk; Twilio Voice SDK eagerly loaded for every user; 4 Google Font families fetched on every launch (blocked offline, FOUT). Lazy-import the SDK; self-host one family; `manualChunks`. **F36.** `App.jsx` God component; every `conversation_updated` refetches the whole list; 50 stale bundles in `server/public/assets` (23 MB, no `emptyOutDir`); dead files `NavSidebar.jsx`, `NotificationsTab.jsx`, `CallModal.jsx`. **F37.** Light-only hex values leak into dark mode (`ChatPanel.jsx:1170`, `ConvList.jsx:293`, `Login.jsx:113`) — disappears with tokens.

---

## 7. Proposed minimal design system + migration

`client/src/ui/tokens.css`, imported once from `index.css`; same names mirrored into `huddle/src/styles.css` (already has most) and `admin/public/style.css`.

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px; --fs-xl: 18px; --fs-2xl: 28px;
  --lh-tight: 1.25; --lh-body: 1.45;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;
  --row-h: 44px; --bar-h: 40px; --nav-h: 56px;
  --r-sm: 6px; --r-md: 10px; --r-lg: 14px; --r-pill: 999px;
  --shadow-1: 0 1px 2px rgba(0,0,0,.25); --shadow-2: 0 8px 24px rgba(0,0,0,.35);
  --primary: #2f7df6; --primary-hover: #2667d1; --primary-soft: rgba(47,125,246,.14); --on-primary: #fff;
  --bg: #161b24; --panel: #1d2330; --surface: #252d3c; --surface-2: #2d3647;
  --border: rgba(255,255,255,.08); --border-strong: rgba(255,255,255,.14);
  --text: #e8edf5; --text-2: #a3adbf; --text-3: #7d8799; --text-disabled: rgba(232,237,245,.38);
  --success: #22c55e; --success-ink: #0f2e1a; --warning: #f59e0b; --warning-ink: #2b1d05;
  --danger: #ef4444; --danger-ink: #fff; --info: var(--primary); --focus: #8ab8ff;
}
:root[data-theme="light"] {
  --bg: #f4f6f9; --panel: #fff; --surface: #eef2f7; --surface-2: #e3e9f2;
  --border: #dde3ee; --border-strong: #c9d2e0;
  --text: #1e293b; --text-2: #4b5a72; --text-3: #5f6b7d; --text-disabled: rgba(30,41,59,.38);
  --primary-soft: rgba(47,125,246,.10);
  --shadow-1: 0 1px 2px rgba(20,30,50,.08); --shadow-2: 0 8px 24px rgba(20,30,50,.14);
}
@media (pointer: coarse) {
  :root { --fs-sm: 13px; --fs-md: 15px; --fs-lg: 17px; --row-h: 52px; --nav-h: 64px; }
}
```

**Primitives (`client/src/ui/`, ~40 lines each):** `Button` (primary/secondary/ghost/danger, `loading`), `IconButton` (requires `label`), `Icon` (Lucide paths), `Input`/`Textarea`/`Select` (with `<label htmlFor>`), `ListRow` (`<button>` semantics), `SegmentedControl`, `Chip`, `Badge`, `Banner`, `EmptyState`, `Dialog`/`Sheet` (focus trap, Esc, bottom sheet on touch), `Toast` (add `aria-live` + ×), `Avatar`, `SectionHeader`.

**Migration — one tab per session, each shippable, no big-bang:**
0. Add `tokens.css`; make `useColors()` return `var(--…)` strings so every existing `C.panel` consumer switches with zero JSX edits; drop the `zoom` hack; add `:focus-visible`.
1. Chrome: `TitleBar`, `BottomNav` (labels), `Banner` (renewal + password + voice-offline), `Toast`; left rail ≥900 px by reviving `NavSidebar`.
2. Messages: `ConvList` → `ListRow`; F1/F2; header overflow; composer states.
3. Calls + Voicemail: transcripts, played-on-play, date headers, chips.
4. Dialpad + in-call + wrap-up: themed `ActiveCallPanel`, contact lookup, configurable outcomes, `Dialog`.
5. Contacts + Lists: `ListRow`, `EmptyState`, `ConfirmDialog`.
6. Settings: `max-width`, real icons, "Add teammate", copy pass (glossary).
7. Port tokens into Huddle and Admin; delete the now-empty per-file `S` objects. Lint rule banning new hex in `.jsx` once a file is migrated.

### Top 10 UI quick wins (S each, visible immediately)
1. Preview-prefix attribution (`ConvList.jsx:223`, `conversations.js:13-21`).
2. Reject/flag undeliverable SMS + "not delivered" bubble.
3. Labels on the bottom nav + 56-px bar.
4. Voice-offline banner replacing the 7-px dot, reason under the Call button.
5. Hide the FAB when a thread is open in split view.
6. Brand/placeholder/credits sweep (`Login.jsx`, `SettingsTab.jsx:1850-1859`, `CallListsTab.jsx:425`, `PostCallScreen.jsx:23-31,331`, `App.jsx:663`).
7. Contrast tokens for muted text and filled buttons.
8. Voicemails: show transcript, mark played on play.
9. Thread header overflow <480 px.
10. `emptyOutDir: true` + lazy-load the Twilio SDK + self-host one font.

---

## 8. Screenshots & artefacts
- `docs/review-2026-10/` — the 8 screenshots cited above (fictional seeded data, no customer PII).
- Full set (187 PNGs), seed SQL, Playwright tour scripts and the harness used to render the in-call/incoming/toast states live in the review workspace, not the repo; ask to re-run any screen after a fix batch.
- Console errors across every viewport: only the expected `401 /api/auth/me` pre-login probe and `503 POST /api/calls/token` (Twilio not configured) → `[Twilio init] Error` in `App.jsx:191`, which is what latches the red dot (F4). No React warnings, no uncaught exceptions.
