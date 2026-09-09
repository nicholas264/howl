// Executable art direction. Coordinates are pixels in the final export, not HTML
// or provider-generated code. Original photographs are always drawn proportionally.
export const overlaps=(a,b)=>a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
export function normalizeComposition(input) {
  if(input==null)return null;
  const overlay=input.mode==='overlay';
  const result=overlay?{mode:'overlay'}:{};
  for(const format of ['feed','story']) {
    const p=input[format],top=format==='story'?240:66,bottom=format==='story'?1584:1228;
    if(!p)throw new Error(`Composition needs a ${format} layout.`);
    const boxes=overlay?{photo:{x:0,y:0,w:1080,h:format==='story'?1920:1350}}:{};
    for(const key of (overlay?['headline','body','cta']:['photo','headline','body'])) {
      const b=p[key];
      if(!b || !['x','y','w','h'].every(k=>Number.isFinite(b[k])))throw new Error(`${format}: invalid ${key} placement.`);
      const {x,y,w,h}=b;
      if(x<(overlay?64:48) || y<(overlay?top:top+100) || w<80 || h<40 || x+w>(overlay?1016:1032) || y+h>(overlay?(format==='story'?1640:1284):bottom))throw new Error(`${format}: ${key} must stay within the composition area.`);
      boxes[key]={x,y,w,h};
    }
    if(boxes.photo.w<440 || boxes.photo.h<260 || boxes.headline.w<300)throw new Error(`${format}: give the photograph and headline more space.`);
    if((!overlay && (overlaps(boxes.photo,boxes.headline) || overlaps(boxes.photo,boxes.body))) || overlaps(boxes.headline,boxes.body) || (overlay && (overlaps(boxes.cta,boxes.headline) || overlaps(boxes.cta,boxes.body))))throw new Error(`${format}: composition blocks must not overlap.`);
    const headlineSize=Number(p.headlineSize),bodySize=Number(p.bodySize || 34);
    if(headlineSize<52 || headlineSize>140 || !Number.isFinite(headlineSize) || bodySize<30 || bodySize>40)throw new Error(`${format}: type size must be readable.`);
    result[format]={...boxes,headlineSize,bodySize,...(overlay?{textColor:p.textColor==='dark'?'dark':'light'}:{}),align:p.align==='center'?'center':'left'};
  }
  return result;
}
export const COMPOSITION_INSTRUCTIONS=`For framed directions (expedition, field, signal), supply an executable composition for BOTH formats. This is how your visualIdea becomes the actual image: choose different arrangements and scale, not the same template with new words. Each format has photo, headline, body rectangles {x,y,w,h}, headlineSize (52–140), bodySize (30–40), align (left or center). Coordinates are final pixels. Feed is 1080x1350: all rectangles inside x48..1032, y166..1228. Story is 1080x1920: x48..1032, y340..1584. Header and footer are reserved outside these areas. Rectangles MUST NOT overlap. Photo box >=440 wide and >=260 high; headline >=300 wide. The WHOLE original fits proportionally inside photo: respect its aspect ratio to avoid wasted space. Keep headline short, use a headline box tall enough for its lines, and reserve at least 44px for body even when empty. Leave breathing room. You may put headline above, below, beside the photo or compose an asymmetric arrangement when the source supports it. Use a strong photo/copy relationship, purposeful scale and distinct compositions across concepts. No artificial crop, rotation, filter, product redraw or invented imagery. Use composition:null for scene/technical only.`;

export const OVERLAY_INSTRUCTIONS=`Create an image-led static ad: the actual photograph fills every pixel edge to edge. Text is placed directly on the photograph. No padding, inset photograph, borders, header, footer, URL strip or decorative card. Return direction:"scene" and composition:{mode:"overlay",feed:{headline:{x,y,w,h},body:{x,y,w,h},cta:{x,y,w,h},headlineSize,bodySize,align,textColor},story:{same fields}}. Use supplied placementEvidence for each format: protectedBox is the actual product exclusion area AFTER cropping, and textSafeArea bounds all type. Never place text over that box. These are executable pixel coordinates, independently composed for 1080x1350 feed and 1080x1920 story. Text rectangles must not overlap each other or the protected product. Feed text safe bounds: x64..1016,y66..1284. Story: x64..1016,y240..1640. Headline width >=300, all rectangles height >=40. Headline size52..140, bodySize30..40; CTA renders at34. Reserve a body rectangle even for empty body. textColor is light or dark: choose genuinely contrasting open photographic space. No opaque background panels. Preserve original product pixels, proportions, hardware and visible flame. The photo is proportionally enlarged to fill each canvas and centered around the confirmed protected region; only surroundings outside that region may be cropped. Choose a different source when both crops cannot work. Do not substitute a padded layout. Let the image carry the idea; one concise hook is better than explanatory paragraphs.`;
