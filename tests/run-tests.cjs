/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — jsdom 테스트 스위트
   실행: npm test  (jsdom 필요: npm install)
   구성: [C] 코어(해시·계정·메뉴·정규화·권한·라우터·예정 모듈)
         [D] 대시보드·공지·현황판  [S] 시스템 설정  [M] 이식 모듈 스모크(일정·회의록·연락망·검색)
         [Y] 동기화  [W] 릴리스 위생(버전 스탬프·문자열 잔재)
   ═══════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const FILES = ["js/app.js", "js/qr.js", "js/modules.js", "js/calendar.js", "js/minutes.js", "js/contacts.js", "js/vault.js", "js/search.js", "js/sync.js"];
const ALL_JS = FILES.map(f => read(f)).join("\n;\n");
const HTML = read("index.html").replace(/<script[\s\S]*?<\/script>/g, "");

let passed = 0, failed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push("✗ " + name + " — " + e.message); }
}
async function ta(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; failures.push("✗ " + name + " — " + e.message); }
}
function eq(got, want, msg) {
  if (got !== want) throw new Error((msg || "eq") + ": expected " + JSON.stringify(want) + ", got " + JSON.stringify(got));
}
function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); }

function makeEnv(opts = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", (e) => { const m = String(e && e.message || e); if (m.indexOf("Not implemented") < 0) errors.push(m); });
  const dom = new JSDOM(HTML, { url: "https://logi.test/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.scrollTo = () => {};
  if (opts.preData) w.localStorage.setItem("semisl:data", JSON.stringify(opts.preData));
  if (opts.fetch) w.fetch = opts.fetch;
  // WebCrypto 폴리필 — jsdom은 crypto.subtle 미구현이라 Node webcrypto 주입 (vault 모듈용)
  try {
    const wc = require("crypto").webcrypto;
    if (!w.crypto || !w.crypto.subtle) Object.defineProperty(w, "crypto", { value: wc, configurable: true });
  } catch (e) { /* 구버전 Node — vault 테스트만 영향 */ }
  w.eval(ALL_JS);
  const S = w.SeMIS;
  if (opts.boot !== false) { S.boot(); if (w.SemisSearch) w.SemisSearch.init(); }
  return { dom, w, S, Sync: w.SemisSync, errors };
}
function submitLogin(env, pw) {
  const { w } = env;
  w.document.querySelector("#login-pw").value = pw;
  w.document.querySelector("#login-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
}
function loginAs(env, role) {
  const { S } = env;
  const pw = "testpw-" + role + "-9x";
  if (!S.data.customUsers.some(u => u.id === "t" + role)) {
    S.data.customUsers.push({ id: "t" + role, name: "T" + role, role, hash: S.pwHash(pw) });
    S.saveSilent();
  }
  submitLogin(env, pw);
  if (!S.user || S.user.id !== "t" + role) throw new Error("test login failed");
  return S.user;
}
function go(env, route) { env.w.location.hash = "#/" + route; env.S.renderView(); }
/* 시스템 설정 → 담당자 탭 다시 그리기 */
function renderSettings(env, tab) {
  go(env, "settings");
  const t2 = qa(env, ".tab").find(x => x.dataset.tab === (tab || "assignees"));
  if (t2) t2.click();
}
const q = (env, sel) => env.w.document.querySelector(sel);
const qa = (env, sel) => Array.from(env.w.document.querySelectorAll(sel));
const clickOk = (env) => q(env, "#modal-box [data-act=ok]").click();

function makeFetchStub(server) {
  const fn = (url, opts = {}) => {
    const method = opts.method || "GET";
    fn.calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
    if (server.fail) return Promise.reject(new Error("network down"));
    if (method === "GET") {
      if (String(url).indexOf("semis_store_history") >= 0) {
        const hist = (server.history || []).slice();
        const m = /[?&]id=eq\.([^&]+)/.exec(String(url));
        const km = /[?&]key=eq\.([^&]+)/.exec(String(url));
        let out = hist;
        if (m) out = hist.filter(h => String(h.id) === decodeURIComponent(m[1]));
        else if (km) out = hist.filter(h => h.key === decodeURIComponent(km[1]));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(out) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(server.rows.slice()) });
    }
    if (method === "POST") {
      const rows = JSON.parse(opts.body);
      rows.forEach(r => { const i = server.rows.findIndex(x => x.key === r.key); if (i >= 0) server.rows[i] = r; else server.rows.push(r); });
      return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve([]) });
    }
    return Promise.resolve({ ok: false, status: 405, json: () => Promise.resolve({}) });
  };
  fn.calls = [];
  return fn;
}

(async function run() {

  /* ══════════ [C] 코어 — 해시·계정 ══════════ */
  {
    const e = makeEnv();
    t("C01 sha256 표준 벡터(abc)", () => eq(e.S.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    t("C02 pwHash = sha256(SeMISv2::pw) — v2와 동일 SALT(관리자 암호 공유)", () => eq(e.S.pwHash("xyz"), e.S.sha256("SeMISv2:" + ":" + "xyz")));
    t("C03 기본 계정 4개 (admin/hq/manager/user)", () => {
      eq(e.S.BASE_USERS.length, 4);
      eq(e.S.BASE_USERS.map(u => u.role).join(","), "admin,hq,manager,user");
      eq(e.S.BASE_USERS.map(u => u.id).join(","), "mark3464,cargo-ss,cargo-mgr,cargo-user");
    });
    t("C04 mark3464 해시 = SeMIS v2 운영 해시(pwOverrides 반영, 동일 암호 접속)", () =>
      eq(e.S.BASE_USERS[0].hash, "e656cd08712ab870c57a6d483f57f88cae49bcd541ec9bb862e412670c23f389"));
    t("C05 평문 암호 미보관(64 hex)", () => ok(e.S.BASE_USERS.every(u => /^[0-9a-f]{64}$/.test(u.hash))));
    t("C06 기본 계정 해시 상호 중복 없음", () => eq(new Set(e.S.BASE_USERS.map(u => u.hash)).size, 4));
    t("C07 초기 암호로 hq/manager/user 로그인 가능(해시 대조)", () => {
      const h = e.S.pwHash;
      eq(e.S.BASE_USERS[1].hash, h("IcnSS#2609"));
      eq(e.S.BASE_USERS[2].hash, h("IcnMgr#2609"));
      eq(e.S.BASE_USERS[3].hash, h("IcnUser#2609"));
    });

    /* ══════════ [C] 코어 — 메뉴 시드·정규화 ══════════ */
    t("C08 메뉴 시드: 그룹 8개 · 예정 모듈 18개 이상 · 링크 5개", () => {
      const m = e.S.data.menus;
      eq(m.filter(x => x.type === "group").length, 8);
      ok(m.filter(x => x.type === "module" && x.planned).length >= 18, "planned");
      eq(m.filter(x => x.type === "link").length, 5);
    });
    t("C09 실모듈 메뉴(dashboard/schedule/minutes/contacts/settings) 존재 · planned 아님", () => {
      ["dashboard", "schedule", "minutes", "contacts", "settings"].forEach(id => {
        const mn = e.S.data.menus.find(x => x.type === "module" && x.module === id);
        ok(mn && !mn.planned, id);
      });
    });
    t("C10 settings=admin, dashboard=all, 링크는 https", () => {
      eq(e.S.data.menus.find(m => m.module === "settings").vis, "admin");
      eq(e.S.data.menus.find(m => m.module === "dashboard").vis, "all");
      ok(e.S.data.menus.filter(m => m.type === "link").every(m => /^https:\/\//.test(m.url)));
    });
    t("C11 예정 모듈은 모두 desc 보유 + 모듈 id 중복 없음", () => {
      const mods = e.S.data.menus.filter(m => m.type === "module");
      ok(mods.filter(m => m.planned).every(m => m.desc && m.desc.length > 10));
      eq(new Set(mods.map(m => m.module)).size, mods.length);
    });
    t("C12 SeMIS v2 잔재 없음 (menus에 kjsemis/항공보안파트 시드 없음)", () => {
      const j = JSON.stringify(e.S.data.menus);
      ok(j.indexOf("kjsemis") < 0); ok(j.indexOf("프로에스콤") < 0);
    });
    t("C13 normalizeData 멱등", () => { e.S.normalizeData(); eq(e.S.normalizeData(), false); });
    t("C14 필수 컬렉션 기본값", () => {
      const d = e.S.data;
      ok(Array.isArray(d.schedules) && Array.isArray(d.minutes) && Array.isArray(d.minuteFolders));
      ok(d.contacts && Array.isArray(d.contacts.sections));
      ok(d.safetyBoard && typeof d.safetyBoard.since === "string");
      ok(d.minuteFolders.length >= 6, "minutes 폴더 시드");
    });
    t("C14b 담당자 카테고리 시드 1명 + 필드 보정", () => {
      const a = e.S.assignees();
      eq(a.length, 1); eq(a[0].name, "최상일"); ok(a[0].short && a[0].emoji && a[0].id);
      e.S.data.assignees.push({ name: "무필드" });
      e.S.normalizeData();
      const b = e.S.assignees().find(x => x.name === "무필드");
      ok(b.id && b.emoji === "👤" && b.short === "드" && typeof b.seq === "number");
      e.S.data.assignees = e.S.data.assignees.filter(x => x.name !== "무필드");
    });
    t("C14c 담당자를 모두 지워도 다시 시드되지 않음(seeded 플래그)", () => {
      const keep = e.S.data.assignees.slice();
      e.S.data.assignees = [];
      e.S.normalizeData();
      eq(e.S.assignees().length, 0);
      e.S.data.assignees = keep; e.S.saveSilent();
    });
    t("C15 정규화: settings/dashboard 삭제·오염 시 복구", () => {
      const d = e.S.data;
      d.menus = d.menus.filter(m => m.module !== "settings" && m.module !== "dashboard");
      d.menus.push({ id: "bad", type: "module", module: "x", planned: "yes" });
      d.menus.push(null);
      e.S.normalizeData();
      ok(d.menus.some(m => m.module === "settings" && m.vis === "admin"));
      ok(d.menus.some(m => m.module === "dashboard" && m.vis === "all"));
      eq(d.menus.find(m => m.id === "bad").planned, true);
      ok(d.menus.every(Boolean));
    });
    t("C16 구버전 일정 {date} → 캘린더 스키마", () => {
      e.S.data.schedules.push({ id: "old1", title: "구", date: "2026-01-02" });
      e.S.normalizeData();
      const s = e.S.data.schedules.find(x => x.id === "old1");
      eq(s.start, "2026-01-02"); eq(s.end, "2026-01-02"); eq(s.allDay, true); eq(s.repeat.freq, "none");
      e.S.data.schedules = e.S.data.schedules.filter(x => x.id !== "old1");
    });
    t("C17 mark3464 보호: role/deleted override 무시", () => {
      e.S.data.userOverrides.mark3464 = { role: "user", deleted: true, name: "관리자" };
      e.S.normalizeData();
      const u = e.S.allUsers().find(x => x.origId === "mark3464");
      ok(u && u.role === "admin" && u.name === "관리자");
      delete e.S.data.userOverrides.mark3464;
    });

    /* ══════════ [C] 코어 — 인증·권한·라우팅 ══════════ */
    t("C18 잘못된 암호 거부", () => {
      submitLogin(e, "no-such-pw-000");
      ok(!e.S.user); ok(q(e, "#login-error").textContent.includes("올바르지"));
    });
    t("C19 user 로그인 → 세션(semisl:session)·앱 진입·헤더", () => {
      const u = loginAs(e, "user");
      eq(u.role, "user");
      ok(e.w.sessionStorage.getItem("semisl:session"));
      ok(q(e, "#login-overlay").classList.contains("hidden"));
      ok(q(e, "#user-chip").textContent.includes("일반사용자"));
      ok(q(e, "#app-version").textContent === "v" + e.S.VERSION);
    });
    t("C20 user: 사이드바에 mgr/hq 메뉴 미노출 · 규정 그룹(all)은 노출", () => {
      const routes = qa(e, ".nav-item").map(b => b.dataset.route).filter(Boolean);
      ok(routes.indexOf("dashboard") >= 0);
      ok(routes.indexOf("schedule") < 0, "schedule는 mgr");
      ok(routes.indexOf("settings") < 0);
      ok(routes.indexOf("reg-sec") >= 0, "규정(all)");
    });
    t("C21 user: 예정 모듈(all) 라우트 → 준비 중 안내 화면", () => {
      go(e, "reg-sec");
      ok(q(e, "#view").textContent.includes("준비 중"));
      ok(q(e, "#view").textContent.includes("항공보안 규정"));
    });
    t("C22 user: mgr 라우트 접근 → 대시보드로", () => {
      go(e, "schedule");
      ok(q(e, "#view").textContent.includes("대시보드"));
    });
    t("C23 user: 대시보드 경량 — 공지·현황·바로가기, 로드맵/일정 카드 없음", () => {
      go(e, "dashboard");
      const tx = q(e, "#view").textContent;
      ok(tx.includes("공지사항")); ok(tx.includes("안전보안 현황")); ok(tx.includes("바로가기"));
      ok(!tx.includes("모듈 구축 로드맵")); ok(!tx.includes("다가오는 일정"));
    });
    t("C24 canSee/canEdit 등급표", () => {
      loginAs(e, "manager");
      eq(e.S.roleRank(), 2); ok(e.S.canSee({ vis: "mgr" })); ok(!e.S.canSee({ vis: "hq" })); ok(!e.S.canEdit());
      loginAs(e, "hq");
      eq(e.S.roleRank(), 3); ok(e.S.canSee({ vis: "hq" })); ok(!e.S.canSee({ vis: "admin" })); ok(e.S.canEdit()); ok(e.S.canDelete()); ok(e.S.canConfid());
    });
    t("C25 hq: 사이드바 예정 태그 표시 · 예정 모듈 클릭 시 안내", () => {
      ok(qa(e, ".nav-item.planned .nav-tag").length >= 18);
      go(e, "car");
      ok(q(e, "#view").textContent.includes("시정조치"));
      ok(q(e, "#view .badge").textContent.includes("준비 중"));
    });
    t("C26 registerModule 후 같은 라우트는 실화면으로 대체(예정 태그 제거)", () => {
      e.S.registerModule("car", { title: "CAR", render(root) { root.innerHTML = "<h2>CAR 실화면</h2>"; } });
      e.S.renderNav(); go(e, "car");
      ok(q(e, "#view").textContent.includes("CAR 실화면"));
      ok(!qa(e, ".nav-item.planned").some(b => b.dataset.route === "car"));
      ok(e.S.hasModule("car"));
    });
    t("C27 embed 라우트: 링크 메뉴 내부 프레임", () => {
      const lk = e.S.data.menus.find(m => m.type === "link");
      lk.open = "frame"; e.S.saveSilent(); e.S.renderNav();
      go(e, "embed/" + lk.id);
      ok(q(e, "#view iframe.embed-frame"));
      eq(q(e, "#view iframe").getAttribute("src"), lk.url);
      lk.open = "tab";
    });
    t("C28 admin 로그인 → 시스템 설정 라우트 렌더", () => {
      loginAs(e, "admin");
      go(e, "settings");
      ok(q(e, "#view").textContent.includes("시스템 설정"));
      eq(qa(e, ".tab").length, 5);   // 메뉴·사용자·담당자·데이터·저장소
    });
    t("C29 로그아웃 → 세션 제거", () => {
      q(e, "#logout-btn").click();   // jsdom reload는 미구현(무해)
      ok(!e.S.user); ok(!e.w.sessionStorage.getItem("semisl:session"));
    });
    t("C30 vendor: 기본 프리셋은 dashboard만, 사이드바 축소", () => {
      e.S.data.customUsers.push({ id: "vend", name: "협력사", role: "vendor", vendor: "○○조업", hash: e.S.pwHash("vend-pw-1") });
      e.S.saveSilent(); submitLogin(e, "vend-pw-1");
      eq(e.S.user.role, "vendor");
      eq(e.S.vendorAccess(e.S.user).routes.join(","), "dashboard");
      eq(e.S.roleRank(), 1); ok(!e.S.canDelete());
      go(e, "settings");
      ok(q(e, "#view").textContent.includes("대시보드"));
      eq(qa(e, ".nav-item").length, 1);
    });
    t("C31 jsdom 오류 없음(코어 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [C] 세션 복원 · QR 서명 로그인 ══════════ */
  {
    const e = makeEnv({ boot: false });
    e.S.load();
    const mid = "m-test-1";
    e.S.data.minutes.push({ id: mid, title: "테스트 회의", date: "2026-09-10", folder: "mf-part", attendees: [], decisions: [], status: "draft", author: "x" });
    e.S.saveSilent();
    const code = e.S.signCodeFor({ id: mid });
    t("C32 signCodeFor: 6자리 결정적", () => { ok(/^\d{6}$/.test(code)); eq(code, e.S.signCodeFor({ id: mid })); });
    t("C33 signMinuteFor(code) → 회의록", () => eq(e.S.signMinuteFor(code).id, mid));
    t("C34 signUrlFor: 현재 origin + #/sign/코드", () => eq(e.S.signUrlFor({ id: mid }), "https://logi.test/#/sign/" + code));
    t("C35 QR 코드 로그인 → signer 세션 · 회의록 화면", () => {
      e.S.boot();
      submitLogin(e, code);
      ok(e.S.user && e.S.user.role === "signer");
      eq(e.S.roleRank(), 0);
      ok(q(e, "#hdr-search-wrap").classList.contains("vendor-hide"));
      eq(qa(e, ".nav-item").length, 1);
    });
  }
  {
    const e = makeEnv({ boot: false });
    e.S.load();
    e.w.sessionStorage.setItem("semisl:session", JSON.stringify({ uid: "cargo-ss", ts: Date.now() }));
    t("C36 세션 복원(cargo-ss) → 자동 진입", () => {
      e.S.boot();
      ok(e.S.user && e.S.user.id === "cargo-ss" && e.S.user.role === "hq");
      ok(q(e, "#login-overlay").classList.contains("hidden"));
    });
  }

  /* ══════════ [D] 대시보드 · 공지 · 현황판 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "dashboard");
    t("D01 hq 대시보드: 요약 스트립 타일 5개(무재해·7일 일정·미완료·경과·등급)", () => {
      const tiles = qa(e, ".ds-brief .ds-stat");
      eq(tiles.length, 5);
      ok(tiles[0].textContent.includes("무재해"));
      ok(tiles[4].textContent.includes("평시"));
    });
    t("D02 로드맵 카드에 예정 모듈 나열", () => {
      ok(q(e, "#view").textContent.includes("모듈 구축 로드맵"));
      ok(qa(e, ".ds-rows .ds-row[data-dash-go]").length >= 18);
    });
    t("D03 무재해 기준일 설정 → D+ 계산", () => {
      q(e, "#btn-edit-zero").click();
      const since = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
      q(e, "#f-since").value = since; q(e, "#f-znote").value = "테스트";
      q(e, "#f-save").click();
      eq(e.S.data.safetyBoard.since, since);
      eq(e.w.SemisDashFx.zeroDays(), 10);
      ok(q(e, ".zero-n").textContent === "D+10");
      ok(q(e, ".ds-brief .ds-stat b").textContent === "D+10");
    });
    t("D04 무재해 기준일 미래 → 거부", () => {
      q(e, "#btn-edit-zero").click();
      q(e, "#f-since").value = "2999-01-01"; q(e, "#f-save").click();
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "모달 유지");
      ok(e.S.data.safetyBoard.since !== "2999-01-01");
      e.S.closeModal();
    });
    t("D05 공지 작성 → 목록 · 검색 프로바이더 반영", () => {
      q(e, "#btn-add-notice").click();
      q(e, "#f-title").value = "화물터미널 안전점검 안내";
      q(e, "#nb-editor").innerHTML = "<b>9월</b> 점검 <script>alert(1)</script>";
      q(e, "#f-save").click();
      eq(e.S.data.notices.length, 2);
      const n = e.S.data.notices[1];
      ok(n.bodyHtml.indexOf("<script") < 0, "살균");
      ok(q(e, "#notice-list").textContent.includes("화물터미널 안전점검 안내"));
      const hits = e.w.SemisSearch.search("안전점검 안내");
      ok(hits.some(h => h.group === "공지사항"));
    });
    t("D06 공지 삭제(confirm)", () => {
      const id = e.S.data.notices[1].id;
      q(e, `#notice-list [data-del="${id}"]`).click(); clickOk(e);
      eq(e.S.data.notices.length, 1);
    });
    t("D07 보안등급 변경 → 배지·타일 반영", () => {
      q(e, "#btn-edit-level").click();
      q(e, "#f-level").value = "주의"; q(e, "#f-note").value = "테스트";
      q(e, "#f-save").click();
      eq(e.S.secCurrent().level, "주의");
      eq(q(e, "#sec-level-badge").dataset.level, "주의");
      ok(qa(e, ".ds-brief .ds-stat")[4].textContent.includes("주의"));
    });
    t("D08 회의 결정사항 미완료 → 대시보드 카드·타일", () => {
      e.S.data.minutes.push({ id: "m1", title: "제1차 정례회의", date: "2026-09-01", folder: "mf-part", status: "final",
        author: "Thq", attendees: [], decisions: [{ id: "d1", task: "지게차 점검표 개정", owner: "홍길동", due: "2026-01-01", done: false }, { id: "d2", task: "완료건", owner: "", due: "", done: true }] });
      e.S.saveSilent(); go(e, "dashboard");
      const acts = e.w.SemisDashFx.openActions();
      eq(acts.length, 1); eq(acts[0].task, "지게차 점검표 개정");
      ok(q(e, "#actions-box").textContent.includes("지게차 점검표 개정"));
      const tiles = qa(e, ".ds-brief .ds-stat");
      eq(tiles[2].querySelector("b").textContent, "1");
      eq(tiles[3].querySelector("b").textContent, "1", "기한 경과");
    });
    t("D09 jsdom 오류 없음(대시보드 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [S] 시스템 설정 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "admin");
    go(e, "settings");
    t("S01 메뉴 관리 탭: 트리 렌더 · 예정 모듈 배지", () => {
      ok(qa(e, "#menu-tree .menu-tree-item").length >= 30);
      ok(q(e, "#menu-tree").textContent.includes("예정 모듈"));
    });
    t("S02 링크 메뉴 추가(그룹 소속·바로가기)", () => {
      q(e, "#btn-add-menu").click();
      const grp = e.S.data.menus.find(m => m.id === "grp-ref");
      q(e, "#f-label").value = "화물 보안 구글시트"; q(e, "#f-url").value = "https://docs.google.com/x";
      q(e, "#f-parent").value = grp.id; q(e, "#f-quick").checked = true;
      q(e, "#f-save").click();
      const mn = e.S.data.menus.find(m => m.label === "화물 보안 구글시트");
      ok(mn && mn.type === "link" && mn.parent === grp.id && mn.quick === true && mn.open === "tab");
      ok(qa(e, ".nav-item").some(a => a.getAttribute("href") === "https://docs.google.com/x"));
    });
    t("S03 잘못된 URL 거부", () => {
      q(e, "#btn-add-menu").click();
      q(e, "#f-label").value = "x"; q(e, "#f-url").value = "ftp://nope";
      q(e, "#f-save").click();
      ok(!q(e, "#modal-overlay").classList.contains("hidden"));
      e.S.closeModal();
    });
    t("S04 예정 모듈 메뉴 추가(모듈 ID 검증)", () => {
      q(e, "#btn-add-menu").click();
      q(e, "#f-type").value = "planned"; q(e, "#f-type").dispatchEvent(new e.w.Event("change"));
      q(e, "#f-label").value = "ULD 관리"; q(e, "#f-route").value = "car";   // 중복
      q(e, "#f-desc").value = "ULD 대장";
      q(e, "#f-save").click();
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "중복 거부");
      q(e, "#f-route").value = "uld"; q(e, "#f-save").click();
      const mn = e.S.data.menus.find(m => m.module === "uld");
      ok(mn && mn.planned && mn.desc === "ULD 대장");
      go(e, "uld"); ok(q(e, "#view").textContent.includes("ULD 대장"));
      go(e, "settings");
    });
    t("S05 메뉴 순서 이동(▲▼)", () => {
      const grp = e.S.data.menus.find(m => m.id === "grp-cargo");
      const kids = () => e.S.sortedMenus().filter(m => m.parent === grp.id).map(m => m.id);
      const before = kids();
      q(e, `#menu-tree [data-down="${before[0]}"]`).click();
      const after = kids();
      eq(after[1], before[0]); eq(after[0], before[1]);
    });
    t("S06 그룹 삭제 → 하위 함께 삭제", () => {
      const grp = e.S.data.menus.find(m => m.id === "grp-partner");
      q(e, `#menu-tree [data-del="${grp.id}"]`).click(); clickOk(e);
      ok(!e.S.data.menus.some(m => m.id === grp.id || m.parent === grp.id));
    });
    t("S07 dashboard/settings 삭제 버튼 없음", () => {
      ok(!q(e, '#menu-tree [data-del="dashboard"]')); ok(!q(e, '#menu-tree [data-del="settings"]'));
    });
    /* ── 메뉴 숨기기 (권한과 별개) ── */
    t("S07b 숨김 토글: 사이드바·검색·대시보드에서 제외, 데이터·라우트는 유지", () => {
      qa(e, ".tab").find(x => x.dataset.tab === "menus").click();
      const target = e.S.data.menus.find(m => m.type === "module" && m.module === "schedule");
      ok(target, "일정관리 메뉴");
      ok(q(e, `#menu-tree [data-hide="${target.id}"]`), "숨김 버튼");
      // 숨기기 전: 사이드바에 있음
      e.S.renderNav();
      ok(q(e, '#nav-menu [data-route="schedule"]'), "숨기기 전 사이드바 노출");
      q(e, `#menu-tree [data-hide="${target.id}"]`).click();
      eq(e.S.data.menus.find(m => m.id === target.id).hidden, true, "hidden 플래그");
      ok(!q(e, '#nav-menu [data-route="schedule"]'), "사이드바에서 제거");
      ok(q(e, "#menu-tree").textContent.includes("숨김"), "숨김 배지");
      // 권한 게이트와는 별개 — canSee는 그대로 통과, 라우트도 동작
      ok(e.S.canSee(target), "canSee는 영향 없음");
      eq(e.S.navVisible(target), false, "navVisible만 false");
      go(e, "schedule");
      ok(q(e, "#view").textContent.includes("일정"), "주소로는 기능 유지");
      // 통합검색에서도 제외
      const menuHit = (env) => (env.w.SemisSearch.search("일정관리") || [])
        .some(h => h.group === "메뉴 · 링크" && h.route === "schedule");
      eq(menuHit(e), false, "검색 메뉴 결과 제외");
      // 되돌리기
      go(e, "settings");
      qa(e, ".tab").find(x => x.dataset.tab === "menus").click();
      q(e, `#menu-tree [data-hide="${target.id}"]`).click();
      eq(e.S.data.menus.find(m => m.id === target.id).hidden, undefined, "해제 시 플래그 제거");
      e.S.renderNav();
      ok(q(e, '#nav-menu [data-route="schedule"]'), "다시 노출");
      eq(menuHit(e), true, "해제 후 검색에 다시 등장");
    });
    t("S07c 모든 권한 공통 — 일반사용자에게도 숨겨짐", () => {
      const e2 = makeEnv();
      loginAs(e2, "admin");
      const t2 = e2.S.data.menus.find(m => m.type === "module" && m.module === "contacts");
      t2.hidden = true; e2.S.saveSilent();
      loginAs(e2, "manager");
      e2.S.renderNav();
      ok(!q(e2, '#nav-menu [data-route="contacts"]'), "manager 사이드바 제외");
      eq(e2.S.canSee(t2), true, "권한 자체는 통과");
    });
    t("S07d 그룹 숨김 → 하위 메뉴까지 숨김", () => {
      const grp2 = e.S.data.menus.find(m => m.type === "group");
      const child = e.S.data.menus.find(m => m.parent === grp2.id);
      ok(child, "하위 메뉴");
      grp2.hidden = true; e.S.saveSilent(); e.S.renderNav();
      eq(e.S.menuHidden(child), true, "하위 메뉴도 숨김 판정");
      ok(!qa(e, "#nav-menu .nav-group-label").some(x => x.textContent.includes(grp2.label)), "그룹 자체 제거");
      delete grp2.hidden; e.S.saveSilent(); e.S.renderNav();
    });
    t("S07e 대시보드·시스템 설정은 숨길 수 없음(버튼 없음 · 플래그 정규화)", () => {
      qa(e, ".tab").find(x => x.dataset.tab === "menus").click();
      ok(!q(e, '#menu-tree [data-hide="dashboard"]'));
      ok(!q(e, '#menu-tree [data-hide="settings"]'));
      const st = e.S.data.menus.find(m => m.module === "settings");
      st.hidden = true;
      e.S.normalizeData();
      eq(st.hidden, undefined, "정규화가 제거");
      eq(e.S.canHide(st), false);
    });
    t("S07f normalizeData 멱등 — hidden:false는 제거, true는 유지", () => {
      const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "minutes");
      mn.hidden = false; e.S.normalizeData();
      eq(mn.hidden, undefined);
      mn.hidden = true;
      eq(e.S.normalizeData(), false, "true는 변경 없음");
      eq(mn.hidden, true);
      delete mn.hidden; e.S.saveSilent();
    });
    t("S08 사용자 추가 · 중복 암호 거부 · 암호 변경 · 삭제", () => {
      qa(e, ".tab").find(x => x.dataset.tab === "users").click();
      q(e, "#btn-add-user").click();
      q(e, "#f-uid").value = "kim"; q(e, "#f-uname").value = "김안전"; q(e, "#f-urole").value = "manager";
      q(e, "#f-upw").value = "IcnSS#2609"; q(e, "#f-save").click();   // cargo-ss와 동일 암호
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "중복 암호 거부");
      q(e, "#f-upw").value = "kim-pw-77"; q(e, "#f-save").click();
      const u = e.S.allUsers().find(x => x.id === "kim");
      ok(u && u.role === "manager" && u.hash === e.S.pwHash("kim-pw-77"));
      const idx = e.S.allUsers().findIndex(x => x.id === "kim");
      q(e, `[data-pw="${idx}"]`).click();
      q(e, "#f-pw1").value = "kim-pw-88"; q(e, "#f-pw2").value = "kim-pw-88"; q(e, "#f-save").click();
      eq(e.S.allUsers().find(x => x.id === "kim").hash, e.S.pwHash("kim-pw-88"));
      q(e, `[data-del="${idx}"]`).click(); clickOk(e);
      ok(!e.S.allUsers().some(x => x.id === "kim"));
    });
    t("S09 기본 계정 수정(userOverrides) · mark3464 권한 잠금", () => {
      const users = e.S.allUsers();
      const i = users.findIndex(x => x.origId === "cargo-mgr");
      q(e, `[data-edit="${i}"]`).click();
      q(e, "#f-uname").value = "화물팀 감독자"; q(e, "#f-save").click();
      eq(e.S.data.userOverrides["cargo-mgr"].name, "화물팀 감독자");
      const j = e.S.allUsers().findIndex(x => x.origId === "mark3464");
      q(e, `[data-edit="${j}"]`).click();
      ok(q(e, "#f-urole").disabled); e.S.closeModal();
      ok(!q(e, `[data-del="${j}"]`), "관리자 삭제 버튼 없음");
    });
    t("S9b 담당자 탭: 목록 렌더 · 추가 · 중복 거부", () => {
      qa(e, ".tab").find(x => x.dataset.tab === "assignees").click();
      ok(q(e, "#view").textContent.includes("일정 담당자"));
      eq(qa(e, ".as-tbl tbody tr").length, 1);
      q(e, "#btn-add-as").click();
      q(e, "#f-asname").value = "최상일"; q(e, "#f-save").click();
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "중복 이름 거부");
      q(e, "#f-asname").value = "김화물"; q(e, "#f-astitle").value = "인천화물팀";
      q(e, "#f-asemoji").value = "📦"; q(e, "#f-asshort").value = "김";
      q(e, "#f-save").click();
      const a = e.S.assignees();
      eq(a.length, 2); eq(a[1].name, "김화물"); eq(a[1].short, "김"); eq(a[1].emoji, "📦");
      ok(q(e, ".as-tbl").textContent.includes("인천화물팀"));
    });
    t("S9c 담당자 순서 이동(▲▼)", () => {
      const before = e.S.assignees().map(x => x.name);
      q(e, `[data-as-down="${e.S.assignees()[0].id}"]`).click();
      const after = e.S.assignees().map(x => x.name);
      eq(after[0], before[1]); eq(after[1], before[0]);
      q(e, `[data-as-up="${e.S.assignees()[1].id}"]`).click();
      eq(e.S.assignees().map(x => x.name).join(","), before.join(","));
    });
    t("S9d 담당자 이름 변경 시 배정된 일정의 담당자도 함께 변경", () => {
      e.S.data.schedules.push({ id: "sA", title: "점검", start: "2026-09-20", end: "2026-09-20",
        allDay: true, time: "", timeEnd: "", color: "teal", done: false, assignee: "김화물",
        vehicle: false, room: false, reminders: [], repeat: { freq: "none", until: "" },
        doneFrom: "", doneDates: [], undoneDates: [] });
      e.S.saveSilent();
      const id = e.S.assignees().find(x => x.name === "김화물").id;
      q(e, `[data-as-edit="${id}"]`).click();
      q(e, "#f-asname").value = "김화물주"; q(e, "#f-save").click();
      eq(e.S.data.schedules.find(x => x.id === "sA").assignee, "김화물주");
      ok(!e.S.assignees().some(x => x.name === "김화물"));
    });
    t("S9e 직접 입력된 담당자 → 목록에 추가(승격)", () => {
      e.S.data.schedules.push({ id: "sB", title: "교육", start: "2026-09-21", end: "2026-09-21",
        allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "박조업",
        vehicle: false, room: false, reminders: [], repeat: { freq: "none", until: "" },
        doneFrom: "", doneDates: [], undoneDates: [] });
      e.S.saveSilent();
      renderSettings(e);
      ok(q(e, "#view").textContent.includes("박조업"));
      q(e, '[data-as-promote="박조업"]').click();
      eq(q(e, "#f-asname").value, "박조업");
      q(e, "#f-save").click();
      ok(e.S.assignees().some(x => x.name === "박조업"));
      ok(!qa(e, ".as-free-item").length, "승격 후 직접 입력 목록에서 사라짐");
    });
    t("S9f 담당자 삭제 — 일정의 담당자 이름은 보존", () => {
      const id = e.S.assignees().find(x => x.name === "박조업").id;
      q(e, `[data-as-del="${id}"]`).click(); clickOk(e);
      ok(!e.S.assignees().some(x => x.name === "박조업"));
      eq(e.S.data.schedules.find(x => x.id === "sB").assignee, "박조업");
    });
    t("S9g 담당자 탭: 다중 담당자 일정도 사람별로 집계 · 개명 시 문자열 안에서 교체", () => {
      e.S.data.schedules.push({ id: "sM2", title: "합동", start: "2026-09-26", end: "2026-09-26", allDay: true,
        time: "", timeEnd: "", color: "teal", done: false, assignee: "최상일, 정검색", vehicle: false, room: false,
        reminders: [], repeat: { freq: "none", until: "" }, doneFrom: "", doneDates: [], undoneDates: [] });
      e.S.saveSilent();
      renderSettings(e);
      const row = qa(e, ".as-tbl tbody tr").find(r => r.textContent.indexOf("최상일") >= 0);
      ok(row.textContent.indexOf("1건") >= 0, "다중 담당 일정도 집계");
      ok(q(e, "#view").textContent.indexOf("정검색") >= 0, "직접 입력 담당자로 표시");
      const id = e.S.assignees().find(x => x.name === "최상일").id;
      q(e, `[data-as-edit="${id}"]`).click();
      q(e, "#f-asname").value = "최상일프로"; q(e, "#f-save").click();
      eq(e.S.data.schedules.find(x => x.id === "sM2").assignee, "최상일프로, 정검색");
    });
    t("S9h 데이터 탭: 구글 캘린더 연동이 시스템 설정으로 이관(관리자 전용)", () => {
      renderSettings(e, "data");
      ok(q(e, "#btn-gcal"), "연동 버튼");
      ok(q(e, "#view").textContent.includes("구글 캘린더 연동"));
      eq(q(e, "#gcal-state").textContent.indexOf("사용 안 함") >= 0, true);
      q(e, "#btn-gcal").click();
      ok(q(e, "#modal-box").textContent.includes("구글캘린더 연동"), "연동 설정 모달");
      q(e, "#g-enabled").checked = true;
      q(e, "#g-calid").value = "icncargo@gmail.com";
      q(e, "#g-save").click();
      eq(e.S.data.gcal.enabled, true);
      eq(e.S.data.gcal.calendarId, "icncargo@gmail.com");
    });
    t("S10 데이터 탭: 백업 JSON · 메뉴 재설정", () => {
      qa(e, ".tab").find(x => x.dataset.tab === "data").click();
      ok(q(e, "#view").textContent.includes("semis_logi_store"));
      e.S.data.menus = e.S.data.menus.filter(m => m.id !== "grp-rule" && m.parent !== "grp-rule");
      e.S.saveSilent();
      q(e, "#btn-reset-menu").click(); clickOk(e);
      ok(e.S.data.menus.some(m => m.id === "grp-rule"));
    });
    t("S10b 데이터 탭: 변경 이력(서버 자동 백업) 복원 카드", () => {
      qa(e, ".tab").find(x => x.dataset.tab === "data").click();
      const tx = q(e, "#view").textContent;
      ok(tx.includes("변경 이력"), "카드 제목");
      ok(q(e, "#hist-key"), "컬렉션 선택");
      ok(q(e, "#hist-body"), "이력 본문");
      ok(q(e, "#btn-hist-reload"), "불러오기 버튼");
    });
    t("S11 저장소 탭: fetch 없이도 렌더(조회 실패 안내)", () => {
      qa(e, ".tab").find(x => x.dataset.tab === "storage").click();
      ok(q(e, "#view").textContent.includes("semis-logi-files"));
      ok(qa(e, ".st-tbl").length >= 1);
    });
    t("S12 저장소 유틸: orphanFiles 안전장치 · fmtBytes", () => {
      const St = e.w.SemisStorage;
      eq(St.orphanFiles([{ path: "a" }], new Set()).length, 0, "참조 0 → 잠금");
      const now = Date.now();
      const files = [{ path: "notices/a.png", updated: new Date(now - 3 * 86400000).toISOString() },
        { path: "attach/b.pdf", updated: new Date(now - 3 * 86400000).toISOString() },
        { path: "attach/new.pdf", updated: new Date(now - 1000).toISOString() }];
      const orph = St.orphanFiles(files, new Set(["notices/a.png"]), now);
      eq(orph.map(f => f.path).join(","), "attach/b.pdf");
      eq(St.fmtBytes(1536), "1.5 KB");
    });
    t("S13 jsdom 오류 없음(설정 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [M] 이식 모듈 스모크 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    t("M01 일정관리 렌더 · 등록 · 대시보드 반영", () => {
      go(e, "schedule");
      ok(q(e, "#view").textContent.includes("안전보안 일정관리"));
      const d = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      e.S.data.schedules.push({ id: "s1", title: "지게차 안전점검", memo: "", start: d, end: d, allDay: true, time: "", timeEnd: "",
        color: "teal", done: false, assignee: "", vehicle: false, room: false, reminders: [], repeat: { freq: "none", until: "" }, doneFrom: "", doneDates: [], undoneDates: [] });
      e.S.saveSilent();
      go(e, "dashboard");
      ok(q(e, "#upcoming-box").textContent.includes("지게차 안전점검"));
      ok(q(e, ".ds-brief").textContent.includes("7일 내 일정"));
      eq(qa(e, ".ds-brief .ds-stat")[1].querySelector("b").textContent, "1");
    });
    t("M02 회의록 게시판 렌더 · 폴더 시드(화물팀 구성)", () => {
      go(e, "minutes");
      const tx = q(e, "#view").textContent;
      ok(tx.includes("회의록"));
      ok(e.S.data.minuteFolders.some(f => f.name.indexOf("안전보안파트") >= 0));
      ok(!e.S.data.minuteFolders.some(f => f.name.indexOf("항공보안파트") >= 0));
    });
    t("M03 연락망: 빈 상태 → 기본 구성 만들기(개인정보 없는 서식)", () => {
      go(e, "contacts");
      ok(q(e, "#view").textContent.includes("비상연락망"));
      ok(q(e, "#ct-seed"));
      q(e, "#ct-seed").click();
      ok(e.S.data.contacts.sections.length >= 8);
      ok(q(e, "#view").textContent.includes("사건별 보고처"));
      const people = e.S.data.contacts.sections.filter(s => s.type === "people");
      ok(people.every(s => (s.rows || []).every(r => !r.mobile)), "휴대전화 미시드");
    });
    t("M04 연락망: 섹션 추가 · 행 편집 · 섹션 삭제", () => {
      q(e, "#ct-addsec").click();
      q(e, "#cs-title").value = "조업사 안전담당"; q(e, "#cs-save").click();
      const sec = e.S.data.contacts.sections.find(s => s.title === "조업사 안전담당");
      ok(sec && sec.type === "people");
      q(e, `[data-ct-edit="${sec.id}"]`).click();
      q(e, "#cte-add").click();
      q(e, '#cte-rows [data-f="name"]').value = "홍길동"; q(e, '#cte-rows [data-f="mobile"]').value = "010-1234-5678";
      q(e, "#cte-save").click();
      eq(sec.rows.length, 1);
      ok(q(e, "#view").textContent.includes("홍길동"));
      ok(e.w.SemisSearch.search("홍길동").some(h => h.group === "비상연락망"));
      q(e, `[data-ct-edit="${sec.id}"]`).click();
      q(e, "#cte-delsec").click(); clickOk(e);
      ok(!e.S.data.contacts.sections.some(s => s.id === sec.id));
    });
    t("M05 manager: 연락망 열람만(편집·시드 버튼 없음)", () => {
      loginAs(e, "manager");
      go(e, "contacts");
      ok(!q(e, "#ct-addsec")); ok(!q(e, "[data-ct-edit]"));
    });
    t("M06 통합검색: 메뉴 히트 + 권한 범위(manager는 설정 메뉴 미검색)", () => {
      const hits = e.w.SemisSearch.search("일정관리");
      ok(hits.some(h => h.group === "메뉴 · 링크" && h.route === "schedule"));
      ok(!e.w.SemisSearch.search("시스템 설정").some(h => h.route === "settings"));
    });
    t("M06b 일정관리: 담당자 목록이 필터 칩·선택 버튼에 반영", () => {
      loginAs(e, "hq");
      e.S.data.assignees.push({ id: "as-x", seq: 5, name: "정검색", title: "검색팀", emoji: "🔎", short: "정" });
      e.S.saveSilent();
      go(e, "schedule");
      ok(qa(e, ".cal-filters [data-assignee]").some(b => b.dataset.assignee === "정검색"), "필터 칩");
      eq(e.w.SemisCalendar.tagOf("정검색"), "정");
      eq(e.w.SemisCalendar.tagOf("미등록자"), "미");
      ok(e.w.SemisCalendar.assigneeList().indexOf("정검색") >= 0);
      e.S.data.assignees = e.S.data.assignees.filter(x => x.id !== "as-x");
      e.S.saveSilent();
    });
    t("M06c 담당자 다중 지정: 분해·태그·필터", () => {
      const C = e.w.SemisCalendar;
      e.S.data.assignees = [
        { id: "a1", seq: 1, name: "최상일", title: "", emoji: "🛡️", short: "최" },
        { id: "a2", seq: 2, name: "김화물", title: "", emoji: "📦", short: "김" },
        { id: "a3", seq: 3, name: "이보안", title: "", emoji: "🔎", short: "이" }
      ];
      e.S.saveSilent();
      eq(C.splitNames("최상일, 김화물 , 이보안").join("|"), "최상일|김화물|이보안");
      eq(C.joinNames(["최상일", "김화물", "최상일", " "]), "최상일, 김화물");
      eq(C.tagsOf("최상일, 김화물"), "최·김");
      eq(C.tagsOf("최상일, 김화물, 이보안"), "최·김+1");
      eq(C.tagsOf("최상일"), "최");
      const ev = { assignee: "최상일, 김화물" };
      ok(C.hasName(ev, "김화물")); ok(!C.hasName(ev, "이보안"));
      const d = "2026-09-25";
      e.S.data.schedules.push({ id: "sM", title: "합동 점검", start: d, end: d, allDay: true, time: "", timeEnd: "",
        color: "teal", done: false, assignee: "최상일, 김화물", vehicle: false, room: false, reminders: [],
        repeat: { freq: "none", until: "" }, doneFrom: "", doneDates: [], undoneDates: [] });
      e.S.saveSilent();
      C.setFilter("김화물", undefined);
      ok(C.filteredEvents().some(x => x.id === "sM"), "다중 담당자 중 1명으로 필터");
      C.setFilter("이보안", undefined);
      ok(!C.filteredEvents().some(x => x.id === "sM"));
      C.setFilter("", undefined);
      ok(C.assigneeList().indexOf("김화물") >= 0);
    });
    t("M06d 일정 폼: 담당자 칩 다중 토글 → 쉼표 문자열 저장", () => {
      go(e, "schedule");
      q(e, "#cal-add").click();
      const chips = qa(e, ".team-btn");
      ok(chips.length >= 3);
      chips[0].click(); chips[1].click();
      eq(q(e, "#f-assignee").value, "최상일, 김화물");
      ok(chips[0].classList.contains("sel") && chips[1].classList.contains("sel"));
      chips[0].click();                                   // 다시 누르면 해제
      eq(q(e, "#f-assignee").value, "김화물");
      ok(!chips[0].classList.contains("sel"));
      q(e, "#f-title").value = "다중 담당 일정";
      q(e, "#f-assignee").value = "김화물, 이보안, 박조업";
      q(e, "#f-save").click();
      const rec = e.S.data.schedules.find(x => x.title === "다중 담당 일정");
      ok(rec); eq(rec.assignee, "김화물, 이보안, 박조업");
    });
    t("M06e 일정관리 머리말: 안내문 축약 + 구글연동 버튼 없음", () => {
      go(e, "schedule");
      const head = q(e, ".page-head");
      eq(q(e, ".page-note").textContent.trim(), "일정을 드래그하여 이동 가능");
      ok(!head.textContent.includes("인천화물팀 안전보안파트 주요 일정"), "긴 안내문 제거");
      ok(!q(e, "#cal-gcal"), "구글 연동 버튼은 일정관리에 없음");
      ok(!q(e, ".page-desc"), "page-desc 제거");
    });
    t("M06f 일반 사용자(manager)에게는 안내문·등록 버튼 미노출", () => {
      loginAs(e, "manager");
      go(e, "schedule");
      ok(!q(e, ".page-note")); ok(!q(e, "#cal-add"));
      loginAs(e, "hq");
    });
    t("M07 jsdom 오류 없음(모듈 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [P] A4 인쇄 버튼 (모든 화면 공통 규칙) ══════════ */
  {
    const e = makeEnv();
    let printed = 0;
    e.w.print = () => { printed++; };
    loginAs(e, "admin");
    const ROUTES = ["dashboard", "schedule", "minutes", "contacts", "settings", "reg-sec", "car", "kc-ra"];
    t("P01 모든 화면(대시보드·모듈·예정 모듈·설정)에 인쇄 버튼", () => {
      ROUTES.forEach(r => {
        go(e, r);
        const btn = q(e, "#view [data-print-btn]");
        ok(btn, r + " 인쇄 버튼 없음");
        ok(btn.textContent.indexOf("인쇄") >= 0);
        ok(btn.classList.contains("no-print"));
      });
    });
    t("P02 인쇄 버튼은 화면 머리말(.ds-head/.page-head) 안에 위치", () => {
      go(e, "dashboard");
      ok(q(e, ".ds-head [data-print-btn]"));
      go(e, "contacts");
      ok(q(e, ".page-head [data-print-btn]"));
    });
    t("P03 중복 부착 없음(재렌더 시 1개 유지)", () => {
      go(e, "schedule"); e.S.renderView(); e.S.renderView();
      eq(qa(e, "#view [data-print-btn]").length, 1);
    });
    await ta("P04 인쇄 실행 → 문서 머리말(시스템명·화면명·출력일시·출력자) 삽입 + print 호출", async () => {
      go(e, "minutes");
      q(e, "#view [data-print-btn]").click();
      const head = q(e, "#print-head");
      ok(head, "print-head 없음");
      eq(q(e, "#view").firstChild, head, "머리말이 화면 맨 위");
      const tx = head.textContent;
      ok(tx.indexOf("SeMIS · Logistics") >= 0);
      ok(tx.indexOf("회의록 게시판") >= 0, "화면명");
      ok(/출력일시 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(tx), "출력일시");
      ok(tx.indexOf("시스템관리자") >= 0, "출력자");
      await new Promise(r => setTimeout(r, 120));
      eq(printed, 1);
    });
    t("P05 화면명은 메뉴 라벨을 따름(예정 모듈 포함)", () => {
      eq(e.S.printTitle("car").indexOf("시정조치") >= 0, true);
      eq(e.S.printTitle("dashboard").indexOf("대시보드") >= 0, true);
    });
    t("P06 CSS: @media print 규칙(헤더·사이드바·버튼 숨김, A4 여백)", () => {
      const c = read("css/main.css");
      ok(c.indexOf("@media print") > 0);
      ok(c.indexOf("size: A4 portrait") > 0);
      ok(/@media print[\s\S]*\.sidebar[\s\S]*display: none/.test(c), "사이드바 숨김");
      ok(c.indexOf("#print-head") > 0);
    });
    t("P07 jsdom 오류 없음(인쇄 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [Y] 동기화 ══════════ */
  {
    const server = { rows: [], fail: false };
    const fetch = makeFetchStub(server);
    const e = makeEnv({ fetch });
    const { Sync } = e;
    t("Y01 SYNC_KEYS 구성", () =>
      eq(Sync.SYNC_KEYS.join(","), "menus,notices,schedules,assignees,assigneesSeeded,minutes,minuteFolders,levelHistory,safetyBoard,contacts,pwOverrides,userOverrides,customUsers,gcal,chatRooms,vault"));
    t("Y02 SYNC_KEYS는 모두 freshData 컬렉션에 존재", () => Sync.SYNC_KEYS.forEach(k => ok(e.S.data[k] !== undefined, k)));
    await ta("Y03 초기 pull: 빈 서버 → 로컬 시드 push (semis_logi_store)", async () => {
      await Sync.init();
      ok(fetch.calls.some(c => c.url.indexOf("/rest/v1/semis_logi_store") >= 0));
      ok(server.rows.some(r => r.key === "menus"));
      eq(Sync.status, "online");
    });
    await ta("Y04 로컬 변경 → 디바운스 push", async () => {
      loginAs(e, "hq");
      e.S.data.safetyBoard.since = "2026-01-01"; e.S.save();
      await Sync._flush();
      eq(server.rows.find(r => r.key === "safetyBoard").value.since, "2026-01-01");
    });
    t("Y05 원격 변경 반영(applyRemote) → 화면 갱신", () => {
      go(e, "dashboard");
      Sync.applyRemote("notices", [{ id: "nr", title: "원격 공지", body: "b", author: "x", pinned: false, created: "2026-09-01T00:00:00Z" }]);
      eq(e.S.data.notices[0].title, "원격 공지");
      ok(q(e, "#notice-list").textContent.includes("원격 공지"));
    });
    t("Y06 canon: 키 순서 무관 동일", () => eq(Sync._canon({ b: 1, a: [1, { d: 2, c: 3 }] }), Sync._canon({ a: [1, { c: 3, d: 2 }], b: 1 })));
    await ta("Y07 오프라인: pending 큐 보관 후 재접속 push", async () => {
      server.fail = true;
      e.S.data.notices.push({ id: "off1", title: "오프라인 공지", body: "", author: "x", pinned: false, created: "2026-09-02T00:00:00Z" });
      e.S.save();
      await Sync._flush().catch(() => {});
      eq(Sync.status, "offline");
      ok(Sync.pendingKeys().indexOf("notices") >= 0);
      server.fail = false;
      await Sync.syncNow();
      ok(server.rows.find(r => r.key === "notices").value.some(n => n.id === "off1"));
      eq(Sync.pendingKeys().length, 0);
    });
    t("Y08 uploadFile 경로: semis-logi-files 버킷", () => ok(Sync.PUBLIC_PREFIX.indexOf("/object/public/semis-logi-files/") > 0));

    /* ── 대량 삭제 방어 (2026-09-17 일정 전량 유실 사고 대응) ── */
    await ta("Y09 로컬 배열이 통째로 비면 push 차단 + 직전 상태 복구", async () => {
      e.S.data.schedules = [
        { id: "g1", title: "A", start: "2026-09-01", end: "2026-09-01" },
        { id: "g2", title: "B", start: "2026-09-02", end: "2026-09-02" },
        { id: "g3", title: "C", start: "2026-09-03", end: "2026-09-03" }
      ];
      e.S.save(); await Sync._flush();
      eq(server.rows.find(r => r.key === "schedules").value.length, 3);
      const before = Sync.guardEvents().length;
      e.S.data.schedules = [];              // 저장소 손상·버그 상황 재현
      e.S.save(); await Sync._flush();
      eq(server.rows.find(r => r.key === "schedules").value.length, 3, "서버 데이터 보존");
      eq(e.S.data.schedules.length, 3, "로컬 복구");
      eq(Sync.guardEvents().length, before + 1, "가드 로그 기록");
      eq(Sync.pendingKeys().indexOf("schedules"), -1, "pending에서 제외");
    });
    t("Y10 가드 기준: 1건뿐이던 배열을 지우는 것은 정상 삭제로 허용", () => {
      eq(Sync.GUARD_MIN, 2);
      e.S.data.schedules = [{ id: "g9", title: "only", start: "2026-09-09", end: "2026-09-09" }];
      Sync.snapAll();
      e.S.data.schedules = [];
      eq(Sync.guardWipe(["schedules"]).length, 0);
    });
    await ta("Y11 confirmWipe() 후에는 전량 삭제가 서버에 반영", async () => {
      e.S.data.schedules = [
        { id: "h1", title: "A", start: "2026-09-01", end: "2026-09-01" },
        { id: "h2", title: "B", start: "2026-09-02", end: "2026-09-02" }
      ];
      e.S.save(); await Sync._flush();
      eq(server.rows.find(r => r.key === "schedules").value.length, 2);
      e.S.data.schedules = [];
      Sync.confirmWipe("schedules");
      e.S.save(); await Sync._flush();
      eq(server.rows.find(r => r.key === "schedules").value.length, 0);
      eq(Sync.guardWipe(["schedules"]).length, 0);
    });
    await ta("Y12 confirmWipe는 1회용 — 다음 전량 삭제는 다시 차단", async () => {
      e.S.data.schedules = [
        { id: "i1", title: "A", start: "2026-09-01", end: "2026-09-01" },
        { id: "i2", title: "B", start: "2026-09-02", end: "2026-09-02" }
      ];
      e.S.save(); await Sync._flush();
      e.S.data.schedules = [];
      e.S.save(); await Sync._flush();
      eq(server.rows.find(r => r.key === "schedules").value.length, 2);
      eq(e.S.data.schedules.length, 2);
    });
    await ta("Y13 변경 이력 조회 · 되돌리기(restoreHistory)", async () => {
      server.history = [{ id: 11, key: "schedules", old_len: 5, new_len: 0,
        changed_at: "2026-09-17T07:44:34Z", changed_by: "cmu557qn92utfk3",
        old_value: [{ id: "r1", title: "복구된 일정", start: "2026-09-10", end: "2026-09-10" }] }];
      const rows = await Sync.history("schedules", 10);
      eq(rows.length, 1); eq(rows[0].key, "schedules");
      ok(fetch.calls.some(c => c.url.indexOf("src=eq.semis_logi_store") >= 0), "src 필터");
      await Sync.restoreHistory(11);
      eq(e.S.data.schedules[0].title, "복구된 일정");
      eq(server.rows.find(r => r.key === "schedules").value[0].title, "복구된 일정");
    });
    t("Y14 jsdom 오류 없음(동기화 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
    Sync.stop();
  }

  /* ══════════ [VT] 암호 관리 (vault) — 클라이언트 암호화 저장소 ══════════ */
  {
    t("VT01 normalize: vault 구조/메뉴 자동 삽입 (vis=hq · 시스템 설정 위)", () => {
      const e = makeEnv();
      const d = e.S.data;
      delete d.vault;
      d.menus = d.menus.filter(m => !(m.type === "module" && m.module === "vault"));
      eq(e.S.normalizeData(), true);
      ok(d.vault && Array.isArray(d.vault.members) && d.vault.data === null, "구조 보정");
      const mn = d.menus.find(m => m.type === "module" && m.module === "vault");
      ok(mn, "메뉴 삽입"); eq(mn.vis, "hq"); eq(mn.parent, null, "최상위");
      const st = d.menus.find(m => m.id === "settings");
      ok(mn.seq < st.seq, "시스템 설정 위");
      ok(e.Sync.SYNC_KEYS.includes("vault"), "SYNC_KEYS 포함");
      eq(e.S.normalizeData(), false, "멱등");
    });
    t("VT02 manager 접근 차단 (vis=hq → 대시보드 폴백)", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      go(e, "vault");
      ok(q(e, "#view").textContent.includes("대시보드"), "대시보드 폴백");
    });
    await ta("VT03 최초 설정 + 암호화 저장: 평문이 어디에도 남지 않음", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "master-pw-1");
      ok(VT.isUnlocked(), "설정 후 해제 상태");
      eq(e.S.data.vault.members.length, 1);
      await VT.addEntryForTest({ category: "시스템", title: "테스트항목", account: "admin", pw: "SuperSecret123!", url: "", note: "" });
      eq(VT.entryCount(), 1);
      ok(e.S.data.vault.data && e.S.data.vault.data.ct, "암호문 저장");
      const raw = e.w.localStorage.getItem("semisl:data") || "";
      ok(!raw.includes("SuperSecret123!"), "localStorage 평문 미노출");
      ok(!raw.includes("master-pw-1"), "개인 비밀번호 미저장");
      ok(!JSON.stringify(e.S.data.vault).includes("SuperSecret123!"), "동기화 대상에 평문 없음");
      VT.lock();
    });
    await ta("VT04 잠금/해제: 오답 거부 + 정답 복호화", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "master-pw-1");
      await VT.addEntryForTest({ category: "시스템", title: "테스트항목", account: "a", pw: "SuperSecret123!", url: "", note: "" });
      VT.lock();
      ok(!VT.isUnlocked(), "잠금");
      eq(VT.entryCount(), null, "잠금 시 항목 접근 불가");
      const mid = e.S.data.vault.members[0].id;
      let rejected = false;
      try { await VT.unlock(mid, "wrong-pw"); } catch (err) { rejected = true; }
      ok(rejected && !VT.isUnlocked(), "오답 거부");
      await VT.unlock(mid, "master-pw-1");
      eq(VT.findEntry("테스트항목").pw, "SuperSecret123!", "복호화 일치");
      VT.lock();
    });
    await ta("VT05 멤버: 추가 · 비밀번호 변경 · 최소 1명 보호", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      await VT.addMember("김홍석", "pw-kim");
      eq(e.S.data.vault.members.length, 2);
      VT.lock();
      const m2 = e.S.data.vault.members.find(m => m.name === "김홍석");
      await VT.unlock(m2.id, "pw-kim");
      ok(VT.isUnlocked(), "새 멤버 비밀번호로 해제");
      await VT.changeMemberPw(m2.id, "pw-kim-2");
      VT.lock();
      let old2 = false;
      try { await VT.unlock(m2.id, "pw-kim"); } catch (err) { old2 = true; }
      ok(old2, "이전 비밀번호 무효");
      await VT.unlock(m2.id, "pw-kim-2");
      VT.removeMember(e.S.data.vault.members.find(m => m.name === "최상일").id);
      eq(e.S.data.vault.members.length, 1);
      VT.removeMember(m2.id);
      eq(e.S.data.vault.members.length, 1, "최소 1명 보호");
      VT.lock();
    });
    await ta("VT06 5분 만료 → 자동 잠금 + 대시보드 이동", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      go(e, "vault");
      ok(VT.remainingMs() > 0 && VT.remainingMs() <= VT.AUTO_LOCK_MS, "타이머 동작");
      VT._fireExpire();
      ok(!VT.isUnlocked(), "만료 잠금");
      eq(e.w.location.hash, "#/dashboard", "대시보드 이동");
    });
    await ta("VT07 다른 화면 이동 시 즉시 잠금 (키 제로화)", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      go(e, "vault");
      ok(VT.isUnlocked());
      go(e, "dashboard");
      await new Promise(r => setTimeout(r, 20));
      ok(!VT.isUnlocked(), "이동 시 잠금");
    });
    await ta("VT08 개선된 해제 UI: 멤버 칩 · 눈 아이콘 · Caps Lock 안내 · 구버전 시트 링크 없음", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      await VT.addMember("김홍석", "pw-kim");
      VT.lock();
      go(e, "vault");
      ok(q(e, "#vault-unlock-form"), "해제 폼");
      eq(qa(e, "#vu-chips [data-vm]").length, 2, "멤버 칩 2개");
      eq(qa(e, "#vu-chips .sel").length, 1, "1명 선택됨");
      ok(q(e, '[data-eye="vu-pw"]'), "비밀번호 표시 토글");
      ok(q(e, "#vu-caps"), "Caps Lock 안내 영역");
      ok(q(e, "#vu-member"), "선택 멤버 hidden 필드");
      ok(!q(e, "#view").innerHTML.includes("docs.google.com"), "구버전 시트 링크 제거");
      // 칩 클릭 → 선택 전환
      const chips = qa(e, "#vu-chips [data-vm]");
      const other = chips.find(c => !c.classList.contains("sel"));
      other.click();
      eq(q(e, "#vu-member").value, other.dataset.vm, "칩 선택이 반영");
      // 눈 아이콘 → type 전환
      q(e, '[data-eye="vu-pw"]').click();
      eq(q(e, "#vu-pw").type, "text");
      q(e, '[data-eye="vu-pw"]').click();
      eq(q(e, "#vu-pw").type, "password");
      VT.lock();
    });
    await ta("VT09 목록 기본 정렬 = 제목 오름차순 · 헤더 클릭으로 정렬 전환", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      const mk = (t2, c) => ({ category: c, title: t2, account: "a", pw: "p", url: "", note: "" });
      await VT.addEntryForTest(mk("하나로 시스템", "기타"));
      await VT.addEntryForTest(mk("가나다 포털", "장비"));
      await VT.addEntryForTest(mk("나라장터", "웹사이트"));
      VT.setSort("title", 1);
      eq(VT.titlesInOrder().join(","), "가나다 포털,나라장터,하나로 시스템", "제목 오름차순");
      go(e, "vault");
      eq(VT.sortState().key, "title", "기본 정렬 키");
      const th = qa(e, "#vault-body [data-sort]").find(b => b.dataset.sort === "title");
      ok(th, "제목 헤더 정렬 버튼");
      th.click();
      eq(VT.sortState().dir, -1, "재클릭 시 내림차순");
      eq(VT.titlesInOrder().join(","), "하나로 시스템,나라장터,가나다 포털");
      const tc = qa(e, "#vault-body [data-sort]").find(b => b.dataset.sort === "category");
      tc.click();
      eq(VT.sortState().key, "category", "다른 열 클릭 시 오름차순 전환");
      eq(VT.sortState().dir, 1);
      VT.lock();
    });
    await ta("VT10 인쇄 전 비밀번호 재마스킹 · 인쇄 버튼 부착", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      await VT.addEntryForTest({ category: "시스템", title: "마스킹", account: "a", pw: "PlainPw!", url: "", note: "" });
      go(e, "vault");
      ok(q(e, "#view [data-print-btn]"), "A4 인쇄 버튼 자동 부착");
      q(e, '[data-vp-eye="0"]').click();
      eq(q(e, '[data-vp-span="0"]').textContent, "PlainPw!", "표시 전환");
      VT.maskAll();
      eq(q(e, '[data-vp-span="0"]').textContent, "••••••••", "인쇄 전 재마스킹");
      VT.lock();
    });
    t("VT11 검색 프로바이더 미등록 — 저장소 내용은 통합검색에 노출되지 않음", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const ids = (e.w.SemisSearch.terms ? [] : []);
      ok(!read("js/vault.js").includes("SemisSearch.register"), "vault는 검색에 등록하지 않음");
      ok(ids.length === 0);
    });
  }

  /* ══════════ [W] 릴리스 위생 ══════════ */
  {
    const html = read("index.html");
    const ver = /const VERSION = "(\d+\.\d+\.\d+)"/.exec(read("js/app.js"))[1];
    t("W01 index.html 캐시 스탬프 = app.js VERSION", () => {
      const stamps = Array.from(html.matchAll(/(?:css|js)\/[\w.-]+\.(?:css|js)\?v=([\d.]+)/g)).map(m => m[1]);
      ok(stamps.length >= FILES.length + 1);
      ok(stamps.every(v => v === ver), "stamps: " + stamps.join(","));
    });
    t("W02 index.html이 모든 모듈 js를 로드", () => FILES.forEach(f => ok(html.indexOf(f + "?v=") >= 0, f)));
    t("W03 package.json version = VERSION", () => eq(JSON.parse(read("package.json")).version, ver));
    t("W04 localStorage 키 접두사 semisl: (v2 semis2: 잔재 없음)", () => {
      FILES.forEach(f => ok(read(f).indexOf('"semis2:') < 0, f));
      ok(read("js/modules.js").indexOf("semisl:forcePush") > 0);
    });
    t("W05 sync.js: semis_store/semis-files(v2) 직접 참조 없음", () => {
      const s = read("js/sync.js");
      ok(s.indexOf('"semis_store"') < 0); ok(s.indexOf("semis-files/") < 0);
    });
    t("W06 CSS: 팔레트 토큰(틸 primary·페트롤 사이드바) · 예정 태그 스타일", () => {
      const c = read("css/main.css");
      ok(c.indexOf("--primary: #0f766e") > 0); ok(c.indexOf("--sidebar-bg: #0b1f26") > 0);
      ok(c.indexOf(".nav-tag") > 0); ok(c.indexOf(".zero-box") > 0);
      ok(c.indexOf("#1d4ed8") < 0, "v2 블루 잔재");
    });
  }

  console.log(`\n테스트 결과: ${passed} 통과 / ${failed} 실패 (총 ${passed + failed}건)`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
  process.exit(failures.length ? 1 : 0);
})();
