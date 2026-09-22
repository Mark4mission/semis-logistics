/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — Core Engine
   인천화물팀 안전보안파트 · 화물터미널 안전보안 관리 정보시스템
   인증 · 저장소 · 메뉴 엔진 · 권한 · 라우터
   (SeMIS v2 코어를 이어받아 데이터·메뉴·팔레트를 독립 구성)
   ═══════════════════════════════════════════════════════ */
"use strict";

const SeMIS = (() => {

  const VERSION = "1.12.0";
  const APP_NAME = "SeMIS · Logistics";
  const LS_DATA = "semisl:data";
  const LS_UI   = "semisl:ui";
  const SS_SESSION = "semisl:session";
  /* SeMIS v2와 동일한 SALT — 시스템관리자(mark3464)가 같은 암호로 두 시스템에 접속할 수 있도록.
     (해시만 보관하므로 평문 노출 없음) */
  const SALT = "SeMISv2:";

  /* ─────────── SHA-256 (pure JS, 동기, 어디서나 동작) ─────────── */
  function sha256(str) {
    const msg = unescape(encodeURIComponent(str));
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const l = msg.length;
    const w = [];
    for (let i = 0; i < l; i++) w[i >> 2] = (w[i >> 2] || 0) | (msg.charCodeAt(i) << (24 - (i % 4) * 8));
    w[l >> 2] = (w[l >> 2] || 0) | (0x80 << (24 - (l % 4) * 8));
    const wlen = ((((l + 8) >> 6) + 1) << 4);
    for (let i = w.length; i < wlen; i++) w[i] = 0;
    w[wlen - 1] = (l * 8) >>> 0;
    w[wlen - 2] = Math.floor((l * 8) / 4294967296);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let j = 0; j < wlen; j += 16) {
      const W = w.slice(j, j + 16);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i-15],7) ^ rotr(W[i-15],18) ^ (W[i-15] >>> 3);
        const s1 = rotr(W[i-2],17) ^ rotr(W[i-2],19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
      }
      let [a,b,c,d,e,f,g,hh] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + W[i]) | 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [ (H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+hh)|0 ];
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  const pwHash = (pw) => sha256(SALT + ":" + pw);

  /* ─────────── 기본 사용자 (암호는 해시로만 보관 — 평문 미노출) ─────────── */
  const BASE_USERS = [
    { id: "mark3464",   name: "시스템관리자",  role: "admin",
      hash: "e656cd08712ab870c57a6d483f57f88cae49bcd541ec9bb862e412670c23f389" },
    { id: "cargo-ss",   name: "안전보안파트",  role: "hq",
      hash: "540a1c3facaa070d9713f09447a7572762a965d90cd36057c8048fe51a96b838" },
    { id: "cargo-mgr",  name: "화물팀 관리자", role: "manager",
      hash: "d7435a8f2a56646e8e50d95c0e3f4ce2b6c74aae4a1fcd656d51fe7a2e5388f7" },
    { id: "cargo-user", name: "화물팀 사용자", role: "user",
      hash: "75a172158dc9392f64f2b9fe2aa7c7cd122be590f6255eafb60e45f41a48de17" }
  ];
  const ROLE_LABEL = { admin: "시스템관리자", hq: "안전보안파트", manager: "화물팀 관리자", user: "일반사용자", vendor: "협력업체", signer: "서명 참석자" };
  /* 권한 서열: admin(4) > hq(3) > manager(2) > user(1)
     - admin:   모든 기능 + 시스템 설정
     - hq:      안전보안파트원 — 시스템 설정 외 모든 기능(편집 포함)
     - manager: 화물팀 관리자·현장 감독자 — 관리 항목 열람, 편집 불가
     - user:    화물팀 직원·조업사 — 일반·안내 수준만 열람
     - vendor:  협력업체 — 업체별 허용 라우트만 (VENDOR_ACCESS), edit:true면 그 안에서 hq 동등
     - signer:  회의록 참석 서명 전용 세션 (QR / 6자리 코드) */
  const ROLE_RANK  = { admin: 4, hq: 3, manager: 2, user: 1, vendor: 1, signer: 0 };

  /* ─────── 협력업체(vendor) 접근 범위 — 업체명별 화이트리스트 ───────
     초기에는 비어 있음. 조업사·유지보수 업체 계정을 만들 때 여기에 한 줄 추가하면 된다.
     예) "○○조업": { routes: ["contacts"], links: [], edit: false, confid: false } */
  const VENDOR_ACCESS = {};
  const VENDOR_DEFAULT = { routes: ["dashboard"], links: [], edit: false, confid: false };
  const normVendorKey = (s) => String(s || "").replace(/[\s㈜()]|주식회사/g, "").toLowerCase();
  function vendorAccess(u) {
    const raw = String((u && u.vendor) || "").trim();
    let a = VENDOR_ACCESS[raw];
    if (!a && raw) {
      const key = Object.keys(VENDOR_ACCESS).find(k => normVendorKey(k) === normVendorKey(raw));
      if (key) a = VENDOR_ACCESS[key];
    }
    a = a || VENDOR_DEFAULT;
    const routes = (a.routes || []).slice();
    if (!routes.length) routes.push("dashboard");
    return { routes, links: (a.links || []).slice(), edit: !!a.edit, confid: a.confid !== false };
  }
  function vendorHome(u) { return vendorAccess(u).routes[0]; }
  const VIS_LABEL  = { all: "전체", mgr: "관리자 이상", hq: "안전보안파트 이상", admin: "시스템관리자" };

  /* ─────────── 국가 항공보안등급 (5단계) — 화물터미널도 동일 등급 체계 적용 ─────────── */
  const SEC_LEVELS = ["평시", "관심", "주의", "경계", "심각"];
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function levelSorted() {
    return (DATA.levelHistory || []).slice().sort((a, b) =>
      a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date.localeCompare(b.date));
  }
  function secCurrent() {
    const t = todayStr();
    const active = levelSorted().filter(e => e.date <= t && (!e.end || e.end >= t));
    return active.length ? active[active.length - 1] : { level: "평시", date: "", end: "", note: "" };
  }
  function secNext() {
    return levelSorted().find(e => e.date > todayStr()) || null;
  }

  /* ─────────── 선 아이콘 (v1.8 · 1.75px stroke) ───────────
     이모지 대신 쓰는 공통 아이콘. SeMIS.icon(name, size) 로 SVG 문자열을 얻는다.
     허브(그룹) 메뉴는 ico 필드에 이 키를 지정한다. 새 아이콘은 여기에 한 줄 추가. */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8.5 10 12 8.2l3.5 1.8v4L12 15.8 8.5 14z"/><path d="M8.5 10 12 11.8l3.5-1.8M12 11.8v4"/>',
    hardhat: '<path d="M3 18h18"/><path d="M5 18v-3a7 7 0 0 1 14 0v3"/><path d="M10 8.5V5.5h4v3"/><path d="M12 5.5V10"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9z"/><path d="m9 13 2 2 4-4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4"/><path d="M18 14.8c2 .6 3.2 2.3 3.6 5.2"/>',
    book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    notes: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M17 9.5a3.5 3.5 0 0 1 0 5"/>',
    phone: '<path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5L16 14l4 1.5V19a1.5 1.5 0 0 1-1.5 1.5C10.5 20.5 3.5 13.5 3.5 5.5A1.5 1.5 0 0 1 5 4z"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    chevdown: '<path d="m6 9 6 6 6-6"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    pin: '<path d="M7 4h10v16l-5-3.6L7 20z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
    folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.5l2 2H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    doc: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"/><path d="M14 3.5V8h4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><path d="M12 7.9v.1"/>',
    car: '<path d="M5 16.5h14"/><path d="M4.5 16.5V12l2-4.5A1.5 1.5 0 0 1 7.9 6.5h8.2a1.5 1.5 0 0 1 1.4 1L19.5 12v4.5"/><path d="M4.5 12h15"/><path d="M6.5 16.5V19M17.5 16.5V19"/><circle cx="8" cy="14.2" r=".4"/><circle cx="16" cy="14.2" r=".4"/>',
    door: '<path d="M4 20.5h16"/><path d="M6.5 20.5V4.5A1 1 0 0 1 7.5 3.5h9a1 1 0 0 1 1 1v16"/><path d="M14.5 12.2v.1"/>',
    bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    forward: '<path d="M4 7l6.5 5L4 17z"/><path d="M12 7l6.5 5-6.5 5z"/><path d="M20.5 6.5v11"/>',
    stretch: '<path d="M3.5 12h17"/><path d="m7 8.5-3.5 3.5L7 15.5"/><path d="m17 8.5 3.5 3.5-3.5 3.5"/>',
    repeat: '<path d="M4.5 11V9.5A2.5 2.5 0 0 1 7 7h12.5"/><path d="m16.5 4 3 3-3 3"/><path d="M19.5 13v1.5A2.5 2.5 0 0 1 17 17H4.5"/><path d="m7.5 20-3-3 3-3"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.9-4 3.7-6 7.5-6s6.6 2 7.5 6"/>',
    xray: '<path d="M3 17.5V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9.5"/><path d="M7.5 17.5v-5a4.5 4.5 0 0 1 9 0v5"/><path d="M2 17.5h20"/><path d="M5 20.5h.01M9.5 20.5h.01M14.5 20.5h.01M19 20.5h.01"/>',
    etd: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9.5 6.5h5"/><rect x="9" y="9.5" width="6" height="4.5" rx="1"/><path d="M10.5 17.5h3"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.5-1-2.6 0-1 .8-1.7 1.8-1.7h2.1a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.2-8.5-7.2z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="8" r="1"/>'
  };
  /* 허브 선택용 아이콘 목록 (시스템 설정 → 메뉴 관리) */
  const HUB_ICONS = ["home", "scan", "hardhat", "clipboard", "users", "book", "folder", "calendar", "notes", "alert", "link", "doc"];
  function icon(name, size) {
    const d = ICONS[name] || ICONS.folder;
    const z = size || 20;
    return '<svg class="ico" width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  /* ─────────── 기본 메뉴 시드 (인천화물팀 안전보안파트 업무 체계) ───────────
     v1.8: 6개 업무 허브(그룹) — 레일(왼쪽 아이콘 줄)에 허브, 허브 패널에 하위 메뉴.
       홈 · 화물 보안 · 안전 관리 · 점검·교육 · 협력·비상 · 규정·자료
     - 대시보드는 최상위(parent null)이지만 항상 홈 허브의 첫 항목으로 표시된다.
     - 나머지 최상위 항목(암호 관리 · 시스템 설정)은 레일 하단 유틸리티.
     planned:true 항목은 아직 모듈 js가 없는 "예정 모듈" — 라우트가 준비 중 안내 화면을 그린다.
     같은 module id로 SeMIS.registerModule()이 호출되는 순간 실화면으로 자동 대체된다. */
  function defaultMenus() {
    let seq = 0;
    const h  = (id, label, ico) => ({ id, seq: seq++, type: "group", label, ico });
    const m  = (id, label, icon, module, vis, parent, opts) => Object.assign(
      { id, seq: seq++, type: "module", label, icon, module, vis: vis || "all", parent: parent || null }, opts || {});
    const p  = (id, label, icon, module, vis, parent, desc) => m(id, label, icon, module, vis, parent, { planned: true, desc });
    const lk = (id, label, icon, url, parent, opts) => Object.assign({ id, seq: seq++, type: "link", label, icon, url, vis: "all", parent: parent || null }, opts || {});
    return [
      m("dashboard", "대시보드", "🏠", "dashboard"),

      h("hub-home", "홈", "home"),
      m("schedule", "일정관리", "📅", "schedule", "mgr", "hub-home"),
      m("minutes", "회의록 게시판", "🗒️", "minutes", "mgr", "hub-home"),
      p("board", "안전보안 현황판", "📊", "board", "mgr", "hub-home",
        "무재해 경과일·점검 완료율·미결 시정조치·교육 이수율 등 파트 핵심 지표를 한 화면에 모은 현황판. 각 업무 모듈이 쌓이면 자동 집계로 전환합니다."),

      h("hub-sec", "화물 보안", "scan"),
      m("scr-status", "화물 보안검색 현황", "🔎", "scr-status", "mgr", "hub-sec"),
      p("kc-ra", "상용화주 · RA 관리", "🏷️", "kc-ra", "hq", "hub-sec",
        "상용화주·보안업체(RA) 지정 현황, 유효기간, 점검 이력, 화물 인수 시 확인 절차를 관리합니다."),
      m("scr-equip", "검색장비 유지관리", "🔧", "scr-equip", "mgr", "hub-sec"),
      p("access", "보안구역 출입 관리", "🪪", "access", "mgr", "hub-sec",
        "화물터미널 보호구역 출입증·차량 출입·임시 출입 현황과 만료 도래 알림을 관리합니다."),

      h("hub-saf", "안전 관리", "hardhat"),
      p("daily-safety", "일일 안전점검", "✅", "daily-safety", "mgr", "hub-saf",
        "작업장·장비·통로·소방 등 일일 안전점검표를 전산으로 작성하고 미비점을 조치 이력과 함께 관리합니다."),
      p("risk", "위험성 평가", "⚠️", "risk", "hq", "hub-saf",
        "작업별 유해·위험요인 발굴, 5×5 위험도 평가, 감소 대책과 재평가 이력을 관리합니다."),
      p("incident", "사고 · 아차사고 보고", "🚨", "incident", "mgr", "hub-saf",
        "사고·준사고·아차사고(Near-miss) 보고 접수, 원인 분석, 재발 방지 대책과 조치 완료 추적."),
      p("gse", "지상조업(GSE) 안전", "🚜", "gse", "mgr", "hub-saf",
        "지게차·돌리·ULD 장비 등 지상조업 장비 안전 점검, 운전자 자격, 램프 안전 규칙 준수 현황."),

      h("hub-aud", "점검 · 교육", "clipboard"),
      p("inspection", "안전보안 점검 일정", "🕵️", "inspection", "mgr", "hub-aud",
        "내부 점검·외부 감사(국토부·공항공사·본사 안전심사) 연간 일정과 결과를 관리하고 일정관리와 연동합니다."),
      p("car", "시정조치 (CAR)", "📋", "car", "hq", "hub-aud",
        "점검·감사에서 나온 부적합을 접수 → 조치중 → 종결 3단계로 추적하고 기한 경과를 에스컬레이션합니다."),
      p("training", "안전보안 교육 관리", "🎓", "training", "mgr", "hub-aud",
        "보안교육(초기·정기)·안전교육(TBM·특별교육)·위험물 교육 계획과 실시 이력, 대상자별 이수 현황."),
      p("certs", "이수증 관리", "🎖", "certs", "mgr", "hub-aud",
        "교육 이수증·자격증(보안검색요원·위험물 취급자·지게차 등) 등록과 만료 도래 알림."),

      h("hub-ops", "협력 · 비상", "users"),
      Object.assign(m("contacts", "비상연락망 · 보고체계", "☎️", "contacts", "mgr", "hub-ops"), { quick: true }),
      p("partners", "조업사 · 협력사 현황", "🤝", "partners", "mgr", "hub-ops",
        "조업사·경비·청소·유지보수 업체 담당자, 인원, 보안서약·교육 이수 현황."),
      p("contracts", "계약서 관리", "💼", "contracts", "hq", "hub-ops",
        "협력사 계약서·과업지시서 파일과 계약기간·갱신 시점 관리 (대외비)."),

      h("hub-doc", "규정 · 자료", "book"),
      m("reg-sec", "항공보안 규정", "📘", "reg-sec", "mgr", "hub-doc"),
      m("reg-safety", "안전관리 규정", "🦺", "reg-safety", "mgr", "hub-doc"),
      m("reg-dg", "위험물(DG) 기준", "☢️", "reg-dg", "mgr", "hub-doc"),
      lk("ref-semis", "SeMIS v2 (항공보안파트)", "🛡️", "https://semis.pe.kr/", "hub-doc", { quick: true }),
      lk("ref-cares", "CARES (보안장비 관제)", "🛰", "https://airzeta-security-system.web.app", "hub-doc", { quick: true }),
      lk("ref-icn", "인천공항공사", "🛫", "https://www.airport.kr/", "hub-doc"),
      lk("ref-kosha", "안전보건공단 (KOSHA)", "🦺", "https://www.kosha.or.kr/", "hub-doc"),
      lk("ref-boannews", "보안뉴스", "📰", "https://www.boannews.com/", "hub-doc"),

      m("vault", "암호 관리", "🔐", "vault", "hq"),
      m("settings", "시스템 설정", "⚙️", "settings", "admin")
    ];
  }

  /* ─────────── v1.7 이하 메뉴 구조 → v1.8 허브 구조 (1회 마이그레이션) ───────────
     구버전 그룹(grp-*)이 남아 있을 때만 실행된다(멱등). 운영자가 바꾼 숨김·권한·이름·바로가기는
     그대로 두고 소속만 새 허브로 옮긴다. 숨겨 두었던 구버전 그룹의 하위 메뉴는 개별 숨김으로 이어받는다. */
  const OLD_GROUP_HUB = {
    "grp-rule": "hub-doc", "grp-cargo": "hub-sec", "grp-safety": "hub-saf", "grp-inspect": "hub-aud",
    "grp-edu": "hub-aud", "grp-partner": "hub-ops", "grp-emergency": "hub-ops", "grp-ref": "hub-doc"
  };
  const RAIL_TOP = ["dashboard", "vault", "settings"];   // 허브로 옮기지 않는 최상위 모듈
  function migrateHubs() {
    const menus = DATA.menus;
    if (!menus.some(m => m.type === "group" && OLD_GROUP_HUB[m.id])) return false;
    const seed = defaultMenus();
    seed.filter(g => g.type === "group").forEach(g => {
      if (!menus.some(m => m.id === g.id)) menus.push(Object.assign({}, g));
    });
    menus.forEach(m => {
      if (m.type === "group") return;
      const to = m.parent && OLD_GROUP_HUB[m.parent];
      if (to) {
        const g = menus.find(x => x.id === m.parent);
        if (g && g.hidden === true && canHide(m)) m.hidden = true;
        m.parent = to;
      } else if (!m.parent && !(m.type === "module" && RAIL_TOP.indexOf(m.module) >= 0)) {
        m.parent = "hub-home";
      }
    });
    DATA.menus = menus.filter(m => !(m.type === "group" && OLD_GROUP_HUB[m.id]));
    const order = {};
    seed.forEach((x, i) => { order[x.id] = i; });
    const key = (m) => order[m.id] !== undefined ? order[m.id] : 1000 + (Number(m.seq) || 0);
    DATA.menus.sort((a, b) => key(a) - key(b)).forEach((m, i) => { m.seq = i; });
    return true;
  }

  /* ─────────── 일정 담당자 카테고리 ───────────
     일정관리의 담당자 태그(칩·필터·버튼) 목록. 시스템 설정 → 담당자 관리에서
     시스템관리자가 추가·수정·삭제·순서변경한다(공용 DB 동기화).
     목록에 없는 이름도 일정 폼에서 자유 입력할 수 있다. */
  function seedAssignees() {
    return [{ id: "as-csi", seq: 1, name: "최상일", title: "안전보안파트", emoji: "🛡️", short: "최" }];
  }
  function assignees() {
    return (Array.isArray(DATA.assignees) ? DATA.assignees : [])
      .slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }

  /* ─────────── 저장소 ─────────── */
  function freshData() {
    return {
      version: 1,
      menus: defaultMenus(),
      notices: [{
        id: "n" + Date.now(),
        title: "SeMIS · Logistics 오픈 안내",
        body: "인천화물팀 안전보안파트의 화물터미널 안전보안 관리 정보시스템이 열렸습니다.\n\n- 좌측 메뉴에서 각 업무 화면으로 이동할 수 있습니다.\n- '예정' 표시가 있는 메뉴는 준비 중인 업무 모듈로, 순차적으로 열립니다.\n- 문의: 인천화물팀 안전보안파트",
        author: "시스템관리자", pinned: true, created: new Date().toISOString()
      }],
      levelHistory: [{ id: "lv0", date: new Date().toISOString().slice(0, 10), level: "평시",
        note: "SeMIS · Logistics 개설", by: "시스템", at: new Date().toISOString() }],
      safetyBoard: { since: "", note: "" }, // 무재해 기준일 (대시보드 현황판)
      pwOverrides: {},   // { baseUserId: hash }
      userOverrides: {}, // 기본 계정 속성 변경 { baseUserId: { id?, name?, role?, vendor?, deleted? } }
      customUsers: [],   // [{id, name, role, vendor?, hash}]
      schedules: [],     // 일정관리
      assignees: [],     // 일정 담당자 카테고리 (시스템 설정에서 관리) — normalize가 기본값 시드
      gcal: { enabled: false, calendarId: "", apiKey: "" },
      minutes: [],       // 회의록 게시판
      minuteFolders: [], // 회의록 폴더 — normalize가 기본 폴더 시드
      contacts: { sections: [] }, // 비상연락망 (실데이터는 공용 DB만 — 코드 미시드)
      vault: { v: 1, members: [], data: null, personal: {}, updated: "" }, // 암호 관리 (클라이언트 AES-256 암호화)
      regulations: [],   // 규정 관리 (항공보안 / 안전관리 / 위험물 DG)
      equipment: [],     // 검색장비 대장 (상태·고장·점검은 CARES 실시간 — js/cares.js)
      chatRooms: []      // (예약) 팀 채팅방
    };
  }

  let DATA = null;
  function load() {
    try {
      const raw = localStorage.getItem(LS_DATA);
      if (raw) { DATA = JSON.parse(raw); }
    } catch (e) { DATA = null; }
    if (!DATA) DATA = freshData();
    normalizeData();
    save();
  }

  /* 데이터 정규화/마이그레이션 (idempotent).
     load() 및 동기화 pull/원격 반영 이후에도 호출되어, 서버의 구버전 데이터가
     로컬 마이그레이션을 되돌리지 않도록 보장. 변경 여부를 반환. */
  function normalizeData() {
    const before = JSON.stringify(DATA);
    if (!Array.isArray(DATA.menus) || !DATA.menus.length) DATA.menus = defaultMenus();
    DATA.menus = DATA.menus.filter(m => m && typeof m === "object" && m.id);
    migrateHubs();
    // 허브 아이콘 보정 — 알 수 없는 키는 folder
    DATA.menus.forEach(m => { if (m.type === "group" && (!m.ico || !ICONS[m.ico])) m.ico = "folder"; });
    // 필수 메뉴 보장 (대시보드·시스템 설정) — 삭제·유실 시 복구
    const ensureModuleMenu = (menuId, grpId, label, icon, moduleId, vis, extra) => {
      if (DATA.menus.some(m => m.type === "module" && m.module === moduleId)) return;
      const grp = grpId ? DATA.menus.find(m => m.id === grpId && m.type === "group") : null;
      const children = grp ? DATA.menus.filter(m => m.parent === grpId) : [];
      const seq = children.length ? Math.min.apply(null, children.map(c => c.seq || 0)) - 0.5
        : DATA.menus.reduce((mx, m) => Math.max(mx, m.seq || 0), 0) + 1;
      DATA.menus.push(Object.assign({ id: menuId, seq, type: "module", label, icon, module: moduleId,
        vis: vis || "all", parent: grp ? grpId : null }, extra || {}));
    };
    ensureModuleMenu("dashboard", null, "대시보드", "🏠", "dashboard", "all");
    ensureModuleMenu("vault", null, "암호 관리", "🔐", "vault", "hq");
    ensureModuleMenu("settings", null, "시스템 설정", "⚙️", "settings", "admin");
    const dash = DATA.menus.find(m => m.type === "module" && m.module === "dashboard");
    if (dash) { dash.vis = "all"; dash.parent = null; if (dash.seq !== 0) dash.seq = Math.min(0, dash.seq || 0); }
    const st = DATA.menus.find(m => m.type === "module" && m.module === "settings");
    if (st) { st.vis = "admin"; st.parent = null; }
    const vt = DATA.menus.find(m => m.type === "module" && m.module === "vault");
    if (vt) { vt.parent = null; if (st && (vt.seq || 0) > (st.seq || 0)) vt.seq = (st.seq || 0) - 0.5; }
    // 예정 모듈 플래그 보정 (문자열 등 오염 방지)
    DATA.menus.forEach(m => { if (m.planned !== undefined) m.planned = !!m.planned; });
    // 숨김 플래그 정규화 — true 일 때만 보관(멱등). 대시보드·시스템 설정은 숨길 수 없다.
    DATA.menus.forEach(m => {
      if (m.hidden !== undefined && (m.hidden !== true || !canHide(m))) delete m.hidden;
    });

    DATA.notices = Array.isArray(DATA.notices) ? DATA.notices : [];
    DATA.pwOverrides = DATA.pwOverrides || {};
    DATA.userOverrides = DATA.userOverrides || {};
    // 최고관리자(mark3464) 보호: 권한 변경·삭제 불가 (잠금 방지)
    if (DATA.userOverrides.mark3464) {
      delete DATA.userOverrides.mark3464.role;
      delete DATA.userOverrides.mark3464.deleted;
    }
    DATA.customUsers = Array.isArray(DATA.customUsers) ? DATA.customUsers : [];
    if (!Array.isArray(DATA.chatRooms)) DATA.chatRooms = [];
    if (!Array.isArray(DATA.levelHistory) || !DATA.levelHistory.length) {
      DATA.levelHistory = [{ id: "lv0", date: new Date().toISOString().slice(0, 10), level: "평시",
        note: "시스템 개설", by: "시스템", at: new Date().toISOString() }];
    }
    if (!DATA.safetyBoard || typeof DATA.safetyBoard !== "object" || Array.isArray(DATA.safetyBoard))
      DATA.safetyBoard = { since: "", note: "" };
    DATA.safetyBoard.since = typeof DATA.safetyBoard.since === "string" ? DATA.safetyBoard.since : "";
    DATA.safetyBoard.note = typeof DATA.safetyBoard.note === "string" ? DATA.safetyBoard.note : "";

    // 일정 스키마 보정 (SeMIS v2 calendar.js 규약)
    DATA.schedules = (Array.isArray(DATA.schedules) ? DATA.schedules : []).map(s => {
      if (!s || typeof s !== "object") return null;
      if (s.date && !s.start) {
        return { id: s.id, title: s.title, memo: s.memo || "", start: s.date, end: s.date,
                 allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "",
                 vehicle: false, room: false, reminders: [], repeat: { freq: "none", until: "" },
                 doneFrom: "", doneDates: [], undoneDates: [] };
      }
      s.end = s.end || s.start;
      if (typeof s.allDay !== "boolean") s.allDay = !s.time;
      s.time = s.time || ""; s.timeEnd = s.timeEnd || "";
      s.color = s.color || "blue"; s.done = !!s.done;
      s.assignee = s.assignee || ""; s.memo = s.memo || "";
      s.vehicle = !!s.vehicle; s.room = !!s.room;
      if (!Array.isArray(s.reminders)) s.reminders = [];
      if (!s.repeat || typeof s.repeat !== "object" || !s.repeat.freq) s.repeat = { freq: "none", until: "" };
      s.doneFrom = typeof s.doneFrom === "string" ? s.doneFrom : "";
      if (!Array.isArray(s.doneDates)) s.doneDates = [];
      if (!Array.isArray(s.undoneDates)) s.undoneDates = [];
      delete s.date;
      return s;
    }).filter(Boolean);
    if (!DATA.gcal || typeof DATA.gcal !== "object") DATA.gcal = { enabled: false, calendarId: "", apiKey: "" };

    /* 일정 담당자 카테고리 — 최초 1회만 기본값 시드(이후 전부 삭제해도 되살아나지 않도록 플래그 사용),
       필드 보정은 매번(멱등). */
    if (!Array.isArray(DATA.assignees)) DATA.assignees = [];
    if (!DATA.assigneesSeeded) {
      if (!DATA.assignees.length) DATA.assignees = seedAssignees();
      DATA.assigneesSeeded = 1;
    }
    DATA.assignees = DATA.assignees.filter(a => a && typeof a === "object" && String(a.name || "").trim());
    DATA.assignees.forEach((a, i) => {
      a.id = String(a.id || ("as" + i + Date.now().toString(36)));
      a.name = String(a.name).trim();
      a.title = String(a.title == null ? "" : a.title).trim();
      a.emoji = String(a.emoji == null ? "" : a.emoji).trim() || "👤";
      a.short = String(a.short == null ? "" : a.short).trim() || a.name.slice(-1);
      if (typeof a.seq !== "number") a.seq = i + 1;
    });

    // 비상연락망
    if (!DATA.contacts || typeof DATA.contacts !== "object" || Array.isArray(DATA.contacts)) DATA.contacts = { sections: [] };
    if (!Array.isArray(DATA.contacts.sections)) DATA.contacts.sections = [];
    // 규정 관리 — 배열 보정 + 실모듈 전환(구버전 데이터의 planned 플래그 제거)
    DATA.regulations = (Array.isArray(DATA.regulations) ? DATA.regulations : []).filter(r => r && r.id);
    DATA.regulations.forEach(r => {
      if (["sec", "safety", "dg"].indexOf(r.scope) < 0) r.scope = "safety";
      if (!Array.isArray(r.ideas)) r.ideas = [];
    });
    // 검색장비 대장 (v1.12) — 배열 보정만. 실데이터는 공용 DB(SeMIS v2 대장 이관분)
    DATA.equipment = (Array.isArray(DATA.equipment) ? DATA.equipment : []).filter(x => x && typeof x === "object" && x.id);
    DATA.equipment.forEach(x => { if (!Array.isArray(x.logs)) x.logs = []; });
    ["reg-sec", "reg-safety", "reg-dg", "scr-status", "scr-equip"].forEach(id => {
      const mn = DATA.menus.find(m => m.type === "module" && m.module === id);
      if (!mn) return;
      if (mn.planned) { delete mn.planned; delete mn.desc; }
      if (mn.vis === "all") mn.vis = "mgr";
    });
    // 암호 관리 저장소 — 구조만 보정(암호문은 건드리지 않는다)
    if (!DATA.vault || typeof DATA.vault !== "object" || Array.isArray(DATA.vault))
      DATA.vault = { v: 1, members: [], data: null, personal: {}, updated: "" };
    if (!Array.isArray(DATA.vault.members)) DATA.vault.members = [];
    if (DATA.vault.v !== 1) DATA.vault.v = 1;
    if (DATA.vault.data === undefined) DATA.vault.data = null;
    if (typeof DATA.vault.updated !== "string") DATA.vault.updated = "";
    if (!DATA.vault.personal || typeof DATA.vault.personal !== "object" || Array.isArray(DATA.vault.personal))
      DATA.vault.personal = {};   // 멤버별 개인용 항목 암호문 { memberId: {iv, ct} }

    // 회의록 게시판 — 폴더 기본 시드는 minutes.js가 제공
    if (!Array.isArray(DATA.minutes)) DATA.minutes = [];
    if (!Array.isArray(DATA.minuteFolders)) DATA.minuteFolders = [];
    if (!DATA.minuteFolders.length && typeof window !== "undefined" && window.SemisMinutes && window.SemisMinutes.seedFolders)
      DATA.minuteFolders = window.SemisMinutes.seedFolders();
    if (typeof window !== "undefined" && window.SemisMinutes && window.SemisMinutes.normalizeDecisions) {
      try { window.SemisMinutes.normalizeDecisions(); } catch (e) { /* 보정 실패가 로딩을 막지 않도록 */ }
    }
    // 이스케이프된 채 굳은 서식 본문 1회 복구 (공지·회의록)
    if (typeof document !== "undefined" && window.SemisNotice && window.SemisNotice.repairEscapedRich) {
      const fix = window.SemisNotice.repairEscapedRich;
      try {
        DATA.notices.forEach(n => fix(n, "body"));
        DATA.minutes.forEach(m => { fix(m, "agenda"); fix(m, "body"); });
      } catch (e) { /* 복구 실패는 무시 */ }
    }
    return JSON.stringify(DATA) !== before;
  }
  const saveHooks = [];
  function onSave(fn) { saveHooks.push(fn); }
  function saveSilent() { localStorage.setItem(LS_DATA, JSON.stringify(DATA)); }
  function save() {
    localStorage.setItem(LS_DATA, JSON.stringify(DATA));
    saveHooks.forEach(fn => { try { fn(); } catch (e) { /* sync 오류가 앱을 막지 않도록 */ } });
  }

  function uiState() {
    try { return JSON.parse(localStorage.getItem(LS_UI)) || {}; } catch (e) { return {}; }
  }
  function setUiState(patch) {
    localStorage.setItem(LS_UI, JSON.stringify(Object.assign(uiState(), patch)));
  }
  // 사이드바 상태(그룹 펼치기/접기·미니 모드)를 접속 계정별로 저장
  function navPrefsKey() { return (currentUser && currentUser.id) || "_anon"; }
  function navPrefs() {
    const all = uiState().navPrefs || {};
    return all[navPrefsKey()] || {};
  }
  function setNavPref(patch) {
    const st = uiState();
    const all = st.navPrefs || {};
    all[navPrefsKey()] = Object.assign({}, all[navPrefsKey()] || {}, patch);
    setUiState({ navPrefs: all });
  }

  /* ─────────── 인증 ─────────── */
  let currentUser = null;

  function allUsers() {
    const base = BASE_USERS.map(u => {
      const ov = (DATA.userOverrides || {})[u.id] || {};
      if (ov.deleted && u.id !== "mark3464") return null;
      return Object.assign({}, u, {
        id: ov.id || u.id,
        name: ov.name || u.name,
        role: u.id === "mark3464" ? "admin" : (ov.role && ROLE_RANK[ov.role] ? ov.role : u.role),
        vendor: ov.vendor || "",
        hash: DATA.pwOverrides[u.id] || u.hash,
        origId: u.id, base: true
      });
    }).filter(Boolean);
    return base.concat(DATA.customUsers.map(u => Object.assign({}, u, { origId: u.id, base: false })));
  }
  function login(pw) {
    const h = pwHash(pw);
    const user = allUsers().find(u => u.hash === h);
    if (!user) return null;
    currentUser = user;
    sessionStorage.setItem(SS_SESSION, JSON.stringify({ uid: user.id, ts: Date.now() }));
    return user;
  }
  /* 서명 세션 — 회의록별 6자리 숫자 코드(id 기반 결정적 파생, 동기화 충돌 없음) */
  function signCodeFor(m) {
    const id = String((m && m.id) || "");
    let h = 5381;
    for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
    return String(100000 + (h % 900000));
  }
  function signMinuteFor(pw) {
    const code = String(pw || "").trim();
    if (!/^\d{6}$/.test(code)) return null;
    const list = (DATA.minutes || []).filter(c => c && signCodeFor(c) === code);
    if (!list.length) return null;
    return list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
  }
  function signLogin(pw) {
    const mi = signMinuteFor(pw);
    if (mi) {
      currentUser = { id: "__signer__", name: "회의록 참석 서명", role: "signer", signMinuteId: mi.id };
      sessionStorage.setItem(SS_SESSION, JSON.stringify({ uid: "__signer__", signMinuteId: mi.id, ts: Date.now() }));
      return currentUser;
    }
    return null;
  }
  function signCodeFromHash() {
    const mm = /^#\/sign\/(\d{6})$/.exec(String(location.hash || ""));
    return mm ? mm[1] : "";
  }
  /* QR에 넣을 접속 주소 — 현재 배포 주소를 그대로 사용 */
  function signUrlFor(rec) {
    const code = signCodeFor(rec);
    let base = "https://mark4mission.github.io/semis-logistics/";
    try {
      const l = location;
      if (l && l.protocol && l.protocol.indexOf("http") === 0)
        base = l.origin + l.pathname.replace(/index\.html$/i, "");
    } catch (e) { /* 파일 프로토콜 등 — 기본 주소 사용 */ }
    if (base.slice(-1) !== "/") base += "/";
    return base + "#/sign/" + code;
  }
  function restoreSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SS_SESSION));
      if (!s) return false;
      if (s.uid === "__signer__") {
        const mi = (DATA.minutes || []).find(c => c && c.id === s.signMinuteId);
        if (!mi) return false;
        currentUser = { id: "__signer__", name: "회의록 참석 서명", role: "signer", signMinuteId: mi.id };
        return true;
      }
      const user = allUsers().find(u => u.id === s.uid);
      if (!user) return false;
      currentUser = user;
      return true;
    } catch (e) { return false; }
  }
  function logout() {
    currentUser = null;
    sessionStorage.removeItem(SS_SESSION);
    location.hash = "";
    location.reload();
  }
  const isAdmin = () => currentUser && currentUser.role === "admin";
  const roleRank = () => {
    if (!currentUser) return 0;
    if (currentUser.role === "vendor") return vendorAccess(currentUser).edit ? 3 : 1;
    const r = ROLE_RANK[currentUser.role];
    return (r == null) ? 1 : r;
  };
  const canEdit = () => roleRank() >= 3;                 // 편집: 안전보안파트(hq) 이상
  const canDelete = () => canEdit() && !(currentUser && currentUser.role === "vendor"); // 삭제: 내부 계정만
  const canConfid = () => {                               // 대외비(계약·비용 등)
    if (roleRank() < 3) return false;
    if (currentUser && currentUser.role === "vendor") return vendorAccess(currentUser).confid;
    return true;
  };
  /* 회의록 참석자 예외 — 등급이 모자라도 본인이 참석·작성한 회의가 있으면 진입 허용 */
  function minutesAttendee(menu) {
    if (menu.module !== "minutes" || !currentUser) return false;
    if (currentUser.role === "vendor" || currentUser.role === "signer") return false;
    if (typeof window === "undefined" || !window.SemisMinutes) return false;
    try { return window.SemisMinutes.visibleAll().length > 0; } catch (e) { return false; }
  }
  function canSee(menu) {
    const vis = menu.vis || "all";
    if (vis === "all") return true;
    if (vis === "mgr") return roleRank() >= 2 || minutesAttendee(menu);
    if (vis === "hq") return roleRank() >= 3;
    return roleRank() >= 4;
  }
  /* ─── 메뉴 숨김 (권한과 별개) ───
     menu.hidden = true 이면 어떤 권한으로 접속해도 사이드바·통합검색·대시보드 카드에
     나타나지 않는다. 기능 자체는 살아 있어 라우트(#/module)로는 그대로 동작한다.
     그룹을 숨기면 그 하위 메뉴도 함께 숨겨진다. 대시보드·시스템 설정은 숨길 수 없다. */
  const UNHIDABLE = ["dashboard", "settings"];
  function canHide(menu) {
    return !!menu && !(menu.type === "module" && UNHIDABLE.indexOf(menu.module) >= 0);
  }
  function menuHidden(menu) {
    if (!menu) return false;
    if (menu.hidden && canHide(menu)) return true;
    if (menu.parent && DATA && Array.isArray(DATA.menus)) {
      const p = DATA.menus.find(m => m.id === menu.parent);
      if (p && p.hidden) return true;
    }
    return false;
  }
  /* 화면 노출 = 권한 통과 && 숨김 아님 */
  function navVisible(menu) { return !!menu && canSee(menu) && !menuHidden(menu); }

  /* ─────────── 유틸 ─────────── */
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  /* 공통 디자인(Section Kit) 링 게이지 — css/main.css 의 .ds-ring 참조 */
  function dsRing(pct, sub) {
    const R = 54, C = 2 * Math.PI * R;
    const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    return `<div class="ds-ring">
      <svg viewBox="0 0 134 134" width="134" height="134" aria-hidden="true">
        <defs><linearGradient id="dsRingG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0f766e"></stop><stop offset="1" stop-color="#2dd4bf"></stop>
        </linearGradient></defs>
        <circle cx="67" cy="67" r="${R}" fill="none" stroke="#e2ecec" stroke-width="13"></circle>
        <circle cx="67" cy="67" r="${R}" fill="none" stroke="url(#dsRingG)" stroke-width="13"
          stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - p / 100)).toFixed(1)}"></circle>
      </svg>
      <div class="ds-ring-c"><span class="ds-ring-p">${p}%</span>${sub ? `<span class="ds-ring-s">${esc(sub)}</span>` : ""}</div>
    </div>`;
  }
  function toast(msg, isErr) {
    const wrap = $("#toast-wrap");
    if (!wrap) return;
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2200);
    setTimeout(() => t.remove(), 2600);
  }

  /* ─────────── 모달 ─────────── */
  function openModal(html, opts) {
    const box = $("#modal-box");
    box.classList.toggle("wide", !!(opts && opts.wide));
    box.innerHTML = html;
    $("#modal-overlay").classList.remove("hidden");
  }
  function closeModal() {
    $("#modal-overlay").classList.add("hidden");
    const box = $("#modal-box");
    box.classList.remove("wide");
    box.classList.remove("full");
    box.innerHTML = "";
  }
  function confirmModal(msg, onOk) {
    openModal(
      '<h3>확인</h3><p style="font-size:.92rem;color:var(--text-2)">' + esc(msg) + '</p>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost" data-act="cancel">취소</button>' +
      '<button class="btn btn-danger" data-act="ok">확인</button></div>'
    );
    $("#modal-box [data-act=ok]").onclick = () => { closeModal(); onOk(); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
  }

  /* ═════════════ A4 인쇄 (전 화면 공통) ═════════════
     모든 화면(대시보드·모듈·예정 모듈 안내·내부 링크)에 "Print" 버튼을 자동으로 붙여
     지금 보고 있는 화면을 그대로 A4 보고용으로 출력한다. 화면 머리말(.ds-head/.page-head)이
     있으면 그 오른쪽에, 없으면 화면 맨 위 인쇄 바에 넣는다.
     인쇄 시에는 헤더·사이드바·버튼이 빠지고(css @media print), 문서 머리말
     (시스템명 · 화면명 · 출력일시 · 출력자)이 자동으로 붙는다. */
  function printTitle(route) {
    const mn = menuForModule(route);
    if (mn) return mn.label;
    if (String(route).indexOf("embed/") === 0) {
      const lk = DATA.menus.find(m => m && m.id === route.slice(6));
      if (lk) return lk.label;
    }
    const def = modules[route];
    return (def && def.title) || "화면 출력";
  }
  function printStamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function printView(route) {
    const view = $("#view");
    if (!view) return;
    const title = printTitle(route || currentRoute());
    let head = $("#print-head");
    if (!head) {
      head = document.createElement("div");
      head.id = "print-head";
      head.className = "print-only";
    }
    head.innerHTML =
      '<div class="ph-sys">' + esc(APP_NAME) + ' <span>에어제타 인천화물팀 안전보안파트</span></div>' +
      '<div class="ph-title">' + esc(title) + '</div>' +
      '<div class="ph-meta">출력일시 ' + esc(printStamp()) +
        ' · 출력자 ' + esc((currentUser && currentUser.name) || "-") +
        ' · ' + esc((ROLE_LABEL[currentUser && currentUser.role] || "")) + '</div>';
    if (view.firstChild !== head) view.insertBefore(head, view.firstChild);
    setTimeout(() => { try { window.print(); } catch (e) { toast("인쇄를 시작할 수 없습니다.", true); } }, 60);
  }
  /* 화면 머리말에 인쇄 버튼 부착 (모듈이 이미 넣어 두었으면 건너뜀) */
  function attachPrintBtn(view, route) {
    if (!view || view.querySelector("[data-print-btn]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm no-print";
    btn.dataset.printBtn = "1";
    btn.title = "이 화면을 A4 보고용으로 인쇄";
    btn.innerHTML = icon("print", 17) + "<span>Print</span>";
    btn.onclick = () => printView(route);
    const head = view.querySelector(".ds-head, .page-head");
    if (head) {
      /* 머리말에 이미 .spacer 가 있으면 오른쪽 버튼 묶음 끝에, 없으면 자체적으로 오른쪽 정렬 */
      if (!head.querySelector(".spacer")) btn.classList.add("pb-right");
      const desc = head.querySelector(".page-desc");
      if (desc) head.insertBefore(btn, desc); else head.appendChild(btn);
    } else {
      const bar = document.createElement("div");
      bar.className = "print-bar no-print";
      bar.appendChild(btn);
      view.insertBefore(bar, view.firstChild);
    }
  }

  /* ─────────── 모듈 레지스트리 & 라우터 ─────────── */
  const modules = {};
  function registerModule(id, def) { modules[id] = def; }
  function hasModule(id) { return !!modules[id]; }

  function currentRoute() {
    const h = location.hash.replace(/^#\//, "");
    return h || "dashboard";
  }
  function navigate(id) { location.hash = "#/" + id; }

  function menuForModule(moduleId) {
    return DATA.menus.find(x => x.type === "module" && x.module === moduleId);
  }

  /* 라우트별 콘텐츠 폭 — wide(2100px) / mid(1560px) / 기본 1180px */
  const VIEW_WIDTH = {
    schedule: "wide", dashboard: "wide", board: "wide",
    minutes: "mid", contacts: "mid", settings: "mid", vault: "mid",
    "reg-sec": "mid", "reg-safety": "mid", "reg-dg": "mid", "scr-status": "mid", "scr-equip": "mid"
  };
  function applyViewWidth(view, route) {
    const tier = String(route).indexOf("embed/") === 0 ? "wide" : (VIEW_WIDTH[route] || "");
    view.classList.toggle("view-wide", tier === "wide");
    view.classList.toggle("view-mid", tier === "mid");
  }

  /* 예정 모듈 안내 화면 — 메뉴의 planned/desc 로 렌더.
     같은 허브의 다른 메뉴(운영 중 · 준비 중)를 함께 보여 허브 안에서 길을 잃지 않게 한다. */
  function renderPlannedView(root, menu) {
    const desc = menu.desc || "이 메뉴는 업무 모듈로 순차 개발될 예정입니다.";
    const hub = hubOf(menu);
    const g = hub ? DATA.menus.find(x => x.id === hub) : null;
    const sibs = hub ? hubEntries(hub).filter(m => m.type === "module" && m.id !== menu.id) : [];
    root.innerHTML = `
      <div class="page-head">
        <div class="page-title">${esc(menu.label)}</div>
        <span class="badge badge-amber">준비 중</span>
        <span class="spacer"></span>
      </div>
      <div class="plan-grid">
        <section class="card plan-main">
          <h2 class="card-title">모듈 개요</h2>
          <p class="plan-desc">${esc(desc)}</p>
          <p class="plan-note">개발이 끝나면 이 자리에 실제 업무 화면이 열립니다.</p>
        </section>
        ${sibs.length ? `<aside class="card plan-side">
          <h2 class="card-title">${g ? `<span class="hub-ico">${icon(g.ico, 18)}</span>` + esc(g.label) : "같은 허브"}</h2>
          <div class="plan-list">${sibs.map(m => `
            <button type="button" class="plan-row" data-go="${esc(m.module)}">
              <span class="plan-row-t">${esc(m.label)}</span>
              ${isPlannedMenu(m) ? '<span class="badge badge-amber">준비 중</span>' : '<span class="badge badge-green">운영 중</span>'}
            </button>`).join("")}</div>
        </aside>` : ""}
      </div>`;
    $$("[data-go]", root).forEach(el => el.onclick = () => navigate(el.dataset.go));
  }

  /* v1.9: 허브 화면의 머리말을 사진 배너로 — #view[data-hub] 로 CSS가 허브별 사진을 고른다.
     대시보드(3D 장면)·관리 메뉴(허브 없음)·외부 링크 화면은 제외. 모듈이 내부적으로 다시 그려도
     #view 속성은 남으므로 배너가 유지된다. */
  function markHub(view, route) {
    let hub = null;
    if (route && route !== "dashboard" && String(route).indexOf("embed/") !== 0) {
      const mn = menuForModule(route);
      const hid = mn ? hubOf(mn) : null;
      const g = hid ? DATA.menus.find(x => x.id === hid && x.type === "group") : null;
      if (g) hub = g;
    }
    if (hub) view.setAttribute("data-hub", hub.id); else view.removeAttribute("data-hub");
  }

  function renderView() {
    let route = currentRoute();
    const view = $("#view");
    view.innerHTML = "";
    applyViewWidth(view, route);
    markHub(view, currentUser && (currentUser.role === "vendor" || currentUser.role === "signer") ? "" : route);
    if (currentUser && currentUser.role === "vendor") {
      const allow = vendorAccess(currentUser).routes;
      if (allow.indexOf(route) < 0) route = vendorHome(currentUser);
      applyViewWidth(view, route);
      const def = modules[route] || modules.dashboard;
      def.render(view);
      attachPrintBtn(view, route);
      highlightNav(route);
      closeSidebar();
      return;
    }
    if (currentUser && currentUser.role === "signer") {
      view.classList.remove("view-wide"); view.classList.remove("view-mid");
      const def = modules.minutes || modules.dashboard;
      def.render(view);
      highlightNav("minutes");
      closeSidebar();
      return;
    }
    if (route.indexOf("embed/") === 0) {
      renderEmbedView(view, route.slice(6));
    } else {
      let def = modules[route];
      const menu = menuForModule(route);
      if (menu && !canSee(menu)) { toast("접근 권한이 없습니다.", true); def = modules.dashboard; markHub(view, "dashboard"); }
      else if (!def && menu && menu.type === "module") {
        // 예정 모듈 — 모듈 js가 아직 없으면 안내 화면
        renderPlannedView(view, menu);
        attachPrintBtn(view, route);
        highlightNav(route);
        closeSidebar();
        return;
      }
      if (!def) { def = modules.dashboard; markHub(view, "dashboard"); }
      def.render(view);
    }
    attachPrintBtn(view, route);
    highlightNav(route);
    closeSidebar();
  }
  /* 떠 있는 허브 패널·모바일 시트 닫기 (스크롤 유지) */
  function closeOverlays() {
    const app = $("#app");
    if (app) { app.classList.remove("panel-open"); app.classList.remove("sheet-open"); }
    const bd = $("#sidebar-backdrop");
    if (bd) bd.classList.remove("show");
  }
  /* 화면 이동 시 — 오버레이 닫고 맨 위로 */
  function closeSidebar() {
    closeOverlays();
    const main = $("#main");
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* 외부 링크를 시스템 내부 화면(iframe)에서 열기 */
  function renderEmbedView(root, id) {
    const mn = DATA.menus.find(m => m && m.id === id && m.type === "link");
    if (!mn || !canSee(mn)) {
      toast(mn ? "접근 권한이 없습니다." : "메뉴를 찾을 수 없습니다.", true);
      modules.dashboard.render(root);
      return;
    }
    root.innerHTML = `
      <div class="page-head">
        <div class="page-title">${esc(mn.label)}</div>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="${esc(mn.url)}" target="_blank" rel="noopener">${icon("external", 16)}<span>새 탭에서 열기</span></a>
      </div>
      <iframe class="embed-frame" src="${esc(mn.url)}" title="${esc(mn.label)}"
        allow="fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  }

  /* ═════════════ 허브 내비게이션 (v1.8) ═════════════
     구조:  레일(#rail, 허브 아이콘) + 허브 패널(#sidebar, 현재 허브의 메뉴)
            모바일(<768px): 하단 탭(#tabbar) + 전체 메뉴 시트(#sidebar 가 시트로 전환)
     - 허브 = 최상위 그룹 메뉴. 새 그룹을 만들면 레일에 자동으로 생긴다.
     - 허브 패널은 모든 허브 섹션을 DOM에 두고 현재 허브(.hub.on)만 보인다.
       모바일 시트에서는 모든 섹션이 세로로 이어진다(같은 마크업, CSS만 다름).
     - 예정 모듈은 "준비 중인 모듈" 블록에 모이고, registerModule 되는 순간 위 목록으로 올라온다.
     - 모듈이 def.navBadge() 를 제공하면 메뉴 오른쪽에 숫자가 붙는다(예: 규정 건수). */
  function sortedMenus() {
    return DATA.menus.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }
  const HOME_HUB = "hub-home";
  let activeHub = null;
  const isLive = (m) => m.type === "module" && !(m.planned && !modules[m.module]);
  const isPlannedMenu = (m) => m.type === "module" && !!m.planned && !modules[m.module];
  function homeHubId() {
    const gs = sortedMenus().filter(g => g.type === "group");
    const hh = gs.find(g => g.id === HOME_HUB);
    return hh ? hh.id : (gs[0] ? gs[0].id : null);
  }
  /* 메뉴가 속한 허브 id — 대시보드는 항상 홈 허브, 그 외 최상위는 null(레일 하단 유틸리티) */
  function hubOf(mn) {
    if (!mn) return null;
    if (mn.parent) return mn.parent;
    if (mn.type === "module" && mn.module === "dashboard") return homeHubId();
    return null;
  }
  function hubEntries(hubId) {
    return sortedMenus().filter(m => m.type !== "group" && hubOf(m) === hubId && navVisible(m));
  }
  function hubList() {
    return sortedMenus().filter(g => g.type === "group" && !menuHidden(g) && hubEntries(g.id).length);
  }
  function utilEntries() {
    return sortedMenus().filter(m => m.type !== "group" && !m.parent &&
      !(m.type === "module" && m.module === "dashboard") && navVisible(m));
  }
  const UTIL_ICO = { vault: "lock", settings: "sliders" };
  function railLabel(g) {
    return g.short || String(g.label || "").replace(/\s*[·/]\s*/g, "").replace(/\s+/g, "");
  }
  function navBadgeOf(m) {
    const def = m.type === "module" ? modules[m.module] : null;
    if (!def || typeof def.navBadge !== "function") return "";
    try { const v = def.navBadge(); return v === 0 || v ? String(v) : ""; } catch (e) { return ""; }
  }
  const isMobile = () => typeof window !== "undefined" && window.innerWidth < 768;
  const panelFloats = () => {
    const app = $("#app");
    return !isMobile() && ((typeof window !== "undefined" && window.innerWidth < 1100) ||
      (app && app.classList.contains("panel-collapsed")));
  };

  function navItemHTML(m) {
    const tag = m.type === "link" ? "a" : "button";
    if (m.type === "link" && m.open !== "frame") {
      return '<a class="nav-item nav-link" href="' + esc(m.url) + '" target="_blank" rel="noopener" title="' + esc(m.label) + '">' +
        '<span class="nav-lbl">' + esc(m.label) + '</span><span class="ext-mark">' + icon("external", 15) + '</span></a>';
    }
    if (m.type === "link") {
      return '<button type="button" class="nav-item nav-link" data-route="embed/' + esc(m.id) + '" title="' + esc(m.label) + '">' +
        '<span class="nav-lbl">' + esc(m.label) + '</span><span class="ext-mark">' + icon("panel", 15) + '</span></button>';
    }
    if (isPlannedMenu(m)) {
      return '<button type="button" class="nav-item planned" data-route="' + esc(m.module) + '" title="' + esc(m.label) + ' (준비 중)">' +
        '<span class="pl-dot" aria-hidden="true"></span><span class="nav-lbl">' + esc(m.label) + '</span><span class="nav-tag">예정</span></button>';
    }
    const badge = navBadgeOf(m);
    return '<' + tag + ' type="button" class="nav-item" data-route="' + esc(m.module) + '" title="' + esc(m.label) + '">' +
      '<span class="nav-lbl">' + esc(m.label) + '</span>' + (badge ? '<span class="nav-meta">' + esc(badge) + '</span>' : "") + '</' + tag + '>';
  }
  function plannedOpenPref(hubId, liveCount) {
    const pref = (navPrefs().plannedOpen || {})[hubId];
    if (typeof pref === "boolean") return pref;
    return !isMobile() && liveCount === 0;
  }
  function hubSectionHTML(g, entries) {
    const live = entries.filter(m => m.type === "module" && isLive(m));
    const planned = entries.filter(isPlannedMenu);
    const links = entries.filter(m => m.type === "link");
    const pins = g.id === homeHubId()
      ? sortedMenus().filter(m => m.quick && m.type !== "group" && navVisible(m) && !isPlannedMenu(m) && hubOf(m) !== g.id) : [];
    const open = plannedOpenPref(g.id, live.length);
    let h = '<section class="hub" data-hub="' + esc(g.id) + '" aria-label="' + esc(g.label) + '">' +
      '<div class="hub-head"><span class="hub-ico">' + icon(g.ico, 18) + '</span><h2 class="hub-title">' + esc(g.label) + '</h2></div>';
    if (live.length) h += '<div class="hub-items">' + live.map(navItemHTML).join("") + '</div>';
    if (pins.length) h += '<div class="hub-block hub-pins"><div class="hub-block-t">고정한 메뉴</div>' +
      pins.map(m => {
        const pinIco = '<span class="pin-ico">' + icon("pin", 15) + '</span>';
        if (m.type === "link" && m.open !== "frame")
          return '<a class="nav-pin" href="' + esc(m.url) + '" target="_blank" rel="noopener">' + pinIco + '<span>' + esc(m.label) + '</span></a>';
        const r = m.type === "link" ? "embed/" + m.id : m.module;
        return '<button type="button" class="nav-pin" data-go="' + esc(r) + '">' + pinIco + '<span>' + esc(m.label) + '</span></button>';
      }).join("") + '</div>';
    if (planned.length) h += '<div class="hub-block hub-planned' + (open ? " open" : "") + '">' +
      '<button type="button" class="hub-block-t hub-toggle" data-toggle-planned="' + esc(g.id) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span>준비 중인 모듈</span><b class="soon-n">' + planned.length + '</b><span class="chev">' + icon("chevdown", 15) + '</span></button>' +
      '<div class="planned-list">' + planned.map(navItemHTML).join("") + '</div></div>';
    if (links.length) h += '<div class="hub-block hub-links"><div class="hub-block-t">바로가기</div>' + links.map(navItemHTML).join("") + '</div>';
    return h + '</section>';
  }

  function renderNav() {
    const box = $("#nav-menu"), rail = $("#rail-hubs"), util = $("#rail-util");
    if (!box) return;
    box.innerHTML = ""; if (rail) rail.innerHTML = ""; if (util) util.innerHTML = "";
    const appEl = $("#app");
    const role = currentUser && currentUser.role;
    if (appEl) {
      appEl.classList.toggle("nav-lite", role === "vendor" || role === "signer");
      appEl.classList.toggle("nav-signer", role === "signer");
      appEl.classList.toggle("panel-collapsed", !!navPrefs().panelCollapsed && role !== "vendor" && role !== "signer");
    }
    let html = "";
    if (role === "vendor") {
      const acc = vendorAccess(currentUser);
      html = '<section class="hub on" data-hub="_lite" aria-label="메뉴"><div class="hub-head"><span class="hub-ico">' + icon("grid", 18) +
        '</span><h2 class="hub-title">메뉴</h2></div><div class="hub-items">' +
        acc.routes.map(r => {
          const mn = menuForModule(r);
          if (mn && menuHidden(mn)) return "";
          return '<button type="button" class="nav-item" data-route="' + esc(r) + '"><span class="nav-lbl">' + esc((mn && mn.label) || r) + '</span></button>';
        }).join("") +
        acc.links.map(l => '<a class="nav-item nav-link" href="' + esc(l.url) + '" target="_blank" rel="noopener"><span class="nav-lbl">' +
          esc(l.label) + '</span><span class="ext-mark">' + icon("external", 15) + '</span></a>').join("") +
        '</div></section>';
      activeHub = "_lite";
    } else if (role === "signer") {
      html = '<section class="hub on" data-hub="_lite" aria-label="메뉴"><div class="hub-items">' +
        '<button type="button" class="nav-item active" data-route="minutes"><span class="nav-lbl">회의록 · 참석 서명</span></button></div></section>';
      activeHub = "_lite";
    } else {
      const hubs = hubList();
      hubs.forEach(g => { html += hubSectionHTML(g, hubEntries(g.id)); });
      if (rail) rail.innerHTML = hubs.map(g =>
        '<button type="button" class="rail-btn" data-hub="' + esc(g.id) + '" aria-pressed="false" title="' + esc(g.label) + '">' +
        icon(g.ico, 22) + '<span>' + esc(railLabel(g)) + '</span></button>').join("");
      const utils = utilEntries();
      if (util) util.innerHTML = utils.map(m => {
        const ico = icon(m.ico || UTIL_ICO[m.module] || (m.type === "link" ? "link" : "folder"), 21);
        if (m.type === "link" && m.open !== "frame")
          return '<a class="rail-btn util" href="' + esc(m.url) + '" target="_blank" rel="noopener" title="' + esc(m.label) + '" aria-label="' + esc(m.label) + '">' + ico + '</a>';
        const r = m.type === "link" ? "embed/" + m.id : m.module;
        return '<button type="button" class="rail-btn util" data-route="' + esc(r) + '" title="' + esc(m.label) + '" aria-label="' + esc(m.label) + '">' + ico + '</button>';
      }).join("");
      if (utils.length) html += '<section class="hub hub-util" data-hub="_util" aria-label="관리"><div class="hub-head"><span class="hub-ico">' +
        icon("sliders", 18) + '</span><h2 class="hub-title">관리</h2></div><div class="hub-items">' + utils.map(navItemHTML).join("") + '</div></section>';
      if (!activeHub || !hubs.some(g => g.id === activeHub)) activeHub = hubs[0] ? hubs[0].id : null;
    }
    box.innerHTML = html;

    $$("[data-route]", box).forEach(el => { el.onclick = () => navigate(el.dataset.route); });
    $$("[data-go]", box).forEach(el => { el.onclick = () => navigate(el.dataset.go); });
    $$("[data-toggle-planned]", box).forEach(b => {
      b.onclick = () => {
        const blk = b.closest(".hub-planned");
        const open = !blk.classList.contains("open");
        blk.classList.toggle("open", open);
        b.setAttribute("aria-expanded", open ? "true" : "false");
        const po = Object.assign({}, navPrefs().plannedOpen || {});
        po[b.dataset.togglePlanned] = open;
        setNavPref({ plannedOpen: po });
      };
    });
    if (rail) $$(".rail-btn[data-hub]", rail).forEach(b => { b.onclick = () => openHub(b.dataset.hub); });
    if (util) $$(".rail-btn[data-route]", util).forEach(b => { b.onclick = () => navigate(b.dataset.route); });
    renderTabbar();
    highlightNav(currentRoute());
  }

  /* 허브 전환 — 레일 클릭. 좁은 화면·패널 접힘 상태에서는 패널이 떠서 열린다. */
  function applyHub() {
    $$("#nav-menu .hub").forEach(s => s.classList.toggle("on", s.dataset.hub === activeHub));
    $$("#rail-hubs .rail-btn").forEach(b => {
      const on = b.dataset.hub === activeHub;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function openHub(id) {
    const app = $("#app");
    const same = activeHub === id;
    activeHub = id;
    applyHub();
    if (panelFloats()) {
      const opened = app.classList.contains("panel-open");
      const show = !(opened && same);
      app.classList.toggle("panel-open", show);
      $("#sidebar-backdrop").classList.toggle("show", show);
    }
  }
  function togglePanel() {
    const app = $("#app");
    if (!app) return;
    if (isMobile()) { openSheet(); return; }
    if (typeof window !== "undefined" && window.innerWidth < 1100) {   // 태블릿: 항상 떠 있는 패널
      const show = !app.classList.contains("panel-open");
      app.classList.toggle("panel-open", show);
      $("#sidebar-backdrop").classList.toggle("show", show);
      return;
    }
    const col = !app.classList.contains("panel-collapsed");
    app.classList.toggle("panel-collapsed", col);
    app.classList.remove("panel-open");
    $("#sidebar-backdrop").classList.remove("show");
    setNavPref({ panelCollapsed: col });
  }
  function openSheet() {
    const app = $("#app");
    app.classList.add("sheet-open");
    $("#sidebar-backdrop").classList.add("show");
  }

  /* 모바일 하단 탭 — 권한·숨김에 맞춰 보이는 것만. hub 지정 탭은 그 허브의 첫 운영 모듈로 */
  const MOBILE_TABS = [
    { label: "홈", ico: "home", route: "dashboard" },
    { label: "일정", ico: "calendar", route: "schedule" },
    { label: "연락망", ico: "phone", route: "contacts" },
    { label: "규정", ico: "book", hub: "hub-doc" }
  ];
  function tabRoute(t) {
    const role = currentUser && currentUser.role;
    if (role === "signer") return null;
    if (role === "vendor") {
      const routes = vendorAccess(currentUser).routes;
      if (t.route) return routes.indexOf(t.route) >= 0 ? t.route : null;
      const first = hubEntries(t.hub).find(m => isLive(m) && routes.indexOf(m.module) >= 0);
      return first ? first.module : null;
    }
    if (t.route) { const mn = menuForModule(t.route); return mn && navVisible(mn) ? t.route : null; }
    const first = hubEntries(t.hub).find(isLive);
    return first ? first.module : null;
  }
  function renderTabbar() {
    const bar = $("#tabbar");
    if (!bar) return;
    const role = currentUser && currentUser.role;
    if (role === "signer") { bar.innerHTML = ""; return; }
    const tabs = MOBILE_TABS.map(t => Object.assign({}, t, { to: tabRoute(t) })).filter(t => t.to);
    bar.innerHTML = tabs.map(t =>
      '<button type="button" class="tab-btn" data-route="' + esc(t.to) + '"' + (t.hub ? ' data-hub="' + esc(t.hub) + '"' : "") + '>' +
      icon(t.ico, 22) + '<span>' + esc(t.label) + '</span></button>').join("") +
      '<button type="button" class="tab-btn tab-all" data-sheet-open>' + icon("grid", 22) + '<span>전체</span></button>';
    $$(".tab-btn[data-route]", bar).forEach(b => { b.onclick = () => navigate(b.dataset.route); });
    $(".tab-all", bar).onclick = openSheet;
  }

  function renderCrumbs(route, mn, hub) {
    const el = $("#crumbs");
    if (!el) return;
    const g = hub ? DATA.menus.find(x => x.id === hub) : null;
    const hubName = g ? g.label : (mn && !mn.parent ? "관리" : "");
    const leaf = mn ? mn.label : ((modules[route] && modules[route].title) || "");
    el.innerHTML = (hubName && hubName !== leaf ? '<span class="cr-hub">' + esc(hubName) + '</span>' + icon("chevron", 14) : "") +
      '<b class="cr-leaf">' + esc(leaf) + '</b>';
  }
  function highlightNav(route) {
    route = String(route || "");
    $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.route === route));
    $$(".rail-btn.util").forEach(el => el.classList.toggle("active", el.dataset.route === route));
    const role = currentUser && currentUser.role;
    const mn = route.indexOf("embed/") === 0 ? DATA.menus.find(m => m && m.id === route.slice(6)) : menuForModule(route);
    const hub = mn ? hubOf(mn) : null;
    $$(".tab-btn[data-route]").forEach(el => {
      el.classList.toggle("active", el.dataset.route === route || (!!el.dataset.hub && el.dataset.hub === hub));
    });
    if (role !== "vendor" && role !== "signer") {
      if (hub && $('#nav-menu .hub[data-hub="' + hub + '"]')) activeHub = hub;
      $$("#rail-hubs .rail-btn").forEach(b => b.classList.toggle("cur", b.dataset.hub === hub));
    }
    applyHub();
    renderCrumbs(route, mn, hub);
  }

  /* ─────────── 헤더 위젯 ─────────── */
  function renderHeader() {
    const name = currentUser.name || "";
    const roleLabel = ROLE_LABEL[currentUser.role] || currentUser.role;
    $("#user-chip").innerHTML = '<span class="uc-av" aria-hidden="true">' + esc(name.slice(0, 1) || "?") + '</span>' +
      '<span class="uc-txt">' + esc(name === roleLabel ? name : name + " · " + roleLabel) + '</span>';
    $("#user-chip").title = name === roleLabel ? name : name + " · " + roleLabel;
    const lite = currentUser.role === "signer";
    const sw = $("#hdr-search-wrap");
    if (sw) sw.classList.toggle("vendor-hide", lite);
    $$("[data-search-open]").forEach(b => b.classList.toggle("vendor-hide", lite));
    renderSecBadge();
    $("#app-version").textContent = "v" + VERSION;
  }
  function renderSecBadge() {
    const b = $("#sec-level-badge");
    if (!b) return;
    const cur = secCurrent();
    const nxt = secNext();
    b.dataset.level = cur.level;
    b.innerHTML = '<i aria-hidden="true"></i><span class="sb-l">보안등급 · </span>' + esc(cur.level);
    b.title = "국가 항공보안등급: " + cur.level +
      (cur.note ? " — " + cur.note : "") +
      (cur.date ? " (" + cur.date + (cur.end ? " ~ " + cur.end : " ~") + ")" : "") +
      (nxt ? " / 예약: " + nxt.date + "부터 [" + nxt.level + "]" : "");
  }

  /* ─────────── 부팅 ─────────── */
  function enterApp() {
    $("#login-overlay").classList.add("hidden");
    $("#app").classList.remove("hidden");
    renderHeader();
    renderNav();
    renderView();
  }

  function boot() {
    load();

    $("#login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const pw = $("#login-pw").value;
      if (!pw) return;
      const user = login(pw) || signLogin(pw);
      if (user) {
        $("#login-error").textContent = "";
        enterApp();
        toast(user.role === "signer" ? "서명 화면입니다. 본인 이름을 찾아 서명해 주세요." : user.name + "님, 환영합니다.");
      } else {
        $("#login-error").textContent = "암호가 올바르지 않습니다.";
        $("#login-pw").value = "";
        $("#login-pw").focus();
      }
    });
    $("#pw-toggle").addEventListener("click", () => {
      const i = $("#login-pw");
      i.type = i.type === "password" ? "text" : "password";
      i.focus();
    });

    $("#logout-btn").addEventListener("click", logout);
    const sheetLogout = $("#sheet-logout");
    if (sheetLogout) sheetLogout.addEventListener("click", logout);
    $("#menu-toggle").addEventListener("click", togglePanel);
    $("#sidebar-backdrop").addEventListener("click", closeOverlays);
    const sc = $("#sheet-close");
    if (sc) sc.addEventListener("click", closeOverlays);
    $("#modal-overlay").addEventListener("click", (e) => {
      if (e.target === $("#modal-overlay")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#modal-overlay").classList.contains("hidden")) { closeModal(); return; }
      closeOverlays();
    });
    /* 화면 폭이 바뀌면 떠 있는 패널·시트를 정리 (태블릿 회전 등) */
    let lastMode = "";
    window.addEventListener("resize", () => {
      const mode = isMobile() ? "m" : (window.innerWidth < 1100 ? "t" : "d");
      if (mode !== lastMode) { lastMode = mode; closeOverlays(); }
    });
    window.addEventListener("hashchange", () => { if (currentUser) renderView(); });

    if (restoreSession()) { enterApp(); return; }

    /* QR 접속(#/sign/코드) — 암호 입력 없이 바로 서명 화면.
       첫 접속 기기는 공용 DB 동기화가 끝나야 회의 정보가 생기므로 최대 12초 재시도. */
    const qrCode = signCodeFromHash();
    if (qrCode) {
      const pwEl = $("#login-pw"), errEl = $("#login-error");
      if (pwEl) pwEl.value = qrCode;
      if (errEl) errEl.textContent = "회의 정보를 불러오는 중입니다…";
      let tries = 0;
      const tryIn = () => {
        const u = signLogin(qrCode);
        if (u) {
          if (errEl) errEl.textContent = "";
          location.hash = "";
          enterApp();
          toast("서명 화면입니다. 본인 이름을 찾아 서명해 주세요.");
          return;
        }
        if (++tries >= 16) {
          if (errEl) errEl.textContent = "회의 정보를 찾지 못했습니다. [로그인]을 눌러 다시 시도해 주세요.";
          return;
        }
        setTimeout(tryIn, 750);
      };
      setTimeout(tryIn, 300);
      return;
    }
    setTimeout(() => $("#login-pw") && $("#login-pw").focus(), 100);
  }

  /* ═════════════ 모듈 화면 키트 (v1.8) ═════════════
     새 업무 모듈은 아래 조각으로 화면을 구성하면 전체 디자인과 자동으로 맞는다.
       SeMIS.ui.head({ title, meta, desc, actions })   화면 머리말 (A4 인쇄 버튼은 코어가 자동 부착)
       SeMIS.ui.stats([{ label, value, sub, tone }])  요약 수치 띠 (tone: ok · warn · bad · muted)
       SeMIS.ui.search(id, placeholder, value)         검색 입력
       SeMIS.ui.empty(text, actionsHtml)               빈 상태
       SeMIS.ui.chip(text, tone)                       상태 배지 (green · amber · red · blue · gray)
       SeMIS.icon(name, size)                          선 아이콘 (이모지 대신) */
  const ui = {
    icon,
    head(o) {
      o = o || {};
      return '<div class="page-head"><div class="page-title">' + esc(o.title || "") + '</div>' +
        (o.meta ? '<span class="page-meta">' + esc(o.meta) + '</span>' : "") +
        '<span class="spacer"></span>' + (o.actions || "") +
        (o.desc ? '<div class="page-desc">' + esc(o.desc) + '</div>' : "") + '</div>';
    },
    stats(list) {
      return '<div class="stat-row">' + (list || []).map(x =>
        '<div class="stat' + (x.tone ? " tone-" + esc(x.tone) : "") + '"><div class="stat-label">' + esc(x.label) + '</div>' +
        '<div class="stat-value">' + esc(x.value == null ? "-" : x.value) + '</div>' +
        (x.sub ? '<div class="stat-sub">' + esc(x.sub) + '</div>' : "") + '</div>').join("") + '</div>';
    },
    search(id, placeholder, value) {
      return '<label class="search-field">' + icon("search", 17) + '<input id="' + esc(id) + '" type="search" autocomplete="off" placeholder="' +
        esc(placeholder || "검색") + '" value="' + esc(value || "") + '"></label>';
    },
    empty(text, actions) {
      return '<div class="empty-state">' + icon("folder", 26) + '<p>' + esc(text || "등록된 항목이 없습니다.") + '</p>' + (actions || "") + '</div>';
    },
    chip(text, tone) { return '<span class="badge badge-' + esc(tone || "gray") + '">' + esc(text) + '</span>'; },
    /* 설명 말풍선 — 입력 화면에서 설명 문구를 걷어내고 ⓘ 버튼으로만 보여 준다(마우스 올림·포커스·탭) */
    tip(text, label) {
      return '<button type="button" class="help-tip" data-tip="' + esc(text) + '" aria-label="' + esc(label || "설명") +
        '" aria-expanded="false">' + icon("info", 16) + '</button>';
    }
  };

  /* 설명 말풍선 동작: 문서 전체에 한 번만 위임. 화면에 하나만 뜨고 Esc·바깥 클릭·스크롤로 닫힌다.
     마우스를 말풍선 위로 옮겨도 닫히지 않는다(WCAG 1.4.13). */
  let tipEl = null, tipFor = null, tipTimer = 0;
  function tipBox() {
    if (tipEl) return tipEl;
    tipEl = document.createElement("div");
    tipEl.id = "help-tipbox"; tipEl.className = "help-tipbox"; tipEl.setAttribute("role", "tooltip");
    tipEl.addEventListener("mouseenter", () => clearTimeout(tipTimer));
    tipEl.addEventListener("mouseleave", () => hideTip(160));
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(btn) {
    clearTimeout(tipTimer);
    const box = tipBox();
    if (tipFor && tipFor !== btn) tipFor.setAttribute("aria-expanded", "false");
    tipFor = btn;
    box.textContent = btn.getAttribute("data-tip") || "";
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-describedby", "help-tipbox");
    box.classList.add("on");
    const r = btn.getBoundingClientRect(), vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    const w = Math.min(300, vw - 24);
    box.style.maxWidth = w + "px";
    const bw = box.offsetWidth || w, bh = box.offsetHeight || 60;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(12, Math.min(left, vw - bw - 12));
    let top = r.bottom + 8;
    if (top + bh > vh - 8) top = Math.max(8, r.top - bh - 8);
    box.style.left = left + "px"; box.style.top = top + "px";
  }
  function hideTip(delay) {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      if (tipEl) tipEl.classList.remove("on");
      if (tipFor) { tipFor.setAttribute("aria-expanded", "false"); tipFor.removeAttribute("aria-describedby"); }
      tipFor = null;
    }, delay || 0);
  }
  if (typeof document !== "undefined") {
    const fine = () => !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    document.addEventListener("click", (ev) => {
      const b = ev.target.closest && ev.target.closest(".help-tip");
      if (b) { ev.preventDefault(); if (tipFor === b && tipEl && tipEl.classList.contains("on")) hideTip(); else showTip(b); return; }
      if (tipEl && !tipEl.contains(ev.target)) hideTip();
    });
    document.addEventListener("mouseover", (ev) => {
      const b = fine() && ev.target.closest && ev.target.closest(".help-tip");
      if (b) { clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(b), 120); }
    });
    document.addEventListener("mouseout", (ev) => {
      const b = ev.target.closest && ev.target.closest(".help-tip");
      if (b && fine() && !(ev.relatedTarget && tipEl && tipEl.contains(ev.relatedTarget))) hideTip(160);
    });
    document.addEventListener("focusin", (ev) => {
      const b = ev.target.closest && ev.target.closest(".help-tip");
      let kb = false;
      try { kb = ev.target.matches(":focus-visible"); } catch (err) { kb = false; }
      if (b && kb) showTip(b);
    });
    document.addEventListener("focusout", (ev) => { if (ev.target.closest && ev.target.closest(".help-tip")) hideTip(120); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && tipEl && tipEl.classList.contains("on")) { ev.stopPropagation(); hideTip(); } }, true);
    window.addEventListener("scroll", () => { if (tipFor) hideTip(); }, true);
  }

  /* ─────────── 공개 API ─────────── */
  return {
    boot, registerModule, hasModule, navigate,
    get data() { return DATA; },
    save, load, onSave, saveSilent, normalizeData, defaultMenus,
    assignees, seedAssignees,
    get user() { return currentUser; },
    allUsers, isAdmin, roleRank, canEdit, canDelete, canConfid, canSee, navVisible, menuHidden, canHide,
    VENDOR_ACCESS, vendorAccess, vendorHome,
    pwHash, sha256, signCodeFor, signMinuteFor, signCodeFromHash, signUrlFor,
    renderNav, renderHeader, renderSecBadge, renderView, renderPlannedView,
    printView, printTitle, attachPrintBtn, markHub,
    icon, ui, ICONS, HUB_ICONS, hubOf, hubList, hubEntries, utilEntries, homeHubId, openHub, togglePanel, openSheet,
    closeSidebar, closeOverlays, migrateHubs,
    openModal, closeModal, confirmModal, toast,
    $, $$, esc, fmtDate, dsRing, sortedMenus,
    SEC_LEVELS, secCurrent, secNext, levelSorted,
    ROLE_LABEL, ROLE_RANK, VIS_LABEL,
    BASE_USERS, VERSION, APP_NAME, LS_DATA, LS_UI, SS_SESSION
  };
})();

// 전역 노출 (테스트 및 외부 모듈 접근용)
if (typeof window !== "undefined") window.SeMIS = SeMIS;
