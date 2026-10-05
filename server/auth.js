const jwt = require('jsonwebtoken');
const { JWT_SECRET, INTERNAL_TOKEN } = require('./secret');
const { loginAllowed, accountStatus } = require('./helpers/deploySettings');
const sessions = require('./helpers/sessions');

// Session lifetime:
//   remember=true  → 30 days, and the client silently renews it every time the
//                    app opens (POST /auth/refresh), so a "keep me signed in"
//                    user is only ever logged out after 30 days of NOT opening
//                    the app — same feel as Zoho Voice / Teams.
//   remember=false → 12 hours, never renewed.
const SESSION_TTL_REMEMBER = '30d';
const SESSION_TTL_SHORT    = '12h';

// `sid` names the device's row in the sessions table (per-device sign-out);
// `tv` mirrors agents.token_version (sign-out-everywhere). See helpers/sessions.js.
function generateToken(agent, { remember = false, sid = null } = {}) {
  return jwt.sign(
    { id: agent.id, username: agent.username, name: agent.name, remember: !!remember,
      sid: sid || undefined, tv: agent.token_version || 0 },
    JWT_SECRET,
    { expiresIn: remember ? SESSION_TTL_REMEMBER : SESSION_TTL_SHORT }
  );
}

// Short-lived, scope-limited token for media/recording URLs. <img>/<audio>
// tags can't send Authorization headers, so a token must ride in the query
// string — but query strings leak (logs, history, referrers). This token is
// only valid for media reads and expires in 10 minutes, unlike the 7-day
// login JWT, which is now REJECTED in query params.
const MEDIA_TOKEN_TTL_SEC = 10 * 60;

function generateMediaToken(agentId) {
  return jwt.sign({ scope: 'media', agent_id: agentId }, JWT_SECRET, { expiresIn: MEDIA_TOKEN_TTL_SEC });
}

// Auth for media/recording endpoints: full JWT in the Authorization header,
// OR a scope:'media' token in ?token=. A full login JWT in ?token= is rejected.
// Revocation check shared by requireAuth / requireMediaAuth / the socket
// handshake. Resolves to null when the session is good, or a { status, body }
// to send. Deactivated agents and revoked sessions get code 'session_revoked'
// so the client signs out with a clear message instead of a generic error.
async function sessionProblem(payload) {
  const s = await sessions.check(payload);
  if (s.ok) return null;
  return {
    status: 401,
    body: s.reason === 'inactive'
      ? { error: 'This account has been deactivated. Contact your administrator.', code: 'session_revoked' }
      : { error: 'You have been signed out. Please sign in again.', code: 'session_revoked' },
  };
}

async function requireMediaAuth(req, res, next) {
  const header = req.headers.authorization;
  let payload = null;
  if (header && header.startsWith('Bearer ')) {
    try { payload = jwt.verify(header.slice(7), JWT_SECRET); } catch { /* fall through */ }
  }
  const q = req.query.token;
  if (!payload && q) {
    try {
      const p = jwt.verify(q, JWT_SECRET);
      if (p.scope !== 'media') {
        return res.status(401).json({ error: 'Full login tokens are not accepted in URLs — request a media token' });
      }
      payload = p;
    } catch { /* fall through */ }
  }
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (payload.scope === 'media') {
      const problem = await sessionProblem({ id: payload.agent_id, media: true });
      if (problem) return res.status(problem.status).json(problem.body);
      req.mediaAgentId = payload.agent_id;
    } else {
      const problem = await sessionProblem(payload);
      if (problem) return res.status(problem.status).json(problem.body);
      req.agent = payload;
    }
  } catch (e) {
    console.error('[auth/media]', e);
    return res.status(500).json({ error: 'Server error' });
  }
  return next();
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.agent = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Session revocation (review §5 A3): is the agent still active, is this
  // device's session still live, has anyone bumped token_version? Cached 30 s.
  try {
    const problem = await sessionProblem(req.agent);
    if (problem) return res.status(problem.status).json(problem.body);
  } catch (e) {
    console.error('[auth]', e);
    return res.status(500).json({ error: 'Server error' });
  }
  // Subscription lifecycle (admin portal Phase 1): once a deploy is blocked
  // (past grace + 30 days, or suspended by BTI) existing sessions stop working
  // too — not just new logins. 403 + code so the client can show the message
  // instead of a generic "logged out". Nothing is deleted; BTI reactivates
  // from the portal.
  if (!loginAllowed()) {
    return res.status(403).json({ error: accountStatus().message, code: 'account_blocked' });
  }
  next();
}

// Allows either a logged-in agent (Bearer JWT) OR an internal server-to-server
// call carrying the per-process internal token. Used to lock down endpoints
// that are called both by the client and by localhost self-calls.
function internalOrAuth(req, res, next) {
  if (req.headers['x-internal-token'] === INTERNAL_TOKEN) return next();
  return requireAuth(req, res, next);
}

module.exports = { generateToken, requireAuth, internalOrAuth, generateMediaToken, requireMediaAuth, sessionProblem, MEDIA_TOKEN_TTL_SEC };
