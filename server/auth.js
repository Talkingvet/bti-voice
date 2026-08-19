const jwt = require('jsonwebtoken');
const { JWT_SECRET, INTERNAL_TOKEN } = require('./secret');

function generateToken(agent) {
  return jwt.sign(
    { id: agent.id, username: agent.username, name: agent.name },
    JWT_SECRET,
    { expiresIn: '7d' }
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
function requireMediaAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try { req.agent = jwt.verify(header.slice(7), JWT_SECRET); return next(); } catch { /* fall through */ }
  }
  const q = req.query.token;
  if (q) {
    try {
      const payload = jwt.verify(q, JWT_SECRET);
      if (payload.scope === 'media') { req.mediaAgentId = payload.agent_id; return next(); }
      return res.status(401).json({ error: 'Full login tokens are not accepted in URLs — request a media token' });
    } catch { /* fall through */ }
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.agent = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Allows either a logged-in agent (Bearer JWT) OR an internal server-to-server
// call carrying the per-process internal token. Used to lock down endpoints
// that are called both by the client and by localhost self-calls.
function internalOrAuth(req, res, next) {
  if (req.headers['x-internal-token'] === INTERNAL_TOKEN) return next();
  return requireAuth(req, res, next);
}

module.exports = { generateToken, requireAuth, internalOrAuth, generateMediaToken, requireMediaAuth, MEDIA_TOKEN_TTL_SEC };
