// 중요도 점수 매기기: 같은 이슈 묶기(여러 신문이 다뤘는지) + 메인 배치 + 단독 + 주제 가중치 − 홍보성
// 외부 패키지 없음. fetch-news.mjs가 불러 씀.

const STOP = new Set(["기자", "단독", "속보", "종합", "사진", "영상", "오늘", "내일", "올해", "내년", "지난해", "이번", "관련", "위해", "대한", "통해", "따른", "있는", "없는", "한다", "했다", "된다", "까지", "부터", "에서", "으로"]);
// 제목 → 비교용 글자쌍(bigram) 집합. 괄호 말머리·따옴표·특수문자 제거
export function grams(title) {
  const t = title.replace(/^\s*([\[【(][^\]】)]{1,12}[\]】)]\s*)+/, "").replace(/[“”"‘’'…·,.!?~\-–—:;()\[\]{}<>《》〈〉「」『』|/]/g, " ");
  const words = t.split(/\s+/).filter(w => w.length >= 2 && !STOP.has(w));
  const g = new Set();
  for (const w of words) {
    const s = w.replace(/(은|는|이|가|을|를|의|에|도|로|와|과|만)$/, "");
    if (s.length < 2) continue;
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2).toLowerCase());
  }
  return g;
}
export function sim(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const x of a) if (b.has(x)) n++;
  return { overlap: n / Math.min(a.size, b.size), jac: n / (a.size + b.size - n), n };
}
// 같은 이슈 판단: 공통 글자쌍이 충분하고(4개 이상) 겹침 비율이 높을 때
function same(a, b) {
  const s = sim(a, b);
  return s.n >= 4 && (s.jac >= 0.34 || (s.overlap >= 0.55 && s.n >= 6));
}

const MACRO = /(기준금리|금리|환율|원·달러|원달러|달러|물가|CPI|PPI|인플레|GDP|성장률|경기|고용|실업|수출|무역수지|경상수지|한은|한국은행|연준|Fed|FOMC|국채|국고채|재정|추경|세수|가계부채)/i;
const MARKET = /(코스피|코스닥|증시|나스닥|S&P|다우|주가|외국인|기관|개미|순매수|순매도|공매도|부동산|집값|아파트값|전세|월세|청약|주택|대출 규제|DSR|LTV|세법|세제|세금|상속세|양도세|종부세|정책|대책|규제|금융위|금감원|기재부|재경부|공정위|관세|통상)/i;
const INDUSTRY = /(반도체|HBM|메모리|파운드리|AI|인공지능|데이터센터|배터리|2차전지|전기차|자동차|조선|철강|석유화학|원전|바이오|실적|영업이익|매출|인수|합병|M&A|구조조정|상장|IPO)/i;
const PR = /(출시|선보여|선보인|선봬|론칭|런칭|오픈|개장|문 연|협약|MOU|업무협약|맞손|손잡|체결|선정|수상|기념|캠페인|개최|행사|박람회|페어|간담회|세미나|포럼|설명회|모집|이벤트|프로모션|할인|신제품|신상품|브랜드)/;

export function rank(sources, opts = {}) {
  const now = opts.now ?? Date.now();
  // 1) 모든 기사 모으기 (같은 링크는 하나로, 메인 여부 합치기)
  const byLink = new Map();
  sources.forEach(s => {
    const add = (it, top) => {
      const k = it.link;
      const tk = s.name + "|" + it.title.replace(/\s+/g, "");
      const cur = byLink.get(k) || byLink.get(tk);
      if (cur) { cur.top ||= top; return; }
      const a = { ...it, src: s.name, sid: s.id, top, g: grams(it.title) };
      byLink.set(k, a); byLink.set(tk, a);
    };
    (s.tops || []).forEach(it => add(it, true));
    (s.items || []).forEach(it => add(it, false));
  });
  const arts = [...new Set(byLink.values())];
  // 2) 묶기 (union-find)
  const par = arts.map((_, i) => i);
  const find = i => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < arts.length; i++)
    for (let j = i + 1; j < arts.length; j++)
      if (same(arts[i].g, arts[j].g)) par[find(i)] = find(j);
  const groups = new Map();
  arts.forEach((a, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(a); });

  // 3) 이슈별 점수
  const clusters = [...groups.values()].map(list => {
    const papers = [...new Set(list.map(a => a.src))];
    const tops = new Set(list.filter(a => a.top).map(a => a.src));
    const titles = list.map(a => a.title).join(" ");
    const excl = list.some(a => /\[\s*단독\s*\]/.test(a.title));
    // 대표 기사: 메인 > 속보 아님 > 제목 길이 적당
    const rep = [...list].sort((a, b) =>
      (b.top - a.top) || (/속보/.test(a.title) - /속보/.test(b.title)) || (Math.abs(a.title.length - 34) - Math.abs(b.title.length - 34)))[0];
    let score = 0;
    const why = [];
    if (papers.length >= 2) { score += Math.min(papers.length - 1, 5) * 3; why.push(`${papers.length}개 신문`); }
    if (tops.size) { score += 2 + Math.min(tops.size - 1, 3) * 1.5; why.push(`메인 ${tops.size}`); }
    if (excl) { score += 2.5; why.push("단독"); }
    if (MACRO.test(titles)) { score += 2.5; why.push("거시"); }
    else if (MARKET.test(titles)) { score += 1.5; why.push("시장·정책"); }
    else if (INDUSTRY.test(titles)) { score += 0.8; why.push("산업"); }
    if (PR.test(rep.title) && papers.length < 3) { score -= 3; why.push("홍보성"); }
    if (/^\s*[\[【(]\s*(인터뷰|칼럼|사설|기고|시론|오피니언|데스크|기자수첩|기자의 눈|광화문|만물상|분수대)/.test(rep.title)) { score -= 1.5; why.push("의견"); }
    const newest = Math.max(...list.map(a => Date.parse(a.pubDate) || 0));
    if (newest && now - newest > 24 * 36e5) score -= 1.5;      // 하루 넘은 이슈는 조금 내림
    return {
      title: rep.title, link: rep.link, src: rep.src, pubDate: rep.pubDate || null,
      papers, n: papers.length, top: tops.size > 0, excl, score: Math.round(score * 10) / 10, why,
      more: list.filter(a => a !== rep).map(a => ({ src: a.src, title: a.title, link: a.link })).slice(0, 8),
      _list: list, _size: list.length,
    };
  });
  clusters.sort((a, b) => b.score - a.score || b.n - a.n);
  const core = clusters.filter(c => c.score >= 2.5).slice(0, opts.limit ?? 10).map(({ _list, ...c }) => c);

  // 4) 신문사별 목록에서 같은 이슈 중복(속보+본기사 등) 줄이기: 한 신문 안에서 같은 묶음이면 대표 하나만
  const keep = new Set();
  const meta = new Map();
  clusters.forEach(c => {
    const bySrc = new Map();
    c._list.forEach(a => { if (!bySrc.has(a.src)) bySrc.set(a.src, []); bySrc.get(a.src).push(a); });
    bySrc.forEach(arr => {
      arr.sort((a, b) => (b.top - a.top) || (/속보/.test(a.title) - /속보/.test(b.title)) || (b.title.length - a.title.length));
      keep.add(arr[0].link);
    });
    c._list.forEach(a => meta.set(a.link, { n: c.n, score: c.score }));
  });
  let removed = 0;
  sources.forEach(s => {
    const before = s.items.length;
    s.items = s.items.filter(it => keep.has(it.link) || (s.tops || []).some(t => t.link === it.link));
    removed += before - s.items.length;
    [...s.items, ...(s.tops || [])].forEach(it => { const m = meta.get(it.link); if (m) { it.n = m.n; it.score = m.score; } });
  });
  return { core, removed, clusters: clusters.length };
}
