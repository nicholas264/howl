import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Player } from '@remotion/player';
import { extractAudio, renderCuts, buildSrtFromWords } from '../utils/ffmpegClient';
import { UgcVideo, calcDurationInFrames } from '../remotion/UgcVideo';

const SILENCE_THRESHOLD_S = 0.6;

export default function UgcEditorTool({ onAddToCart }) {
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [stage, setStage] = useState('idle'); // idle | transcribing | ready | rendering | done
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [words, setWords] = useState([]); // { word, start, end, kept }
  const [duration, setDuration] = useState(0);
  const [burnCaptions, setBurnCaptions] = useState(true);
  const [autoCutSilences, setAutoCutSilences] = useState(true);
  const [outputUrl, setOutputUrl] = useState(null);
  const [logTail, setLogTail] = useState('');
  const videoRef = useRef(null);

  // Remotion preview state
  const [remotionMode, setRemotionMode] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showOutro, setShowOutro] = useState(true);
  const [introTitle, setIntroTitle] = useState('HOWL');
  const [introSubtitle, setIntroSubtitle] = useState("World's hottest fire pit");
  const [outroHeadline, setOutroHeadline] = useState('Get yours.');
  const [outroCta, setOutroCta] = useState('howlcampfires.com');

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }, [videoUrl, outputUrl]);

  const acceptFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      setError('Please upload a video file.');
      return;
    }
    setFile(f);
    setOutputUrl(null);
    setWords([]);
    setError('');
    setStage('idle');
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(f));
  };

  const handleFile = (e) => acceptFile(e.target.files?.[0]);

  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    acceptFile(f);
  };
  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const transcribe = async () => {
    if (!file) return;
    setStage('transcribing');
    setProgress(0);
    setError('');
    try {
      const audioBlob = await extractAudio(file, { onProgress: setProgress });
      const r = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/mpeg' },
        body: audioBlob,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Transcription failed');
      const ws = (data.words || []).map(w => ({
        word: w.word,
        start: w.start,
        end: w.end,
        kept: true,
      }));
      setWords(applyAutoSilence(ws, autoCutSilences));
      setDuration(data.duration || (ws.length ? ws[ws.length - 1].end : 0));
      setStage('ready');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Transcription failed');
      setStage('idle');
    }
  };

  const toggleWord = (idx) => {
    setWords(prev => prev.map((w, i) => i === idx ? { ...w, kept: !w.kept } : w));
  };

  const resetWords = () => {
    setWords(prev => applyAutoSilence(prev.map(w => ({ ...w, kept: true })), autoCutSilences));
  };

  useEffect(() => {
    if (!words.length) return;
    setWords(prev => applyAutoSilence(prev, autoCutSilences));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCutSilences]);

  const segments = useMemo(() => buildSegments(words, duration), [words, duration]);
  const keptDuration = segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
  const cutDuration = duration - keptDuration;

  const REMOTION_FPS = 30;
  const keptWords = useMemo(() => words.filter(w => w.kept), [words]);
  const remotionDuration = useMemo(
    () => calcDurationInFrames({ segments, fps: REMOTION_FPS, showIntro, showOutro }),
    [segments, showIntro, showOutro],
  );
  const remotionInputProps = useMemo(() => ({
    videoSrc: videoUrl,
    segments,
    words: keptWords,
    showCaptions: burnCaptions,
    showIntro,
    showOutro,
    intro: { title: introTitle, subtitle: introSubtitle },
    outro: { headline: outroHeadline, cta: outroCta },
  }), [videoUrl, segments, keptWords, burnCaptions, showIntro, showOutro, introTitle, introSubtitle, outroHeadline, outroCta]);

  const render = async () => {
    if (!file || !segments.length) return;
    setStage('rendering');
    setProgress(0);
    setError('');
    setOutputUrl(null);
    try {
      let captionsSrt = null;
      if (burnCaptions) {
        const keptWords = words.filter(w => w.kept);
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
        name: `UGC edit ${new Date().toLocaleString()}`,
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

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>UGC Editor</h1>
      <p style={{ color: '#8b949e', marginTop: 0, fontSize: 13 }}>
        Upload raw footage → cut silences and bad takes from the transcript → burn captions → export.
      </p>

      {!file && (
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

      {file && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
          <div>
            {remotionMode && (stage === 'ready' || stage === 'done') && segments.length > 0 ? (
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
              <video ref={videoRef} src={videoUrl} controls style={{ width: '100%', borderRadius: 8, background: '#000' }} />
            )}
            <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </div>

            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {stage === 'idle' && (
                <button onClick={transcribe} style={primaryBtn}>Transcribe</button>
              )}
              {stage === 'transcribing' && (
                <div style={statusBox}>Extracting audio + transcribing… {Math.round(progress * 100)}%</div>
              )}

              {stage === 'ready' || stage === 'done' || stage === 'rendering' ? (
                <>
                  <label style={checkboxRow}>
                    <input type="checkbox" checked={autoCutSilences} onChange={(e) => setAutoCutSilences(e.target.checked)} />
                    Auto-cut silences {`>`} {SILENCE_THRESHOLD_S}s
                  </label>
                  <label style={checkboxRow}>
                    <input type="checkbox" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} />
                    Burn captions
                  </label>

                  <div style={{ fontSize: 12, color: '#8b949e' }}>
                    {duration ? `${duration.toFixed(1)}s raw · ${keptDuration.toFixed(1)}s kept · ${cutDuration.toFixed(1)}s removed` : null}
                  </div>

                  <label style={checkboxRow}>
                    <input type="checkbox" checked={remotionMode} onChange={(e) => setRemotionMode(e.target.checked)} />
                    Remotion preview (animated captions + brand intro/outro)
                  </label>

                  {remotionMode && (
                    <div style={{ background: '#161b22', border: '1px solid #2a3441', borderRadius: 6, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label style={checkboxRow}>
                        <input type="checkbox" checked={showIntro} onChange={(e) => setShowIntro(e.target.checked)} />
                        Brand intro (1.5s)
                      </label>
                      {showIntro && (
                        <>
                          <input value={introTitle} onChange={(e) => setIntroTitle(e.target.value)} placeholder="Intro title" style={smallInput} />
                          <input value={introSubtitle} onChange={(e) => setIntroSubtitle(e.target.value)} placeholder="Intro subtitle" style={smallInput} />
                        </>
                      )}
                      <label style={checkboxRow}>
                        <input type="checkbox" checked={showOutro} onChange={(e) => setShowOutro(e.target.checked)} />
                        Outro CTA (2s)
                      </label>
                      {showOutro && (
                        <>
                          <input value={outroHeadline} onChange={(e) => setOutroHeadline(e.target.value)} placeholder="Outro headline" style={smallInput} />
                          <input value={outroCta} onChange={(e) => setOutroCta(e.target.value)} placeholder="Outro CTA (URL)" style={smallInput} />
                        </>
                      )}
                    </div>
                  )}

                  {stage !== 'rendering' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={render} style={primaryBtn} disabled={!segments.length || remotionMode}>
                        {stage === 'done' ? 'Re-render' : 'Render'}
                      </button>
                      <button onClick={resetWords} style={secondaryBtn}>Reset cuts</button>
                    </div>
                  )}
                  {remotionMode && (
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
              ) : null}

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
                    padding: '1px 3px',
                    margin: '0 1px',
                    borderRadius: 3,
                    color: w.kept ? '#f0f4f8' : '#6e7681',
                    textDecoration: w.kept ? 'none' : 'line-through',
                    background: w.kept ? 'transparent' : '#1f2630',
                  }}
                  title={`${w.start.toFixed(2)}s — double-click to seek`}
                >
                  {w.word}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Mark words inside silence gaps as kept=false (or restore them when toggle is off)
function applyAutoSilence(words, enabled) {
  if (!words.length) return words;
  return words.map((w, i) => {
    const prev = words[i - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (enabled && gap > SILENCE_THRESHOLD_S && i > 0) {
      // The gap before this word is long — that's silence between prev.end and w.start.
      // The gap is between words; nothing to mark on the word itself.
    }
    return w;
  });
}

// Build kept segments by merging consecutive kept words and clipping silence padding.
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

// After concat, original timestamps shift. Map kept words to output timeline.
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
};
