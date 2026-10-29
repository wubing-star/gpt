import {collectStore} from '../lib/radar/source.mjs';
const site=process.env.RADAR_SITE_URL||'https://tiktok-sales-radar-bingbing.comet-jelly-2682.chatgpt.site';
const token=process.env.RADAR_SITE_TOKEN;
if(!token)throw new Error('Configure RADAR_SITE_TOKEN as a protected cloud-runner secret.');
const headers={'OAI-Sites-Authorization':`Bearer ${token}`,'Content-Type':'application/json'};
const response=await fetch(site+'/api/shops',{headers});if(!response.ok)throw new Error(`Shop list HTTP ${response.status}`);
const shops=await response.json();if(!Array.isArray(shops))throw new Error('Invalid shop list');
let cursor=0;const failures=[];
await Promise.all(Array.from({length:Math.min(4,shops.length)},async()=>{
 while(cursor<shops.length){const index=cursor++;const shop=shops[index];try{
  const result=await collectStore(shop);const saved=await fetch(site+'/api/ingest',{method:'POST',headers,body:JSON.stringify({results:[result]}),signal:AbortSignal.timeout(60000)});
  if(!saved.ok)throw new Error(`Snapshot save HTTP ${saved.status}`);
  console.log(JSON.stringify({item:index+1,covered:result.products.length,reported:result.shop.reported,coverageComplete:result.complete}));
 }catch(e){failures.push({item:index+1,shopId:shop.id,errorType:e.name||'Error',error:String(e.message||e).slice(0,250)});console.error(JSON.stringify(failures.at(-1)));}}
}));
if(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_RUN_ID){
 const heartbeat=await fetch(site+'/api/heartbeat',{method:'POST',headers,body:JSON.stringify({runId:process.env.GITHUB_RUN_ID,total:shops.length,failed:failures.length,failures:failures.map(({shopId,error})=>({shopId,error}))}),signal:AbortSignal.timeout(30000)});
 if(!heartbeat.ok)throw new Error(`Heartbeat HTTP ${heartbeat.status}`);
}
if(failures.length)process.exitCode=1;
