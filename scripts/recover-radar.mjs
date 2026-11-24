import {setTimeout as wait} from 'node:timers/promises';
import {cloudRequest} from '../lib/radar/cloud-request.mjs';
const site=process.env.RADAR_SITE_URL||'https://tiktok-sales-radar-bingbing.comet-jelly-2682.chatgpt.site';
const repo=process.env.GITHUB_REPOSITORY,runId=process.env.GITHUB_RUN_ID;
if(!repo||!runId||!process.env.GITHUB_TOKEN||!process.env.RADAR_SITE_TOKEN)throw Error('Protected maintenance credentials unavailable');
const siteHeaders={'OAI-Sites-Authorization':`Bearer ${process.env.RADAR_SITE_TOKEN}`,'Content-Type':'application/json'};
const ghHeaders={'Authorization':`Bearer ${process.env.GITHUB_TOKEN}`,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
async function github(path,method='GET',body){
 const response=await fetch(`https://api.github.com/repos/${repo}${path}`,{method,headers:ghHeaders,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 if(!response.ok&&![409,422].includes(response.status))throw Error(`GitHub maintenance HTTP ${response.status}`);
 return response.status===204||response.status===202||response.status===409||response.status===422?{}:response.json();
}
const workflow=await github('/actions/workflows/radar-snapshots.yml');
if(workflow.state!=='active')throw Error('Primary collector workflow must be active');
const previous=await cloudRequest(site+'/api/runner',{headers:siteHeaders});
// Stop only this repository's known radar job. Preserve nextRun and every D1
// observation; the replacement takes the same lease and the same 30m cadence.
if(previous.runId&&/^\d+$/.test(previous.runId)&&previous.runId!==runId){
 const old=await github('/actions/runs/'+previous.runId);
 if(old.workflow_id!==workflow.id)throw Error('Lease does not belong to the known radar workflow');
 if(previous.running)await cloudRequest(site+'/api/runner',{method:'POST',headers:siteHeaders,body:JSON.stringify({runId:previous.runId,nextAt:previous.nextRun||Date.now(),operation:'release',intervalMinutes:30})});
 if(old.status!=='completed'){
  await github('/actions/runs/'+previous.runId+'/cancel','POST');
  for(let i=0;i<40;i++){if((await github('/actions/runs/'+previous.runId)).status==='completed')break;await wait(3000);}
 }
}
await github('/actions/workflows/radar-snapshots.yml/dispatches','POST',{ref:'main'});
let replacement=null;
for(let i=0;i<60;i++){
 const state=await cloudRequest(site+'/api/runner',{headers:siteHeaders});
 if(state.running&&state.runId!==previous.runId){replacement=state;break;}
 await wait(3000);
}
if(!replacement)throw Error('Replacement has not acquired the collector lease; no duplicate collector was started');
console.log(JSON.stringify({phase:'replacement_online',runId:replacement.runId,nextRun:replacement.nextRun,cadencePreserved:replacement.nextRun===previous.nextRun}));
const request=await cloudRequest(site+'/api/collect',{method:'POST',headers:siteHeaders});
let finished=null;
for(let i=0;i<100;i++){
 const state=await cloudRequest(site+'/api/runner',{headers:siteHeaders});
 if(state.lastRun>=request.requestedAt){finished=state;break;}
 await wait(5000);
}
if(!finished)throw Error('Collection has not confirmed completion; verify the live heartbeat before claiming success');
const data=await cloudRequest(site+'/api/radar',{headers:siteHeaders});
console.log(JSON.stringify({phase:'fresh_collection_completed',at:finished.lastRun,nextRun:finished.nextRun,cadencePreserved:finished.nextRun===replacement.nextRun,readyProducts:data.products.filter(p=>p.status==='ready').length,shops:data.shops.map(s=>({id:s.id,name:s.name,covered:s.covered,reported:s.reported,lastSuccess:s.last_success,error:s.error}))}));
