// Session revocation (review 2026-10 §5 A3).
//
// Two layers, same idea as the portal's admin/auth.js (fresh from the DB so
// deactivation bites immediately), with a 30 s cache so it costs one small
// query per user per half-minute instead of one per request:
//
//   agents.token_version  — the "sign out EVERY device" switch. Bumped on
//                           portal deactivate / portal password reset / a
//                           user changing their own password. A JWT whose
//                           `tv` claim doesn't match is dead.
//   sessions table        — one row per sign-in (per device). The JWT's `sid`
//                           claim names it. "Sign out" revokes just that row,
//                           so the phone and the desktop feel like separate
//                           apps, not two windows into one login.
//
// Tokens minted before this shipped have neither claim: they are treated as
// tv=0 / no session, keep working until /auth/refresh upgrades them on the
// next app start, and die with everyone else on a token_version bump.
const crypto = require('crypto');

const CACHE_TTL_MS = 30 * 1000;

function createSessionGuard({ query, ttlMs = CACHE_TTL_MS, now = Date.now }) {
  const cache = new Map();

  // payload = decoded JWT ({ id, sid?, tv? }) or { id, media: true } for a
  // media-scope token (those only need the agent to still be active).
  async function check(payload) {
    const { id, sid = null, tv = 0, media = false } = payload || {};
    if (!Number.isInteger(id)) return { ok: false, reason: 'inactive' };
    const key = media ? `media:${id}` : (sid ? `sid:${sid}` : `legacy:${id}`);
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.result;

    const { rows: [row] } = await query(
      `SELECT a.is_active, a.token_version, s.id AS sid, s.revoked_at
         FROM agents a
         LEFT JOIN sessions s ON s.agent_id = a.id AND s.id = $2
        WHERE a.id = $1`,
      [id, sid]
    );
    let result;
    if (!row || !row.is_active)                                   result = { ok: false, reason: 'inactive' };
    else if (media)                                               result = { ok: true };
    else if ((row.token_version || 0) !== (tv || 0))              result = { ok: false, reason: 'revoked' };
    else if (sid && (!row.sid || row.revoked_at))                 result = { ok: false, reason: 'revoked' };
    else                                                          result = { ok: true };
    cache.set(key, { at: now(), result });
    return result;
  }

  // Any revocation just drops the whole cache — it's tiny and revokes are rare.
  function invalidate() { cache.clear(); }

  return { check, invalidate, _cache: cache };
}

// ── Default instance wired to the real pool ─────────────────────────────────
const { pool } = require('../db');
const guard = createSessionGuard({ query: (...a) => pool.query(...a) });

const REMEMBER_DAYS = 30;
const SHORT_HOURS   = 12;

// New sign-in → new session row. Returns the session id for the JWT.
async function createSession(agentId, { remember = false, platform = null, userAgent = null } = {}) {
  const sid = crypto.randomBytes(24).toString('hex');
  const expires = remember ? `NOW() + INTERVAL '${REMEMBER_DAYS} days'` : `NOW() + INTERVAL '${SHORT_HOURS} hours'`;
  await pool.query(
    `INSERT INTO sessions (id, agent_id, remember, platform, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, ${expires})`,
    [sid, agentId, !!remember, platform ? String(platform).slice(0, 20) : null, userAgent ? String(userAgent).slice(0, 300) : null]
  );
  return sid;
}

// Sliding renewal for "keep me signed in" sessions (called from /auth/refresh).
async function touchSession(sid) {
  await pool.query(
    `UPDATE sessions SET last_seen_at = NOW(), expires_at = NOW() + INTERVAL '${REMEMBER_DAYS} days'
      WHERE id = $1 AND revoked_at IS NULL`, [sid]
  );
}

// Disconnect live sockets for an agent — all of them, or only the one session.
async function dropSockets(agentId, sid = null) {
  try {
    const { getIO } = require('../socket');   // lazy: socket.js requires auth.js requires this file
    const io = getIO();
    if (!io) return;
    const sockets = await io.in('agent_' + agentId).fetchSockets();
    for (const s of sockets) {
      if (!sid || (s.data && s.data.sid === sid)) s.disconnect(true);
    }
  } catch (e) { console.error('[sessions] dropSockets', e.message); }
}

// "Sign out" on ONE device.
async function revokeSession(sid, agentId) {
  if (!sid) return;
  await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL', [sid, agentId]);
  guard.invalidate();
  await dropSockets(agentId, sid);
}

// Sign out EVERY device for an agent (deactivate / portal reset / own password
// change). Bumps token_version (kills legacy tokens too) and revokes every
// session row except `except` (the device that changed its own password — the
// caller mints that one a fresh token with the new version). Returns the new
// token_version.
async function revokeAllSessions(agentId, { except = null } = {}) {
  const { rows: [row] } = await pool.query(
    'UPDATE agents SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1 RETURNING token_version', [agentId]
  );
  await pool.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE agent_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id <> $2)',
    [agentId, except]
  );
  guard.invalidate();
  // Sockets: drop all except the kept session's.
  try {
    const { getIO } = require('../socket');
    const io = getIO();
    if (io) {
      const sockets = await io.in('agent_' + agentId).fetchSockets();
      for (const s of sockets) if (!except || !(s.data && s.data.sid === except)) s.disconnect(true);
    }
  } catch (e) { console.error('[sessions] revokeAll sockets', e.message); }
  return row ? row.token_version : null;
}

module.exports = {
  createSessionGuard,
  check: guard.check,
  invalidate: guard.invalidate,
  createSession,
  touchSession,
  revokeSession,
  revokeAllSessions,
};
