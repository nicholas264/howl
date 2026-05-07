export function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

export function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
