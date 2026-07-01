import { neon } from '@neondatabase/serverless';
import { requirePermission } from './_lib/app-access.js';

const API_ROOT = 'https://a.klaviyo.com/api';
const DEFAULT_REVISION = '2026-04-15';
const DEFAULT_TIMEZONE = 'America/Chicago';

const METRIC_ALIASES = {
  placedOrder: ['Placed Order', 'Ordered Product'],
  receivedEmail: ['Received Email', 'Email Received'],
  openedEmail: ['Opened Email', 'Email Opened'],
  clickedEmail: ['Clicked Email', 'Email Clicked'],
  unsubscribed: ['Unsubscribed', 'Unsubscribed from Email Marketing'],
  receivedSms: ['Received SMS', 'SMS Received', 'Sent SMS', 'SMS Sent'],
  clickedSms: ['Clicked SMS', 'SMS Clicked'],
  unsubscribedSms: ['Unsubscribed from SMS Marketing', 'Unsubscribed SMS', 'SMS Unsubscribed'],
};

function monthKey(dateString) {
  return String(dateString || '').slice(0, 7);
}

function addMetric(months, month, key, value) {
  if (!month) return;
  if (!months[month]) {
    months[month] = {
      month,
      revenue: 0,
      orders: 0,
      flowRevenue: 0,
      campaignRevenue: 0,
      emailSends: 0,
      emailOpens: 0,
      emailClicks: 0,
      unsubscribes: 0,
      smsSends: 0,
      smsClicks: 0,
      smsUnsubscribes: 0,
    };
  }
  months[month][key] += Number(value || 0);
}

function seriesFromAggregate(payload, measurement) {
  const attrs = payload?.data?.attributes || payload?.attributes || {};
  const dates = attrs.dates || [];
  const rows = attrs.data || [];
  const out = {};
  for (const row of rows) {
    const values = row?.measurements?.[measurement] || [];
    values.forEach((value, i) => {
      const mk = monthKey(dates[i]);
      if (!mk) return;
      out[mk] = (out[mk] || 0) + Number(value || 0);
    });
  }
  return out;
}

function topDimensionsFromAggregate(payload, measurement, { limit = 8, fallbackPrefix = 'Klaviyo item' } = {}) {
  const attrs = payload?.data?.attributes || payload?.attributes || {};
  const rows = attrs.data || [];
  return rows.map(row => {
    const id = (row?.dimensions || []).filter(Boolean).join(' / ') || 'unattributed';
    const total = (row?.measurements?.[measurement] || []).reduce((sum, value) => sum + Number(value || 0), 0);
    return {
      id,
      name: id === 'unattributed' ? 'Unattributed' : `${fallbackPrefix} ${id}`,
      revenue: total,
    };
  }).filter(item => item.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

function dateRange(monthsBack) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - (monthsBack - 1), 1);
  const iso = (date) => date.toISOString().slice(0, 19);
  return { start: iso(start), end: iso(end) };
}

function normalizeMetricName(name) {
  return String(name || '').trim().toLowerCase();
}

class KlaviyoClient {
  constructor(apiKey, revision) {
    this.apiKey = apiKey;
    this.revision = revision || DEFAULT_REVISION;
  }

  async request(path, options = {}) {
    const r = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Klaviyo-API-Key ${this.apiKey}`,
        revision: this.revision,
        ...(options.headers || {}),
      },
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) {
      const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || text.slice(0, 300);
      throw new Error(`Klaviyo API ${r.status}: ${detail}`);
    }
    return data;
  }

  async listMetrics() {
    const metrics = [];
    let path = '/metrics?fields[metric]=name,integration';
    for (let i = 0; i < 10 && path; i++) {
      const data = await this.request(path);
      metrics.push(...(data?.data || []));
      const next = data?.links?.next;
      path = next ? next.replace(API_ROOT, '') : '';
    }
    return metrics;
  }

  async aggregate(metricId, measurements, { by = null, filter = [], months = 14, timezone = DEFAULT_TIMEZONE } = {}) {
    const { start, end } = dateRange(months);
    const attributes = {
      metric_id: metricId,
      measurements,
      interval: 'month',
      timezone,
      filter: [
        `greater-or-equal(datetime,${start})`,
        `less-than(datetime,${end})`,
        ...filter,
      ],
    };
    if (by?.length) attributes.by = by;
    return this.request('/metric-aggregates', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'metric-aggregate',
          attributes,
        },
      }),
    });
  }
}

function findMetricIds(metrics) {
  const byName = new Map(metrics.map(metric => [normalizeMetricName(metric.attributes?.name), metric.id]));
  const find = (aliases) => aliases.map(normalizeMetricName).map(name => byName.get(name)).find(Boolean) || null;
  return Object.fromEntries(Object.entries(METRIC_ALIASES).map(([key, aliases]) => [key, find(aliases)]));
}

async function upsertMonthly(sql, monthsArr) {
  await sql`
    CREATE TABLE IF NOT EXISTS monthly_metrics (
      month      TEXT PRIMARY KEY,
      shopify    JSONB,
      meta       JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE monthly_metrics ADD COLUMN IF NOT EXISTS shopify_dealer JSONB`;
  await sql`ALTER TABLE monthly_metrics ADD COLUMN IF NOT EXISTS google JSONB`;
  await sql`ALTER TABLE monthly_metrics ADD COLUMN IF NOT EXISTS klaviyo JSONB`;
  for (const m of monthsArr) {
    const existing = await sql`SELECT shopify, shopify_dealer, meta, google, klaviyo FROM monthly_metrics WHERE month = ${m.month}`;
    const prev = existing[0] || {};
    await sql`
      INSERT INTO monthly_metrics (month, shopify, shopify_dealer, meta, google, klaviyo, updated_at)
      VALUES (
        ${m.month},
        ${prev.shopify ? JSON.stringify(prev.shopify) : null}::jsonb,
        ${prev.shopify_dealer ? JSON.stringify(prev.shopify_dealer) : null}::jsonb,
        ${prev.meta ? JSON.stringify(prev.meta) : null}::jsonb,
        ${prev.google ? JSON.stringify(prev.google) : null}::jsonb,
        ${JSON.stringify({ ...m, snapshotAt: new Date().toISOString() })}::jsonb,
        now()
      )
      ON CONFLICT (month) DO UPDATE SET
        klaviyo    = EXCLUDED.klaviyo,
        updated_at = now()
    `;
  }
}

export default async function handler(req, res) {
  if (!(await requirePermission(req, res, 'analytics.read'))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const action = req.body?.action || 'get_monthly';
  if (action !== 'get_monthly') return res.status(400).json({ error: `Unknown action: ${action}` });

  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      configured: false,
      months: [],
      error: 'KLAVIYO_API_KEY not configured',
      missing: ['KLAVIYO_API_KEY'],
    });
  }

  try {
    const client = new KlaviyoClient(apiKey, process.env.KLAVIYO_REVISION || DEFAULT_REVISION);
    const monthsBack = Math.min(Math.max(parseInt(req.body?.months ?? 14, 10) || 14, 1), 12);
    const timezone = process.env.KLAVIYO_TIMEZONE || DEFAULT_TIMEZONE;
    const metrics = await client.listMetrics();
    const metricIds = findMetricIds(metrics);
    const placedOrderId = process.env.KLAVIYO_CONVERSION_METRIC_ID || metricIds.placedOrder;
    if (!placedOrderId) {
      return res.status(200).json({
        configured: false,
        months: [],
        metricsAvailable: metrics.map(metric => metric.attributes?.name).filter(Boolean).slice(0, 50),
        error: 'Could not find Klaviyo Placed Order metric. Set KLAVIYO_CONVERSION_METRIC_ID.',
        missing: ['KLAVIYO_CONVERSION_METRIC_ID'],
      });
    }

    const months = {};
    const safeAggregate = async (label, fn) => {
      try { return await fn(); }
      catch (err) {
        console.warn(`Klaviyo ${label} skipped:`, err.message);
        return null;
      }
    };

    const placedOrder = await client.aggregate(placedOrderId, ['sum_value', 'count'], { months: monthsBack, timezone });
    const revenueByMonth = seriesFromAggregate(placedOrder, 'sum_value');
    const ordersByMonth = seriesFromAggregate(placedOrder, 'count');
    for (const [mk, value] of Object.entries(revenueByMonth)) addMetric(months, mk, 'revenue', value);
    for (const [mk, value] of Object.entries(ordersByMonth)) addMetric(months, mk, 'orders', value);

    const [flowRevenue, campaignRevenue] = await Promise.all([
      safeAggregate('flow revenue', () => client.aggregate(placedOrderId, ['sum_value'], {
        by: ['$attributed_flow'],
        filter: ['not(equals($attributed_flow,""))'],
        months: monthsBack,
        timezone,
      })),
      safeAggregate('campaign revenue', () => client.aggregate(placedOrderId, ['sum_value'], {
        by: ['$attributed_message'],
        filter: ['not(equals($attributed_message,""))'],
        months: monthsBack,
        timezone,
      })),
    ]);
    const topFlows = topDimensionsFromAggregate(flowRevenue, 'sum_value', { fallbackPrefix: 'Flow' });
    const topMessages = topDimensionsFromAggregate(campaignRevenue, 'sum_value', { fallbackPrefix: 'Message' });
    for (const [mk, value] of Object.entries(seriesFromAggregate(flowRevenue, 'sum_value'))) addMetric(months, mk, 'flowRevenue', value);
    for (const [mk, value] of Object.entries(seriesFromAggregate(campaignRevenue, 'sum_value'))) addMetric(months, mk, 'campaignRevenue', value);

    const engagementJobs = [
      ['receivedEmail', 'emailSends', 'count'],
      ['openedEmail', 'emailOpens', 'unique'],
      ['clickedEmail', 'emailClicks', 'unique'],
      ['unsubscribed', 'unsubscribes', 'count'],
      ['receivedSms', 'smsSends', 'count'],
      ['clickedSms', 'smsClicks', 'unique'],
      ['unsubscribedSms', 'smsUnsubscribes', 'count'],
    ].filter(([metricKey]) => metricIds[metricKey]);
    const engagement = await Promise.all(engagementJobs.map(([metricKey, field, measurement]) =>
      safeAggregate(metricKey, async () => ({
        field,
        measurement,
        data: await client.aggregate(metricIds[metricKey], [measurement], { months: monthsBack, timezone }),
      }))
    ));
    for (const item of engagement.filter(Boolean)) {
      for (const [mk, value] of Object.entries(seriesFromAggregate(item.data, item.measurement))) {
        addMetric(months, mk, item.field, value);
      }
    }

    const monthsArr = Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({
      ...m,
      openRate: m.emailSends > 0 ? m.emailOpens / m.emailSends : null,
      clickRate: m.emailSends > 0 ? m.emailClicks / m.emailSends : null,
      clickToOpenRate: m.emailOpens > 0 ? m.emailClicks / m.emailOpens : null,
      unsubscribeRate: m.emailSends > 0 ? m.unsubscribes / m.emailSends : null,
      revenuePerRecipient: m.emailSends > 0 ? m.revenue / m.emailSends : null,
      smsClickRate: m.smsSends > 0 ? m.smsClicks / m.smsSends : null,
      smsUnsubscribeRate: m.smsSends > 0 ? m.smsUnsubscribes / m.smsSends : null,
    }));

    if (process.env.DATABASE_URL && monthsArr.length) {
      try {
        const sql = neon(process.env.DATABASE_URL);
        await upsertMonthly(sql, monthsArr);
      } catch (err) {
        console.error('klaviyo upsert failed:', err.message);
      }
    }

    return res.json({
      configured: true,
      months: monthsArr,
      topFlows,
      topMessages,
      metricIds: { ...metricIds, placedOrder: placedOrderId },
      timezone,
      revision: process.env.KLAVIYO_REVISION || DEFAULT_REVISION,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
