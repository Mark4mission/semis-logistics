#!/usr/bin/env node
/* H:drive K드라이브 동기화 에이전트(Mac · launchd) — 나가는 HTTPS 만, 들어오는 포트 없음. 서버가 보낼 수 있는 것은 '지금 동기화 요청' 표시 하나.
   순서: 잠금 → (오늘 끝냈고 25분 안에 서버를 봤으면 끝) → 사내망 확인(SMB TCP 445) → hello → 마운트 → 색인 · 계획(plan.mjs) · 실행 → 끝 보고.
   매일 동기화는 시작 시각부터 30분 창 안에서만. 그때 K드라이브에 닿지 않으면 5분 간격으로 3번까지 해 보고, 그래도 안 되면 그날은 건너뛴다.
   K 의 파일은 지우거나 덮지 않는다 — 덮을 옛 파일은 이전판 폴더로, 삭제 확정은 휴지통 폴더로 옮기기만 하고 휴지통도 비우지 않는다.
   명령: --once(지금 한 번) · --dry-run(계획만 출력) · --status. 설정 ~/Library/Application Support/hdrive-ksync/config.json(600), 키는 키체인(hdrive-ksync). */
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { plan, MAX_SIZE, K_BLOCK, nfc } from "./plan.mjs";
import * as L from "./lib.mjs";

export const VERSION = "1.68.0";
const MIN = 60e3;
const TRIES = 3, RETRY = 5 * MIN;      // 매일 실행이 K드라이브에 닿지 않을 때 — 5분 간격 3번, 그래도 안 되면 다음 날
/* 실행 전체를 멈추는 오류 — 망 · 서버(게이트웨이 포함: 처리했는지 모름) · 키 · IP · 분당 상한(한 번 쉬고도) */
const fatalCode = (c) => c === "network" || c === "server" || c === "auth" || c === "ip" || c === "rate";

export async function runAgent(deps, args = {}) {
  const log = deps.log, now0 = deps.now();
  const release = await L.lock(deps.paths.lock, now0, deps.isAgent);
  if (!release) { log("info", "다른 실행이 진행 중"); return { status: "locked" }; }
  try { return await agent(deps, args); }
  catch (e) { log("error", "중단: " + (e.code || e.message)); return { status: "error", code: e.code || e.message }; }
  finally { release(); }
}

async function agent(deps, args) {
  const { log, paths } = deps;
  const now = deps.now();
  const today = L.kstDay(now);
  const cfg = deps.config;
  const bad = L.checkConfig(cfg, deps.allowHttp);
  if (bad) { log("error", "설정: " + bad); return { status: "config", msg: bad }; }
  const smb = L.parseSmb(cfg.smbUrl);
  const st = Object.assign({}, await L.readJson(paths.state, {}));
  const save = () => (args.dryRun ? Promise.resolve() : L.writeJson(paths.state, st));      // --dry-run 은 출력만(상태 · 기록 정리 · 서버 보고 · 알림 없음)
  if (!args.dryRun && st.logDay !== today) { await L.pruneLog(paths.log, now); st.logDay = today; }
  const dailyAt = L.hhmm(st.dailyAt) ?? L.hhmm(cfg.dailyAt) ?? 8 * 60 + 30;
  // 창 안 · 그날 끝내지 않음 · 그날 건너뛰지 않음(연결이 안 돼 다음 날로 넘김)일 때만 매일 실행
  const win = L.dailyWin(now, dailyAt);
  const due = win.in && st.lastOkDay !== win.day && st.skipDay !== win.day;
  const seen = now - Number(st.lastSeen || 0);
  if (!args.once && !args.dryRun && !args.status) {
    if (st.lastOkDay === today && seen < 25 * MIN) return { status: "done-today" };     // 30분 간격 실행이 조금 일찍 깨어나도 그 회차는 서버를 본다
    if (!due && seen < 5 * MIN) return { status: "recent" };
  }
  const key = await deps.key();
  if (!key) { log("error", "키체인에 에이전트 키가 없습니다(install.sh)"); return { status: "nokey" }; }
  const srv = L.makeClient(deps.fetch, cfg.server, key, deps.sleep, deps.now);

  /* 닿는지 — SMB 445(5초 간격 3번이 한 번의 시도) 뒤 hello. 매일 실행은 안 되면 5분 뒤 다시(3번까지, 잠금을 쥔 채 기다림) —
     hello 의 망 오류(서버까지 못 감)도 같은 시도로 센다. 수동 요청 · --once · --dry-run · --status 는 한 번만 */
  const tries = due && !args.once && !args.dryRun && !args.status ? TRIES : 1;
  let netr, hello, herr;
  for (let i = 0; i < tries; i++) {
    if (i) {
      log("info", `K드라이브에 닿지 않아 5분 뒤 다시 시도(${i + 1}/${tries})`);
      await deps.sleep(RETRY);
      /* 기다리는 사이 Mac 이 잠들면 시계가 건너뛴다 — 계획보다 늦었고(시도마다 걸리는 몇십 초는 2분 여유 안) 그날 창도 지났으면
         매일 실행을 하지 않는다(창이 지나면 따라잡지 않음). 그 창은 다시 오지 않으므로 건너뜀 표시가 필요 없고,
         연결이 안 된 것이 아니라 잠들었던 것이라 연결 안 됨 보고 · '내일' 알림도 없다. 아직 창 안이면 그대로 다시 시도 */
      const t = deps.now(), w = L.dailyWin(t, dailyAt);
      if (t - now > i * RETRY + 2 * MIN && !(w.in && w.day === win.day)) {
        log("info", "다시 시도를 기다리는 사이 Mac 이 잠들어 매일 동기화 창(" + L.winText(dailyAt) + ")이 지남 — 오늘 매일 동기화는 하지 않음");
        await save();
        return { status: "missed" };
      }
    }
    herr = null;
    netr = await L.netRetry(deps.netCheck, smb.host, deps.sleep);
    if (!netr.ok) continue;
    try { hello = await srv.call("hello", { ver: VERSION, host: deps.host }); break; }
    catch (e) { herr = e; if (e.code !== "network" || tries === 1) break; netr = { ok: false, msg: "서버 응답 없음" }; }
  }
  if (herr && (herr.code !== "network" || tries === 1)) {
    log("warn", herr.code === "ip" ? "서버가 이 접속 IP 를 허용하지 않음 — 대시보드 '보안'의 후보 IP 확인" : "서버 연결 실패: " + herr.code);
    if (args.status) deps.out({ net: true, server: herr.code });
    return { status: "server", code: herr.code };
  }
  if (!netr.ok) {
    if (args.status) { deps.out({ net: false, lastOk: st.lastOk || null, lastSeen: st.lastSeen || null }); return { status: "offline" }; }
    if (args.dryRun) { deps.out({ net: false, msg: netr.msg }); return { status: "offline" }; }
    if (tries > 1) {
      // 그날 매일 실행은 여기서 끝(지금 동기화 요청 · --once 는 그대로 받음) — 보고 · 알림은 이 한 번뿐. 서버도 닿지 않을 수 있어 보고는 되는 만큼만
      st.skipDay = win.day; st.offlineDay = today;
      try { await srv.call("net", { ok: false, msg: "K드라이브 응답 없음(" + netr.msg + ") · 오늘 동기화 건너뜀" }); } catch (e) { log("warn", "연결 안 됨 보고 실패: " + e.code); }
      await deps.notify("K드라이브에 연결하지 못해 오늘 동기화를 건너뜁니다. 내일 " + L.winText(dailyAt) + " 에 다시 시도합니다.");
      log("info", "K드라이브에 " + tries + "번 닿지 않아 오늘 매일 동기화를 건너뜀 — " + netr.msg);
    } else if (args.once) {
      try { await srv.call("net", { ok: false, msg: "K드라이브 응답 없음(" + netr.msg + ")" }); } catch (e) { log("warn", "연결 안 됨 보고 실패: " + e.code); }
      st.offlineDay = today;
      log("info", "사내망 아님 — " + netr.msg);
    }
    await save();
    return { status: "offline" };
  }
  st.lastSeen = deps.now();      // 다시 시도로 기다렸으면 시작한 때가 아니라 서버를 본 때(다음 깨우기의 5분 · 25분 판단이 이 값을 본다)
  if (hello.daily_at) st.dailyAt = hello.daily_at;
  if (args.status) {
    deps.out({ version: VERSION, net: true, allow: hello.allow, requested: !!hello.requested, dailyAt: hello.daily_at, lastOk: st.lastOk || null, maps: (hello.maps || []).length });
    await save();
    return { status: "status" };
  }
  if (!hello.allow) { log("info", "허용 IP 대기 — 대시보드 '보안'에서 이 IP 를 [허용]"); await save(); return { status: "wait-ip" }; }
  const dailyMin = L.hhmm(hello.daily_at) ?? dailyAt;
  const win2 = L.dailyWin(now, dailyMin);      // 시작한 시각으로 본다 — 창 안에서 시작해 제때 다시 시도하다 창을 넘겨도 그날 매일 실행(잠들어 늦었으면 위에서 멈춤)
  const due2 = win2.in && st.lastOkDay !== win2.day && st.skipDay !== win2.day;
  let trigger = hello.requested ? "manual" : due2 ? (st.offlineDay === today ? "net" : "daily") : "";
  if (args.once && !trigger) trigger = "manual";
  if (!trigger && !args.dryRun) { await save(); return { status: "idle" }; }

  let mount;
  try { mount = await deps.mountRoot(smb); }
  catch (e) { log("error", "K드라이브 마운트 실패"); await save(); return { status: "mount" }; }
  let full = await srv.call("hello", { full: true });
  let lists = new Map((full.lists || []).map(l => [l.map, l]));
  let maps = (full.maps || []).filter(m => m.state !== "paused" && lists.has(m.id));

  if (args.dryRun) {
    const bs = baseSets(lists, full.paused_base), lk = linkSet(full, lists);
    for (const m of maps) {
      const root = await mapRoot(mount, m);
      if (!root) { deps.out({ map: m.id, k_path: m.k_path, error: "no_folder" }); continue; }
      const since = L.sinceMs(m.since);
      if (isNaN(since)) { deps.out({ map: m.id, k_path: m.k_path, error: "since" }); continue; }
      const li = lists.get(m.id);
      const idx = await L.indexDir(root, new Map(li.base.map(b => [b.rel_path, b])), { since, sizes: bs.sizes, names: lk.names });
      const p = plan({ map: m.state === "preview" ? Object.assign({}, m, { hold: { ok: true } }) : m, baseline: li.base, kList: idx.list, kErr: idx.errors, kCapped: idx.capped, hList: li.h, limit: full.mass_limit, today,
        since, allSha: bs.shas, linkAll: lk.all, hOlds: li.olds });
      deps.out({ map: m.id, k_path: m.k_path, state: m.state, held: p.held, fatal: p.fatal || undefined, errors: idx.errors.map(e => (e.f + " " + e.r).trim()), counts: p.counts,
        actions: p.planned.map(a => [a.op, a.rel || "", a.mode || a.state || ""].join(" ").trim()) });
    }
    await save();
    return { status: "dry-run" };
  }

  const run = (await srv.call("run", { phase: "start", trigger })).run;
  log("info", "동기화 시작(" + trigger + ") 회차 " + run);
  const tot = { k2h: 0, h2k: 0, conflicts: 0, skipped: 0, errors: 0 }, detail = [], mapRes = [];
  let result = "ok", msg = "";
  const carry = Array.isArray(st.marks) ? st.marks.slice() : [], unsent = [];     // 못 보낸 기준선 표시 — 다음 실행이 계획 전에 보낸다
  const olds = st.olds && typeof st.olds === "object" ? st.olds : {};             // H 이전 판으로 이미 올린 K 쪽 판(줄 → sha)
  try {
    if (carry.length && (await replay(srv, run, full, carry, log))) {
      // 회차를 함께 보낸다 — 서버가 덮어쓰기로 셀 판 묶음을 이 기준선으로 다시 잡는다(다시 이은 줄의 옛 판 묶음을 서버만 세지 않게)
      full = await srv.call("hello", { full: true, run });
      lists = new Map((full.lists || []).map(l => [l.map, l]));
      maps = (full.maps || []).filter(m => m.state !== "paused" && lists.has(m.id));
    }
    if (st.foldersDay !== today) {
      try { await srv.call("folders", { list: await L.folderTree(mount) }); st.foldersDay = today; } catch (e) { log("warn", "폴더 목록 보고 실패: " + e.code); }
    }
    const bs = baseSets(lists, full.paused_base), lk = linkSet(full, lists);
    for (const m of maps) {
      const r = await syncMap({ deps, srv, run, mount, today, limit: full.mass_limit, unsent, olds, bs, lk }, m, lists.get(m.id));
      ["k2h", "h2k", "conflicts", "skipped", "errors"].forEach(k => { tot[k] += r[k] || 0; });
      r.detail.forEach(d => detail.push(d));
      // done = 그 연결을 끝까지 맞춤 — 서버는 이때만 승인한 보류를 지운다(전송량 상한 등으로 중간에 멈추면 아님)
      mapRes.push({ id: m.id, held: !!r.held, n: r.n || 0, base: r.base || 0, done: !r.held && !r.preview && !r.fatal && !r.quota && !r.stop, n_files: r.n_files });
      if (r.quota) { msg = "하루 전송량 상한"; break; }
    }
  } catch (e) {
    result = "fail"; msg = "중단: " + (e.code || "error"); log("error", msg);
  }
  if (carry.length || unsent.length) { st.marks = carry.concat(unsent); log("warn", "보내지 못한 기준선 표시는 다음 실행에서 먼저 보냄"); } else delete st.marks;
  if (Object.keys(olds).length) st.olds = olds; else delete st.olds;
  if (result !== "fail") result = tot.errors || msg ? "partial" : mapRes.some(x => x.held) ? "held" : "ok";
  try {
    await srv.call("run", Object.assign({ phase: "end", run, result, msg, detail: detail.slice(-200), maps: mapRes }, tot));
  } catch (e) { log("warn", "끝 보고 실패: " + e.code); }
  if (result !== "fail") {
    st.lastOk = new Date(deps.now()).toISOString();
    st.lastOkDay = win2.day;     // 시작한 때의 창 날짜 — 그날 창 전에 시작한 수동 · --once 실행은 전날 창으로 세어 그날 매일 실행을 대신하지 않는다
  }
  log("info", `동기화 ${result} — K→H ${tot.k2h} · H→K ${tot.h2k} · 충돌 ${tot.conflicts} · 건너뜀 ${tot.skipped} · 오류 ${tot.errors}`);
  await save();
  return { status: result, run, tot, maps: mapRes };
}

/* 연결 폴더 — 공유 안 상대 경로 · 링크 아님 · 실제 위치가 공유 안 */
async function mapRoot(mount, m) {
  if (!L.relOk(m.k_path)) return "";
  try {
    const abs = await L.safeAbs(mount, m.k_path);
    const st = await fsp.lstat(abs);
    if (!st.isDirectory()) return "";
    const real = await fsp.realpath(abs), realMount = await fsp.realpath(mount);
    return real.startsWith(realMount + path.sep) ? abs : "";
  } catch (e) { return ""; }
}

/* 모든 연결의 기준선 크기 · 해시 — 기준일 전 파일이라도 크기가 같으면 해시하고(옮긴 파일 후보), 해시가 같으면 새 파일로 다룬다(연결 폴더끼리 옮김).
   멈춘 연결은 목록이 없어 hello full 의 paused_base(크기 · 해시)로 더한다 */
function baseSets(lists, paused) {
  const all = [...lists.values()].flatMap(l => l.base || []).concat(paused || []);
  return { sizes: new Set(all.map(b => Number(b.k_size))), shas: new Set(all.map(b => b.k_sha256).filter(Boolean)) };
}

/* 서버 깃발 link_all — 켜져 있으면 모든 활성 연결의 H 링크 후보(현재 판 + 옛 판)의 '소문자 이름|크기'.
   색인이 기준일 전 파일 중 이 후보와 같은 것만 해시한다(이을 수 있는 것만 재고 백로그 전체는 재지 않음) */
function linkSet(full, lists) {
  const all = !!(full.flags && full.flags.link_all === true);
  if (!all) return { all, names: null };
  const names = new Set();
  for (const l of lists.values()) for (const it of (l.h || []).concat(l.olds || [])) if (it && it.name && !it.hidden) names.add(nfc(it.name).toLowerCase() + "|" + Number(it.size));
  return { all, names };
}

/* 지난 실행이 보내지 못한 기준선 표시(받아 놓은 파일 · 다시 이은 줄) — 계획 전에 먼저 보낸다. 안 보내면 이미 맞춘 파일을
   양쪽 다 바뀐 것으로 보아 가짜 충돌 · 중복 판이 생긴다. 멈춘 연결 것은 다시 켤 때까지 두고, 지운 연결 것은 버린다. 하나라도 보냈으면 true */
async function replay(srv, run, full, carry, log) {
  let sent = 0;
  for (const k of carry.slice()) {
    const mm = (full.maps || []).find(x => x.id === k.map);
    if (mm && mm.state !== "active") continue;
    if (mm) {
      try {
        const r = await srv.call("mark", { run, map: k.map, items: k.items });
        sent++;
        if (r.bad) log("warn", "지난 기준선 표시 중 서버가 받지 않은 것 " + r.bad + "건");
      } catch (e) { if (fatalCode(e.code)) throw e; log("warn", "지난 기준선 표시 보내기 실패: " + e.code); continue; }
    }
    carry.splice(carry.indexOf(k), 1);
  }
  return sent > 0;
}

async function syncMap(ctx, m, li) {
  const { deps, srv, run, mount, today } = ctx;
  const log = deps.log;
  const res = { k2h: 0, h2k: 0, conflicts: 0, skipped: 0, errors: 0, detail: [] };
  const line = (f, a, r) => res.detail.push({ m: m.id, f: String(f || "").slice(0, 200), a, r: r || "" });
  const root = await mapRoot(mount, m);
  if (!root) { res.errors++; res.fatal = true; line(m.k_path, "error", "no_folder"); log("error", "연결 폴더 없음: " + m.k_path); return res; }
  // 기준일을 읽지 못하면 그 연결을 건너뛴다 — 기준일 없이 맞추면 그 전 파일이 모두 올라간다
  const since = L.sinceMs(m.since);
  if (isNaN(since)) { res.errors++; res.fatal = true; line(m.k_path, "error", "since"); log("error", "기준일 형식이 틀려 건너뜀: " + m.k_path); return res; }
  const byRel = new Map(li.base.map(b => [b.rel_path, b]));
  const idx = await L.indexDir(root, byRel, { cleanBefore: deps.now() - 864e5, since, sizes: ctx.bs.sizes, names: ctx.lk.names });
  idx.errors.forEach(e => { res.errors++; line(e.f, "error", e.r); });
  if (idx.capped) { res.errors++; line(m.k_path, "error", "too_many"); }
  const preview = m.state === "preview";
  const p = plan({ map: preview ? Object.assign({}, m, { hold: { ok: true } }) : m, baseline: li.base, kList: idx.list, kErr: idx.errors, kCapped: idx.capped, hList: li.h, limit: ctx.limit, today,
    since, allSha: ctx.bs.shas, linkAll: ctx.lk.all, hOlds: li.olds });
  if (p.fatal) { res.fatal = true; log("error", "연결 폴더를 다 읽지 못해 건너뜀(" + p.fatal + "): " + m.k_path); return res; }
  res.n_files = idx.list.length - (p.counts.old || 0);
  // 센 설정의 시각(hello 의 updated_at)을 함께 보낸다 — 그 사이 관리자가 설정을 고쳤으면 서버가 옛 설정으로 센 건수를 버린다
  if (preview) {
    // 그 사이 관리자가 [시작] · 멈춤 · 지우기를 눌렀으면(state) 이 건수만 버린다 — 실행 전체를 멈추면 뒤의 연결을 맞추지 못한다
    try { await srv.call("preview", { map: m.id, counts: p.counts, updated_at: m.updated_at }); }
    catch (e) {
      if (fatalCode(e.code)) throw e;
      if (e.code !== "state") { res.errors++; line(m.k_path, "error", e.code); }
      log("warn", "미리보기 건수를 보내지 못함(" + e.code + "): " + m.k_path);
    }
    res.preview = true; return res;
  }
  res.n = p.n; res.base = p.base;
  if (p.held) { res.held = true; line(m.k_path, "held", p.n + "건"); log("warn", `대량 변경 보류: ${m.k_path} ${p.n}건 / ${p.base}건 — 대시보드에서 승인`); return res; }
  p.detail.forEach(d => { if (d.a !== "k2h" && d.a !== "h2k") res.detail.push(d); });
  const absOf = (rel) => { const k = idx.list.find(x => x.rel === rel); return k ? k.abs : L.safeAbs(root, rel); };
  const marks = [];
  /* 서버가 받은 뒤에만 지운다 — 받아 놓은 파일의 기준선 표시를 잃으면 다음 실행이 그 파일을 충돌로 본다.
     실행 전체 오류가 아닌데 못 보냄(연결을 멈춤 · 회차 끝남) → 이 연결만 멈춘다(stop) */
  const flush = async () => {
    while (marks.length) {
      const items = marks.slice(0, 200);
      let r;
      try { r = await srv.call("mark", { run, map: m.id, items }); }
      catch (e) { throw fatalCode(e.code) ? e : Object.assign(new Error("stop"), { code: "stop", why: e.code }); }
      marks.splice(0, items.length);
      if (r.bad && !r.held) { res.errors += r.bad; line(m.k_path, "error", "mark"); log("warn", "서버가 받지 않은 표시 " + r.bad + "건: " + m.k_path); }
      if (r.held) throw Object.assign(new Error("held"), { code: "held" });
    }
  };
  const halt = (e) => {
    if (e.code === "held") { res.held = true; line(m.k_path, "held", "서버 보류"); log("warn", "서버가 대량 변경으로 보류: " + m.k_path); return true; }
    if (e.code === "stop") { res.stop = e.why || "mark"; res.errors++; line(m.k_path, "error", res.stop); log("warn", "표시를 보내지 못해 이 연결만 멈춤(" + res.stop + "): " + m.k_path); return true; }
    return false;
  };
  /* 못 보낸 기준선 표시('set')는 상태 파일에 두었다가 다음 실행이 계획 전에 보낸다 */
  const keepSets = () => {
    const s = marks.filter(x => x.op === "set");
    for (let i = 0; i < s.length; i += 200) ctx.unsent.push({ map: m.id, items: s.slice(i, i + 200) });
    marks.length = 0;
  };
  /* 확인(verify)까지 끝난 올리기 — 문서함 등록은 모아서 한 번(공용 행 docs 를 한 번만 고침: 이력 · 변경 알림 한 번).
     등록하지 않은 올리기는 서버에서 1시간 뒤 없어지므로, 내려받기가 길게 이어져도 가장 오래된 것이 20분이 되면 등록한다 */
  const pend = [];
  let pendAt = 0;
  const apply = async () => {
    const done = new Set();
    let why = "apply";
    while (pend.length) {
      const batch = pend.splice(0, 50);
      let docs = {};
      why = "apply";
      try { docs = (await srv.call("apply", { run, paths: batch.map(x => x.path) })).docs || {}; }
      catch (e) { if (fatalCode(e.code)) throw e; why = e.code || "apply"; }
      for (const x of batch) {
        if (docs[x.path]) { done.add(x.path); res.k2h += x.a.mode === "old" ? 0 : 1; if (x.a.state === "conflict") res.conflicts++; line(x.rel, "k2h", x.a.mode); }
        else if (x.a.mode !== "old") { res.errors++; line(x.rel, "error", why); if (x.a.row) marks.push({ op: "state", id: x.a.row, state: "error", note: why }); }
        // 이전 판 등록 실패는 부른 쪽(keepOld)이 그 내려받기를 멈추고 한 번만 기록한다
      }
    }
    return { done, why };
  };
  /* H 가 이긴 충돌의 K 쪽 판 — K 파일을 충돌 사본 이름으로 옮기기 전에 올려 확인하고 H 이전 판 등록까지 끝낸다.
     옮긴 뒤에 실패하면 기준선은 H 와 같아지고 사본은 색인에서 빠져, K 수정이 H 로 영영 가지 않는다.
     여기서 실패하면 받은 파일을 버려 K 파일 · 기준선이 그대로 남고, 다음 실행이 다시 충돌로 본다 */
  const oldKey = (row) => m.id + "/" + row;
  const keepOld = async (old, src, rel) => {
    // 지난 실행에서 이미 등록했는데 K 파일 이름을 못 바꿈(공유에서 열려 있음 등) — 다시 올리지 않고 이름 바꾸기 · 놓기만 다시
    if (ctx.olds[oldKey(old.row)] === old.k.sha) return;
    const x = { path: await putOne(ctx, m, old, rel, src), a: old, rel };
    pend.push(x);                                         // 이전 판은 그 앞 판들과 함께 · 그 뒤에 등록
    const r = await apply();
    if (!r.done.has(x.path)) throw Object.assign(new Error(r.why), { code: r.why });
    ctx.olds[oldKey(old.row)] = old.k.sha;
  };
  const kc = new Map();
  let skipped = 0;
  const order = (a) => (a.op === "rename" || a.op === "relink" ? 0 : a.op === "trash" || a.op === "drop" ? 3 : a.op === "state" || a.op === "event" ? 2 : 1);
  const acts = p.actions.slice().sort((a, b) => order(a) - order(b));
  let phase = -1;
  try {
    for (const a of acts) {
      if (order(a) !== phase) {
        // 올리기는 1단계에만 있다 — 다음 단계의 기준선 · 상태 표시는 등록(apply)이 만든 줄을 본다
        try { await apply(); await flush(); }
        catch (e) { if (!halt(e)) throw e; break; }
        phase = order(a);
      }
      try {
        if (pend.length && deps.now() - pendAt > 20 * MIN) await apply();
        if (a.op === "rename") marks.push({ op: "rename", id: a.row, rel_path: a.rel, k_mtime: L.isoMs(a.k.mtime) });
        else if (a.op === "relink") marks.push({ op: "set", id: a.row, rel_path: a.rel, k_size: a.k_size, k_mtime: a.k_mtime, k_sha256: a.k_sha256, doc_id: a.it.doc, h_url: a.it.url, state: a.state, note: a.note });
        else if (a.op === "state") marks.push({ op: "state", id: a.row, state: a.state, note: a.note || "" });
        else if (a.op === "event") marks.push({ op: "event", kind: a.kind, f: a.f });
        else if (a.op === "drop") marks.push({ op: "drop", id: a.row });
        else if (a.op === "link") marks.push({ op: "set", rel_path: a.rel, k_size: a.k.size, k_mtime: L.isoMs(a.k.mtime), k_sha256: a.k.sha, doc_id: a.it.doc, h_url: a.it.url });
        else if (a.op === "trash") {
          const abs = await absOf(a.rel);
          // 계획한 뒤(확정한 뒤) K 에서 고친 파일은 옮기지 않는다 — 다음 실행이 고친 것으로 보고 H 로 다시 올린다
          const ks = await fsp.lstat(abs);
          if (!ks.isFile() || ks.size !== a.k.size || Math.floor(ks.mtimeMs) !== a.k.mtime) throw Object.assign(new Error("changed"), { code: "changed" });
          await L.moveAside(root, abs, a.rel, "trash", deps.now());
          marks.push({ op: "drop", id: a.row });
          line(a.rel, "trash", "휴지통 폴더로");
        } else if (a.op === "kconf") kc.set(a.row, a);          // K 파일 이름은 H 판을 받아 확인한 뒤에 바꾼다(getOne)
        else if (a.op === "put") {
          if (a.mode === "old") continue;                         // H 가 이긴 충돌의 K 쪽 판 — 같은 줄의 내려받기(getOne → keepOld)가 올린다
          const t0 = deps.now();
          pend.push({ path: await putOne(ctx, m, a, a.rel, await absOf(a.rel)), a, rel: a.rel });
          if (pend.length === 1) pendAt = t0;
          if (pend.length >= 50) await apply();
        } else if (a.op === "get") {
          const conf = !a.copy && a.row ? kc.get(a.row) : null;
          if (conf) kc.delete(a.row);
          const old = conf && acts.find(x => x.op === "put" && x.mode === "old" && x.row === a.row);
          const got = await getOne(ctx, m, root, a, absOf, marks, conf, old ? (src, rel) => keepOld(old, src, rel) : null);
          if (got) {
            if (a.row && !a.copy) delete ctx.olds[oldKey(a.row)];
            res.h2k++; if (a.state === "conflict") res.conflicts++; line(got.rel, "h2k", a.copy ? "충돌 사본" : "");
          } else { res.errors++; line(a.rel, "error", "hash"); }
          await flush();
        }
      } catch (e) {
        const code = e.code || "error";
        if (halt(e)) break;
        if (code === "quota") { res.quota = true; res.errors++; line(a.rel, "error", "quota"); break; }
        if (fatalCode(code)) throw e;
        if (code === "changed") { skipped++; line(a.rel || "", "skip", "changed"); log("info", "색인한 뒤 바뀜 — 다음 실행에서: " + (a.rel || "")); continue; }
        res.errors++; line(a.rel || a.f || "", "error", code);
        log("warn", `실패 ${a.op} ${a.rel || ""}: ${code}`);
        // K 쪽 판을 이미 H 이전 판으로 올렸으면 충돌로 둔다(다음 실행이 다시 올리지 않고 K 파일 이름 바꾸기만 다시)
        const old = a.op === "get" && acts.find(x => x.op === "put" && x.mode === "old" && x.row === a.row);
        const kept = !!old && ctx.olds[oldKey(a.row)] === old.k.sha;
        if (a.row && a.op !== "state" && a.op !== "drop") marks.push({ op: "state", id: a.row, state: kept ? "conflict" : "error", note: kept ? "H:drive 쪽이 늦게 고침" : code });
      }
    }
    if (!res.stop) { try { await apply(); await flush(); } catch (e) { if (e.code === "held") res.held = true; else if (!halt(e)) throw e; } }
  } catch (e) { keepSets(); throw e; }
  if (marks.length) keepSets();
  res.skipped = p.counts.skip + skipped;
  return res;
}

/* 올리기 3단계 중 앞의 둘: 시작(서버가 폴더 · 저장 경로를 정함) → 서명 URL 로 올림 → 확인(서버가 저장소에서 다시 잼). 등록(apply)은 syncMap 이 모아서 */
async function putOne(ctx, m, a, rel, src) {
  const { srv, run } = ctx;
  const buf = await fsp.readFile(src);
  if (buf.length > MAX_SIZE) throw Object.assign(new Error("too_large"), { code: "too_large" });
  const sha = L.sha256Buf(buf);
  if (sha !== a.k.sha) throw Object.assign(new Error("changed"), { code: "changed" });       // 색인한 뒤 바뀜 — 다음 실행에서
  const b = await srv.call("put", { phase: "begin", run, map: m.id, rel_path: rel, size: buf.length, sha256: sha, mtime: L.isoMs(a.k.mtime), mode: a.mode, row: a.row, state: a.state, h_url: a.h_url });
  const up = await ctx.deps.fetch(b.upload, { method: "PUT", headers: { "Content-Type": b.type || "application/octet-stream", "x-upsert": "false" }, body: buf });
  if (!up.ok) throw Object.assign(new Error("upload"), { code: "upload" });
  await srv.call("put", { phase: "verify", path: b.path });
  return b.path;
}

/* conf = 같은 줄의 kconf(H 가 이긴 충돌) — 받아서 확인한 뒤에야 K 파일을 충돌 사본 이름으로 바꾼다(받기 실패 때 K 수정이 사본 이름에 갇히지 않게).
   keepOld = 그 K 쪽 판을 사본 이름으로 H 이전 판에 올려 등록하는 일 — 이름을 바꾸기 전에 끝낸다(실패하면 받은 것을 버림) */
async function getOne(ctx, m, root, a, absOf, marks, conf, keepOld) {
  const { srv, run, deps, today } = ctx;
  const target = a.rel;
  if (K_BLOCK.test(target) || K_BLOCK.test(a.it.name)) throw Object.assign(new Error("type_block"), { code: "type_block" });
  const g = await srv.call("get", { run, map: m.id, doc: a.it.doc, url: a.it.url });
  if (K_BLOCK.test(String(g.name || ""))) throw Object.assign(new Error("type_block"), { code: "type_block" });
  const absT = await L.safeAbs(root, target);
  let dl;
  try { dl = await L.download(deps.fetch, g.url, path.dirname(absT), g.sha256, g.size); }
  catch (e) {
    if (e.code !== "hash") throw e;
    marks.push({ op: "event", kind: "hash_mismatch", f: target });
    if (a.row && !a.copy) marks.push({ op: "state", id: a.row, state: "error", note: "hash" });
    return null;
  }
  let got;
  try {
    const confAbs = conf ? await absOf(conf.rel) : "";
    const to = conf && keepOld ? await L.conflictPath(root, conf.rel, today) : "";
    if (to) await keepOld(confAbs, L.relOf(root, to));
    got = await L.place(root, dl.tmp, target, {
      backup: a.backup ? { abs: await absOf(a.backup), rel: a.backup, k: a.k } : null,
      conf: conf ? { abs: confAbs, rel: conf.rel, k: conf.k, to } : null,
      copy: a.copy ? a.base : "", today, now: deps.now() });
  } catch (e) { await fsp.rm(dl.tmp, { force: true }); throw e; }
  if (!a.copy) {
    const st = await fsp.lstat(got.abs);
    marks.push({ op: "set", id: a.row || undefined, rel_path: got.rel, k_size: st.size, k_mtime: L.isoMs(st.mtimeMs), k_sha256: g.sha256,
      doc_id: a.it.doc, h_url: a.it.url, state: a.state || "ok", note: a.state === "conflict" ? "H:drive 쪽이 늦게 고침" : "" });
  }
  return got;
}

/* ── 명령줄 ── */
async function main() {
  const argv = process.argv.slice(2);
  const args = { once: argv.includes("--once"), dryRun: argv.includes("--dry-run"), status: argv.includes("--status") };
  const paths = L.defaultPaths();
  const config = await L.readJson(paths.config, null);
  try { const s = await fsp.stat(paths.config); if (s.mode & 0o077) await fsp.chmod(paths.config, 0o600); } catch (e) { /* 설정 없음은 아래에서 */ }
  const fileLog = L.makeLog(paths.log);
  const log = (lv, m) => { fileLog(lv, m); if (args.once || args.dryRun || args.status) console.log("[" + lv + "] " + m); };
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  const deps = {
    paths, config, log, out, now: () => Date.now(), fetch: globalThis.fetch, sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    key: L.keychainKey, netCheck: (h) => L.netCheck(h), mountRoot: (smb) => L.ensureMount(smb, log), notify: L.notify,
    host: (os.hostname() || "Mac").slice(0, 60)
  };
  const r = await runAgent(deps, args);
  if (args.once || args.dryRun) console.log(JSON.stringify(r));
  process.exitCode = r.status === "error" || r.status === "config" || r.status === "nokey" ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
