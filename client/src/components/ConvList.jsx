/* Conversation list — full-width single-pane, Zoho-style compact */
import { useState, useRef, useEffect } from 'react'
import { useColors } from '../useColors'

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr), now = new Date()
  const diff = now - d
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  const yesterday = new Date(now - 86400000)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(str) {
  if (!str) return '?'
  const p = str.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : str.slice(0, 2).toUpperCase()
}
function avatarColor(str) {
  if (!str) return '#64748b'
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  const cols = ['#f97316','#0ea5e9','#ec4899','#14b8a6','#d97706','#6366f1','#84cc16']
  return cols[Math.abs(h) % cols.length]
}

export default function ConvList({ conversations, selectedId, onSelect, currentAgent, agents = [] }) {
  const [search,      setSearch]      = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const C = useColors()

  const filtered = conversations.filter(c => {
    const nameMatch = (c.contact_name || c.contact_number || '').toLowerCase().includes(search.toLowerCase())
    if (!nameMatch) return false
    if (agentFilter === 'all') return true
    const involved = c.agents_involved || []
    return involved.some(a => String(a.id) === String(agentFilter))
  })

  return (
    <div style={{ ...S.panel, background: C.panel }}>

      {/* Filter row: sender dropdown + search */}
      <div style={{ ...S.filterRow, borderBottom: `1px solid ${C.border}`, background: C.panel }}>
        <AgentDropdown
          value={agentFilter}
          onChange={setAgentFilter}
          agents={agents}
          C={C}
        />
        <div style={{ ...S.searchWrap, background: C.surface, border: `1px solid ${C.borderSoft}` }}>
          <SearchIcon color={C.textMuted} />
          <input
            style={{ ...S.searchInput, color: C.text }}
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button style={S.clearBtn} onClick={() => setSearch('')}>×</button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={S.list}>
        {filtered.length === 0 ? (
          <div style={{ ...S.empty, color: C.emptyText }}>
            {search ? 'No results' : 'No conversations yet'}
          </div>
        ) : (
          filtered.map(conv => (
            <ConvItem
              key={conv.id}
              conv={conv}
              active={conv.id === selectedId}
              onClick={() => onSelect(conv.id)}
              currentAgent={currentAgent}
              C={C}
            />
          ))
        )}
      </div>
    </div>
  )
}

/* Custom dropdown — fully theme-aware, no OS-styled native select */
function AgentDropdown({ value, onChange, agents, C }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const options = [{ id: 'all', name: 'All Agents' }, ...agents]
  const selected = options.find(o => String(o.id) === String(value)) || options[0]

  return (
    <div ref={ref} style={DD.wrap}>
      <button
        style={{ ...DD.trigger, background: C.surface, border: `1px solid ${C.borderSoft}`, color: C.text }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={DD.triggerLabel}>{selected.name}</span>
        <ChevronDownIcon color={C.textMuted} open={open} />
      </button>
      {open && (
        <div style={{ ...DD.menu, background: C.panel, border: `1px solid ${C.border}`, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}>
          {options.map(opt => (
            <button
              key={opt.id}
              style={{
                ...DD.option,
                background: String(opt.id) === String(value) ? 'rgba(79,156,249,0.15)' : 'transparent',
                color: String(opt.id) === String(value) ? '#4f9cf9' : C.text,
              }}
              onClick={() => { onChange(String(opt.id)); setOpen(false) }}
            >
              {opt.id !== 'all' && (
                <span style={{ ...DD.agentDot, background: opt.color || '#8b96ab' }} />
              )}
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChevronDownIcon({ color, open }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

const DD = {
  wrap:    { position: 'relative', flexShrink: 0 },
  trigger: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 9px', borderRadius: 7,
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  triggerLabel: { maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  menu: {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0,
    minWidth: 140, borderRadius: 8,
    zIndex: 500, overflow: 'hidden',
    animation: 'fadeIn 0.1s ease',
  },
  option: {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '8px 12px',
    border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 500, textAlign: 'left',
    transition: 'background 0.08s',
  },
  agentDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
}

function ConvItem({ conv, active, onClick, currentAgent, C }) {
  const name    = conv.contact_name || conv.contact_number || 'Unknown'
  const preview = conv.last_message ? truncate(conv.last_message, 42) : '—'
  const agents  = conv.agents_involved || []
  const hasDoubleText = parseInt(conv.recent_outbound_count) >= 2

  return (
    <div
      onClick={onClick}
      style={{
        ...S.item,
        background: active ? C.active : 'transparent',
        borderBottom: `1px solid ${C.borderItem}`,
      }}
    >
      {active && <div style={S.activePip} />}

      {/* Avatar */}
      <div style={{ ...S.avatar, background: avatarColor(name) }}>
        {initials(name)}
      </div>

      {/* Text */}
      <div style={S.itemBody}>
        <div style={S.nameRow}>
          <span style={{ ...S.name, color: C.text }}>{name}</span>
          <span style={{ ...S.time, color: C.textMuted }}>{fmtDate(conv.last_message_at)}</span>
        </div>
        <div style={{ ...S.preview, color: C.textSec }}>
          {conv.last_agent_name && (
            <span style={{ color: conv.last_agent_color || C.textSec, fontWeight: 600, marginRight: 3 }}>
              {conv.last_agent_name.split(' ')[0]}:
            </span>
          )}
          <span>{preview}</span>
        </div>
        {/* Agent dots */}
        {agents.length > 0 && (
          <div style={S.agentDots}>
            {agents.slice(0, 5).map(a => (
              <span
                key={a.id}
                title={a.name}
                style={{ ...S.agentDot, background: a.color }}
              />
            ))}
            {hasDoubleText && (
              <span style={S.warnDot} title="Multiple outbound messages recently">!</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s }

function SearchIcon({ color = '#8b96ab' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

const S = {
  panel: {
    flex: 1, display: 'flex', flexDirection: 'column',
    overflow: 'hidden', minHeight: 0,
  },
  filterRow: {
    display: 'flex', gap: 6,
    padding: '8px 10px',
    flexShrink: 0,
  },
  searchWrap: {
    flex: 1, display: 'flex', alignItems: 'center',
    gap: 6, borderRadius: 7, padding: '5px 9px',
  },
  searchInput: {
    border: 'none', outline: 'none',
    fontSize: 12, background: 'transparent',
    flex: 1, minWidth: 0,
  },
  clearBtn: {
    border: 'none', background: 'transparent',
    cursor: 'pointer', fontSize: 15, lineHeight: 1,
    color: '#8b96ab', padding: 0,
  },
  list: { flex: 1, overflowY: 'auto', minHeight: 0 },
  empty: { padding: '28px 16px', textAlign: 'center', fontSize: 12 },

  item: {
    position: 'relative',
    padding: '10px 12px 10px 15px',
    cursor: 'pointer',
    display: 'flex', alignItems: 'flex-start', gap: 10,
    transition: 'background 0.1s',
  },
  activePip: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    width: 3, background: '#4f9cf9',
    borderRadius: '0 2px 2px 0',
  },
  avatar: {
    width: 36, height: 36, borderRadius: '50%',
    flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, color: 'white',
    marginTop: 1,
  },
  itemBody: { flex: 1, minWidth: 0 },
  nameRow: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: 2,
  },
  name: {
    fontSize: 13, fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', flex: 1,
  },
  time: { fontSize: 10, flexShrink: 0, marginLeft: 6 },
  preview: {
    fontSize: 11.5,
    overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap', marginBottom: 4,
  },
  agentDots: { display: 'flex', gap: 4, alignItems: 'center' },
  agentDot: {
    width: 8, height: 8, borderRadius: '50%',
  },
  warnDot: {
    width: 14, height: 14, borderRadius: '50%',
    background: '#fef3c7', color: '#92400e',
    fontSize: 9, fontWeight: 900,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid #fde68a',
  },
}
