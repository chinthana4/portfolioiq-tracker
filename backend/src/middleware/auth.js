const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'portfolio-tracker-secret-change-in-production';

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { authenticate, signToken };
