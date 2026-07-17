const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/schema');
const { signToken, authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });
    const hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id',
      [email, hash, name]
    );
    const id = result.rows[0].id;
    const token = signToken({ id, email, name });
    res.json({ token, user: { id, email, name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken({ id: user.id, email: user.email, name: user.name });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// TEMPORARY one-time admin password reset, gated by a server-only secret env var.
// Remove this route once used.
router.post('/admin-reset-password', async (req, res) => {
  const { email, new_password, secret } = req.body;
  if (!process.env.ADMIN_RESET_SECRET || secret !== process.env.ADMIN_RESET_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!email || !new_password) return res.status(400).json({ error: 'email and new_password required' });
  const hash = bcrypt.hashSync(new_password, 10);
  const result = await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email', [hash, email]);
  if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, user: result.rows[0] });
});

module.exports = router;
