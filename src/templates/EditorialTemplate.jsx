import { COLORS, FONTS, LOGOS } from '../brand';

export default function EditorialTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const stripHeight = Math.round(dimensions.height * 0.18);
  const headlineSize = isStory ? 40 : 32;
  const ctaSize = isStory ? 22 : 18;
  const logoWidth = isStory ? 80 : 65;
  const padding = isStory ? 40 : 32;

  const vPos = textPosition?.vertical || 'bottom';

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

      {/* Branded strip — top or bottom based on white space analysis */}
      <div style={{
        position: 'absolute',
        ...(vPos === 'top' ? { top: 0 } : { bottom: 0 }),
        left: 0,
        right: 0,
        height: stripHeight,
        backgroundColor: 'rgba(51, 63, 76, 0.95)',
        display: 'flex',
        alignItems: 'center',
        padding: `0 ${padding}px`,
        gap: padding,
      }}>
        {/* Logo left */}
        <img
          src={LOGOS.stackedWhite}
          alt="HOWL"
          style={{
            width: logoWidth,
            height: 'auto',
            flexShrink: 0,
          }}
        />

        {/* Headline center */}
        <div style={{
          flex: 1,
          fontFamily: FONTS.headline.family,
          fontWeight: FONTS.headline.weight,
          fontSize: headlineSize,
          textTransform: FONTS.headline.transform,
          letterSpacing: FONTS.headline.letterSpacing,
          color: COLORS.natural,
          lineHeight: 1.15,
        }}>
          {variation.headline}
        </div>

        {/* CTA right */}
        <div style={{
          fontFamily: FONTS.subHeadline.family,
          fontWeight: FONTS.subHeadline.weight,
          fontSize: ctaSize,
          textTransform: FONTS.subHeadline.transform,
          letterSpacing: FONTS.subHeadline.letterSpacing,
          color: COLORS.flame,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          {variation.cta} »
        </div>
      </div>
    </div>
  );
}
