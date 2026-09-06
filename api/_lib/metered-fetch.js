import { recordProviderUsage } from './work-controls.js';

export function meteredFetch(access, fetchImpl=globalThis.fetch) {
  return async (url,init={}) => {
    const host=new URL(url).hostname;
    if (!['api.anthropic.com','api.openai.com'].includes(host)) return fetchImpl(url,init);
    const signal=init.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(55000)]) : AbortSignal.timeout(55000);
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
