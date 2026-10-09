/* 증빙 문서 서가 — 화면마다 붙는 '관련 문서' 묶음. 같은 문서의 여러 판(ser)은 최신 판만 보이고 이전 판은 접는다.
   원본은 비공개 버킷(docs/ · 민감보안정보는 docs-ssi/ — hq 이상 열람). 문서 · 판 이름은 공용 DB 에만.
   SeMIS.data.docs = [{ id, mod, grp, title, date, ser, org, note, ssi, mids[], files[{name,size,url}], src, at, by }]
   사용: define(mod, [{ id, label }]) → card(mod) / shelf(mod, grp) → wire(box) */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const all = () => (Array.isArray(D().docs) ? D().docs : []);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const uid = () => "dk" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const me = () => { const u = SeMIS.user; return u ? u.name || u.id || "" : ""; };
  const FILE_MAX = 50 * 1024 * 1024;
  const GROUPS = {};          // mod → [{ id, label }]
  const open = {};            // 펼친 이전 판 (ser 키)

  function define(mod, groups) { GROUPS[mod] = (groups || []).map(g => ({ id: String(g.id), label: String(g.label || g.id) })); }
  const groupsOf = (mod) => GROUPS[mod] || [];
  const labelOf = (mod, grp) => { const g = groupsOf(mod).find(x => x.id === grp); return g ? g.label : grp || "기타"; };
  const byDate = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title || "").localeCompare(String(b.title || ""), "ko");
  const serOf = (d) => d.ser || d.id;

  function list(mod, grp) {
    return all().filter(d => d && d.mod === mod && (!grp || d.grp === grp)).sort(byDate);
  }
  /* 판 묶음 — [{ cur, old[] }] 최신 판이 앞, 묶음은 최신 판 날짜 순 */
  function series(mod, grp) {
    const m = new Map();
    list(mod, grp).forEach(d => { const k = serOf(d); if (!m.has(k)) m.set(k, []); m.get(k).push(d); });
    return Array.from(m.values()).map(v => ({ cur: v[0], old: v.slice(1) }));
  }
  function latest(mod, grp) { return list(mod, grp)[0] || null; }
  /* 체크리스트 항목 번호로 찾기 — 판 묶음마다 최신 판만 */
  const midsOf = (d) => (Array.isArray(d.mids) ? d.mids.map(String) : []);
  function forMid(mid) {
    const m = String(mid || "");
    if (!m) return [];
    const seen = new Set();
    return all().filter(d => d && midsOf(d).indexOf(m) >= 0 && (d.files || []).length).sort(byDate)
      .filter(d => { const k = d.mod + "|" + serOf(d); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  const daysAgo = (iso) => { if (!isISO(iso)) return Infinity; return Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 864e5); };
  /* 증빙 판단 — 묶음에 문서가 있고(days 를 주면 그 기간 안) 파일이 붙어 있으면 ok */
  function evid(mod, grps, days) {
    const gs = Array.isArray(grps) ? grps : [grps];
    const hit = all().filter(d => d && d.mod === mod && (!grps || gs.indexOf(d.grp) >= 0) && (d.files || []).length).sort(byDate);
    if (!hit.length) return { ok: false, text: "문서 없음" };
    const top = hit[0];
    if (days && daysAgo(top.date) > days) return { ok: false, text: "최근 " + dot(top.date) + " (기간 경과)" };
    return { ok: true, text: "문서 " + hit.length + "건 · 최근 " + (dot(top.date) || "-") };
  }

  const ext = (f) => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String((f && f.name) || "")); return m ? m[1].toUpperCase() : "FILE"; };
  function fileLink(f, label, cls) {
    return `<a class="nb-file ${cls || ""}" href="${esc(f.url)}" target="_blank" rel="noopener" data-name="${esc(f.name || "")}">${esc(label || f.name || "첨부")}</a>`;
  }
  function rowHTML(d, canW, sub) {
    const locked = !!d.ssi && SeMIS.roleRank() < 3;          // 민감보안정보 원본은 안전보안파트 이상
    const files = locked ? [] : (d.files || []);
    const f0 = files[0];
    const meta = [dot(d.date), d.org, d.note].filter(Boolean).map(esc).join('<span class="dk-sep">·</span>');
    return `<li class="dk-row${sub ? " is-old" : ""}" data-dk="${esc(d.id)}">
      <span class="dk-ext mono" aria-hidden="true">${esc(f0 ? ext(f0) : "—")}</span>
      <div class="dk-main">
        <div class="dk-t">${f0 ? fileLink(f0, d.title) : `<span>${esc(d.title)}</span>`}${d.ssi ? ' <span class="dk-ssi" title="민감보안정보">SSI</span>' : ""}</div>
        ${meta ? `<div class="dk-meta">${meta}</div>` : ""}
        ${files.length > 1 ? `<div class="dk-more">${files.slice(1).map(f => fileLink(f, f.name, "dk-f")).join("")}</div>` : ""}
      </div>
      ${canW ? `<button type="button" class="mt-btn dk-edit m-ed" data-dk-edit="${esc(d.id)}" aria-label="문서 수정">${icon("notes", 15)}</button>` : ""}
    </li>`;
  }
  function seriesHTML(s, canW) {
    const k = serOf(s.cur);
    const on = !!open[k];
    return rowHTML(s.cur, canW, false).replace(/<\/li>\s*$/, "")
      + (s.old.length ? `<button type="button" class="link-btn dk-old-btn" data-dk-old="${esc(k)}" aria-expanded="${on}">이전 판 ${s.old.length}</button>` : "")
      + `</li>` + (s.old.length && on ? `<li class="dk-olds"><ul>${s.old.map(d => rowHTML(d, canW, true)).join("")}</ul></li>` : "");
  }
  function shelf(mod, grp, opts) {
    opts = opts || {};
    const canW = opts.canEdit === undefined ? SeMIS.canEdit() : !!opts.canEdit;
    const ss = series(mod, grp);
    if (!ss.length && !canW) return opts.emptyText === null ? "" : `<p class="dk-empty">${esc(opts.emptyText || "등록된 문서가 없습니다.")}</p>`;
    if (!ss.length) return opts.emptyText === null ? "" : `<p class="dk-empty">${esc(opts.emptyText || "등록된 문서가 없습니다.")}</p>`;
    return `<ul class="dk-list" data-dk-mod="${esc(mod)}" data-dk-grp="${esc(grp || "")}">${ss.map(s => seriesHTML(s, canW)).join("")}</ul>`;
  }
  /* 문서 추가 — 화면마다 한 곳(묶음은 등록 창에서 고른다) */
  const addBtn = (mod, grp) => `<button type="button" class="link-btn dk-add m-ed" data-dk-add="${esc(mod)}|${esc(grp || "")}">${icon("plus", 14)}<span>문서 추가</span></button>`;
  /* 화면 전체 묶음 — 정의된 묶음 순서대로(정의 밖 묶음은 뒤에) */
  function groupsHTML(mod, opts) {
    opts = opts || {};
    const canW = opts.canEdit === undefined ? SeMIS.canEdit() : !!opts.canEdit;
    const have = Array.from(new Set(list(mod).map(d => d.grp || "")));
    const defs = groupsOf(mod).filter(g => !opts.only || opts.only.indexOf(g.id) >= 0);
    const ids = defs.map(g => g.id).concat(opts.only ? [] : have.filter(g => !defs.some(x => x.id === g)));
    const shown = ids.filter(g => list(mod, g).length);
    const top = canW && !opts.noAdd ? `<div class="dk-top">${addBtn(mod, opts.only && opts.only.length === 1 ? opts.only[0] : "")}</div>` : "";
    if (!shown.length) return top + ui.empty("등록된 문서가 없습니다.");
    return top + `<div class="dk-grps">${shown.map(g => {
      const n = list(mod, g).length;
      return `<div class="dk-grp"><div class="dk-gh"><h4>${esc(labelOf(mod, g))}</h4><span class="dk-n mono">${n}</span></div>${shelf(mod, g, { canEdit: canW, emptyText: "문서 없음" })}</div>`;
    }).join("")}</div>`;
  }
  function card(mod, opts) {
    opts = opts || {};
    const canW = opts.canEdit === undefined ? SeMIS.canEdit() : !!opts.canEdit;
    const body = groupsHTML(mod, Object.assign({}, opts, { noAdd: true }));
    return `<section class="card dk-card" data-dk-card="${esc(mod)}"><div class="card-title">${icon("folder", 18)}<span>${esc(opts.title || "관련 문서")}</span>${canW ? `<span class="spacer"></span>${addBtn(mod, "")}` : ""}</div>${body}</section>`;
  }

  let onChange = null;
  function wire(box, after) {
    if (!box) return;
    onChange = after || onChange;
    $$("[data-dk-old]", box).forEach(b => b.onclick = () => { const k = b.dataset.dkOld; open[k] = !open[k]; repaint(); });
    $$("[data-dk-edit]", box).forEach(b => b.onclick = () => form(b.dataset.dkEdit));
    $$("[data-dk-add]", box).forEach(b => b.onclick = () => { const [m, g] = b.dataset.dkAdd.split("|"); form("", { mod: m, grp: g }); });
  }
  function repaint() {
    if (typeof onChange === "function") { try { onChange(); return; } catch (e) { /* 실패 시 화면 전체 다시 그리기 */ } }
    if (SeMIS.renderView) SeMIS.renderView();
  }

  async function uploadInto(files, fileList, ssi, done) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of arr) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("업로드 중: " + file.name);
      try {
        const up = await SemisSync.uploadFile(file, ssi ? "docs-ssi" : "docs");
        files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url });
      } catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }

  function form(id, preset) {
    if (!SeMIS.canEdit()) return;
    const d = id ? all().find(x => x && x.id === id) : null;
    if (id && !d) return;
    const v = Object.assign({ mod: "", grp: "", title: "", date: new Date().toISOString().slice(0, 10), ser: "", org: "", note: "", ssi: false, files: [] }, preset || {}, d || {});
    const files = (v.files || []).map(f => Object.assign({}, f));
    const gs = groupsOf(v.mod);
    const sers = Array.from(new Set(list(v.mod).filter(x => x.ser).map(x => x.ser)));
    const chips = () => files.map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name)}</span></a><button type="button" class="mt-btn danger" data-dkf="${i}" aria-label="첨부 삭제">${icon("x", 14)}</button></span>`).join("");
    openModal(`<h3>${d ? "문서 수정" : "문서 추가"}</h3>
      <div class="form-row"><label for="dk-title">문서 이름</label><input id="dk-title" value="${esc(v.title)}" maxlength="160" autocomplete="off"></div>
      <div class="form-grid">
        <div class="form-row"><label for="dk-grp">묶음</label><select id="dk-grp">${(gs.length ? gs : [{ id: v.grp, label: labelOf(v.mod, v.grp) }]).map(g => `<option value="${esc(g.id)}" ${g.id === v.grp ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></div>
        <div class="form-row"><label for="dk-date">문서 날짜</label><input id="dk-date" type="date" value="${esc(isISO(v.date) ? v.date : "")}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="dk-org">기관 · 업체</label><input id="dk-org" value="${esc(v.org)}" maxlength="60" autocomplete="off"></div>
        <div class="form-row"><label for="dk-ser">판 묶음 ${ui.tip("같은 문서의 개정판 · 연도별 판을 한 줄로 묶는 이름입니다. 같은 이름의 문서는 최신 판만 보이고 나머지는 '이전 판'으로 접힙니다.", "판 묶음 설명")}</label>
          <input id="dk-ser" value="${esc(v.ser)}" maxlength="60" autocomplete="off" list="dk-sers"><datalist id="dk-sers">${sers.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="dk-note">비고</label><input id="dk-note" value="${esc(v.note)}" maxlength="200" autocomplete="off"></div>
        <div class="form-row"><label for="dk-mids">체크리스트 번호 ${ui.tip("수검 대응 센터 점검 체크리스트에서 이 문서를 증빙으로 보여 줄 항목 번호입니다. 쉼표로 여러 개.", "체크리스트 번호 설명")}</label><input id="dk-mids" value="${esc(midsOf(v).join(", "))}" maxlength="80" autocomplete="off" placeholder="예: 2.7, 4.2"></div>
      </div>
      <label class="au-opt"><input type="checkbox" id="dk-ssi" ${v.ssi ? "checked" : ""}> 민감보안정보 (안전보안파트 이상 열람)</label>
      <div class="form-row"><label>파일</label><div class="au-files au-files-edit" id="dk-files">${chips()}</div>
        <input type="file" id="dk-file" multiple hidden>
        <button type="button" class="btn btn-ghost btn-sm" id="dk-fbtn">${icon("link", 15)}<span>파일 첨부</span></button></div>
      <div class="modal-actions">
        ${d ? '<button type="button" class="link-btn danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`, { wide: true });
    const paint = () => {
      const box = $("#dk-files");
      if (!box) return;
      box.innerHTML = chips();
      $$("[data-dkf]", box).forEach(b => b.onclick = () => { files.splice(Number(b.dataset.dkf), 1); paint(); });
    };
    paint();
    $("#dk-fbtn").onclick = () => $("#dk-file").click();
    $("#dk-file").onchange = () => { const fl = Array.from($("#dk-file").files || []); $("#dk-file").value = ""; uploadInto(files, fl, $("#dk-ssi").checked, paint); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal("이 문서를 목록에서 삭제할까요? (원본 파일은 저장소에 남습니다)", () => {
      D().docs = all().filter(x => x !== d);
      SeMIS.save(); toast("삭제했습니다."); repaint();
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const title = norm($("#dk-title").value);
      if (!title) { toast("문서 이름을 입력하세요.", true); $("#dk-title").focus(); return; }
      const rec = { mod: v.mod, grp: $("#dk-grp").value, title, date: $("#dk-date").value || "", ser: norm($("#dk-ser").value),
        org: norm($("#dk-org").value), note: norm($("#dk-note").value), ssi: !!$("#dk-ssi").checked, files: files.slice(), at: new Date().toISOString(), by: me(),
        mids: String($("#dk-mids").value || "").split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d+(\.\d+)*$/.test(x)) };
      if (!Array.isArray(D().docs)) D().docs = [];
      if (d) Object.assign(d, rec); else D().docs.push(Object.assign({ id: uid() }, rec));
      SeMIS.save(); closeModal(); toast("저장했습니다."); repaint();
    };
  }

  const modVisible = (mod) => {
    const mn = SeMIS.menuForModule ? SeMIS.menuForModule(mod) : null;
    if (!mn || !(SeMIS.hasModule && SeMIS.hasModule(mod))) return false;
    return SeMIS.navVisible ? SeMIS.navVisible(mn) : SeMIS.canSee(mn);
  };
  /* 이 파일은 search.js 보다 먼저 읽히므로(화면이 묶음을 먼저 정의하도록) 준비되면 검색에 등록 */
  (function regSearch(n) {
    if (!window.SemisSearch) { if (n < 200) setTimeout(() => regSearch(n + 1), 0); return; }
    SemisSearch.register({
    id: "docs", group: "관련 문서", ico: "folder", minRank: 2,
    items: () => all().filter(d => d && d.mod && modVisible(d.mod) && (!d.ssi || SeMIS.roleRank() >= 3)).map(d => ({
      title: d.title, sub: [labelOf(d.mod, d.grp), dot(d.date), d.org].filter(Boolean).join(" · "),
      text: [d.title, d.org, d.note].join(" "), route: d.mod }))
    });
  })(0);

  window.SemisDocs = { define, groupsOf, labelOf, list, series, latest, forMid, midsOf, evid, shelf, groupsHTML, card, wire, form, daysAgo };
})();
