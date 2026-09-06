import { apiFetch as fetch } from '../lib/apiFetch.js';
import { useMemo, useState } from 'react';

const STEPS = [
  { key: 'contact', label: 'Contact' },
  { key: 'socials', label: 'Socials' },
  { key: 'fit', label: 'Fit' },
  { key: 'terms', label: 'Terms' },
];

const INITIAL = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  location: '',
  instagram: '',
  tiktok: '',
  youtube: '',
  sample_urls: '',
  niche: '',
  activities: '',
  strengths: '',
  audience_description: '',
  audience_psychographics: '',
  creator_experience: '',
  why_howl: '',
  rate_expectations: '',
  availability: '',
  open_to_product_for_content: '',
  open_to_whitelisting: '',
  referral_source: '',
  consent_confirmed: false,
  website: '',
};

function splitList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function socialUrl(platform, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, '');
  if (platform === 'instagram') return `https://www.instagram.com/${handle}/`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@${handle}`;
  if (platform === 'youtube') return `https://www.youtube.com/@${handle}`;
  return raw;
}

export default function CreatorApplicationPage() {
  const [form, setForm] = useState(INITIAL);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const validateStep = targetStep => {
    const samples = splitList(form.sample_urls);
    const hasSocial = Boolean(form.instagram.trim() || form.tiktok.trim() || form.youtube.trim());
    if (targetStep === 0 && (!form.first_name.trim() || !form.last_name.trim() || !form.email.includes('@') || !form.location.trim())) {
      setError('Add your name, email, and location before continuing.');
      return false;
    }
    if (targetStep === 1 && (!hasSocial || !samples.length)) {
      setError('Add at least one social profile and one HTTPS work sample.');
      return false;
    }
    if (targetStep === 2 && (!form.niche.trim() || !form.strengths.trim() || !form.audience_description.trim() || !form.why_howl.trim())) {
      setError('Add your niche, strengths, audience, and why HOWL fits.');
      return false;
    }
    if (targetStep === 3 && (!form.rate_expectations.trim() || !form.availability.trim() || !form.open_to_product_for_content || !form.open_to_whitelisting || !form.consent_confirmed)) {
      setError('Add your terms and consent before submitting.');
      return false;
    }
    setError('');
    return true;
  };
  const next = () => {
    if (validateStep(step)) setStep(current => Math.min(current + 1, STEPS.length - 1));
  };
  const back = () => setStep(current => Math.max(current - 1, 0));

  const sampleUrls = useMemo(() => splitList(form.sample_urls), [form.sample_urls]);
  const activities = useMemo(() => splitList(form.activities), [form.activities]);
  const socialPreviews = useMemo(() => ([
    ['Instagram', socialUrl('instagram', form.instagram)],
    ['TikTok', socialUrl('tiktok', form.tiktok)],
    ['YouTube', socialUrl('youtube', form.youtube)],
  ].filter(([, url]) => url)), [form.instagram, form.tiktok, form.youtube]);
  const progress = Math.round(((step + 1) / STEPS.length) * 100);

  const submit = async event => {
    event.preventDefault();
    for (let index = 0; index < STEPS.length; index += 1) {
      if (!validateStep(index)) {
        setStep(index);
        return;
      }
    }
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
          sample_urls: sampleUrls,
          activities,
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
      <main className="creator-apply-page apply-complete-page">
        <section className="apply-success">
          <img src="/logos/howl-stacked-blk.png" alt="HOWL Campfires" />
          <span>Application received</span>
          <h1>You are in the queue.</h1>
          <p>We will review your creator profile and reach out if there is a fit for an upcoming HOWL brief.</p>
          {code && <div><small>Reference</small><strong>{code}</strong></div>}
        </section>
      </main>
    );
  }

  return (
    <main className="creator-apply-page creator-apply-redesign">
      <aside className="apply-story">
        <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
        <div>
          <h1>Howl Creator Program Application</h1>
        </div>
      </aside>

      <section className="apply-form-shell">
        <header className="apply-form-header">
          <span>Apply to create with HOWL</span>
          <h2>{STEPS[step].label}</h2>
          <p>{step === 0 && 'Start with the basics so we can follow up cleanly.'}
            {step === 1 && 'Add the channels and examples that best show your work.'}
            {step === 2 && 'Help us understand your audience, creative lane, and fit.'}
            {step === 3 && 'Set expectations before we review your application.'}</p>
        </header>

        <div className="apply-progress">
          <span style={{ width: `${progress}%` }} />
        </div>

        <form onSubmit={submit}>
          <input className="apply-honeypot" tabIndex="-1" autoComplete="off" value={form.website} onChange={event => update('website', event.target.value)} />

          <nav className="apply-step-tabs" aria-label="Application sections">
            {STEPS.map((item, index) => (
              <button key={item.key} type="button" className={index === step ? 'active' : ''} onClick={() => setStep(index)}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {step === 0 && (
            <fieldset>
              <legend><b>01</b> Contact</legend>
              <div className="apply-grid">
                <label>First name<input required autoComplete="given-name" value={form.first_name} onChange={event => update('first_name', event.target.value)} /></label>
                <label>Last name<input required autoComplete="family-name" value={form.last_name} onChange={event => update('last_name', event.target.value)} /></label>
                <label>Email<input required type="email" autoComplete="email" value={form.email} onChange={event => update('email', event.target.value)} /></label>
                <label>Phone<input autoComplete="tel" value={form.phone} onChange={event => update('phone', event.target.value)} /></label>
                <label className="wide">Location<input required placeholder="City, state" value={form.location} onChange={event => update('location', event.target.value)} /></label>
              </div>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset>
              <legend><b>02</b> Socials</legend>
              <div className="apply-grid">
                <label>Instagram<input placeholder="@handle" value={form.instagram} onChange={event => update('instagram', event.target.value)} /></label>
                <label>TikTok<input placeholder="@handle" value={form.tiktok} onChange={event => update('tiktok', event.target.value)} /></label>
                <label className="wide">YouTube<input placeholder="@channel or channel URL" value={form.youtube} onChange={event => update('youtube', event.target.value)} /></label>
                <label className="wide">Portfolio or past UGC links<textarea required rows="4" placeholder="Paste one HTTPS link per line" value={form.sample_urls} onChange={event => update('sample_urls', event.target.value)} /></label>
              </div>
              <div className="apply-preview-list">
                {socialPreviews.map(([label, url]) => <a key={label} href={url} target="_blank" rel="noreferrer">{label}<span>{url}</span></a>)}
                {sampleUrls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">Work sample<span>{url}</span></a>)}
                {!socialPreviews.length && !sampleUrls.length && <p>Add at least one social profile and one work sample.</p>}
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend><b>03</b> Fit</legend>
              <div className="apply-grid">
                <label>Niche<input required placeholder="Outdoor cooking, camping, family adventure" value={form.niche} onChange={event => update('niche', event.target.value)} /></label>
                <label>Activities<input placeholder="Camping, overlanding, backyard hosting" value={form.activities} onChange={event => update('activities', event.target.value)} /></label>
                <label className="wide">Creative strengths<textarea required rows="3" placeholder="What are you especially good at making?" value={form.strengths} onChange={event => update('strengths', event.target.value)} /></label>
                <label className="wide">Audience<textarea required rows="3" placeholder="Who watches you, and what do they come to you for?" value={form.audience_description} onChange={event => update('audience_description', event.target.value)} /></label>
                <label className="wide">Audience mindset<textarea rows="3" placeholder="What do they care about, buy, avoid, or aspire to?" value={form.audience_psychographics} onChange={event => update('audience_psychographics', event.target.value)} /></label>
                <label className="wide">Creator experience<textarea rows="3" placeholder="Brands, formats, hooks, campaigns, or production notes worth knowing" value={form.creator_experience} onChange={event => update('creator_experience', event.target.value)} /></label>
                <label className="wide">Why HOWL?<textarea required rows="3" placeholder="Tell us why this brand makes sense for your voice." value={form.why_howl} onChange={event => update('why_howl', event.target.value)} /></label>
              </div>
            </fieldset>
          )}

          {step === 3 && (
            <fieldset>
              <legend><b>04</b> Terms</legend>
              <div className="apply-grid">
                <label>Rate expectations<input required placeholder="$ per video or package" value={form.rate_expectations} onChange={event => update('rate_expectations', event.target.value)} /></label>
                <label>Availability<input required placeholder="Example: 2 videos/month, 7 day turnaround" value={form.availability} onChange={event => update('availability', event.target.value)} /></label>
                <label>
                  Open to product for content?
                  <small>Product for content means creating in exchange for free product instead of a paid fee.</small>
                  <span className="apply-select-wrap">
                    <select required value={form.open_to_product_for_content} onChange={event => update('open_to_product_for_content', event.target.value)}>
                      <option value="">Choose one</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </span>
                </label>
                <label>
                  Open to paid usage?
                  <small>Paid usage means HOWL may run approved content as ads from HOWL or your handle.</small>
                  <span className="apply-select-wrap">
                    <select required value={form.open_to_whitelisting} onChange={event => update('open_to_whitelisting', event.target.value)}>
                      <option value="">Choose one</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </span>
                </label>
                <label className="wide">How did you hear about HOWL?<input value={form.referral_source} onChange={event => update('referral_source', event.target.value)} /></label>
              </div>
              <div className="apply-consent">
                <label><input required type="checkbox" checked={form.consent_confirmed} onChange={event => update('consent_confirmed', event.target.checked)} /> I consent to HOWL storing this information to evaluate and contact me about creator opportunities.</label>
              </div>
            </fieldset>
          )}

          <div className="apply-actions">
            <button type="button" onClick={back} disabled={step === 0}>Back</button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="apply-submit" onClick={next}>Continue</button>
            ) : (
              <button className="apply-submit" disabled={status === 'submitting'}>
                {status === 'submitting' ? 'Sending application...' : 'Submit application'}
              </button>
            )}
          </div>
          {error && <div className="apply-error">{error}</div>}
        </form>
      </section>
    </main>
  );
}
