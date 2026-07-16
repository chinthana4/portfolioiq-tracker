import React, { useState, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { transactions as txApi } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import KPICard from '../components/KPICard';
import RiskBadge from '../components/RiskBadge';

const RISK_COLORS = { Low: '#4ade80', Medium: '#fbbf24', High: '#fb923c', 'Very High': '#f87171' };
const REFRESH_MS = 60_000;

function currencySymbol(c) {
  return { USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$' }[c] || '$';
}

function fmt(n, symbol = '$') {
  if (!n && n !== 0) return '—';
  return `${n < 0 ? '-' : ''}${symbol}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n === undefined || n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState('');

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

  const pnlType = !summary ? 'neutral' : summary.total_pnl >= 0 ? 'positive' : 'negative';
  const roiType = !summary ? 'neutral' : summary.overall_roi >= 0 ? 'positive' : 'negative';

  // Detect dominant currency from transactions
  const sym = '$';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Dashboard</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>Live portfolio overview</p>
        </div>
        {lastUpdated && (
          <div style={{ fontSize: 11, color: 'var(--text2)', textAlign: 'right', lineHeight: 1.6 }}>
            <div>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', marginRight: 5, verticalAlign: 'middle' }} />
              Live prices · refreshes in {secondsLeft}s
            </div>
            <div style={{ color: 'var(--text2)' }}>Last updated: {lastUpdated.toLocaleTimeString()}</div>
          </div>
        )}
      </div>

      {!summary || summary.transaction_count === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◈</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No investments yet</div>
          <div style={{ fontSize: 13 }}>Add platforms and transactions to start tracking.</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <KPICard label="Total Invested"  value={summary.total_invested}     prefix={sym} />
            <KPICard label="Current Value"   value={summary.total_value}        prefix={sym} />
            <KPICard label="Total P&L"       value={summary.total_pnl}          prefix={sym} type={pnlType} />
            <KPICard label="Overall ROI"     value={summary.overall_roi}        prefix=""    suffix="%" type={roiType} />
            <KPICard label="Positions"       value={summary.transaction_count}  prefix=""    sub="individual lots" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 16 }}>Allocation by Risk</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={summary.by_risk} dataKey="current_value" nameKey="risk_level" cx="50%" cy="50%" outerRadius={80}
                    label={({ risk_level, percent }) => `${risk_level} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {summary.by_risk.map(r => <Cell key={r.risk_level} fill={RISK_COLORS[r.risk_level] || '#94a3b8'} />)}
                  </Pie>
                  <Tooltip formatter={v => fmt(v, sym)} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 16 }}>P&L by Platform</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={summary.by_platform}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="platform_name" tick={{ fill: 'var(--text2)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--text2)', fontSize: 11 }} tickFormatter={v => `${sym}${Math.abs(v) >= 1000 ? (v/1000).toFixed(0)+'k' : v.toFixed(0)}`} />
                  <Tooltip formatter={v => fmt(v, sym)} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }} />
                  <Bar dataKey="pnl" name="P&L" radius={[4,4,0,0]}>
                    {summary.by_platform.map(p => <Cell key={p.platform_id} fill={p.pnl >= 0 ? 'var(--green)' : 'var(--red)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

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
                      <td>{fmt(r.cost_basis, sym)}</td>
                      <td>{fmt(r.current_value, sym)}</td>
                      <td className={r.pnl >= 0 ? 'positive' : 'negative'}>{fmt(r.pnl, sym)}</td>
                      <td className={r.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(r.simple_roi)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 16 }}>Holdings</div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Ticker</th><th>Name</th><th>Units</th><th>Bought At</th><th>Live Price</th><th>Invested</th><th>Value</th><th>P&L</th><th>ROI</th><th>Risk</th></tr>
                </thead>
                <tbody>
                  {summary.by_share.sort((a,b) => b.current_value - a.current_value).map(s => (
                    <tr key={s.ticker}>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{s.ticker}</td>
                      <td>{s.share_name}</td>
                      <td>{Number(s.units).toFixed(s.units % 1 === 0 ? 0 : 4)}</td>
                      <td>{fmt(s.cost_basis / s.units, sym)}</td>
                      <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{fmt(s.current_value / s.units, sym)}</td>
                      <td>{fmt(s.cost_basis, sym)}</td>
                      <td>{fmt(s.current_value, sym)}</td>
                      <td className={s.pnl >= 0 ? 'positive' : 'negative'}>{fmt(s.pnl, sym)}</td>
                      <td className={s.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(s.simple_roi)}</td>
                      <td><RiskBadge level={s.risk_level} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
