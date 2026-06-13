import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function clean(value, max = 1000) {
  const result = (value || '').toString().trim();
  return result ? result.slice(0, max) : null;
}

async function shopifyGraphql(query, variables) {
  const store = process.env.SHOPIFY_STORE || 'howl-campfires.myshopify.com';
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
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
  const access = await requirePermission(req, res, req.method === 'GET' ? 'creators.read' : 'creators.write');
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
    const quantity = Math.max(1, Math.min(Number(req.body?.quantity) || 1, 20));
    const variantId = clean(req.body?.variant_id, 300);
    const productTitle = clean(req.body?.product_title, 500);
    if (!variantId || !productTitle || !variantId.startsWith('gid://shopify/ProductVariant/')) {
      return res.status(400).json({ error: 'A valid Shopify product variant is required' });
    }
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
    });
    const createResult = created.draftOrderCreate;
    if (createResult.userErrors?.length) {
      return res.status(400).json({ error: createResult.userErrors.map(error => error.message).join('; ') });
    }
    const draft = createResult.draftOrder;
    const [seed] = await sql`
      INSERT INTO creator_product_seeds (
        creator_id, shop_domain, shopify_product_id, shopify_variant_id,
        product_title, variant_title, sku, quantity, status,
        shopify_draft_order_id, shopify_order_name,
        notes, requested_by
      ) VALUES (
        ${creatorId}, ${store}, ${clean(req.body?.product_id, 300)}, ${variantId},
        ${productTitle}, ${clean(req.body?.variant_title, 500)}, ${clean(req.body?.sku, 200)},
        ${quantity}, 'draft_created', ${draft.id}, ${draft.name},
        ${clean(req.body?.notes, 2000)}, ${access.userId}
      )
      RETURNING *
    `;
    const { data: completed } = await shopifyGraphql(`mutation CompleteCreatorSeed($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: false) {
        draftOrder { id name status order { id name displayFulfillmentStatus } }
        userErrors { field message }
      }
    }`, { id: draft.id });
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
    return res.status(500).json({
      error: /access denied|scope/i.test(err.message)
        ? 'Shopify needs write_draft_orders permission. Reconnect the store from Admin.'
        : err.message,
    });
  }
}
