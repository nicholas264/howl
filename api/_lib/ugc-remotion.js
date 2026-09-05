export const REMOTION_COMPOSITION_ID = 'UgcAd';
export const REMOTION_FPS = 30;
export const REMOTION_WIDTH = 1080;
export const REMOTION_HEIGHT = 1920;

export function remotionConfig() {
  const region = process.env.REMOTION_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
  const functionName = process.env.REMOTION_LAMBDA_FUNCTION_NAME || '';
  const serveUrl = process.env.REMOTION_LAMBDA_SERVE_URL || '';
  const missing = [];
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!functionName) missing.push('REMOTION_LAMBDA_FUNCTION_NAME');
  if (!serveUrl) missing.push('REMOTION_LAMBDA_SERVE_URL');
  return {
    configured: missing.length === 0,
    missing,
    region,
    functionName,
    serveUrl,
  };
}

export function calcDurationInFrames({ segments = [], showIntro = true, showOutro = true, fps = REMOTION_FPS }) {
  const introFrames = showIntro ? Math.round(fps * 1.5) : 0;
  const outroFrames = showOutro ? Math.round(fps * 2.0) : 0;
  const segmentFrames = segments.reduce((sum, segment) => (
    sum + Math.max(1, Math.round((Number(segment.end) - Number(segment.start)) * fps))
  ), 0);
  return Math.max(1, introFrames + segmentFrames + outroFrames);
}

export function validSegments(input, duration) {
  if (!Array.isArray(input) || !input.length || input.length > 300) return null;
  const result = [];
  for (const segment of input) {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
    if (end > 3600 || (duration && end > duration + 1)) return null;
    result.push({ start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
  }
  if (result.reduce((total, part) => total + part.end - part.start, 0) > 600) return null;
  return result;
}

export function buildRemotionInput({ session, segments, words, settings }) {
  const sourceWords = Array.isArray(words) && words.length
    ? words
    : Array.isArray(session.words) ? session.words : [];
  const keptWords = sourceWords
    .filter(word => word && word.kept !== false)
    .map(word => ({
      word: String(word.word || ''),
      start: Number(word.start || 0),
      end: Number(word.end || word.start || 0),
      kept: true,
    }));
  const recipe = {
    burnCaptions: true,
    captionStyle: 'pop',
    captionPosition: 'bottom',
    captionScale: 1,
    captionDensity: 3,
    captionEmphasis: 'active',
    showIntro: true,
    showOutro: true,
    introTitle: 'HOWL',
    introSubtitle: "World's hottest smokeless fire pit",
    outroHeadline: 'Feel the heat.',
    outroCta: 'howlcampfires.com',
    ...(settings || {}),
  };
  return {
    videoSrc: session.video_url,
    segments,
    words: keptWords,
    showCaptions: recipe.burnCaptions !== false,
    captionStyle: recipe.captionStyle || 'pop',
    captionPosition: recipe.captionPosition || 'bottom',
    captionScale: Number(recipe.captionScale || 1),
    captionDensity: Number(recipe.captionDensity || 3),
    captionEmphasis: recipe.captionEmphasis || 'active',
    showIntro: recipe.showIntro !== false,
    showOutro: recipe.showOutro !== false,
    intro: {
      title: recipe.introTitle || 'HOWL',
      subtitle: recipe.introSubtitle || "World's hottest smokeless fire pit",
    },
    outro: {
      headline: recipe.outroHeadline || 'Feel the heat.',
      cta: recipe.outroCta || 'howlcampfires.com',
    },
  };
}
