# BTI Voice — Master Handoff (updated 2026-08-19)

**Purpose:** Single source of truth to continue BTI Voice work from ANY device or project (Mac, Windows, or a fresh Claude session). Point a new session at this file first.
**Private:** This file contains secrets (DB URL, IDs). Keep it out of public places; prefer emailing it to yourself or committing to the private repo only.

Companion docs in the same folder:
- `BTI-Voice-TODO.md` — running checklist of what's left to do.
- `BTI-Voice-Preprod-Audit.md` — full pre-production security/bug audit + what each fix did.
- `BTI-Voice-macOS-UI-Review.md` — 16-item UI review.

---

## 1. What BTI Voice is
Internal VOIP/SMS desktop app. Electron shell + React client (served from Railway), Node/Express + Postgres backend on Railway, Twilio for calls/SMS, Zoho CRM deeply integrated, OpenAI for transcription/summaries. Built by Danny at Business Technology Insight. Used by BTI/Talkingvet staff to talk to leads/prospects/customers. Talkingvet sells AI scribing TO veterinarians — it is NOT a vet clinic. BTI Voice is internal-only, not a product.

Key fact about architecture: **the desktop app loads the client UI from Railway at runtime** (`main.js` does `loadURL('https://bti-voice-production.up.railway.app')`). So client + server fixes go live on a git push; a new installer/DMG is only needed for Electron-shell (main.js / preload / build config) changes.

## 2. Locations & access
- **Repo:** https://github.com/Talkingvet/bti-voice (PRIVATE). Railway auto-deploys on push to main.
- **Live server / web app:** https://bti-voice-production.up.railway.app (works in any browser too).
- **Mac repo:** `~/Documents/Claude/Projects/BTI Voice/bti-voice` (git clone). Old July copy kept beside it as `bti-voice-old` (safe to delete). Build output goes to sibling `~/Documents/Claude/Projects/BTI Voice/dist-electron/`.
- **Windows desktop repo:** `C:\Users\Doero\OneDrive\Documents\Claude\Projects\Talkingvet Help\bti-voice`. ⚠ The `OneDrive` in that path is a **leftover folder name — OneDrive is NOT running and nothing syncs.** See §8k. **Windows laptop repo:** `C:\Dev\bti-voice`.
- **External DB access** (scripts/direct fixes): `postgresql://postgres:EpfANoVcBduEofAFrNFZmvOhAotreUuV@maglev.proxy.rlwy.net:19870/railway` (Railway public proxy; internal URL only works inside Railway).
- **Railway env vars of note:** `JWT_SECRET` (set — keep it), `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `LATEST_VERSION` (drives update prompts), `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`, `OPENAI_API_KEY`, `ENABLE_RECORDING`, `SERVER_URL`. NEW optional: `TWILIO_STRICT_WEBHOOKS` (set to `true` to enforce webhook signatures), `ADMIN_KEY`.
- **Current version:** v1.5.0 — **fully released on both platforms as of 2026-08-13.** Mac DMGs (signed+notarized) and `BTI-Voice-Setup-1.5.0.exe` (86.94 MiB) are all attached to the v1.5.0 GitHub release, and Railway `LATEST_VERSION=1.5.0`.
- **Latest commit on main:** `0816440` (2026-08-14 feature batch: Zoho SMS widget, per-agent caller ID, click-to-call, BTI_Voice module rerouting) — **pushed and live on Railway as of 2026-08-14 ~1pm.** `ZOHO_WIDGET_KEY` is set in Railway and matches the Zoho widget registration. Widget "BTI Voice SMS" registered (Type Related List, External) and live in a dedicated **BTI Voice SMS** Canvas tab on Contacts — verified working on Danny Test. See §8e for the Zoho registration gotchas (module attach via standard view, floating-widget fallback, + tab nesting). Remaining: Leads attach, desktop-app verifications (caller ID, icons), Notes migration — see TODO "Go-live status".

## 3. Logins / accounts (BTI Voice agents)
From the live DB (2026-08-12). Default password for every seeded account is `username + 123` (e.g. `danny123`) — **all are still on the default; everyone should change theirs in Settings → Profile → Change Password before wider rollout.**

| id | username | name | phone | active |
|----|----------|------|-------|--------|
| 1 | shawn | Shawn Stright | none (TBD) | yes |
| 2 | danny | Danny Roche | +12396667033 (test #) | yes |
| 3 | raven | Raven | none | **no** (retired dup of rick) |
| 4 | rick | Rick Almendras | none | yes |
| 5 | paul | Paul Messino | none | yes |
| 6 | warren | Warren Anderson | none | yes |
| 7 | ryan | Ryan | none | yes (added 2026-08-12, pw `ryan123`) |

Only **danny** has a Twilio number, so only danny can actually send/receive from a number. Others can log in and view, but sends silently skip Twilio until they get a number. There is no UI to assign numbers yet — use `PATCH /api/agents/me/number` (as that agent) or a direct DB update. To add an agent: INSERT into `agents (name, username, password_hash, color, initials, is_active)` with a bcryptjs hash (that's how ryan was added).

## 4. Telephony / A2P status
- **A2P 10DLC: APPROVED 2026-08-10.** Campaign `CMfd0e9fce40b23947271a9a25913af389`, Brand `BN640d79e8132a73b58d9bfc2224bfde54`, Messaging Service `MG72b937a8bdfdb4948e7ce808774b3765` (Low Volume Mixed, ~200 msg/day/number).
- Twilio has ONLY the test number **+12396667033** (assigned to danny). Real numbers live in Zoho Voice; they'll be PORTED later, only after extensive testing proves BTI Voice out.
- Two dead duplicate messaging services in the Twilio console (MGb736…, MGd6ec…) — harmless leftovers; delete when tidying.
- Editing the A2P campaign costs ~$15 vetting + days of wait — only when necessary. Keep Privacy Policy §12 (SMS) intact on talkingvet.com.

## 5. v1.5.0 feature set (all deployed)
Messaging-Service routing on all 3 send sites; STOP/START opt-out (contacts.opted_out, keyword handling, 403 blocks, error-21610 mirroring, red banner in ChatPanel); canned-response templates (type `/` in compose, or the New Message modal); after-hours SMS auto-responder (Settings→Calls; business hours/days/timezone; 4h throttle); scheduled SMS (clock button, 30s sweep, cancel chips) — now also in the New Message modal; MMS (paperclip, 5MB images, inbound capture) — now also in the New Message modal.

## 6. How to build & deploy
- **Server + client changes → deploy by pushing:** `cd bti-voice && git push origin main`. Railway auto-deploys server + client in ~2 min. No installer needed.
- **Mac Electron build (signed + notarized):** `cd "~/Documents/Claude/Projects/BTI Voice/bti-voice/electron" && bash build-mac.sh`. ~10–15 min (the notarize step uploads to Apple and waits). Outputs both-arch DMGs to sibling `dist-electron/`: `BTI Voice-1.5.0-arm64.dmg` (~73MB, Apple Silicon) + `-x64.dmg` (~85MB, Intel). Must run on the Mac (sandbox is Linux, can't build/notarize Mac binaries). For GitHub upload make dash-named copies natively on the Mac (spaces mangle): `cp "BTI Voice-1.5.0-arm64.dmg" "BTI-Voice-1.5.0-arm64.dmg"` etc. — do NOT copy large DMGs through Claude's mounted folder, it deadlocks; run cp in Mac Terminal.
- **Windows Electron build:** Git Bash only (PowerShell blocks npm scripts). `cd electron && npm run build:win` → `../dist-electron/`; rename `BTI Voice Setup X.X.X.exe` → `BTI-Voice-Setup-X.X.X.exe`; upload to GitHub release; update Railway `LATEST_VERSION`.
- **GitHub release:** v1.5.0 tag + release already exist (do NOT recreate the tag). Mac DMGs (small signed ones) go on the release; Danny still needs to add the Windows `.exe`.

## 7. Mac code signing — WORKING (set up 2026-08-12)
- Developer ID Application cert under company team **Business Technology Insight, LLC**, Team ID **U2Z95CX43X**, private key in Paul's Mac keychain (Paul is Admin on the Apple dev account, Apple ID dannyr927@outlook.com).
- Notarization creds stored as keychain profile **bti-voice-notary** (`xcrun notarytool store-credentials`).
- `build-mac.sh` auto-detects the cert and notarizes. **Recipe fix that made notarization pass:** sign every nested Mach-O **inside-out** (deepest first), then helper apps (with entitlements), then frameworks, then the outer app. `codesign --deep` alone left libffmpeg.dylib + Squirrel ShipIt unsigned → Apple marked the DMG Invalid. Fixed and committed.
- To debug a failed notarization: `xcrun notarytool log <submission-id> --keychain-profile bti-voice-notary`.
- Minor cleanup: an app-specific password leaked into Terminal history during setup — optionally revoke it at appleid.apple.com and re-run store-credentials.

## 8. 2026-08-12 session — what happened (all deployed, commit e7b4095 on main)
1. **Fresh Mac clone** of latest main; bumped electron/package.json to 1.5.0 (Danny's Windows bump was never pushed) — committed + pushed (b6cf6b2), `v1.5.0` tag pushed.
2. **UI review** (BTI-Voice-macOS-UI-Review.md) + quick-win fixes shipped (1f44e83): Automated label on auto-replies, 520px bubble cap, shared `client/src/utils/phone.js` formatting, "#" avatars for unnamed contacts, FAB hidden on Settings/Notifications, `/` hint in placeholder.
3. **New Message modal** got MMS + scheduled send (044d8fd); new `POST /conversations/ensure` endpoint. Limits: no scheduled+MMS combo; media/scheduled sends always go as the signed-in agent.
4. **Duplicate-contact fix**: typing a number without +1 created a second contact and split the conversation. Added `server/helpers/phone.js phoneVariants()`; merged Kendall's split directly in DB.
5. **Full pre-prod audit** (3 parallel deep dives) → BTI-Voice-Preprod-Audit.md. Fixed all criticals + highs that were safe to do blind, in 4 batches:
   - **A (security):** auth on /api/zoho/* (internal self-calls use a per-process token) + socket.io JWT handshake; Twilio webhook signature validation (soft mode); removed hardcoded JWT/admin secret defaults (new `secret.js`); MMS content-type allow-list + nosniff; central error handler + process crash guards.
   - **B (compliance):** opt-out matches every phone format on webhook/sweep/auto-text; missed-call auto-text throttled 1/4h (new contacts.last_auto_text_at); scheduled sends blocked outside 8am–9pm; spoken recording disclosure before recorded dials.
   - **C (client):** fixed socket.off() leaks (badges kept dying), rejoin room on reconnect, failed send keeps text, dedupe message appends, dark-mode now themes the whole window, bell badge fixed (was "63"), Escape closes status dropdown, logout disconnects socket.
   - **D (Electron):** banner Accept/Decline actually work now + dismiss properly; updater is Windows-only (Mac no longer downloads a .exe); nav/window-open guards; mic permission scoped to app origin; offline retry page; crash handlers; mac mic usage strings.
6. **Mac signing + notarization** set up and working; DMGs rebuilt small (~73/85MB) and Apple-Accepted.
7. **Deployed:** pushed to main; Railway live. JWT_SECRET already existed (kept, no forced re-login). Verified in prod: /api/zoho/status → 401, /api/agents → 401, unknown /api → JSON 404. App restarted: socket auth OK, bell sane, dark mode switches.
8. Added agent **ryan** (pw ryan123).

## 8b. 2026-08-13 session (Windows) — what happened

**1. Windows repo synced.** The Windows clone was stranded on `dc480da` with a stale `origin/main` ref — `git status` claimed "up to date" because it hadn't fetched since July. `git fetch origin` pulled 103 objects and the `v1.5.0` tag; the local `electron/package.json` edit was discarded (`git checkout --`) and main fast-forwarded to `e7b4095`.

**2. Windows installer 1.5.0 built and released.** `npm run build:win` produced a 91 MB exe, renamed to `BTI-Voice-Setup-1.5.0.exe`. **Note:** a stale `BTI-Voice-Setup-1.5.0.exe` dated Aug 11 (99.5 MB) was already sitting in `dist-electron/` — that was the *pre-audit* build under the same version number. It was overwritten, and it had never been uploaded anywhere, so nothing bad escaped.

**3. GitHub CLI installed** (`winget install --id GitHub.cli`) and the exe + blockmap uploaded with `gh release upload v1.5.0 … --clobber`. Release now carries both DMGs plus the Windows exe.

**4. Railway `LATEST_VERSION` was still `1.4.0`** — nobody was being offered the update. Bumped to 1.5.0 and verified: `/api/updates/latest` returns 1.5.0 and `/api/updates/download-url` resolves to `BTI-Voice-Setup-1.5.0.exe`. Railway's `GH_TOKEN` is healthy (it must be — the repo is private and the updater uses it to resolve release assets).

**5. Installed build verified on Windows:** dark mode themes the whole window, bell badge sane, unnamed contacts show "#", real-time SMS arrives without refresh (socket JWT handshake OK), `/` opens canned responses.

**6. Voicemail "unknown" bug found and fixed** (commit `52abfc0`) — see section 8c, it was bigger than it looked.

## 8c. The voicemail bug (fixed 2026-08-13) — worth understanding

**Symptom:** the call log was full of entries reading `unknown` with no phone number.

**Root cause, part 1:** Twilio's `recordingStatusCallback` payload contains ONLY recording fields (`CallSid`, `RecordingSid`, `RecordingUrl`, `RecordingDuration`…). **It never includes `From`/`To`.** The handler did `const phone = From || 'unknown'`, so `From` was always undefined and every recording was filed against one junk contact (id 7, `phone_number='unknown'`).

**Root cause, part 2 (the worse one):** the lookup was

```sql
WHERE ca.twilio_call_sid = $1 OR ca.status = 'voicemail'
ORDER BY ca.started_at DESC LIMIT 1
```

The `OR` matched *any* historical voicemail, so it almost never found the right row, and because the row it did find had status `voicemail`, the code took the "create new" branch. Result: **recordings of ordinary agent-placed calls were inserted as phantom voicemail rows.** 34 of the 35 rows on the junk contact were not voicemails at all — Twilio showed them as `from=client:agent_N, to=(empty), dir=inbound`, i.e. the parent leg of an outbound call.

**The fixes (all in `server/webhooks/voice.js`):**
- The voicemail TwiML path now appends `?vm=1&from=<caller>` to the callback URL — the caller number is captured at `ivr-gather` time, where `req.body.From` *is* present.
- `/recording-complete` reads `req.query.from`, and falls back to a Twilio REST `calls(CallSid).fetch()` if that's missing.
- The lookup matches `twilio_call_sid` ONLY.
- Only `vm=1` callbacks may create a voicemail row. A non-voicemail recording with no matching call row waits 5s, retries once, then gives up rather than fabricating a voicemail.
- Created voicemail rows now store `twilio_call_sid` (they never did before — that's why nothing could dedupe).

**Data repair** (`server/scripts/merge-orphaned-voicemails.py`, already run): for each junk row, real calls within −4min/+90s were found. 16 had exactly one unambiguous match — the recording, transcript, summary and true duration were merged onto the real call row (which had no recording and `duration = 0`) and the duplicate deleted. Call 9 was a genuine inbound voicemail from +12395959310 and was re-filed. **18 rows remain** on the junk contact, now renamed **'Unknown caller'**; they're listed in `BTI-Voice-voicemail-review.csv`. In most of those the candidates all share the same phone number, so the contact is unambiguous even though the exact call row isn't — a looser rule could finish them.

## 8d. 2026-08-14 session (Windows) — the feature batch (commit `0816440`, NOT pushed yet)

All 5 "NEXT SESSION" items from the TODO were written in one commit on the Windows clone. Code is syntax-checked (`node --check` on every server file) and the client passes a full `vite build`. **Nothing is live until Danny pushes.**

**1. Zoho SMS conversation widget.** `server/zoho-widget/sms.html` (single self-contained page: chat bubbles, agent-colored "send as" picker, opt-out banner, 10s polling, Enter-to-send) + `server/routes/zohoWidget.js` with three endpoints: `GET /api/zoho-widget/thread?phone=`, `POST /api/zoho-widget/send {phone, body, agent_id}`, `GET /api/zoho-widget/agents` (picker data; `can_send` = has a `+` number). Design notes:
- Auth is the `ZOHO_WIDGET_KEY` env var, timing-safe-compared against the `x-widget-key` header. The widget reads the key from **its own URL query string** — Danny registers the widget with Base URL `…/sms.html?key=<value>`, so the secret exists only inside the Zoho widget registration, never in the publicly-fetchable HTML.
- The page could NOT go in `server/public/` (the TODO's original suggestion) — that dir is **gitignored Vite build output** and gets wiped every build. It lives in tracked `server/zoho-widget/`, static-mounted at `/zoho-widget` in index.js.
- Sends reuse the exact messages.js pipeline (opted_out 403, error-21610 mirroring, Messaging Service routing, conversation_agents, socket broadcast, Zoho digest sync) so widget sends are indistinguishable from app sends.
- Dev fallback: `sms.html?key=…&phone=+1…` works in a plain browser without the Zoho SDK.

**2. Per-agent outbound caller ID.** `/webhooks/voice/outbound` parses `client:agent_N` from the client leg's `From`, looks up that agent's `phone_number`, uses it as callerId when it starts with `+`; env `TWILIO_PHONE_NUMBER` fallback on no match/error. Rick and Paul's calls will now show their own numbers.

**3. Click-to-call/message.** App.jsx gained `dialTo(number)` (sets `autoDialNumber`, switches to DialpadTab; a new effect there auto-connects when the device is free — if a call is in progress it waits for idle) and `messageTo(number)` (POST `/conversations/ensure` → deep-link via existing `navConvId`). Every CallsTab row is now expandable; the expanded area leads with 📞 Call / 💬 Message buttons (recording/summary/transcript below when present). ContactDetail's hero got the same two buttons. `startCall()` in DialpadTab now accepts an optional explicit number (the onClick event-object case is type-guarded).

**4. BTI_Voice module rerouting.** New `server/helpers/btiVoiceModule.js` — upserts via `POST /crm/v2/BTI_Voice/upsert` with `duplicate_check_fields: ['BTI_Ref']`. Field API names were verified against the live module via the Zoho MCP (Type, Direction, Agent, Phone_Number, Activity_Time, Duration, Recording_URL, Transcript, AI_Summary, Message_Log, Contact, Lead, BTI_Ref, Name).
- **SMS:** `/api/zoho/log-sms` now upserts a daily digest (`BTI_Ref = sms-YYYY-MM-DD-<phone>`, day boundary in the ivr_settings business timezone). The whole day is **rebuilt from Postgres on every message** — idempotent and self-healing, no append-parsing. Lines look like `[3:12 PM] → Danny: text` / `[3:14 PM] ← Kendall: reply`; textarea capped at 30k keeping the tail.
- **Calls:** `/api/zoho/log-call` additionally upserts `call-<id>` (Direction picklist: Inbound/Outbound/Missed/Voicemail) after the native Calls record (which is kept). New `POST /api/zoho/update-call-record {call_id}` re-reads the row (picks up wrap-up's chosen contact) and upserts Recording_URL/Transcript/AI_Summary — `recording-complete` in voice.js now calls this instead of add-note. Upsert-on-BTI_Ref makes the create/enrich order irrelevant.
- Wrap-up **agent** notes intentionally still go to /Notes (human-authored, not machine logging). `add-note` endpoint unchanged.

**5. Migration script** `server/scripts/migrate-notes-to-bti-voice.js`: `--sync` rebuilds every historical digest day + call record straight **from Postgres** (no fragile note parsing) with a phone→Zoho-record cache and 250ms rate-limit sleeps; `--list-notes` scans /Notes for BTI-created ones (`SMS: …` + "Logged by BTI Voice", `Call Summary…`) into `bti-notes-deletion-list.csv`; `--delete` removes the CSV's notes after Danny approves. Needs `DATABASE_URL` + `ZOHO_*` env (e.g. `railway run`).

**Commit mechanics gotcha (⚠ CAUSE CORRECTED — see §8k):** the sandbox couldn't unlink `.git/index.lock`. This was blamed on OneDrive at the time; it is actually Claude's FUSE mount, which cannot delete files at all. Workaround: `GIT_INDEX_FILE=/tmp/bti.index`, copy the index out, `git add -A && git commit`, copy back. Side effect: stale `.git/index.lock` + `.git/HEAD.lock` and `tmp_obj_*` files remain — Danny clears them with `rm -f .git/*.lock` in Git Bash (harmless either way).

## 8e. 2026-08-14 afternoon (Paul) — push + Zoho widget registration/placement

Paul pushed `0816440`, set `ZOHO_WIDGET_KEY` in Railway, and registered the widget. Claude verified server-side live (agents endpoint answers with the key; danny/paul/rick send-capable) and drove the Canvas placement via browser. **Three Zoho gotchas worth remembering:**
1. **Related List widgets must be attached to the module before Canvas can see them.** The attach flow only exists on the STANDARD record view: Canvas Assignment → temporarily set your own profile to Standard View → open any contact → Add Related List → Widgets → pick the widget → re-assign the canvas. (Same one-step attach works on Leads directly since Leads use standard view — still to do.)
2. **An attached-but-unplaced related list floats over every tab** of a canvas view. That was the "why is this on every tab?" mystery — Zoho fallback rendering, not our bug.
3. **Canvas drag-and-drop won't nest a block into a tab unless it fully fits inside the tab's container.** Dropping "into" a full tab silently lands the block at page level (→ floats everywhere). The reliable placement is the tab-strip **+** menu → search the related list name → Zoho creates a properly-nested tab. Final layout: **BTI Voice** tab (module record card, fills as records flow) + **BTI Voice SMS** tab (widget at 967×700). Verified in preview and live on Danny Test: thread renders with agent name tags, send-as picker populated, other tabs clean.

Widget registration reference: name "BTI Voice SMS", API name `BTI_Voice_SMS`, Type Related List (immutable after create), Hosting External, Base URL `https://bti-voice-production.up.railway.app/zoho-widget/sms.html?key=<ZOHO_WIDGET_KEY value>`.

## 8f. 2026-08-17 → 08-18 sessions (Danny) — data repair, feature batch 0aeceeb, upsert crisis, SMS webhook fix

**Identity note: the user on this machine is DANNY, always — even though session context shows paulm@businesstechnologyinsight.com.** Earlier "Paul's session" labels in this doc are suspect.

1. **Widget on Leads** — attached + verified (Add Related List → Widgets → Install). Leads show native Zoho SMS list stacked above ours; acceptable until Zoho SMS retires (~Oct–Nov 2026, decided).
2. **Notes migration COMPLETE.** `--sync` (16 digests, 91/92 calls — call 58 skipped, junk `client:agent_3` contact), `--list-notes` (25 notes), Danny approved, `--delete` ran clean. Gotchas: must `railway link` (project "intuitive-compassion"); `railway run` injects the INTERNAL DB URL — override with `env DATABASE_URL="<maglev public URL>"`; inline `node -e '...'` DIES on Windows railway/cmd quoting ("Access is denied") — always write a script file instead.
3. **CRITICAL Zoho lesson:** upsert `duplicate_check_fields` silently INSERTS unless the field is marked unique ("Do not allow duplicate values"). BTI_Ref wasn't → every sync duplicated the whole module (3× = 318 records). Fixed: deduped to 106 via API (bulk deleteRecords MCP tool is broken — single deletes only), then set unique on BTI_Ref in the layout editor (dedupe MUST precede uniqueness), verified upsert returns `action:"update"`. Confirmed holding under live traffic 8/18.
4. **Voicemail review FINISHED** — 17/18 junk rows merged with an end-time rule (candidate call ending 4–5s before the recording row = the callback latency; beat the old ±4min window and cracked the 52-min T-Mobile call 112/113). Only row 80 (6s "testing") remains, on 'Unknown caller'.
5. **Malformed contacts fixed:** dup `2395959310` merged into Danny Test (6); `239-231-6219` → `+12392316219`; misdial `+239595931` contact removed (call 137 re-filed); empty `client:agent_2` removed. Left, pending Danny's go: contacts 7/10/11 (all test junk).
6. **Commit `0aeceeb` (pushed, live):** default-password nag banner (login flags `username+123`, amber banner till changed; also fixed change-password showing success on HTTP 400); agent number-assignment UI (Team section "edit" → `PATCH /api/agents/:id/number`, E.164); light-mode conversion for Login/toasts/TitleBar (ActiveCallPanel deliberately stays dark — call-screen convention). STALE TODO discoveries: check-for-updates button already shipped in 1.5.0 (a49cc6c); BottomNav already themed.
7. **`TWILIO_STRICT_WEBHOOKS=true`** set in Railway, redeployed, verified healthy — and proven 8/18 by live inbound SMS passing validation. Rollback: set `false` if inbound 403s. (Also: `ADMIN_KEY` unset — random per boot; set it if admin endpoints are ever needed.)
8. **dist-electron pruned** (835 MB of 1.0.0–1.4.x installers deleted; 1.5.0 kept).
9. **8/18: inbound SMS to Rick/Paul's numbers was broken** — their numbers still had Twilio's DEMO SMS URL (`demo.twilio.com/welcome/sms/reply`; the 8/14 setup did voice webhook + A2P pool only). Fixed via `server/scripts/fix-sms-urls.js` (`railway run node server/scripts/fix-sms-urls.js`, idempotent) → both now point at `/webhooks/sms`. Verified end-to-end: Danny's cell → Paul's number → DB message 37 → today's Zoho digest updated in place (no dup). **Per-number inbound CALL routing still missing** (all numbers hit the same IVR).
10. **DIRECTION CHANGE: BTI Voice will be sold externally.** No longer internal-only. Demo video script at `BTI-Voice-Demo-Video-Script.md`. Before any external exposure, close the deferred security items in §9 (send-as-any-agent, media-token JWTs, updater auth, widget key model). See TODO "WHAT'S NEXT".

## 8g. 2026-08-18 session (Danny) — selling track planned

**Full plan: `BTI-Voice-Productization-Plan.md`** (codebase tenancy audit + Twilio ISV/A2P research + competitor pricing, all 2026-current). Decisions:
- **Target: BTI's MSP clients** (vets maybe later via Talkingvet). 1–5 pilots year one.
- **Single-tenant deploy per customer** (own Railway project/DB/env). Audit found zero tenant awareness (16 tables, no org column; `ivr_settings CHECK (id=1)` singleton; unscoped queries) but clean per-process isolation — multi-tenancy is a multi-week rewrite, not worth it under ~5 customers.
- **#1 deploy blocker: `seed.js` boots 5 named BTI agents with `username123` passwords on every deploy**, plus Talkingvet strings in the after-hours SMS default and the AI summary prompt, `ADMIN_KEY` fallback `'bti-admin-2026'` on an unauthed route, JWT_SECRET random-per-boot if unset. All trivial fixes — Phase 0 in the TODO.
- **Twilio: subaccount per customer; each customer needs their OWN A2P brand+campaign under THEIR EIN** (Low-Volume Standard $4.50 + Low-Volume Mixed campaign $15 + $1.50/mo). Campaign vetting 10–15 days; customer data collection + website compliance is the real bottleneck (4–6 weeks typical onboarding). Voice can go live in ~3 days — sell voice-first. BTI must re-register its Primary Profile as "ISV Reseller or Partner" first.
- **Pricing: $35/user/mo + $250–500 onboarding fee.** COGS ~$11/user for a typical 10-user client → ~65–70% margin. Competitive band for equivalent feature set is $23–50/user/mo (RingCentral charges +$60/user just for AI call intelligence).
- **Zoho = optional add-on** (Danny's point: the integration is BTI's Zoho; customers only benefit if they run Zoho CRM themselves). App degrades gracefully without Zoho env vars. Zoho customers need the `BTI_Voice` module + unique `BTI_Ref` created in THEIR org.
- **Browser-only for pilots** — avoids per-customer Electron builds/signing (main.js hardcodes the Railway URL; VITE_API_URL baked at build time).
- **Telecom tax research done** (plan §8): billing bundled telecom in BTI's name = interconnected-VoIP provider status (FCC 499-A even though de minimis; FL CST ~12–15% monthly filings; FL E911 $0.40/line/mo). Leading mitigation: agent model (customer pays their Twilio subaccount directly, BTI bills software/management only). Accountant questions listed in §8.
- **Phase 0 hardening CODE DONE — commit `54fdaaf` (local, needs push):** SEED_DEMO gate + ADMIN_USERNAME/ADMIN_PASSWORD bootstrap in seed.js; COMPANY_NAME/AI_SUMMARY_CONTEXT replace the hardcoded Talkingvet AI prompt (voice.js) and after-hours default (db.js/sms.js); adminActivity.js now imports secret.js ADMIN_KEY (removed `bti-admin-2026` fallback); secret.js exits in prod without JWT_SECRET; validateTwilio.js strict-by-default in prod. Also committed the previously-untracked `server/scripts/fix-sms-urls.js`. After push: set `COMPANY_NAME=Talkingvet` in Railway (AI summaries otherwise say "this business"); optionally `AI_SUMMARY_CONTEXT` for the vet-industry framing. Note existing after-hours message in BTI's DB still says "Talkingvet:" (stored value, edit in Settings before the demo video). Demo script updated with Talkingvet-sweep + MSP reframe of Scene 4 + Windows recording workflow.

## 8h. 2026-08-18/19 (Danny) — Phase 0 shipped + UI/UX overhaul + contact features

All commits below are on main (Danny pushed incrementally; verify `git fetch` + status before assuming). Details per commit in the TODO "Done 2026-08-18" entries.
- `54fdaaf` Phase 0 hardening (SEED_DEMO gate + admin bootstrap, COMPANY_NAME/AI_SUMMARY_CONTEXT, ADMIN_KEY fallback removed, JWT_SECRET required in prod, strict webhooks default). `COMPANY_NAME=Talkingvet` set in Railway.
- `0f54d44` Contact editing with CRM lock (✎ in chat header for non-CRM contacts only; server 409s name edits on Zoho-matched).
- `78ae865` Responsive title bar + SMS split view ≥900px; Electron default 470×805.
- `0be6d33` Title bar rework (status icon + name only; number → Dialpad header; device dot only when degraded); **notifications consolidated to bell panel — Alerts nav tab REMOVED**; dialpad compact <660px height; Electron min 330×560 (⚠ shell changes need a future installer).
- `fe1d649` Narrow chat fixes (header ellipsis, responsive compose placeholder).
- `a0dc21d` Calls + Contacts split views ≥900px (shared CallDetailBody; ContactDetail back button optional).
- `82e892b` Re-sync with CRM: sync-zoho always adopts CRM name + 🔄 button in chat Zoho panel.
- Data: test conversation 28/message 18 (+12392316219) purged from DB + its Zoho digest deleted (for the demo video).
- Demo script updated (MSP reframe, Talkingvet sweep, Scene 2.5 resize moment, recording workflow) + `.docx` version; YouTube description drafted in chat 8/19.
- **Git lock addendum (⚠ cause corrected in §8k — Claude's FUSE mount, not OneDrive):** when `rm .git/index.lock` fails with "Operation not permitted", `mv` (rename) works. Commit via `GIT_INDEX_FILE=/tmp/bti.index` (copy index out, add+commit, copy back). Applies to Claude only.
- **NEXT:** consent-record storage → per-number inbound routing → deploy runbook + Twilio ISV profile re-registration (pilot-customer path); Danny: demo video, pilot pick, pricing sign-off, accountant (plan §8).

## 8i. 2026-08-19 session (Danny) — productization batch: 5 commits, ALL LOCAL (need push)

Demo video recorded. Then everything left on the Phase-0/pilot list was done in order:
- `d9b93c6` **Consent-record storage** (A2P/TCPA audit): append-only `consent_records` table (survives contact deletion via ON DELETE SET NULL + stored phone); `helpers/consent.js recordConsent()` never throws. Auto-captured: new-contact-created-by-inbound-SMS = implied opt-in, STOP/START keywords, all five 21610 carrier-block sites (messages, conversations, zohoWidget, sms webhook after-hours, scheduled sweep). Manual capture UI in ContactDetail (action+method+required detail; manual opt-in does NOT clear a keyword/carrier STOP — Twilio still blocks; warns instead). GET/POST `/api/contacts/:id/consent`, CSV export `/api/contacts/consent/export` + Settings → Calls → SMS Compliance button. Also fixed latent bug: ContactDetail used `toast` without declaring it (edit-save would ReferenceError).
- `de26f19` **Per-number inbound call routing**: `number_routing` table; `/inbound` checks the dialed number BEFORE the shared IVR (types: ivr/agent/all_agents/voicemail; voicemail TwiML extracted to `sendToVoicemail()` helper, still carries `?vm=1&from=`); CRUD `/api/ivr/number-routing` (POST upserts on phone); Settings → Calls → Number Routing card. TODO after push: rules for Rick/Paul's numbers.
- `5a95ae1` **Brandable product name**: `client/src/brand.js` = `VITE_BRAND_NAME` || 'BTI Voice' → splash/TitleBar/document.title/Settings; server `BRAND_NAME` in startup log + Zoho call description. (NOTE: this commit also accidentally swept in a stray root `App-Audit.html` left by an earlier session — harmless, prune later if desired.)
- `40e6582` **docs/DEPLOY-RUNBOOK.md + server/.env.example** — full per-customer deploy procedure + annotated env template.
- `bd268b2` **Media-token hardening**: `POST /api/auth/media-token` mints 10-min `scope:'media'` JWTs; `requireMediaAuth` on `/messages/media/:id` + `/calls/:id/recording` — full login JWTs REJECTED in `?token=` (Bearer header still accepted); client mints on login, refreshes every 5 min, clears on logout; removed calls.js `bti-voice-dev-secret` fallback.

Also this session: **junk purge executed** (contacts 7/10/11 + convs + calls 58/80 + 2 stale Zoho digests `sms-*-Danny`); Danny decided **release toll-free +18555998716**; Danny **started Twilio ISV re-registration + SHAKEN/STIR + Compliance Embeddable request** in console. Sandbox git note: pinned `.git/HEAD.lock` was cleared by RENAME (`mv HEAD.lock HEAD.lock.old`) — rm fails, mv works; commits went through `GIT_INDEX_FILE=/tmp/bti.index` as before. Leftover `.old` lock files in `.git/` are safe to delete in Git Bash.

**Session outcome (evening):** All 5 commits + picker fix `d0e3bd6` PUSHED and live. Number Routing rules set (Rick +12394755114 → Rick, Paul +12394454227 → Paul); spot-checks passed (recording playback, MMS render, consent CSV). Twilio console: **ISV re-registration is NOT self-service** — approved Primary Profiles are read-only (Edit greyed out); support ticket filed (identity flag → ISV Reseller or Partner + Compliance Embeddable beta + asked about blank Business Type / Industry=HEALTHCARE); "Create Secondary Profile" button EXISTS, so customer onboarding is not blocked. **SHAKEN/STIR already existed** (Trust Product "Talkingvet Dialer", Approved) but had ZERO numbers assigned — numbers first had to be assigned to the Business Profile (Customer profiles → Assigned phone numbers tab), then to the Trust Product; all 3 now attached = A-level attestation. Toll-free +18555998716 released. Remaining: ring test on Paul's number (per-number routing e2e), ticket outcome watch.

**After Danny pushes:** migrations create `consent_records` + `number_routing` automatically. No new Railway vars required for BTI (BRAND_NAME/VITE_BRAND_NAME fall back to "BTI Voice"). Then in the app: Settings → Calls → Number Routing — add Rick +12394755114 → Rick, Paul +12394454227 → Paul.

## 8j. 2026-08-19 evening (Danny) — iOS app running on iPhone; TestFlight blocked on license agreement

BTI Voice now runs on Danny's iPhone 17 Pro Max (iOS 27) via Capacitor. The road there, so nobody repeats it:
1. **capacitor.config.ts → capacitor.config.json** (`4c7aade`) — Capacitor CLI's TS config parser crashed; JSON sidesteps TypeScript entirely. (A stray `capacitor.config.ts.removed` was later `git rm`'d on the Mac — Claude's sandbox couldn't delete it from Windows; see §8k.)
2. **Deployment target 13.0 → 15.0** — current Xcode (beta, iOS 27 SDK) refuses 13.0. sed'd both `App.xcodeproj/project.pbxproj` and `Pods/Pods.xcodeproj/...`, plus a Podfile post_install override so pod install keeps 15.0. Committed in `13238d5` (Mac).
3. **UIScene lifecycle is MANDATORY on the iOS 27 SDK** — app launched to a black screen with `EXC_BREAKPOINT`: "Application failed to launch: UIScene life cycle is required for apps built with this SDK." Fix: `client/ios/App/SceneDelegate.swift` (UIWindowSceneDelegate; deep links forwarded via ApplicationDelegateProxy) + `UIApplicationSceneManifest` in Info.plist via PlistBuddy (delegate `$(PRODUCT_MODULE_NAME).SceneDelegate`, storyboard Main). In `13238d5`.
4. **build-ios.sh built into server/public but Capacitor reads client/dist** — phone ran a STALE web bundle at first. Fixed (`33c7213`): `npm run build -- --outDir dist --emptyOutDir`. ⚠ Manual builds for iOS MUST include `VITE_API_URL=https://bti-voice-production.up.railway.app` or login dies with Safari's cryptic "The string did not match the expected pattern" (no API base). build-ios.sh does it right — prefer the script.
5. **iOS polish, all pushed:** `9a97d86` viewport lock (user-scalable=no, viewport-fit=cover) + `scrollEnabled:false` + @capacitor/keyboard + 100dvh/safe-area; `f16a417` keyboard resize **native** (body mode + scrollEnabled:false = keyboard covered inputs); `8be1c41` login 100dvh; `5131087` IS_TOUCH gate (`client/src/utils/touch.js`, pointer:coarse) — dialpad/login no longer autofocus on touch, tab switches blur the keyboard away. `client/resources/` holds the 1024px alpha-free icon + splash sources; build-ios.sh generates iOS assets via @capacitor/assets.
6. **Recording playback on iOS** required HTTP Range support in the recording proxy — `/api/calls/:id/recording` now forwards Range and mirrors 206/Content-Range/Accept-Ranges (`9a97d86`, server-side, benefits all platforms). Still to verify on the phone: recording playback + incoming-call-while-open.
7. **Known iOS limitation:** incoming calls only ring while the app is foregrounded — no CallKit/VoIP-push. That's the next real iOS project if the team wants background ringing.
8. **TestFlight status:** Xcode beta warning noted (uploads occasionally rejected — fall back to release Xcode if so). App Store Connect app record BLOCKED until the Apple Developer **Account Holder accepts the updated Program License Agreement** (banner on the ASC front page, dannyr927@outlook.com). Then: app record (bundle `com.businesstechnologyinsight.btivoice`) → Xcode version 1.5.0/build 1 → Any iOS Device → Product → Archive → Distribute → TestFlight internal group (testers need Users & Access entries).
9. **Git addendum:** sandbox commits can leave the Windows index desynced — `git reset` + `git checkout -- .` clears it; untracked `client/ios/` on Windows had to be `rm -rf`'d before the rebase could materialize the Mac's tracked copy.

## 8k. 2026-08-19 — three-machine setup, MANDATORY sync failsafe, and the OneDrive myth debunked

Danny travels; the laptop becomes a primary work machine. **Full setup guide: `docs/BTI-Voice-LAPTOP-SETUP.md`.**

### 🔴 CORRECTION — "OneDrive locks" were NEVER real. It was Claude's sandbox all along.

**Danny does not use OneDrive.** It is off. The `C:\Users\Doero\OneDrive\…` path is a leftover folder name, nothing more. Every note in this file blaming OneDrive for git lock errors (§8d, §8h, §8i, §10.7) was a misdiagnosis repeated across multiple sessions.

**The real cause, proven 2026-08-19:** Claude's Linux sandbox mounts the Windows folder over **FUSE**, and that mount does not permit `unlink`. Test that settles it — a brand-new file nothing else had ever touched:

```
touch __probe_test.txt   → created OK
rm __probe_test.txt      → rm: cannot remove: Operation not permitted
```

No OneDrive, no antivirus, no other process. The mount simply cannot delete files. `mv` (rename) works, which is why the rename trick appeared to "fix" things.

**What this means:**
- **Danny working natively in Git Bash / PowerShell has never had this problem and never will.** Do not send him chasing OneDrive settings, sync pauses, or "close VS Code."
- The `GIT_INDEX_FILE=/tmp/bti.index` dance, `mv .git/index.lock`, and "pause OneDrive" are **Claude-side workarounds only**, and only when Claude runs git against a mounted folder.
- When Claude's git operation fails on `unable to unlink`, the correct response is: **ask Danny to run that git command himself.** It will just work.
- Leftover `.git/HEAD.lock.*.old` files are Claude's debris. Safe to delete; Danny can `rm` them, Claude can't.

### Docs now live in the repo

Because there is no cloud sync, docs on the desktop had **no backup and no path to other machines**. All BTI Voice docs moved into `bti-voice/docs/` (2026-08-19) and committed. Archive of superseded/other-project docs in `bti-voice/docs/archive/`. **One `git clone` now carries code + full context + backup.** Note `BTI-Voice-Session-Handoff 3.md` was renamed `BTI-Voice-Session-Handoff-3.md` (space removed).

⚠ This file contains the live Postgres credential in §2 and now lives in git history. The repo is **private** — keep it that way, and rotate that password in Railway if the repo ever gains collaborators or changes visibility.

### Repo path per machine

| Machine | Repo path | Notes |
|---|---|---|
| Windows desktop | `C:\Users\Doero\OneDrive\Documents\Claude\Projects\Talkingvet Help\bti-voice` | Path name is legacy; no sync running. Plain git works fine for Danny. |
| Windows laptop | `C:\Dev\bti-voice` | Set up per the laptop guide |
| Mac | `~/Documents/Claude/Projects/BTI Voice/bti-voice` | Only machine that can build iOS/Mac |

### ⚠ MANDATORY SYNC FAILSAFE — Danny explicitly asked Claude to own this

He is not a developer and will not spot stranded commits himself.

*Start of EVERY session, before any code work:* `git fetch origin`, then check `origin/main..main` (ahead = he forgot to push), `main..origin/main` (behind = pull first), and `git status --porcelain` (dirty). Report in plain language.

*End of EVERY session, or when he says he's stopping/traveling/switching machines:* commit → `git push origin main` → verify `git status` is clean AND up to date → tell him explicitly it's safe to close the laptop. **Never end a session silently with unpushed work.** If the push fails, say so loudly.

*Caught on its first run, 2026-08-19:* the desktop was 2 commits BEHIND origin (`47f1bd3` iOS keyboard pod + `279022e` client package-lock, both from the Mac) and Danny had no idea.

## 8l. 2026-08-20 — BTI Voice IS ON TESTFLIGHT (build 1.5.0 (1))

Uploaded, processed, compliance answered, internal group created, installed on a device. Path from
§8j is now closed. Full click-by-click procedure preserved in **`docs/BTI-Voice-TestFlight-Runbook.md`**
(written this session — use it for every future build).

**Four things blocked the way that were NOT in the plan. Worth knowing before the next upload:**

1. **The Xcode project was still stamped `MARKETING_VERSION = 1.0`.** The TODO said "set version
   1.5.0/build 1 in Xcode" and nobody had. Fixed in `client/ios/App/App.xcodeproj/project.pbxproj`
   (both Debug and Release configs). `CURRENT_PROJECT_VERSION` was already 1. **Bump
   MARKETING_VERSION in the pbxproj, not in the Xcode GUI** — that way it travels in git and the
   Mac can't archive a stale version.
2. **The everyday App Store Connect login has role `Customer Support`.** That role cannot create
   apps, cannot see the Business section, and shows no **+** on the Apps page. Hours could be lost
   hunting a "missing button" that is really a permissions state. Creating an app needs
   **Account Holder, Admin, or App Manager**. Signed in as the Account Holder to proceed.
   ⚠ Still open: promote the day-to-day account to Admin so credential-swapping isn't needed again.
3. **The App ID `com.businesstechnologyinsight.btivoice` had never been registered** in the
   developer portal, so it wasn't in the New App bundle-ID dropdown. Registered manually at
   developer.apple.com → Identifiers → + → App IDs → App → Explicit, no capabilities ticked
   (mic comes from Info.plist, not an entitlement). Telling detail: had Xcode been signing under
   team U2Z95CX43X all along it would have auto-registered this — worth a thought if signing acts up.
4. **"Your user access settings could not be saved"** on app creation is cosmetic. The record is
   created; access falls back to all-users, which is what Full Access grants anyway. Ignore it.

**Export compliance answer (use the same one every time):** "What type of encryption algorithms
does your app implement?" → **None of the algorithms mentioned above.** The app implements no crypto
of its own — HTTPS to Railway/Twilio and WebRTC inside the WKWebView are all WebKit/OS-provided.
This answer must be revisited only if a native crypto library, encrypted local storage, or a custom
VoIP stack is ever added. Optional future tidy: `ITSAppUsesNonExemptEncryption = NO` in Info.plist
skips the question on every upload.

**Two process traps hit this session:**
- **`build-ios.sh` was run on Windows.** It is **Mac-only** — it ends in `npx cap open ios` and runs
  CocoaPods. It got partway, then left three modified tracked files behind
  (`Assets.xcassets/AppIcon.appiconset/Contents.json`, `Assets.xcassets/Splash.imageset/Contents.json`,
  `ios/App/Podfile`). All three were `git restore`d — **the Podfile one matters**, because `cap sync`
  can strip the `post_install` block that pins the deployment target to 15.0.
- **`git pull` died with `fatal: mmap failed: Operation timed out` at 9.00 KiB/s** on the Mac. It was
  the network; a retry worked. If it recurs, note the Mac clone lives under `~/Documents`, so check
  whether iCloud "Desktop & Documents Folders" sync is on — cloud-backed files are a classic cause of
  mmap timeouts in git. Relocating the Mac clone to `~/Dev/bti-voice` would match the laptop and
  remove the risk.

**Also noted:** the Apple Developer Program membership **expires Sep 8, 2026** (ASC banner). If
auto-renew is off, TestFlight builds die with it. Only the Account Holder can renew.

## 9. Security posture
**Fixed & live:** Zoho + socket auth, webhook validation (soft), secret hardening, MMS hardening, crash safety, opt-out across all paths, throttles, quiet hours, recording notice, and the client/Electron bugs above.
**Deferred (need more than a blind edit) — in BTI-Voice-Preprod-Audit.md:**
- Updater endpoint auth + Windows installer integrity check (updater is Windows-gated now, lower risk).
- Short-lived per-resource media/recording tokens (JWT currently rides in those URLs).
- "Send as another agent" + call-control-by-SID: fine for internal use, lock down if ever external.
**Action items:** everyone change default passwords; after ~1 day of clean logs set `TWILIO_STRICT_WEBHOOKS=true` in Railway.

## 10. Key gotchas
1. Desktop app loads client from Railway — client fixes need a push, not a rebuild; only Electron-shell changes need a new installer/DMG. After a socket-auth-type change, quit+reopen the app so it loads the new client.
2. Claude's file tools truncate JS at template literals `${...}` — edit server/client JS via python3/bash heredoc.
3. Claude's Linux sandbox can't git-clone into the mounted folder (lock files) — clone in /tmp then copy; and can't cp large DMGs over the mount (deadlock) — do those on the Mac natively. Claude CAN commit; pushes need Paul/Danny in Terminal (Mac keychain has GitHub creds).
4. Windows: Git Bash only. `rm .git/index.lock` if git complains.
5. Zoho: DO NOT revoke the Self Client token to fix API spikes — it powers all sync. Refresh token scopes: `ZohoCRM.modules.ALL,ZohoCRM.users.READ`. (Historical incident: wrapUpSweep retry storm → ~51K calls/day; fixed with backoff + 8-attempt cap.)
6. `seed()` runs on boot but only inserts the 5 original agents if missing (won't touch ryan or resurrect deactivated ones); no longer logs plaintext passwords.
7. **Git lock errors are a CLAUDE-SANDBOX problem, not a Windows/OneDrive one — see §8k.** Claude's FUSE mount cannot `unlink`, so `.git/index.lock` accumulates and `rm` fails with "Operation not permitted" (`mv` works). **Danny running git natively is unaffected — when Claude's git op fails this way, hand the command to Danny.** Separately and still true for everyone: `git status` can claim "up to date with origin/main" while the tracking ref is stale — **always `git fetch origin` first** and compare against `origin/main` before believing it.
8. **A stale `GH_TOKEN` was set permanently in the Windows user environment** and shadowed every `gh` login with 401s (`gh auth login` refuses to run while it's set). Removed 2026-08-13 via `[Environment]::SetEnvironmentVariable('GH_TOKEN', $null, 'User')`. Railway's own `GH_TOKEN` is separate and healthy — don't confuse them. If the updater ever 401s on download, Railway's token has expired.
9. **Line endings:** repo files on Windows are CRLF. When editing server/client JS with a python heredoc (see gotcha 2), read and write with `newline=""` and convert back to CRLF, or the whole file shows as changed in `git diff`.
10. **Twilio webhook payloads are not uniform.** `recordingStatusCallback` has no `From`/`To`; the parent leg of an agent-placed call has `from=client:agent_N` and an empty `to` (the real destination is on the child leg, findable via `parentCallSid`). Never assume a field is present because another webhook has it.
11. **There is no manual "check for updates" anywhere in the app.** `main.js` checks once, 10s after launch, Windows-only, and that's it. The app also stays resident in the tray (`window-all-closed` is a no-op), so closing the window doesn't restart it — users must Quit from the tray. Anyone who dismisses the banner waits until their next real restart. A Settings → About button would fix this but needs a new installer to reach anyone.

## 11. Open items / backlog (see BTI-Voice-TODO.md for the live checklist)
- ~~**Danny (Windows):** rebuild installer, attach to release, confirm LATEST_VERSION, pull main~~ — **all done 2026-08-13.**
- ~~**Immediate / unverified:** test voicemail~~ — **VERIFIED 2026-08-14.** Inbound voicemail from Danny's cell filed correctly as call 162 (inbound/voicemail, Mr. Danny Test, SID + recording stored, Unknown caller stayed at 18). Still to confirm: Paul Messino's upgrade from 1.4.0 (he was active in-app 2026-08-13).
- **Everyone:** change default passwords.
- **Soon:** set `TWILIO_STRICT_WEBHOOKS=true` after logs look clean; assign Twilio numbers to non-danny agents when ready.
- **Polish:** finish dark-mode conversion (title bar, bottom nav, in-call screen, login, toasts still hard-code dark); tab-switch perf refactor; delete dead `client/src/pages/Inbox.jsx` + `components/Sidebar.jsx`; wide-window split view.
- **Features (pre-existing backlog):** AI-suggested replies (GPT-4, OpenAI already wired); Zoho hardening (re-enable contact-ID cache in zohoSync.js resolveZohoId; retry logic for wrap-up pushes; confirm refresh-token rotation); agent number-assignment UI; conversation filters; Twilio console tidying (delete 2 dead msg services, add 911 address to test #); bulk/broadcast SMS (parked, needs upgrade); editable disposition codes; iOS device testing.
- **New from 2026-08-13:** manual "Check for updates" button in Settings → About (see gotcha 11); finish the remaining 18 rows in `BTI-Voice-voicemail-review.csv`; malformed contact `+239595931` (9 digits, on call 137) survived the `phoneVariants()` dedupe fix — check for other malformed numbers; `dist-electron/` was pruned 2026-08-18 (835 MB of 1.0.0–1.4.x removed, 1.5.0 kept) — this item is now largely stale.
- **Folder rename / relocation (now easy — reconsider):** renaming or moving `Talkingvet Help` is safe code-wise — nothing hardcodes it, electron-builder's output path is relative, git doesn't care. The old objection was "OneDrive would re-sync 2.1 GB" — **that objection is void; OneDrive isn't running.** Only cost now is reconnecting the folder in Cowork. Moving the desktop repo to `C:\Dev\bti-voice` would also match the laptop and drop the misleading `OneDrive` path segment.

## 12. Continuing from another device
- **Use the app:** browser → https://bti-voice-production.up.railway.app, or the installed desktop app.
- **Windows next:** follow the Danny/Windows items above; point the Windows Claude session at this file.
- **Keep this file current:** it lives in `~/Documents/Claude/Projects/BTI Voice/`. Update at the end of significant sessions and carry it across machines (email it, or commit it to the private repo so it travels with git).
