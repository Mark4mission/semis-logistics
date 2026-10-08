/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 보안교육 이수 등록 (배포용 화면 edu.html, v1.39)
   메일로 받은 링크(edu.html#코드)로 로그인 없이 본인 정보 · 직무(임명일) · 이수 교육(수료일 · 이수증)을 등록한다.
   - 링크 확인 · 과정 기준: RPC semis_logi_edu_info(코드) — 협력사 과정은 오지 않는다
   - 업로드 · 제출 표: semis_logi_challenge(작업증명) → semis_logi_edu_ticket(코드, 해답) — 3시간
   - 이수증: 파일 함수 semis-logi-files op "edu-upload"(표) → 서명 업로드 URL 에 PUT (PDF · 이미지, 20MB)
   - 제출: semis_logi_edu_submit(코드, 표, 내용) → 서버가 training 에 병합(같은 이름 재직자 = 갱신)하고
     그 사람의 이수 기록을 돌려준다 → js/training.js 의 personQuals 로 다음 갱신 기간을 보여 준다
   - 작성 중인 내용은 이 탭(sessionStorage)에만 둔다 — 새로 고침해도 남고, 제출하면 지운다
   ═══════════════════════════════════════════════════════ */
"use strict";

(function () {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  // anon(publishable) key — 공개용 키(js/sync.js 와 같은 값). 이 화면이 부르는 것은 링크 확인 · 표 · 제출 RPC 뿐이다.
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const RPC = SUPA_URL + "/rest/v1/rpc/";
  const FN_FILES = SUPA_URL + "/functions/v1/semis-logi-files";
  const FILE_MAX = 20 * 1024 * 1024;
  const FILE_RE = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;
  const MAX_ITEMS = 10, MAX_FILES = 5;
  const DRAFT = "semisl:edu:";
  const WD = ["일", "월", "화", "수", "목", "금", "토"];

  const TR = () => window.SemisTraining;
  const D = () => window.SeMIS.data;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const p2 = (n) => String(n).padStart(2, "0");
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  let fixedToday = "";
  const todayISO = () => { if (fixedToday) return fixedToday; const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const addDays = (iso, n) => { const t = new Date(utc(iso) + n * 86400000); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const dotW = (s) => (isISO(s) ? dot(s) + " (" + WD[new Date(utc(s)).getUTCDay()] + ")" : "");
  const md = (s) => (isISO(s) ? s.slice(5).replace("-", ".") : "");
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB");
  const uid = () => {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 아래로 */ }
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  };
  const famShort = (g) => String((g && g.name) || "").replace(/\s*\(.*\)\s*$/, "");
  const isPerm = (c) => !!c && !c.step && !(Number(c.cycle) > 0);

  /* ─── 상태 ─── */
  const st = {
    view: "load", err: "", errInfo: null, code: "", info: null,
    ticket: "", ticketExp: 0, ticketBusy: null,
    name: "", dept: "", roles: [], items: [], sid: "",
    tried: false, sending: false, msg: "", done: null, ups: {}
  };
  let seq = 0;
  const key = () => "i" + (++seq) + Math.random().toString(36).slice(2, 6);

  /* ─── 서버 ─── */
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

  /* ─── 과정 기준 (js/training.js) ─── */
  const ownRoles = () => {
    const s = [];
    TR().courses().filter(c => !c.vendor).forEach(c => (c.roles || []).forEach(r => { if (r && s.indexOf(r) < 0) s.push(r); }));
    return TR().sortRoles(s);
  };
  const roleDef = (r) => TR().ROLE_DEF.find(x => x.id === r) || null;
  const famsOf = () => TR().fams(false);
  const famOf = (f) => famsOf().find(g => g.fam === f) || null;
  const courseOf = (id) => TR().courses().find(c => c.id === id) || null;
  const roleFams = (r) => famsOf().filter(g => g.roles.indexOf(r) >= 0);
  function defaultCid(g) {
    return ((g.courses.find(c => c.kind === "정기") || g.courses.find(c => !c.step) || g.courses[0]) || {}).id || "";
  }
  /* 직무에서 필요한 묶음 — 고른 직무 순서대로, 중복 없이 */
  function needFams() {
    const out = [];
    st.roles.forEach(x => roleFams(x.r).forEach(g => { if (out.indexOf(g.fam) < 0) out.push(g.fam); }));
    return out;
  }
  /* 직무가 바뀌면 필수 묶음 칸을 맞춘다 — 적은 내용이 있는 칸은 남긴다 */
  const filled = (it) => !!(it.date || (it.files && it.files.length) || it.org || it.certNo || it.expire);
  function syncItems() {
    const need = needFams();
    st.items = st.items.filter(it => !it.auto || need.indexOf(it.fam) >= 0 || filled(it));
    st.items.forEach(it => { if (it.auto && need.indexOf(it.fam) < 0) it.auto = false; });
    need.forEach(f => {
      if (st.items.some(it => it.fam === f)) return;
      const g = famOf(f);
      if (g) st.items.push(newItem(g, defaultCid(g), true));
    });
    const rk = new Map(st.items.map((it, n) => { const i = need.indexOf(it.fam); return [it, it.auto && i >= 0 ? i : 1000 + n]; }));
    st.items.sort((a, b) => rk.get(a) - rk.get(b));
  }
  function newItem(g, cid, auto) {
    return { k: key(), fam: g.fam, cid, auto: !!auto, date: "", expire: "", expTouched: false, org: "", certNo: "", hours: "", files: [] };
  }
  /* 이 수료일이면 계산되는 유효기한 — 이전 기록은 모르므로 수료일 기준(제출 뒤 화면은 서버 기록으로 이어 셈) */
  function calcExp(it) {
    const c = courseOf(it.cid);
    if (!c || c.step || isPerm(c) || !isISO(it.date)) return "";
    return TR().nextExpire(c, it.date, "");
  }

  /* ─── 작성 중 내용 (이 탭만) ─── */
  function saveDraft() {
    if (st.view !== "form") return;
    try {
      sessionStorage.setItem(DRAFT + st.code, JSON.stringify({ name: st.name, dept: st.dept, roles: st.roles, sid: st.sid,
        items: st.items.map(it => ({ fam: it.fam, cid: it.cid, auto: it.auto, date: it.date, expire: it.expire, expTouched: it.expTouched,
          org: it.org, certNo: it.certNo, hours: it.hours, files: it.files })) }));
    } catch (e) { /* 저장소 없음 */ }
  }
  function loadDraft() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT + st.code) || "null"); } catch (e) { d = null; }
    if (!d || typeof d !== "object") return false;
    const okRoles = ownRoles();
    st.name = norm(d.name).slice(0, 30); st.dept = norm(d.dept).slice(0, 40);
    st.roles = (Array.isArray(d.roles) ? d.roles : []).filter(x => x && okRoles.indexOf(x.r) >= 0).map(x => ({ r: x.r, apt: isISO(x.apt) ? x.apt : "" }));
    st.sid = /^[A-Za-z0-9-]{8,64}$/.test(String(d.sid || "")) ? d.sid : "";
    st.items = (Array.isArray(d.items) ? d.items : []).filter(x => x && famOf(x.fam) && courseOf(x.cid)).slice(0, MAX_ITEMS).map(x => ({
      k: key(), fam: x.fam, cid: x.cid, auto: !!x.auto, date: isISO(x.date) ? x.date : "", expire: isISO(x.expire) ? x.expire : "",
      expTouched: !!x.expTouched, org: norm(x.org).slice(0, 60), certNo: norm(x.certNo).slice(0, 40), hours: x.hours == null ? "" : String(x.hours).slice(0, 6),
      files: (Array.isArray(x.files) ? x.files : []).filter(f => f && /^training\//.test(String(f.path || ""))).slice(0, MAX_FILES)
        .map(f => ({ path: String(f.path), url: String(f.url || ""), name: String(f.name || "이수증").slice(0, 120), size: Number(f.size) || 0 }))
    }));
    return true;
  }
  function dropDraft() { try { sessionStorage.removeItem(DRAFT + st.code); } catch (e) { /* 저장소 없음 */ } }

  /* ─── 확인 ─── */
  function itemErrs(it) {
    const out = {};
    if (!filled(it)) return out;
    const t = todayISO();
    if (!isISO(it.date)) out.date = "수료일을 입력하세요";
    else if (it.date > addDays(t, 1)) out.date = "오늘 이후 날짜입니다";
    else if (it.date < "2000-01-01") out.date = "날짜를 확인하세요";
    if (it.expTouched && it.expire && isISO(it.date) && it.expire <= it.date) out.expire = "수료일보다 뒤여야 합니다";
    if (!it.files.length) out.files = "이수증을 첨부하세요";
    if (upsOf(it).some(u => !u.err)) out.files = "올리는 중입니다";
    const h = it.hours === "" ? null : Number(it.hours);
    if (h != null && !(h >= 0 && h <= 999)) out.hours = "0~999";
    return out;
  }
  function check() {
    const e = [];
    if (!norm(st.name)) e.push({ id: "ed-name", msg: "성명", f: "name" });
    if (!norm(st.dept)) e.push({ id: "ed-dept", msg: "소속", f: "dept" });
    if (!st.roles.length) e.push({ id: "ed-roles", msg: "직무", f: "roles" });
    st.roles.forEach(x => { if (!isISO(x.apt)) e.push({ id: "ed-apt-" + slug(x.r), msg: "임명일", f: "apt" }); });
    st.items.forEach(it => {
      const ie = itemErrs(it);
      Object.keys(ie).forEach(k => e.push({ id: "ed-" + k + "-" + it.k, msg: ie[k] === "올리는 중입니다" ? "업로드 중" : ({ date: "수료일", expire: "유효기한", files: "이수증", hours: "교육 시간" })[k], f: k, it }));
    });
    return e;
  }
  const slug = (r) => Array.from(String(r)).map(c => c.charCodeAt(0).toString(36)).join("");
  const missText = (errs) => {
    const c = {};
    errs.forEach(x => { c[x.msg] = (c[x.msg] || 0) + 1; });
    return Object.keys(c).map(k => c[k] > 1 ? k + " " + c[k] : k).join(" · ");
  };
  const toSubmit = () => st.items.filter(filled);

  /* ═════════ 화면 ═════════ */
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
    back: '<path d="M10 7 5 12l5 5"/><path d="M5.5 12H19"/>'
  };
  const rgDot = (g) => `<i class="rg-dot rg-${g.id}" aria-hidden="true"></i>`;

  function heroHTML() {
    const i = st.info || {};
    const exp = i.expires || "";
    const left = isISO(exp) ? dayDiff(todayISO(), exp) : null;
    return `<section class="ed-hero"><div class="ed-hero-in">
      <div class="ed-hero-t">
        <p class="ed-kicker">인천화물팀 안전보안파트</p>
        <h1>보안교육 이수 등록</h1>
        ${i.title ? `<p class="ed-sub">${esc(i.title)}</p>` : ""}
        ${i.note ? `<p class="ed-note">${esc(i.note)}</p>` : ""}
      </div>
      ${exp ? `<dl class="ed-due"><div><dt>등록 기한</dt><dd class="mono">${esc(dotW(exp))}</dd></div>
        <div><dt>남은 기간</dt><dd class="mono">${left == null ? "-" : left <= 0 ? "오늘까지" : "D-" + left}</dd></div></dl>` : ""}
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
      <form class="ed-form" id="ed-form" novalidate autocomplete="off">
        ${secPerson()}
        <section class="ed-sec" id="ed-sec-roles" aria-labelledby="ed-h-roles"></section>
        <section class="ed-sec" id="ed-sec-items" aria-labelledby="ed-h-items"></section>
      </form>
      <aside class="ed-side" id="ed-side" aria-label="등록 요약"></aside>
    </div>
    <div class="ed-mbar" id="ed-mbar"></div>`;
    wirePerson();
    paintRoles();
    paintItems();
    paintSummary();
  }

  const secHead = (n, id, title, done, extra) => `<header class="ed-sh"><span class="ed-num mono${done ? " is-done" : ""}" aria-hidden="true">${done ? svg(IC.check, 16) : p2(n)}</span>
    <h2 id="${id}">${esc(title)}</h2>${extra || ""}</header>`;
  const fieldErr = (id, on, msg) => `<small class="ed-err" id="${id}-e"${on ? "" : " hidden"}>${esc(msg || "")}</small>`;

  /* 01 본인 정보 */
  function secPerson() {
    const depts = ((st.info && st.info.depts) || []).filter(Boolean);
    const dn = st.tried && !norm(st.name), dd = st.tried && !norm(st.dept);
    return `<section class="ed-sec" id="ed-sec-person" aria-labelledby="ed-h-person">
      ${secHead(1, "ed-h-person", "본인 정보", norm(st.name) && norm(st.dept))}
      <div class="ed-grid2">
        <label class="ed-f"><span class="ed-l">성명</span>
          <input id="ed-name" maxlength="30" autocomplete="name" value="${esc(st.name)}" aria-invalid="${dn}" placeholder="홍길동">
          ${fieldErr("ed-name", dn, "성명을 입력하세요")}</label>
        <label class="ed-f"><span class="ed-l">소속</span>
          <input id="ed-dept" maxlength="40" autocomplete="organization" list="ed-dl-dept" value="${esc(st.dept)}" aria-invalid="${dd}" placeholder="인천화물팀">
          ${fieldErr("ed-dept", dd, "소속을 입력하세요")}</label>
      </div>
      <datalist id="ed-dl-dept">${depts.map(d => `<option value="${esc(d)}">`).join("")}</datalist>
    </section>`;
  }
  function wirePerson() {
    const n = $("#ed-name"), d = $("#ed-dept");
    const upd = () => {
      st.name = n.value; st.dept = d.value;
      if (st.tried) { n.setAttribute("aria-invalid", String(!norm(st.name))); d.setAttribute("aria-invalid", String(!norm(st.dept)));
        $("#ed-name-e").hidden = !!norm(st.name); $("#ed-dept-e").hidden = !!norm(st.dept); }
      const num = $("#ed-sec-person .ed-num");
      const ok = !!(norm(st.name) && norm(st.dept));
      if (num) { num.classList.toggle("is-done", ok); num.innerHTML = ok ? svg(IC.check, 16) : "01"; }
      paintSummary(); saveDraft();
    };
    n.addEventListener("input", upd); d.addEventListener("input", upd);
    n.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); d.focus(); } });
    d.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); const c = $(".ed-chip"); if (c) c.focus(); } });
  }

  /* 02 직무 */
  function paintRoles() {
    const box = $("#ed-sec-roles");
    if (!box) return;
    const all = ownRoles();
    const groups = TR().RGROUPS.map(g => ({ g, rs: all.filter(r => TR().rgOf(r) === g) })).filter(x => x.rs.length);
    const sel = (r) => st.roles.some(x => x.r === r);
    const noRole = st.tried && !st.roles.length;
    const aptOk = st.roles.length && st.roles.every(x => isISO(x.apt));
    box.innerHTML = secHead(2, "ed-h-roles", "직무", aptOk, st.roles.length ? `<span class="ed-sh-m">${st.roles.length}개</span>` : "")
      + `<div class="ed-rgs" id="ed-roles" role="group" aria-label="직무 고르기" aria-invalid="${noRole}">${groups.map(({ g, rs }) => `
        <div class="ed-rg rg-${g.id}"><span class="ed-rgl">${rgDot(g)}${esc(g.label)}</span>
          <div class="ed-chips">${rs.map(r => { const d = roleDef(r);
            return `<button type="button" class="ed-chip" data-role="${esc(r)}" aria-pressed="${sel(r)}"${d && d.who ? ` title="${esc(d.who)}"` : ""}>${sel(r) ? svg(IC.check, 15) : ""}<span>${esc(r)}</span></button>`; }).join("")}</div>
        </div>`).join("")}</div>
      ${fieldErr("ed-roles", noRole, "직무를 하나 이상 고르세요")}
      ${st.roles.length ? `<div class="ed-apts">
        <div class="ed-apth"><span>직무 임명일</span>${st.roles.length > 1 ? `<button type="button" class="ed-link" id="ed-aptsame">첫 날짜로 모두 맞춤</button>` : ""}</div>
        <ul>${TR().sortRoles(st.roles.map(x => x.r)).map(r => { const x = st.roles.find(y => y.r === r), g = TR().rgOf(r), bad = st.tried && !isISO(x.apt);
          return `<li class="rg-${g.id}"><span class="ed-aptn">${rgDot(g)}<b>${esc(r)}</b></span>
            <label class="ed-aptd"><span class="sr">${esc(r)} 임명일</span><input type="date" id="ed-apt-${slug(r)}" data-apt="${esc(r)}" value="${esc(x.apt)}" max="${esc(addDays(todayISO(), 180))}" min="1970-01-01" aria-invalid="${bad}"></label>
            <button type="button" class="ed-x" data-unrole="${esc(r)}" aria-label="${esc(r)} 빼기">${svg(IC.x, 16)}</button>
            ${fieldErr("ed-apt-" + slug(r), bad, "임명일을 입력하세요")}</li>`; }).join("")}</ul></div>` : ""}`;
    $$("[data-role]", box).forEach(b => b.addEventListener("click", () => toggleRole(b.dataset.role)));
    $$("[data-unrole]", box).forEach(b => b.addEventListener("click", () => toggleRole(b.dataset.unrole)));
    $$("[data-apt]", box).forEach(inp => {
      const on = () => {
        const x = st.roles.find(y => y.r === inp.dataset.apt);
        if (!x) return;
        x.apt = isISO(inp.value) ? inp.value : "";
        if (st.tried) { const bad = !x.apt; inp.setAttribute("aria-invalid", String(bad)); const e = $("#" + inp.id + "-e"); if (e) e.hidden = !bad; }
        const ok = st.roles.every(y => isISO(y.apt)), num = $("#ed-sec-roles .ed-num");
        if (num) { num.classList.toggle("is-done", ok); num.innerHTML = ok ? svg(IC.check, 16) : "02"; }
        paintSummary(); saveDraft();
      };
      inp.addEventListener("change", on); inp.addEventListener("input", on);
    });
    const same = $("#ed-aptsame", box);
    if (same) same.addEventListener("click", () => {
      const order = TR().sortRoles(st.roles.map(x => x.r));
      const first = order.map(r => st.roles.find(y => y.r === r)).find(x => isISO(x.apt));
      if (!first) { const i = $("[data-apt]", box); if (i) i.focus(); return; }
      st.roles.forEach(x => { x.apt = first.apt; });
      paintRoles(); paintSummary(); saveDraft();
    });
  }
  function toggleRole(r) {
    const i = st.roles.findIndex(x => x.r === r);
    if (i >= 0) st.roles.splice(i, 1); else st.roles.push({ r, apt: "" });
    syncItems();
    paintRoles(); paintItems(); paintSummary(); saveDraft();
    const b = $$("[data-role]").find(x => x.dataset.role === r);
    if (b) b.focus();
  }

  /* 03 이수 교육 */
  const upsOf = (it) => Object.keys(st.ups).map(k => st.ups[k]).filter(u => u.item === it.k);
  function paintItems() {
    const box = $("#ed-sec-items");
    if (!box) return;
    const n = toSubmit().length;
    const okAll = n > 0 && toSubmit().every(it => !Object.keys(itemErrs(it)).length);
    const used = st.items.map(it => it.cid);
    const extra = TR().courses().filter(c => !c.vendor && used.indexOf(c.id) < 0);
    box.innerHTML = secHead(3, "ed-h-items", "이수 교육", okAll, n ? `<span class="ed-sh-m">${n}건 입력</span>` : "")
      + (st.items.length ? `<div class="ed-items">${st.items.map(itemHTML).join("")}</div>`
        : `<div class="ed-empty">${svg(IC.doc, 22)}<span>${st.roles.length ? "이 직무에 지정된 필수 교육이 없습니다." : "직무를 고르면 필수 교육이 나타납니다."}</span></div>`)
      + (st.items.length < MAX_ITEMS && extra.length ? `<div class="ed-add"><label class="ed-addl">${svg(IC.plus, 16)}<span>다른 교육 추가</span>
          <select id="ed-addc" aria-label="다른 교육 추가"><option value="">과정 고르기</option>${addOptions(extra)}</select></label></div>` : "");
    st.items.forEach(wireItem);
    const add = $("#ed-addc", box);
    if (add) add.addEventListener("change", () => {
      const c = courseOf(add.value);
      if (!c) return;
      const g = famOf(c.fam || c.id);
      if (!g) return;
      const it = newItem(g, c.id, false);
      st.items.push(it);
      paintItems(); paintSummary(); saveDraft();
      const d = $("#ed-date-" + it.k); if (d) d.focus();
    });
  }
  function addOptions(list) {
    const grp = (c) => c.fam === "dgr" ? "dg" : (c.legal === "intl" ? "intl" : c.legal === "own" ? "own" : "law");
    return [["law", "법정 (항공보안법 · 지침)"], ["dg", "위험물"], ["intl", "국제 기준"], ["own", "사내 · 기타"]].map(([k, lb]) => {
      const xs = list.filter(c => grp(c) === k);
      return xs.length ? `<optgroup label="${esc(lb)}">${xs.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
  }
  function itemHTML(it) {
    const g = famOf(it.fam), c = courseOf(it.cid);
    const errs = st.tried ? itemErrs(it) : {};
    const role = g ? (g.roles.find(r => st.roles.some(x => x.r === r)) || g.roles[0] || "") : "";
    const rg = role ? TR().rgOf(role) : TR().RGROUPS[TR().RGROUPS.length - 1];
    const kinds = g ? g.courses : [];
    const calc = calcExp(it);
    const exp = it.expTouched ? it.expire : calc;
    const open = filled(it);
    const ups = upsOf(it);
    return `<article class="ed-item rg-${rg.id}${open ? " is-open" : ""}${Object.keys(errs).length ? " is-bad" : ""}" data-item="${it.k}">
      <div class="ed-ih">
        <div class="ed-it"><b>${esc(famShort(g) || (c && c.name) || "")}</b><small>${esc(c ? TR().cycleText(c) : "")}</small></div>
        ${it.auto ? "" : `<button type="button" class="ed-x" data-del="${it.k}" aria-label="이 교육 빼기">${svg(IC.x, 16)}</button>`}
      </div>
      ${kinds.length > 1 ? `<div class="ed-seg" role="group" aria-label="과정">${kinds.map(k => `<button type="button" data-kind="${esc(k.id)}" aria-pressed="${k.id === it.cid}">${esc(k.kind)}</button>`).join("")}</div>` : ""}
      <div class="ed-ig">
        <label class="ed-f"><span class="ed-l">수료일</span>
          <input type="date" id="ed-date-${it.k}" data-f="date" value="${esc(it.date)}" max="${esc(addDays(todayISO(), 1))}" min="2000-01-01" aria-invalid="${!!errs.date}">
          ${fieldErr("ed-date-" + it.k, !!errs.date, errs.date)}</label>
        <div class="ed-f ed-fexp"><span class="ed-l">유효기한</span>
          ${c && (c.step || isPerm(c)) ? `<span class="ed-auto">${c.step ? "단계 과정" : "영구 · 1회"}</span>`
            : `<span class="ed-expw"><input type="date" id="ed-expire-${it.k}" data-f="expire" value="${esc(exp)}" ${it.expTouched ? "" : 'class="is-auto"'} aria-invalid="${!!errs.expire}" aria-describedby="ed-exph-${it.k}">
              <small class="ed-exph" id="ed-exph-${it.k}">${it.expTouched ? (calc && calc !== it.expire ? `<button type="button" class="ed-link" data-reset="${it.k}">자동 ${esc(dot(calc))}</button>` : "") : calc ? "자동 계산" : ""}</small></span>
              ${fieldErr("ed-expire-" + it.k, !!errs.expire, errs.expire)}`}
        </div>
      </div>
      <div class="ed-more">
        <label class="ed-f"><span class="ed-l">교육기관</span><input id="ed-org-${it.k}" data-f="org" value="${esc(it.org)}" maxlength="60" list="ed-dl-org"></label>
        <label class="ed-f"><span class="ed-l">이수증 번호</span><input id="ed-certNo-${it.k}" data-f="certNo" value="${esc(it.certNo)}" maxlength="40"></label>
        <label class="ed-f ed-fh"><span class="ed-l">교육 시간</span><input type="number" id="ed-hours-${it.k}" data-f="hours" value="${esc(it.hours)}" min="0" max="999" step="0.5" inputmode="decimal" aria-invalid="${!!errs.hours}"></label>
      </div>
      <div class="ed-drop${errs.files ? " is-bad" : ""}" id="ed-files-${it.k}" data-drop="${it.k}">
        ${it.files.map((f, i) => `<span class="ed-file">${svg(IC.doc, 16)}<span class="ed-fn">${esc(f.name)}</span><small class="mono">${esc(kb(f.size || 0))}</small>
          <button type="button" class="ed-x" data-fdel="${i}" aria-label="${esc(f.name)} 빼기">${svg(IC.x, 14)}</button></span>`).join("")}
        ${ups.map(u => `<span class="ed-file is-up${u.err ? " is-err" : ""}" data-up="${u.id}">${svg(u.err ? IC.alert : IC.up, 16)}<span class="ed-fn">${esc(u.name)}</span>
          ${u.err ? `<small>${esc(u.err)}</small><button type="button" class="ed-x" data-updel="${u.id}" aria-label="닫기">${svg(IC.x, 14)}</button>` : `<span class="ed-bar"><i id="ed-bar-${u.id}"></i></span>`}</span>`).join("")}
        ${it.files.length + ups.filter(u => !u.err).length < MAX_FILES ? `<button type="button" class="ed-pick" data-pick="${it.k}">${svg(IC.up, 18)}<span>${it.files.length ? "파일 더 올리기" : "이수증 올리기"}</span><small>PDF · 사진 · 끌어 놓기</small></button>` : ""}
        <input type="file" id="ed-file-${it.k}" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*" multiple hidden>
        ${fieldErr("ed-files-" + it.k, !!errs.files, errs.files)}
      </div>
    </article>`;
  }
  function itemBox(it) { return $(`[data-item="${it.k}"]`); }
  function repaintItem(it) {
    const el = itemBox(it);
    if (!el) { paintItems(); return; }
    const tmp = document.createElement("div");
    tmp.innerHTML = itemHTML(it);
    el.replaceWith(tmp.firstElementChild);
    wireItem(it);
    paintHeadStates();
  }
  function paintHeadStates() {
    const n = toSubmit().length, num = $("#ed-sec-items .ed-num");
    const okAll = n > 0 && toSubmit().every(it => !Object.keys(itemErrs(it)).length);
    if (num) { num.classList.toggle("is-done", okAll); num.innerHTML = okAll ? svg(IC.check, 16) : "03"; }
    const m = $("#ed-sec-items .ed-sh-m");
    if (m) m.textContent = n ? n + "건 입력" : "";
    else if (n) { const h = $("#ed-sec-items .ed-sh"); if (h) h.insertAdjacentHTML("beforeend", `<span class="ed-sh-m">${n}건 입력</span>`); }
  }
  function wireItem(it) {
    const el = itemBox(it);
    if (!el) return;
    $$("[data-kind]", el).forEach(b => b.addEventListener("click", () => {
      it.cid = b.dataset.kind;
      if (!it.expTouched) it.expire = "";
      repaintItem(it); paintSummary(); saveDraft();
    }));
    $$("[data-f]", el).forEach(inp => {
      const f = inp.dataset.f;
      /* 입력칸은 다시 만들지 않는다(날짜 칸 입력 위치 · 한글 조합 유지) — 딸린 부분만 고친다 */
      const on = () => {
        if (f === "date") it.date = isISO(inp.value) ? inp.value : "";
        else if (f === "expire") { it.expire = isISO(inp.value) ? inp.value : ""; it.expTouched = !!inp.value; }
        else if (f === "hours") it.hours = inp.value;
        else it[f] = norm(inp.value);
        itemBits(it);
        if (st.tried) liveErr(it);
        paintSummary(); saveDraft();
      };
      inp.addEventListener("input", on);
      if (f === "date" || f === "expire") inp.addEventListener("change", on);
    });
    const rs = $("[data-reset]", el);
    if (rs) rs.addEventListener("click", () => { it.expTouched = false; it.expire = ""; repaintItem(it); paintSummary(); saveDraft(); });
    const del = $("[data-del]", el);
    if (del) del.addEventListener("click", () => {
      st.items = st.items.filter(x => x !== it);
      Object.keys(st.ups).forEach(k => { if (st.ups[k].item === it.k) delete st.ups[k]; });
      paintItems(); paintSummary(); saveDraft();
    });
    $$("[data-fdel]", el).forEach(b => b.addEventListener("click", () => { it.files.splice(Number(b.dataset.fdel), 1); repaintItem(it); paintSummary(); saveDraft(); }));
    $$("[data-updel]", el).forEach(b => b.addEventListener("click", () => { delete st.ups[b.dataset.updel]; repaintItem(it); paintSummary(); }));
    const inp = $("#ed-file-" + it.k), pick = $("[data-pick]", el);
    if (pick && inp) {
      pick.addEventListener("click", () => inp.click());
      inp.addEventListener("change", () => { const fl = Array.from(inp.files || []); inp.value = ""; addFiles(it, fl); });
    }
    const drop = $("[data-drop]", el);
    if (drop) {
      drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("is-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
      drop.addEventListener("drop", (ev) => {
        ev.preventDefault(); drop.classList.remove("is-over");
        addFiles(it, Array.from((ev.dataTransfer && ev.dataTransfer.files) || []));
      });
    }
  }
  /* 유효기한(자동) · 안내 · 펼침만 고친다 */
  function itemBits(it) {
    const el = itemBox(it);
    if (!el) return;
    el.classList.toggle("is-open", filled(it));
    const ex = document.getElementById("ed-expire-" + it.k), h = document.getElementById("ed-exph-" + it.k);
    const calc = calcExp(it);
    if (ex && !it.expTouched) { ex.value = calc; ex.classList.add("is-auto"); }
    if (ex && it.expTouched) ex.classList.remove("is-auto");
    if (h) h.innerHTML = it.expTouched ? (calc && calc !== it.expire ? `<button type="button" class="ed-link" data-reset="${it.k}">자동 ${esc(dot(calc))}</button>` : "") : calc ? "자동 계산" : "";
    const rs = h && $("[data-reset]", h);
    if (rs) rs.addEventListener("click", () => { it.expTouched = false; it.expire = ""; repaintItem(it); paintSummary(); saveDraft(); });
    paintHeadStates();
  }
  function liveErr(it) {
    const errs = itemErrs(it), el = itemBox(it);
    if (!el) return;
    ["date", "expire", "files", "hours"].forEach(k => {
      const e = document.getElementById("ed-" + k + "-" + it.k + "-e");
      if (e) { e.hidden = !errs[k]; e.textContent = errs[k] || ""; }
      const i = document.getElementById("ed-" + k + "-" + it.k);
      if (i && i.tagName === "INPUT") i.setAttribute("aria-invalid", String(!!errs[k]));
    });
    el.classList.toggle("is-bad", !!Object.keys(errs).length);
    paintHeadStates();
  }

  /* 이수증 올리기 — 표(작업증명) → 업로드 URL → PUT(진행률) */
  async function addFiles(it, list) {
    const room = MAX_FILES - it.files.length - upsOf(it).filter(u => !u.err).length;
    const take = list.slice(0, Math.max(0, room));
    if (!take.length) return;
    const jobs = take.map(file => {
      const id = "u" + (++seq);
      const bad = !FILE_RE.test(file.name || "") ? "PDF · 사진만" : !(file.size > 0) ? "빈 파일" : file.size > FILE_MAX ? "20MB 이하" : "";
      st.ups[id] = { id, item: it.k, name: file.name || "파일", pct: 0, err: bad };
      return { id, file, bad };
    });
    repaintItem(it); paintSummary();
    for (const j of jobs) {
      if (j.bad) continue;
      const u = st.ups[j.id];
      try {
        const meta = await claimUpload(j.file);
        await putFile(meta.upload, j.file, (p) => { if (st.ups[j.id]) { st.ups[j.id].pct = p; const b = document.getElementById("ed-bar-" + j.id); if (b) b.style.width = Math.round(p * 100) + "%"; } });
        if (!st.ups[j.id]) continue;                          // 그 사이 칸을 뺐다
        delete st.ups[j.id];
        if (st.items.indexOf(it) >= 0) it.files.push({ path: meta.path, url: meta.url, name: j.file.name || "이수증", size: j.file.size || 0 });
      } catch (e) {
        if (u && st.ups[j.id]) u.err = upErr(e);
        if (e && (e.code === "closed" || e.code === "expired" || e.code === "invalid")) { linkGone(e.code, e.d); return; }
      }
      if (st.items.indexOf(it) >= 0) repaintItem(it);
      paintSummary(); saveDraft();
    }
  }
  function upErr(e) {
    const c = String((e && (e.code || e.message)) || "");
    if (/too_many/.test(c)) return "파일이 너무 많습니다";
    if (/too_large|413/.test(c)) return "20MB 이하";
    if (/type|415/.test(c)) return "PDF · 사진만";
    if (/limit|busy/.test(c)) return "잠시 후 다시";
    return "올리지 못했습니다";
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

  /* 요약 (PC 오른쪽 · 모바일 아래) */
  function paintSummary() {
    const side = $("#ed-side"), bar = $("#ed-mbar");
    if (!side) return;
    const errs = check(), subs = toSubmit();
    const ready = !errs.length && !st.sending;
    const roles = TR().sortRoles(st.roles.map(x => x.r));
    side.innerHTML = `<div class="ed-tag">
      <div class="ed-tag-top"><span>등록 요약</span><span class="mono">ICNKF</span></div>
      <dl class="ed-tag-grid">
        <div><dt>성명</dt><dd>${norm(st.name) ? esc(norm(st.name)) : '<span class="ed-nil">-</span>'}</dd></div>
        <div><dt>소속</dt><dd>${norm(st.dept) ? esc(norm(st.dept)) : '<span class="ed-nil">-</span>'}</dd></div>
      </dl>
      <div class="ed-tag-sec"><small>직무</small>${roles.length ? `<ul class="ed-tag-roles">${roles.map(r => { const x = st.roles.find(y => y.r === r);
        return `<li>${rgDot(TR().rgOf(r))}<span>${esc(r)}</span><b class="mono">${x && isISO(x.apt) ? esc(dot(x.apt)) : '<span class="ed-nil">임명일</span>'}</b></li>`; }).join("")}</ul>` : '<p class="ed-nil">-</p>'}</div>
      <div class="ed-tag-sec"><small>이수 교육</small>${subs.length ? `<ul class="ed-tag-recs">${subs.map(it => { const c = courseOf(it.cid), g = famOf(it.fam);
        const e = it.expTouched ? it.expire : calcExp(it);
        return `<li><span>${esc(famShort(g))}<em>${esc(c ? c.kind : "")}</em></span><b class="mono">${isISO(it.date) ? esc(dot(it.date).slice(2)) : "-"}${e ? " → " + esc(dot(e).slice(2)) : ""}</b>
          <i class="ed-fc${it.files.length ? " is-ok" : ""}" title="이수증 ${it.files.length}개">${svg(IC.doc, 14)}${it.files.length}</i></li>`; }).join("")}</ul>` : '<p class="ed-nil">없음</p>'}</div>
      <div class="ed-tag-foot">
        ${st.msg ? `<p class="ed-msg" role="alert">${svg(IC.alert, 16)}<span>${esc(st.msg)}</span></p>` : ""}
        ${errs.length && (st.tried || norm(st.name)) ? `<p class="ed-miss"><span>남은 항목</span>${esc(missText(errs))}</p>` : ""}
        <button type="button" class="ed-btn ed-submit" id="ed-submit"${st.sending ? " disabled" : ""} data-ready="${ready}">${st.sending ? "제출하는 중" : "제출"}</button>
      </div>
    </div>`;
    if (bar) bar.innerHTML = `<div class="ed-mbar-in"><span class="ed-mbar-t"><span>${subs.length ? `교육 <b>${subs.length}</b>건` : st.roles.length ? `직무 <b>${st.roles.length}</b>개` : "보안교육 이수 등록"}</span>${errs.length && st.tried ? `<small>${esc(missText(errs))}</small>` : ""}</span>
      <button type="button" class="ed-btn ed-submit" id="ed-msubmit"${st.sending ? " disabled" : ""} data-ready="${ready}">${st.sending ? "제출하는 중" : "제출"}</button></div>`;
    $$("#ed-submit, #ed-msubmit").forEach(b => b.addEventListener("click", submit));
  }

  /* ─── 제출 ─── */
  function errText(d) {
    const code = String((d && d.error) || "");
    const M = {
      required: "입력하지 않은 칸이 있습니다.", too_long: "입력한 내용이 너무 깁니다.", roles: "직무를 다시 골라 주세요.",
      date: "날짜를 확인해 주세요.", course: "과정을 다시 골라 주세요.", files: "이수증을 다시 올려 주세요.",
      dup_rec: "같은 과정 · 수료일이 두 번 들어 있습니다.", too_many: "한 번에 10건까지 등록할 수 있습니다.",
      catalog: "과정 기준을 불러오지 못했습니다. 안전보안파트에 알려 주세요.", ticket: "보안 확인이 끝났습니다. 다시 제출해 주세요.",
      net: "서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 제출해 주세요."
    };
    if (code === "limit" || code === "busy") return "잠시 후 다시 시도해 주세요 (" + (Number(d.wait) || 10) + "분).";
    if (/^pow/.test(code)) return "보안 확인에 실패했습니다. 다시 제출해 주세요.";
    return M[code] || "제출하지 못했습니다. 다시 시도해 주세요.";
  }
  function payload() {
    return {
      sid: st.sid, name: norm(st.name), dept: norm(st.dept),
      roles: st.roles.map(x => ({ r: x.r, apt: x.apt })),
      recs: toSubmit().map(it => {
        const calc = calcExp(it);
        const h = it.hours === "" ? null : Number(it.hours);
        return { cid: it.cid, date: it.date, expire: it.expTouched && isISO(it.expire) && it.expire !== calc ? it.expire : "",
          hours: h != null && isFinite(h) ? h : null, org: it.org, certNo: it.certNo,
          files: it.files.map(f => ({ path: f.path, name: f.name })) };
      })
    };
  }
  async function submit() {
    if (st.sending) return;
    st.tried = true; st.msg = "";
    const errs = check();
    if (errs.length) {
      paintRoles(); st.items.forEach(liveErr); paintSummary();
      const first = errs[0], el = document.getElementById(first.id);
      const sec = el && el.closest(".ed-sec, .ed-item, .ed-apts");
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "center", behavior: "smooth" });
      if (el && el.focus && el.tagName !== "DIV") setTimeout(() => el.focus({ preventScroll: true }), 250);
      markPerson();
      return;
    }
    if (!st.sid) st.sid = uid();
    st.sending = true; busy(true); paintSummary();
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
    paintSummary();
  }
  function markPerson() {
    [["ed-name", st.name], ["ed-dept", st.dept]].forEach(([id, v]) => {
      const i = document.getElementById(id), e = document.getElementById(id + "-e");
      if (i) i.setAttribute("aria-invalid", String(!norm(v)));
      if (e) e.hidden = !!norm(v);
    });
  }
  function busy(on) {
    const b = $("#ed-busy");
    if (b) b.classList.toggle("hidden", !on);
  }
  function linkGone(code, d) {
    st.view = "error"; st.err = code; st.errInfo = d || null;
    render();
  }

  /* ═════════ 제출 뒤 — 제출 정보 · 다음 갱신 ═════════ */
  function finish(d) {
    const sent = { name: norm(st.name), dept: norm(st.dept), roles: st.roles.map(x => Object.assign({}, x)),
      recs: toSubmit().map(it => ({ cid: it.cid, date: it.date, files: it.files.length })) };
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
    const kindLb = { new: "새로 등록", updated: "기존 정보 갱신", dup: "새로 등록 · 동명이인 확인 예정" }[res.kind] || "등록";
    const cal = gd.list.filter(x => { const n = nextLine(x); return isISO(n.at) && n.at >= todayISO(); });
    return `<div class="ed-wrap ed-wrap-done">
      <section class="ed-ok">
        <span class="ed-okico" aria-hidden="true">${svg(IC.check, 30)}</span>
        <div><h2>등록되었습니다</h2><p>${esc(kindLb)}</p></div>
        <dl class="ed-rcpt"><div><dt>접수 번호</dt><dd class="mono">${esc(res.receipt || "-")}</dd></div><div><dt>제출 시각</dt><dd class="mono">${esc(String(res.at || "").replace(/-/g, "."))}</dd></div></dl>
      </section>
      <div class="ed-dgrid">
        <section class="ed-card" aria-labelledby="ed-h-next">
          <h3 id="ed-h-next">다음 갱신</h3>
          ${gd.list.length ? `<ul class="ed-next">${gd.list.map(x => { const n = nextLine(x), s = TR().ST[x.st] || { label: "", tone: "gray" };
            return `<li class="tone-${esc(s.tone)}"><div class="ed-nh"><b>${esc(famShort(x.g))}</b><span class="ed-chipst tone-${esc(s.tone)}">${esc(s.label)}</span>${x.mine ? '<small class="ed-mine">이번 제출</small>' : ""}</div>
              <div class="ed-nb"><span class="ed-nl">${n.end ? "다음 이수 기간" : n.at ? "다음 일정" : "상태"}</span><b${/\d/.test(n.main) ? ' class="mono"' : ""}>${esc(n.main)}</b>${n.sub ? `<small>${esc(n.sub)}</small>` : ""}</div>
              ${n.at ? `<span class="ed-dd mono">${esc(dday(n.at))}</span>` : ""}</li>`; }).join("")}</ul>`
            : `<p class="ed-nil">해당 직무의 필수 교육이 없습니다.</p>`}
          ${cal.length ? `<button type="button" class="ed-btn ed-btn-soft" id="ed-ics">${svg(IC.cal, 18)}<span>캘린더에 추가</span></button>` : ""}
        </section>
        <section class="ed-card" aria-labelledby="ed-h-sent">
          <h3 id="ed-h-sent">제출 정보</h3>
          <dl class="ed-sent">
            <div><dt>성명</dt><dd>${esc(sent.name)}</dd></div>
            <div><dt>소속</dt><dd>${esc(sent.dept)}</dd></div>
            <div><dt>직무</dt><dd><ul>${TR().sortRoles(sent.roles.map(x => x.r)).map(r => { const x = sent.roles.find(y => y.r === r);
              return `<li>${rgDot(TR().rgOf(r))}<span>${esc(r)}</span><small class="mono">임명 ${esc(dot(x.apt))}</small></li>`; }).join("")}</ul></dd></div>
            <div><dt>이수 교육</dt><dd>${sent.recs.length ? `<ul>${sent.recs.map(r => { const c = courseOf(r.cid);
              return `<li><span>${esc(c ? c.name : r.cid)}</span><small class="mono">${esc(dot(r.date))} · 이수증 ${r.files}</small></li>`; }).join("")}</ul>` : '<span class="ed-nil">없음</span>'}</dd></div>
          </dl>
        </section>
      </div>
      <div class="ed-actions">
        <button type="button" class="ed-btn ed-btn-ghost" id="ed-again">${svg(IC.plus, 18)}<span>교육 더 등록</span></button>
        <button type="button" class="ed-btn ed-btn-ghost" id="ed-dprint">${svg(IC.print, 18)}<span>Print</span></button>
      </div>
    </div>`;
  }
  function wireDone() {
    const ics = $("#ed-ics"); if (ics) ics.addEventListener("click", downloadIcs);
    const ag = $("#ed-again");
    if (ag) ag.addEventListener("click", () => {
      st.items = []; st.sid = ""; st.tried = false; st.msg = ""; st.done = null; st.ups = {};
      syncItems();
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

  /* ═════════ 링크 오류 ═════════ */
  function errorHTML() {
    const e = st.err, d = st.errInfo || {};
    const T = {
      nocode: ["링크를 다시 확인해 주세요", "메일로 받은 링크를 그대로 열어 주세요."],
      invalid: ["링크를 다시 확인해 주세요", "메일로 받은 링크를 그대로 열어 주세요."],
      closed: ["등록이 마감되었습니다", ""],
      expired: ["등록 기간이 끝났습니다", isISO(d.expires) ? "기한 " + dotW(d.expires) : ""],
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

  /* ═════════ 시작 ═════════ */
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
    if (!loadDraft()) { st.dept = ""; }
    syncItems();
    st.view = "form";
    render();
    document.body.insertAdjacentHTML("beforeend", `<datalist id="ed-dl-org">${((d.orgs || [])).map(o => `<option value="${esc(o)}">`).join("")}</datalist>`);
    const n = $("#ed-name"); if (n && !st.name && window.matchMedia && window.matchMedia("(min-width: 768px)").matches) n.focus();
  }
  function init() {
    const pb = $("#ed-print");
    if (pb) pb.addEventListener("click", () => window.print());
    window.addEventListener("hashchange", () => { if (codeFromUrl() !== st.code) { st.view = "load"; render(); start(); } });
    start();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.SemisEdu = { st, check, payload, calcExp, syncItems, toggleRole, guidance, nextLine, icsText, codeFromUrl, errText, render,
    setToday(t) { fixedToday = isISO(t) ? t : ""; if (TR() && TR().setToday) TR().setToday(t); } };
})();
