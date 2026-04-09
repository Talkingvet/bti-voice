const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Window controls ──────────────────────────────────────────────
  minimize: ()         => ipcRenderer.send('win-minimize'),
  maximize: ()         => ipcRenderer.send('win-maximize'),
  close:    ()         => ipcRenderer.send('win-close'),
  quit:     ()         => ipcRenderer.send('win-quit'),
  onWindowState: (cb)  => ipcRenderer.on('window-state', (_, state) => cb(state)),

  // ── System settings ──────────────────────────────────────────────
  getAutoLaunch: ()        => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),

  // ── Mini call widget IPC ─────────────────────────────────────────
  // Call these from the React app when call state changes
  callStart: (info) => ipcRenderer.send('call-start', info),
  callEnd:   ()     => ipcRenderer.send('call-end'),

  // Listen for actions triggered from the mini widget (mute, hold, hangup, open)
  onCallAction: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('call-action', handler)
    // Return cleanup function
    return () => ipcRenderer.removeListener('call-action', handler)
  },
})
