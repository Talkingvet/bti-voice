// Centralized secret resolution — single source of truth.
//
// Security: we never fall back to a *hardcoded* secret (that would let anyone
// forge a login token from a value visible in the public-ish repo). If the env
// var is missing we generate a random one at boot. In production that means
// tokens rotate on each deploy (users re-login) — annoying but safe. Set
// JWT_SECRET in Railway to make sessions survive deploys.
const crypto = require('crypto');

function resolve(name) {
  if (process.env[name]) return process.env[name];
  console.warn(`[secret] ${name} is not set — using a random per-boot value. ` +
               `Set ${name} in the environment for stable sessions.`);
  return crypto.randomBytes(32).toString('hex');
}

const JWT_SECRET = resolve('JWT_SECRET');
const ADMIN_KEY  = resolve('ADMIN_KEY');
// Random per-process token so internal server-to-server calls (localhost
// self-calls into /api/zoho/*) can authenticate without exposing those
// endpoints to the internet. Never leaves this process.
const INTERNAL_TOKEN = crypto.randomBytes(32).toString('hex');

module.exports = { JWT_SECRET, ADMIN_KEY, INTERNAL_TOKEN };
