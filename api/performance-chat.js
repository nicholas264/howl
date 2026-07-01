import { requirePermission } from './_lib/app-access.js';

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'claude-haiku-4-5-20251001',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function compactRows(rows) {
  return (rows || []).slice(-18).map(row => ({
    month: row.month,
    revenue: Math.round(row.revenue || 0),
    netRevenue: Math.round(row.netRevenue || 0),
    adSpend: Math.round(row.adSpend || 0),
    metaSpend: Math.round(row.metaSpend || 0),
    googleSpend: Math.round(row.googleSpend || 0),
    orders: Math.round(row.orders || 0),
    sessions: Math.round(row.sessions || 0),
    cvr: row.cvr == null ? null : Number(row.cvr.toFixed(3)),
    newCustomers: Math.round(row.newCustomers || 0),
    returningCustomers: Math.round(row.returningCustomers || 0),
    ncac: row.ncac == null ? null : Math.round(row.ncac),
    mer: row.blendedRoas == null ? null : Number(row.blendedRoas.toFixed(2)),
    amer: row.newRoas == null ? null : Number(row.newRoas.toFixed(2)),
    cm3: Math.round(row.cm3 || 0),
    netProfit: Math.round(row.netProfit || 0),
    klaviyoRevenue: Math.round(row.klaviyoRevenue || 0),
    klaviyoOrders: Math.round(row.klaviyoOrders || 0),
    klaviyoRevenuePct: row.klaviyoRevenuePct == null ? null : Number((row.klaviyoRevenuePct * 100).toFixed(1)),
    emailOpenRate: row.emailOpenRate == null ? null : Number((row.emailOpenRate * 100).toFixed(1)),
    emailClickRate: row.emailClickRate == null ? null : Number((row.emailClickRate * 100).toFixed(1)),
  }));
}

export default async function handler(req, res) {
  if (!(await requirePermission(req, res, 'analytics.read'))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const body = req.body || {};
  const question = String(body.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question required' });
  if (question.length > 1200) return res.status(400).json({ error: 'question is too long' });

  const context = {
    generatedAt: new Date().toISOString(),
    summary: body.summary || {},
    rows: compactRows(body.rows || []),
    dataHealth: body.dataHealth || {},
  };
  const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;

  const system = [
    'You are HOWL\'s performance analyst for an operator dashboard.',
    'Use only the provided dashboard context. Be direct, numeric, and decision-oriented.',
    'Call out ratio integrity: MER, aMER/new ROAS, NCAC, CVR, Klaviyo revenue share, contribution margin, and net profit.',
    'Distinguish Shopify-verified revenue from platform-reported attribution.',
    'If data is missing or stale, say so and explain what cannot be concluded.',
    'Return concise bullets with specific optimization opportunities and watchouts.',
  ].join(' ');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: 0.2,
        system,
        messages: [{
          role: 'user',
          content: `Question: ${question}\n\nDashboard context:\n${JSON.stringify(context, null, 2)}`,
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Performance analysis failed' });
    const text = (data.content || []).map(part => part.text || '').filter(Boolean).join('\n\n').trim();
    return res.json({ answer: text, model, usage: data.usage || null });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Performance analysis failed' });
  }
}
