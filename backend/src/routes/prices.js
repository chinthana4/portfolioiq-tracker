const express = require('express');
const { authenticate } = require('../middleware/auth');
const { fetchLivePrice, refreshAllPrices } = require('../services/priceService');
const { pool } = require('../db/schema');

const router = express.Router();
router.use(authenticate);

router.get('/live', async (req, res) => {
  const { ticker, exchange } = req.query;
  if (!ticker || !exchange) return res.status(400).json({ error: 'ticker and exchange required' });
  try {
    const data = await fetchLivePrice(ticker, exchange);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/cached', async (req, res) => {
  const result = await pool.query('SELECT * FROM live_prices ORDER BY fetched_at DESC');
  res.json(result.rows);
});

// Trigger manual refresh of all user's tickers
router.post('/refresh', async (req, res) => {
  const result = await pool.query(
    'SELECT DISTINCT ticker, exchange FROM transactions WHERE user_id = $1',
    [req.user.id]
  );
  const tickers = result.rows;
  const results = await Promise.allSettled(
    tickers.map(({ ticker, exchange }) => fetchLivePrice(ticker, exchange))
  );
  res.json({ refreshed: tickers.length, results: results.map(r => r.status) });
});

module.exports = router;
