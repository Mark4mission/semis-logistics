/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 보안교육 · 자격 관리 (v1.20, 라우트 training)
   예정 메뉴 '안전보안 교육 관리(training)' + '이수증 관리(certs)'를 하나로 합친 화면.

   화면
   - 이수 현황: 당사 인원 × 교육 묶음(초기 · 정기) 유효 여부 표 · 만료 임박/만료/미이수 · SSI 서약
   - 교육 기록: 당사 실시 교육(기록 8항목: 명칭 · 일시 · 장소 · 시간 · 교관 · 시간표 · 평가결과 · 참석자 명단/서명)
                + 협력사 교육 확인(업체 · 과정 · 확인일 · 대상/이수 인원 · 결과 파일)
   - 인원: 당사 인원 명부(직무 · 재직/퇴직 · SSI 서약) · 개인별 이수 기록 · 보관 기한(퇴직 후 90일)
   - 과정 관리(hq): 과정 이름 · 초기/정기 · 묶음 · 주기(개월) · 대상 직무

   데이터 DATA.training = {
     courses[{ id, name, fam, kind(초기|정기|수시), cycle(개월, 0 = 기한 없음), roles[], all(전 직원), vendor(협력사 확인용) }] — 비면 코드 기본 과정
     people[{ id, name, dept, roles[], left(퇴직일), pledge(SSI 서약일), pledgeFiles[], note }]
     records[{ id, pid, cid, date, expire, hours, score, org, certNo, files[], sessionId, note, src }]
     sessions[{ id, type(own|vendor), cid, title, date, time, hours, place, instructor, evalText, pids[],
                files{ tt[], roster[], eval[] }, vendor, target, done, note, createdAt/By, updatedAt/By }] }
   권한: 열람 mgr(권한표 training 2) · 편집 hq(3). 파일은 비공개 버킷 training/ 폴더(열람 2 · 올리기 3).
   수검 대응 센터의 증빙 연결: window.SemisEvidence.training(mid) → { ok, text } (체크리스트 1.1~1.4 · 2.10 · 3.4 · 8.2 · 9.2 등)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "training";
  const KEY = "training";
  const TITLE = "보안교육 · 자격 관리";
  const FOLDER = "training";
  const FILE_MAX = 50 * 1024 * 1024;
  const SOON = 60;                                      // 만료 임박(일)
  const KEEP_YEARS = 3, KEEP_LEFT_DAYS = 90;            // 교육기록 보관 3년 · 퇴직 후 90일
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "";
  const todayISO = () => fixedToday || toISO(new Date());
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const ymd2 = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : "");
  const me = () => (SeMIS.user && SeMIS.user.name) || "";
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const num = (v) => { const n = Number(v); return v === "" || v == null || !isFinite(n) ? null : n; };
  const addDays = (iso, n) => { const t = new Date(utc(iso) + n * 86400000); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  /* 유효기한: 수료일 + 주기(개월) − 1일 (월말 보정) — SeMIS v2 이수증 관리와 같은 셈 */
  function calcExpire(iso, months) {
    months = Number(months) || 0;
    if (!isISO(iso) || months <= 0) return "";
    const y0 = Number(iso.slice(0, 4)), m0 = Number(iso.slice(5, 7)) - 1, d0 = Number(iso.slice(8, 10));
    let mo = m0 + months; const y = y0 + Math.floor(mo / 12); mo %= 12;
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const t = new Date(Date.UTC(y, mo, Math.min(d0, dim)) - 86400000);
    return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate());
  }

  /* ─────── 과정 · 직무 ─────── */
  const ROLES = ["보안감독자", "보안검색감독자", "ACMR", "화물보안 요원", "장비 운용자", "SSI 취급자"];
  /* 기본 과정 — 주기는 hq가 과정 관리에서 고친다(최소 시간 · 합격 점수 같은 세부 기준은 규정 원문을 따라 입력) */
  const DEF_COURSES = [
    { id: "c-sup-i", fam: "sup", name: "보안책임자 · 감독자 초기", kind: "초기", cycle: 13, roles: ["보안감독자"] },
    { id: "c-sup-r", fam: "sup", name: "보안책임자 · 감독자 정기", kind: "정기", cycle: 13, roles: ["보안감독자"] },
    { id: "c-scr-i", fam: "scr", name: "보안검색감독자 초기", kind: "초기", cycle: 13, roles: ["보안검색감독자"] },
    { id: "c-scr-r", fam: "scr", name: "보안검색감독자 정기", kind: "정기", cycle: 13, roles: ["보안검색감독자"] },
    { id: "c-acmr-i", fam: "acmr", name: "ACMR 초기", kind: "초기", cycle: 12, roles: ["ACMR"] },
    { id: "c-acmr-r", fam: "acmr", name: "ACMR 정기", kind: "정기", cycle: 12, roles: ["ACMR"] },
    { id: "c-cargo-i", fam: "cargo", name: "화물보안 초기", kind: "초기", cycle: 12, roles: ["화물보안 요원"] },
    { id: "c-cargo-r", fam: "cargo", name: "화물보안 정기", kind: "정기", cycle: 12, roles: ["화물보안 요원"] },
    { id: "c-equip", fam: "equip", name: "검색장비 운용 교육", kind: "초기", cycle: 0, roles: ["장비 운용자"] },
    { id: "c-aware", fam: "aware", name: "보안 인지교육", kind: "정기", cycle: 12, roles: [], all: true },
    { id: "v-screen", fam: "v-screen", name: "보안검색요원 교육 · 자격", kind: "정기", cycle: 12, roles: [], vendor: true },
    { id: "v-tsa", fam: "v-tsa", name: "TSA 교육", kind: "정기", cycle: 12, roles: [], vendor: true },
    { id: "v-drug", fam: "v-drug", name: "향정신성 물질 절차 교육", kind: "정기", cycle: 12, roles: [], vendor: true },
    { id: "v-aware", fam: "v-aware", name: "보안 인지교육(협력사)", kind: "정기", cycle: 12, roles: [], vendor: true }
  ];
  const KINDS = ["초기", "정기", "수시"];

  /* ─────── 데이터 ─────── */
  function T() {
    let t = D()[KEY];
    if (!t || typeof t !== "object" || Array.isArray(t)) t = D()[KEY] = { courses: [], people: [], records: [], sessions: [] };
    ["courses", "people", "records", "sessions"].forEach(k => { if (!Array.isArray(t[k])) t[k] = []; });
    return t;
  }
  const arr = (k) => { const t = D()[KEY]; return t && Array.isArray(t[k]) ? t[k].filter(x => x && typeof x === "object" && x.id) : []; };
  const courses = () => { const c = arr("courses"); return c.length ? c : DEF_COURSES; };
  const people = () => arr("people");
  const records = () => arr("records");
  const sessions = () => arr("sessions");
  const courseOf = (id) => courses().find(c => c.id === id) || null;
  const personOf = (id) => people().find(p => p.id === id) || null;
  const active = (p, t) => !!p && !(isISO(p.left) && p.left <= (t || todayISO()));
  const rolesOf = (p) => (p && Array.isArray(p.roles) ? p.roles : []);
  const ownCourses = () => courses().filter(c => !c.vendor);
  const vendorCourses = () => courses().filter(c => c.vendor);
  const filesOf = (x) => (x && Array.isArray(x) ? x : []);
  const sfiles = (s, k) => filesOf(s && s.files && s.files[k]);
  function allRoles() {
    const s = ROLES.slice();
    const add = (r) => { r = norm(r); if (r && s.indexOf(r) < 0) s.push(r); };
    courses().forEach(c => (c.roles || []).forEach(add));
    people().forEach(p => rolesOf(p).forEach(add));
    return s;
  }
  /* 묶음(초기 · 정기) — 이름은 과정 이름에서 '초기 · 정기'를 뗀 것 */
  function fams(vendor) {
    const out = [];
    courses().filter(c => !!c.vendor === !!vendor).forEach(c => {
      const f = c.fam || c.id;
      let g = out.find(x => x.fam === f);
      if (!g) { g = { fam: f, name: norm(String(c.name || "").replace(/\s*(초기|정기|수시)\s*$/, "")) || c.name, courses: [] }; out.push(g); }
      g.courses.push(c);
    });
    return out;
  }
  const famOf = (f) => fams(false).find(g => g.fam === f) || fams(true).find(g => g.fam === f) || null;
  const needs = (p, g) => g.courses.some(c => c.all || (c.roles || []).some(r => rolesOf(p).indexOf(r) >= 0));
  function expireOf(r) {
    if (!r) return "";
    if (isISO(r.expire)) return r.expire;
    const c = courseOf(r.cid);
    return calcExpire(r.date, c ? c.cycle : 0);
  }
  /* 한 사람 · 한 묶음의 상태: ok(유효) · soon(임박) · exp(만료) · none(미이수) */
  function famStatus(p, g, t) {
    t = t || todayISO();
    const ids = g.courses.map(c => c.id);
    const rs = records().filter(r => r.pid === p.id && ids.indexOf(r.cid) >= 0 && isISO(r.date))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!rs.length) return { st: "none" };
    const r = rs[0], exp = expireOf(r);
    if (!exp) return { st: "ok", r, exp: "" };
    const d = dayDiff(t, exp);
    return { st: d < 0 ? "exp" : d <= SOON ? "soon" : "ok", r, exp, d };
  }
  const ST = { ok: { label: "유효", tone: "green" }, soon: { label: "임박", tone: "amber" }, exp: { label: "만료", tone: "red" }, none: { label: "미이수", tone: "red" } };
  /* 이수 현황 표의 칸 — 필요한 사람 × 필요한 묶음 */
  function grid(t) {
    const gs = fams(false);
    const ps = people().filter(p => active(p, t));
    const cells = [];
    ps.forEach(p => gs.forEach(g => { if (needs(p, g)) cells.push(Object.assign({ p, g }, famStatus(p, g, t))); }));
    return { gs: gs.filter(g => cells.some(c => c.g === g)), ps, cells };
  }
  function stats(t) {
    t = t || todayISO();
    const { ps, cells } = grid(t);
    const n = (st) => cells.filter(c => c.st === st).length;
    const ssi = ps.filter(p => rolesOf(p).indexOf("SSI 취급자") >= 0);
    return { people: ps.length, cells: cells.length, ok: n("ok"), soon: n("soon"), exp: n("exp"), none: n("none"),
      valid: cells.length ? Math.round((n("ok") + n("soon")) / cells.length * 100) : null,
      ssi: ssi.length, ssiMiss: ssi.filter(p => !isISO(p.pledge)).length };
  }
  /* 교육 기록 8항목(자체보안계획 교육기록 보관 항목) — 비어 있는 항목 이름 */
  const EIGHT = [
    ["명칭", s => !!norm(s.title)], ["일시", s => isISO(s.date) && !!norm(s.time)], ["장소", s => !!norm(s.place)],
    ["시간", s => num(s.hours) != null && num(s.hours) > 0], ["교관", s => !!norm(s.instructor)], ["시간표", s => sfiles(s, "tt").length > 0],
    ["평가결과", s => !!norm(s.evalText) || sfiles(s, "eval").length > 0], ["참석자 명단 · 서명", s => sfiles(s, "roster").length > 0]
  ];
  const missing = (s) => EIGHT.filter(([, f]) => !f(s)).map(([k]) => k);
  const keepOver = (s, t) => isISO(s.date) && addDays(s.date, KEEP_YEARS * 365) < (t || todayISO());
  const leftOver = (p, t) => isISO(p.left) && addDays(p.left, KEEP_LEFT_DAYS) < (t || todayISO());
  const within12 = (iso, t) => isISO(iso) && dayDiff(iso, t || todayISO()) <= 365 && iso <= (t || todayISO());
  function sessionTitle(s) {
    if (s.type === "vendor") { const c = courseOf(s.cid); return norm([s.vendor, c ? c.name : s.title].filter(Boolean).join(" · ")) || "협력사 교육 확인"; }
    return norm(s.title) || (courseOf(s.cid) || {}).name || "교육";
  }
  function stamp(x) { x.updatedAt = new Date().toISOString(); x.updatedBy = me(); }

  /* ─────── 수검 대응 센터 증빙 연결 ───────
     점검 체크리스트 항목 번호 → 이 화면의 실제 기록으로 증빙 여부 판단(없으면 '증빙 없음'). 번호만 쓰고 원문은 쓰지 않는다. */
  function roleValid(role, t) {
    const gs = fams(false).filter(g => g.courses.some(c => (c.roles || []).indexOf(role) >= 0));
    const ps = people().filter(p => active(p, t) && rolesOf(p).indexOf(role) >= 0);
    const ok = ps.filter(p => gs.every(g => ["ok", "soon"].indexOf(famStatus(p, g, t).st) >= 0)).length;
    return { n: ps.length, ok };
  }
  const vendorRecent = (fam, t) => sessions().filter(s => s.type === "vendor" && (!fam || (courseOf(s.cid) || {}).fam === fam) && within12(s.date, t));
  function evidence(mid) {
    const t = todayISO();
    const role = (r, label) => { const v = roleValid(r, t); return { ok: v.n > 0 && v.ok === v.n, text: v.n ? `${label} ${v.ok}/${v.n}명 유효` : `${label} 등록 없음` }; };
    const vend = (fam, label) => { const k = vendorRecent(fam, t).length; return { ok: k > 0, text: k ? `${label} 확인 ${k}건(1년)` : `${label} 확인 없음` }; };
    switch (String(mid || "")) {
      case "1.1": return role("보안감독자", "보안감독자");
      case "9.2": return role("ACMR", "ACMR");
      case "1.2": { const k = sessions().filter(s => s.type !== "vendor" && within12(s.date, t)).length; return { ok: k > 0, text: k ? `교육 기록 ${k}건(1년)` : "최근 1년 교육 기록 없음" }; }
      case "1.3": return vend("", "협력사 교육");
      case "1.4": { const own = sessions().filter(s => s.type !== "vendor"); const k = own.filter(s => !missing(s).length).length;
        return { ok: own.length > 0 && k === own.length, text: own.length ? `기록 8항목 완비 ${k}/${own.length}` : "교육 기록 없음" }; }
      case "2.10": case "2.10.1": { const ps = people().filter(p => active(p, t) && rolesOf(p).indexOf("SSI 취급자") >= 0);
        const k = ps.filter(p => isISO(p.pledge)).length; return { ok: ps.length > 0 && k === ps.length, text: ps.length ? `SSI 서약 ${k}/${ps.length}명` : "SSI 취급자 등록 없음" }; }
      case "3.4": return vend("v-drug", "향정신성 물질 교육");
      case "9.2.1": return vend("v-tsa", "TSA 교육");
      case "8.2": { const v = roleValid("장비 운용자", t), k = vendorRecent("v-screen", t).length;
        return { ok: (v.n > 0 && v.ok === v.n) || k > 0, text: [v.n ? `장비 운용자 ${v.ok}/${v.n}명 유효` : "", k ? `검색요원 확인 ${k}건(1년)` : ""].filter(Boolean).join(" · ") || "기록 없음" }; }
      default: return null;
    }
  }
  if (typeof window !== "undefined") (window.SemisEvidence = window.SemisEvidence || {})[MOD] = evidence;

  /* ─────── 화면 상태 ─────── */
  let tab = "grid", q = "", roleF = "", onlyAct = false, year = "", sType = "all", pState = "active";
  const TABS = [["grid", "이수 현황"], ["sessions", "교육 기록"], ["people", "인원"]];
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "") || "dashboard";
  const segHTML = (name, items, cur) => `<div class="seg" role="group" aria-label="${esc(name)}">${items.map(([v, lb]) =>
    `<button type="button" class="seg-btn" data-tseg="${esc(name)}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(lb)}</button>`).join("")}</div>`;
  const hay = (a) => a.map(v => String(v || "")).join(" ").toLowerCase();
  function fileChips(files) {
    return filesOf(files).map(f => `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>`).join("");
  }
  function cellChip(c) {
    if (!c) return '<span class="tr-na">-</span>';
    const s = ST[c.st];
    const sub = c.st === "none" ? "" : c.exp ? (c.st === "exp" ? "D+" + (-c.d) : c.st === "soon" ? "D-" + c.d : "~" + ymd2(c.exp)) : "기한 없음";
    return `<span class="tr-cell" data-st="${c.st}">${ui.chip(s.label, s.tone)}${sub ? `<small class="mono">${esc(sub)}</small>` : ""}</span>`;
  }

  /* ═════════ 이수 현황 ═════════ */
  function gridHTML(canW) {
    const t = todayISO(), st = stats(t), g = grid(t);
    const byP = (p) => g.cells.filter(c => c.p === p);
    const rows = g.ps.filter(p => {
      if (roleF && rolesOf(p).indexOf(roleF) < 0) return false;
      if (onlyAct && !byP(p).some(c => c.st !== "ok") && !(rolesOf(p).indexOf("SSI 취급자") >= 0 && !isISO(p.pledge))) return false;
      return !q || hay([p.name, p.dept, rolesOf(p).join(" ")]).indexOf(q.toLowerCase()) >= 0;
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    const due = g.cells.filter(c => c.st === "exp" || c.st === "soon").sort((a, b) => String(a.exp).localeCompare(String(b.exp)));
    const ssiCol = g.ps.some(p => rolesOf(p).indexOf("SSI 취급자") >= 0);
    const roleOpts = [["", "전체"]].concat(allRoles().filter(r => g.ps.some(p => rolesOf(p).indexOf(r) >= 0)).map(r => [r, r]));
    return ui.stats([
      { label: "당사 인원", value: st.people, sub: "재직" },
      { label: "이수 유효율", value: st.valid == null ? "-" : st.valid + "%", sub: (st.ok + st.soon) + "/" + st.cells + " 항목", tone: st.valid == null ? "muted" : st.valid === 100 ? "ok" : "warn" },
      { label: "만료 임박", value: st.soon, sub: SOON + "일 이내", tone: st.soon ? "warn" : "ok" },
      { label: "만료 · 미이수", value: st.exp + st.none, sub: "만료 " + st.exp + " · 미이수 " + st.none, tone: st.exp + st.none ? "bad" : "ok" },
      { label: "SSI 서약", value: st.ssi ? (st.ssi - st.ssiMiss) + "/" + st.ssi : "-", sub: st.ssiMiss ? "누락 " + st.ssiMiss : "", tone: st.ssiMiss ? "bad" : st.ssi ? "ok" : "muted" }
    ]) + (due.length ? `<section class="card tr-due"><div class="tr-sh"><h3>만료 · 임박</h3><span class="tr-cnt mono">${due.length}</span></div>
        <ul class="tr-duel">${due.slice(0, 12).map(c => `<li${canW ? ` class="is-click" tabindex="0" data-tcell="${esc(c.p.id)}|${esc(c.g.fam)}"` : ""}>
          <span class="tr-dd mono" data-st="${c.st}">${c.st === "exp" ? "D+" + (-c.d) : c.d === 0 ? "D-Day" : "D-" + c.d}</span>
          <b>${esc(c.p.name)}</b><span class="tr-dg">${esc(c.g.name)}</span><span class="mono tr-de">${esc(dot(c.exp))}</span></li>`).join("")}</ul>
        ${due.length > 12 ? `<p class="au-none">외 ${due.length - 12}건</p>` : ""}</section>` : "")
      + `<section class="card" id="tr-grid">
        <div class="toolbar">
          ${ui.search("tr-q", "이름 · 소속 · 직무 검색", q)}
          ${roleOpts.length > 2 ? `<label class="ck-f"><span>직무</span><select id="tr-role">${roleOpts.map(([v, lb]) => `<option value="${esc(v)}" ${roleF === v ? "selected" : ""}>${esc(lb)}</option>`).join("")}</select></label>` : ""}
          <button type="button" class="pb-chk" id="tr-act" aria-pressed="${onlyAct}">${icon("alert", 14)}<span>조치 필요만</span></button>
        </div>
        <div id="tr-gbody">${gridTable(g, rows, ssiCol, canW)}</div>
      </section>`;
  }
  function gridTable(g, rows, ssiCol, canW) {
    if (!g.ps.length) return ui.empty("등록된 인원이 없습니다.", canW ? `<button type="button" class="btn btn-soft btn-sm" data-tgo="people">인원 등록</button>` : "");
    if (!rows.length) return ui.empty("조건에 맞는 인원이 없습니다.");
    return `<div class="table-wrap"><table class="tbl tbl-cap tr-gtbl" style="--cap:1480px">
      <thead><tr><th>이름</th><th>직무</th>${g.gs.map(x => `<th>${esc(x.name)}</th>`).join("")}${ssiCol ? "<th>SSI 서약</th>" : ""}</tr></thead>
      <tbody>${rows.map(p => `<tr data-pid="${esc(p.id)}">
        <td class="c-name"><button type="button" class="tbl-open" data-tperson="${esc(p.id)}">${esc(p.name)}</button><div class="cell-sub">${esc(p.dept || "")}</div></td>
        <td class="c-roles">${rolesOf(p).map(r => `<span class="tr-role">${esc(r)}</span>`).join("") || '<span class="cell-sub">-</span>'}</td>
        ${g.gs.map(x => { const c = g.cells.find(k => k.p === p && k.g === x);
          return `<td class="c-cell${c ? "" : " is-na"}" data-label="${esc(x.name)}"${c && canW ? ` data-tcell="${esc(p.id)}|${esc(x.fam)}"` : ""}>${cellChip(c)}</td>`; }).join("")}
        ${ssiCol ? `<td class="c-cell${rolesOf(p).indexOf("SSI 취급자") < 0 ? " is-na" : ""}" data-label="SSI 서약">${rolesOf(p).indexOf("SSI 취급자") < 0 ? '<span class="tr-na">-</span>'
          : isISO(p.pledge) ? `<span class="tr-cell" data-st="ok">${ui.chip("서약", "green")}<small class="mono">${esc(ymd2(p.pledge))}</small></span>` : `<span class="tr-cell" data-st="none">${ui.chip("누락", "red")}</span>`}</td>` : ""}
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ═════════ 교육 기록 ═════════ */
  function sessionsHTML(canW) {
    const t = todayISO();
    const all = sessions();
    const years = Array.from(new Set(all.map(s => String(s.date || "").slice(0, 4)).filter(Boolean))).sort().reverse();
    if (year && years.indexOf(year) < 0) year = "";
    const rows = all.filter(s => {
      if (year && String(s.date || "").slice(0, 4) !== year) return false;
      if (sType === "own" && s.type === "vendor") return false;
      if (sType === "vendor" && s.type !== "vendor") return false;
      return !q || hay([sessionTitle(s), s.place, s.instructor, s.vendor, s.note, s.evalText]).indexOf(q.toLowerCase()) >= 0;
    }).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const own = all.filter(s => s.type !== "vendor"), ven = all.filter(s => s.type === "vendor");
    const full = own.filter(s => !missing(s).length).length;
    const old = all.filter(s => keepOver(s, t)).length;
    return ui.stats([
      { label: "당사 실시 (1년)", value: own.filter(s => within12(s.date, t)).length, sub: "전체 " + own.length },
      { label: "기록 8항목 완비", value: own.length ? full + "/" + own.length : "-", tone: own.length ? (full === own.length ? "ok" : "warn") : "muted" },
      { label: "협력사 확인 (1년)", value: ven.filter(s => within12(s.date, t)).length, sub: "전체 " + ven.length },
      { label: "보관 " + KEEP_YEARS + "년 경과", value: old, tone: old ? "warn" : "muted" }
    ]) + `<section class="card" id="tr-slist">
      <div class="toolbar">
        ${ui.search("tr-q", "교육명 · 업체 · 교관 검색", q)}
        ${segHTML("stype", [["all", "전체"], ["own", "당사 실시"], ["vendor", "협력사 확인"]], sType)}
        ${years.length ? `<label class="ck-f"><span>연도</span><select id="tr-year"><option value="">전체</option>${years.map(y => `<option value="${y}" ${year === y ? "selected" : ""}>${y}</option>`).join("")}</select></label>` : ""}
      </div>
      <div id="tr-sbody">${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap tr-stbl" style="--cap:1320px">
        <thead><tr><th>일자</th><th>교육</th><th>대상</th><th>인원</th><th>기록</th></tr></thead>
        <tbody>${rows.map(s => sessionRow(s, canW, t)).join("")}</tbody></table></div>`
        : ui.empty(all.length ? "조건에 맞는 기록이 없습니다." : "등록된 교육 기록이 없습니다.")}</div>
    </section>`;
  }
  function sessionRow(s, canW, t) {
    const v = s.type === "vendor";
    const miss = v ? [] : missing(s);
    const n = v ? (num(s.done) != null ? `${num(s.done)}${num(s.target) != null ? "/" + num(s.target) : ""}` : num(s.target) != null ? "대상 " + num(s.target) : "-")
      : String(filesOf(s.pids).length || "-");
    const files = v ? sfiles(s, "roster").concat(sfiles(s, "eval")) : sfiles(s, "tt").concat(sfiles(s, "roster"), sfiles(s, "eval"));
    return `<tr data-sid="${esc(s.id)}"${canW ? ' tabindex="0" class="is-click"' : ""}>
      <td class="c-date"><span class="mono">${esc(dot(s.date))}</span>${keepOver(s, t) ? `<div class="cell-sub">보관 ${KEEP_YEARS}년 경과</div>` : ""}</td>
      <td class="c-name"><b>${esc(sessionTitle(s))}</b>${!v && (s.place || s.instructor) ? `<div class="cell-sub">${esc([s.place, s.instructor ? "교관 " + s.instructor : ""].filter(Boolean).join(" · "))}</div>` : ""}
        ${files.length ? `<div class="au-files">${fileChips(files)}</div>` : ""}</td>
      <td class="c-kind">${v ? ui.chip("협력사 확인", "blue") : ui.chip("당사 실시", "gray")}</td>
      <td class="c-n mono">${esc(n)}</td>
      <td class="c-rec">${v ? (sfiles(s, "roster").length || sfiles(s, "eval").length ? ui.chip("결과 첨부", "green") : ui.chip("결과 없음", "amber"))
        : miss.length ? `<span class="tr-miss">${ui.chip("누락 " + miss.length, "amber")}<small>${esc(miss.join(" · "))}</small></span>` : ui.chip("8항목 완비", "green")}</td>
    </tr>`;
  }

  /* ═════════ 인원 ═════════ */
  function peopleHTML(canW) {
    const t = todayISO();
    const all = people();
    const rows = all.filter(p => {
      const a = active(p, t);
      if (pState === "active" && !a) return false;
      if (pState === "left" && a) return false;
      return !q || hay([p.name, p.dept, rolesOf(p).join(" "), p.note]).indexOf(q.toLowerCase()) >= 0;
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    const left = all.filter(p => !active(p, t));
    const clean = left.filter(p => leftOver(p, t)).length;
    return ui.stats([
      { label: "재직", value: all.length - left.length },
      { label: "퇴직 · 전출", value: left.length, sub: "기록 보관 " + KEEP_LEFT_DAYS + "일" },
      { label: "보관 기한 경과", value: clean, sub: "정리 가능", tone: clean ? "warn" : "muted" },
      { label: "이수 기록", value: records().length }
    ]) + `<section class="card" id="tr-plist">
      <div class="toolbar">
        ${ui.search("tr-q", "이름 · 소속 · 직무 검색", q)}
        ${segHTML("pstate", [["active", "재직"], ["left", "퇴직 · 전출"], ["all", "전체"]], pState)}
      </div>
      <div id="tr-pbody">${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap tr-ptbl" style="--cap:1320px">
        <thead><tr><th>이름</th><th>직무</th><th>최근 이수</th><th>SSI 서약</th><th>상태</th></tr></thead>
        <tbody>${rows.map(p => {
          const rs = records().filter(r => r.pid === p.id && isISO(r.date)).sort((a, b) => b.date.localeCompare(a.date));
          const a = active(p, t);
          return `<tr data-tperson="${esc(p.id)}" tabindex="0" class="is-click">
            <td class="c-name"><b>${esc(p.name)}</b><div class="cell-sub">${esc(p.dept || "")}</div></td>
            <td class="c-roles">${rolesOf(p).map(r => `<span class="tr-role">${esc(r)}</span>`).join("") || '<span class="cell-sub">-</span>'}</td>
            <td class="c-last" data-label="최근 이수">${rs.length ? `${esc((courseOf(rs[0].cid) || {}).name || "과정")}<div class="cell-sub mono">${esc(dot(rs[0].date))} · 전체 ${rs.length}건</div>` : '<span class="cell-sub">-</span>'}</td>
            <td class="c-ssi" data-label="SSI 서약">${isISO(p.pledge) ? `<span class="mono">${esc(dot(p.pledge))}</span>` : rolesOf(p).indexOf("SSI 취급자") >= 0 ? ui.chip("누락", "red") : '<span class="cell-sub">-</span>'}</td>
            <td class="c-st">${a ? ui.chip("재직", "green") : leftOver(p, t) ? `${ui.chip("보관 기한 경과", "amber")}<div class="cell-sub mono">${esc(dot(p.left))} 퇴직</div>`
              : `${ui.chip("퇴직", "gray")}<div class="cell-sub mono">보관 ~${esc(dot(addDays(p.left, KEEP_LEFT_DAYS)))}</div>`}</td>
          </tr>`;
        }).join("")}</tbody></table></div>`
        : ui.empty(all.length ? "조건에 맞는 인원이 없습니다." : "등록된 인원이 없습니다.")}</div>
    </section>`;
  }

  /* ═════════ 폼 공통 ═════════ */
  const fld = (idn, label, html, tip) => `<div class="form-row"><label for="${idn}">${esc(label)}${tip ? " " + ui.tip(tip, label + " 설명") : ""}</label>${html}</div>`;
  const dl = (id, vals) => `<datalist id="${id}">${vals.filter(Boolean).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const uniq = (a) => a.map(norm).filter((s, i, all) => s && all.indexOf(s) === i);
  async function uploadInto(files, fileList, done) {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of list) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("올리는 중: " + file.name);
      try {
        const up = await SemisSync.uploadFile(file, FOLDER);
        files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url });
      } catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }
  function fileBox(prefix, label, files) {
    return `<div class="form-row"><label>${esc(label)}</label>
      <div class="au-files au-files-edit" id="${prefix}-files"></div>
      <input type="file" id="${prefix}-file" multiple hidden>
      <button type="button" class="btn btn-ghost btn-sm" id="${prefix}-fbtn">${icon("link", 15)}<span>파일 올리기</span></button></div>`;
  }
  function wireFileBox(prefix, files) {
    const paint = () => {
      const box = $("#" + prefix + "-files");
      if (!box) return;
      box.innerHTML = files.map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a><button type="button" class="mt-btn danger" data-fdel="${i}" aria-label="첨부 빼기">${icon("x", 14)}</button></span>`).join("");
      $$("[data-fdel]", box).forEach(b => b.onclick = () => { files.splice(Number(b.dataset.fdel), 1); paint(); });
    };
    paint();
    const inp = $("#" + prefix + "-file"), btn = $("#" + prefix + "-fbtn");
    if (btn && inp) {
      btn.onclick = () => inp.click();
      inp.onchange = () => { const fl = Array.from(inp.files || []); inp.value = ""; uploadInto(files, fl, paint); };
    }
  }
  const copyFiles = (a) => filesOf(a).map(f => Object.assign({}, f));
  const actions = (canDel) => `<div class="modal-actions">
      ${canDel ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
      <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
      <button type="button" class="btn btn-primary" data-act="ok">저장</button>
    </div>`;
  const courseSel = (id, list, cur, extra) => `<select id="${id}">${extra || ""}${list.map(c => `<option value="${esc(c.id)}" ${cur === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;

  /* ─────── 인원 ─────── */
  function personForm(pid) {
    if (!SeMIS.canEdit()) return personView(pid);
    const x = pid ? personOf(pid) : null;
    if (pid && !x) return;
    const v = Object.assign({ name: "", dept: "인천화물팀", roles: [], left: "", pledge: "", note: "" }, x || {});
    const pf = copyFiles(v.pledgeFiles);
    const rs = x ? records().filter(r => r.pid === x.id).sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
    const depts = uniq(["인천화물팀"].concat(people().map(p => p.dept)));
    openModal(`<h3>${x ? "인원 수정" : "인원 등록"}</h3>
      <div class="form-grid">
        ${fld("tp-name", "이름", `<input id="tp-name" value="${esc(v.name)}" maxlength="30" autocomplete="off">`)}
        ${fld("tp-dept", "소속", `<input id="tp-dept" value="${esc(v.dept)}" maxlength="40" autocomplete="off" list="tp-dl-dept">`)}
      </div>
      <div class="form-row"><label>직무</label><div class="ck-rchoose" id="tp-roles">${allRoles().map(r =>
        `<label class="ck-rc"><input type="checkbox" value="${esc(r)}" ${rolesOf(v).indexOf(r) >= 0 ? "checked" : ""}><span>${esc(r)}</span></label>`).join("")}</div>
        <input id="tp-role-add" class="tr-roleadd" maxlength="20" autocomplete="off" placeholder="다른 직무 입력 후 Enter"></div>
      <div class="form-grid">
        ${fld("tp-pledge", "SSI 서약일", `<input type="date" id="tp-pledge" value="${esc(v.pledge)}">`)}
        ${fld("tp-left", "퇴직 · 전출일", `<input type="date" id="tp-left" value="${esc(v.left)}">`, "교육 기록은 퇴직 · 전출 후 " + KEEP_LEFT_DAYS + "일까지 보관합니다.")}
      </div>
      ${fileBox("tpf", "서약서", pf)}
      ${fld("tp-note", "메모", `<input id="tp-note" value="${esc(v.note)}" maxlength="200">`)}
      ${x ? `<div class="tr-recs"><div class="tr-sh"><h4>이수 기록</h4><span class="tr-cnt mono">${rs.length}</span><span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-sm" id="tp-radd">${icon("plus", 15)}<span>이수 등록</span></button></div>
        ${rs.length ? `<ul class="tr-rlist">${rs.map(r => { const c = courseOf(r.cid), exp = expireOf(r);
          return `<li><button type="button" class="tr-rbtn" data-rid="${esc(r.id)}"><span class="mono">${esc(dot(r.date))}</span><b>${esc(c ? c.name : "과정 없음")}</b>
            <small class="mono">${exp ? "~" + esc(dot(exp)) : "기한 없음"}</small>${filesOf(r.files).length ? icon("link", 13) : ""}</button></li>`; }).join("")}</ul>`
          : '<p class="au-none">등록된 이수 기록이 없습니다.</p>'}</div>` : ""}
      ${dl("tp-dl-dept", depts)}
      ${actions(!!x && SeMIS.canDelete())}`, { wide: true });
    wireFileBox("tpf", pf);
    const ra = $("#tp-role-add");
    ra.onkeydown = (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const r = norm(ra.value);
      if (!r) return;
      const box = $("#tp-roles");
      if (!$$("input", box).some(i => i.value === r)) box.insertAdjacentHTML("beforeend", `<label class="ck-rc"><input type="checkbox" value="${esc(r)}" checked><span>${esc(r)}</span></label>`);
      else $$("input", box).forEach(i => { if (i.value === r) i.checked = true; });
      ra.value = "";
    };
    const read = () => ({ name: norm($("#tp-name").value), dept: norm($("#tp-dept").value), roles: $$("#tp-roles input:checked").map(i => i.value),
      pledge: $("#tp-pledge").value || "", left: $("#tp-left").value || "", note: norm($("#tp-note").value), pledgeFiles: pf.slice() });
    const save = (then) => {
      const rec = read();
      if (!rec.name) { toast("이름을 입력하세요.", true); $("#tp-name").focus(); return null; }
      const t = T();
      let p = x;
      if (p) Object.assign(p, rec); else { p = Object.assign({ id: uid("tp"), createdAt: new Date().toISOString(), createdBy: me() }, rec); t.people.push(p); }
      stamp(p); SeMIS.save();
      if (then) then(p); else { closeModal(); paint(); toast("저장했습니다."); }
      return p;
    };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => save();
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`${x.name} 님과 이수 기록 ${rs.length}건을 삭제합니다.`, () => {
      const t = T();
      t.people = t.people.filter(p => p.id !== x.id);
      t.records = t.records.filter(r => r.pid !== x.id);
      t.sessions.forEach(s => { if (Array.isArray(s.pids)) s.pids = s.pids.filter(id => id !== x.id); });
      SeMIS.save(); paint(); toast("삭제했습니다.");
    });
    const radd = $("#tp-radd");
    if (radd) radd.onclick = () => save(p => recordForm(p.id, "", null));
    $$("[data-rid]").forEach(b => b.onclick = () => save(p => recordForm(p.id, b.dataset.rid, null)));
  }
  /* manager — 읽기 전용 */
  function personView(pid) {
    const x = personOf(pid);
    if (!x) return;
    const rs = records().filter(r => r.pid === x.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    openModal(`<h3>${esc(x.name)} <small class="au-mh">${esc(x.dept || "")}</small></h3>
      <p class="tr-vroles">${rolesOf(x).map(r => `<span class="tr-role">${esc(r)}</span>`).join("") || "-"}</p>
      <dl class="eqd-grid"><div><dt>SSI 서약</dt><dd>${isISO(x.pledge) ? esc(dot(x.pledge)) : "-"}</dd></div><div><dt>상태</dt><dd>${active(x) ? "재직" : "퇴직 · 전출 " + esc(dot(x.left))}</dd></div></dl>
      ${filesOf(x.pledgeFiles).length ? `<div class="au-files">${fileChips(x.pledgeFiles)}</div>` : ""}
      <div class="tr-recs"><div class="tr-sh"><h4>이수 기록</h4><span class="tr-cnt mono">${rs.length}</span></div>
        ${rs.length ? `<ul class="tr-rlist">${rs.map(r => { const c = courseOf(r.cid), exp = expireOf(r);
          return `<li><div class="tr-rbtn"><span class="mono">${esc(dot(r.date))}</span><b>${esc(c ? c.name : "과정 없음")}</b><small class="mono">${exp ? "~" + esc(dot(exp)) : "기한 없음"}</small></div>
            ${filesOf(r.files).length ? `<div class="au-files">${fileChips(r.files)}</div>` : ""}</li>`; }).join("")}</ul>` : '<p class="au-none">등록된 이수 기록이 없습니다.</p>'}</div>
      <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="cancel">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
  }

  /* ─────── 이수 기록 ─────── */
  function recordForm(pid, rid, cidPreset, back) {
    if (!SeMIS.canEdit()) return;
    const p = personOf(pid);
    if (!p) return;
    const x = rid ? records().find(r => r.id === rid) : null;
    if (rid && !x) return;
    const v = Object.assign({ cid: cidPreset || (ownCourses()[0] || {}).id || "", date: "", expire: "", hours: "", score: "", org: "", certNo: "", note: "" }, x || {});
    const files = copyFiles(v.files);
    const orgs = uniq(records().map(r => r.org));
    let expTouched = !!(x && isISO(x.expire) && x.expire !== calcExpire(x.date, (courseOf(x.cid) || {}).cycle));
    openModal(`<h3>${x ? "이수 기록 수정" : "이수 등록"} <small class="au-mh">${esc(p.name)}</small></h3>
      ${fld("tr-c", "과정", courseSel("tr-c", ownCourses(), v.cid))}
      <div class="form-grid">
        ${fld("tr-d", "수료일", `<input type="date" id="tr-d" value="${esc(v.date)}">`)}
        ${fld("tr-e", "유효기한", `<input type="date" id="tr-e" value="${esc(isISO(v.expire) ? v.expire : calcExpire(v.date, (courseOf(v.cid) || {}).cycle))}">`, "수료일과 과정 주기로 자동 계산됩니다. 이수증에 적힌 날짜가 다르면 고쳐 쓰세요.")}
        ${fld("tr-h", "교육 시간", `<input type="number" id="tr-h" value="${esc(v.hours == null ? "" : v.hours)}" min="0" step="0.5" inputmode="decimal">`)}
        ${fld("tr-s", "평가 점수", `<input type="number" id="tr-s" value="${esc(v.score == null ? "" : v.score)}" min="0" max="100" inputmode="numeric">`)}
        ${fld("tr-o", "교육기관", `<input id="tr-o" value="${esc(v.org)}" maxlength="60" autocomplete="off" list="tr-dl-org">`)}
        ${fld("tr-n", "이수증 번호", `<input id="tr-n" value="${esc(v.certNo)}" maxlength="40" autocomplete="off">`)}
      </div>
      ${fileBox("trf", "이수증", files)}
      ${fld("tr-m", "메모", `<input id="tr-m" value="${esc(v.note)}" maxlength="200">`)}
      ${dl("tr-dl-org", orgs)}
      ${actions(!!x)}`, { wide: true });
    wireFileBox("trf", files);
    const autoExp = () => { if (expTouched) return; $("#tr-e").value = calcExpire($("#tr-d").value, (courseOf($("#tr-c").value) || {}).cycle); };
    $("#tr-d").onchange = autoExp; $("#tr-c").onchange = autoExp;
    $("#tr-e").oninput = () => { expTouched = true; };
    const reopen = () => { if (back === false) { closeModal(); paint(); } else personForm(p.id); };
    $("#modal-box [data-act=cancel]").onclick = reopen;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => { T().records = T().records.filter(r => r.id !== x.id); SeMIS.save(); toast("삭제했습니다."); reopen(); paint(); };
    $("#modal-box [data-act=ok]").onclick = () => {
      const date = $("#tr-d").value || "";
      if (!isISO(date)) { toast("수료일을 입력하세요.", true); $("#tr-d").focus(); return; }
      const cid = $("#tr-c").value;
      const calc = calcExpire(date, (courseOf(cid) || {}).cycle), e = $("#tr-e").value || "";
      const rec = { pid: p.id, cid, date, expire: isISO(e) && e !== calc ? e : "", hours: num($("#tr-h").value), score: num($("#tr-s").value),
        org: norm($("#tr-o").value), certNo: norm($("#tr-n").value), note: norm($("#tr-m").value), files: files.slice() };
      const t = T();
      if (x) Object.assign(x, rec); else t.records.push(Object.assign({ id: uid("tr") }, rec));
      SeMIS.save(); toast("저장했습니다."); paint(); reopen();
    };
  }

  /* ─────── 교육 기록 (당사 실시 · 협력사 확인) ─────── */
  function sessionForm(sid, typePreset) {
    if (!SeMIS.canEdit()) return;
    const x = sid ? sessions().find(s => s.id === sid) : null;
    if (sid && !x) return;
    const type = x ? (x.type === "vendor" ? "vendor" : "own") : (typePreset === "vendor" ? "vendor" : "own");
    const v = Object.assign({ cid: "", title: "", date: "", time: "", hours: "", place: "", instructor: "", evalText: "", pids: [],
      vendor: "", target: "", done: "", note: "" }, x || {});
    const fs = { tt: copyFiles(sfiles(v, "tt")), roster: copyFiles(sfiles(v, "roster")), eval: copyFiles(sfiles(v, "eval")) };
    const vendors = uniq(sessions().map(s => s.vendor));
    const pl = people().filter(p => active(p) || filesOf(v.pids).indexOf(p.id) >= 0).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    const body = type === "vendor" ? `
      <div class="form-grid">
        ${fld("ts-vendor", "업체", `<input id="ts-vendor" value="${esc(v.vendor)}" maxlength="40" autocomplete="off" list="ts-dl-v">`)}
        ${fld("ts-c", "과정", courseSel("ts-c", vendorCourses(), v.cid))}
        ${fld("ts-date", "확인일", `<input type="date" id="ts-date" value="${esc(v.date)}">`)}
        ${fld("ts-time", "교육 일자 · 기간", `<input id="ts-time" value="${esc(v.time)}" maxlength="40" placeholder="예: 9월 정기교육">`)}
        ${fld("ts-target", "대상 인원", `<input type="number" id="ts-target" value="${esc(v.target == null ? "" : v.target)}" min="0" inputmode="numeric">`)}
        ${fld("ts-done", "이수 인원", `<input type="number" id="ts-done" value="${esc(v.done == null ? "" : v.done)}" min="0" inputmode="numeric">`)}
      </div>
      ${fileBox("tsr", "결과 · 명단", fs.roster)}
      ${dl("ts-dl-v", vendors)}`
    : `
      <div class="form-grid">
        ${fld("ts-c", "과정", courseSel("ts-c", ownCourses(), v.cid, `<option value="">기타(과정 없음)</option>`))}
        ${fld("ts-title", "교육명", `<input id="ts-title" value="${esc(v.title)}" maxlength="80" autocomplete="off">`)}
        ${fld("ts-date", "일자", `<input type="date" id="ts-date" value="${esc(v.date)}">`)}
        ${fld("ts-time", "시각", `<input id="ts-time" value="${esc(v.time)}" maxlength="30" placeholder="예: 09:00~13:00">`)}
        ${fld("ts-hours", "교육 시간", `<input type="number" id="ts-hours" value="${esc(v.hours == null ? "" : v.hours)}" min="0" step="0.5" inputmode="decimal">`)}
        ${fld("ts-place", "장소", `<input id="ts-place" value="${esc(v.place)}" maxlength="60">`)}
        ${fld("ts-inst", "교관", `<input id="ts-inst" value="${esc(v.instructor)}" maxlength="40">`)}
        ${fld("ts-eval", "평가 결과", `<input id="ts-eval" value="${esc(v.evalText)}" maxlength="120" placeholder="예: 전원 합격(평균 92점)">`)}
      </div>
      <div class="form-row"><label>참석자 ${ui.tip("고른 인원에게 이 과정의 이수 기록이 함께 만들어집니다.", "참석자 설명")}</label>
        ${pl.length ? `<div class="ck-rchoose" id="ts-pids">${pl.map(p => `<label class="ck-rc"><input type="checkbox" value="${esc(p.id)}" ${filesOf(v.pids).indexOf(p.id) >= 0 ? "checked" : ""}><span>${esc(p.name)}</span></label>`).join("")}</div>`
          : '<p class="au-none">인원 탭에서 먼저 인원을 등록하세요.</p>'}</div>
      ${fileBox("tst", "시간표", fs.tt)}
      ${fileBox("tsr", "참석자 명단 · 서명", fs.roster)}
      ${fileBox("tse", "평가 결과", fs.eval)}`;
    openModal(`<h3>${x ? "교육 기록 수정" : type === "vendor" ? "협력사 교육 확인" : "당사 교육 기록"}</h3>
      ${!x ? segHTML("stypeform", [["own", "당사 실시"], ["vendor", "협력사 확인"]], type) : ""}
      ${body}
      ${fld("ts-note", "메모", `<input id="ts-note" value="${esc(v.note)}" maxlength="300">`)}
      ${actions(!!x)}`, { wide: true });
    $$("[data-tseg=stypeform]").forEach(b => b.onclick = () => { if (b.dataset.v !== type) sessionForm("", b.dataset.v); });
    if (type === "vendor") wireFileBox("tsr", fs.roster);
    else {
      wireFileBox("tst", fs.tt); wireFileBox("tsr", fs.roster); wireFileBox("tse", fs.eval);
      const ti = $("#ts-title"), cs = $("#ts-c");
      let titleTouched = !!norm(v.title) && v.title !== ((courseOf(v.cid) || {}).name || "");
      ti.oninput = () => { titleTouched = !!norm(ti.value); };
      cs.onchange = () => { if (!titleTouched) ti.value = (courseOf(cs.value) || {}).name || ""; };
      if (!x && !ti.value) ti.value = (courseOf(cs.value) || {}).name || "";
    }
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`교육 기록 "${sessionTitle(x)}"을(를) 삭제합니다.${x.type !== "vendor" && filesOf(x.pids).length ? " 이 기록으로 만든 참석자 이수 기록도 함께 지워집니다." : ""}`, () => {
      const t = T();
      t.sessions = t.sessions.filter(s => s.id !== x.id);
      t.records = t.records.filter(r => r.sessionId !== x.id);
      SeMIS.save(); paint(); toast("삭제했습니다.");
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const val = (id) => norm(($("#" + id) || {}).value);
      const date = ($("#ts-date") || {}).value || "";
      if (!isISO(date)) { toast((type === "vendor" ? "확인일" : "일자") + "을 입력하세요.", true); $("#ts-date").focus(); return; }
      let rec;
      if (type === "vendor") {
        if (!val("ts-vendor")) { toast("업체를 입력하세요.", true); $("#ts-vendor").focus(); return; }
        rec = { type, vendor: val("ts-vendor"), cid: $("#ts-c").value, date, time: val("ts-time"), target: num($("#ts-target").value), done: num($("#ts-done").value),
          files: { roster: fs.roster.slice() }, note: val("ts-note") };
      } else {
        const title = val("ts-title");
        if (!title) { toast("교육명을 입력하세요.", true); $("#ts-title").focus(); return; }
        rec = { type, cid: $("#ts-c").value, title, date, time: val("ts-time"), hours: num($("#ts-hours").value), place: val("ts-place"),
          instructor: val("ts-inst"), evalText: val("ts-eval"), pids: $$("#ts-pids input:checked").map(i => i.value),
          files: { tt: fs.tt.slice(), roster: fs.roster.slice(), eval: fs.eval.slice() }, note: val("ts-note") };
      }
      const t = T();
      let s = x;
      if (s) Object.assign(s, rec); else { s = Object.assign({ id: uid("ts"), createdAt: new Date().toISOString(), createdBy: me() }, rec); t.sessions.push(s); }
      stamp(s);
      syncSessionRecords(s);
      SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }
  /* 당사 교육 기록의 참석자 → 개인 이수 기록(sessionId로 연결). 참석자에서 빼면 그 기록도 지운다 */
  function syncSessionRecords(s) {
    const t = T();
    if (s.type === "vendor" || !courseOf(s.cid)) { t.records = t.records.filter(r => r.sessionId !== s.id); return; }
    const pids = filesOf(s.pids);
    t.records = t.records.filter(r => r.sessionId !== s.id || pids.indexOf(r.pid) >= 0);
    pids.forEach(pid => {
      let r = t.records.find(x => x.sessionId === s.id && x.pid === pid);
      if (!r) { r = { id: uid("tr"), pid, sessionId: s.id, expire: "", score: null, org: "", certNo: "", note: "", files: [] }; t.records.push(r); }
      Object.assign(r, { cid: s.cid, date: s.date, hours: num(s.hours) });
    });
  }

  /* ─────── 과정 관리 (hq) ─────── */
  function coursesForm() {
    if (!SeMIS.canEdit()) return;
    const list = courses().map(c => Object.assign({}, c, { roles: (c.roles || []).slice() }));
    const used = (id) => records().some(r => r.cid === id) || sessions().some(s => s.cid === id);
    const row = (c, i) => `<tr data-ci="${i}">
      <td><input data-k="name" value="${esc(c.name)}" maxlength="50" aria-label="과정 이름"></td>
      <td><select data-k="kind" aria-label="구분">${KINDS.map(k => `<option ${c.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></td>
      <td><input data-k="fam" value="${esc(c.fam || "")}" maxlength="20" aria-label="묶음"></td>
      <td><input data-k="cycle" type="number" min="0" max="120" value="${esc(c.cycle || 0)}" aria-label="주기(개월)"></td>
      <td><input data-k="roles" value="${esc((c.roles || []).join(", "))}" maxlength="80" aria-label="대상 직무" ${c.vendor ? "disabled" : ""}></td>
      <td class="c"><input data-k="all" type="checkbox" ${c.all ? "checked" : ""} aria-label="전 직원" ${c.vendor ? "disabled" : ""}></td>
      <td class="c"><input data-k="vendor" type="checkbox" ${c.vendor ? "checked" : ""} aria-label="협력사 확인용"></td>
      <td>${used(c.id) ? "" : `<button type="button" class="mt-btn danger" data-cdel="${i}" aria-label="과정 삭제">${icon("x", 14)}</button>`}</td></tr>`;
    const paintRows = () => { $("#tc-rows").innerHTML = list.map(row).join(""); wireRows(); };
    const pull = () => $$("#tc-rows tr").forEach(tr => {
      const c = list[Number(tr.dataset.ci)];
      $$("[data-k]", tr).forEach(el => {
        const k = el.dataset.k;
        if (k === "all" || k === "vendor") c[k] = el.checked;
        else if (k === "cycle") c.cycle = Math.max(0, Math.round(Number(el.value) || 0));
        else if (k === "roles") c.roles = el.value.split(/[,·]/).map(norm).filter(Boolean);
        else c[k] = norm(el.value);
      });
    });
    const wireRows = () => $$("[data-cdel]").forEach(b => b.onclick = () => { pull(); list.splice(Number(b.dataset.cdel), 1); paintRows(); });
    openModal(`<h3>과정 관리</h3>
      <div class="table-wrap"><table class="tbl tr-ctbl">
        <thead><tr><th>과정</th><th>구분</th><th>묶음 ${ui.tip("초기 · 정기처럼 이어지는 과정은 같은 묶음 이름을 씁니다. 묶음 안의 가장 최근 이수로 유효 여부를 봅니다.", "묶음 설명")}</th>
          <th>주기(개월)</th><th>대상 직무</th><th>전 직원</th><th>협력사</th><th></th></tr></thead>
        <tbody id="tc-rows"></tbody></table></div>
      <button type="button" class="btn btn-ghost btn-sm" id="tc-add">${icon("plus", 15)}<span>과정 추가</span></button>
      ${actions(false)}`, { wide: true });
    paintRows();
    $("#tc-add").onclick = () => { pull(); list.push({ id: uid("c"), name: "", kind: "정기", fam: "", cycle: 12, roles: [] }); paintRows(); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      pull();
      const out = list.filter(c => c.name);
      if (!out.length) { toast("과정을 하나 이상 두세요.", true); return; }
      out.forEach(c => { if (!c.fam) c.fam = c.id; if (c.vendor) { c.roles = []; c.all = false; } });
      T().courses = out;
      SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }

  /* ═════════ 렌더 ═════════ */
  function bodyHTML(canW) { return tab === "sessions" ? sessionsHTML(canW) : tab === "people" ? peopleHTML(canW) : gridHTML(canW); }
  function openCell(key) {
    const [pid, fam] = String(key || "").split("|");
    const g = famOf(fam), p = personOf(pid);
    if (!g || !p) return;
    const has = records().some(r => r.pid === pid && g.courses.some(c => c.id === r.cid));
    const pick = (has && g.courses.find(c => c.kind === "정기")) || g.courses.find(c => c.kind === "초기") || g.courses[0];
    recordForm(pid, "", pick && pick.id, false);
  }
  function wire(box) {
    const canW = SeMIS.canEdit();
    const qi = $("#tr-q", box);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const b = document.getElementById("tr-body");
      if (!b || !b.contains(qi)) { paint(); return; }
      ui.repaintKeep(b, bodyHTML(canW), qi);
      wire(b);
    };
    const rs = $("#tr-role", box); if (rs) rs.onchange = () => { roleF = rs.value; paint(); };
    const yr = $("#tr-year", box); if (yr) yr.onchange = () => { year = yr.value; paint(); };
    const ac = $("#tr-act", box); if (ac) ac.onclick = () => { onlyAct = !onlyAct; paint(); };
    $$("[data-tseg]", box).forEach(b => b.onclick = () => {
      if (b.dataset.tseg === "stype") sType = b.dataset.v; else if (b.dataset.tseg === "pstate") pState = b.dataset.v;
      paint();
    });
    $$("[data-tgo]", box).forEach(b => b.onclick = () => { tab = b.dataset.tgo; SeMIS.renderView(); });
    $$("[data-tperson]", box).forEach(el => {
      const open = (ev) => { if (ev && ev.target.closest("a")) return; if (ev) ev.stopPropagation(); personForm(el.dataset.tperson); };
      el.onclick = open;
      if (el.tagName === "TR") el.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
    if (!canW) return;
    $$("[data-tcell]", box).forEach(el => {
      el.onclick = (ev) => { if (ev.target.closest("[data-tperson]")) return; openCell(el.dataset.tcell); };
      if (el.tagName === "LI") el.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); openCell(el.dataset.tcell); } };
    });
    $$("tr[data-sid]", box).forEach(tr => {
      tr.onclick = (ev) => { if (!ev.target.closest("a")) sessionForm(tr.dataset.sid); };
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); sessionForm(tr.dataset.sid); } };
    });
  }
  function paint() {
    const box = document.getElementById("tr-body");
    if (!box) { if (routeNow() === MOD) SeMIS.renderView(); return; }
    box.innerHTML = bodyHTML(SeMIS.canEdit());
    wire(box);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  }
  function render(root) {
    const canW = SeMIS.canEdit();
    const act = canW ? [
      `<button type="button" class="btn btn-ghost btn-sm" id="tr-courses">${icon("sliders", 16)}<span>과정 관리</span></button>`,
      `<button type="button" class="btn btn-ghost btn-sm" id="tr-padd">${icon("user", 16)}<span>인원 등록</span></button>`,
      `<button type="button" class="btn btn-primary btn-sm" id="tr-sadd">${icon("plus", 16)}<span>교육 기록</span></button>`
    ].join("") : "";
    root.innerHTML = ui.head({ title: TITLE, meta: "당사 이수 · 교육 기록 · 협력사 확인", actions: act })
      + `<div class="eq-tabs" role="tablist" aria-label="보안교육 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-ttab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>`
      + `<div id="tr-body">${bodyHTML(canW)}</div>`;
    $$("[data-ttab]", root).forEach(b => b.onclick = () => { tab = b.dataset.ttab; q = ""; SeMIS.renderView(); });
    const cb = $("#tr-courses", root); if (cb) cb.onclick = coursesForm;
    const pa = $("#tr-padd", root); if (pa) pa.onclick = () => personForm("");
    const sa = $("#tr-sadd", root); if (sa) sa.onclick = () => sessionForm("", "own");
    wire(root);
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const s = stats(); return s.exp + s.soon + s.ssiMiss || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "users", module: MOD,
    items: () => people().map(p => ({ title: p.name, sub: [p.dept, rolesOf(p).join(" · ")].filter(Boolean).join(" · "),
        text: [p.name, p.dept, rolesOf(p).join(" "), p.note], route: MOD, pick: () => { tab = "people"; q = p.name; } }))
      .concat(sessions().map(s => ({ title: sessionTitle(s), sub: [s.type === "vendor" ? "협력사 확인" : "당사 실시", dot(s.date)].join(" · "),
        text: [sessionTitle(s), s.place, s.instructor, s.vendor, s.note], route: MOD, pick: () => { tab = "sessions"; q = ""; } })))
  });

  window.SemisTraining = {
    DEF_COURSES, ROLES, EIGHT, calcExpire, courses, fams, famStatus, stats, grid, missing, evidence, expireOf,
    syncSessionRecords, personForm, recordForm, sessionForm, coursesForm, keepOver, leftOver,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    getState() { return { tab, q, roleF, onlyAct, year, sType, pState }; },
    setState(o) {
      o = o || {};
      if (o.tab) tab = o.tab; if (o.q !== undefined) q = String(o.q || "");
      if (o.roleF !== undefined) roleF = String(o.roleF || ""); if (o.onlyAct !== undefined) onlyAct = !!o.onlyAct;
      if (o.year !== undefined) year = String(o.year || ""); if (o.sType) sType = o.sType; if (o.pState) pState = o.pState;
    }
  };
})();
