import { neon } from '@neondatabase/serverless';
import { requireAuth } from './_lib/auth.js';
import { getAppAccess } from './_lib/app-access.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await requireAuth(req, res);
  if (!auth) return;
  try {
    const access = await getAppAccess(auth, neon(process.env.DATABASE_URL));
    return res.json({...access,auth_subject:auth.authSubject || auth.userId});
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
