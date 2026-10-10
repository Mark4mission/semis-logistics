/* 코어 — 인증 · 저장소 · 메뉴 엔진 · 권한 · 라우터 (SeMIS v2 코어에서 분기, 데이터·메뉴 독립) */
"use strict";

const SeMIS = (() => {

  const VERSION = "1.49.1";
  const APP_NAME = "ARGOS";
  /* 데이터 캐시는 탭 sessionStorage 에만(탭 닫기·로그아웃 시 소멸). 화면 설정(LS_UI)만 localStorage */
  const LS_DATA = "semisl:data";
  const LS_UI   = "semisl:ui";
  const SS_OWNER = "semisl:owner";   // 캐시 주인 — 다른 계정이 로그인하면 캐시를 비운다
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };


  /* ── 계정 ──
     계정·암호는 서버 전용 표(semis_logi_private.accounts)에만 — 코드와 공용 데이터에 두지 않는다 */
  const ROLE_LABEL = { admin: "시스템관리자", hq: "안전보안파트", manager: "화물팀 관리자", user: "일반사용자", vendor: "협력업체", signer: "서명 참석자" };
  /* 권한 서열: admin(4) > hq(3) > manager(2) > user(1)
     - admin:   모든 기능 + 시스템 설정
     - hq:      안전보안파트원 — 시스템 설정 외 모든 기능(편집 포함)
     - manager: 화물팀 관리자·현장 감독자 — 관리 항목 열람, 편집 불가
     - user:    화물팀 직원·조업사 — 일반·안내 수준만 열람
     - vendor:  협력업체 — 업체별 허용 라우트만 (VENDOR_ACCESS), edit:true면 그 안에서 hq 동등
     - signer:  회의록 참석 서명 전용 세션 (QR / 6자리 코드) */
  const ROLE_RANK  = { admin: 4, hq: 3, manager: 2, user: 1, vendor: 1, signer: 0 };

  /* 협력업체(vendor) 접근 범위 — 업체명별 화이트리스트(없으면 VENDOR_DEFAULT)
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

  /* ── 국가 항공보안등급(5단계) — 화물터미널도 동일 체계 ── */
  const SEC_LEVELS = ["평시", "관심", "주의", "경계", "심각"];
  const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
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

  /* ── 선 아이콘(1.75px stroke) ──
     SeMIS.icon(name, size) → SVG 문자열. 허브(그룹) 메뉴는 ico 필드에 이 키를 지정 */
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
    patrol: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18h7.3a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7h7.3"/>',
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
    clip: '<path d="M20 11.5 12.4 19a4.6 4.6 0 0 1-6.5-6.5l7.7-7.6a3.1 3.1 0 0 1 4.4 4.4l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2L15 7.9"/>',
    send: '<path d="M4.5 12.2 19.5 5l-4.4 14.5-3.6-6.2z"/><path d="m11.5 13.3 8-8.3"/>',
    down: '<path d="M12 4v11"/><path d="m7.5 11.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/><path d="M6.5 7l.8 12.3a1 1 0 0 0 1 .95h7.4a1 1 0 0 0 1-.95L17.5 7"/><path d="M10.5 11v5.5M13.5 11v5.5"/>',
    plane: '<path d="M12 2.8c.9 0 1.4.9 1.4 2v4.7l6.8 4v1.9l-6.8-2v4.1l2.1 1.5v1.6L12 19.8l-3.5.8V19l2.1-1.5v-4.1l-6.8 2v-1.9l6.8-4V4.8c0-1.1.5-2 1.4-2z"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.5-1-2.6 0-1 .8-1.7 1.8-1.7h2.1a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.2-8.5-7.2z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="8" r="1"/>'
  };
  /* 링크 메뉴에서 고르는 선 아이콘 */
  Object.assign(ICONS, {
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4"/><path d="M12 11.5v9"/><path d="m7.8 5.5 8.4 4"/>',
    truck: '<path d="M2.5 6.5h11v9h-11z"/><path d="M13.5 9.5h4l3 3.2v2.8h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
    building: '<path d="M4 20.5V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15 5v15.5"/><path d="M15 9.5h3.5A1.5 1.5 0 0 1 20 11v9.5"/><path d="M2.5 20.5h19"/><path d="M8 7.5h3M8 11h3M8 14.5h3"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    shirt: '<path d="M8.5 3.5 4 6l-1.5 4.5 3 1.2v8.8h13v-8.8l3-1.2L20 6l-4.5-2.5c-.6 1.6-1.9 2.5-3.5 2.5s-2.9-.9-3.5-2.5z"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    map: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    wrench: '<path d="M15.2 4.3a4.5 4.5 0 0 0-5.6 5.9L3.8 16a2 2 0 0 0 2.8 2.8l5.8-5.8a4.5 4.5 0 0 0 5.9-5.6l-2.6 2.6-2.5-.6-.6-2.5z"/>',
    edit: '<path d="M4.5 19.5 5 16 15.5 5.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="m13.5 7.5 3 3"/>',
    chevl: '<path d="m15 6-6 6 6 6"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 3.5 3.5L15 14l5 4.5"/>',
    chevup: '<path d="m6 15 6-6 6 6"/>',
    eyeoff: '<path d="M4 4l16 16"/><path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.4 7.2A17.3 17.3 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>'
  });
  /* 허브 선택용 아이콘 목록 (시스템 설정 → 메뉴 관리) */
  const HUB_ICONS = ["home", "scan", "hardhat", "clipboard", "users", "book", "folder", "calendar", "notes", "alert", "link", "doc"];
  /* 링크 메뉴 아이콘 우선순위: 사이트 아이콘(fav, 64px PNG data URL) → 선 아이콘(ico + tone) → 이모지(icon) → 기본 */
  const LINK_ICONS = ["link", "globe", "monitor", "plane", "box", "truck", "building", "shield", "scan", "xray", "etd", "chart",
    "database", "doc", "folder", "book", "calendar", "clock", "mail", "phone", "users", "user", "shirt", "star", "map", "wrench",
    "car", "bell", "lock", "alert"];
  const LINK_TONES = ["teal", "blue", "indigo", "violet", "rose", "amber", "green", "slate"];
  const FAV_RE = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const FAV_MAX = 60000;
  function favOk(s) { return typeof s === "string" && s.length <= FAV_MAX && FAV_RE.test(s); }
  function linkIconHTML(m, cls) {
    const c = "lki" + (cls ? " " + cls : "");
    if (m && favOk(m.fav)) return '<span class="' + c + ' lki-img"><img src="' + esc(m.fav) + '" alt="" decoding="async"></span>';
    if (m && m.ico && ICONS[m.ico]) {
      const tone = LINK_TONES.indexOf(m.tone) >= 0 ? m.tone : "teal";
      return '<span class="' + c + ' lki-ico t-' + tone + '">' + icon(m.ico, 20) + '</span>';
    }
    if (m && m.icon && m.icon !== "🔗") return '<span class="' + c + ' lki-emo">' + esc(m.icon) + '</span>';
    return '<span class="' + c + ' lki-ico t-teal">' + icon(m && m.type === "link" && m.open === "group" ? "folder" : "link", 20) + '</span>';
  }
  function icon(name, size) {
    const d = ICONS[name] || ICONS.folder;
    const z = size || 20;
    return '<svg class="ico" width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  /* ── 기본 메뉴 시드 ──
     허브(group)는 레일, 하위 메뉴는 허브 패널. 탭 묶음(bundle)은 패널에 한 줄 — 누르면 첫 화면, 화면 위 탭으로 서로 이동.
     대시보드는 최상위지만 홈 허브 첫 항목, 나머지 최상위(암호 관리 · 시스템 설정)는 레일 아래 유틸리티.
     planned:true = 모듈 js 가 아직 없는 예정 모듈 — 같은 module id 로 registerModule() 되면 실화면 */
  function defaultMenus() {
    let seq = 0;
    const h  = (id, label, ico) => ({ id, seq: seq++, type: "group", label, ico });
    const m  = (id, label, icon, module, vis, parent, opts) => Object.assign(
      { id, seq: seq++, type: "module", label, icon, module, vis: vis || "all", parent: parent || null }, opts || {});
    const p  = (id, label, icon, module, vis, parent, desc) => m(id, label, icon, module, vis, parent, { planned: true, desc });
    const b  = (id, label, parent) => ({ id, seq: seq++, type: "bundle", label, vis: "all", parent });
    const lk = (id, label, icon, url, parent, opts) => Object.assign({ id, seq: seq++, type: "link", label, icon, url, vis: "all", parent: parent || null }, opts || {});
    return [
      m("dashboard", "대시보드", "🏠", "dashboard", "all", null, { mv: MENU_VER }),

      h("hub-home", "홈", "home"),
      m("schedule", "일정관리", "📅", "schedule", "mgr", "hub-home"),
      m("minutes", "회의록", "🗒️", "minutes", "mgr", "hub-home"),
      m("flight", "운항 현황", "✈️", "flight", "all", "hub-home"),
      m("shortcuts", "바로가기", "🔗", "shortcuts", "all", "hub-home"),

      h("hub-sec", "화물 보안", "scan"),
      m("sec-dash", "화물보안 대시보드", "📊", "sec-dash", "mgr", "hub-sec"),
      m("scr-status", "보안검색 현황", "🔎", "scr-status", "mgr", "hub-sec"),
      m("scr-equip", "검색장비 관리", "🔧", "scr-equip", "mgr", "hub-sec"),
      m("sec-cases", "보안 처리 대장", "🗃️", "sec-cases", "mgr", "hub-sec"),
      m("kc-ra", "상용화주 · RA", "🏷️", "kc-ra", "hq", "hub-sec"),
      m("partners", "협력사 · 보안요원", "🤝", "partners", "mgr", "hub-sec"),
      p("access", "보안구역 출입 관리", "🪪", "access", "mgr", "hub-sec",
        "화물터미널 보호구역 출입증·차량 출입·임시 출입 현황과 만료 도래 알림을 관리합니다."),

      h("hub-saf", "안전 관리", "hardhat"),
      p("risk", "위험성 평가", "⚠️", "risk", "hq", "hub-saf",
        "작업별 유해·위험요인 발굴, 5×5 위험도 평가, 감소 대책과 재평가 이력을 관리합니다."),
      p("incident", "사고 · 아차사고 보고", "🚨", "incident", "mgr", "hub-saf",
        "사고·준사고·아차사고(Near-miss) 보고 접수, 원인 분석, 재발 방지 대책과 조치 완료 추적."),
      p("gse", "지상조업(GSE) 안전", "🚜", "gse", "mgr", "hub-saf",
        "지게차·돌리·ULD 장비 등 지상조업 장비 안전 점검, 운전자 자격, 램프 안전 규칙 준수 현황."),

      h("hub-aud", "점검 · 교육", "clipboard"),
      m("aud-dash", "점검 · 교육 대시보드", "📊", "aud-dash", "mgr", "hub-aud"),
      b("bd-check", "점검 · 순찰", "hub-aud"),
      m("inspection", "보안 기록부", "📒", "inspection", "mgr", "bd-check", { tab: "보안 기록부" }),
      m("daily-safety", "일일 보안 · 안전 순찰일지", "📝", "daily-safety", "mgr", "bd-check", { tab: "순찰일지" }),
      b("bd-audit", "수검 대응", "hub-aud"),
      m("audit", "수검 대응 센터", "🗂️", "audit", "mgr", "bd-audit", { tab: "수검 · 지적사항" }),
      m("selfcheck", "자체 보안점검", "🧾", "selfcheck", "mgr", "bd-audit", { tab: "자체 보안점검" }),
      b("bd-edu", "보안교육", "hub-aud"),
      m("training", "보안교육 · 자격 관리", "🎓", "training", "mgr", "bd-edu", { tab: "이수 · 자격" }),
      m("dissem", "보안 전파교육", "📣", "dissem", "mgr", "bd-edu", { tab: "전파교육" }),

      h("hub-ops", "비상 · 연락", "users"),
      m("serp", "팀위기대응 (SERP)", "🛟", "serp", "mgr", "hub-ops"),
      m("threat", "위협전화 대응", "📞", "threat", "mgr", "hub-ops"),
      b("bd-contact", "연락처", "hub-ops"),
      m("phonebook", "업무 연락처", "📇", "phonebook", "mgr", "bd-contact", { tab: "업무 연락처" }),
      m("contacts", "비상연락망 · 보고체계", "☎️", "contacts", "mgr", "bd-contact", { tab: "비상연락망 · 체계도", quick: true }),
      m("crisis", "위기대응 담당자", "🧭", "crisis", "mgr", "bd-contact", { tab: "위기대응 조직" }),

      h("hub-doc", "규정 · 문서", "book"),
      b("bd-regs", "규정", "hub-doc"),
      m("reg-sec", "항공보안 규정", "📘", "reg-sec", "mgr", "bd-regs", { tab: "항공보안" }),
      m("reg-safety", "안전관리 규정", "🦺", "reg-safety", "mgr", "bd-regs", { tab: "안전관리" }),
      m("reg-dg", "위험물(DG) 기준", "☢️", "reg-dg", "mgr", "bd-regs", { tab: "위험물" }),
      m("contracts", "계약 · 협약", "💼", "contracts", "hq", "hub-doc"),
      lk("ref-semis", "SeMIS v2 (항공보안파트)", "🛡️", "https://semis.pe.kr/", "hub-doc", { quick: true }),
      lk("ref-cares", "CARES (보안장비 관제)", "🛰", "https://airzeta-security-system.web.app", "hub-doc", { quick: true }),
      lk("ref-icn", "인천공항공사", "🛫", "https://www.airport.kr/", "hub-doc"),
      lk("ref-kosha", "안전보건공단 (KOSHA)", "🦺", "https://www.kosha.or.kr/", "hub-doc"),
      lk("ref-boannews", "보안뉴스", "📰", "https://www.boannews.com/", "hub-doc"),

      m("vault", "암호 관리", "🔐", "vault", "hq"),
      m("settings", "시스템 설정", "⚙️", "settings", "admin")
    ];
  }

  /* ── 메뉴 구조 2판(탭 묶음 · 허브 재배치) — 대시보드 메뉴의 mv 로 한 번만.
     시드에 있는 메뉴는 시드 자리(소속 · 순서)로 옮기고, 이름은 운영자가 바꾸지 않았을 때만 새 이름으로.
     시드에 없는 메뉴(운영자가 만든 링크 등)는 그대로. 예정 '현황판' · 'CAR' 는 지운다 */
  const MENU_VER = 2;
  const RENAMED = {
    "hub-ops": ["협력 · 비상", "비상 · 연락"], "hub-doc": ["규정 · 자료", "규정 · 문서"],
    minutes: ["회의록 게시판", "회의록"], "scr-status": ["화물 보안검색 현황", "보안검색 현황"],
    "scr-equip": ["검색장비 유지관리", "검색장비 관리"], "kc-ra": ["상용화주 · RA 관리", "상용화주 · RA"],
    contracts: ["계약 · 협약 관리", "계약 · 협약"], serp: ["팀위기대응계획 (SERP)", "팀위기대응 (SERP)"],
    threat: ["테러 위협전화 대응", "위협전화 대응"]
  };
  const menuKey = (m) => m.type === "module" ? "m:" + m.module : "i:" + m.id;
  /* 메뉴가 아니라 지원 카드 · 패널로 여는 기능 — 운영 메뉴에 남아 있으면 정규화가 지운다 */
  const PANEL_ONLY = ["desk"];
  function migrateMenus(dash) {
    if (!dash || (Number(dash.mv) || 0) >= MENU_VER) return;
    const seed = defaultMenus();
    let menus = DATA.menus.filter(m => !(m.type === "module" && m.planned && (m.module === "board" || m.module === "car") && !modules[m.module]));
    seed.filter(s => s.type === "bundle").forEach(s => {
      if (!menus.some(m => m.id === s.id)) menus.push(Object.assign({}, s));
    });
    const bySeedKey = {};
    menus.forEach(m => { bySeedKey[menuKey(m)] = m; });
    const kids = {};
    seed.forEach(s => {
      if (s.type === "link" || s.type === "group") return;
      const m = bySeedKey[menuKey(s)];
      if (!m || !s.parent) return;
      m.parent = s.parent;
      (kids[s.parent] = kids[s.parent] || []).push(m);
      if (s.tab && !m.tab) m.tab = s.tab;
    });
    const seqOf = (id) => { const x = menus.find(m => m.id === id); return x ? Number(x.seq) || 0 : 0; };
    const place = (pid, step) => (kids[pid] || []).forEach((m, k) => { m.seq = Math.round((seqOf(pid) + (k + 1) * step) * 1e4) / 1e4; });
    seed.filter(s => s.type === "group").forEach(g => place(g.id, 0.01));
    seed.filter(s => s.type === "bundle").forEach(bd => place(bd.id, 0.001));
    menus.forEach(m => {
      const r = RENAMED[m.type === "module" ? m.module : m.id];
      if (r && m.label === r[0]) m.label = r[1];
    });
    DATA.menus = menus;
    dash.mv = MENU_VER;
  }

  /* ── 일정 담당자 카테고리 ──
     일정관리 담당자 태그 목록(시스템 설정 → 담당자 관리). 목록에 없는 이름도 일정 폼에서 자유 입력 가능 */
  function seedAssignees() {
    return [];
  }
  function assignees() {
    return (Array.isArray(DATA.assignees) ? DATA.assignees : [])
      .slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }

  /* ── 저장소 ── */
  function freshData() {
    return {
      version: 1,
      menus: defaultMenus(),
      notices: [{
        id: "n" + Date.now(),
        title: "ARGOS 오픈 안내",
        body: "인천화물팀 안전보안 종합정보 플랫폼 ARGOS가 열렸습니다.\n\n- 좌측 메뉴에서 각 업무 화면으로 이동할 수 있습니다.\n- '예정' 표시가 있는 메뉴는 준비 중인 업무 모듈로, 순차적으로 열립니다.\n- 문의: 인천화물팀 안전보안파트",
        author: "시스템관리자", pinned: true, created: new Date().toISOString()
      }],
      levelHistory: [{ id: "lv0", date: new Date().toISOString().slice(0, 10), level: "평시",
        note: "ARGOS 개설", by: "시스템", at: new Date().toISOString() }],
      safetyBoard: { since: "", note: "" }, // 무재해 기준일(대시보드 현황판)
      schedules: [],     // 일정관리
      assignees: [],     // 일정 담당자 카테고리 — normalize 가 기본값 시드
      gcal: { enabled: false, calendarId: "", apiKey: "" },
      minutes: [],       // 회의록
      minuteFolders: [], // 회의록 폴더 — normalize가 기본 폴더 시드
      contacts: { sections: [] }, // 비상연락망 (실데이터는 공용 DB만 — 코드 미시드)
      crisis: { rows: [] },        // 위기대응 담당자 (명단은 공용 DB만 — 코드 미시드)
      phonebook: { groups: [], rows: [] }, // 업무 연락처 (공용 DB만 — 코드 미시드)
      serp: {},          // 팀위기대응계획 (계획 원문 · 명단은 공용 DB만 — 코드 미시드)
      serpRuns: [],      // SERP 대응 기록 (실제 · 훈련)
      threat: {},        // 테러 위협전화 대응 (절차 원문 · 번호는 공용 DB만 — 코드 미시드)
      threatRuns: [],    // 위협전화 접수 기록 (실제 · 훈련)
      threatChecks: [],  // 녹음 전화 점검 기록
      secPost: {},       // 경비대원 배치도 — 지점 목록 (민감보안정보: 공용 DB만 — 코드 미시드)
      secPostImg: {},    // 경비대원 배치도 — 바탕 도면(WebP data URL, 공용 DB만)
      vault: { v: 1, members: [], data: null, personal: {}, updated: "" }, // 암호 관리 (클라이언트 AES-256 암호화)
      regulations: [],   // 규정 관리 (항공보안 / 안전관리 / 위험물 DG)
      fleet: [],         // 운항 현황 기체 목록 [{reg, hex, type, model}] — 비어 있으면 기본 15대(js/flightcore.js)
      equipment: [],     // 검색장비 대장 (상태·고장·점검은 CARES 실시간 — js/cares.js)
      audits: [],        // 수검 대응 센터 (js/audit.js)
      training: { courses: [], people: [], records: [], sessions: [] }, // 보안교육 · 자격 관리 (명부는 공용 DB만)
      seclog: [],                                   // 보안 기록부 기록 (js/seclog.js)
      seclogCfg: { since: "", templates: [] },      // 보안 기록부 점검 양식 (비면 코드 뼈대 — 점검 항목은 공용 DB만)
      patrol: [],        // 일일 보안 · 안전 순찰일지 하루 기록 (js/patrol.js)
      patrolCfg: {},     // 순찰일지 양식 (점검사항 문구는 공용 DB만 — 코드는 구분 뼈대)
      patrolPeople: [],  // 순찰자 · 보안감독자와 등록 서명 (명단은 공용 DB만)
      selfCheckCfg: {},  // 자체 보안점검 안내 — 주체 · 대상 · 주기 덮어쓰기 (비면 코드 기본값)
      selfChecks: [],    // 자체 보안점검 — 국가항공보안 수준관리지침 별표 점검표 기록 (js/selfcheck.js)
      docs: [],          // 증빙 문서 서가 (js/docshelf.js, 문서 목록은 공용 DB만)
      partners: {},      // 협력사 · 보안요원 (명부는 공용 DB만)
      contracts: [],     // 계약 · 협약
      kcra: {},          // 상용화주 · RA
      secCases: [],      // 보안 처리 대장
      dissem: {},        // 보안 전파교육
      scrStats: {},      // 화물 보안검색 실적 (월별 합계)
      desk: { cfg: {}, log: [] }   // 메인 데스크 — 분야별 담당 · 접수 대장 (js/desk.js)
    };
  }

  let DATA = null;
  function load() {
    try {
      const raw = store.get(LS_DATA);
      if (raw) { DATA = JSON.parse(raw); }
    } catch (e) { DATA = null; }
    if (!DATA) DATA = freshData();
    normalizeData();
    save();
  }

  /* 시드상 소속이 지금 데이터에 있으면 그대로, 탭 묶음이 없어졌으면 그 묶음의 허브 */
  function seedParent(s, seed) {
    let pid = s.parent || null;
    for (let i = 0; pid && i < 3; i++) {
      if (DATA.menus.some(m => m.id === pid && (m.type === "group" || m.type === "bundle"))) return pid;
      const up = seed.find(x => x.id === pid);
      pid = up ? up.parent || null : null;
    }
    return null;
  }
  /* 시드의 실모듈 메뉴가 데이터에 없으면 시드 순서상 바로 앞 메뉴 뒤에 넣는다 — 있는 메뉴(이름 · 숨김 · 위치)는 그대로 */
  function ensureSeedMenus() {
    const menus = DATA.menus;
    const keyOf = menuKey;
    const seed = defaultMenus();
    seed.forEach((s, i) => {
      if (s.type !== "module" || s.planned || menus.some(m => keyOf(m) === keyOf(s))) return;
      const parent = seedParent(s, seed);
      let prev = null;
      for (let j = i - 1; j >= 0 && !prev; j--) {
        const p = seed[j];
        if ((p.parent || null) === s.parent) prev = menus.find(m => keyOf(m) === keyOf(p)) || null;
      }
      if (!prev && parent) prev = menus.find(m => m.id === parent) || null;
      let seq = menus.reduce((mx, m) => Math.max(mx, Number(m.seq) || 0), 0) + 1;
      if (prev) {
        const p0 = Number(prev.seq) || 0;
        const nx = menus.map(m => Number(m.seq) || 0).filter(v => v > p0);
        seq = nx.length ? (p0 + Math.min.apply(null, nx)) / 2 : p0 + 0.5;
      }
      const id = menus.some(m => m.id === s.id) ? s.id + "-" + Date.now().toString(36) : s.id;
      menus.push(Object.assign({}, s, { id, seq, parent }));
    });
  }

  /* 데이터 정규화·마이그레이션(멱등) — load() 와 동기화 pull·원격 반영 뒤에도 호출되어
     서버의 옛 형식 데이터가 로컬 마이그레이션을 되돌리지 않게 한다. 변경 여부 반환 */
  function normalizeData() {
    const before = JSON.stringify(DATA);
    if (!Array.isArray(DATA.menus) || !DATA.menus.length) DATA.menus = defaultMenus();
    DATA.menus = DATA.menus.filter(m => m && typeof m === "object" && m.id && !(m.type === "module" && PANEL_ONLY.indexOf(m.module) >= 0));
    // 허브 아이콘 보정 — 알 수 없는 키는 folder
    DATA.menus.forEach(m => { if (m.type === "group" && (!m.ico || !ICONS[m.ico])) m.ico = "folder"; });
    ensureSeedMenus();
    const dash = DATA.menus.find(m => m.type === "module" && m.module === "dashboard");
    migrateMenus(dash);
    // 탭 묶음 소속이 풀린 메뉴(옛 화면이 저장한 경우 등)는 시드 자리로
    const seedAll = defaultMenus();
    DATA.menus.forEach(m => {
      if (m.type !== "module" || m.parent) return;
      const s = seedAll.find(x => x.type === "module" && x.module === m.module);
      const sp = s && s.parent ? seedAll.find(x => x.id === s.parent) : null;
      if (sp && sp.type === "bundle") m.parent = seedParent(s, seedAll);
    });
    if (dash) { dash.vis = "all"; dash.parent = null; if (dash.seq !== 0) dash.seq = Math.min(0, dash.seq || 0); }
    const st = DATA.menus.find(m => m.type === "module" && m.module === "settings");
    if (st) { st.vis = "admin"; st.parent = null; }
    const vt = DATA.menus.find(m => m.type === "module" && m.module === "vault");
    if (vt) { vt.parent = null; if (st && (vt.seq || 0) > (st.seq || 0)) vt.seq = (st.seq || 0) - 0.5; }
    // 예정 모듈 플래그 보정(문자열 등 오염 방지)
    DATA.menus.forEach(m => { if (m.planned !== undefined) m.planned = !!m.planned; });
    // 숨김 플래그 정규화 — true 일 때만 보관(멱등). 대시보드·시스템 설정은 숨길 수 없다.
    DATA.menus.forEach(m => {
      if (m.hidden !== undefined && (m.hidden !== true || !canHide(m))) delete m.hidden;
    });
    // 링크 묶음 정합성 — 상위가 사라졌으면 소속 해제, 하위를 가진 링크는 묶음으로 승격
    DATA.menus.forEach(m => {
      if (!m.parent) return;
      const p = DATA.menus.find(x => x.id === m.parent);
      if (!p || (p.type !== "group" && p.type !== "link" && p.type !== "bundle") || (p.type === "bundle" && m.type !== "module")) { m.parent = null; return; }
      if (p.type === "link" && p.open !== "group") p.open = "group";
    });

    DATA.notices = Array.isArray(DATA.notices) ? DATA.notices : [];
    // 옛 캐시의 계정 자료 제거 — 계정은 서버 전용
    delete DATA.pwOverrides; delete DATA.userOverrides; delete DATA.customUsers;
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

    /* 일정 담당자 — 기본값 시드는 최초 1회만(전부 삭제해도 되살아나지 않게 플래그), 필드 보정은 매번 */
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

    // 컬렉션 구조 보정 — 빈 값은 각 모듈이 기본값으로 읽는다
    const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    const obj = (k, def) => { if (!isObj(DATA[k])) DATA[k] = def; return DATA[k]; };
    const arr = (o, k) => { if (!Array.isArray(o[k])) o[k] = []; };
    const rows = (k) => { DATA[k] = (Array.isArray(DATA[k]) ? DATA[k] : []).filter(x => x && typeof x === "object" && x.id); };
    arr(obj("contacts", { sections: [] }), "sections");
    arr(obj("crisis", { rows: [] }), "rows");
    const pb = obj("phonebook", { groups: [], rows: [] });
    arr(pb, "groups"); arr(pb, "rows");
    const tr = obj("training", { courses: [], people: [], records: [], sessions: [] });
    ["courses", "people", "records", "sessions"].forEach(k => arr(tr, k));
    arr(obj("seclogCfg", { since: "", templates: [] }), "templates");
    const sc = obj("selfCheckCfg", {});
    if (!isObj(sc.forms)) sc.forms = {};
    ["serp", "threat", "secPost", "secPostImg", "patrolCfg", "partners", "kcra", "dissem", "scrStats"].forEach(k => obj(k, {}));
    const dk = obj("desk", { cfg: {}, log: [] });
    if (!isObj(dk.cfg)) dk.cfg = {};
    dk.log = (Array.isArray(dk.log) ? dk.log : []).filter(x => x && typeof x === "object" && x.id && x.file && typeof x.file === "object");
    ["serpRuns", "threatRuns", "threatChecks", "equipment", "audits", "seclog", "patrol", "patrolPeople",
      "selfChecks", "docs", "contracts", "secCases"].forEach(rows);
    DATA.equipment.forEach(x => { if (!Array.isArray(x.logs)) x.logs = []; });
    DATA.fleet = (Array.isArray(DATA.fleet) ? DATA.fleet : []).filter(f => f && typeof f === "object" && f.hex);
    DATA.regulations = (Array.isArray(DATA.regulations) ? DATA.regulations : []).filter(r => r && r.id);
    DATA.regulations.forEach(r => {
      if (["sec", "safety", "dg"].indexOf(r.scope) < 0) r.scope = "safety";
      if (!Array.isArray(r.ideas)) r.ideas = [];
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

    // 회의록 — 폴더 기본 시드는 minutes.js가 제공
    if (!Array.isArray(DATA.minutes)) DATA.minutes = [];
    if (!Array.isArray(DATA.minuteFolders)) DATA.minuteFolders = [];
    if (!DATA.minuteFolders.length && typeof window !== "undefined" && window.SemisMinutes && window.SemisMinutes.seedFolders)
      DATA.minuteFolders = window.SemisMinutes.seedFolders();
    if (typeof window !== "undefined" && window.SemisMinutes && window.SemisMinutes.normalizeDecisions) {
      try { window.SemisMinutes.normalizeDecisions(); } catch (e) { /* 보정 실패가 로딩을 막지 않도록 */ }
    }
    // 이스케이프된 채 굳은 서식 본문 복구(공지·회의록)
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
  function saveSilent() { store.set(LS_DATA, JSON.stringify(DATA)); }
  function save() {
    store.set(LS_DATA, JSON.stringify(DATA));
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

  /* ── 인증 — 서버 세션 ──
     암호 확인·권한은 서버(RPC semis_logi_login · semis_logi_whoami), 데이터 권한은 서버 RLS 가 강제.
     토큰·권한 정보는 탭 sessionStorage(SemisSync.auth)에만 */
  let currentUser = null;
  let accountsCache = [];          // 시스템 설정 › 사용자 탭이 서버에서 받아 둔 목록
  let relogin = null;              // 세션 만료 뒤 다시 로그인 중 { owner }
  function allUsers() { return accountsCache.slice(); }
  function setAccounts(list) { accountsCache = Array.isArray(list) ? list.slice() : []; }
  const Auth = () => (typeof window !== "undefined" && window.SemisSync && window.SemisSync.auth) || null;

  function userFrom(d) {
    const u = d && d.user;
    if (!u) return null;
    if (d.kind === "signer" || u.role === "signer")
      return { id: "__signer__", name: u.name || "회의록 참석 서명", role: "signer", signMinuteId: u.signMinuteId || "" };
    return { id: String(u.id || ""), origId: String(u.origId || u.id || ""), name: String(u.name || u.id || ""),
             role: ROLE_RANK[u.role] != null && u.role !== "signer" ? u.role : "user", vendor: String(u.vendor || ""), base: !!u.base };
  }
  const ownerOf = (u) => u ? (u.role === "signer" ? "signer:" + u.signMinuteId : "user:" + u.origId) : "";
  /* 다른 계정의 캐시는 쓰지 않는다 · 읽을 권한이 없는 컬렉션은 기본값으로 비운다 */
  function claimCache(u) {
    if (!DATA) load();
    const owner = ownerOf(u);
    const prev = store.get(SS_OWNER);
    if (prev && prev !== owner) {
      DATA = freshData();
      try { sessionStorage.removeItem("semisl:pendingSync"); sessionStorage.removeItem("semisl:forcePush"); } catch (e) {}
    }
    store.set(SS_OWNER, owner);
    const S = typeof window !== "undefined" ? window.SemisSync : null;
    if (S && S.SYNC_KEYS) {
      const fresh = freshData();
      S.SYNC_KEYS.forEach(k => { if (!S.canRead(k) && fresh[k] !== undefined) DATA[k] = fresh[k]; });
    }
    normalizeData();
    saveSilent();
  }
  /* 서명 세션 — 서버가 준 회의 정보(필요한 만큼)만 로컬 회의록 자리에 둔다(서버로 보내지 않음) */
  function applySignerMinute(m) {
    if (!m || !m.id) { DATA.minutes = []; saveSilent(); return; }
    DATA.minutes = [{
      id: m.id, title: m.title || "", date: m.date || "", time: m.time || "", place: m.place || "", folder: m.folder || "",
      attendees: (m.attendees || []).map(a => ({ name: a.name || "", org: a.org || "", role: a.role || "", note: "", sign: a.signed ? "signed" : "" })),
      decisions: []
    }];
    if (m.folder && !(DATA.minuteFolders || []).some(f => f && f.id === m.folder))
      DATA.minuteFolders = (DATA.minuteFolders || []).concat([{ id: m.folder, seq: 99, icon: m.folderIcon || "🗒", name: m.folderName || "회의", desc: "", place: "", chair: "" }]);
    saveSilent();
  }
  function beginSession(d) {
    const u = userFrom(d);
    if (!u) return null;
    currentUser = u;
    claimCache(u);
    if (u.role === "signer") applySignerMinute(d.minute);
    return u;
  }
  async function login(pw) {
    const A = Auth();
    if (!A) return { ok: false, error: "network" };
    const d = await A.login(pw);
    if (!d || !d.ok) return d || { ok: false, error: "invalid" };
    beginSession(d);
    return d;
  }
  /* 새로고침 — 이 탭의 토큰으로 서버 확인. 네트워크가 안 되면 탭에 남은 정보로 오프라인 진입 */
  async function restoreSession() {
    const A = Auth();
    if (!A || !A.token()) return false;
    let d = null;
    try { d = await A.whoami(true); }
    catch (e) {
      const s = A.session();
      if (s && s.user) { beginSession({ kind: s.kind, user: s.user, minute: s.minute }); return true; }
      return false;
    }
    if (!d || !d.ok) { A.clear(); return false; }
    beginSession(d);
    return true;
  }
  /* 서명 세션에서 서명·정보 저장 — 서버 RPC(해당 회의 한 건만) */
  async function signSubmit(idx, expect, person, sign) {
    const S = window.SemisSync;
    const d = await S.rpc("semis_logi_sign_submit", { p_idx: idx, p_expect: expect == null ? null : String(expect),
      p_name: person.name, p_org: person.org, p_role: person.role || "", p_sign: sign === undefined ? null : sign });
    if (d && d.ok && d.minute) applySignerMinute(d.minute);
    return d || { ok: false, error: "network" };
  }
  function signCodeFor(m) {
    const id = String((m && m.id) || "");
    let h = 5381;
    for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
    return String(100000 + (h % 900000));
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
  async function logout() {
    try {
      if (window.SemisSync && SemisSync._flush && currentUser && currentUser.role !== "signer")
        await Promise.race([SemisSync._flush().catch(() => {}), new Promise(r => setTimeout(r, 2500))]);
    } catch (e) { /* 저장 실패는 무시하고 로그아웃 */ }
    try { const A = Auth(); if (A) await A.logout(); } catch (e) {}
    try { if (window.SemisFileAuth) SemisFileAuth.stop(); } catch (e) {}
    currentUser = null;
    store.del(LS_DATA); store.del(SS_OWNER);
    try { Object.keys(sessionStorage).filter(k => k.indexOf("semisl:argo:") === 0).forEach(k => sessionStorage.removeItem(k)); } catch (e) { /* 저장소 접근 불가 */ }
    location.hash = "";
    location.reload();
  }
  /* 세션 만료(서버가 거절) — 화면은 두고 로그인 창만 다시 띄운다 */
  function sessionLost() {
    if (!currentUser || relogin) return;
    relogin = { owner: ownerOf(currentUser) };
    const ov = $("#login-overlay");
    if (ov) ov.classList.remove("hidden");
    const er = $("#login-error");
    if (er) er.textContent = "접속이 만료되었습니다. 다시 로그인해 주세요.";
    const pw = $("#login-pw");
    if (pw) { pw.value = ""; setTimeout(() => { try { pw.focus(); } catch (e) {} }, 50); }
    const A = Auth(); if (A && A.prepare) A.prepare();   // 다시 로그인할 작업증명 미리 계산
  }
  /* 세션 확인(10분) 결과 — 권한이 바뀌었으면 화면을 다시 그린다 */
  function sessionUpdated(d) {
    const u = userFrom(d);
    if (!u || !currentUser || u.role === "signer") return;
    if (u.role === currentUser.role && u.name === currentUser.name && u.id === currentUser.id) return;
    const roleChanged = u.role !== currentUser.role;
    currentUser = u;
    if (roleChanged) {
      claimCache(u);
      if (window.SemisSync) SemisSync.pull(false).catch(() => {});
    }
    try { renderHeader(); renderNav(); renderView(); } catch (e) {}
  }
  /* 테스트·개발용 — 서버 없이 세션을 세운다(데이터 권한은 여전히 서버가 결정) */
  function devSession(d, tok, opts) {
    const A = Auth();
    if (A && A._set) A._set(tok || "t".repeat(64), d);
    let u;
    if (opts && opts.keep) { u = userFrom(d); currentUser = u; }   // 캐시 정리 없이(테스트에서 계정만 바꿔 볼 때)
    else u = beginSession(d);
    if (u) enterApp();
    return u;
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
  /* ── 메뉴 숨김(권한과 별개) ──
     hidden = true 면 사이드바·통합검색·대시보드 카드에서 빠지지만 라우트(#/module)로는 동작.
     그룹을 숨기면 하위도 숨김. 대시보드·시스템 설정은 숨길 수 없다 */
  const UNHIDABLE = ["dashboard", "settings"];
  function canHide(menu) {
    return !!menu && !(menu.type === "module" && UNHIDABLE.indexOf(menu.module) >= 0);
  }
  function menuHidden(menu) {
    if (!menu) return false;
    if (menu.hidden && canHide(menu)) return true;
    let pid = menu.parent;
    for (let i = 0; pid && i < 3 && DATA && Array.isArray(DATA.menus); i++) {
      const p = DATA.menus.find(m => m.id === pid);
      if (!p) break;
      if (p.hidden) return true;
      pid = p.parent;
    }
    return false;
  }
  /* 화면 노출 = 권한 통과 && 숨김 아님 (탭 묶음은 보이는 화면이 하나라도 있을 때) */
  function navVisible(menu) {
    if (!menu || !canSee(menu) || menuHidden(menu)) return false;
    return menu.type !== "bundle" || bundleMembers(menu).length > 0;
  }

  /* ── 유틸 ── */
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
  /* 열린 패널(모달 대화상자)이 있으면 그 안 — 밖은 inert 라 보이지도 눌리지도 않는다 */
  const layerHost = () => (typeof window !== "undefined" && window.SemisPanel && window.SemisPanel.host()) || document.body;
  function toast(msg, isErr) {
    const wrap = $("#toast-wrap");
    if (!wrap) return;
    const h = layerHost();
    if (h && wrap.parentNode !== h) h.appendChild(wrap);
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2200);
    setTimeout(() => t.remove(), 2600);
  }

  /* ── 모달 ── */
  function openModal(html, opts) {
    const ov = $("#modal-overlay"), h = layerHost();
    if (ov && h && ov.parentNode !== h) h.appendChild(ov);
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

  /* ── A4 인쇄(전 화면 공통) ──
     모든 화면 머리말(.ds-head/.page-head) 오른쪽, 없으면 맨 위 인쇄 바에 Print 버튼 자동 부착.
     인쇄 시 헤더·사이드바·버튼은 빠지고(@media print) 문서 머리말(시스템명·화면명·출력일시·출력자)이 붙는다 */
  function printTitle(route) {
    const mn = menuForModule(route);
    if (mn) return mn.label;
    const rt = String(route);
    if (rt.indexOf("embed/") === 0 || rt.indexOf("links/") === 0) {
      const lk = DATA.menus.find(m => m && m.id === rt.slice(6));
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
  function printHeadHTML(title) {
    return '<div class="ph-sys">' + esc(APP_NAME) + ' <span>에어제타 인천화물팀 안전보안파트</span></div>' +
      '<div class="ph-title">' + esc(title) + '</div>' +
      '<div class="ph-meta">출력일시 ' + esc(printStamp()) +
        ' · 출력자 ' + esc((currentUser && currentUser.name) || "-") +
        ' · ' + esc((ROLE_LABEL[currentUser && currentUser.role] || "")) + '</div>';
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
    head.innerHTML = printHeadHTML(title);
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

  /* ── 모듈 레지스트리 & 라우터 ── */
  const modules = {};
  function registerModule(id, def) { modules[id] = def; }
  function hasModule(id) { return !!modules[id]; }

  /* ── 지원 카드(검색 · 메인 데스크 · 아르고) — 허브 패널 맨 위 카드, 패널을 접었을 때 · 태블릿 · 모바일은 상단바 아이콘.
     권한: 검색 = 서명 세션 빼고 / 메인 데스크 = 내부 hq 이상 / 아르고 = 내부 전 계정(모듈이 있을 때만) */
  const support = {};
  const SUPPORT_IDS = ["search", "desk", "argo"];
  function registerSupport(id, def) { support[id] = def || {}; if (currentUser) renderSupport(); }
  function supportOk(id) {
    const role = currentUser && currentUser.role;
    if (!currentUser || role === "signer") return false;
    const internal = role !== "vendor";
    if (id === "search") return true;
    if (id === "desk") return internal && roleRank() >= 3 && !!support.desk && !(support.desk.ok && !support.desk.ok());
    if (id === "argo") return internal && hasModule("argo");
    return false;
  }
  function openSupport(id) {
    if (!supportOk(id)) return false;
    const s = support[id];
    if (s && typeof s.open === "function") s.open();
    else if (id === "argo") navigate("argo");
    return true;
  }
  const SUP_LABEL = { search: "통합 검색", desk: "메인 데스크", argo: "아르고" };
  function renderSupport() {
    if (typeof document === "undefined") return;
    let n = 0;
    SUPPORT_IDS.forEach(id => {
      const ok = supportOk(id);
      if (ok) n++;
      const s = support[id] || {};
      let badge = "";
      if (ok && typeof s.badge === "function") { try { const v = s.badge(); badge = v ? String(v) : ""; } catch (e) { badge = ""; } }
      [$("#sup-" + id), $(id === "search" ? "#hdr-search-btn" : "#hdr-" + id)].forEach(b => {
        if (!b) return;
        b.hidden = !ok;
        const nb = b.querySelector(".sup-n");
        if (nb) { nb.textContent = badge; nb.hidden = !badge; }
        const lb = SUP_LABEL[id] + (badge ? " — 확인 대기 " + badge + "건" : "") + (id === "search" ? " (Ctrl K)" : "");
        b.setAttribute("aria-label", lb);
        b.title = lb;
        if (id === "argo" && ok && !b.querySelector(".owl-svg") && window.SemisOwl) {
          const ow = b.querySelector(".sup-owl");
          if (ow) ow.innerHTML = window.SemisOwl.svg("idle", b.id === "sup-argo" ? 34 : 26);
        }
      });
    });
    const card = $("#sup-card");
    if (card) { card.hidden = !n; card.dataset.n = String(n); }
    const hs = $("#hdr-sup");
    if (hs) hs.hidden = !n;
  }

  /* 패널로 여는 주소(#/desk 등) — 옛 링크 · 즐겨찾기로 오면 대시보드를 그리고 그 위에 패널을 연다 */
  const panelRoutes = {};
  function registerPanelRoute(id, fn) { panelRoutes[id] = fn; }

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
    schedule: "wide", dashboard: "wide", board: "wide", flight: "wide",
    minutes: "mid", contacts: "mid", crisis: "mid", serp: "mid", threat: "mid", phonebook: "mid", settings: "mid", vault: "mid",
    "reg-sec": "mid", "reg-safety": "mid", "reg-dg": "mid", "scr-status": "mid", "scr-equip": "mid", audit: "mid", inspection: "mid", shortcuts: "mid", "daily-safety": "mid",
    "sec-dash": "mid", "aud-dash": "mid", training: "mid", selfcheck: "mid",
    partners: "mid", contracts: "mid", "kc-ra": "mid", "sec-cases": "wide", dissem: "wide"
  };
  function applyViewWidth(view, route) {
    const r = String(route);
    const tier = r.indexOf("embed/") === 0 ? "wide" : r.indexOf("links/") === 0 ? "mid" : (VIEW_WIDTH[route] || "");
    view.classList.toggle("view-wide", tier === "wide");
    view.classList.toggle("view-mid", tier === "mid");
  }

  /* 예정 모듈 안내 화면 — 메뉴의 planned/desc 로 렌더.
     같은 허브의 다른 메뉴(운영 중 · 준비 중)를 함께 보여 허브 안에서 길을 잃지 않게 한다. */
  function renderPlannedView(root, menu) {
    const desc = menu.desc || "이 메뉴는 업무 모듈로 순차 개발될 예정입니다.";
    const hub = hubOf(menu);
    const g = hub ? DATA.menus.find(x => x.id === hub) : null;
    const sibs = hub ? hubModules(hub).filter(m => m.id !== menu.id) : [];
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

  /* 허브 화면 머리말 사진 배너 — #view[data-hub] 로 CSS 가 허브별 사진 선택.
     대시보드·관리 메뉴·외부 링크 화면 제외. 모듈이 다시 그려도 #view 속성은 남아 배너 유지 */
  function markHub(view, route) {
    let hub = null;
    const rt = String(route || "");
    if (route && route !== "dashboard" && rt.indexOf("embed/") !== 0) {
      const mn = rt.indexOf("links/") === 0 ? DATA.menus.find(x => x && x.id === rt.slice(6)) : menuForModule(route);
      const hid = mn ? hubOfDeep(mn) : null;
      const g = hid ? DATA.menus.find(x => x.id === hid && x.type === "group") : null;
      if (g) hub = g;
    }
    if (hub) view.setAttribute("data-hub", hub.id); else view.removeAttribute("data-hub");
  }

  /* 화면을 다시 그린 뒤(원격 변경 · 권한 변경 등) — 열린 패널도 따라 그리게 */
  const viewHooks = [];
  function onRerender(fn) { if (typeof fn === "function") viewHooks.push(fn); }
  function renderView() {
    renderViewNow();
    viewHooks.forEach(fn => { try { fn(); } catch (e) { /* 패널 다시 그리기 실패는 화면을 막지 않는다 */ } });
  }
  function renderViewNow() {
    let route = currentRoute();
    const view = $("#view");
    const pr = panelRoutes[route];
    if (pr && currentUser && currentUser.role !== "signer") {
      try { history.replaceState(null, "", "#/dashboard"); } catch (e) { /* 주소만 못 바꿈 */ }
      route = currentRoute() === route ? "dashboard" : currentRoute();
      setTimeout(() => { try { pr(); } catch (e) { /* 열지 못함 */ } }, 0);
    }
    if (route !== lastViewRoute) { lastViewRoute = route; mEditRoute = ""; view.classList.remove("m-editing"); }   // 화면을 옮기면 편집 모드 끔
    view.innerHTML = "";
    applyViewWidth(view, route);
    markHub(view, currentUser && (currentUser.role === "vendor" || currentUser.role === "signer") ? "" : route);
    if (currentUser && currentUser.role === "vendor") {
      const allow = vendorAccess(currentUser).routes;
      if (allow.indexOf(route) < 0) route = vendorHome(currentUser);
      applyViewWidth(view, route);
      const def = modules[route] || modules.dashboard;
      renderSubtabs("");
      def.render(view);
      attachPrintBtn(view, route);
      highlightNav(route);
      closeSidebar();
      return;
    }
    if (currentUser && currentUser.role === "signer") {
      view.classList.remove("view-wide"); view.classList.remove("view-mid");
      const def = modules.minutes || modules.dashboard;
      renderSubtabs("");
      def.render(view);
      highlightNav("minutes");
      closeSidebar();
      return;
    }
    if (route.indexOf("embed/") === 0) {
      renderSubtabs("");
      renderEmbedView(view, route.slice(6));
    } else if (route.indexOf("links/") === 0) {
      renderSubtabs("");
      renderLinkGroup(view, route.slice(6));
    } else {
      let def = modules[route];
      const menu = menuForModule(route);
      const denied = !!menu && !canSee(menu);
      renderSubtabs(denied ? "" : route);
      if (denied) { toast("접근 권한이 없습니다.", true); def = modules.dashboard; markHub(view, "dashboard"); }
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
    watchView();
    queueTidy();
  }
  /* 탭 묶음에 속한 화면이면 본문 위에 묶음 탭(보이는 화면이 둘 이상일 때) */
  function renderSubtabs(route) {
    const nav = $("#subtabs");
    if (!nav) return;
    const bd = route ? bundleOf(menuForModule(route)) : null;
    const ms = bd && !menuHidden(bd) ? bundleMembers(bd) : [];
    if (ms.length < 2) { nav.hidden = true; nav.innerHTML = ""; return; }
    const view = $("#view");
    nav.className = "subtabs" + (view.classList.contains("view-wide") ? " view-wide" : view.classList.contains("view-mid") ? " view-mid" : "");
    nav.hidden = false;
    nav.setAttribute("aria-label", bd.label);
    nav.innerHTML = '<span class="sbt-name">' + esc(bd.label) + '</span><div class="sbt-list">' + ms.map(m => {
      const on = m.module === route, badge = navBadgeOf(m), opt = !!(modules[m.module] && modules[m.module].optional);
      return '<button type="button" class="sbt-tab' + (on ? " on" : "") + '"' + (on ? ' aria-current="page"' : "") + ' data-route="' + esc(m.module) + '"' +
        (opt ? ' title="선택 실행"' : "") + '><span>' + esc(m.tab || m.label) + '</span>' +
        (opt ? '<i class="sbt-opt">선택</i>' : badge ? '<b class="sbt-n">' + esc(badge) + '</b>' : "") + '</button>';
    }).join("") + '</div>';
    $$(".sbt-tab", nav).forEach(b => { b.onclick = () => { if (b.dataset.route !== currentRoute()) navigate(b.dataset.route); }; });
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
    const up = mn.parent ? DATA.menus.find(x => x && x.id === mn.parent && x.type === "link") : null;
    root.innerHTML = `
      <div class="page-head">
        <div class="page-title">${esc(mn.label)}</div>
        <span class="spacer"></span>
        ${up ? `<button type="button" class="btn btn-ghost btn-sm" data-go="links/${esc(up.id)}">${icon("folder", 16)}<span>${esc(up.label)}</span></button>` : ""}
        <a class="btn btn-ghost btn-sm" href="${esc(mn.url)}" target="_blank" rel="noopener">${icon("external", 16)}<span>새 탭에서 열기</span></a>
      </div>
      <iframe class="embed-frame" src="${esc(mn.url)}" title="${esc(mn.label)}"
        allow="fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    $$("[data-go]", root).forEach(el => el.onclick = () => navigate(el.dataset.go));
  }

  /* ── 링크 묶음 ──
     open: "group" 링크는 메뉴에서 한 줄, 누르면 하위 링크 카드 화면(#/links/<메뉴id>).
     하위 링크 = parent 가 그 링크 id 인 링크 메뉴 — 허브 목록(hubEntries)에는 잡히지 않음 */
  const isLinkGroup = (m) => !!m && m.type === "link" && m.open === "group";
  function linkChildren(id) {
    return sortedMenus().filter(c => c && c.type === "link" && c.parent === id && navVisible(c));
  }
  function hostOf(url) {
    const m = String(url || "").match(/^https?:\/\/([^/?#]+)/i);
    return m ? m[1] : "";
  }
  /* 사내망(사설망) 주소 — 회사 네트워크에서만 열리고, https 화면에서는 내부 표시가 막힌다 */
  function isIntranet(url) {
    const u = String(url || "");
    if (!u) return false;
    const h = hostOf(u).split(":")[0];
    if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
    return h === "localhost" || h.indexOf(".") < 0;
  }
  /* 링크 카드 — opts.edit 이면 누르면 수정 폼(data-sc-edit)을 여는 편집용 카드 */
  function linkCardHTML(m, opts) {
    opts = opts || {};
    const mode = isLinkGroup(m) ? "group" : m.open === "frame" ? "frame" : "tab";
    const kids = mode === "group" ? (opts.edit ? DATA.menus.filter(c => c && c.type === "link" && c.parent === m.id).length : linkChildren(m.id).length) : 0;
    const meta = (isIntranet(m.url) ? "사내망 · " : "") + (hostOf(m.url) || "주소 없음");
    const tag = opts.tag || (mode === "group" ? "링크 모음" + (kids ? " " + kids : "") : mode === "frame" ? "내부 화면" : "새 탭");
    const body = linkIconHTML(m, "lk-ico") +
      '<span class="lk-b"><span class="lk-t">' + esc(m.label) + '</span>' +
      '<span class="lk-s">' + esc(opts.sub || meta) + '</span></span>' +
      '<span class="lk-tag">' + esc(tag) + '</span>' +
      '<span class="lk-go">' + icon(opts.edit ? "edit" : mode === "tab" ? "external" : "chevron", 16) + '</span>';
    if (opts.edit) return '<button type="button" class="lk-card is-edit' + (opts.dim ? " is-dim" : "") + '" data-sc-edit="' + esc(m.id) +
      '" aria-label="' + esc(m.label + " 수정") + '">' + body + '</button>';
    if (mode === "tab") return '<a class="lk-card" href="' + esc(m.url) + '" target="_blank" rel="noopener" title="' + esc(m.url) + '">' + body + '</a>';
    return '<button type="button" class="lk-card" data-go="' + esc((mode === "group" ? "links/" : "embed/") + m.id) + '">' + body + '</button>';
  }
  function renderLinkGroup(root, id) {
    const mn = DATA.menus.find(m => m && m.id === id && m.type === "link");
    if (!mn || !canSee(mn)) {
      toast(mn ? "접근 권한이 없습니다." : "메뉴를 찾을 수 없습니다.", true);
      modules.dashboard.render(root);
      return;
    }
    const kids = linkChildren(mn.id);
    const actions = (isAdmin() && modules.shortcuts
      ? '<button type="button" class="btn btn-ghost btn-sm" data-sc-manage="' + esc(mn.id) + '">' + icon("edit", 16) + '<span>편집</span></button>' : "") +
      (mn.url
      ? '<a class="btn btn-soft btn-sm" href="' + esc(mn.url) + '" target="_blank" rel="noopener">' +
        icon("external", 16) + '<span>전체 열기</span></a>' : "");
    root.innerHTML = ui.head({
      title: mn.label,
      meta: kids.length ? kids.length + "개 링크" : "",
      desc: mn.desc || "",
      actions
    }) + (kids.length
      ? '<div class="lk-grid">' + kids.map(linkCardHTML).join("") + '</div>'
      : '<div class="card">' + ui.empty("등록된 하위 링크가 없습니다.",
          isAdmin() ? '<button type="button" class="btn btn-soft btn-sm" data-go="settings">메뉴 관리에서 추가</button>' : "") + '</div>')
      + (kids.some(k => isIntranet(k.url))
        ? '<p class="lk-note">' + icon("info", 15) + '<span>사내망 주소는 회사 네트워크(사내 PC)에서만 열립니다.</span></p>' : "");
    $$("[data-go]", root).forEach(el => el.onclick = () => navigate(el.dataset.go));
    $$("[data-sc-manage]", root).forEach(el => el.onclick = () => {
      if (window.SemisShortcuts) window.SemisShortcuts.manage(el.dataset.scManage);
    });
  }

  /* ── 허브 내비게이션 ──
     레일(#rail, 허브 아이콘) + 허브 패널(#sidebar, 현재 허브 메뉴). 모바일(<768px): 하단 탭(#tabbar) + 전체 메뉴 시트.
     - 허브 = 최상위 그룹 메뉴. 패널은 모든 허브 섹션을 DOM 에 두고 현재 허브(.hub.on)만 보임(시트에선 전부 세로로)
     - 예정 모듈은 "준비 중인 모듈" 블록에 모이고 registerModule 되면 위 목록으로
     - def.navBadge() 가 있으면 메뉴 오른쪽에 숫자 */
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
  /* 링크 묶음 하위 링크는 hubOf 가 상위 '링크'의 id 라서 허브 목록에 잡히지 않는다.
     빵부스러기·레일 강조용으로만 상위를 따라 올라가 실제 허브(group)를 찾는다. */
  function hubOfDeep(mn) {
    let cur = mn;
    for (let i = 0; cur && i < 6; i++) {
      const h = hubOf(cur);
      if (!h) return null;
      const g = DATA.menus.find(x => x && x.id === h);
      if (!g || g.type === "group") return h;
      cur = g;
    }
    return null;
  }
  function hubEntries(hubId) {
    return sortedMenus().filter(m => m.type !== "group" && hubOf(m) === hubId && navVisible(m));
  }
  /* 레일에 보일 허브 — 운영 화면(모듈 · 묶음 · 링크)이 하나라도 있을 때. withPlanned 면 예정 모듈만 있는 허브도 */
  function hubList(withPlanned) {
    return sortedMenus().filter(g => g.type === "group" && !menuHidden(g) &&
      hubEntries(g.id).some(m => withPlanned || m.type !== "module" || isLive(m)));
  }
  /* ── 탭 묶음(bundle) — 비슷한 화면을 메뉴 한 줄로 묶고 화면 위 탭으로 오간다. 주소(#/모듈)는 그대로 ── */
  function bundleOf(mn) {
    if (!mn || !mn.parent || !DATA) return null;
    const p = DATA.menus.find(x => x.id === mn.parent);
    return p && p.type === "bundle" ? p : null;
  }
  function bundleMembers(bd) {
    return sortedMenus().filter(m => m.type === "module" && m.parent === bd.id && canSee(m) && !menuHidden(m) && !isPlannedMenu(m));
  }
  /* 허브 안 모듈 — 탭 묶음 속 모듈까지 */
  function hubModules(hubId) {
    const out = [];
    hubEntries(hubId).forEach(m => {
      if (m.type === "module") out.push(m);
      else if (m.type === "bundle") out.push.apply(out, bundleMembers(m));
    });
    return out;
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

  function bundleBadge(bd) {
    let n = 0, txt = "";
    bundleMembers(bd).forEach(m => { const v = navBadgeOf(m); if (/^\d+$/.test(v)) n += Number(v); else if (v && !txt) txt = v; });
    return txt || (n ? String(n) : "");
  }
  function navItemHTML(m) {
    if (m.type === "bundle") {
      const ms = bundleMembers(m), badge = bundleBadge(m);
      return '<button type="button" class="nav-item nav-bundle" data-route="' + esc(ms[0] ? ms[0].module : "") + '" data-routes="' +
        esc(ms.map(x => x.module).join(" ")) + '" title="' + esc(m.label + " — " + ms.map(x => x.tab || x.label).join(" · ")) + '">' +
        '<span class="nav-lbl">' + esc(m.label) + '</span>' + (badge ? '<span class="nav-meta">' + esc(badge) + '</span>' : "") + '</button>';
    }
    const tag = m.type === "link" ? "a" : "button";
    if (isLinkGroup(m)) {
      const kn = linkChildren(m.id).length;
      return '<button type="button" class="nav-item nav-link nav-set" data-route="links/' + esc(m.id) + '" title="' + esc(m.label) + ' (링크 모음)">' +
        linkIconHTML(m, "nav-lki") + '<span class="nav-lbl">' + esc(m.label) + '</span>' +
        (kn ? '<span class="nav-meta">' + kn + '</span>' : "") +
        '<span class="ext-mark">' + icon("chevron", 15) + '</span></button>';
    }
    if (m.type === "link" && m.open !== "frame") {
      return '<a class="nav-item nav-link" href="' + esc(m.url) + '" target="_blank" rel="noopener" title="' + esc(m.label) + '">' +
        linkIconHTML(m, "nav-lki") + '<span class="nav-lbl">' + esc(m.label) + '</span><span class="ext-mark">' + icon("external", 15) + '</span></a>';
    }
    if (m.type === "link") {
      return '<button type="button" class="nav-item nav-link" data-route="embed/' + esc(m.id) + '" title="' + esc(m.label) + '">' +
        linkIconHTML(m, "nav-lki") + '<span class="nav-lbl">' + esc(m.label) + '</span><span class="ext-mark">' + icon("panel", 15) + '</span></button>';
    }
    if (isPlannedMenu(m)) {
      return '<button type="button" class="nav-item planned" data-route="' + esc(m.module) + '" title="' + esc(m.label) + ' (준비 중)">' +
        '<span class="pl-dot" aria-hidden="true"></span><span class="nav-lbl">' + esc(m.label) + '</span><span class="nav-tag">예정</span></button>';
    }
    const badge = navBadgeOf(m);
    const def = modules[m.module], opt = !!(def && def.optional);   // 선택 실행 모듈(의무 아님 · 통계 제외) — '선택' 표시
    return '<' + tag + ' type="button" class="nav-item' + (opt ? " is-opt" : "") + '" data-route="' + esc(m.module) + '" title="' + esc(m.label) + (opt ? " (선택 실행)" : "") + '">' +
      '<span class="nav-lbl">' + esc(m.label) + '</span>' + (opt ? '<span class="nav-tag is-opt">선택</span>' : badge ? '<span class="nav-meta">' + esc(badge) + '</span>' : "") + '</' + tag + '>';
  }
  function plannedOpenPref(hubId, liveCount) {
    const pref = (navPrefs().plannedOpen || {})[hubId];
    if (typeof pref === "boolean") return pref;
    return !isMobile() && liveCount === 0;
  }
  const LINKS_SHOWN = 5;   // 허브 패널 바로가기는 5개까지, 나머지는 펼쳐 보기
  function hubSectionHTML(g, entries) {
    const live = entries.filter(m => m.type === "bundle" || (m.type === "module" && isLive(m)));
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
        if (m.type === "link" && m.open !== "frame" && !isLinkGroup(m))
          return '<a class="nav-pin" href="' + esc(m.url) + '" target="_blank" rel="noopener">' + pinIco + '<span>' + esc(m.label) + '</span></a>';
        const r = m.type === "link" ? (isLinkGroup(m) ? "links/" : "embed/") + m.id : m.module;
        return '<button type="button" class="nav-pin" data-go="' + esc(r) + '">' + pinIco + '<span>' + esc(m.label) + '</span></button>';
      }).join("") + '</div>';
    if (planned.length) h += '<div class="hub-block hub-planned' + (open ? " open" : "") + '">' +
      '<button type="button" class="hub-block-t hub-toggle" data-toggle-planned="' + esc(g.id) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
      '<span>준비 중인 모듈</span><b class="soon-n">' + planned.length + '</b><span class="chev">' + icon("chevdown", 15) + '</span></button>' +
      '<div class="planned-list">' + planned.map(navItemHTML).join("") + '</div></div>';
    /* 바로가기 블록 — 전체 화면(#/shortcuts) 버튼, 시스템관리자는 이 허브에 바로 추가 */
    const scMenu = modules.shortcuts ? menuForModule("shortcuts") : null;
    const scOk = !!scMenu && canSee(scMenu);
    const addOk = scOk && isAdmin();
    if (links.length || (addOk && g.id === homeHubId())) {
      h += '<div class="hub-block hub-links"><div class="hub-block-t"><span class="hb-t">바로가기</span>' +
        (scOk ? '<button type="button" class="hb-act" data-go="shortcuts" title="바로가기 전체" aria-label="바로가기 전체">' + icon("grid", 15) + '</button>' : "") +
        (addOk ? '<button type="button" class="hb-act" data-sc-add="' + esc(g.id) + '" title="바로가기 추가" aria-label="' + esc(g.label) + '에 바로가기 추가">' + icon("plus", 16) + '</button>' : "") +
        '</div>' + links.map((m, i) => i < LINKS_SHOWN ? navItemHTML(m) : navItemHTML(m).replace('class="nav-item', 'class="nav-item lk-x')).join("") +
        (links.length > LINKS_SHOWN ? '<button type="button" class="lk-toggle" data-lk-all aria-expanded="false">' + icon("chevdown", 14) +
          '<span>' + (links.length - LINKS_SHOWN) + '개 더 보기</span></button>' : "") + '</div>';
    }
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
        if (m.type === "link" && m.open !== "frame" && !isLinkGroup(m))
          return '<a class="rail-btn util" href="' + esc(m.url) + '" target="_blank" rel="noopener" title="' + esc(m.label) + '" aria-label="' + esc(m.label) + '">' + ico + '</a>';
        const r = m.type === "link" ? (isLinkGroup(m) ? "links/" : "embed/") + m.id : m.module;
        return '<button type="button" class="rail-btn util" data-route="' + esc(r) + '" title="' + esc(m.label) + '" aria-label="' + esc(m.label) + '">' + ico + '</button>';
      }).join("");
      if (utils.length) html += '<section class="hub hub-util" data-hub="_util" aria-label="관리"><div class="hub-head"><span class="hub-ico">' +
        icon("sliders", 18) + '</span><h2 class="hub-title">관리</h2></div><div class="hub-items">' + utils.map(navItemHTML).join("") + '</div></section>';
      if (!activeHub || !hubs.some(g => g.id === activeHub)) activeHub = hubs[0] ? hubs[0].id : null;
    }
    box.innerHTML = html;

    $$("[data-route]", box).forEach(el => { el.onclick = () => navigate(el.dataset.route); });
    $$("[data-go]", box).forEach(el => { el.onclick = () => navigate(el.dataset.go); });
    $$("[data-sc-add]", box).forEach(el => {
      el.onclick = () => { closeOverlays(); if (window.SemisShortcuts) window.SemisShortcuts.add(el.dataset.scAdd); };
    });
    $$("[data-lk-all]", box).forEach(b => {
      b.onclick = () => {
        const blk = b.closest(".hub-links");
        const all = !blk.classList.contains("all");
        blk.classList.toggle("all", all);
        b.setAttribute("aria-expanded", all ? "true" : "false");
        const n = $$(".lk-x", blk).length;
        b.innerHTML = icon(all ? "chevron" : "chevdown", 14) + "<span>" + (all ? "접기" : n + "개 더 보기") + "</span>";
      };
    });
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
    renderSupport();
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
  /* 허브 대시보드 — 레일에서 허브를 누르면 허브 대시보드로 이동(권한·숨김 따름).
     이미 그 화면이면 허브 패널만 연다(좁은 화면에서 하위 메뉴로 가는 길) */
  const HUB_HOME = { "hub-sec": "sec-dash", "hub-aud": "aud-dash" };
  function hubHomeRoute(id) {
    const r = HUB_HOME[id];
    if (!r || !modules[r]) return null;
    const mn = menuForModule(r);
    return mn && navVisible(mn) && hubOf(mn) === id ? r : null;
  }
  function openHub(id) {
    const home = hubHomeRoute(id);
    if (home && currentRoute() !== home) {
      activeHub = id;
      applyHub();
      navigate(home);
      return;
    }
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

  /* 모바일 하단 탭 — 권한·숨김에 맞춰 보이는 것만, hub 지정 탭은 그 허브의 첫 운영 모듈로.
     현장에서 매일 쓰는 순서(연락망·규정은 전체·검색으로) */
  const MOBILE_TABS = [
    { label: "홈", ico: "home", route: "dashboard" },
    { label: "일정", ico: "calendar", route: "schedule" },
    { label: "순찰", ico: "patrol", route: "daily-safety" },
    { label: "운항", ico: "plane", route: "flight" }
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
    const up = mn && mn.parent ? DATA.menus.find(x => x && x.id === mn.parent && (x.type === "link" || x.type === "bundle")) : null;
    el.innerHTML = (hubName && hubName !== leaf ? '<span class="cr-hub">' + esc(hubName) + '</span>' + icon("chevron", 14) : "") +
      (up && up.label !== leaf ? '<span class="cr-hub">' + esc(up.label) + '</span>' + icon("chevron", 14) : "") +
      '<b class="cr-leaf">' + esc(leaf) + '</b>';
  }
  function highlightNav(route) {
    route = String(route || "");
    $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.route === route ||
      (!!el.dataset.routes && el.dataset.routes.split(" ").indexOf(route) >= 0)));
    $$(".rail-btn.util").forEach(el => el.classList.toggle("active", el.dataset.route === route));
    const role = currentUser && currentUser.role;
    const mn = (route.indexOf("embed/") === 0 || route.indexOf("links/") === 0)
      ? DATA.menus.find(m => m && m.id === route.slice(6)) : menuForModule(route);
    const hub = mn ? hubOfDeep(mn) : null;
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

  /* ── 헤더 위젯 ── */
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
    renderSupport();
    $("#app-version").textContent = "v" + VERSION;
  }
  function renderSecBadge() {
    const b = $("#sec-level-badge");
    if (!b) return;
    b.hidden = !!(currentUser && currentUser.role === "signer");   // 서명 세션은 등급 자료를 받지 않는다
    if (b.hidden) return;
    const cur = secCurrent();
    const nxt = secNext();
    b.dataset.level = cur.level;
    b.innerHTML = '<i aria-hidden="true"></i><span class="sb-l">보안등급 · </span>' + esc(cur.level);
    b.title = "국가 항공보안등급: " + cur.level +
      (cur.note ? " — " + cur.note : "") +
      (cur.date ? " (" + cur.date + (cur.end ? " ~ " + cur.end : " ~") + ")" : "") +
      (nxt ? " / 예약: " + nxt.date + "부터 [" + nxt.level + "]" : "");
  }

  /* ── 부팅 ── */
  function enterApp() {
    $("#login-overlay").classList.add("hidden");
    $("#app").classList.remove("hidden");
    renderHeader();
    renderNav();
    renderView();
  }
  /* 로그인 직후 — 화면 진입 · 동기화 · 파일 주소 변환 시작 */
  function afterLogin(announce) {
    enterApp();
    if (currentUser && currentUser.role !== "signer" && window.SemisSync) SemisSync.start();
    if (window.SemisFileAuth) SemisFileAuth.start();
    if (announce && currentUser)
      toast(currentUser.role === "signer" ? "서명 화면입니다. 본인 이름을 찾아 서명해 주세요." : currentUser.name + "님, 환영합니다.");
  }
  function setLoginBusy(on, msg) {
    const f = $("#login-form");
    const btn = f && f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = !!on;
    if (f) f.classList.toggle("is-busy", !!on);
    if (msg != null) { const er = $("#login-error"); if (er) er.textContent = msg; }
  }
  const LOGIN_MSG = {
    locked: (d) => "로그인 시도가 많아 " + ((d && d.wait) || 15) + "분 동안 제한됩니다.",
    sign_paused: (d) => "회의 서명 코드 접속이 잠시 중지되었습니다. " + ((d && d.wait) || 15) + "분 뒤 다시 시도해 주세요.",
    network: () => "서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.",
    pow: () => "접속 확인에 실패했습니다. 다시 시도해 주세요.",
    invalid: () => "암호가 올바르지 않습니다."
  };
  /* pow · pow_expired · pow_used 는 같은 안내 */
  const loginMsg = (d) => {
    const code = String((d && d.error) || "invalid");
    const fn = LOGIN_MSG[code] || (/^pow/.test(code) ? LOGIN_MSG.pow : LOGIN_MSG.invalid);
    return fn(d);
  };
  let loginBusy = false;
  async function onLoginSubmit(e) {
    e.preventDefault();
    const pw = $("#login-pw").value;
    if (!pw || loginBusy) return;
    loginBusy = true;
    setLoginBusy(true, "확인 중…");
    let d;
    try { d = await login(pw); } catch (err) { d = { ok: false, error: "network" }; }
    loginBusy = false;
    setLoginBusy(false, "");
    if (d && d.ok) {
      $("#login-pw").value = "";
      if (relogin) {                                 // 세션 만료 뒤 다시 로그인
        const same = relogin.owner === ownerOf(currentUser);
        relogin = null;
        if (!same) { location.hash = ""; location.reload(); return; }
        $("#login-overlay").classList.add("hidden");
        if (window.SemisSync) SemisSync.start();
        toast("다시 연결되었습니다.");
        return;
      }
      afterLogin(true);
      return;
    }
    $("#login-error").textContent = loginMsg(d);
    $("#login-pw").value = "";
    $("#login-pw").focus();
  }
  /* 앱이 준비되기 전에 누른 로그인(js/loginguard.js 가 붙잡아 둔 것)을 이어서 처리한다 */
  function flushQueuedLogin() {
    if (typeof window === "undefined" || !window.__semisLoginQueued) return;
    window.__semisLoginQueued = false;
    const pw = $("#login-pw");
    if (pw && pw.value) onLoginSubmit({ preventDefault() {} });
    else setLoginBusy(false, "");
  }
  /* QR 접속(#/sign/코드) — 암호 입력 없이 서명 화면 */
  function signFromQr(code) {
    const pwEl = $("#login-pw"), errEl = $("#login-error");
    if (pwEl) pwEl.value = code;
    setLoginBusy(true, "회의 정보를 불러오는 중입니다…");
    login(code).then(d => {
      setLoginBusy(false);
      if (d && d.ok) { if (errEl) errEl.textContent = ""; location.hash = ""; afterLogin(true); return; }
      if (errEl) errEl.textContent = d && (d.error === "locked" || d.error === "sign_paused") ? loginMsg(d)
        : "회의 정보를 찾지 못했습니다. 진행자에게 문의해 주세요.";
    }).catch(() => {
      setLoginBusy(false);
      if (errEl) errEl.textContent = "서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 [로그인]을 눌러 주세요.";
    });
  }
  /* localStorage 에 남은 옛 데이터 캐시·세션 키 제거 — 데이터는 탭 sessionStorage 에만 둔다 */
  function cleanupLegacy() {
    try {
      ["semisl:data", "semisl:pendingSync", "semisl:forcePush", "semisl:gcalCache"].forEach(k => localStorage.removeItem(k));
      sessionStorage.removeItem("semisl:session");
    } catch (e) { /* 저장소 접근 불가 */ }
  }

  function boot() {
    cleanupLegacy();
    load();

    $("#login-form").addEventListener("submit", onLoginSubmit);
    if (typeof window !== "undefined") window.__semisReady = true;   // 그 전의 제출은 js/loginguard.js 가 붙잡아 둔다
    $("#pw-toggle").addEventListener("click", () => {
      const i = $("#login-pw");
      i.type = i.type === "password" ? "text" : "password";
      i.focus();
    });

    $("#logout-btn").addEventListener("click", logout);
    const sheetLogout = $("#sheet-logout");
    if (sheetLogout) sheetLogout.addEventListener("click", logout);
    $("#menu-toggle").addEventListener("click", togglePanel);
    ["desk", "argo"].forEach(id => [$("#sup-" + id), $("#hdr-" + id)].forEach(b => { if (b) b.addEventListener("click", () => openSupport(id)); }));
    $("#sidebar-backdrop").addEventListener("click", closeOverlays);
    const sc = $("#sheet-close");
    if (sc) sc.addEventListener("click", closeOverlays);
    $("#modal-overlay").addEventListener("click", (e) => {
      if (e.target === $("#modal-overlay")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#modal-overlay").classList.contains("hidden")) { e.preventDefault(); closeModal(); return; }
      closeOverlays();
    });
    /* 화면 폭이 바뀌면 떠 있는 패널·시트를 정리 (태블릿 회전 등) */
    let lastMode = isMobile() ? "m" : (window.innerWidth < 1100 ? "t" : "d");
    window.addEventListener("resize", () => {
      const mode = isMobile() ? "m" : (window.innerWidth < 1100 ? "t" : "d");
      if (mode !== lastMode) {
        const crossed = lastMode && (lastMode === "m") !== (mode === "m");
        lastMode = mode; closeOverlays(); closeActionSheet();
        if (crossed && currentUser) { resetStack(); renderView(); }   // 모바일 ↔ PC 전환 — 화면 구성이 다른 모듈(일정 등) 다시 그림
      }
    });
    window.addEventListener("hashchange", () => { if (currentUser) renderView(); });

    const qrCode = signCodeFromHash();
    const A = Auth();
    if (A && A.token()) {
      setLoginBusy(true, "접속 확인 중…");
      return restoreSession().then(ok => {
        setLoginBusy(false, "");
        if (ok) { window.__semisLoginQueued = false; afterLogin(false); return; }
        if (qrCode) { window.__semisLoginQueued = false; signFromQr(qrCode); return; }
        if (A.prepare) A.prepare();
        setTimeout(() => $("#login-pw") && $("#login-pw").focus(), 100);
        flushQueuedLogin();
      });
    }
    if (qrCode) { if (typeof window !== "undefined") window.__semisLoginQueued = false; signFromQr(qrCode); return; }
    if (A && A.prepare) A.prepare();                 // 암호를 입력하는 동안 작업증명을 미리 푼다
    setTimeout(() => $("#login-pw") && $("#login-pw").focus(), 100);
    flushQueuedLogin();
  }

  /* ── 모듈 화면 키트 ── 새 모듈은 아래 조각으로 그리면 공통 디자인과 맞는다
       SeMIS.ui.head({ title, meta, desc, actions })   화면 머리말 (A4 인쇄 버튼은 코어가 자동 부착)
       SeMIS.ui.stats([{ label, value, sub, tone }])  요약 수치 띠 (tone: ok · warn · bad · muted)
       SeMIS.ui.search(id, placeholder, value)         검색 입력
       SeMIS.ui.empty(text, actionsHtml)               빈 상태
       SeMIS.ui.chip(text, tone)                       상태 배지 (green · amber · red · blue · gray)
       SeMIS.icon(name, size)                          선 아이콘 (이모지 대신) */
  const ui = {
    icon,
    /* 공통 패널 모달(js/panel.js) — 검색 · 메인 데스크 · 아르고 */
    panel(o) { return typeof window !== "undefined" && window.SemisPanel ? window.SemisPanel.open(o) : null; },
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
    /* 한글 입력(IME) 보호 — 입력 중 화면을 다시 그리면 입력칸이 새로 만들어져
       조합 중 글자가 "ㅊㅗㅣ" 처럼 자모로 풀린다. 입력칸은 그대로 두고 나머지만 바꾼다.
       searchValue(v): 끝에 붙은 조합 중 자모(ㄱ~ㅣ)를 떼고 검색에 쓸 값을 돌려준다("최ㅅ" → "최").
       repaintKeep(box, html, keepEl): box 내용을 html로 바꾸되 keepEl(입력칸)과 그 조상은 옮기지 않고
       주변 형제만 새것으로 교체한다. keepEl을 찾을 수 없으면 통째로 바꾸고 false. */
    searchValue(v) { return String(v == null ? "" : v).replace(/[\u3131-\u318E]+$/, "").trim(); },
    repaintKeep(box, html, keep) {
      const whole = () => { box.innerHTML = html; return false; };
      if (!box || !keep || !keep.id || !box.contains(keep)) return whole();
      const tmp = document.createElement(box.tagName);
      tmp.innerHTML = html;
      const twin = tmp.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(keep.id) : keep.id));
      if (!twin || twin.tagName !== keep.tagName) return whole();
      const oldChain = [], newChain = [];
      for (let a = keep; a && a !== box; a = a.parentNode) oldChain.unshift(a);
      for (let a = twin; a && a !== tmp; a = a.parentNode) newChain.unshift(a);
      if (oldChain.length !== newChain.length) return whole();
      for (let i = 0; i < oldChain.length; i++) {
        const oc = oldChain[i], nc = newChain[i], par = oc.parentNode;
        while (oc.previousSibling) par.removeChild(oc.previousSibling);
        while (oc.nextSibling) par.removeChild(oc.nextSibling);
        const before = [], after = [];
        for (let x = nc.parentNode.firstChild; x && x !== nc; x = x.nextSibling) before.push(x);
        for (let x = nc.nextSibling; x; x = x.nextSibling) after.push(x);
        before.forEach(x => par.insertBefore(x, oc));
        after.forEach(x => par.appendChild(x));
        if (oc !== keep) {   // 조상 요소의 속성(class 등)은 새것으로 맞춘다
          Array.from(oc.attributes).forEach(at => { if (!nc.hasAttribute(at.name)) oc.removeAttribute(at.name); });
          Array.from(nc.attributes).forEach(at => { if (oc.getAttribute(at.name) !== at.value) oc.setAttribute(at.name, at.value); });
        }
      }
      return true;
    },
    /* 설명 말풍선 — 입력 화면에서 설명 문구를 걷어내고 ⓘ 버튼으로만 보여 준다(마우스 올림·포커스·탭) */
    tip(text, label) {
      return '<button type="button" class="help-tip" data-tip="' + esc(text) + '" aria-label="' + esc(label || "설명") +
        '" aria-expanded="false">' + icon("info", 16) + '</button>';
    },
    /* 모바일 접기 — 묶음(카드)에 붙이는 속성 문자열. 모바일(<768px)에서는 머리(.mf-h)만 보이고 누르면 펼친다.
       force: 검색 · 필터 중처럼 늘 펼칠 때. 펼친 상태는 화면(라우트)별로 기억(탭을 닫을 때까지). PC는 늘 펼침.
       사용: `<section class="card"${ui.mf("org:" + id, !!query)}><header class="mf-h">…</header>…</section>` */
    mf(key, force) {
      const k = String(key || "");
      return ' data-mf="' + esc(k) + '"' + (force || mfOpen.has(currentRoute() + "|" + k) ? " data-mf-on" : "");
    },
    mfSet(el, on) { mfToggle(el, on); },
    /* 점검 표시 관리(시스템관리자) — 표시 · 흐리게 · 숨김.
       rows[{ id, name, sub, m(""|"dim"|"hide"), msg }] · onSave(map): map = { id: { m, msg? } }(표시는 넣지 않음 · msg 는 기본 문구와 다를 때만) */
    VIS_MSG: "하드카피본 확인",
    visForm(o) {
      o = o || {};
      if (!isAdmin()) return;
      const rows = (o.rows || []).map(r => ({ id: String(r.id), name: r.name || "", sub: r.sub || "", m: r.m === "dim" || r.m === "hide" ? r.m : "", msg: r.msg || "" }));
      const MODES = [["", "표시"], ["dim", "흐리게"], ["hide", "숨김"]];
      openModal('<h3>점검 표시' + (o.title ? ' <small class="au-mh">' + esc(o.title) + '</small>' : "") + '</h3>' +
        '<div class="vis-rows">' + rows.map((r, i) => '<div class="vis-r" data-vi="' + i + '" data-m="' + esc(r.m) + '">' +
          '<span class="vis-n"><b>' + esc(r.name) + '</b>' + (r.sub ? '<small>' + esc(r.sub) + '</small>' : "") + '</span>' +
          '<span class="vis-seg" role="group" aria-label="' + esc(r.name + " 표시") + '">' + MODES.map(([v, lb]) =>
            '<button type="button" data-vm="' + v + '" aria-pressed="' + (r.m === v) + '">' + lb + '</button>').join("") + '</span>' +
          '<input class="vis-msg" data-vmsg value="' + esc(r.msg) + '" placeholder="' + esc(ui.VIS_MSG) + '" maxlength="30" aria-label="' + esc(r.name + " 안내 문구") + '">' +
        '</div>').join("") + '</div>' +
        '<div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>', { wide: true });
      $$("#modal-box .vis-r").forEach(el => $$("[data-vm]", el).forEach(b => b.onclick = () => {
        rows[Number(el.dataset.vi)].m = b.dataset.vm;
        el.dataset.m = b.dataset.vm;
        $$("[data-vm]", el).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      }));
      $("#modal-box [data-act=cancel]").onclick = closeModal;
      $("#modal-box [data-act=ok]").onclick = () => {
        const map = {};
        $$("#modal-box .vis-r").forEach(el => {
          const r = rows[Number(el.dataset.vi)];
          if (!r.m) return;
          const msg = String($("[data-vmsg]", el).value || "").replace(/\s+/g, " ").trim();
          map[r.id] = r.m === "dim" && msg && msg !== ui.VIS_MSG ? { m: r.m, msg } : { m: r.m };
        });
        closeModal();
        if (o.onSave) o.onSave(map);
      };
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
    const h = layerHost();
    if (h && box.parentNode !== h) h.appendChild(box);
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
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && tipEl && tipEl.classList.contains("on")) { ev.stopPropagation(); ev.preventDefault(); hideTip(); } }, true);
    window.addEventListener("scroll", () => { if (tipFor) hideTip(); }, true);
  }

  /* ── 화면 정돈 ──
     모듈 코드를 건드리지 않고 화면을 가볍게 만든다. 모듈이 다시 그릴 때마다(MutationObserver) 멱등 실행.
     ① 머리말 버튼: 주 버튼(.btn-primary 첫 번째) 하나만 두고 나머지는 ph-hide 표시 + '더보기' 버튼.
        숨김은 CSS가 모바일(<768px)에서만 적용하므로 PC 화면은 그대로다. 더보기 항목은 원래 버튼을
        click() 해서 모듈의 동작 · 권한 판정을 그대로 탄다(Print 포함).
     ② 표: 머리글(th) 이름을 각 칸 data-label 로 적어 두고, 모바일에서 가로로 넘치거나 칸이 좁아
        글자가 세로로 쌓이는 표만 tbl-stack(한 행 = 한 덩어리)으로 바꾼다. 들어맞는 표는 그대로. */
  const TIDY_SKIP = ".nb-editor, .notice-html, .ag-memo, .cn-rich, .print-only, [data-no-stack], .modal-box";
  const txtOf = (el) => String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  function headButtons(head) {
    return $$("button.btn, a.btn, label.btn", head).filter(b =>
      !b.closest(".ph-more") && !b.hasAttribute("data-keep") && !b.closest("[data-keep]") &&
      !b.classList.contains("hidden") && !b.hidden && b.style.display !== "none");
  }
  /* 편집 모드(모바일) — 편집 전용 단추(.m-ed)는 모바일에서 평소 숨기고, 더보기 › '편집'을 누르면 보인다.
     켜진 동안 머리말에 '완료'. 화면(라우트)을 옮기면 꺼진다. PC는 늘 보임(CSS가 모바일에서만 숨김). */
  let mEditRoute = "", lastViewRoute = "";
  const hasEdits = (view) => !!(view && view.querySelector(".m-ed"));
  const editingNow = () => !!mEditRoute && mEditRoute === currentRoute();
  function setEditMode(on) {
    mEditRoute = on ? currentRoute() : "";
    const view = $("#view");
    if (view) view.classList.toggle("m-editing", editingNow());
    tidyView();
  }
  function tidyHead(head) {
    const btns = headButtons(head);
    const main = btns.find(b => b.classList.contains("btn-primary") && !b.disabled) || null;
    const rest = btns.filter(b => b !== main);
    btns.forEach(b => b.classList.toggle("ph-hide", b !== main));
    const view = head.closest("#view");
    const eds = hasEdits(view);
    let done = head.querySelector(":scope > .ph-done");
    if (eds && editingNow()) {
      if (!done) {
        done = document.createElement("button");
        done.type = "button";
        done.className = "btn btn-soft ph-done no-print";
        done.setAttribute("data-keep", "");
        done.textContent = "완료";
        done.onclick = () => setEditMode(false);
        const mo = head.querySelector(":scope > .ph-more");
        if (mo) head.insertBefore(done, mo); else head.appendChild(done);
      }
    } else if (done) done.remove();
    let more = head.querySelector(":scope > .ph-more");
    if (!rest.length && !eds) { if (more) more.remove(); head.classList.remove("ph-has-more"); return; }
    head.classList.add("ph-has-more");
    if (!more) {
      more = document.createElement("button");
      more.type = "button";
      more.className = "icon-btn ph-more no-print";
      more.setAttribute("aria-label", "더보기");
      more.title = "더보기";
      more.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>';
      more.onclick = () => {
        const list = headButtons(head).filter(b => b.classList.contains("ph-hide"));
        const items = list.map(b => ({
          label: txtOf(b).replace(/^[+＋]\s*/, "") || b.title || b.getAttribute("aria-label") || "실행",
          icon: b.querySelector("svg") ? b.querySelector("svg").outerHTML : "",
          danger: b.classList.contains("btn-danger"), disabled: !!b.disabled,
          run: () => b.click()
        }));
        if (hasEdits(head.closest("#view"))) {
          const on = editingNow();
          items.unshift({ label: on ? "편집 끝내기" : "편집", icon: icon(on ? "check" : "edit"), run: () => setEditMode(!on) });
        }
        actionSheet(items, { title: txtOf(head.querySelector(".page-title")) }, more);
      };
      head.appendChild(more);
    }
  }
  /* 모바일 접기 — ui.mf() 로 표시한 묶음. 머리 끝에 펼침 단추(키보드 · 화면낭독용)를 붙이고 상태를 맞춘다 */
  const mfOpen = new Set();
  function mfToggle(sec, on) {
    if (!sec || !sec.hasAttribute || !sec.hasAttribute("data-mf")) return;
    const k = currentRoute() + "|" + sec.getAttribute("data-mf");
    const v = on == null ? !sec.hasAttribute("data-mf-on") : !!on;
    if (v) { sec.setAttribute("data-mf-on", ""); mfOpen.add(k); } else { sec.removeAttribute("data-mf-on"); mfOpen.delete(k); }
    const t = sec.querySelector(":scope > .mf-h > .mf-tog");
    if (t) mfLabel(t, sec);
    if (v) queueTidy();   // 펼친 안의 표 정돈(접힌 동안은 크기를 잴 수 없음)
  }
  function mfLabel(t, sec) {
    const on = sec.hasAttribute("data-mf-on");
    t.setAttribute("aria-expanded", String(on));
    t.setAttribute("aria-label", (on ? "접기: " : "펼치기: ") + txtOf(t.parentNode).slice(0, 40));
  }
  function tidyFolds(view) {
    $$("[data-mf]", view).forEach(sec => {
      const h = sec.querySelector(":scope > .mf-h");
      if (!h) return;
      let t = h.querySelector(":scope > .mf-tog");
      if (!t) {
        t = document.createElement("button");
        t.type = "button"; t.className = "mf-tog no-print";
        t.innerHTML = icon("chevdown", 18);
        h.appendChild(t);
      }
      mfLabel(t, sec);
    });
  }
  /* 가로로 넘치는 탭 줄은 고른 탭이 보이게(새로 그린 탭 줄에 한 번만) */
  function tidyTabs(view) {
    if (!isMobile()) return;
    $$('[role="tablist"], .tabs', view).forEach(tl => {
      if (tl.dataset.tsc) return;
      tl.dataset.tsc = "1";
      if (tl.scrollWidth <= tl.clientWidth + 2) return;
      const sel = tl.querySelector('[aria-selected="true"], .active');
      if (!sel) return;
      const x = sel.offsetLeft - (tl.clientWidth - sel.offsetWidth) / 2;
      tl.scrollLeft = Math.max(0, x);
    });
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (ev) => {
      const h = ev.target && ev.target.closest && ev.target.closest("#view [data-mf] > .mf-h");
      if (!h || !isMobile()) return;
      const tog = ev.target.closest(".mf-tog");
      if (!tog && ev.target.closest("a, button, input, select, textarea, label, summary, [data-no-mf]")) return;
      mfToggle(h.parentNode);
    });
  }
  /* 표 — 머리글 이름 · 제목 칸 · 조작 칸 표시(한 번) */
  function labelTable(t) {
    const hr = t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1] : null;
    if (!hr) return false;
    const names = [];
    Array.from(hr.cells).forEach(c => { for (let i = 0; i < (c.colSpan || 1); i++) names.push(txtOf(c)); });
    if (names.length < 3) return false;
    const rows = Array.from(t.tBodies).reduce((a, b) => a.concat(Array.from(b.rows)), []);
    if (rows.some(r => Array.from(r.cells).some(c => (c.rowSpan || 1) > 1))) return false;   // 행 병합 표(매트릭스)는 제외
    /* 제목 칸: 열기 버튼 · 굵은 글자가 있는 칸 → 없으면 앞쪽 세 칸 중 글자가 가장 긴 칸 */
    let tcol = -1;
    const probe = rows.slice(0, 8);
    for (let ci = 0; ci < names.length && tcol < 0; ci++) {
      if (probe.some(r => r.cells[ci] && r.cells[ci].querySelector(".tbl-open, strong, b:not(.mono)"))) tcol = ci;
    }
    if (tcol < 0) {
      let best = 0;
      for (let ci = 0; ci < Math.min(3, names.length); ci++) {
        const len = probe.reduce((n, r) => n + txtOf(r.cells[ci]).length, 0);
        if (len > best) { best = len; tcol = ci; }
      }
    }
    rows.forEach(r => {
      if (r.cells.length === 1 || r.classList.contains("grp-row")) { r.classList.add("tr-full"); return; }
      let ci = 0;
      Array.from(r.cells).forEach(c => {
        const nm = names[ci] || "";
        if (!c.hasAttribute("data-label")) c.setAttribute("data-label", nm);
        const t0 = txtOf(c);
        const ctl = c.querySelector("button, a, input, select");
        if (ci === tcol) c.setAttribute("data-role", "title");
        else if (ctl && (!nm || t0.length <= 6)) c.classList.add("td-act");
        else if ((!t0 || t0 === "-" || t0 === "—") && !c.querySelector("img, svg, input, button, canvas")) c.classList.add("td-nil");
        else if (c.querySelector(".badge, .chip, .tag") && t0.length <= 16) c.classList.add("td-bare");
        ci += c.colSpan || 1;
      });
    });
    return true;
  }
  function needsStack(t) {
    const par = t.parentElement;
    if (!par || !par.clientWidth) return false;
    if (t.offsetWidth > par.clientWidth + 4 || t.scrollWidth > par.clientWidth + 4) return true;
    const tds = t.querySelectorAll("tbody td");
    for (let i = 0; i < tds.length && i < 400; i++) {
      const c = tds[i];
      if (c.clientWidth && ((c.clientWidth < 72 && c.clientHeight > 76) || (c.clientWidth < 120 && c.clientHeight > 118))) return true;
    }
    return false;
  }
  function tidyTables(view) {
    const mob = isMobile();
    $$("table", view).forEach(t => {
      if (t.closest(TIDY_SKIP) || t.classList.contains("tbl-keep")) return;
      if (!t.dataset.lbl) t.dataset.lbl = labelTable(t) ? "1" : "0";
      else if (t.dataset.lbl === "1") labelTable(t);   // 나중에 붙은 행(더 보기 등)도 표시
      if (t.dataset.lbl !== "1" || !mob || t.dataset.stk) return;
      if (!t.getClientRects().length) return;   // 접힌 묶음 · 숨은 탭 안의 표는 펼칠 때 판정
      t.classList.remove("tbl-stack");
      const st = needsStack(t);
      t.classList.toggle("tbl-stack", st);
      t.dataset.stk = st ? "1" : "0";
    });
  }
  let tidyQueued = false, tidyObs = null;
  function tidyView() {
    tidyQueued = false;
    const view = $("#view");
    if (!view || !currentUser) return;
    if (tidyObs) tidyObs.disconnect();
    try {
      view.classList.toggle("m-editing", editingNow());
      $$(".page-head", view).forEach(tidyHead);
      /* 모바일에서 가로로 밀어 보는 요약 띠 — 키보드로도 스크롤할 수 있게(WCAG 2.1.1) */
      $$(".stat-row", view).forEach(r => {
        const sc = isMobile() && r.scrollWidth > r.clientWidth + 2;
        if (sc && r.getAttribute("tabindex") !== "0") { r.setAttribute("tabindex", "0"); r.setAttribute("role", "group"); r.setAttribute("aria-label", "요약 수치"); }
        else if (!sc && r.hasAttribute("tabindex")) { r.removeAttribute("tabindex"); r.removeAttribute("role"); r.removeAttribute("aria-label"); }
      });
      tidyTables(view);
      tidyFolds(view);
      tidyTabs(view);
    } finally {
      if (tidyObs) tidyObs.observe(view, { childList: true, subtree: true });
    }
  }
  function queueTidy() {
    if (tidyQueued) return;
    tidyQueued = true;
    const raf = (typeof window !== "undefined" && window.requestAnimationFrame) || ((f) => setTimeout(f, 16));
    raf(tidyView);
  }
  function watchView() {
    const view = $("#view");
    if (!view || tidyObs || typeof MutationObserver === "undefined") return;
    tidyObs = new MutationObserver(queueTidy);
    tidyObs.observe(view, { childList: true, subtree: true });
  }
  /* 폭이 모바일 경계를 넘으면 표 판정을 다시 */
  function resetStack() {
    $$("#view table[data-stk]").forEach(t => { t.classList.remove("tbl-stack"); delete t.dataset.stk; });
  }

  /* 액션 시트 — 아래에서 올라오는 선택 목록(iOS 방식). items: [{ label, icon, danger, disabled, run }] */
  let sheetBack = null;
  function closeActionSheet() {
    const w = document.getElementById("asheet");
    if (!w) return;
    w.classList.remove("on");
    const done = () => { if (w.parentNode) w.parentNode.removeChild(w); };
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) done(); else setTimeout(done, 260);
    if (sheetBack && sheetBack.focus) { try { sheetBack.focus(); } catch (e) {} }
    sheetBack = null;
  }
  function actionSheet(items, opts, from) {
    opts = opts || {};
    const old = document.getElementById("asheet");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    sheetBack = from || null;
    const w = document.createElement("div");
    w.id = "asheet"; w.className = "asheet no-print";
    w.innerHTML = '<div class="asheet-bd" data-as-close></div>' +
      '<div class="asheet-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="' + esc(opts.title || "더보기") + '">' +
      '<div class="asheet-list">' + (opts.title ? '<div class="asheet-t">' + esc(opts.title) + '</div>' : "") + items.map((it, i) =>
        '<button type="button" class="asheet-item' + (it.danger ? " danger" : "") + '" data-as="' + i + '"' + (it.disabled ? " disabled" : "") + '>' +
        '<span class="asheet-ico" aria-hidden="true">' + (it.icon || "") + '</span><span>' + esc(it.label) + '</span></button>').join("") +
      '</div><button type="button" class="asheet-cancel" data-as-close>취소</button></div>';
    layerHost().appendChild(w);
    $$("[data-as-close]", w).forEach(b => { b.onclick = closeActionSheet; });
    $$("[data-as]", w).forEach(b => {
      b.onclick = () => { const it = items[Number(b.dataset.as)]; sheetBack = null; closeActionSheet(); if (it && it.run) it.run(); };
    });
    w.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeActionSheet(); } });
    const raf = (typeof window !== "undefined" && window.requestAnimationFrame) || ((f) => setTimeout(f, 16));
    raf(() => { w.classList.add("on"); const pn = w.querySelector(".asheet-panel"); if (pn) { try { pn.focus({ preventScroll: true }); } catch (e) {} } });
    return w;
  }

  /* ── 공개 API ── */
  return {
    boot, registerModule, hasModule, navigate,
    get data() { return DATA; },
    save, load, onSave, saveSilent, normalizeData, defaultMenus,
    assignees, seedAssignees,
    get user() { return currentUser; },
    allUsers, isAdmin, roleRank, canEdit, canDelete, canConfid, canSee, navVisible, menuHidden, canHide,
    VENDOR_ACCESS, vendorAccess, vendorHome,
    signCodeFor, signCodeFromHash, signUrlFor, signSubmit,
    setAccounts, sessionLost, sessionUpdated, devSession, restoreSession, login, enterApp,
    renderNav, renderHeader, renderSecBadge, renderView, renderPlannedView,
    printView, printTitle, printHeadHTML, attachPrintBtn, markHub,
    registerSupport, renderSupport, openSupport, supportOk, registerPanelRoute, PANEL_ONLY, tidyTables, onRerender,
    icon, ui, ICONS, HUB_ICONS, hubOf, hubOfDeep, hubList, hubEntries, utilEntries, homeHubId,
    isLinkGroup, linkChildren, isIntranet, hostOf, openHub, hubHomeRoute, togglePanel, openSheet,
    LINK_ICONS, LINK_TONES, favOk, linkIconHTML, linkCardHTML, menuForModule,
    closeSidebar, closeOverlays, bundleOf, bundleMembers, hubModules, renderSubtabs,
    isMobile, actionSheet, closeActionSheet, tidyView, labelTable, setEditMode, mfToggle,
    get editing() { return editingNow(); },
    openModal, closeModal, confirmModal, toast,
    $, $$, esc, fmtDate, dsRing, sortedMenus,
    SEC_LEVELS, secCurrent, secNext, levelSorted,
    ROLE_LABEL, ROLE_RANK, VIS_LABEL,
    VERSION, APP_NAME, LS_DATA, LS_UI, SS_OWNER
  };
})();

// 전역 노출(테스트 · 외부 모듈 접근용)
if (typeof window !== "undefined") window.SeMIS = SeMIS;
