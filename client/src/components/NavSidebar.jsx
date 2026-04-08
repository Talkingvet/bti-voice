/* Left icon navigation — 64 px wide */
import { useTheme } from '../ThemeContext'

const TABS = [
  { id: 'dialpad',       label: 'Dialpad',       Icon: DialpadIcon      },
  { id: 'sms',           label: 'Messages',      Icon: ChatIcon         },
  { id: 'contacts',      label: 'Contacts',      Icon: ContactsIcon     },
  { id: 'calls',         label: 'Recent Calls',  Icon: CallHistoryIcon  },
  { id: 'voicemails',    label: 'Voicemail',     Icon: VoicemailIcon    },
  { id: 'notifications', label: 'Alerts',        Icon: BellIcon         },
]

export default function NavSidebar({ activeTab, onChange, agent }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const sideBg     = isDark ? '#0d1526'                    : '#1e293b'
  const borderCol  = isDark ? 'rgba(255,255,255,0.06)'     : 'rgba(255,255,255,0.08)'
  const iconInact  = isDark ? 'rgba(255,255,255,0.35)'     : 'rgba(255,255,255,0.45)'
  const labelInact = isDark ? 'rgba(255,255,255,0.25)'     : 'rgba(255,255,255,0.35)'
  const activeBg   = 'rgba(59,130,246,0.15)'
  const onlineBorder = isDark ? sideBg : '#1e293b'

  return (
    <div style={{ ...S.sidebar, background: sideBg, borderRight: `1px solid ${borderCol}` }}>
      {/* Top nav items */}
      <div style={S.navList}>
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              style={{ ...S.navBtn, ...(active ? { background: activeBg } : {}) }}
              onClick={() => onChange(id)}
              title={label}
            >
              {active && <div style={S.activePip} />}
              <div style={{ ...S.iconWrap, color: active ? '#3b82f6' : iconInact }}>
                <Icon size={20} />
              </div>
              <span style={{ ...S.navLabel, color: active ? '#3b82f6' : labelInact }}>
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Bottom: settings + agent avatar */}
      <div style={S.bottom}>
        <button
          style={{ ...S.navBtn, ...(activeTab === 'settings' ? { background: activeBg } : {}) }}
          onClick={() => onChange('settings')}
          title="Settings"
        >
          {activeTab === 'settings' && <div style={S.activePip} />}
          <div style={{ ...S.iconWrap, color: activeTab === 'settings' ? '#3b82f6' : iconInact }}>
            <SettingsIcon size={20} />
          </div>
          <span style={{ ...S.navLabel, color: activeTab === 'settings' ? '#3b82f6' : labelInact }}>
            Settings
          </span>
        </button>

        {agent && (
          <div
            style={S.avatarWrap}
            title={`${agent.name}${agent.phone_number !== 'TBD' ? ' · ' + agent.phone_number : ''}`}
          >
            <div style={{ ...S.avatar, background: agent.color || '#3b82f6' }}>
              {agent.initials || agent.name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ ...S.onlineDot, border: `1.5px solid ${onlineBorder}` }} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ── SVG Icon Components ─────────────────────────────────────────── */
function DialpadIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="5"  cy="5"  r="1.5" fill="currentColor" />
      <circle cx="12" cy="5"  r="1.5" fill="currentColor" />
      <circle cx="19" cy="5"  r="1.5" fill="currentColor" />
      <circle cx="5"  cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
      <circle cx="5"  cy="19" r="1.5" fill="currentColor" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" />
      <circle cx="19" cy="19" r="1.5" fill="currentColor" />
    </svg>
  )
}
function ChatIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function ContactsIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
function CallHistoryIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}
function VoicemailIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5"  cy="11.5" r="4.5" />
      <circle cx="18.5" cy="11.5" r="4.5" />
      <line x1="5.5" y1="16" x2="18.5" y2="16" />
    </svg>
  )
}
function BellIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
function SettingsIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/* ── Styles ──────────────────────────────────────────────────────── */
const S = {
  sidebar: {
    width: 68,
    display: 'flex', flexDirection: 'column',
    flexShrink: 0, userSelect: 'none',
  },
  navList: { flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 8 },
  navBtn: {
    position: 'relative',
    width: '100%', padding: '10px 0 8px',
    border: 'none', background: 'transparent',
    cursor: 'pointer', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 4,
    transition: 'background 0.12s',
    borderRadius: 0,
  },
  activePip: {
    position: 'absolute', left: 0, top: '50%',
    transform: 'translateY(-50%)',
    width: 3, height: 24, background: '#3b82f6',
    borderRadius: '0 2px 2px 0',
  },
  iconWrap: {
    transition: 'color 0.12s',
    display: 'flex',
  },
  navLabel: {
    fontSize: 9, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.3px',
    lineHeight: 1, transition: 'color 0.12s',
  },

  bottom: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    paddingBottom: 10, gap: 6,
  },
  avatarWrap: {
    position: 'relative', marginTop: 4,
    cursor: 'default',
  },
  avatar: {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 800, color: 'white',
    border: '2px solid rgba(255,255,255,0.12)',
  },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 8, height: 8, borderRadius: '50%',
    background: '#22c55e',
  },
}
