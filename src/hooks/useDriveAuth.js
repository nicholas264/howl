import { apiFetch as fetch } from '../lib/apiFetch.js';
import { useState, useEffect, useCallback } from 'react';

const LEGACY_LS_KEY = 'howl_drive_token';

export function useDriveAuth() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    // Clean up post-OAuth URL params (still set by callback for UX, plus legacy errors)
    const params = new URLSearchParams(window.location.search);
    if (params.get('drive_connected') || params.get('gmail_connected') || params.get('drive_error') || params.get('drive_token')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    // One-time cleanup: legacy token used to live in localStorage. Drop it.
    try { localStorage.removeItem(LEGACY_LS_KEY); } catch {}
    fetch('/api/auth/google')
      .then(response => response.json())
      .then(data => setConnected(Boolean(data.connected)))
      .catch(() => setConnected(false));
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'drive' }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not start Google connection');
      window.location.href = data.url;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setConnected(false);
  };

  const uploadFile = async ({ fileName, fileData, mimeType }) => {
    if (!connected) throw new Error('Not connected to Google Drive');

    const res = await fetch('/api/upload-drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, fileData, mimeType }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  };

  return { connected, connecting, connect, disconnect, uploadFile };
}
