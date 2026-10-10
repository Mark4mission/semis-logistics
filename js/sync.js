/* 동기화 — 로그인 세션 ↔ Supabase semis_logi_store(key, value jsonb, updated_at) 컬렉션 단위 KV.
   토큰은 탭 sessionStorage 에만 두고 요청마다 x-semis-token 헤더 → 서버 RLS 가 컬렉션별 읽기·쓰기 판정 */
"use strict";

(() => {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  // anon(공개용) 키 — 데이터 권한은 세션 토큰과 서버 RLS 가 결정
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const TABLE = "semis_logi_store";
  const BUCKET = "semis-logi-files";
  const REST = SUPA_URL + "/rest/v1/" + TABLE;
  const RPC = SUPA_URL + "/rest/v1/rpc/";
  const FN_FILES = SUPA_URL + "/functions/v1/semis-logi-files";
  const FN_FAV = SUPA_URL + "/functions/v1/semis-logi-favicon";
  const FN_ARGO = SUPA_URL + "/functions/v1/semis-logi-argo";
  const CHANNEL = "semis-logi-sync";

  const SYNC_KEYS = ["menus", "notices", "schedules", "assignees", "assigneesSeeded", "minutes", "minuteFolders", "levelHistory", "safetyBoard", "contacts", "gcal", "vault", "regulations", "equipment", "crisis", "fleet", "audits", "phonebook", "training", "seclog", "seclogCfg", "serp", "serpRuns", "threat", "threatRuns", "threatChecks", "patrol", "patrolCfg", "patrolPeople", "secPost", "secPostImg", "selfChecks", "selfCheckCfg", "docs", "partners", "contracts", "kcra", "secCases", "dissem", "scrStats", "desk"];
  /* sessionStorage — 토큰·권한·미전송 목록은 탭을 닫으면 소멸 */
  const SS_TOKEN = "semisl:tok";
  const SS_ME = "semisl:me";
  const SS_PENDING = "semisl:pendingSync";
  const SS_FORCE = "semisl:forcePush";
  const LS_GUARD = "semisl:guardLog";   // 대량 삭제 방어 기록(데이터 없음)
  /* 직전 동기화 때 이 건수 이상이던 배열이 로컬에서 0건이면 비정상으로 보고 push 차단 */
  const GUARD_MIN = 2;
  const CLIENT_ID = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const DEBOUNCE_MS = 800;
  const RETRY_MS = 30000;
  const POLL_MS = 30000;
  const BEAT_MS = 10 * 60 * 1000;      // 세션 확인·연장
  const NET_TIMEOUT_MS = 20000;        // 데이터 요청 시간 제한
  const WAKE_TICK_MS = 15000;          // 잠자기 감지 주기
  const WAKE_GAP_MS = 180000;          // 이보다 오래 타이머가 멈췄으면 잠자기 복귀(숨긴 탭 타이머 지연 1분보다 길게)
  const CONFLICT_RETRY = 3;

  let status = "init";            // init | online | syncing | offline
  let snapshots = {};             // key → canonical JSON (마지막 동기화 시점)
  /* serverAt: key → 서버 행 updated_at("" = 행 없음, undefined = 모름 → 먼저 받아 옴)
     baseOK[key]: snapshots[key] 가 실제 서버 값(병합 기준 가능)인지 */
  let serverAt = {};
  let baseOK = {};
  let stale = false;              // 잠자기·탭 숨김에서 막 돌아와 아직 서버와 맞추지 못한 상태
  let pushTimer = null, retryTimer = null, pollTimer = null, beatTimer = null;
  let realtimeClient = null, realtimeOn = false, channel = null;
  let hooked = false, lostFired = false;

  const D = () => SeMIS.data;

  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 저장 불가 */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };

  /* ── 세션 ── */
  let token = ss.get(SS_TOKEN) || "";
  let sess = (() => { try { return JSON.parse(ss.get(SS_ME)) || null; } catch (e) { return null; } })();
  function aclOf(k) {
    const a = sess && sess.acl && sess.acl[k];
    return Array.isArray(a) ? a : ((sess && Array.isArray(sess.def)) ? sess.def : [2, 3]);
  }
  function canRead(k) { return !!sess && sess.kind === "user" && (Number(sess.rank) || 0) >= Number(aclOf(k)[0]); }
  function canWrite(k) { return !!sess && sess.kind === "user" && (Number(sess.rank) || 0) >= Number(aclOf(k)[1]); }
  const readKeys = () => SYNC_KEYS.filter(canRead);
  const writeKeys = () => SYNC_KEYS.filter(canWrite);
  function setSession(d) {
    sess = { kind: d.kind, rank: Number(d.rank) || 0, acl: d.acl || {}, def: Array.isArray(d.def) ? d.def : [2, 3],
             user: d.user || null, minute: d.minute || null };
    ss.set(SS_ME, JSON.stringify(sess));
  }
  function clearAuth() { token = ""; sess = null; ss.del(SS_TOKEN); ss.del(SS_ME); }
  function hdr(extra) {
    const h = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" };
    if (token) h["x-semis-token"] = token;
    return Object.assign(h, extra || {});
  }
  function httpErr(what, res) { const e = new Error(what + " " + res.status); e.status = res.status; return e; }
  function toastSafe(msg, isErr) { try { SeMIS.toast(msg, isErr); } catch (e) { /* 헤더 미존재 */ } }

  /* 비교용 정규화 — jsonb 가 객체 키를 정렬하므로 키 정렬 stringify */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }

  /* ── 상태 표시 ── */
  const STATUS_META = {
    online:  { cls: "online",  txt: "실시간", title: "공용 DB 연결됨 — 변경 사항이 실시간 공유됩니다. (클릭: 수동 동기화)" },
    syncing: { cls: "syncing", txt: "동기화", title: "동기화 진행 중…" },
    offline: { cls: "offline", txt: "오프라인", title: "오프라인 — 이 탭에 저장 중입니다. 재연결 시 자동 동기화됩니다. (클릭: 재시도)" },
    init:    { cls: "syncing", txt: "연결 중", title: "공용 DB 연결 중…" }
  };
  function setStatus(s) {
    status = s;
    try {
      const el = document.getElementById("sync-status");
      if (!el) return;
      const m = STATUS_META[s] || STATUS_META.init;
      el.className = "sync-dot " + m.cls;
      el.innerHTML = '<span class="sync-dot-ico"></span>' + m.txt;
      el.title = m.title;
    } catch (e) { /* 헤더 미존재(테스트 등) 무시 */ }
  }

  /* ── pending 큐(오프라인 변경분) ── */
  function pendingKeys() {
    try { return JSON.parse(ss.get(SS_PENDING)) || []; } catch (e) { return []; }
  }
  function setPending(keys) {
    if (keys.length) ss.set(SS_PENDING, JSON.stringify(Array.from(new Set(keys))));
    else ss.del(SS_PENDING);
  }

  /* ── 스냅샷 · 변경 감지 ── */
  /* snapAll: 이 탭 값을 기준으로(서버 값 아님 → 병합 기준으로 쓰지 않음) */
  function snapAll() { SYNC_KEYS.forEach(k => { snapshots[k] = canon(D()[k]); }); baseOK = {}; }
  function dirtyKeys() { return SYNC_KEYS.filter(k => canon(D()[k]) !== snapshots[k]); }
  function markBase(key, value, at) {
    snapshots[key] = typeof value === "string" ? value : canon(value);
    baseOK[key] = true;
    if (at !== undefined) serverAt[key] = at;
  }
  function baseOf(key) {
    if (!baseOK[key] || typeof snapshots[key] !== "string") return undefined;
    try { return JSON.parse(snapshots[key]); } catch (e) { return undefined; }
  }

  /* ── 3-way 병합 ──
     base = 마지막으로 서버와 맞춘 값, local = 이 탭, remote = 지금 서버.
     서로 다른 곳을 고쳤으면 양쪽 모두 살리고, 같은 곳을 다르게 고쳤으면 local 우선.
     - id 객체 배열: 항목 단위 — 한쪽이 지운 항목을 다른 쪽이 고쳤으면 남김
     - 원시값 배열: 값 집합   - 길이 같은 id 없는 객체 배열: 자리별   - 객체: 키 단위 재귀
     base 를 모르면(undefined) 합집합(겹치면 local 우선) */
  const ATOMIC = { vault: true };           // 암호화 묶음 — 쪼개어 섞지 않는다
  const same = (a, b) => canon(a) === canon(b);
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  function idList(a) {
    if (!Array.isArray(a)) return false;
    const seen = {};
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (!isObj(x) || x.id === undefined || x.id === null || x.id === "") return false;
      const k = "#" + String(x.id);
      if (seen[k]) return false;
      seen[k] = true;
    }
    return true;
  }
  const primList = (a) => Array.isArray(a) && a.every(x => x === null || typeof x !== "object");
  function mergeIds(base, local, remote) {
    const map = (a) => { const m = new Map(); a.forEach(x => m.set(String(x.id), x)); return m; };
    const bm = map(base), lm = map(local), rm = map(remote);
    const out = new Map();
    const all = [];
    const seen = new Set();
    [local, remote, base].forEach(a => a.forEach(x => { const id = String(x.id); if (!seen.has(id)) { seen.add(id); all.push(id); } }));
    all.forEach(id => {
      const v = merge3(bm.get(id), lm.get(id), rm.get(id));
      if (v !== undefined) out.set(id, v);
    });
    /* 순서: 이 탭이 순서를 바꾸지 않았으면 서버 순서, 바꿨으면 이 탭 순서 — 다른 쪽에만 있는 항목은
       그쪽에서 바로 뒤에 오던 항목 앞에(뒤에 아무것도 없으면 맨 끝에) */
    const common = (a, other) => a.map(x => String(x.id)).filter(id => other.has(id));
    const localMoved = common(local, bm).join("\u0001") !== common(base, lm).join("\u0001");
    const primary = localMoved ? local : remote, secondary = localMoved ? remote : local;
    const order = primary.map(x => String(x.id)).filter(id => out.has(id));
    const placed = new Set(order);
    let next = null;
    for (let i = secondary.length - 1; i >= 0; i--) {
      const id = String(secondary[i].id);
      if (!out.has(id)) continue;
      if (!placed.has(id)) { order.splice(next === null ? order.length : order.indexOf(next), 0, id); placed.add(id); }
      next = id;
    }
    return order.map(id => out.get(id));
  }
  function mergeSet(base, local, remote) {
    const kb = new Set((base || []).map(canon)), kl = new Set(local.map(canon));
    const removed = new Set(Array.from(kb).filter(k => !kl.has(k)));
    const out = remote.filter(x => !removed.has(canon(x)));
    const have = new Set(out.map(canon));
    local.forEach(x => { const k = canon(x); if (!kb.has(k) && !have.has(k)) { out.push(x); have.add(k); } });
    return out;
  }
  function mergeObj(base, local, remote) {
    const out = {};
    const keys = [];
    const seen = {};
    [local, remote, base || {}].forEach(o => Object.keys(o).forEach(k => { if (!seen[k]) { seen[k] = true; keys.push(k); } }));
    keys.forEach(k => {
      const v = merge3(base ? base[k] : undefined, local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  function merge3(base, local, remote) {
    if (same(local, remote)) return local;
    if (base !== undefined) {
      if (same(local, base)) return remote;       // 이 탭은 안 바꿈 → 서버 값
      if (same(remote, base)) return local;       // 서버는 안 바꿈 → 이 탭 값
    }
    if (local === undefined) return remote;       // 이 탭은 지웠고 서버는 고침 → 남긴다
    if (remote === undefined) return local;       // 서버는 지웠고 이 탭은 고침 → 남긴다
    if (idList(local) && idList(remote) && (base === undefined || idList(base)))
      return mergeIds(base || [], local, remote);
    if (primList(local) && primList(remote) && (base === undefined || primList(base)))
      return mergeSet(base, local, remote);
    if (Array.isArray(local) && Array.isArray(remote) && Array.isArray(base)
        && local.length === remote.length && base.length === local.length)
      return local.map((x, i) => { const v = merge3(base[i], x, remote[i]); return v === undefined ? null : v; });
    if (isObj(local) && isObj(remote) && (base === undefined || isObj(base)))
      return mergeObj(base, local, remote);
    return local;
  }
  function mergeKey(key, base, local, remote) {
    if (ATOMIC[key]) {
      if (same(local, remote)) return local;
      if (base !== undefined && same(local, base)) return remote;
      return local;
    }
    return merge3(base, local, remote);
  }

  /* ── RPC · REST ── */
  /* 응답 없는 요청이 동기화 줄을 막지 않도록 시간 제한 */
  function fetchT(url, o) {
    if (typeof AbortController === "undefined") return fetch(url, o);
    const ac = new AbortController();
    const tm = setTimeout(() => { try { ac.abort(); } catch (e) {} }, NET_TIMEOUT_MS);
    return fetch(url, Object.assign({}, o, { signal: ac.signal })).finally(() => clearTimeout(tm));
  }
  async function rpc(name, args) {
    if (typeof fetch === "undefined") throw new Error("offline");
    const res = await fetch(RPC + name, { method: "POST", headers: hdr(), body: JSON.stringify(args || {}) });
    if (!res.ok) throw httpErr("rpc " + name, res);
    return res.json();
  }
  async function restGet(keys) {
    let url = REST + "?select=key,value,updated_at,updated_by";
    if (keys && keys.length) url += "&key=in.(" + keys.map(encodeURIComponent).join(",") + ")";
    const res = await fetchT(url, { headers: hdr() });
    if (!res.ok) throw httpErr("GET", res);
    return res.json();
  }
  /* 저장 — 행마다 base_at(마지막으로 받은 서버 시각) 동봉. 그 사이 서버 값이 바뀌었으면 409 → 받아 병합 후 재저장 */
  async function restUpsert(rows) {
    const res = await fetchT(REST + "?on_conflict=key&select=key,updated_at", {
      method: "POST",
      headers: hdr({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(rows)
    });
    if (!res.ok) {
      const e = httpErr("POST", res);
      let d = null;
      try { d = await res.json(); } catch (x) { d = null; }
      if (res.status === 409 || (d && (d.message === "semis_conflict" || d.code === "PT409"))) e.conflict = true;
      throw e;
    }
    let out = null;
    try { out = await res.json(); } catch (x) { out = null; }
    return Array.isArray(out) ? out : [];
  }

  /* ── 로그인 · 확인 · 로그아웃 ── */
  /* 작업증명(pow.js) — 서버 서명 문제(2분 유효·1회용)를 풀어 로그인에 첨부. 로그인 창이 뜬 동안 미리 푼다 */
  const POW = () => (typeof window !== "undefined" && window.SemisPow) || null;
  let powPre = null;              // { exp, promise }
  async function challenge() {
    const d = await rpc("semis_logi_challenge", {});
    if (!d || !d.ok || !d.c) throw new Error("challenge");
    const exp = Number(String(d.c).split(".")[1]) * 1000 || (Date.now() + 110000);
    return { c: String(d.c), d: Number(d.d) || 16, exp };
  }
  function solveOne(ch) {
    const P = POW();
    if (!P) return Promise.reject(new Error("pow"));
    return P.solve(ch.c, ch.d).then(x => ({ c: ch.c, x: String(x) }));
  }
  function prepare() {
    if (typeof fetch === "undefined") return null;
    if (powPre && powPre.exp - 20000 > Date.now()) return powPre.promise;
    const box = { exp: Date.now() + 100000, promise: null };
    box.promise = challenge().then(ch => { box.exp = ch.exp; return solveOne(ch); });
    box.promise.catch(() => { if (powPre === box) powPre = null; });
    powPre = box;
    return box.promise;
  }
  async function takeProof() {
    const cur = powPre;
    powPre = null;
    if (cur && cur.exp - 15000 > Date.now()) {
      try { return await cur.promise; } catch (e) { /* 새로 푼다 */ }
    }
    return solveOne(await challenge());
  }
  async function login(pw) {
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) ? String(navigator.userAgent).slice(0, 200) : "";
    token = "";
    let d = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const proof = await takeProof();
      d = await rpc("semis_logi_login", { p_pw: String(pw == null ? "" : pw), p_ua: ua, p_pow: proof });
      if (!(d && /^pow/.test(String(d.error || "")))) break;        // 문제 만료·재사용 — 한 번 더
    }
    if (d && d.ok && d.token) {
      token = String(d.token);
      ss.set(SS_TOKEN, token);
      setSession(d);
      lostFired = false;
    } else {
      clearAuth();
      prepare();                                                      // 다음 시도용
    }
    return d || { ok: false, error: "invalid" };
  }
  async function whoami(touch) {
    if (!token) return { ok: false, error: "auth" };
    const d = await rpc("semis_logi_whoami", { p_touch: touch !== false });
    if (d && d.ok) setSession(d);
    return d || { ok: false, error: "auth" };
  }
  async function logout() {
    const had = token;
    stop();
    try { if (had) await rpc("semis_logi_logout", {}); } catch (e) { /* 서버 세션은 만료로 정리됨 */ }
    clearAuth();
    ss.del(SS_PENDING); ss.del(SS_FORCE);
  }
  /* 세션이 끊겼는지 확인 — 끊겼으면 앱에 알리고 true */
  async function checkSession() {
    let w = null;
    try { w = await whoami(false); } catch (e) { return false; }   // 네트워크 문제는 세션 문제로 보지 않는다
    if (w && w.ok === false) { sessionLost(); return true; }
    return false;
  }
  function sessionLost() {
    if (lostFired) return;
    lostFired = true;
    stopPolling(); stopBeat();
    setStatus("offline");
    try { if (SeMIS.sessionLost) SeMIS.sessionLost(); } catch (e) { /* 무시 */ }
  }

  /* ── 대량 삭제 방어 ──
     로컬 배열이 통째로 비었는데 직전 동기화본엔 GUARD_MIN건 이상이었다면 저장소 손상·버그로 보고
     push 차단 + 직전 상태로 복원. 정상적인 전체 삭제는 confirmWipe(key)로 1회 허용 */
  let wipeOK = {};                 // key → true (1회용 허용)
  function confirmWipe(key) { if (SYNC_KEYS.includes(key)) wipeOK[key] = true; }
  function snapLen(key) {
    const c = snapshots[key];
    if (typeof c !== "string" || c.charAt(0) !== "[") return -1;
    try { const v = JSON.parse(c); return Array.isArray(v) ? v.length : -1; } catch (e) { return -1; }
  }
  function guardWipe(targets) {
    const blocked = [];
    targets.forEach(k => {
      if (wipeOK[k]) return;
      const cur = D()[k];
      if (!Array.isArray(cur) || cur.length) return;
      const was = snapLen(k);
      if (was < GUARD_MIN) return;
      blocked.push({ key: k, was });
    });
    return blocked;
  }
  function guardLog(entries) {
    try {
      const log = JSON.parse(localStorage.getItem(LS_GUARD)) || [];
      entries.forEach(b => log.push({ at: new Date().toISOString(), key: b.key, was: b.was, client: CLIENT_ID }));
      localStorage.setItem(LS_GUARD, JSON.stringify(log.slice(-50)));
    } catch (e) {}
  }
  function guardEvents() {
    try { return JSON.parse(localStorage.getItem(LS_GUARD)) || []; } catch (e) { return []; }
  }

  /* 권한 없는 변경은 서버 값(마지막 동기화본)으로 되돌린다 */
  function revertKeys(keys) {
    keys.forEach(k => { try { if (typeof snapshots[k] === "string") D()[k] = JSON.parse(snapshots[k]); } catch (e) {} });
    setPending(pendingKeys().filter(k => keys.indexOf(k) < 0));
    try { SeMIS.saveSilent(); } catch (e) {}
    rerender();
  }

  /* ── 동기화 줄 — push·pull 직렬화(기준 시각이 엇갈리지 않게) ── */
  let chain = Promise.resolve();
  function serial(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  /* ── push: 로컬 변경분 → 서버(쓰기 권한 컬렉션만) ── */
  function push(keys, opts) { return serial(() => pushNow(keys, opts)); }
  async function pushNow(keys, opts) {
    if (!sess || sess.kind !== "user" || !token) return;
    const o = opts || {};
    let targets = Array.from(new Set((keys || []).concat(dirtyKeys(), pendingKeys())))
      .filter(k => SYNC_KEYS.includes(k) && canWrite(k));
    const dropped = pendingKeys().filter(k => !canWrite(k));
    if (dropped.length) setPending(pendingKeys().filter(k => canWrite(k)));
    if (!targets.length) return;
    /* 서버 기준을 모르는 컬렉션(새 탭·재로그인 직후) → 먼저 받아 병합한 뒤 저장 */
    const unknown = targets.filter(k => serverAt[k] === undefined);
    if (unknown.length) {
      targets = targets.filter(k => serverAt[k] !== undefined);
      try { await pullNow(false, unknown, o.depth || 0); }
      catch (e) { setStatus("offline"); scheduleRetry(); throw e; }
    }
    /* 이미 서버와 같은 것은 생략(서버에 행이 없거나 강제 복원이면 보냄) */
    const same0 = targets.filter(k => !o.all && serverAt[k] !== "" && canon(D()[k]) === snapshots[k] && baseOK[k]);
    if (same0.length) {
      targets = targets.filter(k => same0.indexOf(k) < 0);
      setPending(pendingKeys().filter(k => same0.indexOf(k) < 0));
    }
    if (!targets.length) { if (status === "syncing") setStatus("online"); return; }
    if (!o.allowWipe) {
      const blocked = guardWipe(targets);
      if (blocked.length) {
        const bk = blocked.map(b => b.key);
        blocked.forEach(b => { try { D()[b.key] = JSON.parse(snapshots[b.key]); } catch (e) {} });
        targets = targets.filter(k => bk.indexOf(k) < 0);
        setPending(pendingKeys().filter(k => bk.indexOf(k) < 0));
        guardLog(blocked);
        try { SeMIS.saveSilent(); } catch (e) {}
        rerender();
        toastSafe("데이터가 비정상적으로 비워져 저장을 중단하고 직전 상태로 되돌렸습니다. (" + bk.join(", ") + ")", true);
        if (!targets.length) { setStatus("online"); return; }
      }
    }
    targets.forEach(k => { delete wipeOK[k]; });
    setStatus("syncing");
    const sent = {};
    const rows = targets.map(k => {
      sent[k] = canon(D()[k]);
      return { key: k, value: D()[k], updated_by: CLIENT_ID, base_at: serverAt[k] || null };
    });
    try {
      const back = await restUpsert(rows);
      const atOf = {};
      back.forEach(r => { if (r && r.key) atOf[r.key] = String(r.updated_at || ""); });
      targets.forEach(k => {
        snapshots[k] = sent[k];
        baseOK[k] = true;
        serverAt[k] = atOf[k] || undefined;          // 응답에 시각이 없으면 다음 저장 전에 다시 받는다
      });
      /* 보내는 동안 또 바뀐 것은 pending 에 남긴다 */
      setPending(pendingKeys().filter(k => targets.indexOf(k) < 0 || canon(D()[k]) !== sent[k]));
      setStatus("online");
    } catch (e) {
      if (e && e.conflict) {
        /* 그 사이 다른 화면이 저장함 → 서버 값을 받아 병합 후 다시 저장 */
        setPending(targets.concat(pendingKeys()));
        const depth = (o.depth || 0) + 1;
        if (depth <= CONFLICT_RETRY) {
          try { await pullNow(false, targets, depth); return; }
          catch (x) { setStatus("offline"); scheduleRetry(); throw x; }
        }
        setStatus("offline");
        scheduleRetry();
        throw e;
      }
      if (e && (e.status === 401 || e.status === 403)) {
        setPending(targets.concat(pendingKeys()));
        if (await checkSession()) throw e;          // 세션 만료 — 다시 로그인하면 이어서 저장
        revertKeys(targets);                        // 세션은 유효 = 권한 없음
        toastSafe("권한이 없어 저장되지 않은 변경을 되돌렸습니다.", true);
        setStatus("online");
        return;
      }
      setPending(targets.concat(pendingKeys()));
      setStatus("offline");
      scheduleRetry();
      throw e;
    }
  }

  /* ── pull: 서버 → 로컬(onlyKeys 있으면 그 컬렉션만) ── */
  function pull(initial, onlyKeys) { return serial(() => pullNow(initial, onlyKeys, 0)); }
  async function pullNow(initial, onlyKeys, depth) {
    if (!sess || sess.kind !== "user" || !token) return false;
    const readable = readKeys();
    const want = onlyKeys ? onlyKeys.filter(k => readable.indexOf(k) >= 0) : readable;
    if (!want.length) return false;
    /* GET 이전의 pending·dirty 를 함께 기억한다 — GET 이 도는 동안의 변경도 병합 대상으로 */
    const before = Array.from(new Set(pendingKeys().concat(dirtyKeys())));
    let rows;
    try { rows = await restGet(onlyKeys ? want : null); }
    catch (e) {
      if (e && (e.status === 401 || e.status === 403)) await checkSession();
      throw e;
    }
    rows = (Array.isArray(rows) ? rows : []).filter(r => r && want.indexOf(r.key) >= 0);
    if (!onlyKeys && !rows.length && await checkSession()) return false;   // RLS가 모두 걸렀다 = 세션 만료
    const pend = Array.from(new Set(pendingKeys().concat(dirtyKeys(), before))).filter(canWrite);
    const force = !!initial && ss.get(SS_FORCE) === "1";
    let changed = false;
    const present = {};
    rows.forEach(row => {
      present[row.key] = true;
      const remote = canon(row.value);
      const at = String(row.updated_at || "");
      if (force && canWrite(row.key)) { serverAt[row.key] = at; return; } // 강제 push 모드(백업 복원)면 로컬 우선
      if (pend.includes(row.key)) {
        /* 로컬 미전송 변경 + 서버 데이터 → 3-way 병합(기준을 모르면 합집합 · 로컬 우선) 후 push */
        const merged = mergeKey(row.key, baseOf(row.key), D()[row.key], row.value);
        if (canon(merged) !== canon(D()[row.key])) { D()[row.key] = merged; changed = true; }
        markBase(row.key, remote, at);
        return;
      }
      if (remote !== canon(D()[row.key])) {
        D()[row.key] = row.value;
        changed = true;
      }
      markBase(row.key, remote, at);
    });
    want.forEach(k => { if (!present[k]) serverAt[k] = ""; });            // 서버에 아직 행이 없음
    if (!onlyKeys) { stale = false; lastFullPull = Date.now(); }
    // 반영 후 정규화 — 서버의 옛 형식 데이터가 로컬 마이그레이션을 되돌리지 않게. 보정분은 dirty → push
    try { if (SeMIS.normalizeData && SeMIS.normalizeData()) changed = true; } catch (e) {}
    // 서버에 없는 컬렉션은 로컬 데이터로 시드(쓰기 권한 있을 때만)
    const missing = onlyKeys ? [] : want.filter(k => !present[k] && canWrite(k));
    const toPush = (force ? writeKeys()
      : Array.from(new Set(missing.concat(pend.filter(k => present[k]), dirtyKeys())))).filter(canWrite);
    if (changed) {
      SeMIS.saveSilent();
      rerender();
    }
    if (toPush.length) await pushNow(toPush, { allowWipe: !!force, all: !!force, depth: depth || 0 });
    if (force) ss.del(SS_FORCE);
    setStatus("online");
    try { if (window.SemisFileAuth) SemisFileAuth.warm(); } catch (e) {}
    return changed;
  }

  /* ── 원격 변경 반영 ── */
  function applyRemote(key, value) {
    if (!SYNC_KEYS.includes(key)) return false;
    const remote = canon(value);
    if (remote === canon(D()[key])) { markBase(key, remote); return false; }
    D()[key] = value;
    markBase(key, remote);
    // 정규화 보정분은 디바운스 push(멱등이라 루프 없음)
    try { if (SeMIS.normalizeData && SeMIS.normalizeData()) queuePush(); } catch (e) {}
    SeMIS.saveSilent();
    rerender();
    return true;
  }

  function rerender() {
    try {
      if (!SeMIS.user) return;
      SeMIS.renderHeader();
      SeMIS.renderNav();
      SeMIS.renderView();
    } catch (e) { /* 렌더 실패가 동기화를 막지 않도록 */ }
  }

  /* ── 실시간 — 변경 알림(컬렉션 이름만) → 그 컬렉션만 다시 읽기. 실패 시 폴링 ── */
  const remoteKeys = new Set();
  let remoteTimer = null;
  function queueRemote(key) {
    remoteKeys.add(key);
    if (remoteTimer) return;
    remoteTimer = setTimeout(() => {
      const keys = Array.from(remoteKeys);
      remoteKeys.clear(); remoteTimer = null;
      pull(false, keys).then(ch => { if (ch) toastSafe("다른 사용자의 변경 사항이 반영되었습니다."); })
        .catch(() => { /* 다음 알림·폴링에서 다시 */ });
    }, 400);
  }
  function onBroadcast(msg) {
    const p = (msg && msg.payload) || {};
    const key = String(p.key || "");
    if (!key || !canRead(key)) return;
    if (String(p.by || "").replace(/^.*\//, "") === CLIENT_ID) return;   // 내가 보낸 변경
    queueRemote(key);
  }
  function subscribe() {
    if (realtimeOn || !sess || sess.kind !== "user") return;
    if (typeof window === "undefined" || !window.supabase || !window.supabase.createClient) {
      startPolling(); // CDN 차단 등 → 폴링 폴백
      return;
    }
    try {
      if (!realtimeClient) realtimeClient = window.supabase.createClient(SUPA_URL, SUPA_KEY,
        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      if (channel) { try { realtimeClient.removeChannel(channel); } catch (e) {} }
      channel = realtimeClient.channel(CHANNEL)
        .on("broadcast", { event: "change" }, onBroadcast)
        .subscribe((st) => {
          if (st === "SUBSCRIBED") {
            realtimeOn = true; stopPolling(); setStatus("online");
            /* 재연결 — 끊긴 동안의 알림은 오지 않으므로 한 번 다시 받는다 */
            if (Date.now() - lastFullPull > 10000) pull(false).catch(() => {});
          }
          else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
            realtimeOn = false; startPolling();
          }
        });
    } catch (e) { startPolling(); }
  }

  /* ── 폴링 폴백 ── */
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      pull(false).catch(() => { setStatus("offline"); scheduleRetry(); });
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ── 세션 확인·연장 ── */
  function startBeat() {
    if (beatTimer) return;
    beatTimer = setInterval(() => {
      if (!token) return;
      whoami(true).then(d => {
        if (d && d.ok === false) { sessionLost(); return; }
        try { if (d && d.ok && SeMIS.sessionUpdated) SeMIS.sessionUpdated(d); } catch (e) {}
      }).catch(() => { /* 네트워크 — 다음 주기에 */ });
    }, BEAT_MS);
  }
  function stopBeat() { if (beatTimer) { clearInterval(beatTimer); beatTimer = null; } }

  /* ── 잠자기 · 탭 숨김 복귀 ──
     절전·잠자기 탭(Edge)·휴대폰 화면 꺼짐 동안 타이머·실시간 연결이 멈춤 → 돌아오면 먼저 서버 값을 다시 받는다.
     그 전에 생긴 자동 변경은 base_at 확인(409)에 걸려 덮어쓰지 못하고 병합 후 저장 */
  let lastTick = Date.now(), wakeTimer = null, hiddenAt = 0, lastFullPull = 0, wakeHooked = false;
  function onWake() {
    if (!sess || sess.kind !== "user" || !token || lostFired) return;
    stale = true;
    setStatus("syncing");
    pull(false).then(() => { if (!realtimeOn) subscribe(); })
      .catch(() => { setStatus("offline"); scheduleRetry(); });
  }
  function startWake() {
    lastTick = Date.now();
    if (!wakeTimer) {
      wakeTimer = setInterval(() => {
        const now = Date.now(), gap = now - lastTick;
        lastTick = now;
        if (gap > WAKE_GAP_MS) onWake();       // 타이머가 오래 멈춤 = 잠자기 복귀
      }, WAKE_TICK_MS);
    }
    if (wakeHooked || typeof document === "undefined") return;
    wakeHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      const was = hiddenAt; hiddenAt = 0;
      if (was && Date.now() - was > WAKE_GAP_MS) onWake();
    });
    document.addEventListener("resume", () => onWake());                      // 얼렸던 탭이 풀림(Page Lifecycle)
    window.addEventListener("pageshow", (ev) => { if (ev && ev.persisted) onWake(); });   // 뒤로 가기 캐시
  }
  function stopWake() { if (wakeTimer) { clearInterval(wakeTimer); wakeTimer = null; } }

  /* ── 재시도 ── */
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; reconnect(); }, RETRY_MS);
  }
  function reconnect() {
    if (!sess || sess.kind !== "user" || lostFired) return;
    pull(false).then(() => { if (!realtimeOn) subscribe(); })
      .catch(() => { setStatus("offline"); scheduleRetry(); });
  }

  /* ── save 후크: 변경 감지 → 디바운스 push ── */
  function queuePush() {
    if (!sess || sess.kind !== "user") return;
    const dk = dirtyKeys().filter(canWrite);
    if (!dk.length) return;
    setPending(pendingKeys().concat(dk)); // push 성공 시 비워짐 — 새로고침 유실 방지
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      push().catch(() => {});
    }, DEBOUNCE_MS);
  }

  /* ── 파일 — 비공개 버킷, Edge Function semis-logi-files 가 서명 URL 발급 ── */
  const STORAGE_API = SUPA_URL + "/storage/v1";
  const PUBLIC_PREFIX = STORAGE_API + "/object/public/" + BUCKET + "/";   // 저장용 표준 주소(열람은 서명 URL로)
  async function filesCall(body) {
    if (typeof fetch === "undefined") throw new Error("offline");
    if (!token) { const e = new Error("auth"); e.status = 401; throw e; }
    const res = await fetch(FN_FILES, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-semis-token": token },
      body: JSON.stringify(body || {})
    });
    let d = null;
    try { d = await res.json(); } catch (e) { d = null; }
    if (res.status === 401) checkSession();
    if (!res.ok || !d || d.ok === false) {
      const e = new Error("files " + ((d && d.error) || res.status));
      e.status = res.status; e.code = d && d.error;
      throw e;
    }
    return d;
  }
  async function uploadFile(file, prefix) {
    const meta = await filesCall({ op: "upload", prefix: prefix || "files", name: String((file && file.name) || "file"),
      type: (file && file.type) || "", size: (file && file.size) || 0 });
    const res = await fetch(meta.upload, {
      method: "PUT",
      headers: { "Content-Type": (file && file.type) || "application/octet-stream", "x-upsert": "false" },
      body: file
    });
    if (!res.ok) throw httpErr("upload", res);
    return { name: file.name, size: file.size || 0, url: meta.url };
  }
  async function signFiles(paths) {
    const d = await filesCall({ op: "sign", paths: (paths || []).slice(0, 200) });
    return { urls: d.urls || {}, denied: d.denied || [], expires: Number(d.expires) || 3600 };
  }
  /* 버킷 전체 파일 목록 — [{ path, name, folder, size, updated, url }] (시스템관리자) */
  async function listFiles() {
    const d = await filesCall({ op: "list" });
    return (d.files || []).map(f => Object.assign({}, f, { size: Number(f.size) || 0, url: PUBLIC_PREFIX + f.path }));
  }
  async function deleteFile(path) {
    const d = await filesCall({ op: "delete", paths: [String(path)] });
    if (!(d.deleted || []).length) throw new Error("delete");
    return true;
  }

  /* 사이트 파비콘 — Edge Function semis-logi-favicon(시스템관리자)이 { data: "data:<형식>;base64,…", type, src } 반환.
     화면이 64px PNG로 줄여 메뉴에 저장 */
  async function favicon(url) {
    if (typeof fetch === "undefined") throw new Error("offline");
    if (!token) { const e = new Error("auth"); e.status = 401; throw e; }
    const res = await fetch(FN_FAV, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-semis-token": token },
      body: JSON.stringify({ url: String(url || "") })
    });
    let d = null;
    try { d = await res.json(); } catch (e) { d = null; }
    if (res.status === 401) checkSession();
    if (!res.ok || !d || d.ok === false || typeof d.data !== "string") {
      const e = new Error("favicon " + ((d && d.error) || res.status));
      e.status = res.status; e.code = (d && d.error) || "";
      throw e;
    }
    return { data: d.data, type: String(d.type || ""), src: String(d.src || "") };
  }

  /* 테이블 행 수 (Content-Range 헤더) — 실패해도 화면은 계속 동작 */
  async function countRows(table) {
    if (typeof fetch === "undefined") return null;
    const res = await fetch(SUPA_URL + "/rest/v1/" + encodeURIComponent(table) + "?select=id&limit=1",
      { headers: hdr({ Prefer: "count=exact" }) });
    if (!res.ok) return null;
    const cr = res.headers && res.headers.get ? res.headers.get("content-range") : "";
    const n = Number(String(cr || "").split("/")[1]);
    return Number.isFinite(n) ? n : null;
  }

  /* 단일 KV 조회 — SYNC_KEYS 밖 설정 행(예: caresCfg) */
  async function fetchKV(key) {
    if (typeof fetch === "undefined") return null;
    const res = await fetch(REST + "?key=eq." + encodeURIComponent(key) + "&select=key,value", { headers: hdr() });
    if (!res.ok) throw httpErr("GET", res);
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows.find(r => r && r.key === key) : null;
    return row ? row.value : null;
  }

  /* ── 서버 변경 이력(semis_store_history · 시스템관리자 RPC) ── */
  async function history(key, limit) {
    const d = await rpc("semis_logi_history", { p_key: key || null, p_limit: limit || 60 });
    if (!d || !d.ok) throw new Error((d && d.error) || "history");
    return d.rows || [];
  }
  async function historyValue(id) {
    const d = await rpc("semis_logi_history_value", { p_id: Number(id) });
    return d && d.ok ? d.row : null;
  }
  /* 이력 한 건으로 복원 — 사용자 확인을 거쳤으므로 빈 값도 허용 */
  async function restoreHistory(id) {
    const row = await historyValue(id);
    if (!row || !SYNC_KEYS.includes(row.key) || !canWrite(row.key)) throw new Error("not-found");
    D()[row.key] = row.old_value;
    confirmWipe(row.key);
    SeMIS.saveSilent();
    await push([row.key], { allowWipe: true });
    rerender();
    return row.key;
  }

  /* ── 수동 동기화 ── */
  async function syncNow() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    await push().catch(() => {});
    await pull(false);
    if (!realtimeOn) subscribe();
    return status;
  }
  /* 잠자기 복귀 후 아직 서버 값을 못 받음 — 자동 변경(일정 자동 연기 등)은 이때 미룬다 */
  function isStale() { return stale; }

  /* ── 시작 — 로그인·세션 확인 뒤 app.js 가 호출 ── */
  function start() {
    if (typeof SeMIS === "undefined") return Promise.resolve();
    if (typeof fetch === "undefined") { setStatus("offline"); return Promise.resolve(); }
    if (!sess || sess.kind !== "user" || !token) return Promise.resolve();
    lostFired = false;
    /* 이미 서버와 맞춘 컬렉션은 기준(값·시각) 유지, 처음이면 이 탭 값으로 시작 */
    SYNC_KEYS.forEach(k => { if (!baseOK[k]) snapshots[k] = canon(D()[k]); });
    if (!hooked) {
      hooked = true;
      SeMIS.onSave(queuePush);
      const el = document.getElementById("sync-status");
      if (el) el.onclick = () => { setStatus("syncing"); syncNow().catch(() => setStatus("offline")); };
      if (typeof window !== "undefined") {
        window.addEventListener("online", () => reconnect());
        window.addEventListener("offline", () => setStatus("offline"));
      }
    }
    setStatus("init");
    startBeat();
    startWake();
    return pull(true)
      .then(() => subscribe())
      .catch(() => { setStatus("offline"); scheduleRetry(); });
  }

  function stop() { // 로그아웃·테스트 정리
    stopPolling(); stopBeat(); stopWake();
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (remoteTimer) { clearTimeout(remoteTimer); remoteTimer = null; remoteKeys.clear(); }
    try { if (realtimeClient) realtimeClient.removeAllChannels(); } catch (e) {}
    channel = null; realtimeOn = false;
  }

  window.SemisSync = {
    start, init: start, stop, syncNow, uploadFile, fetchKV, ANON: SUPA_KEY, URL: SUPA_URL,
    listFiles, deleteFile, signFiles, filesCall, countRows, BUCKET, PUBLIC_PREFIX, FN_FILES, favicon, FN_FAV, FN_ARGO,
    push, pull, applyRemote, onBroadcast,
    history, historyValue, restoreHistory,
    confirmWipe, guardEvents, guardWipe, GUARD_MIN,
    dirtyKeys, pendingKeys, snapAll, merge3, isStale,
    _serverAt: (k) => serverAt[k], _wake: onWake,
    rpc, canRead, canWrite, readKeys, writeKeys,
    auth: { login, whoami, logout, check: checkSession, prepare,
            token: () => token, session: () => sess, clear: clearAuth,
            _set(t, d) { token = t || ""; if (t) ss.set(SS_TOKEN, token); if (d) setSession(d); lostFired = false; } },
    get status() { return status; },
    CLIENT_ID, SYNC_KEYS,
    _flush() { if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; } return push(); },
    _canon: canon
  };
})();
