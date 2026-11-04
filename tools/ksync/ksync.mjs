#!/usr/bin/env node
/* H:drive K드라이브 동기화 에이전트(Mac · launchd) — 나가는 HTTPS 만, 들어오는 포트 없음. 서버가 보낼 수 있는 것은 '지금 동기화 요청' 표시 하나.
   순서: 잠금 → (오늘 끝냈고 30분 안에 서버를 봤으면 끝) → 사내망 확인(SMB TCP 445) → hello → 마운트 → 색인 · 계획(plan.mjs) · 실행 → 끝 보고.
   명령: --once(지금 한 번) · --dry-run(계획만 출력) · --status. 설정 ~/Library/Application Support/hdrive-ksync/config.json(600), 키는 키체인(hdrive-ksync). */
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { plan, MAX_SIZE, conflictName, dirOf, K_BLOCK } from "./plan.mjs";
import * as L from "./lib.mjs";

export const VERSION = "1.61.0";
const MIN = 60e3;

export async function runAgent(deps, args = {}) {
  const log = deps.log, now0 = deps.now();
  const release = await L.lock(deps.paths.lock, now0);
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
  const save = () => L.writeJson(paths.state, st);
  if (st.logDay !== today) { await L.pruneLog(paths.log, now); st.logDay = today; }
  const dailyAt = L.hhmm(st.dailyAt) ?? L.hhmm(cfg.dailyAt) ?? 8 * 60 + 30;
  const due = L.kstMin(now) >= dailyAt && st.lastOkDay !== today;
  const seen = now - Number(st.lastSeen || 0);
  if (!args.once && !args.dryRun && !args.status) {
    if (st.lastOkDay === today && seen < 30 * MIN) return { status: "done-today" };
    if (!due && seen < 5 * MIN) return { status: "recent" };
  }
  const key = await deps.key();
  if (!key) { log("error", "키체인에 에이전트 키가 없습니다(install.sh)"); return { status: "nokey" }; }
  const srv = L.makeClient(deps.fetch, cfg.server, key, deps.sleep);

  const netr = await deps.netCheck(smb.host);
  if (!netr.ok) {
    if (args.status) { deps.out({ net: false, lastOk: st.lastOk || null, lastSeen: st.lastSeen || null }); return { status: "offline" }; }
    if (due || args.once) {
      if (args.once || now - Number(st.netAt || 0) >= 60 * MIN) {
        try { await srv.call("net", { ok: false, msg: "K드라이브 응답 없음(" + netr.msg + ")" }); st.netAt = now; } catch (e) { log("warn", "연결 안 됨 보고 실패: " + e.code); }
      }
      st.offlineDay = today;
      if (st.notifiedDay !== today) {
        await deps.notify("K드라이브에 연결할 수 없습니다. 사내망(VPN)에 연결되면 자동으로 동기화합니다");
        st.notifiedDay = today;
      }
      log("info", "사내망 아님 — " + netr.msg);
    }
    await save();
    return { status: "offline" };
  }

  let hello;
  try { hello = await srv.call("hello", { ver: VERSION, host: deps.host }); }
  catch (e) {
    log("warn", e.code === "ip" ? "서버가 이 접속 IP 를 허용하지 않음 — 대시보드 '보안'의 후보 IP 확인" : "서버 연결 실패: " + e.code);
    if (args.status) deps.out({ net: true, server: e.code });
    return { status: "server", code: e.code };
  }
  st.lastSeen = now;
  if (hello.daily_at) st.dailyAt = hello.daily_at;
  if (args.status) {
    deps.out({ version: VERSION, net: true, allow: hello.allow, requested: !!hello.requested, dailyAt: hello.daily_at, lastOk: st.lastOk || null, maps: (hello.maps || []).length });
    await save();
    return { status: "status" };
  }
  if (!hello.allow) { log("info", "허용 IP 대기 — 대시보드 '보안'에서 이 IP 를 [허용]"); await save(); return { status: "wait-ip" }; }
  const due2 = L.kstMin(now) >= (L.hhmm(hello.daily_at) ?? dailyAt) && st.lastOkDay !== today;
  let trigger = hello.requested ? "manual" : due2 ? (st.offlineDay === today ? "net" : "daily") : "";
  if (args.once && !trigger) trigger = "manual";
  if (!trigger && !args.dryRun) { await save(); return { status: "idle" }; }

  let mount;
  try { mount = await deps.mountRoot(smb); }
  catch (e) { log("error", "K드라이브 마운트 실패"); await save(); return { status: "mount" }; }
  const full = await srv.call("hello", { full: true });
  const lists = new Map((full.lists || []).map(l => [l.map, l]));
  const maps = (full.maps || []).filter(m => m.state !== "paused" && lists.has(m.id));

  if (args.dryRun) {
    for (const m of maps) {
      const root = await mapRoot(mount, m);
      if (!root) { deps.out({ map: m.id, k_path: m.k_path, error: "no_folder" }); continue; }
      const li = lists.get(m.id);
      const idx = await L.indexDir(root, new Map(li.base.map(b => [b.rel_path, b])));
      const p = plan({ map: m.state === "preview" ? Object.assign({}, m, { hold: { ok: true } }) : m, baseline: li.base, kList: idx.list, hList: li.h, limit: full.mass_limit, today });
      deps.out({ map: m.id, k_path: m.k_path, state: m.state, held: p.held, counts: p.counts, actions: p.planned.map(a => [a.op, a.rel || "", a.mode || a.state || ""].join(" ").trim()) });
    }
    await save();
    return { status: "dry-run" };
  }

  const run = (await srv.call("run", { phase: "start", trigger })).run;
  log("info", "동기화 시작(" + trigger + ") 회차 " + run);
  const tot = { k2h: 0, h2k: 0, conflicts: 0, skipped: 0, errors: 0 }, detail = [], mapRes = [];
  let result = "ok", msg = "";
  try {
    if (st.foldersDay !== today) {
      try { await srv.call("folders", { list: await L.folderTree(mount) }); st.foldersDay = today; } catch (e) { log("warn", "폴더 목록 보고 실패: " + e.code); }
    }
    for (const m of maps) {
      const r = await syncMap({ deps, srv, run, mount, today, limit: full.mass_limit }, m, lists.get(m.id));
      ["k2h", "h2k", "conflicts", "skipped", "errors"].forEach(k => { tot[k] += r[k] || 0; });
      r.detail.forEach(d => detail.push(d));
      mapRes.push({ id: m.id, held: !!r.held, n: r.n || 0, base: r.base || 0, done: !r.held && !r.preview && !r.fatal, n_files: r.n_files });
      if (r.quota) { msg = "하루 전송량 상한"; break; }
    }
    if (st.trashDay !== today) {
      for (const m of maps) { const root = await mapRoot(mount, m); if (root) await L.cleanTrash(root, now); }
      st.trashDay = today;
    }
  } catch (e) {
    result = "fail"; msg = "중단: " + (e.code || "error"); log("error", msg);
  }
  if (result !== "fail") result = tot.errors || msg ? "partial" : mapRes.some(x => x.held) ? "held" : "ok";
  try {
    await srv.call("run", Object.assign({ phase: "end", run, result, msg, detail: detail.slice(-200), maps: mapRes }, tot));
  } catch (e) { log("warn", "끝 보고 실패: " + e.code); }
  if (result !== "fail") { st.lastOk = new Date(now).toISOString(); st.lastOkDay = today; }
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

async function syncMap(ctx, m, li) {
  const { deps, srv, run, mount, today } = ctx;
  const log = deps.log;
  const res = { k2h: 0, h2k: 0, conflicts: 0, skipped: 0, errors: 0, detail: [] };
  const line = (f, a, r) => res.detail.push({ m: m.id, f: String(f || "").slice(0, 200), a, r: r || "" });
  const root = await mapRoot(mount, m);
  if (!root) { res.errors++; res.fatal = true; line(m.k_path, "error", "no_folder"); log("error", "연결 폴더 없음: " + m.k_path); return res; }
  const byRel = new Map(li.base.map(b => [b.rel_path, b]));
  const idx = await L.indexDir(root, byRel);
  idx.errors.forEach(e => { res.errors++; line(e.f, "error", e.r); });
  res.n_files = idx.list.length;
  const preview = m.state === "preview";
  const p = plan({ map: preview ? Object.assign({}, m, { hold: { ok: true } }) : m, baseline: li.base, kList: idx.list, hList: li.h, limit: ctx.limit, today });
  if (preview) { await srv.call("preview", { map: m.id, counts: p.counts }); res.preview = true; return res; }
  res.n = p.n; res.base = p.base;
  if (p.held) { res.held = true; line(m.k_path, "held", p.n + "건"); log("warn", `대량 변경 보류: ${m.k_path} ${p.n}건 / ${p.base}건 — 대시보드에서 승인`); return res; }
  p.detail.forEach(d => { if (d.a !== "k2h" && d.a !== "h2k") res.detail.push(d); });
  const absOf = (rel) => { const k = idx.list.find(x => x.rel === rel); return k ? k.abs : L.safeAbs(root, rel); };
  const marks = [];
  const flush = async () => {
    while (marks.length) {
      const items = marks.splice(0, 200);
      const r = await srv.call("mark", { run, map: m.id, items });
      if (r.held) throw Object.assign(new Error("held"), { code: "held" });
    }
  };
  const cf = new Map();
  const order = (a) => (a.op === "rename" ? 0 : a.op === "trash" || a.op === "drop" ? 3 : a.op === "state" || a.op === "event" ? 2 : 1);
  const acts = p.actions.slice().sort((a, b) => order(a) - order(b));
  let phase = -1;
  for (const a of acts) {
    if (order(a) !== phase) { await flush(); phase = order(a); }
    try {
      if (a.op === "rename") marks.push({ op: "rename", id: a.row, rel_path: a.rel, k_mtime: L.isoMs(a.k.mtime) });
      else if (a.op === "state") marks.push({ op: "state", id: a.row, state: a.state, note: a.note || "" });
      else if (a.op === "event") marks.push({ op: "event", kind: a.kind, f: a.f });
      else if (a.op === "drop") marks.push({ op: "drop", id: a.row });
      else if (a.op === "link") marks.push({ op: "set", rel_path: a.rel, k_size: a.k.size, k_mtime: L.isoMs(a.k.mtime), k_sha256: a.k.sha, doc_id: a.it.doc, h_url: a.it.url });
      else if (a.op === "trash") {
        const abs = await absOf(a.rel);
        await L.moveAside(root, abs, a.rel, "trash", deps.now());
        marks.push({ op: "drop", id: a.row });
        line(a.rel, "trash", "휴지통 폴더로");
      } else if (a.op === "kconf") {
        const abs = await absOf(a.rel);
        const to = await L.uniquePath(path.join(path.dirname(abs), path.basename(conflictName(a.rel, today, 1))));
        await fsp.rename(abs, to);
        cf.set(a.to, path.join(dirOf(a.rel), path.basename(to)).replace(/^\//, ""));
      } else if (a.op === "put") {
        await putOne(ctx, m, root, a, cf, absOf);
        res.k2h += a.mode === "old" ? 0 : 1;
        if (a.state === "conflict") res.conflicts++;
        line(a.rel, "k2h", a.mode);
      } else if (a.op === "get") {
        const ok = await getOne(ctx, m, root, a, absOf, marks);
        if (ok) { res.h2k++; if (a.state === "conflict") res.conflicts++; line(a.rel, "h2k", a.copy ? "충돌 사본" : ""); }
        else { res.errors++; line(a.rel, "error", "hash"); }
        await flush();
      }
    } catch (e) {
      const code = e.code || "error";
      if (code === "held") { res.held = true; line(m.k_path, "held", "서버 보류"); log("warn", "서버가 대량 변경으로 보류: " + m.k_path); break; }
      if (code === "quota") { res.quota = true; res.errors++; line(a.rel, "error", "quota"); break; }
      if (code === "network" || code === "server" || code === "auth" || code === "ip") throw e;
      res.errors++; line(a.rel || a.f || "", "error", code);
      log("warn", `실패 ${a.op} ${a.rel || ""}: ${code}`);
      if (a.row && a.op !== "state" && a.op !== "drop") marks.push({ op: "state", id: a.row, state: "error", note: code });
    }
  }
  try { await flush(); } catch (e) { if (e.code === "held") res.held = true; else throw e; }
  res.skipped = p.counts.skip;
  return res;
}

async function putOne(ctx, m, root, a, cf, absOf) {
  const { srv, run } = ctx;
  const rel = a.mode === "old" ? (cf.get(a.rel) || a.rel) : a.rel;
  const abs = await absOf(rel);
  const buf = await fsp.readFile(abs);
  if (buf.length > MAX_SIZE) throw Object.assign(new Error("too_large"), { code: "too_large" });
  const sha = L.sha256Buf(buf);
  if (sha !== a.k.sha) throw Object.assign(new Error("changed"), { code: "changed" });       // 색인한 뒤 바뀜 — 다음 실행에서
  const b = await srv.call("put", { run, map: m.id, rel_path: rel, size: buf.length, sha256: sha, mtime: L.isoMs(a.k.mtime), mode: a.mode, row: a.row, state: a.state, ssi: !!m.ssi });
  const up = await ctx.deps.fetch(b.upload, { method: "PUT", headers: { "Content-Type": b.type || "application/octet-stream", "x-upsert": "false" }, body: buf });
  if (!up.ok) throw Object.assign(new Error("upload"), { code: "upload" });
  await srv.call("put", { phase: "commit", path: b.path });
}

async function getOne(ctx, m, root, a, absOf, marks) {
  const { srv, run, deps } = ctx;
  const target = a.rel;
  if (K_BLOCK.test(target) || K_BLOCK.test(a.it.name)) throw Object.assign(new Error("type_block"), { code: "type_block" });
  const g = await srv.call("get", { run, map: m.id, doc: a.it.doc, url: a.it.url });
  if (K_BLOCK.test(String(g.name || ""))) throw Object.assign(new Error("type_block"), { code: "type_block" });
  let absT = await L.safeAbs(root, target);
  let dl;
  try { dl = await L.download(deps.fetch, g.url, path.dirname(absT), g.sha256, g.size); }
  catch (e) {
    if (e.code !== "hash") throw e;
    marks.push({ op: "event", kind: "hash_mismatch", f: target });
    if (a.row && !a.copy) marks.push({ op: "state", id: a.row, state: "error", note: "hash" });
    return false;
  }
  try {
    if (a.backup) { const ab = await absOf(a.backup); try { await fsp.lstat(ab); await L.moveAside(root, ab, a.backup, "prev", deps.now()); } catch (e) { if (e.code !== "ENOENT") throw e; } }
    if (a.copy) absT = await L.uniquePath(absT);
    else { try { await fsp.lstat(absT); await L.moveAside(root, absT, target, "prev", deps.now()); } catch (e) { if (e.code !== "ENOENT") throw e; } }
    await fsp.rename(dl.tmp, absT);
  } catch (e) { await fsp.rm(dl.tmp, { force: true }); throw e; }
  if (!a.copy) {
    const st = await fsp.lstat(absT);
    marks.push({ op: "set", id: a.row || undefined, rel_path: target, k_size: st.size, k_mtime: L.isoMs(st.mtimeMs), k_sha256: g.sha256,
      doc_id: a.it.doc, h_url: a.it.url, state: a.state || "ok", note: a.state === "conflict" ? "H:drive 쪽이 늦게 고침" : "" });
  }
  return true;
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
