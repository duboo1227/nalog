// 🩺 케이스 같이 보기 — 초대받은 친구들끼리 케이스(사진·동영상)와 판독 의견을 나누는 페이지
(function () {
"use strict";
const CFG = window.APP_CONFIG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kst = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TODAY = kst(new Date());
const when = iso => { const d = new Date(iso); if (isNaN(d)) return ""; return `${kst(d).slice(5).replace("-", "/")} ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(d)}`; };
const REGIONS = ["갑상선", "유방", "경동맥", "상복부", "하복부", "장·충수", "심장", "기타"];
const CLASS_OPTS = { "유방": ["BI-RADS 0", "BI-RADS 1", "BI-RADS 2", "BI-RADS 3", "BI-RADS 4A", "BI-RADS 4B", "BI-RADS 4C", "BI-RADS 5", "BI-RADS 6"], "갑상선": ["K-TIRADS 1", "K-TIRADS 2", "K-TIRADS 3", "K-TIRADS 4", "K-TIRADS 5"] };
const VID_RE = /\.(mp4|mov|m4v|webm|3gp)$/i;
const isVid = p => VID_RE.test(p || "");
const MAX_IMG = 20 * 1024 * 1024, MAX_VID = 50 * 1024 * 1024;
const uuid = () => crypto.randomUUID();

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
let user = null, me = null, members = {}, cases = [], counts = {}, filter = "전체", signed = {}, edit = null, viewId = null;

let stT;
function status(t) { $("#status").textContent = t || ""; clearTimeout(stT); if (t && !/중…/.test(t) && !/실패|못했/.test(t)) stT = setTimeout(() => { $("#status").textContent = ""; }, 3000); }
function show(which) { ["loginBox", "joinBox", "mainBox"].forEach(id => { $("#" + id).hidden = id !== which; }); $("#who").hidden = which !== "mainBox"; }
const nickOf = uid => (members[uid] && members[uid].nickname) || "(나간 회원)";

/* ---------- 로그인 · 가입 ---------- */
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("#email").value.trim(); if (!email) return;
  $("#sendBtn").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/share", shouldCreateUser: true } });
  $("#sendBtn").disabled = false;
  const m = $("#loginMsg"); m.hidden = false;
  m.textContent = error ? (/rate|limit|seconds/i.test(error.message) ? "메일 발송 한도에 걸렸어. 잠시(최대 1시간) 뒤에 다시 해줘." : "링크를 보내지 못했어: " + error.message) : `${email}로 로그인 링크를 보냈어. 메일함(스팸함 포함)을 확인해줘.`;
});
$("#joinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const m = $("#joinMsg"); m.hidden = false; m.textContent = "확인 중…";
  const { data, error } = await sb.rpc("join_share", { p_code: $("#code").value.trim(), p_nick: $("#nick").value.trim() });
  if (error) { m.textContent = /function|schema cache/i.test(error.message) ? "아직 공유 기능 설정(DB)이 안 돼 있어. 초대한 사람에게 알려줘." : "들어가지 못했어: " + error.message; return; }
  if (!data) { m.textContent = "초대코드가 맞지 않아. 다시 확인해줘."; return; }
  m.hidden = true; start();
});
$("#logoutBtn").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
$("#nickBtn").addEventListener("click", () => {
  openSheet(`<div class="phead"><h2 id="mTitle">닉네임 바꾸기</h2><button class="x" data-act="close" aria-label="닫기">×</button></div>
    <form id="nickForm" style="display:flex;flex-direction:column;gap:10px"><input type="text" id="nick2" maxlength="20" value="${esc(me.nickname)}" required><div><button class="btn primary" type="submit">저장</button></div></form>`);
  $("#nickForm").addEventListener("submit", async e => {
    e.preventDefault();
    const { error } = await sb.rpc("join_share", { p_code: "", p_nick: $("#nick2").value.trim() });
    if (error) { status("닉네임을 바꾸지 못했어: " + error.message); return; }
    closeSheet(); start();
  });
});

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  user = session && session.user;
  if (!user) { show("loginBox"); return; }
  const m = await sb.from("share_members").select("user_id,nickname");
  if (m.error && /relation|does not exist|schema cache/i.test(m.error.message)) { show("joinBox"); $("#joinMsg").hidden = false; $("#joinMsg").textContent = "아직 공유 기능 설정(DB)이 안 돼 있어. 초대한 사람에게 알려줘."; return; }
  members = {}; (m.data || []).forEach(r => { members[r.user_id] = r; });
  me = members[user.id];
  if (!me) { show("joinBox"); return; }
  $("#whoName").innerHTML = `<b>${esc(me.nickname)}</b> · 회원 ${Object.keys(members).length}명`;
  show("mainBox");
  await loadCases();
}
async function loadCases() {
  status("불러오는 중…");
  const r = await sb.from("cases").select("*").eq("shared", true).order("date", { ascending: false }).limit(1000);
  if (r.error) { status("케이스를 불러오지 못했어: " + r.error.message); return; }
  cases = r.data.filter(c => members[c.user_id]);
  const cm = await sb.from("case_comments").select("case_id");
  counts = {}; (cm.data || []).forEach(x => { counts[x.case_id] = (counts[x.case_id] || 0) + 1; });
  status("");
  render();
}
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" && !me) start(); });

/* ---------- 목록 ---------- */
async function sign(paths) {
  const need = [...new Set(paths.filter(p => p && !signed[p]))];
  if (!need.length) return;
  const { data } = await sb.storage.from("cases").createSignedUrls(need, 60 * 60 * 6);
  (data || []).forEach(d => { if (d.signedUrl) signed[d.path] = d.signedUrl; });
}
function media(p, kind) {
  const u = esc(signed[p] || "");
  if (!isVid(p)) return kind === "view" ? `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="케이스 이미지" loading="lazy"></a>` : `<img src="${u}" alt="" loading="lazy">`;
  if (kind === "view") return `<div class="vidbox"><video src="${u}" controls playsinline loop preload="metadata"></video><a class="muted vidlink" href="${u}" target="_blank" rel="noopener">재생이 안 되면 여기서 열기·다운로드</a></div>`;
  return `<span class="vthumb"><video src="${u}#t=0.1" muted playsinline preload="metadata"></video><i aria-hidden="true">▶</i></span>`;
}
async function render() {
  await sign(cases.map(c => (c.images || [])[0]));
  const by = {}; cases.forEach(c => { by[c.region] = (by[c.region] || 0) + 1; });
  if (filter !== "전체" && filter !== "내 케이스" && !by[filter]) filter = "전체";
  const mineN = cases.filter(c => c.user_id === user.id).length;
  $("#filter").innerHTML = ["전체", ...REGIONS.filter(r => by[r]), ...(mineN ? ["내 케이스"] : [])].map(r => `<button class="chip" data-f="${esc(r)}" aria-pressed="${r === filter}">${esc(r)} <span class="mono">${r === "전체" ? cases.length : r === "내 케이스" ? mineN : by[r]}</span></button>`).join("");
  const q = $("#search").value.trim().toLowerCase();
  const list = cases.filter(c => (filter === "전체" || (filter === "내 케이스" ? c.user_id === user.id : c.region === filter)) &&
    (!q || [c.title, c.findings, c.impression, c.memo, c.cls, nickOf(c.user_id), ...(c.tags || [])].join(" ").toLowerCase().includes(q)));
  $("#grid").innerHTML = list.length ? list.map(c => `<button class="case" data-case="${c.id}"><div class="thumb">${(c.images || []).length ? media(c.images[0], "thumb") + ((c.images || []).some(isVid) && !isVid(c.images[0]) ? `<i class="vbadge">🎞️</i>` : "") : "이미지 없음"}</div><div class="meta"><span><span class="tag">${esc(c.region || "기타")}</span>${c.cls ? ` <span class="tag cls">${esc(c.cls)}</span>` : ""}</span><b>${esc(c.title || "(제목 없음)")}</b><span class="by"><span>👤 ${esc(nickOf(c.user_id))}${c.user_id === user.id ? ` <span class="mine">나</span>` : ""}</span><span class="mono">${esc(c.date || "")}</span>${counts[c.id] ? `<span>💬 ${counts[c.id]}</span>` : ""}</span></div></button>`).join("")
    : `<div class="empty">${cases.length ? "조건에 맞는 케이스가 없어." : "아직 공유된 케이스가 없어. '+ 케이스 올리기'로 첫 케이스를 올려봐. 알았구나에서 케이스를 '👥 친구들과 공유'로 체크해도 여기 떠."}</div>`;
}
$("#filter").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } });
$("#search").addEventListener("input", render);
$("#grid").addEventListener("click", e => { const b = e.target.closest("[data-case]"); if (b) openView(b.dataset.case); });

/* ---------- 모달 ---------- */
function openSheet(html) { $("#sheet").innerHTML = html; $("#modal").hidden = false; document.body.style.overflow = "hidden"; }
function closeSheet() {
  document.querySelectorAll("#modal video").forEach(v => v.pause());
  if (edit && edit.isNew && edit.data.images.length) sb.storage.from("cases").remove(edit.data.images);   // 저장 안 하고 닫으면 올린 파일 정리
  $("#modal").hidden = true; document.body.style.overflow = ""; edit = null; viewId = null;
}
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeSheet(); });

async function openView(id) {
  const c = cases.find(x => x.id === id); if (!c) return;
  viewId = id; edit = null;
  await sign(c.images || []);
  const mine = c.user_id === user.id;
  openSheet(`<div class="phead"><h2 id="mTitle">${esc(c.title || "(제목 없음)")}</h2><button class="x" data-act="close" aria-label="닫기">×</button></div>
    <div><span class="tag">${esc(c.region || "기타")}</span>${c.cls ? ` <span class="tag cls">${esc(c.cls)}</span>` : ""} <span class="mono muted">${esc(c.date || "")}</span> · <span class="muted">👤 ${esc(nickOf(c.user_id))}</span> ${(c.tags || []).map(t => `<span class="muted">#${esc(t)}</span>`).join(" ")}</div>
    <div class="imgs">${(c.images || []).map(p => media(p, "view")).join("")}</div>
    ${c.findings ? `<div><div class="label">Findings</div><div class="pre">${esc(c.findings)}</div></div>` : ""}
    ${c.impression ? `<div><div class="label">Impression</div><div class="pre">${esc(c.impression)}</div></div>` : ""}
    ${c.memo ? `<div><div class="label">메모 / 배운 점</div><div class="pre">${esc(c.memo)}</div></div>` : ""}
    ${mine ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="edit">수정</button><button class="btn ghost" data-act="unshare">공유 그만하기</button></div>` : ""}
    <div id="cConfirm"></div>
    <div class="phead" style="margin-top:6px"><h2 style="font-size:18px">💬 판독 토론</h2><span class="muted mono" id="cCount"></span></div>
    <ul class="comments" id="comments"><li class="muted" style="border:0">불러오는 중…</li></ul>
    <form class="cform" id="cForm"><textarea id="cBody" rows="3" maxlength="2000" placeholder="내 판독 의견, 감별진단, 궁금한 점을 적어줘"></textarea><div><button class="btn primary" type="submit">댓글 달기</button></div></form>`);
  loadComments(id);
  $("#cForm").addEventListener("submit", async e => {
    e.preventDefault();
    const body = $("#cBody").value.trim(); if (!body) return;
    const btn = e.target.querySelector("button"); btn.disabled = true;
    const { error } = await sb.from("case_comments").insert({ case_id: id, body });
    btn.disabled = false;
    if (error) { status("댓글을 달지 못했어: " + error.message); return; }
    $("#cBody").value = ""; counts[id] = (counts[id] || 0) + 1; loadComments(id); render();
  });
}
async function loadComments(id) {
  const { data, error } = await sb.from("case_comments").select("*").eq("case_id", id).order("created_at");
  if (viewId !== id) return;
  const c = cases.find(x => x.id === id);
  if (error) { $("#comments").innerHTML = `<li class="muted">댓글을 불러오지 못했어: ${esc(error.message)}</li>`; return; }
  counts[id] = data.length; $("#cCount").textContent = data.length + "개";
  $("#comments").innerHTML = data.length ? data.map(x => `<li><div class="ch"><b>${esc(nickOf(x.user_id))}</b>${x.user_id === c.user_id ? `<span class="mine">올린 사람</span>` : ""}<span class="mono">${when(x.created_at)}</span>${(x.user_id === user.id || c.user_id === user.id) ? `<button class="x" data-delc="${x.id}" aria-label="댓글 삭제">×</button>` : ""}</div><div class="cb">${esc(x.body)}</div></li>`).join("")
    : `<li class="muted" style="border:0;padding:0">아직 댓글이 없어. 첫 의견을 남겨봐.</li>`;
}

/* ---------- 올리기 · 수정 ---------- */
$("#newCase").addEventListener("click", () => { edit = { isNew: true, data: { id: uuid(), date: TODAY, region: "갑상선", title: "", findings: "", impression: "", memo: "", tags: [], images: [], cls: "" } }; renderEdit(); });
function renderEdit(msg) {
  const c = edit.data;
  openSheet(`<div class="phead"><h2 id="mTitle">${edit.isNew ? "케이스 올리기" : "케이스 수정"}</h2><button class="x" data-act="close" aria-label="닫기">×</button></div>
    <div class="row">
      <label class="field"><span>날짜</span><input type="date" id="fDate" value="${esc(c.date)}"></label>
      <label class="field"><span>부위</span><select id="fRegion">${REGIONS.map(r => `<option${r === c.region ? " selected" : ""}>${r}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>제목</span><input type="text" id="fTitle" value="${esc(c.title)}" placeholder="예: 갑상선 우엽 결절, 미세석회화"></label>
    <label class="field"><span>분류 (선택)</span><input type="text" id="fCls" list="fClsList" value="${esc(c.cls || "")}" placeholder="예: K-TIRADS 4, BI-RADS 3"><datalist id="fClsList">${(CLASS_OPTS[c.region] || [...CLASS_OPTS["유방"], ...CLASS_OPTS["갑상선"]]).map(o => `<option value="${o}">`).join("")}</datalist></label>
    <label class="field"><span>Findings</span><textarea id="fFind" rows="4">${esc(c.findings)}</textarea></label>
    <label class="field"><span>Impression</span><textarea id="fImp" rows="2">${esc(c.impression)}</textarea></label>
    <label class="field"><span>메모 / 배운 점</span><textarea id="fMemo" rows="3">${esc(c.memo)}</textarea></label>
    <label class="field"><span>태그 (쉼표로 구분)</span><input type="text" id="fTags" value="${esc((c.tags || []).join(", "))}"></label>
    <div class="field"><span>사진·동영상</span>
      <div class="uploads">${c.images.map((p, k) => `<div class="u">${media(p, "edit")}<button type="button" data-rm="${k}" aria-label="빼기">×</button></div>`).join("")}</div>
      <div class="pastebox" id="paste" contenteditable="true" role="textbox" aria-label="이미지 붙여넣기 칸" inputmode="none"><b>여기에 이미지 붙여넣기</b><span>PC: Ctrl+V (⌘V) · 끌어다 놓기 · 동영상은 끌어다 놓기나 '파일에서 선택'으로</span></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px">
        <label class="linkbtn" style="cursor:pointer">파일에서 선택<input type="file" id="fFile" accept="image/*,video/*" multiple hidden></label>
        <span class="muted" style="font-size:12.5px" id="upMsg">${esc(msg || "사진 20MB · 동영상 50MB까지 (720p, 10초 안팎 추천)")}</span>
      </div>
    </div>
    <div class="notice">🙈 환자 이름·등록번호·생년월일·병원명이 안 보이는지 다시 한 번 확인!</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between">
      <div style="display:flex;gap:8px"><button class="btn primary" data-act="save">${edit.isNew ? "올리기" : "저장"}</button><button class="btn ghost" data-act="close">취소</button></div>
      ${edit.isNew ? "" : `<button class="btn danger" data-act="del">삭제</button>`}
    </div><div id="cConfirm"></div>`);
  $("#fFile").addEventListener("change", e => upload([...e.target.files]));
  $("#fRegion").addEventListener("change", e => { $("#fClsList").innerHTML = (CLASS_OPTS[e.target.value] || [...CLASS_OPTS["유방"], ...CLASS_OPTS["갑상선"]]).map(o => `<option value="${o}">`).join(""); });
  const box = $("#paste");
  box.addEventListener("beforeinput", e => { if (e.inputType !== "insertFromPaste") e.preventDefault(); });
  box.addEventListener("dragover", e => { e.preventDefault(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", e => { e.preventDefault(); box.classList.remove("over"); upload(filesFrom(e.dataTransfer)); });
}
function filesFrom(dt) {
  if (!dt) return [];
  const ok = f => /^(image|video)\//.test(f.type) || VID_RE.test(f.name || "");
  let files = [...(dt.files || [])].filter(ok);
  if (!files.length && dt.items) files = [...dt.items].filter(i => i.kind === "file" && /^(image|video)\//.test(i.type)).map(i => i.getAsFile()).filter(Boolean);
  return files;
}
document.addEventListener("paste", e => {
  if (!edit || $("#modal").hidden || !$("#paste")) return;
  const files = filesFrom(e.clipboardData);
  if (!files.length) { if (e.target.closest && e.target.closest("#paste")) { e.preventDefault(); $("#upMsg").textContent = "클립보드에 이미지가 없어."; } return; }
  e.preventDefault(); upload(files);
});
function readForm() {
  const c = edit.data;
  c.date = $("#fDate").value || TODAY; c.region = $("#fRegion").value; c.title = $("#fTitle").value.trim(); c.cls = $("#fCls").value.trim();
  c.findings = $("#fFind").value; c.impression = $("#fImp").value; c.memo = $("#fMemo").value;
  c.tags = $("#fTags").value.split(",").map(s => s.trim()).filter(Boolean);
}
let uploading = false;
async function upload(files) {
  if (!files.length || uploading) return;
  uploading = true; readForm(); let err = "";
  for (const [i, f] of files.entries()) {
    const vid = f.type.startsWith("video/") || VID_RE.test(f.name || "");
    if (f.size > (vid ? MAX_VID : MAX_IMG)) { err = `${f.name}: ${vid ? "동영상 50MB" : "사진 20MB"} 초과 (${(f.size / 1048576).toFixed(0)}MB)`; continue; }
    $("#upMsg").textContent = `${vid ? "동영상" : "사진"} 올리는 중 ${i + 1}/${files.length}… 창 닫지 마`;
    const nameExt = (f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const fromType = (f.type.split("/")[1] || "").replace("jpeg", "jpg").replace("quicktime", "mov").replace(/^x-/, "").replace(/[^a-z0-9]/g, "");
    const ext = vid ? (VID_RE.test("." + nameExt) ? nameExt : (VID_RE.test("." + fromType) ? fromType : "mp4")) : (fromType || nameExt || "jpg");
    const path = `${user.id}/${edit.data.id}/${Date.now()}-${i}.${ext}`;
    const { error } = await sb.storage.from("cases").upload(path, f, { contentType: f.type || (vid ? (ext === "mov" ? "video/quicktime" : "video/mp4") : "image/jpeg") });
    if (error) err = `${f.name}: ${error.message}`; else { edit.data.images.push(path); }
  }
  uploading = false;
  await sign(edit.data.images);
  const nv = edit.data.images.filter(isVid).length;
  renderEdit(err || `사진 ${edit.data.images.length - nv}장${nv ? ` · 동영상 ${nv}개` : ""} · '${edit.isNew ? "올리기" : "저장"}'를 눌러야 반영돼`);
}
async function save() {
  readForm();
  const c = edit.data;
  const row = { id: c.id, user_id: user.id, date: c.date, region: c.region, title: c.title, cls: c.cls || null, findings: c.findings, impression: c.impression, memo: c.memo, tags: c.tags, images: c.images, shared: true, updated_at: new Date().toISOString() };
  status("저장 중…");
  const { data, error } = await sb.from("cases").upsert(row).select().single();
  if (error) { status("저장 실패: " + error.message); return; }
  const before = (cases.find(x => x.id === c.id) || {}).images || [];
  const removed = before.filter(p => !c.images.includes(p));
  if (removed.length) sb.storage.from("cases").remove(removed);
  const i = cases.findIndex(x => x.id === c.id); if (i >= 0) cases[i] = data; else cases.unshift(data);
  cases.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  edit.isNew = false; status("저장됨");
  const id = c.id; edit = null; render(); openView(id);
}
$("#sheet").addEventListener("click", async e => {
  const rm = e.target.closest("[data-rm]");
  if (rm && edit) { readForm(); edit.data.images.splice(Number(rm.dataset.rm), 1); renderEdit(); return; }
  const dc = e.target.closest("[data-delc]");
  if (dc) { const { error } = await sb.from("case_comments").delete().eq("id", dc.dataset.delc); if (error) status("삭제하지 못했어: " + error.message); else { loadComments(viewId); counts[viewId] = Math.max(0, (counts[viewId] || 1) - 1); render(); } return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act, c = cases.find(x => x.id === (viewId || (edit && edit.data.id)));
  if (act === "close") closeSheet();
  else if (act === "edit" && c) { edit = { isNew: false, data: JSON.parse(JSON.stringify(Object.assign({ cls: "" }, c))) }; viewId = null; renderEdit(); }
  else if (act === "save") { a.disabled = true; await save(); a.disabled = false; }
  else if (act === "unshare" && c) $("#cConfirm").innerHTML = `<div class="confirm notice">공유를 그만할까? 케이스는 내 알았구나에 그대로 남고, 여기서만 안 보이게 돼. 달린 댓글은 다시 공유하면 돌아와. <button class="btn" data-act="unshareyes">그만하기</button><button class="btn ghost" data-act="no">취소</button></div>`;
  else if (act === "unshareyes" && c) {
    const { error } = await sb.from("cases").update({ shared: false }).eq("id", c.id);
    if (error) { status("바꾸지 못했어: " + error.message); return; }
    cases = cases.filter(x => x.id !== c.id); closeSheet(); render(); status("공유를 그만했어");
  }
  else if (act === "del") $("#cConfirm").innerHTML = `<div class="confirm notice">이 케이스와 사진·동영상·댓글을 모두 지울까? 내 알았구나에서도 지워지고 되돌릴 수 없어. <button class="btn danger" data-act="delyes">삭제</button><button class="btn ghost" data-act="no">취소</button></div>`;
  else if (act === "no") $("#cConfirm").innerHTML = "";
  else if (act === "delyes" && edit) {
    const id = edit.data.id, imgs = (cases.find(x => x.id === id) || {}).images || [];
    const { error } = await sb.from("cases").delete().eq("id", id);
    if (error) { status("삭제하지 못했어: " + error.message); return; }
    if (imgs.length) sb.storage.from("cases").remove(imgs);
    cases = cases.filter(x => x.id !== id); edit = null; closeSheet(); render(); status("삭제했어");
  }
});

start();
})();
