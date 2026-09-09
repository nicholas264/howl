import { randomUUID } from 'node:crypto';
import { readCreativeVariants } from './creative-variants.js';
import { fetchPublicResource } from './safe-fetch.js';
import { assert } from '../../src/lib/static-studio/model.js';

export function referenceImages(definition = {}) {
  const hashes = new Map();
  const add = (hash, label) => {
    if (typeof hash === 'string' && /^[a-f0-9]{32}$/i.test(hash)) {
      hashes.set(hash, [...new Set([...(hashes.get(hash) || []), label])]);
    }
  };
  add(definition.image_hash, 'Creative image');
  add(definition.object_story_spec?.link_data?.image_hash, 'Link image');
  for (const image of definition.asset_feed_spec?.images || []) {
    add(image.hash, image.adlabels?.map(l => l.name).filter(Boolean).join(', ') || 'Dynamic alternative');
  }
  for (const [i, card] of (definition.object_story_spec?.link_data?.child_attachments || []).entries()) {
    add(card.image_hash, `Carousel card ${i + 1}`);
  }
  return [...hashes].map(([hash, labels]) => ({hash, label: labels.join(' · ')}));
}

export async function accountReferenceRows(sql) {
  const [variants, freshness] = await Promise.all([
    readCreativeVariants(sql, 30),
    sql`SELECT current_date::text AS through, (current_date-29)::text AS since,
      MAX(date)::text AS latest_date, MAX(synced_at) AS synced_at FROM creative_insights_daily`,
  ]);
  return {
    window: freshness[0],
    variants: variants.map(row => ({
      key: row.variant_key, name: row.name, adIds: row.ad_ids,
      spend: Number(row.spend), purchases: Number(row.purchases),
      roas: row.spend > 0 ? Number(row.purchase_value) / Number(row.spend) : null,
      observedDays: row.observed_days, definitionObservedAt: row.definition_observed_at,
      images: referenceImages(row.definition || {}),
    })).filter(row => row.images.length && row.spend > 0),
  };
}

export async function resolveReferenceImages(hashes, {fetchImpl = globalThis.fetch, token = process.env.META_ACCESS_TOKEN, accountId = process.env.META_AD_ACCOUNT_ID} = {}) {
  assert(token && /^(act_)?\d+$/.test(accountId || ''), 'The workspace Meta connection is not configured.');
  assert(hashes.length > 0 && hashes.length <= 50 && hashes.every(h => /^[a-f0-9]{32}$/i.test(h)), 'Invalid reference images.');
  const query = new URLSearchParams({hashes: JSON.stringify(hashes), fields: 'hash,url,width,height', limit: '50'});
  const response = await fetchImpl(`https://graph.facebook.com/v21.0/act_${accountId.replace(/^act_/, '')}/adimages?${query}`, {
    headers: {Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  assert(response.ok && !result.error, `Meta could not load the original ad images (${response.status}). Check the workspace connection.`);
  return (result.data || []).filter(image => {
    try {
      const url = new URL(image.url);
      return hashes.includes(image.hash) && url.protocol === 'https:' && !url.username && !url.password &&
        (url.hostname.endsWith('.fbcdn.net') || url.hostname.endsWith('.facebook.com'));
    } catch { return false; }
  }).map(({hash, url, width, height}) => ({hash, url, width, height}));
}

export async function importAccountReference(sql, variantKey, hash, putImpl) {
  // Resolve from this account's stored creative definition, never a client URL.
  const {variants} = await accountReferenceRows(sql);
  const variant = variants.find(row => row.key === variantKey);
  assert(variant?.images.some(image => image.hash === hash), 'This image is not in the selected account variant. Refresh the references.');
  const [image] = await resolveReferenceImages([hash]);
  assert(image, 'Meta no longer provides this image. Choose another reference.');
  const original = await fetchPublicResource(image.url, {maxBytes: 30 * 1024 * 1024, timeoutMs: 20000, contentTypes: /^image\/(jpeg|png|webp)(;|$)/i});
  const contentType = original.contentType.split(';')[0];
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const blob = await putImpl(`static-studio/references/${randomUUID()}.${extension}`, original.bytes, {access: 'public', contentType});
  // Metrics remain in the account view and are not added to model input.
  return {url: blob.url, name: variant.name, referenceKey: `${variantKey}:${hash}`};
}
