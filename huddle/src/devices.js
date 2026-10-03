// Remembered device choices (camera / mic / speaker) — per browser or desktop
// install, so each machine keeps its own. Used by Settings and by HuddleCall.

const KEY = 'bti_huddle_devices'

export function getDevicePrefs() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
export function setDevicePrefs(patch) {
  const next = { ...getDevicePrefs(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

// Constraints for getUserMedia honoring saved choices. 'ideal' (not 'exact')
// so an unplugged device falls back to the default instead of failing.
export function mediaConstraints({ video = true, audio = true } = {}) {
  const p = getDevicePrefs()
  return {
    video: video ? (p.camera ? { deviceId: { ideal: p.camera } } : true) : false,
    audio: audio ? (p.mic ? { deviceId: { ideal: p.mic }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true }) : false,
  }
}

// Route an <audio>/<video> element to the chosen speaker where supported
// (Chrome / Electron: yes; Safari: no — silently ignored).
export async function applySpeaker(el) {
  const p = getDevicePrefs()
  if (!el || !p.speaker || typeof el.setSinkId !== 'function') return
  try { await el.setSinkId(p.speaker) } catch (e) { console.warn('[devices] setSinkId failed:', e.message) }
}

export async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices()
  const label = (d, i, kind) => d.label || `${kind} ${i + 1}`
  return {
    cameras:  all.filter(d => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: label(d, i, 'Camera') })),
    mics:     all.filter(d => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: label(d, i, 'Microphone') })),
    speakers: all.filter(d => d.kind === 'audiooutput').map((d, i) => ({ id: d.deviceId, label: label(d, i, 'Speaker') })),
  }
}
