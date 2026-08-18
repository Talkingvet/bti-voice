import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '../ThemeContext'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI
// On macOS, native traffic lights are drawn by the OS in the top-left.
// We hide our custom Windows-style window controls and reserve space for them.
const isMac = isElectron && window.electronAPI.platform === 'darwin'

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

// Maps deviceStatus → { color, tooltip }
const DEVICE_STATUS_UI = {
  idle:         { color: '#6b7280', label: 'Voice: initializing' },
  registering:  { color: '#f59e0b', label: 'Voice: connecting…' },
  registered:   { color: '#22c55e', label: 'Voice: ready' },
  unregistered: { color: '#f59e0b', label: 'Voice: reconnecting…' },
  error:        { color: '#ef4444', label: 'Voice: connection error' },
}

export default function TitleBar({ agent, unreadCount = 0, onBellClick, agentStatus = 'available', onStatusChange, deviceStatus = 'idle' }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [maximized,    setMaximized]    = useState(false)
  const [winW,         setWinW]         = useState(window.innerWidth)
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropPos,      setDropPos]      = useState({ top: 0, left: 0 })
  const btnRef     = useRef(null)
  const dropRef    = useRef(null)

  // Responsive title bar: at narrow widths drop the phone number, then the
  // name, so the identity pill never collides with the brand or the window
  // controls (the pill is absolutely centered and can't rely on flex to shrink).
  useEffect(() => {
    const onResize = () => setWinW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const showName = winW >= 400

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
    function onKey(e) { if (e.key === 'Escape') setShowDropdown(false) }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onKey)
    }
  }, [showDropdown])

  const status  = normalizeStatus(agentStatus)
  const current = STATUSES.find(s => s.value === status) || STATUSES[0]

  const barBg     = isDark ? '#1d2330' : '#ffffff'
  const borderCol = isDark ? 'rgba(255,255,255,0.07)' : '#dde3ee'
  // Light-mode overrides (dark values live in S below as the base)
  const T = isDark ? {
    brand: {}, agentBtn: {}, agentName: {}, agentNum: {},
    dropdown: {}, dropHeader: {}, dropItem: {}, bellBtn: {}, btn: {}, chevron: 'rgba(255,255,255,0.45)',
  } : {
    brand:      { color: '#1e293b' },
    agentBtn:   { background: '#eef2f8', border: '1px solid #d0d8e8', color: '#1e293b' },
    agentName:  { color: '#1e293b' },
    agentNum:   { color: 'rgba(30,41,59,0.45)' },
    dropdown:   { background: '#ffffff', border: '1px solid #dde3ee', boxShadow: '0 8px 28px rgba(30,41,59,0.18)' },
    dropHeader: { color: '#96a3b8' },
    dropItem:   { color: '#1e293b' },
    bellBtn:    { color: '#6b7c9a' },
    btn:        { color: '#6b7c9a' },
    chevron:    'rgba(30,41,59,0.4)',
  }

  return (
    <div style={{ ...S.bar, background: barBg, borderBottom: `1px solid ${borderCol}` }}>
      {/* Left side
          - Mac: invisible spacer that reserves room for the OS-drawn
                 traffic lights AND keeps the flex layout balanced so
                 the right-side controls stay right-aligned
          - Windows/Linux: BTI Voice logo + wordmark */}
      {isMac ? (
        <div style={{ width: 78, flexShrink: 0 }} aria-hidden="true" />
      ) : (
        <div style={S.left}>
          <div style={S.mark}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </div>
          <span style={{ ...S.brand, ...T.brand }}>BTI Voice</span>
        </div>
      )}

      {/* Center: agent status button */}
      {agent && (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', WebkitAppRegion: 'no-drag' }}>
          <button
            ref={btnRef}
            style={{ ...S.agentBtn, ...T.agentBtn }}
            onClick={() => setShowDropdown(v => !v)}
            title="Change status"
          >
            <StatusIcon status={current} size={12} />
            {showName && (
              <span style={{ ...S.agentName, ...T.agentName, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
            )}
            <ChevronIcon open={showDropdown} color={T.chevron} />
          </button>
        </div>
      )}

      {/* Right: voice status dot + bell + window controls */}
      <div style={S.right}>
        {/* Voice device status indicator */}
        {agent && deviceStatus !== 'registered' && deviceStatus !== 'idle' && (() => {
          const ds = DEVICE_STATUS_UI[deviceStatus] || DEVICE_STATUS_UI.idle
          return (
            <div
              title={ds.label}
              style={{
                width: 7, height: 7, borderRadius: '50%',
                background: ds.color,
                flexShrink: 0,
                // Pulse animation when connecting/reconnecting
                animation: (deviceStatus === 'registering' || deviceStatus === 'unregistered')
                  ? 'btiPulse 1.2s ease-in-out infinite' : 'none',
                marginRight: 2,
              }}
            />
          )
        })()}

        <button style={{ ...S.bellBtn, ...T.bellBtn }} onClick={onBellClick} title="Activity">
          <BellIcon />
          {unreadCount > 0 && (
            <span style={{ ...S.badge, border: `1.5px solid ${barBg}` }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {isElectron && !isMac && (
          <div style={S.controls}>
            <button style={{ ...S.btn, ...T.btn }} onClick={() => window.electronAPI.minimize()} title="Minimize">
              <MinimizeIcon />
            </button>
            <button style={{ ...S.btn, ...T.btn }} onClick={() => window.electronAPI.maximize()} title={maximized ? 'Restore' : 'Maximize'}>
              {maximized ? <RestoreIcon holeFill={barBg} /> : <MaximizeIcon />}
            </button>
            <button style={{ ...S.btn, ...T.btn, ...S.closeBtn }} onClick={() => window.electronAPI.close()} title="Minimize to tray">
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
            ...T.dropdown,
            top:  dropPos.top,
            left: dropPos.left,
            transform: 'translateX(-50%)',
          }}
        >
          <div style={{ ...S.dropHeader, ...T.dropHeader }}>Set status</div>
          {STATUSES.map(s => (
            <button
              key={s.value}
              style={{
                ...S.dropItem,
                ...T.dropItem,
                background: s.value === status ? 'rgba(79,156,249,0.12)' : 'transparent',
                fontWeight: s.value === status ? 700 : 400,
              }}
              onClick={() => { onStatusChange?.(s.value); setShowDropdown(false) }}
            >
              <StatusIcon status={s} size={13} />
              <span style={{ color: 'inherit', fontSize: 12 }}>{s.label}</span>
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

function ChevronIcon({ open, color = 'rgba(255,255,255,0.45)' }) {
  return (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"
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
function RestoreIcon({ holeFill = '#1d2330' }) {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" /><rect x="0" y="2" width="8" height="8" fill={holeFill} stroke="currentColor" strokeWidth="1" /></svg>
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
