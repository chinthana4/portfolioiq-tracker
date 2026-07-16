import React, { useState, useCallback } from 'react';
import { transactions as txApi, platforms as platformApi, prices as priceApi } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import RiskBadge from '../components/RiskBadge';

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Very High'];
const EXCHANGES = [
  'LSE', 'NYSE', 'NASDAQ', 'TSX', 'ASX',
  'SET', 'MAI',           // Thailand
  'SGX',                  // Singapore
  'HKEX',                 // Hong Kong
  'TSE',                  // Tokyo
  'KRX',                  // South Korea
  'SSE', 'SZSE',          // China
  'XETRA', 'EURONEXT',
  'NSE', 'BSE',
];

function fmt(n, p = '£') {
  if (n === undefined || n === null) return '—';
  return `${n < 0 ? '-' : ''}${p}${Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}
function fmtPct(n) {
  if (n === undefined || n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const emptyForm = {
  platform_id: '', share_name: '', ticker: '', exchange: 'LSE',
  purchase_date: new Date().toISOString().slice(0, 10),
  purchase_price: '', units: '', risk_level: 'Medium',
  currency: 'GBP', notes: '', manual_price: '',
};

export default function TransactionsPage() {
  const [txs, setTxs] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({ platform_id: '', risk_level: '', ticker: '' });
  const [livePrice, setLivePrice] = useState(null);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      txApi.list(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))),
      platformApi.list(),
    ]).then(([t, p]) => { setTxs(t); setPlatforms(p); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [filters]);

  useAutoRefresh(loadAll, 60_000);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setFilter = k => e => setFilters(f => ({ ...f, [k]: e.target.value }));

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, platform_id: platforms[0]?.id || '' });
    setLivePrice(null); setShowForm(true);
  };
  const openEdit = tx => {
    setEditing(tx);
    setForm({
      platform_id: tx.platform_id, share_name: tx.share_name, ticker: tx.ticker,
      exchange: tx.exchange, purchase_date: tx.purchase_date,
      purchase_price: tx.purchase_price, units: tx.units, risk_level: tx.risk_level,
      currency: tx.currency, notes: tx.notes || '', manual_price: tx.manual_price || '',
    });
    setLivePrice(null); setShowForm(true);
  };

  const fetchPrice = async () => {
    if (!form.ticker || !form.exchange) return;
    setFetchingPrice(true); setLivePrice(null);
    try {
      const data = await priceApi.live(form.ticker, form.exchange);
      setLivePrice(data);
    } catch { setLivePrice({ error: true }); }
    finally { setFetchingPrice(false); }
  };

  const submit = async e => {
    e.preventDefault(); setSaving(true); setError('');
    const payload = {
      ...form,
      purchase_price: parseFloat(form.purchase_price),
      units: parseFloat(form.units),
      manual_price: form.manual_price ? parseFloat(form.manual_price) : null,
    };
    try {
      if (editing) await txApi.update(editing.id, payload);
      else await txApi.create(payload);
      setShowForm(false); loadAll();
    } catch (err) { setError(err); }
    finally { setSaving(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this transaction?')) return;
    await txApi.delete(id); loadAll();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Transactions</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>All purchase lots with live pricing</p>
        </div>
        <button className="btn-primary" onClick={openAdd}>+ Add Transaction</button>
      </div>

      {/* Filters */}
      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '14px 16px' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label>Platform</label>
          <select value={filters.platform_id} onChange={setFilter('platform_id')}>
            <option value="">All platforms</option>
            {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label>Risk Level</label>
          <select value={filters.risk_level} onChange={setFilter('risk_level')}>
            <option value="">All risk levels</option>
            {RISK_LEVELS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label>Ticker</label>
          <input placeholder="e.g. AAPL" value={filters.ticker} onChange={setFilter('ticker')} />
        </div>
      </div>

      {error && <div style={{ color: 'var(--red)', padding: '10px 14px', background: '#ef444422', borderRadius: 8 }}>{String(error)}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
        ) : txs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>No transactions found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Platform</th>
                  <th>Date</th>
                  <th>Buy Price</th>
                  <th>Units</th>
                  <th>Cost Basis</th>
                  <th>Curr. Price</th>
                  <th>Value</th>
                  <th>P&L</th>
                  <th>ROI</th>
                  <th>Ann. ROI</th>
                  <th>Risk</th>
                  <th>Days</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {txs.map(tx => (
                  <tr key={tx.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{tx.ticker}</td>
                    <td>{tx.share_name}</td>
                    <td style={{ color: 'var(--text2)' }}>{tx.platform_name}</td>
                    <td style={{ color: 'var(--text2)' }}>{new Date(tx.purchase_date).toLocaleDateString('en-GB')}</td>
                    <td>{fmt(tx.purchase_price)}</td>
                    <td>{tx.units}</td>
                    <td>{fmt(tx.cost_basis)}</td>
                    <td>{fmt(tx.current_price)}</td>
                    <td>{fmt(tx.current_value)}</td>
                    <td className={tx.pnl >= 0 ? 'positive' : 'negative'}>{fmt(tx.pnl)}</td>
                    <td className={tx.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(tx.simple_roi)}</td>
                    <td className={tx.annualised_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(tx.annualised_roi)}</td>
                    <td><RiskBadge level={tx.risk_level} /></td>
                    <td style={{ color: 'var(--text2)' }}>{tx.holding_days}d</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => openEdit(tx)}>Edit</button>
                        <button className="btn-danger" onClick={() => remove(tx.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <h2>{editing ? 'Edit Transaction' : 'Add Transaction'}</h2>
            <form onSubmit={submit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Platform *</label>
                  <select value={form.platform_id} onChange={set('platform_id')} required>
                    <option value="">Select platform</option>
                    {platforms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Risk Level *</label>
                  <select value={form.risk_level} onChange={set('risk_level')} required>
                    {RISK_LEVELS.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Share Name *</label>
                  <input placeholder="Apple Inc." value={form.share_name} onChange={set('share_name')} required />
                </div>
                <div className="form-group">
                  <label>Ticker *</label>
                  <input placeholder="AAPL" value={form.ticker} onChange={set('ticker')} required style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="form-group">
                  <label>Exchange *</label>
                  <select value={form.exchange} onChange={set('exchange')} required>
                    {EXCHANGES.map(e => <option key={e}>{e}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <select value={form.currency} onChange={set('currency')}>
                    <option>GBP</option><option>USD</option><option>EUR</option><option>CAD</option><option>AUD</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Purchase Date *</label>
                  <input type="date" value={form.purchase_date} onChange={set('purchase_date')} required />
                </div>
                <div className="form-group">
                  <label>Purchase Price *</label>
                  <input type="number" step="0.0001" min="0" placeholder="0.00" value={form.purchase_price} onChange={set('purchase_price')} required />
                </div>
                <div className="form-group">
                  <label>Units *</label>
                  <input type="number" step="0.0001" min="0" placeholder="0" value={form.units} onChange={set('units')} required />
                </div>
                <div className="form-group">
                  <label>Manual Price Override</label>
                  <input type="number" step="0.0001" min="0" placeholder="Leave blank to use live price" value={form.manual_price} onChange={set('manual_price')} />
                </div>
                <div className="form-group full">
                  <label>Notes</label>
                  <input placeholder="Optional notes" value={form.notes} onChange={set('notes')} />
                </div>
              </div>

              {/* Live price fetcher */}
              <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg3)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={fetchPrice} disabled={fetchingPrice || !form.ticker}>
                  {fetchingPrice ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻ Fetch Live Price'}
                </button>
                {livePrice && !livePrice.error && (
                  <span style={{ fontSize: 13, color: 'var(--green)' }}>
                    Live: {livePrice.currency} {livePrice.price?.toFixed(4)} {livePrice.stale ? '(cached)' : ''}
                  </span>
                )}
                {livePrice?.error && <span style={{ fontSize: 13, color: 'var(--red)' }}>Price unavailable — use manual override</span>}
              </div>

              {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{String(error)}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : editing ? 'Save Changes' : 'Add Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
