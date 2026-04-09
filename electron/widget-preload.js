// Preload for the mini call widget window
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('widgetAPI', {
  // Listen for call start/end events from main process
  onCallStarted: (cb) => ipcRenderer.on('call-started', (_, info) => cb(info)),
  onCallEnded:   (cb) => ipcRenderer.on('call-ended',   ()         => cb()),

  // Send button actions (mute, hold, hangup, open) to main process
  sendAction: (action, value) => ipcRenderer.send('call-widget-action', { action, value }),
})
