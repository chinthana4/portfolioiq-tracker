const express = require('express');
const { pool } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const { enrichSale, summarizeRealized } = require('../services/analyticsService');

const router = express.Router();
router.use(authenticate);

async function getRemainingUnits(client, transactionId) {
  const result = await client.query(
    `SELECT t.units - COALESCE((SELECT SUM(s.units_sold) FROM sales s WHERE s.transaction_id = t.id), 0) AS remaining
     FROM transactions t WHERE t.id = $1`,
    [transactionId]
  );
  return result.rows.length ? Number(result.rows[0].remaining) : 0;
}

// List all realized sales for the user, newest first
router.get('/', async (req, res) => {
  const result = await pool.query(`
    SELECT s.*, t.ticker, t.share_name, t.exchange, t.currency, t.asset_type,
      t.purchase_price, t.purchase_date, t.risk_level, t.platform_id, p.name as platform_name
    FROM sales s
    JOIN transactions t ON t.id = s.transaction_id
    JOIN platforms p ON p.id = t.platform_id
    WHERE s.user_id = $1
    ORDER BY s.sale_date DESC, s.id DESC
  `, [req.user.id]);

  res.json(result.rows.map(enrichSale));
});

// Realized P&L summary
router.get('/summary', async (req, res) => {
  const result = await pool.query(`
    SELECT s.*, t.ticker, t.share_name, t.exchange, t.currency, t.asset_type, t.purchase_price, t.purchase_date
    FROM sales s
    JOIN transactions t ON t.id = s.transaction_id
    WHERE s.user_id = $1
  `, [req.user.id]);

  res.json(summarizeRealized(result.rows.map(enrichSale)));
});

// Sell units of a ticker — FIFO across lots (oldest purchase first)
router.post('/', async (req, res) => {
  const { ticker, sale_date, sale_price, units, notes } = req.body;
  if (!ticker || !sale_date || !sale_price || !units) {
    return res.status(400).json({ error: 'ticker, sale_date, sale_price and units are required' });
  }
  const unitsToSell = parseFloat(units);
  const price = parseFloat(sale_price);
  if (unitsToSell <= 0 || price <= 0) return res.status(400).json({ error: 'units and sale_price must be positive' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lotsResult = await client.query(
      `SELECT id, units, purchase_date FROM transactions
       WHERE user_id = $1 AND ticker = $2 ORDER BY purchase_date ASC, id ASC`,
      [req.user.id, ticker.toUpperCase()]
    );
    if (!lotsResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `No holdings found for ${ticker}` });
    }

    let remaining = unitsToSell;
    const createdSales = [];

    for (const lot of lotsResult.rows) {
      if (remaining <= 0) break;
      const lotRemaining = await getRemainingUnits(client, lot.id);
      if (lotRemaining <= 0) continue;

      const sellFromLot = Math.min(lotRemaining, remaining);
      const proceeds = sellFromLot * price;

      const inserted = await client.query(`
        INSERT INTO sales (user_id, transaction_id, sale_date, sale_price, units_sold, proceeds, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [req.user.id, lot.id, sale_date, price, sellFromLot, proceeds, notes || null]);

      createdSales.push({ sale_id: inserted.rows[0].id, transaction_id: lot.id, units_sold: sellFromLot });
      remaining -= sellFromLot;
    }

    if (remaining > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Cannot sell ${unitsToSell} units — only ${unitsToSell - remaining} units of ${ticker} are currently held`,
      });
    }

    await client.query('COMMIT');
    res.status(201).json({ sales: createdSales });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const existing = await pool.query(
    `SELECT s.id FROM sales s WHERE s.id = $1 AND s.user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!existing.rows.length) return res.status(404).json({ error: 'Sale not found' });
  await pool.query('DELETE FROM sales WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
