import React, { useState } from 'react';

// Shared interaction layer keeps all financial charts consistent. The larger,
// invisible targets make small dots easier to inspect with a mouse or touch.
export default function ChartHoverLayer({ rows, series, x, y, format, onSelect }) {
 const [point, setPoint] = useState(null);
 const row = point ? rows[point.index] : null;
 const monthLabel = month => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
 const show = (index, key) => { setPoint({ index, key }); onSelect(index); };
 const width = 238, height = 34 + series.length * 20;
 const left = point ? Math.max(4, Math.min(756 - width, x(point.index) - width / 2)) : 0;
 const anchorY = row ? y(row[point.key]) : 0;
 const top = anchorY >= height + 12 ? anchorY - height - 12 : Math.min(222 - height, anchorY + 12);
 return <g className="fin-chart-interaction">
  {series.flatMap(s => rows.map((r, index) => Number.isFinite(r[s.key]) ? <circle
   key={`${s.key}:${r.month}`} cx={x(index)} cy={y(r[s.key])} r="11"
   fill="transparent" className="fin-chart-hit" tabIndex="0" role="button"
   aria-label={`${monthLabel(r.month)} · ${s.label}: ${format(r[s.key])}`}
   onPointerEnter={() => show(index, s.key)} onPointerLeave={() => setPoint(null)}
   onFocus={() => show(index, s.key)} onBlur={() => setPoint(null)}
   onClick={() => show(index, s.key)}
   onKeyDown={e => { if (e.key === 'Escape') setPoint(null); else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(index, s.key); } }}
  /> : null))}
  {row && <g className="fin-chart-tooltip" role="tooltip" pointerEvents="none" transform={`translate(${left},${top})`}>
   <rect width={width} height={height} rx="7" fill="#202b40"/>
   <text x="12" y="21" fill="white" fontSize="12" fontWeight="600">{monthLabel(row.month)}</text>
   {series.map((s, index) => <g key={s.key}>
    <circle cx="14" cy={40 + index * 20} r="3" fill={s.color}/>
    <text x="24" y={44 + index * 20} fill="#dce1ed" fontSize="11">{s.label}</text>
    <text x={width - 12} y={44 + index * 20} textAnchor="end" fill="white" fontSize="11" fontWeight="600">{format(row[s.key])}</text>
   </g>)}
  </g>}
 </g>;
}
