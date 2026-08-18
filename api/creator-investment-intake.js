import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function text(value, max = 2000) {
  const result = (value ?? '').toString().trim();
  return result ? result.slice(0, max) : null;
}

function num(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value) {
  if (Array.isArray(value)) return value.map(v => text(v, 100)).filter(Boolean).slice(0, 30);
  return text(value, 2000)?.split(',').map(v => v.trim()).filter(Boolean).slice(0, 30) || [];
}

function dateOrNull(value) {
  const t = text(value, 40);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

function timestampOrNull(value) {
  const date = dateOrNull(value);
  return date ? `${date}T12:00:00.000Z` : null;
}

function normalizeHandle(value) {
  const raw = text(value, 300);
  if (!raw) return null;
  try {
    const url = raw.startsWith('http') ? new URL(raw) : null;
    const part = url ? url.pathname.split('/').filter(Boolean)[0] : raw;
    return part.replace(/^@/, '').trim() || null;
  } catch {
    return raw.replace(/^@/, '').trim() || null;
  }
}

function instagramUrl(value) {
  const raw = text(value, 1000);
  if (!raw) return null;
  if (raw.startsWith('http')) return raw;
  const handle = normalizeHandle(raw);
  return handle ? `https://www.instagram.com/${handle}/` : null;
}

function engagementType(value) {
  return value === 'retainer' ? 'retainer' : 'one_off';
}

function commitmentPeriod(type) {
  return type === 'retainer' ? 'monthly' : 'total';
}

function seedingStatus(value) {
  const allowed = new Set(['planned', 'ordered', 'in_transit', 'delivered', 'blocked']);
  const status = text(value, 40);
  return allowed.has(status) ? status : 'planned';
}

function deliverableStatus(value) {
  const allowed = new Set(['requested', 'received', 'editing', 'approved', 'complete', 'launched', 'cancelled']);
  const status = text(value, 40);
  return allowed.has(status) ? status : 'requested';
}

function creatorNiche(body) {
  const tags = list(body.niche_tags || body.tags);
  return tags.length ? tags.join(', ') : text(body.niche, 500);
}

function seedItems(body) {
  const raw = Array.isArray(body.seed_items) ? body.seed_items : [];
  const items = raw.map(item => ({
    product_label: text(item.product_label || item.label, 300),
    unit_type: text(item.unit_type || item.sku || item.variant_title, 120),
    quantity: Math.max(1, Math.round(num(item.quantity, 1) || 1)),
    unit_cogs: num(item.unit_cogs, null),
    shopify_product_id: text(item.shopify_product_id, 200),
    shopify_variant_id: text(item.shopify_variant_id, 200),
  })).filter(item => item.product_label || item.unit_type || item.unit_cogs !== null).slice(0, 12);

  if (items.length) return items;
  const legacyUnit = text(body.unit_type, 120);
  const legacyLabel = text(body.product_label, 300);
  if (!legacyUnit && !legacyLabel && num(body.unit_cogs, null) === null) return [];
  return [{
    product_label: legacyLabel,
    unit_type: legacyUnit,
    quantity: Math.max(1, Math.round(num(body.quantity, 1) || 1)),
    unit_cogs: num(body.unit_cogs, null),
    shopify_product_id: text(body.shopify_product_id, 200),
    shopify_variant_id: text(body.shopify_variant_id, 200),
  }];
}

async function resolveCreator(sql, body, userId) {
  const explicitId = Number(body.creator_id) || null;
  if (explicitId) {
    const [creator] = await sql`SELECT * FROM creators WHERE id = ${explicitId}`;
    if (!creator) throw new Error('Selected creator was not found');
    return creator;
  }

  const name = text(body.creator_name, 200);
  const email = text(body.email, 320);
  const handle = normalizeHandle(body.instagram_handle || body.instagram_url);

  if (!name && !email && !handle) throw new Error('Creator name, email, or IG handle is required');

  const matches = await sql`
    SELECT DISTINCT c.*
    FROM creators c
    LEFT JOIN creator_social_accounts s ON s.creator_id = c.id
    WHERE (${email}::text IS NOT NULL AND lower(c.email) = lower(${email}))
       OR (${name}::text IS NOT NULL AND lower(c.name) = lower(${name}))
       OR (${handle}::text IS NOT NULL AND s.platform = 'instagram' AND lower(s.handle) = lower(${handle}))
    ORDER BY c.updated_at DESC
    LIMIT 1
  `;
  if (matches[0]) return matches[0];

  const niche = creatorNiche(body);
  const tags = list(body.niche_tags || body.tags);
  const [created] = await sql`
    INSERT INTO creators (
      name, email, phone, status, stage, source, location, niche, notes,
      tags, product_seeding_required, created_by
    ) VALUES (
      ${name || handle || email}, ${email}, ${text(body.phone, 100)},
      'contracted', 'producing', 'investment_intake',
      ${text(body.location, 200)}, ${niche},
      ${text(body.creator_notes || body.notes, 2000)},
      ${tags}, ${body.product_seeding_required !== false}, ${userId}
    )
    RETURNING *
  `;
  await sql`
    INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
    VALUES (
      ${created.id}, 'investment_intake_created',
      'Creator created from investment intake',
      ${JSON.stringify({ source: 'creator_investment_intake' })}::jsonb,
      ${userId}
    )
  `;
  return created;
}

async function updateCreator(sql, creator, body, userId) {
  const tags = list(body.niche_tags || body.tags);
  const [updated] = await sql`
    UPDATE creators
    SET
      name = COALESCE(${text(body.creator_name, 200)}, name),
      email = COALESCE(${text(body.email, 320)}, email),
      phone = COALESCE(${text(body.phone, 100)}, phone),
      location = COALESCE(${text(body.location, 200)}, location),
      niche = COALESCE(${creatorNiche(body)}, niche),
      tags = CASE
        WHEN cardinality(${tags}::text[]) > 0
        THEN ARRAY(SELECT DISTINCT item FROM unnest(tags || ${tags}::text[]) item)
        ELSE tags
      END,
      notes = COALESCE(${text(body.creator_notes || body.notes, 2000)}, notes),
      status = 'contracted',
      stage = CASE WHEN stage IN ('active', 'producing') THEN stage ELSE 'producing' END,
      product_seeding_required = ${body.product_seeding_required !== false},
      updated_at = now()
    WHERE id = ${creator.id}
    RETURNING *
  `;
  await sql`
    INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
    VALUES (
      ${creator.id}, 'investment_intake_updated',
      'Creator investment details saved',
      ${JSON.stringify({ source: 'creator_investment_intake' })}::jsonb,
      ${userId}
    )
  `;
  return updated;
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
  if (!access) return;
  const { sql, userId } = access;

  try {
    await ensureCreatorOpsTables(sql);

    if (req.method === 'GET') {
      const [creators, units] = await Promise.all([
        sql`
          SELECT id, name, email, stage, status
          FROM creators
          WHERE archived_at IS NULL
          ORDER BY updated_at DESC
          LIMIT 500
        `,
        sql`SELECT unit_type, cogs::float AS cogs, active FROM seeding_units WHERE active ORDER BY cogs DESC`,
      ]);
      return res.json({ creators, units });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    const creator = await resolveCreator(sql, body, userId);
    const updatedCreator = await updateCreator(sql, creator, body, userId);

    const handle = normalizeHandle(body.instagram_handle || body.instagram_url);
    if (handle || body.instagram_url) {
      await sql`
        INSERT INTO creator_social_accounts (creator_id, platform, handle, profile_url, metrics, updated_at)
        VALUES (
          ${updatedCreator.id}, 'instagram', ${handle}, ${instagramUrl(body.instagram_url || handle)},
          ${JSON.stringify({ source: 'creator_investment_intake' })}::jsonb, now()
        )
        ON CONFLICT (creator_id, platform) DO UPDATE SET
          handle = COALESCE(EXCLUDED.handle, creator_social_accounts.handle),
          profile_url = COALESCE(EXCLUDED.profile_url, creator_social_accounts.profile_url),
          metrics = creator_social_accounts.metrics || EXCLUDED.metrics,
          updated_at = now()
      `;
    }

    const type = engagementType(body.engagement_type);
    const assetCommitment = Math.max(0, Math.round(num(body.asset_commitment, 0) || 0));
    const feeAmount = num(body.creator_fee, null);
    let engagement = null;
    if (assetCommitment || feeAmount !== null || text(body.usage_rights) || text(body.engagement_notes)) {
      [engagement] = await sql`
        INSERT INTO creator_engagements (
          creator_id, engagement_type, status, approval_date, starts_on,
          asset_commitment, commitment_period, fee_amount, fee_currency,
          usage_term_months, paid_media_included, whitelisting_monthly_rate,
          payment_terms, notes, created_by
        ) VALUES (
          ${updatedCreator.id}, ${type}, 'approved', ${dateOrNull(body.approval_date) || dateOrNull(body.seeded_on) || null},
          ${dateOrNull(body.starts_on) || dateOrNull(body.seeded_on) || null},
          ${assetCommitment || null}, ${commitmentPeriod(type)}, ${feeAmount}, 'USD',
          ${num(body.usage_term_months, null)}, ${body.paid_media_included !== false},
          ${num(body.whitelisting_monthly_rate, null)},
          ${text(body.payment_terms, 500)},
          ${text(body.engagement_notes || body.usage_rights || body.notes, 2000)},
          ${userId}
        )
        RETURNING *
      `;
    }

    const items = seedItems(body);
    const seedingRows = [];
    const shippingCost = num(body.shipping_cost, 0) || 0;
    const hasLedgerCost = items.length || feeAmount !== null || shippingCost > 0;
    if (hasLedgerCost) {
      const rowsToCreate = items.length ? items : [{ product_label: null, unit_type: null, quantity: 1, unit_cogs: 0 }];
      for (let index = 0; index < rowsToCreate.length; index += 1) {
        const item = rowsToCreate[index];
        const [unit] = item.unit_type
          ? await sql`SELECT cogs::float AS cogs FROM seeding_units WHERE unit_type = ${item.unit_type}`
          : [];
        const unitCogs = num(item.unit_cogs, unit ? unit.cogs : 0) || 0;
        const rowShipping = index === 0 ? shippingCost : 0;
        const rowFee = index === 0 ? (feeAmount || 0) : 0;
        const [row] = await sql`
          INSERT INTO creator_seeding_log (
            creator_id, seeded_on, product_label, unit_type, quantity, unit_cogs,
            shipping_cost, creator_fee, seeding_status, agreed_deliverables,
            deliverable_due, usage_rights, notes, source, created_by
          ) VALUES (
            ${updatedCreator.id}, ${dateOrNull(body.seeded_on)}, ${item.product_label},
            ${item.unit_type}, ${item.quantity}, ${unitCogs},
            ${rowShipping}, ${rowFee}, ${seedingStatus(body.seeding_status)},
            ${index === 0 ? (assetCommitment || null) : null}, ${index === 0 ? dateOrNull(body.deliverable_due) : null},
            ${index === 0 ? text(body.usage_rights, 500) : null}, ${index === 0 ? text(body.notes, 2000) : null},
            'investment_intake', ${userId}
          )
          RETURNING *
        `;
        seedingRows.push(row);
      }
    }
    const seeding = seedingRows[0] || null;
    const productSummary = items.map(item => item.product_label || item.unit_type).filter(Boolean).join(' + ');

    let deliverable = null;
    if (assetCommitment || text(body.deliverable_title) || dateOrNull(body.deliverable_due)) {
      [deliverable] = await sql`
        INSERT INTO creator_deliverables (
          creator_id, engagement_id, title, status, expected_asset_count,
          due_at, source_url, created_by
        ) VALUES (
          ${updatedCreator.id}, ${engagement?.id || null},
          ${text(body.deliverable_title, 300) || `${productSummary || 'Creator'} assets`},
          ${deliverableStatus(body.deliverable_status)},
          ${Math.max(1, assetCommitment || 1)},
          ${timestampOrNull(body.deliverable_due)},
          ${text(body.source_url, 2000)}, ${userId}
        )
        RETURNING *
      `;

      await sql`
        INSERT INTO flow_cards (
          stage, title, product_label, objective, concept_json,
          creator_id, deliverable_id, source_winner_group_key, created_by
        ) VALUES (
          'produce', ${deliverable.title}, ${text(productSummary, 300)},
          ${text(body.objective, 500) || 'Creator investment intake'},
          ${JSON.stringify({
            source: 'creator_investment_intake',
            engagement_id: engagement?.id || null,
            seeding_id: seeding?.id || null,
            seeding_ids: seedingRows.map(row => row.id),
            asset_commitment: assetCommitment || null,
          })}::jsonb,
          ${updatedCreator.id}, ${deliverable.id}, ${`creator_investment:${deliverable.id}`}, ${userId}
        )
      `;
    }

    const investment = {
      product_cogs: seedingRows.reduce((sum, row) => sum + Number(row.unit_cogs || 0) * Number(row.quantity || 1), 0),
      shipping: shippingCost,
      creator_fee: feeAmount || 0,
    };
    investment.total = investment.product_cogs + investment.shipping + investment.creator_fee;

    return res.status(201).json({
      creator: updatedCreator,
      engagement,
      seeding,
      seedings: seedingRows,
      deliverable,
      investment,
    });
  } catch (err) {
    console.error('creator-investment-intake error', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
