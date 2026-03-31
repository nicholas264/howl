/**
 * Analyzes an image to find the best region for text placement.
 * Divides the image into a grid and scores each region by how
 * "uniform" it is (low pixel variance = good for text overlay).
 *
 * Returns: { vertical: 'top'|'bottom', horizontal: 'left'|'right'|'center' }
 */
export function analyzeImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 300; // downsample for speed
      const scale = size / Math.max(img.width, img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      const w = canvas.width;
      const h = canvas.height;

      // Define 6 regions: top-left, top-right, bottom-left, bottom-right, top-center, bottom-center
      const regions = [
        { id: { vertical: 'top', horizontal: 'left' }, x: 0, y: 0, w: w / 2, h: h / 2 },
        { id: { vertical: 'top', horizontal: 'right' }, x: w / 2, y: 0, w: w / 2, h: h / 2 },
        { id: { vertical: 'top', horizontal: 'center' }, x: w * 0.2, y: 0, w: w * 0.6, h: h / 2 },
        { id: { vertical: 'bottom', horizontal: 'left' }, x: 0, y: h / 2, w: w / 2, h: h / 2 },
        { id: { vertical: 'bottom', horizontal: 'right' }, x: w / 2, y: h / 2, w: w / 2, h: h / 2 },
        { id: { vertical: 'bottom', horizontal: 'center' }, x: w * 0.2, y: h / 2, w: w * 0.6, h: h / 2 },
      ];

      let bestScore = -1;
      let bestRegion = regions[3].id; // default: bottom-left

      for (const region of regions) {
        const x0 = Math.round(region.x);
        const y0 = Math.round(region.y);
        const x1 = Math.round(region.x + region.w);
        const y1 = Math.round(region.y + region.h);

        // Collect luminance values in this region
        const values = [];
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * w + x) * 4;
            // Perceived luminance
            const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            values.push(lum);
          }
        }

        if (values.length === 0) continue;

        // Calculate mean and variance
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;

        // Score: low variance = uniform region = good for text
        // Also slightly prefer brighter regions (easier to overlay dark text or add gradient)
        const uniformityScore = 1 / (1 + variance / 1000);
        const score = uniformityScore;

        if (score > bestScore) {
          bestScore = score;
          bestRegion = region.id;
        }
      }

      resolve(bestRegion);
    };
    img.onerror = () => resolve({ vertical: 'bottom', horizontal: 'left' });
    img.src = dataUrl;
  });
}
