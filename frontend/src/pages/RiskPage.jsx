import React, { useEffect, useState } from 'react';
import { transactions as txApi } from '../services/api';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend,
} from 'recharts';
import RiskBadge from '../components/RiskBadge';
import KPICard from '../components/KPICard';

const RISK_COLORS = { Low: '#4ade80', Medium: '#fbbf24', High: '#fb923c', 'Very High': '#f87171' };
const RISK_ORDER = ['Low', 'Medium', 'High', 'Very High'];

function fmt(n, p = '$') {
  if (!n && n !== 0) return '—';
  return `${n < 0 ? '-' : ''}${p}${Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}
function fmtPct(n) {
  if (n === undefined || n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function RiskPage() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    txApi.summary().then(setSummary).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>;
  if (!summary || summary.transaction_count === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Risk Analysis</h1>
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
          <div style={{ fontWeight: 600 }}>No data yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add transactions to see risk analytics.</div>
        </div>
      </div>
    );
  }

  const byRisk = RISK_ORDER.map(r => summary.by_risk.find(x => x.risk_level === r)).filter(Boolean);
  const totalValue = summary.total_value || 1;

  // Build platform risk exposure data
  const platformRiskData = summary.by_platform.map(p => ({ name: p.platform_name, value: p.current_value, pnl: p.pnl }));

  // High risk allocation %
  const highRiskValue = byRisk.filter(r => r.risk_level === 'High' || r.risk_level === 'Very High').reduce((s, r) => s + r.current_value, 0);
  const highRiskPct = (highRiskValue / totalValue) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Risk Analysis</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>Portfolio risk exposure and breakdown</p>
      </div>

      {/* Risk KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <KPICard label="High/Very High Exposure" value={highRiskPct} prefix="" suffix="%" type={highRiskPct > 50 ? 'negative' : highRiskPct > 30 ? 'neutral' : 'positive'} sub="of total portfolio value" />
        <KPICard label="Risk Categories" value={byRisk.length} prefix="" sub="active categories" />
        {byRisk.map(r => (
          <div key={r.risk_level} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <RiskBadge level={r.risk_level} />
            <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(r.current_value)}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              {((r.current_value / totalValue) * 100).toFixed(1)}% of portfolio
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Invested vs Value by risk */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 16 }}>Invested vs Current Value by Risk</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byRisk} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="risk_level" tick={{ fill: 'var(--text2)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text2)', fontSize: 11 }} tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
              <Tooltip formatter={v => fmt(v)} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="cost_basis" name="Invested" fill="var(--primary)" opacity={0.7} radius={[4, 4, 0, 0]} />
              <Bar dataKey="current_value" name="Current Value" radius={[4, 4, 0, 0]}>
                {byRisk.map(r => <Cell key={r.risk_level} fill={RISK_COLORS[r.risk_level]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* P&L by risk */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 16 }}>P&L by Risk Category</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byRisk} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="risk_level" tick={{ fill: 'var(--text2)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text2)', fontSize: 11 }} tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
              <Tooltip formatter={v => fmt(v)} contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }} />
              <Bar dataKey="pnl" name="P&L" radius={[4, 4, 0, 0]}>
                {byRisk.map(r => <Cell key={r.risk_level} fill={r.pnl >= 0 ? '#22c55e' : '#ef4444'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed risk table */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 16 }}>Detailed Risk Breakdown</div>
        <table>
          <thead>
            <tr>
              <th>Risk Level</th>
              <th>Invested</th>
              <th>Current Value</th>
              <th>P&L</th>
              <th>ROI</th>
              <th>Portfolio %</th>
              <th>Risk Score</th>
            </tr>
          </thead>
          <tbody>
            {byRisk.map(r => {
              const score = { Low: 1, Medium: 2, High: 3, 'Very High': 4 }[r.risk_level];
              const pct = ((r.current_value / totalValue) * 100).toFixed(1);
              return (
                <tr key={r.risk_level}>
                  <td><RiskBadge level={r.risk_level} /></td>
                  <td>{fmt(r.cost_basis)}</td>
                  <td>{fmt(r.current_value)}</td>
                  <td className={r.pnl >= 0 ? 'positive' : 'negative'}>{fmt(r.pnl)}</td>
                  <td className={r.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(r.simple_roi)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: RISK_COLORS[r.risk_level], borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text2)', minWidth: 36 }}>{pct}%</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} style={{
                          width: 10, height: 10, borderRadius: 2,
                          background: i <= score ? RISK_COLORS[r.risk_level] : 'var(--border)',
                        }} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Platform risk exposure */}
      {summary.by_platform.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 16 }}>Platform Exposure</div>
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Invested</th>
                <th>Value</th>
                <th>P&L</th>
                <th>ROI</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_platform.map(p => (
                <tr key={p.platform_id}>
                  <td style={{ fontWeight: 600 }}>{p.platform_name}</td>
                  <td>{fmt(p.cost_basis)}</td>
                  <td>{fmt(p.current_value)}</td>
                  <td className={p.pnl >= 0 ? 'positive' : 'negative'}>{fmt(p.pnl)}</td>
                  <td className={p.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(p.simple_roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
