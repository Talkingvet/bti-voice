/* Chat thread panel — compact Zoho-style, with Notes tab + Canned Responses */
import { useState, useRef, useEffect, useCallback } from 'react'
import { api } from '../api'
import { displayName } from '../utils/phone'
import { useColors } from '../useColors'
import { useToast } from './Toast'

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

export default function ChatPanel({ conv, messages, loading, currentAgent, agents, onSend, onBack, device, onCallStart, onCallEnd, onAssign }) {
  const C = useColors()
  const { toast } = useToast()
  const [activeTab,    setActiveTab]   = useState('messages') // 'messages' | 'notes'
  const [body,         setBody]        = useState('')
  const [sending,      setSending]     = useState(false)
  const [callStatus,   setCallStatus]  = useState(null)
  const [cannedList,   setCannedList]  = useState([])
  const [showCanned,   setShowCanned]  = useState(false)
  const [cannedQuery,  setCannedQuery] = useState('')
  const [showAssign,   setShowAssign]  = useState(false)

  // MMS attachments state — [{ id, content_type, previewUrl, name }]
  const [attachments, setAttachments] = useState([])
  const [uploading,   setUploading]   = useState(false)
  const fileInputRef = useRef(null)

  // Scheduled SMS state
  const [scheduled,    setScheduled]    = useState([])
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleAt,   setScheduleAt]   = useState('')
  const [scheduling,   setScheduling]   = useState(false)

  // Zoho profile state
  const [zohoProfile,   setZohoProfile]  = useState(null)
  const [zohoLoading,   setZohoLoading]  = useState(false)
  const [showZoho,      setShowZoho]     = useState(true)

  // Notes state
  const [notes,       setNotes]       = useState([])
  const [noteBody,    setNoteBody]    = useState('')
  const [savingNote,  setSavingNote]  = useState(false)
  const [editingNote, setEditingNote] = useState(null) // { id, body }

  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)
  const noteRef        = useRef(null)
  const assignRef      = useRef(null)

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Close assign dropdown on outside click
  useEffect(() => {
    if (!showAssign) return
    function handle(e) {
      if (assignRef.current && !assignRef.current.contains(e.target)) setShowAssign(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showAssign])

  // Load canned responses once
  useEffect(() => {
    api.cannedResponses().then(setCannedList).catch(console.error)
  }, [])

  // Load notes when conversation changes
  useEffect(() => {
    if (!conv) return
    setNotes([])
    api.notes(conv.id).then(setNotes).catch(console.error)
  }, [conv?.id])

  // Load Zoho profile when conversation changes
  useEffect(() => {
    if (!conv?.contact_id) return
    setZohoProfile(null)
    setZohoLoading(true)
    api.zohoProfile(conv.contact_id)
      .then(p => setZohoProfile(p))
      .catch(() => setZohoProfile(null))
      .finally(() => setZohoLoading(false))
  }, [conv?.contact_id])

  // ── Canned responses: show dropdown when user types /
  function handleBodyChange(e) {
    const val = e.target.value
    setBody(val)
    const lastSlash = val.lastIndexOf('/')
    if (lastSlash !== -1 && lastSlash === val.length - 1) {
      setShowCanned(true)
      setCannedQuery('')
    } else if (showCanned && lastSlash !== -1) {
      setCannedQuery(val.slice(lastSlash + 1))
    } else {
      setShowCanned(false)
      setCannedQuery('')
    }
  }

  function insertCanned(cr) {
    const lastSlash = body.lastIndexOf('/')
    const newBody = lastSlash !== -1 ? body.slice(0, lastSlash) + cr.body : cr.body
    setBody(newBody)
    setShowCanned(false)
    setCannedQuery('')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const filteredCanned = cannedList.filter(cr =>
    !cannedQuery || cr.name.toLowerCase().includes(cannedQuery.toLowerCase())
  )

  // ── Outbound call from chat
  async function handleCallClick() {
    if (!device || !conv) return
    const raw    = conv.contact_number || ''
    const digits = raw.replace(/\D/g, '')
    const to     = digits.length === 10 ? `+1${digits}` : `+${digits}`
    if (!to || to === '+') return
    setCallStatus('connecting')
    try {
      const call = await device.connect({ params: { To: to } })
      call.on('accept',     () => { onCallStart?.(call, to); setCallStatus(null) })
      call.on('disconnect', () => { onCallEnd?.();            setCallStatus(null) })
      call.on('cancel',     () => { onCallEnd?.();            setCallStatus(null) })
      call.on('error',  err => { console.error('[ChatPanel call error]', err); onCallEnd?.(); setCallStatus(null) })
    } catch (e) {
      console.error('[ChatPanel] device.connect failed', e)
      setCallStatus(null)
    }
  }

  // ── Scheduled SMS
  useEffect(() => {
    if (!conv?.id) { setScheduled([]); return }
    api.scheduledMessages(conv.id).then(setScheduled).catch(() => {})
  }, [conv?.id, messages.length])

  function openSchedule() {
    // Default: one hour from now, rounded to next 15 min, in datetime-local format
    const d = new Date(Date.now() + 60 * 60 * 1000)
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
    const pad = n => String(n).padStart(2, '0')
    setScheduleAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
    setShowSchedule(true)
  }

  async function handleSchedule() {
    if (!body.trim() || !scheduleAt || scheduling) return
    setScheduling(true)
    try {
      await api.scheduleMessage(conv.id, body.trim(), new Date(scheduleAt).toISOString())
      setBody('')
      setShowSchedule(false)
      const list = await api.scheduledMessages(conv.id)
      setScheduled(list)
      toast.success('Message scheduled')
    } catch (e) {
      toast.error('Schedule failed: ' + e.message)
    }
    setScheduling(false)
  }

  async function cancelScheduled(id) {
    try {
      await api.cancelScheduledMessage(id)
      setScheduled(s => s.filter(x => x.id !== id))
    } catch (e) {
      toast.error('Cancel failed: ' + e.message)
    }
  }

  // ── MMS attachments
  async function handleFilePicked(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-picking the same file
    for (const file of files) {
      if (!file.type.startsWith('image/')) { toast.error('Only images are supported'); continue }
      if (file.size > 5 * 1024 * 1024) { toast.error(`${file.name} is over the 5 MB MMS limit`); continue }
      setUploading(true)
      try {
        const mm = await api.uploadMedia(file)
        setAttachments(a => [...a, { ...mm, previewUrl: URL.createObjectURL(file), name: file.name }])
      } catch (err) {
        toast.error('Upload failed: ' + err.message)
      }
      setUploading(false)
    }
  }

  function removeAttachment(id) {
    setAttachments(a => a.filter(x => x.id !== id))
  }

  // ── SMS send
  async function handleSend(e) {
    e?.preventDefault()
    if ((!body.trim() && attachments.length === 0) || sending) return
    setSending(true)
    await onSend(body.trim(), attachments.map(a => a.id))
    setBody('')
    setAttachments([])
    setSending(false)
    setShowCanned(false)
    textareaRef.current?.focus()
  }
  function handleKeyDown(e) {
    if (showCanned) {
      if (e.key === 'Escape') { setShowCanned(false); return }
      return // let dropdown handle arrow keys naturally
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── Notes
  async function handleSaveNote() {
    if (!noteBody.trim() || savingNote) return
    setSavingNote(true)
    try {
      if (editingNote) {
        const updated = await api.updateNote(conv.id, editingNote.id, noteBody.trim())
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n))
        setEditingNote(null)
        toast.success('Note updated')
      } else {
        const created = await api.addNote(conv.id, noteBody.trim())
        setNotes(prev => [...prev, created])
        toast.success('Note saved')
      }
      setNoteBody('')
    } catch (e) {
      toast.error('Failed to save note: ' + e.message)
    } finally {
      setSavingNote(false)
    }
  }

  async function handleDeleteNote(noteId) {
    try {
      await api.deleteNote(conv.id, noteId)
      setNotes(prev => prev.filter(n => n.id !== noteId))
      toast.success('Note deleted')
    } catch (e) {
      toast.error('Failed to delete note: ' + e.message)
    }
  }

  function startEditNote(note) {
    setEditingNote(note)
    setNoteBody(note.body)
    setTimeout(() => noteRef.current?.focus(), 0)
  }

  function cancelEdit() {
    setEditingNote(null)
    setNoteBody('')
  }

  if (!conv) {
    return (
      <div style={{ ...styles.empty, background: C.msgBg, color: C.emptyText }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>💬</div>
        <p style={{ fontSize: 13 }}>Select a conversation to start</p>
      </div>
    )
  }

  const warning        = doubleTextWarning(messages, currentAgent)
  const items          = groupByDate(messages)
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
                    <span key={a.id} title={a.name} style={{ ...styles.agentDot, background: a.color }} />
                  ))}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Messages / Notes toggle */}
          <div style={{ ...styles.tabToggle, background: C.surface, border: `1px solid ${C.border}` }}>
            <button
              style={{ ...styles.tabBtn, ...(activeTab === 'messages' ? { ...styles.tabBtnActive, background: C.panel } : { color: C.textMuted }) }}
              onClick={() => setActiveTab('messages')}
            >Messages</button>
            <button
              style={{ ...styles.tabBtn, ...(activeTab === 'notes' ? { ...styles.tabBtnActive, background: C.panel } : { color: C.textMuted }), position: 'relative' }}
              onClick={() => setActiveTab('notes')}
            >
              Notes
              {notes.length > 0 && (
                <span style={styles.noteBadge}>{notes.length}</span>
              )}
            </button>
          </div>

          {/* Assign button */}
          <div ref={assignRef} style={{ position: 'relative' }}>
            <button
              style={{
                ...styles.iconBtn,
                color: conv?.assigned_agent_id ? (agents.find(a => a.id === conv.assigned_agent_id)?.color || '#4f9cf9') : C.textMuted,
                background: conv?.assigned_agent_id ? 'rgba(79,156,249,0.10)' : 'transparent',
              }}
              onClick={() => setShowAssign(v => !v)}
              title={conv?.assigned_agent_name ? `Assigned to ${conv.assigned_agent_name}` : 'Assign conversation'}
            >
              <PersonIcon />
            </button>
            {showAssign && (
              <div style={{ ...styles.assignDropdown, background: C.panel, border: `1px solid ${C.border}`, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
                <div style={{ ...styles.assignHeader, color: C.textMuted }}>Assign to</div>
                {conv?.assigned_agent_id && (
                  <button
                    style={{ ...styles.assignItem, color: '#ef4444' }}
                    onClick={() => { onAssign?.(conv.id, null); setShowAssign(false) }}
                  >
                    <span style={{ ...styles.assignDot, background: '#ef4444' }} />
                    Unassign
                  </button>
                )}
                {agents.map(a => (
                  <button
                    key={a.id}
                    style={{
                      ...styles.assignItem,
                      color: C.text,
                      background: conv?.assigned_agent_id === a.id ? 'rgba(79,156,249,0.12)' : 'transparent',
                    }}
                    onClick={() => { onAssign?.(conv.id, a.id); setShowAssign(false) }}
                  >
                    <span style={{ ...styles.assignDot, background: a.color || '#8b96ab' }} />
                    {a.name}
                    {a.id === currentAgent.id && <span style={{ opacity: 0.5, fontSize: 10, marginLeft: 3 }}>(you)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            style={{ ...styles.iconBtn, color: callStatus ? '#f59e0b' : '#22c55e', opacity: callStatus ? 0.7 : 1 }}
            onClick={handleCallClick}
            disabled={!!callStatus || !device}
            title={callStatus ? 'Connecting…' : 'Call'}
          >
            <PhoneIcon />
          </button>
        </div>
      </div>

      {/* ── Zoho CRM Panel ── */}
      <ZohoPanel profile={zohoProfile} loading={zohoLoading} open={showZoho} onToggle={() => setShowZoho(v => !v)} C={C} />

      {/* ── Messages tab ── */}
      {activeTab === 'messages' && (
        <>
          {warning && (
            <div style={styles.warning}>
              ⚠ <strong>{warning.agent_name}</strong> already texted this contact at {formatTime(warning.sent_at)}
            </div>
          )}
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
          {/* Compose */}
          <div style={{ ...styles.compose, background: C.panel, borderTop: `1px solid ${C.border}`, position: 'relative' }}>
            <div style={{ ...styles.fromHint, color: C.textMuted }}>
              <span style={{ ...styles.fromDot, background: currentAgent.color }} />
              {currentAgent.name}
              {currentAgent.phone_number !== 'TBD' && (
                <span style={{ marginLeft: 4, opacity: 0.7 }}>{currentAgent.phone_number}</span>
              )}
            </div>
            {/* Canned responses dropdown */}
            {showCanned && filteredCanned.length > 0 && (
              <div style={{ ...styles.cannedDropdown, background: C.panel, border: `1px solid ${C.border}`, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
                {filteredCanned.map(cr => (
                  <button
                    key={cr.id}
                    style={{ ...styles.cannedItem, color: C.text }}
                    onMouseDown={() => insertCanned(cr)}
                  >
                    <span style={{ ...styles.cannedName, color: '#4f9cf9' }}>{cr.name}</span>
                    <span style={{ ...styles.cannedPreview, color: C.textMuted }}>{cr.body}</span>
                  </button>
                ))}
              </div>
            )}
            {conv?.opted_out ? (
              <div style={{ ...styles.composeRow, justifyContent: 'center', alignItems: 'center', padding: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, color: '#ef4444', fontSize: 12.5, fontWeight: 600, textAlign: 'center' }}>
                This contact opted out of SMS (replied STOP). Messaging is blocked until they text START.
              </div>
            ) : (<>
            {scheduled.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
                {scheduled.map(sm => (
                  <div key={sm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '5px 10px', borderRadius: 8, background: sm.status === 'failed' ? 'rgba(239,68,68,0.10)' : 'rgba(79,156,249,0.10)', border: `1px solid ${sm.status === 'failed' ? 'rgba(239,68,68,0.4)' : 'rgba(79,156,249,0.4)'}`, color: C.text }}>
                    <ClockIcon size={13} />
                    <span style={{ fontWeight: 600, flexShrink: 0, color: sm.status === 'failed' ? '#ef4444' : '#4f9cf9' }}>
                      {sm.status === 'failed' ? `Failed: ${sm.error || 'unknown error'}` : new Date(sm.send_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textMuted }}>{sm.body}</span>
                    <button
                      onClick={() => cancelScheduled(sm.id)}
                      title="Cancel scheduled message"
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 14, lineHeight: 1, padding: 2 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
            {showSchedule && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '8px 10px', borderRadius: 8, background: C.inputBg, border: `1px solid ${C.inputBorder}` }}>
                <span style={{ fontSize: 12, color: C.textMuted, flexShrink: 0 }}>Send at</span>
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={e => setScheduleAt(e.target.value)}
                  style={{ background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text, borderRadius: 6, padding: '4px 8px', fontSize: 12, fontFamily: 'inherit' }}
                />
                <button
                  onClick={handleSchedule}
                  disabled={scheduling || !body.trim()}
                  style={{ background: '#4f9cf9', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: scheduling || !body.trim() ? 0.4 : 1 }}
                >{scheduling ? 'Scheduling…' : 'Schedule'}</button>
                <button
                  onClick={() => setShowSchedule(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 12 }}
                >Cancel</button>
                {!body.trim() && <span style={{ fontSize: 11, color: C.textMuted }}>Type the message first</span>}
              </div>
            )}
            {attachments.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                {attachments.map(a => (
                  <div key={a.id} style={{ position: 'relative' }}>
                    <img src={a.previewUrl} alt={a.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: `1px solid ${C.inputBorder}` }} />
                    <button
                      onClick={() => removeAttachment(a.id)}
                      title="Remove attachment"
                      style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
            <div style={styles.composeRow}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilePicked}
                style={{ display: 'none' }}
              />
              <button
                style={{ ...styles.sendBtn, background: 'transparent', border: `1px solid ${C.inputBorder}`, opacity: uploading ? 0.4 : 0.7 }}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Attach image"
              >
                <PaperclipIcon size={16} />
              </button>
              <textarea
                ref={textareaRef}
                style={{ ...styles.textarea, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
                placeholder="Enter a message — type / for quick replies"
                value={body}
                onChange={handleBodyChange}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button
                style={{ ...styles.sendBtn, background: 'transparent', border: `1px solid ${C.inputBorder}`, opacity: showSchedule ? 1 : 0.7 }}
                onClick={() => showSchedule ? setShowSchedule(false) : openSchedule()}
                title="Schedule for later"
              >
                <ClockIcon size={17} />
              </button>
              <button
                style={{ ...styles.sendBtn, opacity: sending || (!body.trim() && attachments.length === 0) ? 0.4 : 1 }}
                onClick={handleSend}
                disabled={sending || (!body.trim() && attachments.length === 0)}
                title="Send"
              >
                <SendIcon />
              </button>
            </div>
            </>)}
          </div>
        </>
      )}

      {/* ── Notes tab ── */}
      {activeTab === 'notes' && (
        <div style={{ ...styles.notesPanel, background: C.msgBg }}>
          {/* Notes list */}
          <div style={styles.notesList}>
            {notes.length === 0 && (
              <div style={{ ...styles.notesEmpty, color: C.textMuted }}>
                <NoteIcon />
                <div style={{ marginTop: 8 }}>No notes yet</div>
                <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>Internal notes are only visible to your team</div>
              </div>
            )}
            {notes.map(note => (
              <div key={note.id} style={{ ...styles.noteCard, background: C.panel, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...styles.noteDot, background: note.agent_color || '#4f9cf9' }} />
                    <span style={{ ...styles.noteAgent, color: C.textSec }}>{note.agent_name}</span>
                    <span style={{ ...styles.noteTime, color: C.textMuted }}>{formatTime(note.created_at)}</span>
                  </div>
                  {note.agent_id === currentAgent.id && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button style={{ ...styles.noteAction, color: C.textMuted }} onClick={() => startEditNote(note)} title="Edit">✏️</button>
                      <button style={{ ...styles.noteAction, color: '#ef4444' }} onClick={() => handleDeleteNote(note.id)} title="Delete">🗑</button>
                    </div>
                  )}
                </div>
                <div style={{ ...styles.noteBody, color: C.text }}>{note.body}</div>
              </div>
            ))}
          </div>
          {/* Note compose */}
          <div style={{ ...styles.noteCompose, background: C.panel, borderTop: `1px solid ${C.border}` }}>
            {editingNote && (
              <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>
                Editing note · <button style={styles.cancelEdit} onClick={cancelEdit}>Cancel</button>
              </div>
            )}
            <div style={styles.composeRow}>
              <textarea
                ref={noteRef}
                style={{ ...styles.textarea, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
                placeholder="Add an internal note…"
                value={noteBody}
                onChange={e => setNoteBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveNote() } }}
                rows={1}
              />
              <button
                style={{ ...styles.sendBtn, background: '#f59e0b', opacity: savingNote || !noteBody.trim() ? 0.4 : 1 }}
                onClick={handleSaveNote}
                disabled={savingNote || !noteBody.trim()}
                title="Save note"
              >
                <SaveIcon />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────── */
function MsgMedia({ media }) {
  const C = useColors()
  const { toast } = useToast()
  const [menu, setMenu] = useState(null) // { x, y, mm }

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  if (!media?.length) return null

  async function fetchBlob(mm) {
    const res = await fetch(api.mediaUrl(mm.id))
    if (!res.ok) throw new Error('Failed to load image')
    return res.blob()
  }

  async function saveImage(mm) {
    try {
      const blob = await fetchBlob(mm)
      const rawExt = (mm.content_type || 'image/jpeg').split('/')[1]?.split('+')[0] || 'jpg'
      const ext = rawExt === 'jpeg' ? 'jpg' : rawExt
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `bti-voice-image-${mm.id}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch (e) {
      toast.error('Save failed: ' + e.message)
    }
  }

  function toPngBlob(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        URL.revokeObjectURL(img.src)
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Conversion failed'))), 'image/png')
      }
      img.onerror = () => reject(new Error('Could not decode image'))
      img.src = URL.createObjectURL(blob)
    })
  }

  // Fallback: select the rendered image and use the legacy copy command.
  // Works in Electron even when the async Clipboard API permission is denied.
  async function copyViaSelection(mm) {
    const div = document.createElement('div')
    div.contentEditable = 'true'
    Object.assign(div.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' })
    const img = document.createElement('img')
    img.src = api.mediaUrl(mm.id)
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = () => rej(new Error('Could not load image'))
    })
    div.appendChild(img)
    document.body.appendChild(div)
    try {
      const range = document.createRange()
      range.selectNode(img)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      const ok = document.execCommand('copy')
      sel.removeAllRanges()
      if (!ok) throw new Error('Clipboard blocked')
    } finally {
      div.remove()
    }
  }

  function copyImage(mm) {
    // Call clipboard.write synchronously within the click gesture, passing a
    // Promise payload — waiting for the fetch first loses the gesture and
    // triggers "Write permission denied" in the Electron shell.
    try {
      const pngPromise = fetchBlob(mm).then(toPngBlob)
      const item = new ClipboardItem({ 'image/png': pngPromise })
      navigator.clipboard.write([item]).then(
        () => toast.success('Image copied to clipboard'),
        async () => {
          try {
            await copyViaSelection(mm)
            toast.success('Image copied to clipboard')
          } catch (e2) {
            toast.error('Copy failed: ' + e2.message)
          }
        }
      )
    } catch {
      copyViaSelection(mm)
        .then(() => toast.success('Image copied to clipboard'))
        .catch(e2 => toast.error('Copy failed: ' + e2.message))
    }
  }

  function openMenu(e, mm) {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 96),
      mm,
    })
  }

  const menuItem = {
    display: 'block', width: '100%', textAlign: 'left', background: 'none',
    border: 'none', cursor: 'pointer', padding: '7px 12px', fontSize: 12.5,
    color: C.text, borderRadius: 6, fontFamily: 'inherit',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: msgMediaGap(media) }}>
      {media.filter(mm => (mm.content_type || '').startsWith('image/')).map(mm => (
        <a key={mm.id} href={api.mediaUrl(mm.id)} target="_blank" rel="noreferrer" onContextMenu={e => openMenu(e, mm)}>
          <img
            src={api.mediaUrl(mm.id)}
            alt="attachment"
            style={{ maxWidth: 220, maxHeight: 220, borderRadius: 10, display: 'block', cursor: 'pointer' }}
            loading="lazy"
          />
        </a>
      ))}
      {menu && (
        <div
          style={{
            position: 'fixed', top: menu.y, left: menu.x, zIndex: 2000,
            background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
            padding: 4, minWidth: 150, boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            style={menuItem}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(79,156,249,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={() => { copyImage(menu.mm); setMenu(null) }}
          >Copy image</button>
          <button
            style={menuItem}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(79,156,249,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            onClick={() => { saveImage(menu.mm); setMenu(null) }}
          >Save image…</button>
        </div>
      )}
    </div>
  )
}
function msgMediaGap(media) {
  return media?.length ? 4 : 0
}

function InboundMsg({ msg, conv, C }) {
  return (
    <div style={styles.msgGroup}>
      <div style={{ ...styles.bubbleIn, background: C.bubbleIn, border: `1px solid ${C.bubbleInBorder}`, color: C.text }}>
        <MsgMedia media={msg.media} />
        <div>{msg.body}</div>
        <div style={{ ...styles.bubbleMeta, color: C.textMuted }}>
          {displayName(conv.contact_name, msg.from_number)} · {formatTime(msg.sent_at)}
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
        <MsgMedia media={msg.media} />
        <div>{msg.body}</div>
        <div style={styles.bubbleMetaOut}>
          {msg.agent_name ? <>Sent By {msg.agent_name}{isMe ? ' (you)' : ''}</> : 'Automated'} · {formatTime(msg.sent_at)}
        </div>
      </div>
    </div>
  )
}

/* ── Zoho CRM Context Panel ─────────────────────────────────────── */
function ZohoPanel({ profile, loading, open, onToggle, C }) {
  // Don't render anything if still loading and no prior profile
  if (!loading && !profile) return null
  if (!loading && profile && !profile.type) return null

  function fmtDate(str) {
    if (!str) return '—'
    return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  function fmtMoney(n) {
    if (!n) return null
    return '$' + Number(n).toLocaleString()
  }

  const stageColor = (stage) => {
    if (!stage) return '#8b96ab'
    const s = stage.toLowerCase()
    if (s.includes('closed won') || s.includes('won')) return '#22c55e'
    if (s.includes('closed lost') || s.includes('lost')) return '#ef4444'
    if (s.includes('proposal') || s.includes('negotiat')) return '#f59e0b'
    if (s.includes('qualify') || s.includes('prospect')) return '#0ea5e9'
    return '#8b96ab'
  }

  const typeLabel = profile?.type === 'lead' ? 'Lead' : profile?.type === 'contact' ? 'Contact' : null

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, background: C.panel }}>
      {/* Toggle header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', border: 'none', background: 'transparent',
          cursor: 'pointer', color: C.textMuted, fontSize: 11, fontWeight: 600,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ZohoIcon />
          ZOHO CRM
          {loading && <span style={{ opacity: 0.5, fontWeight: 400 }}>loading…</span>}
          {!loading && typeLabel && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
              background: profile.type === 'lead' ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
              color: profile.type === 'lead' ? '#f59e0b' : '#22c55e',
            }}>{typeLabel}</span>
          )}
        </span>
        <span style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
      </button>

      {/* Content */}
      {open && !loading && profile?.type && (
        <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>

          {/* Row 1: ID + status/stage */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {profile.zoho_id && (
              <ZField label="Zoho ID" value={profile.zoho_id} mono />
            )}
            {profile.lead_status && (
              <ZField label="Status" value={profile.lead_status} />
            )}
            {profile.contact_stage && (
              <ZField label="Stage" value={profile.contact_stage} />
            )}
          </div>

          {/* Row 2: account + type + source */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {profile.account_name && (
              <ZField label="Account" value={profile.account_name} />
            )}
            {profile.account_type && (
              <ZField label="Type" value={profile.account_type} />
            )}
            {profile.lead_source && (
              <ZField label="Source" value={profile.lead_source} />
            )}
          </div>

          {/* Row 2: last activity + created */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ZField label="Last Activity" value={fmtDate(profile.last_activity)} />
            <ZField label="Created" value={fmtDate(profile.created_at)} />
          </div>

          {/* Deals */}
          {profile.deals?.length > 0 && (
            <div style={{ marginTop: 2 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Deals ({profile.deals.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {profile.deals.slice(0, 3).map(deal => (
                  <a
                    key={deal.id}
                    href={deal.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '5px 8px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.04)', textDecoration: 'none',
                      border: `1px solid ${C.borderSoft}`,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{deal.name || 'Unnamed Deal'}</span>
                      <span style={{ fontSize: 10, color: C.textMuted }}>Closes {fmtDate(deal.closing_date)}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                        background: stageColor(deal.stage) + '22',
                        color: stageColor(deal.stage),
                      }}>{deal.stage || '—'}</span>
                      {deal.amount && (
                        <span style={{ fontSize: 10, color: C.textMuted }}>{fmtMoney(deal.amount)}</span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Open in Zoho link */}
          {profile.zoho_url && (
            <a
              href={profile.zoho_url}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: '#4f9cf9', textDecoration: 'none', marginTop: 2, alignSelf: 'flex-start' }}
            >
              Open in Zoho CRM ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function ZField({ label, value, mono }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 80 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#8b96ab', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 11, color: '#d1d9e6', fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</span>
    </div>
  )
}

function ZohoIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
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
function PaperclipIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#4f9cf9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function ClockIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#4f9cf9" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
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
function SaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}
function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
function NoteIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

/* ── Styles ─────────────────────────────────────────────────────── */
const styles = {
  panel:   { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  empty:   { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },

  header:  { padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  headerMid:  { flex: 1, minWidth: 0 },
  headerName: { fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  headerSub:  { fontSize: 11, marginTop: 1, display: 'flex', alignItems: 'center' },
  agentDot:   { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginLeft: 3 },
  iconBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8, flexShrink: 0 },

  tabToggle: { display: 'flex', borderRadius: 8, padding: 2, gap: 2 },
  tabBtn: { fontSize: 11, fontWeight: 600, border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4 },
  tabBtnActive: { color: '#4f9cf9' },
  noteBadge: { background: '#f59e0b', color: 'white', fontSize: 9, fontWeight: 700, borderRadius: 8, padding: '1px 5px', marginLeft: 2 },

  warning: { background: '#fffbeb', borderBottom: '1px solid #fcd34d', padding: '7px 12px', fontSize: 12, color: '#92400e', flexShrink: 0 },

  messages: { flex: 1, overflowY: 'auto', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 },
  loadingMsg: { textAlign: 'center', fontSize: 12 },
  datePill: { alignSelf: 'center', padding: '3px 12px', borderRadius: 12, fontSize: 11, fontWeight: 600, margin: '4px 0' },
  msgGroup:  { display: 'flex', flexDirection: 'column' },
  bubbleIn: { alignSelf: 'flex-start', maxWidth: 'min(85%, 520px)', padding: '9px 12px', borderRadius: '4px 14px 14px 14px', fontSize: 13, lineHeight: 1.45 },
  bubbleOut: { alignSelf: 'flex-end', maxWidth: 'min(85%, 520px)', padding: '9px 12px', borderRadius: '14px 4px 14px 14px', color: 'white', fontSize: 13, lineHeight: 1.45 },
  bubbleMeta:    { fontSize: 10, marginTop: 4 },
  bubbleMetaOut: { fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  compose: { padding: '8px 10px', flexShrink: 0 },
  fromHint: { fontSize: 10, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6, fontWeight: 500 },
  fromDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  cannedHint: { fontSize: 10, opacity: 0.5, marginLeft: 2 },
  composeRow: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  textarea: { flex: 1, borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.4, minHeight: 38, maxHeight: 100 },
  sendBtn: { width: 38, height: 38, borderRadius: 10, background: '#4f9cf9', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'opacity 0.15s' },

  assignDropdown: { position: 'absolute', top: 'calc(100% + 4px)', right: 0, minWidth: 170, borderRadius: 10, zIndex: 200, overflow: 'hidden' },
  assignHeader:   { padding: '7px 12px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' },
  assignItem:     { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, textAlign: 'left', transition: 'background 0.08s' },
  assignDot:      { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },

  cannedDropdown: { position: 'absolute', bottom: '100%', left: 10, right: 10, borderRadius: 10, overflow: 'hidden', zIndex: 100, maxHeight: 200, overflowY: 'auto' },
  cannedItem: { width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 },
  cannedName: { fontSize: 11, fontWeight: 700 },
  cannedPreview: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  notesPanel: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
  notesList: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  notesEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', fontSize: 13 },
  noteCard: { borderRadius: 10, padding: '10px 12px' },
  noteDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'inline-block' },
  noteAgent: { fontSize: 11, fontWeight: 600 },
  noteTime: { fontSize: 10 },
  noteBody: { fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  noteAction: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 },
  noteCompose: { padding: '8px 10px', flexShrink: 0 },
  cancelEdit: { background: 'none', border: 'none', cursor: 'pointer', color: '#f59e0b', fontWeight: 600, fontSize: 11, padding: 0 },
}
