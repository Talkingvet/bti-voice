/* Settings tab — fully theme-aware, no hardcoded light colors */
import { useState } from 'react'
import { useTheme } from '../../ThemeContext'
import { useColors } from '../../useColors'

export default function SettingsTab({ agent, onLogout }) {
  const C = useColors()
  const [tab, setTab] = useState('profile')

  const navItems = [
    { id: 'profile',       icon: '👤', label: 'Profile' },
    { id: 'team',          icon: '👥', label: 'Team' },
    { id: 'notifications', icon: '🔔', label: 'Notifications' },
    { id: 'appearance',    icon: '🎨', label: 'Appearance' },
    { id: 'about',         icon: 'ℹ️',  label: 'About' },
  ]

  return (
    <div style={{ ...S.wrap, background: C.bg }}>
      {/* Left nav */}
      <div style={{ ...S.nav, background: C.panel, borderRight: `1px solid ${C.border}` }}>
        {navItems.map(({ id, icon, label }) => (
          <button
            key={id}
            style={{
              ...S.navBtn,
              color: tab === id ? '#4f9cf9' : C.textSec,
              background: tab === id ? 'rgba(79,156,249,0.12)' : 'transparent',
              fontWeight: tab === id ? 600 : 500,
            }}
            onClick={() => setTab(id)}
          >
            <span style={S.navIcon}>{icon}</span>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          style={{ ...S.logoutBtn, border: `1px solid ${C.border}`, color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
          onClick={onLogout}
        >
          Sign Out
        </button>
      </div>

      {/* Content */}
      <div style={{ ...S.content, background: C.bg }}>
        {tab === 'profile'       && <ProfilePanel       agent={agent} C={C} />}
        {tab === 'team'          && <TeamPanel           C={C} />}
        {tab === 'notifications' && <NotifPanel          C={C} />}
        {tab === 'appearance'    && <AppearancePanel     C={C} />}
        {tab === 'about'         && <AboutPanel          C={C} />}
      </div>
    </div>
  )
}

/* ── Shared section wrapper ─────────────────────────────────────── */
function Section({ title, children, C }) {
  return (
    <div style={{ ...P.section, background: C.panel, border: `1px solid ${C.border}` }}>
      <div style={{ ...P.sectionTitle, borderBottom: `1px solid ${C.borderSoft}`, color: C.textMuted }}>
        {title}
      </div>
      {children}
    </div>
  )
}

/* ── Profile panel ──────────────────────────────────────────────── */
function ProfilePanel({ agent, C }) {
  return (
    <div style={P.page}>
      <Section title="YOUR PROFILE" C={C}>
        <div style={P.avatarRow}>
          <div style={{ ...P.avatar, background: agent.color || '#3b82f6' }}>
            {agent.initials || agent.name?.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ ...P.agentName, color: C.text }}>{agent.name}</div>
            <div style={{ ...P.agentUser, color: C.textMuted }}>@{agent.username}</div>
          </div>
        </div>
        <Field label="Full name"    value={agent.name} C={C} />
        <Field label="Username"     value={agent.username} C={C} />
        <Field
          label="Phone number"
          value={agent.phone_number !== 'TBD' ? agent.phone_number : 'Not assigned'}
          hint="Contact admin to change your Twilio number"
          C={C}
        />
        <Field label="Color" value={agent.color} colorValue={agent.color} C={C} />
      </Section>

      <Section title="CHANGE PASSWORD" C={C}>
        <Field label="Current password" type="password" editable C={C} />
        <Field label="New password"     type="password" editable C={C} />
        <Field label="Confirm new"      type="password" editable C={C} />
        <div style={{ padding: '10px 16px 14px' }}>
          <button style={P.saveBtn}>Save Password</button>
        </div>
      </Section>
    </div>
  )
}

/* ── Team panel ─────────────────────────────────────────────────── */
function TeamPanel({ C }) {
  const members = [
    { name: 'Shawn', initials: 'SH', color: '#3b82f6', phone: 'TBD', status: 'online' },
    { name: 'Danny', initials: 'DN', color: '#10b981', phone: 'TBD', status: 'online' },
    { name: 'Raven', initials: 'RV', color: '#8b5cf6', phone: 'TBD', status: 'online' },
  ]
  return (
    <div style={P.page}>
      <Section title="TEAM MEMBERS" C={C}>
        {members.map(m => (
          <div key={m.name} style={{ ...P.memberRow, borderBottom: `1px solid ${C.borderSoft}` }}>
            <div style={{ ...P.memberAvatar, background: m.color }}>{m.initials}</div>
            <div style={P.memberInfo}>
              <div style={{ ...P.memberName, color: C.text }}>{m.name}</div>
              <div style={{ ...P.memberPhone, color: C.textMuted }}>{m.phone !== 'TBD' ? m.phone : 'No number assigned'}</div>
            </div>
            <div style={{ ...P.onlineBadge, background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
              <div style={{ ...P.onlineDot, background: '#22c55e' }} />
              online
            </div>
          </div>
        ))}
      </Section>

      <Section title="PHONE NUMBERS" C={C}>
        <div style={{ ...P.infoBox, background: C.surface, border: `1px solid ${C.borderSoft}`, color: C.textSec }}>
          Phone numbers will appear here once your team's Twilio numbers are configured.
          Each team member gets their own Twilio number, but all messages appear in this shared inbox.
        </div>
      </Section>
    </div>
  )
}

/* ── Notifications panel ────────────────────────────────────────── */
function NotifPanel({ C }) {
  const [prefs, setPrefs] = useState({
    newSMS:      true,
    inboundCall: true,
    missedCall:  true,
    doubleText:  true,
    sound:       true,
  })
  const toggle = key => setPrefs(p => ({ ...p, [key]: !p[key] }))

  const rows = [
    { key: 'newSMS',      label: 'New inbound SMS',    desc: 'Notify when a customer sends a message' },
    { key: 'inboundCall', label: 'Incoming call',       desc: 'Notify when a call comes in' },
    { key: 'missedCall',  label: 'Missed call',         desc: 'Notify when a call is not answered' },
    { key: 'doubleText',  label: 'Double-text warning', desc: 'Alert when two agents text the same customer' },
    { key: 'sound',       label: 'Sound effects',       desc: 'Play a sound with notifications' },
  ]

  return (
    <div style={P.page}>
      <Section title="NOTIFICATION PREFERENCES" C={C}>
        {rows.map(({ key, label, desc }) => (
          <div key={key} style={{ ...P.toggleRow, borderBottom: `1px solid ${C.borderSoft}` }}>
            <div>
              <div style={{ ...P.toggleLabel, color: C.text }}>{label}</div>
              <div style={{ ...P.toggleDesc,  color: C.textMuted }}>{desc}</div>
            </div>
            <button
              style={{ ...P.toggle, background: prefs[key] ? '#4f9cf9' : C.surface }}
              onClick={() => toggle(key)}
              aria-label={label}
            >
              <div style={{ ...P.toggleThumb, left: prefs[key] ? 21 : 3 }} />
            </button>
          </div>
        ))}
      </Section>
    </div>
  )
}

/* ── Appearance panel ───────────────────────────────────────────── */
function AppearancePanel({ C }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div style={P.page}>
      <Section title="THEME" C={C}>
        <div style={{ ...P.toggleRow, borderBottom: `1px solid ${C.borderSoft}` }}>
          <div>
            <div style={{ ...P.toggleLabel, color: C.text }}>Dark Mode</div>
            <div style={{ ...P.toggleDesc, color: C.textMuted }}>
              {isDark ? 'Using dark charcoal theme' : 'Using light theme'}
            </div>
          </div>
          <button
            style={{ ...P.toggle, background: isDark ? '#4f9cf9' : C.surface }}
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
          >
            <div style={{ ...P.toggleThumb, left: isDark ? 21 : 3 }} />
          </button>
        </div>

        <div style={{ padding: '12px 16px' }}>
          <div style={{ ...P.previewLabel, color: C.textMuted }}>Preview</div>
          <div style={{ ...P.previewShell, background: isDark ? '#161b24' : '#f4f6f9', border: `1px solid ${C.border}` }}>
            <div style={{ height: 10, background: isDark ? '#1d2330' : '#1a2035', borderRadius: '3px 3px 0 0', display: 'flex', alignItems: 'center', paddingLeft: 5, gap: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4f9cf9' }} />
              <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.15)', borderRadius: 1, margin: '0 4px' }} />
            </div>
            <div style={{ display: 'flex', height: 38 }}>
              <div style={{ flex: 1, background: isDark ? '#161b24' : '#f4f6f9', padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ height: 5, background: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)', borderRadius: 2, width: '70%' }} />
                <div style={{ height: 4, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)', borderRadius: 2, width: '50%' }} />
                <div style={{ height: 4, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)', borderRadius: 2, width: '60%' }} />
              </div>
            </div>
            <div style={{ height: 12, background: isDark ? '#1d2330' : '#ffffff', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 4px' }}>
              {[0,1,2,3,4].map(i => (
                <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: i === 1 ? '#4f9cf9' : (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)') }} />
              ))}
            </div>
          </div>
          <div style={{ ...P.previewCaption, color: C.textMuted }}>{isDark ? 'Dark mode' : 'Light mode'}</div>
        </div>
      </Section>
    </div>
  )
}

/* ── About panel ────────────────────────────────────────────────── */
function AboutPanel({ C }) {
  return (
    <div style={P.page}>
      <Section title="BTI VOICE" C={C}>
        <div style={P.aboutHero}>
          <div style={P.aboutLogo}>B</div>
          <div style={{ ...P.aboutName, color: C.text }}>BTI Voice</div>
          <div style={{ ...P.aboutVersion, color: C.textMuted }}>Version 1.0.0</div>
        </div>
        <Field label="Built by"   value="Business Technology Insight"     C={C} />
        <Field label="Backend"    value="Railway (Node.js + PostgreSQL)"   C={C} />
        <Field label="SMS / VOIP" value="Twilio API"                       C={C} />
        <Field label="Desktop"    value="Electron"                         C={C} />
        <div style={{ ...P.infoBox, background: C.surface, border: `1px solid ${C.borderSoft}`, color: C.textSec }}>
          BTI Voice is a shared SMS &amp; VOIP inbox for your team.
          All agents see every conversation. The double-text detection system
          prevents two agents from accidentally messaging the same customer.
        </div>
      </Section>
    </div>
  )
}

/* ── Field component ────────────────────────────────────────────── */
function Field({ label, value, type = 'text', hint, editable, colorValue, C }) {
  return (
    <div style={{ ...P.field, borderBottom: `1px solid ${C.borderSoft}` }}>
      <label style={{ ...P.label, color: C.textMuted }}>{label}</label>
      {colorValue ? (
        <div style={P.colorRow}>
          <div style={{ ...P.colorSwatch, background: colorValue }} />
          <span style={{ ...P.fieldValue, color: C.text }}>{value}</span>
        </div>
      ) : editable ? (
        <input
          style={{ ...P.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
          type={type}
          placeholder="••••••••"
        />
      ) : (
        <div style={{ ...P.fieldValue, color: C.text }}>{value}</div>
      )}
      {hint && <div style={{ ...P.hint, color: C.textMuted }}>{hint}</div>}
    </div>
  )
}

/* ── Outer shell ────────────────────────────────────────────────── */
const S = {
  wrap: { display: 'flex', flex: 1, height: '100%', overflow: 'hidden' },
  nav: {
    width: 160, display: 'flex', flexDirection: 'column',
    padding: '10px 6px', flexShrink: 0,
  },
  navBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    textAlign: 'left', padding: '8px 10px',
    border: 'none', borderRadius: 7,
    fontSize: 12.5, cursor: 'pointer',
    transition: 'background 0.12s, color 0.12s',
    marginBottom: 2,
  },
  navIcon: { fontSize: 14, width: 18, textAlign: 'center' },
  logoutBtn: {
    margin: '6px 4px 4px', padding: '8px 10px',
    borderRadius: 7, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', textAlign: 'left',
  },
  content: { flex: 1, overflowY: 'auto' },
}

/* ── Panel styles ───────────────────────────────────────────────── */
const P = {
  page:    { padding: '16px 20px', maxWidth: 460 },
  section: { borderRadius: 10, marginBottom: 16, overflow: 'hidden' },
  sectionTitle: {
    padding: '10px 16px',
    fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  avatarRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px 10px' },
  avatar: {
    width: 44, height: 44, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 15, fontWeight: 800, color: 'white',
  },
  agentName: { fontSize: 14, fontWeight: 700 },
  agentUser: { fontSize: 11, marginTop: 1 },

  field:      { padding: '9px 16px' },
  label:      { display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  fieldValue: { fontSize: 13 },
  hint:       { fontSize: 10, marginTop: 3 },
  input: {
    width: '100%', padding: '7px 10px', borderRadius: 6,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  colorRow: { display: 'flex', alignItems: 'center', gap: 8 },
  colorSwatch: { width: 16, height: 16, borderRadius: 4 },
  saveBtn: {
    padding: '7px 16px', background: '#4f9cf9', color: 'white',
    border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },

  memberRow:   { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' },
  memberAvatar: {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0,
  },
  memberInfo:  { flex: 1 },
  memberName:  { fontSize: 13, fontWeight: 600 },
  memberPhone: { fontSize: 11, marginTop: 1 },
  onlineBadge: { display: 'flex', alignItems: 'center', gap: 4, borderRadius: 10, padding: '2px 7px', fontSize: 10, fontWeight: 600 },
  onlineDot:   { width: 5, height: 5, borderRadius: '50%' },

  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px' },
  toggleLabel: { fontSize: 13, fontWeight: 600 },
  toggleDesc:  { fontSize: 11, marginTop: 1 },
  toggle: {
    width: 38, height: 21, borderRadius: 11,
    border: 'none', cursor: 'pointer',
    position: 'relative', flexShrink: 0,
    transition: 'background 0.2s',
  },
  toggleThumb: {
    position: 'absolute', top: 3,
    width: 15, height: 15, borderRadius: '50%',
    background: 'white', transition: 'left 0.18s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
  },

  previewLabel:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  previewShell:   { width: 110, borderRadius: 5, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.2)', marginBottom: 6 },
  previewCaption: { fontSize: 11 },

  aboutHero:    { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '18px 0 10px', gap: 4 },
  aboutLogo: {
    width: 48, height: 48, borderRadius: 12,
    background: 'linear-gradient(135deg,#1d4ed8,#4f9cf9)',
    color: 'white', fontWeight: 900, fontSize: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  aboutName:    { fontSize: 15, fontWeight: 700 },
  aboutVersion: { fontSize: 11 },
  infoBox: { margin: '10px 16px 14px', padding: '9px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.6 },
}
