export function verifySeedDraft(seed,draft,store,{completed=false}={}) {
  const fail=message=>{throw Object.assign(new Error(message),{statusCode:409,definitelyNotApplied:true});};
  if(seed.shop_domain!==store)fail('The saved seed belongs to a different Shopify store.');
  if(!draft || draft.id!==seed.shopify_draft_order_id)fail('Shopify did not return the saved seed draft.');
  if(completed) {
    if(draft.status!=='COMPLETED' || !/^gid:\/\/shopify\/Order\/\d+$/.test(draft.order?.id || ''))fail('Shopify has not verified a completed order for this draft.');
  } else if(!['OPEN','INVOICE_SENT'].includes(draft.status) || draft.order?.id)fail('The draft is already completed or unavailable. Reconcile its order before retrying.');
  const amount=draft.totalPriceSet?.shopMoney?.amount;
  if(typeof amount!=='string' || !/^0+(?:\.0+)?$/.test(amount))fail('The seed draft no longer has a verified zero total. Review it in Shopify.');
  const items=draft.lineItems?.nodes;
  if(draft.lineItems?.pageInfo?.hasNextPage!==false || !Array.isArray(items) || items.length!==1
    || items[0].variant?.id!==seed.shopify_variant_id || Number(items[0].quantity)!==Number(seed.quantity))
    fail('The seed draft product or quantity changed. Review it in Shopify.');
}

export async function recoverSeedCompletion(sql,{seed,operationKey,actorId},readDraft) {
  const [step]=await sql`SELECT * FROM app_operation_steps WHERE operation_key=${operationKey} AND step_key='CompleteCreatorSeed'`;
  if(!step || !['pending','uncertain'].includes(step.status))return;
  const updated=Date.parse(step.updated_at),started=Date.parse(step.created_at);
  if(!Number.isFinite(updated) || !Number.isFinite(started) || Date.now()-updated<600000)return;
  if(step.request_payload?.variables?.id!==seed.shopify_draft_order_id)throw new Error('The completion attempt does not match the saved draft.');
  const {data,store}=await readDraft();
  const draft=data?.draftOrder;
  verifySeedDraft(seed,draft,store,{completed:true});
  const completedAt=Date.parse(draft.completedAt);
  if(!Number.isFinite(completedAt) || completedAt<started-120000 || completedAt>Date.now()+120000)throw new Error('The Shopify completion time does not match this attempt.');
  const result={data:{draftOrderComplete:{draftOrder:draft,userErrors:[]}},store};
  const [saved]=await sql`WITH recovered AS (
    UPDATE app_operation_steps SET status='completed',result=${JSON.stringify(result)}::jsonb,updated_at=now()
    WHERE operation_key=${operationKey} AND step_key='CompleteCreatorSeed' AND status=${step.status} AND updated_at=${step.updated_at}
    RETURNING operation_key
  ), audit AS (
    INSERT INTO app_admin_audit(actor_id,action,target,metadata)
    SELECT ${actorId},'operation.reconciled',operation_key,
      ${JSON.stringify({provider:'shopify',draftId:draft.id,orderId:draft.order.id,verification:'Saved store, draft, variant, quantity, zero total and completion time'})}::jsonb FROM recovered
    RETURNING id
  ) SELECT id FROM audit`;
  if(!saved)throw new Error('The completion attempt changed during recovery. Reload and retry.');
}
