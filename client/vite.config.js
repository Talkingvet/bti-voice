import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  build: {
    outDir: isElectron ? 'dist' : '../server/public',
  },
})
