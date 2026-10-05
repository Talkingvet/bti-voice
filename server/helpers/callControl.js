// In-call control helpers (hold / resume / transfer) — review §5 A5.
//
// Everything here is pure so it can be unit-tested without Twilio or Postgres:
//   - parseAgentId / isCallSid  : strict input validation for req.body values
//   - holdTwiml / dialAgentTwiml: TwiML built with twilio.twiml.VoiceResponse
//                                 (XML-escaped) instead of string templates
//   - callBelongsToAgent        : does this Twilio call belong to the requester?
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

// Same XML the old string produced: <Play loop="50">…</Play>
function holdTwiml() {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.play({ loop: 50 }, HOLD_MUSIC_URL);
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

function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

// `call`   = the Twilio call resource for the SID the browser gave us
// `parent` = its parentCallSid resource, if any (null for outbound browser calls)
// `agent`  = { id, phone_number }
//
// True when the browser leg is this agent's client identity (client:agent_<id>
// as `to` for inbound, as `from` for outbound), or when the PSTN leg is on this
// agent's own Twilio number. Works on a completed leg too — after Hold, the
// agent's browser leg has already hung up but Resume still needs to pass.
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

module.exports = { parseAgentId, isCallSid, holdTwiml, dialAgentTwiml, callBelongsToAgent, HOLD_MUSIC_URL };
