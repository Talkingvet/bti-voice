// In-call control helpers (hold / resume / transfer / hangup) — review §5 A5 + batch 4b.
//
// Everything here is pure so it can be unit-tested without Twilio or Postgres:
//   - parseAgentId / isCallSid  : strict input validation for req.body values
//   - holdTwiml / dialAgentTwiml: TwiML built with twilio.twiml.VoiceResponse
//   - conferenceTwiml / roomFor : the conference room a call moves into on its
//                                 first Hold (batch 4b — see below)
//   - callBelongsToAgent        : does this Twilio call belong to the requester?
//   - identifyLegs              : which leg is the customer, which is the agent
//   - pending moves / rooms     : tiny in-memory state for the hold upgrade
//
// ── How Hold works since batch 4b (2026-10-06) ───────────────────────────────
// Calls still RING exactly as before (one <Dial> joins customer + agent). The
// first time an agent presses Hold the two legs are moved into a Twilio
// Conference room named roomFor(customerSid) and stay there for the rest of
// the call. Hold/Resume are then participant hold on/off — the agent's browser
// leg is never dropped, so the desktop app keeps the panel, timer and wrap-up.
//
// The move: redirect the CHILD leg of the <Dial> into the room first. That
// ends the parent's <Dial>, whose action webhook (/no-answer, /next-agent or
// /outbound-done) finds a pending move for that parent SID and answers with
// the same room instead of hanging up. The /conference webhook puts the
// customer on hold the moment they land. Inbound: child = agent, parent =
// customer. Outbound: child = customer, parent = agent.
const twilio = require('twilio');

// Path-style S3 URL on purpose: the bucket-as-hostname form fails TLS (dotted
// bucket name vs Amazon's wildcard cert) and BachGavotteShort.mp3 was removed
// from the bucket—callers heard "an application error has occurred" (2026-10-05).
const HOLD_MUSIC_URL = 'https://s3.amazonaws.com/com.twilio.music.classical/ClockworkWaltz.mp3';

// Accepts 5 or "5". Rejects "", "5abc", "5</Client>", 5.5, 0, negatives, arrays.
function parseAgentId(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^[1-9][0-9]{0,9}$/.test(s)) return null;
  return parseInt(s, 10);
}

// Twilio call SIDs: "CA" + 32 hex chars.
function isCallSid(value) {
  return typeof value === 'string' && /^CA[0-9a-fA-F]{32}$/.test(value);
}

// Legacy one-shot hold (kept for the unit tests + as the fallback music TwiML):
// <Play loop="50">…</Play>
function holdTwiml() {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.play({ loop: 50 }, HOLD_MUSIC_URL);
  return twiml.toString();
}

// Served at /webhooks/voice/hold-music — the participant holdUrl. loop="0"
// means "forever" in Twilio, so the music runs until Resume.
function holdMusicTwiml() {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.play({ loop: 0 }, HOLD_MUSIC_URL);
  return twiml.toString();
}

// Same XML the old string produced:
// <Dial timeout="30" action="…/webhooks/voice/no-answer" method="POST"><Client>agent_N</Client></Dial>
function dialAgentTwiml(agentId, serverUrl = '') {
  const id = parseAgentId(agentId);
  if (!id) throw new Error('dialAgentTwiml: invalid agentId');
  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial({
    timeout: 30,
    action: `${serverUrl || ''}/webhooks/voice/no-answer`,
    method: 'POST',
  });
  dial.client(`agent_${id}`);
  return twiml.toString();
}

// Conference room name for a call — keyed by the CUSTOMER's call SID so every
// leg of the call (agent, transferred agent) resolves to the same room.
function roomFor(customerSid) {
  if (!isCallSid(customerSid)) throw new Error('roomFor: invalid customer SID');
  return `bridge-${customerSid}`;
}

// <Dial><Conference> for one participant.
//   endOnExit  — true for the agent (when the agent hangs up the room closes and
//                the customer's line drops); false for the customer (when they
//                leave, the agent is told via /conference and hung up by us).
//   record     — conference recording (part 2 of a held call); the callback
//                carries the customer SID + part marker because Twilio's
//                conference recording payload has no CallSid.
function conferenceTwiml(room, { endOnExit, serverUrl = '', record = false, customerSid = '' } = {}) {
  if (typeof room !== 'string' || !/^bridge-CA[0-9a-fA-F]{32}$/.test(room)) {
    throw new Error('conferenceTwiml: invalid room');
  }
  const base = serverUrl || '';
  const q    = `?call=${encodeURIComponent(customerSid)}`;
  const twiml = new twilio.twiml.VoiceResponse();
  const dial  = twiml.dial();
  const attrs = {
    startConferenceOnEnter: true,
    endConferenceOnExit:    !!endOnExit,
    beep:                   false,
    waitUrl:                '',               // silence while alone in the room
    statusCallback:         `${base}/webhooks/voice/conference${q}`,
    statusCallbackMethod:   'POST',
    statusCallbackEvent:    'join leave end',
  };
  if (record) {
    attrs.record                        = 'record-from-start';
    attrs.recordingStatusCallback       = `${base}/webhooks/voice/recording-complete${q}&part=conference`;
    attrs.recordingStatusCallbackMethod = 'POST';
  }
  dial.conference(attrs, room);
  return twiml.toString();
}

function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

function isClientLeg(addr) {
  return typeof addr === 'string' && addr.toLowerCase().startsWith('client:');
}

// `call`   = the Twilio call resource for the SID the browser gave us
// `parent` = its parentCallSid resource, if any (null for outbound browser calls)
// `agent`  = { id, phone_number }
//
// True when the browser leg is this agent's client identity (client:agent_<id>
// as `to` for inbound, as `from` for outbound), or when the PSTN leg is on this
// agent's own Twilio number. Works on a completed leg too.
function callBelongsToAgent({ call, parent }, agent) {
  if (!call || !agent || !agent.id) return false;
  const me = `client:agent_${agent.id}`;
  const legs = [call, parent].filter(Boolean);

  for (const leg of legs) {
    if (leg.from === me || leg.to === me) return true;
    if (leg.fromFormatted === me || leg.toFormatted === me) return true;
  }

  const myNumber = digits(agent.phone_number);
  if (myNumber.length >= 10) {
    for (const leg of legs) {
      if (digits(leg.from) === myNumber || digits(leg.to) === myNumber) return true;
    }
  }
  return false;
}

// Work out the shape of the call from the Twilio resources we already fetched.
//   call     — the browser leg (client:agent_N on one side)
//   parent   — its parent, if any
//   children — calls whose parentCallSid === call.sid (outbound: the customer)
// Returns { customerSid, agentSid, dialParentSid, direction, phone } or null.
//   dialParentSid = the leg whose <Dial> ends when the child is redirected —
//                   i.e. the leg that will hit the action webhook.
function identifyLegs({ call, parent, children = [] }) {
  if (!call) return null;
  const agentLeg = isClientLeg(call.to) || isClientLeg(call.from);
  if (!agentLeg) return null;

  if (parent) {
    // Inbound (or a transferred leg): the agent was <Dial>ed BY the customer.
    // A parent that is itself a child leg is the customer leg of an OUTBOUND
    // call (we <Dial><Number>ed them from the agent's leg): their number is `to`.
    const outbound = !!parent.parentCallSid;
    const phone = outbound ? parent.to : (isClientLeg(parent.from) ? parent.to : parent.from);
    return {
      customerSid:   parent.sid,
      agentSid:      call.sid,
      dialParentSid: parent.sid,
      direction:     outbound ? 'outbound' : 'inbound',
      phone,
    };
  }
  // Outbound: the agent's leg <Dial>ed the customer, who is its child.
  const live = children.filter(c => c && !isClientLeg(c.to) && !isClientLeg(c.from));
  const pick = live.find(c => c.status === 'in-progress') || live.find(c => c.status === 'ringing') || live[0];
  if (!pick) return null;
  return {
    customerSid:   pick.sid,
    agentSid:      call.sid,
    dialParentSid: call.sid,
    direction:     'outbound',
    phone:         pick.to,
  };
}

// ── In-memory state for the hold upgrade ─────────────────────────────────────
// pendingMoves: dialParentSid → room info, consumed by the parent's <Dial>
//               action webhook within a few seconds (TTL guards leaks).
// rooms:        room → { customerSid, agentSid, agentId, holdOnJoin,
//               transferring }, used by /conference and cleared on end.
const PENDING_TTL_MS = 30 * 1000;
const ROOM_TTL_MS    = 6 * 60 * 60 * 1000;
const pendingMoves = new Map();
const rooms        = new Map();

function sweep(map, ttl, now = Date.now()) {
  for (const [k, v] of map) if (now - v.createdAt > ttl) map.delete(k);
}

function registerMove(dialParentSid, info, now = Date.now()) {
  sweep(pendingMoves, PENDING_TTL_MS, now);
  pendingMoves.set(dialParentSid, { ...info, createdAt: now });
}

// Returns and removes the pending move for this parent SID, or null.
function takeMove(dialParentSid, now = Date.now()) {
  sweep(pendingMoves, PENDING_TTL_MS, now);
  const m = pendingMoves.get(dialParentSid);
  if (m) pendingMoves.delete(dialParentSid);
  return m || null;
}

function setRoom(room, info, now = Date.now()) {
  sweep(rooms, ROOM_TTL_MS, now);
  rooms.set(room, { ...(rooms.get(room) || {}), ...info, createdAt: now });
}
function getRoom(room) { return rooms.get(room) || null; }
function clearRoom(room) { rooms.delete(room); }
function resetState() { pendingMoves.clear(); rooms.clear(); }

module.exports = {
  parseAgentId, isCallSid, holdTwiml, holdMusicTwiml, dialAgentTwiml,
  roomFor, conferenceTwiml, callBelongsToAgent, identifyLegs,
  registerMove, takeMove, setRoom, getRoom, clearRoom, resetState,
  HOLD_MUSIC_URL,
};
