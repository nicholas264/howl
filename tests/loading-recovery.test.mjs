import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { skewProtectionPlugin } from '../build/skew-protection.mjs';
import { recoverAssetLoad, withDeadline } from '../src/lib/loadRecovery.js';

const failure = new Error('Failed to fetch dynamically imported module: /assets/old.js');
function browser(overrides = {}) {
  const store = new Map(); let reloads = 0;
  return { navigator: { onLine: true }, dispatchEvent: () => true,
    sessionStorage: { getItem: key => store.get(key), setItem: (key,value) => store.set(key,value) },
    location: { reload: () => reloads++ }, get reloads() { return reloads; }, ...overrides };
}
test('asset recovery reloads once and suppresses loops across page loads', () => {
  const win = browser(); assert.equal(recoverAssetLoad(failure,win),true);
  assert.equal(recoverAssetLoad(failure,win),false); assert.equal(win.reloads,1);
});
test('asset recovery preserves edits, pending-operation guards, offline state, and non-load errors', () => {
  for (const win of [browser({__howlHasEdits:true}),browser({dispatchEvent:()=>false}),browser({navigator:{onLine:false}}),browser({sessionStorage:{getItem(){throw Error('blocked')}}})]) {
    assert.equal(recoverAssetLoad(failure,win),false); assert.equal(win.reloads,0);
  }
  const win=browser(); assert.equal(recoverAssetLoad(new Error('render failed'),win),false); assert.equal(win.reloads,0);
});
test('access deadline terminates a stuck token or response and preserves successful results', async () => {
  await assert.rejects(withDeadline(new Promise(()=>{}),5,'Access timed out'), /Access timed out/);
  assert.equal(await withDeadline(Promise.resolve('ok'),50,'timeout'),'ok');
});
test('Vite output pins entry, lazy imports, shared chunks, and CSS preload references', async () => {
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'howl-skew-test-')));
  try {
    await writeFile(path.join(root,'index.html'),'<html><head></head><body><script type="module" src="/main.js"></script></body></html>');
    await writeFile(path.join(root,'main.js'),"import {shared} from './shared.js'; window.sample=shared; window.one=()=>import('./one.js');window.two=()=>import('./two.js');");
    await writeFile(path.join(root,'shared.js'),"export const shared = 'shared';");
    await writeFile(path.join(root,'one.js'),"import './one.css';import {shared} from './shared.js';export default shared+'one';");
    await writeFile(path.join(root,'two.js'),"import {shared} from './shared.js';export default shared+'two';");
    await writeFile(path.join(root,'one.css'),'body{color:red}');
    const result=await build({root,configFile:false,logLevel:'silent',plugins:[skewProtectionPlugin({enabled:true,deploymentId:'dpl_Test123'})],build:{write:false}});
    const output=result.output;
    const html=output.find(x=>x.fileName==='index.html').source;
    assert.match(html,/src="\/assets\/[^"?]+\.js\?dpl=dpl_Test123"/);
    let references=0;
    const files=new Set(output.map(x=>x.fileName));
    for(const item of output.filter(x=>x.type==='chunk')) {
      for(const match of item.code.matchAll(/["']([^"']+\.(?:js|css)(?:\?dpl=[^"']+)?)["']/g)) {
        const value=match[1];
        const raw=value.split('?')[0];
        const resolved=raw.startsWith('./') ? path.posix.join(path.posix.dirname(item.fileName),raw) : raw.replace(/^\//,'');
        if(files.has(resolved)) {references++;assert.ok(value.endsWith('?dpl=dpl_Test123'),value);}
      }
    }
    assert.ok(references>=4,`Only ${references} asset references found`);
  } finally { await rm(root,{recursive:true,force:true}); }
});
