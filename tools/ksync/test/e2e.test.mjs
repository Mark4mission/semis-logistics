// K드라이브 동기화 E2E — 에이전트(ksync.mjs) → 실제 HTTP(node:http, 127.0.0.1) → 실제 Edge 코드(semis-logi-ksync.ts, Node 형식 제거 + Deno 흉내) → 실제 SQL(PGlite) · 저장소 흉내.
// 에이전트는 진짜 Node fetch 로만 부른다: Edge 처리기를 직접 부르면 Node fetch 가 실제로 붙이는 헤더(sec-fetch-mode 등) · 본문 흐름을 놓친다.
// 서명 URL 올리기(PUT) · 내려받기(GET)도 같은 로컬 서버가 받는다. Edge 자신의 RPC · 저장소 호출만 globalThis.fetch 를 바꿔 끼워 PGlite · 메모리로 보낸다.
// K드라이브 = 임시 폴더. 실행: npm i --no-save @electric-sql/pglite && node tools/ksync/test/e2e.test.mjs   (Node ≥ 22.18 — .ts 형식 제거)
//   PGlite 를 다른 곳에 설치했으면 PGLITE_DIR=<…/node_modules/@electric-sql/pglite> 로 지정
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const realFetch = globalThis.fetch;     // 에이전트가 쓸 진짜 fetch — 아래에서 Edge 용으로 globalThis.fetch 를 바꾸기 전에 잡아 둔다
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const PGL = process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, "dist/index.js")).href : "@electric-sql/pglite";
const PGC = process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, "dist/contrib/pgcrypto.js")).href : "@electric-sql/pglite/contrib/pgcrypto";
const { PGlite } = await import(PGL);
const { pgcrypto } = await import(PGC);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b));
const NOROOT = !(process.getuid && process.getuid() === 0);     // root 는 chmod 000 도 읽는다 — 읽기 실패 시험은 건너뜀
// 에이전트 시계는 시험 시작 시각에 묶는다 — 실행마다 날짜를 다시 재면 자정(KST)을 넘는 실행의 충돌 사본 이름이 TODAY 와 어긋난다
const NOW = Date.now();
const TODAY = new Date(NOW + 9 * 3600e3).toISOString().slice(0, 10);

/* ── DB ── */
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema semis_logi_private;
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N', t.role, case t.role when 'admin' then 4 else 1 end, t.kind, null from semis_logi_private.test_ctx t $$;
  create table public.semis_logi_store (key text primary key, value jsonb, updated_at timestamptz default now(), updated_by text);
  create function semis_logi_private.stamp() returns trigger language plpgsql as $$
  begin new.updated_at := clock_timestamp(); new.updated_by := 'anon/' || regexp_replace(coalesce(new.updated_by, ''), '^.*/', ''); return new; end $$;
  create trigger semis_logi_store_a_stamp before insert or update on public.semis_logi_store for each row execute function semis_logi_private.stamp();
  -- 공용 행 docs 저장 횟수(등록 한 번 = 저장 한 번인지 센다)
  create table public.test_saves (n int not null);
  insert into public.test_saves values (0);
  create function public.test_count() returns trigger language plpgsql as $$ begin if new.key = 'docs' then update public.test_saves set n = n + 1; end if; return null; end $$;
  create trigger test_count after update on public.semis_logi_store for each row execute function public.test_count();
`);
await db.exec(fs.readFileSync(path.join(REPO, "tools/sql/semis-logi-conflict.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(REPO, "tools/sql/semis-logi-ksync.sql"), "utf8"));
// 분당 상한은 Edge 시험이 본다 — 이 시험은 수십 번의 실행을 몇 초 안에 이어 하므로 넉넉히
await db.exec(`update semis_logi_private.ksync_state set limits = limits || '{"perMin": 100000}'::jsonb`);
const one = async (q, p) => { const r = await db.query(q, p || []); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; };
const admin = async (q, p) => { await db.exec("insert into semis_logi_private.test_ctx values ('a1', 'admin', 'user')"); try { return await one(q, p); } finally { await db.exec("delete from semis_logi_private.test_ctx"); } };
const docs = async () => (await one("select value from public.semis_logi_store where key = 'docs'")) || [];
const setDocs = (v) => db.query("update public.semis_logi_store set value = $1::jsonb where key = 'docs'", [JSON.stringify(v)]);
const docsAt = async () => String(await one("select updated_at from public.semis_logi_store where key = 'docs'"));
const saves = () => one("select n from public.test_saves");
const rowsOf = async (m) => (await db.query("select * from semis_logi_private.ksync_files where map_id = $1 order by rel_path", [m])).rows;
const rowById = async (id) => (await db.query("select * from semis_logi_private.ksync_files where id = $1", [id])).rows[0];
const holdOf = (m) => one("select hold from semis_logi_private.ksync_maps where id = $1", [m]);
const events = (k) => one("select count(*)::int from semis_logi_private.ksync_events where kind = $1", [k]);
const lastRun = () => one("select to_jsonb(r) from semis_logi_private.ksync_runs r where result is distinct from 'offline' order by id desc limit 1");

/* ── 로컬 HTTP 서버 — Edge 함수 경로 · 서명 URL 올리기 · 내려받기 ── */
const FN = "/functions/v1/semis-logi-ksync";
const UP_RE = /^\/storage\/v1\/object\/upload\/sign\/semis-logi-files\/(.+)$/, DN_RE = /^\/storage\/v1\/object\/sign\/semis-logi-files\/(.+)$/;
const objects = new Map(), deleted = [], upTok = new Map(), dnTok = new Map();
const httpLog = [], rpcLog = [];
const hook = { tamperUp: null, tamperDn: null, failDn: null, failRpc: null, onRpc: null };
let IP = "198.51.100.5", edge = null;
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "host", "upgrade"]);
const collect = async (req) => { const parts = []; for await (const c of req) parts.push(c); return Buffer.concat(parts); };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const reply = (status, body, rec) => { httpLog.push(Object.assign({ m: req.method, status }, rec)); res.writeHead(status, { "content-type": "application/json" }); res.end(body); };
  try {
    if (u.pathname === FN) {
      // 게이트웨이처럼 접속 IP 를 붙이고, 본문은 흘려서(stream) 넘긴다 — Edge 가 읽는 중에 2MB 상한을 본다
      const h = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && v != null) h.set(k, Array.isArray(v) ? v.join(", ") : v);
      h.set("cf-connecting-ip", IP);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
      const r = await edge(new Request("http://127.0.0.1" + req.url, { method: req.method, headers: h, body, duplex: "half" }));
      const buf = Buffer.from(await r.arrayBuffer());
      let err = "";
      try { err = JSON.parse(buf.toString("utf8")).error || ""; } catch (e) { err = "?"; }
      httpLog.push({ m: req.method, p: "fn", mode: h.get("sec-fetch-mode") || "", status: r.status, err });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(buf);
    }
    let m = UP_RE.exec(u.pathname);
    if (m && req.method === "PUT") {
      const p = decodeURIComponent(m[1]), t = u.searchParams.get("token");
      const buf = await collect(req);
      if (!t || upTok.get(t) !== p) return reply(400, '{"error":"token"}', { p: "up", path: p });
      upTok.delete(t);
      objects.set(p, hook.tamperUp && hook.tamperUp(p) ? Buffer.concat([buf, Buffer.from("!")]) : buf);
      return reply(200, JSON.stringify({ Key: "semis-logi-files/" + p }), { p: "up", path: p });
    }
    m = DN_RE.exec(u.pathname);
    if (m && req.method === "GET") {
      const p = decodeURIComponent(m[1]), t = u.searchParams.get("token");
      if (!t || dnTok.get(t) !== p) return reply(400, '{"error":"token"}', { p: "dn", path: p });
      if (hook.failDn && hook.failDn(p)) return reply(500, '{"error":"down"}', { p: "dn", path: p });
      const o = objects.get(p);
      if (!o) return reply(404, '{"error":"none"}', { p: "dn", path: p });
      httpLog.push({ m: "GET", p: "dn", path: p, status: 200 });
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(hook.tamperDn && hook.tamperDn(p) ? Buffer.concat([o, Buffer.from("!")]) : o);
    }
    reply(404, "{}", { p: u.pathname });
  } catch (e) { console.log("서버 오류", e); reply(500, "{}", { p: "error" }); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + server.address().port;

/* ── Edge(실제 코드) — 자기 RPC · 저장소 호출만 여기서 받는다 ── */
const ENV = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "svc" };
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { edge = h; } };
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200 });
const tok = () => crypto.randomBytes(8).toString("hex");
globalThis.fetch = async (input, init) => {
  init = init || {};
  const url = String(input instanceof Request ? input.url : input);
  // 서명 URL · 함수 경로는 에이전트가 진짜 HTTP 로만 부른다 — 여기로 오면 에이전트가 바꿔 끼운 fetch 를 쓴 것
  if (url.includes("?token=") || url.includes(FN) || !url.startsWith(BASE + "/")) throw new Error("Edge 밖 호출 " + url);
  const method = (init.method || "GET").toUpperCase();
  if (new Headers(init.headers || {}).get("apikey") !== "svc") return json({}, 401);
  const p = url.slice(BASE.length);
  if (p === "/rest/v1/rpc/semis_logi_ksync_agent") {
    const b = JSON.parse(init.body);
    if (hook.onRpc) await hook.onRpc(b.p_act, b.p);
    if (hook.failRpc && hook.failRpc(b.p_act, b.p)) { rpcLog.push({ act: b.p_act, p: b.p, res: null }); return json({ message: "down" }, 500); }
    const r = await one("select public.semis_logi_ksync_agent($1, $2, $3, $4::jsonb)", [b.p_act, b.p_key_hash, b.p_ip, JSON.stringify(b.p)]);
    rpcLog.push({ act: b.p_act, p: b.p, res: r });
    return json(r);
  }
  let m = /^\/storage\/v1\/object\/upload\/sign\/semis-logi-files\/(.+)$/.exec(p);
  if (m && method === "POST") { const t = tok(); upTok.set(t, decodeURIComponent(m[1])); return json({ url: "/object/upload/sign/semis-logi-files/" + m[1] + "?token=" + t }); }
  m = /^\/storage\/v1\/object\/sign\/semis-logi-files\/(.+)$/.exec(p);
  if (m && method === "POST") { const t = tok(); dnTok.set(t, decodeURIComponent(m[1])); return json({ signedURL: "/object/sign/semis-logi-files/" + m[1] + "?token=" + t }); }
  m = /^\/storage\/v1\/object\/semis-logi-files\/(.+)$/.exec(p);
  if (m && method === "GET") { const o = objects.get(decodeURIComponent(m[1])); return o ? new Response(o) : new Response("no", { status: 404 }); }
  if (p === "/storage/v1/object/semis-logi-files" && method === "DELETE") { JSON.parse(init.body).prefixes.forEach((x) => { deleted.push(x); objects.delete(x); }); return json([]); }
  return json({}, 404);
};
// 저장소 package.json 이 commonjs 라 .mts 사본으로 읽는다(내용은 같음)
const EDGE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ksync-edge-"));
fs.copyFileSync(path.join(REPO, "tools/edge/semis-logi-ksync.ts"), path.join(EDGE_TMP, "edge.mts"));
await import(pathToFileURL(path.join(EDGE_TMP, "edge.mts")).href);
fs.rmSync(EDGE_TMP, { recursive: true, force: true });
ok(typeof edge === "function", "Edge 처리기");
// H 쪽 문서 주소(문서함 표준 주소 꼴 — 저장소 경로만 본다). 동기화가 등록한 문서는 Edge 가 정한 앞부분을 쓴다
const PUB = "https://files.example/storage/v1/object/public/semis-logi-files/";
const pathOf = (u) => String(u || "").replace(/^https:\/\/[^/]+\/storage\/v1\/object\/public\/semis-logi-files\//, "");
const putObj = (p, data) => { const b = Buffer.from(data); objects.set(p, b); return b; };
const objText = (u) => { const o = objects.get(pathOf(u)); return o ? o.toString() : null; };

/* ── 에이전트 ── */
const { runAgent } = await import(pathToFileURL(path.join(REPO, "tools/ksync/ksync.mjs")).href);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ksync-e2e-"));
const MOUNT = path.join(TMP, "share");
const APP = path.join(TMP, "app");
const STATE = path.join(APP, "state.json");
fs.mkdirSync(MOUNT, { recursive: true });
let online = true, KEY = "";
const notes = [], logs = [], outs = [];
const deps = () => ({
  paths: { app: APP, config: path.join(APP, "config.json"), state: STATE, lock: path.join(APP, "ksync.lock"), log: path.join(APP, "ksync.log") },
  config: { server: BASE + FN, smbUrl: "smb://nas.example/share" }, allowHttp: true,
  log: (lv, m) => logs.push(lv + " " + m), out: (o) => outs.push(o), now: () => NOW, fetch: realFetch, sleep: async () => {},
  key: async () => KEY, netCheck: async () => (online ? { ok: true } : { ok: false, msg: "ECONNREFUSED" }), mountRoot: async () => MOUNT,
  notify: async (m) => notes.push(m), host: "test-mac"
});
const once = (a) => runAgent(deps(), Object.assign({ once: true }, a || {}));
const K = (rel) => path.join(MOUNT, "업무", "점검표", ...rel.split("/"));
const write = (rel, data, mtime) => { fs.mkdirSync(path.dirname(K(rel)), { recursive: true }); fs.writeFileSync(K(rel), data); if (mtime) fs.utimesSync(K(rel), mtime / 1000, mtime / 1000); };
const read = (rel) => fs.readFileSync(K(rel), "utf8");
const has = (rel) => fs.existsSync(K(rel));
const kFiles = (sub) => { const out = []; const w = (d, r) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const rr = r ? r + "/" + e.name : e.name; if (e.isDirectory()) w(path.join(d, e.name), rr); else out.push(rr.normalize("NFC")); } }; w(path.join(MOUNT, "업무", "점검표", sub || ""), sub || ""); return out.sort(); };
const since = (log, n, f) => log.slice(n).filter(f);
const endOf = (n) => rpcLog.slice(n).filter(x => x.act === "run" && x.p.phase === "end").pop();

/* 1. 키 · 허용 IP 대기 · 미연결 — 실제 HTTP 로 Edge 에 붙는다(E1) */
KEY = (await admin("select public.semis_logi_ksync_agent_new('Mac')")).key;
let r = await once();
eq(r.status, "wait-ip", "허용 IP 없음 → 대기");
eq(await one("select ip_seen -> 0 ->> 'ip' from semis_logi_private.ksync_state"), IP, "후보 IP = 게이트웨이가 붙인 cf-connecting-ip");
const fn1 = httpLog.filter(x => x.p === "fn");
ok(fn1.some(x => x.mode && x.status === 200), "E1 Edge 가 sec-fetch-mode(Node fetch 가 늘 붙임)를 받고도 200 " + JSON.stringify(fn1));
const br = await realFetch(BASE + FN, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", "x-ksync-key": KEY }, body: JSON.stringify({ act: "hello" }) });
eq([br.status, (await br.json()).error, br.headers.get("access-control-allow-origin")], [403, "origin", null], "브라우저(Origin) 요청은 실제 HTTP 에서도 거절 · CORS 응답 없음");
await admin("select public.semis_logi_ksync_ip_approve($1)", [IP]);
online = false;
IP = "203.0.113.9";     // 사내망 밖 — '연결 안 됨' 보고(net)만은 허용 IP 밖에서도 받는다
r = await once();
eq([r.status, notes.length, await one("select net ->> 'ok' from semis_logi_private.ksync_state")], ["offline", 0, "false"], "--once · 사내망 아님 → 연결 안 됨 보고 · 기록만(알림 없음)");
// 매일 창(08:30~09:00) 안에서 깨어났는데 닿지 않음 — 5분 간격 3번(기다림은 주입) 뒤 그날은 건너뜀: 보고 · 알림 한 번
const W0840 = Date.parse(TODAY + "T08:40:00+09:00"), slept = [];
// 앞의 실제 시각 실행이 남긴 마지막 서버 확인(lastSeen = 지금)을 지운다 — 남겨 두면 주입한 08:50 깨우기가 '5분 안에 봤음'(recent)으로 끝나 시험 결과가 시험하는 시각에 따라 달라진다
{ const s0 = JSON.parse(fs.readFileSync(STATE, "utf8")); delete s0.lastSeen; fs.writeFileSync(STATE, JSON.stringify(s0)); }
r = await runAgent(Object.assign(deps(), { now: () => W0840, sleep: async (ms) => { slept.push(ms); } }), {});
eq([r.status, slept.filter(x => x === 300000).length, notes, JSON.parse(fs.readFileSync(STATE, "utf8")).skipDay],
  ["offline", 2, ["K드라이브에 연결하지 못해 오늘 동기화를 건너뜁니다. 내일 08:30~09:00 에 다시 시도합니다."], TODAY], "창 안 · 3번 다 안 됨 → 오늘 건너뜀 · 알림 한 번");
ok(/오늘 동기화 건너뜀/.test(await one("select net ->> 'msg' from semis_logi_private.ksync_state")), "건너뛴 날은 서버 '사내망' 표시에 남음(대시보드 다음 예정 = 내일)");
slept.length = 0;
const rn = rpcLog.length;
r = await runAgent(Object.assign(deps(), { now: () => W0840 + 10 * 60e3, sleep: async (ms) => { slept.push(ms); } }), {});
eq([r.status, notes.length, slept.filter(x => x === 300000).length, since(rpcLog, rn, x => x.act === "net").length], ["offline", 1, 0, 0], "같은 날 다시 깨어나도 다시 시도 · 보고 · 알림 없음");
eq(await one("select count(*)::int from semis_logi_private.ksync_runs where result = 'offline'"), 1, "연결 안 됨 보고(허용 IP 밖에서도 · 하루 한 줄)");
IP = "198.51.100.5";
eq(await one("select net ->> 'ok' from semis_logi_private.ksync_state"), "false", "대시보드 사내망: 연결 안 됨");
online = true;
r = await once();
eq(r.status, "ok", "연결되면 실행(연결 없음 · 할 일 없음)");
eq(await one("select net ->> 'ok' from semis_logi_private.ksync_state"), "true", "사내망 연결됨");

/* 2. 연결 · 미리보기 */
const T0 = Date.parse("2026-11-03T01:00:00Z");
write("a.xlsx", "A1", T0);
write("가나다.pdf".normalize("NFD"), "한글", T0);
write("sub/b.docx", "B1", T0);
write("~$a.xlsx", "lock"); write(".DS_Store", "x"); write("Thumbs.db", "x"); write("c.tmp", "x");
write("page.html", "<b>x</b>", T0);
write("same.pdf", "SAME", T0);
fs.mkdirSync(path.dirname(K("big.bin")), { recursive: true }); fs.writeFileSync(K("big.bin"), ""); fs.truncateSync(K("big.bin"), 50 * 1024 * 1024 + 1);
fs.symlinkSync("/etc", K("link-out"));
const outside = path.join(TMP, "outside.txt"); fs.writeFileSync(outside, "secret"); fs.symlinkSync(outside, K("link-file.txt"));
await db.query("insert into public.semis_logi_store(key, value) values ('docs', $1::jsonb)", [JSON.stringify([
  { id: "d1", mod: "audit", grp: "checklist", title: "H 점검", date: "2026-10-01", ser: "", org: "", note: "", ssi: false, mids: [], files: [{ name: "h1.pdf", size: 3, url: PUB + "docs/aaaaaaaaaaaa_h1.pdf" }], at: "2026-10-01T00:00:00.000Z", by: "가" },
  { id: "dx", mod: "audit", grp: "checklist", title: "도구", date: "2026-10-01", files: [{ name: "tool.exe", size: 3, url: PUB + "docs/bbbbbbbbbbbb_tool.exe" }] },
  { id: "ds", mod: "audit", grp: "checklist", title: "SSI", date: "2026-10-01", ssi: true, files: [{ name: "s.pdf", size: 3, url: PUB + "docs-ssi/cccccccccccc_s.pdf" }] },
  { id: "de", mod: "audit", grp: "checklist", title: "이상한 이름", date: "2026-10-01", files: [{ name: "../../evil.pdf", size: 3, url: PUB + "docs/eeeeeeeeeeee_evil.pdf" }] },
  { id: "dl", mod: "audit", grp: "checklist", title: "같은 파일", date: "2026-10-01", files: [{ name: "same.pdf", size: 4, url: PUB + "docs/llllllllllll_same.pdf" }] },
  { id: "do", mod: "partners", grp: "x", title: "다른 화면", date: "2026-10-01", files: [{ name: "o.pdf", size: 3, url: PUB + "docs/dddddddddddd_o.pdf" }] }])]);
putObj("docs/aaaaaaaaaaaa_h1.pdf", "H1!"); putObj("docs/bbbbbbbbbbbb_tool.exe", "MZ!"); putObj("docs/eeeeeeeeeeee_evil.pdf", "EV!"); putObj("docs/llllllllllll_same.pdf", "SAME");
const M = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "업무/점검표", mod: "audit", grp: "checklist" })])).id;
r = await once();
eq(r.status, "ok", "미리보기 실행");
const pv = await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [M]);
eq([pv.k2h, pv.h2k, pv.skip, pv.link], [3, 2, 3, 1], "미리보기 K→H 3 · H→K 2(h1 · 이상한 이름) · 건너뜀 3(50MB · html · exe) · 연결만 1(같은 이름 · 크기)");
eq((await docs()).length, 6, "미리보기는 실행 안 함");
ok(!has("h1.pdf"), "K 에도 안 씀");

/* 3. 시작 → 첫 동기화 — 올리기 · 내려받기 모두 실제 HTTP · 등록은 한 번(문서함 저장 한 번) */
await admin("select public.semis_logi_ksync_map_start($1)", [M]);
let h0 = httpLog.length, r0 = rpcLog.length, s0 = await saves();
r = await once();
eq(r.status, "ok", "첫 동기화 " + JSON.stringify(r));
let D = await docs();
const kd = D.filter(d => d.src === "ksync");
eq(kd.map(d => d.title).sort(), ["a", "b", "가나다"], "K→H 3건(한글 이름 NFC)");
ok(kd.every(d => d.mod === "audit" && d.grp === "checklist" && d.by === "K드라이브 동기화" && d.files.length === 1 && objects.has(pathOf(d.files[0].url))), "문서함 일반 문서 · 원본 저장소");
eq(kd.find(d => d.title === "가나다").files[0].name, "가나다.pdf", "파일 이름 NFC");
eq([since(httpLog, h0, x => x.p === "up" && x.status === 200).length, since(httpLog, h0, x => x.p === "dn" && x.status === 200).length], [3, 2], "서명 URL 올리기 3 · 내려받기 2(실제 HTTP)");
eq([since(rpcLog, r0, x => x.act === "put_apply").map(x => x.p.paths.length), await saves() - s0], [[3], 1], "새 파일 여러 개 → 등록 한 번 · 문서함 저장 한 번");
eq([read("h1.pdf"), has("tool.exe"), has("s.pdf"), has("o.pdf")], ["H1!", false, false, false], "H→K: 연결 문서만 · 실행 파일 · SSI · 다른 화면 제외");
eq(kFiles().filter(f => /evil/.test(f)), ["_.._.._evil.pdf"], "경로 탈출 이름은 연결 폴더 안 파일 이름으로");
ok(!fs.existsSync(path.join(MOUNT, "evil.pdf")) && !fs.existsSync(path.join(TMP, "evil.pdf")), "폴더 밖에 쓰지 않음");
ok(!D.some(d => d.files.some(f => /link|outside/.test(f.name))), "링크는 따라가지 않음");
eq(await events("type_block"), 1, "실행 파일 차단 기록");
let run = await lastRun();
eq([run.k2h, run.h2k, run.skipped], [3, 2, 3], "실행 기록 건수");
ok(run.detail.some(d => d.a === "skip" && d.r === "too_large") && run.detail.some(d => d.a === "skip" && d.r === "type"), "건너뜀 이유");
eq((await rowsOf(M)).length, 6, "기준선 6");
eq([(await rowsOf(M)).find(x => x.rel_path === "same.pdf").doc_id, D.filter(d => d.title === "same").length], ["dl", 0], "같은 이름 · 크기는 전송 없이 연결만(중복 없음)");
eq(await holdOf(M), null, "끝까지 맞춘 첫 실행 → 시작 승인 씀");

/* 4. 두 번째 실행 = 변경 0(멱등) */
const at1 = await docsAt();
const nObj = objects.size;
r = await once();
run = await lastRun();
eq([r.status, run.k2h, run.h2k, run.conflicts, run.errors], ["ok", 0, 0, 0, 0], "두 번째 실행 변경 0");
eq([await docsAt(), objects.size], [at1, nObj], "문서함 · 저장소 그대로");

/* 5. K 만 바뀜 → 같은 판 묶음 새 판 */
write("a.xlsx", "A2", Date.parse("2026-11-04T02:00:00Z"));
r = await once();
D = await docs();
const aSer = D.find(d => d.title === "a").ser;
const aVers = D.filter(d => d.ser === aSer);
eq([aVers.length, D[0].ser, D[0].date], [2, aSer, "2026-11-04"], "새 판(맨 앞 · K 수정 날짜)");
eq(objText(D[0].files[0].url), "A2", "새 판 내용");

/* 6. H 만 바뀜(새 판) → K 덮어쓰기 · 옛 파일은 이전판 폴더 */
putObj("docs/ffffffffffff_h1.pdf", "H1-v2");
D.unshift({ id: "d1v2", mod: "audit", grp: "checklist", title: "H 점검", date: "2026-11-02", ser: "d1", files: [{ name: "h1.pdf", size: 5, url: PUB + "docs/ffffffffffff_h1.pdf" }], at: "2026-11-02T00:00:00.000Z" });
D.find(d => d.id === "d1").ser = "d1";
await setDocs(D);
r = await once();
eq(read("h1.pdf"), "H1-v2", "K 덮어씀");
const prev = kFiles("_H드라이브_이전판");
eq(prev.length, 1, "이전판 폴더에 옛 파일");
ok(/^_H드라이브_이전판\/h1 \(\d{4}-\d{2}-\d{2} \d{6}\)\.pdf$/.test(prev[0]), "이전판 이름 " + prev[0]);
eq(fs.readFileSync(path.join(MOUNT, "업무", "점검표", prev[0]), "utf8"), "H1!", "옛 내용 보존");

/* 7. K 이름 바꿈 → 기준선만 · 제목이 옛 파일 이름이면 제목도 */
fs.renameSync(K("sub/b.docx"), K("sub/b2.docx"));
const nDocs = (await docs()).length;
r = await once();
D = await docs();
eq([D.length, D.filter(d => d.title === "b2").length, D.filter(d => d.title === "b").length], [nDocs, 1, 0], "새 문서 없이 제목만");
ok((await rowsOf(M)).some(x => x.rel_path === "sub/b2.docx") && !(await rowsOf(M)).some(x => x.rel_path === "sub/b.docx"), "기준선 경로");
run = await lastRun();
eq([run.k2h, run.h2k], [0, 0], "전송 없음");

/* 8. 양쪽 다 바뀜 — K 가 늦음: H 새 판 + K 에 H 쪽 내용 '(충돌 날짜)' 사본 */
putObj("docs/gggggggggggg_a.xlsx", "A-H");
D = await docs();
D.unshift({ id: "aH", mod: "audit", grp: "checklist", title: "a", date: "2026-11-04", ser: aSer, files: [{ name: "a.xlsx", size: 3, url: PUB + "docs/gggggggggggg_a.xlsx" }], at: "2026-11-04T03:00:00.000Z" });
await setDocs(D);
write("a.xlsx", "A-K", Date.parse("2026-11-04T05:00:00Z"));
r = await once();
D = await docs();
eq(objText(D[0].files[0].url), "A-K", "K 쪽이 현재 판");
ok(D.some(d => d.id === "aH"), "H 쪽은 이전 판으로 남음");
const cf1 = kFiles().filter(f => /충돌/.test(f));
eq(cf1.length, 1, "K 에 충돌 사본");
ok(cf1[0] === "a (충돌 " + TODAY + ").xlsx" && read(cf1[0]) === "A-H", "충돌 사본 이름 · 내용 " + cf1[0]);
eq((await rowsOf(M)).find(x => x.rel_path === "a.xlsx").state, "conflict", "확인 필요 '충돌'");
/* 같은 날 두 번째 충돌(K 가 늦음) — H 쪽 내용 사본은 '(충돌 날짜 2)'(첫 사본은 그대로 · 색인 제외) */
putObj("docs/gggggggggggh_a.xlsx", "A-H2");
D = await docs();
D.unshift({ id: "aH2", mod: "audit", grp: "checklist", title: "a", date: "2026-11-04", ser: aSer, files: [{ name: "a.xlsx", size: 4, url: PUB + "docs/gggggggggggh_a.xlsx" }], at: "2026-11-04T06:00:00.000Z" });
await setDocs(D);
write("a.xlsx", "A-K2", Date.parse("2026-11-04T07:00:00Z"));
r = await once();
D = await docs();
const cf1b = "a (충돌 " + TODAY + " 2).xlsx";
eq([r.status, objText(D[0].files[0].url), read(cf1[0]), has(cf1b) && read(cf1b), kFiles().filter(f => /충돌/.test(f)).length], ["ok", "A-K2", "A-H", "A-H2", 2],
  "K 가 이긴 두 번째 충돌 — H 쪽 사본은 '(충돌 날짜 2)' · 첫 사본 그대로");
r = await once();
run = await lastRun();
eq([run.k2h, run.h2k, run.conflicts], [0, 0, 0], "두 번째 사본도 다시 올리지 않음(색인 제외)");
fs.rmSync(K(cf1b), { force: true });
/* 양쪽 다 바뀜 — H 가 늦음: K 파일은 '(충돌 날짜)' 로 · H 현재 판을 K 에 · K 쪽 내용은 H 이전 판 */
fs.rmSync(K(cf1[0]));
write("sub/b2.docx", "B-K", Date.parse("2026-11-01T00:00:00Z"));
const bRow = (await rowsOf(M)).find(x => x.rel_path === "sub/b2.docx");
putObj("docs/hhhhhhhhhhhh_b.docx", "B-H");
D = await docs();
D.unshift({ id: "bH", mod: "audit", grp: "checklist", title: "b2", date: "2026-11-04", ser: bRow.ser, files: [{ name: "b.docx", size: 3, url: PUB + "docs/hhhhhhhhhhhh_b.docx" }], at: new Date(Date.now() + 60000).toISOString() });
await setDocs(D);
r = await once();
eq(read("sub/b2.docx"), "B-H", "H 쪽이 K 현재 파일");
const cf2 = kFiles("sub").filter(f => /충돌/.test(f));
eq(cf2.length === 1 && read(cf2[0]), "B-K", "K 쪽 내용은 충돌 사본으로");
D = await docs();
const old = D.filter(d => d.ser === bRow.ser && d.files[0].name.includes("충돌"));
eq(old.length === 1 && objText(old[0].files[0].url), "B-K", "K 쪽 내용은 H 이전 판으로도");
ok(D.find(d => d.ser === bRow.ser && d.id === "bH"), "H 현재 판 그대로");
r = await once();
run = await lastRun();
eq([run.k2h, run.h2k, run.conflicts], [0, 0, 0], "충돌 사본은 다시 올리지 않음(멱등)");
/* 같은 날 두 번째 충돌(H 가 늦음) — K 사본은 '(충돌 날짜 2)'(색인 제외) · K 쪽은 같은 판 묶음 이전 판으로만(새 문서 아님) */
write("sub/b2.docx", "B-K2", Date.parse("2026-11-02T00:00:00Z"));
putObj("docs/jjjjjjjjjjjj_b.docx", "B-H2");
D = await docs();
D.unshift({ id: "bH2", mod: "audit", grp: "checklist", title: "b2", date: "2026-11-05", ser: bRow.ser, files: [{ name: "b.docx", size: 4, url: PUB + "docs/jjjjjjjjjjjj_b.docx" }], at: new Date(Date.now() + 120000).toISOString() });
await setDocs(D);
const serN = (DD) => new Set(DD.map(d => d.ser || d.id)).size;
const nSer = serN(D);
r = await once();
const cf2b = "sub/b2 (충돌 " + TODAY + " 2).docx";
eq([r.status, read("sub/b2.docx"), has(cf2b) && read(cf2b)], ["ok", "B-H2", "B-K2"], "두 번째 사본은 '(충돌 날짜 2)'");
D = await docs();
eq(D.filter(d => d.ser === bRow.ser && d.files[0].name === "b2 (충돌 " + TODAY + " 2).docx").map(d => objText(d.files[0].url)), ["B-K2"], "K 쪽 내용은 같은 판 묶음의 이전 판");
eq(serN(D), nSer, "새 판 묶음(새 문서) 없음");
r = await once();
run = await lastRun();
eq([run.k2h, run.h2k, run.conflicts], [0, 0, 0], "두 번째 사본도 새 문서로 올리지 않음(색인 제외)");

/* 9. 삭제 대기 — 양쪽 */
fs.rmSync(K("가나다.pdf".normalize("NFD")));
D = await docs();
const hSer = D.find(d => d.id === "d1v2").ser;
await setDocs(D.filter(d => d.ser !== hSer));
const nBefore = (await docs()).length;
r = await once();
let rows = await rowsOf(M);
eq(rows.find(x => x.rel_path === "가나다.pdf").state, "del_k", "K 에서 지움 → 삭제 대기");
eq(rows.find(x => x.rel_path === "h1.pdf").state, "del_h", "H 에서 지움 → 삭제 대기");
eq([(await docs()).length, has("h1.pdf")], [nBefore, true], "자동 전파 안 함");
r = await once();
eq((await lastRun()).detail.filter(d => d.a === "del_k" || d.a === "del_h").length, 2, "다음 실행도 대기 그대로");
/* 확정 · 복원 */
rows = await rowsOf(M);
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [rows.find(x => x.rel_path === "가나다.pdf").id], act: "confirm" })]);
ok(!(await docs()).some(d => d.title === "가나다"), "K 삭제 확정 → H 문서 지움");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [rows.find(x => x.rel_path === "h1.pdf").id], act: "confirm" })]);
r = await once();
ok(!has("h1.pdf"), "H 삭제 확정 → K 파일 옮김");
const tr = kFiles("_H드라이브_휴지통");
ok(tr.length === 1 && /^_H드라이브_휴지통\/\d{4}-\d{2}-\d{2}\/h1\.pdf$/.test(tr[0]), "휴지통 폴더 " + tr);
ok(!(await rowsOf(M)).some(x => x.rel_path === "h1.pdf"), "기준선 정리");
/* 복원: H 에서 지운 것 → H 로 다시 */
D = await docs();
await setDocs(D.filter(d => d.id !== "de"));
await once();
rows = await rowsOf(M);
const evRow = rows.find(x => x.doc_id === "de");
eq(evRow.state, "del_h", "삭제 대기");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [evRow.id], act: "restore" })]);
await once();
D = await docs();
ok(D.some(d => d.src === "ksync" && d.files[0].name === "_.._.._evil.pdf"), "H 로 복원");
eq((await rowById(evRow.id)).state, "ok", "복원 뒤 정상");
/* 복원: K 에서 지운 것 → K 로 다시 */
fs.rmSync(K("sub/b2.docx"));
await once();
rows = await rowsOf(M);
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [rows.find(x => x.rel_path === "sub/b2.docx").id], act: "restore" })]);
await once();
eq(has("sub/b2.docx") && read("sub/b2.docx"), "B-H2", "K 로 복원(H 현재 판)");

/* 10. 받은 파일 해시 불일치 — K 에 쓰지 않음 */
putObj("docs/iiiiiiiiiiii_t.pdf", "TAMPER");
D = await docs();
D.push({ id: "dt", mod: "audit", grp: "checklist", title: "t", date: "2026-11-04", files: [{ name: "t.pdf", size: 6, url: PUB + "docs/iiiiiiiiiiii_t.pdf" }] });
await setDocs(D);
hook.tamperDn = (p) => p === "docs/iiiiiiiiiiii_t.pdf";
r = await once();
hook.tamperDn = null;
eq([has("t.pdf"), r.status], [false, "partial"], "받은 파일 해시가 다르면 버림");
ok(!kFiles().some(f => f.endsWith(".part")), "임시 파일 남지 않음");
eq(await events("hash_mismatch"), 1, "hash_mismatch 기록");
await once();
eq(has("t.pdf") && read("t.pdf"), "TAMPER", "다음 실행에서 정상 받음");

/* 11. H 가 이긴 충돌 — H 새 판 파일 이름이 K 와 다름(S6) · K 파일 이름은 H 판을 받아 확인한 뒤에야(A4) */
write("c.docx", "C1", Date.parse("2026-11-01T00:00:00Z"));
r = await once();
const cRow0 = (await rowsOf(M)).find(x => x.rel_path === "c.docx");
D = await docs();
const cDoc = D.find(d => d.id === cRow0.doc_id);
putObj("docs/kkkkkkkkkkkk_c-v2.docx", "C-H");
D.unshift({ id: "cH", mod: "audit", grp: "checklist", title: "c 개정판", date: "2026-11-05", ser: cDoc.ser, files: [{ name: "c-v2.docx", size: 3, url: PUB + "docs/kkkkkkkkkkkk_c-v2.docx" }], at: new Date(Date.now() + 60000).toISOString() });
await setDocs(D);
write("c.docx", "C-K", Date.parse("2026-11-02T00:00:00Z"));
hook.failDn = (p) => p === "docs/kkkkkkkkkkkk_c-v2.docx";
r = await once();
hook.failDn = null;
eq([r.status, read("c.docx"), has("c-v2.docx"), kFiles().filter(f => /^c \(충돌/.test(f))], ["partial", "C-K", false, []], "A4 H 판 받기 실패 → K 파일 이름 그대로(K 수정이 사본 이름에 갇히지 않음)");
ok(!(await docs()).some(d => d.ser === cDoc.ser && d.files[0].name.includes("충돌")), "A4 K 쪽 이전 판도 아직 올리지 않음");
eq((await rowById(cRow0.id)).state, "error", "받기 실패 표시");
r0 = rpcLog.length;
r = await once();
const cRow = await rowById(cRow0.id);
eq([r.status, read("c-v2.docx"), has("c (충돌 " + TODAY + ").docx") && read("c (충돌 " + TODAY + ").docx"), has("c.docx")], ["ok", "C-H", "C-K", false],
  "H 판은 H 이름으로 · K 쪽은 '(충돌 날짜)' 사본(받은 뒤 이름 바꿈)");
eq([cRow && cRow.rel_path, cRow && cRow.state, cRow && cRow.h_name], ["c-v2.docx", "conflict", "c-v2.docx"], "S6 같은 기준선 줄(id)을 고침");
ok(since(rpcLog, r0, x => x.act === "mark").some(x => x.p.items.some(i => i.op === "set" && String(i.id) === String(cRow0.id))), "S6 mark set 에 줄 id");
D = await docs();
const cCur = D.find(d => d.id === "cH"), cOld = D.filter(d => d.ser === cDoc.ser && d.files[0].name === "c (충돌 " + TODAY + ").docx");
eq(cOld.length, 1, "K 쪽은 같은 판 묶음의 이전 판으로");
ok(cOld.length === 1 && cOld[0].title === cCur.title && cOld[0].date <= cCur.date && objText(cOld[0].files[0].url) === "C-K",
  "이전 판: 제목은 현재 판 · 날짜는 현재 판보다 늦지 않음 · 내용 = K 쪽 " + JSON.stringify(cOld));
r = await once();
run = await lastRun();
eq([run.k2h, run.h2k, run.conflicts], [0, 0, 0], "멱등");
/* S10 — K 삭제 확정 때 그 판 묶음의 이 파일 판을 모두 지움(충돌 사본 · 이름이 달랐던 옛 판 포함) — 남으면 그 판이 현재 판이 되어 K 로 되돌아옴 */
fs.rmSync(K("c-v2.docx"));
await once();
eq((await rowById(cRow0.id)).state, "del_k", "K 에서 지움 → 삭제 대기");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [cRow0.id], act: "confirm" })]);
eq((await docs()).filter(d => d.ser === cDoc.ser).map(d => d.files.map(f => f.name)), [], "S10 판 묶음의 판 모두 지움");
r = await once();
eq([r.status, has("c.docx"), has("c-v2.docx")], ["ok", false, false], "확정 뒤 K 로 되돌아오지 않음");

/* 12. 여러 첨부 문서(S8) — K 에서 한 파일을 고치면 새 판은 다른 첨부를 그대로 두고 그 파일만 바꿈 · 다른 줄은 다시 잇지 않음 */
putObj("docs/mmmmmmmmmmm1_m1.pdf", "M1"); putObj("docs/mmmmmmmmmmm2_m2.pdf", "M2");
D = await docs();
D.push({ id: "dm", mod: "audit", grp: "checklist", title: "여러 첨부", date: "2026-11-01", files: [{ name: "m1.pdf", size: 2, url: PUB + "docs/mmmmmmmmmmm1_m1.pdf" }, { name: "m2.pdf", size: 2, url: PUB + "docs/mmmmmmmmmmm2_m2.pdf" }], at: "2026-11-01T00:00:00.000Z" });
await setDocs(D);
r = await once();
eq([r.status, read("m1.pdf"), read("m2.pdf")], ["ok", "M1", "M2"], "첨부마다 K 파일");
const mRows = (await rowsOf(M)).filter(x => x.ser === "dm");
eq(mRows.map(x => x.rel_path), ["m1.pdf", "m2.pdf"], "기준선 줄 둘(같은 판 묶음)");
const m2Before = mRows.find(x => x.rel_path === "m2.pdf");
write("m1.pdf", "M1-K", Date.parse("2026-11-05T00:00:00Z"));
r = await once();
D = await docs();
// 결함이 있으면 첨부가 하나뿐이라 files[1] 이 없다 — 시험이 멈추지 않고 실패를 다 보고하게 ?. 로 읽는다
eq([D[0]?.ser, D[0]?.title, D[0]?.files?.map(f => f.name), objText(D[0]?.files?.[0]?.url), D[0]?.files?.[1]?.url], ["dm", "여러 첨부", ["m1.pdf", "m2.pdf"], "M1-K", PUB + "docs/mmmmmmmmmmm2_m2.pdf"],
  "S8 새 판 = 지금 판의 첨부 그대로 + 고친 파일만 새 주소");
const m2After = await rowById(m2Before.id);
eq([m2After?.rel_path, m2After?.h_url, m2After?.doc_id, m2After?.state, String(m2After?.synced_at)], [m2Before.rel_path, m2Before.h_url, m2Before.doc_id, "ok", String(m2Before.synced_at)], "S8 다른 첨부의 줄은 그대로");
ok(!(await lastRun()).detail.some(d => d.f === "m2.pdf"), "S8 다른 첨부는 손대지 않음");
r = await once();
run = await lastRun();
eq([run.k2h, run.h2k, run.detail.filter(d => /^(del_k|del_h|link|drop)$/.test(d.a)).length], [0, 0, 0], "S8 다음 실행 할 일 없음(삭제 대기 · 다시 잇기 없음)");
write("m2.pdf", "M2-K", Date.parse("2026-11-05T01:00:00Z"));
r = await once();
D = await docs();
eq(D[0]?.files?.map(f => objText(f.url)), ["M1-K", "M2-K"], "S8 다른 첨부를 고쳐도 앞서 고친 첨부를 이어 감");

/* 12-1. S10 여러 첨부 — H 가 이긴 충돌로 남은 '(충돌 날짜)' 이전 판도 K 삭제 확정 때 그 첨부와 함께 지움 · 다른 첨부는 남김
   (맞춘 줄이 둘이라 '첨부 하나인 판은 모두 지움' 규칙을 타지 않고 이름 규칙만 본다) */
const m1Row = (await rowsOf(M)).find(x => x.rel_path === "m1.pdf"), m2Row = (await rowsOf(M)).find(x => x.rel_path === "m2.pdf");
putObj("docs/mmmmmmmmmmm3_m1.pdf", "M1-H");
D = await docs();
D.unshift({ id: "dmH", mod: "audit", grp: "checklist", title: "여러 첨부", date: "2026-11-06", ser: "dm",
  files: [{ name: "m1.pdf", size: 4, url: PUB + "docs/mmmmmmmmmmm3_m1.pdf" }, { name: "m2.pdf", size: 4, url: m2Row.h_url }], at: new Date(Date.now() + 60000).toISOString() });
await setDocs(D);
write("m1.pdf", "M1-K2", Date.parse("2026-11-05T02:00:00Z"));
r = await once();
const mCf = "m1 (충돌 " + TODAY + ").pdf";
const dmNames = async () => (await docs()).filter(d => d.ser === "dm").map(d => d.files.map(f => f.name));
eq([r.status, read("m1.pdf"), has(mCf) && read(mCf), (await dmNames()).filter(n => n.includes(mCf))], ["ok", "M1-H", "M1-K2", [[mCf]]], "H 가 이김 — K 쪽은 '(충돌 날짜)' 사본 · 같은 판 묶음 이전 판(첨부 하나)");
fs.rmSync(K("m1.pdf"));
await once();
eq((await rowById(m1Row.id))?.state, "del_k", "K 에서 지움 → 삭제 대기");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [m1Row.id], act: "confirm" })]);
eq([(await dmNames()).flat().filter(n => n.startsWith("m1")), (await dmNames())[0]], [[], ["m2.pdf"]], "S10 충돌 이름 이전 판까지 m1 판 모두 지움 · 현재 판에 m2 남음");
eq([(await rowById(m2Row.id))?.state, (await rowById(m2Row.id))?.h_url, await rowById(m1Row.id)], ["ok", m2Row.h_url, undefined], "m2 줄 그대로 · m1 줄 정리");
r = await once();
run = await lastRun();
eq([r.status, has("m1.pdf"), read("m2.pdf"), run.h2k, run.detail.filter(d => /^m[12]\.pdf$/.test(d.f)).map(d => d.a)], ["ok", false, "M2-K", 0, []], "확정 뒤 m1 이 K 로 되돌아오지 않음 · m2 할 일 없음");

/* 13. 문서함에서 판 묶음을 바꿈(A5) — 주소로 짝지어 기준선만 고침(같은 줄) · K 중복 · 삭제 대기 없음 · 이어지는 K 수정은 새 판 묶음으로 */
write("p.pdf", "P1", Date.parse("2026-11-01T00:00:00Z"));
r = await once();
const pRow = (await rowsOf(M)).find(x => x.rel_path === "p.pdf");
D = await docs();
Object.assign(D.find(d => d.id === pRow.doc_id), { id: "p-moved", ser: "점검 묶음" });     // 문서함에서 판 묶음을 옮김(같은 파일 주소 · 문서 id 도 바뀐 경우)
await setDocs(D);
const nK = kFiles().length;
r0 = rpcLog.length;
r = await once();
const pRow2 = await rowById(pRow.id);
eq([pRow2 && pRow2.ser, pRow2 && pRow2.doc_id, pRow2 && pRow2.h_url, pRow2 && pRow2.state, pRow2 && pRow2.rel_path], ["점검 묶음", "p-moved", pRow.h_url, "ok", "p.pdf"], "A5 같은 줄 · 판 묶음 · 문서 id 만 고침");
ok(since(rpcLog, r0, x => x.act === "mark").some(x => x.p.items.some(i => i.op === "set" && String(i.id) === String(pRow.id))), "A5 mark set 에 줄 id");
run = await lastRun();
eq([kFiles().length, run.h2k, run.k2h, run.detail.filter(d => d.a === "link" && d.f === "p.pdf").length, run.detail.filter(d => /^del_/.test(d.a)).length], [nK, 0, 0, 1, 0], "A5 K 중복 · 삭제 대기 없음");
write("p.pdf", "P2", Date.parse("2026-11-05T00:00:00Z"));
r = await once();
D = await docs();
eq([D[0].ser, objText(D[0].files[0].url), D.filter(d => d.ser === "점검 묶음").length], ["점검 묶음", "P2", 2], "A5 이어지는 K 수정은 새 판 묶음의 새 판");

/* 14. 읽지 못한 파일(A1) — 오류 줄만 · 삭제 대기 아님 · H 로 덮어쓰지 않음, 권한을 되돌리면 평소대로 */
if (NOROOT) {
  write("r.pdf", "R1", Date.parse("2026-11-01T00:00:00Z"));
  await once();
  const rRow = (await rowsOf(M)).find(x => x.rel_path === "r.pdf");
  putObj("docs/rrrrrrrrrrrr_r.pdf", "R-H");
  D = await docs();
  D.unshift({ id: "rH", mod: "audit", grp: "checklist", title: "r", date: "2026-11-05", ser: rRow.ser, files: [{ name: "r.pdf", size: 3, url: PUB + "docs/rrrrrrrrrrrr_r.pdf" }], at: new Date(Date.now() + 60000).toISOString() });
  await setDocs(D);
  const tR = Date.parse("2026-11-03T00:00:00Z");
  fs.utimesSync(K("r.pdf"), tR / 1000, tR / 1000);      // 내용은 그대로 · 수정 시각만 바뀜 → 색인이 다시 읽어야 한다
  const nPrev = kFiles("_H드라이브_이전판").length;
  fs.chmodSync(K("r.pdf"), 0);
  try { r = await once(); } finally { fs.chmodSync(K("r.pdf"), 0o644); }
  run = await lastRun();
  ok(run.detail.some(d => d.f === "r.pdf" && d.a === "error"), "A1 읽지 못한 파일 → 오류 줄 " + JSON.stringify(run.detail));
  eq([r.status, (await rowById(rRow.id)).state, read("r.pdf"), kFiles("_H드라이브_이전판").length], ["partial", "ok", "R1", nPrev], "A1 삭제 대기 아님 · H 로 덮어쓰지 않음");
  eq([run.h2k, has("r (2).pdf"), (await rowById(rRow.id)).rel_path, (await rowById(rRow.id)).h_url], [0, false, "r.pdf", rRow.h_url], "A1 H 판을 다른 이름으로도 받지 않음 · 기준선 그대로");
  r = await once();
  eq([r.status, read("r.pdf"), kFiles("_H드라이브_이전판").length], ["ok", "R-H", nPrev + 1], "A1 권한을 되돌리면 평소대로(H 새 판으로 덮어씀 · 옛 파일 이전판)");
  /* H 는 그대로 — 읽지 못한 파일을 K 에서 지운 것으로 보지 않음(삭제 대기 아님) */
  const tR0 = Date.parse("2026-11-04T00:00:00Z");
  fs.utimesSync(K("r.pdf"), tR0 / 1000, tR0 / 1000);    // 수정 시각만 바뀜 → 색인이 다시 읽어야 한다
  fs.chmodSync(K("r.pdf"), 0);
  try { r = await once(); } finally { fs.chmodSync(K("r.pdf"), 0o644); }
  run = await lastRun();
  eq([r.status, (await rowById(rRow.id)).state, run.h2k, run.detail.filter(d => d.f === "r.pdf").map(d => d.a)], ["partial", "ok", 0, ["error"]], "A1 H 그대로 · 읽지 못한 파일 → 오류 줄만(삭제 대기 아님)");
}

/* 15. 올린 파일이 저장소에서 달라짐 — verify 가 다시 재서 거절 · 파일 지움 · 그 줄 오류 · hash_mismatch(k2h) */
write("v.pdf", "V1", Date.parse("2026-11-01T00:00:00Z"));
await once();
const vRow = (await rowsOf(M)).find(x => x.rel_path === "v.pdf");
write("v.pdf", "V2", Date.parse("2026-11-05T00:00:00Z"));
let ev0 = await events("hash_mismatch");
const nDocsV = (await docs()).length;
r0 = rpcLog.length;
hook.tamperUp = () => true;
r = await once();
hook.tamperUp = null;
const vPath = since(rpcLog, r0, x => x.act === "put").pop().res.path;
eq([r.status, objects.has(vPath), deleted.includes(vPath), await events("hash_mismatch"), (await docs()).length], ["partial", false, true, ev0 + 1, nDocsV], "verify: 저장소 값이 다르면 거절 · 파일 지움 · 기록 · 등록 안 함");
eq([(await rowById(vRow.id)).state, (await rowById(vRow.id)).note], ["error", "hash"], "그 줄은 오류(hash)");
ok((await lastRun()).detail.some(d => d.f === "v.pdf" && d.a === "error" && d.r === "hash"), "실행 기록 오류 hash");
eq(await one("select detail ->> 'dir' from semis_logi_private.ksync_events where kind = 'hash_mismatch' order by id desc limit 1"), "k2h", "올리기 쪽 해시 불일치");
r = await once();
D = await docs();
eq([r.status, (await rowById(vRow.id)).state, objText(D[0].files[0].url)], ["ok", "ok", "V2"], "다음 실행에서 정상 등록");

/* 16. 확인(verify)과 등록(apply) 사이에서 끊김 — 다음 실행이 다시 올려 한 번만 등록 */
write("crash.pdf", "CR", Date.parse("2026-11-05T03:00:00Z"));
let nApply = 0;
hook.failRpc = (act) => act === "put_apply" && nApply++ === 0;
r = await once();
hook.failRpc = null;
eq([r.status, (await docs()).some(d => d.title === "crash")], ["fail", false], "등록 단계 서버 오류 → 실행 실패 · 문서함 그대로");
eq(await one("select count(*)::int from semis_logi_private.ksync_uploads where rel_path = 'crash.pdf' and verified"), 1, "확인까지 끝난 올리기만 남음");
r = await once();
D = await docs();
eq([r.status, D.filter(d => d.title === "crash").length, (await rowsOf(M)).filter(x => x.rel_path === "crash.pdf").length], ["ok", 1, 1], "다음 실행이 다시 올려 한 번만 등록");
eq(objText(D.find(d => d.title === "crash").files[0].url), "CR", "등록한 내용");

/* 16-1. K 에서 이름을 바꾼 뒤 옛 이름으로 새 파일 — 새 문서는 따로 묶임(이름을 바꾼 파일이 쓰는 옛 경로 키를 이어 쓰면 그 문서를 가리고, 다음 실행이 그 파일을 'H 에서 지움'으로 봄) */
write("q.pdf", "Q1", Date.parse("2026-11-01T00:00:00Z"));
await once();
const qRow = (await rowsOf(M)).find(x => x.rel_path === "q.pdf");
fs.renameSync(K("q.pdf"), K("q2.pdf"));
await once();
eq([(await rowById(qRow.id)).rel_path, (await docs()).filter(d => (d.ser || d.id) === qRow.ser).map(d => d.title)], ["q2.pdf", ["q2"]], "이름 바꿈 → 같은 줄 · 제목만");
write("q.pdf", "Q-new", Date.parse("2026-11-05T00:00:00Z"));
r = await once();
const qNew = (await rowsOf(M)).find(x => x.rel_path === "q.pdf");
D = await docs();
ok(r.status === "ok" && qNew && qNew.ser !== qRow.ser, "새 q.pdf 는 다른 판 묶음 " + JSON.stringify([r.status, qNew && qNew.ser, qRow.ser]));
eq([D.filter(d => (d.ser || d.id) === qRow.ser).map(d => [d.title, objText(d.files[0].url)]), D.filter(d => qNew && (d.ser || d.id) === qNew.ser).map(d => [d.title, objText(d.files[0].url)])],
  [[["q2", "Q1"]], [["q", "Q-new"]]], "판 묶음 둘 — 이름을 바꾼 파일 · 새 파일 각각 하나");
for (let i = 0; i < 2; i++) {
  r = await once();
  run = await lastRun();
  eq([r.status, run.k2h, run.h2k, run.detail.filter(d => /^q2?\.pdf$/.test(d.f)).map(d => d.a)], ["ok", 0, 0, []], "다음 실행 " + (i + 1) + ": 할 일 없음(삭제 대기 없음)");
}
eq([(await rowById(qRow.id)).state, (await rowById(qRow.id)).h_url, (await rowById(qNew.id)).state], ["ok", qRow.h_url, "ok"], "이름을 바꾼 파일의 줄은 그대로 'ok'");

/* 16-2. H 가 이긴 충돌에서 K 쪽 판을 H 이전 판으로 올리지 못함 — K 파일 이름을 바꾸지 않음(바꾸면 K 수정이 색인에서 빠지는 사본에만 남음) · 다음 실행이 다시 충돌로 보아 H 로 보냄 */
const hWins = async (rel, body, kBody, id, p) => {
  write(rel, body, Date.parse("2026-11-01T00:00:00Z"));
  await once();
  const row0 = (await rowsOf(M)).find(x => x.rel_path === rel);
  putObj(p, kBody + "-H");
  D = await docs();
  D.unshift({ id, mod: "audit", grp: "checklist", title: path.basename(rel, ".pdf"), date: "2026-11-05", ser: row0.ser, files: [{ name: rel, size: kBody.length + 2, url: PUB + p }], at: new Date(Date.now() + 60000).toISOString() });
  await setDocs(D);
  write(rel, kBody, Date.parse("2026-11-02T00:00:00Z"));
  return row0;
};
const oldPut = (x) => x.act === "put" && x.p.mode === "old";
const cfOf = (rel) => rel.replace(/\.pdf$/, " (충돌 " + TODAY + ").pdf");
const kSide = async (row0, rel) => (await docs()).filter(d => d.ser === row0.ser && d.files[0].name === cfOf(rel)).map(d => objText(d.files[0].url));
// 서버 오류(500) — 실행 전체가 멈춤
const wRow0 = await hWins("w.pdf", "W1", "W-K", "wH", "docs/wwwwwwwwwww1_w.pdf");
hook.failRpc = (act, p) => act === "put" && p.mode === "old";
r = await once();
hook.failRpc = null;
let w1 = await rowById(wRow0.id);
eq([r.status, read("w.pdf"), has(cfOf("w.pdf")), kFiles().filter(f => f.endsWith(".part"))], ["fail", "W-K", false, []], "이전 판 올리기 서버 오류 → K 파일 이름 · 내용 그대로(H 판을 놓지 않음)");
eq([w1.k_sha256, w1.h_url, w1.state, await kSide(wRow0, "w.pdf")], [wRow0.k_sha256, wRow0.h_url, "ok", []], "기준선 그대로 · H 이전 판 없음");
r0 = rpcLog.length;
r = await once();
w1 = await rowById(wRow0.id);
eq([r.status, read("w.pdf"), has(cfOf("w.pdf")) && read(cfOf("w.pdf")), await kSide(wRow0, "w.pdf"), w1.state, w1.h_url], ["ok", "W-K-H", "W-K", ["W-K"], "conflict", PUB + "docs/wwwwwwwwwww1_w.pdf"],
  "다음 실행: 다시 충돌 → K 쪽 판은 H 이전 판 · K 사본, H 판은 K 에");
ok(since(rpcLog, r0, oldPut).length === 1 && since(rpcLog, r0, x => x.act === "put_apply").some(x => x.p.paths.includes(since(rpcLog, r0, oldPut)[0].res.path)), "이전 판은 한 번 올려 등록");
// 저장소에서 달라짐(확인 실패) — 그 줄만 오류 · 실행은 이어감
const yRow0 = await hWins("y.pdf", "Y1", "Y-K", "yH", "docs/yyyyyyyyyyy1_y.pdf");
hook.tamperUp = (p) => rpcLog.some(x => oldPut(x) && x.res && x.res.path === p);
r = await once();
hook.tamperUp = null;
let y1 = await rowById(yRow0.id);
eq([r.status, read("y.pdf"), has(cfOf("y.pdf")), y1.k_sha256, y1.h_url, [y1.state, y1.note], await kSide(yRow0, "y.pdf")], ["partial", "Y-K", false, yRow0.k_sha256, yRow0.h_url, ["error", "hash"], []],
  "이전 판 확인 실패(hash) → K 파일 · 기준선 그대로 · 그 줄 오류");
r = await once();
y1 = await rowById(yRow0.id);
eq([r.status, read("y.pdf"), has(cfOf("y.pdf")) && read(cfOf("y.pdf")), await kSide(yRow0, "y.pdf"), y1.state], ["ok", "Y-K-H", "Y-K", ["Y-K"], "conflict"], "다음 실행에서 K 쪽 판이 H 로");

/* 16-3. SSI 아닌 연결에서 맞춘 판 묶음의 현재 판이 민감보안정보가 됨(H 사용자가 SSI 를 켬 · S4 가 K 수정을 docs-ssi 판으로 올림) —
   H 목록에 안 보여도 'H 에서 지움'이 아님(확정하면 K 파일이 휴지통으로 가고, 복원은 다시 숨는 판이 되어 되풀이) */
write("z.pdf", "Z1", Date.parse("2026-11-01T00:00:00Z"));
await once();
const zRow = (await rowsOf(M)).find(x => x.rel_path === "z.pdf");
D = await docs();
D.find(d => d.id === zRow.doc_id).ssi = true;
await setDocs(D);
const zLine = async () => (await lastRun()).detail.filter(d => d.f === "z.pdf").map(d => d.a + ":" + d.r);
r = await once();
eq([r.status, (await rowById(zRow.id))?.state, await zLine(), read("z.pdf")], ["ok", "ok", [], "Z1"], "현재 판이 SSI 가 됨 → 'H 에서 지움' 아님 · K 그대로");
write("z.pdf", "Z2", Date.parse("2026-11-05T00:00:00Z"));
r0 = rpcLog.length;
r = await once();
const zPut = since(rpcLog, r0, x => x.act === "put").pop();
const zCur = (await docs()).find(d => (d.ser || d.id) === zRow.ser);     // 새 판은 배열 맨 앞
eq([r.status, zPut && zPut.p.mode, /^docs-ssi\//.test((zPut && zPut.res.path) || ""), zCur && zCur.ssi, zCur && objText(zCur.files[0].url)], ["ok", "version", true, true, "Z2"],
  "K 수정 → 같은 판 묶음 새 판(docs-ssi · ssi:true)");
for (let i = 0; i < 2; i++) {
  r = await once();
  run = await lastRun();
  eq([r.status, run.k2h, run.h2k, (await rowById(zRow.id))?.state, await zLine()], ["ok", 0, 0, "ok", []], "다음 실행 " + (i + 1) + ": 'H 에서 지움' 없음 · 할 일 없음");
}
fs.rmSync(K("z.pdf"));
r = await once();
const z2 = await rowById(zRow.id);
eq([r.status, z2 && z2.state, z2 && z2.note, has("z.pdf"), (await lastRun()).h2k, await zLine()], ["ok", "skip", "ssi", false, 0, ["skip:ssi"]], "K 에서 지움 → 건너뜀(ssi) · 삭제 대기 · 받기 없음");
write("z.pdf", "Z2", Date.parse("2026-11-05T00:00:00Z"));
r = await once();
eq([r.status, (await rowById(zRow.id))?.state, (await lastRun()).k2h], ["ok", "ok", 0], "같은 내용이 돌아오면 정상으로(다시 올리지 않음)");

/* 17. --dry-run — 계획만 출력: 회차 · 미리보기 · 폴더 · 연결 안 됨 · mark · 올리기 · 등록 · 내려받기 없음, 상태 파일 · K · 문서함 그대로 */
write("dry.pdf", "DRY", Date.parse("2026-11-05T04:00:00Z"));
write("p.pdf", "P3", Date.parse("2026-11-05T04:00:00Z"));
const stale = K(".ksync-0123456789ab.part");     // 중단된 실행이 남긴 하루 지난 임시 파일 — 정리도 바꾸는 일이라 --dry-run 은 손대지 않음
fs.writeFileSync(stale, "x");
fs.utimesSync(stale, (Date.now() - 2 * 864e5) / 1000, (Date.now() - 2 * 864e5) / 1000);
// 기록 정리(30일)는 날이 바뀐 첫 실행에서 — 마지막 정리 날짜를 옛날로 두고 30일 지난 줄을 넣어 --dry-run 이 그것도 손대지 않는지 본다
const LOG = path.join(APP, "ksync.log"), logNew = new Date(NOW).toISOString() + " [info] 오늘 줄\n", logTxt = "2000-01-01T00:00:00.000Z [info] 오래된 줄\n" + logNew;
fs.writeFileSync(LOG, logTxt);
fs.writeFileSync(STATE, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(STATE, "utf8")), { logDay: "2000-01-01" })));
const stBuf = fs.readFileSync(STATE), stMt = fs.statSync(STATE).mtimeMs, kSnap = JSON.stringify(kFiles()), dSnap = await docsAt();
r0 = rpcLog.length; h0 = httpLog.length; outs.length = 0;
r = await once({ dryRun: true });
eq([r.status, [...new Set(since(rpcLog, r0, () => true).map(x => x.act))]], ["dry-run", ["hello"]], "--dry-run 은 hello(읽기)만");
ok(!since(httpLog, h0, x => x.p === "up" || x.p === "dn").length, "--dry-run 은 저장소 올리기 · 내려받기 없음");
ok(fs.readFileSync(STATE).equals(stBuf) && fs.statSync(STATE).mtimeMs === stMt, "--dry-run 은 상태 파일을 쓰지 않음");
eq([JSON.stringify(kFiles()), await docsAt()], [kSnap, dSnap], "--dry-run 은 K · 문서함 그대로");
const outM = outs.find(o => o.map === M);
ok(outM && outM.actions.includes("put dry.pdf new") && outM.actions.includes("put p.pdf version"), "--dry-run 계획 출력 " + JSON.stringify(outM));
ok(fs.existsSync(stale), "--dry-run 은 하루 지난 임시 파일도 지우지 않음");
eq(fs.readFileSync(LOG, "utf8"), logTxt, "--dry-run 은 기록 파일도 정리하지 않음");
r = await once();
eq([r.status, (await lastRun()).k2h, fs.existsSync(stale)], ["ok", 2, false], "다음 실제 실행에서 반영 · 하루 지난 임시 파일 정리");
eq([fs.readFileSync(LOG, "utf8"), JSON.parse(fs.readFileSync(STATE, "utf8")).logDay], [logNew, TODAY], "다음 실제 실행에서 30일 지난 기록 줄 정리");

/* 18. SSI 연결 — 올리기 시작이 docs-ssi/ 경로 · 문서 ssi: true. 새 파일 여러 개 = 등록마다 문서함 저장 한 번, 50건 넘으면 등록 두 번 */
const SD = path.join(MOUNT, "보안", "SSI");
fs.mkdirSync(SD, { recursive: true });
for (let i = 1; i <= 51; i++) { const f = path.join(SD, "s" + String(i).padStart(2, "0") + ".pdf"); fs.writeFileSync(f, "S" + i); fs.utimesSync(f, T0 / 1000, T0 / 1000); }
const M2 = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "보안/SSI", mod: "security", grp: "ssi", ssi: true })])).id;
r = await once();
eq([r.status, await one("select (preview ->> 'k2h')::int from semis_logi_private.ksync_maps where id = $1", [M2])], ["ok", 51], "SSI 연결 미리보기");
await admin("select public.semis_logi_ksync_map_start($1)", [M2]);
/* S11 — 시작(첫 실행 승인)한 뒤 연결 폴더를 못 읽은 회차는 승인을 쓰지 않음 */
if (NOROOT) {
  r0 = rpcLog.length;
  fs.chmodSync(SD, 0);
  try { r = await once(); } finally { fs.chmodSync(SD, 0o755); }
  const hz = await holdOf(M2);
  eq([r.status, (await docs()).filter(d => d.mod === "security").length, endOf(r0).p.maps.find(x => x.id === M2).done], ["partial", 0, false], "연결 폴더를 못 읽음 → 그 연결 건너뜀(done:false)");
  ok(hz && hz.ok === true, "S11 시작 승인은 남음 " + JSON.stringify(hz));
}
r0 = rpcLog.length; s0 = await saves();
r = await once();
const applies = since(rpcLog, r0, x => x.act === "put_apply"), begins = since(rpcLog, r0, x => x.act === "put");
eq([r.status, applies.map(x => x.p.paths.length), await saves() - s0], ["ok", [50, 1], 2], "51건 → 등록 두 번(50 + 1) · 문서함 저장도 두 번");
ok(begins.length === 51 && begins.every(x => x.res && x.res.ok && /^docs-ssi\//.test(x.res.path)), "올리기 시작이 docs-ssi/ 경로");
const sd = (await docs()).filter(d => d.mod === "security");
ok(sd.length === 51 && sd.every(d => d.ssi === true && pathOf(d.files[0].url).startsWith("docs-ssi/") && objects.has(pathOf(d.files[0].url))), "SSI 문서 · 파일은 docs-ssi/");
eq(await holdOf(M2), null, "끝까지 맞춘 회차에서 시작 승인 씀");

/* 19. 대량 변경 보류 — 승인 전에는 계속 보류 · 승인한 보류는 그 연결을 끝까지 맞춘 회차(done:true)에서만 지움 */
await admin("select public.semis_logi_ksync_settings($1::jsonb)", [JSON.stringify({ mass_limit: { files: 2, ratio: 0.3 } })]);
const T5 = Date.parse("2026-11-05T06:00:00Z");
write("a.xlsx", "A3", T5); write("t.pdf", "T2", T5); write("_.._.._evil.pdf", "E2", T5);
const nObj2 = objects.size, nHold = await events("mass_hold");
r = await once();
eq([r.status, objects.size], ["held", nObj2], "한도 넘음 → 보류 · 전송 없음");
const pend = await admin("select public.semis_logi_ksync_pending()");
eq(pend.holds.map(h => h.map), [M], "확인 필요 — 대량 변경 보류");
eq(await events("mass_hold"), nHold + 1, "mass_hold 기록");
r = await once();
eq(r.status, "held", "승인 전에는 계속 보류");
await admin("select public.semis_logi_ksync_hold($1::jsonb)", [JSON.stringify({ run_id: String(pend.holds[0].run), act: "approve" })]);
if (NOROOT) {
  /* A1 · S11 — 연결 폴더를 못 읽은 회차는 승인을 쓰지 않음 */
  r0 = rpcLog.length;
  fs.chmodSync(K(""), 0);
  try { r = await once(); } finally { fs.chmodSync(K(""), 0o755); }
  eq([r.status, objects.size, endOf(r0).p.maps.find(x => x.id === M).done], ["partial", nObj2, false], "연결 폴더를 못 읽음 → 건너뜀(done:false)");
  ok((await holdOf(M) || {}).ok === true, "승인은 남음(못 읽은 회차)");
}
/* 하루 전송량 상한으로 중간에 멈춘 회차 — 상한 전에 확인까지 끝낸 올리기는 등록하고, 승인은 쓰지 않음(끝까지 맞춘 것이 아님)
   오늘 쓴 양을 0 으로 두고 상한을 2바이트로: 2바이트 파일 셋 중 첫 올리기만 들어가고 두 번째 put 이 quota */
const lim0 = await one("select limits from semis_logi_private.ksync_state");
await db.query("update semis_logi_private.ksync_agents set day_kst = semis_logi_private.ksync_today(), day_bytes = 0");
await db.query("update semis_logi_private.ksync_state set limits = limits || '{\"dayBytes\": 2}'::jsonb");
r0 = rpcLog.length;
try { r = await once(); } finally { await db.query("update semis_logi_private.ksync_state set limits = $1::jsonb", [JSON.stringify(lim0)]); }
const putsQ = since(rpcLog, r0, x => x.act === "put"), apQ = since(rpcLog, r0, x => x.act === "put_apply"), firstQ = putsQ[0];
eq([r.status, (await lastRun()).msg, endOf(r0).p.maps.find(x => x.id === M).done, putsQ.map(x => x.res && (x.res.ok ? "ok" : x.res.error))], ["partial", "하루 전송량 상한", false, ["ok", "quota"]],
  "전송량 상한 → 두 번째 put 에서 멈춤(done:false)");
ok(!!firstQ && apQ.some(x => x.p.paths.includes(firstQ.res.path) && x.res && x.res.docs && x.res.docs[firstQ.res.path]), "상한 전에 확인까지 끝낸 올리기는 등록 " + JSON.stringify(apQ.map(x => x.p.paths)));
const qFile = firstQ && (await docs()).flatMap(d => d.files).find(f => pathOf(f.url) === firstQ.res.path);
eq([qFile && objText(qFile.url), objects.size], [firstQ && { "a.xlsx": "A3", "t.pdf": "T2", "_.._.._evil.pdf": "E2" }[firstQ.p.rel_path], nObj2 + 1], "등록한 문서 내용 · 저장소에는 그것 하나만");
ok((await holdOf(M) || {}).ok === true, "승인은 남음(전송량 상한)");
r = await once();
run = await lastRun();
eq([r.status, run.k2h], ["ok", 2], "승인 뒤 나머지 진행");
eq(await holdOf(M), null, "끝까지 맞춘 회차에서 보류 풀림");

/* 19-1. 서버만 보류(에이전트가 hello 의 한도로 센 수는 한도 안) — 실행 중 put 이 'held': 그 자리에서 멈춤 · 확인까지 끝난 올리기는 등록 · 끝 보고 held:true · 보류는 승인 전 그대로 */
await admin("select public.semis_logi_ksync_settings($1::jsonb)", [JSON.stringify({ mass_limit: { files: 200, ratio: 0.3 } })]);
const T6 = Date.parse("2026-11-05T07:00:00Z");
write("a.xlsx", "A4", T6); write("t.pdf", "T3", T6); write("v.pdf", "V3", T6);
let lowered = false;
hook.onRpc = async (act) => {     // hello 뒤 · 첫 put 직전에 한도를 낮춤(그 사이 관리자가 바꾼 것과 같음)
  if (act === "put" && !lowered) { lowered = true; await db.query("update semis_logi_private.ksync_state set mass_limit = mass_limit || '{\"files\": 1}'::jsonb"); }
};
r0 = rpcLog.length;
const nHold2 = await events("mass_hold"), nObj3 = objects.size;
r = await once();
hook.onRpc = null;
const puts6 = since(rpcLog, r0, x => x.act === "put"), aps6 = since(rpcLog, r0, x => x.act === "put_apply");
eq([r.status, lowered, puts6.map(x => x.res && (x.res.ok ? "ok" : x.res.error))], ["held", true, ["ok", "held"]], "서버 보류 → 두 번째 put 에서 멈춤(세 번째는 시작하지 않음)");
eq([aps6.length, aps6.map(x => Object.keys(x.res.docs || {}))], [1, [[puts6[0].res.path]]], "확인까지 끝난 첫 올리기는 등록");
eq(objects.size, nObj3 + 1, "저장소에는 등록한 것 하나만");
const em6 = endOf(r0).p.maps.find(x => x.id === M);
eq([endOf(r0).p.result, em6.held, em6.done], ["held", true, false], "끝 보고 held:true · done:false");
const hd6 = await holdOf(M);
ok(hd6 && hd6.srv === true && !hd6.ok, "보류는 승인 전 그대로 " + JSON.stringify(hd6));
eq(await events("mass_hold"), nHold2 + 1, "mass_hold 기록");
r = await once();
eq([r.status, (await holdOf(M)).ok], ["held", undefined], "승인 전 다음 실행도 보류(보류가 지워지지 않음)");
await admin("select public.semis_logi_ksync_hold($1::jsonb)", [JSON.stringify({ run_id: String(hd6.run), act: "approve" })]);
r = await once();
eq([r.status, (await lastRun()).k2h, await holdOf(M)], ["ok", 2, null], "승인 뒤 나머지 둘 진행 · 보류 풀림");
await db.query("update semis_logi_private.ksync_state set mass_limit = '{\"files\": 200, \"ratio\": 0.3, \"min\": 20}'::jsonb");

/* 19-2. K 에서 지운 뒤(삭제 대기) H 가 새 판을 만듦 — 고친 것이 삭제 대기보다 우선: 다음 실행이 H 판을 K 로 받고, 그 전에 [삭제 확정]해도 H 판을 지우지 않음 */
const T0b = Date.parse("2026-11-01T00:00:00Z");
const delK = async (rel, body) => {
  write(rel, body, T0b);
  await once();
  const row = (await rowsOf(M)).find(x => x.rel_path === rel);
  fs.rmSync(K(rel));
  await once();
  eq((await rowById(row.id))?.state, "del_k", rel + " K 에서 지움 → 삭제 대기");
  return row;
};
const serDocs = async (ser) => (await docs()).filter(d => (d.ser || d.id) === ser);
const e0Row = await delK("e0.pdf", "E0");
putObj("docs/e0e0e0e0e0e1_e0-rev.pdf", "E0-H");
D = await docs();
D.unshift({ id: "e0H", mod: "audit", grp: "checklist", title: "e0", date: "2026-11-05", ser: e0Row.ser, files: [{ name: "e0-개정.pdf", size: 4, url: PUB + "docs/e0e0e0e0e0e1_e0-rev.pdf" }], at: "2026-11-05T09:00:00.000Z" });
await setDocs(D);
r = await once();
let e0 = await rowById(e0Row.id);
eq([r.status, has("e0-개정.pdf") && read("e0-개정.pdf"), e0?.state, e0?.rel_path, e0?.h_url, (await serDocs(e0Row.ser)).map(d => d.id).includes("e0H")],
  ["ok", "E0-H", "ok", "e0-개정.pdf", PUB + "docs/e0e0e0e0e0e1_e0-rev.pdf", true], "#0 삭제 대기 중 H 새 판(다른 이름) → K 로 받음 · 같은 줄 · 대기 풀림");
// 확정이 다음 실행보다 먼저 — 서버가 지금 판에 기준선 파일이 없음을 보고 지우지 않는다
const e1Row = await delK("e1.pdf", "E1");
putObj("docs/e1e1e1e1e1e2_e1.pdf", "E1-H");
D = await docs();
D.unshift({ id: "e1H", mod: "audit", grp: "checklist", title: "e1", date: "2026-11-05", ser: e1Row.ser, files: [{ name: "e1.pdf", size: 4, url: PUB + "docs/e1e1e1e1e1e2_e1.pdf" }], at: "2026-11-05T09:00:00.000Z" });
await setDocs(D);
const rs1 = await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [e1Row.id], act: "confirm" })]);
let e1 = await rowById(e1Row.id);
eq([rs1.kept, e1?.state, e1?.note, (await serDocs(e1Row.ser)).map(d => d.id).sort()], [1, "conflict", "H 에 새 판", [e1Row.doc_id, "e1H"].sort()],
  "#0 확정 전에 H 가 같은 이름으로 새 판 → 지우지 않고 충돌('H 에 새 판') · 판 모두 남음");
r = await once();
e1 = await rowById(e1Row.id);
eq([r.status, has("e1.pdf") && read("e1.pdf"), e1?.state, e1?.h_url], ["ok", "E1-H", "ok", PUB + "docs/e1e1e1e1e1e2_e1.pdf"], "#0 다음 실행이 H 새 판을 K 로");
// 이 연결(SSI 아님)이 볼 수 없는 민감보안정보 새 판 — 계획은 판단하지 않고(대기 그대로), 확정해도 서버가 지우지 않음
const e2Row = await delK("e2.pdf", "E2");
putObj("docs-ssi/e2e2e2e2e2e3_e2.pdf", "E2-S");
D = await docs();
D.unshift({ id: "e2H", mod: "audit", grp: "checklist", title: "e2", date: "2026-11-05", ser: e2Row.ser, ssi: true, files: [{ name: "e2.pdf", size: 4, url: PUB + "docs-ssi/e2e2e2e2e2e3_e2.pdf" }], at: "2026-11-05T09:00:00.000Z" });
await setDocs(D);
r = await once();
eq([r.status, (await rowById(e2Row.id))?.state, has("e2.pdf")], ["ok", "del_k", false], "#0 H 새 판이 민감보안정보 → K 로 받지 않음 · 대기 그대로");
const rs2 = await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [e2Row.id], act: "confirm" })]);
let e2 = await rowById(e2Row.id);
eq([rs2.kept, e2?.state, e2?.note, (await serDocs(e2Row.ser)).map(d => d.id).includes("e2H")], [1, "conflict", "H 에 새 판", true], "#0 민감보안정보 새 판 → 확정해도 지우지 않음(충돌)");
r = await once();
e2 = await rowById(e2Row.id);
eq([r.status, e2?.state, e2?.note, has("e2.pdf"), (await serDocs(e2Row.ser)).map(d => d.id).includes("e2H")], ["ok", "skip", "ssi", false, true], "#0 다음 실행: 건너뜀(ssi) · K 에 쓰지 않음 · H 판 남음");
// 같은 판(같은 주소)에 H 사용자가 민감보안정보를 켬 — 지금 판에 기준선 파일이 그대로 있어도 이 연결이 볼 수 없는 판은 지우지 않음
const e3Row = await delK("e3.pdf", "E3");
D = await docs();
D.find(d => d.id === e3Row.doc_id).ssi = true;
await setDocs(D);
const rs3 = await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [e3Row.id], act: "confirm" })]);
eq([rs3.kept, (await rowById(e3Row.id))?.state, (await serDocs(e3Row.ser)).map(d => d.id + ":" + d.files[0]?.url)], [1, "conflict", [e3Row.doc_id + ":" + e3Row.h_url]],
  "#0 같은 판을 민감보안정보로 바꿈 → 확정해도 지우지 않음(충돌)");
// K→H 만인 연결 — K 에서 지운 뒤 H 새 판은 K 로 받지 않고 대기 그대로. [복원]하면 지금 판(H 새 판)을 K 로 받음
// (서버가 기준선 주소만 보고 거절하면 그 줄은 오류가 되고 다음 실행부터 건너뜀(dir)이라 다시 복원할 수 없다)
const e4Row = await delK("e4.pdf", "E4");
await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ id: M, dir: "k2h" })]);
putObj("docs/e4e4e4e4e4e5_e4.pdf", "E4-H");
D = await docs();
D.unshift({ id: "e4H", mod: "audit", grp: "checklist", title: "e4", date: "2026-11-05", ser: e4Row.ser, files: [{ name: "e4.pdf", size: 4, url: PUB + "docs/e4e4e4e4e4e5_e4.pdf" }], at: "2026-11-05T09:00:00.000Z" });
await setDocs(D);
r = await once();
eq([r.status, (await rowById(e4Row.id))?.state, has("e4.pdf")], ["ok", "del_k", false], "K→H 만 · K 에서 지운 뒤 H 새 판 → K 로 받지 않음 · 대기 그대로");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [e4Row.id], act: "restore" })]);
r = await once();
const e4 = await rowById(e4Row.id);
eq([r.status, has("e4.pdf") && read("e4.pdf"), e4?.state, e4?.h_url], ["ok", "E4-H", "ok", PUB + "docs/e4e4e4e4e4e5_e4.pdf"], "K→H 만 · [복원] → 지금 판(H 새 판)을 K 로 받음 · 정상으로");
await db.query("update semis_logi_private.ksync_maps set dir = 'both' where id = $1", [M]);     // 양쪽으로 되돌리기는 미리보기(recon)가 있어야 함(v1.72) — 방향만 잠시 바꾼 시험이라 표에서 바로

/* 19-3. H 에서 지운 뒤(삭제 대기) K 에서 고침 → H 로 다시 올림(대기 풀림) · 삭제 확정 뒤 K 에서 고침 → 휴지통으로 옮기지 않고 H 로 올려 충돌로 */
const delH = async (rel, body) => {
  write(rel, body, T0b);
  await once();
  const row = (await rowsOf(M)).find(x => x.rel_path === rel);
  await setDocs((await docs()).filter(d => (d.ser || d.id) !== row.ser));
  await once();
  eq((await rowById(row.id))?.state, "del_h", rel + " H 에서 지움 → 삭제 대기");
  return row;
};
const f1Row = await delH("f1.pdf", "F1");
write("f1.pdf", "F1-K", Date.parse("2026-11-05T09:00:00Z"));
r = await once();
const f1 = await rowById(f1Row.id);
const f1Doc = (await docs()).find(d => d.id === f1?.doc_id);
eq([r.status, f1?.state, f1Doc && objText(f1Doc.files[0].url), read("f1.pdf")], ["ok", "ok", "F1-K", "F1-K"], "#1 삭제 대기 중 K 수정 → H 로 다시 올림 · 대기 풀림");
const f2Row = await delH("f2.pdf", "F2");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [f2Row.id], act: "confirm" })]);
eq((await rowById(f2Row.id))?.state, "trash", "#1 삭제 확정 → 휴지통 대기");
write("f2.pdf", "F2-K", Date.parse("2026-11-05T09:00:00Z"));
r = await once();
const f2 = await rowById(f2Row.id);
const f2Doc = (await docs()).find(d => d.id === f2?.doc_id);
eq([r.status, has("f2.pdf") && read("f2.pdf"), kFiles("_H드라이브_휴지통").filter(f => /f2/.test(f)), f2?.state, f2?.note, f2Doc && objText(f2Doc.files[0].url)],
  ["ok", "F2-K", [], "conflict", "K 에서 고친 뒤 삭제 확정", "F2-K"], "#1 확정 뒤 K 수정 → 휴지통으로 옮기지 않음 · H 로 올리고 충돌로");
// H→K 만인 연결 — K 수정을 H 로 보낼 수 없어 휴지통에 넣으면 업무 폴더에서 사라진다: K 에 남기고 기준선만 지움(다음 실행부터 할 일 없음)
const f3Row = await delH("f3.pdf", "F3");
await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ id: M, dir: "h2k" })]);
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [f3Row.id], act: "confirm" })]);
write("f3.pdf", "F3-K", Date.parse("2026-11-05T09:00:00Z"));
r = await once();
eq([r.status, has("f3.pdf") && read("f3.pdf"), kFiles("_H드라이브_휴지통").filter(f => /f3/.test(f)), await rowById(f3Row.id), (await lastRun()).detail.filter(d => d.f === "f3.pdf").map(d => d.a + ":" + d.r)],
  ["ok", "F3-K", [], undefined, ["skip:K 에서 고친 뒤 삭제 확정 · K 에 남김"]], "#1 H→K 만 · 확정 뒤 K 수정 → 휴지통으로 옮기지 않고 K 에 남김 · 기준선만 지움");
r = await once();
eq([r.status, (await lastRun()).detail.filter(d => d.f === "f3.pdf").length, has("f3.pdf") && read("f3.pdf")], ["ok", 0, "F3-K"], "#1 H→K 만 · 다음 실행: 할 일 없음(삭제 대기를 되풀이하지 않음)");
fs.rmSync(K("f3.pdf"));
await db.query("update semis_logi_private.ksync_maps set dir = 'both' where id = $1", [M]);     // 양쪽으로 되돌리기는 미리보기(recon)가 있어야 함(v1.72) — 방향만 잠시 바꾼 시험이라 표에서 바로

/* 19-4. 첨부 둘 중 하나를 H 가 뺀 판 — K 가 뺀 첨부를 고치거나 [복원]해도, 첨부 하나뿐인 지금 판의 남은 첨부(다른 줄이 맞춤)를 바꾸지 않고 뒤에 더함 */
const twoAtt = async (id, a, b) => {
  putObj("docs/" + id + "aaaaaaaaa_" + a, a.toUpperCase()); putObj("docs/" + id + "bbbbbbbbb_" + b, b.toUpperCase());
  D = await docs();
  D.push({ id, mod: "audit", grp: "checklist", title: "첨부 둘 " + id, date: "2026-11-01", files: [{ name: a, size: a.length, url: PUB + "docs/" + id + "aaaaaaaaa_" + a }, { name: b, size: b.length, url: PUB + "docs/" + id + "bbbbbbbbb_" + b }], at: "2026-11-01T00:00:00.000Z" });
  await setDocs(D);
  r = await once();
  eq([r.status, read(a), read(b)], ["ok", a.toUpperCase(), b.toUpperCase()], id + " 첨부마다 K 파일");
  const rows2 = (await rowsOf(M)).filter(x => x.ser === id);
  // H 가 a 를 뺀 새 판(b 는 같은 주소)
  D = await docs();
  D.unshift({ id: id + "2", mod: "audit", grp: "checklist", title: "첨부 둘 " + id, date: "2026-11-02", ser: id, files: [{ name: b, size: b.length, url: PUB + "docs/" + id + "bbbbbbbbb_" + b }], at: "2026-11-02T00:00:00.000Z" });
  await setDocs(D);
  return { ra: rows2.find(x => x.rel_path === a), rb: rows2.find(x => x.rel_path === b) };
};
const curNames = async (ser) => { const c = (await serDocs(ser))[0]; return [c?.files.map(f => f.name), c?.files.map(f => objText(f.url))]; };
let tw = await twoAtt("dg", "g1.pdf", "g2.pdf");
write("g1.pdf", "G1-K", Date.parse("2026-11-05T10:00:00Z"));
r = await once();
eq([r.status, ...(await curNames("dg")), (await serDocs("dg"))[0]?.files[0]?.url], ["ok", ["g2.pdf", "g1.pdf"], ["G2.PDF", "G1-K"], tw.rb.h_url], "#2 H 가 g1 을 뺀 판에 K 가 g1 을 고침 → g2 는 그대로 · g1 은 뒤에 더함");
r = await once();
eq([r.status, (await lastRun()).detail.filter(d => /^g[12]\.pdf$/.test(d.f)).map(d => d.a), (await rowById(tw.rb.id))?.state, (await rowById(tw.rb.id))?.h_url, read("g2.pdf")],
  ["ok", [], "ok", tw.rb.h_url, "G2.PDF"], "#2 다음 실행: g2 'H 에서 지움' 없음 · 할 일 없음");
tw = await twoAtt("dj", "j1.pdf", "j2.pdf");
r = await once();
eq((await rowById(tw.ra.id))?.state, "del_h", "#2 H 가 뺀 j1 → 삭제 대기");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [tw.ra.id], act: "restore" })]);
r = await once();
eq([r.status, ...(await curNames("dj")), (await rowById(tw.ra.id))?.state], ["ok", ["j2.pdf", "j1.pdf"], ["J2.PDF", "J1.PDF"], "ok"], "#2 [복원] → j2 는 그대로 · j1 은 뒤에 더함");
r = await once();
eq([r.status, (await lastRun()).detail.filter(d => /^j[12]\.pdf$/.test(d.f)).map(d => d.a), (await rowById(tw.rb.id))?.state, read("j2.pdf")], ["ok", [], "ok", "J2.PDF"], "#2 다음 실행: j2 'H 에서 지움' 없음");

/* 19-5. 계획한 뒤 · 등록 직전에 H 가 새 판을 만듦 — K 판으로 덮지 않음(등록 안 함 · 그 줄 오류) · 다음 실행이 '양쪽 다 바뀜'으로 충돌 규칙을 탐(두 내용 모두 남음) */
write("w5.pdf", "W5", T0b);
await once();
const w5Row = (await rowsOf(M)).find(x => x.rel_path === "w5.pdf");
write("w5.pdf", "W5-K", Date.parse("2026-11-05T11:00:00Z"));
putObj("docs/w5w5w5w5w5w6_w5.pdf", "W5-H");
let w5Added = false;
hook.onRpc = async (act) => {
  if (act !== "put_apply" || w5Added) return;
  w5Added = true;
  const DD = await docs();
  DD.unshift({ id: "w5H", mod: "audit", grp: "checklist", title: "w5", date: "2026-11-05", ser: w5Row.ser, files: [{ name: "w5.pdf", size: 4, url: PUB + "docs/w5w5w5w5w5w6_w5.pdf" }], at: "2026-11-05T10:00:00.000Z" });
  await setDocs(DD);
};
r = await once();
hook.onRpc = null;
eq([r.status, w5Added, (await serDocs(w5Row.ser)).map(d => d.id + ":" + objText(d.files[0].url)), (await rowById(w5Row.id))?.state, read("w5.pdf")],
  ["partial", true, ["w5H:W5-H", w5Row.doc_id + ":W5"], "error", "W5-K"], "#5 등록 직전 H 새 판 → K 판으로 덮지 않음 · 그 줄 오류 · K 그대로");
r = await once();
const w5Cf = "w5 (충돌 " + TODAY + ").pdf";
const w5All = await serDocs(w5Row.ser);
eq([r.status, objText(w5All[0]?.files[0]?.url), w5All.map(d => d.id).includes("w5H"), read("w5.pdf"), has(w5Cf) && read(w5Cf), (await rowById(w5Row.id))?.state],
  ["ok", "W5-K", true, "W5-K", "W5-H", "conflict"], "#5 다음 실행: 양쪽 다 바뀜(K 가 늦음) → K 판이 현재 판 · H 판은 이전 판 · K 에 H 쪽 사본");
// 양쪽 다 바뀜(K 가 늦음)인데 등록 직전에 H 가 또 새 판 — 그 판을 K 판으로 덮지 않음(덮으면 K 사본도 충돌 표시도 없이 이전 판으로 밀림).
// 다음 실행이 다시 충돌 규칙을 탐(이번엔 H 가 늦음) — 세 내용 모두 남음
write("y5.pdf", "Y5", T0b);
await once();
const y5Row = (await rowsOf(M)).find(x => x.rel_path === "y5.pdf");
write("y5.pdf", "Y5-K", Date.parse("2026-11-05T11:00:00Z"));
putObj("docs/y5y5y5y5y5y6_y5.pdf", "Y5-H2"); putObj("docs/y5y5y5y5y5y7_y5.pdf", "Y5-H3");
D = await docs();
D.unshift({ id: "y5H2", mod: "audit", grp: "checklist", title: "y5", date: "2026-11-05", ser: y5Row.ser, files: [{ name: "y5.pdf", size: 5, url: PUB + "docs/y5y5y5y5y5y6_y5.pdf" }], at: "2026-11-05T10:00:00.000Z" });
await setDocs(D);
let y5Added = false;
hook.onRpc = async (act) => {
  if (act !== "put_apply" || y5Added) return;
  y5Added = true;
  const DD = await docs();
  DD.unshift({ id: "y5H3", mod: "audit", grp: "checklist", title: "y5", date: "2026-11-05", ser: y5Row.ser, files: [{ name: "y5.pdf", size: 5, url: PUB + "docs/y5y5y5y5y5y7_y5.pdf" }], at: "2026-11-05T12:00:00.000Z" });
  await setDocs(DD);
};
r = await once();
hook.onRpc = null;
const y5Cf = "y5 (충돌 " + TODAY + ").pdf", y5Cf2 = "y5 (충돌 " + TODAY + " 2).pdf";
eq([r.status, y5Added, (await serDocs(y5Row.ser))[0]?.id, (await rowById(y5Row.id))?.state, read("y5.pdf"), has(y5Cf) && read(y5Cf)],
  ["partial", true, "y5H3", "error", "Y5-K", "Y5-H2"], "K 가 이긴 충돌 · 등록 직전 H 가 또 새 판 → K 판으로 덮지 않음 · 그 줄 오류 · K 에 계획 때 H 쪽 사본");
r = await once();
const y5All = await serDocs(y5Row.ser);
eq([r.status, read("y5.pdf"), has(y5Cf2) && read(y5Cf2), objText(y5All[0]?.files[0]?.url), y5All.some(d => objText(d.files[0]?.url) === "Y5-K"), (await rowById(y5Row.id))?.state],
  ["ok", "Y5-H3", "Y5-K", "Y5-H3", true, "conflict"], "다음 실행: H 가 늦음 → H 새 판을 K 로 · K 판은 H 이전 판 · K 는 사본 — 세 내용 모두 남음");

/* 19-6. 승인한 보류는 승인한 만큼만 — 보류 때 센 수 + 한도보다 많이 바뀌면 승인을 버리고 새 보류 · mass_hold 기록 · 전송 없음 */
const H16 = ["h16a", "h16b", "h16c", "h16d", "h16e", "h16f"].map(n => n + ".pdf");
H16.forEach(n => write(n, n, T0b));
r = await once();
eq(r.status, "ok", "#16 새 파일 6건(새 문서는 변경으로 세지 않음)");
await admin("select public.semis_logi_ksync_settings($1::jsonb)", [JSON.stringify({ mass_limit: { files: 2, ratio: 0.3 } })]);
const T16 = Date.parse("2026-11-05T12:00:00Z");
H16.slice(0, 3).forEach(n => write(n, n + "-2", T16));
const nEv16 = await events("mass_hold"), nObj16 = objects.size;
r = await once();
const hold16 = await holdOf(M);
eq([r.status, objects.size, hold16 && hold16.n, hold16 && hold16.ok], ["held", nObj16, 3, undefined], "#16 3건 > 한도 2 → 보류");
await admin("select public.semis_logi_ksync_hold($1::jsonb)", [JSON.stringify({ run_id: String(hold16.run), act: "approve" })]);
H16.forEach(n => write(n, n + "-3", T16 + 60e3));
r = await once();
const hold16b = await holdOf(M);
eq([r.status, objects.size, hold16b && hold16b.ok, hold16b && hold16b.n, String(hold16b && hold16b.run) !== String(hold16.run), await events("mass_hold")],
  ["held", nObj16, undefined, 6, true, nEv16 + 2], "#16 승인(3건) 뒤 6건 > 3 + 한도 2 → 승인을 버리고 새 보류 · mass_hold 기록 · 전송 없음");
await admin("select public.semis_logi_ksync_hold($1::jsonb)", [JSON.stringify({ run_id: String(hold16b.run), act: "approve" })]);
r = await once();
eq([r.status, (await lastRun()).k2h, await holdOf(M), H16.map(n => read(n))], ["ok", 6, null, H16.map(n => n + "-3")], "#16 새 보류 승인 → 6건 진행 · 보류 풀림");
// H 가 첨부를 뺀 판 묶음의 남은 줄을 K 가 고침 — '새 문서'로 보내도 서버가 새 판으로 센다. 계획도 같이 세어 보류 때 센 수가 서버가 셀 몫을 덮으므로
// 승인 한 번이면 끝남(덜 세면 승인한 뒤에도 서버가 다시 보류 — 승인 한 번에 한도만큼씩만 지나감)
const A16 = ["a16-0", "a16-1", "a16-2", "a16-3", "a16-4", "a16-5"].map(n => n + ".pdf");
A16.forEach((n, i) => putObj("docs/a16a16a16a1" + i + "_" + n, "A16-" + i));
D = await docs();
D.push({ id: "d16", mod: "audit", grp: "checklist", title: "첨부 여섯", date: "2026-11-01", files: A16.map((n, i) => ({ name: n, size: 5, url: PUB + "docs/a16a16a16a1" + i + "_" + n })), at: "2026-11-01T00:00:00.000Z" });
await setDocs(D);
r = await once();
eq([r.status, A16.map(n => has(n) && read(n)), await holdOf(M)], ["ok", A16.map((n, i) => "A16-" + i), null],
  "#16 첨부 여섯인 새 문서 → K 로(한도 2 — 앞 첨부를 받아 생긴 기준선 줄로 뒤 첨부를 덮어쓰기로 세지 않음)");
D = await docs();
D.unshift({ id: "d16b", mod: "audit", grp: "checklist", title: "첨부 여섯", date: "2026-11-02", ser: "d16", files: [D.find(d => d.id === "d16").files[0]], at: "2026-11-02T00:00:00.000Z" });
await setDocs(D);
A16.slice(1).forEach(n => write(n, n + "-K", T16 + 120e3));
const nObj16c = objects.size;
r = await once();
const hold16c = await holdOf(M);
eq([r.status, objects.size, hold16c && hold16c.n, hold16c && hold16c.ok], ["held", nObj16c, 5, undefined], "#16 H 가 뺀 첨부 다섯을 K 가 고침 → 계획이 다섯으로 세어 보류(한도 2) · 전송 없음");
await admin("select public.semis_logi_ksync_hold($1::jsonb)", [JSON.stringify({ run_id: String(hold16c.run), act: "approve" })]);
r = await once();
const cur16 = (await serDocs("d16"))[0];
eq([r.status, (await lastRun()).k2h, await holdOf(M), cur16 && cur16.files.map(f => objText(f.url))], ["ok", 5, null, ["A16-0", ...A16.slice(1).map(n => n + "-K")]],
  "#16 승인 한 번 → 다섯 모두 진행(서버가 다시 보류하지 않음) · 남은 첨부는 그대로 · 고친 첨부는 뒤에 더함 · 보류 풀림");
await db.query("update semis_logi_private.ksync_state set mass_limit = '{\"files\": 200, \"ratio\": 0.3, \"min\": 20}'::jsonb");

/* 19-6-1. 작은 연결(K 파일 3)에 첨부 25개인 새 H 문서 하나 — 기본 한도(최소 20건 · 30%)를 넘을 만큼 많아도 새 문서는 덮어쓰기가 아니라 보류하지 않음.
   서버가 앞 첨부를 받아 생긴 기준선 줄로 뒤 첨부를 덮어쓰기로 세면 계획은 0 인데 서버만 보류한다 */
const NM = path.join(MOUNT, "업무", "첨부많음");
const inNM = (n) => fs.existsSync(path.join(NM, n));
fs.mkdirSync(NM, { recursive: true });
["n1.pdf", "n2.pdf", "n3.pdf"].forEach(n => { fs.writeFileSync(path.join(NM, n), n); fs.utimesSync(path.join(NM, n), T0b / 1000, T0b / 1000); });
const M4 = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "업무/첨부많음", mod: "audit", grp: "many" })])).id;
await once();
await admin("select public.semis_logi_ksync_map_start($1)", [M4]);
r = await once();
eq([r.status, (await rowsOf(M4)).length, await holdOf(M4)], ["ok", 3, null], "작은 연결 첫 동기화(K 파일 3) · 시작 승인 씀");
const N25 = Array.from({ length: 25 }, (_, i) => "many-" + String(i + 1).padStart(2, "0") + ".pdf");
N25.forEach((n, i) => putObj("docs/many" + String(i).padStart(8, "0") + "_" + n, "N" + i));
D = await docs();
D.push({ id: "dmany", mod: "audit", grp: "many", title: "첨부 많음", date: "2026-11-05",
  files: N25.map((n, i) => ({ name: n, size: 3, url: PUB + "docs/many" + String(i).padStart(8, "0") + "_" + n })), at: "2026-11-05T00:00:00.000Z" });
await setDocs(D);
const nMH4 = await events("mass_hold");
r = await once();
eq([r.status, await holdOf(M4), await events("mass_hold") - nMH4, N25.filter(inNM).length, (await rowsOf(M4)).length], ["ok", null, 0, 25, 28],
  "G2 첨부 25개인 새 문서 → 보류 없이 모두 K 로(서버도 덮어쓰기로 세지 않음 — 계획과 같음)");
// 맞춘 판 묶음의 지금 판에 주소가 맞는 파일이 없음(첨부 없는 새 판 · 저장소 밖 주소) — 계획에는 H 목록에 없어 H 에서 지운 것과 같다.
// 그 사이 K 가 고친 것은 새 판으로 올리지만(맨 앞 — 지금 판) 계획도 서버도 변경으로 세지 않는다
const n4 = (await rowsOf(M4)).filter(x => /^n\d\.pdf$/.test(x.rel_path));
D = await docs();
n4.forEach((x, i) => D.unshift({ id: "dn" + i, mod: "audit", grp: "many", title: "빈 판", date: "2026-11-05", ser: x.ser,
  files: i === 1 ? [{ name: x.rel_path, size: 3, url: "https://other.example/" + x.rel_path }] : [], at: "2026-11-05T00:00:00.000Z" }));
await setDocs(D);
await admin("select public.semis_logi_ksync_settings($1::jsonb)", [JSON.stringify({ mass_limit: { files: 2, ratio: 0.3 } })]);
const T41 = Date.parse("2026-11-06T00:00:00Z");
n4.forEach(x => { fs.writeFileSync(path.join(NM, x.rel_path), x.rel_path + "-K"); fs.utimesSync(path.join(NM, x.rel_path), T41 / 1000, T41 / 1000); });
const nMH4b = await events("mass_hold");
r = await once();
const cur4 = await Promise.all(n4.map(async x => objText((await serDocs(x.ser))[0]?.files[0]?.url)));
eq([r.status, await holdOf(M4), await events("mass_hold") - nMH4b, cur4], ["ok", null, 0, n4.map(x => x.rel_path + "-K")],
  "G2 지금 판에 주소가 맞는 파일이 없는 판 묶음 셋을 K 가 고침(한도 2) → 보류 없이 새 판(지금 판)으로");
await db.query("update semis_logi_private.ksync_state set mass_limit = '{\"files\": 200, \"ratio\": 0.3, \"min\": 20}'::jsonb");
await admin("select public.semis_logi_ksync_map_delete($1)", [M4]);

/* 19-6-2. 지난 실행이 못 보낸 기준선 표시(판 묶음 바뀜)를 다음 실행이 먼저 보냄 — 서버도 덮어쓰기로 셀 판 묶음을 그 뒤 기준선으로 다시 잡는다.
   회차 시작 때 것으로 세면 옛 판 묶음에 생긴 판(계획에는 기준선 줄이 없는 H 문서)의 첨부 25개를 서버만 덮어쓰기로 세어 보류한다 */
const MV = path.join(MOUNT, "업무", "옮김");
const inMV = (n) => fs.existsSync(path.join(MV, n));
fs.mkdirSync(MV, { recursive: true });
["o1.pdf", "o2.pdf", "o3.pdf"].forEach(n => { fs.writeFileSync(path.join(MV, n), n); fs.utimesSync(path.join(MV, n), T0b / 1000, T0b / 1000); });
const M5 = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "업무/옮김", mod: "audit", grp: "moved" })])).id;
await once();
await admin("select public.semis_logi_ksync_map_start($1)", [M5]);
r = await once();
const o1 = (await rowsOf(M5)).find(x => x.rel_path === "o1.pdf");
eq([r.status, (await rowsOf(M5)).length, !!o1], ["ok", 3, true], "G2 연결 첫 동기화(K 파일 3)");
D = await docs();
D.find(d => d.id === o1.doc_id).ser = "옮긴 곳";
await setDocs(D);
let o1Lost = 0;
hook.failRpc = (act, p) => act === "mark" && (p.items || []).some(i => i.op === "set" && String(i.id) === String(o1.id)) && o1Lost++ === 0;
r = await once();
hook.failRpc = null;
eq([r.status, o1Lost, (await rowById(o1.id))?.ser], ["fail", 1, o1.ser], "G2 H 가 o1 문서를 다른 판 묶음으로 옮김 → 다시 잇는 표시를 못 보냄 · 실행 멈춤 · 기준선은 옛 판 묶음");
const O25 = Array.from({ length: 25 }, (_, i) => "old-" + String(i + 1).padStart(2, "0") + ".pdf");
O25.forEach((n, i) => putObj("docs/oldser" + String(i).padStart(6, "0") + "_" + n, "O" + i));
D = await docs();
D.push({ id: "dold25", mod: "audit", grp: "moved", title: "옛 묶음", date: "2026-11-05", ser: o1.ser,
  files: O25.map((n, i) => ({ name: n, size: ("O" + i).length, url: PUB + "docs/oldser" + String(i).padStart(6, "0") + "_" + n })), at: "2026-11-05T00:00:00.000Z" });
await setDocs(D);
const nMH5 = await events("mass_hold");
r = await once();
eq([r.status, (await rowById(o1.id))?.ser, await holdOf(M5), await events("mass_hold") - nMH5, O25.filter(inMV).length], ["ok", "옮긴 곳", null, 0, 25],
  "G2 다음 실행: 남긴 표시를 먼저 보내 옮긴 판 묶음으로 이음 → 옛 판 묶음 판의 첨부 25개는 보류 없이 K 로(서버도 다시 받은 기준선으로 셈 — 계획과 같음)");
await admin("select public.semis_logi_ksync_map_delete($1)", [M5]);

/* 19-7. K 로 쓰지 않는 형식(탐색기에서 폴더를 보기만 해도 밖으로 접속하는 .scf) — 받으러 가지 않음 · 차단 기록 · 서버도 거절 */
putObj("docs/scfscfscfscf_x.scf", "[Shell]");
D = await docs();
D.push({ id: "dscf", mod: "audit", grp: "checklist", title: "바로 가기", date: "2026-11-05", files: [{ name: "x.scf", size: 7, url: PUB + "docs/scfscfscfscf_x.scf" }] });
await setDocs(D);
const scfEv = () => one("select count(*)::int from semis_logi_private.ksync_events where kind = 'type_block' and detail ->> 'f' = 'x.scf'");
const nTb = await scfEv();
let srvGet = null, agentGets = -1;
hook.onRpc = async (act, p) => {     // 회차가 열려 있는 동안(끝 보고 직전) 같은 키로 그 파일을 직접 달라고 해 본다
  if (act !== "run" || p.phase !== "end") return;
  hook.onRpc = null;
  agentGets = since(rpcLog, r0, x => x.act === "get" && x.p.doc === "dscf").length;
  const res = await realFetch(BASE + FN, { method: "POST", headers: { "content-type": "application/json", "x-ksync-key": KEY },
    body: JSON.stringify({ act: "get", run: p.run, map: M, doc: "dscf", url: PUB + "docs/scfscfscfscf_x.scf" }) });
  srvGet = [res.status, (await res.json()).error];
};
r0 = rpcLog.length;
r = await once();
hook.onRpc = null;
eq([r.status, has("x.scf"), agentGets, (await lastRun()).detail.filter(d => d.f === "x.scf").map(d => d.a + ":" + d.r), srvGet, await scfEv() - nTb],
  ["ok", false, 0, ["skip:type_block"], [415, "type"], 1], "#3 .scf → 에이전트는 받으러 가지 않음(차단 기록 한 번) · 서버도 거절(415) · K 에 없음");

/* 19-8. 미리보기 중 관리자가 설정을 고침 — 옛 설정으로 센 건수는 버리고 다시 셈 · 건수가 없으면 [시작] 거절 */
const PD = path.join(MOUNT, "업무", "미리보기");
fs.mkdirSync(PD, { recursive: true });
fs.writeFileSync(path.join(PD, "p1.pdf"), "P1");
const M3 = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "업무/미리보기", mod: "audit", grp: "plan" })])).id;
let changed9 = false;
hook.onRpc = async (act) => {     // 에이전트가 건수를 센 뒤 · 보내기 직전에 관리자가 방향을 바꿈
  if (act !== "preview" || changed9) return;
  changed9 = true;
  await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ id: M3, k_path: "업무/미리보기", mod: "audit", grp: "plan", dir: "k2h" })]);
};
r = await once();
hook.onRpc = null;
eq([r.status, changed9, await one("select preview from semis_logi_private.ksync_maps where id = $1", [M3]), await one("select requested_at is not null from semis_logi_private.ksync_state")],
  ["ok", true, null, true], "#9 센 뒤 설정이 바뀜 → 옛 건수 버림 · 다시 요청");
eq(await admin("select public.semis_logi_ksync_map_start($1)", [M3]), { ok: false, error: "preview" }, "#9 건수가 없으면 [시작] 거절");
r = await once();
const pv3 = await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [M3]);
eq([r.status, pv3 && pv3.k2h, pv3 && pv3.h2k, await one("select state from semis_logi_private.ksync_maps where id = $1", [M3])], ["ok", 1, 0, "preview"], "#9 다음 실행이 지금 설정으로 다시 셈");
await admin("select public.semis_logi_ksync_map_delete($1)", [M3]);

/* 19-9. 받아 놓은 파일의 기준선 표시를 서버가 받지 못함(서버 오류) — 실행은 멈추고 표시는 상태 파일에 남김 · 다음 실행이 계획 전에 먼저 보내 가짜 충돌 · 중복 판이 없음 */
write("x4.pdf", "X4", T0b);
await once();
const x4Row = (await rowsOf(M)).find(x => x.rel_path === "x4.pdf");
putObj("docs/x4x4x4x4x4x5_x4.pdf", "X4-H");
D = await docs();
D.unshift({ id: "x4H", mod: "audit", grp: "checklist", title: "x4", date: "2026-11-05", ser: x4Row.ser, files: [{ name: "x4.pdf", size: 4, url: PUB + "docs/x4x4x4x4x4x5_x4.pdf" }], at: "2026-11-05T09:00:00.000Z" });
await setDocs(D);
let x4Lost = 0;
hook.failRpc = (act, p) => act === "mark" && (p.items || []).some(i => i.op === "set" && i.rel_path === "x4.pdf") && x4Lost++ === 0;
r = await once();
hook.failRpc = null;
const marksOf = () => (JSON.parse(fs.readFileSync(STATE, "utf8")).marks || []).flatMap(k => k.items).filter(i => i.rel_path === "x4.pdf").map(i => i.op + ":" + i.h_url);
eq([r.status, x4Lost, read("x4.pdf"), (await rowById(x4Row.id))?.h_url, marksOf()], ["fail", 1, "X4-H", x4Row.h_url, ["set:" + PUB + "docs/x4x4x4x4x4x5_x4.pdf"]],
  "#4 표시를 못 보냄 → 실행 멈춤 · K 에는 받음 · 기준선 그대로 · 표시는 상태 파일에");
const nX4 = (await serDocs(x4Row.ser)).length;
r = await once();
const x4 = await rowById(x4Row.id);
eq([r.status, x4?.state, x4?.h_url, (await serDocs(x4Row.ser)).length, kFiles().filter(f => /^x4 \(충돌/.test(f)), marksOf()], ["ok", "ok", PUB + "docs/x4x4x4x4x4x5_x4.pdf", nX4, [], []],
  "#4 다음 실행: 남긴 표시를 먼저 보냄 → 가짜 충돌 · 중복 판 없음");

/* 19-10. 분당 상한 — 에이전트 시계로 어느 1분에도 서버가 세는 호출(Edge 안의 SQL 호출)이 PACE 이하.
   Edge · SQL 이 한 요청에 부르는 횟수가 에이전트가 셈하는 무게(확인 2 · 나머지 1)와 달라지면 실제 서버에서 'rate' 가 나기 전에 여기서 걸린다 */
const { PACE } = await import(pathToFileURL(path.join(REPO, "tools/ksync/lib.mjs")).href);
for (let i = 0; i < 85; i++) write("pace/p" + i + ".pdf", "P" + i, T0b);
let clk = NOW;
const stamps = [];
hook.onRpc = async () => { stamps.push(clk); };
r = await runAgent(Object.assign(deps(), { now: () => clk, sleep: async (ms) => { clk += ms; } }), { once: true });
hook.onRpc = null;
let maxWin = 0;
for (let i = 0, j = 0; i < stamps.length; i++) { while (stamps[j] <= stamps[i] - 60e3) j++; maxWin = Math.max(maxWin, i - j + 1); }
eq([r.status, stamps.length > PACE, clk - NOW >= 60e3, maxWin <= PACE, (await rowsOf(M)).filter(x => x.rel_path.startsWith("pace/")).length],
  ["ok", true, true, true, 85], "#6 1분에 PACE 넘게 부를 일 → 쉬어 감 · 어느 1분에도 서버가 세는 호출 " + maxWin + " ≤ " + PACE + "(모두 " + stamps.length + ")");

/* 19-11. v1.64 기준일 — 옛 · 새 파일이 섞인 폴더: 미리보기에 기준일 전 파일 수 → [시작] → 새 파일만 등록. 다른 연결 기준선과 해시가 같은 옛 파일(연결 폴더끼리 옮김)은 올림 ·
   옛 K 파일과 이름 · 크기가 같은 H 문서는 연결만 하지 않음 — 양쪽 미리보기면 그 H 문서가 '이름 (2)' 로 내려올 것이라 [시작]을 막음(v1.72 name2),
   K → H 만으로 바꿔 시작 · 옛 에이전트가 옛 파일을 보내도 서버(Edge 를 지나)가 'old' 로 거절 */
const SND = path.join(MOUNT, "업무", "기준일"), SN = Date.parse("2025-08-01T00:00:00+09:00");
const shaHex = (b) => crypto.createHash("sha256").update(b).digest("hex");
const sw = (n, s, t) => { fs.writeFileSync(path.join(SND, n), s); fs.utimesSync(path.join(SND, n), t / 1000, t / 1000); };
const sRead = (n) => { try { return fs.readFileSync(path.join(SND, n), "utf8"); } catch (e) { return null; } };
fs.mkdirSync(SND, { recursive: true });
const mvRow = (await rowsOf(M)).find(x => x.k_sha256 && has(x.rel_path) && shaHex(fs.readFileSync(K(x.rel_path))) === x.k_sha256);
sw("옛 보고.pdf", "OLD-1", SN - 30 * 864e5); sw("옛 양식.hwp", "OLD-22", SN - 1000); sw("새 보고.pdf", "NEW-1", SN + 864e5); sw("경계.pdf", "EDGE", SN);
sw("옮김.pdf", fs.readFileSync(K(mvRow.rel_path)), SN - 864e5);
D = await docs();
D.push({ id: "dsn", mod: "audit", grp: "since", title: "옛 양식", date: "2025-07-01", files: [{ name: "옛 양식.hwp", size: 6, url: PUB + "docs/snsnsnsnsnsn_old.hwp" }] });
await setDocs(D);
putObj("docs/snsnsnsnsnsn_old.hwp", "H-OLD!");
const MSD = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "업무/기준일", mod: "audit", grp: "since", since: "2025-08-01" })])).id;
r = await once();
const pvS = await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [MSD]);
eq([r.status, pvS && pvS.k2h, pvS && pvS.old, pvS && pvS.h2k, pvS && pvS.link, pvS && pvS.name2], ["ok", 3, 2, 1, 0, 1],
  "기준일 미리보기: 새 2 · 옮긴 옛 파일 1 올림 · 옛 2 뺌 · 이름 · 크기가 같은 H 문서는 연결만 아님(받기 — K 에 '이름 (2)' 1)");
eq([(await admin("select public.semis_logi_ksync_map_start($1)", [MSD])).error, await one("select state from semis_logi_private.ksync_maps where id = $1", [MSD]), sRead("옛 양식 (2).hwp")],
  ["dup", "preview", null], "양쪽 미리보기 · '이름 (2)' 1 → [시작] 거절(K 에 쓰지 않음)");
await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ id: MSD, dir: "k2h" })]);
r = await once();
await admin("select public.semis_logi_ksync_map_start($1)", [MSD]);
r = await once();
const dSN = (await docs()).filter(d => d.mod === "audit" && d.grp === "since" && d.src === "ksync").map(d => d.files[0].name).sort();
eq([r.status, dSN, (await rowsOf(MSD)).map(x => x.rel_path).sort(), sRead("옛 보고.pdf"), sRead("옛 양식.hwp"), sRead("옛 양식 (2).hwp")],
  ["ok", ["경계.pdf", "새 보고.pdf", "옮김.pdf"], ["경계.pdf", "새 보고.pdf", "옮김.pdf"], "OLD-1", "OLD-22", null],
  "K → H 만으로 [시작] 뒤 새 파일만 등록(기준일 0시 파일 포함 · 옮긴 옛 파일은 올림) · 옛 K 파일은 그대로(덮지 않음) · H 문서는 K 로 안 감");
eq(await one("select n_files from semis_logi_private.ksync_maps where id = $1", [MSD]), 3, "파일 수는 기준일 전 파일을 빼고");
r = await once();
eq([r.status, (await rowsOf(MSD)).length, (await docs()).filter(d => d.grp === "since").length], ["ok", 3, 4], "다시 실행해도 그대로(옛 파일은 계속 빠짐)");
const fnPost = async (b) => { const x = await realFetch(BASE + FN, { method: "POST", headers: { "content-type": "application/json", "x-ksync-key": KEY }, body: JSON.stringify(b) }); return [x.status, (await x.json()).error || "ok"]; };
const RSN = (await (await realFetch(BASE + FN, { method: "POST", headers: { "content-type": "application/json", "x-ksync-key": KEY }, body: JSON.stringify({ act: "run", phase: "start", trigger: "manual" }) })).json()).run;
const sndPut = { act: "put", phase: "begin", run: RSN, map: MSD, rel_path: "옛 보고.pdf", size: 5, sha256: shaHex("OLD-1"), mode: "new" };
eq([await fnPost(Object.assign({ mtime: new Date(SN - 30 * 864e5).toISOString() }, sndPut)), await fnPost(sndPut)], [[409, "old"], [409, "old"]],
  "옛 에이전트가 기준일 전 파일을 보내도(수정 시각을 빼도) 서버가 거절 — Edge 를 지나 'old'");
await fnPost({ act: "run", phase: "end", run: RSN, result: "ok" });
await admin("select public.semis_logi_ksync_map_delete($1)", [MSD]);

/* 19-12. v1.68 링크 정확도(flags.link_all) — H 옛 판과 이름 · 크기가 같은 기준일 전 K 파일: 첫 회차에 연결만(새 문서 · K '이름 (2)' 없음),
   다음 회차에 'H 가 더 새로움'으로 현재 판을 받고 옛 K 파일은 이전판으로(양쪽 연결) */
const LKD = path.join(MOUNT, "업무", "옛판");
fs.mkdirSync(LKD, { recursive: true });
fs.writeFileSync(path.join(LKD, "계획.hwp"), "PLAN-V1"); fs.utimesSync(path.join(LKD, "계획.hwp"), (SN - 864e5) / 1000, (SN - 864e5) / 1000);
D = await docs();
D.push({ id: "lk2", mod: "audit", grp: "olds", ser: "계획", title: "계획", date: "2026-10-01", files: [{ name: "계획 2차.hwp", size: 7, url: PUB + "docs/lklklklklk22_p2.hwp" }] },
  { id: "lk1", mod: "audit", grp: "olds", ser: "계획", title: "계획", date: "2025-03-01", files: [{ name: "계획.hwp", size: 7, url: PUB + "docs/lklklklklk11_p1.hwp" }] });
await setDocs(D);
putObj("docs/lklklklklk22_p2.hwp", "PLAN-V2"); putObj("docs/lklklklklk11_p1.hwp", "PLAN-V1");
const MLK = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "업무/옛판", mod: "audit", grp: "olds", since: "2025-08-01" })])).id;
r = await once();
eq(await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [MLK]), { del: 0, h2k: 1, k2h: 0, old: 1, link: 0, skip: 0, name2: 0, total: 1, conflict: 0 },
  "깃발 꺼짐(기본): 그 전 그대로 — 기준일 전 K 파일은 뺌 · H 현재 판은 받을 것으로 셈");
await db.exec(`update semis_logi_private.ksync_state set flags = flags || '{"link_all": true}'`);
await admin("select public.semis_logi_ksync_request()");
r = await once();
eq([r.status, await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [MLK])], ["ok", { del: 0, h2k: 0, k2h: 0, old: 0, link: 1, skip: 0, name2: 0, total: 1, conflict: 0 }],
  "link_all 미리보기: 기준일 전 K 파일이 옛 판과 연결만 1 · 올리기 · 받기 0");
await admin("select public.semis_logi_ksync_map_start($1)", [MLK]);
const nD = (await docs()).length;
r = await once();
eq([r.status, (await rowsOf(MLK)).map(x => [x.rel_path, x.doc_id, x.h_name]), (await docs()).length, fs.readdirSync(LKD).sort()],
  ["ok", [["계획.hwp", "lk1", "계획.hwp"]], nD, ["계획.hwp"]], "첫 회차: 옛 판과 연결만 — 새 문서 · K '이름 (2)' 없음");
r = await once();
eq([r.status, fs.readFileSync(path.join(LKD, "계획 2차.hwp"), "utf8"), fs.existsSync(path.join(LKD, "계획.hwp")), fs.readdirSync(path.join(LKD, "_H드라이브_이전판")).length,
  (await rowsOf(MLK)).map(x => [x.rel_path, x.doc_id])], ["ok", "PLAN-V2", false, 1, [["계획 2차.hwp", "lk2"]]], "다음 회차: H 가 더 새로움 → 현재 판을 받고 옛 K 파일은 이전판으로");
await db.exec(`update semis_logi_private.ksync_state set flags = flags || '{"link_all": false}'`);
await admin("select public.semis_logi_ksync_map_delete($1)", [MLK]);

/* 19-13. v1.68 H → K 준실시간 — 사람이 양쪽 연결 분류에 문서를 올리면 트리거가 요청 표시를 켜고, 오늘 매일 실행을 끝낸 에이전트도
   10분 깨우기(9분 지나 서버를 봄)에 그 요청으로 받아 온다. 끝 보고의 연결마다 보고(범위 밖 · 불일치)는 서버에 남는다 */
await one("update semis_logi_private.ksync_state set requested_at = null");
D = await docs();
D.push({ id: "rt1", mod: "audit", grp: "checklist", title: "올림", date: "2026-11-13", files: [{ name: "바로.pdf", size: 3, url: PUB + "docs/rtrtrtrtrtrt_now.pdf" }] });
putObj("docs/rtrtrtrtrtrt_now.pdf", "NOW");
await db.query("update public.semis_logi_store set value = $1::jsonb, updated_by = 'browser1' where key = 'docs'", [JSON.stringify(D)]);
ok(!!(await one("select requested_at from semis_logi_private.ksync_state")), "사람이 올림 → 트리거가 요청 표시");
{ const s0 = JSON.parse(fs.readFileSync(STATE, "utf8")); s0.lastOkDay = TODAY; s0.lastSeen = NOW; fs.writeFileSync(STATE, JSON.stringify(s0)); }
r = await runAgent(Object.assign(deps(), { now: () => NOW + 8 * 60e3 }), {});
eq([r.status, has("바로.pdf")], ["done-today", false], "오늘 끝낸 뒤 9분 안 깨우기는 서버를 보지 않음");
r = await runAgent(Object.assign(deps(), { now: () => NOW + 10 * 60e3 }), {});
const rpM = await one("select report from semis_logi_private.ksync_maps where id = $1", [M]);
eq([r.status, has("바로.pdf") && read("바로.pdf"), await one("select requested_at from semis_logi_private.ksync_state"), rpM && rpM.run === r.run, rpM && typeof rpM.mismatch],
  ["ok", "NOW", null, true, "number"], "10분 깨우기에 요청을 보고 H 새 문서를 K 로 받음 · 요청 표시 꺼짐 · 연결마다 보고 저장");

/* 19-14. v1.68 지정 제외 — 연결마다 뺄 폴더(대소문자 다르게 적어도)는 걷지 않고 '모름': 그 아래 기준선 줄은 삭제 대기가 되지 않고 H 문서도 그대로 */
const subRow = (await rowsOf(M)).find(x => x.rel_path.includes("/") && x.state === "ok");
const subTop = subRow.rel_path.split("/")[0];
await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ id: M, excludes: [subTop.toUpperCase()] })]);
const nDocsX = (await docs()).length;
r = await once();
const rowX = await rowById(subRow.id);
eq([r.status, rowX && rowX.state, (await docs()).length, (await one("select report from semis_logi_private.ksync_maps where id = $1", [M])).out.excl],
  ["ok", "ok", nDocsX, 1], "제외 폴더 아래 기준선 줄 그대로(삭제 대기 아님) · H 문서 그대로 · 보고 excl 1");
await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ id: M, excludes: [] })]);
r = await once();
eq([r.status, (await rowById(subRow.id)).state], ["ok", "ok"], "제외를 풀면 평소대로");

/* 19-15. 리뷰 반영 ④ — hello full(계획에 쓸 문서함) 뒤 · 회차 시작 전에 사람이 올린 문서: 회차 시작이 요청 표시를 끄지 않아 다음 깨우기에 받는다
   (끄면 그 문서는 이 회차 계획에도 없고 요청도 사라져 다음 날 매일 실행까지 늦는다) */
putObj("docs/rtrtrtrtrt22_mid.pdf", "MID");
hook.onRpc = async (act, p) => {
  if (act !== "run" || p.phase !== "start") return;
  hook.onRpc = null;
  const d2 = await docs();
  d2.push({ id: "rt2", mod: "audit", grp: "checklist", title: "사이", date: "2026-11-13", files: [{ name: "사이.pdf", size: 3, url: PUB + "docs/rtrtrtrtrt22_mid.pdf" }] });
  await db.query("update public.semis_logi_store set value = $1::jsonb, updated_by = 'browser2' where key = 'docs'", [JSON.stringify(d2)]);
};
r = await once();
eq([r.status, has("사이.pdf"), !!(await one("select requested_at from semis_logi_private.ksync_state"))], ["ok", false, true], "회차 시작 직전에 올린 문서 → 이번 회차엔 없고 요청 표시는 남음");
r = await once();
eq([r.status, has("사이.pdf") && read("사이.pdf"), await one("select requested_at from semis_logi_private.ksync_state")], ["ok", "MID", null], "다음 회차가 받고 요청 표시를 끔");

/* 19-16. v1.72 '양쪽' 안전 전환 — K → H 만이던 연결: 미리보기 없이 바꾸기 거절 → [양쪽으로 바꾸기 미리보기] → Mac 이 같은 색인으로 센 recon
   (링크 깃발이 꺼져 기준일 전 K 파일을 잇지 못하면 'K 이름 (2)' 가 될 1 → 거절) → 깃발을 켜고 다시 세면 0 → 바꾸기(첫 회차 승인) →
   전환 회차가 대량 변경 한도(2)를 넘는 변경 3(H 새 판 덮어쓰기)에도 보류 없이 끝남 · '이름 (2)' 없음 → 되돌리기(k2h) */
const CVD = path.join(MOUNT, "업무", "전환"), SNC = Date.parse("2025-08-01T00:00:00+09:00");
const cw = (n, s, t) => { fs.writeFileSync(path.join(CVD, n), s); fs.utimesSync(path.join(CVD, n), t / 1000, t / 1000); };
const cRead = (n) => { try { return fs.readFileSync(path.join(CVD, n), "utf8"); } catch (e) { return null; } };
const mapSave = (p) => admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify(p)]);
const reconOfMap = (id) => one("select recon from semis_logi_private.ksync_maps where id = $1", [id]);
fs.mkdirSync(CVD, { recursive: true });
["c1", "c2", "c3"].forEach(n => cw(n + ".pdf", n.toUpperCase() + "-K", SNC + 864e5));
cw("옛.hwp", "OLD-HWP", SNC - 864e5);
D = await docs();
D.push({ id: "cvold", mod: "audit", grp: "conv", title: "옛", date: "2025-07-01", files: [{ name: "옛.hwp", size: 7, url: PUB + "docs/cvcvcvcvcvc1_old.hwp" }] },
  { id: "cvnew", mod: "audit", grp: "conv", title: "새 H", date: "2026-11-01", files: [{ name: "새 H.pdf", size: 4, url: PUB + "docs/cvcvcvcvcvc2_new.pdf" }] });
await setDocs(D);
putObj("docs/cvcvcvcvcvc1_old.hwp", "OLD-HWP"); putObj("docs/cvcvcvcvcvc2_new.pdf", "NEWH");
const MCV = (await mapSave({ k_path: "업무/전환", mod: "audit", grp: "conv", dir: "k2h", since: "2025-08-01" })).id;
r = await once();
await admin("select public.semis_logi_ksync_map_start($1)", [MCV]);
r = await once();
const cvRows = await rowsOf(MCV);
eq([r.status, cvRows.map(x => x.rel_path), cRead("새 H.pdf"), fs.readdirSync(CVD).filter(n => / \(2\)/.test(n))], ["ok", ["c1.pdf", "c2.pdf", "c3.pdf"], null, []], "K → H 만: 새 K 파일 3개 등록 · H 문서는 K 로 안 감");
D = await docs();
cvRows.forEach((x, i) => { const u = "docs/cvh" + i + "hhhhhhhh_" + x.rel_path; putObj(u, "H-" + x.rel_path); D.unshift({ id: "cvh" + i, mod: "audit", grp: "conv", ser: x.ser, title: "t", date: "2026-11-10", files: [{ name: x.h_name, size: ("H-" + x.rel_path).length, url: PUB + u }], at: "2026-11-10T00:00:00.000Z" }); });
await setDocs(D);
const ml0 = await one("select mass_limit from semis_logi_private.ksync_state");
await db.exec(`update semis_logi_private.ksync_state set mass_limit = '{"files": 2, "ratio": 0.3, "min": 2}'::jsonb`);
r = await once();
eq([r.status, cRead("c1.pdf"), await holdOf(MCV)], ["ok", "C1-K", null], "K → H 만인 동안 H 새 판은 K 로 안 감(방향 밖)");
eq((await mapSave({ id: MCV, dir: "both" })).error, "recon", "미리보기 없이 양쪽으로 → 거절");
await mapSave({ id: MCV, dir_next: "both" });
r = await once();
let rcv = await reconOfMap(MCV);
eq([r.status, rcv && rcv.h2k_new, rcv && rcv.dup, rcv && rcv.n, rcv && rcv.h2k, cRead("옛 (2).hwp"), cRead("새 H.pdf"), cRead("c1.pdf")], ["ok", 2, 1, 3, 5, null, null, "C1-K"],
  "미리보기: 내려올 새 파일 2 · '이름 (2)' 1(기준일 전 K 파일을 잇지 못함) · 변경 3(한도 2 넘음) · K 에는 쓰지 않음");
eq((await mapSave({ id: MCV, dir: "both" })).error, "dup", "'이름 (2)' 가 될 것 1 → 바꾸지 않음");
await db.exec(`update semis_logi_private.ksync_state set flags = flags || '{"link_all": true}'`);
await mapSave({ id: MCV, dir_next: "both" });     // 다시 세기
r = await once();
rcv = await reconOfMap(MCV);
eq([r.status, rcv && rcv.h2k_new, rcv && rcv.dup, rcv && rcv.link, (await rowsOf(MCV)).map(x => x.rel_path)], ["ok", 1, 0, 1, ["c1.pdf", "c2.pdf", "c3.pdf", "옛.hwp"]],
  "링크 깃발 켜고 다시 세기: dup 0 · 기준일 전 K 파일은 평소 회차에서 연결만");
const mh0 = await events("mass_hold");
eq((await mapSave({ id: MCV, dir: "both" })).ok, true, "양쪽으로 바꾸기");
const hcv = await holdOf(MCV);
eq([hcv && hcv.ok, hcv && hcv.first, hcv && hcv.n, await one("select dir_next is null and recon is null from semis_logi_private.ksync_maps where id = $1", [MCV])], [true, true, rcv.n + rcv.link_old, true],
  "첫 회차 승인 = 미리보기 변경 수 + 옛 판 연결(서버가 세는 기준) · 미리보기 지움");
r = await once();
eq([r.status, cRead("새 H.pdf"), ["c1.pdf", "c2.pdf", "c3.pdf"].map(cRead), cRead("옛.hwp"), fs.readdirSync(CVD).filter(n => / \(2\)/.test(n)), await holdOf(MCV), await events("mass_hold") - mh0],
  ["ok", "NEWH", ["H-c1.pdf", "H-c2.pdf", "H-c3.pdf"], "OLD-HWP", [], null, 0], "전환 회차: 변경 3 > 한도 2 인데 보류 없이 끝남 · H 새 판 · 새 문서를 받음 · '이름 (2)' 없음 · 승인을 씀");
ok(fs.readdirSync(path.join(CVD, "_H드라이브_이전판")).length === 3, "덮은 K 옛 파일은 이전판 폴더로");
r = await once();
eq([r.status, (await lastRun()).detail.filter(d => d.m === MCV).length], ["ok", 0], "다음 회차: 할 일 없음(양쪽이 같음)");
eq([(await mapSave({ id: MCV, dir: "k2h" })).ok, await one("select dir from semis_logi_private.ksync_maps where id = $1", [MCV])], [true, "k2h"], "되돌리기(k2h)는 미리보기 없이 바로");
await db.query("update semis_logi_private.ksync_state set mass_limit = $1::jsonb", [JSON.stringify(ml0)]);
await admin("select public.semis_logi_ksync_map_delete($1)", [MCV]);

/* 19-17. v1.72 해시 채우기 → 해시 링크 — 관리자 요청 → 다음 회차 끝에 에이전트가 Edge hash 를 부르고(값을 보내지 않음) Edge 가 저장소에서 읽어 잰 sha 를 첨부에 적음 →
   다음 회차부터 이름이 다른 같은 내용 K 파일이 그 H 문서와 연결만(새 문서 · '이름 (2)' 없음) */
const HXD = path.join(MOUNT, "업무", "해시");
fs.mkdirSync(HXD, { recursive: true });
fs.writeFileSync(path.join(HXD, "이름 다름.pdf"), "SAME-CONTENT-77");
D = await docs();
D.push({ id: "hxo", mod: "audit", grp: "hashlink", title: "원본", date: "2026-10-01", files: [{ name: "원본.pdf", size: 15, url: PUB + "docs/hxhxhxhxhxh1_src.pdf" }] });
await setDocs(D);
putObj("docs/hxhxhxhxhxh1_src.pdf", "SAME-CONTENT-77");
const MHX = (await mapSave({ k_path: "업무/해시", mod: "audit", grp: "hashlink", dir: "k2h" })).id;
r = await once();
const pvX = () => one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [MHX]);
eq([r.status, (await pvX()).k2h, (await pvX()).link], ["ok", 1, 0], "해시 없음: 이름이 다른 같은 내용 K 파일은 새 문서로 셈");
const hq0 = await admin("select public.semis_logi_ksync_hash_todo('{}'::jsonb)");
ok(hq0.todo > 0 && !hq0.req, "해시 없는 H 첨부 " + hq0.todo);
await admin("select public.semis_logi_ksync_hash_todo($1::jsonb)", [JSON.stringify({ start: true })]);
const nRpc = rpcLog.length, nHttp = httpLog.length;
r = await once();
const hxf = (await docs()).find(d => d.id === "hxo").files[0];
const hq1 = await admin("select public.semis_logi_ksync_hash_todo('{}'::jsonb)");
eq([r.status, hxf.sha, hq1.todo, hq1.req], ["ok", shaHex("SAME-CONTENT-77"), 0, null], "해시 채우기: Edge 가 저장소에서 읽어 잰 sha · 남은 것 없음 → 요청 지움");
ok(rpcLog.slice(nRpc).some(x => x.act === "hash_todo") && rpcLog.slice(nRpc).filter(x => x.act === "hash_set").every(x => (x.p.items || []).every(i => i.sha || i.err)), "에이전트 → Edge hash → SQL hash_todo · hash_set");
eq(httpLog.slice(nHttp).filter(x => x.p === "fn" && x.status !== 200).length, 0, "해시 채우기 회차에 거절된 에이전트 요청 없음");
r = await once();
eq([r.status, (await pvX()).k2h, (await pvX()).link], ["ok", 0, 1], "해시가 생긴 다음 회차: 이름이 달라도 같은 내용 H 문서와 연결만으로 셈");
await admin("select public.semis_logi_ksync_map_start($1)", [MHX]);
const nDX = (await docs()).length;
r = await once();
eq([r.status, (await rowsOf(MHX)).map(x => [x.rel_path, x.doc_id]), (await docs()).length, fs.readdirSync(HXD).sort()], ["ok", [["이름 다름.pdf", "hxo"]], nDX, ["이름 다름.pdf"]],
  "시작: 연결만(새 문서 · K 사본 없음)");
await db.exec(`update semis_logi_private.ksync_state set flags = flags || '{"link_all": false}'`);
await admin("select public.semis_logi_ksync_map_delete($1)", [MHX]);

/* 20. 동시 실행 막기 · 로컬 상태 · 전체 확인 */
fs.writeFileSync(path.join(APP, "ksync.lock"), JSON.stringify({ pid: process.pid, at: Date.now() }));
eq((await once()).status, "locked", "다른 실행 중이면 양보");
fs.rmSync(path.join(APP, "ksync.lock"));
const stj = JSON.parse(fs.readFileSync(STATE, "utf8"));
ok(stj.lastOk && stj.lastSeen && !JSON.stringify(stj).includes(KEY), "로컬 상태에 키 없음");
eq(fs.statSync(STATE).mode & 0o077, 0, "상태 파일 600");
ok(!logs.join("\n").includes(KEY), "로그에 키 없음");
eq(httpLog.filter(x => x.p === "fn" && x.err === "origin").length, 1, "E1 에이전트 요청은 한 번도 origin 으로 거절되지 않음(브라우저 흉내 한 번만)");
ok(httpLog.filter(x => x.p === "fn").every(x => x.mode), "에이전트 요청은 모두 sec-fetch-mode 를 달고 옴(Node fetch)");
ok(!kFiles().some(f => f.endsWith(".part")), "임시 파일 남지 않음");

server.closeAllConnections();
server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`ksync E2E: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
