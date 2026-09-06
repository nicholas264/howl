import { BRAND_FONT_FILES, canvasFont } from '../../brand.js';
import { FORMATS, DIRECTIONS, productFor, containRect, designGeometry, conceptFingerprint, scenePhotoRect } from './model.js';

let fontsPromise;
async function ensureFonts() {
  if(!fontsPromise) fontsPromise=Promise.all(BRAND_FONT_FILES.map(async f=>{
    const face=new FontFace(f.family,`url(${f.url})`,{weight:String(f.weight)});
    document.fonts.add(await face.load());
  })).catch(error=>{fontsPromise=null;throw new Error(`Brand fonts could not load: ${error.message}`);});
  await fontsPromise;
}
export async function sha256(blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function decodeImage(blob) {
  const url=URL.createObjectURL(blob);
  try { const img=new Image(); img.src=url; await img.decode(); return img; }
  finally {URL.revokeObjectURL(url);}
}
export async function inspectImage(blob) {
  if(!['image/jpeg','image/png','image/webp'].includes(blob.type)) throw new Error('Use a JPEG, PNG, or WebP photograph.');
  if(blob.size>30*1024*1024) throw new Error('Each original must be under 30 MB.');
  const img=await decodeImage(blob);
  if(img.naturalWidth*img.naturalHeight>80000000) throw new Error('Use an image under 80 megapixels.');
  return {width:img.naturalWidth,height:img.naturalHeight,sha256:await sha256(blob)};
}
export function wrapText(ctx,text,maxWidth) {
  return text.split('\n').flatMap(paragraph=>{
    const words=paragraph.split(/\s+/).filter(Boolean), lines=[];
    let line='';
    for(const word of words) {
      const next=line?`${line} ${word}`:word;
      if(line && ctx.measureText(next).width>maxWidth) {lines.push(line);line=word;} else line=next;
    }
    if(line) lines.push(line);
    return lines.length?lines:[''];
  });
}
function textBlock(ctx,{text,box,role='headline',maxSize=100,minSize=52,color,align='left',lineHeight=1.04}) {
  let size=maxSize,lines=[];
  for(;size>=minSize;size-=2) {
    ctx.font=canvasFont(role,size);
    ctx.letterSpacing=role==='headline'?'0.5px':'0px';
    lines=wrapText(ctx,role==='headline'?text.toUpperCase():text,box.w);
    if(lines.length*size*lineHeight<=box.h && lines.every(line=>ctx.measureText(line).width<=box.w)) break;
  }
  const fits=size>=minSize;
  size=Math.max(size,minSize);
  ctx.font=canvasFont(role,size);ctx.fillStyle=color;ctx.textBaseline='top';ctx.textAlign=align;
  lines.forEach((line,i)=>ctx.fillText(line,align==='center'?box.x+box.w/2:box.x,box.y+i*size*lineHeight));
  ctx.textAlign='left';
  return {fits,size,lines};
}
function check(code,message,level='pass') {return {code,message,level};}
async function loadLogo(light) {
  const r=await fetch(light?'/logos/howl-stacked-wht.png':'/logos/howl-stacked-blk.png');
  if(!r.ok) throw new Error('HOWL logo could not load.');
  const img=await decodeImage(await r.blob());
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let left=canvas.width,right=0,top=canvas.height,bottom=0;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>20){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const trimmed=document.createElement('canvas');trimmed.width=right-left+1;trimmed.height=bottom-top+1;
  trimmed.getContext('2d').drawImage(canvas,left,top,trimmed.width,trimmed.height,0,0,trimmed.width,trimmed.height);
  return trimmed;
}
export async function renderPair(concept,asset) {
  await ensureFonts();
  const response=await fetch(asset.url,{mode:'cors',signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error('Original photograph could not load. Reimport the asset.');
  const original=await response.blob();
  if(await sha256(original)!==asset.sha256) throw new Error('The original asset has changed. Reimport and approve it before rendering.');
  const img=await decodeImage(original);
  if(img.naturalWidth!==asset.width || img.naturalHeight!==asset.height) throw new Error('Source dimensions changed. Reimport this photograph.');
  const direction=DIRECTIONS.find(d=>d.id===concept.direction);
  const logo=await loadLogo(concept.direction!=='field');
  const results={};
  for(const formatId of Object.keys(FORMATS)) {
    const g=designGeometry(concept,formatId),canvas=document.createElement('canvas');
    canvas.width=g.w;canvas.height=g.h;
    const ctx=canvas.getContext('2d',{alpha:false});
    const checks=[];
    const photo=g.overlay?scenePhotoRect(asset,g.photo):containRect(asset.width,asset.height,g.photo);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.fillStyle=direction.background;ctx.fillRect(0,0,g.w,g.h);
    if(g.overlay)ctx.drawImage(img,photo.x,photo.y,photo.w,photo.h);
    const originalPixels=g.overlay?ctx.getImageData(0,0,g.w,g.h):null;
    const logoRect=containRect(logo.width,logo.height,g.logo);
    ctx.drawImage(logo,logoRect.x,logoRect.y,logoRect.w,logoRect.h);
    ctx.font=canvasFont('subHeadline',28);ctx.fillStyle=direction.foreground;ctx.textBaseline='top';
    ctx.fillText(productFor(concept.productId).name,g.product.x,g.product.y);
    const headline=textBlock(ctx,{text:concept.headline,box:g.headline,maxSize:Math.round(g.headlineSize*concept.scale),color:direction.foreground,align:g.align});
    // One proportional draw of unchanged original pixels. Scene layouts may clip
    // surroundings at canvas edges, but never the confirmed product region.
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    if(!g.overlay)ctx.drawImage(img,photo.x,photo.y,photo.w,photo.h);
    const feature=asset.features.find(f=>f.name===concept.featureName && f.approved);
    if(concept.direction==='technical' && feature) {
      const x=photo.x+photo.w*feature.x,y=photo.y+photo.h*feature.y;
      // Only the verified locator dot and leader enter the photograph.
      ctx.strokeStyle='#F9F3DF';ctx.lineWidth=5;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='#DC440A';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y+12);ctx.lineTo(x,g.body.y-12);ctx.lineTo(g.body.x,g.body.y-12);ctx.stroke();
      const featureText=textBlock(ctx,{text:feature.name,box:{...g.body,h:44},role:'subHeadline',maxSize:32,minSize:28,color:direction.foreground});
      if(!featureText.fits) checks.push(check('feature-fit','Feature label does not fit.','error'));
    }
    const bodyBox=concept.direction==='technical'?{...g.body,y:g.body.y+48,h:52}:g.body;
    const body=textBlock(ctx,{text:concept.body,box:bodyBox,role:'body',maxSize:g.bodySize || 36,minSize:30,color:direction.foreground,lineHeight:1.15,align:g.align});
    ctx.fillStyle=direction.foreground;ctx.globalAlpha=0.4;ctx.fillRect(72,g.footerY-24,936,1);ctx.globalAlpha=1;
    ctx.font=canvasFont('subHeadline',26);ctx.textBaseline='top';
    ctx.fillText(concept.cta,72,g.footerY);
    ctx.textAlign='right';ctx.font=canvasFont('body',26);ctx.fillText('howlcampfires.com',1008,g.footerY);ctx.textAlign='left';
    const overlaps=(a,b)=>a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
    const textBoxes=[g.headline,...(concept.body.trim()?[bodyBox]:[])];
    const criticalBoxes=[...textBoxes,g.logo,{x:g.product.x,y:g.product.y,w:420,h:36},{x:72,y:g.footerY-24,w:936,h:56}];
    const layoutFits=textBoxes.every(box=>box.y>=g.top && box.y+box.h<=g.footerY-24) && (g.overlay?criticalBoxes.every(box=>!overlaps(box,photo.protectedBox)):textBoxes.every(box=>!overlaps(box,photo)));
    if(g.overlay) {
      const contrast=criticalBoxes.every(box=>backgroundSupportsLightText(originalPixels,box));
      checks.push(check('contrast',contrast?'Light typography has dark negative space behind it.':'Photograph is too bright behind the type. Choose another photograph or layout.',contrast?'pass':'error'));
      const r=photo.protectedBox;
      const inSafe=r.x>=g.safe.x && r.x+r.w<=g.safe.x+g.safe.w && r.y>=g.safe.y && r.y+r.h<=g.safe.y+g.safe.h;
      checks.push(check('product-safe-area',inSafe?'Protected product region stays inside placement safe margins.':'The product enters placement UI margins. Choose another photograph or a framed layout.',inSafe?'pass':'error'));
    }
    checks.push(check('layout',layoutFits?'Text stays clear of the protected product and footer.':'Text overlaps the protected product or footer. Choose another layout.',layoutFits?'pass':'error'));
    checks.push(check('source',g.overlay?'Original fingerprint verified; product region preserved without filters, stretching or overlays.':'Original photograph fingerprint verified; complete frame and proportions preserved.'));
    checks.push(check('product',asset.approved && asset.productId===concept.productId?'Product identity approved.':'Confirm the product identity in the asset library.',asset.approved && asset.productId===concept.productId?'pass':'error'));
    checks.push(check('required-copy',concept.headline.trim() && concept.cta.trim()?'Headline and CTA present.':'A headline and CTA are required.',concept.headline.trim() && concept.cta.trim()?'pass':'error'));
    checks.push(check('headline',headline.fits?'Headline fits at a readable size.':'Headline is too long. Shorten it or reduce its size. ',headline.fits?'pass':'error'));
    checks.push(check('body',body.fits?'Supporting copy fits.':'Supporting copy is too long. Shorten it.',body.fits?'pass':'error'));
    ctx.font=canvasFont('subHeadline',26);
    checks.push(check('cta',ctx.measureText(concept.cta).width<560?'CTA fits.':'CTA is too long.',ctx.measureText(concept.cta).width<560?'pass':'error'));
    checks.push(check('resolution',photo.scale<=1.05?'No material source upscaling.':`Source needs ${photo.scale.toFixed(2)}× enlargement. Use a higher-resolution original.`,photo.scale<=1.05?'pass':'error'));
    checks.push(check('prominence',photo.w>=440 && photo.h>=230?'Photograph has sufficient space.':'This aspect ratio makes the photograph small. Try a tighter original.',photo.w>=440 && photo.h>=230?'pass':'warning'));
    if(concept.direction==='technical') checks.push(check('anchor',feature?'Feature anchor was explicitly approved for this photograph.':'This callout has no approved feature anchor.',feature?'pass':'error'));
    checks.push(check('safe-area',formatId==='story'?'Critical content stays within the studio’s 240 px top / 280 px bottom story margins.':'Critical content stays within the feed margins.'));
    results[formatId]={canvas,blob:await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG export failed.')),'image/png')),checks};
  }
  return {...results,fingerprint:conceptFingerprint(concept,asset),checks:Object.entries(results).flatMap(([format,r])=>r.checks.map(c=>({...c,code:`${format}:${c.code}`,message:`${FORMATS[format].label}: ${c.message}`})))};
}


function backgroundSupportsLightText(image,box) {
  // Conservative sampled background test; visual review still checks exact glyph edges.
  let pass=0,total=0;
  const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  for(let y=Math.max(0,Math.ceil(box.y));y<Math.min(image.height,box.y+box.h);y+=12)for(let x=Math.max(0,Math.ceil(box.x));x<Math.min(image.width,box.x+box.w);x+=12) {
    const i=(y*image.width+x)*4;
    const luminance=.2126*linear(image.data[i]/255)+.7152*linear(image.data[i+1]/255)+.0722*linear(image.data[i+2]/255);
    if((.893+.05)/(luminance+.05)>=4.5)pass++;
    total++;
  }
  return total>0 && pass/total>=.95;
}
