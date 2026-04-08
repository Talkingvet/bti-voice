const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'bti-voice-dev-secret';

function generateToken(agent) {
  return jwt.sign(
    { id: agent.id, username: agent.username, name: agent.name },
    SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.agent = jwt.verify(auth.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { generateToken, requireAuth };
