import { COLORS, FONTS } from '../brand';

export default function OverlayTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const headlineSize = isStory ? 72 : 60;
  const ctaSize = isStory ? 28 : 24;
  const padding = isStory ? 60 : 48;

  const isLight = textPosition?.isLight ?? false;

  // On light backgrounds: dark text, no scrim
  // On dark backgrounds: light text, subtle scrim
  const headlineColor = isLight ? COLORS.midnightSky : COLORS.natural;
  const ctaColor = COLORS.flame;
  const scrimBg = isLight ? 'transparent' : 'rgba(0,0,0,0.35)';

  return (
    <div style={{
      width: dimensions.width,
      height: dimensions.height,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: COLORS.midnightSky,
    }}>
      {/* Full-bleed product photo */}
      <img
        src={photoUrl}
        alt=""
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />

      {/* Scrim — only on dark backgrounds */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: scrimBg,
      }} />

      {/* Centered headline + CTA */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: padding,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: FONTS.headline.family,
          fontWeight: FONTS.headline.weight,
          fontSize: headlineSize,
          textTransform: FONTS.headline.transform,
          letterSpacing: FONTS.headline.letterSpacing,
          color: headlineColor,
          lineHeight: 1.1,
          marginBottom: 24,
        }}>
          {variation.headline}
        </div>

        <div style={{
          fontFamily: FONTS.subHeadline.family,
          fontWeight: FONTS.subHeadline.weight,
          fontSize: ctaSize,
          textTransform: FONTS.subHeadline.transform,
          letterSpacing: FONTS.subHeadline.letterSpacing,
          color: ctaColor,
        }}>
          {variation.cta} »
        </div>
      </div>
    </div>
  );
}
