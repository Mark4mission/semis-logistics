/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — Core Engine
   인천화물팀 안전보안파트 · 화물터미널 안전보안 관리 정보시스템
   인증 · 저장소 · 메뉴 엔진 · 권한 · 라우터
   (SeMIS v2 코어를 이어받아 데이터·메뉴·팔레트를 독립 구성)
   ═══════════════════════════════════════════════════════ */
"use strict";

const SeMIS = (() => {

  const VERSION = "1.0.1";
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
      hash: "a033918b0ad1c21f2aa2ba2905f1c26a8c1eb14ae58d19d37b73c8cd5106a840" },
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

  /* ─────────── 기본 메뉴 시드 (인천화물팀 안전보안파트 업무 체계) ───────────
     planned:true 항목은 아직 모듈 js가 없는 "예정 모듈" — 라우트가 준비 중 안내 화면을 그린다.
     같은 module id로 SeMIS.registerModule()이 호출되는 순간 실화면으로 자동 대체된다. */
  function defaultMenus() {
    let seq = 0;
    const g  = (id, label) => ({ id, seq: seq++, type: "group",  label });
    const m  = (id, label, icon, module, vis, parent, opts) => Object.assign(
      { id, seq: seq++, type: "module", label, icon, module, vis: vis || "all", parent: parent || null }, opts || {});
    const p  = (id, label, icon, module, vis, parent, desc) => m(id, label, icon, module, vis, parent, { planned: true, desc });
    const lk = (id, label, icon, url, parent, opts) => Object.assign({ id, seq: seq++, type: "link", label, icon, url, vis: "all", parent: parent || null }, opts || {});
    return [
      m("dashboard", "대시보드", "🏠", "dashboard"),
      m("schedule", "일정관리", "📅", "schedule", "mgr"),
      m("minutes", "회의록 게시판", "🗒️", "minutes", "mgr"),
      p("board", "안전보안 현황판", "📊", "board", "mgr",
        null, "무재해 경과일·점검 완료율·미결 시정조치·교육 이수율 등 파트 핵심 지표를 한 화면에 모은 현황판. 각 업무 모듈이 쌓이면 자동 집계로 전환합니다."),

      g("grp-rule", "규정 / 기준"),
      p("reg-sec", "항공보안 규정", "📘", "reg-sec", "all", "grp-rule",
        "항공보안법·국가항공보안계획·자체 보안계획 중 화물 보안(RA/KC·보안검색·보호구역) 관련 조항과 자체 기준을 PDF·링크로 등록하고 개정 이력을 관리합니다."),
      p("reg-safety", "안전관리 규정", "🦺", "reg-safety", "all", "grp-rule",
        "산업안전보건·지상안전(Ramp Safety)·SMS(안전관리체계) 관련 규정과 작업 절차서(SOP)를 관리합니다."),
      p("reg-dg", "위험물(DG) 기준", "☢️", "reg-dg", "all", "grp-rule",
        "IATA DGR·ICAO TI·국토부 고시 등 위험물 취급 기준과 자체 위험물 처리 절차, 교육 요건을 관리합니다."),

      g("grp-cargo", "화물 보안"),
      p("scr-status", "화물 보안검색 현황", "🔎", "scr-status", "mgr", "grp-cargo",
        "일일 보안검색 실적(X-ray·ETD·개봉검색 건수), 미검색·재검색 사유, 검색요원 배치 현황을 기록·집계합니다."),
      p("kc-ra", "상용화주 · RA 관리", "🏷️", "kc-ra", "hq", "grp-cargo",
        "상용화주·보안업체(RA) 지정 현황, 유효기간, 점검 이력, 화물 인수 시 확인 절차를 관리합니다."),
      p("scr-equip", "검색장비 유지관리", "🔧", "scr-equip", "mgr", "grp-cargo",
        "X-ray·ETD 등 검색장비 대장, 일일 점검·교정·고장 이력, 유지보수 계약을 관리합니다. CARES(보안장비 관제)와 연계 예정."),
      p("access", "보안구역 출입 관리", "🪪", "access", "mgr", "grp-cargo",
        "화물터미널 보호구역 출입증·차량 출입·임시 출입 현황과 만료 도래 알림을 관리합니다."),

      g("grp-safety", "안전 관리"),
      p("daily-safety", "일일 안전점검", "✅", "daily-safety", "mgr", "grp-safety",
        "작업장·장비·통로·소방 등 일일 안전점검표를 전산으로 작성하고 미비점을 조치 이력과 함께 관리합니다."),
      p("risk", "위험성 평가", "⚠️", "risk", "hq", "grp-safety",
        "작업별 유해·위험요인 발굴, 5×5 위험도 평가, 감소 대책과 재평가 이력을 관리합니다."),
      p("incident", "사고 · 아차사고 보고", "🚨", "incident", "mgr", "grp-safety",
        "사고·준사고·아차사고(Near-miss) 보고 접수, 원인 분석, 재발 방지 대책과 조치 완료 추적."),
      p("gse", "지상조업(GSE) 안전", "🚜", "gse", "mgr", "grp-safety",
        "지게차·돌리·ULD 장비 등 지상조업 장비 안전 점검, 운전자 자격, 램프 안전 규칙 준수 현황."),

      g("grp-inspect", "점검 / 시정조치"),
      p("inspection", "안전보안 점검 일정", "🕵️", "inspection", "mgr", "grp-inspect",
        "내부 점검·외부 감사(국토부·공항공사·본사 안전심사) 연간 일정과 결과를 관리하고 일정관리와 연동합니다."),
      p("car", "시정조치 (CAR)", "📋", "car", "hq", "grp-inspect",
        "점검·감사에서 나온 부적합을 접수 → 조치중 → 종결 3단계로 추적하고 기한 경과를 에스컬레이션합니다."),

      g("grp-edu", "교육 / 훈련"),
      p("training", "안전보안 교육 관리", "🎓", "training", "mgr", "grp-edu",
        "보안교육(초기·정기)·안전교육(TBM·특별교육)·위험물 교육 계획과 실시 이력, 대상자별 이수 현황."),
      p("certs", "이수증 관리", "🎖", "certs", "mgr", "grp-edu",
        "교육 이수증·자격증(보안검색요원·위험물 취급자·지게차 등) 등록과 만료 도래 알림."),

      g("grp-partner", "협력사 / 조업사"),
      p("partners", "조업사 · 협력사 현황", "🤝", "partners", "mgr", "grp-partner",
        "조업사·경비·청소·유지보수 업체 담당자, 인원, 보안서약·교육 이수 현황."),
      p("contracts", "계약서 관리", "💼", "contracts", "hq", "grp-partner",
        "협력사 계약서·과업지시서 파일과 계약기간·갱신 시점 관리 (대외비)."),

      g("grp-emergency", "비상 대응"),
      Object.assign(m("contacts", "비상연락망 · 보고체계", "☎️", "contacts", "mgr", "grp-emergency"), { quick: true }),

      g("grp-ref", "참고 / 링크"),
      lk("ref-semis", "SeMIS v2 (항공보안파트)", "🛡️", "https://semis.pe.kr/", "grp-ref", { quick: true }),
      lk("ref-cares", "CARES (보안장비 관제)", "🛰", "https://airzeta-security-system.web.app", "grp-ref", { quick: true }),
      lk("ref-icn", "인천공항공사", "🛫", "https://www.airport.kr/", "grp-ref"),
      lk("ref-kosha", "안전보건공단 (KOSHA)", "🦺", "https://www.kosha.or.kr/", "grp-ref"),
      lk("ref-boannews", "보안뉴스", "📰", "https://www.boannews.com/", "grp-ref"),

      m("settings", "시스템 설정", "⚙️", "settings", "admin")
    ];
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
      gcal: { enabled: false, calendarId: "", apiKey: "" },
      minutes: [],       // 회의록 게시판
      minuteFolders: [], // 회의록 폴더 — normalize가 기본 폴더 시드
      contacts: { sections: [] }, // 비상연락망 (실데이터는 공용 DB만 — 코드 미시드)
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
    ensureModuleMenu("settings", null, "시스템 설정", "⚙️", "settings", "admin");
    const dash = DATA.menus.find(m => m.type === "module" && m.module === "dashboard");
    if (dash) { dash.vis = "all"; dash.parent = null; if (dash.seq !== 0) dash.seq = Math.min(0, dash.seq || 0); }
    const st = DATA.menus.find(m => m.type === "module" && m.module === "settings");
    if (st) { st.vis = "admin"; st.parent = null; }
    // 예정 모듈 플래그 보정 (문자열 등 오염 방지)
    DATA.menus.forEach(m => { if (m.planned !== undefined) m.planned = !!m.planned; });

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

    // 비상연락망
    if (!DATA.contacts || typeof DATA.contacts !== "object" || Array.isArray(DATA.contacts)) DATA.contacts = { sections: [] };
    if (!Array.isArray(DATA.contacts.sections)) DATA.contacts.sections = [];

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
    minutes: "mid", contacts: "mid", settings: "mid"
  };
  function applyViewWidth(view, route) {
    const tier = String(route).indexOf("embed/") === 0 ? "wide" : (VIEW_WIDTH[route] || "");
    view.classList.toggle("view-wide", tier === "wide");
    view.classList.toggle("view-mid", tier === "mid");
  }

  /* 예정 모듈 안내 화면 — 메뉴의 planned/desc 로 렌더 */
  function renderPlannedView(root, menu) {
    const desc = menu.desc || "이 메뉴는 업무 모듈로 순차 개발될 예정입니다.";
    root.innerHTML = `
      <div class="ds-head">
        <div class="ds-head-t"><i class="em">${esc(menu.icon || "▪")}</i>${esc(menu.label)} <small>예정 모듈</small></div>
        <span class="spacer"></span>
        <span class="badge badge-amber">준비 중</span>
      </div>
      <div class="ds-grid-side">
        <div class="ds-panel">
          <div class="ds-hd"><span class="ds-pill"><i class="em">🧩</i>모듈 개요</span></div>
          <div class="ds-lead">${esc(desc)}</div>
          <div class="ds-checks" style="margin-top:14px">
            <div class="ds-check"><span>SeMIS · Logistics의 업무 모듈은 <b>한 개씩 독립 파일(js/&lt;모듈&gt;.js)</b>로 추가되며, 추가되는 즉시 이 자리에 실제 화면이 표시됩니다.</span></div>
            <div class="ds-check"><span>메뉴 이름·아이콘·접근 권한·순서는 <b>시스템 설정 → 메뉴 관리</b>에서 지금 바로 조정할 수 있습니다.</span></div>
            <div class="ds-check"><span>이 모듈에 담을 항목·서식·기존 자료(구글 시트·문서 등)는 관리자에게 전달해 주세요.</span></div>
          </div>
        </div>
        <div class="ds-stack">
          <div class="ds-panel ds-panel-tint">
            <div class="ds-hd"><span class="ds-pill ds-pill-lite"><i class="em">📎</i>지금 활용 가능한 기능</span></div>
            <div class="ds-rows">
              <div class="ds-row" data-go="dashboard"><span>🏠</span><span class="ds-row-t">대시보드 · 공지사항</span></div>
              <div class="ds-row" data-go="schedule"><span>📅</span><span class="ds-row-t">일정관리</span></div>
              <div class="ds-row" data-go="minutes"><span>🗒️</span><span class="ds-row-t">회의록 게시판 (QR 참석 서명)</span></div>
              <div class="ds-row" data-go="contacts"><span>☎️</span><span class="ds-row-t">비상연락망 · 보고체계</span></div>
            </div>
          </div>
          <div class="ds-note">관련 자료를 먼저 <b>외부 링크 메뉴</b>로 등록해 두면, 모듈이 열리기 전에도 이 메뉴 그룹에서 바로 열 수 있습니다.</div>
        </div>
      </div>`;
    $$("[data-go]", root).forEach(el => el.onclick = () => navigate(el.dataset.go));
  }

  function renderView() {
    let route = currentRoute();
    const view = $("#view");
    view.innerHTML = "";
    applyViewWidth(view, route);
    if (currentUser && currentUser.role === "vendor") {
      const allow = vendorAccess(currentUser).routes;
      if (allow.indexOf(route) < 0) route = vendorHome(currentUser);
      applyViewWidth(view, route);
      const def = modules[route] || modules.dashboard;
      def.render(view);
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
      if (menu && !canSee(menu)) { toast("접근 권한이 없습니다.", true); def = modules.dashboard; }
      else if (!def && menu && menu.type === "module") {
        // 예정 모듈 — 모듈 js가 아직 없으면 안내 화면
        renderPlannedView(view, menu);
        highlightNav(route);
        closeSidebar();
        return;
      }
      if (!def) def = modules.dashboard;
      def.render(view);
    }
    highlightNav(route);
    closeSidebar();
  }
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#sidebar-backdrop").classList.remove("show");
    $("#main").scrollTop = 0;
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
        <div class="page-title">${esc(mn.icon || "🔗")} ${esc(mn.label)}</div>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="${esc(mn.url)}" target="_blank" rel="noopener">새 탭에서 열기 ↗</a>
        <div class="page-desc">화면이 비어 있으면 해당 사이트가 내부 열기(iframe)를 차단하는 것입니다 — 새 탭에서 열기를 이용하세요.</div>
      </div>
      <iframe class="embed-frame" src="${esc(mn.url)}" title="${esc(mn.label)}"
        allow="fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  }

  function highlightNav(route) {
    $$(".nav-item").forEach(el => {
      el.classList.toggle("active", el.dataset.route === route);
    });
  }

  /* ─────────── 사이드바 렌더 ─────────── */
  function sortedMenus() {
    return DATA.menus.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }
  function renderNav() {
    const box = $("#nav-menu");
    box.innerHTML = "";
    if (currentUser && currentUser.role === "vendor") {
      const acc = vendorAccess(currentUser);
      acc.routes.forEach(r => {
        const mn = menuForModule(r);
        const label = (mn && mn.label) || r;
        const b = document.createElement("button");
        b.className = "nav-item";
        b.dataset.route = r;
        b.title = label;
        b.innerHTML = '<span class="nav-ico">' + esc((mn && mn.icon) || "▪") + '</span><span>' + esc(label) + '</span>';
        b.onclick = () => navigate(r);
        box.appendChild(b);
      });
      acc.links.forEach(l => {
        const a = document.createElement("a");
        a.className = "nav-item";
        a.href = l.url; a.target = "_blank"; a.rel = "noopener"; a.title = l.label;
        a.innerHTML = '<span class="nav-ico">' + esc(l.icon || "🔗") + '</span><span>' + esc(l.label) + '</span><span class="ext-mark">↗</span>';
        box.appendChild(a);
      });
      const cur = currentRoute();
      highlightNav(acc.routes.indexOf(cur) >= 0 ? cur : vendorHome(currentUser));
      return;
    }
    if (currentUser && currentUser.role === "signer") {
      const b = document.createElement("button");
      b.className = "nav-item active";
      b.dataset.route = "minutes";
      b.innerHTML = '<span class="nav-ico">🗒️</span><span>회의록 · 참석 서명</span>';
      b.onclick = () => renderView();
      box.appendChild(b);
      return;
    }
    const menus = sortedMenus();
    const collapsed = navPrefs().collapsed || {};
    const mini = !!navPrefs().sidebarMini;
    const appEl = $("#app");
    if (appEl) appEl.classList.toggle("sidebar-mini", mini);

    const itemEl = (mn) => {
      if (mn.type === "link") {
        if (mn.open === "frame") {
          const b2 = document.createElement("button");
          b2.className = "nav-item";
          b2.dataset.route = "embed/" + mn.id;
          b2.title = mn.label;
          b2.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "🔗") + '</span><span>' + esc(mn.label) + '</span><span class="ext-mark">▣</span>';
          b2.onclick = () => navigate("embed/" + mn.id);
          return b2;
        }
        const a = document.createElement("a");
        a.className = "nav-item";
        a.href = mn.url; a.target = "_blank"; a.rel = "noopener"; a.title = mn.label;
        a.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "🔗") + '</span><span>' + esc(mn.label) + '</span><span class="ext-mark">↗</span>';
        return a;
      }
      const b = document.createElement("button");
      const planned = !!mn.planned && !modules[mn.module];
      b.className = "nav-item" + (planned ? " planned" : "");
      b.dataset.route = mn.module;
      b.title = mn.label + (planned ? " (준비 중)" : "");
      b.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "▪") + '</span><span>' + esc(mn.label) + '</span>' +
        (planned ? '<span class="nav-tag">예정</span>' : "");
      b.onclick = () => navigate(mn.module);
      return b;
    };

    const groupIds = menus.filter(g => g.type === "group" &&
      menus.some(c => c.parent === g.id && canSee(c))).map(g => g.id);
    const allCollapsed = groupIds.length > 0 && groupIds.every(id => collapsed[id]);
    const bar = document.createElement("div");
    bar.className = "nav-toolbar";
    bar.innerHTML =
      '<button type="button" class="nav-tool-btn" id="nav-toggle-all" title="' +
        (allCollapsed ? "모두 펼치기" : "모두 접기") + '">' +
        '<span class="nt-ico">' + (allCollapsed ? "⊞" : "⊟") + '</span>' +
        '<span class="nt-txt">' + (allCollapsed ? "모두 펼치기" : "모두 접기") + '</span></button>' +
      '<button type="button" class="nav-tool-btn nav-tool-mini" id="nav-toggle-mini" title="' +
        (mini ? "사이드바 확대" : "사이드바 축소") + '" aria-label="사이드바 축소/확대">' +
        (mini ? "»" : "«") + '</button>';
    box.appendChild(bar);
    bar.querySelector("#nav-toggle-all").onclick = () => {
      const c = Object.assign({}, navPrefs().collapsed || {});
      const collapseNow = !allCollapsed;
      groupIds.forEach(id => { c[id] = collapseNow; });
      setNavPref({ collapsed: c });
      renderNav();
    };
    bar.querySelector("#nav-toggle-mini").onclick = () => {
      setNavPref({ sidebarMini: !navPrefs().sidebarMini });
      renderNav();
    };

    menus.filter(mn => !mn.parent || mn.type === "group").forEach(mn => {
      if (mn.type === "group") {
        const children = menus.filter(c => c.parent === mn.id && canSee(c));
        if (!children.length) return;
        const wrap = document.createElement("div");
        wrap.className = "nav-group" + (collapsed[mn.id] ? " collapsed" : "");
        const head = document.createElement("button");
        head.className = "nav-group-label";
        head.innerHTML = "<span>" + esc(mn.label) + '</span><span class="chev">▼</span>';
        head.onclick = () => {
          wrap.classList.toggle("collapsed");
          const c = Object.assign({}, navPrefs().collapsed || {});
          c[mn.id] = wrap.classList.contains("collapsed");
          setNavPref({ collapsed: c });
          renderNav();
        };
        const inner = document.createElement("div");
        inner.className = "nav-group-items";
        children.forEach(c => inner.appendChild(itemEl(c)));
        wrap.appendChild(head);
        wrap.appendChild(inner);
        box.appendChild(wrap);
      } else if (canSee(mn)) {
        box.appendChild(itemEl(mn));
      }
    });

    highlightNav(currentRoute());
  }

  /* ─────────── 헤더 위젯 ─────────── */
  function renderHeader() {
    $("#user-chip").textContent = currentUser.name + " · " + (ROLE_LABEL[currentUser.role] || currentUser.role);
    const lite = currentUser.role === "signer";
    const sw = $("#hdr-search-wrap"), sb = $("#hdr-search-btn");
    if (sw) sw.classList.toggle("vendor-hide", lite);
    if (sb) sb.classList.toggle("vendor-hide", lite);
    renderSecBadge();
    $("#app-version").textContent = "v" + VERSION;
  }
  function renderSecBadge() {
    const b = $("#sec-level-badge");
    if (!b) return;
    const cur = secCurrent();
    const nxt = secNext();
    b.dataset.level = cur.level;
    b.textContent = "보안등급 · " + cur.level;
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
    $("#menu-toggle").addEventListener("click", () => {
      $("#sidebar").classList.toggle("open");
      $("#sidebar-backdrop").classList.toggle("show", $("#sidebar").classList.contains("open"));
    });
    $("#sidebar-backdrop").addEventListener("click", () => {
      $("#sidebar").classList.remove("open");
      $("#sidebar-backdrop").classList.remove("show");
    });
    $("#modal-overlay").addEventListener("click", (e) => {
      if (e.target === $("#modal-overlay")) closeModal();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
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

  /* ─────────── 공개 API ─────────── */
  return {
    boot, registerModule, hasModule, navigate,
    get data() { return DATA; },
    save, load, onSave, saveSilent, normalizeData, defaultMenus,
    get user() { return currentUser; },
    allUsers, isAdmin, roleRank, canEdit, canDelete, canConfid, canSee,
    VENDOR_ACCESS, vendorAccess, vendorHome,
    pwHash, sha256, signCodeFor, signMinuteFor, signCodeFromHash, signUrlFor,
    renderNav, renderHeader, renderSecBadge, renderView, renderPlannedView,
    openModal, closeModal, confirmModal, toast,
    $, $$, esc, fmtDate, dsRing, sortedMenus,
    SEC_LEVELS, secCurrent, secNext, levelSorted,
    ROLE_LABEL, ROLE_RANK, VIS_LABEL,
    BASE_USERS, VERSION, APP_NAME, LS_DATA, LS_UI, SS_SESSION
  };
})();

// 전역 노출 (테스트 및 외부 모듈 접근용)
if (typeof window !== "undefined") window.SeMIS = SeMIS;
