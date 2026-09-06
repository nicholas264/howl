import { getGoogleConnection, getUserGoogleAccessToken } from './google-user-oauth.js';
import { getGoogleAccessToken } from './gcp-auth.js';

export const STUDIO_DRIVE_SCOPE='https://www.googleapis.com/auth/drive.readonly';
export async function studioDriveToken(access,dependencies={}) {
  const connection=await (dependencies.connection || getGoogleConnection)(access.sql,access.userId);
  if(connection?.scopes?.some(scope=>[STUDIO_DRIVE_SCOPE,'https://www.googleapis.com/auth/drive'].includes(scope))) {
    // A failed personal refresh must not switch identities to the shared account.
    return (dependencies.personal || getUserGoogleAccessToken)(access.sql,access.userId);
  }
  try {return await (dependencies.shared || getGoogleAccessToken)([STUDIO_DRIVE_SCOPE]);}
  catch {throw new Error('The shared Drive connection is unavailable. Use Connect my Drive in Static Studio to authorize read-only access to your existing asset folders.');}
}
