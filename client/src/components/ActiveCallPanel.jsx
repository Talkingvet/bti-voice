import { useState, useEffect, useRef } from 'react'
import { playDTMF } from '../dtmf'
import { api }      from '../api'

const DTMF_KEYS = [
  ['1',''],    ['2','ABC'],  ['3','DEF'],
  ['4','GHI'], ['5','JKL'],  ['6','MNO'],
  ['7','PQRS'],['8','TUV'],  ['9','WXYZ'],
  ['*',''],    ['0','+'],    ['#',''],
]

// ── Helper: format seconds as m:ss ───────────────────────────────────────────
function formatTime(s) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// ── Helper: 1-2 initials from a display name or phone ───────────────────────
function toInitials(str) {
  if (!str) return '?'
  const words = str.trim().split(/\s+/)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  if (str.startsWith('+') || /^\d/.test(str)) return '📞'
  return str[0].toUpperCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// ActiveCallPanel
//
// Props:
//   call        — Twilio Call object (from Voice SDK)
//   agent       — logged-in agent { id, name, color }
//   callerInfo  — { phone, name } (may be null initially)
//   onHangup    — called after call.disconnect()
// ─────────────────────────────────────────────────────────────────────────────
export default function ActiveCallPanel({ call, agent, callerInfo, onHangup }) {
  const [seconds,      setSeconds]      = useState(0)
  const [muted,        setMuted]        = useState(false)
  const [onHold,       setOnHold]       = useState(false)
  const [holdBusy,     setHoldBusy]     = useState(false)
  const [mode,         setMode]         = useState('main')  // 'main' | 'keypad' | 'transfer'
  const [agents,       setAgents]       = useState([])
  const [transferring, setTransferring] = useState(null)    // null | agentId
  const [dtmfStr,      setDtmfStr]      = useState('')      // digits typed in keypad view
  const timerRef = useRef(null)
  const startRef = useRef(Date.now())

  // ── Timer ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSeconds(Math.round((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [])

  // ── Load agents for transfer list ───────────────────────────────────────────
  useEffect(() => {
    api.agents().then(setAgents).catch(console.error)
  }, [])

  const callSid = call?.parameters?.CallSid

  // ── Keyboard → DTMF (only active when keypad sub-panel is open) ──────────────
  useEffect(() => {
    if (mode !== 'keypad') return
    const VALID = new Set(['0','1','2','3','4','5','6','7','8','9','*','#'])
    function onKey(e) {
      if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return
      if (VALID.has(e.key)) {
        pressDTMF(e.key)
      } else if (e.key === 'Backspace') {
        setDtmfStr(prev => prev.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode]) // eslint-disable-line

  // ── Mute ────────────────────────────────────────────────────────────────────
  function toggleMute() {
    const next = !muted
    call.mute(next)
    setMuted(next)
  }

  // ── Hold / Resume (server-side: redirect caller to hold music) ──────────────
  async function toggleHold() {
    if (holdBusy) return
    setHoldBusy(true)
    try {
      if (!onHold) {
        await api.holdCall(callSid)
        setOnHold(true)
      } else {
        await api.resumeCall(callSid, agent.id)
        setOnHold(false)
      }
    } catch (e) {
      console.error('[hold]', e.message)
    }
    setHoldBusy(false)
  }

  // ── Blind transfer ──────────────────────────────────────────────────────────
  async function transferTo(targetAgent) {
    if (transferring) return
    setTransferring(targetAgent.id)
    try {
      await api.transferCall(callSid, targetAgent.id)
      // Caller is now ringing the target agent — hang up on our end
      call.disconnect()
      onHangup()
    } catch (e) {
      console.error('[transfer]', e.message)
      setTransferring(null)
    }
  }

  // ── DTMF ─────────────────────────────────────────────────────────────────────
  function pressDTMF(digit) {
    playDTMF(digit)
    call.sendDigits(digit)
    setDtmfStr(prev => prev + digit)
  }

  // ── Hang up ──────────────────────────────────────────────────────────────────
  function hangUp() {
    call.disconnect()
    onHangup()
  }

  // ── Derived display values ───────────────────────────────────────────────────
  const displayName  = callerInfo?.name  || callerInfo?.phone || 'Unknown Caller'
  const displayPhone = callerInfo?.phone || ''
  const showPhone    = displayPhone && displayPhone !== displayName
  const initials     = toInitials(displayName)
  const otherAgents  = agents.filter(a => a.id !== agent.id)

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.overlay}>
      <div style={S.panel}>

        {/* ── Caller card ─────────────────────────────────────────────────── */}
        <div style={S.callerCard}>
          <div style={S.avatarRing}>
            <div style={S.avatar}>{initials}</div>
          </div>
          <div style={S.callerName}>{displayName}</div>
          {showPhone && <div style={S.callerPhone}>{formatPhone(displayPhone)}</div>}

          {/* Live indicator / hold badge / timer */}
          <div style={S.timerRow}>
            {onHold ? (
              <span style={S.holdBadge}>⏸ ON HOLD</span>
            ) : (
              <>
                <span style={S.liveDot} />
                <span style={S.timerText}>{formatTime(seconds)}</span>
              </>
            )}
          </div>
        </div>

        {/* ── Sub-panel or action grid ─────────────────────────────────────── */}
        <div style={S.body}>

          {/* MAIN — 2×2 action grid */}
          {mode === 'main' && (
            <div style={S.actionGrid}>
              <ActionBtn
                icon={muted ? <MicOffIcon /> : <MicIcon />}
                label={muted ? 'Unmute' : 'Mute'}
                active={muted}
                color="#ef4444"
                onClick={toggleMute}
              />
              <ActionBtn
                icon={<KeypadIcon />}
                label="Keypad"
                onClick={() => { setMode('keypad'); setDtmfStr('') }}
              />
              <ActionBtn
                icon={onHold ? <PlayIcon /> : <PauseIcon />}
                label={onHold ? 'Resume' : 'Hold'}
                active={onHold}
                color="#f59e0b"
                loading={holdBusy}
                onClick={toggleHold}
              />
              <ActionBtn
                icon={<TransferIcon />}
                label="Transfer"
                onClick={() => setMode('transfer')}
              />
            </div>
          )}

          {/* KEYPAD sub-panel */}
          {mode === 'keypad' && (
            <div style={S.subPanel}>
              {/* Back link */}
              <div style={S.subHeader}>
                <button style={S.backBtn} onClick={() => setMode('main')}>← Back</button>
              </div>

              {/* Prominent digit display */}
              <div style={S.dtmfDisplay}>
                {dtmfStr
                  ? <span style={S.dtmfDisplayText}>{dtmfStr}</span>
                  : <span style={S.dtmfDisplayPlaceholder}>Enter digits…</span>
                }
                {dtmfStr && (
                  <button style={S.dtmfBackspace} onClick={() => setDtmfStr(p => p.slice(0,-1))}>
                    <BackspaceIcon />
                  </button>
                )}
              </div>

              {/* Keypad grid */}
              <div style={S.dtmfGrid}>
                {DTMF_KEYS.map(([digit, letters]) => (
                  <button key={digit} style={S.dtmfKey} onClick={() => pressDTMF(digit)}>
                    <span style={S.dtmfDigit}>{digit}</span>
                    {letters && <span style={S.dtmfLetters}>{letters}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TRANSFER sub-panel */}
          {mode === 'transfer' && (
            <div style={S.subPanel}>
              <div style={S.subHeader}>
                <button style={S.backBtn} onClick={() => setMode('main')}>← Back</button>
                <span style={S.subTitle}>Transfer to…</span>
              </div>
              {otherAgents.length === 0 ? (
                <div style={S.emptyMsg}>No other agents available</div>
              ) : (
                <div style={S.agentList}>
                  {otherAgents.map(a => {
                    const isBusy = transferring === a.id
                    const isDone = transferring && transferring !== a.id
                    return (
                      <button
                        key={a.id}
                        style={{ ...S.agentRow, opacity: isDone ? 0.4 : 1 }}
                        onClick={() => transferTo(a)}
                        disabled={!!transferring}
                      >
                        <div style={{ ...S.agentAvatar, background: a.color || '#3b82f6' }}>
                          {a.name[0].toUpperCase()}
                        </div>
                        <div style={S.agentInfo}>
                          <div style={S.agentName}>{a.name}</div>
                          <div style={S.agentRole}>{a.role || 'Agent'}</div>
                        </div>
                        <div style={S.agentArrow}>
                          {isBusy ? <SpinnerIcon /> : <ChevronIcon />}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Hang up ──────────────────────────────────────────────────────── */}
        <div style={S.hangupRow}>
          <button style={S.hangupBtn} onClick={hangUp}>
            <EndCallIcon />
          </button>
          <div style={S.hangupLabel}>End Call</div>
        </div>

      </div>
    </div>
  )
}

// ── ActionBtn ─────────────────────────────────────────────────────────────────
function ActionBtn({ icon, label, onClick, active = false, color = '#3b82f6', loading = false }) {
  return (
    <button
      style={{
        ...S.actionBtn,
        background: active ? color : 'rgba(255,255,255,0.1)',
        boxShadow: active ? `0 0 20px ${color}55` : 'none',
      }}
      onClick={onClick}
      disabled={loading}
    >
      <div style={S.actionIcon}>
        {loading ? <SpinnerIcon /> : icon}
      </div>
      <div style={S.actionLabel}>{label}</div>
    </button>
  )
}

// ── Utility ───────────────────────────────────────────────────────────────────
function formatPhone(raw) {
  const d = (raw || '').replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') {
    return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  }
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}
function MicOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}
function KeypadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" opacity="0.9">
      <circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/>
      <circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>
      <circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
    </svg>
  )
}
function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  )
}
function TransferIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  )
}
function EndCallIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
      <path d="M12 9c-1.6 0-3.1.3-4.5.7v3.4c0 .4-.2.8-.5 1a11.6 11.6 0 0 1-3 1.4c-.4.1-.8 0-1.1-.3L.4 12.7A.9.9 0 0 1 .3 12c.3-2 1.3-3.8 2.7-5.2C5.5 4.3 8.6 3 12 3s6.5 1.3 9 3.8a12 12 0 0 1 2.7 5.2c.1.4 0 .8-.3 1.1l-2.5 2.5c-.3.3-.7.4-1.1.3a11.6 11.6 0 0 1-3-1.4c-.3-.2-.5-.6-.5-1V9.7C14.9 9.2 13.5 9 12 9z"/>
    </svg>
  )
}
function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}
function BackspaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>
      <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
    </svg>
  )
}
function SpinnerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
        style={{ animation: 'spin 1s linear infinite', transformOrigin: 'center' }} />
    </svg>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  // Overlay fills the content area only (S.content has position:relative)
  overlay: {
    position:      'absolute',
    inset:         0,
    zIndex:        500,
    background:    'linear-gradient(165deg, #0a1628 0%, #0f2044 55%, #0a1628 100%)',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    overflow:      'hidden',
  },
  panel: {
    width:         '100%',
    height:        '100%',
    display:       'flex',
    flexDirection: 'column',
    alignItems:    'center',
    padding:       '14px 16px 12px',
    gap:           10,
    overflowY:     'auto',
  },

  // ── Caller card ──────────────────────────────────────────────────
  callerCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0,
  },
  avatarRing: {
    width: 56, height: 56, borderRadius: '50%',
    background: 'rgba(255,255,255,0.08)',
    border: '2px solid rgba(255,255,255,0.15)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
    boxShadow: '0 0 20px rgba(79,156,249,0.2)',
  },
  avatar: { fontSize: 20, fontWeight: 700, color: 'white', userSelect: 'none' },
  callerName:  { fontSize: 16, fontWeight: 700, color: 'white', textAlign: 'center' },
  callerPhone: { fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 },
  timerRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 },
  liveDot: {
    width: 7, height: 7, borderRadius: '50%',
    background: '#22c55e', boxShadow: '0 0 6px #22c55e',
    display: 'inline-block',
  },
  timerText: {
    fontFamily: 'monospace', fontSize: 18, fontWeight: 600,
    color: 'white', letterSpacing: 3,
  },
  holdBadge: {
    background: 'rgba(245,158,11,0.25)', color: '#fbbf24',
    border: '1px solid rgba(245,158,11,0.4)',
    borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700, letterSpacing: 1,
  },

  // ── Body ─────────────────────────────────────────────────────────
  body: {
    flex: 1, width: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', minHeight: 0,
  },

  // 2×2 action grid — compact buttons
  actionGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    gap: 10, width: '100%', maxWidth: 280, padding: '4px 0',
  },
  actionBtn: {
    borderRadius: 14, border: 'none', cursor: 'pointer',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 5, padding: '12px 8px',
    transition: 'background 0.15s, transform 0.1s',
    userSelect: 'none',
  },
  actionIcon:  { width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  actionLabel: {
    fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // Sub-panels
  subPanel: { width: '100%', display: 'flex', flexDirection: 'column', gap: 8 },
  subHeader: { display: 'flex', alignItems: 'center', padding: '0 2px' },
  backBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'rgba(255,255,255,0.55)', fontSize: 12, padding: '2px 0',
  },
  subTitle: {
    flex: 1, textAlign: 'right', color: 'rgba(255,255,255,0.6)',
    fontSize: 12, fontWeight: 600, paddingRight: 2,
  },

  // DTMF digit display — centered, prominent, like a real phone number input
  dtmfDisplay: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 36, padding: '2px 8px', position: 'relative',
  },
  dtmfDisplayText: {
    fontFamily: 'monospace', fontSize: 22, fontWeight: 400,
    color: 'white', letterSpacing: 3, textAlign: 'center',
  },
  dtmfDisplayPlaceholder: {
    fontFamily: 'monospace', fontSize: 14,
    color: 'rgba(255,255,255,0.25)', textAlign: 'center',
  },
  dtmfBackspace: {
    position: 'absolute', right: 8,
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'rgba(255,255,255,0.45)', display: 'flex', padding: 4,
  },

  // DTMF keypad — fixed 58px keys so they don't stretch
  dtmfGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 58px)',
    gap: 8,
    justifyContent: 'center',
  },
  dtmfKey: {
    width: 58, height: 50,
    background: 'rgba(255,255,255,0.08)', borderRadius: 12,
    border: 'none', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 1, transition: 'background 0.1s',
  },
  dtmfDigit:   { fontSize: 17, fontWeight: 400, color: 'white', lineHeight: 1.1 },
  dtmfLetters: { fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 1.5 },

  // Transfer agent list
  agentList: { display: 'flex', flexDirection: 'column', gap: 8 },
  agentRow: {
    background: 'rgba(255,255,255,0.07)', borderRadius: 12, border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', width: '100%', transition: 'background 0.15s',
  },
  agentAvatar: {
    width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, color: 'white',
  },
  agentInfo:  { flex: 1, textAlign: 'left' },
  agentName:  { fontSize: 13, fontWeight: 600, color: 'white' },
  agentRole:  { fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 1 },
  agentArrow: { display: 'flex', alignItems: 'center', flexShrink: 0 },
  emptyMsg:   { textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: '16px 0' },

  // Hang up
  hangupRow: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 },
  hangupBtn: {
    width: 58, height: 58, borderRadius: '50%',
    background: 'linear-gradient(135deg, #dc2626, #ef4444)',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 16px rgba(239,68,68,0.5)',
    transition: 'transform 0.1s',
  },
  hangupLabel: {
    fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
}
