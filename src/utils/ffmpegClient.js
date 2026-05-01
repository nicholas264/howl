import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpegSingleton = null;
let loadPromise = null;

export async function getFfmpeg(onLog) {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  const ff = new FFmpeg();
  if (onLog) ff.on('log', ({ message }) => onLog(message));

  loadPromise = (async () => {
    const baseURL = '/ffmpeg';
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegSingleton = ff;
    return ff;
  })();

  return loadPromise;
}

export async function extractAudio(file, { onProgress } = {}) {
  const ff = await getFfmpeg();
  if (onProgress) ff.on('progress', ({ progress }) => onProgress(progress));
  await ff.writeFile('input.bin', await fetchFile(file));
  // 16kHz mono mp3 — small + Whisper-friendly
  await ff.exec(['-i', 'input.bin', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', 'audio.mp3']);
  const data = await ff.readFile('audio.mp3');
  await ff.deleteFile('input.bin').catch(() => {});
  await ff.deleteFile('audio.mp3').catch(() => {});
  return new Blob([data.buffer], { type: 'audio/mpeg' });
}

// segments: [{ start, end }] in seconds (already merged & sorted)
// captions: optional ASS/SRT subtitle string
export async function renderCuts(file, segments, { captionsSrt, onProgress, onLog } = {}) {
  const ff = await getFfmpeg(onLog);
  if (onProgress) ff.on('progress', ({ progress }) => onProgress(progress));

  await ff.writeFile('src.mp4', await fetchFile(file));

  const filterParts = [];
  segments.forEach((seg, i) => {
    filterParts.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS[v${i}]`);
    filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[a${i}]`);
  });
  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join('');
  filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[vout][aout]`);

  let videoLabel = '[vout]';
  if (captionsSrt) {
    await ff.writeFile('subs.srt', captionsSrt);
    filterParts.push(`[vout]subtitles=subs.srt:force_style='Fontname=Arial,Fontsize=18,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=40'[vsubs]`);
    videoLabel = '[vsubs]';
  }

  const filter = filterParts.join(';');
  const args = [
    '-i', 'src.mp4',
    '-filter_complex', filter,
    '-map', videoLabel,
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    'out.mp4',
  ];
  await ff.exec(args);

  const data = await ff.readFile('out.mp4');
  await ff.deleteFile('src.mp4').catch(() => {});
  await ff.deleteFile('out.mp4').catch(() => {});
  if (captionsSrt) await ff.deleteFile('subs.srt').catch(() => {});
  return new Blob([data.buffer], { type: 'video/mp4' });
}

// Words: [{ word, start, end }]; chunkSize words per caption line.
export function buildSrtFromWords(words, { chunkSize = 6 } = {}) {
  const lines = [];
  let idx = 1;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    lines.push(String(idx++));
    lines.push(`${srtTime(start)} --> ${srtTime(end)}`);
    lines.push(chunk.map(w => w.word.trim()).join(' '));
    lines.push('');
  }
  return lines.join('\n');
}

function srtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, '0')}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
