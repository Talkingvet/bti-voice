import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

export default function CallModal({ conv, agent, onClose, onCallLogged }) {
  const [seconds, setSeconds] = useState(0)
  const [status, setStatus]   = useState('calling') // 'calling' | 'connected' | 'ended'
  const intervalRef            = useRef(null)
  const startTimeRef           = useRef(Date.now())

  useEffect(() => {
    // Simulate connection after 2s (real Twilio SDK would connect here)
    const t = setTimeout(() => setStatus('connected'), 2000)
    intervalRef.current = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => {
      clearTimeout(t)
      clearInterval(intervalRef.current)
    }
  }, [])

  async function handleEnd() {
    clearInterval(intervalRef.current)
    setStatus('ended')
    const duration = Math.floor((Date.now() - startTimeRef.current) / 1000)
    try {
      await api.logCall(conv.id, duration, 'outbound')
      onCallLogged({ duration })
    } catch (e) {
      console.error('Failed to log call:', e)
    }
    setTimeout(onClose, 1200)
  }

  function formatTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={{ ...styles.pulse, background: status === 'connected' ? '#22c55e' : '#f59e0b' }}>
          📞
        </div>
        <h2 style={styles.name}>{conv.contact_name || conv.contact_number}</h2>
        <p style={styles.num}>{conv.contact_number}</p>
        <p style={styles.statusLine}>
          {status === 'calling'   && '⏳ Dialing…'}
          {status === 'connected' && '🟢 Connected'}
          {status === 'ended'     && '✓ Call ended'}
        </p>
        <div style={styles.timer}>{formatTime(seconds)}</div>
        <div style={styles.fromLine}>
          Calling from <strong>{agent.phone_number !== 'TBD' ? agent.phone_number : 'your number'}</strong>
        </div>
        {status !== 'ended' && (
          <button style={styles.endBtn} onClick={handleEnd}>🔴 End Call</button>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  },
  card: {
    background: 'white', borderRadius: 16, padding: '36px 32px',
    width: 300, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  },
  pulse: {
    width: 72, height: 72, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 28, margin: '0 auto 20px',
    animation: 'pulse 1.5s infinite',
  },
  name: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  num: { color: '#888', fontSize: 13, marginBottom: 8 },
  statusLine: { fontSize: 13, color: '#555', marginBottom: 12 },
  timer: { fontSize: 36, fontWeight: 700, letterSpacing: 2, marginBottom: 8 },
  fromLine: { fontSize: 12, color: '#aaa', marginBottom: 24 },
  endBtn: {
    background: '#ef4444', color: 'white', border: 'none',
    borderRadius: 50, padding: '12px 32px',
    fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
}
