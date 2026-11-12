/* 검색(공통 패널 — 처음 열 때 #cmdk 의 입력 · 결과 묶음을 패널 본문으로 옮긴다). 결과마다 해당 메뉴의 권한을 그대로 적용하고 대외비는 minRank로 한 번 더 막는다.
   신규 모듈은 SemisSearch.register 로 프로바이더를 등록한다.
   찾는 방식: 낱말마다 업무 동의어(SYN)까지 넓혀 보고, 한글 초성만 넣으면(ㅂㅇㄱㅇ) 제목 초성과 비교한다. 모든 낱말이 맞는 결과가 위,
   일부만 맞는 결과는 '일부만 맞는 결과'로 따로. 아무것도 없으면 아르고에게 그대로 묻게 넘긴다. */
"use strict";

const SemisSearch = (() => {
  const S = () => window.SeMIS;
  const D = () => S().data;
  const esc = (s) => S().esc(s);

  /* 프로바이더: { id, group, icon, module?, minRank?, items() => [{title, sub?, text?, route?, url?, pick?(검색어)}] }
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

  /* ── 업무 동의어 — 한 줄이 한 묶음. 낱말이 어느 묶음에 있으면 그 묶음 말 중 하나만 맞아도 맞은 것으로 본다(고치기 쉽게 여기 한 곳) ── */
  const SYN = [
    ["위험물", "dg", "dgr", "위험물품"],
    ["위기대응", "serp", "비상대응", "팀위기대응"],
    ["상용화주", "kc", "known consignor"],
    ["ra", "regulated agent", "보안검색 인가"],
    ["보안검색", "검색장비", "x-ray", "엑스레이"],
    ["엑스레이", "x-ray", "xray", "엑스선", "검색장비"],
    ["etd", "폭발물흔적탐지", "폭발물 흔적"],
    ["교육", "이수", "자격", "수료"],
    ["이수증", "수료증", "이수 기록", "교육 기록"],
    ["점검", "수검", "심사"],
    ["지적", "지적사항", "시정조치", "개선권고"],
    ["연락처", "연락망", "전화번호", "전화", "휴대폰", "핸드폰"],
    ["비상연락망", "비상망", "비상 연락"],
    ["규정", "지침", "매뉴얼", "절차서", "규칙"],
    ["ssop", "보안표준업무절차"],
    ["공문", "통보", "시행문"],
    ["회의", "회의록", "미팅"],
    ["일정", "스케줄", "행사"],
    ["순찰", "순찰일지", "패트롤"],
    ["보안요원", "경비대원", "경비원", "검색요원"],
    ["출입증", "보호구역", "출입"],
    ["위협전화", "협박전화", "테러 전화"],
    ["협력사", "협력업체", "조업사"],
    ["암호", "비밀번호", "패스워드"],
    ["운항", "항공기", "비행기", "화물기"],
    ["공지", "공지사항", "알림"],
    ["계약", "협약", "계약서"],
    ["보안등급", "항공보안등급"],
    ["기록부", "대장", "일지"],
    ["전파교육", "전파"],
    ["ssi", "민감보안정보"]
  ];
  const SYN_IDX = (() => {
    const m = {};
    SYN.forEach(g => g.forEach(w => { (m[w] = m[w] || []).push(g); }));
    return m;
  })();
  /* 짧은 영문 동의어(ra · kc · dg 등)는 낱말 경계에서만 — 다른 영문 낱말 속에 섞여 맞지 않게 */
  const boundaryOK = (s) => /^[a-z0-9-]{1,3}$/.test(s);
  function altsOf(t) {
    const out = [{ s: t, b: false }];
    const seen = { [t]: 1 };
    (SYN_IDX[t] || []).forEach(g => g.forEach(w => { if (!seen[w]) { seen[w] = 1; out.push({ s: w, b: boundaryOK(w) }); } }));
    return out;
  }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function has(hay, a) {
    if (!a.b) return hay.indexOf(a.s) >= 0;
    return new RegExp("(^|[^a-z0-9])" + reEsc(a.s) + "([^a-z0-9]|$)").test(hay);
  }

  /* ── 초성 — 검색어가 한글 자음만이면(2자 이상) 제목의 초성 줄과 비교 ── */
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const isCho = (t) => t.length >= 2 && /^[ㄱ-ㅎ]+$/.test(t);
  function choOf(s) {
    let o = "";
    for (const ch of String(s || "")) {
      const c = ch.charCodeAt(0);
      if (c >= 0xAC00 && c <= 0xD7A3) o += CHO[Math.floor((c - 0xAC00) / 588)];
      else if (/[ㄱ-ㅎ]/.test(ch)) o += ch;
    }
    return o;
  }

  function terms(q) {
    return String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  }
  function haystack(it) {
    const src = it.text != null ? it.text : [it.title, it.sub];
    return (Array.isArray(src) ? src : [src])
      .map(v => Array.isArray(v) ? v.join(" ") : v)
      .filter(v => v != null && v !== "").join(" \n ").toLowerCase();
  }
  /* 낱말별로 맞았는지 — { sc 점수, hit 맞은 낱말 수, full 모두 맞음 } | null */
  function scoreOf(it, ts) {
    const hay = haystack(it);
    const title = String(it.title || "").toLowerCase();
    let hit = 0, inTitle = 0, prefix = false;
    let choT = null;
    ts.forEach(t => {
      let m = false, mt = false;
      if (isCho(t)) {
        choT = choT == null ? choOf(it.title) : choT;
        m = mt = choT.indexOf(t) >= 0;
        if (m && choT.indexOf(t) === 0) prefix = true;
      } else {
        altsOf(t).forEach(a => {
          if (!m && has(hay, a)) m = true;
          if (!mt && has(title, a)) { mt = true; if (title.indexOf(a.s) === 0) prefix = true; }
        });
      }
      if (m) hit++;
      if (mt) inTitle++;
    });
    if (!hit) return null;
    const full = hit === ts.length;
    let sc = hit;
    if (inTitle) sc += 2;
    if (ts.length > 1 && inTitle === ts.length) sc += 2;   // 낱말이 모두 제목에 있으면 위로
    if (prefix) sc += 1;
    if (full) sc += 10;
    return { sc, hit, full };
  }
  function hl(s, ts) {
    s = String(s == null ? "" : s);
    const words = [];
    ts.forEach(t => { if (!isCho(t)) altsOf(t).forEach(a => { if (a.s.length > 1 || ts.length === 1) words.push(a.s); }); });
    if (!words.length) return esc(s);
    const re = new RegExp("(" + words.sort((a, b) => b.length - a.length).map(reEsc).join("|") + ")", "gi");
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
    ts.forEach(t => altsOf(t).forEach(a => { const i = low.indexOf(a.s); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }));
    if (idx <= 20) return s.slice(0, len) + "…";
    const start = Math.max(0, idx - 20);
    return "…" + s.slice(start, start + len) + "…";
  }

  /* 결과 종류 꼬리표 — 묶음 이름으로 정한다(새 프로바이더는 기본 '기록') */
  const KIND_OF = {
    "관련 문서": "문서", "규정": "규정", "게시판": "게시글", "일정관리": "일정", "회의록": "회의록",
    "비상연락망": "연락처", "업무 연락처": "연락처", "위기대응 담당자": "연락처", "접수 카운터": "접수", "아르고": "도우미"
  };
  function kindOf(it) {
    if (it.group === "메뉴 · 링크") return it.url ? "사이트" : "화면";
    return KIND_OF[it.group] || "기록";
  }
  const KIND_TONE = { "화면": "k-scr", "사이트": "k-scr", "문서": "k-doc", "규정": "k-doc", "일정": "k-cal", "연락처": "k-tel", "게시글": "k-bbs", "회의록": "k-bbs", "접수": "k-sup", "도우미": "k-sup" };

  const GROUP_MAX = 30, TOTAL_MAX = 300, PARTIAL_MAX = 8;
  /* 모든 낱말이 맞는 결과(full)와 일부만 맞는 결과(partial) */
  function searchAll(q) {
    const ts = terms(q);
    const u = S().user;
    const out = { full: [], partial: [] };
    if (!ts.length || !u || u.role === "signer") return out;
    const take = (list, group, hits, part, extra) => list.forEach(it => {
      if (!it || !it.title) return;
      const r = scoreOf(it, ts);
      if (!r) return;
      const row = Object.assign({ group, score: r.sc }, extra ? extra(it) : {}, it);
      if (r.full) hits.push(row); else if (ts.length > 1) part.push(row);
    });
    const part = [];

    /* 메뉴/링크는 검색 시점에 DATA.menus 를 직접 스캔. vendor는 허용 라우트 모듈 + vendorAccess.links 만 */
    const menuItems = [];
    if (isVendor()) {
      const routes = vendorRoutes();
      S().sortedMenus().forEach(mn => {
        if (!mn || mn.type !== "module" || routes.indexOf(mn.module) < 0) return;
        menuItems.push({ title: mn.label, sub: "화면으로 이동", route: mn.module });
      });
      (S().vendorAccess(u).links || []).forEach(l => menuItems.push({ title: l.label, sub: "새 창으로 열기", text: [l.label, l.url], url: l.url }));
    } else S().sortedMenus().forEach(mn => {
      if (!mn || mn.type === "group") return;
      if (!(S().navVisible ? S().navVisible(mn) : S().canSee(mn))) return;
      if (mn.type === "module" && mn.planned && !S().hasModule(mn.module) && !S().isAdmin()) return;   // 준비 중 메뉴는 시스템관리자만
      if (mn.type === "bundle") {
        const ms = S().bundleMembers(mn);
        if (ms[0]) menuItems.push({ title: mn.label, sub: ms.map(x => x.tab || x.label).join(" · "), route: ms[0].module, text: [mn.label].concat(ms.map(x => x.tab || x.label)) });
        return;
      }
      if (mn.type === "board") {
        const b = S().boardDef(mn.board);
        menuItems.push({ title: mn.label, sub: "게시판" + (b && b.desc ? " · " + b.desc : ""), route: "board/" + mn.board, text: [mn.label, b ? b.name : "", mn.board] });
        return;
      }
      const bd = mn.type === "module" && S().bundleOf ? S().bundleOf(mn) : null;
      const up = mn.parent ? S().sortedMenus().find(x => x && x.id === mn.parent && x.type === "link") : null;
      const way = mn.open === "group" ? "링크 모음" : mn.open === "frame" ? "내부 화면" : "새 창으로 열기";
      menuItems.push(mn.type === "module"
        ? { title: mn.label, sub: bd ? bd.label + " › " + (mn.tab || mn.label) : "화면으로 이동", route: mn.module, text: [mn.label, mn.tab || "", bd ? bd.label : ""] }
        : { title: mn.label, sub: (up ? up.label + " · " : "") + way, text: [mn.label, mn.url, up ? up.label : ""],
            route: mn.open === "group" ? "links/" + mn.id : mn.open === "frame" ? "embed/" + mn.id : "",
            url: (mn.open === "frame" || mn.open === "group") ? "" : mn.url });
    });
    const menuHits = [];
    take(menuItems, "메뉴 · 링크", menuHits, part);
    menuHits.sort((a, b) => b.score - a.score);
    out.full.push.apply(out.full, menuHits.slice(0, GROUP_MAX));

    providers.forEach(p => {
      if (!canUseProvider(p)) return;
      let items = [];
      try { items = p.items() || []; } catch (e) { items = []; }
      const hits = [];
      take(items, p.group, hits, part, (it) => ({ icon: it.icon || p.icon || "▪", ico: it.ico || p.ico || "", route: it.route != null ? it.route : (p.module || "dashboard") }));
      hits.sort((a, b) => b.score - a.score);
      out.full.push.apply(out.full, hits.slice(0, GROUP_MAX));
    });
    out.full = out.full.slice(0, TOTAL_MAX);
    out.partial = part.sort((a, b) => b.score - a.score).slice(0, PARTIAL_MAX);
    return out;
  }
  /* 모든 낱말이 맞는 결과(아르고 '찾기' 도구 · 테스트가 쓰는 기본 동작) */
  function search(q) { return searchAll(q).full; }

  const A = (v) => Array.isArray(v) ? v : [];

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

  /* ── 계정별 기억(이 브라우저) — 최근 검색어 5개 · 최근 연 화면. 검색어와 화면 이름만(결과 내용은 저장하지 않음) ── */
  const RQ_MAX = 5, RO_MAX = 12;
  const prefs = () => (S().navPrefs ? S().navPrefs() : {});
  const setPref = (p) => { if (S().setNavPref) S().setNavPref(p); };
  function recentQ() { return A(prefs().rq).filter(x => typeof x === "string" && x.trim()).slice(0, RQ_MAX); }
  function rememberQ(q) {
    q = String(q || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!q) return;
    setPref({ rq: [q].concat(recentQ().filter(x => x !== q)).slice(0, RQ_MAX) });
  }
  function forgetQ(q) { setPref({ rq: q == null ? [] : recentQ().filter(x => x !== q) }); }
  function recentOpen() { return A(prefs().ro).filter(x => x && typeof x.route === "string" && x.title).slice(0, RO_MAX); }
  function rememberOpen(route, title) {
    route = String(route || "");
    if (!route || route === "dashboard" || /^(sign|desk|argo)$/.test(route)) return;
    setPref({ ro: [{ route, title: String(title || "").slice(0, 60), at: Date.now() }].concat(recentOpen().filter(x => x.route !== route)).slice(0, RO_MAX) });
  }
  function whenOf(ms) {
    const d = new Date(Number(ms) || 0);
    if (isNaN(d)) return "";
    const p2 = (n) => String(n).padStart(2, "0");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (day <= 0) return "오늘 " + p2(d.getHours()) + ":" + p2(d.getMinutes());
    if (day === 1) return "어제";
    if (day < 7) return day + "일 전";
    return (d.getMonth() + 1) + "." + d.getDate();
  }
  /* 지금도 열 수 있는 화면만(권한 · 숨김이 바뀌었을 수 있다) */
  function routeOK(route) {
    const r = String(route || "");
    if (isVendor()) return vendorRoutes().indexOf(r) >= 0;
    const bm = /^board\/(B\d{3})/.exec(r);
    if (bm) return !!S().canReadBoard(S().boardDef(bm[1]));
    if (/^(embed|links)\//.test(r)) { const mn = (D().menus || []).find(m => m && m.id === r.slice(6)); return !!mn && S().navVisible(mn); }
    const mn = S().menuForModule(r);
    return !!mn && S().navVisible(mn) && S().hasModule(r);
  }

  /* 자주 찾는 것 — 보이는 화면만 다섯 개까지 */
  const FAVS = [["contacts", "비상연락망"], ["schedule", "이번 달 일정"], ["training", "교육 · 자격"], ["reg-sec", "항공보안 규정"],
    ["phonebook", "업무 연락처"], ["board/B001", "공지사항"], ["flight", "운항 현황"], ["shortcuts", "외부 사이트"]];
  function favItems() { return FAVS.filter(f => routeOK(f[0])).slice(0, 5); }

  let pop = null, input = null, wrap = null, items = [], active = -1, lastQ = null;
  let kindFilter = "", openGroups = {}, showMenus = false;
  const PID = "search";
  const isOpen = () => !!(window.SemisPanel && SemisPanel.isOpen(PID));

  /* 공통 패널로 연다 — 자주 쓰는 키보드 동작이라 입력칸에 바로 포커스 */
  function openPalette(q) {
    const u = S().user;
    if (!u || u.role === "signer" || !wrap) return;
    if (S().closeOverlays) S().closeOverlays();
    if (!isOpen()) S().ui.panel({ id: PID, title: "검색", sub: "화면 · 문서 · 사람 · 일정을 한 번에", icon: "search", body: wrap, focus: "#hdr-search", cls: "pnl-search" });
    if (typeof q === "string" && input) input.value = q;
    if (input) { input.focus(); if (typeof q !== "string") input.select(); }
    renderPop(input ? input.value : "");
  }
  function closePalette() {
    if (window.SemisPanel) SemisPanel.close(PID);
  }
  function goItem(it) {
    if (lastQ && terms(lastQ).length) rememberQ(lastQ);
    closePalette();
    if (it.url) { window.open(it.url, "_blank", "noopener"); return; }
    if (typeof it.pick === "function") { try { it.pick(lastQ || ""); } catch (e) { /* 화면 상태 지정 실패는 이동만 */ } }
    if (it.route) S().navigate(it.route);
  }
  /* 결과 없음 → 아르고에게 같은 말로 묻기 */
  function askArgo(q) {
    q = String(q || "").trim();
    if (!q || !(S().supportOk && S().supportOk("argo"))) return;
    rememberQ(q);
    closePalette();
    setTimeout(() => {
      if (window.SemisArgo && SemisArgo.ask) SemisArgo.ask(q);
      else if (S().openSupport) S().openSupport("argo");
    }, 0);
  }

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

  /* ── 그리기 ── */
  const act = (it) => (it.url ? "새 창" : "열기");
  function rowHTML(it, i, ts) {
    const k = it.kind || kindOf(it);
    return '<button type="button" class="sp-item" data-i="' + i + '">' +
      '<span class="sp-kind ' + (KIND_TONE[k] || "") + '">' + esc(k) + "</span>" +
      '<span class="sp-txt"><span class="sp-title">' + hl(it.title, ts) + "</span>" +
      (it.sub ? '<span class="sp-sub">' + hl(snip(it.sub, ts), ts) + "</span>" : "") +
      '</span><span class="sp-act" aria-hidden="true">' + act(it) + S().icon("chevron", 15) + "</span></button>";
  }
  /* 묶음별 — 처음 4건, 넘으면 'N건 더 보기' */
  const SHOW = 4;
  function groupsHTML(list, ts, start, all) {
    let html = "", i = start;
    const groups = [];
    list.forEach(it => { let g = groups.find(x => x.name === it.group); if (!g) groups.push(g = { name: it.group, rows: [] }); g.rows.push(it); });
    groups.forEach(g => {
      const open = all || openGroups[g.name];
      const rows = open ? g.rows : g.rows.slice(0, SHOW);
      html += '<div class="sp-group">' + esc(g.name) + (g.rows.length > 1 ? ' <small>' + g.rows.length + "</small>" : "") + "</div>";
      rows.forEach(it => { items.push(it); html += rowHTML(it, i++, ts); });
      if (!open && g.rows.length > SHOW) html += '<button type="button" class="sp-more" data-more="' + esc(g.name) + '">' + esc(g.name) + " " + (g.rows.length - SHOW) + "건 더 보기" + S().icon("chevdown", 15) + "</button>";
    });
    return html;
  }
  function chipsHTML(full) {
    const cnt = {};
    full.forEach(it => { const k = kindOf(it); cnt[k] = (cnt[k] || 0) + 1; });
    const ks = Object.keys(cnt);
    if (ks.length < 2) return "";
    return '<div class="sp-kinds" role="group" aria-label="결과 종류">' +
      [["", "전체", full.length]].concat(ks.map(k => [k, k, cnt[k]])).map(([v, lb, n]) =>
        '<button type="button" class="sp-kchip" data-kind="' + esc(v) + '" aria-pressed="' + (kindFilter === v) + '">' + esc(lb) + " <b>" + n + "</b></button>").join("") + "</div>";
  }
  function tryWords(q, ts) {
    const out = [];
    const add = (w) => { w = String(w || "").trim(); if (w && w !== q.trim() && out.indexOf(w) < 0) out.push(w); };
    if (ts.length > 1) { ts.forEach(add); if (ts.length > 2) add(ts.slice(0, 2).join(" ")); }
    else if (ts.length === 1 && !isCho(ts[0])) altsOf(ts[0]).slice(1, 4).forEach(a => add(a.s));
    return out.slice(0, 5);
  }
  function emptyHTML(q, ts, partial) {
    const argo = !!(S().supportOk && S().supportOk("argo"));
    const tw = tryWords(q, ts);
    let html = '<div class="sp-none"><p class="sp-none-t">딱 맞는 결과가 없습니다</p>' +
      '<p class="sp-none-s">' + (argo ? "단어를 줄이거나, 아르고에게 그대로 물어보세요." : "단어를 줄이거나 다른 말로 찾아보세요.") + "</p>" +
      (argo ? '<div class="sp-ask"><span class="sp-ask-owl" aria-hidden="true"></span><span class="sp-ask-t"><b>아르고에게 물어보기</b><span>“' + esc(q.trim()) + '”</span></span>' +
        '<button type="button" class="sp-ask-b" data-ask>물어보기' + S().icon("chevron", 16) + "</button></div>" : "") +
      (tw.length ? '<div class="sp-try"><span>이렇게도 찾아보세요</span>' + tw.map(w => '<button type="button" class="sp-chip" data-q="' + esc(w) + '">' + esc(w) + "</button>").join("") + "</div>" : "") +
      "</div>";
    if (partial.length) html += groupsHTML(partial.map(it => Object.assign({}, it, { kind: kindOf(it), group: "일부만 맞는 결과" })), ts, items.length, true);
    return html;
  }
  function homeHTML() {
    let html = "";
    if (!isVendor()) {
      const fv = favItems();
      if (fv.length) html += '<div class="sp-sec"><div class="sp-sec-h">자주 찾는 것</div><div class="sp-chips">' +
        fv.map(f => '<button type="button" class="sp-chip is-go" data-go="' + esc(f[0]) + '">' + esc(f[1]) + "</button>").join("") + "</div></div>";
    }
    const rq = recentQ();
    if (rq.length) html += '<div class="sp-sec"><div class="sp-sec-h">최근 검색어<button type="button" class="link-btn sp-clear" data-rq-clear>모두 지우기</button></div><div class="sp-chips">' +
      rq.map(w => '<span class="sp-chip is-q"><button type="button" class="sp-chip-b" data-q="' + esc(w) + '">' + esc(w) + '</button><button type="button" class="sp-chip-x" data-rq-x="' + esc(w) + '" aria-label="' + esc(w) + ' 지우기">' + S().icon("x", 13) + "</button></span>").join("") + "</div></div>";
    const ro = recentOpen().filter(x => routeOK(x.route)).slice(0, 5);
    if (ro.length) {
      html += '<div class="sp-sec"><div class="sp-sec-h">최근 연 화면</div></div>';
      ro.forEach(x => { const it = { group: "최근 연 화면", title: x.title, sub: whenOf(x.at), route: x.route, kind: "화면" }; html += rowHTML(it, items.length, []); items.push(it); });
    }
    const hm = homeItems();
    if (hm.length) {
      html += '<div class="sp-sec"><button type="button" class="sp-menus" data-menus aria-expanded="' + showMenus + '">' + S().icon(showMenus ? "chevup" : "chevdown", 16) + "<span>전체 메뉴 보기</span><small>" + hm.length + "</small></button></div>";
      if (showMenus || (!ro.length && !rq.length && isVendor())) {
        let last = null;
        hm.forEach(it => {
          if (it.group !== last) { html += '<div class="sp-group">' + esc(it.group) + "</div>"; last = it.group; }
          html += rowHTML(Object.assign({ kind: "화면" }, it), items.length, []);
          items.push(it);
        });
      }
    }
    return html;
  }
  function renderPop(q) {
    if (!pop) return;
    const u = S().user;
    if (!u || u.role === "signer") { pop.innerHTML = ""; return; }
    const qs = String(q == null ? "" : q);
    if (qs !== lastQ) { kindFilter = ""; openGroups = {}; }
    const ts = terms(qs);
    active = -1;
    lastQ = qs;
    items = [];
    if (!ts.length) {
      pop.innerHTML = '<p class="sr-only" aria-live="polite"></p>' + homeHTML();
    } else {
      const r = searchAll(qs);
      if (!r.full.length) {
        pop.innerHTML = '<p class="sr-only" aria-live="polite">맞는 결과 없음' + (r.partial.length ? " · 일부만 맞는 결과 " + r.partial.length + "건" : "") + "</p>" + emptyHTML(qs, ts, r.partial);
        const ow = pop.querySelector(".sp-ask-owl");
        if (ow && window.SemisOwl) ow.innerHTML = SemisOwl.svg("thinking", 40);
      } else {
        const list = kindFilter ? r.full.filter(it => kindOf(it) === kindFilter) : r.full;
        pop.innerHTML = '<p class="sr-only" aria-live="polite">' + r.full.length + "건</p>" + chipsHTML(r.full) +
          groupsHTML(list, ts, 0, !!kindFilter) +
          (r.partial.length && !kindFilter ? groupsHTML(r.partial.map(it => Object.assign({}, it, { group: "일부만 맞는 결과" })), ts, items.length, false) : "");
      }
    }
    wirePop();
  }
  function wirePop() {
    Array.prototype.forEach.call(pop.querySelectorAll(".sp-item"), el => {
      el.onclick = () => goItem(items[Number(el.dataset.i)]);
    });
    pop.querySelectorAll("[data-more]").forEach(b => { b.onclick = () => { openGroups[b.dataset.more] = true; renderPop(lastQ); }; });
    pop.querySelectorAll("[data-kind]").forEach(b => { b.onclick = () => { kindFilter = b.dataset.kind; const q0 = lastQ; renderPop(q0); }; });
    pop.querySelectorAll("[data-q]").forEach(b => { b.onclick = () => { if (input) { input.value = b.dataset.q; input.focus(); } renderPop(b.dataset.q); }; });
    pop.querySelectorAll("[data-go]").forEach(b => { b.onclick = () => { closePalette(); S().navigate(b.dataset.go); }; });
    pop.querySelectorAll("[data-rq-x]").forEach(b => { b.onclick = () => { forgetQ(b.dataset.rqX); renderPop(""); if (input) input.focus(); }; });
    pop.querySelectorAll("[data-rq-clear]").forEach(b => { b.onclick = () => { forgetQ(null); renderPop(""); if (input) input.focus(); }; });
    pop.querySelectorAll("[data-menus]").forEach(b => { b.onclick = () => { showMenus = !showMenus; renderPop(""); const nb = pop.querySelector("[data-menus]"); if (nb) nb.focus(); }; });
    pop.querySelectorAll("[data-ask]").forEach(b => { b.onclick = () => askArgo(lastQ); });
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
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        if (input.value !== lastQ) { clearTimeout(debTimer); renderPop(input.value); }
        const els = pop.querySelectorAll(".sp-item");
        if (active >= 0 && els[active]) goItem(items[Number(els[active].dataset.i)]);
        else if (terms(input.value).length && els.length && !pop.querySelector(".sp-none")) goItem(items[Number(els[0].dataset.i)]);
        else if (terms(input.value).length && pop.querySelector("[data-ask]")) askArgo(input.value);
      } else if (e.key === "Escape") {      // 검색칸의 기본 동작(글자 지우기) 대신 바로 닫는다
        e.preventDefault(); e.stopPropagation(); closePalette();
      }
    });

    document.addEventListener("keydown", (e) => {
      const u = S().user;
      if (!u || u.role === "signer") return;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") ||
        (e.target && e.target.isContentEditable);
      if (((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "k") || (!inField && e.key === "/")) {
        e.preventDefault();
        openPalette();
      }
    });

    /* 입구 단추([data-sup="search"])는 코어가 위임으로 연결한다 */
    if (S().registerSupport) S().registerSupport("search", { open: openPalette });
  }

  return { init, search, searchAll, register, terms, open: openPalette, close: closePalette, isOpen, homeItems, ask: askArgo,
    rememberOpen, recentOpen, recentQ, rememberQ, forgetQ, kindOf, choOf, altsOf, SYN };
})();

if (typeof window !== "undefined") {
  window.SemisSearch = SemisSearch;
  /* search.js 보다 먼저 읽힌 파일(문서 서가 · 규정)이 맡겨 둔 프로바이더 */
  (window.__semisSearchQ || []).splice(0).forEach(p => SemisSearch.register(p));
}
