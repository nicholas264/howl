import { COLORS, FONTS, LOGOS, cssLetterSpacing } from '../brand';
import { scaleFontSize } from '../utils/scaleFontSize';

export default function UGCTemplate({ variation, photoUrl, format, dimensions, attribution, socialProof, reviewerName, backgroundImage, scrimColor, textColor }) {
  const isStory = format === 'story';
  const headlineSize = scaleFontSize(variation.headline, isStory ? 88 : 72, 32);
  const padding = isStory ? 80 : 60;
  const hasBackground = !!backgroundImage;
  const scrim = scrimColor ?? 'rgba(249,243,223,0.72)';
  const txtColor = textColor || COLORS.midnightSky;

  return (
    <div style={{
      width: dimensions.width,
      height: dimensions.height,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: hasBackground ? 'transparent' : COLORS.natural,
      isolation: 'isolate',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
    }}>
      {hasBackground && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, backgroundColor: COLORS.natural }}>
          <img
            crossOrigin="anonymous"
            src={backgroundImage}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
          <div style={{ position: 'absolute', inset: 0, background: scrim }} />
        </div>
      )}

      {/* Top accent bar */}
      <div style={{ height: 8, background: COLORS.flame, flexShrink: 0, position: 'relative', zIndex: 1 }} />

      {/* Main content — centered */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `${padding * 0.6}px ${padding}px`,
        textAlign: 'center',
        boxSizing: 'border-box',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* Stars */}
        <div style={{
          fontSize: isStory ? 60 : 48,
          color: COLORS.flame,
          letterSpacing: 8,
          marginBottom: isStory ? 48 : 36,
          flexShrink: 0,
        }}>
          ★★★★★
        </div>

        {/* Headline */}
        <div style={{
          fontFamily: FONTS.headline.family,
          fontWeight: FONTS.headline.weight,
          fontSize: headlineSize,
          textTransform: FONTS.headline.transform,
          letterSpacing: cssLetterSpacing('headline'),
          color: txtColor,
          lineHeight: 1.12,
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          maxWidth: '100%',
        }}>
          {'\u201c'}{variation.headline}{'\u201d'}
        </div>

        {/* Divider */}
        <div style={{
          width: 48,
          height: 3,
          background: COLORS.flame,
          margin: `${isStory ? 44 : 32}px auto`,
          flexShrink: 0,
        }} />

        {/* Reviewer name */}
        {reviewerName && (
          <div style={{
            fontFamily: FONTS.subHeadline.family,
            fontWeight: FONTS.subHeadline.weight,
            fontSize: isStory ? 36 : 28,
            letterSpacing: '0.12em',
            color: txtColor,
            flexShrink: 0,
            marginBottom: isStory ? 10 : 8,
          }}>
            {reviewerName}
          </div>
        )}

        {/* Verified label */}
        <div style={{
          fontFamily: FONTS.subHeadline.family,
          fontWeight: FONTS.subHeadline.weight,
          fontSize: isStory ? 28 : 22,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: txtColor,
          flexShrink: 0,
        }}>
          {attribution || 'Verified HOWL Customer'}
        </div>

        {/* Social proof */}
        <div style={{
          fontFamily: FONTS.body.family,
          fontSize: isStory ? 30 : 22,
          color: txtColor,
          marginTop: isStory ? 18 : 12,
          letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
        </div>
      </div>
    </div>
  );
}
