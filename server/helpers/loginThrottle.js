// Login throttle for POST /api/auth/login — copied from the admin portal
// (admin/auth.js): 10 failed attempts per username per 15 minutes, in memory.
// Per-username so a credential-stuffing run against one account is cut off
// after 10 guesses regardless of how many IPs it comes from; the per-IP
// express-rate-limit on the same route (index.js) covers the other axis.
//
// In-memory is fine here: one process per deploy, and a redeploy clearing the
// counters just means an attacker gets 10 more guesses — same as the portal.
// `now` is injectable for tests.

const MAX_FAILURES = 10;
const WINDOW_MS    = 15 * 60 * 1000;

function createThrottle({ now = Date.now, max = MAX_FAILURES, windowMs = WINDOW_MS } = {}) {
  const failures = new Map();

  function throttled(username) {
    const f = failures.get(username);
    return !!(f && f.count >= max && now() - f.first < windowMs);
  }
  function recordFailure(username) {
    const f = failures.get(username);
    if (!f || now() - f.first > windowMs) failures.set(username, { count: 1, first: now() });
    else f.count++;
  }
  // A successful login clears the slate for that username.
  function clearFailures(username) { failures.delete(username); }

  return { throttled, recordFailure, clearFailures, MAX_FAILURES: max, WINDOW_MS: windowMs };
}

module.exports = { createThrottle, ...createThrottle() };
