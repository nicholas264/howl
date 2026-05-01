import { AbsoluteFill, Series, Video, useVideoConfig } from 'remotion';
import { AnimatedCaptions } from './AnimatedCaptions';
import { BrandIntro, BrandOutro } from './BrandCards';

// Props from UgcEditorTool:
// {
//   videoSrc: string (URL)
//   segments: [{ start, end }]   // seconds — kept regions of the source video
//   words:    [{ word, start, end }]  // ALL kept words (source timeline)
//   showCaptions: boolean
//   showIntro: boolean
//   showOutro: boolean
//   intro: { title, subtitle }
//   outro: { headline, cta }
// }
export const UgcVideo = ({
  videoSrc,
  segments = [],
  words = [],
  showCaptions = true,
  showIntro = true,
  showOutro = true,
  intro = { title: 'HOWL', subtitle: "World's hottest fire pit" },
  outro = { headline: 'Get yours.', cta: 'howlcampfires.com' },
}) => {
  const { fps } = useVideoConfig();
  const introFrames = showIntro ? Math.round(fps * 1.5) : 0;
  const outroFrames = showOutro ? Math.round(fps * 2.0) : 0;

  // For each segment, compute output-frames duration + the words that belong to it (remapped to 0)
  const segMeta = segments.map(seg => {
    const dur = Math.max(0.1, seg.end - seg.start);
    const segWords = words
      .filter(w => w.start >= seg.start - 0.05 && w.end <= seg.end + 0.05)
      .map(w => ({
        word: w.word,
        start: Math.max(0, w.start - seg.start),
        end: Math.max(0, w.end - seg.start),
      }));
    return { ...seg, durationInFrames: Math.max(1, Math.round(dur * fps)), segWords };
  });

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Series>
        {showIntro && (
          <Series.Sequence durationInFrames={introFrames}>
            <BrandIntro title={intro.title} subtitle={intro.subtitle} />
          </Series.Sequence>
        )}

        {segMeta.map((seg, i) => (
          <Series.Sequence key={i} durationInFrames={seg.durationInFrames}>
            <AbsoluteFill>
              <Video
                src={videoSrc}
                startFrom={Math.round(seg.start * fps)}
                endAt={Math.round(seg.end * fps)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {showCaptions && <AnimatedCaptions words={seg.segWords} />}
            </AbsoluteFill>
          </Series.Sequence>
        ))}

        {showOutro && (
          <Series.Sequence durationInFrames={outroFrames}>
            <BrandOutro headline={outro.headline} cta={outro.cta} />
          </Series.Sequence>
        )}
      </Series>
    </AbsoluteFill>
  );
};

// Helper: total frame count for the composition given the same inputs
export function calcDurationInFrames({ segments, fps, showIntro, showOutro }) {
  const introFrames = showIntro ? Math.round(fps * 1.5) : 0;
  const outroFrames = showOutro ? Math.round(fps * 2.0) : 0;
  const segFrames = segments.reduce((s, seg) => s + Math.max(1, Math.round((seg.end - seg.start) * fps)), 0);
  return Math.max(1, introFrames + segFrames + outroFrames);
}
