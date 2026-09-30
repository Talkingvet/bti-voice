// Single secret for the portal: signs session JWTs and derives the key that
// encrypts tenant admin keys at rest. Same posture as server/secret.js — never
// a hardcoded fallback; in production we refuse to boot without it, because a
// per-boot random value would make every stored tenant key undecryptable
// after the next deploy.
const crypto = require('crypto');

function resolve(name) {
  if (process.env[name]) return process.env[name];
  if (process.env.NODE_ENV === 'production') {
    console.error(`[secret] FATAL: ${name} is not set. Set it in Railway → Variables and redeploy.`);
    process.exit(1);
  }
  console.warn(`[secret] ${name} is not set — using a random per-boot value (dev only).`);
  return crypto.randomBytes(48).toString('hex');
}

const PORTAL_SECRET = resolve('PORTAL_SECRET');

module.exports = { PORTAL_SECRET };
