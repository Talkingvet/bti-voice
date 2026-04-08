import { useState } from 'react'
import { useColors } from '../../useColors'

const MOCK = [
  { id: 1, from: 'Unknown Caller',  number: '+15551234567', duration: 47, date: new Date(Date.now() - 3600000).toISOString(),  read: false },
  { id: 2, from: 'Ranch Pet Clinic',number: '+15559876543', duration: 12, date: new Date(Date.now() - 86400000).toISOString(), read: true  },
]

export default function VoicemailsTab() {
  const C = useColors()
  const [selected,   setSelected]   = useState(null)
  const [voicemails, setVoicemails] = useState(MOCK)
  const [playing,    setPlaying]    = useState(false)

  const unreadCount = voicemails.filter(v => !v.read).length

  function selectVm(vm) {
    setSelected(vm)
    setVoicemails(prev => prev.map(v => v.id === vm.id ? { ...v, read: true } : v))
    setPlaying(false)
  }

  return (
    <div style={S.wrap}>
      {/* List */}
      <div style={{ ...S.list, background: C.panel, borderRight: `1px solid ${C.border}` }}>
        <div style={{ ...S.listHeader, borderBottom: `1px solid ${C.borderSoft}` }}>
          <div style={{ ...S.listTitle, color: C.textMuted }}>
            Voicemail
            {unreadCount > 0 && <span style={S.unreadBadge}>{unreadCount} new</span>}
          </div>
        </div>
        <div style={S.items}>
          {voicemails.length === 0 ? (
            <div style={{ ...S.empty, color: C.emptyText }}>No voicemails</div>
          ) : voicemails.map(vm => (
            <div
              key={vm.id}
              style={{ ...S.item, borderBottom: `1px solid ${C.borderItem}`, ...(selected?.id === vm.id ? { background: C.active, borderLeft: '3px solid #3b82f6' } : { background: !vm.read ? C.hover : 'transparent' }) }}
              onClick={() => selectVm(vm)}
            >
              <div style={S.vmIcon}>{vm.read ? <VmReadIcon /> : <VmNewIcon />}</div>
              <div style={S.vmInfo}>
                <div style={{ ...S.vmFrom, color: C.text }}>{vm.from}</div>
                <div style={{ ...S.vmNum, color: C.textSec }}>{vm.number}</div>
              </div>
              <div style={S.vmRight}>
                <div style={{ ...S.vmTime, color: C.textMuted }}>{timeAgo(vm.date)}</div>
                <div style={{ ...S.vmDur, color: C.textSec }}>{vm.duration}s</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div style={{ ...S.detail, background: C.bg }}>
        {!selected ? (
          <div style={{ ...S.detailEmpty, color: C.emptyText }}>
            <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.3 }}>📭</div>
            <div>Select a voicemail to listen</div>
          </div>
        ) : (
          <div style={S.player}>
            <div style={{ ...S.playerAvatar, background: C.active }}><VmBigIcon /></div>
            <div style={{ ...S.playerFrom, color: C.text }}>{selected.from}</div>
            <div style={{ ...S.playerNum, color: C.textSec }}>{selected.number}</div>
            <div style={{ ...S.playerDate, color: C.textMuted }}>{new Date(selected.date).toLocaleString()}</div>

            <div style={S.waveform}>
              {Array.from({ length: 40 }).map((_, i) => (
                <div key={i} style={{ ...S.waveBar, height: 6 + Math.sin(i * 0.8) * 14 + Math.random() * 8 }} />
              ))}
            </div>
            <div style={{ ...S.playerDur, color: C.textSec }}>{formatDur(selected.duration)}</div>

            <div style={S.controls}>
              <button style={{ ...S.ctrlBtn, background: C.btnBg, border: `1px solid ${C.btnBorder}`, color: C.textSec }}>⏮</button>
              <button style={S.playBtn} onClick={() => setPlaying(p => !p)}>
                {playing ? '⏸' : '▶'}
              </button>
              <button style={{ ...S.ctrlBtn, background: C.btnBg, border: `1px solid ${C.btnBorder}`, color: C.textSec }}>⏭</button>
            </div>

            <div style={S.noticeBox}>
              Full voicemail playback requires Twilio Voice to be configured with a phone number.
            </div>

            <div style={S.actions}>
              <ActionBtn label="📞 Call back" C={C} />
              <ActionBtn label="💬 SMS" C={C} />
              <ActionBtn label="🗑 Delete" C={C} danger />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ActionBtn({ label, C, danger }) {
  return (
    <button style={{
      ...S.actionBtn,
      background: C.btnBg,
      border: `1px solid ${danger ? '#fecaca' : C.btnBorder}`,
      color: danger ? '#ef4444' : C.btnText,
    }}>
      {label}
    </button>
  )
}

function VmReadIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><circle cx="5.5" cy="11.5" r="4.5"/><circle cx="18.5" cy="11.5" r="4.5"/><line x1="5.5" y1="16" x2="18.5" y2="16"/></svg>
}
function VmNewIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><circle cx="5.5" cy="11.5" r="4.5"/><circle cx="18.5" cy="11.5" r="4.5"/><line x1="5.5" y1="16" x2="18.5" y2="16"/></svg>
}
function VmBigIcon() {
  return <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.8"><circle cx="5.5" cy="11.5" r="4.5"/><circle cx="18.5" cy="11.5" r="4.5"/><line x1="5.5" y1="16" x2="18.5" y2="16"/></svg>
}

function formatDur(s) { const m = Math.floor(s/60); return `${m}:${String(s%60).padStart(2,'0')}` }
function timeAgo(d) {
  const diff = Date.now() - new Date(d), m = Math.floor(diff/60000)
  if (m < 60) return `${m}m ago`; const h = Math.floor(m/60)
  if (h < 24) return `${h}h ago`; return `${Math.floor(h/24)}d ago`
}

const S = {
  wrap:   { display: 'flex', flex: 1, height: '100%', overflow: 'hidden' },
  list:   { width: 240, display: 'flex', flexDirection: 'column', flexShrink: 0 },
  listHeader: { padding: '14px 14px 10px' },
  listTitle: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 8 },
  unreadBadge: { background: '#3b82f6', color: 'white', borderRadius: 8, padding: '1px 6px', fontSize: 9, fontWeight: 800 },
  items: { flex: 1, overflowY: 'auto' },
  empty: { padding: 20, textAlign: 'center', fontSize: 12 },
  item:  { padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 },
  vmIcon: { flexShrink: 0 },
  vmInfo: { flex: 1, minWidth: 0 },
  vmFrom: { fontSize: 13, fontWeight: 600 },
  vmNum:  { fontSize: 11 },
  vmRight:{ textAlign: 'right', flexShrink: 0 },
  vmTime: { fontSize: 10 },
  vmDur:  { fontSize: 10, marginTop: 2 },
  detail: { flex: 1, overflow: 'auto', display: 'flex' },
  detailEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 13 },
  player: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px 28px 20px' },
  playerAvatar: { width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  playerFrom: { fontSize: 18, fontWeight: 700 },
  playerNum:  { fontSize: 13, marginTop: 2 },
  playerDate: { fontSize: 11, marginTop: 4, marginBottom: 20 },
  waveform: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 48, marginBottom: 8 },
  waveBar:  { width: 3, background: '#3b82f6', borderRadius: 2, minHeight: 4, opacity: 0.6 },
  playerDur: { fontSize: 12, marginBottom: 16 },
  controls: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 },
  ctrlBtn:  { width: 36, height: 36, borderRadius: '50%', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  playBtn:  { width: 48, height: 48, borderRadius: '50%', border: 'none', background: '#3b82f6', color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  noticeBox:{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '8px 14px', fontSize: 11, color: '#92400e', textAlign: 'center', maxWidth: 300, marginBottom: 16 },
  actions:  { display: 'flex', gap: 8 },
  actionBtn:{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
}
