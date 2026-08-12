const jwt = require('jsonwebtoken');
const { JWT_SECRET, INTERNAL_TOKEN } = require('./secret');

function generateToken(agent) {
  return jwt.sign(
    { id: agent.id, username: agent.username, name: agent.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
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

module.exports = { generateToken, requireAuth, internalOrAuth };
