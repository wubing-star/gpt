const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Same run ID and same payload are reused on retries: claims, pulses and
// heartbeats are idempotent. Never retry authentication or validation failures.
export async function cloudRequest(url,options={}, {fetcher=fetch,wait=pause,attempts=4,timeoutMs=30000}={}) {
 for(let attempt=0;attempt<attempts;attempt++){
  try{
   const response=await fetcher(url,{...options,signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok){const error=new Error(`Cloud request HTTP ${response.status}`);error.status=response.status;throw error;}
   return await response.json();
  }catch(error){
   const permanent=error.status>=400&&error.status<500&&![408,429].includes(error.status);
   if(permanent||attempt===attempts-1)throw error;
   await wait(1500*(attempt+1));
  }
 }
}
