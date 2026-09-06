import { apiJson } from './api.js';
import { getApiToken } from './apiFetch.js';
import { uploadPublicBlob } from '../utils/blobUpload.js';

const fromRow = row => ({ ...row.payload, draftRevision: row.revision, draftOwner: row.created_by });
export async function loadLaunchDrafts() {
  const drafts=[];let cursor='';
  do {
    const page=await apiJson(`/api/launch-drafts?cursor=${encodeURIComponent(cursor)}`);
    drafts.push(...page.drafts.map(fromRow));cursor=page.next_cursor;
  } while(cursor);
  return drafts;
}
export async function persistLaunchDraft(item) {
  const payload = { ...item };
  delete payload.draftRevision; delete payload.draftOwner;
  const uploads = new Map();
  // Generated media must have durable URLs before the database draft is saved.
  async function durable(value,depth=0) {
    if(depth>30)throw new Error('Draft data is nested too deeply');
    if (value instanceof Blob) throw new Error('Attach media through the upload control before saving a draft');
    if(Array.isArray(value)){const items=[];for(const item of value)items.push(await durable(item,depth+1));return items;}
    if(value && typeof value==='object'){const result={};for(const [key,item] of Object.entries(value))result[key]=await durable(item,depth+1);return result;}
    if (typeof value !== 'string' || !/^(data:|blob:)/.test(value)) return value;
    if (!uploads.has(value)) {
      const body = await (await globalThis.fetch(value)).blob();
      const extension = body.type.includes('video') ? 'mp4' : body.type.includes('png') ? 'png' : 'jpg';
      const uploaded = await uploadPublicBlob(`drafts/${crypto.randomUUID()}.${extension}`,body,
        { contentType:body.type,clientPayload:await getApiToken() });
      uploads.set(value,uploaded.url);
    }
    return uploads.get(value);
  }
  const savedPayload=await durable(payload);
  const result = await apiJson('/api/launch-drafts',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:String(item.id),payload:savedPayload,expected_revision:item.draftRevision ?? null})});
  return fromRow(result.draft);
}
export async function deleteLaunchDraft(item) {
  await apiJson('/api/launch-drafts',{method:'DELETE',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:String(item.id),expected_revision:item.draftRevision})});
}
