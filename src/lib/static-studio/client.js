import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '../api.js';
import { getApiToken } from '../apiFetch.js';
import { uploadPublicBlob } from '../../utils/blobUpload.js';
import { blankWorkspace } from './model.js';
import { inspectImage, decodeImage } from './render.js';
export const studioRequest = body => apiJson('/api/static-studio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export async function uploadStudioBlob(blob,kind='renders') {
  const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
  const result=await uploadPublicBlob(`static-studio/${kind}/${crypto.randomUUID()}.${ext}`,blob,{contentType:blob.type,clientPayload:await getApiToken()});
  return result.url;
}
export async function importOriginal(blob,name,existing={}) {
  const metadata=await inspectImage(blob);
  const url=existing.url || await uploadStudioBlob(blob,'originals');
  const img=await decodeImage(blob),scale=Math.min(1,1200/Math.max(metadata.width,metadata.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(metadata.width*scale);canvas.height=Math.round(metadata.height*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#F9F3DF';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const preview=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
  const previewUrl=await uploadStudioBlob(preview,'analysis');
  return {...existing,...metadata,id:crypto.randomUUID(),url,previewUrl,name,productId:'',approved:false,role:'product',features:[],notes:'',analysis:'',createdAt:new Date().toISOString()};
}
export function useStudio() {
  const [workspace,setState]=useState(blankWorkspace),[loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const current=useRef(workspace),revision=useRef(0),lastSaved=useRef(''),queue=useRef(Promise.resolve()),alive=useRef(true),ready=useRef(false);
  const update=useCallback(fn=>{
    const next=typeof fn==='function'?fn(current.current):fn;current.current=next;setState(next);
  },[]);
  const reload=useCallback(async()=>{
    try {const data=await apiJson('/api/static-studio');if(!alive.current)return;revision.current=data.revision;current.current=data.payload;lastSaved.current=JSON.stringify(data.payload);setState(data.payload);ready.current=true;setLoaded(true);setError('');}
    catch(err){if(alive.current)setError(err.message);}
  },[]);
  useEffect(()=>{alive.current=true;reload();return()=>{alive.current=false;};},[reload]);
  const flush=useCallback(()=>{
    const task=queue.current.catch(()=>{}).then(async()=>{
      if(!ready.current)throw new Error('Load the studio before saving.');
      const snapshot=current.current,serialized=JSON.stringify(snapshot);
      if(serialized===lastSaved.current)return snapshot;
      if(alive.current)setSaving(true);
      try {const result=await studioRequest({action:'save',payload:snapshot,revision:revision.current});revision.current=result.revision;lastSaved.current=serialized;if(alive.current)setError('');return snapshot;}
      catch(err){if(alive.current)setError(err.message);throw err;}
      finally {if(alive.current)setSaving(false);}
    });
    queue.current=task;return task;
  },[]);
  useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>flush().catch(()=>{}),700);return()=>clearTimeout(timer);},[workspace,loaded,flush]);
  useEffect(()=>{
    const protect=event=>{if(JSON.stringify(current.current)!==lastSaved.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',protect);window.addEventListener('howl:before-tool-change',protect);
    return()=>{window.removeEventListener('beforeunload',protect);window.removeEventListener('howl:before-tool-change',protect);};
  },[]);
  return {workspace,update,flush,reload,loaded,saving,error,dirty:JSON.stringify(workspace)!==lastSaved.current};
}
