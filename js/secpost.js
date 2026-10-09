/* 경비대원 배치도(화물보안 대시보드의 한 칸) — 도면 + 지점 데이터로 그린다. hq는 편집.
   민감보안정보: 도면 · 지점 위치 · 이름은 공용 DB에만(권한표 읽기 2 · 쓰기 3). 이 파일(공개 저장소)에는 유형 · 색 · 화면 동작만 둔다.
   DATA.secPost    = { title, asOf, note, points[{ id, label, kind, x, y(도면 %), lp(이름표 b|t|l|r), cr(카드리더), dmd(문형 금속탐지기), note }], updatedAt, updatedBy }
   DATA.secPostImg = { img(WebP data URL), w, h, name, updatedAt, updatedBy } — 도면은 거의 안 바뀌어 따로 둔다(변경 이력 크기) */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const KEY = "secPost", IKEY = "secPostImg", ROUTE = "sec-dash";
  /* 유형 — 원본 배치도 범례 4종. 색은 CVD 검증(인접 ΔE ≥ 8) 통과값이고, 지점 이름이 늘 함께 보인다 */
  const KINDS = [
    { k: "person", label: "인원 출입 전용", full: "인원 출입 전용 통로", color: "#0f9fb5" },
    { k: "cargo", label: "화물 · 차량 전용", full: "화물 · 작업용 차량 출입 전용 통로", color: "#2a4fd0" },
    { k: "shared", label: "공동 이용", full: "인원 · 화물 · 작업용 차량 공동 이용 통로", color: "#e0a000" },
    { k: "land", label: "Land 통합", full: "Land 통합 · 주기장 및 화물기 경비", color: "#2c8a3e" }
  ];
  const KIND = {};
  KINDS.forEach(x => { KIND[x.k] = x; });
  const LP = [["b", "아래"], ["t", "위"], ["r", "오른쪽"], ["l", "왼쪽"]];
  const MAX_IMG = 1500000;   // 도면 data URL 최대 길이(약 1.1MB)

  const D = () => SeMIS.data;
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  const post = () => obj(D()[KEY]);
  const pic = () => obj(D()[IKEY]);
  const num = (v) => typeof v === "number" && isFinite(v);
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  const imgOk = (u) => typeof u === "string" && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u);
  const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), "ko", { numeric: true });
  function points(src) {
    const list = Array.isArray((src || post()).points) ? (src || post()).points : [];
    return list.filter(p => p && p.id && KIND[p.kind] && num(p.x) && num(p.y)).slice().sort(byLabel);
  }
  function canRead() { return window.SemisSync && SemisSync.canRead ? SemisSync.canRead(KEY) : SeMIS.roleRank() >= 2; }
  function canEdit() {
    if (!SeMIS.canEdit()) return false;
    return window.SemisSync && SemisSync.canWrite ? SemisSync.canWrite(KEY) : true;
  }
  const hasData = () => points().length > 0 || imgOk(pic().img);
  function stats(src) {
    const ps = points(src);
    const by = {};
    KINDS.forEach(x => { by[x.k] = ps.filter(p => p.kind === x.k).length; });
    return { total: ps.length, by, cr: ps.filter(p => p.cr).length, dmd: ps.filter(p => p.dmd).length };
  }
  const dotDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? String(d).replace(/-/g, ".") : String(d || "");

  /* ── 화면 상태 ── */
  let filter = "", sel = "", pending = "";

  /* ── 조각 ── */
  const sw = (k) => `<i class="gp-sw" style="--c:${esc(KIND[k].color)}" aria-hidden="true"></i>`;
  function pointHTML(p, on) {
    const k = KIND[p.kind];
    const lp = ["b", "t", "l", "r"].indexOf(p.lp) >= 0 ? p.lp : "b";
    return `<button type="button" class="gp-pt${on ? " on" : ""}" data-gp="${esc(p.id)}" data-k="${esc(p.kind)}" data-lp="${lp}"${p.cr ? " data-cr" : ""}
        style="left:${clamp(p.x)}%;top:${clamp(p.y)}%;--c:${esc(k.color)}" aria-label="${esc(p.label + " · " + k.full)}" aria-pressed="${on ? "true" : "false"}">
      <i class="gp-dot" aria-hidden="true"></i><span class="gp-lb">${esc(p.label)}</span></button>`;
  }
  function mapHTML(src, image, opts) {
    opts = opts || {};
    const im = obj(image);
    const w = num(im.w) && im.w > 0 ? im.w : 2344, h = num(im.h) && im.h > 0 ? im.h : 1239;
    const ps = points(src);
    return `<div class="gp-map${opts.edit ? " gp-edit-map" : ""}" data-f="${esc(opts.edit ? "" : filter)}" style="aspect-ratio:${w} / ${h}">
      ${imgOk(im.img) ? `<img class="gp-img" src="${esc(im.img)}" alt="${esc((obj(src).title || "배치도") + " 도면")}" draggable="false">`
        : `<div class="gp-noimg">도면 없음</div>`}
      ${ps.map(p => pointHTML(p, p.id === (opts.edit ? opts.sel : sel))).join("")}
      ${opts.edit ? "" : '<div class="gp-pop" id="gp-pop" role="dialog" aria-live="polite" hidden></div>'}
    </div>`;
  }
  function popHTML(p) {
    const k = KIND[p.kind];
    const fac = [p.cr ? "카드리더" : "", p.dmd ? "문형 금속탐지기" : ""].filter(Boolean);
    return `<div class="gp-pop-h">${sw(p.kind)}<b>${esc(p.label)}</b><span class="spacer"></span>
        <button type="button" class="gp-pop-x" data-gp-close aria-label="닫기">${icon("x", 16)}</button></div>
      <div class="gp-pop-k">${esc(k.full)}</div>
      ${fac.length ? `<div class="gp-pop-f">${fac.map(f => ui.chip(f, "gray")).join("")}</div>` : ""}
      ${p.note ? `<p class="gp-pop-n">${esc(p.note)}</p>` : ""}`;
  }

  /* 대시보드 칸 — 읽을 권한이 없으면 빈 문자열(칸 자체가 빠진다) */
  function cardHTML() {
    if (!canRead()) return "";
    const p = post();
    const title = p.title || "경비대원 배치도";
    const edit = canEdit();
    const head = `<h2 class="card-title">${esc(title)}${p.asOf ? `<span class="dc-meta">기준 ${esc(dotDate(p.asOf))}</span>` : ""}<span class="spacer"></span>
      ${edit && hasData() ? `<button type="button" class="btn btn-ghost btn-sm" id="gp-edit">${icon("edit", 16)}<span>편집</span></button>` : ""}</h2>`;
    if (!hasData()) {
      return `<section class="card gp-card" id="gp-card" aria-label="경비대원 배치도">${head}
        ${ui.empty("등록된 배치도가 없습니다.", edit ? `<button type="button" class="btn btn-primary btn-sm" id="gp-edit">${icon("plus", 16)}<span>배치도 등록</span></button>` : "")}</section>`;
    }
    const s = stats();
    const ps = points();
    return `<section class="card gp-card" id="gp-card" aria-label="${esc(title)}">${head}
      <div class="gp-bar">
        <div class="gp-filter" role="group" aria-label="경비 지점 유형">
          <button type="button" class="gp-f" data-gpk="" aria-pressed="${filter ? "false" : "true"}"><span>전체</span><b class="mono">${s.total}</b></button>
          ${KINDS.map(x => `<button type="button" class="gp-f" data-gpk="${x.k}" aria-pressed="${filter === x.k ? "true" : "false"}" title="${esc(x.full)}">${sw(x.k)}<span>${esc(x.label)}</span><b class="mono">${s.by[x.k]}</b></button>`).join("")}
        </div>
        <span class="gp-fac">카드리더 <b class="mono">${s.cr}</b><i aria-hidden="true">·</i>문형 금속탐지기 <b class="mono">${s.dmd}</b></span>
      </div>
      <div class="gp-scroll" id="gp-scroll">${mapHTML(p, pic())}</div>
      <div class="gp-list" aria-label="유형별 경비 지점">
        ${KINDS.filter(x => s.by[x.k]).map(x => `<div class="gp-lrow" data-k="${x.k}">
          <span class="gp-lk">${sw(x.k)}<span>${esc(x.full)}</span><b class="mono">${s.by[x.k]}</b></span>
          <span class="gp-lpts">${ps.filter(q => q.kind === x.k).map(q => `<button type="button" class="gp-chip${q.id === sel ? " on" : ""}" data-gp="${esc(q.id)}"
            title="${esc([q.label, q.cr ? "카드리더" : "", q.dmd ? "문형 금속탐지기" : "", q.note].filter(Boolean).join(" · "))}">${esc(q.label)}</button>`).join("")}</span>
        </div>`).join("")}
      </div>
      ${p.note ? `<p class="gp-note">${esc(p.note)}</p>` : ""}
    </section>`;
  }

  /* ── 동작 ── */
  function placePop(card) {
    const pop = $("#gp-pop", card);
    if (!pop) return;
    const p = points().find(x => x.id === sel);
    if (!p) { pop.hidden = true; pop.innerHTML = ""; return; }
    pop.innerHTML = popHTML(p);
    pop.hidden = false;
    pop.style.left = clamp(p.x) + "%";
    pop.style.top = clamp(p.y) + "%";
    pop.dataset.v = p.y > 45 ? "up" : "down";
    pop.dataset.h = p.x < 18 ? "left" : p.x > 82 ? "right" : "mid";
    const x = $("[data-gp-close]", pop);
    if (x) x.onclick = (e) => { e.stopPropagation(); select(""); };
  }
  function applyState(card) {
    const map = $(".gp-map", card);
    if (map) map.dataset.f = filter;
    $$(".gp-f", card).forEach(b => b.setAttribute("aria-pressed", (b.dataset.gpk || "") === filter ? "true" : "false"));
    $$(".gp-pt", card).forEach(b => { const on = b.dataset.gp === sel; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    $$(".gp-chip", card).forEach(b => b.classList.toggle("on", b.dataset.gp === sel));
    placePop(card);
  }
  function scrollToPoint(card, id) {
    const box = $("#gp-scroll", card), pt = $('.gp-pt[data-gp="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]', card);
    if (!box || !pt || box.scrollWidth <= box.clientWidth + 2) return;
    const left = pt.offsetLeft - box.clientWidth / 2;
    box.scrollLeft = Math.max(0, left);
  }
  function select(id, opts) {
    sel = sel === id && !(opts && opts.keep) ? "" : (id || "");
    const card = document.getElementById("gp-card");
    if (!card) return;
    if (sel) {
      const p = points().find(x => x.id === sel);
      if (p && filter && p.kind !== filter) filter = "";
    }
    applyState(card);
    if (sel && opts && opts.scroll) scrollToPoint(card, sel);
  }
  let docWired = false;
  function wireDoc() {
    if (docWired || typeof document === "undefined") return;
    docWired = true;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sel && document.getElementById("gp-card")) select(""); });
  }
  function mount(root) {
    const card = $("#gp-card", root || document);
    if (!card) return;
    const ed = $("#gp-edit", card);
    if (ed) ed.onclick = () => editor();
    if (!hasData()) return;
    if (sel && !points().some(p => p.id === sel)) sel = "";
    $$(".gp-f", card).forEach(b => b.onclick = () => {
      const k = b.dataset.gpk || "";
      filter = filter === k ? "" : k;
      const p = sel ? points().find(x => x.id === sel) : null;
      if (p && filter && p.kind !== filter) sel = "";
      applyState(card);
    });
    $$(".gp-pt", card).forEach(b => b.onclick = (e) => { e.stopPropagation(); select(b.dataset.gp); });
    $$(".gp-chip", card).forEach(b => b.onclick = () => select(b.dataset.gp, { scroll: true, keep: true }));
    const map = $(".gp-map", card);
    if (map) map.onclick = (e) => { if (!e.target.closest(".gp-pt") && !e.target.closest(".gp-pop") && sel) select(""); };
    wireDoc();
    if (pending) { const id = pending; pending = ""; sel = ""; select(id, { scroll: true, keep: true }); }
    else applyState(card);
  }

  /* ── 편집 (hq) ── */
  const uid = () => "sp" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function editor() {
    if (!canEdit()) return;
    const src = post();
    const draft = {
      title: src.title || "", asOf: src.asOf || "", note: src.note || "",
      points: (Array.isArray(src.points) ? src.points : []).filter(p => p && p.id).map(p => ({
        id: p.id, label: String(p.label || ""), kind: KIND[p.kind] ? p.kind : "cargo", x: num(p.x) ? p.x : 50, y: num(p.y) ? p.y : 50,
        lp: ["b", "t", "l", "r"].indexOf(p.lp) >= 0 ? p.lp : "b", cr: !!p.cr, dmd: !!p.dmd, note: String(p.note || "") }))
    };
    draft.points.sort(byLabel);
    let image = Object.assign({}, pic());
    let imgChanged = false;
    let eSel = "";
    const rowHTML = (p) => `<tr data-row="${esc(p.id)}" class="${p.id === eSel ? "on" : ""}">
        <td><button type="button" class="gp-pick" data-pick="${esc(p.id)}" aria-label="${esc((p.label || "새 지점") + " 위치 지정")}" title="선택한 뒤 도면을 누르면 그 자리로">${sw(p.kind)}</button></td>
        <td><input type="text" class="gp-in-label" data-f="label" value="${esc(p.label)}" maxlength="12" aria-label="지점 이름"></td>
        <td><select data-f="kind" aria-label="유형">${KINDS.map(x => `<option value="${x.k}"${p.kind === x.k ? " selected" : ""}>${esc(x.label)}</option>`).join("")}</select></td>
        <td><select data-f="lp" aria-label="이름표 위치">${LP.map(([v, l]) => `<option value="${v}"${p.lp === v ? " selected" : ""}>${l}</option>`).join("")}</select></td>
        <td class="c"><input type="checkbox" data-f="cr"${p.cr ? " checked" : ""} aria-label="카드리더"></td>
        <td class="c"><input type="checkbox" data-f="dmd"${p.dmd ? " checked" : ""} aria-label="문형 금속탐지기"></td>
        <td><input type="text" data-f="note" value="${esc(p.note)}" maxlength="200" aria-label="비고"></td>
        <td class="mono gp-xy" data-xy>${esc(p.x.toFixed(1) + ", " + p.y.toFixed(1))}</td>
        <td><button type="button" class="mt-btn danger" data-del="${esc(p.id)}" aria-label="삭제" title="삭제">${icon("trash", 16)}</button></td>
      </tr>`;
    const count = () => {
      const s = stats(draft);
      return KINDS.map(x => `${sw(x.k)}${esc(x.label)} <b class="mono">${s.by[x.k]}</b>`).join('<span class="gp-sep"></span>') +
        `<span class="gp-sep"></span>카드리더 <b class="mono">${s.cr}</b><span class="gp-sep"></span>문형 MD <b class="mono">${s.dmd}</b>`;
    };
    openModal(`<h3>배치도 편집</h3>
      <div class="gp-ed-meta">
        <label>제목<input type="text" id="gp-e-title" maxlength="60" value="${esc(draft.title)}" placeholder="경비대원 배치도"></label>
        <label>기준일<input type="date" id="gp-e-asof" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(draft.asOf) ? draft.asOf : "")}"></label>
        <label class="gp-ed-note">비고<input type="text" id="gp-e-note" maxlength="200" value="${esc(draft.note)}"></label>
      </div>
      <div class="gp-ed-img">
        <span class="gp-ed-imgt">도면 <small class="mono" id="gp-e-imginfo">${imgOk(image.img) ? esc((image.w || "?") + "×" + (image.h || "?") + " · " + Math.round(image.img.length / 1365) + "KB") : "없음"}</small></span>
        <label class="btn btn-ghost btn-sm gp-ed-file">${icon("image", 16)}<span>${imgOk(image.img) ? "도면 교체" : "도면 첨부"}</span>
          <input type="file" id="gp-e-file" accept="image/png,image/jpeg,image/webp" hidden></label>
        <span class="spacer"></span>${ui.tip("표에서 지점의 색 동그라미를 누른 뒤 도면을 누르면 그 자리로 옮겨집니다. 새 지점은 '지점 추가' 후 도면을 누르세요. 도면은 PNG · JPG · WebP(가로 2,400px 이하로 줄여 WebP로 저장)입니다.", "배치도 편집 방법")}
      </div>
      <div class="gp-ed-mapwrap" id="gp-e-map">${mapHTML(draft, image, { edit: true, sel: eSel })}</div>
      <div class="gp-ed-count" id="gp-e-count">${count()}</div>
      <div class="table-wrap gp-ed-tw"><table class="tbl gp-ed-tbl">
        <thead><tr><th></th><th>이름</th><th>유형</th><th>이름표</th><th class="c">카드리더</th><th class="c">문형 MD</th><th>비고</th><th>위치(%)</th><th></th></tr></thead>
        <tbody id="gp-e-rows">${draft.points.map(rowHTML).join("")}</tbody></table></div>
      <button type="button" class="btn btn-ghost btn-sm" id="gp-e-add">${icon("plus", 16)}<span>지점 추가</span></button>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="gp-e-cancel">취소</button><button type="button" class="btn btn-primary" id="gp-e-save">저장</button></div>`, { wide: true });
    const box = $("#modal-box");
    box.classList.add("full");
    const find = (id) => draft.points.find(p => p.id === id);
    const paintMap = () => {
      $("#gp-e-map", box).innerHTML = mapHTML(draft, image, { edit: true, sel: eSel });
      wireMap();
      $("#gp-e-count", box).innerHTML = count();
    };
    const markRows = () => $$("#gp-e-rows tr", box).forEach(tr => tr.classList.toggle("on", tr.dataset.row === eSel));
    function wireMap() {
      const map = $("#gp-e-map .gp-map", box);
      if (!map) return;
      $$(".gp-pt", map).forEach(b => b.onclick = (e) => { e.stopPropagation(); eSel = eSel === b.dataset.gp ? "" : b.dataset.gp; paintMap(); markRows(); });
      map.onclick = (e) => {
        if (!eSel || e.target.closest(".gp-pt")) return;
        const p = find(eSel);
        if (!p) return;
        const r = map.getBoundingClientRect();
        if (!r.width || !r.height) return;
        p.x = clamp((e.clientX - r.left) / r.width * 100);
        p.y = clamp((e.clientY - r.top) / r.height * 100);
        const td = $('#gp-e-rows tr[data-row="' + p.id + '"] [data-xy]', box);
        if (td) td.textContent = p.x.toFixed(1) + ", " + p.y.toFixed(1);
        paintMap();
      };
    }
    function wireRow(tr) {
      const p = find(tr.dataset.row);
      if (!p) return;
      $$("[data-f]", tr).forEach(el => {
        const f = el.dataset.f;
        const upd = () => {
          if (f === "cr" || f === "dmd") p[f] = el.checked;
          else p[f] = el.value;
          if (f === "kind") { const pk = $("[data-pick]", tr); if (pk) pk.innerHTML = sw(p.kind); }
          if (f !== "note") paintMap();
        };
        el.addEventListener(el.tagName === "INPUT" && el.type === "text" ? "input" : "change", upd);
      });
      const pk = $("[data-pick]", tr);
      if (pk) pk.onclick = () => { eSel = eSel === p.id ? "" : p.id; paintMap(); markRows(); };
      const del = $("[data-del]", tr);
      if (del) del.onclick = () => {
        draft.points = draft.points.filter(x => x.id !== p.id);
        if (eSel === p.id) eSel = "";
        tr.remove(); paintMap();
      };
    }
    wireMap();
    $$("#gp-e-rows tr", box).forEach(wireRow);
    $("#gp-e-add", box).onclick = () => {
      const p = { id: uid(), label: "", kind: "cargo", x: 50, y: 50, lp: "b", cr: false, dmd: false, note: "" };
      draft.points.push(p);
      eSel = p.id;
      $("#gp-e-rows", box).insertAdjacentHTML("beforeend", rowHTML(p));
      wireRow($("#gp-e-rows", box).lastElementChild); paintMap(); markRows();
      const inp = $('#gp-e-rows tr[data-row="' + p.id + '"] .gp-in-label', box);
      if (inp) inp.focus();
    };
    $("#gp-e-file", box).onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast("PNG · JPG · WebP 파일만 올릴 수 있습니다.", true); return; }
      toWebp(f).then(r => {
        if (r.url.length > MAX_IMG) { toast("도면 파일이 너무 큽니다. 해상도를 줄여 다시 첨부해 주세요.", true); return; }
        const ratioChanged = num(image.w) && num(image.h) && image.w && image.h && Math.abs(image.w / image.h - r.w / r.h) > 0.01;
        image = { img: r.url, w: r.w, h: r.h, name: f.name };
        imgChanged = true;
        $("#gp-e-imginfo", box).textContent = r.w + "×" + r.h + " · " + Math.round(r.url.length / 1365) + "KB";
        paintMap();
        if (ratioChanged && draft.points.length) toast("도면 비율이 바뀌었습니다. 지점 위치를 확인해 주세요.");
      }).catch(() => toast("도면을 읽지 못했습니다.", true));
    };
    $("#gp-e-cancel", box).onclick = closeModal;
    $("#gp-e-save", box).onclick = () => {
      draft.title = $("#gp-e-title", box).value.trim();
      draft.asOf = $("#gp-e-asof", box).value;
      draft.note = $("#gp-e-note", box).value.trim();
      const labels = draft.points.map(p => String(p.label).trim());
      if (labels.some(l => !l)) { toast("지점 이름을 모두 입력해 주세요.", true); return; }
      const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
      if (dup.length) { toast("같은 이름의 지점이 있습니다: " + dup[0], true); return; }
      const who = (SeMIS.user && (SeMIS.user.name || SeMIS.user.id)) || "";
      const at = new Date().toISOString();
      D()[KEY] = { title: draft.title, asOf: draft.asOf, note: draft.note,
        points: draft.points.map(p => ({ id: p.id, label: String(p.label).trim(), kind: p.kind, x: clamp(p.x), y: clamp(p.y), lp: p.lp,
          cr: !!p.cr, dmd: !!p.dmd, note: String(p.note || "").trim() })),
        updatedAt: at, updatedBy: who };
      if (imgChanged) D()[IKEY] = { img: image.img, w: image.w, h: image.h, name: image.name || "", updatedAt: at, updatedBy: who };
      SeMIS.save();
      closeModal();
      SeMIS.renderView();
      toast("배치도를 저장했습니다.");
    };
  }
  /* 도면 파일 → WebP data URL (가로 2,400px 이하) */
  function toWebp(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onerror = reject;
      rd.onload = () => {
        const im = new Image();
        im.onerror = reject;
        im.onload = () => {
          const k = Math.min(1, 2400 / (im.naturalWidth || 1));
          const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const cx = cv.getContext("2d");
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
          cx.drawImage(im, 0, 0, w, h);
          let url = cv.toDataURL("image/webp", 0.92);
          if (!/^data:image\/webp/.test(url)) url = cv.toDataURL("image/png");
          resolve({ url, w, h });
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  /* 통합 검색 — 지점 이름 · 유형 · 비고 (배치도를 읽을 수 있는 사람만 데이터가 있다) */
  if (window.SemisSearch) SemisSearch.register({
    id: "secpost", group: "경비대원 배치도", ico: "map", module: ROUTE,
    items: () => canRead() ? points().map(p => ({
      title: p.label + " 경비 지점", sub: KIND[p.kind].full + (p.cr ? " · 카드리더" : "") + (p.dmd ? " · 문형 금속탐지기" : ""),
      text: [p.label, KIND[p.kind].label, KIND[p.kind].full, p.note], route: ROUTE,
      pick: () => { pending = p.id; filter = ""; if (/^#\/sec-dash$/.test(location.hash)) setTimeout(() => SeMIS.renderView(), 0); }
    })) : []
  });

  window.SemisSecPost = {
    KINDS, KIND, cardHTML, mount, editor, select, points, stats, hasData, canRead, canEdit, imgOk,
    getState: () => ({ filter, sel }), _reset() { filter = ""; sel = ""; pending = ""; }
  };
})();
