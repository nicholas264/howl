import { ensureOperationJournal, runExternalStep, digest } from './_lib/operation-journal.js';
import { reserveOperationBudget } from './_lib/operation-budget.js';
import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';
import { getShopifyAccessToken } from './_lib/shopify-content.js';

function clean(value, max = 1000) {
  const result = (value || '').toString().trim();
  return result ? result.slice(0, max) : null;
}

async function shopifyGraphql(query, variables, token, operation = null) {
  if (operation) {
    return runExternalStep(operation.sql, { operationKey: operation.key, stepKey: query.match(/mutation\s+(\w+)/)?.[1] || 'mutation', payload: { query, variables }, actorId: operation.actorId }, () => shopifyGraphql(query, variables, token));
  }
  const store = process.env.SHOPIFY_STORE || 'howl-campfires.myshopify.com';
  if (!token) throw new Error('Shopify store is not connected');
  const response = await fetch(`https://${store}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map(error => error.message).join('; ') || `Shopify returned ${response.status}`);
  }
  return { data: payload.data, store };
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'shopify.seed');
  if (!access) return;
  const { sql } = access;
  try {
    await ensureCreatorOpsTables(sql);
    const creatorId = Number(req.query?.creator_id || req.body?.creator_id);
    if (!creatorId) return res.status(400).json({ error: 'creator_id required' });

    if (req.method === 'GET') {
      const seeds = await sql`
        SELECT * FROM creator_product_seeds
        WHERE creator_id = ${creatorId}
        ORDER BY requested_at DESC
        LIMIT 100
      `;
      return res.json({ seeds });
    }

    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.SHOPIFY_SEEDING_ENABLED !== 'true') {
      return res.status(503).json({ error: 'Shopify creator seeding is disabled by the safety switch.' });
    }
    const seedingToken = process.env.SHOPIFY_SEEDING_ACCESS_TOKEN;
    if (!seedingToken) {
      return res.status(503).json({ error: 'A separate least-privilege Shopify seeding token is required.' });
    }
    const maxQuantity = Math.max(1, Math.min(Number(process.env.SHOPIFY_SEEDING_MAX_QUANTITY) || 5, 20));
    const quantity = Number(req.body?.quantity) || 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) {
      return res.status(400).json({ error: `Seed quantity must be between 1 and ${maxQuantity}.` });
    }
    const variantId = clean(req.body?.variant_id, 300);
    const requestKey = clean(req.body?.request_key, 100);
    if (!variantId || !requestKey || !variantId.startsWith('gid://shopify/ProductVariant/')) {
      return res.status(400).json({ error: 'A valid Shopify product variant is required' });
    }
    const [existingSeed] = await sql`
      SELECT * FROM creator_product_seeds WHERE request_key = ${requestKey} LIMIT 1
    `;
    if (existingSeed && (Number(existingSeed.creator_id) !== creatorId || existingSeed.shopify_variant_id !== variantId || Number(existingSeed.quantity) !== quantity)) return res.status(409).json({ error: 'Request key already belongs to another seed.' });
    if (existingSeed?.status === 'ordered') return res.status(200).json({ seed: existingSeed, duplicate: true });
    const dailyLimit = Math.max(1, Math.min(Number(process.env.SHOPIFY_SEEDING_DAILY_LIMIT) || 10, 100));
    const [dailyUsage] = await sql`
      SELECT count(*)::int AS orders
      FROM creator_product_seeds
      WHERE requested_at >= date_trunc('day', now())
        AND status IN ('draft_created', 'ordered')
    `;
    const [creator] = await sql`
      SELECT id, name, email, phone, shipping_address1, shipping_address2,
        shipping_city, shipping_region, shipping_postal_code, shipping_country_code
      FROM creators WHERE id = ${creatorId}
    `;
    if (!creator) return res.status(404).json({ error: 'Creator not found' });
    const missing = [
      ['address', creator.shipping_address1],
      ['city', creator.shipping_city],
      ['state or region', creator.shipping_region],
      ['postal code', creator.shipping_postal_code],
      ['country', creator.shipping_country_code],
    ].filter(([, value]) => !value).map(([label]) => label);
    if (missing.length) return res.status(400).json({ error: `Creator shipping ${missing.join(', ')} required` });

    const catalogToken = await getShopifyAccessToken();
    const { data: catalogData } = await shopifyGraphql(`query ValidateCreatorSeedVariant($id: ID!) {
      productVariant(id: $id) {
        id title sku availableForSale inventoryQuantity
        product { id title status }
      }
    }`, { id: variantId }, catalogToken);
    const catalogVariant = catalogData.productVariant;
    if (!catalogVariant || catalogVariant.product?.status !== 'ACTIVE' || !catalogVariant.availableForSale) {
      return res.status(400).json({ error: 'This Shopify variant is not active and available for sale.' });
    }
    if (Number.isFinite(catalogVariant.inventoryQuantity) && catalogVariant.inventoryQuantity < quantity) {
      return res.status(400).json({ error: 'The requested quantity exceeds available Shopify inventory.' });
    }
    const productTitle = catalogVariant.product.title;

    await ensureOperationJournal(sql);
    const operation = { sql, key: digest(['seed', requestKey]), actorId: access.userId };
    if (!existingSeed) await reserveOperationBudget(sql, 'shopify.seed', operation.key, dailyLimit, Number(dailyUsage?.orders || 0));

    const lineItem = {
      variantId,
      quantity,
      appliedDiscount: {
        description: 'HOWL creator product seeding',
        value: 100,
        valueType: 'PERCENTAGE',
      },
    };
    const { data: created, store } = await shopifyGraphql(`mutation CreateCreatorSeed($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name status totalPriceSet { shopMoney { amount currencyCode } } }
        userErrors { field message }
      }
    }`, {
      input: {
        email: creator.email || undefined,
        note: `HOWL creator seed for ${creator.name}. ${clean(req.body?.notes, 2000) || ''}`.trim(),
        tags: ['HOWL Creator Seed', creator.name],
        lineItems: [lineItem],
        shippingAddress: {
          firstName: creator.name.split(/\s+/)[0] || creator.name,
          lastName: creator.name.split(/\s+/).slice(1).join(' ') || '-',
          address1: creator.shipping_address1,
          address2: creator.shipping_address2 || undefined,
          city: creator.shipping_city,
          provinceCode: creator.shipping_region,
          zip: creator.shipping_postal_code,
          countryCode: creator.shipping_country_code,
          phone: creator.phone || undefined,
        },
      },
    }, seedingToken, operation);
    const createResult = created.draftOrderCreate;
    if (createResult.userErrors?.length) {
      return res.status(400).json({ error: createResult.userErrors.map(error => error.message).join('; ') });
    }
    const draft = createResult.draftOrder;
    const draftTotal = Number(draft.totalPriceSet?.shopMoney?.amount);
    if (!Number.isFinite(draftTotal) || draftTotal !== 0) {
      return res.status(409).json({
        error: 'Shopify created a non-zero draft. It was not completed. Review the draft in Shopify.',
      });
    }
    const [seed] = await sql`
      INSERT INTO creator_product_seeds (
        creator_id, shop_domain, shopify_product_id, shopify_variant_id,
        product_title, variant_title, sku, quantity, status,
        shopify_draft_order_id, shopify_order_name, request_key,
        notes, requested_by
      ) VALUES (
        ${creatorId}, ${store}, ${clean(req.body?.product_id, 300)}, ${variantId},
        ${productTitle}, ${clean(req.body?.variant_title, 500)}, ${clean(req.body?.sku, 200)},
        ${quantity}, 'draft_created', ${draft.id}, ${draft.name}, ${requestKey},
        ${clean(req.body?.notes, 2000)}, ${access.userId}
      )
      ON CONFLICT (request_key) DO UPDATE SET request_key = EXCLUDED.request_key
      RETURNING *
    `;
    const { data: completed } = await shopifyGraphql(`mutation CompleteCreatorSeed($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: false) {
        draftOrder { id name status order { id name displayFulfillmentStatus } }
        userErrors { field message }
      }
    }`, { id: draft.id }, seedingToken, operation);
    const completeResult = completed.draftOrderComplete;
    if (completeResult.userErrors?.length) {
      return res.status(202).json({
        seed,
        warning: `Shopify saved the draft but could not create the order: ${completeResult.userErrors.map(error => error.message).join('; ')}`,
      });
    }
    const completedDraft = completeResult.draftOrder;
    const order = completedDraft.order;
    const [orderedSeed] = await sql`
      UPDATE creator_product_seeds
      SET status = 'ordered',
        shopify_order_id = ${order?.id || null},
        shopify_order_name = ${order?.name || draft.name},
        ordered_at = now(),
        updated_at = now()
      WHERE id = ${seed.id}
      RETURNING *
    `;
    await sql`
      INSERT INTO creator_activity (creator_id, kind, summary, metadata, user_id)
      VALUES (
        ${creatorId}, 'product_seeded', ${`Product seeded: ${productTitle}`},
        ${JSON.stringify({ seed_id: Number(orderedSeed.id), shopify_order_id: order?.id, quantity })}::jsonb,
        ${access.userId}
      )
    `;
    return res.status(201).json({ seed: orderedSeed });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      error: /access denied|scope/i.test(err.message)
        ? 'The separate Shopify seeding token needs draft-order permission.'
        : err.message,
    });
  }
}
