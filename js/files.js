/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 첨부 뷰어 (v1.12.1)
   공지·일정 메모·회의록 등에 붙인 파일(.nb-file)과 이미지를 누르면 열리는 공통 뷰어.

   - 사진·PDF는 그 자리에서 미리보기, 그 밖의 형식은 이름·형식과 함께 내려받기/새 탭
   - 편집 중인 글(contenteditable)에서도 눌러서 열 수 있고, 뷰어에서 바로 첨부를 뺄 수 있다
     (편집기 안에서는 링크가 열리지 않는 브라우저 기본 동작 때문에 여태 눌러도 반응이 없었다)
   - 같은 글에 붙인 첨부는 ← → 로 넘긴다
   - 내려받기는 올릴 때의 원래 이름으로 저장한다
     (저장소 경로는 한글이 _ 로 바뀌어 있어 주소 그대로 받으면 이름이 깨진다 —
      Supabase 공개 URL은 ?download=<이름>, 그 밖의 주소는 blob 으로 처리)
   - <dialog> 라서 모달(일정 수정 창 등) 위에 겹쳐 뜨고, 닫으면 원래 화면이 그대로 남는다
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const S = () => window.SeMIS;
  const esc = (v) => S().esc(v);
  const icon = (n, z) => S().icon(n, z);
  const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)(\?|#|$)/i;
  const PDF_RE = /\.pdf(\?|#|$)/i;
  const SEL_FILE = "a.nb-file, .nb-file > a";
  const SEL_IMG = ".nb-editor img, .notice-html img, .ag-memo img, .cn-rich img, .nb-files-view img";
  const SEL_ROOT = ".nb-editor, .notice-html, .ag-memo, .cn-rich, .nb-files-view, .notice-body, td, .modal-box";

  let list = [], idx = 0, pushed = false, zoom = false;

  /* ─────── 파일 정보 ─────── */
  /* 비공개 파일은 화면에서 서명 URL로 바뀌어 있다 — 원래(표준) 주소는 data-sf 에 있다 (js/fileauth.js) */
  const urlOf = (el) => el.getAttribute("data-sf") || (el.tagName === "IMG" ? (el.getAttribute("src") || "") : (el.getAttribute("href") || ""));
  function nameFromUrl(url) {
    try {
      const p = String(url).split(/[?#]/)[0].split("/").pop() || "";
      return decodeURIComponent(p) || "첨부";
    } catch (e) { return "첨부"; }
  }
  function nameOf(el) {
    const raw = el.tagName === "IMG" ? (el.getAttribute("alt") || "") : (el.dataset.name || el.textContent || "");
    /* 앞에 붙은 그림문자(📎 · 📄)와 공백만 걷어낸다 */
    const t = String(raw).replace(/^[\s\u00a0\u200b]*(?:[\u2190-\u27bf\u2b00-\u2bff\ufe0f\u{1f000}-\u{1faff}]+[\s\u00a0]*)*/u, "").trim();
    return t || nameFromUrl(urlOf(el));
  }
  function kindOf(url, name) {
    const s = String(name || "") + " " + String(url || "");
    if (/^data:image\//i.test(url) || IMG_RE.test(s)) return "image";
    if (PDF_RE.test(s)) return "pdf";
    return "file";
  }
  function extOf(name, url) {
    const m = /\.([A-Za-z0-9]{1,6})(\?|#|$)/.exec(String(name || "") || String(url || ""));
    return m ? m[1].toUpperCase() : "";
  }

  /* ─────── 내려받기 — 올릴 때의 이름 그대로 ─────── */
  function clickLink(href, name) {
    const a = document.createElement("a");
    a.href = href;
    if (name) a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  /* Supabase 저장소 URL(표준·서명)이면 서버가 원래 이름으로 내려 주도록 download= 를 붙인다 */
  function downloadHref(url, name) {
    if (!/\/storage\/v1\/object\/(public|sign)\//.test(String(url))) return "";
    const u = String(url).split("#")[0];
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "download=" + encodeURIComponent(name || nameFromUrl(url));
  }
  async function download(url, name) {
    try { if (window.SemisFileAuth) url = await SemisFileAuth.resolve(url); } catch (e) { /* 원래 주소로 시도 */ }
    const direct = downloadHref(url, name);
    if (direct) { clickLink(direct, name || nameFromUrl(url)); return; }
    if (/^data:/i.test(url)) { clickLink(url, name); return; }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const obj = URL.createObjectURL(await res.blob());
      clickLink(obj, name);
      setTimeout(() => URL.revokeObjectURL(obj), 20000);
    } catch (e) {
      window.open(url, "_blank", "noopener");
    }
  }

  /* ─────── 뷰어 ─────── */
  function viewerEl() {
    let d = document.getElementById("fv-viewer");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "fv-viewer";
    d.className = "fv-viewer";
    d.setAttribute("closedby", "any");
    d.setAttribute("aria-labelledby", "fv-title");
    d.innerHTML = `
      <div class="fv-bar">
        <div class="fv-t"><b id="fv-title"></b><span class="fv-ext mono"></span></div>
        <div class="fv-acts">
          <button type="button" class="fv-btn fv-ico" data-fv="prev" aria-label="이전 첨부">${icon("chevron", 20)}</button>
          <span class="fv-pos mono" aria-live="polite"></span>
          <button type="button" class="fv-btn fv-ico" data-fv="next" aria-label="다음 첨부">${icon("chevron", 20)}</button>
          <button type="button" class="fv-btn fv-danger" data-fv="del">${icon("trash", 17)}<span>첨부 삭제</span></button>
          <a class="fv-btn" data-fv="tab" target="_blank" rel="noopener">${icon("external", 16)}<span>새 탭</span></a>
          <button type="button" class="fv-btn fv-primary" data-fv="down">${icon("down", 17)}<span>다운로드</span></button>
          <button type="button" class="fv-btn fv-ico fv-close" data-fv="close" aria-label="닫기" autofocus>${icon("x", 20)}</button>
        </div>
      </div>
      <div class="fv-stage" data-fv-stage></div>`;
    document.body.appendChild(d);
    d.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-fv]");
      if (b) {
        const a = b.dataset.fv;
        if (a === "close") close();
        else if (a === "prev") step(-1);
        else if (a === "next") step(1);
        else if (a === "del") removeCurrent();
        else if (a === "down") { const c = current(); if (c) download(c.url, c.name); }
        return;
      }
      if (ev.target.classList && ev.target.classList.contains("fv-img")) { setZoom(!zoom); return; }
      const stage = d.querySelector("[data-fv-stage]");
      if (ev.target === d || (ev.target === stage && !zoom)) close();
    });
    d.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.stopPropagation(); return; }   // 뒤에 열려 있는 모달(일정 수정 등)까지 닫히지 않게
      if (ev.target.closest("a,input,textarea")) return;
      if (ev.key === "ArrowRight") { ev.preventDefault(); step(1); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); step(-1); }
    });
    d.addEventListener("close", reset);
    window.addEventListener("popstate", () => {
      const v = document.getElementById("fv-viewer");
      if (pushed) { pushed = false; if (v && (v.open || v.hasAttribute("open"))) close(); }
    });
    return d;
  }
  const current = () => list[idx] || null;

  function paint() {
    const d = viewerEl(), c = current();
    if (!c) return;
    const $$1 = (sel) => d.querySelector(sel);
    $$1("#fv-title").textContent = c.name;
    $$1(".fv-ext").textContent = extOf(c.name, c.url);
    $$1(".fv-pos").textContent = list.length > 1 ? (idx + 1) + " / " + list.length : "";
    d.querySelectorAll('[data-fv="prev"],[data-fv="next"],.fv-pos').forEach(el => { el.hidden = list.length < 2; });
    $$1('[data-fv="del"]').hidden = !c.editable;
    $$1('[data-fv="tab"]').href = c.url;
    const stage = $$1("[data-fv-stage]");
    setZoom(false);
    stage.dataset.kind = c.kind;
    stage.innerHTML = c.kind === "image"
      ? `<img class="fv-img" src="${esc(c.url)}" alt="${esc(c.name)}">`
      : c.kind === "pdf"
        ? `<iframe class="fv-frame" src="${esc(c.url)}" title="${esc(c.name)}"></iframe>`
        : `<div class="fv-none">${icon("doc", 34)}<b>${esc(c.name)}</b><span>${esc(extOf(c.name, c.url) || "파일")} 형식은 미리보기를 지원하지 않습니다</span></div>`;
  }
  function open(items, at) {
    list = (items || []).filter(x => x && x.url);
    if (!list.length) return;
    idx = Math.max(0, Math.min(list.length - 1, at || 0));
    const d = viewerEl();
    paint();
    if (!d.open && !d.hasAttribute("open")) {
      try { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
      catch (e) { d.setAttribute("open", ""); }
      try { history.pushState({ fvViewer: 1 }, ""); pushed = true; } catch (e) { /* noop */ }
    }
    document.documentElement.classList.add("fv-viewing");
  }
  function close() {
    const d = document.getElementById("fv-viewer");
    if (!d) return;
    try { if (typeof d.close === "function" && d.open) d.close(); } catch (e) { /* noop */ }
    d.removeAttribute("open");
    reset();
  }
  function reset() {
    const d = document.getElementById("fv-viewer");
    document.documentElement.classList.remove("fv-viewing");
    zoom = false;
    if (pushed) { pushed = false; try { history.back(); } catch (e) { /* noop */ } }
    if (d && !d.open) { const st = d.querySelector("[data-fv-stage]"); if (st) st.innerHTML = ""; }
  }
  function step(dir) {
    if (list.length < 2) return;
    idx = (idx + dir + list.length) % list.length;
    paint();
  }
  function setZoom(on) {
    const d = document.getElementById("fv-viewer");
    if (!d) return;
    const img = d.querySelector(".fv-img");
    zoom = !!(on && img);
    d.classList.toggle("is-zoom", zoom);
  }
  /* 편집 중인 글에서 첨부 빼기 — 뒤따르는 빈칸(&nbsp;)까지 정리 */
  function removeCurrent() {
    const c = current();
    if (!c || !c.editable || !c.node || !c.node.parentNode) return;
    const ed = c.node.closest('[contenteditable="true"]');
    const next = c.node.nextSibling;
    if (next && next.nodeType === 3 && !next.nodeValue.replace(/[\s ]/g, "")) next.parentNode.removeChild(next);
    c.node.parentNode.removeChild(c.node);
    if (ed) ed.dispatchEvent(new Event("input", { bubbles: true }));
    list.splice(idx, 1);
    if (!list.length) { close(); S().toast("첨부를 뺐습니다."); return; }
    idx = Math.min(idx, list.length - 1);
    paint();
    S().toast("첨부를 뺐습니다.");
  }

  /* ─────── 클릭 위임 — 첨부 칩·이미지 ─────── */
  function itemOf(el) {
    const url = urlOf(el);
    const name = nameOf(el);
    return { url, name, kind: kindOf(url, name), node: el, editable: !!el.closest('[contenteditable="true"]') };
  }
  function openFrom(el) {
    const root = el.closest(SEL_ROOT) || document.body;
    const sibs = Array.from(root.querySelectorAll(SEL_FILE + ", " + SEL_IMG));
    const items = (sibs.indexOf(el) >= 0 ? sibs : [el]).map(itemOf);
    open(items, Math.max(0, sibs.indexOf(el)));
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (ev) => {
      if (!ev.target || !ev.target.closest || ev.defaultPrevented) return;
      if (ev.target.closest("#fv-viewer")) return;
      const a = ev.target.closest(SEL_FILE);
      if (a && urlOf(a)) { ev.preventDefault(); openFrom(a); return; }
      const img = ev.target.closest(SEL_IMG);
      if (img && urlOf(img)) { ev.preventDefault(); openFrom(img); }
    });
  }

  window.SemisFiles = { open, close, download, downloadHref, kindOf, nameOf, nameFromUrl, openFrom, get list() { return list; } };
})();
