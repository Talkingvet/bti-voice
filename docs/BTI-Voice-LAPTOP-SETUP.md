# BTI Voice — Working From Any Machine (Laptop Setup + Sync Failsafe)

**Written 2026-08-19.** This file lives in the repo, so it's on every machine after a `git clone`.

## The short version

**Everything travels through GitHub.** Code *and* docs are in the repo now. One `git clone` on the laptop gives you the app, the handoff, the TODO, the productization plan, and the pilot materials. Nothing syncs through any cloud drive — there is no OneDrive, no Dropbox, nothing. GitHub is the single source of truth and your only off-machine backup.

| Machine | Role | Repo path |
|---|---|---|
| **Windows desktop** | Main workhorse | `C:\Users\Doero\OneDrive\Documents\Claude\Projects\Talkingvet Help\bti-voice` |
| **Windows laptop** | Travel | `C:\Dev\bti-voice` (set up below) |
| **Mac** | iOS + Mac builds only | `~/Documents/Claude/Projects/BTI Voice/bti-voice` |

> The word `OneDrive` in the desktop path is a **leftover folder name.** OneDrive is not installed or running, and nothing syncs. If you ever see advice in an old doc about pausing OneDrive sync or OneDrive locking git files, it was wrong — see handoff §8k.

---

## Part 1 — One-time laptop setup

Do this once, on good wifi, before you travel. Budget 45 minutes, mostly downloads.

### Step 1: Install Git, Node, and GitHub CLI

Open **PowerShell as Administrator** (right-click Start → Terminal (Admin)) and run these one at a time:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id GitHub.cli -e
```

Then **close the Admin window completely.** Everything from Step 2 on goes in a **normal, non-admin PowerShell** — files created by an elevated shell can end up with permissions that trip you up later.

Open a normal PowerShell and verify:

```powershell
git --version
node --version
gh --version
```

`node --version` should be 20 or higher (LTS currently gives 24.x; the repo needs at least 18).

### Step 2: Install the Railway CLI

Railway is **not** in winget — it installs through npm, which you now have:

```powershell
npm install -g @railway/cli
railway --version
```

> If it's still not recognized, close and reopen PowerShell once. Do **not** try `winget install Railway.Railway` — that package doesn't exist and you'll loop forever.

### Step 3: Tell Git who you are

**Don't skip this.** Without it your first `git commit` fails with "Author identity unknown" — a confusing error to hit in an airport.

```powershell
git config --global user.name "Danny Roche"
git config --global user.email "dannyr927@outlook.com"
```

Use whichever email is on your GitHub account.

### Step 4: Sign in to GitHub

The repo is **private**, so you can't clone without authenticating.

```powershell
gh auth login
```

Answer: **GitHub.com** → **HTTPS** → **Yes** (authenticate Git with your GitHub credentials) → **Login with a web browser**. Copy the one-time code, press Enter, paste it in the browser that opens.

> ⚠️ **Known trap from the desktop:** a stale `GH_TOKEN` environment variable once shadowed every login with 401 errors, and `gh auth login` refuses to even run while it's set. If that happens:
> ```powershell
> [Environment]::SetEnvironmentVariable('GH_TOKEN', $null, 'User')
> ```
> then open a fresh PowerShell.

### Step 5: Clone

```powershell
mkdir C:\Dev -Force
cd C:\Dev
git clone https://github.com/Talkingvet/bti-voice.git
```

You now have `C:\Dev\bti-voice` — code **and** all docs under `docs/`.

### Step 6: Install dependencies

```powershell
cd C:\Dev\bti-voice
npm install --prefix server
npm install --prefix client
```

A few hundred MB, several minutes. Warnings are normal — it only failed if it prints `ERR!` and stops.

**Only if you plan to build the Windows installer while traveling,** also do this in **Git Bash** (not PowerShell):

```bash
cd /c/Dev/bti-voice/electron
npm install
```

> `node_modules` is never copied between machines — it contains files compiled for one specific computer. Always install fresh.
>
> **You never need a `.env` file on the laptop.** The app runs on Railway; there are no local secrets to hunt for.

### Step 7: Link Railway

Run from **inside the repo folder** — `railway link` writes the project association into whatever directory you're standing in.

```powershell
cd C:\Dev\bti-voice
railway login
railway link
```

`railway link` asks a series of questions — possibly workspace/team first, then project **intuitive-compassion**, environment **production**, service **bti-voice**. Every later `railway run` must also be run from `C:\Dev\bti-voice`.

> ⚠️ **Two traps when running database scripts**, both learned the hard way:
>
> 1. `railway run` injects the **internal** database URL (`postgres.railway.internal`), unreachable from your laptop. Override it with the public `maglev.proxy.rlwy.net` URL from handoff §2. **Git Bash only** — `env` is a Unix command and doesn't exist in PowerShell:
>    ```bash
>    cd /c/Dev/bti-voice
>    railway run env DATABASE_URL="<public maglev URL from handoff §2>" node server/scripts/<script>.js
>    ```
> 2. Inline `node -e "..."` **dies** on Windows railway/cmd quoting with "Access is denied." Always write a script file instead.

### Step 8: Connect the folder in Cowork

Install the Claude desktop app and sign in if you haven't. **Folder connections are per-machine** — they don't travel with your account, so you have to do this here.

Connect **one** folder: `C:\Dev\bti-voice`

That's it. Code and docs are both in there now, so there's no second folder to add.

### Step 9: Verify

```powershell
cd C:\Dev\bti-voice
git fetch origin
git status
```

`git fetch` is the real test — it exercises your GitHub authentication over the network. If it completes without asking for a password and `git status` says **"up to date with 'origin/main'"**, you're done.

Then start a Claude session and say *"read the handoff and TODO, and run the sync check."*

---

## Part 2 — The sync failsafe

The one habit that keeps three machines from stepping on each other. **Claude runs this for you automatically** (Part 3) — this section is so you can do it yourself if you're ever without Claude.

### Starting work — PULL FIRST

```powershell
cd C:\Dev\bti-voice
git fetch origin
git status
```

- **"behind origin/main by N commits"** → `git pull` before touching anything. Another machine did work you don't have.
- **"up to date"** → good, start working.
- **"ahead by N commits"** → you left work unpushed last time. `git push origin main` now.

### Finishing work — PUSH BEFORE YOU CLOSE THE LID

```powershell
git status                  # anything listed is unsaved work
git add -A
git commit -m "what you did"
git push origin main
git status                  # must say clean AND up to date
```

That last `git status` must say **"up to date with 'origin/main'"** and **"nothing to commit, working tree clean."** If it does, your work is safe on GitHub. If it doesn't, you're not done.

### If the push is rejected

**"updates were rejected"** or **"non-fast-forward"** means another machine pushed something you don't have:

```powershell
git pull --rebase origin main
git push origin main
```

**If that reports conflicts, stop and ask Claude.** Don't untangle it by hand.

### Why this matters more than it sounds

Two reasons, and the second is the one people miss:

1. Everything except Electron shell changes deploys **on push** — Railway rebuilds automatically. An unpushed commit means a fix you believe is live isn't.
2. **GitHub is now your only backup.** Docs live in the repo and nothing syncs to a cloud drive. Work that isn't pushed exists on exactly one computer.

---

## Part 3 — What Claude does automatically

Standing instruction, saved to Claude's memory, applies on every machine:

**At the START of every BTI Voice session,** before any code work, Claude runs `git fetch origin`, compares local `main` against `origin/main` both directions, checks for uncommitted changes, and **tells you plainly** if you're behind, ahead, or dirty — and which machine the other work likely came from.

**At the END of every session,** or any time you say you're stopping, switching machines, or heading out, Claude commits, pushes, verifies `git status` is clean and up to date, and confirms in plain language that it's safe to close the laptop.

**Claude will not let a session end silently with unpushed work.** If a push fails, Claude says so explicitly rather than letting you walk away believing it saved.

---

## Part 4 — Machine notes

### Both Windows machines

Plain `git add` / `commit` / `push` work normally. Use **PowerShell** for git, `gh`, and npm installs. Use **Git Bash** for Electron builds and anything with `railway run env …`.

Still true everywhere: `git status` can claim "up to date" while the tracking ref is stale — **always `git fetch origin` first.**

### When *Claude's* git commands fail

If Claude reports `Operation not permitted` or can't delete `.git/index.lock`, that's a limitation of Claude's sandbox mount — it cannot delete files in your folders, full stop. **It is not a problem with your machine.** Just run the same git command yourself in Git Bash; it will work. Claude may also leave behind `.git/*.lock` or `.old` files — harmless, clear them with:

```bash
rm -f .git/*.lock .git/*.old
```

### Mac

The only machine that can build/sign/notarize Mac DMGs and archive for TestFlight. Same pull-first / push-last ritual. Full iOS details in handoff §8j.

---

## Part 5 — Building the Windows installer on the laptop

Only needed for **Electron shell** changes (`main.js`, preload, window config). Server and client changes go live on push — no installer required.

In **Git Bash** (PowerShell blocks npm scripts here):

```bash
cd /c/Dev/bti-voice/electron
npm install          # first time only
npm run build:win
```

Three things that will confuse you otherwise:

1. **Output lands OUTSIDE the repo** — in `C:\Dev\dist-electron\`, not inside `bti-voice`. (The build script prints a different path; ignore it, it's wrong.)
2. **The file has spaces in its name** — `BTI Voice Setup 1.5.0.exe`. Rename to `BTI-Voice-Setup-1.5.0.exe` before uploading or the release upload mangles it.
3. **Then upload and bump the version:**
   ```powershell
   gh release upload v1.5.0 "C:\Dev\dist-electron\BTI-Voice-Setup-1.5.0.exe" --clobber
   ```
   and update `LATEST_VERSION` in Railway, or nobody gets offered the update.

---

## Part 6 — What you can and can't do while traveling

**Works fully on the laptop:**

- All server and client changes → `git push` → Railway deploys in ~2 min → live everywhere including your phone
- Database queries and repair scripts (Git Bash + public `DATABASE_URL` override)
- Zoho, Twilio console, Railway settings — all browser-based
- The app itself: <https://bti-voice-production.up.railway.app> in any browser
- All docs and business materials (they're in `docs/`)
- Windows installer builds (Part 5)

**Needs the Mac:**

- iOS builds, Xcode archives, TestFlight uploads — **your current top TODO item**
- Signed/notarized Mac DMGs

**Practical takeaway:** the laptop covers the large majority of BTI Voice work. TestFlight is the exception — do it before you leave, or bring the Mac.

---

## Quick reference

Landing in a new session anywhere:

> Read the handoff and TODO for BTI Voice, run the sync check, and tell me where we left off.

Wrapping up:

> I'm stopping here — save and push everything.

---

*All docs now live in `bti-voice/docs/`: `BTI-Voice-Session-Handoff-3.md` (master context; §8k covers multi-machine), `BTI-Voice-TODO.md` (live checklist), `BTI-Voice-Productization-Plan.md` (selling track), `DEPLOY-RUNBOOK.md` (per-customer deploys), plus the pilot one-pager, onboarding checklist, and accountant email draft. Superseded and other-project docs are in `docs/archive/`.*
