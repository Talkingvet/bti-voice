// Call Lists — /api/call-lists (dialer lists, 2026-10-03)
//
// A list of people to call, worked from inside the app. See
// docs/BTI-Voice-Call-Lists-Plan.md. Gated by the `call_lists` feature
// (ENABLE_CALL_LISTS=true) — everything 404s otherwise, same as Huddle.
//
//   GET    /                          lists I can see (+ open/done counts)
//   POST   /                          { name, notes, visibility, agent_ids, max_attempts }
//   PATCH  /:id                       owner only — same fields
//   DELETE /:id                       owner only — archive
//   GET    /:id?view=open|done        list + entries (sorted for working) + tz + on_other_lists
//   POST   /:id/entries               { entries: [{ phone, name, company, region }] } manual add
//   DELETE /:id/entries/:eid          remove one entry (closing outcome 'removed')
//   POST   /:id/remove-completed      delete every 'done' entry (Danny's button)
//   POST   /:id/entries/:eid/hold     claim it while dialling (shared lists)
//   POST   /:id/entries/:eid/release  un-claim without an outcome ("skip for now")
//   POST   /:id/entries/:eid/outcome  { outcome, note, callback_at, call_id }
//   POST   /:id/entries/:eid/reopen   back to Remaining
//   GET    /:id/export.csv            whole list with outcomes
//   GET    /zoho/views?module=Leads   Zoho custom views (404 without Zoho)
//   POST   /:id/import/zoho           { module, view_id, view_name } → adds view members
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../auth');
const { featureOn } = require('../helpers/deploySettings');
const { phoneVariants } = require('../helpers/phone');
const { tzForPhone } = require('../helpers/areaCodeTz');
const CL = require('../helpers/callLists');

const router = express.Router();

router.use((req, res, next) => {
  if (!featureOn('call_lists')) return res.status(404).json({ error: 'Not found' });
  next();
});
router.use(requireAuth);

const HOLD_STALE_MIN = 30;
const VISIBILITIES = new Set(['owner', 'all', 'agents']);

// SQL fragment: lists the current agent may see. Params: $1 = agent id.
const VISIBLE_SQL =
  "(l.owner_agent_id = $1 OR l.visibility = 'all' OR " +
  " EXISTS (SELECT 1 FROM call_list_agents la WHERE la.list_id = l.id AND la.agent_id = $1))";

async function loadVisibleList(listId, agentId) {
  const { rows: [l] } = await pool.query(
    'SELECT l.*, a.name AS owner_name FROM call_lists l LEFT JOIN agents a ON a.id = l.owner_agent_id ' +
    'WHERE l.id = $2 AND l.archived_at IS NULL AND ' + VISIBLE_SQL, [agentId, listId]);
  return l || null;
}

function intOrNull(v) { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; }

// ── Lists ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT l.*, a.name AS owner_name, ' +
      '  (SELECT COUNT(*) FROM call_list_entries e WHERE e.list_id = l.id AND e.status = \'open\')::int AS open_count, ' +
      '  (SELECT COUNT(*) FROM call_list_entries e WHERE e.list_id = l.id AND e.status = \'done\')::int AS done_count, ' +
      '  (SELECT COUNT(*) FROM call_list_entries e WHERE e.list_id = l.id AND e.status = \'open\' AND e.callback_at IS NOT NULL AND e.callback_at <= NOW())::int AS due_count, ' +
      '  (SELECT MAX(created_at) FROM call_list_attempts at JOIN call_list_entries e ON e.id = at.entry_id WHERE e.list_id = l.id) AS last_worked_at, ' +
      '  COALESCE((SELECT array_agg(agent_id) FROM call_list_agents la WHERE la.list_id = l.id), \'{}\') AS agent_ids ' +
      'FROM call_lists l LEFT JOIN agents a ON a.id = l.owner_agent_id ' +
      'WHERE l.archived_at IS NULL AND ' + VISIBLE_SQL + ' ORDER BY l.created_at DESC', [req.agent.id]);
    res.json(rows.map(r => ({ ...r, is_owner: r.owner_agent_id === req.agent.id })));
  } catch (e) { console.error('[call-lists] list', e.message); res.status(500).json({ error: e.message }); }
});

async function saveAgents(client, listId, agentIds) {
  await client.query('DELETE FROM call_list_agents WHERE list_id = $1', [listId]);
  const ids = [...new Set((agentIds || []).map(n => parseInt(n, 10)).filter(Number.isInteger))];
  for (const id of ids) {
    await client.query('INSERT INTO call_list_agents (list_id, agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [listId, id]);
  }
}

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const visibility = VISIBILITIES.has(b.visibility) ? b.visibility : 'owner';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [l] } = await client.query(
      'INSERT INTO call_lists (name, notes, owner_agent_id, visibility, max_attempts) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, b.notes ? String(b.notes) : null, req.agent.id, visibility, intOrNull(b.max_attempts)]);
    if (visibility === 'agents') await saveAgents(client, l.id, b.agent_ids);
    await client.query('COMMIT');
    CL.notifyList(l.id);
    res.status(201).json({ ...l, is_owner: true, open_count: 0, done_count: 0 });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[call-lists] create', e.message); res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.patch('/:id', async (req, res) => {
  const listId = intOrNull(req.params.id);
  const b = req.body || {};
  const client = await pool.connect();
  try {
    const { rows: [l] } = await client.query('SELECT * FROM call_lists WHERE id = $1 AND archived_at IS NULL', [listId]);
    if (!l) return res.status(404).json({ error: 'List not found' });
    if (l.owner_agent_id !== req.agent.id) return res.status(403).json({ error: 'Only the list owner can change it' });
    await client.query('BEGIN');
    const name = b.name !== undefined ? String(b.name).trim() : l.name;
    if (!name) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'name required' }); }
    const visibility = b.visibility !== undefined && VISIBILITIES.has(b.visibility) ? b.visibility : l.visibility;
    const maxAttempts = b.max_attempts !== undefined ? intOrNull(b.max_attempts) : l.max_attempts;
    const notes = b.notes !== undefined ? (b.notes ? String(b.notes) : null) : l.notes;
    const { rows: [updated] } = await client.query(
      'UPDATE call_lists SET name=$2, notes=$3, visibility=$4, max_attempts=$5 WHERE id=$1 RETURNING *',
      [listId, name, notes, visibility, maxAttempts]);
    if (b.agent_ids !== undefined || visibility !== 'agents') await saveAgents(client, listId, visibility === 'agents' ? b.agent_ids : []);
    await client.query('COMMIT');
    CL.notifyList(listId);
    res.json({ ...updated, is_owner: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[call-lists] patch', e.message); res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/:id', async (req, res) => {
  const listId = intOrNull(req.params.id);
  try {
    const { rows: [l] } = await pool.query('SELECT * FROM call_lists WHERE id = $1 AND archived_at IS NULL', [listId]);
    if (!l) return res.status(404).json({ error: 'List not found' });
    if (l.owner_agent_id !== req.agent.id) return res.status(403).json({ error: 'Only the list owner can delete it' });
    await pool.query('UPDATE call_lists SET archived_at = NOW() WHERE id = $1', [listId]);
    CL.notifyList(listId);
    res.json({ success: true });
  } catch (e) { console.error('[call-lists] delete', e.message); res.status(500).json({ error: e.message }); }
});

// ── One list with entries ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const listId = intOrNull(req.params.id);
  const view = req.query.view === 'done' ? 'done' : 'open';
  try {
    const l = await loadVisibleList(listId, req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const { rows: entries } = await pool.query(
      'SELECT e.*, h.name AS held_by_name, c.name AS closed_by_name, ' +
      '  (SELECT COUNT(*) FROM call_list_entries o JOIN call_lists ol ON ol.id = o.list_id ' +
      '    WHERE o.phone_number = e.phone_number AND o.list_id <> e.list_id AND o.status = \'open\' AND ol.archived_at IS NULL)::int AS on_other_lists ' +
      'FROM call_list_entries e ' +
      'LEFT JOIN agents h ON h.id = e.held_by_agent_id LEFT JOIN agents c ON c.id = e.closed_by_agent_id ' +
      'WHERE e.list_id = $1 AND e.status = $2', [listId, view]);
    const now = Date.now();
    const staleCut = now - HOLD_STALE_MIN * 60 * 1000;
    const out = entries.map(e => ({
      ...e,
      tz: tzForPhone(e.phone_number, e.region),
      // A hold older than 30 min is treated as released (someone closed the app mid-call).
      held_by_agent_id: e.held_at && new Date(e.held_at).getTime() < staleCut ? null : e.held_by_agent_id,
      held_by_name:     e.held_at && new Date(e.held_at).getTime() < staleCut ? null : e.held_by_name,
    }));
    if (view === 'open') out.sort((a, b) => CL.compareEntries(a, b, now));
    else out.sort((a, b) => new Date(b.closed_at || 0) - new Date(a.closed_at || 0));
    const { rows: agentRows } = await pool.query('SELECT agent_id FROM call_list_agents WHERE list_id = $1', [listId]);
    const { rows: [counts] } = await pool.query(
      'SELECT COUNT(*) FILTER (WHERE status=\'open\')::int AS open_count, COUNT(*) FILTER (WHERE status=\'done\')::int AS done_count ' +
      'FROM call_list_entries WHERE list_id = $1', [listId]);
    res.json({ ...l, ...counts, is_owner: l.owner_agent_id === req.agent.id, agent_ids: agentRows.map(r => r.agent_id), view, entries: out });
  } catch (e) { console.error('[call-lists] get', e.message); res.status(500).json({ error: e.message }); }
});

// Attempt history for one entry (shown when a row is expanded).
router.get('/:id/entries/:eid/attempts', async (req, res) => {
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const { rows } = await pool.query(
      'SELECT at.*, a.name AS agent_name FROM call_list_attempts at LEFT JOIN agents a ON a.id = at.agent_id ' +
      'WHERE at.entry_id = $1 ORDER BY at.created_at DESC', [intOrNull(req.params.eid)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Adding entries ────────────────────────────────────────────────────────────
// Shared by manual add + Zoho import. rows: [{ phone, name, company, region, zoho_record_id, zoho_module }]
// Returns { added, skipped_duplicate, skipped_invalid }.
async function addEntries(listId, rows) {
  const { rows: [{ batch }] } = await pool.query(
    'SELECT COALESCE(MAX(import_batch), 0) + 1 AS batch FROM call_list_entries WHERE list_id = $1', [listId]);
  let added = 0, dup = 0, invalid = 0;
  for (const r of rows) {
    const { e164, variants } = phoneVariants(r.phone);
    if (!/^\+1\d{10}$/.test(e164)) { invalid++; continue; }
    const { rows: [c] } = await pool.query('SELECT id, name FROM contacts WHERE phone_number = ANY($1::text[]) LIMIT 1', [variants]);
    const { rowCount } = await pool.query(
      'INSERT INTO call_list_entries (list_id, contact_id, phone_number, display_name, company, region, zoho_record_id, zoho_module, import_batch) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (list_id, phone_number) DO NOTHING',
      [listId, c ? c.id : null, e164, (r.name || (c && c.name) || '').trim() || null, r.company || null, r.region || null,
       r.zoho_record_id || null, r.zoho_module || null, batch]);
    if (rowCount) added++; else dup++;
  }
  if (added) CL.notifyList(listId);
  return { added, skipped_duplicate: dup, skipped_invalid: invalid, batch };
}

router.post('/:id/entries', async (req, res) => {
  const listId = intOrNull(req.params.id);
  const rows = Array.isArray(req.body && req.body.entries) ? req.body.entries : [];
  if (!rows.length) return res.status(400).json({ error: 'entries required' });
  try {
    const l = await loadVisibleList(listId, req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    res.json(await addEntries(listId, rows.slice(0, 2000)));
  } catch (e) { console.error('[call-lists] add', e.message); res.status(500).json({ error: e.message }); }
});

router.delete('/:id/entries/:eid', async (req, res) => {
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const { rowCount } = await pool.query('DELETE FROM call_list_entries WHERE id = $1 AND list_id = $2', [intOrNull(req.params.eid), l.id]);
    CL.notifyList(l.id);
    res.json({ success: true, removed: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/remove-completed', async (req, res) => {
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const { rowCount } = await pool.query('DELETE FROM call_list_entries WHERE list_id = $1 AND status = \'done\'', [l.id]);
    CL.notifyList(l.id);
    res.json({ success: true, removed: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Working an entry ──────────────────────────────────────────────────────────
router.post('/:id/entries/:eid/hold', async (req, res) => {
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const { rows: [e] } = await pool.query(
      'UPDATE call_list_entries SET held_by_agent_id = $3, held_at = NOW() ' +
      'WHERE id = $1 AND list_id = $2 AND status = \'open\' AND ' +
      '  (held_by_agent_id IS NULL OR held_by_agent_id = $3 OR held_at < NOW() - ($4 || \' minutes\')::interval) RETURNING *',
      [intOrNull(req.params.eid), l.id, req.agent.id, String(HOLD_STALE_MIN)]);
    if (!e) return res.status(409).json({ error: 'Someone else is on this one' });
    CL.notifyList(l.id);
    res.json(e);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/entries/:eid/release', async (req, res) => {
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    await pool.query('UPDATE call_list_entries SET held_by_agent_id = NULL, held_at = NULL WHERE id = $1 AND list_id = $2 AND held_by_agent_id = $3',
      [intOrNull(req.params.eid), l.id, req.agent.id]);
    CL.notifyList(l.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/entries/:eid/outcome', async (req, res) => {
  const b = req.body || {};
  if (!CL.isKnownOutcome(b.outcome)) return res.status(400).json({ error: 'unknown outcome' });
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const updated = await CL.recordOutcome({
      entryId: intOrNull(req.params.eid), agentId: req.agent.id, outcome: b.outcome,
      note: b.note ? String(b.note) : null, callbackAt: b.callback_at || null, callId: intOrNull(b.call_id),
    });
    if (!updated) return res.status(404).json({ error: 'Entry not found' });
    res.json(updated);
  } catch (e) { console.error('[call-lists] outcome', e.message); res.status(500).json({ error: e.message }); }
});

router.post('/:id/entries/:eid/reopen', async (req, res) => {
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const { rows: [e] } = await pool.query(
      'UPDATE call_list_entries SET status = \'open\', closed_at = NULL, closed_by_agent_id = NULL, callback_at = NULL ' +
      'WHERE id = $1 AND list_id = $2 RETURNING *', [intOrNull(req.params.eid), l.id]);
    if (!e) return res.status(404).json({ error: 'Entry not found' });
    CL.notifyList(l.id);
    res.json(e);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Export ────────────────────────────────────────────────────────────────────
router.get('/:id/export.csv', async (req, res) => {
  try {
    const l = await loadVisibleList(intOrNull(req.params.id), req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });
    const { rows } = await pool.query(
      'SELECT e.*, c.name AS closed_by_name FROM call_list_entries e LEFT JOIN agents c ON c.id = e.closed_by_agent_id ' +
      'WHERE e.list_id = $1 ORDER BY e.status, e.added_at', [l.id]);
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const iso = v => v ? new Date(v).toISOString() : '';
    const lines = [['Name','Company','Phone','Status','Attempts','Last outcome','Last attempt','Callback at','Closed by','Closed at','Added at','Zoho record'].join(',')];
    for (const e of rows) {
      lines.push([e.display_name, e.company, e.phone_number, e.status, e.attempts, CL.OUTCOME_LABELS[e.last_outcome] || e.last_outcome,
        iso(e.last_attempt_at), iso(e.callback_at), e.closed_by_name, iso(e.closed_at), iso(e.added_at), e.zoho_record_id].map(q).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + l.name.replace(/[^\w.-]+/g, '_') + '.csv"');
    res.send(lines.join('\r\n'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Zoho CRM custom views ─────────────────────────────────────────────────────
// Only when the Zoho add-on is configured on this deploy (features.zoho);
// otherwise 404 so a non-Zoho customer never learns these exist.
const ZOHO_MODULES = new Set(['Leads', 'Contacts']);
const ZOHO_FIELDS = {
  Leads:    ['Full_Name', 'First_Name', 'Last_Name', 'Company', 'Phone', 'Mobile', 'State', 'Country'],
  Contacts: ['Full_Name', 'First_Name', 'Last_Name', 'Account_Name', 'Phone', 'Mobile', 'Mailing_State', 'Mailing_Country'],
};

function zohoOrNull() {
  try { const z = require('../zoho'); return z.isZohoConfigured() ? z : null; } catch { return null; }
}

router.get('/zoho/views', async (req, res) => {
  const zoho = zohoOrNull();
  if (!zoho) return res.status(404).json({ error: 'Not found' });
  const module_ = ZOHO_MODULES.has(req.query.module) ? req.query.module : 'Leads';
  try {
    // Zoho v2: GET /settings/custom_views?module=Leads → { custom_views: [...] }
    const json = await zoho.zohoAPI('GET', '/settings/custom_views?module=' + module_);
    const views = ((json && json.custom_views) || []).map(v => ({
      id: String(v.id), name: v.display_value || v.name, system_defined: !!v.system_defined, category: v.category || null,
    }));
    res.json({ module: module_, views });
  } catch (e) {
    console.error('[call-lists] zoho views', e.message, e.body ? JSON.stringify(e.body).slice(0, 300) : '');
    // The Self Client refresh token was minted with ZohoCRM.modules.ALL + users.READ;
    // listing custom views needs ZohoCRM.settings.custom_views.READ as well.
    const scope = e.body && /SCOPE/i.test(e.body.code || '');
    res.status(502).json({ error: scope
      ? 'Zoho refresh token is missing the scope ZohoCRM.settings.custom_views.READ — regenerate it with that scope added (see handoff §8v)'
      : 'Zoho: ' + e.message });
  }
});

router.post('/:id/import/zoho', async (req, res) => {
  const zoho = zohoOrNull();
  if (!zoho) return res.status(404).json({ error: 'Not found' });
  const listId = intOrNull(req.params.id);
  const b = req.body || {};
  const module_ = ZOHO_MODULES.has(b.module) ? b.module : null;
  const viewId = b.view_id ? String(b.view_id) : null;
  if (!module_ || !viewId) return res.status(400).json({ error: 'module and view_id required' });
  try {
    const l = await loadVisibleList(listId, req.agent.id);
    if (!l) return res.status(404).json({ error: 'List not found' });

    const fields = ZOHO_FIELDS[module_].join(',');
    const rows = [];
    let page = 1, more = true, fetched = 0;
    while (more && page <= 25) {   // 25 × 200 = 5,000 records max per import
      const json = await zoho.zohoAPI('GET', `/${module_}?cvid=${viewId}&fields=${fields}&page=${page}&per_page=200`);
      const data = (json && json.data) || [];
      fetched += data.length;
      for (const r of data) {
        const phone = r.Phone || r.Mobile;
        if (!phone) continue;
        const name = r.Full_Name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ');
        const company = module_ === 'Leads' ? r.Company : (r.Account_Name && (r.Account_Name.name || r.Account_Name)) || null;
        rows.push({
          phone, name, company: company ? String(company) : null,
          region: module_ === 'Leads' ? r.State : r.Mailing_State,
          zoho_record_id: String(r.id), zoho_module: module_,
        });
      }
      more = !!(json && json.info && json.info.more_records);
      page++;
    }
    const result = rows.length ? await addEntries(listId, rows) : { added: 0, skipped_duplicate: 0, skipped_invalid: 0 };
    await pool.query(
      'UPDATE call_lists SET source = \'zoho_view\', zoho_module = $2, zoho_view_id = $3, zoho_view_name = COALESCE($4, zoho_view_name), last_import_at = NOW() WHERE id = $1',
      [listId, module_, viewId, b.view_name ? String(b.view_name) : null]);
    CL.notifyList(listId);
    res.json({ ...result, fetched, without_phone: fetched - rows.length });
  } catch (e) {
    console.error('[call-lists] zoho import', e.message, e.body ? JSON.stringify(e.body).slice(0, 300) : '');
    res.status(502).json({ error: 'Zoho: ' + e.message });
  }
});

module.exports = router;
