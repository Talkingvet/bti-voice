import { useEffect, useRef, useState } from 'react'
import { HuddleCall } from '../webrtc'
import { getSocket } from '../socket'
import { Avatar, Icon, absoluteUrl, copyText, navigate, BASE_PATH } from '../ui'

function Video({ stream, muted = false, mirror = false, contain = false }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted={muted} className={contain ? 'contain' : ''} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />
}

function Tile({ agent, stream, label, muted, mirror, contain, state, you }) {
  const hasVideo = stream && stream.getVideoTracks().some(t => t.enabled && !t.muted && t.readyState === 'live')
  return (
    <div className="tile">
      {hasVideo
        ? <Video stream={stream} muted={muted} mirror={mirror} contain={contain} />
        : <div className="placeholder"><Avatar agent={agent} /><div>{label}</div></div>}
      <div className="label">{label}{you ? ' (you)' : ''}</div>
      {state && state !== 'connected' && <div className="state">{state}…</div>}
    </div>
  )
}

export default function Room({ me, code, onToast }) {
  const callRef = useRef(null)
  const [st, setSt] = useState({ local: null, screen: null, muted: false, cameraOff: false, peers: [] })
  const [error, setError] = useState('')
  const params = new URLSearchParams(window.location.search)
  const calling = params.get('calling')
  const [waiting, setWaiting] = useState(!!calling)

  useEffect(() => {
    const call = new HuddleCall({ code, onChange: setSt })
    callRef.current = call
    call.start().catch(e => setError(e.message || 'Could not start camera/microphone'))
    const s = getSocket()
    const onDeclined = ({ by, code: c }) => { if (c === code) { onToast(`${by.name} declined`); leave() } }
    s.on('huddle:declined', onDeclined)
    const onUnload = () => call.stop()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      s.off('huddle:declined', onDeclined)
      window.removeEventListener('beforeunload', onUnload)
      call.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  useEffect(() => { if (st.peers.length) setWaiting(false) }, [st.peers.length])

  // Direct call: if nobody picks up in 45s, give up.
  useEffect(() => {
    if (!calling) return
    const t = setTimeout(() => { if (callRef.current && callRef.current.peers.size === 0) { onToast(`${calling} didn't answer`); leave() } }, 45000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function leave() { navigate(BASE_PATH) }

  async function toggleScreen() {
    const c = callRef.current
    try { st.screen ? c.stopScreenShare() : await c.startScreenShare() }
    catch (e) { if (e.name !== 'NotAllowedError') onToast('Screen share failed: ' + e.message) }
  }

  const sharers = st.peers.filter(p => p.screenStream)
  const presenting = st.screen || sharers.length > 0
  const bigStream = sharers[0]?.screenStream || st.screen
  const bigLabel = sharers[0] ? `${sharers[0].agent.name}'s screen` : 'Your screen'
  const isMeeting = !code.startsWith('call-')

  const participants = (
    <>
      <Tile agent={me} stream={st.local} label={me.name} muted mirror you />
      {st.peers.map(p => <Tile key={p.id} agent={p.agent} stream={p.camStream} label={p.agent.name} state={p.state} />)}
    </>
  )

  return (
    <div className="room">
      <div className="header">
        <Icon.Video style={{ width: 18, height: 18, color: 'var(--accent)' }} />
        <span className="code">{isMeeting ? code : (calling ? `Calling ${calling}` : 'Call')}</span>
        {waiting && <span style={{ color: 'var(--text-sec)' }}>· ringing…</span>}
        {!waiting && <span style={{ color: 'var(--text-sec)' }}>· {st.peers.length + 1} in call</span>}
        <div className="right">
          {isMeeting && <button className="btn sm" onClick={() => copyText(absoluteUrl(`${BASE_PATH}/m/${code}`)).then(() => onToast('Meeting link copied'))}><Icon.Link /> Copy link</button>}
        </div>
      </div>

      {error && <div className="toast" style={{ bottom: 'auto', top: 64 }}>{error}</div>}

      <div className={`stage ${presenting ? 'presenting' : ''}`}
           style={!presenting ? { gridTemplateColumns: `repeat(${Math.min(3, Math.ceil(Math.sqrt(st.peers.length + 1)))}, minmax(0, 1fr))` } : undefined}>
        {presenting ? (
          <>
            <div className="tile"><Video stream={bigStream} muted contain /><div className="label"><Icon.Screen /> {bigLabel}</div></div>
            <div className="strip">{participants}</div>
          </>
        ) : participants}
      </div>

      <div className="controls">
        <button className={`ctl ${st.muted ? 'off' : ''}`} title={st.muted ? 'Unmute' : 'Mute'} onClick={() => callRef.current.setMuted(!st.muted)}>
          {st.muted ? <Icon.MicOff /> : <Icon.Mic />}
        </button>
        <button className={`ctl ${st.cameraOff ? 'off' : ''}`} title={st.cameraOff ? 'Turn camera on' : 'Turn camera off'} onClick={() => callRef.current.setCameraOff(!st.cameraOff)}>
          {st.cameraOff ? <Icon.VideoOff /> : <Icon.Video />}
        </button>
        <button className={`ctl ${st.screen ? 'on' : ''}`} title={st.screen ? 'Stop sharing' : 'Share screen'} onClick={toggleScreen}>
          <Icon.Screen />
        </button>
        <button className="ctl hang" title="Leave" onClick={leave}><Icon.Hang /></button>
      </div>
    </div>
  )
}
