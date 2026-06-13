// Uploads a base64-encoded file to Google Drive
import { requirePermission } from './_lib/app-access.js';
import { getUserGoogleAccessToken } from './_lib/google-user-oauth.js';

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.write');
  if (!access) return;
  if (req.method !== 'POST') return res.status(405).end();

  const { fileName, fileData, mimeType } = req.body;
  if (!fileName || !fileData) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const access_token = await getUserGoogleAccessToken(access.sql, access.userId);

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
    res.status(err.reconnectRequired ? 401 : 500).json({
      error: err.message,
      reconnect_required: Boolean(err.reconnectRequired),
    });
  }
}
