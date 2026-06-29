import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import { FONTS, cssLetterSpacing } from '../brand';

// words: [{ word, start, end }] — timestamps in SECONDS, RELATIVE to the start of this sequence
export function AnimatedCaptions({
  words,
  style = 'pop',
  position = 'bottom',
  scale = 1,
  density = 3,
  emphasis = 'active',
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;
  const safeScale = Math.max(0.72, Math.min(1.3, Number(scale) || 1));
  const wordsPerLine = Math.max(2, Math.min(5, Math.round(Number(density) || 3)));

  // Group words into 3-4 word lines so they're readable
  const lines = useMemo_groupLines(words, wordsPerLine);
  const activeLine = lines.find(l => currentTime >= l.start && currentTime <= l.end);

  if (!activeLine) return null;

  return (
    <AbsoluteFill style={{
      justifyContent: position === 'bottom' ? 'flex-end' : position === 'top' ? 'flex-start' : 'center',
      alignItems: 'center',
      paddingBottom: position === 'bottom' ? '13%' : position === 'center' ? '7%' : 0,
      paddingTop: position === 'top' ? '15%' : 0,
      pointerEvents: 'none',
    }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: style === 'raw' ? 8 : 12,
        maxWidth: position === 'center' ? '78%' : '84%',
      }}>
        {activeLine.words.map((w, i) => {
          const isActive = currentTime >= w.start && currentTime <= w.end;
          const isPast = currentTime > w.end;
          const enterFrame = w.start * fps;
          const popScale = spring({
            frame: frame - enterFrame,
            fps,
            config: { damping: 12, stiffness: 200 },
          });
          const activeScale = style === 'pop' ? interpolate(popScale, [0, 1], [0.72, 1]) : 1;
          const activeColor = emphasis === 'none' ? '#F9F3DF' : emphasis === 'block' ? '#F9F3DF' : '#DC440A';
          const color = isActive ? activeColor : isPast ? '#F9F3DF' : '#F9F3DF';
          const background = emphasis === 'block'
            ? 'rgba(13, 17, 23, 0.76)'
            : style === 'clean' ? 'rgba(13, 17, 23, 0.42)' : 'transparent';
          return (
            <span key={i} style={{
              fontFamily: FONTS.headline.family,
              fontWeight: FONTS.headline.weight,
              fontSize: Math.round((style === 'raw' ? 54 : style === 'clean' ? 58 : 64) * safeScale),
              letterSpacing: cssLetterSpacing('headline'),
              textTransform: 'uppercase',
              color,
              textShadow: '0 4px 16px rgba(0,0,0,0.65)',
              transform: `scale(${activeScale})`,
              display: 'inline-block',
              padding: background === 'transparent' ? 0 : '8px 12px',
              borderRadius: 10,
              background,
              transition: 'color 80ms linear',
            }}>
              {w.word.trim()}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

// Group words into lines of N
function useMemo_groupLines(words, n) {
  const lines = [];
  for (let i = 0; i < words.length; i += n) {
    const chunk = words.slice(i, i + n);
    if (!chunk.length) continue;
    lines.push({
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end + 0.05,
      words: chunk,
    });
  }
  return lines;
}
