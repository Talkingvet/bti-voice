// Batch 4b — conference-room helpers behind Hold/Resume (see callControl.js header).
const test = require('node:test');
const assert = require('node:assert/strict');
const cc = require('../helpers/callControl');

const CUST  = 'CA' + 'c'.repeat(32);
const AGENT = 'CA' + 'a'.repeat(32);
const OTHER = 'CA' + 'b'.repeat(32);

test('roomFor is keyed by the customer SID and rejects junk', () => {
  assert.equal(cc.roomFor(CUST), `bridge-${CUST}`);
  for (const bad of ['', 'CA123', null, `${CUST}</Conference>`]) {
    assert.throws(() => cc.roomFor(bad));
  }
});

test('conferenceTwiml: agent leg ends the room on exit, customer leg does not', () => {
  const room  = cc.roomFor(CUST);
  const agent = cc.conferenceTwiml(room, { endOnExit: true, serverUrl: 'https://s', customerSid: CUST });
  const cust  = cc.conferenceTwiml(room, { endOnExit: false, serverUrl: 'https://s', customerSid: CUST, record: true });
  assert.match(agent, /endConferenceOnExit="true"/);
  assert.match(cust,  /endConferenceOnExit="false"/);
  assert.match(agent, /startConferenceOnEnter="true"/);
  assert.match(agent, /waitUrl=""/);
  assert.match(agent, new RegExp(`statusCallback="https://s/webhooks/voice/conference\\?call=${CUST}"`));
  assert.match(agent, /statusCallbackEvent="join leave end"/);
  assert.ok(!/record=/.test(agent), 'no recording attrs unless asked');
  assert.match(cust, /record="record-from-start"/);
  assert.match(cust, new RegExp(`recording-complete\\?call=${CUST}&amp;part=conference`));
  assert.ok(agent.endsWith(`>${room}</Conference></Dial></Response>`));
});

test('conferenceTwiml refuses a room name that is not ours', () => {
  assert.throws(() => cc.conferenceTwiml('bridge-nope', {}));
  assert.throws(() => cc.conferenceTwiml(`bridge-${CUST}</Conference><Number>+19005551234</Number>`, {}));
});

test('holdMusicTwiml loops forever', () => {
  assert.ok(cc.holdMusicTwiml().includes(`<Play loop="0">${cc.HOLD_MUSIC_URL}</Play>`));
});

test('identifyLegs: inbound — agent leg is the child, customer is the parent', () => {
  const legs = cc.identifyLegs({
    call:   { sid: AGENT, from: '+12395551234', to: 'client:agent_3', parentCallSid: CUST },
    parent: { sid: CUST,  from: '+12395551234', to: '+12394455667', parentCallSid: null },
  });
  assert.deepEqual(legs, {
    customerSid: CUST, agentSid: AGENT, dialParentSid: CUST, direction: 'inbound', phone: '+12395551234',
  });
});

test('identifyLegs: outbound — agent leg is the parent, customer is the live child', () => {
  const legs = cc.identifyLegs({
    call:     { sid: AGENT, from: 'client:agent_3', to: '+12395551234', parentCallSid: null },
    parent:   null,
    children: [
      { sid: OTHER, from: '+12394455667', to: '+12395551234', status: 'completed' },
      { sid: CUST,  from: '+12394455667', to: '+12395551234', status: 'in-progress' },
    ],
  });
  assert.deepEqual(legs, {
    customerSid: CUST, agentSid: AGENT, dialParentSid: AGENT, direction: 'outbound', phone: '+12395551234',
  });
});

test('identifyLegs: a leg transferred on an outbound call keeps direction=outbound', () => {
  // Paul's leg was <Dial>ed by the customer leg, which itself is a child of Danny's leg.
  const legs = cc.identifyLegs({
    call:   { sid: AGENT, from: '+12394455667', to: 'client:agent_5', parentCallSid: CUST },
    parent: { sid: CUST,  from: '+12394455667', to: '+12395551234', parentCallSid: OTHER },
  });
  assert.equal(legs.direction, 'outbound');
  assert.equal(legs.customerSid, CUST);
  assert.equal(legs.phone, '+12395551234');
});

test('identifyLegs returns null for a PSTN-only call or an outbound leg with no child', () => {
  assert.equal(cc.identifyLegs({ call: { sid: CUST, from: '+1', to: '+2' }, parent: null }), null);
  assert.equal(cc.identifyLegs({ call: { sid: AGENT, from: 'client:agent_3', to: '+1' }, parent: null, children: [] }), null);
});

test('pending moves are one-shot and expire', () => {
  cc.resetState();
  cc.registerMove(CUST, { room: cc.roomFor(CUST), agentSid: AGENT }, 1000);
  assert.equal(cc.takeMove(OTHER, 1000), null);
  const m = cc.takeMove(CUST, 2000);
  assert.equal(m.agentSid, AGENT);
  assert.equal(cc.takeMove(CUST, 2000), null, 'consumed');
  cc.registerMove(CUST, { room: 'x' }, 1000);
  assert.equal(cc.takeMove(CUST, 1000 + 31 * 1000), null, 'expired after 30 s');
});

test('rooms merge updates and can be cleared', () => {
  cc.resetState();
  const room = cc.roomFor(CUST);
  cc.setRoom(room, { customerSid: CUST, agentSid: AGENT, holdOnJoin: true });
  cc.setRoom(room, { holdOnJoin: false });
  assert.equal(cc.getRoom(room).customerSid, CUST);
  assert.equal(cc.getRoom(room).holdOnJoin, false);
  cc.clearRoom(room);
  assert.equal(cc.getRoom(room), null);
});
