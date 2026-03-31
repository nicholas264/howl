import { COLORS, FONTS } from '../brand';

export default function EditorialTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const stripHeight = Math.round(dimensions.height * 0.18);
  const headlineSize = isStory ? 40 : 32;
  const ctaSize = isStory ? 22 : 18;
  const padding = isStory ? 40 : 32;

  const isLight = textPosition?.isLight ?? false;
  const vPos = textPosition?.vertical || 'bottom';

  // Strip bg and text colors adapt to image brightness
  const stripBg = isLight
    ? 'rgba(249, 243, 223, 0.95)'   // Natural bg for light images
    : 'rgba(51, 63, 76, 0.95)';     // Midnight Sky bg for dark images
  const headlineColor = isLight ? COLORS.midnightSky : COLORS.natural;
  const ctaColor = COLORS.flame;

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
          objectFit: 'cover',
        }}
      />

      {/* Branded strip */}
      <div style={{
        position: 'absolute',
        ...(vPos === 'top' ? { top: 0 } : { bottom: 0 }),
        left: 0,
        right: 0,
        height: stripHeight,
        backgroundColor: stripBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `0 ${padding}px`,
        gap: padding,
        textAlign: 'center',
      }}>
        {/* Headline */}
        <div style={{
          flex: 1,
          fontFamily: FONTS.headline.family,
          fontWeight: FONTS.headline.weight,
          fontSize: headlineSize,
          textTransform: FONTS.headline.transform,
          letterSpacing: FONTS.headline.letterSpacing,
          color: headlineColor,
          lineHeight: 1.15,
        }}>
          {variation.headline}
        </div>

        {/* CTA */}
        <div style={{
          fontFamily: FONTS.subHeadline.family,
          fontWeight: FONTS.subHeadline.weight,
          fontSize: ctaSize,
          textTransform: FONTS.subHeadline.transform,
          letterSpacing: FONTS.subHeadline.letterSpacing,
          color: ctaColor,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {variation.cta} »
        </div>
      </div>
    </div>
  );
}
