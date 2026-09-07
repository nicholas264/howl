// Owns one session/source's grants. Disposing invalidates every in-flight result.
export function startPlaybackRenewal({sessionId,sourceUrl,fetchGrant,onGrant,onExpired,onError,
  now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,
  visibilityTarget=globalThis.document,focusTarget=globalThis.window}) {
  let stopped=false,blocked=false,inFlight=null,renewTimer,expiryTimer,requestTimer,controller,expiresAt=0;
  const clear=()=>{clearTimer(renewTimer);clearTimer(expiryTimer);clearTimer(requestTimer);};
  const refresh=()=>{
    if(stopped || blocked || inFlight)return inFlight;
    clearTimer(renewTimer);
    const startedAt=now();
    controller=new AbortController();
    inFlight=(async()=>{
      try{
        const data=await Promise.race([
          (async()=>{
            const response=await fetchGrant(controller.signal);
            const body=await response.json().catch(()=>({}));
            if(!response.ok)throw Object.assign(new Error(body.error || 'Could not renew video playback'),{status:response.status});
            return body;
          })(),
          new Promise((_,reject)=>{requestTimer=setTimer(()=>{controller.abort();reject(new Error('Playback renewal timed out'));},20000);}),
        ]);
        if(stopped)return;
        if(typeof data.source_url!=='string')throw new Error('Invalid playback grant');
        if(data.source_url!==sourceUrl)throw Object.assign(new Error('The source video changed. Reload the session.'),{status:409});
        if(typeof data.token!=='string' || !data.token || !Number.isFinite(data.expires_in) || data.expires_in<60 || data.expires_in>600)throw new Error('Invalid playback grant');
        expiresAt=startedAt+data.expires_in*1000;
        if(expiresAt<=now())throw new Error('Playback grant expired before arrival');
        onGrant({sessionId,sourceUrl,token:data.token});
        clearTimer(expiryTimer);
        expiryTimer=setTimer(()=>{if(stopped)return;onExpired();refresh();},Math.max(0,expiresAt-now()));
        renewTimer=setTimer(refresh,Math.max(1000,expiresAt-now()-Math.min(120000,data.expires_in*200)));
      }catch(error){
        if(stopped)return;
        if([401,403,409].includes(error.status)){
          blocked=true;clearTimer(expiryTimer);onExpired();
        }else renewTimer=setTimer(refresh,15000);
        onError(error);
      }finally{clearTimer(requestTimer);inFlight=null;}
    })();
    return inFlight;
  };
  const resume=()=>{
    if(visibilityTarget?.visibilityState==='hidden' || stopped || blocked)return;
    if(expiresAt && now()>=expiresAt)onExpired();
    if(!expiresAt || expiresAt-now()<=120000)refresh();
  };
  visibilityTarget?.addEventListener('visibilitychange',resume);
  focusTarget?.addEventListener('focus',resume);
  refresh();
  return {refresh,dispose(){stopped=true;clear();controller?.abort();visibilityTarget?.removeEventListener('visibilitychange',resume);focusTarget?.removeEventListener('focus',resume);}};
}

export function restorePlaybackPosition(video,snapshot,sessionId,sourceUrl) {
  if(!snapshot || snapshot.sessionId!==sessionId || snapshot.sourceUrl!==sourceUrl || !Number.isFinite(snapshot.time))return;
  video.currentTime=Math.max(0,Number.isFinite(video.duration)?Math.min(snapshot.time,Math.max(0,video.duration-0.001)):snapshot.time);
  if(!snapshot.paused)video.play().catch(()=>{});
}


export function restorePreviewPosition(player,snapshot,sessionId,sourceUrl) {
  if(!snapshot || snapshot.sessionId!==sessionId || snapshot.sourceUrl!==sourceUrl || !Number.isFinite(snapshot.frame))return;
  // Remotion clamps seekTo to the current composition duration.
  player.seekTo(Math.max(0,Math.floor(snapshot.frame)));
  if(snapshot.playing)player.play();
}
