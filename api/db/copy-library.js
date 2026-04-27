import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (req.method === 'GET') {
      const rows = await sql`SELECT id, label, headline, primary_text, created_at FROM copy_library ORDER BY created_at DESC LIMIT 500`;
      return res.json({ rows });
    }

    if (req.method === 'POST') {
      const { action, id, label, headline, primaryText } = req.body || {};
      if (action === 'add') {
        if (!headline?.trim() && !primaryText?.trim()) return res.status(400).json({ error: 'headline or primaryText required' });
        const rows = await sql`
          INSERT INTO copy_library (label, headline, primary_text)
          VALUES (${label || null}, ${headline || null}, ${primaryText || null})
          RETURNING id, label, headline, primary_text, created_at
        `;
        return res.json({ row: rows[0] });
      }
      if (action === 'delete') {
        if (!id) return res.status(400).json({ error: 'id required' });
        await sql`DELETE FROM copy_library WHERE id = ${id}`;
        return res.json({ ok: true });
      }
      if (action === 'bulk_import') {
        const { items } = req.body || {};
        if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
        let inserted = 0;
        for (const it of items) {
          if (!it.headline && !it.primaryText) continue;
          await sql`
            INSERT INTO copy_library (label, headline, primary_text)
            VALUES (${it.label || null}, ${it.headline || null}, ${it.primaryText || null})
          `;
          inserted++;
        }
        return res.json({ inserted });
      }
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
