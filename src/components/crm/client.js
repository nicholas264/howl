import { apiFetch } from '../../lib/apiFetch.js';
export async function crmRequest(path,body) {
  const response=await apiFetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  let result;try{result=await response.json();}catch{throw new Error('The server response could not be read. Reload to check whether your change saved.');}
  if(!response.ok)throw Object.assign(new Error(result.error||'Request failed.'),{status:response.status});
  return result;
}
