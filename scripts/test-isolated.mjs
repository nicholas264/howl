import {spawnSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testEnvironment} from './test-environment.mjs';

const home=mkdtempSync(join(tmpdir(),'howl-tests-'));
try {
  const files=readdirSync('tests').filter(name=>name.endsWith('.test.mjs')).sort().map(name=>join('tests',name));
  if(!files.length)throw new Error('No regression tests found');
  const result=spawnSync(process.execPath,['--test',...files],{
    stdio:'inherit',env:testEnvironment(process.env,home),timeout:120000,
  });
  if(result.error)console.error('Regression test process failed:',result.error.code || 'unknown');
  process.exitCode=result.status ?? 1;
} finally {rmSync(home,{recursive:true,force:true});}
