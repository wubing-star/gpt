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
 if(!/^\d+$/.test(String(sold))||!p.product_id||!p.title)return null;
 return {id:String(p.product_id),shopId,title:p.title,sold:Number(sold),image:p.image?.url_list?.[0]||'',url:p.seo_url?.canonical_url||`https://shop.tiktok.com/us/pdp/${p.product_id}`,category:category(p.title),price:p.product_price_info?.sale_price_decimal||'',at};
}
export async function collectStore(shop, fetcher=fetch){
 const headers={'User-Agent':'Mozilla/5.0','Accept-Language':'en-US,en;q=0.9'};
 const response=await fetcher(shop.url,{headers,signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!response.ok)throw new Error(`TikTok 返回 HTTP ${response.status}`);
 const {shop:info,component}=parseStoreHtml(await response.text());
 if(String(info.seller_id)!==shop.id)throw new Error('返回的店铺 ID 与监控店铺不一致');
 const collected=new Map();let page=component.component_data;let pages=0,warning=null;
 const started=Date.now();
 while(true){
  const at=Date.now();for(const p of page.products||[]){const item=normalizeProduct(p,shop.id,at);if(item)collected.set(item.id,item);}pages++;
  if(!page.has_more)break;
  if(pages>=100||Date.now()-started>180000){warning='本轮分页达到运行上限，覆盖不完整';break;}
  try {
   const {component_data,...componentInfo}=component;
   const params={...page.load_more_params,offset:page.load_more_params?.offset??collected.size,seller_id:shop.id,exclude_product_ids:[...collected.keys()]};
   const next=await fetcher('https://shop.tiktok.com/api/shop/brandy_desktop/store/product_list',{method:'POST',headers:{...headers,'Content-Type':'application/json','Referer':shop.url},body:JSON.stringify({component_info:JSON.stringify(componentInfo),load_more_params:JSON.stringify(params)}),signal:AbortSignal.timeout(20000)});
   if(!next.ok)throw new Error(`分页 HTTP ${next.status}`);
   const result=await next.json();if(result.code!==0||!Array.isArray(result.data?.products))throw new Error(`分页未返回商品（代码 ${result.code??'未知'}）`);
   const ids=result.data.products.map(p=>String(p.product_id));if(!ids.some(id=>!collected.has(id)))throw new Error('分页没有新增商品，已停止重复请求');
   page=result.data;
  }catch(e){warning=String(e.message||e);break;}
 }
 const reported=Number(info.on_sell_product_count)||0;
 if(!collected.size)throw new Error(`当前运行环境没有返回有效商品计数（列表 ${page.products?.length||0} 个）。保留上一份快照，需改用已验证的外部采集器。`);
 if(!warning&&reported>collected.size)warning=`已读完返回的分页，但有效计数商品为 ${collected.size} / 页面标记 ${reported}；商品变动或字段缺失，覆盖差异待确认`;
 return {shop:{id:shop.id,name:info.shop_name,url:shop.url,reported},products:[...collected.values()],pages,complete:!warning&&!page.has_more,warning};
}
