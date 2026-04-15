/* Settings tab — single scrollable page, sections grouped */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme }    from '../../ThemeContext'
import { useColors }   from '../../useColors'
import { api }         from '../../api'
import { getSoundPrefs, setSoundPref, startRingtone, stopRingtone, playDTMF } from '../../dtmf'

export default function SettingsTab({ agent, onLogout }) {
  const C = useColors()

  return (
    <div style={{ ...S.page, background: C.bg }}>
      <div style={S.scroll}>
        <ProfileSection  agent={agent} C={C} />
        <TeamSection     C={C} />
        <AudioSection    C={C} />
        <AppearanceSection C={C} />
        <IVRSection      C={C} />
        <MissedCallAutoTextSection C={C} />
        <CannedResponsesSection C={C} />
        <ZohoCRMSection  C={C} />
        <AboutSection    C={C} />

        <div style={{ padding: '8px 16px 24px' }}>
          <button
            style={{ ...S.logoutBtn, border: `1px solid rgba(239,68,68,0.4)`, color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
            onClick={onLogout}
          >
            Sign Out
          </button>
        </div>
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
      await fetch('/api/agents/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('bti_token')}` },
        body: JSON.stringify({ current_password: curr, new_password: next }),
      })
      setPwMsg('Password changed ✓')
      setCurr(''); setNext(''); setConfirm('')
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
  const [agents, setAgents] = useState([])
  useEffect(() => { api.agents().then(setAgents).catch(console.error) }, [])

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
            <div style={{ flex: 1 }}>
              <div style={{ ...S.rowLabel, color: C.text }}>{m.name}</div>
              <div style={{ ...S.rowDesc, color: C.textMuted }}>{m.phone_number !== 'TBD' ? m.phone_number : 'No number assigned'}</div>
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

      {window.electronAPI && <StartupCard C={C} />}
    </div>
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
      <ToggleRow label="Launch at login" desc="Open BTI Voice automatically when you log in to Windows" value={autoLaunch} onChange={toggle} C={C} last />
    </Card>
  )
}

/* ── Appearance section ─────────────────────────────────────────────────────── */
function AppearanceSection({ C }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div style={S.section}>
      <SectionHeader title="APPEARANCE" C={C} />
      <Card C={C}>
        <ToggleRow label="Dark Mode" desc={isDark ? 'Using dark charcoal theme' : 'Using light theme'} value={isDark} onChange={toggleTheme} C={C} last />
      </Card>
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

/* ── Canned Responses section ───────────────────────────────────────────────── */
function CannedResponsesSection({ C }) {
  const [list,    setList]    = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null) // { id, name, body }
  const [form,    setForm]    = useState({ name: '', body: '' })
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')

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
    if (!window.confirm('Delete this canned response?')) return
    try {
      await api.deleteCannedResponse(id)
      setList(prev => prev.filter(r => r.id !== id))
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
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: 2 }}>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: C.textMuted }} onClick={() => startEdit(r)} title="Edit">✏️</button>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444' }} onClick={() => handleDelete(r.id)} title="Delete">🗑</button>
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
          <div style={{ ...S.rowLabel, color: C.text, fontSize: 15, fontWeight: 700 }}>BTI Voice</div>
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

          {isElectron && (
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
}
