// Small shared bits: icons, avatar, helpers.

export const BRAND = import.meta.env.VITE_BRAND_NAME || 'BTI Huddle'
export const BASE_PATH = '/huddle'

const AVATAR_COLORS = ['#4f9cf9', '#7c5cff', '#2bb3a3', '#e07a3f', '#d64a8a', '#5aa83c', '#c9a227']
export function colorFor(agent) {
  if (agent?.color) return agent.color
  const s = String(agent?.username || agent?.name || '?')
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
export function initials(agent) {
  if (agent?.initials) return agent.initials
  const n = String(agent?.name || agent?.username || '?').trim().split(/\s+/)
  return (n[0]?.[0] || '') + (n[1]?.[0] || '')
}
export function Avatar({ agent, status, className = '' }) {
  return (
    <div className={`avatar ${className}`} style={{ background: colorFor(agent) }} title={agent?.name}>
      {initials(agent).toUpperCase()}
      {status !== undefined && <span className={`dot ${status || ''}`} />}
    </div>
  )
}
export const STATUS_LABEL = {
  available: 'Available', online: 'Available', busy: 'Busy', dnd: 'Do not disturb',
  be_right_back: 'Be right back', away: 'Away', offline: 'Offline',
}

const I = (d, extra = {}) => (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...extra} {...props}>{d}</svg>
)
export const Icon = {
  People:  I(<><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.8"/><path d="M15.5 14.2a5 5 0 0 1 6 4.8"/></>),
  Video:   I(<><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>),
  VideoOff:I(<><path d="M3 6h9.5a2 2 0 0 1 2 2v1.5M14.5 14.5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="m16 10 5-3v10l-5-3"/><path d="m2 2 20 20"/></>),
  Mic:     I(<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>),
  MicOff:  I(<><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-6 0v1"/><path d="M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3"/><path d="m2 2 20 20"/></>),
  Screen:  I(<><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></>),
  Phone:   I(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>),
  Hang:    I(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>, { style: { transform: 'rotate(135deg)' } }),
  Link:    I(<><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>),
  Plus:    I(<path d="M12 5v14M5 12h14"/>),
  Logout:  I(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>),
  Copy:    I(<><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>),
}

export function copyText(text) {
  try { return navigator.clipboard.writeText(text) } catch { return Promise.resolve() }
}
export function absoluteUrl(path) {
  const origin = import.meta.env.VITE_API_URL || window.location.origin
  return origin + path
}
export function navigate(path) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
