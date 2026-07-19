// pptxgenjs is loaded dynamically (only when a PPT export is actually
// triggered) so its ~1MB doesn't bloat the bundle every visitor downloads
// just to view the dashboard.

// Palette: Midnight Executive — consistent with a finance-portfolio deck.
const NAVY = '1E2761';
const ICE = 'CADCFC';
const WHITE = 'FFFFFF';
const GREEN = '2E9E5B';
const RED = 'C0392B';
const GREY = '6B7280';
const LIGHT_BG = 'F7F9FC';

const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', THB: '฿', AUD: 'A$', CAD: 'C$', SGD: 'S$', HKD: 'HK$' };
function sym(c) { return CURRENCY_SYMBOLS[c] || (c ? c + ' ' : '$'); }
function fmtMoney(n, c) {
  if (n === null || n === undefined) return '—';
  return `${n < 0 ? '-' : ''}${sym(c)}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

// Holdings tables are capped per slide to avoid running off the bottom —
// overflow spills onto a continuation slide rather than being cut off.
const MAX_ROWS_PER_TABLE = 9;

function addTitleSlide(pres, subtitle) {
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape('ellipse', { x: 9.8, y: -2.2, w: 7, h: 7, fill: { color: '273080' }, line: { type: 'none' } });
  s.addShape('ellipse', { x: -3, y: 4.5, w: 6, h: 6, fill: { color: '273080' }, line: { type: 'none' } });
  s.addText('PORTFOLIO REVIEW', { x: 0.9, y: 2.5, w: 11.5, h: 1, fontFace: 'Calibri', fontSize: 20, color: ICE, charSpacing: 4, bold: true });
  s.addText('Investment Portfolio Summary', { x: 0.9, y: 3.05, w: 11.5, h: 1.2, fontFace: 'Cambria', fontSize: 40, color: WHITE, bold: true });
  s.addText(subtitle, { x: 0.9, y: 4.1, w: 11.5, h: 0.5, fontFace: 'Calibri', fontSize: 16, color: ICE });
  s.addText(`Generated ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, {
    x: 0.9, y: 6.7, w: 6, h: 0.4, fontFace: 'Calibri', fontSize: 12, color: '8B96C4',
  });
}

function addSummarySlide(pres, currencies, byCurrency, realizedByCurrency, holdingCountsByCurrency, totalHoldings) {
  const s = pres.addSlide();
  s.background = { color: WHITE };
  s.addText('Executive Summary', { x: 0.6, y: 0.45, w: 11, h: 0.6, fontFace: 'Cambria', fontSize: 32, bold: true, color: NAVY });
  s.addText('Portfolio value and performance by currency', { x: 0.6, y: 1.05, w: 11, h: 0.4, fontFace: 'Calibri', fontSize: 14, color: GREY });

  // Up to 4 stat cards: one per currency's current value (max 3) + total holdings count.
  const cards = currencies.slice(0, 3).map(c => ({
    label: `${c} PORTFOLIO VALUE`,
    value: fmtMoney(byCurrency[c]?.value || 0, c),
    sub: pct(byCurrency[c]?.invested ? (byCurrency[c].pnl / byCurrency[c].invested) * 100 : 0) + ' overall',
    color: (byCurrency[c]?.pnl || 0) >= 0 ? GREEN : RED,
  }));
  cards.push({ label: 'TOTAL HOLDINGS', value: String(totalHoldings), sub: currencies.map(c => `${holdingCountsByCurrency[c] || 0} ${c}`).join(' · '), color: NAVY });

  const cardW = 2.75, gap = 0.35, startX = 0.6, y = 1.85, h = 2.0;
  cards.forEach((c, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape('roundRect', {
      x, y, w: cardW, h, rectRadius: 0.08, fill: { color: LIGHT_BG }, line: { type: 'none' },
      shadow: { type: 'outer', color: '9AA5C0', opacity: 0.35, blur: 6, offset: 2, angle: 90 },
    });
    s.addText(c.label, { x: x + 0.2, y: y + 0.22, w: cardW - 0.4, h: 0.4, fontFace: 'Calibri', fontSize: 10, bold: true, color: GREY, charSpacing: 0.5 });
    s.addText(c.value, { x: x + 0.2, y: y + 0.62, w: cardW - 0.4, h: 0.65, fontFace: 'Cambria', fontSize: 22, bold: true, color: NAVY });
    s.addText(c.sub, { x: x + 0.2, y: y + 1.35, w: cardW - 0.4, h: 0.4, fontFace: 'Calibri', fontSize: 12, bold: true, color: c.color });
  });

  s.addText('By Currency', { x: 0.6, y: 4.25, w: 6, h: 0.4, fontFace: 'Calibri', fontSize: 16, bold: true, color: NAVY });
  const rows = [['Currency', 'Invested', 'Value', 'Unrealized P&L', 'Realized P&L', 'ROI']].concat(
    currencies.map(c => {
      const g = byCurrency[c] || { invested: 0, value: 0, pnl: 0 };
      const r = realizedByCurrency[c] || { pnl: 0 };
      const roi = g.invested ? (g.pnl / g.invested) * 100 : 0;
      return [c, fmtMoney(g.invested, c), fmtMoney(g.value, c), fmtMoney(g.pnl, c), fmtMoney(r.pnl, c), pct(roi)];
    })
  );
  s.addTable(
    rows.map((r, ri) => r.map((cell, ci) => ({
      text: cell,
      options: {
        bold: ri === 0, fontFace: 'Calibri', fontSize: 12,
        color: ri === 0 ? WHITE : (ci >= 3 ? (String(cell).startsWith('-') ? RED : GREEN) : NAVY),
        fill: { color: ri === 0 ? NAVY : (ri % 2 === 0 ? LIGHT_BG : WHITE) },
        align: ci === 0 ? 'left' : 'right', valign: 'middle',
      },
    }))),
    { x: 0.6, y: 4.7, w: 12.1, colW: [1.6, 2.3, 2.3, 2.3, 2.1, 1.5], rowH: 0.42, border: { type: 'none' } }
  );
}

function addPlatformSlides(pres, platformName, shares, currency, pageIndex) {
  const s = pres.addSlide();
  s.background = { color: WHITE };
  const titleSuffix = pageIndex > 0 ? ` (cont'd ${pageIndex + 1})` : '';
  s.addText(`${platformName}${titleSuffix}`, { x: 0.6, y: 0.45, w: 11.5, h: 0.6, fontFace: 'Cambria', fontSize: 28, bold: true, color: NAVY });
  if (pageIndex === 0) {
    const totalValue = shares.reduce((sum, x) => sum + x.current_value, 0);
    s.addText(`${shares.length} holding${shares.length === 1 ? '' : 's'} · ${fmtMoney(totalValue, currency)} value`, {
      x: 0.6, y: 1.05, w: 11, h: 0.4, fontFace: 'Calibri', fontSize: 14, color: GREY,
    });
  }

  // Bar chart uses tickers (short) as categories to avoid label collision —
  // full names go in the table below where each row has its own space.
  const sortedByValue = [...shares].sort((a, b) => b.current_value - a.current_value);
  if (sortedByValue.length > 0) {
    s.addChart(pres.charts.BAR, [{
      name: `Value (${currency})`,
      labels: sortedByValue.map(x => x.ticker),
      values: sortedByValue.map(x => x.current_value),
    }], {
      x: 0.6, y: 1.55, w: 12.1, h: 2.5,
      barDir: 'col',
      showTitle: true, title: 'Holdings by Current Value', titleFontFace: 'Calibri', titleFontSize: 12, titleColor: NAVY,
      showValue: false,
      chartColors: [NAVY],
      catAxisLabelRotate: sortedByValue.length > 8 ? 45 : 0,
      catAxisLabelColor: GREY, catAxisLabelFontSize: 8.5,
      valAxisLabelColor: GREY, valAxisLabelFontSize: 9,
      valGridLine: { color: 'E5E9F0', size: 1 },
      catGridLine: { style: 'none' },
      showLegend: false,
    });
  }

  const rows = [['Ticker', 'Name', 'Invested', 'Value', 'P&L', 'ROI']].concat(
    sortedByValue.map(x => [
      x.ticker, x.share_name,
      fmtMoney(x.cost_basis, currency), fmtMoney(x.current_value, currency),
      fmtMoney(x.pnl, currency), pct(x.simple_roi),
    ])
  );
  s.addTable(
    rows.map((r, ri) => r.map((cell, ci) => ({
      text: cell,
      options: {
        bold: ri === 0, fontFace: 'Calibri', fontSize: 10,
        color: ri === 0 ? WHITE : (ci === 4 ? (String(cell).startsWith('-') ? RED : GREEN) : NAVY),
        fill: { color: ri === 0 ? NAVY : (ri % 2 === 0 ? LIGHT_BG : WHITE) },
        align: ci <= 1 ? 'left' : 'right', valign: 'middle',
      },
    }))),
    { x: 0.6, y: 4.25, w: 12.1, colW: [1.6, 4.2, 2.1, 2.1, 1.4, 0.7], rowH: 0.26, border: { type: 'none' } }
  );
}

function addRiskSlide(pres, byRisk, dominantCurrency) {
  const total = byRisk.reduce((s, r) => s + r.current_value, 0);
  if (total <= 0) return;
  const s = pres.addSlide();
  s.background = { color: WHITE };
  s.addText('Risk Allocation', { x: 0.6, y: 0.45, w: 11, h: 0.6, fontFace: 'Cambria', fontSize: 32, bold: true, color: NAVY });
  s.addText(`By declared risk level (shown in ${dominantCurrency}-equivalent proportions)`, { x: 0.6, y: 1.05, w: 11, h: 0.4, fontFace: 'Calibri', fontSize: 13, color: GREY });

  const RISK_COLORS = { Low: '2E9E5B', Medium: 'E67E22', High: 'C0392B', 'Very High': '7A1F1F' };
  const data = byRisk.filter(r => r.current_value > 0);
  s.addChart(pres.charts.DOUGHNUT, [{
    name: 'Risk',
    labels: data.map(r => r.risk_level),
    values: data.map(r => Math.round((r.current_value / total) * 1000) / 10),
  }], {
    x: 1.0, y: 1.8, w: 5.6, h: 5.0,
    showLegend: true, legendPos: 'b', legendFontSize: 12, legendColor: NAVY,
    showValue: true, dataLabelFormatCode: '0"%"', dataLabelColor: WHITE, dataLabelFontSize: 13, dataLabelFontBold: true,
    chartColors: data.map(r => RISK_COLORS[r.risk_level] || '94A3B8'),
    dataLabelPosition: 'ctr',
  });

  data.forEach((r, i) => {
    const y = 2.1 + i * 1.35;
    if (y > 6.4) return; // stop adding cards past the slide edge if there are many risk levels
    s.addShape('roundRect', { x: 7.0, y, w: 5.7, h: 1.15, rectRadius: 0.08, fill: { color: LIGHT_BG }, line: { type: 'none' } });
    s.addText(`${r.risk_level} Risk — ${((r.current_value / total) * 100).toFixed(1)}%`, { x: 7.3, y: y + 0.15, w: 5.1, h: 0.4, fontFace: 'Calibri', fontSize: 15, bold: true, color: NAVY });
    s.addText(`${fmtMoney(r.current_value, dominantCurrency)} · ROI ${pct(r.simple_roi)}`, { x: 7.3, y: y + 0.6, w: 5.1, h: 0.4, fontFace: 'Calibri', fontSize: 12, color: GREY });
  });
}

function addRealizedSlide(pres, realizedByShare, totalRealizedPnl, currency) {
  if (!realizedByShare?.length) return;
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addText('Realized Gains', { x: 0.6, y: 0.55, w: 11, h: 0.6, fontFace: 'Cambria', fontSize: 32, bold: true, color: WHITE });
  s.addText('Closed positions', { x: 0.6, y: 1.15, w: 11, h: 0.4, fontFace: 'Calibri', fontSize: 14, color: ICE });

  s.addShape('roundRect', { x: 0.6, y: 1.9, w: 3.6, h: 1.4, rectRadius: 0.08, fill: { color: '273080' }, line: { type: 'none' } });
  s.addText('TOTAL REALIZED P&L', { x: 0.85, y: 2.1, w: 3.1, h: 0.3, fontFace: 'Calibri', fontSize: 10, bold: true, color: ICE, charSpacing: 1 });
  s.addText(fmtMoney(totalRealizedPnl, currency), { x: 0.85, y: 2.45, w: 3.1, h: 0.7, fontFace: 'Cambria', fontSize: 24, bold: true, color: WHITE });

  const rows = [['Ticker', 'Cost Basis', 'Proceeds', 'P&L', 'ROI']].concat(
    realizedByShare.slice(0, 8).map(r => [r.ticker, fmtMoney(r.cost_basis, r.currency), fmtMoney(r.proceeds, r.currency), fmtMoney(r.pnl, r.currency), pct(r.simple_roi)])
  );
  s.addTable(
    rows.map((r, ri) => r.map((cell, ci) => ({
      text: cell,
      options: {
        bold: ri === 0, fontFace: 'Calibri', fontSize: 12,
        color: ri === 0 ? NAVY : (ci === 3 ? (String(cell).startsWith('-') ? RED : GREEN) : NAVY),
        fill: { color: ri === 0 ? WHITE : (ri % 2 === 0 ? 'EFF3FA' : WHITE) },
        align: ci === 0 ? 'left' : 'right', valign: 'middle',
      },
    }))),
    { x: 0.6, y: 3.6, w: 12.1, colW: [2.2, 2.8, 2.8, 2.5, 1.8], rowH: 0.42, border: { type: 'none' } }
  );
}

function addClosingSlide(pres) {
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape('ellipse', { x: -2.5, y: -2.5, w: 6, h: 6, fill: { color: '273080' }, line: { type: 'none' } });
  s.addText('Thank You', { x: 0.9, y: 3.0, w: 8, h: 1, fontFace: 'Cambria', fontSize: 40, bold: true, color: WHITE });
  s.addText(`Portfolio data as of ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} · PortfolioIQ Tracker`, {
    x: 0.9, y: 3.85, w: 8, h: 0.4, fontFace: 'Calibri', fontSize: 14, color: ICE,
  });
}

/**
 * Generates and downloads a portfolio presentation from currently-loaded
 * Dashboard data. Adapts to however many currencies/platforms/holdings are
 * live — nothing here is hardcoded to today's specific portfolio.
 */
export async function exportPortfolioToPPTX({ summary, realized, byCurrency, realizedByCurrency, currencies, dominantCurrency }) {
  const { default: pptxgen } = await import('pptxgenjs');
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';

  const platformCount = new Set(summary.by_share.map(s => s.platform_name || 'Other')).size;
  addTitleSlide(pres, `${platformCount} platform${platformCount === 1 ? '' : 's'} · ${currencies.join(' & ')}`);

  const holdingCountsByCurrency = summary.by_share.reduce((acc, s) => {
    const c = s.currency || 'USD';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  addSummarySlide(pres, currencies, byCurrency, realizedByCurrency, holdingCountsByCurrency, summary.by_share.length);

  // One slide per platform, paginated if a platform has more holdings than fit on one table.
  const byPlatform = summary.by_share.reduce((acc, s) => {
    const p = s.platform_name || 'Other';
    (acc[p] = acc[p] || []).push(s);
    return acc;
  }, {});
  Object.entries(byPlatform).sort(([a], [b]) => a.localeCompare(b)).forEach(([platformName, shares]) => {
    const currency = shares[0]?.currency || dominantCurrency;
    for (let i = 0; i < shares.length; i += MAX_ROWS_PER_TABLE) {
      addPlatformSlides(pres, platformName, shares.slice(i, i + MAX_ROWS_PER_TABLE), currency, i / MAX_ROWS_PER_TABLE);
    }
  });

  addRiskSlide(pres, summary.by_risk, dominantCurrency);

  if (realized?.by_share?.length) {
    const realizedCurrency = realized.by_share[0]?.currency || dominantCurrency;
    addRealizedSlide(pres, realized.by_share, realized.total_realized_pnl, realizedCurrency);
  }

  addClosingSlide(pres);

  const filename = `Portfolio_Review_${new Date().toISOString().slice(0, 10)}.pptx`;
  await pres.writeFile({ fileName: filename });
}
