/* Contacts tab — create, edit, view contacts with Zoho name sync */
import { useState, useEffect } from 'react'
import { api } from '../../api'
import { useColors } from '../../useColors'
import { useToast } from '../Toast'
import { formatPhone, isPhoneLike, displayName, contactInitials } from '../../utils/phone'

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
  return formatPhone(p)
}

export default function ContactsTab({ agent, onDial, onMessage }) {
  const C = useColors()
  const { toast } = useToast()
  const [contacts,   setContacts]   = useState([])
  const [search,     setSearch]     = useState('')
  const [selected,   setSelected]   = useState(null)
  const [isWide,     setIsWide]     = useState(window.innerWidth >= 900)
  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
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

  if (!isWide && showCreate) {
    return (
      <ContactForm
        C={C}
        onSave={async (data) => {
          try {
            const created = await api.createContact(data)
            setContacts(prev => [...prev, created])
            setSelected(created)
            setShowCreate(false)
            toast.success('Contact created')
          } catch (e) {
            toast.error(e.message)
          }
        }}
        onCancel={() => setShowCreate(false)}
      />
    )
  }

  if (!isWide && selected) {
    return (
      <ContactDetail
        contact={selected}
        onBack={() => setSelected(null)}
        onDial={onDial}
        onMessage={onMessage}
        onUpdate={(updated) => {
          setContacts(prev => prev.map(c => c.id === updated.id ? updated : c))
          setSelected(updated)
        }}
        C={C}
      />
    )
  }

  const detailPane = !isWide ? null : showCreate ? (
    <ContactForm
      C={C}
      onSave={async (data) => {
        try {
          const created = await api.createContact(data)
          setContacts(prev => [...prev, created])
          setSelected(created)
          setShowCreate(false)
          toast.success('Contact created')
        } catch (e) { toast.error(e.message) }
      }}
      onCancel={() => setShowCreate(false)}
    />
  ) : selected ? (
    <ContactDetail
      contact={selected}
      onDial={onDial}
      onMessage={onMessage}
      onUpdate={(updated) => {
        setContacts(prev => prev.map(c => c.id === updated.id ? updated : c))
        setSelected(updated)
      }}
      C={C}
    />
  ) : (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.emptyText }}>
      <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.35 }}>👤</div>
      <div style={{ fontSize: 13 }}>Select a contact</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden', height: '100%', background: C.panel }}>
    <div style={{ ...S.page, background: C.panel, ...(isWide ? { width: 360, minWidth: 300, flexShrink: 0, borderRight: '1px solid rgba(128,140,160,0.18)' } : {}) }}>
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
              {contactInitials(c.name, c.phone_number)}
            </div>
            <div style={S.itemInfo}>
              <div style={{ ...S.itemName, color: C.text }}>{displayName(c.name, c.phone_number)}</div>
              <div style={{ ...S.itemPhone, color: C.textSec }}>
                {c.name && !isPhoneLike(c.name) ? fmtPhone(c.phone_number) : ''}
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

    {/* ── Wide-window detail pane ── */}
    {isWide && (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {detailPane}
      </div>
    )}
    </div>
  )
}

/* ── Contact detail view ─────────────────────────────────────────── */
function ContactDetail({ contact, onBack, onUpdate, onDial, onMessage, C }) {
  const { toast } = useToast()
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
            toast.success('Contact updated')
          } catch (e) {
            toast.error(e.message)
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
        setSyncResult({ ok: true, msg: 'Zoho contact found — name already matches the CRM' })
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
        {onBack ? (
          <button style={{ ...D.backBtn, color: C.textSec }} onClick={onBack}>
            <BackIcon />
          </button>
        ) : <span style={{ width: 28 }} />}
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
          {contactInitials(contact.name, contact.phone_number)}
        </div>
        <div style={{ ...D.heroName, color: C.text }}>{contact.name || fmtPhone(contact.phone_number)}</div>
        {contact.name && (
          <div style={{ ...D.heroPhone, color: C.textSec }}>{fmtPhone(contact.phone_number)}</div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button
            title={`Call ${contact.phone_number}`}
            onClick={() => onDial && onDial(contact.phone_number)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.12)', color: '#22c55e', borderRadius: 10, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >📞 Call</button>
          <button
            title={`Message ${contact.phone_number}`}
            onClick={() => onMessage && onMessage(contact.phone_number)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(79,156,249,0.4)', background: 'rgba(79,156,249,0.12)', color: '#4f9cf9', borderRadius: 10, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >💬 Message</button>
        </div>
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

      {/* SMS consent audit trail (A2P/TCPA) */}
      <ConsentSection contact={contact} C={C} />
    </div>
  )
}

/* ── SMS consent history + manual capture (A2P audit trail) ────────── */
const CONSENT_METHOD_LABELS = {
  sms_keyword:   'SMS keyword',
  inbound_sms:   'Texted us first',
  carrier_block: 'Carrier block (STOP)',
  verbal:        'Verbal',
  web_form:      'Web form',
  written:       'Written',
  other:         'Other',
}

function ConsentSection({ contact, C }) {
  const { toast } = useToast()
  const [records, setRecords] = useState(null)
  const [adding,  setAdding]  = useState(false)
  const [action,  setAction]  = useState('opt_in')
  const [method,  setMethod]  = useState('verbal')
  const [detail,  setDetail]  = useState('')
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    let dead = false
    api.contactConsent(contact.id).then(r => { if (!dead) setRecords(r) }).catch(() => { if (!dead) setRecords([]) })
    return () => { dead = true }
  }, [contact.id])

  async function save() {
    if (!detail.trim()) { toast.error('Describe how consent was given (audit trail)'); return }
    setSaving(true)
    try {
      const { record, warning } = await api.recordConsent(contact.id, { action, method, detail })
      setRecords([record, ...(records || [])])
      setAdding(false); setDetail('')
      if (warning) toast.error(warning)
      else toast.success('Consent recorded')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    background: C.surface, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ padding: '4px 16px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.textMuted }}>
          SMS Consent
        </span>
        {!adding && (
          <button
            style={{ background: 'none', border: 'none', color: '#4f9cf9', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}
            onClick={() => setAdding(true)}
          >+ Record consent</button>
        )}
      </div>

      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: C.panel, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={action} onChange={e => setAction(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="opt_in">Opt-in (gave consent)</option>
              <option value="opt_out">Opt-out (revoked consent)</option>
            </select>
            <select value={method} onChange={e => setMethod(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="verbal">Verbal</option>
              <option value="web_form">Web form</option>
              <option value="written">Written</option>
              <option value="other">Other</option>
            </select>
          </div>
          <textarea
            value={detail}
            onChange={e => setDetail(e.target.value)}
            placeholder="How was consent given? e.g. &quot;Asked to be texted appointment reminders during 8/19 phone call&quot;"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 12, cursor: 'pointer' }}
              onClick={() => { setAdding(false); setDetail('') }}
            >Cancel</button>
            <button
              style={{ background: '#4f9cf9', border: 'none', color: '#fff', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
              onClick={save}
              disabled={saving}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {records === null ? (
        <div style={{ fontSize: 12, color: C.textMuted }}>Loading…</div>
      ) : records.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textMuted }}>
          No consent events recorded. Inbound texts and STOP/START keywords are captured automatically; use &quot;Record consent&quot; for verbal or web-form opt-ins.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {records.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: C.panel, border: `1px solid ${C.borderSoft}`, borderRadius: 10, padding: '8px 10px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap',
                background: r.action === 'opt_in' ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                color:      r.action === 'opt_in' ? '#22c55e' : '#f87171' }}>
                {r.action === 'opt_in' ? 'OPT-IN' : 'OPT-OUT'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.text }}>
                  {CONSENT_METHOD_LABELS[r.method] || r.method}
                  {r.recorded_by_name ? ` — by ${r.recorded_by_name}` : ''}
                </div>
                {r.detail && <div style={{ fontSize: 12, color: C.textSec, wordBreak: 'break-word' }}>{r.detail}</div>}
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{fmtDate(r.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Create / Edit form ──────────────────────────────────────────── */
function ContactForm({ C, initial, onSave, onCancel }) {
  const isEdit = !!initial
  // CRM-matched contacts: name is managed in the CRM, not editable here
  const crmLocked = !!initial?.zoho_contact_id
  const [name,      setName]      = useState(initial?.name  || '')
  const [phone,     setPhone]     = useState(initial?.phone_number || '')
  const [notes,     setNotes]     = useState(initial?.notes || '')
  const [saving,    setSaving]    = useState(false)
  const [phoneErr,  setPhoneErr]  = useState('')

  async function handleSave() {
    if (!isEdit && !phone.trim()) {
      setPhoneErr('Phone number is required')
      return
    }
    setPhoneErr('')
    setSaving(true)
    try {
      const payload = { phone_number: phone.trim(), notes: notes.trim() || null }
      if (!crmLocked) payload.name = name.trim() || null
      await onSave(payload)
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
            {contactInitials(name, phone)}
          </div>
        </div>

        {/* Fields */}
        <div style={{ ...F.card, background: C.panel, border: `1px solid ${C.border}` }}>
          <div style={{ ...F.fieldRow, borderBottom: `1px solid ${C.borderSoft}` }}>
            <label style={{ ...F.label, color: C.textSec }}>Name</label>
            <input
              style={{ ...F.input, color: crmLocked ? C.textMuted : C.text, background: 'transparent', cursor: crmLocked ? 'not-allowed' : undefined }}
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={crmLocked}
              title={crmLocked ? 'This contact is matched to the CRM — edit the name there' : undefined}
            />
          </div>
          {crmLocked && (
            <div style={{ padding: '4px 14px 8px', fontSize: 11, color: C.textMuted }}>
              🔒 Name is managed in the CRM. Notes can still be edited here.
            </div>
          )}
          <div style={{ ...F.fieldRow }}>
            <label style={{ ...F.label, color: C.textSec }}>Phone</label>
            <input
              style={{ ...F.input, color: C.text, background: 'transparent', borderColor: phoneErr ? '#ef4444' : undefined }}
              placeholder="+1 (555) 000-0000"
              value={phone}
              onChange={e => { setPhone(e.target.value); setPhoneErr('') }}
              type="tel"
              disabled={isEdit} // phone is immutable once created
            />
            {phoneErr && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{phoneErr}</div>}
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
  list:       { flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 76 },
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
