export const CRM_STAGES = [
  {id:'new',label:'New lead'}, {id:'contacted',label:'Contacted'},
  {id:'qualified',label:'Qualified'}, {id:'proposal',label:'Proposal'},
  {id:'won',label:'Won'}, {id:'lost',label:'Lost'},
];
export const isOpen = opportunity => !opportunity.archived && !['won','lost'].includes(opportunity.data.stage);
export const localDay = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value || 0);
export function followUpState(opportunity,today=localDay()) {
  if(!isOpen(opportunity))return '';
  if(!opportunity.data.nextAction || !opportunity.data.followUp)return 'Needs next action';
  if(opportunity.data.followUp<today)return 'Overdue';
  if(opportunity.data.followUp===today)return 'Due today';
  return 'Scheduled';
}
export function crmCsv(rows) {
  const cell=value=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,s=>"'"+s).replaceAll('"','""')+'"';
  return '\uFEFF'+[['Opportunity','Company','Stage','Value (USD)','Owner','Next action','Follow-up','Expected close','Contacts','Notes','Archived'],...rows.map(o=>[o.data.title,o.data.company,CRM_STAGES.find(s=>s.id===o.data.stage)?.label,o.data.value,o.data.owner,o.data.nextAction,o.data.followUp,o.data.closeDate,o.data.contacts.map(c=>`${c.name} <${c.email}> ${c.phone}`).join('; '),o.data.notes,o.archived?'Yes':'No'])].map(r=>r.map(cell).join(',')).join('\r\n');
}
export const emptyOpportunity = () => ({title:'',company:'',stage:'new',value:0,owner:'Roy',nextAction:'',followUp:'',closeDate:'',contacts:[{name:'',email:'',phone:''}],notes:''});
