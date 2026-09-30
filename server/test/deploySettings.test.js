// Unit tests for the subscription lifecycle + feature resolution.
// Run with:  npm test   (from server/) — Node's built-in test runner, no DB needed.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused';
const { test } = require('node:test');
const assert = require('node:assert');
const { computeAccountStatus, resolveFeatures } = require('../helpers/deploySettings');

const at = (iso) => new Date(iso + 'T12:00:00');
const row = (o) => ({ features: {}, grace_days: 14, suspended: false, enabled_through: null, ...o });

test('no enabled_through → active, everything allowed', () => {
  const s = computeAccountStatus(row({}), at('2026-10-01'));
  assert.equal(s.state, 'active');
  assert.equal(s.outbound_allowed, true);
  assert.equal(s.login_allowed, true);
});

test('more than 14 days out → active', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-12-31' }), at('2026-10-01'));
  assert.equal(s.state, 'active');
  assert.equal(s.message, null);
});

test('within 14 days → renews_soon with a banner message', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-10-10' }), at('2026-10-01'));
  assert.equal(s.state, 'renews_soon');
  assert.match(s.message, /renews on October 10, 2026/);
  assert.equal(s.outbound_allowed, true);
});

test('the enabled_through day itself is still fully active (inclusive)', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-10-10' }), at('2026-10-10'));
  assert.equal(s.state, 'renews_soon');
  assert.equal(s.outbound_allowed, true);
});

test('day after expiry → grace: app fully works, banner shown', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-10-10' }), at('2026-10-11'));
  assert.equal(s.state, 'grace');
  assert.equal(s.outbound_allowed, true);
  assert.equal(s.login_allowed, true);
  assert.equal(s.grace_ends, '2026-10-24');
  assert.equal(s.blocked_from, '2026-11-23');
});

test('last day of grace (day 14) still works', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-10-10' }), at('2026-10-24'));
  assert.equal(s.state, 'grace');
  assert.equal(s.outbound_allowed, true);
});

test('past grace → restricted: outbound off, login still allowed', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-10-10' }), at('2026-10-25'));
  assert.equal(s.state, 'restricted');
  assert.equal(s.outbound_allowed, false);
  assert.equal(s.login_allowed, true);
  assert.match(s.message, /incoming calls still ring/i);
});

test('grace + 30 days → blocked: login refused, nothing deleted', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-10-10' }), at('2026-11-24'));
  assert.equal(s.state, 'blocked');
  assert.equal(s.login_allowed, false);
  assert.match(s.message, /contact BTI/i);
});

test('custom grace_days is honoured', () => {
  const s = computeAccountStatus(row({ enabled_through: '2026-10-10', grace_days: 3 }), at('2026-10-14'));
  assert.equal(s.state, 'restricted');
});

test('suspended = immediate block regardless of dates', () => {
  const s = computeAccountStatus(row({ enabled_through: '2027-01-01', suspended: true }), at('2026-10-01'));
  assert.equal(s.state, 'blocked');
  assert.equal(s.login_allowed, false);
  assert.equal(s.outbound_allowed, false);
});

test('BTI extending the date reactivates instantly', () => {
  const s = computeAccountStatus(row({ enabled_through: '2027-10-10' }), at('2026-11-24'));
  assert.equal(s.state, 'active');
});

// ── Feature resolution ───────────────────────────────────────────────────────
const fullEnv = { OPENAI_API_KEY: 'sk', ENABLE_RECORDING: 'true', SERVER_URL: 'https://x' };

test('missing toggles = on (env permitting)', () => {
  const f = resolveFeatures({}, fullEnv);
  assert.equal(f.recording, true);
  assert.equal(f.ai_summaries, true);
  assert.equal(f.sms, true);
  assert.equal(f.voicemail_transcription, true);
  assert.equal(f.mobile_apps, true);
});

test('a toggle can turn a feature OFF', () => {
  const f = resolveFeatures({ recording: false, sms: false, mobile_apps: false }, fullEnv);
  assert.equal(f.recording, false);
  assert.equal(f.sms, false);
  assert.equal(f.mobile_apps, false);
  assert.equal(f.ai_summaries, true);
});

test('a toggle can NOT turn a feature on without credentials', () => {
  const f = resolveFeatures({ recording: true, ai_summaries: true, voicemail_transcription: true }, {});
  assert.equal(f.recording, false);
  assert.equal(f.ai_summaries, false);
  assert.equal(f.voicemail_transcription, false);
});

test('zoho is off when Zoho OAuth vars are absent, even if toggled on', () => {
  const f = resolveFeatures({ zoho: true }, fullEnv);
  assert.equal(f.zoho, false);
});
