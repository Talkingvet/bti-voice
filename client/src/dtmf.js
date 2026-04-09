// dtmf.js — DTMF tones, ringtone, and call sound effects via Web Audio API

const DTMF_FREQS = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
}

let _ctx = null
function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
  // Resume context if suspended (browser autoplay policy)
  if (_ctx.state === 'suspended') _ctx.resume()
  return _ctx
}

// ── Sound prefs ────────────────────────────────────────────────────────────────
export function getSoundPrefs() {
  try {
    const s = localStorage.getItem('bti_sound_prefs')
    const defaults = { dtmf: true, ringtone: true, callSounds: true, ringtoneChoice: 'default', dtmfStyle: 'phone', noiseSuppression: true }
    return s ? { ...defaults, ...JSON.parse(s) } : defaults
  } catch { return { dtmf: true, ringtone: true, callSounds: true, ringtoneChoice: 'default', dtmfStyle: 'phone', noiseSuppression: true } }
}
export function setSoundPref(key, val) {
  const p = getSoundPrefs(); p[key] = val
  localStorage.setItem('bti_sound_prefs', JSON.stringify(p))
}

// ── DTMF tone ──────────────────────────────────────────────────────────────────
// Real phone DTMF: two simultaneous pure tones, constant volume, clean cut-off
export function playDTMF(digit) {
  const prefs = getSoundPrefs()
  if (!prefs.dtmf) return
  const freqs = DTMF_FREQS[digit]
  if (!freqs) return

  const style = prefs.dtmfStyle || 'phone'
  const ac = ctx()

  // Duration and volume per style
  const cfg = {
    phone: { ms: 90,  vol: 0.18, fade: 0.008 },  // clean, short, quiet
    soft:  { ms: 110, vol: 0.09, fade: 0.02  },  // softer, slightly longer
    click: { ms: 50,  vol: 0.12, fade: 0.005 },  // very short click-like
  }[style] || { ms: 90, vol: 0.18, fade: 0.008 }

  const dur = cfg.ms / 1000

  freqs.forEach(f => {
    const osc  = ac.createOscillator()
    const gain = ac.createGain()

    // Constant volume for duration, then a short linear fade to avoid click-pop
    gain.gain.setValueAtTime(cfg.vol, ac.currentTime)
    gain.gain.setValueAtTime(cfg.vol, ac.currentTime + dur - cfg.fade)
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + dur)

    osc.frequency.value = f
    osc.type = 'sine'
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.start(ac.currentTime)
    osc.stop(ac.currentTime + dur)
  })
}

// ── Ringtone ───────────────────────────────────────────────────────────────────
let _ringInterval = null
let _ringAudio    = null

export function startRingtone() {
  if (!getSoundPrefs().ringtone) return
  stopRingtone()
  const choice = getSoundPrefs().ringtoneChoice || 'default'

  if (choice === 'custom') {
    const dataUrl = localStorage.getItem('bti_custom_ringtone')
    if (dataUrl) {
      _ringAudio = new Audio(dataUrl)
      _ringAudio.loop = true
      _ringAudio.play().catch(() => {})
      return
    }
  }

  _ringOnce(choice)
  _ringInterval = setInterval(() => _ringOnce(choice), 3800)
}

function _ringOnce(style) {
  const ac = ctx()
  if (style === 'classic') {
    _beep(ac, 480, 0,   0.4, 0.28)
    _beep(ac, 480, 0.5, 0.4, 0.28)
  } else if (style === 'soft') {
    [523, 659, 784].forEach((f, i) => _beep(ac, f, i * 0.18, 0.22, 0.14))
  } else {
    // Default: classic US phone ring (two-tone pattern)
    _beep(ac, 440, 0,   0.4, 0.28)
    _beep(ac, 480, 0,   0.4, 0.18)   // dual tone simultaneously
    _beep(ac, 440, 0.5, 0.4, 0.28)
    _beep(ac, 480, 0.5, 0.4, 0.18)
  }
}

function _beep(ac, freq, startOff, duration, vol) {
  const g = ac.createGain()
  const t = ac.currentTime + startOff
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.02)
  g.gain.setValueAtTime(vol, t + duration - 0.02)
  g.gain.linearRampToValueAtTime(0, t + duration)
  g.connect(ac.destination)
  const o = ac.createOscillator()
  o.frequency.value = freq
  o.type = 'sine'
  o.connect(g)
  o.start(t)
  o.stop(t + duration)
}

export function stopRingtone() {
  if (_ringInterval) { clearInterval(_ringInterval); _ringInterval = null }
  if (_ringAudio)    { try { _ringAudio.pause(); _ringAudio = null } catch {} }
}

// ── Call connected / disconnected ──────────────────────────────────────────────
export function playConnected() {
  if (!getSoundPrefs().callSounds) return
  const ac = ctx()
  _beep(ac, 880,  0,    0.12, 0.18)
  _beep(ac, 1047, 0.13, 0.12, 0.18)
}

export function playDisconnected() {
  if (!getSoundPrefs().callSounds) return
  const ac = ctx()
  _beep(ac, 440, 0,    0.1, 0.14)
  _beep(ac, 392, 0.12, 0.1, 0.14)
  _beep(ac, 349, 0.24, 0.1, 0.14)
}
