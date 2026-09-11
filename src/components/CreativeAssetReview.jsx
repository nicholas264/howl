import React, { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api.js';
import CreativePreviewImage from './CreativePreviewImage.jsx';
import { buildIteration } from '../lib/creative-analytics-view.js';

export default function CreativeAssetReview({ group, creators, canManage, onAssign, onNormalizeAsset, onClose, onAnalysis, onOpenCreator, setActiveTab, since, until }) {
  const dialog = useRef(null);
  const [creatorId, setCreatorId] = useState(String(group.creatorId || ''));
  const [sourceType, setSourceType] = useState(group.sourceType && group.sourceType !== 'external_creator' ? group.sourceType : 'external_creator');
  const [sourceLabel, setSourceLabel] = useState(group.sourceLabel || '');
  const [title, setTitle] = useState(`${group.name} — next iteration`);
  const [hypothesis, setHypothesis] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => { const el = dialog.current; el.showModal(); return () => el.close(); }, []);
  useEffect(() => { setCreatorId(String(group.creatorId || '')); }, [group.creatorId]);
  useEffect(() => { setMediaFailed(false); }, [group.playableUrl]);
  const repairMedia = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await onNormalizeAsset(group.groupKey, group.assetId || null);
      if (!result.ok) throw new Error(result.message || result.error || 'No playable source was recovered. Add the original video through Data & sources.');
      setMediaFailed(false);
      setMessage('Playback source repaired. Play the video to check it.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const saveSource = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      await onAssign(group.groupKey, sourceType === 'external_creator' ? Number(creatorId) : null, sourceType === 'external_creator' ? {} : { sourceType, sourceLabel });
      setMessage('Source saved. The asset and its associated launches are linked to this record.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const saveIteration = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = buildIteration(group, { title, hypothesis, since, until });
      const result = await apiJson('/api/creative-flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 'Could not save iteration');
      if (!result.card?.id) throw new Error('The server did not confirm a saved iteration.');
      setSaved(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const sourceChanged = sourceType === 'external_creator' ? String(group.creatorId || '') !== creatorId || group.creatorConflict : group.sourceType !== sourceType || (group.sourceLabel || '') !== sourceLabel;
  return <dialog ref={dialog} className="ca-review" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }}>
    <header><div><p>Creative detail</p><h2>{group.name}</h2></div><button onClick={onClose} disabled={busy} aria-label="Close creative detail">✕</button></header>
    <div className="ca-review-layout">
      <div>
        <div className="ca-review-player">
          {group.assetKind === 'video' && group.playableUrl && !mediaFailed ? <video controls playsInline preload="metadata" src={group.playableUrl} poster={group.previewUrl || group.thumbnailUrl} onError={() => setMediaFailed(true)} /> : <CreativePreviewImage groupKey={group.groupKey} src={group.previewUrl || group.thumbnailUrl} alt={group.name} loading="eager" />}
        </div>
        {group.assetKind === 'video' && (!group.playableUrl || mediaFailed) && <p className="ca-caption">{mediaFailed ? 'The video could not load.' : 'A direct video source is not available.'} {group.playbackEmbedUrl && <a href={group.playbackEmbedUrl} target="_blank" rel="noreferrer">Open Meta preview</a>}</p>}
        {group.assetKind === 'video' && onNormalizeAsset && <button className="ca-secondary" onClick={repairMedia} disabled={busy}>{busy ? 'Working…' : 'Repair video source'}</button>}
        <p className="ca-caption">{group.adCount} associated ads • {since} to {until}</p>
        <dl className="ca-metrics">{[['Spend', `$${Math.round(group.spend || 0).toLocaleString()}`], ['ROAS', group.spend ? `${Number(group.roas).toFixed(2)}×` : '—'], ['Purchases', group.purchases || 0], ['CPA', group.cpa == null ? '—' : `$${Number(group.cpa).toFixed(0)}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="ca-caption">Performance is attributed to these ads; it does not establish why the creative worked.</p>
        <button className="ca-secondary" disabled={busy} onClick={() => { onClose(); onAnalysis(group); }}>View analysis & transcript</button>
      </div>
      <div className="ca-review-actions">
        <section><h3>Connect the source</h3><p>One creator relationship across this asset and its ads.</p>
          <label>Source type<select value={sourceType} onChange={e => setSourceType(e.target.value)} disabled={!canManage || busy}><option value="external_creator">Creator</option><option value="founder">Founder</option><option value="internal_employee">HOWL team</option><option value="tool_generated">Made in HOWL</option></select></label>
          {sourceType === 'external_creator' ? <label>Creator in database<select value={creatorId} onChange={e => setCreatorId(e.target.value)} disabled={!canManage || busy}><option value="">Choose a creator</option>{creators.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}</select></label> : <label>Source name<input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder={sourceType === 'tool_generated' ? 'Made in HOWL' : 'Name'} disabled={!canManage || busy} /></label>}
          {!group.creatorId && group.suggestedCreatorId && <p className="ca-caption">Suggested: <button className="ca-inline" onClick={() => { setSourceType('external_creator'); setCreatorId(String(group.suggestedCreatorId)); }} disabled={!canManage || busy}>Use {group.suggestedCreatorName}</button><br />{group.suggestionReason}</p>}
          {group.creatorConflict && <p role="alert">This creative has conflicting creator links. Confirm the correct source.</p>}
          <div className="ca-action-row"><button className="ca-primary" onClick={saveSource} disabled={!canManage || busy || !sourceChanged || (sourceType === 'external_creator' && !creatorId) || (['founder', 'internal_employee'].includes(sourceType) && !sourceLabel.trim())}>Save source</button>{group.creatorId && onOpenCreator && <button className="ca-secondary" onClick={() => onOpenCreator(group.creatorId, 'performance')}>Open creator</button>}</div>
        </section>
        <section><h3>Plan the next iteration</h3><p>Keep the source, creator, and results attached to the next creative test.</p>
          {saved ? <div role="status"><p>Iteration saved to the creative board, ready to brief.</p><button className="ca-primary" onClick={() => setActiveTab('creative-flow')}>Open creative board</button></div> : <form onSubmit={saveIteration}><label>Working title<input value={title} maxLength={300} onChange={e => setTitle(e.target.value)} required disabled={busy} /></label><label>What should change, and what do you expect?<textarea value={hypothesis} maxLength={4000} onChange={e => setHypothesis(e.target.value)} placeholder="Keep the product demonstration. Test a shorter opening to see whether more viewers reach the proof." required rows={4} disabled={busy} /></label>
          {!group.creatorId && <p className="ca-caption">Save a creator connection above to plan an iteration.</p>}
          <button className="ca-primary" disabled={!canManage || busy || !group.creatorId || group.creatorConflict || sourceChanged || !hypothesis.trim() || !title.trim()}>{busy ? 'Saving…' : 'Save iteration'}</button></form>}
        </section>
        {message && <p role="status">{message}</p>}{error && <p role="alert" className="ca-error">{error}</p>}
      </div>
    </div>
  </dialog>;
}
