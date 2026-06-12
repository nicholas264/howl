import { useState, useEffect } from 'react';

const LEGACY_LS_KEY = 'howl_drive_token';

function readConnectedCookie() {
  return document.cookie.split('; ').some(c => c.startsWith('drive_connected=1'));
}

export function useDriveAuth() {
  const [connected, setConnected] = useState(() => readConnectedCookie());

  useEffect(() => {
    // Clean up post-OAuth URL params (still set by callback for UX, plus legacy errors)
    const params = new URLSearchParams(window.location.search);
    if (params.get('drive_connected') || params.get('gmail_connected') || params.get('drive_error') || params.get('drive_token')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    // One-time cleanup: legacy token used to live in localStorage. Drop it.
    try { localStorage.removeItem(LEGACY_LS_KEY); } catch {}
    setConnected(readConnectedCookie());
  }, []);

  const connect = () => {
    window.location.href = '/api/auth/google';
  };

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

  return { connected, connect, disconnect, uploadFile };
}
