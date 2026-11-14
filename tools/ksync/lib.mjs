/* H:drive K드라이브 동기화 — 에이전트 도우미(파일 · 색인 · 해시 · 서버 · 마운트 · 알림). npm 의존성 없음(Node ≥ 20). */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import { execFile } from "node:child_process";
import { excluded, nfc, MAX_SIZE, TRASH, PREV, dirOf, stemOf, extOf, join, K_BLOCK, conflictName } from "./plan.mjs";

export const KST = 9 * 3600e3;
export const kstDay = (t) => new Date(t + KST).toISOString().slice(0, 10);
export const kstMin = (t) => { const d = new Date(t + KST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const hhmm = (s) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const isoMs = (ms) => new Date(Math.floor(ms)).toISOString();
/* 연결의 기준일(YYYY-MM-DD) → 한국 시각 그날 0시(ms). 없으면 0, 틀리면 NaN(부른 쪽이 그 연결을 건너뜀 — 기준일 없이 맞추면 옛 파일이 올라간다) */
export function sinceMs(s) {
  if (s == null || s === "") return 0;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? Date.parse(s + "T00:00:00+09:00") : NaN;
  return !isNaN(t) && kstDay(t) === s ? t : NaN;
}
const pad = (n) => String(n).padStart(2, "0");
/* 매일 동기화 창 — 시작 시각(분)부터 30분. 창이 지난 뒤 처음 켜진 Mac 이 그날 늦게 따라잡지 않게 창 안에서만 돈다.
   자정을 넘는 창도 시작한 날의 창: day = 가장 가까운 지난 시작의 날짜, in = 지금 그 창 안 */
export const DAILY_WIN = 30;
export function dailyWin(t, start) {
  const off = (kstMin(t) - start + 1440) % 1440;
  return { in: off < DAILY_WIN, day: kstDay(t - off * 60e3) };
}
const hm = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
export const winText = (start) => hm(start) + "~" + hm((start + DAILY_WIN) % 1440);
export const stampKst = (t) => { const d = new Date(t + KST); return d.toISOString().slice(0, 10) + " " + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()); };

export function defaultPaths(home = os.homedir()) {
  const app = path.join(home, "Library", "Application Support", "hdrive-ksync");
  return { app, config: path.join(app, "config.json"), state: path.join(app, "state.json"), lock: path.join(app, "ksync.lock"),
    log: path.join(home, "Library", "Logs", "hdrive-ksync.log") };
}

export async function readJson(file, dflt) {
  try { return JSON.parse(await fsp.readFile(file, "utf8")); } catch (e) { return dflt; }
}
export async function writeJson(file, v) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + ".tmp-" + process.pid;
  await fsp.writeFile(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

/* 설정 — { server, smbUrl, dailyAt? }. 서버는 https(시험만 http://127.0.0.1), K드라이브는 smb://<서버>/<공유>[/하위] */
export function checkConfig(c, allowHttp) {
  if (!c || typeof c !== "object") return "설정 파일이 없습니다";
  const s = String(c.server || "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[\w./-]*$/.test(s) && !(allowHttp && /^http:\/\/127\.0\.0\.1(:\d+)?\//.test(s))) return "server 주소 형식";
  if (!parseSmb(c.smbUrl)) return "smbUrl 형식(smb://<서버>/<공유>)";
  if (c.dailyAt != null && hhmm(c.dailyAt) == null) return "dailyAt 형식(HH:MM)";
  return "";
}
export function parseSmb(url) {
  const m = /^smb:\/\/(?:[^@/\s"\\]+@)?([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/([^"\\\r\n]+?)\/?$/.exec(String(url || ""));
  if (!m) return null;
  let segs;
  try { segs = m[3].split("/").map(decodeURIComponent); } catch (e) { return null; }
  if (segs.some(s => !s || s === "." || s === "..")) return null;
  return { host: m[1], port: 445, share: segs[0], sub: segs.slice(1), url: "smb://" + m[1] + "/" + m[3] };
}

/* 마운트 주소 — 공유 이름은 해석된 값이라 다시 인코딩(공백 · 한글이 그대로 들어가면 주소가 깨짐). 숨김 공유의 $ 는 그대로 */
export const mountUrl = (smb) => "smb://" + smb.host + "/" + encodeURIComponent(smb.share).replace(/%24/g, "$");

/* 사내망 확인 — SMB 서버 TCP 445 */
export function netCheck(host, port = 445, ms = 4000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok, msg) => { s.destroy(); resolve({ ok, msg }); };
    s.setTimeout(ms, () => done(false, "시간 초과"));
    s.once("connect", () => done(true, ""));
    s.once("error", (e) => done(false, e.code || "연결 안 됨"));
  });
}
/* 로그인 직후에는 망이 늦게 붙는다 — 한 번 실패로 '연결 안 됨' 알림을 내지 않게 간격을 두고 다시 */
export async function netRetry(check, host, sleep, tries = 3, gap = 5000) {
  let r;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(gap);
    r = await check(host);
    if (r && r.ok) return r;
  }
  return r;
}

export async function sha256File(abs) {
  const h = crypto.createHash("sha256");
  await new Promise((res, rej) => { fs.createReadStream(abs).on("data", (d) => h.update(d)).on("end", res).on("error", rej); });
  return h.digest("hex");
}
export const sha256Buf = (b) => crypto.createHash("sha256").update(b).digest("hex");

/* 연결 폴더 색인 — 링크는 따라가지 않는다. 크기 · 수정 시각이 기준선과 같으면 해시를 다시 재지 않는다.
   읽지 못한 곳은 errors(폴더는 dir: true — 계획이 그 아래를 '모름'으로 건너뜀), 상한에 닿으면 capped(계획이 그 연결을 건너뜀).
   opts.cleanBefore 가 있으면 그보다 오래된 내려받기 임시 파일(중단된 실행이 남긴 .ksync-*.part)을 지운다.
   opts.since(기준일 ms) · opts.sizes(모든 연결 기준선의 크기) — 기준선에 없고 기준일 전이며 크기가 어느 기준선과도 다르면 올리지 않을 파일이라 해시하지 않는다
   (크기가 같으면 이름 바꿈 · 연결 사이 이동 후보라 잰다). opts.names(소문자 이름 + "|" + 크기 — H 링크 후보)에 있으면 이어질 수 있어 잰다
   (기준선 표시는 K 해시가 있어야 받는다 — 백로그 전체가 아니라 이어질 것만 재므로 SMB 에서 오래 걸리지 않음) */
const PART_RE = /^\.ksync-[0-9a-f]{12}\.part$/;
export async function indexDir(root, baseByRel, opts = {}) {
  const max = opts.maxFiles || 20000;
  const list = [], errors = [];
  let capped = false;
  async function walk(abs, rel, depth) {
    if (depth > 30) { errors.push({ f: rel, r: "depth", dir: true }); return; }
    let ents;
    try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch (e) { errors.push({ f: rel || ".", r: e.code || "read", dir: true }); return; }
    for (const d of ents) {
      if (capped) return;
      const name = nfc(d.name);
      if (d.isSymbolicLink()) continue;
      const a = path.join(abs, d.name), r = join(rel, name);
      if (opts.skip && opts.skip.has(r.toLowerCase())) continue;     // 지정 제외 — 걷지 않는다(계획에는 '모름'으로 넘김)
      if (opts.cleanBefore && d.isFile() && PART_RE.test(d.name)) {
        try { if ((await fsp.lstat(a)).mtimeMs < opts.cleanBefore) await fsp.unlink(a); } catch (e) { /* 다음 색인 때 */ }
        continue;
      }
      if (d.isDirectory()) { if (!excluded(name, true)) await walk(a, r, depth + 1); continue; }
      if (!d.isFile() || excluded(name, false)) continue;
      if (list.length >= max) { capped = true; return; }
      let st;
      try { st = await fsp.lstat(a); } catch (e) { errors.push({ f: r, r: e.code || "stat" }); continue; }
      const mtime = Math.floor(st.mtimeMs), b = baseByRel && baseByRel.get(r);
      let sha = null;
      const old = !b && opts.since && mtime < opts.since && !(opts.sizes && opts.sizes.has(st.size)) && !(opts.names && opts.names.has(name.toLowerCase() + "|" + st.size));
      if (st.size <= MAX_SIZE && !old) {
        if (b && b.k_sha256 && Number(b.k_size) === st.size && Date.parse(b.k_mtime) === mtime) sha = b.k_sha256;
        else { try { sha = await sha256File(a); } catch (e) { errors.push({ f: r, r: e.code || "read" }); continue; } }
      }
      list.push({ rel: r, abs: a, size: st.size, mtime, sha });
    }
  }
  await walk(root, "", 0);
  return { list, errors, capped };
}

/* 폴더 목록(3단계 · 이름과 바로 아래 파일 수만). skip = 전체 지정 제외(소문자 경로) — 걷지도 알리지도 않는다 */
export async function folderTree(root, depth = 3, cap = 3000, skip) {
  const out = [];
  async function walk(abs, rel, d) {
    if (d > depth || out.length >= cap) return;
    let ents;
    try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch (e) { return; }
    if (rel) out.push({ path: rel, n: ents.filter(x => x.isFile() && !excluded(nfc(x.name), false)).length });
    for (const x of ents) {
      const r = join(rel, nfc(x.name));
      if (x.isDirectory() && !x.isSymbolicLink() && !excluded(nfc(x.name), true) && !(skip && skip.has(r.toLowerCase()))) await walk(path.join(abs, x.name), r, d + 1);
    }
  }
  await walk(root, "", 0);
  return out.slice(0, cap);
}

/* 연결 폴더 안 경로만 — 상위 이동 · 절대 경로 · 링크(중간 폴더 포함) 거절 */
export function relOk(rel) {
  const s = String(rel || "");
  if (!s || s.length > 300 || s.startsWith("/") || /[\u0000-\u001f\u007f\\:]/.test(s)) return false;
  return s.split("/").every(x => x && x !== "." && x !== "..");
}
export async function safeAbs(root, rel) {
  if (!relOk(rel)) throw Object.assign(new Error("path"), { code: "path" });
  const segs = rel.split("/");
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    cur = path.join(cur, segs[i]);
    try {
      const st = await fsp.lstat(cur);
      if (st.isSymbolicLink()) throw Object.assign(new Error("link"), { code: "path" });
    } catch (e) { if (e.code === "path") throw e; break; }   // 없는 곳부터는 새로 만든다
  }
  const abs = path.join(root, ...segs);
  if (!abs.startsWith(root + path.sep)) throw Object.assign(new Error("path"), { code: "path" });
  return abs;
}
const exists = async (p) => { try { await fsp.lstat(p); return true; } catch (e) { return false; } };
/* 덮어쓰지 않고 옮기기 — rename 은 같은 이름이 있으면 말없이 덮는다. 이름을 먼저 O_EXCL 로 차지하고(이미 있으면 실패) 그 빈 자리 위로 옮긴다:
   확인한 뒤 옮기기 전에 누가 같은 이름을 만들어도 그 파일은 덮지 않고 'changed'(다음 실행이 다시 판단).
   옮기기가 실패하면 방금 만든 빈 자리만 치운다 — 같은 파일(장치 · 파일 번호가 만든 때와 같음)이고 크기 0 일 때만.
   SMB 는 옮기기를 끝내고도 오류(시간 초과 · 다시 연결)를 돌려줄 수 있어, 그 자리에 와 있는 것이 옮겨진 사용자 파일(크기 0 이어도)일 수 있다 */
const changedErr = () => Object.assign(new Error("changed"), { code: "changed" });
export async function moveNew(src, dst) {
  let fh;
  try { fh = await fsp.open(dst, "wx", 0o600); } catch (e) { throw e.code === "EEXIST" ? changedErr() : e; }
  let mine;
  try { mine = await fh.stat(); } finally { await fh.close(); }
  try { await fsp.rename(src, dst); }
  catch (e) {
    try {
      const s = await fsp.lstat(dst);
      if (s.isFile() && s.size === 0 && s.ino === mine.ino && s.dev === mine.dev) await fsp.unlink(dst);
    } catch (x) { /* 이미 없음 */ }
    throw e;
  }
}
/* 같은 이름이 있으면 '이름 (2).확장자' — 계획(freePath)이 고르는 새 이름과 같은 꼴 */
export async function uniquePath(abs) {
  if (!(await exists(abs))) return abs;
  const dir = path.dirname(abs), b = path.basename(abs), e = extOf(b), st = e ? b.slice(0, -e.length) : b;
  for (let i = 2; i < 1000; i++) { const p = path.join(dir, st + " (" + i + ")" + e); if (!(await exists(p))) return p; }
  throw Object.assign(new Error("name"), { code: "name" });
}
/* 있는 폴더 단계가 모두 진짜 폴더인지(링크면 연결 폴더 밖으로 옮기거나 지우게 된다). 없는 단계부터는 새로 만든다 */
async function noLink(root, segs) {
  let cur = root;
  for (const s of segs) {
    cur = path.join(cur, s);
    let st;
    try { st = await fsp.lstat(cur); } catch (e) { if (e.code === "ENOENT") return; throw e; }
    if (!st.isDirectory()) throw Object.assign(new Error("link"), { code: "path" });
  }
}
/* 옛 파일 옮기기 — 이전 판: <연결>/_H드라이브_이전판/<경로>/<이름> (YYYY-MM-DD HHmmss).<확장자> · 휴지통: <연결>/_H드라이브_휴지통/YYYY-MM-DD/<경로> */
export async function moveAside(root, abs, rel, kind, now) {
  const to = kind === "trash"
    ? path.join(root, TRASH, kstDay(now), ...rel.split("/"))
    : path.join(root, PREV, ...dirOf(rel).split("/").filter(Boolean), stemOf(rel) + " (" + stampKst(now) + ")" + extOf(rel));
  await noLink(root, path.relative(root, path.dirname(to)).split(path.sep));
  await fsp.mkdir(path.dirname(to), { recursive: true });
  const dst = await uniquePath(to);
  await moveNew(abs, dst);
  return dst;
}
/* 충돌 사본 자리 — '이름 (충돌 날짜).확장자', 있으면 '이름 (충돌 날짜 2).확장자' …(색인 제외 규칙 · SQL 과 같은 꼴) */
export async function conflictPath(root, rel, today) {
  for (let n = 1; n < 1000; n++) { const abs = await safeAbs(root, conflictName(rel, today, n)); if (!(await exists(abs))) return abs; }
  throw Object.assign(new Error("name"), { code: "name" });
}
export const relOf = (root, abs) => nfc(path.relative(root, abs).split(path.sep).join("/"));
/* 받아 확인한 임시 파일을 놓는다. 옮겨 둘 수 있는 K 쪽 것은 추적 중인 파일뿐 — backup(덮어쓸 옛 파일 → 이전판) · conf(H 가 이긴 충돌 → 충돌 사본 이름).
   옮기기 전에 색인 때 크기 · 수정 시각과 같은지 본다(그 사이 바뀌었으면 'changed' — 다음 실행에서 충돌로 판단).
   그 밖에 같은 이름(맥 SMB 는 대소문자를 가리지 않음)의 파일 · 폴더가 있으면 옮기지 않고 새 이름으로. copy = 충돌 사본 이름의 바탕.
   conf.to = 미리 정한 충돌 사본 자리(그 이름으로 H 이전 판을 이미 등록함) — 그 사이 다른 파일이 차지했으면 덮지 않고 'changed'.
   옮기는 곳은 모두 moveNew — 확인과 옮기기 사이에 생긴 같은 이름의 파일도 덮지 않는다 */
export async function place(root, tmp, rel, o = {}) {
  const changed = changedErr;
  const same = async (f) => {
    let st;
    try { st = await fsp.lstat(f.abs); } catch (e) { if (e.code === "ENOENT") return false; throw e; }
    if (!st.isFile() || !f.k || st.size !== f.k.size || Math.floor(st.mtimeMs) !== f.k.mtime) throw changed();
    return true;
  };
  if (o.conf && !(await same(o.conf))) throw changed();
  const backup = o.backup ? await same(o.backup) : false;
  let confAbs = "";
  try {
    if (o.conf) {
      const to = o.conf.to || await conflictPath(root, o.conf.rel, o.today);
      await moveNew(o.conf.abs, to);
      confAbs = to;
    }
    if (backup) await moveAside(root, o.backup.abs, o.backup.rel, "prev", o.now || Date.now());
    let abs = o.copy ? await conflictPath(root, o.copy, o.today) : await safeAbs(root, rel);
    if (!o.copy && (await exists(abs))) abs = await uniquePath(abs);
    await moveNew(tmp, abs);
    return { rel: relOf(root, abs), abs, conf: confAbs ? relOf(root, confAbs) : "" };
  } catch (e) {
    // 원래 이름에 그 사이 다른 파일이 생겼으면 덮지 않고 충돌 사본 이름으로 둔다
    if (confAbs) { try { await moveNew(confAbs, o.conf.abs); } catch (x) { /* 충돌 사본 이름으로 남음 */ } }
    throw e;
  }
}
/* 내려받기 — 같은 폴더 임시 파일(숨김 이름)에 받고 sha256 · 크기 확인. 새 파일로만 만든다(wx — 같은 이름이 있으면 덮지 않고 실패) */
export async function download(fetchFn, url, dirAbs, expectSha, expectSize) {
  await fsp.mkdir(dirAbs, { recursive: true });
  const tmp = path.join(dirAbs, ".ksync-" + crypto.randomBytes(6).toString("hex") + ".part");
  const r = await fetchFn(url);
  if (!r.ok) throw Object.assign(new Error("download"), { code: "download" });
  const buf = Buffer.from(await r.arrayBuffer());
  if (sha256Buf(buf) !== expectSha || (expectSize != null && buf.length !== Number(expectSize))) throw Object.assign(new Error("hash"), { code: "hash" });
  await fsp.writeFile(tmp, buf, { mode: 0o644, flag: "wx" });
  return { tmp, size: buf.length };
}
export const kBlocked = (name) => K_BLOCK.test(String(name || ""));

/* 서버 — 짧은 오류 코드만 온다. 게이트웨이 오류(JSON 아님 · 5xx)는 'server' — 서버가 처리했는지 모르므로 부른 쪽이 실행을 멈춘다.
   분당 상한: 서버는 Edge 안의 SQL 호출을 분마다 센다(확인 verify 는 두 번, 나머지는 한 번). 1분 동안 PACE 까지만 보내고(상한의 80%),
   그래도 rate 가 오면 1분 쉬고 한 번만 다시 — 정상 동기화가 보안 기록(rate)을 쌓지 않게 */
export const PACE = 240;
export function makeClient(fetchFn, server, key, sleep, now = Date.now) {
  const win = [];      // [보낸 시각, 서버 호출 수]
  async function pace(w) {
    const t = now();
    while (win.length && win[0][0] <= t - 60e3) win.shift();
    let used = win.reduce((s, x) => s + x[1], 0), i = 0, until = t;
    while (used + w > PACE && i < win.length) { used -= win[i][1]; until = win[i][0] + 60e3; i++; }
    if (i) { await sleep(Math.max(0, until - t)); win.splice(0, i); }
    win.push([now(), w]);
  }
  async function call(act, body) {
    const w = act === "put" && body && body.phase === "verify" ? 2 : 1;
    for (let i = 0; ; i++) {
      await pace(w);
      let r;
      try {
        r = await fetchFn(server, { method: "POST", headers: { "content-type": "application/json", "x-ksync-key": key }, body: JSON.stringify(Object.assign({ act }, body || {})) });
      } catch (e) { throw Object.assign(new Error("network"), { code: "network" }); }
      let d = null;
      try { d = await r.json(); } catch (e) { d = null; }
      if (d && d.ok) return d;
      const code = (d && d.error) || (!d || r.status >= 500 ? "server" : "http" + r.status);
      if (code === "rate" && i < 1) { await sleep(61000); continue; }
      throw Object.assign(new Error(code), { code });
    }
  }
  return { call };
}

function run(cmd, args, ms) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: ms || 30000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ""), err: String(stderr || ""), code: err && err.code }));
  });
}
/* 키는 키체인에만(서비스 hdrive-ksync) */
export async function keychainKey() {
  const r = await run("/usr/bin/security", ["find-generic-password", "-s", "hdrive-ksync", "-w"], 10000);
  const k = r.out.trim();
  return /^[0-9a-f]{64}$/.test(k) ? k : "";
}
/* SMB 마운트 지점 — `mount` 의 //사용자@서버/공유 on /Volumes/… (smbfs …) */
export async function findMount(smb) {
  const r = await run("/sbin/mount", [], 10000);
  for (const ln of r.out.split("\n")) {
    const m = /^\/\/(?:[^@]*@)?([^/\s]+)\/(.+?) on (.+?) \((smbfs)[,)]/.exec(ln);
    if (!m) continue;
    let share = m[2];
    try { share = decodeURIComponent(share); } catch (e) { /* 그대로 */ }
    if (m[1].toLowerCase() === smb.host.toLowerCase() && nfc(share).toLowerCase() === nfc(smb.share).toLowerCase()) return m[3];
  }
  return "";
}
export async function ensureMount(smb, log) {
  let mp = await findMount(smb);
  if (!mp) {
    log("info", "K드라이브 연결(마운트)");
    await run("/usr/bin/osascript", ["-e", 'mount volume "' + mountUrl(smb) + '"'], 60000);
    for (let i = 0; i < 15 && !mp; i++) { mp = await findMount(smb); if (!mp) await new Promise(r => setTimeout(r, 1000)); }
  }
  if (!mp) throw Object.assign(new Error("mount"), { code: "mount" });
  return path.join(mp, ...smb.sub);
}
export async function notify(msg) {
  await run("/usr/bin/osascript", ["-e", 'display notification "' + String(msg).replace(/["\\]/g, "") + '" with title "H:drive K드라이브 동기화"'], 10000);
}
export function makeLog(file) {
  return (level, msg) => {
    const ln = new Date().toISOString().replace("T", " ").slice(0, 19) + " [" + level + "] " + String(msg).replace(/[\r\n]+/g, " ") + "\n";
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, ln, { mode: 0o600 }); } catch (e) { /* 기록 실패는 무시 */ }
  };
}
export async function pruneLog(file, now, days = 30) {
  let s;
  try { s = await fsp.readFile(file, "utf8"); } catch (e) { return; }
  const cut = new Date(now - days * 864e5).toISOString().slice(0, 10);
  const keep = s.split("\n").filter(l => l && l.slice(0, 10) >= cut);
  await fsp.writeFile(file, keep.join("\n") + (keep.length ? "\n" : ""), { mode: 0o600 });
}
/* 기록된 PID 가 정말 이 에이전트(같은 프로그램)인지 — 실행 중 꺼진 뒤 다시 켜면 그 PID 를 다른 프로그램이 쓴다 */
export async function agentPid(pid) {
  const r = await run("/bin/ps", ["-p", String(pid), "-o", "command="], 5000);
  return r.out.includes(path.basename(process.argv[1] || "ksync.mjs"));
}
/* 동시 실행 막기 — 살아 있는 다른 실행이 12시간 안에 잡았으면 양보(큰 첫 동기화는 몇 시간 걸린다).
   풀 때는 내 잠금일 때만 지운다(너무 오래 걸려 다른 실행이 가져간 잠금을 지우지 않게) */
export async function lock(file, now, isAgent = agentPid) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const me = { pid: process.pid, at: now };
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeSync(fd, JSON.stringify(me));
      fs.closeSync(fd);
      return () => {
        try { const cur = JSON.parse(fs.readFileSync(file, "utf8")); if (cur.pid === me.pid && cur.at === me.at) fs.unlinkSync(file); } catch (e) { /* 이미 없음 */ }
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const cur = await readJson(file, {});
      let alive = false;
      try { if (cur.pid) { process.kill(cur.pid, 0); alive = true; } } catch (x) { alive = false; }
      if (alive) alive = await isAgent(cur.pid);
      if (alive && now - Number(cur.at || 0) < 12 * 3600e3) return null;
      try { fs.unlinkSync(file); } catch (x) { /* 경쟁 */ }
    }
  }
  return null;
}
