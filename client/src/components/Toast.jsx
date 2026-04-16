/**
 * Lightweight in-app toast system.
 * Usage:
 *   const { toast } = useToast()
 *   toast.success('Saved!')
 *   toast.error('Something went wrong')
 *   toast.info('Copied to clipboard')
 */
import { createContext, useContext, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const toast = {
    success: (msg, dur) => addToast(msg, 'success', dur),
    error:   (msg, dur) => addToast(msg, 'error',   dur || 5000),
    info:    (msg, dur) => addToast(msg, 'info',    dur),
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(<ToastList toasts={toasts} />, document.body)}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

// ── Rendering ──────────────────────────────────────────────────────────────────
const ICONS = {
  success: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  info: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
}

const COLORS = {
  success: { bg: '#166534', border: '#15803d', icon: '#4ade80' },
  error:   { bg: '#7f1d1d', border: '#991b1b', icon: '#f87171' },
  info:    { bg: '#1e3a5f', border: '#1d4ed8', icon: '#60a5fa' },
}

function ToastList({ toasts }) {
  if (toasts.length === 0) return null
  return (
    <div style={S.container}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}

function ToastItem({ toast }) {
  const c = COLORS[toast.type] || COLORS.info
  return (
    <div style={{ ...S.toast, background: c.bg, border: `1px solid ${c.border}` }}>
      <span style={{ color: c.icon, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {ICONS[toast.type]}
      </span>
      <span style={S.msg}>{toast.message}</span>
    </div>
  )
}

const S = {
  container: {
    position: 'fixed',
    top: 48,            // below TitleBar
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    pointerEvents: 'none',
    width: 320,
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderRadius: 10,
    color: 'white',
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.4,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    animation: 'toastIn 0.18s ease',
    pointerEvents: 'auto',
  },
  msg: { flex: 1 },
}
