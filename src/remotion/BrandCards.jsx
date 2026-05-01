import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

export function BrandIntro({ title = 'HOWL', subtitle = "World's hottest fire pit" }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 14, stiffness: 180 } });
  const subOpacity = interpolate(frame, [fps * 0.4, fps * 0.7], [0, 1], { extrapolateRight: 'clamp' });
  const exitOpacity = interpolate(frame, [durationInFrames - fps * 0.3, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: 'linear-gradient(180deg, #0d1117 0%, #1a1612 100%)',
      justifyContent: 'center',
      alignItems: 'center',
      opacity: exitOpacity,
    }}>
      <div style={{
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 900,
        fontSize: 220,
        color: '#F9F3DF',
        letterSpacing: '0.05em',
        transform: `scale(${interpolate(titleScale, [0, 1], [0.5, 1])})`,
        textShadow: '0 12px 48px rgba(220, 68, 10, 0.5)',
      }}>
        {title}
      </div>
      <div style={{
        marginTop: 8,
        fontFamily: "'Libre Franklin', sans-serif",
        fontWeight: 700,
        fontSize: 28,
        color: '#DC440A',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        opacity: subOpacity,
      }}>
        {subtitle}
      </div>
    </AbsoluteFill>
  );
}

export function BrandOutro({ headline = 'Get yours.', cta = 'howlcampfires.com' }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = interpolate(frame, [0, fps * 0.4], [0, 1], { extrapolateRight: 'clamp' });
  const exitOpacity = interpolate(frame, [durationInFrames - fps * 0.3, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: '#DC440A',
      justifyContent: 'center',
      alignItems: 'center',
      opacity: exitOpacity,
    }}>
      <div style={{
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 900,
        fontSize: 140,
        color: '#F9F3DF',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
      }}>
        {headline}
      </div>
      <div style={{
        marginTop: 24,
        fontFamily: "'Libre Franklin', sans-serif",
        fontWeight: 700,
        fontSize: 38,
        color: '#0d1117',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        opacity: enter,
      }}>
        {cta}
      </div>
    </AbsoluteFill>
  );
}
