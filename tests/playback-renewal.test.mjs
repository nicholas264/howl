import test from 'node:test';
import assert from 'node:assert/strict';
import {startPlaybackRenewal,restorePlaybackPosition,restorePreviewPosition} from '../src/lib/playbackRenewal.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let time=0,id=0;const timers=new Map();return {now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),jump:t=>{time=t;},async advance(t){for(;;){const next=[...timers].filter(([,v])=>v.at<=t).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}time=t;await flush();},timers};}
const sourceUrl='https://fixture.private.blob.vercel-storage.com/source.mp4';
const grant=token=>Response.json({token,source_url:sourceUrl,expires_in:600});

test('playback renews before expiry, retains a valid grant through transient failure, and clears expired access',async()=>{
 const timer=clock(),grants=[],errors=[];let expired=0,calls=0,fail=false;
 const renewal=startPlaybackRenewal({...timer,sessionId:1,sourceUrl,fetchGrant:async()=>{calls++;return fail?Response.json({error:'Temporary outage'},{status:503}):grant('token-'+calls);},onGrant:g=>grants.push(g),onExpired:()=>expired++,onError:e=>errors.push(e)});
 try{
  await flush();assert.equal(grants.length,1);
  fail=true;await timer.advance(480000);assert.equal(calls,2);assert.equal(grants.length,1);assert.equal(expired,0);
  await timer.advance(599000);assert.equal(expired,0);
  await timer.advance(600000);assert.equal(expired,1);assert.ok(errors.length>0);
  fail=false;await timer.advance(615000);assert.equal(grants.length,2);assert.equal(grants[1].sessionId,1);
 }finally{renewal.dispose();assert.equal(timer.timers.size,0);}
});

test('source changes and access denial stop renewal; disposed requests cannot install another session grant',async()=>{
 for(const response of [new Response('Signed out',{status:401}),Response.json({error:'Denied'},{status:403}),Response.json({token:'wrong',source_url:sourceUrl+'-changed',expires_in:600})]){
  const timer=clock(),events=new EventTarget();let calls=0,expired=0,installed=0;
  const renewal=startPlaybackRenewal({...timer,sessionId:1,sourceUrl,visibilityTarget:events,focusTarget:events,fetchGrant:async()=>{calls++;return response;},onGrant:()=>installed++,onExpired:()=>expired++,onError:()=>{}});
  await flush();assert.equal(expired,1);events.dispatchEvent(new Event('focus'));await timer.advance(1000000);assert.equal(calls,1);assert.equal(installed,0);renewal.dispose();
 }
 const timer=clock();let finish,signal,installed=0;
 const renewal=startPlaybackRenewal({...timer,sessionId:1,sourceUrl,fetchGrant:s=>{signal=s;return new Promise(resolve=>{finish=resolve;});},onGrant:()=>installed++,onExpired:()=>{},onError:()=>{}});
 renewal.dispose();assert.equal(signal.aborted,true);finish(grant('late'));await flush();assert.equal(installed,0);assert.equal(timer.timers.size,0);
});

test('focus renews a suspended tab and coalesces concurrent refreshes; position restore is scoped to the same source',async()=>{
 const timer=clock(),events=new EventTarget();let calls=0,expired=0,finish;
 const renewal=startPlaybackRenewal({...timer,sessionId:1,sourceUrl,visibilityTarget:events,focusTarget:events,fetchGrant:async()=>{calls++;if(calls===1)return grant('first');return new Promise(resolve=>{finish=resolve;});},onGrant:()=>{},onExpired:()=>expired++,onError:()=>{}});
 try{
  await flush();timer.jump(650000);events.dispatchEvent(new Event('focus'));events.dispatchEvent(new Event('visibilitychange'));renewal.refresh();assert.equal(calls,2);assert.ok(expired>=1);finish(grant('renewed'));await flush();
  let played=0;const video={duration:90,currentTime:0,play:async()=>{played++;}};
  restorePlaybackPosition(video,{sessionId:1,sourceUrl,time:24,paused:false},2,sourceUrl);assert.equal(video.currentTime,0);
  restorePlaybackPosition(video,{sessionId:1,sourceUrl,time:24,paused:false},1,sourceUrl);assert.equal(video.currentTime,24);assert.equal(played,1);
  const preview={seekTo:frame=>{preview.frame=frame;},play:()=>{preview.playing=true;}};
  restorePreviewPosition(preview,{sessionId:1,sourceUrl,frame:123,playing:true},2,sourceUrl);assert.equal(preview.frame,undefined);
  restorePreviewPosition(preview,{sessionId:1,sourceUrl,frame:123,playing:true},1,sourceUrl);assert.equal(preview.frame,123);assert.equal(preview.playing,true);
  restorePlaybackPosition(video,{sessionId:1,sourceUrl,time:100,paused:true},1,sourceUrl);assert.ok(video.currentTime<90);assert.equal(played,1);
 }finally{renewal.dispose();}
});


test('a timed-out request cannot overwrite a later renewed grant even if it ignores abort',async()=>{
 const timer=clock(),grants=[];let calls=0,late,firstSignal;
 const renewal=startPlaybackRenewal({...timer,sessionId:1,sourceUrl,fetchGrant:signal=>{
  calls++;if(calls===1){firstSignal=signal;return new Promise(resolve=>{late=resolve;});}return Promise.resolve(grant('current'));
 },onGrant:g=>grants.push(g.token),onExpired:()=>{},onError:()=>{}});
 try{
  await timer.advance(20000);assert.equal(firstSignal.aborted,true);assert.deepEqual(grants,[]);
  await timer.advance(35000);assert.deepEqual(grants,['current']);
  late(grant('stale'));await flush();assert.deepEqual(grants,['current']);
 }finally{renewal.dispose();}
});

test('native private playback accepts only the exact source destination',async()=>{
 for(const [url,accepted] of [[sourceUrl+'?signature=fixture',true],['https://other.private.blob.vercel-storage.com/source.mp4?signature=fixture',false],[sourceUrl+'-other?signature=fixture',false]]){
  const timer=clock(),grants=[],errors=[];
  const renewal=startPlaybackRenewal({...timer,sessionId:1,sourceUrl,fetchGrant:async()=>Response.json({token:'fixture',source_url:sourceUrl,expires_in:600,playback_url:url}),onGrant:g=>grants.push(g),onExpired:()=>{},onError:e=>errors.push(e)});
  try{await flush();assert.equal(grants.length,accepted?1:0);assert.equal(errors.length,accepted?0:1);if(accepted)assert.equal(grants[0].url,url);}finally{renewal.dispose();}
 }
});
