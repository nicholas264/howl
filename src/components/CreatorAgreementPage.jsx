import { useEffect, useState } from 'react';

function money(value, currency = 'USD') {
  if (value === null || value === undefined || value === '') return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
}

export default function CreatorAgreementPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [agreement, setAgreement] = useState(null);
  const [acceptedName, setAcceptedName] = useState('');
  const [acceptedEmail, setAcceptedEmail] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('This agreement link is incomplete.');
      setStatus('error');
      return;
    }
    fetch(`/api/creator-agreement?token=${encodeURIComponent(token)}`)
      .then(async response => {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json() : {};
        if (!response.ok || !data.agreement) throw new Error(data.error || 'Could not open this agreement');
        setAgreement(data.agreement);
        setAcceptedEmail(data.agreement.creator_email || '');
        setStatus(data.agreement.status);
      })
      .catch(err => {
        setError(err.message);
        setStatus('error');
      });
  }, [token]);

  const accept = async event => {
    event.preventDefault();
    setStatus('saving');
    setError('');
    try {
      const response = await fetch('/api/creator-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, accepted_name: acceptedName, accepted_email: acceptedEmail, confirmed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not accept this agreement');
      setAgreement(data.agreement);
      setStatus('accepted');
    } catch (err) {
      setError(err.message);
      setStatus('sent');
    }
  };

  const unavailable = ['draft', 'revoked', 'expired'].includes(status);
  const terms = agreement?.engagement;

  return (
    <main className="creator-submit-page creator-agreement-page">
      <section className="creator-submit-shell agreement-shell">
        <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
        <span className="workspace-kicker">Creator agreement</span>
        {status === 'loading' && <div className="creator-submit-state">Opening agreement...</div>}
        {status === 'error' && <div className="creator-submit-state"><h1>Link unavailable</h1><p>{error}</p></div>}
        {agreement && (
          <>
            <header>
              <p>Prepared for {agreement.creator_name}</p>
              <h1>{agreement.title}</h1>
              <div className="creator-submit-meta">
                <span>Version {agreement.version}</span>
                {agreement.expires_at && <span>Respond by {new Date(agreement.expires_at).toLocaleDateString()}</span>}
              </div>
            </header>

            {terms && (
              <dl className="agreement-terms">
                <div><dt>Engagement</dt><dd>{terms.type === 'retainer' ? 'Retainer' : 'One-off'}</dd></div>
                {terms.asset_commitment != null && <div><dt>Assets</dt><dd>{terms.asset_commitment} {terms.cadence || ''}</dd></div>}
                {terms.fee_amount != null && <div><dt>Compensation</dt><dd>{money(terms.fee_amount, terms.fee_currency)}</dd></div>}
                {terms.usage_term_months != null && <div><dt>Usage term</dt><dd>{terms.usage_term_months} months</dd></div>}
                <div><dt>Paid media</dt><dd>{terms.paid_media_included ? 'Included' : 'Not included'}</dd></div>
                <div><dt>Raw footage</dt><dd>{terms.raw_footage_included ? 'Included' : 'Not included'}</dd></div>
              </dl>
            )}

            <article className="agreement-document">
              {agreement.agreement_body.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </article>

            {status === 'accepted' ? (
              <div className="creator-submit-success">
                <strong>Agreement accepted</strong>
                <p>Accepted by {agreement.accepted_name} on {new Date(agreement.accepted_at).toLocaleString()}.</p>
              </div>
            ) : unavailable ? (
              <div className="creator-submit-state">
                <h2>This agreement is {status}.</h2>
                <p>Contact your HOWL representative if you need a new agreement.</p>
              </div>
            ) : (
              <form className="agreement-accept" onSubmit={accept}>
                <div>
                  <label>Full legal name<input required value={acceptedName} onChange={event => setAcceptedName(event.target.value)} /></label>
                  <label>Email<input required type="email" value={acceptedEmail} onChange={event => setAcceptedEmail(event.target.value)} /></label>
                </div>
                <label className="agreement-confirm">
                  <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
                  <span>I have read this agreement and confirm my acceptance by typing my name above.</span>
                </label>
                {error && <div className="app-error">{error}</div>}
                <button className="primary-action" disabled={!confirmed || !acceptedName.trim() || status === 'saving'}>
                  {status === 'saving' ? 'Recording acceptance...' : 'Accept agreement'}
                </button>
                <small>This electronic acceptance is recorded with the agreement version, date, and audit details.</small>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
