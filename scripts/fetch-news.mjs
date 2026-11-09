// 경제신문 경제면 헤드라인 수집 → data/news/YYYY-MM-DD.json
// Node 20+, 외부 패키지 없음. GitHub Actions에서 매일 실행.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const gn = (site, extra = "경제") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${site} ${extra} when:1d`)}&hl=ko&gl=KR&ceid=KR:ko`;

// 각 신문사: 공식 RSS를 먼저 시도하고, 실패하면 구글뉴스(해당 사이트 한정) RSS로 대체
const SOURCES = [
  { id: "joongang", name: "중앙일보", home: "https://www.joongang.co.kr/money",
    feeds: ["https://rss.joins.com/joins_money_list.xml", gn("joongang.co.kr")] },
  { id: "mk", name: "매일경제", home: "https://www.mk.co.kr/news/economy/",
    feeds: ["https://www.mk.co.kr/rss/30100041/", gn("mk.co.kr")] },
  { id: "chosun", name: "조선일보", home: "https://www.chosun.com/economy/",
    feeds: ["https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml", gn("chosun.com")] },
  { id: "donga", name: "동아일보", home: "https://www.donga.com/news/Economy",
    feeds: ["https://rss.donga.com/economy.xml", gn("donga.com")] },
  { id: "hankyung", name: "한국경제", home: "https://www.hankyung.com/economy",
    feeds: ["https://www.hankyung.com/feed/economy", gn("hankyung.com")] },
  { id: "sedaily", name: "서울경제", home: "https://www.sedaily.com/",
    feeds: [gn("sedaily.com")] },
  { id: "yna", name: "연합뉴스", home: "https://www.yna.co.kr/economy/all",
    feeds: ["https://www.yna.co.kr/rss/economy.xml", gn("yna.co.kr")] },
];

const PER_SOURCE = 30;
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
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (daily-log news bot)", accept: "application/rss+xml, application/xml, text/xml, */*" } });
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
      const fresh = items.filter(i => !i.pubDate || now - Date.parse(i.pubDate) < MAX_AGE_H * 3600e3);
      if (fresh.length >= 15) items = fresh;
      // 중복 제목 제거
      const seen = new Set();
      items = items.filter(i => (seen.has(i.title) ? false : seen.add(i.title)));
      if (!items.length) throw new Error("기사 0건");
      return { id: src.id, name: src.name, home: src.home, via: url.includes("news.google.com") ? "google" : "rss", items: items.slice(0, PER_SOURCE) };
    } catch (e) { errors.push(`${url.slice(0, 60)}… ${e.message}`); }
  }
  return { id: src.id, name: src.name, home: src.home, items: [], error: errors.join(" | ") };
}

async function main() {
  const date = kstDate();
  const sources = await Promise.all(SOURCES.map(collect));
  sources.forEach(s => console.log(`${s.name}: ${s.items.length}건 ${s.via || ""} ${s.error || ""}`));
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
