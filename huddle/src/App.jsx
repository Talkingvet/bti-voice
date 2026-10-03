import { useEffect, useState } from 'react'
import { api, getAgent, getToken, clearSession, setSession } from './api'
import { getSocket, disconnectSocket } from './socket'
import Login from './pages/Login'
import Home from './pages/Home'
import Room from './pages/Room'
import Settings from './pages/Settings'
import Chat, { chatTitle, sortChats } from './pages/Chat'
import { Avatar, Icon, BRAND, BASE_PATH, navigate } from './ui'

function usePath() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const on = () => setPath(window.location.pathname)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  return path
}

export default function App() {
  const [me, setMe] = useState(getAgent())
  const [checked, setChecked] = useState(false)
  const [notice, setNotice] = useState('')
  const [ring, setRing] = useState(null)   // { from, code }
  const [toast, setToast] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [status, setStatus] = useState('available')
  const [chats, setChats] = useState([])
  const [agents, setAgents] = useState([])
  const path = usePath()

  // Validate the saved session once on start (same sliding-session call Voice makes).
  useEffect(() => {
    (async () => {
      try {
        const f = await api.features()
        if (f && f.huddle === false) setEnabled(false)
      } catch { /* server unreachable; fall through */ }
      if (!getToken()) { setChecked(true); return }
      try {
        const r = await api.refresh()
        if (r?.token && me) setSession(me, r.token)
      } catch (e) {
        if (e.status === 401 || e.status === 403) { clearSession(); setMe(null); setNotice(e.code === 'account_blocked' ? e.message : 'Your session expired — please sign in again.') }
      }
      setChecked(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Socket: incoming direct calls ring here. Mark ourselves available.
  useEffect(() => {
    if (!me) return
    api.agents().then(list => { setAgents(list); const mine = list.find(a => a.id === me.id); if (mine?.status) setStatus(mine.status) }).catch(() => {})
    api.chats().then(cs => setChats(sortChats(cs))).catch(() => {})
    const s = getSocket()
    const onStatus = ({ agent_id, status: st }) => setAgents(a => a.map(x => x.id === agent_id ? { ...x, status: st } : x))
    // Chat list bookkeeping lives here so badges update on any screen.
    const onChatMsg = (m) => {
      const viewing = window.location.pathname === `${BASE_PATH}/chat/${m.chat_id}` && document.hasFocus()
      setChats(cs => {
        if (!cs.some(c => c.id === m.chat_id)) { api.chats().then(all => setChats(sortChats(all))).catch(() => {}); return cs }
        return sortChats(cs.map(c => c.id === m.chat_id
          ? { ...c, last_message: m, unread: (m.sender_id === me.id || viewing) ? 0 : (c.unread || 0) + 1 }
          : c))
      })
      if (m.sender_id !== me.id && !viewing) {
        setChats(cs => { const c = cs.find(x => x.id === m.chat_id); showToast(`${m.sender_name || 'New message'}${c ? ` · ${chatTitle(c, me.id)}` : ''}: ${m.body.slice(0, 80)}`); return cs })
        window.huddleAPI?.incomingMessage?.(m.sender_name || 'New message')
      }
    }
    const onChatUpdated = (c) => setChats(cs => sortChats(cs.some(x => x.id === c.id) ? cs.map(x => x.id === c.id ? { ...x, ...c } : x) : [c, ...cs]))
    const onChatRemoved = ({ id }) => setChats(cs => cs.filter(x => x.id !== id))
    s.on('agent_status_changed', onStatus); s.on('chat:message', onChatMsg); s.on('chat:updated', onChatUpdated); s.on('chat:removed', onChatRemoved)
    const onRing = ({ from, code }) => {
      if (window.location.pathname.startsWith(`${BASE_PATH}/m/`)) return // already in a call; ignore
      setRing({ from, code })
      window.huddleAPI?.incomingCall?.(from.name)
    }
    const onConnectError = (err) => { if (/Unauthorized/i.test(err.message)) { clearSession(); setMe(null); setNotice('Please sign in again.') } }
    s.on('huddle:ring', onRing)
    s.on('connect_error', onConnectError)
    return () => {
      s.off('huddle:ring', onRing); s.off('connect_error', onConnectError)
      s.off('agent_status_changed', onStatus); s.off('chat:message', onChatMsg); s.off('chat:updated', onChatUpdated); s.off('chat:removed', onChatRemoved)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  useEffect(() => {
    if (!ring) return
    const t = setTimeout(() => setRing(null), 40000)
    return () => clearTimeout(t)
  }, [ring])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2600) }
  function logout() { disconnectSocket(); clearSession(); setMe(null) }
  function accept() { const r = ring; setRing(null); navigate(`${BASE_PATH}/m/${r.code}`) }
  function decline() { getSocket().emit('huddle:decline', { toAgentId: ring.from.id, code: ring.code }); setRing(null) }

  if (!checked) return null
  if (!enabled) return (
    <div className="login"><div className="box"><h1 style={{ margin: 0 }}>{BRAND}</h1><p style={{ color: 'var(--text-sec)' }}>Huddle isn't enabled on this account yet. Contact BTI to turn it on.</p></div></div>
  )
  if (!me) return <Login notice={notice} onLogin={(a) => { setNotice(''); setMe(a) }} />

  const roomMatch = path.match(new RegExp(`^${BASE_PATH}/m/([a-z0-9-]+)`, 'i'))
  const chatMatch = path.match(new RegExp(`^${BASE_PATH}/chat(?:/(\\d+))?`))
  const totalUnread = chats.reduce((n, c) => n + (c.unread || 0), 0)

  const isMacDesktop = window.huddleAPI?.isDesktop && window.huddleAPI?.platform === 'darwin'
  return (
    <div className={`shell ${isMacDesktop ? 'mac-desktop' : ''}`}>
      <aside className="sidebar">
        <div className="logo">BH</div>
        <button className={`nav-btn ${!roomMatch && !chatMatch ? 'active' : ''}`} onClick={() => navigate(BASE_PATH)}><Icon.People /> People</button>
        <button className={`nav-btn ${chatMatch ? 'active' : ''}`} onClick={() => navigate(`${BASE_PATH}/chat`)}>
          <Icon.Chat /> Chat{totalUnread > 0 && <span className="nav-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
        </button>
        <div className="spacer" />
        <button className="nav-btn" title="Settings" onClick={() => setShowSettings(true)}><Icon.Gear /> Settings</button>
        <button className="avatar-btn" title="Profile & settings" onClick={() => setShowSettings(true)}><Avatar agent={me} status={status} /></button>
      </aside>
      <main className="main">
        {roomMatch
          ? <Room key={roomMatch[1]} me={me} code={roomMatch[1].toLowerCase()} onToast={showToast} />
          : chatMatch
          ? <Chat me={me} chats={chats} setChats={setChats} activeId={chatMatch[1] ? parseInt(chatMatch[1], 10) : null} agents={agents} onToast={showToast} />
          : <>
              <div className="topbar"><h1>{BRAND}</h1><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>v{__APP_VERSION__}</span></div>
              <Home me={me} onToast={showToast} />
            </>}
      </main>

      {ring && (
        <div className="ring">
          <div className="who">
            <Avatar agent={ring.from} />
            <div><div style={{ fontWeight: 700 }}>{ring.from.name}</div><div className="sub">Incoming video call</div></div>
          </div>
          <div className="actions">
            <button className="btn danger" onClick={decline}>Decline</button>
            <button className="btn primary" onClick={accept}><Icon.Video /> Accept</button>
          </div>
        </div>
      )}
      {showSettings && <Settings me={me} status={status} onStatus={setStatus} onClose={() => setShowSettings(false)} onLogout={logout} onToast={showToast} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
