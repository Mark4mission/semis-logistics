/* 보안교육 이수 등록(edu.html) — 로그인 없는 공개 화면. 이름 · 사번 · 이수증 → 제출, 주소 하나(edu.html#코드)를 계속 쓴다.
   보안: 링크 코드 확인(semis_logi_edu_info, 협력사 과정 제외) 뒤 작업증명 표(semis_logi_challenge → semis_logi_edu_ticket, 3시간)로만 업로드 · 판독 · 제출.
   이수증: op "edu-upload" → 서명 URL PUT → op "edu-read" 판독(못 읽은 칸만 입력). 같은 과정 · 수료일은 기록 하나로 묶는다.
   제출(semis_logi_edu_submit): 서버가 병합(같은 사번 → 같은 이름 재직자 = 갱신)하고 그 사람 기록을 돌려주면 training.js personQuals 로 다음 교육 기간 계산.
   작성 중 내용은 sessionStorage(이 탭)에만 두고 제출하면 지운다. */
"use strict";

(function () {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  // anon(publishable) 공개 키(sync.js 와 같은 값) — 이 화면은 링크 확인 · 표 · 제출 RPC 만 부른다
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const RPC = SUPA_URL + "/rest/v1/rpc/";
  const FN_FILES = SUPA_URL + "/functions/v1/semis-logi-files";
  const FILE_MAX = 20 * 1024 * 1024;
  const FILE_RE = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;
  const MAX_FILES = 10, MAX_RECS = 10, MAX_PER = 5, MAX_READS = 3;
  const IMG_SIDE = 2400, IMG_Q = 0.86, IMG_KEEP = 3.5 * 1024 * 1024;
  const DRAFT = "semisl:edu2:";
  const PATH_RE = /^training\/[A-Za-z0-9._-]{4,120}$/;

  const TR = () => window.SemisTraining;
  const D = () => window.SeMIS.data;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const empNorm = (s) => String(s == null ? "" : s).replace(/\s+/g, "").toUpperCase().slice(0, 20);
  const nameKey = (s) => String(s == null ? "" : s).replace(/\s+/g, "");
  const p2 = (n) => String(n).padStart(2, "0");
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  let fixedToday = "";
  const todayISO = () => { if (fixedToday) return fixedToday; const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const addDays = (iso, n) => { const t = new Date(utc(iso) + n * 86400000); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB");
  const uid = () => {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 아래로 */ }
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  };
  const famShort = (g) => String((g && g.name) || "").replace(/\s*\(.*\)\s*$/, "");

  /* ── 상태 ── */
  const st = {
    view: "load", err: "", errInfo: null, code: "", info: null,
    ticket: "", ticketExp: 0, ticketBusy: null, warm: false,
    name: "", emp: "", items: [], sid: "",
    tried: false, sending: false, msg: "", done: null
  };
  let seq = 0;
  const key = () => "f" + (++seq) + Math.random().toString(36).slice(2, 6);

  /* ── 서버 ── */
  const hdr = () => ({ apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" });
  async function rpc(name, body) {
    const res = await fetch(RPC + name, { method: "POST", headers: hdr(), body: JSON.stringify(body || {}) });
    if (!res.ok) { const e = new Error("http " + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  async function ensureTicket(force) {
    if (!force && st.ticket && st.ticketExp * 1000 - Date.now() > 10 * 60000) return st.ticket;
    if (st.ticketBusy) return st.ticketBusy;
    st.ticketBusy = (async () => {
      let d = null;
      for (let i = 0; i < 2; i++) {
        const ch = await rpc("semis_logi_challenge", {});
        if (!ch || !ch.ok || !ch.c) throw new Error("challenge");
        const x = await window.SemisPow.solve(String(ch.c), Number(ch.d) || 18);
        d = await rpc("semis_logi_edu_ticket", { p_k: st.code, p_pow: { c: String(ch.c), x: String(x) } });
        if (!(d && /^pow/.test(String(d.error || "")))) break;
      }
      if (!d || !d.ok || !d.ticket) { const e = new Error(String((d && d.error) || "ticket")); e.code = d && d.error; e.d = d; throw e; }
      st.ticket = String(d.ticket); st.ticketExp = Number(d.exp) || Math.floor(Date.now() / 1000) + 3 * 3600;
      return st.ticket;
    })();
    try { return await st.ticketBusy; } finally { st.ticketBusy = null; }
  }
  /* 처음 손대면 표를 미리 받아 둔다(작업증명은 몇 초 걸림) */
  function warm() {
    if (st.warm || st.ticket) return;
    st.warm = true;
    ensureTicket().catch(() => { st.warm = false; });
  }

  /* ── 과정 기준 (training.js) ── */
  const courseOf = (id) => TR().courses().find(c => c.id === id && !c.vendor) || null;
  const dateOk = (d) => isISO(d) && d >= "2000-01-01" && d <= addDays(todayISO(), 1);
  const empOk = (s) => /[0-9A-Za-z]/.test(empNorm(s));
  const complete = (it) => it.st === "done" && !!courseOf(it.cid) && dateOk(it.date);

  /* ── 작성 중 내용 (이 탭만) ── */
  function saveDraft() {
    if (st.view !== "form") return;
    try {
      sessionStorage.setItem(DRAFT + st.code, JSON.stringify({ name: st.name, emp: st.emp, sid: st.sid,
        items: st.items.filter(it => it.st === "done" && it.path).map(it => ({ path: it.path, url: it.url, name: it.name, size: it.size, sha: it.sha,
          cid: it.cid, date: it.date, org: it.org, certNo: it.certNo, hours: it.hours, who: it.who, course: it.course, rerr: it.rerr, reads: it.reads })) }));
    } catch (e) { /* 저장소 없음 */ }
  }
  function loadDraft() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT + st.code) || "null"); } catch (e) { d = null; }
    if (!d || typeof d !== "object") return false;
    st.name = norm(d.name).slice(0, 30); st.emp = empNorm(d.emp);
    st.sid = /^[A-Za-z0-9-]{8,64}$/.test(String(d.sid || "")) ? d.sid : "";
    st.items = (Array.isArray(d.items) ? d.items : []).filter(x => x && PATH_RE.test(String(x.path || ""))).slice(0, MAX_FILES).map(x => {
      const h = Number(x.hours);
      return { k: key(), st: "done", pct: 1, err: "", path: String(x.path), url: String(x.url || ""), name: String(x.name || "이수증").slice(0, 120), size: Number(x.size) || 0,
        cid: courseOf(x.cid) ? x.cid : "", date: isISO(x.date) ? x.date : "", org: norm(x.org).slice(0, 60), certNo: norm(x.certNo).slice(0, 40),
        hours: x.hours != null && isFinite(h) && h > 0 && h <= 999 ? h : null, who: norm(x.who).slice(0, 30), course: norm(x.course).slice(0, 80), rerr: String(x.rerr || "").slice(0, 20),
        reads: Number(x.reads) || 0, open: false, sha: /^[0-9a-f]{64}$/.test(String(x.sha || "")) ? String(x.sha) : "" };
    });
    return true;
  }
  function dropDraft() { try { sessionStorage.removeItem(DRAFT + st.code); } catch (e) { /* 저장소 없음 */ } }

  /* ── 묶기 · 확인 ── */
  /* 같은 과정 · 수료일은 기록 하나 — 기관 · 번호 · 시간은 먼저 읽힌 값 */
  function groups() {
    const m = new Map();
    st.items.filter(complete).forEach(it => {
      const k = it.cid + "|" + it.date;
      let g = m.get(k);
      if (!g) { g = { cid: it.cid, date: it.date, org: "", certNo: "", hours: null, files: [], items: [] }; m.set(k, g); }
      if (!g.org && it.org) g.org = it.org;
      if (!g.certNo && it.certNo) g.certNo = it.certNo;
      if (g.hours == null && it.hours != null) g.hours = it.hours;
      g.files.push(Object.assign({ path: it.path, name: it.name }, it.sha ? { sha: it.sha } : {}));
      g.items.push(it);
    });
    return Array.from(m.values());
  }
  function check() {
    const e = [];
    if (!norm(st.name)) e.push({ f: "name", id: "ed-name", msg: "이름" });
    if (!empOk(st.emp)) e.push({ f: "emp", id: "ed-emp", msg: "사번" });
    const live = st.items.filter(it => it.st !== "err");
    if (!live.length) e.push({ f: "files", id: "ed-pick", msg: "이수증" });
    if (live.some(it => it.st === "up" || it.st === "read")) e.push({ f: "busy", id: "ed-pick", msg: "이수증 판독 중" });
    live.filter(it => it.st === "done" && !complete(it)).forEach(it => e.push({ f: "item", id: (courseOf(it.cid) ? "ed-date-" : "ed-cid-") + it.k, msg: "과정 · 수료일", it }));
    const g = groups();
    if (g.length > MAX_RECS) e.push({ f: "many", id: "ed-pick", msg: "교육 " + MAX_RECS + "건까지" });
    if (g.some(x => x.files.length > MAX_PER)) e.push({ f: "many", id: "ed-pick", msg: "같은 교육 이수증 " + MAX_PER + "장까지" });
    return e;
  }
  const missText = (errs) => errs.map(x => x.msg).filter((m, i, a) => a.indexOf(m) === i).join(" · ");

  /* ── 화면 ── */
  const app = () => document.getElementById("ed-app");
  const svg = (p, s) => `<svg class="ed-ico" width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="M12 16V5"/><path d="m7.5 9.5 4.5-4.5 4.5 4.5"/><path d="M5 19.5h14"/>',
    doc: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>',
    edit: '<path d="M4.5 19.5 5 16 15.5 5.5a2.1 2.1 0 0 1 3 3L8 19z"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.01"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    redo: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5V9h-4.5"/>'
  };
  const fieldErr = (id, msg) => `<small class="ed-err" id="${id}-e" hidden>${esc(msg)}</small>`;

  function heroHTML() {
    return `<section class="ed-hero"><div class="ed-hero-in">
      <div class="ed-hero-t">
        <p class="ed-kicker">인천화물팀 안전보안파트</p>
        <h1>보안교육 이수 등록</h1>
      </div>
    </div></section>`;
  }

  function render() {
    const a = app();
    if (!a) return;
    document.body.dataset.view = st.view;
    if (st.view === "load") { a.innerHTML = `<div class="ed-load"><span class="ed-spin" aria-hidden="true"></span><span>불러오는 중</span></div>`; return; }
    if (st.view === "error") { a.innerHTML = errorHTML(); wireError(); return; }
    if (st.view === "done") { a.innerHTML = heroHTML() + doneHTML(); wireDone(); return; }
    a.innerHTML = heroHTML() + `<div class="ed-wrap">
      <form class="ed-card ed-form" id="ed-form" novalidate autocomplete="off">
        <div class="ed-row">
          <label class="ed-f ed-f-name"><span class="ed-l">이름</span>
            <input id="ed-name" maxlength="30" autocomplete="name" value="${esc(st.name)}" placeholder="홍길동">${fieldErr("ed-name", "이름을 입력해주세요")}</label>
          <label class="ed-f ed-f-emp"><span class="ed-l">사번</span>
            <input id="ed-emp" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(st.emp)}" class="mono">${fieldErr("ed-emp", "사번을 입력해주세요")}</label>
        </div>
        <div class="ed-blk" id="ed-blk-files">
          <span class="ed-l">이수증</span>
          <div class="ed-drop" id="ed-drop">
            <div class="ed-flist" id="ed-flist">${st.items.map(itemHTML).join("")}</div>
            <div id="ed-pickw">${pickHTML()}</div>
            <input type="file" id="ed-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*" multiple hidden>
          </div>
          ${fieldErr("ed-files", "이수증을 올려주세요")}
        </div>
        <div class="ed-foot" id="ed-foot"></div>
      </form>
    </div>`;
    st.items.forEach(barWidth);
    wireForm();
    paintFoot();
    paintErrs();
  }

  function pickHTML() {
    const n = st.items.filter(it => it.st !== "err").length;
    if (n >= MAX_FILES) return "";
    return `<button type="button" class="ed-pick" id="ed-pick">${svg(IC.up, 20)}<span class="ed-pick-t">${n ? "이수증 추가 첨부" : "이수증 첨부"}</span><small>PDF · 사진${n ? "" : " · 여러 장 가능"}</small></button>`;
  }
  /* 과정 고르기 — 법정 · 위험물 · 국제 · 사내 묶음 */
  function courseOptions(cur) {
    const all = TR().courses().filter(c => !c.vendor);
    const grp = (c) => (/^(dgr|dg)/.test(String(c.fam || "")) || /위험물|DGR/.test(String(c.name || "")) ? "dg" : c.legal === "intl" ? "intl" : c.legal === "own" ? "own" : "law");
    const opt = (c) => `<option value="${esc(c.id)}"${c.id === cur ? " selected" : ""}>${esc(c.name)}</option>`;
    return `<option value="">과정 선택</option>` + [["law", "항공보안법 · 교육훈련지침"], ["dg", "위험물"], ["intl", "국제 기준"], ["own", "사내 · 기타"]].map(([k, lb]) => {
      const xs = all.filter(c => grp(c) === k);
      return xs.length ? `<optgroup label="${esc(lb)}">${xs.map(opt).join("")}</optgroup>` : "";
    }).join("");
  }
  const READ_MSG = (it) => it.rerr === "part" ? "일부 항목만 판독되었습니다. 빈 칸을 입력해 주세요." : "자동 판독에 실패했습니다. 직접 입력해 주세요.";
  const canReread = (it) => it.reads < MAX_READS && /^(busy|net|parse|ai|check|http|file)/.test(it.rerr || "");
  function itemState(it) {
    if (it.st === "done") return complete(it) ? "ok" : "fix";
    return it.st;
  }
  function itemIcon(it) {
    const s = itemState(it);
    if (s === "up") return svg(IC.up, 18);
    if (s === "read") return `<span class="ed-spin" aria-hidden="true"></span>`;
    if (s === "ok") return svg(IC.check, 18);
    return svg(s === "err" ? IC.alert : IC.doc, 18);
  }
  function itemActs(it) {
    const s = itemState(it);
    const del = `<button type="button" class="ed-x" data-del="${it.k}" aria-label="${esc(it.name)} 삭제">${svg(IC.x, 16)}</button>`;
    if (s === "ok" && !it.open) return `<button type="button" class="ed-x ed-x-edit" data-edit="${it.k}" aria-label="수정">${svg(IC.edit, 16)}</button>` + del;
    if (s === "ok" && it.open) return `<button type="button" class="ed-x ed-x-ok" data-fold="${it.k}" aria-label="닫기">${svg(IC.check, 16)}</button>` + del;
    return del;
  }
  function whoWarn(it) {
    return it.who && norm(st.name) && nameKey(it.who) !== nameKey(st.name) ? `<small class="ed-warn">${svg(IC.alert, 14)}<span>이수증 성명 ${esc(it.who)}</span></small>` : "";
  }
  function itemBody(it) {
    const s = itemState(it);
    if (s === "up") return `<div class="ed-fi-s"><span class="ed-bar"><i id="ed-bar-${it.k}"></i></span><span>업로드 중</span></div>`;
    if (s === "read") return `<div class="ed-fi-s"><span>이수증 판독 중</span></div>`;
    if (s === "err") return `<small class="ed-fi-e">${esc(it.err)}</small>`;
    const c = courseOf(it.cid);
    if (s === "ok" && !it.open) {
      return `<div class="ed-fi-r"><b>${esc(c.name)}</b><span class="mono">${esc(dot(it.date))}</span>${it.org ? `<span>${esc(it.org)}</span>` : ""}${it.certNo ? `<span class="mono">No. ${esc(it.certNo)}</span>` : ""}</div>${whoWarn(it)}`;
    }
    const bad = (f) => st.tried && (f === "cid" ? !c : !dateOk(it.date));
    return `${it.rerr && s === "fix" ? `<p class="ed-fi-n">${esc(READ_MSG(it))}${canReread(it) ? ` <button type="button" class="ed-link" data-reread="${it.k}">재판독</button>` : ""}</p>` : ""}
      ${it.course && !c ? `<p class="ed-fi-c">이수증 과정명 <b>${esc(it.course)}</b></p>` : ""}
      <div class="ed-fi-g">
        <label class="ed-f ed-f-c"><span class="ed-l">과정</span><select id="ed-cid-${it.k}" data-f="cid" aria-invalid="${bad("cid")}">${courseOptions(it.cid)}</select></label>
        <label class="ed-f"><span class="ed-l">수료일</span><input type="date" id="ed-date-${it.k}" data-f="date" value="${esc(it.date)}" min="2000-01-01" max="${esc(addDays(todayISO(), 1))}" aria-invalid="${bad("date")}"></label>
        <label class="ed-f"><span class="ed-l">교육기관</span><input id="ed-org-${it.k}" data-f="org" value="${esc(it.org)}" maxlength="60" list="ed-dl-org"></label>
        <label class="ed-f"><span class="ed-l">이수증 번호</span><input id="ed-certNo-${it.k}" data-f="certNo" value="${esc(it.certNo)}" maxlength="40" class="mono" spellcheck="false"></label>
      </div>${whoWarn(it)}`;
  }
  function itemHTML(it) {
    return `<div class="ed-fi is-${itemState(it)}${it.open ? " is-open" : ""}" data-k="${it.k}">
      <span class="ed-fi-ic">${itemIcon(it)}</span>
      <div class="ed-fi-b">
        <div class="ed-fi-h"><span class="ed-fn">${esc(it.name)}</span>${it.size ? `<small class="mono">${esc(kb(it.size))}</small>` : ""}</div>
        ${itemBody(it)}
      </div>
      <div class="ed-fi-a">${itemActs(it)}</div>
    </div>`;
  }
  const itemEl = (it) => $(`.ed-fi[data-k="${it.k}"]`);
  function barWidth(it) {
    const b = document.getElementById("ed-bar-" + it.k);
    if (b) b.style.width = Math.round((it.pct || 0) * 100) + "%";
  }
  function paintItem(it) {
    const el = itemEl(it);
    if (!el) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = itemHTML(it);
    el.replaceWith(tmp.firstElementChild);
    barWidth(it);
  }
  /* 칸에 입력할 때는 입력칸을 다시 만들지 않는다(한글 조합 · 날짜 칸 유지) — 표시만 고친다 */
  function itemBits(it) {
    const el = itemEl(it);
    if (!el) return;
    el.className = "ed-fi is-" + itemState(it) + (it.open ? " is-open" : "");
    setHTML($(".ed-fi-ic", el), itemIcon(it));
    setHTML($(".ed-fi-a", el), itemActs(it));
  }
  function paintPick() { const w = $("#ed-pickw"); if (w) w.innerHTML = pickHTML(); }
  function appendItem(it) {
    const l = $("#ed-flist");
    if (!l) return;
    l.insertAdjacentHTML("beforeend", itemHTML(it));
    barWidth(it);
  }
  function removeItem(it) {
    st.items = st.items.filter(x => x !== it);
    const el = itemEl(it);
    if (el) el.remove();
    paintPick(); paintErrs(); paintFoot(); saveDraft();
  }

  /* 오류 표시는 제출을 한 번 누른 뒤부터 */
  function paintErrs() {
    if (st.view !== "form") return;
    const errs = st.tried ? check() : [];
    const has = (f) => errs.some(x => x.f === f);
    [["name", "#ed-name"], ["emp", "#ed-emp"]].forEach(([f, s]) => {
      const i = $(s), e = $(s + "-e");
      if (i) i.setAttribute("aria-invalid", String(has(f)));
      if (e) e.hidden = !has(f);
    });
    const fe = $("#ed-files-e"), dr = $("#ed-drop");
    if (fe) fe.hidden = !has("files");
    if (dr) dr.classList.toggle("is-bad", has("files"));
    st.items.filter(it => it.st === "done" && (it.open || !complete(it))).forEach(it => {
      const c = $("#ed-cid-" + it.k), d = $("#ed-date-" + it.k);
      if (c) c.setAttribute("aria-invalid", String(st.tried && !courseOf(it.cid)));
      if (d) d.setAttribute("aria-invalid", String(st.tried && !dateOk(it.date)));
    });
  }
  /* 제출 단추는 한 번만 만들고 속성만 고친다 — 입력칸을 떠나며(change) 다시 그리면 그 순간 누른 클릭이 사라진다 */
  const LAST = new WeakMap();                                         // 마지막으로 넣은 HTML(브라우저 직렬화와 비교하지 않음)
  function setHTML(el, html) { if (!el || LAST.get(el) === html) return; LAST.set(el, html); el.innerHTML = html; }
  function paintFoot() {
    const f = $("#ed-foot");
    if (!f) return;
    if (!$("#ed-submit", f)) f.innerHTML = `<div class="ed-fmsg" id="ed-fmsg"></div><button type="button" class="ed-btn ed-submit" id="ed-submit">제출</button>`;
    const errs = check();
    const ready = !errs.length && !st.sending;
    setHTML($("#ed-fmsg", f), (st.msg ? `<p class="ed-msg" role="alert">${svg(IC.alert, 16)}<span>${esc(st.msg)}</span></p>` : "")
      + (st.tried && errs.length ? `<p class="ed-miss"><span>미입력 항목</span>${esc(missText(errs))}</p>` : ""));
    const b = $("#ed-submit", f);
    b.disabled = !!st.sending;
    b.dataset.ready = String(ready);
    const label = st.sending ? "제출하는 중" : "제출";
    if (b.textContent !== label) b.textContent = label;
  }

  function wireForm() {
    const form = $("#ed-form");
    if (!form) return;
    form.addEventListener("submit", (ev) => ev.preventDefault());
    const onField = (ev) => {
      const t = ev.target;
      if (!t || !t.id) return;
      warm();
      if (t.id === "ed-name") {
        st.name = t.value;
        st.items.filter(it => complete(it) && it.who && !it.open).forEach(it => { const el = itemEl(it); if (el && !!$(".ed-warn", el) !== !!whoWarn(it)) paintItem(it); });
      }
      else if (t.id === "ed-emp") st.emp = t.value;
      else if (t.dataset && t.dataset.f) {
        const el = t.closest(".ed-fi"), it = el && st.items.find(x => x.k === el.dataset.k);
        if (!it) return;
        const f = t.dataset.f;
        if (f === "date") it.date = isISO(t.value) ? t.value : "";
        else if (f === "cid") it.cid = courseOf(t.value) ? t.value : "";
        else it[f] = norm(t.value).slice(0, f === "org" ? 60 : 40);
        it.open = true;                                               // 고치는 중 — 다 채우면 닫기(✓) 단추
        itemBits(it);
      } else return;
      paintErrs(); paintFoot(); saveDraft();
    };
    form.addEventListener("input", onField);
    form.addEventListener("change", onField);
    form.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" || ev.isComposing) return;
      const t = ev.target;
      if (t && t.tagName === "INPUT") {
        ev.preventDefault();
        const next = { "ed-name": "#ed-emp", "ed-emp": "#ed-pick" }[t.id];
        const n = next && $(next);
        if (n) n.focus();
      }
    });
    form.addEventListener("click", (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (!b || !form.contains(b)) return;
      if (b.id === "ed-pick") { warm(); const i = $("#ed-file"); if (i) i.click(); return; }
      if (b.id === "ed-submit") { submit(); return; }
      const it = st.items.find(x => x.k === (b.dataset.del || b.dataset.edit || b.dataset.fold || b.dataset.reread));
      if (!it) return;
      if (b.dataset.del) { removeItem(it); return; }
      if (b.dataset.edit) { it.open = true; paintItem(it); const c = $("#ed-cid-" + it.k); if (c) c.focus(); return; }
      if (b.dataset.fold) { it.open = false; paintItem(it); paintErrs(); return; }
      if (b.dataset.reread) { readCert(it); }
    });
    const inp = $("#ed-file");
    if (inp) inp.addEventListener("change", () => { const fl = Array.from(inp.files || []); inp.value = ""; addFiles(fl); });
    const drop = $("#ed-drop");
    if (drop) {
      drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", (ev) => { if (!drop.contains(ev.relatedTarget)) drop.classList.remove("is-over"); });
      drop.addEventListener("drop", (ev) => {
        ev.preventDefault(); drop.classList.remove("is-over");
        warm();
        addFiles(Array.from((ev.dataTransfer && ev.dataTransfer.files) || []));
      });
    }
  }

  /* ── 이수증 올리기 · 읽기 ── */
  function newItem(file) {
    return { k: key(), st: "up", pct: 0, err: "", path: "", url: "", name: String((file && file.name) || "이수증").slice(0, 120), size: (file && file.size) || 0,
      cid: "", date: "", org: "", certNo: "", hours: null, who: "", course: "", rerr: "", reads: 0, open: false, sha: "" };
  }
  /* 원본 SHA-256 — 같은 파일 중복 방지(서버도 이 값으로 기존 첨부와 대조) */
  async function shaOf(file) {
    try {
      const sub = window.crypto && window.crypto.subtle;
      if (!sub || !file || typeof file.arrayBuffer !== "function") return "";
      const h = await sub.digest("SHA-256", await file.arrayBuffer());
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) { return ""; }
  }
  async function addFiles(list) {
    const room = MAX_FILES - st.items.filter(it => it.st !== "err").length;
    const take = list.slice(0, Math.max(0, room));
    if (!take.length) return;
    st.msg = "";
    const jobs = take.map(file => {
      const it = newItem(file);
      const bad = !FILE_RE.test(file.name || "") ? "PDF · 사진만 올릴 수 있습니다" : !(file.size > 0) ? "빈 파일입니다" : "";
      if (bad) { it.st = "err"; it.err = bad; }
      st.items.push(it); appendItem(it);
      return { it, file };
    });
    paintPick(); paintErrs(); paintFoot();
    for (const j of jobs) {
      if (j.it.st === "err") continue;
      j.it.sha = await shaOf(j.file);
      if (j.it.sha && st.items.some(x => x !== j.it && x.st !== "err" && x.sha === j.it.sha)) {
        j.it.st = "err"; j.it.err = "이미 첨부된 파일입니다";
        paintItem(j.it); paintPick(); paintErrs(); paintFoot();
        continue;
      }
      if (await uploadOne(j.it, j.file) === "gone") return;
    }
  }
  async function uploadOne(it, file) {
    let meta;
    try {
      const f = await prep(file);
      if (f !== file) { it.name = String(f.name || it.name).slice(0, 120); it.size = f.size || it.size; paintItem(it); }
      if (f.size > FILE_MAX) { const e = new Error("too_large"); e.code = "too_large"; throw e; }
      meta = await claimUpload(f);
      await putFile(meta.upload, f, (p) => { it.pct = p; barWidth(it); });
    } catch (e) {
      if (st.items.indexOf(it) < 0) return "";
      if (e && (e.code === "closed" || e.code === "expired" || e.code === "invalid")) { linkGone(e.code, e.d); return "gone"; }
      it.st = "err"; it.err = upErr(e);
      paintItem(it); paintPick(); paintErrs(); paintFoot();
      return "";
    }
    if (st.items.indexOf(it) < 0) return "";                          // 그 사이 뺐다
    it.path = meta.path; it.url = meta.url || "";
    readCert(it);                                                     // 읽는 동안 다음 파일을 올린다
    return "";
  }
  function upErr(e) {
    const c = String((e && (e.code || e.message)) || "");
    if (/too_many/.test(c)) return "파일이 너무 많습니다";
    if (/too_large|413/.test(c)) return "20MB 이하만 올릴 수 있습니다";
    if (/type|415/.test(c)) return "PDF · 사진만 올릴 수 있습니다";
    if (/limit|busy/.test(c)) return "잠시 후 다시 첨부해 주세요";
    return "올리지 못했습니다";
  }
  /* 사진은 긴 변 2400px JPEG 로 줄인다(판독 · 저장 용량) — 줄일 수 없으면 그대로 */
  async function prep(file) {
    const nm = String(file.name || "image");
    const ext = (nm.split(".").pop() || "").toLowerCase();
    if (!/^(jpe?g|png|webp|heic|heif)$/.test(ext) || typeof createImageBitmap !== "function") return file;
    const plain = /^(jpe?g|png|webp)$/.test(ext);
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) { return file; }
    try {
      const s = Math.min(1, IMG_SIDE / Math.max(bmp.width, bmp.height));
      if (plain && s === 1 && file.size <= IMG_KEEP) return file;
      const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const cx = cv.getContext && cv.getContext("2d");
      if (!cx) return file;
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
      cx.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((res) => { try { cv.toBlob(res, "image/jpeg", IMG_Q); } catch (e) { res(null); } });
      if (!blob || !blob.size || (plain && s === 1 && blob.size >= file.size)) return file;
      const name = (nm.replace(/\.[^.]+$/, "") || "image") + ".jpg";
      try { return new File([blob], name, { type: "image/jpeg" }); } catch (e) { blob.name = name; return blob; }
    } catch (e) {
      return file;
    } finally {
      try { bmp.close(); } catch (e) { /* 없음 */ }
    }
  }
  async function claimUpload(file) {
    for (let i = 0; i < 2; i++) {
      const tk = await ensureTicket(i > 0);
      const res = await fetch(FN_FILES, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "edu-upload", ticket: tk, name: String(file.name || "file"), size: file.size || 0, type: file.type || "" }) });
      let d = null;
      try { d = await res.json(); } catch (e) { d = null; }
      if (res.ok && d && d.ok && d.upload && d.path) return d;
      const code = String((d && d.error) || res.status);
      if (code === "ticket" && i === 0) { st.ticket = ""; continue; }
      const e = new Error(code); e.code = code; throw e;
    }
    throw new Error("ticket");
  }
  function putFile(url, file, onp) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      x.setRequestHeader("x-upsert", "false");
      if (x.upload) x.upload.onprogress = (ev) => { if (ev.lengthComputable) onp(ev.loaded / ev.total); };
      x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("put " + x.status)));
      x.onerror = () => reject(new Error("net"));
      x.send(file);
    });
  }
  async function readCert(it) {
    it.st = "read"; it.rerr = ""; it.open = false;
    paintItem(it); paintErrs(); paintFoot();
    let d = null;
    for (let i = 0; i < 2; i++) {
      try {
        const tk = await ensureTicket(i > 0);
        const res = await fetch(FN_FILES, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "edu-read", ticket: tk, path: it.path, roles: [] }) });
        try { d = await res.json(); } catch (e) { d = null; }
        if (!d || typeof d !== "object") d = { ok: false, error: "http " + res.status };
      } catch (e) {
        d = { ok: false, error: String((e && e.code) || "net") };
      }
      if (d.ok || d.error !== "ticket" || i > 0) break;
      st.ticket = "";
    }
    it.reads++;
    if (st.items.indexOf(it) < 0 || st.view !== "form") return;
    if (d.error === "closed" || d.error === "expired") { linkGone(d.error, d); return; }
    if (d.ok && d.data && typeof d.data === "object") applyRead(it, d.data);
    else it.rerr = String(d.error || "ai").slice(0, 20);
    it.st = "done";
    paintItem(it); paintErrs(); paintFoot(); saveDraft();
  }
  /* 이수증 번호 — '제 2026-0931 호' · 'No. 12' 의 앞뒤 말은 뺀다 */
  const certNoNorm = (v) => norm(v).replace(/^(제|No\.?|NO\.?|№)\s*/i, "").replace(/\s*호$/, "").slice(0, 40);
  /* 교육기관 — 서명란의 'OO원장 · 센터장' 은 기관 이름으로 */
  const orgNorm = (v) => norm(v).replace(/(원|센터|소|협회|학교)장(?=\s|\(|$)/, "$1").slice(0, 60);
  function applyRead(it, x) {
    if (courseOf(x.cid)) it.cid = x.cid;
    if (dateOk(x.date)) it.date = x.date;
    if (x.org) it.org = orgNorm(x.org);
    if (x.certNo) it.certNo = certNoNorm(x.certNo);
    it.course = norm(x.course).slice(0, 80);
    const h = Number(x.hours);
    it.hours = x.hours != null && isFinite(h) && h > 0 && h <= 999 ? h : null;
    it.who = norm(x.name).slice(0, 30);
    it.rerr = courseOf(it.cid) && dateOk(it.date) ? "" : "part";
  }

  /* ── 제출 ── */
  function errText(d) {
    const code = String((d && d.error) || "");
    const M = {
      required: "입력하지 않은 칸이 있습니다.", too_long: "입력한 내용이 너무 깁니다.", emp: "사번을 확인해 주세요.", roles: "다시 시도해 주세요.",
      date: "날짜를 확인해 주세요.", course: "과정을 다시 선택해 주세요.", files: "이수증을 다시 첨부해 주세요.",
      dup_rec: "같은 과정 · 수료일이 두 번 들어 있습니다.", too_many: "한 번에 " + MAX_RECS + "건까지 등록할 수 있습니다.",
      catalog: "과정 기준을 불러오지 못했습니다. 안전보안파트에 알려 주세요.", ticket: "보안 확인이 끝났습니다. 다시 제출해 주세요.",
      net: "서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 제출해 주세요."
    };
    if (code === "limit" || code === "busy") return "잠시 후 다시 시도해 주세요 (" + (Number(d.wait) || 10) + "분).";
    if (/^pow/.test(code)) return "보안 확인에 실패했습니다. 다시 제출해 주세요.";
    return M[code] || "제출하지 못했습니다. 다시 시도해 주세요.";
  }
  function payload() {
    return {
      sid: st.sid, name: norm(st.name), emp: empNorm(st.emp), dept: "",
      recs: groups().map(g => ({ cid: g.cid, date: g.date, expire: "", hours: g.hours, org: g.org, certNo: g.certNo, files: g.files.slice(0, MAX_PER) }))
    };
  }
  async function submit() {
    if (st.sending) return;
    st.tried = true; st.msg = "";
    const errs = check();
    if (errs.length) {
      st.items.filter(it => it.st === "done" && !complete(it) && !it.open).forEach(paintItem);
      paintErrs(); paintFoot();
      const el = document.getElementById(errs[0].id);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (el && el.focus) setTimeout(() => el.focus({ preventScroll: true }), 250);
      return;
    }
    if (!st.sid) st.sid = uid();
    saveDraft();
    st.sending = true; busy(true); paintFoot();
    let d = null;
    try {
      for (let i = 0; i < 2; i++) {
        const tk = await ensureTicket(i > 0);
        d = await rpc("semis_logi_edu_submit", { p_k: st.code, p_ticket: tk, p: payload() });
        if (!(d && d.error === "ticket")) break;
        st.ticket = "";
      }
    } catch (e) {
      d = e && e.code ? { ok: false, error: e.code, wait: e.d && e.d.wait } : { ok: false, error: "net" };
    }
    st.sending = false; busy(false);
    if (d && d.ok) { finish(d); return; }
    if (d && (d.error === "closed" || d.error === "expired" || d.error === "invalid")) { linkGone(d.error, d); return; }
    st.msg = errText(d);
    paintFoot();
  }
  function busy(on) {
    const b = $("#ed-busy");
    if (b) b.classList.toggle("hidden", !on);
  }
  function linkGone(code, d) {
    st.view = "error"; st.err = code; st.errInfo = d || null;
    busy(false);
    render();
  }

  /* ── 제출 뒤 — 다음 교육 · 제출 정보 ── */
  function finish(d) {
    const sent = { name: norm(st.name), emp: empNorm(st.emp),
      recs: groups().map(g => ({ cid: g.cid, date: g.date, org: g.org, certNo: g.certNo, files: g.files.length })) };
    st.done = { res: d, sent };
    dropDraft();
    st.view = "done";
    render();
    window.scrollTo(0, 0);
  }
  /* 서버가 돌려준 그 사람의 기록으로 training.js 계산을 그대로 돌린다 */
  function guidance(res) {
    const person = Object.assign({ id: "me", name: "", dept: "", roles: [], left: "" }, res.person || {});
    const t = D().training;
    t.people = [person];
    t.records = (Array.isArray(res.records) ? res.records : []).map(r => Object.assign({ pid: person.id }, r, { pid: person.id }));
    const pq = TR().personQuals(person);
    const mine = (Array.isArray(res.ids) ? res.ids : []);
    const mark = (x) => t.records.some(r => mine.indexOf(r.id) >= 0 && x.g.courses.some(c => c.id === r.cid || (Array.isArray(c.same) && c.same.indexOf(r.cid) >= 0)));
    return { person, list: pq.req.concat(pq.held.filter(mark)).map(x => Object.assign(x, { mine: mark(x) })) };
  }
  function nextLine(c) {
    switch (c.st) {
      case "none": return { main: "기록 없음", sub: "이수 후 등록" };
      case "step": return { main: "자격인증 전", sub: "인증까지 이수 후 등록" };
      case "perm": return { main: "영구", sub: "1회 이수" };
      default: break;
    }
    const rule = c.g.rule;
    const win = rule === "kr" || rule === "dg";
    const s = c.winS, e = c.winE;
    if (c.st === "susp" || c.st === "lapsed") return { main: "정기교육으로 회복", sub: "회복 기한 " + dot(c.recE), at: c.recE };
    if (win && isISO(s) && isISO(e)) return { main: dot(s) + " ~ " + dot(e), sub: "유효기한 " + dot(c.exp), at: s, end: e };
    return { main: "유효기한 " + dot(c.exp), sub: "", at: c.exp };
  }
  function dday(at) {
    if (!isISO(at)) return "";
    const n = dayDiff(todayISO(), at);
    return n > 0 ? "D-" + n : n === 0 ? "D-Day" : "D+" + (-n);
  }
  function doneHTML() {
    const { res, sent } = st.done;
    const gd = guidance(res);
    /* same = 서버가 '이미 등록된 그대로'라고 판단한 기록 id. 보낸 순서 = ids 순서 */
    const ids = Array.isArray(res.ids) ? res.ids : [], same = Array.isArray(res.same) ? res.same : [];
    const isSame = (i) => !!ids[i] && same.indexOf(ids[i]) >= 0;
    const allSame = sent.recs.length > 0 && sent.recs.every((r, i) => isSame(i));
    const kindLb = allSame ? "이미 등록된 이수증입니다 — 바뀐 내용 없음"
      : ({ new: "새로 등록", updated: "기존 정보 갱신", dup: "새로 등록 · 동명이인 확인 예정" }[res.kind] || "등록");
    const cal = gd.list.filter(x => { const n = nextLine(x); return isISO(n.at) && n.at >= todayISO(); });
    return `<div class="ed-wrap">
      <section class="ed-card ed-ok">
        <span class="ed-okico" aria-hidden="true">${svg(IC.check, 28)}</span>
        <div class="ed-ok-t"><h2>${allSame ? "이미 등록되어 있습니다" : "등록되었습니다"}</h2><p>${esc(kindLb)}</p></div>
        <dl class="ed-rcpt"><div><dt>접수 번호</dt><dd class="mono">${esc(res.receipt || "-")}</dd></div><div><dt>제출 시각</dt><dd class="mono">${esc(String(res.at || "").replace(/-/g, "."))}</dd></div></dl>
        <p class="ed-close" role="status">제출이 완료되었습니다. 이 화면을 닫으셔도 됩니다.</p>
      </section>
      <section class="ed-card" aria-labelledby="ed-h-next">
        <div class="ed-ch"><h3 id="ed-h-next">다음 교육</h3>${cal.length ? `<button type="button" class="ed-btn ed-btn-soft" id="ed-ics">${svg(IC.cal, 17)}<span>캘린더에 추가</span></button>` : ""}</div>
        ${gd.list.length ? `<ul class="ed-next">${gd.list.map(x => { const n = nextLine(x), s = TR().ST[x.st] || { label: "", tone: "gray" };
          return `<li class="tone-${esc(s.tone)}"><div class="ed-nh"><b>${esc(famShort(x.g))}</b><span class="ed-chipst tone-${esc(s.tone)}">${esc(s.label)}</span>${x.mine ? '<small class="ed-mine">이번 제출</small>' : ""}</div>
            <div class="ed-nb"><span class="ed-nl">${n.end ? "다음 이수 기간" : n.at ? "다음 일정" : "상태"}</span><b${/\d/.test(n.main) ? ' class="mono"' : ""}>${esc(n.main)}</b>${n.sub ? `<small>${esc(n.sub)}</small>` : ""}</div>
            ${n.at ? `<span class="ed-dd mono">${esc(dday(n.at))}</span>` : ""}</li>`; }).join("")}</ul>`
          : `<p class="ed-nil">해당 직무의 필수 교육이 없습니다.</p>`}
      </section>
      <section class="ed-card" aria-labelledby="ed-h-sent">
        <h3 id="ed-h-sent">제출 정보</h3>
        <dl class="ed-sent">
          <div><dt>이름</dt><dd>${esc(sent.name)}</dd></div>
          <div><dt>사번</dt><dd class="mono">${esc(sent.emp)}</dd></div>
          <div><dt>이수 교육</dt><dd>${sent.recs.length ? `<ul class="ed-srecs">${sent.recs.map((r, i) => { const c = courseOf(r.cid);
            return `<li><span>${esc(c ? c.name : r.cid)}${isSame(i) ? '<em class="ed-same">이미 등록됨</em>' : ""}</span><small class="mono">${esc([dot(r.date), r.org, r.certNo ? "No. " + r.certNo : "", "이수증 " + r.files].filter(Boolean).join(" · "))}</small></li>`; }).join("")}</ul>` : '<span class="ed-nil">없음</span>'}</dd></div>
        </dl>
      </section>
      <div class="ed-actions">
        <button type="button" class="ed-btn ed-btn-ghost" id="ed-again">${svg(IC.plus, 18)}<span>이수증 추가 등록</span></button>
        <button type="button" class="ed-btn ed-btn-ghost" id="ed-dprint">${svg(IC.print, 18)}<span>Print</span></button>
      </div>
    </div>`;
  }
  function wireDone() {
    const ics = $("#ed-ics"); if (ics) ics.addEventListener("click", downloadIcs);
    const ag = $("#ed-again");
    if (ag) ag.addEventListener("click", () => {
      st.items = []; st.sid = ""; st.tried = false; st.msg = ""; st.done = null;
      st.view = "form"; render(); saveDraft(); window.scrollTo(0, 0);
    });
    const pr = $("#ed-dprint"); if (pr) pr.addEventListener("click", () => window.print());
  }
  /* 다음 이수 기간을 하루 종일 일정으로 (.ics) */
  function icsText() {
    const gd = guidance(st.done.res);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const ymd = (s) => s.replace(/-/g, "");
    const escI = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const ev = gd.list.map(x => ({ x, n: nextLine(x) })).filter(o => isISO(o.n.at) && o.n.at >= todayISO()).map(({ x, n }, i) => {
      const end = addDays(isISO(n.end) ? n.end : n.at, 1);
      return ["BEGIN:VEVENT", "UID:semisl-edu-" + stamp + "-" + i + "@semis-logistics", "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + ymd(n.at), "DTEND;VALUE=DATE:" + ymd(end),
        "SUMMARY:" + escI("보안교육 갱신 — " + famShort(x.g)),
        "DESCRIPTION:" + escI([n.end ? "이수 기간 " + n.main : n.main, n.sub].filter(Boolean).join(" · ")),
        "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + escI("보안교육 갱신 — " + famShort(x.g)), "TRIGGER:-P7D", "END:VALARM",
        "END:VEVENT"].join("\r\n");
    });
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AirZeta//SeMIS Logistics//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"].concat(ev, ["END:VCALENDAR"]).join("\r\n").split("\r\n");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  /* RFC 5545 줄 접기 — 75바이트(UTF-8) 넘으면 다음 줄을 공백으로 시작 */
  function fold(line) {
    const out = [];
    let cur = "", n = 0;
    for (const ch of line) {
      const c = ch.codePointAt(0), b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
      if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
      cur += ch; n += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
  function downloadIcs() {
    try {
      const blob = new Blob([icsText()], { type: "text/calendar;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "보안교육_갱신일정.ics";
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    } catch (e) { /* 내려받기 불가 환경 */ }
  }

  /* ── 링크 오류 ── */
  function errorHTML() {
    const e = st.err, d = st.errInfo || {};
    const T = {
      nocode: ["링크를 다시 확인해 주세요", "받은 링크를 그대로 열어 주세요."],
      invalid: ["링크를 다시 확인해 주세요", "받은 링크를 그대로 열어 주세요."],
      closed: ["사용하지 않는 주소입니다", "새 주소는 안전보안파트에 문의해 주세요."],
      expired: ["사용하지 않는 주소입니다", "새 주소는 안전보안파트에 문의해 주세요."],
      limit: ["잠시 후 다시 열어 주세요", (Number(d.wait) || 10) + "분 뒤"],
      busy: ["잠시 후 다시 열어 주세요", ""],
      net: ["서버에 연결하지 못했습니다", "인터넷 연결을 확인해 주세요."]
    }[e] || ["열 수 없습니다", ""];
    const retry = e === "net" || e === "limit" || e === "busy";
    return `<section class="ed-gone"><span class="ed-goneico" aria-hidden="true">${svg(IC.alert, 28)}</span>
      <h1>${esc(T[0])}</h1>${T[1] ? `<p>${esc(T[1])}</p>` : ""}
      <p class="ed-gone-c">문의 · 인천화물팀 안전보안파트</p>
      ${retry ? `<button type="button" class="ed-btn ed-btn-soft" id="ed-retry">다시 시도</button>` : ""}</section>`;
  }
  function wireError() { const r = $("#ed-retry"); if (r) r.addEventListener("click", () => { st.view = "load"; render(); start(); }); }

  /* ── 시작 ── */
  function codeFromUrl() {
    const h = String(location.hash || "").replace(/^#/, ""), q = /[?&]k=([A-Za-z0-9]+)/.exec(location.search || "");
    const m = /(?:^|[&?]|k=)([a-z2-9]{12})(?:$|&)/i.exec(h) || (q ? [0, q[1]] : null);
    return m ? String(m[1]).toLowerCase() : "";
  }
  async function start() {
    st.code = codeFromUrl();
    if (!/^[a-z2-9]{12}$/.test(st.code)) { linkGone("nocode"); return; }
    let d = null;
    try { d = await rpc("semis_logi_edu_info", { p_k: st.code }); } catch (e) { d = { ok: false, error: "net" }; }
    if (!d || !d.ok) { linkGone(String((d && d.error) || "net"), d); return; }
    st.info = d;
    const cs = Array.isArray(d.courses) && d.courses.length ? d.courses : TR().DEF_COURSES.filter(c => !c.vendor).map(c => JSON.parse(JSON.stringify(c)));
    D().training = { courses: cs, people: [], records: [], sessions: [] };
    loadDraft();
    st.view = "form";
    render();
    if (!$("#ed-dl-org")) document.body.insertAdjacentHTML("beforeend", `<datalist id="ed-dl-org">${((d.orgs || [])).map(o => `<option value="${esc(o)}">`).join("")}</datalist>`);
    const n = $("#ed-name"); if (n && !st.name && window.matchMedia && window.matchMedia("(min-width: 768px)").matches) n.focus();
  }
  function init() {
    const pb = $("#ed-print");
    if (pb) pb.addEventListener("click", () => window.print());
    window.addEventListener("hashchange", () => { if (codeFromUrl() !== st.code) { st.view = "load"; render(); start(); } });
    start();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.SemisEdu = { st, check, payload, groups, complete, applyRead, certNoNorm, orgNorm, guidance, nextLine, icsText, codeFromUrl, errText, render,
    setToday(t) { fixedToday = isISO(t) ? t : ""; if (TR() && TR().setToday) TR().setToday(t); } };
})();
