import { useEffect, useState } from 'react'
import { api, getAgent, getToken, clearSession, setSession } from './api'
import { getSocket, disconnectSocket } from './socket'
import Login from './pages/Login'
import Home from './pages/Home'
import Room from './pages/Room'
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
    const s = getSocket()
    const onRing = ({ from, code }) => {
      if (window.location.pathname.startsWith(`${BASE_PATH}/m/`)) return // already in a call; ignore
      setRing({ from, code })
      window.huddleAPI?.incomingCall?.(from.name)
    }
    const onConnectError = (err) => { if (/Unauthorized/i.test(err.message)) { clearSession(); setMe(null); setNotice('Please sign in again.') } }
    s.on('huddle:ring', onRing)
    s.on('connect_error', onConnectError)
    return () => { s.off('huddle:ring', onRing); s.off('connect_error', onConnectError) }
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">BH</div>
        <button className={`nav-btn ${!roomMatch ? 'active' : ''}`} onClick={() => navigate(BASE_PATH)}><Icon.People /> People</button>
        <div className="spacer" />
        <button className="nav-btn" title="Sign out" onClick={logout}><Icon.Logout /> Sign out</button>
        <div style={{ marginTop: 8 }}><Avatar agent={me} status="available" /></div>
      </aside>
      <main className="main">
        {roomMatch
          ? <Room key={roomMatch[1]} me={me} code={roomMatch[1].toLowerCase()} onToast={showToast} />
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
