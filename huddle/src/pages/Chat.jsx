import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { getSocket } from '../socket'
import { Avatar, Icon, navigate, BASE_PATH } from '../ui'

// Display name for a chat: group name, or the other people's names.
export function chatTitle(chat, meId) {
  if (chat.name) return chat.name
  const others = (chat.members || []).filter(m => m.id !== meId)
  if (!others.length) return 'Just you'
  return others.map(m => m.name.split(' ')[0]).join(', ')
}

function fmtTime(iso) {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function dayLabel(iso) {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

// ── New chat / add people picker ────────────────────────────────────────────
function PeoplePicker({ title, agents, exclude = [], allowName = false, onDone, onClose, confirmLabel = 'Start chat' }) {
  const [sel, setSel] = useState([])
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const list = agents.filter(a => !exclude.includes(a.id) && a.name.toLowerCase().includes(q.toLowerCase()))
  const toggle = (id) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 'min(440px, 94vw)' }}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose}>✕</button></div>
        <div className="modal-body">
          <input className="field" placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} autoFocus style={{ margin: '10px 0' }} />
          <div className="pick-list">
            {list.map(a => (
              <label key={a.id} className={`row pick ${sel.includes(a.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={sel.includes(a.id)} onChange={() => toggle(a.id)} />
                <Avatar agent={a} status={a.status} />
                <div className="grow"><div className="name">{a.name}</div></div>
              </label>
            ))}
            {!list.length && <div className="empty">No one matches.</div>}
          </div>
          {allowName && sel.length > 1 && (
            <input className="field" placeholder="Group name (optional)" value={name} onChange={e => setName(e.target.value)} style={{ marginTop: 10 }} />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!sel.length} onClick={() => onDone(sel, name.trim())}>
              {sel.length > 1 && allowName ? `Create group (${sel.length})` : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main chat page ──────────────────────────────────────────────────────────
export default function Chat({ me, chats, setChats, activeId, agents, onToast }) {
  const [messages, setMessages] = useState([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [draft, setDraft] = useState('')
  const [picker, setPicker] = useState(null) // 'new' | 'add'
  const [typing, setTyping] = useState({})   // agentId → name
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const listRef = useRef(null)
  const bottomRef = useRef(null)
  const typingTimer = useRef(0)
  const active = chats.find(c => c.id === activeId)

  // Load history when the active chat changes; mark read.
  useEffect(() => {
    setMessages([]); setHasMore(true); setTyping({})
    if (!activeId) return
    let cancelled = false
    api.chatMessages(activeId).then(rows => {
      if (cancelled) return
      setMessages(rows); setHasMore(rows.length >= 50)
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
    }).catch(e => onToast(e.message))
    api.markRead(activeId).then(() => setChats(cs => cs.map(c => c.id === activeId ? { ...c, unread: 0 } : c))).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Live messages + typing for the open chat (list-level updates are in App).
  useEffect(() => {
    const s = getSocket()
    const onMsg = (m) => {
      if (m.chat_id !== activeId) return
      setMessages(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m])
      setTyping(t => { const n = { ...t }; delete n[m.sender_id]; return n })
      if (m.sender_id !== me.id) api.markRead(activeId).catch(() => {})
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
    }
    const onTyping = ({ chatId, agent }) => {
      if (chatId !== activeId || agent.id === me.id) return
      setTyping(t => ({ ...t, [agent.id]: agent.name }))
      setTimeout(() => setTyping(t => { const n = { ...t }; delete n[agent.id]; return n }), 3500)
    }
    s.on('chat:message', onMsg); s.on('chat:typing', onTyping)
    return () => { s.off('chat:message', onMsg); s.off('chat:typing', onTyping) }
  }, [activeId, me.id])

  async function loadOlder() {
    if (!hasMore || loadingOlder || !messages.length) return
    setLoadingOlder(true)
    const el = listRef.current, prevH = el?.scrollHeight || 0
    try {
      const rows = await api.chatMessages(activeId, messages[0].created_at)
      setMessages(ms => [...rows, ...ms]); setHasMore(rows.length >= 50)
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH })
    } catch (e) { onToast(e.message) } finally { setLoadingOlder(false) }
  }

  async function send(e) {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || !activeId) return
    setDraft('')
    try { await api.sendMessage(activeId, body) } catch (err) { onToast(err.message); setDraft(body) }
  }
  function onDraft(v) {
    setDraft(v)
    const now = Date.now()
    if (now - typingTimer.current > 2000 && activeId) { typingTimer.current = now; getSocket().emit('chat:typing', { chatId: activeId }) }
  }

  async function startChat(ids, name) {
    setPicker(null)
    try {
      const c = await api.createChat(ids.length > 1 ? 'group' : 'dm', ids, name)
      setChats(cs => cs.some(x => x.id === c.id) ? cs : [c, ...cs])
      navigate(`${BASE_PATH}/chat/${c.id}`)
    } catch (e) { onToast(e.message) }
  }
  async function addPeople(ids) {
    setPicker(null)
    try { const c = await api.addMembers(activeId, ids); setChats(cs => cs.map(x => x.id === c.id ? c : x)) } catch (e) { onToast(e.message) }
  }
  async function togglePin(chat) {
    try { const c = await api.updateChat(chat.id, { pinned: !chat.pinned }); setChats(cs => sortChats(cs.map(x => x.id === c.id ? c : x))) } catch (e) { onToast(e.message) }
  }
  async function rename(e) {
    e.preventDefault(); setRenaming(false)
    try { const c = await api.updateChat(activeId, { name: newName }); setChats(cs => cs.map(x => x.id === c.id ? c : x)) } catch (err) { onToast(err.message) }
  }
  async function leave() {
    if (!window.confirm(`Leave "${chatTitle(active, me.id)}"? You'll stop receiving its messages.`)) return
    try { await api.leaveChat(activeId); setChats(cs => cs.filter(x => x.id !== activeId)); navigate(`${BASE_PATH}/chat`) } catch (e) { onToast(e.message) }
  }

  const pinned = chats.filter(c => c.pinned), rest = chats.filter(c => !c.pinned)
  const senderOf = (id) => active?.members.find(m => m.id === id) || agents.find(a => a.id === id) || { name: 'Unknown' }
  const typingNames = Object.values(typing)

  const ChatRow = ({ c }) => {
    const others = c.members.filter(m => m.id !== me.id)
    return (
      <button className={`chat-row ${c.id === activeId ? 'active' : ''}`} onClick={() => navigate(`${BASE_PATH}/chat/${c.id}`)}>
        {c.type === 'dm' && others[0] ? <Avatar agent={others[0]} status={others[0].status} /> : <div className="avatar group-av">{c.members.length}</div>}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="chat-row-top"><span className="name">{chatTitle(c, me.id)}</span>{c.last_message && <span className="time">{fmtTime(c.last_message.created_at)}</span>}</div>
          <div className="chat-row-sub">
            <span className="preview">{c.last_message ? `${c.last_message.sender_id === me.id ? 'You: ' : ''}${c.last_message.body}` : 'No messages yet'}</span>
            {c.unread > 0 && <span className="badge">{c.unread}</span>}
          </div>
        </div>
        {c.pinned && <Icon.Pin style={{ width: 13, height: 13, color: 'var(--text-muted)', flexShrink: 0 }} />}
      </button>
    )
  }

  return (
    <div className="chat">
      <aside className="chat-list">
        <div className="chat-list-head">
          <h2>Chat</h2>
          <button className="btn sm primary" onClick={() => setPicker('new')} title="New message"><Icon.Plus /> New</button>
        </div>
        <div className="chat-list-scroll">
          {pinned.length > 0 && <div className="section-label"><Icon.Pin /> Pinned</div>}
          {pinned.map(c => <ChatRow key={c.id} c={c} />)}
          {pinned.length > 0 && rest.length > 0 && <div className="section-label">Recent</div>}
          {rest.map(c => <ChatRow key={c.id} c={c} />)}
          {!chats.length && <div className="empty">No conversations yet. Start one with <b>New</b>.</div>}
        </div>
      </aside>

      <section className="thread">
        {!active ? (
          <div className="thread-empty"><Icon.Chat style={{ width: 40, height: 40, color: 'var(--text-muted)' }} /><div>Pick a conversation or start a new one.</div></div>
        ) : (
          <>
            <div className="thread-head">
              {renaming ? (
                <form onSubmit={rename} style={{ display: 'flex', gap: 8, flex: 1 }}>
                  <input className="field" autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Group name" />
                  <button className="btn sm primary" type="submit">Save</button>
                  <button className="btn sm ghost" type="button" onClick={() => setRenaming(false)}>Cancel</button>
                </form>
              ) : (
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="name" style={{ fontSize: 15 }}>{chatTitle(active, me.id)}</div>
                  <div className="sub">{active.type === 'group' ? `${active.members.length} people · ${active.members.map(m => m.name.split(' ')[0]).join(', ')}` : (active.members.find(m => m.id !== me.id)?.status || '')}</div>
                </div>
              )}
              <div className="thread-actions">
                <button className={`btn sm ghost ${active.pinned ? 'pinned' : ''}`} onClick={() => togglePin(active)} title={active.pinned ? 'Unpin' : 'Pin'}><Icon.Pin /></button>
                {active.type === 'group' && <button className="btn sm ghost" onClick={() => setPicker('add')} title="Add people"><Icon.UserPlus /></button>}
                {active.type === 'group' && <button className="btn sm ghost" onClick={() => { setNewName(active.name || ''); setRenaming(true) }} title="Rename">Rename</button>}
                {active.type === 'group' && <button className="btn sm ghost" onClick={leave} title="Leave group">Leave</button>}
                <button className="btn sm" onClick={() => {
                  const code = `chat-${active.id}-${Date.now().toString(36)}`
                  active.members.filter(m => m.id !== me.id).forEach(m => getSocket().emit('huddle:ring', { toAgentId: m.id, code }))
                  navigate(`${BASE_PATH}/m/${code}`)
                }} title="Start a video call with everyone here"><Icon.Video /> Call</button>
              </div>
            </div>

            <div className="messages" ref={listRef} onScroll={e => { if (e.currentTarget.scrollTop < 40) loadOlder() }}>
              {hasMore && messages.length > 0 && <div className="load-older">{loadingOlder ? 'Loading…' : 'Scroll up for older messages'}</div>}
              {messages.map((m, i) => {
                const prev = messages[i - 1]
                const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
                const grouped = prev && !newDay && prev.sender_id === m.sender_id && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000
                const sender = senderOf(m.sender_id)
                const mine = m.sender_id === me.id
                return (
                  <div key={m.id}>
                    {newDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
                    <div className={`msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
                      {!grouped ? <Avatar agent={sender} /> : <div style={{ width: 36 }} />}
                      <div className="msg-body">
                        {!grouped && <div className="msg-meta"><span className="who">{mine ? 'You' : sender.name}</span><span className="time">{new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>}
                        <div className="bubble">{m.body}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {!messages.length && <div className="thread-empty small">Say hello 👋</div>}
              <div ref={bottomRef} />
            </div>

            <div className="typing">{typingNames.length ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…` : ' '}</div>
            <form className="composer" onSubmit={send}>
              <textarea className="field" rows={1} placeholder={`Message ${chatTitle(active, me.id)}`} value={draft}
                onChange={e => onDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button className="btn primary" type="submit" disabled={!draft.trim()} title="Send (Enter)"><Icon.Send /></button>
            </form>
          </>
        )}
      </section>

      {picker === 'new' && <PeoplePicker title="New message" agents={agents.filter(a => a.id !== me.id)} allowName onDone={startChat} onClose={() => setPicker(null)} />}
      {picker === 'add' && active && <PeoplePicker title="Add people" agents={agents} exclude={active.members.map(m => m.id)} confirmLabel="Add" onDone={addPeople} onClose={() => setPicker(null)} />}
    </div>
  )
}

export function sortChats(cs) {
  const t = (c) => new Date(c.last_message?.created_at || c.created_at).getTime()
  return [...cs].sort((a, b) => (b.pinned - a.pinned) || (t(b) - t(a)))
}
