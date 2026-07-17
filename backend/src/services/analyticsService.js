function calcHoldingDays(purchaseDate) {
  const purchase = new Date(purchaseDate);
  const now = new Date();
  return Math.max(1, Math.floor((now - purchase) / (1000 * 60 * 60 * 24)));
}

function calcROI(costBasis, currentValue) {
  if (costBasis === 0) return 0;
  return ((currentValue - costBasis) / costBasis) * 100;
}

function calcAnnualisedROI(simpleROI, holdingDays) {
  if (holdingDays <= 0) return 0;
  const fraction = holdingDays / 365;
  return (Math.pow(1 + simpleROI / 100, 1 / fraction) - 1) * 100;
}

// Money-weighted annualised return (XIRR) via bisection.
// cashflows: [{ amount, date }] — negative = money in (purchase), positive = money out / current value.
function calcXIRR(cashflows) {
  if (cashflows.length < 2) return 0;
  const t0 = new Date(cashflows[0].date).getTime();
  const flows = cashflows.map(cf => ({
    amount: cf.amount,
    years: (new Date(cf.date).getTime() - t0) / (365.25 * 24 * 60 * 60 * 1000),
  }));

  const npv = rate => flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, f.years), 0);

  let lo = -0.9999, hi = 100;
  let npvLo = npv(lo), npvHi = npv(hi);
  if (npvLo * npvHi > 0) return 0; // no sign change — XIRR undefined for these flows

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-9) { lo = hi = mid; break; }
    if (v * npvLo < 0) { hi = mid; npvHi = v; } else { lo = mid; npvLo = v; }
  }
  return ((lo + hi) / 2) * 100;
}

function enrichTransaction(tx, livePrice) {
  const costBasis = tx.purchase_price * tx.units;
  const currentPrice = livePrice ?? tx.manual_price ?? tx.purchase_price;
  const currentValue = currentPrice * tx.units;
  const pnl = currentValue - costBasis;
  const holdingDays = calcHoldingDays(tx.purchase_date);
  const simpleROI = calcROI(costBasis, currentValue);
  const annualisedROI = calcAnnualisedROI(simpleROI, holdingDays);

  return {
    ...tx,
    cost_basis: costBasis,
    current_price: currentPrice,
    current_value: currentValue,
    pnl,
    holding_days: holdingDays,
    simple_roi: simpleROI,
    annualised_roi: annualisedROI,
  };
}

function aggregateByRisk(enrichedTxs) {
  const groups = {};
  for (const tx of enrichedTxs) {
    if (!groups[tx.risk_level]) {
      groups[tx.risk_level] = { risk_level: tx.risk_level, cost_basis: 0, current_value: 0, pnl: 0 };
    }
    groups[tx.risk_level].cost_basis += tx.cost_basis;
    groups[tx.risk_level].current_value += tx.current_value;
    groups[tx.risk_level].pnl += tx.pnl;
  }
  return Object.values(groups).map(g => ({
    ...g,
    simple_roi: calcROI(g.cost_basis, g.current_value),
  }));
}

function aggregateByPlatform(enrichedTxs) {
  const groups = {};
  for (const tx of enrichedTxs) {
    const key = tx.platform_id;
    if (!groups[key]) {
      groups[key] = {
        platform_id: tx.platform_id,
        platform_name: tx.platform_name,
        cost_basis: 0,
        current_value: 0,
        pnl: 0,
      };
    }
    groups[key].cost_basis += tx.cost_basis;
    groups[key].current_value += tx.current_value;
    groups[key].pnl += tx.pnl;
  }
  return Object.values(groups).map(g => ({
    ...g,
    simple_roi: calcROI(g.cost_basis, g.current_value),
  }));
}

function aggregateByShare(enrichedTxs) {
  const groups = {};
  for (const tx of enrichedTxs) {
    const key = tx.ticker;
    if (!groups[key]) {
      groups[key] = {
        ticker: tx.ticker,
        share_name: tx.share_name,
        exchange: tx.exchange,
        risk_level: tx.risk_level,
        currency: tx.currency || 'USD',
        asset_type: tx.asset_type || 'Stock',
        fund_house: tx.fund_house || null,
        cost_basis: 0,
        current_value: 0,
        pnl: 0,
        units: 0,
        earliest_purchase_date: tx.purchase_date,
        lots: [],
      };
    }
    groups[key].cost_basis += tx.cost_basis;
    groups[key].current_value += tx.current_value;
    groups[key].pnl += tx.pnl;
    groups[key].units += tx.units;
    groups[key].lots.push({ amount: -tx.cost_basis, date: tx.purchase_date });
    if (new Date(tx.purchase_date) < new Date(groups[key].earliest_purchase_date)) {
      groups[key].earliest_purchase_date = tx.purchase_date;
    }
  }
  return Object.values(groups).map(g => {
    const simpleROI = calcROI(g.cost_basis, g.current_value);
    const holdingDays = calcHoldingDays(g.earliest_purchase_date);
    // Money-weighted (XIRR): each lot is a dated outflow, current value is today's inflow.
    const cashflows = [...g.lots].sort((a, b) => new Date(a.date) - new Date(b.date));
    cashflows.push({ amount: g.current_value, date: new Date().toISOString().slice(0, 10) });
    const { lots, ...rest } = g;
    return {
      ...rest,
      simple_roi: simpleROI,
      holding_days: holdingDays,
      annualised_roi: calcXIRR(cashflows),
    };
  });
}

module.exports = { enrichTransaction, aggregateByRisk, aggregateByPlatform, aggregateByShare };
