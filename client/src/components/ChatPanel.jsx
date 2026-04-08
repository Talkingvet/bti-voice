/* Chat thread panel — compact Zoho-style, no resolve */
import { useState, useRef, useEffect } from 'react'
import CallModal from './CallModal'
import { useColors } from '../useColors'

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function formatDate(dateStr) {
  const d = new Date(dateStr), today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today - 86400000)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
function groupByDate(messages) {
  const groups = []; let lastDate = null
  for (const msg of messages) {
    const date = formatDate(msg.sent_at)
    if (date !== lastDate) { groups.push({ type: 'divider', date }); lastDate = date }
    groups.push({ type: 'message', msg })
  }
  return groups
}
function doubleTextWarning(messages, currentAgent) {
  const twoHrsAgo = Date.now() - 2 * 60 * 60 * 1000
  const recent = messages.filter(m =>
    m.direction === 'outbound' && new Date(m.sent_at) > twoHrsAgo && m.agent_id !== currentAgent.id
  )
  return recent.length > 0 ? recent[recent.length - 1] : null
}

export default function ChatPanel({ conv, messages, loading, currentAgent, agents, onSend, onCallLogged, onBack }) {
  const C = useColors()
  const [body,     setBody]     = useState('')
  const [sending,  setSending]  = useState(false)
  const [showCall, setShowCall] = useState(false)
  const messagesEndRef           = useRef(null)
  const textareaRef              = useRef(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function handleSend(e) {
    e?.preventDefault()
    if (!body.trim() || sending) return
    setSending(true)
    await onSend(body.trim())
    setBody('')
    setSending(false)
    textareaRef.current?.focus()
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  if (!conv) {
    return (
      <div style={{ ...styles.empty, background: C.msgBg, color: C.emptyText }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>💬</div>
        <p style={{ fontSize: 13 }}>Select a conversation to start</p>
      </div>
    )
  }

  const warning      = doubleTextWarning(messages, currentAgent)
  const items        = groupByDate(messages)
  const agentsInvolved = conv.agents_involved || []

  return (
    <div style={{ ...styles.panel, background: C.bg }}>

      {/* ── Header ── */}
      <div style={{ ...styles.header, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <div style={styles.headerLeft}>
          {onBack && (
            <button style={{ ...styles.iconBtn, color: C.textSec }} onClick={onBack} title="Back">
              <BackIcon />
            </button>
          )}
          <div style={styles.headerMid}>
            <div style={{ ...styles.headerName, color: C.text }}>
              {conv.contact_name || conv.contact_number}
            </div>
            <div style={{ ...styles.headerSub, color: C.textMuted }}>
              {conv.contact_number !== conv.contact_name && conv.contact_number}
              {agentsInvolved.length > 0 && (
                <span style={{ marginLeft: 6 }}>
                  {agentsInvolved.map(a => (
                    <span
                      key={a.id}
                      title={a.name}
                      style={{ ...styles.agentDot, background: a.color }}
                    />
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          style={{ ...styles.iconBtn, color: '#22c55e' }}
          onClick={() => setShowCall(true)}
          title="Call"
        >
          <PhoneIcon />
        </button>
      </div>

      {/* ── Double-text warning ── */}
      {warning && (
        <div style={styles.warning}>
          ⚠ <strong>{warning.agent_name}</strong> already texted this contact at {formatTime(warning.sent_at)}
        </div>
      )}

      {/* ── Messages ── */}
      <div style={{ ...styles.messages, background: C.msgBg }}>
        {loading && <div style={{ ...styles.loadingMsg, color: C.textMuted }}>Loading…</div>}
        {items.map((item, i) => {
          if (item.type === 'divider') {
            return (
              <div key={i} style={{ ...styles.datePill, color: C.textMuted, background: C.surface }}>
                {item.date}
              </div>
            )
          }
          const { msg } = item
          return msg.direction === 'inbound'
            ? <InboundMsg  key={msg.id} msg={msg} conv={conv} C={C} />
            : <OutboundMsg key={msg.id} msg={msg} currentAgentId={currentAgent.id} C={C} />
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Compose ── */}
      <div style={{ ...styles.compose, background: C.panel, borderTop: `1px solid ${C.border}` }}>
        <div style={{ ...styles.fromHint, color: C.textMuted }}>
          <span style={{ ...styles.fromDot, background: currentAgent.color }} />
          {currentAgent.name}
          {currentAgent.phone_number !== 'TBD' && (
            <span style={{ marginLeft: 4, opacity: 0.7 }}>{currentAgent.phone_number}</span>
          )}
        </div>
        <div style={styles.composeRow}>
          <textarea
            ref={textareaRef}
            style={{ ...styles.textarea, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
            placeholder="Enter a message…"
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button
            style={{ ...styles.sendBtn, opacity: sending || !body.trim() ? 0.4 : 1 }}
            onClick={handleSend}
            disabled={sending || !body.trim()}
            title="Send"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      {showCall && (
        <CallModal conv={conv} agent={currentAgent} onClose={() => setShowCall(false)} onCallLogged={onCallLogged} />
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────── */

function InboundMsg({ msg, conv, C }) {
  return (
    <div style={styles.msgGroup}>
      <div style={{ ...styles.bubbleIn, background: C.bubbleIn, border: `1px solid ${C.bubbleInBorder}`, color: C.text }}>
        <div>{msg.body}</div>
        <div style={{ ...styles.bubbleMeta, color: C.textMuted }}>
          {conv.contact_name || msg.from_number} · {formatTime(msg.sent_at)}
        </div>
      </div>
    </div>
  )
}

function OutboundMsg({ msg, currentAgentId, C }) {
  const isMe = msg.agent_id === currentAgentId
  return (
    <div style={{ ...styles.msgGroup, alignItems: 'flex-end' }}>
      <div style={{ ...styles.bubbleOut, background: msg.agent_color || '#4f9cf9' }}>
        <div>{msg.body}</div>
        <div style={styles.bubbleMetaOut}>
          Sent By {msg.agent_name}{isMe ? ' (you)' : ''} · {formatTime(msg.sent_at)}
        </div>
      </div>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────── */
function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.58 1.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}
function SendIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

/* ── Styles ─────────────────────────────────────────────────────── */
const styles = {
  panel:   { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  empty:   { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },

  header:  {
    padding: '10px 12px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  headerMid:  { flex: 1, minWidth: 0 },
  headerName: { fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  headerSub:  { fontSize: 11, marginTop: 1, display: 'flex', alignItems: 'center' },
  agentDot:   { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginLeft: 3 },
  iconBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, border: 'none', background: 'transparent',
    cursor: 'pointer', borderRadius: 8, flexShrink: 0,
  },

  warning: {
    background: '#fffbeb', borderBottom: '1px solid #fcd34d',
    padding: '7px 12px', fontSize: 12, color: '#92400e', flexShrink: 0,
  },

  messages: {
    flex: 1, overflowY: 'auto', padding: '12px 12px',
    display: 'flex', flexDirection: 'column', gap: 10,
    minHeight: 0,
  },
  loadingMsg: { textAlign: 'center', fontSize: 12 },

  datePill: {
    alignSelf: 'center',
    padding: '3px 12px', borderRadius: 12,
    fontSize: 11, fontWeight: 600,
    margin: '4px 0',
  },

  msgGroup:  { display: 'flex', flexDirection: 'column' },
  bubbleIn: {
    alignSelf: 'flex-start', maxWidth: '85%',
    padding: '9px 12px', borderRadius: '4px 14px 14px 14px',
    fontSize: 13, lineHeight: 1.45,
  },
  bubbleOut: {
    alignSelf: 'flex-end', maxWidth: '85%',
    padding: '9px 12px', borderRadius: '14px 4px 14px 14px',
    color: 'white', fontSize: 13, lineHeight: 1.45,
  },
  bubbleMeta:    { fontSize: 10, marginTop: 4 },
  bubbleMetaOut: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  compose: { padding: '8px 10px', flexShrink: 0 },
  fromHint: {
    fontSize: 10, display: 'flex', alignItems: 'center', gap: 5,
    marginBottom: 6, fontWeight: 500,
  },
  fromDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  composeRow: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  textarea: {
    flex: 1, borderRadius: 10, padding: '8px 12px',
    fontSize: 13, outline: 'none', resize: 'none',
    fontFamily: 'inherit', lineHeight: 1.4,
    minHeight: 38, maxHeight: 100,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 10,
    background: '#4f9cf9', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'opacity 0.15s',
  },
}
