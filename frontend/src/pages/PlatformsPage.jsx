import React, { useEffect, useState } from 'react';
import { platforms as platformApi } from '../services/api';

export default function PlatformsPage() {
  const [list, setList] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', currency: 'GBP' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => platformApi.list().then(setList).catch(setError);
  useEffect(() => { load(); }, []);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const openAdd = () => { setEditing(null); setForm({ name: '', description: '', currency: 'GBP' }); setShowForm(true); };
  const openEdit = p => { setEditing(p); setForm({ name: p.name, description: p.description || '', currency: p.currency }); setShowForm(true); };

  const submit = async e => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      if (editing) await platformApi.update(editing.id, form);
      else await platformApi.create(form);
      setShowForm(false); load();
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  };

  const remove = async id => {
    if (!confirm('Delete this platform and all its transactions?')) return;
    await platformApi.delete(id); load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Platforms</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>Manage your brokerage accounts</p>
        </div>
        <button className="btn-primary" onClick={openAdd}>+ Add Platform</button>
      </div>

      {error && <div style={{ color: 'var(--red)', padding: '10px 14px', background: '#ef444422', borderRadius: 8 }}>{String(error)}</div>}

      {list.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⊞</div>
          <div style={{ fontWeight: 600 }}>No platforms yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add your brokerage platforms (HSBC, Trading 212, Freetrade…)</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {list.map(p => (
            <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{p.currency}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(p)}>Edit</button>
                  <button className="btn-danger" onClick={() => remove(p.id)}>Delete</button>
                </div>
              </div>
              {p.description && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{p.description}</div>}
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
                Added {new Date(p.created_at).toLocaleDateString('en-GB')}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <h2>{editing ? 'Edit Platform' : 'Add Platform'}</h2>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label>Platform Name *</label>
                <input placeholder="e.g. HSBC InvestDirect" value={form.name} onChange={set('name')} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input placeholder="Optional notes" value={form.description} onChange={set('description')} />
              </div>
              <div className="form-group">
                <label>Base Currency</label>
                <select value={form.currency} onChange={set('currency')}>
                  <option>GBP</option><option>USD</option><option>EUR</option><option>CAD</option><option>AUD</option>
                </select>
              </div>
              {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{String(error)}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : editing ? 'Save Changes' : 'Create Platform'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
