// 오늘의 경제뉴스 — 친구 공유용. 로그인 없음, 읽은 기사·메모·관심 키워드는 이 브라우저(localStorage)에만 저장
(function () {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kst = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const short = s => { const [, m, d] = s.split("-").map(Number); return `${m}/${d}`; };
const wdName = s => { const [y, m, d] = s.split("-").map(Number); return "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const hhmm = iso => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const pubTxt = iso => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; return `${short(kst(d))} ${hhmm(iso)}`; };
const TODAY = kst(new Date());
const BASE = "https://raw.githubusercontent.com/duboo1227/nalog/main/data/news/";
const PAPERS = [
  ["중앙일보", "https://www.joongang.co.kr/money"], ["매일경제", "https://www.mk.co.kr/news/economy/"],
  ["조선일보", "https://www.chosun.com/economy/"], ["동아일보", "https://www.donga.com/news/Economy"],
  ["한국경제", "https://www.hankyung.com/economy"], ["서울경제", "https://www.sedaily.com/"],
  ["연합뉴스", "https://www.yna.co.kr/economy/all"], ["네이버 경제", "https://news.naver.com/section/101"]
];

/* ---- 브라우저 저장 (없거나 막혀 있어도 화면은 정상 동작) ---- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
};
let reads = store.get("econ.read.v1", {});      // { "2026-11-11": [ {title,url,src,summary,thought} ] }
let kws = store.get("econ.kw.v1", []);
const saveReads = () => store.set("econ.read.v1", reads);
const saveKws = () => store.set("econ.kw.v1", kws);

let cur = TODAY, news = null, paper = "핵심", page = 0;
const openArts = new Set();
const mq = window.matchMedia("(max-width: 640px)");
const perPage = () => mq.matches ? 5 : 10;
mq.addEventListener("change", () => { page = 0; render(); });
const todayReads = () => (reads[cur] = reads[cur] || []);

/* ---- 날짜 목록 ---- */
async function loadDates() {
  let dates = [];
  try { const r = await fetch(BASE + "index.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) dates = (await r.json()).dates || []; } catch (_) {}
  if (!dates.includes(TODAY)) dates.unshift(TODAY);
  $("#dateSel").innerHTML = dates.slice(0, 30).map(d => `<option value="${d}">${short(d)} (${wdName(d)})${d === TODAY ? " · 오늘" : ""}</option>`).join("");
  $("#dateSel").value = cur;
}
$("#dateSel").addEventListener("change", e => { cur = e.target.value; page = 0; paper = "핵심"; openArts.clear(); loadNews(); });

async function loadNews() {
  news = null; render();
  for (const u of [BASE + cur + ".json", "/data/news/" + cur + ".json"]) {
    try { const r = await fetch(u + "?t=" + Date.now(), { cache: "no-store" }); if (r.ok) { news = await r.json(); break; } } catch (_) {}
  }
  if (!news) news = { date: cur, sources: [], missing: true };
  render();
}

/* ---- 화면 ---- */
function render() { renderKw(); renderHeads(); renderReads(); }
function renderKw() {
  if (document.activeElement && document.activeElement.id === "kwInput") return;
  $("#kwRow").innerHTML = `<span class="muted">💡 관심 키워드</span>${kws.map((k, i) => `<span class="kw-tag">${esc(k)}<button type="button" data-kwdel="${i}" aria-label="${esc(k)} 빼기">×</button></span>`).join("")}<input type="text" id="kwInput" placeholder="+ 추가 (예: 반도체)" autocomplete="off">`;
}
$("#kwRow").addEventListener("keydown", e => {
  if (e.target.id !== "kwInput" || e.key !== "Enter" || e.isComposing) return;
  e.preventDefault(); const v = e.target.value.trim(); if (!v) return;
  kws = [...new Set([...kws, v])]; saveKws(); e.target.value = ""; e.target.blur(); render(); $("#kwInput").focus();
});
$("#kwRow").addEventListener("click", e => { const b = e.target.closest("[data-kwdel]"); if (!b) return; kws.splice(Number(b.dataset.kwdel), 1); saveKws(); render(); });

function renderHeads() {
  $("#papers").innerHTML = PAPERS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}<small>경제면</small></a>`).join("");
  if (!news) { $("#heads").innerHTML = `<li class="empty" style="border:0">불러오는 중…</li>`; $("#paperChips").innerHTML = ""; $("#pager").hidden = true; $("#newsStamp").textContent = ""; return; }
  if (news.missing || !news.sources.length) {
    $("#paperChips").innerHTML = ""; $("#pager").hidden = true; $("#newsStamp").textContent = short(cur);
    $("#heads").innerHTML = `<li class="empty" style="border:0">${cur === TODAY ? "오늘 헤드라인은 아직 수집 전이야 (새벽 2시부터 4시간마다 수집)." : "이 날짜의 헤드라인 기록이 없어."}</li>`;
    return;
  }
  $("#newsStamp").textContent = `${short(news.date)} ${hhmm(news.generatedAt)} 수집`;
  const srcs = news.sources.filter(s => s.items.length);
  const kwHit = t => kws.some(k => k && (t || "").toLowerCase().includes(k.toLowerCase()));
  const kwAll = []; { const seen = new Set(); srcs.forEach(s => [...(s.tops || []), ...s.items].forEach(i => { if (kwHit(i.title) && !seen.has(i.link)) { seen.add(i.link); kwAll.push(Object.assign({ src: s.name, main: (s.tops || []).includes(i) }, i)); } })); }
  if (paper === "관심" && !kws.length) paper = "전체";
  const hasCore = !!(news.core && news.core.length);
    if (paper === "핵심" && !hasCore) paper = "전체";
    if (paper !== "핵심" && paper !== "전체" && paper !== "관심" && !srcs.some(s => s.name === paper)) paper = "전체";
  $("#paperChips").innerHTML = (kws.length ? `<button class="chip kwchip" data-paper="관심" aria-pressed="${paper === "관심"}">💡 관심 ${kwAll.length}</button>` : "") +
    (hasCore ? [["핵심", "🔥 오늘의 핵심"]] : []).map(([n, l]) => `<button class="chip corechip" data-paper="${n}" aria-pressed="${n === paper}">${l}</button>`).join("") + ["전체", ...srcs.map(s => s.name)].map(n => `<button class="chip" data-paper="${esc(n)}" aria-pressed="${n === paper}">${esc(n)}</button>`).join("");
  let list;
  if (paper === "핵심") {
      // 여러 신문이 함께 다룬 이슈·메인 배치·단독·주제 점수순. 관심 키워드가 들어가면 +2점
      list = news.core.map(c => Object.assign({ main: c.top, core: true }, c, { score: c.score + (kwHit(c.title) || (c.more || []).some(m => kwHit(m.title)) ? 2 : 0) }))
        .sort((a, b) => b.score - a.score).slice(0, 10);
    }
    else if (paper === "관심") list = kwAll;
  else if (paper === "전체") {
    list = []; const pick = s => (s.tops && s.tops.length ? s.tops : s.items), seen = new Set();
    for (let r = 0; r < 3 && list.length < perPage(); r++) srcs.forEach(s => { const it = pick(s)[r]; if (it && !seen.has(it.link) && list.length < perPage()) { seen.add(it.link); list.push(Object.assign({ src: s.name, main: !!(s.tops && s.tops.length) }, it)); } });
  } else {
    const src = srcs.find(s => s.name === paper);
    const norm = u => (u || "").split("?")[0].replace(/\/+$/, "");
    const key = t => (t || "").replace(/[\s\[\]"“”'‘’…·]/g, "").slice(0, 18);
    const tops = (src.tops || []).map(i => Object.assign({ src: paper, main: true }, i));
    const sl = new Set(tops.map(t => norm(t.link))), st = new Set(tops.map(t => key(t.title)));
    list = tops.concat(src.items.filter(i => !sl.has(norm(i.link)) && !st.has(key(i.title))).map(i => Object.assign({ src: paper }, i)));
  }
  const pp = perPage(), pages = Math.max(1, Math.ceil(list.length / pp));
  if (page >= pages) page = pages - 1;
  const start = page * pp, pl = list.slice(start, start + pp);
  const saved = new Set(todayReads().map(a => a.url));
  const mark = t => { let h = esc(t); kws.forEach(k => { if (!k) return; const re = new RegExp(esc(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); h = h.replace(re, m => `<mark>${m}</mark>`); }); return h; };
  $("#heads").innerHTML = pl.length ? pl.map((it, i) => `<li class="${kwHit(it.title) ? "kw" : ""}"><span class="n">${String(start + i + 1).padStart(2, "0")}</span><div><a href="${esc(it.link)}" target="_blank" rel="noopener">${it.main ? `<span class="star" title="신문 메인 기사">⭐</span> ` : ""}${mark(it.title)}</a><div class="time">${(it.n || 0) > 1 ? `<span class="cov" title="${esc((it.papers || []).join(", ") || "여러 신문")}에서 다룸">📰×${it.n}</span> ` : ""}${it.excl ? `<span class="cov excl">단독</span> ` : ""}${it.main ? "메인 · " : ""}${esc(it.core && it.papers && it.n > 1 ? it.papers.map(x => x.replace(/일보|뉴스/, "").replace("매일경제", "매경").replace("한국경제", "한경").replace("서울경제", "서경")).join("·") : it.src)}${it.pubDate ? ` · <span class="pubt">${pubTxt(it.pubDate)} 발행</span>` : ""}</div></div><button class="add${saved.has(it.link) ? " on" : ""}" data-add="${i}">${saved.has(it.link) ? "✓ 읽음" : "+ 읽음"}</button></li>`).join("")
    : `<li class="empty" style="border:0">${paper === "관심" ? "관심 키워드가 들어간 기사가 없어." : "기사가 없어."}</li>`;
  $("#heads")._list = pl;
  $("#pager").hidden = pages < 2;
  $("#pageInfo").textContent = `${page + 1} / ${pages}`;
  $("#pagePrev").disabled = page === 0; $("#pageNext").disabled = page >= pages - 1;
}
$("#paperChips").addEventListener("click", e => { const b = e.target.closest("[data-paper]"); if (!b) return; paper = b.dataset.paper; page = 0; renderHeads(); });
$("#pagePrev").addEventListener("click", () => { if (page > 0) { page--; renderHeads(); } });
$("#pageNext").addEventListener("click", () => { page++; renderHeads(); });
$("#heads").addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const it = $("#heads")._list[Number(b.dataset.add)], list = todayReads();
  const idx = list.findIndex(a => a.url === it.link);
  if (idx >= 0) { list.splice(idx, 1); openArts.clear(); } else list.push({ title: it.title, url: it.link, src: it.src, pub: it.pubDate || "", summary: "", thought: "" });
  saveReads(); renderHeads(); renderReads();
});

function renderReads() {
  const list = todayReads();
  $("#artCount").textContent = list.length + "건";
  $("#artList").innerHTML = list.length ? list.map((a, i) => `<li class="art"><details data-art="${i}" ${openArts.has(i) ? "open" : ""}>
      <summary><span class="artn">${i + 1}.</span><span class="artmain"><span class="artt" title="${esc(a.title)}">${esc(a.title)}</span><span class="artthp" data-thp="${i}" ${a.thought ? "" : "hidden"}>${esc(a.thought || "")}</span></span>${(a.summary || a.thought) ? `<span class="artdot" title="메모 있음">✏️</span>` : ""}</summary>
      <div class="artbody">
        <div class="arthead"><a href="${esc(a.url)}" target="_blank" rel="noopener">🔗 기사 열기</a><span class="muted" style="font-size:12px">${esc(a.src || "")}${a.pub ? " · " + pubTxt(a.pub) : ""}</span><button class="x" data-del="${i}" aria-label="삭제" style="margin-left:auto">×</button></div>
        <label class="field"><span>📄 본문요약 (중요한 문장 복사해서 붙여넣기)</span><textarea class="artsum" data-sum="${i}" rows="5" placeholder="기사에서 중요한 문장을 복사해서 붙여넣어줘">${esc(a.summary || "")}</textarea></label>
        <label class="field"><span>💭 내생각</span><textarea class="artth" data-th="${i}" rows="3" placeholder="왜 중요한지, 나한테 주는 의미">${esc(a.thought || "")}</textarea></label>
      </div></details></li>`).join("")
    : `<li class="empty" style="border:0;padding:0">위 헤드라인에서 '+ 읽음'을 눌러 담아봐.</li>`;
}
$("#artList").addEventListener("toggle", e => { const d = e.target.closest("[data-art]"); if (!d) return; const i = Number(d.dataset.art); d.open ? openArts.add(i) : openArts.delete(i); }, true);
let saveT = null;
$("#artList").addEventListener("input", e => {
  const sm = e.target.closest("[data-sum]"), th = e.target.closest("[data-th]"), list = todayReads();
  if (sm) list[Number(sm.dataset.sum)].summary = sm.value;
  else if (th) { list[Number(th.dataset.th)].thought = th.value; const pv = document.querySelector(`[data-thp="${th.dataset.th}"]`); if (pv) { pv.textContent = th.value; pv.hidden = !th.value.trim(); } }
  else return;
  clearTimeout(saveT); saveT = setTimeout(saveReads, 400);
});
$("#artList").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (!b) return; todayReads().splice(Number(b.dataset.del), 1); openArts.clear(); saveReads(); renderHeads(); renderReads(); });
window.addEventListener("beforeunload", saveReads);

render();
loadDates().then(loadNews);
})();
