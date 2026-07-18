const { pool } = require('../db/schema');
const { fetchLivePrice } = require('./priceService');

// ---- date helpers ----------------------------------------------------

function toMonthKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDayOfMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0));
}

function isLastCalendarDayOfMonth(date) {
  const d = new Date(date);
  const tomorrow = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return tomorrow.getUTCMonth() !== d.getUTCMonth();
}

function daysInMonth(year, monthIndex0) {
  return lastDayOfMonth(year, monthIndex0).getUTCDate();
}

// ---- Step 0: lock month-end prices (forward-only — no historical EOD feed exists) ----
// Call once per day. If today is the last calendar day of the month and no lock exists
// yet for this ticker/exchange/month, insert today's live price as the immutable close.
async function lockMonthEndPricesIfDue() {
  const today = new Date();
  if (!isLastCalendarDayOfMonth(today)) return { locked: 0, skipped: 'not month-end' };

  const monthEndDate = lastDayOfMonth(today.getUTCFullYear(), today.getUTCMonth()).toISOString().slice(0, 10);

  const tickers = await pool.query(
    `SELECT DISTINCT ticker, exchange FROM transactions`
  );

  let locked = 0;
  for (const { ticker, exchange } of tickers.rows) {
    const existing = await pool.query(
      `SELECT 1 FROM monthly_prices WHERE ticker = $1 AND exchange = $2 AND month_end_date = $3`,
      [ticker, exchange, monthEndDate]
    );
    if (existing.rows.length) continue;

    try {
      const { price, currency, source } = await fetchLivePrice(ticker, exchange);
      await pool.query(
        `INSERT INTO monthly_prices (ticker, exchange, month_end_date, price, currency, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (ticker, exchange, month_end_date) DO NOTHING`,
        [ticker, exchange, monthEndDate, price, currency || 'USD', source]
      );
      locked++;
    } catch {
      // no live price available this month-end — leave the month blank per spec, never zero/interpolated
    }
  }
  return { locked, month_end_date: monthEndDate };
}

// ---- Step 1: build the monthly return series for one holding ----------
// lockedPrices: [{ month_end_date, price }] ascending, already filtered to this ticker/exchange
// avgBuyPrice: weighted-average purchase price (cost_basis / units at time of purchase)
// purchaseDate: earliest purchase date for this ticker (or the specific lot, caller's choice)
function buildMonthlyReturnSeries(lockedPrices, avgBuyPrice, purchaseDate) {
  const purchaseMonthKey = toMonthKey(purchaseDate);
  const sorted = [...lockedPrices].sort((a, b) => new Date(a.month_end_date) - new Date(b.month_end_date));

  // Only months at/after the purchase month are relevant
  const relevant = sorted.filter(p => toMonthKey(p.month_end_date) >= purchaseMonthKey);
  if (!relevant.length) return [];

  const series = [];
  let prevPrice = avgBuyPrice;
  let prevMonthKey = purchaseMonthKey;

  for (const row of relevant) {
    const monthKey = toMonthKey(row.month_end_date);
    const price = row.price === null || row.price === undefined ? null : Number(row.price);

    if (price === null) {
      // Missing price -> blank, never zero, never interpolated. Break the chain: r stays null,
      // but the NEXT month should still compare to the last real price we had, not this blank one.
      series.push({ month: monthKey, month_end_date: row.month_end_date, price: null, r: null, partial: false });
      continue;
    }

    const r = prevPrice === null || prevPrice === undefined ? null : (price / prevPrice - 1);
    series.push({
      month: monthKey,
      month_end_date: row.month_end_date,
      price,
      r,
      partial: monthKey === purchaseMonthKey,
    });
    prevPrice = price;
    prevMonthKey = monthKey;
  }

  return series;
}

// month key arithmetic — "2026-01" -> add/subtract whole months
function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}`;
}

const FIXED_WINDOW_SIZE = { '1M': 1, '3M': 3, '6M': 6, '12M': 12 };

// ---- Step 2 + 3: slice a window from the series and compute its stats ----
// A fixed window (1M/3M/6M/12M) only "exists" if every calendar month in that
// trailing span is present in the series (purchaseMonthKey bounds how far back
// data could possibly go — if the window reaches before that, it's insufficient).
function selectWindowMonths(series, windowKey, todayDate = new Date(), purchaseMonthKey = null) {
  if (!series.length) return { months: [], complete: false };
  const sorted = [...series].sort((a, b) => new Date(a.month_end_date) - new Date(b.month_end_date));
  const byMonth = new Map(sorted.map(m => [m.month, m]));
  const latestMonth = sorted[sorted.length - 1].month;

  if (FIXED_WINDOW_SIZE[windowKey]) {
    const size = FIXED_WINDOW_SIZE[windowKey];
    const earliestNeeded = shiftMonthKey(latestMonth, -(size - 1));
    if (purchaseMonthKey && earliestNeeded < purchaseMonthKey) {
      return { months: [], complete: false }; // window reaches before the holding existed
    }
    const months = [];
    for (let k = earliestNeeded; k <= latestMonth; k = shiftMonthKey(k, 1)) {
      const entry = byMonth.get(k);
      if (!entry) return { months: [], complete: false }; // gap: month never locked at all
      months.push(entry);
    }
    return { months, complete: true };
  }

  if (windowKey === 'YTD') {
    const janThisYear = `${todayDate.getUTCFullYear()}-01`;
    const earliest = purchaseMonthKey && purchaseMonthKey > janThisYear ? purchaseMonthKey : janThisYear;
    if (earliest > latestMonth) return { months: [], complete: false };
    const months = [];
    for (let k = earliest; k <= latestMonth; k = shiftMonthKey(k, 1)) {
      const entry = byMonth.get(k);
      if (!entry) return { months: [], complete: false };
      months.push(entry);
    }
    return { months, complete: true };
  }

  if (windowKey === 'SINCE_PURCHASE') {
    return { months: sorted, complete: true };
  }

  return { months: [], complete: false };
}

function computeWindowStats(selection, windowKey) {
  const monthsInWindow = Array.isArray(selection) ? selection : selection.months;
  const complete = Array.isArray(selection) ? true : selection.complete;
  const n = monthsInWindow.length;

  if (!complete || n === 0) {
    return { window: windowKey, status: 'insufficient history', months: monthsInWindow };
  }

  const hasBlank = monthsInWindow.some(m => m.r === null || m.r === undefined);
  if (hasBlank) {
    return { window: windowKey, status: 'insufficient history', months: monthsInWindow };
  }

  const returns = monthsInWindow.map(m => m.r);
  const cumulative = returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const avgMonthlyReturn = Math.pow(1 + cumulative, 1 / n) - 1;

  let best = monthsInWindow[0], worst = monthsInWindow[0];
  for (const m of monthsInWindow) {
    if (m.r > best.r) best = m;
    if (m.r < worst.r) worst = m;
  }

  const annualised = n >= 12 ? Math.pow(1 + cumulative, 12 / n) - 1 : null;

  return {
    window: windowKey,
    status: 'ok',
    months: monthsInWindow,
    n,
    cumulative,
    avg_monthly_return: avgMonthlyReturn,
    best_month: { month: best.month, r: best.r },
    worst_month: { month: worst.month, r: worst.r },
    annualised: annualised === null ? 'n/a (<1yr)' : annualised,
  };
}

const WINDOWS = ['1M', '3M', '6M', 'YTD', '12M', 'SINCE_PURCHASE'];

function computeAllWindows(series, todayDate = new Date(), purchaseMonthKey = null) {
  const out = {};
  for (const w of WINDOWS) {
    out[w] = computeWindowStats(selectWindowMonths(series, w, todayDate, purchaseMonthKey), w);
  }
  return out;
}

// ---- Step 4: portfolio-level Modified Dietz, chained per window ----------
// flows: [{ date, amount }] amount > 0 = money in (buy), amount < 0 = money out (sell proceeds)
// vStart/vEnd: portfolio value (in a single currency) at start/end of the month
function modifiedDietzMonthlyReturn(vStart, vEnd, flows, year, monthIndex0) {
  const cd = daysInMonth(year, monthIndex0);
  const monthStart = Date.UTC(year, monthIndex0, 1);

  const weightedFlowSum = flows.reduce((sum, f) => {
    const flowDate = new Date(f.date);
    const daysSinceStart = Math.floor((flowDate.getTime() - monthStart) / (1000 * 60 * 60 * 24));
    const wi = (cd - daysSinceStart) / cd;
    return sum + wi * f.amount;
  }, 0);

  const netFlow = flows.reduce((s, f) => s + f.amount, 0);
  const denominator = vStart + weightedFlowSum;
  if (denominator === 0) return null; // undefined Dietz return — avoid div by zero
  return (vEnd - vStart - netFlow) / denominator;
}

// Chain a list of { month, r } Dietz months through a window exactly like Step 3,
// but skip the annualised-only-if->=12mo rule override: same rule applies.
function chainDietzWindow(dietzMonths, windowKey, todayDate = new Date()) {
  const asSeries = dietzMonths.map(m => ({ month: m.month, month_end_date: m.month_end_date, r: m.r }));
  const monthsInWindow = selectWindowMonths(asSeries, windowKey, todayDate);
  return computeWindowStats(monthsInWindow, windowKey);
}

module.exports = {
  toMonthKey,
  lastDayOfMonth,
  isLastCalendarDayOfMonth,
  daysInMonth,
  lockMonthEndPricesIfDue,
  buildMonthlyReturnSeries,
  selectWindowMonths,
  computeWindowStats,
  computeAllWindows,
  modifiedDietzMonthlyReturn,
  chainDietzWindow,
  WINDOWS,
};
