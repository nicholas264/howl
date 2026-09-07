// Each completed step is persisted by the caller. Resuming skips current passes.
export async function finishStudioBatch({ids,latest,finish,onProgress,cancelled}) {
  const result={passed:0,held:0,failed:[]};
  for(const [index,id] of ids.entries()) {
    if(cancelled())break;
    const c=await latest(id);
    if(!c)continue;
    if(c.approval || c.review?.verdict==='pass'){result.passed++;continue;}
    onProgress(index+1,ids.length,c);
    try {
      const next=await finish(c);
      next.review?.verdict==='pass'?result.passed++:result.held++;
    } catch(error) {
      result.failed.push({id,message:error.message || 'Could not finish this concept.'});
      // Do not hammer an unavailable provider or keep spending after a limit.
      if(/credit|quota|budget|rate.limit|daily.limit|unauthorized|forbidden|conflict/i.test(error.message))break;
    }
  }
  return result;
}
