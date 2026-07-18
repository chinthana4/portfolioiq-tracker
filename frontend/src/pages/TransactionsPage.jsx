import React, { useState, useCallback } from 'react';
import { transactions as txApi, platforms as platformApi, prices as priceApi, sales as salesApi } from '../services/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import RiskBadge from '../components/RiskBadge';

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Very High'];
const ASSET_TYPES = ['Stock', 'ETF', 'Mutual Fund', 'Bond'];
const EXCHANGES = [
  'LSE', 'NYSE', 'NASDAQ', 'TSX', 'ASX',
  'SET', 'MAI',
  'TH-MF',   // Thailand Mutual Funds
  'SGX', 'HKEX', 'TSE', 'KRX', 'SSE', 'SZSE',
  'XETRA', 'EURONEXT', 'NSE', 'BSE',
];

const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', THB: '฿', AUD: 'A$', CAD: 'C$', SGD: 'S$', HKD: 'HK$' };

function currSym(c) { return CURRENCY_SYMBOLS[c] || '$'; }

function fmt(n, p = '$') {
  if (n === undefined || n === null) return '—';
  return `${n < 0 ? '-' : ''}${p}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(n) {
  if (n === undefined || n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

// Same reasoning as the Dashboard: annualising a short holding compounds a single
// week/month's move into a misleading yearly figure, so suppress/flag it accordingly.
function AnnRoiCell({ annualisedRoi, holdingDays }) {
  if (holdingDays < 30) {
    return <td style={{ color: 'var(--text2)', fontSize: 12 }} title={`Only ${holdingDays}d held — too short to annualise`}>n/a (&lt;1mo)</td>;
  }
  const provisional = holdingDays < 180;
  return (
    <td
      className={annualisedRoi >= 0 ? 'positive' : 'negative'}
      style={provisional ? { opacity: 0.6, fontStyle: 'italic' } : undefined}
      title={provisional
        ? `Provisional — only ${holdingDays}d held, don't extrapolate to a full year`
        : `Based on ${holdingDays}d held`}
    >
      {fmtPct(annualisedRoi)}{provisional ? ' *' : ''}
    </td>
  );
}

const emptyForm = {
  asset_type: 'Stock',
  platform_id: '', share_name: '', ticker: '', exchange: 'NYSE',
  purchase_date: new Date().toISOString().slice(0, 10),
  purchase_price: '', units: '', risk_level: 'Medium',
  currency: 'USD', notes: '', manual_price: '', fund_house: '',
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
  const [sellTx, setSellTx] = useState(null);
  const [sellForm, setSellForm] = useState({ sale_date: new Date().toISOString().slice(0, 10), sale_price: '', units: '', notes: '' });
  const [sellError, setSellError] = useState('');
  const [selling, setSelling] = useState(false);

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
      asset_type: tx.asset_type || 'Stock',
      platform_id: tx.platform_id, share_name: tx.share_name, ticker: tx.ticker,
      exchange: tx.exchange, purchase_date: tx.purchase_date,
      purchase_price: tx.purchase_price, units: tx.units, risk_level: tx.risk_level,
      currency: tx.currency, notes: tx.notes || '', manual_price: tx.manual_price || '',
      fund_house: tx.fund_house || '',
    });
    setLivePrice(null); setShowForm(true);
  };

  // When asset type changes, auto-set sensible defaults for exchange/currency
  const onAssetTypeChange = e => {
    const at = e.target.value;
    setForm(f => ({
      ...f,
      asset_type: at,
      exchange: at === 'Mutual Fund' ? 'TH-MF' : (f.exchange === 'TH-MF' ? 'NYSE' : f.exchange),
      currency: at === 'Mutual Fund' ? 'THB' : (f.currency === 'THB' ? 'USD' : f.currency),
    }));
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

  const openSell = tx => {
    setSellTx(tx);
    setSellForm({
      sale_date: new Date().toISOString().slice(0, 10),
      sale_price: tx.current_price ? String(tx.current_price) : '',
      units: String(tx.remaining_units ?? tx.units),
      notes: '',
    });
    setSellError('');
  };

  const submitSell = async e => {
    e.preventDefault(); setSelling(true); setSellError('');
    try {
      await salesApi.create({
        ticker: sellTx.ticker,
        sale_date: sellForm.sale_date,
        sale_price: parseFloat(sellForm.sale_price),
        units: parseFloat(sellForm.units),
        notes: sellForm.notes,
      });
      setSellTx(null);
      loadAll();
    } catch (err) { setSellError(err); }
    finally { setSelling(false); }
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

      {loading ? (
        <div className="card"><div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div></div>
      ) : txs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>No transactions found.</div>
      ) : (
        Object.entries(
          txs.reduce((acc, tx) => {
            const p = tx.platform_name || 'Other';
            (acc[p] = acc[p] || []).push(tx);
            return acc;
          }, {})
        ).sort(([a], [b]) => a.localeCompare(b)).map(([platformName, platformTxs]) => (
          <div className="card" key={platformName} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 15 }}>
              {platformName}
              <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text2)', marginLeft: 10 }}>
                {platformTxs.length} lot{platformTxs.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Date</th>
                    <th>Buy Price</th>
                    <th>Units</th>
                    <th>Remaining</th>
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
                  {platformTxs.map(tx => {
                    const cs = currSym(tx.currency || 'USD');
                    const remaining = tx.remaining_units ?? tx.units;
                    const fullySold = remaining <= 0;
                    return (
                    <tr key={tx.id} style={fullySold ? { opacity: 0.5 } : undefined}>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{tx.ticker}</td>
                      <td>{tx.share_name}</td>
                      <td style={{ color: 'var(--text2)' }}>{new Date(tx.purchase_date).toLocaleDateString('en-GB')}</td>
                      <td>{fmt(tx.purchase_price, cs)}</td>
                      <td>{Number(tx.units) % 1 === 0 ? Number(tx.units) : Number(tx.units).toFixed(2)}</td>
                      <td style={fullySold ? { color: 'var(--text2)' } : undefined}>{Number(remaining) % 1 === 0 ? Number(remaining) : Number(remaining).toFixed(2)}{fullySold ? ' (sold)' : ''}</td>
                      <td>{fmt(tx.cost_basis, cs)}</td>
                      <td>{fmt(tx.current_price, cs)}</td>
                      <td>{fmt(tx.current_value, cs)}</td>
                      <td className={tx.pnl >= 0 ? 'positive' : 'negative'}>{fmt(tx.pnl, cs)}</td>
                      <td className={tx.simple_roi >= 0 ? 'positive' : 'negative'}>{fmtPct(tx.simple_roi)}</td>
                      <AnnRoiCell annualisedRoi={tx.annualised_roi} holdingDays={tx.holding_days} />
                      <td><RiskBadge level={tx.risk_level} /></td>
                      <td style={{ color: 'var(--text2)' }}>{tx.holding_days}d</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {!fullySold && (
                            <button className="btn-ghost" style={{ padding: '3px 8px', fontSize: 11, color: 'var(--green)', borderColor: 'var(--green)' }} onClick={() => openSell(tx)}>Sell</button>
                          )}
                          <button className="btn-ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => openEdit(tx)}>Edit</button>
                          <button className="btn-danger" onClick={() => remove(tx.id)}>✕</button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <h2>{editing ? 'Edit Transaction' : 'Add Transaction'}</h2>

            {/* Asset type banner for mutual funds */}
            {form.asset_type === 'Mutual Fund' && (
              <div style={{ background: '#6d28ff11', border: '1px solid #6d28ff', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#5b1fe0' }}>
                <strong>Thai Mutual Fund</strong> — NAV is fetched daily from SEC Thailand. Use fund code as Ticker (e.g. KFLTFDIV-A). If NAV fetch fails, enter manually.
              </div>
            )}

            <form onSubmit={submit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Asset Type *</label>
                  <select value={form.asset_type} onChange={onAssetTypeChange} required>
                    {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
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
                  <label>{form.asset_type === 'Mutual Fund' ? 'Fund Name *' : 'Share Name *'}</label>
                  <input placeholder={form.asset_type === 'Mutual Fund' ? 'Krungsri LTF Dividend' : 'Apple Inc.'} value={form.share_name} onChange={set('share_name')} required />
                </div>
                <div className="form-group">
                  <label>{form.asset_type === 'Mutual Fund' ? 'Fund Code *' : 'Ticker *'}</label>
                  <input placeholder={form.asset_type === 'Mutual Fund' ? 'KFLTFDIV-A' : 'AAPL'} value={form.ticker} onChange={set('ticker')} required style={{ textTransform: 'uppercase' }} />
                </div>
                {form.asset_type === 'Mutual Fund' && (
                  <div className="form-group">
                    <label>Fund House</label>
                    <input placeholder="e.g. Kasikorn, SCB, Bangkok Bank" value={form.fund_house} onChange={set('fund_house')} />
                  </div>
                )}
                {form.asset_type !== 'Mutual Fund' && (
                  <div className="form-group">
                    <label>Exchange *</label>
                    <select value={form.exchange} onChange={set('exchange')} required>
                      {EXCHANGES.filter(e => e !== 'TH-MF').map(e => <option key={e}>{e}</option>)}
                    </select>
                  </div>
                )}
                <div className="form-group">
                  <label>Currency</label>
                  <select value={form.currency} onChange={set('currency')}>
                    <option>USD</option><option>THB</option><option>GBP</option><option>EUR</option>
                    <option>SGD</option><option>HKD</option><option>AUD</option><option>CAD</option>
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
                    Live: {livePrice.currency} {livePrice.price?.toFixed(2)} {livePrice.stale ? '(cached)' : ''}
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

      {sellTx && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSellTx(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <h2>Sell {sellTx.ticker}</h2>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
              Selling deducts units FIFO — oldest purchase lots for this ticker are sold first.
              You currently hold <strong>{sellTx.remaining_units ?? sellTx.units}</strong> units across all lots.
            </p>
            <form onSubmit={submitSell}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Sale Date *</label>
                  <input type="date" value={sellForm.sale_date} onChange={e => setSellForm(f => ({ ...f, sale_date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Sale Price *</label>
                  <input type="number" step="0.0001" min="0" value={sellForm.sale_price} onChange={e => setSellForm(f => ({ ...f, sale_price: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Units to Sell *</label>
                  <input type="number" step="0.0001" min="0" max={sellTx.remaining_units ?? sellTx.units} value={sellForm.units} onChange={e => setSellForm(f => ({ ...f, units: e.target.value }))} required />
                </div>
                <div className="form-group full">
                  <label>Notes</label>
                  <input placeholder="Optional notes" value={sellForm.notes} onChange={e => setSellForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              {sellError && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{String(sellError)}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button type="button" className="btn-ghost" onClick={() => setSellTx(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={selling}>
                  {selling ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Confirm Sale'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
