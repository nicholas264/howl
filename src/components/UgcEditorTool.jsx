import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Player } from '@remotion/player';
import { upload } from '@vercel/blob/client';
import { useAuth } from '@clerk/clerk-react';
import { renderCuts, buildSrtFromWords } from '../utils/ffmpegClient';
import { UgcVideo, calcDurationInFrames } from '../remotion/UgcVideo';

const SILENCE_THRESHOLD_S = 0.6;
const AUTOSAVE_DEBOUNCE_MS = 1200;

const DEFAULT_SETTINGS = {
  burnCaptions: true,
  autoCutSilences: true,
  remotionMode: false,
  showIntro: true,
  showOutro: true,
  introTitle: 'HOWL',
  introSubtitle: "World's hottest fire pit",
  outroHeadline: 'Get yours.',
  outroCta: 'howlcampfires.com',
};

export default function UgcEditorTool({ onAddToCart }) {
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
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const videoRef = useRef(null);
  const autosaveTimer = useRef(null);
  const dirtyRef = useRef(false);

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
        body: JSON.stringify({ videoUrl: activeSession.video_url, sessionId: activeSession.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Transcription failed');
      const ws = (data.words || []).map(w => ({
        word: w.word,
        start: w.start,
        end: w.end,
        kept: true,
      }));
      setWords(applyAutoSilence(ws, settings.autoCutSilences));
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
      setOutputUrl(null);
      setStage(sess.words?.length ? 'ready' : (sess.audio_url ? 'uploaded' : 'uploaded'));
      dirtyRef.current = false;
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load session');
    }
  }, [videoUrl]);

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
    setWords(prev => applyAutoSilence(prev.map(w => ({ ...w, kept: true })), settings.autoCutSilences));
    markDirty();
  };

  useEffect(() => {
    if (!words.length) return;
    setWords(prev => applyAutoSilence(prev, settings.autoCutSilences));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoCutSilences]);

  const segments = useMemo(() => buildSegments(words, duration), [words, duration]);
  const keptDuration = segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
  const cutDuration = duration - keptDuration;

  const REMOTION_FPS = 30;
  const keptWords = useMemo(() => words.filter(w => w.kept), [words]);
  const remotionDuration = useMemo(
    () => calcDurationInFrames({ segments, fps: REMOTION_FPS, showIntro: settings.showIntro, showOutro: settings.showOutro }),
    [segments, settings.showIntro, settings.showOutro],
  );
  const remotionInputProps = useMemo(() => ({
    videoSrc: videoUrl,
    segments,
    words: keptWords,
    showCaptions: settings.burnCaptions,
    showIntro: settings.showIntro,
    showOutro: settings.showOutro,
    intro: { title: settings.introTitle, subtitle: settings.introSubtitle },
    outro: { headline: settings.outroHeadline, cta: settings.outroCta },
  }), [videoUrl, segments, keptWords, settings]);

  // ── Render (in-browser, only when local File is still in memory) ──────────
  const canRenderLocally = !!file;

  const render = async () => {
    if (!file || !segments.length) return;
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
      const blob = await renderCuts(file, segments, {
        captionsSrt,
        onProgress: setProgress,
        onLog: (msg) => setLogTail(msg),
      });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
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
    const blob = await fetch(outputUrl).then(r => r.blob());
    const reader = new FileReader();
    reader.onloadend = () => {
      onAddToCart({
        id: Date.now(),
        type: 'video',
        kind: 'ugc-edit',
        dataUrl: reader.result,
        videoUrl: reader.result,
        name: activeSession?.creator_name
          ? `${activeSession.creator_name} UGC edit`
          : `UGC edit ${new Date().toLocaleString()}`,
        creator: activeSession?.creator_name || null,
        creatorId: activeSession?.creator_id || null,
        briefId: activeSession?.brief_id || null,
        deliverableId: activeSession?.deliverable_id || null,
        sourceVideoUrl: activeSession?.video_url || null,
        createdAt: Date.now(),
      });
    };
    reader.readAsDataURL(blob);
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
          <span style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#8b949e' }}>Sessions</span>
          <button onClick={newSession} style={ghostBtn}>+ New</button>
        </div>
        {sessionsLoading && <div style={{ color: '#6e7681', fontSize: 12 }}>Loading…</div>}
        {!sessionsLoading && !sessions.length && (
          <div style={{ color: '#6e7681', fontSize: 12 }}>No sessions yet. Upload a video to start.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => loadSession(s.id)}
              style={{
                ...sessionCard,
                ...(activeSession?.id === s.id ? { borderColor: '#DC440A', background: '#1f1410' } : {}),
              }}
            >
              <div style={{ fontSize: 12, color: '#f0f4f8', fontWeight: 600, wordBreak: 'break-all' }}>
                {s.title || s.file_name || `Session ${s.id}`}
                {s.creator_name && <span style={{ display: 'block', color: '#DC440A', fontSize: 8, marginTop: 3 }}>{s.creator_name}</span>}
              </div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>
                {s.file_size ? `${(s.file_size / 1024 / 1024).toFixed(1)} MB · ` : ''}
                {s.duration ? `${parseFloat(s.duration).toFixed(1)}s · ` : ''}
                {s.status}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                style={{ ...ghostBtn, marginTop: 6, fontSize: 9, padding: '3px 6px', color: '#f85149', borderColor: 'rgba(248,81,73,0.3)' }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div style={{ padding: 24, maxWidth: 1100 }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>UGC Editor</h1>
        <p style={{ color: '#8b949e', marginTop: 0, fontSize: 13 }}>
          Upload raw footage (multi-GB OK) → cut silences and bad takes from the transcript → burn captions → export. Sessions are saved automatically.
        </p>

        {!videoUrl && stage !== 'uploading' && (
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            style={{ ...uploadBox, borderColor: dragOver ? '#DC440A' : '#2a3441', background: dragOver ? '#1f1410' : '#161b22' }}
          >
            <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
            <div style={{ fontSize: 14 }}>Click or drag a video here (mp4, mov, webm)</div>
          </label>
        )}

        {stage === 'uploading' && (
          <div style={{ ...statusBox, marginTop: 16 }}>
            Uploading to Vercel Blob… {Math.round(uploadProgress * 100)}%
            <div style={{ height: 4, background: '#2a3441', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress * 100}%`, height: '100%', background: '#DC440A' }} />
            </div>
          </div>
        )}

        {videoUrl && stage !== 'uploading' && (
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, marginTop: 16, alignItems: 'start' }}>
            <div style={{ position: 'sticky', top: 16 }}>
              {settings.remotionMode && (stage === 'ready' || stage === 'done') && segments.length > 0 ? (
                <Player
                  component={UgcVideo}
                  inputProps={remotionInputProps}
                  durationInFrames={remotionDuration}
                  fps={REMOTION_FPS}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  style={{ width: '100%', borderRadius: 8, background: '#000', aspectRatio: '9/16' }}
                  controls
                  loop
                />
              ) : (
                <video ref={videoRef} src={videoUrl} controls crossOrigin="anonymous" style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 320 }} />
              )}
              <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>
                {activeSession?.file_name || file?.name}
                {activeSession?.file_size ? ` · ${(activeSession.file_size / 1024 / 1024).toFixed(1)} MB` : (file ? ` · ${(file.size / 1024 / 1024).toFixed(1)} MB` : '')}
              </div>

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

                    <div style={{ fontSize: 12, color: '#8b949e' }}>
                      {duration ? `${duration.toFixed(1)}s raw · ${keptDuration.toFixed(1)}s kept · ${cutDuration.toFixed(1)}s removed` : null}
                    </div>

                    <label style={checkboxRow}>
                      <input type="checkbox" checked={settings.remotionMode} onChange={(e) => updateSetting('remotionMode', e.target.checked)} />
                      Remotion preview (animated captions + brand intro/outro)
                    </label>

                    {settings.remotionMode && (
                      <div style={{ background: '#161b22', border: '1px solid #2a3441', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label style={checkboxRow}>
                          <input type="checkbox" checked={settings.showIntro} onChange={(e) => updateSetting('showIntro', e.target.checked)} />
                          Brand intro (1.5s)
                        </label>
                        {settings.showIntro && (
                          <>
                            <input value={settings.introTitle} onChange={(e) => updateSetting('introTitle', e.target.value)} placeholder="Intro title" style={smallInput} />
                            <input value={settings.introSubtitle} onChange={(e) => updateSetting('introSubtitle', e.target.value)} placeholder="Intro subtitle" style={smallInput} />
                          </>
                        )}
                        <label style={checkboxRow}>
                          <input type="checkbox" checked={settings.showOutro} onChange={(e) => updateSetting('showOutro', e.target.checked)} />
                          Outro CTA (2s)
                        </label>
                        {settings.showOutro && (
                          <>
                            <input value={settings.outroHeadline} onChange={(e) => updateSetting('outroHeadline', e.target.value)} placeholder="Outro headline" style={smallInput} />
                            <input value={settings.outroCta} onChange={(e) => updateSetting('outroCta', e.target.value)} placeholder="Outro CTA (URL)" style={smallInput} />
                          </>
                        )}
                      </div>
                    )}

                    {stage !== 'rendering' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={render} style={primaryBtn} disabled={!segments.length || settings.remotionMode || !canRenderLocally}>
                          {stage === 'done' ? 'Re-render' : 'Render'}
                        </button>
                        <button onClick={resetWords} style={secondaryBtn}>Reset cuts</button>
                      </div>
                    )}
                    {!canRenderLocally && (
                      <div style={{ fontSize: 11, color: '#8b949e' }}>
                        In-browser render disabled — source file isn't loaded locally. Lambda render coming soon.
                      </div>
                    )}
                    {settings.remotionMode && (
                      <div style={{ fontSize: 11, color: '#8b949e' }}>
                        Remotion render-to-mp4 ships once Lambda is wired (env + AWS account). Preview-only for now.
                      </div>
                    )}

                    {stage === 'rendering' && (
                      <div style={statusBox}>
                        Rendering… {Math.round(progress * 100)}%
                        <div style={{ fontSize: 10, color: '#6e7681', marginTop: 4, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {logTail}
                        </div>
                      </div>
                    )}

                    {stage === 'done' && outputUrl && (
                      <>
                        <video src={outputUrl} controls style={{ width: '100%', borderRadius: 8, background: '#000', marginTop: 8 }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={download} style={primaryBtn}>Download</button>
                          {onAddToCart && <button onClick={sendToCart} style={secondaryBtn}>Send to Cart</button>}
                        </div>
                      </>
                    )}
                  </>
                )}

                {error && <div style={{ color: '#f85149', fontSize: 13 }}>{error}</div>}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#6e7681', marginBottom: 8, letterSpacing: 1 }}>
                Transcript {words.length ? `· click words to cut` : ''}
              </div>
              <div style={transcriptBox}>
                {!words.length && <div style={{ color: '#6e7681', fontSize: 13 }}>Transcript will appear here.</div>}
                {words.map((w, i) => (
                  <span
                    key={i}
                    onClick={() => toggleWord(i)}
                    onDoubleClick={() => seekTo(w.start)}
                    style={{
                      cursor: 'pointer',
                      padding: '1px 4px',
                      borderRadius: 3,
                      color: w.kept ? '#f0f4f8' : '#6e7681',
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

function applyAutoSilence(words, _enabled) {
  if (!words.length) return words;
  return words;
}

function buildSegments(words, duration) {
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
      if (gap > SILENCE_THRESHOLD_S) {
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
  borderRight: '1px solid #2a3441', background: '#0d1117', padding: 16, overflowY: 'auto',
  maxHeight: 'calc(100vh - 60px)',
};
const sessionCard = {
  border: '1px solid #2a3441', borderRadius: 6, padding: 10, cursor: 'pointer',
  background: '#161b22',
};
const uploadBox = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 200, border: '2px dashed #2a3441', borderRadius: 8, cursor: 'pointer',
  color: '#8b949e', marginTop: 16, background: '#161b22',
};
const primaryBtn = {
  background: '#DC440A', color: '#fff', border: 0, padding: '10px 16px',
  borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const secondaryBtn = {
  background: 'transparent', color: '#f0f4f8', border: '1px solid #2a3441',
  padding: '10px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
};
const ghostBtn = {
  background: 'transparent', color: '#8b949e', border: '1px solid #2a3441',
  padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
};
const checkboxRow = { fontSize: 13, color: '#f0f4f8', display: 'flex', gap: 8, alignItems: 'center' };
const statusBox = {
  background: '#161b22', border: '1px solid #2a3441', borderRadius: 6,
  padding: 12, fontSize: 13, color: '#f0f4f8',
};
const smallInput = {
  background: '#0d1117', border: '1px solid #2a3441', color: '#f0f4f8',
  padding: '6px 8px', borderRadius: 4, fontSize: 12, fontFamily: 'inherit',
};
const transcriptBox = {
  background: '#0d1117', border: '1px solid #2a3441', borderRadius: 8,
  padding: 14, fontSize: 14, lineHeight: 1.8, height: 460, overflowY: 'auto',
  display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: '2px 6px',
  wordBreak: 'break-word',
};
