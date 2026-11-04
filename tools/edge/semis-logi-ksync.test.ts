// semis-logi-ksync 로컬 검증 — 실제 SQL(tools/sql/semis-logi-ksync.sql)을 PGlite 에 올리고, PostgREST RPC · 저장소만 가짜로 바꿔 끼운 뒤
// 함수를 실제로 띄워 요청한다(외부 침입 방어: 키 없음 · 틀린 키 · 폐기 키 · 허용 IP 밖 · 빈 허용 목록 · Origin · 횟수 초과 · 연결 밖 문서).
// 실행: deno test --node-modules-dir=none --allow-net --allow-env --allow-read tools/edge/semis-logi-ksync.test.ts   (포트 8000 사용, PGlite 는 npm: 으로 받음)
import { assertEquals } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.5.15";
import { pgcrypto } from "npm:@electric-sql/pglite@0.5.15/contrib/pgcrypto";

Deno.env.set("SUPABASE_URL", "https://supa.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-test");
const here = new URL(".", import.meta.url);
const SQL = await Deno.readTextFile(new URL("../sql/semis-logi-ksync.sql", here));
const CONFLICT = await Deno.readTextFile(new URL("../sql/semis-logi-conflict.sql", here));

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema semis_logi_private;
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N', t.role, case t.role when 'admin' then 4 when 'hq' then 3 else 1 end, t.kind, null
      from semis_logi_private.test_ctx t $$;
  create table public.semis_logi_store (key text primary key, value jsonb, updated_at timestamptz default now(), updated_by text);
`);
await db.exec(CONFLICT);
await db.exec(SQL);
const one = async (q: string, p: unknown[] = []) => { const r = await db.query(q, p); const row = r.rows[0] as Record<string, unknown> | undefined; return row ? Object.values(row)[0] : undefined; };
const admin = async (sql: string, p: unknown[] = []) => {
  await db.exec("insert into semis_logi_private.test_ctx values ('a1', 'admin', 'user')");
  try { return await one(sql, p); } finally { await db.exec("delete from semis_logi_private.test_ctx"); }
};

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
const calls: Call[] = [];
const objects = new Map<string, Uint8Array>();
const deleted: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://localhost")) return realFetch(input, init);
  const headers = Object.fromEntries(new Headers(init?.headers || {}).entries());
  let body: Record<string, unknown> = {};
  try { body = init && typeof init.body === "string" ? JSON.parse(init.body) : {}; } catch (_e) { body = {}; }
  calls.push({ url, headers, body });
  if (headers.apikey !== "svc-test") return new Response("{}", { status: 401 });
  if (url === "https://supa.test/rest/v1/rpc/semis_logi_ksync_agent") {
    const r = await one("select public.semis_logi_ksync_agent($1, $2, $3, $4::jsonb)", [body.p_act, body.p_key_hash, body.p_ip, JSON.stringify(body.p)]);
    return new Response(JSON.stringify(r), { status: 200 });
  }
  let m = /\/storage\/v1\/object\/upload\/sign\/semis-logi-files\/(.+)$/.exec(url);
  if (m) return new Response(JSON.stringify({ url: "/object/upload/sign/semis-logi-files/" + m[1] + "?token=up" }), { status: 200 });
  m = /\/storage\/v1\/object\/sign\/semis-logi-files\/(.+)$/.exec(url);
  if (m) return new Response(JSON.stringify({ signedURL: "/object/sign/semis-logi-files/" + m[1] + "?token=dn" }), { status: 200 });
  m = /\/storage\/v1\/object\/semis-logi-files\/(.+)$/.exec(url);
  if (m) { const o = objects.get(decodeURIComponent(m[1])); return o ? new Response(o as BodyInit, { status: 200 }) : new Response("no", { status: 404 }); }
  if (url.endsWith("/storage/v1/object/semis-logi-files") && init?.method === "DELETE") { (body.prefixes as string[]).forEach((p) => { deleted.push(p); objects.delete(p); }); return new Response("[]", { status: 200 }); }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

await import("./semis-logi-ksync.ts");
const PUB = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/";
const IP = "198.51.100.20";
const sha = async (s: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", (typeof s === "string" ? new TextEncoder().encode(s) : s) as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
let KEY = "";
const post = async (body: unknown, o: { key?: string; ip?: string; xff?: string; headers?: Record<string, string>; method?: string; raw?: string } = {}) => {
  const h: Record<string, string> = { "content-type": "application/json", ...(o.headers || {}) };
  if (o.key !== "") h["x-ksync-key"] = o.key ?? KEY;
  if (o.xff) h["x-forwarded-for"] = o.xff; else h["cf-connecting-ip"] = o.ip ?? IP;
  const r = await realFetch("http://localhost:8000/", { method: o.method || "POST", headers: h, body: o.method === "GET" ? undefined : (o.raw ?? JSON.stringify(body)) });
  const text = await r.text();
  let d: Record<string, unknown> = {};
  try { d = JSON.parse(text); } catch (_e) { d = { raw: text }; }
  return { status: r.status, d, h: r.headers };
};
const events = (kind: string) => one("select count(*)::int from semis_logi_private.ksync_events where kind = $1", [kind]);

Deno.test("브라우저 차단: Origin · Sec-Fetch 헤더가 있으면 거절하고 CORS 응답 없음 · GET 거절", async () => {
  let r = await post({ act: "hello" }, { headers: { origin: "https://hdrive.kr" } });
  assertEquals([r.status, r.d], [403, { ok: false, error: "origin" }]);
  assertEquals(r.h.get("access-control-allow-origin"), null, "CORS 헤더 없음");
  r = await post({ act: "hello" }, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assertEquals(r.status, 403, "사전 요청도 거절");
  r = await post({ act: "hello" }, { headers: { "sec-fetch-site": "cross-site" } });
  assertEquals(r.d.error, "origin", "Sec-Fetch");
  r = await post({}, { method: "GET" });
  assertEquals(r.status, 405);
  r = await post(null, { raw: "{bad" });
  assertEquals([r.status, r.d.error], [400, "bad"], "JSON 아님");
  r = await post({ act: "drop_table" });
  assertEquals(r.d.error, "bad", "모르는 동작");
  r = await post(null, { raw: JSON.stringify({ act: "hello", pad: "x".repeat(2 * 1024 * 1024) }) });
  assertEquals(r.status, 413, "본문 상한");
});

Deno.test("키: 없음 · 틀림 · 폐기 → 401 auth(같은 코드) · 기록 · DB 에는 sha256 만", async () => {
  const k = await admin("select public.semis_logi_ksync_agent_new('Mac')") as { key: string; id: number };
  KEY = k.key;
  calls.length = 0;
  let r = await post({ act: "hello" }, { key: "" });
  assertEquals([r.status, r.d], [401, { ok: false, error: "auth" }], "키 없음");
  r = await post({ act: "hello" }, { key: "f".repeat(64) });
  assertEquals([r.status, r.d], [401, { ok: false, error: "auth" }], "틀린 키");
  r = await post({ act: "hello" }, { key: "x'; drop table--" });
  assertEquals(r.d.error, "auth", "형식 아닌 키");
  assertEquals(await events("bad_key"), 3);
  const old = await admin("select public.semis_logi_ksync_agent_new('old')") as { key: string; id: number };
  await admin("select public.semis_logi_ksync_agent_revoke($1)", [old.id]);
  r = await post({ act: "hello" }, { key: old.key });
  assertEquals([r.status, r.d.error], [401, "auth"], "폐기 키");
  assertEquals(await events("revoked_key"), 1);
  r = await post({ act: "hello" });
  assertEquals(r.status, 200, "맞는 키");
  const sent = calls.filter((c) => c.url.endsWith("/semis_logi_ksync_agent")).map((c) => JSON.stringify(c.body)).join("\n");
  assertEquals(sent.includes(KEY), false, "키 원문은 RPC 로 보내지 않음");
  assertEquals(sent.includes(await sha(KEY)), true, "sha256 만");
});

Deno.test("허용 IP: 비어 있으면 hello 만(후보 IP) · 허용 밖 거절 · IP 는 cf-connecting-ip → x-forwarded-for 마지막", async () => {
  let r = await post({ act: "hello", full: true });
  assertEquals([r.d.ok, r.d.allow, "maps" in r.d], [true, false, false], "빈 목록 = 설정만");
  r = await post({ act: "folders", list: [] });
  assertEquals([r.status, r.d.error], [403, "ip"]);
  assertEquals(await events("ip_denied"), 1);
  r = await post({ act: "net", ok: false, msg: "연결 안 됨" }, { ip: "192.0.2.77" });
  assertEquals(r.d.ok, true, "연결 안 됨 보고는 예외");
  await admin("select public.semis_logi_ksync_ip_approve($1)", [IP]);
  r = await post({ act: "hello" });
  assertEquals(r.d.allow, true, "허용 뒤");
  r = await post({ act: "hello" }, { xff: "10.0.0.1, " + IP });
  assertEquals(r.d.allow, true, "x-forwarded-for 마지막 항목");
  r = await post({ act: "hello" }, { xff: IP + ", 192.0.2.9" });
  assertEquals([r.status, r.d.error], [403, "ip"], "첫 항목은 믿지 않음(꾸밀 수 있음)");
});

Deno.test("올리기 · 내려받기: 문서함 등록 · 해시 불일치 거절(파일 지움) · 연결 밖 문서 · 실행 파일 차단", async () => {
  await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "점검표", mod: "audit", grp: "checklist" })]);
  const mapId = await one("select id from semis_logi_private.ksync_maps") as number;
  await admin("select public.semis_logi_ksync_map_start($1)", [mapId]);
  await db.query("insert into public.semis_logi_store(key, value) values ('docs', $1::jsonb)", [JSON.stringify([
    { id: "d1", mod: "audit", grp: "checklist", title: "가", date: "2026-10-01", files: [{ name: "가.pdf", size: 4, url: PUB + "docs/aaaaaaaaaaaa_a.pdf" }] },
    { id: "d2", mod: "partners", grp: "x", title: "남", date: "2026-10-01", files: [{ name: "남.pdf", size: 4, url: PUB + "docs/bbbbbbbbbbbb_b.pdf" }] },
    { id: "d3", mod: "audit", grp: "checklist", title: "실행", date: "2026-10-01", files: [{ name: "run.bat", size: 4, url: PUB + "docs/cccccccccccc_c.bat" }] }])]);
  objects.set("docs/aaaaaaaaaaaa_a.pdf", new TextEncoder().encode("pdf1"));
  const run = (await post({ act: "run", phase: "start", trigger: "manual" })).d.run;
  const bytes = new TextEncoder().encode("엑셀 내용");
  const h = await sha(bytes);
  let r = await post({ act: "put", run, map: mapId, rel_path: "2026/점검표.xlsx", size: bytes.length, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals(r.d.ok, true, JSON.stringify(r.d));
  const path = String(r.d.path);
  assertEquals(/^docs\/[a-z0-9]{12,24}_{4}\.xlsx$/.test(path), true, "files 함수와 같은 경로 규칙: " + path);
  assertEquals(String(r.d.upload).startsWith("https://supa.test/storage/v1/object/upload/sign/semis-logi-files/"), true);
  assertEquals(r.d.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  r = await post({ act: "put", phase: "commit", path });
  assertEquals([r.status, r.d.error], [409, "state"], "올리기 전 확인 = 거절");
  objects.set(path, bytes);
  r = await post({ act: "put", phase: "commit", path });
  assertEquals(r.d.ok, true, "확인 → 등록");
  const docs = await one("select value from public.semis_logi_store where key = 'docs'") as Record<string, unknown>[];
  const nd = docs.find((d) => d.id === r.d.doc)!;
  assertEquals([nd.title, nd.src, (nd.files as Record<string, unknown>[])[0].name, (nd.files as Record<string, unknown>[])[0].url], ["점검표", "ksync", "점검표.xlsx", PUB + path]);
  // 해시 불일치 — 올린 내용이 시작 때 sha256 과 다르면 지우고 기록
  r = await post({ act: "put", run, map: mapId, rel_path: "b.pdf", size: 3, sha256: await sha("abc"), mtime: "2026-11-04T00:00:00Z", mode: "new" });
  const p2 = String(r.d.path);
  objects.set(p2, new TextEncoder().encode("xyz"));
  r = await post({ act: "put", phase: "commit", path: p2 });
  assertEquals([r.status, r.d], [409, { ok: false, error: "hash" }]);
  assertEquals([deleted.includes(p2), await events("hash_mismatch")], [true, 1], "파일 지움 · 기록");
  r = await post({ act: "put", run, map: mapId, rel_path: "a/../../etc/passwd", size: 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals(r.d.error, "bad", "경로 탈출");
  r = await post({ act: "put", run, map: mapId, rel_path: "x.zip", size: 50 * 1024 * 1024 + 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals([r.status, r.d.error], [413, "too_large"]);
  r = await post({ act: "put", run, map: mapId, rel_path: "x.html", size: 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals([r.status, r.d.error], [415, "type"]);
  // 내려받기
  r = await post({ act: "get", run, map: mapId, doc: "d1", url: PUB + "docs/aaaaaaaaaaaa_a.pdf" });
  assertEquals([r.d.ok, r.d.sha256, r.d.size, r.d.expires], [true, await sha("pdf1"), 4, 600], "sha256 · 10분");
  assertEquals(String(r.d.url).startsWith("https://supa.test/storage/v1/object/sign/semis-logi-files/docs/aaaaaaaaaaaa_a.pdf?token="), true);
  r = await post({ act: "get", run, map: mapId, doc: "d2", url: PUB + "docs/bbbbbbbbbbbb_b.pdf" });
  assertEquals([r.status, r.d], [403, { ok: false, error: "scope" }], "연결 밖 문서");
  assertEquals(await events("scope"), 1);
  r = await post({ act: "get", run, map: mapId, doc: "d3", url: PUB + "docs/cccccccccccc_c.bat" });
  assertEquals([r.status, r.d.error, await events("type_block")], [415, "type", 1], "실행 파일은 K 로 안 보냄");
});

Deno.test("횟수: 키 실패 15분 10회 넘으면 그 IP 1시간 차단(맞는 키도) · 분당 상한", async () => {
  const BAD = "203.0.113.200";
  for (let i = 0; i < 11; i++) await post({ act: "hello" }, { key: "e".repeat(64), ip: BAD });
  let r = await post({ act: "hello" }, { ip: BAD });
  assertEquals([r.status, r.d], [429, { ok: false, error: "rate" }], "차단");
  await db.exec(`update semis_logi_private.ksync_state set limits = '{"perMin": 2, "dayBytes": 1000000}'::jsonb; update semis_logi_private.ksync_agents set min_at = null`);
  await post({ act: "hello" }); await post({ act: "hello" });
  r = await post({ act: "hello" });
  assertEquals([r.status, r.d.error], [429, "rate"], "분당 상한");
  await db.exec(`update semis_logi_private.ksync_state set limits = '{"perMin": 300, "dayBytes": 1000000}'::jsonb; update semis_logi_private.ksync_agents set min_at = null`);
  r = await post({ act: "hello" });
  assertEquals(r.status, 200, "풀림");
});

Deno.test("오류 응답은 짧은 코드만 · 서버 오류도 내부 사유 없음", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://localhost")) return realFetch(input, init);
    return new Response("db exploded: password=…", { status: 500 });
  }) as typeof fetch;
  try {
    const r = await post({ act: "hello" });
    assertEquals([r.status, r.d], [500, { ok: false, error: "server" }]);
  } finally { globalThis.fetch = saved; }
});
