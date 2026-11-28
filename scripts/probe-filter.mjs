import { parseRss, isJunk, NONECON, ECON, extractTops } from "./fetch-news.mjs";
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", "accept-language": "ko-KR" };
async function ft(u){const r=await fetch(u,{headers:UA,signal:AbortSignal.timeout(15000)});const b=new Uint8Array(await r.arrayBuffer());const h=new TextDecoder("latin1").decode(b.slice(0,300));const e=(h.match(/encoding=["']([\w-]+)["']/i)||(r.headers.get("content-type")||"").match(/charset=([\w-]+)/i)||[,"utf-8"])[1];return new TextDecoder(e).decode(b);}
const F=[["매경","https://www.mk.co.kr/rss/30100041/"],["조선","https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml"],["동아","https://rss.donga.com/economy.xml"],["연합","https://www.yna.co.kr/rss/economy.xml"],["한경RSS","https://www.hankyung.com/feed/economy"],
 ["중앙page","page:https://www.joongang.co.kr/money",/\/article\/\d{6,}/],["한경page","page:https://www.hankyung.com/economy",/\/article\/\d{8,}[a-z]?/],["서경page","page:https://www.sedaily.com/",/\/(article\/\d+|NewsView\/[A-Za-z0-9]+)/],
 ["중앙경제2","page:https://www.joongang.co.kr/money/economy",/\/article\/\d{6,}/],["중앙전체","page:https://www.joongang.co.kr/money/general",/\/article\/\d{6,}/],["서경경제","page:https://www.sedaily.com/v/NewsMain/GE",/\/(article\/\d+|NewsView\/[A-Za-z0-9]+)/],["매경전체","https://www.mk.co.kr/rss/50000001/"],["한경all","https://www.hankyung.com/feed/all-news"]];
const now=Date.now();
for (const [n,u,p] of F){try{const t=await ft(u.replace(/^page:/,""));const it=u.startsWith("page:")?extractTops(t,u.slice(5),p,80):parseRss(t,n);
 const junk=it.filter(i=>isJunk(i,now)),non=it.filter(i=>!isJunk(i,now)&&NONECON.test(i.title));const ok=it.length-junk.length-non.length;
 const d24=it.filter(i=>i.pubDate&&now-Date.parse(i.pubDate)<24*36e5).length;
 const oldest=it.map(i=>i.pubDate).filter(Boolean).sort()[0];
 console.log(`## ${n}: 원본 ${it.length} · 광고/표/오래됨 ${junk.length} · 비경제 ${non.length} · 통과 ${ok} · 24h내 ${d24} · 가장오래된 ${oldest||"-"}`);
 junk.slice(0,6).forEach(i=>console.log("   J",i.title.slice(0,50)));non.slice(0,6).forEach(i=>console.log("   N",i.title.slice(0,50)));
}catch(e){console.log(`## ${n}: ERR ${e.message}`)}}
