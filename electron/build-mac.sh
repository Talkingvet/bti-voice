#!/bin/bash
# ============================================================
#  BTI Voice – macOS Desktop Build Script
#  Run from the bti-voice/electron folder on a Mac
#  Prerequisites: Node.js installed
# ============================================================
#
# Strategy: build unsigned .app bundles with electron-builder
# (target "dir", identity:null), then manually clean extended
# attributes and ad-hoc sign each bundle in a single pass —
# avoiding the xattr race that broke electron-builder's own
# signing flow on Apple Silicon. Finally, package each signed
# .app into a DMG with hdiutil.
#
# Outputs land in: ../../dist-electron/
#   - BTI Voice-1.2.0-x64.dmg     (Intel Mac)
#   - BTI Voice-1.2.0-arm64.dmg   (Apple Silicon Mac)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/../../dist-electron"
VERSION="$(node -p "require('./package.json').version")"

# ── Code-signing setup ──────────────────────────────────────────
# If a "Developer ID Application" certificate is installed in the
# keychain, sign with it (hardened runtime + entitlements) and then
# notarize the DMGs with the keychain profile below. Otherwise fall
# back to ad-hoc signing (app works locally; downloads get blocked
# by Gatekeeper).
#
# One-time setup for full signing:
#   1. Xcode → Settings → Accounts → company Apple ID →
#      Manage Certificates → + → "Developer ID Application"
#   2. xcrun notarytool store-credentials bti-voice-notary \
#        --apple-id <appleID> --team-id <TEAMID> --password <app-specific pw>
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')"
NOTARY_PROFILE="${NOTARY_PROFILE:-bti-voice-notary}"
if [ -n "$IDENTITY" ]; then
    echo " Signing identity: $IDENTITY"
else
    echo " No Developer ID certificate found — using ad-hoc signing (Gatekeeper will block downloads)."
fi

echo ""
echo " Building BTI Voice Desktop App for macOS..."
echo ""

# ----------------------------------------------------------------
# Step 1: Build the React client
# ----------------------------------------------------------------
echo "[1/4] Building React client..."
cd ../client
npm install
ELECTRON=true VITE_API_URL=https://bti-voice-production.up.railway.app npm run build:electron
cd ../electron

# ----------------------------------------------------------------
# Step 2: Install Electron dependencies
# ----------------------------------------------------------------
echo "[2/4] Installing Electron dependencies..."
npm install

# ----------------------------------------------------------------
# Step 3: Produce unsigned .app bundles for both architectures
# (identity:null + target:dir means NO signing, NO DMG yet)
# ----------------------------------------------------------------
echo "[3/4] Building unsigned .app bundles..."
npx electron-builder --mac --x64 --arm64 --dir

# ----------------------------------------------------------------
# Step 4: Clean, ad-hoc sign, and DMG-package each .app
# ----------------------------------------------------------------
echo "[4/4] Signing and packaging..."

sign_and_package() {
    local arch_label="$1"   # "x64" or "arm64"
    local source_dir="$2"   # path to the mac-* folder electron-builder produced
    local app_path="$source_dir/BTI Voice.app"
    local dmg_path="$DIST_DIR/BTI Voice-$VERSION-$arch_label.dmg"

    if [ ! -d "$app_path" ]; then
        echo "  [$arch_label] SKIP — no .app at $app_path"
        return
    fi

    # ----------------------------------------------------------
    # Spotlight, Time Machine, and antivirus tools tag new files
    # in well-known directories with extended attributes the
    # moment they appear — which races with codesign's "no
    # detritus allowed" check. Workaround: copy the bundle into
    # a temp folder under /tmp (which those services don't touch),
    # using `ditto` (which strips xattrs by default), then sign
    # there, then move the signed bundle back.
    # ----------------------------------------------------------

    local tmp_dir
    tmp_dir="$(mktemp -d -t btivoice-sign)"
    local tmp_app="$tmp_dir/BTI Voice.app"

    echo "  [$arch_label] Copying bundle to $tmp_app (xattr-stripped)..."
    ditto "$app_path" "$tmp_app"
    # Belt and suspenders — explicitly clear xattrs on every entry.
    find "$tmp_app" -exec xattr -c {} \; 2>/dev/null || true

    if [ -n "$IDENTITY" ]; then
        echo "  [$arch_label] Signing with Developer ID (hardened runtime)..."
        codesign --deep --force --options runtime --timestamp \
            --entitlements "$SCRIPT_DIR/entitlements.mac.plist" \
            --sign "$IDENTITY" "$tmp_app"
    else
        echo "  [$arch_label] Ad-hoc signing (deep)..."
        codesign --deep --force --sign - "$tmp_app"
    fi

    echo "  [$arch_label] Verifying signature..."
    codesign --verify --deep --strict "$tmp_app"

    echo "  [$arch_label] Moving signed bundle back..."
    rm -rf "$app_path"
    ditto "$tmp_app" "$app_path"
    rm -rf "$tmp_dir"

    echo "  [$arch_label] Building DMG..."
    rm -f "$dmg_path"
    hdiutil create \
        -volname "BTI Voice" \
        -srcfolder "$app_path" \
        -ov \
        -format ULMO \
        "$dmg_path"

    if [ -n "$IDENTITY" ]; then
        echo "  [$arch_label] Notarizing (this takes a few minutes)..."
        if xcrun notarytool submit "$dmg_path" --keychain-profile "$NOTARY_PROFILE" --wait; then
            xcrun stapler staple "$dmg_path"
            echo "  [$arch_label] Notarized and stapled."
        else
            echo "  [$arch_label] WARNING: notarization failed or credentials missing."
            echo "  [$arch_label] Run: xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id <appleID> --team-id <TEAMID> --password <app-specific pw>"
        fi
    fi

    echo "  [$arch_label] Done: $dmg_path"
}

sign_and_package "x64"   "$DIST_DIR/mac"
sign_and_package "arm64" "$DIST_DIR/mac-arm64"

echo ""
echo " Build complete!"
echo " Installers are in: $DIST_DIR"
echo "  - BTI Voice-$VERSION-x64.dmg     (Intel Mac)"
echo "  - BTI Voice-$VERSION-arm64.dmg   (Apple Silicon Mac)"
echo ""
