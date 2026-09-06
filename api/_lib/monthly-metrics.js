export async function ensureMonthlyMetrics(sql) {
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
}

// Update only supplied provider fields inside the conflict lock. Reading the old
// row in JavaScript before writing can overwrite a concurrent provider refresh.
export async function upsertMonthlySnapshot(sql, snapshot) {
  const encode = value => value == null ? null : JSON.stringify(value);
  await sql`INSERT INTO monthly_metrics(month,shopify,shopify_dealer,meta,google,klaviyo)
    VALUES (${snapshot.month},${encode(snapshot.shopify)}::jsonb,${encode(snapshot.shopify_dealer)}::jsonb,
      ${encode(snapshot.meta)}::jsonb,${encode(snapshot.google)}::jsonb,${encode(snapshot.klaviyo)}::jsonb)
    ON CONFLICT(month) DO UPDATE SET
      shopify=CASE WHEN ${Object.hasOwn(snapshot,'shopify')} THEN EXCLUDED.shopify ELSE monthly_metrics.shopify END,
      shopify_dealer=CASE WHEN ${Object.hasOwn(snapshot,'shopify_dealer')} THEN EXCLUDED.shopify_dealer ELSE monthly_metrics.shopify_dealer END,
      meta=CASE WHEN ${Object.hasOwn(snapshot,'meta')} THEN EXCLUDED.meta ELSE monthly_metrics.meta END,
      google=CASE WHEN ${Object.hasOwn(snapshot,'google')} THEN EXCLUDED.google ELSE monthly_metrics.google END,
      klaviyo=CASE WHEN ${Object.hasOwn(snapshot,'klaviyo')} THEN EXCLUDED.klaviyo ELSE monthly_metrics.klaviyo END,
      updated_at=now()`;
}
