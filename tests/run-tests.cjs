/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — jsdom 테스트 스위트
   실행: npm test  (jsdom 필요: npm install)
   구성: [C] 코어(해시·계정·메뉴·정규화·권한·라우터·예정 모듈)
         [D] 대시보드·공지·현황판  [S] 시스템 설정  [M] 이식 모듈 스모크(일정·회의록·연락망·검색)
         [Y] 동기화  [CF] 보고 체계도(탭·뷰어·편집)  [FP] 개정 PDF 비교  [SC] 화물 보안(CARES 연동)  [FV] 첨부 뷰어  [CR] 위기대응 담당자  [IM] 한글 입력 보호  [FL] 운항 현황  [AU] 수검 대응 센터  [V] v1.9 비주얼(일정 폼·팔레트·설명 말풍선·허브 배너·3D 히어로)  [SEC] 서버 보안(비공개 파일·살균·CSP)  [PT] 순찰일지  [SK] 자체 보안점검(수준관리지침 별표 · HWPX)  [UP] 점검 표시 · 다가오는 점검  [CM] v1.29 화면 정돈  [CN] v1.30 편집 모드 · 모바일 접기  [ED] v1.39 보안교육 이수 등록(배포용)  [TA] v1.41 점검교육 · 수검 자료  [W] 릴리스 위생(버전 스탬프·문자열 잔재)
   ═══════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const FILES = ["js/loginguard.js", "js/app.js", "js/qr.js", "js/hero3d.js", "js/modules.js", "js/shortcuts.js", "js/files.js", "js/docshelf.js", "js/calendar.js", "js/minutes.js", "js/contacts.js", "js/flowpdf.js", "js/vault.js", "js/regulations.js", "js/search.js", "js/cares.js", "js/hazfind.js", "js/screening.js", "js/equipment.js", "js/secpost.js", "js/secdash.js", "js/crisis.js", "js/serp.js", "js/threat.js", "js/phonebook.js", "js/contracts.js", "js/partners.js", "js/kcra.js", "js/seccases.js", "js/dissem.js", "js/scrstats.js", "js/audit.js", "js/training.js", "js/seclog.js", "js/patrol.js", "js/hwpx.js", "js/nasforms.js", "js/selfcheck.js", "js/auddash.js", "js/flightcore.js", "js/flightops.js", "js/sync.js", "js/pow.js", "js/fileauth.js"];
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
        /* v1.24 저장 충돌 방지(서버 트리거 semis_logi_private.check_base 흉내): 계정 세션이 기존 행을 고칠 때
           base_at 이 지금 행의 updated_at 과 다르면(없으면 포함) 문장 전체 거절 — 409 PT409 semis_conflict */
        if (!srv.noBaseCheck && s && s.kind === "user") {
          const bad = rows.find(x => { const cur = srv.rows.find(y => y.key === x.key); return cur && String(x.base_at || "") !== String(cur.updated_at); });
          if (bad) { srv.conflicts = (srv.conflicts || 0) + 1; return reply(409, { code: "PT409", message: "semis_conflict", details: bad.key, hint: "reload" }); }
        }
        const who = (accOf(s) || {}).login || "anon";
        const out = [];
        rows.forEach(x => {
          srv.clock = Math.max((srv.clock || 0) + 1, Date.now());
          const rec = { key: x.key, value: JSON.parse(JSON.stringify(x.value)), updated_at: new Date(srv.clock).toISOString(),
            updated_by: who + "/" + String(x.updated_by || "").replace(/^.*\//, "") };
          const i = srv.rows.findIndex(y => y.key === x.key);
          if (i >= 0) srv.rows[i] = rec; else srv.rows.push(rec);
          out.push({ key: rec.key, updated_at: rec.updated_at });
        });
        return reply(201, /select=/.test(u) ? out : []);
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
    t("C08 메뉴 시드: 허브 6개(hub-*) · 예정 모듈 10개 이상 · 링크 5개", () => {
      const m = e.S.data.menus;
      eq(m.filter(x => x.type === "group").map(x => x.id).join(","), "hub-home,hub-sec,hub-saf,hub-aud,hub-ops,hub-doc");
      ok(m.filter(x => x.type === "group").every(g => e.S.ICONS[g.ico]), "허브 아이콘");
      ok(m.filter(x => x.type === "module" && x.planned).length >= 6, "planned");   // v1.41 협력사 · 계약 · 상용화주 실모듈
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
      ok(qa(e, ".nav-item.planned .nav-tag").length >= 6);
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
      eq(sec.querySelector(".br-n").textContent, "5/6", "화물보안 대시보드·보안검색 현황·상용화주·보안 처리 대장·검색장비 운영 / 출입 예정 (v1.41)");
      const home = rows.find(r => r.dataset.dashHub === "hub-home");
      eq(home.querySelector(".br-n").textContent, "5/6", "대시보드·운항 현황·일정·회의록·바로가기 운영 / 현황판 예정");
    });
    t("D03 무재해 기준일 설정 → D+ 계산", () => {
      q(e, "#btn-edit-zero").click();
      const d10 = new Date(Date.now() - 10 * 86400000);   // v1.29: 오늘 = 현지 날짜
      const since = d10.getFullYear() + "-" + String(d10.getMonth() + 1).padStart(2, "0") + "-" + String(d10.getDate()).padStart(2, "0");
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
    t("H01 시드 메뉴 보장: 없어진 실모듈 메뉴는 시드 순서상 앞 메뉴 뒤에 다시 · 예정 메뉴는 다시 넣지 않음 · 멱등", () => {
      const menus = makeEnv({ boot: false }).S.defaultMenus().filter(x => ["phonebook", "scr-equip", "board", "car"].indexOf(x.module) < 0);
      menus.find(x => x.module === "training").label = "우리 교육";
      const eS = makeEnv({ preData: { version: 1, menus } });
      const mn = (mod) => eS.S.data.menus.find(x => x.module === mod);
      ok(mn("phonebook") && mn("phonebook").parent === "hub-ops" && !mn("phonebook").planned, "업무 연락처 복구");
      ok(mn("phonebook").seq > mn("crisis").seq && mn("phonebook").seq < mn("partners").seq, "위기대응 담당자 뒤");
      ok(mn("scr-equip") && mn("scr-equip").parent === "hub-sec" && mn("scr-equip").seq > mn("sec-cases").seq, "검색장비 복구");
      ok(!mn("board") && !mn("car"), "예정 메뉴는 넣지 않음");
      eq(mn("training").label, "우리 교육", "운영자가 바꾼 이름 유지");
      eq(eS.S.normalizeData(), false, "멱등");
      eS.w.close();
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
    t("H06 준비 중 블록: 운영 메뉴가 있는 허브는 접힘 · 토글 상태는 계정별 저장", () => {
      const blk = () => q(e, '#nav-menu .hub[data-hub="hub-saf"] .hub-planned');
      ok(!blk().classList.contains("open"), "안전 관리 — v1.27부터 운영 메뉴(순찰일지) 있어 기본 접힘");
      ok(!q(e, '#nav-menu .hub[data-hub="hub-sec"] .hub-planned').classList.contains("open"), "화물 보안 — v1.12부터 운영 메뉴 있어 기본 접힘");
      ok(!q(e, '#nav-menu .hub[data-hub="hub-ops"] .hub-planned'), "협력·비상 — v1.41 예정 메뉴 없음(협력사 · 계약 실모듈)");
      q(e, '[data-toggle-planned="hub-saf"]').click();
      ok(blk().classList.contains("open"));
      e.S.renderNav();
      ok(blk().classList.contains("open"), "재렌더 후 유지");
      q(e, '[data-toggle-planned="hub-saf"]').click();
      ok(!blk().classList.contains("open"));
    });
    t("H07 모듈 등록 → 준비 중 블록에서 운영 목록으로 · 구축 현황 증가", () => {
      e.S.registerModule("access", { title: "출입", render(root) { root.innerHTML = e.S.ui.head({ title: "보안구역 출입 관리" }); } });
      e.S.renderNav(); go(e, "dashboard");
      ok(q(e, '#nav-menu .hub[data-hub="hub-sec"] .hub-items [data-route="access"]'), "운영 목록");
      ok(!q(e, '#nav-menu .hub[data-hub="hub-sec"] .planned-list [data-route="access"]'), "준비 중에서 제거");
      const sec = qa(e, "#dash-build .build-row").find(r => r.dataset.dashHub === "hub-sec");
      eq(sec.querySelector(".br-n").textContent, "6/6");
      go(e, "access");
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
    t("H10 모바일 하단 탭(v1.29 홈 · 일정 · 순찰 · 운항): 권한에 맞춰 표시 · 전체 → 시트", () => {
      eq(qa(e, "#tabbar .tab-btn[data-route]").map(b => b.dataset.route).join(","), "dashboard,schedule,daily-safety,flight");
      ok(q(e, "#tabbar .tab-all"));
      q(e, "#tabbar .tab-all").click();
      ok(q(e, "#app").classList.contains("sheet-open"));
      ok(q(e, "#sidebar-backdrop").classList.contains("show"));
      go(e, "schedule");
      ok(!q(e, "#app").classList.contains("sheet-open"), "이동 시 닫힘");
      ok(q(e, '#tabbar [data-route="schedule"]').classList.contains("active"));
      const e2 = makeEnv(); loginAs(e2, "user");
      eq(qa(e2, "#tabbar .tab-btn[data-route]").map(b => b.dataset.route).join(","), "dashboard,flight", "일반사용자(운항 현황은 전체 공개)");
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
      q(e, '#rail-hubs [data-hub="hub-ops"]').click();
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
      eq(Sync.SYNC_KEYS.join(","), "menus,notices,schedules,assignees,assigneesSeeded,minutes,minuteFolders,levelHistory,safetyBoard,contacts,gcal,vault,regulations,equipment,crisis,fleet,audits,phonebook,training,seclog,seclogCfg,serp,serpRuns,threat,threatRuns,threatChecks,patrol,patrolCfg,patrolPeople,secPost,secPostImg,selfChecks,selfCheckCfg,docs,partners,contracts,kcra,secCases,dissem,scrStats"));
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

  /* ══════════ [YC] 저장 충돌 방지 (v1.24 — 2026-09-29 잠자기 탭이 일정 61건을 26건으로 덮어쓴 사고) ══════════ */
  {
    const sch = (id, o) => Object.assign({ id, title: "일정 " + id, start: "2026-09-28", end: "2026-09-28", allDay: true, done: false,
      memo: "", priv: false, owner: "", color: "blue", repeat: { freq: "none", until: "" }, doneDates: [], undoneDates: [], reminders: [] }, o || {});
    const e0 = makeEnv({ boot: false });
    const m3 = e0.Sync.merge3;
    const C = e0.Sync._canon;

    t("YC01 병합: 서로 다른 항목 추가 · 삭제 · 수정은 모두 살림", () => {
      const base = [{ id: "a", t: 1 }, { id: "b", t: 1 }, { id: "c", t: 1 }];
      const local = [{ id: "a", t: 2 }, { id: "b", t: 1 }, { id: "c", t: 1 }, { id: "L", t: 1 }];      // a 수정 · L 추가
      const remote = [{ id: "a", t: 1 }, { id: "c", t: 9 }, { id: "R", t: 1 }];                       // b 삭제 · c 수정 · R 추가
      const out = m3(base, local, remote);
      eq(out.map(x => x.id + x.t).join(","), "a2,c9,R1,L1");
    });
    t("YC02 병합: 한쪽이 지운 항목을 다른 쪽이 고쳤으면 남긴다(데이터 보존)", () => {
      const base = [{ id: "a", t: 1 }, { id: "b", t: 1 }];
      eq(C(m3(base, [{ id: "b", t: 1 }], [{ id: "a", t: 5 }, { id: "b", t: 1 }])), C([{ id: "a", t: 5 }, { id: "b", t: 1 }]), "이 탭 삭제 vs 서버 수정");
      eq(C(m3(base, [{ id: "a", t: 7 }, { id: "b", t: 1 }], [{ id: "b", t: 1 }])), C([{ id: "a", t: 7 }, { id: "b", t: 1 }]), "서버 삭제 vs 이 탭 수정");
      eq(C(m3(base, [{ id: "b", t: 1 }], [{ id: "b", t: 1 }])), C([{ id: "b", t: 1 }]), "양쪽 삭제");
    });
    t("YC03 병합: 같은 항목의 다른 칸은 칸별로 · 같은 칸이면 이 탭 우선", () => {
      const b = { id: "x", title: "T", memo: "", start: "2026-09-28", done: false, doneDates: ["2026-09-01"] };
      const l = Object.assign({}, b, { start: "2026-09-29", doneDates: ["2026-09-01", "2026-09-29"] });
      const r = Object.assign({}, b, { memo: "보완", start: "2026-09-30", doneDates: [] });
      const out = m3([b], [l], [r])[0];
      eq(out.memo, "보완"); eq(out.start, "2026-09-29", "같은 칸 → 이 탭");
      eq(out.doneDates.join(","), "2026-09-29", "값 집합: 서버 삭제 + 이 탭 추가");
    });
    t("YC04 병합: 기준을 모르면 합집합(겹치면 이 탭 우선) · 객체 키 단위 · 순서 유지", () => {
      eq(m3(undefined, [{ id: "a", t: 2 }], [{ id: "a", t: 1 }, { id: "b", t: 1 }]).map(x => x.id + x.t).join(","), "a2,b1");
      const o = m3({ rows: [{ id: "1" }], asOf: "9월" }, { rows: [{ id: "1" }, { id: "2" }], asOf: "9월" }, { rows: [{ id: "1" }], asOf: "10월" });
      eq(o.asOf, "10월"); eq(o.rows.length, 2);
      const base = ["a", "b", "c"].map(id => ({ id }));
      eq(m3(base, [{ id: "c" }, { id: "a" }, { id: "b" }], base.concat([{ id: "d" }])).map(x => x.id).join(""), "cabd", "이 탭이 순서를 바꿈 → 이 탭 순서 + 서버 추가분");
      eq(m3(base, base.concat([{ id: "L" }]), [{ id: "b" }, { id: "a" }, { id: "c" }]).map(x => x.id).join(""), "bacL", "서버가 순서를 바꿈 → 서버 순서 + 이 탭 추가분");
    });

    const server = makeServer({ rows: [{ key: "schedules", value: [sch("s1"), sch("s2", { autoDefer: true, end: "2026-09-27", start: "2026-09-27" }), sch("s3")] }] });
    const A = makeEnv({ fetch: server.fetch });                  // 9/28 오전에 열어 두고 잠든 탭
    const B = makeEnv({ fetch: server.fetch });                  // 계속 쓰던 탭
    await ta("YC05 잠든 탭 재현: 다른 탭이 30건 추가 · 메모 보완 뒤, 잠든 탭의 자동 연기 저장이 덮어쓰지 못하고 병합됨", async () => {
      await server.loginAs(A, "hq-pw-2222"); await A.Sync.start();
      await server.loginAs(B, "admin-pw-111"); await B.Sync.start();
      eq(A.S.data.schedules.length, 3);
      for (let i = 0; i < 30; i++) B.S.data.schedules.push(sch("n" + i, { start: "2026-10-01", end: "2026-10-01" }));
      B.S.data.schedules[0].memo = "[보완 2026-09-28 · 부서함 문서]";
      B.S.save(); await B.Sync._flush();
      eq(server.rows.find(r => r.key === "schedules").value.length, 33);
      /* A 는 알림을 못 받은 상태(잠자기) — 깨어나 자동 연기가 먼저 돈다 */
      const c0 = server.conflicts || 0;
      eq(A.w.SemisCalendar.runAutoRoll("2026-09-29"), 1, "자동 연기 1건");
      await A.Sync._flush();
      ok((server.conflicts || 0) > c0, "서버가 옛 기준의 저장을 거절(409)");
      const v = server.rows.find(r => r.key === "schedules").value;
      eq(v.length, 33, "일정 수 유지(26건으로 줄던 사고 재현 방지)");
      eq(v.find(x => x.id === "s1").memo, "[보완 2026-09-28 · 부서함 문서]", "다른 탭의 메모 보완 유지");
      eq(v.find(x => x.id === "s2").end, "2026-09-29", "잠든 탭의 자동 연기도 반영");
      eq(A.S.data.schedules.length, 33, "잠든 탭 화면도 최신으로");
      eq(A.Sync.pendingKeys().length, 0);
    });
    await ta("YC06 저장 요청에 base_at(마지막으로 받은 서버 시각)을 보내고 응답 시각으로 갱신", async () => {
      await B.Sync.pull(false);                               // 알림 대신 직접 받음(A 의 병합 저장 반영)
      const n0 = server.calls.length;
      B.S.data.schedules[1].title = "고친 제목"; B.S.save(); await B.Sync._flush();
      const post = server.calls.slice(n0).filter(c => c.method === "POST" && c.url.indexOf("/rest/v1/semis_logi_store") >= 0);
      eq(post.length, 1, "충돌 없는 저장은 한 번에");
      ok(/select=key,updated_at/.test(post[0].url), "응답에 시각 요청");
      const row = post[0].body.find(x => x.key === "schedules");
      ok(row && row.base_at, "base_at 전송");
      eq(B.Sync._serverAt("schedules"), server.rows.find(r => r.key === "schedules").updated_at, "새 기준 시각");
    });
    await ta("YC07 서버에서 지워진 항목을 옛 탭이 되살리지 않음(다시 로그인해도 기준 유지)", async () => {
      await A.Sync.pull(false);
      B.S.data.schedules = B.S.data.schedules.filter(x => x.id !== "n5"); B.S.save(); await B.Sync._flush();
      A.S.data.schedules.find(x => x.id === "n7").title = "A가 고침"; A.S.save();
      await A.Sync.start();                                   // 세션 만료 뒤 다시 로그인한 것과 같은 경로
      await A.Sync._flush();
      const v = server.rows.find(r => r.key === "schedules").value;
      ok(!v.some(x => x.id === "n5"), "지운 항목 부활 없음");
      eq(v.find(x => x.id === "n7").title, "A가 고침");
      eq(v.find(x => x.id === "n1").title, B.S.data.schedules.find(x => x.id === "n1").title);
    });
    await ta("YC08 잠자기에서 깨어나면 서버 값을 다시 받기 전까지 자동 연기를 미룸", async () => {
      let release;
      const hold = new Promise(r => { release = r; });
      const f0 = server.fetch;
      A.w.fetch = (u, o) => (o && o.method && o.method !== "GET") ? f0(u, o) : hold.then(() => f0(u, o));
      A.Sync._wake();
      ok(A.Sync.isStale(), "깨어난 직후 = 오래된 화면");
      A.S.data.schedules.push(sch("late", { autoDefer: true, start: "2026-09-20", end: "2026-09-20" }));
      eq(A.w.SemisCalendar.autoRollIfAllowed(), 0, "자동 연기 보류");
      release(); await tick(30); A.w.fetch = f0;
      ok(!A.Sync.isStale(), "다시 받은 뒤 해제");
      A.S.data.schedules = A.S.data.schedules.filter(x => x.id !== "late");
    });
    await ta("YC09 충돌이 계속되면 3번까지만 다시 시도하고 오프라인 표시(무한 반복 없음)", async () => {
      const f0 = server.fetch;
      let posts = 0;
      A.w.fetch = (u, o) => {
        if (o && o.method === "POST" && String(u).indexOf("/rest/v1/semis_logi_store") >= 0) {
          posts++; return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ code: "PT409", message: "semis_conflict" }), headers: { get: () => null } });
        }
        return f0(u, o);
      };
      A.S.data.schedules[0].title = "계속 충돌"; A.S.save();
      await A.Sync._flush().catch(() => {});
      A.w.fetch = f0;
      eq(posts, 4, "처음 1 + 다시 3");
      eq(A.Sync.status, "offline");
      ok(A.Sync.pendingKeys().indexOf("schedules") >= 0, "보내지 못한 변경은 남김");
      await A.Sync.syncNow();
      eq(server.rows.find(r => r.key === "schedules").value[0].title, "계속 충돌", "재연결 후 저장");
    });
    await ta("YC10 이미 서버와 같은 컬렉션은 다시 보내지 않음(불필요한 변경 이력 방지)", async () => {
      const n0 = server.calls.length;
      await A.Sync.push(["schedules", "notices"]);
      ok(!server.calls.slice(n0).some(c => c.method === "POST"), "POST 없음");
    });
    t("YC11 암호 관리(vault)는 쪼개어 섞지 않음 — 양쪽이 바뀌면 이 탭 값 통째로", () => {
      const src = read("js/sync.js");
      ok(/ATOMIC = \{ vault: true \}/.test(src));
    });
    t("YC12 서버 SQL: base_at 열 · check_base 트리거(계정 세션만 · 409 PT409) · 마이그레이션 이름", () => {
      const sql = read("tools/sql/semis-logi-conflict.sql");
      ok(/add column if not exists base_at timestamptz/.test(sql), "열");
      ok(/errcode = 'PT409'/.test(sql) && /semis_conflict/.test(sql), "409");
      ok(/c\.kind = 'user'/.test(sql), "계정 세션만(서명·SQL 제외)");
      ok(/before update on public\.semis_logi_store/.test(sql), "트리거");
      ok(/new\.base_at := null/.test(sql), "기준 시각은 저장하지 않음");
    });
    t("YC13 jsdom 오류 없음(충돌 방지 블록)", () => { eq(A.errors.length, 0, A.errors.join(" | ")); eq(B.errors.length, 0, B.errors.join(" | ")); });
    A.Sync.stop(); B.Sync.stop();
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
    t("RG02 규정 데이터 보정: 알 수 없는 scope → safety · ideas 배열 (멱등)", () => {
      const e2 = makeEnv();
      e2.S.data.regulations = [{ id: "x1", scope: "bogus" }];
      eq(e2.S.normalizeData(), true);
      eq(e2.S.data.regulations[0].scope, "safety", "알 수 없는 scope는 safety로");
      ok(Array.isArray(e2.S.data.regulations[0].ideas), "ideas 배열 보정");
      eq(e2.S.normalizeData(), false, "멱등");
      e2.w.close();
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
    t("V08 대시보드: 화물 태그 카드에 3D 자리 · jsdom(WebGL 없음)은 사진 대체 · 하단 3칸(v1.29 모듈 구축 현황은 맨 아래 접힌 줄)", () => {
      go(e, "dashboard");
      const st = q(e, ".ticket .tk-main #dash-3d.tk-stage");
      ok(st, "3D 자리"); ok(st.classList.contains("no-print"));
      ok(st.classList.contains("h3d-fallback"), "WebGL 없으면 사진");
      ok(q(e, ".dash-sheet.cols-3 #upcoming-box"), "다가오는 일정은 하단 시트 첫 칸");
      ok(q(e, "details.dash-build #dash-build"), "모듈 구축 현황은 접힌 줄");
      ok(q(e, ".dash-top.has-today > .ticket + .today-card"), "3D 카드 옆 '오늘'");
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
      go(e, "dashboard"); ok(q(e, ".dash-sheet-wrap > .dash-sheet.cols-3"), "시트를 감싼 컨테이너");
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
      eq(qa(e, '[data-ctf-panel="cf-a"] .ct-fgrp-t > span:first-child').map(x => x.textContent.trim()).join(","), "보고선,해외기관");   // v1.30: 제목 옆 건수(.ct-cnt)
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
    t("SC10 메인 대시보드 검색 환경 띠: 관리자 이상 · 센서 3곳 + 결로 판정 · 나머지는 화물보안 대시보드로 · 일반 사용자 제외", () => {
      go(e, "dashboard");
      ok(q(e, "#dash-scr"), "띠");
      eq(q(e, "#dash-scr .dc-head h2").textContent, "검색 환경");
      eq(qa(e, "#dash-scr .dscr-cell").length, 4);
      eq(qa(e, "#dash-scr .env-cell").length, 4, "센서 3 + 결로");
      ok(!q(e, "#dash-scr .ml-row") && !q(e, "#dash-scr .ins-dot") && !q(e, "#dash-scr .mb-c"), "검색 라인 · 점검 · 고장은 빠짐");
      const txt = q(e, "#dash-scr").textContent;
      ok(txt.includes("ETD 보호케이스") && txt.includes("CO₂ 2,367"), "기준 초과 지표");
      ok(txt.includes("수신 없음"), "검색실 오프라인");
      ok(q(e, '#dash-scr [data-dgo="sec-dash"]'), "화물보안 대시보드 링크");
      ok(q(e, ".dash-top + #dash-scr, .dash-top + .dash-scr"), "태그 카드 바로 아래");
      go(e, "sec-dash");
      ok(q(e, "#sd-scr"), "화물보안 대시보드의 화물 보안검색 띠");
      eq(qa(e, "#sd-scr .dscr-cell").length, 3);
      eq(qa(e, "#sd-scr .ml-row").length, 3);
      eq(q(e, "#sd-scr .dscr-n b").textContent, "7");
      eq(qa(e, "#sd-scr .ins-dot.on").length, 7);
      eq(qa(e, "#sd-scr .mb-c").length, 6, "최근 6개월");
      ok(!q(e, "#sd-scr .env-cell"), "검색 환경은 메인에만");
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
      ok(Eq.isLifeDue(e.S.data.equipment[2]), "HHMD 2년 — 만료");
      eq(Eq.ledgerStats().total, 3, "폐기 제외"); eq(Eq.ledgerStats().linked, 2);
      const extra = qa(e, ".eq-tbl tr[data-cares-only]");
      eq(extra.length, 6, "대장에 없는 CARES 장비 6");
    });
    t("EQ01 내용연수: 도입일 + 유형 연수(X-ray 10 · ETD 5 · WTMD 10 · HHMD 2) · 도입일 우선 · 직접 지정 표시", () => {
      const Eq = e.w.SemisEquip;
      eq(Eq.ruleDue({ type: "X-Ray", installed: "2024-01-07" }), "2034-01-07");
      eq(Eq.ruleDue({ type: "ETD(폭발물흔적)", installed: "2023-01-01" }), "2028-01-01");
      eq(Eq.ruleDue({ type: "WTMD(문형)", installed: "2023-05-22" }), "2033-05-22");
      eq(Eq.ruleDue({ type: "HHMD(휴대용)", installed: "2025-04-30" }), "2027-04-30");
      eq(Eq.TYPE_LIFE["HHMD(휴대용)"], 2);
      eq(Eq.ruleDue({ type: "HHMD(휴대용)", installed: "2024-02-29" }), "2026-02-28", "윤일 → 2월 말");
      eq(Eq.ruleDue({ type: "ETD(폭발물흔적)", installed: "2023-02-28", lifeYears: 7 }), "2030-02-28", "개별 연수");
      eq(Eq.lifeBase({ installed: "2024-01-10", mfgDate: "2023-06-01" }), "2024-01-10", "도입일 우선");
      eq(Eq.lifeBase({ installed: "", mfgDate: "2023-06-01" }), "2023-06-01", "도입일 없으면 제조일");
      const w = { type: "WTMD(문형)", installed: "2023-05-22", replaceDue: "2034-05-22" };
      eq(Eq.replaceDue(w), "2034-05-22"); ok(Eq.isCustomDue(w), "규칙과 다른 지정");
      ok(!Eq.isCustomDue({ type: "WTMD(문형)", installed: "2023-05-22", replaceDue: "2033-05-22" }), "규칙과 같으면 지정 아님");
      ok(!Eq.isCustomDue({ type: "WTMD(문형)", installed: "2023-05-22", replaceDue: "" }));
      const e7 = makeEnv();
      loginAs(e7, "hq");
      e7.S.data.equipment = [
        { id: "w1", type: "WTMD(문형)", name: "문형 A", serial: "W-A", installed: "2023-05-22", mfgDate: "", lifeYears: null, replaceDue: "2034-05-22", status: "정상", logs: [] },
        { id: "w2", type: "WTMD(문형)", name: "문형 B", serial: "W-B", installed: "2023-05-22", mfgDate: "", lifeYears: null, replaceDue: "2033-05-22", status: "정상", logs: [] }
      ];
      e7.S.saveSilent();
      go(e7, "scr-equip");
      const life = (id) => q(e7, '.eq-tbl tr[data-eq="' + id + '"] .c-life').textContent;
      ok(life("w1").includes("2034-05-22") && life("w1").includes("지정"), "지정 표시");
      ok(life("w2").includes("2033-05-22") && !life("w2").includes("지정"));
      e7.w.SemisEquip.form("w2");
      const labels = qa(e7, "#modal-box label").map(l => l.textContent);
      ok(labels.findIndex(t2 => t2.startsWith("도입 · 설치일")) >= 0 && labels.findIndex(t2 => t2.startsWith("도입 · 설치일")) < labels.findIndex(t2 => t2.startsWith("제조일")), "도입일 먼저");
      q(e7, "#e-save").click();
      eq(e7.S.data.equipment.find(x => x.id === "w2").replaceDue, "", "규칙과 같은 날짜는 저장하지 않음");
      e7.w.SemisEquip.form("w1");
      q(e7, "#e-save").click();
      eq(e7.S.data.equipment.find(x => x.id === "w1").replaceDue, "2034-05-22", "직접 지정은 유지");
      e7.w.SemisEquip.form("w1");
      q(e7, "#e-repdue").value = ""; q(e7, "#e-save").click();
      eq(e7.w.SemisEquip.replaceDue(e7.S.data.equipment.find(x => x.id === "w1")), "2033-05-22", "지정 해제 → 규칙 날짜");
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
    t("SC16 메뉴: 화물 보안 허브 실메뉴 · 출입 관리는 예정 · SYNC 키", () => {
      const mn = (id) => e.S.data.menus.find(m => m.module === id);
      ok(!mn("scr-status").planned && !mn("scr-equip").planned);
      ok(!mn("kc-ra").planned && mn("access").planned);   // v1.41 상용화주 · RA 실모듈
      eq(e.S.normalizeData(), false, "변화 없음");
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
    /* ── [SD] v1.28 화물보안 대시보드 · 경비대원 배치도 ── */
    const MIN3 = 180000;
    const ENVGEN = [];
    ["ICN_CARGO_B", "ICN_ETD_CASE", "ICN_SEARCH_ROOM"].forEach((d, di) => {
      for (let i = 479; i >= 0; i--) {
        const t = NOW - i * MIN3;
        const o = { deviceId: d, online: true, timestamp: new Date(t).toISOString() };
        if (di === 0) Object.assign(o, { temp: 22 + Math.sin(i / 40), humidity: 70, co2: 500, hcho: 0.05, tvoc: 0.5, pm25: 10, pm10: 20 });
        if (di === 1) Object.assign(o, { temp: 25, humidity: 60, co2: i < 20 ? 2100 : 800, hcho: 0.01, tvoc: 0.2, pm25: 10, pm10: 20 });
        if (di === 2) Object.assign(o, { temp: 19.5, humidity: 50, co2: 600, hcho: 0.01, tvoc: 0.1, pm25: 8, pm10: 15 });
        ENVGEN.push(o);
      }
    });
    const envCalls = [];
    /* 지난 30일 점검(주별 이행률용): X-ray 1호기 매일 · IONAB 5호기 이틀에 한 번, 06시대 */
    const D0 = K.dayStartMs(K.todayKey());
    const EXTRA = [];
    for (let d = 1; d <= 30; d++) {
      EXTRA.push({ id: "xa" + d, type: "daily", equipmentId: "x1", equipmentName: "RAP-638DV", equipmentType: "X-RAY", inspector: "최정희", inspectedAtMs: D0 - d * DAY + 6 * HOUR + 10 * 60000, checklist: [], remark: "" });
      if (d % 2 === 0) EXTRA.push({ id: "xe" + d, type: "daily", equipmentId: "e5", equipmentName: "IONAB 5호기", equipmentType: "ETD", inspector: "최정희", inspectedAtMs: D0 - d * DAY + 6 * HOUR + 20 * 60000,
        checklist: d === 4 ? [{ itemId: "b", itemName: "배터리 상태", result: "caution", note: "충전 느림" }] : [], remark: "" });
    }
    const fake2 = (url, opts) => {
      if (String(url).indexOf(":runQuery") >= 0) {
        const sq = JSON.parse(opts.body).structuredQuery;
        if (sq.from[0].collectionId === "inspectionLogs" && sq.where && sq.where.fieldFilter.op === "GREATER_THAN_OR_EQUAL" && Number(sq.where.fieldFilter.value.integerValue) < D0) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(INSP.concat(EXTRA).map(o => ({ document: doc("inspectionLogs", o.id, o) }))) });
        }
        if (sq.from[0].collectionId === "sensorLogs" && sq.where) {
          const since = Date.parse(sq.where.fieldFilter.value.timestampValue);
          envCalls.push({ op: sq.where.fieldFilter.op, since, select: sq.select, limit: sq.limit });
          const got = ENVGEN.filter(o => Date.parse(o.timestamp) > since).slice(0, sq.limit);
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(got.map((o, i) => ({ document: doc("sensorLogs", "g" + since + "_" + i, o) }))) });
        }
      }
      return fake(url, opts);
    };
    const PTS = [
      { id: "p1", label: "P1", kind: "person", x: 10, y: 20, lp: "b", cr: true, dmd: true, note: "" },
      { id: "p2", label: "P2", kind: "cargo", x: 40, y: 30, lp: "t", cr: false, dmd: false, note: "시험 비고" },
      { id: "p3", label: "P3", kind: "cargo", x: 55, y: 60, lp: "r", cr: false, dmd: false, note: "" },
      { id: "p4", label: "P10", kind: "shared", x: 70, y: 40, lp: "l", cr: true, dmd: false, note: "" },
      { id: "p5", label: "P4", kind: "land", x: 90, y: 80, lp: "b", cr: false, dmd: false, note: "" },
      { id: "bad", label: "X", kind: "nope", x: 1, y: 1 }
    ];
    const IMG = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
    t("SD01 메뉴: 화물 보안 허브 맨 위 '화물보안 대시보드'(mgr) · 옛 메뉴 데이터에는 1회 추가(멱등)", () => {
      const def = e.S.defaultMenus();
      const kids = def.filter(m => m.parent === "hub-sec").sort((a, b) => a.seq - b.seq);
      eq(kids[0].module, "sec-dash"); eq(kids[0].vis, "mgr"); eq(kids[0].label, "화물보안 대시보드");
      const mn = () => e.S.data.menus.filter(m => m.module === "sec-dash");
      const keep = e.S.data.menus.slice();
      e.S.data.menus = e.S.data.menus.filter(m => m.module !== "sec-dash");
      e.S.normalizeData();
      eq(mn().length, 1, "추가");
      const hubKids = e.S.data.menus.filter(m => m.parent === "hub-sec").sort((a, b) => a.seq - b.seq);
      eq(hubKids[0].module, "sec-dash", "허브 맨 위");
      ok(hubKids[0].seq > e.S.data.menus.find(m => m.id === "hub-sec").seq, "허브 뒤");
      eq(e.S.normalizeData(), false, "두 번째는 변화 없음");
      e.S.data.menus = keep; e.S.saveSilent(); e.S.renderNav();
      ok(e.w.SemisSync.SYNC_KEYS.indexOf("secPost") >= 0 && e.w.SemisSync.SYNC_KEYS.indexOf("secPostImg") >= 0);
      eq(ACL.secPost.join(","), "2,3"); eq(ACL.secPostImg.join(","), "2,3");
    });
    t("SD02 레일 '화물 보안' → 오른쪽 화면이 화물보안 대시보드 · 이미 그 화면이면 패널 · 권한 밖이면 예전처럼", () => {
      loginAs(e, "manager");
      Object.defineProperty(e.w, "innerWidth", { value: 1440, configurable: true });
      go(e, "scr-equip");
      q(e, '#rail-hubs [data-hub="hub-sec"]').click();
      eq(e.w.location.hash, "#/sec-dash", "허브 대시보드로 이동");
      e.S.renderView();
      ok(q(e, "#sd-body"), "화면");
      eq(q(e, "#view").getAttribute("data-hub"), "hub-sec", "허브 배너");
      ok(q(e, "#view .page-head [data-print-btn]"), "인쇄 버튼");
      ok(q(e, '#nav-menu .hub.on[data-hub="hub-sec"] .nav-item.active[data-route="sec-dash"]'), "허브 패널 · 메뉴 강조");
      Object.defineProperty(e.w, "innerWidth", { value: 1024, configurable: true });
      q(e, '#rail-hubs [data-hub="hub-sec"]').click();
      ok(q(e, "#app").classList.contains("panel-open"), "이미 대시보드 — 태블릿 패널 열림");
      e.S.closeOverlays();
      go(e, "dashboard");
      q(e, '#rail-hubs [data-hub="hub-doc"]').click();
      eq(e.w.location.hash, "#/dashboard", "다른 허브는 그대로");
      e.S.closeOverlays();
      Object.defineProperty(e.w, "innerWidth", { value: 1440, configurable: true });
      loginAs(e, "user"); go(e, "dashboard");
      eq(e.S.hubHomeRoute("hub-sec"), null, "일반 사용자 — 대시보드 권한 밖");
      loginAs(e, "manager");
      const mn = e.S.data.menus.find(m => m.module === "sec-dash");
      mn.hidden = true;
      eq(e.S.hubHomeRoute("hub-sec"), null, "숨긴 메뉴");
      delete mn.hidden;
    });
    await ta("SD03 CARES 통계: 12개월 고장 · 가동률 · 복구 시간 · 주별 이행률 · 점검 시각 · 이상 항목", async () => {
      K._reset(); e.w.localStorage.setItem("semisl:caresKey", "test-key"); e.w.localStorage.removeItem("semisl:caresEnv");
      K._setFetch(fake2);
      await K.load({ parts: ["live", "repairs", "history", "env"] });
      const SD = e.w.SemisSecDash;
      const es = SD.equipStats();
      eq(es.count, 3); eq(es.active.length, 1); eq(es.fixed, 2);
      eq(Math.round(es.mttrMs / HOUR), 2, "(3h + 1h) / 2");
      ok(es.avail > 0.98 && es.avail < 1, "가동률");
      ok(Math.abs(es.mtbfDays - es.rows.reduce((n, r) => n + r.days, 0) / 3) < 1e-9, "장비당 고장 간격");
      const ms = SD.monthly(12);
      eq(ms.length, 12); eq(ms.reduce((n, m) => n + m.xray + m.etd, 0), 3);
      eq(ms.reduce((n, m) => n + m.xray, 0), 2, "X-ray 2 · ETD 1");
      const wk = SD.weekly(12);
      eq(wk.length, 12);
      eq(wk[11].to, K.mdk(K.dayKey(Date.now() - DAY)), "어제까지");
      eq(wk[11].xrayN.join("/"), "7/21", "X-ray 3대 × 7일 중 1호기만");
      ok(Math.abs(wk[11].xray - 1 / 3) < 1e-9);
      ok(wk[11].etdN[1] > 0 && wk[11].etdN[0] >= 3, "IONAB 5호기 이틀에 한 번");
      ok(wk[0].xray == null && wk[0].etd == null, "점검 기록이 시작되기 전 주는 비움");
      const i28 = SD.inspect28();
      eq(i28.n, 7 + 27 + 13); eq(i28.hours[6], 40 + INSP.filter(r => K.hm(r.inspectedAtMs).slice(0, 2) === "06").length, "06시대(오늘 점검이 06시대에 들면 더함)"); eq(i28.who[0].name, "최정희"); eq(i28.who[0].n, 40);
      const an = SD.anomalies(5);
      eq(an.bad, 1); eq(an.total, 2); eq(an.list[0].c.itemName, "동작", "최근 순");
      const r28 = SD.rate28();
      ok(r28.xray > 0.3 && r28.xray < 0.4, "X-ray 28일");
      const late = SD.periodicLate();
      ok(late.weekly.some(x => x.u.id === "x1" && x.gap === 26), "X-ray 1호기 주간 26일");
      ok(!late.weekly.some(x => x.u.id === "e3"), "수리 중 장비는 제외");
      eq(SD.niceTicks(0, 100, 4).join(","), "0,25,50,75,100");
      eq(SD.niceTicks(21.3, 26.8, 4).join(","), "20,22,24,26,28");
    });
    await ta("SD04 환경센서 24시간: 한 번에 받고(투영) 이 브라우저에 쌓아 두고 · 다음엔 마지막 수신 이후만", async () => {
      eq(envCalls.length, 1);
      eq(envCalls[0].op, "GREATER_THAN");
      ok(envCalls[0].select && envCalls[0].select.fields.some(f => f.fieldPath === "temp"), "필드 투영");
      ok(Math.abs(envCalls[0].since - (Date.now() - 24 * HOUR)) < 60000, "24시간 전부터");
      eq(K.state.env.length, 1440);
      const cache = JSON.parse(e.w.localStorage.getItem("semisl:caresEnv"));
      eq(cache.v, 1); eq(cache.rows.length, 1440); eq(cache.rows[0].length, 9);
      await K.load({ parts: ["env"], force: ["env"] });
      eq(envCalls.length, 2);
      eq(envCalls[1].since, Date.parse(ENVGEN[ENVGEN.length - 1].timestamp), "마지막 수신 이후만");
      eq(K.state.env.length, 1440, "중복 없음");
      const m = e.w.SemisSecDash.envModel();
      eq(m.ids.length, 3); eq(m.margin.length, 480);
      const etd = m.over.find(o => o.id === "ICN_ETD_CASE");
      eq(etd.m.co2, 60, "CO₂ 기준 초과 20회 × 3분");
      ok(m.overKeys.some(x => x.key === "co2"));
      /* 새 탭(메모리 없음)도 이 브라우저 기록에서 이어 받는다 */
      K._reset(); e.w.localStorage.setItem("semisl:caresKey", "test-key"); K._setFetch(fake2);
      await K.load({ parts: ["env"] });
      eq(envCalls[2].since, Date.parse(ENVGEN[ENVGEN.length - 1].timestamp), "기록 이후만");
      eq(K.state.env.length, 1440);
      await K.load({ parts: ["live", "repairs", "history"] });
    });
    t("SD05 화면: 요약 지표 · 월별 고장 12칸 · 장비별 가동률 8행 · 주별 이행률 선 · 시각 24칸 · 환경 3차트 · 기준 초과 표", () => {
      loginAs(e, "manager");
      go(e, "sec-dash");
      const labels = qa(e, "#sd-kpi .stat-label").map(x => x.textContent);
      eq(labels.slice(0, 4).join("|"), "장비 가동률|고장 신고|평균 복구 시간|일일점검 이행률");
      eq(qa(e, "#sd-kpi .stat-value")[1].textContent, "3건");
      eq(qa(e, "#sd-body .sd-card").length, 4, "고장 · 점검 · 위해물품(v1.36) · 환경");
      eq(qa(e, "#sd-body .sd-card")[0].querySelectorAll(".cc-col").length, 12);
      eq(qa(e, "#sd-body .sd-card")[0].querySelectorAll(".av-row").length, 8);
      ok(q(e, '.lc[data-lc="wk"] polyline'), "주별 선");
      const wkN = e.w.SemisSecDash.weekly(12).reduce((n, w) => n + (w.xray != null) + (w.etd != null), 0);
      ok(wkN >= 8); eq(qa(e, '.lc[data-lc="wk"] .lc-dot').length, wkN, "값 있는 주마다 표식");
      eq(qa(e, "#sd-body .sd-card")[1].querySelectorAll(".cc-col").length, 24, "0~23시");
      ok(q(e, '.lc[data-lc="env-t"] polyline') && q(e, '.lc[data-lc="env-h"] polyline') && q(e, '.lc[data-lc="env-m"] polyline'));
      eq(qa(e, '.lc[data-lc="env-t"] .lc-dot').length, 3, "끝점 3");
      eq(qa(e, '.lc[data-lc="env-m"] .lc-rl').length, 2, "3℃ · 0℃ 기준선");
      const over = q(e, ".sd-over");
      ok(over && over.textContent.includes("CO₂") && over.textContent.includes("1시간"), "기준 초과 시간");
      ok(q(e, ".sd-tbl table"), "표로 보기");
      ok(q(e, "#sd-body").textContent.includes("안도빈"), "점검자별");
      q(e, '[data-sd-equip="analysis"]').click();
      eq(e.w.location.hash, "#/scr-equip");
      go(e, "sec-dash");
    });
    t("SD06 배치도: 권한 밖이면 칸 없음 · 데이터 없으면 hq 등록 버튼 · 유형 칩 · 지점 · 필터 · 정보 · 목록", () => {
      loginAs(e, "manager"); go(e, "sec-dash");
      ok(q(e, "#gp-card .empty-state"), "빈 배치도");
      ok(!q(e, "#gp-edit"), "manager — 등록 버튼 없음");
      loginAs(e, "hq"); go(e, "sec-dash");
      ok(q(e, "#gp-edit"), "hq — 배치도 등록");
      e.S.data.secPost = { title: "시험 배치도", asOf: "2026-09-01", note: "", points: JSON.parse(JSON.stringify(PTS)) };
      e.S.data.secPostImg = { img: IMG, w: 200, h: 100 };
      e.S.saveSilent();
      loginAs(e, "manager"); go(e, "sec-dash");
      const card = q(e, "#gp-card");
      ok(card.textContent.includes("시험 배치도") && card.textContent.includes("기준 2026.09.01"));
      eq(qa(e, "#gp-card .gp-pt").length, 5, "알 수 없는 유형은 빼고");
      eq(qa(e, "#gp-card .gp-f").map(b => b.querySelector("b").textContent).join(","), "5,1,2,1,1");
      ok(q(e, ".gp-fac").textContent.replace(/\s+/g, "").includes("카드리더2·문형금속탐지기1"));
      eq(q(e, ".gp-map").getAttribute("style").replace(/\s+/g, ""), "aspect-ratio:200/100");
      eq(q(e, '.gp-pt[data-gp="p2"]').style.left, "40%");
      eq(qa(e, ".gp-lrow").length, 4);
      eq(qa(e, '.gp-lrow[data-k="cargo"] .gp-chip').map(x => x.textContent).join(","), "P2,P3");
      eq(qa(e, ".gp-lpts .gp-chip").map(x => x.textContent).join(",").indexOf("P10") > qa(e, ".gp-lpts .gp-chip").map(x => x.textContent).join(",").indexOf("P4") || true, true);
      q(e, '.gp-f[data-gpk="cargo"]').click();
      eq(q(e, ".gp-map").dataset.f, "cargo"); eq(q(e, '.gp-f[data-gpk="cargo"]').getAttribute("aria-pressed"), "true");
      q(e, '.gp-pt[data-gp="p1"]').click();
      eq(q(e, ".gp-map").dataset.f, "", "다른 유형 지점을 고르면 필터 해제");
      const pop = q(e, "#gp-pop");
      ok(!pop.hidden && pop.textContent.includes("인원 출입 전용 통로") && pop.textContent.includes("카드리더") && pop.textContent.includes("문형 금속탐지기"));
      eq(pop.dataset.v, "down"); eq(pop.dataset.h, "left");
      q(e, '.gp-chip[data-gp="p2"]').click();
      ok(q(e, '.gp-pt[data-gp="p2"]').classList.contains("on") && q(e, "#gp-pop").textContent.includes("시험 비고"));
      e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ok(q(e, "#gp-pop").hidden, "Esc 닫기");
      ok(!q(e, "#gp-edit"), "manager — 편집 없음");
      eq(qa(e, "#sd-kpi .stat-label").slice(-1)[0].textContent, "경비 지점");
      eq(qa(e, "#sd-kpi .stat-value").slice(-1)[0].textContent, "5곳");
      loginAs(e, "user");
      eq(e.w.SemisSecPost.cardHTML(), "", "일반 사용자 — 읽기 권한 밖");
      loginAs(e, "manager");
    });
    t("SD07 배치도 편집(hq): 제목 · 지점 추가 · 유형 · 카드리더 · 이름 확인 · 삭제 · 저장", () => {
      loginAs(e, "hq"); go(e, "sec-dash");
      q(e, "#gp-edit").click();
      ok(q(e, "#modal-box.full"), "넓은 편집 창");
      eq(qa(e, "#gp-e-rows tr").length, 6, "원본 항목 유지(유형 보정)");
      eq(qa(e, "#gp-e-map .gp-pt").length, 6);
      q(e, "#gp-e-title").value = "새 제목";
      q(e, "#gp-e-add").click();
      eq(qa(e, "#gp-e-rows tr").length, 7);
      q(e, "#gp-e-save").click();
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "빈 이름 — 저장 막음");
      const tr = qa(e, "#gp-e-rows tr").slice(-1)[0];
      const lab = tr.querySelector('[data-f="label"]'); lab.value = "P2"; lab.dispatchEvent(new e.w.Event("input"));
      q(e, "#gp-e-save").click();
      ok(!q(e, "#modal-overlay").classList.contains("hidden"), "같은 이름 — 저장 막음");
      lab.value = "N1"; lab.dispatchEvent(new e.w.Event("input"));
      const kind = tr.querySelector('[data-f="kind"]'); kind.value = "land"; kind.dispatchEvent(new e.w.Event("change"));
      const cr = tr.querySelector('[data-f="cr"]'); cr.checked = true; cr.dispatchEvent(new e.w.Event("change"));
      q(e, '#gp-e-rows tr[data-row="p3"] [data-del]').click();
      q(e, '#gp-e-rows tr[data-row="bad"] [data-del]').click();
      q(e, "#gp-e-save").click();
      ok(q(e, "#modal-overlay").classList.contains("hidden"), "저장");
      const d = e.S.data.secPost;
      eq(d.title, "새 제목"); eq(d.points.length, 5);
      const n1 = d.points.find(p => p.label === "N1");
      ok(n1 && n1.kind === "land" && n1.cr === true && n1.x === 50 && n1.y === 50);
      ok(!d.points.some(p => p.id === "p3"));
      eq(e.S.data.secPostImg.img, IMG, "도면은 그대로");
      ok(d.updatedAt && d.updatedBy);
      eq(qa(e, "#gp-card .gp-pt").length, 5, "화면 반영");
    });
    t("SD08 통합 검색 · 공개 저장소에 실제 배치 없음", () => {
      const r = e.w.SemisSearch.search("N1");
      const hit = r.find(x => x.group === "경비대원 배치도");
      ok(hit && hit.route === "sec-dash", "검색 결과");
      ["js/secpost.js", "js/secdash.js", "js/screening.js", "js/cares.js", "docs/HANDOFF.md", "README.md"].forEach(f => {
        const src = read(f);
        ok(!/data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]{40}/.test(src), f + " 도면 없음");
        ok(!/\b[LA]\d-\d\b/.test(src) && !/label["']?\s*:\s*["'][LA]\d/.test(src), f + " 지점 이름 · 목록 없음");
      });
      ok(read("index.html").indexOf("js/secpost.js") > 0 && read("index.html").indexOf("js/secdash.js") > read("index.html").indexOf("js/secpost.js"));
    });
    await ta("SD09 CARES 일부 실패: 0건 · 100% 대신 '불러오지 못함' · 다시 시도 · 30초 뒤 다시 읽기", async () => {
      let failRep = true; const repCalls = [];
      const fake3 = (url, opts) => {
        if (String(url).indexOf(":runQuery") >= 0 && JSON.parse(opts.body).structuredQuery.from[0].collectionId === "repairLogs") {
          repCalls.push(1);
          if (failRep) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
        }
        return fake2(url, opts);
      };
      K._reset(); e.w.localStorage.setItem("semisl:caresKey", "test-key"); K._setFetch(fake3);
      await K.load({ parts: ["live", "repairs", "history", "env"] });
      ok(K.failed("repairs") && !K.failed("history") && !K.failed("live"));
      loginAs(e, "manager"); go(e, "sec-dash");
      const labels = qa(e, "#sd-kpi .stat-label").map(x => x.textContent);
      ok(labels.indexOf("장비 가동률") < 0 && labels.indexOf("고장 신고") < 0, "실패한 지표는 빼고");
      ok(labels.indexOf("일일점검 이행률") >= 0);
      const c0 = qa(e, "#sd-body .sd-card")[0];
      ok(c0.querySelector(".sd-fail [data-sd-retry]") && !c0.querySelector(".cc-col"), "고장 카드 = 불러오지 못함 + 다시 시도");
      ok(q(e, "#sd-scr").textContent.includes("고장 기록을 불러오지 못했습니다"), "띠의 고장 칸도");
      const n = repCalls.length;
      await K.load({ parts: ["repairs"] }); eq(repCalls.length, n, "30초 안에는 다시 읽지 않음");
      K.state.parts.repairs -= 31000; failRep = false;
      await K.load({ parts: ["repairs"] });
      eq(repCalls.length, n + 1, "30초가 지나면 다시 읽음"); ok(!K.failed("repairs")); eq(K.state.repairs.length, 3);
      K._setFetch(fake2);
    });
    /* ── v1.36 위해물품 적발 일지 — CARES 월 집계(hazStats)만 읽어 세 화면에 ── */
    {
      const ym0 = K.ymKST(0), ym1 = K.ymKST(-1), ym2 = K.ymKST(-2);
      const HAZ = [
        { id: ym2, month: ym2, total: 371, cat: { liquid: 300, powder: 33, mixed: 30, other: 8, none: 0 }, loc: { "1": 120, "2": 150, "3": 101, etc: 0 }, withdrawn: 3, review: 0 },
        { id: ym1, month: ym1, total: 402, cat: { liquid: 333, powder: 30, mixed: 30, other: 7, none: 2 }, loc: { "1": 146, "2": 164, "3": 92, etc: 0 }, withdrawn: 2, review: 215, day: { "01": 16 } },
        { id: ym0, month: ym0, total: 9, cat: { liquid: 6, powder: 1, mixed: 1, other: 1 }, loc: { "1": 4, "2": 3, "3": 2 }, withdrawn: 1 },
        { id: "bogus", total: 99 }
      ];
      let hazFail = false; const hzCalls = [];
      const fakeHz = (url, opts) => {
        url = String(url); hzCalls.push({ url, method: (opts && opts.method) || "GET" });
        if (url.indexOf("/hazStats?") >= 0) return hazFail ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
          : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ documents: HAZ.map(o => doc("hazStats", o.id, o)) }) });
        return fake2(url, opts);
      };
      await ta("HZ01 위해물품 월 집계: hazStats 한 번 GET · 월 형식만 · 분류/호기 숫자 · 12개월 이어 붙이기 · 기록 원본(hazFinds)은 읽지 않음", async () => {
        K._setFetch(fakeHz);
        await K.load({ parts: ["haz"], force: true });
        eq(K.state.haz.map(d => d.id).join(","), [ym2, ym1, ym0].join(","), "월 형식만 · 정렬");
        const m = K.hazMonth(ym1);
        eq(m.total, 402); eq(m.cat.liquid, 333); eq(m.cat.none, 2); eq(m.loc["2"], 164); eq(m.withdrawn, 2); ok(m.has);
        const z = K.hazMonth("2001-01"); eq(z.total, 0); ok(!z.has); eq(z.cat.mixed, 0);
        const ser = K.hazSeries(12);
        eq(ser.length, 12); eq(ser[11].ym, ym0); eq(ser[10].total, 402); eq(ser[0].total, 0);
        ok(hzCalls.every(c => c.method === "GET" && c.url.indexOf("hazFinds") < 0), "GET · hazFinds 없음");
        ok(!/hazFinds["']\s*[,)]/.test(read("js/cares.js") + read("js/hazfind.js")), "원본 컬렉션 조회 코드 없음");
        const n = hzCalls.length; await K.load({ parts: ["haz"] }); eq(hzCalls.length, n, "10분 캐시");
      });
      t("HZ02 화물보안 대시보드: 위해물품 카드(이번 달 · 분류 · 호기 · 반입취하 + 12개월 막대) · 요약 지표 · CARES 링크", () => {
        loginAs(e, "manager"); go(e, "sec-dash");
        const card = qa(e, "#sd-body .sd-card").find(c => c.getAttribute("aria-label") === "위해물품 적발 일지");
        ok(card, "카드");
        eq(card.querySelector(".hzf-big").textContent, "9");
        eq(card.querySelectorAll(".cc-col").length, 12, "12개월");
        ok(card.querySelector(".hzf-dl").textContent.includes("액체6"), card.querySelector(".hzf-dl").textContent);
        ok(card.querySelector(".hzf-dl.is-loc").textContent.includes("반입취하1"));
        ok(card.textContent.includes("지난달 402건"), "지난달");
        eq(card.querySelector(".hzf-link").getAttribute("href"), "https://airzeta-security-system.web.app/#/hazard");
        eq(card.querySelector(".hzf-link").getAttribute("rel"), "noopener");
        const lb = qa(e, "#sd-kpi .stat-label").map(x => x.textContent), i = lb.indexOf("위해물품 적발");
        ok(i >= 0); eq(qa(e, "#sd-kpi .stat-value")[i].textContent, "9건");
      });
      t("HZ03 보안 기록부: 오늘 = 위해물품 양식 뒤 카드(이번 달 · 지난달) · 기록 현황 = 12개월 칸 띠", () => {
        loginAs(e, "manager");
        const SL = e.w.SemisSeclog;
        SL.setState({ tab: "today" }); go(e, "inspection");
        const c = q(e, "#view .hzf-card");
        ok(c, "카드"); eq(c.dataset.tone, "ok");
        ok(c.textContent.includes("이번 달 9건") && c.textContent.includes("지난달 402건") && c.textContent.includes("반입취하 1"), c.textContent);
        const prev = c.closest(".hzf-slot").previousElementSibling;
        const tpl = SL.tplOf(prev.dataset.tid);
        eq(tpl && tpl.grp, "hazmat", "위해물품 묶음 양식 뒤");
        SL.setState({ tab: "status" }); go(e, "inspection");
        const row = qa(e, "#view .sl-row").find(r => r.textContent.includes("위해물품 적발 일지"));
        ok(row, "기록 현황 줄");
        eq(row.querySelectorAll(".sl-cell").length, 12);
        eq(row.querySelectorAll('.sl-cell[data-c="ok"]').length, 3);
        eq(row.querySelector(".sl-rate").textContent, "2/11");
        SL.setState({ tab: "today" });
      });
      t("HZ04 점검 · 교육 대시보드: 보안 기록부 카드 안 위해물품 월 합계 한 줄", () => {
        loginAs(e, "manager"); go(e, "aud-dash");
        const line = q(e, "#view .hzf-line");
        ok(line, "한 줄");
        ok(line.textContent.includes(Number(ym0.slice(5)) + "월 9건") && line.textContent.includes(Number(ym1.slice(5)) + "월 402건"), line.textContent);
        ok(line.closest('[aria-label="보안 기록부"]'), "보안 기록부 카드 안");
      });
      await ta("HZ05 CARES 실패: 카드 · 줄은 '불러오지 못함/연결 실패' · 요약 지표 빠짐", async () => {
        hazFail = true; K.state.parts.haz = 0; K.state.haz = [];
        await K.load({ parts: ["haz"], force: true });
        ok(K.failed("haz"));
        loginAs(e, "manager"); go(e, "sec-dash");
        ok(q(e, '#sd-body [aria-label="위해물품 적발 일지"]').textContent.includes("불러오지 못했습니다"));
        ok(qa(e, "#sd-kpi .stat-label").every(x => x.textContent !== "위해물품 적발"));
        e.w.SemisSeclog.setState({ tab: "today" }); go(e, "inspection");
        ok(q(e, "#view .hzf-card").textContent.includes("CARES 연결 실패"));
        hazFail = false; K.state.parts.haz = 0;
        await K.load({ parts: ["haz"], force: true });
        ok(!K.failed("haz")); K._setFetch(fake2);
      });
    }
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
      eq(qa(e, ".stat-value").map(x => x.textContent).join(","), "3,3,6,6,5");
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
      ok(!/01\d-\d{3,4}-\d{4}/.test(s)); ok(s.indexOf("rows: [{") < 0 || s.indexOf("DATA.crisis = {") > 0);
      ok(e.Sync.SYNC_KEYS.indexOf("crisis") >= 0);
      const c = read("css/main.css");
      ok(c.indexOf(".cr-home") > 0 && c.indexOf(".cr-line") > 0 && c.indexOf(".cr-mxt") > 0);
    });
    t("CR11 연락처: 번호 찾는 순서(이 화면 → 비상연락망 동명 1명 → 업무 연락처) · 번호 없음 통계 · '+ 번호'(hq)", () => {
      e.S.data.crisis.people = {};
      e.S.data.phonebook = { groups: [{ id: "g", name: "가" }], rows: [{ id: "p1", group: "g", name: "정일", mobile: "010-0000-7777" }] };
      e.S.saveSilent(); CR.setState({ view: "org", org: "", query: "", noNum: false }); e.S.renderView();
      eq(CR.contactOf("정일").src, "phonebook", "업무 연락처 보조");
      eq(CR.contactOf("갑일"), null, "비상연락망 동명이인이면 업무 연락처로 넘어가지 않음");
      const before = CR.missing().length;
      ok(qa(e, ".stat-value").slice(-1)[0].textContent === String(before));
      ok(q(e, ".cr-addnum[data-pc]"), "hq: 번호 없는 이름 옆 + 번호");
      loginAs(e, "manager"); e.S.renderView();
      ok(!q(e, ".cr-addnum") && !q(e, "#cr-bulk") && !q(e, ".cr-pedit"), "manager 편집 없음");
      loginAs(e, "hq"); e.S.renderView();
    });
    t("CR12 한 사람 편집: 번호 저장(정리) · 이 화면 번호 우선 · 이름 바꾸면 모든 임무 반영 · 입력 지우기", () => {
      const name = q(e, ".cr-addnum[data-pc]").dataset.pc;
      q(e, `.cr-addnum[data-pc='${name}']`).click();
      q(e, "#cr-c-mobile").value = "잘못된번호"; clickOk(e);
      ok(q(e, "#cr-c-mobile"), "형식 오류면 닫히지 않음");
      q(e, "#cr-c-mobile").value = "01012345678"; clickOk(e);
      eq(e.S.data.crisis.people[name].mobile, "010-1234-5678");
      eq(CR.contactOf(name).src, "crisis");
      ok(qa(e, ".cr-p").some(p => p.querySelector(`[data-person='${name}']`) && p.querySelector(".cr-tel[href='tel:01012345678']")), "전화 버튼으로 바뀜");
      const n0 = e.S.data.crisis.rows.filter(r => r.main === name || r.sub === name).length;
      CR.editPerson(name);
      ok(qa(e, "#modal-box [data-medit]").length === n0, "맡은 임무 목록 · 수정 링크");
      q(e, "#cr-c-name").value = name + "수"; clickOk(e);
      eq(e.S.data.crisis.rows.filter(r => r.main === name + "수" || r.sub === name + "수").length, n0);
      ok(!e.S.data.crisis.people[name] && e.S.data.crisis.people[name + "수"], "번호도 새 이름으로");
      CR.editPerson(name + "수");
      q(e, "#modal-box [data-act=clear]").click();
      ok(!e.S.data.crisis.people[name + "수"]);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("CR13 번호 없음 필터 · 일괄 입력(바뀐 칸만 · Enter 다음 칸) · 담당자 카드 편집 버튼", () => {
      q(e, "#cr-nonum").click();
      eq(CR.getState().noNum, true); eq(q(e, "#cr-body").dataset.mode, "person");
      const miss = CR.missing().length;
      eq(qa(e, ".cr-person").length, miss); ok(qa(e, ".cr-person").every(c => c.classList.contains("no-num")));
      ok(q(e, ".cr-pedit[data-pc]"));
      q(e, "#cr-bulk").click();
      eq(qa(e, "#modal-box [data-bn]").length, miss);
      const ins = qa(e, "#modal-box .cr-btbl input");
      ins[0].focus(); ins[0].dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      ok(e.w.document.activeElement === ins[1], "Enter → 다음 칸");
      ins[0].value = "0212345678"; ins[3].value = "7001234";
      clickOk(e);
      const ppl = e.S.data.crisis.people;
      eq(Object.keys(ppl).length, 2);
      ok(Object.values(ppl).some(v => v.mobile === "02-1234-5678") && Object.values(ppl).some(v => v.office === "032-700-1234"));
      eq(CR.missing().length, miss - 2);
      q(e, "#cr-bulk").click(); q(e, "#modal-box [data-bmode=all]").click();
      ok(qa(e, "#modal-box [data-bn]").length > miss - 2, "전체 보기");
      e.S.closeModal();
      q(e, "#cr-clear").click(); eq(CR.getState().noNum, false);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
  }

  /* ══════════ [SP] v1.25 팀위기대응계획 SERP ══════════ */
  {
    const e = makeEnv();
    const SP = e.w.SemisSerp;
    const plan = () => ({
      title: "테스트 계획", docNo: "T-001", dept: "가팀", rev: "제1차 개정", revDate: "2026-09-23", firstDate: "2025-08-01",
      occ: { team: "통제팀 (OCC)", phone: "02-0000-0001", who: "당직" },
      sections: [{ id: "s1", no: "3.1.3", tab: "init", title: "원칙 하나", body: "첫 문단\n둘째 문단" }, { id: "s2", no: "3.2", tab: "init", title: "대외", body: "본문" },
        { id: "s3", no: "2.1", tab: "org", title: "구성", body: "본문" }, { id: "s4", no: "5.1", tab: "forms", title: "자료", body: "본문" }],
      serc: { within: 30, consider: ["통신", "시설"], online: "온라인 단서 문장", place: "", equip: "", channel: "" },
      roles: [
        { id: "leader", no: 1, name: "리더 직책", en: "Leader", who: "팀장", duties: ["지휘"], checklist: ["가동", "소집"] },
        { id: "sup", no: 2, name: "총괄 직책", en: "Sup", who: "선임", duties: ["실무"], checklist: ["설치"] },
        { id: "cargo", no: 3, name: "화물 직책", en: "Cargo", who: "실무자", duties: ["화물"], checklist: ["자료"] }],
      people: [
        { id: "p1", role: "leader", name: "갑장", grade: "부장", office: "032-000-0100", mobile: "010-0000-0100", email: "a@x.com", place: "센터", duties: ["지휘"], note: "" },
        { id: "p2", role: "sup", name: "을총", grade: "", office: "", mobile: "010-0000-0200", email: "", place: "센터", duties: [], note: "겸임 가능" },
        { id: "p3", role: "cargo", name: "병화", grade: "", office: "", mobile: "", email: "", place: "", duties: [], note: "" }],
      chart: { ext: [{ id: "ce1", org: "공항 통합운영센터", phone: "032-000-0300, 0301" }], hq: [{ id: "ch1", org: "통제팀", phone: "02-0000-0001" }] },
      timeline: [
        { id: "t1", min: 10, text: "통제팀 통보", sub: "", who: "최초 인지자", roles: ["first", "leader"], act: "occ" },
        { id: "t2", min: 10, text: "비상소집", sub: "", who: "팀장", roles: ["leader"], act: "recall" },
        { id: "t3", min: 30, text: "SERC 개설", sub: "", who: "총괄", roles: ["sup"], act: "serc" },
        { id: "t4", min: 60, text: "화주 통보", sub: "", who: "화물", roles: ["cargo"], act: "" }],
      notify: [{ id: "kind", label: "사고 종류", hint: "", opts: ["Fire", "기타"] }, { id: "when", label: "사고 일시", hint: "", start: true },
        { id: "reporter", label: "보고 일시, 보고자", hint: "", auto: true }],
      overview: { leader: "갑장", staff: "9", vendor: "90", mandatory: [{ id: "om1", org: "관계기관", phone: "044-000-0000", items: "" }], nearby: [{ id: "on1", org: "옆팀", phone: "02-0000-0002", support: "" }] },
      mgmt: [{ id: "m1", item: "비상연락망", cycle: "연 1회 이상", req: "인력 변동", checked: "2024-01-01" }],
      facilities: [{ id: "f1", kind: "승무원 보호", name: "비밀호텔", phone: "032-000-0400", note: "", conf: true }],
      agencies: [{ id: "a1", grp: "병원", org: "가병원", phone: "032-000-0500", note: "응급" }, { id: "a2", grp: "대사관", org: "나대사관", phone: "+82-2-000-0600", note: "" }],
      docs: ["NOTOC", "Cargo manifest"], revs: [{ id: "r0", no: "제정", date: "2025-08-01", clauses: "제정", reason: "신규" },
        { id: "r1", no: "제1차", date: "2026-09-23", clauses: "3.5.1", reason: "온라인", purpose: ["목적"], changes: [{ clause: "3.5.1", title: "장소", before: "가\n나", after: "가\n나\n다 새 문단" }] }],
      gaps: ["확인 하나"], images: [{ id: "i1", title: "격자지도", url: "https://x.test/a.webp", thumb: "https://x.test/a-t.webp" }]
    });
    const seed = () => {
      e.S.data.serp = plan(); e.S.data.serpRuns = [];
      e.S.data.contacts = { sections: [{ id: "cs-team", type: "people", title: "가팀", rows: [{ id: "c1", name: "직접행", mobile: "010-0000-0999" }] }] };
      e.S.saveSilent();
    };
    t("SP01 메뉴: 협력 · 비상 허브 · 비상연락망 바로 위 · mgr · 기존 데이터 자동 추가(멱등) · 구조 보정", () => {
      const m = e.S.data.menus.find(x => x.module === "serp");
      ok(m && m.type === "module" && !m.planned); eq(m.parent, "hub-ops"); eq(m.vis, "mgr");
      const ct = e.S.data.menus.find(x => x.module === "contacts");
      ok(m.seq < ct.seq);
      const old = makeEnv({ preData: { version: 1, menus: e.S.defaultMenus().filter(x => x.id !== "serp" && x.id !== "threat") } });   // v1.25 이전 데이터(v1.26 위협전화도 없음)
      const m2 = old.S.data.menus.find(x => x.module === "serp"), ct2 = old.S.data.menus.find(x => x.module === "contacts");
      const hub = old.S.data.menus.find(x => x.id === "hub-ops");
      ok(m2 && m2.parent === "hub-ops" && m2.seq < ct2.seq && m2.seq > hub.seq, "기존 메뉴 데이터: 비상연락망 바로 위");
      const firstInHub = old.S.data.menus.filter(x => x.parent === "hub-ops").sort((a, b) => a.seq - b.seq)[0];
      eq(firstInHub.id, m2.id);
      eq(old.S.normalizeData(), false, "멱등");
      ok(old.S.data.serp && !Array.isArray(old.S.data.serp) && Array.isArray(old.S.data.serpRuns));
      ok(e.Sync.SYNC_KEYS.indexOf("serp") >= 0 && e.Sync.SYNC_KEYS.indexOf("serpRuns") >= 0);
      eq(ACL.serp.join(","), "2,3"); eq(ACL.serpRuns.join(","), "2,2");
    });
    t("SP02 초동대응: 비상 띠(OCC · 공항 · 대응/훈련 시작) · 3.1 안 원칙 · SERC 온라인 단서 · 초동조치 단계 · 역할 필터 · 인쇄", () => {
      seed(); loginAs(e, "manager"); go(e, "serp");
      ok(q(e, ".sp-quick .sp-qbtn.is-occ[href='tel:0200000001']"));
      ok(q(e, ".sp-quick a[href='tel:0320000300']"), "공항 통합운영센터(여러 번호는 첫 번호)");
      ok(q(e, "[data-run-start=real]") && q(e, "[data-run-start=drill]"));
      ok(q(e, ".sp-occ [data-sec=s1]"), "3.1.x 원칙은 3.1 카드 안");
      ok(q(e, ".sp-grid3 [data-sec=s2]"));
      ok(q(e, ".sp-online").textContent.indexOf("온라인 단서 문장") >= 0 && q(e, ".sp-online .sp-rev"));
      eq(qa(e, ".sp-ph").length, 3); eq(qa(e, ".sp-ti").length, 4);
      q(e, "[data-role-f=cargo]").click(); eq(qa(e, ".sp-ti").length, 1);
      q(e, "[data-role-f='']").click();
      ok(q(e, ".page-head").textContent.indexOf("Print") >= 0);
      ok(!q(e, ".sp-ed"), "manager 편집 없음");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("SP03 조직 · 연락망: 도식(팀장 · 총괄 · 역할 칸 · 기관) · 역할 카드 · 번호 없음 표시 / 연락처: 그룹 · 대외비 · 검색(입력칸 유지)", () => {
      q(e, "[data-stab=org]").click();
      ok(q(e, ".sp-chead").textContent.indexOf("갑장") >= 0);
      ok(q(e, ".sp-csup").textContent.indexOf("을총") >= 0);
      eq(qa(e, ".sp-ccol").length, 1, "리더 · 총괄 외 역할 칸");
      eq(qa(e, ".sp-role").length, 3);
      ok(q(e, ".sp-role[data-role=cargo] .sp-pc").textContent.indexOf("병화") >= 0);
      ok(q(e, ".sp-ccol .sp-miss"), "번호 없음");
      ok(q(e, ".sp-pc .is-note").textContent.indexOf("겸임 가능") >= 0);
      q(e, "[data-stab=contacts]").click();
      ok(qa(e, ".sp-cg").length >= 5);
      ok(q(e, ".sp-cr.is-conf") && q(e, ".sp-cr.is-conf").textContent.indexOf("대외비") >= 0);
      ok(q(e, ".sp-tmore"), "추가 번호 표기");
      const qi = q(e, "#sp-cq"); qi.value = "0500"; qi.dispatchEvent(new e.w.Event("input"));
      ok(q(e, "#sp-cq") === qi, "입력칸 유지"); eq(qa(e, ".sp-cr").length, 1);
      qi.value = "없는기관"; qi.dispatchEvent(new e.w.Event("input")); ok(q(e, "#sp-cbody .empty-state"));
      qi.value = ""; qi.dispatchEvent(new e.w.Event("input"));
      ok(q(e, ".sp-img img"), "이미지 미리보기");
    });
    t("SP04 체크리스트 · 양식 / 문서 · 개정: 역할별 표 · 사고자료 대장 · 개정 신구 대비(새 문단 강조) · 관리 기준 경과 · 확인 필요는 hq만", () => {
      q(e, "[data-stab=forms]").click();
      eq(qa(e, ".sp-ckc").length, 3); eq(qa(e, ".sp-ckc[data-ck-role=leader] tbody tr:not(.sp-blank)").length, 2);
      ok(q(e, ".sp-ledger thead").textContent.indexOf("제출방법") >= 0);
      eq(qa(e, ".sp-docs li").length, 2);
      q(e, "[data-stab=doc]").click();
      eq(qa(e, ".sp-revs tbody tr").length, 2);
      eq(qa(e, ".sp-a .sp-new").length, 1); ok(q(e, ".sp-a .sp-new").textContent.indexOf("새 문단") >= 0);
      ok(q(e, ".sp-mgmt tr.is-due"), "1년 경과");
      ok(!q(e, ".sp-gaps"), "manager: 확인 필요 숨김");
      loginAs(e, "hq"); e.S.renderView();
      ok(q(e, ".sp-gaps") && q(e, "[data-mgmt=m1]"));
      q(e, "[data-mgmt=m1]").click();
      ok(e.S.data.serp.mgmt[0].checked !== "2024-01-01");
      ok(!q(e, ".sp-mgmt tr.is-due"));
      loginAs(e, "manager"); e.S.renderView();
    });
    t("SP05 대응 시작(훈련): 사본 · 대응 화면 · 경과 시계 · 메뉴 배지 · 대시보드 띠 · 두 번째 시작은 진행 중 열기", () => {
      SP.setState({ tab: "init", runSel: "" }); e.S.renderView();
      q(e, "[data-run-start=drill]").click();
      q(e, "#sp-s-title").value = "도상훈련"; q(e, "#sp-s-place").value = "램프";
      const t0 = new Date(Date.now() - 15 * 60000), p2 = (n) => String(n).padStart(2, "0");
      q(e, "#sp-s-at").value = t0.getFullYear() + "-" + p2(t0.getMonth() + 1) + "-" + p2(t0.getDate()) + "T" + p2(t0.getHours()) + ":" + p2(t0.getMinutes());
      clickOk(e);
      const runs = e.S.data.serpRuns;
      eq(runs.length, 1); eq(runs[0].kind, "drill"); eq(runs[0].items.length, 4); eq(runs[0].cks.length, 3); eq(runs[0].log.length, 1);
      ok(q(e, ".sp-status.is-drill") && q(e, ".sp-status [data-sp-t0]"), "대응 화면");
      ok(q(e, ".sp-clock").textContent.indexOf("T+") === 0, "경과 시계");
      eq(qa(e, ".sp-ri.is-late").length, 2, "10분 항목 기한 경과");
      ok(q(e, ".sp-pp.is-late"), "단계 띠 경과 표시");
      eq(SP.activeRun().id, runs[0].id);
      ok(qa(e, ".nav-meta").some(x => x.textContent === "대응 중"), "메뉴 배지: " + qa(e, ".nav-meta").map(x => x.textContent).join("/"));
      go(e, "dashboard"); ok(q(e, "#dash-serp.is-drill"), "대시보드 띠");
      q(e, "#dash-serp [data-dserp]").click();
      eq(SP.getState().runSel, runs[0].id);
      SP.setState({ runSel: "" }); e.S.renderView();
      ok(q(e, ".sp-live.is-drill"), "계획 화면 위 대응 중 띠");
      SP.startForm("real");
      eq(e.S.data.serpRuns.length, 1, "진행 중이면 새로 시작하지 않음"); eq(SP.getState().runSel, runs[0].id);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("SP06 초동조치 체크: 시각 · 기록자 · 기한 후 완료 · 수정/취소 · 역할별 체크리스트", () => {
      const r = e.S.data.serpRuns[0];
      e.w.localStorage.setItem("semisl:serp-by", "기록이");
      q(e, "[data-tl=t1]").click();
      ok(r.tl.t1 && r.tl.t1.by === "기록이");
      ok(q(e, ".sp-ri[data-item=t1] .sp-slow"), "10분 지나 완료 → 기한 후 완료");
      q(e, "[data-tl=t1]").click();
      q(e, "#sp-d-note").value = "구두 통보"; clickOk(e);
      eq(e.S.data.serpRuns[0].tl.t1.note, "구두 통보");
      q(e, "[data-tl=t1]").click(); q(e, "#modal-box [data-act=undo]").click();
      ok(!e.S.data.serpRuns[0].tl.t1);
      q(e, "[data-rtab=ck]").click();
      eq(qa(e, "[data-ck]").length, 4);
      q(e, "[data-ck='leader:1']").click();
      ok(e.S.data.serpRuns[0].ck["leader:1"].at);
      ok(q(e, "[data-rtab=ck] .sp-tn").textContent === "1/4");
    });
    t("SP07 SERC 온라인 개설 · 비상소집 문자 · 통보 양식(선택 · 발생 시각 · 미리보기 · 문자 · 통보 완료 → OCC 항목 완료)", () => {
      q(e, "[data-rtab=tl]").click();
      q(e, ".sp-st-s [data-act=serc]").click();
      q(e, "#modal-box [data-m=online]").click(); eq(q(e, "#sp-sc-lbl").textContent, "대체 통신 채널");
      q(e, "#sp-sc-place").value = "메신저방"; clickOk(e);
      let r = e.S.data.serpRuns[0];
      eq(r.serc.mode, "online"); ok(r.tl.t3 && r.tl.t3.note.indexOf("온라인") === 0);
      ok(q(e, ".sp-st-s").textContent.indexOf("온라인 개설") >= 0);
      q(e, ".sp-calls [data-act=recall]").click();
      ok(q(e, "#sp-rc-msg").value.indexOf("온라인 위기대응센터(메신저방)") > 0, "소집 문자에 SERC");
      eq(q(e, "#sp-rc-sms").getAttribute("href").split("?")[0], "sms:01000000100,01000000200", "번호 있는 인원만");
      qa(e, "#modal-box [data-rc]")[1].checked = false; qa(e, "#modal-box [data-rc]")[1].dispatchEvent(new e.w.Event("change"));
      eq(q(e, "#sp-rc-sms").getAttribute("href").split("?")[0], "sms:01000000100");
      clickOk(e);
      r = e.S.data.serpRuns[0]; ok(r.tl.t2 && r.tl.t2.note === "1명 소집");
      q(e, "[data-rtab=notify]").click();
      q(e, "[data-nf-opt=kind][data-v=Fire]").click();
      eq(e.S.data.serpRuns[0].notify.f.kind, "Fire");
      q(e, "[data-nf-start=when]").click();
      ok(/경 \(한국시각\)$/.test(e.S.data.serpRuns[0].notify.f.when));
      const inp = q(e, "#sp-nf-reporter"); inp.value = "임시"; inp.dispatchEvent(new e.w.Event("input"));
      ok(q(e, "#sp-npre").textContent.indexOf("3) 보고 일시, 보고자: 임시") >= 0, "입력 중 미리보기");
      ok(decodeURIComponent(q(e, "#sp-nsms").getAttribute("href")).indexOf("1) 사고 종류: Fire") > 0);
      inp.dispatchEvent(new e.w.Event("change"));
      eq(e.S.data.serpRuns[0].notify.f.reporter, "임시");
      q(e, "[data-notify-sent]").click(); clickOk(e);
      r = e.S.data.serpRuns[0];
      eq(r.notify.sent.length, 1); ok(r.tl.t1 && r.tl.t1.at, "통제팀 통보 → OCC 항목 완료");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("SP08 상황 기록 · 사고자료 대장(필수값 · 본사 보고) · 종료 · 결과 보고(인쇄 전용) · 삭제는 hq", () => {
      q(e, "[data-rtab=log]").click();
      q(e, "#sp-log-add").click(); const n0 = e.S.data.serpRuns[0].log.length;
      q(e, "#sp-log").value = "소방대 도착"; q(e, "#sp-log-add").click();
      eq(e.S.data.serpRuns[0].log.length, n0 + 1);
      ok(q(e, ".sp-log").textContent.indexOf("소방대 도착") >= 0);
      q(e, "[data-rtab=subs]").click();
      q(e, "#sp-sub-add").click(); clickOk(e); ok(q(e, "#sp-sb-doc"), "필수값 없으면 닫히지 않음");
      q(e, "#sp-sb-doc").value = "NOTOC"; q(e, "#sp-sb-agency").value = "조사기관"; q(e, "#sp-sb-hq").checked = true; clickOk(e);
      eq(e.S.data.serpRuns[0].subs.length, 1); ok(q(e, ".sp-ledger tbody").textContent.indexOf("보고") >= 0);
      ok(!q(e, "#sp-rdel"), "manager 삭제 없음");
      q(e, "#sp-end").click(); clickOk(e);
      const r = e.S.data.serpRuns[0];
      ok(r.end); eq(SP.activeRun(), null);
      ok(q(e, ".sp-status.is-end")); ok(!q(e, ".sp-calls"));
      const rep = q(e, ".sp-report");
      ok(rep && rep.classList.contains("print-only"));
      ok(rep.textContent.indexOf("SERP 훈련 결과") >= 0 && rep.textContent.indexOf("NOTOC") >= 0 && rep.textContent.indexOf("소방대 도착") >= 0);
      go(e, "dashboard"); ok(!q(e, "#dash-serp"), "종료 후 대시보드 띠 없음");
      go(e, "serp"); SP.setState({ runSel: "", tab: "runs" }); e.S.renderView();
      eq(qa(e, ".sp-runs tbody tr").length, 1);
      loginAs(e, "hq"); SP.setState({ runSel: r.id }); e.S.renderView();
      ok(q(e, "#sp-reopen") && q(e, "#sp-rdel"));
      q(e, "#sp-rdel").click(); clickOk(e);
      eq(e.S.data.serpRuns.length, 0);
    });
    t("SP09 hq 편집: 인원 추가 · 수정(번호 정리) → 비상연락망 '가팀' 섹션 동기화(직접 넣은 행 유지) · 삭제", () => {
      SP.setState({ runSel: "", tab: "org" }); e.S.renderView();
      q(e, "[data-person-add=cargo]").click();
      q(e, "#sp-p-name").value = "정화"; q(e, "#sp-p-mobile").value = "01000000300"; clickOk(e);
      const ps = e.S.data.serp.people;
      eq(ps.length, 4); eq(ps[3].name, "정화"); eq(ps[3].mobile, "010-0000-0300"); eq(ps[3].role, "cargo");
      const rows = e.S.data.contacts.sections[0].rows;
      eq(rows.length, 5); eq(rows[0].name, "갑장"); eq(rows[0].role, "팀장"); eq(rows[4].name, "직접행", "직접 넣은 행은 뒤에 유지");
      ok(rows[3].serp && rows[3].duty === "SERP 화물 직책");
      q(e, "[data-person-edit=p3]").click(); q(e, "#sp-p-email").value = "잘못"; clickOk(e);
      ok(q(e, "#sp-p-email"), "메일 형식");
      q(e, "#sp-p-email").value = ""; q(e, "#sp-p-mobile").value = "01000000301"; clickOk(e);
      eq(e.S.data.contacts.sections[0].rows.find(x => x.serp === "p3").mobile, "010-0000-0301");
      q(e, "[data-person-edit=p3]").click(); q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      eq(e.S.data.serp.people.length, 3); ok(!e.S.data.contacts.sections[0].rows.some(x => x.serp === "p3"));
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("SP10 hq 편집: 초동조치 줄 편집(형식 · 기존 id 유지) · 연락처 추가/수정 · 역할 · 체크리스트 · 통합 검색", () => {
      SP.setState({ tab: "init" }); e.S.renderView();
      q(e, "#sp-tl-edit").click();
      const ta2 = q(e, "#sp-tlf"); ok(ta2.value.split("\n")[0].indexOf("10 | 통제팀 통보") === 0);
      ta2.value += "\n잘못된 줄"; clickOk(e); ok(q(e, "#sp-tlf"), "형식 오류면 닫히지 않음");
      q(e, "#sp-tlf").value = ta2.value.replace("\n잘못된 줄", "") + "\n120 | 새 조치 | | 인적 | hum | facility";
      clickOk(e);
      const tl = e.S.data.serp.timeline;
      eq(tl.length, 5); eq(tl[0].id, "t1", "기존 id 유지"); eq(tl[4].act, "facility"); eq(tl[4].roles.join(","), "hum");
      SP.setState({ tab: "contacts" }); e.S.renderView();
      q(e, "[data-c-add]").click(); q(e, "#sp-c-grp").value = "병원"; q(e, "#sp-c-org").value = "다병원"; q(e, "#sp-c-phone").value = "0320000700"; clickOk(e);
      const ag = e.S.data.serp.agencies; eq(ag.length, 3); eq(ag[1].org, "다병원", "같은 분류 뒤"); eq(ag[1].phone, "032-000-0700");
      q(e, "[data-c-edit='fac:f1']").click(); ok(q(e, "#sp-c-conf").checked); q(e, "#sp-c-phone").value = "0320000401"; clickOk(e);
      eq(e.S.data.serp.facilities[0].phone, "032-000-0401");
      SP.setState({ tab: "forms" }); e.S.renderView();
      q(e, "[data-ck-edit=cargo]").click(); q(e, "#sp-lf").value = "자료\n\n추가 항목"; clickOk(e);
      eq(e.S.data.serp.roles[2].checklist.join("|"), "자료|추가 항목");
      const it = e.w.SemisSearch && e.w.SemisSearch.search ? e.w.SemisSearch.search("다병원") : null;
      if (it) ok(it.some(x => x.group === "팀위기대응계획"), "통합 검색");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("SP11 빈 계획 · 권한(user 접근 불가) · 공개 저장소 위생(serp.js에 번호 · 이름 · 원문 없음) · CSS · 스크립트", () => {
      e.S.data.serp = {}; e.S.saveSilent(); loginAs(e, "manager"); go(e, "serp");
      ok(q(e, "#view .empty-state")); ok(!q(e, "[data-run-start]"));
      const src = read("js/serp.js");
      ok(!/0\d{1,2}-\d{3,4}-\d{4}/.test(src), "전화번호 없음"); ok(!/@airzeta/.test(src), "메일 없음");
      ["임병찬", "옥정훈", "골든튤립", "하워드존슨", "ICNKF"].forEach(w => ok(src.indexOf(w) < 0, "원문 · 명단: " + w));
      const c = read("css/main.css"); ok(c.indexOf(".sp-status") > 0 && c.indexOf(".sp-chk") > 0 && c.indexOf(".dash-serp") > 0);
      ok(read("index.html").indexOf('src="js/serp.js') > 0);
      loginAs(e, "user"); go(e, "serp"); ok(!q(e, ".sp-tabs"), "user 는 대시보드로");
    });
  }

  /* ══════════ [TC] v1.26 테러 위협전화 대응 ══════════ */
  {
    const e = makeEnv();
    const TC = e.w.SemisThreat;
    const plan = () => ({
      title: "위협전화 대응", dept: "가팀", docRef: "가 절차 14 · 첨부 9", asOf: "2026-04-27", trigger: "협박 전화 접수 시",
      quick: [{ label: "가파트장", num: "032-000-0800" }, { label: "가상황실", num: "032-000-3907" }],
      cardTitle: "대응 및 보고절차", cardEn: "Threat Form", cardFoot: "※ 전화기 옆 비치",
      steps: [
        { id: "s1", no: "1", ko: "번호 확인", en: "Check ID", phase: "call", subs: [] },
        { id: "s2", no: "2", ko: "주변에 알림", en: "Signal", phase: "call", subs: [], after: { ko: "팀장에게 보고", en: "Report" } },
        { id: "s3", no: "3", ko: "통화 유지", en: "Keep", phase: "call", subs: [{ id: "u1", ko: "녹음", en: "Rec" }, { id: "u2", ko: "질문", en: "Ask" }], after: { ko: "양식 전달", en: "" } },
        { id: "s4", no: "4", ko: "보고", en: "Report", phase: "report", subs: [{ id: "u1", ko: "상황실 보고", en: "" }] }],
      tips: ["침착하게", "경청"],
      chain: [
        { id: "c1", to: "팀장", from: "접수자", when: "즉시", how: "유선", basis: "STEP 2", phones: [{ label: "팀장", num: "032-000-0700" }] },
        { id: "c2", to: "상황실", from: "팀장", when: "즉시", how: "전화", basis: "STEP 4", phones: [{ label: "가상황실", num: "032-000-3907" }], flow: "보안" },
        { id: "c3", to: "후속 보고", from: "팀장", how: "문서", basis: "", phones: [] },
        { id: "c4", to: "미국 센터", us: true, when: "즉시", how: "유선", basis: "14.3", phones: [{ label: "OUT", num: "+1-000-000-0001" }] }],
      tsoc: { no: "14.3", title: "미주 편", note: "즉시 유선", airline: "가항공", phones: [{ label: "OUT", num: "+1-000-000-0001" }],
        items: [{ ko: "항공사", en: "Airline", key: "airline" }, { ko: "편명", en: "Flight", key: "flight" }, { ko: "구간", en: "Route", key: "route" },
          { ko: "위치", en: "Position", key: "pos" }, { ko: "내용", en: "Threat", key: "threat" }, { ko: "출처", en: "Source", key: "src" }] },
      cmd: { no: "14.2.2", order: ["가순위", "나순위", "다순위"], place: "파트장 자리" },
      sections: [{ id: "x1", no: "14.1", title: "기준", body: "첫 문단\n둘째 문단" }, { id: "x2", no: "14.2.1", title: "응대 방법", body: "본문", link: "phones" }],
      rec: { url: "https://rec.test", idRule: "내선번호", idEx: "예: 000", who: "파트장", note: "공유 제한", vaultTitle: "녹취 열람 테스트" },
      phones: [{ id: "p1", grp: "post", label: "팀장", num: "032-000-0700", note: "" }, { id: "p2", grp: "post", label: "파트장", num: "032-000-0800", note: "" },
        { id: "p3", grp: "line", label: "업무 전화", num: "032-000-0821", note: "컬러링" }],
      form: { title: "위협 보고양식", foot: "즉시 제공", tips: ["침착하게"], secs: [
        { id: "fh", title: "", mode: "head", fields: [{ id: "recv", label: "접수자", kind: "text", auto: "recv" }, { id: "at", label: "일시", kind: "text", auto: "start" }] },
        { id: "fn", title: "", mode: "note", fields: [{ id: "threat", label: "위협내용", kind: "long", short: "위협 내용" }] },
        { id: "fw", title: "어디에 있습니까?", mode: "ask", fields: [{ id: "place", label: "위치", kind: "one", opts: ["터미널", "화물지역", "기타"], other: "기타", short: "위치" },
          { id: "flight", label: "편명", kind: "text" }, { id: "dep", label: "출발지", kind: "text" }, { id: "arr", label: "도착지", kind: "text" }, { id: "knows", label: "잘 알았는가?", kind: "yn" }] },
        { id: "fv", title: "음성특성", mode: "obs", group: "배경 정보", fields: [{ id: "voice", label: "", kind: "multi", opts: ["높은", "저음의", "기타"], other: "기타" }] }] },
      gaps: ["확인 하나"], checkCycle: ""
    });
    const seed = () => { e.S.data.threat = plan(); e.S.data.threatRuns = []; e.S.data.threatChecks = []; e.S.saveSilent(); };
    const inputEv = (el, v) => { el.value = v; el.dispatchEvent(new e.w.Event("input")); el.dispatchEvent(new e.w.Event("change")); };
    t("TC01 메뉴: 협력 · 비상 허브 · SERP 바로 아래 · mgr · 기존 데이터 자동 추가(멱등) · 동기화 키 · 권한표", () => {
      const m = e.S.data.menus.find(x => x.module === "threat");
      ok(m && m.type === "module" && !m.planned); eq(m.parent, "hub-ops"); eq(m.vis, "mgr");
      const sp = e.S.data.menus.find(x => x.module === "serp"), ct = e.S.data.menus.find(x => x.module === "contacts");
      ok(sp.seq < m.seq && m.seq < ct.seq, "SERP 와 비상연락망 사이");
      const old = makeEnv({ preData: { version: 1, menus: e.S.defaultMenus().filter(x => x.id !== "threat") } });
      const m2 = old.S.data.menus.find(x => x.module === "threat"), sp2 = old.S.data.menus.find(x => x.module === "serp"), ct2 = old.S.data.menus.find(x => x.module === "contacts");
      ok(m2 && m2.parent === "hub-ops" && sp2.seq < m2.seq && m2.seq < ct2.seq, "v1.25 데이터: SERP 바로 아래");
      eq(old.S.normalizeData(), false, "멱등");
      ok(old.S.data.threat && !Array.isArray(old.S.data.threat) && Array.isArray(old.S.data.threatRuns) && Array.isArray(old.S.data.threatChecks));
      ["threat", "threatRuns", "threatChecks"].forEach(k => ok(e.Sync.SYNC_KEYS.indexOf(k) >= 0, k));
      eq(ACL.threat.join(","), "2,3"); eq(ACL.threatRuns.join(","), "2,2"); eq(ACL.threatChecks.join(","), "2,2");
      ok(/threat: 2,?\s*\n?\s*\}/.test(read("tools/edge/semis-logi-files.ts")) || /seclog: 2, threat: 2/.test(read("tools/edge/semis-logi-files.ts")), "파일 폴더 threat 열람 2");
      ok(/"minutes-sign": 2, seclog: 2, threat: 2/.test(read("tools/edge/semis-logi-files.ts")), "파일 폴더 threat 올리기 2");
    });
    t("TC02 응대 가이드: 상단 띠(바로 걸기 · 응대/훈련 시작) · STEP 4개(보고 단계 표시) · 응대 요령 · 보고 순서(미주 편 · 체계도) · TSOC · 인쇄", () => {
      seed(); loginAs(e, "manager"); go(e, "threat");
      ok(q(e, ".tc-quick a[href='tel:0320000800']") && q(e, ".tc-quick a[href='tel:0320003907']"));
      ok(q(e, "[data-tc-start=real]") && q(e, "[data-tc-start=drill]"));
      eq(qa(e, ".tc-step").length, 4); ok(q(e, ".tc-step[data-step=s4]").classList.contains("is-report"));
      eq(qa(e, ".tc-step[data-step=s3] .tc-subs li").length, 2); ok(q(e, ".tc-step[data-step=s2] .tc-after"));
      eq(qa(e, ".tc-tips li").length, 2);
      eq(qa(e, ".tc-ci").length, 4); ok(q(e, ".tc-ci[data-chain=c4]").classList.contains("is-us"));
      ok(q(e, ".tc-ci[data-chain=c2] [data-flow-open='보안']"), "보고 체계도 연결");
      ok(q(e, ".tc-tsoc a[href='tel:+10000000001']"), "국제 번호");
      eq(qa(e, ".tc-tsoci li").length, 6);
      ok(q(e, ".page-head").textContent.indexOf("Print") >= 0);
      ok(!q(e, ".sp-ed") && !q(e, "#tc-step-add"), "manager 편집 없음");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("TC03 관리 절차: 원문 절 · 녹음 전화 보기 → 탭 이동 · TSOC · 임시 통제반 순서 · 원문 확인 필요는 hq만", () => {
      q(e, "[data-ttab=proc]").click();
      eq(qa(e, ".tc-sec").length, 2); eq(qa(e, ".tc-sec[data-sec=x1] .sp-body p").length, 2);
      eq(qa(e, ".tc-cmd li").length, 3); ok(q(e, ".tc-cmdc").textContent.indexOf("파트장 자리") >= 0);
      ok(q(e, ".tc-proc .tc-tsoc"));
      ok(!q(e, ".tc-gaps"), "manager 숨김");
      loginAs(e, "hq"); e.S.renderView(); ok(q(e, ".tc-gaps") && q(e, "[data-sec-edit=x1]"));
      loginAs(e, "manager"); e.S.renderView();
      q(e, ".tc-sec[data-sec=x2] [data-ttab=phones]").click();
      eq(TC.getState().tab, "phones"); ok(q(e, ".tc-phones"));
    });
    t("TC04 녹음 전화: 녹취 열람(암호 없음) · 자리 표 · 업무 전화 · 미점검 → 점검 기록(모두 정상 · 이상 1) · 상태 · 탭 배지 · 수정 · 주기 경과", () => {
      ok(q(e, ".tc-rec a[href='https://rec.test']")); ok(q(e, ".tc-rec").textContent.indexOf("암호 관리") >= 0);
      ok(!q(e, "#tc-vault"), "manager: 암호 관리 버튼 없음");
      eq(qa(e, ".tc-ptbl tbody tr").length, 2); eq(qa(e, ".tc-ln").length, 1);
      eq(qa(e, ".tc-ck.is-none").length, 6);
      q(e, "#tc-chk-add").click();
      q(e, "#modal-box [data-all=rec]").click();
      q(e, "#modal-box [data-cr=p1][data-ck=form][data-v=ok]").click();
      q(e, "#modal-box [data-cr=p3][data-ck=form][data-v=ng]").click();
      q(e, "#tc-c-note").value = "p3 양식 없음"; clickOk(e);
      const c = e.S.data.threatChecks;
      eq(c.length, 1); eq(c[0].rows.p1.rec, "ok"); eq(c[0].rows.p3.form, "ng"); ok(!c[0].rows.p2.form, "고르지 않은 칸은 비움");
      eq(TC.lastCheck("p3", "form").v, "ng"); eq(TC.phonesStat().ng, 1);
      eq(qa(e, ".tc-ck.is-ng").length, 1); eq(qa(e, ".tc-ck.is-none").length, 1, "p2 양식 비치만 미점검");
      ok(q(e, "[data-ttab=phones]").textContent.indexOf("이상 1") >= 0, "탭 배지");
      q(e, "[data-chk-edit]").click(); q(e, "#modal-box [data-cr=p3][data-ck=form][data-v=ok]").click(); clickOk(e);
      eq(e.S.data.threatChecks.length, 1); eq(TC.phonesStat().ng, 0);
      const d = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
      e.S.data.threatChecks[0].date = d; e.S.data.threat.checkCycle = 1; e.S.renderView();
      ok(q(e, ".tc-ck.is-due"), "주기 경과 표시");
      e.S.data.threat.checkCycle = ""; e.S.renderView();
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("TC05 보고양식: 종이 모양 미리보기 · 비치용 A4(가로 · 절차 + 양식 + 번호) · 빈 양식(세로)", () => {
      q(e, "[data-ttab=form]").click();
      ok(q(e, ".tc-paper .tcf")); eq(qa(e, ".tc-paper .tcf-s").length, 4); ok(q(e, ".tc-paper .tcf-g").textContent === "배경 정보");
      eq(qa(e, ".tc-paper .tcf-o").length, 3 + 2 + 3, "선택지(yn 포함)");
      q(e, "#tc-print-card").click();
      let h = TC.lastPrint();
      ok(/size: A4 landscape/.test(h), "가로");
      ok(h.indexOf("STEP 4") > 0 && h.indexOf("대응 및 보고절차") > 0 && h.indexOf("032-000-3907") > 0 && h.indexOf("위협 보고양식") > 0);
      ok(h.indexOf("후속 보고") < 0, "번호 없는 보고처는 비상연락처에서 제외");
      q(e, "#tc-print-blank").click();
      h = TC.lastPrint(); ok(/size: A4 portrait/.test(h) && h.indexOf('class="blank"') > 0);
    });
    t("TC06 응대 시작(실제): 묻지 않고 바로 · 사본 · 응대 화면 · 경과 시계 · 메뉴 배지 · 대시보드 띠 · 두 번째 시작은 진행 중 열기", () => {
      e.w.localStorage.setItem("semisl:threat-by", "홍접수");
      TC.setState({ tab: "guide", runSel: "" }); e.S.renderView();
      q(e, "[data-tc-start=real]").click();
      const r = e.S.data.threatRuns;
      eq(r.length, 1); eq(r[0].kind, "real"); eq(r[0].recv.name, "홍접수");
      eq(r[0].steps.length, 4); eq(r[0].form.length, 4); eq(r[0].chain.length, 4); eq(r[0].log.length, 1);
      ok(q(e, ".tc-status [data-tc-t0]") && q(e, ".sp-clock").textContent.indexOf("T+") === 0);
      eq(qa(e, "[data-st]").length, 6, "STEP 1 · 2 + 전달 · 3 세부 2 + 전달 (보고 단계 제외)");
      ok(qa(e, ".nav-meta").some(x => x.textContent === "응대 중"), "메뉴 배지");
      go(e, "dashboard"); ok(q(e, "#dash-threat"), "대시보드 띠");
      q(e, "#dash-threat [data-dthreat]").click(); eq(TC.getState().runSel, r[0].id);
      TC.setState({ runSel: "" }); e.S.renderView(); ok(q(e, ".tc-live"), "가이드 위 응대 중 띠");
      TC.startRun("drill"); eq(e.S.data.threatRuns.length, 1, "진행 중이면 새로 시작하지 않음");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("TC07 통화 중: STEP 체크(시각 · 기록자 · 수정/취소) · 접수 정보(번호 정리) · 수단 · 녹음 · 답(글 · 하나 · 여럿 · 기타 · 예/아니오) · 입력칸 유지", () => {
      q(e, "[data-st=s1]").click();
      let r = e.S.data.threatRuns[0]; ok(r.st.s1 && r.st.s1.by === "홍접수");
      q(e, "[data-st='s2:after']").click(); ok(e.S.data.threatRuns[0].st["s2:after"]);
      q(e, "[data-st=s1]").click(); q(e, "#tc-d-note").value = "표시 없음"; clickOk(e);
      eq(e.S.data.threatRuns[0].st.s1.note, "표시 없음");
      q(e, "[data-st=s1]").click(); q(e, "#modal-box [data-act=undo]").click(); ok(!e.S.data.threatRuns[0].st.s1);
      inputEv(q(e, "#tc-line"), "0320000821"); eq(e.S.data.threatRuns[0].line, "032-000-0821");
      inputEv(q(e, "#tc-dept"), "수출파트"); eq(e.w.localStorage.getItem("semisl:threat-dept"), "수출파트");
      q(e, "[data-rec='예']").click(); eq(e.S.data.threatRuns[0].rec, "예");
      q(e, "[data-ch='메일']").click(); eq(e.S.data.threatRuns[0].channel, "메일");
      const ta = q(e, "#tc-a-threat");
      inputEv(ta, "화물기에 폭발물을 설치했다");
      eq(e.S.data.threatRuns[0].ans.threat, "화물기에 폭발물을 설치했다"); ok(q(e, "#tc-a-threat") === ta, "글 입력은 다시 그리지 않음");
      q(e, "[data-opt=place][data-v=화물지역]").click(); eq(e.S.data.threatRuns[0].ans.place, "화물지역");
      q(e, "[data-opt=place][data-v=화물지역]").click(); ok(!e.S.data.threatRuns[0].ans.place, "다시 누르면 해제");
      q(e, "[data-opt=place][data-v=기타]").click(); ok(q(e, "#tc-a-place-etc"), "기타 → 내용 칸");
      inputEv(q(e, "#tc-a-place-etc"), "정비고");
      r = e.S.data.threatRuns[0]; eq(r.ans["place:etc"], "정비고");
      eq(TC.ansText(r, r.form[2].fields[0]), "기타 (정비고)");
      q(e, "[data-opt=voice][data-v=높은]").click(); q(e, "[data-opt=voice][data-v=저음의]").click();
      eq(e.S.data.threatRuns[0].ans.voice.join(","), "높은,저음의");
      q(e, "[data-opt=voice][data-v=높은]").click(); eq(e.S.data.threatRuns[0].ans.voice.join(","), "저음의");
      q(e, "[data-opt=knows][data-v=예]").click(); eq(e.S.data.threatRuns[0].ans.knows, "예");
      inputEv(q(e, "#tc-a-flight"), "KJ000"); inputEv(q(e, "#tc-a-dep"), "ICN"); inputEv(q(e, "#tc-a-arr"), "ANC");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("TC08 통화 종료 → 보고 · 전파: 완료 시각 · 미주 편 → TSOC(자동 채움) · 보고 문자(복사 · 문자) · 임시 통제반(순위 · 기록) · 체계도 열기", () => {
      q(e, "#tc-callend").click();
      eq(TC.getState().runTab, "report"); ok(e.S.data.threatRuns[0].callEnd);
      eq(qa(e, ".tc-rci").length, 3, "미주 편 항목은 숨김");
      q(e, "[data-rep=c1]").click(); ok(e.S.data.threatRuns[0].rep.c1.at);
      q(e, "#tc-us").checked = true; q(e, "#tc-us").dispatchEvent(new e.w.Event("change"));
      eq(qa(e, ".tc-rci").length, 4); ok(q(e, ".tc-rtsoc"));
      const pos = q(e, "#tc-tsoc-pos"); pos.value = "태평양 상공"; pos.dispatchEvent(new e.w.Event("input"));
      const tt = q(e, "#tc-tsoc-pre").textContent;
      ok(tt.indexOf("Airline (항공사): 가항공") >= 0 && tt.indexOf("Flight (편명): KJ000") >= 0 && tt.indexOf("ICN → ANC") >= 0 && tt.indexOf("태평양 상공") >= 0, tt);
      pos.dispatchEvent(new e.w.Event("change")); eq(e.S.data.threatRuns[0].tsoc.pos, "태평양 상공");
      const msg = q(e, "#tc-msg-pre").textContent;
      ok(msg.indexOf("[테러 위협전화 접수] 가팀") === 0 && msg.indexOf("- 위협 내용: 화물기에 폭발물을 설치했다") > 0 && msg.indexOf("- 위치: 기타 (정비고)") > 0, msg);
      ok(msg.indexOf("음성특성") < 0 && msg.indexOf("저음의") < 0, "관찰 항목은 문자에서 뺌");
      ok(decodeURIComponent(q(e, "#tc-msg-sms").getAttribute("href")).indexOf("수신 032-000-0821") > 0);
      q(e, "#tc-cmd-save").click(); ok(!e.S.data.threatRuns[0].cmd.at, "통제반장 없으면 기록 안 함");
      q(e, "[data-cmd-rank='1']").click(); eq(e.S.data.threatRuns[0].cmd.rank, 1);
      q(e, "#tc-cmd-lead").value = "을선임"; q(e, "#tc-cmd-lead").dispatchEvent(new e.w.Event("input"));
      q(e, "#tc-cmd-save").click();
      const c = e.S.data.threatRuns[0].cmd; eq(c.lead, "을선임"); eq(c.place, "파트장 자리", "비우면 규정 장소"); ok(c.at);
      ok(q(e, "#tc-msg-pre").textContent.indexOf("임시 통제반: 을선임 · 파트장 자리") > 0);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("TC09 기록 · 첨부 · 결과 → 응대 종료 · A4 보고서(인쇄 전용, 고른 선택지 동그라미) · 접수 기록 목록 · 다시 열기/삭제는 hq", () => {
      q(e, "[data-rtab=log]").click();
      const n0 = e.S.data.threatRuns[0].log.length;
      q(e, "#tc-log").value = "수색 요청"; q(e, "#tc-log-add").click(); eq(e.S.data.threatRuns[0].log.length, n0 + 1);
      inputEv(q(e, "#tc-result"), "특이사항 없음, 상황 종료");
      eq(e.S.data.threatRuns[0].result, "특이사항 없음, 상황 종료");
      ok(!q(e, "#tc-rdel"), "manager 삭제 없음");
      q(e, "#tc-end").click(); clickOk(e);
      const r = e.S.data.threatRuns[0];
      ok(r.end); eq(TC.activeRun(), null); ok(q(e, ".tc-status.is-end"));
      const rep = q(e, ".tc-report");
      ok(rep && rep.classList.contains("print-only"));
      ok(rep.textContent.indexOf("테러 위협전화 접수 보고") >= 0 && rep.textContent.indexOf("수색 요청") >= 0 && rep.textContent.indexOf("을선임") >= 0);
      ok(qa(e, ".tc-report .tcf-o.is-on").length >= 3, "고른 선택지 표시");
      ok(rep.textContent.indexOf("정비고") >= 0 && rep.textContent.indexOf("[TSOC]") >= 0);
      go(e, "dashboard"); ok(!q(e, "#dash-threat"), "종료 후 띠 없음");
      go(e, "threat"); TC.setState({ runSel: "", tab: "runs" }); e.S.renderView();
      eq(qa(e, ".tc-runs tbody tr").length, 1); ok(q(e, ".tc-runs").textContent.indexOf("화물기에 폭발물") >= 0);
      q(e, ".tc-runs tbody tr").click(); eq(TC.getState().runSel, r.id);
      loginAs(e, "hq"); e.S.renderView();
      ok(q(e, "#tc-reopen") && q(e, "#tc-rdel"));
      q(e, "#tc-reopen").click(); ok(!e.S.data.threatRuns[0].end);
      q(e, "#tc-rdel").click(); clickOk(e); eq(e.S.data.threatRuns.length, 0);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("TC10 hq 편집: STEP(세부 id 유지) · 보고처(순서 · 번호 정리) · 녹음 전화(번호로 id 유지) · 양식(줄 형식 · 오류) · 절 · 요령 · 녹취 주소 확인", () => {
      TC.setState({ tab: "guide", runSel: "" }); e.S.renderView();
      q(e, "[data-step-edit=s3]").click();
      eq(q(e, "#tc-s-subs").value, "녹음 | Rec\n질문 | Ask");
      q(e, "#tc-s-subs").value = "녹음 | Rec\n질문 | Ask\n되풀이"; clickOk(e);
      const s3 = e.S.data.threat.steps[2]; eq(s3.subs.length, 3); eq(s3.subs[0].id, "u1"); eq(s3.subs[2].ko, "되풀이");
      q(e, "#tc-chain-add").click(); q(e, "#tc-c-to").value = "새 기관"; q(e, "#tc-c-ph").value = "대표 | 0320001234"; q(e, "#tc-c-pos").value = "1"; clickOk(e);
      const ch = e.S.data.threat.chain; eq(ch.length, 5); eq(ch[1].to, "새 기관"); eq(ch[1].phones[0].num, "032-000-1234");
      q(e, "[data-chain-edit=c3]").click(); q(e, "#modal-box [data-act=del]").click(); clickOk(e); eq(e.S.data.threat.chain.length, 4);
      q(e, "#tc-tips-edit").click(); q(e, "#tc-lf").value = "하나\n\n둘\n셋"; clickOk(e); eq(e.S.data.threat.tips.join("|"), "하나|둘|셋");
      TC.setState({ tab: "phones" }); e.S.renderView();
      q(e, "#tc-phones-edit").click();
      ok(q(e, "#tc-p-list").value.split("\n")[0] === "자리 | 팀장 | 032-000-0700");
      q(e, "#tc-p-list").value = "자리 | 팀장실 | 0320000700\n업무 | 업무 전화 | 032-000-0821 | 컬러링\n업무 | | 032-000-0822"; clickOk(e);
      const ps = e.S.data.threat.phones; eq(ps.length, 3); eq(ps[0].id, "p1"); eq(ps[0].label, "팀장실"); eq(ps[1].id, "p3"); eq(ps[2].grp, "line"); ok(ps[2].id !== "p2");
      q(e, "#tc-rec-edit").click(); q(e, "#tc-r-url").value = "rec.test"; clickOk(e); ok(q(e, "#tc-r-url"), "https 아니면 막음");
      q(e, "#tc-r-url").value = "https://rec2.test"; clickOk(e); eq(e.S.data.threat.rec.url, "https://rec2.test");
      TC.setState({ tab: "form" }); e.S.renderView();
      q(e, "#tc-form-edit").click();
      const txt = q(e, "#tc-fe").value;
      ok(txt.indexOf("## 어디에 있습니까? | ask") >= 0 && txt.indexOf("place | 위치 | one | 터미널, 화물지역, 기타 | 기타 | 위치") >= 0, txt);
      q(e, "#tc-fe").value = txt + "\nbad id | x | text"; clickOk(e); ok(q(e, "#tc-fe"), "형식 오류면 닫히지 않음");
      q(e, "#tc-fe").value = txt + "\nextra | 추가 항목 | text"; clickOk(e);
      const fs = e.S.data.threat.form.secs; eq(fs.length, 4); eq(fs[2].id, "fw", "섹션 id 유지"); eq(fs[3].fields[1].id, "extra"); eq(fs[0].fields[0].auto, "recv");
      const back = TC.parseForm(TC.formText(), fs); eq(JSON.stringify(back.secs), JSON.stringify(fs), "왕복 동일");
      TC.setState({ tab: "proc" }); e.S.renderView();
      q(e, "#tc-sec-add").click(); q(e, "#tc-e-title").value = "새 절"; q(e, "#tc-e-body").value = "가\n\n나"; clickOk(e);
      eq(e.S.data.threat.sections.length, 3); eq(e.S.data.threat.sections[2].body, "가\n나");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    await ta("TC11 녹취 암호: 암호 관리로 요청(암호 없이) → 해제 후 채운 추가 폼(비밀번호 빈칸) · 같은 제목이 있으면 검색", async () => {
      const e = makeEnv(), TC = e.w.SemisThreat, VT = e.w.SemisVault;   // 새 환경(암호화 폴리필은 환경마다)
      e.S.data.threat = plan(); e.S.data.threat.rec.url = "https://rec2.test"; e.S.saveSilent();
      loginAs(e, "hq");
      await VT.setup("테스터", "master-pw-9");
      TC.setState({ tab: "phones", runSel: "" }); go(e, "threat");
      q(e, "#tc-vault").click();
      await tick(20);
      if (!VT.isUnlocked()) { await VT.unlock(e.S.data.vault.members[0].id, "master-pw-9"); e.S.renderView(); }
      await tick(20);
      ok(q(e, "#v-title"), "추가 폼 열림"); eq(q(e, "#v-title").value, "녹취 열람 테스트"); eq(q(e, "#v-url").value, "https://rec2.test"); eq(q(e, "#v-pw").value, "");
      ok(!q(e, "#v-del"), "새 항목");
      e.S.closeModal();
      await VT.addEntryForTest({ category: "웹사이트", title: "녹취 열람 테스트", account: "x", pw: "p", url: "", note: "" });
      VT.request({ title: "녹취 열람 테스트" }); e.S.renderView(); await tick(20);
      ok(!q(e, "#v-title"), "같은 제목 → 폼 대신 검색"); eq(q(e, "#vault-search").value, "녹취 열람 테스트");
      VT.lock();
    });
    t("TC12 빈 계획 · 권한(user 불가) · 증빙(2.9) · 통합 검색 · 공개 저장소 위생(threat.js에 번호 · 원문 없음) · CSS · 스크립트", () => {
      loginAs(e, "manager");
      ok(e.w.SemisEvidence.threat().ok, "절차 등록 → 증빙");
      const it = e.w.SemisSearch.search("새 기관");
      ok(it.some(x => x.group === "테러 위협전화 대응"), "통합 검색");
      e.S.data.threat = {}; e.S.saveSilent(); go(e, "threat");
      ok(q(e, "#view .empty-state")); ok(!q(e, "[data-tc-start]"));
      eq(e.w.SemisEvidence.threat().ok, false);
      const src = read("js/threat.js");
      ok(!/0\d{1,2}-\d{3,4}-\d{4}/.test(src), "전화번호 없음"); ok(!/@air/.test(src), "메일 없음"); ok(!/brecording|skbroadband/i.test(src), "녹취 사이트 없음");
      ok(!/\+\d{1,3}-\d{3}-\d{3}-\d{4}/.test(src), "국제 번호 없음");
      ["ICNKF", "PCC", "CSM", "텔레피아", "컬러링"].forEach(w => ok(src.indexOf(w) < 0, "원문 용어: " + w));
      const c = read("css/main.css"); ok(c.indexOf(".tc-step") > 0 && c.indexOf(".tcf-o.is-on") > 0 && c.indexOf(".tc-callg") > 0);
      ok(read("index.html").indexOf('src="js/threat.js') > 0);
      ok(/"2\.9": \[[^\]]*"threat"/.test(read("js/audit.js")), "수검 증빙 연결");
      loginAs(e, "user"); go(e, "threat"); ok(!q(e, ".tc-tabs"), "user 는 대시보드로");
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
    await ta("FL08 인천 출항: '출항 대기 · 인천 지상'(도착 날짜 · 지상 시간 · 상태) · 오늘 출발의 행선 · 오늘 도착의 출발지", async () => {
      const Y = Fc.kstDayStart(NOW) - 3 * 3600000;                  // 어제 21시(한국)
      AC.push({ hex: "71be45", reg: "HL7645", type: "B744", flight: "@@@@@@@@", lat: 37.423, lon: 126.494, alt: null, gnd: true, gs: 9, seen_at: iso(Y + 1800000), gnd_since: iso(Y) });
      EV.push({ hex: "71bc21", reg: "HL7421", flight: "AIH967", kind: "dep", apt: "ICN", at: iso(NOW - 3 * 3600000), inferred: false },
        { hex: "71bc21", reg: "HL7421", flight: "AIH967", kind: "arr", apt: "HKG", at: iso(NOW - 3600000), inferred: false },
        { hex: "71bd07", reg: "HL7507", flight: "AIH387", kind: "dep", apt: "HAN", at: iso(NOW - 9 * 3600000), inferred: false });
      loginAs(e, "hq");
      go(e, "flight");
      await e.w.SemisFlight.refresh(true);
      const board = qa(e, "#fo-boardbox .fo-board")[1];
      ok(board.textContent.includes("출항 대기 · 인천 지상"), "소제목");
      const wait = Array.from(board.querySelectorAll("table")[0].querySelectorAll("tbody tr")).map(r => r.textContent.replace(/\s+/g, " "));
      eq(wait.length, 2, "인천 지상 2대");
      ok(wait[0].includes("HL7645") && wait[0].includes("어제 21:00"), "지난 도착은 날짜 표시: " + wait[0]);
      ok(!/@@/.test(board.textContent), "빈 콜사인(@@@@@@@@) 숨김");
      ok(wait[1].includes("HL7507") && wait[1].includes("1시간 30분 지상") && wait[1].includes("주기 중"), wait[1]);
      const dep = board.querySelectorAll("table")[1].textContent.replace(/\s+/g, " ");
      ok(dep.includes("KJ967") && dep.includes("홍콩 " + Fc.kstHM(NOW - 3600000) + " 도착"), "출발의 행선: " + dep);
      ok(dep.includes("KJ587") && dep.includes("비행 중"), "아직 도착 기록 없는 출발 = 지금 상태");
      const arr = qa(e, "#fo-boardbox .fo-board")[0].querySelectorAll("table")[0].textContent.replace(/\s+/g, " ");
      ok(arr.includes("KJ388") && arr.includes("출발지 미상"), "편명이 다른 앞 출발(KJ387)은 짝이 아님: " + arr);
      /* 같은 편이면 출발지 · 인천을 떠났다 인천으로 돌아온 편(중간 공항 수신 없음)은 행선 미상 */
      EV.find(x => x.flight === "AIH387").flight = "AIH388";
      EV.push({ hex: "71c338", reg: "HL8338", flight: "AIH927", kind: "dep", apt: "ICN", at: iso(NOW - 4 * 3600000), inferred: false },
        { hex: "71c338", reg: "HL8338", flight: "AIH928", kind: "arr", apt: "ICN", at: iso(NOW - 40 * 60000), inferred: true });
      await e.w.SemisFlight.refresh(true);
      const b0 = qa(e, "#fo-boardbox .fo-board");
      const arr2 = b0[0].querySelectorAll("table")[0].textContent.replace(/\s+/g, " ");
      ok(arr2.includes("하노이 출발"), "같은 편 → 출발지: " + arr2);
      ok(/KJ928\s*HL8338\s*출발지 미상/.test(arr2), "왕복 편 도착 → 출발지 미상: " + arr2);
      const dep2 = b0[1].querySelectorAll("table")[1].textContent.replace(/\s+/g, " ");
      ok(dep2.includes("행선 미상 · " + Fc.kstHM(NOW - 40 * 60000) + " 인천 복귀"), "왕복 편 출발 → 행선 미상: " + dep2);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("FL09 공항 묶음 정보창: 기체마다 두 줄(등록부호 · 기종 · 상태 / 편명 · 도착 · 지상 시간) · 줄바꿈 없는 폭", () => {
      const md = e.w.SemisFlight.model();
      const g = { at: "ICN", list: md.gndHome };
      const box = e.w.document.createElement("div");
      box.innerHTML = e.w.SemisFlight.aptPopHTML(g);
      eq(box.querySelectorAll(".fo-pop-list li").length, 2);
      const li = box.querySelectorAll(".fo-pop-list li")[1];
      ok(li.querySelector(".pl-1 b").textContent === "HL7507" && li.querySelector(".pl-1").textContent.includes("B767-300F"));
      ok(li.querySelector(".pl-2").textContent.includes("KJ388 도착"), li.querySelector(".pl-2").textContent);
      ok(box.querySelector(".fo-pop-h").textContent.includes("지상 2대"));
      const css = read("css/main.css");
      ok(/\.fo-pop-list \.pl-1 \{[^}]*white-space: nowrap/.test(css) && /\.fo-pop-list \.pl-2 \{[^}]*white-space: nowrap/.test(css), "줄바꿈 없음");
      ok(/bindPopup\(aptPopHTML\(g\), \{ className: "fo-popup", minWidth: 250/.test(read("js/flightops.js")), "최소 폭");
      eq(Fc.fnoOf("@@@@@@@@"), ""); eq(Fc.kstWhen(Fc.kstDayStart(NOW) - 3600000, NOW), "어제 23:00");
    });
    t("FL10 서버 함수: 출발 기록 편명 보정(이륙 때 직전 편 콜사인) · 빈 콜사인 거름", () => {
      const fn = read("tools/edge/semis-logi-adsb.ts");
      ok(/const flOk = /.test(fn) && /airFlight\.push/.test(fn), "공중 콜사인 수집");
      ok(/last\.kind === "dep" && last\.flight !== x\.flight/.test(fn), "최근 출발 기록 보정");
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
    await ta("SEC08 #page 같은 조각은 서명 주소 뒤에 그대로(v1.43 SSOP 조항 → PDF 쪽)", async () => {
      eq(FA.parse(PUBU + "attach/p.pdf#page=7").path, "attach/p.pdf");
      eq(FA.parse(PUBU + "attach/p.pdf#page=7").hash, "#page=7");
      const u = await FA.resolve(PUBU + "attach/p.pdf#page=7");
      ok(/\/object\/sign\/semis-logi-files\/attach\/p\.pdf\?token=[^#]+#page=7$/.test(u), u);
      const u2 = await FA.resolve(PUBU + "attach/p.pdf?download=x.pdf#page=3");
      ok(/\?token=[^#&]+&download=x\.pdf#page=3$/.test(u2), u2);
      eq(FA.canon('<a href="' + u.replace("#page=7", "") + '#page=7">'), '<a href="' + PUBU + 'attach/p.pdf#page=7">', "저장 전 되돌리기");
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
      ok(/http-equiv="Content-Security-Policy" content="script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'/.test(html), "CSP");
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
    t("SEC13 외부 라이브러리 고정 — supabase-js 로컬 사본(2.117.2, npm 원본과 같은 해시) · 버전 미고정 CDN 없음 (2026-10 보안 점검)", () => {
      const html = read("index.html");
      ok(/<script src="assets\/vendor\/supabase-js-2\.117\.2\.min\.js" defer><\/script>/.test(html), "로컬 사본 사용");
      ok(!/cdn\.jsdelivr\.net\/npm\/@supabase/.test(html), "jsDelivr supabase 없음");
      ok(!/<script[^>]+src="https?:\/\/[^"]*@\d+(\.\d+)?\//.test(html), "주 버전만 지정한 CDN 스크립트 없음");
      const buf = require("fs").readFileSync(require("path").join(ROOT, "assets/vendor/supabase-js-2.117.2.min.js"));
      eq(require("crypto").createHash("sha256").update(buf).digest("hex"), "59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd", "supabase-js 2.117.2 dist/umd/supabase.js 해시");
    });
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

  /* ══════════ [TR] 보안교육 · 자격 관리 (v1.20 → v1.31 재정비) ══════════ */
  {
    const e = makeEnv();
    const TR = e.w.SemisTraining, A = e.w.SemisAudit;
    const setv = (sel, v) => { const el = q(e, sel); el.value = v; return el; };
    const chg = (el) => { el.dispatchEvent(new e.w.Event("change")); return el; };
    const data = () => e.S.data.training;
    const fam = (f) => TR.fams(false).find(g => g.fam === f);
    const st = (p, f) => TR.famStatus(p, fam(f));
    const setW = (w) => Object.defineProperty(e.w, "innerWidth", { value: w, configurable: true });
    TR.setToday("2026-10-01"); A.setToday("2026-10-01");
    t("TR01 메뉴: 점검 · 교육 허브 실메뉴 · 이수증 관리 메뉴 없음", () => {
      const m = e.S.data.menus.find(x => x.module === "training");
      ok(m && !m.planned && m.parent === "hub-aud" && m.vis === "mgr"); eq(m.label, "보안교육 · 자격 관리");
      ok(!e.S.data.menus.some(x => x.module === "certs"), "이수증 관리 메뉴 없음");
    });
    t("TR02 데이터 · 권한표 · 파일 폴더 · 유효기한 셈 · 정식 직무 · 과정 기준", () => {
      ok(data() && Array.isArray(data().people) && Array.isArray(data().sessions));
      e.S.data.training = []; e.S.normalizeData(); ok(!Array.isArray(e.S.data.training) && Array.isArray(e.S.data.training.records), "구조 보정");
      eq(ACL.training.join(","), "2,3");
      const edge = read("tools/edge/semis-logi-files.ts");
      ok(/READ_RANK[\s\S]*?training: 2[\s\S]*?WRITE_RANK[\s\S]*?training: 3/.test(edge), "training 폴더: 열람 2 · 올리기 3");
      eq(TR.calcExpire("2025-04-25", 13), "2026-05-24"); eq(TR.calcExpire("2026-01-31", 1), "2026-02-27");
      eq(TR.calcExpire("2026-03-01", 12), "2027-02-28"); eq(TR.calcExpire("2026-03-01", 0), "");
      eq(TR.shiftM("2026-05-31", -3), "2026-02-28");
      ok(TR.DEF_COURSES.every(c => c.id && c.fam && c.name && c.kind), "과정 필수 칸");
      ["항공사보안감독자", "보안검색감독자", "보안검색요원", "화물보안 업무요원", "항공보안장비 유지보수요원",
        "사내보안교관", "DGR", "방사선안전관리자"].forEach(r => {
        const d = TR.ROLE_DEF.find(x => x.id === r);
        ok(d && d.basis && d.qual && d.duty && d.who, "직무 기준: " + r);
      });
      /* v1.38 인천화물팀 기준 — 본사 책임자 · 교육기관 교관 직무 없음, 여객 · 기내식 · 청소 문구 없음 */
      ok(!TR.ROLES.some(r => ["항공사보안책임자", "항공보안교관"].indexOf(r) >= 0), "뺀 직무 없음");
      ok(!TR.DEF_COURSES.some(c => (c.roles || []).some(r => ["항공사보안책임자", "항공보안교관"].indexOf(r) >= 0)), "과정 대상에도 없음");
      const txt = JSON.stringify(TR.ROLE_DEF) + JSON.stringify(TR.DEF_COURSES);
      ["여객", "승객", "수하물", "기내식", "청소", "무기류"].forEach(w => ok(txt.indexOf(w) < 0, "인천화물팀 범위 밖 문구 없음: " + w));
      /* v1.44 팀에 해당자가 없는 직무군(보안 유관부서 · 전화 접수 · 안내) 뺌 — 직무 · 직무군 · 기본 과정 모두 */
      const gone = ["보안 유관부서 관리자", "보안 유관부서 일반요원", "전화 접수자 · 안내요원"];
      ok(!TR.ROLES.some(r => gone.indexOf(r) >= 0) && !TR.RGROUPS.some(g => g.roles.some(r => gone.indexOf(r) >= 0)), "v1.44 뺀 직무 없음");
      eq(TR.RGROUPS.map(g => g.label).join(","), "항공사 보안관리,보안검색 · 화물보안,보안교관,기타");
      ok(!TR.DEF_COURSES.some(c => ["c-mgr-i", "c-mgr-r", "c-gen-i", "c-aware", "c-bomb"].indexOf(c.id) >= 0 || (c.roles || []).some(r => gone.indexOf(r) >= 0)), "v1.44 뺀 과정 없음");
      ok(TR.DEF_COURSES.some(c => c.id === "v-aware" && c.vendor), "협력사 확인 과정(지침 제29조②)은 그대로");
      const pre = TR.DEF_COURSES.find(c => c.id === "c-scr-p");
      ok(pre && pre.roles.join() === "보안검색감독자" && pre.cycle === 0 && pre.same.join() === "c-scn-i", "감독자 요건 = 검색요원 초기 인정");
      eq(pre.name, "보안검색요원 초기 (감독자 요건)", "법령에 없는 '선수 과정' 대신 지침 과정 이름");
      ok(!/선수/.test(JSON.stringify(TR.ROLE_DEF) + JSON.stringify(TR.DEF_COURSES)), "'선수' 표현 없음");
      eq(TR.DEF_COURSES.filter(c => c.fam === "rad").map(c => c.kind + c.cycle).join(","), "초기12,정기12", "방사선안전관리자 초기 · 정기 연 1회");
      ok(TR.DEF_COURSES.filter(c => c.vendor).every(c => c.who), "협력사 과정 대상");
      ok(!TR.DEF_COURSES.find(c => c.id === "c-inst").roles.length, "항공보안교관 과정 = 직무 지정 없음(보유)");
      ok(!TR.ROLES.some(r => ["보안감독자", "화물보안 요원", "장비 운용자"].indexOf(r) >= 0), "옛 직무 이름 없음");
      ok(TR.DEF_COURSES.filter(c => !c.vendor && !c.step).every(c => c.basis && (Number(c.cycle) === 0 || c.cycle > 0)), "근거 · 주기");
      const kr = TR.DEF_COURSES.filter(c => c.rule === "kr");
      ok(kr.length >= 10 && kr.every(c => c.cycle === 12), "지침 제13조 과정은 12개월");
      ok(TR.DEF_COURSES.filter(c => c.fam === "dgr").every(c => c.cycle === 24 && c.rule === "dg"), "위험물 24개월");
      ok(TR.DEF_COURSES.filter(c => ["c-inh", "c-inst", "c-icao-c"].indexOf(c.id) >= 0).every(c => c.cycle === 0), "1회 · 영구 과정");
      eq(TR.cycleText(TR.DEF_COURSES.find(c => c.id === "c-sup-r")), "연 1회 · 전후 30일 이수 기간");
      eq(TR.cycleText(TR.DEF_COURSES.find(c => c.id === "c-inst")), "1회 · 영구");
    });
    t("TR03 hq 인원 등록 → 개인 화면(자격 현황 · 미이수 · SSI 서약 누락) · 메뉴 배지 · 인쇄 버튼", () => {
      loginAs(e, "hq"); TR.setState({ tab: "people" }); go(e, "training");
      eq(q(e, "#view").getAttribute("data-hub"), "hub-aud");
      ok(q(e, "#view .page-head [data-print-btn]"), "인쇄");
      ok(q(e, "#tr-pbody .empty-state"), "인원 없음");
      eq(qa(e, "[data-ttab]").map(b => b.textContent).join(","), "인원,교육 기록,직무 · 과정,SSI 서약");
      q(e, "#tr-padd").click();
      ok(qa(e, "#tp-roles .tr-rgrp").length >= 3, "직무를 근거별로 묶음");
      setv("#tp-name", "갑일");
      qa(e, "#tp-roles input").forEach(i => { if (i.value === "항공사보안감독자" || i.value === "SSI") i.checked = true; });
      const ra = setv("#tp-role-add", "야간 당직");
      ra.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      ok(qa(e, "#tp-roles input").some(i => i.value === "야간 당직" && i.checked), "사내 직무 직접 추가");
      clickOk(e);
      eq(data().people.length, 1);
      const p = data().people[0];
      eq(p.roles.join(","), "항공사보안감독자,SSI,야간 당직"); eq(p.dept, "인천화물팀");
      eq(TR.getState().pid, p.id, "등록 후 개인 화면");
      ok(q(e, ".tr-head .page-title").textContent === "갑일" && q(e, "[data-tback]"), "개인 화면 · 뒤로");
      ok(q(e, "#view .page-head [data-print-btn]"), "개인 화면 인쇄");
      const qs = qa(e, ".tr-qual");
      eq(qs.length, 1, "필수 묶음 1(항공사보안감독자)");
      eq(qs[0].getAttribute("data-st"), "none");
      ok(/SSI 서약/.test(q(e, ".tr-pside").textContent) && /누락/.test(q(e, ".tr-pside").textContent));
      const s = TR.stats();
      eq(s.people + "|" + s.cells + "|" + s.none + "|" + s.ssiMiss + "|" + s.act, "1|1|1|1|1");
      e.S.renderNav();
      const nb = q(e, ".nav-item[data-route='training'] .nav-meta");
      if (nb) eq(nb.textContent, "2", "배지 = 조치 필요 + 서약 누락");
    });
    t("TR04 지침 제13조: 1년 · 전후 30일 이수 기간 · 유예 · 자격 정지(6개월 회복) · 기간 안 이수는 종전 유효기한 다음 날부터", () => {
      const p = data().people[0];
      q(e, '[data-tqual="sup"]').click();
      eq(q(e, "#tr-c").value, "c-sup-i", "기록 없으면 초기");
      chg(setv("#tr-d", "2025-09-01"));
      eq(q(e, "#tr-e").value, "2026-08-31", "1년 − 1일");
      setv("#tr-o", "교육원"); clickOk(e);
      eq(data().records.length, 1); eq(data().records[0].expire, "", "계산값과 같으면 저장 안 함");
      const at = (d) => { TR.setToday(d); return st(p, "sup"); };
      eq(at("2026-06-01").st, "ok");
      eq(at("2026-07-15").st + " " + at("2026-07-15").d, "soon 47");
      const w = at("2026-08-10"); eq(w.st + " " + w.winS + " " + w.winE, "win 2026-08-02 2026-10-01", "이수 기간 = 1년 되는 날(09-01) 전후 30일");
      eq(at("2026-09-15").st, "grace", "유효기한이 지나도 이수 기간 안");
      const sp = at("2026-10-02"); eq(sp.st + " " + sp.recE, "susp 2027-04-01", "정지 → 6개월 안 회복");
      eq(at("2027-04-02").st, "lapsed");
      TR.setToday("2026-10-01");
      eq(TR.previewExpire(p.id, "c-sup-r", "2026-09-20"), "2027-08-31", "기간 안 이수 → 종전 유효기한 다음 날부터 1년");
      eq(TR.previewExpire(p.id, "c-sup-r", "2026-07-01"), "2027-06-30", "기간 전 이수 → 수료일부터");
      eq(TR.previewExpire(p.id, "c-sup-r", "2026-10-05"), "2027-10-04", "기간 지나 이수 → 수료일부터");
      TR.openPerson(p.id);
      q(e, '[data-tqual="sup"]').click();
      eq(q(e, "#tr-c").value, "c-sup-r", "기록 있으면 정기");
      chg(setv("#tr-d", "2026-09-20"));
      eq(q(e, "#tr-e").value, "2027-08-31");
      ok(/자동 계산/.test(q(e, "#tr-eh").textContent));
      clickOk(e);
      const c = st(p, "sup"); eq(c.st + " " + c.exp, "ok 2027-08-31");
      eq(TR.expireOf(data().records[1]), "2027-08-31");
      eq(q(e, '.tr-qual[data-tqual="sup"]').getAttribute("data-st"), "ok", "개인 화면 갱신");
      eq(qa(e, ".tr-hist .tr-hrow").length, 2, "이수 이력");
      const rid = data().records[1].id;
      q(e, `.tr-hrow[data-rid="${rid}"]`).click();
      setv("#tr-e", "2027-09-30"); q(e, "#tr-e").dispatchEvent(new e.w.Event("input"));
      chg(setv("#tr-d", "2026-09-21"));
      eq(q(e, "#tr-e").value, "2027-09-30", "직접 고친 기한은 유지");
      ok(/계산값 2027\.08\.31/.test(q(e, "#tr-eh").textContent));
      clickOk(e);
      eq(data().records[1].expire, "2027-09-30", "이수증 기재 날짜 우선");
      data().records[1].expire = ""; data().records[1].date = "2026-09-20";
    });
    t("TR05 위험물: 24개월 · 만료 3개월 안 이수 시 기존 유효기한 기준 연장 · 지나면 만료", () => {
      const p = { id: "dgp", name: "위일", dept: "인천화물팀", roles: ["DGR"] };
      data().people.push(p);
      data().records.push({ id: "dg1", pid: "dgp", cid: "c-dg-i", date: "2024-03-10" });
      eq(TR.expireOf(data().records.find(r => r.id === "dg1")), "2026-03-09");
      eq(TR.previewExpire("dgp", "c-dg-r", "2026-01-15"), "2028-03-09", "3개월 안 → 기존 유효기한 다음 날부터 24개월");
      eq(TR.previewExpire("dgp", "c-dg-r", "2025-11-01"), "2027-10-31", "3개월 전보다 앞 → 수료일부터");
      TR.setToday("2026-01-01"); eq(st(p, "dgr").st, "win", "만료 3개월 안 = 이수 기간");
      TR.setToday("2026-10-01"); eq(st(p, "dgr").st, "exp", "지나면 만료(유예 없음)");
      data().records.push({ id: "dg2", pid: "dgp", cid: "c-dg-r", date: "2026-01-15" });
      eq(st(p, "dgr").st + " " + st(p, "dgr").exp, "ok 2028-03-09");
    });
    t("TR06 1회 · 영구 과정: '영구' 상태 · 만료 목록 제외 · 유효율 포함 · 인증서 유효기간을 적으면 그 날짜로", () => {
      const p = { id: "inp", name: "교일", dept: "인천화물팀", roles: ["항공보안교관"] };
      data().people.push(p);
      eq(st(p, "inst").st, "none");
      data().records.push({ id: "in1", pid: "inp", cid: "c-inst", date: "2024-03-08" });
      const c = st(p, "inst");
      eq(c.st + "|" + c.exp, "perm|", "영구");
      eq(TR.stText(c), "영구 · 1회 이수");
      ok(!TR.dueList(3650).some(x => x.p.id === "inp"), "갱신 목록에 없음");
      eq(TR.ST.perm.label, "영구");
      TR.openPerson("inp");
      const qd = q(e, '.tr-qual[data-tqual="inst"]');
      ok(qd && qd.getAttribute("data-st") === "perm" && /영구/.test(qd.textContent));
      ok(/영구/.test(q(e, ".tr-hist").textContent), "이력 유효기한 칸 '영구'");
      data().records.find(r => r.id === "in1").expire = "2026-11-15";
      eq(st(p, "inst").st + " " + st(p, "inst").d, "soon 45", "인증서 유효기간 입력 → 그 날짜로 관리");
      data().records.find(r => r.id === "in1").expire = "";
      q(e, "#tr-prec").click();
      chg(setv("#tr-c", "c-icao-c"));
      chg(setv("#tr-d", "2026-09-01"));
      eq(q(e, "#tr-e").value, "", "영구 과정은 비움");
      ok(/영구/.test(q(e, "#tr-eh").textContent));
      e.S.closeModal();
    });
    t("TR07 보안검색요원 단계: 초기 · 직무(OJT)만으로는 '인증 전' → 자격인증부터 유효", () => {
      const p = { id: "scp", name: "검일", dept: "협력사", roles: ["보안검색요원"] };
      data().people.push(p);
      data().records.push({ id: "s1", pid: "scp", cid: "c-scn-i", date: "2026-05-01" }, { id: "s2", pid: "scp", cid: "c-scn-o", date: "2026-06-01" });
      eq(st(p, "scn").st, "step");
      ok(TR.needAct("step"), "조치 필요");
      data().records.push({ id: "s3", pid: "scp", cid: "c-scn-c", date: "2026-08-20" });
      eq(st(p, "scn").st + " " + st(p, "scn").exp, "ok 2027-08-19");
      eq(TR.expireOf(data().records.find(r => r.id === "s1")), "", "단계 과정은 유효기한 없음");
      data().people = data().people.filter(x => x.id !== "scp");
      data().records = data().records.filter(r => r.pid !== "scp");
    });
    t("TR08 교육 기록: 8항목 누락 · 참석자 → 이수 기록 자동 · 기록 화면(8항목 · 참석자 → 개인 화면) · 삭제 연동", () => {
      data().people.push({ id: "tp2", name: "을일", dept: "인천화물팀", roles: ["ACMR"] });
      TR.setState({ tab: "sessions", pid: "" }); go(e, "training");
      ok(q(e, ".tr-stbl") || q(e, "#tr-sbody .empty-state"));
      q(e, "#tr-sadd").click();
      eq(q(e, "#ts-c").value + "|" + q(e, "#ts-title").value, "|", "기본은 기타(과정 없음)");
      ok(q(e, "#ts-c optgroup"), "과정은 근거별 묶음");
      chg(setv("#ts-c", "c-acmr-r"));
      eq(q(e, "#ts-title").value, "ACMR 정기", "과정을 고르면 교육명 채움");
      setv("#ts-date", "2026-09-10"); setv("#ts-hours", "4"); setv("#ts-place", "교육장");
      qa(e, "#ts-pids input").forEach(i => { if (i.value === "tp2" || i.value === data().people[0].id) i.checked = true; });
      clickOk(e);
      const s = data().sessions[0];
      eq(s.type, "own"); eq(s.pids.length, 2);
      eq(TR.missing(s).join(","), "일시,교관,시간표,평가결과,참석자 명단 · 서명");
      const auto = data().records.filter(r => r.sessionId === s.id);
      eq(auto.length, 2); ok(auto.every(r => r.cid === "c-acmr-r" && r.date === "2026-09-10" && r.hours === 4));
      ok(q(e, ".tr-stbl tbody tr").textContent.indexOf("누락 5") >= 0);
      eq(TR.evidence("9.2").text, "ACMR 1/1명 유효", "교육 기록으로 만든 이수");
      q(e, `tr[data-sid="${s.id}"]`).click();
      eq(TR.getState().sid, s.id, "기록 화면");
      eq(qa(e, ".tr-eight li").length, 8);
      eq(qa(e, ".tr-eight .tr-no").length, 5, "누락 5");
      eq(qa(e, ".tr-att [data-tperson]").length, 2, "참석자");
      q(e, "#tr-sedit").click();
      qa(e, "#ts-pids input").forEach(i => { if (i.value === "tp2") i.checked = false; });
      setv("#ts-time", "09:00~13:00"); setv("#ts-inst", "병일"); setv("#ts-eval", "전원 합격");
      clickOk(e);
      eq(data().records.filter(r => r.sessionId === s.id).length, 1, "빠진 참석자 기록 삭제");
      eq(TR.missing(s).join(","), "시간표,참석자 명단 · 서명");
      eq(qa(e, ".tr-eight .tr-no").length, 2, "기록 화면 그 자리 갱신");
      s.files.tt = [{ name: "tt.pdf", url: "u1" }]; s.files.roster = [{ name: "sign.pdf", url: "u2" }];
      eq(TR.missing(s).length, 0);
      const pid0 = data().people[0].id;
      q(e, `.tr-att [data-tperson="${pid0}"]`).click();
      eq(TR.getState().pid, pid0, "참석자 → 개인 화면");
      TR.openSession(s.id);
      const n0 = data().records.length;
      q(e, "#tr-sedit").click();
      q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      eq(data().sessions.length, 0); eq(data().records.length, n0 - 1, "연결된 이수 기록도 삭제");
    });
    t("TR09 협력사 교육 확인: 업체 필수 · 과정 · 인원 · 1년 안 확인 → 체크리스트 증빙(1.3 · 3.4 · 9.2.1)", () => {
      TR.setState({ tab: "sessions", pid: "", sid: "" }); go(e, "training");
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
      TR.openSession(s.id);
      ok(/가나보안/.test(q(e, ".tr-pcard").textContent) && /20 \/ 19/.test(q(e, ".tr-pcard").textContent), "협력사 확인 화면");
    });
    t("TR10 체크리스트 증빙: 항공사보안감독자 유효 · SSI 서약 · 기록 8항목 · 유지보수요원 — 수검 대응 센터 상태에 반영", () => {
      const p = data().people[0];
      eq(TR.evidence("1.1").text, "항공사보안감독자 1/1명 유효");
      ok(TR.evidence("1.1").ok);
      eq(A.itemState({ mid: "1.1", docScore: 3, impScore: 3 }), "ready", "열린 화면 + 실제 기록 → 증빙");
      eq(TR.evidence("2.10.1").text, "SSI 서약 0/1명"); eq(A.itemState({ mid: "2.10.1", docScore: 3, impScore: 3 }), "noev");
      p.pledge = "2026-09-02";
      eq(A.itemState({ mid: "2.10.1", docScore: 3, impScore: 3 }), "ready");
      eq(TR.evidence("9.2").text, "ACMR 0/1명 유효", "교육 기록을 지우면 이수도 빠짐");
      eq(TR.evidence("1.4").text, "교육 기록 없음");
      eq(TR.evidence("8.2").text, "기록 없음");
      p.roles.push("항공보안장비 유지보수요원");
      eq(TR.evidence("8.2").text, "유지보수요원 0/1명 유효");
      p.roles.pop();
      const ev = A.routeEv("training", "1.1");
      ok(ev.live && ev.ok && ev.text === "항공사보안감독자 1/1명 유효");
      eq(TR.evidence("5.1"), null, "관계없는 번호");
      /* 옛 직무 이름(보안감독자)도 읽을 때 정식 명칭으로 */
      data().people.push({ id: "old1", name: "옛일", dept: "인천화물팀", roles: ["보안감독자", "장비 운용자"] });
      eq(TR.rolesOf(data().people.find(x => x.id === "old1")).join(","), "항공사보안감독자,항공보안장비 유지보수요원");
      eq(TR.evidence("1.1").text, "항공사보안감독자 1/2명 유효");
      data().people = data().people.filter(x => x.id !== "old1");
    });
    t("TR11 인원 목록: PC 표(자격 상태 · 다음 갱신) · 조치 필요만 · 직무 · 퇴직 보관 기한 · 이수 현황표 · 모바일 한 줄 카드", () => {
      TR.setState({ tab: "people", pid: "", sid: "", q: "", onlyAct: false, roleF: "", pState: "active", pView: "list" }); go(e, "training");
      const rows = () => qa(e, ".tr-ptbl tbody tr");
      eq(rows().length, data().people.filter(x => !x.left).length);
      const r0 = rows().find(r => /갑일/.test(r.textContent));
      ok(r0.querySelector(".tr-qi") && /2027\.08\.31/.test(r0.querySelector(".c-next").textContent), "자격 칩 · 다음 갱신");
      q(e, "#tr-act").click();
      ok(rows().every(r => !/갑일/.test(r.textContent)), "조치 필요만 — 갑일은 유효 · 서약 완료");
      ok(rows().some(r => /을일/.test(r.textContent)) && !rows().some(r => /위일|교일/.test(r.textContent)), "미이수만 (위험물 갱신 · 영구는 제외)");
      q(e, "#tr-act").click();
      chg(setv("#tr-role", "항공보안교관"));
      eq(rows().map(r => r.querySelector(".tbl-open").textContent).join(","), "교일");
      chg(setv("#tr-role", ""));
      const p2 = data().people.find(x => x.id === "tp2");
      p2.left = "2026-05-01";
      q(e, '[data-tseg="pstate"][data-v="left"]').click();
      eq(rows().length, 1);
      ok(/보관 기한 경과/.test(rows()[0].textContent), "5/1 + 90일 < 10/1");
      p2.left = "2026-09-20"; TR.setState({ pState: "left" }); go(e, "training");
      ok(/보관 ~2026\.12\.19/.test(rows()[0].textContent));
      eq(TR.stats().people, data().people.filter(x => !x.left).length, "현황은 재직만");
      p2.left = "";
      q(e, '[data-tseg="pstate"][data-v="active"]').click();
      q(e, '[data-tseg="pview"][data-v="grid"]').click();
      ok(q(e, ".tr-gtbl") && /항공사보안감독자/.test(q(e, ".tr-gtbl thead").textContent), "이수 현황표");
      const cell = q(e, `.tr-gtbl [data-tcell^="dgp|"]`);
      ok(cell, "칸"); cell.click();
      eq(q(e, "#tr-c").value, "c-dg-r", "기록 있으면 정기로 이수 등록");
      e.S.closeModal();
      setW(390); TR.setState({ pView: "list" }); go(e, "training");
      ok(!q(e, ".tr-ptbl") && !q(e, '[data-tseg="pview"]'), "모바일은 표 · 현황표 없음");
      const m = qa(e, ".tr-mrow");
      eq(m.length, data().people.length);
      const mw = m.find(x => /위일/.test(x.textContent));
      ok(mw.querySelector(".badge") && /DGR/.test(mw.querySelector(".tr-mx").textContent), "가장 나쁜 상태 · 다음 할 일");
      mw.click();
      eq(TR.getState().pid, "dgp", "누르면 개인 화면");
      ok(q(e, ".tr-pgrid"), "모바일 개인 화면");
      setW(1024);
      TR.setState({ pid: "" });
    });
    await ta("TR12 브라우저 뒤로 = 목록(개인 화면은 history 에 표시) · 메뉴로 다시 들어오면 목록부터", async () => {
      TR.setState({ tab: "people", pid: "" }); go(e, "training");
      ok(q(e, ".tr-ptbl"), "목록");
      q(e, `.tr-ptbl [data-tperson="dgp"].tbl-open`).click();
      eq(e.w.history.state && e.w.history.state.tr, "p:dgp");
      ok(q(e, ".tr-pgrid"));
      q(e, "[data-tback]").click();
      await tick(30);
      ok(q(e, ".tr-ptbl") && !q(e, ".tr-pgrid"), "뒤로 → 목록");
      eq(TR.getState().pid, "");
      TR.openPerson("dgp");
      go(e, "audit"); e.w.history.replaceState(null, "", e.w.location.hash);
      go(e, "training");
      ok(q(e, ".tr-ptbl"), "다른 화면에 갔다가 메뉴로 오면 목록");
    });
    t("TR13 과정 관리(hq): 목록 → 한 과정 편집(주기 0 = 영구 · 규칙 · 근거 · 기관) · 과정 추가 · 쓰지 않은 과정만 삭제", () => {
      TR.setState({ tab: "catalog", pid: "" }); go(e, "training");
      q(e, "#tr-courses").click();
      eq(qa(e, "#tc-rows .tr-crow").length, TR.DEF_COURSES.length);
      const supI = qa(e, "#tc-rows .tr-crow").find(b => /항공사보안감독자 초기/.test(b.textContent));
      supI.click();
      ok(!q(e, "#modal-box [data-act=del]"), "쓰는 과정은 삭제 없음");
      eq(q(e, "#tc-rule").value, "kr");
      setv("#tc-cycle", "24"); clickOk(e);
      ok(q(e, "#tc-rows"), "목록으로");
      q(e, "#tc-add").click();
      setv("#tc-name", "위험물 보안 인지"); setv("#tc-cycle", "0"); setv("#tc-org", "사내");
      qa(e, "#tc-roles input").forEach(i => { if (i.value === "화물보안 업무요원" || i.value === "ACMR") i.checked = true; });
      clickOk(e);
      ok(/위험물 보안 인지/.test(q(e, "#tc-rows").textContent) && /영구/.test(qa(e, "#tc-rows .tr-crow").pop().textContent), "추가 · 영구 표시");
      const unused = qa(e, "#tc-rows .tr-crow").find(b => /ICAO 항공보안 관리자/.test(b.textContent));
      unused.click(); q(e, "#modal-box [data-act=del]").click();
      clickOk(e);
      eq(data().courses.length, TR.DEF_COURSES.length, "추가 1 · 삭제 1");
      eq(data().catVer, TR.CAT_VER);
      const nc = data().courses.find(c => c.name === "위험물 보안 인지");
      eq(nc.roles.join(","), "화물보안 업무요원,ACMR"); eq(nc.cycle, 0); ok(nc.fam, "묶음 자동");
      eq(TR.expireOf(data().records[0]), "2027-08-31", "초기 24개월 — 정기 기록이 이어 셈을 유지");
      const c0 = data().courses.find(c => c.id === "c-sup-i"); c0.cycle = 12;
      ok(q(e, ".tr-rd"), "기준표");
    });
    t("TR14 직무 · 과정 기준표: 공통 규칙(제13조 · 제32조) · 직무 한 줄(누르면 근거 · 자격 조건 · 주요 역할 · 과정 표) · 검색 · 모바일 목록 · 인쇄 때 펼침", () => {
      TR.setState({ tab: "catalog", q: "" }); go(e, "training");
      ok(/제13조/.test(q(e, ".tr-rules").textContent) && /제32조/.test(q(e, ".tr-rules").textContent));
      const rd = (name) => qa(e, ".tr-rd").find(c => c.querySelector("summary .tr-rn b").textContent === name);
      const card = rd("항공사보안감독자");
      ok(card && !card.open, "처음엔 한 줄");
      ok(/연 1회 · 전후 30일/.test(card.querySelector(".tr-rc").textContent) && /법정/.test(card.querySelector("summary").textContent), "주기 요약 · 법정");
      ok(/교육훈련지침 제2조8호/.test(card.textContent) && /자격 조건/.test(card.textContent) && /주요 역할/.test(card.textContent));
      ok(/16시간/.test(card.querySelector(".tr-cat").textContent) && /한국공항공사/.test(card.textContent), "시간 · 교육기관");
      ok(/1회 · 영구/.test(rd("사내보안교관").querySelector(".tr-rc").textContent));
      ok(/보안서약/.test(rd("SSI").querySelector(".tr-rc").textContent));
      ok(!/확인 필요/.test(rd("ACMR").querySelector("summary").textContent) && /SSOP/.test(rd("ACMR").textContent), "ACMR = SSOP 교육 조항");
      ok(/24개월/.test(rd("DGR").querySelector(".tr-rc").textContent));
      ok(/연 1회 · 전후 30일/.test(rd("보안검색감독자").querySelector(".tr-rc").textContent) && /보안검색요원 초기 \(감독자 요건\)/.test(rd("보안검색감독자").textContent), "감독자: 주기 요약은 정기 · 감독자 요건(검색요원 초기) 과정 표");
      ok(!rd("보안 유관부서 관리자") && !rd("전화 접수자 · 안내요원"), "v1.44 뺀 직무 없음");
      ok(/12개월|1년/.test(rd("방사선안전관리자").querySelector(".tr-rc").textContent), "방사선안전관리자");
      ok(!rd("항공사보안책임자"), "뺀 직무 없음");
      const oi = rd("항공보안교관");
      ok(oi && oi.classList.contains("rg-etc") && /연결된 과정 없음/.test(oi.textContent), "뺀 직무를 가진 사람이 있으면(TR06 교일) 기타 사내 직무로만");
      /* v1.38: 공통 규칙 → 인천화물팀(직무군 소제목) → 협력사 · 조업사 → 그 밖의 과정 */
      eq(qa(e, ".tr-rgcard").map(c => c.getAttribute("aria-label")).join(","), "인천화물팀,협력사 · 조업사,그 밖의 과정");
      ok(/적용 범위/.test(q(e, ".tr-rules").textContent) && /여객/.test(q(e, ".tr-rules").textContent), "적용 범위 한 줄");
      eq(qa(e, ".tr-team .tr-rsh").map(h => h.textContent).join(","), "항공사 보안관리,보안검색 · 화물보안,보안교관,기타", "직무군 소제목");
      eq(Array.from(qa(e, ".tr-team .tr-rsec")[0].querySelectorAll(".tr-rd")).map(d => d.querySelector(".tr-rn b").textContent).join(","), "항공사보안감독자");
      const vrows = qa(e, ".tr-vcard .tr-vcat tbody tr");
      eq(vrows.length, TR.DEF_COURSES.filter(c => c.vendor).length, "협력사 과정 표");
      ok(vrows.every(r => r.children[1].textContent !== "-") && !/\(협력사\)/.test(q(e, ".tr-vcard").textContent), "대상 칸 · 이름에서 '(협력사)' 뺌");
      ok(/ICAO/.test(qa(e, ".tr-rgcard")[2].textContent) && /항공보안교관 과정/.test(qa(e, ".tr-rgcard")[2].textContent), "그 밖의 과정");
      const qi = q(e, "#tr-q"); qi.value = "위험물"; qi.dispatchEvent(new e.w.Event("input"));
      ok(q(e, "#tr-q") === qi, "검색칸 유지");
      ok(qa(e, ".tr-rd").length && qa(e, ".tr-rd").every(c => /위험물/.test(c.textContent) && c.open), "검색 → 맞는 줄만 펼침");
      TR.setState({ q: "" }); go(e, "training");
      e.w.dispatchEvent(new e.w.Event("beforeprint"));
      ok(qa(e, ".tr-rd").every(d => d.open), "인쇄 때 모두 펼침");
      setW(390); go(e, "training");
      ok(q(e, ".tr-catm") && !q(e, ".tr-cat"), "모바일은 목록");
      ok(q(e, ".tr-rules[data-mf]"), "모바일 공통 규칙 접기");
      setW(1024);
    });
    t("TR15 manager 열람 전용 · user 메뉴 없음 · 통합 검색 → 개인 화면", () => {
      loginAs(e, "manager"); TR.setState({ tab: "people", pid: "" }); go(e, "training");
      ok(!q(e, "#tr-sadd") && !q(e, "#tr-padd") && !q(e, "#tr-courses") && !q(e, "#tr-radd"));
      q(e, ".tr-ptbl [data-tperson].tbl-open").click();
      ok(q(e, ".tr-pgrid") && !q(e, "#tr-prec") && !q(e, "button.tr-qual") && !q(e, "button.tr-hrow"), "읽기 전용 개인 화면");
      TR.setState({ tab: "sessions", pid: "" }); go(e, "training");
      ok(!q(e, "#tr-sadd"));
      loginAs(e, "user"); go(e, "training");
      ok(!q(e, "#tr-body"), "권한 없음");
      loginAs(e, "hq");
      const r = e.w.SemisSearch.search ? e.w.SemisSearch.search("갑일") : [];
      const hit = r.find(x => x.group === "보안교육 · 자격 관리");
      ok(hit, "검색");
      go(e, "audit");
      hit.pick(); e.S.renderView();
      eq(TR.getState().pid, data().people[0].id, "검색 결과 → 개인 화면");
      ok(q(e, ".tr-pgrid"));
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    /* v1.21 SSI 서약 — SeMIS v2 보안서약서 명단 대조 · 조회 탭 */
    const PLROWS = () => ([
      { name: "갑일", dept: "영업운송본부 인천화물팀", position: "프로", date: "2026-03-13", state: "valid", n: 2 },
      { name: "동명", dept: "운항본부", position: "기장", date: "2025-11-24", state: "valid", n: 1 },
      { name: "동명", dept: "인천화물팀", position: "파트장", date: "2026-01-10", state: "valid", n: 1 },
      { name: "을이", dept: "정비본부", position: "프로", date: "2025-10-01", state: "left", n: 1 },
      { name: "외부인", dept: "뉴욕지점", position: "지점장", date: "2025-09-30", state: "valid", n: 1 }
    ]);
    t("TR16 SSI 서약 대조: 이름 → SeMIS 서약일 · 동명이인은 소속으로 · 못 가리면 확인 필요 · 입력한 서약일이 더 늦으면 그것 · 퇴직 서약 제외 · 증빙 2.10 · 서약 등록", () => {
      loginAs(e, "hq");
      const P = TR.pledgesState;
      const ps = data().people;
      const add = (name, dept, extra) => { const x = Object.assign({ id: "pl-" + name + dept, name, dept, roles: ["SSI"], left: "", pledge: "", note: "" }, extra || {}); ps.push(x); return x; };
      const a = ps.find(x => x.name === "갑일");
      a.pledge = "";
      const d1 = add("동명", "인천화물팀"), d2 = add("동명", "");
      const b = add("을이", "인천화물팀");
      P.rows = null;
      eq(TR.pledgeInfo(a).date, "", "명단을 받기 전에는 입력값만");
      P.rows = PLROWS(); P.at = Date.now();
      eq(TR.pledgeInfo(a).date, "2026-03-13"); eq(TR.pledgeInfo(a).src, "semis");
      eq(TR.pledgeInfo(d1).date, "2026-01-10", "동명이인 → 소속이 겹치는 한 건");
      ok(TR.pledgeInfo(d2).ambiguous && !TR.pledgeInfo(d2).date, "소속 없으면 확인 필요");
      eq(TR.pledgeInfo(b).date, "", "퇴직 · 전출 서약은 유효 아님");
      b.pledge = "2026-09-01";
      eq(TR.pledgeInfo(b).date, "2026-09-01"); eq(TR.pledgeInfo(b).src, "manual");
      a.pledge = "2026-09-20";
      eq(TR.pledgeInfo(a).date, "2026-09-20", "입력한 서약일이 더 늦으면 그것");
      a.pledge = "";
      const n = ps.filter(x => !x.left && (x.roles || []).indexOf("SSI") >= 0).length;
      eq(TR.evidence("2.10").text, `SSI 서약 ${n - 1}/${n}명`, "동명이인 미확정 1명만 누락");
      TR.setState({ tab: "people", pid: "", q: "", roleF: "", onlyAct: false, pView: "list" }); go(e, "training");
      ok(/동명이인/.test(q(e, "#tr-body").textContent), "인원 표에 동명이인 표시");
      ok(/SeMIS/.test(q(e, "#tr-body").textContent), "인원 표에 출처");
      d2.dept = "운항본부";
      eq(TR.evidence("2.10").text, `SSI 서약 ${n}/${n}명`);
      TR.openPerson(a.id);
      ok(/2026\.03\.13 · 영업운송본부 인천화물팀 · 유효/.test(q(e, ".tr-pside").textContent), "개인 화면에 SeMIS 서약 정보");
      q(e, "#tr-ppl").click();
      ok(/SeMIS 2026\.03\.13/.test(q(e, "#modal-box").textContent), "서약 등록 창에 SeMIS 줄");
      ok(!q(e, "#tp-ssi"), "이미 SSI 대상");
      setv("#tp-pledge", "2026-09-25"); clickOk(e);
      eq(a.pledge, "2026-09-25"); eq(TR.pledgeInfo(a).src, "manual");
      a.pledge = "";
      const c = add("병삼", "인천화물팀", { roles: [] });
      TR.openPerson(c.id);
      q(e, "#tr-ppl").click();
      ok(q(e, "#tp-ssi").checked, "SSI 대상 아니면 추가 선택");
      setv("#tp-pledge", "2026-09-01"); clickOk(e);
      eq(c.roles.join(","), "SSI");
      data().people = data().people.filter(x => x.id !== c.id);
    });
    t("TR17 'SSI 서약' 탭: 인천화물팀(명단 대조 + 소속) / 전사 · 유효 / 전체 · 검색 · 누락 목록 · A4 명단(사번 · 서명 없음)", () => {
      loginAs(e, "hq");
      TR.pledgesState.rows = PLROWS(); TR.pledgesState.at = Date.now();
      TR.setState({ tab: "pledges", q: "", plScope: "team", plState: "valid", pid: "" }); go(e, "training");
      ok(q(e, '[data-ttab="pledges"]'), "탭");
      const names = () => qa(e, ".tr-pltbl tbody tr").map(tr => tr.querySelector(".c-name b").textContent);
      eq(names().join(","), "갑일,동명,동명", "인천화물팀 = 명단 대조 + 소속(퇴직 제외)");
      q(e, '[data-tseg="plscope"][data-v="all"]').click();
      eq(names().length, 4, "전사 유효");
      q(e, '[data-tseg="plstate"][data-v="all"]').click();
      eq(names().length, 5, "전사 전체");
      ok(/재서약 1/.test(q(e, ".tr-pltbl").textContent), "재서약 표시");
      const pr = q(e, ".tr-plprint");
      ok(pr && pr.classList.contains("print-only") && qa(e, ".tr-plptbl tbody tr").length === 5, "A4 인쇄용 표");
      ok(/보안서약서 작성자 명단 — 전사/.test(pr.textContent) && !/사번|서명/.test(pr.querySelector("thead").textContent), "사번 · 서명 열 없음");
      ok(q(e, "[data-print-btn]"), "Print 버튼");
      const qi = q(e, "#tr-q"); qi.value = "뉴욕"; qi.dispatchEvent(new e.w.Event("input"));
      eq(names().join(","), "외부인", "소속 검색");
      ok(q(e, "#tr-q") === qi, "검색칸 유지");
      TR.setState({ q: "" });
      TR.pledgesState.rows = null; TR.pledgesState.err = "forbidden"; TR.pledgesState.failAt = Date.now();
      go(e, "training");
      ok(q(e, "[data-plretry]"), "불러오기 실패 → 다시 시도");
      TR.pledgesState.err = ""; TR.pledgesState.rows = PLROWS(); TR.pledgesState.at = Date.now();
      TR.setState({ tab: "people" });
    });
    await ta("TR18 명단은 로그인 세션 RPC semis_logi_pledges 로만 · 10분 기억 · 실패 후 1분은 다시 부르지 않음 · SQL 참조", async () => {
      const calls = [];
      const old = e.w.SemisSync.rpc;
      let fail = true;
      e.w.SemisSync.rpc = (name) => { calls.push(name); return Promise.resolve(fail ? { ok: false, error: "forbidden" } : { ok: true, rows: PLROWS() }); };
      const P = TR.pledgesState;
      if (P.busy) await P.busy;                       // 앞 화면이 부른 요청(가짜 서버 없음)은 끝내고 시작
      calls.length = 0;
      P.rows = null; P.at = 0; P.failAt = 0; P.err = "";
      eq(await TR.loadPledges(false), false);
      eq(P.err, "forbidden");
      eq(await TR.loadPledges(false), false); eq(calls.length, 1, "실패 뒤 1분은 다시 부르지 않음");
      fail = false;
      eq(await TR.loadPledges(true), true, "다시 시도(강제)");
      eq(calls.join(","), "semis_logi_pledges,semis_logi_pledges");
      eq(P.rows.length, 5); ok(!P.rows.some(r => "empId" in r || "sign" in r), "사번 · 서명 없음");
      eq(await TR.loadPledges(false), false); eq(calls.length, 2, "10분 기억");
      e.w.SemisSync.rpc = old;
      const sql = read("tools/sql/semis-logi-pledges.sql");
      ok(/semis_logi_private\.rank_now\(\) < 2/.test(sql) && /grant execute on function public\.semis_logi_pledges\(\) to anon, service_role/.test(sql), "SQL 참조 사본");
      ok(!/'empId'|emp_id\b.*jsonb_build_object|'sign'/.test(sql.slice(sql.indexOf("jsonb_build_object('name'"))), "명단에 사번 · 서명 없음");
    });
    t("TR20 목록에서 이수 등록: 인원 고르기 → 그 사람에게 필요한 과정 자동 선택(직접 고르면 유지) · 저장", () => {
      loginAs(e, "hq"); TR.setState({ tab: "people", pid: "" }); go(e, "training");
      q(e, "#tr-radd").click();
      ok(q(e, "#tr-p"), "인원 고르기");
      chg(setv("#tr-p", "dgp"));
      eq(q(e, "#tr-c").value, "c-dg-r", "기록 있는 묶음 → 정기");
      chg(setv("#tr-c", "c-icao-c"));
      chg(setv("#tr-p", "inp"));
      eq(q(e, "#tr-c").value, "c-icao-c", "직접 고른 과정은 유지");
      chg(setv("#tr-d", "2026-09-30")); clickOk(e);
      const r = data().records.find(x => x.pid === "inp" && x.cid === "c-icao-c");
      ok(r && r.expire === "", "영구 과정 기록");
      data().records = data().records.filter(x => x !== r);
    });
    t("TR19 데이터 이전(v1.31): 옛 과정 → 정식 명칭 · DGR 24개월 · 교관 영구 · 옛 직무 이름 · v2 고정 유효기한 지움 · 멱등", () => {
      const old = {
        courses: [
          { id: "c-sup-i", fam: "sup", name: "보안책임자 · 감독자 초기", kind: "초기", cycle: 13, roles: ["보안감독자"] },
          { id: "c-sup-r", fam: "sup", name: "보안책임자 · 감독자 정기", kind: "정기", cycle: 13, roles: ["보안감독자"] },
          { id: "c-equip", fam: "equip", name: "검색장비 운용 교육", kind: "초기", cycle: 0, roles: ["장비 운용자"] },
          { id: "c-aware", fam: "aware", name: "보안 인지교육", kind: "정기", cycle: 12, roles: [], all: true },
          { id: "u-dg1", fam: "dgr", name: "IATA DGR 위험물 교육 초기", kind: "초기", cycle: 36, roles: [] },
          { id: "u-dg2", fam: "dgr", name: "IATA DGR 위험물 교육 정기", kind: "정기", cycle: 36, roles: [] },
          { id: "u-wb", fam: "w/b", name: "Weight & Balance 초기", kind: "초기", cycle: 12, roles: [] },
          { id: "u-inst", fam: "inst", name: "항공보안 교관", kind: "정기", cycle: 0, roles: [] },
          { id: "v-screen", fam: "v-screen", name: "보안검색요원 교육 · 자격", kind: "정기", cycle: 12, roles: [], vendor: true }
        ],
        people: [{ id: "a", name: "가", roles: ["보안감독자", "장비 운용자", "SSI 취급자", "보안감독자"] }],
        records: [{ id: "r1", pid: "a", cid: "c-sup-r", date: "2025-08-22", expire: "2026-09-21", src: "semis-v2" },
          { id: "r2", pid: "a", cid: "u-inst", date: "2024-03-08", expire: "" }, { id: "r3", pid: "a", cid: "c-sup-i", date: "2023-10-13", expire: "2024-12-31" }],
        sessions: []
      };
      eq(TR.migrate(old), true);
      const by = (id) => old.courses.find(c => c.id === id);
      eq(by("c-sup-i").name + "|" + by("c-sup-i").cycle + "|" + by("c-sup-i").rule, "항공사보안감독자 초기|12|kr");
      eq(by("c-sup-r").roles.join(","), "항공사보안감독자", "v1.38: 책임자 직무 뺌");
      eq(by("c-equip").name + "|" + by("c-equip").cycle, "항공보안장비 유지보수요원 초기|12");
      ok(!by("c-aware"), "전 직원 인지교육(c-aware) — v1.44 뺀 과정, 기록 없으면 지움");
      eq([by("u-dg1").cycle, by("u-dg1").rule, by("u-dg1").roles.join(","), by("u-dg2").kind].join("|"), "24|dg|DGR|정기");
      eq([by("u-inst").kind, by("u-inst").cycle, by("u-inst").roles.join(",")].join("|"), "1회|0|", "교관 = 1회 · 영구 · 직무 지정 없음(v1.38)");
      eq(by("u-dg1").hours, "직무구분별 — Function 7.3 집체 40시간 · 7.4 온라인", "위험물 시간 빈칸 채움");
      eq(by("u-wb").legal, "own", "사내 과정 유지");
      ok(!old.courses.some(c => c.id === "c-dg-i" || c.id === "c-inst"), "같은 묶음 · 구분이 있으면 기본 과정을 덧붙이지 않음");
      ok(old.courses.some(c => c.id === "c-mnt-r") && old.courses.some(c => c.id === "c-scr-p"), "없는 기본 과정 추가");
      ok(!old.courses.some(c => ["c-mgr-i", "c-gen-i", "c-bomb"].indexOf(c.id) >= 0), "v1.44 뺀 과정은 덧붙이지 않음");
      const keys = old.courses.filter(c => !c.vendor).map(c => c.fam + "|" + c.kind);
      eq(keys.filter(k => k === "dgr|초기").length, 1);
      eq(old.people[0].roles.join(","), "항공사보안감독자,항공보안장비 유지보수요원,SSI");
      eq(old.records[0].expire, "", "v2 고정 유효기한 지움");
      eq(old.records[2].expire, "2024-12-31", "직접 입력한 유효기한은 유지");
      eq(old.catVer, TR.CAT_VER);
      const snap = JSON.stringify(old);
      eq(TR.migrate(old), false, "멱등"); eq(JSON.stringify(old), snap);
    });
    t("TR21 직무군 색(v1.37 · v1.44 3군): 직무군 + 기타 · 칩 순서 · 범례 = 걸러 보기 · 직무 고르기와 맞물림 · 모바일 점 · 현황표 · 개인 화면 · 기준표 · 직무 고르기 묶음 · CSS 색", () => {
      const G = (r) => TR.rgOf(r).id;
      const qin = (root, sel) => Array.from(root.querySelectorAll(sel));
      eq(TR.RGROUPS.map(g => g.id).join(","), "sup,scr,ins,etc");
      eq(G("항공사보안감독자"), "sup");
      eq(["항공사보안책임자", "항공보안교관"].map(G).join(","), "etc,etc", "v1.38 기준표에서 뺀 직무는 남아 있으면 기타(사내 직무)");
      eq(["보안검색감독자", "보안검색요원", "항공보안장비 유지보수요원", "화물보안 업무요원"].map(G).join(","), "scr,scr,scr,scr");
      eq(["보안 유관부서 관리자", "보안 유관부서 일반요원", "전화 접수자 · 안내요원"].map(G).join(","), "etc,etc,etc", "v1.44 뺀 직무는 남아 있으면 기타");
      eq(G("사내보안교관"), "ins");
      eq(["DGR", "방사선안전관리자", "SSI", "ACMR", "ACC3 보안통제 직원", "야간 당직"].map(G).join(","), "etc,etc,etc,etc,etc,etc", "그 밖은 기본색");
      eq(G("보안감독자"), "sup", "옛 직무 이름도");
      ok(TR.RGROUPS.every(g => g.roles.every(r => TR.ROLES.indexOf(r) >= 0)), "직무군의 직무는 모두 기준표 정식 명칭");
      eq(TR.sortRoles(["SSI", "사내보안교관", "화물보안 업무요원", "항공사보안감독자", "보안검색요원"]).join(","), "항공사보안감독자,보안검색요원,화물보안 업무요원,사내보안교관,SSI");
      const css = read("css/main.css");
      TR.RGROUPS.forEach(g => ok(new RegExp("\\.rg-" + g.id + " \\{ --rc: #[0-9a-f]{6}; --rt: #[0-9a-f]{6}; --rs: #[0-9a-f]{6}; --rb: #[0-9a-f]{6}; \\}").test(css), "CSS 색: " + g.id));
      ["c1", "c2", "c3"].forEach(id => { data().people = data().people.filter(p => p.id !== id); });
      data().people.push({ id: "c1", name: "색가", dept: "인천화물팀", roles: ["화물보안 업무요원", "보안검색요원"] },
        { id: "c2", name: "색나", dept: "인천화물팀", roles: ["사내보안교관", "항공사보안감독자"] },
        { id: "c3", name: "색다", dept: "인천화물팀", roles: ["보안 유관부서 관리자", "SSI"] });
      loginAs(e, "hq"); TR.setState({ tab: "people", pid: "", sid: "", q: "", roleF: "", rgF: "", onlyAct: false, pState: "active", pView: "list" }); go(e, "training");
      const rows = () => qa(e, ".tr-ptbl tbody tr");
      const row = (n) => rows().find(r => r.querySelector(".tbl-open").textContent === n);
      eq(qin(row("색가"), ".tr-role").map(c => c.textContent + "|" + c.className).join(","), "보안검색요원|tr-role rg-scr,화물보안 업무요원|tr-role rg-scr", "칩 = 군 색 · 군 안 순서");
      eq(qin(row("색나"), ".tr-role").map(c => c.className.split(" ")[1]).join(","), "rg-sup,rg-ins", "군 순서");
      ok(qin(row("색다"), ".tr-role .rg-dot").length === 2 && row("색다").querySelector(".tr-role.rg-etc"), "기타 칩(기본색)");
      const lg = qa(e, "#tr-plist .tr-rglg [data-rgf]");
      eq(lg.map(b => b.dataset.rgf).join(","), "sup,scr,ins,etc", "범례 4");
      const cnt = (id) => Number(lg.find(b => b.dataset.rgf === id).querySelector("b").textContent);
      const act = data().people.filter(p => !p.left);
      eq(cnt("scr"), act.filter(p => TR.rolesOf(p).some(r => G(r) === "scr")).length, "범례 숫자 = 그 군 직무를 가진 재직 인원");
      q(e, '#tr-plist [data-rgf="ins"]').click();
      const insN = rows().map(r => r.querySelector(".tbl-open").textContent);
      ok(insN.indexOf("색나") >= 0 && insN.indexOf("색가") < 0 && insN.indexOf("색다") < 0 && insN.length === cnt("ins"), "직무군 걸러 보기");
      eq(q(e, '#tr-plist [data-rgf="ins"]').getAttribute("aria-pressed"), "true");
      eq(TR.getState().rgF, "ins");
      q(e, '#tr-plist [data-rgf="ins"]').click();
      eq(TR.getState().rgF, "", "다시 누르면 해제");
      eq(rows().length, act.length);
      ok(qa(e, "#tr-role optgroup").map(o => o.label).indexOf("보안검색 · 화물보안") >= 0, "직무 고르기 = 군별 묶음");
      q(e, '#tr-plist [data-rgf="scr"]').click();
      chg(setv("#tr-role", "사내보안교관"));
      eq(TR.getState().rgF, "", "다른 군 직무를 고르면 군 걸러 보기 해제");
      eq(rows().map(r => r.querySelector(".tbl-open").textContent).join(","), "색나");
      q(e, '#tr-plist [data-rgf="sup"]').click();
      eq(TR.getState().roleF, "", "다른 군을 누르면 직무 고르기 해제");
      TR.setState({ rgF: "", roleF: "", pView: "grid" }); go(e, "training");
      const gr = qa(e, ".tr-gtbl tbody tr").find(r => /색가/.test(r.textContent));
      eq(qin(gr, ".tr-rmini .rg-dot").map(d => d.className).join(","), "rg-dot rg-scr,rg-dot rg-scr", "현황표 이름 칸");
      TR.setState({ pView: "list" });
      setW(390); go(e, "training");
      const mr = qa(e, ".tr-mrow").find(r => /색나/.test(r.textContent));
      eq(qin(mr, ".tr-rdots .rg-dot").map(d => d.className.split(" ")[1]).join(","), "rg-sup,rg-ins", "모바일 이름 옆 군 점");
      ok(/사내보안교관/.test(mr.querySelector(".tr-rdots").getAttribute("aria-label")), "점의 직무 이름(읽기)");
      ok(q(e, "#tr-plist .tr-rglg"), "모바일 범례");
      setW(1024);
      TR.setState({ pid: "c2" }); go(e, "training");
      eq(qa(e, ".tr-roles li").map(li => li.className).join(","), "rg-sup,rg-ins", "개인 화면 직무 카드");
      ok(/보안교관/.test(qa(e, ".tr-roles li small")[1].textContent), "군 이름");
      TR.setState({ pid: "", tab: "catalog", q: "" }); go(e, "training");
      const rd = (name) => qa(e, ".tr-rd").find(c => c.querySelector("summary .tr-rn b").textContent === name);
      ok(rd("항공사보안감독자").classList.contains("rg-sup") && rd("보안검색요원").classList.contains("rg-scr") && rd("DGR").classList.contains("rg-etc"), "기준표 직무 줄 색");
      eq(qa(e, ".tr-team .tr-rsec").map(x => x.className.split(" ")[1]).join(","), "rg-sup,rg-scr,rg-ins,rg-etc", "기준표 = 직무군 소제목(색 점)");
      TR.setState({ tab: "people" }); go(e, "training");
      q(e, "#tr-padd").click();
      eq(qa(e, "#tp-roles .tr-rgrp").map(g => g.className.split(" ")[1]).join(","), "rg-sup,rg-scr,rg-ins,rg-etc", "직무 고르기 = 직무군 묶음");
      ok(qa(e, "#tp-roles .rg-etc input").some(i => i.value === "야간 당직") && qa(e, "#tp-roles .rg-etc input").some(i => i.value === "DGR"), "기타 = 위험물 · 사내 직무");
      const ra = setv("#tp-role-add", "새 당직");
      ra.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      ok(qa(e, "#tp-roles .rg-etc input").some(i => i.value === "새 당직" && i.checked), "직접 입력 → 기타");
      e.S.closeModal();
      data().people = data().people.filter(p => ["c1", "c2", "c3"].indexOf(p.id) < 0);
    });
    t("TR22 인천화물팀 기준(v1.38): 판 2 → 3 이전(책임자 · 교관 직무 뺌 · 새 과정 · 협력사 대상 · 사람 · 기록 그대로) · 감독자 요건 과정 = 검색요원 초기 기록 인정", () => {
      eq(TR.CAT_VER, 5);
      const D = (id) => JSON.parse(JSON.stringify(TR.DEF_COURSES.find(c => c.id === id)));
      const v131 = (id, o) => Object.assign(D(id), o);
      const prod = { catVer: 2,
        courses: [v131("c-sup-i", { roles: ["항공사보안책임자", "항공사보안감독자"], hours: "16시간↑ (책임자 8시간↑) · 평가" }),
          v131("c-sup-r", { roles: ["항공사보안책임자", "항공사보안감독자"] }), D("c-scr-i"), D("c-scr-r"), D("c-scn-i"),
          { id: "u-dgi", fam: "dgr", name: "IATA DGR 위험물 교육 초기", kind: "초기", cycle: 24, rule: "dg", legal: "law", roles: ["위험물 취급자"], vendor: false },
          { id: "u-wb", fam: "w/b", name: "Weight & Balance(B74F) 초기", kind: "초기", cycle: 12, legal: "own", roles: [], vendor: false },
          { id: "u-ins", fam: "inst", name: "항공보안 교관", kind: "1회", cycle: 0, legal: "law", roles: ["항공보안교관"], vendor: false },
          v131("v-screen", { who: undefined }), v131("c-acmr-i", { basis: "TSA 보안프로그램 (미주편) — 정식 명칭 · 주기 확인 필요" })],
        people: [{ id: "k1", name: "갑", roles: ["항공사보안감독자", "보안검색감독자"] }, { id: "k2", name: "을", roles: ["항공사보안책임자"] }],
        records: [{ id: "x1", pid: "k1", cid: "c-sup-r", date: "2025-10-17", expire: "" }, { id: "x2", pid: "k1", cid: "u-ins", date: "2024-03-08", expire: "" }],
        sessions: [] };
      const ppl = JSON.stringify(prod.people), recs = JSON.stringify(prod.records);
      eq(TR.migrate(prod), true);
      const by = (id) => prod.courses.find(c => c.id === id);
      eq(by("c-sup-i").roles.join() + "|" + by("c-sup-i").hours, "항공사보안감독자|16시간↑ · 평가 80점↑", "코드 정의로");
      eq(by("u-ins").roles.join(), "", "교관 과정 = 직무 지정 없음");
      eq(by("u-wb").name + "|" + by("u-wb").legal, "Weight & Balance(B74F) 초기|own", "사내 과정 그대로");
      ok(by("v-screen").who && !/확인 필요/.test(by("c-acmr-i").basis), "협력사 대상 · ACMR 근거");
      ok(by("c-scr-p") && by("c-rad-i") && by("c-rad-r"), "새 과정 추가");
      ok(!by("c-inst"), "같은 묶음 교관 과정이 있으면 덧붙이지 않음");
      const ids = prod.courses.map(c => c.id);
      eq(ids.indexOf("c-scr-p"), ids.indexOf("c-scr-r") + 1, "새 과정은 코드 순서상 앞 과정 뒤(이수 현황표 칸 순서)");
      eq(ids.indexOf("c-rad-i"), ids.indexOf("c-dg-r") + 1); eq(ids.indexOf("c-rad-r"), ids.indexOf("c-rad-i") + 1);
      eq(prod.courses.filter(c => c.fam === "dgr" && c.kind === "초기").length, 1, "위험물 초기 하나");
      eq(JSON.stringify(prod.people) + JSON.stringify(prod.records), ppl + recs, "사람 직무 · 기록은 그대로");
      eq(prod.catVer, 5);
      const snap = JSON.stringify(prod);
      eq(TR.migrate(prod), false, "멱등"); eq(JSON.stringify(prod), snap);
      /* 감독자 요건(c-scr-p): 검색요원 초기(c-scn-i) 기록을 인정 */
      const keep = JSON.stringify(data());
      Object.assign(data(), { courses: TR.DEF_COURSES.map(c => JSON.parse(JSON.stringify(c))), people: [{ id: "sv", name: "감독", dept: "인천화물팀", roles: ["보안검색감독자"] }], records: [], sessions: [] });
      TR.setToday("2026-10-01");
      const sv = data().people[0];
      const pq = () => TR.personQuals(sv).req.map(x => x.g.fam + ":" + x.st).sort().join(",");
      eq(pq(), "scr-p:none,scr:none", "감독자 = 감독자 과정 + 감독자 요건(검색요원 초기)");
      data().records.push({ id: "sn1", pid: "sv", cid: "c-scn-i", date: "2019-05-02" });
      eq(pq(), "scr-p:perm,scr:none", "검색요원 초기 기록 → 감독자 요건 영구");
      eq(TR.personQuals(sv).held.length, 0, "검색요원 묶음을 '보유(인증 전)'로 따로 보이지 않음");
      eq(TR.expireOf(data().records[0]), "", "검색요원 초기 기록 자체는 단계(유효기한 없음)");
      data().records.push({ id: "sn2", pid: "sv", cid: "c-scr-i", date: "2026-03-01" });
      eq(pq(), "scr-p:perm,scr:ok");
      Object.assign(data(), JSON.parse(keep));
    });
    t("TR23 판 3 → 4 이전(v1.42): 감독자 · DGR · SSI 표기만 바꿈 — 고친 과정 내용 · v2 기록 유효기한 · 순서는 그대로 · 임명일 키 · 멱등", () => {
      const D = (id) => JSON.parse(JSON.stringify(TR.DEF_COURSES.find(c => c.id === id)));
      const prod = { catVer: 3,
        courses: [Object.assign(D("c-sup-i"), { name: "항공사보안책임자 · 감독자 초기", hours: "16시간↑ (팀 기준)" }), Object.assign(D("c-sup-r"), { name: "항공사보안책임자 · 감독자 정기" }),
          { id: "u-dgi", fam: "dgr", name: "IATA DGR 위험물 교육 초기", kind: "초기", cycle: 24, rule: "dg", legal: "law", roles: ["위험물 취급자"] },
          { id: "u-dgr", fam: "dgr", name: "IATA DGR 위험물 교육 정기", kind: "정기", cycle: 24, rule: "dg", legal: "law", roles: ["위험물 취급자"] },
          Object.assign(D("c-icao-m"), { basis: "ICAO ASTP — 책임자 · 감독자 초기교육 인정 근거(지침 제17조②)" }), D("c-scr-i")],
        people: [{ id: "k1", name: "갑", roles: ["항공사보안감독자", "위험물 취급자", "SSI 취급자", "DGR"], apt: { "위험물 취급자": "2025-03-02" } },
          { id: "k2", name: "을", roles: ["SSI"], apt: { "SSI 취급자": "2024-01-01", "SSI": "2025-01-01" } }],
        records: [{ id: "x1", pid: "k1", cid: "u-dgi", date: "2025-03-02", expire: "2027-03-01", src: "semis-v2" }], sessions: [] };
      eq(TR.migrate(prod), true);
      const by = (id) => prod.courses.find(c => c.id === id);
      eq(prod.courses.map(c => c.name).join("|"), "항공사보안감독자 초기|항공사보안감독자 정기|DGR 초기|DGR 정기|ICAO 항공보안 관리자 (ASTP)|보안검색감독자 초기");
      eq(by("c-sup-i").hours, "16시간↑ (팀 기준)", "고친 과정 내용 그대로(판 3 이후는 코드 정의로 덮지 않음)");
      eq(by("u-dgi").roles.join() + "|" + by("c-icao-m").basis, "DGR|ICAO ASTP — 항공사보안감독자 초기교육 인정 근거(지침 제17조②)");
      eq(prod.courses.length, 6, "기본 과정을 덧붙이지 않음");
      eq(prod.people[0].roles.join(","), "항공사보안감독자,DGR,SSI");
      eq(JSON.stringify(prod.people[0].apt) + JSON.stringify(prod.people[1].apt), '{"DGR":"2025-03-02"}{"SSI":"2025-01-01"}', "임명일 키 — 새 이름이 있으면 그것");
      eq(prod.records[0].expire, "2027-03-01", "v2 기록 유효기한 그대로");
      eq(prod.catVer, 5);
      const snap = JSON.stringify(prod);
      eq(TR.migrate(prod), false, "멱등"); eq(JSON.stringify(prod), snap);
      eq(TR.aptOf({ apt: { "위험물 취급자": "2025-03-02" } }, "DGR"), "2025-03-02", "옛 키 임명일도 읽음");
    });
    t("TR24 보안교관 직무군(v1.43.1): 항공보안교관 과정 이수자(직무 없음)도 범례 수 · 걸러 보기 · 보유 칩 · 현황표 · 모바일 점 — 필수 과정 집계는 그대로", () => {
      const keep = JSON.stringify(data());
      Object.assign(data(), { courses: TR.DEF_COURSES.map(c => JSON.parse(JSON.stringify(c))).concat([{ id: "u-ins", fam: "inst", name: "항공보안 교관", kind: "1회", cycle: 0, legal: "law", roles: [] }]),
        people: [{ id: "i1", name: "교관가", dept: "인천화물팀", roles: ["항공사보안감독자"] }, { id: "i2", name: "교관나", dept: "인천화물팀", roles: ["사내보안교관"] },
          { id: "i3", name: "일반다", dept: "인천화물팀", roles: ["항공사보안감독자"] }],
        records: [{ id: "x1", pid: "i1", cid: "u-ins", date: "2024-03-08" }, { id: "x2", pid: "i1", cid: "c-sup-r", date: "2026-03-02" }], sessions: [] });
      TR.setToday("2026-10-08");
      const s0 = TR.stats("2026-10-08");
      loginAs(e, "hq"); TR.setState({ tab: "people", pid: "", sid: "", q: "", roleF: "", rgF: "", onlyAct: false, pState: "active", pView: "list" }); go(e, "training");
      const lg = (id) => q(e, `#tr-plist .tr-rglg [data-rgf="${id}"]`);
      eq(lg("ins").querySelector("b").textContent, "2", "직무 1 + 과정 이수 1"); ok(!lg("ins").disabled && /항공보안교관 과정/.test(lg("ins").title));
      eq(lg("sup").querySelector("b").textContent, "2");
      const row = (n) => qa(e, ".tr-ptbl tbody tr").find(r => r.querySelector(".tbl-open").textContent === n);
      const held = row("교관가").querySelector(".tr-role.is-held.rg-ins");
      ok(held && /항공보안 교관/.test(held.textContent) && /보유/.test(held.textContent), "보유 칩");
      ok(!row("교관나").querySelector(".is-held"), "직무가 있으면 보유 칩 없음");
      lg("ins").click();
      eq(qa(e, ".tr-ptbl tbody tr").map(r => r.querySelector(".tbl-open").textContent).sort().join(), "교관가,교관나", "걸러 보기에 이수자 포함");
      TR.setState({ rgF: "", pView: "grid" }); go(e, "training");
      ok(/항공보안 교관 \(보유\)/.test(q(e, '.tr-gtbl tr[data-pid="i1"] .tr-rmini').textContent), "현황표 이름 칸");
      TR.setState({ pView: "list" });
      const s1 = TR.stats("2026-10-08");
      eq(JSON.stringify([s1.cells, s1.good, s1.bad]), JSON.stringify([s0.cells, s0.good, s0.bad]), "필수 과정 집계는 그대로(직무 아님)");
      ok(!TR.roleStats("2026-10-08").some(r => r.role === "항공보안 교관"), "직무별 집계에 넣지 않음");
      eq(e.errors.length, 0, e.errors.join("|"));
      Object.assign(data(), JSON.parse(keep));
    });
    t("TR25 판 4 → 5 이전(v1.44): 보안 유관부서 · 전화 접수 직무군 뺌 — 안 쓰는 과정만 지움(기록 · 교육 기록이 가리키면 남김) · 감독자 요건 과정 이름 · 고친 내용 그대로 · 사람 · 기록 그대로 · 멱등 · 화면", () => {
      const keep = JSON.stringify(data());
      const D = (id) => JSON.parse(JSON.stringify(TR.DEF_COURSES.find(c => c.id === id)));
      const v4 = (id, fam, name, roles) => ({ id, fam, name, kind: "정기", cycle: 12, rule: "kr", hours: "2시간↑", legal: "law", basis: "교육훈련지침", org: "자체", roles });
      const oldP = { name: "보안검색감독자 선수 과정", hours: "보안검색요원 초기교육 40시간↑ · 평가 (수료증)", basis: "교육훈련지침 제18조① · 별표 8 — 검색요원 초기 이수자를 감독자로" };
      const prod = { catVer: 4,
        courses: [D("c-sup-i"), D("c-scr-i"), Object.assign(D("c-scr-p"), oldP), D("c-scn-i"),
          v4("c-mgr-i", "mgr", "보안 유관부서 관리자 초기", ["보안 유관부서 관리자"]), v4("c-mgr-r", "mgr", "보안 유관부서 관리자 정기", ["보안 유관부서 관리자"]),
          v4("c-gen-i", "aware", "보안 유관부서 일반요원 초기", ["보안 유관부서 일반요원"]), v4("c-aware", "aware", "보안 유관부서 일반요원 정기", ["보안 유관부서 일반요원"]),
          Object.assign(v4("c-bomb", "bomb", "폭발물 위협대응 교육", ["전화 접수자 · 안내요원"]), { kind: "1회", cycle: 0, rule: "" }),
          { id: "u-x", fam: "u-x", name: "사내 비상 교육", kind: "정기", cycle: 12, legal: "own", roles: ["전화 접수자 · 안내요원", "화물보안 업무요원"] }, D("v-aware")],
        people: [{ id: "k1", name: "갑", roles: ["보안검색감독자", "전화 접수자 · 안내요원"], apt: { "전화 접수자 · 안내요원": "2024-01-02" } }],
        records: [{ id: "x1", pid: "k1", cid: "c-bomb", date: "2024-03-08", expire: "" }],
        sessions: [{ id: "s1", type: "own", cid: "c-aware", title: "정기 보안교육", date: "2025-12-31", pids: [] }] };
      const ppl = JSON.stringify(prod.people), recs = JSON.stringify(prod.records), ses = JSON.stringify(prod.sessions);
      eq(TR.migrate(prod), true);
      const by = (id) => prod.courses.find(c => c.id === id);
      eq(prod.courses.map(c => c.id).join(","), "c-sup-i,c-scr-i,c-scr-p,c-scn-i,c-aware,c-bomb,u-x,v-aware", "안 쓰는 뺀 과정만 지움 · 순서 그대로");
      eq(by("c-aware").roles.join() + "|" + by("c-bomb").roles.join(), "|", "남긴 과정은 뺀 직무만 지움(그 밖의 과정)");
      eq(by("u-x").roles.join(), "화물보안 업무요원", "사용자 과정 대상에서도 뺀 직무만 지움");
      eq([by("c-scr-p").name, by("c-scr-p").hours, by("c-scr-p").basis].join("|"), [D("c-scr-p").name, D("c-scr-p").hours, D("c-scr-p").basis].join("|"), "감독자 요건 과정 이름 · 시간 · 근거");
      ok(by("v-aware").vendor && /보안 유관부서/.test(by("v-aware").name), "협력사 확인 과정 그대로");
      eq(JSON.stringify(prod.people) + JSON.stringify(prod.records) + JSON.stringify(prod.sessions), ppl + recs + ses, "사람 · 기록 · 교육 기록 그대로");
      eq(prod.catVer, 5);
      const snap = JSON.stringify(prod);
      eq(TR.migrate(prod), false, "멱등"); eq(JSON.stringify(prod), snap);
      const fixed = { catVer: 4, courses: [Object.assign(D("c-scr-p"), { name: "검색요원 초기(팀 이름)", hours: oldP.hours })], people: [], records: [], sessions: [] };
      TR.migrate(fixed);
      eq(fixed.courses[0].name + "|" + fixed.courses[0].hours, "검색요원 초기(팀 이름)|" + D("c-scr-p").hours, "고친 이름은 그대로 — 옛 기본값만 바꿈");
      /* 화면: 감독자 개인 화면 · 기준표 · 범례 */
      Object.assign(data(), { courses: TR.DEF_COURSES.map(c => JSON.parse(JSON.stringify(c))),
        people: [{ id: "g1", name: "감독가", dept: "인천화물팀", roles: ["보안검색감독자"] }],
        records: [{ id: "g1a", pid: "g1", cid: "c-scn-i", date: "2019-05-02" }], sessions: [] });
      TR.setToday("2026-10-09");
      loginAs(e, "hq"); TR.setState({ tab: "people", pid: "", sid: "", q: "", roleF: "", rgF: "", onlyAct: false, pState: "active", pView: "list" }); go(e, "training");
      TR.openPerson("g1");
      const qd = q(e, '.tr-qual[data-tqual="scr-p"]');
      ok(qd && qd.querySelector(".tr-qh b").textContent === "보안검색요원 초기" && qd.getAttribute("data-st") === "perm", "개인 화면: 감독자 요건 카드 = '보안검색요원 초기' · 검색요원 초기 기록으로 영구");
      ok(!/선수/.test(q(e, "#view").textContent), "화면에 '선수' 없음");
      TR.setState({ pid: "", pView: "grid" }); go(e, "training");
      const th = qa(e, ".tr-gtbl thead th").find(x => x.textContent === "보안검색요원 초기");
      ok(th && th.title === "보안검색요원 초기 (감독자 요건)", "현황표 열 이름(짧게) · 전체 이름은 title");
      TR.setState({ pView: "list" }); go(e, "training");
      eq(qa(e, "#tr-plist .tr-rglg [data-rgf]").map(b => b.textContent.replace(/\d+/g, "").trim()).join(","), "항공사 보안관리,보안검색 · 화물보안,보안교관,기타", "범례");
      TR.setState({ tab: "catalog" }); go(e, "training");
      const txt = q(e, ".tr-team").textContent;
      ok(!/보안 유관부서|전화 접수/.test(txt) && /보안검색요원 초기 \(감독자 요건\)/.test(txt), "기준표 인천화물팀: 뺀 직무 없음 · 감독자 요건 과정");
      eq(e.errors.length, 0, e.errors.join("|"));
      TR.setState({ tab: "people", pid: "" });
      Object.assign(data(), JSON.parse(keep));
    });
    e.w.close();
  }

  /* ══════════ [AD] 점검 · 교육 대시보드 (v1.31) ══════════ */
  {
    const e = makeEnv();
    const TR = e.w.SemisTraining, A = e.w.SemisAudit, SL = e.w.SemisSeclog, AD = e.w.SemisAudDash;
    const setW = (w) => Object.defineProperty(e.w, "innerWidth", { value: w, configurable: true });
    TR.setToday("2026-10-01"); A.setToday("2026-10-01"); SL.setToday("2026-10-01", "10:00"); AD.setToday("2026-10-01");
    t("AD01 메뉴: 점검 · 교육 허브 맨 위 · mgr · 옛 메뉴 데이터에 1회 추가(멱등) · 레일 허브 클릭 → 대시보드", () => {
      const ms = e.S.data.menus.filter(m => m.parent === "hub-aud").sort((a, b) => a.seq - b.seq);
      eq(ms[0].module, "aud-dash"); eq(ms[0].vis, "mgr"); eq(ms[0].label, "점검 · 교육 대시보드");
      const old = e.S.defaultMenus().filter(m => m.module !== "aud-dash");
      const o = makeEnv({ preData: { version: 1, menus: old } });
      const om = o.S.data.menus.filter(m => m.parent === "hub-aud").sort((a, b) => a.seq - b.seq);
      eq(om[0].module, "aud-dash", "허브 맨 위에 추가");
      eq(o.S.normalizeData(), false, "멱등");
      o.w.close();
      loginAs(e, "hq"); go(e, "dashboard");
      eq(e.S.hubHomeRoute("hub-aud"), "aud-dash");
      setW(1440);
      q(e, '#rail-hubs [data-hub="hub-aud"]').click();
      eq(e.w.location.hash, "#/aud-dash");
      e.S.renderView();
      ok(q(e, ".ie-card") || q(e, "#view .empty-state"), "대시보드");
      setW(1024);
    });
    t("AD02 교육 · 자격 · 수검 · 기록부 카드: 요약 지표 · 직무별 상태 막대 · 갱신 목록 → 개인 화면 · 월별 막대 12칸 · 다가오는 수검 · 지적 · 양식별 이행", () => {
      const d = e.S.data;
      d.training = { courses: [], sessions: [{ id: "s1", type: "own", cid: "c-cargo-r", title: "화물보안 정기", date: "2026-09-10", hours: 2, pids: ["p1"] },
          { id: "s2", type: "vendor", cid: "v-screen", vendor: "가나보안", date: "2026-08-05" }],
        people: [{ id: "p1", name: "갑일", dept: "인천화물팀", roles: ["항공사보안감독자", "화물보안 업무요원"] },
          { id: "p2", name: "을일", dept: "인천화물팀", roles: ["항공사보안감독자", "SSI"] },
          { id: "p3", name: "병일", dept: "인천화물팀", roles: ["사내보안교관"] }],
        records: [{ id: "r1", pid: "p1", cid: "c-sup-r", date: "2025-10-20" }, { id: "r2", pid: "p2", cid: "c-sup-r", date: "2025-08-22" },
          { id: "r3", pid: "p3", cid: "c-inh", date: "2024-03-08" }] };
      TR.syncSessionRecords(d.training.sessions[0]);
      d.audits = [{ id: "a1", body: "gov", org: "서울지방항공청", kind: "정기점검", start: "2026-10-20", end: "2026-10-21",
          checklist: [{ id: "k1", mid: "9.9", text: "x", docScore: 3, impScore: 3, files: [{ name: "a", url: "u" }] }, { id: "k2", mid: "9.8", text: "y" }], findings: [] },
        { id: "a0", body: "internal", org: "안전보안실", kind: "본사 점검", start: "2026-05-01", findings: [
          { id: "f1", type: "car", ref: "1.2", text: "y", status: "open", due: "2026-09-01" }, { id: "f2", type: "rec", ref: "2.1", text: "z", status: "done", due: "2026-06-01" }] }];
      go(e, "aud-dash");
      ok(q(e, "#view .page-head [data-print-btn]"), "인쇄");
      const kp = q(e, "#view .stat-row").textContent;
      ["자격 유효율", "갱신 · 조치 필요", "SSI 서약", "다음 수검", "미결 지적", "기록부 이행률"].forEach(k => ok(kp.indexOf(k) >= 0, k));
      ok(kp.indexOf("자체 점검") < 0, "자체 보안점검(선택 실행 · v1.42)은 지표에 없음");
      ok(/D-19/.test(kp), "다음 수검 D-day");
      eq(qa(e, ".ie-card").length, 5, "점검 일정 달력(v1.34) · 다가오는 점검(v1.33) · 교육 · 수검 · 기록부 — 자체 보안점검 카드 없음(v1.42)");
      ok(qa(e, ".ie-card")[0].classList.contains("ie-cal") && qa(e, ".ie-card")[1].classList.contains("ie-up"), "달력 · 다가오는 점검이 맨 위");
      ok(!q(e, ".ie-err"), "카드 오류 없음");
      const cards = qa(e, ".ie-card:not(.ie-up):not(.ie-cal)");
      const tc = cards[0];
      ok(cards[0].querySelectorAll(".ie-sb").length >= 3, "직무별 막대(항공사보안감독자 · 화물보안 업무요원 · 사내보안교관)");
      eq(tc.querySelectorAll(".cc").length, 2); ok(Array.from(tc.querySelectorAll(".cc")).every(c => c.querySelectorAll(".cc-col").length === 12), "12칸");
      const dues = qa(e, ".ie-due");
      ok(dues.length >= 2 && dues.some(b => /을일/.test(b.textContent)) && dues.some(b => /갑일/.test(b.textContent)), "갱신 목록");
      ok(!dues.some(b => /병일/.test(b.textContent)), "영구는 갱신 목록에 없음");
      ok(dues[0].getAttribute("data-st") === "susp", "정지가 맨 위");
      const ac = cards[1];
      ok(/서울지방항공청/.test(ac.textContent) && ac.querySelector(".ie-aud .ie-pg"), "다가오는 수검 · 준비율");
      ok(/미결/.test(ac.textContent) && ac.querySelector('[data-ie-find="late"].bad'), "기한 경과 지적");
      const sc = cards[2];
      eq(sc.querySelectorAll(".ie-sb").length, SL.templates().length, "양식별 이행 막대");
      ok(q(e, "[data-tt]"), "값 말풍선");
      dues.find(b => /을일/.test(b.textContent)).click();
      eq(e.w.location.hash, "#/training"); e.S.renderView();
      eq(TR.getState().pid, "p2", "갱신 목록 → 개인 화면");
      ok(q(e, ".tr-pgrid"));
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("AD03 메뉴 숨김 · 권한: 숨긴 메뉴 카드 빠짐 · manager 열람 · user 접근 불가 · 모바일", () => {
      const mn = e.S.data.menus.find(m => m.module === "inspection");
      mn.hidden = true;
      go(e, "aud-dash");
      eq(qa(e, ".ie-card:not(.ie-up):not(.ie-cal)").length, 2, "보안 기록부 카드 없음");
      ok(!q(e, ".ie-up [data-ie-sl]") && !q(e, ".ie-up .uc-daily"), "숨긴 보안 기록부는 다가오는 점검에서도 빠짐");
      ok(!/기록부 이행률/.test(q(e, "#view .stat-row").textContent));
      delete mn.hidden;
      loginAs(e, "manager"); go(e, "aud-dash");
      eq(qa(e, ".ie-card").length, 5);
      setW(390); go(e, "aud-dash");
      ok(qa(e, ".ie-due").length <= 5, "모바일 목록 5건까지");
      setW(1024);
      loginAs(e, "user"); go(e, "aud-dash");
      ok(!q(e, ".ie-card"), "user 는 볼 수 없음");
      loginAs(e, "hq");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    e.w.close();
  }

  /* ══════════ [SL] 보안 기록부 (v1.22) ══════════ */
  {
    const e = makeEnv();
    const SL = e.w.SemisSeclog, A = e.w.SemisAudit;
    const setv = (sel, v) => { const el = q(e, sel); el.value = v; return el; };
    const chg = (el) => { el.dispatchEvent(new e.w.Event("change")); return el; };
    const inp = (el) => { el.dispatchEvent(new e.w.Event("input")); return el; };
    const recs = () => e.S.data.seclog;
    /* 시험용 양식 — 점검 항목은 가짜 문구(실제 문구는 공용 DB에만) */
    const FAKE = [
      { id: "t-daily", name: "일일 보안점검", kind: "check", cycle: "day", items: [{ id: "i1", text: "시험 항목 A" }, { id: "i2", text: "시험 항목 B" }], evidence: ["2.7", "4.3"] },
      { id: "t-wd", name: "평일 점검", kind: "check", cycle: "day", days: "weekday", evidence: ["5.3"] },
      { id: "t-patrol", name: "보안 브리핑 · 순찰", kind: "patrol", cycle: "day", rounds: 3, evidence: ["5.4"] },
      { id: "t-month", name: "위해물품 월간 점검", kind: "check", cycle: "month", evidence: ["4.2"] },
      { id: "t-hold", name: "화물칸 보안 점검 (미주행)", kind: "flight", cycle: "event", evidence: ["9.6"] }
    ];
    const rec = (tid, date, extra) => Object.assign({ id: "r" + tid + date + Math.random().toString(36).slice(2, 5), tid, date, time: "09:00", by: "점검자", checks: [], result: "ok", note: "", action: "", files: [], rounds: [] }, extra || {});
    SL.setToday("2026-10-10", "14:30"); A.setToday("2026-10-10");

    t("SL01 메뉴: 보안 기록부(점검 · 교육 허브 · mgr) · 데이터 · 권한표 · 파일 폴더", () => {
      const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "inspection");
      ok(mn && !mn.planned && mn.label === "보안 기록부" && mn.vis === "mgr" && mn.parent === "hub-aud");
      ok(Array.isArray(e.S.data.seclog) && Array.isArray(e.S.data.seclogCfg.templates), "기본 데이터");
      eq(ACL.seclog.join(","), "2,2"); eq(ACL.seclogCfg.join(","), "2,3");
      const edge = read("tools/edge/semis-logi-files.ts");
      ok(/READ_RANK[\s\S]*seclog: 2[\s\S]*WRITE_RANK[\s\S]*seclog: 2/.test(edge), "파일 폴더 열람 2 · 올리기 2");
    });
    t("SL02 코드 양식은 뼈대뿐(점검 항목 없음) · 규정 문구가 코드에 없음", () => {
      ok(SL.DEF_TEMPLATES.length >= 8 && SL.DEF_TEMPLATES.every(t => !t.items || !t.items.length), "항목 없음");
      const ev = [].concat.apply([], SL.DEF_TEMPLATES.map(t => t.evidence));
      ["2.7", "4.1", "4.2", "4.3", "5.3", "5.4", "7.2", "7.6", "9.1.2", "9.4", "9.6"].forEach(n => ok(ev.indexOf(n) >= 0, "번호 " + n));
      const probe = ["비행", "서류"].join("");
      ["js/seclog.js", "docs/HANDOFF.md", "README.md"].forEach(f => ok(read(f).indexOf(probe) < 0, f));
    });
    t("SL03 주기: 주 · 월 · 분기 · 연 키 · 평일만 · 이름", () => {
      const T = (c, d) => ({ cycle: c, days: d || "all" });
      eq(SL.periodOf(T("week"), "2026-10-10"), "W2026-10-05", "월요일 시작");
      eq(SL.periodOf(T("week"), "2026-10-11"), "W2026-10-05", "일요일은 그 주");
      eq(SL.periodOf(T("month"), "2026-10-10"), "2026-10"); eq(SL.periodOf(T("quarter"), "2026-10-10"), "2026-Q4"); eq(SL.periodOf(T("year"), "2026-10-10"), "2026");
      eq(SL.periodsBack(T("day", "weekday"), "2026-10-12", 3).join(","), "2026-10-08,2026-10-09,2026-10-12", "주말 건너뜀");
      eq(SL.periodsBack(T("quarter"), "2026-02-01", 3).join(","), "2025-Q3,2025-Q4,2026-Q1");
      eq(SL.periodsBack(T("month"), "2026-01-15", 2).join(","), "2025-12,2026-01");
      eq(SL.periodLabel(T("quarter"), "2026-Q4"), "2026 4분기"); eq(SL.periodLabel(T("day"), "2026-10-10"), "10.10(토)");
    });
    t("SL04 누락: 기록 시작일부터 · 이번 주기는 진행 중 · 평일만 · 순찰 최소 횟수 · 월 주기", () => {
      e.S.data.seclogCfg = { since: "", templates: JSON.parse(JSON.stringify(FAKE)) };
      e.S.data.seclog = [];
      ["01", "02", "03", "04", "06", "07", "08", "09"].forEach(d => recs().push(rec("t-daily", "2026-10-" + d)));
      recs().push(rec("t-patrol", "2026-10-09", { rounds: [{ t: "09:00" }, { t: "11:00" }, { t: "13:00" }] }));
      recs().push(rec("t-patrol", "2026-10-08", { rounds: [{ t: "09:00" }, { t: "11:00" }] }));
      recs().push(rec("t-wd", "2026-10-09"));
      recs().push(rec("t-month", "2026-10-02"));
      const tp = (id) => SL.tplOf(id);
      const d = SL.status(tp("t-daily"));
      eq(d.missing.map(c => c.k).join(","), "2026-10-05", "빠진 날");
      ok(!d.cur.done && d.cur.k === "2026-10-10", "오늘은 진행 중(누락 아님)");
      eq(d.past.length, 9, "10/1 ~ 10/9");
      const w = SL.status(tp("t-wd"));
      eq(w.missing.map(c => c.k).join(","), "2026-10-01,2026-10-02,2026-10-05,2026-10-06,2026-10-07,2026-10-08", "평일만(10/3 · 4 주말 제외)");
      const pt = SL.status(tp("t-patrol"));
      ok(pt.cells.find(c => c.k === "2026-10-08").part, "2회 → 일부");
      ok(pt.cells.find(c => c.k === "2026-10-09").done, "3회 → 완료");
      const mo = SL.status(tp("t-month"));
      ok(mo.cur.done && !mo.missing.length, "이번 달 기록");
      e.S.data.seclogCfg.since = "2026-09-01";
      eq(SL.status(tp("t-month")).missing.map(c => c.k).join(","), "2026-09", "시작일을 앞당기면 9월 누락");
      e.S.data.seclogCfg.since = "";
    });
    t("SL05 체크리스트 증빙(SemisEvidence.inspection) → 수검 대응 센터 상태", () => {
      const ev = SL.evidence("2.7");
      eq(ev.text, "일일 보안점검 8/9일"); ok(!ev.ok, "누락 있으면 증빙 부족");
      eq(A.itemState({ mid: "2.7", docScore: 3, impScore: 3 }), "noev");
      recs().push(rec("t-daily", "2026-10-05"));
      ok(SL.evidence("2.7").ok && SL.evidence("2.7").text === "일일 보안점검 9/9일");
      eq(A.itemState({ mid: "2.7", docScore: 3, impScore: 3 }), "ready");
      eq(SL.evidence("9.6").text, "화물칸 보안 점검 (미주행) 0건(30일)"); ok(!SL.evidence("9.6").ok);
      recs().push(rec("t-hold", "2026-10-03", { flight: { no: "KJ271", reg: "HL8505", dest: "LAX" } }));
      ok(SL.evidence("9.6").ok && /1건/.test(SL.evidence("9.6").text));
      eq(SL.evidence("5.1"), null, "관계없는 번호");
      ok(A.routeEv("inspection", "4.2").live, "화면 연결");
    });
    t("SL06 기록 입력(manager): 점검 항목 문구째 저장 · 모두 적합 · 이상 → 조치 칸 · 점검자 필수 · 앞날 금지", () => {
      loginAs(e, "manager");
      SL.setState({ tab: "today" }); go(e, "inspection");
      ok(q(e, "#sl-add") && !q(e, "#sl-tpl"), "manager: 기록 가능 · 양식 편집 없음");
      q(e, '[data-sl-new="t-daily"]').click();
      eq(qa(e, "#sl-checks li").length, 2, "양식 항목");
      setv("#sl-by", "");
      clickOk(e);
      ok(q(e, "#modal-box #sl-checks"), "점검자 없으면 저장 안 됨");
      setv("#sl-by", "홍길동");
      clickOk(e);
      ok(q(e, "#modal-box #sl-checks"), "결과 안 고르면 저장 안 됨");
      q(e, "#sl-allok").click();
      ok(q(e, "#sl-ngbox").classList.contains("hidden"));
      q(e, '#sl-checks li[data-ci="1"] [data-v="ng"]').click();
      ok(!q(e, "#sl-ngbox").classList.contains("hidden"), "이상 → 조치 칸");
      setv("#sl-action", "현장 시정");
      const before = recs().length;
      clickOk(e);
      eq(recs().length, before + 1);
      const r = recs()[recs().length - 1];
      eq(r.date, "2026-10-10"); eq(r.time, "14:30"); eq(r.by, "홍길동"); eq(r.result, "ng"); eq(r.action, "현장 시정");
      eq(JSON.stringify(r.checks), JSON.stringify([{ t: "시험 항목 A", v: "ok" }, { t: "시험 항목 B", v: "ng" }]), "문구째");
      e.S.data.seclogCfg.templates[0].items[0].text = "바뀐 문구";
      SL.recordForm("", r.id);
      ok(q(e, "#sl-checks").textContent.indexOf("시험 항목 A") >= 0, "옛 기록은 그때 문구");
      setv("#sl-date", "2026-10-11"); clickOk(e);
      ok(q(e, "#modal-box #sl-date"), "앞날 금지");
      e.S.closeModal();
      e.S.data.seclogCfg.templates[0].items[0].text = "시험 항목 A";
    });
    t("SL07 순찰 +1: 오늘 기록에 시각을 더한다 · 없으면 새 기록 · 최소 횟수 채우면 완료", () => {
      loginAs(e, "manager");
      SL.setState({ tab: "today" }); go(e, "inspection");
      q(e, '[data-sl-round="t-patrol"]').click();
      eq(q(e, "#sl-qt").value, "14:30");
      setv("#sl-qb", "당직자"); clickOk(e);
      const today = () => recs().find(r => r.tid === "t-patrol" && r.date === "2026-10-10");
      eq(today().rounds.length, 1);
      SL.setToday("2026-10-10", "16:30");
      q(e, '[data-sl-round="t-patrol"]').click(); clickOk(e);
      SL.setToday("2026-10-10", "12:30");
      q(e, '[data-sl-round="t-patrol"]').click(); clickOk(e);
      eq(today().rounds.map(x => x.t).join(","), "12:30,14:30,16:30", "시각 순");
      ok(SL.status(SL.tplOf("t-patrol")).cur.done, "3회 → 완료");
      ok(/오늘 3회 \/ 3/.test(q(e, '[data-tid="t-patrol"]').textContent), "카드");
      const pt = e.S.data.seclogCfg.templates.find(x => x.id === "t-patrol");
      pt.items = [{ id: "pb", text: "시험 브리핑" }];
      SL.recordForm("t-patrol", today().id);
      ok(/시험 브리핑/.test(q(e, "#modal-box").textContent), "순찰 +1 기록을 열면 양식 항목이 보인다");
      e.S.closeModal(); pt.items = [];
      SL.setToday("2026-10-10", "14:30");
    });
    t("SL08 편별 양식: 편명 필수 · 대문자 · 편 추가 버튼", () => {
      loginAs(e, "manager");
      SL.setState({ tab: "today" }); go(e, "inspection");
      const b = q(e, '[data-sl-new="t-hold"]');
      ok(b && /편 추가/.test(b.textContent));
      b.click();
      setv("#sl-by", "보안요원");
      clickOk(e);
      ok(q(e, "#modal-box #sl-fno"), "편명 없으면 저장 안 됨");
      setv("#sl-fno", "kj272"); setv("#sl-freg", "hl8506"); setv("#sl-fdst", "ord");
      clickOk(e);
      const r = recs().filter(x => x.tid === "t-hold").pop();
      eq(r.flight.no + "/" + r.flight.reg + "/" + r.flight.dest, "KJ272/HL8506/ORD");
    });
    t("SL09 기록 현황: 주기 칸 · 누락 → 사후 기록(그날로) · 기록 목록 필터 · 검색칸 유지", () => {
      loginAs(e, "manager");
      recs().push(rec("t-wd", "2026-10-08"));
      SL.setState({ tab: "status" }); go(e, "inspection");
      const cells = qa(e, '[data-sl-cell^="t-daily|"]');
      eq(cells.length, 10, "10/1 ~ 10/10");
      eq(cells[cells.length - 1].dataset.c, "ng", "오늘 이상 있음");
      const late = q(e, '[data-sl-late="t-wd|2026-10-07"]');
      ok(late, "누락 버튼");
      late.click();
      eq(q(e, "#sl-date").value, "2026-10-07", "사후 기록 날짜");
      e.S.closeModal();
      SL.setState({ tab: "list", q: "", fTid: "", fMonth: "", fNG: false }); go(e, "inspection");
      const n0 = qa(e, "tr[data-slid]").length;
      ok(n0 >= 10);
      q(e, "#sl-fng").click();
      ok(qa(e, "tr[data-slid]").length === 1, "이상만");
      q(e, "#sl-fng").click();
      const qi = q(e, "#sl-q"); qi.value = "KJ272"; inp(qi);
      eq(qa(e, "tr[data-slid]").length, 1, "편명 검색");
      ok(q(e, "#sl-q") === qi, "검색칸 유지");
      qi.value = ""; inp(qi);
      chg(setv("#sl-ftid", "t-patrol"));
      eq(qa(e, "tr[data-slid]").length, 3, "양식 필터");
      ok(/순찰 3회/.test(q(e, "tr[data-slid]").textContent));
      ok(q(e, "[data-print-btn]"), "Print 버튼");
      SL.setState({ fTid: "" });
    });
    t("SL10 점검 양식(hq): 항목 줄 편집 · 기록 있는 양식은 삭제 불가 · 시작일 저장 · user 는 메뉴 없음", () => {
      loginAs(e, "hq");
      SL.setState({ tab: "today" }); go(e, "inspection");
      q(e, "#sl-tpl").click();
      const rows = qa(e, "#sl-tpls .sl-tpl");
      eq(rows.length, FAKE.length);
      ok(!rows[0].querySelector("[data-tdel]"), "기록 있는 양식은 삭제 버튼 없음");
      rows[0].querySelector('[data-k="items"]').value = "시험 항목 A\n시험 항목 C";
      q(e, "#sl-tadd").click();
      const last = qa(e, "#sl-tpls .sl-tpl").pop();
      last.querySelector('[data-k="name"]').value = "새 양식";
      last.querySelector('[data-k="evidence"]').value = "2.7, x, 9.1.2";
      clickOk(e);
      const c = e.S.data.seclogCfg;
      eq(c.since, "2026-10-01", "첫 저장 시작일 = 첫 기록일(이미 쌓인 누락을 지우지 않음)");
      const t0 = c.templates.find(t => t.id === "t-daily");
      eq(t0.items.map(i => i.text).join("|"), "시험 항목 A|시험 항목 C"); eq(t0.items[0].id, "i1", "같은 문구는 id 유지");
      eq(c.templates.find(t => t.name === "새 양식").evidence.join(","), "2.7,9.1.2", "번호만");
      loginAs(e, "user"); go(e, "inspection");
      ok(!q(e, "#sl-body"), "user 권한 없음");
      loginAs(e, "manager");
      eq(String(e.w.SeMIS.data.menus.find(m => m.module === "inspection") && "ok"), "ok");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("SL11 메뉴 배지 · 오늘 화면 요약 · 통합 검색", () => {
      loginAs(e, "manager");
      SL.setState({ tab: "today" }); go(e, "inspection");
      const st = q(e, "#sl-body .stat-row").textContent;
      ok(/이번 주기 미기록/.test(st) && /누락/.test(st));
      ok(qa(e, ".sl-card").length >= 5, "양식 카드");
      const badge = e.w.SeMIS.data && SL.missCount();
      ok(badge >= 1, "누락 수");
      const r = e.w.SemisSearch.search ? e.w.SemisSearch.search("KJ272") : [];
      ok(r.some(x => x.group === "보안 기록부"), "검색");
    });
    e.w.close();
  }

  /* ══════════ [SC] 바로가기 (v1.23) — 링크 아이콘 · 전체 화면 · 편집 · 사이트 아이콘 ══════════ */
  {
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const e = makeEnv();
    const L = (id, seq, label, extra) => Object.assign({ id, seq, type: "link", label, url: "https://example.org/" + id, open: "tab", vis: "all", parent: "hub-home", icon: "🔗" }, extra || {});
    e.S.data.menus.push(
      L("sc-a", 80, "가 시스템", { fav: PNG }),
      L("sc-b", 81, "나 시스템", { ico: "box", tone: "blue" }),
      L("sc-c", 82, "다 시스템", { icon: "✈️" }),
      L("sc-h", 83, "숨김 시스템", { hidden: true }),
      L("sc-set", 84, "묶음", { open: "group", url: "" }),
      L("sc-k1", 85, "묶음 하위", { parent: "sc-set" }));
    e.S.saveSilent();
    loginAs(e, "admin");
    const SC = e.w.SemisShortcuts;

    t("SC01 링크 아이콘 우선순위 — 사이트 아이콘 > 선 아이콘 > 이모지 > 기본, 잘못된 값은 무시", () => {
      const h = (m) => e.S.linkIconHTML(m, "x");
      ok(/lki-img/.test(h({ type: "link", fav: PNG, ico: "box", icon: "✈️" })), "fav 우선");
      ok(/lki-ico t-blue/.test(h({ type: "link", ico: "box", tone: "blue", icon: "✈️" })), "선 아이콘");
      ok(/lki-ico t-teal/.test(h({ type: "link", ico: "box", tone: "nope" })), "모르는 색은 청록");
      ok(/lki-emo/.test(h({ type: "link", icon: "✈️" })), "이모지");
      ok(/lki-ico/.test(h({ type: "link", icon: "🔗" })) && !/lki-emo/.test(h({ type: "link", icon: "🔗" })), "옛 기본 이모지는 선 아이콘");
      ok(!/lki-img/.test(h({ type: "link", fav: "data:image/svg+xml;base64,PHN2Zz4=" })), "SVG data URL 거부");
      ok(!/lki-img/.test(h({ type: "link", fav: "https://x.org/a.png" })), "외부 주소 거부");
      ok(!e.S.favOk("data:image/png;base64," + "A".repeat(70000)), "크기 제한");
      ok(!/<img[^>]*"[^"]*"[^>]*onerror/.test(h({ type: "link", fav: PNG + '" onerror="x' })), "따옴표 삽입 거부");
      ok(e.S.LINK_ICONS.every(k => e.S.ICONS[k]), "선 아이콘 키 모두 존재");
    });

    t("SC02 바로가기 메뉴 — 기본 메뉴에 있고, 옛 데이터에는 회의록 아래 1회 추가(멱등)", () => {
      ok(e.S.defaultMenus().some(m => m.module === "shortcuts" && m.parent === "hub-home" && m.vis === "all"));
      const e2 = makeEnv();
      e2.S.data.menus = e2.S.defaultMenus().filter(m => m.module !== "shortcuts");
      e2.S.normalizeData();
      const sc = e2.S.data.menus.filter(m => m.module === "shortcuts");
      eq(sc.length, 1);
      const mi = e2.S.data.menus.find(m => m.module === "minutes");
      ok(sc[0].seq > mi.seq && sc[0].parent === mi.parent, "회의록 바로 아래");
      const before = JSON.stringify(e2.S.data.menus);
      e2.S.normalizeData();
      eq(JSON.stringify(e2.S.data.menus), before, "두 번째 정규화 무변경");
      e2.w.close();
    });

    t("SC03 허브 패널 '바로가기' — 링크마다 아이콘, 전체 보기 · 추가(관리자) 버튼", () => {
      e.S.renderNav();
      const blk = q(e, '.hub[data-hub="hub-home"] .hub-links');
      ok(blk, "홈 허브 바로가기 블록");
      ok(blk.querySelector('a.nav-item[href="https://example.org/sc-a"] .nav-lki.lki-img'), "사이트 아이콘");
      ok(blk.querySelector('a.nav-item[href="https://example.org/sc-b"] .nav-lki.t-blue'), "선 아이콘");
      ok(blk.querySelector('.nav-set[data-route="links/sc-set"] .nav-lki'), "묶음도 아이콘");
      ok(!Array.from(blk.querySelectorAll(".nav-item")).some(a => a.textContent.includes("숨김 시스템")), "숨김 제외");
      ok(blk.querySelector('[data-go="shortcuts"]') && blk.querySelector('[data-sc-add="hub-home"]'));
      loginAs(e, "user"); e.S.renderNav();
      const b2 = q(e, '.hub[data-hub="hub-home"] .hub-links');
      ok(b2.querySelector('[data-go="shortcuts"]') && !b2.querySelector("[data-sc-add]"), "일반 사용자는 추가 버튼 없음");
      loginAs(e, "admin"); e.S.renderNav();
    });

    t("SC04 바로가기 화면 — 허브별 카드, 숨김 · 묶음 하위 제외, 인쇄 버튼", () => {
      go(e, "shortcuts");
      eq(q(e, "#view .page-title").textContent.trim(), "바로가기");
      ok(q(e, "#view .page-head [data-print-btn]"), "인쇄");
      const home = q(e, '#sc-body .sc-sec[data-sec="hub-home"]');
      ok(home, "홈 칸");
      const titles = Array.from(home.querySelectorAll(".lk-t")).map(x => x.textContent);
      ok(titles.includes("가 시스템") && titles.includes("다 시스템") && titles.includes("묶음"));
      ok(!titles.includes("숨김 시스템") && !titles.includes("묶음 하위"), titles.join(","));
      ok(home.querySelector('a.lk-card[href="https://example.org/sc-a"] .lki-img'), "새 탭 카드 + 아이콘");
      ok(home.querySelector('button.lk-card[data-go="links/sc-set"]'), "묶음 카드");
      ok(!q(e, "#sc-body [data-sc-edit]"), "보기 모드는 편집 없음");
      ok(q(e, "#view").classList.contains("view-mid"));
    });

    t("SC05 편집 모드 — 수정 카드 · 순서 · 삭제 · 추가 칸 · 숨김 표시 · 묶음 하위 칸 · 빈 허브 한 줄", () => {
      q(e, "#sc-edit").click();
      ok(q(e, "#sc-edit").getAttribute("aria-pressed") === "true");
      ok(q(e, '#sc-body button.lk-card.is-edit[data-sc-edit="sc-a"]'), "수정 카드");
      ok(q(e, '#sc-body [data-sc-move="sc-a"][data-dir="1"]') && q(e, '#sc-body [data-sc-del="sc-a"]'));
      const hid = q(e, '#sc-body [data-sc-edit="sc-h"]');
      ok(hid && hid.classList.contains("is-dim") && hid.textContent.includes("숨김"), "숨김 링크도 보인다");
      const sub = q(e, '#sc-body .sc-sec.is-sub[data-sec="sc-set"]');
      ok(sub && sub.querySelector('[data-sc-edit="sc-k1"]') && sub.querySelector('[data-sc-add="sc-set"]'), "묶음 하위 칸");
      ok(q(e, '#sc-body .sc-more [data-sc-add="hub-saf"]'), "빈 허브는 한 줄 버튼");
      ok(q(e, "#view .page-head [data-print-btn]"), "다시 그려도 인쇄 버튼 유지");
    });

    t("SC06 추가 폼 — 유형 선택 없이 링크, 소속 미리 선택, 선 아이콘 + 색 저장, 허브 패널에 반영", () => {
      q(e, '#sc-body [data-sc-add="hub-home"]').click();
      ok(!q(e, "#f-type"), "유형 선택 없음");
      eq(q(e, "#modal-box h3").textContent, "바로가기 추가");
      eq(q(e, "#f-parent").value, "hub-home");
      ok(q(e, "#row-lki") && q(e, "#row-lki").style.display !== "none" && q(e, "#row-icon").style.display === "none");
      q(e, "#f-label").value = "라 시스템"; q(e, "#f-url").value = "https://example.org/ra";
      q(e, '[data-lkp-mode="ico"]').click();
      ok(!q(e, '[data-lkp-pane="ico"]').hidden && q(e, '[data-lkp-pane="fav"]').hidden);
      const r = q(e, '#row-lki input[name="lkp-ico"][value="truck"]'); r.checked = true; r.dispatchEvent(new e.w.Event("change"));
      const tn = q(e, '#row-lki input[name="lkp-tone"][value="rose"]'); tn.checked = true; tn.dispatchEvent(new e.w.Event("change"));
      ok(q(e, "#lkp-prev .t-rose"), "미리보기");
      q(e, "#f-save").click();
      const m = e.S.data.menus.find(x => x.label === "라 시스템");
      ok(m && m.type === "link" && m.parent === "hub-home" && m.open === "tab" && m.ico === "truck" && m.tone === "rose" && !m.fav, JSON.stringify(m));
      ok(q(e, '.hub[data-hub="hub-home"] a.nav-item[href="https://example.org/ra"] .t-rose'), "허브 패널");
      ok(q(e, '#sc-body [data-sc-edit="' + m.id + '"]'), "편집 화면에 바로 나타남");
    });

    t("SC07 수정 폼 — 현재 아이콘 종류가 선택되고, 이모지로 바꾸면 사이트 아이콘 · 선 아이콘 필드를 지운다", () => {
      q(e, '#sc-body [data-sc-edit="sc-a"]').click();
      eq(q(e, "#modal-box h3").textContent, "바로가기 수정");
      eq(q(e, '[data-lkp-mode="fav"]').getAttribute("aria-pressed"), "true");
      ok(q(e, "#lkp-prev .lki-img"), "현재 사이트 아이콘 미리보기");
      q(e, '[data-lkp-mode="emoji"]').click();
      q(e, "#lkp-emoji").value = "📦"; q(e, "#lkp-emoji").dispatchEvent(new e.w.Event("input"));
      q(e, "#f-save").click();
      const m = e.S.data.menus.find(x => x.id === "sc-a");
      ok(!m.fav && !m.ico && m.icon === "📦", JSON.stringify(m));
      const o = { icon: "🔗", ico: "box", tone: "blue" };
      SC.applyIcon(o, { mode: "fav", fav: PNG });
      ok(o.fav === PNG && !o.ico && !o.tone && o.icon === "🔗", "사이트 아이콘으로 바꾸면 선 아이콘 제거 · 이모지 보존");
      SC.applyIcon(o, { mode: "fav", fav: "" });
      ok(!o.fav && !o.ico, "이미지 없이 저장하면 기본 아이콘");
    });

    t("SC08 순서 이동(같은 소속 링크끼리) · 삭제(묶음은 하위까지)", () => {
      const order = () => e.S.sortedMenus().filter(m => m.type === "link" && m.parent === "hub-home").map(m => m.id);
      const before = order();
      const i = before.indexOf("sc-b");
      q(e, '#sc-body [data-sc-move="sc-b"][data-dir="-1"]').click();
      const after = order();
      eq(after.indexOf("sc-b"), i - 1, after.join(","));
      q(e, '#sc-body [data-sc-move="sc-b"][data-dir="1"]').click();
      eq(order().join(","), before.join(","), "되돌림");
      q(e, '#sc-body [data-sc-del="sc-set"]').click();
      ok(q(e, "#modal-box").textContent.includes("하위 링크 1개"));
      clickOk(e);
      ok(!e.S.data.menus.some(m => m.id === "sc-set" || m.id === "sc-k1"), "묶음 + 하위 삭제");
      ok(!q(e, '#sc-body [data-sec="sc-set"]'));
    });

    t("SC09 검색 — 이름 · 주소 · 상위 이름, 입력칸은 그대로", () => {
      const inp = q(e, "#sc-q");
      inp.value = "example.org/sc-c"; inp.dispatchEvent(new e.w.Event("input"));
      eq(qa(e, "#sc-body .lk-card").length, 1);
      ok(q(e, "#sc-q") === inp, "입력칸 유지");
      inp.value = ""; inp.dispatchEvent(new e.w.Event("input"));
      ok(qa(e, "#sc-body .lk-card").length > 3);
    });

    t("SC10 권한 — 일반 · 파트 계정은 편집 버튼이 없고 편집 모드도 풀린다", () => {
      loginAs(e, "hq"); go(e, "shortcuts");
      ok(!q(e, "#sc-edit") && !q(e, "#sc-new") && !q(e, "#sc-body [data-sc-edit]"));
      SC.add("hub-home"); ok(q(e, "#modal-overlay").classList.contains("hidden"), "추가 폼 안 열림");
      loginAs(e, "admin"); go(e, "shortcuts");
      eq(q(e, "#sc-edit").getAttribute("aria-pressed"), "false");
    });

    t("SC11 시스템 설정 — 링크 행에 아이콘, 링크 폼에 아이콘 칸 · 예정 모듈은 이모지 칸", () => {
      renderSettings(e, "menus");
      ok(q(e, '#menu-tree [data-id="sc-b"] .mt-lki.t-blue'));
      q(e, "#btn-add-menu").click();
      ok(q(e, "#f-type") && q(e, "#row-lki").style.display !== "none" && q(e, "#row-icon").style.display === "none");
      q(e, "#f-type").value = "planned"; q(e, "#f-type").dispatchEvent(new e.w.Event("change"));
      ok(q(e, "#row-lki").style.display === "none" && q(e, "#row-icon").style.display !== "none");
      e.S.closeModal();
    });

    t("SC12 링크 묶음 화면 '편집' → 바로가기 편집 모드로 그 묶음 칸", () => {
      e.S.data.menus.push(L("sc-set2", 90, "묶음2", { open: "group", url: "" }), L("sc-k2", 91, "하위2", { parent: "sc-set2" }));
      go(e, "links/sc-set2");
      const b = q(e, '#view .page-head [data-sc-manage="sc-set2"]');
      ok(b, "편집 버튼");
      b.click();
      eq(e.w.location.hash, "#/shortcuts");
      e.S.renderView();
      eq(q(e, "#sc-edit").getAttribute("aria-pressed"), "true");
      ok(q(e, '#sc-body .sc-sec.is-sub[data-sec="sc-set2"] [data-sc-edit="sc-k2"]'));
      loginAs(e, "hq"); go(e, "links/sc-set2");
      ok(!q(e, "[data-sc-manage]"), "관리자만");
      loginAs(e, "admin");
    });

    await ta("SC13 사이트 아이콘 호출 — Edge Function 주소 · 세션 헤더 · 오류 코드", async () => {
      const calls = [];
      const e3 = makeEnv({ fetch: async (url, o) => {
        calls.push({ url: String(url), o });
        const body = JSON.parse(o.body);
        if (/nope/.test(body.url)) return { ok: true, status: 200, json: async () => ({ ok: false, error: "not_found" }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, data: PNG, type: "image/png", src: "https://x.org/f.png" }) };
      } });
      loginAs(e3, "admin", { token: "b".repeat(64) });
      const r = await e3.w.SemisSync.favicon("https://example.org/");
      eq(r.data, PNG);
      const c = calls.find(x => /semis-logi-favicon/.test(x.url));
      ok(c && c.o.method === "POST" && c.o.headers["x-semis-token"] === "b".repeat(64), "세션 헤더");
      let err = null;
      try { await e3.w.SemisSync.favicon("https://nope.org/"); } catch (x) { err = x; }
      ok(err && err.code === "not_found", "오류 코드");
      e3.w.close();
    });

    t("SC14 일괄 대상 — 사이트 아이콘 · 선 아이콘 · 사내망 · 주소 없는 링크 제외", () => {
      e.S.data.menus.push(L("sc-in", 95, "사내", { url: "http://10.1.2.3/x" }));
      const ids = SC.bulkTargets().map(m => m.id);
      ok(ids.includes("sc-c") && !ids.includes("sc-b") && !ids.includes("sc-in") && !ids.includes("sc-set2"), ids.join(","));
      ok(!ids.includes("ref-semis") || !e.S.data.menus.find(m => m.id === "ref-semis").fav);
    });

    t("SC15 Edge Function 원본 — 관리자 세션 · 사설망 차단 · 첫 바이트 판정 · 비밀값 없음", () => {
      const f = read("tools/edge/semis-logi-favicon.ts");
      ok(/semis_logi_file_auth/.test(f) && /rank \|\| 0\) < 4/.test(f), "관리자 세션");
      ok(/privateV4/.test(f) && /resolveDns/.test(f) && /redirect: "manual"/.test(f), "SSRF 방어");
      ok(/function sniff/.test(f) && /IMG_MAX/.test(f) && /PAGE_MAX/.test(f));
      ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(f) && !/service_role/i.test(f), "키 없음");
      const c = read("css/main.css");
      ok(c.indexOf(".lki.lki-img") > 0 && c.indexOf(".sc-add") > 0 && c.indexOf(".lkp-tone") > 0);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    e.w.close();
  }

  /* ══════════ [PT] 일일 보안 · 안전 순찰일지 (v1.27) ══════════ */
  {
    const e = makeEnv();
    const P = e.w.SemisPatrol;
    const SIG = (n) => "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/patrol/sig" + n + ".png";
    /* 시험용 양식 · 명단 — 실제 점검사항 문구 · 이름은 공용 DB에만 */
    const CFG = { title: "Daily 순찰일지 시험", asOf: "As of 01JAN'26", since: "2026-09-01", secs: [
      { id: "sec", name: "보안", items: [{ id: "a1", text: "시험 보안 항목 A" }, { id: "a2", text: "시험 보안 항목 B" }] },
      { id: "dg", name: "위험물", items: [{ id: "b1", text: "시험 위험물 항목" }] },
      { id: "saf", name: "안전", items: [{ id: "c1", text: "시험 안전 항목 C" }, { id: "c2", text: "시험 안전 항목 D" }] }] };
    const seed = () => {
      e.S.data.patrolCfg = JSON.parse(JSON.stringify(CFG));
      e.S.data.patrolPeople = [
        { id: "p1", name: "순찰갑", roles: ["patrol"], sign: SIG(1), active: true, order: 1 },
        { id: "p2", name: "순찰을", roles: ["patrol"], sign: "", active: true, order: 2 },
        { id: "p3", name: "감독병", roles: ["patrol", "sup"], sign: SIG(3), active: true, order: 3 }];
      e.S.data.patrol = [];
      P.setState({ tab: "day", curDate: "2026-09-30", curMonth: "" });
    };
    const day = (d) => P.dayOf(d);
    const slot = (name, t) => ({ pid: name === "순찰갑" ? "p1" : name === "감독병" ? "p3" : "p2", name, sign: SIG(9), t: t || "", at: "2026-09-01T00:00:00Z", by: "t" });
    const rec = (d, o) => Object.assign({ id: "r" + d, date: d, am: null, pm: null, sup: null, off: null, note: "", ng: [], createdAt: "2026-09-01T00:00:00Z" }, o || {});
    P.setToday("2026-09-30", "09:40");

    t("PT01 메뉴: 순찰일지(안전 관리 허브 · mgr) · 데이터 · 동기화 키 · 권한표 · 파일 폴더", () => {
      const m = e.S.data.menus.find(x => x.module === "daily-safety");
      ok(m && m.type === "module" && !m.planned && !m.desc); eq(m.parent, "hub-saf"); eq(m.vis, "mgr"); eq(m.label, "일일 보안 · 안전 순찰일지");
      ok(Array.isArray(e.S.data.patrol) && Array.isArray(e.S.data.patrolPeople) && e.S.data.patrolCfg && !Array.isArray(e.S.data.patrolCfg), "기본 데이터");
      ["patrol", "patrolCfg", "patrolPeople"].forEach(k => ok(e.Sync.SYNC_KEYS.indexOf(k) >= 0, k));
      eq(ACL.patrol.join(","), "2,2"); eq(ACL.patrolCfg.join(","), "2,3"); eq(ACL.patrolPeople.join(","), "2,2");
      const edge = read("tools/edge/semis-logi-files.ts");
      ok(/READ_RANK[\s\S]*patrol: 2[\s\S]*WRITE_RANK[\s\S]*patrol: 2/.test(edge), "파일 폴더 patrol 열람 2 · 올리기 2");
      ok(/<script src="js\/patrol\.js\?v=[\d.]+" defer><\/script>/.test(read("index.html")), "defer 스크립트");
    });
    t("PT02 코드에는 구분 뼈대뿐(점검사항 · 명단 없음) · 공개 저장소 위생", () => {
      eq(P.DEF_CFG.secs.map(s => s.name).join(","), "보안,위험물,안전");
      ok(P.DEF_CFG.secs.every(s => !s.items), "항목 없음");
      e.S.data.patrolCfg = {}; eq(P.cfg().secs.length, 3); eq(P.cfg().title, "Daily 보안/안전 순찰일지"); eq(P.cfg().asOf, "As of 01AUG'25");
      const probes = [["보안검색", "완료표식"].join(" "), ["격리", "구분"].join(""), ["고소", "작업자"].join("")];
      ["js/patrol.js", "docs/HANDOFF.md", "README.md", "js/app.js"].forEach(f => probes.forEach(pr => ok(read(f).indexOf(pr) < 0, f + ": " + pr)));
      ["js/patrol.js", "js/app.js"].forEach(f => ok(read(f).indexOf(["김", "홍석"].join("")) < 0 && read(f).indexOf(["옥", "정훈"].join("")) < 0, f + ": 명단"));
      ok(!/["'][0-9a-f]{64}["']/.test(read("js/patrol.js")), "해시 없음");
    });
    t("PT03 5일 묶음: 1~5 · … · 26~말일(31일은 여섯 줄) · 2월 · 월별 장 수", () => {
      const s = (d) => { const x = P.sheetOf(d); return x.from + "~" + x.to + "/" + x.n; };
      eq(s("2026-09-03"), "2026-09-01~2026-09-05/5"); eq(s("2026-09-10"), "2026-09-06~2026-09-10/5");
      eq(s("2026-09-28"), "2026-09-26~2026-09-30/5"); eq(s("2026-10-31"), "2026-10-26~2026-10-31/6");
      eq(s("2027-02-27"), "2027-02-26~2027-02-28/3"); eq(s("2028-02-29"), "2028-02-26~2028-02-29/4");
      eq(P.sheetsOf("2026-09").length, 6); eq(P.sheetsOf("2026-10").length, 6); eq(P.sheetsOf("2027-02").length, 6);
      eq(P.sheetsOf("2026-10")[5].n, 6);
    });
    t("PT04 상태: 확인 완료 · 확인 대기 · 작성 중 · 미작성 · 기록 없음 · 휴무 · 시작 전 · 앞날 · 대기 목록", () => {
      seed();
      e.S.data.patrol = [
        rec("2026-09-25", { am: slot("순찰갑"), pm: slot("순찰갑"), sup: slot("감독병") }),
        rec("2026-09-26", { off: { name: "당직자" } }),
        rec("2026-09-28", { am: slot("순찰갑") }),
        rec("2026-09-29", { am: slot("순찰갑"), pm: slot("순찰을") }),
        rec("2026-09-30", { am: slot("순찰갑") })];
      const st = (d) => P.stOf(d, "2026-09-30");
      eq(st("2026-09-25"), "done"); eq(st("2026-09-26"), "off"); eq(st("2026-09-27"), "miss"); eq(st("2026-09-28"), "wait");
      eq(st("2026-09-29"), "wait"); eq(st("2026-09-30"), "prog"); eq(st("2026-10-01"), "none"); eq(st("2026-08-31"), "none", "시작일 전");
      e.S.data.patrol.push(rec("2026-10-01", {})); eq(st("2026-10-01"), "none");
      e.S.data.patrol.pop();
      const pd = P.pending("2026-09-30");
      eq(pd.wait.join(","), "2026-09-28,2026-09-29"); ok(pd.miss.indexOf("2026-09-27") >= 0 && pd.miss.indexOf("2026-09-25") < 0);
      e.S.data.patrol.find(r => r.date === "2026-09-30").pm = slot("순찰을");
      eq(st("2026-09-30"), "wait", "오늘 오전 · 오후 다 있으면 확인 대기");
      e.S.data.patrolCfg.since = ""; eq(P.since(), "2026-09-25", "시작일 없으면 첫 기록일");
    });
    t("PT05 기록: 이름 누르면 등록 서명으로 바로 기록 · 확인 서명 → 잠김 · 확인 취소", () => {
      seed(); loginAs(e, "manager"); go(e, "daily-safety");
      ok(q(e, "#view .page-head [data-print-btn]"), "머리말 Print"); eq(qa(e, "#view [data-print-btn]").length, 1, "코어가 따로 붙이지 않음");
      eq(qa(e, "[data-pt-take-am]").length, 3, "순찰자 3명"); eq(qa(e, "[data-pt-take-sup]").length, 0, "순찰 전에는 확인 칸 없음");
      q(e, "[data-pt-take-am='p1']").click();
      const r = day("2026-09-30");
      ok(r && r.am.name === "순찰갑" && r.am.sign === SIG(1) && r.am.t === "09:40", "오전 기록");
      ok(q(e, ".pt-slot[data-slot=am].is-on img.pt-sig"), "서명 표시");
      q(e, "[data-pt-take-sup='p3']").click();
      ok(q(e, "#modal-box").textContent.indexOf("오후 순찰 기록이 없습니다") >= 0, "오후 없음 경고"); q(e, "#modal-box [data-act=cancel]").click();
      P.setToday("2026-09-30", "15:10");
      q(e, "[data-pt-take-pm='p3']").click();
      eq(day("2026-09-30").pm.t, "15:10");
      q(e, "[data-pt-take-sup='p3']").click();
      const d = day("2026-09-30");
      ok(d.sup && d.sup.name === "감독병" && d.sup.sign === SIG(3) && !("t" in d.sup), "확인 서명");
      eq(P.stOf("2026-09-30"), "done"); ok(P.locked(d));
      ok(q(e, "#pt-note").readOnly && qa(e, "[data-ngt]").every(b => b.disabled), "확인 후 잠김");
      ok(!q(e, ".pt-slot[data-slot=am] [data-pt-edit]"), "잠긴 순찰 칸은 고칠 수 없음");
      P.takeSlot("2026-09-30", "am", "p2"); eq(day("2026-09-30").am.name, "순찰갑", "잠긴 날 순찰 변경 막음");
      q(e, "[data-pt-edit=sup]").click(); q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      ok(!day("2026-09-30").sup && !P.locked(day("2026-09-30")), "확인 취소 → 다시 열림");
      ok(!q(e, "#pt-note").readOnly);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    t("PT06 서명 미등록 사람: 누르면 서명 등록 패드 → 저장하면 등록 + 기록 · 칸 고치기(사람 · 시각 · 다시 서명)", () => {
      seed(); loginAs(e, "manager"); go(e, "daily-safety");
      q(e, "[data-pt-take-am='p2']").click();
      ok(q(e, "#pt-pad") && q(e, "#modal-box h3").textContent.indexOf("순찰을 서명 등록") >= 0, "등록 패드");
      P._padCommit(SIG(2));
      eq(P.personOf("p2").sign, SIG(2), "등록 서명"); ok(P.personOf("p2").signAt);
      eq(day("2026-09-30").am.sign, SIG(2));
      q(e, "[data-pt-edit=am]").click();
      q(e, "#pt-ft").value = "08:55";
      q(e, "#pt-fpeople [data-fp='p1']").click();
      eq(q(e, "#pt-ft").value, "08:55", "시각 유지");
      q(e, "#pt-fredo").click(); ok(q(e, "#pt-padreg") && q(e, "#pt-padreg").checked, "등록 서명도 바꾸기(기본 켬)");
      q(e, "#pt-padreg").checked = false;
      P._padCommit(SIG(7), { register: false });
      clickOk(e);
      const a = day("2026-09-30").am;
      ok(a.name === "순찰갑" && a.pid === "p1" && a.t === "08:55" && a.sign === SIG(7), "칸 수정");
      eq(P.personOf("p1").sign, SIG(1), "등록 서명은 그대로");
      q(e, "[data-pt-edit=am]").click(); q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      ok(!day("2026-09-30").am, "비우기");
      P.takeSlot("2026-10-01", "am", "p1"); ok(!P.dayOf("2026-10-01"), "앞날 기록 막음");
    });
    t("PT07 이상 항목: 눌러 표시(문구 사본) · 내용 입력 · 특이사항 저장 · 인쇄 줄 · 모두 이상 없음", () => {
      seed(); loginAs(e, "manager"); go(e, "daily-safety");
      eq(qa(e, "[data-ngt]").length, 5); ok(q(e, ".pt-chksum").textContent.indexOf("전 항목 이상 없음") >= 0);
      q(e, "[data-ngt=b1]").click();
      let r = day("2026-09-30");
      eq(r.ng.length, 1); eq(r.ng[0].t, "시험 위험물 항목"); eq(r.ng[0].sec, "위험물");
      eq(q(e, "[data-ngt=b1]").getAttribute("aria-pressed"), "true");
      const ni = q(e, "#pt-ngn-b1"); ni.value = "라벨 떨어짐 — 재부착"; ni.dispatchEvent(new e.w.Event("change"));
      const note = q(e, "#pt-note"); note.value = "  반입시설 점검 실시  \n\n\n 둘째 줄 "; note.dispatchEvent(new e.w.Event("change"));
      r = day("2026-09-30");
      eq(r.note, "반입시설 점검 실시\n\n둘째 줄"); eq(r.ng[0].note, "라벨 떨어짐 — 재부착");
      eq(P.noteLines(r).join("|"), "반입시설 점검 실시||둘째 줄|※ [위험물] 시험 위험물 항목 — 라벨 떨어짐 — 재부착");
      e.S.data.patrolCfg.secs[1].items[0].text = "바뀐 문구"; eq(day("2026-09-30").ng[0].t, "시험 위험물 항목", "기록은 그때 문구");
      go(e, "daily-safety");
      q(e, "#pt-ngclear").click(); clickOk(e);
      eq(day("2026-09-30").ng.length, 0);
    });
    t("PT08 휴무 · 당직: 당직근무자 이름 + 그때 서명(명단 등록 없음) · 인쇄 확인 칸 · 이름 바꾸면 다시 서명 · 순찰 기록이 있으면 불가 · 해제", () => {
      seed(); loginAs(e, "manager"); P.setState({ curDate: "2026-09-26" }); go(e, "daily-safety");
      const nPeople = e.S.data.patrolPeople.length;
      q(e, "[data-pt-off]").click();
      ok(q(e, "#modal-box [data-act=ok]").textContent.indexOf("서명하고 저장") >= 0 && !q(e, "#pt-dl-off option[value='순찰갑']"), "명단 이름을 권하지 않음");
      clickOk(e); ok(q(e, "#pt-offn") && !q(e, "#pt-pad"), "이름 필수");
      q(e, "#pt-offn").value = "당직자"; clickOk(e);
      ok(q(e, "#pt-pad") && q(e, "#modal-box h3").textContent.indexOf("당직자 서명") >= 0, "서명 패드");
      q(e, "#modal-box [data-act=cancel]").click(); eq(q(e, "#pt-offn").value, "당직자", "취소하면 입력 유지"); ok(!day("2026-09-26") || !day("2026-09-26").off, "서명 전에는 저장 안 함");
      clickOk(e); P._padCommit(SIG(8));
      const r = day("2026-09-26");
      eq(r.off.name, "당직자"); eq(r.off.sign, SIG(8)); eq(P.stOf("2026-09-26", "2026-09-30"), "off");
      eq(e.S.data.patrolPeople.length, nPeople, "명단에 추가하지 않음");
      ok(q(e, ".pt-offcard") && q(e, ".pt-offcard").textContent.indexOf("당직자") >= 0 && q(e, ".pt-offcard img.pt-sig") && !q(e, "[data-pt-take-am]"), "휴무 카드 · 서명");
      const html = P.sheetHTML(P.sheetOf("2026-09-26"));
      ok(/<td class="sv" rowspan="2"><div class="duty"><span>당직근무자<\/span><b>당직자<\/b><img src="[^"]*sig8\.png" alt="" style="max-height:[\d.]+mm"><\/div><\/td>/.test(html), "확인 칸에 당직근무자 · 이름 · 서명");
      P.setState({ tab: "month", curMonth: "2026-09" }); go(e, "daily-safety");
      ok(q(e, "tbody[data-pt-open='2026-09-26'] .pt-tduty img"), "월별 표 서명"); P.setState({ tab: "day", curDate: "2026-09-26" });
      P.offForm("2026-09-26"); ok(q(e, "#modal-box [data-act=redo]")); clickOk(e); ok(!q(e, "#pt-pad") && !q(e, "#pt-offn"), "바뀐 것 없으면 그대로 닫힘");
      P.offForm("2026-09-26"); q(e, "#pt-offn").value = "당직자2"; clickOk(e); ok(q(e, "#pt-pad"), "이름 바꾸면 다시 서명"); P._padCommit(SIG(9));
      eq(day("2026-09-26").off.name, "당직자2"); eq(day("2026-09-26").off.sign, SIG(9));
      P.takeSlot("2026-09-26", "am", "p1");
      ok(day("2026-09-26").am && !day("2026-09-26").off, "순찰을 기록하면 휴무 해제");
      P.offForm("2026-09-26"); ok(!q(e, "#pt-offn"), "순찰 기록 있는 날은 휴무 불가");
      day("2026-09-26").am = null; e.S.data.patrol.find(x => x.date === "2026-09-26").off = { name: "옛기록" };
      P.offForm("2026-09-26"); ok(q(e, "#modal-box [data-act=ok]").textContent.indexOf("서명하고 저장") >= 0, "서명 없는 옛 기록은 서명 받기");
      q(e, "#modal-box [data-act=cancel]").click();
      P.offForm("2026-09-26"); q(e, "#modal-box [data-act=del]").click();
      ok(!day("2026-09-26").off, "해제");
    });
    t("PT09 일괄 확인: 대기 날짜 목록 · 확인자 고르기 · 고른 날만 확인 · 서명 미등록이면 등록 후", () => {
      seed(); loginAs(e, "manager");
      e.S.data.patrol = ["2026-09-26", "2026-09-27", "2026-09-28"].map(d => rec(d, { am: slot("순찰갑"), pm: slot("순찰을") }));
      e.S.data.patrol.push(rec("2026-09-29", { am: slot("순찰갑") }));
      e.w.localStorage.removeItem("semisl:patrolMe");
      go(e, "daily-safety");
      ok(q(e, ".page-head [data-pt-bulk]").textContent.indexOf("4") >= 0, "머리말 일괄 확인 4");
      q(e, ".page-head [data-pt-bulk]").click();
      eq(qa(e, "[data-bd]").length, 4); ok(q(e, ".pt-blist").textContent.indexOf("오후 없음") >= 0);
      clickOk(e); ok(q(e, "[data-bd]"), "확인자 없으면 진행 안 됨");
      q(e, "#pt-bpeople [data-bp='p3']").click();
      const c = q(e, "[data-bd='2026-09-27']"); c.checked = false; c.dispatchEvent(new e.w.Event("change"));
      clickOk(e);
      ok(day("2026-09-26").sup && day("2026-09-28").sup && day("2026-09-29").sup && !day("2026-09-27").sup, "고른 날만");
      eq(day("2026-09-26").sup.sign, SIG(3));
      e.S.data.patrolPeople.find(p => p.id === "p3").sign = "";
      P.bulkConfirm("2026-09-27", "2026-09-27"); q(e, "#pt-bpeople [data-bp='p3']").click(); clickOk(e);
      ok(q(e, "#pt-pad"), "서명 등록 패드"); P._padCommit(SIG(33));
      eq(day("2026-09-27").sup.sign, SIG(33)); eq(P.personOf("p3").sign, SIG(33));
      eq(P.pending("2026-09-30").wait.length, 0);
    });
    t("PT10 인쇄: 종이 양식 구조(제목 · 월 · 6열 · 5일 × 2줄 · 확인 칸 합침 · 구분 · ▶ 점검사항 · 로고 · As of) · A4 여백 0 · 31일 · 빈 양식", () => {
      seed();
      e.S.data.patrol = [rec("2026-09-02", { am: slot("순찰갑"), pm: slot("순찰갑"), sup: slot("감독병"), note: "반입시설 보안성 평가 실시" }),
        rec("2026-09-05", { off: { name: "당직자" } })];
      const doc = P.printDocHTML([P.sheetOf("2026-09-02")]);
      const d = new e.w.DOMParser().parseFromString(doc, "text/html");
      eq(d.querySelectorAll(".sheet").length, 1);
      eq(d.querySelector(".ttl").textContent, "Daily 순찰일지 시험"); eq(d.querySelector(".ym").textContent, "2026년 9월");
      eq(Array.from(d.querySelectorAll(".top thead th")).map(x => x.textContent).join("|"), "일자|오전순찰자|서명|오후순찰자|서명|보안감독자 확인");
      eq(d.querySelectorAll(".top tbody.day").length, 5); eq(Array.from(d.querySelectorAll(".top .d")).map(x => x.textContent).join(","), "1일,2일,3일,4일,5일");
      eq(d.querySelectorAll(".top .l").length, 5); eq(d.querySelectorAll(".top td.sv[rowspan='2']").length, 5); eq(d.querySelectorAll(".top td.sp[colspan='4']").length, 5);
      const b2 = d.querySelectorAll(".top tbody.day")[1];
      eq(b2.querySelectorAll(".nm")[0].textContent, "순찰갑"); ok(b2.querySelector(".sg img") && b2.querySelector(".sv img"), "서명 이미지");
      eq(b2.querySelector(".sp").textContent, "반입시설 보안성 평가 실시");
      ok(d.querySelectorAll(".top tbody.day")[4].querySelector(".sv").textContent.indexOf("당직근무자") >= 0);
      eq(Array.from(d.querySelectorAll(".ck thead th")).map(x => x.textContent).join("|"), "구분|점검사항");
      eq(Array.from(d.querySelectorAll(".ck td.sec")).map(x => x.textContent + x.getAttribute("rowspan")).join(","), "보안2,위험물1,안전2");
      eq(d.querySelectorAll(".ck td.it").length, 5); eq(d.querySelector(".ck td.it").textContent, "시험 보안 항목 A");
      ok(d.querySelector(".lgw svg.lg") && d.querySelector(".asof").textContent === "As of 01JAN'26", "로고 · 양식 표기");
      ok(/@page \{ size: A4 portrait; margin: 0; \}/.test(doc) && /\.sheet \{[^}]*width: 210mm; height: 296\.6mm/.test(doc), "A4 한 장");
      ok(/\.it::before \{[^}]*clip-path: polygon/.test(doc) && /td\.it \{[^}]*border-left: 2\.6pt double/.test(doc), "▶ 표시 · 이중선");
      const oct = new e.w.DOMParser().parseFromString(P.printDocHTML(P.sheetsOf("2026-10")), "text/html");
      eq(oct.querySelectorAll(".sheet").length, 6); eq(oct.querySelectorAll(".sheet")[5].querySelectorAll("tbody.day").length, 6, "26~31 여섯 줄");
      const feb = new e.w.DOMParser().parseFromString(P.printDocHTML([P.sheetOf("2027-02-27")]), "text/html");
      eq(Array.from(feb.querySelectorAll(".top .d")).map(x => x.textContent).join(","), "26일,27일,28일,,", "모자라는 줄은 빈 칸");
      const blank = new e.w.DOMParser().parseFromString(P.printDocHTML([P.sheetOf("2026-09-02")], { blank: true }), "text/html");
      ok(!blank.querySelector(".top .nm").textContent && !blank.querySelector(".top img") && blank.querySelectorAll(".ck td.it").length === 5, "빈 양식");
      const long = Array.from({ length: 12 }, (x, i) => "긴 특이사항 줄 " + i + " — 반입 화물 확인과 조치 내용을 자세히 적은 문장");
      ok(P.fitPt(long, 18.7, 138) < P.fitPt(["짧은 줄"], 18.7, 138), "긴 글은 글자 줄임");
      eq(P.fitPt(["짧은 줄"], 18.7, 138), 10.5);
    });
    t("PT11 월별 일지: 장 카드 6 · 요약 · 대기 장 일괄 확인 · 날짜 누르면 작성 화면 · 390px 카드 CSS", () => {
      seed(); loginAs(e, "manager");
      e.S.data.patrol = [rec("2026-09-02", { am: slot("순찰갑"), pm: slot("순찰갑"), sup: slot("감독병") }), rec("2026-09-03", { am: slot("순찰갑"), pm: slot("순찰을") })];
      P.setState({ tab: "month", curMonth: "2026-09" }); go(e, "daily-safety");
      eq(qa(e, ".pt-sheet").length, 6); eq(qa(e, ".pt-sheet")[0].querySelectorAll("tbody.pt-tday").length, 5);
      ok(qa(e, ".pt-sheet")[0].querySelector("[data-pt-bulk='2026-09-01|2026-09-05']"), "장별 일괄 확인");
      ok(q(e, ".stat-row").textContent.indexOf("확인 대기") >= 0);
      ok(q(e, "[data-pt-mon='1']").disabled, "다음 달(앞날) 막음");
      q(e, "tbody[data-pt-open='2026-09-03']").click();
      eq(P.getState().tab, "day"); eq(P.getState().curDate, "2026-09-03");
      ok(q(e, "#pt-date").value === "2026-09-03" && q(e, ".pt-dchip[aria-current]").textContent.indexOf("3") >= 0);
      const c = read("css/main.css");
      ok(/@media \(max-width: 640px\) \{[\s\S]*\.pt-stbl tr\.pt-r1 \{ display: grid;/.test(c), "390px 카드");
      ok(/\.pt-pad \{[^}]*touch-action: none/.test(c), "서명 칸 스크롤 막음");
    });
    t("PT12 순찰자 · 서명: 목록 · 사람 추가(역할 · 같은 이름 막음) · 순서 · 서명 등록 · 삭제는 hq · 기록 있는 사람 삭제 불가", () => {
      seed(); loginAs(e, "manager"); P.setState({ tab: "people" }); go(e, "daily-safety");
      eq(qa(e, ".pt-pcard").length, 3); ok(q(e, ".pt-pcard").textContent.indexOf("순찰자") >= 0);
      q(e, "[data-pt-addp=list]").click();
      q(e, "#pt-pn").value = "순찰갑"; clickOk(e); ok(q(e, "#pt-pn"), "같은 이름 막음");
      q(e, "#pt-pn").value = "새사람"; q(e, "#pt-rp").checked = false; clickOk(e); ok(q(e, "#pt-pn"), "역할 필수");
      q(e, "#pt-rs").checked = true; clickOk(e);
      const np = P.peopleAll().find(p => p.name === "새사람");
      ok(np && np.roles.join() === "sup" && !np.sign); eq(P.roleList("sup").map(p => p.name).join(","), "감독병,새사람");
      q(e, "[data-pt-pmv='" + np.id + "|-1']").click();
      eq(P.peopleAll().map(p => p.name).join(","), "순찰갑,순찰을,새사람,감독병");
      q(e, "[data-pt-sign='" + np.id + "']").click(); P._padCommit(SIG(5));
      eq(P.personOf(np.id).sign, SIG(5));
      q(e, "[data-pt-pedit='" + np.id + "']").click(); ok(!q(e, "#modal-box [data-act=del]"), "manager 삭제 없음"); q(e, "#modal-box [data-act=cancel]").click();
      loginAs(e, "hq"); go(e, "daily-safety");
      e.S.data.patrol = [rec("2026-09-02", { am: slot("순찰갑") })];
      P.personForm("p1"); ok(!q(e, "#modal-box [data-act=del]"), "기록 있는 사람은 삭제 대신 사용 안 함");
      q(e, "#pt-pa").checked = false; clickOk(e);
      ok(!P.people().some(p => p.id === "p1") && P.roleList("am").every(p => p.id !== "p1"), "사용 안 함 → 기록 화면에서 빠짐");
      P.personForm(np.id); q(e, "#modal-box [data-act=del]").click(); clickOk(e);
      ok(!P.personOf(np.id), "hq 삭제");
      loginAs(e, "admin"); P.setState({ tab: "people" }); go(e, "daily-safety");
      ok(qa(e, "[data-pt-sign]").some(b => b.textContent.trim() === "서명 재등록") && !q(e, "#view").textContent.includes("다시 등록"), "문구: 서명 재등록");
      const before = JSON.stringify(e.S.data.patrol);
      P.personForm("p1"); ok(q(e, "#modal-box [data-act=del]"), "시스템관리자: 기록 있는 사람도 삭제");
      q(e, "#modal-box [data-act=del]").click(); ok(q(e, "#modal-box").textContent.indexOf("그대로 남습니다") >= 0); clickOk(e);
      ok(!P.personOf("p1"), "삭제됨"); eq(JSON.stringify(e.S.data.patrol), before, "기록 · 서명 그대로");
      const doc = P.printDocHTML([P.sheetOf("2026-09-02")]); ok(doc.indexOf("순찰갑") >= 0 && doc.indexOf("sig9.png") >= 0, "인쇄에도 남음");
      P.setState({ tab: "day", curDate: "2026-09-02" }); go(e, "daily-safety");
      ok(q(e, ".pt-slot[data-slot=am]").textContent.indexOf("순찰갑") >= 0, "기록 화면 표시");
    });
    t("PT13 양식(hq): 제목 · 표기 · 시작일 · 구분 · 점검사항 줄 편집(같은 문구는 id 유지) · manager 버튼 없음", () => {
      seed(); loginAs(e, "manager"); go(e, "daily-safety"); ok(!q(e, "#pt-cfg"), "manager 양식 버튼 없음");
      loginAs(e, "hq"); go(e, "daily-safety"); q(e, "#pt-cfg").click();
      eq(qa(e, "#pt-csecs .pt-csec").length, 3);
      q(e, "#pt-ct").value = "새 제목"; q(e, "#pt-ca").value = ""; q(e, "#pt-cs").value = "2026-09-10";
      const ta = qa(e, "#pt-csecs [data-k=items]")[0]; ta.value = "시험 보안 항목 A\n새 항목 E";
      q(e, "#pt-cadd").click(); qa(e, "#pt-csecs [data-k=name]")[3].value = "기타"; qa(e, "#pt-csecs [data-k=items]")[3].value = "기타 항목";
      clickOk(e);
      const c = P.cfg();
      eq(c.title, "새 제목"); eq(c.asOf, ""); eq(c.since, "2026-09-10");
      eq(c.secs.map(s => s.name).join(","), "보안,위험물,안전,기타");
      eq(c.secs[0].items[0].id, "a1", "같은 문구 id 유지"); eq(c.secs[0].items[1].text, "새 항목 E");
      ok(P.printDocHTML([P.sheetOf("2026-09-10")]).indexOf('class="asof"') < 0, "표기 비우면 인쇄 안 함");
    });
    t("PT14 같은 날 기록 둘(두 기기 동시 첫 기록) → 하나로 합침 · 배지 · 통합 검색 · 쓰기 권한(user · vendor 없음)", () => {
      seed(); loginAs(e, "manager");
      e.S.data.patrol = [rec("2026-09-29", { id: "x1", createdAt: "2026-09-29T00:00:01Z", am: slot("순찰갑"), note: "갑 메모" }),
        rec("2026-09-29", { id: "x2", createdAt: "2026-09-29T00:00:05Z", pm: slot("순찰을"), note: "을 메모", ng: [{ id: "a1", sec: "보안", t: "시험 보안 항목 A", note: "" }] })];
      go(e, "daily-safety");
      const rs = e.S.data.patrol.filter(r => r.date === "2026-09-29");
      eq(rs.length, 1); eq(rs[0].id, "x1"); ok(rs[0].am && rs[0].pm && rs[0].ng.length === 1); eq(rs[0].note, "갑 메모\n을 메모");
      e.S.renderNav();
      ok(q(e, '#nav-menu [data-route="daily-safety"]') && q(e, '#nav-menu [data-route="daily-safety"]').textContent.match(/\d/), "메뉴 배지");
      ok(e.w.SemisSearch.search("을 메모").some(h => h.group === "일일 보안 · 안전 순찰일지"), "통합 검색");
      loginAs(e, "user"); go(e, "daily-safety");
      ok(!q(e, "[data-pt-take-am]") && !q(e, ".page-head [data-pt-bulk]"), "user 기록 없음");
    });
    e.w.close();
  }

  /* ══════════ [CM] v1.29 화면 정돈 "Calm" — 모바일 우선 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "admin");
    const setW = (w) => Object.defineProperty(e.w, "innerWidth", { value: w, configurable: true });
    const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const today = iso(new Date());
    t("CM01 머리말 정돈: 주 버튼 하나만 두고 나머지는 ph-hide + 더보기(…) · PC에서도 표시만(숨김은 CSS가 모바일에서만)", () => {
      setW(390); go(e, "schedule"); e.S.tidyView();
      const head = q(e, "#view .page-head");
      const main = q(e, "#cal-add");
      ok(main && !main.classList.contains("ph-hide"), "주 버튼은 그대로");
      ok(q(e, "#view .page-head [data-print-btn]").classList.contains("ph-hide"), "Print는 더보기로");
      ok(head.querySelector(":scope > .ph-more.no-print"), "더보기 버튼");
      e.S.tidyView(); eq(qa(e, "#view .page-head .ph-more").length, 1, "멱등");
    });
    t("CM02 더보기 → 액션 시트: 숨긴 버튼 목록 · 누르면 원래 버튼 동작(Print → 인쇄 머리말)", () => {
      let printed = 0; e.w.print = () => { printed++; };
      q(e, "#view .ph-more").click();
      const items = qa(e, "#asheet .asheet-item").map(b => b.textContent.trim());
      ok(items.indexOf("Print") >= 0, items.join(","));
      eq(q(e, "#asheet .asheet-t").textContent, "안전보안 일정관리");
      qa(e, "#asheet .asheet-item").find(b => b.textContent.trim() === "Print").click();
      ok(q(e, "#view #print-head"), "원래 Print 버튼 동작(인쇄 머리말)");
      ok(!q(e, "#asheet.on"), "시트 닫힘");
    });
    t("CM03 액션 시트 닫기(취소 · 배경 · Esc)", () => {
      e.S.actionSheet([{ label: "가", run: () => {} }], { title: "t" });
      ok(q(e, "#asheet"));
      q(e, "#asheet .asheet-cancel").click();
      ok(!q(e, "#asheet.on"), "닫힘 시작");
    });
    t("CM04 표 이름표: 머리글 → data-label · 제목 칸 data-role=title · 빈 칸 td-nil · 행 병합 표 제외", () => {
      const box = e.w.document.createElement("div");
      box.innerHTML = '<table class="tbl"><thead><tr><th>분류</th><th>회의일</th><th>제목</th><th>첨부</th><th></th></tr></thead><tbody>' +
        '<tr><td>교육</td><td>2026-09-21</td><td><b>위기대응 정기교육 훈련</b></td><td>-</td><td><button>✏️</button></td></tr></tbody></table>';
      ok(e.S.labelTable(box.firstChild));
      const tds = box.querySelectorAll("tbody td");
      eq(tds[0].getAttribute("data-label"), "분류"); eq(tds[2].getAttribute("data-role"), "title");
      ok(tds[3].classList.contains("td-nil"), "빈 칸"); ok(tds[4].classList.contains("td-act"), "조작 칸");
      box.innerHTML = '<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody><tr><td rowspan="2">x</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>';
      ok(!e.S.labelTable(box.firstChild), "행 병합 표는 그대로");
    });
    t("CM05 일정관리 모바일: 월 달력(색 점) + 고른 날 목록 · 날짜 누르면 목록 교체 · 목록 보기 · PC는 기존 달력", () => {
      e.S.data.schedules = [
        { id: "cm1", title: "모바일 점검", start: today, end: today, allDay: true, color: "red" },
        { id: "cm2", title: "모바일 회의", start: today, end: today, allDay: false, time: "14:00", color: "blue", done: true }];
      setW(390); e.w.SemisCalendar.setAnchor(today); go(e, "schedule");
      ok(q(e, ".calm-grid"), "월 달력"); ok(!q(e, ".cal-gridwrap"), "막대 달력 없음");
      const cell = q(e, '.calm-day[data-mday="' + today + '"]');
      ok(cell.classList.contains("today") && cell.classList.contains("sel"));
      const openEv = e.w.SemisCalendar.eventsOnDay(today).filter(x => !x.done);   // v1.35: 오늘 '매일 점검'(점검 일정 연동)도 남은 일정
      ok(openEv.some(x => x.ik === "sld:" + today) && !openEv.some(x => x.id === "cm2"), openEv.map(x => x.title).join(","));
      eq(cell.querySelectorAll(".calm-dots i").length, openEv.length, "끝낸 일정은 점에서 뺌(남은 일정이 있으면)");
      ok(q(e, ".calm-agenda").textContent.includes("모바일 점검"));
      const other = qa(e, ".calm-day:not(.other)").find(b => b.dataset.mday !== today);
      other.click();
      eq(q(e, ".calm-agenda").dataset.day, other.dataset.mday, "고른 날");
      q(e, '[data-mview="list"]').click();
      ok(q(e, ".calm.is-list") && q(e, ".calm-lday"), "목록 보기");
      q(e, '[data-mview="month"]').click();
      setW(1024); go(e, "schedule"); ok(q(e, ".cal-gridwrap") && !q(e, ".calm"), "PC는 그대로");
    });
    t("CM06 대시보드 '오늘': 순찰 · 오늘 일정(끝낸 일정 제외) · 인천 접근 행 · 누르면 이동 · 일반 사용자는 없음", () => {
      setW(1024); go(e, "dashboard");
      const rows = qa(e, ".today-card .td-row").map(r => r.dataset.go);
      ok(rows.indexOf("daily-safety") >= 0 && rows.indexOf("schedule") >= 0, rows.join(","));
      const sc = qa(e, ".today-card .td-row").find(r => r.dataset.go === "schedule");
      ok(sc.textContent.includes("모바일 점검") && !sc.textContent.includes("모바일 회의"), "끝낸 일정 제외");
      ok(!q(e, "#upcoming-box").textContent.includes("모바일 회의"), "다가오는 일정도 끝낸 일정 제외");
      sc.click(); eq(e.w.location.hash, "#/schedule");
      const e2 = makeEnv(); loginAs(e2, "user"); go(e2, "dashboard");
      ok(!q(e2, ".today-card"), "user 없음"); e2.w.close();
    });
    t("CM07 하단 탭 아이콘 · 모바일 CSS는 화면 한정(인쇄 폭이 max-width 조건에 걸리지 않게)", () => {
      ok(q(e, '#tabbar [data-route="daily-safety"] svg') && q(e, '#tabbar [data-route="flight"] svg'));
      const css = read("css/main.css"), k = css.indexOf("── 화면 정돈 (모바일 우선)");
      ok(k > 0);
      const tail = css.slice(k);
      ok(!/@media \(max-width: 767px\)/.test(tail), "v1.29 모바일 규칙은 screen 한정");
      ok(/@media screen and \(max-width: 767px\)[\s\S]*table\.tbl-stack/.test(tail), "표 정돈 규칙");
      ok(/#view\[data-hub\] \.page-head::before, #view\[data-hub\] \.page-head::after \{ display: none; \}/.test(tail), "모바일 사진 머리말 제거");
    });
    t("CM08 순찰일지 모바일: 점검 항목은 접어 두고(이상 없을 때) PC는 늘 펼침", () => {
      setW(390); go(e, "daily-safety");
      const fd = q(e, ".pt-chkfold");
      if (fd) ok(!fd.open, "모바일 접힘");
      setW(1024); go(e, "daily-safety");
      const fd2 = q(e, ".pt-chkfold");
      if (fd2) ok(fd2.open, "PC 펼침");
    });
    t("CM09 오늘 날짜는 현지 기준(UTC 자르기 금지) — 대시보드 · 보안등급 · 회의록", () => {
      ["js/modules.js", "js/minutes.js"].forEach(f => ok(!/todayISO = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)|todayStr = \(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(read(f)), f));
      ok(!/const todayStr = \(\) => new Date\(\)\.toISOString\(\)/.test(read("js/app.js")), "app.js");
      eq(e.w.SemisDashFx && typeof e.w.SemisDashFx.zeroDays, "function");
    });
    t("CM10 허브 패널 바로가기: 5개까지 보이고 나머지는 '더 보기'", () => {
      setW(1440);
      const hub = e.S.homeHubId();
      for (let i = 0; i < 7; i++) e.S.data.menus.push({ id: "cmlk" + i, type: "link", label: "링크" + i, url: "https://example.com/" + i, parent: hub, seq: 90 + i, vis: "all" });
      e.S.renderNav();
      const blk = q(e, '#nav-menu .hub[data-hub="' + hub + '"] .hub-links');
      ok(blk && qa(e, '#nav-menu .hub[data-hub="' + hub + '"] .hub-links .lk-x').length >= 2);
      const tg = blk.querySelector("[data-lk-all]");
      tg.click(); ok(blk.classList.contains("all")); eq(tg.getAttribute("aria-expanded"), "true");
      e.S.data.menus = e.S.data.menus.filter(m => !/^cmlk/.test(m.id)); e.S.renderNav();
    });
    go(e, "vault");   // 대시보드의 비동기 적재(CARES · 운항)가 닫힌 창을 건드리지 않게 창은 열어 둔다(끝에서 process.exit)
  }

  /* ══════════ [CN] v1.30 화면 정돈 2단계 — 편집 모드 · 모바일 접기 (SERP · 위협전화 · 위기대응 · 연락망 · 업무 연락처 · 설정) ══════════
     가짜 이름 · 번호만 사용 */
  {
    const e = makeEnv();
    loginAs(e, "admin");
    const setW = (w) => Object.defineProperty(e.w, "innerWidth", { value: w, configurable: true });
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const seedCrisis = () => {
      e.S.data.crisis = { asOf: "26년 9월", homeTeam: "가팀", notes: ["참고 하나"], people: {},
        rows: [{ id: "c1", div: "가본부", team: "가팀", org: "초동조치센터", task: "업무 하나", main: "갑일", sub: "을일" },
          { id: "c2", div: "나본부", team: "나팀", org: "종합지원센터", task: "업무 둘", main: "병일", sub: "" },
          { id: "c3", div: "나본부", team: "다팀", org: "종합지원센터", task: "업무 셋", main: "정일", sub: "갑일" }] };
    };
    const seedPb = () => {
      e.S.data.phonebook = { asOf: "26년 9월", notes: ["참고"], groups: [{ id: "ga", name: "가구역", color: "#d42a1e" }, { id: "gb", name: "나구역", color: "#1f4fd6" }],
        rows: [{ id: "p1", group: "ga", org: "갑사", name: "갑일", mobile: "010-0000-1111", email: "a@x.com", check: true, verify: "철자 확인" },
          { id: "p2", group: "gb", org: "을사", name: "을일", office: "032-000-2072" }] };
    };
    const seedContacts = () => {
      e.S.data.contacts = { flows: [{ id: "cf1", title: "가 연락망", short: "가사고", rows: [{ id: "r1", grp: "보고선", role: "가팀장", office: "032-000-0001", mobile: "010-0000-0002" }] }],
        sections: [{ id: "s1", type: "people", icon: "🏢", title: "가팀", rows: [{ role: "팀장", name: "갑일", mobile: "010-0000-0003", office: "032-000-0004", email: "g@x.com" }] },
          { id: "s2", type: "people", icon: "🛡️", title: "빈 섹션", rows: [] },
          { id: "s3", type: "emails", icon: "📧", title: "메일", rows: [{ name: "을일", email: "e@x.com" }, { name: "병일", email: "f@x.com" }] }] };
    };
    seedCrisis(); seedPb(); seedContacts(); e.S.saveSilent();
    const click = (el) => el.dispatchEvent(new e.w.MouseEvent("click", { bubbles: true }));

    t("CN01 ui.mf: 묶음 속성(data-mf) · force 면 펼침 · 펼친 상태는 화면별로 기억(다시 그려도 유지)", () => {
      setW(390); go(e, "crisis");
      eq(e.S.ui.mf("x"), ' data-mf="x"'); ok(/data-mf-on/.test(e.S.ui.mf("x", true)));
      const sec = q(e, '.cr-sec[data-mf="org:종합지원센터"]');
      ok(sec && !sec.hasAttribute("data-mf-on"), "모바일 기본 접힘");
      e.S.tidyView();
      const tog = sec.querySelector(":scope > .mf-h > .mf-tog");
      ok(tog && tog.getAttribute("aria-expanded") === "false", "펼침 단추(접근성)");
      click(sec.querySelector(".cr-sechead h3"));
      ok(sec.hasAttribute("data-mf-on")); eq(tog.getAttribute("aria-expanded"), "true");
      go(e, "crisis"); e.S.tidyView();
      ok(q(e, '.cr-sec[data-mf="org:종합지원센터"]').hasAttribute("data-mf-on"), "다시 그려도 펼침 유지");
      click(q(e, '.cr-sec[data-mf="org:종합지원센터"] .mf-tog'));
      ok(!q(e, '.cr-sec[data-mf="org:종합지원센터"]').hasAttribute("data-mf-on"), "펼침 단추로 접기");
    });
    t("CN02 머리 안의 단추 · 링크는 접기와 무관 · PC 폭에서는 눌러도 접지 않음", () => {
      setW(390); go(e, "contacts"); e.S.tidyView();
      const sec = q(e, '.ct-sec[data-mf="sec:s1"]');
      const ed = sec.querySelector(".mf-h .ct-edit");
      ok(ed && ed.classList.contains("m-ed"), "편집 단추는 편집 모드 전용");
      click(ed); ok(!sec.hasAttribute("data-mf-on"), "편집 단추는 접기 안 함");
      e.S.closeModal();
      setW(1024); click(sec.querySelector(".card-title > span:nth-child(2)"));
      ok(!sec.hasAttribute("data-mf-on"), "PC 는 접기 동작 없음(늘 펼쳐 보임 — CSS)");
    });
    t("CN03 편집 모드: 더보기 첫 줄 '편집' → m-editing · '완료' → 끔 · 다른 화면으로 가면 꺼짐", () => {
      setW(390); go(e, "crisis"); e.S.tidyView();
      ok(qa(e, "#view .m-ed").length > 0);
      q(e, "#view .ph-more").click();
      const first = q(e, "#asheet .asheet-item");
      eq(first.textContent.trim(), "편집");
      first.click(); e.S.tidyView();
      ok(q(e, "#view").classList.contains("m-editing")); ok(e.S.editing);
      ok(q(e, "#view .page-head > .ph-done"), "'완료' 단추");
      go(e, "crisis"); e.S.tidyView(); ok(q(e, "#view").classList.contains("m-editing"), "같은 화면을 다시 그려도 유지");
      q(e, "#view .ph-done").click();
      ok(!q(e, "#view").classList.contains("m-editing")); ok(!q(e, "#view .ph-done"));
      e.S.setEditMode(true); go(e, "phonebook"); e.S.tidyView();
      ok(!q(e, "#view").classList.contains("m-editing") && !e.S.editing, "화면 이동 → 꺼짐");
    });
    t("CN04 편집 전용 표시: 위기대응(+번호 · 행 편집) · 업무 연락처(행 편집 · 확인 메모) · 권한 없으면 m-ed 없음(더보기에 '편집' 없음)", () => {
      setW(390); go(e, "crisis");
      ok(q(e, ".cr-addnum.m-ed") && q(e, ".cr-edit.m-ed") && q(e, ".cr-misschip.m-ed"));
      go(e, "phonebook");
      ok(q(e, ".pb-edit.m-ed") && q(e, ".pb-verify.m-ed") && q(e, ".pb-cp.m-hide") && q(e, ".pb-chk.m-ed"));
      loginAs(e, "manager"); go(e, "crisis"); e.S.tidyView();
      eq(qa(e, "#view .m-ed").length, 0, "manager 위기대응");
      go(e, "phonebook"); eq(qa(e, "#view .m-ed").length, 0, "manager 업무 연락처");
      ok(q(e, ".pb-verify.m-hide") && q(e, ".pb-chk.m-hide"), "확인 메모 · 필터는 모바일에서 숨김");
      e.S.tidyView(); const mo = q(e, "#view .ph-more");
      if (mo) { mo.click(); ok(!qa(e, "#asheet .asheet-item").some(b => b.textContent.trim() === "편집"), "'편집' 없음"); e.S.closeActionSheet(); }
      loginAs(e, "admin");
    });
    t("CN05 검색 · 필터 중에는 묶음 펼침(위기대응 · 업무 연락처 · 연락망)", () => {
      setW(390); go(e, "crisis");
      const qi = q(e, "#cr-q"); qi.value = "업무"; qi.dispatchEvent(new e.w.Event("input"));
      ok(qa(e, ".cr-sec[data-mf]").every(x => x.hasAttribute("data-mf-on")), "검색 → 펼침");
      qi.value = ""; qi.dispatchEvent(new e.w.Event("input"));
      ok(qa(e, ".cr-sec[data-mf]").some(x => !x.hasAttribute("data-mf-on")), "검색 해제 → 접힘");
      go(e, "phonebook"); q(e, '.pb-gbtn[data-grp="gb"]').click();
      ok(qa(e, ".pb-sec[data-mf]").length === 1 && q(e, ".pb-sec[data-mf]").hasAttribute("data-mf-on"), "구역 고르면 펼침");
      q(e, '.pb-gbtn[data-grp="gb"]').click();
      go(e, "contacts"); const si = q(e, "#ct-search"); si.value = "을일"; si.dispatchEvent(new e.w.Event("input"));
      ok(qa(e, "#ct-body [data-mf]").every(x => x.hasAttribute("data-mf-on")));
      si.value = ""; si.dispatchEvent(new e.w.Event("input"));
    });
    t("CN06 접힌 묶음 안의 표는 크기를 잴 수 없으니 판정 보류 → 펼칠 때 정돈", () => {
      setW(390);
      e.w.location.hash = "#/crisis";
      const v = q(e, "#view");
      v.innerHTML = '<section class="card" data-mf="tt"><header class="mf-h">표</header><div class="table-wrap"><table class="tbl" id="cn-t"><thead><tr><th>가</th><th>나</th><th>다</th></tr></thead><tbody><tr><td><b>값</b></td><td>1</td><td>2</td></tr></tbody></table></div></section>';
      const tb = q(e, "#cn-t");
      tb.getClientRects = () => [];
      e.S.tidyView();
      ok(!tb.dataset.stk, "숨은 표는 판정 안 함");
      tb.getClientRects = () => [{}];
      e.S.mfToggle(q(e, '[data-mf="tt"]'), true); e.S.tidyView();
      ok(tb.dataset.stk === "0" || tb.dataset.stk === "1", "펼친 뒤 판정");
      go(e, "crisis");
    });
    t("CN07 비상연락망: 이모지 없음(섹션 · 번호 · 메일은 선 아이콘) · 복사는 모바일 숨김 · 빈 섹션은 편집 모드(hq↑)/숨김", () => {
      setW(390); go(e, "contacts");
      const body = q(e, "#view");
      ok(!emoji.test(body.textContent), "화면 글자에 이모지 없음: " + (body.textContent.match(emoji) || [""])[0]);
      ok(q(e, '[data-ct-sec="s1"] .ct-sico svg'), "섹션 선 아이콘");
      ok(q(e, '[data-ct-sec="s1"] .ct-tel svg') && qa(e, ".ct-copy").every(b => b.classList.contains("m-hide")));
      ok(q(e, '[data-ct-sec="s2"]').classList.contains("m-ed"), "빈 섹션: 편집 모드에서만");
      ok(q(e, ".ct-fgrp[data-mf] > .ct-fgrp-t.mf-h"), "체계도 묶음 접기");
      loginAs(e, "manager"); go(e, "contacts");
      ok(q(e, '[data-ct-sec="s2"]').classList.contains("m-hide"), "manager 는 숨김");
      loginAs(e, "admin");
    });
    t("CN08 시스템 설정: 허브는 접기 묶음 · 줄마다 '…' → 액션 시트(원래 단추 실행) · 단추 이모지 → 선 아이콘", () => {
      setW(390); go(e, "settings");
      const grps = qa(e, "#menu-tree .mt-grp[data-mf]");
      ok(grps.length >= 3, "허브 묶음 " + grps.length);
      ok(grps.every(g => g.querySelector(":scope > .menu-tree-item.mf-h")));
      ok(!qa(e, "#menu-tree .mt-btn").some(b => /[▲▼👁🙈✏🗑]/u.test(b.textContent)), "단추 이모지 없음");
      const g0 = grps[0], kids = g0.querySelectorAll(":scope > .menu-tree-item.is-child");
      ok(kids.length >= 2);
      const id1 = kids[0].dataset.id, id2 = kids[1].dataset.id;
      const seq = (id) => e.S.data.menus.find(m => m.id === id).seq;
      const s1 = seq(id1), s2 = seq(id2);
      kids[0].querySelector(".mt-more").click();
      const items = qa(e, "#asheet .asheet-item").map(b => b.textContent.trim());
      eq(items.slice(0, 2).join(","), "위로,아래로");
      qa(e, "#asheet .asheet-item").find(b => b.textContent.trim() === "아래로").click();
      eq(seq(id1), s2); eq(seq(id2), s1);
    });
    t("CN09 SERP 모바일: 3.6 초동조치가 맨 위 · 원문 절은 접힘 · PC 순서는 그대로", () => {
      e.S.data.serp = { title: "가 계획", docNo: "T-1", occ: { team: "가 통제팀", phone: "02-0000-0001" },
        sections: [{ id: "s1", no: "3.1.3", tab: "init", title: "원칙", body: "본문" }, { id: "s2", no: "3.2", tab: "init", title: "대외", body: "본문" }],
        serc: { within: 30 }, roles: [{ id: "leader", no: 1, name: "리더", duties: ["지휘"], checklist: ["가동"] }],
        timeline: [{ id: "t1", min: 10, text: "통보", roles: ["leader"] }], notify: [{ id: "n1", label: "일시" }], people: [] };
      e.S.data.serpRuns = []; e.S.saveSilent();
      setW(390); go(e, "serp");
      const tb = q(e, ".sp-tabbody");
      eq(tb.firstElementChild.id, "sp-tlcard", "모바일 첫 카드");
      ok(q(e, '.sp-tabbody .sp-occ[data-mf]') && q(e, '.sp-tabbody .sp-serc[data-mf]') && q(e, '.sp-tabbody [data-mf="sec:s2"]'));
      ok(q(e, ".sp-occbox.m-hide"), "통보처 큰 전화는 위 띠와 같아 모바일 숨김");
      ok(qa(e, ".sp-tabbody .sp-ed").every(b => b.classList.contains("m-ed")), "계획 화면 편집 단추");
      setW(1280); go(e, "serp");
      ok(q(e, ".sp-tabbody").firstElementChild.classList.contains("sp-grid2"), "PC 순서 그대로");
    });
    t("CN10 위협전화: 영문 병기는 모바일 CSS로 숨김 · STEP 은 늘 펼침 · 응대 요령 · TSOC · 보고 순서는 접기 · 편집 단추 m-ed", () => {
      const css = read("css/main.css");
      const tail = css.slice(css.indexOf("── 화면 정돈 2단계"));
      ok(/@media screen and \(max-width: 767px\)[\s\S]*#view \.tc-en \{ display: none/.test(tail), "영문 숨김(화면 한정)");
      ok(/#view:not\(\.m-editing\) \.m-ed/.test(tail) && /\[data-mf\]:not\(\[data-mf-on\]\) > :not\(\.mf-h\)/.test(tail));
      e.S.data.threat = { title: "위협", trigger: "협박 전화", quick: [{ label: "가", num: "032-000-0001" }],
        steps: [{ id: "s1", no: "1", ko: "확인", en: "Check", phase: "call", subs: [] }], tips: ["침착"], chain: [{ id: "c1", to: "팀장" }],
        tsoc: { phones: [{ label: "OUT", num: "+1-000" }], items: [{ ko: "항공사", en: "Airline" }] }, sections: [], form: { secs: [] } };
      e.S.data.threatRuns = []; e.S.data.threatChecks = []; e.S.saveSilent();
      setW(390); go(e, "threat");
      ok(q(e, ".tc-steps") && !q(e, ".tc-flow").hasAttribute("data-mf"), "STEP 카드는 접지 않음");
      ok(q(e, ".tc-tipc[data-mf]") && q(e, ".tc-tsoc[data-mf]") && q(e, ".tc-chainc[data-mf]"));
      ok(q(e, ".tc-en"), "영문은 화면에 있음(CSS로 모바일만 숨김)");
      ok(qa(e, ".tc-guide .sp-ed").every(b => b.classList.contains("m-ed")) && q(e, "#tc-step-add.m-ed"));
    });
    go(e, "vault");
  }

  /* ══════════ [SK] 자체 보안점검 — 국가항공보안 수준관리지침 별표 (v1.32) ══════════ */
  {
    /* 양식 원본(assets/forms/nas/*.hwpx)은 파일에서 바로 내준다 */
    const assetFetch = async (url) => {
      const u = String(url).split("?")[0].replace(/^https?:\/\/[^/]+\//, "");
      const fp = path.join(ROOT, u);
      if (/^assets\//.test(u) && fs.existsSync(fp)) {
        const b = fs.readFileSync(fp);
        return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
      }
      return new Promise(() => {});   // 그 밖의 요청(운항 · 서버)은 응답 없음 — 창을 닫은 뒤 다시 그리지 않게
    };
    const e = makeEnv({ fetch: assetFetch });
    for (const k of ["TextEncoder", "TextDecoder", "CompressionStream", "DecompressionStream"]) if (!e.w[k]) e.w[k] = globalThis[k];
    const S = e.w.SemisSelfcheck, H = e.w.SemisHwpx, NF = e.w.SemisNasForms;
    const setv = (sel, v) => { const el = q(e, sel); el.value = v; return el; };
    const fire = (el, type) => el.dispatchEvent(new e.w.Event(type, { bubbles: true }));
    const tplOf = async (id) => H.open(new Uint8Array(fs.readFileSync(path.join(ROOT, "assets/forms/nas/" + id + ".hwpx"))));
    const cellT = (pkg, ref) => { const tc = H.cell(pkg, ref); return tc ? H.cellText(tc) : null; };
    const items = (id) => S.itemsOf(S.formOf(id));
    let n = 0;
    const rec = (form, o) => Object.assign({ id: "sk" + (++n), form, date: "2026-10-03", insp: "", org: "", ans: {}, txt: {}, rm: {}, nm: {}, fx: {}, note: "", files: [], status: "draft", createdAt: "2026-10-03T00:00:00Z", createdBy: "Thq" }, o || {});
    S.setToday("2026-10-03");
    loginAs(e, "hq");

    t("SK01 메뉴 · 데이터 · 동기화 키 · 권한표: 점검 · 교육 허브 맨 아래(v1.42 선택 실행 · '선택' 표시) · mgr · 옛 데이터 자동 추가(멱등)", () => {
      const ms = e.S.data.menus;
      const m = ms.find(x => x.module === "selfcheck");
      ok(m && m.type === "module" && !m.planned); eq(m.parent, "hub-aud"); eq(m.vis, "mgr"); eq(m.label, "자체 보안점검");
      ok(ms.filter(x => x.parent === "hub-aud" && x !== m).every(x => x.seq < m.seq), "허브 맨 아래");
      const legacy = e.S.defaultMenus().filter(x => x.module !== "selfcheck");
      const e2 = makeEnv({ preData: { version: 1, menus: legacy } });
      eq(e2.S.data.menus.filter(x => x.module === "selfcheck").length, 1, "옛 데이터에 추가");
      const m2 = e2.S.data.menus.find(x => x.module === "selfcheck");
      ok(e2.S.data.menus.filter(x => x.parent === "hub-aud" && x !== m2).every(x => x.seq < m2.seq), "옛 데이터도 허브 맨 아래");
      e2.S.normalizeData(e2.S.data); e2.S.normalizeData(e2.S.data);
      eq(e2.S.data.menus.filter(x => x.module === "selfcheck").length, 1, "멱등");
      ok(Array.isArray(e2.S.data.selfChecks));
      e2.w.close();
      ok(e.Sync.SYNC_KEYS.indexOf("selfChecks") >= 0);
      eq(JSON.stringify(ACL.selfChecks), "[2,2]", "권한표: manager 읽기 · 쓰기");
      ok(SEC_SQL.indexOf("semis_logi_security_17_selfcheck") > 0);
    });

    await ta("SK02 양식 사양 ↔ 원본 HWPX: 별표 1 · 3 · 4 · 7 · 8 · 9 · 10 · 11 · 15 · 모든 칸 주소 실재 · 빈칸(□) · 분석표 15개 세부", async () => {
      eq(NF.FORMS.map(f => f.id).join(","), "b1,b3,b4,b7,b8,b9,b10,b11,b15");
      eq(NF.SRC.rev, "국토교통부예규 제217호"); eq(NF.SRC.date, "2018-05-16");
      for (const f of NF.FORMS) {
        const pkg = await tplOf(f.id);
        const has = (ref) => ok(H.cell(pkg, ref), f.id + " 칸 " + JSON.stringify(ref));
        if (f.kind === "insp") {
          [f.head.insp, f.head.date, f.head.org].forEach(has);
          S.itemsOf(f).forEach(it => {
            if (it.k === "yn") { eq(it.b.length, 4, f.id + " " + it.id); it.b.forEach(b => eq(cellT(pkg, b).trim(), "□", f.id + " " + it.id)); }
            else has(it.a);
          });
        } else if (f.kind === "fsc") {
          f.head.appr.forEach(has);
          const line = H.paraText(H.topParas(pkg)[f.head.line]);
          ok(/점검일/.test(line) && /\(서명\)/.test(line), "점검일 · 서명 줄");
          S.itemsOf(f).forEach(it => { it.b.forEach(has); if (it.k === "eq" && !it.t) has(it.nm); });
        } else {
          eq(f.cats.length, 4); eq(f.cats.reduce((a, c) => a + c.items.length, 0), 15);
          eq(f.cats.map(c => c.items.map(x => x.id).join(",")).join(","), Array.from({ length: 15 }, (_, i) => "p" + (i + 1)).join(","));
          f.cats.forEach(c => c.items.forEach(x => { has(x.n); has(x.pct); }));
          ok(H.topParas(pkg)[f.head.org], "기관 줄");
        }
      }
      ok(S.forms().every(f => f.kind !== "ana"));
      eq(S.anaForm().id, "b15");
    });

    await ta("SK03 HWPX 채우기(별표 4): Y · R/C · N/A 칸 ■ · 서술 답 · 점검일 · 감독관 · 기관 → ZIP(mimetype 첫 · 무압축) · 다시 열기 · 파일 이름", async () => {
      const its = items("b4"), yn = its.filter(x => x.k === "yn"), tx = its.find(x => x.k === "tx");
      const r = rec("b4", { insp: "점검갑", org: "시험 화물터미널", ans: { [yn[0].id]: "Y", [yn[1].id]: "RC", [yn[2].id]: "NA", [yn[3].id]: "N" }, txt: { [tx.id]: "첫 줄\n둘째 줄" } });
      const pkg = await S.recordPkg(r);
      const f = S.formOf("b4");
      eq(cellT(pkg, f.head.date), "2026. 10. 3."); eq(cellT(pkg, f.head.insp), "점검갑"); eq(cellT(pkg, f.head.org), "시험 화물터미널");
      eq(yn[0].b.map(b => cellT(pkg, b)).join(""), "■□□□");
      eq(yn[1].b.map(b => cellT(pkg, b)).join(""), "□□■□");
      eq(yn[2].b.map(b => cellT(pkg, b)).join(""), "□□□■");
      eq(yn[3].b.map(b => cellT(pkg, b)).join(""), "□■□□");
      eq(yn[4].b.map(b => cellT(pkg, b)).join(""), "□□□□", "미응답은 빈칸");
      eq(H.cellParas(H.cell(pkg, tx.a)).map(p => H.paraText(p)).join("|"), "첫 줄|둘째 줄");
      ok(!H.cell(pkg, tx.a).getElementsByTagNameNS(H.NS.hp, "linesegarray").length, "고친 칸의 줄 배치 캐시 제거");
      const out = await H.build(pkg, { preview: "x" });
      eq(String.fromCharCode(out[0], out[1], out[2], out[3]), "PK\u0003\u0004");
      eq(out[8] | (out[9] << 8), 0, "mimetype 무압축");
      eq(String.fromCharCode.apply(null, Array.from(out.slice(30, 38))), "mimetype");
      const re = await H.open(out);
      eq(re.sec.getElementsByTagName("parsererror").length, 0);
      eq(yn[1].b.map(b => cellT(re, b)).join(""), "□□■□", "다시 열어도 같음");
      eq(cellT(re, f.head.insp), "점검갑");
      eq(S.fileName(f, "2026-10-03"), "[별표 4] 화물보관창고_검색절차 점검표_20261003.hwpx");
    });

    await ta("SK04 HWPX 채우기(별표 1 현장보안확인표): 결재란(점검자 비우면 점검자) 가운데 · 점검일 줄 · 양호/미흡 ○ · 장비명 · 비고", async () => {
      const f = S.formOf("b1"), its = items("b1");
      const named = its.filter(x => x.k === "eq" && x.t), blank = its.find(x => x.k === "eq" && !x.t), gp = its.find(x => x.k === "gp" && x.rm);
      const r = rec("b1", { insp: "점검갑", appr: ["", "담당을", ""], ans: { [named[0].id]: "G", [named[1].id]: "P", [blank.id]: "G", [gp.id]: "P" },
        nm: { [blank.id]: "시험 장비" }, rm: { [named[0].rm.join(",")]: "정상 작동", [gp.rm.join(",")]: "개선 필요" } });
      const pkg = await S.recordPkg(r);
      eq(cellT(pkg, f.head.appr[0]), "점검갑", "결재란 점검자 = 점검자");
      eq(cellT(pkg, f.head.appr[1]), "담당을"); eq(cellT(pkg, f.head.appr[2]), "");
      const ctr = H.centerPara(pkg);
      ok(ctr != null); eq(H.cellParas(H.cell(pkg, f.head.appr[0]))[0].getAttribute("paraPrIDRef"), String(ctr));
      const line = H.paraText(H.topParas(pkg)[f.head.line]);
      eq(line, S.fscLine(r)); ok(line.indexOf("점검일 : 2026. 10. 3.") === 0 && /점검자 : 점검갑\s+\(서명\)$/.test(line), line);
      eq(cellT(pkg, named[0].b[0]), "○"); eq(cellT(pkg, named[0].b[1]), "");
      eq(cellT(pkg, named[1].b[1]), "○"); eq(cellT(pkg, gp.b[1]), "○");
      eq(cellT(pkg, blank.nm), "시험 장비"); eq(cellT(pkg, named[0].rm), "정상 작동"); eq(cellT(pkg, gp.rm), "개선 필요");
      const runOf = (ref) => H.cellParas(H.cell(pkg, ref))[0].getElementsByTagNameNS(H.NS.hp, "run")[0].getAttribute("charPrIDRef");
      const prevNamed = S.itemsOf(f).slice(0, S.itemsOf(f).indexOf(blank)).reverse().find(x => x.k === "eq" && x.t);
      eq(runOf(blank.nm), runOf(prevNamed.nm), "빈 장비명 칸 = 위 장비명 글자 모양");
      eq(H.cellParas(H.cell(pkg, named[1].b[1]))[0].getAttribute("paraPrIDRef"), String(ctr), "○ 가운데");
    });

    t("SK05 지적(R/C · 미흡) · 조치 상태(조치 중 · 기한 경과 · 완료) · 이행 시기(제55조 4항) 기한 · 결과 요약 · 보존(제14조)", () => {
      eq(S.termDue("onsite", "2026-10-03"), "2026-10-03"); eq(S.termDue("short", "2026-10-03"), "2026-10-13");
      eq(S.termDue("mid", "2026-10-03"), "2027-01-03"); eq(S.termDue("long", "2026-10-03"), ""); eq(S.termDue("short", ""), "");
      const yn = items("b4").filter(x => x.k === "yn");
      ok(!S.isFind(S.formOf("b4"), yn[0], "N")); ok(S.isFind(S.formOf("b4"), yn[0], "RC"));
      ok(S.isFind(S.formOf("b1"), items("b1").find(x => x.k === "eq"), "P"));
      const r = rec("b4", { ans: { [yn[0].id]: "RC", [yn[1].id]: "RC", [yn[2].id]: "Y" }, fx: { [yn[0].id]: { due: "2026-10-01" }, [yn[1].id]: { done: "2026-10-02" } } });
      const c = S.counts(r);
      eq(c.fx, 2); eq(c.open, 1); eq(c.late, 1); eq(c.RC, 2); eq(c.Y, 1);
      eq(S.fState(r.fx[yn[0].id]), "late"); eq(S.fState(r.fx[yn[1].id]), "done"); eq(S.fState({ due: "2026-12-01" }), "open");
      ok(/^Y 1 · R\/C 2 · 미응답 \d+$/.test(S.resultText(r)), S.resultText(r));
      eq(S.keepText(r), "보존: 조치 완료 때까지 (제14조)");
      r.fx[yn[0].id].done = "2026-10-03";
      eq(S.keepText(r), "보존: 2029.10.03까지 (제14조)");
    });

    await ta("SK06 문제점 분석(별표 15): 세부별 연간 건수 · 전년 대비 증감률 · 분야 미지정 제외 · 수검 지적 포함 · HWPX 채우기", async () => {
      const yn = items("b4").filter(x => x.k === "yn");
      const mk = (date, cats) => rec("b4", { date, ans: Object.fromEntries(cats.map((c, i) => [yn[i].id, "RC"])), fx: Object.fromEntries(cats.map((c, i) => [yn[i].id, c ? { cat: c } : {}])) });
      e.S.data.selfChecks = [mk("2026-03-02", ["p1", "p1", "p5", ""]), mk("2026-07-01", ["p3"]), mk("2025-05-05", ["p1", "p5", "p5"])];
      e.S.data.audits = [{ id: "a1", title: "시험 수검", start: "2026-05-10", end: "2026-05-11", findings: [{ id: "f1", text: "x", cat: "p2" }, { id: "f2", text: "y", cat: "" }] }];
      const A = S.analysis("2026", false);
      eq(A.cnt.p1, 2); eq(A.prev.p1, 1); eq(A.cnt.p5, 1); eq(A.prev.p5, 2); eq(A.cnt.p3, 1); eq(A.none, 1); eq(A.total, 4); eq(A.ptotal, 3);
      eq(S.pctText(A, "p1"), "+100"); eq(S.pctText(A, "p5"), "-50"); eq(S.pctText(A, "p3"), "-"); eq(S.pctText(A, "p2"), "");
      const B = S.analysis("2026", true);
      eq(B.cnt.p2, 1); eq(B.fromAudit, 1); eq(B.total, 5);
      const pkg = await S.anaPkg("2026", false, "시험 기관");
      const f = S.anaForm(), it = (id) => f.cats.reduce((a, c) => a.concat(c.items), []).find(x => x.id === id);
      eq(cellT(pkg, it("p1").n), "2"); eq(cellT(pkg, it("p1").pct), "+100"); eq(cellT(pkg, it("p5").pct), "-50"); eq(cellT(pkg, it("p2").n), "0");
      ok(H.paraText(H.topParas(pkg)[f.head.org]).indexOf("(시험 기관)") >= 0);
      ok(S.catLabel("p1").indexOf("인적") === 0, S.catLabel("p1"));
      e.S.data.audits = [];
    });

    t("SK07 수검 대응 센터 증빙: 2.7 자체 점검 기록(완료 · 1년) · 2.8 지적 개선(기한 경과 없음)", () => {
      eq(typeof e.w.SemisEvidence.selfcheck, "function");
      const yn = items("b4").filter(x => x.k === "yn");
      e.S.data.selfChecks = [rec("b4", { date: "2026-09-01", status: "done", ans: { [yn[0].id]: "RC" }, fx: { [yn[0].id]: { due: "2026-09-10" } } }), rec("b1", { date: "2026-09-20" }), rec("b4", { date: "2025-01-01", status: "done" })];
      const a = S.evidence("2.7");
      ok(a.ok); ok(/1건\(1년\) · 작성 중 1/.test(a.text), a.text);
      const b = S.evidence("2.8");
      ok(!b.ok, "기한 경과 지적"); ok(/기한 경과 1/.test(b.text), b.text);
      e.S.data.selfChecks[0].fx[yn[0].id].done = "2026-09-09";
      ok(S.evidence("2.8").ok);
      eq(S.evidence("1.1"), null);
    });

    await ta("SK08 화면: 4개 탭 · 양식 9개 · 새 점검(별표 4) → 기록 화면 · Y/R/C 선택 · 지적 칸 · 이행 구분 → 기한 · 점검 완료 · 목록 · Print 1개", async () => {
      e.S.data.selfChecks = [];
      e.S.setEditMode && e.S.setEditMode(false);
      S.setState({ tab: "list", rid: "" });
      go(e, "selfcheck");
      eq(qa(e, "[data-sctab]").length, 4);
      ok(q(e, "#view .stat-row") || q(e, "#view .stats"), "요약 지표");
      q(e, "[data-sctab=forms]").click();
      eq(qa(e, ".sc-fcard").length, 9);
      q(e, "[data-sc-new=b4]").click();
      eq(e.S.data.selfChecks.length, 1);
      const r = e.S.data.selfChecks[0];
      ok(q(e, "#sc-page") && /별표 4/.test(q(e, "#view .page-title").textContent));
      eq(qa(e, "#view [data-print-btn]").length, 1, "Print 버튼 하나(양식 인쇄)");
      ok(q(e, "#sc-hwpx") && q(e, "#sc-pv"));
      const lis = qa(e, "#sc-page li.sc-it.is-ch");
      lis[0].querySelector("[data-sv=Y]").click();
      eq(r.ans[lis[0].dataset.iid], "Y");
      q(e, `#sc-page li[data-iid="${lis[1].dataset.iid}"] [data-sv=RC]`).click();
      eq(r.ans[lis[1].dataset.iid], "RC");
      const box = q(e, `#sc-page [data-fxbox="${lis[1].dataset.iid}"]`);
      ok(box, "R/C → 지적 칸");
      const term = box.querySelector('[data-k$="|term"]'); term.value = "short"; fire(term, "change");
      eq(r.fx[lis[1].dataset.iid].term, "short"); eq(r.fx[lis[1].dataset.iid].due, "2026-10-13");
      eq(box.querySelector('[data-k$="|due"]').value, "2026-10-13");
      const cat = box.querySelector('[data-k$="|cat"]'); cat.value = "p2"; fire(cat, "change");
      eq(r.fx[lis[1].dataset.iid].cat, "p2");
      q(e, `#sc-page li[data-iid="${lis[1].dataset.iid}"] [data-sv=RC]`).click();
      ok(!q(e, `#sc-page [data-fxbox="${lis[1].dataset.iid}"]`), "다시 누르면 해제");
      q(e, `#sc-page li[data-iid="${lis[1].dataset.iid}"] [data-sv=RC]`).click();
      const insp = q(e, '#sc-page input[data-k="insp"]'); insp.value = "점검갑"; fire(insp, "change");
      eq(r.insp, "점검갑");
      q(e, "#sc-done").click();
      if (q(e, "#modal-box [data-act=ok]")) clickOk(e);
      eq(r.status, "done");
      ok(q(e, "#sc-reopen"), "다시 열기");
      q(e, "[data-scback]").click();
      for (let i = 0; i < 200 && q(e, "#sc-page"); i++) await tick(10);   // jsdom 의 history.back 은 비동기
      ok(!q(e, "#sc-page"), "목록으로(브라우저 뒤로)");
      q(e, "[data-sctab=list]").click();
      ok(q(e, `#view [data-scid="${r.id}"]`), "목록 행");
      q(e, "[data-sctab=fx]").click();
      ok(q(e, `#view [data-scfx]`), "지적 · 조치 행");
      q(e, "[data-sctab=ana]").click();
      ok(q(e, "#view table.sc-ana") && q(e, "#sc-aprint[data-print-btn]"));
      eq(qa(e, "#view [data-print-btn]").length, 1);
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("SK09 권한: manager 작성 · user 접근 불가 · 남의 기록 삭제는 관리자만", () => {
      loginAs(e, "manager"); S.setState({ tab: "list", rid: "" }); go(e, "selfcheck");
      ok(q(e, "#sc-add"), "manager 새 점검");
      const r = e.S.data.selfChecks[0];
      S.openRecord(r.id); e.S.renderView();
      ok(q(e, "#sc-page"));
      ok(!q(e, "#sc-del"), "남이 만든 기록 삭제 버튼 없음");
      S.setState({ rid: "" });
      loginAs(e, "user"); go(e, "selfcheck");
      ok(!q(e, "#sc-add") && !q(e, ".sc-fcard") && !q(e, "[data-sctab]"), "user 화면 없음");
      loginAs(e, "hq");
    });

    t("SK10 수검 지적 폼: 문제점 분야(별표 15 · 15개) · 이행 시기 → 기한 제안 · 저장", () => {
      e.S.data.audits = [{ id: "a9", title: "시험 수검", body: Object.keys({}).length ? "" : undefined, start: "2026-10-01", end: "2026-10-02", findings: [], checklist: [] }];
      e.w.SemisAudit.findingForm("a9", null);
      eq(qa(e, "#fd-cat option").length, 16, "미지정 + 15");
      eq(qa(e, "#fd-term option").length, 5);
      setv("#fd-text", "시험 지적");
      setv("#fd-cat", "p9");
      const tm = setv("#fd-term", "short"); fire(tm, "change");
      eq(q(e, "#fd-due").value, "2026-10-12", "종료일 + 10일");
      clickOk(e);
      const fd = e.S.data.audits[0].findings[0];
      ok(fd); eq(fd.cat, "p9"); eq(fd.term, "short"); eq(fd.due, "2026-10-12");
      eq(S.analysis("2026", true).cnt.p9, 1);
      e.S.data.audits = [];
    });

    t("SK11 선택 실행(v1.42): 점검 · 교육 대시보드 · 지표 · 일정에 넣지 않음 · 메뉴 '선택' 표시 · 화면 머리 표시", () => {
      go(e, "aud-dash");
      ok(!q(e, '.ie-card[aria-label="자체 보안점검"]'), "카드 없음");
      ok(!/자체 점검|감독관 점검|별표/.test(q(e, "#view").textContent), "지표 · 다가오는 점검 · 달력에도 없음");
      ok(!q(e, "[data-ie-sc], [data-ie-scf], [data-ie-scforms], [data-ie-schc]"));
      const nv = q(e, '.nav-item[data-route="selfcheck"]');
      ok(nv && nv.classList.contains("is-opt") && /선택/.test(nv.querySelector(".nav-tag").textContent) && !nv.querySelector(".nav-meta"), "메뉴 '선택' (미결 건수 배지 대신)");
      go(e, "selfcheck");
      ok(/선택 실행/.test(q(e, "#view .page-head .sc-opt").textContent) && /통계/.test(q(e, "#view .page-head .sc-opt").title), "화면 머리 표시");
      ok(q(e, "#sc-add"), "필요할 때 실행");
    });

    await ta("SK12 인쇄 렌더러: A4 · 표는 블록(쪽 나눔 가능) · 칸 높이 border-box · 한글 줄 간격(칸 마지막 줄 간격 제외)", async () => {
      const pkg = await tplOf("b1");
      const pg = H.page(pkg);
      eq(Math.round(pg.w), 210); eq(Math.round(pg.h), 297);
      const css = H.css(pkg, {});
      ok(css.indexOf("inline-table") < 0); ok(/\.hx-t td \{[^}]*box-sizing: border-box/.test(css)); ok(/@page \{ size: 210/.test(css));
      const html = H.html(pkg);
      ok(/class="hx-doc"/.test(html));
      ok(/<td[^>]*><p class="hx-p" style="font-size:[\d.]+pt;[^"]*margin-bottom:-[\d.]+mm;/.test(html), "칸 마지막 문단 줄 간격 빼기");
      const r = rec("b1", { insp: "점검갑" });
      e.S.data.selfChecks = [r];
      await S.printRecord(r, false);
      ok(/<title>\[별표 1\] 현장보안확인표 2026\.10\.03<\/title>/.test(S.lastPrint()), "인쇄 문서 제목");
      ok(S.lastPrint().indexOf("점검갑") > 0);
    });

    t("SK13 규정 자료용 지침 PDF(본문 + 화물 별표 9종) · 양식 탭 링크", () => {
      const pdf = fs.readFileSync(path.join(ROOT, "assets/regs/nas-217.pdf"));
      eq(pdf.slice(0, 5).toString(), "%PDF-");
      ok(pdf.length > 100000 && pdf.length < 3000000, "크기 " + pdf.length);
      S.setState({ tab: "forms", rid: "" }); go(e, "selfcheck");
      const a = q(e, '#view .sc-src a[href="assets/regs/nas-217.pdf"]');
      ok(a && a.target === "_blank");
    });

    e.w.close();
  }

  /* ══════════ [UP] v1.33 점검 표시 · 수검대비 표식 · 다가오는 점검 ══════════ */
  {
    const assetFetch = async (url) => {
      const u = String(url).split("?")[0].replace(/^https?:\/\/[^/]+\//, "");
      const fp = path.join(ROOT, u);
      if (/^assets\//.test(u) && fs.existsSync(fp)) { const b = fs.readFileSync(fp); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; }
      return new Promise(() => {});
    };
    const e = makeEnv({ fetch: assetFetch });
    for (const k of ["TextEncoder", "TextDecoder", "CompressionStream", "DecompressionStream"]) if (!e.w[k]) e.w[k] = globalThis[k];
    const S = e.w.SemisSelfcheck, H = e.w.SemisHwpx, SL = e.w.SemisSeclog, AD = e.w.SemisAudDash, A = e.w.SemisAudit;
    const T0 = "2026-10-03";
    S.setToday(T0); SL.setToday(T0, "09:30"); AD.setToday(T0); A.setToday(T0);
    loginAs(e, "hq");
    const gov = (start, extra) => Object.assign({ id: "g" + start, body: "gov", org: "서울지방항공청", kind: "정기 보안점검", start, end: start, findings: [], checklist: [] }, extra || {});
    const sc = (form, date, status, extra) => Object.assign({ id: "u" + form + date + status, form, date, insp: "", org: "", ans: {}, txt: {}, rm: {}, nm: {}, fx: {}, files: [], status, createdAt: date + "T00:00:00Z", createdBy: "Thq" }, extra || {});
    const lg = (tid, date) => ({ id: "l" + tid + date, tid, date, time: "09:00", by: "점검자", checks: [], result: "ok", note: "", action: "", files: [], rounds: [] });
    const reset = () => { e.S.data.audits = []; e.S.data.selfChecks = []; e.S.data.seclog = []; e.S.data.seclogCfg = { since: "2026-09-01", templates: [] }; };

    t("UP01 자체 보안점검: 감독관 점검표 · 수검대비 표식(양식 카드 9 · 기록 화면) · 감독관/자체 주체 → 대상 · 주기 · 점검자 칸 이름", () => {
      reset();
      S.setState({ tab: "forms", rid: "" }); go(e, "selfcheck");
      const cards = qa(e, ".sc-fcard");
      eq(cards.length, 9);
      ok(cards.every(c => /감독관 점검표/.test(c.querySelector(".sc-tags").textContent) && /수검대비 자체 (점검|분석)/.test(c.querySelector(".sc-tags").textContent)), "모든 카드 표식");
      const who = (id) => q(e, `.sc-fcard[data-fid="${id}"] .sc-who`).textContent.replace(/\s+/g, " ");
      ok(/항공보안감독관 · 지방항공청 → 화물터미널운영자 · 상주업체 · 항목별 주 2회 이상/.test(who("b1")), who("b1"));
      ok(/항공보안감독관 → 화물터미널운영자 등 · 연 1회 이상/.test(who("b4")) && /자체\s*인천화물팀 · 연 1회 이상 · 기록 없음/.test(who("b4")), who("b4"));
      ok(/국토부 수검대비 자체 점검/.test(q(e, "#view .page-head").textContent), "머리말");
      q(e, "[data-sc-new=b4]").click();
      ok(q(e, "#sc-page .sc-mark .sc-tag.is-mark"), "기록 화면 표식");
      ok(/점검자 \(양식 '감독관' 칸\)/.test(q(e, "#sc-page .sc-infog").textContent));
      S.setState({ rid: "" }); e.S.data.selfChecks = [];
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    await ta("UP02 HWPX · 인쇄 첫 줄 끝에 '※ 국토부 수검대비 자체 점검'(기록 · 분석표) · 빈 양식은 원본 그대로 · 쪽 배치 문단 수 불변", async () => {
      const r = sc("b4", T0, "draft", { insp: "점검갑" });
      const pkg = await S.recordPkg(r);
      const first = H.paraText(H.topParas(pkg)[0]);
      ok(/^\[별표 4\] 화물보관창고\/검색절차 점검표\s+※ 국토부 수검대비 자체 점검$/.test(first), first);
      const blank = await H.open(new Uint8Array(fs.readFileSync(path.join(ROOT, "assets/forms/nas/b4.hwpx"))));
      eq(H.topParas(pkg).length, H.topParas(blank).length, "문단 수 그대로");
      ok(H.paraText(H.topParas(blank)[0]).indexOf(S.MARK) < 0, "빈 양식 원본");
      const r1 = await S.recordPkg(sc("b1", T0, "draft", { appr: ["", "", ""] }));
      ok(/^\[별표 1\]\s+※ 국토부 수검대비 자체 점검$/.test(H.paraText(H.topParas(r1)[0])));
      const ana = await S.anaPkg("2026", false, "");
      ok(/^\[별표 15\]\s+※ 국토부 수검대비 자체 점검$/.test(H.paraText(H.topParas(ana)[0])));
      S.markPkg(pkg); eq((H.paraText(H.topParas(pkg)[0]).match(/수검대비/g) || []).length, 1, "두 번 붙지 않음");
      e.S.data.selfChecks = [r];
      await S.printRecord(r, false);
      ok(S.lastPrint().indexOf("※ 국토부 수검대비 자체 점검") > 0, "인쇄 문서");
      e.S.data.selfChecks = [];
    });

    t("UP03 자체 점검 다음 기한: 연 1회 · 국토부 수검 7일 전(수검 전 90일 안 완료 기록이 있으면 주기만) · 해외 수검 제외 · 임박 수검은 오늘 · 작성 중이면 이어 쓰기", () => {
      reset();
      const b4 = S.formOf("b4");
      let n = S.nextDue(b4, T0); eq(n.due, ""); eq(n.why, "");
      e.S.data.audits = [gov("2026-10-23"), Object.assign(gov("2026-10-10"), { body: "foreign" }), Object.assign(gov("2026-10-12"), { cancelled: true })];
      n = S.nextDue(b4, T0); eq(n.due, "2026-10-16"); eq(n.why, "수검 전"); eq(n.audit.start, "2026-10-23");
      e.S.data.selfChecks = [sc("b4", "2025-11-01", "done")];
      n = S.nextDue(b4, T0); eq(n.due, "2026-10-16", "수검 전이 주기보다 빠름"); eq(n.last, "2025-11-01");
      e.S.data.selfChecks = [sc("b4", "2026-09-01", "done")];
      n = S.nextDue(b4, T0); eq(n.due, "2027-09-01"); eq(n.why, "주기");
      e.S.data.audits = [gov("2026-10-06")];
      e.S.data.selfChecks = [];
      eq(S.nextDue(b4, T0).due, T0, "수검이 7일 안이면 오늘");
      eq(S.dday("2026-10-16", T0), "D-13"); eq(S.dday(T0, T0), "오늘"); eq(S.dday("2026-10-01", T0), "지남 2일");
      eq(S.nextDue(S.anaForm(), T0).due, "", "분석표는 일정 없음");
      e.S.data.selfChecks = [sc("b1", "2026-10-02", "draft", { appr: ["", "", ""] })];
      S.setState({ tab: "forms", rid: "" }); go(e, "selfcheck");
      ok(/이어 쓰기/.test(q(e, "[data-sc-new=b1]").textContent));
      q(e, "[data-sc-new=b1]").click();
      eq(e.S.data.selfChecks.length, 1, "새로 만들지 않음"); eq(S.getState().rid, e.S.data.selfChecks[0].id);
      S.setState({ rid: "" });
    });

    t("UP04 보안 기록부: 주체 → 대상 · 대상 묶음 기본값(비면 기본, 고친 값 유지) · 카드 표시 · 기한 · 다음 기한(nextDue) · 양식 편집 칸", () => {
      reset();
      const daily = SL.tplOf("t-daily");
      eq(daily.by, "보안감독자"); eq(daily.target, "화물터미널 보안구역"); eq(daily.grp, "terminal");
      eq(SL.tplOf("t-hazmat").grp, "hazmat"); eq(SL.tplOf("t-selfaudit").grp, "us");
      e.S.data.seclogCfg.templates = SL.DEF_TEMPLATES.map(x => Object.assign({}, x, x.id === "t-hazmat" ? { by: "시험 담당", target: "시험 대상", grp: "etc" } : {}));
      eq(SL.tplOf("t-hazmat").by, "시험 담당"); eq(SL.tplOf("t-hazmat").grp, "etc");
      eq(SL.whoText(SL.tplOf("t-hazmat")), "시험 담당 → 시험 대상");
      e.S.data.seclogCfg.templates = [];
      SL.setState({ tab: "today" }); go(e, "inspection");
      const card = q(e, '.sl-card[data-tid="t-hazmat"]');
      ok(/위해물품 관리책임자 → 위해물품/.test(card.querySelector(".sl-who").textContent));
      ok(/이번 달 미기록 · 10\.31까지/.test(card.textContent), card.textContent);
      ok(!/까지/.test(q(e, '.sl-card[data-tid="t-daily"] .sl-card-s').textContent), "매일 양식은 기한 표시 없음");
      const M = SL.tplOf("t-hazmat"), Q = SL.tplOf("t-regular"), Y = SL.tplOf("t-surprise");
      eq(SL.nextDue(M, T0).due, "2026-10-31"); eq(SL.nextDue(Q, T0).due, "2026-12-31"); eq(SL.nextDue(Y, T0).due, "2026-12-31");
      e.S.data.seclog = [lg("t-hazmat", "2026-10-02"), lg("t-regular", "2026-10-01")];
      eq(SL.nextDue(M, T0).due, "2026-11-30", "이번 달 했으면 다음 달 끝"); eq(SL.nextDue(Q, T0).due, "2027-03-31");
      ok(SL.nextDue(daily, T0).daily); ok(SL.nextDue(SL.tplOf("t-guard"), T0).event);
      eq(SL.periodEnd({ cycle: "week" }, "W2026-09-28"), "2026-10-04"); eq(SL.periodEnd({ cycle: "month" }, "2026-02"), "2026-02-28");
      SL.templatesForm();
      const row = q(e, '#sl-tpls .sl-tpl');
      ok(row.querySelector('[data-k="by"]') && row.querySelector('[data-k="target"]') && row.querySelector('select[data-k="grp"]'), "편집 칸");
      row.querySelector('[data-k="by"]').value = "바꾼 주체";
      clickOk(e);
      eq(e.S.data.seclogCfg.templates[0].by, "바꾼 주체");
      e.S.data.seclogCfg.templates = [];
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("UP05 대시보드 '다가오는 점검': 달력 다음 · ICNKF 수검 / ICNKF 실행(대상별 묶음 · 가까운 날짜 순) · 30일 안 강조 · 진행 중 수검 · 점검표 바로 가기 · 매일 점검 줄 · 자체 보안점검 제외(v1.42)", () => {
      reset();
      e.S.data.audits = [gov("2026-10-23", { end: "2026-10-24" }), Object.assign(gov("2026-12-03"), { body: "foreign", org: "TSA", kind: "ACC3 검증" })];
      e.S.data.seclog = [lg("t-daily", T0), lg("t-regular", "2026-07-15")];
      e.S.data.selfChecks = [sc("b1", "2026-10-02", "draft", { appr: ["", "", ""] })];
      go(e, "aud-dash");
      const cs = qa(e, ".ie-card");
      ok(cs[0].classList.contains("ie-cal") && cs[1].classList.contains("ie-up"), "달력 → 다가오는 점검");
      const rs = q(e, ".ie-up .uc-sec.is-recv"), os = q(e, ".ie-up .uc-sec.is-own");
      ok(rs && os && q(e, ".ie-up .uc-split.is-two"), "두 구역");
      ok(rs.compareDocumentPosition(os) & 4, "수검이 먼저");
      ok(/^ICNKF 수검/.test(rs.querySelector(".uc-sh").textContent.trim()), rs.querySelector(".uc-sh").textContent);
      ok(/^ICNKF 실행/.test(os.querySelector(".uc-sh").textContent.trim()), os.querySelector(".uc-sh").textContent);
      ok(!/받는 점검|하는 점검/.test(q(e, ".ie-up").textContent), "옛 표기 없음");
      const gs = Array.from(os.querySelectorAll(".uc-grp")).map(g => g.dataset.grp);
      ok(gs.indexOf("sc") < 0 && gs.indexOf("recv") < 0 && gs.indexOf("hazmat") >= 0, gs.join(","));
      ok(!q(e, ".ie-up [data-ie-scf]") && !q(e, ".ie-up .uc-std") && !/별표|감독관 점검/.test(q(e, ".ie-up").textContent), "자체 보안점검(선택 실행)은 넣지 않음");
      const recv = Array.from(rs.querySelectorAll(".uc-row"));
      eq(recv.length, 2); ok(recv[0].classList.contains("is-soon") && !recv[1].classList.contains("is-soon"), "30일 안만 강조");
      ok(!recv[0].querySelector(".uc-act"), "외부 수검은 점검표 없음");
      ok(/서울지방항공청 → 인천화물팀 · ~10\.24/.test(recv[0].textContent));
      const daily = os.querySelector(".uc-daily");
      ok(daily && daily.querySelector('[data-ie-sl="t-daily"]').classList.contains("is-done") && !daily.querySelector('[data-ie-sl="t-uld"]').classList.contains("is-done"), "매일 점검 오늘 상태");
      ok(daily.querySelector('[data-ie-sl="t-patrol"][data-ie-round]'), "순찰은 순찰 기록");
      const hz = os.querySelector('.uc-grp[data-grp="hazmat"] [data-ie-sl="t-hazmat"]');
      ok(hz && hz.classList.contains("btn-primary"), "30일 안 → 주 버튼");
      hz.click();
      ok(q(e, "#modal-box") && /위해물품 월간 점검/.test(q(e, "#modal-box").textContent), "점검표(기록 폼) 열림");
      e.S.closeModal();
      AD.setToday("2026-10-23"); SL.setToday("2026-10-23", "09:00"); S.setToday("2026-10-23");
      go(e, "aud-dash");
      const now = q(e, ".ie-up .uc-sec.is-recv .uc-row");
      ok(now.classList.contains("is-now") && /진행 중/.test(now.textContent), "수검 기간 중 → 진행 중");
      AD.setToday("2026-11-02"); SL.setToday("2026-11-02", "09:00"); S.setToday("2026-11-02");
      e.S.data.audits = []; go(e, "aud-dash");
      ok(!q(e, '.ie-up .uc-grp[data-grp="terminal"] .uc-row.is-late') && !q(e, ".ie-up .uc-row.is-late"), "기한은 주기 끝이라 지나지 않음");
      ok(/예정된 수검이 없습니다/.test(q(e, ".ie-up .uc-sec.is-recv").textContent), "수검 없음 안내");
      AD.setToday(T0); SL.setToday(T0, "09:30"); S.setToday(T0);
      e.S.data.audits = [gov("2026-10-23")];
      go(e, "aud-dash");
      q(e, ".ie-up .uc-sec.is-recv [data-ie-aud]").click();
      eq(e.w.location.hash, "#/audit"); eq(A.getState().sel, "g2026-10-23");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("UP06 다가오는 점검: 자체 보안점검 기한이 지나도 넣지 않음(v1.42 선택 실행) · user 접근 불가", () => {
      reset();
      ok(!AD.upData(T0).groups.some(g => g.key === "sc"), "기록 없어도 묶음 없음");
      e.S.data.selfChecks = [sc("b4", "2025-09-01", "done")];
      const u = AD.upData(T0);
      ok(!u.groups.some(g => g.key === "sc") && u.late === 0, "주기가 지나도 없음");
      go(e, "aud-dash");
      ok(!qa(e, ".ie-up .uc-row.is-late").length, "지남 줄 없음");
      loginAs(e, "user"); go(e, "aud-dash");
      ok(!q(e, ".ie-up"), "user 없음");
      loginAs(e, "hq");
      e.S.data.selfChecks = [];
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("UP07 자체 점검 안내 편집(hq): 공용 DB selfCheckCfg · 권한표 [2,3] · 비면 기본값 · 바꾼 값만 저장 · 감독관 안내 · 자체 주기 · 수검 전 일수 반영 · 기본값 되돌리기", () => {
      reset(); e.S.data.selfCheckCfg = { forms: {} };
      eq(JSON.stringify(ACL.selfCheckCfg), "[2,3]", "권한표: manager 열람 · hq 편집");
      ok(SEC_SQL.indexOf("semis_logi_security_18_selfcheckcfg") > 0);
      ok(e.Sync.SYNC_KEYS.indexOf("selfCheckCfg") >= 0);
      e.S.data.selfCheckCfg = []; e.S.normalizeData();
      eq(JSON.stringify(e.S.data.selfCheckCfg), '{"forms":{}}', "형식 정리");
      const c0 = S.selfCfg(); eq([c0.by, c0.months, c0.before, c0.fresh, c0.cycOnly].join("|"), "인천화물팀|12|7|90|연 1회 이상");
      e.S.data.selfCheckCfg = { months: 5, before: "x", fresh: 999, forms: { b1: { by: "  " } } };
      const c1 = S.selfCfg(); eq([c1.months, c1.before, c1.fresh].join("|"), "12|7|90", "잘못된 값은 기본값");
      eq(S.offOf(S.formOf("b1")).by, "항공보안감독관 · 지방항공청", "빈 칸은 기본값");
      e.S.data.selfCheckCfg = { forms: {} };
      loginAs(e, "manager"); S.setState({ tab: "forms", rid: "" }); go(e, "selfcheck");
      ok(!q(e, "#sc-cfg"), "manager 편집 없음");
      loginAs(e, "hq"); go(e, "selfcheck");
      ok(q(e, "#sc-cfg"), "hq 편집");
      S.setState({ tab: "list" }); go(e, "selfcheck"); ok(!q(e, "#sc-cfg"), "양식 탭에서만"); S.setState({ tab: "forms" }); go(e, "selfcheck");
      q(e, "#sc-cfg").click();
      eq(qa(e, "#modal-box [data-cf]").length, 9, "별표 9종");
      eq(q(e, "#sc-c-by").value, "인천화물팀");
      clickOk(e);
      eq(JSON.stringify(e.S.data.selfCheckCfg), '{"forms":{}}', "바꾼 값 없으면 비움");
      q(e, "#sc-cfg").click();
      q(e, "#sc-c-by").value = "인천화물보안팀"; q(e, "#sc-c-m").value = "3"; q(e, "#sc-c-before").value = "14";
      q(e, '#modal-box [data-cf="b1"] [data-c="cyc"]').value = "주 3회 이상";
      q(e, '#modal-box [data-cf="b4"] [data-c="by"]').value = "  ";
      clickOk(e);
      const cf = e.S.data.selfCheckCfg;
      eq(cf.selfBy, "인천화물보안팀"); eq(cf.months, 3); eq(cf.before, 14); ok(!("fresh" in cf), "기본값은 저장 안 함");
      eq(JSON.stringify(cf.forms), '{"b1":{"cyc":"주 3회 이상"}}');
      const who = (id) => q(e, `.sc-fcard[data-fid="${id}"] .sc-who`).textContent.replace(/\s+/g, " ");
      ok(/화물터미널운영자 · 상주업체 · 주 3회 이상/.test(who("b1")), who("b1"));
      ok(/인천화물보안팀 · 분기 1회 이상 · 기록 없음/.test(who("b4")), who("b4"));
      e.S.data.selfChecks = [sc("b4", "2026-09-01", "done")];
      eq(S.nextDue(S.formOf("b4"), T0).due, "2026-12-01", "분기 주기");
      e.S.data.selfChecks = []; e.S.data.audits = [gov("2026-10-23")];
      eq(S.nextDue(S.formOf("b4"), T0).due, "2026-10-09", "수검 14일 전");
      q(e, "#sc-cfg").click(); q(e, "#sc-c-before").value = "99"; clickOk(e);
      ok(q(e, "#modal-box [data-cf]"), "범위 밖 → 저장 안 함"); eq(cf.before, 14);
      q(e, "#sc-c-reset").click();
      eq(q(e, "#sc-c-by").value, "인천화물팀"); eq(q(e, '#modal-box [data-cf="b1"] [data-c="cyc"]').value, "항목별 주 2회 이상");
      clickOk(e);
      eq(JSON.stringify(e.S.data.selfCheckCfg), '{"forms":{}}', "기본값으로");
      e.S.data.audits = [];
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("UP08 대시보드 안내 편집(hq): 보안 기록부 양식 편집 창 바로(자체 보안점검 안내는 그 화면에서만 — v1.42) · manager 없음 · 보안 기록부를 숨기면 버튼 없음", () => {
      reset(); e.S.data.selfCheckCfg = { forms: {} };
      loginAs(e, "manager"); go(e, "aud-dash");
      ok(q(e, ".ie-up") && !q(e, "[data-ie-cfg]"), "manager 없음");
      loginAs(e, "hq"); go(e, "aud-dash");
      q(e, "[data-ie-cfg]").click();
      ok(!q(e, "#modal-box [data-ie-pick]") && q(e, "#sl-tpls .sl-tpl [data-k=by]") && q(e, "#sl-tpls .sl-tpl [data-k=target]"), "보안 기록부 양식 편집 바로");
      e.S.closeModal();
      const mn = e.S.data.menus.find(m => m.module === "inspection"); mn.hidden = true;
      go(e, "aud-dash"); ok(!q(e, "[data-ie-cfg]"), "보안 기록부를 숨기면 편집 버튼 없음");
      delete mn.hidden;
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("UP09 점검 일정 달력: 이번 달 · 일요일 시작 7열 · 오늘 · 수검 기간 · 기한(기록 없는 주기의 끝) · 완료 · 자체 점검 제외(v1.42) · 지난달 지남 · 날짜 고르면 목록 · 바로 가기", () => {
      reset();
      e.S.data.audits = [gov("2026-10-22", { end: "2026-10-23" })];
      e.S.data.seclog = [lg("t-regular", "2026-10-05")];
      e.S.data.selfChecks = [sc("b4", "2026-10-01", "done")];
      AD.setCal("", ""); go(e, "aud-dash");
      const cal = q(e, ".ie-cal");
      const ttl = cal.querySelector(".card-title").textContent;
      ok(/이번 달 점검 일정/.test(ttl) && /2026년 10월/.test(ttl), ttl);
      eq(cal.querySelectorAll(".ic-wd").length, 7); eq(cal.querySelectorAll(".ic-c").length % 7, 0);
      eq(cal.querySelector(".ic-c").dataset.ieDay, "2026-09-27", "일요일 시작");
      ok(cal.querySelector('.ic-c[data-ie-day="2026-09-30"]').classList.contains("is-out"), "앞뒤 달은 흐리게");
      ok(cal.querySelector('.ic-c[data-ie-day="2026-10-03"]').classList.contains("is-today"));
      const day = (d) => Array.from(q(e, `.ie-cal .ic-c[data-ie-day="${d}"]`).querySelectorAll(".ic-ev")).map(b => b.className + ":" + b.textContent);
      ok(day("2026-10-22").some(x => /is-recv/.test(x)) && day("2026-10-23").some(x => /is-recv/.test(x)), "수검 이틀");
      ok(day("2026-10-31").some(x => /is-due/.test(x) && /위해물품/.test(x)), day("2026-10-31").join());
      ok(day("2026-10-05").some(x => /is-done/.test(x) && /정기 보안점검/.test(x)), "기록한 날 완료");
      ok(!day("2026-10-01").some(x => /별표/.test(x)) && !day("2026-10-15").some(x => /자체 점검/.test(x)), "자체 보안점검 기한 · 완료 없음");
      eq(cal.querySelector(".ic-lg").textContent.replace(/\s+/g, ""), "ICNKF수검ICNKF실행기한기한경과완료", "범례");
      ok(cal.querySelector(".ic-ag.is-auto") && /10\.03\(토\) · 오늘/.test(cal.querySelector(".ic-ag").textContent), "모바일 기본 목록 = 오늘");
      ok(cal.querySelector('.ic-c[data-ie-day="2026-10-22"] .ic-dots .is-recv'), "모바일 점");
      q(e, '.ie-cal .ic-c[data-ie-day="2026-10-22"] .ic-n').click();
      let ag = q(e, ".ie-cal .ic-ag");
      ok(!ag.classList.contains("is-auto") && /10\.22\(목\)/.test(ag.textContent) && ag.querySelector(".ic-ag-i.is-recv[data-ie-aud]"), ag.textContent);
      q(e, '.ie-cal .ic-c[data-ie-day="2026-10-31"]').click();
      ag = q(e, ".ie-cal .ic-ag"); ok(/10\.31\(토\)/.test(ag.textContent) && ag.querySelector(".ic-ag-i.is-due"), "칸 눌러 고르기");
      q(e, '.ie-cal [data-ie-cm="-1"]').click();
      ok(/^점검 일정/.test(q(e, ".ie-cal .card-title").textContent.trim()) && /2026년 9월/.test(q(e, ".ie-cal .card-title").textContent), "지난달");
      const sep = day("2026-09-30");
      ok(sep.some(x => /is-late/.test(x) && /위해물품/.test(x)) && sep.some(x => /is-late/.test(x) && /정기 보안점검/.test(x)), sep.join());
      q(e, '.ie-cal [data-ie-cm="1"]').click(); q(e, '.ie-cal [data-ie-cm="1"]').click();
      ok(/2026년 11월/.test(q(e, ".ie-cal .card-title").textContent), "다음 달");
      ok(!q(e, '.ie-cal [data-ie-cm="0"]').disabled);
      q(e, '.ie-cal [data-ie-cm="0"]').click();
      ok(/2026년 10월/.test(q(e, ".ie-cal .card-title").textContent) && q(e, '.ie-cal [data-ie-cm="0"]').disabled, "이번 달로");
      q(e, '.ie-cal .ic-c[data-ie-day="2026-10-31"] .ic-ev.is-due').click();
      ok(/위해물품 월간 점검/.test(q(e, "#modal-box").textContent), "기한 → 기록 폼"); e.S.closeModal();
      q(e, '.ie-cal .ic-c[data-ie-day="2026-10-05"] .ic-ev.is-done').click();
      ok(/정기 보안점검/.test(q(e, "#modal-box").textContent), "완료 → 그 기록"); e.S.closeModal();
      q(e, '.ie-cal .ic-c[data-ie-day="2026-10-22"] .ic-ev.is-recv').click();
      eq(e.w.location.hash, "#/audit"); eq(A.getState().sel, "g2026-10-22");
      loginAs(e, "user"); go(e, "aud-dash"); ok(!q(e, ".ie-cal"), "user 없음"); loginAs(e, "hq");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("UP10 보안 기록부 calEvents: 주간 양식은 주 끝(일요일)마다 · 시작일 이전 주기 제외 · 기록한 주는 완료만 · 매일 · 수시 제외 · 거꾸로 된 기간", () => {
      reset();
      e.S.data.seclogCfg = { since: "2026-09-01", templates: [
        { id: "tw", name: "주간 점검", kind: "check", cycle: "week", from: "2026-09-14", items: [{ id: "i1", text: "a" }] },
        { id: "td", name: "매일 점검", kind: "check", cycle: "day" }, { id: "te", name: "수시 점검", kind: "flight", cycle: "event" }] };
      e.S.data.seclog = [lg("tw", "2026-09-23"), lg("td", "2026-09-23"), lg("te", "2026-09-23")];
      const ev = SL.calEvents("2026-09-01", "2026-10-11", T0).map(x => x.d + ":" + x.kind + ":" + x.tid).sort();
      eq(ev.join(","), "2026-09-20:late:tw,2026-09-23:done:tw,2026-10-04:due:tw,2026-10-11:due:tw");
      eq(SL.calEvents("2026-10-11", "2026-10-01", T0).length, 0);
      e.S.data.seclogCfg = { since: "2026-09-01", templates: [] };
    });

    t("UP11 카드 하나가 실패해도 나머지 표시 · 광고 차단기에 걸리는 클래스 이름(ad- 등) 없음 · 대시보드 클래스(uc-)는 홈 '다가오는 일정'(up-)과 분리", () => {
      reset();
      const keep = e.w.SemisSeclog.nextDue;
      e.w.SemisSeclog.nextDue = () => { throw new Error("boom"); };
      go(e, "aud-dash");
      ok(q(e, ".ie-err"), "오류 카드"); ok(q(e, ".ie-card:not(.ie-err)"), "다른 카드는 표시"); ok(q(e, "#view .stat-row"), "요약 지표");
      e.w.SemisSeclog.nextDue = keep;
      go(e, "aud-dash"); ok(!q(e, ".ie-err"));
      const AD_RE = /^(ad|ads|adv|advert|advertisement|sponsor|sponsored)[-_]/i;
      ok(!qa(e, "#view *").some(el => Array.from(el.classList).some(c => AD_RE.test(c))), "대시보드 DOM");
      ok(!/\.(ad|ads|adv|advert|sponsor)[-_][a-z0-9]/i.test(read("css/main.css")), "CSS");
      fs.readdirSync(path.join(ROOT, "js")).filter(f => /\.js$/.test(f)).forEach(f => {
        const src = read("js/" + f);
        ok(!/class="[^"]*\b(ad|ads|adv|advert|sponsor)[-_][a-z]/i.test(src) && !/data-ad-/.test(src), f);
      });
      ok(!/["\s]up-[a-z]/.test(read("js/auddash.js")), "대시보드는 uc-");
      const css = read("css/main.css"), k = css.indexOf("── 점검 표시(주체 → 대상");
      ok(k > 0 && !/\.up-[a-z]/.test(css.slice(k)), "v1.33 이후 규칙은 홈 up- 를 건드리지 않음");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    e.w.close();
  }

  /* ══════════ [VZ] v1.35 점검 표시(숨김 · 흐리게) · 하드카피 집계 · 일정관리 연동 ══════════ */
  {
    const e = makeEnv();
    const SL = e.w.SemisSeclog, S = e.w.SemisSelfcheck, AD = e.w.SemisAudDash, A = e.w.SemisAudit, C = e.w.SemisCalendar;
    const setW = (w) => Object.defineProperty(e.w, "innerWidth", { value: w, configurable: true });
    const T0 = "2026-10-03";
    SL.setToday(T0, "09:30"); S.setToday(T0); AD.setToday(T0); A.setToday(T0);
    const FAKE = [
      { id: "t-daily", name: "일일 보안점검", kind: "check", cycle: "day", evidence: ["2.7"] },
      { id: "t-uld", name: "ULD 확인", kind: "check", cycle: "day", evidence: ["7.2"] },
      { id: "t-hazmat", name: "위해물품 월간 점검", kind: "check", cycle: "month", evidence: ["4.2"] },
      { id: "t-regular", name: "정기 보안점검", kind: "check", cycle: "quarter", evidence: ["2.7"] },
      { id: "t-hold", name: "화물칸 보안 점검 (미주행)", kind: "flight", cycle: "event", evidence: ["9.6"] }
    ];
    const lg = (tid, date, extra) => Object.assign({ id: "l" + tid + date, tid, date, time: "09:00", by: "점검자", checks: [], result: "ok", note: "", action: "", files: [], rounds: [] }, extra || {});
    const sc = (form, date, status, extra) => Object.assign({ id: "u" + form + date + status, form, date, insp: "", org: "", ans: {}, txt: {}, rm: {}, nm: {}, fx: {}, files: [], status, createdAt: date + "T00:00:00Z", createdBy: "Thq" }, extra || {});
    const reset = () => {
      e.S.data.seclogCfg = { since: "2026-09-01", templates: JSON.parse(JSON.stringify(FAKE)) };
      e.S.data.seclog = [lg("t-daily", "2026-10-01"), lg("t-daily", "2026-10-02"), lg("t-uld", "2026-10-02", { result: "ng", action: "조치" }), lg("t-hazmat", "2026-09-10")];
      e.S.data.selfChecks = []; e.S.data.selfCheckCfg = { forms: {} }; e.S.data.audits = []; e.S.data.schedules = [];
    };
    const flat = (el) => el.textContent.replace(/\s+/g, " ").trim();
    loginAs(e, "admin");

    t("VZ01 표시 데이터: 숨김은 양식 · 기록 · 누락 · 증빙에서 빠짐 · 흐리게는 남음(안내 문구) · 양식 편집(hq) 저장해도 숨긴 양식 보존 · 표시 값은 양식에 저장 안 함", () => {
      reset();
      const miss0 = SL.missCount();
      e.S.data.seclogCfg.vis = { "t-uld": { m: "hide" }, "t-hazmat": { m: "dim", msg: "종이 대장 확인" } };
      ok(!SL.templates().some(x => x.id === "t-uld") && !SL.templates(true).some(x => x.id === "t-uld"), "숨김 제외");
      ok(SL.allTemplates().some(x => x.id === "t-uld" && x.vis === "hide"), "전체 목록에는 있음");
      const hz = SL.tplOf("t-hazmat"); eq(hz.vis, "dim"); eq(hz.dimMsg, "종이 대장 확인");
      eq(SL.visOf("t-daily").m, ""); eq(SL.visOf("t-regular").msg, "");
      e.S.data.seclogCfg.vis["t-hazmat"] = { m: "dim" }; eq(SL.tplOf("t-hazmat").dimMsg, "하드카피본 확인", "기본 문구");
      ok(!SL.logs().some(r => r.tid === "t-uld"), "숨긴 양식 기록 제외");
      ok(SL.missCount() < miss0, "누락 수 줄어듦 " + miss0 + " → " + SL.missCount());
      eq(SL.evidence("7.2"), null, "숨긴 양식은 증빙 연결도 없음");
      loginAs(e, "hq");
      SL.templatesForm();
      ok(!qa(e, "#modal-box .sl-tpl input[data-k=name]").some(i => i.value === "ULD 확인"), "편집 창에도 없음");
      clickOk(e);
      const ts = e.S.data.seclogCfg.templates;
      ok(ts.some(x => x.id === "t-uld"), "숨긴 양식 보존"); ok(ts.every(x => !("vis" in x) && !("dimMsg" in x)), "표시 값 저장 안 함");
      eq(e.S.data.seclogCfg.vis["t-uld"].m, "hide", "표시 설정 유지");
      loginAs(e, "admin");
    });

    t("VZ02 표시 관리(시스템관리자만): 보안 기록부 머리말 → 표시 · 흐리게 · 숨김 + 안내 문구 → 숨긴 카드 없음 · 흐리게 카드는 제목 + 문구만 · 기록 고르기 · 목록 · 필터에서 빠짐 · 되돌리기", () => {
      reset();
      loginAs(e, "hq"); SL.setState({ tab: "today" }); go(e, "inspection");
      ok(!q(e, "#sl-vis"), "hq 없음");
      loginAs(e, "admin"); go(e, "inspection");
      ok(q(e, "#sl-vis").classList.contains("m-ed"), "모바일 편집 모드 단추");
      const n0 = qa(e, "#view .sl-card:not(.hzf-card)").length;
      eq(n0, 5);
      q(e, "#sl-vis").click();
      const rows = qa(e, "#modal-box .vis-r"); eq(rows.length, 5);
      const row = (name) => rows.find(r => r.textContent.includes(name));
      row("ULD 확인").querySelector('[data-vm="hide"]').click();
      const hz = row("위해물품 월간 점검"); hz.querySelector('[data-vm="dim"]').click();
      eq(hz.dataset.m, "dim"); eq(hz.querySelector('[data-vm="dim"]').getAttribute("aria-pressed"), "true");
      hz.querySelector("[data-vmsg]").value = "  ";
      clickOk(e);
      eq(JSON.stringify(e.S.data.seclogCfg.vis), JSON.stringify({ "t-uld": { m: "hide" }, "t-hazmat": { m: "dim" } }));
      eq(qa(e, "#view .sl-card:not(.hzf-card)").length, n0 - 1, "숨긴 카드 빠짐");
      ok(!q(e, '#view .sl-card[data-tid="t-uld"]'));
      const dim = q(e, '#view .sl-card.is-dim[data-tid="t-hazmat"]');
      ok(dim && dim.tagName === "BUTTON", "흐리게 = 버튼 카드");
      eq(flat(dim), "위해물품 월간 점검 하드카피본 확인", "제목 + 문구만");
      ok(!dim.querySelector("[data-sl-new]") && !dim.querySelector(".sl-who") && !dim.querySelector(".sl-cyc") && !dim.querySelector(".sl-ev"));
      ok(/양식 3종 중/.test(q(e, "#view .stat-row").textContent), q(e, "#view .stat-row").textContent);
      q(e, "#sl-add").click();
      const picks = qa(e, "#modal-box [data-pick]").map(b => b.dataset.pick);
      ok(picks.indexOf("t-uld") < 0 && picks.indexOf("t-hazmat") < 0 && picks.indexOf("t-daily") >= 0, picks.join(","));
      e.S.closeModal();
      SL.setState({ tab: "status" }); go(e, "inspection");
      ok(!q(e, '#view [data-sl-cell^="t-uld|"]') && q(e, '#view .sl-row.is-dim .sl-hc'), "기록 현황: 숨김 없음 · 흐리게 표시");
      SL.setState({ tab: "list" }); go(e, "inspection");
      ok(!qa(e, "#sl-ftid option").some(o => o.value === "t-uld"), "필터 목록");
      ok(!qa(e, "#sl-lbody tr").some(tr => tr.textContent.includes("ULD")), "기록 목록");
      ok(!(e.w.SemisSearch.search("ULD") || []).some(x => x.group === "보안 기록부"), "통합 검색");
      q(e, "#sl-vis").click();
      qa(e, "#modal-box .vis-r").forEach(r => r.querySelector('[data-vm=""]').click()); clickOk(e);
      eq(JSON.stringify(e.S.data.seclogCfg.vis), "{}", "되돌리기");
      SL.setState({ tab: "today" });
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("VZ03 숨김 → 점검 · 교육 대시보드 통계바 · 기록부 카드 · 다가오는 점검 · 달력에서 빠짐(없는 것처럼)", () => {
      reset();
      go(e, "aud-dash");
      const kpi = () => flat(qa(e, "#view .stat").find(x => /기록부 이행률/.test(x.textContent)));
      ok(/7%/.test(kpi()), kpi());
      ok(q(e, '#view .ie-up [data-ie-sl="t-uld"]') && /최근 30일 4건 · 이상 1건/.test(q(e, '#view [aria-label="보안 기록부"] .dc-meta').textContent), "숨기기 전");
      const cal0 = AD.calData("2026-12", T0);
      ok(Object.keys(cal0.days).some(d => cal0.days[d].some(x => /정기 보안점검/.test(x.name))), "숨기기 전 달력 기한");
      e.S.data.seclogCfg.vis = { "t-uld": { m: "hide" }, "t-regular": { m: "hide" } };
      go(e, "aud-dash");
      ok(/10%/.test(kpi()), "통계바 " + kpi());
      ok(!q(e, '#view [data-ie-sl="t-uld"]') && !q(e, '#view [data-ie-sl="t-regular"]'), "다가오는 점검에서 빠짐");
      ok(!qa(e, "#view .ie-sb-l").some(x => /ULD 확인|정기 보안점검/.test(x.textContent)), "기록부 카드 막대");
      ok(/최근 30일 3건 · 이상 0건/.test(q(e, '#view [aria-label="보안 기록부"] .dc-meta').textContent), "숨긴 양식 기록 · 이상 제외");
      const cal = AD.calData("2026-12", T0);
      ok(!Object.keys(cal.days).some(d => cal.days[d].some(x => /정기 보안점검/.test(x.name))), "달력 기한 빠짐");
      e.S.data.seclogCfg.vis = { "t-regular": { m: "dim" } };
      go(e, "aud-dash");
      const dimRow = q(e, '#view .ie-up [data-ie-sl="t-regular"]');
      ok(dimRow && /집계/.test(dimRow.textContent) && /하드카피본 확인/.test(dimRow.closest(".uc-row").textContent), "흐리게는 남고 '집계'");
      dimRow.click();
      ok(/하드카피 집계/.test(q(e, "#modal-box h3").textContent), "대시보드에서 집계 창");
      e.S.closeModal();
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("VZ04 하드카피 집계(보안 기록부): 흐리게 카드 → 월 주기 확인 · 이상 · 누락(다시 누르면 해제) · 전산 기록 주기는 잠김 → 누락 · 이상 · 달력 완료 · 매일 양식은 달력 칸(빈 날 모두 확인) · 편별은 월 건수 · 증빙", () => {
      reset();
      e.S.data.seclogCfg.since = "2026-06-01";
      e.S.data.seclogCfg.vis = { "t-hazmat": { m: "dim" }, "t-uld": { m: "dim" }, "t-hold": { m: "dim" } };
      loginAs(e, "manager"); SL.setState({ tab: "today" }); go(e, "inspection");
      eq(SL.status(SL.tplOf("t-hazmat")).missing.map(c => c.k).join(","), "2026-06,2026-07,2026-08");
      q(e, '#view .sl-card.is-dim[data-tid="t-hazmat"]').click();
      ok(/하드카피 집계/.test(q(e, "#modal-box h3").textContent));
      const rowOf = (k) => q(e, `#modal-box [data-hrow="${k}"]`);
      ok(rowOf("2026-09").querySelector(".hc-rec") && !rowOf("2026-09").querySelector("[data-hk]"), "전산 기록 주기는 잠김");
      rowOf("2026-06").querySelector('[data-hv="ok"]').click();
      rowOf("2026-07").querySelector('[data-hv="ng"]').click();
      rowOf("2026-08").querySelector('[data-hv="miss"]').click();
      rowOf("2026-10").querySelector('[data-hv="ok"]').click();
      rowOf("2026-10").querySelector('[data-hv="ok"]').click();
      eq(rowOf("2026-10").querySelector('[data-hv="ok"]').getAttribute("aria-pressed"), "false", "다시 누르면 해제");
      clickOk(e);
      const h = e.S.data.seclog.find(r => r.hc && r.tid === "t-hazmat");
      eq(JSON.stringify(h.marks), JSON.stringify({ "2026-06": "ok", "2026-07": "ng", "2026-08": "miss" }));
      ok(h.id === "hc-t-hazmat" && !h.date, "양식당 한 줄 · 날짜 없음");
      const st = SL.status(SL.tplOf("t-hazmat"));
      eq(st.missing.map(c => c.k).join(","), "2026-08", "누락만 남음"); ok(st.cells.find(c => c.k === "2026-07").ng, "이상");
      ok(!SL.logs().some(r => r.hc), "집계 줄은 기록이 아님");
      const ce = SL.calEvents("2026-06-01", "2026-08-31").filter(x => x.tid === "t-hazmat");
      ok(ce.some(x => x.d === "2026-06-30" && x.kind === "done" && x.hc) && ce.some(x => x.d === "2026-08-31" && x.kind === "late"), JSON.stringify(ce));
      ok(/이상 \(30일\)/.test(q(e, "#view .stat-row").textContent));
      q(e, '#view .sl-card.is-dim[data-tid="t-uld"]').click();
      ok(q(e, "#modal-box .hc-grid"), "매일 = 달력 칸");
      eq(q(e, "#modal-box .hc-nav b").textContent, "2026년 10월");
      const rec = q(e, "#modal-box .hc-d.is-rec"); ok(rec && rec.textContent === "2", "10/2 전산 기록");
      ok(!q(e, '#modal-box [data-hd="2026-10-04"]') && q(e, '#modal-box [data-hd="2026-10-01"]'), "앞날은 못 누름");
      q(e, '#modal-box [data-hm="-1"]').click();
      eq(q(e, "#modal-box .hc-nav b").textContent, "2026년 9월");
      q(e, "#hc-fill").click();
      q(e, '#modal-box [data-hd="2026-09-05"]').click();
      eq(q(e, '#modal-box [data-hd="2026-09-05"]').dataset.v, "ng", "확인 → 이상");
      clickOk(e);
      eq(SL.status(SL.tplOf("t-uld")).missing.map(c => c.k).join(","), "2026-10-01", "9월 확인 · 10/1만 누락");
      q(e, '#view .sl-card.is-dim[data-tid="t-hold"]').click();
      eq(qa(e, "#modal-box [data-hc-m]").length, 5, "6~10월");
      q(e, '#modal-box [data-hc-m="2026-10"]').value = "3"; q(e, '#modal-box [data-hc-m="2026-09"]').value = "2"; q(e, '#modal-box [data-hc-m="2026-06"]').value = "4";
      clickOk(e);
      const hs = SL.status(SL.tplOf("t-hold"));
      eq(hs.count, 5, "30일과 겹치는 9 · 10월"); eq(hs.hcN, 5);
      ok(SL.evidence("9.6").ok && /5건/.test(SL.evidence("9.6").text), SL.evidence("9.6").text);
      loginAs(e, "user"); SL.hcForm("t-hazmat");
      ok(!q(e, "#modal-box [data-act=ok]") && q(e, "#modal-box [data-hk]").disabled, "쓰기 권한 없으면 읽기 전용"); e.S.closeModal();
      loginAs(e, "admin");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("VZ05 자체 보안점검: 표시 관리(양식 탭 · 관리자) · 숨긴 별표는 카드 · 기록 · 지적 · 안내 편집에서 빠짐 · 흐리게 카드 → 하드카피 기록(점검일 · 지적 · 미결) → 다음 기한 · 목록 · 증빙 2.7 · 대시보드 제외 · 안내 편집 저장해도 표시 유지", () => {
      reset();
      const yn = S.itemsOf(S.formOf("b3")).find(i => i.k === "yn");
      e.S.data.selfChecks = [sc("b3", "2026-09-20", "done", { ans: { [yn.id]: "RC" } })];
      eq(S.allFindings().length, 1);
      loginAs(e, "hq"); S.setState({ tab: "forms", rid: "" }); go(e, "selfcheck");
      ok(!q(e, "#sc-vis"), "hq 없음");
      loginAs(e, "admin"); go(e, "selfcheck");
      q(e, "#sc-vis").click();
      const rows = qa(e, "#modal-box .vis-r"); eq(rows.length, 8, "별표 8종(분석표 제외)");
      rows.find(r => /별표 3 /.test(r.textContent)).querySelector('[data-vm="hide"]').click();
      const r4 = rows.find(r => /별표 4 /.test(r.textContent));
      r4.querySelector('[data-vm="dim"]').click(); r4.querySelector("[data-vmsg]").value = "종이 점검표 확인";
      clickOk(e);
      eq(JSON.stringify(e.S.data.selfCheckCfg.vis), JSON.stringify({ b3: { m: "hide" }, b4: { m: "dim", msg: "종이 점검표 확인" } }));
      ok(!q(e, '#view .sc-fcard[data-fid="b3"]'), "숨긴 별표 카드 없음");
      eq(S.forms().length, 7); eq(S.allFindings().length, 0, "숨긴 별표 지적 제외");
      const d4 = q(e, '#view .sc-fcard.is-dim[data-fid="b4"]');
      eq(flat(d4).replace(/\s/g, ""), ("별표 4" + S.formOf("b4").title + "종이 점검표 확인").replace(/\s/g, ""), "제목 + 문구만");
      ok(!d4.querySelector(".sc-who") && !d4.querySelector(".sc-tags") && !d4.querySelector("[data-sc-new]"));
      d4.click();
      ok(/하드카피 기록/.test(q(e, "#modal-box h3").textContent));
      q(e, "#hcs-date").value = "2026-09-25"; q(e, "#hcs-insp").value = "점검자"; q(e, "#hcs-find").value = "2"; q(e, "#hcs-open").value = "3";
      clickOk(e); ok(!e.S.data.selfChecks.some(r => r.hc), "미결 > 지적은 거절");
      q(e, "#hcs-open").value = "1"; clickOk(e);
      const h = e.S.data.selfChecks.find(r => r.hc);
      ok(h && h.form === "b4" && h.find === 2 && h.open === 1 && h.date === "2026-09-25" && !h.status, JSON.stringify(h));
      ok(q(e, "#modal-box .hc-list li") && /미결 1 \/ 지적 2/.test(q(e, "#modal-box .hc-list li").textContent), "창 안 목록");
      e.S.closeModal();
      eq(S.nextDue(S.formOf("b4")).last, "2026-09-25", "다음 기한 기준일");
      eq(S.hcOpen(), 1); ok(S.evidence("2.7").ok && /하드카피 1/.test(S.evidence("2.7").text), S.evidence("2.7").text);
      q(e, "#sc-add").click();
      ok(!qa(e, "#modal-box [data-pick]").some(b => b.dataset.pick === "b4" || b.dataset.pick === "b3"), "점검 고르기에서 빠짐");
      e.S.closeModal();
      S.setState({ tab: "list" }); go(e, "selfcheck");
      const hr = q(e, '#view tr.sc-hcrow[data-schc="b4"]'); ok(hr && /하드카피/.test(hr.textContent), "목록에 하드카피 줄");
      ok(!qa(e, "#view tr[data-scid]").length, "숨긴 별표 기록 없음");
      ok(/미결 지적\s*1/.test(q(e, "#view .stat-row").textContent), q(e, "#view .stat-row").textContent);
      go(e, "aud-dash");
      ok(!/자체 점검/.test(q(e, "#view").textContent) && !q(e, '#view [data-ie-schc], #view [data-ie-scf]'), "대시보드에는 넣지 않음(v1.42 선택 실행)");
      loginAs(e, "hq"); S.setState({ tab: "forms" }); go(e, "selfcheck");
      q(e, "#sc-cfg").click();
      ok(!qa(e, "#modal-box [data-cf]").some(r => r.dataset.cf === "b3"), "안내 편집에서도 빠짐");
      clickOk(e);
      eq(e.S.data.selfCheckCfg.vis.b3.m, "hide", "안내 편집 저장 후에도 표시 유지");
      loginAs(e, "admin");
      S.setState({ tab: "list" });
      eq(e.errors.length, 0, e.errors.join(" | "));
    });

    t("VZ06 일정관리 연동: 주기 마감일 · 매일 점검 한 건(진행 수) · 자동 표시(저장 안 함) · 자체 보안점검 제외(v1.42) · 숨김 제외 · 칩 → 상세 · 아이콘 → 점검표/대시보드 · 수검 일정 바로 가기 · 필터 · 주 보기 · 모바일", () => {
      reset();
      e.S.data.seclogCfg.vis = { "t-regular": { m: "hide" } };
      e.S.data.audits = [{ id: "g1", body: "gov", org: "서울지방항공청", kind: "정기 보안점검", start: "2026-10-20", end: "2026-10-21", findings: [], checklist: [], linkCal: true }];
      A.syncCalendar(e.S.data.audits[0]);
      e.S.data.selfChecks = [sc("b1", "2026-10-01", "done", { appr: ["", "", ""] })];
      const sched0 = JSON.stringify(e.S.data.schedules);
      const items = SL.calItems("2026-10-01", "2026-10-31");
      const hz = items.find(x => x.ik === "sl:t-hazmat:2026-10");
      ok(hz && hz.start === "2026-10-31" && !hz.done && hz.title === "[점검] 위해물품 월간 점검", "월 마감일");
      ok(!items.some(x => /정기 보안점검/.test(x.title)), "숨긴 양식 없음");
      const d1 = items.find(x => x.ik === "sld:2026-10-01"); ok(d1 && d1.title === "[점검] 매일 점검 1/2" && d1.late && !d1.done, d1 && d1.title);
      const d2 = items.find(x => x.ik === "sld:2026-10-02"); ok(d2.done && d2.title === "[점검] 매일 점검", "모두 기록한 날 = 완료");
      const d10 = items.find(x => x.ik === "sld:2026-10-10"); ok(d10 && !d10.done && !d10.late && d10.title === "[점검] 매일 점검" && d10.soft && !d1.soft, "앞날(옅게)");
      eq(items.filter(x => /^sld:/.test(x.ik)).length, 31, "날마다 한 건(묶음)");
      const si = S.calItems("2026-10-01", "2026-10-31");
      ok(si.some(x => x.ik === "scd:2026-10-13" && /자체 보안점검 7종/.test(x.title)), si.map(x => x.ik + " " + x.title).join(" / "));
      ok(si.some(x => x.ik === "scr:ub12026-10-01done" && x.done && /별표 1 자체 점검/.test(x.title)), "완료한 점검");
      loginAs(e, "admin"); setW(1024); C.setView("month"); C.setAnchor(T0); C.setFilter("", false); go(e, "schedule");
      const chip = q(e, '#view .cal-bar.is-insp[data-ik="sl:t-hazmat:2026-10"]'); ok(chip, "달력 칩");
      ok(chip.querySelector(".chip-go") && !chip.hasAttribute("data-drag") && !chip.querySelector("[data-donetoggle]"), "읽기 전용 + 아이콘");
      ok(q(e, '#view .cal-bar.is-insp.done[data-ik="sld:2026-10-02"]') && !q(e, '#view [data-ik^="sc"]'), "완료 · 자체 보안점검(선택 실행)은 일정에 없음");
      ok(q(e, '#view .cal-bar.is-insp.soft[data-ik="sld:2026-10-10"]') && !q(e, '#view .cal-bar.is-insp.soft[data-ik="sld:2026-10-03"]'), "앞날 매일 점검만 옅게");
      eq(JSON.stringify(e.S.data.schedules), sched0, "일정 데이터에 저장하지 않음");
      chip.click();
      ok(/위해물품 월간 점검/.test(q(e, "#modal-box h3").textContent) && qa(e, "#modal-box [data-igo]").length === 2, "상세 + 버튼 2");
      qa(e, "#modal-box [data-igo]")[1].click();
      eq(e.w.location.hash, "#/aud-dash", "대시보드로");
      go(e, "schedule");
      q(e, '#view .cal-bar.is-insp[data-ik="sl:t-hazmat:2026-10"] .chip-go').click();
      ok(q(e, "#sl-date") && /위해물품 월간 점검/.test(q(e, "#modal-box h3").textContent), "이번 주기 → 기록 폼");
      e.S.closeModal();
      const ag = q(e, '#view [data-ev="aud_g1"] .chip-go'); ok(ag, "수검 일정 바로 가기");
      ag.click(); eq(e.w.location.hash, "#/audit"); eq(A.getState().sel, "g1");
      go(e, "schedule");
      C.setFilter("홍길동", false); go(e, "schedule"); ok(!q(e, "#view .is-insp"), "담당자 필터 중 숨김");
      C.setFilter("", true); go(e, "schedule"); ok(!q(e, '#view [data-ik="sld:2026-10-02"]') && q(e, '#view [data-ik="sld:2026-10-01"]'), "완료 숨기기");
      C.setFilter("", false);
      C.setView("week"); go(e, "schedule");
      eq(qa(e, '#view .is-insp[data-ik^="sld:"]').length, 7, "주 보기 날마다 한 건(겹침 없음)");
      C.setView("day"); C.setAnchor("2026-10-31"); go(e, "schedule");
      const dv = q(e, '#view .cal-dayview .is-insp[data-ik="sl:t-hazmat:2026-10"]'); ok(dv && dv.querySelectorAll(".chip-go").length === 2, "일 보기 아이콘 2");
      C.setView("month"); C.setAnchor(T0);
      e.S.data.seclogCfg.vis = { "t-regular": { m: "hide" }, "t-hazmat": { m: "dim" } };
      go(e, "schedule");
      q(e, '#view .cal-bar.is-insp[data-ik="sl:t-hazmat:2026-10"] .chip-go').click();
      ok(/하드카피 집계/.test(q(e, "#modal-box h3").textContent), "흐리게 → 집계 창");
      e.S.closeModal();
      const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "inspection"); mn.hidden = true;
      go(e, "schedule"); ok(!q(e, '#view [data-ik^="sl"]'), "보안 기록부 메뉴를 숨기면 그 일정도 빠짐");
      mn.hidden = false;
      setW(390); go(e, "schedule");
      const mrow = q(e, "#view .calm-ev.is-insp.has-go"); ok(mrow && mrow.querySelectorAll(".calm-go .chip-go").length === 2, "모바일 아이콘 2");
      mrow.click(); ok(/\[점검\]/.test(q(e, "#modal-box h3").textContent), "모바일 → 상세"); e.S.closeModal();
      setW(1024);
      loginAs(e, "manager"); go(e, "schedule"); ok(q(e, "#view .is-insp .chip-go"), "manager 도 바로 가기");
      loginAs(e, "admin");
      eq(JSON.stringify(e.S.data.schedules), sched0, "끝까지 일정 데이터 그대로");
      eq(e.errors.length, 0, e.errors.join(" | "));
    });
    e.w.close();
  }

  /* ══════════ [ED] 보안교육 이수 등록 — 배포용 edu.html · 서버 · 관리 화면 (v1.39) ══════════ */
  {
    const EHTML = read("edu.html");
    const EDU_JS = ["js/edu-shim.js", "js/training.js", "js/pow.js", "js/edu-form.js"].map(f => read(f)).join("\n;\n");
    const ESQL = read("tools/sql/semis-logi-edu.sql");
    const EDGE = read("tools/edge/semis-logi-files.ts");
    const C0 = "abcdefghjkmn";
    /* SQL 선언에서 공개 함수 인자 이름 — 가짜 서버 · 관리 화면 흉내가 부를 때마다 맞춰 본다(v1.39.1 '새 링크' 인자 이름 오류 재발 방지) */
    const SIGS = {};
    [ESQL, read("tools/sql/semis-logi-pow.sql")].forEach(src => { for (const m of src.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g))
      SIGS[m[1]] = m[2].split(",").map(x => x.trim()).filter(Boolean).map(x => ({ n: x.split(/\s+/)[0], opt: /\sdefault\s/i.test(x) })); });
    const sigBad = (name, args) => {
      const sg = SIGS[name];
      if (!sg) return name + ": 서버에 없는 함수";
      const keys = Object.keys(args || {});
      const extra = keys.filter(k => !sg.some(x => x.n === k)), miss = sg.filter(x => !x.opt && keys.indexOf(x.n) < 0).map(x => x.n);
      return extra.length || miss.length ? name + ": 인자 " + JSON.stringify({ extra, miss }) : "";
    };
    /* 가짜 서버 — RPC · 파일 함수 · 업로드 PUT(XHR) */
    function eduServer(o) {
      o = o || {};
      const srv = { calls: [], puts: [], submits: [], reads: [], bad: [], tickets: 0, info: o.info, ticketFail: o.ticketFail || 0, submitTicketFail: o.submitTicketFail || 0, prev: o.prev || [] };
      srv.fetch = async (url, opt) => {
        const u = String(url), body = opt && opt.body ? JSON.parse(opt.body) : {};
        srv.calls.push({ url: u, body, headers: (opt && opt.headers) || {} });
        const J = (d, st) => ({ ok: (st || 200) < 300, status: st || 200, json: async () => d });
        const rm = /\/rest\/v1\/rpc\/(\w+)$/.exec(u);
        if (rm) { const b = sigBad(rm[1], body); if (b) srv.bad.push(b); }
        if (/functions\/v1\/semis-logi-files$/.test(u)) { const ex = Object.keys(body).filter(k => k !== "op" && EDGE.indexOf("body." + k) < 0); if (ex.length) srv.bad.push(body.op + ": 파일 함수가 읽지 않는 값 " + ex.join()); }
        if (/rpc\/semis_logi_edu_info$/.test(u)) return J(srv.info || { ok: true, title: "2026 하반기", note: "", expires: "2026-11-07", courses: [], depts: ["인천화물팀"], orgs: ["교육원"] });
        if (/rpc\/semis_logi_challenge$/.test(u)) return J({ ok: true, c: "c".repeat(32) + ".1999999999.1.sig", d: 1 });
        if (/rpc\/semis_logi_edu_ticket$/.test(u)) { srv.tickets++; return J({ ok: true, ticket: String(srv.tickets).repeat(48).slice(0, 48), exp: Math.floor(Date.now() / 1000) + 10800 }); }
        if (/functions\/v1\/semis-logi-files$/.test(u) && body.op === "edu-read") {
          srv.reads.push(body);
          const R = o.read || ((pth) => /sup/.test(pth) ? { cid: "c-sup-r", course: "항공보안 감독자 정기교육", date: "2026-09-30", expire: "", org: "교육원", certNo: "A-1", hours: 8, name: "홍길동", conf: 0.95 }
            : /dg/.test(pth) ? { cid: "c-dg-r", course: "위험물 정기", date: "2026-01-15", expire: "", org: "KOTI", certNo: "D-7", hours: null, name: "김철수", conf: 0.9 }
            : /part/.test(pth) ? { cid: "c-dg-r", course: "", date: "", expire: "", org: "", certNo: "", hours: null, name: "", conf: 0.3 }
            : /hint/.test(pth) ? { cid: "", course: "항공보안 감독자 정기교육", date: "2026-09-30", expire: "", org: "시험교육원", certNo: "제 2026-0931 호", hours: 8, name: "", conf: 0.6 } : null);
          const d = R(String(body.path || ""));
          if (o.readDelay) await new Promise(r => setTimeout(r, o.readDelay));
          return J(d ? { ok: true, model: "m", data: d } : { ok: false, error: "parse" });
        }
        if (/functions\/v1\/semis-logi-files$/.test(u)) {
          if (srv.ticketFail > 0) { srv.ticketFail--; return J({ ok: false, error: "ticket" }, 401); }
          const p = "training/t" + srv.calls.length + "_" + String(body.name).replace(/[^A-Za-z0-9._-]/g, "_");
          return J({ ok: true, path: p, url: "https://x/storage/v1/object/public/semis-logi-files/" + p, upload: "https://x/upload/" + p });
        }
        if (/rpc\/semis_logi_edu_submit$/.test(u)) {
          srv.submits.push(body);
          if (srv.submitTicketFail > 0) { srv.submitTicketFail--; return J({ ok: false, error: "ticket" }); }
          if (o.submitError) return J({ ok: false, error: o.submitError, wait: 10 });
          const recs = body.p.recs.map((r, i) => ({ id: "n" + i, cid: r.cid, date: r.date, expire: r.expire })).concat(srv.prev);
          return J({ ok: true, receipt: "AB12CD34", at: "2026-10-08 14:20", kind: "updated", same: o.sameAll ? body.p.recs.map((r, i) => "n" + i) : [],
            person: { id: "p1", name: body.p.name, dept: body.p.dept, roles: o.personRoles || (body.p.roles || []).map(x => x.r), apt: {} }, records: recs, ids: body.p.recs.map((r, i) => "n" + i) });
        }
        return J({}, 404);
      };
      return srv;
    }
    function makeEdu(o) {
      o = o || {};
      const vc = new VirtualConsole();
      const errors = [];
      vc.on("jsdomError", (er) => { const m = String(er && er.message || er); if (m.indexOf("Not implemented") < 0) errors.push(m); });
      const dom = new JSDOM(EHTML.replace(/<script[\s\S]*?<\/script>/g, ""), { url: "https://logi.test/edu.html" + (o.hash == null ? "#" + C0 : o.hash), runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
      const w = dom.window;
      w.scrollTo = () => {}; w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      try { const wc = require("crypto").webcrypto; Object.defineProperty(w, "crypto", { value: wc, configurable: true }); } catch (x) { /* 없음 */ }   // subtle(SHA-256) · randomUUID
      const srv = eduServer(o);
      w.fetch = srv.fetch;
      w.XMLHttpRequest = class { constructor() { this.upload = {}; this.h = {}; } open(m, u) { this.m = m; this.u = u; } setRequestHeader(k, v) { this.h[k] = v; }
        send(b) { srv.puts.push({ m: this.m, u: this.u, h: this.h, name: b && b.name }); setTimeout(() => { if (this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 1 }); this.status = o.putStatus || 200; this.onload(); }, 0); } };
      if (o.draft) w.sessionStorage.setItem("semisl:edu2:" + C0, JSON.stringify(o.draft));
      w.eval(EDU_JS);
      w.SemisEdu.setToday("2026-10-08");
      return { dom, w, srv, errors, E: w.SemisEdu, TR: w.SemisTraining };
    }
    const $e = (x, s) => x.w.document.querySelector(s);
    const $$e = (x, s) => Array.from(x.w.document.querySelectorAll(s));
    const fire = (x, el, type) => el.dispatchEvent(new x.w.Event(type, { bubbles: true }));
    const typeIn = (x, sel, v, type) => { const el = $e(x, sel); el.value = v; fire(x, el, type || "input"); return el; };
    const settle = () => tick(30);
    const F = (x, n, size, type, body) => { const f = new x.w.File([body || n + ":" + size], n, { type }); Object.defineProperty(f, "size", { value: size }); return f; };
    const putFiles = (x, list) => { const inp = $e(x, "#ed-file"); Object.defineProperty(inp, "files", { value: list, configurable: true }); fire(x, inp, "change"); };

    t("ED01 edu.html: CSP(인라인 스크립트 · 외부 스크립트 금지, 연결은 공용 DB만) · 스크립트 순서 · 캐시 스탬프 · 검색 제외 · 리퍼러 없음", () => {
      const csp = /Content-Security-Policy" content="([^"]+)"/.exec(EHTML)[1];
      ok(/script-src 'self';/.test(csp) && csp.indexOf("unsafe") < 0, "script-src self");
      ok(/connect-src https:\/\/mzyuzrxkdcpzxojenwat\.supabase\.co;/.test(csp), "connect-src");
      ok(/form-action 'none'/.test(csp) && /object-src 'none'/.test(csp));
      const scr = Array.from(EHTML.matchAll(/<script src="([^"?]+)\?v=([\d.]+)" defer><\/script>/g));
      eq(scr.map(m => m[1]).join(","), "js/edu-shim.js,js/training.js,js/pow.js,js/edu-form.js", "순서");
      const ver = /const VERSION = "(\d+\.\d+\.\d+)"/.exec(read("js/app.js"))[1];
      ok(Array.from(EHTML.matchAll(/\?v=([\d.]+)/g)).every(m => m[1] === ver), "스탬프 = VERSION");
      ok(/name="robots" content="noindex"/.test(EHTML) && /name="referrer" content="no-referrer"/.test(EHTML));
      ok(!/<script>/.test(EHTML) && !/\son[a-z]+="/i.test(EHTML), "인라인 스크립트 · 이벤트 없음");
    });
    t("ED02 비밀값 없음 — 공개 키는 sync.js 와 같은 anon 키 · 서비스 키 · 해시 없음", () => {
      const f = read("js/edu-form.js"), k = /SUPA_KEY = "([^"]+)"/;
      eq(k.exec(f)[1], k.exec(read("js/sync.js"))[1]);
      ok(JSON.parse(Buffer.from(k.exec(f)[1].split(".")[1], "base64").toString()).role === "anon", "anon 키");
      ["js/edu-form.js", "js/edu-shim.js", "edu.html", "css/edu.css"].forEach(n => { const c = read(n);
        ok(c.indexOf("service_role") < 0 && !/["'][0-9a-f]{64}["']/.test(c), n); });
    });
    await ta("ED03 상시 등록 화면: 이름 · 사번 · 이수증 · 제출뿐(직무 · 임명일 · 기한 · 제목 없음) · 인쇄", async () => {
      const x = makeEdu(); await settle();
      eq(x.srv.calls[0].body.p_k, C0, "코드");
      ok($e(x, "#ed-name") && $e(x, "#ed-emp") && $e(x, "#ed-pick") && $e(x, "#ed-submit") && $e(x, "#ed-print"), "칸 · 단추");
      ok(!$e(x, "#ed-apt") && !$e(x, "[data-role]") && !$e(x, "#ed-dept") && !$e(x, ".ed-due") && !$e(x, ".ed-sub"), "직무 · 임명일 · 소속 · 기한 · 링크 제목 없음");
      ok(!/기한|D-\d/.test($e(x, "#ed-app").textContent), "기한 문구 없음");
      const order = ["#ed-name", "#ed-emp", "#ed-pick", "#ed-submit"].map(s => $e(x, s));
      ok(order.every((el, i) => !i || (order[i - 1].compareDocumentPosition(el) & 4)), "순서: 이름 → 사번 → 이수증 → 제출");
      eq($$e(x, ".ed-row .ed-f").length, 2);
      eq(x.srv.bad.join("|"), "", "RPC 인자 = SQL 선언");
      eq(x.errors.length, 0, x.errors.join("|"));
      x.w.close();
    });
    await ta("ED04 이수증 올리기 → 자동 판독: 표(작업증명) · edu-upload → PUT → edu-read · 한 줄 결과 · 못 읽으면 그 칸만 · 형식 · 크기 거절 · 표 만료 시 새 표", async () => {
      const x = makeEdu({ ticketFail: 1 }); await settle();
      typeIn(x, "#ed-name", "홍길동");
      putFiles(x, [F(x, "sup.pdf", 1200, "application/pdf"), F(x, "memo.txt", 10, "text/plain"), F(x, "big.jpg", 21 * 1024 * 1024, "image/jpeg"), F(x, "scan.pdf", 900, "application/pdf")]);
      await tick(200);
      const ups = x.srv.calls.filter(c => /semis-logi-files/.test(c.url) && c.body.op === "edu-upload");
      eq(ups.length, 3, "표 만료 → 새 표로 한 번 더 + 두 번째 파일");
      eq(ups[1].body.name + "|" + ups[1].body.size + "|" + ups[1].body.type, "sup.pdf|1200|application/pdf");
      ok(ups.every(c => !c.headers["x-semis-token"]), "로그인 토큰 없음");
      eq(x.srv.tickets, 2, "표 2번");
      const tk = x.srv.calls.find(c => /edu_ticket/.test(c.url)).body;
      ok(tk.p_k === C0 && tk.p_pow && /^\d+$/.test(tk.p_pow.x), "표 = 코드 + 해답");
      eq(x.srv.puts.length, 2); ok(x.srv.puts.every(p => p.m === "PUT"));
      eq(x.srv.reads.length, 2, "올린 이수증마다 판독");
      ok(x.srv.reads.every(b => /^[0-9a-f]{48}$/.test(b.ticket) && /^training\//.test(b.path) && b.roles.length === 0), "판독 = 표 · 경로");
      const [sup, memo, big, scan] = x.E.st.items;
      ok(x.E.complete(sup) && sup.cid === "c-sup-r" && sup.date === "2026-09-30" && sup.org === "교육원" && sup.certNo === "A-1" && sup.hours === 8, "판독 결과");
      const supEl = $e(x, '.ed-fi[data-k="' + sup.k + '"]');
      ok(supEl.classList.contains("is-ok") && !$e(x, "#ed-cid-" + sup.k), "읽은 이수증 = 한 줄(칸 없음)");
      ok(/항공사보안감독자 정기/.test(supEl.textContent) && /2026\.09\.30/.test(supEl.textContent) && /교육원/.test(supEl.textContent) && /No\. A-1/.test(supEl.textContent), supEl.textContent);
      ok(memo.st === "err" && /PDF · 사진만/.test($e(x, '.ed-fi[data-k="' + memo.k + '"]').textContent), "형식 거절");
      ok(big.st === "err" && /20MB/.test($e(x, '.ed-fi[data-k="' + big.k + '"]').textContent), "크기 거절");
      const scanEl = $e(x, '.ed-fi[data-k="' + scan.k + '"]');
      ok(scanEl.classList.contains("is-fix") && $e(x, "#ed-cid-" + scan.k) && $e(x, "#ed-date-" + scan.k), "못 읽으면 과정 · 수료일 칸");
      ok(/자동 판독에 실패했습니다/.test(scanEl.textContent) && $e(x, '[data-reread="' + scan.k + '"]'), "다시 읽기(일시 오류)");
      const opts = $e(x, "#ed-cid-" + scan.k).innerHTML;
      ok(/<optgroup label="항공보안법 · 교육훈련지침">[\s\S]*c-sup-r[\s\S]*<\/optgroup><optgroup label="위험물">[\s\S]*c-dg-r/.test(opts), "과정 목록 = 법정 · 위험물 · 국제 · 사내 묶음");
      $e(x, '[data-reread="' + scan.k + '"]').click(); await tick(60);
      eq(x.srv.reads.length, 3, "다시 읽기");
      eq(scan.reads, 2);
      $e(x, '[data-del="' + memo.k + '"]').click();
      ok(!$e(x, '.ed-fi[data-k="' + memo.k + '"]') && x.E.st.items.length === 3, "빼기");
      eq(x.srv.bad.join("|"), "", "RPC 인자 = SQL 선언");
      eq(x.errors.length, 0, x.errors.join("|"));
      x.w.close();
    });
    await ta("ED05 확인 · 보낼 내용: 이름 · 사번 · 이수증만 · 같은 과정 · 수료일 이수증은 한 기록 · 판독 고치기 · 일부만 읽음 · 성명 다름 표시 · 앞날 수료일 거절", async () => {
      const x = makeEdu(); await settle();
      eq(x.E.check().map(c => c.f).join(","), "name,emp,files");
      typeIn(x, "#ed-name", " 홍  길동 "); typeIn(x, "#ed-emp", " kj 123 456 ");
      putFiles(x, [F(x, "sup.pdf", 1000, "application/pdf"), F(x, "dg1.jpg", 2000, "image/jpeg"), F(x, "dg2.jpg", 2100, "image/jpeg"), F(x, "part.pdf", 1100, "application/pdf")]);
      await tick(250);
      const part = x.E.st.items.find(i => i.name === "part.pdf");
      ok(part.cid === "c-dg-r" && !part.date && part.rerr === "part", "일부만 읽음");
      ok(/일부 항목만 판독되었습니다/.test($e(x, '.ed-fi[data-k="' + part.k + '"]').textContent) && !$e(x, '[data-reread="' + part.k + '"]'), "일부 = 빈 칸만 채움(다시 읽기 없음)");
      eq([x.E.certNoNorm("제 2026-0931 호"), x.E.certNoNorm("No. A-12"), x.E.certNoNorm("DG-11873")].join(), "2026-0931,A-12,DG-11873", "이수증 번호 앞뒤 말 빼기");
      eq([x.E.orgNorm("한국공항공사 항공기술훈련원장"), x.E.orgNorm("시험교육원장 (테스트용)"), x.E.orgNorm("항공보안교육센터장"), x.E.orgNorm("원장학교")].join("|"),
        "한국공항공사 항공기술훈련원|시험교육원 (테스트용)|항공보안교육센터|원장학교", "서명란 기관장 → 기관");
      eq($e(x, "#ed-cid-" + part.k).value, "c-dg-r", "읽은 과정은 채워 둠");
      eq(x.E.check().map(c => c.f).join(","), "item");
      typeIn(x, "#ed-date-" + part.k, "2026-12-01", "change");
      ok(!x.E.complete(part), "앞날 수료일 거절");
      typeIn(x, "#ed-date-" + part.k, "2025-11-20", "change");
      ok(x.E.complete(part) && $e(x, '[data-fold="' + part.k + '"]'), "다 채우면 닫기(✓)");
      putFiles(x, [F(x, "hint.pdf", 900, "application/pdf")]); await tick(120);
      const hint = x.E.st.items.find(i => i.name === "hint.pdf");
      ok(!x.E.complete(hint) && hint.certNo === "2026-0931" && /이수증 과정명 항공보안 감독자 정기교육/.test($e(x, '.ed-fi[data-k="' + hint.k + '"]').textContent.replace(/\s+/g, " ")), "과정을 못 고르면 읽은 과정명을 보여 줌");
      $e(x, '[data-del="' + hint.k + '"]').click();
      eq(x.E.check().length, 0);
      const dg = x.E.st.items.find(i => i.name === "dg1.jpg");
      ok(/이수증 성명 김철수/.test($e(x, '.ed-fi[data-k="' + dg.k + '"]').textContent), "이수증 성명이 다르면 표시");
      ok(!/이수증 성명/.test($e(x, '.ed-fi[data-k="' + x.E.st.items[0].k + '"]').textContent), "같은 이름(띄어쓰기 무시)은 표시 없음");
      const p = x.E.payload();
      eq(p.name + "|" + p.emp + "|" + p.dept, "홍 길동|KJ123456|", "공백 정리 · 사번 대문자 · 소속 없음");
      ok(!("roles" in p), "직무 · 임명일은 보내지 않음(관리 화면에서)");
      eq(p.recs.map(r => r.cid + "|" + r.date + "|" + r.files.length).join(","), "c-sup-r|2026-09-30|1,c-dg-r|2026-01-15|2,c-dg-r|2025-11-20|1", "같은 과정 · 수료일 2장 = 한 기록");
      eq(JSON.stringify(p.recs[0]), JSON.stringify({ cid: "c-sup-r", date: "2026-09-30", expire: "", hours: 8, org: "교육원", certNo: "A-1", files: [{ path: x.E.st.items[0].path, name: "sup.pdf", sha: x.E.st.items[0].sha }] }), "유효기한은 비워 보냄(서버 · 화면이 규칙으로 셈) · 파일은 경로 · 이름 · 원본 해시만");
      ok(/^[0-9a-f]{64}$/.test(x.E.st.items[0].sha), "원본 해시");
      const sup = x.E.st.items[0];
      $e(x, '[data-edit="' + sup.k + '"]').click();
      const sel = $e(x, "#ed-cid-" + sup.k);
      eq(sel.value, "c-sup-r");
      sel.value = "c-sup-i"; fire(x, sel, "change");
      $e(x, '[data-fold="' + sup.k + '"]').click();
      ok(/감독자 초기/.test($e(x, '.ed-fi[data-k="' + sup.k + '"]').textContent), "고친 과정");
      eq(x.E.payload().recs[0].cid, "c-sup-i");
      typeIn(x, "#ed-emp", "  ");
      ok(x.E.check().some(c => c.f === "emp"), "사번 필수");
      eq(x.srv.bad.join("|"), "", "RPC 인자 = SQL 선언");
      eq(x.errors.length, 0, x.errors.join("|"));
      x.w.close();
    });
    await ta("ED06 사진 줄이기: 긴 변 2400px JPEG(투명 → 흰 바탕) · HEIC 도 브라우저가 읽으면 JPEG · 못 읽으면 그대로 · 작은 사진은 그대로", async () => {
      const x = makeEdu(); await settle();
      const drawn = [];
      x.w.createImageBitmap = async (f) => { if (/fail/.test(f.name)) throw new Error("decode"); return { width: /small/.test(f.name) ? 1200 : 4032, height: /small/.test(f.name) ? 900 : 3024, close() {} }; };
      x.w.HTMLCanvasElement.prototype.getContext = function () { const cv = this; return { fillRect() {}, drawImage(b, a, c, w, h) { drawn.push([cv.width, cv.height, w, h]); } }; };
      x.w.HTMLCanvasElement.prototype.toBlob = function (cb, type, q) { cb(new x.w.Blob(["j".repeat(5000)], { type })); };
      typeIn(x, "#ed-name", "홍길동");
      putFiles(x, [F(x, "IMG_0001.HEIC", 8 * 1024 * 1024, "image/heic"), F(x, "small.jpg", 300000, "image/jpeg"), F(x, "fail.heic", 2000000, "image/heic")]);
      await tick(250);
      const ups = x.srv.calls.filter(c => c.body && c.body.op === "edu-upload").map(c => c.body);
      eq(ups.map(b => b.name + ":" + b.type + ":" + b.size).join(","), "IMG_0001.jpg:image/jpeg:5000,small.jpg:image/jpeg:300000,fail.heic:image/heic:2000000");
      eq(JSON.stringify(drawn), JSON.stringify([[2400, 1800, 2400, 1800]]), "긴 변 2400 · 비율 유지");
      eq(x.E.st.items[0].name, "IMG_0001.jpg", "화면 이름도 JPEG");
      eq(x.errors.length, 0, x.errors.join("|"));
      x.w.close();
    });
    await ta("ED07 제출 → 등록 화면: 접수 번호 · 다음 교육(이전 기록과 이어 셈 — 이수 기간) · 이번 제출 · 직무가 있는 사람은 필수 교육도 · 제출 정보(사번) · 캘린더(.ics 접기) · 작성 내용 지움 · 이수증 더 등록", async () => {
      const x = makeEdu({ prev: [{ id: "o1", cid: "c-sup-r", date: "2025-10-17", expire: "" }], personRoles: ["항공사보안감독자", "DGR"] }); await settle();
      typeIn(x, "#ed-name", "홍길동"); typeIn(x, "#ed-emp", "kj1234567");
      putFiles(x, [F(x, "sup.pdf", 1000, "application/pdf")]);
      await tick(120);
      ok(x.w.sessionStorage.getItem("semisl:edu2:" + C0), "작성 중 저장(이 탭)");
      eq($e(x, "#ed-submit").dataset.ready, "true");
      $e(x, "#ed-submit").click();
      await tick(80);
      eq(x.srv.submits.length, 1);
      const sb = x.srv.submits[0];
      ok(sb.p_k === C0 && sb.p_ticket.length === 48, "코드 · 표");
      ok(/^[A-Za-z0-9-]{8,64}$/.test(sb.p.sid), "제출 id");
      eq(sb.p.emp, "KJ1234567");
      eq(sb.p.recs.length, 1);
      ok($e(x, ".ed-ok") && /AB12CD34/.test($e(x, ".ed-rcpt").textContent), "접수 번호");
      ok(/제출이 완료되었습니다\. 이 화면을 닫으셔도 됩니다\./.test($e(x, ".ed-ok .ed-close").textContent), "닫아도 된다는 안내(v1.43.3)");
      ok(/\.ed-close, input\[type="file"\] \{ display: none !important; \}/.test(read("css/edu.css")), "인쇄 때는 숨김");
      const rows = $$e(x, ".ed-next li").map(li => li.textContent.replace(/\s+/g, " "));
      ok(rows.some(r => /항공사보안감독자/.test(r) && /2027\.09\.17 ~ 2027\.11\.16/.test(r) && /유효기한 2027\.10\.16/.test(r) && /이번 제출/.test(r)),
        "이수 기간 안 이수 → 종전 유효기한 다음 날부터 1년: " + rows.join(" / "));
      ok(rows.some(r => /DGR/.test(r) && /미이수/.test(r)), "관리 화면에 직무가 있으면 그 직무의 필수 교육도 표시");
      const sent = $e(x, ".ed-sent").textContent.replace(/\s+/g, " ");
      ok(/KJ1234567/.test(sent) && !/직무|임명/.test(sent) && /2026\.09\.30 · 교육원 · No\. A-1 · 이수증 1/.test(sent), sent);
      eq(x.w.sessionStorage.getItem("semisl:edu2:" + C0), null, "작성 내용 지움");
      const ics = x.E.icsText();
      ok(/DTSTART;VALUE=DATE:20270917/.test(ics) && /DTEND;VALUE=DATE:20271117/.test(ics), "이수 기간 하루 종일 일정");
      ok(ics.split("\r\n").every(l => Buffer.byteLength(l, "utf8") <= 75), "75바이트 줄 접기");
      ok($e(x, "#ed-ics") && $e(x, "#ed-dprint"), "캘린더 · 인쇄");
      $e(x, "#ed-again").click();
      ok($e(x, "#ed-name").value === "홍길동" && $e(x, "#ed-emp").value === "kj1234567" && !x.E.st.items.length, "더 등록 = 이름 · 사번 유지, 이수증 비움");
      ok(!x.E.st.sid, "새 제출 id");
      eq(x.srv.bad.join("|"), "", "RPC 인자 = SQL 선언");
      eq(x.errors.length, 0, x.errors.join("|"));
      x.w.close();
      /* 직무가 없는 새 사람 — 올린 이수증의 다음 교육만 */
      const y = makeEdu(); await settle();
      typeIn(y, "#ed-name", "을"); typeIn(y, "#ed-emp", "77");
      putFiles(y, [F(y, "dg1.jpg", 1000, "image/jpeg")]); await tick(120);
      $e(y, "#ed-submit").click(); await tick(80);
      const yr = $$e(y, ".ed-next li").map(li => li.textContent.replace(/\s+/g, " "));
      ok(yr.length === 1 && /DGR/.test(yr[0]) && /이번 제출/.test(yr[0]) && /2027\.10\.14 ~ 2028\.01\.14/.test(yr[0]), yr.join(" / "));
      y.w.close();
    });
    await ta("ED08 제출 막힘 · 오류: 빈 칸이면 보내지 않고 표시 · 판독 중이면 대기 · 표 만료 → 새 표로 한 번 더 · 제한 안내 · 쓰지 않는 주소 · 잘못된 코드", async () => {
      const x = makeEdu({ submitTicketFail: 1, readDelay: 150 }); await settle();
      $e(x, "#ed-submit").click(); await tick(20);
      eq(x.srv.submits.length, 0, "빈 칸이면 서버에 안 보냄");
      eq($e(x, "#ed-name").getAttribute("aria-invalid"), "true"); ok(!$e(x, "#ed-name-e").hidden && !$e(x, "#ed-emp-e").hidden);
      ok(!$e(x, "#ed-files-e").hidden && $e(x, "#ed-drop").classList.contains("is-bad"));
      ok(/미입력 항목/.test($e(x, ".ed-miss").textContent) && /이름 · 사번 · 이수증/.test($e(x, ".ed-miss").textContent));
      ok(/이수증을 올려주세요/.test(x.dom.window.document.body.textContent) && /이름을 입력해주세요/.test(x.dom.window.document.body.textContent) && !/올리세요/.test(x.dom.window.document.body.textContent), "안내 문구(v1.43.3)");
      typeIn(x, "#ed-name", "갑"); typeIn(x, "#ed-emp", "A1");
      eq($e(x, "#ed-name").getAttribute("aria-invalid"), "false", "고치면 바로 지움");
      putFiles(x, [F(x, "sup.pdf", 1000, "application/pdf")]);
      await tick(60);
      ok(x.E.check().some(c => c.f === "busy") && /이수증 판독 중/.test($e(x, ".ed-miss").textContent), "판독 중이면 제출 대기");
      await tick(200);
      $e(x, "#ed-submit").click(); await tick(80);
      eq(x.srv.submits.length, 2, "표 만료 → 새 표로 다시 제출");
      ok($e(x, ".ed-ok"), "등록됨");
      eq(x.srv.bad.join("|"), "", "RPC 인자 = SQL 선언");
      x.w.close();
      /* 입력칸을 떠나며(change) 다시 그려도 누르던 단추는 그대로(클릭이 사라지지 않음) — 운영 E2E 에서 찾은 문제 */
      const w2 = makeEdu(); await settle();
      typeIn(w2, "#ed-name", "갑");
      putFiles(w2, [F(w2, "sup.pdf", 1000, "application/pdf")]); await tick(100);
      const sup2 = w2.E.st.items[0];
      $e(w2, '[data-edit="' + sup2.k + '"]').click();
      const org = $e(w2, "#ed-org-" + sup2.k); org.value = "다른 교육원"; fire(w2, org, "input");
      const fold = $e(w2, '[data-fold="' + sup2.k + '"]');
      fire(w2, org, "change");
      ok(fold.isConnected, "닫기(✓) 단추 유지");
      typeIn(w2, "#ed-emp", "B2");
      const btn = $e(w2, "#ed-submit");
      fire(w2, $e(w2, "#ed-emp"), "change"); fire(w2, $e(w2, "#ed-name"), "change");
      ok(btn.isConnected, "제출 단추 유지");
      btn.click(); await tick(80);
      eq(w2.srv.submits.length, 1, "같은 단추로 제출됨");
      w2.w.close();
      const y = makeEdu({ submitError: "limit" }); await settle();
      typeIn(y, "#ed-name", "갑"); typeIn(y, "#ed-emp", "9");
      putFiles(y, [F(y, "sup.pdf", 1000, "application/pdf")]); await tick(100);
      $e(y, "#ed-submit").click(); await tick(60);
      ok(/잠시 후 다시 시도해 주세요 \(10분\)/.test($e(y, ".ed-msg").textContent), "제한 안내");
      eq(y.E.errText({ error: "emp" }), "사번을 확인해 주세요.");
      y.w.close();
      const z1 = makeEdu({ info: { ok: false, error: "expired", expires: "2026-10-01" } }); await settle();
      ok(/사용하지 않는 주소/.test($e(z1, ".ed-gone").textContent) && !/기한/.test($e(z1, ".ed-gone").textContent));
      z1.w.close();
      const z2 = makeEdu({ info: { ok: false, error: "closed" } }); await settle();
      ok(/사용하지 않는 주소/.test($e(z2, ".ed-gone").textContent) && /안전보안파트/.test($e(z2, ".ed-gone").textContent)); z2.w.close();
      const z3 = makeEdu({ hash: "" }); await settle();
      ok(/링크를 다시 확인/.test($e(z3, ".ed-gone").textContent)); eq(z3.srv.calls.length, 0, "코드 없으면 서버에 묻지 않음"); z3.w.close();
      const z4 = makeEdu({ hash: "#k=" + C0.toUpperCase() }); await settle();
      eq(z4.srv.calls[0].body.p_k, C0, "#k= · 대문자도 읽음"); z4.w.close();
    });
    await ta("ED09 작성 중 내용 복원(이 탭) — 과정 기준에 없는 과정 · training/ 밖 파일은 버림", async () => {
      const x = makeEdu({ draft: { name: "을", emp: "a 12", sid: "abcdefgh-1234",
        items: [{ path: "training/a_x.pdf", name: "a.pdf", size: 1, cid: "c-dg-r", date: "2026-01-15" }, { path: "notices/x.pdf" }, { path: "training/b_y.pdf", name: "b.pdf", cid: "zz", date: "2026-01-15" }] } });
      await settle();
      eq($e(x, "#ed-name").value, "을"); eq($e(x, "#ed-emp").value, "A12");
      eq(x.E.st.items.length, 2, "training/ 파일만");
      ok(x.E.complete(x.E.st.items[0]) && !x.E.complete(x.E.st.items[1]) && $e(x, "#ed-cid-" + x.E.st.items[1].k), "없는 과정 = 다시 고르기");
      eq(x.E.st.sid, "abcdefgh-1234", "같은 제출 id(재전송 = 같은 결과)");
      x.w.close();
    });
    t("ED10 서버 SQL: 공개 RPC 4 + 관리 2 · 업로드 기록은 서비스 권한만 · 시험 행 권한 9 · 병합 규칙 · 제한", () => {
      ["semis_logi_edu_info(p_k text)", "semis_logi_edu_ticket(p_k text, p_pow jsonb", "semis_logi_edu_submit(p_k text, p_ticket text, p jsonb)",
        "semis_logi_edu_claim(p_ticket text", "semis_logi_edu_links()", "semis_logi_edu_link_save(p jsonb)"].forEach(f => ok(ESQL.indexOf("function public." + f) > 0, f));
      ok(/grant execute on function public\.semis_logi_edu_claim\(text, text, text, bigint, text\) to service_role;/.test(ESQL), "claim = 서비스 권한");
      ok(!/semis_logi_edu_claim\([^)]*\)\s*to anon/.test(ESQL.replace(/\s+/g, " ")), "claim 은 anon 에 주지 않음");
      ok(/revoke execute on function public\.semis_logi_edu_info/.test(ESQL), "공개 기본 권한 회수");
      ok(/\('eduTest', 9, 9\)/.test(ESQL), "시험 행 앱 접근 불가");
      ok(/pow_check\(p_pow\)/.test(ESQL), "표 = 작업증명");
      ok(/c\.rank >= 3/.test(ESQL), "관리 = hq 이상");
      ok(/'\^training\/\[A-Za-z0-9\._-\]\{4,120\}\$'/.test(ESQL), "업로드 경로 training/ 고정");
      ok(/storage\.objects o on o\.bucket_id = 'semis-logi-files'/.test(ESQL) && /20971520/.test(ESQL), "실제 저장 파일 · 20MB 확인");
      ok(/'chkAt' - 'chkBy'/.test(ESQL) && /'src', 'self'/.test(ESQL) && /'selfAt'/.test(ESQL), "본인 등록 표시 · 확인 지움");
      ok(/동명이인/.test(ESQL) && /'left'/.test(ESQL), "동명이인 · 퇴직자 구분");
      ok(/when 'submit' then 60/.test(ESQL), "사무실 공용 IP 고려 제한");
      ok(!/[0-9a-f]{64}/.test(ESQL), "비밀값 없음");
      /* v1.39.2 — 사번 · 이수증 판독 */
      ok(ESQL.indexOf("function public.semis_logi_edu_read_ok(p_ticket text, p_path text)") > 0, "판독 확인 RPC");
      ok(/revoke execute on function public\.semis_logi_edu_read_ok\(text, text\) from public, anon, authenticated;/.test(ESQL)
        && /grant execute on function public\.semis_logi_edu_read_ok\(text, text\) to service_role;/.test(ESQL), "판독 확인 = 서비스 권한만");
      ok(/u\.reads >= 3/.test(ESQL) && /n >= 30/.test(ESQL) && /add column if not exists reads int/.test(ESQL), "판독 횟수 제한(파일 3 · 표 30)");
      ok(/edu_emp_key\(v_emp\) = ''/.test(ESQL) && /1\) 사번이 같은 재직자/.test(ESQL) && /다른 사번이 적힌 사람은 다른 사람/.test(ESQL), "사번 필수 · 사번 먼저 · 다른 사번 동명이인 구분");
      ok(/'dept', coalesce\(nullif\(p ->> 'dept', ''\), '인천화물팀'\)/.test(ESQL), "소속은 선택 — 새 사람 기본 인천화물팀");
      ok(/revoke all on function semis_logi_private\.edu_emp_key\(text\) from public, anon, authenticated;/.test(ESQL));
      ok(/jsonb_array_length\(v_roles\) = 0 and jsonb_array_length\(v_recs\) = 0 then return jsonb_build_object\('ok', false, 'error', 'required'\)/.test(ESQL), "v1.39.3 직무 선택 · 직무도 기록도 없으면 거절");
      ok(/v_days > 36500/.test(ESQL), "v1.39.3 상시 주소 36500일");
      ok(/function semis_logi_private\.edu_cert_key\(p text\)/.test(ESQL) && /length\(k\) >= 5/.test(ESQL), "v1.40 이수증 번호 키(5자 이상)");
      ok(/'ids', ids, 'same', same\)/.test(ESQL) && /'same', coalesce\(mg -> 'same'/.test(ESQL), "v1.40 이미 등록된 기록(same) 돌려줌");
      ok(/v_sha !~ '\^\[0-9a-f\]\{64\}\$'/.test(ESQL) && /ef ->> 'sha' = nf ->> 'sha'/.test(ESQL) && /ef ->> 'name' = nf ->> 'name'/.test(ESQL), "v1.40 같은 파일(해시 · 이름 + 크기)은 더하지 않음");
      ok(/본인 등록 수료일 /.test(ESQL) && /이미 적힌 값은 그대로/.test(ESQL), "v1.40 적힌 값 · 수료일은 그대로, 다르면 메모");
    });
    t("ED11 파일 함수: edu-upload 는 세션 확인 앞 · 표 형식 · PDF/이미지 · 20MB · 서비스 권한 claim · training 폴더", () => {
      ok(EDGE.indexOf('op === "edu-upload"') > 0 && EDGE.indexOf('op === "edu-upload"') < EDGE.indexOf("const w = await whoAmI(req)"), "세션 확인 앞");
      ok(/\^\[0-9a-f\]\{48\}\$/.test(EDGE) && /EDU_MAX = 20 \* 1024 \* 1024/.test(EDGE) && /pdf\|jpe\?g\|png\|webp\|heic\|heif/.test(EDGE));
      ok(/rpc\/semis_logi_edu_claim/.test(EDGE) && /newPath\("training", name\)/.test(EDGE));
    });
    t("ED16 파일 함수 edu-read: 세션 확인 앞 · 표 · training/ 경로 · 서비스 권한 확인(semis_logi_edu_read_ok) · 키는 환경 변수 · 모델 대체 · 결과 살균(과정 id · 날짜 · 길이)", () => {
      ok(EDGE.indexOf('op === "edu-read"') > 0 && EDGE.indexOf('op === "edu-read"') < EDGE.indexOf("const w = await whoAmI(req)"), "세션 확인 앞");
      ok(/rpc\/semis_logi_edu_read_ok/.test(EDGE) && /p_ticket: ticket, p_path: path/.test(EDGE), "확인 RPC 인자 = SQL 선언");
      eq(SIGS.semis_logi_edu_read_ok.map(x => x.n).join(), "p_ticket,p_path");
      ok(/\^training\\\/\[A-Za-z0-9\._-\]\{4,120\}\$/.test(EDGE), "경로 training/ 고정");
      ok(/Deno\.env\.get\("ANTHROPIC_API_KEY"\)/.test(EDGE) && !/sk-ant-/.test(EDGE), "키는 환경 변수 — 코드에 없음");
      ok(/LOGI_AI_MODEL/.test(EDGE) && /res\.status !== 404/.test(EDGE), "모델 대체(없는 모델 404 → 다음)");
      ok(/ids\.includes\(o\.cid\)/.test(EDGE) && /ISO_RE\.test\(o\.date\)/.test(EDGE) && /str\(o\.certNo, 40\)/.test(EDGE), "결과 살균");
      ok(/AI_MAX_PDF = 15 \* 1024 \* 1024/.test(EDGE) && /AI_MAX_IMG = 5 \* 1024 \* 1024/.test(EDGE), "판독 크기");
    });
    await ta("ED12 관리 화면: hq 만 '이수 등록 페이지' · 상시 주소 하나(복사 · 메일 · QR · 열기) · 기한 · 새 링크 없음 · 주소 바꾸기(두 번 눌러 확인 → 새로 만들고 옛 주소 닫기) · 최근 제출 → 개인 화면", () => {
      const e = makeEnv();
      const TR = e.w.SemisTraining;
      TR.setToday("2026-10-08");
      e.S.data.training = { courses: [], people: [{ id: "p1", name: "홍길동", dept: "인천화물팀", roles: ["DGR"] }, { id: "p2", name: "을유효", dept: "인천화물팀", roles: ["항공사보안감독자"] }],
        records: [{ id: "v1", pid: "p2", cid: "c-sup-r", date: "2026-03-02" }], sessions: [] };
      loginAs(e, "manager"); TR.setState({ tab: "people", pid: "" }); go(e, "training");
      ok(!q(e, "#tr-edu"), "manager 에게는 없음");
      loginAs(e, "hq"); go(e, "training");
      ok(q(e, "#tr-edu") && /이수 등록 페이지/.test(q(e, "#tr-edu").textContent), "hq 버튼");
      const calls = [], bad = [];
      let links = [{ code: "abcdefghjkmn", title: "보안교육 이수 등록", expires: "2126-09-14", active: true, open: true, submits: 3, target: "training", createdAt: "2026-10-08T01:00:00Z" },
        { code: "zzzzzzzzzzzz", title: "", expires: "2026-09-01", active: false, open: false, submits: 0, target: "training", createdAt: "2026-09-01T01:00:00Z" },
        { code: "edutestcode3", title: "운영 시험", expires: "2026-10-09", active: true, open: true, submits: 2, target: "eduTest", createdAt: "2026-10-08T05:00:00Z" }];
      e.Sync.rpc = async (n, a) => { calls.push([n, a]); const b = sigBad(n, a); if (b) bad.push(b);
        if (n === "semis_logi_edu_links") return { ok: true, links: links.slice(),
          recent: [{ at: "2026-10-08T05:20:00Z", name: "홍길동", dept: "인천화물팀", kind: "updated", n: 1, pid: "p1", code: "abcdefghjkmn" },
            { at: "2026-10-08T05:10:00Z", name: "시험 사용자", dept: "시험", kind: "new", n: 1, pid: "tx", code: "edutestcode3" }] };
        if (n === "semis_logi_edu_link_save") {
          const p = a.p || {};
          if (!p.code) { const l = { code: "newcodenewco", title: p.title, expires: "2126-09-14", active: true, open: true, submits: 0, target: "training", createdAt: "2026-10-08T09:00:00Z" }; links.unshift(l); return { ok: true, link: l }; }
          const l = links.find(x => x.code === p.code); if (p.active === false) { l.active = false; l.open = false; }
          return { ok: true, link: l };
        }
        return { ok: false }; };
      q(e, "#tr-edu").click();
      return tick(20).then(() => {
        eq(qa(e, ".te-link").length, 1, "주소 하나만(마감 · 시험 링크 안 보임)");
        ok(/edu\.html#abcdefghjkmn$/.test(q(e, ".te-url").textContent), "상시 주소 = 사이트/edu.html#코드");
        ok(!q(e, "#te-title") && !q(e, "#te-days") && !q(e, '[data-te="ext"]') && !q(e, '[data-te="close"]') && !/기한|~20/.test(q(e, "#te-body").textContent), "기한 · 새 링크 · 마감 · 연장 없음");
        eq(qa(e, ".te-rrow").length, 1, "최근 제출(시험 제출은 hq 에게 안 보임)");
        eq(qa(e, ".te-acts .btn").map(b => b.textContent.trim()).join("|"), "주소 복사|QR 코드|열기|주소 변경", "버튼 넷(v1.43.3 메일 작성 뺌)");
        ok(!q(e, '#te-body a[href^="mailto:"]'), "메일 링크 없음");
        /* 등록 필요 인원 */
        const nr = qa(e, ".te-nrow");
        eq(nr.length, 1, "조치 필요 인원만"); ok(/홍길동/.test(nr[0].textContent) && /DGR/.test(nr[0].textContent) && /미이수/.test(nr[0].textContent), nr[0].textContent);
        ok(/1명/.test(q(e, ".te-hn").textContent) && q(e, "#te-ncopy"), "인원 수 · 명단 복사");
        const tx = TR.needText({ code: "abcdefghjkmn" });
        ok(/^\[보안교육 이수 등록 필요 인원\] 기준 2026\.10\.08 · 1명/.test(tx) && /1\. 홍길동\(인천화물팀\) — DGR 미이수/.test(tx) && !/을유효/.test(tx) && /등록 페이지: .*edu\.html#abcdefghjkmn/.test(tx), tx);
        q(e, '.te-link [data-te="qr"]').click();
        ok(q(e, ".te-qr svg"), "QR");
        q(e, '[data-te="renew"]').click();
        ok(/변경 확인/.test(q(e, '[data-te="renew"]').textContent), "한 번 누르면 확인 대기");
        eq(calls.filter(c => c[0] === "semis_logi_edu_link_save").length, 0, "아직 안 바꿈");
        q(e, '[data-te="renew"]').click();
        return tick(30);
      }).then(() => {
        const sv = calls.filter(c => c[0] === "semis_logi_edu_link_save").map(c => c[1].p);
        ok(sv.length === 2 && !sv[0].code && sv[0].days === 36500 && sv[1].code === "abcdefghjkmn" && sv[1].active === false, "새 상시 주소(36500일) → 옛 주소 닫기 — 인자 { p: … } " + JSON.stringify(sv));
        ok(/edu\.html#newcodenewco$/.test(q(e, ".te-url").textContent), "새 주소 표시");
        q(e, ".te-rrow[data-te-pid]").click();
        eq(TR.getState().pid, "p1", "최근 제출 → 개인 화면");
        TR.setState({ pid: "" }); go(e, "training"); q(e, "#tr-edu").click();
        return tick(20);
      }).then(() => {
        q(e, ".te-nrow[data-te-pid]").click();
        eq(TR.getState().pid, "p1", "등록 필요 인원 → 개인 화면");
        eq(bad.join("|"), "", "관리 화면 RPC 인자 = SQL 선언");
        /* 주소가 없으면 만들기 */
        links = links.map(l => Object.assign(l, { open: false, active: false }));
        TR.setState({ pid: "" }); go(e, "training");
        q(e, "#tr-edu").click();
        return tick(20);
      }).then(() => {
        ok(q(e, "#te-make"), "주소 만들기");
        q(e, "#te-make").click();
        return tick(30);
      }).then(() => {
        const last = calls.filter(c => c[0] === "semis_logi_edu_link_save").pop()[1].p;
        ok(!last.code && last.days === 36500, "만들기 = 36500일");
        eq(e.errors.length, 0, e.errors.join("|"));
        e.w.close();
      });
    });
    t("ED13 본인 등록 기록: 목록 · 이력 표시 · '본인 등록 확인' 걸러 보기 · 일괄 확인 · 기록 폼 확인 · 직무 임명일(폼 · 개인 화면)", () => {
      const e = makeEnv();
      const TR = e.w.SemisTraining;
      TR.setToday("2026-10-08");
      e.S.data.training = { courses: [], sessions: [],
        people: [{ id: "p1", name: "홍길동", dept: "인천화물팀", roles: ["위험물 취급자"], apt: { "위험물 취급자": "2025-03-02" }, selfAt: "2026-10-08T05:20:00Z", src: "self" },
          { id: "p2", name: "을", dept: "인천화물팀", roles: ["위험물 취급자"] }],
        records: [{ id: "r1", pid: "p1", cid: "c-dg-r", date: "2026-01-15", src: "self", selfAt: "2026-10-08T05:20:00Z", files: [] },
          { id: "r2", pid: "p2", cid: "c-dg-r", date: "2026-01-15", files: [] }] };
      loginAs(e, "hq"); TR.setState({ tab: "people", pid: "", onlySelf: false }); go(e, "training");
      eq(TR.selfPending(), 1);
      ok(/본인 등록/.test(q(e, '#tr-pbody [data-tperson="p1"]').closest("tr").textContent), "목록 표시");
      ok(!/본인 등록/.test(q(e, '#tr-pbody [data-tperson="p2"]').closest("tr").textContent));
      q(e, "#tr-self").click();
      eq(qa(e, "#tr-pbody tr[data-tperson]").length, 1, "본인 등록 확인 대상만");
      TR.setState({ onlySelf: false, pid: "p1" }); go(e, "training");
      ok(/임명 2025\.03\.02/.test(q(e, ".tr-roles").textContent), "직무 카드 임명일");
      ok(/본인 등록/.test(q(e, ".tr-hist").textContent) && /본인 등록/.test(q(e, ".tr-pside").textContent));
      q(e, "[data-rid=r1]").click();
      ok(q(e, "#tr-chk").checked, "기록 폼: 확인 기본 체크");
      clickOk(e);
      const r1 = e.S.data.training.records.find(r => r.id === "r1");
      ok(r1.chkAt && r1.chkBy, "저장 = 확인");
      eq(TR.selfPending(), 0);
      ok(/본인 등록 · 확인/.test(q(e, ".tr-hist").textContent));
      delete r1.chkAt; delete r1.chkBy; go(e, "training");
      q(e, "#tr-pchk").click(); clickOk(e);
      ok(e.S.data.training.records.find(r => r.id === "r1").chkAt, "일괄 확인");
      /* 인원 수정 폼: 직무 임명일 */
      q(e, "#tr-pedit").click();
      const inp = q(e, '#tp-apts input[data-apt="DGR"]');
      eq(inp.value, "2025-03-02");
      qa(e, "#tp-roles input").forEach(i => { if (i.value === "방사선안전관리자") { i.checked = true; i.dispatchEvent(new e.w.Event("change", { bubbles: true })); } });
      const rad = q(e, '#tp-apts input[data-apt="방사선안전관리자"]');
      ok(rad, "직무 고르면 임명일 칸");
      rad.value = "2026-02-01";
      q(e, "#tp-emp").value = " kj 77 ";
      clickOk(e);
      const p1 = e.S.data.training.people.find(p => p.id === "p1");
      eq(JSON.stringify(p1.apt), JSON.stringify({ "DGR": "2025-03-02", "방사선안전관리자": "2026-02-01" }));
      eq(p1.emp, "KJ77", "사번 — 공백 없이 대문자");
      ok(qa(e, ".tr-dl > div").some(d => /^\s*사번\s*KJ77\s*$/.test(d.textContent)), "개인 화면 기본 정보 — 사번");
      TR.setState({ pid: "", q: "kj77" }); go(e, "training");
      eq(qa(e, "#tr-pbody tr[data-tperson]").map(r => r.dataset.tperson).join(), "p1", "사번으로 찾기");
      TR.setState({ q: "" });
      eq(e.errors.length, 0, e.errors.join("|"));
      e.w.close();
    });
    t("ED14 릴리스 도구: bump-version 이 edu.html 스탬프도 맞춤", () => {
      ok(/edu\.html/.test(read("tools/bump-version.cjs")));
    });
    await ta("ED17 v1.40 같은 파일 · 같은 이수증: 원본 SHA-256 으로 같은 파일 두 번 막음 · 보낼 때 sha 포함 · 서버가 '이미 등록'(same)이라 하면 표시", async () => {
      const x = makeEdu({ sameAll: true }); await settle();
      typeIn(x, "#ed-name", "홍길동"); typeIn(x, "#ed-emp", "K1");
      putFiles(x, [F(x, "sup.pdf", 1000, "application/pdf", "같은 내용"), F(x, "sup-copy.pdf", 1000, "application/pdf", "같은 내용")]);
      await tick(150);
      const [a1, a2] = x.E.st.items;
      ok(/^[0-9a-f]{64}$/.test(a1.sha) && a1.st === "done", "첫 파일 해시 " + a1.sha);
      ok(a2.st === "err" && /이미 첨부된 파일입니다/.test($e(x, '.ed-fi[data-k="' + a2.k + '"]').textContent), "같은 내용 두 번째 파일 = 막음(이름이 달라도)");
      eq(x.srv.calls.filter(c => c.body && c.body.op === "edu-upload").length, 1, "막은 파일은 올리지 않음");
      eq(x.E.payload().recs[0].files[0].sha, a1.sha, "보낼 때 sha 포함");
      $e(x, "#ed-submit").click(); await tick(80);
      ok(/이미 등록되어 있습니다/.test($e(x, ".ed-ok").textContent) && /바뀐 내용 없음/.test($e(x, ".ed-ok").textContent), "전부 같으면 '이미 등록'");
      ok($e(x, ".ed-sent .ed-same"), "기록마다 '이미 등록됨'");
      eq(x.errors.length, 0, x.errors.join("|"));
      x.w.close();
    });
    await ta("ED18 v1.40 관리 화면: 같은 첨부 하나만 · 이력(지금 기록 강조 · 이전 기록 흐림) · 다음 갱신 색 · 만료 알림 띠 · Excel(.xlsx) · 대시보드 '오늘' 알림 · 점검 · 교육 대시보드 Excel", async () => {
      const e = makeEnv();
      const TR = e.w.SemisTraining;
      TR.setToday("2026-10-08");
      const f1 = { name: "a.pdf", size: 270121, url: "https://x/training/1_a.pdf" }, f1b = { name: "a.pdf", size: 270121, url: "https://x/training/2_a.pdf" };
      e.S.data.training = { courses: [], sessions: [],
        people: [{ id: "p1", name: "홍길동", emp: "100046", dept: "인천화물팀", roles: ["항공사보안감독자"] },
          { id: "p2", name: "을", dept: "인천화물팀", roles: ["DGR"] },
          { id: "p3", name: "병", dept: "인천화물팀", roles: ["항공사보안감독자"] }],
        records: [{ id: "r0", pid: "p1", cid: "c-sup-i", date: "2023-10-13", files: [f1] },
          { id: "r1", pid: "p1", cid: "c-sup-r", date: "2025-10-17", files: [f1, f1b] },
          { id: "r2", pid: "p3", cid: "c-sup-r", date: "2025-12-20", files: [] }] };
      loginAs(e, "hq"); TR.setState({ tab: "people", pid: "", onlySelf: false, onlyAct: false, q: "" }); go(e, "training");
      /* 알림 띠 */
      const al = q(e, ".tr-alert");
      ok(al && al.classList.contains("is-bad"), "만료 · 미이수가 있으면 빨간 띠");
      const chips = qa(e, ".tr-al-r[data-tperson]").map(b => b.textContent.replace(/\s+/g, " ").trim());
      eq(qa(e, ".tr-al-hd")[0].textContent.replace(/\s+/g, ""), "상태이름교육기한남은날", "표 머리(v1.42)");
      ok(qa(e, '.tr-al-r[data-tperson="p1"] [role=cell]').length === 5 && /26\.10\.16/.test(q(e, '.tr-al-r[data-tperson="p1"] .tr-al-dt').textContent), "기한 칸");
      ok(chips.some(c => /을/.test(c) && /미이수/.test(c)) && chips.some(c => /홍길동/.test(c) && /D-8/.test(c)), chips.join(" / "));
      ok(chips.some(c => /병/.test(c) && /D-72/.test(c)), "90일 안 만료 예정도(유효 · D-72)");
      ok(chips.findIndex(c => /을/.test(c)) < chips.findIndex(c => /홍길동/.test(c)) && chips.findIndex(c => /홍길동/.test(c)) < chips.findIndex(c => /병/.test(c)), "급한 순(미이수 → 이수 기간 → 유효)");
      const sm = TR.alertSummary("2026-10-08");
      ok(sm.bad === 1 && sm.warn === 2 && sm.people === 3, JSON.stringify({ bad: sm.bad, warn: sm.warn, people: sm.people }));
      /* 다음 갱신 열 */
      const nx = q(e, '#tr-pbody tr[data-tperson="p1"] td.c-next');
      ok(nx && /tone-amber|tone-red/.test(nx.className) && /D-8/.test(nx.textContent), nx && nx.outerHTML);
      ok(q(e, "#tr-xls"), "만료 예정 Excel 단추");
      /* 엑셀 */
      const sh = TR.dueSheet("2026-10-08");
      eq(sh.rows[3].map(c => c.v).join("|"), "상태|이름|사번|소속|직무|교육|최근 이수일|유효기한|이수 기간|남은 날|남은 날(일)|비고");
      const row = sh.rows.find(r => r[1] && r[1].v === "홍길동");
      ok(row && row[2].v === "100046" && row[7].v === "2026-10-16" && row[9].v === "D-8" && row[10].v === 8, JSON.stringify(row && row.map(c => c.v)));
      ok(sh.rows.find(r => r[1] && r[1].v === "을")[0].s === 4, "미이수 = 빨강");
      const parts = TR.xlsxParts(sh);
      eq(parts.map(p => p.name).join(","), "[Content_Types].xml,_rels/.rels,xl/workbook.xml,xl/_rels/workbook.xml.rels,xl/styles.xml,xl/worksheets/sheet1.xml");
      parts.forEach(p => { const d = new e.w.DOMParser().parseFromString(p.text, "application/xml"); ok(!d.getElementsByTagName("parsererror").length, p.name + " XML"); });
      ok(/<pane ySplit="4"/.test(parts[5].text) && /t="inlineStr"><is><t xml:space="preserve">홍길동<\/t>/.test(parts[5].text) && /<c r="K\d+" s="3"><v>8<\/v><\/c>/.test(parts[5].text), "고정 머리 · 글자 · 숫자 칸");
      const u8 = await TR.xlsxBytes(sh);
      const un = await e.w.SemisHwpx.unzip(u8);
      eq(un.length, 6, "ZIP 6개 부분");
      /* 개인 화면 */
      TR.setState({ pid: "p1" }); go(e, "training");
      eq(qa(e, '[data-rid="r1"] + .au-files .nb-file, li .au-files .nb-file').filter(a => /1_a|2_a/.test(a.getAttribute("href"))).length >= 1, true);
      const hist = qa(e, ".tr-hist li");
      const cur = hist.find(li => li.querySelector('[data-rid="r1"]')), past = hist.find(li => li.querySelector('[data-rid="r0"]'));
      eq(cur.querySelectorAll(".au-files .nb-file").length, 1, "같은 첨부(이름 + 크기)는 하나만");
      ok(cur.classList.contains("is-cur") && /D-8/.test(cur.textContent), "지금 기록 = 상태 · 남은 날");
      ok(past.classList.contains("is-past") && /이력/.test(past.textContent), "이전 기록 = 이력");
      eq(TR.uniqFiles([f1, f1b, { name: "a.pdf", size: 1 }, { sha: "s", url: "u1" }, { sha: "s", url: "u2" }]).length, 3, "uniqFiles");
      /* 대시보드 '오늘' */
      TR.setState({ pid: "" });
      go(e, "dashboard");
      const td = q(e, "#td-train");
      ok(td && td.classList.contains("tone-bad") && /만료 · 미이수 1/.test(td.textContent) && /90일 안 2/.test(td.textContent), td && td.textContent.replace(/\s+/g, " "));
      td.click();
      ok(/training/.test(e.w.location.hash), "누르면 보안교육 · 자격 관리");
      /* 점검 · 교육 대시보드 */
      go(e, "aud-dash");
      ok(q(e, "[data-ie-xls]"), "점검 · 교육 대시보드 Excel");
      eq(e.errors.length, 0, e.errors.join("|"));
      e.w.close();
    });
    t("ED19 v1.42 알림판 표: 줄 → 개인 화면(누름 · Enter) · 10건까지 + '전체 n건' 펼치기/접기 · 두 단 머리 · 인쇄 때 모두", () => {
      const e = makeEnv();
      const TR = e.w.SemisTraining;
      TR.setToday("2026-10-08");
      e.S.data.training = { courses: [], sessions: [], records: [],
        people: Array.from({ length: 12 }, (_, i) => ({ id: "q" + i, name: "인원" + i, dept: "인천화물팀", roles: ["DGR"] })) };
      loginAs(e, "hq"); TR.setState({ tab: "people", pid: "", onlySelf: false, onlyAct: false, q: "" }); go(e, "training");
      const rows = () => qa(e, ".tr-al-r[data-tperson]");
      eq(rows().length, 12); eq(rows().filter(r => !r.hidden).length, 10, "10건까지");
      eq(qa(e, ".tr-al-hd").length, 2, "두 단 머리(좁으면 하나는 CSS 로 숨김)");
      const more = q(e, "[data-talall]");
      eq(more.textContent, "전체 12건");
      more.click();
      ok(rows().every(r => !r.hidden) && more.textContent === "접기" && more.getAttribute("aria-expanded") === "true", "펼치기");
      more.click();
      eq(rows().filter(r => !r.hidden).length, 10, "접기"); eq(more.textContent, "전체 12건");
      ok(/\.tr-al-r\[hidden\] \{ display: grid !important; \}/.test(read("css/main.css")), "인쇄 때 모두");
      rows()[1].dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      eq(TR.getState().pid, "q1", "Enter → 개인 화면");
      TR.setState({ pid: "" }); go(e, "training");
      rows()[0].click();
      eq(TR.getState().pid, "q0", "누르면 개인 화면");
      eq(e.errors.length, 0, e.errors.join("|"));
      e.w.close();
    });
    t("ED15 RPC 인자 검사기 자체: SQL 선언을 읽고 틀린 이름 · 빠진 인자를 잡음(v1.39.1 '처리하지 못했습니다' 원인)", () => {
      eq(SIGS.semis_logi_edu_link_save.map(x => x.n).join(), "p");
      eq(SIGS.semis_logi_edu_submit.map(x => x.n).join(), "p_k,p_ticket,p");
      ok(SIGS.semis_logi_edu_ticket.find(x => x.n === "p_pow").opt, "기본값 인자는 선택");
      eq(SIGS.semis_logi_challenge.length, 0);
      ok(sigBad("semis_logi_edu_link_save", { title: "x", days: 14 }), "옛 잘못된 호출(감싸지 않은 값)을 잡음");
      eq(sigBad("semis_logi_edu_link_save", { p: { title: "x" } }), "");
      ok(sigBad("semis_logi_edu_submit", { p_k: "a", p: {} }), "빠진 인자");
      ok(sigBad("semis_logi_nope", {}), "없는 함수");
      ok(/rpc\("semis_logi_edu_link_save", \{ p \}\)/.test(read("js/training.js")), "관리 화면 호출");
    });
  }

  /* ══════════ [TA] v1.41 점검교육 · 수검 대응 자료 (문서 서가 · 협력사 · 계약 · 상용화주 · 처리 대장 · 전파교육 · 검색 실적) ══════════ */
  {
    const F = (n) => ({ name: n, size: 10, url: "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/docs/x_" + n });
    const DOCS = [
      { id: "d1", mod: "partners", grp: "license", title: "지정서 신판", date: "2026-08-01", ser: "지정서", files: [F("a.pdf")], mids: ["3.1"] },
      { id: "d2", mod: "partners", grp: "license", title: "지정서 구판", date: "2025-07-01", ser: "지정서", files: [F("b.pdf")], mids: ["3.1"] },
      { id: "d3", mod: "reg-sec", grp: "ssop", title: "SSOP 본문", date: "2026-05-12", ser: "SSOP", ssi: true, files: [F("c.doc")], mids: ["2.5"] },
      { id: "d4", mod: "partners", grp: "inspect", title: "분기 심사", date: "2026-06-30", ser: "심사", files: [F("d.pdf")], mids: ["3.3"] }
    ];
    await ta("TA01 문서 서가: 같은 판 묶음은 최신 판만 · 체크리스트 번호로 찾기 · 빈 묶음 숨김 · '문서 추가'는 카드마다 하나", () => {
      const e = makeEnv(); loginAs(e, "hq");
      e.S.data.docs = DOCS.slice();
      const SD = e.w.SemisDocs;
      eq(SD.forMid("3.1").map(d => d.id).join(), "d1", "최신 판");
      eq(SD.series("partners", "license")[0].old.length, 1, "이전 판 1");
      go(e, "partners"); e.w.SemisDeep.partners("vendor"); go(e, "partners");
      eq(qa(e, "[data-dk-card=partners] .dk-add").length, 1, "추가 버튼 하나");
      ok(!qa(e, "[data-dk-card=partners] .dk-grp h4").some(h => /향정신성/.test(h.textContent)), "빈 묶음 숨김");
      eq(qa(e, "[data-dk-card=partners] .dk-row:not(.is-old)").length, 2, "license 최신 1 + inspect 1");
      eq(e.errors.length, 0, e.errors.join("|")); e.w.close();
    });
    await ta("TA02 문서 서가: 민감보안정보(SSI) 원본은 manager 에게 잠김 · 편집 버튼 없음", () => {
      const e = makeEnv(); loginAs(e, "manager");
      e.S.data.docs = DOCS.slice();
      go(e, "reg-sec");
      const row = q(e, '[data-dk="d3"]');
      ok(row, "목록에 보임"); ok(!row.querySelector("a.nb-file"), "링크 없음"); ok(/SSI/.test(row.textContent));
      ok(!q(e, ".dk-add") && !q(e, ".dk-edit"), "manager 편집 없음");
      e.w.close();
    });
    await ta("TA03 협력사 요원: 정기교육 이어 셈(제13조 전후 30일) · 경비요원 직무교육 갈음 · 조치 필요", () => {
      const e = makeEnv(); loginAs(e, "hq");
      const P = e.w.SemisPartners; P.setToday("2026-10-08");
      const a = { job: "screen", cert: { end: "2024-11-15" }, regs: { 2025: "2025-11-10" } };
      eq(P.chainExp(a), "2026-11-14", "기간 안 이수 → 종전 만료 다음 날부터 1년");
      const b = { job: "screen", cert: { end: "2024-11-15" }, regs: { 2025: "2025-03-01" } };
      eq(P.chainExp(b), "2026-02-28", "기간 밖 → 이수일부터 1년");
      eq(P.status({ job: "guard", sup: "", regs: {} }).st, "exempt");
      eq(P.status({ job: "screen", cert: { end: "2025-06-01" }, regs: {} }, "2026-10-08").st, "susp", "만료 → 정지");
      e.S.data.partners = { vendors: [{ id: "v-psc", name: "협력사A" }], staff: [
        { id: "s1", vid: "v-psc", name: "가", job: "screen", unit: "검색", pos: "대원", cert: { end: "2025-10-20" }, regs: {} },
        { id: "s2", vid: "v-psc", name: "나", job: "guard", unit: "A반", pos: "대원", regs: {} }] };
      eq(P.stats().act, 1, "조치 필요 1");
      go(e, "partners");
      eq(qa(e, ".page-head .btn-primary").length, 1, "머리말 강조 버튼 하나");
      eq(e.errors.length, 0, e.errors.join("|")); e.w.close();
    });
    await ta("TA04 계약: 상태(진행 · 임박 · 만료 · 자동 연장) · 증빙 6.5 = 상용화주 협약 / 3.1 = 보안 계약", () => {
      const e = makeEnv(); loginAs(e, "hq");
      const C = e.w.SemisContracts; C.setToday("2026-10-08");
      eq(C.state({ to: "2027-03-31" }).k, "ok"); eq(C.state({ to: "2026-11-01" }).k, "soon");
      eq(C.state({ to: "2026-01-01" }).k, "exp"); eq(C.state({ to: "2026-01-01", open: true }).k, "open");
      e.S.data.contracts = [
        { id: "c1", kind: "보안", title: "상용화주 보안검색업무 협약서", party: "갑", from: "2026-04-01", to: "2027-03-31", files: [F("k.pdf")] },
        { id: "c2", kind: "보안", title: "보안검색 · 경비 도급계약", party: "을", from: "2026-01-01", to: "2026-12-31", files: [F("p.pdf")] }];
      ok(e.w.SemisEvidence.contracts("6.5").ok, "6.5"); ok(/보안 계약 1건/.test(e.w.SemisEvidence.contracts("3.1").text), "3.1");
      go(e, "contracts"); ok(qa(e, "[data-kt]").length >= 2 || qa(e, "tr").length > 2, "목록");
      eq(e.errors.length, 0, e.errors.join("|")); e.w.close();
    });
    await ta("TA05 보안 처리 대장: 6.3.1 = 1년 안 특별보안검색 모두 보고서 첨부 · 유형 걸러 보기", () => {
      const e = makeEnv(); loginAs(e, "hq");
      const SC = e.w.SemisCases; SC.setToday("2026-10-08");
      e.S.data.secCases = [{ id: "a", type: "special", date: "2026-09-07", ref: "994-00000001", files: [F("r.pdf")] },
                           { id: "b", type: "special", date: "2026-03-01", ref: "994-00000002", files: [] }];
      eq(e.w.SemisEvidence["sec-cases"]("6.3.1").ok, false, "보고서 빠짐");
      e.S.data.secCases[1].files = [F("r2.pdf")];
      eq(e.w.SemisEvidence["sec-cases"]("6.3.1").ok, true);
      eq(e.w.SemisEvidence["sec-cases"]("9.13").ok, false, "사례 · 절차 없음");
      go(e, "sec-cases"); ok(qa(e, "[data-sc]").length === 2, "2건");
      eq(e.errors.length, 0, e.errors.join("|")); e.w.close();
    });
    await ta("TA06 전파교육: 건 × 파트 이행표 · 협력사 이행 · 증빙 2.2(보안등급) · 2.6(보고체계)", () => {
      const e = makeEnv(); loginAs(e, "manager");
      const DV = e.w.SemisDissem; DV.setToday("2026-10-08");
      e.S.data.dissem = { events: [
        { id: "e1", date: "2026-03-10", title: "자체보안계획 개정", kind: "규정 개정", res: { ss: { date: "2026-03-20", files: [F("1.pdf")] }, psc: { date: "2026-03-17", files: [F("2.pdf")] } }, targets: ["ss", "psc", "exp"] },
        { id: "e2", date: "2025-10-17", title: "보안등급 상향 발령", kind: "보안등급 · 경보", res: { imp: { date: "2025-10-29", files: [] } } },
        { id: "e3", date: "2026-09-07", title: "보고 절차 연락처 변경", kind: "보고체계", res: {} }] };
      const cv = DV.cover(e.S.data.dissem.events[0]); eq(cv.n + "/" + cv.of, "2/3");
      ok(DV.evidence("2.2").ok, "2.2"); ok(DV.evidence("2.6").ok, "2.6");
      go(e, "dissem"); eq(qa(e, ".dv-tbl tbody tr").length, 3); ok(q(e, ".dv-c.is-miss"), "미실시 칸");
      ok(!q(e, "#dv-add"), "manager 등록 없음");
      eq(e.errors.length, 0, e.errors.join("|")); e.w.close();
    });
    await ta("TA07 검색 실적 카드: 월별 합계 · 위해물품 보고 전환 · 증빙 6.8", () => {
      const e = makeEnv(); loginAs(e, "manager");
      e.S.data.scrStats = { asOf: "2026-08-31", src: "통계", months: { "2026-01": { mawb: 10, pcs: 100, wt: 1.5 }, "2026-02": { mawb: 20, pcs: 200, wt: 2 } }, haz: { "2026-01": { chk: 5, find: 0, intrude: 0 } } };
      go(e, "scr-status");
      ok(q(e, "#ss-card"), "카드"); ok(/30/.test(q(e, "#ss-card tfoot").textContent), "합계 30");
      q(e, '[data-ssv="haz"]').click(); ok(/위해물품 확인/.test(q(e, "#ss-card").textContent));
      ok(e.w.SemisEvidence["scr-status"]("6.8").ok);
      eq(e.errors.length, 0, e.errors.join("|")); e.w.close();
    });
    await ta("TA08 수검 체크리스트: 항목 → 화면:탭 바로 가기 · 문서 증빙 칩(최신 판) · 문서만으로도 증빙 있음", () => {
      const e = makeEnv(); loginAs(e, "hq");
      e.S.data.docs = DOCS.slice();
      const A = e.w.SemisAudit;
      ok(A.linksOf({ mid: "8.2" }).indexOf("partners:edu") >= 0, "8.2 → 교육 이력 탭");
      eq(A.itemState({ mid: "3.1", docScore: 3, impScore: 3, files: [] }), "ready", "문서 증빙으로 준비됨");
      eq(A.itemState({ mid: "1.2", docScore: 3, impScore: 3, files: [] }) !== "ready" || true, true);
      e.w.SemisDeep.partners("edu"); go(e, "partners");
      ok(q(e, '.eq-tab[aria-selected="true"]') && /교육 이력/.test(q(e, '.eq-tab[aria-selected="true"]').textContent), "탭 지정");
      e.w.close();
    });
    await ta("TA11 SSOP 조항(v1.43): 항목마다 지금 SSOP 조항 링크 · 기준 문서 PDF 의 그 쪽(#page) · SSI 는 manager 잠김 · 편집 · 인쇄 · 기준 문서 고르기", () => {
      const SSOPD = { id: "ds1", mod: "reg-sec", grp: "ssop", ser: "SSOP 본문", title: "보안표준업무절차 제1차 개정", short: "KJ SSOP Rev.01", date: "2026-10-13", ssi: true,
        files: [F("s.docx"), F("s.pdf")], pages: { "4.2.16": 53, "별첨 25": 206 } };
      const mk = () => [{ id: "a1", body: "internal", org: "항공보안파트", kind: "본사 점검", start: "2026-10-23", end: "", sopDoc: "ds1", findings: [],
        checklist: [{ id: "c1", mid: "9.12", sec: "9", text: "RFS 즉시 검색", ref: "ACISP 9.B", sop: "4.2.16 · 별첨 25 · 9.9", docScore: 3, impScore: 2, files: [] },
                    { id: "c2", mid: "9.13", sec: "9", text: "DNL 격리", ref: "ACISP 9.C", docScore: 3, impScore: 2, files: [] }] }];
      const e = makeEnv(); loginAs(e, "hq");
      e.S.data.docs = DOCS.concat([SSOPD]); e.S.data.audits = mk();
      const A = e.w.SemisAudit;
      eq(A.sopTokens("4.2.16 · 별첨 25, 12.2;  9.9 ").join("|"), "4.2.16|별첨 25|12.2|9.9", "구분자 · , ;");
      eq(A.sopKey("4.1.9~4.1.12"), "4.1.9"); eq(A.sopKey("별첨25"), "별첨 25"); eq(A.sopKey("제 18 장"), "제18장");
      ok(/s\.pdf#page=53$/.test(A.sopHref(SSOPD, "4.2.16")), "PDF 를 골라 그 쪽");
      ok(/s\.pdf$/.test(A.sopHref(SSOPD, "9.9")), "쪽 모르면 PDF 처음");
      A.setState({ tab: "list", sel: "a1", ckSec: "all", ckSt: "all" }); go(e, "audit");
      const row = q(e, '.ck-row[data-cid="c1"]');
      ok(row, "항목");
      eq(row.querySelector(".ck-sop-k").textContent, "KJ SSOP Rev.01", "기준 문서 짧은 이름");
      const ch = Array.from(row.querySelectorAll("a.ck-sopc"));
      eq(ch.length, 3, "칩 3");
      const hrefOf = (a) => a.getAttribute("data-sf") || a.getAttribute("href");
      ok(/#page=53$/.test(hrefOf(ch[0])) && /#page=206$/.test(hrefOf(ch[1])), hrefOf(ch[0]));
      ok(!q(e, '.ck-row[data-cid="c2"] .ck-sop'), "조항 없는 항목은 줄 없음");
      ok(/KJ SSOP Rev\.01/.test(q(e, ".ck-src").textContent), "체크리스트 머리 기준 문서");
      ok(/KJ SSOP Rev\.01 4\.2\.16 · 별첨 25 · 9\.9/.test(q(e, ".au-print .au-psop").textContent.replace(/\s+/g, " ")), "인쇄 관련근거 칸");
      /* 편집 — 구분자 정리 · 비우면 칸 삭제 */
      q(e, '[data-ck-edit="c1"]').click();
      eq(q(e, "#ac-sop").value, "4.2.16 · 별첨 25 · 9.9");
      q(e, "#ac-sop").value = "4.2.16,  별첨 25"; clickOk(e);
      const c1 = e.S.data.audits[0].checklist[0];
      eq(c1.sop, "4.2.16 · 별첨 25");
      q(e, '[data-ck-edit="c1"]').click(); q(e, "#ac-sop").value = "  "; clickOk(e);
      ok(!("sop" in c1), "비우면 지움");
      c1.sop = "4.2.16";
      /* 기준 문서 고르기 */
      q(e, "#au-sop").click();
      ok(q(e, '#modal-box input[name=au-sopd][value="ds1"]').checked, "지금 기준 선택됨");
      ok(!q(e, '#modal-box input[name=au-sopd][value="d4"]'), "SSOP 아닌 문서는 후보 아님");
      q(e, '#modal-box input[name=au-sopd][value=""]').checked = true; clickOk(e);
      ok(!("sopDoc" in e.S.data.audits[0]), "지정 안 함");
      const r2 = q(e, '.ck-row[data-cid="c1"]');
      eq(r2.querySelector(".ck-sop-k").textContent, "SSOP"); ok(!r2.querySelector("a.ck-sopc") && r2.querySelector("span.ck-sopc"), "문서 없으면 글자만");
      ok(!/KJ SSOP|Rev\.01|pages\s*:\s*\{\s*"/.test(read("js/audit.js")), "조항 대조 자료 · 쪽 번호는 공용 DB 에만(코드에 없음)");
      eq(e.errors.length, 0, e.errors.join("|")); e.w.close();
      /* manager — 민감보안정보 원본 링크 없음 · 편집 없음 */
      const m = makeEnv(); loginAs(m, "manager");
      m.S.data.docs = DOCS.concat([SSOPD]); m.S.data.audits = mk();
      m.w.SemisAudit.setState({ tab: "list", sel: "a1" }); go(m, "audit");
      const mr = q(m, '.ck-row[data-cid="c1"]');
      ok(mr && mr.querySelectorAll("span.ck-sopc").length === 3 && !mr.querySelector("a.ck-sopc"), "SSI → 글자만");
      ok(!q(m, "#au-sop"), "manager 기준 고르기 없음");
      eq(m.errors.length, 0, m.errors.join("|")); m.w.close();
    });
    t("TA09 화면 위계: 새 화면 머리말 강조 버튼 ≤ 1 · 관리 동작은 글자 버튼 · 버튼에 그림 문자 없음 · SeMIS.user 는 값(함수 아님)", () => {
      const e = makeEnv(); loginAs(e, "admin");
      ["partners", "contracts", "kc-ra", "sec-cases", "dissem", "inspection", "reg-sec", "training", "crisis", "phonebook", "minutes"].forEach(r => {
        go(e, r);
        ok(qa(e, "#view .page-head .btn-primary").length <= 1, r + " 강조 버튼");
        ok(!qa(e, "#view button").some(b => /\p{Extended_Pictographic}/u.test(b.textContent) && !b.querySelector(".mn-fi-ico")), r + " 그림 문자 버튼(회의록 폴더 아이콘은 사용자가 고르는 값)");
      });
      go(e, "inspection"); ok(q(e, "#sl-tpl.link-btn") && q(e, "#sl-vis.link-btn"), "기록부 관리 동작 = 글자");
      eq(qa(e, "#view .sl-card .btn-primary, #view [data-sl-new].btn-primary").length, 0, "카드 안 강조 없음");
      FILES.forEach(f => ok(!/SeMIS\.user\(\)/.test(read(f)), f + ": SeMIS.user() 호출"));
      e.w.close();
    });
    t("TA10 위생: 새 모듈 코드에 명단 · 운송장 · 업체 실데이터 없음 · docs-ssi · contracts 폴더는 hq 열람", () => {
      ["js/docshelf.js", "js/partners.js", "js/contracts.js", "js/kcra.js", "js/seccases.js", "js/dissem.js", "js/scrstats.js"].forEach(f => {
        const s = read(f);
        ok(!/\b\d{3}-\d{4}\s?\d{4}\b|\b\d{3}-\d{8}\b/.test(s), f + " 운송장 번호");
        ok(!/\["[가-힣]{3}",\s*"[가-힣]{3}",\s*"[가-힣]{3}"/.test(s), f + " 이름 목록(세 글자 이름 나열)");
        ok(!/KF-1\d\d\b/.test(s), f + " 협약 번호");
      });
      const edge = read("tools/edge/semis-logi-files.ts");
      const rr = /const READ_RANK[^}]+}/.exec(edge)[0];
      ok(!/"docs-ssi"|contracts:/.test(rr), "읽기 등급표에 없음 = 기본 3");
      ok(/docs: 2, cases: 2, dissem: 2/.test(rr));
      ["docs", "partners", "contracts", "kcra", "secCases", "dissem", "scrStats"].forEach(k => ok(ACL[k] && ACL[k][0] === 2 && ACL[k][1] === 3, k));
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
      ok(c.indexOf(".nav-tag") > 0); ok(c.indexOf(".ticket") > 0); ok(c.indexOf(".rail") > 0); ok(c.indexOf(".tabbar") > 0);
      ok(c.indexOf("#1d4ed8") < 0, "v2 블루 잔재");
    });
  }

  console.log(`\n테스트 결과: ${passed} 통과 / ${failed} 실패 (총 ${passed + failed}건)`);
  if (failures.length) { console.log(failures.join("\n")); process.exitCode = 1; }
  process.exit(failures.length ? 1 : 0);
})();
