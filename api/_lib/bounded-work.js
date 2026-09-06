import { AsyncLocalStorage } from 'node:async_hooks';

const execution = new AsyncLocalStorage();
export function workSignal() { return execution.getStore(); }
export function checkWork() { workSignal()?.throwIfAborted(); }

// A deadline propagates to network streams and child processes, rather than
// merely abandoning a Promise while paid provider work continues in background.
export async function boundedWork(callback, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Analysis time budget exhausted')), timeoutMs);
  try { return await execution.run(controller.signal, callback); }
  finally { clearTimeout(timer); }
}

export function workFetch(input, init = {}) {
  checkWork();
  const signals = [workSignal(), init.signal, AbortSignal.timeout(60000)].filter(Boolean);
  return globalThis.fetch(input, { ...init, signal: AbortSignal.any(signals) });
}
