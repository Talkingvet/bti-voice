#!/bin/bash
# ============================================================
#  BTI Voice – iOS Build Script
#  Run from the bti-voice root folder on a Mac
#
#  Prerequisites:
#    - Mac with Xcode installed (free from App Store)
#    - Node.js installed
#    - Apple Developer account ($99/yr) for TestFlight / App Store distribution
#      (NOT needed to run directly on your own device via Xcode)
# ============================================================

set -e

echo ""
echo " Setting up BTI Voice for iOS..."
echo ""

cd client

# Step 1: Install dependencies (includes Capacitor)
echo "[1/5] Installing dependencies..."
npm install

# Step 2: Build the React app pointed at Railway
echo "[2/5] Building React app..."
VITE_API_URL=https://bti-voice-production.up.railway.app npm run build -- --outDir dist --emptyOutDir

# Step 3: Add iOS platform (first run only)
if [ ! -d "ios" ]; then
  echo "[3/5] Adding iOS platform for the first time..."
  npx cap add ios
else
  echo "[3/5] iOS platform exists — skipping add"
fi

# Step 3.5: Generate iOS app icons + splash screens from client/resources/
echo "[3.5/5] Generating app icons and splash screens..."
npx @capacitor/assets generate --ios || echo "      (icon generation failed - set the AppIcon manually in Xcode)"

# Step 4: Sync web assets into Xcode project
echo "[4/5] Syncing to Xcode..."
npx cap sync ios

# Step 5: Patch Info.plist with microphone permission (required for Twilio Voice / WebRTC)
PLIST="ios/App/App/Info.plist"
if [ -f "$PLIST" ]; then
  if ! grep -q "NSMicrophoneUsageDescription" "$PLIST"; then
    echo "[5/5] Adding microphone permission to Info.plist..."
    # Insert before the closing </dict> tag
    sed -i '' 's|</dict>|  <key>NSMicrophoneUsageDescription</key>\
  <string>BTI Voice needs microphone access to make and receive calls.</string>\
</dict>|' "$PLIST"
    echo "      ✓ Microphone permission added"
  else
    echo "[5/5] Microphone permission already in Info.plist"
  fi
else
  echo "[5/5] Warning: Info.plist not found at $PLIST — add microphone permission manually in Xcode"
fi

echo ""
echo " Done! Opening Xcode now..."
echo ""
echo " In Xcode:"
echo "   1. Click 'App' in the left sidebar → Signing & Capabilities"
echo "   2. Set your Team (your Apple ID works for personal device testing)"
echo "   3. Plug in your iPhone via USB"
echo "   4. Select your iPhone as the build target (top toolbar)"
echo "   5. Press the ▶ Play button — it will build and install on your phone"
echo ""
echo " For TestFlight distribution later, you'll need an Apple Developer account."
echo ""

npx cap open ios
