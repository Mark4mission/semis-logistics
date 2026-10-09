/* 공통 패널 모달 — 통합 검색 · 메인 데스크 · 아르고가 같은 껍데기를 쓴다(폼용 작은 모달 openModal 과는 별개).
   <dialog> showModal: 화면 중앙 · 같은 크기(데스크톱 최대 960px × 86vh, 모바일 전체 화면) · Esc · 바깥 누르기 · 포커스 가두기 ·
   뒤 화면 스크롤 잠금 · 열고 닫는 움직임(동작 줄이기면 생략). 열린 패널 안에서 뜨는 폼 모달 · 토스트 · 말풍선 · 액션 시트는
   host() 로 패널 안에 붙인다 — 모달 대화상자 밖은 inert 라 그렇지 않으면 가려지고 누를 수 없다.
   SeMIS.ui.panel({ id, title, sub, mascot(부엉이 상태) | icon, tabs[{ id, label, badge }], tab, onTab(id), render(body, h) | body,
                    actions(html), print(true | (h) => 인쇄 제목), focus(선택자), onClose(), cls }) → 핸들 */
"use strict";

window.SemisPanel = (() => {
  const S = () => window.SeMIS;
  const stack = [];                 // 열린 패널 id (아래 → 위)
  const P = {};                     // id → { o, el, back }
  const env = () => typeof window !== "undefined" && typeof document !== "undefined";
  const reduce = () => !!(env() && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (n, z) => (S() && S().icon ? S().icon(n, z) : "");
  const nativeModal = (d) => typeof d.showModal === "function";

  /* 닫히는 움직임 — overlay · display 전환을 지원하지 않는 브라우저(Firefox · Safari)는 data-closing 으로 움직인 뒤 닫는다 */
  let dispT;
  function canTransitionDisplay() {
    if (dispT !== undefined) return dispT;
    if (!(window.CSS && CSS.supports && CSS.supports("transition-behavior", "allow-discrete")) || !document.body) return (dispT = false);
    const pr = document.createElement("div");
    pr.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
    document.body.appendChild(pr);
    getComputedStyle(pr).display;
    pr.style.display = "none";
    dispT = getComputedStyle(pr).display === "block";
    pr.remove();
    return dispT;
  }
  const exitOK = () => !!(window.CSS && CSS.supports && CSS.supports("overlay", "auto")) && canTransitionDisplay();

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  function focusables(root) {
    const dom = /jsdom/i.test((navigator && navigator.userAgent) || "");
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(n => n.getAttribute("tabindex") !== "-1" && !n.closest("[hidden]") && !n.closest(".hidden") && (dom || n.getClientRects().length > 0));
  }

  function create(id) {
    const d = document.createElement("dialog");
    d.className = "pnl no-print";
    d.id = "pnl-" + id;
    d.setAttribute("aria-labelledby", "pnl-" + id + "-t");
    d.setAttribute("closedby", "any");
    d.innerHTML =
      '<header class="pnl-head">' +
        '<span class="pnl-mark" aria-hidden="true"></span>' +
        '<div class="pnl-tt"><h2 class="pnl-title" id="pnl-' + esc(id) + '-t"></h2><p class="pnl-sub"></p></div>' +
        '<div class="pnl-acts"></div>' +
        '<button type="button" class="btn btn-ghost btn-sm pnl-print" hidden>' + icon("print", 17) + '<span>Print</span></button>' +
        '<button type="button" class="icon-btn pnl-more" aria-label="더보기" title="더보기" hidden><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg></button>' +
        '<button type="button" class="pnl-x" aria-label="닫기">' + icon("x", 22) + '</button>' +
      '</header>' +
      '<div class="pnl-tabs is-empty" role="presentation"></div>' +
      '<div class="pnl-body" id="pnl-' + esc(id) + '-b" tabindex="-1"></div>';
    document.body.appendChild(d);
    d.querySelector(".pnl-x").addEventListener("click", () => close(id));
    d.querySelector(".pnl-print").addEventListener("click", () => print(id));
    d.querySelector(".pnl-more").addEventListener("click", (e) => more(id, e.currentTarget));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (innerOpen(d)) return;                      // 안쪽 폼 모달 · 시트가 먼저 닫힌다
      close(id);
    });
    d.addEventListener("close", () => cleanup(id));
    d.addEventListener("click", (e) => {             // 바깥(배경) 누르기 — closedby 미지원 브라우저 보완
      if (e.target !== d || ("closedBy" in d && nativeModal(d))) return;
      const r = d.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(id);
    });
    d.addEventListener("keydown", (e) => {
      if (e.key === "Tab") trap(d, e);
      else if (e.key === "Escape" && !nativeModal(d) && !e.defaultPrevented) {
        e.preventDefault();
        if (!innerOpen(d)) close(id);
      }
    });
    return d;
  }
  function innerOpen(d) {
    const ov = document.getElementById("modal-overlay");
    if (ov && d.contains(ov) && !ov.classList.contains("hidden")) return true;
    return !!d.querySelector("#asheet");
  }
  function trap(d, e) {
    const f = focusables(d);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (e.shiftKey && (a === first || !d.contains(a))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || !d.contains(a))) { e.preventDefault(); first.focus(); }
  }

  function lock(on) {
    const h = document.documentElement;
    h.classList.toggle("pnl-lock", !!on);
  }

  /* ── 채우기 ── */
  function paintHead(p) {
    const o = p.o, d = p.el;
    d.querySelector(".pnl-title").textContent = o.title || "";
    const sub = d.querySelector(".pnl-sub");
    sub.textContent = o.sub || "";
    sub.hidden = !o.sub;
    const mark = d.querySelector(".pnl-mark");
    if (o.mascot && window.SemisOwl) {
      const z = (S() && S().isMobile && S().isMobile()) ? 40 : 48;
      if (!mark._owl || mark._owl.size !== z) { mark.innerHTML = ""; window.SemisOwl.mount(mark, { size: z, state: o.mascot }); }
      else window.SemisOwl.set(mark, o.mascot);
      mark.classList.add("is-owl");
    } else {
      mark.classList.remove("is-owl");
      if (mark._owl) mark._owl.dead = true;
      mark._owl = null;
      mark.removeAttribute("style");
      mark.innerHTML = icon(o.icon || "grid", 24);
    }
    d.querySelector(".pnl-acts").innerHTML = o.actions || "";
    const pb = d.querySelector(".pnl-print");
    pb.hidden = !o.print;
    d.className = "pnl no-print" + (o.cls ? " " + o.cls : "");
    if (typeof o.onActs === "function") o.onActs(d.querySelector(".pnl-acts"), handle(o.id));
    d.querySelector(".pnl-more").hidden = !o.print && !o.actions;
  }
  /* 모바일 — 머리 버튼(관리 동작 · Print)은 더보기(…) 시트로. 원래 버튼을 눌러 동작 · 권한 그대로 */
  function more(id, from) {
    const p = P[id];
    if (!p || !S() || !S().actionSheet) return;
    const bs = Array.from(p.el.querySelectorAll(".pnl-acts button, .pnl-print")).filter(b => !b.hidden && !b.disabled);
    if (!bs.length) return;
    S().actionSheet(bs.map(b => ({
      label: String(b.textContent || "").replace(/\s+/g, " ").trim() || b.getAttribute("aria-label") || "실행",
      icon: b.querySelector("svg") ? b.querySelector("svg").outerHTML : "", run: () => b.click()
    })), { title: p.o.title || "" }, from);
  }
  function paintTabs(p) {
    const o = p.o, box = p.el.querySelector(".pnl-tabs");
    const tabs = Array.isArray(o.tabs) ? o.tabs : [];
    box.classList.toggle("is-empty", tabs.length < 2);
    box.setAttribute("role", tabs.length < 2 ? "presentation" : "tablist");
    if (tabs.length > 1) box.setAttribute("aria-label", (o.title || "") + " 탭"); else box.removeAttribute("aria-label");
    if (tabs.length && !tabs.some(t => t.id === o.tab)) o.tab = tabs[0].id;
    box.innerHTML = tabs.length < 2 ? "" : tabs.map(t =>
      '<button type="button" role="tab" class="pnl-tab" id="pnl-' + esc(o.id) + '-tab-' + esc(t.id) + '" data-tab="' + esc(t.id) + '" aria-controls="pnl-' + esc(o.id) +
      '-b" aria-selected="' + (t.id === o.tab) + '" tabindex="' + (t.id === o.tab ? "0" : "-1") + '"><span>' + esc(t.label) + '</span>' +
      (t.badge || t.badge === 0 && t.showZero ? '<b class="pnl-n">' + esc(t.badge) + '</b>' : "") + '</button>').join("");
    const body = p.el.querySelector(".pnl-body");
    if (tabs.length > 1) { body.setAttribute("role", "tabpanel"); body.setAttribute("aria-labelledby", "pnl-" + o.id + "-tab-" + o.tab); }
    else { body.removeAttribute("role"); body.removeAttribute("aria-labelledby"); }
    Array.from(box.querySelectorAll("[data-tab]")).forEach((b, i, all) => {
      b.onclick = () => setTab(o.id, b.dataset.tab);
      b.onkeydown = (e) => {
        const k = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        const n = all[(i + k + all.length) % all.length];
        n.focus(); setTab(o.id, n.dataset.tab);
      };
    });
  }
  function paintBody(p) {
    const o = p.o, body = p.el.querySelector(".pnl-body");
    if (typeof o.render === "function") o.render(body, handle(o.id));
    else if (o.body && typeof o.body === "object" && o.body.nodeType) { if (o.body.parentNode !== body) { body.innerHTML = ""; body.appendChild(o.body); } }
    else if (o.body != null) body.innerHTML = String(o.body);
  }

  /* ── 열기 · 닫기 ── */
  function open(o) {
    if (!env() || !o || !o.id) return null;
    let p = P[o.id];
    if (!p) p = P[o.id] = { o: {}, el: create(o.id), back: null };
    const wasOpen = isOpen(o.id);
    p.o = Object.assign({}, wasOpen ? p.o : {}, o);
    paintHead(p); paintTabs(p); paintBody(p);
    const d = p.el;
    if (!wasOpen) {
      p.back = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      d.removeAttribute("data-closing");
      if (d.parentNode !== document.body) document.body.appendChild(d);
      if (nativeModal(d)) { try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
      else d.setAttribute("open", "");
      stack.push(o.id);
      lock(true);
      d.querySelector(".pnl-body").scrollTop = 0;
      focusFirst(p);
      if (S() && S().closeOverlays) S().closeOverlays();
    }
    return handle(o.id);
  }
  function focusFirst(p) {
    const d = p.el, o = p.o;
    let t = o.focus ? d.querySelector(o.focus) : null;
    if (!t) t = d.querySelector('.pnl-tab[aria-selected="true"]');
    if (!t || t.closest("[hidden]")) t = d.querySelector(".pnl-body");
    try { t.focus({ preventScroll: true }); } catch (e) { /* 포커스 불가 */ }
  }
  function isOpen(id) { const p = P[id]; return !!(p && p.el.hasAttribute("open") && !p.el.hasAttribute("data-closing")); }
  function close(id) {
    const p = P[id];
    if (!p || !p.el.hasAttribute("open") || p.el.hasAttribute("data-closing")) return;
    const d = p.el;
    const fin = () => {
      d.removeAttribute("data-closing");
      if (nativeModal(d)) { try { d.close(); } catch (e) { d.removeAttribute("open"); cleanup(id); } }
      else { d.removeAttribute("open"); cleanup(id); }
    };
    if (reduce() || !nativeModal(d) || exitOK()) { fin(); return; }
    d.setAttribute("data-closing", "");
    const an = d.getAnimations ? d.getAnimations({ subtree: false }) : [];
    if (!an.length) { fin(); return; }
    Promise.race([Promise.allSettled(an.map(a => a.finished)), new Promise(r => setTimeout(r, 400))]).then(fin);
  }
  function cleanup(id) {
    const p = P[id];
    if (!p) return;
    const i = stack.lastIndexOf(id);
    if (i < 0) return;
    stack.splice(i, 1);
    const d = p.el;
    const ov = document.getElementById("modal-overlay");
    if (ov && d.contains(ov)) { if (!ov.classList.contains("hidden") && S() && S().closeModal) S().closeModal(); document.body.appendChild(ov); }
    ["toast-wrap", "help-tipbox", "asheet"].forEach(k => { const n = document.getElementById(k); if (n && d.contains(n)) document.body.appendChild(n); });
    if (!stack.length) lock(false);
    const back = p.back; p.back = null;
    if (back && back.isConnected && typeof back.focus === "function") { try { back.focus({ preventScroll: true }); } catch (e) { /* 이미 사라진 버튼 */ } }
    if (typeof p.o.onClose === "function") { try { p.o.onClose(); } catch (e) { /* 닫기 후처리 실패는 무시 */ } }
  }
  function closeAll() { stack.slice().reverse().forEach(close); }

  function setTab(id, tab) {
    const p = P[id];
    if (!p || p.o.tab === tab) return;
    p.o.tab = tab;
    paintTabs(p);
    if (typeof p.o.onTab === "function") p.o.onTab(tab, handle(id));
    paintBody(p);
    p.el.querySelector(".pnl-body").scrollTop = 0;
  }
  /* 다시 그리기 — 열려 있을 때만, 본문 스크롤 · 입력 포커스 유지 */
  function refresh(id, patch) {
    const p = P[id];
    if (!p) return;
    if (patch) Object.assign(p.o, patch);
    if (!isOpen(id)) return;
    const body = p.el.querySelector(".pnl-body"), top = body.scrollTop;
    paintHead(p); paintTabs(p); paintBody(p);
    body.scrollTop = top;
  }

  /* 인쇄 — 패널 본문(지금 탭)을 A4 문서로. 화면 머리말 · 버튼은 빠지고 문서 머리말이 붙는다 */
  function print(id) {
    const p = P[id];
    if (!p) return;
    const t = typeof p.o.print === "function" ? p.o.print(handle(id)) : p.o.title;
    let box = document.getElementById("pnl-print");
    if (!box) { box = document.createElement("div"); box.id = "pnl-print"; document.body.appendChild(box); }
    const head = S() && S().printHeadHTML ? S().printHeadHTML(t || p.o.title || "") : "";
    const body = p.el.querySelector(".pnl-body").cloneNode(true);
    body.removeAttribute("id"); body.removeAttribute("tabindex");
    Array.from(body.querySelectorAll("[id]")).forEach(n => n.removeAttribute("id"));
    box.innerHTML = '<div id="pnl-print-head">' + head + "</div>";
    box.appendChild(body);
    const html = document.documentElement;
    html.classList.add("pnl-printing");
    const done = () => { html.classList.remove("pnl-printing"); box.innerHTML = ""; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => {
      try { window.print(); } catch (e) { if (S() && S().toast) S().toast("인쇄를 시작할 수 없습니다.", true); }
      setTimeout(done, 1500);
    }, 60);
  }

  function handle(id) {
    const p = P[id];
    return {
      id, el: p.el, get body() { return p.el.querySelector(".pnl-body"); }, get tab() { return p.o.tab; }, get isOpen() { return isOpen(id); },
      set(patch) { refresh(id, patch); }, setTab(t) { setTab(id, t); },
      setMascot(st) { p.o.mascot = st; const m = p.el.querySelector(".pnl-mark"); if (m && m._owl && window.SemisOwl) window.SemisOwl.set(m, st); },
      close() { close(id); }, print() { print(id); }
    };
  }
  /* 지금 맨 위 패널(없으면 body) — 폼 모달 · 토스트 · 말풍선 · 시트를 붙일 곳 */
  function host() {
    for (let i = stack.length - 1; i >= 0; i--) { const p = P[stack[i]]; if (p && p.el.hasAttribute("open")) return p.el; }
    return env() ? document.body : null;
  }

  return { open, close, closeAll, isOpen, refresh, setTab, print, host, get: (id) => (P[id] ? handle(id) : null), get stack() { return stack.slice(); } };
})();
