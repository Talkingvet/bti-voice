// Unit tests for the session-revocation guard (review §5 A3).
// Run with:  npm test   (from server/) — no DB: the query function is injected.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused';
const { test } = require('node:test');
const assert = require('node:assert');
const { createSessionGuard } = require('../helpers/sessions');

function fakeDb(rowsByCall) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    const r = typeof rowsByCall === 'function' ? rowsByCall(params) : rowsByCall;
    return { rows: r ? [r] : [] };
  };
  return { query, calls };
}

test('active agent, matching version, live session → ok', async () => {
  const db = fakeDb({ is_active: true, token_version: 2, sid: 'abc', revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  assert.deepEqual(await g.check({ id: 5, sid: 'abc', tv: 2 }), { ok: true });
});

test('deactivated agent → inactive', async () => {
  const db = fakeDb({ is_active: false, token_version: 0, sid: 'abc', revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  assert.deepEqual(await g.check({ id: 5, sid: 'abc', tv: 0 }), { ok: false, reason: 'inactive' });
});

test('unknown agent → inactive', async () => {
  const db = fakeDb(null);
  const g = createSessionGuard({ query: db.query });
  assert.equal((await g.check({ id: 99, sid: 'x', tv: 0 })).ok, false);
});

test('token_version bumped → revoked (even with a live session row)', async () => {
  const db = fakeDb({ is_active: true, token_version: 3, sid: 'abc', revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  assert.deepEqual(await g.check({ id: 5, sid: 'abc', tv: 2 }), { ok: false, reason: 'revoked' });
});

test('session row revoked (per-device sign-out) → revoked', async () => {
  const db = fakeDb({ is_active: true, token_version: 0, sid: 'abc', revoked_at: new Date() });
  const g = createSessionGuard({ query: db.query });
  assert.deepEqual(await g.check({ id: 5, sid: 'abc', tv: 0 }), { ok: false, reason: 'revoked' });
});

test('sid in token but no such session row → revoked', async () => {
  const db = fakeDb({ is_active: true, token_version: 0, sid: null, revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  assert.deepEqual(await g.check({ id: 5, sid: 'gone', tv: 0 }), { ok: false, reason: 'revoked' });
});

test('legacy token (no sid, no tv) → treated as version 0, no session needed', async () => {
  const db = fakeDb({ is_active: true, token_version: 0, sid: null, revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  assert.deepEqual(await g.check({ id: 5 }), { ok: true });
  assert.equal(db.calls[0].params[1], null);
});

test('legacy token dies once token_version is bumped', async () => {
  const db = fakeDb({ is_active: true, token_version: 1, sid: null, revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  assert.equal((await g.check({ id: 5 })).ok, false);
});

test('media token only needs an active agent (ignores version)', async () => {
  const db = fakeDb({ is_active: true, token_version: 7, sid: null, revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  assert.deepEqual(await g.check({ id: 5, media: true }), { ok: true });
});

test('cache: second check inside the TTL does not hit the DB; invalidate forces a re-query', async () => {
  let t = 1000;
  const db = fakeDb({ is_active: true, token_version: 0, sid: 'abc', revoked_at: null });
  const g = createSessionGuard({ query: db.query, ttlMs: 30000, now: () => t });
  await g.check({ id: 5, sid: 'abc', tv: 0 });
  await g.check({ id: 5, sid: 'abc', tv: 0 });
  assert.equal(db.calls.length, 1);
  t += 31000;
  await g.check({ id: 5, sid: 'abc', tv: 0 });
  assert.equal(db.calls.length, 2);
  g.invalidate();
  await g.check({ id: 5, sid: 'abc', tv: 0 });
  assert.equal(db.calls.length, 3);
});

test('cache is per session, not per agent', async () => {
  const db = fakeDb({ is_active: true, token_version: 0, sid: 'x', revoked_at: null });
  const g = createSessionGuard({ query: db.query });
  await g.check({ id: 5, sid: 'a', tv: 0 });
  await g.check({ id: 5, sid: 'b', tv: 0 });
  assert.equal(db.calls.length, 2);
});

test('bad id → inactive without touching the DB', async () => {
  const db = fakeDb({ is_active: true });
  const g = createSessionGuard({ query: db.query });
  assert.equal((await g.check({ id: 'nope' })).ok, false);
  assert.equal(db.calls.length, 0);
});
