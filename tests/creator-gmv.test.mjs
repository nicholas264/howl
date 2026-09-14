import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('creator list GMV matches profile revenue without double-counting attribution links', async () => {
  const source = readFileSync(new URL('../api/creators.js', import.meta.url), 'utf8');
  const expressions = [...source.matchAll(/COALESCE\(\(\s*SELECT json_build_object\(\s*'spend'[\s\S]*?AS performance,/g)];
  // List expression ends immediately before FROM creators rather than with a comma.
  const list = source.split('rollup.last_launch_at,')[1].split('FROM creators c')[0].trim();
  const profile = expressions[0][0].slice(0, -1);
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE creators(id int, name text);
      CREATE TABLE creative_performance(ad_id text, group_key text);
      CREATE TABLE creative_insights_daily(ad_id text, date date, spend numeric, purchase_value numeric, purchases int, impressions int);
      CREATE TABLE creative_creator_assignments(group_key text, creator_id int);
      CREATE TABLE creative_assets(group_key text, creator_id int);
      CREATE TABLE launch_history(ad_id text, creator_id int, creator text);
      INSERT INTO creators VALUES (1, 'Alex'), (2, 'No sales');
      INSERT INTO creative_performance VALUES ('ad-1', 'group-1'), ('ad-2', 'group-2');
      INSERT INTO creative_creator_assignments VALUES ('group-1',1), ('group-1',1);
      INSERT INTO creative_assets VALUES ('group-1',1);
      INSERT INTO launch_history VALUES ('ad-1',1,'Alex'), ('ad-1',1,'Alex');
      INSERT INTO creative_insights_daily VALUES
        ('ad-1', current_date, 10, 1234.56, 2, 100),
        ('ad-1', current_date - 1, 5, 100, 1, 50),
        ('ad-1', current_date - 91, 5, 9999, 1, 50),
        ('ad-2', current_date, 5, 9999, 1, 50);
    `);
    const { rows } = await db.query(`SELECT c.id, ${list} FROM creators c ORDER BY c.id`);
    const profileResult = await db.query(`SELECT c.id, ${profile} FROM creators c ORDER BY c.id`);
    assert.equal(rows[0].performance.revenue, profileResult.rows[0].performance.revenue);
    assert.equal(rows[0].performance.revenue, 1334.56);
    assert.equal(rows[0].performance.fullRevenue, 11333.56);
    assert.ok(rows[0].performance.historyStart);
    assert.equal(rows[1].performance.fullRevenue, 0);
    assert.equal(rows[1].performance.historyStart, null);
    assert.equal(rows[0].performance.spend, 15);
    assert.equal(rows[1].performance.revenue, 0);
  } finally { await db.close(); }
});
