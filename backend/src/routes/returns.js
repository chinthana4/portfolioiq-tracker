const express = require('express');
const { pool } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const {
  toMonthKey, buildMonthlyReturnSeries, computeAllWindows,
  modifiedDietzMonthlyReturn, chainDietzWindow, WINDOWS,
} = require('../services/monthlyReturnService');

const router = express.Router();
router.use(authenticate);

// Per-holding monthly return series + all windows.
// Uses weighted-average buy price and earliest purchase date across all lots of a ticker.
router.get('/holdings', async (req, res) => {
  const holdings = await pool.query(`
    SELECT ticker, exchange, currency,
      MIN(share_name) as share_name,
      MIN(purchase_date) as first_purchase_date,
      SUM(purchase_price * units) / NULLIF(SUM(units), 0) as avg_buy_price
    FROM transactions
    WHERE user_id = $1
    GROUP BY ticker, exchange, currency
  `, [req.user.id]);

  const result = [];
  for (const h of holdings.rows) {
    const priceRows = await pool.query(
      `SELECT month_end_date, price FROM monthly_prices WHERE ticker = $1 AND exchange = $2 ORDER BY month_end_date ASC`,
      [h.ticker, h.exchange]
    );
    const series = buildMonthlyReturnSeries(priceRows.rows, Number(h.avg_buy_price), h.first_purchase_date);
    const windows = computeAllWindows(series, new Date(), toMonthKey(h.first_purchase_date));

    result.push({
      ticker: h.ticker,
      exchange: h.exchange,
      share_name: h.share_name,
      currency: h.currency,
      first_purchase_date: h.first_purchase_date,
      avg_buy_price: Number(h.avg_buy_price),
      series,
      windows,
    });
  }

  res.json(result);
});

// Portfolio-level Modified Dietz, chained through each window.
router.get('/portfolio', async (req, res) => {
  // All months where at least one held ticker has a locked price
  const monthRows = await pool.query(`
    SELECT DISTINCT mp.month_end_date
    FROM monthly_prices mp
    JOIN transactions t ON t.ticker = mp.ticker AND t.exchange = mp.exchange
    WHERE t.user_id = $1
    ORDER BY mp.month_end_date ASC
  `, [req.user.id]);

  const txs = (await pool.query(
    `SELECT ticker, exchange, purchase_date, purchase_price, units FROM transactions WHERE user_id = $1`,
    [req.user.id]
  )).rows;
  const sales = (await pool.query(
    `SELECT t.ticker, t.exchange, s.sale_date, s.sale_price, s.units_sold
     FROM sales s JOIN transactions t ON t.id = s.transaction_id WHERE s.user_id = $1`,
    [req.user.id]
  )).rows;

  function unitsHeldAsOf(ticker, exchange, dateStr) {
    const bought = txs.filter(t => t.ticker === ticker && t.exchange === exchange && t.purchase_date <= dateStr)
      .reduce((s, t) => s + Number(t.units), 0);
    const sold = sales.filter(s => s.ticker === ticker && s.exchange === exchange && s.sale_date <= dateStr)
      .reduce((s, x) => s + Number(x.units_sold), 0);
    return bought - sold;
  }

  async function lockedPrice(ticker, exchange, monthEndDate) {
    const r = await pool.query(
      `SELECT price FROM monthly_prices WHERE ticker = $1 AND exchange = $2 AND month_end_date = $3`,
      [ticker, exchange, monthEndDate]
    );
    return r.rows.length ? Number(r.rows[0].price) : null;
  }

  const distinctPairs = [...new Set(txs.map(t => `${t.ticker}::${t.exchange}`))].map(k => {
    const [ticker, exchange] = k.split('::');
    return { ticker, exchange };
  });

  const dietzMonths = [];
  let prevValue = 0;

  for (const { month_end_date } of monthRows.rows) {
    const dateStr = new Date(month_end_date).toISOString().slice(0, 10);
    const d = new Date(dateStr);
    const year = d.getUTCFullYear();
    const monthIndex0 = d.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, monthIndex0, 1)).toISOString().slice(0, 10);
    const monthEndExclusive = new Date(Date.UTC(year, monthIndex0 + 1, 0)).toISOString().slice(0, 10);

    // V_end: value of everything held at month end, priced at this month's locked closes.
    // If any held ticker lacks a lock for this exact month, we cannot value it — skip the month (blank).
    let vEnd = 0;
    let missingLock = false;
    for (const { ticker, exchange } of distinctPairs) {
      const units = unitsHeldAsOf(ticker, exchange, dateStr);
      if (units <= 0) continue;
      const price = await lockedPrice(ticker, exchange, dateStr);
      if (price === null) { missingLock = true; break; }
      vEnd += units * price;
    }

    if (missingLock) {
      dietzMonths.push({ month: toMonthKey(dateStr), month_end_date: dateStr, r: null });
      prevValue = null; // break the chain — next month's V_start is unknown too
      continue;
    }

    const flows = [
      ...txs.filter(t => t.purchase_date >= monthStart && t.purchase_date <= monthEndExclusive)
        .map(t => ({ date: t.purchase_date, amount: Number(t.purchase_price) * Number(t.units) })),
      ...sales.filter(s => s.sale_date >= monthStart && s.sale_date <= monthEndExclusive)
        .map(s => ({ date: s.sale_date, amount: -Number(s.sale_price) * Number(s.units_sold) })),
    ];

    const vStart = prevValue ?? 0;
    const r = modifiedDietzMonthlyReturn(vStart, vEnd, flows, year, monthIndex0);
    dietzMonths.push({ month: toMonthKey(dateStr), month_end_date: dateStr, r });
    prevValue = vEnd;
  }

  const windows = {};
  for (const w of WINDOWS) {
    windows[w] = chainDietzWindow(dietzMonths, w, new Date());
  }

  // Flag instability when most capital was deposited very recently (last 30 days)
  const totalCost = txs.reduce((s, t) => s + Number(t.purchase_price) * Number(t.units), 0);
  const recentCost = txs
    .filter(t => (Date.now() - new Date(t.purchase_date).getTime()) < 30 * 24 * 60 * 60 * 1000)
    .reduce((s, t) => s + Number(t.purchase_price) * Number(t.units), 0);
  const recentCapitalWarning = totalCost > 0 && (recentCost / totalCost) > 0.5;

  res.json({ months: dietzMonths, windows, recent_capital_warning: recentCapitalWarning });
});

module.exports = router;
