// Review Pass 2 batch 7 (F1 / B2): can this agent actually send a text?
//
// Before this helper, a send with no Twilio credentials or no agent number
// was stored as a 'sent' message that never left the server. Now every
// outbound path asks here first and answers 409 `sms_not_configured` with a
// reason the composer can show, so nothing fake ever lands in the thread.

function twilioConfigured(env = process.env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

function hasOwnNumber(agent) {
  const n = agent && agent.phone_number;
  return typeof n === 'string' && n.startsWith('+');
}

// Returns null when sending is possible, otherwise { code, reason, error }.
//   reason 'server' → Twilio isn't configured on this deploy (admin problem)
//   reason 'number' → this agent has no phone number assigned
function smsSendBlock({ agent, env = process.env } = {}) {
  if (!twilioConfigured(env)) {
    return {
      code: 'sms_not_configured', reason: 'server',
      error: 'Texting isn’t set up on this server yet — Twilio isn’t configured. Ask your admin.',
    };
  }
  if (!hasOwnNumber(agent)) {
    return {
      code: 'sms_not_configured', reason: 'number',
      error: 'Texting isn’t set up for your number yet — ask your admin to assign you a phone number.',
    };
  }
  return null;
}

module.exports = { twilioConfigured, hasOwnNumber, smsSendBlock };
