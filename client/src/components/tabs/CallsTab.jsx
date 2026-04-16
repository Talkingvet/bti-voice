/* Calls tab — Logs + Voicemails sub-tabs, date-grouped, Zoho-style compact */
import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api'
import { useColors } from '../../useColors'
import { getSocket } from '../../socket'

// Build an authenticated recording URL using a query-param token
// (audio elements and download links can't send Authorization headers)
function recordingUrl(callId) {
  const token = localStorage.getItem('bti_token') || ''
  return `/api/calls/${callId}/recording?token=${encodeURIComponent(token)}`
}

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
  const [calls,       setCalls]      = useState([])
  const [filter,      setFilter]     = useState('all')
  const [voicemails,  setVoicemails] = useState([])
  const [playingVm,   setPlayingVm]  = useState(null)
  const [unreadVm,     setUnreadVm]    = useState(0)
  const [expandedCall, setExpandedCall] = useState(null)
  const [search,       setSearch]       = useState('')

  const loadCalls = useCallback(() => {
    api.calls().then(setCalls).catch(console.error)
  }, [])

  const loadVoicemails = useCallback(() => {
    api.voicemails().then(vms => {
      setVoicemails(vms)
      setUnreadVm(vms.filter(v => !v.played).length)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    loadCalls()
    loadVoicemails()
    const socket = getSocket()
    socket.on('call_logged', loadCalls)
    socket.on('new_voicemail', (vm) => {
      setVoicemails(prev => [vm, ...prev])
      setUnreadVm(n => n + 1)
    })
    socket.on('call_transcribed', ({ call_id, transcription, ai_summary }) => {
      setCalls(prev => prev.map(c =>
        c.id === call_id ? { ...c, transcription, ai_summary } : c
      ))
    })
    return () => {
      socket.off('call_logged', loadCalls)
      socket.off('new_voicemail')
      socket.off('call_transcribed')
    }
  }, [loadCalls, loadVoicemails])

  /* Filter calls */
  const searchLower = search.toLowerCase()
  const filteredCalls = calls.filter(c => {
    if (filter === 'missed')   return c.status === 'missed'
    if (filter === 'inbound')  return c.direction === 'inbound'
    if (filter === 'outbound') return c.direction === 'outbound'
    return true
  }).filter(c => {
    if (!searchLower) return true
    return (
      (c.contact_name   || '').toLowerCase().includes(searchLower) ||
      (c.contact_number || '').toLowerCase().includes(searchLower)
    )
  })

  const callGroups = groupByDate(filteredCalls, 'started_at')
  const vmGroups   = groupByDate(voicemails, 'received_at')

  return (
    <div style={{ ...S.page, background: C.bg }}>

      {/* Sub-tabs */}
      <SubTabs
        active={subTab}
        onChange={setSubTab}
        tabs={[
          { id: 'logs',       label: 'Logs' },
          { id: 'voicemails', label: unreadVm > 0 ? `Voicemails (${unreadVm})` : 'Voicemails' },
        ]}
        C={C}
      />

      {/* ── LOGS ── */}
      {subTab === 'logs' && (
        <>
          {/* Search bar */}
          <div style={{ padding: '8px 10px 0', background: C.panel }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${C.borderSoft}`, borderRadius: 7, padding: '5px 9px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                style={{ border: 'none', outline: 'none', fontSize: 12, background: 'transparent', flex: 1, color: C.text }}
                placeholder="Search by name or number…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: C.textMuted, padding: 0, lineHeight: 1 }} onClick={() => setSearch('')}>×</button>
              )}
            </div>
          </div>

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
                : <CallRow
                  key={row.data.id}
                  call={row.data}
                  expanded={expandedCall === row.data.id}
                  onToggle={() => setExpandedCall(p => p === row.data.id ? null : row.data.id)}
                  C={C}
                />
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
function CallRow({ call, expanded, onToggle, C }) {
  const isMissed  = call.status === 'missed'
  const isInbound = call.direction === 'inbound'
  const color     = isMissed ? '#ef4444' : isInbound ? '#22c55e' : '#4f9cf9'
  const duration  = fmtDuration(call.duration)
  const hasDetail = call.recording_url || call.transcription || call.ai_summary

  return (
    <>
      <div
        style={{ ...S.row, borderBottom: expanded ? 'none' : `1px solid ${C.borderItem}`, cursor: hasDetail ? 'pointer' : 'default' }}
        onClick={hasDetail ? onToggle : undefined}
      >
        <div style={{ ...S.callIcon, color }}>
          <CallDirIcon direction={call.direction} missed={isMissed} />
        </div>
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
        <div style={S.rowRight}>
          <div style={{ ...S.rowTime, color: C.textMuted }}>{fmtTime(call.started_at)}</div>
          {isMissed
            ? <div style={{ ...S.rowDur, color: '#ef4444' }}>Missed</div>
            : <div style={{ ...S.rowDur, color: C.textSec }}>⏱ {duration || '0:00'}</div>
          }
        </div>
        {hasDetail && (
          <div style={{ color: C.textMuted, fontSize: 12, paddingLeft: 4 }}>{expanded ? '▾' : '▸'}</div>
        )}
      </div>

      {expanded && (
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.borderItem}`, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {call.recording_url && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ ...S.rowTime, color: C.textMuted }}>RECORDING</div>
                <a
                  href={recordingUrl(call.id)}
                  download={`call-${call.id}.mp3`}
                  style={{ fontSize: 10, color: '#4f9cf9', textDecoration: 'none', fontWeight: 600 }}
                >
                  ⬇ Download
                </a>
              </div>
              <audio controls style={{ width: '100%', height: 36 }} src={recordingUrl(call.id)} />
            </div>
          )}
          {call.ai_summary && (
            <div>
              <div style={{ ...S.rowTime, color: C.textMuted, marginBottom: 4 }}>AI SUMMARY</div>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{call.ai_summary}</div>
            </div>
          )}
          {call.transcription && (
            <details>
              <summary style={{ fontSize: 11, color: C.textMuted, cursor: 'pointer', userSelect: 'none' }}>Full Transcript</summary>
              <div style={{ fontSize: 11, color: C.textSec, lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap' }}>{call.transcription}</div>
            </details>
          )}
        </div>
      )}
    </>
  )
}

/* ── Voicemail row ───────────────────────────────────────────────── */
function VmRow({ vm, isPlaying, onToggle, C }) {
  const isNew = !vm.played
  const time  = vm.received_at || vm.date

  return (
    <>
      <div style={{
        ...S.row, borderBottom: `1px solid ${C.borderItem}`,
        background: isNew ? 'rgba(79,156,249,0.05)' : 'transparent',
      }}>
        <div style={{ ...S.vmIcon, color: isNew ? '#4f9cf9' : C.textMuted }}>
          <VmIcon />
        </div>
        <div style={S.rowInfo}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...S.rowName, color: C.text }}>
              {vm.contact_name || vm.from || 'Unknown'}
            </span>
            {isNew && (
              <span style={{ fontSize: 9, fontWeight: 700, background: '#4f9cf9', color: 'white', borderRadius: 4, padding: '1px 5px' }}>
                NEW
              </span>
            )}
          </div>
          {vm.from && vm.contact_name && vm.from !== vm.contact_name && (
            <div style={{ ...S.rowMeta, color: C.textSec }}>{vm.from}</div>
          )}
        </div>
        <div style={S.rowRight}>
          <div style={{ ...S.rowTime, color: C.textMuted }}>{time ? fmtTime(time) : ''}</div>
          <div style={{ ...S.rowDur, color: C.textSec }}>⏱ {fmtDuration(vm.duration) || `${vm.duration || 0}s`}</div>
        </div>
        <button
          style={{ ...S.playBtn, background: isPlaying ? '#4f9cf9' : C.surface, color: isPlaying ? 'white' : C.textSec, border: `1px solid ${isPlaying ? '#4f9cf9' : C.borderSoft}` }}
          onClick={onToggle}
          title={isPlaying ? 'Collapse' : 'Play'}
        >
          {isPlaying ? '▾' : '▸'}
        </button>
      </div>

      {/* Inline audio player */}
      {isPlaying && (
        <div style={{ ...S.miniPlayer, background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          {vm.recording_url ? (
            <>
              <audio
                controls
                autoPlay
                style={{ width: '100%', height: 36, outline: 'none' }}
                src={recordingUrl(vm.id)}
              />
              <a
                href={recordingUrl(vm.id)}
                download={`voicemail-${vm.id}.mp3`}
                style={{ display: 'block', marginTop: 6, fontSize: 10, color: '#4f9cf9', textDecoration: 'none', fontWeight: 600 }}
              >
                ⬇ Download voicemail
              </a>
            </>
          ) : (
            <div style={{ ...S.playerNote, color: C.textMuted }}>No recording available.</div>
          )}
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
