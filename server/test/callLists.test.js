// Unit tests for Call Lists outcome rules + working order + area-code zones.
// Run with:  npm test   (from server/) — no DB needed.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused';
const { test } = require('node:test');
const assert = require('node:assert');
const { applyOutcome, compareEntries, isKnownOutcome } = require('../helpers/callLists');
const { tzForPhone } = require('../helpers/areaCodeTz');
const ds = require('../helpers/deploySettings');

// batch 8: outcomes come from the deploy's configured list. These tests use the
// old Talkingvet set so the rules below read the same as before.
ds._setCacheForTests({ wrap_up_enabled: true, dispositions: [
  { code: 'demo_scheduled', label: 'Demo scheduled', keep_open: false },
  { code: 'callback_requested', label: 'Callback requested', keep_open: true },
  { code: 'not_interested', label: 'Not interested', keep_open: false },
] });

const entry = (o = {}) => ({ attempts: 0, callback_at: null, last_attempt_at: null, added_at: '2026-10-01T10:00:00Z', ...o });

test('closing disposition → done, attempts +1', () => {
  const r = applyOutcome(entry(), { outcome: 'demo_scheduled' });
  assert.equal(r.status, 'done'); assert.equal(r.attempts, 1); assert.equal(r.closed, true);
  assert.equal(r.last_outcome, 'demo_scheduled');
});

test('no answer keeps it open with attempt count', () => {
  const r = applyOutcome(entry({ attempts: 2 }), { outcome: 'no_answer' });
  assert.equal(r.status, 'open'); assert.equal(r.attempts, 3); assert.equal(r.callback_at, null);
});

test('left voicemail keeps it open', () => {
  assert.equal(applyOutcome(entry(), { outcome: 'left_voicemail' }).status, 'open');
});

test('callback requested stores the date', () => {
  const r = applyOutcome(entry(), { outcome: 'callback_requested', callback_at: '2026-10-07T18:00:00Z' });
  assert.equal(r.status, 'open');
  assert.equal(r.callback_at.toISOString(), '2026-10-07T18:00:00.000Z');
});

test('callback date sticks for other retaining outcomes, ignored for closing ones', () => {
  const r = applyOutcome(entry(), { outcome: 'left_voicemail', callback_at: '2026-10-07T18:00:00Z' });
  assert.equal(r.callback_at.toISOString(), '2026-10-07T18:00:00.000Z');
  assert.equal(applyOutcome(entry(), { outcome: 'demo_scheduled', callback_at: '2026-10-07T18:00:00Z' }).callback_at, null);
  assert.equal(applyOutcome(entry(), { outcome: 'no_answer', callback_at: 'garbage' }).callback_at, null);
});

test('max attempts closes a retaining outcome', () => {
  const r = applyOutcome(entry({ attempts: 2 }), { outcome: 'no_answer', max_attempts: 3 });
  assert.equal(r.status, 'done'); assert.equal(r.last_outcome, 'max_attempts');
});

test('max attempts off (null/0) never closes', () => {
  assert.equal(applyOutcome(entry({ attempts: 50 }), { outcome: 'no_answer', max_attempts: null }).status, 'open');
  assert.equal(applyOutcome(entry({ attempts: 50 }), { outcome: 'no_answer', max_attempts: 0 }).status, 'open');
});

test('removed closes without counting an attempt', () => {
  const r = applyOutcome(entry({ attempts: 1 }), { outcome: 'removed' });
  assert.equal(r.status, 'done'); assert.equal(r.attempts, 1);
});

test('unknown outcome throws', () => {
  assert.throws(() => applyOutcome(entry(), { outcome: 'banana' }));
  assert.equal(isKnownOutcome('busy'), true);
  assert.equal(isKnownOutcome('skip'), false);
});

test('working order: due callbacks, then untried oldest-first, then fewest attempts, future callbacks last', () => {
  const now = new Date('2026-10-05T12:00:00Z').getTime();
  const due    = entry({ id: 'due',    attempts: 1, callback_at: '2026-10-05T11:00:00Z', last_attempt_at: '2026-10-04T10:00:00Z' });
  const future = entry({ id: 'future', attempts: 1, callback_at: '2026-10-09T11:00:00Z', last_attempt_at: '2026-10-04T10:00:00Z' });
  const oldNew = entry({ id: 'oldNew', attempts: 0, added_at: '2026-09-30T10:00:00Z' });
  const newNew = entry({ id: 'newNew', attempts: 0, added_at: '2026-10-02T10:00:00Z' });
  const tried  = entry({ id: 'tried',  attempts: 2, last_attempt_at: '2026-10-03T10:00:00Z' });
  const sorted = [tried, newNew, future, oldNew, due].sort((a, b) => compareEntries(a, b, now)).map(e => e.id);
  assert.deepEqual(sorted, ['due', 'oldNew', 'newNew', 'tried', 'future']);
});

test('area code → zone', () => {
  assert.equal(tzForPhone('+12394454227'), 'America/New_York');
  assert.equal(tzForPhone('(312) 555-1212'), 'America/Chicago');
  assert.equal(tzForPhone('4805551212'), 'America/Phoenix');
  assert.equal(tzForPhone('+16045551212'), 'America/Los_Angeles');   // BC shares Pacific
  assert.equal(tzForPhone('8505551212'), 'America/Chicago');        // panhandle default
  assert.equal(tzForPhone('8505551212', 'FL'), 'America/New_York'); // CRM says Florida → Tallahassee side
  assert.equal(tzForPhone('2395551212', 'TX'), 'America/New_York'); // non-split code: area code wins
  assert.equal(tzForPhone('+44 20 7946 0958'), null);
});
