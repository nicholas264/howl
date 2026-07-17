import { useState } from 'react';

const INITIAL = {
  first_name: '',
  last_name: '',
  email: '',
  instagram: '',
  youtube: '',
  rate_expectations: '',
  availability: '',
  open_to_product_for_content: '',
  open_to_whitelisting: '',
  consent_confirmed: false,
  website: '',
};

export default function CreatorApplicationPage() {
  const [form, setForm] = useState(INITIAL);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const submit = async event => {
    event.preventDefault();
    setStatus('submitting');
    setError('');
    try {
      const response = await fetch('/api/creator-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          name: `${form.first_name} ${form.last_name}`.trim(),
          age_confirmed: true,
          open_to_product_for_content: form.open_to_product_for_content === 'yes',
          open_to_whitelisting: form.open_to_whitelisting === 'yes',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit application');
      setCode(data.application_code || '');
      setStatus('complete');
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  };

  if (status === 'complete') {
    return (
      <main className="creator-apply-page">
        <section className="apply-success">
          <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
          <span>Application received</span>
          <h1>Thanks for applying.</h1>
          <p>We will review your info and reach out if there is a fit for an upcoming creator brief.</p>
          {code && <div><small>Reference</small><strong>{code}</strong></div>}
        </section>
      </main>
    );
  }

  return (
    <main className="creator-apply-page">
      <aside className="apply-story">
        <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
        <div>
          <span>Creator application</span>
          <h1>Create with HOWL.</h1>
          <p>Share the basics so we can match you to the right UGC brief, rate, timeline, and usage needs.</p>
        </div>
        <dl>
          <div><dt>01</dt><dd>Simple intake</dd></div>
          <div><dt>02</dt><dd>Clear rates</dd></div>
          <div><dt>03</dt><dd>Fast matching</dd></div>
        </dl>
      </aside>

      <section className="apply-form-shell">
        <header>
          <span>Apply to create with HOWL</span>
          <h2>Creator basics</h2>
          <p>Keep it simple. We only need enough to evaluate fit and start a conversation.</p>
        </header>
        <form onSubmit={submit}>
          <input className="apply-honeypot" tabIndex="-1" autoComplete="off" value={form.website} onChange={event => update('website', event.target.value)} />
          <fieldset>
            <legend><b>01</b> Contact</legend>
            <div className="apply-grid">
              <label>First name<input required autoComplete="given-name" value={form.first_name} onChange={event => update('first_name', event.target.value)} /></label>
              <label>Last name<input required autoComplete="family-name" value={form.last_name} onChange={event => update('last_name', event.target.value)} /></label>
              <label className="wide">Email<input required type="email" autoComplete="email" value={form.email} onChange={event => update('email', event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><b>02</b> Social</legend>
            <div className="apply-grid">
              <label>Instagram handle<input placeholder="@handle" value={form.instagram} onChange={event => update('instagram', event.target.value)} /></label>
              <label>YouTube handle<input placeholder="@channel or channel URL" value={form.youtube} onChange={event => update('youtube', event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><b>03</b> Terms</legend>
            <div className="apply-grid">
              <label>Rate<input required placeholder="$ per video or package" value={form.rate_expectations} onChange={event => update('rate_expectations', event.target.value)} /></label>
              <label>Turnaround time<input required placeholder="Example: 7 days" value={form.availability} onChange={event => update('availability', event.target.value)} /></label>
              <label>
                Open to product for content?
                <select required value={form.open_to_product_for_content} onChange={event => update('open_to_product_for_content', event.target.value)}>
                  <option value="">Choose one</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label>
                Open to whitelisting?
                <select required value={form.open_to_whitelisting} onChange={event => update('open_to_whitelisting', event.target.value)}>
                  <option value="">Choose one</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
          </fieldset>

          <div className="apply-consent">
            <label><input required type="checkbox" checked={form.consent_confirmed} onChange={event => update('consent_confirmed', event.target.checked)} /> I consent to HOWL storing this information to evaluate and contact me about creator opportunities.</label>
          </div>
          {error && <div className="apply-error">{error}</div>}
          <button className="apply-submit" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Sending application...' : 'Submit application'}
          </button>
        </form>
      </section>
    </main>
  );
}
