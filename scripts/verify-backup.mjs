import { ensureWorkControls } from '../api/_lib/work-controls.js';
import { ensureExperiments } from '../api/_lib/experiments.js';
import { ensureAuthIdentities } from '../api/_lib/auth-identities.js';
import { ensureTranscriptionJobs } from '../api/_lib/transcription-jobs.js';
// Offline only. This never connects to a production database or prints row data.
import { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ensureLocalReceipts } from '../api/_lib/local-receipts.js';
import { ensureProviderMedia } from '../api/_lib/provider-media.js';
import { ensureApprovalSnapshots } from '../api/_lib/approval-snapshots.js';
import { ensureCreativeVariants, ensureVariantObservations } from '../api/_lib/creative-variants.js';
import { ensureLaunchDrafts } from '../api/_lib/launch-drafts.js';
import { ensureCreativeAnalysisQueue } from '../api/_lib/creative-analysis-queue.js';
import { ensureOperationJournal } from '../api/_lib/operation-journal.js';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/verify-backup.mjs /private/path/backup.sql');
const start = Date.now();
const raw = await readFile(file,'utf8');
const db = new PGlite();
const sql = async (parts,...values) => (await db.query(parts.reduce((text,part,index)=>text+(index?`$${index}`:'')+part,''),values)).rows;
try {
  // psql's client-side random restrict token is not SQL. Keep every SQL statement.
  await db.exec(raw.replace(/^\\(?:un)?restrict[^\n]*$/gm,''));
  await db.exec('SET search_path = public');
  const {rows:tables} = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const counts = {};
  for (const {tablename} of tables) counts[tablename] = Number((await db.query(`SELECT count(*) AS count FROM public."${tablename.replaceAll('"','""')}"`)).rows[0].count);
  const restoredAt = Date.now();
  // Exercise additive migrations on the real restored schema, without providers.
  for (const migrate of [ensureTranscriptionJobs,ensureAuthIdentities,ensureExperiments,ensureWorkControls,ensureCreativeAnalysisQueue,ensureLaunchDrafts,ensureCreativeVariants,ensureVariantObservations,ensureApprovalSnapshots,ensureProviderMedia,ensureLocalReceipts,ensureOperationJournal]) await migrate(sql);
  const report = {backupSha256:createHash('sha256').update(raw).digest('hex'),tables:tables.length,
    rows:Object.values(counts).reduce((a,b)=>a+b,0),restoreMilliseconds:restoredAt-start,migrationMilliseconds:Date.now()-restoredAt,counts};
  await writeFile(`${file}.verification.json`,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({restored:true,migrated:true,tables:report.tables,rows:report.rows,restoreSeconds:report.restoreMilliseconds/1000}));
} catch(error) {
  // Database driver errors may embed the entire query, including private data.
  console.error(JSON.stringify({restored:false,code:error.code || 'unknown',position:error.position || null}));
  process.exitCode=1;
} finally {await db.close();}
