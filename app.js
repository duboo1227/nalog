(function () {
"use strict";
const CFG = window.APP_CONFIG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kst = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const wd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const lab = s => { const [, m, d] = s.split("-").map(Number); return `${m}월 ${d}일 (${"일월화수목금토"[wd(s)]})`; };
const short = s => { const [, m, d] = s.split("-").map(Number); return `${m}/${d}`; };
const hhmm = iso => { if (!iso) return ""; return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); };
const TODAY = kst(new Date());
const REGIONS = ["갑상선", "유방", "경동맥", "상복부", "하복부", "장·충수", "심장", "기타"];
const PAPERS = [
  ["중앙일보", "https://www.joongang.co.kr/money"], ["매일경제", "https://www.mk.co.kr/news/economy/"],
  ["조선일보", "https://www.chosun.com/economy/"], ["동아일보", "https://www.donga.com/news/Economy"],
  ["한국경제", "https://www.hankyung.com/economy"], ["서울경제", "https://www.sedaily.com/"],
  ["연합뉴스", "https://www.yna.co.kr/economy/all"], ["네이버 경제", "https://news.naver.com/section/101"]
];

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
let user = null;
let days = {};          // date -> data
let cases = {};         // id -> row
let news = null;        // current news json
let newsPaper = "전체";
let newsPage = 0;
const PER_PAGE = 10;
let cur = TODAY;
let day = null;
let caseFilter = "전체";
const signed = {};      // storage path -> signed url

/* ---------------- 저장: 문서별 한 번에 하나씩 ---------------- */
const pending = {}, timers = {}, writing = {};
function status(t) { $("#status").textContent = t; }
function stamp() { const t = new Date(); return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; }
function queueDay(date, data, delay = 700) {
  pending[date] = JSON.parse(JSON.stringify(data));
  clearTimeout(timers[date]); timers[date] = setTimeout(() => flushDay(date), delay); status("저장 중…");
}
async function flushDay(date) {
  if (writing[date]) { timers[date] = setTimeout(() => flushDay(date), 300); return; }
  const data = pending[date]; if (!data) return; delete pending[date];
  writing[date] = true;
  const { error } = await sb.from("days").upsert({ user_id: user.id, date, data, updated_at: new Date().toISOString() });
  writing[date] = false;
  if (error) status("저장 실패: " + error.message); else status("저장됨 " + stamp());
}
window.addEventListener("beforeunload", e => { if (Object.keys(pending).length) { Object.keys(pending).forEach(flushDay); e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("visibilitychange", () => { if (document.hidden) Object.keys(pending).forEach(d => { clearTimeout(timers[d]); flushDay(d); }); });

/* ---------------- 하루 데이터 ---------------- */
function blankDay() { return { diaryOne: "", diary: "", news: [], book: { title: "", from: "", to: "", quote: "", note: "" }, study: [] }; }
function getDay(d) { const x = days[d]; const b = blankDay(); if (!x) return b; const c = JSON.parse(JSON.stringify(x)); return Object.assign(b, c, { book: Object.assign(b.book, c.book || {}) }); }
function pages(b) { const f = Number(b && b.from), t = Number(b && b.to); return (b && b.from !== "" && b.to !== "" && b.from != null && b.to != null && t >= f) ? (t - f + 1) : 0; }
function sumMin(x) { return (x.study || []).reduce((a, s) => a + (Number(s.minutes) || 0), 0); }
function flags(x) {
  return {
    news: (x.news || []).length > 0,
    diary: ((x.diary || "").trim().length + (x.diaryOne || "").trim().length) > 0,
    book: pages(x.book) >= 5,
    study: (x.study || []).some(s => (s.subject || "").trim() || (s.content || "").trim())
  };
}
function saveDay() { days[cur] = JSON.parse(JSON.stringify(day)); queueDay(cur, day); renderOverview(); }
function allDays() { return Object.entries(days).map(([date, x]) => Object.assign({ date }, x)).sort((a, b) => a.date < b.date ? 1 : -1); }

/* ---------------- 상단 요약 ---------------- */
function renderOverview() {
  $("#todayLabel").textContent = cur === TODAY ? "오늘 · " + lab(cur) : lab(cur);
  $("#datePick").value = cur; $("#datePick").max = TODAY;
  const end = addDays(TODAY, 6 - wd(TODAY)), start = addDays(end, -34);
  let html = "";
  for (let i = 0; i < 35; i++) {
    const d = addDays(start, i), x = days[d], lv = x ? Object.values(flags(x)).filter(Boolean).length : 0, fut = d > TODAY;
    html += `<button class="cell${d === cur ? " sel" : ""}${fut ? " future" : ""}" data-d="${d}" data-lv="${lv}" ${fut ? "disabled" : ""} title="${lab(d)} · ${lv}/4"></button>`;
  }
  $("#grid35").innerHTML = html;
  const f = flags(day);
  const items = [["news", "경제뉴스", (day.news || []).length + "건"], ["diary", "어제 일기", f.diary ? "작성" : "미작성"], ["book", "독서 5쪽", pages(day.book) + "쪽"], ["study", "공부", sumMin(day) + "분"]];
  $("#checks").innerHTML = items.map(([k, t, v]) => `<div class="chk${f[k] ? " done" : ""}"><i class="dot"></i><span class="t">${t}</span><span class="mono muted" style="margin-left:auto">${v}</span></div>`).join("");
  const ym = cur.slice(0, 7); let dd = 0, pg = 0, mins = 0, cs = 0;
  allDays().forEach(x => { if (x.date.slice(0, 7) !== ym) return; if (flags(x).diary) dd++; pg += pages(x.book); mins += sumMin(x); });
  Object.values(cases).forEach(c => { if ((c.date || "").slice(0, 7) === ym) cs++; });
  $("#month").innerHTML = `<span class="muted">${Number(ym.slice(5))}월</span><span>일기 <b>${dd}</b>일</span><span>독서 <b>${pg}</b>쪽</span><span>공부 <b>${(mins / 60).toFixed(1)}</b>시간</span><span>케이스 <b>${cs}</b>개</span>`;
}

/* ---------------- ① 뉴스 ---------------- */
async function loadNews(date) {
  newsPage = 0;
  news = null; renderNews();
  const tryUrls = [CFG.NEWS_BASE + date + ".json", "data/news/" + date + ".json"];
  for (const u of tryUrls) {
    try { const r = await fetch(u + "?t=" + Date.now(), { cache: "no-store" }); if (r.ok) { news = await r.json(); break; } } catch (_) {}
  }
  if (!news) news = { date, sources: [], missing: true };
  renderNews();
}
function renderNews() {
  $("#papers").innerHTML = PAPERS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}<small>경제면</small></a>`).join("");
  if (!news || news.missing || !news.sources.length) $("#pager").hidden = true;
  if (!news) { $("#heads").innerHTML = `<li class="empty" style="border:0">불러오는 중…</li>`; $("#paperChips").innerHTML = ""; $("#newsStamp").textContent = ""; }
  else if (news.missing || !news.sources.length) {
    $("#paperChips").innerHTML = ""; $("#newsStamp").textContent = lab(cur);
    $("#heads").innerHTML = `<li class="empty" style="border:0">${cur === TODAY ? "오늘 헤드라인은 아직 수집 전이야 (06:40에 자동 수집)." : "이 날짜의 헤드라인 기록이 없어."} 아래 바로가기로 읽어도 돼.</li>`;
  } else {
    $("#newsStamp").textContent = `${short(news.date)} ${hhmm(news.generatedAt)} 수집`;
    const srcs = news.sources.filter(s => s.items.length);
    if (newsPaper !== "전체" && !srcs.some(s => s.name === newsPaper)) newsPaper = "전체";
    $("#paperChips").innerHTML = ["전체", ...srcs.map(s => s.name)].map(n => `<button class="chip" data-paper="${esc(n)}" aria-pressed="${n === newsPaper}">${esc(n)}</button>`).join("");
    let list;
    if (newsPaper === "전체") {
      // 신문사별로 번갈아 섞어서 한 페이지에 여러 신문이 보이게
      list = []; const max = Math.max(...srcs.map(s => s.items.length));
      for (let r = 0; r < max; r++) srcs.forEach(s => { if (s.items[r]) list.push(Object.assign({ src: s.name }, s.items[r])); });
    } else list = srcs.find(s => s.name === newsPaper).items.map(i => Object.assign({ src: newsPaper }, i));
    const pagesN = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (newsPage >= pagesN) newsPage = pagesN - 1;
    const start = newsPage * PER_PAGE, pageList = list.slice(start, start + PER_PAGE);
    const saved = new Set((day.news || []).map(a => a.url));
    $("#heads").innerHTML = pageList.map((it, i) => `<li><span class="n">${String(start + i + 1).padStart(2, "0")}</span><div><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a><div class="time">${esc(it.src)}${it.pubDate ? " · " + hhmm(it.pubDate) : ""}</div></div><button class="add${saved.has(it.link) ? " on" : ""}" data-add="${i}">${saved.has(it.link) ? "✓ 읽음" : "+ 읽음"}</button></li>`).join("");
    $("#heads")._list = pageList;
    $("#pager").hidden = pagesN < 2;
    $("#pageInfo").textContent = `${newsPage + 1} / ${pagesN}`;
    $("#pagePrev").disabled = newsPage === 0;
    $("#pageNext").disabled = newsPage >= pagesN - 1;
  }
  const arts = day.news || [];
  $("#artCount").textContent = arts.length + "건";
  $("#artList").innerHTML = arts.length ? arts.map((a, i) => `<li><div class="body">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener"><b>${esc(a.title)}</b></a>` : `<b>${esc(a.title)}</b>`}${a.src ? ` <span class="muted" style="font-size:12px">${esc(a.src)}</span>` : ""}<input type="text" class="memo" data-memo="${i}" value="${esc(a.memo)}" placeholder="한 줄 생각" style="margin-top:6px;padding:6px 9px;font-size:14px"></div><button class="x" data-del-art="${i}" aria-label="삭제">×</button></li>`).join("") : `<li class="empty" style="border:0;padding:0">위 헤드라인에서 '+ 읽음'을 누르거나 직접 추가해줘.</li>`;
}
$("#paperChips").addEventListener("click", e => { const b = e.target.closest("[data-paper]"); if (!b) return; newsPaper = b.dataset.paper; newsPage = 0; renderNews(); });
$("#pagePrev").addEventListener("click", () => { if (newsPage > 0) { newsPage--; renderNews(); $("#v-news").scrollIntoView({ block: "start" }); } });
$("#pageNext").addEventListener("click", () => { newsPage++; renderNews(); $("#v-news").scrollIntoView({ block: "start" }); });
$("#heads").addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const it = $("#heads")._list[Number(b.dataset.add)];
  const idx = (day.news || []).findIndex(a => a.url === it.link);
  if (idx >= 0) day.news.splice(idx, 1); else day.news = (day.news || []).concat([{ title: it.title, url: it.link, src: it.src, memo: "" }]);
  saveDay(); renderNews();
});
$("#artForm").addEventListener("submit", e => {
  e.preventDefault();
  const title = $("#artTitle").value.trim(); if (!title) { $("#artTitle").focus(); return; }
  let url = $("#artUrl").value.trim(); if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
  day.news = (day.news || []).concat([{ title, url, memo: $("#artMemo").value.trim() }]);
  $("#artTitle").value = $("#artUrl").value = $("#artMemo").value = "";
  saveDay(); renderNews();
});
$("#artList").addEventListener("click", e => { const b = e.target.closest("[data-del-art]"); if (!b) return; day.news.splice(Number(b.dataset.delArt), 1); saveDay(); renderNews(); });
$("#artList").addEventListener("input", e => { const m = e.target.closest("[data-memo]"); if (!m) return; day.news[Number(m.dataset.memo)].memo = m.value; saveDay(); });

/* ---------------- ② 일기 ---------------- */
function fillDiary() {
  $("#diaryTitle").textContent = `${lab(addDays(cur, -1))} 일기`;
  $("#diaryOne").value = day.diaryOne || ""; $("#diaryText").value = day.diary || "";
  $("#diaryCount").textContent = (day.diary || "").length + "자";
}
function renderPastDiary() {
  const list = allDays().filter(x => x.date !== cur && ((x.diary || "").trim() || (x.diaryOne || "").trim())).slice(0, 30);
  $("#pastDiary").innerHTML = list.length ? list.map(x => `<details class="past"><summary><span class="mono muted">${short(addDays(x.date, -1))}</span> ${esc(x.diaryOne || "(요약 없음)")}</summary><p>${esc(x.diary)}</p></details>`).join("") : `<div class="empty">지난 일기가 쌓이면 여기에 보여.</div>`;
}
$("#diaryOne").addEventListener("input", e => { day.diaryOne = e.target.value; saveDay(); });
$("#diaryText").addEventListener("input", e => { day.diary = e.target.value; $("#diaryCount").textContent = day.diary.length + "자"; saveDay(); });

/* ---------------- ③ 독서 ---------------- */
function lastBook() { return allDays().find(x => x.date < cur && x.book && x.book.title); }
function fillBook() {
  const b = day.book, lb = lastBook();
  $("#bookTitle").placeholder = "읽고 있는 책"; $("#bookFrom").placeholder = ""; $("#bookHint").textContent = "";
  if (!b.title && !b.from && !b.to && lb) {
    $("#bookHint").textContent = `지난번: 『${lb.book.title}』 ${lb.book.to || "?"}쪽까지 읽음 — 칸을 누르면 이어서 채워져`;
    $("#bookTitle").placeholder = lb.book.title;
    if (lb.book.to) $("#bookFrom").placeholder = String(Number(lb.book.to) + 1);
  }
  $("#bookTitle").value = b.title || ""; $("#bookFrom").value = b.from ?? ""; $("#bookTo").value = b.to ?? "";
  $("#bookQuote").value = b.quote || ""; $("#bookNote").value = b.note || "";
  updateMeter();
}
function updateMeter() {
  const p = pages(day.book); $("#pageTally").textContent = `${p} / 5쪽`;
  $("#pageMeter").firstElementChild.style.width = Math.min(100, p / 5 * 100) + "%";
  $("#pageMeter").classList.toggle("full", p >= 5);
}
function renderBooks() {
  const list = allDays().filter(x => x.book && (x.book.title || pages(x.book)));
  $("#bookRows").innerHTML = list.length ? list.slice(0, 90).map(x => `<tr><td class="num">${short(x.date)}</td><td>${esc(x.book.title)}</td><td class="num">${x.book.from || "?"}–${x.book.to || "?"} <span class="muted">(${pages(x.book)})</span></td><td>${esc(x.book.quote)}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">기록이 쌓이면 여기에 표로 보여.</td></tr>`;
  $("#bookList").innerHTML = [...new Set(list.map(x => x.book.title).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join("");
}
[["#bookTitle", "title"], ["#bookFrom", "from"], ["#bookTo", "to"], ["#bookQuote", "quote"], ["#bookNote", "note"]].forEach(([s, k]) => {
  $(s).addEventListener("input", e => { day.book[k] = e.target.value; updateMeter(); saveDay(); });
});
$("#bookTitle").addEventListener("focus", e => { const ph = e.target.placeholder; if (!e.target.value && ph && ph !== "읽고 있는 책") { e.target.value = ph; day.book.title = ph; saveDay(); } });
$("#bookFrom").addEventListener("focus", e => { const ph = e.target.placeholder; if (e.target.value === "" && ph) { e.target.value = ph; day.book.from = ph; updateMeter(); saveDay(); } });

/* ---------------- ④ 공부 ---------------- */
function fillStudy() {
  if (!day.study.length) day.study = [{ subject: "", minutes: "", content: "" }];
  $("#studyItems").innerHTML = day.study.map((s, i) => `<div class="studyitem" data-i="${i}">
    <label class="field"><span>과목</span><input type="text" data-k="subject" list="subjList" value="${esc(s.subject)}" placeholder="예: 심장초음파, 영어, 투자"></label>
    <label class="field"><span>시간(분)</span><input type="number" data-k="minutes" min="0" inputmode="numeric" value="${esc(s.minutes)}"></label>
    <button class="x" data-del-study="${i}" aria-label="항목 삭제" style="margin-top:24px">×</button>
    <label class="field"><span>내용</span><textarea data-k="content" placeholder="무엇을 공부했고, 무엇을 알게 됐는지">${esc(s.content)}</textarea></label>
  </div>`).join("");
  $("#studyTotal").textContent = sumMin(day) + "분";
}
$("#studyItems").addEventListener("input", e => {
  const el = e.target, box = el.closest(".studyitem"); if (!box || !el.dataset.k) return;
  day.study[Number(box.dataset.i)][el.dataset.k] = el.value; $("#studyTotal").textContent = sumMin(day) + "분"; saveDay();
});
$("#studyItems").addEventListener("click", e => { const b = e.target.closest("[data-del-study]"); if (!b) return; day.study.splice(Number(b.dataset.delStudy), 1); fillStudy(); saveDay(); });
$("#studyAdd").addEventListener("click", () => { day.study.push({ subject: "", minutes: "", content: "" }); fillStudy(); });
function renderStudy() {
  const ym = cur.slice(0, 7), agg = {}, all = allDays();
  all.filter(x => x.date.slice(0, 7) === ym).forEach(x => { const seen = new Set(); (x.study || []).forEach(s => { const k = (s.subject || "").trim(); if (!k) return; agg[k] = agg[k] || { days: 0, min: 0 }; agg[k].min += Number(s.minutes) || 0; if (!seen.has(k)) { agg[k].days++; seen.add(k); } }); });
  const rows = Object.entries(agg).sort((a, b) => b[1].min - a[1].min);
  $("#subjRows").innerHTML = rows.length ? rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.days}일</td><td class="num">${Math.floor(v.min / 60)}시간 ${v.min % 60}분</td></tr>`).join("") : `<tr><td colspan="3" class="empty">이번 달 공부 기록이 없어.</td></tr>`;
  const subs = new Set(); all.forEach(x => (x.study || []).forEach(s => s.subject && subs.add(s.subject.trim())));
  $("#subjList").innerHTML = [...subs].map(s => `<option value="${esc(s)}">`).join("");
  const past = all.filter(x => x.date !== cur && flags(x).study).slice(0, 20);
  $("#pastStudy").innerHTML = past.length ? past.map(x => `<details class="past"><summary><span class="mono muted">${short(x.date)}</span> ${esc(x.study.map(s => s.subject).filter(Boolean).join(" · "))} <span class="muted mono">${sumMin(x)}분</span></summary>${x.study.map(s => `<p><b>${esc(s.subject)}</b> ${esc(s.content)}</p>`).join("")}</details>`).join("") : `<div class="empty">지난 공부 기록이 쌓이면 여기에 보여.</div>`;
}

/* ---------------- ⑤ 케이스 ---------------- */
async function signPaths(paths) {
  const need = paths.filter(p => p && !signed[p]);
  if (!need.length) return;
  const { data } = await sb.storage.from("cases").createSignedUrls(need, 60 * 60 * 6);
  (data || []).forEach(d => { if (d.signedUrl) signed[d.path] = d.signedUrl; });
}
const imgUrl = p => signed[p] || "";
function caseList() { return Object.values(cases).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.created_at || "").localeCompare(a.created_at || "")); }
async function renderCases() {
  const all = caseList();
  await signPaths(all.map(c => (c.images || [])[0]));
  const counts = {}; all.forEach(c => counts[c.region] = (counts[c.region] || 0) + 1);
  $("#caseFilter").innerHTML = ["전체", ...REGIONS].filter(r => r === "전체" || counts[r]).map(r => `<button class="chip" aria-pressed="${r === caseFilter}" data-r="${r}">${r} <span class="mono">${r === "전체" ? all.length : counts[r]}</span></button>`).join("");
  const q = $("#caseSearch").value.trim().toLowerCase();
  const list = all.filter(c => (caseFilter === "전체" || c.region === caseFilter) && (!q || [c.title, c.findings, c.impression, c.memo, (c.tags || []).join(" ")].join(" ").toLowerCase().includes(q)));
  $("#caseGrid").innerHTML = list.length ? list.map(c => `<button class="case" data-case="${c.id}"><div class="thumb">${(c.images || []).length ? `<img src="${esc(imgUrl(c.images[0]))}" alt="" loading="lazy">` : "이미지 없음"}</div><div class="meta"><span><span class="tag">${esc(c.region || "기타")}</span> <span class="mono muted" style="font-size:12px">${esc(c.date || "")}</span></span><b>${esc(c.title || "(제목 없음)")}</b><span class="muted" style="font-size:13px">${esc((c.impression || c.findings || "").slice(0, 60))}</span></div></button>`).join("") : `<div class="empty">${all.length ? "조건에 맞는 케이스가 없어." : "첫 케이스를 '+ 새 케이스'로 남겨봐. 메모 사진이나 캡처 이미지를 같이 올릴 수 있어."}</div>`;
}
$("#caseFilter").addEventListener("click", e => { const b = e.target.closest("[data-r]"); if (!b) return; caseFilter = b.dataset.r; renderCases(); });
$("#caseSearch").addEventListener("input", renderCases);
$("#caseGrid").addEventListener("click", e => { const b = e.target.closest("[data-case]"); if (b) openCase(b.dataset.case, false); });
$("#newCase").addEventListener("click", () => openCase(null, true));

let editCase = null;
function openCase(id, editing) {
  const src = id ? cases[id] : null;
  editCase = { isNew: !src, data: src ? JSON.parse(JSON.stringify(src)) : { id: crypto.randomUUID(), date: TODAY, title: "", region: "갑상선", findings: "", impression: "", memo: "", tags: [], images: [] } };
  renderCaseSheet(editing);
  $("#caseModal").hidden = false; document.body.style.overflow = "hidden";
}
function closeCase() { $("#caseModal").hidden = true; document.body.style.overflow = ""; editCase = null; }
async function renderCaseSheet(editing) {
  const c = editCase.data, sh = $("#caseSheet");
  await signPaths(c.images || []);
  if (!editing) {
    sh.innerHTML = `<div class="phead"><h2 id="caseModalTitle">${esc(c.title || "(제목 없음)")}</h2><button class="x" data-act="close" aria-label="닫기">×</button></div>
      <div><span class="tag">${esc(c.region)}</span> <span class="mono muted">${esc(c.date)}</span> ${(c.tags || []).map(t => `<span class="muted">#${esc(t)}</span>`).join(" ")}</div>
      ${c.findings ? `<div><div class="label">Findings</div><div class="pre">${esc(c.findings)}</div></div>` : ""}
      ${c.impression ? `<div><div class="label">Impression</div><div class="pre">${esc(c.impression)}</div></div>` : ""}
      ${c.memo ? `<div><div class="label">메모 / 배운 점</div><div class="pre">${esc(c.memo)}</div></div>` : ""}
      <div class="imgs">${(c.images || []).map(p => `<a href="${esc(imgUrl(p))}" target="_blank" rel="noopener"><img src="${esc(imgUrl(p))}" alt="케이스 이미지" loading="lazy"></a>`).join("")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="edit">수정</button><button class="btn ghost" data-act="close">닫기</button></div>`;
    return;
  }
  sh.innerHTML = `<div class="phead"><h2 id="caseModalTitle">${editCase.isNew ? "새 케이스" : "케이스 수정"}</h2><button class="x" data-act="close" aria-label="닫기">×</button></div>
    <div class="row">
      <label class="field"><span>날짜</span><input type="date" id="cDate" value="${esc(c.date)}"></label>
      <label class="field"><span>부위</span><select id="cRegion">${REGIONS.map(r => `<option${r === c.region ? " selected" : ""}>${r}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>제목 (진단명·소견명)</span><input type="text" id="cTitle" value="${esc(c.title)}" placeholder="예: Thyroid nodule, K-TIRADS 4"></label>
    <label class="field"><span>Findings</span><textarea id="cFind" rows="3">${esc(c.findings)}</textarea></label>
    <label class="field"><span>Impression</span><textarea id="cImp" rows="2">${esc(c.impression)}</textarea></label>
    <label class="field"><span>메모 / 배운 점</span><textarea id="cMemo" rows="3" placeholder="놓치기 쉬운 포인트, 원장님 피드백, 추적 결과">${esc(c.memo)}</textarea></label>
    <label class="field"><span>태그 (쉼표로 구분)</span><input type="text" id="cTags" value="${esc((c.tags || []).join(", "))}" placeholder="예: 석회화, f/u, 조직검사"></label>
    <div class="field"><span>이미지 (메모 사진, 캡처)</span>
      <div class="uploads">${(c.images || []).map((p, k) => `<div class="u"><img src="${esc(imgUrl(p))}" alt=""><button data-rm-img="${k}" aria-label="이미지 빼기">×</button></div>`).join("")}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
        <label class="btn" style="display:inline-block">이미지 추가<input type="file" id="cFile" accept="image/*" multiple hidden></label>
        <span class="muted" style="font-size:12.5px" id="cUpMsg">한 장당 20MB까지</span>
      </div>
    </div>
    <div id="cConfirm"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between">
      <div style="display:flex;gap:8px"><button class="btn primary" data-act="save">저장</button><button class="btn ghost" data-act="close">취소</button></div>
      ${editCase.isNew ? "" : `<button class="btn danger" data-act="del">삭제</button>`}
    </div>`;
  $("#cFile").addEventListener("change", uploadFiles);
}
function readForm() {
  const c = editCase.data;
  c.date = $("#cDate").value || TODAY; c.region = $("#cRegion").value; c.title = $("#cTitle").value.trim();
  c.findings = $("#cFind").value; c.impression = $("#cImp").value; c.memo = $("#cMemo").value;
  c.tags = $("#cTags").value.split(",").map(s => s.trim()).filter(Boolean);
}
async function uploadFiles(e) {
  const files = [...e.target.files]; if (!files.length) return;
  readForm(); const msg = $("#cUpMsg"); let err = "";
  for (const [i, f] of files.entries()) {
    msg.textContent = `올리는 중 ${i + 1}/${files.length}…`;
    if (f.size > 20 * 1024 * 1024) { err = `${f.name}: 20MB 초과`; continue; }
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${user.id}/${editCase.data.id}/${Date.now()}-${i}.${ext}`;
    const { error } = await sb.storage.from("cases").upload(path, f, { contentType: f.type || "image/jpeg" });
    if (error) err = `${f.name}: ${error.message}`; else editCase.data.images.push(path);
  }
  await renderCaseSheet(true);
  if (err) $("#cUpMsg").textContent = err;
}
async function saveCase() {
  readForm();
  const c = editCase.data;
  const row = { id: c.id, user_id: user.id, date: c.date, region: c.region, title: c.title, findings: c.findings, impression: c.impression, memo: c.memo, tags: c.tags, images: c.images, updated_at: new Date().toISOString() };
  status("저장 중…");
  const { data, error } = await sb.from("cases").upsert(row).select().single();
  if (error) { status("케이스 저장 실패: " + error.message); return false; }
  // 수정 중 뺀 이미지는 저장소에서도 정리
  const before = cases[c.id] ? (cases[c.id].images || []) : [];
  const removed = before.filter(p => !c.images.includes(p));
  if (removed.length) await sb.storage.from("cases").remove(removed);
  cases[c.id] = data; status("케이스 저장됨 " + stamp());
  return true;
}
$("#caseSheet").addEventListener("click", async e => {
  const rm = e.target.closest("[data-rm-img]");
  if (rm) { readForm(); editCase.data.images.splice(Number(rm.dataset.rmImg), 1); renderCaseSheet(true); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act === "close") {
    // 새 케이스를 저장 없이 닫으면 올려둔 이미지 정리
    if (editCase && editCase.isNew && editCase.data.images.length) sb.storage.from("cases").remove(editCase.data.images);
    closeCase();
  }
  else if (act === "edit") renderCaseSheet(true);
  else if (act === "save") { a.disabled = true; const ok = await saveCase(); a.disabled = false; if (ok) { const id = editCase.data.id; renderCases(); renderOverview(); openCase(id, false); } }
  else if (act === "del") $("#cConfirm").innerHTML = `<div class="confirm notice">이 케이스와 첨부 이미지를 지울까? 되돌릴 수 없어. <button class="btn danger" data-act="delyes">삭제</button><button class="btn ghost" data-act="delno">취소</button></div>`;
  else if (act === "delno") $("#cConfirm").innerHTML = "";
  else if (act === "delyes") {
    const id = editCase.data.id, imgs = (cases[id] && cases[id].images) || [];
    const { error } = await sb.from("cases").delete().eq("id", id);
    if (error) { $("#cConfirm").innerHTML = `<div class="notice">삭제하지 못했어: ${esc(error.message)}</div>`; return; }
    if (imgs.length) await sb.storage.from("cases").remove(imgs);
    delete cases[id]; status("케이스 삭제됨"); closeCase(); renderCases(); renderOverview();
  }
});
$("#caseModal").addEventListener("click", e => { if (e.target.id === "caseModal") { if (editCase && editCase.isNew && editCase.data.images.length) sb.storage.from("cases").remove(editCase.data.images); closeCase(); } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#caseModal").hidden) closeCase(); });

/* ---------------- 날짜·탭 ---------------- */
function setDate(d) {
  if (d > TODAY) d = TODAY;
  if (pending[cur]) { clearTimeout(timers[cur]); flushDay(cur); }
  cur = d; day = getDay(d);
  fillAll(); renderAll(); loadNews(d);
}
function fillAll() { fillDiary(); fillBook(); fillStudy(); }
function renderAll() { renderOverview(); renderNews(); renderPastDiary(); renderBooks(); renderStudy(); renderCases(); }
$("#prevDay").onclick = () => setDate(addDays(cur, -1));
$("#nextDay").onclick = () => setDate(addDays(cur, 1));
$("#goToday").onclick = () => setDate(TODAY);
$("#datePick").addEventListener("change", e => { if (e.target.value) setDate(e.target.value); });
$("#grid35").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (b && !b.disabled) setDate(b.dataset.d); });

const VIEWS = ["news", "diary", "books", "study", "cases"];
function route() {
  const h = (location.hash || "").slice(1), v = VIEWS.includes(h) ? h : "news";
  VIEWS.forEach(x => { $("#v-" + x).hidden = x !== v; });
  document.querySelectorAll("#tabs a").forEach(a => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
}
window.addEventListener("hashchange", route);

/* ---------------- 로그인 ---------------- */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim(); if (!email) return;
  $("#loginBtn").disabled = true;
  const redirect = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  $("#loginBtn").disabled = false;
  const m = $("#loginMsg"); m.hidden = false;
  m.textContent = error ? "링크를 보내지 못했어: " + error.message : `${email}로 로그인 링크를 보냈어. 메일함(스팸함 포함)을 확인해줘.`;
});
$("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

async function startApp(session) {
  user = session.user;
  $("#loginView").hidden = true; $("#appView").hidden = false;
  $("#whoami").textContent = user.email || "";
  day = blankDay(); route(); fillAll(); renderAll();
  status("불러오는 중…");
  const [d, c] = await Promise.all([
    sb.from("days").select("date,data").order("date", { ascending: false }).limit(2000),
    sb.from("cases").select("*").order("date", { ascending: false }).limit(2000)
  ]);
  if (d.error || c.error) { status("기록을 불러오지 못했어: " + (d.error || c.error).message); return; }
  days = {}; d.data.forEach(r => days[r.date] = r.data || {});
  cases = {}; c.data.forEach(r => cases[r.id] = r);
  status("");
  setDate(cur);
}

let started = false;
sb.auth.onAuthStateChange((_ev, session) => {
  if (session && !started) { started = true; startApp(session); if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname); }
});
sb.auth.getSession().then(({ data }) => {
  if (data.session) { if (!started) { started = true; startApp(data.session); } }
  else if (!location.hash.includes("access_token") && !location.search.includes("code=")) { $("#loginView").hidden = false; }
});
})();
