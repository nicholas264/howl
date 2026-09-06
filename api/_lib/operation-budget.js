export async function ensureOperationBudgets(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_operation_budgets (
    scope TEXT NOT NULL, day DATE NOT NULL DEFAULT CURRENT_DATE,
    used INTEGER NOT NULL DEFAULT 0, requests JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (scope, day)
  )`;
}

// A reservation remains charged after an uncertain provider result. Retrying
// the same request is free; concurrent distinct requests share one atomic limit.
export async function reserveOperationBudget(sql, scope, key, limit, baseline = 0) {
  await sql`INSERT INTO app_operation_budgets (scope, used) VALUES (${scope}, ${baseline}) ON CONFLICT DO NOTHING`;
  const [reserved] = await sql`
    UPDATE app_operation_budgets
    SET used = used + CASE WHEN requests ? ${key} THEN 0 ELSE 1 END,
        requests = requests || jsonb_build_object(${key}::text, true)
    WHERE scope = ${scope} AND day = CURRENT_DATE
      AND (used < ${limit} OR requests ? ${key})
    RETURNING used
  `;
  if (!reserved) throw Object.assign(new Error('Daily operation limit reached. Try again tomorrow or contact an administrator.'), { statusCode: 429 });
  return reserved;
}
