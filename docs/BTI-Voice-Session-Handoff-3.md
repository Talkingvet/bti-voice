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
- **External DB access** (scripts/direct fixes): copy `DATABASE_PUBLIC_URL` from Railway → Postgres service → Variables (the public proxy URL; the internal URL only works inside Railway). **Never paste it into docs or chat** — it was rotated 2026-10-05 after living in this file; see review §5 A1.
- **Railway env vars of note:** `JWT_SECRET` (set — keep it), `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `LATEST_VERSION` (drives update prompts), `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`, `OPENAI_API_KEY`, `ENABLE_RECORDING`, `SERVER_URL`. NEW optional: `TWILIO_STRICT_WEBHOOKS` (set to `true` to enforce webhook signatures), `ADMIN_KEY`.
- **Current version:** v1.5.0 — **fully released on both platforms as of 2026-08-13.** Mac DMGs (signed+notarized) and `BTI-Voice-Setup-1.5.0.exe` (86.94 MiB) are all attached to the v1.5.0 GitHub release, and Railway `LATEST_VERSION=1.5.0`.
- **Latest commit on main:** `0816440` (2026-08-14 feature batch: Zoho SMS widget, per-agent caller ID, click-to-call, BTI_Voice module rerouting) — **pushed and live on Railway as of 2026-08-14 ~1pm.** `ZOHO_WIDGET_KEY` is set in Railway and matches the Zoho widget registration. Widget "BTI Voice SMS" registered (Type Related List, External) and live in a dedicated **BTI Voice SMS** Canvas tab on Contacts — verified working on Danny Test. See §8e for the Zoho registration gotchas (module attach via standard view, floating-widget fallback, + tab nesting). Remaining: Leads attach, desktop-app verifications (caller ID, icons), Notes migration — see TODO "Go-live status".

## 3. Logins / accounts (BTI Voice agents)
From the live DB (2026-08-12). Seeded accounts were created with a predictable default password (the app flags these and shows a nag banner on sign-in) — **everyone should change theirs in Settings → Profile → Change Password before wider rollout.** Credentials live in the password manager, not here.

| id | username | name | phone | active |
|----|----------|------|-------|--------|
| 1 | shawn | Shawn Stright | none (TBD) | yes |
| 2 | danny | Danny Roche | +12396667033 (test #) | yes |
| 3 | raven | Raven | none | **no** (retired dup of rick) |
| 4 | rick | Rick Almendras | none | yes |
| 5 | paul | Paul Messino | none | yes |
| 6 | warren | Warren Anderson | none | yes |
| 7 | ryan | Ryan | none | yes (added 2026-08-12, default pw — must change) |

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
8. Added agent **ryan** (seeded default pw — must change).

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
6. **Commit `0aeceeb` (pushed, live):** default-password nag banner (login flags accounts still on the seeded default, amber banner till changed; also fixed change-password showing success on HTTP 400); agent number-assignment UI (Team section "edit" → `PATCH /api/agents/:id/number`, E.164); light-mode conversion for Login/toasts/TitleBar (ActiveCallPanel deliberately stays dark — call-screen convention). STALE TODO discoveries: check-for-updates button already shipped in 1.5.0 (a49cc6c); BottomNav already themed.
7. **`TWILIO_STRICT_WEBHOOKS=true`** set in Railway, redeployed, verified healthy — and proven 8/18 by live inbound SMS passing validation. Rollback: set `false` if inbound 403s. (Also: `ADMIN_KEY` unset — random per boot; set it if admin endpoints are ever needed.)
8. **dist-electron pruned** (835 MB of 1.0.0–1.4.x installers deleted; 1.5.0 kept).
9. **8/18: inbound SMS to Rick/Paul's numbers was broken** — their numbers still had Twilio's DEMO SMS URL (`demo.twilio.com/welcome/sms/reply`; the 8/14 setup did voice webhook + A2P pool only). Fixed via `server/scripts/fix-sms-urls.js` (`railway run node server/scripts/fix-sms-urls.js`, idempotent) → both now point at `/webhooks/sms`. Verified end-to-end: Danny's cell → Paul's number → DB message 37 → today's Zoho digest updated in place (no dup). **Per-number inbound CALL routing still missing** (all numbers hit the same IVR).
10. **DIRECTION CHANGE: BTI Voice will be sold externally.** No longer internal-only. Demo video script at `BTI-Voice-Demo-Video-Script.md`. Before any external exposure, close the deferred security items in §9 (send-as-any-agent, media-token JWTs, updater auth, widget key model). See TODO "WHAT'S NEXT".

## 8g. 2026-08-18 session (Danny) — selling track planned

**Full plan: `BTI-Voice-Productization-Plan.md`** (codebase tenancy audit + Twilio ISV/A2P research + competitor pricing, all 2026-current). Decisions:
- **Target: BTI's MSP clients** (vets maybe later via Talkingvet). 1–5 pilots year one.
- **Single-tenant deploy per customer** (own Railway project/DB/env). Audit found zero tenant awareness (16 tables, no org column; `ivr_settings CHECK (id=1)` singleton; unscoped queries) but clean per-process isolation — multi-tenancy is a multi-week rewrite, not worth it under ~5 customers.
- **#1 deploy blocker: `seed.js` boots 5 named BTI agents with predictable default passwords on every deploy**, plus Talkingvet strings in the after-hours SMS default and the AI summary prompt, `ADMIN_KEY` fallback `'bti-admin-2026'` on an unauthed route, JWT_SECRET random-per-boot if unset. All trivial fixes — Phase 0 in the TODO.
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
| Mac | **`~/Dev/bti-voice`** (moved 2026-08-20 — was `~/Documents/Claude/Projects/BTI Voice/bti-voice`) | Only machine that can build iOS/Mac. See §8m for why it moved. |

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

## 8m. 2026-08-20 — the Mac repo moved to `~/Dev/bti-voice` (iCloud was corrupting git)

**Symptom:** `git pull` on the Mac died twice with `fatal: mmap failed: Operation timed out` /
`Operation cancelled`, then `fatal: unpack-objects failed`. First occurrence looked like a slow
network (9 KiB/s). Second occurrence proved otherwise.

**Cause:** the Mac clone lived under `~/Documents`, and iCloud's **Desktop & Documents Folders**
sync was on. Git writes thousands of small loose objects during `unpack-objects`; iCloud was
syncing and evicting them concurrently, so the memory-map failed. Classic, and easy to misread as
a network problem.

**⚠ Turning that sync off MOVES the folder.** macOS relocated `~/Documents` into iCloud Drive and
left the old path non-existent — `cd` to the repo failed outright. Nothing was lost (every commit
that day was made on the Windows laptop and pushed; the Mac held only regenerated build artifacts),
but it is alarming if you don't expect it.

**Resolution: fresh clone to `~/Dev/bti-voice`.** Now outside iCloud, and the path matches the
Windows laptop's `C:\Dev\bti-voice`. All Mac commands in the runbook use the new path.

**If mmap errors ever recur** (any machine, any cloud-synced folder): `git config --global
fetch.unpackLimit 1` makes git keep a single pack file instead of exploding it into loose objects,
sidestepping `unpack-objects` entirely. Harmless to leave set.

**Also learned this session — the "up to date" trap, again.** `git status` saying *"Your branch is
up to date with 'origin/main'"* describes **committed work only**. It printed that line while three
files sat uncommitted, and the Mac then pulled "successfully" without the build-number bump, which
produced an archive stamped `1.5.0 (1)` instead of `(2)`. **Trust the combination — "working tree
clean" AND "up to date" — never either alone.** This is gotcha #7 restated because it bit again.

### Mobile UI scaling (first pass, shipped in build 2)

Testing on the phone showed the UI far too small — the app was designed as a 470px desktop window,
so body text landed ~13-14px and tap targets under Apple's 44pt minimum. There is **no central
stylesheet**: all 16 components carry their own inline `S` pixel style objects, so nothing could be
raised in one place. First pass is a root scale in `client/src/index.css` under
`@media (pointer: coarse)`: `--ui-scale: 1.18` with `zoom` on `#root`, dividing `100dvh` and the
safe-area insets by the same factor so the layout doesn't overflow. **Tune by changing that one
number.** Confirmed a clear improvement on device. Desktop and browser are untouched (coarse-pointer
only). Proper per-component typography pass remains on the TODO.

⚠ **Client changes need a new TestFlight build.** Capacitor bundles the web assets *inside* the iOS
app (`capacitor.config.json` has no `server.url`), so unlike server fixes a Railway push does NOT
reach the phone. Bump `CURRENT_PROJECT_VERSION` in the pbxproj **on the laptop, in git** — Apple
rejects duplicate build numbers, and setting it in the Xcode GUI leaves it stranded on one machine.

## 8n. 2026-08-27 (Danny, laptop) — Android bring-up: signed APK in one session

Followed `docs/BTI-Voice-Android-Setup-Plan.md`; it held up with no surprises. Timeline: Android Studio installed (Quail 3 | 2026.1.3) → `bash build-android.sh` in Git Bash ran end-to-end (created `client/android/`, API URL verified baked into the bundle) → Trust Project → Gradle sync → Build → Generate Signed Bundle/APK → signed release APK.

Key facts for future Android work:
- **Manifest fix applied:** `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` added to `client/android/app/src/main/AndroidManifest.xml` (Capacitor generates only INTERNET). Capacitor 6's WebChromeClient forwards getUserMedia and prompts at runtime **provided the manifest declares the permission** — no MainActivity changes needed.
- **Keystore:** `C:\Dev\bti-voice-release.jks`, alias `bti-voice` (password with Danny). `*.jks`/`*.keystore` uncommented in `client/android/.gitignore` so it can never be committed. 🔴 Must be backed up permanently — lost keystore = no more updates to installed apps, ever.
- **Version stamping lives in `client/android/app/build.gradle`** (`versionName "1.5.0"`, `versionCode 1`). Bump `versionCode` for every new APK — Android rejects installs over an equal/higher code. Same "edit the file, not the GUI" rule as the iOS pbxproj (§8l).
- Generated project targets **API 34** — fine for direct APK; Google Play (from 31 Aug 2026) needs 36. That bump (or a Capacitor upgrade — separate session!) is a Play-route-only task.
- APK output: `client\android\app\release\app-release.apk` (~3.5 MB). First build stamped 1.0 internally; rebuilt after the versionName fix.
- Remaining: on-phone verification checklist (plan doc) — especially both-ways call audio and the runtime mic prompt.

## 8o. 2026-08-27 (Danny, laptop) — double recording disclosure fixed + FIRST UNIT TESTS

**Bug:** callers heard "This call may be recorded…" twice (or more) before connecting. Cause: `maybeRecordingNotice()` fired at three sites in `server/webhooks/voice.js` and inbound paths CHAIN — `dialAgent` plays it, agent misses, Twilio hits `/no-answer`, `ringAllAgents` plays it again on the SAME call.

**Fix:** notice extracted to `server/helpers/recordingNotice.js` with a once-per-CallSid guard (in-memory Map — fine for this single-process server; pruned after 4h once past 1000 entries). `dialAgent(twiml, agentId, callSid, timeout)` and `ringAllAgents(twiml, callSid)` gained a CallSid param; every route call site passes `req.body.CallSid`. Fail-safe direction: missing CallSid → play anyway (a repeat is harmless, a missing disclosure is a compliance problem). Pre-existing gap noticed, NOT fixed: `dialSequential()` (IVR sequential queues) never records and never plays the notice — consistent, but means queue calls are unrecorded.

**Unit testing exists now.** `server/test/recordingNotice.test.js` — 7 tests on the guard using Node's **built-in** test runner (`node:test`, Node ≥18, zero new dependencies). Run: `cd server && npm test` (script added to `server/package.json`). Pattern for future tests: extract logic into `server/helpers/`, test the helper with fakes — no DB or Twilio needed.

**Versioning rule for this change: NO version bumps.** Server-only → a git push deploys it via Railway. The version stamps (electron/package.json, iOS pbxproj MARKETING_VERSION/CURRENT_PROJECT_VERSION, Android build.gradle versionName/versionCode, Railway LATEST_VERSION) only move when a new installer/build ships. Root + server/client package.json "1.0.0" are unused/cosmetic.

**Retest after deploy:** with recording on, call in and let it ring through to the all-agents fallback — the disclosure should play exactly once. **First live test 2026-08-27: PASSED — single disclosure.**

**Same session, afternoon batch:**
- **Test suite grew to 19** — added `server/test/phone.test.js` (phoneVariants: E.164 normalization, dedupe invariant, the 9-digit-misdial edge) and `server/test/consent.test.js` (recordConsent: writes complete records, refuses incomplete ones, never throws on DB failure — pool.query stubbed, no real DB needed).
- **Live Broadcast recording fix confirmed deployed** — `98d9b07` is on origin/main and Railway redeployed today. TODO's "needs deploy" was stale; only the on-phone retest remains.
- **Dead code deleted:** `client/src/pages/Inbox.jsx`, `client/src/components/Sidebar.jsx`, stray root `App-Audit.html` (grep confirmed zero imports; vite build ✓). `App-Audit-Handoff.md` still at root — Danny to decide keep/archive.
- **🔑 SANDBOX CHANGE — Claude CAN now delete files.** Cowork has a permission tool (`allow_cowork_file_delete`); once granted for the folder, `rm` works on the FUSE mount — dead files, `.git/*.old` debris, and tmp_obj litter were all cleaned this session. §8k's "mount cannot unlink" is now conditional: ask for delete permission first, fall back to the rename trick only if it's refused. Commits still needed the `GIT_INDEX_FILE=/tmp` + plumbing dance this session (permission was granted after); NEXT session should try a plain `git commit` first — it may just work now.
- **⚠ Sandbox git trap discovered:** a stale `/tmp/bti.index` from an EARLIER session (owned by another user, cp-over silently failed) produced a commit that would have deleted `client/android/` — caught by checking `git show --stat` before pushing, rolled back via `update-ref`, redone with a fresh index path. **Rule: always `git show --stat` a sandbox-made commit before pushing, and never reuse a /tmp index file you didn't create this session.**

## 8p. 2026-08-27 (Danny, laptop) — Zoho click-to-dial: v1 remote-dial rejected, v2 mini softphone shipped

**v1 (`66d5a7a`, pushed + live briefly):** widget 📞 button → `POST /api/zoho-widget/dial` → `dial_request` socket event into a new per-agent room (`agent_<id>`, joined on socket auth) → App.jsx listener calls `dialTo()`. Worked, but **Danny rejected it within the hour**: the desktop app dialed while buried in the background — zero feedback until the far end rang. Lesson: remote-controlling an app the user can't see is bad UX; put the UI where the user is.

**v2 (`18f2b5f`): the Call button opens a mini softphone popup that IS the phone.**
- `server/zoho-widget/call.html` — self-contained popup (380×620, dark call-screen styling): auto-dials on open, mute, DTMF keypad, mm:ss timer, hang-up, "Call again". Disconnects on window close (`beforeunload`).
- `POST /api/zoho-widget/voice-token {agent_id}` (widget-key auth; replaced `/dial`): mints a Twilio Voice token with the SAME identity as the app (`agent_N`) so `/webhooks/voice/outbound` applies that agent's caller ID and every downstream path (call row, recording, transcript, AI summary, BTI_Voice upsert) is identical to an app dial. **Outbound-only by design:** `incomingAllow: false` AND the popup never calls `device.register()` — it can't steal incoming ringing from the real app. Uses the existing `TWILIO_API_KEY/SECRET/TWIML_APP_SID` env vars (same as `/api/calls/token`) — no new Railway config.
- **Twilio SDK is self-hosted:** `server/zoho-widget/twilio-voice-2.18.1.min.js` (295KB, committed), because `sdk.twilio.com/js/voice/releases/...` returns 403. Copied from `client/node_modules/@twilio/voice-sdk/dist/twilio.min.js` — if the client dep is ever upgraded, re-copy and rename to match.
- sms.html `dial()` now `window.open`s the popup with key/phone/name/agent params (picker relabeled "Send / call as"); shows a hint if the popup is blocked. App.jsx's dial_request listener removed; the `agent_<id>` socket rooms KEPT (generic targeting infrastructure).
- **Why a popup, not in-widget:** top-level HTTPS window = mic permission works for sure (Zoho's iframe may lack `allow="microphone"`), and the call survives navigating the CRM mid-call. Mic permission is remembered per browser after the first grant.
- Verified pre-commit: vite build ✓, 19/19 server tests ✓, diff reviewed. **Live test pending after push** (mic prompt, caller ID, logging, recording).
- Sandbox note: with Cowork delete permission granted, **plain `git commit` now works** — no `GIT_INDEX_FILE` dance needed (first confirmed this session). Pushes still need Danny (no GitHub creds in sandbox).

## 8q. 2026-09-30 (Danny, desktop) — Zoho made genuinely optional for non-CRM customers

Danny's framing: "if I create credentials for a customer that sells cement, they would not need anything Zoho or CRM related." Audit result: server was fine (every sync site checked `ZOHO_REFRESH_TOKEN`), client was not — it had no idea whether the deploy had Zoho and rendered every CRM affordance unconditionally, producing visible errors on a Zoho-less deploy.

What changed (one commit):
- `server/zoho.js` — `isZohoConfigured()` = all three of `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`. `zohoAPI()` throws on it. Every former `process.env.ZOHO_REFRESH_TOKEN` check (voice/sms webhooks, messages, contacts, syncCallToZoho, wrapUpSweep) now calls it.
- `server/index.js` — `GET /api/features` (unauthenticated, booleans + brand only). Wrap-up sweep only starts when Zoho is configured.
- `client/src/features.js` — module-level cache + `useFeatures()` hook; `App.jsx` calls `loadFeatures(true)` on login/restore and `resetFeatures()` on logout. Defaults are OFF so a failed fetch hides rather than shows.
- Gated UI: `ChatPanel` (ZohoPanel + profile fetch; rename pencil always available without CRM), `PostCallScreen` (Spoke-with = local name, no create/task, note label), `ContactsTab` (sync button, CRM name-lock), `SettingsTab` (`ZohoCRMSection` returns null; About blurb generic).
- Brand: `adminActivity.js` title/h1 and `btiVoiceModule.js` agent fallback use `BRAND_NAME`; About logo shows the brand initial; two Zoho Voice / Talkingvet strings genericised.
- `server/.env.example` Zoho block rewritten to say exactly what hides.

Verification: `node --check` on every touched server file ✓, `npm test` in `server/` ✓ (recordingNotice suite), `vite build` ✓. `isZohoConfigured()` truth table checked by hand (unset → false, token-only → false, all three → true). Not runtime-tested on a Zoho-less deploy yet — that's the first thing to do when the first customer Railway service exists (or temporarily unset the three vars on a scratch service).

Also raised this session: **BTI-only admin portal** (cross-customer usage, per-customer feature toggles, credential resets, billing "enabled through" dates). Single-tenant architecture means this needs a small central control-plane; design options written up for Danny to choose.

## 8r. 2026-09-30 (Danny, desktop) — Admin portal PHASE 1 built (per-deploy plumbing)

Everything from `BTI-Voice-Admin-Portal-Plan.md` §2 as re-scoped by Danny's §4a decisions (portal-only, no in-app admin UI). Full inventory in **plan §6** — read that, not this. Headlines: `deploy_settings` table; `helpers/deploySettings.js` (cache + feature resolution + lifecycle state machine, 15 unit tests); enforcement in login/sessions/outbound TwiML/all 6 SMS send sites/recording/transcription/AI/Zoho/seats; `/api/tenant/*` router keyed by new `TENANT_ADMIN_KEY` (settings, extend, usage aggregates, users incl. temp-password resets, health); client banner + blocked-login message + `platform` on login. **Existing deploys see zero behaviour change** until BTI sets a value. `recording` in `/api/features` now follows the real gate (`ENABLE_RECORDING=true` + `SERVER_URL` + `OPENAI_API_KEY` + toggle) instead of the old `!== 'false'` — BTI's deploy has all of these so nothing changes there.

Verification: `node --check` on every touched file ✓; all modules `require()`d together without a DB to catch circular imports ✓; `npm test` 34/34 ✓; `vite build` ✓. NOT runtime-tested against Postgres yet — first boot on Railway runs the new `CREATE TABLE` + `ALTER TABLE` (all `IF NOT EXISTS`, additive). Watch the deploy log for `[db] Migrations complete.` then hit `/api/features` and confirm `account.state: "active"`.

**Next session: Phase 2 — the portal itself** (plan §3): new tiny Railway service `bti-voice-admin`, tenants table, logins for Danny/Paul/Rick/Shawn, dashboard looping over tenants' `/api/tenant/*`. Nothing here is usable by BTI until that exists (curl in the meantime — DEPLOY-RUNBOOK).

## 8s. 2026-09-30 (Danny, desktop) — Admin portal PHASE 2 built (the portal itself)

Everything in **plan §7** — read that for the inventory. Headlines: new folder `admin/` in this repo = a separate Railway service `bti-voice-admin` (own Postgres, own domain, no build step). Tables `portal_users` / `tenants` (keys AES-GCM encrypted at rest with `PORTAL_SECRET`) / `portal_audit`. Dashboard fans out to every tenant's Phase 1 `/api/tenant/*` in parallel with a timeout; tenant page has Usage (+ CSV export) / Users / Features / Billing / Health / Activity log / Setup tabs. Add-tenant verifies the key before saving. First login bootstrapped from `PORTAL_ADMIN_USERNAME/PASSWORD` env vars, forced password change, then add Paul/Rick/Shawn from Portal users.

Verification: 5/5 unit tests; full runtime pass in the sandbox against real Postgres 16 + mock tenants (plan §7e) and a headless-browser walk of every screen with zero JS errors. **Not yet deployed to Railway** — Danny does that per **DEPLOY-RUNBOOK §8** (new service from the same repo with Root Directory `/admin`, new Postgres, 5 env vars, generate domain, log in, register BTI's own deploy as tenant #1 using the `TENANT_ADMIN_KEY` already set on the main service).

Commit was handed to Danny (Claude's git can't write here). Claude's `git status` left `.git/index.lock` — delete before committing.

**Same evening — DEPLOYED + visual redesign.** Danny created the Railway service (`bti-voice-admin`, root dir `/admin`, own `admin-postgres`), boot log showed all three lines, first login + forced password change done, BTI's own deploy registered as customer #1 and showing live numbers (6 users). Still on Danny: the Features round-trip test (runbook §8a step 12), adding Paul/Rick/Shawn, deleting `PORTAL_ADMIN_PASSWORD`. Then Danny asked for the portal to look less generic, closer to nVoq's admin: rebuilt `admin/public/` (only those 3 files) — dark left sidebar with icons (customers listed in it; the open customer's sections appear beneath it, nVoq-style), title bar per page, Lato at 17px for big monitors, filled inputs with the label inside, bigger toggles, 52px table rows, dark default with a Light/Dark button in the sidebar footer, "tenant" → "customer" in all UI copy, audit actions in plain English. Routes moved `#/t/:id` → `#/c/:id` (old ones still work). Backend untouched.

## 8t. 2026-10-01 (Danny, desktop + Mac) — CBIA trial deploy live; portal confirm-dialog bug; call-history Outcome block

**CBIA (Collier Building Industry Association) trial deploy is LIVE** per runbook §9: Railway `cbia-voice` + `cbia-postgres`, `https://cbia-voice-production.up.railway.app`; Twilio number **+1 239-241-7652** bought in BTI's main account (Voice Integrity registration submitted as Customer Support; CNAM/Branded Calling skipped), TwiML app "CBIA Voice" `AP1dcdb8c9…`, number webhooks → cbia deploy, number added to BTI's Messaging Service (Incoming Messages was already "Defer to sender's webhook" — the default), 7 Twilio vars + SERVER_URL on the service. Registered in the portal as customer **CBIA** (trial, seat limit 3); first user `amelia.cbia` created with the 239 number; Danny signed in via browser. Runbook §9 updated with new-console paths/direct links and the `YOUR-DOMAIN` note (that log text is hardcoded).

**Portal bug found + fixed (pushed from the Mac):** every confirmation dialog (reset password, deactivate, suspend, archive) resolved "no" because `close()` fired `onClose → resolve(false)` before `resolve(true)`. One-line swap in `admin/public/app.js` `confirmModal`. Lesson: the sandbox test drove the API, not the buttons — click-test confirms next time.

**Two gaps Danny hit as a non-Zoho user (both real):**
1. **Wrap-up outcome/note went nowhere without Zoho** — saved to `calls.disposition` / `calls.wrap_up_note` but no screen read them. FIXED this session (desktop, uncommitted at time of writing): `GET /api/calls` now returns `wrap_up_note`; `DISPOSITIONS` exported from `PostCallScreen.jsx`; `CallsTab.jsx` expanded row shows an **OUTCOME** block (label + note) above recording/summary. `vite build` ✓. No installer needed.
2. **Desktop app can't be used for trials** — `electron/main.js` line 30 hardcodes `APP_URL` to BTI's Railway URL, so the installed Mac/Windows app only ever talks to BTI's server (Danny's `amelia.cbia` login failed there). **NEXT SESSION:** one installer for everyone — first-launch "server address" screen (stored in userData), `APP_URL`/`APP_ORIGIN`/updater follow it; branding already comes from the server. Needs new Windows installer + Mac DMG → 1.6.0. Per-customer builds rejected.

Also: Danny's Mac now has `~/Dev/bti-voice` at the dialog-fix commit; desktop was behind it with uncommitted edits (docs + this call-history change) — desktop must `git pull` before committing.

## 8u. 2026-10-02 (Danny, Mac) — BTI HUDDLE v0.1 built: video calls, screen share, meetings, team chat (flag-gated, OFF by default)

**What it is.** A sibling app to BTI Voice living in the same repo, same server, same login (`bti_token`): internal video calls, screen share, meeting links, and agent-to-agent chat — the "Teams/Slack-lite" for BTI's own team and, later, a toggleable product feature per customer. Four commits from the Mac, all pushed (`d7b164d` core, `d1e72dc` Settings panel, `e698cd6` macOS sidebar spacing, `5db8880` chat). Desktop pulled 2026-10-03.

**It ships INERT.** Every Huddle surface 404s / falls through to the Voice SPA unless the deploy sets **`ENABLE_HUDDLE=true`**. `deploySettings.js` has a new feature key `huddle`, and unlike the other keys a *missing* toggle means OFF (`on('huddle') && env.ENABLE_HUDDLE === 'true'`), so BTI / CBIA / any existing deploy saw zero behaviour change from the push. The portal toggle can still switch it off on a deploy that has the env var.

**Server** — `server/routes/huddle.js` (`GET /api/huddle/ice` = Twilio Network Traversal STUN/TURN creds, cached; `POST/GET /api/huddle/rooms`, `GET /rooms/:code`), `server/routes/huddleChat.js` (list / create with DM dedupe / history paging / send / mark read / pin / rename / add members / leave), `socket.js` (WebRTC signaling relay, room presence, direct-call ringing, `chat:*` fan-out + typing relay), `db.js` tables `huddle_rooms`, `huddle_chats`, `huddle_chat_members`, `huddle_chat_messages`. Chat messages are Postgres rows over the existing socket — **never SMS/Twilio**, so volume costs nothing. `index.js` mounts `/api/huddle` + `/api/huddle/chats` and serves `server/public-huddle` at `/huddle` only when the flag is on. Root `npm run build` now also builds `huddle/`.

**Web client** — `huddle/` (Vite + React, served at `/huddle`): shared login, people list with presence + Call, meeting links `/huddle/m/<code>` (create / copy / join by code), peer-to-peer mesh WebRTC with perfect negotiation, mute / camera / screen share as a second track, presenter layout, incoming-call banner. **Settings** (avatar or gear, bottom-left): status chips (Available / Busy / DND / BRB / Away — writes the same `agents.status` Voice shows), camera picker with preview, mic picker with level meter, speaker picker + test sound (where `setSinkId` is supported), About, Sign out; device choices persist per install in localStorage. **Chat tab**: Pinned + Recent, DMs and named groups, day separators, typing indicator, Enter to send, scroll-up history, "Call" rings everyone in the chat, toast on new messages when not viewing that chat.

**Desktop shell** — `electron-huddle/` (`bti-huddle-desktop` 0.1.0, productName "BTI Huddle", appId `com.businesstechnologyinsight.bti-huddle`): big-window Electron app loading `/huddle`, remembers bounds, native screen-share picker (macOS 15+ system picker), camera + mic entitlements, dock-bounce on new chat message (preload hook — needs an app rebuild to take effect). `build-mac.sh` mirrors Voice's unsigned-then-ad-hoc-sign flow and outputs to `dist-electron-huddle/`. **No Windows build yet.** ⚠ `build-mac.sh`'s header comment still says `BTI Huddle-1.2.0` — copy-paste from Voice; the real version is 0.1.0. ⚠ Same `APP_URL` hardcoding problem as Voice's `electron/main.js` (§8t) — check before building for anyone outside BTI.

**Not done / unverified:**
- Not runtime-tested on Railway or between two real people yet. First test: set `ENABLE_HUDDLE=true` on BTI's own service, open `/huddle` in two browsers (Danny + Paul), call, share screen, send a chat.
- Nothing in the docs mentioned Huddle until this entry: `.env.example` had no `ENABLE_HUDDLE` (added 2026-10-03), DEPLOY-RUNBOOK doesn't cover it, the portal plan's feature list predates it.
- Does the portal's Features tab render the new `huddle` key? (BTI Portal's btivoice module and the old `admin/` both read `/api/tenant/settings` — if the key list is hardcoded there, the toggle is missing.)
- Twilio NTS (TURN) relays are billed per GB when a direct P2P path fails — fine for internal use, worth watching before customers get it. Mesh WebRTC also means call quality drops with more than ~4–5 participants; an SFU is a later problem.
- The four commits carry `Co-Authored-By: Claude` trailers despite the no-attribution rule — already pushed, left alone; don't repeat.

## 8v. 2026-10-03 (Danny, desktop) — CALL LISTS (dialer lists) v1 built, flag-gated OFF

**What it is.** A "Lists" tab in BTI Voice: load a list of people to call, work through it with a **Next** button, and let the existing wrap-up screen record the outcome against the entry. Closing dispositions (demo scheduled, not interested, wrong number, existing customer, other) move the entry to a grey **Done** view; no answer / left voicemail / busy / callback keep it on **Remaining** with an attempt count. Plan + the decisions Danny made (owner + share setting, keep-with-attempt-count, Done view + "Remove completed", callback date, local time, dated order, tasks = the existing Zoho task): **`docs/BTI-Voice-Call-Lists-Plan.md`** (§8 = build inventory). **Decision: it lives in Voice, not Huddle** — the feature is placing calls and logging them, which is Voice's machinery; putting the list in Huddle would be the remote-dial pattern rejected in August (plan §1).

**Scope fence (Paul's "stop before it becomes a telemarketing CRM"):** no scripts window, no saved-search builder (Zoho custom views ARE the saved search — import one), no pipeline/stages/auto-dialling. Parked list in plan §2. Tweak after Paul has used it.

**It ships OFF.** New feature key `call_lists` in `deploySettings.js` resolves `on('call_lists') && env.ENABLE_CALL_LISTS === 'true'` — same rule as Huddle, so BTI/CBIA saw no change from the push. Every `/api/call-lists/*` route 404s and the tab is hidden until **`ENABLE_CALL_LISTS=true`** is set on BTI's Railway service. The portal's Features tab shows the toggle (labels added for `huddle` + `call_lists` in `admin/public/app.js`); it can only turn it *off*.

**Server** — `db.js`: 4 tables `call_lists` (name, notes, owner, visibility owner|all|agents, source, zoho view, max_attempts), `call_list_agents`, `call_list_entries` (phone E.164 UNIQUE per list, display_name, company, region, zoho_record_id/module, status open|done, attempts, last_outcome, callback_at, held_by/held_at, closed_by/closed_at, **added_at + import_batch**), `call_list_attempts` (one row per outcome, links `calls.id`). `helpers/callLists.js`: pure rules `applyOutcome` / `compareEntries` + `recordOutcome` (transaction: attempt row + entry update + socket `call_list_updated`). `helpers/areaCodeTz.js`: NANP area code → IANA zone for the contact's local time (Zoho State refines the straddling codes like 850). `routes/callLists.js`: CRUD (owner-only edit/delete), `GET /:id?view=open|done` sorted for working (due callbacks → untried oldest-added first → fewest attempts → future callbacks last), manual add (`POST /:id/entries`), hold/release (30-min stale rule, 409 if someone else has it), outcome, reopen, `DELETE /:id/entries/:eid`, `POST /:id/remove-completed`, `GET /:id/export.csv`, `GET /zoho/views?module=` + `POST /:id/import/zoho` (Zoho v2 `custom_views` + `?cvid=` paging, 200/page, 5k cap; **404 without Zoho creds**). **Wrap-up hook:** `POST /calls/:id/wrap-up` accepts `list_entry_id` (+ `callback_at`) and records the attempt in the same request; never fails the wrap-up. Tests: `server/test/callLists.test.js` (11) — `npm test` = 45/45.

**Client** — `components/tabs/CallListsTab.jsx` (lists pane + list detail, split at ≥900px, phone = two screens; New list / Edit / sharing / max attempts; Import Zoho view (Zoho deploys only) / Add number (paste lines); Remaining/Done; ⋯ menu = Export CSV, Edit, Remove completed, Delete; row expand = history + Message + Remove; local time with 🕒 when it differs from yours, amber outside 8am–8pm). `components/ListOutcomeStrip.jsx` = No answer / Left voicemail / Busy / Wrong number / Skip for calls that **didn't** open the wrap-up (unanswered or < 15 s). `App.jsx`: `dialFromList()` sets `listEntryRef`; `handleCallEnded` attributes the call to the entry only if the number matches, then opens the wrap-up with `call.list_entry` or the strip; after either, the app returns to the Lists tab; skipping the wrap-up releases the hold. `PostCallScreen.jsx`: list name in the header, "Call back on" datetime when *Callback requested* is picked on a list call (Zoho deploys: pre-fills the follow-up task with that date), sends `list_entry_id`/`callback_at`. `BottomNav.jsx`: Lists tab (between Calls and Dialpad) only when `features.call_lists`. `features.js` default `call_lists:false`; `api.js` endpoints.

**Tested 2026-10-03 in the sandbox** against a real Postgres 16 + the built client in headless Chromium: migrations, create/add/dup/invalid, hold conflicts between two agents (409), wrap-up hook with callback date, max-attempts auto-close, reopen, remove-completed, CSV, visibility (owner / all / agents, 403 on foreign edit), 404s with the flag off, wide + phone layouts render with zero page errors. Found + fixed one bug: Postgres "inconsistent types for $2" in the closed_at CASE (now a boolean param). **NOT tested:** a real Twilio call end-to-end (wrap-up → entry), the Zoho view import against the live CRM, the phone-size outcome strip. ⚠ **Likely first blocker on the Zoho import:** BTI's Self Client refresh token has scopes `ZohoCRM.modules.ALL,ZohoCRM.users.READ` (gotcha #5); listing custom views needs **`ZohoCRM.settings.custom_views.READ`** too. If the view picker says the scope is missing: Zoho API Console → Self Client → Generate Code with scope `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.settings.custom_views.READ` → exchange for a new refresh token → replace `ZOHO_REFRESH_TOKEN` on Railway (do NOT revoke the old one until the new one works — it powers all sync). Reading the view's records (`?cvid=`) only needs the modules scope.

**Addendum 2026-10-05 (Danny, desktop):** live on BTI (`ENABLE_CALL_LISTS=true`); Zoho refresh token regenerated with `ZohoCRM.settings.custom_views.READ` (runbook §5 updated) so the view picker works. Fixed: Zoho-view error toast loop (`toast` from `useToast()` is a new object every render — never put it in effect/callback deps; `CallListsTab` uses a ref), ⋯ menu off-screen at phone width (now `position:fixed`, clamped; Import/Add get their own row below 900 px). **Outcome → Zoho:** the wrap-up disposition now lands on the Zoho **Call** record — Subject gets " — Demo scheduled" and Description "Outcome: Demo scheduled." Two paths: `routes/zohoSync.js` log-call includes `calls.disposition` when it's already set (wrap-up saved before the 60 s sweep), and `routes/calls.js` wrap-up patches the existing record via new `zoho.updateZohoCall()` when the sweep got there first. `Call_Result` is left alone (Zoho picklist — custom values get rejected). Strip outcomes (no answer / voicemail / busy) stay in BTI Voice; the Call record itself is still auto-logged as "No answer".

**Today view (2026-10-05, Danny's ask):** third toggle Remaining / **Today** / Done. Today = open entries whose `callback_at` is on or before the agent's local end-of-day (overdue included; the client sends `?before=<local 23:59 ISO>`, server returns `today_count`). Feeds: the wrap-up's "Call back on" date (now shown for *Callback requested* **and** *Left voicemail*), or — if left blank — the follow-up task's due date at 9:00 local. Rule change in `helpers/callLists.js`: a callback date sticks for any retaining outcome, not only callback_requested (test updated). Next on the Today view dials the earliest due callback. Rows render like Remaining with ⏰ when due.

**Turn it on (Danny):** Railway → `bti-voice` → Variables → `ENABLE_CALL_LISTS=true` → redeploy → the Lists tab appears after a reload (desktop app: quit from tray + reopen). First real test: New list → Import Zoho view (Leads) → Next → let it ring out → strip → No answer; call again, answer, > 15 s → wrap-up → Callback requested + date → entry shows ⏰ when due.

## 8w. 2026-10-05 (Danny, desktop) — Review Pass 2, batch 1: credential scrub
- Review report `docs/BTI-Voice-Review-2026-10.md` §2 row 1 (§5 A1/A2). Docs-only change, no code.
- Removed every live secret from the working tree: Railway public `DATABASE_URL` (§2 above + `docs/archive/BTI-Voice-Session-Handoff.md`), Zoho Voice port-out account number + transfer PIN (TODO), App Audit StatiCrypt password (`App-Audit-Handoff.md`), seed-account password tables (`SETUP.md`, `_claude-context/context_2026-04-15.md`), and the lines naming which team accounts were still on the `username123` default. Replaced each with a pointer to the password manager / Railway Variables.
- Left in place on purpose: Twilio Messaging Service / TwiML App SIDs and phone numbers (identifiers, not credentials); `server/seed.js` demo passwords (code, gated by `SEED_DEMO` — review §3 D5 handles that in a later batch).
- **Rotation DONE 2026-10-05 ~14:10 ET** (commit `eb73f6d` = the scrub). Procedure that actually worked is in DEPLOY-RUNBOOK §10. `bti-voice` → `DATABASE_URL` is now the reference `${{Postgres.DATABASE_URL}}` (it had been a pasted string). The password in git history is dead; `git filter-repo` deferred.
- Rule going forward: **no secret values in `docs/`, the handoff, the TODO or context snapshots** — write "in the password manager under <name>" or "Railway → <service> → Variables" instead.

## 8x. 2026-10-05 (Danny, desktop) — Review Pass 2, batch 2: session revocation (per-device)
- Review §2 row 2 / §5 A3. Before: `requireAuth` only verified the JWT signature, `/auth/refresh` re-minted from the old payload, portal deactivate/reset and a self password change only touched the `agents` row → a removed employee's desktop app kept working (and renewing itself) for up to 30 days.
- **Design (Danny's call: per-device, "separate apps, not two windows into one login"):**
  - `agents.token_version` (new column, default 0) = the *sign-out-everywhere* switch; the JWT carries it as `tv`.
  - New `sessions` table = one row per sign-in / device (`id` = 48-hex random, `agent_id`, `remember`, `platform`, `user_agent`, `expires_at`, `last_seen_at`, `revoked_at`); the JWT carries its id as `sid`. Rows past expiry + 7 days are deleted at boot.
  - `server/helpers/sessions.js`: `check(payload)` — one query (`agents` ⟕ `sessions`), **30 s cache per session id** → rejects if the agent is inactive, `tv` ≠ `token_version`, or the session row is missing/revoked. `createSession`, `touchSession` (sliding 30 d on refresh), `revokeSession(sid)` (one device), `revokeAllSessions(agentId, {except})` (bumps `token_version`, revokes every row, force-disconnects the agent's sockets — except the kept device). Pattern copied from `admin/auth.js` (fresh-from-DB per request) plus the cache.
  - `server/auth.js`: `requireAuth` and `requireMediaAuth` are now **async** and run the check; failures are `401 { code: 'session_revoked' }` with a human message. Media-scope tokens only need the agent to still be active. `generateToken(agent, { remember, sid })` adds `sid` + `tv`.
  - `server/socket.js`: handshake runs the same check; `socket.data.sid` lets a per-device sign-out drop only that socket.
  - `server/routes/auth.js`: `/login` creates the session row; `/refresh` re-reads the agent row (picks up renames + current `tv`), touches the session, and **upgrades legacy tokens** (no `sid`) into a session row; new **`POST /auth/logout`** revokes *this device only*.
  - `server/routes/agents.js` `/me/password`: revokes every *other* device, returns a fresh `token` for this one. `server/routes/tenant.js` PATCH `/agents/:id`: `is_active:false` or `reset_password:true` → `revokeAllSessions`.
  - Client: `api.js` fires `bti-session-revoked` on any `401 session_revoked` → `App.jsx` signs out and shows the server's message on the login screen (reuses `bti_blocked_msg`); Sign out calls `/auth/logout` first; `SettingsTab` stores the fresh token after a password change; `socket.js` reads the token on every (re)connect instead of once at creation.
- **Compatibility:** tokens minted before this deploy have no `sid`/`tv` → treated as version 0 with no session row → keep working, get a session row on the next app start, and die with everyone else on a `token_version` bump. **Nobody is logged out by the deploy itself.** Revocation lands within ≤ 30 s (cache) — immediately for the socket.
- Tests: `server/test/sessions.test.js` (12 cases, injected query, no DB) — 57/57 pass; `vite build` clean. **Not runtime-tested on Postgres** — verify after deploy (TODO batch 2 entry has the checklist).
- No new env vars; migration is automatic at boot (`[db] Migrations complete.`). Railway redeploys `bti-voice` and `cbia-voice` on push (same repo).
- Left for later batches: login throttle / min password length (A4, batch 3); socket `scope` + `loginAllowed()` (B4); a "Sessions" list in Settings / portal (sign out one device from another) — the table already has what it needs (`platform`, `user_agent`, `last_seen_at`).

## 8y. 2026-10-05 (Danny, desktop) — Review Pass 2, batch 3: login throttle, rate limit, helmet, CORS
- Review §2 row 3 / §5 A4 + B8 (and §3 B12 for free). Before: no brute-force protection on `/api/auth/login`, no rate limit anywhere, no security headers, `cors()` + socket.io `origin: '*'`, no minimum password length, `trust proxy: true` (client-spoofable `req.ip`).
- **Login throttle** — `server/helpers/loginThrottle.js`, copied from the portal (`admin/auth.js`): 10 failed attempts per *username* per 15 min, in memory, `429 "Too many failed attempts. Try again in 15 minutes."`, checked before the password (never confirms a guess on a throttled account), cleared on a successful login. Failed logins now log `[auth] failed login for "<user>" from <ip>` like the portal. `/login` also guards a missing username/password (400) instead of the old TypeError (review §3 B7).
- **Rate limits** — `express-rate-limit` in `server/index.js`, per client IP, JSON 429s with `error` so the app shows them: whole `/api` 300 / min (skips `/api/health` — the desktop offline page polls it every 5 s — and `/api/features`); `/api/auth/login` 30 / 15 min per IP (the per-username throttle is the other axis); `/api/track` 60 / 15 min; `POST /api/diagnostics` 10 / 15 min. **Not** limited: `/webhooks/*` (Twilio-signed), socket.io (not under `/api`), `/api/tenant` (portal calls fit under the global limit). `express.json` limit made explicit at 100 kb (diagnostics logs are capped at 60 k chars client-side).
- **helmet()** with deliberate exemptions, each tied to a real client: `contentSecurityPolicy: false` (a real CSP for the SPA + Twilio SDK is its own batch); `crossOriginOpenerPolicy: false` (the Zoho widget opens the call popup with `window.open()` from inside Zoho CRM — COOP would sever the opener/popup-blocked check); `crossOriginResourcePolicy: cross-origin` (the iOS/Android apps load recordings + MMS images cross-origin); `frameguard` applied to everything **except `/zoho-widget/*`**, which lives in an iframe inside Zoho CRM. HSTS, nosniff, Referrer-Policy etc. are on.
- **CORS** — `server/helpers/origins.js`, shared by Express and socket.io: `SERVER_URL` + `capacitor://localhost` (iOS) + `https://localhost` (**Android** — `client/capacitor.config.json` has `androidScheme: "https"`, so the review's `http://localhost` alone would have broken the Android app) + any `http(s)://localhost[:port]` (vite dev) + optional **`CORS_ORIGINS`** env (comma-separated extras, e.g. a future custom domain). Requests without an Origin header (curl, Twilio, portal→deploy, Electron's own fetches) are allowed — CORS is browser-only. Everything else is same-origin and never consults the list: web app, Huddle, Electron (loads the server URL directly), the Zoho widget + popup (served from `/zoho-widget`, `BASE = location.origin`).
- **`trust proxy: 1`** (was `true`) — Railway is one hop; same as the portal; express-rate-limit refuses to key by IP with `true`.
- **Min password length** — `PATCH /api/agents/me/password`: new password must be a string ≥ **10** chars (the portal's change-password rule) and differ from the current one; 400 with a message. Client: `api.changePassword()` added to `client/src/api.js` and `SettingsTab` → Profile uses it instead of a raw relative `fetch` that swallowed every error — the server's message now shows, and it works on iOS/Android (review §3 B5 fixed as a side effect); client also pre-checks the 10-char rule.
- Tests: `server/test/loginThrottle.test.js` (5) + `server/test/origins.test.js` (7) — **69/69** pass; `vite build` clean; middleware smoke-tested in a throwaway Express app (headers, widget iframe exemption, iOS/Android/evil origins, preflight with PATCH + Authorization, login 429 JSON, health skipped). **Deployed + verified on Railway 2026-10-05 ~15:00 ET** (Zoho widget iframe + call popup, phone-app media, desktop app, password rule, throttle all OK).
- **Deploy:** no new required env var, no Railway change. `CORS_ORIGINS` is optional (runbook §7, `.env.example`). Push → `bti-voice` + `cbia-voice` redeploy as usual; nobody is signed out.
- Left for later: force a password change when `default_password` is true (A4's last bullet — a UI flow); a real CSP; the portal itself has no helmet/rate-limit either (out of scope today); socket `scope` + `loginAllowed()` (§5 B4); throttle counters reset on redeploy (same trade-off as the portal).

## 8z. 2026-10-05 (Danny, desktop) — Review Pass 2, batch 4: TwiML injection + call ownership
- Review §2 row 4 / §5 A5. Before: `POST /api/calls/resume` and `/transfer` built TwiML by string-interpolating `agentId` / `targetAgentId` straight from `req.body` (`<Client>agent_${agentId}</Client>`), so any signed-in agent could inject `</Client><Number>+1900…</Number>` and send a live PSTN leg anywhere; `/hold`, `/resume` and `/transfer` never checked that the call belonged to the requester, so anyone could hold/redirect a teammate's call by SID; `resolveParentSid()` swallowed Twilio fetch errors and tried the raw SID anyway.
- **New `server/helpers/callControl.js`** (pure, unit-tested): `parseAgentId` (positive integer or numeric string only — rejects `5</Client>…`, floats, 0, negatives), `isCallSid` (`CA` + 32 hex), `holdTwiml()` / `dialAgentTwiml(agentId, serverUrl)` built with `twilio.twiml.VoiceResponse` and **byte-identical to the old strings** (`<Dial timeout="30" action=".../webhooks/voice/no-answer" method="POST"><Client>agent_N</Client>` — the no-answer webhook still logs the leg), `callBelongsToAgent({ call, parent }, agent)` = the browser leg's `from`/`to` is `client:agent_<id>` **or** the PSTN/parent leg's `from`/`to` is the agent's own `phone_number` (digits-normalised; `'TBD'` never matches). Works on a *completed* browser leg, which matters: after Hold the agent's leg has already hung up and Resume still has to pass.
- **`routes/calls.js` hold/resume/transfer** now share `authorizeCallControl()`: `400 "A valid callSid is required"` → fetch the call + its parent from Twilio, `404 "Call not found"` if Twilio doesn't know it (no more blind fallback) → load the requester (`id, phone_number`, must be active) → `403 "This call isn't yours to control"` unless `callBelongsToAgent`. `/resume` always reconnects to **the requester**; the body's `agentId` is still accepted (the client sends its own id) but `400` if not an integer and `403 "You can only resume a call to yourself"` if it names someone else. `/transfer`: `targetAgentId` integer-validated (`400`), must exist **and be active** (`400 "Unknown or inactive agent"`). Twilio API failures → `502 "Call control failed — please try again"` with the real message only in the server log (review §3 B8 for these three routes). Redirect target is unchanged: the parent (PSTN) SID when there is one, else the SID given.
- **Checked, no change needed:** `webhooks/voice.js` builds every TwiML with `VoiceResponse` (`dial.client()` escapes), including `next-agent`'s queue values; `routes/ivr.js` emits no TwiML — it stores settings voice.js later feeds through the helper (its loose input validation is still review §3 B7); `webhooks/sms.js` sends a static empty `<Response/>`. No other `calls(...).update({ twiml })` sites exist.
- Tests: `server/test/callControl.test.js` (11) — **80/80** pass; `vite build` clean (no client change). Route-level smoke with a fake Twilio + fake pool: hold/resume/transfer 200 with the exact old TwiML sent to the parent SID; bad SID 400, unknown SID 404, teammate's call 403, resume-to-someone-else 403, both injection payloads 400, inactive/unknown transfer target 400. **Not runtime-tested on Railway.**
- **Deploy:** no new env var, no Railway change, nobody signed out. Push → `bti-voice` + `cbia-voice` redeploy as usual. Post-deploy checks are in the TODO batch 4 line (hold → resume → transfer between two agents).
- **Post-deploy 2026-10-05 ~15:13 ET: Hold played "Sorry, an application error has occurred. Goodbye" to the caller.** Not the new code — the hold-music URL that had been in the string since day one, `https://com.twilio.music.classical.s3.amazonaws.com/BachGavotteShort.mp3`, is dead twice over: the file no longer exists in Twilio's bucket (S3 `NoSuchKey`) and the bucket-as-hostname form fails TLS (dotted bucket name vs Amazon's wildcard cert), so Twilio could never fetch it. Hold had therefore been broken before this batch; the smoke test only checked the TwiML, not the media. Fixed in `callControl.js`: `HOLD_MUSIC_URL = https://s3.amazonaws.com/com.twilio.music.classical/ClockworkWaltz.mp3` (path-style, verified 200 `audio/mpeg`). Other files in that bucket if the tune should change: `BusyStrings.mp3`, `ith_chopin-15-2.mp3`, `ith_brahms-116-4.mp3`, `Mellotroniac_-_Flight_Of_Young_Hearts_Flute.mp3`, `MARKOVICHAMP-Borghestral.mp3`. Lesson for the TODO: self-host hold music in the repo eventually so a third-party bucket can't break Hold again.
- **Post-deploy 2026-10-05 ~17:00 ET (after the music fix): caller hears music, but the DESKTOP APP behaves as if Danny hung up** — panel clears, call logged, wrap-up can pop; no way to Resume. **Hold has never worked end-to-end; this is the original design, not batch 4.** Mechanics: inbound caller ↔ agent is one `<Dial><Client>`. `/hold` replaces the *caller's* TwiML with `<Play>`, which ends that `<Dial>`, so Twilio hangs up the agent's browser leg → Twilio Voice SDK fires `disconnect` → `App.jsx handleCallEnded()` (clears `activeCall`, `api.logCallByPhone`, wrap-up if ≥ 15 s). Outbound is worse: the browser leg *is* the parent, so `/hold` redirects the agent into the music and drops the customer. `/resume` as written could only ever work by ringing the agent again, and the UI has already thrown the call away. Transfer is unaffected (we disconnect on purpose). → **Batch 4b, next session** (plan in TODO).
- Left for later: `ActiveCallPanel.jsx` only `console.error`s a failed hold/resume/transfer — a 403/502 is silent in the UI (UI batch). Hold on an **outbound** browser-placed call redirects the agent's own leg (there is no parent SID) — pre-existing behaviour, worth a look when the in-call UI is revisited. Review §3 B7 (validate IVR settings input) still open.

## 8aa. 2026-10-06 (Danny, desktop) — Review Pass 2, batch 4b: Hold rebuilt on a conference room
- **Decision (Danny):** Option 2 — conference-based Hold — but the "get it working" shape: calls still RING through the existing `<Dial>` chains (ring-all, sequential, no-answer, IVR, voicemail, per-number routing all untouched); the **first Hold moves both legs into a Twilio Conference room** named `bridge-<customerCallSid>` and the call stays there. Hold/Resume are then participant hold on/off and the agent's browser leg is never dropped — the desktop panel, timer and wrap-up carry on. "Ringing inside the conference from the first ring" (one continuous recording, warm transfer, listen-in) is the roadmap item after the review + design batches (TODO). Option 1 (reconnect-style, client auto-answers a ring-back) was rejected: no commercial product ships that way.
- **The move, mechanically** (`server/helpers/callControl.js` header has the same text): redirect the CHILD leg of the `<Dial>` into the room first; that ends the parent's `<Dial>`, whose action webhook finds a pending move for that parent SID (`registerMove`/`takeMove`, 30 s TTL) and answers with the same room instead of hanging up. Inbound: child = agent, parent = customer → action = `/no-answer` or `/next-agent`. Outbound: child = customer, parent = agent → action = new `/outbound-done` (the outbound `<Dial>` now has `action=`; with no pending move it returns `<Hangup/>`, which is what happened implicitly before). The `/conference` status webhook (events `join leave end`) puts the customer on hold the moment they land (`holdOnJoin`), and when the customer LEAVES the room (hung up) it ends the agent's leg via REST so the app ends the call normally — unless `transferring` is set (Transfer/hangup make the customer leave on purpose). Agent leg: `endConferenceOnExit=true` (agent hangs up → room closes → customer's line drops); customer leg: `false`. `waitUrl=""` = silence while alone. Participant `holdUrl` = new `/webhooks/voice/hold-music` (`<Play loop="0">` the S3 waltz — swap the URL there to self-host later).
- **Which leg is the customer** — `identifyLegs({ call, parent, children })` (unit-tested): a client leg WITH a parent → customer = parent (inbound; or a transferred leg — direction `outbound` if the parent is itself a child), a client leg WITHOUT a parent → customer = its live child (`client.calls.list({ parentCallSid })`). `authorizeCallControl` now returns `legs` + `room`; `409 "The other side of this call could not be found"` if it can't tell. **Fixes the pre-existing outbound bug** where hold/transfer redirected the agent's own leg (`targetSid = parent || self`) — transfer on an outbound call now moves the customer.
- **Routes (`routes/calls.js`):** `/hold` → room exists? participant `hold:true` : upgrade (create in-progress row, `setRoom`, `registerMove`, redirect child) — returns `{ customerCallSid, upgraded }`; body accepts `recordingOptOut` (Dialpad "Don't record" → no conference recording). `/resume` → participant `hold:false`, `409 "This call isn't on hold"` if no room. `/transfer` → marks the room `transferring`, redirects the CUSTOMER leg to `dialAgentTwiml(target)` (from a bridge or a room). **New `/hangup`** → ends the customer leg (used by the app when you End call while they're on hold). Same 400/403/404/502 rules as batch 4.
- **One row per call:** first Hold creates the `calls` row with `status='in-progress'` (keyed by the customer SID for inbound, the agent's own leg SID for outbound — the same SIDs the other loggers use), so the mid-call `<Dial>` recording has a row to attach to and nothing logs a second row. `helpers/callRows.js finalizeInProgressCall()` fills duration (GREATEST of what each logger knows)/status/ended_at/agent_id, fires the Zoho sync and `call_logged`; called from `autoLogCall`, `/status` and `log-by-phone` wherever they used to "already logged — skip". `/no-answer` logs a customer leg that has a `ParentCallSid` as **outbound** (transferred outbound call) instead of inbound. A row briefly shows "in-progress" in Calls history while the call is live.
- **Recording in parts (Danny chose (a)):** `<Dial record>` ends at the first Hold = part 1; the room is recorded `record-from-start` = part 2 (both legs carry the record/statusCallback attrs because Twilio takes conference-level attrs from whichever leg creates the room). Conference recording callbacks have no `CallSid`, so `recording-complete?call=<rowSid>&part=conference`. New table **`call_recordings`** (`call_id, part, recording_sid UNIQUE, recording_url, duration`) — every recording is a numbered part, `calls.recording_url` keeps pointing at part 1 (Zoho sync/old clients unchanged). `GET /api/calls` adds `recording_parts`; `GET /api/calls/:id/recording?part=N`; Calls tab shows "RECORDING · PART 1 OF 2 / PART 2 OF 2 (after hold)" with separate players + downloads. Transcription of part 2 is appended to part 1's text with `[Call resumed after hold]` and the AI summary is rebuilt from the whole transcript. A call with no Hold = one part, exactly as before.
- **Client:** `ActiveCallPanel.jsx` — Hold passes `call.customNoRecord`; red toast on failed hold/resume/transfer (closes the batch-4 "silent 403" leftover); End call while on hold calls `/hangup` first; the ⏸ ON HOLD badge/timer are unchanged and now actually stay on screen. `api.js` — `holdCall(callSid, recordingOptOut)`, `hangupCall`. `App.jsx` needed **no change**: the agent leg only disconnects at the real end, so `handleCallEnded`/wrap-up fire once. Electron mini-widget untouched.
- **Tests:** new `server/test/callBridge.test.js` (10) — **90/90** pass; `vite build` clean. Route smoke with a fake Twilio + fake pool (not committed; script was in `Talkingvet Help/_smoke/`): inbound first Hold redirects the agent leg to the room TwiML → `/no-answer` with the pending move answers room TwiML (endOnExit false) → `participant-join` → participant hold with the hold-music URL → Resume → hold:false → second Hold → participant hold (no upgrade) → `participant-leave` → agent leg `status=completed` → `/status` finalises the in-progress row (1 row, duration 125). Outbound: first Hold redirects the customer child → `/outbound-done` answers room TwiML, and `<Hangup/>` with no pending move → `log-by-phone` finalises the outbound row (1 row). Transfer from a room redirects the customer; `/hangup` ends the customer; unknown SID 404; resume-to-someone-else 403. **Not runtime-tested on Railway.**
- **Deploy:** no new env var (`SERVER_URL` must be set, as it already is), **no Twilio console change** (conference webhooks are in the TwiML we send). Push → `bti-voice` + `cbia-voice` redeploy; the `call_recordings` migration runs on boot. Post-deploy test list is in the TODO batch 4b line. If Hold misbehaves: Railway log lines are `[hold] upgrading … child=… parent=…`, `[no-answer]/[outbound-done] … → room …`, `[conference] participant-join/leave …`; Twilio Monitor → Errors gives the error code.
- **Known rough edges / later:** the customer hears ~1 s of silence between pressing Hold and the music (the move); a `[conference] could not end agent leg` warning after a normal hang-up is harmless (the leg is already completed); hold music is still Twilio's S3 waltz (self-host via `/hold-music` later); the Electron mini-widget has no Hold button; roadmap = ringing inside the conference (TODO).

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
12. **Long-running tray-resident app goes stale and outbound dialing dies silently (seen 2026-08-25, Paul).** Symptom: dial starts then immediately stops; NO call row is ever created (the dial never reaches the server) while everyone else calls fine. Cause: the desktop app had been resident in the tray for days — the in-page calling session (Twilio device/token state) had gone stale. Fix: fully restart the app (tray icon → Quit, or Task Manager) — closing the window is NOT a restart (see gotcha 11). Diagnosis recipe that worked: check `calls` table (no rows = client-side), have another agent place a test call (isolates the machine), then restart. The Settings → About → Report a problem diagnostics upload is the tool for capturing the exact client error if a restart doesn't fix it.

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
