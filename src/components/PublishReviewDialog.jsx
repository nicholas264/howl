import React,{useEffect,useRef,useState} from 'react';
import {apiFetch} from '../lib/apiFetch.js';
import {preparePublishReview} from '../lib/publish-review.js';
import {launchApprovalRecords} from '../lib/launch-review.js';

export default function PublishReviewDialog({request,onCancel,onConfirm,error}) {
  const [state,setState]=useState({rows:[],loading:true,error:''});const dialog=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    const timer=setTimeout(()=>controller.abort(),240000);
    const previous=document.activeElement;dialog.current?.focus();
    const key=event=>{if(event.key==='Escape')onCancel();if(event.key==='Tab'){
      const controls=[...dialog.current.querySelectorAll('button:not(:disabled),summary,video')],first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }};
    window.addEventListener('keydown',key);
    (async()=>{const rows=[];try{
      for(const item of request.items){rows.push(await preparePublishReview(item,request.config,request.adsetId,{fetchImpl:apiFetch,signal:controller.signal,creativeTest:request.creativeTest}));if(active)setState({rows:[...rows],loading:rows.length<request.items.length,error:''});}
    }catch(failure){if(active)setState(current=>({...current,loading:false,error:controller.signal.aborted?'Review timed out. Cancel and retry with fewer items.':failure.message}));}
    finally{clearTimeout(timer);}})();
    return()=>{active=false;controller.abort();clearTimeout(timer);window.removeEventListener('keydown',key);previous?.focus();};
  },[request]);
  return <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,.6)',display:'grid',placeItems:'center',padding:20}}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="publish-review-title" style={{background:'#fff',padding:24,maxWidth:820,width:'100%',maxHeight:'90vh',overflow:'auto'}}>
      <h2 id="publish-review-title">Review {request.items.length} paused ad(s)</h2>
      {request.creativeTest&&<p>Campaign: {request.creativeTest.testName}<br/>
        Daily budget: ${Number(request.creativeTest.dailyBudgetDollars).toFixed(2)} per creative · ${(Number(request.creativeTest.dailyBudgetDollars)*request.items.length).toFixed(2)} total per day<br/>
        Cost cap: ${(Number(request.creativeTest.costCapCents)/100).toFixed(2)} · Purchase optimization · United States, ages 18–65<br/>
        The campaign and ads will be created paused.</p>}
      {state.loading&&<p role="status">Checking media and approvals ({state.rows.length}/{request.items.length})…</p>}
      {(state.error||error)&&<p role="alert">{state.error||error}</p>}
      {state.rows.map(({item,plan,approvals})=><section key={item.id} style={{borderTop:'1px solid #ddd',padding:'14px 0',overflowWrap:'anywhere'}}>
        <h3>{plan.ad_name}</h3><p>{plan.fields.primary_text}</p>
        <p>Headline: {plan.fields.headline}<br/>Destination: {plan.fields.dest_url}<br/>Tracking: {plan.fields.url_tags}<br/>Page: {plan.fields.page_id}</p>
        {plan.cards?plan.cards.map((card,index)=><div key={index}><strong>Card {index+1}: {card.headline}</strong><p>{card.body}<br/>{card.dest_url} · {card.call_to_action}</p><img crossOrigin="anonymous" src={item.cards[index].imageBase64 || item.cards[index].squareUrl} alt={`Card ${index+1}`} style={{maxWidth:160,maxHeight:160}}/></div>):item.type==='video'?<video controls crossOrigin="anonymous" src={item.videoUrl} style={{maxWidth:320,maxHeight:240}}/>:<img crossOrigin="anonymous" src={item.squareUrl || item.url} alt={item.name || 'Ad preview'} style={{maxWidth:240,maxHeight:240}}/>}
        {launchApprovalRecords(approvals).map(approval=><p key={approval.id}>Deliverable #{approval.deliverable_id} · Approval #{approval.id} · Agreement #{approval.accepted_agreement?.id}</p>)}
        <details><summary>Targeting and budget</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(plan.target.mode==='creative_test'?{campaign:plan.target.campaign,adset:plan.target.request}:plan.target.snapshot,null,2)}</pre></details>
        <details><summary>Media fingerprints and approval evidence</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify({media:plan.media,approvals},null,2)}</pre></details>
      </section>)}
      <div style={{display:'flex',gap:12,justifyContent:'flex-end'}}><button type="button" onClick={onCancel}>Keep editing</button><button type="button" disabled={state.loading||!!state.error||!!error||!state.rows.length} onClick={()=>onConfirm(state.rows)}>Create paused ads</button></div>
    </div>
  </div>;
}
