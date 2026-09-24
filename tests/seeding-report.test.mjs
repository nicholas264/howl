import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ensureSeedingBudgets, getSeedingReport } from '../api/_lib/seeding-report.js';
import { reportMonths, summarizeMonth, attributionCoverage } from '../src/lib/seeding-report.js';

test('monthly report separates dated costs, excludes future costs and deduplicates creator ad links', async () => {
  const db = new PGlite();
  const sql = async (parts, ...values) => (await db.query(parts.reduce((q,p,i) => q + (i ? `$${i}` : '') + p, ''), values)).rows;
  try {
    await ensureSeedingBudgets(sql);
    await db.exec(`CREATE TABLE creator_seeding_log (seeded_on date, unit_cogs numeric, quantity integer, shipping_cost numeric, creator_fee numeric);
      CREATE TABLE creative_insights_daily (ad_id text, date date, spend numeric, purchase_value numeric, synced_at timestamptz DEFAULT now());
      CREATE TABLE launch_history (ad_id text, creator_id integer, creator text, source_type text);
      CREATE TABLE creators (id integer, name text);
      CREATE TABLE creative_performance (ad_id text, group_key text);
      CREATE TABLE creative_creator_assignments (group_key text, creator_id integer, source_type text);
      CREATE TABLE creative_assets (group_key text, creator_id integer, source_type text);
      INSERT INTO creator_seeding_log VALUES ('2020-02-01',100,2,20,50), ('2020-01-01',1,1,2,3), (NULL,10,1,0,5), ('2999-01-01',400,1,0,600);
      INSERT INTO creative_insights_daily(ad_id,date,spend,purchase_value) VALUES ('linked','2020-02-01',100,1000), ('unlinked','2020-02-01',5000,50000);
      INSERT INTO launch_history(ad_id,creator_id,creator) VALUES ('linked',1,NULL),('linked',2,NULL);
      INSERT INTO creative_performance VALUES ('linked','g');
      INSERT INTO creative_creator_assignments(group_key,creator_id) VALUES ('g',1),('g',2);
      INSERT INTO creator_monthly_budgets(month,seeding,creator) VALUES ('2020-02',300,100);`);
    await db.exec(`ALTER TABLE creator_seeding_log ADD COLUMN id bigserial;
      ALTER TABLE creator_seeding_log ADD COLUMN creator_id bigint;
      ALTER TABLE creator_seeding_log ADD COLUMN engagement_id bigint;
      CREATE TABLE creator_engagements (id bigint, creator_id bigint, engagement_type text, status text, fee_currency text DEFAULT 'USD', fee_amount numeric, starts_on date, ends_on date, approval_date date, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE flow_cards (id bigint, creator_id bigint, concept_json jsonb);`);
    const report = await getSeedingReport(sql);
    assert.equal(report.performance_error, null);
    const feb = summarizeMonth(report, '2020-02');
    assert.equal(feb.seeding,220); assert.equal(feb.creator,50);
    assert.equal(feb.spend,100); assert.equal(feb.revenue,1000); assert.equal(feb.roas,10);
    assert.equal(feb.roi,(1000-370)/370*100);
    assert.equal(feb.budget.seeding,300);
    const coverage = attributionCoverage(report,'2020-02');
    assert.equal(coverage.ads,2);assert.equal(coverage.creator.spending_ads,1);
    assert.equal(coverage.unreviewed.spend,5000);assert.equal(coverage.spend,5100);
    assert.equal(coverage.linkedShare,100/5100*100);
    await db.exec("INSERT INTO launch_history(ad_id,creator_id,creator,source_type) VALUES ('unlinked',NULL,NULL,'tool_generated')");
    const classified = attributionCoverage(await getSeedingReport(sql),'2020-02');
    assert.equal(classified.other.spend,5000);assert.equal(classified.unreviewed.spend,0);
    assert.equal(classified.creator.revenue,1000);
    assert.equal(summarizeMonth(report,'2999-01').investment,0);
    assert.equal(summarizeMonth(report,'2999-01').scheduled,1000);
    assert.equal(summarizeMonth(report,'2020-01').roi,null);
    assert.equal(summarizeMonth(report,'2020-03').budget,undefined);
    assert.equal(report.monthly.find(m=>m.month==='undated').seeding,10);
    assert.ok(!reportMonths(report).includes('undated'));
    await assert.rejects(db.exec("INSERT INTO creator_monthly_budgets(month,seeding,creator) VALUES ('2020-13',1,1)"));
    await assert.rejects(db.exec("INSERT INTO creator_monthly_budgets(month,seeding,creator) VALUES ('2020-03',-1,1)"));
  } finally { await db.close(); }
});

test('zero spend and empty months do not manufacture ratios',()=>{
  const report={as_of:'2026-09-07',monthly:[],budgets:[],performance:[{month:'2026-09',spend:0,revenue:0}]};
  assert.equal(summarizeMonth(report,'2026-09').roi,null);
  assert.equal(summarizeMonth(report,'2026-09').roas,null);
  assert.equal(reportMonths(report).length,1);
  assert.equal(reportMonths(report)[0],'2026-09');
});

test('full history preserves older spend, zero-activity gaps and later months during drilldown', () => {
  const report = {as_of:'2026-09-07', monthly:[{month:'2024-04',seeding:100,creator:50},{month:'2026-08',seeding:200,creator:25},{month:'undated',seeding:10,creator:0}],budgets:[],performance:[]};
  const months = reportMonths(report, '2026-04');
  assert.equal(months[0], '2024-04');
  assert.equal(months.at(-1), '2026-09');
  assert.equal(months.length,30);
  assert.ok(months.includes('2025-01'));
  assert.equal(summarizeMonth(report,'2024-04').investment,150);
  assert.equal(summarizeMonth(report,'2026-08').investment,225);
  assert.ok(!months.includes('undated'));
});

 test('agreement fees reduce budgets by month without duplicating linked ledger fees', async () => {
  const db = new PGlite();
  const sql = async (parts, ...values) => (await db.query(parts.reduce((q,p,i) => q + (i ? `$${i}` : '') + p, ''), values)).rows;
  try {
    await ensureSeedingBudgets(sql);
    await db.exec(`CREATE TABLE creators (id bigint, name text);
      CREATE TABLE creator_seeding_log (id bigint, creator_id bigint, engagement_id bigint, seeded_on date, unit_cogs numeric DEFAULT 0, quantity int DEFAULT 1, shipping_cost numeric DEFAULT 0, creator_fee numeric DEFAULT 0);
      CREATE TABLE creator_engagements (id bigint, creator_id bigint, engagement_type text, status text, fee_currency text DEFAULT 'USD', fee_amount numeric, starts_on date, ends_on date, approval_date date, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE flow_cards (id bigint, creator_id bigint, concept_json jsonb);
      CREATE TABLE creative_insights_daily (ad_id text, date date, spend numeric, purchase_value numeric, synced_at timestamptz DEFAULT now());
      CREATE TABLE launch_history (ad_id text, creator_id bigint, creator text, source_type text);
      CREATE TABLE creative_performance (ad_id text, group_key text);
      CREATE TABLE creative_creator_assignments (group_key text, creator_id bigint, source_type text);
      CREATE TABLE creative_assets (group_key text, creator_id bigint, source_type text);
      INSERT INTO creators VALUES (1,'Monthly'),(2,'One off');
      INSERT INTO creator_engagements (id,creator_id,engagement_type,status,fee_amount,starts_on,ends_on) VALUES
        (1,1,'retainer','active',1500,'2020-01-15','2020-03-04'),
        (2,2,'one_off','approved',500,'2020-02-01',NULL),
        (3,2,'one_off','draft',9000,'2020-02-01',NULL),
        (4,2,'one_off','cancelled',9000,'2020-02-01',NULL),
        (5,2,'one_off','completed',200,'2020-02-01',NULL),
        (6,2,'one_off','approved',300,'2999-01-01',NULL);
      INSERT INTO creator_seeding_log(id,creator_id,engagement_id,seeded_on,creator_fee) VALUES
        (1,1,1,'2020-01-15',1500), (2,1,1,'2020-02-01',250),
        (3,2,NULL,'2020-02-01',500), (4,2,NULL,'2020-02-01',75);
      INSERT INTO flow_cards VALUES (1,2,'{"engagement_id":2,"seeding_ids":[3]}');
      INSERT INTO creator_monthly_budgets(month,seeding,creator) VALUES ('2020-02',0,3000);`);
    const report = await getSeedingReport(sql);
    const jan = summarizeMonth(report, '2020-01');
    assert.equal(jan.creatorBudgetUsed,1500);
    assert.equal(jan.committed,0);
    const feb = summarizeMonth(report, '2020-02');
    assert.equal(feb.creator,825);
    assert.equal(feb.committed,1450);
    assert.equal(feb.creatorBudgetUsed,2275);
    assert.equal(feb.budget.creator-feb.creatorBudgetUsed,725);
    assert.equal(feb.investment,825, 'ROI continues to use recorded costs');
    assert.equal(summarizeMonth(report,'2020-03').creatorBudgetUsed,1500);
    assert.equal(summarizeMonth(report,'2020-04').creatorBudgetUsed,0);
    assert.equal(summarizeMonth(report,'2999-01').creatorBudgetUsed,300);
    assert.equal(report.commitments.filter(r=>r.engagement_id===2).length,1);
    assert.equal(report.performance_error,null);
    await db.exec(`INSERT INTO creator_engagements(id,creator_id,engagement_type,status,fee_amount,starts_on) VALUES (7,2,'one_off','approved',350,'2020-02-01');
      INSERT INTO creator_seeding_log(id,creator_id,engagement_id,seeded_on,creator_fee) VALUES (5,2,7,NULL,350);`);
    const undated = await getSeedingReport(sql);
    assert.equal(summarizeMonth(undated,'2020-02').creatorBudgetUsed,2625, 'undated ledger fees cannot consume a dated budget reservation');
  } finally { await db.close(); }
});
