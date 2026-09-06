// Standard direct-provider prices, USD per million tokens, checked 2026-09-06.
// Keep historical call costs immutable when this rate card changes.
export const RATE_VERSION='2026-09-06';
export const STUDIO_MODELS={
  'gpt-6-astra':{label:'GPT-6 Astra',provider:'openai',input:10,output:50,cached:1},
  'claude-fable-5-1':{label:'Claude Fable 5.1',provider:'anthropic',input:10,output:50,cached:.25},
  'claude-opus-5':{label:'Claude Opus 5',provider:'anthropic',input:5,output:25,cached:.5},
};
export const DEFAULT_SETTINGS={creativeModel:'gpt-6-astra',reviewModel:'claude-fable-5-1',monthlyTarget:1000};
export function validateSettings(value) {
  if(!value || !Object.hasOwn(STUDIO_MODELS,value.creativeModel) || !Object.hasOwn(STUDIO_MODELS,value.reviewModel)) throw new Error('Choose a supported studio model.');
  if(typeof value.monthlyTarget!=='number' || !Number.isFinite(value.monthlyTarget) || value.monthlyTarget<1 || value.monthlyTarget>100000) throw new Error('Monthly planning target must be between $1 and $100,000.');
  return {creativeModel:value.creativeModel,reviewModel:value.reviewModel,monthlyTarget:Math.round(value.monthlyTarget*100)/100};
}
export function modelForAction(settings,action) {
  if(!['analyze','direct','refine','review'].includes(action)) throw new Error('Unknown model stage.');
  return action==='review'?settings.reviewModel:settings.creativeModel;
}
export function providerKey(model,env=process.env) {
  return env[STUDIO_MODELS[model]?.provider==='openai'?'OPENAI_API_KEY':'ANTHROPIC_API_KEY'];
}
const tokens=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export function priceUsage(model,usage) {
  const rate=STUDIO_MODELS[model];
  if(!rate || !usage || tokens(usage.input_tokens)===null || tokens(usage.output_tokens)===null) return null;
  const input=usage.input_tokens,output=usage.output_tokens;
  const cached=tokens(rate.provider==='openai'?usage.input_tokens_details?.cached_tokens ?? 0:usage.cache_read_input_tokens ?? 0);
  const write=tokens(usage.cache_creation_input_tokens ?? 0);
  if(cached===null || write===null || (rate.provider==='openai'&&cached>input))return null;
  // OpenAI includes cache reads in input_tokens; Anthropic reports them separately.
  const uncached=rate.provider==='openai'?input-cached:input;
  const totalInput=rate.provider==='openai'?input:input+cached+write;
  // Astra's long-context rate applies to the entire request above 272k tokens.
  const long=rate.provider==='openai' && totalInput>272000;
  const write1h=tokens(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  if(write1h===null || write1h>write)return null;
  const cost=(uncached*rate.input*(long?2:1)+cached*rate.cached*(long?2:1)
    +(write-write1h)*rate.input*1.25+write1h*rate.input*2+output*rate.output*(long?1.5:1))/1e6;
  return {inputTokens:totalInput,outputTokens:output,cachedTokens:cached,costUsd:cost};
}
export function modelRequest(model,system,content,maxTokens,env=process.env) {
  const spec=STUDIO_MODELS[model];if(!spec)throw new Error('Unsupported studio model.');
  const key=providerKey(model,env);if(!key)throw new Error(`${spec.label} needs a ${spec.provider==='openai'?'OPENAI_API_KEY':'ANTHROPIC_API_KEY'} configured on the server. Open Costs & models for connection status.`);
  if(spec.provider==='openai') return {url:'https://api.openai.com/v1/responses',init:{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,store:false,service_tier:'default',instructions:system,reasoning:{effort:'high'},max_output_tokens:Math.max(12000,maxTokens+8000),input:[{role:'user',content:content.map(c=>c.type==='text'?{type:'input_text',text:c.text}:{type:'input_image',image_url:`data:${c.source.media_type};base64,${c.source.data}`,detail:'high'})}]})}};
  return {url:'https://api.anthropic.com/v1/messages',init:{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:Math.max(10000,maxTokens+6000),thinking:{type:'adaptive'},output_config:{effort:'high'},system,messages:[{role:'user',content}]})}};
}
export function parseModelResult(model,data) {
  const openai=STUDIO_MODELS[model].provider==='openai';
  if(openai?data.status!=='completed':data.stop_reason!=='end_turn')throw new Error('The model did not finish this response. Its reported usage is still recorded in Costs & models.');
  const text=(openai?(data.output || []).flatMap(item=>item.content || []).filter(c=>c.type==='output_text'):(data.content || []).filter(c=>c.type==='text')).map(c=>c.text).join('\n').replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'').trim();
  try{return JSON.parse(text);}catch{throw new Error('The model returned invalid JSON. Its reported usage is still recorded in Costs & models.');}
}
export function providerError(status,data) {
  if(/credit|balance|billing|insufficient_quota/i.test(String(data?.error?.message || '')+String(data?.error?.code || '')))return 'The provider account has insufficient credits. Add credits in its billing console, then retry.';
  if(status===401 || status===403)return 'Provider access was denied. Check the server API key and model access in Costs & models.';
  if(status===402 || status===429)return 'Provider credits, quota, or rate limit blocked this request. Check the provider billing console before retrying.';
  if(status===404)return 'This model is not available to the configured provider account. Choose another model in Costs & models.';
  return `The model provider rejected the request (HTTP ${status}). No automatic retry was made.`;
}
