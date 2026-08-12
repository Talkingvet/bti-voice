import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api'
import { getSocket } from '../../socket'
import { useColors } from '../../useColors'

export default function NotificationsTab({ agent }) {
  const C = useColors()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await api.notifications()
      setNotifications(data)
    } catch (e) {
      console.error('[NotificationsTab] load error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const socket = getSocket()
    // Real-time: new notification pushed from server
    const onNotif = (notif) => setNotifications(prev => [notif, ...prev])
    socket.on('notification', onNotif)
    return () => socket.off('notification', onNotif)
  }, [load])

  // Auto-mark all as read when the tab is opened
  useEffect(() => {
    api.markAllNotifsRead()
      .then(() => setNotifications(prev => prev.map(n => ({ ...n, read: true }))))
      .catch(() => {})
  }, [])

  const unread = notifications.filter(n => !n.read).length

  async function markRead(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    try { await api.markNotifRead(id) } catch (_) {}
  }

  async function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    try { await api.markAllNotifsRead() } catch (_) {}
  }

  async function dismiss(id) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    try { await api.dismissNotif(id) } catch (_) {}
  }

  async function clearRead() {
    setNotifications(prev => prev.filter(n => !n.read))
    try { await api.clearReadNotifs() } catch (_) {}
  }

  return (
    <div style={{ ...S.page, background: C.bg }}>
      <div style={{ ...S.header, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <div style={S.headerLeft}>
          <div style={{ ...S.title, color: C.text }}>Notifications</div>
          {unread > 0 && <span style={S.badge}>{unread} unread</span>}
        </div>
        <div style={S.headerActions}>
          {unread > 0 && (
            <button style={{ ...S.actionBtn, color: C.textSec }} onClick={markAllRead}>
              Mark all read
            </button>
          )}
          {notifications.some(n => n.read) && (
            <button style={{ ...S.actionBtn, color: C.textMuted }} onClick={clearRead}>
              Clear read
            </button>
          )}
        </div>
      </div>

      <div style={S.list}>
        {loading ? (
          <div style={{ ...S.empty, color: C.textMuted }}>Loading…</div>
        ) : notifications.length === 0 ? (
          <div style={{ ...S.empty, color: C.textMuted }}>
            <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>🔔</div>
            <div>No notifications</div>
          </div>
        ) : (
          notifications.map(n => (
            <NotifRow key={n.id} notif={n} onRead={markRead} onDismiss={dismiss} C={C} />
          ))
        )}
      </div>
    </div>
  )
}

function NotifRow({ notif, onRead, onDismiss, C }) {
  return (
    <div
      style={{
        ...S.row,
        background: notif.read ? C.panel : C.hover,
        borderBottom: `1px solid ${C.borderItem}`,
      }}
      onClick={() => !notif.read && onRead(notif.id)}
    >
      <div style={{ ...S.pip, background: notif.color }} />
      <div style={S.rowContent}>
        <div style={{ ...S.rowTitle, color: C.text, fontWeight: notif.read ? 500 : 700 }}>
          {notif.title}
        </div>
        {notif.body && <div style={{ ...S.rowBody, color: C.textSec }}>{notif.body}</div>}
        <div style={{ ...S.rowTime, color: C.textMuted }}>{timeAgo(notif.created_at)}</div>
      </div>
      <button
        style={{ ...S.dismissBtn, color: C.textMuted }}
        onClick={e => { e.stopPropagation(); onDismiss(notif.id) }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}

function timeAgo(d) {
  const diff = Date.now() - new Date(d)
  const m = Math.floor(diff / 60000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const S = {
  page:        { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:      { padding: '14px 20px 12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft:  { display: 'flex', alignItems: 'center', gap: 8 },
  headerActions: { display: 'flex', gap: 12, alignItems: 'center' },
  title:       { fontSize: 15, fontWeight: 700 },
  badge:       { background: '#3b82f6', color: 'white', borderRadius: 8, padding: '1px 8px', fontSize: 10, fontWeight: 800 },
  actionBtn:   { background: 'none', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  list:        { flex: 1, overflowY: 'auto' },
  empty:       { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, fontSize: 13 },
  row:         { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 20px', cursor: 'pointer' },
  pip:         { width: 3, height: 40, borderRadius: 2, flexShrink: 0, marginTop: 2 },
  rowContent:  { flex: 1, minWidth: 0 },
  rowTitle:    { fontSize: 13, marginBottom: 3 },
  rowBody:     { fontSize: 12, lineHeight: 1.4 },
  rowTime:     { fontSize: 10, marginTop: 4 },
  dismissBtn:  { background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 4, borderRadius: 4, flexShrink: 0 },
}
