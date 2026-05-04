import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { FONTS, cssLetterSpacing } from '../brand';

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
        fontFamily: FONTS.headline.family,
        fontWeight: FONTS.headline.weight,
        fontSize: 220,
        color: '#F9F3DF',
        letterSpacing: cssLetterSpacing('headline'),
        transform: `scale(${interpolate(titleScale, [0, 1], [0.5, 1])})`,
        textShadow: '0 12px 48px rgba(220, 68, 10, 0.5)',
      }}>
        {title}
      </div>
      <div style={{
        marginTop: 8,
        fontFamily: FONTS.subHeadline.family,
        fontWeight: FONTS.subHeadline.weight,
        fontSize: 28,
        color: '#DC440A',
        letterSpacing: cssLetterSpacing('subHeadline'),
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
        fontFamily: FONTS.headline.family,
        fontWeight: FONTS.headline.weight,
        fontSize: 140,
        color: '#F9F3DF',
        textTransform: 'uppercase',
        letterSpacing: cssLetterSpacing('headline'),
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
      }}>
        {headline}
      </div>
      <div style={{
        marginTop: 24,
        fontFamily: FONTS.subHeadline.family,
        fontWeight: FONTS.subHeadline.weight,
        fontSize: 38,
        color: '#0d1117',
        letterSpacing: cssLetterSpacing('subHeadline'),
        textTransform: 'uppercase',
        opacity: enter,
      }}>
        {cta}
      </div>
    </AbsoluteFill>
  );
}
