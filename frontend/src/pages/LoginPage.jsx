import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.email, form.password, form.name);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, color: 'var(--primary)', marginBottom: 8 }}>◈</div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>PortfolioIQ</h1>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Investment Analytics Platform</p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            {['login', 'register'].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); }}
                style={{
                  flex: 1, padding: '8px', borderRadius: 8, border: 'none',
                  background: mode === m ? 'var(--primary)' : 'var(--bg3)',
                  color: mode === m ? 'white' : 'var(--text2)',
                  fontWeight: mode === m ? 600 : 400, cursor: 'pointer',
                  textTransform: 'capitalize',
                }}>
                {m}
              </button>
            ))}
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'register' && (
              <div className="form-group">
                <label>Full Name</label>
                <input placeholder="John Smith" value={form.name} onChange={set('name')} required />
              </div>
            )}
            <div className="form-group">
              <label>Email</label>
              <input type="email" placeholder="you@example.com" value={form.email} onChange={set('email')} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" placeholder="••••••••" value={form.password} onChange={set('password')} required minLength={6} />
            </div>
            {error && <div style={{ color: 'var(--red)', fontSize: 13, padding: '8px 12px', background: '#ef444422', borderRadius: 8 }}>{error}</div>}
            <button className="btn-primary" type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
