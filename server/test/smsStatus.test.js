const test = require('node:test');
const assert = require('node:assert/strict');
const {
  statusCallbackUrl, withStatusCallback, normalizeStatus, initialStatus,
  shouldApply, isFailure, isPending, errorText,
} = require('../helpers/smsStatus');

test('statusCallbackUrl needs an http(s) SERVER_URL and strips trailing slashes', () => {
  assert.equal(statusCallbackUrl({}), null);
  assert.equal(statusCallbackUrl({ SERVER_URL: 'YOUR-DOMAIN' }), null);
  assert.equal(statusCallbackUrl({ SERVER_URL: 'https://x.up.railway.app/' }), 'https://x.up.railway.app/webhooks/sms/status');
});

test('withStatusCallback adds the param only when configured', () => {
  assert.deepEqual(withStatusCallback({ body: 'hi' }, {}), { body: 'hi' });
  const p = withStatusCallback({ body: 'hi' }, { SERVER_URL: 'https://x.app' });
  assert.equal(p.statusCallback, 'https://x.app/webhooks/sms/status');
  assert.equal(p.body, 'hi');
});

test('normalizeStatus / initialStatus', () => {
  assert.equal(normalizeStatus(' Delivered '), 'delivered');
  assert.equal(normalizeStatus('bogus'), null);
  assert.equal(initialStatus({ status: 'queued' }), 'queued');
  assert.equal(initialStatus({ status: 'accepted' }), 'accepted');
  assert.equal(initialStatus({ status: 'weird' }), 'sent');
  assert.equal(initialStatus(null), 'sent');
});

test('shouldApply moves forward only', () => {
  assert.equal(shouldApply('queued', 'sending'), true);
  assert.equal(shouldApply('sending', 'sent'), true);
  assert.equal(shouldApply('sent', 'delivered'), true);
  assert.equal(shouldApply('delivered', 'sent'), false);     // late callback
  assert.equal(shouldApply('sent', 'sent'), true);           // idempotent
  assert.equal(shouldApply('queued', 'bogus'), false);
});

test('shouldApply: failures always win, and are never undone', () => {
  assert.equal(shouldApply('delivered', 'undelivered'), true);
  assert.equal(shouldApply('sent', 'failed'), true);
  assert.equal(shouldApply('failed', 'delivered'), false);
  assert.equal(shouldApply('undelivered', 'sent'), false);
});

test('shouldApply: legacy/unknown stored value accepts whatever Twilio says', () => {
  assert.equal(shouldApply(null, 'delivered'), true);
  assert.equal(shouldApply('legacy', 'sent'), true);
});

test('isFailure / isPending / errorText', () => {
  assert.equal(isFailure('undelivered'), true);
  assert.equal(isFailure('delivered'), false);
  assert.equal(isPending('accepted'), true);
  assert.equal(isPending('sent'), false);
  assert.equal(errorText(30003), 'Phone is off or unreachable');
  assert.equal(errorText('30007'), 'Filtered by the carrier as spam');
  assert.equal(errorText(12345), 'Carrier error 12345');
  assert.equal(errorText(null), null);
});
