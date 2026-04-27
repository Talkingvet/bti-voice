// Preload for the incoming-call banner window.
// Exposes a tiny API for the banner UI to receive caller info from main
// and report Accept/Decline back.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bannerAPI', {
  // Main process sends this when a new incoming call arrives — payload is
  // { from: <E.164 number string> }. UI uses it to populate the caller name.
  onShow: (cb) => ipcRenderer.on('incoming-banner-show', (_, info) => cb(info)),

  // User clicked Accept on the banner. Main process forwards this to the
  // React app so it can call incomingCall.accept().
  accept:  () => ipcRenderer.send('incoming-banner-action', { action: 'accept'  }),

  // User clicked Decline. Main forwards to React → incomingCall.reject().
  decline: () => ipcRenderer.send('incoming-banner-action', { action: 'decline' }),
})
