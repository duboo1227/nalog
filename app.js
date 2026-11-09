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

// ?demo 로 열면 구경 모드: 예시 데이터, 서버에 아무것도 저장하지 않음
const DEMO = new URLSearchParams(location.search).has("demo");
const sb = DEMO ? demoClient() : window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
function demoClient() {
  const chain = () => {
    const q = {
      upsert(row) { q._row = row; return q; }, select() { return q; }, delete() { return q; }, order() { return q; },
      single() { return Promise.resolve({ data: Object.assign({ created_at: new Date().toISOString() }, q._row), error: null }); },
      eq() { return Promise.resolve({ error: null }); }, limit() { return Promise.resolve({ data: [], error: null }); },
      then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); }
    };
    return q;
  };
  return {
    from: chain,
    storage: { from() { return {
      upload(path, f) { signed[path] = URL.createObjectURL(f); return Promise.resolve({ error: null }); },
      remove() { return Promise.resolve({}); },
      createSignedUrls(ps) { return Promise.resolve({ data: ps.map(x => ({ path: x, signedUrl: signed[x] || "" })) }); }
    }; } },
    auth: { onAuthStateChange() {}, getSession() { return Promise.resolve({ data: { session: null } }); }, signOut() { return Promise.resolve(); } }
  };
}
let user = null;
let days = {};          // date -> data
let cases = {};         // id -> row
let news = null;        // current news json
let newsPaper = "전체";
let newsPage = 0;
const openArts = new Set();   // 펼쳐둔 읽은 기사 번호
// 한 화면에 보이는 헤드라인 수: 폰(좁은 화면) 5개, PC·태블릿 10개
const mobileMQ = window.matchMedia("(max-width: 640px)");
const perPage = () => mobileMQ.matches ? 5 : 10;
mobileMQ.addEventListener("change", () => { newsPage = 0; renderNews(); });
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
  if (error) status("저장 실패: " + error.message); else status(DEMO ? "구경 모드라 저장은 안 돼요 👀" : "저장됨 💾 " + stamp());
}
window.addEventListener("beforeunload", e => { if (Object.keys(pending).length) { Object.keys(pending).forEach(flushDay); e.preventDefault(); e.returnValue = ""; } });
document.addEventListener("visibilitychange", () => { if (document.hidden) Object.keys(pending).forEach(d => { clearTimeout(timers[d]); flushDay(d); }); });

/* ---------------- 하루 데이터 ---------------- */
function blankDay() { return { todos: [], diaryOne: "", diary: "", news: [], book: { title: "", from: "", to: "", quote: "", note: "" }, study: [] }; }
function getDay(d) { const x = days[d]; const b = blankDay(); if (!x) return b; const c = JSON.parse(JSON.stringify(x)); return Object.assign(b, c, { book: Object.assign(b.book, c.book || {}) }); }
function pages(b) { const f = Number(b && b.from), t = Number(b && b.to); return (b && b.from !== "" && b.to !== "" && b.from != null && b.to != null && t >= f) ? (t - f + 1) : 0; }
// 종이 1장 = 2쪽, 하루 목표 5장(=10쪽)
const GOAL_SHEETS = 5;
const sheets = p => Math.round(p / 2 * 10) / 10;
const sheetTxt = p => `${sheets(p)}장`;
function sumMin(x) { return (x.study || []).reduce((a, s) => a + (Number(s.minutes) || 0), 0); }
function flags(x) {
  return {
    news: (x.news || []).length > 0,
    diary: !!x.diaryLocked || (x.diaryImages || []).length > 0 || ((x.diary || "").trim().length + (x.diaryOne || "").trim().length) > 0,
    book: pages(x.book) >= GOAL_SHEETS * 2,
    study: (x.study || []).some(s => s.taskId || (s.subject || "").trim() || (s.content || "").trim())
  };
}
function anyRecord(x) {
  return Object.values(flags(x)).some(Boolean) || (x.todos || []).some(t => t.done);
}
function saveDay() { days[cur] = JSON.parse(JSON.stringify(day)); queueDay(cur, day); renderOverview(); }
function allDays() { return Object.entries(days).map(([date, x]) => Object.assign({ date }, x)).sort((a, b) => a.date < b.date ? 1 : -1); }

/* ---------------- 상단 요약 ---------------- */
function filledDay(d) {
  const x = days[d];
  if (x && anyRecord(x)) return true;
  return Object.values(cases).some(c => c.date === d);
}
let calMonth = TODAY.slice(0, 7);
const STICKERS = ["🌸", "🍀", "⭐", "🍓", "🐣", "🌼", "🍒", "🫧", "🧸", "🍑", "🌈", "🐥"];

/* ---------------- 오늘 할 일 ---------------- */
const onCal = () => $("#dayHead").hidden;
const todoDate = () => onCal() ? TODAY : cur;
function dayObj(date) { return date === cur ? day : getDay(date); }
function commitDay(date, x) {
  if (date === cur) day = x;
  days[date] = JSON.parse(JSON.stringify(x));
  queueDay(date, x);
}
// 오늘 처음 열면 이전 날 못 끝낸 할 일을 넘겨옴
function carryTodos() {
  const x = dayObj(TODAY);
  if (x.todosInit) return;
  const prev = allDays().find(d => d.date < TODAY && (d.todos || []).length);
  const carry = prev ? prev.todos.filter(t => !t.done).map(t => ({ text: t.text, done: false, from: t.from || prev.date })) : [];
  if (!carry.length) return;
  x.todos = carry.concat(x.todos || []); x.todosInit = true;
  commitDay(TODAY, x);
}
function renderTodos() {
  const date = todoDate(), x = dayObj(date), list = x.todos || [];
  $("#tbTitle").textContent = date === TODAY ? "📝 오늘 할 일" : `📝 ${lab(date)} 할 일`;
  const done = list.filter(t => t.done).length;
  $("#tbCount").textContent = list.length ? `${done}/${list.length}` : "";
  $("#todoList").innerHTML = list.length ? list.map((t, i) => `<li class="${t.done ? "done" : ""}">
      <label><input type="checkbox" data-todo="${i}" ${t.done ? "checked" : ""}><span class="tt">${esc(t.text)}</span></label>
      ${t.from ? `<span class="from">${short(t.from)}부터</span>` : ""}
      <button class="x" data-del-todo="${i}" aria-label="삭제">×</button></li>`).join("")
    : `<li class="empty">${date === TODAY ? "오늘 할 일을 적어봐 ✍️" : "이 날은 할 일이 없었어 ☁️"}</li>`;
}
function editTodos(fn) {
  const date = todoDate(), x = dayObj(date);
  x.todos = (x.todos || []).slice(); fn(x.todos); x.todosInit = true;
  commitDay(date, x); renderTodos(); renderCal(); renderOverview();
}
$("#todoForm").addEventListener("submit", e => {
  e.preventDefault(); const t = $("#todoInput").value.trim(); if (!t) return;
  editTodos(l => l.push({ text: t, done: false })); $("#todoInput").value = ""; $("#todoInput").focus();
});
$("#todoList").addEventListener("change", e => { const c = e.target.closest("[data-todo]"); if (!c) return; editTodos(l => { l[Number(c.dataset.todo)] = Object.assign({}, l[Number(c.dataset.todo)], { done: c.checked }); }); });
$("#todoList").addEventListener("click", e => { const b = e.target.closest("[data-del-todo]"); if (!b) return; editTodos(l => l.splice(Number(b.dataset.delTodo), 1)); });
function renderCal() {
  const [y, m] = calMonth.split("-").map(Number);
  $("#calTitle").textContent = `${y}년 ${m}월`;
  const first = `${calMonth}-01`, lead = wd(first);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let html = "";
  for (let i = 0; i < lead; i++) html += `<span class="d blank"></span>`;
  let filled = 0;
  for (let i = 1; i <= nDays; i++) {
    const d = `${calMonth}-${String(i).padStart(2, "0")}`, w = wd(d), fut = d > TODAY, f = !fut && filledDay(d);
    if (f) filled++;
    html += `<button class="d${d === TODAY ? " today" : ""}${f ? " filled" : ""}${fut ? " future" : ""}${w === 0 ? " sun" : w === 6 ? " sat" : ""}" data-d="${d}" ${fut ? "disabled" : ""} aria-label="${lab(d)}${f ? ", 기록 있음" : ""}"><span class="num">${i}</span>${f ? `<span class="stk" aria-hidden="true">${STICKERS[(i * 7 + m) % STICKERS.length]}</span>` : ""}</button>`;
  }
  $("#calGrid").innerHTML = html;
  let pg = 0, mins = 0;
  allDays().forEach(x => { if (x.date.slice(0, 7) === calMonth) { pg += pages(x.book); mins += sumMin(x); } });
  const cs = Object.values(cases).filter(c => (c.date || "").slice(0, 7) === calMonth).length;
  $("#calStats").textContent = `기록 ${filled}일 · 독서 ${sheetTxt(pg)} · 공부 ${(mins / 60).toFixed(1)}시간 · 케이스 ${cs}개`;
  $("#calNext").disabled = calMonth >= TODAY.slice(0, 7);
}
$("#calPrev").onclick = () => { const [y, m] = calMonth.split("-").map(Number); calMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); renderCal(); };
$("#calNext").onclick = () => { const [y, m] = calMonth.split("-").map(Number); calMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); renderCal(); };
$("#calToday").onclick = () => { calMonth = TODAY.slice(0, 7); renderCal(); };
$("#calGrid").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (!b || b.disabled) return; setDate(b.dataset.d); location.hash = "#news"; window.scrollTo(0, 0); });
$("#backCal").onclick = () => { calMonth = cur.slice(0, 7); location.hash = "#cal"; };

function renderOverview() {
  $("#todayLabel").textContent = cur === TODAY ? "오늘 · " + lab(cur) : lab(cur);
  $("#datePick").value = cur; $("#datePick").max = TODAY;
  const f = flags(day);
  const items = [["news", "📰 경제뉴스", (day.news || []).length + "건"], ["diary", "📔 일기", f.diary ? "작성" : "미작성"], ["book", "📚 독서 5장", sheetTxt(pages(day.book))], ["study", "✏️ 공부", (day.study || []).filter(s => s.taskId || s.subject).length + "건"]];
  $("#checks").innerHTML = items.map(([k, t, v]) => `<div class="chk${f[k] ? " done" : ""}"><i class="dot">${f[k] ? "💗" : "🤍"}</i><span class="t">${t}</span><span class="mono muted" style="margin-left:auto">${v}</span></div>`).join("");
  const ym = cur.slice(0, 7); let dd = 0, pg = 0, mins = 0, cs = 0;
  allDays().forEach(x => { if (x.date.slice(0, 7) !== ym) return; if (flags(x).diary) dd++; pg += pages(x.book); mins += sumMin(x); });
  Object.values(cases).forEach(c => { if ((c.date || "").slice(0, 7) === ym) cs++; });
  $("#month").innerHTML = `<span class="muted">${Number(ym.slice(5))}월</span><span>일기 <b>${dd}</b>일</span><span>독서 <b>${sheets(pg)}</b>장</span><span>공부 <b>${(mins / 60).toFixed(1)}</b>시간</span><span>케이스 <b>${cs}</b>개</span>`;
}

/* ---------------- ① 뉴스 ---------------- */
async function loadNews(date) {
  newsPage = 0; openArts.clear();
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
    $("#heads").innerHTML = `<li class="empty" style="border:0">${cur === TODAY ? "오늘 헤드라인은 아직 수집 전이야 (06시쯤 자동 수집)." : "이 날짜의 헤드라인 기록이 없어."} 아래 바로가기로 읽어도 돼.</li>`;
  } else {
    $("#newsStamp").textContent = `${short(news.date)} ${hhmm(news.generatedAt)} 수집`;
    const srcs = news.sources.filter(s => s.items.length);
    if (newsPaper !== "전체" && !srcs.some(s => s.name === newsPaper)) newsPaper = "전체";
    $("#paperChips").innerHTML = ["전체", ...srcs.map(s => s.name)].map(n => `<button class="chip" data-paper="${esc(n)}" aria-pressed="${n === newsPaper}">${esc(n)}</button>`).join("");
    let list;
    if (newsPaper === "전체") {
      // 각 신문 경제면 맨 위(메인) 기사부터 번갈아 10개. 메인 수집이 안 된 신문은 최신 기사로 대신
      list = []; const pick = s => (s.tops && s.tops.length ? s.tops : s.items);
      const seen = new Set();
      for (let r = 0; r < 3 && list.length < perPage(); r++) srcs.forEach(s => { const it = pick(s)[r]; if (it && !seen.has(it.link) && list.length < perPage()) { seen.add(it.link); list.push(Object.assign({ src: s.name, main: !!(s.tops && s.tops.length) }, it)); } });
    } else {
      // 신문사 탭: 메인 기사(⭐)를 맨 위에, 이어서 최신 기사 (같은 기사는 한 번만)
      const src = srcs.find(s => s.name === newsPaper);
      const norm = u => (u || "").split("?")[0].replace(/\/+$/, "");
      const key = t => (t || "").replace(/[\s\[\]"“”'‘’…·]/g, "").slice(0, 18);
      const tops = (src.tops || []).map(i => Object.assign({ src: newsPaper, main: true }, i));
      const seenL = new Set(tops.map(t => norm(t.link))), seenT = new Set(tops.map(t => key(t.title)));
      list = tops.concat(src.items.filter(i => !seenL.has(norm(i.link)) && !seenT.has(key(i.title))).map(i => Object.assign({ src: newsPaper }, i)));
    }
    const PER_PAGE = perPage();
    const pagesN = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (newsPage >= pagesN) newsPage = pagesN - 1;
    const start = newsPage * PER_PAGE, pageList = list.slice(start, start + PER_PAGE);
    const saved = new Set((day.news || []).map(a => a.url));
    $("#heads").innerHTML = pageList.map((it, i) => `<li><span class="n">${String(start + i + 1).padStart(2, "0")}</span><div><a href="${esc(it.link)}" target="_blank" rel="noopener">${it.main ? `<span class="star" title="신문 메인 기사">⭐</span> ` : ""}${esc(it.title)}</a><div class="time">${it.main ? "메인 · " : ""}${esc(it.src)}${it.pubDate ? " · " + hhmm(it.pubDate) : ""}</div></div><button class="add${saved.has(it.link) ? " on" : ""}" data-add="${i}">${saved.has(it.link) ? "✓ 읽음" : "+ 읽음"}</button></li>`).join("");
    $("#heads")._list = pageList;
    $("#pager").hidden = pagesN < 2;
    $("#pageInfo").textContent = `${newsPage + 1} / ${pagesN}`;
    $("#pagePrev").disabled = newsPage === 0;
    $("#pageNext").disabled = newsPage >= pagesN - 1;
  }
  const arts = day.news || [];
  $("#artCount").textContent = arts.length + "건";
  $("#artList").innerHTML = arts.length ? arts.map((a, i) => `<li class="art"><details data-art="${i}" ${openArts.has(i) ? "open" : ""}>
      <summary><span class="artn">${i + 1}.</span><span class="artt">${esc(a.title)}</span>${(a.summary || a.thought || a.memo) ? `<span class="artdot" title="메모 있음">✏️</span>` : ""}</summary>
      <div class="artbody">
        <div class="arthead">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">🔗 기사 열기</a>` : `<span class="muted">링크 없음</span>`}${a.src ? `<span class="muted" style="font-size:12px">${esc(a.src)}</span>` : ""}<button class="x" data-del-art="${i}" aria-label="삭제" style="margin-left:auto">×</button></div>
        <label class="field"><span>📄 본문요약 (중요한 문장 복사해서 붙여넣기)</span><textarea class="artsum" data-sum="${i}" rows="5" placeholder="기사에서 중요한 문장을 복사해서 붙여넣어줘">${esc(a.summary || "")}</textarea></label>
        <label class="field"><span>💭 구나생각</span><textarea class="artth" data-th="${i}" rows="3" placeholder="왜 중요한지, 내 투자·생활에 주는 의미">${esc(a.thought ?? a.memo ?? "")}</textarea></label>
      </div>
    </details></li>`).join("") : `<li class="empty" style="border:0;padding:0">위 헤드라인에서 '+ 읽음'을 누르거나 직접 추가해줘.</li>`;
}
$("#paperChips").addEventListener("click", e => { const b = e.target.closest("[data-paper]"); if (!b) return; newsPaper = b.dataset.paper; newsPage = 0; renderNews(); });
$("#pagePrev").addEventListener("click", () => { if (newsPage > 0) { newsPage--; renderNews(); $("#v-news").scrollIntoView({ block: "start" }); } });
$("#pageNext").addEventListener("click", () => { newsPage++; renderNews(); $("#v-news").scrollIntoView({ block: "start" }); });
$("#heads").addEventListener("click", e => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const it = $("#heads")._list[Number(b.dataset.add)];
  const idx = (day.news || []).findIndex(a => a.url === it.link);
  if (idx >= 0) { day.news.splice(idx, 1); openArts.clear(); } else day.news = (day.news || []).concat([{ title: it.title, url: it.link, src: it.src, summary: "", thought: "" }]);
  saveDay(); renderNews();
});
$("#artForm").addEventListener("submit", e => {
  e.preventDefault();
  const title = $("#artTitle").value.trim(); if (!title) { $("#artTitle").focus(); return; }
  let url = $("#artUrl").value.trim(); if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
  day.news = (day.news || []).concat([{ title, url, summary: $("#artSum").value.trim(), thought: $("#artThought").value.trim() }]);
  $("#artTitle").value = $("#artUrl").value = $("#artSum").value = $("#artThought").value = "";
  saveDay(); renderNews();
});
$("#artList").addEventListener("click", e => { const b = e.target.closest("[data-del-art]"); if (!b) return; day.news.splice(Number(b.dataset.delArt), 1); openArts.clear(); saveDay(); renderNews(); });
$("#artList").addEventListener("toggle", e => { const d = e.target.closest("[data-art]"); if (!d) return; const i = Number(d.dataset.art); d.open ? openArts.add(i) : openArts.delete(i); }, true);
$("#artList").addEventListener("input", e => {
  const sm = e.target.closest("[data-sum]"), th = e.target.closest("[data-th]");
  if (sm) { day.news[Number(sm.dataset.sum)].summary = sm.value; saveDay(); }
  else if (th) { const a = day.news[Number(th.dataset.th)]; a.thought = th.value; delete a.memo; saveDay(); }
});

/* ---------------- ② 일기 (+ 비밀번호 잠금) ---------------- */
// 잠근 일기는 비밀번호로 만든 키로 암호화(AES-GCM)해서 저장. 비밀번호를 잊으면 서버에서도 복구 불가.
const te = new TextEncoder(), td = new TextDecoder();
const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pw, saltB64) {
  const base = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: ub64(saltB64), iterations: 210000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encObj(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)))); return { iv: b64(iv), ct: b64(ct) }; }
async function decObj(key, e) { return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ub64(e.iv) }, key, ub64(e.ct)))); }

let diaryKey = null;       // 이번 접속 동안만 메모리에 보관
let lockIntent = null;     // "lock" | "open"
let lockedDraft = null;    // 잠긴 날 편집 중인 평문 (화면에만)
let encTimer = null;

function diaryMode(m) {   // "edit" | "locked" | "setup"
  $("#diaryEditor").hidden = m !== "edit";
  $("#diaryLockedBox").hidden = m !== "locked";
  $("#diarySetup").hidden = m !== "setup";
  $("#diaryLockRow").hidden = m !== "edit";
  $("#diaryLockCancel").hidden = lockIntent !== "lock";
  $("#openAndUnlock").hidden = lockIntent === "lock";
  const openLocked = m === "edit" && !!day.diaryLocked && !!diaryKey;
  $("#lockChkWrap").hidden = openLocked;
  $("#lockState").hidden = !openLocked;
  $("#unlockDay").hidden = !openLocked;
  $("#relock").hidden = !openLocked;
}
async function fillDiary() {
  const date = cur;
  $("#diaryTitle").textContent = cur === TODAY ? "🌙 오늘 일기" : `🌙 ${lab(cur)} 일기`;
  $("#diaryLockMsg").textContent = ""; $("#diaryPw").value = "";
  lockedDraft = null;
  if (day.diaryLocked) {
    $("#diaryLockChk").checked = true;
    if (!diaryKey) { lockIntent = "open"; $("#diaryLockedTitle").textContent = "🔒 잠긴 일기야"; $("#diaryCount").textContent = "🔒"; diaryMode("locked"); return; }
    try {
      const plain = await decObj(diaryKey, day.diaryEnc);
      if (date !== cur) return;
      lockedDraft = plain;
      $("#diaryOne").value = plain.one || ""; $("#diaryText").value = plain.text || "";
      $("#diaryCount").textContent = (plain.text || "").length + "자 🔓"; diaryMode("edit"); renderDiaryImgs();
    } catch (_) { diaryKey = null; lockIntent = "open"; diaryMode("locked"); $("#diaryLockMsg").textContent = "비밀번호를 다시 입력해줘."; }
    return;
  }
  $("#diaryLockChk").checked = false;
  $("#diaryOne").value = day.diaryOne || ""; $("#diaryText").value = day.diary || "";
  $("#diaryCount").textContent = (day.diary || "").length + "자";
  diaryMode("edit"); renderDiaryImgs();
}

/* 일기 사진: 붙여넣기·끌어놓기·파일 선택. 잠긴 일기는 사진 목록도 암호화 */
const curDiaryImgs = () => day.diaryLocked ? ((lockedDraft && lockedDraft.images) || []) : (day.diaryImages || []);
async function setDiaryImgs(arr) {
  if (day.diaryLocked) {
    if (!diaryKey || !lockedDraft) return;
    lockedDraft = Object.assign({}, lockedDraft, { images: arr });
    day.diaryEnc = await encObj(diaryKey, lockedDraft); saveDay();
  } else { day.diaryImages = arr; saveDay(); }
  renderDiaryImgs(); renderPastDiary();
}
async function renderDiaryImgs() {
  const list = curDiaryImgs(), date = cur;
  await signPaths(list);
  if (date !== cur) return;
  $("#diaryImgs").innerHTML = list.map((p, k) => `<div class="u"><a href="${esc(signed[p] || "")}" target="_blank" rel="noopener"><img src="${esc(signed[p] || "")}" alt="일기 사진 ${k + 1}"></a><button type="button" data-rm-dimg="${k}" aria-label="사진 빼기">×</button></div>`).join("");
}
let diaryUploading = false;
async function uploadDiaryImages(files) {
  if (!files || !files.length || diaryUploading) return;
  if (day.diaryLocked && !diaryKey) return;
  diaryUploading = true;
  const msg = $("#diaryUpMsg"), added = []; let err = "";
  for (const [i, f] of files.entries()) {
    msg.textContent = `올리는 중 ${i + 1}/${files.length}…`;
    if (f.size > 20 * 1024 * 1024) { err = `${f.name}: 20MB 초과`; continue; }
    const ext = ((f.type.split("/")[1] || "").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "")) || "jpg";
    const path = `${user.id}/diary/${cur}/${Date.now()}-${i}.${ext}`;
    const { error } = await sb.storage.from("cases").upload(path, f, { contentType: f.type || "image/jpeg" });
    if (error) err = `${f.name}: ${error.message}`; else added.push(path);
  }
  diaryUploading = false;
  if (added.length) await setDiaryImgs(curDiaryImgs().concat(added));
  msg.textContent = err || (added.length ? `사진 ${added.length}장 추가했어 📷` : "");
}
$("#diaryFile").addEventListener("change", e => { uploadDiaryImages([...e.target.files]); e.target.value = ""; });
$("#diaryImgs").addEventListener("click", async e => {
  const b = e.target.closest("[data-rm-dimg]"); if (!b) return;
  const list = curDiaryImgs().slice(), [gone] = list.splice(Number(b.dataset.rmDimg), 1);
  await setDiaryImgs(list);
  if (gone) sb.storage.from("cases").remove([gone]);
});
(() => {
  const box = $("#diaryPaste");
  box.addEventListener("beforeinput", e => { if (e.inputType !== "insertFromPaste") e.preventDefault(); });
  box.addEventListener("dragover", e => { e.preventDefault(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", e => { e.preventDefault(); box.classList.remove("over"); uploadDiaryImages(imagesFrom(e.dataTransfer)); });
})();
// 일기 화면에서는 어디서든 Ctrl+V로 사진 추가 (글자 붙여넣기는 그대로)
document.addEventListener("paste", e => {
  if ($("#v-diary").hidden || $("#diaryEditor").hidden || !$("#caseModal").hidden) return;
  const files = imagesFrom(e.clipboardData);
  if (!files.length) { if (e.target.closest && e.target.closest("#diaryPaste")) { e.preventDefault(); $("#diaryUpMsg").textContent = "클립보드에 사진이 없어. 사진을 먼저 복사해줘."; } return; }
  e.preventDefault(); uploadDiaryImages(files);
});
function onDiaryInput() {
  const one = $("#diaryOne").value, text = $("#diaryText").value;
  if (day.diaryLocked) {
    if (!diaryKey) return;
    lockedDraft = { one, text, images: (lockedDraft && lockedDraft.images) || [] }; $("#diaryCount").textContent = text.length + "자 🔓";
    clearTimeout(encTimer); status("저장 중…");
    const date = cur, draft = lockedDraft;
    encTimer = setTimeout(async () => { const e = await encObj(diaryKey, draft); if (date === cur && day.diaryLocked) { day.diaryEnc = e; saveDay(); } }, 600);
    return;
  }
  day.diaryOne = one; day.diary = text; $("#diaryCount").textContent = text.length + "자"; saveDay();
}
$("#diaryOne").addEventListener("input", onDiaryInput);
$("#diaryText").addEventListener("input", onDiaryInput);

async function doLock() {
  const plain = { one: $("#diaryOne").value, text: $("#diaryText").value, images: day.diaryImages || [] };
  day.diaryEnc = await encObj(diaryKey, plain);
  day.diaryLocked = true; day.diary = ""; day.diaryOne = ""; delete day.diaryImages;
  saveDay(); renderPastDiary(); fillDiary();
  status("🔒 이 날 일기를 잠갔어");
}
async function doUnlockForever() {
  const plain = lockedDraft || await decObj(diaryKey, day.diaryEnc);
  day.diary = plain.text || ""; day.diaryOne = plain.one || ""; day.diaryImages = plain.images || [];
  delete day.diaryEnc; day.diaryLocked = false;
  saveDay(); renderPastDiary(); fillDiary();
  status("🔓 잠금을 풀었어");
}
$("#diaryLockChk").addEventListener("change", async e => {
  if (e.target.checked) {
    e.target.checked = false;
    if (!settings.diaryLock) { diaryMode("setup"); $("#pw1").focus(); return; }
    if (diaryKey) { await doLock(); return; }
    lockIntent = "lock"; $("#diaryLockedTitle").textContent = "🔒 잠그려면 일기 비밀번호를 입력해줘"; diaryMode("locked"); $("#diaryPw").focus();
  } else {
    e.target.checked = true;
    if (diaryKey) await doUnlockForever();
  }
});
$("#diaryUnlockForm").addEventListener("submit", e => { e.preventDefault(); tryPassword(false); });
$("#openAndUnlock").addEventListener("click", () => tryPassword(true));
$("#unlockDay").addEventListener("click", () => { if (diaryKey) doUnlockForever(); });
async function tryPassword(unlockAfter) {
  const pw = $("#diaryPw").value; if (!pw) { $("#diaryPw").focus(); $("#diaryLockMsg").textContent = "비밀번호를 입력해줘."; return; }
  if (!settings.diaryLock) return;
  $("#diaryLockMsg").textContent = "확인 중…";
  try {
    const key = await deriveKey(pw, settings.diaryLock.salt);
    await decObj(key, settings.diaryLock.check);
    diaryKey = key; $("#diaryPw").value = "";
    if (lockIntent === "lock") { diaryMode("edit"); await doLock(); }
    else if (unlockAfter) { await doUnlockForever(); }
    else { await fillDiary(); renderPastDiary(); }
  } catch (_) { $("#diaryLockMsg").textContent = "비밀번호가 달라 🙅"; }
}
$("#diaryLockCancel").addEventListener("click", () => { if (lockIntent === "lock") diaryMode("edit"); });
$("#diarySetupForm").addEventListener("submit", async e => {
  e.preventDefault();
  const a = $("#pw1").value, b = $("#pw2").value;
  if (a.length < 4) { $("#setupMsg").textContent = "4자 이상으로 만들어줘."; return; }
  if (a !== b) { $("#setupMsg").textContent = "두 번 입력한 비밀번호가 달라."; return; }
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  diaryKey = await deriveKey(a, salt);
  settings.diaryLock = { salt, check: await encObj(diaryKey, "ok") };
  saveSettings(); $("#pw1").value = $("#pw2").value = ""; $("#setupMsg").textContent = "";
  diaryMode("edit"); await doLock();
});
$("#diarySetupCancel").addEventListener("click", () => diaryMode("edit"));
$("#relock").addEventListener("click", () => { diaryKey = null; fillDiary(); renderPastDiary(); status("🔒 다시 잠갔어"); });

// 지난 일기 달력: 일기를 쓴 날만 초록 형광펜
let diaryMonth = null;
function diaryWritten(x) { return !!x && (x.diaryLocked || (x.diaryImages || []).length || (x.diary || "").trim() || (x.diaryOne || "").trim()); }
function renderPastDiary() {
  const about = cur, lastDay = TODAY;
  if (!diaryMonth) diaryMonth = about.slice(0, 7);
  const [y, m] = diaryMonth.split("-").map(Number);
  const first = `${diaryMonth}-01`, lead = wd(first), nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let html = "", count = 0;
  for (let i = 0; i < lead; i++) html += `<span class="d blank"></span>`;
  for (let i = 1; i <= nDays; i++) {
    const d = `${diaryMonth}-${String(i).padStart(2, "0")}`, rec = days[d], w = wd(d), fut = d > lastDay;
    const ok = !fut && diaryWritten(rec); if (ok) count++;
    html += `<button class="d${ok ? " dfilled" : ""}${d === about ? " sel" : ""}${fut ? " future" : ""}${w === 0 ? " sun" : w === 6 ? " sat" : ""}" data-dd="${d}" ${fut ? "disabled" : ""} title="${lab(d)}${ok ? (rec.diaryLocked ? " · 잠긴 일기" : " · " + (rec.diaryOne || "일기 있음")) : ""}"><span class="num">${i}</span>${ok && rec.diaryLocked ? `<span class="stk" aria-hidden="true">🔒</span>` : ""}</button>`;
  }
  $("#pastDiary").innerHTML = `<div class="calhead dcalhead">
      <button class="btn ghost navbtn" data-dmove="-1" aria-label="이전 달">‹</button>
      <h3>${y}년 ${m}월</h3>
      <button class="btn ghost navbtn" data-dmove="1" aria-label="다음 달" ${diaryMonth >= lastDay.slice(0, 7) ? "disabled" : ""}>›</button>
      <span class="muted" style="margin-left:auto;font-size:13px">${count}일 썼어</span>
    </div>
    <div class="calweek"><span class="sun">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span class="sat">토</span></div>
    <div class="calgrid dcal">${html}</div>
    <div class="muted" style="font-size:12.5px">날짜를 누르면 그날 일기가 위에 열려. 🔒는 잠긴 일기야.</div>`;
}
$("#pastDiary").addEventListener("click", e => {
  const mv = e.target.closest("[data-dmove]");
  if (mv) { const [y, m] = diaryMonth.split("-").map(Number); diaryMonth = new Date(Date.UTC(y, m - 1 + Number(mv.dataset.dmove), 1)).toISOString().slice(0, 7); renderPastDiary(); return; }
  const b = e.target.closest("[data-dd]"); if (!b || b.disabled) return;
  diaryMonth = b.dataset.dd.slice(0, 7);
  setDate(b.dataset.dd);
  $("#v-diary").scrollIntoView({ behavior: "smooth", block: "start" });
});

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
  const p = pages(day.book); $("#pageTally").textContent = `${sheets(p)} / ${GOAL_SHEETS}장 (${p}쪽)`;
  $("#pageMeter").firstElementChild.style.width = Math.min(100, p / (GOAL_SHEETS * 2) * 100) + "%";
  $("#pageMeter").classList.toggle("full", p >= GOAL_SHEETS * 2);
}
function renderBooks() {
  const list = allDays().filter(x => x.book && (x.book.title || pages(x.book)));
  $("#bookRows").innerHTML = list.length ? list.slice(0, 90).map(x => `<tr><td class="num">${short(x.date)}</td><td>${esc(x.book.title)}</td><td class="num">${x.book.from || "?"}–${x.book.to || "?"} <span class="muted">(${pages(x.book)}쪽·${sheetTxt(pages(x.book))})</span></td><td>${esc(x.book.quote)}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">기록이 쌓이면 여기에 표로 보여.</td></tr>`;
  $("#bookList").innerHTML = [...new Set(list.map(x => x.book.title).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join("");
}
[["#bookTitle", "title"], ["#bookFrom", "from"], ["#bookTo", "to"], ["#bookQuote", "quote"], ["#bookNote", "note"]].forEach(([s, k]) => {
  $(s).addEventListener("input", e => { day.book[k] = e.target.value; updateMeter(); saveDay(); });
});
$("#bookTitle").addEventListener("focus", e => { const ph = e.target.placeholder; if (!e.target.value && ph && ph !== "읽고 있는 책") { e.target.value = ph; day.book.title = ph; saveDay(); } });
$("#bookFrom").addEventListener("focus", e => { const ph = e.target.placeholder; if (e.target.value === "" && ph) { e.target.value = ph; day.book.from = ph; updateMeter(); saveDay(); } });

/* ---------------- ④ 공부: 목표별 달성도 ---------------- */
const SETTINGS_DATE = "1970-01-01";   // 목표 목록은 days 테이블의 이 날짜 행에 보관
let settings = { goals: [] };
function saveSettings() { queueDay(SETTINGS_DATE, settings, 300); }
const goals = () => settings.goals || (settings.goals = []);
const findTask = id => { for (const g of goals()) for (const t of g.tasks || []) if (t.id === id) return { g, t }; return null; };
function logsFor(taskId) {
  const out = [];
  allDays().forEach(x => (x.study || []).forEach(s => { if (s.taskId === taskId) out.push(Object.assign({ date: x.date }, s)); }));
  return out;
}
function mergeRanges(rs) {
  rs = rs.filter(r => r[1] >= r[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  rs.forEach(r => { const l = out[out.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); });
  return out;
}
function taskStat(t) {
  const logs = logsFor(t.id), mins = logs.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
  if (t.type === "pages") {
    const S = Number(t.start) || 1, E = Number(t.end) || S, total = E - S + 1;
    const ranges = mergeRanges(logs.filter(s => s.from !== "" && s.to !== "" && s.from != null).map(s => [Math.max(S, Number(s.from)), Math.min(E, Number(s.to))]));
    const covered = ranges.reduce((a, r) => a + r[1] - r[0] + 1, 0);
    const maxTo = logs.reduce((a, s) => Math.max(a, Number(s.to) || 0), 0);
    const next = Math.min(E, Math.max(S, maxTo + 1));
    return { pct: total > 0 ? covered / total : 0, mins, logs, ranges, covered, total, next, S, E };
  }
  if (t.type === "count") {
    const n = logs.reduce((a, s) => a + (Number(s.count) || 0), 0), target = Number(t.target) || 1;
    return { pct: Math.min(1, n / target), mins, logs, n, target };
  }
  const done = !!t.done || logs.some(s => s.complete);
  return { pct: done ? 1 : 0, mins, logs, done };
}
function goalStat(g) {
  const ts = (g.tasks || []).map(taskStat);
  return { pct: ts.length ? ts.reduce((a, s) => a + s.pct, 0) / ts.length : 0, mins: ts.reduce((a, s) => a + s.mins, 0), ts };
}
const pctTxt = p => Math.round(p * 100) + "%";
const minTxt = m => m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? " " + (m % 60) + "분" : ""}` : `${m}분`;
function dday(d) {
  if (!d) return "";
  const diff = Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(TODAY + "T00:00:00Z")) / 864e5);
  return diff > 0 ? `D-${diff}` : diff === 0 ? "D-DAY" : `D+${-diff}`;
}
function rangeTxt(rs) { return rs.length ? rs.map(r => r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`).join(", ") + "쪽" : "아직 없음"; }
function logLine(s) {
  const what = s.from != null && s.from !== "" ? `${s.from}–${s.to}쪽` : s.count ? `${s.count}개` : s.complete ? "완료 ✔" : "";
  return `<li><span class="mono muted">${short(s.date)}</span> ${esc(what)} ${s.minutes ? `<span class="muted">· ${minTxt(Number(s.minutes))}</span>` : ""}${s.content ? `<div class="lmemo">${esc(s.content)}</div>` : ""}</li>`;
}

let openForm = null; // "goal" | "goal:<id>" | "task:<goalId>"
function renderGoals() {
  const gs = goals();
  let html = "";
  if (openForm === "goal") html += goalFormHtml(null);
  if (!gs.length && openForm !== "goal") html += `<div class="empty">🎯 첫 목표를 만들어봐. 예: 유방초음파 전문방사선사 시험</div>`;
  gs.forEach((g, gi) => {
    if (openForm === "goal:" + g.id) { html += goalFormHtml(g); return; }
    const st = goalStat(g);
    html += `<div class="goal" data-goal="${g.id}">
      <div class="ghead"><h3>🎯 ${esc(g.title)}</h3>${g.examDate ? `<span class="dday" title="${esc(g.examDate)}">${dday(g.examDate)}</span>` : ""}<span class="gpct">${pctTxt(st.pct)}</span></div>
      <div class="meter big${st.pct >= 1 ? " full" : ""}"><i style="width:${st.pct * 100}%"></i></div>
      <div class="gmeta muted">할 일 ${(g.tasks || []).length}개 · 누적 ${minTxt(st.mins)}${g.examDate ? ` · 시험일 ${short(g.examDate)}` : ""}</div>
      <ol class="tasks">${(g.tasks || []).map((t, ti) => {
        const s = st.ts[ti];
        const meta = t.type === "pages" ? `📖 ${s.covered}/${s.total}쪽 (범위 ${s.S}–${s.E}쪽) · 읽은 곳 ${rangeTxt(s.ranges)}${s.pct < 1 ? ` · <b>다음 ${s.next}쪽부터</b>` : ""}`
          : t.type === "count" ? `🔢 ${s.n}/${s.target}${esc(t.unit || "개")}` : (s.done ? "✔ 완료" : "☐ 아직");
        return `<li class="task${s.pct >= 1 ? " done" : ""}">
          <div class="trow"><span class="tname">${esc(t.name)}</span><span class="tpct">${pctTxt(s.pct)}</span></div>
          <div class="meter sm${s.pct >= 1 ? " full" : ""}"><i style="width:${s.pct * 100}%"></i></div>
          <div class="tmeta">${meta}</div>
          <div class="tact">
            ${t.type === "check" ? `<button class="mini" data-toggle-task="${t.id}">${s.done ? "완료 취소" : "완료 체크 ✔"}</button>` : ""}
            <button class="mini" data-log-task="${t.id}">✏️ 오늘 기록</button>
            ${s.logs.length ? `<details class="tlogs"><summary>기록 ${s.logs.length}회 · ${minTxt(s.mins)}</summary><ul>${s.logs.map(logLine).join("")}</ul></details>` : ""}
            <button class="x" data-del-task="${g.id}|${t.id}" aria-label="할 일 삭제">×</button>
          </div></li>`;
      }).join("")}</ol>
      ${openForm === "task:" + g.id ? taskFormHtml(g.id) : ""}
      <div class="gact">
        ${openForm === "task:" + g.id ? "" : `<button class="btn" data-open="task:${g.id}">+ 할 일 추가</button>`}
        <button class="linkbtn" data-open="goal:${g.id}">목표 수정</button>
        <button class="linkbtn" data-del-goal="${g.id}">삭제</button>
      </div>
      <div class="gconfirm" id="gconf-${g.id}"></div>
    </div>`;
  });
  $("#goals").innerHTML = html;
  $("#newGoal").hidden = openForm === "goal";
}
function goalFormHtml(g) {
  return `<form class="gform" data-goal-form="${g ? g.id : ""}">
    <label class="field"><span>목표 이름</span><input type="text" name="title" required value="${esc(g ? g.title : "")}" placeholder="예: 유방초음파 전문방사선사 시험"></label>
    <label class="field"><span>시험일·마감일 (선택)</span><input type="date" name="examDate" value="${esc(g ? g.examDate || "" : "")}"></label>
    <div style="display:flex;gap:8px"><button class="btn primary" type="submit">${g ? "저장" : "목표 만들기"}</button><button class="btn ghost" type="button" data-open="">취소</button></div>
  </form>`;
}
function taskFormHtml(gid) {
  return `<form class="gform" data-task-form="${gid}">
    <label class="field"><span>해야 할 일</span><input type="text" name="name" required placeholder="예: 유방초음파진단학 1회독 + 나만의 노트"></label>
    <div class="seg" role="radiogroup">
      <label><input type="radio" name="type" value="pages" checked> 📖 쪽수로</label>
      <label><input type="radio" name="type" value="count"> 🔢 개수로</label>
      <label><input type="radio" name="type" value="check"> ☑️ 체크만</label>
    </div>
    <div class="row tf-pages"><label class="field"><span>시작 쪽</span><input type="number" name="start" min="0" value="1"></label><label class="field"><span>끝 쪽</span><input type="number" name="end" min="1" placeholder="예: 420"></label></div>
    <div class="row tf-count" hidden><label class="field"><span>목표 개수</span><input type="number" name="target" min="1" placeholder="예: 300"></label><label class="field"><span>단위</span><input type="text" name="unit" placeholder="문항, 강, 회"></label></div>
    <div style="display:flex;gap:8px"><button class="btn primary" type="submit">추가</button><button class="btn ghost" type="button" data-open="">취소</button></div>
  </form>`;
}
$("#newGoal").addEventListener("click", () => { openForm = "goal"; renderGoals(); });
$("#goals").addEventListener("change", e => {
  const f = e.target.closest("[data-task-form]"); if (!f || e.target.name !== "type") return;
  f.querySelector(".tf-pages").hidden = e.target.value !== "pages";
  f.querySelector(".tf-count").hidden = e.target.value !== "count";
});
$("#goals").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  if (f.dataset.goalForm !== undefined) {
    const title = (fd.get("title") || "").trim(); if (!title) return;
    if (f.dataset.goalForm) { const g = goals().find(x => x.id === f.dataset.goalForm); g.title = title; g.examDate = fd.get("examDate") || ""; }
    else goals().push({ id: uuid(), title, examDate: fd.get("examDate") || "", tasks: [] });
  } else if (f.dataset.taskForm) {
    const g = goals().find(x => x.id === f.dataset.taskForm), type = fd.get("type");
    const name = (fd.get("name") || "").trim(); if (!name) return;
    const t = { id: uuid(), name, type };
    if (type === "pages") { t.start = Number(fd.get("start")) || 1; t.end = Number(fd.get("end")) || 0; if (t.end < t.start) { f.querySelector("[name=end]").focus(); return; } }
    if (type === "count") { t.target = Number(fd.get("target")) || 0; t.unit = (fd.get("unit") || "").trim() || "개"; if (!t.target) { f.querySelector("[name=target]").focus(); return; } }
    if (type === "check") t.done = false;
    g.tasks = (g.tasks || []).concat([t]);
  }
  openForm = null; saveSettings(); renderGoals(); renderLogForm();
});
$("#goals").addEventListener("click", e => {
  const o = e.target.closest("[data-open]");
  if (o) { openForm = o.dataset.open || null; renderGoals(); return; }
  const tg = e.target.closest("[data-toggle-task]");
  if (tg) { const r = findTask(tg.dataset.toggleTask); r.t.done = !r.t.done; saveSettings(); renderGoals(); return; }
  const lg = e.target.closest("[data-log-task]");
  if (lg) { $("#logTask").value = lg.dataset.logTask; renderLogFields(); $("#logPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const dt = e.target.closest("[data-del-task]");
  if (dt) {
    const [gid, tid] = dt.dataset.delTask.split("|"); const g = goals().find(x => x.id === gid);
    const box = $("#gconf-" + gid);
    box.innerHTML = `<div class="confirm notice">할 일을 지울까? 날짜별 공부 기록은 남아 있어. <button class="btn danger" data-yes-task="${gid}|${tid}">삭제</button><button class="btn ghost" data-open="">취소</button></div>`;
    return;
  }
  const yt = e.target.closest("[data-yes-task]");
  if (yt) { const [gid, tid] = yt.dataset.yesTask.split("|"); const g = goals().find(x => x.id === gid); g.tasks = g.tasks.filter(t => t.id !== tid); saveSettings(); renderGoals(); renderLogForm(); return; }
  const dg = e.target.closest("[data-del-goal]");
  if (dg) { $("#gconf-" + dg.dataset.delGoal).innerHTML = `<div class="confirm notice">목표와 할 일 목록을 지울까? <button class="btn danger" data-yes-goal="${dg.dataset.delGoal}">삭제</button><button class="btn ghost" data-open="">취소</button></div>`; return; }
  const yg = e.target.closest("[data-yes-goal]");
  if (yg) { settings.goals = goals().filter(g => g.id !== yg.dataset.yesGoal); saveSettings(); renderGoals(); renderLogForm(); }
});

/* 오늘 공부 기록 */
function renderLogForm() {
  const opts = goals().map(g => `<optgroup label="🎯 ${esc(g.title)}">${(g.tasks || []).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</optgroup>`).join("");
  const keep = $("#logTask").value;
  $("#logTask").innerHTML = `<option value="">— 할 일 선택 (없으면 자유 기록) —</option>${opts}`;
  if (keep && findTask(keep)) $("#logTask").value = keep;
  renderLogFields();
}
function renderLogFields() {
  const r = findTask($("#logTask").value), box = $("#logFields");
  $("#logSubjectWrap").hidden = !!r;
  if (!r) { box.innerHTML = ""; return; }
  const s = taskStat(r.t);
  if (r.t.type === "pages") box.innerHTML = `<div class="row"><label class="field"><span>몇 쪽부터</span><input type="number" id="logFrom" min="0" value="${s.next}"></label><label class="field"><span>몇 쪽까지</span><input type="number" id="logTo" min="0" placeholder="${Math.min(s.E, s.next + 9)}"></label></div><div class="muted" style="font-size:12.5px">범위 ${s.S}–${s.E}쪽 · 지금까지 ${s.covered}쪽 (${pctTxt(s.pct)})</div>`;
  else if (r.t.type === "count") box.innerHTML = `<label class="field"><span>오늘 한 ${esc(r.t.unit || "개")} 수</span><input type="number" id="logCount" min="1"></label><div class="muted" style="font-size:12.5px">지금까지 ${s.n}/${s.target}${esc(r.t.unit || "개")}</div>`;
  else box.innerHTML = `<label class="chkline"><input type="checkbox" id="logComplete"> 오늘 이 할 일을 끝냈어</label>`;
}
$("#logTask").addEventListener("change", renderLogFields);
$("#logForm").addEventListener("submit", e => {
  e.preventDefault();
  const r = findTask($("#logTask").value);
  const entry = { minutes: $("#logMin").value, content: $("#logMemo").value.trim() };
  if (r) {
    entry.taskId = r.t.id; entry.goalId = r.g.id; entry.subject = r.t.name;
    if (r.t.type === "pages") { const f = $("#logFrom").value, t = $("#logTo").value; if (f === "" || t === "" || Number(t) < Number(f)) { $("#logTo").focus(); return; } entry.from = Number(f); entry.to = Number(t); }
    if (r.t.type === "count") { const c = Number($("#logCount").value); if (!c) { $("#logCount").focus(); return; } entry.count = c; }
    if (r.t.type === "check") entry.complete = $("#logComplete").checked;
  } else {
    entry.subject = $("#logSubject").value.trim();
    if (!entry.subject && !entry.content) { $("#logSubject").focus(); return; }
  }
  day.study = (day.study || []).filter(s => s.taskId || (s.subject || "").trim() || (s.content || "").trim() || s.minutes).concat([entry]);
  $("#logMin").value = ""; $("#logMemo").value = ""; $("#logSubject").value = "";
  saveDay(); fillStudy(); renderGoals(); renderLogFields(); renderPastStudy();
});
function fillStudy() {
  $("#logDateTitle").textContent = cur === TODAY ? "✏️ 오늘 공부 기록" : `✏️ ${lab(cur)} 공부 기록`;
  const list = (day.study || []).filter(s => s.taskId || (s.subject || "").trim() || (s.content || "").trim() || s.minutes);
  $("#studyTotal").textContent = minTxt(sumMin(day));
  $("#studyItems").innerHTML = list.length ? list.map((s, i) => {
    const r = s.taskId ? findTask(s.taskId) : null;
    const what = s.from != null && s.from !== "" ? `${s.from}–${s.to}쪽` : s.count ? `${s.count}${esc((r && r.t.unit) || "개")}` : s.complete ? "완료 ✔" : "";
    return `<li><div class="body"><b>${esc(r ? r.t.name : s.subject || "자유 공부")}</b> ${what ? `<span class="pill">${what}</span>` : ""} ${s.minutes ? `<span class="muted">· ${minTxt(Number(s.minutes))}</span>` : ""}${r ? `<div class="muted" style="font-size:12.5px">🎯 ${esc(r.g.title)}</div>` : ""}${s.content ? `<div class="lmemo">${esc(s.content)}</div>` : ""}</div><button class="x" data-del-log="${i}" aria-label="기록 삭제">×</button></li>`;
  }).join("") : `<li class="empty" style="border:0;padding:0">아직 기록이 없어. 아래에서 할 일을 고르고 몇 쪽 했는지 적어줘 📝</li>`;
  $("#studyItems")._list = list;
}
$("#studyItems").addEventListener("click", e => {
  const b = e.target.closest("[data-del-log]"); if (!b) return;
  const target = $("#studyItems")._list[Number(b.dataset.delLog)];
  day.study = (day.study || []).filter(s => s !== target);
  saveDay(); fillStudy(); renderGoals(); renderLogFields(); renderPastStudy();
});
function renderPastStudy() {
  const past = allDays().filter(x => x.date !== cur && flags(x).study).slice(0, 20);
  $("#pastStudy").innerHTML = past.length ? past.map(x => `<details class="past"><summary><span class="mono muted">${short(x.date)}</span> ${esc(x.study.map(s => s.subject).filter(Boolean).join(" · "))} <span class="muted mono">${minTxt(sumMin(x))}</span></summary><ul class="plain">${x.study.map(s => logLine(Object.assign({ date: x.date }, s)).replace("<li>", "<li><b>" + esc(s.subject || "") + "</b> ")).join("")}</ul></details>`).join("") : `<div class="empty">지난 공부 기록이 쌓이면 여기에 보여.</div>`;
}
function renderStudy() { renderGoals(); renderLogForm(); renderPastStudy(); }

/* ---------------- ⑤ 영어 (듀오링고 문장·단어장) ---------------- */
const VOCAB_DATE = "1970-01-02";   // 단어장은 날짜와 상관없이 쌓이므로 days 테이블의 이 행에 보관
let vocab = { words: [], sentences: [] };
let engKind = "sentences", engFilter = "todo", engHide = false;
const openEng = new Set();
function saveVocab() { queueDay(VOCAB_DATE, vocab, 300); }
const engList = () => vocab[engKind] || (vocab[engKind] = []);
function renderEnglish() {
  const ws = vocab.words || [], ss = vocab.sentences || [];
  $("#engTabs").innerHTML = [["sentences", "📝 문장", ss], ["words", "🔤 단어", ws]].map(([k, t, l]) =>
    `<button class="chip" data-ekind="${k}" aria-pressed="${engKind === k}">${t} <span class="mono">${l.filter(x => !x.done).length}/${l.length}</span></button>`).join("");
  $("#engFilter").innerHTML = [["todo", "외울 것"], ["done", "외운 것 ✓"], ["all", "전체"]].map(([k, t]) =>
    `<button class="chip" data-efilter="${k}" aria-pressed="${engFilter === k}">${t}</button>`).join("");
  $("#engHide").setAttribute("aria-pressed", engHide);
  $("#engHide").textContent = engHide ? "🙈 뜻 가리는 중" : "👀 뜻 가리기";
  const isS = engKind === "sentences";
  $("#engEn").placeholder = isS ? "영어 문장 (예: I would like a cup of coffee.)" : "영어 단어 (예: grateful)";
  $("#engKo").placeholder = isS ? "뜻 (예: 커피 한 잔 주세요.)" : "뜻 (예: 감사하는)";
  $("#engFormTitle").textContent = isS ? "📝 문장 추가" : "🔤 단어 추가";
  const q = $("#engSearch").value.trim().toLowerCase();
  const list = engList().map((x, i) => Object.assign({ i }, x))
    .filter(x => engFilter === "all" || (engFilter === "done" ? x.done : !x.done))
    .filter(x => !q || [x.en, x.ko, x.note].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.i - a.i);
  const todayN = engList().filter(x => x.date === TODAY).length;
  $("#engStat").textContent = `오늘 ${todayN}개 추가 · 총 ${engList().length}개`;
  $("#engList").innerHTML = list.length ? list.map((x, n) => `<li class="eng${x.done ? " done" : ""}" data-ei="${x.i}">
      <div class="erow">
        <span class="en-n">${n + 1}.</span>
        <div class="etext">
          <div class="en">${esc(x.en)}</div>
          <button type="button" class="ko${engHide && !openEng.has(x.i) ? " hid" : ""}" data-reveal="${x.i}">${engHide && !openEng.has(x.i) ? "눌러서 뜻 보기" : esc(x.ko || "")}</button>
          ${x.note ? `<div class="enote">${esc(x.note)}</div>` : ""}
          <div class="edate">${short(x.date || TODAY)}</div>
        </div>
        <div class="eact">
          <button type="button" class="mini${x.done ? " on" : ""}" data-edone="${x.i}">${x.done ? "✓ 외움" : "외웠어"}</button>
          <button type="button" class="x" data-edel="${x.i}" aria-label="삭제">×</button>
        </div>
      </div></li>`).join("")
    : `<li class="empty">${engList().length ? "조건에 맞는 항목이 없어." : isS ? "듀오링고에서 외우고 싶은 문장을 위에 적어줘 🦉" : "모르는 단어를 위에 적어줘 🔤"}</li>`;
}
$("#engTabs").addEventListener("click", e => { const b = e.target.closest("[data-ekind]"); if (!b) return; engKind = b.dataset.ekind; openEng.clear(); renderEnglish(); });
$("#engFilter").addEventListener("click", e => { const b = e.target.closest("[data-efilter]"); if (!b) return; engFilter = b.dataset.efilter; renderEnglish(); });
$("#engHide").addEventListener("click", () => { engHide = !engHide; openEng.clear(); renderEnglish(); });
$("#engSearch").addEventListener("input", renderEnglish);
$("#engForm").addEventListener("submit", e => {
  e.preventDefault();
  const en = $("#engEn").value.trim(), ko = $("#engKo").value.trim(), note = $("#engNote").value.trim();
  if (!en) { $("#engEn").focus(); return; }
  engList().push({ en, ko, note, date: TODAY, done: false });
  $("#engEn").value = $("#engKo").value = $("#engNote").value = "";
  if (engFilter === "done") engFilter = "todo";
  saveVocab(); renderEnglish(); $("#engEn").focus();
});
$("#engList").addEventListener("click", e => {
  const r = e.target.closest("[data-reveal]");
  if (r && engHide) { const i = Number(r.dataset.reveal); openEng.has(i) ? openEng.delete(i) : openEng.add(i); renderEnglish(); return; }
  const d = e.target.closest("[data-edone]");
  if (d) { const x = engList()[Number(d.dataset.edone)]; x.done = !x.done; saveVocab(); renderEnglish(); return; }
  const del = e.target.closest("[data-edel]");
  if (del) {
    const i = Number(del.dataset.edel), li = del.closest("li");
    if (li.querySelector(".econfirm")) return;
    li.insertAdjacentHTML("beforeend", `<div class="econfirm confirm">지울까? <button class="btn danger" data-eyes="${i}">삭제</button><button class="btn ghost" data-eno>취소</button></div>`);
    return;
  }
  const y = e.target.closest("[data-eyes]");
  if (y) { engList().splice(Number(y.dataset.eyes), 1); openEng.clear(); saveVocab(); renderEnglish(); return; }
  if (e.target.closest("[data-eno]")) renderEnglish();
});

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
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
function openCase(id, editing) {
  const src = id ? cases[id] : null;
  editCase = { isNew: !src, data: src ? JSON.parse(JSON.stringify(src)) : { id: uuid(), date: TODAY, title: "", region: "갑상선", findings: "", impression: "", memo: "", tags: [], images: [] } };
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
      <div class="pastebox" id="cPaste" contenteditable="true" role="textbox" aria-label="이미지 붙여넣기 칸" inputmode="none">
        <b>여기에 이미지 붙여넣기</b>
        <span>PC: 복사 후 Ctrl+V (⌘V) · 폰: 이 칸을 길게 눌러 '붙여넣기' · 끌어다 놓기도 돼</span>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px">
        <label class="linkbtn" style="cursor:pointer">파일에서 선택<input type="file" id="cFile" accept="image/*" multiple hidden></label>
        <span class="muted" style="font-size:12.5px" id="cUpMsg">한 장당 20MB까지</span>
      </div>
    </div>
    <div id="cConfirm"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between">
      <div style="display:flex;gap:8px"><button class="btn primary" data-act="save">저장</button><button class="btn ghost" data-act="close">취소</button></div>
      ${editCase.isNew ? "" : `<button class="btn danger" data-act="del">삭제</button>`}
    </div>`;
  $("#cFile").addEventListener("change", e => uploadFiles([...e.target.files]));
  const box = $("#cPaste");
  // 붙여넣기 칸에 글자가 들어가지 않게
  box.addEventListener("beforeinput", e => { if (e.inputType !== "insertFromPaste") e.preventDefault(); });
  box.addEventListener("dragover", e => { e.preventDefault(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", e => { e.preventDefault(); box.classList.remove("over"); uploadFiles(imagesFrom(e.dataTransfer)); });
}
function imagesFrom(dt) {
  if (!dt) return [];
  let files = [...(dt.files || [])].filter(f => f.type.startsWith("image/"));
  if (!files.length && dt.items) files = [...dt.items].filter(i => i.kind === "file" && i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean);
  return files;
}
// 케이스 편집 화면이 열려 있으면 어디서든 Ctrl+V로 이미지 추가
document.addEventListener("paste", e => {
  if ($("#caseModal").hidden || !$("#cPaste")) return;
  const files = imagesFrom(e.clipboardData);
  if (!files.length) { if (e.target.closest && e.target.closest("#cPaste")) { e.preventDefault(); $("#cUpMsg").textContent = "클립보드에 이미지가 없어. 이미지를 먼저 복사해줘."; } return; }
  e.preventDefault();
  uploadFiles(files);
});
function readForm() {
  const c = editCase.data;
  c.date = $("#cDate").value || TODAY; c.region = $("#cRegion").value; c.title = $("#cTitle").value.trim();
  c.findings = $("#cFind").value; c.impression = $("#cImp").value; c.memo = $("#cMemo").value;
  c.tags = $("#cTags").value.split(",").map(s => s.trim()).filter(Boolean);
}
let uploading = false;
async function uploadFiles(files) {
  if (!files || !files.length || uploading) return;
  uploading = true;
  readForm(); const msg = $("#cUpMsg"); let err = "";
  for (const [i, f] of files.entries()) {
    msg.textContent = `올리는 중 ${i + 1}/${files.length}…`;
    if (f.size > 20 * 1024 * 1024) { err = `${f.name}: 20MB 초과`; continue; }
    const fromType = (f.type.split("/")[1] || "").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "");
    const ext = fromType || (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${user.id}/${editCase.data.id}/${Date.now()}-${i}.${ext}`;
    const { error } = await sb.storage.from("cases").upload(path, f, { contentType: f.type || "image/jpeg" });
    if (error) err = `${f.name}: ${error.message}`; else editCase.data.images.push(path);
  }
  uploading = false;
  await renderCaseSheet(true);
  $("#cUpMsg").textContent = err || `이미지 ${editCase.data.images.length}장 · 저장을 눌러야 케이스에 반영돼`;
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


/* ---------------- 명언 ---------------- */
// 규나가 대화에서 컨펌한 명언만 여기에 추가. 하루에 하나, 날짜마다 랜덤(같은 날엔 같은 명언).
const QUOTES = [
  { t: "무슨 일이든 할 수 있다고 생각하는 사람이 해내는 법이다. 의심하면 의심하는 만큼밖에는 못하고, 할 수 없다고 생각하면 할 수 없다.", a: "아산 정주영, 주베일 산업항 공사 현장에서" },
  { t: "아는 것을 안다 하고 모르는 것을 모른다 하는 것, 이것이 아는 것이다.", a: "공자, 『논어』 위정편" },
  { t: "배우기만 하고 생각하지 않으면 얻는 게 없고, 생각만 하고 배우지 않으면 위태롭다.", a: "공자, 『논어』 위정편" },
  { t: "배움은 따라가지 못할 듯이 하고, 이미 배운 것은 잃을까 두려워하라.", a: "공자, 『논어』 태백편" },
  { t: "서두르면 이르지 못하고, 작은 이익을 보면 큰일을 이루지 못한다.", a: "공자, 『논어』 자로편" },
  { t: "남이 나를 알아주지 않음을 걱정하지 말고, 내가 남을 알지 못함을 걱정하라.", a: "공자, 『논어』 학이편" },
  { t: "군자는 잘못을 자신에게서 찾고, 소인은 남에게서 찾는다.", a: "공자, 『논어』 위령공편" },
  { t: "잘못하고도 고치지 않는 것, 그것이 진짜 잘못이다.", a: "공자, 『논어』 위령공편" },
  { t: "내가 원하지 않는 일을 남에게 시키지 마라.", a: "공자, 『논어』 안연편" },
  { t: "우리가 반복적으로 하는 행동이 곧 우리다. 탁월함은 행위가 아니라 습관이다.", a: "윌 듀랜트 (아리스토텔레스 해설)" },
  { t: "위대한 일을 하는 유일한 방법은 자신이 하는 일을 사랑하는 것이다.", a: "스티브 잡스, 2005 스탠퍼드 연설" },
  { t: "성공은 매일 반복한 작은 노력들의 합이다.", a: "로버트 콜리어" },
];
// 명언 n개를 섞은 순서대로 하루 하나씩 → n일 동안 겹치지 않고, 한 바퀴 돌면 새로 섞음
function dailyQuoteIndex(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayNum = Math.floor(Date.UTC(y, m - 1, d) / 864e5);
  const cycle = Math.floor(dayNum / n), pos = dayNum % n;
  let seed = (cycle * 2654435761 + 12345) >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const order = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order[pos];
}
let quoteIdx = null;   // null = 오늘의 명언, 숫자 = 새로고침으로 고른 명언
function renderQuote() {
  const el = $("#quoteLine"), btn = $("#quoteRefresh");
  if (!QUOTES.length) { el.hidden = true; btn.hidden = true; return; }
  if (quoteIdx === null) quoteIdx = dailyQuoteIndex(TODAY, QUOTES.length);
  const q = QUOTES[quoteIdx];
  el.innerHTML = `<span class="qt">“${esc(q.t)}”</span><span class="qa">— ${esc(q.a)}</span>`;
  el.hidden = false; btn.hidden = QUOTES.length < 2;
  el.classList.remove("fade"); void el.offsetWidth; el.classList.add("fade");
}
$("#quoteRefresh").addEventListener("click", () => {
  if (QUOTES.length < 2) return;
  let n; do { n = Math.floor(Math.random() * QUOTES.length); } while (n === quoteIdx);
  quoteIdx = n; renderQuote();
  const b = $("#quoteRefresh"); b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin");
});

/* ---------------- 날짜·탭 ---------------- */
function setDate(d) {
  if (d > TODAY) d = TODAY;
  if (pending[cur]) { clearTimeout(timers[cur]); flushDay(cur); }
  cur = d; day = getDay(d);
  fillAll(); renderAll(); loadNews(d);
}
function fillAll() { fillDiary(); fillBook(); fillStudy(); }
function renderAll() { renderTodos(); renderCal(); renderOverview(); renderNews(); renderPastDiary(); renderBooks(); renderStudy(); renderEnglish(); renderCases(); }
$("#prevDay").onclick = () => setDate(addDays(cur, -1));
$("#nextDay").onclick = () => setDate(addDays(cur, 1));
$("#goToday").onclick = () => setDate(TODAY);
$("#datePick").addEventListener("change", e => { if (e.target.value) setDate(e.target.value); });

const VIEWS = ["cal", "news", "diary", "books", "study", "english", "cases"];
function route() {
  const h = (location.hash || "").slice(1), v = VIEWS.includes(h) ? h : "cal";
  $("#dayHead").hidden = v === "cal";
  $("#todayLabel").textContent = v === "cal" ? "오늘 · " + lab(TODAY) : (cur === TODAY ? "오늘 · " + lab(cur) : lab(cur));
  if (v === "cal") renderCal();
  $("#todoBox").hidden = false; renderTodos();
  VIEWS.forEach(x => { $("#v-" + x).hidden = x !== v; });
  document.querySelectorAll("#tabs a").forEach(a => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
  const act = document.querySelector('#tabs a[aria-current="page"]'); if (act) act.scrollIntoView({ inline: "nearest", block: "nearest" });
}
window.addEventListener("hashchange", route);

/* ---------------- 앱 설치 (PWA) ---------------- */
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (!isStandalone()) $("#installBtn").hidden = false; });
if (isIOS && !isStandalone()) $("#installBtn").hidden = false;
$("#installBtn").addEventListener("click", async () => {
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome === "accepted") $("#installBtn").hidden = true; installEvt = null; return; }
  $("#installModal").hidden = false;
});
$("#installClose").addEventListener("click", () => { $("#installModal").hidden = true; });
$("#installModal").addEventListener("click", e => { if (e.target.id === "installModal") $("#installModal").hidden = true; });
window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; });

/* ---------------- 로그인 ---------------- */
const AUTH_ERR = m => /Invalid login credentials/i.test(m) ? "이메일이나 비밀번호가 달라. 아직 비밀번호를 안 만들었으면 아래 '메일로 로그인 링크 받기'로 들어간 다음 🔑 비밀번호에서 만들어줘."
  : /rate limit/i.test(m) ? "메일은 1시간에 2통까지만 보낼 수 있어. 잠시 후 다시 해보거나, 비밀번호로 로그인해줘."
  : /not authorized/i.test(m) ? "이 이메일로는 메일을 보낼 수 없어 (Supabase 팀에 등록 안 된 주소)."
  : /signups? not allowed|Signups not allowed/i.test(m) ? "새 가입이 막혀 있어. 원래 쓰던 이메일로 로그인해줘."
  : /Email not confirmed/i.test(m) ? "메일 인증이 아직 안 된 계정이야."
  : m;
function loginMsg(t) { const m = $("#loginMsg"); m.hidden = false; m.textContent = t; }
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim(), password = $("#loginPw").value;
  if (!email) return;
  if (!password) { loginMsg("비밀번호를 입력해줘. 비밀번호가 없으면 아래 메일 링크로 로그인해."); return; }
  $("#loginBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("#loginBtn").disabled = false;
  if (error) loginMsg(AUTH_ERR(error.message));
});
$("#magicBtn").addEventListener("click", async () => {
  const email = $("#loginEmail").value.trim(); if (!email) { $("#loginEmail").focus(); loginMsg("이메일을 먼저 입력해줘."); return; }
  $("#magicBtn").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
  $("#magicBtn").disabled = false;
  loginMsg(error ? "링크를 보내지 못했어: " + AUTH_ERR(error.message) : `${email}로 로그인 링크를 보냈어. 메일함(스팸함 포함)을 확인해줘.`);
});
$("#setPwBtn").addEventListener("click", () => { if (DEMO) { status("구경 모드에서는 비밀번호를 만들 수 없어 👀"); return; } $("#pwMsg").textContent = ""; $("#pwModal").hidden = false; $("#newPw1").focus(); });
$("#pwClose").addEventListener("click", () => { $("#pwModal").hidden = true; });
$("#pwModal").addEventListener("click", e => { if (e.target.id === "pwModal") $("#pwModal").hidden = true; });
$("#pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  const a = $("#newPw1").value, b = $("#newPw2").value;
  if (a.length < 6) { $("#pwMsg").textContent = "6자 이상으로 만들어줘."; return; }
  if (a !== b) { $("#pwMsg").textContent = "두 번 입력한 비밀번호가 달라."; return; }
  $("#pwMsg").textContent = "저장 중…";
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) { $("#pwMsg").textContent = "저장 실패: " + AUTH_ERR(error.message); return; }
  $("#newPw1").value = $("#newPw2").value = "";
  $("#pwMsg").textContent = "✅ 저장했어. 이제 다른 기기에서 이메일 + 이 비밀번호로 로그인하면 돼.";
});
$("#logout").addEventListener("click", async () => { if (DEMO) { location.href = location.pathname; return; } await sb.auth.signOut(); location.reload(); });
$("#demoLink").addEventListener("click", () => { location.href = location.pathname + "?demo"; });

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
  days = {}; d.data.forEach(r => { if (r.date === SETTINGS_DATE) settings = Object.assign({ goals: [] }, r.data || {}); else if (r.date === VOCAB_DATE) vocab = Object.assign({ words: [], sentences: [] }, r.data || {}); else days[r.date] = r.data || {}; });
  cases = {}; c.data.forEach(r => cases[r.id] = r);
  status("");
  setDate(cur);
  carryTodos(); renderTodos(); renderQuote();
}

function startDemo() {
  user = { id: "demo", email: "" };
  $("#loginView").hidden = true; $("#appView").hidden = false; $("#demoBar").hidden = false;
  $("#whoami").textContent = "👀 구경 중"; $("#logout").textContent = "구경 끝내기";
  const D = n => addDays(TODAY, -n);
  const g1 = uuid(), t1 = uuid(), t2 = uuid(), t3 = uuid(), g2 = uuid(), t4 = uuid();
  settings = { goals: [
    { id: g1, title: "유방초음파 전문방사선사 시험", examDate: addDays(TODAY, 40), tasks: [
      { id: t1, name: "유방초음파진단학 1회독 + 나만의 노트", type: "pages", start: 1, end: 420 },
      { id: t2, name: "기출문제 풀기", type: "count", target: 300, unit: "문항" },
      { id: t3, name: "BI-RADS 아틀라스 요약표 만들기", type: "check", done: false } ] },
    { id: g2, title: "영어 원서 한 권 끝내기", examDate: "", tasks: [
      { id: t4, name: "원서 읽기", type: "pages", start: 1, end: 280 } ] } ] };
  days = {};
  days[D(6)] = { diaryOne: "새 병원 적응 2달째", diary: "오늘은 유방 검사가 많았다. 석회화 케이스를 두 개나 봤다.", news: [{ title: "예시 기사: 코스피 주간 전망", url: "", memo: "CPI 발표 전까지 관망" }], book: { title: "예시 에세이", from: 1, to: 12 }, study: [{ taskId: t1, goalId: g1, subject: "유방초음파진단학 1회독 + 나만의 노트", from: 1, to: 34, minutes: 60, content: "1장 해부학 노트 정리" }], todos: [{ text: "운동 30분", done: true }] };
  days[D(5)] = { diaryOne: "퇴근 후 산책", diary: "날씨가 좋아서 한 시간 걸었다.", book: { title: "예시 에세이", from: 13, to: 20 }, study: [{ taskId: t2, goalId: g1, subject: "기출문제 풀기", count: 40, minutes: 50 }] };
  days[D(3)] = { diaryOne: "공부 집중한 날", diary: "", book: { title: "예시 에세이", from: 21, to: 28 }, study: [{ taskId: t1, goalId: g1, subject: "유방초음파진단학 1회독 + 나만의 노트", from: 35, to: 72, minutes: 90, content: "BI-RADS lexicon 표로 정리" }, { taskId: t4, goalId: g2, subject: "원서 읽기", from: 1, to: 15, minutes: 30 }] };
  days[D(2)] = { news: [{ title: "예시 기사: 금리 동결", url: "", memo: "" }], todos: [{ text: "케이스 사진 정리", done: true }, { text: "보험 서류 챙기기", done: false }] };
  days[D(1)] = { diaryOne: "케이스 정리 완료", diary: "오늘 본 섬유선종 케이스를 정리했다.", book: { title: "예시 에세이", from: 29, to: 36 }, study: [{ taskId: t2, goalId: g1, subject: "기출문제 풀기", count: 35, minutes: 40 }] };
  days[TODAY] = { todos: [{ text: "기출 30문항 풀기", done: false }, { text: "경제 기사 3개 읽기", done: true }, { text: "보험 서류 챙기기", done: false, from: D(2) }], todosInit: true };
  vocab = { sentences: [
      { en: "I would like a cup of coffee, please.", ko: "커피 한 잔 주세요.", note: "would like = want의 공손한 표현", date: D(2), done: false },
      { en: "How long have you been waiting?", ko: "얼마나 기다렸어요?", note: "현재완료진행", date: D(1), done: false },
      { en: "She is taller than her brother.", ko: "그녀는 남동생보다 키가 크다.", note: "", date: D(4), done: true } ],
    words: [
      { en: "grateful", ko: "감사하는", note: "I'm grateful for your help.", date: D(1), done: false },
      { en: "appointment", ko: "(병원 등) 예약, 약속", note: "", date: D(0), done: false },
      { en: "receipt", ko: "영수증", note: "p 묵음 [리싯]", date: D(3), done: true } ] };
  cases = {};
  [["갑상선", "Thyroid nodule, K-TIRADS 4", "Rt. lobe 1.2cm hypoechoic solid nodule, microcalcification(+)", "K-TIRADS 4, FNA 권고", "Taller-than-wide 여부 횡단·종단 모두 확인할 것", ["석회화", "FNA"], 4],
   ["유방", "Fibroadenoma 의심", "Lt. 2시 1.5cm oval, circumscribed, parallel mass", "BI-RADS 3, 6개월 f/u", "Posterior enhancement 확인", ["f/u"], 1]].forEach(([region, title, findings, impression, memo, tags, n]) => {
    const id = uuid(); cases[id] = { id, date: D(n), region, title, findings, impression, memo, tags, images: [], created_at: new Date().toISOString() };
  });
  day = blankDay(); route(); setDate(TODAY); renderTodos(); renderQuote();
  status("");
}

let started = false;
if (DEMO) { started = true; startDemo(); }
sb.auth.onAuthStateChange((_ev, session) => {
  if (session && !started) { started = true; startApp(session); if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname); }
});
if (!DEMO) sb.auth.getSession().then(({ data }) => {
  if (data.session) { if (!started) { started = true; startApp(data.session); } }
  else if (!location.hash.includes("access_token") && !location.search.includes("code=")) { $("#loginView").hidden = false; }
});
})();
