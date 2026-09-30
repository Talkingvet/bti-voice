// Tenant registry + passthrough to each customer deploy's /api/tenant/*.
//
//   GET    /api/dashboard                       every active tenant: status pill + MTD usage (parallel)
//   GET    /api/tenants                         registry (no keys)
//   POST   /api/tenants                         { name, url, key, plan?, notes? } — verifies the key first
//   PATCH  /api/tenants/:id                     { name?, url?, key?, plan?, notes?, is_active? }
//   POST   /api/tenants/:id/test                re-check connectivity
//   GET    /api/tenants/:id/settings            → tenant GET  /settings
//   PATCH  /api/tenants/:id/settings            → tenant PATCH /settings
//   POST   /api/tenants/:id/settings/extend     → tenant POST /settings/extend
//   GET    /api/tenants/:id/usage?from&to&agent_id
//   GET    /api/tenants/:id/usage.csv?from&to   per-user rows + totals, for Zoho Billing
//   GET    /api/tenants/:id/agents
//   POST   /api/tenants/:id/agents              → temp password
//   PATCH  /api/tenants/:id/agents/:aid
//   GET    /api/tenants/:id/health
//   GET    /api/tenants/:id/audit               last 100 portal actions on this tenant
//
// Rule: the portal stores nothing about a customer except the registry row.
// Settings live in the tenant's own DB (plan §1 option A, pull model).
const express = require('express');
const { pool, audit } = require('../db');
const { requireAuth } = require('../auth');
const tc = require('../helpers/tenantClient');
const { encrypt, hint } = require('../helpers/crypto');
const { PORTAL_SECRET } = require('../secret');
const { pillFor, csvForUsage } = require('../helpers/status');

const router = express.Router();
router.use(requireAuth);

const PUBLIC_COLS = 'id, name, url, key_hint, plan, notes, is_active, last_ok_at, last_error, created_at, updated_at';

async function loadTenant(req, res, next) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad tenant id' });
  const { rows: [t] } = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  req.tenant = t;
  next();
}

function publicRow(t) {
  const out = {};
  for (const c of PUBLIC_COLS.split(', ')) out[c] = t[c];
  return out;
}

async function markResult(tenant, result) {
  if (result.ok) {
    await pool.query('UPDATE tenants SET last_ok_at = NOW(), last_error = NULL WHERE id = $1', [tenant.id]);
  } else {
    await pool.query('UPDATE tenants SET last_error = $2 WHERE id = $1', [tenant.id, result.error]);
  }
}

// Forward a tenant result to the browser with the right status.
function relay(res, result) {
  if (result.ok) return res.json(result.data);
  const status = result.status >= 400 && result.status < 500 ? result.status : 502;
  res.status(status).json({ error: result.error, code: result.code, tenant_status: result.status });
}

function validUrl(u) {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') && !!x.host; }
  catch { return false; }
}

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const { rows: tenants } = await pool.query('SELECT * FROM tenants WHERE is_active ORDER BY name');
    const results = await tc.fanOut(tenants, async (t) => {
      const [settings, usage] = await Promise.all([tc.get(t, '/settings'), tc.get(t, '/usage')]);
      return { settings, usage };
    });
    const rows = [];
    for (const { tenant, result } of results) {
      const s = result.settings, u = result.usage;
      await markResult(tenant, s);
      const account = s.ok ? s.data.account : null;
      rows.push({
        ...publicRow(tenant),
        reachable: s.ok,
        error: s.ok ? null : s.error,
        pill: pillFor(account, s.ok),
        account,
        features: s.ok ? s.data.resolved_features : null,
        seat_limit: s.ok ? s.data.settings.seat_limit : null,
        company_name: s.ok ? (s.data.settings.company_name || s.data.env_defaults.company_name) : null,
        usage: u.ok ? { from: u.data.from, to: u.data.to, totals: u.data.totals, counts: u.data.counts } : null,
      });
    }
    const { rows: inactive } = await pool.query(`SELECT ${PUBLIC_COLS} FROM tenants WHERE NOT is_active ORDER BY name`);
    res.json({ tenants: rows, inactive, generated_at: new Date().toISOString() });
  } catch (e) {
    console.error('[dashboard]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Registry ─────────────────────────────────────────────────────────────────
router.get('/tenants', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_COLS} FROM tenants ORDER BY is_active DESC, name`);
  res.json({ tenants: rows });
});

router.post('/tenants', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const url = tc.baseUrl(b.url || '');
  const key = String(b.key || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!validUrl(url)) return res.status(400).json({ error: 'url must be a full https:// address, e.g. https://acme-voice.up.railway.app' });
  if (key.length < 16) return res.status(400).json({ error: 'key looks too short — paste the deploy\'s TENANT_ADMIN_KEY' });
  try {
    const { rows: dup } = await pool.query('SELECT id, name FROM tenants WHERE lower(url) = lower($1)', [url]);
    if (dup.length) return res.status(409).json({ error: `That URL is already registered as "${dup[0].name}"` });

    // Verify before saving so a typo'd key/URL is caught right here.
    const probe = { url, key_enc: encrypt(key, PORTAL_SECRET) };
    const check = await tc.get(probe, '/settings');
    if (!check.ok && !b.force) {
      return res.status(422).json({ error: `Could not reach the tenant admin API: ${check.error}`, code: 'verify_failed',
                                    hint: 'Fix the URL/key, or tick "save anyway" to register it now and fix later.' });
    }
    const { rows: [t] } = await pool.query(
      `INSERT INTO tenants (name, url, key_enc, key_hint, plan, notes, created_by, last_ok_at, last_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${PUBLIC_COLS}`,
      [name, url, probe.key_enc, hint(key), b.plan ? String(b.plan).trim() : null, b.notes ? String(b.notes).trim() : null,
       req.user.id, check.ok ? new Date() : null, check.ok ? null : check.error]
    );
    await audit(req, 'tenant_create', { tenant: t, detail: { url, verified: check.ok } });
    res.status(201).json({ tenant: t, verified: check.ok, settings: check.ok ? check.data : null, error: check.ok ? null : check.error });
  } catch (e) {
    console.error('[tenants POST]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/tenants/:id', loadTenant, async (req, res) => {
  const b = req.body || {};
  const sets = []; const vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  try {
    if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return res.status(400).json({ error: 'name cannot be empty' }); set('name', n); }
    if (b.url !== undefined) {
      const u = tc.baseUrl(b.url);
      if (!validUrl(u)) return res.status(400).json({ error: 'url must be a full https:// address' });
      const { rows: dup } = await pool.query('SELECT id FROM tenants WHERE lower(url) = lower($1) AND id <> $2', [u, req.tenant.id]);
      if (dup.length) return res.status(409).json({ error: 'That URL is already registered to another tenant' });
      set('url', u);
    }
    if (b.key !== undefined) {
      const k = String(b.key).trim();
      if (k.length < 16) return res.status(400).json({ error: 'key looks too short' });
      set('key_enc', encrypt(k, PORTAL_SECRET)); set('key_hint', hint(k));
    }
    if (b.plan !== undefined) set('plan', b.plan ? String(b.plan).trim() : null);
    if (b.notes !== undefined) set('notes', b.notes ? String(b.notes).trim() : null);
    if (b.is_active !== undefined) { if (typeof b.is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be boolean' }); set('is_active', b.is_active); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at = NOW()');
    const { rows: [t] } = await pool.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${vals.length + 1} RETURNING ${PUBLIC_COLS}`, [...vals, req.tenant.id]
    );
    await audit(req, 'tenant_update', { tenant: t, detail: { fields: Object.keys(b).filter(k => k !== 'key'), key_changed: b.key !== undefined } });
    res.json({ tenant: t });
  } catch (e) {
    console.error('[tenants PATCH]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/tenants/:id/test', loadTenant, async (req, res) => {
  const r = await tc.get(req.tenant, '/health-extended');
  await markResult(req.tenant, r);
  res.json({ ok: r.ok, error: r.ok ? null : r.error, health: r.ok ? r.data : null });
});

// ── Passthrough ──────────────────────────────────────────────────────────────
router.get('/tenants/:id/settings', loadTenant, async (req, res) => {
  const r = await tc.get(req.tenant, '/settings'); await markResult(req.tenant, r); relay(res, r);
});

router.patch('/tenants/:id/settings', loadTenant, async (req, res) => {
  const r = await tc.patch(req.tenant, '/settings', req.body || {});
  await markResult(req.tenant, r);
  if (r.ok) await audit(req, 'settings_patch', { tenant: req.tenant, detail: req.body });
  relay(res, r);
});

router.post('/tenants/:id/settings/extend', loadTenant, async (req, res) => {
  const r = await tc.post(req.tenant, '/settings/extend', { days: req.body?.days });
  await markResult(req.tenant, r);
  if (r.ok) await audit(req, 'settings_extend', { tenant: req.tenant, detail: { days: req.body?.days, previous: r.data.previous, enabled_through: r.data.enabled_through } });
  relay(res, r);
});

router.get('/tenants/:id/usage', loadTenant, async (req, res) => {
  const { from, to, agent_id } = req.query;
  const r = await tc.get(req.tenant, '/usage', { from, to, agent_id }); await markResult(req.tenant, r); relay(res, r);
});

router.get('/tenants/:id/usage.csv', loadTenant, async (req, res) => {
  const { from, to } = req.query;
  const r = await tc.get(req.tenant, '/usage', { from, to });
  await markResult(req.tenant, r);
  if (!r.ok) return relay(res, r);
  const safe = req.tenant.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bti-voice-usage-${safe}-${r.data.from}-to-${r.data.to}.csv"`);
  await audit(req, 'usage_export', { tenant: req.tenant, detail: { from: r.data.from, to: r.data.to } });
  res.send(csvForUsage(req.tenant.name, r.data));
});

router.get('/tenants/:id/agents', loadTenant, async (req, res) => {
  const r = await tc.get(req.tenant, '/agents'); await markResult(req.tenant, r); relay(res, r);
});

router.post('/tenants/:id/agents', loadTenant, async (req, res) => {
  const r = await tc.post(req.tenant, '/agents', req.body || {});
  await markResult(req.tenant, r);
  if (r.ok) await audit(req, 'agent_create', { tenant: req.tenant, detail: { username: req.body?.username, name: req.body?.name } });
  relay(res, r);
});

router.patch('/tenants/:id/agents/:aid', loadTenant, async (req, res) => {
  const aid = parseInt(req.params.aid, 10);
  if (!Number.isInteger(aid)) return res.status(400).json({ error: 'Bad agent id' });
  const r = await tc.patch(req.tenant, `/agents/${aid}`, req.body || {});
  await markResult(req.tenant, r);
  if (r.ok) await audit(req, 'agent_update', { tenant: req.tenant, detail: { agent_id: aid, fields: Object.keys(req.body || {}) } });
  relay(res, r);
});

router.get('/tenants/:id/health', loadTenant, async (req, res) => {
  const r = await tc.get(req.tenant, '/health-extended'); await markResult(req.tenant, r); relay(res, r);
});

router.get('/tenants/:id/audit', loadTenant, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, action, detail, created_at FROM portal_audit WHERE tenant_id = $1 ORDER BY id DESC LIMIT 100', [req.tenant.id]
  );
  res.json({ audit: rows });
});

module.exports = router;
