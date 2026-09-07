export function verifySeedDraft(seed,draft,store) {
  const fail=message=>{throw Object.assign(new Error(message),{statusCode:409,definitelyNotApplied:true});};
  if(seed.shop_domain!==store)fail('The saved seed belongs to a different Shopify store.');
  if(!draft || draft.id!==seed.shopify_draft_order_id)fail('Shopify did not return the saved seed draft.');
  if(!['OPEN','INVOICE_SENT'].includes(draft.status) || draft.order?.id)fail('The draft is already completed or unavailable. Reconcile its order before retrying.');
  const amount=draft.totalPriceSet?.shopMoney?.amount;
  if(typeof amount!=='string' || !/^0+(?:\.0+)?$/.test(amount))fail('The seed draft no longer has a verified zero total. Review it in Shopify.');
  const items=draft.lineItems?.nodes;
  if(draft.lineItems?.pageInfo?.hasNextPage!==false || !Array.isArray(items) || items.length!==1
    || items[0].variant?.id!==seed.shopify_variant_id || Number(items[0].quantity)!==Number(seed.quantity))
    fail('The seed draft product or quantity changed. Review it in Shopify.');
}
