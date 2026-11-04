// K드라이브 동기화 E2E — 에이전트(ksync.mjs) ↔ 실제 Edge 코드(semis-logi-ksync.ts, Node 형식 제거 + Deno 흉내) ↔ 실제 SQL(PGlite) ↔ 저장소 흉내.
// K드라이브 = 임시 폴더. 실행: npm i --no-save @electric-sql/pglite && node tools/ksync/test/e2e.test.mjs   (Node ≥ 22.18 — .ts 형식 제거)
//   PGlite 를 다른 곳에 설치했으면 PGLITE_DIR=<…/node_modules/@electric-sql/pglite> 로 지정
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const PGL = process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, "dist/index.js")).href : "@electric-sql/pglite";
const PGC = process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, "dist/contrib/pgcrypto.js")).href : "@electric-sql/pglite/contrib/pgcrypto";
const { PGlite } = await import(PGL);
const { pgcrypto } = await import(PGC);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

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
`);
await db.exec(fs.readFileSync(path.join(REPO, "tools/sql/semis-logi-conflict.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(REPO, "tools/sql/semis-logi-ksync.sql"), "utf8"));
const one = async (q, p) => { const r = await db.query(q, p || []); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; };
const admin = async (q, p) => { await db.exec("insert into semis_logi_private.test_ctx values ('a1', 'admin', 'user')"); try { return await one(q, p); } finally { await db.exec("delete from semis_logi_private.test_ctx"); } };
const docs = async () => (await one("select value from public.semis_logi_store where key = 'docs'")) || [];
const setDocs = (v) => db.query("update public.semis_logi_store set value = $1::jsonb where key = 'docs'", [JSON.stringify(v)]);
const rowsOf = async (m) => (await db.query("select * from semis_logi_private.ksync_files where map_id = $1 order by rel_path", [m])).rows;
const events = (k) => one("select count(*)::int from semis_logi_private.ksync_events where kind = $1", [k]);
const lastRun = () => one("select to_jsonb(r) from semis_logi_private.ksync_runs r where result is distinct from 'offline' order by id desc limit 1");

/* ── 저장소 흉내 · Edge(실제 코드) ── */
const objects = new Map();
let tamper = null;
const ENV = { SUPABASE_URL: "https://supa.test", SUPABASE_SERVICE_ROLE_KEY: "svc" };
let edge = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { edge = h; } };
const SUPA = "https://supa.test/storage/v1";
const route = async (url, init) => {
  init = init || {};
  const method = (init.method || "GET").toUpperCase();
  const h = new Headers(init.headers || {});
  if (url === "https://supa.test/rest/v1/rpc/semis_logi_ksync_agent") {
    if (h.get("apikey") !== "svc") return new Response("{}", { status: 401 });
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify(await one("select public.semis_logi_ksync_agent($1, $2, $3, $4::jsonb)", [b.p_act, b.p_key_hash, b.p_ip, JSON.stringify(b.p)])));
  }
  let m = /^https:\/\/supa\.test\/storage\/v1\/object\/upload\/sign\/semis-logi-files\/([^?]+)(\?token=up)?$/.exec(url);
  if (m && method === "POST") return new Response(JSON.stringify({ url: "/object/upload/sign/semis-logi-files/" + m[1] + "?token=up" }));
  if (m && method === "PUT" && m[2]) { objects.set(decodeURIComponent(m[1]), Buffer.from(init.body)); return new Response("{}"); }
  m = /^https:\/\/supa\.test\/storage\/v1\/object\/sign\/semis-logi-files\/([^?]+)(\?token=dn)?$/.exec(url);
  if (m && method === "POST") return new Response(JSON.stringify({ signedURL: "/object/sign/semis-logi-files/" + m[1] + "?token=dn" }));
  if (m && method === "GET" && m[2]) {
    const p = decodeURIComponent(m[1]); const o = objects.get(p);
    if (!o) return new Response("no", { status: 404 });
    return new Response(tamper && tamper(p) ? Buffer.concat([o, Buffer.from("!")]) : o);
  }
  m = /^https:\/\/supa\.test\/storage\/v1\/object\/semis-logi-files\/(.+)$/.exec(url);
  if (m && method === "GET") { const o = objects.get(decodeURIComponent(m[1])); return o ? new Response(o) : new Response("no", { status: 404 }); }
  if (url === SUPA + "/object/semis-logi-files" && method === "DELETE") { JSON.parse(init.body).prefixes.forEach((p) => objects.delete(p)); return new Response("[]"); }
  return new Response("{}", { status: 404 });
};
globalThis.fetch = (u, i) => route(String(u), i);
// 저장소 package.json 이 commonjs 라 .mts 사본으로 읽는다(내용은 같음)
const EDGE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ksync-edge-"));
fs.copyFileSync(path.join(REPO, "tools/edge/semis-logi-ksync.ts"), path.join(EDGE_TMP, "edge.mts"));
await import(pathToFileURL(path.join(EDGE_TMP, "edge.mts")).href);
fs.rmSync(EDGE_TMP, { recursive: true, force: true });
ok(typeof edge === "function", "Edge 처리기");
const PUB = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/";
const putObj = (p, data) => { const b = Buffer.from(data); objects.set(p, b); return b; };

/* ── 에이전트 ── */
const { runAgent } = await import(pathToFileURL(path.join(REPO, "tools/ksync/ksync.mjs")).href);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ksync-e2e-"));
const MOUNT = path.join(TMP, "share");
const APP = path.join(TMP, "app");
fs.mkdirSync(MOUNT, { recursive: true });
const SERVER = "https://edge.test/functions/v1/semis-logi-ksync";
let IP = "198.51.100.5", online = true, KEY = "";
const notes = [], logs = [];
const agentFetch = async (u, i) => {
  const url = String(u);
  if (url === SERVER) {
    const h = new Headers((i && i.headers) || {}); h.set("cf-connecting-ip", IP);
    return edge(new Request(url, { method: i.method, headers: h, body: i.body }));
  }
  return route(url, i);
};
const deps = () => ({
  paths: { app: APP, config: path.join(APP, "config.json"), state: path.join(APP, "state.json"), lock: path.join(APP, "ksync.lock"), log: path.join(APP, "ksync.log") },
  config: { server: SERVER, smbUrl: "smb://nas.example/share" }, allowHttp: false,
  log: (lv, m) => logs.push(lv + " " + m), out: () => {}, now: () => Date.now(), fetch: agentFetch, sleep: async () => {},
  key: async () => KEY, netCheck: async () => (online ? { ok: true } : { ok: false, msg: "ECONNREFUSED" }), mountRoot: async () => MOUNT,
  notify: async (m) => notes.push(m), host: "test-mac"
});
const once = (a) => runAgent(deps(), Object.assign({ once: true }, a || {}));
const K = (rel) => path.join(MOUNT, "업무", "점검표", ...rel.split("/"));
const write = (rel, data, mtime) => { fs.mkdirSync(path.dirname(K(rel)), { recursive: true }); fs.writeFileSync(K(rel), data); if (mtime) fs.utimesSync(K(rel), mtime / 1000, mtime / 1000); };
const read = (rel) => fs.readFileSync(K(rel), "utf8");
const has = (rel) => fs.existsSync(K(rel));
const kFiles = (sub) => { const out = []; const w = (d, r) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const rr = r ? r + "/" + e.name : e.name; if (e.isDirectory()) w(path.join(d, e.name), rr); else out.push(rr.normalize("NFC")); } }; w(path.join(MOUNT, "업무", "점검표", sub || ""), sub || ""); return out.sort(); };

/* 1. 키 · 허용 IP 대기 · 미연결 */
KEY = (await admin("select public.semis_logi_ksync_agent_new('Mac')")).key;
let r = await once();
eq(r.status, "wait-ip", "허용 IP 없음 → 대기");
eq(await one("select ip_seen -> 0 ->> 'ip' from semis_logi_private.ksync_state"), IP, "후보 IP");
await admin("select public.semis_logi_ksync_ip_approve($1)", [IP]);
online = false;
r = await once();
eq([r.status, notes.length], ["offline", 1], "사내망 아님 → 알림");
await once();
eq(notes.length, 1, "알림은 하루 한 번");
eq(await one("select count(*)::int from semis_logi_private.ksync_runs where result = 'offline'"), 1, "연결 안 됨 보고");
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
fs.mkdirSync(path.dirname(K("big.bin")), { recursive: true }); fs.writeFileSync(K("big.bin"), ""); fs.truncateSync(K("big.bin"), 50 * 1024 * 1024 + 1);
fs.symlinkSync("/etc", K("link-out"));
const outside = path.join(TMP, "outside.txt"); fs.writeFileSync(outside, "secret"); fs.symlinkSync(outside, K("link-file.txt"));
await db.query("insert into public.semis_logi_store(key, value) values ('docs', $1::jsonb)", [JSON.stringify([
  { id: "d1", mod: "audit", grp: "checklist", title: "H 점검", date: "2026-10-01", ser: "", org: "", note: "", ssi: false, mids: [], files: [{ name: "h1.pdf", size: 3, url: PUB + "docs/aaaaaaaaaaaa_h1.pdf" }], at: "2026-10-01T00:00:00.000Z", by: "가" },
  { id: "dx", mod: "audit", grp: "checklist", title: "도구", date: "2026-10-01", files: [{ name: "tool.exe", size: 3, url: PUB + "docs/bbbbbbbbbbbb_tool.exe" }] },
  { id: "ds", mod: "audit", grp: "checklist", title: "SSI", date: "2026-10-01", ssi: true, files: [{ name: "s.pdf", size: 3, url: PUB + "docs-ssi/cccccccccccc_s.pdf" }] },
  { id: "de", mod: "audit", grp: "checklist", title: "이상한 이름", date: "2026-10-01", files: [{ name: "../../evil.pdf", size: 3, url: PUB + "docs/eeeeeeeeeeee_evil.pdf" }] },
  { id: "do", mod: "partners", grp: "x", title: "다른 화면", date: "2026-10-01", files: [{ name: "o.pdf", size: 3, url: PUB + "docs/dddddddddddd_o.pdf" }] }])]);
putObj("docs/aaaaaaaaaaaa_h1.pdf", "H1!"); putObj("docs/bbbbbbbbbbbb_tool.exe", "MZ!"); putObj("docs/eeeeeeeeeeee_evil.pdf", "EV!");
const M = (await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "업무/점검표", mod: "audit", grp: "checklist" })])).id;
r = await once();
eq(r.status, "ok", "미리보기 실행");
const pv = await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [M]);
eq([pv.k2h, pv.h2k, pv.skip], [3, 2, 3], "미리보기 K→H 3 · H→K 2(h1 · 이상한 이름) · 건너뜀 3(50MB · html · exe)");
eq((await docs()).length, 5, "미리보기는 실행 안 함");
ok(!has("h1.pdf"), "K 에도 안 씀");

/* 3. 시작 → 첫 동기화 */
await admin("select public.semis_logi_ksync_map_start($1)", [M]);
r = await once();
eq(r.status, "ok", "첫 동기화 " + JSON.stringify(r));
let D = await docs();
const kd = D.filter(d => d.src === "ksync");
eq(kd.map(d => d.title).sort(), ["a", "b", "가나다"], "K→H 3건(한글 이름 NFC)");
ok(kd.every(d => d.mod === "audit" && d.grp === "checklist" && d.by === "K드라이브 동기화" && d.files.length === 1 && objects.has(d.files[0].url.slice(PUB.length))), "문서함 일반 문서 · 원본 저장소");
eq(kd.find(d => d.title === "가나다").files[0].name, "가나다.pdf", "파일 이름 NFC");
eq([read("h1.pdf"), has("tool.exe"), has("s.pdf"), has("o.pdf")], ["H1!", false, false, false], "H→K: 연결 문서만 · 실행 파일 · SSI · 다른 화면 제외");
eq(kFiles().filter(f => /evil/.test(f)), ["_.._.._evil.pdf"], "경로 탈출 이름은 연결 폴더 안 파일 이름으로");
ok(!fs.existsSync(path.join(MOUNT, "evil.pdf")) && !fs.existsSync(path.join(TMP, "evil.pdf")), "폴더 밖에 쓰지 않음");
ok(!D.some(d => d.files.some(f => /link|outside/.test(f.name))), "링크는 따라가지 않음");
eq(await events("type_block"), 1, "실행 파일 차단 기록");
let run = await lastRun();
eq([run.k2h, run.h2k, run.skipped], [3, 2, 3], "실행 기록 건수");
ok(run.detail.some(d => d.a === "skip" && d.r === "too_large") && run.detail.some(d => d.a === "skip" && d.r === "type"), "건너뜀 이유");
eq((await rowsOf(M)).length, 5, "기준선 5");

/* 4. 두 번째 실행 = 변경 0(멱등) */
const at1 = await one("select updated_at from public.semis_logi_store where key = 'docs'");
const nObj = objects.size;
r = await once();
run = await lastRun();
eq([r.status, run.k2h, run.h2k, run.conflicts, run.errors], ["ok", 0, 0, 0, 0], "두 번째 실행 변경 0");
eq([String(await one("select updated_at from public.semis_logi_store where key = 'docs'")), objects.size], [String(at1), nObj], "문서함 · 저장소 그대로");

/* 5. K 만 바뀜 → 같은 판 묶음 새 판 */
write("a.xlsx", "A2", Date.parse("2026-11-04T02:00:00Z"));
r = await once();
D = await docs();
const aSer = D.find(d => d.title === "a").ser;
const aVers = D.filter(d => d.ser === aSer);
eq([aVers.length, D[0].ser, D[0].date], [2, aSer, "2026-11-04"], "새 판(맨 앞 · K 수정 날짜)");
eq(objects.get(D[0].files[0].url.slice(PUB.length)).toString(), "A2", "새 판 내용");

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
eq(objects.get(D[0].files[0].url.slice(PUB.length)).toString(), "A-K", "K 쪽이 현재 판");
ok(D.some(d => d.id === "aH"), "H 쪽은 이전 판으로 남음");
const cf1 = kFiles().filter(f => /충돌/.test(f));
eq(cf1.length, 1, "K 에 충돌 사본");
ok(/^a \(충돌 \d{4}-\d{2}-\d{2}\)\.xlsx$/.test(cf1[0]) && read(cf1[0]) === "A-H", "충돌 사본 이름 · 내용 " + cf1[0]);
eq((await rowsOf(M)).find(x => x.rel_path === "a.xlsx").state, "conflict", "확인 필요 '충돌'");
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
eq(old.length === 1 && objects.get(old[0].files[0].url.slice(PUB.length)).toString(), "B-K", "K 쪽 내용은 H 이전 판으로도");
ok(D.find(d => d.ser === bRow.ser && d.id === "bH"), "H 현재 판 그대로");
r = await once();
run = await lastRun();
eq([run.k2h, run.h2k, run.conflicts], [0, 0, 0], "충돌 사본은 다시 올리지 않음(멱등)");

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
const evil = D.find(d => d.id === "de");
await setDocs(D.filter(d => d.id !== "de"));
await once();
rows = await rowsOf(M);
const evRow = rows.find(x => x.doc_id === "de");
eq(evRow.state, "del_h", "삭제 대기");
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [evRow.id], act: "restore" })]);
await once();
D = await docs();
ok(D.some(d => d.src === "ksync" && d.files[0].name === "_.._.._evil.pdf"), "H 로 복원");
eq((await rowsOf(M)).find(x => x.id === evRow.id).state, "ok", "복원 뒤 정상");
/* 복원: K 에서 지운 것 → K 로 다시 */
fs.rmSync(K("sub/b2.docx"));
await once();
rows = await rowsOf(M);
await admin("select public.semis_logi_ksync_resolve($1::jsonb)", [JSON.stringify({ ids: [rows.find(x => x.rel_path === "sub/b2.docx").id], act: "restore" })]);
await once();
eq(has("sub/b2.docx") && read("sub/b2.docx"), "B-H", "K 로 복원(H 현재 판)");
ok(evil, "");

/* 10. 해시 불일치 — K 에 쓰지 않음 */
putObj("docs/iiiiiiiiiiii_t.pdf", "TAMPER");
D = await docs();
D.push({ id: "dt", mod: "audit", grp: "checklist", title: "t", date: "2026-11-04", files: [{ name: "t.pdf", size: 6, url: PUB + "docs/iiiiiiiiiiii_t.pdf" }] });
await setDocs(D);
tamper = (p) => p === "docs/iiiiiiiiiiii_t.pdf";
r = await once();
eq([has("t.pdf"), r.status], [false, "partial"], "받은 파일 해시가 다르면 버림");
ok(!kFiles().some(f => f.endsWith(".part")), "임시 파일 남지 않음");
eq(await events("hash_mismatch"), 1, "hash_mismatch 기록");
tamper = null;
await once();
eq(has("t.pdf") && read("t.pdf"), "TAMPER", "다음 실행에서 정상 받음");

/* 11. 대량 변경 보류 → 승인 */
await admin("select public.semis_logi_ksync_settings($1::jsonb)", [JSON.stringify({ mass_limit: { files: 2, ratio: 0.3 } })]);
const T5 = Date.parse("2026-11-04T06:00:00Z");
write("a.xlsx", "A3", T5); write("t.pdf", "T2", T5); write("_.._.._evil.pdf", "E2", T5);
const nObj2 = objects.size;
r = await once();
eq([r.status, objects.size], ["held", nObj2], "한도 넘음 → 보류 · 전송 없음");
const pend = await admin("select public.semis_logi_ksync_pending()");
eq(pend.holds.length, 1, "확인 필요 — 대량 변경 보류");
eq(await events("mass_hold"), 1, "mass_hold 기록");
r = await once();
eq(r.status, "held", "승인 전에는 계속 보류");
await admin("select public.semis_logi_ksync_hold($1::jsonb)", [JSON.stringify({ run_id: String(pend.holds[0].run), act: "approve" })]);
r = await once();
run = await lastRun();
eq([r.status, run.k2h], ["ok", 3], "승인 뒤 진행");
eq(await one("select hold from semis_logi_private.ksync_maps where id = $1", [M]), null, "보류 풀림");

/* 12. 동시 실행 막기 · 색인 정리 */
fs.writeFileSync(path.join(APP, "ksync.lock"), JSON.stringify({ pid: process.pid, at: Date.now() }));
eq((await once()).status, "locked", "다른 실행 중이면 양보");
fs.rmSync(path.join(APP, "ksync.lock"));
const stj = JSON.parse(fs.readFileSync(path.join(APP, "state.json"), "utf8"));
ok(stj.lastOkDay && stj.lastSeen && !JSON.stringify(stj).includes(KEY), "로컬 상태에 키 없음");
eq(fs.statSync(path.join(APP, "state.json")).mode & 0o077, 0, "상태 파일 600");
ok(!logs.join("\n").includes(KEY), "로그에 키 없음");

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`ksync E2E: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
