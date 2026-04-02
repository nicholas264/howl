import { COLORS, FONTS, LOGOS } from '../brand';
import { scaleFontSize } from '../utils/scaleFontSize';

export default function UGCTemplate({ variation, photoUrl, format, dimensions }) {
  const isStory = format === 'story';
  const headlineSize = scaleFontSize(variation.headline, isStory ? 68 : 54, 30);
  const padding = isStory ? 88 : 64;

  return (
    <div style={{
      width: dimensions.width,
      height: dimensions.height,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#FFFFFF',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: `${padding}px`,
      boxSizing: 'border-box',
    }}>

      {/* Optional small product image */}
      {photoUrl && (
        <div style={{
          width: isStory ? 260 : 200,
          height: isStory ? 260 : 200,
          marginBottom: isStory ? 48 : 36,
          flexShrink: 0,
        }}>
          <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      {/* Opening quote mark */}
      <div style={{
        alignSelf: 'flex-start',
        fontFamily: 'Georgia, serif',
        fontSize: isStory ? 120 : 96,
        color: COLORS.flame,
        lineHeight: 0.65,
        marginBottom: isStory ? 32 : 24,
        userSelect: 'none',
      }}>"</div>

      {/* Headline */}
      <div style={{
        fontFamily: FONTS.headline.family,
        fontWeight: FONTS.headline.weight,
        fontSize: headlineSize,
        textTransform: FONTS.headline.transform,
        letterSpacing: FONTS.headline.letterSpacing,
        color: COLORS.midnightSky,
        lineHeight: 1.12,
        textAlign: 'center',
      }}>
        {variation.headline}
      </div>

      {/* Divider */}
      <div style={{
        width: 48,
        height: 3,
        background: COLORS.flame,
        margin: `${isStory ? 40 : 30}px auto`,
        flexShrink: 0,
      }} />

      {/* Attribution */}
      <div style={{
        fontFamily: FONTS.subHeadline.family,
        fontWeight: FONTS.subHeadline.weight,
        fontSize: isStory ? 26 : 20,
        textTransform: 'uppercase',
        letterSpacing: '0.15em',
        color: '#9a9080',
      }}>
        Verified HOWL Customer
      </div>

      {/* Stars */}
      <div style={{
        fontSize: isStory ? 36 : 28,
        color: COLORS.flame,
        marginTop: isStory ? 20 : 14,
        letterSpacing: 4,
      }}>
        ★★★★★
      </div>

      {/* Logo — bottom center */}
      <div style={{
        position: 'absolute',
        bottom: isStory ? 56 : 40,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
      }}>
        <img
          src={LOGOS.stackedBlack}
          alt="HOWL"
          style={{ height: isStory ? 56 : 44, objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}
