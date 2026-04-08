import { useState } from 'react'
import { api } from '../../api'
import { useColors } from '../../useColors'

const KEYS = [
  ['1',''],  ['2','ABC'],  ['3','DEF'],
  ['4','GHI'],['5','JKL'], ['6','MNO'],
  ['7','PQRS'],['8','TUV'],['9','WXYZ'],
  ['*',''],  ['0','+'],    ['#',''],
]

export default function DialpadTab({ agent }) {
  const C = useColors()
  const [number,  setNumber]  = useState('')
  const [calling, setCalling] = useState(false)
  const [status,  setStatus]  = useState('')

  function press(digit) { setNumber(prev => prev + digit); setStatus('') }
  function backspace()  { setNumber(prev => prev.slice(0, -1)) }

  async function call() {
    if (!number.trim()) return
    setCalling(true); setStatus('Initiating call…')
    try {
      await api.voiceToken()
      setStatus(`Calling ${number}…`)
      setTimeout(() => { setStatus('(Twilio integration required for live calls)'); setCalling(false) }, 2000)
    } catch (e) { setStatus('Error: ' + e.message); setCalling(false) }
  }

  const formatted = formatNumber(number)

  return (
    <div style={{ ...S.page, background: C.bg }}>
      <div style={{ ...S.header, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ ...S.headerTitle, color: C.text }}>Dialpad</div>
        <div style={{ ...S.headerSub, color: C.textSec }}>
          Calling from
          <span style={{ ...S.fromBadge, background: agent.color || '#3b82f6' }}>{agent.name}</span>
          {agent.phone_number !== 'TBD' && <span style={{ color: C.textMuted, fontSize: 10 }}>{agent.phone_number}</span>}
        </div>
      </div>

      {/* Number display */}
      <div style={S.display}>
        <div style={{ ...S.numberText, color: C.text }}>
          {formatted || <span style={{ color: C.emptyText, fontSize: 18, fontWeight: 400 }}>Enter number</span>}
        </div>
        {number && (
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
            onClick={() => press(digit)}
          >
            <span style={{ ...S.keyDigit, color: C.text }}>{digit}</span>
            {letters && <span style={{ ...S.keyLetters, color: C.textMuted }}>{letters}</span>}
          </button>
        ))}
      </div>

      {/* Call button */}
      <div style={S.callRow}>
        <button
          style={{ ...S.callBtn, ...(!number || calling ? S.callBtnDisabled : {}) }}
          onClick={call}
          disabled={!number || calling}
        >
          <PhoneIcon />
        </button>
      </div>

      {status && <div style={{ ...S.status, color: C.textSec }}>{status}</div>}

      <div style={{ ...S.quickSection, borderTop: `1px solid ${C.border}` }}>
        <div style={{ ...S.quickTitle, color: C.textMuted }}>Quick Dial</div>
        <div style={{ ...S.quickEmpty, color: C.emptyText }}>No saved contacts yet</div>
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

const S = {
  page:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '0 0 20px' },
  header:  { width: '100%', padding: '16px 20px 12px', textAlign: 'center', flexShrink: 0 },
  headerTitle: { fontSize: 15, fontWeight: 700, marginBottom: 4 },
  headerSub:   { fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 },
  fromBadge:   { color: 'white', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10 },
  display: { width: '100%', maxWidth: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px 8px', position: 'relative', minHeight: 70 },
  numberText:  { fontSize: 30, fontWeight: 300, letterSpacing: 2, textAlign: 'center', flex: 1 },
  backBtn:     { position: 'absolute', right: 20, background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex' },
  keypad:      { display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 10, padding: '8px 0 16px' },
  key:         { width: 72, height: 72, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, transition: 'transform 0.08s', userSelect: 'none' },
  keyDigit:    { fontSize: 22, fontWeight: 400, lineHeight: 1 },
  keyLetters:  { fontSize: 8, fontWeight: 700, letterSpacing: 1.5 },
  callRow:     { display: 'flex', justifyContent: 'center', margin: '4px 0 12px' },
  callBtn:     { width: 64, height: 64, borderRadius: '50%', background: '#22c55e', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(34,197,94,0.4)', transition: 'transform 0.1s' },
  callBtnDisabled: { background: '#e2e8f0', boxShadow: 'none', cursor: 'not-allowed' },
  status:      { fontSize: 12, textAlign: 'center', padding: '0 20px 8px' },
  quickSection:{ width: '100%', padding: '12px 20px 0', marginTop: 4 },
  quickTitle:  { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  quickEmpty:  { fontSize: 13, textAlign: 'center', padding: '12px 0' },
}
