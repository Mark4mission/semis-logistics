/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 협력사 · 보안요원 (v1.41, 예정 메뉴 partners 대체)
   보안검색 · 항공경비 위탁업체(프로에스콤 등)의 요원 편성 · 교육 이력과 업체 증빙(인허가 · 계약 · 점검 · SeMS).
   - 요원 현황: 반(A · B · C) · 검색팀(조) 편성표, 감독자(★) · 감독자 예정(☆), 변동 사항 · 교육 중
   - 교육 이력: 초기 · 직무(OJT) · 인증평가 · 정기교육(연도별) → 다음 정기교육 기한(교육훈련지침 제13조: 1년 · 전후 30일)
     항공경비요원은 지침 제21조②에 따라 특수경비원 직무교육으로 정기교육을 갈음(원본 표기)
   - 업체 · 점검: 업체 카드 + 관련 문서(인허가 · 지정 / 계약 / 정기 · 불시 점검 / 교육 확인 / SeMS)
   데이터 SeMIS.data.partners = { asOf, src, vendors[], staff[], moves[], trainees{guard[],screen[]} } — 명단은 공용 DB 에만
   수검 체크리스트 증빙: window.SemisEvidence.partners(mid, sub)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "partners";
  const TITLE = "협력사 · 보안요원";
  const KEY = "partners";
  const D = () => SeMIS.data;
  const P = () => { const v = D()[KEY]; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const arr = (k) => (Array.isArray(P()[k]) ? P()[k] : []);
  const staff = () => arr("staff").filter(s => s && !s.left);
  const vendors = () => arr("vendors");
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const uid = (p) => (p || "ps") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const routeNow = () => String(location.hash || "").replace(/^#\/?/, "").split(/[?/]/)[0];
  let fixedToday = "";
  const todayISO = () => fixedToday || (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const shiftY = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(Date.UTC(y + n, m - 1, d)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
  const KR_WIN = 30, SOON = 60, SUSP_M = 6;

  const JOBS = { screen: "보안검색", guard: "항공경비" };
  const POS_ORDER = { "팀장": 0, "반장": 0, "조장": 1, "대원": 2 };
  const UNITS = ["A반", "B반", "C반"];
  const TEAMS = ["A조", "B조", "C조", "일근"];

  /* 증빙 문서 묶음 */
  if (window.SemisDocs) SemisDocs.define(MOD, [
    { id: "license", label: "인허가 · 지정" }, { id: "roster", label: "요원 현황 제출자료" }, { id: "inspect", label: "정기 · 불시 점검" },
    { id: "edu", label: "교육 확인" }, { id: "tsa", label: "TSA 교육 확인" }, { id: "drug", label: "향정신성 물질 교육" },
    { id: "sems", label: "보안관리체계 (SeMS)" }, { id: "misc", label: "기타" }
  ]);

  /* ─────── 교육 상태 ───────
     정기교육 묶음을 날짜순으로 이어 셈한다(교육훈련지침 제13조): 직전 만료 다음 날(1년 되는 날) 전후 30일 안 이수 → 그날부터 1년.
     시작점 = 인증평가(검색요원) 또는 초기교육(감독자). 항공경비요원(감독자 제외)은 정기교육을 특수경비원 직무교육으로 갈음 */
  const regDates = (s) => Object.keys(s.regs || {}).map(y => s.regs[y]).filter(isISO).sort();
  const baseDate = (s) => (s.cert && isISO(s.cert.end) ? s.cert.end : s.init && isISO(s.init.end) ? s.init.end : "");
  const exempt = (s) => s.job === "guard" && !s.sup && !regDates(s).length;
  function chainExp(s) {
    let exp = "";
    const pts = [baseDate(s)].concat(regDates(s)).filter(isISO).sort();
    pts.forEach(d => {
      if (exp && Math.abs(dayDiff(addDays(exp, 1), d)) <= KR_WIN) exp = addDays(shiftY(addDays(exp, 1), 1), -1);
      else exp = addDays(shiftY(d, 1), -1);
    });
    return exp;
  }
  const ST = {
    ok: ["유효", "green", 0], soon: ["임박", "amber", 1], win: ["이수 기간", "amber", 2], grace: ["유예", "amber", 2],
    susp: ["자격 정지", "red", 3], lapsed: ["회복 기한 경과", "red", 3], none: ["기록 없음", "red", 3], exempt: ["직무교육 갈음", "blue", 0]
  };
  function status(s, t) {
    t = t || todayISO();
    if (exempt(s)) return { st: "exempt", exp: "" };
    const exp = chainExp(s);
    if (!exp) return { st: "none", exp: "" };
    const anniv = addDays(exp, 1), winS = addDays(anniv, -KR_WIN), winE = addDays(anniv, KR_WIN);
    if (t < winS) return { st: dayDiff(t, exp) <= SOON ? "soon" : "ok", exp, winS, winE };
    if (t <= exp) return { st: "win", exp, winS, winE };
    if (t <= winE) return { st: "grace", exp, winS, winE };
    const [y, m, d] = addDays(winE, 1).split("-").map(Number);
    const rec = new Date(Date.UTC(y, m - 1 + SUSP_M, d)); rec.setUTCDate(rec.getUTCDate() - 1);
    return { st: t <= rec.toISOString().slice(0, 10) ? "susp" : "lapsed", exp, winS, winE };
  }
  const needAct = (s) => ST[status(s).st][2] >= 2;
  const stChip = (s) => { const x = status(s); return ui.chip(ST[x.st][0], ST[x.st][1]); };
  const supMark = (s) => (s.sup === "sup" ? '<span class="pn-sup" title="감독자">★</span>' : s.sup === "plan" ? '<span class="pn-sup is-plan" title="감독자 예정">☆</span>' : "");
  const roleOf = (s) => s.sup === "sup" ? (s.job === "screen" ? "보안검색감독자" : "항공경비감독자") : (s.job === "screen" ? "보안검색요원" : "항공경비요원");

  function stats() {
    const ss = staff();
    const g = ss.filter(s => s.job === "guard"), sc = ss.filter(s => s.job === "screen");
    const act = ss.filter(needAct);
    const qual = sc.filter(s => ["ok", "soon", "win", "grace"].indexOf(status(s).st) >= 0);
    return { all: ss.length, guard: g.length, screen: sc.length, sup: ss.filter(s => s.sup === "sup").length,
      plan: ss.filter(s => s.sup === "plan").length, act: act.length, qual: qual.length, chk: ss.filter(s => s.chk).length };
  }

  /* ─────── 상태 ─────── */
  let tab = "staff", q = "", jobF = "", onlyAct = false;
  const TABS = [["staff", "요원 현황"], ["edu", "교육 이력"], ["vendor", "업체 · 점검"]];
  const hay = (a) => a.map(v => String(v || "")).join(" ").toLowerCase();
  const match = (s) => !q || hay([s.name, s.unit, s.team, s.pos, JOBS[s.job], roleOf(s), s.note]).indexOf(q.toLowerCase()) >= 0;
  const segHTML = (name, items, cur) => `<div class="seg" role="group" aria-label="${esc(name)}">${items.map(([v, lb]) =>
    `<button type="button" class="seg-btn" data-pseg="${esc(name)}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(lb)}</button>`).join("")}</div>`;
  const sortStaff = (a, b) => (POS_ORDER[a.pos] ?? 3) - (POS_ORDER[b.pos] ?? 3) || (a.no || 999) - (b.no || 999) || String(a.name).localeCompare(String(b.name), "ko");

  /* ═════════ 요원 현황 (편성표) ═════════ */
  function personChip(s) {
    const st = status(s);
    const dotCls = st.st === "exempt" ? "" : ` is-${ST[st.st][1]}`;
    return `<button type="button" class="pn-p${s.chk ? " is-chk" : ""}" data-ps="${esc(s.id)}">
      ${s.pos && s.pos !== "대원" ? `<span class="pn-pos">${esc(s.pos)}</span>` : ""}<span class="pn-n">${esc(s.name)}</span>${supMark(s)}
      ${st.st === "exempt" ? "" : `<i class="pn-dot${dotCls}" title="정기교육 ${esc(ST[st.st][0])}"></i>`}</button>`;
  }
  function boardCol(title, list, sub) {
    return `<section class="pn-col"${ui.mf("pt:" + title, !!q)}>
      <header class="pn-ch mf-h"><h4>${esc(title)}</h4><span class="mono">${list.length}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</header>
      <div class="pn-ps">${list.length ? list.map(personChip).join("") : '<span class="cell-sub">없음</span>'}</div></section>`;
  }
  function staffHTML() {
    const ss = staff().filter(match);
    const g = (u) => ss.filter(s => s.job === "guard" && s.unit === u).sort(sortStaff);
    const sc = ss.filter(s => s.job === "screen").sort(sortStaff);
    const lead = sc.filter(s => !s.team);
    const otherG = ss.filter(s => s.job === "guard" && UNITS.indexOf(s.unit) < 0).sort(sortStaff);
    const pv = P(), moves = Array.isArray(pv.moves) ? pv.moves : [], tr = pv.trainees || {};
    const movesHTML = moves.filter(m => m && (m.out || []).concat(m.inn || [], m.join || [], m.quit || []).length).map(m =>
      `<div class="pn-mv"><b>${esc(m.unit)}</b>${[["전입", m.inn], ["전출", m.out], ["입사", m.join], ["퇴사", m.quit]].filter(x => (x[1] || []).length)
        .map(([k, v]) => `<span><small>${k}</small>${esc(v.join(", "))}</span>`).join("")}</div>`).join("");
    const trList = [["항공경비", tr.guard], ["보안검색", tr.screen]].filter(x => (x[1] || []).length);
    return `<div class="toolbar">${ui.search("pn-q", "이름 · 반 · 직책 검색", q)}
        <span class="pn-legend m-hide"><span><span class="pn-sup">★</span>감독자</span><span><span class="pn-sup is-plan">☆</span>감독자 예정</span><span><i class="pn-dot is-green"></i>정기교육 유효</span><span><i class="pn-dot is-amber"></i>임박 · 이수 기간</span><span><i class="pn-dot is-red"></i>조치 필요</span></span></div>
      <div id="pn-board">
        <div class="pn-band"><h3>항공경비 <span class="mono">${staff().filter(s => s.job === "guard").length}</span></h3></div>
        <div class="pn-board">${UNITS.map(u => boardCol(u, g(u))).join("")}${otherG.length ? boardCol("기타", otherG) : ""}</div>
        <div class="pn-band"><h3>보안검색 <span class="mono">${staff().filter(s => s.job === "screen").length}</span></h3>${lead.length ? `<span class="pn-lead">${lead.map(personChip).join("")}</span>` : ""}</div>
        <div class="pn-board">${TEAMS.map(tm => boardCol(tm, sc.filter(s => s.team === tm))).join("")}</div>
      </div>
      ${movesHTML || trList.length ? `<div class="pn-foot">${movesHTML ? `<div><h4>변동 사항</h4>${movesHTML}</div>` : ""}${trList.length ? `<div><h4>교육 중</h4>${trList.map(([k, v]) => `<div class="pn-mv"><b>${k}</b><span>${esc(v.join(", "))}</span></div>`).join("")}</div>` : ""}</div>` : ""}`;
  }

  /* ═════════ 교육 이력 ═════════ */
  const years = () => Array.from(new Set([].concat(...staff().map(s => Object.keys(s.regs || {}))))).filter(y => /^\d{4}$/.test(y)).sort().slice(-3);
  const spanTxt = (x) => (x && (x.text || "") && x.text !== "-" ? (isISO(x.end) && x.start !== x.end ? dot(x.start) + "~" + dot(x.end).slice(3) : dot(x.end || x.start) || x.text) : "-");
  function eduRows() {
    return staff().filter(s => (!jobF || s.job === jobF) && match(s) && (!onlyAct || needAct(s)))
      .sort((a, b) => (a.job === b.job ? 0 : a.job === "screen" ? -1 : 1) || (b.sup === "sup") - (a.sup === "sup") || (a.no || 999) - (b.no || 999));
  }
  function eduHTML() {
    const ys = years();
    const rows = eduRows();
    const t = stats();
    return `<div class="toolbar">${ui.search("pn-q", "이름 · 반 검색", q)}
        ${segHTML("job", [["", "전체"], ["screen", "보안검색"], ["guard", "항공경비"]], jobF)}
        <button type="button" class="pb-chk" id="pn-act" aria-pressed="${onlyAct}">${icon("alert", 14)}<span>조치 필요만</span>${t.act ? `<b class="mono">${t.act}</b>` : ""}</button></div>
      <div id="pn-edu">${rows.length ? `<div class="table-wrap"><table class="tbl pn-tbl">
        <thead><tr><th>구분</th><th>성명</th><th>소속</th><th>초기교육</th><th>직무교육(OJT)</th><th>인증평가</th>${ys.map(y => `<th>정기 ${esc(y)}</th>`).join("")}<th>다음 기한</th><th>상태</th></tr></thead>
        <tbody>${rows.map(s => { const x = status(s); return `<tr data-ps="${esc(s.id)}" class="is-click">
          <td>${esc(roleOf(s))}</td>
          <td data-role="title"><b>${esc(s.name)}</b>${supMark(s)}${s.chk ? ` ${ui.chip("확인 필요", "amber")}` : ""}</td>
          <td>${esc(s.job === "screen" ? (s.team || s.pos || "검색") : s.unit)}</td>
          <td class="mono">${esc(spanTxt(s.init))}</td><td class="mono">${esc(spanTxt(s.ojt))}</td><td class="mono">${esc(spanTxt(s.cert))}</td>
          ${ys.map(y => `<td class="mono">${esc(dot((s.regs || {})[y]) || "-")}</td>`).join("")}
          <td class="mono">${x.st === "exempt" ? '<span class="cell-sub">-</span>' : esc(dot(x.exp) || "-")}</td>
          <td>${stChip(s)}</td></tr>`; }).join("")}</tbody></table></div>
        <p class="pn-note">정기교육 기한 = 직전 교육 다음 해 같은 날 전날(국가민간항공보안 교육훈련지침 제13조, 전후 30일 이수 기간). 항공경비요원은 지침 제21조②에 따라 특수경비원 직무교육으로 갈음.</p>`
        : ui.empty(q || onlyAct || jobF ? "조건에 맞는 요원이 없습니다." : "등록된 요원이 없습니다.")}</div>`;
  }

  /* ═════════ 업체 · 점검 ═════════ */
  function vendorHTML(canW) {
    const vs = vendors();
    const inspDocs = window.SemisDocs ? SemisDocs.list(MOD, "inspect") : [];
    const lastInsp = inspDocs[0];
    return `<div class="pn-vendors">${vs.length ? vs.map(v => `<article class="pn-v" data-pv="${esc(v.id)}">
        <div class="pn-vh"><h4>${esc(v.name)}</h4>${v.kind ? ui.chip(v.kind, "blue") : ""}${canW ? `<button type="button" class="mt-btn m-ed" data-pv-edit="${esc(v.id)}" aria-label="업체 정보 수정">${icon("notes", 15)}</button>` : ""}</div>
        ${v.svc ? `<p class="pn-vs">${esc(v.svc)}</p>` : ""}
        <dl class="pn-vd">${[["지정 · 인가", v.lic], ["계약", v.contract], ["담당", v.contact], ["비고", v.note]].filter(x => x[1]).map(([k, x]) => `<div><dt>${k}</dt><dd>${esc(x)}</dd></div>`).join("")}</dl>
        ${v.id === "proscom" || vs.length === 1 ? `<div class="pn-vk"><span>요원 <b class="mono">${staff().length}</b></span><span>최근 점검 <b class="mono">${lastInsp ? esc(dot(lastInsp.date)) : "-"}</b></span></div>` : ""}
      </article>`).join("") : ui.empty("등록된 업체가 없습니다.")}
      ${canW ? `<button type="button" class="link-btn pn-vadd m-ed" id="pn-vadd">${icon("plus", 14)}<span>업체 추가</span></button>` : ""}</div>
      ${window.SemisDocs ? SemisDocs.card(MOD, { title: "업체 증빙 문서" }) : ""}`;
  }

  /* ═════════ 요원 상세 · 수정 ═════════ */
  function personView(id) {
    const s = arr("staff").find(x => x && x.id === id);
    if (!s) return;
    const x = status(s);
    const canW = SeMIS.canEdit();
    const ys = Object.keys(s.regs || {}).sort();
    openModal(`<h3>${esc(s.name)} ${supMark(s)} <small class="au-mh">${esc(roleOf(s))}</small></h3>
      <dl class="pn-dl">
        <div><dt>소속</dt><dd>${esc([JOBS[s.job], s.job === "screen" ? s.team : s.unit, s.pos].filter(Boolean).join(" · "))}</dd></div>
        <div><dt>초기교육</dt><dd class="mono">${esc((s.init && s.init.text) || "-")}</dd></div>
        <div><dt>직무교육(OJT)</dt><dd class="mono">${esc((s.ojt && s.ojt.text) || "-")}</dd></div>
        <div><dt>인증평가</dt><dd class="mono">${esc((s.cert && s.cert.text) || "-")}</dd></div>
        <div><dt>정기교육</dt><dd class="mono">${ys.length ? ys.map(y => esc(dot(s.regs[y]))).join(" · ") : "-"}</dd></div>
        <div><dt>다음 기한</dt><dd>${x.st === "exempt" ? "특수경비원 직무교육으로 갈음" : `<span class="mono">${esc(dot(x.exp) || "-")}</span>`} ${stChip(s)}</dd></div>
        ${x.winS ? `<div><dt>이수 기간</dt><dd class="mono">${esc(dot(x.winS))} ~ ${esc(dot(x.winE))}</dd></div>` : ""}
        ${s.note ? `<div><dt>비고</dt><dd>${esc(s.note)}</dd></div>` : ""}
        ${s.chk ? `<div><dt>확인 필요</dt><dd>${esc(s.chk)}</dd></div>` : ""}
      </dl>
      <div class="modal-actions">${canW ? '<button type="button" class="link-btn" data-act="edit">수정</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const e = $("#modal-box [data-act=edit]");
    if (e) e.onclick = () => personForm(id);
  }
  const spanIn = (id, lb, x) => `<div class="form-row"><label for="${id}">${lb}</label><input id="${id}" value="${esc((x && x.text) || "")}" maxlength="40" autocomplete="off" placeholder="예: 26.03.03~03.06"></div>`;
  /* '26.03.03~03.06' · '26.03.03' · '2026-03-03' → { text, start, end } */
  function parseSpan(t) {
    const s = norm(t);
    if (!s || s === "-") return { text: s, start: "", end: "" };
    if (isISO(s)) return { text: s, start: s, end: s };
    const m = /^'?(\d{2})\.(\d{1,2})\.(\d{1,2})/.exec(s);
    if (!m) return { text: s, start: "", end: "" };
    const y = 2000 + Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    const pad = (n) => String(n).padStart(2, "0");
    const start = `${y}-${pad(mo)}-${pad(da)}`;
    const seg = s.slice(m[0].length).split(/[~,]/).map(x => x.trim()).filter(Boolean).pop() || "";
    const n = (seg.match(/\d+/g) || []).map(Number);
    let ey = y, em = mo, ed = da;
    if (n.length >= 3) { ey = 2000 + n[0]; em = n[1]; ed = n[2]; }
    else if (n.length === 2) { em = n[0]; ed = n[1]; if (em < mo) ey = y + 1; }
    else if (n.length === 1) ed = n[0];
    const end = `${ey}-${pad(em)}-${pad(ed)}`;
    return { text: s, start, end: isISO(end) ? end : start };
  }
  function personForm(id) {
    if (!SeMIS.canEdit()) return;
    const s = id ? arr("staff").find(x => x && x.id === id) : null;
    const v = Object.assign({ name: "", job: "screen", unit: "", team: "", pos: "대원", sup: "", init: {}, ojt: {}, cert: {}, regs: {}, note: "", chk: "" }, s || {});
    const ys = Array.from(new Set(years().concat([String(new Date().getFullYear())]))).sort().slice(-3);
    openModal(`<h3>${s ? "요원 수정" : "요원 추가"}</h3>
      <div class="form-grid">
        <div class="form-row"><label for="pf-name">성명</label><input id="pf-name" value="${esc(v.name)}" maxlength="20" autocomplete="off"></div>
        <div class="form-row"><label for="pf-job">직무</label><select id="pf-job">${Object.keys(JOBS).map(k => `<option value="${k}" ${v.job === k ? "selected" : ""}>${JOBS[k]}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="pf-unit">반 · 조</label><input id="pf-unit" value="${esc(v.job === "screen" ? v.team : v.unit)}" maxlength="10" autocomplete="off" list="pf-units" placeholder="A반 · B반 · C반 / A조 · B조 · C조 · 일근"><datalist id="pf-units">${UNITS.concat(TEAMS).map(u => `<option value="${u}">`).join("")}</datalist></div>
        <div class="form-row"><label for="pf-pos">직책</label><select id="pf-pos">${["팀장", "반장", "조장", "대원"].map(p => `<option ${v.pos === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      </div>
      <div class="form-row"><label for="pf-sup">감독자</label><select id="pf-sup"><option value="">-</option><option value="sup" ${v.sup === "sup" ? "selected" : ""}>감독자 ★</option><option value="plan" ${v.sup === "plan" ? "selected" : ""}>감독자 예정 ☆</option></select></div>
      <div class="form-grid">${spanIn("pf-init", "초기교육", v.init)}${spanIn("pf-ojt", "직무교육(OJT)", v.ojt)}</div>
      ${spanIn("pf-cert", "인증평가", v.cert)}
      <div class="form-row"><label>정기교육</label><div class="pn-regs">${ys.map(y => `<label><small>${y}</small><input type="date" data-reg="${y}" value="${esc((v.regs || {})[y] || "")}"></label>`).join("")}</div></div>
      <div class="form-row"><label for="pf-note">비고</label><input id="pf-note" value="${esc(v.note)}" maxlength="200" autocomplete="off"></div>
      <div class="form-row"><label for="pf-chk">확인 필요</label><input id="pf-chk" value="${esc(v.chk)}" maxlength="200" autocomplete="off"></div>
      <div class="modal-actions">
        ${s ? '<button type="button" class="link-btn danger" data-act="left">퇴사 · 전출 처리</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const lf = $("#modal-box [data-act=left]");
    if (lf) lf.onclick = () => confirmModal(s.name + " 요원을 명부에서 제외할까요? (기록은 남습니다)", () => { s.left = todayISO(); SeMIS.save(); toast("명부에서 제외했습니다."); paint(); });
    $("#modal-box [data-act=ok]").onclick = () => {
      const name = norm($("#pf-name").value);
      if (!name) { toast("성명을 입력하세요.", true); $("#pf-name").focus(); return; }
      const job = $("#pf-job").value, unitTxt = norm($("#pf-unit").value);
      const regs = {};
      $$("#modal-box [data-reg]").forEach(i => { if (isISO(i.value)) regs[i.dataset.reg] = i.value; });
      Object.keys(v.regs || {}).forEach(y => { if (ys.indexOf(y) < 0 && isISO(v.regs[y])) regs[y] = v.regs[y]; });   // 화면 밖 연도는 보존
      const rec = { name, job, unit: job === "screen" ? "검색" : unitTxt, team: job === "screen" ? unitTxt : "", pos: $("#pf-pos").value, sup: $("#pf-sup").value,
        init: parseSpan($("#pf-init").value), ojt: parseSpan($("#pf-ojt").value), cert: parseSpan($("#pf-cert").value), regs,
        note: norm($("#pf-note").value), chk: norm($("#pf-chk").value) };
      const pv = P();
      if (!Array.isArray(pv.staff)) pv.staff = [];
      if (s) Object.assign(s, rec); else pv.staff.push(Object.assign({ id: uid("st"), vid: (vendors()[0] || {}).id || "" }, rec));
      D()[KEY] = pv;
      SeMIS.save(); closeModal(); toast("저장했습니다."); paint();
    };
  }
  function vendorForm(id) {
    if (!SeMIS.canEdit()) return;
    const v0 = id ? vendors().find(x => x && x.id === id) : null;
    const v = Object.assign({ name: "", kind: "", svc: "", lic: "", contract: "", contact: "", note: "" }, v0 || {});
    const f = (k, lb, ph) => `<div class="form-row"><label for="pv-${k}">${lb}</label><input id="pv-${k}" value="${esc(v[k])}" maxlength="160" autocomplete="off"${ph ? ` placeholder="${esc(ph)}"` : ""}></div>`;
    openModal(`<h3>${v0 ? "업체 정보" : "업체 추가"}</h3>
      <div class="form-grid">${f("name", "업체명")}${f("kind", "구분", "보안검색 · 경비 / 장비 유지보수 / 조업사")}</div>
      ${f("svc", "업무")}${f("lic", "지정 · 인가")}${f("contract", "계약")}${f("contact", "담당")}${f("note", "비고")}
      <div class="modal-actions">${v0 ? '<button type="button" class="link-btn danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(v0.name + " 업체를 삭제할까요?", () => { P().vendors = vendors().filter(x => x !== v0); SeMIS.save(); paint(); });
    $("#modal-box [data-act=ok]").onclick = () => {
      const rec = {};
      ["name", "kind", "svc", "lic", "contract", "contact", "note"].forEach(k => { rec[k] = norm($("#pv-" + k).value); });
      if (!rec.name) { toast("업체명을 입력하세요.", true); return; }
      const pv = P();
      if (!Array.isArray(pv.vendors)) pv.vendors = [];
      if (v0) Object.assign(v0, rec); else pv.vendors.push(Object.assign({ id: uid("vd") }, rec));
      D()[KEY] = pv;
      SeMIS.save(); closeModal(); toast("저장했습니다."); paint();
    };
  }

  /* ═════════ 화면 ═════════ */
  function bodyHTML(canW) {
    if (tab === "edu") return `<section class="card">${eduHTML()}</section>`;
    if (tab === "vendor") return vendorHTML(canW);
    return `<section class="card">${staffHTML()}</section>`;
  }
  function wire(box) {
    $$("[data-ps]", box).forEach(el => el.onclick = () => personView(el.dataset.ps));
    $$("[data-pv-edit]", box).forEach(el => el.onclick = () => vendorForm(el.dataset.pvEdit));
    const va = $("#pn-vadd", box); if (va) va.onclick = () => vendorForm("");
    $$("[data-pseg]", box).forEach(b => b.onclick = () => { if (b.dataset.pseg === "job") jobF = b.dataset.v; paint(); });
    const ac = $("#pn-act", box); if (ac) ac.onclick = () => { onlyAct = !onlyAct; paint(); };
    const qi = $("#pn-q", box);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const host = qi.closest(".card");
      if (host) { ui.repaintKeep(host, tab === "edu" ? eduHTML() : staffHTML(), qi); wire(host); }
    };
    if (window.SemisDocs) SemisDocs.wire(box, paint);
  }
  function paint() {
    if (routeNow() !== MOD) return;
    const box = document.getElementById("pn-body");
    if (!box) { SeMIS.renderView(); return; }
    box.innerHTML = bodyHTML(SeMIS.canEdit());
    wire(box);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 배지만 영향 */ }
    if (SeMIS.tidyView) try { SeMIS.tidyView(); } catch (e) { /* 정돈만 영향 */ }
  }
  function render(root) {
    const canW = SeMIS.canEdit();
    const t = stats();
    const pv = P();
    const act = !canW ? "" : tab === "vendor"
      ? `<button type="button" class="btn btn-primary btn-sm" id="pn-dadd">${icon("plus", 16)}<span>점검 · 증빙 추가</span></button>`
      : `<button type="button" class="btn btn-primary btn-sm" id="pn-add">${icon("plus", 16)}<span>요원 추가</span></button>`;
    root.innerHTML = ui.head({ title: TITLE, meta: pv.asOf ? "기준 " + dot(pv.asOf) : "", actions: act })
      + ui.stats([
        { label: "보안요원", value: t.all, sub: "검색 " + t.screen + " · 경비 " + t.guard },
        { label: "감독자", value: t.sup, sub: t.plan ? "예정 " + t.plan : "" },
        { label: "검색요원 자격 유효", value: t.screen ? t.qual + "/" + t.screen : "-", tone: t.screen && t.qual < t.screen ? "warn" : "" },
        { label: "정기교육 조치 필요", value: t.act, tone: t.act ? "bad" : "ok" }
      ])
      + `<div class="eq-tabs" role="tablist" aria-label="협력사 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-ptab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>`
      + `<div id="pn-body">${bodyHTML(canW)}</div>`;
    $$("[data-ptab]", root).forEach(x => x.onclick = () => { tab = x.dataset.ptab; q = ""; SeMIS.renderView(); });
    const ad = $("#pn-add", root); if (ad) ad.onclick = () => personForm("");
    const dd = $("#pn-dadd", root); if (dd) dd.onclick = () => window.SemisDocs && SemisDocs.form("", { mod: MOD, grp: "inspect", org: (vendors()[0] || {}).name || "" });
    wire(root);
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { return stats().act || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "users", module: MOD,
    items: () => staff().map(s => ({ title: s.name, sub: [roleOf(s), s.job === "screen" ? s.team : s.unit, s.pos].filter(Boolean).join(" · "),
      text: [s.name, roleOf(s), s.unit, s.team], route: MOD, pick: () => { tab = "edu"; q = s.name; } }))
      .concat(vendors().map(v => ({ title: v.name, sub: v.svc || "협력사", route: MOD, pick: () => { tab = "vendor"; } })))
  });

  /* ─────── 수검 체크리스트 증빙 ─────── */
  const DOC = (g, days) => (window.SemisDocs ? SemisDocs.evid(MOD, g, days) : { ok: false, text: "" });
  function evidence(mid) {
    const t = stats();
    switch (mid) {
      case "3.1": return DOC("license");
      case "3.3": { const d = DOC("inspect", 365); return d.ok ? d : { ok: false, text: "1년 안 점검 기록 없음" }; }
      case "3.4": return DOC("drug");
      case "3.5": return DOC("sems");
      case "9.2.1": return DOC("tsa", 400);
      case "8.2": return t.screen ? { ok: t.qual === t.screen, text: "검색요원 자격 유효 " + t.qual + "/" + t.screen } : { ok: false, text: "요원 기록 없음" };
      case "1.3": {
        if (!t.all) return DOC("edu", 400);
        const d = DOC("edu", 400);
        return { ok: t.act === 0 || d.ok, text: "정기교육 조치 필요 " + t.act + "명" + (d.ok ? " · " + d.text : "") };
      }
      default: return t.all ? { ok: true, text: "보안요원 " + t.all + "명" } : { ok: false, text: "요원 기록 없음" };
    }
  }
  window.SemisEvidence = window.SemisEvidence || {};
  window.SemisEvidence[MOD] = evidence;
  window.SemisDeep = window.SemisDeep || {};
  window.SemisDeep[MOD] = (sub) => { if (["staff", "edu", "vendor"].indexOf(sub) >= 0) { tab = sub; q = ""; onlyAct = false; } };

  window.SemisPartners = {
    status, chainExp, stats, parseSpan, roleOf, needAct, ST,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    getState() { return { tab, q, jobF, onlyAct }; },
    setState(o) { o = o || {}; if (o.tab) tab = o.tab; if (o.q !== undefined) q = String(o.q || ""); if (o.jobF !== undefined) jobF = o.jobF; if (o.onlyAct !== undefined) onlyAct = !!o.onlyAct; }
  };
})();
