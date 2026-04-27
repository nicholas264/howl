import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit || '200'), 1000);
      const creator = req.query.creator || null;
      const rows = creator
        ? await sql`SELECT * FROM launch_history WHERE creator = ${creator} ORDER BY launched_at DESC LIMIT ${limit}`
        : await sql`SELECT * FROM launch_history ORDER BY launched_at DESC LIMIT ${limit}`;
      return res.json({ rows });
    }
    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
