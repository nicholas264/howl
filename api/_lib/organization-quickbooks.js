import { hash, provider } from './finance.js';
import { applyOrganizationCommand } from './organization.js';
const normalized = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

// Keep only roster fields; never return tax IDs, payroll amounts, or bank details.
export async function fetchQuickBooksPeople(connection, env=process.env, fetcher=fetch) {
  const candidates=[];
  for (const entity of ['Employee','Vendor']) {
    for (let start=1; ; start+=1000) {
      if(start>10000) throw new Error('QuickBooks roster is too large to load completely. No people were imported.');
      const query=`SELECT * FROM ${entity} WHERE Active = true STARTPOSITION ${start} MAXRESULTS 1000`;
      const result=await provider(`query?${new URLSearchParams({query})}`,connection.access,connection.realm,env,fetcher);
      if(result.Fault||!result.QueryResponse) throw new Error('QuickBooks returned an incomplete roster. Try again.');
      const rows=result.QueryResponse[entity]??[];
      if(!Array.isArray(rows)) throw new Error('QuickBooks returned an invalid roster.');
      for(const p of rows) {
        if(p.Active===false)continue;
        const name=[p.GivenName,p.MiddleName,p.FamilyName].filter(Boolean).join(' ').trim()||p.DisplayName;
        if(!p.Id||!name)throw new Error('QuickBooks returned a person without an ID or name.');
        candidates.push({key:hash(`${connection.environment}:${connection.realm}:${entity}:${p.Id}`),name,
          email:p.PrimaryEmailAddr?.Address||'',kind:entity==='Employee'?'Employee':p.Vendor1099===true?'Contractor':'Vendor',
          company:p.CompanyName||''});
      }
      if(rows.length<1000)break;
    }
  }
  return candidates;
}
export function matchQuickBooksPerson(people,candidate) {
  const sources=people.filter(p=>p.quickbooksSources?.includes(candidate.key));
  if(sources.length)return {status:sources.length===1?'existing':'ambiguous',person:sources[0]};
  const matches=people.filter(p=>(candidate.email&&normalized(p.email)===normalized(candidate.email))||normalized(p.name)===normalized(candidate.name));
  return {status:matches.length>1?'ambiguous':matches.length?'existing':'new',person:matches[0]};
}
export function importQuickBooksPeople(current,candidates,selections,actor,now=new Date()) {
  if(!Array.isArray(selections)||!selections.length||selections.length>2000)throw new Error('Select between 1 and 2,000 people to import.');
  const keys=new Set(),byKey=new Map(candidates.map(p=>[p.key,p]));
  let state=structuredClone(current||{people:[],history:[]});
  const summary={added:0,existing:0};
  for(const selection of selections) {
    const candidate=byKey.get(selection?.key);
    if(!candidate||keys.has(selection.key))throw new Error('The QuickBooks roster changed or contains duplicate selections. Reload the roster.');
    keys.add(selection.key);
    const match=matchQuickBooksPerson(state.people,candidate);
    if(match.status==='ambiguous')throw new Error(`Multiple profiles match ${candidate.name}. Resolve the duplicates before importing.`);
    if(match.person){summary.existing++;continue;}
    state=applyOrganizationCommand(state,{action:'save',values:{name:candidate.name,email:candidate.email,
      title:selection.title||'Role not recorded',department:selection.department||'',managerId:selection.managerId||'',
      employmentType:candidate.kind==='Employee'?'':'Contractor'}},actor,now);
    const person=state.people.at(-1);
    person.quickbooksSources=[candidate.key];
    state.history.at(-1).after=structuredClone(person);
    summary.added++;
  }
  return {state,summary};
}
