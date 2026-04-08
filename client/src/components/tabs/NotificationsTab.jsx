import { useState, useEffect } from 'react'
import { getSocket } from '../../socket'

export default function NotificationsTab({ agent }) {
  const [notifications, setNotifications] = useState([
    {
      id: 1, type: 'sms', read: false,
      title: 'New message from Ranch Pet Clinic',
      body: 'Hi, just calling to check on the prescription status...',
      time: new Date(Date.now() - 5 * 60000).toISOString(),
      color: '#3b82f6',
    },
    {
      id: 2, type: 'double_text', read: false,
      title: '⚠️ Double-text warning',
      body: 'Shawn already messaged Ranch Pet Clinic 20 min ago.',
      time: new Date(Date.now() - 22 * 60000).toISOString(),
      color: '#f59e0b',
    },
    {
      id: 3, type: 'call', read: true,
      title: 'Missed call – Happy Paws',
      body: '+1 (555) 234-5678 called and left no voicemail.',
      time: new Date(Date.now() - 2 * 3600000).toISOString(),
      color: '#ef4444',
    },
    {
      id: 4, type: 'resolved', read: true,
      title: 'Conversation resolved',
      body: 'Danny marked the Sunrise Animal Hospital thread as resolved.',
      time: new Date(Date.now() - 5 * 3600000).toISOString(),
      color: '#22c55e',
    },
  ])

  // Listen for real-time new messages → add notification
  useEffect(() => {
    const socket = getSocket()
    socket.on('new_message', (msg) => {
      if (msg.direction === 'inbound') {
        setNotifications(prev => [{
          id: Date.now(),
          type: 'sms',
          read: false,
          title: `New message from ${msg.from_number || 'Customer'}`,
          body: msg.body,
          time: new Date().toISOString(),
          color: '#3b82f6',
        }, ...prev])
      }
    })
    return () => socket.off('new_message')
  }, [])

  const unread = notifications.filter(n => !n.read).length

  function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  function markRead(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  function dismiss(id) {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.title}>Notifications</div>
          {unread > 0 && <span style={S.badge}>{unread} unread</span>}
        </div>
        {unread > 0 && (
          <button style={S.markAllBtn} onClick={markAllRead}>Mark all read</button>
        )}
      </div>

      <div style={S.list}>
        {notifications.length === 0 ? (
          <div style={S.empty}>
            <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>🔔</div>
            <div>No notifications</div>
          </div>
        ) : (
          notifications.map(n => (
            <NotifRow key={n.id} notif={n} onRead={markRead} onDismiss={dismiss} />
          ))
        )}
      </div>
    </div>
  )
}

function NotifRow({ notif, onRead, onDismiss }) {
  return (
    <div
      style={{ ...S.row, ...(!notif.read ? S.rowUnread : {}) }}
      onClick={() => onRead(notif.id)}
    >
      <div style={{ ...S.pip, background: notif.color }} />
      <div style={S.rowContent}>
        <div style={S.rowTitle}>{notif.title}</div>
        <div style={S.rowBody}>{notif.body}</div>
        <div style={S.rowTime}>{timeAgo(notif.time)}</div>
      </div>
      <button
        style={S.dismissBtn}
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
  page: { flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', overflow: 'hidden' },
  header: {
    background: 'white', padding: '14px 20px 12px',
    borderBottom: '1px solid #e8edf2', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: 700, color: '#1e293b' },
  badge: {
    background: '#3b82f6', color: 'white', borderRadius: 8,
    padding: '1px 8px', fontSize: 10, fontWeight: 800,
  },
  markAllBtn: {
    background: 'none', border: 'none', color: '#3b82f6',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  list: { flex: 1, overflowY: 'auto' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, color: '#cbd5e1', fontSize: 13 },
  row: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    padding: '14px 20px', background: 'white', borderBottom: '1px solid #f1f5f9',
    cursor: 'pointer', position: 'relative',
  },
  rowUnread: { background: '#fafbff' },
  pip:     { width: 3, height: 40, borderRadius: 2, flexShrink: 0, marginTop: 2 },
  rowContent: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 3 },
  rowBody:  { fontSize: 12, color: '#64748b', lineHeight: 1.4 },
  rowTime:  { fontSize: 10, color: '#94a3b8', marginTop: 4 },
  dismissBtn: {
    background: 'none', border: 'none', color: '#cbd5e1',
    cursor: 'pointer', fontSize: 11, padding: 4, borderRadius: 4, flexShrink: 0,
  },
}
