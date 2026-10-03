// BTI Huddle — desktop shell (v0.1, 2026-10-02).
//
// Like BTI Voice, this is a thin Electron window around the hosted web app:
// the UI lives on the Railway server at /huddle and updates without a new
// installer. What the shell adds over a browser tab:
//   • a big, Teams-sized window that remembers its position
//   • camera / microphone permission prompts handled natively
//   • screen sharing without a browser extension prompt — Electron's
//     setDisplayMediaRequestHandler serves getDisplayMedia() with the
//     system picker on macOS 15+ (falls back to the primary screen)
//   • dock bounce / taskbar flash on an incoming call
//   • single-instance: launching again just focuses the window

const { app, BrowserWindow, shell, session, desktopCapturer, ipcMain, systemPreferences, nativeImage } = require('electron')
const path = require('path')
const fs   = require('fs')

const APP_URL   = 'https://bti-voice-production.up.railway.app/huddle'
const APP_ORIGIN = new URL(APP_URL).origin
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png')
const DEFAULT_BOUNDS = { width: 1180, height: 760 }

let mainWindow = null

// ── Single instance ──────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() }
  })
}

// ── Window state persistence ─────────────────────────────────────────────────
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')
function loadWindowState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) } catch { return {} } }
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try { fs.writeFileSync(stateFile(), JSON.stringify(mainWindow.getNormalBounds())) } catch { /* ignore */ }
}

function createWindow() {
  const chrome = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } }
    : {}
  const saved = loadWindowState()

  mainWindow = new BrowserWindow({
    width:  saved.width  || DEFAULT_BOUNDS.width,
    height: saved.height || DEFAULT_BOUNDS.height,
    x: saved.x, y: saved.y,
    minWidth: 820, minHeight: 540,
    ...chrome,
    backgroundColor: '#161b24',
    icon: ICON_PATH,
    show: false,
    title: 'BTI Huddle',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(APP_URL)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', saveWindowState)
  mainWindow.on('closed', () => { mainWindow = null })

  // Security: never open new Electron windows from the remote page; keep the
  // window on our origin; external links go to the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { try { shell.openExternal(url) } catch { /* ignore */ } return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    let origin = ''
    try { origin = new URL(url).origin } catch { /* ignore */ }
    if (origin !== APP_ORIGIN) { e.preventDefault(); try { shell.openExternal(url) } catch { /* ignore */ } }
  })

  // Offline / failed-load recovery (same approach as BTI Voice).
  mainWindow.webContents.on('did-fail-load', (e, code, desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    console.error('[load] failed:', code, desc)
    const html = 'data:text/html;charset=utf-8,' + encodeURIComponent(
      '<!doctype html><html><head><meta charset="utf-8"><title>BTI Huddle</title></head>' +
      '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#161b24;color:#e8edf5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">' +
      '<div style="text-align:center"><div style="font-size:18px;font-weight:700;margin-bottom:8px">Can’t reach BTI Huddle</div>' +
      '<div style="color:#8b96ab;font-size:13px;margin-bottom:18px">Check your internet connection. Retrying automatically…</div>' +
      '<button onclick="location.href=\'' + APP_URL + '\'" style="background:#4f9cf9;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-weight:600;cursor:pointer">Retry now</button></div>' +
      '<script>setInterval(function(){fetch("' + APP_ORIGIN + '/api/health",{cache:"no-store"}).then(function(r){if(r.ok)location.href="' + APP_URL + '"}).catch(function(){})},5000)</script>' +
      '</body></html>')
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(html) }, 800)
  })
}

// ── Media permissions + screen share ─────────────────────────────────────────
function setupMedia() {
  const ses = session.defaultSession

  // Camera / mic / display-capture requests from our own origin are allowed;
  // the OS still shows its own one-time prompt the first time.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = ['media', 'display-capture', 'mediaKeySystem', 'notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)
    let origin = ''
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin } catch { /* ignore */ }
    callback(ok && origin === APP_ORIGIN)
  })
  ses.setPermissionCheckHandler((wc, permission, origin) => origin === APP_ORIGIN)

  // Serve navigator.mediaDevices.getDisplayMedia(). macOS 15+ gets Apple's
  // native picker (windows, screens, apps); elsewhere we share the primary
  // screen. A richer in-app picker is a follow-up.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      const screen = sources.find(s => s.id.startsWith('screen:')) || sources[0]
      if (!screen) return callback({})
      callback({ video: screen, audio: 'loopback' })
    } catch (e) {
      console.error('[screen-share]', e)
      callback({})
    }
  }, { useSystemPicker: true })

  // Ask macOS for camera + mic access up front so the first call doesn't
  // stall on a permission dialog mid-connect.
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').catch(() => {})
    systemPreferences.askForMediaAccess('camera').catch(() => {})
  }
}

// ── IPC from the page (via preload) ──────────────────────────────────────────
ipcMain.on('incoming-call', (_, name) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (process.platform === 'darwin') app.dock?.bounce('critical')
  else mainWindow.flashFrame(true)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.setTitle(`${name} is calling — BTI Huddle`)
  setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle('BTI Huddle') }, 15000)
})
ipcMain.handle('get-app-version', () => app.getVersion())

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin' && fs.existsSync(ICON_PATH)) app.dock?.setIcon(nativeImage.createFromPath(ICON_PATH))
  setupMedia()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else mainWindow?.show() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
