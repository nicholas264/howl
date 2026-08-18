import { requirePermission } from './_lib/app-access.js';
import { ensureCreatorOpsTables } from './_lib/creator-ops.js';

function monthRange(value) {
  const input = /^\d{4}-\d{2}$/.test(value || '') ? value : new Date().toISOString().slice(0, 7);
  const start = new Date(`${input}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { month: input, start: start.toISOString(), end: end.toISOString() };
}

function number(value) {
  return Number(value || 0);
}

function nullableNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(parsed, max));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function confidence(sampleSize) {
  if (sampleSize >= 30) return 'high';
  if (sampleSize >= 10) return 'medium';
  return 'low';
}

export default async function handler(req, res) {
  const permission = req.method === 'POST' ? 'creators.write' : 'creators.read';
  const access = await requirePermission(req, res, permission);
  if (!access) return;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).end();
  const { sql } = access;

  try {
    await ensureCreatorOpsTables(sql);
    const range = monthRange(req.query?.month || req.body?.month);
    await sql`
      CREATE TABLE IF NOT EXISTS dashboard_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    let [planningSettings] = await sql`
      SELECT value, updated_at
      FROM dashboard_settings
      WHERE key = 'creative_planning'
    `;
    let settings = planningSettings?.value || { by_month: {} };

    if (req.method === 'POST') {
      const input = req.body?.scenario || {};
      const scenario = {
        spend_target: nullableNumber(input.spend_target, 0, 100000000),
        cpa_target: nullableNumber(input.cpa_target, 0.01, 1000000),
        revenue_target: nullableNumber(input.revenue_target, 0, 100000000),
        spend_capacity_per_asset: nullableNumber(input.spend_capacity_per_asset, 0.01, 10000000),
        win_rate_pct: nullableNumber(input.win_rate_pct, 0.1, 100),
        useful_lifespan_days: nullableNumber(input.useful_lifespan_days, 1, 3650),
      };
      settings = {
        ...settings,
        by_month: {
          ...(settings.by_month || {}),
          [range.month]: scenario,
        },
      };
      [planningSettings] = await sql`
        INSERT INTO dashboard_settings (key, value, updated_at)
        VALUES ('creative_planning', ${JSON.stringify(settings)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
        RETURNING value, updated_at
      `;
    }

    const [deliverables, engagements, historicalAssets, seededRows] = await Promise.all([
      sql`
        SELECT
          d.id, d.title, d.status, d.due_at, d.expected_asset_count,
          d.received_asset_count, d.approved_asset_count,
          d.completed_asset_count, d.shipped_asset_count,
          d.received_at, d.approved_at, d.completed_at, d.shipped_at,
          d.engagement_id, c.id AS creator_id, c.name AS creator_name,
          COALESCE(e.engagement_type, 'unassigned') AS engagement_type
        FROM creator_deliverables d
        JOIN creators c ON c.id = d.creator_id
        LEFT JOIN creator_engagements e ON e.id = d.engagement_id
        WHERE d.due_at >= ${range.start}
          AND d.due_at < ${range.end}
          AND d.status <> 'cancelled'
        ORDER BY d.due_at ASC, c.name ASC
      `,
      sql`
        SELECT
          e.id, e.creator_id, c.name AS creator_name, e.engagement_type,
          e.status, e.approval_date, e.starts_on, e.ends_on,
          e.asset_commitment, e.commitment_period, e.cadence
        FROM creator_engagements e
        JOIN creators c ON c.id = e.creator_id
        WHERE e.status IN ('approved', 'active')
          AND e.asset_commitment IS NOT NULL
          AND e.asset_commitment > 0
          AND (
            (
              e.commitment_period = 'monthly'
              AND e.engagement_type = 'retainer'
              AND COALESCE(e.starts_on, e.approval_date, ${range.start}::date) < ${range.end}::date
              AND COALESCE(e.ends_on, ${range.end}::date) >= ${range.start}::date
            )
            OR (
              e.commitment_period = 'total'
              AND COALESCE(e.approval_date, e.starts_on, e.created_at::date) >= ${range.start}::date
              AND COALESCE(e.approval_date, e.starts_on, e.created_at::date) < ${range.end}::date
            )
          )
        ORDER BY c.name ASC
      `,
      sql`
        WITH canonical_launches AS (
          SELECT DISTINCT ON (ad_id)
            ad_id, launched_at
          FROM launch_history
          WHERE launched_at >= current_date - interval '365 days'
          ORDER BY ad_id, launched_at DESC
        ),
        asset_ads AS (
          SELECT
            COALESCE(cp.group_key, launches.ad_id) AS asset_key,
            launches.ad_id,
            launches.launched_at
          FROM canonical_launches launches
          LEFT JOIN creative_performance cp ON cp.ad_id = launches.ad_id
        )
        SELECT
          asset_key,
          min(launched_at) AS launched_at,
          COALESCE(sum(i.spend), 0)::float AS spend,
          COALESCE(sum(i.purchase_value), 0)::float AS revenue,
          COALESCE(sum(i.purchases), 0)::int AS purchases,
          count(DISTINCT i.date)::int AS metric_days,
          min(i.date) AS first_spend_date,
          max(i.date) AS last_spend_date,
          COALESCE(sum(i.spend) FILTER (WHERE i.date >= current_date - interval '14 days'), 0)::float AS recent_spend
        FROM asset_ads
        LEFT JOIN creative_insights_daily i ON i.ad_id = asset_ads.ad_id
        GROUP BY asset_key
        ORDER BY spend DESC
      `,
      sql`
        SELECT
          l.id, l.creator_id, c.name AS creator_name, l.seeded_on,
          l.product_label, l.unit_type, l.quantity,
          l.unit_cogs::float AS unit_cogs,
          (COALESCE(l.unit_cogs, 0) * COALESCE(l.quantity, 1))::float AS cogs_total,
          COALESCE(l.shipping_cost, 0)::float AS shipping_cost,
          COALESCE(l.creator_fee, 0)::float AS creator_fee,
          COALESCE(l.agreed_deliverables, 0)::int AS agreed_deliverables,
          l.deliverable_due, l.seeding_status, l.notes
        FROM creator_seeding_log l
        JOIN creators c ON c.id = l.creator_id
        WHERE l.seeded_on >= ${range.start}::date
          AND l.seeded_on < ${range.end}::date
        ORDER BY l.seeded_on DESC NULLS LAST, c.name ASC
      `,
    ]);

    let forecastMonth = null;
    try {
      const [forecastCache] = await sql`
        SELECT value
        FROM forecast_cache
        WHERE key = 'pnl_monthly'
      `;
      forecastMonth = forecastCache?.value?.months?.find(item => item.month === range.month) || null;
    } catch {
      forecastMonth = null;
    }

    const scheduledByEngagement = new Map();
    for (const item of deliverables) {
      if (!item.engagement_id) continue;
      scheduledByEngagement.set(
        String(item.engagement_id),
        (scheduledByEngagement.get(String(item.engagement_id)) || 0) + number(item.expected_asset_count),
      );
    }

    const commitments = engagements.map(item => {
      const committed = number(item.asset_commitment);
      const scheduled = scheduledByEngagement.get(String(item.id)) || 0;
      return {
        ...item,
        asset_commitment: committed,
        scheduled_assets: scheduled,
        unscheduled_assets: Math.max(committed - scheduled, 0),
      };
    });

    const summary = {
      committed: commitments.reduce((sum, item) => sum + item.asset_commitment, 0),
      scheduled: deliverables.reduce((sum, item) => sum + number(item.expected_asset_count), 0),
      received: deliverables.reduce((sum, item) => sum + number(item.received_asset_count), 0),
      approved: deliverables.reduce((sum, item) => sum + number(item.approved_asset_count), 0),
      completed: deliverables.reduce((sum, item) => sum + number(item.completed_asset_count), 0),
      shipped: deliverables.reduce((sum, item) => sum + number(item.shipped_asset_count), 0),
      unscheduled: commitments.reduce((sum, item) => sum + item.unscheduled_assets, 0),
      overdue: deliverables.reduce((sum, item) => (
        new Date(item.due_at).getTime() < Date.now()
          ? sum + Math.max(number(item.expected_asset_count) - number(item.completed_asset_count), 0)
          : sum
      ), 0),
    };
    summary.forecast = summary.scheduled + summary.unscheduled;

    const seedingByCreator = new Map();
    const productRollup = new Map();
    for (const row of seededRows) {
      const productLabel = row.product_label || row.unit_type || 'Unlabeled product';
      const unitType = row.unit_type || 'unit';
      const productKey = `${productLabel}::${unitType}`;
      const cogsTotal = number(row.cogs_total);
      const totalInvestment = cogsTotal + number(row.shipping_cost) + number(row.creator_fee);
      const creatorKey = String(row.creator_id);
      const creatorProducts = seedingByCreator.get(creatorKey) || [];
      creatorProducts.push({
        id: row.id,
        product_label: productLabel,
        unit_type: unitType,
        quantity: number(row.quantity),
        cogs_total: cogsTotal,
        total_investment: totalInvestment,
        seeded_on: row.seeded_on,
        seeding_status: row.seeding_status,
      });
      seedingByCreator.set(creatorKey, creatorProducts);

      const current = productRollup.get(productKey) || {
        product_label: productLabel,
        unit_type: unitType,
        quantity: 0,
        creators: new Set(),
        seeded_rows: 0,
        cogs_total: 0,
        shipping_cost: 0,
        creator_fee: 0,
        total_investment: 0,
        expected_assets: 0,
      };
      current.quantity += number(row.quantity);
      current.creators.add(String(row.creator_id));
      current.seeded_rows += 1;
      current.cogs_total += cogsTotal;
      current.shipping_cost += number(row.shipping_cost);
      current.creator_fee += number(row.creator_fee);
      current.total_investment += totalInvestment;
      current.expected_assets += number(row.agreed_deliverables);
      productRollup.set(productKey, current);
    }

    const seededProducts = Array.from(productRollup.values())
      .map(item => ({
        ...item,
        creators: item.creators.size,
      }))
      .sort((a, b) => b.total_investment - a.total_investment);
    const seededCreatorIds = new Set(seededRows.map(row => String(row.creator_id)));
    const seeding = {
      summary: {
        seeded_creators: seededCreatorIds.size,
        seeded_units: seededRows.reduce((sum, row) => sum + number(row.quantity), 0),
        seeded_products: seededProducts.length,
        seeded_cogs: seededRows.reduce((sum, row) => sum + number(row.cogs_total), 0),
        seeded_shipping: seededRows.reduce((sum, row) => sum + number(row.shipping_cost), 0),
        seeded_creator_fees: seededRows.reduce((sum, row) => sum + number(row.creator_fee), 0),
        seeded_assets_expected: seededRows.reduce((sum, row) => sum + number(row.agreed_deliverables), 0),
        seeded_total_investment: seededRows.reduce((sum, row) => (
          sum + number(row.cogs_total) + number(row.shipping_cost) + number(row.creator_fee)
        ), 0),
      },
      products: seededProducts,
      rows: seededRows.map(row => ({
        ...row,
        product_label: row.product_label || row.unit_type || 'Unlabeled product',
        total_investment: number(row.cogs_total) + number(row.shipping_cost) + number(row.creator_fee),
      })),
    };

    const spendingAssets = historicalAssets.filter(item => number(item.spend) > 0);
    const assetMetrics = spendingAssets.map(item => {
      const spend = number(item.spend);
      const revenue = number(item.revenue);
      const purchases = number(item.purchases);
      const metricDays = Math.max(number(item.metric_days), 1);
      const lifespanDays = item.first_spend_date && item.last_spend_date
        ? Math.max(1, Math.round((new Date(item.last_spend_date) - new Date(item.first_spend_date)) / 86400000) + 1)
        : metricDays;
      return {
        spend,
        revenue,
        purchases,
        cpa: purchases > 0 ? spend / purchases : null,
        monthly_spend_capacity: (spend / metricDays) * 30,
        lifespan_days: lifespanDays,
        recent_spend: number(item.recent_spend),
      };
    });
    const sampleSize = assetMetrics.length;
    const rawBenchmarks = {
      attributed_assets: historicalAssets.length,
      spending_assets: sampleSize,
      average_revenue_per_asset: sampleSize
        ? assetMetrics.reduce((sum, item) => sum + item.revenue, 0) / sampleSize
        : null,
      median_revenue_per_asset: median(assetMetrics.map(item => item.revenue)),
      average_spend_per_asset: sampleSize
        ? assetMetrics.reduce((sum, item) => sum + item.spend, 0) / sampleSize
        : null,
      median_spend_per_asset: median(assetMetrics.map(item => item.spend)),
      median_monthly_spend_capacity: median(assetMetrics.map(item => item.monthly_spend_capacity)),
      median_useful_lifespan_days: median(assetMetrics.map(item => item.lifespan_days)),
      active_assets_14d: assetMetrics.filter(item => item.recent_spend > 0).length,
      confidence: confidence(sampleSize),
      window_days: 365,
    };

    const savedScenario = settings.by_month?.[range.month] || {};
    // The projection sheet's "Customer acquisition cost" row contains the
    // monthly acquisition budget, not a per-customer CPA.
    const forecastSpend = nullableNumber(forecastMonth?.cac);
    const cpaTarget = savedScenario.cpa_target ?? null;
    const historicalWinRate = cpaTarget && sampleSize
      ? (assetMetrics.filter(item => item.cpa != null && item.cpa <= cpaTarget).length / sampleSize) * 100
      : null;
    const autoBenchmarksReady = sampleSize >= 10;
    const scenario = {
      spend_target: savedScenario.spend_target ?? forecastSpend,
      cpa_target: cpaTarget,
      revenue_target: savedScenario.revenue_target ?? nullableNumber(forecastMonth?.netRevenue),
      spend_capacity_per_asset: savedScenario.spend_capacity_per_asset
        ?? (autoBenchmarksReady ? rawBenchmarks.median_monthly_spend_capacity : null),
      win_rate_pct: savedScenario.win_rate_pct
        ?? (autoBenchmarksReady ? historicalWinRate : null),
      useful_lifespan_days: savedScenario.useful_lifespan_days
        ?? (autoBenchmarksReady ? rawBenchmarks.median_useful_lifespan_days : null),
      source: Object.keys(savedScenario).length ? 'saved' : (forecastMonth ? 'cfo_forecast' : 'manual'),
    };

    const spendTarget = nullableNumber(scenario.spend_target);
    const spendCapacity = nullableNumber(scenario.spend_capacity_per_asset, 0.01);
    const winRate = nullableNumber(scenario.win_rate_pct, 0.1, 100);
    const lifespan = nullableNumber(scenario.useful_lifespan_days, 1);
    const demandReady = spendTarget != null && spendCapacity != null && winRate != null && lifespan != null;
    const activeAssetsNeeded = demandReady ? Math.ceil(spendTarget / spendCapacity) : null;
    const monthlyReplacementFactor = demandReady ? Math.min(30 / lifespan, 3) : null;
    const newAssetsRequired = demandReady
      ? Math.ceil((activeAssetsNeeded * monthlyReplacementFactor) / (winRate / 100))
      : null;
    const demand = {
      ready: demandReady,
      purchases_required: spendTarget != null && cpaTarget
        ? Math.ceil(spendTarget / cpaTarget)
        : null,
      active_assets_needed: activeAssetsNeeded,
      monthly_replacement_factor: monthlyReplacementFactor,
      new_assets_required: newAssetsRequired,
      supply_forecast: summary.forecast,
      surplus_shortfall: newAssetsRequired == null ? null : summary.forecast - newAssetsRequired,
    };

    const recommendations = [];
    if (summary.overdue > 0) {
      recommendations.push({
        key: 'overdue',
        severity: 'risk',
        title: 'Recover overdue creator assets',
        detail: `${summary.overdue} expected asset${summary.overdue === 1 ? '' : 's'} are past due and not complete. Open the deadline risk queue before adding more demand.`,
        count: summary.overdue,
        action: 'Resolve overdue deliverables',
      });
    }
    if (summary.unscheduled > 0) {
      recommendations.push({
        key: 'unscheduled',
        severity: 'warning',
        title: 'Put contracted supply on the calendar',
        detail: `${summary.unscheduled} committed asset${summary.unscheduled === 1 ? '' : 's'} are not tied to due dates yet. Schedule deliverables so the forecast becomes real capacity.`,
        count: summary.unscheduled,
        action: 'Schedule commitments',
      });
    }
    if (seeding.summary.seeded_assets_expected > summary.scheduled && seeding.summary.seeded_creators > 0) {
      recommendations.push({
        key: 'seeded_unscheduled',
        severity: 'warning',
        title: 'Turn seeded product commitments into deadlines',
        detail: `${seeding.summary.seeded_assets_expected} asset${seeding.summary.seeded_assets_expected === 1 ? '' : 's'} are promised from seeded product rows this month. Make sure each one has a deliverable due date before forecasting launch supply.`,
        count: seeding.summary.seeded_assets_expected,
        action: 'Schedule seeded assets',
      });
    }
    if (demand.surplus_shortfall != null && demand.surplus_shortfall < 0) {
      const shortage = Math.abs(demand.surplus_shortfall);
      recommendations.push({
        key: 'demand_shortfall',
        severity: 'risk',
        title: 'Source more creator output for spend goals',
        detail: `This scenario needs ${demand.new_assets_required} new assets, but current supply forecasts ${summary.forecast}. Add ${shortage} more planned assets or lower the spend/win-rate assumptions.`,
        count: shortage,
        action: 'Close asset gap',
      });
    }
    if (demand.ready && demand.surplus_shortfall >= 0 && summary.overdue === 0 && summary.unscheduled === 0) {
      recommendations.push({
        key: 'healthy',
        severity: 'success',
        title: 'Creative supply covers the current scenario',
        detail: `Forecast supply covers required new assets by ${demand.surplus_shortfall}. Keep launch attribution current so the demand model stays trustworthy.`,
        count: demand.surplus_shortfall,
        action: 'Monitor performance loop',
      });
    }
    if (!demand.ready) {
      recommendations.push({
        key: 'missing_assumptions',
        severity: 'warning',
        title: 'Finish demand assumptions',
        detail: 'Add spend capacity per winner, expected win rate, and useful lifespan to calculate required monthly asset volume.',
        count: null,
        action: 'Save scenario assumptions',
      });
    }

    const byType = ['retainer', 'one_off', 'unassigned'].map(type => {
      const typeDeliverables = deliverables.filter(item => item.engagement_type === type);
      const typeCommitments = commitments.filter(item => item.engagement_type === type);
      const scheduled = typeDeliverables.reduce((sum, item) => sum + number(item.expected_asset_count), 0);
      const unscheduled = typeCommitments.reduce((sum, item) => sum + item.unscheduled_assets, 0);
      return {
        type,
        committed: typeCommitments.reduce((sum, item) => sum + item.asset_commitment, 0),
        scheduled,
        unscheduled,
        forecast: scheduled + unscheduled,
        completed: typeDeliverables.reduce((sum, item) => sum + number(item.completed_asset_count), 0),
        shipped: typeDeliverables.reduce((sum, item) => sum + number(item.shipped_asset_count), 0),
      };
    });

    const weeks = [];
    for (let cursor = new Date(range.start); cursor < new Date(range.end); cursor.setUTCDate(cursor.getUTCDate() + 7)) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(Math.min(
        weekStart.getTime() + 7 * 86400000,
        new Date(range.end).getTime(),
      ));
      const items = deliverables.filter(item => {
        const due = new Date(item.due_at).getTime();
        return due >= weekStart.getTime() && due < weekEnd.getTime();
      });
      weeks.push({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        expected: items.reduce((sum, item) => sum + number(item.expected_asset_count), 0),
        completed: items.reduce((sum, item) => sum + number(item.completed_asset_count), 0),
        shipped: items.reduce((sum, item) => sum + number(item.shipped_asset_count), 0),
        deliverables: items.length,
      });
    }

    const deliverablesWithSeeding = deliverables.map(item => ({
      ...item,
      seeded_products: seedingByCreator.get(String(item.creator_id)) || [],
    }));

    const risks = deliverablesWithSeeding
      .filter(item => number(item.completed_asset_count) < number(item.expected_asset_count))
      .map(item => ({
        ...item,
        remaining: Math.max(number(item.expected_asset_count) - number(item.completed_asset_count), 0),
        risk: new Date(item.due_at).getTime() < Date.now()
          ? 'overdue'
          : new Date(item.due_at).getTime() < Date.now() + 7 * 86400000
            ? 'due_soon'
            : 'scheduled',
      }))
      .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

    return res.json({
      month: range.month,
      summary,
      seeding,
      by_type: byType,
      weeks,
      commitments,
      deliverables: deliverablesWithSeeding,
      risks,
      recommendations,
      benchmarks: {
        ...rawBenchmarks,
        win_rate_at_target: historicalWinRate,
        auto_defaults_ready: autoBenchmarksReady,
      },
      scenario,
      demand,
      scenario_updated_at: planningSettings?.updated_at || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
