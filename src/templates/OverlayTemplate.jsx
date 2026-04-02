import { COLORS, FONTS, LOGOS } from '../brand';
import { scaleFontSize } from '../utils/scaleFontSize';

export default function OverlayTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const headlineSize = scaleFontSize(variation.headline, isStory ? 52 : 42, 24);
  const ctaSize = isStory ? 38 : 30;
  const padding = isStory ? 60 : 48;

  const isLight = textPosition?.isLight ?? false;
  const vPos = textPosition?.vertical || 'bottom';
  const textAtBottom = vPos !== 'top';

  const headlineColor = isLight ? COLORS.midnightSky : COLORS.natural;
  const ctaColor = COLORS.flame;

  // Gradient scrim only where the text block sits
  const scrimGradient = textAtBottom
    ? 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)'
    : 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)';
  const scrimBg = isLight ? 'transparent' : scrimGradient;

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
          top: 0, left: 0,
          width: '100%', height: '100%',
          objectFit: 'contain',
        }}
      />

      {/* Directional scrim */}
      <div style={{ position: 'absolute', inset: 0, background: scrimBg }} />

      {/* Text block — top or bottom, never dead center */}
      <div style={{
        position: 'absolute',
        left: 0, right: 0,
        ...(textAtBottom ? { bottom: 0 } : { top: 0 }),
        padding: `${padding}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
      }}>
        <div style={{
          fontFamily: FONTS.headline.family,
          fontWeight: FONTS.headline.weight,
          fontSize: headlineSize,
          textTransform: FONTS.headline.transform,
          letterSpacing: FONTS.headline.letterSpacing,
          color: headlineColor,
          lineHeight: 1.1,
          marginBottom: 20,
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          maxWidth: '100%',
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
          →
        </div>
      </div>

      {/* Logo — opposite corner from text */}
      <div style={{
        position: 'absolute',
        ...(textAtBottom ? { top: padding } : { bottom: padding }),
        right: padding,
      }}>
        <img
          src={isLight ? LOGOS.stackedBlack : LOGOS.stackedWhite}
          alt="HOWL"
          style={{ height: isStory ? 52 : 40, objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}
