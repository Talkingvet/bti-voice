/**
 * Creates app icons for BTI Huddle desktop. Run once before building:
 *   node create-icons.js      (requires: npm install sharp)
 * Produces assets/icon.png (512) and assets/icon-256.png.
 */
const path = require('path'), fs = require('fs'), sharp = require('sharp')
const assetsDir = path.join(__dirname, 'assets')
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#4f9cf9"/><stop offset="100%" stop-color="#7c5cff"/>
  </linearGradient></defs>
  <rect width="512" height="512" rx="110" fill="url(#g)"/>
  <!-- camera body -->
  <rect x="96" y="168" width="232" height="176" rx="36" fill="white" opacity="0.96"/>
  <!-- camera lens flare -->
  <path d="M344 232 L420 188 a12 12 0 0 1 18 10 v116 a12 12 0 0 1 -18 10 L344 280 z" fill="white" opacity="0.96"/>
  <!-- three people dots = huddle -->
  <circle cx="160" cy="256" r="22" fill="#4f9cf9"/>
  <circle cx="212" cy="256" r="22" fill="#6f7cff"/>
  <circle cx="264" cy="256" r="22" fill="#7c5cff"/>
  <text x="256" y="438" font-family="Arial Black, Arial" font-size="72" font-weight="900" fill="white" text-anchor="middle" opacity="0.92">BTI</text>
</svg>`

;(async () => {
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(assetsDir, 'icon.png'))
  await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(path.join(assetsDir, 'icon-256.png'))
  console.log('Icons written to', assetsDir)
})().catch(e => { console.error(e); process.exit(1) })
