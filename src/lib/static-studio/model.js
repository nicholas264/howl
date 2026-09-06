import { PRODUCTS } from '../../data/products.js';

export const STUDIO_VERSION = 1;
export const RENDER_VERSION = 2;
export const FORMATS = { feed: { width:1080, height:1350, label:'4:5' }, story: { width:1080, height:1920, label:'9:16' } };
export const DIRECTIONS = [
  { id:'scene', name:'In the moment', description:'Immersive photography. Type in real negative space. Protected product region required.', background:'#101719', foreground:'#F9F3DF' },
  { id:'expedition', name:'Expedition', description:'A bold headline and an uninterrupted photograph.', background:'#333F4C', foreground:'#F9F3DF' },
  { id:'field', name:'Field study', description:'A quiet, precise product story on natural paper.', background:'#F9F3DF', foreground:'#333F4C' },
  { id:'signal', name:'Signal fire', description:'Flame-orange type with a generous photographic stage.', background:'#DC440A', foreground:'#F9F3DF' },
  { id:'technical', name:'Anatomy', description:'One verified feature. One precise point of focus.', background:'#333F4C', foreground:'#F9F3DF' },
];
// Legacy manual layout samples only. AI concepts write original copy and cite verified facts.
export const COPY = {
  r1: [
    { id:'r1-pack', headline:'Pack small.\nStay out.', body:'Meet the HOWL R1.', angle:'Packability' },
    { id:'r1-night', headline:'Make room\nfor the night.', body:'The HOWL R1. Bring your campfire.', angle:'More time outside' },
    { id:'r1-road', headline:'Good roads end.\nGood nights don’t.', body:'Take the HOWL R1 along.', angle:'Adventure' },
    { id:'r1-fire', headline:'Your next\ncampfire.', body:'Meet the HOWL R1.', angle:'Product discovery' },
    { id:'r1-tales', headline:'Bring a fire.\nLeave with stories.', body:'The HOWL R1.', angle:'Togetherness' },
  ],
  r3: [
    { id:'r3-season', headline:'Stay for\nanother season.', body:'Meet the HOWL R3.', angle:'Shoulder season' },
    { id:'r3-morning', headline:'Mornings\nworth staying for.', body:'Bring the HOWL R3.', angle:'Camp mornings' },
    { id:'r3-evening', headline:'The evening\nis still yours.', body:'Meet the HOWL R3.', angle:'More time outside' },
    { id:'r3-out', headline:'Keep going\nout there.', body:'The HOWL R3.', angle:'Adventure' },
    { id:'r3-fire', headline:'Find your\nkind of fire.', body:'Meet the HOWL R3.', angle:'Product discovery' },
  ],
  r4mkii: [
    { id:'r4-cold', headline:'Cold nights.\nGood company.', body:'Meet the HOWL R4 MKii.', angle:'Cold-weather camping' },
    { id:'r4-stay', headline:'Stay out\na little longer.', body:'Bring the HOWL R4 MKii.', angle:'More time outside' },
    { id:'r4-dark', headline:'The best part\nstarts after dark.', body:'Meet the HOWL R4 MKii.', angle:'Camp evenings' },
    { id:'r4-far', headline:'Go far.\nGather close.', body:'The HOWL R4 MKii.', angle:'Togetherness' },
    { id:'r4-fire', headline:'Make it\na HOWL night.', body:'Meet the HOWL R4 MKii.', angle:'Product discovery' },
  ],
};
export const productFor = id => PRODUCTS.find(p => p.id === id);
export const blankWorkspace = () => ({ version:STUDIO_VERSION, assets:[], concepts:[], brief:'', selectedProducts:PRODUCTS.map(p=>p.id), count:3, direction:'mix', folder:'' });
export const safeText = (s, max=200) => typeof s === 'string' ? s.trim().slice(0,max) : '';
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function validAssetUrl(value) {
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && u.hostname.endsWith('.public.blob.vercel-storage.com'); } catch { return false; }
}
export function normalizeAsset(asset) {
  assert(asset && typeof asset==='object', 'Invalid asset');
  assert(/^[\w-]{1,100}$/.test(asset.id || ''), 'Invalid asset ID');
  assert(validAssetUrl(asset.url), 'Assets must be imported into the HOWL media store.');
  assert(Number.isInteger(asset.width) && Number.isInteger(asset.height) && asset.width>0 && asset.height>0 && asset.width*asset.height<=80000000, 'Invalid image dimensions (maximum 80 megapixels).');
  assert(/^[a-f0-9]{64}$/.test(asset.sha256 || ''), 'Original asset fingerprint required.');
  assert(!asset.productId || productFor(asset.productId), 'Unknown product');
  const features=(Array.isArray(asset.features)?asset.features:[]).slice(0,5).map(f=>{
    assert(productFor(asset.productId)?.features.includes(f.name), 'Feature does not belong to this product.');
    assert(Number.isFinite(f.x) && Number.isFinite(f.y) && f.x>=0 && f.x<=1 && f.y>=0 && f.y<=1, 'Feature anchor must be inside the photograph.');
    return {name:f.name,x:f.x,y:f.y,approved:f.approved===true};
  });
  const protectedRegion=normalizeProtectedRegion(asset.protectedRegion);
  return {id:asset.id,url:asset.url,name:safeText(asset.name,160),width:asset.width,height:asset.height,sha256:asset.sha256,
    previewUrl:validAssetUrl(asset.previewUrl)?asset.previewUrl:'', productId:asset.productId || '', approved:asset.approved===true, role:asset.role==='reference'?'reference':'product',
    features, protectedRegion, notes:safeText(asset.notes,1200), analysis:safeText(asset.analysis,2000),
    driveId:safeText(asset.driveId,120),driveModified:safeText(asset.driveModified,80),createdAt:safeText(asset.createdAt,80)};
}
export function conceptFingerprint(c, asset) {
  // An exact, readable input snapshot, not a security hash. Every editable design
  // field and source revision participates; any edit invalidates render/review.
  return JSON.stringify([STUDIO_VERSION,RENDER_VERSION,c.productId,c.assetId,asset?.sha256,asset?.approved,asset?.productId,asset?.features,asset?.protectedRegion,
    c.direction,c.headline,c.body,c.featureName,c.cta,c.scale,c.align,c.storyAlign,c.premise || '',c.visualIdea || '',c.claimIds || []]);
}
export function normalizeConcept(c, assets) {
  assert(c && /^[\w-]{1,100}$/.test(c.id || ''),'Invalid concept ID');
  const asset=assets.find(a=>a.id===c.assetId);
  assert(asset && asset.role==='product' && asset.productId===c.productId,'Concept source must match its product.');
  assert(DIRECTIONS.some(d=>d.id===c.direction),'Unknown art direction');
  const result={id:c.id,assetId:c.assetId,productId:c.productId,direction:c.direction,headline:safeText(c.headline,120),body:safeText(c.body,220),
    cta:safeText(c.cta || 'Explore the '+productFor(c.productId).name,60),featureName:safeText(c.featureName,100),
    premise:safeText(c.premise,500),visualIdea:safeText(c.visualIdea,500),claimIds:Array.isArray(c.claimIds)?c.claimIds.filter(id=>typeof id==='string').slice(0,8):[],
    angle:safeText(c.angle,100),rationale:safeText(c.rationale,700),scale:Math.max(0.8,Math.min(1.15,Number(c.scale)||1)),
    align:['left','center'].includes(c.align)?c.align:'left',storyAlign:['left','center'].includes(c.storyAlign)?c.storyAlign:'left'};
  const fingerprint=conceptFingerprint(result,asset);
  if(c.render?.fingerprint===fingerprint && validAssetUrl(c.render.feedUrl) && validAssetUrl(c.render.storyUrl)) {
    result.render={fingerprint,feedUrl:c.render.feedUrl,storyUrl:c.render.storyUrl,checks:(c.render.checks || []).slice(0,30).map(i=>({code:safeText(i.code,60),message:safeText(i.message,300),level:['pass','warning','error'].includes(i.level)?i.level:'error'}))};
  }
  if(c.review?.fingerprint===fingerprint && result.render) result.review={fingerprint,summary:safeText(c.review.summary,2000),verdict:['pass','revise'].includes(c.review.verdict)?c.review.verdict:'revise',issues:(c.review.issues || []).slice(0,12).map(s=>safeText(s,300))};
  if(c.approval?.fingerprint===fingerprint && result.render && !result.render.checks.some(i=>i.level==='error')) result.approval={fingerprint,at:safeText(c.approval.at,80)};
  if(c.launchedToQueue && result.approval) result.launchedToQueue=true;
  return result;
}
export function normalizeWorkspace(input) {
  assert(input?.version===STUDIO_VERSION,'Unsupported studio version. Reload the application.');
  assert(Array.isArray(input.assets) && input.assets.length<=240,'A studio can hold up to 240 assets.');
  assert(Array.isArray(input.concepts) && input.concepts.length<=120,'A studio can hold up to 120 concepts.');
  const assets=input.assets.map(normalizeAsset);
  assert(new Set(assets.map(a=>a.id)).size===assets.length,'Duplicate asset IDs');
  const concepts=input.concepts.map(c=>normalizeConcept(c,assets));
  assert(new Set(concepts.map(c=>c.id)).size===concepts.length,'Duplicate concept IDs');
  return {version:STUDIO_VERSION,assets,concepts,brief:safeText(input.brief,2000),folder:safeText(input.folder,500),
    selectedProducts:[...new Set((input.selectedProducts || []).filter(id=>productFor(id)))],count:Math.max(1,Math.min(5,Math.floor(Number(input.count)||3))),
    direction:input.direction==='mix' || DIRECTIONS.some(d=>d.id===input.direction)?input.direction:'mix'};
}
export function generateConcepts(workspace, choices=[]) {
  const result=[];
  const total=workspace.selectedProducts.filter(id=>workspace.assets.some(a=>a.productId===id && a.approved && a.role==='product')).length*workspace.count;
  assert(workspace.concepts.length+total<=120, 'This batch would exceed 120 concepts. Remove older concepts or reduce the batch size.');
  for(const productId of workspace.selectedProducts) {
    const assets=workspace.assets.filter(a=>a.productId===productId && a.approved && a.role==='product');
    if(!assets.length) continue;
    for(let i=0;i<workspace.count;i++) {
      const choice=choices.filter(c=>c.productId===productId)[i];
      const asset=assets.find(a=>a.id===choice?.assetId) || assets[i%assets.length];
      const copy=COPY[productId].find(c=>c.id===choice?.copyId) || COPY[productId][i%COPY[productId].length];
      const approvedFeature=asset.features.find(f=>f.approved);
      const families=DIRECTIONS.filter(d=>(d.id!=='technical' || approvedFeature) && (d.id!=='scene' || asset.protectedRegion?.approved));
      let direction=workspace.direction==='mix' ? (families.find(d=>d.id===choice?.direction)?.id || families[i%families.length].id) : workspace.direction;
      if(direction==='technical' && !approvedFeature || direction==='scene' && !asset.protectedRegion?.approved) direction='field';
      result.push({id:crypto.randomUUID(),assetId:asset.id,productId,direction,headline:choice?.headline || copy.headline,body:choice?.headline?choice.body:copy.body,angle:choice?.angle || copy.angle,
        premise:choice?.premise || '',visualIdea:choice?.visualIdea || '',claimIds:choice?.claimIds || [],
        featureName:direction==='technical'?approvedFeature.name:'',cta:choice?.cta || 'Explore the '+productFor(productId).name,scale:1,align:'left',storyAlign:'left',
        rationale:safeText(choice?.rationale,700) || `${copy.angle}. Original photograph preserved in a dedicated image area; each placement is composed independently.`});
    }
  }
  return result;
}
export function containRect(imageWidth,imageHeight,box) {
  const scale=Math.min(box.w/imageWidth,box.h/imageHeight);
  return {x:box.x+(box.w-imageWidth*scale)/2,y:box.y+(box.h-imageHeight*scale)/2,w:imageWidth*scale,h:imageHeight*scale,scale};
}
export function designGeometry(concept, formatId) {
  const {width:w,height:h}=FORMATS[formatId];
  const story=formatId==='story';
  const top=story?240:66, bottom=story?280:66;
  const safe={x:64,y:top,w:w-128,h:h-top-bottom};
  const footerY=h-bottom-32;
  const base={w,h,top,bottom,safe,footerY,logo:{x:72,y:top,w:146,h:68},product:{x:244,y:top+22},align:story?concept.storyAlign:concept.align};
  if(concept.direction==='scene') return {...base,photo:{x:0,y:0,w,h},headline:{x:72,y:top+120,w:936,h:story?300:240},body:{x:72,y:footerY-105,w:936,h:64},headlineSize:story?104:94,overlay:true};
  if(concept.direction==='signal') {
    // A tall photographic column and a separate typographic column.
    return {...base,headline:{x:72,y:top+138,w:352,h:story?630:560},
      photo:{x:472,y:top+108,w:536,h:footerY-top-155},
      body:{x:72,y:footerY-175,w:350,h:120},headlineSize:76,bodySize:34};
  }
  if(concept.direction==='field') {
    // Photograph first; the headline becomes its caption, not another overlay.
    const photo={x:72,y:top+110,w:936,h:story?750:570};
    const headline={x:72,y:photo.y+photo.h+26,w:936,h:story?246:220};
    return {...base,photo,headline,body:{x:72,y:headline.y+headline.h+12,w:936,h:62},headlineSize:story?94:86};
  }
  const technical=concept.direction==='technical';
  const headline={x:72,y:top+98,w:936,h:story?300:240};
  const photo={x:48,y:headline.y+headline.h+22,w:984,h:h-bottom-(headline.y+headline.h+22)-(technical?202:155)};
  return {...base,headline,photo,body:{x:72,y:photo.y+photo.h+30,w:936,h:technical?95:65},headlineSize:story?104:94};
}

export function applyArtDirectionRepair(concept,asset,repair) {
  const copy=repair?.headline?validateCreativeCopy(repair,asset):COPY[concept.productId].find(c=>c.id===repair?.copyId);
  const direction=DIRECTIONS.find(d=>d.id===repair?.direction);
  assert(copy && direction,'Art director returned an unsupported revision.');
  assert(direction.id!=='scene' || asset.protectedRegion?.approved,'Revision requires a protected product region.');
  assert(direction.id!=='technical' || asset.features.some(f=>f.approved),'Revision requires an unverified feature.');
  assert(['left','center'].includes(repair.align) && ['left','center'].includes(repair.storyAlign),'Invalid alignment revision.');
  assert(Number.isFinite(repair.scale) && repair.scale>=.8 && repair.scale<=1.15,'Invalid type-size revision.');
  const {render,review,approval,launchedToQueue,...draft}=concept;
  return {...draft,...(repair.headline?copy:{}),headline:copy.headline,body:copy.body,angle:copy.angle,direction:direction.id,scale:repair.scale,align:repair.align,storyAlign:repair.storyAlign,
    featureName:direction.id==='technical'?asset.features.find(f=>f.approved).name:'',rationale:safeText(repair.reason,700)};
}

export function artDirectorVisualAssets(workspace) {
  const uses=new Map();
  for(const c of workspace.concepts)uses.set(c.assetId,(uses.get(c.assetId) || 0)+1);
  const eligible=workspace.assets.filter(a=>a.approved && a.role==='product' && workspace.selectedProducts.includes(a.productId)).sort((a,b)=>(uses.get(a.id) || 0)-(uses.get(b.id) || 0));
  // Rotate toward unused photographs; every product gets evidence before extras.
  const chosen=workspace.selectedProducts.map(id=>eligible.find(a=>a.productId===id)).filter(Boolean);
  for(const asset of eligible) if(chosen.length<9 && !chosen.some(a=>a.id===asset.id))chosen.push(asset);
  return [...chosen,...workspace.assets.filter(a=>a.role==='reference').slice(0,2)];
}
export function validateArtDirectorPlan(workspace,choices) {
  assert(Array.isArray(choices),'Art director did not return concepts.');
  const productIds=workspace.selectedProducts.filter(id=>workspace.assets.some(a=>a.approved && a.role==='product' && a.productId===id));
  assert(choices.length===productIds.length*workspace.count,'Art director returned an incomplete batch. Retry art direction; no fallback concepts were substituted.');
  const combinations=new Set();
  const normalized=choices.map(choice=>{
    assert(productIds.includes(choice?.productId),'Art director selected an unrequested product.');
    const asset=workspace.assets.find(a=>a.id===choice.assetId && a.productId===choice.productId && a.approved && a.role==='product');
    assert(asset,'Art director selected a source that is not approved for this product.');
    const creative=validateCreativeCopy(choice,asset);
    assert(choice.direction!=='scene' || asset.protectedRegion?.approved,'Immersive concepts require a protected product region.');
    assert(DIRECTIONS.some(d=>d.id===choice.direction),'Art director selected an unsupported layout.');
    assert(choice.direction!=='technical' || asset.features.some(f=>f.approved),'Art director selected an unverified callout.');
    const intended=(workspace.direction==='technical' && !asset.features.some(f=>f.approved) || workspace.direction==='scene' && !asset.protectedRegion?.approved)?'field':workspace.direction;
    assert(intended==='mix' || choice.direction===intended,'Art director did not follow the selected layout direction.');
    const key=noveltyKey(creative.headline);
    assert(!combinations.has(key),'Art director repeated a concept. Retry for a distinct batch.');combinations.add(key);
    for(const prior of [...workspace.concepts,...choices.slice(0,choices.indexOf(choice))]) {
      assert(!tooSimilar(creative.headline,prior.headline),'Art director recycled a headline. Request a new idea.');
      assert(!tooSimilar(creative.premise,prior.premise),'Art director repeated the same premise. Request a distinct idea.');
    }
    return {productId:choice.productId,assetId:choice.assetId,...creative,direction:choice.direction,rationale:safeText(choice.rationale,700)};
  });
  for(const id of productIds)assert(normalized.filter(c=>c.productId===id).length===workspace.count,`Art director returned the wrong number of concepts for ${productFor(id).name}.`);
  return normalized;
}


export function normalizeProtectedRegion(region) {
  if(!region)return null;
  const {x,y,w,h}=region;
  assert([x,y,w,h].every(Number.isFinite) && x>=0 && y>=0 && w>0 && h>0 && x+w<=1.000001 && y+h<=1.000001,'Protected region must be inside the photograph.');
  return {x,y,w,h,approved:region.approved===true};
}
export function scenePhotoRect(asset,box) {
  const region=normalizeProtectedRegion(asset.protectedRegion);
  assert(region?.approved,'Mark and confirm the complete product region before using an immersive layout.');
  const scale=Math.max(box.w/asset.width,box.h/asset.height),w=asset.width*scale,h=asset.height*scale;
  // Only empty surroundings may leave the canvas. Center the product when possible.
  const x=Math.max(box.x+box.w-w,Math.min(box.x,box.x+box.w/2-(region.x+region.w/2)*w));
  const y=Math.max(box.y+box.h-h,Math.min(box.y,box.y+box.h/2-(region.y+region.h/2)*h));
  const protectedBox={x:x+region.x*w,y:y+region.y*h,w:region.w*w,h:region.h*h};
  assert(protectedBox.x>=box.x-0.01 && protectedBox.y>=box.y-0.01 && protectedBox.x+protectedBox.w<=box.x+box.w+0.01 && protectedBox.y+protectedBox.h<=box.y+box.h+0.01,'This photograph cannot fill this format without cropping the protected product. Choose another photograph or layout.');
  return {x,y,w,h,scale,protectedBox};
}
export function verifiedFacts(asset) {
  return [{id:'identity',text:productFor(asset.productId)?.name || ''},...asset.features.filter(f=>f.approved).map((f,i)=>({id:`feature-${i}`,text:f.name}))];
}
export function validateCreativeCopy(choice,asset) {
  for(const [key,max] of [['headline',120],['body',220],['cta',60],['angle',100],['premise',500],['visualIdea',500]]) {
    assert(typeof choice?.[key]==='string' && choice[key].length<=max && (key==='body' || choice[key].trim().length>0),`Art director must provide original ${key} within ${max} characters.`);
  }
  assert(Array.isArray(choice.claimIds) && choice.claimIds.length<=8,'Art director must identify the facts used by the concept.');
  const facts=verifiedFacts(asset);
  assert(choice.claimIds.every(id=>facts.some(f=>f.id===id)),'Concept cites a fact that is not verified for this photograph.');
  // Semantic accuracy is checked independently in visual review; this catches common
  // unsupported numerical, offer and regulatory claims before paying for a render.
  const copy=[choice.headline,choice.body,choice.cta].join(' ').replace(/\bR[134](?:\s*MKii)?\b/gi,'');
  assert(!/[0-9%$£€]|\b(?:burn[ -]?ban|ban[ -]?approved|fire[ -]?ban|guaranteed|certified|smokeless|smoke[ -]?free|safest|hottest|best[ -]?selling)\b/i.test(copy),'Copy contains an unsupported measurable, offer, regulatory or absolute claim.');
  return Object.fromEntries(['headline','body','cta','angle','premise','visualIdea','claimIds'].map(key=>[key,key==='claimIds'?[...new Set(choice[key])]:choice[key].trim()]));
}
function noveltyKey(text='') {return text.toLowerCase().replace(/\b(?:howl|r1|r3|r4|mkii)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function tooSimilar(a,b) {
  if(!a || !b)return false;
  const left=noveltyKey(a),right=noveltyKey(b);
  if(left===right)return true;
  const tokens=s=>new Set(s.split(' ').filter(t=>t.length>2));
  const x=tokens(left),y=tokens(right),intersection=[...x].filter(t=>y.has(t)).length;
  return x.size>2 && y.size>2 && intersection/(x.size+y.size-intersection)>.72;
}
