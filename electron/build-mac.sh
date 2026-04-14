#!/bin/bash
# ============================================================
#  BTI Voice – macOS Desktop Build Script
#  Run from the bti-voice/electron folder on a Mac
#  Prerequisites: Node.js installed
# ============================================================

set -e

echo ""
echo " Building BTI Voice Desktop App for macOS..."
echo ""

# Step 1: Build the React client with Electron flag
echo "[1/3] Building React client..."
cd ../client
npm install
ELECTRON=true VITE_API_URL=https://bti-voice-production.up.railway.app npm run build:electron
cd ../electron

# Step 2: Install Electron dependencies
echo "[2/3] Installing Electron dependencies..."
npm install

# Step 3: Build macOS .dmg (builds for both Intel x64 and Apple Silicon arm64)
echo "[3/3] Building macOS DMG..."
npm run build:mac

echo ""
echo " Build complete!"
echo " Installer is in: bti-voice/dist-electron/"
echo " - BTI Voice-1.0.0.dmg        (Intel Mac)"
echo " - BTI Voice-1.0.0-arm64.dmg  (Apple Silicon Mac)"
echo ""
