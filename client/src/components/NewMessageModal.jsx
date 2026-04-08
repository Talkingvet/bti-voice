import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import { useColors } from '../useColors'

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

  async function handleSend() {
    if (!toNumber.trim() || !message.trim()) {
      setError('Please fill in a recipient and message.')
      return
    }
    setSending(true)
    setError('')
    try {
      const result = await api.newMessage({
        to_number:     toNumber.trim(),
        from_agent_id: fromAgent,
        body:          message.trim(),
      })
      onSent?.(result.conversation_id)
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
                  {a.name}{a.phone_number !== 'TBD' ? ` · ${a.phone_number}` : ''}
                </option>
              ))}
            </select>
            {selectedAgent && (
              <div style={S.senderPill}>
                <div style={{ ...S.senderDot, background: selectedAgent.color || '#3b82f6' }} />
                <span style={{ color: C.textSec, fontSize: 11 }}>
                  Sending as {selectedAgent.name}
                  {selectedAgent.phone_number !== 'TBD' ? ` from ${selectedAgent.phone_number}` : ' (no number yet)'}
                </span>
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
                    <div style={S.dropName}>{c.name || c.number}</div>
                    {c.name && <div style={{ ...S.dropNum, color: C.textSec }}>{c.number}</div>}
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

          {error && <div style={S.error}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ ...S.footer, borderTop: `1px solid ${C.border}` }}>
          <button style={{ ...S.cancelBtn, color: C.textSec }} onClick={onClose}>
            Cancel
          </button>
          <div style={S.sendGroup}>
            {/* Schedule send placeholder */}
            <button
              style={{ ...S.scheduleBtn, background: C.surface, border: `1px solid ${C.border}`, color: C.textSec }}
              title="Schedule send (coming soon)"
              disabled
            >
              <ScheduleIcon />
            </button>
            <button
              style={{ ...S.sendBtn, opacity: sending ? 0.6 : 1 }}
              onClick={handleSend}
              disabled={sending || !toNumber.trim() || !message.trim()}
            >
              {sending ? 'Sending…' : 'Send'}
              {!sending && <SendArrow />}
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

  body: { padding: '12px 16px 8px', display: 'flex', flexDirection: 'column', gap: 14 },

  field:  { display: 'flex', flexDirection: 'column', gap: 5 },
  label:  { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 },

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
  scheduleBtn: {
    width: 36, height: 36, borderRadius: 8,
    cursor: 'not-allowed', opacity: 0.5,
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
