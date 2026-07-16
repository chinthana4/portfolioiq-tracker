import React from 'react';

const CLASS = {
  'Low': 'badge-low',
  'Medium': 'badge-medium',
  'High': 'badge-high',
  'Very High': 'badge-veryhigh',
};

export default function RiskBadge({ level }) {
  return <span className={`badge ${CLASS[level] || ''}`}>{level}</span>;
}
