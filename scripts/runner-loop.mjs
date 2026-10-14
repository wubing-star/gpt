import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
const site=process.env.RADAR_SITE_URL||'https://tiktok-sales-radar-bingbing.comet-jelly-2682.chatgpt.site';
const runId=process.env.GITHUB_RUN_ID,token=process.env.RADAR_SITE_TOKEN;
const repo=process.env.GITHUB_REPOSITORY;
if(!runId||!token||!repo||!process.env.GITHUB_TOKEN)throw Error('Protected runner credentials unavailable');
const interval=300000;
const duration=Math.max(6,Math.min(55,Number(process.env.RADAR_SESSION_MINUTES)||55))*60000;
const started=Date.now(),deadline=started+duration;
let nextAt=started,lastRequest=started,stopped=false;
const siteHeaders={'OAI-Sites-Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
async function signal(operation){
 const response=await fetch(site+'/api/runner',{method:'POST',headers:siteHeaders,body:JSON.stringify({runId,nextAt,operation}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Runner signal HTTP ${response.status}`);
 return response.json();
}
const claim=await signal('claim');
if(!claim.acquired){console.log('Another collector owns the current lease.');process.exit(0);}
async function pulse(){const state=await signal('pulse');if(!state.acquired)stopped=true;return state;}
let pulsing=false;
const keepAlive=setInterval(async()=>{if(pulsing||stopped)return;pulsing=true;try{await pulse();}catch{console.error('Runner pulse temporarily unavailable.');}finally{pulsing=false;}},15000);
function collect(){return new Promise(resolve=>{const child=spawn(process.execPath,['scripts/collect-cloud.mjs'],{env:process.env,stdio:'inherit'});child.on('error',()=>resolve(1));child.on('exit',code=>resolve(code??1));});}
try{
 while(!stopped&&Date.now()<deadline){
  const state=await pulse().catch(()=>null);
  if(!state){console.error('Retrying temporary runner connection failure.');await wait(15000);continue;}
  if(stopped)break;
  const requested=state.requestAt>lastRequest;
  if(Date.now()>=nextAt||requested){
   lastRequest=Math.max(lastRequest,state.requestAt,Date.now());
   console.log(JSON.stringify({cycleStarted:new Date().toISOString()}));
   const code=await collect();
   console.log(JSON.stringify({cycleFinished:new Date().toISOString(),success:code===0}));
   if(requested)nextAt=Date.now()+interval;
   else do{nextAt+=interval;}while(nextAt<=Date.now());
   await pulse().catch(()=>console.error('Waiting for the next runner pulse.'));
  }
  await wait(Math.min(15000,Math.max(0,deadline-Date.now())));
 }
}finally{clearInterval(keepAlive);while(pulsing)await wait(50);await signal('release').catch(()=>{});}
if(!stopped){
 const apiHeaders={'Authorization':`Bearer ${process.env.GITHUB_TOKEN}`,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
 const workflow=`https://api.github.com/repos/${repo}/actions/workflows/radar-snapshots.yml`;
 const state=await fetch(workflow,{headers:apiHeaders,signal:AbortSignal.timeout(30000)});
 if(!state.ok)throw Error(`Workflow state HTTP ${state.status}`);
 if((await state.json()).state!=='active'){console.log('Workflow disabled; no successor started.');process.exit(0);}
 let handedOff=false;
 for(let attempt=0;attempt<3&&!handedOff;attempt++){
  const result=await fetch(workflow+'/dispatches',{method:'POST',headers:apiHeaders,body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(30000)});
  handedOff=result.ok;
  if(!handedOff){console.error(`Successor dispatch HTTP ${result.status}`);if(attempt<2)await wait(15000);}
 }
 if(!handedOff)throw Error('Successor could not start; scheduled recovery remains enabled.');
 console.log('Successor collector dispatched.');
}
