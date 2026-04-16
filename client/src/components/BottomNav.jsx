/* Bottom navigation bar — Contacts | Messages | Calls | Dialpad | Notifications | Settings */
import { useColors } from '../useColors'

const TABS = [
  { id: 'contacts',      label: 'Contacts', Icon: ContactsIcon },
  { id: 'sms',           label: 'Messages', Icon: ChatIcon     },
  { id: 'calls',         label: 'Calls',    Icon: CallHistIcon },
  { id: 'dialpad',       label: 'Dialpad',  Icon: DialpadIcon  },
  { id: 'notifications', label: 'Alerts',   Icon: BellIcon     },
  { id: 'settings',      label: 'Settings', Icon: SettingsIcon },
]

export default function BottomNav({ activeTab, onChange, notifCount = 0, smsCount = 0, vmCount = 0 }) {
  const C = useColors()

  return (
    <div style={{ ...S.bar, background: C.navBg, borderTop: `1px solid ${C.navBorder}` }}>
      {TABS.map(({ id, label, Icon }) => {
        const active = activeTab === id
        const badge  = id === 'notifications' ? notifCount
                     : id === 'sms'           ? smsCount
                     : id === 'calls'         ? vmCount
                     : 0
        return (
          <button
            key={id}
            style={{ ...S.btn, background: active ? 'rgba(79,156,249,0.10)' : 'transparent' }}
            onClick={() => onChange(id)}
            title={label}
          >
            {active && <div style={S.pip} />}
            <div style={{ ...S.icon, color: active ? '#4f9cf9' : C.navIcon, position: 'relative' }}>
              <Icon size={active ? 22 : 20} />
              {badge > 0 && (
                <span style={S.badge}>{badge > 9 ? '9+' : badge}</span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ── Icons ───────────────────────────────────────────────────────── */
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
function ChatIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function CallHistIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.58 1.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}
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
  bar: {
    display: 'flex', flexDirection: 'row',
    height: 54, flexShrink: 0,
    userSelect: 'none',
  },
  btn: {
    flex: 1, position: 'relative',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    border: 'none', cursor: 'pointer',
    padding: '0',
    transition: 'background 0.12s',
  },
  pip: {
    position: 'absolute', top: 0, left: '50%',
    transform: 'translateX(-50%)',
    width: 20, height: 2.5,
    background: '#4f9cf9', borderRadius: '0 0 3px 3px',
  },
  badge: {
    position: 'absolute', top: -5, right: -7,
    background: '#ef4444', color: 'white',
    borderRadius: 8, fontSize: 8, fontWeight: 800,
    padding: '1px 4px', lineHeight: 1.4,
    pointerEvents: 'none',
  },
  icon: { display: 'flex', transition: 'color 0.12s, transform 0.12s' },
}
