/* Settings tab — single scrollable page, sections grouped */
import { useState, useEffect, useRef, useCallback } from 'react'
import { BRAND } from '../../brand'
import { useTheme }    from '../../ThemeContext'
import { useColors }   from '../../useColors'
import { api }         from '../../api'
import { getSoundPrefs, setSoundPref, startRingtone, stopRingtone, playDTMF } from '../../dtmf'
import { applyFont }   from '../../utils/font'
import { useToast }    from '../Toast'

const FONTS = [
  { key: 'system',            label: 'System',        sample: 'Aa' },
  { key: 'Plus Jakarta Sans', label: 'Jakarta',       sample: 'Aa' },
  { key: 'DM Sans',           label: 'DM Sans',       sample: 'Aa' },
  { key: 'Figtree',           label: 'Figtree',       sample: 'Aa' },
  { key: 'Outfit',            label: 'Outfit',        sample: 'Aa' },
]

const TABS = [
  { id: 'profile',    label: 'Profile',     icon: '👤' },
  { id: 'audio',      label: 'Audio',       icon: '🔊' },
  { id: 'appearance', label: 'Appearance',  icon: '🎨' },
  { id: 'calls',      label: 'Calls',       icon: '📞' },
  { id: 'about',      label: 'About',       icon: 'ℹ️'  },
]

export default function SettingsTab({ agent, onLogout }) {
  const C = useColors()
  const [activeTab, setActiveTab] = useState('profile')

  return (
    <div style={{ ...S.page, background: C.bg }}>
      {/* Tab strip */}
      <div style={{ ...S.tabStrip, borderBottom: `1px solid ${C.border}`, background: C.panel }}>
        {TABS.map(tab => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...S.tabBtn,
                color:            active ? '#4f9cf9' : C.textMuted,
                borderBottom:     active ? '2px solid #4f9cf9' : '2px solid transparent',
                background:       'none',
              }}
            >
              <span style={{ fontSize: 13 }}>{tab.icon}</span>
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, marginTop: 1 }}>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div style={S.scroll}>
        {activeTab === 'profile' && (
          <>
            <ProfileSection agent={agent} C={C} />
            <TeamSection C={C} />
          </>
        )}
        {activeTab === 'audio' && (
          <AudioSection C={C} />
        )}
        {activeTab === 'appearance' && (
          <AppearanceSection C={C} />
        )}
        {activeTab === 'calls' && (
          <>
            <IVRSection C={C} />
            <NumberRoutingSection C={C} />
            <MissedCallAutoTextSection C={C} />
            <AfterHoursSMSSection C={C} />
            <ComplianceSection C={C} />
            <CannedResponsesSection C={C} />
          </>
        )}
        {activeTab === 'about' && (
          <>
            <ZohoCRMSection C={C} />
            <AboutSection C={C} />
            <div style={{ padding: '8px 16px 24px' }}>
              <button
                style={{ ...S.logoutBtn, border: `1px solid rgba(239,68,68,0.4)`, color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
                onClick={onLogout}
              >
                Sign Out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Shared components ──────────────────────────────────────────────────────── */
function SectionHeader({ title, C }) {
  return (
    <div style={{ ...S.sectionHeader, color: C.textMuted }}>
      {title}
    </div>
  )
}

function Card({ children, C }) {
  return (
    <div style={{ ...S.card, background: C.panel, border: `1px solid ${C.border}` }}>
      {children}
    </div>
  )
}

function ToggleRow({ label, desc, value, onChange, C, last }) {
  return (
    <div style={{ ...S.row, borderBottom: last ? 'none' : `1px solid ${C.borderSoft}` }}>
      <div style={{ flex: 1 }}>
        <div style={{ ...S.rowLabel, color: C.text }}>{label}</div>
        {desc && <div style={{ ...S.rowDesc, color: C.textMuted }}>{desc}</div>}
      </div>
      <button
        style={{ ...S.toggle, background: value ? '#4f9cf9' : C.surface }}
        onClick={() => onChange(!value)}
      >
        <div style={{ ...S.toggleThumb, left: value ? 21 : 3 }} />
      </button>
    </div>
  )
}

function FieldRow({ label, value, hint, colorValue, C, last }) {
  return (
    <div style={{ ...S.row, borderBottom: last ? 'none' : `1px solid ${C.borderSoft}` }}>
      <div style={{ ...S.rowDesc, color: C.textMuted, width: 110, flexShrink: 0 }}>{label}</div>
      {colorValue ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 14, height: 14, borderRadius: 3, background: colorValue }} />
          <span style={{ ...S.rowLabel, color: C.text }}>{value}</span>
        </div>
      ) : (
        <div style={{ ...S.rowLabel, color: C.text }}>{value}</div>
      )}
      {hint && <div style={{ ...S.rowDesc, color: C.textMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

/* ── Profile section ────────────────────────────────────────────────────────── */
function ProfileSection({ agent, C }) {
  const [curr, setCurr]       = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwMsg, setPwMsg]     = useState('')

  async function savePassword() {
    if (next !== confirm) { setPwMsg('Passwords do not match'); return }
    try {
      const res = await fetch('/api/agents/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('bti_token')}` },
        body: JSON.stringify({ current_password: curr, new_password: next }),
      })
      if (!res.ok) throw new Error('bad status')
      setPwMsg('Password changed ✓')
      setCurr(''); setNext(''); setConfirm('')
      window.dispatchEvent(new Event('bti-password-changed'))
    } catch { setPwMsg('Failed — check current password') }
    setTimeout(() => setPwMsg(''), 3000)
  }

  return (
    <div style={S.section}>
      <SectionHeader title="PROFILE" C={C} />
      <Card C={C}>
        <div style={{ ...S.avatarRow, borderBottom: `1px solid ${C.borderSoft}` }}>
          <div style={{ ...S.avatar, background: agent.color || '#3b82f6' }}>
            {agent.initials || agent.name?.slice(0,2).toUpperCase()}
          </div>
          <div>
            <div style={{ ...S.rowLabel, color: C.text, fontSize: 14 }}>{agent.name}</div>
            <div style={{ ...S.rowDesc, color: C.textMuted }}>@{agent.username}</div>
          </div>
        </div>
        <FieldRow label="Full name"    value={agent.name} C={C} />
        <FieldRow label="Username"     value={agent.username} C={C} />
        <FieldRow label="Phone"        value={agent.phone_number !== 'TBD' ? agent.phone_number : 'Not assigned'} hint="Contact admin to change" C={C} />
        <FieldRow label="Color"        value={agent.color} colorValue={agent.color} C={C} last />
      </Card>

      <Card C={C}>
        <div style={{ ...S.cardTitle, color: C.textMuted, borderBottom: `1px solid ${C.borderSoft}` }}>CHANGE PASSWORD</div>
        {[
          { label: 'Current password', val: curr,    set: setCurr    },
          { label: 'New password',     val: next,    set: setNext    },
          { label: 'Confirm new',      val: confirm, set: setConfirm },
        ].map(({ label, val, set }, i, arr) => (
          <div key={label} style={{ ...S.row, borderBottom: i < arr.length - 1 ? `1px solid ${C.borderSoft}` : 'none' }}>
            <div style={{ ...S.rowDesc, color: C.textMuted, width: 130, flexShrink: 0 }}>{label}</div>
            <input
              style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, flex: 1 }}
              type="password" value={val} onChange={e => set(e.target.value)}
            />
          </div>
        ))}
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={S.primaryBtn} onClick={savePassword}>Save Password</button>
          {pwMsg && <span style={{ fontSize: 12, color: pwMsg.includes('✓') ? '#22c55e' : '#ef4444' }}>{pwMsg}</span>}
        </div>
      </Card>
    </div>
  )
}

/* ── Team section ───────────────────────────────────────────────────────────── */
function TeamSection({ C }) {
  const [agents, setAgents]   = useState([])
  const [editing, setEditing] = useState(null)   // agent id being edited
  const [numDraft, setNumDraft] = useState('')
  const [numMsg, setNumMsg]     = useState('')

  useEffect(() => { api.agents().then(setAgents).catch(console.error) }, [])

  function startEdit(m) {
    setEditing(m.id)
    setNumDraft(m.phone_number && m.phone_number !== 'TBD' ? m.phone_number : '')
    setNumMsg('')
  }

  async function saveNumber(id) {
    try {
      const updated = await api.updateAgentNumber(id, numDraft.trim())
      setAgents(prev => prev.map(a => a.id === id ? { ...a, phone_number: updated.phone_number } : a))
      setEditing(null)
      setNumMsg('')
    } catch (e) {
      setNumMsg(e.message || 'Failed')
    }
  }

  return (
    <div style={S.section}>
      <SectionHeader title="TEAM" C={C} />
      <Card C={C}>
        {agents.length === 0 && (
          <div style={{ ...S.row, color: C.textMuted }}>Loading team…</div>
        )}
        {agents.map((m, i) => (
          <div key={m.id} style={{ ...S.row, borderBottom: i < agents.length - 1 ? `1px solid ${C.borderSoft}` : 'none' }}>
            <div style={{ ...S.avatar, width: 32, height: 32, fontSize: 11, background: m.color || '#3b82f6', flexShrink: 0 }}>
              {m.initials || m.name?.slice(0,2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...S.rowLabel, color: C.text }}>{m.name}</div>
              {editing === m.id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <input
                    style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: 150, fontSize: 12 }}
                    placeholder="+12395551234 (blank = none)"
                    value={numDraft}
                    onChange={e => setNumDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveNumber(m.id); if (e.key === 'Escape') setEditing(null) }}
                    autoFocus
                  />
                  <button style={{ ...S.primaryBtn, padding: '5px 10px', fontSize: 11 }} onClick={() => saveNumber(m.id)}>Save</button>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 11 }}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                  {numMsg && <span style={{ fontSize: 11, color: '#ef4444' }}>{numMsg}</span>}
                </div>
              ) : (
                <div style={{ ...S.rowDesc, color: C.textMuted }}>
                  {m.phone_number && m.phone_number !== 'TBD' ? m.phone_number : 'No number assigned'}
                  {' '}
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4f9cf9', fontSize: 11, fontWeight: 600, padding: 0 }}
                    onClick={() => startEdit(m)}
                    title="Assign or change this agent's Twilio number"
                  >
                    edit
                  </button>
                </div>
              )}
            </div>
            <div style={{ ...S.badge, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
              active
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

/* ── Audio section ──────────────────────────────────────────────────────────── */
function AudioSection({ C }) {
  const [prefs, setPrefs] = useState(getSoundPrefs())
  const fileRef = useRef(null)
  const [previewMsg, setPreviewMsg] = useState('')

  function update(key, val) { setSoundPref(key, val); setPrefs(getSoundPrefs()) }

  function previewRingtone() {
    startRingtone()
    setTimeout(() => { stopRingtone(); setPreviewMsg('') }, 3500)
    setPreviewMsg('Playing…')
  }

  function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      localStorage.setItem('bti_custom_ringtone', ev.target.result)
      update('ringtoneChoice', 'custom')
      setPreviewMsg('Saved ✓')
      setTimeout(() => setPreviewMsg(''), 2000)
    }
    reader.readAsDataURL(file)
  }

  const DTMF_STYLES  = [
    { id: 'phone', label: 'Phone',  desc: 'Classic dual-tone' },
    { id: 'soft',  label: 'Soft',   desc: 'Quieter, longer' },
    { id: 'click', label: 'Click',  desc: 'Short subtle click' },
  ]
  const RINGTONES = [
    { id: 'default', label: 'Default' },
    { id: 'classic', label: 'Classic Double Ring' },
    { id: 'soft',    label: 'Soft Chime' },
    { id: 'custom',  label: 'Custom (upload)' },
  ]

  return (
    <div style={S.section}>
      <SectionHeader title="AUDIO" C={C} />

      <Card C={C}>
        <ToggleRow
          label="Noise suppression"
          desc="Filters background noise and echo from your microphone during calls"
          value={prefs.noiseSuppression}
          onChange={v => {
            update('noiseSuppression', v)
            window.dispatchEvent(new Event('bti_noise_pref_change'))
          }}
          C={C}
        />
        <ToggleRow label="Dialpad tones"  desc="DTMF sounds when pressing keys"   value={prefs.dtmf}       onChange={v => update('dtmf', v)}       C={C} />
        <ToggleRow label="Ringtone"       desc="Sound on incoming calls"           value={prefs.ringtone}   onChange={v => update('ringtone', v)}   C={C} />
        <ToggleRow label="Call sounds"    desc="Connected and disconnected beeps"  value={prefs.callSounds} onChange={v => update('callSounds', v)} C={C} last />
      </Card>

      <Card C={C}>
        <div style={{ ...S.cardTitle, color: C.textMuted, borderBottom: `1px solid ${C.borderSoft}` }}>DIALPAD TONE STYLE</div>
        {DTMF_STYLES.map((st, i) => (
          <div
            key={st.id}
            onClick={() => { update('dtmfStyle', st.id); playDTMF('5') }}
            style={{ ...S.row, cursor: 'pointer', borderBottom: i < DTMF_STYLES.length - 1 ? `1px solid ${C.borderSoft}` : 'none', background: prefs.dtmfStyle === st.id ? 'rgba(79,156,249,0.07)' : 'transparent' }}
          >
            <Radio selected={prefs.dtmfStyle === st.id} />
            <div>
              <div style={{ ...S.rowLabel, color: C.text }}>{st.label}</div>
              <div style={{ ...S.rowDesc, color: C.textMuted }}>{st.desc}</div>
            </div>
          </div>
        ))}
      </Card>

      <Card C={C}>
        <div style={{ ...S.cardTitle, color: C.textMuted, borderBottom: `1px solid ${C.borderSoft}` }}>RINGTONE</div>
        {RINGTONES.map((rt, i) => (
          <div
            key={rt.id}
            onClick={() => update('ringtoneChoice', rt.id)}
            style={{ ...S.row, cursor: 'pointer', borderBottom: i < RINGTONES.length - 1 ? `1px solid ${C.borderSoft}` : 'none', background: prefs.ringtoneChoice === rt.id ? 'rgba(79,156,249,0.07)' : 'transparent' }}
          >
            <Radio selected={prefs.ringtoneChoice === rt.id} />
            <div style={{ ...S.rowLabel, color: C.text }}>{rt.label}</div>
          </div>
        ))}
        <div style={{ padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={S.primaryBtn} onClick={previewRingtone}>▶ Preview</button>
          <button style={{ ...S.primaryBtn, background: C.surface, color: C.text, border: `1px solid ${C.border}` }} onClick={() => fileRef.current?.click()}>
            Upload (.mp3, .wav)
          </button>
          <input ref={fileRef} type="file" accept=".mp3,.wav,.ogg,.m4a" style={{ display: 'none' }} onChange={handleUpload} />
          {previewMsg && <span style={{ fontSize: 12, color: C.textSec }}>{previewMsg}</span>}
        </div>
      </Card>

      <MicTestCard C={C} />
      {window.electronAPI && <StartupCard C={C} />}
    </div>
  )
}

/* ── Mic Test card ──────────────────────────────────────────────────────────── */
function MicTestCard({ C }) {
  const [devices,    setDevices]    = useState([])        // available mic devices
  const [deviceId,   setDeviceId]   = useState(() => localStorage.getItem('bti_mic_device') || '')
  const [testing,    setTesting]    = useState(false)
  const [level,      setLevel]      = useState(0)         // 0–100
  const [error,      setError]      = useState('')

  const streamRef   = useRef(null)
  const ctxRef      = useRef(null)
  const rafRef      = useRef(null)
  const analyserRef = useRef(null)

  // Enumerate microphones on mount (and after permission is granted)
  useEffect(() => {
    async function load() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        setDevices(all.filter(d => d.kind === 'audioinput'))
      } catch {}
    }
    load()
    navigator.mediaDevices.addEventListener?.('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', load)
  }, [])

  // Clean up when component unmounts
  useEffect(() => () => stopTest(), []) // eslint-disable-line

  function stopTest() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    ctxRef.current?.close()
    streamRef.current = null
    ctxRef.current    = null
    analyserRef.current = null
    setLevel(0)
    setTesting(false)
  }

  async function startTest() {
    setError('')
    try {
      const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // Refresh device list now that we have permission
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter(d => d.kind === 'audioinput'))

      const ctx      = new AudioContext()
      const source   = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256

      // Passthrough: hear yourself in real time
      source.connect(analyser)
      analyser.connect(ctx.destination)

      streamRef.current   = stream
      ctxRef.current      = ctx
      analyserRef.current = analyser
      setTesting(true)

      const data = new Uint8Array(analyser.frequencyBinCount)
      function tick() {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((s, v) => s + v, 0) / data.length
        setLevel(Math.min(100, Math.round(avg * 2.2)))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch (e) {
      setError(e.name === 'NotAllowedError'
        ? 'Microphone access denied — check browser/OS permissions.'
        : 'Could not access microphone: ' + e.message)
    }
  }

  function handleDeviceChange(id) {
    setDeviceId(id)
    localStorage.setItem('bti_mic_device', id)
    if (testing) { stopTest(); setTimeout(startTest, 100) }
  }

  // Level bar colour: green → amber → red
  const barColor = level > 75 ? '#ef4444' : level > 45 ? '#f59e0b' : '#22c55e'

  return (
    <Card C={C}>
      <div style={{ ...S.cardTitle, color: C.textMuted, borderBottom: `1px solid ${C.borderSoft}` }}>MIC TEST</div>

      {/* Device selector */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.borderSoft}` }}>
        <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 6 }}>Microphone</div>
        <select
          value={deviceId}
          onChange={e => handleDeviceChange(e.target.value)}
          style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: '100%' }}
        >
          <option value="">Default microphone</option>
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </div>

      {/* Level meter + controls */}
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Level bar */}
        <div>
          <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 5 }}>
            Input level {testing ? '(speak to test)' : ''}
          </div>
          <div style={{ height: 8, borderRadius: 4, background: C.surface, overflow: 'hidden', border: `1px solid ${C.borderSoft}` }}>
            <div style={{
              height: '100%',
              width: `${level}%`,
              background: barColor,
              borderRadius: 4,
              transition: 'width 0.05s linear, background 0.2s',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            style={{
              ...S.primaryBtn,
              background: testing ? '#ef4444' : '#4f9cf9',
            }}
            onClick={testing ? stopTest : startTest}
          >
            {testing ? '⏹ Stop' : '🎙 Test Mic'}
          </button>
          {testing && (
            <span style={{ fontSize: 11, color: C.textMuted }}>
              You will hear yourself in real time
            </span>
          )}
          {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
        </div>
      </div>
    </Card>
  )
}

function Radio({ selected }) {
  return (
    <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${selected ? '#4f9cf9' : '#6b7280'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 4 }}>
      {selected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4f9cf9' }} />}
    </div>
  )
}

function StartupCard({ C }) {
  const [autoLaunch, setAutoLaunch] = useState(false)
  useEffect(() => { window.electronAPI?.getAutoLaunch?.().then(v => setAutoLaunch(!!v)).catch(() => {}) }, [])
  async function toggle(val) {
    try { await window.electronAPI?.setAutoLaunch?.(val); setAutoLaunch(val) } catch {}
  }
  return (
    <Card C={C}>
      <ToggleRow label="Launch at login" desc={`Open ${BRAND} automatically when you log in to Windows`} value={autoLaunch} onChange={toggle} C={C} last />
    </Card>
  )
}

/* ── Appearance section ─────────────────────────────────────────────────────── */
const DENSITIES = [
  { key: 'compact',     label: 'Compact',     desc: 'Smaller, tighter — similar to Zoho Voice',   factor: 0.82, w: 345, h: 595 },
  { key: 'normal',      label: 'Normal',       desc: 'Default size',                                factor: 1.0,  w: 420, h: 720 },
  { key: 'comfortable', label: 'Comfortable',  desc: 'Larger text and buttons',                     factor: 1.12, w: 470, h: 806 },
]

function AppearanceSection({ C }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI
  const [density,  setDensity]  = useState(() => localStorage.getItem('bti_density') || 'normal')
  const [font,     setFont]     = useState(() => localStorage.getItem('bti_font')    || 'system')

  function applyDensity(key) {
    const d = DENSITIES.find(x => x.key === key)
    if (!d) return
    setDensity(key)
    localStorage.setItem('bti_density', key)
    if (window.electronAPI?.setZoom) window.electronAPI.setZoom(d.factor, d.w, d.h)
  }

  function handleFontChange(key) {
    setFont(key)
    localStorage.setItem('bti_font', key)
    applyFont(key)
  }

  return (
    <div style={S.section}>
      <SectionHeader title="APPEARANCE" C={C} />
      <Card C={C}>
        <ToggleRow label="Dark Mode" desc={isDark ? 'Using dark charcoal theme' : 'Using light theme'} value={isDark} onChange={toggleTheme} C={C} />
      </Card>

      {/* Font picker */}
      <Card C={C}>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Font</div>
          <div style={{ fontSize: 11, color: C.textSec, marginBottom: 12 }}>Changes the typeface across the whole app</div>
          <div style={{ display: 'flex', gap: 7 }}>
            {FONTS.map(f => {
              const active = font === f.key
              const fontFamily = f.key === 'system'
                ? `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
                : `'${f.key}', sans-serif`
              return (
                <button
                  key={f.key}
                  onClick={() => handleFontChange(f.key)}
                  style={{
                    flex: 1, padding: '10px 4px', borderRadius: 10, cursor: 'pointer',
                    border: active ? '2px solid #4f9cf9' : `2px solid ${C.border}`,
                    background: active ? 'rgba(79,156,249,0.1)' : C.surface,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontFamily, fontSize: 18, fontWeight: 600, color: active ? '#4f9cf9' : C.text, lineHeight: 1 }}>
                    {f.sample}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: active ? '#4f9cf9' : C.textSec, letterSpacing: '0.2px' }}>
                    {f.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      {isElectron && (
        <Card C={C}>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>App Size</div>
            <div style={{ fontSize: 11, color: C.textSec, marginBottom: 12 }}>Controls the overall scale of the app window</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {DENSITIES.map(d => (
                <button
                  key={d.key}
                  onClick={() => applyDensity(d.key)}
                  style={{
                    flex: 1, padding: '10px 6px', borderRadius: 10, cursor: 'pointer',
                    border: density === d.key ? '2px solid #4f9cf9' : `2px solid ${C.border}`,
                    background: density === d.key ? 'rgba(79,156,249,0.1)' : C.surface,
                    color: density === d.key ? '#4f9cf9' : C.textSec,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: density === d.key ? 700 : 500 }}>{d.label}</span>
                  <span style={{ fontSize: 9, opacity: 0.7, textAlign: 'center', lineHeight: 1.3 }}>{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

/* ── IVR / Phone Tree section ───────────────────────────────────────────────── */
function IVRSection({ C }) {
  const [settings, setSettings]   = useState({ enabled: false, greeting: '', timeout: 10 })
  const [menu,     setMenu]       = useState([])
  const [loading,  setLoading]    = useState(true)
  const [saving,   setSaving]     = useState(false)
  const [msg,      setMsg]        = useState('')
  const [agents,   setAgents]     = useState([])
  const [showAdd,  setShowAdd]    = useState(false)
  const [newItem,  setNewItem]    = useState({ digit: '', label: '', destination_type: 'all_agents', destination_value: '' })
  const [seqAgents, setSeqAgents] = useState([]) // ordered agent IDs for sequential type

  useEffect(() => {
    Promise.all([api.ivrSettings(), api.ivrMenu(), api.agents()])
      .then(([s, m, a]) => { setSettings(s); setMenu(m); setAgents(a) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function saveSettings() {
    setSaving(true)
    try {
      const updated = await api.ivrSaveSettings(settings)
      setSettings(updated)
      flash('Saved ✓')
    } catch { flash('Save failed', true) }
    setSaving(false)
  }

  async function addItem() {
    if (!newItem.digit || !newItem.label) return
    if (newItem.destination_type === 'sequential' && seqAgents.length < 1) return
    const destValue = newItem.destination_type === 'sequential'
      ? JSON.stringify(seqAgents)
      : newItem.destination_value
    try {
      const item = await api.ivrAddItem({ ...newItem, destination_value: destValue, sort_order: menu.length })
      setMenu(m => [...m, item])
      setNewItem({ digit: '', label: '', destination_type: 'all_agents', destination_value: '' })
      setSeqAgents([])
      setShowAdd(false)
    } catch { flash('Failed to add option', true) }
  }

  async function deleteItem(id) {
    try {
      await api.ivrDeleteItem(id)
      setMenu(m => m.filter(x => x.id !== id))
    } catch { flash('Failed to delete', true) }
  }

  function flash(text, isErr = false) {
    setMsg({ text, err: isErr })
    setTimeout(() => setMsg(''), 3000)
  }

  const DEST_TYPES = [
    { id: 'all_agents', label: 'Ring all agents'   },
    { id: 'sequential', label: 'Ring in sequence'  },
    { id: 'agent',      label: 'Specific agent'    },
    { id: 'voicemail',  label: 'Voicemail'         },
  ]

  const DIGITS = ['1','2','3','4','5','6','7','8','9','0','*','#']
  const usedDigits = menu.map(m => m.digit)

  if (loading) return null

  return (
    <div style={S.section}>
      <SectionHeader title="PHONE TREE (IVR)" C={C} />

      {/* Enable toggle + greeting */}
      <Card C={C}>
        <ToggleRow
          label="Enable Phone Tree"
          desc="Callers hear a menu before being connected"
          value={settings.enabled}
          onChange={v => setSettings(s => ({ ...s, enabled: v }))}
          C={C}
        />
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.borderSoft}` }}>
          <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 6 }}>Greeting message (read aloud to callers)</div>
          <textarea
            value={settings.greeting}
            onChange={e => setSettings(s => ({ ...s, greeting: e.target.value }))}
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: C.inputBg, border: `1px solid ${C.inputBorder}`,
              color: C.text, borderRadius: 6, padding: '7px 10px',
              fontSize: 12, resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <div style={{ ...S.rowDesc, color: C.textMuted }}>No-answer timeout (sec)</div>
            <input
              type="number" min={5} max={30}
              value={settings.timeout}
              onChange={e => setSettings(s => ({ ...s, timeout: parseInt(e.target.value) || 10 }))}
              style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: 60 }}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 6 }}>
              Default routing — who gets all other calls (no digit pressed, invalid key, etc.)
            </div>
            <select
              value={settings.default_agent_id || ''}
              onChange={e => setSettings(s => ({ ...s, default_agent_id: e.target.value || null }))}
              style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: '100%' }}
            >
              <option value="">Ring all agents</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 6 }}>
              Voice — how callers hear your menu
            </div>
            <select
              value={settings.voice || 'Polly.Joanna-Neural'}
              onChange={e => setSettings(s => ({ ...s, voice: e.target.value }))}
              style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: '100%' }}
            >
              <optgroup label="Female (Recommended)">
                <option value="Polly.Joanna-Neural">Joanna — Natural American Female ★</option>
                <option value="Polly.Kendra-Neural">Kendra — Warm American Female</option>
                <option value="Polly.Salli-Neural">Salli — Bright American Female</option>
                <option value="Polly.Ruth-Neural">Ruth — Conversational Female</option>
              </optgroup>
              <optgroup label="Male">
                <option value="Polly.Matthew-Neural">Matthew — Natural American Male</option>
                <option value="Polly.Stephen-Neural">Stephen — Conversational Male</option>
              </optgroup>
            </select>
            <div style={{ ...S.rowDesc, color: C.textMuted, marginTop: 4 }}>
              All voices use Amazon Polly Neural — significantly more natural than standard TTS.
            </div>
          </div>
        </div>
        <div style={{ padding: '8px 14px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={S.primaryBtn} onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {msg && <span style={{ fontSize: 12, color: msg.err ? '#ef4444' : '#22c55e' }}>{msg.text}</span>}
        </div>
      </Card>

      {/* Menu items */}
      <Card C={C}>
        <div style={{ ...S.cardTitle, color: C.textMuted, borderBottom: `1px solid ${C.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 14 }}>
          <span>MENU OPTIONS</span>
          <button
            style={{ ...S.primaryBtn, padding: '3px 10px', fontSize: 11 }}
            onClick={() => setShowAdd(v => !v)}
          >
            {showAdd ? 'Cancel' : '+ Add Option'}
          </button>
        </div>

        {menu.length === 0 && !showAdd && (
          <div style={{ ...S.row, color: C.textMuted, fontSize: 12 }}>
            No menu options yet. Add your first option above.
          </div>
        )}

        {menu.map((item, i) => (
          <div key={item.id} style={{ ...S.row, borderBottom: i < menu.length - 1 || showAdd ? `1px solid ${C.borderSoft}` : 'none' }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(79,156,249,0.15)', color: '#4f9cf9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
              {item.digit}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.rowLabel, color: C.text }}>{item.label}</div>
              <div style={{ ...S.rowDesc, color: C.textMuted }}>
                {item.destination_type === 'agent'
                  ? `→ ${agents.find(a => String(a.id) === String(item.destination_value))?.name || 'Agent'}`
                  : item.destination_type === 'voicemail'
                  ? '→ Voicemail'
                  : item.destination_type === 'sequential'
                  ? `→ ${(() => { try { return JSON.parse(item.destination_value || '[]').map(id => agents.find(a => String(a.id) === String(id))?.name || '?').join(' → ') } catch { return '?' } })()} (in order)`
                  : '→ Ring all agents'}
              </div>
            </div>
            <button
              onClick={() => deleteItem(item.id)}
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
            >×</button>
          </div>
        ))}

        {showAdd && (
          <div style={{ padding: '12px 14px', borderTop: menu.length > 0 ? `1px solid ${C.borderSoft}` : 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Digit picker */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ ...S.rowDesc, color: C.textMuted }}>Digit</div>
                <select
                  value={newItem.digit}
                  onChange={e => setNewItem(n => ({ ...n, digit: e.target.value }))}
                  style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: 60 }}
                >
                  <option value="">–</option>
                  {DIGITS.filter(d => !usedDigits.includes(d)).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Label */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ ...S.rowDesc, color: C.textMuted }}>Label (spoken to caller)</div>
                <input
                  style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: '100%' }}
                  placeholder="e.g. Sales, Support…"
                  value={newItem.label}
                  onChange={e => setNewItem(n => ({ ...n, label: e.target.value }))}
                />
              </div>
            </div>

            {/* Destination */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ ...S.rowDesc, color: C.textMuted }}>Route to</div>
                <select
                  value={newItem.destination_type}
                  onChange={e => setNewItem(n => ({ ...n, destination_type: e.target.value, destination_value: '' }))}
                  style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
                >
                  {DEST_TYPES.map(dt => <option key={dt.id} value={dt.id}>{dt.label}</option>)}
                </select>
              </div>

              {newItem.destination_type === 'agent' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ ...S.rowDesc, color: C.textMuted }}>Agent</div>
                  <select
                    value={newItem.destination_value}
                    onChange={e => setNewItem(n => ({ ...n, destination_value: e.target.value }))}
                    style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: '100%' }}
                  >
                    <option value="">Select agent…</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Sequential ring builder */}
            {newItem.destination_type === 'sequential' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ ...S.rowDesc, color: C.textMuted }}>Ring order — first available agent answers</div>

                {/* Current sequence */}
                {seqAgents.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {seqAgents.map((id, idx) => {
                      const name = agents.find(a => String(a.id) === String(id))?.name || '?'
                      return (
                        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(79,156,249,0.12)', borderRadius: 6, padding: '3px 8px' }}>
                          <span style={{ ...S.rowDesc, color: '#4f9cf9', fontWeight: 700 }}>{idx + 1}.</span>
                          <span style={{ ...S.rowLabel, color: C.text, fontSize: 12 }}>{name}</span>
                          <button onClick={() => setSeqAgents(s => s.filter((_, i) => i !== idx))}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}>×</button>
                        </div>
                      )
                    })}
                    {seqAgents.length > 1 && <span style={{ ...S.rowDesc, color: C.textMuted, alignSelf: 'center' }}>→ voicemail if no answer</span>}
                  </div>
                )}

                {/* Add agent to sequence */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    defaultValue=""
                    onChange={e => {
                      const id = e.target.value
                      if (id && !seqAgents.includes(id)) setSeqAgents(s => [...s, id])
                      e.target.value = ''
                    }}
                    style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, flex: 1 }}
                  >
                    <option value="">+ Add agent to sequence…</option>
                    {agents.filter(a => !seqAgents.includes(String(a.id))).map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <button
              style={{ ...S.primaryBtn, alignSelf: 'flex-start' }}
              onClick={addItem}
              disabled={!newItem.digit || !newItem.label}
            >
              Add Option
            </button>
          </div>
        )}
      </Card>

      {settings.enabled && menu.length > 0 && (
        <div style={{ padding: '0 4px 8px', fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
          💡 Callers hear: "{settings.greeting}" followed by each option. If they don't press anything within {settings.timeout}s, all agents are rung.
        </div>
      )}
    </div>
  )
}

/* ── About section ──────────────────────────────────────────────────────────── */
/* ── Zoho CRM section ───────────────────────────────────────────────────────── */
function ZohoCRMSection({ C }) {
  const [status,    setStatus]    = useState(null)   // { configured, present, missing }
  const [testing,   setTesting]   = useState(false)
  const [testResult,setTestResult]= useState(null)   // { ok, message, sample_contact } | { ok:false, error }
  const [copied,    setCopied]    = useState('')

  const load = useCallback(() => {
    api.zohoStatus().then(setStatus).catch(console.error)
  }, [])

  useEffect(() => { load() }, [load])

  async function runTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api.zohoTest()
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: e.message })
    }
    setTesting(false)
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(''), 1500)
    })
  }

  const configured = status?.configured
  const isDark = C.bg === '#161b24' || C.bg?.includes('1')

  const ENV_VARS = [
    { key: 'ZOHO_CLIENT_ID',     label: 'Client ID',     hint: 'From Zoho Developer Console' },
    { key: 'ZOHO_CLIENT_SECRET', label: 'Client Secret', hint: 'From Zoho Developer Console' },
    { key: 'ZOHO_REFRESH_TOKEN', label: 'Refresh Token', hint: 'Generated via OAuth flow' },
    { key: 'ZOHO_API_DOMAIN',    label: 'API Domain',    hint: 'Optional — default: https://www.zohoapis.com' },
  ]

  const SCOPES = 'ZohoCRM.modules.calls.CREATE,ZohoCRM.modules.notes.CREATE,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.contacts.WRITE'

  return (
    <div style={S.section}>
      <SectionHeader title="ZOHO CRM" C={C} />
      <Card C={C}>

        {/* Status row */}
        <div style={{ ...S.row, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...S.rowLabel, color: C.text }}>CRM Integration</div>
            <div style={{ ...S.rowDesc, color: C.textMuted }}>
              Automatically log calls and AI summaries to Zoho CRM
            </div>
          </div>
          <div style={{
            ...S.badge,
            background: configured ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.12)',
            color:      configured ? '#22c55e' : '#ef4444',
            border:     `1px solid ${configured ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}`,
          }}>
            <span style={{ fontSize: 8 }}>{configured ? '●' : '●'}</span>
            {status === null ? 'Checking…' : configured ? 'Connected' : 'Not configured'}
          </div>
        </div>

        {/* Test connection button + result */}
        {configured && (
          <div style={{ ...S.row, borderBottom: `1px solid ${C.border}`, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <button
              style={{ ...S.primaryBtn, opacity: testing ? 0.6 : 1 }}
              onClick={runTest}
              disabled={testing}
            >
              {testing ? 'Testing…' : '🔗 Test Connection'}
            </button>
            {testResult && (
              <div style={{
                fontSize: 12, padding: '8px 10px', borderRadius: 7, width: '100%',
                background: testResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color:      testResult.ok ? '#22c55e' : '#ef4444',
                border:     `1px solid ${testResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
              }}>
                {testResult.ok
                  ? `✓ Connected — sample contact: "${testResult.sample_contact}"`
                  : `✗ ${testResult.error}`
                }
              </div>
            )}
          </div>
        )}

        {/* Setup guide — shown when not configured */}
        {!configured && status !== null && (
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>
              Set these in Railway → Variables:
            </div>
            {ENV_VARS.map(({ key, label, hint }) => {
              const isSet = status?.present?.includes(key)
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, width: 14, textAlign: 'center',
                    color: isSet ? '#22c55e' : '#6b7280',
                  }}>{isSet ? '✓' : '○'}</span>
                  <code style={{
                    flex: 1, fontSize: 11, padding: '3px 7px', borderRadius: 5,
                    background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                    color: C.text, fontFamily: 'monospace', userSelect: 'all',
                  }}>{key}</code>
                  <button
                    style={{ fontSize: 10, background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '2px 4px' }}
                    onClick={() => copy(key, key)}
                  >{copied === key ? '✓' : '⎘'}</button>
                </div>
              )
            })}
          </div>
        )}

        {/* OAuth setup instructions */}
        {!configured && status !== null && (
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>
              <strong style={{ color: C.text }}>How to get credentials:</strong><br />
              1. Go to <strong>api-console.zoho.com</strong> → Self Client<br />
              2. Copy the <strong>Client ID</strong> and <strong>Client Secret</strong><br />
              3. Click <em>Generate Code</em>, paste these scopes:
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}>
              <code style={{
                flex: 1, fontSize: 10, padding: '5px 8px', borderRadius: 5,
                background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                color: C.text, fontFamily: 'monospace', wordBreak: 'break-all',
                lineHeight: 1.5,
              }}>{SCOPES}</code>
              <button
                style={{ fontSize: 10, background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '2px 4px', flexShrink: 0 }}
                onClick={() => copy(SCOPES, 'scopes')}
              >{copied === 'scopes' ? '✓' : '⎘'}</button>
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.6 }}>
              4. Use the one-time code to get a <strong>Refresh Token</strong><br />
              5. Add all three values to Railway env vars and redeploy
            </div>
          </div>
        )}

      </Card>
    </div>
  )
}

/* ── Missed Call Auto-Text section ─────────────────────────────────────────── */
/* ── Per-number inbound call routing ───────────────────────────────────────── */
function NumberRoutingSection({ C }) {
  const { toast } = useToast()
  const [rules,  setRules]  = useState([])
  const [agents, setAgents] = useState([])
  const [adding, setAdding] = useState(false)
  const [form,   setForm]   = useState({ phone_number: '', label: '', destination_type: 'agent', destination_value: '' })

  useEffect(() => {
    Promise.all([api.numberRouting(), api.agents()])
      .then(([r, a]) => { setRules(r); setAgents(a) })  // /api/agents already returns only active agents
      .catch(console.error)
  }, [])

  const TYPE_LABELS = { ivr: 'Phone tree (IVR)', agent: 'Ring one agent', all_agents: 'Ring all agents', voicemail: 'Straight to voicemail' }

  function ruleDesc(r) {
    if (r.destination_type === 'agent') return `Rings ${r.agent_name || `agent #${r.destination_value}`}`
    return TYPE_LABELS[r.destination_type] || r.destination_type
  }

  async function save() {
    if (!form.phone_number.trim()) { toast.error('Enter the Twilio number this rule applies to'); return }
    if (form.destination_type === 'agent' && !form.destination_value) { toast.error('Pick an agent'); return }
    try {
      const saved = await api.saveNumberRouting(form)
      setRules(rs => {
        const others = rs.filter(r => r.id !== saved.id)
        const agent = agents.find(a => String(a.id) === String(saved.destination_value))
        return [...others, { ...saved, agent_name: agent?.name }].sort((a, b) => a.phone_number.localeCompare(b.phone_number))
      })
      setAdding(false)
      setForm({ phone_number: '', label: '', destination_type: 'agent', destination_value: '' })
      toast.success('Routing rule saved')
    } catch (e) {
      toast.error(e.message)
    }
  }

  async function remove(id) {
    try {
      await api.deleteNumberRouting(id)
      setRules(rs => rs.filter(r => r.id !== id))
      toast.success('Rule removed — number falls back to the phone tree')
    } catch (e) {
      toast.error(e.message)
    }
  }

  const inputStyle = {
    background: C.surface, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none',
  }

  return (
    <>
      <SectionHeader title="Number Routing" C={C} />
      <Card C={C}>
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 10 }}>
            Route inbound calls per company number. Numbers without a rule use the phone tree / default routing above.
          </div>

          {rules.length === 0 && !adding && (
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>No routing rules yet — every number uses the shared phone tree.</div>
          )}

          {rules.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.borderSoft}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                  {r.phone_number}{r.label ? ` — ${r.label}` : ''}
                </div>
                <div style={{ fontSize: 12, color: C.textSec }}>{ruleDesc(r)}</div>
              </div>
              <button
                onClick={() => remove(r.id)}
                style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >Remove</button>
            </div>
          ))}

          {adding ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={form.phone_number}
                  onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                  placeholder="Twilio number, e.g. +12394755114"
                  style={{ ...inputStyle, flex: 1.2 }}
                />
                <input
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Label (optional)"
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={form.destination_type}
                  onChange={e => setForm(f => ({ ...f, destination_type: e.target.value }))}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="agent">Ring one agent</option>
                  <option value="all_agents">Ring all agents</option>
                  <option value="voicemail">Straight to voicemail</option>
                  <option value="ivr">Phone tree (IVR)</option>
                </select>
                {form.destination_type === 'agent' && (
                  <select
                    value={form.destination_value}
                    onChange={e => setForm(f => ({ ...f, destination_value: e.target.value }))}
                    style={{ ...inputStyle, flex: 1 }}
                  >
                    <option value="">Pick an agent…</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 12, cursor: 'pointer' }}
                  onClick={() => setAdding(false)}
                >Cancel</button>
                <button
                  style={{ background: '#4f9cf9', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}
                  onClick={save}
                >Save rule</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              style={{ marginTop: 10, border: '1px solid rgba(79,156,249,0.4)', background: 'rgba(79,156,249,0.12)', color: '#4f9cf9', borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >+ Add routing rule</button>
          )}
        </div>
      </Card>
    </>
  )
}

function MissedCallAutoTextSection({ C }) {
  const [settings, setSettings] = useState({ auto_text_enabled: false, auto_text_message: '' })
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState('')

  useEffect(() => {
    api.ivrSettings()
      .then(s => setSettings(s))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    try {
      const updated = await api.ivrSaveSettings(settings)
      setSettings(updated)
      setMsg({ text: 'Saved ✓', err: false })
    } catch {
      setMsg({ text: 'Save failed', err: true })
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  if (loading) return null

  return (
    <div style={S.section}>
      <SectionHeader title="MISSED CALL AUTO-TEXT" C={C} />
      <Card C={C}>
        <ToggleRow
          label="Send auto-text on missed call"
          desc="Automatically texts the caller if no one answered"
          value={!!settings.auto_text_enabled}
          onChange={v => setSettings(s => ({ ...s, auto_text_enabled: v }))}
          C={C}
        />
        {settings.auto_text_enabled && (
          <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.borderSoft}` }}>
            <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 6 }}>
              Message sent to the caller (keep it short and friendly)
            </div>
            <textarea
              value={settings.auto_text_message || ''}
              onChange={e => setSettings(s => ({ ...s, auto_text_message: e.target.value }))}
              rows={3}
              placeholder="Hi! We missed your call. We'll get back to you as soon as possible."
              style={{
                width: '100%', boxSizing: 'border-box',
                background: C.inputBg, border: `1px solid ${C.inputBorder}`,
                color: C.text, borderRadius: 6, padding: '7px 10px',
                fontSize: 12, resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            <div style={{ ...S.rowDesc, color: C.textMuted, marginTop: 4 }}>
              Sent from your Twilio number. Standard SMS rates apply.
            </div>
          </div>
        )}
        <div style={{ padding: '8px 14px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={S.primaryBtn} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg && <span style={{ fontSize: 12, color: msg.err ? '#ef4444' : '#22c55e' }}>{msg.text}</span>}
        </div>
      </Card>
    </div>
  )
}

/* ── After-Hours SMS Auto-Responder section ─────────────────────────────────── */
const TZ_OPTIONS = [
  ['America/New_York',    'Eastern'],
  ['America/Chicago',     'Central'],
  ['America/Denver',      'Mountain'],
  ['America/Phoenix',     'Arizona (no DST)'],
  ['America/Los_Angeles', 'Pacific'],
]
const DAY_OPTIONS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']]

function AfterHoursSMSSection({ C }) {
  const [settings, setSettings] = useState(null)
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState('')

  useEffect(() => {
    api.ivrSettings().then(setSettings).catch(console.error)
  }, [])

  async function save() {
    setSaving(true)
    try {
      const updated = await api.ivrSaveSettings(settings)
      setSettings(updated)
      setMsg({ text: 'Saved ✓', err: false })
    } catch {
      setMsg({ text: 'Save failed', err: true })
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  if (!settings) return null

  const days = String(settings.business_days || '1,2,3,4,5').split(',').filter(Boolean).map(Number)
  const toggleDay = (d) => {
    const next = days.includes(d) ? days.filter(x => x !== d) : [...days, d].sort((a, b) => a - b)
    setSettings(s => ({ ...s, business_days: next.join(',') }))
  }

  const inputStyle = {
    background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text,
    borderRadius: 6, padding: '6px 9px', fontSize: 12, fontFamily: 'inherit',
  }

  return (
    <div style={S.section}>
      <SectionHeader title="AFTER-HOURS SMS AUTO-REPLY" C={C} />
      <Card C={C}>
        <ToggleRow
          label="Auto-reply to texts outside business hours"
          desc="Sends one automatic reply per conversation (max every 4 hours). Skips STOP/HELP keywords and opted-out contacts."
          value={!!settings.after_hours_sms_enabled}
          onChange={v => setSettings(s => ({ ...s, after_hours_sms_enabled: v }))}
          C={C}
        />
        {settings.after_hours_sms_enabled && (
          <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.borderSoft}` }}>
            <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 6 }}>Auto-reply message</div>
            <textarea
              value={settings.after_hours_sms_message || ''}
              onChange={e => setSettings(s => ({ ...s, after_hours_sms_message: e.target.value }))}
              rows={3}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              <div>
                <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 4 }}>Business hours</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="time"
                    value={settings.business_hours_start || '09:00'}
                    onChange={e => setSettings(s => ({ ...s, business_hours_start: e.target.value }))}
                    style={inputStyle}
                  />
                  <span style={{ color: C.textMuted, fontSize: 12 }}>to</span>
                  <input
                    type="time"
                    value={settings.business_hours_end || '17:00'}
                    onChange={e => setSettings(s => ({ ...s, business_hours_end: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div>
                <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 4 }}>Timezone</div>
                <select
                  value={settings.business_timezone || 'America/New_York'}
                  onChange={e => setSettings(s => ({ ...s, business_timezone: e.target.value }))}
                  style={inputStyle}
                >
                  {TZ_OPTIONS.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 4 }}>Business days</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DAY_OPTIONS.map(([d, label]) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(d)}
                    style={{
                      ...inputStyle,
                      cursor: 'pointer', fontWeight: 600,
                      background: days.includes(d) ? '#4f9cf9' : C.inputBg,
                      color: days.includes(d) ? '#fff' : C.textMuted,
                      border: `1px solid ${days.includes(d) ? '#4f9cf9' : C.inputBorder}`,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div style={{ padding: '8px 14px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={S.primaryBtn} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg && <span style={{ fontSize: 12, color: msg.err ? '#ef4444' : '#22c55e' }}>{msg.text}</span>}
        </div>
      </Card>
    </div>
  )
}

/* ── Canned Responses section ───────────────────────────────────────────────── */
/* ── SMS compliance (A2P consent audit export) ─────────────────────────────── */
function ComplianceSection({ C }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const blob = await api.exportConsentCsv()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `consent-log-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHeader title="SMS Compliance" C={C} />
      <Card C={C}>
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>Consent audit log</div>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 10 }}>
            Every opt-in and opt-out event (inbound texts, STOP/START keywords, carrier blocks, and manually
            recorded consent) — exportable as CSV for A2P 10DLC / carrier audits.
          </div>
          <button
            onClick={download}
            disabled={busy}
            style={{ border: '1px solid rgba(79,156,249,0.4)', background: 'rgba(79,156,249,0.12)', color: '#4f9cf9', borderRadius: 9, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
          >{busy ? 'Exporting…' : '⬇ Download consent log (CSV)'}</button>
        </div>
      </Card>
    </>
  )
}

function CannedResponsesSection({ C }) {
  const [list,       setList]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [editing,    setEditing]    = useState(null) // { id, name, body }
  const [form,       setForm]       = useState({ name: '', body: '' })
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState('')
  const [confirmDel, setConfirmDel] = useState(null) // id pending delete

  useEffect(() => {
    api.cannedResponses().then(setList).catch(console.error).finally(() => setLoading(false))
  }, [])

  function flash(text, err = false) {
    setMsg({ text, err })
    setTimeout(() => setMsg(''), 3000)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.body.trim() || saving) return
    setSaving(true)
    try {
      if (editing) {
        const updated = await api.updateCannedResponse(editing.id, form)
        setList(prev => prev.map(r => r.id === updated.id ? updated : r).sort((a,b) => a.name.localeCompare(b.name)))
        setEditing(null)
        flash('Updated ✓')
      } else {
        const created = await api.addCannedResponse(form)
        setList(prev => [...prev, created].sort((a,b) => a.name.localeCompare(b.name)))
        flash('Saved ✓')
      }
      setForm({ name: '', body: '' })
      setShowAdd(false)
    } catch (e) {
      flash('Failed: ' + e.message, true)
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (confirmDel !== id) { setConfirmDel(id); return }
    setConfirmDel(null)
    try {
      await api.deleteCannedResponse(id)
      setList(prev => prev.filter(r => r.id !== id))
      flash('Deleted ✓')
    } catch (e) {
      flash('Delete failed', true)
    }
  }

  function startEdit(r) {
    setEditing(r)
    setForm({ name: r.name, body: r.body })
    setShowAdd(true)
  }

  function cancelForm() {
    setEditing(null)
    setForm({ name: '', body: '' })
    setShowAdd(false)
  }

  if (loading) return null

  return (
    <div style={S.section}>
      <SectionHeader title="CANNED RESPONSES" C={C} />
      <Card C={C}>
        <div style={{ ...S.cardTitle, color: C.textMuted, borderBottom: `1px solid ${C.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 14 }}>
          <span>QUICK REPLIES · type / in any message box</span>
          {!showAdd && (
            <button style={{ ...S.primaryBtn, padding: '3px 10px', fontSize: 11 }} onClick={() => setShowAdd(true)}>
              + Add
            </button>
          )}
        </div>

        {/* Add / Edit form */}
        {showAdd && (
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.borderSoft}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {editing && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>Editing: {editing.name}</div>}
            <div>
              <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 4 }}>Name (shown in / dropdown)</div>
              <input
                style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, width: '100%' }}
                placeholder="e.g. Follow-up, Intro, Pricing…"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <div style={{ ...S.rowDesc, color: C.textMuted, marginBottom: 4 }}>Message body</div>
              <textarea
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, borderRadius: 6, padding: '7px 10px', fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
                placeholder="Hi, this is [Name] from Talkingvet…"
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={{ ...S.primaryBtn, opacity: saving || !form.name.trim() || !form.body.trim() ? 0.5 : 1 }} onClick={handleSave} disabled={saving || !form.name.trim() || !form.body.trim()}>
                {saving ? 'Saving…' : editing ? 'Update' : 'Save'}
              </button>
              <button style={{ ...S.primaryBtn, background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}` }} onClick={cancelForm}>
                Cancel
              </button>
              {msg && <span style={{ fontSize: 12, color: msg.err ? '#ef4444' : '#22c55e' }}>{msg.text}</span>}
            </div>
          </div>
        )}

        {/* List */}
        {list.length === 0 && !showAdd && (
          <div style={{ ...S.row, color: C.textMuted, fontSize: 12 }}>
            No canned responses yet. Add one above and type / in any message to use it.
          </div>
        )}
        {list.map((r, i) => (
          <div key={r.id} style={{ ...S.row, borderBottom: i < list.length - 1 ? `1px solid ${C.borderSoft}` : 'none', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.rowLabel, color: '#4f9cf9', fontSize: 12 }}>{r.name}</div>
              <div style={{ ...S.rowDesc, color: C.textMuted, marginTop: 2, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{r.body}</div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: 2, alignItems: 'center' }}>
              {confirmDel === r.id ? (
                <>
                  <button style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: 'none', background: '#ef4444', color: 'white', cursor: 'pointer', fontWeight: 700 }} onClick={() => handleDelete(r.id)}>Delete</button>
                  <button style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: 'none', background: 'transparent', color: C.textMuted, cursor: 'pointer' }} onClick={() => setConfirmDel(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textMuted }} onClick={() => startEdit(r)} title="Edit">✏️</button>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444' }} onClick={() => handleDelete(r.id)} title="Delete">🗑</button>
                </>
              )}
            </div>
          </div>
        ))}

        {!showAdd && msg && (
          <div style={{ padding: '6px 14px', fontSize: 12, color: msg.err ? '#ef4444' : '#22c55e' }}>{msg.text}</div>
        )}
      </Card>
    </div>
  )
}

function AboutSection({ C }) {
  const isElectron = !!window.electronAPI
  // Updates are Windows-only for now (the update feed serves a Windows .exe);
  // showing the button on Mac would download an installer it can't run.
  const canUpdate = isElectron && window.electronAPI?.platform === 'win32'
  const [version,    setVersion]    = useState('1.0.0')
  const [updateStatus, setUpdateStatus] = useState(null) // null | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  const [updateVersion, setUpdateVersion] = useState(null)
  const [progress,   setProgress]   = useState(0)

  useEffect(() => {
    if (!isElectron) return
    window.electronAPI.getAppVersion().then(setVersion).catch(() => {})
    window.electronAPI.onUpdateAvailable(({ version }) => {
      setUpdateVersion(version)
      setUpdateStatus('available')
    })
    window.electronAPI.onUpdateProgress(({ percent }) => {
      setProgress(percent)
      setUpdateStatus('downloading')
    })
    window.electronAPI.onUpdateDownloaded(() => setUpdateStatus('ready'))
  }, [isElectron])

  async function checkForUpdates() {
    setUpdateStatus('checking')
    const result = await window.electronAPI.checkForUpdates()
    if (result.status === 'up-to-date') setUpdateStatus('up-to-date')
    else if (result.status === 'error')  { setUpdateStatus('error'); console.error('[update]', result.message) }
    // 'available' is handled by the onUpdateAvailable listener
  }

  function downloadUpdate() {
    setUpdateStatus('downloading')
    window.electronAPI.downloadUpdate()
  }

  function installUpdate() {
    window.electronAPI.installUpdate()
  }

  const updateLabel = {
    checking:    'Checking…',
    'up-to-date':'You\'re on the latest version ✓',
    available:   `Update to v${updateVersion}`,
    downloading: `Downloading… ${progress}%`,
    ready:       'Restart & Install',
    error:       'Check failed — try again',
  }[updateStatus]

  const updateAction = {
    available:   downloadUpdate,
    ready:       installUpdate,
    error:       checkForUpdates,
  }[updateStatus] || checkForUpdates

  return (
    <div style={S.section}>
      <SectionHeader title="ABOUT" C={C} />
      <Card C={C}>
        <div style={S.aboutHero}>
          <div style={S.aboutLogo}>B</div>
          <div style={{ ...S.rowLabel, color: C.text, fontSize: 15, fontWeight: 700 }}>{BRAND}</div>
          <div style={{ ...S.rowDesc, color: C.textMuted }}>Version {version}</div>
          <div style={{ ...S.rowDesc, color: C.textMuted, marginTop: 4 }}>
            Created by Danny Roche · Business Technology Insight, LLC
          </div>
          <a
            href="https://businesstechnologyinsight.com/"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#4f9cf9', fontSize: 13, marginTop: 8, textDecoration: 'none', fontWeight: 600 }}
          >
            Need Help? →
          </a>

          {canUpdate && (
            <button
              onClick={updateStatus === 'checking' || updateStatus === 'downloading' ? undefined : updateAction}
              style={{
                marginTop: 14,
                padding: '7px 18px',
                borderRadius: 8,
                border: 'none',
                cursor: updateStatus === 'checking' || updateStatus === 'downloading' ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
                background: updateStatus === 'ready' ? '#22c55e'
                          : updateStatus === 'error'  ? 'rgba(239,68,68,0.15)'
                          : updateStatus === 'up-to-date' ? 'rgba(79,156,249,0.1)'
                          : '#4f9cf9',
                color: updateStatus === 'error' ? '#ef4444'
                     : updateStatus === 'up-to-date' ? '#4f9cf9'
                     : 'white',
              }}
            >
              {updateLabel || 'Check for Updates'}
            </button>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */
const S = {
  page:   { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  scroll: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  section: { padding: '0 12px 4px' },
  sectionHeader: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, padding: '12px 4px 6px' },
  card:   { borderRadius: 10, marginBottom: 10, overflow: 'hidden' },
  cardTitle: { padding: '8px 14px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 },

  row:    { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' },
  rowLabel: { fontSize: 13, fontWeight: 500 },
  rowDesc:  { fontSize: 11, marginTop: 1 },

  avatarRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' },
  avatar:    { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: 'white', flexShrink: 0 },

  badge: { display: 'flex', alignItems: 'center', gap: 4, borderRadius: 10, padding: '2px 7px', fontSize: 10, fontWeight: 600 },

  toggle:      { width: 38, height: 21, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s' },
  toggleThumb: { position: 'absolute', top: 3, width: 15, height: 15, borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' },

  input: { padding: '6px 10px', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  primaryBtn: { padding: '6px 14px', background: '#4f9cf9', color: 'white', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' },

  aboutHero: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px 18px', gap: 2 },
  aboutLogo: { width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#1d4ed8,#4f9cf9)', color: 'white', fontWeight: 900, fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },

  logoutBtn: { width: '100%', padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'center' },

  tabStrip: { display: 'flex', flexShrink: 0 },
  tabBtn:   { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 4px 6px', border: 'none', cursor: 'pointer', transition: 'color 0.15s' },
}
