const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: ()         => ipcRenderer.send('win-minimize'),
  maximize: ()         => ipcRenderer.send('win-maximize'),
  close:    ()         => ipcRenderer.send('win-close'),
  quit:     ()         => ipcRenderer.send('win-quit'),
  onWindowState: (cb)  => ipcRenderer.on('window-state', (_, state) => cb(state)),
})
