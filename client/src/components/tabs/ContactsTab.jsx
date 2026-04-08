/* Contacts tab — single-pane navigator, compact Zoho style */
import { useState, useEffect } from 'react'
import { api } from '../../api'
import { useColors } from '../../useColors'

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
function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ContactsTab({ agent }) {
  const C = useColors()
  const [conversations, setConversations] = useState([])
  const [search,        setSearch]        = useState('')
  const [selected,      setSelected]      = useState(null)

  useEffect(() => { api.conversations().then(setConversations).catch(console.error) }, [])

  // Build unique contact list from conversations
  const contacts = [...new Map(
    conversations.map(c => [c.contact_id, {
      id:       c.contact_id,
      name:     c.contact_name || c.contact_number,
      phone:    c.contact_number,
      lastMsg:  c.last_message,
      lastAt:   c.last_message_at,
      agents:   c.agents_involved || [],
      convId:   c.id,
    }])
  ).values()]

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  ).sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  if (selected) {
    return (
      <ContactDetail
        contact={selected}
        onBack={() => setSelected(null)}
        C={C}
      />
    )
  }

  return (
    <div style={{ ...S.page, background: C.panel }}>
      {/* Search bar */}
      <div style={{ ...S.searchBar, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ ...S.searchWrap, background: C.surface, border: `1px solid ${C.borderSoft}` }}>
          <SearchIcon color={C.textMuted} />
          <input
            style={{ ...S.searchInput, color: C.text }}
            placeholder="Search name, number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button style={S.clearBtn} onClick={() => setSearch('')}>×</button>
          )}
        </div>
      </div>

      {/* Contact list */}
      <div style={S.list}>
        {filtered.length === 0 ? (
          <div style={{ ...S.empty, color: C.emptyText }}>
            {search ? 'No contacts found' : 'No contacts yet — conversations will appear here'}
          </div>
        ) : filtered.map(c => (
          <div
            key={c.id}
            style={{ ...S.item, borderBottom: `1px solid ${C.borderItem}` }}
            onClick={() => setSelected(c)}
          >
            <div style={{ ...S.avatar, background: avatarColor(c.name) }}>
              {initials(c.name)}
            </div>
            <div style={S.itemInfo}>
              <div style={{ ...S.itemName, color: C.text }}>{c.name}</div>
              <div style={{ ...S.itemPhone, color: C.textSec }}>{c.phone}</div>
            </div>
            <div style={S.itemRight}>
              {c.agents.slice(0, 4).map(a => (
                <span
                  key={a.id}
                  title={a.name}
                  style={{ ...S.agentDot, background: a.color }}
                />
              ))}
            </div>
            <ChevronIcon color={C.textMuted} />
          </div>
        ))}
      </div>

      {/* Count */}
      <div style={{ ...S.footer, borderTop: `1px solid ${C.borderSoft}`, color: C.textMuted }}>
        {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

/* ── Contact detail view ─────────────────────────────────────────── */
function ContactDetail({ contact, onBack, C }) {
  return (
    <div style={{ ...D.page, background: C.bg }}>
      {/* Header with back */}
      <div style={{ ...D.header, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <button style={{ ...D.backBtn, color: C.textSec }} onClick={onBack}>
          <BackIcon />
        </button>
        <span style={{ ...D.headerTitle, color: C.text }}>Contact</span>
      </div>

      {/* Hero */}
      <div style={{ ...D.hero, borderBottom: `1px solid ${C.borderSoft}`, background: C.panel }}>
        <div style={{ ...D.avatar, background: avatarColor(contact.name) }}>
          {initials(contact.name)}
        </div>
        <div style={{ ...D.heroName, color: C.text }}>{contact.name}</div>
        {contact.phone && contact.name !== contact.phone && (
          <div style={{ ...D.heroPhone, color: C.textSec }}>{contact.phone}</div>
        )}
      </div>

      {/* Info rows */}
      <div style={{ ...D.section, background: C.panel }}>
        <InfoRow label="Phone" value={contact.phone} C={C} />
        {contact.lastMsg && (
          <InfoRow label="Last message" value={contact.lastMsg} C={C} truncate />
        )}
        {contact.lastAt && (
          <InfoRow label="Last activity" value={fmtDate(contact.lastAt)} C={C} />
        )}
        {contact.agents.length > 0 && (
          <div style={{ ...D.row, borderBottom: `1px solid ${C.borderSoft}` }}>
            <span style={{ ...D.label, color: C.textSec }}>Handled by</span>
            <div style={D.agentList}>
              {contact.agents.map(a => (
                <span key={a.id} style={{ ...D.agentPill, background: a.color + '22', color: a.color, border: `1px solid ${a.color}55` }}>
                  <span style={{ ...D.agentDot, background: a.color }} />
                  {a.name || a.initials}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value, C, truncate: shouldTruncate }) {
  return (
    <div style={{ ...D.row, borderBottom: `1px solid ${D.borderSoft || '#2a3347'}` }}>
      <span style={{ ...D.label, color: C.textSec }}>{label}</span>
      <span style={{
        ...D.value, color: C.text,
        ...(shouldTruncate ? { maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {})
      }}>
        {value}
      </span>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────── */
function SearchIcon({ color }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
function ChevronIcon({ color }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" style={{ flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
    </svg>
  )
}

/* ── Styles ─────────────────────────────────────────────────────── */
const S = {
  page:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  searchBar:  { padding: '8px 10px', flexShrink: 0 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 7, borderRadius: 8, padding: '6px 10px' },
  searchInput:{ border: 'none', outline: 'none', fontSize: 13, background: 'transparent', flex: 1 },
  clearBtn:   { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: '#8b96ab', padding: 0 },
  list:       { flex: 1, overflowY: 'auto', minHeight: 0 },
  empty:      { padding: '24px 16px', textAlign: 'center', fontSize: 12, lineHeight: 1.5 },
  item: {
    display: 'flex', alignItems: 'center',
    padding: '10px 12px', gap: 10, cursor: 'pointer',
    transition: 'background 0.1s',
  },
  avatar: {
    width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, color: 'white',
  },
  itemInfo:  { flex: 1, minWidth: 0 },
  itemName:  { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemPhone: { fontSize: 11, marginTop: 1 },
  itemRight: { display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 },
  agentDot:  { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' },
  footer:    { padding: '7px 14px', fontSize: 11, flexShrink: 0 },
}
const D = {
  page:    { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:  { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', flexShrink: 0 },
  backBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8 },
  headerTitle: { fontSize: 14, fontWeight: 700 },
  hero: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 16px', flexShrink: 0 },
  avatar: { width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: 'white' },
  heroName:  { fontSize: 17, fontWeight: 700 },
  heroPhone: { fontSize: 12, marginTop: 1 },
  section:   { flex: 1, overflowY: 'auto' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px' },
  label: { fontSize: 12, fontWeight: 500 },
  value: { fontSize: 12, fontWeight: 500, textAlign: 'right' },
  agentList: { display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' },
  agentPill: { display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 8, fontSize: 11, fontWeight: 600 },
  agentDot:  { width: 6, height: 6, borderRadius: '50%' },
}
