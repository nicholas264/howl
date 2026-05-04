export const COLORS = {
  midnightSky: '#333F4C',
  flame: '#DC440A',
  natural: '#F9F3DF',
};

// Letter-spacing is stored as an em factor (number) so it can be used as
// `${ls}em` in CSS or `size * ls` pixels in canvas rendering.
export const FONTS = {
  headline: {
    family: "'Montserrat', sans-serif",
    weight: 800,
    transform: 'uppercase',
    letterSpacing: 0.03,
  },
  subHeadline: {
    family: "'Libre Franklin', sans-serif",
    weight: 700,
    transform: 'uppercase',
    letterSpacing: 0.075,
  },
  body: {
    family: "'Source Sans 3', sans-serif",
    weight: 400,
    transform: 'none',
    letterSpacing: 0.01,
  },
};

// Canvas font shorthand for ctx.font, e.g. canvasFont('headline', 64)
export function canvasFont(role, sizePx) {
  const f = FONTS[role];
  return `${f.weight} ${sizePx}px ${f.family}`;
}

// CSS letter-spacing string, e.g. cssLetterSpacing('headline') -> '0.03em'
export function cssLetterSpacing(role) {
  return `${FONTS[role].letterSpacing}em`;
}

// Pixel letter-spacing for canvas measureText/fillText with ctx.letterSpacing.
export function pxLetterSpacing(role, sizePx) {
  return sizePx * FONTS[role].letterSpacing;
}

// Brand fonts loaded from /public/fonts. Use to preload before canvas rendering.
export const BRAND_FONT_FILES = [
  { family: 'Montserrat',     weight: 800, url: '/fonts/montserrat-800.woff2' },
  { family: 'Libre Franklin', weight: 700, url: '/fonts/libre-franklin-700.woff2' },
  { family: 'Source Sans 3',  weight: 400, url: '/fonts/source-sans-3-400.woff2' },
];

// Preload brand fonts at the sizes needed for canvas rendering. Pass the
// pixel sizes you'll actually draw with so the right glyph metrics are ready.
export async function loadBrandFonts({ headline, subHeadline, body } = {}) {
  const tasks = [];
  if (headline)    tasks.push(document.fonts.load(canvasFont('headline', headline)));
  if (subHeadline) tasks.push(document.fonts.load(canvasFont('subHeadline', subHeadline)));
  if (body)        tasks.push(document.fonts.load(canvasFont('body', body)));
  await Promise.all(tasks);
}

export const FORMATS = {
  square: { width: 1080, height: 1350, label: '4:5' },
  story: { width: 1080, height: 1920, label: '9:16' },
};

export const LOGOS = {
  stackedWhite: '/logos/howl-stacked-wht.png',
  stackedBlack: '/logos/howl-stacked-blk.png',
  iconWhite: '/logos/howl-icon-wht.png',
};
