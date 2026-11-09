// 경제신문 경제면 헤드라인 수집 → data/news/YYYY-MM-DD.json
// Node 20+, 외부 패키지 없음. GitHub Actions에서 매일 실행.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const gn = (site, extra = "경제") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${site} ${extra} when:1d`)}&hl=ko&gl=KR&ceid=KR:ko`;

// 각 신문사: 공식 RSS를 먼저 시도하고, 실패하면 구글뉴스(해당 사이트 한정) RSS로 대체
const SOURCES = [
  { id: "joongang", pattern: /\/article\/\d{6,}/, name: "중앙일보", home: "https://www.joongang.co.kr/money",
    feeds: ["https://rss.joins.com/joins_money_list.xml", gn("joongang.co.kr")] },
  { id: "mk", pattern: /\/news\/[a-z]+\/\d{6,}/, name: "매일경제", home: "https://www.mk.co.kr/news/economy/",
    feeds: ["https://www.mk.co.kr/rss/30100041/", gn("mk.co.kr")] },
  { id: "chosun", pattern: /\/economy\/[a-z\-]+\/20\d\d\/\d\d\/\d\d\/[A-Z0-9]+/, name: "조선일보", home: "https://www.chosun.com/economy/",
    feeds: ["https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml", gn("chosun.com")] },
  { id: "donga", pattern: /\/news\/[A-Za-z]+\/article\/all\/\d{8}\/\d+/, name: "동아일보", home: "https://www.donga.com/news/Economy",
    feeds: ["https://rss.donga.com/economy.xml", gn("donga.com")] },
  { id: "hankyung", pattern: /\/article\/\d{8,}[a-z]?/, name: "한국경제", home: "https://www.hankyung.com/economy",
    feeds: ["https://www.hankyung.com/feed/economy", gn("hankyung.com")] },
  { id: "sedaily", pattern: /\/(article\/\d+|NewsView\/[A-Za-z0-9]+)/, name: "서울경제", home: "https://www.sedaily.com/",
    feeds: [gn("sedaily.com")] },
  { id: "yna", pattern: /\/view\/AKR\d+/, name: "연합뉴스", home: "https://www.yna.co.kr/economy/all",
    feeds: ["https://www.yna.co.kr/rss/economy.xml", gn("yna.co.kr")] },
];

const PER_SOURCE = 30;

// 광고·홍보성 기사 거르기
const AD_WORDS = /(공동\s?구매|초특가|특가|최저가|할인\s?행사|\d+%\s?할인|사은품|무료\s?배송|쿠폰|한정\s?수량|구매\s?혜택|런칭\s?기념|출시\s?기념\s?이벤트|\[광고\]|\[AD\]|\[PR\]|\(광고\)|협찬|프로모션|이벤트\s?진행|체험단|선착순|분양\s?(중|개시|홍보)|모델하우스\s?오픈|\d+개월분)/i;
const AD_PATHS = /(startup_story|\/ad\/|\/adv\/|\/pr\/|sponsored|brandnews|\/promotion)/i;
// URL 안 날짜(예: /2025/07/15/, 20261109)로 오래된 기사 거르기
function urlDate(u) {
  const m = u.match(/(20\d\d)[\/\-]?(0[1-9]|1[0-2])[\/\-]?(0[1-9]|[12]\d|3[01])/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
export function isJunk(item, now = Date.now()) {
  if (AD_WORDS.test(item.title) || AD_PATHS.test(item.link)) return true;
  const ud = urlDate(item.link.replace(/^https?:\/\/[^/]+/, ""));
  if (ud && now - ud > 4 * 864e5) return true;          // URL 날짜가 4일 넘게 지난 기사
  if (item.pubDate && now - Date.parse(item.pubDate) > 7 * 864e5) return true;
  return false;
}
const MAX_AGE_H = 36;

const kstDate = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
function clean(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? clean(m[1]) : "";
};

export function parseRss(xml, sourceName) {
  const items = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[0];
    let title = tag(b, "title");
    let link = tag(b, "link");
    if (!link) { const h = b.match(/<link[^>]*href="([^"]+)"/i); if (h) link = h[1]; }
    const pub = tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "updated") || tag(b, "published");
    // 구글뉴스 제목 끝의 " - 언론사" 제거
    if (sourceName) title = title.replace(new RegExp(`\\s+-\\s+[^-]*${sourceName.slice(0, 2)}[^-]*$`), "");
    if (!title || !link) continue;
    const t = Date.parse(pub);
    items.push({ title, link, pubDate: Number.isNaN(t) ? null : new Date(t).toISOString() });
  }
  return items;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept-language": "ko-KR,ko;q=0.9", accept: "application/rss+xml, application/xml, text/xml, */*" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
    const ct = res.headers.get("content-type") || "";
    const enc = (head.match(/encoding=["']([\w-]+)["']/i) || ct.match(/charset=([\w-]+)/i) || [, "utf-8"])[1].toLowerCase();
    return new TextDecoder(enc).decode(buf);
  } finally { clearTimeout(timer); }
}

async function collect(src) {
  const errors = [];
  for (const url of src.feeds) {
    try {
      const xml = await fetchText(url);
      let items = parseRss(xml, src.name);
      const now = Date.now();
      items = items.filter(i => !isJunk(i, now));
      // 36시간 안 기사 먼저, 모자라면 7일 안 기사로 채움 (그보다 오래된 건 isJunk에서 제외)
      const fresh = items.filter(i => !i.pubDate || now - Date.parse(i.pubDate) < MAX_AGE_H * 3600e3);
      items = fresh.concat(items.filter(i => !fresh.includes(i)));
      // 중복 제목 제거
      const seen = new Set();
      items = items.filter(i => (seen.has(i.title) ? false : seen.add(i.title)));
      if (!items.length) throw new Error("기사 0건");
      return { id: src.id, name: src.name, home: src.home, via: url.includes("news.google.com") ? "google" : "rss", items: items.slice(0, PER_SOURCE) };
    } catch (e) { errors.push(`${url.slice(0, 60)}… ${e.message}`); }
  }
  return { id: src.id, name: src.name, home: src.home, items: [], error: errors.join(" | ") };
}

// 경제면(또는 메인) 페이지 HTML에서 맨 위에 걸린 기사 = 문서 순서상 처음 나오는 기사 링크
export function extractTops(html, base, pattern, n = 3) {
  const out = [], seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < n) {
    let href = m[1];
    if (!pattern.test(href)) continue;
    try { href = new URL(href, base).href; } catch { continue; }
    const key = href.split("?")[0];
    const title = clean(m[2]);
    if (title.length < 12 || /^(사진|영상|포토|\[?사진\]?)$/.test(title)) { continue; }
    if (seen.has(key)) continue;
    const it = { title, link: href, pubDate: null };
    if (isJunk(it)) continue;
    seen.add(key); out.push(it);
  }
  return out;
}
async function collectTops(src) {
  try {
    const html = await fetchText(src.home);
    const tops = extractTops(html, src.home, src.pattern, 3);
    if (process.env.DEBUG_TOPS) console.log(`[top] ${src.name}: ${tops.map(t => t.title.slice(0, 40)).join(" / ") || "(없음)"}`);
    return tops;
  } catch (e) { if (process.env.DEBUG_TOPS) console.log(`[top] ${src.name}: 실패 ${e.message}`); return []; }
}

async function main() {
  const date = kstDate();
  const sources = await Promise.all(SOURCES.map(collect));
  const tops = await Promise.all(SOURCES.map(collectTops));
  sources.forEach((s, i) => { s.tops = tops[i]; s.topsFrom = tops[i].length ? "page" : "rss"; });
  sources.forEach(s => console.log(`${s.name}: ${s.items.length}건 ${s.via || ""} · 메인 ${s.tops.length}건 ${s.error || ""}`));
  await mkdir("data/news", { recursive: true });
  const out = { date, generatedAt: new Date().toISOString(), sources };
  await writeFile(`data/news/${date}.json`, JSON.stringify(out, null, 1));
  let index = [];
  try { index = JSON.parse(await readFile("data/news/index.json", "utf8")).dates || []; } catch {}
  index = [...new Set([date, ...index])].sort().reverse().slice(0, 120);
  await writeFile("data/news/index.json", JSON.stringify({ dates: index, updatedAt: out.generatedAt }));
  if (sources.every(s => !s.items.length)) { console.error("모든 신문사 수집 실패"); process.exit(1); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
