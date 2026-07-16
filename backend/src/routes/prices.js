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

// Bulk manual NAV update for Thai mutual funds (or any manual price override)
// Body: { updates: [{ ticker, exchange, price, currency }] }
router.post('/bulk-nav', async (req, res) => {
  const { updates } = req.body;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates array required' });
  }

  const results = [];
  for (const { ticker, exchange, price, currency } of updates) {
    if (!ticker || !exchange || price == null) continue;
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) continue;
    try {
      await pool.query(`
        INSERT INTO live_prices (ticker, exchange, price, currency, source, fetched_at)
        VALUES ($1, $2, $3, $4, 'manual', NOW())
        ON CONFLICT (ticker, exchange) DO UPDATE SET
          price = EXCLUDED.price, currency = EXCLUDED.currency,
          source = 'manual', fetched_at = NOW()
      `, [ticker.toUpperCase(), exchange, p, currency || 'THB']);
      results.push({ ticker, status: 'ok' });
    } catch (e) {
      results.push({ ticker, status: 'error', message: e.message });
    }
  }

  res.json({ updated: results.filter(r => r.status === 'ok').length, results });
});

// Get Thai mutual fund holdings for the current user (for the NAV update modal)
router.get('/thai-mf', async (req, res) => {
  const result = await pool.query(`
    SELECT DISTINCT t.ticker, t.share_name, t.exchange, t.currency, t.fund_house,
      lp.price as current_nav, lp.fetched_at as nav_updated_at
    FROM transactions t
    LEFT JOIN live_prices lp ON lp.ticker = t.ticker AND lp.exchange = t.exchange
    WHERE t.user_id = $1 AND t.exchange IN ('TH-MF', 'AIMC')
    ORDER BY t.share_name
  `, [req.user.id]);
  res.json(result.rows);
});

module.exports = router;
