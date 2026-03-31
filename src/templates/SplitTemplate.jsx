import { COLORS, FONTS, LOGOS } from '../brand';

export default function SplitTemplate({ variation, photoUrl, format, dimensions, textPosition }) {
  const isStory = format === 'story';
  const photoPercent = isStory ? 55 : 60;
  const headlineSize = isStory ? 64 : 52;
  const ctaSize = isStory ? 26 : 22;
  const logoWidth = isStory ? 100 : 90;
  const padding = isStory ? 52 : 40;

  const vPos = textPosition?.vertical || 'bottom';
  const textOnTop = vPos === 'top';

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
          objectFit: 'cover',
        }}
      />
    </div>
  );

  const copySection = (
    <div key="copy" style={{
      width: '100%',
      height: copyHeight,
      backgroundColor: COLORS.midnightSky,
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
        color: COLORS.natural,
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
        color: COLORS.flame,
      }}>
        {variation.cta} »
      </div>

      {/* Logo bottom-right */}
      <img
        src={LOGOS.stackedWhite}
        alt="HOWL"
        style={{
          position: 'absolute',
          bottom: padding,
          right: padding,
          width: logoWidth,
          height: 'auto',
        }}
      />
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
