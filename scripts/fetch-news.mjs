// 경제신문 경제면 헤드라인 수집 → data/news/YYYY-MM-DD.json
// Node 20+, 외부 패키지 없음. GitHub Actions에서 매일 실행.
import { writeFile, readFile, mkdir } from "node:fs/promises";

const gn = (site) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`site:${site} (경제 OR 증시 OR 금리 OR 환율 OR 부동산 OR 기업 OR 투자 OR 반도체) when:1d`)}&hl=ko&gl=KR&ceid=KR:ko`;

// 각 신문사: 공식 RSS를 먼저 시도하고, 실패하면 구글뉴스(해당 사이트 한정) RSS로 대체
const SOURCES = [
  { id: "joongang", pattern: /\/article\/\d{6,}/, name: "중앙일보", home: "https://www.joongang.co.kr/money",
    feeds: ["https://rss.joins.com/joins_money_list.xml", "page:https://www.joongang.co.kr/money", gn("joongang.co.kr")] },
  { id: "mk", pattern: /\/news\/[a-z]+\/\d{6,}/, name: "매일경제", home: "https://www.mk.co.kr/news/economy/",
    feeds: ["https://www.mk.co.kr/rss/30100041/", gn("mk.co.kr")] },
  { id: "chosun", pattern: /\/economy\/[a-z\-]+\/20\d\d\/\d\d\/\d\d\/[A-Z0-9]+/, name: "조선일보", home: "https://www.chosun.com/economy/",
    feeds: ["https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml", gn("chosun.com")] },
  { id: "donga", pattern: /\/news\/[A-Za-z]+\/article\/all\/\d{8}\/\d+/, name: "동아일보", home: "https://www.donga.com/news/Economy",
    feeds: ["https://rss.donga.com/economy.xml", gn("donga.com")] },
  { id: "hankyung", pattern: /\/article\/\d{8,}[a-z]?/, name: "한국경제", home: "https://www.hankyung.com/economy",
    feeds: ["https://www.hankyung.com/feed/economy", "page:https://www.hankyung.com/economy", gn("hankyung.com")] },
  { id: "sedaily", pattern: /\/(article\/\d+|NewsView\/[A-Za-z0-9]+)/, name: "서울경제", home: "https://www.sedaily.com/",
    feeds: ["page:https://www.sedaily.com/", gn("sedaily.com")] },
  { id: "yna", pattern: /\/view\/AKR\d+/, name: "연합뉴스", home: "https://www.yna.co.kr/economy/all",
    feeds: ["https://www.yna.co.kr/rss/economy.xml", gn("yna.co.kr")] },
];

const PER_SOURCE = 30;

// 경제 관련성: 구글뉴스 경유 기사·메인 기사는 경제 키워드가 있어야 통과, 모든 기사에서 사건·정치·연예·스포츠는 제외
export const ECON = /(경제|증시|코스피|코스닥|나스닥|다우|S&P|주가|주식|증권|상장|공모|IPO|시총|시가총액|금리|기준금리|환율|달러|원화|엔화|위안|물가|인플레|CPI|PPI|GDP|성장률|경기|침체|불황|금융|은행|대출|예금|적금|저축|이자|보험|카드사|카드|핀테크|투자|펀드|ETF|채권|국채|부동산|아파트값|아파트 가격|아파트 매매|아파트 거래|집값|주택|전세|월세|분양|청약|재건축|재개발|재초환|임대|세금|세제|세율|종부세|양도세|상속세|과세|국세청|예산|재정|국가채무|수출|수입|무역|관세|통상|공급망|반도체|메모리|HBM|파운드리|배터리|2차전지|전기차|자동차|완성차|조선|철강|석유|유가|원유|에너지|전력|원전|기업|대기업|중소기업|스타트업|벤처|실적|매출|영업이익|순이익|적자|흑자|주주|배당|자사주|인수|합병|M&A|지분|매각|고용|일자리|취업|실업|임금|연봉|성과급|최저임금|노조|파업|연금|국민연금|퇴직연금|가계|부채|빚투|신용|가상자산|비트코인|코인|가격|요금|인상|인하|할증|원가|소비|유통|이커머스|쿠팡|수익률|사금융|대부|이자율|공정위|금감원|금융위|한은|한국은행|연준|Fed|기재부|재경부|재정경제부|기획예산처|산업부|국토부|산업|업계|시장|매출액|억원|조원|억 달러|삼성|SK|하이닉스|현대|LG|롯데|한화|포스코|네이버|카카오|엔비디아|애플|테슬라|TSMC|구글|마이크로소프트|아마존|오픈AI|앤트로픽|AI 투자|데이터센터|CEO|회장|생산|소득|자산|창업|프랜차이즈|면세|관광객|항공|해운|물류|농산물|식품|K뷰티|K푸드|라면|화장품|삼전|삼전닉스|종목|근로자|노동|제품|장사|공장|기념품|관광|상품|판매|팔렸|매수|매도|저가매수|펀더멘털|수급|생애최초|입찰|건설|소상공인|채용|기술도입|빅파마|제약|바이오|식량|쌀값|회계|돈벼락|프라이스|차이나 워치|마켓)/i;
export const NONECON = /(살해|살인|숨진|숨져|사망|시신|경찰|검찰|체포|구속|기소|재판|선고|징역|법무장관|청문회|후보자|국회의원|여당|야당|대통령실|인적 물갈이|불륜|열애|결혼식|이혼|배우|가수|아이돌|드라마|예능|연예|날씨|폭우|폭설|태풍|지진|교통사고|운세|암치료|구충제|건강법|다이어트|맛집|여행지|스포츠|야구|축구|골프 대회|올림픽|축제|입주민|찐팬|팬덤|콘서트|헌화|추모|기념식|조문|빈소|부고|별세|참배|봉사|나눔|일손 돕기|기부|성금|후원금|장학금|시상식|수상|위촉식|\[인사\]|\[부고\]|\[동정\])/;

// 광고·홍보성 기사 거르기
const AD_WORDS = /(공동\s?구매|초특가|특가|최저가|할인\s?행사|\d+%\s?할인|사은품|무료\s?배송|쿠폰|한정\s?수량|구매\s?혜택|런칭\s?기념|출시\s?기념\s?이벤트|\[광고\]|\[AD\]|\[PR\]|\(광고\)|협찬|프로모션|이벤트\s?진행|체험단|선착순|분양\s?(중|개시|홍보)|모델하우스\s?오픈|\d+개월분)/i;
const AD_PATHS = /(startup_story|\/ad\/|\/adv\/|\/pr\/|sponsored|brandnews|\/promotion)/i;
// URL 안 날짜(예: /2025/07/15/, 20261109)로 오래된 기사 거르기
function urlDate(u) {
  const m = u.match(/(20\d\d)[\/\-]?(0[1-9]|1[0-2])[\/\-]?(0[1-9]|[12]\d|3[01])/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
// 제목만 봐도 아는 유료 연재물 (구글뉴스 경유처럼 기사 페이지를 확인할 수 없을 때 대비)
const PAID_TITLE = /(Global Money Club|머니랩|더중앙플러스|더중플|The JoongAng Plus|한경\s?프리미엄|프리미엄9|매경\s?\+|매경플러스|조선\s?멤버십|\[멤버십\])/i;
// 기사가 아닌 것들: 표·사진·영상·게시판·인사·부고, 속보의 1보/2보(중복), 지역 소식·단신, 과학·건강 코너
const NOT_ARTICLE = /^\s*[\[【]\s*(표|영상|포토|사진|그래픽|인포그래픽|게시판|인사|부고|동정|알림|운세|오늘의 운세|날씨|신간|새책|\d보|[^\]】]*소식|[^\]】]*단신|사이언스샷|HIF[^\]】]*|Biz & Now)\s*[\]】]/i;
export function isJunk(item, now = Date.now()) {
  if (NOT_ARTICLE.test(item.title)) return true;
  if (AD_WORDS.test(item.title) || AD_PATHS.test(item.link) || PAID_TITLE.test(item.title)) return true;
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
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|span|em|strong|b)>\s*<(p|div|span|em|strong|b)\b/gi, "</$1> <$2")
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
      let items;
      if (url.startsWith("page:")) {
        // RSS가 없는 신문: 경제면 페이지의 기사 링크를 직접 모음 (구글 경유보다 정확하고 원문 주소라 유료 여부 확인 가능)
        const pageUrl = url.slice(5);
        items = extractTops(await fetchText(pageUrl), pageUrl, src.pattern, 60);
        if (items.length < 10) throw new Error(`페이지에서 ${items.length}건뿐`);
      } else items = parseRss(await fetchText(url), src.name);
      const now = Date.now();
      const strict = url.includes("news.google.com");
      items = items.filter(i => !isJunk(i, now) && !NONECON.test(i.title) && (!strict || ECON.test(i.title)));
      // 36시간 안 기사 먼저, 모자라면 7일 안 기사로 채움 (그보다 오래된 건 isJunk에서 제외)
      const fresh = items.filter(i => !i.pubDate || now - Date.parse(i.pubDate) < MAX_AGE_H * 3600e3);
      items = fresh.concat(items.filter(i => !fresh.includes(i)));
      // 중복 제목 제거
      const seen = new Set();
      items = items.filter(i => (seen.has(i.title) ? false : seen.add(i.title)));
      if (!items.length) throw new Error("기사 0건");
      return { id: src.id, name: src.name, home: src.home, via: url.includes("news.google.com") ? "google" : url.startsWith("page:") ? "page" : "rss", items: items.slice(0, PER_SOURCE) };
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
    // 링크 안에 제목+요약문이 같이 들어 있으면 제목 부분만 사용
    const inner = m[2];
    const tm = inner.match(/<(h\d|strong|p|span|div|em|b)\b[^>]*class=["'][^"']*(?:tit|headline|ttl|title|subject)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i) || inner.match(/<(h\d|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/i);
    let title = clean(tm ? tm[2] : inner).replace(/^단독\s*/, "[단독] ");
    if (title.length > 90) title = title.slice(0, 80).replace(/\s+\S*$/, "") + "…";
    if (title.length < 12 || /^(사진|영상|포토|\[?사진\]?)$/.test(title)) { continue; }
    const tkey = title.replace(/\[[^\]]*\]?$/, "").replace(/[\s"“”'‘’…·]/g, "").slice(0, 16);
    if (seen.has(key) || seen.has(tkey)) continue;
    const it = { title, link: href, pubDate: null };
    if (isJunk(it) || NONECON.test(title) || !ECON.test(title)) continue;
    seen.add(key); seen.add(tkey); out.push(it);
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

// 유료(구독자 전용) 기사 거르기: 기사 페이지를 열어 신문사별 유료 표시 확인. 결과는 캐시해서 4시간마다 다시 열지 않음
export function isPaid(html, link) {
  if (/"isAccessibleForFree"\s*:\s*("?false"?)/i.test(html)) return true;             // 중앙(더중앙플러스) 등 표준 표시
  const mk = html.match(/is_paid_content\s*:\s*['"]([^'"]*)['"]/);                         // 매일경제(매경플러스)
  if (mk && mk[1] && !/^(n|no|false|0)$/i.test(mk[1])) return true;
  if (/chosun\.com/.test(link) && /조선멤버십/.test(html)) return true;                    // 조선일보(조선멤버십)
  return false;
}
// 기사 페이지에서 발행 시각 찾기 (메타 태그 → JSON-LD 순서). 시간대가 없으면 한국 시간으로 봄
export function extractPub(html) {
  // 정확한 것부터 차례로: 시간까지 있는 값만 인정 (날짜만 있으면 다음 후보로)
  const names = ["article:published_time", "og:article:published_time", "dd:published_time", "article:published", "og:regDate", "pubdate", "publish-date"];
  const cands = [];
  names.forEach(n => {
    const esc = n.replace(/[:.]/g, m => "\\" + m);
    const m1 = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']+)["']`, "i"));
    const m2 = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${esc}["']`, "i"));
    if (m1) cands.push(m1[1]); if (m2) cands.push(m2[1]);
    if (n === "article:published_time") { const j = html.match(/"datePublished"\s*:\s*"([^"]+)"/i); if (j) cands.push(j[1]); }
  });
  const j2 = html.match(/"dateCreated"\s*:\s*"([^"]+)"/i); if (j2) cands.push(j2[1]);
  for (let v of cands) {
    v = v.trim();
    if (/^\d{14}$/.test(v)) v = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}:${v.slice(12, 14)}`;
    v = v.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3").replace(" ", "T");
    if (!/T\d{2}:\d{2}/.test(v)) continue;                         // 날짜만 있는 값은 건너뜀
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(v)) v += "+09:00";
    const t = Date.parse(v);
    if (!Number.isNaN(t) && t > Date.parse("2020-01-01")) return new Date(t).toISOString();
  }
  return null;
}
async function filterPaid(sources) {
  const CACHE = "data/news/paywall-cache.json";
  let cache = {}; try { cache = JSON.parse(await readFile(CACHE, "utf8")); } catch {}
  const now = Date.now();
  for (const k of Object.keys(cache)) {
    if (now - cache[k].t > 7 * 864e5) delete cache[k];
    else if (cache[k].pub && /T00:00:00\.000Z$/.test(cache[k].pub)) delete cache[k].pub;   // 예전 '날짜만' 값은 다시 확인
  }
  const all = [];
  sources.forEach(s => [...(s.tops || []), ...s.items].forEach(i => { if (!i.link.includes("news.google.com") && (!(i.link in cache) || !("pub" in cache[i.link]))) all.push(i.link); }));
  const todo = [...new Set(all)];
  let idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const link = todo[idx++];
      try { const html = await fetchText(link); cache[link] = { paid: isPaid(html, link), pub: extractPub(html), t: now }; } catch { /* 열리지 않으면 판단 보류 */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  let removed = 0;
  sources.forEach(s => {
    const keep = i => !(cache[i.link] && cache[i.link].paid);
    const b = s.items.length + (s.tops || []).length;
    s.items = s.items.filter(keep); s.tops = (s.tops || []).filter(keep);
    [...s.items, ...s.tops].forEach(i => { if (!i.pubDate && cache[i.link] && cache[i.link].pub) i.pubDate = cache[i.link].pub; });
    const r = b - s.items.length - s.tops.length; removed += r;
    if (r) console.log(`유료 제외 ${s.name}: ${r}건`);
  });
  await writeFile(CACHE, JSON.stringify(cache));
  console.log(`유료 기사 확인: 새로 ${todo.length}건 열어봄, ${removed}건 제외`);
}

async function main() {
  const date = kstDate();
  const sources = await Promise.all(SOURCES.map(collect));
  const tops = await Promise.all(SOURCES.map(collectTops));
  sources.forEach((s, i) => { s.tops = tops[i]; s.topsFrom = tops[i].length ? "page" : "rss"; });
  await filterPaid(sources);
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
