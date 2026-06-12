import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function clean(value, max = 10000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

async function getWorkflow(sql, creatorId) {
  const [outreach, briefs, deliverables] = await Promise.all([
    sql`
      SELECT * FROM creator_outreach
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT * FROM creator_briefs
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT * FROM creator_deliverables
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
  ]);
  return { outreach, briefs, deliverables };
}

async function generateBrief(sql, creatorId, input) {
  const [creator] = await sql`
    SELECT c.*,
      COALESCE((SELECT json_agg(s) FROM creator_social_accounts s WHERE s.creator_id = c.id), '[]'::json) AS social_accounts,
      COALESCE((SELECT json_agg(a) FROM (
        SELECT kind, summary, created_at FROM creator_activity
        WHERE creator_id = c.id ORDER BY created_at DESC LIMIT 15
      ) a), '[]'::json) AS recent_activity,
      COALESCE((SELECT json_agg(l) FROM (
        SELECT ad_name, product_id, angle_id, launched_at FROM launch_history
        WHERE creator_id = c.id OR lower(creator) = lower(c.name)
        ORDER BY launched_at DESC LIMIT 15
      ) l), '[]'::json) AS past_launches
    FROM creators c WHERE c.id = ${creatorId}
  `;
  if (!creator) throw new Error('Creator not found');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const system = `You are the creator strategist for HOWL Campfires. Write practical, filmable UGC briefs and scripts.
Use the creator's real activities, audience, and history. Do not invent personal facts. Keep the concept direct and product-grounded.
Return only valid JSON with: title, objective, angle, brief, script, deliverables (array of strings).`;
  const prompt = `CREATOR
${JSON.stringify(creator, null, 2)}

REQUEST
Product: ${clean(input.product, 200) || 'Choose the strongest HOWL product fit'}
Objective: ${clean(input.objective, 1000) || 'Create a direct-response paid social asset'}
Angle: ${clean(input.angle, 500) || 'Choose an authentic angle based on this creator'}
Additional direction: ${clean(input.direction, 3000) || 'None'}

The brief must explain the premise, filming environment, hook, proof, product moments, CTA, and exact deliverables.
The script should sound natural for this creator and be usable as a shot-by-shot production guide.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3500,
      temperature: 0.5,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Brief generation failed');
  const text = data.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  return parsed;
}

export default async function handler(req, res) {
  const permission = req.method === 'GET' ? 'briefs.read' : 'briefs.write';
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const creatorId = Number(req.query.creator_id || req.body?.creator_id);
    if (!creatorId) return res.status(400).json({ error: 'creator_id required' });

    if (req.method === 'GET') return res.json(await getWorkflow(sql, creatorId));

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'generate_brief') {
        const generated = await generateBrief(sql, creatorId, body);
        const [brief] = await sql`
          INSERT INTO creator_briefs (
            creator_id, title, product, objective, angle, deliverables,
            brief, script, status, generation_source, created_by
          ) VALUES (
            ${creatorId}, ${clean(generated.title, 300) || 'Creator brief'}, ${clean(body.product, 200)},
            ${clean(generated.objective, 2000)}, ${clean(generated.angle, 1000)},
            ${JSON.stringify(Array.isArray(generated.deliverables) ? generated.deliverables : [])}::jsonb,
            ${clean(generated.brief)}, ${clean(generated.script)}, 'draft', 'ai_creator_context', ${access.userId}
          )
          RETURNING *
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (${creatorId}, 'brief_created', ${`Brief created: ${brief.title}`}, ${JSON.stringify({ brief_id: brief.id })}::jsonb, ${access.userId})
        `;
        return res.status(201).json({ brief, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'outreach') {
        const messageBody = clean(body.body);
        if (!messageBody) return res.status(400).json({ error: 'Message body required' });
        const [message] = await sql`
          INSERT INTO creator_outreach (
            creator_id, channel, direction, subject, body, status, sent_at, created_by
          ) VALUES (
            ${creatorId}, ${clean(body.channel, 30) || 'email'}, 'outbound',
            ${clean(body.subject, 500)}, ${messageBody}, ${body.status === 'sent' ? 'sent' : 'draft'},
            ${body.status === 'sent' ? new Date().toISOString() : null}, ${access.userId}
          )
          RETURNING *
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'outreach', ${body.status === 'sent' ? 'Outreach marked sent' : 'Outreach draft created'},
            ${JSON.stringify({ outreach_id: message.id, channel: message.channel })}::jsonb, ${access.userId}
          )
        `;
        return res.status(201).json({ message, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'deliverable') {
        const title = clean(body.title, 300);
        if (!title) return res.status(400).json({ error: 'Deliverable title required' });
        const [deliverable] = await sql`
          INSERT INTO creator_deliverables (
            creator_id, brief_id, title, status, source_url, drive_file_id,
            ugc_session_id, due_at, created_by
          ) VALUES (
            ${creatorId}, ${Number(body.brief_id) || null}, ${title}, ${clean(body.status, 50) || 'requested'},
            ${clean(body.source_url, 3000)}, ${clean(body.drive_file_id, 300)},
            ${Number(body.ugc_session_id) || null}, ${body.due_at || null}, ${access.userId}
          )
          RETURNING *
        `;
        if (deliverable.ugc_session_id) {
          await sql`
            UPDATE ugc_sessions
            SET creator_id = ${creatorId}, brief_id = ${deliverable.brief_id || null},
                deliverable_id = ${deliverable.id}, updated_at = now()
            WHERE id = ${deliverable.ugc_session_id}
          `;
        }
        return res.status(201).json({ deliverable, workflow: await getWorkflow(sql, creatorId) });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      if (body.resource === 'brief') {
        const [brief] = await sql`
          UPDATE creator_briefs SET
            title = COALESCE(${clean(body.title, 300)}, title),
            brief = COALESCE(${clean(body.brief)}, brief),
            script = COALESCE(${clean(body.script)}, script),
            status = COALESCE(${clean(body.status, 50)}, status),
            updated_at = now()
          WHERE id = ${Number(body.id)} AND creator_id = ${creatorId}
          RETURNING *
        `;
        return brief ? res.json({ brief }) : res.status(404).json({ error: 'Brief not found' });
      }
      if (body.resource === 'deliverable') {
        const [deliverable] = await sql`
          UPDATE creator_deliverables SET
            status = COALESCE(${clean(body.status, 50)}, status),
            source_url = COALESCE(${clean(body.source_url, 3000)}, source_url),
            ugc_session_id = COALESCE(${Number(body.ugc_session_id) || null}, ugc_session_id),
            creative_asset_id = COALESCE(${Number(body.creative_asset_id) || null}, creative_asset_id),
            updated_at = now()
          WHERE id = ${Number(body.id)} AND creator_id = ${creatorId}
          RETURNING *
        `;
        return deliverable ? res.json({ deliverable }) : res.status(404).json({ error: 'Deliverable not found' });
      }
      return res.status(400).json({ error: 'Unknown resource' });
    }

    return res.status(405).end();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
