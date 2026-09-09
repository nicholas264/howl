import {requirePermission} from './_lib/app-access.js';
import {readLaunchPacket} from './_lib/launch-packets.js';

export default async function handler(req,res) {
  const access=await requirePermission(req,res,'launch.read');
  if(!access)return;
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const adId=String(req.query?.ad_id || '');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(adId))return res.status(400).json({error:'Valid ad ID required'});
  try {
    const packet=await readLaunchPacket(access.sql,adId);
    return res.json({packet,basis:packet?null:'This launch has no captured snapshot. Historical configuration is not reconstructed.'});
  }catch(error){return res.status(error.statusCode || 500).json({error:error.message});}
}
