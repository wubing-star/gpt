export function parseStoreUrl(value) {
 const u=new URL(value); const m=u.pathname.match(/^\/us\/store\/[^/]+\/(\d+)\/?$/);
 if(u.protocol!=='https:'||u.hostname!=='shop.tiktok.com'||!m)throw new Error('请输入美区 TikTok Shop 店铺链接，例如 /us/store/店铺名/店铺ID');
 u.search='';u.hash='';return {id:m[1],url:u.href,name:decodeURIComponent(u.pathname.split('/')[3])};
}
export function category(title) {
 const t=title.toLowerCase();
 if(/car |automob|vehicle|windshield|steering|headliner|backup camera/.test(t))return '汽车用品';
 if(/pet |dog|pupp|cat /.test(t))return '宠物用品';
 if(/foot |callus|eyebrow|hair |scalp|makeup|retainer/.test(t))return '美妆个护';
 if(/drill|lock box|weather|seal strip|tape|repair patch/.test(t))return '五金工具';
 if(/kitchen|food|vegetable|peeler|wine|apple|steamer|cooking|moon[c]?ake|foil|soap dispenser/.test(t))return '厨房用品';
 if(/clean|cloth|duster|toilet|shoe/.test(t))return '家居清洁';
 if(/storage|organizer|hanger|pouch|bag|hook/.test(t))return '收纳用品';
 return '其他';
}
export function findData(root) {
 const components=[];let shop=null;
 function walk(v){if(!v||typeof v!=='object')return;
  if(v.shopInfo?.seller_id&&(!shop||Object.keys(v.shopInfo).length>Object.keys(shop).length))shop=v.shopInfo;
  if(v.component_data?.products)components.push(v);
  for(const child of Object.values(v))if(child&&typeof child==='object')walk(child);
 }
 walk(root);const component=components.find(c=>c.component_data.products.length)||components[0];
 if(!shop||!component)throw new Error('页面没有返回店铺商品数据；可能需要登录、受地区限制或页面结构已改变。');
 return {shop,component};
}
export function parseStoreHtml(html){
 const m=html.match(/<script\b[^>]*\bid=["']__MODERN_ROUTER_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
 if(!m)throw new Error('未读取到商品数据。当前请求可能被限制；不会把空结果当成零销量。');
 return findData(JSON.parse(m[1]));
}
export function normalizeProduct(p,shopId,at){
 const sold=p.sold_info?.sold_count;
 if(!/^\d+$/.test(String(sold))||!Number.isSafeInteger(Number(sold))||!p.product_id||!p.title)return null;
 return {id:String(p.product_id),shopId,title:p.title,sold:Number(sold),image:p.image?.url_list?.[0]||'',url:p.seo_url?.canonical_url||`https://shop.tiktok.com/us/pdp/${p.product_id}`,category:category(p.title),price:p.product_price_info?.sale_price_decimal||'',at};
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function sourceError(message,retryable=false,retryAfter=0){return Object.assign(new Error(message),{retryable,retryAfter});}
export async function collectStore(shop, fetcher=fetch, options={}){
 const wait=options.wait||pause,now=options.now||Date.now;
 const pageDelay=options.pageDelayMs??400,retryDelays=options.retryDelaysMs??[1500,4000,8000];
 const maxDuration=options.maxDurationMs??240000,maxPages=options.maxPages??200;
 const headers={'User-Agent':'Mozilla/5.0','Accept-Language':'en-US,en;q=0.9'};
 const response=await fetcher(shop.url,{headers,signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!response.ok)throw new Error(`TikTok 返回 HTTP ${response.status}`);
 const {shop:info,component}=parseStoreHtml(await response.text());
 if(String(info.seller_id)!==shop.id)throw new Error('返回的店铺 ID 与监控店铺不一致');
 const collected=new Map(),seen=new Set();let page=component.component_data,pages=0,warning=null,consumed=0,retries=0;
 const started=now();
 while(true){
  const at=now(),products=page.products||[];
  for(const p of products){if(p.product_id)seen.add(String(p.product_id));const item=normalizeProduct(p,shop.id,at);if(item)collected.set(item.id,item);}
  consumed+=products.length;pages++;
  if(!page.has_more)break;
  if(pages>=maxPages||now()-started>=maxDuration){warning='本轮分页达到运行上限，覆盖不完整';break;}
  const {component_data,...componentInfo}=component;
  // Pagination advances over every returned item, including those without an
  // exact sold count. Missing counts must not shift offsets or repeat items.
  const suppliedOffset=Number(page.load_more_params?.offset);
  const offset=Number.isSafeInteger(suppliedOffset)&&suppliedOffset>=consumed?suppliedOffset:consumed;
  const params={...page.load_more_params,offset,seller_id:shop.id,exclude_product_ids:[...seen]};
  const body=JSON.stringify({component_info:JSON.stringify(componentInfo),load_more_params:JSON.stringify(params)});
  let nextPage=null;
  for(let attempt=0;attempt<=retryDelays.length;attempt++){
   try{
    const delay=attempt?retryDelays[attempt-1]:pageDelay;
    if(now()-started+delay>=maxDuration)throw sourceError('本轮分页达到运行上限，覆盖不完整');
    if(delay)await wait(delay);
    const next=await fetcher('https://shop.tiktok.com/api/shop/brandy_desktop/store/product_list',{method:'POST',headers:{...headers,'Content-Type':'application/json','Referer':shop.url},body,signal:AbortSignal.timeout(20000)});
    if(!next.ok){const retryable=[408,429].includes(next.status)||next.status>=500;const seconds=Number(next.headers?.get?.('retry-after'));throw sourceError(`分页 HTTP ${next.status}`,retryable,Number.isFinite(seconds)?Math.min(30000,Math.max(0,seconds*1000)):0);}
    let result;try{result=await next.json();}catch(e){if(e.name==='SyntaxError')throw sourceError('分页未返回可读取的商品数据，已停止本轮分页');throw e;}
    const message=String(result.message||result.msg||'');
    if(result.code!==0||!Array.isArray(result.data?.products)){
     const denial=/captcha|verify.*human|automated|access denied|forbidden|login|登录/i.test(message);
     throw sourceError(`分页未返回商品（代码 ${result.code??'未知'}）`,result.code===100000&&!denial);
    }
    const ids=result.data.products.map(p=>String(p.product_id||''));
    // An empty final page is valid; repeated nonempty pages are not completion.
    if(!ids.some(id=>id&&!seen.has(id))&&(ids.length||result.data.has_more))throw sourceError('分页没有新增商品，已停止重复请求',true);
    nextPage=result.data;break;
   }catch(e){
    const transient=e.retryable===true||['TimeoutError','AbortError','TypeError'].includes(e.name);
    if(!transient||attempt===retryDelays.length||now()-started>=maxDuration){warning=`${String(e.message||e)}${attempt?`；重试${attempt}次仍未补全`:''}`;break;}
    retries++;
    if(e.retryAfter&&now()-started+e.retryAfter<maxDuration)await wait(e.retryAfter);
   }
  }
  if(!nextPage)break;
  page=nextPage;
 }
 const reported=Number(info.on_sell_product_count)||0,missingCounts=seen.size-collected.size;
 if(!collected.size)throw new Error(`当前运行环境没有返回有效商品计数（列表 ${seen.size} 个）。保留上一份快照。`);
 if(!warning&&missingCounts>0)warning=`销量计数缺失：列表已读完，共返回${seen.size}件，${missingCounts}件未提供精确销量；仅保存${collected.size}件有效计数，不按零销量处理。`;
 if(!warning&&reported!==seen.size&&reported>0)warning=`平台数量差异：分页已读完，当前列表返回${seen.size}件，店铺标示${reported}件；店铺标示与实际列表不一致，保留本轮真实结果。`;
 return {shop:{id:shop.id,name:info.shop_name,url:shop.url,reported},products:[...collected.values()],pages,retries,seen:seen.size,missingCounts,paginationComplete:!page.has_more,complete:!warning&&!page.has_more,warning};
}
