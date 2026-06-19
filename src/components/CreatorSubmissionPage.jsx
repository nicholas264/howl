import { useEffect, useState } from 'react';
import { upload } from '@vercel/blob/client';

export default function CreatorSubmissionPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [submission, setSubmission] = useState(null);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('This upload link is incomplete.');
      setStatus('error');
      return;
    }
    fetch(`/api/creator-submit?token=${encodeURIComponent(token)}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not open this upload link');
        setSubmission(data.submission);
        setStatus(data.submission.status === 'active' ? 'ready' : data.submission.status);
      })
      .catch(err => {
        setError(err.message);
        setStatus('error');
      });
  }, [token]);

  const submit = async event => {
    event.preventDefault();
    if (!file || !submission) return;
    if (!file.type.startsWith('video/')) {
      setError('Please choose a video file.');
      return;
    }
    setStatus('uploading');
    setError('');
    setProgress(0);
    let blob = null;
    try {
      blob = await upload(
        `creator-submissions/${submission.id}/${Date.now()}-${file.name}`,
        file,
        {
          access: 'public',
          handleUploadUrl: '/api/blob/creator-upload-token',
          clientPayload: token,
          contentType: file.type,
          onUploadProgress: event => {
            if (event?.total) setProgress(Math.round((event.loaded / event.total) * 100));
          },
        },
      );
      setStatus('saving');
      const response = await fetch('/api/creator-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          video_url: blob.url,
          file_name: file.name,
          file_size: file.size,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not finish the submission');
      setSubmission(data.submission);
      setStatus('completed');
    } catch (err) {
      setError(err.message);
      setStatus('ready');
    }
  };

  const unavailable = ['completed', 'revoked', 'expired'].includes(status);
  const submitDisabledReason = status === 'uploading' || status === 'saving'
    ? 'Submitting your footage now.'
    : !file
      ? 'Choose a video file before submitting.'
      : '';

  return (
    <main className="creator-submit-page">
      <section className="creator-submit-shell">
        <img src="/logos/howl-horizontal-wht.png" alt="HOWL Campfires" />
        <span className="workspace-kicker">Creator submission</span>
        {status === 'loading' && <div className="creator-submit-state">Opening assignment...</div>}
        {status === 'error' && <div className="creator-submit-state"><h1>Link unavailable</h1><p>{error}</p></div>}
        {submission && (
          <>
            <header>
              <p>Hi {submission.creator_name},</p>
              <h1>{submission.title}</h1>
              <div className="creator-submit-meta">
                {submission.due_at && <span>Due {new Date(submission.due_at).toLocaleDateString()}</span>}
                <span>{submission.brief?.product || 'HOWL creator project'}</span>
              </div>
            </header>

            {submission.brief && (
              <div className="creator-submit-brief">
                {submission.brief.objective && <section><span>Objective</span><p>{submission.brief.objective}</p></section>}
                {submission.brief.angle && <section><span>Angle</span><p>{submission.brief.angle}</p></section>}
                {submission.brief.brief && <section><span>Brief</span><p>{submission.brief.brief}</p></section>}
                {submission.brief.script && <section><span>Script</span><p>{submission.brief.script}</p></section>}
                {!!submission.brief.deliverables?.length && (
                  <section>
                    <span>Deliverables</span>
                    <ul>{submission.brief.deliverables.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </section>
                )}
              </div>
            )}

            {status === 'completed' ? (
              <div className="creator-submit-success">
                <strong>Footage received</strong>
                <p>Your file is safely in HOWL’s editing queue. You can close this page.</p>
              </div>
            ) : unavailable ? (
              <div className="creator-submit-state">
                <h2>This link is {status}.</h2>
                <p>Contact your HOWL producer if you need a new upload link.</p>
              </div>
            ) : (
              <form className="creator-submit-upload" onSubmit={submit}>
                <label>
                  <input type="file" accept="video/*" onChange={event => setFile(event.target.files?.[0] || null)} />
                  <strong>{file ? file.name : 'Choose your final footage'}</strong>
                  <span>Video files up to 10 GB</span>
                </label>
                {error && <div className="app-error">{error}</div>}
                {(status === 'uploading' || status === 'saving') && (
                  <div className="creator-submit-progress">
                    <i style={{ width: `${status === 'saving' ? 100 : progress}%` }} />
                    <span>{status === 'saving' ? 'Connecting footage to your assignment...' : `Uploading ${progress}%`}</span>
                  </div>
                )}
                <button
                  className="primary-action"
                  disabled={!!submitDisabledReason}
                  title={submitDisabledReason}
                >
                  {status === 'uploading' || status === 'saving' ? 'Submitting...' : 'Submit footage'}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
