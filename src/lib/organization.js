export const canAccessOrganization = access => access?.role === 'owner';
export const today = () => new Date().toISOString().slice(0,10);
export function tenure(start, end='', asOf=today()) {
  if(!start)return 'Start date not recorded';
  const finish=end&&end<asOf?end:asOf;
  if(start>finish)return `Starts ${start}`;
  const a=new Date(`${start}T00:00:00Z`),b=new Date(`${finish}T00:00:00Z`);
  let months=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();
  if(b.getUTCDate()<a.getUTCDate())months--;
  if(months<1)return 'Less than a month';
  const years=Math.floor(months/12),rest=months%12;
  return [years?`${years} year${years===1?'':'s'}`:'',rest?`${rest} month${rest===1?'':'s'}`:''].filter(Boolean).join(', ');
}
export function descendants(people,id) {
  const found=new Set();const queue=[id];
  while(queue.length){const parent=queue.pop();for(const p of people)if(p.managerId===parent&&!found.has(p.id)&&p.id!==id){found.add(p.id);queue.push(p.id);}}
  return found;
}
export function visibleHierarchy(people, query='', department='', tag='') {
  const active=people.filter(p=>!p.archived),byId=new Map(active.map(p=>[p.id,p])),matches=new Set(),visible=new Set();
  for(const p of active)if((!department||p.department===department)&&(!tag||p.tags?.includes(tag))&&`${p.name} ${p.title} ${p.department} ${p.responsibilities} ${(p.tags||[]).join(' ')}`.toLowerCase().includes(query.toLowerCase()))matches.add(p.id);
  for(const id of matches){let p=byId.get(id);const seen=new Set();while(p&&!seen.has(p.id)){seen.add(p.id);visible.add(p.id);p=byId.get(p.managerId);}}
  return {people:active.filter(p=>visible.has(p.id)),matches};
}
