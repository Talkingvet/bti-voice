const test = require('node:test');
const assert = require('node:assert/strict');
const { twilioConfigured, hasOwnNumber, smsSendBlock } = require('../helpers/smsConfig');

const twilioEnv = { TWILIO_ACCOUNT_SID: 'ACx', TWILIO_AUTH_TOKEN: 'tok' };

test('twilioConfigured needs both SID and token', () => {
  assert.equal(twilioConfigured({}), false);
  assert.equal(twilioConfigured({ TWILIO_ACCOUNT_SID: 'ACx' }), false);
  assert.equal(twilioConfigured(twilioEnv), true);
});

test('hasOwnNumber rejects TBD, empty and missing numbers', () => {
  assert.equal(hasOwnNumber({ phone_number: 'TBD' }), false);
  assert.equal(hasOwnNumber({ phone_number: '' }), false);
  assert.equal(hasOwnNumber({}), false);
  assert.equal(hasOwnNumber(null), false);
  assert.equal(hasOwnNumber({ phone_number: '+12394454227' }), true);
});

test('smsSendBlock: no Twilio → server reason, even with a number', () => {
  const b = smsSendBlock({ agent: { phone_number: '+12394454227' }, env: {} });
  assert.equal(b.code, 'sms_not_configured');
  assert.equal(b.reason, 'server');
  assert.match(b.error, /Twilio/);
});

test('smsSendBlock: Twilio but no number → number reason', () => {
  const b = smsSendBlock({ agent: { phone_number: 'TBD' }, env: twilioEnv });
  assert.equal(b.code, 'sms_not_configured');
  assert.equal(b.reason, 'number');
  assert.match(b.error, /your number/);
});

test('smsSendBlock: Twilio + real number → null (send allowed)', () => {
  assert.equal(smsSendBlock({ agent: { phone_number: '+12394454227' }, env: twilioEnv }), null);
});
