import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import CreativePerformanceWorkspace from '../src/components/CreativePerformanceWorkspace.jsx';
import CreativeFlowBoard from '../src/components/CreativeFlowBoard.jsx';
import {apiJson} from '../src/lib/api.js';
import '../src/styles.css';
function Preview(){
 const [data,setData]=useState(null),[days,setDays]=useState(14),[error,setError]=useState(''),[tab,setTab]=useState('creative-analytics');
 const load=async()=>{try{setData(await apiJson('/api/meta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get_creative_table',sinceDays:days})}));}catch(e){setError(e.message)}};
 useEffect(()=>{load()},[days]);
 const assign=async(groupKey,creatorId,source={})=>{const result=await apiJson('/api/meta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assign_creative_creator',groupKey,creatorId,...source})});await load();return result};
 return <><div style={{padding:'9px 24px',background:'#edf3ef',color:'#466251',fontSize:12}}>Local review • Synthetic test data • Changes stay in an isolated database</div><div className="dashboard-workspace dashboard-motion-workspace" style={{padding:'26px 32px',maxWidth:1500,margin:'auto',background:'white'}}>{tab==='creative-flow'?<><button className="ca-secondary" onClick={()=>setTab('creative-analytics')}>Back to analytics</button><CreativeFlowBoard setActiveTab={setTab} canManage={false}/></>:<CreativePerformanceWorkspace creativeTable={data} loading={!data} error={error} windowDays={days} setWindowDays={setDays} onAssignCreator={assign} canManageCreators={true} setActiveTab={setTab} onOpenAnalysis={()=>setError('Analysis providers are disabled in this local review.')} />}</div></>
}
createRoot(document.getElementById('root')).render(<Preview/>);
