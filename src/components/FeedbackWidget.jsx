import React, { useState } from 'react';

const KINDS = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'edge_case', label: 'Edge case' },
];

const S = {
  fab: {
    position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
    width: 48, height: 48, borderRadius: '50%',
    background: '#d84a17', color: '#fff', border: 'none',
    fontSize: 20, cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
    fontFamily: 'inherit',
  },
  panel: {
    position: 'fixed', bottom: 80, right: 20, zIndex: 9999,
    width: 340, background: '#fff', border: '1px solid #dedbd3',
    borderRadius: 8, padding: 18,
    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
    fontFamily: 'inherit',
  },
  title: { fontSize: 12, color: '#171717', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 },
  hint: { fontSize: 10, color: '#77746f', marginBottom: 12, lineHeight: 1.5 },
  row: { display: 'flex', gap: 6, marginBottom: 10 },
  kindBtn: (active) => ({
    flex: 1, padding: '6px 8px', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
    background: active ? 'rgba(220,68,10,0.15)' : '#f4f1ea',
    color: active ? '#d84a17' : '#77746f',
    border: `1px solid ${active ? '#d84a17' : '#dedbd3'}`,
    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
  }),
  textarea: {
    width: '100%', minHeight: 110, padding: 10, fontSize: 12,
    background: '#f4f1ea', border: '1px solid #dedbd3', color: '#171717',
    borderRadius: 4, outline: 'none', fontFamily: 'inherit', resize: 'vertical',
    boxSizing: 'border-box',
  },
  submit: {
    width: '100%', marginTop: 10, padding: '10px 14px',
    background: '#d84a17', color: '#fff', border: 'none', borderRadius: 4,
    fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: 600,
  },
  submitDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  status: { fontSize: 10, color: '#77746f', marginTop: 8, lineHeight: 1.5 },
  error: { fontSize: 10, color: '#b42318', marginTop: 8, lineHeight: 1.5 },
  closeX: {
    position: 'absolute', top: 10, right: 10, background: 'none', border: 'none',
    color: '#88857f', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1,
  },
};

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('bug');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setMessage(''); setKind('bug'); setDone(false); setError(''); };

  const submit = async () => {
    if (!message.trim()) return;
    setSubmitting(true); setError('');
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message: message.trim(), page_url: window.location.href }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Submit failed');
      setDone(true);
      setMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        style={S.fab}
        title="Report bug or feature request"
        onClick={() => { setOpen(o => !o); if (open) reset(); }}
      >
        {open ? '×' : '?'}
      </button>
      {open && (
        <div style={S.panel}>
          <button style={S.closeX} onClick={() => { setOpen(false); reset(); }}>×</button>
          <div style={S.title}>Send feedback</div>
          <div style={S.hint}>Bug, feature idea, or edge case you ran into. Goes straight to Nicholas + Claude.</div>
          {done ? (
            <>
              <div style={{ ...S.status, color: '#256b35' }}>Got it. Thanks.</div>
              <button style={S.submit} onClick={reset}>Send another</button>
            </>
          ) : (
            <>
              <div style={S.row}>
                {KINDS.map(k => (
                  <button key={k.value} style={S.kindBtn(kind === k.value)} onClick={() => setKind(k.value)}>{k.label}</button>
                ))}
              </div>
              <textarea
                style={S.textarea}
                placeholder={kind === 'bug' ? 'What broke? What did you expect?' : kind === 'feature' ? 'What do you wish this did?' : 'What weird case did you hit?'}
                value={message}
                onChange={e => setMessage(e.target.value)}
                maxLength={5000}
              />
              {error && <div style={S.error}>{error}</div>}
              <button
                style={{ ...S.submit, ...(submitting || !message.trim() ? S.submitDisabled : {}) }}
                disabled={submitting || !message.trim()}
                onClick={submit}
              >
                {submitting ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
