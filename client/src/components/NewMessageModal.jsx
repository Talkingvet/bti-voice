import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { useColors } from '../useColors'
import { formatPhone } from '../utils/phone'

export default function NewMessageModal({ currentAgent, onClose, onSent }) {
  const C = useColors()

  const [agents,      setAgents]      = useState([])
  const [fromAgent,   setFromAgent]   = useState(currentAgent?.id || '')
  const [toNumber,    setToNumber]    = useState('')
  const [toSearch,    setToSearch]    = useState([]) // matching contacts
  const [message,     setMessage]     = useState('')
  const [sending,     setSending]     = useState(false)
  const [error,       setError]       = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  // MMS attachments — [{ id, content_type, previewUrl, name }]
  const [attachments, setAttachments] = useState([])
  const [uploading,   setUploading]   = useState(false)
  const fileInputRef = useRef(null)

  // Scheduled send
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleAt,   setScheduleAt]   = useState('')

  const toRef = useRef(null)

  useEffect(() => {
    api.agents().then(list => {
      setAgents(list)
      if (!fromAgent && list.length > 0) setFromAgent(list[0].id)
    }).catch(console.error)
  }, [])

  // Search existing contacts as user types
  useEffect(() => {
    if (toNumber.length < 2) { setToSearch([]); return }
    api.conversations()
      .then(convs => {
        const matches = convs
          .filter(c =>
            (c.contact_name || '').toLowerCase().includes(toNumber.toLowerCase()) ||
            (c.contact_number || '').includes(toNumber)
          )
          .slice(0, 5)
          .map(c => ({ name: c.contact_name, number: c.contact_number }))
        setToSearch(matches)
        setShowDropdown(matches.length > 0)
      })
      .catch(() => {})
  }, [toNumber])

  // ── MMS attachments ──────────────────────────────────────────────
  async function handleFilePicked(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-picking the same file
    for (const file of files) {
      if (!file.type.startsWith('image/')) { setError('Only images are supported'); continue }
      if (file.size > 5 * 1024 * 1024) { setError(`${file.name} is over the 5 MB MMS limit`); continue }
      setUploading(true)
      try {
        const mm = await api.uploadMedia(file)
        setAttachments(a => [...a, { ...mm, previewUrl: URL.createObjectURL(file), name: file.name }])
        setError('')
      } catch (err) {
        setError('Upload failed: ' + err.message)
      } finally {
        setUploading(false)
      }
    }
  }
  function removeAttachment(id) {
    setAttachments(a => a.filter(x => x.id !== id))
  }

  // ── Scheduled send ───────────────────────────────────────────────
  function openSchedule() {
    // Default: one hour from now, rounded to next 15 min, in datetime-local format
    const d = new Date(Date.now() + 60 * 60 * 1000)
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
    const pad = n => String(n).padStart(2, '0')
    setScheduleAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
    setShowSchedule(true)
  }

  const wantSchedule = showSchedule && !!scheduleAt
  const hasMedia     = attachments.length > 0
  // /messages/send and /messages/schedule always send as the signed-in agent
  const sendsAsSelf  = (wantSchedule || hasMedia) && currentAgent && fromAgent !== currentAgent.id

  async function handleSend() {
    if (!toNumber.trim() || (!message.trim() && !hasMedia)) {
      setError('Please fill in a recipient and message.')
      return
    }
    if (wantSchedule && hasMedia) {
      setError('Scheduled messages can’t include photos yet — send the photo now, or schedule text only.')
      return
    }
    if (wantSchedule && !message.trim()) {
      setError('Scheduled messages need a text body.')
      return
    }
    setSending(true)
    setError('')
    try {
      let convId
      if (wantSchedule || hasMedia) {
        // Reuse the standard (tested) endpoints: make sure a conversation
        // exists first, then go through /messages/schedule or /messages/send.
        const r = await api.ensureConversation(toNumber.trim())
        convId = r.conversation_id
        if (wantSchedule) {
          await api.scheduleMessage(convId, message.trim(), new Date(scheduleAt).toISOString())
        } else {
          await api.sendMessage(convId, message.trim(), attachments.map(a => a.id))
        }
      } else {
        const result = await api.newMessage({
          to_number:     toNumber.trim(),
          from_agent_id: fromAgent,
          body:          message.trim(),
        })
        convId = result.conversation_id
      }
      onSent?.(convId)
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to send')
      setSending(false)
    }
  }

  function pickContact(contact) {
    setToNumber(contact.number)
    setToSearch([])
    setShowDropdown(false)
  }

  const selectedAgent = agents.find(a => a.id === fromAgent) || currentAgent
  const canSend = !sending && !uploading && toNumber.trim() && (message.trim() || hasMedia)

  return (
    <>
      {/* Backdrop */}
      <div style={S.backdrop} onClick={onClose} />

      {/* Modal card */}
      <div style={{ ...S.modal, background: C.panel, border: `1px solid ${C.border}` }}>
        {/* Header */}
        <div style={{ ...S.header, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ ...S.headerTitle, color: C.text }}>
            <ComposeIcon />
            New Message
          </div>
          <button style={{ ...S.closeBtn, color: C.textMuted }} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={S.body}>
          {/* From */}
          <div style={S.field}>
            <label style={{ ...S.label, color: C.textMuted }}>FROM</label>
            <select
              style={{
                ...S.select,
                background: C.inputBg,
                border: `1px solid ${C.inputBorder}`,
                color: C.text,
              }}
              value={fromAgent}
              onChange={e => setFromAgent(parseInt(e.target.value))}
            >
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.phone_number !== 'TBD' ? ` · ${formatPhone(a.phone_number)}` : ''}
                </option>
              ))}
            </select>
            {selectedAgent && (
              <div style={S.senderPill}>
                <div style={{ ...S.senderDot, background: selectedAgent.color || '#3b82f6' }} />
                <span style={{ color: C.textSec, fontSize: 11 }}>
                  Sending as {selectedAgent.name}
                  {selectedAgent.phone_number !== 'TBD' ? ` from ${formatPhone(selectedAgent.phone_number)}` : ' (no number yet)'}
                </span>
              </div>
            )}
            {sendsAsSelf && (
              <div style={{ ...S.note, color: '#f59e0b' }}>
                Photos & scheduled sends always go from your own number.
              </div>
            )}
          </div>

          {/* To */}
          <div style={{ ...S.field, position: 'relative' }}>
            <label style={{ ...S.label, color: C.textMuted }}>TO</label>
            <input
              ref={toRef}
              style={{
                ...S.input,
                background: C.inputBg,
                border: `1px solid ${C.inputBorder}`,
                color: C.text,
              }}
              placeholder="Phone number or contact name…"
              value={toNumber}
              onChange={e => { setToNumber(e.target.value); setError('') }}
              onFocus={() => toSearch.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && toSearch.length > 0 && (
              <div style={{ ...S.dropdown, background: C.panel, border: `1px solid ${C.border}` }}>
                {toSearch.map((c, i) => (
                  <div
                    key={i}
                    style={{ ...S.dropItem, color: C.text }}
                    onMouseDown={() => pickContact(c)}
                  >
                    <div style={S.dropName}>{c.name || formatPhone(c.number)}</div>
                    {c.name && <div style={{ ...S.dropNum, color: C.textSec }}>{formatPhone(c.number)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Message */}
          <div style={S.field}>
            <label style={{ ...S.label, color: C.textMuted }}>MESSAGE</label>
            <textarea
              style={{
                ...S.textarea,
                background: C.inputBg,
                border: `1px solid ${C.inputBorder}`,
                color: C.text,
              }}
              placeholder="Type your message…"
              value={message}
              onChange={e => { setMessage(e.target.value); setError('') }}
              rows={5}
            />
            <div style={{ ...S.charCount, color: C.textMuted }}>
              {message.length} / 160 characters
              {message.length > 160 && ' (will send as multiple SMS)'}
            </div>
          </div>

          {/* Attachment previews */}
          {hasMedia && (
            <div style={S.attachRow}>
              {attachments.map(a => (
                <div key={a.id} style={{ ...S.attachChip, border: `1px solid ${C.border}` }}>
                  <img src={a.previewUrl} alt={a.name} style={S.attachThumb} />
                  <button
                    style={S.attachRemove}
                    title="Remove"
                    onClick={() => removeAttachment(a.id)}
                  >✕</button>
                </div>
              ))}
              {uploading && <span style={{ ...S.note, color: C.textMuted }}>Uploading…</span>}
            </div>
          )}

          {/* Schedule picker */}
          {showSchedule && (
            <div style={S.scheduleRow}>
              <label style={{ ...S.label, color: C.textMuted }}>SEND AT</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="datetime-local"
                  style={{
                    ...S.input,
                    background: C.inputBg,
                    border: `1px solid ${C.inputBorder}`,
                    color: C.text,
                    flex: 1,
                  }}
                  value={scheduleAt}
                  onChange={e => { setScheduleAt(e.target.value); setError('') }}
                />
                <button
                  style={{ ...S.closeBtn, color: C.textMuted }}
                  title="Cancel scheduling"
                  onClick={() => { setShowSchedule(false); setScheduleAt('') }}
                >✕</button>
              </div>
            </div>
          )}

          {error && <div style={S.error}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ ...S.footer, borderTop: `1px solid ${C.border}` }}>
          <button style={{ ...S.cancelBtn, color: C.textSec }} onClick={onClose}>
            Cancel
          </button>
          <div style={S.sendGroup}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleFilePicked}
            />
            <button
              style={{ ...S.iconBtn, color: C.textMuted, border: `1px solid ${C.border}` }}
              title="Attach photo (MMS)"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
            >
              <PaperclipIcon />
            </button>
            <button
              style={{
                ...S.iconBtn,
                color: showSchedule ? '#3b82f6' : C.textMuted,
                border: `1px solid ${showSchedule ? '#3b82f6' : C.border}`,
              }}
              title="Schedule send"
              onClick={() => (showSchedule ? (setShowSchedule(false), setScheduleAt('')) : openSchedule())}
              disabled={sending}
            >
              <ScheduleIcon />
            </button>
            <button
              style={{ ...S.sendBtn, opacity: sending || !canSend ? 0.6 : 1 }}
              onClick={handleSend}
              disabled={!canSend}
            >
              {sending ? (wantSchedule ? 'Scheduling…' : 'Sending…') : (wantSchedule ? 'Schedule' : 'Send')}
              {!sending && (wantSchedule ? <ScheduleIcon /> : <SendArrow />)}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Icons ───────────────────────────────────────────────────────── */
function ComposeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}
function SendArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}
function ScheduleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

/* ── Styles ──────────────────────────────────────────────────────── */
const S = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 1000,
  },
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
    padding: '14px 16px',
  },
  headerTitle: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 14, fontWeight: 700,
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 14, padding: 4, lineHeight: 1,
  },

  body: { padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' },

  field:  { display: 'flex', flexDirection: 'column', gap: 5 },
  label:  { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 },
  note:   { fontSize: 11, marginTop: 2 },

  select: {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    fontSize: 13, outline: 'none', appearance: 'auto',
  },
  senderPill: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 },
  senderDot:  { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },

  input: {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    fontSize: 13, outline: 'none', resize: 'vertical',
    fontFamily: 'inherit', lineHeight: 1.5,
    boxSizing: 'border-box', minHeight: 100,
  },
  charCount: { fontSize: 10, textAlign: 'right', marginTop: -2 },

  attachRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  attachChip: {
    position: 'relative', borderRadius: 8, overflow: 'hidden',
    width: 56, height: 56, flexShrink: 0,
  },
  attachThumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  attachRemove: {
    position: 'absolute', top: 2, right: 2,
    width: 18, height: 18, borderRadius: '50%',
    background: 'rgba(0,0,0,0.65)', color: 'white',
    border: 'none', cursor: 'pointer', fontSize: 10, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  scheduleRow: { display: 'flex', flexDirection: 'column', gap: 5 },

  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0,
    borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
    zIndex: 10, overflow: 'hidden',
  },
  dropItem: {
    padding: '9px 12px', cursor: 'pointer',
    fontSize: 13, transition: 'background 0.1s',
  },
  dropName: { fontWeight: 600 },
  dropNum:  { fontSize: 11, marginTop: 2 },

  error: {
    background: '#fff1f1', border: '1px solid #fecaca',
    borderRadius: 7, padding: '8px 12px',
    fontSize: 12, color: '#dc2626',
  },

  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px',
  },
  cancelBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  sendGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 8,
    background: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  sendBtn: {
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '9px 18px', borderRadius: 8, border: 'none',
    background: '#3b82f6', color: 'white',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
}
