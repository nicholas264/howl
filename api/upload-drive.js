// Uploads a base64-encoded file to Google Drive
import { requireAuth } from './_lib/auth.js';

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

export default async function handler(req, res) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { refreshToken, fileName, fileData, mimeType } = req.body;

  if (!refreshToken || !fileName || !fileData) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Exchange refresh token for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });

    const { access_token, error: tokenError } = await tokenRes.json();
    if (tokenError || !access_token) {
      return res.status(401).json({ error: 'Failed to refresh token', detail: tokenError });
    }

    // Strip base64 data URL prefix if present
    const base64Data = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const fileBuffer = Buffer.from(base64Data, 'base64');

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const boundary = 'howl_upload_boundary';

    const metadataStr = JSON.stringify({ name: fileName, parents: [folderId] });

    // Build multipart body
    const parts = [
      `--${boundary}\r\n`,
      `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
      `${metadataStr}\r\n`,
      `--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
    ];

    const partsBuf = Buffer.from(parts.join(''), 'utf-8');
    const endBuf = Buffer.from(`\r\n--${boundary}--`, 'utf-8');
    const body = Buffer.concat([partsBuf, fileBuffer, endBuf]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        body,
      }
    );

    const file = await uploadRes.json();
    if (file.error) return res.status(500).json({ error: file.error.message });

    res.status(200).json({ id: file.id, name: file.name, url: file.webViewLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
