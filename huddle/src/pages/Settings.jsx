import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Avatar, Icon, STATUS_LABEL, BRAND } from '../ui'
import { getDevicePrefs, setDevicePrefs, listDevices, applySpeaker } from '../devices'

const STATUSES = ['available', 'busy', 'dnd', 'be_right_back', 'away']

// Settings panel: profile + status, then live camera / mic / speaker tests.
export default function Settings({ me, status, onStatus, onClose, onLogout, onToast }) {
  const [devices, setDevices] = useState({ cameras: [], mics: [], speakers: [] })
  const [prefs, setPrefs] = useState(getDevicePrefs())
  const [permError, setPermError] = useState('')
  const [level, setLevel] = useState(0)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(0)

  // Open camera + mic once so device labels become visible, then keep the
  // preview + level meter running while the panel is open.
  useEffect(() => {
    let cancelled = false
    async function open() {
      stop()
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: prefs.camera ? { deviceId: { ideal: prefs.camera } } : true,
          audio: prefs.mic ? { deviceId: { ideal: prefs.mic } } : true,
        })
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        streamRef.current = s
        if (videoRef.current) videoRef.current.srcObject = s
        setPermError('')
        // Mic level meter
        const Ctx = window.AudioContext || window.webkitAudioContext
        const ctx = new Ctx()
        audioCtxRef.current = ctx
        const src = ctx.createMediaStreamSource(s)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        src.connect(analyser)
        const buf = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch (e) {
        if (!cancelled) setPermError(e.name === 'NotAllowedError' ? 'Camera/microphone access was blocked. Allow it in your browser or system settings, then reopen Settings.' : e.message)
      }
      try { setDevices(await listDevices()) } catch { /* ignore */ }
    }
    open()
    return () => { cancelled = true; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.camera, prefs.mic])

  function stop() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
  }

  function choose(key, id) { setPrefs(setDevicePrefs({ [key]: id || undefined })) }

  // Speaker test: a short two-tone chime routed to the chosen output.
  async function testSpeaker() {
    if (playing) return
    setPlaying(true)
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      const dest = ctx.createMediaStreamDestination()
      const el = new Audio()
      el.srcObject = dest.stream
      await applySpeaker(el)
      await el.play()
      const note = (freq, t0) => {
        const o = ctx.createOscillator(), g = ctx.createGain()
        o.type = 'sine'; o.frequency.value = freq
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6)
        o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + 0.65)
      }
      note(660, ctx.currentTime); note(880, ctx.currentTime + 0.35)
      setTimeout(() => { el.pause(); ctx.close().catch(() => {}); setPlaying(false) }, 1200)
    } catch (e) { onToast('Could not play test sound: ' + e.message); setPlaying(false) }
  }

  async function changeStatus(s) {
    try { await api.setStatus(s); onStatus(s) } catch (e) { onToast(e.message) }
  }

  const sel = (key, list, placeholder) => (
    <select className="field" value={prefs[key] || ''} onChange={e => choose(key, e.target.value)}>
      <option value="">{placeholder}</option>
      {list.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
    </select>
  )

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="btn ghost sm" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="modal-body">
          <section>
            <h3>Profile</h3>
            <div className="row" style={{ padding: 0 }}>
              <Avatar agent={me} status={status} />
              <div className="grow"><div className="name">{me.name}</div><div className="sub">@{me.username}</div></div>
            </div>
            <label className="lbl">Status</label>
            <div className="chips">
              {STATUSES.map(s => (
                <button key={s} className={`chip ${status === s ? 'active' : ''}`} onClick={() => changeStatus(s)}>
                  <span className={`dot ${s}`} /> {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Camera</h3>
            {sel('camera', devices.cameras, 'Default camera')}
            <div className="preview">
              <video ref={videoRef} autoPlay playsInline muted style={{ transform: 'scaleX(-1)' }} />
              {permError && <div className="preview-msg">{permError}</div>}
            </div>
          </section>

          <section>
            <h3>Microphone</h3>
            {sel('mic', devices.mics, 'Default microphone')}
            <div className="meter" title="Speak — the bar should move">
              <div className="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <div className="hint">Say something — the bar moves when your mic hears you.</div>
          </section>

          <section>
            <h3>Speakers</h3>
            {devices.speakers.length > 0
              ? sel('speaker', devices.speakers, 'Default speakers')
              : <div className="hint">This browser doesn't allow choosing an output device; the system default is used.</div>}
            <button className="btn" onClick={testSpeaker} disabled={playing} style={{ marginTop: 8 }}>
              {playing ? 'Playing…' : '▶ Play test sound'}
            </button>
          </section>

          <section>
            <h3>About</h3>
            <div className="hint">{BRAND} v{__APP_VERSION__}{window.huddleAPI?.isDesktop ? ' · desktop' : ' · browser'}</div>
            <button className="btn danger sm" onClick={onLogout} style={{ marginTop: 10 }}><Icon.Logout /> Sign out</button>
          </section>
        </div>
      </div>
    </div>
  )
}
