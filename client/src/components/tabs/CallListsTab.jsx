/* Call Lists tab — dialer lists (2026-10-03). docs/BTI-Voice-Call-Lists-Plan.md
   Lists on the left (or full screen on phones), the selected list on the right:
   Remaining / Done views, Next + Call, local time, attempts, callback dates.
   Outcomes are recorded by the wrap-up screen / outcome strip in App.jsx — this
   tab only shows state and lets you manage the list. Only mounted when
   features.call_lists is on (BTI). */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { IS_TOUCH as T } from '../../utils/touch'
import { api } from '../../api'
import { useColors } from '../../useColors'
import { useFeatures } from '../../features'
import { getSocket } from '../../socket'
import { useToast } from '../Toast'

export const OUTCOME_LABELS = {
  demo_scheduled: 'Demo scheduled', callback_requested: 'Callback', not_interested: 'Not interested',
  existing_customer_support: 'Existing customer', left_voicemail: 'Left voicemail', wrong_number: 'Wrong number',
  other: 'Other', no_answer: 'No answer', busy: 'Busy', max_attempts: 'Max attempts', removed: 'Removed',
}
const outcomeLabel = c => OUTCOME_LABELS[c] || (c ? c.replace(/_/g, ' ') : '')

function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  const t = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : p
}
function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return 'today ' + time
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''
}

// Contact's local clock, re-rendered once a minute. Hides itself when the zone
// is unknown or the same as ours (nothing to warn about).
function LocalTime({ tz, C }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60000); return () => clearInterval(t) }, [])
  if (!tz) return null
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone
  let s
  try { s = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date()) } catch { return null }
  const diff = tz !== mine
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date())) % 24
  const offHours = h < 8 || h >= 20
  return (
    <span title={'Local time (' + tz.replace(/_/g, ' ') + ')'} style={{ fontSize: 11, color: offHours ? '#f59e0b' : diff ? C.textSec : C.textMuted, whiteSpace: 'nowrap' }}>
      {diff ? '🕒 ' : ''}{s}{diff ? ' local' : ''}
    </span>
  )
}

export default function CallListsTab({ agent, onDialEntry, onMessage }) {
  const C = useColors()
  const { toast } = useToast()
  const toastRef = useRef(toast); toastRef.current = toast   // stable handle — see note on loadLists
  const features = useFeatures()
  const zohoOn = !!features.zoho

  const [lists,      setLists]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [list,       setList]       = useState(null)      // { ...list, entries, view }
  const [view,       setView]       = useState('open')
  const [listLoading, setListLoading] = useState(false)
  const [expanded,   setExpanded]   = useState(null)      // entry id → attempts shown
  const [attempts,   setAttempts]   = useState({})        // entry id → rows
  const [editor,     setEditor]     = useState(null)      // null | { mode: 'create' } | { mode: 'edit', list }
  const [importer,   setImporter]   = useState(false)
  const [adder,      setAdder]      = useState(false)
  const [isWide,     setIsWide]     = useState(window.innerWidth >= 900)

  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // NOTE: `toast` from useToast() is a new object on every provider render, so
  // it must not be a dependency here — it would re-create these callbacks on
  // every toast and the effects below would refetch (and re-toast) in a loop.
  const loadLists = useCallback(async () => {
    try { setLists(await api.callLists()) }
    catch (e) { console.error('[call-lists]', e); toastRef.current.error(e.message || 'Could not load lists') }
    finally { setLoading(false) }
  }, [])

  const loadList = useCallback(async (id, v) => {
    if (!id) { setList(null); return }
    setListLoading(true)
    try { setList(await api.callList(id, v)) }
    catch (e) {
      console.error('[call-lists]', e)
      if (/not found/i.test(e.message || '')) { setSelectedId(null); setList(null); loadLists() }
      else toastRef.current.error(e.message || 'Could not load list')
    } finally { setListLoading(false) }
  }, [loadLists])

  useEffect(() => { loadLists() }, [loadLists])
  useEffect(() => { loadList(selectedId, view) }, [selectedId, view, loadList])

  // Live updates: any change to a list (outcome, hold, import) → refresh.
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const onUpd = (p) => {
      loadLists()
      if (p && selectedId && p.list_id === selectedId) loadList(selectedId, view)
    }
    socket.on('call_list_updated', onUpd)
    return () => socket.off('call_list_updated', onUpd)
  }, [selectedId, view, loadLists, loadList])

  const entries = (list && list.entries) || []
  const nextEntry = useMemo(() => entries.find(e => !e.held_by_agent_id || e.held_by_agent_id === agent.id) || null, [entries, agent.id])

  async function dial(entry) {
    if (!list) return
    try {
      await api.holdCallListEntry(list.id, entry.id)
    } catch (e) {
      toast.error(e.message || 'Someone else is on this one')
      return
    }
    onDialEntry && onDialEntry({ id: entry.id, list_id: list.id, list_name: list.name, display_name: entry.display_name, phone: entry.phone_number })
  }

  async function toggleExpand(entry) {
    const next = expanded === entry.id ? null : entry.id
    setExpanded(next)
    if (next && !attempts[entry.id]) {
      try { setAttempts(a => ({ ...a, [entry.id]: null })); const rows = await api.callListAttempts(list.id, entry.id); setAttempts(a => ({ ...a, [entry.id]: rows })) }
      catch (e) { setAttempts(a => ({ ...a, [entry.id]: [] })) }
    }
  }

  async function removeEntry(entry) {
    if (!window.confirm('Remove ' + (entry.display_name || fmtPhone(entry.phone_number)) + ' from this list?')) return
    try { await api.removeCallListEntry(list.id, entry.id); loadList(list.id, view); loadLists() }
    catch (e) { toast.error(e.message) }
  }
  async function reopenEntry(entry) {
    try { await api.reopenCallListEntry(list.id, entry.id); loadList(list.id, view); loadLists() }
    catch (e) { toast.error(e.message) }
  }
  async function removeCompleted() {
    if (!list || !list.done_count) return
    if (!window.confirm('Remove all ' + list.done_count + ' completed entries from "' + list.name + '"? Call history is kept; the list rows are gone.')) return
    try { const r = await api.removeCompletedCallListEntries(list.id); toast.success('Removed ' + r.removed); loadList(list.id, view); loadLists() }
    catch (e) { toast.error(e.message) }
  }
  async function exportCsv() {
    try {
      const blob = await api.exportCallListCsv(list.id)
      const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = list.name.replace(/[^\w.-]+/g, '_') + '.csv'; a.click(); URL.revokeObjectURL(url)
    } catch (e) { toast.error(e.message) }
  }
  async function deleteList() {
    if (!window.confirm('Delete the list "' + list.name + '"? Entries and their attempt history go with it; call history stays.')) return
    try { await api.deleteCallList(list.id); setSelectedId(null); setList(null); loadLists() }
    catch (e) { toast.error(e.message) }
  }

  const showLists  = isWide || !selectedId
  const showDetail = isWide || !!selectedId

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden', height: '100%', background: C.bg }}>
      {showLists && (
        <div style={{ ...S.page, background: C.bg, ...(isWide ? { width: 320, minWidth: 280, flexShrink: 0, borderRight: '1px solid rgba(128,140,160,0.18)' } : {}) }}>
          <div style={{ ...S.header, background: C.panel, borderBottom: `1px solid ${C.borderItem}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Call Lists</div>
            <button style={{ ...S.primaryBtn }} onClick={() => setEditor({ mode: 'create' })}>+ New list</button>
          </div>
          <div style={S.list}>
            {loading ? <div style={{ ...S.empty, color: C.textMuted }}>Loading…</div>
            : lists.length === 0 ? (
              <div style={{ ...S.empty, color: C.textMuted }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
                <div>No call lists yet.</div>
                <div style={{ fontSize: 11, marginTop: 4, textAlign: 'center', maxWidth: 240 }}>
                  Create one{zohoOn ? ', then import a Zoho CRM view into it' : ''}.
                </div>
              </div>
            ) : lists.map(l => {
              const active = l.id === selectedId
              return (
                <div key={l.id} onClick={() => { setSelectedId(l.id); setView('open'); setExpanded(null) }}
                  style={{ ...S.listRow, background: active ? C.active : 'transparent', borderBottom: `1px solid ${C.borderItem}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                    <div style={{ fontSize: 11, color: C.textSec, marginTop: 2 }}>
                      {l.open_count} left · {l.done_count} done
                      {l.due_count > 0 && <span style={{ color: '#f59e0b', fontWeight: 600 }}> · {l.due_count} due</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 1 }}>
                      {l.visibility === 'all' ? 'Shared with everyone' : l.visibility === 'agents' ? 'Shared with ' + l.agent_ids.length : 'Just ' + (l.is_owner ? 'me' : l.owner_name)}
                      {!l.is_owner && l.visibility !== 'owner' ? ' · by ' + l.owner_name : ''}
                      {l.last_worked_at ? ' · worked ' + fmtWhen(l.last_worked_at) : ''}
                    </div>
                  </div>
                  <div style={{ ...S.countPill, background: l.open_count ? 'rgba(79,156,249,0.15)' : C.surface, color: l.open_count ? '#4f9cf9' : C.textMuted }}>{l.open_count}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showDetail && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!list && !listLoading ? (
            isWide && <div style={{ ...S.empty, color: C.textMuted, flex: 1 }}>Pick a list to work it.</div>
          ) : !list ? <div style={{ ...S.empty, color: C.textMuted, flex: 1 }}>Loading…</div> : (
            <>
              {/* List header */}
              <div style={{ padding: T ? '10px 12px' : '12px 16px 8px', borderBottom: `1px solid ${C.borderItem}`, background: C.panel, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!isWide && <button style={{ ...S.iconBtn, color: C.textSec }} onClick={() => { setSelectedId(null); setList(null) }} title="Back">←</button>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</div>
                    <div style={{ fontSize: 11, color: C.textSec, marginTop: 2 }}>
                      {list.open_count} left · {list.done_count} done
                      {list.zoho_view_name ? ' · Zoho view: ' + list.zoho_view_name : ''}
                      {list.max_attempts ? ' · max ' + list.max_attempts + ' attempts' : ''}
                      {list.last_import_at ? ' · imported ' + fmtWhen(list.last_import_at) : ''}
                    </div>
                  </div>
                  {view === 'open' && nextEntry && (
                    <button style={S.nextBtn} onClick={() => dial(nextEntry)} title={'Call ' + (nextEntry.display_name || fmtPhone(nextEntry.phone_number))}>
                      ▶ Next
                    </button>
                  )}
                </div>
                {list.notes && <div style={{ fontSize: 12, color: C.textSec, marginTop: 6, whiteSpace: 'pre-wrap' }}>{list.notes}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button style={{ ...S.viewBtn, ...(view === 'open' ? S.viewBtnOn : { color: C.textSec, border: `1px solid ${C.borderSoft}` }) }} onClick={() => setView('open')}>Remaining ({list.open_count})</button>
                  <button style={{ ...S.viewBtn, ...(view === 'done' ? S.viewBtnOn : { color: C.textSec, border: `1px solid ${C.borderSoft}` }) }} onClick={() => setView('done')}>Done ({list.done_count})</button>
                  <span style={{ flex: 1 }} />
                  {zohoOn && <button style={{ ...S.smallBtn, color: C.btnText, background: C.btnBg, border: `1px solid ${C.btnBorder}` }} onClick={() => setImporter(true)}>{list.zoho_view_id ? 'Re-import view' : 'Import Zoho view'}</button>}
                  <button style={{ ...S.smallBtn, color: C.btnText, background: C.btnBg, border: `1px solid ${C.btnBorder}` }} onClick={() => setAdder(true)}>+ Add number</button>
                  <MoreMenu C={C} items={[
                    { label: 'Export CSV', onClick: exportCsv },
                    list.is_owner && { label: 'Edit list / sharing', onClick: () => setEditor({ mode: 'edit', list }) },
                    { label: 'Remove completed (' + list.done_count + ')', onClick: removeCompleted, disabled: !list.done_count },
                    list.is_owner && { label: 'Delete list', onClick: deleteList, danger: true },
                  ].filter(Boolean)} />
                </div>
              </div>

              {/* Entries */}
              <div style={S.list}>
                {listLoading && entries.length === 0 ? <div style={{ ...S.empty, color: C.textMuted }}>Loading…</div>
                : entries.length === 0 ? (
                  <div style={{ ...S.empty, color: C.textMuted }}>
                    {view === 'open'
                      ? (list.done_count ? '🎉 Everyone on this list has been reached.' : 'Nothing here yet — ' + (zohoOn ? 'import a Zoho view or add a number.' : 'add a number.'))
                      : 'Nothing completed yet.'}
                  </div>
                ) : entries.map(e => {
                  const due = e.callback_at && new Date(e.callback_at) <= new Date()
                  const heldByOther = e.held_by_agent_id && e.held_by_agent_id !== agent.id
                  const open = expanded === e.id
                  return (
                    <div key={e.id} style={{ borderBottom: `1px solid ${C.borderItem}`, opacity: view === 'done' ? 0.65 : 1 }}>
                      <div style={{ ...S.row, background: open ? C.hover : 'transparent' }} onClick={() => toggleExpand(e)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.display_name || fmtPhone(e.phone_number)}</span>
                            {e.company && <span style={{ fontSize: 11.5, color: C.textSec, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {e.company}</span>}
                            {e.on_other_lists > 0 && <span title="Also on another open list" style={{ ...S.tag, background: C.surface, color: C.textMuted }}>+{e.on_other_lists} list{e.on_other_lists > 1 ? 's' : ''}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 11, color: C.textSec, flexWrap: 'wrap' }}>
                            <span>{fmtPhone(e.phone_number)}</span>
                            <LocalTime tz={e.tz} C={C} />
                            {view === 'open' ? (
                              <>
                                {e.callback_at && <span style={{ color: due ? '#f59e0b' : C.textSec, fontWeight: due ? 700 : 500 }}>{due ? '⏰ call back ' : '↩ call back '}{fmtWhen(e.callback_at)}</span>}
                                {e.attempts > 0
                                  ? <span>{e.attempts} attempt{e.attempts > 1 ? 's' : ''}{e.last_outcome ? ' · ' + outcomeLabel(e.last_outcome) : ''}{e.last_attempt_at ? ' · ' + fmtWhen(e.last_attempt_at) : ''}</span>
                                  : <span style={{ color: C.textMuted }}>not tried · added {fmtDate(e.added_at)}</span>}
                                {heldByOther && <span style={{ color: '#f59e0b', fontWeight: 600 }}>📞 {e.held_by_name} is on it</span>}
                              </>
                            ) : (
                              <span>{outcomeLabel(e.last_outcome)}{e.closed_by_name ? ' · ' + e.closed_by_name : ''}{e.closed_at ? ' · ' + fmtWhen(e.closed_at) : ''} · {e.attempts} attempt{e.attempts === 1 ? '' : 's'}</span>
                            )}
                          </div>
                        </div>
                        {view === 'open' ? (
                          <button style={{ ...S.callBtn, opacity: heldByOther ? 0.4 : 1 }} disabled={!!heldByOther} onClick={ev => { ev.stopPropagation(); dial(e) }} title="Call">📞</button>
                        ) : (
                          <button style={{ ...S.smallBtn, color: C.btnText, background: C.btnBg, border: `1px solid ${C.btnBorder}` }} onClick={ev => { ev.stopPropagation(); reopenEntry(e) }}>Reopen</button>
                        )}
                      </div>
                      {open && (
                        <div style={{ padding: '4px 14px 10px', background: C.hover, fontSize: 11.5, color: C.textSec }}>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                            <span>Added {fmtWhen(e.added_at)}</span>
                            {e.zoho_record_id && <span>Zoho {e.zoho_module === 'Leads' ? 'lead' : 'contact'}</span>}
                            {e.region && <span>{e.region}</span>}
                            <span style={{ flex: 1 }} />
                            {onMessage && <button style={{ ...S.linkBtn, color: '#4f9cf9' }} onClick={() => onMessage(e.phone_number)}>Message</button>}
                            {view === 'open' && <button style={{ ...S.linkBtn, color: C.textMuted }} onClick={() => removeEntry(e)}>Remove from list</button>}
                          </div>
                          {attempts[e.id] === null ? <div>Loading history…</div>
                          : (attempts[e.id] || []).length === 0 ? <div style={{ color: C.textMuted }}>No attempts yet.</div>
                          : (attempts[e.id] || []).map(a => (
                            <div key={a.id} style={{ display: 'flex', gap: 8, padding: '3px 0', borderTop: `1px solid ${C.borderItem}` }}>
                              <span style={{ minWidth: 92, color: C.textMuted }}>{fmtWhen(a.created_at)}</span>
                              <span style={{ fontWeight: 600, color: C.text }}>{outcomeLabel(a.outcome)}</span>
                              <span>{a.agent_name}</span>
                              {a.callback_at && <span>→ {fmtWhen(a.callback_at)}</span>}
                              {a.note && <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>“{a.note}”</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {editor && (
        <ListEditor C={C} agent={agent} editing={editor.mode === 'edit' ? editor.list : null}
          onClose={() => setEditor(null)}
          onSaved={(saved) => { setEditor(null); loadLists(); if (saved) { setSelectedId(saved.id); setView('open'); if (editor.mode === 'create' && zohoOn) setTimeout(() => setImporter(true), 50) } }} />
      )}
      {importer && list && <ZohoImporter C={C} list={list} onClose={() => setImporter(false)} onDone={() => { setImporter(false); loadList(list.id, view); loadLists() }} />}
      {adder && list && <NumberAdder C={C} list={list} onClose={() => setAdder(false)} onDone={() => { setAdder(false); loadList(list.id, view); loadLists() }} />}
    </div>
  )
}

/* ── "⋯" menu ─────────────────────────────────────────────────────────────── */
function MoreMenu({ C, items }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button style={{ ...S.smallBtn, color: C.btnText, background: C.btnBg, border: `1px solid ${C.btnBorder}`, padding: '4px 9px' }} onClick={() => setOpen(o => !o)} title="More">⋯</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, minWidth: 190, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', padding: 4 }}>
          {items.map((it, i) => (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12.5, background: 'transparent', border: 'none', cursor: it.disabled ? 'default' : 'pointer', color: it.danger ? '#ef4444' : C.text, opacity: it.disabled ? 0.45 : 1, borderRadius: 6 }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Create / edit list ───────────────────────────────────────────────────── */
function ListEditor({ C, agent, editing, onClose, onSaved }) {
  const { toast } = useToast()
  const [name,        setName]        = useState(editing ? editing.name : '')
  const [notes,       setNotes]       = useState(editing ? editing.notes || '' : '')
  const [visibility,  setVisibility]  = useState(editing ? editing.visibility : 'owner')
  const [agentIds,    setAgentIds]    = useState(editing ? (editing.agent_ids || []).map(String) : [])
  const [maxAttempts, setMaxAttempts] = useState(editing && editing.max_attempts ? String(editing.max_attempts) : '')
  const [agents,      setAgents]      = useState([])
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    api.agents().then(rows => setAgents((rows || []).filter(a => a.id !== agent.id && a.is_active !== false))).catch(() => {})
  }, [agent.id])

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    const data = { name: name.trim(), notes: notes.trim() || null, visibility, agent_ids: visibility === 'agents' ? agentIds.map(Number) : [], max_attempts: maxAttempts ? Number(maxAttempts) : null }
    try {
      const saved = editing ? await api.updateCallList(editing.id, data) : await api.createCallList(data)
      onSaved(saved)
    } catch (e) { toast.error(e.message || 'Save failed'); setSaving(false) }
  }

  return (
    <Modal C={C} title={editing ? 'Edit list' : 'New call list'} onClose={onClose}>
      <label style={{ ...S.label, color: C.textMuted }}>NAME</label>
      <input autoFocus style={inputStyle(C)} placeholder="e.g. Florida vets — no PIMS" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      <label style={{ ...S.label, color: C.textMuted, marginTop: 10 }}>NOTES / TALKING POINTS (optional)</label>
      <textarea style={{ ...inputStyle(C), minHeight: 56, resize: 'vertical' }} placeholder="Shown at the top of the list while you work it" value={notes} onChange={e => setNotes(e.target.value)} />
      <label style={{ ...S.label, color: C.textMuted, marginTop: 10 }}>WHO CAN SEE AND WORK THIS LIST</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['owner', 'Just me'], ['all', 'Everyone'], ['agents', 'Pick people']].map(([v, l]) => (
          <button key={v} onClick={() => setVisibility(v)} style={{ ...S.pill, background: visibility === v ? 'rgba(79,156,249,0.18)' : C.surface, border: '1px solid ' + (visibility === v ? '#4f9cf9' : C.borderSoft), color: visibility === v ? '#4f9cf9' : C.textSec }}>{l}</button>
        ))}
      </div>
      {visibility === 'agents' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {agents.length === 0 && <span style={{ fontSize: 11, color: C.textMuted }}>No other agents.</span>}
          {agents.map(a => {
            const on = agentIds.includes(String(a.id))
            return <button key={a.id} onClick={() => setAgentIds(ids => on ? ids.filter(x => x !== String(a.id)) : [...ids, String(a.id)])}
              style={{ ...S.pill, background: on ? 'rgba(79,156,249,0.18)' : C.surface, border: '1px solid ' + (on ? '#4f9cf9' : C.borderSoft), color: on ? '#4f9cf9' : C.textSec }}>{a.name}</button>
          })}
        </div>
      )}
      <label style={{ ...S.label, color: C.textMuted, marginTop: 10 }}>MAX ATTEMPTS (optional)</label>
      <input type="number" min="1" max="99" style={{ ...inputStyle(C), width: 110 }} placeholder="off" value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} />
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>After this many no-answer / voicemail attempts the entry moves to Done on its own. Leave blank to keep trying.</div>
      <div style={S.modalBtns}>
        <button style={{ ...S.smallBtn, color: C.textSec }} onClick={onClose} disabled={saving}>Cancel</button>
        <button style={{ ...S.primaryBtn, opacity: saving || !name.trim() ? 0.5 : 1 }} onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : editing ? 'Save' : 'Create'}</button>
      </div>
    </Modal>
  )
}

/* ── Zoho view import ─────────────────────────────────────────────────────── */
function ZohoImporter({ C, list, onClose, onDone }) {
  const { toast } = useToast()
  const [module_, setModule]  = useState(list.zoho_module || 'Leads')
  const [views,   setViews]   = useState(null)
  const [viewId,  setViewId]  = useState(list.zoho_view_id || '')
  const [filter,  setFilter]  = useState('')
  const [busy,    setBusy]    = useState(false)
  const [result,  setResult]  = useState(null)

  const [viewsErr, setViewsErr] = useState('')
  useEffect(() => {
    setViews(null); setViewsErr('')
    api.callListZohoViews(module_).then(r => setViews(r.views || [])).catch(e => { setViews([]); setViewsErr(e.message || 'Could not load Zoho views') })
  }, [module_])

  async function run() {
    const v = (views || []).find(x => x.id === viewId)
    if (!v) return
    setBusy(true)
    try {
      const r = await api.importCallListZoho(list.id, { module: module_, view_id: v.id, view_name: v.name })
      setResult(r)
    } catch (e) { toast.error(e.message || 'Import failed') }
    finally { setBusy(false) }
  }

  const shown = (views || []).filter(v => !filter || v.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <Modal C={C} title={'Import a Zoho CRM view into "' + list.name + '"'} onClose={onClose}>
      {result ? (
        <>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
            <b>{result.added}</b> added to the list.<br />
            {result.skipped_duplicate > 0 && <>{result.skipped_duplicate} already on it · </>}
            {result.without_phone > 0 && <>{result.without_phone} had no phone · </>}
            {result.skipped_invalid > 0 && <>{result.skipped_invalid} had a number we couldn't dial · </>}
            {result.fetched} records in the view.
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>Use "Re-import view" any time — only new members get added; existing entries and their attempts are untouched.</div>
          <div style={S.modalBtns}><button style={S.primaryBtn} onClick={onDone}>Done</button></div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {['Leads', 'Contacts'].map(m => (
              <button key={m} onClick={() => { setModule(m); setViewId('') }} style={{ ...S.pill, background: module_ === m ? 'rgba(79,156,249,0.18)' : C.surface, border: '1px solid ' + (module_ === m ? '#4f9cf9' : C.borderSoft), color: module_ === m ? '#4f9cf9' : C.textSec }}>{m}</button>
            ))}
          </div>
          <input style={inputStyle(C)} placeholder="Filter views…" value={filter} onChange={e => setFilter(e.target.value)} />
          <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 6, border: `1px solid ${C.borderSoft}`, borderRadius: 8 }}>
            {views === null ? <div style={{ padding: 12, fontSize: 12, color: C.textMuted }}>Loading views from Zoho…</div>
            : viewsErr ? <div style={{ padding: 12, fontSize: 12, color: '#ef4444', lineHeight: 1.5 }}>{viewsErr}</div>
            : shown.length === 0 ? <div style={{ padding: 12, fontSize: 12, color: C.textMuted }}>No views.</div>
            : shown.map(v => (
              <div key={v.id} onClick={() => setViewId(v.id)} style={{ padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', color: C.text, background: viewId === v.id ? C.active : 'transparent', borderBottom: `1px solid ${C.borderItem}`, display: 'flex', justifyContent: 'space-between' }}>
                <span>{v.name}</span>{v.system_defined && <span style={{ fontSize: 10.5, color: C.textMuted }}>built-in</span>}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>Build the search as a custom view in Zoho ("saved search"), then pick it here. Records without a phone are skipped; the Zoho record stays linked so wrap-ups log to it.</div>
          <div style={S.modalBtns}>
            <button style={{ ...S.smallBtn, color: C.textSec }} onClick={onClose} disabled={busy}>Cancel</button>
            <button style={{ ...S.primaryBtn, opacity: busy || !viewId ? 0.5 : 1 }} onClick={run} disabled={busy || !viewId}>{busy ? 'Importing…' : 'Import'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

/* ── Add a number by hand ─────────────────────────────────────────────────── */
function NumberAdder({ C, list, onClose, onDone }) {
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function run() {
    const rows = text.split(/\n/).map(l => l.trim()).filter(Boolean).map(l => {
      // "Name, Company, 239-555-1212" or "239-555-1212 Name" — the phone is whatever has 10+ digits.
      const m = l.match(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/)
      if (!m) return null
      const rest = l.replace(m[0], '').replace(/^[\s,;|-]+|[\s,;|-]+$/g, '')
      const [name, company] = rest.split(/\s*[,;|]\s*/)
      return { phone: m[0], name: name || null, company: company || null }
    }).filter(Boolean)
    if (!rows.length) { toast.error('No phone numbers found'); return }
    setBusy(true)
    try { const r = await api.addCallListEntries(list.id, rows); toast.success(r.added + ' added' + (r.skipped_duplicate ? ', ' + r.skipped_duplicate + ' already on the list' : '')); onDone() }
    catch (e) { toast.error(e.message); setBusy(false) }
  }
  return (
    <Modal C={C} title={'Add to "' + list.name + '"'} onClose={onClose}>
      <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>One per line: <code>Name, Company, phone</code> — or just a phone number. Paste from a spreadsheet works.</div>
      <textarea autoFocus style={{ ...inputStyle(C), minHeight: 120, resize: 'vertical', fontFamily: 'inherit' }} value={text} onChange={e => setText(e.target.value)} placeholder={'Dr. Smith, Coastal Animal Hospital, (239) 555-1212\n239-555-3434'} />
      <div style={S.modalBtns}>
        <button style={{ ...S.smallBtn, color: C.textSec }} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={{ ...S.primaryBtn, opacity: busy || !text.trim() ? 0.5 : 1 }} onClick={run} disabled={busy || !text.trim()}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
    </Modal>
  )
}

/* ── Modal shell ──────────────────────────────────────────────────────────── */
function Modal({ C, title, onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, ...(T ? S.modalMobile : {}), background: C.panel, border: `1px solid ${C.border}`, color: C.text }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <button style={{ ...S.iconBtn, color: C.textMuted }} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputStyle = C => ({ width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', background: C.inputBg, border: `1px solid ${C.inputBorder}`, color: C.text })

const S = {
  page:     { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 },
  header:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: T ? '10px 12px' : '12px 14px', flexShrink: 0 },
  list:     { flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 76 },
  empty:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, fontSize: 13, padding: 16, textAlign: 'center' },
  listRow:  { display: 'flex', alignItems: 'center', gap: 10, padding: T ? '12px 14px' : '10px 14px', cursor: 'pointer' },
  countPill:{ minWidth: 28, textAlign: 'center', padding: '3px 8px', borderRadius: 12, fontSize: 12, fontWeight: 700 },
  row:      { display: 'flex', alignItems: 'center', gap: 10, padding: T ? '11px 14px' : '9px 14px', cursor: 'pointer' },
  tag:      { fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap' },
  callBtn:  { width: T ? 44 : 34, height: T ? 44 : 34, borderRadius: '50%', border: 'none', background: '#22c55e', color: '#fff', fontSize: T ? 18 : 15, cursor: 'pointer', flexShrink: 0 },
  nextBtn:  { padding: T ? '10px 16px' : '8px 14px', borderRadius: 20, border: 'none', background: '#22c55e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  primaryBtn:{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4f9cf9', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  smallBtn: { padding: '5px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: '1px solid transparent' },
  viewBtn:  { padding: '5px 11px', borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: 'transparent' },
  viewBtnOn:{ background: 'rgba(79,156,249,0.18)', border: '1px solid #4f9cf9', color: '#4f9cf9' },
  pill:     { padding: '5px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  iconBtn:  { background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', padding: '2px 6px' },
  linkBtn:  { background: 'transparent', border: 'none', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0 },
  label:    { display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  overlay:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal:    { width: '100%', maxWidth: 440, borderRadius: 12, padding: 16, boxShadow: '0 16px 48px rgba(0,0,0,0.35)', maxHeight: '90dvh', overflowY: 'auto' },
  modalMobile: { maxWidth: '100%', alignSelf: 'flex-end', borderRadius: '14px 14px 0 0' },
  modalBtns:{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 },
}
