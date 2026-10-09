/* 전역 통합 검색(공통 패널 — 처음 열 때 #cmdk 의 입력 · 결과 묶음을 패널 본문으로 옮긴다). 결과마다 해당 메뉴의 권한을 그대로 적용하고 대외비는 minRank로 한 번 더 막는다.
   신규 모듈은 SemisSearch.register 로 프로바이더를 등록한다. */
"use strict";

const SemisSearch = (() => {
  const S = () => window.SeMIS;
  const D = () => S().data;
  const esc = (s) => S().esc(s);

  /* 프로바이더: { id, group, icon, module?, minRank?, items() => [{title, sub?, text?, route?, url?}] }
     module = 권한 게이트(해당 모듈 메뉴의 vis) + 기본 이동 라우트, minRank = 추가 권한 하한, text = 검색 대상(없으면 title+sub) */
  const providers = [];
  function register(p) {
    if (!p || !p.id || typeof p.items !== "function") return;
    const i = providers.findIndex(x => x.id === p.id);
    if (i >= 0) providers[i] = p; else providers.push(p);
  }

  const isVendor = () => !!(S().user && S().user.role === "vendor");
  function vendorRoutes() {
    try { return S().vendorAccess(S().user).routes || []; } catch (e) { return []; }
  }
  function canUseProvider(p) {
    if (isVendor()) {
      // 협력업체: 허용 라우트의 모듈만. 데이터 격리는 각 프로바이더의 격리 뷰가 맡는다.
      // 대외비(minRank 3+)는 confid 없는 업체(제조사·기술지원)에 검색으로도 열지 않는다.
      if (p.minRank >= 3 && S().canConfid && !S().canConfid()) return false;
      return !!(p.module && vendorRoutes().indexOf(p.module) >= 0);
    }
    const rank = S().roleRank();
    if (p.minRank && rank < p.minRank) return false;
    if (p.module) {
      const mn = (D().menus || []).find(m => m && m.type === "module" && m.module === p.module);
      if (mn) return S().navVisible ? S().navVisible(mn) : S().canSee(mn);   // 숨긴 메뉴도 제외
      return rank >= 4; // 메뉴가 제거된 모듈은 관리자만
    }
    return true;
  }

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function terms(q) {
    return String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  }
  function haystack(it) {
    const src = it.text != null ? it.text : [it.title, it.sub];
    return (Array.isArray(src) ? src : [src])
      .map(v => Array.isArray(v) ? v.join(" ") : v)
      .filter(v => v != null && v !== "").join(" \n ").toLowerCase();
  }
  function scoreOf(it, ts) {
    const hay = haystack(it);
    if (!ts.every(t => hay.indexOf(t) >= 0)) return 0;
    const title = String(it.title || "").toLowerCase();
    let sc = 1;
    if (ts.some(t => title.indexOf(t) >= 0)) sc += 2;
    if (ts.length > 1 && ts.every(t => title.indexOf(t) >= 0)) sc += 2;   // 검색어가 모두 제목에 있으면 위로
    if (ts.some(t => title.indexOf(t) === 0)) sc += 1;
    return sc;
  }
  function hl(s, ts) {
    s = String(s == null ? "" : s);
    if (!ts.length) return esc(s);
    const re = new RegExp("(" + ts.map(reEsc).join("|") + ")", "gi");
    return s.split(re).map((part, i) =>
      i % 2 ? '<b class="sp-hl">' + esc(part) + "</b>" : esc(part)).join("");
  }
  /* 매칭 지점 주변만 발췌 */
  function snip(s, ts, len) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    len = len || 64;
    if (s.length <= len) return s;
    const low = s.toLowerCase();
    let idx = -1;
    ts.forEach(t => { const i = low.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; });
    if (idx <= 20) return s.slice(0, len) + "…";
    const start = Math.max(0, idx - 20);
    return "…" + s.slice(start, start + len) + "…";
  }

  const PER_GROUP = 8, TOTAL_MAX = 60;
  function search(q) {
    const ts = terms(q);
    const u = S().user;
    if (!ts.length || !u || u.role === "signer") return [];
    const out = [];

    /* 메뉴/링크는 검색 시점에 DATA.menus 를 직접 스캔. vendor는 허용 라우트 모듈 + vendorAccess.links 만 */
    const menuHits = [];
    if (isVendor()) {
      const routes = vendorRoutes();
      S().sortedMenus().forEach(mn => {
        if (!mn || mn.type !== "module" || routes.indexOf(mn.module) < 0) return;
        const it = { title: mn.label, sub: "메뉴로 이동", icon: mn.icon || "▪", route: mn.module };
        const sc = scoreOf(it, ts);
        if (sc) menuHits.push(Object.assign({ group: "메뉴 · 링크", score: sc }, it));
      });
      (S().vendorAccess(u).links || []).forEach(l => {
        const it = { title: l.label, sub: "새 탭으로 열기", icon: l.icon || "🔗",
          text: [l.label, l.url], url: l.url };
        const sc = scoreOf(it, ts);
        if (sc) menuHits.push(Object.assign({ group: "메뉴 · 링크", score: sc }, it));
      });
    } else S().sortedMenus().forEach(mn => {
      if (!mn || mn.type === "group") return;
      if (!(S().navVisible ? S().navVisible(mn) : S().canSee(mn))) return;
      if (mn.type === "bundle") {
        const ms = S().bundleMembers(mn);
        const it = { title: mn.label, sub: ms.map(x => x.tab || x.label).join(" · "), icon: "▤", route: ms[0] ? ms[0].module : "",
          text: [mn.label].concat(ms.map(x => x.tab || x.label)) };
        const sc = scoreOf(it, ts);
        if (sc && it.route) menuHits.push(Object.assign({ group: "메뉴 · 링크", score: sc }, it));
        return;
      }
      const bd = mn.type === "module" && S().bundleOf ? S().bundleOf(mn) : null;
      const up = mn.parent ? S().sortedMenus().find(x => x && x.id === mn.parent && x.type === "link") : null;
      const way = mn.open === "group" ? "링크 모음 열기" : mn.open === "frame" ? "내부 화면으로 열기" : "새 탭으로 열기";
      const it = mn.type === "module"
        ? { title: mn.label, sub: bd ? bd.label + " · 메뉴로 이동" : "메뉴로 이동", icon: mn.icon || "▪", route: mn.module,
            text: [mn.label, mn.tab || "", bd ? bd.label : ""] }
        : { title: mn.label, sub: (up ? up.label + " · " : "") + way,
            icon: mn.icon || (mn.open === "group" ? "🗂" : "🔗"), text: [mn.label, mn.url, up ? up.label : ""],
            route: mn.open === "group" ? "links/" + mn.id : mn.open === "frame" ? "embed/" + mn.id : "",
            url: (mn.open === "frame" || mn.open === "group") ? "" : mn.url };
      const sc = scoreOf(it, ts);
      if (sc) menuHits.push(Object.assign({ group: "메뉴 · 링크", score: sc }, it));
    });
    menuHits.sort((a, b) => b.score - a.score);
    out.push.apply(out, menuHits.slice(0, PER_GROUP));

    providers.forEach(p => {
      if (!canUseProvider(p)) return;
      let items = [];
      try { items = p.items() || []; } catch (e) { items = []; }
      const hits = [];
      items.forEach(it => {
        if (!it || !it.title) return;
        const sc = scoreOf(it, ts);
        if (sc) hits.push(Object.assign({
          group: p.group, icon: it.icon || p.icon || "▪", ico: it.ico || p.ico || "", score: sc,
          route: it.route != null ? it.route : (p.module || "dashboard")
        }, it));
      });
      hits.sort((a, b) => b.score - a.score);
      out.push.apply(out, hits.slice(0, PER_GROUP));
    });
    return out.slice(0, TOTAL_MAX);
  }

  const A = (v) => Array.isArray(v) ? v : [];

  register({ id: "notices", group: "공지사항", icon: "📢", module: "dashboard",
    items: () => A(D().notices).map(n => ({
      title: n.title, sub: n.body, text: [n.title, n.body, n.author], route: "dashboard" })) });

  register({ id: "levels", group: "보안등급", icon: "🚨", module: "dashboard",
    items: () => A(D().levelHistory).map(e => ({
      title: "[" + e.level + "] " + (e.date || ""), sub: e.note || "",
      text: [e.level, e.note, e.date], route: "dashboard" })) });

  register({ id: "schedules", group: "일정관리", icon: "📅", module: "schedule",
    // 다른 계정의 "나에게만 보이기" 일정 제외
    items: () => A(D().schedules).filter(s =>
      !window.SemisCalendar || SemisCalendar.canSeePriv(s)).map(s => ({
      title: s.title, sub: [s.start + (s.end && s.end !== s.start ? "~" + s.end : ""), s.assignee, s.memo].filter(Boolean).join(" · "),
      text: [s.title, s.memo, s.assignee] })) });

  /* 열람 제한 우회 방지: 모듈의 열람 판정(visibleAll)을 그대로 쓴다 */
  register({ id: "minutes", group: "회의록", icon: "🗒️", module: "minutes",
    items: () => (window.SemisMinutes ? SemisMinutes.visibleAll() : A(D().minutes)).map(x => {
      const fn = window.SemisMinutes ? SemisMinutes.folderName(x.folder) : "";
      return {
        title: x.title || "(제목 없음)",
        sub: [fn, x.date, x.place].filter(Boolean).join(" · "),
        text: [x.title, fn, x.date, x.place, x.chair, x.scribe, x.agenda, x.body,
          A(x.tags).join(" "),
          A(x.attendees).map(a => [a.name, a.org, a.role].join(" ")).join(" "),
          A(x.decisions).map(d => [d.task, d.owner].join(" ")).join(" ")],
        route: "minutes" };
    }) });

  register({ id: "contacts", group: "비상연락망", icon: "☎️", module: "contacts",
    items: () => {
      const outc = [];
      const secsArr = (D().contacts && A(D().contacts.sections)) || [];
      secsArr.forEach(sec => A(sec.rows).forEach(r => {
        if (sec.type === "people") outc.push({
          title: (r.name || "") + (r.role ? " · " + r.role : ""),
          sub: [r.mobile, r.office, r.duty].filter(Boolean).join(" · "),
          text: [r.name, r.role, r.mobile, r.office, r.duty, r.note, sec.title] });
        else if (sec.type === "emails") outc.push({
          title: r.name || r.email || "", sub: r.email || "", text: [r.name, r.email, sec.title] });
        else if (sec.type === "procedure") outc.push({
          title: r.title || sec.title || "", sub: r.body || "", text: [r.title, r.body, sec.title] });
        else outc.push({
          title: r.items || sec.title || "", sub: r.to || "", text: [r.no, r.items, r.to, sec.title] });
      }));
      // 보고 체계도(사고 유형별) — 체계도 자체 + 연락처 행
      A(D().contacts && D().contacts.flows).forEach(f => {
        outc.push({ title: f.title || "보고 체계도", sub: "보고 체계도" + (f.ver ? " · Ver." + f.ver : ""),
          text: [f.title, f.short, "보고 체계도", f.steps] });
        A(f.rows).forEach(r => outc.push({
          title: (r.role || "") + (f.short ? " · " + f.short : ""),
          sub: [r.office, r.mobile, r.note].filter(Boolean).join(" · "),
          text: [r.role, r.grp, r.office, r.mobile, r.note, f.title, f.short] }));
      });
      return outc;
    } });

  /* 프로바이더는 ico 키로 선 아이콘을 지정할 수 있다 */
  const GROUP_ICO = { "공지사항": "megaphone", "보안등급": "alert", "일정관리": "calendar", "회의록": "notes",
    "비상연락망": "phone", "위기대응 담당자": "users", "규정": "book", "메뉴 · 링크": "chevron" };
  function icoOf(it) {
    const k = it.ico || (it.url ? "external" : GROUP_ICO[it.group]) || "doc";
    return S().icon ? S().icon(k, 18) : esc(it.icon || "▪");
  }
  let pop = null, input = null, wrap = null, items = [], active = -1, lastQ = null;
  const PID = "search";
  const isOpen = () => !!(window.SemisPanel && SemisPanel.isOpen(PID));

  /* 공통 패널로 연다 — 자주 쓰는 키보드 동작이라 입력칸에 바로 포커스 */
  function openPalette() {
    const u = S().user;
    if (!u || u.role === "signer" || !wrap) return;
    if (S().closeOverlays) S().closeOverlays();
    if (!isOpen()) S().ui.panel({ id: PID, title: "통합 검색", icon: "search", body: wrap, focus: "#hdr-search", cls: "pnl-search" });
    if (input) { input.focus(); input.select(); }
    renderPop(input ? input.value : "");
  }
  function closePalette() {
    if (window.SemisPanel) SemisPanel.close(PID);
  }
  function goItem(it) {
    closePalette();
    if (it.url) { window.open(it.url, "_blank", "noopener"); return; }
    if (typeof it.pick === "function") { try { it.pick(); } catch (e) { /* 화면 상태 지정 실패는 이동만 */ } }
    if (it.route) S().navigate(it.route);
  }
  function closePop() { active = -1; }

  /* 검색어가 없을 때 — 보이는 메뉴를 허브별로(바로 이동) */
  function homeItems() {
    const u = S().user, out = [];
    if (!u || u.role === "signer") return out;
    if (isVendor()) {
      vendorRoutes().forEach(r => {
        const mn = S().menuForModule(r);
        if (mn && !S().menuHidden(mn)) out.push({ group: "메뉴", title: mn.label, route: r, ico: "chevron" });
      });
      return out;
    }
    (S().hubList ? S().hubList() : []).forEach(g => {
      S().hubEntries(g.id).forEach(m => {
        if (m.type === "bundle") {
          const ms = S().bundleMembers(m);
          if (ms[0]) out.push({ group: g.label, title: m.label, sub: ms.map(x => x.tab || x.label).join(" · "), route: ms[0].module, ico: "chevron" });
        } else if (m.type === "module" && !(m.planned && !S().hasModule(m.module))) {
          out.push({ group: g.label, title: m.label, route: m.module, ico: "chevron" });
        }
      });
    });
    return out;
  }
  function listHTML(list, ts) {
    let html = "", lastGroup = null;
    list.forEach((it, i) => {
      if (it.group !== lastGroup) { html += '<div class="sp-group">' + esc(it.group) + "</div>"; lastGroup = it.group; }
      html += '<button type="button" class="sp-item" data-i="' + i + '">' +
        '<span class="sp-ico">' + icoOf(it) + "</span>" +
        '<span class="sp-txt"><span class="sp-title">' + hl(it.title, ts) + "</span>" +
        (it.sub ? '<span class="sp-sub">' + hl(snip(it.sub, ts), ts) + "</span>" : "") +
        "</span></button>";
    });
    return html;
  }
  function renderPop(q) {
    if (!pop) return;
    const u = S().user;
    if (!u || u.role === "signer") { pop.innerHTML = ""; return; }
    const ts = terms(q);
    active = -1;
    lastQ = String(q == null ? "" : q);
    if (!ts.length) {
      items = homeItems();
      pop.innerHTML = '<p class="sr-only" aria-live="polite"></p>' + listHTML(items, []);
    } else {
      items = search(q);
      if (!items.length) {
        pop.innerHTML = '<div class="sp-empty"><span class="sp-owl"></span><p>"' + esc(q.trim()) + '" 검색 결과가 없습니다.</p></div>' +
          '<p class="sr-only" aria-live="polite">검색 결과 없음</p>';
        const ow = pop.querySelector(".sp-owl");
        if (ow && window.SemisOwl) SemisOwl.mount(ow, { size: 88, state: "thinking" });
        return;
      }
      pop.innerHTML = '<p class="sr-only" aria-live="polite">' + items.length + "건</p>" + listHTML(items, ts);
    }
    Array.prototype.forEach.call(pop.querySelectorAll(".sp-item"), el => {
      el.onclick = () => goItem(items[Number(el.dataset.i)]);
    });
  }

  function setActive(n) {
    const els = pop ? pop.querySelectorAll(".sp-item") : [];
    if (!els.length) return;
    active = (n + els.length) % els.length;
    Array.prototype.forEach.call(els, (el, i) => el.classList.toggle("active", i === active));
    els[active].scrollIntoView({ block: "nearest" });
  }

  let debTimer = null;
  function init() {
    wrap = document.getElementById("hdr-search-wrap");
    input = document.getElementById("hdr-search");
    pop = document.getElementById("hdr-search-pop");
    if (!wrap || !input || !pop) return;

    input.addEventListener("input", () => {
      clearTimeout(debTimer);
      debTimer = setTimeout(() => renderPop(input.value), 120);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (input.value !== lastQ) { clearTimeout(debTimer); renderPop(input.value); }
        if (active >= 0 && items[active]) goItem(items[active]);
        else if (terms(input.value).length && items.length) goItem(items[0]);
      } else if (e.key === "Escape") {      // 검색칸의 기본 동작(글자 지우기) 대신 바로 닫는다
        e.preventDefault(); e.stopPropagation(); closePalette();
      }
    });

    document.addEventListener("keydown", (e) => {
      const u = S().user;
      if (!u || u.role === "signer") return;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") ||
        (e.target && e.target.isContentEditable);
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (!inField && e.key === "/")) {
        e.preventDefault();
        openPalette();
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-search-open]"), b =>
      b.addEventListener("click", openPalette));
    if (S().registerSupport) S().registerSupport("search", { open: openPalette });
  }

  return { init, search, register, terms, open: openPalette, close: closePalette, isOpen, homeItems };
})();

if (typeof window !== "undefined") window.SemisSearch = SemisSearch;
