const { contextBridge, ipcRenderer } = require('electron')

// Minimal bridge for the Huddle web app. Everything is opt-in from the page
// (window.huddleAPI?.x) so the same web build also runs in a plain browser.
contextBridge.exposeInMainWorld('huddleAPI', {
  platform: process.platform,
  isDesktop: true,
  incomingCall: (name) => ipcRenderer.send('incoming-call', String(name || '')),
  incomingMessage: (from) => ipcRenderer.send('incoming-message', String(from || '')),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
})
