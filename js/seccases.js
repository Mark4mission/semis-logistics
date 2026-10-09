/* 보안 처리 대장 — 특별보안검색 · DIP 면제 · 의심화물 · MCL · ASM · ACAS RFS/DNL · 보안사고 등 처리 사례 기록.
   SeMIS.data.secCases = [{ id, type, date, ref(MAWB), flight, pcs, uld, agent, shipper, region, start, end, by, result, note, files[], chk, at, who }]
   — 운송장 · 업체는 공용 DB 에만 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "sec-cases";
  const TITLE = "보안 처리 대장";
  const D = () => SeMIS.data;
  const list = () => (Array.isArray(D().secCases) ? D().secCases : []).filter(Boolean);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const uid = () => "sc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const me = () => { const u = SeMIS.user; return u ? u.name || u.id || "" : ""; };
  let fixedToday = "";
  const todayISO = () => fixedToday || (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const FILE_MAX = 50 * 1024 * 1024;

  /* 유형 — mids: 증빙하는 수검 체크리스트 항목 */
  const TYPES = [
    { id: "special", label: "특별보안검색", tone: "blue", mids: ["6.3", "6.3.1"] },
    { id: "dip", label: "DIP 개봉검색 면제", tone: "gray", mids: ["6.4"] },
    { id: "suspect", label: "의심화물", tone: "red", mids: ["6.6"] },
    { id: "oversize", label: "대형화물 개봉검색 · ETD", tone: "gray", mids: ["6.10"] },
    { id: "mcl", label: "외부인사 탑승 (MCL)", tone: "gray", mids: ["9.3"] },
    { id: "asm", label: "대체보안조치 (ASM)", tone: "gray", mids: ["9.8"] },
    { id: "rfs", label: "ACAS RFS", tone: "amber", mids: ["9.12"] },
    { id: "dnl", label: "ACAS DNL", tone: "red", mids: ["9.13"] },
    { id: "incident", label: "보안사고 · 준사고", tone: "amber", mids: ["2.6"] }
  ];
  const typeOf = (id) => TYPES.find(t => t.id === id) || { id, label: id || "기타", tone: "gray", mids: [] };

  if (window.SemisDocs) SemisDocs.define(MOD, [
    { id: "special", label: "특별보안검색 기준 · 양식" }, { id: "report", label: "처리 보고서" }, { id: "incident", label: "보안사고 · 준사고" },
    { id: "proc", label: "처리 절차" }, { id: "misc", label: "기타" }
  ]);

  let typeF = "", yearF = "", q = "";
  const years = () => Array.from(new Set(list().map(c => String(c.date || "").slice(0, 4)).filter(y => /^\d{4}$/.test(y)))).sort().reverse();
  const hay = (c) => [c.ref, c.flight, c.agent, c.shipper, c.region, c.by, c.result, c.note, typeOf(c.type).label].join(" ").toLowerCase();
  function rows() {
    return list().filter(c => (!typeF || c.type === typeF) && (!yearF || String(c.date || "").slice(0, 4) === yearF) && (!q || hay(c).indexOf(q.toLowerCase()) >= 0))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.start || "").localeCompare(String(a.start || "")));
  }
  const pcsTxt = (c) => [c.pcs ? c.pcs + " PCS" : "", c.uld ? (/^\d+$/.test(String(c.uld)) ? "ULD " + c.uld : c.uld) : ""].filter(Boolean).join(" · ") || "-";
  const timeTxt = (c) => (c.start || c.end ? `${c.start || "?"}–${c.end || "?"}` : "-");

  function tableHTML() {
    const rs = rows();
    const y = yearF || "";
    const ys = years();
    const counts = {};
    list().filter(c => !y || String(c.date || "").slice(0, 4) === y).forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });
    return `<div class="toolbar">${ui.search("sx-q", "운송장 · 편명 · 대리점 · 화주 검색", q)}
        ${ys.length > 1 ? `<div class="seg" role="group" aria-label="연도">${[["", "전체"]].concat(ys.map(v => [v, v])).map(([v, lb]) => `<button type="button" class="seg-btn" data-scy="${esc(v)}" aria-pressed="${v === yearF}">${esc(lb)}</button>`).join("")}</div>` : ""}</div>
      <div class="sx-types" role="group" aria-label="유형">${TYPES.map(t => `<button type="button" class="sx-type${typeF === t.id ? " on" : ""}" data-sct="${esc(t.id)}" aria-pressed="${typeF === t.id}"><span>${esc(t.label)}</span><b class="mono">${counts[t.id] || 0}</b></button>`).join("")}</div>
      <div id="sx-list">${rs.length ? `<div class="table-wrap"><table class="tbl sx-tbl">
        <thead><tr><th>일자</th><th>유형</th><th>운송장</th><th>편명</th><th>수량</th><th>대리점 · 화주</th><th>작업 시간</th><th>처리 · 비고</th><th>보고서</th></tr></thead>
        <tbody>${rs.map(c => { const t = typeOf(c.type); const f = (c.files || [])[0]; return `<tr data-sc="${esc(c.id)}" class="is-click">
          <td class="mono">${esc(dot(c.date) || "-")}</td><td>${ui.chip(t.label, t.tone)}</td>
          <td class="mono" data-role="title">${esc(c.ref || "-")}</td><td class="mono">${esc(c.flight || "-")}</td><td>${esc(pcsTxt(c))}</td>
          <td>${esc(c.agent || "-")}${c.shipper ? `<div class="cell-sub">${esc(c.shipper)}${c.region ? " · " + esc(c.region) : ""}</div>` : ""}</td>
          <td class="mono">${esc(timeTxt(c))}</td>
          <td>${esc(c.result || c.by || "")}${c.chk ? ` ${ui.chip("확인 필요", "amber")}` : ""}${c.note ? `<div class="cell-sub">${esc(c.note)}</div>` : ""}${!c.by && !c.result && !c.chk && !c.note ? '<span class="cell-sub">-</span>' : ""}</td>
          <td>${f ? `<a class="nb-file sx-f" href="${esc(f.url)}" target="_blank" rel="noopener" data-name="${esc(f.name)}">${icon("doc", 14)}<span>${(c.files || []).length}</span></a>` : '<span class="cell-sub">없음</span>'}</td></tr>`; }).join("")}</tbody></table></div>`
        : ui.empty(q || typeF || yearF ? "조건에 맞는 기록이 없습니다." : "등록된 기록이 없습니다.")}</div>`;
  }

  const fileChips = (files, del) => (files || []).map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>${del ? `<button type="button" class="mt-btn danger" data-${del}="${i}" aria-label="첨부 삭제">${icon("x", 14)}</button>` : ""}</span>`).join("");
  function view(id) {
    const c = list().find(x => x.id === id);
    if (!c) return;
    const t = typeOf(c.type);
    const canW = SeMIS.canEdit();
    const row = (k, v, mono) => (v ? `<div><dt>${k}</dt><dd${mono ? ' class="mono"' : ""}>${esc(v)}</dd></div>` : "");
    openModal(`<h3>${esc(t.label)} <small class="au-mh mono">${esc(dot(c.date))}</small></h3>
      <dl class="pn-dl">${row("운송장(MAWB)", c.ref, 1)}${row("편명", c.flight, 1)}${row("수량", pcsTxt(c) === "-" ? "" : pcsTxt(c))}${row("대리점", c.agent)}${row("화주", c.shipper)}${row("지역", c.region)}
        ${row("작업 시간", timeTxt(c) === "-" ? "" : timeTxt(c), 1)}${row("확인", c.by)}${row("처리 결과", c.result)}${row("비고", c.note)}${row("확인 필요", c.chk)}</dl>
      <div class="form-row"><label>보고서 · 첨부</label><div class="au-files nb-files-view">${fileChips(c.files) || '<span class="cell-sub">없음</span>'}</div></div>
      <div class="modal-actions">${canW ? '<button type="button" class="link-btn" data-act="edit">수정</button><span class="spacer" style="flex:1"></span>' : ""}<button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const e = $("#modal-box [data-act=edit]"); if (e) e.onclick = () => form(id);
  }
  async function uploadInto(files, fl, done) {
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of Array.from(fl || [])) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("업로드 중: " + file.name);
      try { const up = await SemisSync.uploadFile(file, "cases"); files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url }); }
      catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }
  function form(id, preset) {
    if (!SeMIS.canEdit()) return;
    const c = id ? list().find(x => x.id === id) : null;
    const v = Object.assign({ type: typeF || "special", date: todayISO(), ref: "", flight: "", pcs: "", uld: "", agent: "", shipper: "", region: "", start: "", end: "", by: "", result: "", note: "", chk: "" }, preset || {}, c || {});
    const files = (v.files || []).map(f => Object.assign({}, f));
    const f = (k, lb, ph, type) => `<div class="form-row"><label for="sf-${k}">${lb}</label><input id="sf-${k}" ${type ? `type="${type}"` : 'maxlength="120" autocomplete="off"'} value="${esc(v[k])}"${ph ? ` placeholder="${esc(ph)}"` : ""}></div>`;
    openModal(`<h3>${c ? "기록 수정" : "기록 추가"}</h3>
      <div class="form-grid"><div class="form-row"><label for="sf-type">유형</label><select id="sf-type">${TYPES.map(t => `<option value="${t.id}" ${v.type === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></div>${f("date", "일자", "", "date")}</div>
      <div class="form-grid">${f("ref", "운송장(MAWB)", "예: 994-XXXXXXXX")}${f("flight", "편명", "예: KJ182/24FEB")}</div>
      <div class="form-grid">${f("pcs", "수량(PCS)")}${f("uld", "ULD")}</div>
      <div class="form-grid">${f("agent", "대리점")}${f("shipper", "화주")}</div>
      <div class="form-grid">${f("region", "지역")}${f("by", "확인 (입회 · 확인자)")}</div>
      <div class="form-grid">${f("start", "시작", "", "time")}${f("end", "종료", "", "time")}</div>
      ${f("result", "처리 결과")}${f("note", "비고")}${f("chk", "확인 필요")}
      <div class="form-row"><label>보고서 · 첨부</label><div class="au-files au-files-edit" id="sf-files"></div><input type="file" id="sf-file" multiple hidden>
        <button type="button" class="btn btn-ghost btn-sm" id="sf-fbtn">${icon("link", 15)}<span>파일 첨부</span></button></div>
      <div class="modal-actions">${c ? '<button type="button" class="link-btn danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    const paint2 = () => { $("#sf-files").innerHTML = fileChips(files, "sff"); $$("[data-sff]").forEach(b => b.onclick = () => { files.splice(Number(b.dataset.sff), 1); paint2(); }); };
    paint2();
    $("#sf-fbtn").onclick = () => $("#sf-file").click();
    $("#sf-file").onchange = () => { const fl = Array.from($("#sf-file").files || []); $("#sf-file").value = ""; uploadInto(files, fl, paint2); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal("이 기록을 지울까요?", () => { D().secCases = list().filter(x => x !== c); SeMIS.save(); toast("지웠습니다."); SeMIS.renderView(); });
    $("#modal-box [data-act=ok]").onclick = () => {
      const rec = { type: $("#sf-type").value, date: $("#sf-date").value || "", files: files.slice(), at: new Date().toISOString(), who: me() };
      ["ref", "flight", "pcs", "uld", "agent", "shipper", "region", "start", "end", "by", "result", "note", "chk"].forEach(k => { rec[k] = norm($("#sf-" + k).value); });
      if (!isISO(rec.date)) { toast("일자를 입력하세요.", true); return; }
      if (!Array.isArray(D().secCases)) D().secCases = [];
      if (c) Object.assign(c, rec); else D().secCases.push(Object.assign({ id: uid() }, rec));
      SeMIS.save(); closeModal(); toast("저장했습니다."); SeMIS.renderView();
    };
  }

  function stats() {
    const t = todayISO(), y = t.slice(0, 4), ym = t.slice(0, 7);
    const all = list();
    return { all: all.length, year: all.filter(c => String(c.date || "").slice(0, 4) === y).length,
      special: all.filter(c => c.type === "special" && String(c.date || "").slice(0, 4) === y).length,
      month: all.filter(c => String(c.date || "").slice(0, 7) === ym).length,
      nofile: all.filter(c => !(c.files || []).length).length, y };
  }
  function wire(root) {
    $$("[data-sc]", root).forEach(el => el.onclick = (ev) => { if (ev.target.closest("a")) return; view(el.dataset.sc); });
    $$("[data-sct]", root).forEach(b => b.onclick = () => { typeF = typeF === b.dataset.sct ? "" : b.dataset.sct; SeMIS.renderView(); });
    $$("[data-scy]", root).forEach(b => b.onclick = () => { yearF = b.dataset.scy; SeMIS.renderView(); });
    const qi = $("#sx-q", root);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const host = qi.closest(".card");
      if (host) { ui.repaintKeep(host, tableHTML(), qi); wire(host); }
    };
  }
  function render(root) {
    const canW = SeMIS.canEdit();
    const t = stats();
    root.innerHTML = ui.head({ title: TITLE, actions: canW ? `<button type="button" class="btn btn-primary btn-sm" id="sx-add">${icon("plus", 16)}<span>기록 추가</span></button>` : "" })
      + ui.stats([
        { label: t.y + "년 처리", value: t.year, sub: "전체 " + t.all },
        { label: "특별보안검색 (" + t.y + ")", value: t.special },
        { label: "이번 달", value: t.month },
        { label: "보고서 없음", value: t.nofile, tone: t.nofile ? "warn" : "ok" }
      ])
      + `<section class="card" id="sx-card">${tableHTML()}</section>`
      + (window.SemisDocs ? SemisDocs.card(MOD) : "");
    const ad = $("#sx-add", root); if (ad) ad.onclick = () => form("");
    wire(root);
    if (window.SemisDocs) SemisDocs.wire(root, () => SeMIS.renderView());
  }

  SeMIS.registerModule(MOD, { title: TITLE, navBadge() { return ""; }, render });
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "scan", module: MOD,
    items: () => list().map(c => ({ title: (c.ref || typeOf(c.type).label), sub: [typeOf(c.type).label, dot(c.date), c.flight, c.shipper].filter(Boolean).join(" · "),
      text: [c.ref, c.flight, c.agent, c.shipper, c.note], route: MOD, pick: () => { q = c.ref || ""; typeF = ""; yearF = ""; } }))
  });

  /* 증빙 — 유형별 기록(1년) · 보고서 첨부 */
  function evidence(mid) {
    const ts = TYPES.filter(t => t.mids.indexOf(mid) >= 0).map(t => t.id);
    if (!ts.length) return { ok: list().length > 0, text: "처리 기록 " + list().length + "건" };
    const rs = list().filter(c => ts.indexOf(c.type) >= 0);
    const recent = rs.filter(c => isISO(c.date) && dayDiff(c.date, todayISO()) <= 365);
    const docs = window.SemisDocs ? SemisDocs.list(MOD).filter(d => ts.indexOf(d.grp) >= 0 || d.grp === "proc") : [];
    if (!rs.length) return docs.length ? { ok: true, text: "처리 사례 없음 · 절차 문서 " + docs.length + "건" } : { ok: false, text: "처리 사례 없음" };
    const withFile = recent.filter(c => (c.files || []).length).length;
    return { ok: recent.length > 0 && (mid !== "6.3.1" || withFile === recent.length), text: `1년 ${recent.length}건 · 보고서 ${withFile}/${recent.length}` };
  }
  window.SemisEvidence = window.SemisEvidence || {};
  window.SemisEvidence[MOD] = evidence;
  window.SemisDeep = window.SemisDeep || {};
  window.SemisDeep[MOD] = (sub) => { typeF = TYPES.some(t => t.id === sub) ? sub : ""; yearF = ""; q = ""; };
  window.SemisCases = { TYPES, stats, evidence, setToday(t) { fixedToday = isISO(t) ? t : ""; }, setState(o) { o = o || {}; if (o.typeF !== undefined) typeF = o.typeF; if (o.yearF !== undefined) yearF = o.yearF; if (o.q !== undefined) q = o.q; } };
})();
