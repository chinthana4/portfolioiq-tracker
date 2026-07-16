import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const nav = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/transactions', label: 'Transactions', icon: '⊟' },
  { to: '/platforms', label: 'Platforms', icon: '⊞' },
  { to: '/risk', label: 'Risk Analysis', icon: '⚠' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{
        width: 220,
        background: 'var(--bg2)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0',
        flexShrink: 0,
      }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--primary)' }}>◈ PortfolioIQ</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{user?.name}</div>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                color: isActive ? 'var(--text)' : 'var(--text2)',
                background: isActive ? 'var(--bg3)' : 'transparent',
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
                marginBottom: 2,
                transition: 'all 0.1s',
              })}
            >
              <span style={{ fontSize: 16 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border)' }}>
          <button className="btn-ghost" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }} onClick={handleLogout}>
            <span>⏻</span> Sign Out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
        <Outlet />
      </main>
    </div>
  );
}
