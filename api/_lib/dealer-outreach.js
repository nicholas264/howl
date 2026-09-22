// Release migration only; requests never modify the schema.
export async function ensureDealerOutreach(sql) {
  await sql`CREATE TABLE IF NOT EXISTS dealer_outreach (
    shop TEXT NOT NULL,
    customer_key TEXT NOT NULL,
    anchor_order_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('uncontacted','contacted','replied','expected','closed')),
    owner TEXT NOT NULL DEFAULT '',
    last_contact TEXT,
    next_follow_up TEXT,
    notes TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shop, customer_key, anchor_order_id)
  )`;
}
