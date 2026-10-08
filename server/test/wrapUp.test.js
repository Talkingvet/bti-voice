// Batch 8 (brand sweep): per-deploy wrap-up outcomes + support identity.
// Run with:  npm test   (from server/) — no DB needed.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused';
const { test } = require('node:test');
const assert = require('node:assert');
const ds = require('../helpers/deploySettings');
const CL = require('../helpers/callLists');

test('normalizeDispositions: labels → slug codes, blanks dropped, keep_open kept', () => {
  const r = ds.normalizeDispositions([
    { label: '  Follow-up needed ', keep_open: true }, 'Resolved', { label: '' }, { label: 'Wrong number' },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, [
    { code: 'follow_up_needed', label: 'Follow-up needed', keep_open: true },
    { code: 'resolved', label: 'Resolved', keep_open: false },
    { code: 'wrong_number', label: 'Wrong number', keep_open: false },
  ]);
});

test('normalizeDispositions: null/[] → null; rejects non-array, dupes, long labels', () => {
  assert.deepEqual(ds.normalizeDispositions(null), { ok: true, value: null });
  assert.deepEqual(ds.normalizeDispositions([]), { ok: true, value: null });
  assert.deepEqual(ds.normalizeDispositions(['', '  ']), { ok: true, value: null });
  assert.equal(ds.normalizeDispositions('Resolved').ok, false);
  assert.equal(ds.normalizeDispositions(['Resolved', 'resolved']).ok, false);
  assert.equal(ds.normalizeDispositions(['x'.repeat(41)]).ok, false);
  assert.equal(ds.normalizeDispositions(Array.from({ length: 21 }, (_, i) => 'o' + i)).ok, false);
  assert.equal(ds.normalizeDispositions(['!!!']).ok, false);
});

test('normalizeDispositions: an explicit valid code is kept so a label edit keeps old rows', () => {
  const r = ds.normalizeDispositions([{ code: 'demo_scheduled', label: 'Demo booked' }]);
  assert.deepEqual(r.value, [{ code: 'demo_scheduled', label: 'Demo booked', keep_open: false }]);
});

test('wrapUp(): off + no outcomes by default; reflects the row', () => {
  ds._setCacheForTests({});
  assert.deepEqual(ds.wrapUp(), { enabled: false, dispositions: [] });
  ds._setCacheForTests({ wrap_up_enabled: true, dispositions: [{ code: 'resolved', label: 'Resolved' }, { bad: 1 }] });
  assert.deepEqual(ds.wrapUp(), { enabled: true, dispositions: [{ code: 'resolved', label: 'Resolved', keep_open: false }] });
  assert.equal(ds.wrapUpEnabled(), true);
});

test('dispositionLabel: configured → legacy → humanised', () => {
  ds._setCacheForTests({ dispositions: [{ code: 'resolved', label: 'Resolved ✓' }] });
  assert.equal(ds.dispositionLabel('resolved'), 'Resolved ✓');
  assert.equal(ds.dispositionLabel('demo_scheduled'), 'Demo scheduled');   // old BTI rows
  assert.equal(ds.dispositionLabel('some_old_thing'), 'some old thing');
  assert.equal(ds.dispositionLabel(''), '');
});

test('call-list rules follow the configured outcomes (keep_open = stays on the list)', () => {
  ds._setCacheForTests({ dispositions: [
    { code: 'resolved', label: 'Resolved', keep_open: false },
    { code: 'follow_up', label: 'Follow-up needed', keep_open: true },
  ] });
  assert.equal(CL.isKnownOutcome('resolved'), true);
  assert.equal(CL.isKnownOutcome('follow_up'), true);
  assert.equal(CL.isKnownOutcome('demo_scheduled'), false);   // not configured on this deploy
  assert.equal(CL.isKnownOutcome('no_answer'), true);          // built-in strip outcome
  assert.equal(CL.isClosing('resolved'), true);
  assert.equal(CL.isClosing('follow_up'), false);
  assert.equal(CL.isClosing('wrong_number'), true);
  assert.equal(CL.isClosing('left_voicemail'), false);
  assert.equal(CL.applyOutcome({ attempts: 0 }, { outcome: 'resolved' }).status, 'done');
  assert.equal(CL.applyOutcome({ attempts: 0 }, { outcome: 'follow_up', callback_at: '2026-10-09T15:00:00Z' }).status, 'open');
});

test('support(): row → env → BTI default; supportContact adds the email', () => {
  ds._setCacheForTests({});
  const env = {};
  assert.deepEqual(ds.support(env), { name: 'Business Technology Insight', email: 'helpdesk@businesstechnologyinsight.com', url: null });
  assert.equal(ds.support({ SUPPORT_NAME: 'Acme IT', SUPPORT_EMAIL: 'help@acme.test' }).name, 'Acme IT');
  ds._setCacheForTests({ support_name: 'Reseller Co', support_email: 'help@reseller.test' });
  assert.equal(ds.support({ SUPPORT_NAME: 'Acme IT' }).name, 'Reseller Co');
  assert.equal(ds.supportContact(), 'Reseller Co (help@reseller.test)');
});

test('subscription messages name the brand and the support contact', () => {
  ds._setCacheForTests({ brand_name: 'CBIA Voice', support_name: 'BTI', support_email: 'helpdesk@bti.test', enabled_through: '2026-01-01' });
  const st = ds.computeAccountStatus(ds.getSettings(), new Date('2026-06-01T12:00:00Z'));
  assert.equal(st.state, 'blocked');
  assert.match(st.message, /CBIA Voice subscription ended/);
  assert.match(st.message, /contact BTI \(helpdesk@bti\.test\)/);
  assert.doesNotMatch(st.message, /BTI Voice/);
  ds._setCacheForTests({});
});
