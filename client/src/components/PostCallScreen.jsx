import { useState, useEffect, useMemo } from 'react'
import { api } from '../api'
import { useColors } from '../useColors'

/* v1.4.0 — Post-call wrap-up screen.
   Solves the shared-phone-number problem in Zoho where calls auto-attach to
   one of several contacts at the same hospital. After a connected call >=15s
   ends, the agent gets this slide-over to:
     - confirm/pick the actual person spoken with (dropdown of all Zoho
       contacts at that number),
     - record an outcome (disposition pills),
     - drop a free-form note (posted as a Zoho Note on the chosen contact),
     - optionally create a follow-up Zoho Task assigned to any Zoho user.
   Skip leaves needs_wrap_up=TRUE so the badge persists in CallsTab.
   Submit POSTs /api/calls/:id/wrap-up which handles all the Zoho writes.
*/

const DISPOSITIONS = [
  { code: 'demo_scheduled',             label: 'Demo scheduled' },
  { code: 'callback_requested',         label: 'Callback requested' },
  { code: 'not_interested',             label: 'Not interested' },
  { code: 'existing_customer_support',  label: 'Existing customer — support' },
  { code: 'left_voicemail',             label: 'Left voicemail' },
  { code: 'wrong_number',               label: 'Wrong number' },
  { code: 'other',                      label: 'Other' },
]

function fmtDuration(sec) {
  const n = Number(sec) || 0
  const m = Math.floor(n / 60), s = n % 60
  return m > 0 ? m + ':' + String(s).padStart(2, '0') : '0:' + String(s).padStart(2, '0')
}

export default function PostCallScreen({ call, onClose, onSaved }) {
  const C = useColors()

  const [contacts,    setContacts]    = useState([])     // [{ id, Full_Name, Email, Account_Name, ... }]
  const [chosenId,    setChosenId]    = useState('')     // Zoho contact id (string)
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [contactErr,  setContactErr]  = useState('')

  const [users,       setUsers]       = useState([])     // Zoho users
  const [usersLoaded, setUsersLoaded] = useState(false)

  const [disposition, setDisposition] = useState('')     // disposition code
  const [note,        setNote]        = useState('')

  // Follow-up task (collapsed by default)
  const [taskOpen,        setTaskOpen]        = useState(false)
  const [taskSubject,     setTaskSubject]     = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskDueDate,     setTaskDueDate]     = useState('')
  const [taskOwnerId,     setTaskOwnerId]     = useState('')

  // Create-in-Zoho mini-form (only shown when 0 contacts match)
  const [showCreate,    setShowCreate]    = useState(false)
  const [newFirst,      setNewFirst]      = useState('')
  const [newLast,       setNewLast]       = useState('')
  const [newEmail,      setNewEmail]      = useState('')
  const [newAccount,    setNewAccount]    = useState('')
  const [creating,      setCreating]      = useState(false)

  const [submitting,  setSubmitting]  = useState(false)
  const [submitError, setSubmitError] = useState('')

  // Load matching contacts on mount
  useEffect(() => {
    if (!call || !call.phone) {
      setLoadingContacts(false)
      setContactErr('No phone number on this call.')
      return
    }
    setLoadingContacts(true)
    api.zohoFindContactsByPhone(call.phone)
      .then(resp => {
        const list = (resp && resp.contacts) || []
        setContacts(list)
        if (list.length > 0) {
          setChosenId(list[0].id) // default to first (the auto-matched one)
        } else {
          setShowCreate(true) // no matches — surface the create form
        }
      })
      .catch(e => {
        setContactErr(e.message || 'Failed to load contacts')
      })
      .finally(() => setLoadingContacts(false))
  }, [call])

  // Esc key dismisses the screen (same as Skip).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleSkip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load Zoho users lazily — only when the task panel opens
  useEffect(() => {
    if (!taskOpen || usersLoaded) return
    api.zohoUsers()
      .then(resp => {
        setUsers((resp && resp.users) || [])
        setUsersLoaded(true)
      })
      .catch(e => console.warn('[post-call] zoho users failed:', e.message))
  }, [taskOpen, usersLoaded])

  const chosenContact = useMemo(
    () => contacts.find(c => c.id === chosenId),
    [contacts, chosenId]
  )

  function describeContact(c) {
    if (!c) return ''
    const name = c.Full_Name || '(unnamed)'
    const acct = c.Account_Name && c.Account_Name.name
    const email = c.Email
    let extra = ''
    if (acct)  extra += ' · ' + acct
    if (email) extra += ' · ' + email
    return name + extra
  }

  async function handleCreateContact() {
    if (!newLast.trim()) {
      setSubmitError('Last name is required to create a Zoho contact.')
      return
    }
    setCreating(true)
    setSubmitError('')
    try {
      const resp = await api.zohoCreateContact({
        first_name:   newFirst.trim() || null,
        last_name:    newLast.trim(),
        phone:        call.phone,
        email:        newEmail.trim() || null,
        account_name: newAccount.trim() || null,
        link_call_id: call.id,
      })
      const created = resp && resp.zoho_contact
      if (created && created.id) {
        const newRow = {
          id:           created.id,
          Full_Name:    [newFirst.trim(), newLast.trim()].filter(Boolean).join(' '),
          Email:        newEmail.trim() || null,
          Account_Name: newAccount.trim() ? { name: newAccount.trim(), id: null } : null,
        }
        setContacts(prev => [newRow, ...prev])
        setChosenId(created.id)
        setShowCreate(false)
      }
    } catch (e) {
      setSubmitError(e.message || 'Failed to create contact')
    } finally {
      setCreating(false)
    }
  }

  async function handleSave() {
    setSubmitting(true)
    setSubmitError('')
    const payload = {
      chosen_zoho_contact_id: chosenId || null,
      disposition: disposition || null,
      note:        note.trim() || null,
    }
    if (taskOpen && taskSubject.trim()) {
      payload.task = {
        subject:     taskSubject.trim(),
        description: taskDescription.trim() || null,
        due_date:    taskDueDate || null,
        owner_id:    taskOwnerId || null,
      }
    }
    try {
      await api.wrapUpCall(call.id, payload)
      onSaved && onSaved()
      onClose()
    } catch (e) {
      setSubmitError(e.message || 'Save failed')
      setSubmitting(false)
    }
  }

  async function handleSkip() {
    try {
      await api.wrapUpCall(call.id, { skip: true })
    } catch (e) {
      // Skip should always close even if the API hiccups — no point blocking
      console.warn('[post-call] skip request failed:', e.message)
    }
    onClose()
  }

  const dirIcon = call.direction === 'inbound' ? '\u2199' : '\u2197'

  return (
    <>
      {/* Backdrop */}
      <div style={S.backdrop} onClick={handleSkip} />

      {/* Card */}
      <div style={{
        ...S.modal,
        background: C.panel,
        border: '1px solid ' + C.border,
        color: C.text,
      }}>
        {/* Header */}
        <div style={{ ...S.header, borderBottom: '1px solid ' + C.border }}>
          <div style={{ ...S.headerTitle, color: C.text }}>
            <span style={{ fontSize: 16 }}>{dirIcon}</span>
            Wrap up call
            <span style={{ ...S.headerMeta, color: C.textMuted }}>
              {fmtDuration(call.duration)} · {call.phone}
            </span>
          </div>
          <button style={{ ...S.closeBtn, color: C.textMuted }} onClick={handleSkip}>×</button>
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* Spoke with */}
          <div style={S.field}>
            <label style={{ ...S.label, color: C.textMuted }}>SPOKE WITH</label>
            {loadingContacts ? (
              <div style={{ ...S.muted, color: C.textSec }}>Looking up contacts…</div>
            ) : contactErr ? (
              <div style={S.error}>{contactErr}</div>
            ) : contacts.length === 0 && !showCreate ? (
              <button
                style={{ ...S.linkBtn, color: '#4f9cf9' }}
                onClick={() => setShowCreate(true)}
              >+ Create contact in Zoho</button>
            ) : contacts.length > 0 ? (
              <>
                <select
                  style={{
                    ...S.select,
                    background: C.inputBg,
                    border: '1px solid ' + C.inputBorder,
                    color: C.text,
                  }}
                  value={chosenId}
                  onChange={e => setChosenId(e.target.value)}
                >
                  {contacts.map((c, i) => (
                    <option key={c.id} value={c.id}>
                      {describeContact(c)}{i === 0 ? '  (auto-matched)' : ''}
                    </option>
                  ))}
                </select>
                {contacts.length > 1 && (
                  <div style={{ ...S.helper, color: C.textMuted }}>
                    {contacts.length} contacts share this number — pick the one you actually spoke with.
                  </div>
                )}
                {!showCreate && (
                  <button
                    style={{ ...S.linkBtn, color: C.textSec, fontSize: 11, marginTop: 4 }}
                    onClick={() => setShowCreate(true)}
                  >+ None of these — create new in Zoho</button>
                )}
              </>
            ) : null}

            {showCreate && (
              <div style={{ ...S.createBox, background: C.surface, border: '1px solid ' + C.borderSoft }}>
                <div style={{ ...S.createTitle, color: C.text }}>Create new Zoho contact</div>
                <div style={S.createRow}>
                  <input
                    style={{ ...S.input, background: C.inputBg, border: '1px solid ' + C.inputBorder, color: C.text }}
                    placeholder="First name"
                    value={newFirst}
                    onChange={e => setNewFirst(e.target.value)}
                  />
                  <input
                    style={{ ...S.input, background: C.inputBg, border: '1px solid ' + C.inputBorder, color: C.text }}
                    placeholder="Last name *"
                    value={newLast}
                    onChange={e => setNewLast(e.target.value)}
                  />
                </div>
                <input
                  style={{ ...S.input, background: C.inputBg, border: '1px solid ' + C.inputBorder, color: C.text }}
                  placeholder="Account / Hospital (optional)"
                  value={newAccount}
                  onChange={e => setNewAccount(e.target.value)}
                />
                <input
                  style={{ ...S.input, background: C.inputBg, border: '1px solid ' + C.inputBorder, color: C.text }}
                  placeholder="Email (optional)"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  {contacts.length > 0 && (
                    <button
                      style={{ ...S.smallBtn, color: C.textSec }}
                      onClick={() => setShowCreate(false)}
                      disabled={creating}
                    >Cancel</button>
                  )}
                  <button
                    style={{ ...S.smallPrimary, opacity: creating || !newLast.trim() ? 0.5 : 1 }}
                    onClick={handleCreateContact}
                    disabled={creating || !newLast.trim()}
                  >{creating ? 'Creating…' : 'Create'}</button>
                </div>
              </div>
            )}
          </div>

          {/* Disposition */}
          <div style={S.field}>
            <label style={{ ...S.label, color: C.textMuted }}>OUTCOME</label>
            <div style={S.pillRow}>
              {DISPOSITIONS.map(d => {
                const active = disposition === d.code
                return (
                  <button
                    key={d.code}
                    onClick={() => setDisposition(active ? '' : d.code)}
                    style={{
                      ...S.pill,
                      background: active ? 'rgba(79,156,249,0.18)' : C.surface,
                      border: '1px solid ' + (active ? '#4f9cf9' : C.borderSoft),
                      color: active ? '#4f9cf9' : C.textSec,
                    }}
                  >{d.label}</button>
                )
              })}
            </div>
          </div>

          {/* Note */}
          <div style={S.field}>
            <label style={{ ...S.label, color: C.textMuted }}>NOTE (optional — posted to Zoho)</label>
            <textarea
              style={{
                ...S.textarea,
                background: C.inputBg,
                border: '1px solid ' + C.inputBorder,
                color: C.text,
              }}
              placeholder="What happened, follow-ups, key details…"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
            />
          </div>

          {/* Follow-up task (collapsible) */}
          <div style={S.field}>
            {!taskOpen ? (
              <button
                style={{ ...S.linkBtn, color: '#4f9cf9' }}
                onClick={() => setTaskOpen(true)}
              >+ Add follow-up task</button>
            ) : (
              <div style={{ ...S.taskBox, background: C.surface, border: '1px solid ' + C.borderSoft }}>
                <div style={S.taskHead}>
                  <span style={{ ...S.label, color: C.textMuted }}>FOLLOW-UP TASK</span>
                  <button
                    style={{ ...S.linkBtn, color: C.textSec, fontSize: 11 }}
                    onClick={() => { setTaskOpen(false); setTaskSubject(''); setTaskDescription(''); setTaskDueDate(''); setTaskOwnerId('') }}
                  >Remove</button>
                </div>
                <input
                  style={{ ...S.input, background: C.inputBg, border: '1px solid ' + C.inputBorder, color: C.text }}
                  placeholder="Subject (e.g. Send pricing follow-up)"
                  value={taskSubject}
                  onChange={e => setTaskSubject(e.target.value)}
                />
                <textarea
                  style={{
                    ...S.textarea,
                    background: C.inputBg,
                    border: '1px solid ' + C.inputBorder,
                    color: C.text,
                    minHeight: 50,
                  }}
                  placeholder="Description (optional)"
                  value={taskDescription}
                  onChange={e => setTaskDescription(e.target.value)}
                  rows={2}
                />
                <div style={S.createRow}>
                  <div style={{ flex: 1 }}>
                    <label style={{ ...S.label, color: C.textMuted, display: 'block' }}>DUE DATE</label>
                    <input
                      type="date"
                      style={{ ...S.input, background: C.inputBg, border: '1px solid ' + C.inputBorder, color: C.text }}
                      value={taskDueDate}
                      onChange={e => setTaskDueDate(e.target.value)}
                    />
                  </div>
                  <div style={{ flex: 1.3 }}>
                    <label style={{ ...S.label, color: C.textMuted, display: 'block' }}>ASSIGN TO</label>
                    <select
                      style={{ ...S.select, background: C.inputBg, border: '1px solid ' + C.inputBorder, color: C.text }}
                      value={taskOwnerId}
                      onChange={e => setTaskOwnerId(e.target.value)}
                    >
                      <option value="">(Owner default)</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {submitError && <div style={S.error}>{submitError}</div>}
        </div>

        {/* Footer */}
        <div style={{ ...S.footer, borderTop: '1px solid ' + C.border }}>
          <button
            style={{ ...S.skipBtn, color: C.textSec }}
            onClick={handleSkip}
            disabled={submitting}
          >Skip</button>
          <button
            style={{ ...S.saveBtn, opacity: submitting ? 0.6 : 1 }}
            onClick={handleSave}
            disabled={submitting || (!chosenId && contacts.length > 0)}
          >{submitting ? 'Saving…' : 'Save & Close'}</button>
        </div>
      </div>
    </>
  )
}

const S = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000 },
  modal: {
    position: 'fixed',
    bottom: 72, right: 16,
    width: 360,
    maxHeight: 'calc(100vh - 96px)',
    borderRadius: 14,
    zIndex: 1001,
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
    overflow: 'hidden',
    display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', flexShrink: 0,
  },
  headerTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 },
  headerMeta:  { fontSize: 11, fontWeight: 500, marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, padding: 0, lineHeight: 1, marginLeft: 8 },

  body: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flex: 1, minHeight: 0 },

  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 },
  helper:{ fontSize: 10, marginTop: 4 },
  muted: { fontSize: 12, fontStyle: 'italic' },

  select: { width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, outline: 'none' },
  input:  { width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, outline: 'none', boxSizing: 'border-box' },
  textarea: {
    width: '100%', padding: '9px 10px', borderRadius: 8, fontSize: 12,
    outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
    boxSizing: 'border-box', minHeight: 64,
  },

  pillRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  pill: { padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer' },

  createBox: { padding: 10, borderRadius: 8, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 },
  createTitle: { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  createRow: { display: 'flex', gap: 6 },
  smallBtn:    { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 10px' },
  smallPrimary:{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },

  taskBox: { padding: 10, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  taskHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },

  linkBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, textAlign: 'left', padding: 0 },

  error: {
    background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.4)',
    borderRadius: 7, padding: '7px 10px', fontSize: 12, color: '#ef4444',
  },

  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', flexShrink: 0 },
  skipBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  saveBtn: {
    background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8,
    padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
}
