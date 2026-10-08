// OS-level pop-ups for new texts, missed calls and voicemails.
//
// Two delivery paths, same call:
//   • Desktop app 1.6.0+  → window.electronAPI.notifyDesktop(...) — the Electron
//     main process shows a native notification (proper Windows toast under the
//     app's name/icon) and, on click, restores the window from the tray and
//     sends the `nav` back so App can open the right thread/tab.
//   • Browser, or a desktop shell older than 1.6.0 → the browser's own
//     Notification API. Chrome/Edge ask "Allow notifications?" once. Click
//     focuses the tab and navigates the same way.
//
// Honours Settings → Sound: "Desktop notifications" (desktopNotifs) and
// "Show message text" (notifPreview — off = title only, no preview body).
// "Call sounds" off → the pop-up is silent.
import { getSoundPrefs } from '../dtmf'

const clickHandlers = new Set()

export function onDesktopNotificationClick(cb) {
  clickHandlers.add(cb)
  let offElectron = null
  if (window.electronAPI?.onNotificationClick) {
    offElectron = window.electronAPI.onNotificationClick(nav => cb(nav))
  }
  return () => {
    clickHandlers.delete(cb)
    if (typeof offElectron === 'function') offElectron()
  }
}

function fireClick(nav) {
  clickHandlers.forEach(cb => { try { cb(nav) } catch (e) { console.error(e) } })
}

export function showDesktopNotification({ kind, tag, title, body, nav }) {
  const prefs = getSoundPrefs()
  if (prefs.desktopNotifs === false) return
  const text   = prefs.notifPreview === false && kind === 'sms' ? '' : (body || '')
  const silent = prefs.callSounds === false

  if (window.electronAPI?.notifyDesktop) {
    window.electronAPI.notifyDesktop({ kind, tag, title, body: text, silent, nav })
    return
  }

  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    // Ask once, then show this one if allowed. Browsers only let us ask from a
    // user gesture in some cases, so a denied/ignored prompt is simply a no-op.
    Notification.requestPermission().then(p => { if (p === 'granted') show() }).catch(() => {})
    return
  }
  if (Notification.permission !== 'granted') return
  show()

  function show() {
    try {
      const n = new Notification(title, { body: text, tag, silent })
      n.onclick = () => {
        try { window.focus() } catch {}
        fireClick(nav)
        n.close()
      }
    } catch (e) { console.warn('[notify]', e.message) }
  }
}

// Called once after login so the browser's permission prompt appears at a
// sensible moment (it comes from a user action — the login click).
export function requestNotificationPermission() {
  if (window.electronAPI?.notifyDesktop) return
  if (typeof Notification === 'undefined') return
  if (getSoundPrefs().desktopNotifs === false) return
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
}
