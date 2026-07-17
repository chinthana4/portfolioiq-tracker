import React, { useState, useEffect } from 'react';
import { returns as returnsApi } from '../services/api';

const WINDOW_LABELS = { '1M': '1M', '3M': '3M', '6M': '6M', 'YTD': 'YTD', '12M': '12M', 'SINCE_PURCHASE': 'Since Purchase' };
const WINDOW_ORDER = ['1M', '3M', '6M', 'YTD', '12M', 'SINCE_PURCHASE'];

function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  if (typeof n === 'string') return n; // 'n/a (<1yr)'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

function WindowCell({ w, onExpand, expanded }) {
  if (w.status !== 'ok') {
    return <td style={{ color: 'var(--text2)', fontSize: 12 }}>insufficient history</td>;
  }
  return (
    <td>
      <button
        className="btn-ghost"
        style={{ padding: '2px 8px', fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, border: 'none' }}
        onClick={onExpand}
      >
        <span className={w.cumulative >= 0 ? 'positive' : 'negative'} style={{ fontWeight: 600 }}>{fmtPct(w.cumulative)}</span>
        <span style={{ fontSize: 10, color: 'var(--text2)' }}>{expanded ? '▲ hide months' : '▼ months'}</span>
      </button>
    </td>
  );
}

function MonthDetailRow({ w, colSpan }) {
  if (w.status !== 'ok') return null;
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: 'var(--bg3)', padding: '10px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12 }}>
          <div>
            <div style={{ color: 'var(--text2)', marginBottom: 4 }}>Monthly returns</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {w.months.map(m => (
                <span key={m.month} style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
                  {m.month}: <span className={m.r >= 0 ? 'positive' : 'negative'}>{fmtPct(m.r)}</span>{m.partial ? ' (partial)' : ''}
                </span>
              ))}
            </div>
          </div>
          <div><span style={{ color: 'var(--text2)' }}>Avg monthly:</span> <strong className={w.avg_monthly_return >= 0 ? 'positive' : 'negative'}>{fmtPct(w.avg_monthly_return)}</strong></div>
          <div><span style={{ color: 'var(--text2)' }}>Best:</span> <strong className="positive">{w.best_month.month} {fmtPct(w.best_month.r)}</strong></div>
          <div><span style={{ color: 'var(--text2)' }}>Worst:</span> <strong className="negative">{w.worst_month.month} {fmtPct(w.worst_month.r)}</strong></div>
          <div><span style={{ color: 'var(--text2)' }}>Annualised:</span> <strong>{fmtPct(w.annualised)}</strong></div>
        </div>
      </td>
    </tr>
  );
}

export default function MonthlyReturnsPage() {
  const [holdings, setHoldings] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({}); // key: `${rowKey}:${window}` -> bool

  useEffect(() => {
    Promise.all([returnsApi.holdings(), returnsApi.portfolio()])
      .then(([h, p]) => { setHoldings(h); setPortfolio(p); })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = key => setExpanded(e => ({ ...e, [key]: !e[key] }));

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>;
  if (error) return <div style={{ color: 'var(--red)', padding: 20 }}>{error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Monthly Returns</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>
          Returns built from locked month-end prices. A window only shows a figure once every month inside it has
          a locked price — otherwise it reads "insufficient history". Month-end prices lock going forward from
          when this feature was enabled; history from before that can't be reconstructed.
        </p>
      </div>

      {/* Portfolio-level Modified Dietz */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
          <div style={{ fontWeight: 600 }}>Portfolio (Modified Dietz)</div>
          {portfolio?.recent_capital_warning && (
            <span style={{ fontSize: 12, color: 'var(--yellow)' }}>⚠ unstable — most capital deposited in the last 30 days</span>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>{WINDOW_ORDER.map(w => <th key={w}>{WINDOW_LABELS[w]}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                {WINDOW_ORDER.map(w => {
                  const win = portfolio?.windows?.[w];
                  const key = `portfolio:${w}`;
                  return win ? <WindowCell key={w} w={win} expanded={expanded[key]} onExpand={() => toggle(key)} /> : <td key={w}>—</td>;
                })}
              </tr>
              {WINDOW_ORDER.map(w => {
                const win = portfolio?.windows?.[w];
                const key = `portfolio:${w}`;
                return expanded[key] && win ? <MonthDetailRow key={w} w={win} colSpan={WINDOW_ORDER.length} /> : null;
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-holding */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 16 }}>By Holding</div>
        {holdings.length === 0 ? (
          <div style={{ color: 'var(--text2)', textAlign: 'center', padding: 24 }}>No holdings yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  {WINDOW_ORDER.map(w => <th key={w}>{WINDOW_LABELS[w]}</th>)}
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => {
                  const rowKey = `${h.ticker}:${h.exchange}`;
                  return (
                    <React.Fragment key={rowKey}>
                      <tr>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{h.ticker}</td>
                        <td>{h.share_name}</td>
                        {WINDOW_ORDER.map(w => {
                          const win = h.windows[w];
                          const key = `${rowKey}:${w}`;
                          return <WindowCell key={w} w={win} expanded={expanded[key]} onExpand={() => toggle(key)} />;
                        })}
                      </tr>
                      {WINDOW_ORDER.map(w => {
                        const win = h.windows[w];
                        const key = `${rowKey}:${w}`;
                        return expanded[key] ? <MonthDetailRow key={w} w={win} colSpan={WINDOW_ORDER.length + 2} /> : null;
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
