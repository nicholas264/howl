import { useState } from 'react';

const INITIAL = {
  name: '', email: '', phone: '', location: '', timezone: '', niche: '', strengths: '',
  activities: '', audience_description: '', creator_experience: '', why_howl: '',
  rate_expectations: '', availability: '', referral_source: '', instagram: '', tiktok: '',
  youtube: '', other_social: '', sample_urls: '', age_confirmed: false,
  consent_confirmed: false, website: '',
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
          activities: form.activities.split(',').map(item => item.trim()).filter(Boolean),
          sample_urls: form.sample_urls.split(/\n|,/).map(item => item.trim()).filter(Boolean),
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
          <h1>Thanks for stepping into the circle.</h1>
          <p>Our team reviews every application for creator fit, audience alignment, and upcoming campaign needs.</p>
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
          <span>Creator network</span>
          <h1>Make work people can feel.</h1>
          <p>We partner with creators who live close to the product: camping, hunting, overlanding, outdoor cooking, backyards, events, and the rituals that bring people together.</p>
        </div>
        <dl>
          <div><dt>01</dt><dd>Real product use</dd></div>
          <div><dt>02</dt><dd>Clear point of view</dd></div>
          <div><dt>03</dt><dd>Reliable production</dd></div>
        </dl>
      </aside>

      <section className="apply-form-shell">
        <header>
          <span>Apply to create with HOWL</span>
          <h2>Tell us what you make and why you make it.</h2>
          <p>Specific beats polished. Share the work, activities, and audience that make you distinctly you.</p>
        </header>
        <form onSubmit={submit}>
          <input className="apply-honeypot" tabIndex="-1" autoComplete="off" value={form.website} onChange={event => update('website', event.target.value)} />
          <fieldset>
            <legend><b>01</b> Basics</legend>
            <div className="apply-grid">
              <label className="wide">Name<input required value={form.name} onChange={event => update('name', event.target.value)} /></label>
              <label>Email<input required type="email" value={form.email} onChange={event => update('email', event.target.value)} /></label>
              <label>Phone<input value={form.phone} onChange={event => update('phone', event.target.value)} /></label>
              <label>Location<input required placeholder="City, State" value={form.location} onChange={event => update('location', event.target.value)} /></label>
              <label>Timezone<input placeholder="Mountain, Central..." value={form.timezone} onChange={event => update('timezone', event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><b>02</b> Your world</legend>
            <div className="apply-grid">
              <label className="wide">Creator niche<input required placeholder="Outdoor cooking, overlanding, hunting..." value={form.niche} onChange={event => update('niche', event.target.value)} /></label>
              <label className="wide">Activities<input placeholder="Comma-separated" value={form.activities} onChange={event => update('activities', event.target.value)} /></label>
              <label className="wide">What are you strongest at?<textarea required rows="3" value={form.strengths} onChange={event => update('strengths', event.target.value)} /></label>
              <label className="wide">Who follows you and what do they care about?<textarea rows="3" value={form.audience_description} onChange={event => update('audience_description', event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><b>03</b> Work</legend>
            <div className="apply-grid">
              <label>Instagram<input placeholder="@handle" value={form.instagram} onChange={event => update('instagram', event.target.value)} /></label>
              <label>TikTok<input placeholder="@handle" value={form.tiktok} onChange={event => update('tiktok', event.target.value)} /></label>
              <label>YouTube<input placeholder="Channel URL" value={form.youtube} onChange={event => update('youtube', event.target.value)} /></label>
              <label>Other social<input placeholder="Profile URL" value={form.other_social} onChange={event => update('other_social', event.target.value)} /></label>
              <label className="wide">Best examples of your work<textarea required rows="3" placeholder="One URL per line" value={form.sample_urls} onChange={event => update('sample_urls', event.target.value)} /></label>
              <label className="wide">Creator experience<textarea rows="3" placeholder="Brand work, production setup, editing capabilities..." value={form.creator_experience} onChange={event => update('creator_experience', event.target.value)} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><b>04</b> Fit</legend>
            <div className="apply-grid">
              <label className="wide">Why HOWL?<textarea required rows="4" value={form.why_howl} onChange={event => update('why_howl', event.target.value)} /></label>
              <label>Rate expectations<input placeholder="Per video or package" value={form.rate_expectations} onChange={event => update('rate_expectations', event.target.value)} /></label>
              <label>Availability<input placeholder="Typical turnaround" value={form.availability} onChange={event => update('availability', event.target.value)} /></label>
              <label className="wide">How did you hear about us?<input value={form.referral_source} onChange={event => update('referral_source', event.target.value)} /></label>
            </div>
          </fieldset>

          <div className="apply-consent">
            <label><input required type="checkbox" checked={form.age_confirmed} onChange={event => update('age_confirmed', event.target.checked)} /> I confirm I am at least 18 years old.</label>
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
