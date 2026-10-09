/* 계약 · 협약 관리 — 안전 · 보안 관련 계약의 상대방 · 기간 · 해지 조건 · 계약서. 만료가 가까운 계약이 위로.
   SeMIS.data.contracts = [{ id, no, kind(안전|보안), title, party, period(원문), from, to, open(자동 연장),
     terminate, owner, dept, scope, note, files[], prev[](이전 계약서), at, by }] — 공용 DB 에만 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "contracts";
  const TITLE = "계약 · 협약 관리";
  const D = () => SeMIS.data;
  const list = () => (Array.isArray(D().contracts) ? D().contracts : []).filter(Boolean);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const uid = () => "ct" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const me = () => { const u = SeMIS.user; return u ? u.name || u.id || "" : ""; };
  const routeNow = () => String(location.hash || "").replace(/^#\/?/, "").split(/[?/]/)[0];
  let fixedToday = "";
  const todayISO = () => fixedToday || (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const FILE_MAX = 50 * 1024 * 1024;
  const SOON = 60;
  const KINDS = ["보안", "안전"];

  /* 상태: 진행(자동 연장 포함) · 임박(60일) · 만료 · 기간 미상 */
  function state(c, t) {
    t = t || todayISO();
    if (!isISO(c.to)) return c.open ? { k: "open", label: "자동 연장", tone: "blue" } : { k: "nod", label: "기간 미기재", tone: "gray" };
    const d = dayDiff(t, c.to);
    if (d < 0) return c.open ? { k: "open", label: "자동 연장", tone: "blue", d } : { k: "exp", label: "만료", tone: "red", d };
    if (d <= SOON) return { k: "soon", label: c.open ? "갱신 확인" : "만료 임박", tone: "amber", d };
    return { k: "ok", label: "진행", tone: "green", d };
  }
  const order = { exp: 0, soon: 1, ok: 2, open: 3, nod: 4 };

  let q = "", kindF = "";
  const hay = (c) => [c.title, c.party, c.owner, c.kind, c.note, c.scope].join(" ").toLowerCase();
  function rows() {
    return list().filter(c => (!kindF || c.kind === kindF) && (!q || hay(c).indexOf(q.toLowerCase()) >= 0))
      .sort((a, b) => (order[state(a).k] - order[state(b).k]) || String(a.to || "9").localeCompare(String(b.to || "9")) || (Number(a.no) || 99) - (Number(b.no) || 99));
  }
  const periodTxt = (c) => (isISO(c.from) || isISO(c.to) ? `${dot(c.from) || "?"} ~ ${dot(c.to) || ""}${c.open ? " (자동 연장)" : ""}` : c.period || "-");
  function listHTML() {
    const rs = rows();
    const segs = [["", "전체"]].concat(KINDS.filter(k => list().some(c => c.kind === k)).map(k => [k, k]));
    return `<div class="toolbar">${ui.search("kt-q", "계약명 · 상대방 · 담당 검색", q)}
        ${segs.length > 2 ? `<div class="seg" role="group" aria-label="구분">${segs.map(([v, lb]) => `<button type="button" class="seg-btn" data-ckind="${esc(v)}" aria-pressed="${v === kindF}">${esc(lb)}</button>`).join("")}</div>` : ""}</div>
      <div id="kt-list">${rs.length ? `<div class="table-wrap"><table class="tbl kt-tbl">
        <thead><tr><th>구분</th><th>계약명</th><th>상대방</th><th>계약기간</th><th>해지 조건</th><th>담당</th><th>계약서</th><th>상태</th></tr></thead>
        <tbody>${rs.map(c => { const s = state(c); const f = (c.files || [])[0]; return `<tr data-ct="${esc(c.id)}" class="is-click">
          <td>${ui.chip(c.kind || "-", c.kind === "보안" ? "blue" : "gray")}</td>
          <td data-role="title"><b>${esc(c.title)}</b>${c.scope ? `<div class="cell-sub">${esc(c.scope)}</div>` : ""}</td>
          <td>${esc(c.party || "-")}</td>
          <td class="mono">${esc(periodTxt(c))}</td>
          <td><span class="cell-sub">${esc(c.terminate || "-")}</span></td>
          <td>${esc(c.owner || "-")}</td>
          <td>${f ? `<a class="nb-file kt-f" href="${esc(f.url)}" target="_blank" rel="noopener" data-name="${esc(f.name)}">${icon("link", 14)}<span>${(c.files || []).length}건</span></a>` : '<span class="cell-sub">없음</span>'}</td>
          <td>${ui.chip(s.label + (s.k === "soon" ? " D-" + s.d : ""), s.tone)}</td></tr>`; }).join("")}</tbody></table></div>`
        : ui.empty(q || kindF ? "조건에 맞는 계약이 없습니다." : "등록된 계약이 없습니다.")}</div>`;
  }

  const fileChips = (files, del) => (files || []).map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>${del ? `<button type="button" class="mt-btn danger" data-${del}="${i}" aria-label="첨부 삭제">${icon("x", 14)}</button>` : ""}</span>`).join("");
  function view(id) {
    const c = list().find(x => x.id === id);
    if (!c) return;
    const s = state(c);
    const canW = SeMIS.canEdit();
    openModal(`<h3>${esc(c.title)}</h3>
      <dl class="pn-dl">
        <div><dt>상대방</dt><dd>${esc(c.party || "-")}</dd></div>
        <div><dt>구분</dt><dd>${esc(c.kind || "-")}${c.dept ? " · " + esc(c.dept) : ""}</dd></div>
        <div><dt>계약기간</dt><dd><span class="mono">${esc(periodTxt(c))}</span> ${ui.chip(s.label, s.tone)}</dd></div>
        ${c.period && (isISO(c.from) || isISO(c.to)) ? `<div><dt>원문 기간</dt><dd>${esc(c.period)}</dd></div>` : ""}
        <div><dt>해지 조건</dt><dd>${esc(c.terminate || "-")}</dd></div>
        <div><dt>담당</dt><dd>${esc(c.owner || "-")}</dd></div>
        ${c.scope ? `<div><dt>보안 업무 범위</dt><dd>${esc(c.scope)}</dd></div>` : ""}
        ${c.note ? `<div><dt>비고</dt><dd>${esc(c.note)}</dd></div>` : ""}
      </dl>
      <div class="form-row"><label>계약서</label><div class="au-files nb-files-view">${fileChips(c.files) || '<span class="cell-sub">없음</span>'}</div></div>
      ${(c.prev || []).length ? `<details class="kt-prev"><summary>이전 계약서 ${(c.prev || []).length}</summary><div class="au-files nb-files-view">${fileChips(c.prev)}</div></details>` : ""}
      <div class="modal-actions">${canW ? '<button type="button" class="link-btn" data-act="edit">수정</button><span class="spacer" style="flex:1"></span>' : ""}<button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const e = $("#modal-box [data-act=edit]"); if (e) e.onclick = () => form(id);
  }
  async function uploadInto(files, fl, done) {
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of Array.from(fl || [])) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("업로드 중: " + file.name);
      try { const up = await SemisSync.uploadFile(file, "contracts"); files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url }); }
      catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }
  function form(id) {
    if (!SeMIS.canEdit()) return;
    const c = id ? list().find(x => x.id === id) : null;
    const v = Object.assign({ kind: "보안", title: "", party: "", period: "", from: "", to: "", open: false, terminate: "", owner: "", dept: "", scope: "", note: "" }, c || {});
    const files = (v.files || []).map(f => Object.assign({}, f)), prev = (v.prev || []).map(f => Object.assign({}, f));
    const f = (k, lb, ph, max) => `<div class="form-row"><label for="cf-${k}">${lb}</label><input id="cf-${k}" value="${esc(v[k])}" maxlength="${max || 160}" autocomplete="off"${ph ? ` placeholder="${esc(ph)}"` : ""}></div>`;
    openModal(`<h3>${c ? "계약 수정" : "계약 등록"}</h3>
      ${f("title", "계약명")}
      <div class="form-grid">${f("party", "상대방")}<div class="form-row"><label for="cf-kind">구분</label><select id="cf-kind">${KINDS.map(k => `<option ${v.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></div></div>
      <div class="form-grid"><div class="form-row"><label for="cf-from">시작일</label><input id="cf-from" type="date" value="${esc(isISO(v.from) ? v.from : "")}"></div>
        <div class="form-row"><label for="cf-to">종료일</label><input id="cf-to" type="date" value="${esc(isISO(v.to) ? v.to : "")}"></div></div>
      <label class="au-opt"><input type="checkbox" id="cf-open" ${v.open ? "checked" : ""}> 자동 연장 (Open)</label>
      ${f("period", "원문 기간", "예: 2026.4.1~2027.3.31 (Open)", 80)}
      <div class="form-grid">${f("terminate", "해지 조건")}${f("owner", "담당")}</div>
      ${f("scope", "보안 업무 범위", "예: 화물 보안검색 · 항공경비 · 위해물품 관리")}
      ${f("note", "비고")}
      <div class="form-row"><label>계약서</label><div class="au-files au-files-edit" id="cf-files"></div><input type="file" id="cf-file" multiple hidden>
        <button type="button" class="btn btn-ghost btn-sm" id="cf-fbtn">${icon("link", 15)}<span>파일 첨부</span></button></div>
      <div class="form-row"><label>이전 계약서</label><div class="au-files au-files-edit" id="cf-prev"></div></div>
      <div class="modal-actions">${c ? '<button type="button" class="link-btn danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    const paint2 = () => {
      $("#cf-files").innerHTML = fileChips(files, "cff");
      $("#cf-prev").innerHTML = prev.length ? fileChips(prev, "cfp") : '<span class="cell-sub">없음</span>';
      $$("[data-cff]").forEach(b => b.onclick = () => { prev.unshift(files.splice(Number(b.dataset.cff), 1)[0]); paint2(); });   // 빼면 이전 계약서로
      $$("[data-cfp]").forEach(b => b.onclick = () => { prev.splice(Number(b.dataset.cfp), 1); paint2(); });
    };
    paint2();
    $("#cf-fbtn").onclick = () => $("#cf-file").click();
    $("#cf-file").onchange = () => { const fl = Array.from($("#cf-file").files || []); $("#cf-file").value = ""; uploadInto(files, fl, paint2); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal("이 계약을 목록에서 삭제할까요?", () => { D().contracts = list().filter(x => x !== c); SeMIS.save(); toast("삭제했습니다."); paint(); });
    $("#modal-box [data-act=ok]").onclick = () => {
      const rec = { kind: $("#cf-kind").value, from: $("#cf-from").value || "", to: $("#cf-to").value || "", open: !!$("#cf-open").checked, files: files.slice(), prev: prev.slice(), at: new Date().toISOString(), by: me() };
      ["title", "party", "period", "terminate", "owner", "scope", "note"].forEach(k => { rec[k] = norm($("#cf-" + k).value); });
      if (!rec.title) { toast("계약명을 입력하세요.", true); $("#cf-title").focus(); return; }
      if (!Array.isArray(D().contracts)) D().contracts = [];
      if (c) Object.assign(c, rec); else D().contracts.push(Object.assign({ id: uid(), no: list().length + 1 }, rec));
      SeMIS.save(); closeModal(); toast("저장했습니다."); paint();
    };
  }

  function wire(box) {
    $$("[data-ct]", box).forEach(el => el.onclick = (ev) => { if (ev.target.closest("a")) return; view(el.dataset.ct); });
    $$("[data-ckind]", box).forEach(b => b.onclick = () => { kindF = b.dataset.ckind; paint(); });
    const qi = $("#kt-q", box);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const host = qi.closest(".card");
      if (host) { ui.repaintKeep(host, listHTML(), qi); wire(host); }
    };
  }
  function paint() {
    if (routeNow() !== MOD) return;
    const box = document.getElementById("kt-card");
    if (!box) { SeMIS.renderView(); return; }
    SeMIS.renderView();
  }
  function stats() {
    const all = list();
    const st = all.map(c => state(c).k);
    return { all: all.length, sec: all.filter(c => c.kind === "보안").length, soon: st.filter(k => k === "soon").length, exp: st.filter(k => k === "exp").length,
      nofile: all.filter(c => !(c.files || []).length).length };
  }
  function render(root) {
    const t = stats();
    root.innerHTML = ui.head({ title: TITLE, meta: "인천화물팀 안전 · 보안", actions: SeMIS.canEdit() ? `<button type="button" class="btn btn-primary btn-sm" id="kt-add">${icon("plus", 16)}<span>계약 등록</span></button>` : "" })
      + ui.stats([
        { label: "계약 · 협약", value: t.all, sub: "보안 " + t.sec + " · 안전 " + (t.all - t.sec) },
        { label: "만료 임박", value: t.soon, tone: t.soon ? "warn" : "ok" },
        { label: "만료", value: t.exp, tone: t.exp ? "bad" : "ok" },
        { label: "계약서 없음", value: t.nofile, tone: t.nofile ? "warn" : "ok" }
      ])
      + `<section class="card" id="kt-card">${listHTML()}</section>`;
    const ad = $("#kt-add", root); if (ad) ad.onclick = () => form("");
    wire(root);
  }

  SeMIS.registerModule(MOD, { title: TITLE, navBadge() { const t = stats(); return t.soon + t.exp || ""; }, render });
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "doc", module: MOD,
    items: () => list().map(c => ({ title: c.title, sub: [c.party, periodTxt(c)].filter(Boolean).join(" · "), text: [c.title, c.party, c.owner, c.scope], route: MOD, pick: () => { q = c.party || ""; } }))
  });

  /* 증빙: 3.1 · 3.2 = 보안 협력업체 계약서 / 6.5 = 상용화주 협약 */
  function evidence(mid) {
    const all = list();
    const has = (re) => all.filter(c => re.test([c.title, c.party, c.scope].join(" ")) && (c.files || []).length);
    if (mid === "6.5" || mid === "6.5.1" || mid === "9.9") {
      const k = has(/상용화주/);
      return k.length ? { ok: k.every(c => state(c).k !== "exp"), text: "상용화주 협약 " + k.length + "건" } : { ok: false, text: "상용화주 협약 없음" };
    }
    const s = all.filter(c => c.kind === "보안" && !/상용화주/.test(c.title) && (c.files || []).length);
    const s2 = s.length ? s : has(/보안|경비|검색/);
    return s2.length ? { ok: s2.every(c => state(c).k !== "exp"), text: "보안 계약 " + s2.length + "건" } : { ok: false, text: "보안 계약서 없음" };
  }
  window.SemisEvidence = window.SemisEvidence || {};
  window.SemisEvidence[MOD] = evidence;
  window.SemisContracts = { state, stats, list, setToday(t) { fixedToday = isISO(t) ? t : ""; }, setState(o) { o = o || {}; if (o.q !== undefined) q = String(o.q || ""); if (o.kindF !== undefined) kindF = o.kindF; } };
})();
