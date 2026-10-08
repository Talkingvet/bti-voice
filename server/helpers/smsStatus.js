// SMS delivery status (Review Pass 2, batch 7b).
//
// Every outbound text asks Twilio for a status callback so we learn what the
// carrier did after Twilio accepted the message. Lifecycle (Twilio's names):
//   accepted/queued/scheduled → sending → sent → delivered
//                                             ↘ undelivered / failed
// Callbacks can arrive out of order (a late "sent" after "delivered"), so a
// status is only written when it is at least as far along as what we hold.

const STATUS_RANK = {
  accepted: 0, queued: 0, scheduled: 0,
  sending: 1,
  sent: 2,
  delivered: 3, read: 3,
  undelivered: 4, failed: 4,   // terminal failures always win
};

const FAILURE = new Set(['undelivered', 'failed']);
const PENDING = new Set(['accepted', 'queued', 'scheduled', 'sending']);

// The URL Twilio posts status updates to. Must be the exact public URL so the
// X-Twilio-Signature check in validateTwilio passes (SERVER_URL + path).
// Without SERVER_URL (local dev) we send nothing — rows then just stay 'sent'.
function statusCallbackUrl(env = process.env) {
  const base = (env.SERVER_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  return `${base}/webhooks/sms/status`;
}

// Add statusCallback to a messages.create() params object (no-op when unset).
function withStatusCallback(params, env = process.env) {
  const url = statusCallbackUrl(env);
  if (url) params.statusCallback = url;
  return params;
}

function normalizeStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, v) ? v : null;
}

// The status to store when Twilio first accepts the message. Twilio returns
// 'queued' (direct send) or 'accepted' (Messaging Service); anything we don't
// recognise falls back to 'sent' so a bubble never shows a bogus state.
function initialStatus(twilioMessage) {
  return normalizeStatus(twilioMessage && twilioMessage.status) || 'sent';
}

function shouldApply(current, incoming) {
  const inc = normalizeStatus(incoming);
  if (!inc) return false;
  const cur = normalizeStatus(current);
  if (cur === null) return true;           // legacy/unknown value → take Twilio's word
  if (FAILURE.has(inc)) return true;       // a failure is always news
  if (FAILURE.has(cur)) return false;      // never resurrect a failed message
  return STATUS_RANK[inc] >= STATUS_RANK[cur];
}

function isFailure(status) { return FAILURE.has(normalizeStatus(status)); }
function isPending(status) { return PENDING.has(normalizeStatus(status)); }

// Plain-English reasons for the Twilio error codes we actually see.
const ERROR_TEXT = {
  30001: 'Message queue overflowed at the carrier',
  30002: 'Account suspended',
  30003: 'Phone is off or unreachable',
  30004: 'Message blocked by the recipient',
  30005: 'Unknown or inactive number',
  30006: 'Landline or number cannot receive texts',
  30007: 'Filtered by the carrier as spam',
  30008: 'Unknown carrier error',
  30034: 'Number not registered for A2P 10DLC',
  21610: 'Recipient opted out (STOP)',
  21614: 'Not a mobile number',
};
function errorText(code) {
  if (code === null || code === undefined || code === '') return null;
  return ERROR_TEXT[Number(code)] || `Carrier error ${code}`;
}

module.exports = {
  STATUS_RANK, statusCallbackUrl, withStatusCallback, normalizeStatus,
  initialStatus, shouldApply, isFailure, isPending, errorText,
};
