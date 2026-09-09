import React, { useState, useRef, useEffect } from 'react';

const monthLabel = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const valid = n => n != null && Number.isFinite(n);

export default function TrendLineChart({ rows = [], value, format, color = '#315f91', target, targetLabel, label = 'Trend', height = 240 }) {
  const container = useRef(null);
  const [containerWidth, setContainerWidth] = useState(560);
  const hasData = rows.some(row => valid(value(row)));
  useEffect(() => {
    const observer = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasData]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  // Keep missing months on the time axis and break the line across unavailable data.
  const ordered = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(ordered.map(row => [row.month, row]));
  const months = [];
  if (ordered.length) {
    const cursor = new Date(`${ordered[0].month}-01T12:00:00Z`);
    const last = ordered.at(-1).month;
    while (cursor.toISOString().slice(0, 7) <= last) {
      const month = cursor.toISOString().slice(0, 7);
      const row = byMonth.get(month);
      months.push({ month, isCurrent: row?.isCurrent, y: row ? value(row) : null });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const points = months.filter(point => valid(point.y));
  if (!points.length) return <div ref={container} style={{ minHeight: height, display: 'grid', placeItems: 'center', fontSize: 12, color: '#6f6d68' }}>No {label.toLowerCase()} data for this period</div>;

  const width = Math.max(240, Math.round(containerWidth));
  const left = 68, right = 36, top = 20, bottom = 42;
  const plotHeight = height - top - bottom;
  const values = points.map(point => point.y);
  if (valid(target)) values.push(target);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const rawStep = (high - low || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].find(n => n * magnitude >= rawStep) * magnitude;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil((high || step) / step) * step;
  const labelEvery = Math.max(1, Math.ceil((months.length - 1) * 60 / (width - left - right)));
  const xFor = index => months.length === 1 ? (left + width - right) / 2 : left + index * (width - left - right) / (months.length - 1);
  const yFor = n => top + (max - n) / (max - min) * plotHeight;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
  const selected = months.find(point => point.month === selectedMonth) || months.at(-1);
  const currentIndex = months.findIndex(point => point.isCurrent);

  return (
    <div ref={container} style={{ minWidth: 0 }}>
      <div aria-live="polite" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, minHeight: 40, fontSize: 12, color: '#6f6d68' }}>
        <span>{monthLabel(selected.month)}{selected.isCurrent ? ' · MTD' : ''} <strong style={{ marginLeft: 8, fontSize: 22, fontWeight: 600, color: '#171717', fontVariantNumeric: 'tabular-nums' }}>{valid(selected.y) ? format(selected.y) : 'No data'}</strong></span>
        {valid(target) && <span style={{ color: '#256b35' }}>– – {targetLabel || format(target)}</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${label} by month; focus a point for its value`} style={{ display: 'block', width: '100%', minWidth: width, height: 'auto' }}>
          {currentIndex >= 0 && <rect x={Math.max(left, xFor(currentIndex) - 24)} y={top} width="48" height={plotHeight} fill={color} opacity="0.06" />}
          {ticks.map(tick => <g key={tick}>
            <line x1={left} x2={width - right} y1={yFor(tick)} y2={yFor(tick)} stroke="#e8e6e0" vectorEffect="non-scaling-stroke" />
            <text x={left - 12} y={yFor(tick) + 4} textAnchor="end" fontSize="11" fill="#6f6d68">{format(tick)}</text>
          </g>)}
          {valid(target) && <line x1={left} x2={width - right} y1={yFor(target)} y2={yFor(target)} stroke="#256b35" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
          {months.map((point, index) => {
            const previous = months[index - 1];
            return valid(point.y) && valid(previous?.y) ? <line key={point.month} x1={xFor(index - 1)} y1={yFor(previous.y)} x2={xFor(index)} y2={yFor(point.y)} stroke={color} strokeWidth="2.5" strokeDasharray={point.isCurrent ? '5 5' : undefined} vectorEffect="non-scaling-stroke" /> : null;
          })}
          {months.map((point, index) => <g key={point.month}>
            {valid(point.y) && <g tabIndex="0" role="img" aria-label={`${monthLabel(point.month)}${point.isCurrent ? ' MTD' : ''}: ${format(point.y)}`} onMouseEnter={() => setSelectedMonth(point.month)} onMouseLeave={() => setSelectedMonth(null)} onFocus={() => setSelectedMonth(point.month)} onBlur={() => setSelectedMonth(null)} onClick={() => setSelectedMonth(point.month)} style={{ cursor: 'pointer' }}>
              <title>{monthLabel(point.month)}{point.isCurrent ? ' MTD' : ''}: {format(point.y)}</title>
              <circle cx={xFor(index)} cy={yFor(point.y)} r="12" fill="transparent" />
              <circle cx={xFor(index)} cy={yFor(point.y)} r={selected.month === point.month ? 5 : 3.5} fill={point.isCurrent ? '#fff' : color} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </g>}
            {(index === months.length - 1 || (index % labelEvery === 0 && index < months.length - Math.max(1, labelEvery - 1))) && <text x={xFor(index)} y={height - 21} textAnchor="middle" fontSize="11" fill="#6f6d68">{monthLabel(point.month)}</text>}
            {point.isCurrent && <text x={xFor(index)} y={height - 6} textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>MTD</text>}
          </g>)}
        </svg>
      </div>
    </div>
  );
}
