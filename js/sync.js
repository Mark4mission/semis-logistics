/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — Supabase Sync Layer (v1.15 서버 보안)
   로그인 세션 ↔ Supabase 공용 DB 동기화

   - 로그인: RPC semis_logi_login(암호) → 세션 토큰(64자). 토큰은 이 탭의 sessionStorage 에만 둔다.
     모든 요청에 x-semis-token 헤더를 붙이고, 서버 RLS가 계정 권한으로 컬렉션별 읽기·쓰기를 거른다.
   - 컬렉션 단위 KV 동기화: public.semis_logi_store (key, value jsonb, updated_at, updated_by)
     읽기·쓰기 가능 컬렉션은 로그인 응답의 권한표(acl)로 판단한다.
   - 실시간: DB 트리거가 보내는 변경 알림(Realtime Broadcast "semis-logi-sync", 컬렉션 이름만)을 받으면
     해당 컬렉션만 다시 읽는다. 알림을 못 받으면 30초 폴링.
   - 파일: 비공개 버킷 — Edge Function semis-logi-files 가 서명 URL을 발급한다.
   - 오프라인: 이 탭의 sessionStorage 캐시로 동작, 변경분은 pending 큐에 두었다가 재접속 시 push
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  // anon(publishable) key — 공개용 키. 데이터 권한은 로그인 세션(x-semis-token)과 서버 RLS가 결정한다.
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const TABLE = "semis_logi_store";
  const BUCKET = "semis-logi-files";
  const REST = SUPA_URL + "/rest/v1/" + TABLE;
  const RPC = SUPA_URL + "/rest/v1/rpc/";
  const FN_FILES = SUPA_URL + "/functions/v1/semis-logi-files";
  const CHANNEL = "semis-logi-sync";

  const SYNC_KEYS = ["menus", "notices", "schedules", "assignees", "assigneesSeeded", "minutes", "minuteFolders", "levelHistory", "safetyBoard", "contacts", "gcal", "chatRooms", "vault", "regulations", "equipment", "crisis", "fleet", "audits", "phonebook"];
  /* 탭 세션 저장소 — 로그인 토큰 · 권한 · 미전송 목록은 탭을 닫으면 사라진다 */
  const SS_TOKEN = "semisl:tok";
  const SS_ME = "semisl:me";
  const SS_PENDING = "semisl:pendingSync";
  const SS_FORCE = "semisl:forcePush";
  const LS_GUARD = "semisl:guardLog";   // 대량 삭제 방어 기록(데이터 없음)
  /* 대량 삭제 방어 기준 — 직전 동기화 시점에 이 건수 이상이던 배열이
     로컬에서 0건이 되면 비정상으로 보고 서버 push를 막는다. */
  const GUARD_MIN = 2;
  const CLIENT_ID = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const DEBOUNCE_MS = 800;
  const RETRY_MS = 30000;
  const POLL_MS = 30000;
  const BEAT_MS = 10 * 60 * 1000;      // 세션 확인·연장

  let status = "init";            // init | online | syncing | offline
  let snapshots = {};             // key → canonical JSON (마지막 동기화 시점)
  let pushTimer = null, retryTimer = null, pollTimer = null, beatTimer = null;
  let realtimeClient = null, realtimeOn = false, channel = null;
  let hooked = false, lostFired = false;

  const D = () => SeMIS.data;

  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 저장 불가 */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };

  /* ─── 세션 ─── */
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

  /* ─── canonical stringify (jsonb는 객체 키를 정렬하므로 비교용 정규화) ─── */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }

  /* ─── 상태 표시 ─── */
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

  /* ─── pending 큐 (오프라인 변경분) ─── */
  function pendingKeys() {
    try { return JSON.parse(ss.get(SS_PENDING)) || []; } catch (e) { return []; }
  }
  function setPending(keys) {
    if (keys.length) ss.set(SS_PENDING, JSON.stringify(Array.from(new Set(keys))));
    else ss.del(SS_PENDING);
  }

  /* ─── 스냅샷 / 변경 감지 ─── */
  function snapAll() { SYNC_KEYS.forEach(k => { snapshots[k] = canon(D()[k]); }); }
  function dirtyKeys() { return SYNC_KEYS.filter(k => canon(D()[k]) !== snapshots[k]); }

  /* ─── RPC · REST ─── */
  async function rpc(name, args) {
    if (typeof fetch === "undefined") throw new Error("offline");
    const res = await fetch(RPC + name, { method: "POST", headers: hdr(), body: JSON.stringify(args || {}) });
    if (!res.ok) throw httpErr("rpc " + name, res);
    return res.json();
  }
  async function restGet(keys) {
    let url = REST + "?select=key,value,updated_at,updated_by";
    if (keys && keys.length) url += "&key=in.(" + keys.map(encodeURIComponent).join(",") + ")";
    const res = await fetch(url, { headers: hdr() });
    if (!res.ok) throw httpErr("GET", res);
    return res.json();
  }
  async function restUpsert(rows) {
    const res = await fetch(REST + "?on_conflict=key", {
      method: "POST",
      headers: hdr({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows)
    });
    if (!res.ok) throw httpErr("POST", res);
  }

  /* ─── 로그인 · 확인 · 로그아웃 ─── */
  /* ─── 작업증명(PoW) — js/pow.js (v1.16) ───
     로그인마다 서버가 서명한 문제(2분 유효·1회용)를 풀어 첨부한다. 로그인 창이 떠 있는 동안 미리 푼다. */
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

  /* ─── 대량 삭제 방어 ───
     2026-09-17 일정 전량 유실 사고 대응. 로컬 배열이 통째로 비었는데
     직전 동기화본에는 GUARD_MIN건 이상 있었다면, 사용자의 명시적 삭제가 아니라
     로컬 저장소 손상·버그로 보고 (1) push를 막고 (2) 로컬을 직전 상태로 되돌린다.
     정상적인 전체 삭제는 confirmWipe(key)로 1회 허용한다. */
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

  /* ─── push: 로컬 변경분 → 서버 (쓰기 권한이 있는 컬렉션만) ─── */
  async function push(keys, opts) {
    if (!sess || sess.kind !== "user" || !token) return;
    let targets = Array.from(new Set((keys || []).concat(dirtyKeys(), pendingKeys())))
      .filter(k => SYNC_KEYS.includes(k) && canWrite(k));
    const dropped = pendingKeys().filter(k => !canWrite(k));
    if (dropped.length) setPending(pendingKeys().filter(k => canWrite(k)));
    if (!targets.length) return;
    if (!(opts && opts.allowWipe)) {
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
    const rows = targets.map(k => ({ key: k, value: D()[k], updated_by: CLIENT_ID }));
    try {
      await restUpsert(rows);
      targets.forEach(k => { snapshots[k] = canon(D()[k]); });
      setPending([]);
      setStatus("online");
    } catch (e) {
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

  /* ─── pull: 서버 → 로컬 (onlyKeys 가 있으면 그 컬렉션만) ─── */
  async function pull(initial, onlyKeys) {
    if (!sess || sess.kind !== "user" || !token) return false;
    const readable = readKeys();
    const want = onlyKeys ? onlyKeys.filter(k => readable.indexOf(k) >= 0) : readable;
    if (!want.length) return false;
    /* GET 이전의 pending·dirty 를 함께 기억한다 — GET 이 도는 동안 push 가 끝나
       pending 이 비면, 아직 서버에 반영되지 않은 로컬 변경을 서버의 옛 값으로
       덮어써 "저장한 항목이 사라졌다가 새로고침하면 다시 보이는" 일이 생긴다. */
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
      if (force && canWrite(row.key)) return; // 강제 push 모드(백업 복원)면 로컬 우선
      if (pend.includes(row.key)) {
        // 로컬 미전송 변경 + 서버 데이터 공존 → id 기준 병합(로컬 우선) 후 push
        const merged = mergeById(row.value, D()[row.key]);
        if (merged) { D()[row.key] = merged; changed = true; }
        return;
      }
      if (remote !== canon(D()[row.key])) {
        D()[row.key] = row.value;
        changed = true;
      }
      snapshots[row.key] = remote;
    });
    // 서버 데이터 반영 후 정규화 — 구버전 서버 데이터가 로컬 마이그레이션(신규 메뉴/필드)을
    // 되돌리지 않도록 보정하고, 보정분은 dirty로 잡혀 서버에 push됨(쓰기 권한이 있을 때만)
    try { if (SeMIS.normalizeData && SeMIS.normalizeData()) changed = true; } catch (e) {}
    // 서버에 없는 컬렉션은 로컬 데이터로 시드 (쓰기 권한이 있을 때만)
    const missing = onlyKeys ? [] : want.filter(k => !present[k] && canWrite(k));
    const toPush = (force ? writeKeys()
      : Array.from(new Set(missing.concat(pend.filter(k => present[k]), dirtyKeys())))).filter(canWrite);
    if (changed) {
      SeMIS.saveSilent();
      rerender();
    }
    if (toPush.length) await push(toPush, { allowWipe: !!force });
    if (force) ss.del(SS_FORCE);
    setStatus("online");
    try { if (window.SemisFileAuth) SemisFileAuth.warm(); } catch (e) {}
    return changed;
  }

  /* ─── id 기준 병합: 서버에만 있는 항목 + 로컬 항목(로컬 우선) ─── */
  function mergeById(serverVal, localVal) {
    if (!Array.isArray(serverVal) || !Array.isArray(localVal)) return null;
    if (!serverVal.every(x => x && x.id) || !localVal.every(x => x && x.id)) return null;
    const localIds = new Set(localVal.map(x => x.id));
    const merged = serverVal.filter(x => !localIds.has(x.id)).concat(localVal);
    return merged;
  }

  /* ─── 원격 변경 반영 ─── */
  function applyRemote(key, value) {
    if (!SYNC_KEYS.includes(key)) return false;
    const remote = canon(value);
    if (remote === canon(D()[key])) { snapshots[key] = remote; return false; }
    D()[key] = value;
    snapshots[key] = remote;
    // 원격 반영 후 정규화 — 보정이 생기면 디바운스 push로 서버에 반영 (idempotent라 루프 없음)
    try { if (SeMIS.normalizeData && SeMIS.normalizeData()) queuePush(); } catch (e) {}
    SeMIS.saveSilent();
    rerender();
    return true;
  }

  function rerender() {
    try {
      if (!SeMIS.user) return; // 로그인 전에는 화면 갱신 불필요
      SeMIS.renderHeader();
      SeMIS.renderNav();
      SeMIS.renderView();
    } catch (e) { /* 렌더 실패가 동기화를 막지 않도록 */ }
  }

  /* ─── 실시간: 변경 알림(컬렉션 이름만) → 그 컬렉션만 다시 읽기 ─── */
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
          if (st === "SUBSCRIBED") { realtimeOn = true; stopPolling(); setStatus("online"); }
          else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
            realtimeOn = false; startPolling();
          }
        });
    } catch (e) { startPolling(); }
  }

  /* ─── 폴링 폴백 ─── */
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      pull(false).catch(() => { setStatus("offline"); scheduleRetry(); });
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ─── 세션 확인·연장 (10분) ─── */
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

  /* ─── 재시도 ─── */
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; reconnect(); }, RETRY_MS);
  }
  function reconnect() {
    if (!sess || sess.kind !== "user" || lostFired) return;
    pull(false).then(() => { if (!realtimeOn) subscribe(); })
      .catch(() => { setStatus("offline"); scheduleRetry(); });
  }

  /* ─── save 후크: 변경 감지 → 디바운스 push ─── */
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

  /* ═════════ 파일 (비공개 버킷 · Edge Function semis-logi-files) ═════════ */
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

  /* ─── 단일 KV 조회 (SYNC_KEYS 외 설정 행 — 예: caresCfg) ─── */
  async function fetchKV(key) {
    if (typeof fetch === "undefined") return null;
    const res = await fetch(REST + "?key=eq." + encodeURIComponent(key) + "&select=key,value", { headers: hdr() });
    if (!res.ok) throw httpErr("GET", res);
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows.find(r => r && r.key === key) : null;
    return row ? row.value : null;
  }

  /* ─── 서버 변경 이력 (semis_store_history — 시스템관리자 RPC) ─── */
  async function history(key, limit) {
    const d = await rpc("semis_logi_history", { p_key: key || null, p_limit: limit || 60 });
    if (!d || !d.ok) throw new Error((d && d.error) || "history");
    return d.rows || [];
  }
  async function historyValue(id) {
    const d = await rpc("semis_logi_history_value", { p_id: Number(id) });
    return d && d.ok ? d.row : null;
  }
  /* 이력 한 건을 현재 데이터로 되돌린다 (되돌린 값이 비어 있어도 사용자 확인을 거친 것이므로 허용) */
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

  /* ─── 수동 동기화 ─── */
  async function syncNow() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    await push().catch(() => {});
    await pull(false);
    if (!realtimeOn) subscribe();
    return status;
  }

  /* ─── 시작 (로그인·세션 확인 뒤 app.js 가 부른다) ─── */
  function start() {
    if (typeof SeMIS === "undefined") return Promise.resolve();
    if (typeof fetch === "undefined") { setStatus("offline"); return Promise.resolve(); }
    if (!sess || sess.kind !== "user" || !token) return Promise.resolve();
    lostFired = false;
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
    snapAll();
    setStatus("init");
    startBeat();
    return pull(true)
      .then(() => subscribe())
      .catch(() => { setStatus("offline"); scheduleRetry(); });
  }

  function stop() { // 로그아웃·테스트 정리
    stopPolling(); stopBeat();
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (remoteTimer) { clearTimeout(remoteTimer); remoteTimer = null; remoteKeys.clear(); }
    try { if (realtimeClient) realtimeClient.removeAllChannels(); } catch (e) {}
    channel = null; realtimeOn = false;
  }

  window.SemisSync = {
    start, init: start, stop, syncNow, uploadFile, fetchKV, ANON: SUPA_KEY, URL: SUPA_URL,
    listFiles, deleteFile, signFiles, filesCall, countRows, BUCKET, PUBLIC_PREFIX, FN_FILES,
    push, pull, applyRemote, onBroadcast,
    history, historyValue, restoreHistory,
    confirmWipe, guardEvents, guardWipe, GUARD_MIN,
    dirtyKeys, pendingKeys, snapAll,
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
