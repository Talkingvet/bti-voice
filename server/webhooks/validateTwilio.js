// Twilio webhook signature validation.
//
// Verifies the X-Twilio-Signature header so forged requests can't inject fake
// inbound messages, flip opt-out flags, or trigger outbound auto-replies.
//
// Rollout safety: telephony is live, so this ships in SOFT mode by default —
// a bad/missing signature is logged but the request still processes. Once the
// logs confirm real Twilio traffic validates cleanly, set
// TWILIO_STRICT_WEBHOOKS=true in the environment to start rejecting forgeries
// with 403. If TWILIO_AUTH_TOKEN isn't set (local dev), validation is skipped.
const twilio = require('twilio');

function validateTwilio(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return next(); // dev / not configured

  const signature = req.headers['x-twilio-signature'];
  // Reconstruct the exact public URL Twilio signed. Railway terminates TLS,
  // so we rely on app.set('trust proxy', true) making req.protocol correct.
  const base = process.env.SERVER_URL
    ? process.env.SERVER_URL.replace(/\/+$/, '')
    : `${req.protocol}://${req.get('host')}`;
  const url = base + req.originalUrl;

  let valid = false;
  try {
    valid = twilio.validateRequest(authToken, signature || '', url, req.body || {});
  } catch (e) {
    valid = false;
  }

  if (valid) return next();

  const strict = process.env.TWILIO_STRICT_WEBHOOKS !== undefined
    ? process.env.TWILIO_STRICT_WEBHOOKS === 'true'
    : process.env.NODE_ENV === 'production'; // default strict in prod
  console.warn(`[twilio-validate] signature check FAILED for ${req.method} ${req.originalUrl}` +
               ` (url=${url}) strict=${strict}`);
  if (strict) return res.status(403).send('Invalid Twilio signature');
  return next(); // soft mode: allow but warn
}

module.exports = { validateTwilio };
