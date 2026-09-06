import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {testEnvironment} from '../scripts/test-environment.mjs';

test('regression child processes do not inherit deployment credentials or Node preload hooks',()=>{
  const env=testEnvironment({PATH:process.env.PATH,DATABASE_URL:'private-canary',CLERK_SECRET_KEY:'private-canary',AWS_SECRET_ACCESS_KEY:'private-canary',VERCEL_OIDC_TOKEN:'private-canary',NODE_OPTIONS:'--invalid-private-canary',HOME:'/private-home'},'/temporary-test-home');
  const child=spawnSync(process.execPath,['-e','console.log(JSON.stringify(process.env))'],{env,encoding:'utf8'});
  assert.equal(child.status,0);
  const seen=JSON.parse(child.stdout);
  assert.equal(seen.HOME,'/temporary-test-home');
  assert.equal(seen.NODE_ENV,'test');
  for(const name of ['DATABASE_URL','CLERK_SECRET_KEY','AWS_SECRET_ACCESS_KEY','VERCEL_OIDC_TOKEN','NODE_OPTIONS'])assert.equal(seen[name],undefined);
});

test('a failing regression makes the deployment test runner fail',async()=>{
  const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const directory=mkdtempSync(join(tmpdir(),'howl-failing-regression-'));
  try {
    mkdirSync(join(directory,'tests'));
    writeFileSync(join(directory,'tests','failure.test.mjs'),"import test from 'node:test'; test('intentional fixture failure',()=>{throw new Error('fixture failure')});");
    const child=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/test-isolated.mjs',import.meta.url))],{cwd:directory,encoding:'utf8',timeout:10000});
    assert.equal(child.status,1);
    assert.match(child.stdout,/fixture failure/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
