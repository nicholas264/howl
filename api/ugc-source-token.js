import {videoReadUrl,videoSource} from './_lib/private-video.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { requirePermission } from './_lib/app-access.js';


export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
  maxDuration: 15,
};

const TOKEN_TTL_SECONDS = 10 * 60;

function secret() {
  const configured=process.env.UGC_SOURCE_TOKEN_SECRET;
  if(configured)return configured;
  if(process.env.NODE_ENV!=='production' && process.env.AUTH_DISABLED==='true')return 'local-ugc-source-secret';
  throw new Error('Playback signing is not configured');
}

const sourceHash=value=>createHash('sha256').update(value).digest('base64url');

export function signUgcSourceToken(sessionId,sourceUrl,ttlSeconds=TOKEN_TTL_SECONDS) {
  if(!Number.isSafeInteger(Number(sessionId)) || Number(sessionId)<=0 || typeof sourceUrl!=='string' || !sourceUrl
    || !Number.isInteger(ttlSeconds) || ttlSeconds<1 || ttlSeconds>TOKEN_TTL_SECONDS)throw new Error('Invalid playback grant');
  const now=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({v:2,sid:Number(sessionId),src:sourceHash(sourceUrl),iat:now,exp:now+ttlSeconds})).toString('base64url');
  return `${payload}.${createHmac('sha256',secret()).update(payload).digest('base64url')}`;
}

// The first check can reject forged grants before a database query. The route must
// also supply the stored source URL before serving bytes, binding the grant to it.
export function verifyUgcSourceToken(token,expectedSessionId,sourceUrl) {
  if(typeof token!=='string' || token.length>2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return false;
  try {
    const [payload,sig]=token.split('.');
    const expected=createHmac('sha256',secret()).update(payload).digest('base64url');
    if(sig.length!==expected.length || !timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return false;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    const now=Math.floor(Date.now()/1000);
    return data.v===2 && Number.isSafeInteger(data.sid) && data.sid>0 && data.sid===Number(expectedSessionId)
      && Number.isInteger(data.iat) && Number.isInteger(data.exp) && data.iat<=now+30
      && data.exp>now && data.exp>data.iat && data.exp-data.iat<=TOKEN_TTL_SECONDS
      && typeof data.src==='string' && /^[A-Za-z0-9_-]{43}$/.test(data.src)
      && (sourceUrl===undefined || (typeof sourceUrl==='string' && data.src===sourceHash(sourceUrl)));
  }catch{return false;}
}

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'assets.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).end();

  const sessionId = Number(req.query?.id);
  if (!Number.isSafeInteger(sessionId) || sessionId<=0) return res.status(400).json({ error: 'id required' });

  const { sql } = access;

  const [session] = await sql`
    SELECT id, video_url
    FROM ugc_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;
  if (!session?.video_url) return res.status(404).json({ error: 'Session source not found' });
  let token,playbackUrl;
  try{
    token=signUgcSourceToken(sessionId,session.video_url);
    if(videoSource(session.video_url).private)playbackUrl=await videoReadUrl(sql,session.video_url);
  }
  catch{return res.status(503).json({error:'Playback signing is unavailable'});}
  res.setHeader('Cache-Control','private, no-store');

  return res.json({
    token,
    ...(playbackUrl?{playback_url:playbackUrl}:{}),
    source_url:session.video_url,
    expires_in: TOKEN_TTL_SECONDS,
  });
}
