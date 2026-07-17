function calcHoldingDays(purchaseDate) {
  const purchase = new Date(purchaseDate);
  const now = new Date();
  return Math.max(1, Math.floor((now - purchase) / (1000 * 60 * 60 * 24)));
}

function calcHoldingDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.max(1, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
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
    // Key on platform + ticker so the same share held on two platforms shows in both sections
    const key = `${tx.platform_id}:${tx.ticker}`;
    if (!groups[key]) {
      groups[key] = {
        ticker: tx.ticker,
        share_name: tx.share_name,
        platform_id: tx.platform_id,
        platform_name: tx.platform_name,
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
    // Use remaining (unsold) units for the open position, not the original lot size.
    const openUnits = tx.remaining_units ?? tx.units;
    groups[key].cost_basis += tx.cost_basis;
    groups[key].current_value += tx.current_value;
    groups[key].pnl += tx.pnl;
    groups[key].units += openUnits;
    if (openUnits > 0) groups[key].lots.push({ amount: -tx.cost_basis, date: tx.purchase_date });
    if (new Date(tx.purchase_date) < new Date(groups[key].earliest_purchase_date)) {
      groups[key].earliest_purchase_date = tx.purchase_date;
    }
  }
  return Object.values(groups)
    .filter(g => g.units > 0) // fully-sold positions have nothing left to show as a holding
    .map(g => {
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

// Turns a raw sale row (joined with its source transaction/lot) into realized P&L figures.
function enrichSale(sale) {
  const costBasis = sale.purchase_price * sale.units_sold;
  const proceeds = sale.sale_price * sale.units_sold;
  const pnl = proceeds - costBasis;
  const holdingDays = calcHoldingDaysBetween(sale.purchase_date, sale.sale_date);
  const simpleROI = calcROI(costBasis, proceeds);
  const annualisedROI = calcAnnualisedROI(simpleROI, holdingDays);

  return {
    ...sale,
    cost_basis: costBasis,
    proceeds,
    pnl,
    holding_days: holdingDays,
    simple_roi: simpleROI,
    annualised_roi: annualisedROI,
  };
}

function aggregateRealizedByShare(enrichedSales) {
  const groups = {};
  for (const s of enrichedSales) {
    const key = s.ticker;
    if (!groups[key]) {
      groups[key] = {
        ticker: s.ticker, share_name: s.share_name, exchange: s.exchange,
        currency: s.currency || 'USD', asset_type: s.asset_type || 'Stock',
        cost_basis: 0, proceeds: 0, pnl: 0, units_sold: 0,
      };
    }
    groups[key].cost_basis += s.cost_basis;
    groups[key].proceeds += s.proceeds;
    groups[key].pnl += s.pnl;
    groups[key].units_sold += Number(s.units_sold);
  }
  return Object.values(groups).map(g => ({
    ...g,
    simple_roi: calcROI(g.cost_basis, g.proceeds),
  }));
}

function summarizeRealized(enrichedSales) {
  const totalCostBasis = enrichedSales.reduce((s, x) => s + x.cost_basis, 0);
  const totalProceeds = enrichedSales.reduce((s, x) => s + x.proceeds, 0);
  const totalPnl = totalProceeds - totalCostBasis;
  return {
    total_cost_basis: totalCostBasis,
    total_proceeds: totalProceeds,
    total_realized_pnl: totalPnl,
    overall_realized_roi: calcROI(totalCostBasis, totalProceeds),
    by_share: aggregateRealizedByShare(enrichedSales),
    sale_count: enrichedSales.length,
  };
}

module.exports = {
  enrichTransaction, aggregateByRisk, aggregateByPlatform, aggregateByShare,
  enrichSale, summarizeRealized, calcROI, calcAnnualisedROI, calcHoldingDaysBetween,
};
