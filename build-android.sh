#!/bin/bash
# ============================================================
#  BTI Voice – Android Build Script
#  Run from the bti-voice root folder. WORKS ON WINDOWS (Git Bash),
#  macOS or Linux — unlike build-ios.sh, which is Mac-only.
#
#  Prerequisites:
#    - Android Studio installed (bundles the Android SDK + JDK)
#    - Node.js installed
#    - A Google Play account is NOT needed to test via APK or Firebase
#
#  Full walkthrough + distribution options: docs/BTI-Voice-Android-Setup-Plan.md
# ============================================================

set -e

echo ""
echo " Setting up BTI Voice for Android..."
echo ""

cd client

# Step 1: Install dependencies (includes Capacitor)
echo "[1/5] Installing dependencies..."
npm install

# Step 2: Build the React app pointed at Railway.
# VITE_API_URL is MANDATORY — without it the app builds fine and then fails at
# login with a cryptic error, because it has no API base to talk to.
echo "[2/5] Building React app..."
VITE_API_URL=https://bti-voice-production.up.railway.app npm run build -- --outDir dist --emptyOutDir

# Step 3: Add Android platform (first run only)
if [ ! -d "android" ]; then
  echo "[3/5] Adding Android platform for the first time..."
  npm install @capacitor/android@^6.0.0
  npx cap add android
else
  echo "[3/5] Android platform exists — skipping add"
fi

# Step 3.5: Generate app icons + splash screens from client/resources/
echo "[3.5/5] Generating app icons and splash screens..."
npx @capacitor/assets generate --android || echo "      (icon generation failed - set the icon manually in Android Studio)"

# Step 4: Sync web assets into the Android project
echo "[4/5] Syncing to Android Studio..."
npx cap sync android

# Step 5: Check the microphone permissions Twilio Voice needs.
# WebRTC getUserMedia inside an Android WebView requires RECORD_AUDIO to be both
# declared here AND granted at runtime. If calls connect but nobody can hear
# you, this is the first place to look.
MANIFEST="android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
  if grep -q "android.permission.RECORD_AUDIO" "$MANIFEST"; then
    echo "[5/5] RECORD_AUDIO permission present ✓"
  else
    echo "[5/5] ⚠  RECORD_AUDIO is MISSING from AndroidManifest.xml"
    echo "      Calls will connect but no audio will be captured."
    echo "      Add inside <manifest>:"
    echo "        <uses-permission android:name=\"android.permission.RECORD_AUDIO\" />"
    echo "        <uses-permission android:name=\"android.permission.MODIFY_AUDIO_SETTINGS\" />"
  fi
else
  echo "[5/5] Warning: AndroidManifest.xml not found at $MANIFEST"
fi

echo ""
echo " Done! Opening Android Studio now..."
echo ""
echo " In Android Studio:"
echo "   1. Plug in your Android phone (Developer options + USB debugging enabled)"
echo "   2. Select it in the device dropdown at the top"
echo "   3. Press the green ▶ — it builds and installs on your phone"
echo ""
echo " To make an APK to send to testers:"
echo "   Build → Generate Signed Bundle / APK → APK → release"
echo "   (You need a signing keystore first — see the setup plan doc.)"
echo ""

npx cap open android
