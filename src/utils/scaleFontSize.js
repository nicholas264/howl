/**
 * Scale font size down for longer headlines so they don't overflow templates.
 * @param {string} text - The headline text
 * @param {number} base - Base font size at short lengths
 * @param {number} min - Floor — never go below this
 */
export function scaleFontSize(text, base, min = Math.round(base * 0.55)) {
  const len = (text || '').length;
  if (len <= 35) return base;
  if (len <= 55) return Math.round(base * 0.82);
  if (len <= 75) return Math.round(base * 0.68);
  return Math.max(min, Math.round(base * 0.58));
}
