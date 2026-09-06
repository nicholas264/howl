export async function boundedResponseBytes(response,maxBytes) {
  if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new Error('Media exceeds the upload size limit');}
  if(!response.body)throw new Error('Media response has no body');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>maxBytes)throw new Error('Media exceeds the upload size limit');chunks.push(value);}
    return Buffer.concat(chunks,size);
  } catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
}
