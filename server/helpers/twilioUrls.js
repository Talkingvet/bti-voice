// Review §5 A6 (Pass 2 batch 5, 2026-10-06): allow-list for Twilio media URLs.
//
// Recording and MMS URLs arrive in webhook bodies and are later fetched with
// our Twilio credentials attached (Basic SID:TOKEN). If webhook signature
// checking were ever soft, a forged POST could point us at an attacker's
// server and collect those credentials. So every such URL must be, exactly:
//
//   https://api.twilio.com/2010-04-01/Accounts/<OUR account SID>/Recordings/RE…
//   https://api.twilio.com/2010-04-01/Accounts/<OUR account SID>/Messages/<MM|SM>…/Media/ME…
//
// optionally followed by .mp3 / .wav / .json. No query string, no userinfo,
// no other host or path. Checked when the URL is STORED and again when it is
// FETCHED, so rows written before this batch are covered too.
const SID32 = '[0-9a-fA-F]{32}';
const PATH_RE = new RegExp(
  `^/2010-04-01/Accounts/(AC${SID32})/(?:` +
  `Recordings/RE${SID32}` +
  `|Messages/(?:MM|SM)${SID32}/Media/ME${SID32}` +
  `)(?:\\.(?:mp3|wav|json))?$`
);

// Returns the normalised URL string, or null if it is not one of ours.
// `accountSid` defaults to TWILIO_ACCOUNT_SID; when known, the Account in
// the path must match it.
function twilioMediaUrl(value, accountSid = process.env.TWILIO_ACCOUNT_SID) {
  if (typeof value !== 'string' || value.length > 512) return null;
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'api.twilio.com' || u.port !== '') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  const m = PATH_RE.exec(u.pathname);
  if (!m) return null;
  if (accountSid && m[1] !== accountSid) return null;
  return `https://api.twilio.com${u.pathname}`;
}

function isTwilioMediaUrl(value, accountSid) {
  return twilioMediaUrl(value, accountSid) !== null;
}

module.exports = { twilioMediaUrl, isTwilioMediaUrl };
