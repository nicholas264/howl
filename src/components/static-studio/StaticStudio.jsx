import { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { apiFetch } from '../../lib/apiFetch.js';
import { PRODUCTS } from '../../data/products.js';
import { COPY, DIRECTIONS, FORMATS, productFor, generateConcepts, conceptFingerprint } from '../../lib/static-studio/model.js';
import { renderPair } from '../../lib/static-studio/render.js';
import { useStudio, studioRequest, importOriginal, uploadStudioBlob } from '../../lib/static-studio/client.js';
import './studio.css';

const humanStatus=c=>c.launchedToQueue?'In launcher':c.approval?'Approved':c.review?.verdict==='revise'?'Needs revision':c.review?.verdict==='pass'?'Review passed':c.render?'Ready for review':'Draft';
const invalidate=c=>{const {render,review,approval,launchedToQueue,...draft}=c;return draft;};
function DownloadIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>;}
function ImageIcon(){return <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="6" y="8" width="36" height="32" rx="2"/><circle cx="17" cy="19" r="4"/><path d="m7 34 12-10 9 8 7-5 7 6"/></svg>;}
function saveFile(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export default function StaticStudio({onAddToCart,onOpenLauncher}) {
  const {workspace:w,update,flush,reload,loaded,saving,dirty,error:saveError}=useStudio();
  const [view,setView]=useState('library'),[assetId,setAssetId]=useState(''),[conceptId,setConceptId]=useState(''),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [driveFiles,setDriveFiles]=useState(null),[driveSelected,setDriveSelected]=useState(new Set()),[pageToken,setPageToken]=useState(''),[breadcrumbs,setBreadcrumbs]=useState([]);
  const [protecting,setProtecting]=useState(false),[regionStart,setRegionStart]=useState(null);
  const [anchorName,setAnchorName]=useState(''),[productFilter,setProductFilter]=useState('all'),[safeAreas,setSafeAreas]=useState(false);
  const [preview,setPreview]=useState(null),[previewError,setPreviewError]=useState(''),[previewLoading,setPreviewLoading]=useState(false);
  const uploadRef=useRef(null),cancelRef=useRef(false),previewRef=useRef(null);
  const asset=w.assets.find(a=>a.id===assetId),concept=w.concepts.find(c=>c.id===conceptId),source=w.assets.find(a=>a.id===concept?.assetId);
  const eligible=w.assets.filter(a=>a.approved && a.role==='product');
  const missing=w.selectedProducts.filter(id=>!eligible.some(a=>a.productId===id));
  const visibleConcepts=w.concepts.filter(c=>productFilter==='all' || c.productId===productFilter);
  const changeAsset=(id,patch)=>update(current=>({...current,assets:current.assets.map(a=>a.id===id?{...a,...patch}:a),concepts:current.concepts.map(c=>c.assetId===id?invalidate(c):c)}));
  const changeConcept=patch=>update(current=>({...current,concepts:current.concepts.map(c=>c.id===conceptId?{...invalidate(c),...patch}:c)}));
  const writeConcept=c=>update(current=>({...current,concepts:current.concepts.map(row=>row.id===c.id?c:row)}));
  async function run(label,fn) {
    if(busy)return;setBusy(label);setMessage('');setError('');cancelRef.current=false;
    try{await fn();}catch(err){setError(err.message || 'The operation failed. Retry this step.');}finally{setBusy('');}
  }
  useEffect(()=>{
    const protect=e=>{if(busy){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',protect);window.addEventListener('howl:before-tool-change',protect);
    return()=>{window.removeEventListener('beforeunload',protect);window.removeEventListener('howl:before-tool-change',protect);};
  },[busy]);
  useEffect(()=>{
    let active=true,urls=[];setPreview(null);previewRef.current=null;setPreviewError('');
    if(!concept || !source)return;
    setPreviewLoading(true);
    const timer=setTimeout(()=>renderPair(concept,source).then(pair=>{
      if(!active)return;
      const feedUrl=URL.createObjectURL(pair.feed.blob),storyUrl=URL.createObjectURL(pair.story.blob);urls=[feedUrl,storyUrl];
      previewRef.current=pair;setPreview({...pair,feedUrl,storyUrl});
    }).catch(err=>{if(active)setPreviewError(err.message);}).finally(()=>{if(active)setPreviewLoading(false);}),250);
    return()=>{active=false;clearTimeout(timer);urls.forEach(url=>URL.revokeObjectURL(url));};
  },[concept && conceptFingerprint(concept,source)]);
  async function ingestFiles(files) {
    for(const [i,file] of [...files].entries()) {
      if(cancelRef.current)break;
      setBusy(`Importing original ${i+1} of ${files.length}`);
      const imported=await importOriginal(file,file.name);
      if(w.assets.some(a=>a.sha256===imported.sha256)) {setMessage('An identical original is already in the library.');continue;}
      update(current=>current.assets.some(a=>a.sha256===imported.sha256)?current:{...current,assets:[...current.assets,imported]});
      setAssetId(imported.id);await flush();
    }
    setMessage('Originals imported. Confirm the product in each photograph before generating.');
  }
  async function connectDrive() {
    await flush();
    const response=await apiFetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'static_studio'})});
    const result=await response.json();
    if(!response.ok || !result.url)throw new Error(result.error || 'Could not open Google sign-in.');
    const url=new URL(result.url);
    if(url.origin!=='https://accounts.google.com')throw new Error('Unexpected Google sign-in destination.');
    window.location.assign(url.href);
  }
  async function browse(folder,append=false) {
    const data=await studioRequest({action:'drive-list',folder,pageToken:append?pageToken:undefined});
    setDriveFiles(prev=>append?[...(prev || []),...(data.files || [])]:data.files || []);setPageToken(data.nextPageToken || '');if(!append)setDriveSelected(new Set());
  }
  async function importDrive(selectedFiles) {
    const files=Array.isArray(selectedFiles)?selectedFiles:driveFiles.filter(f=>driveSelected.has(f.id));
    for(let i=0;i<files.length;i++) {
      if(cancelRef.current)break;
      const f=files[i];setBusy(`Importing Drive original ${i+1} of ${files.length}`);
      if(w.assets.some(a=>a.driveId===f.id && a.driveModified===f.modifiedTime))continue;
      const imported=await studioRequest({action:'drive-import',fileId:f.id});
      const response=await fetch(imported.url,{mode:'cors'});if(!response.ok)throw new Error('Imported original could not load.');
      const record=await importOriginal(await response.blob(),imported.name,imported);
      if(record.sha256!==imported.sha256)throw new Error('Drive original changed during import. Retry.');
      update(current=>current.assets.some(a=>a.sha256===record.sha256)?current:{...current,assets:[...current.assets,record]});setAssetId(record.id);await flush();
    }
    setDriveSelected(new Set());setMessage('Drive originals imported. Confirm their product identity in the library.');
  }
  async function importFolderTree() {
    const folders=[w.folder],seen=new Set(),files=[];
    while(folders.length && !cancelRef.current) {
      const folder=folders.shift();if(seen.has(folder))continue;seen.add(folder);
      if(seen.size>60)throw new Error('This folder tree has more than 60 folders. Choose a smaller campaign folder.');
      let token='';
      do {
        setBusy(`Scanning Drive: ${seen.size} folders, ${files.length} photographs`);
        const data=await studioRequest({action:'drive-list',folder,pageToken:token || undefined});
        for(const file of data.files || []) {
          if(file.mimeType==='application/vnd.google-apps.folder')folders.push(file.id);
          else if(!files.some(f=>f.id===file.id))files.push(file);
        }
        if(files.length+w.assets.length>240)throw new Error('This folder would exceed the 240-asset studio limit. Choose a smaller campaign folder.');
        token=data.nextPageToken || '';
      }while(token && !cancelRef.current);
    }
    if(!cancelRef.current) {
      if(!files.length)throw new Error('No JPEG, PNG, or WebP photographs found in this folder tree.');
      await importDrive(files);
    }
  }
  async function analyzeAsset() {
    await flush();const data=await studioRequest({action:'analyze',assetId:asset.id});
    changeAsset(asset.id,{analysis:[data.description,...data.uncertainties.map(s=>`Check: ${s}`)].join('\n'),...(!asset.protectedRegion && data.suggestedProtectedRegion?{protectedRegion:data.suggestedProtectedRegion}:{})});await flush();
    setMessage(data.suggestedProductId?`Suggested identity: ${productFor(data.suggestedProductId).name}. Confirm against the actual photograph.`:'Description saved. Product identity still needs your confirmation.');
  }
  async function generate(ai) {
    const snapshot=await flush();let choices=[];
    if(ai) {setBusy('Art director is developing original concepts');choices=(await studioRequest({action:'direct'})).choices;}
    const concepts=generateConcepts(snapshot,choices);
    if(!concepts.length)throw new Error('Approve a photograph for a selected product first.');
    update(current=>({...current,concepts:[...concepts,...current.concepts]}));await flush();
    setConceptId(concepts[0].id);setView('review');setMessage(`${concepts.length} concepts created. Each has an independently composed feed and story placement.`);
  }
  async function persistRender(c) {
    const a=w.assets.find(a=>a.id===c.assetId);
    const pair=previewRef.current?.fingerprint===conceptFingerprint(c,a)?previewRef.current:await renderPair(c,a);
    if(pair.checks.some(i=>i.level==='error'))throw new Error(`${productFor(c.productId).name}: fix the failed quality checks before exporting.`);
    const [feedUrl,storyUrl]=await Promise.all([uploadStudioBlob(pair.feed.blob),uploadStudioBlob(pair.story.blob)]);
    const next={...invalidate(c),render:{fingerprint:pair.fingerprint,feedUrl,storyUrl,checks:pair.checks}};
    writeConcept(next);await flush();return next;
  }
  async function reviewConcept(c=concept) {
    const current=c.render?c:await persistRender(c);await flush();
    setBusy('Reviewing both exported placements');
    const {review}=await studioRequest({action:'review',conceptId:current.id});
    const next={...current,review};delete next.approval;delete next.launchedToQueue;
    writeConcept(next);await flush();setMessage(review.verdict==='pass'?'Visual review passed. Inspect both placements before approval.':'Visual review found changes to make. See the review notes.');return next;
  }
  async function finishConcept(c) {
    let next=c.review?.verdict==='revise'?c:await reviewConcept(c);
    if(next.review.verdict==='revise' && !cancelRef.current) {
      setBusy('Art director is revising the concept');
      const result=await studioRequest({action:'refine',conceptId:next.id});
      writeConcept(result.concept);await flush();
      next=await reviewConcept(await persistRender(result.concept));
    }
    return next;
  }
  async function finishBatch() {
    let passed=0,held=0;
    for(const [i,c] of visibleConcepts.entries()) {
      if(cancelRef.current)break;
      if(c.approval)continue;
      setConceptId(c.id);setBusy(`Finishing concept ${i+1} of ${visibleConcepts.length}`);
      let finished;
      try {finished=await finishConcept(c);} catch(err) {throw new Error(`Stopped on ${productFor(c.productId).name}: ${err.message} Earlier completed pairs are saved; retry the unfinished batch.`);}
      finished.review.verdict==='pass'?passed++:held++;
    }
    setMessage(`${passed} pairs passed visual review. ${held} need your attention. All pairs still require your final approval.`);
  }
  async function approveConcept() {
    const current=concept.render?concept:await persistRender(concept);
    if(current.render.checks.some(i=>i.level==='error'))throw new Error('Resolve quality errors before approval.');
    writeConcept({...current,approval:{fingerprint:current.render.fingerprint,at:new Date().toISOString()}});await flush();setMessage('Both placements approved. Ready for the launcher.');
  }
  async function sendConcepts(concepts) {
    await flush();let sent=0;
    for(const c of concepts) {
      if(cancelRef.current)break;
      if(!c.approval || c.launchedToQueue)continue;
      const a=w.assets.find(a=>a.id===c.assetId);
      if(c.approval.fingerprint!==conceptFingerprint(c,a))throw new Error('A design changed after approval. Review it again.');
      setBusy(`Sending approved pair ${sent+1} to launcher`);
      await onAddToCart({id:`static-${c.id}`,type:'image',kind:'static-studio',paired:true,squareUrl:c.render.feedUrl,storyUrl:c.render.storyUrl,url:c.render.feedUrl,
        name:`${productFor(c.productId).name} / ${c.angle} / ${DIRECTIONS.find(d=>d.id===c.direction).name}`,product:c.productId,headline:c.headline.replaceAll('\n',' '),
        primaryText:c.body,sourceType:'tool_generated',sourceLabel:'Static Studio',createdAt:Date.now(),staticStudioConceptId:c.id,
        staticStudioDesign:{...c,sourceAsset:{id:a.id,url:a.url,sha256:a.sha256,driveId:a.driveId}},staticStudioApprovedAt:c.approval.at});
      writeConcept({...c,launchedToQueue:true});await flush();sent++;
    }
    setMessage(`${sent} paired creative${sent===1?'':'s'} saved to the launcher. No ads have been published.`);
  }
  async function downloadConcepts(concepts) {
    const zip=new JSZip();let count=0;
    for(const c of concepts) {
      if(cancelRef.current)break;
      setBusy(`Preparing export ${count+1} of ${concepts.length}`);
      const a=w.assets.find(a=>a.id===c.assetId),pair=await renderPair(c,a);
      if(pair.checks.some(check=>check.level==='error'))throw new Error(`${c.headline}: resolve quality errors before downloading.`);
      const folder=`${c.productId}-${c.direction}-${c.id.slice(0,8)}`;
      zip.file(`${folder}/4x5.png`,pair.feed.blob);zip.file(`${folder}/9x16.png`,pair.story.blob);
      zip.file(`${folder}/design.json`,JSON.stringify({...c,sourceAsset:a,quality:pair.checks},null,2));count++;
    }
    if(count)saveFile(await zip.generateAsync({type:'blob'}),'howl-static-studio.zip');
  }
  const approved=w.concepts.filter(c=>c.approval && !c.launchedToQueue);
  if(!loaded)return <div className="ss-loading"><h1>Static Studio</h1><p>{saveError || 'Loading your studio…'}</p>{saveError && <button onClick={reload}>Retry</button>}</div>;
  return <div className="ss" aria-busy={!!busy}>
    <header className="ss-header"><div><h1>Static Studio<span>HOWL</span></h1><p>Real products. Considered design. Every placement.</p></div><div className="ss-header-actions"><span className="ss-save">{saving?'Saving…':saveError || dirty?'Unsaved changes':'Saved to your studio'}</span><button className="ss-button" onClick={()=>run('Saving',flush)} disabled={!!busy}>Save</button><button className="ss-button ss-primary" disabled={!!busy || !approved.length} onClick={()=>run('Sending approved creatives',()=>sendConcepts(approved))}>Send approved{approved.length?` (${approved.length})`:''}</button></div></header>
    <nav className="ss-tabs" aria-label="Static Studio"><div>{[['library','Assets',w.assets.length],['create','Art direction',null],['review','Contact sheet',w.concepts.length]].map(([id,label,count])=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>setView(id)} disabled={!!busy}>{label}{count!==null && <span>{count}</span>}</button>)}</div><button disabled={!!busy} onClick={onOpenLauncher}>Open launcher</button></nav>
    {(error || saveError) && <div className="ss-alert" role="alert">{error || saveError}{saveError && <><button onClick={()=>run('Saving',flush)} disabled={!!busy}>Retry save</button><button onClick={()=>saveFile(new Blob([JSON.stringify(w,null,2)],{type:'application/json'}),'howl-studio-recovery.json')}>Download unsaved work</button><button onClick={()=>{if(window.confirm('Reload the saved studio? Download unsaved work first if you want to keep your changes.'))run('Reloading saved studio',reload);}} disabled={!!busy}>Reload saved version</button></>}</div>}
    {message && <div className="ss-notice" role="status">{message}<button aria-label="Dismiss notification" onClick={()=>setMessage('')}>×</button></div>}
    {busy && <div className="ss-progress" role="status"><span className="ss-spinner"/>{busy}<button onClick={()=>{cancelRef.current=true;setMessage('The batch will stop after the current item finishes.');}}>Stop after this item</button></div>}
    <fieldset className="ss-work" disabled={!!busy}>
    {view==='library' && <div className="ss-library-layout">
      <section className="ss-library-main"><div className="ss-section-title"><div><h2>Your source material</h2><p>Import originals, confirm the product, then let the studio compose.</p></div><button className="ss-button" onClick={()=>uploadRef.current.click()}>Upload originals</button><input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>{const files=[...e.target.files];e.target.value='';run('Importing originals',()=>ingestFiles(files));}}/></div>
        <div className="ss-drive"><label htmlFor="ss-drive-folder">Google Drive folder</label><div><input id="ss-drive-folder" type="text" placeholder="Paste a Drive folder link" value={w.folder} onChange={e=>update({...w,folder:e.target.value})}/><button className="ss-button ss-dark" onClick={()=>run('Opening Drive folder',async()=>{await browse(w.folder);setBreadcrumbs([{folder:w.folder,name:'Asset folder'}]);})} disabled={!w.folder.trim()}>Browse folder</button><button className="ss-button" disabled={!w.folder.trim()} onClick={()=>run('Importing folder tree',importFolderTree)}>Import folder + subfolders</button></div><p>Reads from your connected Drive, or the workspace’s shared connection. Subfolders can be opened below.</p><button className="ss-button" onClick={()=>run('Opening Google sign-in',connectDrive)}>Connect my Drive</button>
          {driveFiles && <div className="ss-drive-browser"><div className="ss-breadcrumbs">{breadcrumbs.map((b,i)=><button key={i} onClick={()=>run('Opening folder',async()=>{await browse(b.folder);setBreadcrumbs(breadcrumbs.slice(0,i+1));})}>{b.name}</button>)}</div>
            {!driveFiles.length && <p>No supported images or subfolders here.</p>}
            <div className="ss-drive-files">{driveFiles.map(f=>f.mimeType==='application/vnd.google-apps.folder'?<button key={f.id} className="ss-folder" onClick={()=>run('Opening subfolder',async()=>{await browse(f.id);setBreadcrumbs([...breadcrumbs,{folder:f.id,name:f.name}]);})}>▸ {f.name}</button>:<label key={f.id}><input type="checkbox" checked={driveSelected.has(f.id)} onChange={e=>setDriveSelected(prev=>{const next=new Set(prev);e.target.checked?next.add(f.id):next.delete(f.id);return next;})}/><span>{f.name}</span><small>{f.imageMediaMetadata?.width?`${f.imageMediaMetadata.width} × ${f.imageMediaMetadata.height}`:''}</small></label>)}</div>
            <div className="ss-actions"><button className="ss-button" onClick={()=>setDriveSelected(new Set(driveFiles.filter(f=>f.mimeType!=='application/vnd.google-apps.folder').map(f=>f.id)))}>Select images</button>{pageToken && <button className="ss-button" onClick={()=>run('Loading more files',()=>browse(breadcrumbs.at(-1).folder,true))}>Load more</button>}<button className="ss-button ss-primary" disabled={!driveSelected.size} onClick={()=>run('Importing Drive originals',importDrive)}>Import {driveSelected.size || ''} selected</button></div>
          </div>}
        </div>
        {!w.assets.length?<div className="ss-empty" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)run('Importing originals',()=>ingestFiles(e.dataTransfer.files));}}><ImageIcon/><h3>Start with the real thing.</h3><p>Drop product photography here or import a Drive folder. Add your strongest finished ads as design references, too.</p><button className="ss-button" onClick={()=>uploadRef.current.click()}>Choose photographs</button><small>JPEG, PNG or WebP · Originals preserved · Up to 30 MB each</small></div>:<div className="ss-assets">{w.assets.map(a=><button className={`ss-asset ${a.id===assetId?'is-selected':''}`} key={a.id} onClick={()=>{setAssetId(a.id);setAnchorName('');setProtecting(false);setRegionStart(null);}}><div className="ss-asset-img"><img src={a.previewUrl || a.url} crossOrigin="anonymous" alt={a.name} loading="lazy"/></div><div><strong>{a.role==='reference'?'Design reference':productFor(a.productId)?.name || 'Identify product'}</strong><span className={`ss-dot ${a.approved?'is-approved':''}`}/><p>{a.name}</p><small>{a.width} × {a.height}{a.approved?' / Confirmed':''}</small></div></button>)}</div>}
      </section>
      <aside className="ss-inspector">{asset?<><h2>{asset.role==='reference'?'Reference notes':'Photograph details'}</h2><div className={`ss-anchor-photo ${anchorName || protecting?'is-placing':''}`} onClick={e=>{
          if((!anchorName && !protecting) || !asset.productId)return;const rect=e.currentTarget.getBoundingClientRect();
          const x=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height));
          if(protecting) {
            if(!regionStart){setRegionStart({x,y});return;}
            const w=Math.abs(x-regionStart.x),h=Math.abs(y-regionStart.y);
            if(w<.02 || h<.02){setMessage('Mark opposite corners around the complete product.');return;}
            changeAsset(asset.id,{protectedRegion:{x:Math.min(x,regionStart.x),y:Math.min(y,regionStart.y),w,h,approved:false}});setProtecting(false);setRegionStart(null);return;
          }
          changeAsset(asset.id,{features:[...asset.features.filter(f=>f.name!==anchorName),{name:anchorName,x,y,approved:false}]});setAnchorName('');
        }}><img src={asset.url} crossOrigin="anonymous" alt={`Original ${asset.name}`}/>{asset.protectedRegion && <span className="ss-protected-region" style={{left:`${asset.protectedRegion.x*100}%`,top:`${asset.protectedRegion.y*100}%`,width:`${asset.protectedRegion.w*100}%`,height:`${asset.protectedRegion.h*100}%`}}/>}{regionStart && <span className="ss-anchor" style={{left:`${regionStart.x*100}%`,top:`${regionStart.y*100}%`}}/>}{asset.features.map(f=><span key={f.name} className="ss-anchor" style={{left:`${f.x*100}%`,top:`${f.y*100}%`}} title={f.name}/>)}</div>
        <p className="ss-filename">{asset.name}</p>{w.concepts.some(c=>c.assetId===asset.id) && <p>Used in saved concepts. Remove those concepts before changing its identity.</p>}<label>Use as<select disabled={w.concepts.some(c=>c.assetId===asset.id)} value={asset.role} onChange={e=>changeAsset(asset.id,{role:e.target.value,approved:false,features:[],protectedRegion:null})}><option value="product">Product photograph</option><option value="reference">Design reference</option></select></label>
        {asset.role==='product' && <><label>Product in this photograph<select disabled={w.concepts.some(c=>c.assetId===asset.id)} value={asset.productId} onChange={e=>changeAsset(asset.id,{productId:e.target.value,approved:false,features:[],protectedRegion:null})}><option value="">Choose exact product</option>{PRODUCTS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="ss-check"><input type="checkbox" checked={asset.approved} disabled={!asset.productId} onChange={e=>changeAsset(asset.id,{approved:e.target.checked})}/><span>I verified this is the selected product and the photograph is suitable for advertising.</span></label></>}
        {asset.role==='product' && asset.productId && <div className="ss-details"><h3>Keep the product untouched</h3><p>For immersive ads, mark the complete product, flame, legs and connections. Everything inside stays visible and free of text.</p><button className="ss-button ss-full" onClick={()=>{setProtecting(!protecting);setRegionStart(null);setAnchorName('');}}>{protecting?'Cancel marking':asset.protectedRegion?'Redraw protected region':'Mark protected region'}</button>{protecting && <p role="status">{regionStart?'Click the opposite corner.':'Click one corner around the complete product.'}</p>}{asset.protectedRegion && <label className="ss-check"><input type="checkbox" checked={asset.protectedRegion.approved} onChange={e=>changeAsset(asset.id,{protectedRegion:{...asset.protectedRegion,approved:e.target.checked}})}/><span>This region includes every product detail that must remain visible.</span></label>}</div>}
        <label>{asset.role==='reference'?'What should we learn from this ad?':'Art direction notes'}<textarea rows="3" value={asset.notes} onChange={e=>changeAsset(asset.id,{notes:e.target.value})} placeholder={asset.role==='reference'?'Typography, hierarchy, image treatment…':'Angle, campaign context, details to emphasize…'}/></label>
        <button className="ss-button ss-full" onClick={()=>run('Reading the photograph',analyzeAsset)}>Analyze {asset.role==='reference'?'reference':'photograph'}</button>{asset.analysis && <p className="ss-analysis">{asset.analysis}</p>}
        {asset.role==='product' && asset.productId && <details className="ss-details"><summary>Feature callouts ({asset.features.filter(f=>f.approved).length} verified)</summary><p>Select a feature, then click its exact location in the original above.</p><select aria-label="Feature to locate" value={anchorName} onChange={e=>setAnchorName(e.target.value)}><option value="">Choose a feature</option>{productFor(asset.productId).features.map(f=><option key={f}>{f}</option>)}</select>{anchorName && <p className="ss-placement">Click the {anchorName} in the photograph.</p>}{asset.features.map(f=><div key={f.name} className="ss-feature"><label className="ss-check"><input type="checkbox" checked={f.approved} onChange={e=>changeAsset(asset.id,{features:asset.features.map(row=>row.name===f.name?{...row,approved:e.target.checked}:row)})}/><span>{f.name}<small>I verified this anchor.</small></span></label><button aria-label={`Remove ${f.name} anchor`} onClick={()=>changeAsset(asset.id,{features:asset.features.filter(row=>row.name!==f.name)})}>×</button></div>)}</details>}
        <details className="ss-details"><summary>Original asset record</summary><p>{asset.width} × {asset.height} pixels. Complete image retained.</p><code>{asset.sha256}</code>{asset.driveId && <a href={`https://drive.google.com/file/d/${asset.driveId}/view`} target="_blank" rel="noreferrer">View source in Drive</a>}</details>
        <button className="ss-button ss-full" onClick={()=>{setView('create');}}>Continue to art direction</button>
      </>:<div className="ss-inspector-empty"><h2>Protect the product.</h2><p>Every creative uses an original photograph. Confirm each product once; that identity follows the asset into every layout and export.</p><ol><li>Import your photographs.</li><li>Confirm R1, R3, or R4 MKii.</li><li>Add references and creative notes.</li></ol></div>}</aside>
    </div>}
    {view==='create' && <div className="ss-create"><section><h2>Give the batch a point of view.</h2><p className="ss-intro">A good batch explores ideas, not just permutations. Choose your products and give the art director a brief.</p><label>Creative brief<textarea rows="5" value={w.brief} onChange={e=>update({...w,brief:e.target.value})} placeholder="For example: Fall camping. Lead with the moment around the fire. Keep copy short and make each product unmistakable."/></label><div className="ss-product-choices">{PRODUCTS.map(p=><label key={p.id} className={w.selectedProducts.includes(p.id)?'is-selected':''}><input type="checkbox" checked={w.selectedProducts.includes(p.id)} onChange={e=>update({...w,selectedProducts:e.target.checked?[...w.selectedProducts,p.id]:w.selectedProducts.filter(id=>id!==p.id)})}/><strong>{p.name}</strong><small>{eligible.filter(a=>a.productId===p.id).length} confirmed originals</small></label>)}</div><div className="ss-count"><label>Concepts per product<select value={w.count} onChange={e=>update({...w,count:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} concept{n===1?'':'s'}</option>)}</select></label><p><strong>{(w.selectedProducts.length-missing.length)*w.count*2} exports</strong><br/>4:5 feed + 9:16 story for every concept</p></div>
      <h3>Art direction</h3><div className="ss-directions"><button className={w.direction==='mix'?'is-selected':''} onClick={()=>update({...w,direction:'mix'})}><div className="ss-swatch ss-swatch-mix"/><strong>Curated mix</strong><span>Let the art director match each image.</span></button>{DIRECTIONS.map(d=><button key={d.id} className={w.direction===d.id?'is-selected':''} onClick={()=>update({...w,direction:d.id})}><div className="ss-swatch" style={{background:d.background,color:d.foreground}}><b>HOWL</b><i/></div><strong>{d.name}</strong><span>{d.description}</span></button>)}</div>
      {!!missing.length && <p className="ss-warning">{missing.map(id=>productFor(id).name).join(', ')} will be skipped until you confirm a photograph.</p>}
      {w.direction==='scene' && <p className="ss-warning">Immersive layouts require a confirmed protected product region and enough natural space for readable type. Other photographs use Field study.</p>}
      {w.direction==='technical' && <p className="ss-warning">Anatomy needs a verified feature anchor. Photographs without one use Field study.</p>}
      <div className="ss-generate-actions"><button className="ss-button ss-primary" disabled={!w.selectedProducts.length || missing.length===w.selectedProducts.length || w.concepts.length>=120} onClick={()=>run('Planning the batch',()=>generate(true))}>Generate with art director</button><button className="ss-button" disabled={!w.selectedProducts.length || missing.length===w.selectedProducts.length || w.concepts.length>=120} onClick={()=>run('Composing the batch',()=>generate(false))}>Manual layout samples</button></div><p className="ss-caption">The art director writes original concepts from your photos and brief, checks against previous ideas, and cites verified product facts. Manual layouts are legacy starting points, not original campaign concepts.</p>
    </section><aside className="ss-creative-note"><h3>The product stays real.</h3><p>Your photograph is a protected layer. The studio places type, color, and hierarchy around it.</p><div className="ss-format-demo"><div><span>4:5</span><i/><b>STAY<br/>OUT.</b></div><div><span>9:16</span><b>STAY<br/>OUT.</b><i/></div></div><p>Two compositions.<br/>One consistent idea.</p><ul><li>HOWL’s actual fonts and logo</li><li>Complete, proportional photography</li><li>Separate layouts for feed and story</li><li>Exact previews of exported artwork</li><li>Review before launcher handoff</li></ul></aside></div>}
    {view==='review' && <>
      <div className="ss-sheet-toolbar"><div><h2>The contact sheet</h2><p>{w.concepts.length} concepts / {w.concepts.length*2} placements</p></div><select aria-label="Filter concepts by product" value={productFilter} onChange={e=>setProductFilter(e.target.value)}><option value="all">All products</option>{PRODUCTS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="ss-button" disabled={!visibleConcepts.length} onClick={()=>run('Preparing paired exports',()=>downloadConcepts(visibleConcepts))}><DownloadIcon/>Download pairs</button><button className="ss-button" disabled={!visibleConcepts.length} onClick={()=>run('Rendering the batch',async()=>{for(const [i,c] of visibleConcepts.entries()){if(cancelRef.current)break;setBusy(`Rendering pair ${i+1} of ${visibleConcepts.length}`);if(!c.render)await persistRender(c);}setMessage('Batch renders saved. Review each pair before approval.');})}>Render batch</button><button className="ss-button ss-dark" disabled={!visibleConcepts.length} onClick={()=>run('Finishing the batch',finishBatch)}>Render, review & refine</button><button className="ss-button" onClick={()=>setView('create')}>New batch</button></div>
      {!w.concepts.length?<div className="ss-empty"><ImageIcon/><h3>Your next campaign starts here.</h3><p>Choose confirmed photographs and a creative direction to build your first paired concepts.</p><button className="ss-button ss-primary" onClick={()=>setView('create')}>Create a batch</button></div>:<>
      <div className="ss-contact-sheet">{visibleConcepts.map(c=>{const a=w.assets.find(a=>a.id===c.assetId),d=DIRECTIONS.find(d=>d.id===c.direction);return <button key={c.id} className={`ss-concept-card ${conceptId===c.id?'is-selected':''}`} onClick={()=>setConceptId(c.id)}>{c.render?<img src={c.render.feedUrl} crossOrigin="anonymous" alt={`${productFor(c.productId).name}: ${c.headline}`} loading="lazy"/>:<div className="ss-draft-thumb" style={{background:d.background,color:d.foreground}}><small>HOWL / {productFor(c.productId).name}</small><strong>{c.headline}</strong><img src={a.previewUrl || a.url} crossOrigin="anonymous" alt="" loading="lazy"/><span>Draft composition</span></div>}<div className="ss-card-caption"><strong>{productFor(c.productId).name} / {d.name}</strong><span className={c.approval?'is-approved':''}>{humanStatus(c)}</span></div></button>;})}</div>
      {concept && source && <div className="ss-review-layout"><section className="ss-workbench"><div className="ss-workbench-header"><div><h3>{concept.angle}</h3>{concept.premise && <p>{concept.premise}</p>}{concept.visualIdea && <p>{concept.visualIdea}</p>}<p>{concept.rationale}</p></div><label className="ss-check"><input type="checkbox" checked={safeAreas} onChange={e=>setSafeAreas(e.target.checked)}/>Show safe areas</label></div>
        {previewError && <div className="ss-alert" role="alert">{previewError}</div>}
        <div className="ss-pair">{['feed','story'].map(format=><figure key={format} className={`ss-placement-preview ${format}`}><div className="ss-artboard" style={{aspectRatio:`${FORMATS[format].width}/${FORMATS[format].height}`}}>{preview?<img src={preview[`${format}Url`]} alt={`${FORMATS[format].label} exported preview: ${concept.headline}`}/>:<div className="ss-preview-pending">{previewLoading?'Composing…':'Preview unavailable'}</div>}{safeAreas && <div className={`ss-safe ${format}`}><span>Keep critical content inside</span></div>}</div><figcaption><strong>{FORMATS[format].label}</strong><span>{FORMATS[format].width} × {FORMATS[format].height}</span></figcaption></figure>)}</div>
        <details className="ss-checks" open><summary>Production checks{preview?` / ${preview.checks.filter(c=>c.level==='error').length} errors`:''}</summary>{preview?.checks.filter(c=>c.level!=='pass').map(c=><p key={c.code} className={c.level==='error'?'ss-check-error':'ss-warning'}>{c.message}</p>)}<div>{preview && [...new Set(preview.checks.filter(c=>c.level==='pass').map(c=>c.message.replace(/^\S+: /,'')))].map(text=><p key={text}>✓ {text}</p>)}</div></details>
      </section><aside className="ss-inspector"><div className="ss-inspector-title"><h3>Refine the concept</h3><span>{humanStatus(concept)}</span></div><label>Art direction<select value={concept.direction} onChange={e=>changeConcept({direction:e.target.value,featureName:e.target.value==='technical'?(source.features.find(f=>f.approved)?.name || ''):''})}>{DIRECTIONS.map(d=><option key={d.id} value={d.id} disabled={d.id==='technical' && !source.features.some(f=>f.approved) || d.id==='scene' && !source.protectedRegion?.approved}>{d.name}</option>)}</select></label><label>Source photograph<select value={concept.assetId} onChange={e=>changeConcept({assetId:e.target.value,featureName:'',direction:concept.direction==='technical'?'field':concept.direction})}>{eligible.filter(a=>a.productId===concept.productId).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Headline<textarea aria-label="Headline" rows="3" maxLength="120" value={concept.headline} onChange={e=>changeConcept({headline:e.target.value})}/></label><label>Supporting copy<textarea aria-label="Supporting copy" rows="2" maxLength="220" value={concept.body} onChange={e=>changeConcept({body:e.target.value})}/></label><label>Call to action<input maxLength="60" value={concept.cta} onChange={e=>changeConcept({cta:e.target.value})}/></label>
        <label>Headline size <input type="range" min="0.8" max="1.15" step="0.05" value={concept.scale} onChange={e=>changeConcept({scale:Number(e.target.value)})}/></label><div className="ss-two-fields"><label>Feed alignment<select value={concept.align} onChange={e=>changeConcept({align:e.target.value})}><option value="left">Left</option><option value="center">Centered</option></select></label><label>Story alignment<select value={concept.storyAlign} onChange={e=>changeConcept({storyAlign:e.target.value})}><option value="left">Left</option><option value="center">Centered</option></select></label></div>
        {concept.direction==='technical' && <label>Verified feature<select value={concept.featureName} onChange={e=>changeConcept({featureName:e.target.value})}><option value="">Choose feature</option>{source.features.filter(f=>f.approved).map(f=><option key={f.name}>{f.name}</option>)}</select></label>}
        <details className="ss-details"><summary>House copy alternatives</summary>{COPY[concept.productId].map(copy=><button className="ss-copy-option" key={copy.id} onClick={()=>changeConcept({headline:copy.headline,body:copy.body,angle:copy.angle})}>{copy.headline.replaceAll('\n',' ')}</button>)}</details>
        <button className="ss-button ss-full" disabled={!preview || preview.checks.some(c=>c.level==='error')} onClick={()=>run('Rendering both placements',async()=>{await persistRender(concept);setMessage('Both exports saved.');})}>Save paired renders</button><button className="ss-button ss-full" disabled={!preview || preview.checks.some(c=>c.level==='error')} onClick={()=>run('Preparing visual review',()=>reviewConcept())}>Run visual review</button>
        {concept.review?.verdict==='revise' && <button className="ss-button ss-full" onClick={()=>run('Refining the concept',()=>finishConcept(concept))}>Refine with art director</button>}
        {concept.review && <div className={`ss-visual-review ${concept.review.verdict}`}><h4>{concept.review.verdict==='pass'?'Visual review passed':'Revisions recommended'}</h4><p>{concept.review.summary}</p>{concept.review.issues.length>0 && <ul>{concept.review.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>}</div>}
        <button className="ss-button ss-full" onClick={()=>{update(current=>({...current,concepts:current.concepts.filter(c=>c.id!==concept.id)}));setConceptId('');setMessage('Concept removed from the studio. Existing launcher drafts are retained.');}}>Remove concept</button><div className="ss-approval"><p>Approve only after checking the product, copy, and both placements. Your approval applies to this exact design; edits reset it.</p><button className="ss-button ss-dark ss-full" disabled={!preview || preview.checks.some(c=>c.level==='error') || !!concept.approval} onClick={()=>run('Approving both placements',approveConcept)}>{concept.approval?'Pair approved':'I reviewed both — approve pair'}</button>{concept.approval && <button className="ss-button ss-primary ss-full" disabled={concept.launchedToQueue} onClick={()=>run('Sending pair to launcher',()=>sendConcepts([concept]))}>{concept.launchedToQueue?'Saved in launcher':'Send pair to launcher'}</button>}</div>
      </aside></div>}
      </>}
    </>}
    </fieldset>
  </div>;
}
