import { fetchPublicText } from './safe-fetch.js';
import { neon } from '@neondatabase/serverless';
import { HOWL_DEALERS } from '../_data/howl-dealers.js';
import { sendResendEmail } from './resend-email.js';

const DEFAULT_MAP_PRICE = 374;
const DEFAULT_PRODUCTS = [
  {
    id: 'r1',
    name: 'R1',
    mapPrice: DEFAULT_MAP_PRICE,
    terms: ['HOWL R1', 'HOWL Campfires R1', 'HOWL Campfire R1'],
  },
];
const FALLBACK_DISCOVERY_TARGETS = [
  { name: 'CampSaver', url: 'https://www.campsaver.com/howl-campfires-the-howl-r1-773ce090.html' },
  { name: 'Tacoma Lifestyle', url: 'https://www.tacomalifestyle.com/products/howl-campfires-the-howl-r1' },
  { name: 'Baseline Overland', url: 'https://baselineoverland.com/products/howl-r1' },
  { name: 'Smokeforges', url: 'https://smokeforges.com/products/howl-campfires-the-howl-r1-the-portable-propane-fire-pit' },
  { name: 'Gamiviti', url: 'https://www.gamiviti.com/howl-campfires' },
  { name: 'Scheels', url: 'https://www.scheels.com/' },
  { name: 'CB Adventure Supply', url: 'https://www.cbadventuresupply.com/' },
  { name: 'NVMOS', url: 'https://nvmos.com/' },
];
const CURATED_DEALER_TARGET_RULES = [
  {
    match: /scheels/i,
    name: 'Scheels',
    url: 'https://www.scheels.com/p/howl-campfires-the-howl-r1-fire-pit/21079-R1/',
    confidence: 0.95,
  },
  {
    match: /bespoke\s*post/i,
    name: 'Bespoke Post',
    url: 'https://www.bespokepost.com/store/brands/howl-campfires',
    confidence: 0.9,
  },
  {
    match: /atlas\s*outdoors/i,
    name: 'Atlas Outdoors',
    url: 'https://atlasoutdoorsusa.com/',
    confidence: 0.8,
  },
  {
    match: /benchmade/i,
    name: 'Benchmade',
    url: 'https://www.benchmade.com/',
    confidence: 0.85,
  },
  {
    match: /cascade\s*van/i,
    name: 'Cascade Van',
    url: 'https://cascadevan.com/',
    confidence: 0.9,
  },
  {
    match: /dubois\s*et\s*fr[eè]res/i,
    name: 'Dubois et Freres',
    url: 'https://www.duboisetfreres.com/en',
    confidence: 0.9,
  },
  {
    match: /grayl/i,
    name: 'Grayl',
    url: 'https://grayl.com/',
    confidence: 0.85,
  },
  {
    match: /\bframeworks\b/i,
    name: 'Frameworks Bicycles',
    url: 'https://rideframeworks.com/',
    confidence: 0.9,
  },
  {
    match: /horsepower\s*automotive|dominick\s*sandri/i,
    name: 'Horsepower Automotive Group',
    url: 'https://www.horsepowerautomotivegroup.com/',
    confidence: 0.9,
  },
  {
    match: /huckberry/i,
    name: 'Huckberry',
    url: 'https://huckberry.com/',
    confidence: 0.85,
  },
  {
    match: /\bkuat\b/i,
    name: 'Kuat',
    url: 'https://www.kuat.com/',
    confidence: 0.85,
  },
  {
    match: /\bthule\b/i,
    name: 'Thule',
    url: 'https://www.thule.com/',
    confidence: 0.85,
  },
  {
    match: /rugged\s*usa\s*imports/i,
    name: 'Rugged USA Imports',
    url: 'https://howlcampfires.co.nz/',
    confidence: 0.9,
  },
  {
    match: /legay\s*flames|legacy\s*flames/i,
    name: 'Legacy Flames',
    url: 'https://legacyflames.com/',
    confidence: 0.95,
  },
  {
    match: /mule\s*expedition\s*outfitters/i,
    name: 'Mule Expedition Outfitters',
    url: 'https://dasmule.com/',
    confidence: 0.85,
  },
  {
    match: /l\.?o\.?b\.?o\.?\s*adventure|lobo\s*adventure/i,
    name: 'LOBO Adventure Trailers',
    url: 'https://lobotrailers.com/',
    confidence: 0.9,
  },
  {
    match: /mosko\s*motors?/i,
    name: 'Mosko Moto',
    url: 'https://moskomoto.com/',
    confidence: 0.8,
  },
  {
    match: /mystery\s*ranch/i,
    name: 'Mystery Ranch',
    url: 'https://www.mysteryranch.com/',
    confidence: 0.85,
  },
  {
    match: /poncho\s*outdoors/i,
    name: 'Poncho Outdoors',
    url: 'https://www.ponchooutdoors.com/',
    confidence: 0.9,
  },
  {
    match: /shoreline\s*motoring/i,
    name: 'Shoreline Motoring',
    url: 'https://www.shorelinemotoring.com/',
    confidence: 0.75,
  },
  {
    match: /session\s*series|shift\s*events/i,
    name: 'Session Series',
    url: 'https://www.sessionseries.org/',
    confidence: 0.9,
  },
  {
    match: /ex\s*overland/i,
    name: 'EXOverland',
    url: 'https://exoverland.com/',
    confidence: 0.85,
  },
  {
    match: /flatline\s*van/i,
    name: 'Flatline Van Co.',
    url: 'https://flatlinevanco.com/',
    confidence: 0.85,
  },
  {
    match: /geared4utah/i,
    name: 'Geared4Utah',
    url: 'https://geared4utah.com/',
    confidence: 0.85,
  },
  {
    match: /method\s*vans/i,
    name: 'Method Vans',
    url: 'https://www.methodvans.com/',
    confidence: 0.9,
  },
  {
    match: /rsg\s*offroad/i,
    name: 'RSG Offroad',
    url: 'https://rsgoffroad.com/',
    confidence: 0.9,
  },
  {
    match: /rogue\s*van|rogue\s*vehicle/i,
    name: 'Rogue Vehicle Co.',
    url: 'https://roguevehicleco.com/',
    confidence: 0.9,
  },
  {
    match: /rossmonster/i,
    name: 'Rossmonster',
    url: 'https://rossmonster.com/',
    confidence: 0.9,
  },
  {
    match: /selkirk\s*off\s*road/i,
    name: 'Selkirk Offroad',
    url: 'https://selkirkoffroad.com/',
    confidence: 0.9,
  },
  {
    match: /sandhill\s*oil/i,
    name: 'Sandhill Oil',
    url: 'https://sandhilloil.com/',
    confidence: 0.9,
  },
  {
    match: /sandstone\s*ace/i,
    name: 'Sandstone Ace Hardware',
    url: 'https://www.acehardware.com/store-details/15990',
    confidence: 0.9,
  },
  {
    match: /santa\s*fe\s*fat\s*tire/i,
    name: 'Santa Fe Fat Tire Society',
    url: 'https://santafefattiresociety.org/',
    confidence: 0.9,
  },
  {
    match: /stoked/i,
    name: 'Stoked',
    url: 'https://stokeddsm.com/',
    confidence: 0.85,
  },
  {
    match: /wild\s*cane/i,
    name: 'Wild Cane',
    url: 'https://wildcane.com/',
    confidence: 0.75,
  },
  {
    match: /solnix/i,
    name: 'Solnix',
    url: 'https://www.solnix.com/',
    confidence: 0.9,
  },
  {
    match: /\btourig\b/i,
    name: 'Tourig',
    url: 'https://www.tourig.com/',
    confidence: 0.9,
  },
  {
    match: /tru\s*automotive/i,
    name: 'TRU Automotive',
    url: 'https://truautomotive.com/',
    confidence: 0.9,
  },
  {
    match: /turtlebox/i,
    name: 'Turtlebox',
    url: 'https://turtleboxaudio.com/',
    confidence: 0.85,
  },
  {
    match: /vandici|van\s*d.?ici/i,
    name: 'Van d’ici',
    url: 'https://www.vandici.ca/en',
    confidence: 0.9,
  },
  {
    match: /baseline\s*overland/i,
    name: 'Baseline Overland',
    url: 'https://baselineoverland.com/products/howl-r1',
    confidence: 0.95,
  },
  {
    match: /smoke\s*forges?/i,
    name: 'Smoke Forges',
    url: 'https://smokeforges.com/products/howl-campfires-the-howl-r1-the-portable-propane-fire-pit',
    confidence: 0.95,
  },
  {
    match: /gamiviti/i,
    name: 'Gamiviti',
    url: 'https://www.gamiviti.com/howl-campfires',
    confidence: 0.95,
  },
];
const NON_WEB_DEALER_RULES = [
  { match: /^carlin$/i, note: 'Imported contact row has no company, address, phone, or public dealer website signal.' },
  { match: /^caroline$/i, note: 'Imported contact row has no company, address, phone, or public dealer website signal.' },
  { match: /^jeff$/i, note: 'Imported contact row is a first-name-only record; address resolves to Athens Utilities Board, not a HOWL dealer website.' },
  { match: /^marco$/i, note: 'Imported contact row is a first-name-only residential record with no public dealer website signal.' },
  { match: /^max$/i, note: 'Imported contact row has no company, address, phone, or public dealer website signal.' },
  { match: /^mitch$/i, note: 'Imported contact row is a first-name-only record with no public dealer website signal.' },
  { match: /^samantha$/i, note: 'Imported contact row is a first-name-only residential record with no public dealer website signal.' },
  { match: /^steve$/i, note: 'Imported contact row has no company, address, phone, or public dealer website signal.' },
  { match: /^test\s*company$/i, note: 'Test/import placeholder row, not a scannable public dealer website.' },
  { match: /^tourist\s*llc$/i, note: 'Public business directories list Tourist LLC at the imported address but do not list a public website.' },
  { match: /^zach$/i, note: 'Imported contact row is a first-name-only residential record with no public dealer website signal.' },
];

function cleanText(value, max = 2000) {
  return (value || '').toString().replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed || fallback;
  } catch {
    return fallback;
  }
}

function configuredAlertProvider() {
  const requested = cleanText(process.env.MAP_ALERT_PROVIDER || 'resend', 40).toLowerCase();
  if (requested && requested !== 'auto' && requested !== 'resend') return '';
  if (process.env.RESEND_API_KEY) return 'resend';
  return '';
}

function alertProviderLabel(provider = configuredAlertProvider()) {
  if (provider === 'resend') return 'Resend email';
  return 'Not configured';
}

function parseDealerUrls() {
  const configured = parseJsonEnv('HOWL_MAP_DEALERS', null);
  if (Array.isArray(configured)) {
    return configured
      .map(item => (typeof item === 'string' ? { name: hostLabel(item), url: item } : item))
      .filter(item => item?.name || item?.url)
      .map(normalizeDealerRecord);
  }
  return (process.env.HOWL_DEALER_URLS || '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean)
    .map(url => ({ name: hostLabel(url), url }));
}

function normalizeDealerRecord(item) {
  const url = cleanText(item.url || item.website || item.websiteUrl || item.productUrl || '', 1000);
  return {
    id: cleanText(item.id || item.dealer_id || '', 120),
    name: cleanText(item.name || item.company || (url ? hostLabel(url) : ''), 180),
    url,
    websiteUrl: cleanText(item.websiteUrl || item.website_url || item.website || '', 1000),
    productUrl: cleanText(item.productUrl || item.product_url || '', 1000),
    resolutionStatus: cleanText(item.resolutionStatus || item.resolution_status || '', 80),
    resolutionSource: cleanText(item.resolutionSource || item.resolution_source || '', 120),
    resolutionNote: cleanText(item.resolutionNote || item.resolution_note || '', 500),
    address: cleanText(item.address || '', 240),
    city: cleanText(item.city || '', 120),
    region: cleanText(item.region || item.state || item.province || '', 80),
    country: cleanText(item.country || '', 80),
    postalCode: cleanText(item.postalCode || item.zip || '', 40),
    phone: cleanText(item.phone || '', 80),
  };
}

function slugify(value) {
  return cleanText(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function dealerRegistryId(dealer) {
  if (dealer.id) return dealer.id;
  return slugify([dealer.name, dealer.city, dealer.region, dealer.country].filter(Boolean).join('-')) || slugify(dealer.url);
}

function normalizedName(value) {
  return cleanText(value, 180).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function compactName(value) {
  return normalizedName(value).replace(/\s+/g, '');
}

function urlOrigin(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/`;
  } catch {
    return '';
  }
}

function looksLikeProductUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return path.includes('/product') || path.includes('/products/') || (path.includes('howl') && path.includes('r1'));
  } catch {
    return false;
  }
}

function dealerIdentityTokens(dealer) {
  const stop = new Set(['llc', 'inc', 'co', 'company', 'corp', 'corporation', 'ltd', 'limited', 'the', 'and', 'attn', 'nick', 'jeff', 'marco', 'max', 'mitch', 'samantha', 'steve', 'zach', 'carlin', 'caroline']);
  return normalizedName(dealer?.name || '')
    .split(/\s+/)
    .filter(token => token.length >= 4 && !stop.has(token));
}

function hostIdentityConfidence(dealer, url) {
  const host = hostLabel(url).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const tokens = dealerIdentityTokens(dealer);
  const tokenHits = tokens.filter(token => host.includes(token));
  if (tokens.length >= 2 && tokenHits.length >= Math.min(2, tokens.length)) return 0.75;
  if (tokens.length === 1 && tokens[0].length >= 6 && tokenHits.length === 1) return 0.65;
  return 0;
}

async function validateDealerTarget(dealer, target) {
  const url = canonicalUrl(target.url || '');
  if (!dealer || !url || isHowlOwned(url)) return { ok: false, reason: 'missing dealer or url' };
  const html = await fetchOptionalText(url);
  if (!html) return { ok: false, reason: 'candidate website did not load' };
  const text = stripHtml(html).toLowerCase();
  const host = hostLabel(url).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const tokens = dealerIdentityTokens(dealer);
  const productContext = looksLikeProductUrl(url) || text.includes('howl campfires') || text.includes('howl r1') || text.includes('campfire r1');
  const tokenHits = tokens.filter(token => host.includes(token) || text.includes(token));
  if (productContext && tokenHits.length) return { ok: true, confidence: 0.9 };
  if (tokens.length >= 2 && tokenHits.length >= Math.min(2, tokens.length)) return { ok: true, confidence: 0.8 };
  if (tokens.length >= 3 && tokenHits.length >= 2) return { ok: true, confidence: 0.7 };
  return { ok: false, reason: `identity mismatch for ${dealer.name}` };
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (content.type === 'text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n');
}

function parseUrlResults(text) {
  const cleaned = (text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    const rows = Array.isArray(parsed) ? parsed : parsed?.results;
    if (Array.isArray(rows)) {
      return rows
        .map(item => (typeof item === 'string' ? { url: item } : item))
        .filter(item => item?.url)
        .map(item => ({
          name: cleanText(item.name || item.title || hostLabel(item.url), 160),
          url: item.url,
          dealerSource: cleanText(item.dealerSource || item.dealer_source || '', 180),
        }));
    }
  } catch {}
  const urls = [...cleaned.matchAll(/https?:\/\/[^\s"')\]]+/g)].map(match => match[0].replace(/[),.;]+$/, ''));
  return urls.map(url => ({ name: hostLabel(url), url }));
}

function parseIndexedPriceResults(text, products) {
  const cleaned = (text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    const rows = Array.isArray(parsed) ? parsed : parsed?.results;
    if (!Array.isArray(rows)) return [];
    return rows.map(item => {
      const price = Number(item.observedPrice ?? item.observed_price ?? item.price);
      const productName = cleanText(item.productName || item.product_name || 'R1', 160);
      const product = products.find(row => normalizedName(row.name) === normalizedName(productName))
        || products.find(row => (row.terms || []).some(term => normalizedName(term) === normalizedName(productName)))
        || products[0];
      if (!item?.url || !Number.isFinite(price) || !product) return null;
      const mapPrice = Number(product.mapPrice || DEFAULT_MAP_PRICE);
      return {
        dealer_name: cleanText(item.dealerName || item.dealer_name || item.name || hostLabel(item.url), 180),
        dealer_url: canonicalUrl(item.url),
        product_id: product.id,
        product_name: product.name,
        map_price: mapPrice,
        observed_price: price,
        status: price < mapPrice ? 'violation' : 'ok',
        evidence_url: canonicalUrl(item.url),
        evidence: cleanText(item.evidence || item.snippet || 'Price evidence from web search index', 700),
        price_candidates: [{ price, source: 'web_search_index' }],
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function mergeDealerRecords(records) {
  const seen = new Set();
  return records.map(normalizeDealerRecord).filter(dealer => {
    if (!dealer.name && !dealer.url) return false;
    const key = dealer.url
      ? `url:${canonicalUrl(dealer.url)}`
      : `name:${dealer.name.toLowerCase()}|${dealer.city.toLowerCase()}|${dealer.region.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(dealer => ({
    ...dealer,
    id: dealerRegistryId(dealer),
  }));
}

function configuredProducts() {
  const products = parseJsonEnv('HOWL_MAP_PRODUCTS', DEFAULT_PRODUCTS);
  return (Array.isArray(products) ? products : DEFAULT_PRODUCTS).map(product => ({
    id: cleanText(product.id || product.name || 'r1', 80).toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    name: cleanText(product.name || 'R1', 160),
    mapPrice: Number(product.mapPrice || product.map_price || process.env.HOWL_MAP_PRICE || DEFAULT_MAP_PRICE),
    terms: Array.isArray(product.terms) && product.terms.length ? product.terms.map(term => cleanText(term, 160)) : [cleanText(product.name || 'HOWL R1', 160)],
  }));
}

function hostLabel(input) {
  try {
    return new URL(input).hostname.replace(/^www\./, '');
  } catch {
    return cleanText(input, 160);
  }
}

function isHowlOwned(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return host === 'howlcampfires.com';
  } catch {
    return false;
  }
}

function normalizeUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    [...parsed.searchParams.keys()].forEach(key => {
      if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return url;
  }
}

function sameHost(a, b) {
  try {
    return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function stripHtml(html) {
  return cleanText(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '), 8000);
}

function extractLinks(html, baseUrl, products) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const href = normalizeUrl(match[1], baseUrl);
    if (!href || !sameHost(href, baseUrl)) continue;
    const label = stripHtml(match[2]).toLowerCase();
    const urlText = href.toLowerCase();
    const productHit = products.some(product => product.terms.some(term => {
      const needle = term.toLowerCase();
      return label.includes(needle) || urlText.includes(needle.replace(/\s+/g, '-')) || urlText.includes(needle.replace(/\s+/g, ''));
    }));
    if (productHit) links.push(href);
  }
  return [...new Set(links)].slice(0, 8);
}

function productSlugs(products) {
  const slugs = new Set();
  for (const product of products) {
    for (const term of product.terms || []) {
      const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (slug) slugs.add(slug);
    }
    if (product.id) slugs.add(product.id.toLowerCase());
    if (product.name) slugs.add(product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }
  return [...slugs].filter(Boolean);
}

function generatedProductUrls(baseUrl, products) {
  const out = [];
  for (const slug of productSlugs(products)) {
    [
      `/products/${slug}`,
      `/product/${slug}`,
      `/shop/${slug}`,
      `/store/${slug}`,
    ].forEach(path => {
      const url = normalizeUrl(path, baseUrl);
      if (url) out.push(url);
    });
  }
  return out;
}

function extractSitemapUrls(xml, baseUrl, products) {
  const terms = products.flatMap(product => product.terms || []).map(term => term.toLowerCase());
  const slugs = productSlugs(products);
  const matches = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
    .map(match => match[1].trim())
    .filter(url => sameHost(url, baseUrl))
    .filter(url => {
      const lower = url.toLowerCase();
      return terms.some(term => lower.includes(term.toLowerCase().replace(/\s+/g, '-')))
        || slugs.some(slug => lower.includes(slug))
        || (lower.includes('howl') && lower.includes('r1'));
    });
  return [...new Set(matches)].slice(0, 12);
}

function extractStructuredOffers(html) {
  const offers = [];
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const jsonText = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const parsed = JSON.parse(jsonText);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const stack = [...nodes];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== 'object') continue;
        if (node.offers) {
          const rawOffers = Array.isArray(node.offers) ? node.offers : [node.offers];
          rawOffers.forEach(offer => {
            const price = Number(offer?.price || offer?.lowPrice || offer?.highPrice);
            if (Number.isFinite(price)) offers.push({ price, source: 'json_ld', availability: offer.availability || null });
          });
        }
        Object.values(node).forEach(value => {
          if (value && typeof value === 'object') stack.push(value);
        });
      }
    } catch {}
  }
  return offers;
}

function extractPrices(text, product) {
  const prices = [];
  const lower = text.toLowerCase();
  const anchors = [
    product.id,
    product.name,
    ...(product.terms || []),
    'howl',
  ].map(value => (value || '').toString().toLowerCase()).filter(Boolean);
  const patterns = [
    /\$\s*([0-9]{2,4}(?:,[0-9]{3})?(?:\.[0-9]{2})?)/g,
    /(?:sale|regular|price|now|our price)[^$0-9]{0,40}\$\s*([0-9]{2,4}(?:,[0-9]{3})?(?:\.[0-9]{2})?)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const value = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(value) || value < 100 || value > 5000) continue;
      const context = lower.slice(Math.max(0, match.index - 700), Math.min(lower.length, match.index + 700));
      const localContext = lower.slice(Math.max(0, match.index - 140), Math.min(lower.length, match.index + 140));
      const shippingThreshold = /free shipping|shipping on orders|orders over|returns|postage/.test(localContext);
      if (!shippingThreshold && anchors.some(anchor => context.includes(anchor))) prices.push({ price: value, source: 'text' });
    }
  }
  const jsonPricePattern = /"price"\s*:\s*([0-9]{4,6})/g;
  let jsonMatch;
  while ((jsonMatch = jsonPricePattern.exec(text))) {
    const raw = Number(jsonMatch[1]);
    const value = raw / 100;
    if (!Number.isFinite(value) || value < 100 || value > 5000) continue;
    const context = lower.slice(Math.max(0, jsonMatch.index - 700), Math.min(lower.length, jsonMatch.index + 700));
    if (anchors.some(anchor => context.includes(anchor))) prices.push({ price: value, source: 'json_price' });
  }
  return prices;
}

function productForPage(text, products) {
  const lower = text.toLowerCase();
  return products.find(product => product.terms.some(term => lower.includes(term.toLowerCase())));
}

function isEmptySearchPage(url, text) {
  const lowerUrl = (url || '').toLowerCase();
  const lowerText = (text || '').toLowerCase();
  return lowerUrl.includes('/search') && (
    lowerText.includes('0 results found')
    || lowerText.includes('no results found')
    || lowerText.includes('no products found')
    || lowerText.includes('your search did not match')
  );
}

function isListingSearchPage(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return Boolean(parsed.searchParams.get('q')) && (
      path.includes('/search')
      || path === '/collections/all'
      || path.endsWith('/collections/all')
    );
  } catch {
    const lower = (url || '').toLowerCase();
    return lower.includes('?q=') && (lower.includes('/search') || lower.includes('/collections/all'));
  }
}

async function fetchText(url) {
  return (await fetchPublicText(url, { timeoutMs: fetchTimeoutMs() })).text;
}

async function fetchOptionalText(url) {
  try {
    return await fetchText(url);
  } catch {
    return null;
  }
}

function dealerSearchLabel(dealer) {
  return [
    dealer.name,
    dealer.city,
    dealer.region,
    dealer.country,
  ].filter(Boolean).join(', ');
}

function dealerResolveLimit() {
  return Number(process.env.HOWL_MAP_DEALER_RESOLVE_LIMIT || 25);
}

function fetchTimeoutMs() {
  return Math.max(2000, Number(process.env.HOWL_MAP_FETCH_TIMEOUT_MS || 4500));
}

function indexedPriceLimit() {
  return Math.max(0, Number(process.env.HOWL_MAP_INDEXED_PRICE_LIMIT || 0));
}

async function searchInternet(products, dealers = [], options = {}) {
  const resolveLimit = Number(options.resolveLimit || dealerResolveLimit());
  const includeGeneralDiscovery = options.includeGeneralDiscovery !== false;
  const queries = products.flatMap(product => product.terms.slice(0, 2).map(term => `"${term}" price dealer`)).slice(0, 6);
  const results = [];
  if (process.env.BRAVE_SEARCH_API_KEY) {
    for (const q of queries) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5`;
      const response = await fetch(url, { headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY } });
      if (!response.ok) continue;
      const data = await response.json();
      (data.web?.results || []).forEach(item => results.push({ name: item.profile?.name || hostLabel(item.url), url: item.url }));
    }
  } else if (process.env.SERPAPI_KEY) {
    for (const q of queries) {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      (data.organic_results || []).slice(0, 5).forEach(item => results.push({ name: item.source || hostLabel(item.link), url: item.link }));
    }
  } else if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) {
    for (const q of queries) {
      const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(q)}&key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.GOOGLE_SEARCH_CX}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      (data.items || []).slice(0, 5).forEach(item => results.push({ name: item.displayLink || hostLabel(item.link), url: item.link }));
    }
  } else if (process.env.OPENAI_API_KEY) {
    const productTerms = products.flatMap(product => product.terms).slice(0, 8).join(', ');
    const queryText = queries.join('; ');
    const registryDealers = dealers.filter(dealer => dealer.name && !dealer.url);
    const dealerBatches = [];
    for (let i = 0; i < Math.min(registryDealers.length, resolveLimit); i += 20) {
      dealerBatches.push(registryDealers.slice(i, i + 20));
    }
    const prompts = [
      ...dealerBatches.map(batch => [
        'Resolve these HOWL dealer records into official retail websites or HOWL product/listing pages.',
        'Prefer a direct HOWL Campfires R1 product page when one exists. Otherwise return the official dealer website homepage.',
        'Use the city/state to disambiguate similarly named businesses. Exclude HOWL-owned pages, Google Maps, social profiles, directories, review sites, and unrelated companies.',
        'Output only a JSON array with this shape: [{"name":"dealer name","url":"https://dealer-site.example/path","dealerSource":"dealer name from input"}].',
        'If you cannot confidently resolve a dealer, omit it.',
        `Dealers:\n${batch.map(dealer => `- ${dealerSearchLabel(dealer)}`).join('\n')}`,
      ].join('\n')),
      ...(includeGeneralDiscovery ? [[
          'Search the web for US retailers, dealers, outfitters, overland shops, camping stores, sporting goods stores, or marketplaces that appear to offer HOWL Campfires products for sale.',
          `Products/search terms: ${productTerms}.`,
          `Useful search queries: ${queryText}.`,
          'Include dealer homepages when a specific product page is not available in search results; the crawler will follow same-site product links.',
          'Do not include HOWL-owned pages, reviews, social posts, manuals, map direction URLs, or blog articles unless no retailer results exist.',
          'Output a JSON array of candidate pages with this shape: [{"name":"dealer or site name","url":"https://..."}].',
          'If JSON is awkward, plain markdown links are acceptable.',
          'Include up to 20 distinct URLs.',
      ].join('\n'),
      'Search the web for HOWL Campfires R1 propane fire pit retailers or product pages. Return dealer/site names and URLs. Include authorized retailers or shops even if only a homepage is visible.',
      'Find websites outside howlcampfires.com that sell or list HOWL R1, HOWL Campfires R1, or HOWL propane fire pit products. Return URLs.'] : []),
    ];
    for (const input of prompts) {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.HOWL_MAP_SEARCH_MODEL || 'gpt-4.1-mini',
          tools: [{ type: 'web_search', search_context_size: 'low' }],
          tool_choice: 'required',
          input,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        results.push(...parseUrlResults(extractOutputText(data)));
      }
      if (results.length >= 120) break;
    }
  }
  results.push(...FALLBACK_DISCOVERY_TARGETS);
  const seen = new Set();
  return results.filter(item => {
    if (!item.url) return false;
    item.url = canonicalUrl(item.url);
    if (seen.has(item.url)) return false;
    if (isHowlOwned(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 140);
}

async function scanUrl(target, products) {
  if (isHowlOwned(target.url)) return [];
  const targetUrl = canonicalUrl(target.url);
  const productTarget = looksLikeProductUrl(targetUrl);
  const checked = [];
  const pages = [targetUrl];
  const homeHtml = await fetchOptionalText(targetUrl);
  if (homeHtml) {
    checked.push({ url: targetUrl, html: homeHtml });
    if (!productTarget) pages.push(...extractLinks(homeHtml, targetUrl, products));
  }
  if (!productTarget) {
    pages.push(...generatedProductUrls(targetUrl, products));
    const sitemapUrl = normalizeUrl('/sitemap.xml', targetUrl);
    if (sitemapUrl) {
      const sitemap = await fetchOptionalText(sitemapUrl);
      if (sitemap) pages.push(...extractSitemapUrls(sitemap, targetUrl, products));
    }
  }

  for (const url of [...new Set(pages.map(canonicalUrl))].slice(1, 8)) {
    try {
      checked.push({ url, html: await fetchText(url) });
    } catch {}
  }

  let findings = [];
  for (const page of checked) {
    const text = stripHtml(page.html);
    if (isListingSearchPage(page.url) || isEmptySearchPage(page.url, text)) continue;
    const product = productForPage(`${page.url} ${text}`, products);
    if (!product) continue;
    const offers = [...extractStructuredOffers(page.html), ...extractPrices(text, product)];
    const uniquePrices = [...new Map(offers.map(offer => [offer.price, offer])).values()]
      .sort((a, b) => a.price - b.price)
      .slice(0, 8);
    const lowest = uniquePrices[0]?.price || null;
    const status = lowest == null
      ? 'no_price'
      : lowest < product.mapPrice ? 'violation' : 'ok';
    if (status === 'no_price') continue;
    findings.push({
      dealer_name: target.name || hostLabel(page.url),
      dealer_url: target.url,
      product_id: product.id,
      product_name: product.name,
      map_price: product.mapPrice,
      observed_price: lowest,
      status,
      evidence_url: canonicalUrl(page.url),
      evidence: text.slice(0, 700),
      price_candidates: uniquePrices,
    });
  }
  return findings;
}

export async function ensureMapMonitorTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS map_monitor_runs (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      scanned_count INTEGER NOT NULL DEFAULT 0,
      violation_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS map_monitor_findings (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT REFERENCES map_monitor_runs(id) ON DELETE CASCADE,
      dealer_name TEXT,
      dealer_url TEXT,
      product_id TEXT,
      product_name TEXT,
      map_price NUMERIC(10,2),
      observed_price NUMERIC(10,2),
      status TEXT NOT NULL,
      evidence_url TEXT,
      evidence TEXT,
      price_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_map_findings_run ON map_monitor_findings(run_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_map_findings_status ON map_monitor_findings(status, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS map_monitor_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS map_monitor_dealers (
      dealer_id TEXT PRIMARY KEY,
      dealer_name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      region TEXT,
      country TEXT,
      postal_code TEXT,
      phone TEXT,
      website_url TEXT,
      product_url TEXT,
      resolution_status TEXT NOT NULL DEFAULT 'unresolved',
      resolution_source TEXT,
      resolution_note TEXT,
      resolution_confidence NUMERIC(5,2),
      last_resolved_at TIMESTAMPTZ,
      last_scanned_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_map_dealers_status ON map_monitor_dealers(resolution_status, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_map_dealers_name ON map_monitor_dealers(dealer_name)`;
  await sql`
    CREATE TABLE IF NOT EXISTS map_monitor_dealer_targets (
      id BIGSERIAL PRIMARY KEY,
      dealer_name TEXT NOT NULL,
      dealer_source TEXT,
      url TEXT NOT NULL UNIQUE,
      host TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_map_dealer_targets_host ON map_monitor_dealer_targets(host)`;
}

async function seedDealerRegistry(sql, dealers) {
  for (const rawDealer of dealers) {
    const dealer = normalizeDealerRecord(rawDealer);
    const dealerId = dealerRegistryId(dealer);
    if (!dealerId || !dealer.name) continue;
    const configuredUrl = dealer.productUrl || dealer.websiteUrl || dealer.url || '';
    const websiteUrl = dealer.websiteUrl || (!looksLikeProductUrl(configuredUrl) ? configuredUrl : urlOrigin(configuredUrl));
    const productUrl = dealer.productUrl || (looksLikeProductUrl(configuredUrl) ? configuredUrl : '');
    const status = configuredUrl ? 'resolved' : 'unresolved';
    await sql`
      INSERT INTO map_monitor_dealers (
        dealer_id, dealer_name, address, city, region, country, postal_code, phone,
        website_url, product_url, resolution_status, resolution_source, resolution_note,
        last_resolved_at, updated_at
      )
      VALUES (
        ${dealerId}, ${dealer.name}, ${dealer.address}, ${dealer.city}, ${dealer.region}, ${dealer.country},
        ${dealer.postalCode}, ${dealer.phone}, ${websiteUrl || null}, ${productUrl || null}, ${status},
        ${configuredUrl ? 'configured' : null}, ${dealer.resolutionNote || null},
        ${configuredUrl ? new Date().toISOString() : null}, now()
      )
      ON CONFLICT (dealer_id) DO UPDATE SET
        dealer_name = EXCLUDED.dealer_name,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        region = EXCLUDED.region,
        country = EXCLUDED.country,
        postal_code = EXCLUDED.postal_code,
        phone = EXCLUDED.phone,
        website_url = COALESCE(map_monitor_dealers.website_url, EXCLUDED.website_url),
        product_url = COALESCE(map_monitor_dealers.product_url, EXCLUDED.product_url),
        resolution_status = CASE
          WHEN map_monitor_dealers.product_url IS NOT NULL OR map_monitor_dealers.website_url IS NOT NULL OR EXCLUDED.website_url IS NOT NULL OR EXCLUDED.product_url IS NOT NULL THEN 'resolved'
          ELSE map_monitor_dealers.resolution_status
        END,
        updated_at = now()
    `;
  }
}

function dealerFromRegistryRow(row) {
  const productUrl = row.product_url || '';
  const websiteUrl = row.website_url || '';
  return {
    id: row.dealer_id,
    name: row.dealer_name,
    url: productUrl || websiteUrl || '',
    websiteUrl,
    productUrl,
    resolutionStatus: row.resolution_status || 'unresolved',
    resolutionSource: row.resolution_source || '',
    resolutionNote: row.resolution_note || '',
    address: row.address || '',
    city: row.city || '',
    region: row.region || '',
    country: row.country || '',
    postalCode: row.postal_code || '',
    phone: row.phone || '',
    lastResolvedAt: row.last_resolved_at || null,
    lastScannedAt: row.last_scanned_at || null,
  };
}

function dealerCoverage(dealers) {
  const total = dealers.length;
  const resolved = dealers.filter(dealer => dealer.url || dealer.websiteUrl || dealer.productUrl).length;
  const noWebsite = dealers.filter(dealer => dealer.resolutionStatus === 'no_public_website').length;
  const failed = dealers.filter(dealer => dealer.resolutionStatus === 'not_found').length;
  const unresolved = Math.max(0, total - resolved - noWebsite - failed);
  return {
    total,
    resolved,
    noWebsite,
    unresolved,
    failed,
    coveragePct: total ? Math.round(((resolved + noWebsite) / total) * 100) : 0,
    resolvedPct: total ? Math.round((resolved / total) * 100) : 0,
  };
}

async function loadDealerRegistry(sql) {
  const rows = await sql`
    SELECT *
    FROM map_monitor_dealers
    ORDER BY
      CASE WHEN product_url IS NOT NULL OR website_url IS NOT NULL THEN 0 ELSE 1 END,
      dealer_name ASC
  `;
  return rows.map(dealerFromRegistryRow);
}

function findMatchingDealer(target, dealers) {
  const sourceName = normalizedName(target.dealerSource || '');
  const targetName = normalizedName(target.name || '');
  const hostName = normalizedName(target.url ? hostLabel(target.url) : '');
  const sourceCompact = compactName(sourceName);
  const targetCompact = compactName(targetName);
  const hostCompact = compactName(hostName);
  if (!sourceName && !targetName && !hostName) return null;
  return dealers.find(dealer => normalizedName(dealer.name) === sourceName)
    || dealers.find(dealer => normalizedName(dealer.name) === targetName)
    || dealers.find(dealer => {
      const name = compactName(dealer.name);
      return name && (name === sourceCompact || name === targetCompact || name === hostCompact);
    })
    || dealers.find(dealer => {
      const name = normalizedName(dealer.name);
      const compact = compactName(dealer.name);
      return name && (
        (sourceName && sourceName.includes(name))
        || (targetName && targetName.includes(name))
        || (hostName && hostName.includes(name))
        || (sourceName && name.includes(sourceName))
        || (targetName && name.includes(targetName))
        || (compact && (
          (sourceCompact && sourceCompact.includes(compact))
          || (targetCompact && targetCompact.includes(compact))
          || (hostCompact && hostCompact.includes(compact))
          || (hostCompact && compact.includes(hostCompact))
        ))
      );
    })
    || null;
}

async function updateDealerResolution(sql, dealer, target, status = 'resolved') {
  if (!dealer?.id) return;
  const url = canonicalUrl(target.url || '');
  if (!url || isHowlOwned(url)) return;
  const productUrl = looksLikeProductUrl(url) ? url : '';
  const websiteUrl = productUrl ? urlOrigin(url) : url;
  await sql`
    UPDATE map_monitor_dealers
    SET website_url = COALESCE(NULLIF(${websiteUrl}, ''), website_url),
        product_url = COALESCE(NULLIF(${productUrl}, ''), product_url),
        resolution_status = ${status},
        resolution_source = ${target.source || 'web_search'},
        resolution_note = ${cleanText(target.name || hostLabel(url), 500)},
        resolution_confidence = ${Number(target.confidence || 0.75)},
        last_resolved_at = now(),
        updated_at = now()
    WHERE dealer_id = ${dealer.id}
  `;
}

async function markResolutionAttempted(sql, dealers, resolvedTargets) {
  const resolvedIds = new Set(resolvedTargets.map(target => target.dealer?.id).filter(Boolean));
  for (const dealer of dealers) {
    if (!dealer?.id || dealer.url || resolvedIds.has(dealer.id)) continue;
    await sql`
      UPDATE map_monitor_dealers
      SET resolution_status = CASE WHEN resolution_status = 'resolved' THEN resolution_status ELSE 'not_found' END,
          resolution_note = CASE WHEN resolution_status = 'resolved' THEN resolution_note ELSE 'No confident website match from web resolver yet' END,
          last_resolved_at = now(),
          updated_at = now()
      WHERE dealer_id = ${dealer.id}
        AND (website_url IS NULL AND product_url IS NULL)
    `;
  }
}

async function backfillDealerRegistryFromTargets(sql, dealers) {
  const rows = await sql`
    SELECT dealer_name AS name, dealer_source AS "dealerSource", url
    FROM map_monitor_dealer_targets
    WHERE dealer_source IS NOT NULL
      AND dealer_source <> ''
    ORDER BY last_seen_at DESC
    LIMIT 80
  `;
  let count = 0;
  for (const row of rows) {
    const dealer = findMatchingDealer(row, dealers);
    if (!dealer || dealer.url) continue;
    const validation = await validateDealerTarget(dealer, row).catch(() => ({ ok: false }));
    if (!validation.ok) continue;
    await updateDealerResolution(sql, dealer, { ...row, source: 'target_cache', confidence: validation.confidence || 0.65 });
    count += 1;
  }
  return count;
}

async function applyCuratedDealerTargets(sql, dealers) {
  const resolved = [];
  for (const dealer of dealers) {
    const rule = CURATED_DEALER_TARGET_RULES.find(item => item.match.test(dealer.name || ''));
    if (!rule) continue;
    const target = {
      name: rule.name,
      dealerSource: dealer.name,
      url: rule.url,
      source: 'curated_web_search',
      confidence: rule.confidence,
    };
    const url = canonicalUrl(target.url);
    await sql`
      INSERT INTO map_monitor_dealer_targets (dealer_name, dealer_source, url, host, last_seen_at)
      VALUES (${cleanText(target.name || hostLabel(url), 180)}, ${cleanText(target.dealerSource || '', 180)}, ${url}, ${hostLabel(url)}, now())
      ON CONFLICT (url) DO UPDATE
        SET dealer_name = EXCLUDED.dealer_name,
            dealer_source = COALESCE(NULLIF(EXCLUDED.dealer_source, ''), map_monitor_dealer_targets.dealer_source),
            host = EXCLUDED.host,
            last_seen_at = now()
    `;
    await updateDealerResolution(sql, dealer, { ...target, url });
    resolved.push({ target, dealer });
  }
  return resolved;
}

async function applyKnownNonWebDealerClassifications(sql, dealers) {
  let count = 0;
  for (const dealer of dealers) {
    if (!dealer?.id || dealer.url) continue;
    const rule = NON_WEB_DEALER_RULES.find(item => item.match.test(dealer.name || ''));
    if (!rule) continue;
    await sql`
      UPDATE map_monitor_dealers
      SET resolution_status = 'no_public_website',
          resolution_source = 'curated_non_web_record',
          resolution_note = ${rule.note},
          resolution_confidence = 0.95,
          last_resolved_at = now(),
          updated_at = now()
      WHERE dealer_id = ${dealer.id}
        AND website_url IS NULL
        AND product_url IS NULL
    `;
    count += 1;
  }
  return count;
}

export async function getMapSettings(sql) {
  await ensureMapMonitorTables(sql);
  const [row] = await sql`SELECT value FROM map_monitor_settings WHERE key = 'config'`;
  const saved = row?.value || {};
  const configuredDealerRecords = [
    ...HOWL_DEALERS,
    ...(Array.isArray(saved.dealers) ? saved.dealers : []),
    ...parseDealerUrls(),
  ];
  const configuredDealers = mergeDealerRecords(configuredDealerRecords);
  await seedDealerRegistry(sql, configuredDealers);
  const dealers = await loadDealerRegistry(sql);
  const alertProvider = configuredAlertProvider();
  return {
    mapPrice: Number(saved.mapPrice || process.env.HOWL_MAP_PRICE || DEFAULT_MAP_PRICE),
    alertEmails: Array.isArray(saved.alertEmails) ? saved.alertEmails : (process.env.MAP_ALERT_EMAILS || process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean),
    emailConfigured: Boolean(alertProvider),
    alertProvider,
    alertProviderLabel: alertProviderLabel(alertProvider),
    dealers,
    dealerCoverage: dealerCoverage(dealers),
    products: Array.isArray(saved.products) && saved.products.length ? saved.products : configuredProducts(),
    useSearch: saved.useSearch ?? true,
  };
}

export async function saveMapSettings(sql, settings) {
  await ensureMapMonitorTables(sql);
  const payload = {
    mapPrice: Number(settings.mapPrice || DEFAULT_MAP_PRICE),
    alertEmails: (settings.alertEmails || []).map(email => cleanText(email, 320)).filter(Boolean),
    dealers: (settings.dealers || []).map(normalizeDealerRecord).filter(item => item.name || item.url),
    products: (settings.products || DEFAULT_PRODUCTS).map(product => ({
      id: cleanText(product.id || product.name, 80),
      name: cleanText(product.name, 160),
      mapPrice: Number(product.mapPrice || settings.mapPrice || DEFAULT_MAP_PRICE),
      terms: (product.terms || []).map(term => cleanText(term, 160)).filter(Boolean),
    })),
    useSearch: settings.useSearch !== false,
  };
  await sql`
    INSERT INTO map_monitor_settings (key, value, updated_at)
    VALUES ('config', ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return payload;
}

export async function getMapMonitorSummary(sql) {
  await ensureMapMonitorTables(sql);
  const runs = await sql`
    SELECT id, status, started_at, finished_at, scanned_count, violation_count, error
    FROM map_monitor_runs
    ORDER BY started_at DESC
    LIMIT 12
  `;
  const findings = await sql`
    SELECT *
    FROM map_monitor_findings
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return { runs, findings, settings: await getMapSettings(sql) };
}

async function loadStoredDealerTargets(sql) {
  const rows = await sql`
    SELECT dealer_name AS name, dealer_source AS dealer_source, url
    FROM map_monitor_dealer_targets
    ORDER BY last_seen_at DESC
    LIMIT 160
  `;
  return rows.map(row => ({ name: row.name || hostLabel(row.url), dealerSource: row.dealer_source || '', url: row.url }));
}

async function saveDiscoveredDealerTargets(sql, targets, dealers = [], options = {}) {
  const resolved = [];
  for (const target of targets) {
    if (!target.url || isHowlOwned(target.url)) continue;
    const url = canonicalUrl(target.url);
    const dealer = findMatchingDealer(target, dealers);
  if (dealer) {
      if (!options.trustCurated) {
        const validation = await validateDealerTarget(dealer, { ...target, url });
        if (!validation.ok) {
          const hostConfidence = hostIdentityConfidence(dealer, url);
          if (hostConfidence < 0.75) continue;
          target.confidence = hostConfidence;
          target.source = target.source || 'web_search_host_match';
        } else {
          target.confidence = validation.confidence;
        }
      }
    }
    await sql`
      INSERT INTO map_monitor_dealer_targets (dealer_name, dealer_source, url, host, last_seen_at)
      VALUES (${cleanText(target.name || hostLabel(url), 180)}, ${cleanText(target.dealerSource || '', 180)}, ${url}, ${hostLabel(url)}, now())
      ON CONFLICT (url) DO UPDATE
        SET dealer_name = EXCLUDED.dealer_name,
            dealer_source = COALESCE(NULLIF(EXCLUDED.dealer_source, ''), map_monitor_dealer_targets.dealer_source),
            host = EXCLUDED.host,
            last_seen_at = now()
    `;
    if (dealer) {
      await updateDealerResolution(sql, dealer, { ...target, url });
      resolved.push({ target, dealer });
    }
  }
  return resolved;
}

function dealerScanTarget(dealer) {
  const url = dealer.productUrl || dealer.websiteUrl || dealer.url;
  if (!url) return null;
  return {
    name: dealer.name,
    url,
    dealerId: dealer.id,
    dealerSource: dealer.name,
  };
}

async function markDealersScanned(sql, targets) {
  const ids = [...new Set(targets.map(target => target.dealerId).filter(Boolean))];
  for (const id of ids) {
    await sql`
      UPDATE map_monitor_dealers
      SET last_scanned_at = now(), updated_at = now()
      WHERE dealer_id = ${id}
    `;
  }
  const urls = [...new Set(targets.map(target => canonicalUrl(target.url || '')).filter(Boolean))];
  for (const url of urls) {
    await sql`
      UPDATE map_monitor_dealers
      SET last_scanned_at = now(), updated_at = now()
      WHERE product_url = ${url}
         OR website_url = ${url}
    `;
  }
}

async function scanTargets(targets, productList) {
  const findings = [];
  const errors = [];
  const concurrency = Math.max(1, Number(process.env.HOWL_MAP_SCAN_CONCURRENCY || 16));
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async target => {
      try {
        return { target, findings: await scanUrl(target, productList) };
      } catch (err) {
        return { target, error: err };
      }
    }));
    for (const result of results) {
      if (result.error) errors.push(`${result.target.url}: ${result.error.message}`);
      else findings.push(...result.findings);
    }
  }
  return { findings, errors };
}

async function searchIndexedPriceEvidence(targets, productList) {
  if (!process.env.OPENAI_API_KEY || !targets.length || indexedPriceLimit() <= 0) return [];
  const limitedTargets = targets.slice(0, indexedPriceLimit());
  const productTerms = productList.flatMap(product => product.terms || [product.name]).filter(Boolean).join(', ');
  const findings = [];
  for (let i = 0; i < limitedTargets.length; i += 6) {
    const batch = limitedTargets.slice(i, i + 6);
    const input = [
      'Search the web for the current advertised price shown at these dealer/product URLs.',
      `Products to match: ${productTerms}. MAP threshold is $${Number(productList[0]?.mapPrice || DEFAULT_MAP_PRICE).toFixed(2)} for the R1.`,
      'Return only pages that currently show a HOWL R1 / HOWL Campfires R1 price. Exclude HOWL-owned pages.',
      'Output only JSON: [{"dealerName":"...","url":"https://...","productName":"R1","observedPrice":374,"evidence":"short snippet with price"}].',
      'URLs:',
      ...batch.map(target => `- ${target.name || hostLabel(target.url)} | ${target.url}`),
    ].join('\n');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.HOWL_MAP_INDEXED_SEARCH_TIMEOUT_MS || 8000));
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.HOWL_MAP_SEARCH_MODEL || 'gpt-4.1-mini',
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        tool_choice: 'required',
        input,
      }),
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) continue;
    const data = await response.json();
    findings.push(...parseIndexedPriceResults(extractOutputText(data), productList));
  }
  return findings;
}

function violationRowsText(violations) {
  return violations.map(v => `${v.dealer_name || hostLabel(v.evidence_url)}: ${v.product_name} at $${Number(v.observed_price).toFixed(2)} (MAP $${Number(v.map_price).toFixed(2)})\n${v.evidence_url}`).join('\n\n');
}

async function sendResendViolationEmail({ violations, run, settings }) {
  if (!violations.length || !settings.alertEmails.length) return { skipped: true };
  const from = process.env.MAP_ALERT_FROM || 'HOWL MAP Monitor <alerts@howlcampfires.com>';
  const subject = `${violations.length} HOWL MAP violation${violations.length === 1 ? '' : 's'} found`;
  const rows = violationRowsText(violations);
  return sendResendEmail({
    from,
    to: settings.alertEmails,
    subject,
    text: `The morning MAP scan finished with ${violations.length} violation(s).\n\n${rows}\n\nRun ID: ${run.id}`,
  });
}

async function sendViolationAlert({ violations, run, settings }) {
  if (!violations.length || !settings.alertEmails.length) return { skipped: true };
  const provider = configuredAlertProvider();
  if (provider === 'resend') return sendResendViolationEmail({ violations, run, settings });
  return { skipped: true, reason: 'RESEND_API_KEY not configured' };
}

export async function sendMapMonitorTestAlert({ sql = neon(process.env.DATABASE_URL) } = {}) {
  const settings = await getMapSettings(sql);
  const run = { id: `test-${Date.now()}` };
  const violations = [{
    dealer_name: 'MAP Alert Test Dealer',
    dealer_url: 'https://example.invalid/howl-r1',
    product_id: 'r1',
    product_name: 'R1',
    map_price: Number(settings.mapPrice || DEFAULT_MAP_PRICE),
    observed_price: Math.max(1, Number(settings.mapPrice || DEFAULT_MAP_PRICE) - 25),
    status: 'violation',
    evidence_url: 'https://example.invalid/howl-r1',
    evidence: 'Synthetic MAP alert test generated from the HOWL ad engine.',
    price_candidates: [{ price: Math.max(1, Number(settings.mapPrice || DEFAULT_MAP_PRICE) - 25), source: 'test_alert' }],
  }];
  const alert = await sendViolationAlert({ violations, run, settings });
  return {
    ok: !alert.skipped,
    alert,
    settings: {
      alertEmails: settings.alertEmails,
      alertProvider: settings.alertProvider,
      alertProviderLabel: settings.alertProviderLabel,
      emailConfigured: settings.emailConfigured,
    },
  };
}

export async function runMapMonitor({ sql = neon(process.env.DATABASE_URL), force = false } = {}) {
  await ensureMapMonitorTables(sql);
  await sql`
    UPDATE map_monitor_runs
    SET status = 'failed',
        finished_at = now(),
        error = COALESCE(error, 'Run exceeded monitor timeout and was marked stale')
    WHERE status = 'running'
      AND started_at < now() - interval '20 minutes'
  `;
  if (!force) {
    const claimed = await sql`
      INSERT INTO map_monitor_runs (status, started_at)
      SELECT 'running', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM map_monitor_runs
        WHERE started_at::date = CURRENT_DATE AND status = 'complete'
      )
      RETURNING id, started_at
    `;
    if (!claimed.length) return { ok: true, skipped: 'already_ran_today' };
    return runClaimed(sql, claimed[0]);
  }
  const [run] = await sql`INSERT INTO map_monitor_runs (status) VALUES ('running') RETURNING id, started_at`;
  return runClaimed(sql, run);
}

export async function resolveDealerWebsites({ sql = neon(process.env.DATABASE_URL), limit = 50 } = {}) {
  await ensureMapMonitorTables(sql);
  const settings = await getMapSettings(sql);
  await applyCuratedDealerTargets(sql, settings.dealers).catch(() => []);
  await applyKnownNonWebDealerClassifications(sql, settings.dealers).catch(() => 0);
  await backfillDealerRegistryFromTargets(sql, settings.dealers).catch(() => 0);
  const refreshedDealers = await loadDealerRegistry(sql);
  const productList = settings.products.map(product => ({ ...product, mapPrice: Number(product.mapPrice || settings.mapPrice || DEFAULT_MAP_PRICE) }));
  const unresolvedDealers = refreshedDealers
    .filter(dealer => !dealer.url && dealer.resolutionStatus !== 'no_public_website')
    .sort((a, b) => (a.resolutionStatus === 'not_found') - (b.resolutionStatus === 'not_found'));
  const batch = unresolvedDealers.slice(0, Math.max(1, Number(limit || 50)));
  const targets = settings.useSearch
    ? await searchInternet(productList, batch, { resolveLimit: batch.length, includeGeneralDiscovery: false }).catch(() => [])
    : [];
  const resolvedMatches = await saveDiscoveredDealerTargets(sql, targets, refreshedDealers).catch(() => []);
  await markResolutionAttempted(sql, batch, resolvedMatches).catch(() => {});
  const dealers = await loadDealerRegistry(sql);
  return {
    ok: true,
    attempted: batch.length,
    resolved: resolvedMatches.length,
    dealerCoverage: dealerCoverage(dealers),
    dealers,
  };
}

export async function auditDealerWebsites({ sql = neon(process.env.DATABASE_URL), limit = 120 } = {}) {
  await ensureMapMonitorTables(sql);
  const settings = await getMapSettings(sql);
  const dealers = settings.dealers.filter(dealer => dealer.url).slice(0, Math.max(1, Number(limit || 120)));
  const invalid = [];
  const valid = [];
  for (const dealer of dealers) {
    const target = dealerScanTarget(dealer);
    const validation = target
      ? await validateDealerTarget(dealer, target).catch(err => ({ ok: false, reason: err.message }))
      : { ok: false, reason: 'missing url' };
    if (validation.ok) {
      valid.push({ dealer, validation });
      continue;
    }
    invalid.push({ dealer, reason: validation.reason || 'validation failed' });
    await sql`
      UPDATE map_monitor_dealers
      SET website_url = NULL,
          product_url = NULL,
          resolution_status = 'unresolved',
          resolution_source = NULL,
          resolution_note = ${cleanText(`Website audit cleared previous URL: ${validation.reason || 'validation failed'}`, 500)},
          resolution_confidence = NULL,
          updated_at = now()
      WHERE dealer_id = ${dealer.id}
    `;
  }
  const updatedDealers = await loadDealerRegistry(sql);
  return {
    ok: true,
    checked: dealers.length,
    valid: valid.length,
    cleared: invalid.length,
    invalid: invalid.slice(0, 40).map(item => ({
      name: item.dealer.name,
      url: item.dealer.url,
      reason: item.reason,
    })),
    dealerCoverage: dealerCoverage(updatedDealers),
  };
}

async function runClaimed(sql, run) {
  const settings = await getMapSettings(sql);
  await applyCuratedDealerTargets(sql, settings.dealers).catch(() => []);
  await applyKnownNonWebDealerClassifications(sql, settings.dealers).catch(() => 0);
  await backfillDealerRegistryFromTargets(sql, settings.dealers).catch(() => 0);
  const productList = settings.products.map(product => ({ ...product, mapPrice: Number(product.mapPrice || settings.mapPrice || DEFAULT_MAP_PRICE) }));
  const latestDealers = await loadDealerRegistry(sql);
  const unresolvedDealers = latestDealers
    .filter(dealer => !dealer.url)
    .filter(dealer => dealer.resolutionStatus !== 'no_public_website')
    .sort((a, b) => (a.resolutionStatus === 'not_found') - (b.resolutionStatus === 'not_found'));
  const resolveBatch = unresolvedDealers.slice(0, dealerResolveLimit());
  const searchTargets = settings.useSearch ? await searchInternet(productList, resolveBatch).catch(() => []) : [];
  const resolvedMatches = await saveDiscoveredDealerTargets(sql, searchTargets, latestDealers).catch(() => []);
  await markResolutionAttempted(sql, resolveBatch, resolvedMatches).catch(() => {});

  const freshDealers = await loadDealerRegistry(sql);
  const dealerTargets = freshDealers.map(dealerScanTarget).filter(Boolean);
  const targets = [...dealerTargets, ...searchTargets.filter(target => findMatchingDealer(target, freshDealers))];
  const uniqueTargets = [...new Map(targets.filter(item => item.url).map(item => [canonicalUrl(item.url), { ...item, url: canonicalUrl(item.url) }])).values()]
    .slice(0, Number(process.env.HOWL_MAP_SCAN_TARGET_LIMIT || 200));
  let { findings, errors } = await scanTargets(uniqueTargets, productList);
  const urlsWithFindings = new Set(findings.map(finding => canonicalUrl(finding.dealer_url || finding.evidence_url)));
  const blockedOrUnpricedTargets = uniqueTargets.filter(target => !urlsWithFindings.has(canonicalUrl(target.url)));
  const indexedFindings = await searchIndexedPriceEvidence(blockedOrUnpricedTargets, productList).catch(err => {
    errors.push(`web_search_index: ${err.message}`);
    return [];
  });
  findings.push(...indexedFindings);
  await markDealersScanned(sql, uniqueTargets).catch(() => {});
  findings = [...new Map(findings.map(finding => [
    `${canonicalUrl(finding.evidence_url)}:${finding.product_id}:${finding.status}`,
    { ...finding, evidence_url: canonicalUrl(finding.evidence_url) },
  ])).values()];

  for (const finding of findings) {
    await sql`
      INSERT INTO map_monitor_findings (
        run_id, dealer_name, dealer_url, product_id, product_name, map_price, observed_price,
        status, evidence_url, evidence, price_candidates
      )
      VALUES (
        ${run.id}, ${finding.dealer_name}, ${finding.dealer_url}, ${finding.product_id}, ${finding.product_name},
        ${finding.map_price}, ${finding.observed_price}, ${finding.status}, ${finding.evidence_url}, ${finding.evidence},
        ${JSON.stringify(finding.price_candidates)}::jsonb
      )
    `;
  }

  const violations = findings.filter(finding => finding.status === 'violation');
  const email = await sendViolationAlert({ violations, run, settings }).catch(err => ({ skipped: true, reason: err.message }));
  await sql`
    UPDATE map_monitor_runs
    SET status = 'complete', finished_at = now(), scanned_count = ${uniqueTargets.length},
        violation_count = ${violations.length}, error = ${errors.join('\n').slice(0, 5000) || null}
    WHERE id = ${run.id}
  `;
  return {
    ok: true,
    run: { ...run, scanned_count: uniqueTargets.length, violation_count: violations.length },
    findings,
    violations,
    email,
    dealerCoverage: dealerCoverage(freshDealers),
    resolvedThisRun: resolvedMatches.length,
    attemptedResolution: resolveBatch.length,
  };
}
