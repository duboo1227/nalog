import { parseRss } from "./fetch-news.mjs";
const C = {
  chosun: ["https://www.chosun.com/arc/outboundfeeds/rss/category/opinion/?outputType=xml"],
  joongang: ["https://rss.joins.com/joins_opinion_list.xml", "https://www.joongang.co.kr/opinion", "https://www.joongang.co.kr/opinion/editorial"],
  donga: ["https://rss.donga.com/editorials.xml", "https://rss.donga.com/column.xml", "https://rss.donga.com/opinion.xml"],
  hani: ["https://www.hani.co.kr/rss/opinion/", "https://www.hani.co.kr/rss/editorial/", "https://www.hani.co.kr/arti/opinion/editorial"],
  khan: ["https://www.khan.co.kr/rss/rssdata/opinion_news.xml", "https://www.khan.co.kr/rss/rssdata/editorial.xml", "https://www.khan.co.kr/opinion/editorial/articles"],
  hankook: ["https://www.hankookilbo.com/rss/opinion", "https://www.hankookilbo.com/News/Opinion", "https://www.hankookilbo.com/News/Opinion/HC01"],
  mk: ["https://www.mk.co.kr/rss/30200030/"],
  hankyung: ["https://www.hankyung.com/feed/opinion"],
  sedaily: ["https://www.sedaily.com/v/NewsMain/GH"],
};
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", "accept-language": "ko-KR" };
for (const [k, urls] of Object.entries(C)) for (const u of urls) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
    const buf = new Uint8Array(await r.arrayBuffer());
    const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
    const enc = (head.match(/encoding=["']([\w-]+)["']/i) || (r.headers.get("content-type")||"").match(/charset=([\w-]+)/i) || [, "utf-8"])[1];
    const t = new TextDecoder(enc).decode(buf);
    const items = parseRss(t);
    const links = [...t.matchAll(/href=["']([^"'#]+)["']/g)].map(m => m[1]).filter(h => /article|arti\/|\/\d{6,}|AKR|HC\d|A20\d/.test(h));
    console.log(`\n### ${k} ${u} → ${r.status} rss:${items.length} links:${links.length}`);
    items.slice(0, 6).forEach(i => console.log("  R", i.pubDate, i.title.slice(0, 50), i.link));
    if (!items.length) [...new Set(links)].slice(0, 8).forEach(l => console.log("  L", l));
  } catch (e) { console.log(`\n### ${k} ${u} → ERR ${e.message}`); }
}
