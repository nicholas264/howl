const MB=1024*1024;
const videos=['video/mp4','video/quicktime','video/webm','video/x-matroska','video/mpeg'];
const images=['image/jpeg','image/png','image/webp'];

export function uploadPolicy(pathname) {
  if(typeof pathname!=='string' || pathname.length>1000 || /[\\\x00-\x1f]/.test(pathname)
    || pathname.split('/').some(part=>!part || part==='.' || part==='..'))throw new Error('Invalid upload destination');
  let permission,allowedContentTypes,maximumSizeInBytes;
  if(pathname.startsWith('ugc-source/')){permission='assets.write';allowedContentTypes=videos;maximumSizeInBytes=2048*MB;}
  else if(/^creator-footage\/\d+\//.test(pathname)){permission='creators.write';allowedContentTypes=videos;maximumSizeInBytes=2048*MB;}
  else if(pathname.startsWith('creator-contracts/')){permission='creators.write';allowedContentTypes=['application/pdf'];maximumSizeInBytes=20*MB;}
  else if(pathname.startsWith('image-library/') || pathname.startsWith('callout-photos/') || pathname.startsWith('static-studio/')){permission='assets.write';allowedContentTypes=images;maximumSizeInBytes=20*MB;}
  else if(pathname.startsWith('drafts/')){permission='assets.write';allowedContentTypes=[...images,...videos,'audio/mpeg'];maximumSizeInBytes=2048*MB;}
  else throw new Error('Unsupported upload destination');
  return {permission,allowedContentTypes,maximumSizeInBytes};
}
