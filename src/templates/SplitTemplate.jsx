import { COLORS, FONTS } from '../brand';
import { scaleFontSize } from '../utils/scaleFontSize';

export default function SplitTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const photoPercent = isStory ? 55 : 60;
  const headlineSize = scaleFontSize(variation.headline, isStory ? 52 : 42, 26);
  const ctaSize = isStory ? 44 : 36;
  const padding = isStory ? 52 : 40;

  const isLight = textPosition?.isLight ?? false;
  const vPos = textPosition?.vertical || 'bottom';
  const textOnTop = vPos === 'top';

  // Copy section: light bg → Midnight Sky text, dark bg → Natural text
  const copyBg = isLight ? COLORS.natural : COLORS.midnightSky;
  const headlineColor = isLight ? COLORS.midnightSky : COLORS.natural;
  const ctaColor = COLORS.flame;

  const photoHeight = Math.round(dimensions.height * photoPercent / 100);
  const copyHeight = dimensions.height - photoHeight;

  const photoSection = (
    <div key="photo" style={{
      width: '100%',
      height: photoHeight,
      overflow: 'hidden',
    }}>
      <img
        src={photoUrl}
        alt="Product"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />
    </div>
  );

  const copySection = (
    <div key="copy" style={{
      width: '100%',
      height: copyHeight,
      backgroundColor: copyBg,
      padding: padding,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      position: 'relative',
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
  );

  return (
    <div style={{
      width: dimensions.width,
      height: dimensions.height,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: COLORS.midnightSky,
    }}>
      {textOnTop ? [copySection, photoSection] : [photoSection, copySection]}
    </div>
  );
}
