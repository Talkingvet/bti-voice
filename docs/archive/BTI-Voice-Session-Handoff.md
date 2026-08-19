# BTI Voice — Session Handoff (updated 2026-08-11, back on Windows)

**Purpose:** Give any Claude session (on any machine, Windows or Mac) full context to continue BTI Voice work. Point Claude at this file at the start of the session. Update it at the end of significant sessions.

## What BTI Voice is
Internal VOIP/SMS desktop app (Electron + React client served from Railway, Node/Express + Postgres backend on Railway, Twilio for calls/SMS, Zoho CRM deeply integrated, OpenAI for transcription/summaries). Built by Danny at Business Technology Insight. Used by BTI/Talkingvet staff to talk to leads/prospects/customers. Talkingvet sells AI scribing TO veterinarians — it is not a vet clinic. BTI Voice is internal-only, not a product.

- **Repo:** https://github.com/Talkingvet/bti-voice (private). Railway auto-deploys on push to main.
- **Server:** https://bti-voice-production.up.railway.app (also usable directly in a browser on any machine)
- **Windows repo path:** `C:\Users\Doero\OneDrive\Documents\Claude\Projects\Talkingvet Help\bti-voice`
- **Mac repo path:** `~/Documents/Claude/Projects/BTI Voice/bti-voice` (fresh clone 2026-08-11; `bti-voice-old` beside it is safe to delete)
- **Current version:** v1.5.0 (bump commit b6cf6b2; Mac DMGs on the GitHub release; Windows exe attach + Railway LATEST_VERSION confirm were the last open release steps)

## Mac session 2026-08-11 (Paul + Claude) — summary
- Version bump 1.4.0→1.5.0 committed/pushed from Mac (b6cf6b2) + v1.5.0 tag. Mac DMGs (arm64 + x64) built via `bash electron/build-mac.sh` and attached to the v1.5.0 GitHub release.
- **UI quick wins shipped (1f44e83, deployed & verified):** "Automated" label on auto-replies, 520px bubble cap, shared `client/src/utils/phone.js` formatting everywhere, "#" avatars for unnamed contacts, FAB hidden on Settings/Notifications + list padding, "/" hint moved into compose placeholder.
- **New Message modal upgrade (044d8fd, deployed):** paperclip MMS + clock scheduled-send in the modal; new endpoint `POST /conversations/ensure` (find/create conversation without sending) so the modal reuses `/messages/send` + `/messages/schedule`. Known limits: scheduled+MMS combo blocked (no server support); media/scheduled sends always go out as the signed-in agent regardless of FROM dropdown (inline note shown).
- Full macOS UI review saved as `BTI-Voice-macOS-UI-Review.md` (16 findings; quick wins done, remaining open: light theme broken, split view for wide windows, badge count, Esc on popovers, app icon, etc.). Minor nit: compose placeholder wraps/clips at narrow width.
- Mac 1.5.0 app properly installed in /Applications (was running from mounted DMG). Incoming-call banner smoke test still pending full verification (call the test number, banner should appear without stealing focus, Accept/Decline work).

## Current state (all deployed & tested unless noted)
- **A2P 10DLC:** APPROVED 2026-08-10. Campaign `CMfd0e9fce40b23947271a9a25913af389`, Brand `BN640d79e8132a73b58d9bfc2224bfde54`, Messaging Service `MG72b937a8bdfdb4948e7ce808774b3765` (Low Volume Mixed, ~200 msg/day/number). Twilio has ONLY a test number (+12396667033, assigned to agent "danny" in DB). Real numbers live in Zoho Voice; will be PORTED later, only after extensive testing proves BTI Voice out. Two dead duplicate messaging services in the Twilio console (MGb736..., MGd6ec...) — harmless leftovers.
- **v1.5.0 SMS features (built 2026-08-10/11):**
  - Messaging Service routing on all 3 send sites (env `TWILIO_MESSAGING_SERVICE_SID` set in Railway)
  - STOP/START opt-out: contacts.opted_out, webhook keyword handling, 403 blocks, error-21610 mirroring, red banner replaces compose in ChatPanel
  - Templates: canned_responses + Settings→Calls management UI; 6 compliant templates seeded ("Talkingvet:" prefix, STOP/HELP suffix); type "/" in compose to insert
  - After-hours auto-responder: Settings→Calls section; ivr_settings.after_hours_* + business hours/days/timezone; 4h per-conversation throttle; skips keywords + opted-out
  - Scheduled SMS: clock button in compose (and New Message modal), scheduled_messages table, 30s sweep, cancel chips above compose
  - MMS: paperclip attach (5MB imgs) in compose + New Message modal, inbound capture, message_media table (Twilio URL proxy for inbound, BYTEA + public token for outbound), right-click Copy/Save context menu on images
- **Zoho incident (2026-08-11, RESOLVED):** wrapUpSweep retried 5 stuck calls every 30s forever → ~51K Zoho API calls/day. Fixed: stamped stuck rows + exponential backoff with 8-attempt cap in wrapUpSweep.js. DO NOT revoke the Zoho Self Client token to solve API spikes — it powers all sync.
- **Fixed along the way:** PUT /ivr/settings silently dropped auto_text fields; .gitattributes added (line-ending noise gone); vite timestamp junk removed from repo.

## Key gotchas (hard-won knowledge)
1. **Windows:** Git Bash only (PowerShell blocks npm scripts). Git commands from `bti-voice/` root. `rm .git/index.lock` if git complains about locks (Claude's sandbox git commands create locks it can't remove).
2. **Windows Electron build:** `cd electron && npm run build:win`; output goes to `../dist-electron/` (SIBLING of bti-voice); rename `BTI Voice Setup X.X.X.exe` → `BTI-Voice-Setup-X.X.X.exe` before GitHub upload; release tag `vX.X.X`; update Railway `LATEST_VERSION`.
3. **Mac Electron build:** Terminal → `cd .../bti-voice/electron && bash build-mac.sh`. Both-arch DMGs to sibling `dist-electron/`. Rename with dashes before upload. Must run on the Mac itself.
4. **Mac + Claude:** Claude's sandbox cannot git-clone into the mounted folder — clone in /tmp then copy. Claude CAN commit; pushes need Paul/Danny in Terminal (keychain has GitHub creds).
5. Claude file tools truncate files at template-literal `${...}` — edit server/client JS via python3/bash heredoc instead.
6. External DB access (scripts/direct fixes): `postgresql://postgres:EpfANoVcBduEofAFrNFZmvOhAotreUuV@maglev.proxy.rlwy.net:19870/railway` (Railway public proxy).
7. Agent phone numbers: no UI to assign; use `PATCH /api/agents/me/number` or direct DB update. Agents without numbers silently skip Twilio on send. Only "danny" has the test number.
8. Editing the A2P campaign costs ~$15 vetting + days of wait — only when necessary. Keep Privacy Policy §12 (SMS) intact on talkingvet.com.
9. Zoho refresh token scopes: `ZohoCRM.modules.ALL,ZohoCRM.users.READ`.
10. Don't do git work in OneDrive-synced repo copies on machines other than the primary (sync conflicts corrupt git state).

## Open items / backlog (in rough priority)
1. **Finish v1.5.0 release:** attach Windows exe to existing v1.5.0 GitHub release (do NOT recreate tag); confirm Railway `LATEST_VERSION=1.5.0`. (In progress on Windows 2026-08-11.)
2. **Mac incoming-call banner smoke test** — call the test number from a cell while logged in as danny on the Mac; verify banner, no focus steal, Accept/Decline.
3. **AI-suggested replies** — 2–3 GPT-4 suggestions above compose (OpenAI already wired). Next feature up.
4. **macOS UI review remaining findings** (see `BTI-Voice-macOS-UI-Review.md`): light theme broken, split view for wide windows, badge count, Esc on popovers, app icon, compose placeholder wrap at narrow width, etc.
5. **Zoho hardening:** re-enable contact-ID cache in zohoSync.js resolveZohoId; retry logic for wrap-up note/task pushes; verify Zoho refresh token rotation (exposed April 2026, never confirmed rotated).
6. **Agent number assignment UI** (Settings, admin).
7. **Conversation filters** (agent/date).
8. **Twilio console tidying:** delete 2 dead messaging services; add 911 emergency address to test number.
9. **Bulk/broadcast SMS** — parked (campaign cap ~200/day).
10. Editable disposition codes (PostCallScreen.jsx → settings table).
11. iOS physical device testing.
12. Scheduled+MMS combo support server-side; honor FROM dropdown for media/scheduled sends in New Message modal.

## Working from either machine
- **Use the app:** browser → https://bti-voice-production.up.railway.app, or installed desktop app (Windows exe / Mac DMG).
- **Deploys:** push to main = Railway deploys server+client automatically. Installer builds only for Electron-file changes (or version-label bumps).
- **This file:** keep ONE canonical copy per machine's project folder; update at the end of significant sessions and carry the latest across (or commit it to the repo so it travels with git).
