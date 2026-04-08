import { useState, useEffect } from 'react'
import { useTheme } from '../ThemeContext'

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

export default function TitleBar({ agent, unreadCount = 0, onBellClick }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (isElectron) {
      window.electronAPI.onWindowState(({ maximized: m }) => setMaximized(m))
    }
  }, [])

  const barBg     = isDark ? '#1d2330' : '#1a2035'
  const borderCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.10)'

  return (
    <div style={{ ...S.bar, background: barBg, borderBottom: `1px solid ${borderCol}` }}>
      {/* Left: logo + name */}
      <div style={S.left}>
        <div style={S.mark}>B</div>
        <span style={S.brand}>BTI Voice</span>
      </div>

      {/* Center: agent badge */}
      {agent && (
        <div style={S.agentBadge}>
          <div style={{ ...S.dot, background: agent.color || '#4f9cf9' }} />
          <span style={S.agentName}>{agent.name}</span>
          {agent.phone_number && agent.phone_number !== 'TBD' && (
            <span style={S.agentNum}>{agent.phone_number}</span>
          )}
          <div style={S.onlinePip} title="Online" />
        </div>
      )}

      {/* Right: bell + window controls */}
      <div style={S.right}>
        {/* Bell icon */}
        <button
          style={S.bellBtn}
          onClick={onBellClick}
          title="Activity"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span style={S.badge}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Electron window controls */}
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
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────── */
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
  left: { display: 'flex', alignItems: 'center', gap: 7 },
  mark: {
    width: 20, height: 20, borderRadius: 5,
    background: 'linear-gradient(135deg,#2563eb,#4f9cf9)',
    color: 'white', fontWeight: 900, fontSize: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  brand: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.5px' },

  agentBadge: {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
    display: 'flex', alignItems: 'center', gap: 5,
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 20, padding: '2px 10px',
    WebkitAppRegion: 'no-drag',
  },
  dot:       { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  agentName: { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600 },
  agentNum:  { fontSize: 10, color: 'rgba(255,255,255,0.40)', marginLeft: 2 },
  onlinePip: { width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 },

  right: { display: 'flex', alignItems: 'center', gap: 2, WebkitAppRegion: 'no-drag' },

  bellBtn: {
    position: 'relative',
    width: 30, height: 28, border: 'none',
    background: 'transparent', color: 'rgba(255,255,255,0.60)',
    cursor: 'pointer', borderRadius: 5,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'color 0.15s, background 0.15s',
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
