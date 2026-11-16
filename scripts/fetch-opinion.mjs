// 생각거리: 신문사별 사설·칼럼 수집 → data/opinion/YYYY-MM-DD.json
// 보수 성향(조선·중앙·동아) · 중도(한국일보) · 진보 성향(한겨레·경향)을 함께 모으고,
// 같은 이슈를 서로 다른 성향 신문이 다룬 경우 '같은 이슈, 다른 시각'으로 묶는다.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { parseRss } from "./fetch-news.mjs";
import { grams, sim } from "./rank-news.mjs";

export const OUTLETS = [
  { id: "chosun", name: "조선일보", lean: "보수", home: "https://www.chosun.com/opinion/",
    feeds: [{ url: "https://www.chosun.com/arc/outboundfeeds/rss/category/opinion/?outputType=xml" }] },
  { id: "joongang", name: "중앙일보", lean: "보수", home: "https://www.joongang.co.kr/opinion",
    feeds: [{ url: "page:https://www.joongang.co.kr/opinion/editorial", kind: "사설", pattern: /\/article\/\d{6,}/ },
            { url: "page:https://www.joongang.co.kr/opinion", pattern: /\/article\/\d{6,}/ }] },
  { id: "donga", name: "동아일보", lean: "보수", home: "https://www.donga.com/news/Opinion",
    feeds: [{ url: "https://rss.donga.com/editorials.xml" }] },
  { id: "hankook", name: "한국일보", lean: "중도", home: "https://www.hankookilbo.com/News/Opinion",
    feeds: [{ url: "page:https://www.hankookilbo.com/News/Opinion", pattern: /\/news\/article\/A\d{10,}/ }] },
  { id: "hani", name: "한겨레", lean: "진보", home: "https://www.hani.co.kr/arti/opinion",
    feeds: [{ url: "page:https://www.hani.co.kr/arti/opinion/editorial", kind: "사설", pattern: /\/arti\/opinion\/editorial\/\d+\.html/ },
            { url: "https://www.hani.co.kr/rss/opinion/" }] },
  { id: "khan", name: "경향신문", lean: "진보", home: "https://www.khan.co.kr/opinion",
    feeds: [{ url: "https://www.khan.co.kr/rss/rssdata/opinion_news.xml" }] },
];
const PER_OUTLET = 20;

// 생각거리가 아닌 것: 만평·그림·짧은 촌평·사진·독자 투고 안내·운세 등
const SKIP = /(팔면봉|만평|생각그림|그림판|카툰|\[사진|포토|운세|퀴즈|바둑|오늘의 시|시가 있는|詩|인사\]|부고|알림|독자권익|정정|바로잡습니다|사고\]|社告|오늘의 영어|한자|역사 속 오늘|오늘의 날씨)/;

export function kindOf(title, link, def) {
  if (/^\s*[\[【]\s*사설|\/editorial\//.test(title + " " + link) || /^\s*사설\s*[:|]/.test(title)) return "사설";
  return def || "칼럼";
}
// 제목 정리: 말머리 [사설] 등은 kind로 표시하니 떼고, 뒤에 붙은 [코너명]은 남김
export const tidy = t => t.replace(/^\s*[\[【]\s*사설\s*[\]】]\s*/, "").replace(/\s+/g, " ").trim();

const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept-language": "ko-KR,ko;q=0.9" };
async function fetchText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const head = new TextDecoder("latin1").decode(buf.slice(0, 300));
  const enc = (head.match(/encoding=["']([\w-]+)["']/i) || (r.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [, "utf-8"])[1].toLowerCase();
  return new TextDecoder(enc).decode(buf);
}
const strip = s => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, " ").trim();

// 오피니언 페이지에서 기사 링크+제목 뽑기 (같은 링크가 여러 번 나오면 가장 그럴듯한 제목)
export function extractLinks(html, base, pattern) {
  const by = new Map(), order = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!pattern.test(m[1])) continue;
    let href; try { href = new URL(m[1], base).href.split("?")[0]; } catch { continue; }
    const inner = m[2];
    const tm = inner.match(/<(h\d|strong|p|span|div|em|b)\b[^>]*class=["'][^"']*(?:tit|headline|ttl|title|subject)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i) || inner.match(/<(h\d|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i);
    let title = strip(tm ? tm[2] : inner);
    if (title.length > 90) title = title.slice(0, 80).replace(/\s+\S*$/, "") + "…";
    if (!by.has(href)) { by.set(href, ""); order.push(href); }
    const cur = by.get(href);
    if (title.length >= 8 && (!cur || (cur.length < 8) || (title.length < cur.length && title.length >= 12))) by.set(href, title);
  }
  return order.map(link => ({ title: by.get(link), link, pubDate: null })).filter(i => i.title && i.title.length >= 8);
}

// URL이나 발행시각으로 너무 오래된 글 거르기 (3일)
function tooOld(it, now) {
  const u = it.link.match(/(20\d\d)[\/-]?(\d\d)[\/-]?(\d\d)/);
  if (u) { const t = Date.parse(`${u[1]}-${u[2]}-${u[3]}T00:00:00+09:00`); if (!Number.isNaN(t) && now - t > 3 * 864e5) return true; }
  if (it.pubDate && now - Date.parse(it.pubDate) > 3 * 864e5) return true;
  return false;
}

async function collect(o) {
  const now = Date.now(), all = [], errs = [], seen = new Set();
  for (const f of o.feeds) {
    try {
      const items = f.url.startsWith("page:")
        ? extractLinks(await fetchText(f.url.slice(5)), f.url.slice(5), f.pattern)
        : parseRss(await fetchText(f.url));
      items.forEach(i => {
        const link = i.link.replace(/\?utm_[^#]*$/, "").replace(/\?dtypecode=.*$/, "");
        const key = link.replace(/\/\d+$/, "");
        if (seen.has(key) || SKIP.test(i.title) || tooOld({ ...i, link }, now)) return;
        seen.add(key);
        all.push({ title: tidy(i.title), link, pubDate: i.pubDate, kind: kindOf(i.title, link, f.kind) });
      });
    } catch (e) { errs.push(`${f.url.slice(0, 50)}… ${e.message}`); }
  }
  // 사설 먼저(최신순), 이어서 칼럼
  const ord = a => (a.kind === "사설" ? 0 : 1);
  const items = all.map((a, i) => [a, i]).sort((x, y) => ord(x[0]) - ord(y[0]) || x[1] - y[1]).map(x => x[0]).slice(0, PER_OUTLET);
  return { id: o.id, name: o.name, lean: o.lean, home: o.home, items, ...(errs.length && !items.length ? { error: errs.join(" | ") } : {}) };
}

// 같은 이슈를 다른 성향 신문이 함께 다뤘는지 묶기
export function debates(outlets) {
  const arts = [];
  outlets.forEach(o => o.items.forEach(i => arts.push({ ...i, src: o.name, lean: o.lean, g: grams(i.title.replace(/\[[^\]]*\]/g, " ")) })));
  const par = arts.map((_, i) => i), find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < arts.length; i++) for (let j = i + 1; j < arts.length; j++) {
    if (arts[i].src === arts[j].src) continue;
    const s = sim(arts[i].g, arts[j].g);
    if (s.n >= 3 && (s.jac >= 0.25 || s.overlap >= 0.5)) par[find(i)] = find(j);
  }
  const groups = new Map();
  arts.forEach((a, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(a); });
  return [...groups.values()]
    .filter(g => new Set(g.map(a => a.lean)).size >= 2)
    .map(g => {
      const leans = new Set(g.map(a => a.lean));
      const sides = g.sort((a, b) => ["보수", "중도", "진보"].indexOf(a.lean) - ["보수", "중도", "진보"].indexOf(b.lean))
        .map(({ g: _, ...a }) => a).slice(0, 6);
      return { both: leans.has("보수") && leans.has("진보"), papers: new Set(g.map(a => a.src)).size, sides };
    })
    .sort((a, b) => (b.both - a.both) || (b.papers - a.papers))
    .slice(0, 8);
}

const kstDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

async function main() {
  const date = kstDate();
  const outlets = await Promise.all(OUTLETS.map(collect));
  outlets.forEach(o => console.log(`${o.lean} ${o.name}: 사설 ${o.items.filter(i => i.kind === "사설").length} · 칼럼 ${o.items.filter(i => i.kind !== "사설").length} ${o.error || ""}`));
  const d = debates(outlets);
  d.forEach(x => console.log(`⚖️ ${x.sides.map(s => `${s.src}: ${s.title.slice(0, 30)}`).join(" | ")}`));
  await mkdir("data/opinion", { recursive: true });
  await writeFile(`data/opinion/${date}.json`, JSON.stringify({ date, generatedAt: new Date().toISOString(), debates: d, outlets }, null, 1));
  let index = [];
  try { index = JSON.parse(await readFile("data/opinion/index.json", "utf8")).dates || []; } catch {}
  index = [...new Set([date, ...index])].sort().reverse().slice(0, 120);
  await writeFile("data/opinion/index.json", JSON.stringify({ dates: index, updatedAt: new Date().toISOString() }));
  if (outlets.every(o => !o.items.length)) { console.error("사설·칼럼 수집 전부 실패"); process.exit(1); }
}
if (import.meta.url === `file://${process.argv[1]}`) main();
