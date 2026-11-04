/* H:drive K드라이브 동기화 — 에이전트 도우미(파일 · 색인 · 해시 · 서버 · 마운트 · 알림). npm 의존성 없음(Node ≥ 20). */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import { execFile } from "node:child_process";
import { excluded, nfc, MAX_SIZE, TRASH, PREV, dirOf, stemOf, extOf, join, K_BLOCK } from "./plan.mjs";

export const KST = 9 * 3600e3;
export const kstDay = (t) => new Date(t + KST).toISOString().slice(0, 10);
export const kstMin = (t) => { const d = new Date(t + KST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const hhmm = (s) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const isoMs = (ms) => new Date(Math.floor(ms)).toISOString();
const pad = (n) => String(n).padStart(2, "0");
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

export async function sha256File(abs) {
  const h = crypto.createHash("sha256");
  await new Promise((res, rej) => { fs.createReadStream(abs).on("data", (d) => h.update(d)).on("end", res).on("error", rej); });
  return h.digest("hex");
}
export const sha256Buf = (b) => crypto.createHash("sha256").update(b).digest("hex");

/* 연결 폴더 색인 — 링크는 따라가지 않는다. 크기 · 수정 시각이 기준선과 같으면 해시를 다시 재지 않는다 */
export async function indexDir(root, baseByRel, opts = {}) {
  const max = opts.maxFiles || 20000;
  const list = [], errors = [];
  async function walk(abs, rel, depth) {
    if (depth > 30) return;
    let ents;
    try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch (e) { errors.push({ f: rel || ".", r: e.code || "read" }); return; }
    for (const d of ents) {
      const name = nfc(d.name);
      if (d.isSymbolicLink()) continue;
      const a = path.join(abs, d.name), r = join(rel, name);
      if (d.isDirectory()) { if (!excluded(name, true)) await walk(a, r, depth + 1); continue; }
      if (!d.isFile() || excluded(name, false)) continue;
      if (list.length >= max) { errors.push({ f: r, r: "too_many" }); return; }
      let st;
      try { st = await fsp.lstat(a); } catch (e) { errors.push({ f: r, r: e.code || "stat" }); continue; }
      const mtime = Math.floor(st.mtimeMs), b = baseByRel && baseByRel.get(r);
      let sha = null;
      if (st.size <= MAX_SIZE) {
        if (b && b.k_sha256 && Number(b.k_size) === st.size && Date.parse(b.k_mtime) === mtime) sha = b.k_sha256;
        else { try { sha = await sha256File(a); } catch (e) { errors.push({ f: r, r: e.code || "read" }); continue; } }
      }
      list.push({ rel: r, abs: a, size: st.size, mtime, sha });
    }
  }
  await walk(root, "", 0);
  return { list, errors };
}

/* 폴더 목록(3단계 · 이름과 바로 아래 파일 수만) */
export async function folderTree(root, depth = 3, cap = 3000) {
  const out = [];
  async function walk(abs, rel, d) {
    if (d > depth || out.length >= cap) return;
    let ents;
    try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch (e) { return; }
    if (rel) out.push({ path: rel, n: ents.filter(x => x.isFile() && !excluded(nfc(x.name), false)).length });
    for (const x of ents) if (x.isDirectory() && !x.isSymbolicLink() && !excluded(nfc(x.name), true)) await walk(path.join(abs, x.name), join(rel, nfc(x.name)), d + 1);
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
export async function uniquePath(abs) {
  if (!(await exists(abs))) return abs;
  const dir = path.dirname(abs), b = path.basename(abs), e = extOf(b), st = e ? b.slice(0, -e.length) : b;
  for (let i = 2; i < 1000; i++) { const p = path.join(dir, st + " " + i + e); if (!(await exists(p))) return p; }
  throw Object.assign(new Error("name"), { code: "name" });
}
/* 옛 파일 옮기기 — 이전 판: <연결>/_H드라이브_이전판/<경로>/<이름> (YYYY-MM-DD HHmmss).<확장자> · 휴지통: <연결>/_H드라이브_휴지통/YYYY-MM-DD/<경로> */
export async function moveAside(root, abs, rel, kind, now) {
  const to = kind === "trash"
    ? path.join(root, TRASH, kstDay(now), ...rel.split("/"))
    : path.join(root, PREV, ...dirOf(rel).split("/").filter(Boolean), stemOf(rel) + " (" + stampKst(now) + ")" + extOf(rel));
  await fsp.mkdir(path.dirname(to), { recursive: true });
  const dst = await uniquePath(to);
  await fsp.rename(abs, dst);
  return dst;
}
/* 휴지통 30일 지난 날짜 폴더 정리 */
export async function cleanTrash(root, now, days = 30) {
  const base = path.join(root, TRASH);
  let n = 0;
  let ents = [];
  try { ents = await fsp.readdir(base, { withFileTypes: true }); } catch (e) { return 0; }
  const cut = kstDay(now - days * 864e5);
  for (const d of ents) if (d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name) && d.name < cut) { await fsp.rm(path.join(base, d.name), { recursive: true, force: true }); n++; }
  return n;
}
/* 내려받기 — 같은 폴더 임시 파일(숨김 이름)에 받고 sha256 · 크기 확인 */
export async function download(fetchFn, url, dirAbs, expectSha, expectSize) {
  await fsp.mkdir(dirAbs, { recursive: true });
  const tmp = path.join(dirAbs, ".ksync-" + crypto.randomBytes(6).toString("hex") + ".part");
  const r = await fetchFn(url);
  if (!r.ok) throw Object.assign(new Error("download"), { code: "download" });
  const buf = Buffer.from(await r.arrayBuffer());
  if (sha256Buf(buf) !== expectSha || (expectSize != null && buf.length !== Number(expectSize))) throw Object.assign(new Error("hash"), { code: "hash" });
  await fsp.writeFile(tmp, buf, { mode: 0o644 });
  return { tmp, size: buf.length };
}
export const kBlocked = (name) => K_BLOCK.test(String(name || ""));

/* 서버 — 짧은 오류 코드만 온다. 분당 상한(rate)은 1분 쉬고 다시(두 번까지) */
export function makeClient(fetchFn, server, key, sleep) {
  async function call(act, body) {
    for (let i = 0; ; i++) {
      let r;
      try {
        r = await fetchFn(server, { method: "POST", headers: { "content-type": "application/json", "x-ksync-key": key }, body: JSON.stringify(Object.assign({ act }, body || {})) });
      } catch (e) { throw Object.assign(new Error("network"), { code: "network" }); }
      let d = null;
      try { d = await r.json(); } catch (e) { d = null; }
      if (d && d.ok) return d;
      const code = (d && d.error) || "http" + r.status;
      if (code === "rate" && i < 2) { await sleep(61000); continue; }
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
    await run("/usr/bin/osascript", ["-e", 'mount volume "smb://' + smb.host + "/" + smb.share.replace(/["\\]/g, "") + '"'], 60000);
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
/* 동시 실행 막기 — 살아 있는 다른 실행이 3시간 안에 잡았으면 양보 */
export async function lock(file, now) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now }));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(file); } catch (e) { /* 이미 없음 */ } };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const cur = await readJson(file, {});
      let alive = false;
      try { if (cur.pid) { process.kill(cur.pid, 0); alive = true; } } catch (x) { alive = false; }
      if (alive && now - Number(cur.at || 0) < 3 * 3600e3) return null;
      try { fs.unlinkSync(file); } catch (x) { /* 경쟁 */ }
    }
  }
  return null;
}
