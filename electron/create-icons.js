/**
 * Creates app icons for BTI Voice desktop.
 * Run once before building: node create-icons.js
 * Requires: npm install sharp
 */
const path = require('path')
const fs   = require('fs')

const assetsDir = path.join(__dirname, 'assets')
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true })

// 512×512 app icon (blue rounded square + BTI text)
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1d4ed8"/>
      <stop offset="100%" style="stop-color:#3b82f6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="80" fill="url(#g)"/>
  <!-- Phone handset -->
  <path d="M160 176 c0-18 14-32 32-32 h16 l24 64 -18 10 c-2 1-3 3-2 5
    c10 24 28 42 52 52 c2 1 4 0 5-2 l10-18 64 24 v16
    c0 18-14 32-32 32 C248 327 184 263 160 176 z"
    fill="white" opacity="0.95"/>
  <!-- BTI text below phone -->
  <text x="256" y="430" font-family="Arial Black, Arial" font-size="88"
    font-weight="900" fill="white" text-anchor="middle" opacity="0.9">BTI</text>
</svg>`

// 32×32 tray icon (just the phone on a tiny blue square)
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="5" fill="#1d4ed8"/>
  <path d="M9 10 c0-1.1.9-2 2-2 h1.5 l1.5 4 -1.1.6
    c-.15.08-.2.25-.12.38 c.6 1.5 1.75 2.6 3.25 3.25
    c.13.06.3 0 .38-.12 l.6-1.1 4 1.5 v1.5
    c0 1.1-.9 2-2 2 C14.5 20 9 14.5 9 10z"
    fill="white"/>
</svg>`

async function run() {
  let sharp
  try {
    sharp = require('sharp')
  } catch {
    console.error('Error: sharp not installed. Run: npm install')
    process.exit(1)
  }

  // 512×512 PNG
  await sharp(Buffer.from(appSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(assetsDir, 'icon.png'))
  console.log('✓ assets/icon.png (512×512)')

  // 256×256 PNG (for ICO source)
  await sharp(Buffer.from(appSvg))
    .resize(256, 256)
    .png()
    .toFile(path.join(assetsDir, 'icon-256.png'))
  console.log('✓ assets/icon-256.png (256×256)')

  // 32×32 tray PNG
  await sharp(Buffer.from(traySvg))
    .resize(32, 32)
    .png()
    .toFile(path.join(assetsDir, 'tray.png'))
  console.log('✓ assets/tray.png (32×32)')

  // Note: electron-builder auto-generates .ico from icon.png
  console.log('\nAll icons created! electron-builder will auto-convert icon.png → icon.ico.')
  console.log('Next: npm run build:win')
}

run().catch(console.error)
