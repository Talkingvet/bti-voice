/* Activity / Notifications panel — drops down from the bell icon */
import { useEffect, useRef } from 'react'
import { useColors } from '../useColors'

function fmtTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  if (diff < 60000)    return 'just now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(now - 86400000)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtDuration(secs) {
  if (!secs) return null
  const m = Math.floor(secs / 60), s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// Key used to track individual read status
function itemKey(item) {
  return `${item.type}-${item.id}`
}

export default function NotificationsPanel({ activity, readKeys, baseAt, onMarkRead, onMarkAllRead, onNavigate, onClose }) {
  const C   = useColors()
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const unreadCount = activity.filter(a =>
    new Date(a.occurred_at) > baseAt && !readKeys.has(itemKey(a))
  ).length

  function handleItemClick(item) {
    // Mark this item as individually read
    onMarkRead(itemKey(item))

    // Navigate based on type
    if (item.type === 'message' && item.conversation_id) {
      onNavigate({ tab: 'sms', convId: item.conversation_id })
    } else if (item.type === 'missed_call' && item.conversation_id) {
      onNavigate({ tab: 'sms', convId: item.conversation_id })
    } else {
      onNavigate({ tab: 'calls' })
    }
    onClose()
  }

  return (
    <div
      ref={ref}
      style={{ ...S.panel, background: C.panel, border: `1px solid ${C.border}`, boxShadow: '0 8px 32px rgba(0,0,0,0.45)' }}
    >
      {/* Header */}
      <div style={{ ...S.header, borderBottom: `1px solid ${C.border}` }}>
        <span style={{ ...S.title, color: C.text }}>
          Activity
          {unreadCount > 0 && (
            <span style={S.badge}>{unreadCount}</span>
          )}
        </span>
        <div style={S.headerRight}>
          {unreadCount > 0 && (
            <button
              style={{ ...S.markAllBtn, color: '#4f9cf9' }}
              onClick={onMarkAllRead}
            >
              Mark all read
            </button>
          )}
          <button style={{ ...S.closeBtn, color: C.textMuted }} onClick={onClose}>×</button>
        </div>
      </div>

      {/* List */}
      <div style={S.list}>
        {activity.length === 0 ? (
          <div style={{ ...S.empty, color: C.textMuted }}>
            <div style={S.emptyIcon}>🎉</div>
            All caught up!
          </div>
        ) : (
          activity.map((item, i) => {
            const isNew = new Date(item.occurred_at) > baseAt && !readKeys.has(itemKey(item))
            return (
              <ActivityItem
                key={`${item.type}-${item.id}-${i}`}
                item={item}
                isNew={isNew}
                C={C}
                onClick={() => handleItemClick(item)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

function ActivityItem({ item, isNew, C, onClick }) {
  const name    = item.contact_name || item.contact_number || 'Unknown'
  const timeStr = fmtTime(item.occurred_at)

  let icon, iconBg, label, sublabel

  if (item.type === 'message') {
    icon    = <MsgIcon />
    iconBg  = 'rgba(79,156,249,0.18)'
    label   = name
    sublabel = item.preview ? truncate(item.preview, 48) : 'Inbound message'
  } else if (item.type === 'missed_call') {
    icon    = <MissedCallIcon />
    iconBg  = 'rgba(239,68,68,0.18)'
    label   = name
    sublabel = 'Missed call'
  } else {
    icon    = <CallIcon dir={item.call_direction} />
    iconBg  = 'rgba(34,197,94,0.18)'
    label   = name
    const dur = fmtDuration(item.duration)
    sublabel = item.call_direction === 'inbound'
      ? `Incoming call${dur ? ` · ${dur}` : ''}`
      : `Outgoing call${dur ? ` · ${dur}` : ''}`
  }

  // Calls without a conversation still navigate to the calls tab
  const isClickable = true

  return (
    <div
      onClick={onClick}
      style={{
        ...S.item,
        borderBottom: `1px solid ${C.borderItem}`,
        background: isNew
          ? (C.hover || 'rgba(79,156,249,0.05)')
          : 'transparent',
        opacity: isNew ? 1 : 0.55,
        cursor: isClickable ? 'pointer' : 'default',
        borderLeft: isNew ? '3px solid rgba(79,156,249,0.5)' : '3px solid transparent',
      }}
    >
      {/* Icon circle */}
      <div style={{ ...S.iconCircle, background: iconBg }}>
        {icon}
      </div>

      {/* Text */}
      <div style={S.itemBody}>
        <div style={S.itemTop}>
          <span style={{ ...S.itemName, color: C.text, fontWeight: isNew ? 700 : 500 }}>{label}</span>
          <span style={{ ...S.itemTime, color: C.textMuted }}>{timeStr}</span>
        </div>
        <div style={{ ...S.itemSub, color: isNew ? C.textSec : C.textMuted }}>
          {item.agent_name && item.type !== 'message' && (
            <span style={{ color: item.agent_color || C.textSec, marginRight: 4 }}>
              {item.agent_name} ·{' '}
            </span>
          )}
          {sublabel}
        </div>
      </div>

      {/* Unread dot */}
      {isNew && <div style={S.unreadDot} />}
    </div>
  )
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s }

/* ── Icons ──────────────────────────────────────────────────────── */
function MsgIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4f9cf9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function MissedCallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.26 9.91" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
function CallIcon({ dir }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.58 1.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

/* ── Styles ─────────────────────────────────────────────────────── */
const S = {
  panel: {
    position: 'absolute',
    top: 38,
    right: 0,
    width: 320,
    maxHeight: 460,
    display: 'flex', flexDirection: 'column',
    borderRadius: '0 0 10px 10px',
    zIndex: 1000,
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', flexShrink: 0,
  },
  headerRight: { display: 'flex', alignItems: 'center', gap: 6 },
  title:    { fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 },
  badge:    { background: '#4f9cf9', color: 'white', borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 800 },
  markAllBtn: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '3px 6px' },
  closeBtn: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' },
  list:     { flex: 1, overflowY: 'auto' },
  empty:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px 0', fontSize: 13, gap: 8 },
  emptyIcon:{ fontSize: 28 },

  item: {
    display: 'flex', alignItems: 'flex-start',
    padding: '10px 14px 10px 11px', gap: 10,
    transition: 'opacity 0.2s, background 0.15s',
  },
  iconCircle: {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginTop: 1,
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemTop:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 },
  itemName: { fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  itemTime: { fontSize: 10, flexShrink: 0, marginLeft: 6 },
  itemSub:  { fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unreadDot:{ width: 7, height: 7, borderRadius: '50%', background: '#4f9cf9', flexShrink: 0, marginTop: 6 },
}
