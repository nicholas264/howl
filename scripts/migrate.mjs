import { ensureWorkControls } from '../api/_lib/work-controls.js';
import { ensureExperiments } from '../api/_lib/experiments.js';
import { ensureAuthIdentities } from '../api/_lib/auth-identities.js';
import { ensureTranscriptionJobs } from '../api/_lib/transcription-jobs.js';
import { ensureAppTables } from '../api/_lib/app-access.js';
import { ensureLocalReceipts } from '../api/_lib/local-receipts.js';
import { ensureProviderMedia } from '../api/_lib/provider-media.js';
import { ensureApprovalSnapshots } from '../api/_lib/approval-snapshots.js';
import { ensureCreativeVariants, ensureVariantObservations } from '../api/_lib/creative-variants.js';
import { ensureLaunchDrafts } from '../api/_lib/launch-drafts.js';
import { ensureCreativeAnalysisQueue } from '../api/_lib/creative-analysis-queue.js';
import { ensureSyncState } from '../api/_lib/sync-state.js';
import { ensureOperationBudgets } from '../api/_lib/operation-budget.js';
import { neon } from '@neondatabase/serverless';
import { initializeSchema } from '../api/db/schema.js';
import { ensureOperationJournal } from '../api/_lib/operation-journal.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required; select the intended environment explicitly.');
const sql = neon(process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS app_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
const version = '2026-09-05-hardening-1';
const [applied] = await sql`SELECT version FROM app_schema_migrations WHERE version = ${version}`;
if (!applied) {
  // Initial migration adopts the existing idempotent schema; failed runs can be
  // resumed. Deployments must serialize this release step before serving traffic.
  const [baseline] = await sql`SELECT to_regclass('public.ugc_sessions') AS existing`;
  if (!baseline.existing) await initializeSchema(sql);
  // Existing production databases receive only additive release changes.
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE creator_outreach ADD COLUMN IF NOT EXISTS request_key TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_outreach_request ON creator_outreach(request_key)`;
  await ensureSyncState(sql);
  await ensureOperationBudgets(sql);
  await ensureOperationJournal(sql);
  await sql`INSERT INTO app_schema_migrations (version) VALUES (${version}) ON CONFLICT DO NOTHING`;
}
await ensureCreativeAnalysisQueue(sql);
await ensureLaunchDrafts(sql);
await ensureCreativeVariants(sql);
await ensureVariantObservations(sql);
await ensureApprovalSnapshots(sql);
await ensureProviderMedia(sql);
await ensureLocalReceipts(sql);
await ensureWorkControls(sql);
await ensureExperiments(sql);
await ensureAppTables(sql);
await ensureAuthIdentities(sql);
await ensureTranscriptionJobs(sql);
await ensureOperationJournal(sql);
await sql`INSERT INTO app_schema_migrations (version) VALUES ('2026-09-05-hardening-2') ON CONFLICT DO NOTHING`;
console.log('Schema migrations applied.');
