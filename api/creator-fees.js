import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

// Creator-fee notes parsed from the bottom of the UGC Seeding Tracker. They were
// never structured; converting them creates real engagements that flow into the
// Pipeline funnel. Amounts/types are suggestions the user confirms before saving.
const FEE_INTENTS = [
  { creator_name: 'Talon', amount: 1500, type: 'retainer', note: '$1,500 partner retainer' },
  { creator_name: 'Dominique', amount: 1415, type: 'retainer', note: 'Retainer + whitelisting' },
  { creator_name: 'Kenneth Bauer', amount: 1500, type: 'one_off', note: '$1,500 UGC' },
  { creator_name: 'Meesh', amount: 1000, type: 'one_off', note: '$1,000 R1 UGC' },
  { creator_name: 'Kingston', amount: 1000, type: 'one_off', note: '$1,000 (no shoot yet)' },
  { creator_name: 'Fargone', amount: 1000, type: 'one_off', note: 'Confirmed $1,000' },
  { creator_name: 'Maija', amount: 600, type: 'one_off', note: '$600 (waiting on W9)' },
  { creator_name: 'Javaris', amount: 500, type: 'one_off', note: '$500 Haul Bag R4 UGC' },
  { creator_name: 'RyRoams', amount: 450, type: 'retainer', note: '$450 whitelisting (June)' },
  { creator_name: 'Hippiesnap', amount: 400, type: 'one_off', note: '$400 trade for van clips' },
  { creator_name: 'Bodyworkbae', amount: 300, type: 'one_off', note: '$300 single UGC video' },
  { creator_name: 'Jessica (bodywork)', amount: 300, type: 'one_off', note: '$300 confirmed' },
  { creator_name: 'Will', amount: null, type: 'one_off', note: 'TBD' },
  { creator_name: 'Dana', amount: null, type: 'one_off', note: 'Awaiting invoice' },
];

function num(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Best roster match for a fee name: exact, then prefix (so "Dominique" finds
// "Dominique Ritchie"). Returns null when nothing matches.
function matchCreator(name, creators) {
  const n = name.toLowerCase().replace(/\(.*?\)/g, '').trim();
  return creators.find(c => c.name.toLowerCase() === n)
    || creators.find(c => c.name.toLowerCase().startsWith(n + ' '))
    || creators.find(c => c.name.toLowerCase().includes(n))
    || null;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
  if (!access) return;
  const { sql, userId } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const creators = await sql`SELECT id, name FROM creators WHERE name IS NOT NULL`;

    if (req.method === 'GET') {
      // An intent is "converted" once its matched creator has an approved/active
      // engagement at the suggested amount + type.
      const engagements = await sql`
        SELECT creator_id, engagement_type, fee_amount::float AS fee_amount
        FROM creator_engagements WHERE status IN ('approved', 'active')
      `;
      const intents = FEE_INTENTS.map(fee => {
        const match = matchCreator(fee.creator_name, creators);
        const converted = match && engagements.some(e =>
          e.creator_id === match.id && e.engagement_type === fee.type && Math.abs((e.fee_amount || 0) - (fee.amount || 0)) < 1);
        return {
          ...fee,
          suggested_creator_id: match?.id || null,
          suggested_creator_name: match?.name || null,
          converted: !!converted,
        };
      });
      return res.json({ intents, creators: creators.map(c => ({ id: c.id, name: c.name })) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const type = body.type === 'retainer' ? 'retainer' : 'one_off';
      const amount = num(body.amount, 0);
      const assetCommitment = Math.max(0, num(body.asset_commitment, type === 'retainer' ? 1 : 1));
      const note = (body.note || '').toString().slice(0, 1000);

      // Resolve the creator: explicit id, then name match, else create minimal.
      let creatorId = body.creator_id ? Number(body.creator_id) : null;
      if (!creatorId && body.creator_name) {
        const match = matchCreator(body.creator_name, creators);
        creatorId = match?.id || null;
      }
      if (!creatorId && body.creator_name) {
        const [created] = await sql`
          INSERT INTO creators (name, stage, status, source, created_by)
          VALUES (${body.creator_name.toString().slice(0, 200)}, 'active', 'contracted', 'fee_intent', ${userId})
          RETURNING id`;
        creatorId = created.id;
      }
      if (!creatorId) return res.status(400).json({ error: 'creator required' });

      await sql`
        UPDATE creators
        SET stage = 'active',
            status = 'contracted',
            archived_at = NULL,
            archived_by = NULL,
            archive_reason = NULL,
            updated_at = now()
        WHERE id = ${creatorId}
      `;

      const [engagement] = await sql`
        INSERT INTO creator_engagements (
          creator_id, engagement_type, status, commitment_period, asset_commitment,
          fee_amount, fee_currency, notes, created_by
        ) VALUES (
          ${creatorId}, ${type}, 'approved', ${type === 'retainer' ? 'monthly' : 'total'},
          ${assetCommitment}, ${amount || null}, 'USD', ${note}, ${userId}
        )
        RETURNING id
      `;
      await sql`
        INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
        VALUES (
          ${creatorId}, 'fee_engagement_linked',
          ${`${type === 'retainer' ? 'Retainer' : 'One-off'} creator payment linked`},
          ${JSON.stringify({ fee_amount: amount || null, engagement_id: engagement.id, source: 'creator_fee_intent' })}::jsonb,
          ${userId}
        )
      `;
      return res.status(201).json({ creator_id: creatorId, engagement_id: engagement.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('creator-fees error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
