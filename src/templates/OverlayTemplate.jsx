import { COLORS, FONTS, LOGOS } from '../brand';

export default function OverlayTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const headlineSize = isStory ? 72 : 60;
  const ctaSize = isStory ? 28 : 24;
  const logoWidth = isStory ? 140 : 120;
  const padding = isStory ? 60 : 48;

  const vPos = textPosition?.vertical || 'bottom';
  const hPos = textPosition?.horizontal || 'center';

  // Logo goes in the opposite corner from text
  const logoTop = vPos === 'bottom' ? padding : undefined;
  const logoBottom = vPos === 'top' ? padding : undefined;
  const logoLeft = hPos === 'right' ? padding : undefined;
  const logoRight = hPos === 'left' || hPos === 'center' ? padding : undefined;

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

      {/* Scrim for text readability */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
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
          color: COLORS.natural,
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
          color: COLORS.flame,
        }}>
          {variation.cta} »
        </div>
      </div>
    </div>
  );
}
