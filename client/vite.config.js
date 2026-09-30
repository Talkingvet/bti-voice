import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// The app's true version lives in electron/package.json (the release stamp the
// Windows installer uses). Bake it in at build time so phone/web builds show
// the real version in Settings → About instead of the '1.0.0' fallback.
const APP_VERSION = JSON.parse(
  readFileSync(new URL('../electron/package.json', import.meta.url), 'utf8')
).version

// ELECTRON=true → builds into client/dist for Electron packaging
// Default       → builds into server/public for Railway deployment
const isElectron = process.env.ELECTRON === 'true'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api':       'http://localhost:3000',
      '/webhooks':  'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    outDir: isElectron ? 'dist' : '../server/public',
  },
})
