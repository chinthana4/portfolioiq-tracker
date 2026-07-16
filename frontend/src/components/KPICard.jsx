import React from 'react';

function fmt(n, prefix = '') {
  if (n === undefined || n === null) return '—';
  const abs = Math.abs(n);
  const str = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 2 }) : abs.toFixed(2);
  return `${n < 0 ? '-' : ''}${prefix}${str}`;
}

export default function KPICard({ label, value, prefix = '$', suffix = '', type = 'neutral', sub }) {
  const colour = type === 'positive' ? 'var(--green)' : type === 'negative' ? 'var(--red)' : 'var(--text)';
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: colour }}>
        {fmt(value, prefix)}{suffix}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{sub}</div>}
    </div>
  );
}
