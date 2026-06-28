import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import { useAuth } from '@clerk/clerk-react';
import { Player } from '@remotion/player';
import { buildSrtFromWords } from '../utils/ffmpegClient';
import { UgcVideo, calcDurationInFrames } from '../remotion/UgcVideo';

const SILENCE_THRESHOLD_S = 0.6;
const AUTOSAVE_DEBOUNCE_MS = 1200;

const DEFAULT_SETTINGS = {
  burnCaptions: true,
  autoCutSilences: true,
  captionStyle: 'pop',
  showIntro: true,
  showOutro: true,
  variantIntent: 'direct_response',
  introTitle: 'HOWL',
  introSubtitle: "World's hottest smokeless fire pit",
  outroHeadline: 'Feel the heat.',
  outroCta: 'howlcampfires.com',
};

const WORKFLOW_STEPS = [
  ['uploaded', 'Source'],
  ['transcribing', 'Transcript'],
  ['ready', 'Edit'],
  ['rendering', 'Render'],
  ['done', 'Launch'],
];

const CAPTION_STYLES = [
  ['pop', 'Kinetic pop'],
  ['clean', 'Clean proof'],
  ['raw', 'Raw creator'],
];

const VARIANT_INTENTS = [
  ['direct_response', 'Direct response'],
  ['testimonial', 'Testimonial'],
  ['demo', 'Product demo'],
  ['problem_solution', 'Problem/solution'],
];

const PLAYBACK_ERROR = 'The browser could not play this source. Try reloading the session; if it still fails, re-upload as MP4/MOV so the server can proxy it.';

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
  const [uploadMessage, setUploadMessage] = useState('');
  const [pendingUpload, setPendingUpload] = useState(null);
  const [error, setError] = useState('');
  const [words, setWords] = useState([]);
  const [duration, setDuration] = useState(0);
  const [outputUrl, setOutputUrl] = useState(null);
  const [playbackToken, setPlaybackToken] = useState('');
  const [logTail, setLogTail] = useState('');
  const [aiCleaning, setAiCleaning] = useState(false);
  const [autoEditing, setAutoEditing] = useState(false);
  const [aiCleanupMessage, setAiCleanupMessage] = useState('');
  const [polishedRenderMessage, setPolishedRenderMessage] = useState('');
  const [remotionStatus, setRemotionStatus] = useState({ loading: true, configured: false, missing: [] });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [sessionFilter, setSessionFilter] = useState('needs_edit');
  const videoRef = useRef(null);
  const autosaveTimer = useRef(null);
  const dirtyRef = useRef(false);
  const initialSessionLoadRef = useRef(null);

  // ── Load session list on mount ─────────────────────────────────────────────
  useEffect(() => { refreshSessions(); }, []);
  useEffect(() => { refreshRemotionStatus(); }, []);

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

  async function refreshRemotionStatus() {
    setRemotionStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/remotion-config-status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check Lambda render setup');
      setRemotionStatus({
        loading: false,
        configured: Boolean(data.configured),
        missing: data.missing || [],
        region: data.region,
        functionName: data.function_name,
        serveUrl: data.serve_url,
      });
    } catch (err) {
      console.error('remotion status failed', err);
      setRemotionStatus({
        loading: false,
        configured: false,
        missing: [],
        error: err.message || 'Could not check Lambda render setup',
      });
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
  const playbackUrl = useMemo(() => {
    if (videoUrl?.startsWith('blob:')) return videoUrl;
    if (activeSession?.id && playbackToken) return `/api/ugc-source?id=${activeSession.id}&token=${encodeURIComponent(playbackToken)}`;
    if (activeSession?.id && playbackToken === '') return `/api/ugc-source?id=${activeSession.id}`;
    if (activeSession?.id) return '';
    return videoUrl;
  }, [activeSession?.id, playbackToken, videoUrl]);

  useEffect(() => {
    if (!activeSession?.id || videoUrl?.startsWith('blob:')) {
      setPlaybackToken('');
      return;
    }
    let active = true;
    setPlaybackToken(null);
    fetch(`/api/ugc-source-token?id=${activeSession.id}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not prepare source playback');
        if (active) setPlaybackToken(data.token || '');
      })
      .catch(err => {
        console.error('playback token failed', err);
        if (active) {
          setPlaybackToken('');
          setError(err.message || 'Could not prepare source playback');
        }
      });
    return () => { active = false; };
  }, [activeSession?.id, videoUrl]);

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
    setActiveSession(null);
    setStage('uploading');
    setUploadProgress(0);
    setUploadMessage('Preparing local preview...');
    setPendingUpload(null);

    if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
    const localPreviewUrl = URL.createObjectURL(f);
    setVideoUrl(localPreviewUrl);

    let uploadedBlobUrl = '';
    try {
      setUploadMessage('Uploading source to Blob...');
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
      uploadedBlobUrl = blob.url;
      setPendingUpload({
        video_url: blob.url,
        title: f.name,
        file_name: f.name,
        file_size: f.size,
      });

      setUploadMessage('Saving editor session...');
      await createUploadedSession({
        video_url: blob.url,
        title: f.name,
        file_name: f.name,
        file_size: f.size,
      });
      setStage('uploaded');
      setUploadMessage('');
      setPendingUpload(null);
    } catch (err) {
      console.error(err);
      setError(
        uploadedBlobUrl
          ? `${err.message || 'Upload failed'} The file is already in Blob; use Save session to attach it.`
          : (err.message || 'Upload failed'),
      );
      setStage(localPreviewUrl ? 'uploaded' : 'idle');
      setUploadMessage('');
    }
  };

  const createUploadedSession = async ({ video_url, title, file_name, file_size }) => {
    const sessRes = await fetch('/api/db/ugc-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        file_name,
        file_size,
        video_url,
        settings: DEFAULT_SETTINGS,
        status: 'uploaded',
        source_type: 'internal_employee',
        source_label: 'Manual editor upload',
      }),
    });
    const sessData = await sessRes.json().catch(() => ({}));
    if (!sessRes.ok) {
      throw new Error(`Uploaded to Blob, but could not save the editor session: ${sessData.error || sessRes.status}`);
    }
    setActiveSession(sessData.session);
    setSessions(prev => [sessData.session, ...prev.filter(session => session.id !== sessData.session.id)]);
    return sessData.session;
  };

  const retrySaveSession = async () => {
    if (!pendingUpload) return;
    setError('');
    setUploadMessage('Saving editor session...');
    try {
      await createUploadedSession(pendingUpload);
      setPendingUpload(null);
      setStage('uploaded');
      setUploadMessage('');
    } catch (err) {
      setError(err.message || 'Could not save editor session');
      setUploadMessage('');
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
      const { words: ws, duration: nextDuration } = await transcribeSession(activeSession.id);
      setWords(ws);
      setDuration(nextDuration);
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
      const data = await requestCleanup(activeSession.id);
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
      const data = await renderSession(activeSession.id, segments, captionsSrt);
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

  const renderPolishedAd = async () => {
    if (!segments.length || !activeSession) return;
    setStage('rendering');
    setProgress(0);
    setError('');
    setOutputUrl(null);
    setPolishedRenderMessage('');
    setLogTail('Starting Remotion Lambda render...');
    try {
      const start = await startRemotionRender({
        sessionId: activeSession.id,
        segments,
        words,
        settings,
      });
      setPolishedRenderMessage(`Remotion render started: ${start.render_id}`);
      for (let attempt = 0; attempt < 120; attempt++) {
        await delay(3000);
        const status = await getRemotionRenderStatus({
          sessionId: activeSession.id,
          renderId: start.render_id,
          bucketName: start.bucket_name,
          functionName: start.function_name,
          region: start.region,
        });
        setProgress(status.progress || 0);
        setLogTail(status.costs?.displayCost ? `Rendering on Lambda · ${status.costs.displayCost}` : 'Rendering on Lambda...');
        if (status.done && status.output_file) {
          const url = status.output_file;
          setOutputUrl(url);
          setActiveSession(prev => prev ? {
            ...prev,
            rendered_url: url,
            status: 'rendered',
          } : prev);
          setSessions(prev => prev.map(session => session.id === activeSession.id ? {
            ...session,
            rendered_url: url,
            status: 'rendered',
          } : session));
          setProgress(1);
          setStage('done');
          setPolishedRenderMessage('Polished Remotion ad rendered.');
          refreshSessions();
          return;
        }
      }
      setStage('ready');
      setPolishedRenderMessage('Render is still running. Try the polished render status again in a moment.');
    } catch (err) {
      console.error(err);
      if (err.setupRequired) {
        setPolishedRenderMessage(err.message);
      } else {
        setError(err.message || 'Polished Remotion render failed');
      }
      setStage(words.length ? 'ready' : 'uploaded');
    }
  };

  const autoEdit = async () => {
    if (!activeSession) return;
    setAutoEditing(true);
    setError('');
    setOutputUrl(null);
    try {
      let nextWords = words;
      let nextDuration = duration;
      if (!nextWords.length) {
        setStage('transcribing');
        setLogTail('Extracting audio and building word-level captions...');
        const transcript = await transcribeSession(activeSession.id);
        nextWords = transcript.words;
        nextDuration = transcript.duration;
        setWords(nextWords);
        setDuration(nextDuration);
      }

      setStage('ready');
      setLogTail('Finding filler, false starts, and long pauses...');
      const cleanup = await requestCleanup(activeSession.id).catch(err => {
        setAiCleanupMessage(`AI cleanup skipped: ${err.message || 'not available'}`);
        return null;
      });
      if (cleanup?.remove_indexes?.length) {
        const remove = new Set(cleanup.remove_indexes);
        nextWords = nextWords.map((word, index) => remove.has(index) ? { ...word, kept: false } : word);
        setWords(nextWords);
        setAiCleanupMessage(`${remove.size} word${remove.size === 1 ? '' : 's'} cut automatically. Review the crossed-out transcript before launch.`);
      } else if (cleanup) {
        setAiCleanupMessage(cleanup.summary || 'No safe cleanup cuts found.');
      }

      const nextSegments = buildSegments(nextWords, nextDuration, settings.autoCutSilences);
      if (!nextSegments.length) throw new Error('No editable segments found after transcription');
      setStage('rendering');
      setLogTail('Rendering captions and cuts on the server...');
      const nextKeptWords = nextWords.filter(word => word.kept);
      const captionsSrt = settings.burnCaptions
        ? buildSrtFromWords(remapWordsToOutput(nextKeptWords, nextSegments))
        : null;
      const data = await renderSession(activeSession.id, nextSegments, captionsSrt);
      setOutputUrl(data.url);
      setActiveSession(prev => prev ? { ...prev, rendered_url: data.url, status: 'rendered' } : prev);
      setSessions(prev => prev.map(session => session.id === activeSession.id ? { ...session, rendered_url: data.url, status: 'rendered' } : session));
      setProgress(1);
      setStage('done');
      refreshSessions();
    } catch (err) {
      console.error(err);
      setError(err.message || 'Auto edit failed');
      setStage(words.length ? 'ready' : 'uploaded');
    } finally {
      setAutoEditing(false);
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

  const activeStepIndex = stage === 'idle'
    ? 0
    : WORKFLOW_STEPS.findIndex(([key]) => key === stage);
  const stepIndex = Math.max(0, activeStepIndex);
  const remotionDuration = useMemo(() => (
    segments.length
      ? calcDurationInFrames({
          segments,
          fps: 30,
          showIntro: settings.showIntro,
          showOutro: settings.showOutro,
        })
      : 120
  ), [segments, settings.showIntro, settings.showOutro]);
  const remotionInput = useMemo(() => ({
    videoSrc: playbackUrl || videoUrl || '',
    segments,
    words: keptWords,
    showCaptions: settings.burnCaptions,
    captionStyle: settings.captionStyle || 'pop',
    showIntro: settings.showIntro,
    showOutro: settings.showOutro,
    intro: {
      title: settings.introTitle || 'HOWL',
      subtitle: settings.introSubtitle || "World's hottest smokeless fire pit",
    },
    outro: {
      headline: settings.outroHeadline || 'Feel the heat.',
      cta: settings.outroCta || 'howlcampfires.com',
    },
  }), [playbackUrl, videoUrl, segments, keptWords, settings]);
  const cutPercent = duration ? Math.max(0, Math.min(100, (cutDuration / duration) * 100)) : 0;
  const keepPercent = duration ? Math.max(0, Math.min(100, (keptDuration / duration) * 100)) : 0;
  const firstHook = keptWords.slice(0, 9).map(word => word.word).join(' ');

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={shellStyle}>
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
                ...(activeSession?.id === s.id ? { borderColor: '#ff6a2a', background: '#21140e' } : {}),
              }}
            >
              <div style={{ fontSize: 12, color: '#f7efe2', fontWeight: 600, wordBreak: 'break-all' }}>
                {sessionTitle(s)}
                {sessionContext(s) && <span style={{ display: 'block', color: '#b84418', fontSize: 8, marginTop: 3 }}>{sessionContext(s)}</span>}
              </div>
              <div style={{ fontSize: 10, color: '#aaa29a', marginTop: 4 }}>
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

      <main style={mainStyle}>
        <section style={heroPanel}>
          <div>
            <span style={eyebrow}>HOWL edit desk</span>
            <h1 style={heroTitle}>UGC Editor</h1>
            <p style={heroCopy}>
              Turn raw creator footage into launch-ready cuts: transcript cleanup, silence removal, caption styling, and ad variants from one source clip.
            </p>
          </div>
          <div style={editorStats}>
            <div style={statCard}><span>Needs edit</span><strong>{sessionStats.needs_edit}</strong></div>
            <div style={statCard}><span>Launch ready</span><strong>{sessionStats.launch_ready}</strong></div>
            <div style={statCard}><span>Transcript</span><strong>{sessionStats.untranscribed}</strong></div>
            <div style={statCard}><span>Rendered</span><strong>{sessionStats.rendered}</strong></div>
          </div>
        </section>

        {!videoUrl && stage !== 'uploading' && (
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            style={{ ...uploadBox, borderColor: dragOver ? '#ff6a2a' : 'rgba(255,255,255,.18)', background: dragOver ? 'rgba(255,106,42,.12)' : '#101010' }}
          >
            <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
            <div>
              <strong>Drop creator footage</strong>
              <span>MP4, MOV, or WebM. We’ll store the source, transcribe it, and build an editable ad recipe.</span>
            </div>
          </label>
        )}

        {stage === 'uploading' && (
          <div style={{ ...statusBox, marginTop: 16 }}>
            {uploadMessage || 'Uploading to Vercel Blob...'} {Math.round(uploadProgress * 100)}%
            <div style={{ height: 4, background: '#dedbd3', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress * 100}%`, height: '100%', background: '#d84a17' }} />
            </div>
          </div>
        )}

        {videoUrl && (
          <div style={editorGrid}>
            <section style={sourcePanel}>
              <div style={panelHead}>
                <div>
                  <span style={eyebrow}>Source monitor</span>
                  <strong>{activeSession?.creator_name || activeSession?.source_label || 'Manual upload'}</strong>
                </div>
                <span style={statusPill}>{stage.replaceAll('_', ' ')}</span>
              </div>
              <video
                ref={videoRef}
                src={playbackUrl}
                controls
                playsInline
                preload="metadata"
                style={videoStyle}
                onLoadedMetadata={(event) => {
                  const nextDuration = event.currentTarget.duration;
                  if (Number.isFinite(nextDuration) && nextDuration > 0 && !duration) setDuration(nextDuration);
                }}
                onError={() => setError(PLAYBACK_ERROR)}
              />
              <div style={sourceMeta}>
                <strong>{activeSession?.deliverable_title || activeSession?.file_name || file?.name}</strong>
                <span>
                  {activeSession?.file_size ? `${(activeSession.file_size / 1024 / 1024).toFixed(1)} MB` : file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Stored source'}
                  {activeSession?.source_type ? ` · ${SOURCE_LABELS[activeSession.source_type] || activeSession.source_type.replaceAll('_', ' ')}` : ''}
                </span>
              </div>
              {activeSession?.brief_title && (
                <div style={contextBox}>
                  <span>Brief</span>
                  <strong>{activeSession.brief_title}</strong>
                  <small>{activeSession.deliverable_status || activeSession.status}{dueStatus(activeSession) ? ` · ${dueStatus(activeSession).label}` : ''}</small>
                </div>
              )}
              {error && <div style={errorBox}>{error}</div>}
            </section>

            <section style={workPanel}>
              <div style={workflowRail}>
                {WORKFLOW_STEPS.map(([key, label], index) => (
                  <div key={key} style={{ ...workflowStep, ...(index <= stepIndex ? workflowStepActive : {}) }}>
                    <i>{index + 1}</i>
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              <div style={timelineCard}>
                <div style={panelHead}>
                  <div>
                    <span style={eyebrow}>Cut map</span>
                    <strong>{duration ? `${duration.toFixed(1)}s raw · ${keptDuration.toFixed(1)}s kept` : 'Waiting for transcript'}</strong>
                  </div>
                  <span style={statusPill}>{Math.round(cutPercent)}% removed</span>
                </div>
                <div style={timelineTrack}>
                  {segments.length ? segments.map((segment, index) => {
                    const left = duration ? (segment.start / duration) * 100 : 0;
                    const width = duration ? ((segment.end - segment.start) / duration) * 100 : 0;
                    return (
                      <button
                        key={`${segment.start}-${segment.end}-${index}`}
                        onClick={() => seekTo(segment.start)}
                        style={{ ...timelineSegment, left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                        title={`${segment.start.toFixed(1)}s-${segment.end.toFixed(1)}s`}
                      />
                    );
                  }) : <span style={timelineEmpty}>Transcribe to build the cut map</span>}
                </div>
                <div style={metricGrid}>
                  <div style={metricCard}><span>Segments</span><strong>{segments.length}</strong></div>
                  <div style={metricCard}><span>Words kept</span><strong>{words.length ? `${keptWords.length}/${words.length}` : '-'}</strong></div>
                  <div style={metricCard}><span>Cut time</span><strong>{duration ? `${cutDuration.toFixed(1)}s` : '-'}</strong></div>
                  <div style={metricCard}><span>Keep rate</span><strong>{duration ? `${Math.round(keepPercent)}%` : '-'}</strong></div>
                </div>
              </div>

              <div style={transcriptPanel}>
                <div style={panelHead}>
                  <div>
                    <span style={eyebrow}>Transcript editor</span>
                    <strong>{words.length ? 'Click words to cut, double-click to seek' : 'Transcript will appear here'}</strong>
                  </div>
                  {firstHook ? <span style={hookPill}>{firstHook}</span> : null}
                </div>
                <div style={transcriptBox}>
                  {!words.length && <div style={{ color: '#aaa29a', fontSize: 13 }}>Use Transcribe or Auto edit to generate word-level cuts.</div>}
                  {words.map((w, i) => (
                    <span
                      key={i}
                      onClick={() => toggleWord(i)}
                      onDoubleClick={() => seekTo(w.start)}
                      style={{
                        cursor: 'pointer',
                        padding: '2px 5px',
                        borderRadius: 4,
                        color: w.kept ? '#f7efe2' : '#766d63',
                        textDecoration: w.kept ? 'none' : 'line-through',
                        background: w.kept ? 'rgba(255,255,255,.06)' : 'rgba(255,106,42,.16)',
                        flex: '0 0 auto',
                      }}
                      title={`${w.start.toFixed(2)}s · double-click to seek`}
                    >
                      {w.word}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            <aside style={recipePanel}>
              <div style={panelHead}>
                <div>
                  <span style={eyebrow}>Preview recipe</span>
                  <strong>Caption and card controls</strong>
                </div>
              </div>

              <div style={actionStack}>
                {!activeSession && pendingUpload && (
                  <>
                    <button onClick={retrySaveSession} style={primaryBtn}>Save session</button>
                    <div style={setupNote}>The file uploaded to Blob, but the editor session was not saved. Save session attaches this video to the queue without another upload.</div>
                  </>
                )}
                {(stage === 'uploaded' || stage === 'idle') && activeSession && (
                  <>
                    <button onClick={autoEdit} style={primaryBtn} disabled={autoEditing}>Auto edit full ad</button>
                    <button onClick={transcribe} style={secondaryBtn}>Transcribe only</button>
                  </>
                )}
                {(stage === 'ready' || stage === 'done' || stage === 'rendering') && (
                  <>
                    <button onClick={render} style={primaryBtn} disabled={!segments.length || stage === 'rendering'}>
                      {stage === 'done' ? 'Render again' : 'Render cut'}
                    </button>
                    {remotionStatus.configured && (
                      <button onClick={renderPolishedAd} style={secondaryBtn} disabled={!segments.length || stage === 'rendering' || !activeSession}>
                        Render polished ad
                      </button>
                    )}
                    <button onClick={autoEdit} style={secondaryBtn} disabled={autoEditing || !activeSession}>
                      {autoEditing ? 'Auto editing...' : 'Auto edit full ad'}
                    </button>
                    <button onClick={suggestCleanup} style={secondaryBtn} disabled={aiCleaning || !words.length}>
                      {aiCleaning ? 'Reviewing...' : 'AI cleanup'}
                    </button>
                    <button onClick={resetWords} style={secondaryBtn}>Reset cuts</button>
                  </>
                )}
              </div>

              <div style={controlGroup}>
                <label style={checkboxRow}>
                  <input type="checkbox" checked={settings.autoCutSilences} onChange={(e) => updateSetting('autoCutSilences', e.target.checked)} />
                  Auto-cut silence over {SILENCE_THRESHOLD_S}s
                </label>
                <label style={checkboxRow}>
                  <input type="checkbox" checked={settings.burnCaptions} onChange={(e) => updateSetting('burnCaptions', e.target.checked)} />
                  Captions on render
                </label>
                <label style={checkboxRow}>
                  <input type="checkbox" checked={settings.showIntro} onChange={(e) => updateSetting('showIntro', e.target.checked)} />
                  Preview intro card
                </label>
                <label style={checkboxRow}>
                  <input type="checkbox" checked={settings.showOutro} onChange={(e) => updateSetting('showOutro', e.target.checked)} />
                  Preview CTA outro card
                </label>
              </div>

              <label style={fieldLabel}>
                Variant angle
                <select value={settings.variantIntent || 'direct_response'} onChange={(e) => updateSetting('variantIntent', e.target.value)} style={selectStyle}>
                  {VARIANT_INTENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Caption style
                <select value={settings.captionStyle || 'pop'} onChange={(e) => updateSetting('captionStyle', e.target.value)} style={selectStyle}>
                  {CAPTION_STYLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Intro headline
                <input value={settings.introTitle || ''} onChange={(e) => updateSetting('introTitle', e.target.value)} style={inputStyle} />
              </label>
              <label style={fieldLabel}>
                Intro subhead
                <input value={settings.introSubtitle || ''} onChange={(e) => updateSetting('introSubtitle', e.target.value)} style={inputStyle} />
              </label>
              <label style={fieldLabel}>
                Outro headline
                <input value={settings.outroHeadline || ''} onChange={(e) => updateSetting('outroHeadline', e.target.value)} style={inputStyle} />
              </label>
              <label style={fieldLabel}>
                CTA
                <input value={settings.outroCta || ''} onChange={(e) => updateSetting('outroCta', e.target.value)} style={inputStyle} />
              </label>

              {aiCleanupMessage && <div style={statusBox}>{aiCleanupMessage}</div>}
              {polishedRenderMessage && <div style={statusBox}>{polishedRenderMessage}</div>}
              <div style={setupNote}>
                {remotionStatus.loading
                  ? 'Checking AWS Lambda render setup...'
                  : remotionStatus.configured
                    ? `Polished Remotion Lambda renders are connected in ${remotionStatus.region}. Use Render polished ad for branded intro/outro cards and motion captions.`
                    : remotionStatus.error
                      ? remotionStatus.error
                      : `Fast server render is available. Polished Remotion Lambda render needs setup: ${remotionStatus.missing.join(', ') || 'AWS env vars'}.`}
              </div>
              {stage === 'transcribing' && <div style={statusBox}>Extracting audio and building word-level captions...</div>}
              {stage === 'rendering' && (
                <div style={statusBox}>
                  Rendering... {Math.round(progress * 100)}%
                  <small>{logTail}</small>
                </div>
              )}
              {stage === 'done' && outputUrl && (
                <div style={outputPanel}>
                  <span style={eyebrow}>Finished render</span>
                  <video src={outputUrl} controls playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={download} style={primaryBtn}>Download</button>
                    {onAddToCart && <button onClick={sendToCart} style={secondaryBtn}>Send to Launcher</button>}
                  </div>
                </div>
              )}
            </aside>

            {segments.length && playbackUrl ? (
              <section style={remotionPanel}>
                <div style={panelHead}>
                  <div>
                    <span style={eyebrow}>Remotion ad preview</span>
                    <strong>{VARIANT_INTENTS.find(([value]) => value === settings.variantIntent)?.[1] || 'Ad variant'} · 9:16 composition</strong>
                  </div>
                  <span style={statusPill}>{Math.ceil(remotionDuration / 30)}s</span>
                </div>
                <div style={playerShell}>
                  <Player
                    component={UgcVideo}
                    inputProps={remotionInput}
                    durationInFrames={remotionDuration}
                    fps={30}
                    compositionWidth={1080}
                    compositionHeight={1920}
                    style={{ width: '100%', aspectRatio: '9 / 16', background: '#000' }}
                    controls
                  />
                </div>
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

async function transcribeSession(sessionId) {
  const r = await fetch('/api/transcribe-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Transcription failed');
  const ws = (data.words || []).map(w => ({
    word: w.word,
    start: w.start,
    end: w.end,
    kept: w.kept !== false,
  }));
  return { words: ws, duration: data.duration || (ws.length ? ws[ws.length - 1].end : 0) };
}

async function requestCleanup(sessionId) {
  const response = await fetch('/api/ugc-edit-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'AI cleanup failed');
  return data;
}

async function renderSession(sessionId, segments, captionsSrt) {
  const response = await fetch('/api/render-ugc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      segments,
      captions_srt: captionsSrt,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Server render failed');
  return data;
}

async function startRemotionRender({ sessionId, segments, words, settings }) {
  const response = await fetch('/api/render-ugc-remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      segments,
      words,
      settings,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Could not start Remotion render');
    error.setupRequired = Boolean(data.setup_required);
    throw error;
  }
  return data;
}

async function getRemotionRenderStatus({ sessionId, renderId, bucketName, functionName, region }) {
  const params = new URLSearchParams({
    session_id: String(sessionId),
    render_id: renderId,
    bucket_name: bucketName,
    function_name: functionName,
    region,
  });
  const response = await fetch(`/api/render-ugc-remotion-status?${params.toString()}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not fetch Remotion render status');
  return data;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

const shellStyle = {
  display: 'grid',
  gridTemplateColumns: '230px minmax(0, 1fr)',
  minHeight: 'calc(100vh - 60px)',
  background: '#0b0b0b',
  color: '#f7efe2',
  minWidth: 0,
  overflowX: 'hidden',
};
const mainStyle = {
  padding: 18,
  maxWidth: 'none',
  width: '100%',
  minWidth: 0,
  overflowX: 'hidden',
};
const heroPanel = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 460px)',
  gap: 18,
  alignItems: 'end',
  padding: 22,
  background: '#15120f',
  border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 8,
};
const eyebrow = {
  display: 'block',
  marginBottom: 7,
  color: '#ff6a2a',
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: 1.6,
  textTransform: 'uppercase',
};
const heroTitle = {
  margin: 0,
  font: "42px 'Instrument Serif', Georgia, serif",
  color: '#f7efe2',
};
const heroCopy = {
  maxWidth: 760,
  margin: '7px 0 0',
  color: '#aaa29a',
  fontSize: 13,
  lineHeight: 1.55,
};
const editorGrid = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 310px) minmax(0, 1fr)',
  gap: 14,
  marginTop: 14,
  alignItems: 'start',
  minWidth: 0,
};
const sourcePanel = {
  position: 'sticky',
  top: 14,
  display: 'grid',
  gap: 12,
  padding: 14,
  background: '#121212',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 8,
};
const videoStyle = {
  width: '100%',
  aspectRatio: '9 / 16',
  borderRadius: 8,
  background: '#050505',
  maxHeight: 520,
  objectFit: 'contain',
  boxShadow: '0 22px 58px rgba(0, 0, 0, .42)',
};
const actionStack = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 8,
};
const sidebarStyle = {
  borderRight: '1px solid rgba(255,255,255,.1)', background: '#0f0f0f', padding: 16, overflowY: 'auto',
  maxHeight: 'calc(100vh - 60px)',
};
const queueSummary = {
  display: 'grid', gap: 2, padding: 12, marginBottom: 10, background: '#17130f',
  border: '1px solid rgba(255,106,42,.25)', borderRadius: 8, color: '#f7efe2',
};
const filterRow = {
  display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12,
};
const filterBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 8px',
  background: '#151515', border: '1px solid rgba(255,255,255,.12)', borderRadius: 999,
  color: '#aaa29a', cursor: 'pointer', fontSize: 9, fontWeight: 700,
};
const editorStats = {
  display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8,
};
const statCard = {
  display: 'grid',
  gap: 4,
  padding: 11,
  borderRadius: 7,
  background: '#0f0f0f',
  border: '1px solid rgba(255,255,255,.09)',
  color: '#aaa29a',
  fontSize: 9,
  textTransform: 'uppercase',
};
const contextBox = {
  display: 'grid', gap: 4, padding: 10, background: '#191919',
  border: '1px solid rgba(255,255,255,.09)', borderRadius: 8, fontSize: 11, color: '#aaa29a',
};
const sessionCard = {
  border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, padding: 10, cursor: 'pointer',
  background: '#151515',
};
const duePill = {
  display: 'inline-block', marginTop: 7, padding: '4px 7px', border: '1px solid rgba(255,255,255,.12)',
  borderRadius: 999, background: '#101010', color: '#aaa29a', fontSize: 9, fontWeight: 700,
};
const launchReadyBox = {
  display: 'grid', gap: 4, marginTop: 10, padding: 10, background: 'rgba(63,185,80,.07)',
  border: '1px solid rgba(63,185,80,.28)', borderRadius: 8, color: '#256b35',
};
const uploadBox = {
  display: 'grid', placeItems: 'center',
  minHeight: 260, border: '1px dashed rgba(255,255,255,.18)', borderRadius: 8, cursor: 'pointer',
  color: '#aaa29a', marginTop: 16, background: '#101010', textAlign: 'center', padding: 24,
};
const primaryBtn = {
  background: '#ff5a1f', color: '#100b08', border: 0, padding: '10px 14px',
  borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 800,
};
const secondaryBtn = {
  background: '#191919', color: '#f7efe2', border: '1px solid rgba(255,255,255,.12)',
  padding: '10px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
};
const ghostBtn = {
  background: 'transparent', color: '#aaa29a', border: '1px solid rgba(255,255,255,.12)',
  padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
};
const checkboxRow = { fontSize: 12, color: '#f7efe2', display: 'flex', gap: 8, alignItems: 'center', lineHeight: 1.35 };
const statusBox = {
  display: 'grid', gap: 4, background: '#191919', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6,
  padding: 11, fontSize: 12, color: '#f7efe2',
};
const transcriptBox = {
  background: '#0f0f0f', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8,
  padding: 14, fontSize: 14, lineHeight: 1.9, minHeight: 290, maxHeight: 420, overflowY: 'auto',
  display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: '2px 6px',
  wordBreak: 'break-word',
};
const panelHead = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
};
const statusPill = {
  padding: '5px 8px',
  borderRadius: 999,
  background: 'rgba(255,106,42,.13)',
  border: '1px solid rgba(255,106,42,.3)',
  color: '#ff8a4d',
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
};
const sourceMeta = {
  display: 'grid',
  gap: 4,
  color: '#aaa29a',
  fontSize: 11,
};
const errorBox = {
  padding: 11,
  borderRadius: 6,
  background: 'rgba(180,35,24,.12)',
  border: '1px solid rgba(180,35,24,.35)',
  color: '#ff9b90',
  fontSize: 12,
  lineHeight: 1.45,
};
const workPanel = {
  display: 'grid',
  gap: 12,
};
const recipePanel = {
  gridColumn: '1 / -1',
  display: 'grid',
  gridTemplateColumns: '220px minmax(180px, 260px) repeat(4, minmax(150px, 1fr))',
  gap: 12,
  padding: 14,
  background: '#121212',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 8,
  alignItems: 'start',
  minWidth: 0,
};
const workflowRail = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 6,
};
const workflowStep = {
  display: 'grid',
  gap: 5,
  padding: 9,
  borderRadius: 6,
  background: '#141414',
  border: '1px solid rgba(255,255,255,.08)',
  color: '#736c64',
  fontSize: 10,
  textTransform: 'uppercase',
};
const workflowStepActive = {
  color: '#f7efe2',
  borderColor: 'rgba(255,106,42,.35)',
  background: 'linear-gradient(180deg, rgba(255,106,42,.16), #161311)',
};
const timelineCard = {
  display: 'grid',
  gap: 12,
  padding: 14,
  background: '#121212',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 8,
};
const timelineTrack = {
  position: 'relative',
  height: 48,
  overflow: 'hidden',
  borderRadius: 6,
  background: 'repeating-linear-gradient(90deg, #1c1c1c 0, #1c1c1c 18px, #171717 18px, #171717 36px)',
  border: '1px solid rgba(255,255,255,.08)',
};
const timelineSegment = {
  position: 'absolute',
  top: 7,
  bottom: 7,
  border: 0,
  borderRadius: 5,
  background: '#ff5a1f',
  cursor: 'pointer',
  boxShadow: '0 0 18px rgba(255,90,31,.35)',
};
const timelineEmpty = {
  display: 'grid',
  placeItems: 'center',
  height: '100%',
  color: '#736c64',
  fontSize: 12,
};
const metricGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 8,
};
const metricCard = {
  display: 'grid',
  gap: 3,
  padding: 9,
  borderRadius: 6,
  background: '#0f0f0f',
  border: '1px solid rgba(255,255,255,.08)',
  color: '#aaa29a',
  fontSize: 9,
  textTransform: 'uppercase',
};
const transcriptPanel = {
  display: 'grid',
  gap: 10,
  padding: 14,
  background: '#121212',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 8,
};
const hookPill = {
  maxWidth: 240,
  padding: '6px 8px',
  borderRadius: 6,
  background: '#1f1712',
  color: '#ffbd9a',
  fontSize: 10,
  lineHeight: 1.3,
};
const controlGroup = {
  display: 'grid',
  gap: 8,
  padding: 10,
  borderRadius: 7,
  background: '#0f0f0f',
  border: '1px solid rgba(255,255,255,.08)',
};
const fieldLabel = {
  display: 'grid',
  gap: 6,
  color: '#aaa29a',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: 'uppercase',
  minWidth: 0,
};
const selectStyle = {
  width: '100%',
  padding: '9px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,.13)',
  background: '#181818',
  color: '#f7efe2',
};
const inputStyle = {
  width: '100%',
  padding: '9px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,.13)',
  background: '#181818',
  color: '#f7efe2',
};
const outputPanel = {
  gridColumn: '1 / -1',
  display: 'grid',
  gap: 8,
  padding: 10,
  borderRadius: 7,
  background: '#0f0f0f',
  border: '1px solid rgba(63,185,80,.22)',
};
const remotionPanel = {
  gridColumn: '1 / -1',
  display: 'grid',
  gap: 12,
  padding: 14,
  background: '#121212',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 8,
};
const playerShell = {
  width: 220,
  maxWidth: '100%',
  overflow: 'hidden',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.12)',
  background: '#000',
};
const setupNote = {
  gridColumn: '1 / -1',
  padding: 10,
  borderRadius: 7,
  background: 'rgba(255,106,42,.08)',
  border: '1px solid rgba(255,106,42,.18)',
  color: '#ffbd9a',
  fontSize: 11,
  lineHeight: 1.45,
};
