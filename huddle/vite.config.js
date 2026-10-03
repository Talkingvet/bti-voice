import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Version stamp comes from the Huddle desktop shell's package.json so
// Settings → About matches the installer.
const APP_VERSION = JSON.parse(
  readFileSync(new URL('../electron-huddle/package.json', import.meta.url), 'utf8')
).version

// ELECTRON=true → builds into huddle/dist (not currently packaged into the
// shell; the shell loads the Railway URL like BTI Voice does).
// Default       → builds into server/public-huddle, served at /huddle.
const isElectron = process.env.ELECTRON === 'true'

export default defineConfig({
  plugins: [react()],
  base: '/huddle/',
  server: {
    port: 5174,
    proxy: {
      '/api':       'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  build: { outDir: isElectron ? 'dist' : '../server/public-huddle', emptyOutDir: true },
})
