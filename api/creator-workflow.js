import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { del } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import { submissionTokenHash } from './_lib/creator-submissions.js';
import { agreementTokenHash } from './_lib/creator-agreements.js';

function clean(value, max = 10000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

async function getWorkflow(sql, creatorId) {
  const [outreach, engagements, agreements, briefs, deliverables, submissionLinks] = await Promise.all([
    sql`
      SELECT * FROM creator_outreach
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT * FROM creator_engagements
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
    sql`
      SELECT id, creator_id, engagement_id, title, version, status, expires_at,
        sent_to, sent_at, viewed_at, accepted_name, accepted_email, accepted_at,
        revoked_at, created_at, updated_at
      FROM creator_agreements
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
    sql`
      SELECT id, creator_id, brief_id, title, due_at,
        CASE WHEN status = 'active' AND expires_at <= now() THEN 'expired' ELSE status END AS status,
        upload_count,
        expires_at, last_used_at, created_at
      FROM creator_submission_links
      WHERE creator_id = ${creatorId}
      ORDER BY created_at DESC
      LIMIT 100
    `,
  ]);
  return { outreach, engagements, agreements, briefs, deliverables, submission_links: submissionLinks };
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
        SELECT
          lh.ad_id, lh.ad_name, lh.product_id, lh.angle_id, lh.launched_at,
          COALESCE(sum(i.spend), 0) AS spend,
          COALESCE(sum(i.purchase_value), 0) AS revenue,
          COALESCE(sum(i.purchases), 0) AS purchases,
          max(ca.hook_text_verbatim) AS hook,
          max(ca.hook_type) AS hook_type,
          max(ca.format) AS format,
          max(ca.why_it_worked) AS why_it_worked
        FROM launch_history lh
        LEFT JOIN creative_insights_daily i ON i.ad_id = lh.ad_id
          AND i.date >= current_date - interval '180 days'
        LEFT JOIN creative_performance cp ON cp.ad_id = lh.ad_id
        LEFT JOIN creative_analysis ca ON ca.group_key = cp.group_key
        WHERE lh.creator_id = c.id OR lower(lh.creator) = lower(c.name)
        GROUP BY lh.ad_id, lh.ad_name, lh.product_id, lh.angle_id, lh.launched_at
        ORDER BY COALESCE(sum(i.purchase_value), 0) DESC, lh.launched_at DESC
        LIMIT 15
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
Strategy mode: ${input.strategy_mode === 'net_new' ? 'NET NEW - build a fresh concept from the creator profile and activities' : 'PAST PERFORMERS - preserve proven patterns when useful, without copying'}

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

async function generateOutreach(sql, creatorId, input) {
  const [creator] = await sql`
    SELECT c.*,
      COALESCE((SELECT json_agg(s) FROM creator_social_accounts s WHERE s.creator_id = c.id), '[]'::json) AS social_accounts,
      COALESCE((SELECT json_agg(b) FROM (
        SELECT title, product, objective, angle, status
        FROM creator_briefs WHERE creator_id = c.id
        ORDER BY created_at DESC LIMIT 5
      ) b), '[]'::json) AS recent_briefs
    FROM creators c WHERE c.id = ${creatorId}
  `;
  if (!creator) throw new Error('Creator not found');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      temperature: 0.6,
      system: `Write concise creator outreach for HOWL Campfires. Be specific, human, and direct. Never invent personal facts. Return only JSON with subject and body.`,
      messages: [{
        role: 'user',
        content: `Creator context:\n${JSON.stringify(creator, null, 2)}\n\nPurpose: ${clean(input.purpose, 1000) || 'Introduce HOWL and explore a paid creator partnership'}\nTone: ${clean(input.tone, 100) || 'warm and direct'}\nInclude a clear, low-friction next step.`,
      }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Outreach generation failed');
  const raw = data.content?.filter(block => block.type === 'text').map(block => block.text).join('') || '';
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

export default async function handler(req, res) {
  const body = req.body || {};
  const permission = req.method === 'GET'
    ? 'briefs.read'
    : ((body.action === 'deliverable'
      || body.action === 'ingest_footage'
      || body.action === 'create_submission_link'
      || body.action === 'revoke_submission_link'
      || body.resource === 'deliverable')
      ? 'assets.write'
      : 'briefs.write');
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const creatorId = Number(req.query.creator_id || req.body?.creator_id);
    if (!creatorId) return res.status(400).json({ error: 'creator_id required' });

    if (req.method === 'GET') return res.json(await getWorkflow(sql, creatorId));

    if (req.method === 'POST') {
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

      if (body.action === 'generate_outreach') {
        const generated = await generateOutreach(sql, creatorId, body);
        const [message] = await sql`
          INSERT INTO creator_outreach (
            creator_id, channel, direction, subject, body, status, created_by
          ) VALUES (
            ${creatorId}, 'email', 'outbound', ${clean(generated.subject, 500)},
            ${clean(generated.body)}, 'draft', ${access.userId}
          )
          RETURNING *
        `;
        return res.status(201).json({ message, workflow: await getWorkflow(sql, creatorId) });
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

      if (body.action === 'engagement') {
        const engagementType = body.engagement_type === 'retainer' ? 'retainer' : 'one_off';
        const status = ['draft', 'approved', 'active', 'completed', 'cancelled'].includes(body.status)
          ? body.status
          : 'draft';
        const date = value => {
          if (!value) return null;
          return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
        };
        const approvalDate = date(body.approval_date);
        const startsOn = date(body.starts_on);
        const endsOn = date(body.ends_on);
        if ([approvalDate, startsOn, endsOn].includes(undefined)) {
          return res.status(400).json({ error: 'Engagement dates must use YYYY-MM-DD' });
        }
        const assetCommitment = body.asset_commitment === '' || body.asset_commitment == null
          ? null
          : Math.max(0, Math.min(Number(body.asset_commitment) || 0, 10000));
        const feeAmount = body.fee_amount === '' || body.fee_amount == null
          ? null
          : Math.max(0, Number(body.fee_amount) || 0);
        const rate = value => value === '' || value == null ? null : Math.max(0, Number(value) || 0);
        const usageTermMonths = body.usage_term_months === '' || body.usage_term_months == null
          ? null
          : Math.max(0, Math.min(Number(body.usage_term_months) || 0, 1200));
        const [engagement] = await sql`
          INSERT INTO creator_engagements (
            creator_id, engagement_type, status, approval_date, starts_on, ends_on,
            asset_commitment, cadence, fee_amount, fee_currency, usage_term_months,
            ugc_video_rate, raw_footage_rate, hook_rate, photo_rate, whitelisting_monthly_rate,
            paid_media_included, raw_footage_included, exclusivity_notes,
            payment_terms, notes, created_by
          ) VALUES (
            ${creatorId}, ${engagementType}, ${status}, ${approvalDate}, ${startsOn}, ${endsOn},
            ${assetCommitment}, ${clean(body.cadence, 100)}, ${feeAmount},
            ${clean(body.fee_currency, 10) || 'USD'}, ${usageTermMonths},
            ${rate(body.ugc_video_rate)}, ${rate(body.raw_footage_rate)}, ${rate(body.hook_rate)},
            ${rate(body.photo_rate)}, ${rate(body.whitelisting_monthly_rate)},
            ${body.paid_media_included !== false}, ${body.raw_footage_included === true},
            ${clean(body.exclusivity_notes, 3000)}, ${clean(body.payment_terms, 1000)},
            ${clean(body.notes, 5000)}, ${access.userId}
          )
          RETURNING *
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'engagement_created',
            ${`${engagementType === 'retainer' ? 'Retainer' : 'One-off'} engagement created`},
            ${JSON.stringify({ engagement_id: Number(engagement.id), engagement_type: engagementType })}::jsonb,
            ${access.userId}
          )
        `;
        return res.status(201).json({ engagement, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'create_agreement') {
        const engagementId = Number(body.engagement_id);
        const title = clean(body.title, 300);
        const agreementBody = clean(body.agreement_body, 50000);
        if (!engagementId || !title || !agreementBody) {
          return res.status(400).json({ error: 'Engagement, title, and approved agreement text are required' });
        }
        const [engagement] = await sql`
          SELECT id FROM creator_engagements
          WHERE id = ${engagementId} AND creator_id = ${creatorId}
        `;
        if (!engagement) return res.status(400).json({ error: 'Engagement does not belong to this creator' });
        const expiresInDays = Math.min(Math.max(Number(body.expires_in_days) || 14, 1), 60);
        const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
        const token = randomBytes(32).toString('base64url');
        const [versionRow] = await sql`
          SELECT COALESCE(max(version), 0)::int + 1 AS version
          FROM creator_agreements
          WHERE creator_id = ${creatorId}
        `;
        const [agreement] = await sql`
          INSERT INTO creator_agreements (
            creator_id, engagement_id, title, agreement_body, version, status,
            token_hash, expires_at, created_by
          ) VALUES (
            ${creatorId}, ${engagementId}, ${title}, ${agreementBody}, ${versionRow.version},
            'draft', ${agreementTokenHash(token)}, ${expiresAt}, ${access.userId}
          )
          RETURNING id, creator_id, engagement_id, title, version, status, expires_at, created_at
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'agreement_created', ${`Agreement prepared: ${title}`},
            ${JSON.stringify({ agreement_id: Number(agreement.id), engagement_id: engagementId, version: versionRow.version })}::jsonb,
            ${access.userId}
          )
        `;
        return res.status(201).json({
          agreement,
          agreement_path: `/agreement?token=${encodeURIComponent(token)}`,
          workflow: await getWorkflow(sql, creatorId),
        });
      }

      if (body.action === 'revoke_agreement') {
        const agreementId = Number(body.id);
        if (!agreementId) return res.status(400).json({ error: 'Agreement id required' });
        const [agreement] = await sql`
          UPDATE creator_agreements
          SET status = 'revoked', revoked_at = now(), updated_at = now()
          WHERE id = ${agreementId} AND creator_id = ${creatorId}
            AND status IN ('draft', 'sent')
          RETURNING id, title
        `;
        if (!agreement) return res.status(404).json({ error: 'Revocable agreement not found' });
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'agreement_revoked', ${`Agreement revoked: ${agreement.title}`},
            ${JSON.stringify({ agreement_id: agreementId })}::jsonb, ${access.userId}
          )
        `;
        return res.json({ ok: true, workflow: await getWorkflow(sql, creatorId) });
      }

      if (body.action === 'deliverable') {
        const title = clean(body.title, 300);
        if (!title) return res.status(400).json({ error: 'Deliverable title required' });
        const dueAt = timestamp(body.due_at);
        if (dueAt === undefined) return res.status(400).json({ error: 'Deliverable due date is invalid' });
        const [deliverable] = await sql`
          INSERT INTO creator_deliverables (
            creator_id, brief_id, title, status, source_url, drive_file_id,
            ugc_session_id, due_at, created_by
          ) VALUES (
            ${creatorId}, ${Number(body.brief_id) || null}, ${title}, ${clean(body.status, 50) || 'requested'},
            ${clean(body.source_url, 3000)}, ${clean(body.drive_file_id, 300)},
            ${Number(body.ugc_session_id) || null}, ${dueAt}, ${access.userId}
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
      if (body.action === 'ingest_footage') {
        const title = clean(body.title, 300);
        const videoUrl = clean(body.video_url, 3000);
        if (!title || !videoUrl) return res.status(400).json({ error: 'Footage title and video_url required' });
        const dueAt = timestamp(body.due_at);
        if (dueAt === undefined) return res.status(400).json({ error: 'Footage due date is invalid' });
        let parsedUrl;
        try {
          parsedUrl = new URL(videoUrl);
        } catch {
          return res.status(400).json({ error: 'Footage URL is invalid' });
        }
        if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.blob.vercel-storage.com')) {
          return res.status(400).json({ error: 'Footage must be stored in HOWL Vercel Blob' });
        }
        const briefId = Number(body.brief_id) || null;
        if (briefId) {
          const [brief] = await sql`
            SELECT id FROM creator_briefs
            WHERE id = ${briefId} AND creator_id = ${creatorId}
          `;
          if (!brief) {
            await del(parsedUrl.toString()).catch(() => {});
            return res.status(400).json({ error: 'Selected brief does not belong to this creator' });
          }
        }
        const [ids] = await sql`
          SELECT
            nextval(pg_get_serial_sequence('ugc_sessions', 'id')) AS session_id,
            nextval(pg_get_serial_sequence('creator_deliverables', 'id')) AS deliverable_id
        `;
        const sessionId = Number(ids.session_id);
        const deliverableId = Number(ids.deliverable_id);
        try {
          await sql.transaction(transaction => [
            transaction`
              INSERT INTO ugc_sessions (
                id, user_id, title, file_name, file_size, video_url, settings, status,
                creator_id, brief_id, deliverable_id
              ) VALUES (
                ${sessionId}, ${access.userId}, ${title}, ${clean(body.file_name, 500)},
                ${Number(body.file_size) || null}, ${parsedUrl.toString()}, '{}'::jsonb, 'uploaded',
                ${creatorId}, ${briefId}, ${deliverableId}
              )
            `,
            transaction`
              INSERT INTO creator_deliverables (
                id, creator_id, brief_id, title, status, source_url, ugc_session_id,
                due_at, created_by
              ) VALUES (
                ${deliverableId}, ${creatorId}, ${briefId}, ${title}, 'received',
                ${parsedUrl.toString()}, ${sessionId}, ${dueAt}, ${access.userId}
              )
            `,
            transaction`
              INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
              VALUES (
                ${creatorId}, 'footage_received', ${`Footage received: ${title}`},
                ${JSON.stringify({ deliverable_id: deliverableId, ugc_session_id: sessionId, brief_id: briefId })}::jsonb,
                ${access.userId}
              )
            `,
          ]);
        } catch (err) {
          await del(parsedUrl.toString()).catch(() => {});
          throw err;
        }
        const [linked] = await sql`
          SELECT * FROM creator_deliverables
          WHERE id = ${deliverableId} AND creator_id = ${creatorId}
        `;
        return res.status(201).json({ deliverable: linked, workflow: await getWorkflow(sql, creatorId) });
      }
      if (body.action === 'create_submission_link') {
        const title = clean(body.title, 300);
        if (!title) return res.status(400).json({ error: 'Submission title required' });
        const briefId = Number(body.brief_id) || null;
        if (briefId) {
          const [brief] = await sql`
            SELECT id FROM creator_briefs
            WHERE id = ${briefId} AND creator_id = ${creatorId}
          `;
          if (!brief) return res.status(400).json({ error: 'Selected brief does not belong to this creator' });
        }
        const dueAt = timestamp(body.due_at);
        if (dueAt === undefined) return res.status(400).json({ error: 'Submission due date is invalid' });
        const expiresInDays = Math.min(Math.max(Number(body.expires_in_days) || 14, 1), 60);
        const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
        const token = randomBytes(32).toString('base64url');
        const [link] = await sql`
          INSERT INTO creator_submission_links (
            token_hash, creator_id, brief_id, title, due_at, expires_at, created_by
          ) VALUES (
            ${submissionTokenHash(token)}, ${creatorId}, ${briefId}, ${title},
            ${dueAt}, ${expiresAt}, ${access.userId}
          )
          RETURNING id, creator_id, brief_id, title, due_at, status, upload_count,
            expires_at, last_used_at, created_at
        `;
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'submission_link_created', ${`Upload link created: ${title}`},
            ${JSON.stringify({ submission_link_id: link.id, brief_id: briefId, expires_at: expiresAt })}::jsonb,
            ${access.userId}
          )
        `;
        return res.status(201).json({
          link,
          submission_path: `/submit?token=${encodeURIComponent(token)}`,
          workflow: await getWorkflow(sql, creatorId),
        });
      }
      if (body.action === 'revoke_submission_link') {
        const linkId = Number(body.id);
        if (!linkId) return res.status(400).json({ error: 'Submission link id required' });
        const [link] = await sql`
          UPDATE creator_submission_links
          SET status = 'revoked', updated_at = now()
          WHERE id = ${linkId} AND creator_id = ${creatorId} AND status = 'active'
          RETURNING id, title
        `;
        if (!link) return res.status(404).json({ error: 'Active submission link not found' });
        await sql`
          INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
          VALUES (
            ${creatorId}, 'submission_link_revoked', ${`Upload link revoked: ${link.title}`},
            ${JSON.stringify({ submission_link_id: link.id })}::jsonb, ${access.userId}
          )
        `;
        return res.json({ ok: true, workflow: await getWorkflow(sql, creatorId) });
      }
      return res.status(400).json({ error: 'Unknown action' });
    }

    if (req.method === 'PATCH') {
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
