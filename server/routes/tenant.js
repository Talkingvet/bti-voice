// BTI-only tenant admin API — admin portal Phase 1 (2026-09-30).
//
// Every control BTI has over a customer deploy lives here (plan §4a #4:
// portal-only — there is deliberately NO customer-facing UI for any of it).
// The Phase 2 portal (`bti-voice-admin`, one row per tenant: name, URL, key)
// is the only intended caller: it loops over tenants hitting these endpoints.
//
// Auth: TENANT_ADMIN_KEY (per-deploy secret set in Railway, held by BTI).
//   Header  X-Tenant-Key: <key>     (or Authorization: Bearer <key>)
// If the env var is unset the whole router answers 404 — a deploy without a
// key simply has no admin surface, and nothing here is guessable.
//
// Privacy rule: usage is AGGREGATES ONLY. No message bodies, transcripts,
// recordings, notes or contact names ever leave through this router.
//
// Endpoints
//   GET   /settings          deploy_settings row + resolved features + account status
//   PATCH /settings          { features?, seat_limit?, enabled_through?, grace_days?,
//                              suspended?, company_name?, brand_name?, notes? }
//   POST  /settings/extend   { days } → enabled_through += days (from today if past)
//   GET   /usage?from&to&agent_id   per-agent rows + org totals
//   GET   /agents            all agents incl. inactive (never password hashes)
//   POST  /agents            { name, username, password?, phone_number? } (seat-limited)
//   PATCH /agents/:id        { name?, username?, phone_number?, is_active?, reset_password?: true }
//                            reset_password → returns { temporary_password } once;
//                            user is forced to change it on next login
//   GET   /health-extended   version, db size, numbers, last webhook seen, counts

const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const { pool } = require('../db');
const ds = require('../helpers/deploySettings');
const { getLastSeen } = require('../helpers/lastSeen');
const sessions = require('../helpers/sessions');

const router = express.Router();

// ── Auth ─────────────────────────────────────────────────────────────────────
function requireTenantKey(req, res, next) {
  const key = process.env.TENANT_ADMIN_KEY;
  if (!key) return res.status(404).json({ error: 'Not found' });
  const header = req.headers['x-tenant-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(key);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    console.warn(`[tenant] rejected ${req.method} ${req.originalUrl} from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
router.use(requireTenantKey);

// ── Settings ─────────────────────────────────────────────────────────────────
function settingsPayload() {
  const row = ds.getSettings();
  return {
    settings: {
      features:        row.features,
      seat_limit:      row.seat_limit,
      enabled_through: row.enabled_through,
      grace_days:      row.grace_days,
      suspended:       row.suspended,
      company_name:    row.company_name,
      brand_name:      row.brand_name,
      notes:           row.notes,
      updated_at:      row.updated_at,
    },
    resolved_features: ds.resolveFeatures(),
    feature_keys:      ds.FEATURE_KEYS,
    account:           ds.accountStatus(),
    env_defaults: {   // what the deploy has *available* — a toggle can't exceed these
      zoho_credentials: require('../zoho').hasZohoCredentials(),
      openai:           !!process.env.OPENAI_API_KEY,
      recording_env:    process.env.ENABLE_RECORDING === 'true',
      messaging_service: !!process.env.TWILIO_MESSAGING_SERVICE_SID,
      company_name:     process.env.COMPANY_NAME || null,
      brand_name:       process.env.BRAND_NAME || null,
    },
  };
}

router.get('/settings', (req, res) => res.json(settingsPayload()));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

router.patch('/settings', async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  try {
    if (b.features !== undefined) {
      if (!b.features || typeof b.features !== 'object' || Array.isArray(b.features)) {
        return res.status(400).json({ error: 'features must be an object of booleans' });
      }
      const clean = {};
      for (const [k, v] of Object.entries(b.features)) {
        if (!ds.FEATURE_KEYS.includes(k)) return res.status(400).json({ error: `Unknown feature "${k}". Allowed: ${ds.FEATURE_KEYS.join(', ')}` });
        if (typeof v !== 'boolean') return res.status(400).json({ error: `features.${k} must be true or false` });
        clean[k] = v;
      }
      // Merge with what's stored so a partial PATCH doesn't wipe other toggles.
      set('features', JSON.stringify({ ...ds.getSettings().features, ...clean }));
    }
    if (b.seat_limit !== undefined) {
      if (b.seat_limit !== null && !(Number.isInteger(b.seat_limit) && b.seat_limit >= 1)) {
        return res.status(400).json({ error: 'seat_limit must be a whole number ≥ 1, or null for unlimited' });
      }
      set('seat_limit', b.seat_limit);
    }
    if (b.enabled_through !== undefined) {
      if (b.enabled_through !== null && !ISO_DATE.test(b.enabled_through)) {
        return res.status(400).json({ error: 'enabled_through must be YYYY-MM-DD or null' });
      }
      set('enabled_through', b.enabled_through);
    }
    if (b.grace_days !== undefined) {
      if (!(Number.isInteger(b.grace_days) && b.grace_days >= 0 && b.grace_days <= 365)) {
        return res.status(400).json({ error: 'grace_days must be a whole number 0–365' });
      }
      set('grace_days', b.grace_days);
    }
    if (b.suspended !== undefined) {
      if (typeof b.suspended !== 'boolean') return res.status(400).json({ error: 'suspended must be true or false' });
      set('suspended', b.suspended);
    }
    for (const col of ['company_name', 'brand_name', 'notes']) {
      if (b[col] !== undefined) {
        if (b[col] !== null && typeof b[col] !== 'string') return res.status(400).json({ error: `${col} must be a string or null` });
        set(col, b[col] ? b[col].trim() || null : null);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    sets.push('updated_at = NOW()');
    await pool.query(`UPDATE deploy_settings SET ${sets.join(', ')} WHERE id = 1`, vals);
    await ds.refreshSettings();
    console.log(`[tenant] settings updated: ${Object.keys(b).join(', ')}`);
    res.json(settingsPayload());
  } catch (e) {
    console.error('[tenant/settings PATCH]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// "Extend 30 days" button. From enabled_through if it's still in the future,
// otherwise from today — so a lapsed account extended by 30 days gets 30 real days.
router.post('/settings/extend', async (req, res) => {
  const days = parseInt(req.body?.days, 10);
  if (!(Number.isInteger(days) && days >= 1 && days <= 3650)) {
    return res.status(400).json({ error: 'days must be a whole number 1–3650' });
  }
  try {
    const cur = ds.getSettings().enabled_through;
    const today = ds.toISODate(new Date());
    const base = cur && cur > today ? cur : today;
    const [y, m, d] = base.split('-').map(Number);
    const next = ds.toISODate(new Date(y, m - 1, d + days));
    await pool.query('UPDATE deploy_settings SET enabled_through = $1, suspended = false, updated_at = NOW() WHERE id = 1', [next]);
    await ds.refreshSettings();
    console.log(`[tenant] enabled_through extended ${days}d → ${next}`);
    res.json({ previous: cur, enabled_through: next, ...settingsPayload() });
  } catch (e) {
    console.error('[tenant/settings/extend]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Usage (aggregates only) ──────────────────────────────────────────────────
router.get('/usage', async (req, res) => {
  const to   = ISO_DATE.test(req.query.to || '')   ? req.query.to   : ds.toISODate(new Date());
  const from = ISO_DATE.test(req.query.from || '') ? req.query.from : firstOfMonth(to);
  const agentId = req.query.agent_id ? parseInt(req.query.agent_id, 10) : null;
  if (req.query.agent_id && !Number.isInteger(agentId)) return res.status(400).json({ error: 'agent_id must be a number' });
  // Inclusive day range → half-open timestamp range.
  const fromTs = from + 'T00:00:00';
  const toTs   = nextDay(to) + 'T00:00:00';

  try {
    const { rows: agents } = await pool.query(
      'SELECT id, name, username, phone_number, is_active, last_login_at FROM agents ORDER BY id'
    );

    // Calls: agent_id is the agent who placed/answered. Minutes = ceil(seconds/60)
    // per call, which is how Twilio bills.
    const { rows: callRows } = await pool.query(`
      SELECT agent_id, direction, status,
             COUNT(*)::int                                            AS count,
             COALESCE(SUM(CEIL(COALESCE(duration,0)/60.0)),0)::int   AS minutes,
             COUNT(*) FILTER (WHERE recording_url IS NOT NULL)::int   AS recordings,
             COALESCE(SUM(CEIL(COALESCE(duration,0)/60.0)) FILTER (WHERE recording_url IS NOT NULL),0)::int AS recorded_minutes,
             COUNT(*) FILTER (WHERE transcription IS NOT NULL)::int   AS transcriptions,
             COUNT(*) FILTER (WHERE ai_summary IS NOT NULL)::int      AS ai_summaries
      FROM calls
      WHERE started_at >= $1 AND started_at < $2
      GROUP BY agent_id, direction, status
    `, [fromTs, toTs]);

    // SMS: outbound rows carry agent_id; inbound rows don't, so attribute them
    // to the agent whose number they were sent to.
    const { rows: smsRows } = await pool.query(`
      SELECT m.direction,
             COALESCE(m.agent_id, a.id) AS agent_id,
             COUNT(*)::int AS count,
             COUNT(mm.id)::int AS media
      FROM messages m
      LEFT JOIN agents a ON m.direction = 'inbound' AND a.phone_number = m.to_number
      LEFT JOIN message_media mm ON mm.message_id = m.id
      WHERE m.sent_at >= $1 AND m.sent_at < $2
      GROUP BY m.direction, COALESCE(m.agent_id, a.id)
    `, [fromTs, toTs]);

    const blank = () => ({
      calls_in: 0, calls_out: 0, call_minutes_in: 0, call_minutes_out: 0, missed_calls: 0, voicemails: 0,
      recordings: 0, recorded_minutes: 0, transcriptions: 0, ai_summaries: 0,
      sms_in: 0, sms_out: 0, mms: 0,
    });
    const per = new Map(agents.map(a => [a.id, blank()]));
    const unattributed = blank();
    const bucket = (id) => (id != null && per.has(id)) ? per.get(id) : unattributed;

    for (const r of callRows) {
      const b = bucket(r.agent_id);
      if (r.status === 'voicemail') { b.voicemails += r.count; }
      else if (r.status === 'missed' || r.status === 'no-answer') { b.missed_calls += r.count; }
      else if (r.direction === 'inbound') { b.calls_in += r.count; b.call_minutes_in += r.minutes; }
      else { b.calls_out += r.count; b.call_minutes_out += r.minutes; }
      b.recordings += r.recordings; b.recorded_minutes += r.recorded_minutes;
      b.transcriptions += r.transcriptions; b.ai_summaries += r.ai_summaries;
    }
    for (const r of smsRows) {
      const b = bucket(r.agent_id);
      if (r.direction === 'inbound') b.sms_in += r.count; else b.sms_out += r.count;
      b.mms += r.media;
    }

    const totals = blank();
    const addTo = (t, b) => { for (const k of Object.keys(t)) t[k] += b[k]; };
    for (const b of per.values()) addTo(totals, b);
    addTo(totals, unattributed);

    let agentRows = agents.map(a => ({
      agent_id: a.id, name: a.name, username: a.username, phone_number: a.phone_number,
      is_active: a.is_active, last_login_at: a.last_login_at, ...per.get(a.id),
    }));
    if (agentId) agentRows = agentRows.filter(r => r.agent_id === agentId);

    const { rows: [store] } = await pool.query(`
      SELECT pg_database_size(current_database())::bigint AS db_bytes,
             (SELECT COALESCE(SUM(octet_length(data)),0) FROM message_media)::bigint AS media_bytes,
             (SELECT COUNT(*) FROM contacts)::int AS contacts,
             (SELECT COUNT(*) FROM conversations)::int AS conversations,
             (SELECT COUNT(*) FROM agents WHERE is_active)::int AS active_agents,
             (SELECT COUNT(*) FROM agents WHERE is_active AND last_login_at >= $1)::int AS agents_logged_in_period
    `, [fromTs]);

    res.json({
      from, to, agent_id: agentId,
      totals: { ...totals, unattributed },
      agents: agentRows,
      storage: { db_bytes: Number(store.db_bytes), media_bytes: Number(store.media_bytes) },
      counts: { contacts: store.contacts, conversations: store.conversations,
                active_agents: store.active_agents, agents_logged_in_period: store.agents_logged_in_period,
                seat_limit: ds.getSettings().seat_limit },
      account: ds.accountStatus(),
    });
  } catch (e) {
    console.error('[tenant/usage]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

function firstOfMonth(iso) { return iso.slice(0, 8) + '01'; }
function nextDay(iso) { const [y, m, d] = iso.split('-').map(Number); return ds.toISODate(new Date(y, m - 1, d + 1)); }

// ── Agents (users) ───────────────────────────────────────────────────────────
const AGENT_COLS = 'id, name, username, phone_number, color, initials, is_active, status, must_change_password, last_login_at, created_at';
const USERNAME_RE = /^[a-z0-9._-]{2,50}$/;
const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#ef4444', '#84cc16'];

router.get('/agents', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${AGENT_COLS} FROM agents ORDER BY is_active DESC, id`);
  res.json({ agents: rows, seat_limit: ds.getSettings().seat_limit,
             active: rows.filter(r => r.is_active).length });
});

async function seatsAvailable(excludeId = null) {
  const limit = ds.getSettings().seat_limit;
  if (limit == null) return { ok: true, limit, active: null };
  const { rows: [{ n }] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM agents WHERE is_active AND ($1::int IS NULL OR id <> $1)', [excludeId]
  );
  return { ok: n < limit, limit, active: n };
}

function tempPassword() {
  // 12 chars, unambiguous alphabet, e.g. "k7Rm-x4Pq-9Wz"
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n), b => alpha[b % alpha.length]).join('');
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}

router.post('/agents', async (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  const username = (b.username || '').trim().toLowerCase();
  let phone = (b.phone_number || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'username must be 2–50 chars: letters, numbers, . _ -' });
  if (phone && !/^\+[0-9]{11,15}$/.test(phone)) return res.status(400).json({ error: 'phone_number must be E.164 (e.g. +12395551234)' });
  if (b.password !== undefined && (typeof b.password !== 'string' || b.password.length < 8)) {
    return res.status(400).json({ error: 'password must be at least 8 characters (omit it to get a temporary one)' });
  }
  try {
    const seats = await seatsAvailable();
    if (!seats.ok) return res.status(409).json({ error: `Seat limit reached (${seats.active}/${seats.limit} active users). Raise the seat limit or deactivate a user first.`, code: 'seat_limit' });
    const { rows: dup } = await pool.query('SELECT id FROM agents WHERE username = $1', [username]);
    if (dup.length) return res.status(409).json({ error: `Username "${username}" is already taken` });

    const password = b.password || tempPassword();
    const hash = await bcrypt.hash(password, 10);
    const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM agents');
    const color = COLORS[n % COLORS.length];
    const { rows: [agent] } = await pool.query(
      `INSERT INTO agents (name, username, password_hash, phone_number, color, initials, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING ${AGENT_COLS}`,
      [name, username, hash, phone || 'TBD', color, initials]
    );
    console.log(`[tenant] agent created: ${username} (#${agent.id})`);
    res.status(201).json({ agent, temporary_password: password });
  } catch (e) {
    console.error('[tenant/agents POST]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/agents/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad agent id' });
  const b = req.body || {};
  const sets = []; const vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  let temporary_password = null;
  try {
    const { rows: [existing] } = await pool.query('SELECT id, is_active FROM agents WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Agent not found' });

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      set('name', name);
      set('initials', name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
    }
    if (b.username !== undefined) {
      const username = String(b.username).trim().toLowerCase();
      if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'username must be 2–50 chars: letters, numbers, . _ -' });
      const { rows: dup } = await pool.query('SELECT id FROM agents WHERE username = $1 AND id <> $2', [username, id]);
      if (dup.length) return res.status(409).json({ error: `Username "${username}" is already taken` });
      set('username', username);
    }
    if (b.phone_number !== undefined) {
      const phone = (b.phone_number || '').trim();
      if (phone && !/^\+[0-9]{11,15}$/.test(phone)) return res.status(400).json({ error: 'phone_number must be E.164 or empty' });
      set('phone_number', phone || 'TBD');
    }
    if (b.is_active !== undefined) {
      if (typeof b.is_active !== 'boolean') return res.status(400).json({ error: 'is_active must be true or false' });
      if (b.is_active && !existing.is_active) {
        const seats = await seatsAvailable(id);
        if (!seats.ok) return res.status(409).json({ error: `Seat limit reached (${seats.active}/${seats.limit} active users).`, code: 'seat_limit' });
      }
      set('is_active', b.is_active);
    }
    if (b.reset_password === true) {
      temporary_password = tempPassword();
      set('password_hash', await bcrypt.hash(temporary_password, 10));
      set('must_change_password', true);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    const { rows: [agent] } = await pool.query(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = $${vals.length + 1} RETURNING ${AGENT_COLS}`, [...vals, id]
    );
    // Deactivating or resetting the password signs the user out of EVERY
    // device immediately (review §5 A3) — desktop app included.
    if (b.is_active === false || b.reset_password === true) {
      await sessions.revokeAllSessions(id);
    }
    console.log(`[tenant] agent #${id} updated: ${Object.keys(b).join(', ')}`);
    res.json(temporary_password ? { agent, temporary_password } : { agent });
  } catch (e) {
    console.error('[tenant/agents PATCH]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Health ───────────────────────────────────────────────────────────────────
router.get('/health-extended', async (req, res) => {
  try {
    const { rows: [db] } = await pool.query(`
      SELECT pg_database_size(current_database())::bigint AS db_bytes,
             (SELECT COUNT(*) FROM agents WHERE is_active)::int AS active_agents,
             (SELECT COUNT(*) FROM agents)::int AS total_agents,
             (SELECT MAX(started_at) FROM calls) AS last_call_at,
             (SELECT MAX(sent_at) FROM messages) AS last_message_at,
             (SELECT MAX(last_login_at) FROM agents) AS last_login_at
    `);
    const { rows: numbers } = await pool.query(`
      SELECT phone_number, label, destination_type, is_active FROM number_routing ORDER BY phone_number
    `);
    const { rows: agentNumbers } = await pool.query(
      `SELECT phone_number, name FROM agents WHERE is_active AND phone_number LIKE '+%' ORDER BY id`
    );
    const pkg = require('../package.json');
    res.json({
      ok: true,
      brand: ds.displayNames(),
      versions: { server: pkg.version, desktop_latest: process.env.LATEST_VERSION || null, node: process.version },
      uptime_seconds: Math.round(process.uptime()),
      env: {
        node_env: process.env.NODE_ENV || null,
        server_url: process.env.SERVER_URL || null,
        twilio_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
        voice_configured:  !!(process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET && process.env.TWILIO_TWIML_APP_SID),
        messaging_service: !!process.env.TWILIO_MESSAGING_SERVICE_SID,
        openai: !!process.env.OPENAI_API_KEY,
        zoho_credentials: require('../zoho').hasZohoCredentials(),
        default_number: process.env.TWILIO_PHONE_NUMBER || null,
      },
      numbers: { routing: numbers, agents: agentNumbers },
      db: { bytes: Number(db.db_bytes), active_agents: db.active_agents, total_agents: db.total_agents,
            last_call_at: db.last_call_at, last_message_at: db.last_message_at, last_login_at: db.last_login_at },
      last_seen: getLastSeen(),
      features: ds.resolveFeatures(),
      account: ds.accountStatus(),
    });
  } catch (e) {
    console.error('[tenant/health-extended]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
