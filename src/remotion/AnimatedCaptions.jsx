import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

// words: [{ word, start, end }] — timestamps in SECONDS, RELATIVE to the start of this sequence
export function AnimatedCaptions({ words, style = 'pop', position = 'bottom' }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  // Group words into 3-4 word lines so they're readable
  const lines = useMemo_groupLines(words, 3);
  const activeLine = lines.find(l => currentTime >= l.start && currentTime <= l.end);

  if (!activeLine) return null;

  return (
    <AbsoluteFill style={{
      justifyContent: position === 'bottom' ? 'flex-end' : position === 'top' ? 'flex-start' : 'center',
      alignItems: 'center',
      paddingBottom: position === 'bottom' ? '12%' : 0,
      paddingTop: position === 'top' ? '12%' : 0,
      pointerEvents: 'none',
    }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 12,
        maxWidth: '85%',
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
          const scale = style === 'pop' ? interpolate(popScale, [0, 1], [0.6, 1]) : 1;
          const color = isActive ? '#DC440A' : isPast ? '#F9F3DF' : '#F9F3DF';
          return (
            <span key={i} style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 800,
              fontSize: 64,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
              color,
              textShadow: '0 4px 16px rgba(0,0,0,0.65)',
              transform: `scale(${scale})`,
              display: 'inline-block',
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
