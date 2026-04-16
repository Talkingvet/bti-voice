/* Contacts tab — create, edit, view contacts with Zoho name sync */
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
function fmtPhone(p) {
  if (!p) return ''
  const d = p.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) {
    return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  }
  if (d.length === 10) {
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  }
  return p
}

export default function ContactsTab({ agent }) {
  const C = useColors()
  const [contacts,   setContacts]   = useState([])
  const [search,     setSearch]     = useState('')
  const [selected,   setSelected]   = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [loading,    setLoading]    = useState(true)

  function reload() {
    api.contacts()
      .then(setContacts)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [])

  const filtered = contacts.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone_number || '').includes(search)
  ).sort((a, b) => (a.name || a.phone_number || '').localeCompare(b.name || b.phone_number || ''))

  if (showCreate) {
    return (
      <ContactForm
        C={C}
        onSave={async (data) => {
          try {
            const created = await api.createContact(data)
            setContacts(prev => [...prev, created])
            setSelected(created)
            setShowCreate(false)
          } catch (e) {
            alert(e.message)
          }
        }}
        onCancel={() => setShowCreate(false)}
      />
    )
  }

  if (selected) {
    return (
      <ContactDetail
        contact={selected}
        onBack={() => setSelected(null)}
        onUpdate={(updated) => {
          setContacts(prev => prev.map(c => c.id === updated.id ? updated : c))
          setSelected(updated)
        }}
        C={C}
      />
    )
  }

  return (
    <div style={{ ...S.page, background: C.panel }}>
      {/* Search bar + New button */}
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
        <button
          style={{ ...S.newBtn, background: '#4f9cf9', color: 'white' }}
          onClick={() => setShowCreate(true)}
          title="New Contact"
        >
          <PlusIcon />
        </button>
      </div>

      {/* Contact list */}
      <div style={S.list}>
        {loading ? (
          <div style={{ ...S.empty, color: C.textMuted }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ ...S.empty, color: C.emptyText }}>
            {search ? 'No contacts found' : 'No contacts yet — tap + to create one'}
          </div>
        ) : filtered.map(c => (
          <div
            key={c.id}
            style={{ ...S.item, borderBottom: `1px solid ${C.borderItem}` }}
            onClick={() => setSelected(c)}
          >
            <div style={{ ...S.avatar, background: avatarColor(c.name || c.phone_number) }}>
              {initials(c.name || c.phone_number)}
            </div>
            <div style={S.itemInfo}>
              <div style={{ ...S.itemName, color: C.text }}>{c.name || fmtPhone(c.phone_number)}</div>
              <div style={{ ...S.itemPhone, color: C.textSec }}>
                {c.name ? fmtPhone(c.phone_number) : ''}
              </div>
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
function ContactDetail({ contact, onBack, onUpdate, C }) {
  const [editing,    setEditing]    = useState(false)
  const [syncing,    setSyncing]    = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  if (editing) {
    return (
      <ContactForm
        C={C}
        initial={contact}
        onSave={async (data) => {
          try {
            const updated = await api.updateContact(contact.id, data)
            onUpdate(updated)
            setEditing(false)
          } catch (e) {
            alert(e.message)
          }
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  async function handleZohoSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const result = await api.syncContactZoho(contact.id)
      if (result.synced && result.name_updated) {
        onUpdate(result.contact)
        setSyncResult({ ok: true, msg: `Name updated to "${result.zoho_name}" from Zoho CRM` })
      } else if (result.synced) {
        setSyncResult({ ok: true, msg: 'Zoho contact found — name was already set, no change needed' })
      } else {
        setSyncResult({ ok: false, msg: result.message || 'Not found in Zoho CRM' })
      }
    } catch (e) {
      setSyncResult({ ok: false, msg: e.message })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div style={{ ...D.page, background: C.bg }}>
      {/* Header */}
      <div style={{ ...D.header, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <button style={{ ...D.backBtn, color: C.textSec }} onClick={onBack}>
          <BackIcon />
        </button>
        <span style={{ ...D.headerTitle, color: C.text }}>Contact</span>
        <button
          style={{ ...D.editBtn, color: '#4f9cf9' }}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </div>

      {/* Hero */}
      <div style={{ ...D.hero, borderBottom: `1px solid ${C.borderSoft}`, background: C.panel }}>
        <div style={{ ...D.avatar, background: avatarColor(contact.name || contact.phone_number) }}>
          {initials(contact.name || contact.phone_number)}
        </div>
        <div style={{ ...D.heroName, color: C.text }}>{contact.name || fmtPhone(contact.phone_number)}</div>
        {contact.name && (
          <div style={{ ...D.heroPhone, color: C.textSec }}>{fmtPhone(contact.phone_number)}</div>
        )}
      </div>

      {/* Info rows */}
      <div style={{ ...D.section, background: C.panel }}>
        <InfoRow label="Phone" value={fmtPhone(contact.phone_number)} C={C} />
        {contact.last_activity && (
          <InfoRow label="Last activity" value={fmtDate(contact.last_activity)} C={C} />
        )}
        {contact.conversation_count > 0 && (
          <InfoRow label="Conversations" value={contact.conversation_count} C={C} />
        )}
        {contact.notes && (
          <div style={{ ...D.row, borderBottom: `1px solid ${C.borderSoft}`, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <span style={{ ...D.label, color: C.textSec }}>Notes</span>
            <span style={{ ...D.value, color: C.text, textAlign: 'left', maxWidth: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {contact.notes}
            </span>
          </div>
        )}
      </div>

      {/* Zoho sync */}
      <div style={{ padding: '10px 16px' }}>
        <button
          style={{
            ...D.zohoBtn,
            background: syncing ? C.surface : 'rgba(79,156,249,0.12)',
            color: syncing ? C.textMuted : '#4f9cf9',
            border: `1px solid rgba(79,156,249,0.3)`,
          }}
          onClick={handleZohoSync}
          disabled={syncing}
        >
          {syncing ? 'Syncing…' : 'Sync name from Zoho CRM'}
        </button>
        {syncResult && (
          <div style={{ ...D.syncMsg, color: syncResult.ok ? '#22c55e' : '#f87171', marginTop: 7 }}>
            {syncResult.msg}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Create / Edit form ──────────────────────────────────────────── */
function ContactForm({ C, initial, onSave, onCancel }) {
  const isEdit = !!initial
  const [name,  setName]  = useState(initial?.name  || '')
  const [phone, setPhone] = useState(initial?.phone_number || '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!isEdit && !phone.trim()) {
      alert('Phone number is required')
      return
    }
    setSaving(true)
    try {
      await onSave({ name: name.trim() || null, phone_number: phone.trim(), notes: notes.trim() || null })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ ...F.page, background: C.bg }}>
      {/* Header */}
      <div style={{ ...F.header, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <button style={{ ...F.cancelBtn, color: C.textSec }} onClick={onCancel}>Cancel</button>
        <span style={{ ...F.title, color: C.text }}>{isEdit ? 'Edit Contact' : 'New Contact'}</span>
        <button
          style={{ ...F.saveBtn, color: saving ? C.textMuted : '#4f9cf9' }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={F.body}>
        {/* Avatar preview */}
        <div style={{ ...F.avatarWrap }}>
          <div style={{ ...F.avatar, background: avatarColor(name || phone) }}>
            {initials(name || phone)}
          </div>
        </div>

        {/* Fields */}
        <div style={{ ...F.card, background: C.panel, border: `1px solid ${C.border}` }}>
          <div style={{ ...F.fieldRow, borderBottom: `1px solid ${C.borderSoft}` }}>
            <label style={{ ...F.label, color: C.textSec }}>Name</label>
            <input
              style={{ ...F.input, color: C.text, background: 'transparent' }}
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div style={{ ...F.fieldRow }}>
            <label style={{ ...F.label, color: C.textSec }}>Phone</label>
            <input
              style={{ ...F.input, color: C.text, background: 'transparent' }}
              placeholder="+1 (555) 000-0000"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
              disabled={isEdit} // phone is immutable once created
            />
          </div>
        </div>

        <div style={{ ...F.card, background: C.panel, border: `1px solid ${C.border}`, marginTop: 10 }}>
          <div style={{ ...F.fieldRow, alignItems: 'flex-start' }}>
            <label style={{ ...F.label, color: C.textSec, paddingTop: 2 }}>Notes</label>
            <textarea
              style={{ ...F.input, ...F.textarea, color: C.text, background: 'transparent' }}
              placeholder="Add a note…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        {isEdit && (
          <div style={{ ...F.hint, color: C.textMuted }}>
            Phone number cannot be changed after creation.
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value, C }) {
  return (
    <div style={{ ...D.row, borderBottom: `1px solid ${C.borderSoft}` }}>
      <span style={{ ...D.label, color: C.textSec }}>{label}</span>
      <span style={{ ...D.value, color: C.text }}>{value}</span>
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
function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

/* ── Styles ─────────────────────────────────────────────────────── */
const S = {
  page:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  searchBar:  { padding: '8px 10px', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' },
  searchWrap: { flex: 1, display: 'flex', alignItems: 'center', gap: 7, borderRadius: 8, padding: '6px 10px' },
  searchInput:{ border: 'none', outline: 'none', fontSize: 13, background: 'transparent', flex: 1 },
  clearBtn:   { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16, color: '#8b96ab', padding: 0 },
  newBtn:     { width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
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
  footer:    { padding: '7px 14px', fontSize: 11, flexShrink: 0 },
}
const D = {
  page:    { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header:  { display: 'flex', alignItems: 'center', padding: '10px 12px', flexShrink: 0 },
  backBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8 },
  headerTitle: { fontSize: 14, fontWeight: 700, flex: 1, textAlign: 'center' },
  editBtn: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 8px' },
  hero: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 16px', flexShrink: 0 },
  avatar: { width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: 'white' },
  heroName:  { fontSize: 17, fontWeight: 700 },
  heroPhone: { fontSize: 12, marginTop: 1 },
  section:   { overflowY: 'auto' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px' },
  label: { fontSize: 12, fontWeight: 500 },
  value: { fontSize: 12, fontWeight: 500, textAlign: 'right' },
  zohoBtn: { width: '100%', padding: '9px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, textAlign: 'center' },
  syncMsg:   { fontSize: 11, textAlign: 'center', lineHeight: 1.4 },
}
const F = {
  page:   { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', padding: '10px 12px', flexShrink: 0 },
  cancelBtn: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#8b96ab', padding: '4px 8px' },
  title:     { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 700 },
  saveBtn:   { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 8px' },
  body:      { flex: 1, overflowY: 'auto', padding: '12px 16px' },
  avatarWrap:{ display: 'flex', justifyContent: 'center', marginBottom: 14 },
  avatar:    { width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: 'white' },
  card:      { borderRadius: 10, overflow: 'hidden' },
  fieldRow:  { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' },
  label:     { fontSize: 12, fontWeight: 500, width: 52, flexShrink: 0 },
  input:     { flex: 1, border: 'none', outline: 'none', fontSize: 13 },
  textarea:  { resize: 'none', alignSelf: 'flex-start', lineHeight: 1.5 },
  hint:      { fontSize: 11, textAlign: 'center', marginTop: 10, lineHeight: 1.4 },
}
