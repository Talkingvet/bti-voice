import { useState } from 'react'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr)
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function hasDoubleTextRisk(conv) {
  return parseInt(conv.recent_outbound_count) >= 2
}

export default function Sidebar({ conversations, calls, selectedId, sideTab, onSelectConv, onTabChange, currentAgent }) {
  const [search, setSearch] = useState('')

  const filtered = conversations.filter(c =>
    (c.contact_name || c.contact_number || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={styles.sidebar}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.title}>All Conversations</div>
        <div style={styles.searchBox}>
          <span style={{ color: '#aaa', fontSize: 13 }}>🔍</span>
          <input
            style={styles.searchInput}
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(sideTab === 'sms' ? styles.tabActive : {}) }}
          onClick={() => onTabChange('sms')}
        >💬 SMS</button>
        <button
          style={{ ...styles.tab, ...(sideTab === 'calls' ? styles.tabActive : {}) }}
          onClick={() => onTabChange('calls')}
        >📞 Calls</button>
      </div>

      {/* Lists */}
      <div style={styles.list}>
        {sideTab === 'sms' ? (
          filtered.length === 0
            ? <div style={styles.empty}>No conversations</div>
            : filtered.map(conv => (
              <ConvItem
                key={conv.id}
                conv={conv}
                isActive={conv.id === selectedId}
                onClick={() => onSelectConv(conv.id)}
              />
            ))
        ) : (
          calls.length === 0
            ? <div style={styles.empty}>No calls yet</div>
            : calls.map(call => <CallItem key={call.id} call={call} />)
        )}
      </div>
    </div>
  )
}

function ConvItem({ conv, isActive, onClick }) {
  const agents = conv.agents_involved || []
  const risk   = hasDoubleTextRisk(conv)

  return (
    <div
      style={{
        ...styles.convItem,
        ...(isActive ? styles.convItemActive : {}),
      }}
      onClick={onClick}
    >
      <div style={{ ...styles.avatar, background: stringToColor(conv.contact_name || conv.contact_number) }}>
        {initials(conv.contact_name || conv.contact_number)}
      </div>
      <div style={styles.convInfo}>
        <div style={styles.convName}>{conv.contact_name || conv.contact_number}</div>
        <div style={styles.convPreview}>
          {conv.last_agent_name
            ? <span style={{ color: conv.last_agent_color, fontWeight: 600 }}>{conv.last_agent_name.split(' ')[0]}:</span>
            : <span style={{ color: '#888' }}>Customer:</span>
          }
          {' '}{conv.last_message ? truncate(conv.last_message, 35) : '—'}
        </div>
        <div style={styles.agentPills}>
          {agents.map(a => (
            <span key={a.id} style={{ ...styles.pill, background: a.color }}>{a.initials}</span>
          ))}
        </div>
      </div>
      <div style={styles.convMeta}>
        <div style={styles.convTime}>{timeAgo(conv.last_message_at)}</div>
        {risk && <div style={styles.warnBadge}>⚠️ Check</div>}
      </div>
    </div>
  )
}

function CallItem({ call }) {
  const icons = { outbound: '📞', inbound: '📲', missed: '📵' }
  const icon  = call.status === 'missed' ? '📵' : icons[call.direction] || '📞'
  return (
    <div style={styles.callItem}>
      <div style={styles.callIcon}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{call.contact_name || call.contact_number}</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
          {call.direction === 'outbound' ? 'Outgoing' : call.status === 'missed' ? 'Missed' : 'Incoming'}
          {' · '}
          <span style={{ color: call.agent_color, fontWeight: 600 }}>{call.agent_name}</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 11, color: '#aaa' }}>
        <div>{timeAgo(call.started_at)}</div>
        {call.duration
          ? <div style={{ fontWeight: 600, color: '#555', marginTop: 2 }}>{formatDuration(call.duration)}</div>
          : <div style={{ color: '#ef4444', marginTop: 2 }}>Missed</div>
        }
      </div>
    </div>
  )
}

// Utilities
function truncate(str, n) { return str && str.length > n ? str.slice(0, n) + '…' : str }
function initials(str) {
  if (!str) return '?'
  const parts = str.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : str.slice(0, 2).toUpperCase()
}
function stringToColor(str) {
  if (!str) return '#64748b'
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const colors = ['#f97316','#0ea5e9','#ec4899','#14b8a6','#d97706','#6366f1','#84cc16']
  return colors[Math.abs(hash) % colors.length]
}
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

const styles = {
  sidebar: {
    width: 300, background: 'white',
    borderRight: '1px solid #e8eaed',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
  },
  header: { padding: '14px 16px 10px', borderBottom: '1px solid #f0f2f5' },
  title: { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 },
  searchBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#f5f7fa', borderRadius: 8, padding: '7px 12px',
  },
  searchInput: { border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%' },
  tabs: { display: 'flex', padding: '10px 16px 0', gap: 4 },
  tab: { padding: '6px 12px', borderRadius: 6, border: 'none', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#888' },
  tabActive: { background: '#eef3ff', color: '#3b82f6' },
  list: { flex: 1, overflowY: 'auto' },
  empty: { padding: 24, textAlign: 'center', color: '#bbb', fontSize: 13 },
  convItem: {
    padding: '12px 16px', borderBottom: '1px solid #f5f7fa',
    cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
    transition: 'background 0.1s',
  },
  convItemActive: { background: '#eef3ff', borderLeft: '3px solid #3b82f6' },
  avatar: {
    width: 38, height: 38, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, color: 'white', flexShrink: 0,
  },
  convInfo: { flex: 1, minWidth: 0 },
  convName: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  convPreview: { fontSize: 12, color: '#888', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  agentPills: { display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' },
  pill: { padding: '1px 5px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: 'white' },
  convMeta: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  convTime: { fontSize: 11, color: '#aaa' },
  warnBadge: {
    background: '#fff3cd', color: '#856404',
    border: '1px solid #ffd966',
    borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700,
  },
  callItem: {
    padding: '12px 16px', borderBottom: '1px solid #f5f7fa',
    display: 'flex', alignItems: 'center', gap: 12,
  },
  callIcon: { fontSize: 20, flexShrink: 0 },
}
