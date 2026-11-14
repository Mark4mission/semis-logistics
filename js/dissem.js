/* 전파교육 — 본사 통보(규정 개정 · 보안등급 · 보고체계 · TSA 등)를 파트 · 협력사에 전파 · 회람교육한 기록. 건 × 파트 이행 표.
   v1.71: ① '교육 전파 · 서명'(js/learn.js)으로 받은 교육(보안 · 안전 · 위험물)은 등록 없이 자동으로 한 줄(서명 수로 이행 계산, 누르면 그 교육)
          ② 칸 = 인원 관리의 파트 · 협력업체(UCC · 안전보안파트 · 수입통과파트 · 수출파트 · 협력업체…). 옛 칸 이름(ss · exp · imp …)은 ALIAS 로 읽는다
          ③ 손으로 등록하는 것은 종이 회람처럼 서명 기능을 쓰지 않은 전파만
   SeMIS.data.dissem = { depts[{ id, label, vendor }], events[{ id, date, title, kind, src, notice[](통보 원문),
     docs[](회람지 등), targets[], res{ 파트id: { date, files[], note } }, note, chk }] } — 공용 DB 에만 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "dissem";
  const TITLE = "전파교육";
  const D = () => SeMIS.data;
  const V = () => { const v = D().dissem; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const DEF_DEPTS = [
    { id: "ss", label: "안전보안" }, { id: "ops", label: "운영(직속)" }, { id: "exp", label: "수출" }, { id: "imp", label: "수입" },
    { id: "tra", label: "통과" }, { id: "gen", label: "일반지원" }, { id: "gmp", label: "김포" }, { id: "aap", label: "AAP", vendor: true }, { id: "psc", label: "프로에스콤", vendor: true }
  ];
  const KINDS = ["규정 개정", "보안등급 · 경보", "보고체계", "TSA · 해외 당국", "지침 · 강화", "기타"];
  /* 옛 칸 id → 지금 칸(인원 관리의 그룹 이름) */
  const ALIAS = { ss: "안전보안파트", exp: "수출파트", imp: "수입통과파트", tra: "수입통과파트", gen: "UCC", ops: "운영(직속)", gmp: "김포", aap: "AAP", psc: "프로에스콤" };
  const SELF_EXTRA = ["운영(직속)", "김포"];
  const colKey = (k) => { const c = (Array.isArray(V().depts) ? V().depts : []).find(d => d && d.id === k); return c ? c.label : (ALIAS[k] || String(k || "")); };
  const stored = () => (Array.isArray(V().events) ? V().events : []).filter(Boolean);
  const LN = () => window.SemisLearn;
  /* 교육 전파 · 서명에서 온 줄 — 저장하지 않고 그때그때 만든다 */
  function learnEvents() {
    if (!LN() || !LN().dissemRows) return [];
    let rows = [];
    try { rows = LN().dissemRows(); } catch (e) { rows = []; }
    return rows.map(r => ({ id: "ln:" + r.id, learn: r, date: r.date, title: r.title, kind: "교육(" + (r.kind || "기타") + ")", src: r.offline ? "집체 교육 · 서명" : "온라인 교육 · 서명", note: "" }));
  }
  const events = () => stored().concat(learnEvents());
  function depts() {
    const out = [], seen = new Set();
    const add = (g, vendor) => { g = String(g || ""); if (!g || seen.has(g)) return; seen.add(g); out.push({ id: g, label: g, vendor: !!vendor }); };
    const R = window.SemisRoster;
    let gs = [];
    try { gs = R && R.groups ? R.groups() : []; } catch (e) { gs = []; }
    gs.filter(x => x.self).forEach(x => add(x.g, false));
    const rest = [];
    stored().forEach(e => Object.keys(resOf(e)).concat(Array.isArray(e.targets) ? e.targets : []).forEach(k => rest.push(colKey(k))));
    rest.filter(g => SELF_EXTRA.indexOf(g) >= 0).forEach(g => add(g, false));
    gs.filter(x => !x.self).forEach(x => add(x.g, true));
    learnEvents().forEach(e => e.learn.groups.forEach(x => add(x.g, !x.self)));
    rest.forEach(g => add(g, SELF_EXTRA.indexOf(g) < 0 && !gs.some(x => x.self && x.g === g)));
    return out.length ? out : DEF_DEPTS.map(d => ({ id: colKey(d.id), label: colKey(d.id), vendor: !!d.vendor })).filter((d, i, a) => a.findIndex(x => x.id === d.id) === i);
  }
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const uid = () => "dv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let fixedToday = "";
  const todayISO = () => fixedToday || (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const FILE_MAX = 50 * 1024 * 1024;

  /* 대상 파트 — e.targets, 비어 있으면 결과가 있는 파트 */
  const resOf = (e) => (e && e.res && typeof e.res === "object" ? e.res : {});
  /* 칸 이름으로 모은 결과 — 옛 '수입' · '통과' 는 수입통과파트 한 칸으로(날짜는 늦은 쪽, 파일은 합침) */
  function resN(e) {
    const out = {};
    Object.keys(resOf(e)).forEach(k => {
      const r = resOf(e)[k], c = colKey(k);
      if (!r || typeof r !== "object") return;
      const o = out[c] || (out[c] = { date: "", files: [], note: "", ok: false });
      if (isISO(r.date) && r.date > o.date) o.date = r.date;
      o.files = o.files.concat(Array.isArray(r.files) ? r.files : []);
      if (r.note) o.note = o.note ? o.note + " · " + r.note : r.note;
      if (r.ok) o.ok = true;
    });
    return out;
  }
  const lg = (e, d) => (e.learn ? e.learn.groups.find(x => x.g === colKey(d)) : null);
  const done = (e, d) => {
    if (e && e.learn) { const x = lg(e, d); return !!(x && x.n > 0 && x.ok >= x.n); }
    const r = resN(e)[colKey(d)]; return !!(r && (isISO(r.date) || r.files.length || r.ok));
  };
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  const targets = (e) => (e && e.learn ? e.learn.groups.filter(x => x.n > 0).map(x => x.g)
    : uniq((Array.isArray(e.targets) && e.targets.length ? e.targets : Object.keys(resOf(e))).map(colKey)));
  function cover(e) { const ts = targets(e); const n = ts.filter(d => done(e, d)).length; return { n, of: ts.length }; }

  let yearF = "", kindF = "", q = "";
  const kindList = () => KINDS.concat(uniq(learnEvents().map(e => e.kind)).sort());
  const years = () => Array.from(new Set(events().map(e => String(e.date || "").slice(0, 4)).filter(y => /^\d{4}$/.test(y)))).sort().reverse();
  const hay = (e) => [e.title, e.kind, e.src, e.note].join(" ").toLowerCase();
  function rows() {
    return events().filter(e => (!yearF || String(e.date || "").slice(0, 4) === yearF) && (!kindF || e.kind === kindF) && (!q || hay(e).indexOf(q.toLowerCase()) >= 0))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }
  const firstFile = (e, d) => { const r = resN(e)[d]; return r && (r.files || [])[0]; };
  function cell(e, d) {
    if (e.learn) {   // 서명 수 / 대상 수
      const x = lg(e, d);
      if (!x || !x.n) return `<td class="dv-c"><span class="dv-x" aria-label="대상 아님">·</span></td>`;
      const ok = x.ok >= x.n;
      return `<td class="dv-c ${ok ? "is-done" : "is-miss"}"><span class="${ok ? "dv-ok" : "dv-x dv-part"}" title="${esc(x.g + " 서명 " + x.ok + "/" + x.n + (x.last ? " · 최근 " + dot(x.last) : ""))}">${ok ? icon("check", 14) : ""}<span class="mono">${x.ok}/${x.n}</span></span></td>`;
    }
    const r = resN(e)[d];
    const tgt = targets(e).indexOf(d) >= 0;
    if (!r || !done(e, d)) return `<td class="dv-c${tgt ? " is-miss" : ""}"><span class="dv-x" aria-label="${tgt ? "미실시" : "대상 아님"}">${tgt ? "미실시" : "·"}</span></td>`;
    const f = firstFile(e, d);
    const tip = [dot(r.date), r.note].filter(Boolean).join(" · ");
    return `<td class="dv-c is-done">${f ? `<a class="nb-file dv-ok" href="${esc(f.url)}" target="_blank" rel="noopener" data-name="${esc(f.name)}" title="${esc(tip)}">${icon("check", 14)}<span class="mono">${esc(r.date ? dot(r.date).slice(3) : "")}</span></a>`
      : `<span class="dv-ok" title="${esc(tip)}">${icon("check", 14)}<span class="mono">${esc(r.date ? dot(r.date).slice(3) : "")}</span></span>`}</td>`;
  }
  function matrixHTML() {
    const rs = rows();
    const ds = depts();
    const ys = years();
    const mob = SeMIS.isMobile && SeMIS.isMobile();
    const tools = `<div class="toolbar">${ui.search("dv-q", "제목 · 근거 검색", q)}
        ${ys.length > 1 ? `<div class="seg" role="group" aria-label="연도">${[["", "전체"]].concat(ys.map(v => [v, v])).map(([v, lb]) => `<button type="button" class="seg-btn" data-dvy="${esc(v)}" aria-pressed="${v === yearF}">${esc(lb)}</button>`).join("")}</div>` : ""}
        <label class="ck-f"><span class="m-hide">구분</span><select id="dv-kind" aria-label="구분"><option value="">전체</option>${kindList().map(k => `<option ${k === kindF ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label></div>`;
    if (!rs.length) return tools + `<div id="dv-list">${ui.empty(q || kindF || yearF ? "조건에 맞는 전파교육이 없습니다." : "등록된 전파교육이 없습니다.")}</div>`;
    if (mob) return tools + `<div id="dv-list" class="dv-cards">${rs.map(e => { const cv = cover(e); return `<article class="dv-card" data-dv="${esc(e.id)}">
        <div class="dv-ch"><span class="mono">${esc(dot(e.date))}</span>${e.kind ? ui.chip(e.kind, e.learn ? "blue" : "gray") : ""}<span class="spacer"></span><b class="mono">${cv.of ? cv.n + "/" + cv.of : "-"}</b></div>
        <div class="dv-t">${esc(e.title)}</div>
        <div class="dv-dchips">${ds.filter(d => targets(e).indexOf(d.id) >= 0).map(d => `<span class="dv-d${done(e, d.id) ? " on" : ""}">${esc(d.label)}${e.learn && lg(e, d.id) ? ` <span class="mono">${lg(e, d.id).ok}/${lg(e, d.id).n}</span>` : ""}</span>`).join("")}</div></article>`; }).join("")}</div>`;
    return tools + `<div id="dv-list"><div class="table-wrap"><table class="tbl dv-tbl tbl-keep">
      <thead><tr><th>일자</th><th>전파 내용</th>${ds.map(d => `<th class="dv-dh${d.vendor ? " is-v" : ""}">${esc(d.label)}</th>`).join("")}<th>이행</th></tr></thead>
      <tbody>${rs.map(e => { const cv = cover(e); return `<tr data-dv="${esc(e.id)}" class="is-click">
        <td class="mono">${esc(dot(e.date) || "-")}</td>
        <td class="dv-tt"><b>${esc(e.title)}</b><div class="cell-sub">${esc([e.kind, e.src].filter(Boolean).join(" · "))}</div></td>
        ${ds.map(d => cell(e, d.id)).join("")}
        <td class="mono">${cv.of ? `<b>${cv.n}</b>/${cv.of}` : "-"}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="pn-note">${icon("check", 13)} 실시(누르면 결과 기록 보기) · 미실시 = 대상 파트에 결과 없음 · · = 대상 아님 · <span class="mono">7/13</span> = 교육 전파 · 서명으로 받은 서명 수 / 대상 수(자동)</p></div>`;
  }

  const fileChips = (files, del) => (files || []).map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>${del ? `<button type="button" class="mt-btn danger" data-${del}="${i}" aria-label="첨부 삭제">${icon("x", 14)}</button>` : ""}</span>`).join("");
  function view(id) {
    const e = events().find(x => x.id === id);
    if (!e) return;
    if (e.learn) { if (LN() && LN().open) { SeMIS.navigate("learn"); LN().open(e.learn.id); } return; }
    const canW = SeMIS.canEdit();
    const ds = depts().filter(d => targets(e).indexOf(d.id) >= 0 || resN(e)[d.id]);
    openModal(`<h3>${esc(e.title)}</h3>
      <dl class="pn-dl">
        <div><dt>통보 · 전파일</dt><dd class="mono">${esc(dot(e.date) || "-")}</dd></div>
        ${e.kind ? `<div><dt>구분</dt><dd>${esc(e.kind)}</dd></div>` : ""}
        ${e.src ? `<div><dt>근거 · 발신</dt><dd>${esc(e.src)}</dd></div>` : ""}
        ${e.note ? `<div><dt>비고</dt><dd>${esc(e.note)}</dd></div>` : ""}
        ${e.chk ? `<div><dt>확인 필요</dt><dd>${esc(e.chk)}</dd></div>` : ""}
      </dl>
      ${(e.notice || []).length ? `<div class="form-row"><label>통보 원문</label><div class="au-files nb-files-view">${fileChips(e.notice)}</div></div>` : ""}
      <div class="form-row"><label>파트별 결과</label><ul class="dv-res">${ds.map(d => { const r = resN(e)[d.id] || {}; return `<li><b>${esc(d.label)}</b>${done(e, d.id) ? ui.chip("실시" + (r.date ? " " + dot(r.date) : ""), "green") : ui.chip("미실시", "red")}
        <span class="au-files nb-files-view">${fileChips(r.files)}</span>${r.note ? `<small class="cell-sub">${esc(r.note)}</small>` : ""}</li>`; }).join("")}</ul></div>
      ${(e.docs || []).length ? `<div class="form-row"><label>회람지 · 자료</label><div class="au-files nb-files-view">${fileChips(e.docs)}</div></div>` : ""}
      <div class="modal-actions">${canW ? '<button type="button" class="link-btn" data-act="edit">수정</button><span class="spacer" style="flex:1"></span>' : ""}<button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const ed = $("#modal-box [data-act=edit]"); if (ed) ed.onclick = () => form(id);
  }
  async function uploadInto(files, fl, done2) {
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of Array.from(fl || [])) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("업로드 중: " + file.name);
      try { const up = await SemisSync.uploadFile(file, "dissem"); files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url }); }
      catch (err) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done2) done2();
  }
  function form(id) {
    if (!SeMIS.canEdit()) return;
    const e = id ? stored().find(x => x.id === id) : null;
    const v = Object.assign({ date: todayISO(), title: "", kind: "", src: "", note: "", chk: "" }, e || {});
    const notice = (v.notice || []).map(f => Object.assign({}, f));
    const res = JSON.parse(JSON.stringify(resN(v)));   // 칸 이름 기준 — 저장하면 옛 칸 id 가 지금 이름으로 바뀐다
    const tg = new Set(targets(v).length ? targets(v) : depts().map(d => d.id));
    const ds = depts();
    openModal(`<h3>${e ? "전파교육 수정" : "전파교육 등록"}</h3>
      <div class="form-row"><label for="df-title">전파 내용</label><input id="df-title" value="${esc(v.title)}" maxlength="160" autocomplete="off"></div>
      <div class="form-grid"><div class="form-row"><label for="df-date">통보 · 전파일</label><input id="df-date" type="date" value="${esc(isISO(v.date) ? v.date : "")}"></div>
        <div class="form-row"><label for="df-kind">구분</label><select id="df-kind"><option value="">-</option>${KINDS.map(k => `<option ${k === v.kind ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></div></div>
      <div class="form-row"><label for="df-src">근거 · 발신</label><input id="df-src" value="${esc(v.src)}" maxlength="120" autocomplete="off" placeholder="예: TA 통보서 · 국토부 공문"></div>
      <div class="form-row"><label>통보 원문</label><div class="au-files au-files-edit" id="df-nfiles"></div><input type="file" id="df-nfile" multiple hidden>
        <button type="button" class="btn btn-ghost btn-sm" id="df-nbtn">${icon("link", 15)}<span>파일 첨부</span></button></div>
      <div class="form-row"><label>파트별 결과 ${ui.tip("대상 파트를 선택하고, 실시한 파트에 실시일과 결과 파일(회람지 · 교육일지)을 넣습니다.", "파트별 결과 설명")}</label>
        <div class="dv-fres">${ds.map(d => { const r = res[d.id] || {}; return `<div class="dv-fr" data-dfr="${esc(d.id)}">
          <label class="dv-ft"><input type="checkbox" data-dft ${tg.has(d.id) ? "checked" : ""}> ${esc(d.label)}</label>
          <input type="date" data-dfd value="${esc(isISO(r.date) ? r.date : "")}" aria-label="${esc(d.label)} 실시일">
          <span class="au-files au-files-edit" data-dff></span><input type="file" data-dfi multiple hidden>
          <button type="button" class="link-btn" data-dfb>${icon("link", 13)}<span>파일</span></button></div>`; }).join("")}</div></div>
      <div class="form-row"><label for="df-note">비고</label><input id="df-note" value="${esc(v.note)}" maxlength="200" autocomplete="off"></div>
      <div class="modal-actions">${e ? '<button type="button" class="link-btn danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    const paintN = () => { $("#df-nfiles").innerHTML = fileChips(notice, "dfn"); $$("[data-dfn]").forEach(b => b.onclick = () => { notice.splice(Number(b.dataset.dfn), 1); paintN(); }); };
    paintN();
    $("#df-nbtn").onclick = () => $("#df-nfile").click();
    $("#df-nfile").onchange = () => { const fl = Array.from($("#df-nfile").files || []); $("#df-nfile").value = ""; uploadInto(notice, fl, paintN); };
    $$("#modal-box [data-dfr]").forEach(row => {
      const d = row.dataset.dfr;
      if (!res[d]) res[d] = { files: [] };
      if (!Array.isArray(res[d].files)) res[d].files = [];
      const box = $("[data-dff]", row), inp = $("[data-dfi]", row);
      const pf = () => { box.innerHTML = fileChips(res[d].files, "dfx"); $$("[data-dfx]", box).forEach(b => b.onclick = () => { res[d].files.splice(Number(b.dataset.dfx), 1); pf(); }); };
      pf();
      $("[data-dfb]", row).onclick = () => inp.click();
      inp.onchange = () => { const fl = Array.from(inp.files || []); inp.value = ""; uploadInto(res[d].files, fl, pf); };
    });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal("이 전파교육 기록을 지울까요?", () => { V().events = stored().filter(x => x !== e); SeMIS.save(); SeMIS.renderView(); });
    $("#modal-box [data-act=ok]").onclick = () => {
      const title = norm($("#df-title").value);
      if (!title) { toast("전파 내용을 입력하세요.", true); $("#df-title").focus(); return; }
      const targetsSel = [], out = {};
      $$("#modal-box [data-dfr]").forEach(row => {
        const d = row.dataset.dfr;
        if ($("[data-dft]", row).checked) targetsSel.push(d);
        const date = $("[data-dfd]", row).value || "";
        const files = (res[d] && res[d].files) || [];
        if (isISO(date) || files.length) out[d] = Object.assign({}, res[d], { date, files });
      });
      const rec = { date: $("#df-date").value || "", title, kind: $("#df-kind").value, src: norm($("#df-src").value), note: norm($("#df-note").value),
        notice: notice.slice(), res: out, targets: targetsSel };
      const vv = V();
      if (!Array.isArray(vv.events)) vv.events = [];
      if (e) Object.assign(e, rec); else vv.events.push(Object.assign({ id: uid(), docs: [] }, rec));
      D().dissem = vv;
      SeMIS.save(); closeModal(); toast("저장했습니다."); SeMIS.renderView();
    };
  }

  function stats() {
    const t = todayISO();
    const all = events();
    const recent = all.filter(e => isISO(e.date) && dayDiff(e.date, t) <= 365);
    let n = 0, of = 0, vn = 0, vof = 0;
    const vend = depts().filter(d => d.vendor).map(d => d.id);
    recent.forEach(e => { targets(e).forEach(d => { of++; if (done(e, d)) n++; if (vend.indexOf(d) >= 0) { vof++; if (done(e, d)) vn++; } }); });
    const last = all.map(e => e.date).filter(isISO).sort().pop() || "";
    return { all: all.length, recent: recent.length, n, of, vn, vof, last, rate: of ? Math.round(n / of * 100) : null };
  }
  function wire(root) {
    $$("[data-dv]", root).forEach(el => el.onclick = (ev) => { if (ev.target.closest("a")) return; view(el.dataset.dv); });
    $$("[data-dvy]", root).forEach(b => b.onclick = () => { yearF = b.dataset.dvy; SeMIS.renderView(); });
    const ks = $("#dv-kind", root); if (ks) ks.onchange = () => { kindF = ks.value; SeMIS.renderView(); };
    const qi = $("#dv-q", root);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const host = qi.closest(".card");
      if (host) { ui.repaintKeep(host, matrixHTML(), qi); wire(host); }
    };
  }
  function render(root) {
    const canW = SeMIS.canEdit();
    const t = stats();
    root.innerHTML = ui.head({ title: TITLE, meta: t.all ? "전체 " + t.all + "건" : "", actions: canW ? `<button type="button" class="btn btn-primary btn-sm" id="dv-add">${icon("plus", 16)}<span>전파교육 등록</span></button>` : "" })
      + ui.stats([
        { label: "최근 1년 전파", value: t.recent, sub: t.last ? "최근 " + dot(t.last) : "" },
        { label: "파트 이행률", value: t.rate == null ? "-" : t.rate + "%", sub: t.of ? t.n + "/" + t.of : "", tone: t.rate != null && t.rate < 90 ? "warn" : "ok" },
        { label: "협력사 · 조업사 전파", value: t.vof ? t.vn + "/" + t.vof : "-", tone: t.vof && t.vn < t.vof ? "warn" : "ok" }
      ])
      + `<p class="pn-note dv-auto">${icon("info", 14)} <b>교육 전파 · 서명</b>으로 서명을 받은 교육(보안 · 안전 · 위험물)은 등록하지 않아도 이 표에 자동으로 들어옵니다. [전파교육 등록]은 종이 회람처럼 서명 기능을 쓰지 않은 전파에만 씁니다.</p>`
      + `<section class="card" id="dv-card">${matrixHTML()}</section>`;
    const ad = $("#dv-add", root); if (ad) ad.onclick = () => form("");
    wire(root);
    /* 서명 현황을 받아 오면 한 번 다시 그린다 */
    if (LN() && LN().loadStats) { try { LN().loadStats().then(ch => { if (ch && root.isConnected && $("#dv-card", root)) SeMIS.renderView(); }).catch(() => {}); } catch (e) { /* 없음 */ } }
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "megaphone", module: MOD,
    items: () => events().map(e => ({ title: e.title, sub: [dot(e.date), e.kind].filter(Boolean).join(" · "), text: [e.title, e.kind, e.src], route: MOD, pick: () => { q = ""; yearF = ""; kindF = ""; } }))
  });

  function evidence(mid) {
    const s = stats();
    const has = (re) => events().filter(e => re.test([e.kind, e.title].join(" ")) && isISO(e.date) && dayDiff(e.date, todayISO()) <= 730);
    if (mid === "2.2" || mid === "2.2.1") { const r = has(/보안등급|경보|NTAS/); return r.length ? { ok: true, text: "보안등급 전파 " + r.length + "건 (2년)" } : { ok: false, text: "보안등급 전파 기록 없음" }; }
    if (mid === "2.6" || mid === "2.9") { const r = has(/보고체계|보고 절차|보고절차|연락처/); return r.length ? { ok: true, text: "보고체계 전파 " + r.length + "건 (2년)" } : { ok: false, text: "보고체계 전파 기록 없음" }; }
    if (!s.recent) return { ok: false, text: "1년 안 전파 기록 없음" };
    return { ok: (s.rate || 0) >= 80 && (!s.vof || s.vn > 0), text: `1년 ${s.recent}건 · 이행 ${s.rate}% · 협력사 ${s.vn}/${s.vof}` };
  }
  window.SemisEvidence = window.SemisEvidence || {};
  window.SemisEvidence[MOD] = evidence;
  window.SemisDissem = { DEF_DEPTS, KINDS, ALIAS, depts, events, learnEvents, resN, stats, cover, targets, done, evidence, setToday(x) { fixedToday = isISO(x) ? x : ""; }, setState(o) { o = o || {}; if (o.yearF !== undefined) yearF = o.yearF; if (o.kindF !== undefined) kindF = o.kindF; if (o.q !== undefined) q = o.q; } };
})();
