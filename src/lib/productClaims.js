import { PRODUCTS } from '../data/products.js';

// One catalog, shared by the saved-copy review and Launcher. Existing copy is
// retained for editing, but conflicting suggestions cannot become launch-ready.
export function productClaimConflicts(productId,text='') {
  const product=PRODUCTS.find(p=>p.id===productId),expected=Number.parseFloat(product?.specs?.weight);
  if(!product || !Number.isFinite(expected))return [];
  const conflicts=[];
  for(const match of String(text).matchAll(/(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/gi)) {
    const after=text.slice(match.index+match[0].length,match.index+match[0].length+20);
    if(/^\s*(?:propane\s+)?tank\b|^\s*(?:lighter|heavier)\b/i.test(after))continue;
    if(Number(match[1])!==expected)conflicts.push(`Weight claim conflicts with the product catalog: ${product.name} is listed as ${product.specs.weight}.`);
  }
  return [...new Set(conflicts)];
}
