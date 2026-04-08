/* Calls tab — Logs + Voicemails sub-tabs, date-grouped, Zoho-style compact */
import { useState, useEffect } from 'react'
import { api } from '../../api'
import { useColors } from '../../useColors'

/* ── Helpers ─────────────────────────────────────────────────────── */
function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}
function fmtDuration(secs) {
  if (!secs || secs === 0) return null
  const m = Math.floor(secs / 60), s = secs % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
}
function groupByDate(items, dateField) {
  const groups = []
  const seen = {}
  for (const item of items) {
    const d = new Date(item[dateField])
    const label = d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
    if (!seen[label]) { seen[label] = true; groups.push({ type: 'header', label }) }
    groups.push({ type: 'item', data: item })
  }
  return groups
}

/* ── Sub-tab pill ────────────────────────────────────────────────── */
function SubTabs({ active, onChange, tabs, C }) {
  return (
    <div style={{ ...ST.bar, borderBottom: `1px solid ${C.border}`, background: C.panel }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            ...ST.tab,
            color: active === t.id ? '#4f9cf9' : C.textSec,
            borderBottom: active === t.id ? '2px solid #4f9cf9' : '2px solid transparent',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
const ST = {
  bar: { display: 'flex', flexShrink: 0 },
  tab: {
    flex: 1, padding: '10px 0', border: 'none', background: 'transparent',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    transition: 'color 0.12s, border-color 0.12s',
  },
}

/* ── Main component ──────────────────────────────────────────────── */
export default function CallsTab({ agent }) {
  const C = useColors()
  const [subTab,     setSubTab]     = useState('logs')
  const [calls,      setCalls]      = useState([])
  const [filter,     setFilter]     = useState('all')
  const [voicemails, setVoicemails] = useState(MOCK_VOICEMAILS)
  const [playingVm,  setPlayingVm]  = useState(null)

  useEffect(() => { api.calls().then(setCalls).catch(console.error) }, [])

  /* Filter calls */
  const filteredCalls = calls.filter(c => {
    if (filter === 'missed')   return c.status === 'missed'
    if (filter === 'inbound')  return c.direction === 'inbound'
    if (filter === 'outbound') return c.direction === 'outbound'
    return true
  })

  const callGroups = groupByDate(filteredCalls, 'started_at')
  const vmGroups   = groupByDate(voicemails, 'date')

  return (
    <div style={{ ...S.page, background: C.bg }}>

      {/* Sub-tabs */}
      <SubTabs
        active={subTab}
        onChange={setSubTab}
        tabs={[{ id: 'logs', label: 'Logs' }, { id: 'voicemails', label: 'Voicemails' }]}
        C={C}
      />

      {/* ── LOGS ── */}
      {subTab === 'logs' && (
        <>
          {/* Filter row */}
          <div style={{ ...S.filterRow, background: C.panel, borderBottom: `1px solid ${C.borderSoft}` }}>
            {['all', 'inbound', 'outbound', 'missed'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  ...S.filterBtn,
                  background: filter === f ? 'rgba(79,156,249,0.15)' : 'transparent',
                  color: filter === f ? '#4f9cf9' : C.textSec,
                  border: filter === f ? '1px solid rgba(79,156,249,0.4)' : '1px solid transparent',
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div style={S.list}>
            {callGroups.length === 0 ? (
              <div style={{ ...S.empty, color: C.emptyText }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📞</div>
                <div>No calls to show</div>
              </div>
            ) : callGroups.map((row, i) =>
              row.type === 'header'
                ? <DateHeader key={`h-${i}`} label={row.label} C={C} />
                : <CallRow key={row.data.id} call={row.data} C={C} />
            )}
          </div>
        </>
      )}

      {/* ── VOICEMAILS ── */}
      {subTab === 'voicemails' && (
        <div style={S.list}>
          {vmGroups.length === 0 ? (
            <div style={{ ...S.empty, color: C.emptyText }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div>No voicemails</div>
            </div>
          ) : vmGroups.map((row, i) =>
            row.type === 'header'
              ? <DateHeader key={`vh-${i}`} label={row.label} C={C} />
              : (
                <VmRow
                  key={row.data.id}
                  vm={row.data}
                  isPlaying={playingVm === row.data.id}
                  onToggle={() => setPlayingVm(p => p === row.data.id ? null : row.data.id)}
                  C={C}
                />
              )
          )}
        </div>
      )}
    </div>
  )
}

/* ── Date group header ───────────────────────────────────────────── */
function DateHeader({ label, C }) {
  return (
    <div style={{ ...S.dateHeader, color: C.textMuted, background: C.surface }}>
      {label}
    </div>
  )
}

/* ── Call row ────────────────────────────────────────────────────── */
function CallRow({ call, C }) {
  const isMissed  = call.status === 'missed'
  const isInbound = call.direction === 'inbound'
  const color     = isMissed ? '#ef4444' : isInbound ? '#22c55e' : '#4f9cf9'
  const duration  = fmtDuration(call.duration)

  return (
    <div style={{ ...S.row, borderBottom: `1px solid ${C.borderItem}` }}>
      {/* Direction icon */}
      <div style={{ ...S.callIcon, color }}>
        <CallDirIcon direction={call.direction} missed={isMissed} />
      </div>

      {/* Info */}
      <div style={S.rowInfo}>
        <div style={{ ...S.rowName, color: C.text }}>
          {call.contact_name || call.contact_number || 'Unknown'}
        </div>
        <div style={{ ...S.rowMeta, color: C.textSec }}>
          {call.agent_name && (
            <span style={{ color: call.agent_color, fontWeight: 600 }}>{call.agent_name}</span>
          )}
          {call.contact_number && call.contact_name && (
            <span style={{ color: C.textMuted }}> · {call.contact_number}</span>
          )}
        </div>
      </div>

      {/* Time + duration */}
      <div style={S.rowRight}>
        <div style={{ ...S.rowTime, color: C.textMuted }}>{fmtTime(call.started_at)}</div>
        {duration
          ? <div style={{ ...S.rowDur, color: C.textSec }}>⏱ {duration}</div>
          : <div style={{ ...S.rowDur, color: '#ef4444' }}>Missed</div>
        }
      </div>
    </div>
  )
}

/* ── Voicemail row ───────────────────────────────────────────────── */
function VmRow({ vm, isPlaying, onToggle, C }) {
  return (
    <>
      <div
        style={{ ...S.row, borderBottom: `1px solid ${C.borderItem}`, background: !vm.read ? (C.hover || 'rgba(79,156,249,0.05)') : 'transparent' }}
      >
        <div style={{ ...S.vmIcon, color: vm.read ? C.textMuted : '#4f9cf9' }}>
          <VmIcon />
        </div>
        <div style={S.rowInfo}>
          <div style={{ ...S.rowName, color: C.text }}>{vm.from}</div>
          <div style={{ ...S.rowMeta, color: C.textSec }}>{vm.number}</div>
        </div>
        <div style={S.rowRight}>
          <div style={{ ...S.rowTime, color: C.textMuted }}>{fmtTime(vm.date)}</div>
          <div style={{ ...S.rowDur, color: C.textSec }}>⏱ {fmtDuration(vm.duration) || `${vm.duration}s`}</div>
        </div>
        <button
          style={{ ...S.playBtn, background: isPlaying ? '#4f9cf9' : C.surface, color: isPlaying ? 'white' : C.textSec, border: `1px solid ${isPlaying ? '#4f9cf9' : C.borderSoft}` }}
          onClick={onToggle}
          title={isPlaying ? 'Collapse' : 'Play'}
        >
          {isPlaying ? '▾' : '▸'}
        </button>
      </div>

      {/* Inline mini-player */}
      {isPlaying && (
        <div style={{ ...S.miniPlayer, background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ ...S.playerTitle, color: C.textMuted }}>Voicemail · {fmtDuration(vm.duration) || `${vm.duration}s`}</div>
          <div style={S.progressBar}>
            <div style={{ ...S.progressFill, width: '0%' }} />
          </div>
          <div style={{ ...S.playerNote, color: C.textMuted }}>
            Full playback requires Twilio Voice configured with a phone number.
          </div>
        </div>
      )}
    </>
  )
}

/* ── Icons ──────────────────────────────────────────────────────── */
function CallDirIcon({ direction, missed }) {
  if (missed) return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.26 9.91" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.42 2 2 0 0 1 3.58 1.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}
function VmIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="5.5" cy="11.5" r="4.5" /><circle cx="18.5" cy="11.5" r="4.5" />
      <line x1="5.5" y1="16" x2="18.5" y2="16" />
    </svg>
  )
}

/* ── Mock voicemail data (replace with real API when Twilio is set up) ── */
const MOCK_VOICEMAILS = [
  { id: 1, from: 'Unknown Caller',   number: '+15551234567', duration: 47, date: new Date(Date.now() - 86400000 * 18).toISOString(), read: false },
  { id: 2, from: 'Ranch Pet Clinic', number: '+15559876543', duration: 12, date: new Date(Date.now() - 86400000 * 25).toISOString(), read: true  },
]

/* ── Styles ─────────────────────────────────────────────────────── */
const S = {
  page:      { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  filterRow: { display: 'flex', gap: 4, padding: '7px 10px', flexShrink: 0 },
  filterBtn: { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  list:      { flex: 1, overflowY: 'auto', minHeight: 0 },
  empty:     { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, fontSize: 13, color: '#8b96ab' },

  dateHeader: {
    padding: '5px 12px',
    fontSize: 11, fontWeight: 700,
    letterSpacing: 0.3,
    position: 'sticky', top: 0, zIndex: 1,
  },
  row: {
    display: 'flex', alignItems: 'center',
    padding: '10px 12px', gap: 10,
  },
  callIcon: { width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  vmIcon:   { width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowInfo:  { flex: 1, minWidth: 0 },
  rowName:  { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowMeta:  { fontSize: 11, marginTop: 2 },
  rowRight: { textAlign: 'right', flexShrink: 0 },
  rowTime:  { fontSize: 11 },
  rowDur:   { fontSize: 11, marginTop: 2 },
  playBtn:  {
    width: 26, height: 26, borderRadius: 6,
    cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, marginLeft: 4,
  },
  miniPlayer: {
    padding: '10px 14px',
  },
  playerTitle: { fontSize: 11, marginBottom: 6 },
  progressBar: { height: 4, borderRadius: 2, background: 'rgba(79,156,249,0.2)', marginBottom: 6 },
  progressFill:{ height: '100%', background: '#4f9cf9', borderRadius: 2 },
  playerNote:  { fontSize: 10, fontStyle: 'italic' },
}
