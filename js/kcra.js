/* 상용화주 · RA 관리 — 지정 현황, 보안검색업무 협약(계약 · 협약 관리 연결), 현장점검, 월별 반입 통계.
   SeMIS.data.kcra = { asOf, list[{ id, name, alias[](협약 상대방 대조용 별칭), kind(상용화주|RA), code(협약 번호), site, desig, desigDate, until, lastCheck, note }],
     stats{ title, cols[], rows[{ m, v[] }], note } } — 업체 · 수치는 공용 DB 에만 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "kc-ra";
  const TITLE = "상용화주 · RA 관리";
  const D = () => SeMIS.data;
  const K = () => { const v = D().kcra; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const list = () => (Array.isArray(K().list) ? K().list : []).filter(Boolean);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const uid = () => "kc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const routeNow = () => String(location.hash || "").replace(/^#\/?/, "").split(/[?/]/)[0];
  let fixedToday = "";
  const todayISO = () => fixedToday || (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);

  if (window.SemisDocs) SemisDocs.define(MOD, [
    { id: "agree", label: "보안검색업무 협약 · 운영절차서" }, { id: "desig", label: "상용화주 지정" }, { id: "check", label: "현장점검" },
    { id: "std", label: "보안기준 · 절차" }, { id: "stats", label: "통계" }, { id: "misc", label: "기타" }
  ]);

  /* 협약 — 계약 · 협약 관리의 상용화주 협약 중 상대방 이름이 같은 것 */
  const keyName = (s) => norm(s).replace(/[()㈜\s]/g, "").replace(/주식회사|코리아/g, "").toLowerCase();
  function agreementOf(k) {
    const cs = window.SemisContracts ? SemisContracts.list() : (Array.isArray(D().contracts) ? D().contracts : []);
    const kn = keyName(k.name), alias = (k.alias || []).map(keyName);
    return cs.find(c => /상용화주/.test(c.title || "") && [kn].concat(alias).some(n => n && (keyName(c.party).indexOf(n) >= 0 || n.indexOf(keyName(c.party)) >= 0))) || null;
  }
  function agreeChip(c) {
    if (!c) return ui.chip("협약 없음", "red");
    const s = window.SemisContracts ? SemisContracts.state(c) : { label: "등록", tone: "gray" };
    return ui.chip(s.label, s.tone);
  }
  const docsOf = (k) => (window.SemisDocs ? SemisDocs.list(MOD).filter(d => keyName(d.org) && keyName(d.org) === keyName(k.name)) : []);
  const lastCheckOf = (k) => {
    const ds = docsOf(k).filter(d => d.grp === "check" && isISO(d.date)).map(d => d.date);
    return [k.lastCheck].concat(ds).filter(isISO).sort().pop() || "";
  };

  function listHTML(canW) {
    const ls = list();
    if (!ls.length) return ui.empty("등록된 상용화주가 없습니다.");
    return `<div class="table-wrap"><table class="tbl kc-tbl">
      <thead><tr><th>업체</th><th>구분</th><th>협약 번호</th><th>협약 기간</th><th>지정</th><th>최근 현장점검</th><th>문서</th></tr></thead>
      <tbody>${ls.map(k => { const c = agreementOf(k); const lc = lastCheckOf(k); const old = lc && dayDiff(lc, todayISO()) > 365; return `<tr data-kc="${esc(k.id)}" class="is-click">
        <td data-role="title"><b>${esc(k.name)}</b>${k.site ? `<div class="cell-sub">${esc(k.site)}</div>` : ""}</td>
        <td>${esc(k.kind || "상용화주")}</td>
        <td class="mono">${esc(k.code || "-")}</td>
        <td>${c ? `<span class="mono">${esc(dot(c.from) || "")}~${esc(dot(c.to) || "")}</span> ` : ""}${agreeChip(c)}</td>
        <td>${k.desig || k.desigDate ? `<span class="cell-sub">${esc([k.desig, dot(k.desigDate)].filter(Boolean).join(" · "))}</span>` : '<span class="cell-sub">-</span>'}</td>
        <td>${lc ? `<span class="mono">${esc(dot(lc))}</span>${old ? " " + ui.chip("1년 경과", "amber") : ""}` : ui.chip("기록 없음", "gray")}</td>
        <td class="mono">${docsOf(k).length || "-"}</td></tr>`; }).join("")}</tbody></table></div>`;
  }
  function statsHTML() {
    const s = K().stats;
    if (!s || !Array.isArray(s.rows) || !s.rows.length) return "";
    const cols = Array.isArray(s.cols) ? s.cols : [];
    const tot = cols.map((c, i) => s.rows.reduce((a, r) => a + (Number((r.v || [])[i]) || 0), 0));
    const mx = Math.max(1, ...s.rows.map(r => Number((r.v || [])[cols.length - 1]) || 0));
    return `<section class="card"><div class="card-title">${icon("grid", 18)}<span>${esc(s.title || "상용화주 반입 통계")}</span>${s.unit ? `<small class="cell-sub">${esc(s.unit)}</small>` : ""}</div>
      <div class="table-wrap"><table class="tbl kc-stat"><thead><tr><th>월</th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}<th aria-label="막대"></th></tr></thead>
      <tbody>${s.rows.map(r => { const v = r.v || []; const last = Number(v[cols.length - 1]) || 0; return `<tr><td class="mono">${esc(r.m)}</td>${cols.map((c, i) => `<td class="mono">${esc(v[i] == null ? "-" : v[i])}</td>`).join("")}
        <td class="kc-bar"><i style="width:${Math.round(last / mx * 100)}%"></i></td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td>합계</td>${tot.map(x => `<td class="mono"><b>${x}</b></td>`).join("")}<td></td></tr><tr><td>월 평균</td>${tot.map(x => `<td class="mono">${Math.round(x / s.rows.length)}</td>`).join("")}<td></td></tr></tfoot></table></div>
      ${s.note ? `<p class="pn-note">${esc(s.note)}</p>` : ""}</section>`;
  }

  function view(id) {
    const k = list().find(x => x.id === id);
    if (!k) return;
    const c = agreementOf(k);
    const canW = SeMIS.canEdit();
    const ds = docsOf(k);
    openModal(`<h3>${esc(k.name)} <small class="au-mh">${esc(k.kind || "상용화주")}</small></h3>
      <dl class="pn-dl">
        ${k.site ? `<div><dt>터미널 · 지역</dt><dd>${esc(k.site)}</dd></div>` : ""}
        <div><dt>협약</dt><dd>${c ? `${esc(c.title)} · <span class="mono">${esc(dot(c.from))}~${esc(dot(c.to))}</span> ${agreeChip(c)}` : "계약 · 협약 관리에 협약 없음"}</dd></div>
        <div><dt>협약 번호</dt><dd class="mono">${esc(k.code || "-")}</dd></div>
        <div><dt>지정</dt><dd>${esc([k.desig, dot(k.desigDate), k.until ? "유효 " + dot(k.until) : ""].filter(Boolean).join(" · ") || "-")}</dd></div>
        <div><dt>최근 현장점검</dt><dd class="mono">${esc(dot(lastCheckOf(k)) || "-")}</dd></div>
        ${k.note ? `<div><dt>비고</dt><dd>${esc(k.note)}</dd></div>` : ""}
      </dl>
      ${ds.length ? `<div class="form-row"><label>문서</label><ul class="dk-list">${ds.map(d => `<li class="dk-row"><span class="dk-ext mono">${esc(SemisDocs.labelOf(MOD, d.grp).slice(0, 2))}</span><div class="dk-main"><div class="dk-t">${(d.files || [])[0] ? `<a class="nb-file" href="${esc(d.files[0].url)}" target="_blank" rel="noopener" data-name="${esc(d.files[0].name)}">${esc(d.title)}</a>` : esc(d.title)}</div><div class="dk-meta">${esc(dot(d.date))}</div></div></li>`).join("")}</ul></div>` : ""}
      <div class="modal-actions">${canW ? '<button type="button" class="link-btn" data-act="edit">수정</button><span class="spacer" style="flex:1"></span>' : ""}<button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const e = $("#modal-box [data-act=edit]"); if (e) e.onclick = () => form(id);
  }
  function form(id) {
    if (!SeMIS.canEdit()) return;
    const k = id ? list().find(x => x.id === id) : null;
    const v = Object.assign({ name: "", kind: "상용화주", code: "", site: "", desig: "", desigDate: "", until: "", lastCheck: "", note: "" }, k || {});
    const f = (key, lb, type) => `<div class="form-row"><label for="kf-${key}">${lb}</label><input id="kf-${key}" ${type ? `type="${type}"` : 'maxlength="120" autocomplete="off"'} value="${esc(v[key])}"></div>`;
    openModal(`<h3>${k ? "상용화주 수정" : "상용화주 추가"}</h3>
      <div class="form-grid">${f("name", "업체명")}<div class="form-row"><label for="kf-kind">구분</label><select id="kf-kind">${["상용화주", "RA"].map(x => `<option ${v.kind === x ? "selected" : ""}>${x}</option>`).join("")}</select></div></div>
      <div class="form-grid">${f("code", "협약 번호")}${f("site", "터미널 · 지역")}</div>
      <div class="form-grid">${f("desig", "지정 근거 · 번호")}${f("desigDate", "지정일", "date")}</div>
      <div class="form-grid">${f("until", "지정 유효기한", "date")}${f("lastCheck", "최근 현장점검", "date")}</div>
      ${f("note", "비고")}
      <div class="modal-actions">${k ? '<button type="button" class="link-btn danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(k.name + "을(를) 목록에서 삭제할까요?", () => { K().list = list().filter(x => x !== k); SeMIS.save(); SeMIS.renderView(); });
    $("#modal-box [data-act=ok]").onclick = () => {
      const rec = { kind: $("#kf-kind").value };
      ["name", "code", "site", "desig", "note"].forEach(x => { rec[x] = norm($("#kf-" + x).value); });
      ["desigDate", "until", "lastCheck"].forEach(x => { rec[x] = $("#kf-" + x).value || ""; });
      if (!rec.name) { toast("업체명을 입력하세요.", true); return; }
      const kv = K();
      if (!Array.isArray(kv.list)) kv.list = [];
      if (k) Object.assign(k, rec); else kv.list.push(Object.assign({ id: uid() }, rec));
      D().kcra = kv;
      SeMIS.save(); closeModal(); toast("저장했습니다."); SeMIS.renderView();
    };
  }

  function stats() {
    const ls = list();
    const ag = ls.map(agreementOf);
    const valid = ag.filter(c => c && (!window.SemisContracts || SemisContracts.state(c).k !== "exp")).length;
    const checks = ls.map(lastCheckOf).filter(isISO).sort();
    const s = K().stats;
    const avg = s && Array.isArray(s.rows) && s.rows.length && Array.isArray(s.cols) ? Math.round(s.rows.reduce((a, r) => a + (Number((r.v || [])[s.cols.length - 1]) || 0), 0) / s.rows.length) : null;
    return { n: ls.length, valid, last: checks.pop() || "", noCheck: ls.filter(k => !lastCheckOf(k)).length, avg };
  }
  function render(root) {
    const canW = SeMIS.canEdit();
    const t = stats();
    root.innerHTML = ui.head({ title: TITLE, meta: K().asOf ? "기준 " + dot(K().asOf) : "", actions: canW ? `<button type="button" class="btn btn-primary btn-sm" id="kc-add">${icon("plus", 16)}<span>상용화주 추가</span></button>` : "" })
      + ui.stats([
        { label: "상용화주", value: t.n },
        { label: "협약 유효", value: t.n ? t.valid + "/" + t.n : "-", tone: t.valid < t.n ? "warn" : "ok" },
        { label: "최근 현장점검", value: t.last ? dot(t.last) : "-", sub: t.noCheck ? "기록 없음 " + t.noCheck + "곳" : "" },
        { label: "월 평균 반입", value: t.avg == null ? "-" : t.avg, sub: t.avg == null ? "" : "차량 대수" }
      ])
      + `<section class="card">${listHTML(canW)}</section>` + statsHTML()
      + (window.SemisDocs ? SemisDocs.card(MOD) : "");
    const ad = $("#kc-add", root); if (ad) ad.onclick = () => form("");
    $$("[data-kc]", root).forEach(el => el.onclick = () => view(el.dataset.kc));
    if (window.SemisDocs) SemisDocs.wire(root, () => SeMIS.renderView());
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "doc", module: MOD,
    items: () => list().map(k => ({ title: k.name, sub: [k.kind, k.code].filter(Boolean).join(" · "), text: [k.name, k.code, k.site], route: MOD }))
  });

  function evidence(mid) {
    const t = stats();
    if (!t.n) return { ok: false, text: "상용화주 없음" };
    if (mid === "6.5.1") {
      const s = K().stats;
      return s && (s.rows || []).length ? { ok: true, text: "월별 반입 통계 " + s.rows.length + "개월" } : { ok: false, text: "통계 없음" };
    }
    const doc = window.SemisDocs ? SemisDocs.evid(MOD, ["agree", "desig"]) : { ok: false };
    return { ok: t.valid === t.n && doc.ok, text: "협약 유효 " + t.valid + "/" + t.n + (t.last ? " · 현장점검 " + dot(t.last) : "") };
  }
  window.SemisEvidence = window.SemisEvidence || {};
  window.SemisEvidence[MOD] = evidence;
  window.SemisKcra = { stats, agreementOf, lastCheckOf, setToday(t) { fixedToday = isISO(t) ? t : ""; } };
})();
