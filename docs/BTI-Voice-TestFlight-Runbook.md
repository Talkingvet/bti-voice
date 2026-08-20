# BTI Voice — TestFlight Runbook

**Written 2026-08-20.** Step-by-step path to get BTI Voice 1.5.0 onto TestFlight for internal
testers. Written for a non-developer: every command and click is spelled out, in order.

Background on how the iOS build got here: handoff `BTI-Voice-Session-Handoff-3.md` §8j.

---

## Facts you'll need

| Thing | Value |
|---|---|
| Bundle ID | `com.businesstechnologyinsight.btivoice` |
| App name | BTI Voice |
| SKU | `bti-voice` |
| Version / Build | 1.5.0 / 1 |
| Apple Team | Business Technology Insight, LLC — Team ID `U2Z95CX43X` |
| Account Holder Apple ID | dannyr927@outlook.com |
| Mac repo | `~/Documents/Claude/Projects/BTI Voice/bti-voice` |
| Windows laptop repo | `C:\Dev\bti-voice` |

**Status of prerequisites (2026-08-20):**

- ✅ Apple Program License Agreement accepted (this was the blocker).
- ✅ Signing team already set in the Xcode project (`DEVELOPMENT_TEAM = U2Z95CX43X`, automatic signing).
- ✅ Deployment target 15.0, UIScene lifecycle present, mic permission in Info.plist.
- ✅ `MARKETING_VERSION` set to 1.5.0 and `CURRENT_PROJECT_VERSION` to 1 in the Xcode project
  (done 2026-08-20 on the laptop — no need to change Version/Build by hand in Xcode).

---

## Step 1 — Push the laptop's changes (Windows, Git Bash)

The version bump was made on the laptop. The Mac must have it before archiving, or the build
will be stamped 1.0.

```bash
cd /c/Dev/bti-voice
git fetch origin
git status
```

Read the output. If it says you're behind, run `git pull origin main` first.

Then commit and push:

```bash
git add -A
git commit -m "iOS: set marketing version 1.5.0 for TestFlight build 1"
git push origin main
git status
```

The last `git status` must say **"working tree clean"** and **"up to date with origin/main"**.
If the push errors, stop and sort that out before touching the Mac.

---

## Step 2 — Create the App Store Connect app record (any browser)

You can do this on the laptop while the Mac builds.

1. Go to **appstoreconnect.apple.com** and sign in as the Account Holder (dannyr927@outlook.com).
2. Click **Apps**.
3. Click the blue **+** at the top left → **New App**.
4. Fill the dialog:
   - **Platforms:** tick **iOS** only.
   - **Name:** `BTI Voice`
     (If Apple says the name is taken, use `BTI Voice by BTI` — the name here is the App Store
     listing name, not what shows on the phone home screen, so it does not have to match.)
   - **Primary Language:** English (U.S.)
   - **Bundle ID:** pick `com.businesstechnologyinsight.btivoice` from the dropdown.
     *If it is not in the dropdown*, the App ID hasn't been registered — see Troubleshooting below.
   - **SKU:** `bti-voice` (internal only, never shown to anyone)
   - **User Access:** Full Access
5. Click **Create**.

You do NOT need to fill in screenshots, description, pricing, or privacy answers. Those are for
App Store review. TestFlight **internal** testing skips all of it.

---

## Step 3 — Build the web bundle on the Mac (Terminal)

```bash
cd "$HOME/Documents/Claude/Projects/BTI Voice/bti-voice"
git pull origin main
bash build-ios.sh
```

`build-ios.sh` does all of this for you, in order: `npm install`, builds the React app with
`VITE_API_URL` pointed at Railway, generates icons and splash screens, runs `npx cap sync ios`
(which also runs `pod install`), makes sure the mic permission is in Info.plist, and then opens
Xcode.

⚠ **Always use the script.** A manual `npm run build` without
`VITE_API_URL=https://bti-voice-production.up.railway.app` produces an app that can't reach the
server, and login fails with Safari's useless error "The string did not match the expected pattern."

It takes a few minutes. Wait for Xcode to open on its own.

---

## Step 4 — Archive in Xcode

1. In Xcode's left sidebar, click the blue **App** project icon at the very top, then select the
   **App** target → **General** tab.
2. Confirm **Version** reads `1.5.0` and **Build** reads `1`. (Step 1 set these — this is just a look.)
3. Click the **Signing & Capabilities** tab. Confirm **Automatically manage signing** is ticked and
   **Team** is *Business Technology Insight, LLC*. If it shows a signing error, click
   **Try Again** — it usually just needs to fetch a provisioning profile.
4. In the toolbar at the top, click the device chip (it currently says your iPhone's name or a
   simulator) and choose **Any iOS Device (arm64)**. Archive is greyed out until you do this.
5. Menu bar → **Product** → **Archive**. This takes 3–10 minutes.
6. When it finishes, the **Organizer** window opens with your archive selected.
7. Click **Distribute App** → **App Store Connect** → **Upload** → accept every default
   (Next, Next, Next) → **Upload**.
8. Wait for "Upload Successful."

⚠ **If the upload is rejected because Xcode is a beta:** install the current release Xcode from the
App Store, open the project with it (`npx cap open ios` from `client/`), and re-do steps 4–7.
This is a known issue noted in handoff §8j.

---

## Step 5 — TestFlight

1. Back in App Store Connect → **Apps** → **BTI Voice** → **TestFlight** tab.
2. The build shows as **Processing**. This takes **15–30 minutes**. Apple emails you when it's done.
   Go do something else.
3. When it flips to **Missing Compliance**, click the ⚠ next to the build and answer the export
   compliance questions:
   - "Does your app use encryption?" → **Yes** (it uses HTTPS)
   - "Does it qualify for the exemption?" → **Yes** — standard HTTPS/TLS only, which is exempt.
   - Save. The build goes to **Ready to Test**.
   > To stop being asked this on every future build, add
   > `ITSAppUsesNonExemptEncryption` = `NO` to `client/ios/App/App/Info.plist`.
4. **Add the testers as users first.** Left sidebar → **Users and Access** → **+** → invite each
   person by email with role **Developer** or **App Manager**. They must accept the emailed
   invitation before they can be added as an internal tester.
5. TestFlight tab → left sidebar **Internal Testing** → **+** next to Testers → group name
   **BTI Team** → add the testers you just invited.
6. Attach the build to the group (**Builds** tab inside the group → **+** → select build 1) if it
   didn't attach automatically.
7. Each tester installs the free **TestFlight** app from the App Store, opens the invite email on
   their iPhone, and taps **Install**.

Internal testing needs **no Apple review** — testers can install within minutes of the build going
Ready to Test.

---

## Step 6 — Verify on the phone

Two things were never confirmed on device (handoff §8j item 6):

- [ ] **Recording playback** — open a call in the Calls tab that has a recording and press play.
      This exercises the HTTP Range support added to `/api/calls/:id/recording` in commit `9a97d86`.
- [ ] **Incoming call while the app is open** — have someone dial +12396667033 with BTI Voice
      foregrounded on the phone; confirm it rings and can be answered.

**Known limitation, not a bug:** incoming calls only ring while the app is in the foreground.
There is no CallKit / VoIP push yet — that's the next iOS project if the team wants background
ringing.

---

## Step 7 — Close the loop

On whichever machine you finished on:

```bash
git add -A
git commit -m "iOS: TestFlight build 1 uploaded"
git push origin main
git status
```

Then update `docs/BTI-Voice-TODO.md` and `docs/BTI-Voice-Session-Handoff-3.md` with the outcome.

---

## Troubleshooting

**Bundle ID missing from the New App dropdown.** The App ID needs registering:
developer.apple.com → Certificates, Identifiers & Profiles → **Identifiers** → **+** → App IDs →
App → Description "BTI Voice", Bundle ID **Explicit** = `com.businesstechnologyinsight.btivoice` →
Continue → Register. Then reload the App Store Connect page.

**"No account for team U2Z95CX43X."** Xcode → Settings → Accounts → **+** → Apple ID → sign in with
dannyr927@outlook.com, then reopen Signing & Capabilities.

**Archive is greyed out.** The device chip is not set to *Any iOS Device (arm64)*. See step 4.4.

**Archive succeeds but the phone runs old UI after install.** The web bundle is stale — you skipped
`build-ios.sh` and Capacitor copied an old `client/dist`. Re-run the script.

**Build stuck in Processing for hours.** Usually an invalid binary; Apple emails the reason to the
Account Holder. Check that email before re-uploading.

**Git says "Operation not permitted" on a lock file.** That's Claude's sandbox only, never your
native Git Bash or Terminal — see handoff §8k. If Claude hits it, run the command yourself.
