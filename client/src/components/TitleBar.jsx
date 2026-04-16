import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../ThemeContext'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// MS Teams-style statuses
const STATUSES = [
  { value: 'available',     label: 'Available',     color: '#22c55e', icon: 'circle' },
  { value: 'busy',          label: 'Busy',           color: '#ef4444', icon: 'circle' },
  { value: 'dnd',           label: 'Do Not Disturb', color: '#ef4444', icon: 'dnd'    },
  { value: 'be_right_back', label: 'Be Right Back',  color: '#f59e0b', icon: 'circle' },
  { value: 'offline',       label: 'Offline',        color: '#6b7280', icon: 'offline'},
]

// Map legacy values → new values
function normalizeStatus(s) {
  if (s === 'online') return 'available'
  if (s === 'away')   return 'be_right_back'
  return STATUSES.find(x => x.value === s) ? s : 'available'
}

export default function TitleBar({ agent, unreadCount = 0, onBellClick, agentStatus = 'available', onStatusChange }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [maximized,    setMaximized]    = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropPos,      setDropPos]      = useState({ top: 0, left: 0 })
  const btnRef     = useRef(null)
  const dropRef    = useRef(null)

  useEffect(() => {
    if (isElectron) {
      window.electronAPI.onWindowState(({ maximized: m }) => setMaximized(m))
    }
  }, [])

  // When dropdown opens, measure button position so the portal can align to it
  useEffect(() => {
    if (showDropdown && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({
        top:  r.bottom + 6,
        left: r.left + r.width / 2,
      })
    }
  }, [showDropdown])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return
    function handle(e) {
      if (
        dropRef.current  && !dropRef.current.contains(e.target) &&
        btnRef.current   && !btnRef.current.contains(e.target)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showDropdown])

  const status  = normalizeStatus(agentStatus)
  const current = STATUSES.find(s => s.value === status) || STATUSES[0]

  const barBg     = isDark ? '#1d2330' : '#1a2035'
  const borderCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.10)'

  return (
    <div style={{ ...S.bar, background: barBg, borderBottom: `1px solid ${borderCol}` }}>
      {/* Left: logo + name */}
      <div style={S.left}>
        <div style={S.mark}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </div>
        <span style={S.brand}>BTI Voice</span>
      </div>

      {/* Center: agent status button */}
      {agent && (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', WebkitAppRegion: 'no-drag' }}>
          <button
            ref={btnRef}
            style={S.agentBtn}
            onClick={() => setShowDropdown(v => !v)}
            title="Change status"
          >
            <div style={{ ...S.dot, background: agent.color || '#4f9cf9' }} />
            <span style={S.agentName}>{agent.name}</span>
            {agent.phone_number && agent.phone_number !== 'TBD' && (
              <span style={S.agentNum}>{agent.phone_number}</span>
            )}
            <StatusIcon status={current} size={11} />
            <ChevronIcon open={showDropdown} />
          </button>
        </div>
      )}

      {/* Right: bell + window controls */}
      <div style={S.right}>
        <button style={S.bellBtn} onClick={onBellClick} title="Activity">
          <BellIcon />
          {unreadCount > 0 && (
            <span style={S.badge}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {isElectron && (
          <div style={S.controls}>
            <button style={S.btn} onClick={() => window.electronAPI.minimize()} title="Minimize">
              <MinimizeIcon />
            </button>
            <button style={S.btn} onClick={() => window.electronAPI.maximize()} title={maximized ? 'Restore' : 'Maximize'}>
              {maximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button style={{ ...S.btn, ...S.closeBtn }} onClick={() => window.electronAPI.close()} title="Minimize to tray">
              <CloseIcon />
            </button>
          </div>
        )}
      </div>

      {/* Dropdown — rendered via portal to escape overflow:hidden on the root container */}
      {showDropdown && createPortal(
        <div
          ref={dropRef}
          style={{
            ...S.dropdown,
            top:  dropPos.top,
            left: dropPos.left,
            transform: 'translateX(-50%)',
          }}
        >
          <div style={S.dropHeader}>Set status</div>
          {STATUSES.map(s => (
            <button
              key={s.value}
              style={{
                ...S.dropItem,
                background: s.value === status ? 'rgba(79,156,249,0.12)' : 'transparent',
                fontWeight: s.value === status ? 700 : 400,
              }}
              onClick={() => { onStatusChange?.(s.value); setShowDropdown(false) }}
            >
              <StatusIcon status={s} size={13} />
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{s.label}</span>
              {s.value === status && <span style={{ marginLeft: 'auto', color: '#4f9cf9', fontSize: 10 }}>✓</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

/* ── Status icon (Teams-style) ───────────────────────────────────── */
function StatusIcon({ status, size = 11 }) {
  const r = size / 2
  if (status.icon === 'dnd') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={r} cy={r} r={r} fill={status.color} />
        <rect x={2} y={r - 1.2} width={size - 4} height={2.4} rx={1.2} fill="white" />
      </svg>
    )
  }
  if (status.icon === 'offline') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={r} cy={r} r={r - 1} fill="none" stroke={status.color} strokeWidth={2} />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={r} cy={r} r={r} fill={status.color} />
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/* ── Other icons ─────────────────────────────────────────────────── */
function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
function MinimizeIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
}
function MaximizeIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
}
function RestoreIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" /><rect x="0" y="2" width="8" height="8" fill="#1d2330" stroke="currentColor" strokeWidth="1" /></svg>
}
function CloseIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" /></svg>
}

/* ── Styles ─────────────────────────────────────────────────────── */
const S = {
  bar: {
    height: 38,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 4px 0 10px', flexShrink: 0,
    WebkitAppRegion: 'drag',
    userSelect: 'none',
    position: 'relative',
  },
  left:  { display: 'flex', alignItems: 'center', gap: 7 },
  mark: {
    width: 20, height: 20, borderRadius: 5,
    background: 'linear-gradient(135deg,#2563eb,#4f9cf9)',
    color: 'white', fontWeight: 900, fontSize: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  brand: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.5px' },

  agentBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 20, padding: '3px 10px 3px 8px',
    cursor: 'pointer', color: 'white',
    transition: 'background 0.15s',
  },
  dot:       { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  agentName: { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600 },
  agentNum:  { fontSize: 10, color: 'rgba(255,255,255,0.40)', marginLeft: 2 },

  dropdown: {
    position: 'fixed',
    background: '#1d2330', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, padding: '4px 0', minWidth: 180,
    boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
    zIndex: 99999,
  },
  dropHeader: {
    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    padding: '4px 12px 6px',
  },
  dropItem: {
    display: 'flex', alignItems: 'center', gap: 9,
    width: '100%', padding: '7px 12px',
    border: 'none', cursor: 'pointer',
    borderRadius: 0, transition: 'background 0.1s',
    color: 'rgba(255,255,255,0.85)',
  },

  right: { display: 'flex', alignItems: 'center', gap: 2, WebkitAppRegion: 'no-drag' },
  bellBtn: {
    position: 'relative',
    width: 30, height: 28, border: 'none',
    background: 'transparent', color: 'rgba(255,255,255,0.60)',
    cursor: 'pointer', borderRadius: 5,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute', top: 2, right: 2,
    background: '#ef4444', color: 'white',
    borderRadius: 8, padding: '0 3px',
    fontSize: 8, fontWeight: 800, lineHeight: '12px',
    minWidth: 12, textAlign: 'center',
    border: '1.5px solid #1d2330',
  },
  controls: { display: 'flex', gap: 1 },
  btn: {
    width: 30, height: 28, border: 'none',
    background: 'transparent', color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer', borderRadius: 4,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  closeBtn: {},
}
