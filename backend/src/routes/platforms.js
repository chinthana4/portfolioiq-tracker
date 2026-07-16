const express = require('express');
const { pool } = require('../db/schema');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM platforms WHERE user_id = $1 ORDER BY name', [req.user.id]);
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { name, description, currency = 'GBP' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = await pool.query(
    'INSERT INTO platforms (user_id, name, description, currency) VALUES ($1, $2, $3, $4) RETURNING *',
    [req.user.id, name, description, currency]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/:id', async (req, res) => {
  const { name, description, currency } = req.body;
  const existing = await pool.query('SELECT * FROM platforms WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Platform not found' });
  const p = existing.rows[0];
  await pool.query(
    'UPDATE platforms SET name = $1, description = $2, currency = $3 WHERE id = $4',
    [name ?? p.name, description ?? p.description, currency ?? p.currency, req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  const existing = await pool.query('SELECT id FROM platforms WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Platform not found' });
  await pool.query('DELETE FROM platforms WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
