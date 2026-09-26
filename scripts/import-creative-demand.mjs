// Import an audited private baseline. No provider calls, migrations, or ad changes.
// node --env-file=/secure/path/.env scripts/import-creative-demand.mjs /secure/path/demand-inputs.json
import fs from 'node:fs';
import {neon} from '@neondatabase/serverless';
import {buildCreativeEvidence} from '../src/lib/creative-demand.js';
const input=process.argv[2];
if(!input||!process.env.DATABASE_URL)throw Error('Provide a baseline JSON path and DATABASE_URL.');
const raw=fs.readFileSync(input,'utf8'),history=JSON.parse(raw);
if(history.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(history.asOf)||!history.groups?.length||!history.daily?.length||!history.targets?.length)throw Error('Incomplete baseline.');
const evidence=buildCreativeEvidence(history);
if(!evidence.sampleSize)throw Error('No mature mapped assets in baseline.');
const sql=neon(process.env.DATABASE_URL);
await sql`INSERT INTO dashboard_settings (key,value,updated_at) VALUES ('creative_demand_history',${raw}::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
const [saved]=await sql`SELECT value->>'asOf' AS as_of,jsonb_array_length(value->'groups') AS assets,jsonb_array_length(value->'daily') AS rows FROM dashboard_settings WHERE key='creative_demand_history'`;
if(saved.as_of!==history.asOf||saved.assets!==history.groups.length||saved.rows!==history.daily.length)throw Error('Import verification failed.');
console.log(JSON.stringify({imported:true,...saved}));
