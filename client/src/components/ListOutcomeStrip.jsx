/* Quick outcome for a call-list call that did NOT open the wrap-up screen
   (unanswered, busy, or under 15 s). The wrap-up screen only opens for connected
   calls ≥ 15 s, so without this the list would never learn about no-answers.
   Mirrors the wrap-up pills; writes through the same server rule
   (helpers/callLists.js) so a strip click and a wrap-up Save behave alike. */
import { useState, useEffect } from 'react'
import { IS_TOUCH } from '../utils/touch'
import { api } from '../api'
import { useColors } from '../useColors'

const QUICK = [
  { code: 'no_answer',      label: 'No answer' },
  { code: 'left_voicemail', label: 'Left voicemail' },
  { code: 'busy',           label: 'Busy' },
  { code: 'wrong_number',   label: 'Wrong number' },
]

export default function ListOutcomeStrip({ entry, callId, onDone }) {
  const C = useColors()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') skip() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(code) {
    setBusy(true); setErr('')
    try {
      await api.callListOutcome(entry.list_id, entry.id, { outcome: code, note: note.trim() || null, call_id: callId || null })
      onDone(code)
    } catch (e) { setErr(e.message || 'Could not save'); setBusy(false) }
  }
  async function skip() {
    try { await api.releaseCallListEntry(entry.list_id, entry.id) } catch { /* hold expires on its own */ }
    onDone(null)
  }

  return (
    <div style={S.overlay}>
      <div style={{ ...S.card, ...(IS_TOUCH ? S.cardMobile : {}), background: C.panel, border: `1px solid ${C.border}`, color: C.text }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>What happened?</div>
        <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 2 }}>
          {entry.display_name || entry.phone}{entry.list_name ? ' · list: ' + entry.list_name : ''}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {QUICK.map(q => (
            <button key={q.code} disabled={busy} onClick={() => pick(q.code)}
              style={{ ...S.pill, background: C.surface, border: `1px solid ${C.borderSoft}`, color: C.text, opacity: busy ? 0.6 : 1 }}>{q.label}</button>
          ))}
        </div>
        <input
          style={{ ...S.input, background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text }}
          placeholder="Note (optional) — pick an outcome to save"
          value={note} onChange={e => setNote(e.target.value)}
        />
        {err && <div style={{ fontSize: 11.5, color: '#ef4444', marginTop: 6 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 11, color: C.textMuted }}>Stays on the list either way.</span>
          <button disabled={busy} onClick={skip} style={{ ...S.pill, background: 'transparent', border: 'none', color: C.textSec }}>Skip for now</button>
        </div>
      </div>
    </div>
  )
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 950, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card:    { width: '100%', maxWidth: 380, borderRadius: 12, padding: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.35)' },
  cardMobile: { maxWidth: '100%', alignSelf: 'flex-end', borderRadius: '14px 14px 0 0' },
  pill:    { padding: '7px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  input:   { width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, outline: 'none', boxSizing: 'border-box', marginTop: 10 },
}
