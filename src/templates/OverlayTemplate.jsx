import { COLORS, FONTS, LOGOS } from '../brand';

export default function OverlayTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const headlineSize = isStory ? 64 : 52;
  const bodySize = isStory ? 28 : 24;
  const ctaSize = isStory ? 26 : 22;
  const logoWidth = isStory ? 140 : 120;
  const padding = isStory ? 60 : 48;

  const vPos = textPosition?.vertical || 'bottom';
  const hPos = textPosition?.horizontal || 'left';

  // Gradient direction based on where text goes
  const gradientDir = vPos === 'top' ? 'to bottom' : 'to top';
  const gradientStart = 'rgba(0,0,0,0.85)';
  const gradientMid = 'rgba(0,0,0,0.4)';

  // Logo goes in the opposite corner from text
  const logoTop = vPos === 'bottom' ? padding : undefined;
  const logoBottom = vPos === 'top' ? padding : undefined;
  const logoLeft = hPos === 'right' ? padding : undefined;
  const logoRight = hPos === 'left' || hPos === 'center' ? padding : undefined;

  // Text alignment
  const textAlign = hPos === 'right' ? 'right' : hPos === 'center' ? 'center' : 'left';

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

      {/* Gradient overlay — positioned where text goes */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(${gradientDir}, ${gradientStart} 0%, ${gradientMid} 40%, transparent 70%)`,
      }} />

      {/* Logo in opposite corner */}
      <img
        src={LOGOS.stackedWhite}
        alt="HOWL"
        style={{
          position: 'absolute',
          top: logoTop,
          bottom: logoBottom,
          left: logoLeft,
          right: logoRight,
          width: logoWidth,
          height: 'auto',
        }}
      />

      {/* Text content — positioned based on analysis */}
      <div style={{
        position: 'absolute',
        ...(vPos === 'top' ? { top: 0 } : { bottom: 0 }),
        left: 0,
        right: 0,
        padding: padding,
        ...(vPos === 'top' ? { paddingBottom: 0 } : { paddingTop: 0 }),
        textAlign,
      }}>
        <div style={{
          fontFamily: FONTS.headline.family,
          fontWeight: FONTS.headline.weight,
          fontSize: headlineSize,
          textTransform: FONTS.headline.transform,
          letterSpacing: FONTS.headline.letterSpacing,
          color: COLORS.natural,
          lineHeight: 1.1,
          marginBottom: 16,
        }}>
          {variation.headline}
        </div>

        <div style={{
          fontFamily: FONTS.body.family,
          fontWeight: FONTS.body.weight,
          fontSize: bodySize,
          letterSpacing: FONTS.body.letterSpacing,
          color: COLORS.natural,
          opacity: 0.9,
          lineHeight: 1.4,
          marginBottom: 20,
        }}>
          {variation.primary_text}
        </div>

        <div style={{
          fontFamily: FONTS.subHeadline.family,
          fontWeight: FONTS.subHeadline.weight,
          fontSize: ctaSize,
          textTransform: FONTS.subHeadline.transform,
          letterSpacing: FONTS.subHeadline.letterSpacing,
          color: COLORS.flame,
        }}>
          {variation.cta} »
        </div>
      </div>
    </div>
  );
}
