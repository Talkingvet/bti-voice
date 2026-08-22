# BTI Voice — Android Setup Plan

**Written 2026-08-20.** Path to getting BTI Voice testable on Android. Written for a
non-developer: every step spelled out, in order, with the decisions called out rather than assumed.

Companion docs: `BTI-Voice-TestFlight-Runbook.md` (the iOS equivalent),
`BTI-Voice-Session-Handoff-3.md` §8j/§8l/§8m (how iOS got here).

---

## The headline: Android builds on Windows

**No Mac required.** Android Studio on the laptop replaces everything Xcode did. Given that the
Mac added most of today's friction — iCloud corrupting git, a dead battery mid-upload — this
removes a whole class of problem. You can build, sign and distribute Android entirely from
`C:\Dev\bti-voice`.

## Current state

- Capacitor is set up, but **only the iOS platform exists**. There is no `client/android/`.
- `client/capacitor.config.json` already has `server.androidScheme: "https"` (the default) and an
  `ios` block. Android will need its own config attention.
- **Capacitor 6** (`@capacitor/core ^6.0.0`). This matters — see the API 36 deadline below.
- The mobile UI scaling added 2026-08-20 uses `@media (pointer: coarse)`, so **it applies to
  Android automatically**. No extra work there.

---

## Decision 1 — how testers get the app

Settle this before building; it changes what else you need.

| Route | Cost | Setup effort | Review wait | Best for |
|---|---|---|---|---|
| **Direct APK** | Free | Lowest | None | A few internal testers, today |
| **Firebase App Distribution** | Free | Low | None | Email invites, tester management, crash reports |
| **Google Play — internal testing** | $25 one-time | Highest | Minimal on internal track | Selling to MSP clients |

**Recommendation: start with direct APK or Firebase.** Neither has a store listing, content rating,
data-safety form, or target-API requirement. You can have Android testers running in an afternoon.
Defer Play until a paying pilot needs it.

**Direct APK mechanics:** you send testers a `.apk` file (email, download link, Slack). They tap it,
Android asks them to allow "install unknown apps" for that source once, and it installs. That
warning is normal for non-Play apps but does need explaining to non-technical testers.

**Firebase App Distribution** is the better middle ground if there will be more than a handful of
testers: free, testers get an email invite and an installer app, and you get crash reporting. No
Google Play account needed.

## Decision 2 — the API 36 deadline (only matters for Google Play)

**From 31 August 2026, new apps submitted to Google Play must target API level 36 (Android 16).**
Capacitor 6 generates a project targeting **API 34**, so a Play submission after that date would be
rejected as-is.

Two ways out, if and when you go the Play route:
1. **Bump `targetSdkVersion` to 36** in `client/android/variables.gradle`. Quick, but you then own
   verifying the Android 15/16 behaviour changes don't break anything.
2. **Upgrade Capacitor** to a version that targets 36 by default. Cleaner, but a Capacitor major
   upgrade touches **iOS too** — it would mean re-testing the whole iOS app, right after it finally
   went out on TestFlight.

⚠ Do not start a Capacitor upgrade and an Android bring-up in the same session. Get Android working
on 6 first, then treat the upgrade as its own piece of work.

APK and Firebase distribution are unaffected by this deadline.

---

## Step-by-step: first Android build

### 1. Install Android Studio (one time, laptop)

Download from developer.android.com/studio and run the installer. Accept the default "Standard"
setup — it installs the Android SDK, platform tools and a bundled JDK. Takes a while and a few GB.

Open it once after installing so it finishes downloading SDK components, then close it.

### 2. Add the Android platform

In Git Bash:

```bash
cd /c/Dev/bti-voice/client
npm install @capacitor/android@^6.0.0
npx cap add android
```

This creates `client/android/`. Commit it — the iOS folder is tracked, so Android should be too,
for the same reason: one clone carries everything.

### 3. Build the web bundle and sync

```bash
cd /c/Dev/bti-voice/client
VITE_API_URL=https://bti-voice-production.up.railway.app npm run build -- --outDir dist --emptyOutDir
npx @capacitor/assets generate --android
npx cap sync android
```

⚠ **`VITE_API_URL` is mandatory.** Without it the app builds fine and then fails at login with an
unhelpful error — the same trap documented for iOS in handoff §8j item 4. Use `build-android.sh`
(below) rather than typing this by hand.

### 4. Microphone permissions — the one real technical risk

Twilio Voice runs on WebRTC, and `getUserMedia` inside an Android WebView needs **two** things:

1. The app must **declare and hold** `RECORD_AUDIO`. Check `client/android/app/src/main/AndroidManifest.xml`
   contains:
   ```xml
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
   ```
2. The app must **grant the WebView's permission request**. Capacitor's WebChromeClient forwards
   these, and the runtime prompt must have been accepted by the user first.

**Verify before assuming it works.** If calls connect but nobody can hear you, this is why. Expect
to add a runtime permission request on first launch. iOS handled this via the Info.plist usage
string; Android needs the runtime grant as well as the manifest entry.

### 5. Run it on a phone

Enable **Developer options** on the Android device (Settings → About phone → tap Build number seven
times), then **USB debugging**. Plug it in, then:

```bash
cd /c/Dev/bti-voice/client
npx cap open android
```

Android Studio opens. Pick your device in the toolbar and press the green ▶. First build is slow
(Gradle downloads dependencies); later ones are quick.

### 6. Signing keystore — do this once, then guard it

Release builds must be signed. Generate the keystore:

```bash
keytool -genkey -v -keystore bti-voice-release.keystore \
  -alias bti-voice -keyalg RSA -keysize 2048 -validity 10000
```

🔴 **Back this file and its password up somewhere permanent and private.** Lose the keystore and you
cannot ship updates to an existing Android app — not on Play, and not as an APK upgrade. Users would
have to uninstall and reinstall. **Do not commit it to git** (the repo is private, but a keystore in
git history is a bad habit — put it in a password manager or secure backup).

### 7. Build a distributable APK

In Android Studio: **Build → Generate Signed Bundle / APK → APK →** select your keystore → build
variant **release** → Finish. The APK lands in `client/android/app/release/`.

Send that file to testers.

---

## `build-android.sh`

A script mirroring `build-ios.sh` is included at the repo root. Run it from Git Bash:

```bash
cd /c/Dev/bti-voice
bash build-android.sh
```

It installs dependencies, builds the React app **with the Railway API URL**, adds the Android
platform on first run, generates icons and splash screens, syncs, and opens Android Studio.

---

## Verification checklist (first Android install)

Mirrors what actually broke on iOS, so check the same things:

- [ ] **Login works** — if it fails oddly, `VITE_API_URL` was missing from the build
- [ ] **Outbound call connects and both sides hear audio** — the WebRTC/`RECORD_AUDIO` path
- [ ] **Incoming call rings while the app is open**
- [ ] **Recording playback** — the custom `AudioPlayer` (build 3 work) should behave, but confirm
- [ ] **Connection dot is absent** — it only shows when the voice device is degraded
- [ ] **UI scale looks right** — `--ui-scale: 1.18` applies via `pointer: coarse`; Android screen
      sizes vary far more than iPhone, so this may need its own tuning
- [ ] **Settings → About → Send diagnostics** returns Sent ✓
- [ ] Keyboard doesn't cover the compose box (the iOS fix used `@capacitor/keyboard` with
      `resize: native` — Android's default behaviour differs and may need its own config)

## Known unknowns

- **Background ringing.** iOS can't ring when backgrounded without CallKit/VoIP push. Android has
  its own constraints (Doze, background execution limits) and will need a foreground service or FCM
  push to ring reliably. Assume foreground-only for the first pass, same as iOS.
- **Keyboard behaviour** — `capacitor.config.json`'s `Keyboard` plugin block was tuned for iOS.
  Android may need `android:windowSoftInputMode` adjustment instead.
- **Screen size variance.** iPhone testing covered one aspect ratio. Android tablets and small
  phones will surface layout issues the iOS pass never hit.

## Open decisions

- [ ] Distribution route: direct APK, Firebase App Distribution, or Google Play?
- [ ] If Play: bump `targetSdkVersion` to 36, or upgrade Capacitor? (Don't do the upgrade in the
      same session as the Android bring-up.)
- [ ] Which testers, and on what devices?
- [ ] Does the productization plan's pricing assume Android parity? If MSP clients are
      Android-heavy, this moves up the roadmap.
