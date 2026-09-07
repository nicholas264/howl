import test from 'node:test';
import assert from 'node:assert/strict';
import {getIntegrationHealth} from '../api/_lib/integration-health.js';

test('integration readiness distinguishes configuration from migration and missing seeding credentials',()=>{
 const previous={...process.env};
 try{
  for(const key of Object.keys(process.env))if(key.startsWith('GOOGLE_') || key.startsWith('SHOPIFY_'))delete process.env[key];
  Object.assign(process.env,{GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_TOKEN_ENCRYPTION_KEY:'legacy-fixture',SHOPIFY_SEEDING_ENABLED:'true'});
  let health=getIntegrationHealth();assert.equal(health.gmail.state,'warning');assert.match(health.gmail.action,/do not replace the legacy key/);assert.match(health.gmail.action,/GOOGLE_TOKEN_ENCRYPTION_KEY_V2/);
  assert.equal(health.shopify.ready,false);assert.match(health.shopify.detail,/seeding token is missing/);
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_V2='fixture-v2';process.env.SHOPIFY_SEEDING_ACCESS_TOKEN='fixture-token';
  health=getIntegrationHealth();assert.match(health.gmail.detail,/still need verified migration/);assert.match(health.shopify.detail,/catalog credentials are missing/);assert.equal(health.shopify.ready,false);
  process.env.SHOPIFY_ACCESS_TOKEN='fixture-catalog';health=getIntegrationHealth();assert.equal(health.shopify.ready,true);assert.match(health.shopify.detail,/permissions still require verification/);
 }finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
