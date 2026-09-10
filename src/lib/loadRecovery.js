export function isAssetLoadError(error) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|Unable to preload CSS|error loading dynamically imported module/i.test(error?.message || '');
}

// Never loop or silently discard edited forms. A cancelled navigation guard also
// prevents recovery from interrupting an in-flight save or editor operation.
export function recoverAssetLoad(error, win = window) {
  if (!isAssetLoadError(error) || win.__howlHasEdits || win.navigator.onLine === false) return false;
  if (!win.dispatchEvent(new Event('howl:before-tool-change', { cancelable: true }))) return false;
  try {
    const now = Date.now();
    const previous = Number(win.sessionStorage.getItem('howl:last-load-recovery') || 0);
    if (now - previous < 60000) return false;
    win.sessionStorage.setItem('howl:last-load-recovery', String(now));
  } catch { return false; }
  win.location.reload();
  return true;
}

export function installLoadRecovery(win = window) {
  const markEdited = () => { win.__howlHasEdits = true; };
  win.addEventListener('input', markEdited, true);
  win.addEventListener('change', markEdited, true);
  win.addEventListener('vite:preloadError', event => {
    if (recoverAssetLoad(event.payload, win)) event.preventDefault();
  });
}

export async function withDeadline(operation, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
