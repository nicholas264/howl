import { AsyncLocalStorage } from 'node:async_hooks';
import { recordProviderUsage } from './work-controls.js';

export function meteredFetch(access, fetchImpl=globalThis.fetch, {timeoutMs=55000}={}) {
  return async (url,init={}) => {
    const host=new URL(url).hostname;
    if (!['api.anthropic.com','api.openai.com'].includes(host)) return fetchImpl(url,init);
    const signal=init.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const response=await fetchImpl(url,{...init,signal});
    if (access.workId && response.ok && /json/.test(response.headers.get('content-type') || '')) {
      const data=await response.clone().json();
      const usage=data.usage;
      if (usage) await recordProviderUsage(access.sql,access.workId,{
        provider:host==='api.anthropic.com'?'anthropic':'openai',model:data.model,
        inputTokens:Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
        outputTokens:Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
      }).catch(error=>console.error('Provider usage recording failed',error.message));
    }
    return response;
  };
}

const activeWork=new AsyncLocalStorage();
export function withProviderMetering(access,callback){return activeWork.run(access,callback);}
export function scopedMeteredFetch(fetchImpl){
  return (url,init)=>{
    const access=activeWork.getStore();
    return access?.workId ? meteredFetch(access,fetchImpl)(url,init) : fetchImpl(url,init);
  };
}
