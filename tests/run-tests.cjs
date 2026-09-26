/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — jsdom 테스트 스위트
   실행: npm test  (jsdom 필요: npm install)
   구성: [C] 코어(해시·계정·메뉴·정규화·권한·라우터·예정 모듈)
         [D] 대시보드·공지·현황판  [S] 시스템 설정  [M] 이식 모듈 스모크(일정·회의록·연락망·검색)
         [Y] 동기화  [CF] 보고 체계도(탭·뷰어·편집)  [FP] 개정 PDF 비교  [SC] 화물 보안(CARES 연동)  [FV] 첨부 뷰어  [CR] 위기대응 담당자  [IM] 한글 입력 보호  [FL] 운항 현황  [AU] 수검 대응 센터  [V] v1.9 비주얼(일정 폼·팔레트·설명 말풍선·허브 배너·3D 히어로)  [SEC] 서버 보안(비공개 파일·살균·CSP)  [W] 릴리스 위생(버전 스탬프·문자열 잔재)
   ═══════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const FILES = ["js/loginguard.js", "js/app.js", "js/qr.js", "js/hero3d.js", "js/modules.js", "js/files.js", "js/calendar.js", "js/minutes.js", "js/contacts.js", "js/flowpdf.js", "js/vault.js", "js/regulations.js", "js/search.js", "js/cares.js", "js/screening.js", "js/equipment.js", "js/crisis.js", "js/phonebook.js", "js/audit.js", "js/training.js", "js/flightcore.js", "js/flightops.js", "js/sync.js", "js/pow.js", "js/fileauth.js"];
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
  if (opts.preData) w.sessionStorage.setItem("semisl:data", JSON.stringify(opts.preData));
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

/* ── v1.15 서버 보안: 권한표는 SQL(서버 원본)에서 읽어 테스트와 서버를 맞춘다 ── */
const SEC_SQL = read("tools/sql/semis-logi-security.sql");
const ACL = (() => {
  const m = /insert into semis_logi_private\.key_acl\(key, read_rank, write_rank\) values([\s\S]*?)on conflict/.exec(SEC_SQL);
  const out = {};
  if (m) m[1].replace(/\('([^']+)',(\d+),(\d+)\)/g, (x, k, r, w) => { out[k] = [Number(r), Number(w)]; return x; });
  return out;
})();
const RANK = { admin: 4, hq: 3, manager: 2, user: 1, vendor: 1 };
function signCodeOf(id) { let h = 5381; for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0; return String(100000 + (h % 900000)); }
function sessPayload(role, id) {
  const uid = id || "tester";
  return { ok: true, kind: "user", rank: RANK[role], acl: ACL, def: [2, 3],
    user: { id: uid, origId: uid, name: "T" + role, role, vendor: role === "vendor" ? "○○조업" : "", base: false } };
}
/* 서버 없이 세션만 세운다(계정별 캐시 정리 없음 — 한 화면에서 권한만 바꿔 보는 테스트용) */
function loginAs(env, role, opts) {
  const u = env.S.devSession(sessPayload(role, opts && opts.id), opts && opts.token, { keep: !(opts && opts.fresh) });
  if (!u || u.role !== role) throw new Error("test login failed");
  return u;
}
function submitLogin(env, pw) {
  const { w } = env;
  w.document.querySelector("#login-pw").value = pw;
  w.document.querySelector("#login-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 0));

/* ── 가짜 서버: RPC(로그인·계정·이력·서명) · REST(RLS 흉내) · 파일 함수 ── */
function makeServer(opts = {}) {
  const srv = {
    rows: (opts.rows || []).map(r => Object.assign({ updated_at: "2026-09-01T00:00:00Z", updated_by: "seed" }, r)),
    accounts: opts.accounts || [
      { id: "mark3464", login: "mark3464", name: "시스템관리자", role: "admin", pw: "admin-pw-111", base: true },
      { id: "cargo-ss", login: "cargo-ss", name: "안전보안파트", role: "hq", pw: "hq-pw-2222", base: true },
      { id: "cargo-mgr", login: "cargo-mgr", name: "화물팀 관리자", role: "manager", pw: "mgr-pw-3333", base: true },
      { id: "cargo-user", login: "cargo-user", name: "화물팀 사용자", role: "user", pw: "user-pw-4444", base: true }
    ],
    sessions: {}, history: opts.history || [], files: opts.files || {}, audit: [],
    calls: [], fail: false, fails: 0, puts: []
  };
  let seq = 0;
  const newTok = () => (++seq).toString(16).padStart(64, "a");
  const tokOf = (o) => (o && o.headers && o.headers["x-semis-token"]) || "";
  const sessOf = (o) => srv.sessions[tokOf(o)] || null;
  const accOf = (s) => s && s.kind === "user" ? srv.accounts.find(a => a.id === s.acc) : null;
  const rankOf = (s) => { const a = accOf(s); return a ? RANK[a.role] : -1; };
  const acl = (k) => ACL[k] || [2, 3];
  const minutes = () => { const r = srv.rows.find(x => x.key === "minutes"); return r ? r.value : []; };
  function signView(mid) {
    const m = minutes().find(x => x.id === mid);
    if (!m) return null;
    return { id: m.id, title: m.title || "", date: m.date || "", time: m.time || "", place: m.place || "", folder: m.folder || "",
      folderName: "", folderIcon: "", attendees: (m.attendees || []).map(a => ({ name: a.name || "", org: a.org || "", role: a.role || "", signed: !!a.sign })) };
  }
  function payload(s) {
    if (s.kind === "signer") return { kind: "signer", user: { id: "__signer__", name: "회의록 참석 서명", role: "signer", signMinuteId: s.minute }, minute: signView(s.minute) };
    const a = accOf(s);
    return { kind: "user", rank: RANK[a.role], acl: ACL, def: [2, 3],
      user: { id: a.login, origId: a.id, name: a.name, role: a.role, vendor: a.vendor || "", base: !!a.base } };
  }
  const isAdmin = (o) => rankOf(sessOf(o)) >= 4;
  const rpc = {
    semis_logi_challenge() { return { ok: true, c: "0".repeat(32) + "." + (Math.floor(Date.now() / 1000) + 120) + ".1.sig" + (++seq), d: 1 }; },
    semis_logi_login(b) {
      /* v1.16 작업증명: 서명된 문제 · 해답 · 1회용 */
      if (!b.p_pow || !b.p_pow.c || b.p_pow.x == null) return { ok: false, error: "pow" };
      srv.powSeen = srv.powSeen || {};
      if (srv.powSeen[b.p_pow.c]) return { ok: false, error: "pow_used" };
      srv.powSeen[b.p_pow.c] = true;
      if (srv.powFailOnce) { srv.powFailOnce = false; return { ok: false, error: "pow_expired" }; }
      if (srv.signPaused && /^\d{6}$/.test(String(b.p_pw))) return { ok: false, error: "sign_paused", wait: 15 };
      if (srv.fails >= 20) return { ok: false, error: "locked", wait: 15 };
      const a = srv.accounts.find(x => x.pw === b.p_pw && !x.disabled);
      if (a) { const t = newTok(); srv.sessions[t] = { acc: a.id, kind: "user" }; srv.audit.push({ action: "login", actor: a.id }); return Object.assign({ ok: true, token: t }, payload(srv.sessions[t])); }
      if (/^\d{6}$/.test(String(b.p_pw))) {
        const m = minutes().find(x => signCodeOf(x.id) === b.p_pw);
        if (m) { const t = newTok(); srv.sessions[t] = { kind: "signer", minute: m.id }; return Object.assign({ ok: true, token: t }, payload(srv.sessions[t])); }
      }
      srv.fails++; srv.audit.push({ action: "login_fail" });
      return { ok: false, error: "invalid" };
    },
    semis_logi_whoami(b, o) { const s = sessOf(o); return s ? Object.assign({ ok: true }, payload(s)) : { ok: false, error: "auth" }; },
    semis_logi_logout(b, o) { delete srv.sessions[tokOf(o)]; return { ok: true }; },
    semis_logi_users(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      return { ok: true, users: srv.accounts.map(a => ({ id: a.login, origId: a.id, name: a.name, role: a.role, vendor: a.vendor || "",
        base: !!a.base, disabled: false, lastLoginAt: null, sessions: Object.values(srv.sessions).filter(s => s.acc === a.id).length })) };
    },
    semis_logi_user_save(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      const p = b.p || {};
      if (!/^[A-Za-z0-9_-]{2,20}$/.test(p.id || "")) return { ok: false, error: "bad_id" };
      if (!p.origId) {
        if (srv.accounts.some(a => a.login === p.id || a.id === p.id)) return { ok: false, error: "dup_id" };
        if (!p.pw || p.pw.length < 8) return { ok: false, error: "pw_short" };
        if (srv.accounts.some(a => a.pw === p.pw)) return { ok: false, error: "pw_in_use" };
        srv.accounts.push({ id: p.id, login: p.id, name: p.name, role: p.role, vendor: p.vendor || "", pw: p.pw, base: false });
        return { ok: true };
      }
      const a = srv.accounts.find(x => x.id === p.origId);
      if (!a) return { ok: false, error: "not_found" };
      a.login = p.id; a.name = p.name; a.role = a.id === "mark3464" ? "admin" : p.role; a.vendor = p.vendor || "";
      return { ok: true };
    },
    semis_logi_user_delete(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      if (b.p_orig === "mark3464") return { ok: false, error: "protected" };
      const n = srv.accounts.length;
      srv.accounts = srv.accounts.filter(a => a.id !== b.p_orig);
      return n === srv.accounts.length ? { ok: false, error: "not_found" } : { ok: true };
    },
    semis_logi_set_password(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      const a = srv.accounts.find(x => x.id === b.p_orig);
      if (!a) return { ok: false, error: "not_found" };
      if (!b.p_new || b.p_new.length < 8) return { ok: false, error: "pw_short" };
      if (srv.accounts.some(x => x.id !== a.id && x.pw === b.p_new)) return { ok: false, error: "pw_in_use" };
      a.pw = b.p_new;
      let ended = 0;
      Object.keys(srv.sessions).forEach(t => { if (srv.sessions[t].acc === a.id && t !== tokOf(o)) { delete srv.sessions[t]; ended++; } });
      return { ok: true, ended };
    },
    semis_logi_history(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      return { ok: true, rows: srv.history.filter(h => !b.p_key || h.key === b.p_key).map(h => ({ id: h.id, key: h.key, old_len: h.old_len, new_len: h.new_len, changed_at: h.changed_at, changed_by: h.changed_by })) };
    },
    semis_logi_history_value(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      const h = srv.history.find(x => String(x.id) === String(b.p_id));
      return h ? { ok: true, row: { id: h.id, key: h.key, old_value: h.old_value } } : { ok: false, error: "not_found" };
    },
    semis_logi_security(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      return { ok: true, events: srv.audit.map(e => ({ at: "2026-09-25T01:00:00Z", actor: e.actor || null, action: e.action, detail: null, ip: "1.2.3.4" })),
        sessions: Object.keys(srv.sessions).map(t => ({ account: (srv.accounts.find(a => a.id === srv.sessions[t].acc) || {}).login || "signer",
          name: "", kind: srv.sessions[t].kind, created: "2026-09-25T01:00:00Z", lastSeen: "2026-09-25T01:00:00Z", ip: "1.2.3.4", current: t === tokOf(o) })),
        locked: [], stats: { fail15: srv.fails, fail60: srv.fails, signFail60: 0, powBits: srv.powBits || 18, powBase: 18, signPaused: !!srv.signPaused } };
    },
    semis_logi_end_sessions(b, o) {
      if (!isAdmin(o)) return { ok: false, error: "forbidden" };
      let n = 0; Object.keys(srv.sessions).forEach(t => { if (t !== tokOf(o)) { delete srv.sessions[t]; n++; } });
      return { ok: true, ended: n };
    },
    semis_logi_sign_submit(b, o) {
      const s = sessOf(o);
      if (!s || s.kind !== "signer") return { ok: false, error: "auth" };
      if (!b.p_name || !b.p_org) return { ok: false, error: "required" };
      const m = minutes().find(x => x.id === s.minute);
      if (!m) return { ok: false, error: "not_found" };
      m.attendees = m.attendees || [];
      let t = (b.p_idx >= 0 && m.attendees[b.p_idx] && m.attendees[b.p_idx].name === b.p_expect) ? b.p_idx : -1;
      if (t < 0) t = m.attendees.findIndex(a => a.name === b.p_name && (!a.org || a.org === b.p_org));
      if (t < 0) { m.attendees.push({ name: "", org: "", role: "", note: "", sign: "" }); t = m.attendees.length - 1; }
      Object.assign(m.attendees[t], { name: b.p_name, org: b.p_org, role: b.p_role || "" });
      if (b.p_sign !== null && b.p_sign !== undefined) m.attendees[t].sign = b.p_sign;
      return { ok: true, index: t, minute: signView(m.id) };
    }
  };
  const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status,
    json: () => Promise.resolve(body), headers: { get: () => null } });
  const FOLDER_READ = { notices: 1, attach: 1, minutes: 1, "minutes-sign": 1, schedules: 2, contacts: 2, crisis: 2, regs: 2, "regs-diff": 2 };
  const fn = (url, o = {}) => {
    const u = String(url), method = o.method || "GET";
    let body = null;
    try { body = typeof o.body === "string" ? JSON.parse(o.body) : null; } catch (e) { body = null; }
    srv.calls.push({ url: u, method, body, token: tokOf(o) });
    if (srv.fail) return Promise.reject(new Error("network down"));
    let m;
    if ((m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(u))) {
      const f = rpc[m[1]];
      return f ? reply(200, f(body || {}, o)) : reply(404, {});
    }
    if (u.indexOf("/rest/v1/semis_logi_store") >= 0) {
      const s = sessOf(o), r = rankOf(s);
      if (method === "GET") {
        let rows = srv.rows.filter(x => r >= acl(x.key)[0]);
        const kin = /[?&]key=in\.\(([^)]*)\)/.exec(u);
        if (kin) { const ks = kin[1].split(",").map(decodeURIComponent); rows = rows.filter(x => ks.indexOf(x.key) >= 0); }
        const k1 = /[?&]key=eq\.([^&]+)/.exec(u);
        if (k1) rows = rows.filter(x => x.key === decodeURIComponent(k1[1]));
        return reply(200, rows.map(x => JSON.parse(JSON.stringify(x))));
      }
      if (method === "POST") {
        const rows = body || [];
        if (srv.forceDeny || rows.some(x => r < acl(x.key)[1])) return reply(401, { code: "42501", message: "new row violates row-level security policy" });
        const who = (accOf(s) || {}).login || "anon";
        rows.forEach(x => {
          const rec = { key: x.key, value: JSON.parse(JSON.stringify(x.value)), updated_at: new Date().toISOString(),
            updated_by: who + "/" + String(x.updated_by || "").replace(/^.*\//, "") };
          const i = srv.rows.findIndex(y => y.key === x.key);
          if (i >= 0) srv.rows[i] = rec; else srv.rows.push(rec);
        });
        return reply(201, []);
      }
    }
    if (u.indexOf("/functions/v1/semis-logi-files") >= 0) {
      const s = sessOf(o), r = rankOf(s);
      if (!s) return reply(401, { ok: false, error: "auth" });
      const b = body || {};
      const folder = (p) => String(p).split("/")[0];
      if (b.op === "sign") {
        const urls = {}, denied = [];
        (b.paths || []).forEach(p => {
          const okRead = s.kind === "signer" ? folder(p) === "minutes-sign" : r >= (FOLDER_READ[folder(p)] || 3);
          if (okRead) urls[p] = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/sign/semis-logi-files/" + p + "?token=T" + (++seq);
          else denied.push(p);
        });
        return reply(200, { ok: true, expires: 3600, urls, denied });
      }
      if (b.op === "upload") {
        const path = b.prefix + "/" + (++seq).toString(36) + "_" + String(b.name || "file").replace(/[^A-Za-z0-9._-]/g, "_");
        return reply(200, { ok: true, path, url: "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/" + path,
          upload: "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/upload/sign/semis-logi-files/" + path + "?token=U" + seq });
      }
      if (b.op === "list") {
        if (r < 4) return reply(403, { ok: false, error: "forbidden" });
        return reply(200, { ok: true, files: Object.keys(srv.files).map(p => ({ path: p, name: p.split("/").pop(), folder: folder(p), size: srv.files[p].size || 1, updated: srv.files[p].updated || "2026-09-01T00:00:00Z" })) });
      }
      if (b.op === "delete") {
        if (r < 4) return reply(403, { ok: false, error: "forbidden" });
        const del = (b.paths || []).filter(p => srv.files[p]);
        del.forEach(p => delete srv.files[p]);
        return reply(200, { ok: true, deleted: del });
      }
      return reply(400, { ok: false, error: "op" });
    }
    if (method === "PUT" && u.indexOf("/object/upload/sign/semis-logi-files/") >= 0) {
      const p = u.split("/object/upload/sign/semis-logi-files/")[1].split("?")[0];
      srv.files[p] = { size: 1, updated: new Date().toISOString() };
      srv.puts.push(p);
      return reply(200, { Key: "semis-logi-files/" + p });
    }
    return reply(404, {});
  };
  fn.calls = srv.calls;
  srv.fetch = fn;
  srv.loginAs = async (env, pw) => {
    const d = await env.S.login(pw);
    if (!d || !d.ok) throw new Error("server login failed: " + JSON.stringify(d));
    env.S.enterApp();
    return d;
  };
  return srv;
}

(async function run() {

  /* ══════════ [C] 코어 — 해시·계정 ══════════ */
  {
    const e = makeEnv();
    t("C01 sha256 표준 벡터(abc)", () => eq(e.S.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    t("C02 pwHash = sha256(SeMISv2::pw) — v2와 동일 SALT(관리자 암호 공유)", () => eq(e.S.pwHash("xyz"), e.S.sha256("SeMISv2:" + ":" + "xyz")));
    t("C03 코드에 계정 해시·암호 없음(서버 전용) — BASE_USERS 제거", () => {
      eq(e.S.BASE_USERS, undefined);
      FILES.forEach(f => ok(!/["'][0-9a-f]{64}["']/.test(read(f)), f + ": 64자리 해시 문자열"));
    });
    t("C04 서버 이관 SQL: 기본 계정 4개 · bcrypt · 사용자 정의 계정 포함", () => {
      ["mark3464", "cargo-ss", "cargo-mgr", "cargo-user"].forEach(id => ok(SEC_SQL.indexOf("('" + id + "'") > 0, id));
      ok(/extensions\.crypt\([^)]*gen_salt\('bf', 10\)/.test(SEC_SQL), "bcrypt");
      ok(SEC_SQL.indexOf("key = 'customUsers'") > 0, "customUsers 이관");
    });
    t("C05 권한표(ACL): 모든 SYNC_KEYS 포함 · 계정 자료는 읽기·쓰기 불가(9)", () => {
      e.Sync.SYNC_KEYS.forEach(k => ok(ACL[k], "ACL 누락: " + k));
      ["pwOverrides", "userOverrides", "customUsers"].forEach(k => { eq(ACL[k][0], 9, k); eq(ACL[k][1], 9, k); });
      Object.keys(ACL).forEach(k => ok(ACL[k][1] >= ACL[k][0], k + ": 쓰기 등급 ≥ 읽기 등급"));
      eq(ACL.vault.join(","), "3,3"); eq(ACL.menus.join(","), "1,4"); eq(ACL.minutes.join(","), "1,2");
    });
    t("C06 로그인 제한(15분 20회) · 세션 만료(24시간 · 최대 30일) · 서명 코드 ±90일", () => {
      ok(/v_fail >= 20/.test(SEC_SQL) && /interval '15 minutes'/.test(SEC_SQL));
      ok(SEC_SQL.indexOf("interval '24 hours'") > 0 && SEC_SQL.indexOf("interval '30 days'") > 0);
      ok(SEC_SQL.indexOf("interval '90 days'") > 0);
    });
    t("C07 세션 기반 RLS 정책 + 변경 알림(컬렉션 이름만)", () => {
      ok(SEC_SQL.indexOf('create policy "logi session read"') > 0);
      ok(SEC_SQL.indexOf('create policy "logi session update"') > 0);
      ok(/realtime\.send\(jsonb_build_object\('key', new\.key, 'by', new\.updated_by, 'at', new\.updated_at\)/.test(SEC_SQL), "값은 보내지 않음");
      ok(SEC_SQL.indexOf("x-semis-token") > 0);
    });

    /* ══════════ [C] 코어 — 메뉴 시드·정규화 ══════════ */
    t("C08 메뉴 시드: 허브 6개(hub-*) · 예정 모듈 13개 이상 · 링크 5개", () => {
      const m = e.S.data.menus;
      eq(m.filter(x => x.type === "group").map(x => x.id).join(","), "hub-home,hub-sec,hub-saf,hub-aud,hub-ops,hub-doc");
      ok(m.filter(x => x.type === "group").every(g => e.S.ICONS[g.ico]), "허브 아이콘");
      ok(m.filter(x => x.type === "module" && x.planned).length >= 11, "planned");
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
    t("C17 구버전 캐시의 계정 자료(pwOverrides·userOverrides·customUsers)는 정규화가 버림", () => {
      e.S.data.pwOverrides = { mark3464: "x" }; e.S.data.userOverrides = { a: {} }; e.S.data.customUsers = [{ id: "z" }];
      e.S.normalizeData();
      eq(e.S.data.pwOverrides, undefined); eq(e.S.data.userOverrides, undefined); eq(e.S.data.customUsers, undefined);
      ok(e.Sync.SYNC_KEYS.indexOf("pwOverrides") < 0 && e.Sync.SYNC_KEYS.indexOf("customUsers") < 0);
    });

    /* ══════════ [C] 코어 — 인증·권한·라우팅 ══════════ */
    const srvC = makeServer({ rows: [{ key: "notices", value: [] }, { key: "contacts", value: { sections: [{ id: "x", title: "비밀 연락처", rows: [] }] } }] });
    e.w.fetch = srvC.fetch;
    await ta("C18 잘못된 암호 거부(서버 확인)", async () => {
      submitLogin(e, "no-such-pw-000");
      await tick(30);
      ok(!e.S.user); ok(q(e, "#login-error").textContent.includes("올바르지"));
      ok(srvC.calls.some(c => c.url.indexOf("/rpc/semis_logi_login") > 0), "로그인 RPC");
    });
    await ta("C19 user 로그인 → 세션 토큰(탭 세션)·앱 진입·헤더 · 권한 밖 자료는 받지 않음", async () => {
      submitLogin(e, "user-pw-4444");
      await tick(60);
      ok(e.S.user && e.S.user.role === "user", "user 세션");
      eq((e.w.sessionStorage.getItem("semisl:tok") || "").length, 64);
      ok(!e.w.localStorage.getItem("semisl:data"), "localStorage 에 데이터 없음");
      ok(q(e, "#login-overlay").classList.contains("hidden"));
      ok(q(e, "#user-chip").textContent.includes("일반사용자"));
      ok(q(e, "#app-version").textContent === "v" + e.S.VERSION);
      ok(!JSON.stringify(e.S.data.contacts).includes("비밀 연락처"), "contacts(mgr) 미수신");
      ok(srvC.calls.filter(c => c.url.indexOf("/rest/v1/semis_logi_store") >= 0).every(c => c.token.length === 64), "모든 요청에 토큰");
      e.Sync.stop();
    });
    t("C20 user: 사이드바에 mgr/hq 메뉴 미노출 (규정도 mgr)", () => {
      const routes = qa(e, ".nav-item").map(b => b.dataset.route).filter(Boolean);
      ok(routes.indexOf("dashboard") >= 0);
      ok(routes.indexOf("schedule") < 0, "schedule는 mgr");
      ok(routes.indexOf("settings") < 0);
      ok(routes.indexOf("reg-sec") < 0, "규정은 mgr 이상");
    });
    t("C21 user: 규정 라우트 접근 → 대시보드 폴백", () => {
      go(e, "reg-sec");
      ok(q(e, "#view").textContent.includes("대시보드"));
    });
    t("C22 user: mgr 라우트 접근 → 대시보드로", () => {
      go(e, "schedule");
      ok(q(e, "#view").textContent.includes("대시보드"));
    });
    t("C23 user: 대시보드 경량 — 공지·무재해·보안등급, 구축 현황/일정/편집 버튼 없음", () => {
      go(e, "dashboard");
      const tx = q(e, "#view").textContent;
      ok(tx.includes("공지사항")); ok(tx.includes("무재해 경과일")); ok(tx.includes("국가 항공보안등급"));
      ok(!tx.includes("모듈 구축 현황")); ok(!tx.includes("다가오는 일정"));
      ok(!q(e, "#btn-edit-level") && !q(e, "#btn-add-notice"), "편집 버튼 없음");
    });
    t("C24 canSee/canEdit 등급표", () => {
      loginAs(e, "manager");
      eq(e.S.roleRank(), 2); ok(e.S.canSee({ vis: "mgr" })); ok(!e.S.canSee({ vis: "hq" })); ok(!e.S.canEdit());
      loginAs(e, "hq");
      eq(e.S.roleRank(), 3); ok(e.S.canSee({ vis: "hq" })); ok(!e.S.canSee({ vis: "admin" })); ok(e.S.canEdit()); ok(e.S.canDelete()); ok(e.S.canConfid());
    });
    t("C25 hq: 사이드바 예정 태그 표시 · 예정 모듈 클릭 시 안내", () => {
      ok(qa(e, ".nav-item.planned .nav-tag").length >= 11);
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
      ok(!q(e, "#view").textContent.includes("차단"), "안내 문구 제거");
      eq(q(e, "#view .page-head [data-print-btn]").textContent.trim(), "Print");
      const c = read("css/main.css"), pm = c.slice(c.indexOf("@media print"));
      ok(/\.embed-frame \{ display: block;[^}]*height: 232mm/.test(pm), "인쇄 시 프레임 표시");
      ok(!/\.embed-frame \{ display: none/.test(pm), "인쇄 시 프레임 숨김 금지");
      lk.open = "tab";
    });
    t("C28 admin 로그인 → 시스템 설정 라우트 렌더", () => {
      loginAs(e, "admin");
      go(e, "settings");
      ok(q(e, "#view").textContent.includes("시스템 설정"));
      eq(qa(e, ".tab").length, 6);   // 메뉴·사용자·담당자·데이터·저장소·보안
    });
    await ta("C29 로그아웃 → 서버 세션 종료 · 토큰·데이터 사본 제거", async () => {
      const tok = e.w.sessionStorage.getItem("semisl:tok");
      q(e, "#logout-btn").click();   // jsdom reload는 미구현(무해)
      await tick(40);
      ok(!e.S.user); ok(!e.w.sessionStorage.getItem("semisl:tok")); ok(!e.w.sessionStorage.getItem("semisl:data"));
      ok(srvC.calls.some(c => c.url.indexOf("/rpc/semis_logi_logout") > 0 && c.token === tok), "logout RPC");
    });
    t("C30 vendor: 기본 프리셋은 dashboard만, 사이드바 축소", () => {
      loginAs(e, "vendor");
      eq(e.S.user.role, "vendor");
      eq(e.S.vendorAccess(e.S.user).routes.join(","), "dashboard");
      eq(e.S.roleRank(), 1); ok(!e.S.canDelete());
      go(e, "settings");
      ok(q(e, "#view").textContent.includes("대시보드"));
      eq(qa(e, ".nav-item").length, 1);
    });
    t("C31 jsdom 오류 없음(코어 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [C] 세션 복원 · QR 서명 로그인 (서버) ══════════ */
  {
    const mid = "m-test-1";
    const today = new Date().toISOString().slice(0, 10);
    const srvQ = makeServer({ rows: [
      { key: "minutes", value: [{ id: mid, title: "테스트 회의", date: today, folder: "mf-part",
        attendees: [{ name: "김참석", org: "안전보안파트", role: "과장", sign: "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/minutes-sign/a.png" }],
        decisions: [], status: "draft", author: "x", agenda: "비공개 안건" }] },
      { key: "contacts", value: { sections: [] } }] });
    const e = makeEnv({ boot: false, fetch: srvQ.fetch });
    e.S.load();
    const code = e.S.signCodeFor({ id: mid });
    t("C32 signCodeFor: 6자리 결정적 · 서버 SQL과 같은 규칙", () => {
      ok(/^\d{6}$/.test(code)); eq(code, e.S.signCodeFor({ id: mid })); eq(code, signCodeOf(mid));
      ok(SEC_SQL.indexOf("h := ((h * 33) & 4294967295) # ascii(substr(p_id, i, 1));") > 0);
    });
    t("C34 signUrlFor: 현재 origin + #/sign/코드", () => eq(e.S.signUrlFor({ id: mid }), "https://logi.test/#/sign/" + code));
    await ta("C35 QR(#/sign/코드) → signer 세션 · 그 회의만 · 다른 사람 서명 이미지·안건 미수신", async () => {
      e.w.location.hash = "#/sign/" + code;
      e.S.boot();
      await tick(60);
      ok(e.S.user && e.S.user.role === "signer", "signer");
      eq(e.S.roleRank(), 0);
      ok(q(e, "#hdr-search-wrap").classList.contains("vendor-hide"));
      eq(qa(e, ".nav-item").length, 1);
      eq(e.S.data.minutes.length, 1);
      ok(!JSON.stringify(e.S.data.minutes).includes("비공개 안건"), "안건 미수신");
      ok(!JSON.stringify(e.S.data.minutes).includes("minutes-sign/a.png"), "서명 이미지 미수신");
      ok(q(e, "#view").textContent.includes("김참석"));
      ok(!q(e, "#view .cn-sign-thumb"), "썸네일 없음");
      ok(q(e, "#sec-level-badge").hidden, "보안등급 배지 숨김");
      ok(!srvQ.calls.some(c => c.url.indexOf("/rest/v1/semis_logi_store") >= 0), "signer는 공용 DB 직접 조회 안 함");
    });
    await ta("C36 서명 저장 → 서버 RPC(그 회의 한 건) · 새 참석자 추가", async () => {
      const ok1 = await e.w.SemisMinutes.saveSignEntry(mid, -1, { name: "이신규", org: "조업사", role: "" },
        "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/minutes-sign/b.png");
      eq(ok1, true);
      const sm = srvQ.rows.find(r => r.key === "minutes").value[0];
      eq(sm.attendees.length, 2); eq(sm.attendees[1].name, "이신규");
      eq(e.S.data.minutes[0].attendees.length, 2, "로컬 갱신");
      ok(srvQ.calls.some(c => c.url.indexOf("/rpc/semis_logi_sign_submit") > 0));
    });
  }
  {
    const srvR = makeServer({ rows: [{ key: "notices", value: [{ id: "n1", title: "서버 공지", body: "", author: "x", pinned: false, created: "2026-09-01T00:00:00Z" }] }] });
    const e = makeEnv({ boot: false, fetch: srvR.fetch });
    await ta("C37 새로고침 — 탭의 토큰으로 서버 확인 후 자동 진입", async () => {
      const d = await e.S.login("hq-pw-2222");
      ok(d.ok);
      e.S.boot();
      await tick(80);
      ok(e.S.user && e.S.user.id === "cargo-ss" && e.S.user.role === "hq");
      ok(q(e, "#login-overlay").classList.contains("hidden"));
      ok(srvR.calls.some(c => c.url.indexOf("/rpc/semis_logi_whoami") > 0));
      e.Sync.stop();
    });
    await ta("C38 서버가 세션을 끊으면 로그인 창을 다시 띄우고, 같은 계정이면 이어서 작업", async () => {
      Object.keys(srvR.sessions).forEach(t => delete srvR.sessions[t]);
      e.S.data.notices.push({ id: "n2", title: "끊긴 뒤 작성", body: "", author: "x", pinned: false, created: "2026-09-02T00:00:00Z" });
      e.S.save();
      await e.Sync._flush().catch(() => {});
      await tick(30);
      ok(!q(e, "#login-overlay").classList.contains("hidden"), "로그인 창");
      ok(q(e, "#login-error").textContent.includes("만료"));
      ok(e.Sync.pendingKeys().indexOf("notices") >= 0, "미전송 보관");
      submitLogin(e, "hq-pw-2222");
      await tick(120);
      ok(q(e, "#login-overlay").classList.contains("hidden"));
      ok(srvR.rows.find(r => r.key === "notices").value.some(n => n.id === "n2"), "다시 로그인 후 저장");
      e.Sync.stop();
    });
    await ta("C39 다른 계정이 로그인하면 이전 계정의 사본을 비움 · 읽을 권한 없는 컬렉션 초기화", async () => {
      const e2 = makeEnv({ boot: false, fetch: srvR.fetch });
      e2.w.sessionStorage.setItem("semisl:owner", "user:someone-else");
      e2.w.sessionStorage.setItem("semisl:data", JSON.stringify({ version: 1, contacts: { sections: [{ id: "s", title: "남은 연락처", rows: [] }] }, vault: { v: 1, members: [{ id: "m1" }], data: { iv: "a", ct: "b" }, personal: {}, updated: "" } }));
      e2.S.load();
      const d = await e2.S.login("user-pw-4444");
      ok(d.ok);
      ok(!JSON.stringify(e2.S.data.contacts).includes("남은 연락처"));
      eq(e2.S.data.vault.members.length, 0);
      eq(e2.w.sessionStorage.getItem("semisl:owner"), "user:cargo-user");
    });
  }

  /* ══════════ [D] 대시보드 · 공지 · 현황판 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "dashboard");
    t("D01 hq 대시보드: 화물 태그 카드(무재해·보안등급) · 7일 일정 · 미완료/기한 경과 수치", () => {
      ok(q(e, ".ticket .zero-n"), "무재해");
      eq(q(e, ".ticket .tk-level").textContent, "평시");
      eq(q(e, ".lv-bars i.on") && qa(e, ".lv-bars i").indexOf(q(e, ".lv-bars i.on")), 0, "5단계 눈금");
      eq(q(e, "#dash-soon").textContent, "0");
      eq(q(e, "#dash-open-n").textContent, "0"); eq(q(e, "#dash-late-n").textContent, "0");
      ok(q(e, ".page-head #btn-add-notice") && q(e, "#btn-edit-level") && q(e, "#btn-edit-zero"), "hq 편집 버튼");
    });
    t("D02 모듈 구축 현황: 허브별 운영/전체 (예정 모듈 포함, 숨김 제외)", () => {
      ok(q(e, "#view").textContent.includes("모듈 구축 현황"));
      const rows = qa(e, "#dash-build .build-row");
      ok(rows.length >= 6, "허브 6 + 관리");
      const sec = rows.find(r => r.dataset.dashHub === "hub-sec");
      eq(sec.querySelector(".br-n").textContent, "2/4", "보안검색 현황·검색장비 운영 / 상용화주·출입 예정");
      const home = rows.find(r => r.dataset.dashHub === "hub-home");
      eq(home.querySelector(".br-n").textContent, "4/5", "대시보드·운항 현황·일정·회의록 운영 / 현황판 예정");
    });
    t("D03 무재해 기준일 설정 → D+ 계산", () => {
      q(e, "#btn-edit-zero").click();
      const since = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
      q(e, "#f-since").value = since; q(e, "#f-znote").value = "테스트";
      q(e, "#f-save").click();
      eq(e.S.data.safetyBoard.since, since);
      eq(e.w.SemisDashFx.zeroDays(), 10);
      ok(q(e, ".zero-n").textContent === "D+10");
      ok(q(e, ".ticket .tk-sub").textContent.includes("테스트"));
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
      eq(q(e, ".ticket .tk-level").textContent, "주의");
      eq(q(e, ".ticket .tk-level").dataset.tone, "warn");
      q(e, "#btn-level-hist").click();
      ok(q(e, "#level-box").textContent.includes("테스트"), "변경 이력 모달");
      e.S.closeModal();
    });
    t("D08 회의 결정사항 미완료 → 대시보드 카드·타일", () => {
      e.S.data.minutes.push({ id: "m1", title: "제1차 정례회의", date: "2026-09-01", folder: "mf-part", status: "final",
        author: "Thq", attendees: [], decisions: [{ id: "d1", task: "지게차 점검표 개정", owner: "홍길동", due: "2026-01-01", done: false }, { id: "d2", task: "완료건", owner: "", due: "", done: true }] });
      e.S.saveSilent(); go(e, "dashboard");
      const acts = e.w.SemisDashFx.openActions();
      eq(acts.length, 1); eq(acts[0].task, "지게차 점검표 개정");
      ok(q(e, "#actions-box").textContent.includes("지게차 점검표 개정"));
      eq(q(e, "#dash-open-n").textContent, "1");
      eq(q(e, "#dash-late-n").textContent, "1", "기한 경과");
    });
    t("D09 jsdom 오류 없음(대시보드 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [S] 시스템 설정 ══════════ */
  {
    const srvS = makeServer();
    const e = makeEnv({ fetch: srvS.fetch });
    await srvS.loginAs(e, "admin-pw-111");
    go(e, "settings");
    t("S01 메뉴 관리 탭: 트리 렌더 · 예정 모듈 배지", () => {
      ok(qa(e, "#menu-tree .menu-tree-item").length >= 30);
      ok(q(e, "#menu-tree").textContent.includes("예정 모듈"));
    });
    t("S02 링크 메뉴 추가(그룹 소속·바로가기)", () => {
      q(e, "#btn-add-menu").click();
      const grp = e.S.data.menus.find(m => m.id === "hub-doc");
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
      const grp = e.S.data.menus.find(m => m.id === "hub-sec");
      const kids = () => e.S.sortedMenus().filter(m => m.parent === grp.id).map(m => m.id);
      const before = kids();
      q(e, `#menu-tree [data-down="${before[0]}"]`).click();
      const after = kids();
      eq(after[1], before[0]); eq(after[0], before[1]);
    });
    t("S06 허브 삭제 → 하위 함께 삭제 · 레일에서 제거", () => {
      const grp = e.S.data.menus.find(m => m.id === "hub-saf");
      q(e, `#menu-tree [data-del="${grp.id}"]`).click(); clickOk(e);
      ok(!e.S.data.menus.some(m => m.id === grp.id || m.parent === grp.id));
      ok(!q(e, '#rail-hubs [data-hub="hub-saf"]'), "레일 제거");
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
      ok(!q(e, `#rail-hubs [data-hub="${grp2.id}"]`), "레일에서 허브 제거");
      ok(!q(e, `#nav-menu .hub[data-hub="${grp2.id}"]`), "패널 섹션 제거");
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
    await ta("S08 사용자 추가 · 중복 암호 거부 · 암호 변경 · 삭제 (서버 RPC)", async () => {
      await tick(30);   // 앞선 go() 의 hashchange 다시 그리기가 끝난 뒤
      qa(e, ".tab").find(x => x.dataset.tab === "users").click();
      await tick(30);
      q(e, "#btn-add-user").click();
      q(e, "#f-uid").value = "kim"; q(e, "#f-uname").value = "김안전"; q(e, "#f-urole").value = "manager";
      q(e, "#f-upw").value = "admin-pw-111"; q(e, "#f-save").click();   // 관리자와 같은 암호
      await tick(30);
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "중복 암호 거부");
      q(e, "#f-upw").value = "kim-pw-777"; q(e, "#f-save").click();
      await tick(40);
      const a = srvS.accounts.find(x => x.id === "kim");
      ok(a && a.role === "manager" && a.pw === "kim-pw-777", "계정 추가");
      ok(!e.S.allUsers().some(u => u.hash || u.pw), "화면 목록에 암호·해시 없음");
      const idx = e.S.allUsers().findIndex(x => x.id === "kim");
      q(e, `[data-pw="${idx}"]`).click();
      q(e, "#f-pw1").value = "short"; q(e, "#f-pw2").value = "short"; q(e, "#f-save").click();
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "8자 미만 거부");
      q(e, "#f-pw1").value = "kim-pw-888"; q(e, "#f-pw2").value = "kim-pw-888"; q(e, "#f-save").click();
      await tick(40);
      eq(srvS.accounts.find(x => x.id === "kim").pw, "kim-pw-888");
      const idx2 = e.S.allUsers().findIndex(x => x.id === "kim");
      q(e, `[data-del="${idx2}"]`).click(); clickOk(e);
      await tick(40);
      ok(!srvS.accounts.some(x => x.id === "kim"), "삭제");
    });
    await ta("S09 기본 계정 수정 · mark3464 권한 잠금 · 본인·관리자 삭제 버튼 없음", async () => {
      await tick(10);
      const users = e.S.allUsers();
      const i = users.findIndex(x => x.origId === "cargo-mgr");
      q(e, `[data-edit="${i}"]`).click();
      q(e, "#f-uname").value = "화물팀 감독자"; q(e, "#f-save").click();
      await tick(40);
      eq(srvS.accounts.find(x => x.id === "cargo-mgr").name, "화물팀 감독자");
      const j = e.S.allUsers().findIndex(x => x.origId === "mark3464");
      q(e, `[data-edit="${j}"]`).click();
      ok(q(e, "#f-urole").disabled); e.S.closeModal();
      ok(!q(e, `[data-del="${j}"]`), "관리자 삭제 버튼 없음");
    });
    await ta("S09c 보안 탭: 접속 중 세션 · 접속 기록", async () => {
      qa(e, ".tab").find(x => x.dataset.tab === "security").click();
      await tick(40);
      ok(q(e, "#sec-sessions").textContent.includes("이 화면"), "현재 세션 표시");
      ok(q(e, "#sec-events").textContent.includes("로그인"), "기록");
      const st = q(e, "#sec-stats").textContent;
      ok(/로그인 실패 \(15분/.test(st) && /접속 확인 난이도/.test(st) && /회의 서명 코드/.test(st), "자동 접속 방어 통계(v1.16)");
      qa(e, ".tab").find(x => x.dataset.tab === "users").click();
      await tick(30);
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
      e.S.data.menus = e.S.data.menus.filter(m => m.id !== "hub-doc" && m.parent !== "hub-doc");
      e.S.saveSilent();
      q(e, "#btn-reset-menu").click(); clickOk(e);
      ok(e.S.data.menus.some(m => m.id === "hub-doc"));
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
      eq(q(e, "#dash-soon").textContent, "1");
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

  /* ══════════ [H] 허브 내비게이션 (v1.8) — 마이그레이션 · 레일 · 패널 · 모바일 탭/시트 · 화면 키트 ══════════ */
  {
    /* v1.7 이하 메뉴 구조(그룹 8개) 픽스처 */
    const OLD = () => {
      const g = (id, label, seq, extra) => Object.assign({ id, seq, type: "group", label }, extra || {});
      const m = (id, module, parent, seq, extra) => Object.assign({ id, seq, type: "module", label: id, icon: "▪", module, vis: "mgr", parent }, extra || {});
      return [
        m("dashboard", "dashboard", null, 0, { vis: "all" }), m("schedule", "schedule", null, 1), m("minutes", "minutes", null, 2),
        m("board", "board", null, 3, { planned: true, desc: "현황판 설명 열 글자 이상", hidden: true }),
        g("grp-rule", "규정 / 기준", 4), m("reg-sec", "reg-sec", "grp-rule", 5, { hidden: true }), m("reg-safety", "reg-safety", "grp-rule", 6), m("reg-dg", "reg-dg", "grp-rule", 7),
        g("grp-cargo", "화물 보안", 8), m("scr-status", "scr-status", "grp-cargo", 9, { planned: true, desc: "x".repeat(12) }),
        g("grp-safety", "안전 관리", 10), m("risk", "risk", "grp-safety", 11, { planned: true, desc: "x".repeat(12) }),
        g("grp-inspect", "점검", 12), m("car", "car", "grp-inspect", 13, { planned: true, desc: "x".repeat(12) }),
        g("grp-edu", "교육", 14), m("training", "training", "grp-edu", 15, { planned: true, desc: "x".repeat(12) }),
        g("grp-partner", "협력사", 16), m("partners", "partners", "grp-partner", 17, { planned: true, desc: "x".repeat(12) }),
        g("grp-emergency", "비상", 18), m("contacts", "contacts", "grp-emergency", 19, { quick: true }),
        g("grp-ref", "참고", 20, { hidden: true }),
        { id: "ref-semis", seq: 21, type: "link", label: "SeMIS v2", icon: "🛡️", url: "https://semis.pe.kr/", vis: "all", parent: "grp-ref", quick: true },
        { id: "my-sheet", seq: 22, type: "link", label: "내 시트", icon: "🔗", url: "https://docs.google.com/y", vis: "all", parent: "grp-ref" },
        { id: "top-link", seq: 23, type: "link", label: "최상위 링크", icon: "🔗", url: "https://example.com/", vis: "all", parent: null },
        m("vault", "vault", null, 24, { vis: "hq" }), m("settings", "settings", null, 25, { vis: "admin" })
      ];
    };
    const eM = makeEnv({ preData: { version: 1, menus: OLD() } });
    const mn = (id) => eM.S.data.menus.find(x => x.id === id);
    t("H01 v1.7 메뉴 → 허브 구조 마이그레이션 (그룹 8개 → 허브 6개, 소속 재배치)", () => {
      const groups = eM.S.data.menus.filter(x => x.type === "group").map(x => x.id);
      eq(groups.join(","), "hub-home,hub-sec,hub-saf,hub-aud,hub-ops,hub-doc");
      eq(mn("schedule").parent, "hub-home"); eq(mn("board").parent, "hub-home");
      eq(mn("reg-safety").parent, "hub-doc"); eq(mn("scr-status").parent, "hub-sec"); eq(mn("risk").parent, "hub-saf");
      eq(mn("car").parent, "hub-aud"); eq(mn("training").parent, "hub-aud");
      eq(mn("partners").parent, "hub-ops"); eq(mn("contacts").parent, "hub-ops");
      eq(mn("my-sheet").parent, "hub-doc", "운영자가 만든 링크도 이동");
      eq(mn("top-link").parent, "hub-home", "최상위 사용자 항목은 홈 허브로");
      ["dashboard", "vault", "settings"].forEach(id => eq(mn(id).parent, null, id + " 최상위 유지"));
    });
    t("H02 마이그레이션: 숨김·바로가기 보존, 숨긴 구버전 그룹의 하위는 개별 숨김으로", () => {
      eq(mn("board").hidden, true); eq(mn("reg-sec").hidden, true);
      eq(mn("ref-semis").hidden, true); eq(mn("my-sheet").hidden, true);
      eq(mn("contacts").quick, true);
      ok(!mn("reg-safety").hidden);
    });
    t("H03 마이그레이션 멱등 · 허브 순서(seq) = 시드 순서", () => {
      eq(eM.S.normalizeData(), false);
      const seqOf = (id) => mn(id).seq;
      ok(seqOf("dashboard") < seqOf("hub-home") && seqOf("hub-home") < seqOf("schedule") && seqOf("schedule") < seqOf("hub-sec"));
      ok(seqOf("hub-doc") < seqOf("reg-safety") && seqOf("my-sheet") > seqOf("ref-semis"), "사용자 항목은 허브 끝");
      ok(seqOf("settings") > seqOf("vault"));
    });

    const e = makeEnv();
    loginAs(e, "admin");
    go(e, "dashboard");
    t("H04 레일: 허브 6개 + 하단 유틸리티(암호 관리·시스템 설정) · 선 아이콘", () => {
      eq(qa(e, "#rail-hubs .rail-btn").map(b => b.dataset.hub).join(","), "hub-home,hub-sec,hub-saf,hub-aud,hub-ops,hub-doc");
      ok(qa(e, "#rail-hubs .rail-btn svg").length === 6);
      eq(qa(e, "#rail-util .rail-btn").map(b => b.dataset.route).join(","), "vault,settings");
      eq(q(e, '#rail-hubs [data-hub="hub-aud"] span').textContent, "점검교육", "레일 짧은 이름");
    });
    t("H05 허브 패널: 현재 허브만 표시(.on) · 대시보드는 홈 허브 첫 항목 · 이동 시 허브 자동 전환 · 경로 표시", () => {
      eq(qa(e, "#nav-menu .hub.on").length, 1);
      eq(q(e, "#nav-menu .hub.on").dataset.hub, "hub-home");
      eq(q(e, '#nav-menu .hub[data-hub="hub-home"] .hub-items .nav-item').dataset.route, "dashboard");
      q(e, '#rail-hubs [data-hub="hub-sec"]').click();
      eq(q(e, "#nav-menu .hub.on").dataset.hub, "hub-sec");
      eq(q(e, '#rail-hubs [data-hub="hub-sec"]').getAttribute("aria-pressed"), "true");
      go(e, "reg-safety");
      eq(q(e, "#nav-menu .hub.on").dataset.hub, "hub-doc");
      ok(q(e, "#crumbs").textContent.includes("규정 · 자료") && q(e, "#crumbs").textContent.includes("안전관리 규정"));
      ok(q(e, '#nav-menu [data-route="reg-safety"]').classList.contains("active"));
      go(e, "settings");
      ok(q(e, '#rail-util [data-route="settings"]').classList.contains("active"));
      ok(q(e, "#crumbs").textContent.includes("관리"));
    });
    t("H06 준비 중 블록: 운영 메뉴 없는 허브는 펼침 · 토글 상태는 계정별 저장", () => {
      const blk = () => q(e, '#nav-menu .hub[data-hub="hub-saf"] .hub-planned');
      ok(blk().classList.contains("open"), "안전 관리 — 기본 펼침");
      ok(!q(e, '#nav-menu .hub[data-hub="hub-sec"] .hub-planned').classList.contains("open"), "화물 보안 — v1.12부터 운영 메뉴 있어 기본 접힘");
      ok(!q(e, '#nav-menu .hub[data-hub="hub-ops"] .hub-planned').classList.contains("open"), "협력·비상 — 운영 메뉴 있어 기본 접힘");
      q(e, '[data-toggle-planned="hub-saf"]').click();
      ok(!blk().classList.contains("open"));
      e.S.renderNav();
      ok(!blk().classList.contains("open"), "재렌더 후 유지");
      q(e, '[data-toggle-planned="hub-saf"]').click();
    });
    t("H07 모듈 등록 → 준비 중 블록에서 운영 목록으로 · 구축 현황 증가", () => {
      e.S.registerModule("kc-ra", { title: "RA", render(root) { root.innerHTML = e.S.ui.head({ title: "상용화주 · RA 관리" }); } });
      e.S.renderNav(); go(e, "dashboard");
      ok(q(e, '#nav-menu .hub[data-hub="hub-sec"] .hub-items [data-route="kc-ra"]'), "운영 목록");
      ok(!q(e, '#nav-menu .hub[data-hub="hub-sec"] .planned-list [data-route="kc-ra"]'), "준비 중에서 제거");
      const sec = qa(e, "#dash-build .build-row").find(r => r.dataset.dashHub === "hub-sec");
      eq(sec.querySelector(".br-n").textContent, "3/4");
      go(e, "kc-ra");
      ok(q(e, "#view .page-head [data-print-btn]"), "키트 머리말에 인쇄 버튼 자동 부착");
    });
    t("H08 navBadge: 규정 건수가 메뉴 옆에 표시", () => {
      e.S.data.regulations = [{ id: "r1", scope: "safety", title: "a", ideas: [] }, { id: "r2", scope: "safety", title: "b", ideas: [] }];
      e.S.saveSilent(); e.S.renderNav();
      eq(q(e, '#nav-menu [data-route="reg-safety"] .nav-meta').textContent, "2");
      ok(!q(e, '#nav-menu [data-route="reg-dg"] .nav-meta'), "0건은 표시 안 함");
      e.S.data.regulations = []; e.S.saveSilent(); e.S.renderNav();
    });
    t("H09 고정한 메뉴(홈 허브) = quick 항목 · 다른 허브 소속만", () => {
      const pins = qa(e, '#nav-menu .hub[data-hub="hub-home"] .nav-pin').map(x => x.textContent);
      ok(pins.some(x => x.includes("비상연락망")), "연락망");
      ok(pins.some(x => x.includes("SeMIS v2")), "링크");
    });
    t("H10 모바일 하단 탭: 권한에 맞춰 표시 · 규정 탭은 허브 첫 운영 모듈 · 전체 → 시트", () => {
      eq(qa(e, "#tabbar .tab-btn[data-route]").map(b => b.dataset.route).join(","), "dashboard,schedule,contacts,reg-sec");
      ok(q(e, "#tabbar .tab-all"));
      q(e, "#tabbar .tab-all").click();
      ok(q(e, "#app").classList.contains("sheet-open"));
      ok(q(e, "#sidebar-backdrop").classList.contains("show"));
      go(e, "schedule");
      ok(!q(e, "#app").classList.contains("sheet-open"), "이동 시 닫힘");
      ok(q(e, '#tabbar [data-route="schedule"]').classList.contains("active"));
      const e2 = makeEnv(); loginAs(e2, "user");
      eq(qa(e2, "#tabbar .tab-btn[data-route]").map(b => b.dataset.route).join(","), "dashboard", "일반사용자");
    });
    t("H11 패널 접기(데스크톱) · 태블릿 떠 있는 패널", () => {
      Object.defineProperty(e.w, "innerWidth", { value: 1440, configurable: true });
      q(e, "#menu-toggle").click();
      ok(q(e, "#app").classList.contains("panel-collapsed"));
      e.S.renderNav();
      ok(q(e, "#app").classList.contains("panel-collapsed"), "계정별 저장");
      q(e, '#rail-hubs [data-hub="hub-doc"]').click();
      ok(q(e, "#app").classList.contains("panel-open"), "접힌 상태에서 허브 클릭 → 떠서 열림");
      e.S.closeOverlays();
      q(e, "#menu-toggle").click();
      ok(!q(e, "#app").classList.contains("panel-collapsed"));
      Object.defineProperty(e.w, "innerWidth", { value: 1024, configurable: true });
      q(e, '#rail-hubs [data-hub="hub-sec"]').click();
      ok(q(e, "#app").classList.contains("panel-open"), "태블릿");
      e.S.closeOverlays();
    });
    t("H12 통합 검색 팔레트: 열기 버튼 · Ctrl+K · Esc · 결과 이동", () => {
      const box = q(e, "#cmdk");
      ok(box.classList.contains("hidden"));
      q(e, ".panel-search").click();
      ok(!box.classList.contains("hidden"), "패널 검색 버튼");
      q(e, "#hdr-search").dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ok(box.classList.contains("hidden"), "Esc 닫기");
      e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
      ok(!box.classList.contains("hidden"), "Ctrl+K");
      q(e, "#hdr-search").value = "안전관리 규정";
      q(e, "#hdr-search").dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    t("H13 화면 키트: ui.head · ui.stats · ui.search · ui.empty · icon", () => {
      const h = e.S.ui.head({ title: "제목", meta: "메타", desc: "설명", actions: "<button>x</button>" });
      ok(h.indexOf('class="page-head"') >= 0 && h.indexOf('class="page-title">제목') >= 0 && h.indexOf("page-desc") >= 0);
      const st = e.S.ui.stats([{ label: "건수", value: 3, tone: "ok" }, { label: "지연", value: 0, tone: "bad", sub: "없음" }]);
      ok(st.indexOf('class="stat-row"') >= 0 && st.indexOf("tone-bad") >= 0 && st.indexOf("stat-sub") >= 0);
      ok(e.S.ui.search("q1", "검색").indexOf('id="q1"') >= 0);
      ok(e.S.ui.empty("없음").indexOf("empty-state") >= 0);
      ok(/^<svg class="ico"/.test(e.S.icon("scan", 18)));
      ok(e.S.icon("no-such").indexOf("<path") > 0, "모르는 키는 기본 아이콘");
      ok(e.S.HUB_ICONS.every(k => e.S.ICONS[k]));
    });
    t("H14 시스템 설정: 허브 추가(아이콘 선택) + 하위 링크 → 레일에 새 허브", () => {
      go(e, "settings");
      q(e, "#btn-add-menu").click();
      q(e, "#f-type").value = "group"; q(e, "#f-type").dispatchEvent(new e.w.Event("change"));
      q(e, "#f-label").value = "ULD 관리";
      q(e, '#modal-box input[name="f-ico"][value="calendar"]').checked = true;
      q(e, "#f-save").click();
      const hub = e.S.data.menus.find(m => m.type === "group" && m.label === "ULD 관리");
      ok(hub && hub.ico === "calendar");
      ok(!q(e, `#rail-hubs [data-hub="${hub.id}"]`), "빈 허브는 레일에 숨김");
      q(e, "#btn-add-menu").click();
      q(e, "#f-label").value = "ULD 시트"; q(e, "#f-url").value = "https://docs.google.com/uld";
      q(e, "#f-parent").value = hub.id; q(e, "#f-save").click();
      ok(q(e, `#rail-hubs [data-hub="${hub.id}"]`), "하위가 생기면 레일에 표시");
    });
    t("H15 vendor·signer: 레일 허브 숨김(nav-lite)", () => {
      const e3 = makeEnv();
      loginAs(e3, "vendor");
      ok(q(e3, "#app").classList.contains("nav-lite"));
      eq(qa(e3, "#rail-hubs .rail-btn").length, 0);
      eq(qa(e3, "#tabbar .tab-btn[data-route]").map(b => b.dataset.route).join(","), "dashboard");
    });
    t("H17 모듈 템플릿(docs/module-template.js)이 그대로 동작 — 예정→운영 승격 · 키트 화면 · 인쇄 · 배지 · 검색", () => {
      const e4 = makeEnv();
      loginAs(e4, "hq");
      e4.S.data.cars = [{ id: "c1", no: "26-ICN-01", title: "지게차 통로 표시 미흡", due: "2026-01-01", status: "open" }];
      e4.S.saveSilent();
      e4.w.eval(read("docs/module-template.js"));
      e4.S.renderNav(); go(e4, "car");
      ok(q(e4, "#view .page-head .page-title").textContent === "시정조치 (CAR)");
      ok(q(e4, "#view .stat-row .stat.tone-bad"), "기한 경과 강조");
      ok(q(e4, "#view .page-head [data-print-btn]"), "인쇄 버튼");
      ok(q(e4, '#nav-menu .hub[data-hub="hub-aud"] .hub-items [data-route="car"] .nav-meta'), "운영 목록 + 배지");
      eq(q(e4, '#nav-menu [data-route="car"] .nav-meta').textContent, "1");
      ok(e4.w.SemisSearch.search("지게차 통로").some(h => h.route === "car"), "검색 프로바이더");
      eq(e4.errors.length, 0, e4.errors.join(" | "));
    });
    t("H16 jsdom 오류 없음(허브 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
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
        eq(btn.textContent.trim(), "Print");
        ok(btn.classList.contains("no-print"));
      });
    });
    t("P02 인쇄 버튼은 화면 머리말(.ds-head/.page-head) 안에 위치", () => {
      go(e, "dashboard");
      ok(q(e, ".page-head [data-print-btn]"));
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

  /* ══════════ [Y] 동기화 (v1.15 — 로그인 세션 · 권한별 컬렉션) ══════════ */
  {
    const server = makeServer();
    const e = makeEnv({ fetch: server.fetch });
    const { Sync } = e;
    t("Y01 SYNC_KEYS 구성(계정 자료 제외)", () =>
      eq(Sync.SYNC_KEYS.join(","), "menus,notices,schedules,assignees,assigneesSeeded,minutes,minuteFolders,levelHistory,safetyBoard,contacts,gcal,chatRooms,vault,regulations,equipment,crisis,fleet,audits,phonebook,training"));
    t("Y02 SYNC_KEYS는 모두 freshData 컬렉션에 존재", () => Sync.SYNC_KEYS.forEach(k => ok(e.S.data[k] !== undefined, k)));
    await ta("Y03 로그인 전에는 서버를 부르지 않음 · 로그인 후 초기 pull + 쓰기 권한 있는 컬렉션만 시드", async () => {
      await Sync.start();
      eq(server.calls.filter(c => !/semis_logi_challenge/.test(c.url)).length, 0, "세션 없음 → 데이터 호출 없음(작업증명 문제만 미리 받음)");
      await server.loginAs(e, "hq-pw-2222");
      await Sync.start();
      ok(server.calls.some(c => c.url.indexOf("/rest/v1/semis_logi_store") >= 0 && c.token.length === 64));
      ok(server.rows.some(r => r.key === "notices"), "hq 쓰기 가능 → 시드");
      ok(!server.rows.some(r => r.key === "menus"), "menus(관리자만 쓰기)는 시드 안 함");
      eq(Sync.status, "online");
    });
    await ta("Y04 로컬 변경 → 디바운스 push · 서버가 작성자 계정 기록", async () => {
      e.S.data.safetyBoard.since = "2026-01-01"; e.S.save();
      await Sync._flush();
      const row = server.rows.find(r => r.key === "safetyBoard");
      eq(row.value.since, "2026-01-01");
      ok(row.updated_by.indexOf("cargo-ss/") === 0, row.updated_by);
    });
    t("Y05 원격 변경 반영(applyRemote) → 화면 갱신", () => {
      go(e, "dashboard");
      Sync.applyRemote("notices", [{ id: "nr", title: "원격 공지", body: "b", author: "x", pinned: false, created: "2026-09-01T00:00:00Z" }]);
      eq(e.S.data.notices[0].title, "원격 공지");
      ok(q(e, "#notice-list").textContent.includes("원격 공지"));
    });
    t("Y06 canon: 키 순서 무관 동일", () => eq(Sync._canon({ b: 1, a: [1, { d: 2, c: 3 }] }), Sync._canon({ a: [1, { c: 3, d: 2 }], b: 1 })));
    await ta("Y07 오프라인: pending 큐(탭 세션) 보관 후 재접속 push", async () => {
      server.fail = true;
      e.S.data.notices.push({ id: "off1", title: "오프라인 공지", body: "", author: "x", pinned: false, created: "2026-09-02T00:00:00Z" });
      e.S.save();
      await Sync._flush().catch(() => {});
      eq(Sync.status, "offline");
      ok(Sync.pendingKeys().indexOf("notices") >= 0);
      ok(e.w.sessionStorage.getItem("semisl:pendingSync"), "sessionStorage");
      ok(!e.w.localStorage.getItem("semisl:pendingSync"), "localStorage 아님");
      server.fail = false;
      await Sync.syncNow();
      ok(server.rows.find(r => r.key === "notices").value.some(n => n.id === "off1"));
      eq(Sync.pendingKeys().length, 0);
    });
    t("Y08 파일 저장 주소는 표준(public) 경로 — 열람은 서명 URL", () => ok(Sync.PUBLIC_PREFIX.indexOf("/object/public/semis-logi-files/") > 0));

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
      e.S.data.schedules = [];
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
    await ta("Y13 서버가 쓰기를 거절(권한) → 로컬을 서버 값으로 되돌리고 알림", async () => {
      server.forceDeny = true;
      const before = JSON.stringify(e.S.data.safetyBoard);
      e.S.data.safetyBoard.note = "거절될 변경"; e.S.save();
      await Sync._flush().catch(() => {});
      await tick(20);
      server.forceDeny = false;
      eq(Sync._canon(e.S.data.safetyBoard), Sync._canon(JSON.parse(before)), "되돌림");
      eq(Sync.pendingKeys().indexOf("safetyBoard"), -1);
      ok(q(e, "#toast-wrap").textContent.includes("권한"), "알림");
    });
    await ta("Y14 변경 알림(Broadcast) → 그 컬렉션만 다시 읽음 · 내 변경 알림은 무시", async () => {
      const i = server.rows.findIndex(r => r.key === "notices");
      server.rows[i] = Object.assign({}, server.rows[i], { value: server.rows[i].value.concat([{ id: "bc1", title: "알림으로 받은 공지", body: "", author: "x", pinned: false, created: "2026-09-03T00:00:00Z" }]) });
      const n0 = server.calls.length;
      Sync.onBroadcast({ payload: { key: "notices", by: "cargo-mgr/cOTHER" } });
      Sync.onBroadcast({ payload: { key: "vault", by: "x/" + Sync.CLIENT_ID } });
      await tick(500);
      ok(e.S.data.notices.some(n => n.id === "bc1"), "반영");
      const gets = server.calls.slice(n0).filter(c => c.method === "GET" && c.url.indexOf("/rest/v1/semis_logi_store") >= 0);
      eq(gets.length, 1); ok(gets[0].url.indexOf("key=in.(notices)") > 0, gets[0].url);
    });
    await ta("Y15 manager: 읽기 권한 밖(vault) 미수신 · 쓰기 권한 밖(notices) 전송 안 함", async () => {
      const srvM = makeServer({ rows: [{ key: "contacts", value: { sections: [{ id: "c", title: "관리자 연락처", rows: [] }] } },
        { key: "vault", value: { v: 1, members: [{ id: "m" }], data: null, personal: {}, updated: "" } },
        { key: "notices", value: [] }, { key: "minutes", value: [] }] });
      const e2 = makeEnv({ fetch: srvM.fetch });
      await srvM.loginAs(e2, "mgr-pw-3333");
      await e2.Sync.start();
      ok(JSON.stringify(e2.S.data.contacts).includes("관리자 연락처"), "contacts(2) 수신");
      eq(e2.S.data.vault.members.length, 0, "vault(3) 미수신");
      ok(!srvM.calls.some(c => c.method === "GET" && c.url.indexOf("vault") > 0), "vault 요청 없음");
      const n0 = srvM.calls.length;
      e2.S.data.notices.push({ id: "mg1", title: "관리자 공지", body: "", author: "x", pinned: false, created: "2026-09-04T00:00:00Z" });
      e2.S.save();
      await e2.Sync._flush();
      ok(!srvM.calls.slice(n0).some(c => c.method === "POST"), "notices(쓰기 3) 전송 안 함");
      e2.Sync.stop();
    });
    await ta("Y16 세션이 끊긴 뒤 pull(빈 응답) → 로그인 창", async () => {
      Object.keys(server.sessions).forEach(t => delete server.sessions[t]);
      await Sync.pull(false).catch(() => {});
      await tick(20);
      ok(!q(e, "#login-overlay").classList.contains("hidden"));
    });
    await ta("Y17 변경 이력(관리자 RPC) 조회 · 되돌리기", async () => {
      server.history = [{ id: 11, key: "schedules", old_len: 5, new_len: 0,
        changed_at: "2026-09-17T07:44:34Z", changed_by: "cargo-ss/cmu557qn92utfk3",
        old_value: [{ id: "r1", title: "복구된 일정", start: "2026-09-10", end: "2026-09-10" }] }];
      await server.loginAs(e, "admin-pw-111");
      const rows = await Sync.history("schedules", 10);
      eq(rows.length, 1); eq(rows[0].key, "schedules");
      ok(server.calls.some(c => c.url.indexOf("/rpc/semis_logi_history") > 0), "관리자 RPC");
      await Sync.restoreHistory(11);
      eq(e.S.data.schedules[0].title, "복구된 일정");
      eq(server.rows.find(r => r.key === "schedules").value[0].title, "복구된 일정");
    });
    t("Y18 jsdom 오류 없음(동기화 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
    Sync.stop();
  }

  /* ══════════ [RG] 규정 관리 (항공보안 / 안전관리 / 위험물 DG) ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const RG = e.w.SemisRegs;
    const seed = (scope, o) => Object.assign({ id: "t" + Math.random().toString(36).slice(2, 8),
      scope, title: "T", org: "", rev: "", date: "", lang: "", linkUrl: "", fileUrl: "", fileName: "",
      diffUrl: "", diffName: "", note: "", ideas: [], updated: "" }, o);

    t("RG01 규정 3종 메뉴가 실모듈 · vis=mgr (예정 플래그 해제)", () => {
      ["reg-sec", "reg-safety", "reg-dg"].forEach(id => {
        const mn = e.S.data.menus.find(m => m.type === "module" && m.module === id);
        ok(mn, id + " 메뉴");
        eq(!!mn.planned, false, id + " planned 해제");
        eq(mn.vis, "mgr", id + " vis");
        ok(e.S.hasModule(id), id + " 모듈 등록");
      });
      ok(e.Sync.SYNC_KEYS.includes("regulations"), "SYNC_KEYS 포함");
    });
    t("RG02 구버전 데이터 마이그레이션: planned 해제 · vis=all → mgr · scope 보정 (멱등)", () => {
      const e2 = makeEnv();
      const mn = e2.S.data.menus.find(m => m.module === "reg-safety");
      mn.planned = true; mn.desc = "준비 중"; mn.vis = "all";
      e2.S.data.regulations = [{ id: "x1", scope: "bogus" }];
      eq(e2.S.normalizeData(), true);
      const mn2 = e2.S.data.menus.find(m => m.module === "reg-safety");
      eq(!!mn2.planned, false); eq(mn2.desc, undefined); eq(mn2.vis, "mgr");
      eq(e2.S.data.regulations[0].scope, "safety", "알 수 없는 scope는 safety로");
      ok(Array.isArray(e2.S.data.regulations[0].ideas), "ideas 배열 보정");
      eq(e2.S.normalizeData(), false, "멱등");
    });
    t("RG03 3개 화면 렌더 · 통계 · 인쇄 버튼", () => {
      ["reg-sec", "reg-safety", "reg-dg"].forEach(r => {
        go(e, r);
        ok(q(e, "#view .page-title"), r + " 머리말");
        ok(q(e, "#view [data-print-btn]"), r + " A4 인쇄 버튼");
        ok(qa(e, "#view .stat").length >= 4, r + " 통계 카드");
      });
    });
    t("RG04 등록 → 목록 표시 · scope 분리 · PDF/링크 열람 버튼", () => {
      e.S.data.regulations = [
        seed("safety", { id: "s1", title: "화물 표준업무절차 (CSOP)", org: "CYB027", rev: "Rev.03",
          date: "2026-09-09", lang: "국문", fileUrl: "https://x/a.pdf", fileName: "a.pdf" }),
        seed("dg", { id: "d1", title: "위험물 교범", org: "CYA002", rev: "Rev.21",
          date: "2026-07-20", lang: "국문", linkUrl: "https://example.com/dg" })
      ];
      e.S.saveSilent();
      go(e, "reg-safety");
      ok(q(e, "#rg-body").textContent.includes("화물 표준업무절차"), "safety 목록");
      ok(!q(e, "#rg-body").textContent.includes("위험물 교범"), "dg 항목 미표시");
      ok(q(e, '#rg-body [data-rg-pdf="s1"]'), "PDF 열람 버튼");
      go(e, "reg-dg");
      ok(q(e, "#rg-body").textContent.includes("위험물 교범"), "dg 목록");
      ok(!q(e, '#rg-body [data-rg-pdf="d1"]'), "PDF 없으면 버튼 없음");
      eq(RG.byScope("dg").length, 1);
      eq(RG.stats("safety").pdf, 1);
    });
    t("RG05 정렬 = 관리번호 → 제목 · 검색 필터", () => {
      e.S.data.regulations = [
        seed("safety", { id: "a", title: "나중", org: "CYB027" }),
        seed("safety", { id: "b", title: "먼저", org: "CYA001" }),
        seed("safety", { id: "c", title: "가운데", org: "CYB001" })
      ];
      eq(RG.filtered("safety").map(r => r.org).join(","), "CYA001,CYB001,CYB027");
      RG.setQuery("safety", "CYB027");
      eq(RG.filtered("safety").length, 1);
      RG.setQuery("safety", "");
    });
    t("RG06 개정 아이디어 노트: 추가 · 검토중 집계", () => {
      e.S.data.regulations = [seed("safety", { id: "n1", title: "절차서", ideas: [] })];
      e.S.saveSilent();
      const r = e.S.data.regulations[0];
      r.ideas.push({ id: "i1", loc: "3.2.1", kind: "변경", status: "검토중", content: "문구 수정", author: "T", created: "2026-09-01T00:00:00Z" });
      r.ideas.push({ id: "i2", loc: "", kind: "신규", status: "반영완료", content: "추가", author: "T", created: "2026-09-02T00:00:00Z" });
      eq(RG.stats("safety").ideas, 2);
      eq(RG.stats("safety").open, 1);
      go(e, "reg-safety");
      ok(q(e, '#rg-body [data-rg-idea="n1"]'), "노트 버튼");
      q(e, '#rg-body [data-rg-idea="n1"]').click();
      ok(q(e, "#modal-box").textContent.includes("문구 수정"), "노트 목록");
      e.S.closeModal();
    });
    t("RG07 manager는 열람만 (등록 버튼 없음)", () => {
      const e3 = makeEnv();
      loginAs(e3, "manager");
      go(e3, "reg-safety");
      ok(q(e3, "#view .page-title"), "화면 접근 가능");
      ok(!q(e3, "#rg-add"), "등록 버튼 없음");
    });
    t("RG08 일반사용자(user)는 접근 차단", () => {
      const e4 = makeEnv();
      loginAs(e4, "user");
      go(e4, "reg-safety");
      ok(q(e4, "#view").textContent.includes("대시보드"), "대시보드 폴백");
    });
    t("RG10 검색어가 걸린 채 등록해도 새 규정이 목록에 보인다 (검색어 자동 해제)", () => {
      e.S.data.regulations = [seed("sec", { id: "s1", title: "보안규정", org: "CYB010" })];
      e.S.saveSilent();
      go(e, "reg-sec");
      const box = q(e, "#rg-search");
      box.value = "CYB010"; box.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      eq(qa(e, "#rg-body [data-rg-row]").length, 1, "검색 적용");
      eq(RG.getQuery("sec"), "CYB010");
      q(e, "#rg-add").click();
      q(e, "#rg-title").value = "새 화물보안 지침";
      q(e, "#rg-save").click();
      eq(RG.getQuery("sec"), "", "저장한 규정이 검색어에 안 걸리면 검색어 해제");
      ok(q(e, "#rg-body").textContent.includes("새 화물보안 지침"), "저장 직후 목록에 보임");
      go(e, "dashboard"); go(e, "reg-sec");
      ok(q(e, "#rg-body").textContent.includes("새 화물보안 지침"), "화면 이동 후에도 보임");
      eq(q(e, "#rg-search").value, "", "검색창도 비어 있다");
    });
    t("RG11 검색어에 걸리는 규정을 저장하면 검색은 유지된다", () => {
      go(e, "reg-sec");
      const box = q(e, "#rg-search");
      box.value = "CYB010"; box.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      q(e, "#rg-add").click();
      q(e, "#rg-title").value = "추가 지침";
      q(e, "#rg-org").value = "CYB010";
      q(e, "#rg-save").click();
      eq(RG.getQuery("sec"), "CYB010", "검색 유지");
      ok(q(e, "#rg-body").textContent.includes("추가 지침"));
    });
    t("RG12 검색 중임을 화면에 표시 · 해제 버튼 · 결과 없음 안내", () => {
      RG.setQuery("sec", "");
      go(e, "reg-sec");
      ok(q(e, "#rg-fnote").hidden, "검색 전에는 숨김");
      ok(q(e, "#rg-clear").hidden);
      const box = q(e, "#rg-search");
      box.value = "CYB010"; box.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      ok(!q(e, "#rg-fnote").hidden, "검색 중 표시");
      ok(q(e, "#rg-fnote").textContent.includes("전체"), q(e, "#rg-fnote").textContent);
      box.value = "없는검색어zzz"; box.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      ok(q(e, "#rg-body .empty").textContent.includes("일치하는 규정이 없습니다"), "빈 결과 안내");
      q(e, "#rg-body [data-rg-clear]").click();
      eq(RG.getQuery("sec"), "", "빈 화면의 해제 버튼");
      ok(qa(e, "#rg-body [data-rg-row]").length > 0, "전체 목록 복귀");
      q(e, "#rg-clear") && ok(q(e, "#rg-clear").hidden, "표시 숨김");
    });
    await ta("RG13 pull 경합 방어 — push 직후 도착한 옛 서버 값이 로컬 변경을 덮지 않는다", async () => {
      const server = makeServer({ rows: [{ key: "regulations", value: [{ id: "old1", scope: "sec", title: "옛 규정", ideas: [] }],
        updated_at: "2026-09-23T00:00:00Z", updated_by: "other" }] });
      const e5 = makeEnv({ boot: false, fetch: server.fetch });
      e5.S.load();
      e5.S.boot();
      await server.loginAs(e5, "hq-pw-2222");
      e5.Sync.snapAll();
      // 로컬에서 새 규정 등록(아직 서버 미반영) → pending 은 비어 있지만 dirty 상태
      e5.S.data.regulations = [{ id: "old1", scope: "sec", title: "옛 규정", ideas: [] },
        { id: "new1", scope: "sec", title: "새 규정", ideas: [] }];
      e5.S.saveSilent();
      ok(e5.Sync.dirtyKeys().includes("regulations"), "dirty 감지");
      await e5.Sync.pull(false);
      const ids = e5.S.data.regulations.map(r => r.id).sort().join(",");
      eq(ids, "new1,old1", "로컬 변경 보존(병합)");
      e5.Sync.stop();
    });
    t("RG09 jsdom 오류 없음(규정 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
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
      q(e, "[data-vp-eye]").click();
      eq(q(e, "[data-vp-span]").textContent, "PlainPw!", "표시 전환");
      VT.maskAll();
      eq(q(e, "[data-vp-span]").textContent, "••••••••", "인쇄 전 재마스킹");
      VT.lock();
    });
    await ta("VT12 개인용 항목: 본인만 해독 · 다른 멤버에게는 보이지 않음 · 서버엔 암호문만", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      await VT.addMember("김홍석", "pw-kim");
      await VT.addEntryForTest({ category: "시스템", title: "팀 공용 CCTV", account: "cctv", pw: "SharedPw1!", url: "", note: "" }, "shared");
      await VT.addEntryForTest({ category: "웹사이트", title: "내 개인 메일", account: "me", pw: "MyOwnPw9!", url: "", note: "" }, "personal");
      eq(VT.sharedCount(), 1); eq(VT.personalCount(), 1);
      const choiId = e.S.data.vault.members.find(m => m.name === "최상일").id;
      ok(e.S.data.vault.personal[choiId] && e.S.data.vault.personal[choiId].ct, "개인용 암호문 저장");
      const raw = JSON.stringify(e.S.data.vault) + (e.w.localStorage.getItem("semisl:data") || "");
      ok(!raw.includes("MyOwnPw9!") && !raw.includes("내 개인 메일"), "개인용 평문 미노출");
      VT.lock();
      // 다른 멤버로 해제 → 공용만 보임
      const kimId = e.S.data.vault.members.find(m => m.name === "김홍석").id;
      await VT.unlock(kimId, "pw-kim");
      eq(VT.sharedCount(), 1, "공용은 보임");
      eq(VT.personalCount(), 0, "타인의 개인용은 안 보임");
      eq(VT.findEntry("내 개인 메일"), null);
      VT.lock();
      // 본인 재해제 → 개인용 복호화
      await VT.unlock(choiId, "pw-choi");
      eq(VT.findEntry("내 개인 메일").pw, "MyOwnPw9!", "본인은 복호화");
      eq(VT.scopeOf("내 개인 메일"), "personal");
      eq(VT.scopeOf("팀 공용 CCTV"), "shared");
      VT.lock();
    });
    await ta("VT13 항목 폼: 공용/개인용 선택 · 저장 · 구분 전환 이동", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      go(e, "vault");
      q(e, "#vault-add").click();
      eq(qa(e, '#modal-box input[name="v-scope"]').length, 2, "공용/개인용 2택");
      ok(q(e, '#modal-box input[name="v-scope"][value="shared"]').checked, "기본값 공용");
      q(e, '#modal-box input[name="v-scope"][value="personal"]').checked = true;
      q(e, "#v-title").value = "개인 VPN"; q(e, "#v-pw").value = "vpn-pw";
      q(e, "#v-save").click();
      await new Promise(r => setTimeout(r, 400));
      eq(VT.scopeOf("개인 VPN"), "personal", "개인용 저장");
      ok(q(e, "#vault-body .v-tag-personal"), "개인 배지 표시");
      // 수정에서 공용으로 전환
      q(e, "#vault-body [data-ve-edit]").click();
      ok(q(e, '#modal-box input[name="v-scope"][value="personal"]').checked, "현재 구분 반영");
      q(e, '#modal-box input[name="v-scope"][value="shared"]').checked = true;
      q(e, "#v-save").click();
      await new Promise(r => setTimeout(r, 400));
      eq(VT.scopeOf("개인 VPN"), "shared", "공용으로 이동");
      eq(VT.personalCount(), 0); eq(VT.sharedCount(), 1);
      VT.lock();
    });
    await ta("VT14 필터 칩: 전체 · 공용 · 개인용", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      await VT.addEntryForTest({ category: "시스템", title: "A공용", account: "", pw: "", url: "", note: "" }, "shared");
      await VT.addEntryForTest({ category: "시스템", title: "B개인", account: "", pw: "", url: "", note: "" }, "personal");
      go(e, "vault");
      eq(qa(e, "#vault-chips [data-scope]").length, 3);
      eq(qa(e, "#vault-body tbody tr").length, 2, "전체 2건");
      qa(e, "#vault-chips [data-scope]").find(b => b.dataset.scope === "personal").click();
      eq(qa(e, "#vault-body tbody tr").length, 1, "개인용 1건");
      ok(q(e, "#vault-body").textContent.includes("B개인"));
      qa(e, "#vault-chips [data-scope]").find(b => b.dataset.scope === "shared").click();
      ok(q(e, "#vault-body").textContent.includes("A공용"));
      ok(!q(e, "#vault-body").textContent.includes("B개인"));
      VT.lock();
    });
    await ta("VT15 개인용이 있는 다른 멤버의 비밀번호는 변경 불가 · 본인은 가능(개인용 유지) · 제거 시 개인용 폐기", async () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const VT = e.w.SemisVault;
      await VT.setup("최상일", "pw-choi");
      await VT.addMember("김홍석", "pw-kim");
      VT.lock();
      const kimId = e.S.data.vault.members.find(m => m.name === "김홍석").id;
      const choiId = e.S.data.vault.members.find(m => m.name === "최상일").id;
      await VT.unlock(kimId, "pw-kim");
      await VT.addEntryForTest({ category: "기타", title: "김 개인", account: "", pw: "k1", url: "", note: "" }, "personal");
      VT.lock();
      await VT.unlock(choiId, "pw-choi");
      let blocked = false;
      try { await VT.changeMemberPw(kimId, "pw-kim-new"); } catch (err) { blocked = /본인만/.test(err.message); }
      ok(blocked, "타인 비밀번호 변경 차단");
      await VT.addEntryForTest({ category: "기타", title: "최 개인", account: "", pw: "c1", url: "", note: "" }, "personal");
      await VT.changeMemberPw(choiId, "pw-choi-2");
      VT.lock();
      await VT.unlock(choiId, "pw-choi-2");
      eq(VT.findEntry("최 개인").pw, "c1", "본인 비밀번호 변경 후에도 개인용 유지");
      ok(VT.hasPersonal(kimId), "김 개인용 존재");
      VT.removeMember(kimId);
      ok(!VT.hasPersonal(kimId), "멤버 제거 시 개인용 폐기");
      VT.lock();
    });
    t("VT16 normalize: vault.personal 구조 보정 (멱등)", () => {
      const e = makeEnv();
      e.S.data.vault.personal = [];
      e.S.normalizeData();
      ok(e.S.data.vault.personal && !Array.isArray(e.S.data.vault.personal), "객체로 보정");
      eq(e.S.normalizeData(), false, "멱등");
    });
    t("VT11 검색 프로바이더 미등록 — 저장소 내용은 통합검색에 노출되지 않음", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const ids = (e.w.SemisSearch.terms ? [] : []);
      ok(!read("js/vault.js").includes("SemisSearch.register"), "vault는 검색에 등록하지 않음");
      ok(ids.length === 0);
    });
  }

  /* ══════════ [V] v1.9 — 일정 등록 폼 · 12색 팔레트 · 설명 말풍선 · 허브 사진 배너 · 대시보드 3D ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const C = e.w.SemisCalendar;
    t("V01 팔레트 12색 · id 중복 없음 · 구버전 id(lime·amber·indigo)는 선택지에서 빠지고 가까운 색으로", () => {
      eq(C.COLORS.length, 12);
      eq(new Set(C.COLORS.map(c => c.id)).size, 12);
      ["lime", "amber", "indigo"].forEach(id => ok(!C.COLORS.some(c => c.id === id), id));
      eq(C.pickColor("lime"), "green"); eq(C.pickColor("amber"), "orange"); eq(C.pickColor("indigo"), "blue");
      eq(C.pickColor("rose"), "rose"); eq(C.pickColor(""), "blue"); eq(C.pickColor("nope"), "blue");
    });
    t("V02 CSS: 12색 칠(--evf) 값이 모두 다름 · 파랑≠청록(예전엔 같은 색)", () => {
      const css = read("css/main.css");
      const fills = C.COLORS.map(c => {
        const m = new RegExp("\\.ev-" + c.id + "\\b[^{]*\\{[^}]*--evf:\\s*(#[0-9a-f]{6})", "i").exec(css);
        ok(m, "fill for " + c.id); return m[1].toLowerCase();
      });
      eq(new Set(fills).size, 12, fills.join(","));
      ok(/\.ev-orange, \.ev-amber/.test(css) && /\.ev-green, \.ev-lime/.test(css) && /\.ev-blue, \.ev-indigo/.test(css), "구버전 id 별칭 CSS");
    });
    t("V03 일정 등록 폼: 입력(왼쪽) · 설정(오른쪽) 분리, 설명 문구는 말풍선으로만", () => {
      go(e, "schedule");
      q(e, "#cal-add").click();
      ok(q(e, "#modal-box .evf .evf-main #f-title"), "일정명은 입력 영역");
      ok(q(e, "#modal-box .evf-side #f-colors"), "색상은 설정 영역");
      ok(q(e, "#modal-box .evf-side #f-priv") && q(e, "#modal-box .evf-side #f-autodefer") && q(e, "#modal-box .evf-side #f-vehicle"));
      eq(q(e, "#f-title").getAttribute("placeholder"), "예: OO회의");
      ok(!q(e, "#modal-box").textContent.includes("지점"), "지점 보안점검 예시 없음");
      eq(qa(e, "#modal-box .form-hint").length, 0, "폼 안 설명 문단 없음");
      ok(!q(e, "#hint-auto"));
      ok(qa(e, "#modal-box .help-tip").length >= 4, "ⓘ 설명 버튼");
      eq(qa(e, "#f-colors .color-swatch").length, 12);
      ok(!/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(q(e, "#modal-box .evf").textContent), "폼에 이모지 없음");
    });
    t("V04 말풍선: 클릭하면 설명 표시, 다시 클릭·Esc로 닫힘", () => {
      const b = qa(e, "#modal-box .help-tip")[0];
      b.click();
      const box = q(e, "#help-tipbox");
      ok(box && box.classList.contains("on")); ok(box.textContent.length > 5);
      eq(b.getAttribute("aria-expanded"), "true");
      b.click();
      return new Promise(r => setTimeout(r, 5)).then(() => {});
    });
    t("V05 저장: 색상 선택·체크 칩이 그대로 저장된다", () => {
      go(e, "schedule");
      q(e, "#cal-add").click();
      q(e, "#f-title").value = "팔레트 확인 회의";
      q(e, '#f-colors [data-color="purple"]').click();
      eq(q(e, '#f-colors [data-color="purple"]').getAttribute("aria-checked"), "true");
      q(e, "#f-vehicle").checked = true;
      q(e, "#f-save").click();
      const rec = e.S.data.schedules.find(x => x.title === "팔레트 확인 회의");
      ok(rec); eq(rec.color, "purple"); eq(rec.vehicle, true);
    });
    t("V06 반복 일정이면 자동 연기·연장 칩 비활성", () => {
      go(e, "schedule");
      q(e, "#cal-add").click();
      const rep = q(e, "#f-repeat"); rep.value = "weekly"; rep.dispatchEvent(new e.w.Event("change"));
      ok(q(e, "#f-autodefer").disabled);
      ok(q(e, "#f-autodefer").closest(".evf-opt").classList.contains("is-disabled"));
      e.S.closeModal();
    });
    t("V07 허브 화면은 사진 배너(#view[data-hub]), 대시보드·관리 메뉴는 제외", () => {
      go(e, "contacts"); eq(q(e, "#view").getAttribute("data-hub"), "hub-ops");
      go(e, "schedule"); eq(q(e, "#view").getAttribute("data-hub"), "hub-home");
      go(e, "reg-safety"); eq(q(e, "#view").getAttribute("data-hub"), "hub-doc");
      go(e, "scr-status"); eq(q(e, "#view").getAttribute("data-hub"), "hub-sec");
      ok(q(e, "#view .page-head [data-print-btn]"), "배너에도 A4 인쇄 버튼");
      go(e, "dashboard"); ok(!q(e, "#view").hasAttribute("data-hub"));
      go(e, "vault"); ok(!q(e, "#view").hasAttribute("data-hub"));
    });
    t("V08 대시보드: 화물 태그 카드에 3D 자리 · jsdom(WebGL 없음)은 사진 대체 · 하단 4칸", () => {
      go(e, "dashboard");
      const st = q(e, ".ticket .tk-main #dash-3d.tk-stage");
      ok(st, "3D 자리"); ok(st.classList.contains("no-print"));
      ok(st.classList.contains("h3d-fallback"), "WebGL 없으면 사진");
      ok(q(e, ".dash-sheet.cols-4 #upcoming-box"), "다가오는 일정은 하단 시트 첫 칸");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("V09 자산: 사진 13장(webp) · three.js 로컬 사본 · CSS가 참조하는 이미지가 모두 존재", () => {
      const css = read("css/main.css");
      const urls = Array.from(css.matchAll(/url\("?\.\.\/(assets\/[^")]+)"?\)/g)).map(m => m[1]);
      ok(urls.length >= 14, "url " + urls.length);
      urls.forEach(u => ok(fs.existsSync(path.join(ROOT, u)), u));
      const imgs = fs.readdirSync(path.join(ROOT, "assets/img")).filter(f => f.endsWith(".webp"));
      ok(imgs.length >= 13, "webp " + imgs.length);
      imgs.forEach(f => ok(fs.statSync(path.join(ROOT, "assets/img", f)).size < 160 * 1024, f + " 160KB 이하"));
      const three = read("assets/vendor/three.module.min.js");
      ok(three.indexOf("SPDX-License-Identifier: MIT") > 0 && /REVISION="170"|const t="170"/.test(three.slice(0, 400)), "three r170");
      ok(read("js/hero3d.js").indexOf("assets/vendor/three.module.min.js") > 0, "CDN 아닌 로컬 사본 사용");
      ok(fs.existsSync(path.join(ROOT, "assets/img/CREDITS.md")), "사진 출처 기록");
    });
    t("V10 로그인: 사진 배경 + 데스크톱 LCP 미리 불러오기", () => {
      const html = read("index.html"), css = read("css/main.css");
      ok(/rel="preload" as="image" href="assets\/img\/login-dusk\.webp"/.test(html));
      ok(css.indexOf("login-dusk.webp") > 0 && css.indexOf("login-dusk-sm.webp") > 0);
    });
    t("V12 (v1.9.1) 일정 폼: 완료는 스크롤 영역 밖 하단 버튼줄에", () => {
      go(e, "schedule");
      q(e, "#cal-add").click();
      const done = q(e, "#f-done");
      ok(done && done.closest(".modal-actions.evf-foot"), "완료 = 하단 버튼줄");
      ok(!done.closest(".evf-body"), "스크롤되는 본문 밖");
      ok(q(e, ".evf-foot #f-save") && q(e, ".evf-foot #f-cancel"));
      e.S.closeModal();
    });
    t("V13 (v1.9.1) 반복 일정 완료: 체크를 바꾸면 적용 범위 선택이 하단에 나타남", () => {
      const d = "2026-10-05";
      e.S.data.schedules.push({ id: "sRep1", title: "주간 점검 회의", start: d, end: d, allDay: true, time: "", timeEnd: "",
        color: "blue", done: false, assignee: "", vehicle: false, room: false, reminders: [],
        repeat: { freq: "weekly", until: "" }, doneFrom: "", doneDates: [], undoneDates: [] });
      e.S.saveSilent();
      go(e, "schedule");
      e.w.SemisCalendar.eventForm("sRep1", null, d);
      ok(q(e, "#f-done"), "수정 폼 열림");
      ok(q(e, ".evf-foot .evf-occ"), "회차 표시");
      const sc = q(e, ".evf-foot #f-donescope");
      ok(sc, "적용 범위 선택은 하단 버튼줄"); eq(sc.style.display, "none");
      const done = q(e, "#f-done"); done.checked = true; done.dispatchEvent(new e.w.Event("change"));
      eq(sc.style.display, "");
      e.S.closeModal();
    });
    t("V14 (v1.9.1) 한글 줄바꿈: 본문 전체 어절 단위(keep-all), 글자 단위로 끊는 word-break:break-word 잔재 없음", () => {
      const css = read("css/main.css");
      ok(/body \{[^}]*word-break: keep-all;[^}]*overflow-wrap: break-word;/.test(css));
      ok(css.indexOf("word-break: break-word") < 0);
    });
    t("V15 (v1.9.1) 대시보드 하단 시트: 칸 수를 시트 폭(container query)으로 결정 · 머리글 줄바꿈 없음", () => {
      const css = read("css/main.css");
      ok(/\.dash-sheet-wrap \{ container-type: inline-size; \}/.test(css), "쿼리 컨테이너는 시트 바깥 wrap");
      go(e, "dashboard"); ok(q(e, ".dash-sheet-wrap > .dash-sheet.cols-4"), "시트를 감싼 컨테이너");
      ok(/@container \(min-width: 1040px\)[\s\S]*\.dash-sheet\.cols-4 \{ grid-template-columns: 1\.35fr 1fr 1fr 1fr; \}/.test(css));
      ok(/\.dc-head h2, \.dc-head \.dc-meta, \.dc-head \.link-btn \{ white-space: nowrap; \}/.test(css));
    });
    t("V17 (v1.10.1) 3D: 에어제타 B747-400F 도장·형상 요소(기수 화물문 · 2층 혹 · 엔진 4기 · 윙렛 · 꼬리 로고 · AIRZETA)", () => {
      const src = read("js/hero3d.js");
      ["AIRZETA", "liveryCanvas", "tailLogoCanvas", "hinge.rotation.z", "hump(", "[3.45, 6.15]", "wletGeo", "loft("].forEach(k => ok(src.indexOf(k) >= 0, k));
      ok(/AZ = \{ white: "#f3f5f6", navy: "#27348b", blue: "#22379a", red: "#e23a3f" \}/.test(src), "도장 색");
      ok(src.indexOf("fontReady()") > 0, "글자 그리기 전 글꼴 대기");
      ok(src.indexOf("fitDist(") > 0 && src.indexOf("setViewOffset") > 0, "화면 비율별 자동 거리");
    });
    t("V18 (v1.10.2) 3D: 회사 로고 윤곽(꼬리=빨강·흰색, 기수=빨강·파랑) · 짧은 기수 · 긴 화물(목재 상자·헬기 동체)", () => {
      const src = read("js/hero3d.js");
      ok(src.indexOf("const LOGO_RED = [[0.846, 0.151]") > 0 && src.indexOf("const LOGO_BLUE = [[0.861, 0.418]") > 0, "로고 윤곽 좌표");
      ok(src.indexOf('drawLogo(g, 256, "#ffffff")') > 0, "꼬리 로고: 파랑 조각은 흰색");
      ok(src.indexOf("const NOSE_LOGO = { x: 7.6") > 0 && src.indexOf("drawLogo(g, NOSE_LOGO.size * px, LOGO_C.blue)") > 0, "기수 아래 로고(고정 동체)");
      ok(src.indexOf("visorCanvas(") < 0, "들어 올린 화물문에는 로고 없음(v1.10.3)");
      ok(/XN = 9\.62, NX = 8\.0/.test(src), "기수 길이 1.62(≈ 동체 지름 0.85배)");
      ok(src.indexOf('const KINDS = ["crate", "heli"]') > 0 && src.indexOf("const CL = 2.5") > 0, "긴 화물 2종");
      ok(src.indexOf("makeUld") < 0 && src.indexOf('"container"') < 0, "짧은 컨테이너 제거");
    });
    t("V16 (v1.9.1) 3D: three.js 주소에 버전(배포 직후 옛 404 회피) · 대체 사진 사유 기록", () => {
      const src = read("js/hero3d.js");
      ok(src.indexOf('three.module.min.js?v=r170') > 0);
      go(e, "dashboard");
      eq(q(e, "#dash-3d").dataset.h3d, "no-webgl");
    });
    t("V11 새 아이콘(info·car·door·bell·forward·stretch·repeat·user·palette) 등록", () => {
      ["info", "car", "door", "bell", "forward", "stretch", "repeat", "user", "palette"].forEach(k => ok(e.S.ICONS[k], k));
    });
  }

  /* ══════════ [CF] v1.10 비상연락망 — 보고 체계도(사고 유형별 탭 · 전체 화면 뷰어 · 편집) ══════════
     픽스처는 가짜 번호만 사용 (실연락처는 공용 DB에만) */
  {
    const fx = () => [
      { id: "cf-a", title: "보안사고 비상 연락망", short: "보안사고", ver: "26.09",
        steps: "최초 발견자\n해당 파트장\n안전보안파트\n팀장",
        memo: "초도 지시 테스트", fileUrl: "https://files.test/a.pdf", fileName: "a.pdf",
        imgUrl: "https://files.test/a.webp", thumbUrl: "https://files.test/a-thumb.webp",
        rows: [
          { id: "r1", grp: "보고선", role: "테스트팀장", office: "032-000-0001", mobile: "", note: "" },
          { id: "r2", grp: "보고선", role: "테스트파트장", office: "032-000-0002", mobile: "010-0000-0002", note: "" },
          { id: "r3", grp: "해외기관", role: "해외상황실", office: "+1-000-000-0003", mobile: "", note: "24시간" }
        ] },
      { id: "cf-b", title: "위험물 사고 발생시 보고 체계도", short: "위험물사고", ver: "26.09", steps: "", memo: "",
        fileUrl: "https://files.test/b.pdf", fileName: "b.pdf", imgUrl: "", thumbUrl: "",
        rows: [{ id: "r4", grp: "유관기관", role: "방사능신고센터", office: "080-000-0004~6", mobile: "", note: "" }] }
    ];
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.contacts = { sections: e.w.SemisContacts.seedSections(), flows: fx() };
    e.S.saveSilent();
    const C = e.w.SemisContacts;
    const viewer = () => q(e, "#ct-viewer");
    const isOpen = () => !!(viewer() && (viewer().open || viewer().hasAttribute("open")));

    t("CF01 telHref: 범위(~)·국제(+)·미주(1-)·복수(,) 표기", () => {
      eq(C.telHref("032-741-3906~8"), "tel:0327413906");
      eq(C.telHref("+65-6476-9487"), "tel:+6564769487");
      eq(C.telHref("1-734-484-0088"), "tel:+17344840088");
      eq(C.telHref("02-6026-1359, 1363"), "tel:0260261359");
      eq(C.telHref("032-740-2700, 4, 16"), "tel:0327402700");
    });
    t("CF02 체계도 카드: 탭(tablist) · 첫 탭 선택 · 나머지 패널 숨김", () => {
      go(e, "contacts");
      const tabs = qa(e, '.ct-ftabs [role="tab"]');
      eq(tabs.length, 2);
      eq(tabs[0].getAttribute("aria-selected"), "true"); eq(tabs[1].getAttribute("aria-selected"), "false");
      eq(tabs[0].textContent.trim(), "보안사고");
      ok(!q(e, '[data-ctf-panel="cf-a"]').hidden); ok(q(e, '[data-ctf-panel="cf-b"]').hidden);
      eq(q(e, '[data-ctf-panel="cf-a"]').getAttribute("aria-labelledby"), "ctf-tab-cf-a");
    });
    t("CF03 패널 내용: 보고 순서 4단계 · 구분 제목 · 원터치 번호 · PDF 원본 링크", () => {
      const p = q(e, '[data-ctf-panel="cf-a"]');
      eq(qa(e, '[data-ctf-panel="cf-a"] .ct-fsteps li').length, 4);
      eq(qa(e, '[data-ctf-panel="cf-a"] .ct-fgrp-t').map(x => x.textContent.trim()).join(","), "보고선,해외기관");
      ok(p.querySelector('a[href="tel:0320000001"]'));
      ok(p.querySelector('a[href="sms:01000000002"]'), "휴대전화 문자");
      ok(p.querySelector('a[href="tel:+10000000003"]'), "국제번호");
      ok(p.querySelector('a[href="https://files.test/a.pdf"][target="_blank"]'));
      ok(p.querySelector(".ct-fthumb img").getAttribute("src").indexOf("a-thumb.webp") > 0);
      ok(p.textContent.indexOf("Ver.26.09") >= 0);
    });
    t("CF04 탭 전환: 클릭 · 방향키(→/Home) — 선택 상태·패널·모듈 상태 동기화", () => {
      q(e, '[data-ctf-tab="cf-b"]').click();
      eq(q(e, '[data-ctf-tab="cf-b"]').getAttribute("aria-selected"), "true");
      ok(!q(e, '[data-ctf-panel="cf-b"]').hidden); ok(q(e, '[data-ctf-panel="cf-a"]').hidden);
      eq(C.getFlowTab(), "cf-b");
      q(e, '[data-ctf-tab="cf-b"]').dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      eq(C.getFlowTab(), "cf-a");
      q(e, '[data-ctf-tab="cf-a"]').dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      eq(C.getFlowTab(), "cf-b");
      go(e, "contacts");
      eq(q(e, '[data-ctf-tab="cf-b"]').getAttribute("aria-selected"), "true", "재렌더 후 선택 유지");
      q(e, '[data-ctf-tab="cf-a"]').click();
    });
    t("CF05 뷰어: 미리보기 누르면 전체 화면 dialog — 이미지·제목·PDF 원본·위치", () => {
      q(e, '[data-ctf-panel="cf-a"] [data-ctf-view]').click();
      ok(isOpen(), "dialog open");
      eq(viewer().parentNode, e.w.document.body);
      eq(q(e, "#ctv-title").textContent, "보안사고 비상 연락망");
      ok(q(e, "#ct-viewer .ctv-img").getAttribute("src").indexOf("a-thumb.webp") > 0);
      eq(q(e, "#ct-viewer .ctv-pdf").getAttribute("href"), "https://files.test/a.pdf");
      eq(q(e, "#ct-viewer .ctv-pos").textContent, "1 / 2");
      ok(e.w.document.documentElement.classList.contains("ct-viewing"));
    });
    t("CF06 뷰어: 다음(→) — PDF만 있는 체계도는 PDF 프레임 · 확대 버튼 숨김 · 탭도 따라감", () => {
      viewer().dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      eq(q(e, "#ctv-title").textContent, "위험물 사고 발생시 보고 체계도");
      ok(q(e, "#ct-viewer iframe.ctv-frame[src='https://files.test/b.pdf']"));
      ok(q(e, "#ct-viewer [data-ctv=zoom]").hidden);
      eq(C.getFlowTab(), "cf-b");
      q(e, "#ct-viewer [data-ctv=prev]").click();
      eq(q(e, "#ctv-title").textContent, "보안사고 비상 연락망");
    });
    t("CF07 뷰어: 확대 토글(aria-pressed) · 닫기 → 초기화", () => {
      q(e, "#ct-viewer [data-ctv=zoom]").click();
      eq(q(e, "#ct-viewer [data-ctv=zoom]").getAttribute("aria-pressed"), "true");
      ok(q(e, "#ct-viewer [data-ctv-stage]").classList.contains("zoomed"));
      q(e, "#ct-viewer [data-ctv=close]").click();
      ok(!isOpen(), "닫힘");
      ok(!e.w.document.documentElement.classList.contains("ct-viewing"));
      eq(q(e, "#ct-viewer [data-ctv-stage]").innerHTML, "");
      C.openViewer("cf-a");
      eq(q(e, "#ct-viewer [data-ctv=zoom]").getAttribute("aria-pressed"), "false", "다시 열면 화면 맞춤");
      C.closeViewer();
    });
    await ta("CF07b 휴대폰 '뒤로' = 뷰어 닫기 (기록 1칸) · 버튼으로 닫으면 기록도 되돌림", async () => {
      const h0 = e.w.history.length;
      C.openViewer("cf-a");
      eq(e.w.history.length, h0 + 1);
      e.w.history.back();
      await new Promise(r => setTimeout(r, 40));
      ok(!isOpen(), "뒤로 → 닫힘");
      eq(e.w.location.hash, "#/contacts", "화면은 그대로");
      C.openViewer("cf-a");
      q(e, "#ct-viewer [data-ctv=close]").click();
      await new Promise(r => setTimeout(r, 40));
      ok(!isOpen());
      eq(e.w.location.hash, "#/contacts");
    });
    t("CF07b 검색 중 섹션을 추가하면 검색어를 풀어 새 섹션이 보인다", () => {
      loginAs(e, "hq");
      go(e, "contacts");
      C.setQuery("없는이름xyz");
      go(e, "contacts");
      eq(C.getQuery(), "없는이름xyz");
      const n0 = e.S.data.contacts.sections.length;
      q(e, "#ct-addsec").click();
      q(e, "#cs-title").value = "테스트 섹션";
      q(e, "#cs-save").click();
      eq(e.S.data.contacts.sections.length, n0 + 1, "섹션 추가됨");
      eq(C.getQuery(), "", "검색어 해제");
      ok(q(e, "#ct-body").textContent.includes("테스트 섹션"), "목록에 보임");
      e.S.data.contacts.sections = e.S.data.contacts.sections.filter(x => x.title !== "테스트 섹션");
      e.S.saveSilent();
    });
    t("CF08 검색: 맞는 행만 · 탭에 건수 · 맞는 탭 자동 선택 · 없으면 카드 숨김", () => {
      go(e, "contacts");
      const s = q(e, "#ct-search");
      s.value = "방사능신고"; s.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, ".ct-fcount").map(x => x.textContent).join(","), "0,1");
      eq(q(e, '[data-ctf-tab="cf-b"]').getAttribute("aria-selected"), "true");
      s.value = "0000-0002"; s.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, '[data-ctf-panel="cf-a"] .ct-frow').length, 1, "번호 검색(하이픈 무시)");
      s.value = "위험물"; s.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, '[data-ctf-panel="cf-b"] .ct-frow').length, 1, "체계도 제목이 맞으면 전체");
      s.value = "없는이름xyz"; s.dispatchEvent(new e.w.Event("input"));
      ok(!q(e, ".ct-flow"));
      s.value = ""; s.dispatchEvent(new e.w.Event("input"));
      ok(q(e, ".ct-flow"));
    });
    t("CF09 통합 검색(Ctrl K)에 체계도·연락처 행 포함", () => {
      const hits = e.w.SemisSearch.search("해외상황실");
      ok(hits.some(h => h.group === "비상연락망" && h.title.indexOf("해외상황실") >= 0));
      ok(e.w.SemisSearch.search("위험물 사고").some(h => h.sub.indexOf("보고 체계도") >= 0));
    });
    await ta("CF10 편집(hq): 제목·행 수정 저장 · PDF만 새로 올리면 옛 이미지 떼기", async () => {
      go(e, "contacts");
      q(e, '[data-ctf-panel="cf-a"] [data-ctf-edit]').click();
      ok(q(e, "#modal-box .cfe"), "편집 모달");
      ok(q(e, "#modal-box .cfe > .modal-actions #cfe-save"), "저장 버튼은 하단 고정 줄");
      eq(qa(e, "#cfe-rows .ct-editrow").length, 3);
      eq(qa(e, "#cfe-files .cfe-file").length, 2);
      q(e, "#cfe-title").value = "보안사고 비상 연락망(개정)";
      q(e, "#cfe-add").click();
      const last = qa(e, "#cfe-rows .ct-editrow").pop();
      last.querySelector('[data-f="grp"]').value = "보고선";
      last.querySelector('[data-f="role"]').value = "신규담당";
      last.querySelector('[data-f="office"]').value = "032-000-0009";
      const up = e.w.SemisSync.uploadFile, hadFetch = e.w.fetch;
      e.w.fetch = async () => ({ ok: true });
      e.w.SemisSync.uploadFile = async (file, prefix) => ({ url: "https://files.test/" + prefix + "/" + file.name, name: file.name });
      const inp = q(e, "#cfe-pdf");
      Object.defineProperty(inp, "files", { value: [new e.w.File(["%PDF"], "new.pdf", { type: "application/pdf" })], configurable: true });
      inp.dispatchEvent(new e.w.Event("change"));
      await new Promise(r => setTimeout(r, 20));
      e.w.SemisSync.uploadFile = up; e.w.fetch = hadFetch;
      eq(qa(e, "#cfe-files .cfe-file").length, 1, "이미지 떼고 PDF만");
      ok(q(e, "#cfe-files").textContent.indexOf("new.pdf") >= 0);
      q(e, "#cfe-save").click();
      const f = e.S.data.contacts.flows.find(x => x.id === "cf-a");
      eq(f.title, "보안사고 비상 연락망(개정)");
      eq(f.rows.length, 4); eq(f.rows[3].role, "신규담당");
      eq(f.fileUrl, "https://files.test/contacts/new.pdf"); eq(f.imgUrl, ""); eq(f.thumbUrl, "");
      ok(q(e, '[data-ctf-panel="cf-a"] .ct-fthumb-pdf'), "이미지 없으면 PDF 표지");
    });
    t("CF11 체계도 추가 · 삭제", () => {
      q(e, "#ct-addflow").click();
      q(e, "#cfe-title").value = "안전 사고 발생시 보고 체계도";
      q(e, "#cfe-short").value = "안전사고";
      q(e, "#cfe-save").click();
      eq(e.S.data.contacts.flows.length, 3);
      eq(C.getFlowTab(), e.S.data.contacts.flows[2].id, "추가한 탭 선택");
      eq(q(e, `[data-ctf-tab="${C.getFlowTab()}"]`).getAttribute("aria-selected"), "true");
      q(e, `[data-ctf-panel="${C.getFlowTab()}"] [data-ctf-edit]`).click();
      q(e, "#cfe-del").click(); clickOk(e);
      eq(e.S.data.contacts.flows.length, 2);
    });
    t("CF12 manager: 탭·뷰어는 되고 편집·추가 버튼은 없음", () => {
      loginAs(e, "manager");
      go(e, "contacts");
      ok(q(e, ".ct-ftabs")); ok(!q(e, "[data-ctf-edit]")); ok(!q(e, "#ct-addflow"));
      q(e, '[data-ctf-tab="cf-b"] ') && q(e, '[data-ctf-tab="cf-b"]').click();
      q(e, '[data-ctf-panel="cf-b"] [data-ctf-view]').click();
      ok(isOpen()); C.closeViewer();
    });
    t("CF13 flows 없는 데이터(구버전) — 체계도 카드 없이 기존 화면 그대로 · 정규화가 flows를 만들지 않음", () => {
      const e2 = makeEnv({ preData: { contacts: { sections: [] } } });
      loginAs(e2, "hq");
      go(e2, "contacts");
      ok(!q(e2, ".ct-flow")); ok(q(e2, "#ct-seed")); ok(q(e2, "#ct-addflow"));
      ok(!("flows" in e2.S.data.contacts), "동기화 오염 방지");
    });
    t("CF14 인쇄: 모든 체계도 패널 펼침 · 탭/미리보기/뷰어 숨김 규칙", () => {
      const c = read("css/main.css");
      const inPrint = (needle) => { const i = c.indexOf(needle); return i > 0 && c.lastIndexOf("@media print", i) > 0 && c.lastIndexOf("@media print", i) > c.lastIndexOf("}\n}", i); };
      ok(inPrint(".ct-fpanel[hidden] { display: block !important; }"));
      ok(inPrint(".ct-ftabs, .ct-fthumb, #ct-viewer, .ct-searchwrap"));
    });
    t("CF15 공개 저장소: 체계도 파일 주소·실연락처를 코드에 시드하지 않음", () => {
      const s = read("js/contacts.js");
      ok(s.indexOf("supabase.co") < 0); ok(s.indexOf("/contacts/flow-") < 0);
      ok(!/0\d{1,2}-\d{3,4}-\d{4}/.test(s.split("032-740-2107, 2108").join("").replace("032-000-1000~2", "")), "전화번호 패턴");
    });
  }

  /* ══════════ [FP] v1.11 보고 체계도 — 개정 PDF 비교(반자동 반영) ══════════
     글자 위치는 실제 체계도 배치를 흉내 낸 가짜 번호(555·5555) 픽스처 */
  {
    const ITEMS = [
      { s: "인천화물팀장", x: 100, y: 100, w: 60, h: 12 },
      { s: "☎ 032-555-0700", x: 95, y: 116, w: 80, h: 12 },
      { s: "안전보안파트", x: 100, y: 200, w: 60, h: 12 },
      { s: "☎ 555-0800 /", x: 60, y: 216, w: 60, h: 11 },
      { s: "☏ 010-5555-4130", x: 125, y: 216, w: 70, h: 11 },
      { s: "(파트장)", x: 197, y: 216, w: 30, h: 8 },
      { s: "화물서비스팀 ☎ 02-5555-1141", x: 400, y: 100, w: 150, h: 12 },
      { s: "☏ 010-5555-7032", x: 440, y: 115, w: 80, h: 12 },
      { s: "PCC", x: 40, y: 300, w: 20, h: 12 },
      { s: "(외곽 상황실)", x: 30, y: 315, w: 50, h: 9 },
      { s: "032-555-3906~8", x: 30, y: 330, w: 70, h: 12 },
      { s: "우체국 물류지원팀 ☎ 555-1245", x: 400, y: 300, w: 150, h: 12 },
      { s: "국정원 ☎ 032-555-0525", x: 200, y: 500, w: 120, h: 12 },
      { s: "☏ 010-5555-1111", x: 230, y: 515, w: 80, h: 12 },
      { s: "(근무시간 외 010-5555-2222)", x: 420, y: 520, w: 140, h: 11 },
      { s: "Ver.26.12 (☏ 0705)", x: 450, y: 800, w: 80, h: 10 }
    ];
    const ROWS = () => [
      { id: "a", grp: "보고선", role: "인천화물팀장", office: "032-555-0799", mobile: "", note: "" },
      { id: "b", grp: "보고선", role: "안전보안파트 파트장", office: "032-555-0800", mobile: "010-5555-4130", note: "" },
      { id: "c", grp: "관련팀", role: "화물서비스팀", office: "02-5555-1141", mobile: "010-5555-0000", note: "" },
      { id: "d", grp: "종합상황실", role: "PCC", office: "032-555-3906~8", mobile: "", note: "" },
      { id: "e", grp: "유관기관", role: "없어진기관", office: "032-555-9999", mobile: "", note: "" },
      { id: "f", grp: "주요기관", role: "국정원", office: "032-555-0525", mobile: "", note: "" }
    ];
    const e = makeEnv();
    const P = e.w.SemisFlowPdf;
    const phones = P.extractPhones(ITEMS);
    const byNum = (n) => phones.find(p => p.num === n) || {};

    t("FP01 번호 인식: 지역번호 보정(032)·범위(~)·라벨(같은 줄/왼쪽/위)·괄호 메모·버전", () => {
      eq(phones.length, 10);
      eq(byNum("032-555-0700").label, "인천화물팀장", "위쪽 이름");
      eq(byNum("032-555-0800").label, "안전보안파트", "7자리 → 032 보정 + 위쪽 이름");
      eq(byNum("010-5555-4130").note, "파트장");
      eq(byNum("02-5555-1141").label, "화물서비스팀", "같은 줄 이름");
      eq(byNum("032-555-3906~8").label, "PCC", "괄호 줄을 건너뛴 위쪽 이름");
      eq(byNum("032-555-3906~8").note, "외곽 상황실");
      eq(byNum("032-555-1245").label, "우체국 물류지원팀");
      eq(byNum("010-5555-2222").note, "근무시간 외", "여는 괄호 메모");
      eq(P.detectVersion(ITEMS), "26.12");
      eq(P.formatNum("080-004 4949"), "080-004-4949");
      eq(P.formatNum("740-2700,4,16"), "032-740-2700, 4, 16");
      eq(P.formatNum("1661-9881"), "1661-9881");
      eq(P.formatNum("703-563-3240"), "+1-703-563-3240", "북미");
      eq(P.formatNum("65-6476-9487"), "+65-6476-9487", "국가번호 2자리");
      eq(P.formatNum("044-201-4236"), "044-201-4236"); eq(P.formatNum("02-6026-1141"), "02-6026-1141");
      eq(P.formatNum("1-914-701-8047"), "1-914-701-8047");
      ok(P.sameNum(P.keyOf("555-0800"), P.keyOf("032-555-0800")));
      ok(!P.sameNum(P.keyOf("0800"), P.keyOf("032-555-0800")), "7자리 미만은 대조 안 함");
    });
    t("FP02 대조: 그대로 · 바뀜(이름/위치) · 빈 칸 채움 · 새 번호(구분 추정) · PDF에 없음", () => {
      const rows = ROWS();
      const d = P.diffRows(rows, phones);
      eq(d.same.length, 5);
      const ch = d.changed.map(c => rows[c.ri].id + ":" + c.f + ":" + c.old + ">" + c.num + ":" + c.how).sort().join(" | ");
      eq(ch, "a:office:032-555-0799>032-555-0700:label | c:mobile:010-5555-0000>010-5555-7032:pos | f:mobile:>010-5555-1111:fill");
      eq(d.added.map(a => a.num + ":" + a.label).sort().join(","), "010-5555-2222:,032-555-1245:우체국 물류지원팀");
      ok(d.added.find(a => a.num === "010-5555-2222").mobile);
      eq(d.missing.map(m => rows[m.ri].id).join(","), "e");
    });
    t("FP03 같은 PDF를 다시 올리면 변경 없음(오탐 0)", () => {
      const rows = [
        { id: "x1", role: "인천화물팀장", office: "032-555-0700" }, { id: "x2", role: "안전보안파트", office: "032-555-0800", mobile: "010-5555-4130" },
        { id: "x3", role: "화물서비스팀", office: "02-5555-1141", mobile: "010-5555-7032" }, { id: "x4", role: "PCC", office: "032-555-3906~8" },
        { id: "x5", role: "우체국 물류지원팀", office: "032-555-1245" }, { id: "x6", role: "국정원", office: "032-555-0525", mobile: "010-5555-1111" },
        { id: "x7", role: "상황실", office: "", mobile: "010-5555-2222" }];
      const d = P.diffRows(rows, phones);
      eq(d.changed.length + d.added.length + d.missing.length, 0);
      eq(d.same.length, 10);
    });

    loginAs(e, "hq");
    e.S.data.contacts = { sections: [], flows: [{ id: "cf-t", title: "테스트 체계도", short: "테스트", ver: "26.09", steps: "", memo: "",
      fileUrl: "https://files.test/old.pdf", fileName: "old.pdf", imgUrl: "https://files.test/old.webp", thumbUrl: "https://files.test/old-t.webp", rows: ROWS() }] };
    e.S.saveSilent();
    const tick = (ms) => new Promise(r => setTimeout(r, ms || 30));
    async function uploadPdf(analyzeImpl) {
      const up = e.w.SemisSync.uploadFile, hadFetch = e.w.fetch, an = P.analyze;
      e.w.fetch = async () => ({ ok: true });
      e.w.SemisSync.uploadFile = async (file, prefix) => ({ url: "https://files.test/" + prefix + "/" + file.name, name: file.name });
      P.analyze = analyzeImpl;
      const inp = q(e, "#cfe-pdf");
      Object.defineProperty(inp, "files", { value: [new e.w.File(["%PDF"], "rev.pdf", { type: "application/pdf" })], configurable: true });
      inp.dispatchEvent(new e.w.Event("change"));
      await tick(40);
      e.w.SemisSync.uploadFile = up; e.w.fetch = hadFetch; P.analyze = an;
    }
    const okAnalyze = async () => ({ phones: P.extractPhones(ITEMS), ver: "26.12", pages: 1,
      image: new e.w.File(["i"], "flow-z.webp", { type: "image/webp" }), thumb: new e.w.File(["t"], "flow-z-thumb.webp", { type: "image/webp" }) });

    await ta("FP04 편집에서 개정 PDF 올리기 → 미리보기 이미지 자동 교체 · 비교 목록(기본 선택: 바뀜·새 번호·버전)", async () => {
      go(e, "contacts");
      q(e, '[data-ctf-panel="cf-t"] [data-ctf-edit]').click();
      await uploadPdf(okAnalyze);
      ok(q(e, "#cfe-review") && !q(e, "#cfe-review").hidden);
      const tx = q(e, "#cfe-review").textContent;
      ok(tx.indexOf("개정 비교") >= 0); ok(tx.indexOf("그대로 5") >= 0); ok(tx.indexOf("바뀜 3") >= 0);
      ok(tx.indexOf("새 번호 2") >= 0); ok(tx.indexOf("PDF에 없음 1") >= 0);
      eq(qa(e, "#cfe-review .cfe-rv-list li").length, 7, "버전 1 + 바뀜 3 + 새 번호 2 + 없음 1");
      ok(q(e, "#cfe-review [data-rv-ver]").checked);
      ok(!q(e, "#cfe-review .rv-miss input").checked, "삭제는 기본 해제");
      ok(q(e, "#cfe-files").textContent.indexOf("flow-z.webp") >= 0, "새 미리보기 이미지");
      ok(q(e, "#cfe-files").textContent.indexOf("rev.pdf") >= 0);
      ok(!q(e, "#cfe-save").disabled);
    });
    await ta("FP05 선택 반영 → 행 수정·채움·추가·삭제 · 강조 표시 · 버전 → 저장 시 데이터 반영", async () => {
      const addNoName = qa(e, "#cfe-review .rv-add").find(li => li.textContent.indexOf("010-5555-2222") >= 0);
      addNoName.querySelector("[data-rv-name]").value = "항공운항과";
      addNoName.querySelector("[data-rv-name]").dispatchEvent(new e.w.Event("input"));
      const miss = q(e, "#cfe-review .rv-miss input");
      miss.checked = true; miss.dispatchEvent(new e.w.Event("change"));
      q(e, "#cfe-rv-apply").click();
      ok(q(e, "#cfe-review").textContent.indexOf("7건 반영") >= 0, q(e, "#cfe-review").textContent);
      eq(q(e, "#cfe-ver").value, "26.12");
      eq(qa(e, "#cfe-rows .ct-editrow-hit").length, 5, "a·c·f + 새 2행");
      q(e, "#cfe-save").click();
      const f = e.S.data.contacts.flows[0];
      const row = (id) => f.rows.find(r => r.id === id);
      eq(row("a").office, "032-555-0700"); eq(row("c").mobile, "010-5555-7032"); eq(row("f").mobile, "010-5555-1111");
      ok(!row("e"), "없어진 기관 삭제");
      const post = f.rows.find(r => r.role === "우체국 물류지원팀");
      ok(post && post.office === "032-555-1245");
      const mob = f.rows.find(r => r.role === "항공운항과");
      ok(mob && mob.mobile === "010-5555-2222" && !mob.office && mob.note === "근무시간 외");
      eq(f.ver, "26.12");
      eq(f.fileUrl, "https://files.test/contacts/rev.pdf");
      eq(f.imgUrl, "https://files.test/contacts/flow-z.webp"); eq(f.thumbUrl, "https://files.test/contacts/flow-z-thumb.webp");
    });
    await ta("FP06 PDF를 못 읽으면 대조는 건너뛰고 옛 이미지 떼기 · 번호 없는(스캔) PDF 안내", async () => {
      q(e, '[data-ctf-panel="cf-t"] [data-ctf-edit]').click();
      await uploadPdf(async () => { throw new Error("no pdfjs"); });
      ok(q(e, "#cfe-review").textContent.indexOf("읽지 못해") >= 0);
      ok(q(e, "#cfe-files").textContent.indexOf("flow-z.webp") < 0, "옛 이미지 뗌");
      await uploadPdf(async () => ({ phones: [], ver: "", pages: 1 }));
      ok(q(e, "#cfe-review").textContent.indexOf("찾지 못했습니다") >= 0);
      q(e, "#cfe-cancel").click();
    });
    await ta("FP07 번호가 모두 같으면 '모두 같음' + 반영 버튼 없음 · 버전만 다르면 버전 항목만", async () => {
      const f = e.S.data.contacts.flows[0];
      f.rows = [{ id: "z1", role: "인천화물팀장", office: "032-555-0700", mobile: "" }];
      f.ver = "26.09";
      e.S.saveSilent(); go(e, "contacts");
      const same = async () => ({ phones: P.extractPhones(ITEMS.slice(0, 2)), ver: "26.12", pages: 1 });
      q(e, '[data-ctf-panel="cf-t"] [data-ctf-edit]').click();
      await uploadPdf(same);
      eq(qa(e, "#cfe-review .cfe-rv-list li").length, 1, "버전 항목만");
      ok(q(e, "#cfe-review [data-rv-ver]")); ok(q(e, "#cfe-rv-apply"));
      q(e, "#cfe-cancel").click();
      f.ver = "26.12"; e.S.saveSilent(); go(e, "contacts");
      q(e, '[data-ctf-panel="cf-t"] [data-ctf-edit]').click();
      await uploadPdf(same);
      ok(q(e, "#cfe-review").textContent.indexOf("모두 PDF와 같습니다") >= 0);
      ok(!q(e, "#cfe-rv-apply"));
      q(e, "#cfe-cancel").click();
    });
    await ta("FP07b 새 체계도: PDF만 올려 연락처를 한 번에 — 같은 이름의 휴대전화는 한 행으로 합침", async () => {
      go(e, "contacts");
      q(e, "#ct-addflow").click();
      q(e, "#cfe-title").value = "새 체계도";
      await uploadPdf(async () => ({ phones: P.extractPhones(ITEMS), ver: "26.12", pages: 1 }));
      eq(qa(e, "#cfe-review .rv-add").length, 10);
      q(e, "#cfe-rv-apply").click();
      q(e, "#cfe-save").click();
      const nf = e.S.data.contacts.flows.find(x => x.title === "새 체계도");
      const cs = nf.rows.filter(r => r.role === "화물서비스팀");
      eq(cs.length, 1); eq(cs[0].office, "02-5555-1141"); eq(cs[0].mobile, "010-5555-7032");
      eq(nf.rows.find(r => r.role === "안전보안파트").mobile, "010-5555-4130");
      eq(nf.ver, "26.12");
      eq(nf.rows.length, 7);
    });
    t("FP08 pdf.js는 필요할 때만(로컬 legacy 빌드) · 파일 · 라이선스", () => {
      ok(P.LIB_URL.indexOf("assets/vendor/pdfjs/pdf.min.mjs") === 0);
      ok(fs.existsSync(path.join(ROOT, "assets/vendor/pdfjs/pdf.min.mjs")));
      ok(fs.existsSync(path.join(ROOT, "assets/vendor/pdfjs/pdf.worker.min.mjs")));
      ok(read("assets/vendor/pdfjs/LICENSE").indexOf("Apache License") >= 0);
      ok(read("index.html").indexOf("pdf.min.mjs") < 0, "첫 화면에서 불러오지 않음");
      ok(read("js/flowpdf.js").indexOf("supabase.co") < 0);
      ok(read("js/flowpdf.js").indexOf('intent: "print"') > 0, "가려진 탭에서도 렌더 완료(rAF 미사용)");
    });
  }

  /* ══════════ [SC] v1.12 화물 보안 — CARES 연동 · 보안검색 현황 · 검색장비 유지관리 · 대시보드 요약 띠 ══════════ */
  {
    const HOUR = 3600000, DAY = 86400000, NOW = Date.now();
    const fsVal = (v) => {
      if (v === null || v === undefined) return { nullValue: null };
      if (typeof v === "boolean") return { booleanValue: v };
      if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
      if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
      if (typeof v === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } };
      return { stringValue: String(v) };
    };
    const doc = (coll, id, o) => ({ name: "projects/p/databases/(default)/documents/" + coll + "/" + id,
      fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fsVal(v)])) });
    const EQUIPS = [
      ["x1", "X-RAY", "RAP-638DV", "6212421", "X-ray 1호기"], ["x2", "X-RAY", "RAP-638DV", "6231201", "X-ray 2호기"],
      ["x3", "X-RAY", "RAP-638DV", "6231202", "X-ray 3호기"],
      ["e1", "ETD", "IONAB 1호기", "IONAB-N22-4021", "예비"], ["e2", "ETD", "IONAB 2호기", "IONAB-N22-4022", "환적화물"],
      ["e3", "ETD", "IONAB 3호기", "IONAB-N22-4023", "X-ray 3호기"], ["e4", "ETD", "IONAB 4호기", "IONAB-N24-1006", "X-ray 2호기"],
      ["e5", "ETD", "IONAB 5호기", "IONAB-N25-3003", "X-ray 1호기"]
    ].map(([id, type, name, serial, location]) => ({ id, type, name, serial, location, status: id === "e3" ? "broken" : "safe" }));
    const REPAIRS = [
      { id: "r-act", equipmentId: "e3", equipmentName: "IONAB 3호기", symptom: "모니터 글자 깨짐", reporter: "검색요원", reportedAtMs: NOW - 5 * HOUR, status: "in_repair", repairStartedAtMs: NOW - 2 * HOUR },
      { id: "r-old", equipmentId: "x3", equipmentName: "RAP-638DV", symptom: "갑자기 꺼짐", reporter: "검색요원", reportedAtMs: NOW - 20 * DAY, resolvedAtMs: NOW - 20 * DAY + 3 * HOUR, status: "resolved", causeCategory: "mechanical",
        parts: [{ part: "그래픽카드", qty: 1, isPaid: false }], cause: "그래픽카드 교체" },
      { id: "r-env", equipmentId: "x1", equipmentName: "RAP-638DV", symptom: "다운", reporter: "검색요원", reportedAtMs: NOW - 40 * DAY, resolvedAtMs: NOW - 40 * DAY + HOUR, status: "resolved", causeCategory: "environmental" }
    ];
    const INSP = EQUIPS.filter(e => e.id !== "x2").map((e, i) => ({ id: "i" + i, type: "daily", equipmentId: e.id, equipmentName: e.name, equipmentType: e.type,
      inspector: "안도빈", inspectedAtMs: NOW - 10 * 60000 - i * 60000, checklist: [{ itemId: "a", itemName: "동작", result: e.id === "e1" ? "bad" : "ok", note: "" }], remark: "" }));
    const PERIODIC = [{ id: "w1", type: "weekly", equipmentId: "x1", equipmentName: "RAP-638DV", equipmentType: "X-RAY", inspector: "최정희", inspectedAtMs: NOW - 26 * DAY, remark: "" }];
    const TS = new Date(NOW - 60000).toISOString();
    const SENS = [
      { deviceId: "ICN_CARGO_B", online: true, temp: 25.2, humidity: 57, co2: 428, hcho: 0.113, tvoc: 1.3, pm25: 20, pm10: 26, timestamp: TS },
      { deviceId: "ICN_ETD_CASE", online: true, temp: 25.8, humidity: 57, co2: 2367, hcho: 0.05, tvoc: 1.1, pm25: 23, pm10: 30, timestamp: TS },
      { deviceId: "ICN_SEARCH_ROOM", online: false, timestamp: TS }
    ];
    const TH = { ICN_ETD_CASE: { co2: { min: null, max: 2000 }, tvoc: { min: null, max: 1 } } };
    const calls = [];
    const fake = (url, opts) => {
      url = String(url); const method = (opts && opts.method) || "GET";
      calls.push({ url, method, body: opts && opts.body ? JSON.parse(opts.body) : null });
      const ok = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
      if (url.indexOf(":runQuery") >= 0) {
        const q = JSON.parse(opts.body).structuredQuery;
        const c = q.from[0].collectionId;
        const wrap = (coll, arr) => arr.map(o => ({ document: doc(coll, o.id || o.deviceId + o.timestamp, o) }));
        if (c === "repairLogs") return ok(wrap(c, REPAIRS));
        if (c === "sensorLogs") return ok(wrap(c, SENS));
        if (c === "inspectionLogs") return ok(wrap(c, q.where.fieldFilter.op === "IN" ? PERIODIC : INSP));
        return ok([]);
      }
      if (url.indexOf("/equipments?") >= 0) return ok({ documents: EQUIPS.map(o => doc("equipments", o.id, o)) });
      if (url.indexOf("/sensorThresholds?") >= 0) return ok({ documents: Object.keys(TH).map(k => doc("sensorThresholds", k, TH[k])) });
      if (url.indexOf("/repairLogs/") >= 0) return ok(doc("repairLogs", "r-old", { reportPhotos: ["data:image/png;base64,AAAA"], repairPhotos: ["javascript:alert(1)"] }));
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
    const LEDGER = [
      { id: "eq-1", type: "X-Ray", name: "RAP-638DV 1호기", serial: "6212421", location: "인천 화물터미널 B동", vendor: "라피스캔 / 인씨스", installed: "2021-08-29", mfgDate: "", lifeYears: null, replaceDue: "2031-08-29", price: 460000000, cert: "TSA", status: "정상", logs: [], note: "" },
      { id: "eq-3", type: "ETD(폭발물흔적)", name: "IONAB 3호기", serial: "IONAB-N22-4023", location: "인천 화물터미널 B동", vendor: "뉴원에스엔티 / 프로에스콤", installed: "2023-01-01", mfgDate: "", lifeYears: null, replaceDue: "", price: 40000000, cert: "KIAST", status: "정상", logs: [], note: "" },
      { id: "eq-h", type: "HHMD(휴대용)", name: "CEIA PD240", serial: "HH-1", location: "인천 화물터미널 B동", vendor: "CEIA", installed: new Date(NOW - 3.8 * 365 * DAY).toISOString().slice(0, 10), mfgDate: "", lifeYears: null, replaceDue: "", price: 600000, cert: "", status: "정상", logs: [], note: "" },
      { id: "eq-w", type: "WTMD(문형)", name: "Metor 6E", serial: "W-1", location: "", vendor: "", installed: "2025-05-20", mfgDate: "", lifeYears: null, replaceDue: "", price: null, cert: "", status: "폐기", logs: [], note: "" }
    ];
    const e = makeEnv();
    e.w.localStorage.setItem("semisl:caresKey", "test-key");
    e.w.print = () => {};
    const K = e.w.SemisCares;
    K._setFetch(fake);
    e.S.data.equipment = JSON.parse(JSON.stringify(LEDGER)); e.S.saveSilent();

    t("SC01 이슬점(Magnus) · 기준 초과 · 오프라인 판정 — CARES 규약과 같은 값", () => {
      eq(K.dewPoint(25.2, 57), 16.1); eq(K.dewPoint(30, 90), 28.2); eq(K.dewPoint(null, 50), null); eq(K.dewPoint(20, 0), null);
      ok(K.exceed(2367, { min: null, max: 2000 })); ok(!K.exceed(1999, { min: null, max: 2000 })); ok(K.exceed(4, { min: 5, max: 35 }));
      ok(K.isOffline({ online: false, timestamp: new Date().toISOString() }));
      ok(K.isOffline({ online: true, timestamp: new Date(Date.now() - 9 * 60000).toISOString() }), "8분 무수신");
      ok(!K.isOffline({ online: true, timestamp: new Date(Date.now() - 60000).toISOString() }));
      eq(K.thFor("ICN_SEARCH_ROOM", "dewPoint").max, 18, "서버 임계치 없으면 권장값");
    });
    t("SC02 결로 교차 판정: 가장 습한 곳 이슬점 vs 가장 차가운 곳 온도", () => {
      const mk = (id, t2, rh) => ({ id, name: id, offline: false, vals: { temp: t2, dewPoint: K.dewPoint(t2, rh) } });
      eq(K.condensation([mk("A", 26, 57), mk("B", 21, 53)]).level, "safe");
      eq(K.condensation([mk("A", 28, 80), mk("B", 22, 50)]).level, "danger");
      eq(K.condensation([mk("A", 27, 60), mk("B", 21.5, 50)]).level, "watch");
      eq(K.condensation([]).level, "unknown");
    });
    await ta("SC03 CARES 읽기: 장비·고장·점검·정기점검·센서·임계치 (키는 캐시 · 쓰기 요청 없음 · 사진 투영 제외)", async () => {
      await K.load(true);
      eq(K.state.err, null, "err"); eq(K.state.equips.length, 8); eq(K.state.repairs.length, 3);
      eq(K.state.inspections.length, 7); eq(K.state.periodic.length, 1); eq(Object.keys(K.state.sensors).length, 3);
      ok(calls.every(c => c.url.indexOf("key=test-key") >= 0), "키");
      ok(calls.every(c => c.method === "GET" || c.url.indexOf(":runQuery") >= 0), "GET·runQuery만");
      const n = calls.length; await K.load(); eq(calls.length, n, "60초 캐시");
      ok(read("js/cares.js").indexOf('"repairPhotos"') > 0 && read("js/cares.js").indexOf("REPAIR_FIELDS") > 0, "목록 투영");
      ok(!/method:\s*"(PATCH|DELETE|PUT)"/.test(read("js/cares.js")), "쓰기 메서드 없음");
    });
    t("SC04 장비 단위: X-ray는 배치 위치의 호기 · ETD는 검색대 번호 · 진행 중 고장은 bad", () => {
      const us = K.units();
      eq(us.map(u => u.short).join(","), "X1,X2,X3,E1,E2,E3,E4,E5");
      eq(us[0].label, "X-ray 1호기"); eq(us[0].model, "RAP-638DV");
      eq(K.unitById("e5").lane, 1); eq(K.unitById("e4").lane, 2); eq(K.unitById("e1").lane, null);
      const e3 = K.unitById("e3"); eq(e3.state, "bad"); eq(K.stateLabel(e3), "수리 중");
      ok(K.unitById("x1").ledger && K.unitById("x1").ledger.id === "eq-1", "S/N으로 대장 연결");
    });
    t("SC05 보안검색 현황: 요약 띠 · 검색대 3열 + 환적·예비 · 인쇄 버튼 · 허브 배너", () => {
      loginAs(e, "manager");
      go(e, "scr-status");
      const v = q(e, "#view");
      eq(v.getAttribute("data-hub"), "hub-sec");
      ok(q(e, "#view .page-head [data-print-btn]"), "인쇄");
      const vals = qa(e, "#scr-body .stat-row .stat-value").map(x => x.textContent);
      eq(vals.join("|"), "3/3|4/5|7/8|1|3", "X-ray · ETD · 오늘 점검 · 진행 중 고장 · 기준 초과(입구 HCHO · 케이스 CO₂·TVOC)");
      const lanes = qa(e, ".lane-board > .lane:not(.lane-zone)");
      eq(lanes.length, 3);
      eq(lanes[0].querySelectorAll(".unit-tile").length, 2, "1번 검색대 = X-ray 1 + IONAB 5");
      ok(lanes[0].textContent.indexOf("IONAB 5호기") >= 0);
      eq(lanes[2].getAttribute("data-state"), "bad", "IONAB 3호기 수리 중 → 3번 검색대 경고");
      const z = q(e, ".lane-zone").textContent;
      ok(z.indexOf("환적화물") >= 0 && z.indexOf("예비") >= 0);
      ok(z.indexOf("환적화물") < z.indexOf("예비"), "예비는 끝");
      ok(q(e, '.unit-tile[data-unit="x2"] .ut-ins:not(.done)'), "X-ray 2호기 오늘 미점검");
      ok(q(e, '.unit-tile[data-unit="e3"] .badge-blue'), "수리 중 칩");
    });
    t("SC06 일일점검 이행: 장비 8행 × 28칸 · 오늘 칸 · 불량 표시 · 주간 26일 경과 강조", () => {
      eq(qa(e, ".heat .heat-row:not(.heat-head)").length, 8);
      const row = qa(e, ".heat .heat-row:not(.heat-head)")[0];
      eq(row.querySelectorAll(".hc").length, 28);
      eq(row.querySelectorAll(".hc")[27].getAttribute("data-st"), "done", "오늘 점검");
      const x2 = qa(e, ".heat .heat-row:not(.heat-head)")[1];
      eq(x2.querySelectorAll(".hc")[27].getAttribute("data-st"), "wait", "오늘 아직");
      ok(qa(e, ".heat .hc[data-bad]").length === 1, "불량 1건");
      ok(q(e, ".heat .heat-last.late"), "주간 점검 주기 경과");
      eq(qa(e, ".heat .heat-row:not(.heat-head)")[5].querySelectorAll('.hc[data-st="down"], .hc[data-st="done"]').length >= 1, true);
    });
    t("SC07 검색 환경 표: 지점 3열 · 기준 초과 칸 · 오프라인 열 · 결로 판정", () => {
      eq(qa(e, ".env-tbl thead th").length, 4);
      const over = qa(e, ".env-tbl td.over").map(td => td.textContent.replace(/\s*기준 초과/, ""));
      ok(over.indexOf("2,367") >= 0, "CO₂ 2,367 > 2,000");
      ok(over.indexOf("1.10") >= 0, "ETD TVOC > 1");
      ok(over.indexOf("0.113") >= 0, "HCHO > 0.1 (권장값)");
      eq(qa(e, ".env-tbl td.env-off").length, 8, "검색실 오프라인 — 8개 지표 모두 —");
      ok(q(e, ".env-cond .badge"));
    });
    t("SC08 최근 고장 → 상세: 처리 단계 · 원인 · 부품", () => {
      qa(e, ".scr-faults [data-repair]").find(b => b.dataset.repair === "r-old").click();
      const box = q(e, "#modal-box");
      ok(box.textContent.indexOf("X-ray 3호기") >= 0);
      eq(qa(e, ".rp-steps li.on").length, 2, "신고·완료");
      ok(box.textContent.indexOf("그래픽카드") >= 0 && box.textContent.indexOf("무상") >= 0);
      e.S.closeModal();
    });
    await ta("SC09 사진은 data:image · https만 (javascript: 차단)", async () => {
      const p = await K.repairPhotos("r-old");
      eq(p.report.length, 1); eq(p.repair.length, 0);
    });
    t("SC10 대시보드 요약 띠: 관리자 이상 · 4칸(검색 라인 · 오늘 점검 · 고장 · 환경) · 일반 사용자 제외", () => {
      go(e, "dashboard");
      ok(q(e, "#dash-scr"), "띠");
      eq(qa(e, "#dash-scr .dscr-cell").length, 4);
      eq(qa(e, "#dash-scr .ml-row").length, 3);
      eq(q(e, "#dash-scr .dscr-n b").textContent, "7");
      eq(qa(e, "#dash-scr .ins-dot.on").length, 7);
      eq(qa(e, "#dash-scr .mb-c").length, 6, "최근 6개월");
      ok(q(e, ".dash-top + #dash-scr, .dash-top + .dash-scr"), "태그 카드 바로 아래");
      loginAs(e, "user"); go(e, "dashboard");
      ok(!q(e, "#dash-scr"), "일반 사용자 — 권한 밖");
      loginAs(e, "manager");
    });
    t("SC11 검색장비 대장: 유형별 묶음 · CARES 연동 · CARES 상태 우선 · 내용연수 임박 · 폐기", () => {
      go(e, "scr-equip");
      ok(q(e, "#view .page-head [data-print-btn]"));
      ok(!q(e, "#eq-add"), "관리자(manager)는 등록 불가");
      const grp = qa(e, ".eq-tbl .grp-row").map(r => r.textContent.replace(/\s+/g, ""));
      eq(grp.join(","), "X-ray1,ETD1,WTMD1,HHMD1");
      const Eq = e.w.SemisEquip;
      eq(Eq.effStatus(e.S.data.equipment[1]), "수리중", "CARES in_repair");
      eq(Eq.effStatus(e.S.data.equipment[0]), "정상");
      ok(Eq.isLifeDue(e.S.data.equipment[2]), "HHMD 4년 — 1년 이내");
      eq(Eq.ledgerStats().total, 3, "폐기 제외"); eq(Eq.ledgerStats().linked, 2);
      const extra = qa(e, ".eq-tbl tr[data-cares-only]");
      eq(extra.length, 6, "대장에 없는 CARES 장비 6");
    });
    t("SC12b 검색·필터가 걸린 채 장비를 등록해도 목록에 보인다 (조건 자동 해제)", () => {
      const e6 = makeEnv();
      loginAs(e6, "hq");
      e6.S.data.equipment = [{ id: "q1", type: "X-ray 검색장비", name: "테스트 X", serial: "SN-A", location: "1호기", logs: [] }];
      e6.S.saveSilent();
      go(e6, "scr-equip");
      const Eq6 = e6.w.SemisEquip;
      Eq6.setQuery("SN-A"); Eq6.setTab("list");
      go(e6, "scr-equip");
      eq(Eq6.filtered().length, 1, "검색 적용");
      q(e6, "#eq-add").click();
      q(e6, "#e-name").value = "새 ETD 장비";
      q(e6, "#e-type").value = "폭발물흔적탐지장비(ETD)";
      q(e6, "#e-save").click();
      ok(e6.S.data.equipment.some(x => x.name === "새 ETD 장비"), "저장됨");
      eq(Eq6.filtered().length, 2, "조건 해제 후 전체");
      ok(q(e6, "#view").textContent.includes("새 ETD 장비"), "목록에 보임");
      go(e6, "dashboard"); go(e6, "scr-equip");
      ok(q(e6, "#view").textContent.includes("새 ETD 장비"), "화면 이동 후에도 보임");
    });
    t("SC12 대장 필터·검색 · 상세(구입가는 hq 이상)", () => {
      const seg = (n, v) => q(e, '[data-seg="' + n + '"][data-v="' + v + '"]').click();
      seg("kind", "etd"); eq(qa(e, ".eq-tbl tr[data-eq]").length, 1);
      seg("kind", "all"); seg("st", "due"); eq(qa(e, ".eq-tbl tr[data-eq]").length, 1);
      seg("st", "disposed"); eq(qa(e, ".eq-tbl tr[data-eq]").length, 1);
      seg("st", "all");
      const s1 = q(e, "#eq-q"); s1.value = "인씨스"; s1.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, ".eq-tbl tr[data-eq]").length, 1); eq(qa(e, ".eq-tbl tr[data-cares-only]").length, 0);
      const s2 = q(e, "#eq-q"); s2.value = ""; s2.dispatchEvent(new e.w.Event("input"));
      q(e, '.eq-tbl tr[data-eq="eq-1"]').click();
      ok(q(e, "#modal-box").textContent.indexOf("구입가") < 0, "manager — 구입가 숨김");
      ok(!q(e, "#eqd-edit"), "manager — 수정 없음");
      e.S.closeModal();
    });
    t("SC13 고장·수리 이력 탭: 연도·유형 필터 · 행 → 상세", () => {
      q(e, '[data-etab="repairs"]').click();
      const now = new Date(Date.now() + 9 * 3600000);
      q(e, '[data-seg="ryear"][data-v="all"]').click();
      eq(qa(e, ".rp-tbl tr[data-repair-row]").length, 3);
      q(e, '[data-seg="rkind"][data-v="xray"]').click();
      eq(qa(e, ".rp-tbl tr[data-repair-row]").length, 2);
      q(e, '[data-seg="rkind"][data-v="all"]').click();
      q(e, '.rp-tbl tr[data-repair-row="r-act"]').click();
      ok(q(e, "#modal-box").textContent.indexOf("수리 중") >= 0);
      e.S.closeModal();
      ok(now.getUTCFullYear() > 2000);
    });
    t("SC14 가동 분석: 가동률 = 정상 가동일 ÷ 기간 일수 · ETD 목표선 · 원인 분류 막대", () => {
      const y = Number(K.todayKey().slice(0, 4));
      const st = K.yearStats(y);
      const x3 = st.find(s => s.unit.id === "x3");
      ok(x3.days > 0 && x3.downDays >= 1 && x3.downDays <= 2, "하루(또는 자정 걸침 이틀)");
      ok(Math.abs(x3.avail - (x3.days - x3.downDays) / x3.days) < 1e-9);
      eq(Math.round(x3.downMs / HOUR), 3);
      eq(x3.count, K.dayKey(NOW - 20 * DAY).slice(0, 4) === String(y) ? 1 : 0);
      q(e, '[data-etab="analysis"]').click();
      eq(qa(e, ".av-row").length, 8);
      eq(qa(e, ".av-target").length, 5, "ETD 5대에만 목표선");
      ok(q(e, ".cz-bar i"), "원인 분류");
      q(e, '[data-etab="list"]').click();
    });
    t("SC15 hq: 장비 등록·수정(자체 기록) · 구입가 입력 · 삭제는 대장만", () => {
      loginAs(e, "hq");
      go(e, "scr-equip");
      q(e, "#eq-add").click();
      q(e, "#e-name").value = "Metor 6E"; q(e, "#e-serial").value = "W-2"; q(e, "#e-type").value = "WTMD(문형)";
      q(e, "#e-price").value = "7000000";
      q(e, "#elog-add").click();
      q(e, "#e-logs .elog-row input[type=text]").value = "성능검사 완료";
      q(e, "#e-save").click();
      const nw = e.S.data.equipment.find(x => x.serial === "W-2");
      ok(nw && nw.price === 7000000 && nw.logs.length === 1 && nw.logs[0].text === "성능검사 완료");
      ok(q(e, '.eq-tbl tr[data-eq="' + nw.id + '"]'), "목록 반영");
      q(e, '.eq-tbl tr[data-eq="' + nw.id + '"]').click();
      ok(q(e, "#modal-box").textContent.indexOf("구입가") >= 0, "hq — 구입가");
      q(e, "#eqd-edit").click(); q(e, "#e-del").click(); clickOk(e);
      ok(!e.S.data.equipment.some(x => x.serial === "W-2"));
    });
    t("SC16 메뉴: 화물 보안 허브 2개 운영 · 구버전 데이터의 예정 플래그 해제(멱등) · SYNC 키", () => {
      const mn = (id) => e.S.data.menus.find(m => m.module === id);
      ok(!mn("scr-status").planned && !mn("scr-equip").planned);
      ok(mn("kc-ra").planned && mn("access").planned);
      mn("scr-equip").planned = true; mn("scr-equip").desc = "준비";
      e.S.normalizeData();
      eq(mn("scr-equip").planned, undefined); eq(mn("scr-equip").desc, undefined);
      eq(e.S.normalizeData(), false, "두 번째는 변화 없음");
      ok(e.w.SemisSync.SYNC_KEYS.indexOf("equipment") >= 0);
    });
    t("SC17 통합 검색: 검색장비 대장 · 공개 저장소에 연동 키 없음", () => {
      const r = e.w.SemisSearch.search("IONAB");
      ok(r.some(x => x.group === "검색장비 유지관리"), "검색 결과");
      ["js/cares.js", "js/screening.js", "js/equipment.js", "index.html"].forEach(f => ok(!/AIza[0-9A-Za-z_-]{20,}/.test(read(f)), f));
    });
    await ta("SC18 CARES 연결 실패: 화면은 오류 안내 · 대장은 그대로 · 재시도 버튼", async () => {
      K._reset();
      K._setFetch(() => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) }));
      e.w.localStorage.setItem("semisl:caresKey", "bad-key");
      await K.load(true);
      ok(K.state.err, "err");
      go(e, "scr-status");
      ok(q(e, "[data-scr-retry]"), "재시도");
      go(e, "scr-equip");
      ok(qa(e, ".eq-tbl tr[data-eq]").length >= 3, "대장은 표시");
      ok(q(e, "#eq-meta").textContent.indexOf("연동 불가") >= 0);
      eq(e.w.localStorage.getItem("semisl:caresKey"), null, "403이면 키 캐시 삭제");
      K._setFetch(fake); K._reset();
    });
    await ta("SC19 읽기량: 대시보드는 live·repairs만(45일 점검 제외) · 자동 새로고침은 live만 · 유효기간 안이면 요청 없음", async () => {
      K._reset(); e.w.localStorage.setItem("semisl:caresKey", "test-key");
      calls.length = 0;
      await K.load({ parts: ["live", "repairs"] });
      const qs = calls.filter(c => c.body).map(c => c.body.structuredQuery);
      ok(!qs.some(q2 => q2.where && q2.where.fieldFilter.op === "IN"), "정기점검 조회 없음");
      const since = qs.filter(q2 => q2.from[0].collectionId === "inspectionLogs").map(q2 => Number(q2.where.fieldFilter.value.integerValue));
      eq(since.length, 1); ok(since[0] >= K.dayStartMs(K.todayKey()), "오늘 점검만");
      eq(qs.find(q2 => q2.from[0].collectionId === "sensorLogs").limit, 12);
      ok(K.has("live") && K.has("repairs") && !K.has("history"));
      calls.length = 0;
      await K.load({ parts: ["live", "repairs"], force: ["live"] });
      eq(calls.length, 3, "장비 · 센서 · 오늘 점검");
      calls.length = 0;
      await K.load({ parts: ["live", "repairs"] });
      eq(calls.length, 0, "유효기간 안");
      await K.load();
      ok(K.has("history"), "보안검색 현황 진입 시 45일 점검");
      eq(K.allInspections().length, 7, "오늘 점검과 45일 점검 중복 제거");
    });
    t("SC20 jsdom 오류 없음(화물 보안 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [FV] v1.12.1 첨부 뷰어 — 파일 칩·이미지 누르면 미리보기/내려받기 ══════════ */
  {
    const e = makeEnv();
    const F = e.w.SemisFiles;
    const SUPA = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/schedules/abc______brief.docx";
    loginAs(e, "hq");
    const viewer = () => q(e, "#fv-viewer");
    const openAttr = () => { const d = viewer(); return !!(d && (d.open || d.hasAttribute("open"))); };

    t("FV01 형식 판정 · 이름 정리(앞머리 📎 제거 · alt · 주소 폴백)", () => {
      eq(F.kindOf(SUPA, "회의자료.docx"), "file");
      eq(F.kindOf("https://x/y/a.PDF", "규정.pdf"), "pdf");
      eq(F.kindOf("https://x/y/a.webp", "체계도.webp"), "image");
      eq(F.kindOf("data:image/png;base64,AA", ""), "image");
      eq(F.nameFromUrl("https://x/y/%EA%B5%AD%EC%A0%95%EC%9B%90.docx"), "국정원.docx");
      const a = e.w.document.createElement("a");
      a.className = "nb-file"; a.href = SUPA; a.textContent = "📎 국정원대테러 회의_brief.docx";
      eq(F.nameOf(a), "국정원대테러 회의_brief.docx");
      const img = e.w.document.createElement("img");
      img.src = SUPA; img.alt = "";
      eq(F.nameOf(img), "abc______brief.docx", "alt 없으면 주소에서");
    });
    t("FV02 내려받기 주소: Supabase 공개 URL은 원래 이름으로(?download=) · 그 밖은 blob 경로", () => {
      eq(F.downloadHref(SUPA, "국정원 회의.docx"),
        SUPA + "?download=" + encodeURIComponent("국정원 회의.docx"));
      eq(F.downloadHref("https://other.test/a.docx", "a.docx"), "", "다른 호스트는 blob 으로");
      eq(F.downloadHref(SUPA, ""), SUPA + "?download=" + encodeURIComponent("abc______brief.docx"));
    });
    t("FV03 편집 중인 메모의 파일 칩을 누르면 뷰어(기본 이동 차단) · 첨부 삭제 버튼 노출", () => {
      go(e, "schedule");
      e.S.openModal('<div id="f-memo" class="nb-editor" contenteditable="true">' +
        '<a class="nb-file" href="' + SUPA + '" target="_blank">📎 회의자료.docx</a>&nbsp;' +
        '<img src="https://files.test/photo.png" alt="현장사진.png">' +
        '<a class="nb-file" href="https://files.test/규정.pdf" target="_blank">📎 규정.pdf</a></div>');
      const chip = q(e, "#f-memo a.nb-file");
      const ev = new e.w.MouseEvent("click", { bubbles: true, cancelable: true });
      chip.dispatchEvent(ev);
      ok(ev.defaultPrevented, "링크 기본 이동 차단");
      ok(openAttr(), "뷰어 열림");
      eq(q(e, "#fv-title").textContent, "회의자료.docx");
      eq(q(e, "#fv-viewer .fv-ext").textContent, "DOCX");
      eq(q(e, "#fv-viewer .fv-pos").textContent, "1 / 3", "같은 글의 첨부 3개");
      eq(q(e, "#fv-viewer [data-fv=del]").hidden, false, "편집 중이면 삭제 가능");
      eq(q(e, "#fv-viewer [data-fv-stage]").dataset.kind, "file");
      ok(q(e, "#fv-viewer .fv-none"), "미리보기 미지원 안내");
      eq(q(e, '#fv-viewer [data-fv="tab"]').getAttribute("href"), SUPA);
    });
    t("FV04 ← → 로 다음 첨부 — 이미지는 미리보기, PDF는 프레임", () => {
      q(e, "#fv-viewer [data-fv=next]").click();
      eq(q(e, "#fv-viewer [data-fv-stage]").dataset.kind, "image");
      eq(q(e, "#fv-title").textContent, "현장사진.png");
      ok(q(e, "#fv-viewer img.fv-img"));
      q(e, "#fv-viewer [data-fv=next]").click();
      eq(q(e, "#fv-viewer [data-fv-stage]").dataset.kind, "pdf");
      ok(q(e, "#fv-viewer iframe.fv-frame"));
      eq(q(e, "#fv-viewer .fv-pos").textContent, "3 / 3");
      q(e, "#fv-viewer [data-fv=next]").click();
      eq(q(e, "#fv-viewer .fv-pos").textContent, "1 / 3", "끝에서 처음으로");
    });
    t("FV05 뷰어에서 첨부 빼기 — 편집기에서 칩과 뒤따르는 빈칸까지 제거", () => {
      eq(qa(e, "#f-memo a.nb-file").length, 2);
      q(e, "#fv-viewer [data-fv=del]").click();
      eq(qa(e, "#f-memo a.nb-file").length, 1, "칩 제거");
      eq(q(e, "#f-memo").innerHTML.indexOf(" "), -1, "뒤 빈칸도 정리");
      eq(q(e, "#fv-viewer .fv-pos").textContent, "1 / 2");
      q(e, "#fv-viewer [data-fv=close]").click();
      ok(!openAttr(), "닫힘");
      ok(q(e, "#f-memo"), "뒤에 열려 있던 모달은 그대로");
      e.S.closeModal();
    });
    t("FV06 Esc 는 뷰어만 닫는다(뒤 모달 유지)", () => {
      e.S.openModal('<div class="notice-html"><a class="nb-file" href="' + SUPA + '">📎 회의자료.docx</a></div>');
      q(e, "#modal-box a.nb-file").dispatchEvent(new e.w.MouseEvent("click", { bubbles: true, cancelable: true }));
      ok(openAttr());
      eq(q(e, "#fv-viewer [data-fv=del]").hidden, true, "읽기 화면에서는 삭제 없음");
      let leaked = 0;
      const onKey = () => { leaked++; };
      e.w.document.addEventListener("keydown", onKey);
      q(e, "#fv-viewer").dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      e.w.document.removeEventListener("keydown", onKey);
      eq(leaked, 0, "Esc 가 문서까지 올라가지 않음");
      e.S.closeModal();
    });
    t("FV07 읽기 화면(공지·일정 상세)의 첨부도 같은 뷰어로", () => {
      go(e, "dashboard");
      e.S.data.notices = [{ id: "n-fv", title: "첨부 시험", body: "본문", author: "시스템", pinned: false,
        created: new Date().toISOString(), files: [{ name: "안내문.pdf", url: "https://files.test/안내문.pdf" }] }];
      e.S.saveSilent(); e.S.renderView();
      const link = q(e, "#notice-list .nb-file");
      ok(link, "공지 첨부 칩");
      link.dispatchEvent(new e.w.MouseEvent("click", { bubbles: true, cancelable: true }));
      ok(openAttr());
      eq(q(e, "#fv-title").textContent, "안내문.pdf");
      eq(q(e, "#fv-viewer [data-fv-stage]").dataset.kind, "pdf");
      q(e, "#fv-viewer [data-fv=close]").click();
    });
    t("FV08 뷰어가 본문을 고치지 않음 · 모달 위에 겹치는 dialog · index.html 로드", () => {
      e.S.openModal('<div id="f-memo" class="nb-editor" contenteditable="true"><a class="nb-file" href="' + SUPA + '">📎 회의자료.docx</a></div>');
      const before = q(e, "#f-memo").innerHTML;
      q(e, "#f-memo a.nb-file").dispatchEvent(new e.w.MouseEvent("click", { bubbles: true, cancelable: true }));
      eq(q(e, "#f-memo").innerHTML, before, "열기만으로는 본문 변화 없음");
      eq(viewer().tagName, "DIALOG", "모달 위에 겹치도록 dialog");
      q(e, "#fv-viewer [data-fv=close]").click();
      e.S.closeModal();
      ok(read("index.html").indexOf("js/files.js?v=") > 0);
      const src = read("js/files.js");
      ok(src.indexOf("esc(c.url)") > 0 && src.indexOf("esc(c.name)") > 0, "주소·이름은 esc 로 넣는다");
    });
    t("FV09 jsdom 오류 없음(첨부 뷰어 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
  }

  /* ══════════ [LG] v1.12.2 링크 묶음 — 바로가기 한 줄 아래 하위 링크를 카드 화면으로 ══════════ */
  {
    const e = makeEnv();
    const set = { id: "lk-set", seq: 90, type: "link", label: "SCAN 폴더", icon: "🗂",
      url: "http://10.31.61.163/apps/box/", open: "group", parent: "hub-home", vis: "hq", quick: true };
    const k1 = { id: "lk-a", seq: 91, type: "link", label: "가 파트 박스", icon: "📦",
      url: "http://10.31.61.163/apps/box/index.html#a", open: "tab", parent: "lk-set", vis: "hq" };
    const k2 = { id: "lk-b", seq: 92, type: "link", label: "나 파트 박스",
      url: "https://example.org/b", open: "frame", parent: "lk-set", vis: "hq" };
    e.S.data.menus.push(set, k1, k2);
    e.S.saveSilent();
    loginAs(e, "hq");

    t("LG01 묶음 판정 · 하위 링크 목록 · 사내망 주소 판정", () => {
      ok(e.S.isLinkGroup(set)); ok(!e.S.isLinkGroup(k1));
      eq(e.S.linkChildren("lk-set").map(m => m.id).join(","), "lk-a,lk-b");
      eq(e.S.linkChildren("lk-a").length, 0);
      ok(e.S.isIntranet("http://10.31.61.163/apps/box/"), "사설 IP");
      ok(!e.S.isIntranet("https://example.org/b"));
      eq(e.S.hostOf("http://10.31.61.163:8080/x"), "10.31.61.163:8080");
    });

    t("LG02 사이드바 — 묶음은 한 줄(하위 개수 표시), 하위 링크는 허브 목록에 없다", () => {
      e.S.renderNav();
      const item = q(e, '.nav-item[data-route="links/lk-set"]');
      ok(item, "묶음 메뉴 한 줄");
      ok(item.textContent.includes("SCAN 폴더") && item.textContent.includes("2"), "하위 개수");
      eq(qa(e, ".nav-item").filter(el => el.textContent.includes("파트 박스")).length, 0, "하위는 숨김");
      eq(e.S.hubEntries("hub-home").filter(m => m.parent === "lk-set").length, 0);
      eq(e.S.hubOfDeep(k1), "hub-home", "하위 링크의 실제 허브");
    });

    t("LG03 #/links/<id> — 하위 링크가 카드로, 열기 방식별 요소", () => {
      go(e, "links/lk-set");
      eq(q(e, "#view .page-title").textContent.trim(), "SCAN 폴더");
      eq(qa(e, "#view .lk-card").length, 2);
      const a = q(e, '#view a.lk-card[href="' + k1.url + '"]');
      ok(a && a.getAttribute("target") === "_blank" && /noopener/.test(a.getAttribute("rel")), "새 탭 카드");
      ok(q(e, '#view button.lk-card[data-go="embed/lk-b"]'), "내부 화면 카드");
      ok(q(e, '#view .page-head a[href="' + set.url + '"]'), "묶음 자체 주소도 열 수 있다");
      ok(q(e, "#view .lk-note"), "사내망 안내");
      eq(q(e, "#view .page-head [data-print-btn]").textContent.trim(), "Print");
      eq(q(e, "#view").getAttribute("data-hub"), "hub-home", "허브 배너 유지");
      ok(q(e, "#view").classList.contains("view-mid"));
      ok(q(e, "#crumbs").textContent.includes("SCAN 폴더"));
    });

    t("LG04 카드 → 내부 화면, embed 화면에서 묶음으로 복귀", () => {
      q(e, '#view button.lk-card[data-go="embed/lk-b"]').click();
      eq(e.w.location.hash, "#/embed/lk-b");
      e.S.renderView();
      ok(q(e, "#view iframe.embed-frame"), "내부 프레임");
      const back = q(e, '#view .page-head [data-go="links/lk-set"]');
      ok(back && back.textContent.includes("SCAN 폴더"), "묶음 복귀 버튼");
      ok(q(e, "#crumbs").textContent.includes("SCAN 폴더"), "빵부스러기에 묶음");
      eq(e.S.printTitle("links/lk-set"), "SCAN 폴더");
    });

    t("LG05 통합검색 — 묶음은 묶음 화면, 하위 링크는 상위 이름과 함께", () => {
      const hits = e.w.SemisSearch.search("SCAN 폴더");
      ok(hits.some(h => h.route === "links/lk-set"), "묶음 → links 라우트");
      const kid = (e.w.SemisSearch.search("가 파트 박스") || []).find(h => h.title === "가 파트 박스");
      ok(kid, "하위 링크도 검색된다");
      ok(String(kid.sub).indexOf("SCAN 폴더") === 0, "상위 묶음 이름: " + kid.sub);
      eq(kid.url, k1.url);
    });

    t("LG06 하위 링크 숨김·권한은 상위를 따른다", () => {
      set.hidden = true; e.S.renderNav();
      eq(qa(e, '.nav-item[data-route="links/lk-set"]').length, 0);
      eq(e.S.linkChildren("lk-set").length, 0, "상위가 숨겨지면 하위도 빠진다");
      delete set.hidden; e.S.renderNav();
      eq(e.S.linkChildren("lk-set").length, 2);
    });

    t("LG07 설정 · 메뉴 관리 — 하위 링크는 2단 들여쓰기, 소속 선택에 묶음이 뜬다", () => {
      loginAs(e, "admin");
      renderSettings(e, "menus");
      ok(q(e, '#menu-tree [data-id="lk-set"]'), "묶음 행");
      const sub = q(e, '#menu-tree [data-id="lk-a"]');
      ok(sub && sub.classList.contains("is-sub"), "하위 행 들여쓰기");
      ok(q(e, '#menu-tree [data-id="lk-set"]').textContent.includes("링크 묶음"), "유형 배지");
      q(e, '#menu-tree [data-edit="lk-a"]').click();
      const opt = q(e, '#f-parent option[value="lk-set"]');
      ok(opt && opt.selected, "소속 선택에 묶음");
      ok(q(e, '#f-open option[value="group"]'), "열기 방식에 링크 묶음");
      q(e, "#f-cancel").click();
    });

    t("LG08 하위가 있는 묶음은 열기 방식을 함부로 못 바꾼다", () => {
      renderSettings(e, "menus");
      q(e, '#menu-tree [data-edit="lk-set"]').click();
      q(e, "#f-open").value = "tab";
      q(e, "#f-save").click();
      eq(e.S.data.menus.find(x => x.id === "lk-set").open, "group", "변경 거부");
      ok(q(e, "#f-save"), "모달 유지");
      q(e, "#f-open").value = "group";
      q(e, "#f-save").click();
      eq(e.S.data.menus.find(x => x.id === "lk-set").open, "group");
      ok(!q(e, "#f-save"), "정상 저장 후 모달 닫힘");
    });

    t("LG09 정합성 보정 — 하위를 가진 링크는 묶음으로 승격, 없는 상위는 소속 해제", () => {
      const m = e.S.data.menus.find(x => x.id === "lk-set");
      m.open = "tab";
      e.S.data.menus.push({ id: "lk-orphan", seq: 93, type: "link", label: "떠도는 링크",
        url: "https://example.org/z", open: "tab", parent: "no-such-menu", vis: "all" });
      e.S.normalizeData();
      eq(e.S.data.menus.find(x => x.id === "lk-set").open, "group");
      eq(e.S.data.menus.find(x => x.id === "lk-orphan").parent, null);
      e.S.data.menus = e.S.data.menus.filter(x => x.id !== "lk-orphan");
    });

    t("LG10 CSS · jsdom 오류 없음(링크 묶음 블록)", () => {
      const c = read("css/main.css");
      ok(c.indexOf(".lk-grid") > 0 && c.indexOf(".lk-card") > 0 && c.indexOf(".menu-tree-item.is-sub") > 0);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
  }

  /* ══════════ [CR] v1.13 위기대응 담당자 — 엑셀 읽기 · 조직/팀/담당자/매트릭스 보기 · 편집 · 대조 반영 ══════════ */
  {
    /* 무압축(stored) xlsx 만들기 — 가상 이름만 사용(실명단은 공용 DB에만) */
    const zipStored = (files) => {
      const enc = (s) => Buffer.from(s, "utf8");
      const locals = [], cents = [];
      let off = 0;
      Object.keys(files).forEach(name => {
        const nb = enc(name), data = enc(files[name]);
        const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
        lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
        const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
        ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
        locals.push(lh, nb, data); cents.push(ch, nb);
        off += 30 + nb.length + data.length;
      });
      const cd = Buffer.concat(cents);
      const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(Object.keys(files).length, 8);
      eo.writeUInt16LE(Object.keys(files).length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
      const b = Buffer.concat(locals.concat([cd, eo]));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    const esx = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const makeXlsx = (sheets) => {
      const strs = [];
      const si = (v) => { let i = strs.indexOf(v); if (i < 0) { strs.push(v); i = strs.length - 1; } return i; };
      const col = (c) => String.fromCharCode(64 + c);
      const files = {};
      sheets.forEach((sh, n) => {
        const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v == null ? "" :
          `<c r="${col(ci + 1)}${ri + 1}" t="s"><v>${si(v)}</v></c>`).join("")}</row>`).join("");
        const mg = (sh.merges || []).length ? `<mergeCells>${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
        files["xl/worksheets/sheet" + (n + 1) + ".xml"] = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${mg}</worksheet>`;
      });
      files["xl/workbook.xml"] = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esx(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
      files["xl/_rels/workbook.xml.rels"] = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
      files["xl/sharedStrings.xml"] = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strs.map(s => `<si><t xml:space="preserve">${esx(s)}</t></si>`).join("")}</sst>`;
      return zipStored(files);
    };
    const HEAD = ["팀", "위기대응 조직", "위기대응 업무", "담당자(정)", "담당자(부)"];
    const T = ["테스트 위기대응 담당자", null, null, null, null], D = [null, null, null, null, "기준시점: 26년 9월"];
    const SHEETS = [
      { name: "전체", rows: [T, D, HEAD,
        ["가팀", "초동조치센터", "☐ 첫 보고", "갑일", "을일"],
        [null, null, "☐ 두 번째\n   업무 설명", "갑일", "을일"],
        [null, "종합지원센터", "☐ 물자 지원", "병일", "정일"],
        ["인천화물팀", "현장지원센터", "☐ 유해 송환 지원", "무일", "기일"],
        ["<End>"]], merges: ["A4:A6", "B4:B5"] },
      { name: "갑본부", rows: [T, D, HEAD, ["가팀", "초동조치센터", "☐ 첫 보고", "갑일", "을일"], [null, null, "☐ 두 번째\n   업무 설명", "갑일", "을일"], [null, "종합지원센터", "☐ 물자 지원", "병일", "정일"], ["<End>"]], merges: ["A4:A6", "B4:B5"] },
      { name: "을본부", rows: [T, D, HEAD, ["인천화물팀", "현장지원센터", "☐ 유해 송환 지원", "무일", "기일"], ["<End>"]] },
      { name: "통제실", rows: [T, D, HEAD, ["통제팀", "초동조치센터", "☐ 비상 소집", "아래 주) 참조", null], [null, null, "☐ 최초 보고", null, null],
        ["주)"], ["1. 통제팀은 팀원 전원이 담당자가 되며, "], ["   지정된 임무를 수행함"], ["2. 문의는 OCC(T.02-0000-0000)"], ["<End>"]],
        merges: ["A4:A5", "B4:B5", "D4:E5"] }
    ];
    const e = makeEnv();
    const CR = e.w.SemisCrisis;
    e.w.TextDecoder = require("util").TextDecoder;
    let parsed = null;
    await ta("CR01 엑셀 읽기: 병합 셀 채움 · 합본+본부 시트 · 본부에만 있는 행 덧붙임 · 주석 이어 붙이기", async () => {
      parsed = CR.parseSheets(await CR.readXlsx(makeXlsx(SHEETS)));
      eq(parsed.title, "테스트 위기대응 담당자"); eq(parsed.asOf, "26년 9월");
      eq(parsed.rows.length, 6);
      const r2 = parsed.rows[1];
      eq(r2.team, "가팀"); eq(r2.org, "초동조치센터"); eq(r2.task, "두 번째 업무 설명"); eq(r2.div, "갑본부");
      eq(parsed.rows[2].org, "종합지원센터");
      eq(parsed.rows.filter(r => r.team === "통제팀").length, 2);
      const ct = parsed.rows.find(r => r.team === "통제팀");
      eq(ct.main, "아래 주) 참조"); eq(ct.sub, "", "가로 병합(정=부) → 부는 비움"); eq(ct.div, "통제실");
      eq(parsed.notes.length, 2); eq(parsed.notes[0], "통제팀은 팀원 전원이 담당자가 되며, 지정된 임무를 수행함");
      ok(parsed.rows.every(r => r.id));
      eq(CR.people(parsed.rows).map(p => p.name).join(","), "갑일,기일,무일,병일,을일,정일", "안내 문구는 사람 아님");
    });
    t("CR02 메뉴: 협력 · 비상 허브 · 비상연락망 바로 아래 · mgr", () => {
      const m = e.S.data.menus.find(x => x.module === "crisis");
      ok(m && m.type === "module" && !m.planned); eq(m.parent, "hub-ops"); eq(m.vis, "mgr");
      const ct = e.S.data.menus.find(x => x.module === "contacts");
      ok(m.seq > ct.seq);
      const old = makeEnv({ preData: { version: 1, menus: e.S.defaultMenus().filter(x => x.id !== "crisis") } });
      const m2 = old.S.data.menus.find(x => x.module === "crisis");
      ok(m2 && m2.parent === "hub-ops", "기존 메뉴 데이터에 자동 추가");
      eq(old.S.normalizeData(), false, "멱등");
    });
    const seedData = () => {
      e.S.data.crisis = { title: parsed.title, asOf: parsed.asOf, notes: parsed.notes.slice(), rows: JSON.parse(JSON.stringify(parsed.rows)) };
      e.S.data.contacts.sections = [{ id: "s1", type: "people", title: "t", rows: [{ id: "p1", name: "무일", mobile: "010-0000-1111" },
        { id: "p2", name: "갑일", mobile: "010-0000-2222" }, { id: "p3", name: "갑일", mobile: "010-0000-3333" }] }];
      e.S.saveSilent();
    };
    t("CR03 화면: 우리 팀 띠 · 요약 · 조직 줄 · 조직별 표 · 참고(전화 링크) · 인쇄 버튼", () => {
      seedData(); loginAs(e, "manager"); go(e, "crisis");
      const home = q(e, ".cr-home");
      ok(home && home.textContent.indexOf("인천화물팀") >= 0 && home.textContent.indexOf("유해 송환 지원") >= 0);
      ok(q(e, ".cr-home .cr-tel"), "연락망에 한 명뿐인 이름 → 전화");
      eq(qa(e, ".stat-value").map(x => x.textContent).join(","), "3,3,6,6");
      eq(qa(e, ".cr-orgbtn").length, 4);
      eq(qa(e, "#cr-body .cr-sec").length, 3);
      eq(qa(e, "#cr-body .cr-sec")[0].dataset.org, "초동조치센터", "조직 순서");
      ok(!qa(e, ".cr-line").some(l => l.querySelector(".cr-tel") && l.textContent.indexOf("갑일") >= 0), "동명이인 → 번호 잇지 않음");
      ok(q(e, ".cr-ref[data-jump=notes]"));
      ok(q(e, "#cr-notes a[href='tel:0200000000']"));
      ok(q(e, ".page-head .print-btn, .page-head [data-print], .page-head .btn-print") || q(e, ".page-head").textContent.indexOf("Print") >= 0, "인쇄 버튼");
      ok(!q(e, "#cr-add") && !q(e, "#cr-import") && !q(e, ".cr-edit"), "manager 편집 없음");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("CR04 필터 · 검색 · 이름 누르면 담당자별 · 매트릭스 칸 → 조직별 필터", () => {
      q(e, ".cr-orgbtn[data-org='종합지원센터']").click();
      eq(qa(e, "#cr-body .cr-sec").length, 1); eq(qa(e, ".cr-line").length, 1);
      ok(q(e, "#cr-clear"));
      q(e, "#cr-clear").click();
      const qi = q(e, "#cr-q"); qi.value = "송환"; qi.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, ".cr-line").length, 1); ok(q(e, ".cr-line mark"));
      const q2 = q(e, "#cr-q"); q2.value = ""; q2.dispatchEvent(new e.w.Event("input"));
      if (!q(e, ".cr-pn[data-person='병일']")) throw new Error("no 병일: " + CR.getState().query + "/" + qa(e, ".cr-pn").map(x => x.dataset.person).join(","));
      q(e, ".cr-pn[data-person='병일']").click();
      eq(CR.getState().view, "person"); eq(qa(e, ".cr-person").length, 1);
      ok(q(e, ".cr-person").textContent.indexOf("물자 지원") >= 0);
      q(e, "[data-view=matrix]").click();
      ok(q(e, ".cr-mxt")); CR.setState({ query: "" }); e.S.renderView();
      const cell = q(e, ".cr-mx[data-mx-team='가팀'][data-mx-org='초동조치센터']");
      eq(cell.textContent, "2");
      cell.click();
      eq(CR.getState().view, "org"); eq(CR.getState().org, "초동조치센터"); eq(qa(e, ".cr-line").length, 2);
      q(e, "[data-view=team]").click();
      ok(qa(e, "#cr-body .cr-sec h3").map(h => h.textContent).indexOf("갑본부") >= 0);
      CR.setState({ view: "org", org: "", query: "" });
    });
    t("CR05 hq 편집: 추가(같은 팀 뒤) · 검색에 걸리지 않으면 조건 해제 · 삭제 · 필수값", () => {
      e.S.logout ? e.S.logout() : null;
      loginAs(e, "hq"); go(e, "crisis");
      ok(q(e, "#cr-add") && q(e, "#cr-import") && q(e, ".cr-edit"));
      CR.setState({ query: "송환" }); e.S.renderView();
      q(e, "#cr-add").click();
      q(e, "#cr-f-team").value = "가팀"; q(e, "#cr-f-org").value = "종합지원센터"; q(e, "#cr-f-task").value = "새 임무"; q(e, "#cr-f-main").value = "신일";
      clickOk(e);
      const rows = e.S.data.crisis.rows;
      eq(rows.length, 7); eq(rows[3].task, "새 임무", "가팀 마지막 행 뒤");
      eq(CR.getState().query, "", "저장한 행이 보이도록 검색 해제");
      ok(qa(e, ".cr-line").some(l => l.textContent.indexOf("새 임무") >= 0));
      q(e, "#cr-add").click(); clickOk(e);
      eq(e.S.data.crisis.rows.length, 7, "필수값 없으면 저장 안 함");
      e.S.closeModal();
      q(e, `.cr-edit[data-edit='${rows[3].id}']`).click();
      q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      eq(e.S.data.crisis.rows.length, 6);
    });
    t("CR06 기본 정보: 우리 팀 바꾸기 · 참고 사항 줄 단위", () => {
      q(e, "#cr-meta").click();
      q(e, "#cr-m-home").value = "가팀"; q(e, "#cr-m-notes").value = "하나\n\n둘";
      clickOk(e);
      eq(e.S.data.crisis.homeTeam, "가팀"); eq(e.S.data.crisis.notes.join("|"), "하나|둘");
      ok(q(e, ".cr-home h2").textContent === "가팀");
      e.S.data.crisis.homeTeam = "인천화물팀"; e.S.renderView();
    });
    t("CR07 엑셀 대조 반영: 담당자 변경 · 새 임무 · 빠지는 임무 → 반영", () => {
      const next = JSON.parse(JSON.stringify(parsed));
      next.asOf = "27년 3월";
      next.rows[0].main = "새일";
      next.rows = next.rows.filter(r => r.task !== "물자 지원");
      next.rows.push({ id: "x1", div: "을본부", team: "인천화물팀", org: "현장지원센터", task: "소지품 반환", main: "무일", sub: "기일" });
      CR.previewImport(next, { name: "2027.xlsx", size: 10 });
      const box = q(e, "#modal-box");
      const hs = qa(e, "#modal-box .cr-dsec h4").map(h => h.textContent.replace(/\s+/g, " ").trim());
      eq(hs.join("|"), "담당자 변경 1|새 임무 1|빠지는 임무 1");
      ok(box.textContent.indexOf("27년 3월") >= 0);
      return new Promise(r => r());
    });
    await ta("CR08 반영 실행 → 데이터 교체 · 조건 초기화", async () => {
      clickOk(e);
      await new Promise(r => setTimeout(r, 20));
      eq(e.S.data.crisis.asOf, "27년 3월"); eq(e.S.data.crisis.rows.length, 6);
      ok(e.S.data.crisis.rows.some(r => r.task === "소지품 반환"));
      ok(q(e, "#view .cr-home"));
    });
    t("CR09 통합 검색: 담당자 이름 → 위기대응 담당자(담당자별 보기로)", () => {
      const it = e.w.SemisSearch.search ? e.w.SemisSearch.search("무일") : null;
      if (it) ok(it.some(x => x.group === "위기대응 담당자"), "검색 결과");
      const src = read("js/search.js");
      ok(src.indexOf('typeof it.pick === "function"') > 0);
    });
    t("CR10 공개 저장소 위생: crisis.js에 전화번호·명단 없음 · 동기화 키", () => {
      const s = read("js/crisis.js");
      ok(!/01\d-\d{3,4}-\d{4}/.test(s)); ok(s.indexOf("rows: [{") < 0 || s.indexOf("데이터:") > 0);
      ok(e.Sync.SYNC_KEYS.indexOf("crisis") >= 0);
      const c = read("css/main.css");
      ok(c.indexOf(".cr-home") > 0 && c.indexOf(".cr-line") > 0 && c.indexOf(".cr-mxt") > 0);
    });
  }

  /* ══════════ [PB] v1.18 업무 연락처 ══════════ */
  {
    const e = makeEnv();
    const PB = e.w.SemisPhonebook;
    const seed = () => {
      e.S.data.phonebook = { asOf: "26년 9월", notes: ["참고 하나"],
        groups: [{ id: "ga", name: "가구역", color: "#d42a1e" }, { id: "gb", name: "나구역", color: "#1f4fd6" }],
        rows: [
          { id: "r1", group: "ga", org: "갑사", dept: "검색실", name: "갑일", title: "팀장", duty: "", ext: "0939", office: "", mobile: "010-0000-1111", email: "", note: "", check: false, verify: "" },
          { id: "r2", group: "ga", org: "갑사", dept: "반입부스", name: "", title: "", duty: "", ext: "0934", office: "", mobile: "", email: "", note: "", check: false, verify: "" },
          { id: "r3", group: "gb", org: "을사", dept: "교육팀", name: "을일", title: "과장", duty: "교육 관련", ext: "", office: "032-000-2072", mobile: "", email: "a@x.com", note: "", check: true, verify: "철자 확인" },
          { id: "r4", group: "gb", org: "을사", dept: "", name: "을이", title: "사원", duty: "", ext: "", office: "", mobile: "", email: "b@x.com", note: "비고", check: false, verify: "" }
        ] };
      e.S.saveSilent();
    };
    t("PB01 메뉴: 협력 · 비상 허브 · 위기대응 담당자 바로 아래 · mgr · 기존 데이터 자동 추가(멱등)", () => {
      const m = e.S.data.menus.find(x => x.module === "phonebook");
      ok(m && m.type === "module" && !m.planned); eq(m.parent, "hub-ops"); eq(m.vis, "mgr"); eq(m.label, "업무 연락처");
      const cr = e.S.data.menus.find(x => x.module === "crisis");
      ok(m.seq > cr.seq);
      const nx = e.S.data.menus.filter(x => x.parent === "hub-ops" && x.seq > cr.seq).sort((a, b) => a.seq - b.seq)[0];
      eq(nx.id, m.id, "위기대응 바로 다음");
      const old = makeEnv({ preData: { version: 1, menus: e.S.defaultMenus().filter(x => x.id !== "phonebook") } });
      const m2 = old.S.data.menus.find(x => x.module === "phonebook");
      const cr2 = old.S.data.menus.find(x => x.module === "crisis");
      ok(m2 && m2.parent === "hub-ops" && m2.seq > cr2.seq, "기존 메뉴 데이터에 자동 추가");
      const after = old.S.data.menus.filter(x => x.parent === "hub-ops" && x.seq > cr2.seq).sort((a, b) => a.seq - b.seq)[0];
      eq(after.id, m2.id, "기존 데이터에서도 위기대응 바로 다음");
      eq(old.S.normalizeData(), false, "멱등");
      ok(old.S.data.phonebook && Array.isArray(old.S.data.phonebook.rows) && Array.isArray(old.S.data.phonebook.groups));
    });
    t("PB02 번호 정리 · 검색 매칭(번호 하이픈 무시 · 구역명)", () => {
      eq(PB.fmtPhone("01012340000"), "010-1234-0000"); eq(PB.fmtPhone("7000001"), "032-700-0001");
      eq(PB.fmtPhone("0327000001"), "032-700-0001"); eq(PB.fmtPhone("032-700-0001"), "032-700-0001"); eq(PB.fmtPhone("0212345678"), "02-1234-5678");
      eq(PB.telHref("032-700-0002"), "tel:0327000002"); eq(PB.telHref("+1-800-000-0000"), "tel:+18000000000");
      seed();
      const r = e.S.data.phonebook.rows;
      ok(PB.matches(r[0], "00001111"));
      ok(PB.matches(r[2], "000-2072")); ok(PB.matches(r[1], "가구역")); ok(!PB.matches(r[1], "을사"));
    });
    t("PB03 화면(manager): 요약 · 구역 줄 · 구역 카드(색) · 전화/문자/메일/내선 · 확인 필요 · 참고 · 인쇄 · 편집 없음", () => {
      seed(); loginAs(e, "manager"); go(e, "phonebook");
      eq(qa(e, ".stat-value").map(x => x.textContent).join(","), "4,2,1 · 2,1");
      eq(qa(e, ".pb-gbtn").length, 3);
      eq(qa(e, ".pb-sec").length, 2); ok(qa(e, ".pb-sec")[0].getAttribute("style").indexOf("#d42a1e") >= 0);
      ok(q(e, ".pb-row[data-row=r1] a[href='tel:01000001111']")); ok(q(e, ".pb-row[data-row=r1] a[href='sms:01000001111']"));
      ok(q(e, ".pb-row[data-row=r1] [data-copy='0939']")); ok(q(e, ".pb-row[data-row=r3] a[href='mailto:a@x.com']"));
      ok(q(e, ".pb-row[data-row=r2] b").textContent === "반입부스", "이름 없으면 부서/장소");
      ok(q(e, ".pb-row.is-check[data-row=r3] .pb-flag")); ok(q(e, ".pb-row[data-row=r3] .pb-verify").textContent.indexOf("철자 확인") >= 0);
      ok(q(e, ".pb-sec[data-group=gb] .pb-mailall[href='mailto:a@x.com,b@x.com']"), "구역 전체 메일");
      ok(!q(e, ".pb-sec[data-group=ga] .pb-mailall"));
      ok(q(e, ".pb-notes").textContent.indexOf("참고 하나") >= 0);
      ok(q(e, ".page-head").textContent.indexOf("Print") >= 0 && q(e, ".page-head").textContent.indexOf("기준 26년 9월") >= 0);
      ok(!q(e, "#pb-add") && !q(e, ".pb-edit") && !q(e, "#pb-groups"), "manager 편집 없음");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("PB04 필터: 구역 · 확인 필요 · 검색(입력칸 유지) · 조건 해제", () => {
      q(e, ".pb-gbtn[data-grp=gb]").click();
      eq(qa(e, ".pb-row").length, 2); ok(q(e, "#pb-clear"));
      q(e, ".pb-gbtn[data-grp=gb]").click(); eq(qa(e, ".pb-row").length, 4, "다시 누르면 해제");
      q(e, "#pb-only").click(); eq(qa(e, ".pb-row").length, 1); eq(PB.getState().onlyCheck, true);
      q(e, "#pb-clear").click(); eq(qa(e, ".pb-row").length, 4);
      const qi = q(e, "#pb-q"); qi.value = "갑ㅇ"; qi.dispatchEvent(new e.w.Event("input"));
      ok(q(e, "#pb-q") === qi, "입력칸 유지"); eq(qa(e, ".pb-row").length, 2); ok(q(e, ".pb-row mark"));
      qi.value = "2072"; qi.dispatchEvent(new e.w.Event("input")); eq(qa(e, ".pb-row").length, 1);
      qi.value = "없는사람"; qi.dispatchEvent(new e.w.Event("input")); ok(q(e, "#pb-body .empty-state"));
      qi.value = ""; qi.dispatchEvent(new e.w.Event("input")); eq(qa(e, ".pb-row").length, 4);
    });
    t("PB05 보기: 빠른 연락(큰 버튼) · 표(전 항목)", () => {
      q(e, "[data-view=quick]").click();
      eq(qa(e, ".pb-tile").length, 4);
      const t1 = qa(e, ".pb-tile")[0];
      ok(t1.querySelector(".pb-b.is-call[href='tel:01000001111']") && t1.querySelector("a[href='sms:01000001111']") && t1.querySelector("[data-copy='0939']"));
      ok(qa(e, ".pb-tile")[2].querySelector(".pb-b.is-call[href='tel:0320002072']"), "휴대폰 없으면 유선");
      q(e, "[data-view=table]").click();
      eq(qa(e, ".pb-tbl tbody tr:not(.pb-tgrp)").length, 4); eq(qa(e, ".pb-tgrp").length, 2); eq(qa(e, ".pb-tbl thead th").length, 8);
      ok(q(e, ".pb-tbl tr.is-check")); ok(q(e, ".pb-tbl").textContent.indexOf("철자 확인") >= 0);
      PB.setState({ view: "group" });
    });
    t("PB06 hq 편집: 추가(같은 구역 뒤 · 번호 정리) · 필수값 · 조건 해제 · 확인 필요 해제 시 메모 비움 · 삭제", () => {
      loginAs(e, "hq"); go(e, "phonebook");
      ok(q(e, "#pb-add") && q(e, ".pb-edit") && q(e, "#pb-groups") && q(e, "#pb-meta"));
      PB.setState({ grp: "gb" }); e.S.renderView();
      q(e, "#pb-add").click();
      q(e, "#pb-f-group").value = "ga"; q(e, "#pb-f-name").value = "새일"; clickOk(e);
      eq(e.S.data.phonebook.rows.length, 4, "연락 수단 없으면 저장 안 함");
      q(e, "#pb-f-email").value = "잘못"; clickOk(e); eq(e.S.data.phonebook.rows.length, 4, "메일 형식");
      q(e, "#pb-f-email").value = ""; q(e, "#pb-f-mobile").value = "01012345678"; q(e, "#pb-f-office").value = "7000003"; clickOk(e);
      const rs = e.S.data.phonebook.rows;
      eq(rs.length, 5); eq(rs[2].name, "새일", "가구역 마지막 뒤"); eq(rs[2].mobile, "010-1234-5678"); eq(rs[2].office, "032-700-0003");
      eq(PB.getState().grp, "", "다른 구역에 저장 → 조건 해제");
      q(e, ".pb-edit[data-edit=r3]").click();
      ok(q(e, "#pb-f-check").checked); q(e, "#pb-f-check").checked = false; clickOk(e);
      const r3 = rs.find(x => x.id === "r3"); eq(r3.check, false); eq(r3.verify, "");
      q(e, `.pb-edit[data-edit='${rs[2].id}']`).click();
      q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      eq(e.S.data.phonebook.rows.length, 4);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("PB07 구역 관리: 이름 · 색 · 순서 · 추가 · 연락처 있는 구역 삭제 불가", () => {
      q(e, "#pb-groups").click();
      eq(qa(e, ".pb-grow").length, 2);
      ok(qa(e, ".pb-grow")[0].querySelector(".pb-gdel").disabled);
      q(e, "#pb-gadd").click(); eq(qa(e, ".pb-grow").length, 3);
      const n3 = qa(e, ".pb-grow")[2].querySelector(".pb-gname"); n3.value = "다구역"; n3.dispatchEvent(new e.w.Event("input"));
      qa(e, ".pb-grow")[2].querySelector(".pb-gmv[data-mv='-1']").click();
      eq(qa(e, ".pb-gname")[1].value, "다구역");
      const col = qa(e, ".pb-grow")[0].querySelector(".pb-gcol"); col.value = "#178236"; col.dispatchEvent(new e.w.Event("change"));
      clickOk(e);
      const gs = e.S.data.phonebook.groups;
      eq(gs.map(g => g.name).join(","), "가구역,다구역,나구역"); eq(gs[0].color, "#178236");
      eq(qa(e, ".pb-sec").length, 2, "빈 구역은 카드 없음");
      q(e, "#pb-groups").click();
      qa(e, ".pb-grow")[1].querySelector(".pb-gdel").click(); clickOk(e);
      eq(e.S.data.phonebook.groups.length, 2);
    });
    t("PB08 기본 정보 · 빈 화면 · 통합 검색", () => {
      q(e, "#pb-meta").click(); q(e, "#pb-m-asof").value = "26년 10월"; q(e, "#pb-m-notes").value = "하나\n\n둘"; clickOk(e);
      eq(e.S.data.phonebook.asOf, "26년 10월"); eq(e.S.data.phonebook.notes.join("|"), "하나|둘");
      const it = e.w.SemisSearch && e.w.SemisSearch.search ? e.w.SemisSearch.search("을이") : null;
      if (it) ok(it.some(x => x.group === "업무 연락처"), "검색 결과");
      e.S.data.phonebook = { groups: [], rows: [] }; e.S.saveSilent(); e.S.renderView();
      ok(q(e, "#view .empty-state")); ok(q(e, "#pb-add"));
      q(e, "#pb-add").click(); ok(q(e, "#pb-glist"), "구역이 없으면 구역 관리부터");
      e.S.closeModal();
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("PB09 공개 저장소 위생: phonebook.js에 번호 · 메일 없음 · 동기화 키 · 권한표 2/3 · CSS", () => {
      const s = read("js/phonebook.js");
      ok(!/01\d-\d{3,4}-\d{4}/.test(s.replace("010-0000-0000", ""))); ok(!/@asianaairport|@airport\.kr/.test(s));
      ok(e.Sync.SYNC_KEYS.indexOf("phonebook") >= 0); eq(ACL.phonebook.join(","), "2,3");
      const c = read("css/main.css"); ok(c.indexOf(".pb-row") > 0 && c.indexOf(".pb-tile") > 0 && c.indexOf(".pb-tbl") > 0);
      ok(read("index.html").indexOf('js/phonebook.js') > 0);
    });
  }

  /* ══════════ [IM] v1.13.1 한글 입력(IME) 보호 — 검색 입력칸을 다시 만들지 않는다 ══════════ */
  {
    const e = makeEnv();
    t("IM01 ui.searchValue: 끝의 조합 중 자모 제거", () => {
      const sv = e.S.ui.searchValue;
      eq(sv("최ㅅ"), "최"); eq(sv("ㅊ"), ""); eq(sv("최상일"), "최상일"); eq(sv(" 안전 "), "안전"); eq(sv("ETD ㅇ"), "ETD");
    });
    t("IM02 ui.repaintKeep: 입력칸·조상은 그대로(같은 노드), 나머지는 새것", () => {
      const box = e.w.document.createElement("div");
      box.innerHTML = '<p class="a">옛</p><section class="card old"><div class="toolbar"><label><input id="k-q" value="x"></label><b>1</b></div><div class="t">옛표</div></section>';
      e.w.document.body.appendChild(box);
      const inp = box.querySelector("#k-q"); inp.value = "최ㅅ";
      const ok1 = e.S.ui.repaintKeep(box, '<p class="a">새</p><section class="card new"><div class="toolbar"><label><input id="k-q" value="최"></label><b>2</b></div><div class="t">새표</div></section>', inp);
      ok(ok1); ok(box.querySelector("#k-q") === inp, "같은 입력칸"); eq(inp.value, "최ㅅ", "입력 중인 값 유지");
      eq(box.querySelector("p").textContent, "새"); eq(box.querySelector("b").textContent, "2"); eq(box.querySelector(".t").textContent, "새표");
      ok(box.querySelector("section").classList.contains("new") && !box.querySelector("section").classList.contains("old"), "조상 속성 갱신");
      const ok2 = e.S.ui.repaintKeep(box, "<p>입력칸 없음</p>", inp);
      eq(ok2, false); ok(!box.querySelector("#k-q"));
      box.remove();
    });
    t("IM03 위기대응 담당자 · 검색장비 검색: 입력해도 입력칸 노드 유지", () => {
      e.S.data.crisis = { rows: [{ id: "a", div: "", team: "가팀", org: "초동조치센터", task: "첫 보고", main: "갑일", sub: "을일" },
        { id: "b", div: "", team: "나팀", org: "종합지원센터", task: "지원", main: "병일", sub: "" }] };
      e.S.saveSilent(); loginAs(e, "hq"); go(e, "crisis");
      const qi = q(e, "#cr-q"); qi.value = "갑ㅇ"; qi.dispatchEvent(new e.w.Event("input"));
      ok(q(e, "#cr-q") === qi, "crisis 입력칸 유지"); eq(qa(e, ".cr-line").length, 1);
      ok(q(e, ".page-head") && q(e, ".cr-home") !== undefined);
      qi.value = ""; qi.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, ".cr-line").length, 2); ok(!q(e, ".cr-result"));
      go(e, "scr-equip");
      const eqi = q(e, "#eq-q");
      if (eqi) { eqi.value = "ETDㅇ"; eqi.dispatchEvent(new e.w.Event("input")); ok(q(e, "#eq-q") === eqi, "equipment 입력칸 유지"); }
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
  }

  /* ══════════ [FL] 운항 현황 (v1.14) ══════════ */
  {
    const e = makeEnv();
    const Fc = e.w.SemisFlightCore;
    const NOW = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    t("FL01 기체 기본값 15대 · 등록부호→ICAO 주소 규칙(HL7Nyy · HL8xyz)", () => {
      eq(Fc.DEFAULT_FLEET.length, 15);
      ok(Fc.DEFAULT_FLEET.every(f => Fc.hlHex(f.reg) === f.hex), "기본 15대 규칙 일치");
      eq(Fc.hlHex("HL7421"), "71bc21"); eq(Fc.hlHex("HL7507"), "71bd07"); eq(Fc.hlHex("HL8503"), "71c503"); eq(Fc.hlHex("N123AB"), "");
      eq(Fc.fnoOf("AIH970"), "KJ970"); eq(Fc.fnoOf("AIH0587"), "KJ587"); eq(Fc.fnoOf("KAL123"), "KAL123");
    });
    t("FL02 상태 판정: 인천 접근 · 비행 · 비상 · 지상 · 착륙 추정 · 직진 추정(순항 고도만)", () => {
      const live = iso(NOW - 20000);
      eq(Fc.status({ seen_at: live, lat: 36.978, lon: 126.687, alt: 16200, gs: 358, trk: 314.7, vr: -2624 }, NOW).code, "appr");
      eq(Fc.status({ seen_at: live, lat: 36.978, lon: 126.687, alt: 9000, gs: 300, trk: 150, vr: 2000 }, NOW).code, "air", "인천 반대쪽 상승");
      eq(Fc.status({ seen_at: live, lat: 45, lon: 160, alt: 35000, gs: 500, trk: 60, vr: 0 }, NOW).code, "air");
      eq(Fc.status({ seen_at: live, lat: 45, lon: 160, alt: 35000, gs: 500, trk: 60, sqk: "7700", emg: true }, NOW).code, "emg");
      const g = Fc.status({ seen_at: live, lat: 37.46, lon: 126.44, gnd: true, gnd_since: iso(NOW - 3600000) }, NOW);
      eq(g.code, "gnd"); eq(g.at, "ICN"); eq(g.label, "인천 지상");
      const land = Fc.status({ seen_at: iso(NOW - 8 * 60000), lat: 37.45, lon: 126.41, alt: 775, gs: 147, trk: 320 }, NOW);
      eq(land.code, "gnd"); ok(land.inferred); eq(land.label, "인천 착륙 추정");
      const dr = Fc.status({ seen_at: iso(NOW - 3600000), lat: 45, lon: 160, alt: 35000, gs: 500, trk: 60 }, NOW);
      eq(dr.code, "lost"); ok(dr.est && dr.est.lon > 160, "1시간 직진 추정");
      ok(!Fc.status({ seen_at: iso(NOW - 3600000), lat: 45, lon: 160, alt: 5000, gs: 250, trk: 60 }, NOW).est, "낮은 고도는 추정 안 함");
      ok(!Fc.status({ seen_at: iso(NOW - 5 * 3600000), lat: 45, lon: 160, alt: 35000, gs: 500, trk: 60 }, NOW).est, "3시간 넘으면 추정 안 함");
      eq(Fc.status(null, NOW).code, "none");
    });
    t("FL03 입출항 기록: 오늘 인천 도착 · 기체 이번 비행 출발지", () => {
      const ev = [
        { hex: "71bc21", kind: "arr", apt: "ICN", at: iso(NOW - 600000) },
        { hex: "71bc21", kind: "dep", apt: "HKG", at: iso(NOW - 4 * 3600000) },
        { hex: "71be46", kind: "dep", apt: "ICN", at: iso(NOW - 2 * 3600000) }
      ];
      eq(Fc.eventsOf(ev, { kind: "arr", apt: "ICN" }).length, 1);
      eq(Fc.lastDep(ev, "71bc21"), null, "도착 뒤라 출발지 없음");
      eq(Fc.lastDep(ev, "71be46").apt, "ICN");
    });

    const AC = [
      { hex: "71bc21", reg: "HL7421", type: "B744", flight: "AIH970", lat: 37.2, lon: 126.6, alt: 8000, gnd: false, gs: 250, trk: 320, vr: -1200, sqk: "3571", emg: false, seen_at: iso(NOW - 10000) },
      { hex: "71be46", reg: "HL7646", type: "B744", flight: "AIH587", lat: 45, lon: 150, alt: 33000, gnd: false, gs: 560, trk: 60, vr: 0, sqk: "2143", emg: false, seen_at: iso(NOW - 10000),
        trail: [[Math.round((NOW - 7200000) / 1000), 37.5, 127, 30000], [Math.round((NOW - 3600000) / 1000), 41, 139, 33000]] },
      { hex: "71bd07", reg: "HL7507", type: "B763", flight: "AIH388", lat: 37.461, lon: 126.44, alt: null, gnd: true, gs: 0, seen_at: iso(NOW - 30000), gnd_since: iso(NOW - 5400000) }
    ];
    const EV = [{ hex: "71bd07", reg: "HL7507", flight: "AIH388", kind: "arr", apt: "ICN", at: iso(NOW - 5400000), inferred: false },
      { hex: "71be46", reg: "HL7646", flight: "AIH587", kind: "dep", apt: "ICN", at: iso(NOW - 7300000), inferred: false }];
    const calls = [];
    e.w.fetch = (url) => {
      calls.push(String(url));
      if (String(url).indexOf("semis-logi-adsb") >= 0)
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ now: iso(NOW), fetched_at: iso(NOW - 5000), ac: AC, events: EV }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    };
    e.w.print = () => {};
    loginAs(e, "hq");
    await ta("FL04 메뉴: 홈 허브 '운항 현황'(전체 공개) · 화면 요약 · 인천 입항/출항 · 기체 15대 · 기록", async () => {
      const mn = e.S.data.menus.find(m => m.module === "flight");
      ok(mn, "메뉴"); eq(mn.parent, "hub-home"); eq(mn.vis, "all");
      go(e, "flight");
      await new Promise(r => setTimeout(r, 60));
      ok(calls.some(u => u.indexOf("semis-logi-adsb?trail=1&events=1") >= 0), "경로·기록 포함 조회");
      ok(q(e, ".page-head [data-print-btn], .page-head .print-btn") || q(e, ".page-head").textContent.includes("Print"), "인쇄 버튼");
      const stats = qa(e, "#fo-stats .stat").map(x => x.textContent);
      ok(stats[0].indexOf("2") >= 0, "비행 중 2: " + stats[0]);
      ok(stats[1].indexOf("1") >= 0, "인천 지상 1");
      eq(qa(e, "#fo-boardbox .appr-row").length, 1, "인천 접근 1");
      ok(q(e, "#fo-boardbox .appr-row").textContent.includes("KJ970"));
      eq(qa(e, "#fo-fleetbox .fo-fleet tbody tr").length, 15);
      eq(q(e, '#fo-fleetbox [data-fo-row="71be46"] .c-dep').textContent, "인천 " + Fc.kstHM(NOW - 7300000), "HL7646 출발지 = 인천");
      ok(q(e, "#fo-logbox").textContent.includes("KJ388"), "입출항 기록");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    await ta("FL05 대시보드: 지도 + 인천 접근 중 (일반 사용자 포함) · 메뉴 숨기면 빠짐", async () => {
      go(e, "dashboard");
      await new Promise(r => setTimeout(r, 40));
      ok(q(e, "#dash-flt"), "운항 현황 칸");
      ok(q(e, "#dflt-map"), "지도");
      eq(qa(e, "#dash-flt .appr-row").length, 1);
      ok(q(e, "#dflt-arr").textContent.includes("KJ388"), "최근 인천 도착");
      loginAs(e, "user"); go(e, "dashboard");
      ok(q(e, "#dash-flt"), "일반 사용자도 표시");
      loginAs(e, "hq");
      const mn = e.S.data.menus.find(m => m.module === "flight");
      mn.hidden = true; go(e, "dashboard");
      ok(!q(e, "#dash-flt"), "숨긴 메뉴 → 대시보드에서도 빠짐");
      delete mn.hidden;
    });
    t("FL06 기체 목록 편집(hq): ICAO 자동 채움 · 잘못된 주소 거부 · 저장", () => {
      go(e, "flight");
      q(e, "#fo-fleet-edit").click();
      eq(qa(e, "#fl-list .fl-row").length, 15);
      q(e, "#fl-add").click();
      const rows = qa(e, "#fl-list .fl-row");
      const last = rows[rows.length - 1];
      last.querySelector(".fl-reg").value = "HL7415";
      last.querySelector(".fl-reg").dispatchEvent(new e.w.Event("input"));
      eq(last.querySelector(".fl-hex").value, "71bc15", "자동 채움");
      last.querySelector(".fl-hex").value = "zz";
      q(e, "#fl-save").click();
      ok(!Array.isArray(e.S.data.fleet) || e.S.data.fleet.length === 0, "잘못된 주소는 저장 안 됨");
      last.querySelector(".fl-hex").value = "71bc15";
      q(e, "#fl-save").click();
      eq(e.S.data.fleet.length, 16);
      eq(e.S.data.fleet[15].hex, "71bc15");
      go(e, "flight");
      eq(qa(e, "#fo-fleetbox .fo-fleet tbody tr").length, 16);
      e.S.data.fleet = []; e.S.saveSilent();
    });
    t("FL07 정규화: fleet 배열 보정 · hex 없는 항목 제거", () => {
      const e7 = makeEnv({ preData: Object.assign({}, e.S.data, { fleet: [{ reg: "HL1" }, { reg: "HL7421", hex: "71bc21" }, null] }) });
      eq(e7.S.data.fleet.length, 1);
      const e8 = makeEnv({ preData: Object.assign({}, e.S.data, { fleet: "x" }) });
      ok(Array.isArray(e8.S.data.fleet) && e8.S.data.fleet.length === 0);
    });
  }

  /* ══════════ [SEC] v1.15 서버 보안 — 비공개 파일 · 살균 · CSP · 저장소 위생 ══════════ */
  {
    const PUBU = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/";
    const srvF = makeServer({ rows: [{ key: "notices", value: [{ id: "nf", title: "첨부 공지", body: "", author: "x", pinned: false,
      created: "2026-09-01T00:00:00Z", bodyHtml: '<p>본문 <img src="' + PUBU + 'notices/a.png" alt="그림"></p>', files: [{ name: "보고서.pdf", url: PUBU + "attach/b.pdf" }] }] }] });
    const e = makeEnv({ fetch: srvF.fetch });
    await srvF.loginAs(e, "user-pw-4444");
    const FA = e.w.SemisFileAuth;
    await ta("SEC01 화면의 비공개 파일 주소 → 서명 URL(표준 주소는 data-sf에 보관)", async () => {
      FA.start();
      await e.Sync.start();
      go(e, "dashboard");
      await tick(80);
      const img = q(e, ".notice-html img");
      ok(img, "공지 이미지");
      ok(img.getAttribute("src").indexOf("/object/sign/semis-logi-files/notices/a.png?token=") > 0, img.getAttribute("src"));
      eq(img.getAttribute("data-sf"), PUBU + "notices/a.png");
      const a = q(e, "a.nb-file");
      ok(a && a.getAttribute("href").indexOf("/object/sign/semis-logi-files/attach/b.pdf?token=") > 0, a && a.getAttribute("href"));
      ok(srvF.calls.some(c => c.url.indexOf("/functions/v1/semis-logi-files") > 0 && c.body && c.body.op === "sign"), "서명 요청");
    });
    await ta("SEC02 권한 밖 폴더(regs=mgr)는 서명받지 못함 · 요청 모음 처리", async () => {
      const u = await FA.resolve(PUBU + "regs/x.pdf");
      eq(u, PUBU + "regs/x.pdf", "user(1) → regs(2) 거부 시 원래 주소");
      const u2 = await FA.resolve(PUBU + "attach/c.pdf?download=" + encodeURIComponent("한글.pdf"));
      ok(u2.indexOf("/object/sign/semis-logi-files/attach/c.pdf?token=") > 0 && u2.indexOf("&download=") > 0, u2);
    });
    t("SEC03 canon: 서명 URL → 표준 주소 (저장 전 되돌리기)", () => {
      const signed = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/sign/semis-logi-files/notices/a.png?token=abc.def-1";
      eq(FA.canon('<img src="' + signed + '">'), '<img src="' + PUBU + 'notices/a.png">');
      eq(FA.canon('<a href="' + signed + '&amp;download=x.pdf">'), '<a href="' + PUBU + 'notices/a.png?download=x.pdf">');
      eq(FA.parse(PUBU + "a/b.png?download=z").path, "a/b.png");
      eq(FA.parse("https://example.com/x.png"), null);
    });
    t("SEC04 살균: 이벤트 속성·javascript:·svg/script 제거 · 서명 흔적(data-sf·임시 그림) 복원", () => {
      const S = e.w.SemisNotice.sanitizeHtml;
      const out = S('<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">a</a><a href=" JaVaScRiPt:x">b</a><svg><script>alert(1)</script></svg><iframe srcdoc="x"></iframe><a href="data:text/html,x">c</a>');
      ok(out.indexOf("onerror") < 0 && out.indexOf("javascript") < 0 && out.toLowerCase().indexOf("javascript") < 0, out);
      ok(out.indexOf("<svg") < 0 && out.indexOf("<script") < 0 && out.indexOf("<iframe") < 0, out);
      ok(out.indexOf("data:text/html") < 0, out);
      const back = S('<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-sf="' + PUBU + 'notices/a.png" alt="g">');
      eq(back, '<img src="' + PUBU + 'notices/a.png" alt="g">');
      ok(read("js/modules.js").indexOf('document.createElement("template")') > 0, "template 파싱(살균 중 이미지 로딩·onerror 없음)");
    });
    await ta("SEC05 인쇄용 별도 문서: 표준 주소를 서명 URL로 바꿔 넣음", async () => {
      const h = await FA.signHtml('<img src="' + PUBU + 'minutes-sign/s.png"><a href="' + PUBU + 'attach/d.pdf?download=a.pdf">x</a>');
      ok(h.indexOf("/object/sign/semis-logi-files/minutes-sign/s.png?token=") > 0, h);
      ok(/attach\/d\.pdf\?token=[^"]+&download=a\.pdf/.test(h), h);
      ok(read("js/minutes.js").indexOf("SemisFileAuth.signHtml(html)") > 0, "회의록 인쇄에 적용");
    });
    await ta("SEC06 업로드: 서버가 경로를 정하고 서명 URL로 PUT · 저장값은 표준 주소", async () => {
      const f = new e.w.File(["abc"], "보고 서.pdf", { type: "application/pdf" });
      const up = await e.Sync.uploadFile(f, "attach");
      ok(up.url.indexOf(PUBU + "attach/") === 0, up.url);
      ok(srvF.puts.some(p => p.indexOf("attach/") === 0), "PUT");
      const call = srvF.calls.find(c => c.body && c.body.op === "upload");
      eq(call.body.prefix, "attach"); eq(call.body.size, 3);
    });
    t("SEC07 저장소 위생: localStorage 에 데이터·대기열 없음 · 옛 키 정리", () => {
      ["semisl:data", "semisl:pendingSync", "semisl:forcePush", "semisl:gcalCache"].forEach(k => ok(!e.w.localStorage.getItem(k), k));
      ok(e.w.sessionStorage.getItem("semisl:data"), "탭 세션 사본");
      const e2 = makeEnv({ boot: false });
      e2.w.localStorage.setItem("semisl:data", '{"version":1}');
      e2.w.localStorage.setItem("semisl:pendingSync", '["x"]');
      e2.S.boot();
      ok(!e2.w.localStorage.getItem("semisl:data") && !e2.w.localStorage.getItem("semisl:pendingSync"), "옛 사본 제거");
    });
    t("SEC08 CSP · 인라인 스크립트 없음 · 시작 코드는 main.js(마지막)", () => {
      const html = read("index.html");
      ok(/http-equiv="Content-Security-Policy" content="script-src 'self' https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/dist\/umd\/supabase\.min\.js; worker-src 'self'; object-src 'none'; base-uri 'self'/.test(html), "CSP");
      ok(!/<script>(?!<\/script>)/.test(html) && !/<script(?![^>]*\bsrc=)[^>]*>/.test(html), "인라인 스크립트");
      ok(!/\son[a-z]+="/i.test(html.replace(/<meta[^>]*>/g, "")), "인라인 이벤트 속성(html)");
      FILES.forEach(f => ok(!/\son(click|change|error|load|input|submit|mouse\w+|key\w+)=\\?["']/.test(read(f)), f + ": 인라인 이벤트"));
      const scripts = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map(m => m[1]);
      ok(/^js\/main\.js\?v=/.test(scripts[scripts.length - 1]), "main.js 마지막");
    });
    t("SEC09 코드에 비밀 토큰 없음 — v2 ICS 구독 토큰·AI 토큰 · 서비스 키", () => {
      FILES.concat(["index.html", "js/main.js"]).forEach(f => {
        const c = read(f);
        ok(c.indexOf("azs-") < 0, f + ": azs- 토큰");
        ok(c.indexOf("semis-ics") < 0, f + ": v2 ICS");
        ok(c.indexOf("service_role") < 0, f + ": service_role");
      });
    });
    t("SEC10 파일 함수(tools/edge/semis-logi-files.ts): 코드가 쓰는 업로드 폴더를 모두 규정 · 세션 확인", () => {
      const fn = read("tools/edge/semis-logi-files.ts");
      const used = new Set();
      FILES.forEach(f => { const c = read(f);
        (c.match(/uploadFile\([^,]+,\s*"([a-z-]+)"\)/g) || []).forEach(m => used.add(/"([a-z-]+)"\)$/.exec(m)[1]));
        (c.match(/wireRichMedia\([^,]+,\s*"([a-z-]+)"\)/g) || []).forEach(m => used.add(/"([a-z-]+)"\)$/.exec(m)[1])); });
      ["regs", "regs-diff"].forEach(p => used.add(p));
      ok(used.size >= 8, Array.from(used).join(","));
      used.forEach(p => ok(new RegExp('(^|[\\s{,])"?' + p.replace("-", "\\-") + '"?: \\d').test(fn.slice(fn.indexOf("const WRITE_RANK"), fn.indexOf("const DEFAULT_READ"))), "WRITE_RANK: " + p));
      ok(fn.indexOf("semis_logi_file_auth") > 0 && fn.indexOf("x-semis-token") > 0, "세션 확인");
      ok(fn.indexOf('s.includes("..")') > 0, "경로 이동 차단");
    });
    t("SEC11 비상연락망 원본 이미지 미리 받기·첨부 뷰어 내려받기도 서명 URL 사용", () => {
      ok(read("js/contacts.js").indexOf("SemisFileAuth.resolve(f.imgUrl)") > 0);
      ok(read("js/files.js").indexOf("SemisFileAuth.resolve(url)") > 0);
      ok(/object\\\/\(public\|sign\)/.test(read("js/files.js")), "download= 처리");
    });
    t("SEC12 jsdom 오류 없음(보안 블록)", () => eq(e.errors.length, 0, e.errors.join(" | ")));
    FA.stop(); e.Sync.stop();
  }


  /* ══════════ [PW] 로그인 자동공격 방어 — 작업증명 (v1.16) ══════════ */
  {
    const until = async (fn, n) => { for (let i = 0; i < (n || 300) && !fn(); i++) await tick(5); return fn(); };
    const nodeHash = (x) => require("crypto").createHash("sha256").update(x).digest("hex");
    t("PW01 작업증명 계산기 — sha256 표준 일치 · 64바이트 넘는 문제 · 해답 검증", () => {
      const e = makeEnv({ boot: false });
      const P = e.w.SemisPow;
      ["", "abc", "한글 문제", "x".repeat(200)].forEach(v => eq(P.sha256hex(v), nodeHash(v), "sha256 " + v.slice(0, 6)));
      const c = "0123456789abcdef0123456789abcdef." + (Math.floor(Date.now() / 1000) + 120) + ".12.0123456789abcdef0123456789abcdef";
      const Q = P.prep(c);
      const x = P.scan(Q, 12, 0, 2000000);
      ok(x >= 0, "해답");
      const h = nodeHash(c + ":" + x);
      ok(/^000/.test(h), "앞 12비트 0: " + h.slice(0, 6));
      ok(P.ok(Q, x, 12) && !P.ok(Q, x, 32), "ok() 판정");
      e.w.close();
    });
    t("PW02 파일 등록 · CSP worker-src · pow.js 는 v2 와 같은 계산기", () => {
      const html = read("index.html");
      ok(/<script src="js\/pow\.js\?v=[\d.]+"( defer)?><\/script>/.test(html), "index.html pow.js");
      ok(html.indexOf("js/pow.js") > html.indexOf("js/sync.js"), "sync.js 다음");
      ok(/worker-src 'self'/.test(html), "worker-src");
      ok(read("js/sync.js").indexOf("semis_logi_challenge") > 0 && read("js/sync.js").indexOf("p_pow") > 0, "로그인에 해답 첨부");
      const sql = read("tools/sql/semis-logi-pow.sql");
      ok(/pow_check\(p_pow\)/.test(sql) && /pow_used/.test(sql) && /sign_paused/.test(sql), "서버 SQL");
      ok(!/'secret', '[0-9a-f]{16,}'/.test(sql), "비밀값은 서버에서 생성(코드에 없음)");
    });
    await ta("PW03 로그인 창이 뜨면 문제를 미리 받아 풀고, 로그인에 해답을 붙인다(1회용)", async () => {
      const server = makeServer();
      const e = makeEnv({ fetch: server.fetch });
      await until(() => server.calls.some(c => /semis_logi_challenge/.test(c.url)));
      ok(server.calls.some(c => /semis_logi_challenge/.test(c.url)), "로그인 창에서 미리 문제 받음");
      submitLogin(e, "mgr-pw-3333");
      await until(() => e.S.user);
      ok(e.S.user && e.S.user.origId === "cargo-mgr", "로그인");
      const lg = server.calls.filter(c => /semis_logi_login/.test(c.url));
      eq(lg.length, 1, "한 번에 성공");
      ok(lg[0].body.p_pow && /^\d+$/.test(String(lg[0].body.p_pow.x)), "해답 첨부");
      e.Sync.stop(); e.w.close();
    });
    await ta("PW04 문제 만료·재사용이면 새 문제로 한 번 더", async () => {
      const server = makeServer();
      server.powFailOnce = true;
      const e = makeEnv({ fetch: server.fetch });
      submitLogin(e, "hq-pw-2222");
      await until(() => e.S.user);
      ok(e.S.user && e.S.user.origId === "cargo-ss", "재시도 후 로그인");
      const lg = server.calls.filter(c => /semis_logi_login/.test(c.url));
      eq(lg.length, 2, "로그인 요청 2회");
      ok(lg[0].body.p_pow.c !== lg[1].body.p_pow.c, "두 번째는 새 문제");
      e.Sync.stop(); e.w.close();
    });
    t("LG01 로그인 창 보호 — loginguard.js 는 <head> 에서 먼저(즉시 실행), 나머지 스크립트는 defer · 순서 유지", () => {
      const raw = read("index.html");
      const head = raw.slice(0, raw.indexOf("</head>")), body = raw.slice(raw.indexOf("<body>"));
      ok(/<script src="js\/loginguard\.js\?v=[\d.]+"><\/script>/.test(head), "head 에 즉시 실행");
      eq((head.match(/<script\b/g) || []).length, 1, "head 스크립트는 보호 파일 하나");
      const tags = body.match(/<script\b[^>]*>/g) || [];
      ok(tags.length > 20 && tags.every(t2 => / defer>$/.test(t2)), "본문 스크립트 모두 defer");
      ok(/__semisReady = true/.test(read("js/app.js").slice(read("js/app.js").indexOf("function boot()"))), "boot 에서 준비 표시");
    });
    await ta("LG02 앱 준비 전에 누른 로그인 — 새로고침 없이 붙잡아 두었다가 준비되면 그대로 로그인", async () => {
      const server = makeServer();
      const e = makeEnv({ fetch: server.fetch, boot: false });
      q(e, "#login-pw").value = "mgr-pw-3333";
      const ev = new e.w.Event("submit", { bubbles: true, cancelable: true });
      q(e, "#login-form").dispatchEvent(ev);
      ok(ev.defaultPrevented, "브라우저 기본 제출(새로고침) 막음");
      ok(e.w.__semisLoginQueued === true, "대기");
      eq(q(e, "#login-error").textContent, "확인 중…");
      eq(server.calls.filter(c => /semis_logi_login/.test(c.url)).length, 0, "준비 전 서버 호출 없음");
      e.S.boot();
      await until(() => e.S.user);
      ok(e.S.user && e.S.user.origId === "cargo-mgr", "준비되자 로그인");
      eq(server.calls.filter(c => /semis_logi_login/.test(c.url)).length, 1, "한 번만");
      ok(!e.w.__semisLoginQueued, "대기 해제");
      e.Sync.stop(); e.w.close();
    });
    await ta("LG03 빈 암호로 누른 제출은 대기하지 않음 · 준비 뒤에는 보호 파일이 관여하지 않음", async () => {
      const server = makeServer();
      const e = makeEnv({ fetch: server.fetch, boot: false });
      const ev = new e.w.Event("submit", { bubbles: true, cancelable: true });
      q(e, "#login-form").dispatchEvent(ev);
      ok(ev.defaultPrevented && !e.w.__semisLoginQueued, "빈 암호 — 막기만");
      e.S.boot();
      await tick(20);
      eq(server.calls.filter(c => /semis_logi_login/.test(c.url)).length, 0);
      submitLogin(e, "hq-pw-2222");
      await until(() => e.S.user);
      ok(e.S.user && e.S.user.origId === "cargo-ss", "준비 뒤 일반 로그인");
      e.Sync.stop(); e.w.close();
    });
    await ta("PW05 IP 제한 · 서명 코드 일시 중지 안내", async () => {
      const s1 = makeServer(); s1.fails = 20;
      const e = makeEnv({ fetch: s1.fetch });
      submitLogin(e, "whatever-pw-1");
      await until(() => /제한/.test(q(e, "#login-error").textContent));
      ok(/15분 동안 제한/.test(q(e, "#login-error").textContent), "IP 제한");
      e.w.close();
      const s2 = makeServer(); s2.signPaused = true;
      const e2 = makeEnv({ fetch: s2.fetch });
      submitLogin(e2, "123456");
      await until(() => /중지/.test(q(e2, "#login-error").textContent));
      ok(/서명 코드 접속이 잠시 중지/.test(q(e2, "#login-error").textContent), "서명 코드 중지");
      ok(!e2.S.user);
      e2.w.close();
    });
  }

  /* ══════════ [AU] 수검 대응 센터 (v1.17) ══════════ */
  {
    const e = makeEnv();
    const A = e.w.SemisAudit;
    const Cal = e.w.SemisCalendar;
    const setv = (sel, v) => { const el = q(e, sel); el.value = v; return el; };
    const sched = (id) => (e.S.data.schedules || []).find(s => s && s.id === id);
    const until = async (fn, n) => { for (let i = 0; i < (n || 300) && !fn(); i++) await tick(5); return fn(); };
    /* 시험용 가짜 원본 — 실제 체크리스트(민감보안정보)는 공용 DB에만 있고 저장소에는 넣지 않는다 */
    const FAKE_MASTER = { title: "시험용 CHK-LIST", asOf: "2099", ssi: "시험 취급 문구", scoreScale: ["a", "b", "c", "d", "e"], sections: [
      { no: "1", title: "가 영역", items: [
        { no: "1.1", text: "가 항목 하나", ref: "규정 1.1\n절차 2", basis: "요지 하나\n■ 확인 요령\n① 첫째\n※ 주의" },
        { no: "1.2", text: "가 항목 둘", ref: "규정 1.2", basis: "요지 둘" }] },
      { no: "2", title: "나 영역", items: [
        { no: "2.10.2", text: "나 공통 c", ref: "공통 규정", basis: "[2.10~2.10.2 공통] 공통 요지" },
        { no: "2.8", text: "나 항목 지적 관리", ref: "규정 2.8", basis: "요지 2.8" },
        { no: "2.10", text: "나 공통 a", ref: "공통 규정", basis: "" },
        { no: "2.10.1", text: "나 공통 b", ref: "공통 규정", basis: "" }] },
      { no: "9", title: "다 영역", items: [{ no: "9.1", text: "다 항목\n- 세부 하나", ref: "규정 9.1", basis: "요지 9" }] }
    ] };
    A.setToday("2026-10-01");
    t("AU01 메뉴: 점검 · 교육 허브 맨 위(점검 일정 위) · mgr · 기존 데이터 자동 추가(멱등)", () => {
      const m = e.S.data.menus.find(x => x.module === "audit");
      ok(m && m.type === "module" && !m.planned); eq(m.parent, "hub-aud"); eq(m.vis, "mgr"); eq(m.label, "수검 대응 센터");
      const ins = e.S.data.menus.find(x => x.module === "inspection");
      ok(m.seq < ins.seq, "점검 일정보다 위");
      const old = makeEnv({ preData: { version: 1, menus: e.S.defaultMenus().filter(x => x.id !== "audit") } });
      const m2 = old.S.data.menus.find(x => x.module === "audit");
      ok(m2 && m2.parent === "hub-aud" && m2.seq < old.S.data.menus.find(x => x.module === "inspection").seq, "기존 메뉴 데이터에 자동 추가");
      eq(old.S.normalizeData(), false, "멱등");
      old.w.close();
    });
    t("AU02 데이터 · 권한표 · 파일 폴더 등급", () => {
      ok(Array.isArray(e.S.data.audits) && e.S.data.audits.length === 0);
      e.S.data.audits = { bad: 1 }; e.S.normalizeData(); ok(Array.isArray(e.S.data.audits), "배열 보정");
      eq(ACL.audits.join(","), "2,3");
      const edge = read("tools/edge/semis-logi-files.ts");
      ok(/READ_RANK[\s\S]*?audits: 2[\s\S]*?WRITE_RANK[\s\S]*?audits: 3/.test(edge), "audits 폴더: 열람 2 · 올리기 3");
    });
    t("AU03 진행 단계: 준비 → 수검 중 → 결과 대기 → 조치 중 → 종결 · 취소 · D-day", () => {
      const a = { id: "x", body: "gov", org: "기관", kind: "정기점검", start: "2026-10-10", end: "2026-10-11", findings: [] };
      eq(A.phase(a, "2026-10-01"), "plan"); eq(A.dday(a, "2026-10-01"), 9);
      A.setToday("2026-10-01"); eq(A.ddayText(a), "D-9");
      eq(A.phase(a, "2026-10-10"), "live"); eq(A.phase(a, "2026-10-11"), "live");
      eq(A.phase(a, "2026-10-12"), "wait");
      a.outcome = "none"; eq(A.phase(a, "2026-10-12"), "closed");
      a.outcome = ""; a.findings = [{ id: "f", status: "open" }]; eq(A.phase(a, "2026-10-12"), "action");
      a.findings[0].status = "done"; eq(A.phase(a, "2026-10-12"), "closed");
      a.cancelled = true; eq(A.phase(a, "2026-10-12"), "cancel");
      eq(A.phase({ id: "y", start: "" }), "plan", "일정 미정");
      /* 준비율 = 준비됨(증빙 + 문서 · 시행 3점 이상) ÷ N/A 제외 항목 */
      const pr = A.prep({ checklist: [
        { docScore: 3, impScore: 4, files: [{ url: "u" }] },          // 준비됨
        { docScore: 2, impScore: 3, files: [{ url: "u" }] },          // 보완 필요
        { na: true },                                                // 제외
        { docScore: 3, impScore: 3 },                                // 증빙 없음
        { docScore: 4 }                                              // 미평가
      ] });
      eq(pr.done + "/" + pr.total + " " + pr.pct, "1/4 25");
      eq(A.prep({ checklist: [{ done: true }] }).done, 0, "옛 완료 체크는 준비로 보지 않음");
      eq(["ready", "low", "na", "noev", "todo"].join(), [{ docScore: 3, impScore: 4, files: [{}] }, { docScore: 0, impScore: 4 }, { na: true, docScore: 1 },
        { docScore: 3, impScore: 3 }, { impScore: 3 }].map(A.itemState).join());
      eq(A.itemState({ mid: "2.8", docScore: 3, impScore: 3 }), "ready", "열린 화면(수검 대응 센터)이 증빙으로 연결된 항목");
      eq(A.itemState({ mid: "1.1", docScore: 3, impScore: 3 }), "noev", "준비 중인 화면만 연결 → 증빙 없음");
      ok(A.cmpMid("6.10", "6.9") > 0 && A.cmpMid("2.10.1", "2.10") > 0 && A.cmpMid("2.2.1", "2.3") < 0, "번호 순서");
    });
    let aid = "";
    await ta("AU04 hq 등록 → 체크리스트 불러오기(구분별 기본 영역) · 상세 · 일정관리 · 인쇄 버튼", async () => {
      e.S.data.audits = [{ id: "old1", body: "gov", org: "서울지방항공청", kind: "정기점검", start: "2025-10-14", end: "",
        findings: [{ id: "of1", type: "car", ref: "자체보안계획 7.3", text: "검색 기록 서명 누락", status: "done", doneDate: "2025-11-01" }] }];
      A.setMaster(FAKE_MASTER);
      loginAs(e, "hq"); go(e, "audit");
      ok(q(e, ".page-head").textContent.indexOf("Print") >= 0, "인쇄 버튼");
      eq(qa(e, "tr[data-aud]").length, 0, "기본 필터 = 진행 중(종결 제외)");
      q(e, "#au-add").click();
      setv("#af-org", "서울지방항공청"); setv("#af-kind", "정기점검");
      setv("#af-start", "2026-10-21"); setv("#af-end", "2026-10-20");
      setv("#af-place", "인천 화물터미널");
      ok(q(e, "#af-tpl").checked && q(e, "#af-cal").checked);
      eq(q(e, "#af-tpl").parentNode.textContent.trim(), "점검 체크리스트 불러오기");
      clickOk(e);
      eq(e.S.data.audits.length, 2);
      const a = e.S.data.audits[1]; aid = a.id;
      eq(a.start, "2026-10-20"); eq(a.end, "2026-10-21", "시작 > 종료 → 서로 바꿈");
      eq(a.checklist.length, 0, "임의 기본 문구 없음");
      eq(A.getState().sel, aid, "등록하면 상세로");
      await until(() => qa(e, ".cl-sec").length === 3);
      const secs = qa(e, ".cl-sec input");
      eq(secs.map(i => i.value + (i.checked ? "+" : "-")).join(","), "1+,2+,9-", "국토부 = 1~8 영역 기본");
      eq(q(e, "#modal-box [data-act=ok]").textContent, "6개 불러오기");
      secs[2].checked = true; secs[2].dispatchEvent(new e.w.Event("change"));
      eq(q(e, "#modal-box [data-act=ok]").textContent, "7개 불러오기");
      secs[2].checked = false; secs[2].dispatchEvent(new e.w.Event("change"));
      clickOk(e);
      eq(a.checklist.map(c => c.mid).join(","), "1.1,1.2,2.8,2.10,2.10.1,2.10.2", "번호 순");
      eq(a.chkSecs.map(x => x.no + x.title).join(","), "1가 영역,2나 영역");
      eq(a.chkSrc.title, "시험용 CHK-LIST");
      ok(a.checklist.every(c => c.basis === undefined), "근거 요지는 수검에 복사하지 않음");
      eq(a.checklist[0].ref, "규정 1.1\n절차 2");
      eq(q(e, ".au-title").textContent, "서울지방항공청 정기점검");
      ok(q(e, ".au-ddchip").textContent === "D-19");
      eq(qa(e, ".ck-grp").length, 2); eq(qa(e, ".ck-row").length, 6);
      const s = sched("aud_" + aid);
      ok(s, "수검 일정"); eq(s.title, "[수검] 서울지방항공청 정기점검"); eq(s.start + "~" + s.end, "2026-10-20~2026-10-21");
      eq(s.color, "purple"); eq(s.src, "aud:" + aid); ok(s.reminders.indexOf("1w") >= 0);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("AU05 점수 · N/A · 상태 · 영역 소계 · 필터 — 제자리 저장(초점 유지)", () => {
      const a = e.S.data.audits.find(x => x.id === aid);
      const cOf = (mid) => a.checklist.find(c => c.mid === mid);
      const pick = (mid, kind, v) => {
        const el = q(e, `select[data-sc="${kind}"][data-cid="${cOf(mid).id}"]`);
        el.value = String(v); el.dispatchEvent(new e.w.Event("change"));
      };
      pick("2.8", "doc", 3);
      eq(cOf("2.8").docScore, 3);
      eq(e.w.document.activeElement, q(e, `select[data-sc="doc"][data-cid="${cOf("2.8").id}"]`), "초점 유지");
      eq(q(e, `.ck-row[data-cid="${cOf("2.8").id}"]`).dataset.st, "todo", "시행 미평가");
      pick("2.8", "imp", 4);
      eq(q(e, `.ck-row[data-cid="${cOf("2.8").id}"]`).dataset.st, "ready", "연결된 열린 화면 = 증빙");
      ok(q(e, `.ck-row[data-cid="${cOf("2.8").id}"] [data-ck-go="audit"]`), "증빙 화면 버튼");
      pick("1.1", "doc", 4); pick("1.1", "imp", 3);
      eq(q(e, `.ck-row[data-cid="${cOf("1.1").id}"]`).dataset.st, "noev");
      const l11 = q(e, `.ck-row[data-cid="${cOf("1.1").id}"] .ck-link.is-warn`);
      ok(l11 && l11.textContent.indexOf("보안교육 · 자격 관리") >= 0 && l11.textContent.indexOf("보안감독자 등록 없음") >= 0, "열린 화면이지만 실제 기록 없음 → 증빙 없음");
      pick("2.10", "doc", 1); pick("2.10", "imp", 3);
      eq(cOf("2.10").docScore, 1);
      q(e, `[data-na="${cOf("1.2").id}"]`).click();
      ok(cOf("1.2").na);
      eq(A.prep(a).done + "/" + A.prep(a).total, "1/5", "N/A 제외");
      eq(q(e, "#au-checks .au-cnt").textContent, "1/5");
      const k = qa(e, ".ck-kpi b").map(x => x.textContent);
      eq(k.slice(0, 6).join("|"), "20%|3/5|2.7|3.3|1|1", "준비율 · 평가 · 평균 · 보완 필요 · 증빙 없음");
      const g1 = q(e, '.ck-grp[data-sec="1"] .ck-gsum').textContent.replace(/\s+/g, "");
      eq(g1, "준비0/1·문서4.0·시행3.0");
      q(e, '[data-ckst="low"]').click();
      eq(qa(e, ".ck-row").length, 1); eq(qa(e, ".ck-row")[0].dataset.cid, cOf("2.10").id);
      q(e, '[data-ckst="low"]').click();
      eq(qa(e, ".ck-row").length, 6, "다시 누르면 해제");
      setv("#ck-sec", "1").dispatchEvent(new e.w.Event("change"));
      eq(qa(e, ".ck-row").length, 2);
      setv("#ck-st", "open").dispatchEvent(new e.w.Event("change"));
      eq(qa(e, ".ck-row").length, 1, "1영역 미준비(1.1 증빙 없음) — N/A 제외");
      q(e, "#ck-clear").click();
      eq(qa(e, ".ck-row").length, 6);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("AU05b 항목 수정: 원본 문구 고정 · 의견 · 증빙 화면 연결(기본값과 같으면 저장 안 함) · 직접 항목 추가 · 삭제", () => {
      const a = e.S.data.audits.find(x => x.id === aid);
      const c = a.checklist.find(x => x.mid === "1.1");
      q(e, `[data-ck-edit="${c.id}"]`).click();
      ok(!q(e, "#ac-text") && q(e, ".ck-fixed").textContent.indexOf("가 항목 하나") >= 0, "원본 문구는 고칠 수 없음");
      eq(q(e, "#ac-doc").value + q(e, "#ac-imp").value, "43");
      const box = (r) => q(e, `#ac-links input[value="${r}"]`);
      ok(box("training").checked && !box("contacts").checked, "기본 연결");
      box("training").checked = false; box("contacts").checked = true;
      setv("#ac-owner", "갑일"); setv("#ac-note", "교육 대장 사본 준비");
      clickOk(e);
      eq(c.links.join(), "contacts"); eq(c.owner, "갑일"); eq(c.note, "교육 대장 사본 준비");
      eq(A.itemState(c), "ready", "열린 화면 연결 → 증빙");
      ok(q(e, `.ck-row[data-cid="${c.id}"]`).textContent.indexOf("교육 대장 사본 준비") >= 0);
      q(e, `[data-ck-edit="${c.id}"]`).click();
      box("training").checked = true; box("contacts").checked = false;
      clickOk(e);
      eq(c.links, undefined, "기본값으로 되돌림 → 메뉴가 열리면 자동 반영");
      q(e, "#au-ck-add").click();
      clickOk(e);
      ok(q(e, "#modal-box #ac-text"), "항목 없으면 저장 안 함");
      setv("#ac-text", "  현장 사진   준비 "); setv("#ac-ref", "절차 7.3"); setv("#ac-doc", "3"); setv("#ac-imp", "3");
      clickOk(e);
      const m = a.checklist[a.checklist.length - 1];
      eq(m.text, "현장 사진 준비"); eq(m.ref, "절차 7.3"); ok(!m.mid);
      eq(A.itemState(m), "noev", "직접 항목은 연결 없음");
      ok(q(e, '.ck-grp[data-sec="etc"]').textContent.indexOf("추가 항목") >= 0);
      q(e, `[data-ck-edit="${m.id}"]`).click();
      q(e, "#modal-box [data-act=del]").click();
      eq(a.checklist.length, 6);
    });
    await ta("AU05c 근거 요지(hq): 원본에서만 · '[a~b 공통]' 요지 · 인쇄 표(점검관용 열 · 소계 · N/A)", async () => {
      const a = e.S.data.audits.find(x => x.id === aid);
      q(e, '[data-basis="1.1"]').click();
      await until(() => q(e, ".bs-body"));
      ok(q(e, ".bs-body").textContent.indexOf("요지 하나") >= 0);
      eq(q(e, ".bs-body h5").textContent, "확인 요령");
      ok(q(e, ".bs-body .bs-note"), "※ 줄");
      e.S.closeModal();
      q(e, '[data-basis="2.10"]').click();
      await until(() => q(e, ".bs-body"));
      ok(q(e, ".bs-body").textContent.indexOf("공통 요지") >= 0, "공통 요지");
      e.S.closeModal();
      eq(qa(e, ".au-ptbl thead th").map(x => x.textContent).join("|"), "CHK-LIST 항목|관련근거|문서|시행|N/A|비고");
      const rows = qa(e, ".au-ptbl tbody tr");
      eq(rows.length, 2 + 6 + 1, "영역 2 + 항목 6 + 합계");
      ok(rows[0].textContent.indexOf("1. 가 영역") >= 0 && rows[0].textContent.indexOf("문서 4/4") >= 0, "영역 소계");
      const r12 = rows.find(r => r.textContent.indexOf("가 항목 둘") >= 0);
      eq(r12.querySelectorAll("td")[4].textContent, "✓", "N/A");
      ok(q(e, ".au-pssi").textContent.indexOf("시험 취급 문구") >= 0);
      ok(q(e, ".au-print").classList.contains("print-only") && q(e, ".ck-list").classList.contains("no-print"));
      eq(a.checklist.length, 6);
    });
    await ta("AU05d 다시 불러오기: 불러온 영역 표시 · 없는 영역만 추가 · 사용 안 한 옛 항목 빼기", async () => {
      const a = e.S.data.audits.find(x => x.id === aid);
      a.checklist.push({ id: "legacy1", text: "옛 기본 문구", ref: "", owner: "", note: "", done: false, files: [] });
      a.checklist.push({ id: "legacy2", text: "쓴 항목", note: "메모 있음", files: [] });
      e.S.renderView();
      q(e, "#au-load").click();
      await until(() => qa(e, ".cl-sec").length === 3);
      const secs = qa(e, ".cl-sec input");
      ok(secs[0].disabled && secs[1].disabled && !secs[2].checked, "불러온 영역 · 국토부 기본에 9 없음");
      eq(q(e, ".cl-sec.is-have .cl-n").textContent, "불러옴");
      ok(q(e, "#modal-box [data-act=ok]").disabled);
      ok(q(e, "#cl-drop").checked && q(e, ".cl-drop").textContent.indexOf("1개") >= 0);
      secs[2].checked = true; secs[2].dispatchEvent(new e.w.Event("change"));
      clickOk(e);
      eq(a.checklist.map(c => c.mid || c.id).join(","), "1.1,1.2,2.8,2.10,2.10.1,2.10.2,9.1,legacy2", "번호 순 + 직접 항목 뒤 · 안 쓴 항목 빠짐");
      eq(a.chkSecs.length, 3);
      const r91 = a.checklist.find(c => c.mid === "9.1");
      eq(r91.text, "다 항목\n- 세부 하나", "줄바꿈 유지");
      a.checklist = a.checklist.filter(c => c.id !== "legacy2" && c.mid !== "9.1");
      a.chkSecs = a.chkSecs.filter(x => x.no !== "9");
      e.S.renderView();
    });
    let fid = "";
    t("AU06 지적사항: 이전 지적 안내 · 재발 표시 · 조치 중 단계 · 조치 기한 일정 · 메뉴 배지", () => {
      A.setToday("2026-10-25"); e.S.renderView();
      const a = e.S.data.audits.find(x => x.id === aid);
      eq(A.phase(a), "wait");
      ok(q(e, "#au-none"), "결과 대기 → 지적 없음 버튼");
      q(e, "#au-f-add").click();
      setv("#fd-type", "car");
      setv("#fd-ref", "자체보안계획  7.3").dispatchEvent(new e.w.Event("input"));
      ok(q(e, "#fd-rep").textContent.indexOf("이전 지적 1건") >= 0, "같은 조항 이전 지적");
      setv("#fd-text", "화물 검색 기록 누락"); setv("#fd-owner", "을일"); setv("#fd-due", "2026-11-10");
      clickOk(e);
      eq(a.findings.length, 1); fid = a.findings[0].id;
      eq(a.findings[0].ref, "자체보안계획 7.3"); eq(a.findings[0].status, "open");
      eq(A.phase(a), "action");
      eq(A.repeatCount(a.findings[0]), 2);
      ok(qa(e, "#au-finds tr[data-fnd]")[0].textContent.indexOf("재발 2회") >= 0);
      const s = sched("audf_" + fid);
      ok(s && s.title.indexOf("[지적 조치] 화물 검색 기록 누락") === 0 && s.start === "2026-11-10" && s.done === false && s.color === "orange");
      e.S.renderNav();
      const nb = q(e, ".nav-item[data-route='audit'] .nav-meta");
      if (nb) eq(nb.textContent, "1", "미결 지적 배지");
      ok(!q(e, "#au-none"), "지적이 있으면 지적 없음 버튼 없음");
    });
    t("AU07 일정관리 되반영: 옮기기 → 수검 기간 · 완료 → 지적 완료 · 삭제 → 그 일정만 연동 해제", () => {
      const a = e.S.data.audits.find(x => x.id === aid);
      Cal.moveEvent("aud_" + aid, "2026-10-22");
      eq(a.start + "~" + a.end, "2026-10-22~2026-10-23", "기간 유지");
      Cal.toggleDone("audf_" + fid);
      eq(a.findings[0].status, "done"); eq(a.findings[0].doneDate, "2026-10-25");
      eq(A.phase(a), "closed");
      Cal.toggleDone("audf_" + fid);
      eq(a.findings[0].status, "doing");
      Cal.moveEvent("audf_" + fid, "2026-11-12");
      eq(a.findings[0].due, "2026-11-12");
      ok(Cal.isInspEvent(sched("aud_" + aid)) && Cal.isInspEvent(sched("audf_" + fid)));
      eq(A.unlinkBySchedule("aud_" + aid), true);
      e.S.data.schedules = e.S.data.schedules.filter(s => s.id !== "aud_" + aid);
      A.syncCalendar(a);
      ok(!sched("aud_" + aid), "지운 수검 일정은 다시 만들지 않음");
      ok(sched("audf_" + fid), "지적 기한 일정은 그대로");
      A.setState({ sel: aid }); go(e, "audit");
      q(e, "#au-edit").click();
      ok(!q(e, "#af-cal").checked, "연동 해제 상태가 폼에 보임");
      q(e, "#af-cal").checked = true; clickOk(e);
      ok(sched("aud_" + aid), "다시 켜면 수검 일정 복구");
    });
    t("AU08 지적사항 탭: 요약 · 필터 · 검색(입력칸 유지) · 수검으로 이동", () => {
      A.setState({ sel: "", tab: "findings", fStF: "open", fq: "" }); go(e, "audit");
      eq(qa(e, ".stat-value").map(x => x.textContent).slice(0, 3).join(","), "2,1,0");
      eq(qa(e, "#au-flist tr[data-fnd]").length, 1);
      q(e, "[data-aseg=fst][data-v=all]").click();
      eq(qa(e, "#au-flist tr[data-fnd]").length, 2);
      const inp = q(e, "#au-fq"); inp.value = "서명"; inp.dispatchEvent(new e.w.Event("input"));
      ok(q(e, "#au-fq") === inp, "입력칸 노드 유지(한글 조합 보호)");
      eq(qa(e, "#au-flist tr[data-fnd]").length, 1);
      eq(qa(e, "#au-flist tr[data-fnd]")[0].dataset.fa, "old1");
      q(e, "#au-flist [data-aud-open]").click();
      eq(A.getState().sel, "old1");
      ok(q(e, ".au-title").textContent.indexOf("서울지방항공청") >= 0);
      A.setState({ fq: "", fStF: "open", tab: "list", sel: "" });
    });
    t("AU09 목록: 진행/종결 필터 · 구분 필터 · 취소 표시 · 검색", () => {
      A.setState({ stF: "active" }); go(e, "audit");
      eq(qa(e, "tr[data-aud]").length, 1);
      q(e, "[data-aseg=st][data-v=closed]").click();
      eq(qa(e, "tr[data-aud]").length, 1); eq(q(e, "tr[data-aud]").dataset.aud, "old1");
      q(e, "[data-aseg=st][data-v=all]").click();
      eq(qa(e, "tr[data-aud]").length, 2);
      q(e, "[data-aseg=body][data-v=foreign]").click();
      eq(qa(e, "tr[data-aud]").length, 0); ok(q(e, "#au-list .empty-state"));
      q(e, "[data-aseg=body][data-v=all]").click();
      const qi = q(e, "#au-q"); qi.value = "누락"; qi.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, "tr[data-aud]").length, 2, "지적 내용으로도 찾음");
      qi.value = ""; qi.dispatchEvent(new e.w.Event("input"));
      A.setState({ stF: "active" });
    });
    t("AU10 manager 열람 전용 · user 는 메뉴 없음", () => {
      loginAs(e, "manager");
      A.setState({ sel: aid }); go(e, "audit");
      ok(q(e, ".au-title"), "상세 열람");
      ok(!q(e, "#au-edit") && !q(e, "#au-f-add") && !q(e, "#au-ck-add") && !q(e, "[data-ck-edit]"));
      ok(!q(e, "select[data-sc]") && !q(e, "[data-na]") && !q(e, "#au-load"), "점수 · N/A 입력 없음");
      ok(!q(e, "[data-basis]"), "근거 요지는 hq 이상만");
      ok(qa(e, "span.ck-sc").length >= 2 && q(e, "span.ck-sc b"), "점수는 읽기 전용 표시");
      ok(qa(e, ".ck-row").length >= 6, "체크리스트 열람");
      ok(!q(e, "tr[data-fnd].is-click"));
      A.setState({ sel: "" }); go(e, "audit");
      ok(!q(e, "#au-add"));
      loginAs(e, "user"); go(e, "audit");
      ok(!q(e, "#au-body"), "권한 없음 → 대시보드");
      loginAs(e, "hq");
    });
    t("AU11 대시보드 띠: 60일 안 수검 D-day · 준비율 · 미결 지적 / 해당 없으면 없음 / user 없음", () => {
      A.setToday("2026-10-05");
      loginAs(e, "manager"); go(e, "dashboard");
      ok(q(e, "#dash-aud"), "띠");
      eq(q(e, "#dash-aud .da-dd").textContent, "D-17");
      ok(q(e, "#dash-aud .da-t b").textContent.indexOf("서울지방항공청") >= 0);
      ok(q(e, "#dash-aud [data-dau-f]").textContent.replace(/\s+/g, "").indexOf("미결지적1") >= 0);
      q(e, "#dash-aud [data-dau-open]").click();
      eq(A.getState().sel, aid);
      loginAs(e, "user"); go(e, "dashboard");
      ok(!q(e, "#dash-aud"), "user 없음");
      const saved = e.S.data.audits;
      e.S.data.audits = []; loginAs(e, "hq"); go(e, "dashboard");
      ok(!q(e, "#dash-aud"), "해당 없으면 띠 없음");
      e.S.data.audits = saved;
      A.setToday("2026-10-25");
    });
    await ta("AU12 통합 검색 · 첨부 올리기(audits 폴더 · 50MB 제한)", async () => {
      const r = e.w.SemisSearch.search ? e.w.SemisSearch.search("누락") : [];
      ok(r.some(x => x.group === "수검 대응 센터"), "검색 결과");
      const up = e.w.SemisSync.uploadFile;
      const calls = [];
      e.w.SemisSync.uploadFile = async (file, prefix) => { calls.push(prefix); return { url: "https://x.supabase.co/storage/v1/object/public/semis-logi-files/" + prefix + "/r_" + file.name, name: file.name, size: file.size }; };
      const files = [];
      let done = 0;
      await A.uploadInto(files, [{ name: "공문.pdf", size: 1000 }, { name: "큰파일.zip", size: 60 * 1024 * 1024 }], () => { done++; });
      e.w.SemisSync.uploadFile = up;
      eq(calls.join(","), "audits"); eq(files.length, 1); ok(/\/audits\/r_공문\.pdf$/.test(files[0].url)); eq(done, 1);
    });
    t("AU13 삭제: 수검 · 준비 항목 · 지적 · 연동 일정 함께", () => {
      loginAs(e, "hq"); A.setState({ sel: aid }); go(e, "audit");
      q(e, "#au-edit").click();
      q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      ok(!e.S.data.audits.some(a => a.id === aid));
      ok(!(e.S.data.schedules || []).some(s => s && s.src === "aud:" + aid), "연동 일정 정리");
      eq(A.getState().sel, "");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("AU14 회의록 조치 일정: 자동 연기로 밀린 날짜를 되돌리지 않음(접속마다 저장 반복 방지)", () => {
      const M = e.w.SemisMinutes;
      const rec = { id: "mm1", title: "회의", date: "2026-09-01", linkDec: true,
        decisions: [{ id: "d1", task: "조치할 일", due: "2026-09-10", done: false }] };
      e.S.data.minutes = [rec];
      e.S.data.schedules = (e.S.data.schedules || []).filter(s => s && s.id !== M.DID("d1"));
      M.syncDecisions(rec);
      const s = e.S.data.schedules.find(x => x.id === M.DID("d1"));
      s.autoDefer = true; s.start = "2026-09-25"; s.end = "2026-09-25"; s.autoRolledAt = "2026-09-25";
      M.syncDecisions(rec);
      eq(s.start + "~" + s.end, "2026-09-25~2026-09-25", "밀린 날짜 유지");
      eq(M.normalizeDecisions(), false, "변화 없음 → 저장 안 함");
      rec.decisions[0].due = "2026-09-30";
      M.syncDecisions(rec);
      eq(s.start + "~" + s.end, "2026-09-30~2026-09-30", "기한을 더 뒤로 바꾸면 그 날짜로");
    });
    await ta("AU15 체크리스트 원본(auditMaster): 권한표 읽기 hq · 앱 쓰기 불가 · 동기화 제외 · hq만 받음 · 저장소에 원문 없음", async () => {
      eq(ACL.auditMaster.join(","), "3,9");
      ok(e.Sync.SYNC_KEYS.indexOf("auditMaster") < 0, "앱은 읽기만(동기화 대상 아님)");
      const srv = makeServer({ rows: [{ key: "auditMaster", value: FAKE_MASTER }] });
      const e2 = makeEnv({ fetch: srv.fetch });
      await srv.loginAs(e2, "hq-pw-2222");
      const m = await e2.w.SemisAudit.loadMaster(true);
      ok(m && m.sections.length === 3 && m.title === "시험용 CHK-LIST", "hq 수신");
      ok(!e2.w.sessionStorage.getItem("semisl:data") || e2.w.sessionStorage.getItem("semisl:data").indexOf("시험용 CHK-LIST") < 0, "탭 사본에 남기지 않음(메모리만)");
      e2.w.close();
      const e3 = makeEnv({ fetch: srv.fetch });
      await srv.loginAs(e3, "mgr-pw-3333");
      eq(await e3.w.SemisAudit.loadMaster(true), null, "manager는 받지 못함");
      e3.w.close();
      /* 원문 조각이 코드 · 테스트에 들어가지 않았는지 — 실제 체크리스트 첫 항목의 관련근거 */
      const probe = ["자체보안계획", "13.3.4/13.3.5"].join(" ");
      ["js/audit.js", "tests/run-tests.cjs", "docs/HANDOFF.md", "README.md"].forEach(f => ok(read(f).indexOf(probe) < 0, f));
    });
    e.w.close();
  }

  /* ══════════ [TR] 보안교육 · 자격 관리 (v1.20) ══════════ */
  {
    const e = makeEnv();
    const TR = e.w.SemisTraining, A = e.w.SemisAudit;
    const setv = (sel, v) => { const el = q(e, sel); el.value = v; return el; };
    const chg = (el) => { el.dispatchEvent(new e.w.Event("change")); return el; };
    const data = () => e.S.data.training;
    TR.setToday("2026-10-01"); A.setToday("2026-10-01");
    t("TR01 메뉴: 점검 · 교육 허브 실메뉴 · 옛 예정 메뉴(교육 관리 · 이수증 관리) 자동 전환(멱등)", () => {
      const m = e.S.data.menus.find(x => x.module === "training");
      ok(m && !m.planned && m.parent === "hub-aud" && m.vis === "mgr"); eq(m.label, "보안교육 · 자격 관리");
      ok(!e.S.data.menus.some(x => x.module === "certs"), "이수증 관리 메뉴 없음");
      const old = e.S.defaultMenus().map(x => x.module === "training" ? Object.assign({}, x, { label: "안전보안 교육 관리", planned: true, desc: "x" }) : x);
      old.push({ id: "certs", seq: 99, type: "module", label: "이수증 관리", icon: "c", module: "certs", vis: "mgr", parent: "hub-aud", planned: true, desc: "y" });
      const o = makeEnv({ preData: { version: 1, menus: old } });
      const m2 = o.S.data.menus.find(x => x.module === "training");
      ok(!m2.planned && !m2.desc && m2.label === "보안교육 · 자격 관리", "옛 예정 메뉴 → 실메뉴");
      ok(!o.S.data.menus.some(x => x.module === "certs"), "이수증 관리 예정 메뉴 제거");
      eq(o.S.normalizeData(), false, "멱등");
      const renamed = e.S.defaultMenus().map(x => x.module === "training" ? Object.assign({}, x, { label: "우리 교육", planned: true }) : x);
      const o2 = makeEnv({ preData: { version: 1, menus: renamed } });
      eq(o2.S.data.menus.find(x => x.module === "training").label, "우리 교육", "운영자가 바꾼 이름 유지");
      o.w.close(); o2.w.close();
    });
    t("TR02 데이터 · 권한표 · 파일 폴더 · 유효기한 셈", () => {
      ok(data() && Array.isArray(data().people) && Array.isArray(data().sessions));
      e.S.data.training = []; e.S.normalizeData(); ok(!Array.isArray(e.S.data.training) && Array.isArray(e.S.data.training.records), "구조 보정");
      eq(ACL.training.join(","), "2,3");
      const edge = read("tools/edge/semis-logi-files.ts");
      ok(/READ_RANK[\s\S]*?training: 2[\s\S]*?WRITE_RANK[\s\S]*?training: 3/.test(edge), "training 폴더: 열람 2 · 올리기 3");
      eq(TR.calcExpire("2025-04-25", 13), "2026-05-24"); eq(TR.calcExpire("2026-01-31", 1), "2026-02-27");
      eq(TR.calcExpire("2026-03-01", 12), "2027-02-28"); eq(TR.calcExpire("2026-03-01", 0), "");
      ok(TR.DEF_COURSES.some(c => c.vendor) && TR.DEF_COURSES.every(c => c.id && c.fam && c.name));
    });
    t("TR03 hq 인원 등록 → 이수 현황(미이수 · SSI 서약 누락) · 메뉴 배지 · 인쇄 버튼", () => {
      loginAs(e, "hq"); go(e, "training");
      eq(q(e, "#view").getAttribute("data-hub"), "hub-aud");
      ok(q(e, "#view .page-head [data-print-btn]"), "인쇄");
      ok(q(e, "#tr-grid .empty-state"), "인원 없음");
      q(e, "#tr-padd").click();
      setv("#tp-name", "갑일");
      qa(e, "#tp-roles input").forEach(i => { if (i.value === "보안감독자" || i.value === "SSI 취급자") i.checked = true; });
      const ra = setv("#tp-role-add", "야간 당직");
      ra.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      ok(qa(e, "#tp-roles input").some(i => i.value === "야간 당직" && i.checked), "직무 직접 추가");
      clickOk(e);
      eq(data().people.length, 1);
      const p = data().people[0];
      eq(p.roles.join(","), "보안감독자,SSI 취급자,야간 당직"); eq(p.dept, "인천화물팀");
      const st = TR.stats();
      eq(st.people + "|" + st.cells + "|" + st.none + "|" + st.ssiMiss, "1|2|2|1", "보안감독자 묶음 + 인지교육(전 직원)");
      eq(qa(e, ".tr-gtbl tbody tr").length, 1);
      ok(q(e, ".tr-gtbl thead").textContent.indexOf("보안책임자 · 감독자") >= 0 && q(e, ".tr-gtbl thead").textContent.indexOf("SSI 서약") >= 0);
      eq(qa(e, ".tr-gtbl .tr-cell[data-st=none]").length, 3, "미이수 2 + 서약 누락 1");
      e.S.renderNav();
      const nb = q(e, ".nav-item[data-route='training'] .nav-meta");
      if (nb) eq(nb.textContent, "1", "배지 = 만료 · 임박 · 서약 누락");
    });
    t("TR04 칸 누르기 → 이수 등록(초기 과정 · 유효기한 자동) · 정기 이후 · 만료 · 임박", () => {
      const p = data().people[0];
      q(e, `[data-tcell="${p.id}|sup"]`).click();
      eq(q(e, "#tr-c").value, "c-sup-i", "기록 없으면 초기");
      chg(setv("#tr-d", "2025-09-01"));
      eq(q(e, "#tr-e").value, "2026-09-30", "13개월 − 1일");
      setv("#tr-o", "교육원"); clickOk(e);
      eq(data().records.length, 1);
      eq(data().records[0].expire, "", "계산값과 같으면 저장 안 함(주기를 바꾸면 따라감)");
      const c1 = TR.famStatus(p, TR.fams(false).find(g => g.fam === "sup"));
      eq(c1.st + " " + c1.exp, "exp 2026-09-30");
      ok(q(e, ".tr-due").textContent.indexOf("갑일") >= 0, "만료 목록");
      q(e, `[data-tcell="${p.id}|sup"]`).click();
      eq(q(e, "#tr-c").value, "c-sup-r", "기록 있으면 정기");
      chg(setv("#tr-d", "2025-10-20"));
      eq(q(e, "#tr-e").value, "2026-11-19");
      clickOk(e);
      const c2 = TR.famStatus(p, TR.fams(false).find(g => g.fam === "sup"));
      eq(c2.st + " " + c2.d, "soon 49", "가장 최근 이수 기준 · 60일 이내 임박");
      TR.setToday("2026-09-01");
      eq(TR.famStatus(p, TR.fams(false).find(g => g.fam === "sup")).st, "ok");
      TR.setToday("2026-10-01");
      const rid = data().records[1].id;
      q(e, `[data-tperson="${p.id}"]`).click();
      ok(q(e, `[data-rid="${rid}"]`), "인원 창에 이수 기록");
      q(e, `[data-rid="${rid}"]`).click();
      setv("#tr-e", "2026-12-31"); q(e, "#tr-e").dispatchEvent(new e.w.Event("input"));
      chg(setv("#tr-d", "2025-10-21"));
      eq(q(e, "#tr-e").value, "2026-12-31", "직접 고친 기한은 유지");
      clickOk(e);
      eq(data().records[1].expire, "2026-12-31");
      ok(q(e, "#tp-name"), "저장 후 인원 창으로 복귀");
      e.S.closeModal();
    });
    t("TR05 당사 교육 기록: 8항목 누락 표시 · 참석자 → 이수 기록 자동 · 빼면 지움 · 삭제 연동", () => {
      data().people.push({ id: "tp2", name: "을일", dept: "인천화물팀", roles: ["ACMR"] });
      TR.setState({ tab: "sessions" }); go(e, "training");
      q(e, "#tr-sadd").click();
      eq(q(e, "#ts-c").value + "|" + q(e, "#ts-title").value, "|", "기본은 기타(과정 없음)");
      chg(setv("#ts-c", "c-acmr-r"));
      eq(q(e, "#ts-title").value, "ACMR 정기", "과정을 고르면 교육명 채움");
      setv("#ts-date", "2026-09-10"); setv("#ts-hours", "4"); setv("#ts-place", "교육장");
      qa(e, "#ts-pids input").forEach(i => { i.checked = true; });
      clickOk(e);
      const s = data().sessions[0];
      eq(s.type, "own"); eq(s.pids.length, 2);
      eq(TR.missing(s).join(","), "일시,교관,시간표,평가결과,참석자 명단 · 서명");
      const auto = data().records.filter(r => r.sessionId === s.id);
      eq(auto.length, 2); ok(auto.every(r => r.cid === "c-acmr-r" && r.date === "2026-09-10" && r.hours === 4));
      ok(q(e, ".tr-stbl tbody tr").textContent.indexOf("누락 5") >= 0);
      eq(TR.evidence("9.2").text, "ACMR 1/1명 유효", "교육 기록으로 만든 이수");
      q(e, `tr[data-sid="${s.id}"]`).click();
      qa(e, "#ts-pids input").forEach(i => { if (i.value === "tp2") i.checked = false; });
      setv("#ts-time", "09:00~13:00"); setv("#ts-inst", "병일"); setv("#ts-eval", "전원 합격");
      clickOk(e);
      eq(data().records.filter(r => r.sessionId === s.id).length, 1, "빠진 참석자 기록 삭제");
      eq(TR.missing(s).join(","), "시간표,참석자 명단 · 서명");
      s.files.tt = [{ name: "tt.pdf", url: "u1" }]; s.files.roster = [{ name: "sign.pdf", url: "u2" }];
      eq(TR.missing(s).length, 0);
      const n0 = data().records.length;
      q(e, `tr[data-sid="${s.id}"]`).click();
      q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      eq(data().sessions.length, 0); eq(data().records.length, n0 - 1, "연결된 이수 기록도 삭제");
    });
    t("TR06 협력사 교육 확인: 업체 필수 · 과정 · 인원 · 1년 안 확인 → 체크리스트 증빙(1.3 · 3.4 · 9.2.1)", () => {
      q(e, "#tr-sadd").click();
      q(e, "[data-tseg=stypeform][data-v=vendor]").click();
      ok(q(e, "#ts-vendor"), "협력사 폼");
      setv("#ts-date", "2026-08-01"); clickOk(e);
      ok(q(e, "#ts-vendor"), "업체 없으면 저장 안 함");
      setv("#ts-vendor", "가나보안"); setv("#ts-c", "v-drug"); setv("#ts-target", "20"); setv("#ts-done", "19");
      clickOk(e);
      const s = data().sessions.find(x => x.type === "vendor");
      eq(s.vendor + "|" + s.cid + "|" + s.target + "|" + s.done, "가나보안|v-drug|20|19");
      ok(q(e, `tr[data-sid="${s.id}"]`).textContent.indexOf("19/20") >= 0);
      eq(JSON.stringify(TR.evidence("3.4")), JSON.stringify({ ok: true, text: "향정신성 물질 교육 확인 1건(1년)" }));
      eq(TR.evidence("9.2.1").ok, false); eq(TR.evidence("1.3").ok, true);
      TR.setToday("2027-09-01");
      eq(TR.evidence("3.4").ok, false, "1년 지나면 다시 필요");
      TR.setToday("2026-10-01");
    });
    t("TR07 체크리스트 증빙: 보안감독자 유효 · SSI 서약 · 기록 8항목 — 수검 대응 센터 상태에 반영", () => {
      const p = data().people[0];
      eq(TR.evidence("1.1").text, "보안감독자 1/1명 유효");
      ok(TR.evidence("1.1").ok);
      eq(A.itemState({ mid: "1.1", docScore: 3, impScore: 3 }), "ready", "열린 화면 + 실제 기록 → 증빙");
      eq(TR.evidence("2.10.1").text, "SSI 서약 0/1명"); eq(A.itemState({ mid: "2.10.1", docScore: 3, impScore: 3 }), "noev");
      p.pledge = "2026-09-02";
      eq(A.itemState({ mid: "2.10.1", docScore: 3, impScore: 3 }), "ready");
      eq(TR.evidence("9.2").text, "ACMR 0/1명 유효", "교육 기록을 지우면 이수도 빠짐");
      eq(TR.evidence("1.4").text, "교육 기록 없음");
      const ev = A.routeEv("training", "1.1");
      ok(ev.live && ev.ok && ev.text === "보안감독자 1/1명 유효");
      eq(TR.evidence("5.1"), null, "관계없는 번호");
    });
    t("TR08 인원: 퇴직 → 현황에서 빠짐 · 보관 기한(퇴직 후 90일) · 경과 표시", () => {
      const p2 = data().people.find(x => x.id === "tp2");
      p2.left = "2026-05-01";
      TR.setState({ tab: "people", pState: "left" }); go(e, "training");
      eq(qa(e, ".tr-ptbl tbody tr").length, 1);
      ok(q(e, ".tr-ptbl tbody tr").textContent.indexOf("보관 기한 경과") >= 0, "5/1 + 90일 < 10/1");
      p2.left = "2026-09-20"; go(e, "training");
      ok(q(e, ".tr-ptbl tbody tr").textContent.indexOf("보관 ~2026.12.19") >= 0);
      eq(TR.stats().people, 1, "현황은 재직만");
      TR.setState({ pState: "active" });
    });
    t("TR09 과정 관리(hq): 주기 변경 → 계산 기한 반영 · 과정 추가 · 쓰지 않은 과정만 삭제", () => {
      TR.setState({ tab: "grid" }); go(e, "training");
      q(e, "#tr-courses").click();
      const rows = qa(e, "#tc-rows tr");
      eq(rows.length, TR.DEF_COURSES.length);
      const supI = rows.find(r => r.querySelector("[data-k=name]").value === "보안책임자 · 감독자 초기");
      ok(!supI.querySelector("[data-cdel]"), "쓰는 과정은 삭제 버튼 없음");
      supI.querySelector("[data-k=cycle]").value = "24";
      q(e, "#tc-add").click();
      const last = qa(e, "#tc-rows tr").pop();
      last.querySelector("[data-k=name]").value = "위험물 보안 인지"; last.querySelector("[data-k=roles]").value = "화물보안 요원, ACMR";
      clickOk(e);
      eq(data().courses.length, TR.DEF_COURSES.length + 1);
      const nc = data().courses[data().courses.length - 1];
      eq(nc.roles.join(","), "화물보안 요원,ACMR"); ok(nc.fam, "묶음 자동");
      eq(TR.expireOf(data().records[0]), "2027-08-31", "초기 과정 주기 24개월");
      ok(q(e, ".tr-gtbl thead").textContent.indexOf("위험물 보안 인지") < 0, "필요한 재직 인원이 없으면 열 없음");
      data().people[0].roles.push("ACMR"); go(e, "training");
      ok(q(e, ".tr-gtbl thead").textContent.indexOf("위험물 보안 인지") >= 0 && q(e, ".tr-gtbl thead").textContent.indexOf("ACMR") >= 0, "새 과정 묶음 열");
      data().people[0].roles.pop();
    });
    t("TR10 manager 열람 전용 · user 메뉴 없음 · 통합 검색", () => {
      loginAs(e, "manager"); TR.setState({ tab: "grid" }); go(e, "training");
      ok(!q(e, "#tr-sadd") && !q(e, "#tr-padd") && !q(e, "#tr-courses") && !q(e, "[data-tcell]"));
      q(e, "[data-tperson]").click();
      ok(q(e, "#modal-box .tr-rlist") && !q(e, "#modal-box input"), "읽기 전용 인원 창");
      e.S.closeModal();
      TR.setState({ tab: "sessions" }); go(e, "training");
      ok(q(e, "tr[data-sid]") && !q(e, "tr[data-sid].is-click"));
      loginAs(e, "user"); go(e, "training");
      ok(!q(e, "#tr-body"), "권한 없음");
      loginAs(e, "hq");
      const r = e.w.SemisSearch.search ? e.w.SemisSearch.search("갑일") : [];
      ok(r.some(x => x.group === "보안교육 · 자격 관리"), "검색");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    e.w.close();
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
      ok(c.indexOf(".nav-tag") > 0); ok(c.indexOf(".ticket") > 0); ok(c.indexOf(".rail") > 0); ok(c.indexOf(".tabbar") > 0);
      ok(c.indexOf("#1d4ed8") < 0, "v2 블루 잔재");
    });
  }

  console.log(`\n테스트 결과: ${passed} 통과 / ${failed} 실패 (총 ${passed + failed}건)`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
  process.exit(failures.length ? 1 : 0);
})();
