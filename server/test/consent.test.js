// Unit tests for recordConsent — the A2P/TCPA consent audit writer.
// Contract: never throws, returns the inserted row or null, and refuses
// to write an incomplete record (phone + action + method all required).
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { pool } = require('../db');
const { recordConsent } = require('../helpers/consent');

let realQuery, calls;

beforeEach(() => {
  realQuery = pool.query;
  calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 1, phone_number: params[1], action: params[2] }] };
  };
});

afterEach(() => { pool.query = realQuery; });

test('writes a complete consent record and returns the row', async () => {
  const rec = await recordConsent({
    contactId: 42, phone: '+12395551234', action: 'opt_out',
    method: 'sms_keyword', detail: 'STOP', messageSid: 'SM123', agentId: null,
  });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].params, [42, '+12395551234', 'opt_out', 'sms_keyword', 'STOP', 'SM123', null]);
  assert.strictEqual(rec.action, 'opt_out');
});

test('refuses to write when phone, action, or method is missing', async () => {
  assert.strictEqual(await recordConsent({ action: 'opt_in', method: 'verbal' }), null);
  assert.strictEqual(await recordConsent({ phone: '+1239', method: 'verbal' }), null);
  assert.strictEqual(await recordConsent({ phone: '+1239', action: 'opt_in' }), null);
  assert.strictEqual(calls.length, 0, 'no DB write may happen for incomplete records');
});

test('NEVER throws when the DB write fails (consent must not break message flow)', async () => {
  pool.query = async () => { throw new Error('db down'); };
  let rec;
  await assert.doesNotReject(async () => { rec = await recordConsent({
    phone: '+12395551234', action: 'opt_in', method: 'inbound_sms' }); });
  assert.strictEqual(rec, null);
});

test('optional fields default sensibly', async () => {
  await recordConsent({ phone: '+12395551234', action: 'opt_in', method: 'verbal' });
  const p = calls[0].params;
  assert.strictEqual(p[0], null); // contactId
  assert.strictEqual(p[4], null); // detail
  assert.strictEqual(p[5], null); // messageSid
  assert.strictEqual(p[6], null); // agentId
});
