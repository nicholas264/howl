import { COLORS, FONTS, LOGOS } from '../brand';
import { scaleFontSize } from '../utils/scaleFontSize';

export default function UGCTemplate({ variation, photoUrl, format, dimensions, attribution, socialProof, reviewerName, backgroundImage, scrimColor }) {
  const isStory = format === 'story';
  const headlineSize = scaleFontSize(variation.headline, isStory ? 88 : 72, 32);
  const padding = isStory ? 80 : 60;
  const hasBackground = !!backgroundImage;
  const scrim = scrimColor ?? 'rgba(249,243,223,0.72)';

  return (
    <div style={{
      width: dimensions.width,
      height: dimensions.height,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: hasBackground ? 'transparent' : COLORS.natural,
      backgroundImage: hasBackground ? `url(${backgroundImage})` : 'none',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
    }}>
      {hasBackground && <div style={{ position: 'absolute', inset: 0, background: scrim, zIndex: 0 }} />}

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
          letterSpacing: FONTS.headline.letterSpacing,
          color: COLORS.midnightSky,
          lineHeight: 1.12,
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          maxWidth: '100%',
        }}>
          {variation.headline}
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
            color: '#6b6055',
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
          color: '#9a8f80',
          flexShrink: 0,
        }}>
          {attribution || 'Verified HOWL Customer'}
        </div>

        {/* Social proof */}
        <div style={{
          fontFamily: FONTS.body.family,
          fontSize: isStory ? 30 : 22,
          color: '#b0a898',
          marginTop: isStory ? 18 : 12,
          letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          {socialProof || '938 Reviews · 90.4% Five Star'}
        </div>
      </div>

      {/* Bottom bar with logo */}
      <div style={{
        height: isStory ? 100 : 80,
        borderTop: `1px solid rgba(51,63,76,0.1)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        backgroundColor: hasBackground ? 'rgba(249,243,223,0.85)' : COLORS.natural,
        position: 'relative',
        zIndex: 1,
      }}>
        <img
          src={LOGOS.stackedBlack}
          alt="HOWL"
          style={{ height: isStory ? 52 : 40, objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}
