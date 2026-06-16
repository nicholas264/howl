import React from 'react';

export default function LaunchTimeline({ stepDefs, steps, currentStep }) {
  return (
    <div style={{ marginTop: 12, padding: '14px 4px 8px', display: 'flex', alignItems: 'flex-start', gap: 0, position: 'relative' }}>
      {stepDefs.map((s, idx) => {
        const st = steps[s.key];
        const status = st?.status || 'idle';
        const isCurrent = currentStep === s.key && status !== 'done' && status !== 'error';
        const done = status === 'done';
        const err = status === 'error';
        const color = err ? '#b42318' : done ? '#256b35' : isCurrent ? '#d84a17' : '#dedbd3';
        const nextDone = steps[stepDefs[idx + 1]?.key]?.status === 'done';
        const lineColor = done ? (nextDone ? '#256b35' : '#d84a17') : '#dedbd3';
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}>
              <div
                style={{
                  width: 14, height: 14, borderRadius: '50%', background: color,
                  boxShadow: isCurrent ? `0 0 0 3px rgba(220,68,10,0.2), 0 0 12px rgba(220,68,10,0.5)` : 'none',
                  animation: isCurrent ? 'pulseDot 1.2s ease-in-out infinite' : 'none',
                  border: status === 'idle' ? '2px solid #dedbd3' : 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: isCurrent ? '#171717' : err ? '#b42318' : done ? '#77746f' : '#88857f', fontWeight: isCurrent ? 700 : 500, whiteSpace: 'nowrap' }}>
                {s.label}
              </div>
              {st?.detail && (
                <div style={{ fontSize: 9, color: '#88857f', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{typeof st.detail === 'string' ? st.detail : JSON.stringify(st.detail)}</div>
              )}
            </div>
            {idx < stepDefs.length - 1 && (
              <div style={{ flex: 1, height: 2, background: lineColor, marginTop: 6, minWidth: 12, transition: 'background 0.3s' }} />
            )}
          </React.Fragment>
        );
      })}
      <style>{`@keyframes pulseDot { 0%,100% { transform: scale(1); } 50% { transform: scale(1.2); } }`}</style>
    </div>
  );
}
