import { useState, useEffect } from 'react';

const LS_KEY = 'howl_drive_token';

export function useDriveAuth() {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
  });

  // On mount, check if OAuth just completed (drive_token in URL)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const driveToken = params.get('drive_token');
    const driveError = params.get('drive_error');

    if (driveToken) {
      setToken(driveToken);
      try { localStorage.setItem(LS_KEY, driveToken); } catch {}
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (driveError) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const connect = () => {
    window.location.href = '/api/auth/google';
  };

  const disconnect = () => {
    setToken(null);
    try { localStorage.removeItem(LS_KEY); } catch {}
  };

  const uploadFile = async ({ fileName, fileData, mimeType }) => {
    if (!token) throw new Error('Not connected to Google Drive');

    const res = await fetch('/api/upload-drive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token, fileName, fileData, mimeType }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data; // { id, name, url }
  };

  return { connected: !!token, connect, disconnect, uploadFile };
}
