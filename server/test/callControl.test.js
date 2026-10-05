const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAgentId, isCallSid, holdTwiml, dialAgentTwiml, callBelongsToAgent, HOLD_MUSIC_URL,
} = require('../helpers/callControl');

const SID = 'CA' + 'a'.repeat(32);
const INJECTION = '5</Client><Number>+19005551234</Number><Client>';

test('parseAgentId accepts positive integers and numeric strings only', () => {
  assert.equal(parseAgentId(5), 5);
  assert.equal(parseAgentId('7'), 7);
  assert.equal(parseAgentId(' 12 '), 12);
  for (const bad of [0, -1, 5.5, '', '0', '-3', '5abc', 'abc', INJECTION, null, undefined, [5], { id: 5 }, true]) {
    assert.equal(parseAgentId(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('isCallSid requires the CA + 32 hex shape', () => {
  assert.equal(isCallSid(SID), true);
  assert.equal(isCallSid('CA' + 'F'.repeat(32)), true);
  for (const bad of ['', 'CA123', SID + 'x', 'SM' + 'a'.repeat(32), SID.replace('a', 'z'), 5, null]) {
    assert.equal(isCallSid(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('holdTwiml matches the previous hand-written XML', () => {
  const xml = holdTwiml();
  assert.ok(xml.endsWith(`<Response><Play loop="50">${HOLD_MUSIC_URL}</Play></Response>`));
});

test('dialAgentTwiml matches the previous hand-written XML on the normal path', () => {
  const xml = dialAgentTwiml(5, 'https://bti-voice-production.up.railway.app');
  assert.ok(xml.endsWith(
    '<Response><Dial timeout="30" action="https://bti-voice-production.up.railway.app/webhooks/voice/no-answer" method="POST">' +
    '<Client>agent_5</Client></Dial></Response>'
  ));
  // string ids are fine, empty SERVER_URL falls back to a relative action like before
  assert.ok(dialAgentTwiml('3', '').includes('action="/webhooks/voice/no-answer"'));
  assert.ok(dialAgentTwiml('3', '').includes('<Client>agent_3</Client>'));
});

test('dialAgentTwiml refuses injection payloads instead of emitting them', () => {
  assert.throws(() => dialAgentTwiml(INJECTION, ''));
  assert.throws(() => dialAgentTwiml('', ''));
  assert.throws(() => dialAgentTwiml(undefined, ''));
  // belt and braces: even if a caller bypassed parseAgentId, the helper escapes
  const twilio = require('twilio');
  const t = new twilio.twiml.VoiceResponse();
  t.dial().client(`agent_${INJECTION}`);
  assert.ok(!t.toString().includes('<Number>'), 'VoiceResponse must XML-escape');
});

const me = { id: 2, phone_number: '+12394755114' };

test('ownership: inbound call ringing my browser (client leg to=client:agent_2)', () => {
  const call   = { sid: SID, from: '+12395550100', to: 'client:agent_2', parentCallSid: 'CA' + 'b'.repeat(32) };
  const parent = { sid: call.parentCallSid, from: '+12395550100', to: '+18005550199' };
  assert.equal(callBelongsToAgent({ call, parent }, me), true);
});

test('ownership: outbound call I placed (client leg from=client:agent_2, no parent)', () => {
  const call = { sid: SID, from: 'client:agent_2', to: '+12395550100', parentCallSid: null };
  assert.equal(callBelongsToAgent({ call, parent: null }, me), true);
});

test('ownership: completed browser leg after Hold still counts (Resume path)', () => {
  const call   = { sid: SID, status: 'completed', from: '+12395550100', to: 'client:agent_2', parentCallSid: 'CA' + 'c'.repeat(32) };
  const parent = { sid: call.parentCallSid, status: 'in-progress', from: '+12395550100', to: '+18005550199' };
  assert.equal(callBelongsToAgent({ call, parent }, me), true);
});

test('ownership: a call on my own Twilio number passes even if another client leg answered', () => {
  const call   = { sid: SID, from: '+12395550100', to: 'client:agent_5', parentCallSid: 'CA' + 'd'.repeat(32) };
  const parent = { sid: call.parentCallSid, from: '+12395550100', to: '+1 (239) 475-5114' };
  assert.equal(callBelongsToAgent({ call, parent }, me), true);
});

test("ownership: a teammate's call is refused", () => {
  const call   = { sid: SID, from: '+12395550100', to: 'client:agent_5', parentCallSid: 'CA' + 'e'.repeat(32) };
  const parent = { sid: call.parentCallSid, from: '+12395550100', to: '+12394454227' };
  assert.equal(callBelongsToAgent({ call, parent }, me), false);
  assert.equal(callBelongsToAgent({ call, parent }, { id: 2, phone_number: 'TBD' }), false);
  assert.equal(callBelongsToAgent({ call: null, parent }, me), false);
  assert.equal(callBelongsToAgent({ call, parent }, null), false);
});

test('ownership: agent_2 does not match agent_20', () => {
  const call = { sid: SID, from: 'client:agent_20', to: '+12395550100', parentCallSid: null };
  assert.equal(callBelongsToAgent({ call, parent: null }, me), false);
});
