import React, { useState, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { transactions as txApi, prices as priceApi } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import KPICard from '../components/KPICard';
import RiskBadge from '../components/RiskBadge';

const RISK_COLORS = { Low: '#4ade80', Medium: '#fbbf24', High: '#fb923c', 'Very High': '#f87171' };
const REFRESH_MS = 60_000;
const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', THB: '฿', AUD: 'A$', CAD: 'C$', SGD: 'S$', HKD: 'HK$' };

function sym(currency) {
  return CURRENCY_SYMBOLS[currency] || (currency ? currency + ' ' : '$');
}

function fmt(n, currency = 'USD') {
  if (n === null || n === undefined) return '—';
  const s = sym(currency);
  return `${n < 0 ? '-' : ''}${s}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n === undefined || n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function NavUpdateModal({ onClose, onSaved }) {
  const [funds, setFunds] = useState([]);
  const [navInputs, setNavInputs] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  React.useEffect(() => {
    priceApi.thaiMF().then(rows => {
      setFunds(rows);
      const init = {};
      rows.forEach(r => { init[r.ticker] = r.current_nav ? String(parseFloat(r.current_nav).toFixed(4)) : ''; });
      setNavInputs(init);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    const updates = funds.map(f => ({
      ticker: f.ticker, exchange: f.exchange, currency: f.currency || 'THB',
      price: parseFloat(navInputs[f.ticker]),
    })).filter(u => u.price > 0 && !isNaN(u.price));
    try {
      const res = await priceApi.bulkNav(updates);
      setSavedMsg(`Updated ${res.updated} fund NAVs`);
      setTimeout(() => { onSaved(); onClose(); }, 1200);
    } catch { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <h2 style={{ marginBottom: 4 }}>Update Thai Mutual Fund NAV</h2>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
          Enter today's NAV (฿ per unit) for each fund. Find latest NAV at{' '}
          <a href="https://www.kasikornasset.com/en/mutual-fund/pages/fund-nav.aspx" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>kasikornasset.com</a> or{' '}
          <a href="https://www.scbam.com/en/fund-price" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>scbam.com</a>.
        </p>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><div className="spinner" /></div>
        ) : funds.length === 0 ? (
          <div style={{ color: 'var(--text2)', textAlign: 'center', padding: 24 }}>No Thai mutual funds found in your portfolio.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Fund Code</th><th>Fund Name</th><th>Last NAV (฿)</th><th>New NAV (฿)</th></tr>
            </thead>
            <tbody>
              {funds.map(f => (
                <tr key={f.ticker}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{f.ticker}</td>
                  <td style={{ fontSize: 12, maxWidth: 160 }}>{f.share_name}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>
                    {f.current_nav ? `฿${parseFloat(f.current_nav).toFixed(4)}` : '—'}
                    {f.nav_updated_at && <span style={{ display: 'block', fontSize: 10, color: 'var(--text2)' }}>{new Date(f.nav_updated_at).toLocaleDateString('en-GB')}</span>}
                  </td>
                  <td>
                    <input
                      type="number" step="0.0001" min="0"
                      style={{ width: 100 }}
                      placeholder="0.0000"
                      value={navInputs[f.ticker] || ''}
                      onChange={e => setNavInputs(n => ({ ...n, [f.ticker]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {savedMsg && <div style={{ color: 'var(--green)', marginTop: 12, fontSize: 13 }}>{savedMsg}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || loading || funds.length === 0}>
            {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save NAVs'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');
  const [showNavModal, setShowNavModal] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await txApi.summary();
      setSummary(data);
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const secondsLeft = useAutoRefresh(fetchSummary, REFRESH_MS);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>;
  if (error) return <div style={{ color: 'var(--red)', padding: 20 }}>{error}</div>;

  const roiType = !summary ? 'neutral' : summary.overall_roi >= 0 ? 'positive' : 'negative';

  // Group totals by currency so mixed portfolios show correct symbols
  const byCurrency = (() => {
    if (!summary?.by_share?.length) return {};
    const map = {};
    for (const s of summary.by_share) {
      const c = s.currency || 'USD';
      if (!map[c]) map[c] = { invested: 0, value: 0, pnl: 0 };
      map[c].invested += s.cost_basis;
      map[c].value    += s.current_value;
      map[c].pnl      += s.pnl;
    }
    return map;
  })();
  const currencies = Object.keys(byCurrency);
  // dominant for charts (most value)
  const dominantCurrency = currencies.sort((a, b) => byCurrency[b].value - byCurrency[a].value)[0] || 'USD';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Dashboard</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>Live portfolio overview</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setShowNavModal(true)}>
            ฿ Update Thai NAV
          </button>
          {lastUpdated && (
            <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'right', lineHeight: 1.6 }}>
              <div>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', marginRight: 5, verticalAlign: 'middle' }} />
                Auto-refresh · next in {secondsLeft}s
              </div>
              <div>Last updated: {lastUpdated.toLocaleTimeString()}</div>
            </div>
          )}
        </div>
      </div>

      {showNavModal && <NavUpdateModal onClose={() => setShowNavModal(false)} onSaved={fetchSummary} />}

      {!summary || summary.transaction_count === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No investments yet</div>
          <div style={{ fontSize: 13 }}>Add platforms and transactions to start tracking.</div>
        </div>
      ) : (
        <>
          {/* KPI Cards — one row per currency so ฿ and $ never mix */}
          {currencies.map(c => {
            const g = byCurrency[c];
            const pnlT = g.pnl >= 0 ? 'positive' : 'negative';
            return (
              <div key={c} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                <KPICard label={`Invested (${c})`}      value={g.invested} prefix={sym(c)} />
                <KPICard label={`Current Value (${c})`} value={g.value}    prefix={sym(c)} />
                <KPICard label={`P&L (${c})`}           value={g.pnl}      prefix={sym(c)} type={pnlT} />
                <KPICard label="Overall ROI"            value={summary.overall_roi} prefix="" suffix="%" type={roiType} />
                <KPICard label="Positions"              value={summary.transaction_count} prefix="" sub="individual lots" />
              </div>
            );
          })}

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 16 }}>Allocation by Risk</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={summary.by_risk} dataKey="current_value" nameKey="risk_level" cx="50%" cy="50%" outerRadius={80}
                    label={({ risk_level, percent }) => `${risk_level} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {summary.by_risk.map(r => <Cell key={r.risk_level} fill={RISK_COLORS[r.risk_level] || '#94a3b8'} />)}
                  </Pie>
                  <Tooltip formatter={v => fmt(v, dominantCurrency)} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 16 }}>P&L by Platform</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={summary.by_platform}>
                  <XAxis dataKey="platform_name" tick={{ fill: 'var(--text2)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--text2)', fontSize: 11 }}
                    tickFormatter={v => `${sym(dominantCurrency)}${Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'k' : v.toFixed(0)}`} />
                  <Tooltip formatter={v => fmt(v, dominantCurrency)} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey="pnl" name="P&L" radius={[4,4,0,0]}>
                    {summary.by_platform.map(p => <Cell key={p.platform_id} fill={p.pnl >= 0 ? 'var(--green)' : 'var(--red)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Risk breakdown */}
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 16 }}>Risk Category Breakdown</div>
            <table>
              <thead>
                <tr><th>Risk Level</th><th>Invested</th><th>Current Value</th><th>P&L</th><th>ROI</th></tr>
              </thead>
              <tbody>
                {['Low','Medium','High','Very High'].map(risk => {
                  const r = summary.by_risk.find(x => x.risk_level === risk);
                  if (!r) return null;
                  return (
                    <tr key={risk}>
                      <td><RiskBadge level={risk} /></td>
                      <td>{fmt(r.cost_basis, dominantCurrency)}</td>
                      <td>{fmt(r.current_value, dominantCurrency)}</td>
                      <td className={r.pnl >= 0 ? 'positive' : 'negative'}>{fmt(r.pnl, dominantCurrency)}</td>
                      <td className={r.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(r.simple_roi)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Holdings — each row shows its own currency */}
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 16 }}>Holdings</div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Type</th><th>Ticker</th><th>Name</th><th>Ccy</th><th>Units</th><th>Bought At</th><th>Live Price</th><th>Invested</th><th>Value</th><th>P&L</th><th>ROI</th><th>Risk</th></tr>
                </thead>
                <tbody>
                  {summary.by_share.sort((a,b) => b.current_value - a.current_value).map(s => {
                    const c = s.currency || 'USD';
                    const units = Number(s.units);
                    return (
                      <tr key={s.ticker}>
                        <td style={{ fontSize: 11, color: 'var(--text2)' }}>{s.asset_type || 'Stock'}</td>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{s.ticker}</td>
                        <td>{s.share_name}</td>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--primary)' }}>{sym(c)}{c}</span>
                        </td>
                        <td>{units.toFixed(units % 1 === 0 ? 0 : 4)}</td>
                        <td>{fmt(s.cost_basis / units, c)}</td>
                        <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{fmt(s.current_value / units, c)}</td>
                        <td>{fmt(s.cost_basis, c)}</td>
                        <td>{fmt(s.current_value, c)}</td>
                        <td className={s.pnl >= 0 ? 'positive' : 'negative'}>{fmt(s.pnl, c)}</td>
                        <td className={s.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(s.simple_roi)}</td>
                        <td><RiskBadge level={s.risk_level} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
