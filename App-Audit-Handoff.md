# App Audit — Session Handoff (created 2026-08-12, Mac session by Paul)

**Purpose:** Let any Claude session (Windows or Mac, new project or old) continue work on the App Audit tracker. Point Claude at this file first. This is about the *tracker itself* — for BTI Voice app context, point Claude at `BTI-Voice-Session-Handoff.md` as well.

## What the App Audit is

A single-file browser app (`App-Audit.html`) that tracks every app Paul/BTI is building — full specs, security posture, compliance status, roadmap, accounts, and a checkbox punchlist. Built 2026-08-12 by Claude on the Mac. Currently tracks one app (BTI Voice); designed to hold more (+ Add App button).

Opens by double-clicking — no server, no install. Works in any browser.

## The files (all in this folder)

| File | What it is |
|---|---|
| `App-Audit.html` | THE MASTER COPY. Single self-contained file: data + UI + logic. |
| `App-Audit-Website/index.html` | Encrypted copy for web hosting (see Website section). |
| `App-Audit-Website/README-How-To-Publish.md` | Netlify publish/update steps for Paul. |
| `App-Audit-Handoff.md` | This file. |

**Moving to Windows:** copy `App-Audit.html`, the `App-Audit-Website` folder, and this handoff to the Windows machine (or commit them to a repo). Nothing else is needed — there are no dependencies.

## How App-Audit.html works (for the next Claude)

- All content lives in one JSON block: `<script id="app-data" type="application/json">`. Structure: `apps[] → sections[] → cards[] → rows[]`. A row is `{ "l": label, "v": value }`; punchlist rows also have `"done": true/false` which renders a checkbox.
- Sections per app: Overview, Tech Specs & Stack, Security & Compliance, Punchlist, Status & Roadmap, Contacts & Accounts.
- User edits in the browser save to localStorage (key `bti-app-tracker`). "Save Changes to File" downloads a fresh copy of the whole HTML with edits baked in — the user replaces the old file with it.
- **CRITICAL — dataVersion:** top-level `"dataVersion"` (currently **2**). localStorage only overrides the file's data if its dataVersion is >= the file's. **Whenever Claude edits the JSON in the file directly, bump dataVersion by 1** — otherwise the user's browser will keep showing stale localStorage data and the edits will look like they didn't happen. (This also discards the user's un-exported browser edits — warn them first.)
- **The JS deliberately contains NO backtick template literals** (Claude's file tools truncate at `${...}` — hard-won gotcha from BTI Voice work). Keep it that way: string concatenation only.
- Features: search across all tabs, per-card Copy button (plain-text, `[x]`/`[ ]` markers for checklists), Edit mode (contenteditable + add/delete rows), Print/PDF, + Add App (creates a blank template with all six sections).

## The website (password-protected public copy)

- Goal: team can view the audit on any device. Decided 2026-08-12: Netlify free hosting + StatiCrypt encryption (content is AES-encrypted; the link alone shows only a password prompt).
- **Password: `harbor-signal-9214`** (30-day remember per device).
- **Status: NOT yet deployed.** Paul still needs to drag `App-Audit-Website/` onto https://app.netlify.com/drop and create the free account. Once done, record the URL here.
- Re-encrypt after any change to the master file (run from this folder):
  `npx staticrypt App-Audit.html -p "harbor-signal-9214" -d App-Audit-Website --remember 30 --template-title "BTI App Audit" --template-instructions "Team access only. Ask Paul or Danny for the password."`
  then rename the output `App-Audit-Website/App-Audit.html` → `index.html`. Re-drag the folder into Netlify's Deploys page.
- Website viewers' checkbox ticks save only in their own browser — the master file is the source of truth.

## Where the data came from (2026-08-12 snapshot)

Everything was extracted from real sources in this folder — not guessed:
- `BTI-Voice-Preprod-Audit.md` — 26-finding security audit (fix status per finding)
- `BTI-Voice-Session-Handoff.md` — project state, accounts, backlog
- `BTI-Voice-macOS-UI-Review.md` — 16 UI findings
- `bti-voice/` repo — package.json files (versions), .env.example, server/routes layout, git log

Git log at snapshot time showed audit fix batches A (security), B (compliance), C (client bugs) committed — the punchlist's checked/unchecked states reflect exactly that. If more fixes land, update the punchlist (and bump dataVersion).

## Punchlist status at handoff

- Feature Security: 9/18 done (open: media-URL tokens #20, agent impersonation #21, updater #4/#7/#9, Electron nav #10, Mac mic #22, crash handling #23-24, seed accounts #25, DB-password-in-handoff-doc, duplicate-contact cleanup)
- Inventory: 6/8 done (open: .env.example incomplete, no DB schema doc; geoip-lite purpose was verified → activity-log geolocation)
- Compliance: 3/6 done (open: Privacy Policy §12 recurring check, consent-only rule, 911 address)
- Rollout Gate: 2/5 done (open: Mac banner smoke test, Mac update button hidden, new installers after Electron fixes)

## Conventions / decisions made

1. **No secrets in App-Audit.html** — it's meant to be shared. No passwords, no DB URLs, no tokens. (The Railway DB URL with password lives in BTI-Voice-Session-Handoff.md — flagged in the punchlist as a risk.)
2. Twilio Campaign/Brand/Messaging-Service SIDs are OK to include (identifiers, not credentials).
3. Name history: started as "App Tracker" / App-Tracker.html; renamed to **App Audit** / App-Audit.html on 2026-08-12 (Paul's choice). Note the similarly-named BTI-Voice-Preprod-Audit.md is a different thing (the security audit).
4. Paul is a total beginner — explain steps one at a time, define jargon, never assume terminal comfort. He's on Mac here; Windows gotchas (Git Bash only, OneDrive/git conflicts) are in the BTI Voice handoff.

## Open items for the next session

1. **Deploy the website** — Netlify Drop (Paul, 5 min). Then record the URL in this file and in App-Audit.html's Key Links.
2. Keep the punchlist in sync as audit items get fixed (bump dataVersion each file edit).
3. When BTI Voice details change (new version, numbers ported, features shipped), update Overview/Stack/Roadmap tabs.
4. Add Paul's other apps as they start.
5. Possible future upgrade: shared editing across devices (currently edits are per-browser + manual file export). Would need real hosting with a backend — revisit if the manual flow annoys anyone.

## Update discipline

Like the BTI Voice handoff: update THIS file at the end of any session that changes the App Audit, and keep the master file + website folder + handoff traveling together across machines.
