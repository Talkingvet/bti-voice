import { useEffect, useState } from 'react'
import { api } from '../api'
import { getSocket } from '../socket'
import { Avatar, Icon, STATUS_LABEL, absoluteUrl, copyText, navigate, BASE_PATH } from '../ui'

// Home: People (with presence + Call) and Meetings (links you can share).
export default function Home({ me, onToast }) {
  const [agents, setAgents] = useState([])
  const [rooms, setRooms] = useState([])
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.agents().then(setAgents).catch(() => {})
    api.rooms().then(setRooms).catch(() => {})
    const s = getSocket()
    const onStatus = ({ agent_id, status }) => setAgents(a => a.map(x => x.id === agent_id ? { ...x, status } : x))
    s.on('agent_status_changed', onStatus)
    return () => s.off('agent_status_changed', onStatus)
  }, [])

  // Direct call = a throwaway room code + a ring to the other agent.
  async function callAgent(agent) {
    const code = `call-${me.id}-${agent.id}-${Date.now().toString(36)}`
    getSocket().emit('huddle:ring', { toAgentId: agent.id, code })
    navigate(`${BASE_PATH}/m/${code}?calling=${encodeURIComponent(agent.name)}&to=${agent.id}`)
  }

  async function createRoom(e) {
    e?.preventDefault()
    setBusy(true)
    try {
      const r = await api.createRoom(newName)
      setRooms(rs => [{ ...r, created_by_name: me.name }, ...rs])
      setNewName('')
      await copyText(absoluteUrl(r.url))
      onToast('Meeting created — link copied to clipboard')
    } catch (err) { onToast(err.message) }
    finally { setBusy(false) }
  }

  function joinByCode(e) {
    e.preventDefault()
    const raw = joinCode.trim()
    const m = raw.match(/([a-z]+-[a-z]+-\d{2}|call-[a-z0-9-]+)/i)
    if (!m) return onToast('Paste a meeting link or code like brisk-otter-42')
    navigate(`${BASE_PATH}/m/${m[1].toLowerCase()}`)
  }

  const others = agents.filter(a => a.id !== me.id)

  return (
    <div className="content">
      <div className="two-col">
        <section className="card">
          <h2>People</h2>
          {others.length === 0 && <div className="empty">No other agents yet.</div>}
          {others.map(a => (
            <div className="row" key={a.id}>
              <Avatar agent={a} status={a.status} />
              <div className="grow">
                <div className="name">{a.name}</div>
                <div className="sub">{STATUS_LABEL[a.status] || 'Offline'}</div>
              </div>
              <button className="btn sm primary" onClick={() => callAgent(a)} title={`Video call ${a.name}`}>
                <Icon.Video /> Call
              </button>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Meetings</h2>
          <form onSubmit={createRoom} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input className="field" placeholder="New meeting name (optional)" value={newName} onChange={e => setNewName(e.target.value)} />
            <button className="btn primary" type="submit" disabled={busy}><Icon.Plus /> Create</button>
          </form>
          <form onSubmit={joinByCode} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input className="field" placeholder="Paste a meeting link or code to join" value={joinCode} onChange={e => setJoinCode(e.target.value)} />
            <button className="btn" type="submit"><Icon.Link /> Join</button>
          </form>
          {rooms.length === 0 && <div className="empty">No meetings yet. Create one and share the link.</div>}
          {rooms.map(r => (
            <div className="row" key={r.code}>
              <div className="grow">
                <div className="name">{r.name || r.code}</div>
                <div className="sub">{r.code} · by {r.created_by_name || 'someone'}</div>
              </div>
              <button className="btn sm ghost" title="Copy link" onClick={() => copyText(absoluteUrl(`${BASE_PATH}/m/${r.code}`)).then(() => onToast('Link copied'))}><Icon.Copy /></button>
              <button className="btn sm" onClick={() => navigate(`${BASE_PATH}/m/${r.code}`)}><Icon.Video /> Join</button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
