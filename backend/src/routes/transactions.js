const express = require('express');
const { pool } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const { fetchLivePrice, convertCurrency } = require('../services/priceService');
const { enrichTransaction, aggregateByRisk, aggregateByPlatform, aggregateByShare } = require('../services/analyticsService');

const router = express.Router();
router.use(authenticate);

const RISK_SCORE = { Low: 1, Medium: 2, High: 3, 'Very High': 4 };

// Float64 subtraction of NUMERIC-derived values can leave a residue like 7e-16
// instead of exactly 0 for a fully-sold lot; treat anything under this as zero.
function clampUnits(n) {
  return Math.abs(n) < 1e-6 ? 0 : n;
}

// Live prices come back in the quote's native currency (e.g. USD for a US stock),
// but the transaction's cost basis is stored in its own currency (often GBP for
// GBP-settled brokers). Convert before using the price for any P&L calculation.
async function resolveCurrentPrice(tx) {
  try {
    const priceData = await fetchLivePrice(tx.ticker, tx.exchange);
    return convertCurrency(priceData.price, priceData.currency, tx.currency);
  } catch {
    return tx.manual_price;
  }
}

router.get('/', async (req, res) => {
  const { platform_id, risk_level, ticker } = req.query;
  const conditions = ['t.user_id = $1'];
  const params = [req.user.id];
  let idx = 2;

  if (platform_id) { conditions.push(`t.platform_id = $${idx++}`); params.push(platform_id); }
  if (risk_level)  { conditions.push(`t.risk_level = $${idx++}`); params.push(risk_level); }
  if (ticker)      { conditions.push(`t.ticker = $${idx++}`); params.push(ticker.toUpperCase()); }

  const sql = `
    SELECT t.*, p.name as platform_name,
      t.units - COALESCE((SELECT SUM(s.units_sold) FROM sales s WHERE s.transaction_id = t.id), 0) AS remaining_units
    FROM transactions t
    JOIN platforms p ON p.id = t.platform_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.purchase_date DESC
  `;

  const result = await pool.query(sql, params);
  const txs = result.rows;

  const enriched = await Promise.all(txs.map(async (tx) => {
    const originalUnits = Number(tx.units);
    const remainingUnits = clampUnits(Number(tx.remaining_units));
    // Unrealized P&L should only reflect units still held, not units already sold.
    const calcTx = { ...tx, units: remainingUnits };
    const price = await resolveCurrentPrice(tx);
    const result = enrichTransaction(calcTx, price);
    return { ...result, units: originalUnits, remaining_units: remainingUnits };
  }));

  res.json(enriched);
});

router.get('/summary', async (req, res) => {
  const result = await pool.query(`
    SELECT t.*, p.name as platform_name,
      t.units - COALESCE((SELECT SUM(s.units_sold) FROM sales s WHERE s.transaction_id = t.id), 0) AS remaining_units
    FROM transactions t
    JOIN platforms p ON p.id = t.platform_id
    WHERE t.user_id = $1
  `, [req.user.id]);

  const txs = result.rows;

  const enriched = await Promise.all(txs.map(async (tx) => {
    const originalUnits = Number(tx.units);
    const remainingUnits = clampUnits(Number(tx.remaining_units));
    const calcTx = { ...tx, units: remainingUnits };
    const price = await resolveCurrentPrice(tx);
    const result = enrichTransaction(calcTx, price);
    return { ...result, units: originalUnits, remaining_units: remainingUnits };
  }));

  const totalInvested = enriched.reduce((s, t) => s + Number(t.cost_basis), 0);
  const totalValue    = enriched.reduce((s, t) => s + Number(t.current_value), 0);
  const totalPnl      = totalValue - totalInvested;
  const overallROI    = totalInvested > 0 ? ((totalPnl / totalInvested) * 100) : 0;

  res.json({
    total_invested: totalInvested,
    total_value: totalValue,
    total_pnl: totalPnl,
    overall_roi: overallROI,
    by_risk: aggregateByRisk(enriched),
    by_platform: aggregateByPlatform(enriched),
    by_share: aggregateByShare(enriched),
    transaction_count: enriched.length,
  });
});

router.post('/', async (req, res) => {
  const { platform_id, share_name, ticker, exchange, purchase_date, purchase_price, units, risk_level, currency, notes, manual_price, asset_type, fund_house } = req.body;
  if (!platform_id || !share_name || !ticker || !purchase_date || !purchase_price || !units || !risk_level) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const validRisks = ['Low', 'Medium', 'High', 'Very High'];
  if (!validRisks.includes(risk_level)) return res.status(400).json({ error: 'Invalid risk_level' });

  const pf = await pool.query('SELECT id FROM platforms WHERE id = $1 AND user_id = $2', [platform_id, req.user.id]);
  if (!pf.rows.length) return res.status(404).json({ error: 'Platform not found' });

  const resolvedExchange = asset_type === 'Mutual Fund' && !exchange ? 'TH-MF' : (exchange || 'LSE');
  const resolvedCurrency = currency || (resolvedExchange === 'TH-MF' ? 'THB' : 'USD');

  const result = await pool.query(`
    INSERT INTO transactions
      (user_id, platform_id, share_name, ticker, exchange, purchase_date, purchase_price, units, risk_level, risk_score, currency, notes, manual_price, asset_type, fund_house)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id
  `, [req.user.id, platform_id, share_name, ticker.toUpperCase(), resolvedExchange,
      purchase_date, purchase_price, units, risk_level, RISK_SCORE[risk_level],
      resolvedCurrency, notes, manual_price || null, asset_type || 'Stock', fund_house || null]);

  res.status(201).json({ id: result.rows[0].id });
});

router.put('/:id', async (req, res) => {
  const existing = await pool.query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Transaction not found' });
  const tx = existing.rows[0];

  const fields = ['share_name','ticker','exchange','purchase_date','purchase_price','units','risk_level','currency','notes','manual_price','asset_type','fund_house'];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (updates.risk_level) updates.risk_score = RISK_SCORE[updates.risk_level] || tx.risk_score;
  updates.updated_at = new Date();

  const keys = Object.keys(updates);
  if (!keys.length) return res.json({ success: true });

  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await pool.query(
    `UPDATE transactions SET ${setClauses} WHERE id = $${keys.length + 1}`,
    [...Object.values(updates), req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  const existing = await pool.query('SELECT id FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Transaction not found' });
  await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
