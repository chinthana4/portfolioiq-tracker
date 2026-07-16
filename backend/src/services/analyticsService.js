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
        cost_basis: 0,
        current_value: 0,
        pnl: 0,
        units: 0,
      };
    }
    groups[key].cost_basis += tx.cost_basis;
    groups[key].current_value += tx.current_value;
    groups[key].pnl += tx.pnl;
    groups[key].units += tx.units;
  }
  return Object.values(groups).map(g => ({
    ...g,
    simple_roi: calcROI(g.cost_basis, g.current_value),
  }));
}

module.exports = { enrichTransaction, aggregateByRisk, aggregateByPlatform, aggregateByShare };
