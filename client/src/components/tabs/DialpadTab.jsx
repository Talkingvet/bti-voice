import { useState, useEffect } from 'react'
import { useColors } from '../../useColors'
import { playDTMF } from '../../dtmf'
import { api } from '../../api'
import { useToast } from '../Toast'

const KEYS = [
  ['1',''],  ['2','ABC'],  ['3','DEF'],
  ['4','GHI'],['5','JKL'], ['6','MNO'],
  ['7','PQRS'],['8','TUV'],['9','WXYZ'],
  ['*',''],  ['0','+'],    ['#',''],
]

// device, activeCall, onCallStart, onCallEnd provided by App.jsx
export default function DialpadTab({ agent, device, activeCall, onCallStart, onCallEnd }) {
  const C = useColors()
  const { toast } = useToast()
  const [number,       setNumber]       = useState('')
  const [status,       setStatus]       = useState('')
  const [callState,    setCallState]    = useState('idle') // idle | connecting | active
  const [quickDials,   setQuickDials]   = useState([])
  const [addingQD,     setAddingQD]     = useState(false)
  const [qdName,       setQdName]       = useState('')
  const [qdPhone,      setQdPhone]      = useState('')
  const [savingQD,     setSavingQD]     = useState(false)

  useEffect(() => {
    api.quickDial().then(setQuickDials).catch(console.error)
  }, [])

  async function handleAddQuickDial() {
    if (!qdName.trim() || !qdPhone.trim() || savingQD) return
    setSavingQD(true)
    try {
      const entry = await api.addQuickDial({ name: qdName.trim(), phone_number: qdPhone.trim() })
      setQuickDials(prev => [...prev, entry].sort((a, b) => a.name.localeCompare(b.name)))
      setQdName(''); setQdPhone(''); setAddingQD(false)
      toast.success('Quick dial saved')
    } catch (e) {
      toast.error('Failed to save: ' + e.message)
    } finally {
      setSavingQD(false)
    }
  }

  async function handleDeleteQD(id) {
    try {
      await api.deleteQuickDial(id)
      setQuickDials(prev => prev.filter(q => q.id !== id))
      toast.success('Quick dial removed')
    } catch (e) {
      toast.error('Failed to delete: ' + e.message)
    }
  }

  function dialQuickDial(phone) {
    const digits = phone.replace(/\D/g, '')
    setNumber(digits)
    setStatus('')
  }

  // ── Keyboard input ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      // Don't capture when typing in an input/textarea
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      // When a call is active, ActiveCallPanel owns the keyboard — don't interfere
      if (callState === 'active' || callState === 'connecting') return
      const key = e.key
      if (KEYS.flat().includes(key)) {
        pressDigit(key)
      } else if (key === 'Backspace') {
        setNumber(prev => prev.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [callState])  // eslint-disable-line

  // ── Press a digit ─────────────────────────────────────────────────────────────
  function pressDigit(digit) {
    playDTMF(digit)
    // During an active call, ActiveCallPanel handles digit display; don't pollute number state
    if (callState !== 'active' && callState !== 'connecting') {
      setNumber(prev => prev + digit)
    }
    setStatus('')
    if (activeCall && callState === 'active') activeCall.sendDigits(digit)
  }

  function backspace() { setNumber(prev => prev.slice(0, -1)) }

  // ── Outbound call ─────────────────────────────────────────────────────────────
  async function startCall() {
    if (!number.trim() || !device) return
    setCallState('connecting')
    setStatus(`Calling ${formatNumber(number)}…`)

    const digits = number.replace(/\D/g, '')
    const to = digits.length === 10 ? `+1${digits}` : `+${digits}`

    try {
      const call = await device.connect({ params: { To: to } })

      call.on('accept', () => {
        setCallState('active')
        setStatus('Connected')
      })
      call.on('disconnect', () => endCall('Call ended'))
      call.on('cancel',     () => endCall(''))
      call.on('error', err => {
        endCall('Call failed: ' + err.message)
        setTimeout(() => setStatus(''), 3000)
      })

      // Tell App about the call (for logging + connect sound)
      onCallStart(call, to)
    } catch (e) {
      endCall('Error: ' + e.message)
      setTimeout(() => setStatus(''), 3000)
    }
  }

  function hangUp() {
    if (activeCall) activeCall.disconnect()
    endCall('Call ended')
  }

  function endCall(msg = '') {
    setCallState('idle')
    setStatus(msg)
    onCallEnd()
    if (msg) setTimeout(() => setStatus(''), 2000)
  }

  // Keep local callState in sync when activeCall is cleared externally
  // Also clear the number display so stale digits don't linger after hang-up
  useEffect(() => {
    if (!activeCall && (callState === 'active' || callState === 'connecting')) {
      setCallState('idle')
      setNumber('')
    }
  }, [activeCall]) // eslint-disable-line

  const formatted = formatNumber(number)
  const isActive  = callState === 'active' || callState === 'connecting'

  return (
    <div style={{ ...S.page, background: C.bg }}>

      {/* Header */}
      <div style={{ ...S.header, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ ...S.headerTitle, color: C.text }}>Dialpad</div>
        <div style={{ ...S.headerSub, color: C.textSec }}>
          Calling from
          <span style={{ ...S.fromBadge, background: agent.color || '#3b82f6' }}>{agent.name}</span>
        </div>
      </div>

      {/* Number display */}
      <div style={S.display}>
        <div style={{ ...S.numberText, color: C.text }}>
          {formatted || <span style={{ color: C.emptyText, fontSize: 18, fontWeight: 400 }}>Enter number</span>}
        </div>
        {number && !isActive && (
          <button style={{ ...S.backBtn, color: C.textSec }} onClick={backspace} title="Backspace">
            <BackspaceIcon />
          </button>
        )}
      </div>

      {/* Keypad */}
      <div style={S.keypad}>
        {KEYS.map(([digit, letters]) => (
          <button
            key={digit}
            style={{ ...S.key, background: C.panel, boxShadow: `0 1px 4px rgba(0,0,0,0.15)` }}
            onClick={() => pressDigit(digit)}
          >
            <span style={{ ...S.keyDigit, color: C.text }}>{digit}</span>
            {letters && <span style={{ ...S.keyLetters, color: C.textMuted }}>{letters}</span>}
          </button>
        ))}
      </div>

      {/* Call / Hangup button */}
      <div style={S.callRow}>
        {isActive ? (
          <button style={S.hangupBtn} onClick={hangUp}><HangupIcon /></button>
        ) : (
          <button
            style={{ ...S.callBtn, ...(!number || !device ? S.callBtnDisabled : {}) }}
            onClick={startCall}
            disabled={!number || !device}
          >
            <PhoneIcon />
          </button>
        )}
      </div>

      {/* Status */}
      {status && (
        <div style={{ ...S.status, color: callState === 'active' ? '#22c55e' : C.textSec }}>
          {callState === 'active' && <span style={S.activeDot} />}
          {status}
        </div>
      )}

      {/* Keyboard hint */}
      {!isActive && !number && (
        <div style={{ ...S.hint, color: C.textMuted }}>
          You can also type numbers on your keyboard
        </div>
      )}

      {/* Quick dial */}
      <div style={{ ...S.quickSection, borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ ...S.quickTitle, color: C.textMuted }}>Quick Dial</div>
          <button
            style={{ ...S.qdAddBtn, color: '#4f9cf9' }}
            onClick={() => setAddingQD(v => !v)}
            title="Add quick dial"
          >+</button>
        </div>

        {addingQD && (
          <div style={{ ...S.qdForm, background: C.surface, border: `1px solid ${C.border}` }}>
            <input
              style={{ ...S.qdInput, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
              placeholder="Name"
              value={qdName}
              onChange={e => setQdName(e.target.value)}
            />
            <input
              style={{ ...S.qdInput, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
              placeholder="Phone number"
              value={qdPhone}
              onChange={e => setQdPhone(e.target.value)}
            />
            <button
              style={{ ...S.qdSaveBtn, opacity: savingQD || !qdName.trim() || !qdPhone.trim() ? 0.5 : 1 }}
              onClick={handleAddQuickDial}
              disabled={savingQD || !qdName.trim() || !qdPhone.trim()}
            >Save</button>
          </div>
        )}

        {quickDials.length === 0 && !addingQD && (
          <div style={{ ...S.quickEmpty, color: C.emptyText }}>No saved contacts yet</div>
        )}

        {quickDials.map(qd => (
          <div key={qd.id} style={{ ...S.qdRow, borderBottom: `1px solid ${C.border}` }}>
            <button style={{ ...S.qdDialBtn }} onClick={() => dialQuickDial(qd.phone_number)} title={`Dial ${qd.phone_number}`}>
              <div style={{ ...S.qdName, color: C.text }}>{qd.name}</div>
              <div style={{ ...S.qdNum, color: C.textMuted }}>{qd.phone_number}</div>
            </button>
            <button style={{ ...S.qdDeleteBtn, color: C.textMuted }} onClick={() => handleDeleteQD(qd.id)} title="Remove">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatNumber(raw) {
  const d = raw.replace(/\D/g, '')
  if (!d.length) return raw
  if (d.length <= 3) return d
  if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`
  if (d.length <= 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

function BackspaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="18" y1="9" x2="12" y2="15" /><line x1="12" y1="9" x2="18" y2="15" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
    </svg>
  )
}
function HangupIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
      <path d="M12 9c-1.6 0-3.1.3-4.5.7v3.4c0 .4-.2.8-.5 1a11.6 11.6 0 0 1-3 1.4c-.4.1-.8 0-1.1-.3L.4 12.7A.9.9 0 0 1 .3 12c.3-2 1.3-3.8 2.7-5.2C5.5 4.3 8.6 3 12 3s6.5 1.3 9 3.8a12 12 0 0 1 2.7 5.2c.1.4 0 .8-.3 1.1l-2.5 2.5c-.3.3-.7.4-1.1.3a11.6 11.6 0 0 1-3-1.4c-.3-.2-.5-.6-.5-1V9.7C14.9 9.2 13.5 9 12 9z"/>
    </svg>
  )
}

const S = {
  page:         { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '0 0 20px' },
  header:       { width: '100%', padding: '16px 20px 12px', textAlign: 'center', flexShrink: 0 },
  headerTitle:  { fontSize: 15, fontWeight: 700, marginBottom: 4 },
  headerSub:    { fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 },
  fromBadge:    { color: 'white', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10 },
  display:      { width: '100%', maxWidth: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px 8px', position: 'relative', minHeight: 70 },
  numberText:   { fontSize: 30, fontWeight: 300, letterSpacing: 2, textAlign: 'center', flex: 1 },
  backBtn:      { position: 'absolute', right: 20, background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex' },
  keypad:       { display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 10, padding: '8px 0 16px' },
  key:          { width: 72, height: 72, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, transition: 'transform 0.08s', userSelect: 'none' },
  keyDigit:     { fontSize: 22, fontWeight: 400, lineHeight: 1 },
  keyLetters:   { fontSize: 8, fontWeight: 700, letterSpacing: 1.5 },
  callRow:      { display: 'flex', justifyContent: 'center', margin: '4px 0 8px' },
  callBtn:      { width: 64, height: 64, borderRadius: '50%', background: '#22c55e', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(34,197,94,0.4)', transition: 'transform 0.1s' },
  callBtnDisabled: { background: '#374151', boxShadow: 'none', cursor: 'not-allowed' },
  hangupBtn:    { width: 64, height: 64, borderRadius: '50%', background: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(239,68,68,0.4)', transition: 'transform 0.1s' },
  status:       { fontSize: 12, textAlign: 'center', padding: '0 20px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  activeDot:    { width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' },
  hint:         { fontSize: 10, textAlign: 'center', padding: '0 20px 6px', opacity: 0.5 },
  quickSection: { width: '100%', padding: '12px 20px 0', marginTop: 4 },
  quickTitle:   { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  quickEmpty:   { fontSize: 13, textAlign: 'center', padding: '12px 0' },
  qdAddBtn:     { background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px', fontWeight: 700 },
  qdForm:       { borderRadius: 10, padding: 10, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  qdInput:      { borderRadius: 8, padding: '6px 10px', fontSize: 12, outline: 'none', fontFamily: 'inherit' },
  qdSaveBtn:    { background: '#4f9cf9', color: 'white', border: 'none', borderRadius: 8, padding: '6px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  qdRow:        { display: 'flex', alignItems: 'center', padding: '8px 0' },
  qdDialBtn:    { flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 },
  qdName:       { fontSize: 13, fontWeight: 600 },
  qdNum:        { fontSize: 11, marginTop: 1 },
  qdDeleteBtn:  { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 4px', opacity: 0.5 },
}
