/* 계정별 메뉴 범위 — 메뉴(화면)마다 쓰는 공용 DB 행 · 파일 폴더 대응표와 범위 계산(순수 함수).
   서버도 같은 표로 판정한다(tools/sql/semis-logi-scope.sql 의 <scope-map> 구간). 표를 바꾸면
   `node tools/gen-scope-map.cjs` 출력으로 그 구간을 바꿔 넣는다 — 시험 SP01 이 두 곳을 대조한다.
   새 모듈(메뉴)을 만들면 MAP 에 한 줄: 안 넣으면 시험 SP02 가 실패하고, 범위 계정은 그 메뉴 자료를 서버에서 받지 못한다. */
"use strict";

(function (root) {
  /* view = '열람' 단계로 줄 때의 보기 수준(메뉴 기본 공개 범위 — 3까지) · own = '편집' 단계에서 쓸 수 있는 행 ·
     ref = 화면을 그리는 데 읽기만 하는 행 · files = { 폴더: "own" | "ref" }(파일 함수 폴더) · "*" = 범위 계정 공통 */
  const MAP = {
    "*":            { view: 1, ref: ["menus", "boards", "levelHistory"] },
    dashboard:      { view: 1, ref: ["safetyBoard"] },
    schedule:       { view: 2, own: ["schedules"], ref: ["assignees", "assigneesSeeded", "gcal"], files: { schedules: "own" } },
    tasks:          { view: 3, own: ["tasks"], ref: ["taskCfg", "roster"], files: { tasks: "own" } },
    minutes:        { view: 2, own: ["minutes", "schedules"], ref: ["minuteFolders"], files: { minutes: "own", "minutes-sign": "own" } },
    flight:         { view: 1, ref: ["fleet"] },
    shortcuts:      { view: 1 },
    "sec-dash":     { view: 2, ref: ["equipment", "secPost", "secPostImg", "usRescreen", "scrStats", "caresCfg"] },
    "scr-status":   { view: 2, own: ["scrStats", "docs"], ref: ["equipment", "caresCfg"], files: { docs: "own", "docs-ssi": "own" } },
    "us-rescreen":  { view: 3, own: ["usRescreen"] },
    "scr-equip":    { view: 2, own: ["equipment", "docs"], ref: ["caresCfg"], files: { docs: "own", "docs-ssi": "own" } },
    "sec-cases":    { view: 2, own: ["secCases"], files: { cases: "own" } },
    "kc-ra":        { view: 3, own: ["kcra", "docs"], ref: ["contracts"], files: { docs: "own", "docs-ssi": "own", contracts: "ref" } },
    partners:       { view: 2, own: ["partners", "docs"], files: { docs: "own", "docs-ssi": "own" } },
    "aud-dash":     { view: 2, ref: ["audits", "patrol", "patrolCfg", "training", "seclog", "seclogCfg", "selfChecks", "selfCheckCfg", "learn", "dissem", "roster"] },
    inspection:     { view: 2, own: ["seclog", "docs"], ref: ["seclogCfg"], files: { seclog: "own", docs: "own", "docs-ssi": "own" } },
    "daily-safety": { view: 2, own: ["patrol", "patrolPeople"], ref: ["patrolCfg"], files: { patrol: "own" } },
    audit:          { view: 2, own: ["audits", "docs", "schedules"],
                      ref: ["auditMaster", "assignees", "training", "partners", "dissem", "contracts", "kcra", "secCases", "scrStats", "seclog", "seclogCfg", "selfChecks", "selfCheckCfg", "patrol", "roster"],
                      files: { audits: "own", docs: "own", "docs-ssi": "own", training: "ref", seclog: "ref", cases: "ref", dissem: "ref", contracts: "ref", patrol: "ref" } },
    selfcheck:      { view: 2, own: ["selfChecks"], ref: ["selfCheckCfg", "audits"], files: { seclog: "own" } },
    training:       { view: 2, own: ["training", "docs"], ref: ["roster"], files: { training: "own", docs: "own", "docs-ssi": "own" } },
    dissem:         { view: 2, own: ["dissem", "docs"], ref: ["learn", "roster"], files: { dissem: "own", docs: "own", "docs-ssi": "own" } },
    learn:          { view: 2, own: ["learn", "dissem"], ref: ["roster"], files: { learn: "own" } },
    serp:           { view: 2, own: ["serp", "serpRuns"], ref: ["contacts", "phonebook", "fleet", "docs"], files: { crisis: "own", contacts: "ref", docs: "ref" } },
    threat:         { view: 2, own: ["threat", "threatRuns", "threatChecks"], files: { threat: "own" } },
    phonebook:      { view: 2, own: ["phonebook"] },
    contacts:       { view: 2, own: ["contacts"], files: { contacts: "own" } },
    crisis:         { view: 2, own: ["crisis"], ref: ["contacts", "phonebook"], files: { crisis: "own" } },
    roster:         { view: 2, own: ["roster"], ref: ["partners"] },
    "reg-sec":      { view: 2, own: ["regulations", "docs"], files: { regs: "own", "regs-diff": "own", docs: "own", "docs-ssi": "own" } },
    "reg-safety":   { view: 2, own: ["regulations", "docs"], files: { regs: "own", "regs-diff": "own", docs: "own", "docs-ssi": "own" } },
    "reg-dg":       { view: 2, own: ["regulations", "docs"], files: { regs: "own", "regs-diff": "own", docs: "own", "docs-ssi": "own" } },
    contracts:      { view: 3, own: ["contracts", "docs"], files: { contracts: "own", docs: "own", "docs-ssi": "own" } },
    vault:          { view: 3, own: ["vault"] }
  };
  /* 범위 계정이 받지 않는 행(사유) — 시험 SP02 가 SYNC_KEYS = MAP 에 나온 행 + 여기 */
  const EXEMPT = { notices: "옛 공지 — 게시판으로 옮김", desk: "접수 카운터 — 범위 계정은 쓰지 않음" };
  /* '편집' 단계라도 쓰기 등급 4(시스템관리자) 행은 설정이라 쓰지 않는다 — 여기 있는 자료 행만 예외(시험 SP03) */
  const OWN_ADMIN_OK = ["usRescreen"];
  /* 메뉴 범위에 넣을 수 없는 메뉴 */
  const NEVER = ["settings"];
  const BBS_RANK = { all: 1, mgr: 2, hq: 3, admin: 4 };
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const MAX_ITEMS = 200;

  const arr = (v) => (Array.isArray(v) ? v : []);
  /* 저장 · 판정 전에 모양을 맞춘다. 시스템관리자 = 늘 범위 없음, 협력업체 = 늘 범위 있음(없으면 홈만) */
  function norm(s, role) {
    if (role === "admin") return null;
    if (!s || typeof s !== "object" || Array.isArray(s)) return role === "vendor" ? { home: true, m: {}, cf: false } : null;
    const m = {};
    let n = 0;
    const src = s.m && typeof s.m === "object" && !Array.isArray(s.m) ? s.m : {};
    Object.keys(src).forEach(k => {
      if (n >= MAX_ITEMS || !ID_RE.test(k) || k === "dashboard" || NEVER.indexOf(k) >= 0) return;
      if (src[k] === "r" || src[k] === "w") { m[k] = src[k]; n++; }
    });
    const out = { home: !!s.home, m };
    if (role === "vendor") out.cf = !!s.cf;
    return out;
  }
  /* (메뉴, 단계) 목록 — 공통 "*" 와 홈(대시보드)은 '열람' */
  function levels(s) {
    if (!s) return [];
    const out = [["*", "r"]];
    if (s.home) out.push(["dashboard", "r"]);
    Object.keys(s.m || {}).forEach(k => { if (k !== "*" && k !== "dashboard" && (s.m[k] === "r" || s.m[k] === "w")) out.push([k, s.m[k]]); });
    return out;
  }
  function level(s, id) {
    if (!s) return null;
    if (id === "*") return "r";
    if (id === "dashboard") return s.home ? "r" : "";
    const v = s.m && s.m[id];
    return v === "r" || v === "w" ? v : "";
  }
  /* 그 메뉴 안의 등급 — 편집 = 안전보안파트(3) · 열람 = 메뉴 보기 수준(계정 등급이 더 높으면 그 등급, 3까지) · 없음 = -1 */
  function eff(id, lvl, base) {
    if (lvl === "w") return 3;
    if (lvl !== "r") return -1;
    const v = MAP[id] ? MAP[id].view : 1;
    return Math.max(v, Math.min(Number(base) || 0, 3));
  }
  const ownOf = (e) => arr(e && e.own), refOf = (e) => arr(e && e.ref);
  /* 범위 계정의 행별 [읽기 1|0, 쓰기 1|0] — 서버 acl_now() 와 같은 계산(keyAcl = { 행: [읽기 등급, 쓰기 등급] }) */
  function acl(s, base, keyAcl) {
    const lv = levels(s);
    const out = {};
    Object.keys(keyAcl || {}).forEach(k => {
      const rr = Number(keyAcl[k][0]), wr = Number(keyAcl[k][1]);
      const r = rr <= 3 && lv.some(([id, l]) => { const e = MAP[id]; return e && (ownOf(e).indexOf(k) >= 0 || refOf(e).indexOf(k) >= 0) && eff(id, l, base) >= rr; });
      const w = wr < 9 && lv.some(([id, l]) => l === "w" && MAP[id] && ownOf(MAP[id]).indexOf(k) >= 0);
      out[k] = [r ? 1 : 0, w ? 1 : 0];
    });
    return out;
  }
  /* 범위 계정의 파일 폴더별 [열람 등급, 올리기 등급] — 서버 fol_now() 와 같은 계산. 게시판 메뉴는 게시판 읽기 등급 폴더(bbsN) */
  function folders(s, base, menus, boards) {
    const out = {};
    const put = (f, r, w) => { const p = out[f] || [0, 0]; out[f] = [Math.max(p[0], r), Math.max(p[1], w)]; };
    levels(s).forEach(([id, l]) => {
      const e = MAP[id];
      if (e && e.files) Object.keys(e.files).forEach(f => put(f, eff(id, l, base), e.files[f] === "own" && l === "w" ? 3 : 0));
      const mn = arr(menus).find(x => x && x.id === id && x.type === "board");
      const bd = mn && arr(boards).find(b => b && b.id === mn.board);
      if (bd) {
        const rk = BBS_RANK[bd.read] || 3;
        put("bbs" + rk, l === "w" ? Math.max(3, rk) : rk, l === "w" ? 3 : 0);
      }
    });
    return out;
  }
  /* 게시판의 [읽기 등급, 쓰기 등급] — 서버 bbs_rr / bbs_rw 와 같다(범위 밖 = -1) */
  function boardRanks(s, menus, bd) {
    let best = "";
    arr(menus).forEach(x => {
      if (!x || x.type !== "board" || !bd || x.board !== bd.id) return;
      const l = level(s, x.id);
      if (l === "w" || (l === "r" && best !== "w")) best = l;
    });
    const rk = BBS_RANK[bd && bd.read] || 3;
    return best === "w" ? [Math.max(3, rk), 3] : best === "r" ? [rk, -1] : [-1, -1];
  }
  function count(s) { return s ? Object.keys(s.m || {}).length + (s.home ? 1 : 0) : 0; }
  /* SQL <scope-map> 구간 */
  function sql() {
    const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
    const menus = Object.keys(MAP).map(id => "(" + q(id) + "," + MAP[id].view + ")");
    const rows = [];
    Object.keys(MAP).forEach(id => {
      const e = MAP[id];
      ownOf(e).forEach(k => rows.push("(" + q(id) + "," + q("k:" + k) + ",'own')"));
      refOf(e).forEach(k => { if (ownOf(e).indexOf(k) < 0) rows.push("(" + q(id) + "," + q("k:" + k) + ",'ref')"); });
      Object.keys(e.files || {}).forEach(f => rows.push("(" + q(id) + "," + q("f:" + f) + "," + q(e.files[f]) + ")"));
    });
    return ["-- <scope-map> (node tools/gen-scope-map.cjs)",
      "delete from semis_logi_private.scope_map;",
      "delete from semis_logi_private.scope_menu;",
      "insert into semis_logi_private.scope_menu(menu, view) values",
      "  " + menus.join(",\n  ") + ";",
      "insert into semis_logi_private.scope_map(menu, res, kind) values",
      "  " + rows.join(",\n  ") + ";",
      "-- </scope-map>"].join("\n");
  }

  const api = { MAP, EXEMPT, OWN_ADMIN_OK, NEVER, BBS_RANK, norm, levels, level, eff, acl, folders, boardRanks, count, sql };
  root.SemisScope = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
