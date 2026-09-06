import React, { useEffect, useState } from 'react';
import { apiJson } from '../lib/api.js';
import CreativeExperiments from './CreativeExperiments.jsx';

export default function CreativeVariantReport({canWrite=false}) {
  const [data,setData] = useState(null);
  const [error,setError] = useState('');
  const [days,setDays] = useState(30);
  useEffect(() => {
    let active = true;
    setData(null); setError('');
    apiJson(`/api/creative-variants?days=${days}`).then(value => {if(active) setData(value);})
      .catch(err => {if(active) setError(err.message);});
    return () => {active=false;};
  },[days]);
  return <section style={{padding:20,borderBottom:'1px solid #dedbd5'}}>
    <h2>Creative variants</h2>
    <p>Compare complete creative definitions separately from the media rollups below. Reusing an image does not merge different hooks, copy, carousel cards, or destinations.</p>
    <label>Reporting window <select value={days} onChange={event => setDays(Number(event.target.value))}>
      <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
    </select></label>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading variants…</p>}
    {data && <><p style={{fontSize:12}}>{data.basis}</p>
      <div style={{overflowX:'auto',maxHeight:420}}><table style={{width:'100%',textAlign:'left',fontSize:12}}>
        <thead><tr><th>Variant / ads</th><th>Shared media</th><th>Spend</th><th>Purchases</th><th>ROAS</th><th>Evidence</th></tr></thead>
        <tbody>{data.variants.map(row => <tr key={row.variant_key}>
          <td style={{padding:8}}><details><summary>{row.name || row.creative_id || row.variant_key}</summary>
            <p>Creative: {row.creative_id || 'Unavailable'} · Ads: {row.ad_ids.join(', ')}</p>
            <pre style={{maxWidth:600,whiteSpace:'pre-wrap'}}>{row.definition ? JSON.stringify(row.definition,null,2) : 'Definition predates detailed ingestion. Resync to capture it.'}</pre>
          </details></td>
          <td>{row.media_keys.filter(Boolean).join(', ')}</td>
          <td>${row.spend.toFixed(2)}</td><td>{row.purchases}</td>
          <td>{row.spend ? (row.purchase_value/row.spend).toFixed(2)+'×' : '—'}</td>
          <td>{row.observed_days < 7 || row.purchases < 20 ? 'Limited observations' : 'Descriptive performance'}; causal result unproven</td>
        </tr>)}</tbody>
      </table>{!data.variants.length && <p>No ingested variants yet.</p>}</div><CreativeExperiments variants={data.variants} canWrite={canWrite} /></>}
  </section>;
}
