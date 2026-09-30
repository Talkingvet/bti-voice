const test = require('node:test');
const assert = require('node:assert/strict');
const { encrypt, decrypt, hint } = require('../helpers/crypto');
const { pillFor, csvForUsage } = require('../helpers/status');

test('encrypt/decrypt round-trips and is randomised per call', () => {
  const secret = 'portal-secret-for-tests';
  const key = 'tk_live_0123456789abcdef0123456789abcdef';
  const a = encrypt(key, secret), b = encrypt(key, secret);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, secret), key);
  assert.equal(decrypt(b, secret), key);
  assert.match(a, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
});

test('decrypt fails with the wrong secret or a tampered payload', () => {
  const c = encrypt('some-key-value-1234', 'right');
  assert.throws(() => decrypt(c, 'wrong'));
  const parts = c.split(':'); parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decrypt(parts.join(':'), 'right'));
  assert.throws(() => decrypt('garbage', 'right'));
});

test('hint shows only the last 4 characters', () => {
  assert.equal(hint('abcdefgh1234'), '…1234');
  assert.equal(hint('short'), '••••');
});

test('pillFor maps account states and unreachable', () => {
  assert.equal(pillFor(null, false).key, 'unreachable');
  assert.equal(pillFor({ state: 'active' }, true).label, 'OK');
  assert.equal(pillFor({ state: 'active', suspended: true }, true).label, 'Suspended');
  assert.equal(pillFor({ state: 'renews_soon', days_until_renewal: 5 }, true).label, 'Renews in 5d');
  assert.equal(pillFor({ state: 'grace' }, true).tone, 'amber');
  assert.equal(pillFor({ state: 'restricted' }, true).tone, 'red');
  assert.equal(pillFor({ state: 'blocked' }, true).rank, 1);
  assert.equal(pillFor({ state: 'made_up' }, true).key, 'active');
});

test('csvForUsage emits header, per-user rows, unattributed and total', () => {
  const usage = {
    from: '2026-09-01', to: '2026-09-30',
    agents: [{ name: 'Jane "JJ" Smith', username: 'jane', is_active: true, last_login_at: '2026-09-29T10:00:00Z', calls_in: 3, calls_out: 4, call_minutes_in: 5, call_minutes_out: 6, sms_in: 1, sms_out: 2 }],
    totals: { calls_in: 4, calls_out: 4, call_minutes_in: 5, call_minutes_out: 6, sms_in: 1, sms_out: 2, unattributed: { calls_in: 1 } },
  };
  const csv = csvForUsage('Acme, Inc', usage);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith('Tenant,Period from,Period to,User,Username,Active,Last login,Calls in'));
  assert.ok(lines[1].startsWith('"Acme, Inc",2026-09-01,2026-09-30,"Jane ""JJ"" Smith",jane,yes,2026-09-29,3,5,4,6'));
  assert.ok(lines[2].includes('Unattributed'));
  assert.ok(lines[3].startsWith('"Acme, Inc",2026-09-01,2026-09-30,TOTAL,,,,4,5,4,6'));
});
