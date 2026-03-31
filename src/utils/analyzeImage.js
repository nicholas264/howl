/**
 * Analyzes an image to find the best region for text placement
 * and whether the background is light or dark.
 *
 * Returns: {
 *   vertical: 'top'|'bottom',
 *   horizontal: 'left'|'right'|'center',
 *   isLight: boolean  // true = light background, use dark text
 * }
 */
export function analyzeImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 300;
      const scale = size / Math.max(img.width, img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      const w = canvas.width;
      const h = canvas.height;

      const regions = [
        { id: { vertical: 'top', horizontal: 'left' }, x: 0, y: 0, w: w / 2, h: h / 2 },
        { id: { vertical: 'top', horizontal: 'right' }, x: w / 2, y: 0, w: w / 2, h: h / 2 },
        { id: { vertical: 'top', horizontal: 'center' }, x: w * 0.2, y: 0, w: w * 0.6, h: h / 2 },
        { id: { vertical: 'bottom', horizontal: 'left' }, x: 0, y: h / 2, w: w / 2, h: h / 2 },
        { id: { vertical: 'bottom', horizontal: 'right' }, x: w / 2, y: h / 2, w: w / 2, h: h / 2 },
        { id: { vertical: 'bottom', horizontal: 'center' }, x: w * 0.2, y: h / 2, w: w * 0.6, h: h / 2 },
      ];

      let bestScore = -1;
      let bestRegion = regions[3].id;
      let bestMean = 128;

      for (const region of regions) {
        const x0 = Math.round(region.x);
        const y0 = Math.round(region.y);
        const x1 = Math.round(region.x + region.w);
        const y1 = Math.round(region.y + region.h);

        const values = [];
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4;
            const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            values.push(lum);
          }
        }

        if (values.length === 0) continue;

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
        const score = 1 / (1 + variance / 1000);

        if (score > bestScore) {
          bestScore = score;
          bestRegion = region.id;
          bestMean = mean;
        }
      }

      // isLight: true if the best text region is bright (use dark text)
      // Threshold ~140 — above that is "light background"
      resolve({ ...bestRegion, isLight: bestMean > 140 });
    };
    img.onerror = () => resolve({ vertical: 'bottom', horizontal: 'left', isLight: false });
    img.src = dataUrl;
  });
}
