import { requirePermission, hasPermission } from './_lib/app-access.js';
import { shopifyContentConfig } from './_lib/shopify-content.js';

function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid outreach record.');
  for (const [key, max] of [['customer_key', 200], ['anchor_order_id', 100], ['owner', 120], ['notes', 5000]]) {
    if (typeof body[key] !== 'string' || body[key].length > max) throw new Error(`Invalid ${key}.`);
  }
  if (!/^(customer:|guest:).+/.test(body.customer_key) || !body.anchor_order_id.trim()) throw new Error('Select a dealer with a stable customer identity.');
  if (!['uncontacted','contacted','replied','expected','closed'].includes(body.status)) throw new Error('Invalid outreach status.');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error('Invalid record version. Refresh and retry.');
  for (const key of ['last_contact','next_follow_up']) {
    const value = body[key];
    if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new Error(`Invalid ${key} date.`);
  }
  if (['contacted','replied','expected'].includes(body.status) && !body.last_contact) throw new Error('Add the last contact date for this status.');
  if (body.last_contact && body.last_contact > new Date(Date.now() + 86400000).toISOString().slice(0,10)) throw new Error('Last contact cannot be in the future.');
  if (body.last_contact && body.next_follow_up && body.next_follow_up < body.last_contact) throw new Error('Follow-up must be on or after the contact date.');
  return body;
}

export function createDealerOutreachHandler({ authorize = requirePermission, getShop = () => shopifyContentConfig('dealer').store } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET','PUT'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    const access = await authorize(req, res, req.method === 'GET' ? 'analytics.read' : 'analytics.write');
    if (!access) return;
    const shop = getShop();
    if (!shop) return res.status(503).json({ error: 'Dealer store is not configured.' });
    const { sql, userId } = access;
    let body;
    if (req.method === 'PUT') {
      try { body = validate(req.body); }
      catch (err) { return res.status(400).json({ error: err.message }); }
    }
    try {
      if (req.method === 'GET') {
        const records = await sql`SELECT * FROM dealer_outreach WHERE shop = ${shop} ORDER BY updated_at DESC`;
        return res.json({ records, canWrite: hasPermission(access, 'analytics.write') });
      }
      const b = body;
      let rows;
      if (b.revision === 0) {
        rows = await sql`INSERT INTO dealer_outreach (shop, customer_key, anchor_order_id, status, owner, last_contact, next_follow_up, notes, updated_by)
          VALUES (${shop}, ${b.customer_key}, ${b.anchor_order_id}, ${b.status}, ${b.owner.trim()}, ${b.last_contact}, ${b.next_follow_up}, ${b.notes.trim()}, ${userId})
          ON CONFLICT DO NOTHING RETURNING *`;
      } else {
        rows = await sql`UPDATE dealer_outreach SET status = ${b.status}, owner = ${b.owner.trim()}, last_contact = ${b.last_contact},
          next_follow_up = ${b.next_follow_up}, notes = ${b.notes.trim()}, updated_by = ${userId}, updated_at = now(), revision = revision + 1
          WHERE shop = ${shop} AND customer_key = ${b.customer_key} AND anchor_order_id = ${b.anchor_order_id} AND revision = ${b.revision} RETURNING *`;
      }
      if (!rows.length) return res.status(409).json({ error: 'Someone updated this dealer. Reload contact tracking, then reopen the record before saving.' });
      return res.json({ record: rows[0] });
    } catch (err) {
      console.error('Dealer outreach storage failed:', err.code || 'unknown');
      return res.status(503).json({ error: 'Contact tracking is unavailable. Your changes were not saved. Retry after refreshing contact tracking.' });
    }
  };
}
export default createDealerOutreachHandler();
