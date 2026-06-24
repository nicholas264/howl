import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import { useAuth } from '@clerk/clerk-react';
import { buildSrtFromWords } from '../utils/ffmpegClient';

const SILENCE_THRESHOLD_S = 0.6;
const AUTOSAVE_DEBOUNCE_MS = 1200;

const DEFAULT_SETTINGS = {
  burnCaptions: true,
  autoCutSilences: true,
};

const SESSION_FILTERS = [
  ['needs_edit', 'Needs edit'],
  ['launch_ready', 'Launch ready'],
  ['creator', 'Creator footage'],
  ['internal', 'Internal'],
  ['untranscribed', 'Needs transcript'],
  ['rendered', 'Rendered'],
  ['all', 'All'],
];

const SOURCE_LABELS = {
  external_creator: 'Creator upload',
  internal_employee: 'Internal footage',
  founder: 'Founder footage',
  tool_generated: 'Made in tool',
};

function dueStatus(session) {
  if (!session?.deliverable_due_at) return null;
  const due = new Date(session.deliverable_due_at);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  return {
    date: due,
    days,
    label: days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `Due in ${days}d`,
    urgent: days <= 2,
    overdue: days < 0,
  };
}

export default function UgcEditorTool({ initialSessionId = null, onInitialSessionLoaded, onAddToCart, onNavigate }) {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSession, setActiveSession] = useState(null); // db row
  const [file, setFile] = useState(null); // local File when fresh-uploaded; null after reload
  const [videoUrl, setVideoUrl] = useState(null); // blob URL of source (Vercel Blob or local objectURL)
  const [stage, setStage] = useState('idle'); // idle | uploading | uploaded | transcribing | ready | rendering | done
  const [progress, setProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [words, setWords] = useState([]);
  const [duration, setDuration] = useState(0);
  const [outputUrl, setOutputUrl] = useState(null);
  const [logTail, setLogTail] = useState('');
  const [aiCleaning, setAiCleaning] = useState(false);
  const [aiCleanupMessage, setAiCleanupMessage] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [sessionFilter, setSessionFilter] = useState('needs_edit');
  const videoRef = useRef(null);
  const autosaveTimer = useRef(null);
  const dirtyRef = useRef(false);
  const initialSessionLoadRef = useRef(null);

  // ── Load session list on mount ─────────────────────────────────────────────
  useEffect(() => { refreshSessions(); }, []);

  async function refreshSessions() {
    setSessionsLoading(true);
    try {
      const res = await fetch('/api/db/ugc-sessions');
      const data = await res.json();
      if (res.ok) setSessions(data.sessions || []);
    } catch (err) {
      console.error('failed to load sessions', err);
    } finally {
      setSessionsLoading(false);
    }
  }

  // ── Autosave words + settings on change ────────────────────────────────────
  useEffect(() => {
    if (!activeSession || !dirtyRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/db/ugc-sessions?id=${activeSession.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words, settings, duration }),
        });
        dirtyRef.current = false;
      } catch (err) {
        console.error('autosave failed', err);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [words, settings, duration, activeSession]);

  const markDirty = () => { dirtyRef.current = true; };

  const sessionStats = useMemo(() => sessions.reduce((stats, session) => {
    stats.all += 1;
    if (session.creator_id) stats.creator += 1;
    if (!session.creator_id && ['internal_employee', 'founder'].includes(session.source_type)) stats.internal += 1;
    if (!Number(session.word_count || 0) && !session.rendered_url) stats.untranscribed += 1;
    if (session.rendered_url || session.status === 'rendered') stats.rendered += 1;
    if (session.creator_id && session.rendered_url && !['complete', 'launched'].includes(session.deliverable_status)) stats.launch_ready += 1;
    if (session.creator_id && !(session.rendered_url || session.status === 'rendered')) stats.needs_edit += 1;
    if (dueStatus(session)?.overdue && !(session.rendered_url || session.status === 'rendered')) stats.overdue += 1;
    return stats;
  }, { all: 0, creator: 0, internal: 0, untranscribed: 0, rendered: 0, needs_edit: 0, launch_ready: 0, overdue: 0 }), [sessions]);

  const filteredSessions = useMemo(() => sessions.filter(session => {
    if (sessionFilter === 'all') return true;
    if (sessionFilter === 'creator') return Boolean(session.creator_id);
    if (sessionFilter === 'internal') return !session.creator_id && ['internal_employee', 'founder'].includes(session.source_type);
    if (sessionFilter === 'untranscribed') return !Number(session.word_count || 0) && !session.rendered_url;
    if (sessionFilter === 'rendered') return Boolean(session.rendered_url) || session.status === 'rendered';
    if (sessionFilter === 'launch_ready') return Boolean(session.creator_id && session.rendered_url && !['complete', 'launched'].includes(session.deliverable_status));
    if (sessionFilter === 'needs_edit') return Boolean(session.creator_id) && !(session.rendered_url || session.status === 'rendered');
    return true;
  }), [sessions, sessionFilter]);

  const sessionTitle = session => session?.deliverable_title || session?.title || session?.file_name || `Session ${session?.id}`;
  const sessionContext = session => [
    session?.creator_name,
    session?.brief_title,
  ].filter(Boolean).join(' · ');

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    markDirty();
  };

  // ── New upload ────────────────────────────────────────────────────────────
  const acceptFile = async (f) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      setError('Please upload a video file.');
      return;
    }
    setError('');
    setFile(f);
    setOutputUrl(null);
    setWords([]);
    setStage('uploading');
    setUploadProgress(0);

    try {
      const token = await getToken();
      const blob = await upload(`ugc-source/${Date.now()}-${f.name}`, f, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload-token',
        clientPayload: token,
        onUploadProgress: (event) => {
          if (event?.total) setUploadProgress(event.loaded / event.total);
          else if (typeof event === 'number') setUploadProgress(event);
        },
        contentType: f.type,
      });

      // Create the session row immediately so it shows up in the sidebar
      const localPreviewUrl = URL.createObjectURL(f);
      setVideoUrl(localPreviewUrl);

      const sessRes = await fetch('/api/db/ugc-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: f.name,
          file_name: f.name,
          file_size: f.size,
          video_url: blob.url,
          settings: DEFAULT_SETTINGS,
          status: 'uploaded',
          source_type: 'internal_employee',
          source_label: 'Manual editor upload',
        }),
      });
      const sessData = await sessRes.json();
      if (!sessRes.ok) throw new Error(sessData.error || 'Could not create session');
      setActiveSession(sessData.session);
      setSessions(prev => [sessData.session, ...prev]);
      setStage('uploaded');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Upload failed');
      setStage('idle');
    }
  };

  const handleFile = (e) => acceptFile(e.target.files?.[0]);

  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };
  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  // ── Transcribe via server-side ffmpeg + Whisper ───────────────────────────
  const transcribe = async () => {
    if (!activeSession) return;
    setStage('transcribing');
    setProgress(0);
    setError('');
    try {
      const r = await fetch('/api/transcribe-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Transcription failed');
      const ws = (data.words || []).map(w => ({
        word: w.word,
        start: w.start,
        end: w.end,
        kept: true,
      }));
      setWords(ws);
      setDuration(data.duration || (ws.length ? ws[ws.length - 1].end : 0));
      setStage('ready');
      // Already persisted server-side; no need to mark dirty
      refreshSessions();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Transcription failed');
      setStage('uploaded');
    }
  };

  // ── Loading an existing session from sidebar ──────────────────────────────
  const loadSession = useCallback(async (sessionId) => {
    setError('');
    try {
      const r = await fetch(`/api/db/ugc-sessions?id=${sessionId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not load session');
      const sess = data.session;

      if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
      setActiveSession(sess);
      setFile(null);
      setVideoUrl(sess.video_url);
      setWords(sess.words || []);
      setDuration(parseFloat(sess.duration) || 0);
      setSettings({ ...DEFAULT_SETTINGS, ...(sess.settings || {}) });
      setOutputUrl(sess.rendered_url || null);
      setError(sess.last_error || '');
      setStage(sess.rendered_url ? 'done' : (sess.words?.length ? 'ready' : 'uploaded'));
      dirtyRef.current = false;
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load session');
    }
  }, [videoUrl]);

  useEffect(() => {
    if (!initialSessionId || initialSessionLoadRef.current === initialSessionId) return;
    initialSessionLoadRef.current = initialSessionId;
    loadSession(initialSessionId).finally(() => onInitialSessionLoaded?.());
  }, [initialSessionId, loadSession, onInitialSessionLoaded]);

  const newSession = () => {
    if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
    setActiveSession(null);
    setFile(null);
    setVideoUrl(null);
    setWords([]);
    setDuration(0);
    setSettings(DEFAULT_SETTINGS);
    setOutputUrl(null);
    setError('');
    setStage('idle');
    dirtyRef.current = false;
  };

  const deleteSession = async (id) => {
    if (!confirm('Delete this session and its uploaded video?')) return;
    try {
      await fetch(`/api/db/ugc-sessions?id=${id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSession?.id === id) newSession();
    } catch (err) {
      console.error('delete failed', err);
    }
  };

  const toggleWord = (idx) => {
    setWords(prev => prev.map((w, i) => i === idx ? { ...w, kept: !w.kept } : w));
    markDirty();
  };

  const resetWords = () => {
    setWords(prev => prev.map(w => ({ ...w, kept: true })));
    setAiCleanupMessage('');
    markDirty();
  };

  const suggestCleanup = async () => {
    if (!activeSession || !words.length) return;
    setAiCleaning(true);
    setError('');
    setAiCleanupMessage('');
    try {
      const response = await fetch('/api/ugc-edit-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSession.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI cleanup failed');
      const remove = new Set(data.remove_indexes || []);
      setWords(prev => prev.map((word, index) => (
        remove.has(index) ? { ...word, kept: false } : word
      )));
      markDirty();
      setAiCleanupMessage(
        remove.size
          ? `${remove.size} word${remove.size === 1 ? '' : 's'} proposed for removal. Review the crossed-out transcript before rendering.`
          : (data.summary || 'No safe cleanup cuts found.'),
      );
    } catch (err) {
      setError(err.message || 'AI cleanup failed');
    } finally {
      setAiCleaning(false);
    }
  };

  const segments = useMemo(
    () => buildSegments(words, duration, settings.autoCutSilences),
    [words, duration, settings.autoCutSilences],
  );
  const keptDuration = segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
  const cutDuration = duration - keptDuration;
  const keptWords = useMemo(() => words.filter(w => w.kept), [words]);

  const render = async () => {
    if (!segments.length || !activeSession) return;
    setStage('rendering');
    setProgress(0);
    setError('');
    setOutputUrl(null);
    try {
      let captionsSrt = null;
      if (settings.burnCaptions) {
        const remapped = remapWordsToOutput(keptWords, segments);
        captionsSrt = buildSrtFromWords(remapped);
      }
      setLogTail('Rendering and saving footage on the server...');
      const response = await fetch('/api/render-ugc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSession.id,
          segments,
          captions_srt: captionsSrt,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Server render failed');
      const url = data.url;
      setOutputUrl(url);
      setActiveSession(prev => prev ? {
        ...prev,
        rendered_url: url,
        status: 'rendered',
        deliverable_status: prev.deliverable_id ? 'edited' : prev.deliverable_status,
        completed_asset_count: prev.deliverable_id ? Math.max(Number(prev.completed_asset_count || 0), 1) : prev.completed_asset_count,
      } : prev);
      setSessions(prev => prev.map(session => (
        session.id === activeSession.id
          ? {
              ...session,
              rendered_url: url,
              status: 'rendered',
              deliverable_status: session.deliverable_id ? 'edited' : session.deliverable_status,
              completed_asset_count: session.deliverable_id ? Math.max(Number(session.completed_asset_count || 0), 1) : session.completed_asset_count,
            }
          : session
      )));
      setProgress(1);
      setStage('done');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Render failed');
      setStage('ready');
    }
  };

  const download = () => {
    if (!outputUrl) return;
    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = `ugc_edit_${Date.now()}.mp4`;
    a.click();
  };

  const sendToCart = async () => {
    if (!outputUrl || !onAddToCart) return;
    const cartItem = {
      id: Date.now(),
      type: 'video',
      kind: 'ugc-edit',
      dataUrl: outputUrl,
      videoUrl: outputUrl,
      name: activeSession?.creator_name
        ? `${activeSession.creator_name} · ${activeSession.deliverable_title || 'UGC edit'}`
        : `UGC edit ${new Date().toLocaleString()}`,
      creator: activeSession?.creator_name || null,
      creatorId: activeSession?.creator_id || null,
      sourceType: activeSession?.source_type || (activeSession?.creator_id ? 'external_creator' : 'internal_employee'),
      sourceLabel: activeSession?.source_label || activeSession?.creator_name || 'UGC editor',
      briefId: activeSession?.brief_id || null,
      deliverableId: activeSession?.deliverable_id || null,
      sourceVideoUrl: outputUrl,
      originalSourceVideoUrl: activeSession?.video_url || null,
      createdAt: Date.now(),
    };
    await onAddToCart(cartItem);
    if (activeSession?.creator_id && activeSession?.deliverable_id) {
      try {
        const response = await fetch('/api/creator-workflow', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resource: 'deliverable',
            creator_id: activeSession.creator_id,
            id: activeSession.deliverable_id,
            status: 'complete',
            completed_asset_count: 1,
            approved_asset_count: 1,
          }),
        });
        if (!response.ok) throw new Error('Could not mark deliverable launch-ready');
        setActiveSession(prev => prev ? {
          ...prev,
          deliverable_status: 'complete',
          completed_asset_count: Math.max(Number(prev.completed_asset_count || 0), 1),
        } : prev);
        setSessions(prev => prev.map(session => session.id === activeSession.id ? {
          ...session,
          deliverable_status: 'complete',
          completed_asset_count: Math.max(Number(session.completed_asset_count || 0), 1),
        } : session));
      } catch (err) {
        console.error('deliverable launch-ready update failed', err);
      }
    }
    onNavigate?.('launcher');
  };

  const seekTo = (t) => {
    if (videoRef.current) {
      videoRef.current.currentTime = t;
      videoRef.current.play().catch(() => {});
    }
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 'calc(100vh - 60px)' }}>
      <aside style={sidebarStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#77746f' }}>Edit queue</span>
          <button onClick={newSession} style={ghostBtn}>+ New</button>
        </div>
        <div style={queueSummary}>
          <strong>{sessionStats.needs_edit}</strong>
          <span>creator uploads need editing</span>
          {sessionStats.overdue ? <small style={{ color: '#b42318' }}>{sessionStats.overdue} overdue</small> : null}
        </div>
        <div style={filterRow}>
          {SESSION_FILTERS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSessionFilter(key)}
              style={{
                ...filterBtn,
                ...(sessionFilter === key ? { background: '#171717', color: '#fff', borderColor: '#171717' } : {}),
              }}
            >
              {label}<i>{sessionStats[key] || 0}</i>
            </button>
          ))}
        </div>
        {sessionsLoading && <div style={{ color: '#88857f', fontSize: 12 }}>Loading…</div>}
        {!sessionsLoading && !sessions.length && (
          <div style={{ color: '#88857f', fontSize: 12 }}>No sessions yet. Upload a video to start.</div>
        )}
        {!sessionsLoading && sessions.length > 0 && !filteredSessions.length && (
          <div style={{ color: '#88857f', fontSize: 12 }}>No sessions match this view.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filteredSessions.map(s => (
            (() => {
              const due = dueStatus(s);
              return (
            <div
              key={s.id}
              onClick={() => loadSession(s.id)}
              style={{
                ...sessionCard,
                ...(activeSession?.id === s.id ? { borderColor: '#d84a17', background: '#fff0e9' } : {}),
              }}
            >
              <div style={{ fontSize: 12, color: '#171717', fontWeight: 600, wordBreak: 'break-all' }}>
                {sessionTitle(s)}
                {sessionContext(s) && <span style={{ display: 'block', color: '#b84418', fontSize: 8, marginTop: 3 }}>{sessionContext(s)}</span>}
              </div>
              <div style={{ fontSize: 10, color: '#77746f', marginTop: 4 }}>
                {s.file_size ? `${(s.file_size / 1024 / 1024).toFixed(1)} MB · ` : ''}
                {s.duration ? `${parseFloat(s.duration).toFixed(1)}s · ` : ''}
                {SOURCE_LABELS[s.source_type] || (s.creator_id ? 'Creator upload' : 'Manual upload')} ·
                {s.rendered_url ? 'rendered' : s.status}
              </div>
              {due && (
                <div style={{
                  ...duePill,
                  ...(due.overdue ? { background: 'rgba(180,35,24,.08)', color: '#b42318', borderColor: 'rgba(180,35,24,.25)' } : due.urgent ? { background: 'rgba(210,153,34,.09)', color: '#9a6a0a', borderColor: 'rgba(210,153,34,.25)' } : {}),
                }}>
                  {due.label} · {due.date.toLocaleDateString()}
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                style={{ ...ghostBtn, marginTop: 6, fontSize: 9, padding: '3px 6px', color: '#b42318', borderColor: 'rgba(248,81,73,0.3)' }}
              >
                Delete
              </button>
            </div>
              );
            })()
          ))}
        </div>
      </aside>

      <div style={{ padding: 24, maxWidth: 1100 }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>UGC Editor</h1>
        <p style={{ color: '#77746f', marginTop: 0, fontSize: 13 }}>
          Creator uploads land here automatically from assignment links. Cut silences and bad takes from the transcript, burn captions, render, then send the finished asset to launch.
        </p>
        <div style={editorStats}>
          <div><span>Needs edit</span><strong>{sessionStats.needs_edit}</strong></div>
          <div><span>Launch ready</span><strong>{sessionStats.launch_ready}</strong></div>
          <div><span>Needs transcript</span><strong>{sessionStats.untranscribed}</strong></div>
          <div><span>Rendered</span><strong>{sessionStats.rendered}</strong></div>
          <div><span>Total sessions</span><strong>{sessionStats.all}</strong></div>
        </div>

        {!videoUrl && stage !== 'uploading' && (
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            style={{ ...uploadBox, borderColor: dragOver ? '#d84a17' : '#dedbd3', background: dragOver ? '#fff0e9' : '#fff' }}
          >
            <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
            <div style={{ fontSize: 14 }}>Click or drag a video here (mp4, mov, webm)</div>
          </label>
        )}

        {stage === 'uploading' && (
          <div style={{ ...statusBox, marginTop: 16 }}>
            Uploading to Vercel Blob… {Math.round(uploadProgress * 100)}%
            <div style={{ height: 4, background: '#dedbd3', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress * 100}%`, height: '100%', background: '#d84a17' }} />
            </div>
          </div>
        )}

        {videoUrl && stage !== 'uploading' && (
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, marginTop: 16, alignItems: 'start' }}>
            <div style={{ position: 'sticky', top: 16 }}>
              <video ref={videoRef} src={videoUrl} controls crossOrigin="anonymous" style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 320 }} />
              <div style={{ fontSize: 12, color: '#77746f', marginTop: 6 }}>
                {activeSession?.creator_name && <strong style={{ display: 'block', color: '#171717', marginBottom: 3 }}>{activeSession.creator_name}</strong>}
                {!activeSession?.creator_name && activeSession?.source_label && <strong style={{ display: 'block', color: '#171717', marginBottom: 3 }}>{activeSession.source_label}</strong>}
                {activeSession?.deliverable_title && <span style={{ display: 'block', color: '#b84418', marginBottom: 3 }}>{activeSession.deliverable_title}</span>}
                {activeSession?.source_type && <span style={{ display: 'block', color: '#77746f', marginBottom: 3 }}>{SOURCE_LABELS[activeSession.source_type] || activeSession.source_type.replaceAll('_', ' ')}</span>}
                {activeSession?.file_name || file?.name}
                {activeSession?.file_size ? ` · ${(activeSession.file_size / 1024 / 1024).toFixed(1)} MB` : (file ? ` · ${(file.size / 1024 / 1024).toFixed(1)} MB` : '')}
              </div>
              {activeSession?.brief_title && (
                <div style={contextBox}>
                  <span>Brief</span>
                  <strong>{activeSession.brief_title}</strong>
                  <small>
                    {activeSession.deliverable_status || activeSession.status}
                    {dueStatus(activeSession) ? ` · ${dueStatus(activeSession).label}` : ''}
                  </small>
                </div>
              )}
              {activeSession?.settings?.creator_notes && (
                <div style={contextBox}>
                  <span>Creator notes</span>
                  <p style={{ margin: '6px 0 0', color: '#343330', fontSize: 11, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {activeSession.settings.creator_notes}
                  </p>
                </div>
              )}
              {stage === 'done' && outputUrl && activeSession?.creator_id && activeSession?.deliverable_id && !['complete', 'launched'].includes(activeSession?.deliverable_status) && (
                <div style={launchReadyBox}>
                  <span>Launch handoff</span>
                  <strong>Rendered and ready for Launcher</strong>
                  <p>Send this edit to Launcher to mark the deliverable complete and carry creator, brief, and source attribution into Meta.</p>
                </div>
              )}

              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(stage === 'uploaded' || stage === 'idle') && activeSession && (
                  <button onClick={transcribe} style={primaryBtn}>Transcribe</button>
                )}
                {stage === 'transcribing' && (
                  <div style={statusBox}>Extracting audio + transcribing on the server…</div>
                )}

                {(stage === 'ready' || stage === 'done' || stage === 'rendering') && (
                  <>
                    <label style={checkboxRow}>
                      <input type="checkbox" checked={settings.autoCutSilences} onChange={(e) => updateSetting('autoCutSilences', e.target.checked)} />
                      Auto-cut silences {`>`} {SILENCE_THRESHOLD_S}s
                    </label>
                    <label style={checkboxRow}>
                      <input type="checkbox" checked={settings.burnCaptions} onChange={(e) => updateSetting('burnCaptions', e.target.checked)} />
                      Burn captions
                    </label>

                    <div style={{ fontSize: 12, color: '#77746f' }}>
                      {duration ? `${duration.toFixed(1)}s raw · ${keptDuration.toFixed(1)}s kept · ${cutDuration.toFixed(1)}s removed` : null}
                    </div>

                    {stage !== 'rendering' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          onClick={render}
                          style={primaryBtn}
                          disabled={!segments.length}
                          title={!segments.length ? 'Transcribe the asset before rendering an edited cut.' : ''}
                        >
                          {stage === 'done' ? 'Re-render' : 'Render'}
                        </button>
                        <button
                          onClick={suggestCleanup}
                          style={secondaryBtn}
                          disabled={aiCleaning || !words.length}
                          title={!words.length ? 'Transcribe the asset before using AI cleanup.' : ''}
                        >
                          {aiCleaning ? 'Reviewing...' : 'AI cleanup'}
                        </button>
                        <button onClick={resetWords} style={secondaryBtn}>Reset cuts</button>
                      </div>
                    )}
                    {aiCleanupMessage && (
                      <div style={{ fontSize: 11, color: '#343330', lineHeight: 1.5 }}>
                        {aiCleanupMessage}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#77746f' }}>
                      Rendering uses the saved source and keeps the finished edit available after reload.
                    </div>
                    {stage === 'rendering' && (
                      <div style={statusBox}>
                        Rendering… {Math.round(progress * 100)}%
                        <div style={{ fontSize: 10, color: '#88857f', marginTop: 4, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {logTail}
                        </div>
                      </div>
                    )}

                    {stage === 'done' && outputUrl && (
                      <>
                        <video src={outputUrl} controls style={{ width: '100%', borderRadius: 8, background: '#000', marginTop: 8 }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={download} style={primaryBtn}>Download</button>
                          {onAddToCart && <button onClick={sendToCart} style={secondaryBtn}>Send to Launcher</button>}
                        </div>
                      </>
                    )}
                  </>
                )}

                {error && <div style={{ color: '#b42318', fontSize: 13 }}>{error}</div>}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#88857f', marginBottom: 8, letterSpacing: 1 }}>
                Transcript {words.length ? `· click words to cut` : ''}
              </div>
              <div style={transcriptBox}>
                {!words.length && <div style={{ color: '#88857f', fontSize: 13 }}>Transcript will appear here.</div>}
                {words.map((w, i) => (
                  <span
                    key={i}
                    onClick={() => toggleWord(i)}
                    onDoubleClick={() => seekTo(w.start)}
                    style={{
                      cursor: 'pointer',
                      padding: '1px 4px',
                      borderRadius: 3,
                      color: w.kept ? '#171717' : '#88857f',
                      textDecoration: w.kept ? 'none' : 'line-through',
                      background: w.kept ? 'transparent' : '#1f2630',
                      flex: '0 0 auto',
                    }}
                    title={`${w.start.toFixed(2)}s · double-click to seek`}
                  >
                    {w.word}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildSegments(words, duration, autoCutSilences) {
  if (!words.length) return [];
  const segs = [];
  const PAD = 0.05;
  let cur = null;
  for (const w of words) {
    if (!w.kept) { if (cur) { segs.push(cur); cur = null; } continue; }
    if (!cur) {
      cur = { start: Math.max(0, w.start - PAD), end: w.end + PAD };
    } else {
      const gap = w.start - cur.end;
      if (autoCutSilences && gap > SILENCE_THRESHOLD_S) {
        segs.push(cur);
        cur = { start: Math.max(0, w.start - PAD), end: w.end + PAD };
      } else {
        cur.end = w.end + PAD;
      }
    }
  }
  if (cur) segs.push(cur);
  return segs.map(s => ({ start: s.start, end: Math.min(duration || s.end, s.end) }));
}

function remapWordsToOutput(keptWords, segments) {
  const out = [];
  let offset = 0;
  for (const seg of segments) {
    const inSeg = keptWords.filter(w => w.start >= seg.start - 0.1 && w.end <= seg.end + 0.1);
    for (const w of inSeg) {
      out.push({
        word: w.word,
        start: Math.max(0, (w.start - seg.start) + offset),
        end: Math.max(0, (w.end - seg.start) + offset),
      });
    }
    offset += (seg.end - seg.start);
  }
  return out;
}

const sidebarStyle = {
  borderRight: '1px solid #dedbd3', background: '#fff', padding: 16, overflowY: 'auto',
  maxHeight: 'calc(100vh - 60px)',
};
const queueSummary = {
  display: 'grid', gap: 2, padding: 12, marginBottom: 10, background: '#faf9f6',
  border: '1px solid #ebe8e1', borderRadius: 8,
};
const filterRow = {
  display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12,
};
const filterBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 8px',
  background: '#fff', border: '1px solid #dedbd3', borderRadius: 999,
  color: '#6f6d68', cursor: 'pointer', fontSize: 9, fontWeight: 700,
};
const editorStats = {
  display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8,
  margin: '18px 0 8px',
};
const contextBox = {
  display: 'grid', gap: 4, marginTop: 10, padding: 10, background: '#fff',
  border: '1px solid #dedbd3', borderRadius: 8, fontSize: 11, color: '#6f6d68',
};
const sessionCard = {
  border: '1px solid #dedbd3', borderRadius: 6, padding: 10, cursor: 'pointer',
  background: '#fff',
};
const duePill = {
  display: 'inline-block', marginTop: 7, padding: '4px 7px', border: '1px solid #dedbd3',
  borderRadius: 999, background: '#faf9f6', color: '#6f6d68', fontSize: 9, fontWeight: 700,
};
const launchReadyBox = {
  display: 'grid', gap: 4, marginTop: 10, padding: 10, background: 'rgba(63,185,80,.07)',
  border: '1px solid rgba(63,185,80,.28)', borderRadius: 8, color: '#256b35',
};
const uploadBox = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 200, border: '2px dashed #dedbd3', borderRadius: 8, cursor: 'pointer',
  color: '#77746f', marginTop: 16, background: '#fff',
};
const primaryBtn = {
  background: '#d84a17', color: '#fff', border: 0, padding: '10px 16px',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const secondaryBtn = {
  background: 'transparent', color: '#171717', border: '1px solid #dedbd3',
  padding: '10px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
};
const ghostBtn = {
  background: 'transparent', color: '#77746f', border: '1px solid #dedbd3',
  padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
};
const checkboxRow = { fontSize: 13, color: '#171717', display: 'flex', gap: 8, alignItems: 'center' };
const statusBox = {
  background: '#fff', border: '1px solid #dedbd3', borderRadius: 6,
  padding: 12, fontSize: 13, color: '#171717',
};
const transcriptBox = {
  background: '#fff', border: '1px solid #dedbd3', borderRadius: 8,
  padding: 14, fontSize: 14, lineHeight: 1.8, height: 460, overflowY: 'auto',
  display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: '2px 6px',
  wordBreak: 'break-word',
};
