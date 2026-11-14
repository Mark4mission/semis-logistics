// semis-logi-ksync 로컬 검증 — 실제 SQL(tools/sql/semis-logi-ksync.sql)을 PGlite 에 올리고, PostgREST RPC · 저장소만 가짜로 바꿔 끼운 뒤
// 함수를 실제로 띄워 요청한다(외부 침입 방어: 키 없음 · 틀린 키 · 폐기 키 · 허용 IP 밖 · 빈 허용 목록 · Origin · 횟수 초과 · 연결 밖 문서).
// 요청은 Node fetch(에이전트)처럼 늘 sec-fetch-mode: cors 를 단다 — 그 헤더로 에이전트를 막지 않는지 모든 시험에서 함께 본다.
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
const streams = new Map<string, () => ReadableStream<Uint8Array>>();     // 저장소 파일을 조각으로 흘려 줌(얼마나 읽었는지 셈)
const replies = new Map<string, () => Response>();                         // 저장소 응답을 통째로(상태 · 헤더) 바꿔 줌
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
  if (m && replies.has(decodeURIComponent(m[1]))) return replies.get(decodeURIComponent(m[1]))!();
  if (m && streams.has(decodeURIComponent(m[1]))) return new Response(streams.get(decodeURIComponent(m[1]))!(), { status: 200 });
  if (m) { const o = objects.get(decodeURIComponent(m[1])); return o ? new Response(o as BodyInit, { status: 200 }) : new Response("no", { status: 404 }); }
  if (url.endsWith("/storage/v1/object/semis-logi-files") && init?.method === "DELETE") { (body.prefixes as string[]).forEach((p) => { deleted.push(p); objects.delete(p); }); return new Response("[]", { status: 200 }); }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const { handle } = await import("./semis-logi-ksync.ts");
const PUB = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/";
const IP = "198.51.100.20";
const sha = async (s: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", (typeof s === "string" ? new TextEncoder().encode(s) : s) as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
let KEY = "";
const post = async (body: unknown, o: { key?: string; ip?: string; xff?: string; headers?: Record<string, string>; method?: string; raw?: string } = {}) => {
  const h: Record<string, string> = { "content-type": "application/json", "sec-fetch-mode": "cors", ...(o.headers || {}) };
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
  assertEquals([r.status, r.d.error], [403, "origin"], "Sec-Fetch-Site");
  r = await post({ act: "hello" }, { key: "", headers: { "sec-fetch-mode": "cors" } });
  assertEquals([r.status, r.d.error], [401, "auth"], "Sec-Fetch-Mode 만 있으면 통과(Node fetch 가 늘 보냄) → 키 확인으로");
  r = await post({}, { method: "GET" });
  assertEquals(r.status, 405);
  r = await post(null, { raw: "{bad" });
  assertEquals([r.status, r.d.error], [400, "bad"], "JSON 아님");
  r = await post({ act: "drop_table" });
  assertEquals(r.d.error, "bad", "모르는 동작");
  r = await post(null, { raw: JSON.stringify({ act: "hello", pad: "x".repeat(2 * 1024 * 1024) }) });
  assertEquals(r.status, 413, "본문 상한");
});

Deno.test("본문 상한: Content-Length 없이(chunked) 2MB 를 넘으면 읽는 중에 끊고 413", async () => {
  const CH = 64 * 1024, N = 100;
  let pulled = 0;
  const body = () => new ReadableStream<Uint8Array>({
    pull(c) { if (pulled >= N) { c.close(); return; } pulled++; c.enqueue(new Uint8Array(CH).fill(32)); }
  }, { highWaterMark: 0 });
  const req = new Request("http://localhost/", { method: "POST", body: body(), headers: { "content-type": "application/json" } });
  assertEquals(req.headers.get("content-length"), null, "Content-Length 없음");
  const res = await handle(req);
  assertEquals([res.status, await res.json()], [413, { ok: false, error: "too_large" }]);
  assertEquals(pulled < N && pulled * CH <= 2 * 1024 * 1024 + 2 * CH, true, "상한을 넘은 곳에서 그만 읽음: " + pulled + " 조각");
  pulled = 0;
  const r = await realFetch("http://localhost:8000/", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-mode": "cors" }, body: body() });
  assertEquals(r.status, 413, "실제 HTTP(chunked)");
  await r.body?.cancel();
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
  assertEquals(await events("bad_key"), 1, "기록은 IP 마다 15분에 한 줄(차단 셈은 따로)");
  const old = await admin("select public.semis_logi_ksync_agent_new('old')") as { key: string; id: number };
  await admin("select public.semis_logi_ksync_agent_revoke($1)", [old.id]);
  r = await post({ act: "hello" }, { key: old.key, ip: "198.51.100.9" });
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

Deno.test("올리기 3단계(begin → 업로드 → verify → apply) · 해시 불일치 거절(파일 지움) · 에이전트 경로 · 주소 무시 · 연결 밖 문서 · 실행 파일 차단", async () => {
  await admin("select public.semis_logi_ksync_map_save($1::jsonb)", [JSON.stringify({ k_path: "점검표", mod: "audit", grp: "checklist" })]);
  const mapId = await one("select id from semis_logi_private.ksync_maps") as number;
  await db.query("update semis_logi_private.ksync_maps set preview = '{\"total\": 0}'::jsonb where id = $1", [mapId]);     // [시작]은 미리보기 건수가 온 뒤에만
  await admin("select public.semis_logi_ksync_map_start($1)", [mapId]);
  await db.query("insert into public.semis_logi_store(key, value) values ('docs', $1::jsonb)", [JSON.stringify([
    { id: "d1", mod: "audit", grp: "checklist", title: "가", date: "2026-10-01", files: [{ name: "가.pdf", size: 4, url: PUB + "docs/aaaaaaaaaaaa_a.pdf" }] },
    { id: "d2", mod: "partners", grp: "x", title: "남", date: "2026-10-01", files: [{ name: "남.pdf", size: 4, url: PUB + "docs/bbbbbbbbbbbb_b.pdf" }] },
    { id: "d3", mod: "audit", grp: "checklist", title: "실행", date: "2026-10-01", files: [{ name: "run.bat", size: 4, url: PUB + "docs/cccccccccccc_c.bat" }] }])]);
  objects.set("docs/aaaaaaaaaaaa_a.pdf", new TextEncoder().encode("pdf1"));
  const run = (await post({ act: "run", phase: "start", trigger: "manual" })).d.run;
  const bytes = new TextEncoder().encode("엑셀 내용");
  const h = await sha(bytes);
  const nDocs = async () => (await one("select jsonb_array_length(value) from public.semis_logi_store where key = 'docs'")) as number;
  // begin — 에이전트가 경로 · 폴더 · ssi · 이름 부분을 보내도 쓰지 않음(폴더는 SQL, 이름 부분은 Edge)
  calls.length = 0;
  let r = await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "2026/점검표.xlsx", size: bytes.length, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new",
    path: "docs-ssi/zzzzzzzzzzzz_evil.xlsx", ssi: true, part: "zzzzzzzzzzzz_evil.xlsx", prefix: "https://evil.example/" });
  assertEquals(r.d.ok, true, JSON.stringify(r.d));
  const path = String(r.d.path);
  assertEquals(/^docs\/[a-z0-9]{12,24}_{4}\.xlsx$/.test(path), true, "files 함수와 같은 경로 규칙: " + path);
  assertEquals(r.d.url, PUB + path);
  assertEquals(String(r.d.upload).startsWith("https://supa.test/storage/v1/object/upload/sign/semis-logi-files/" + path), true, "SQL 이 정한 경로로 업로드 서명");
  assertEquals(r.d.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const sent = calls.find((c) => c.url.endsWith("/semis_logi_ksync_agent") && c.body.p_act === "put")!.body.p as Record<string, unknown>;
  assertEquals(Object.keys(sent).sort(), ["map", "mode", "mtime", "part", "rel_path", "run", "sha256", "size"], "SQL 로 넘기는 칸(경로 · ssi · 주소 앞부분 없음)");
  assertEquals("docs/" + sent.part, path, "이름 부분(part)만 넘기고 SQL 이 폴더를 붙임");
  // verify — 업로드 전이면 거절, 업로드 뒤 저장소에서 다시 재어 확인. 등록은 아직
  r = await post({ act: "put", phase: "verify", path });
  assertEquals([r.status, r.d.error], [409, "state"], "올리기 전 확인 = 거절");
  objects.set(path, bytes);
  const n0 = await nDocs();
  r = await post({ act: "apply", run, paths: [path] });
  assertEquals([r.status, r.d.docs, await nDocs()], [200, {}, n0], "올렸어도 확인(verify) 전에는 등록 안 됨");
  r = await post({ act: "put", phase: "verify", path });
  assertEquals([r.status, r.d], [200, { ok: true }], "확인");
  assertEquals(await nDocs(), n0, "확인만으로는 문서함에 안 넣음");
  r = await post({ act: "put", phase: "verify", path });
  assertEquals([r.status, r.d.error], [409, "state"], "같은 확인 두 번 불가");
  r = await post({ act: "put", phase: "verify", path: "docs/../x" });
  assertEquals([r.status, r.d.error], [400, "bad"], "경로 형식");
  // apply — 에이전트가 보낸 주소 앞부분은 무시하고 PUBLIC_PREFIX
  calls.length = 0;
  r = await post({ act: "apply", run, paths: [path], prefix: "https://evil.example/storage/v1/object/public/semis-logi-files/" });
  assertEquals(r.d.ok, true, JSON.stringify(r.d));
  const docId = (r.d.docs as Record<string, string>)[path];
  assertEquals(/^ks[0-9a-f]{12}$/.test(docId), true, "등록 " + JSON.stringify(r.d));
  assertEquals((calls.find((c) => c.body.p_act === "put_apply")!.body.p as Record<string, unknown>).prefix, PUB, "주소 앞부분은 Edge 가 넣음");
  const docs = await one("select value from public.semis_logi_store where key = 'docs'") as Record<string, unknown>[];
  const nd = docs.find((d) => d.id === docId)!;
  assertEquals([nd.title, nd.src, (nd.files as Record<string, unknown>[])[0].name, (nd.files as Record<string, unknown>[])[0].url], ["점검표", "ksync", "점검표.xlsx", PUB + path]);
  r = await post({ act: "apply", run, paths: [path] });
  assertEquals([r.d.ok, r.d.docs], [true, {}], "같은 등록 두 번 불가");
  r = await post({ act: "apply", run, paths: "x" });
  assertEquals([r.status, r.d.error], [400, "bad"], "경로 목록 형식");
  // 모르는 단계
  r = await post({ act: "put", phase: "commit", path });
  assertEquals([r.status, r.d.error], [400, "bad"], "모르는 단계");
  r = await post({ act: "put", run, map: mapId, rel_path: "y.pdf", size: 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals([r.status, r.d.error], [400, "bad"], "단계 없음");
  // 해시 불일치 — 올린 내용이 시작 때 sha256 과 다르면 지우고 기록
  r = await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "b.pdf", size: 3, sha256: await sha("abc"), mtime: "2026-11-04T00:00:00Z", mode: "new" });
  const p2 = String(r.d.path);
  objects.set(p2, new TextEncoder().encode("xyz"));
  r = await post({ act: "put", phase: "verify", path: p2 });
  assertEquals([r.status, r.d], [409, { ok: false, error: "hash" }]);
  assertEquals([deleted.includes(p2), objects.has(p2), await events("hash_mismatch")], [true, false, 1], "파일 지움 · 기록");
  r = await post({ act: "apply", run, paths: [p2] });
  assertEquals(r.d.docs, {}, "불일치한 올리기는 등록 안 됨");
  // 시작 때 크기보다 큰 파일 — 서명 업로드 URL 은 크기를 막지 않는다. 크기를 넘는 순간 읽기를 끊고 불일치로(지움 · 기록)
  r = await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "big.pdf", size: 3, sha256: await sha("abc"), mtime: "2026-11-04T00:00:00Z", mode: "new" });
  const p3 = String(r.d.path);
  const CH = 64 * 1024, N = 100;
  let pulled = 0;
  objects.set(p3, new Uint8Array(0));
  streams.set(p3, () => new ReadableStream<Uint8Array>({ pull(c) { if (pulled >= N) { c.close(); return; } pulled++; c.enqueue(new Uint8Array(CH).fill(97)); } }, { highWaterMark: 0 }));
  r = await post({ act: "put", phase: "verify", path: p3 });
  streams.delete(p3);
  assertEquals([r.status, r.d], [409, { ok: false, error: "hash" }], "큰 파일 → 불일치");
  assertEquals(pulled <= 2, true, "크기를 넘은 곳에서 그만 읽음: " + pulled + " 조각");
  assertEquals([deleted.includes(p3), objects.has(p3), await events("hash_mismatch")], [true, false, 2], "파일 지움 · 기록");
  r = await post({ act: "apply", run, paths: [p3] });
  assertEquals(r.d.docs, {}, "큰 파일 올리기는 등록 안 됨");
  r = await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "a/../../etc/passwd", size: 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals(r.d.error, "bad", "경로 탈출");
  r = await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "x.zip", size: 50 * 1024 * 1024 + 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals([r.status, r.d.error], [413, "too_large"]);
  r = await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "x.html", size: 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new" });
  assertEquals([r.status, r.d.error], [415, "type"]);
  // 충돌(K 가 이김) 새 판의 비교용 H 주소(h_url)는 글자일 때만 넘긴다 — SQL 이 등록 때 지금 판에 있는지 대 보기만 한다
  calls.length = 0;
  await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "c.pdf", size: 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new", h_url: PUB + "docs/aaaaaaaaaaaa_a.pdf" });
  await post({ act: "put", phase: "begin", run, map: mapId, rel_path: "d.pdf", size: 1, sha256: h, mtime: "2026-11-04T00:00:00Z", mode: "new", h_url: { x: 1 } });
  assertEquals(calls.filter((c) => c.body.p_act === "put").map((c) => (c.body.p as Record<string, unknown>).h_url), [PUB + "docs/aaaaaaaaaaaa_a.pdf", undefined],
    "비교용 H 주소는 글자만 넘김");
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

Deno.test("해시 채우기(hash): 관리자 요청이 있을 때만 · SQL 이 고른 저장소 파일을 읽어 잰 sha256 을 SQL 이 적음(에이전트가 보낸 값 · 경로는 안 씀) · 50MB 넘으면 끊음 · 못 읽은 것은 건너뜀 · recon 은 SQL 로", async () => {
  const run = (await post({ act: "run", phase: "start", trigger: "manual" })).d.run;
  let r = await post({ act: "hash", run });
  assertEquals([r.status, r.d.error], [409, "state"], "요청 전에는 거절");
  await db.query("update public.semis_logi_store set value = value || $1::jsonb where key = 'docs'", [JSON.stringify([
    { id: "d4", mod: "audit", grp: "checklist", title: "큰", date: "2026-10-01", files: [{ name: "big.zip", size: 10, url: PUB + "docs/dddddddddddd_big.zip" }] },
    { id: "d5", mod: "audit", grp: "checklist", title: "바쁨", date: "2026-10-01", files: [{ name: "e.pdf", size: 1, url: PUB + "docs/eeeeeeeeeeee_e.pdf" }] },
    { id: "d6", mod: "audit", grp: "checklist", title: "길이", date: "2026-10-01", files: [{ name: "f.zip", size: 1, url: PUB + "docs/ffffffffffff_f.zip" }] }])]);
  // 저장소 일시 오류(503) · 길이 머리(Content-Length)가 50MB 를 넘는 파일(읽지 않고 끊어야 함)
  replies.set("docs/eeeeeeeeeeee_e.pdf", () => new Response("busy", { status: 503 }));
  let pulledF = 0;
  replies.set("docs/ffffffffffff_f.zip", () => new Response(new ReadableStream<Uint8Array>({ pull(c) { pulledF++; c.enqueue(new Uint8Array(64 * 1024)); } }, { highWaterMark: 0 }),
    { status: 200, headers: { "content-length": String(60 * 1024 * 1024) } }));
  const CH = 64 * 1024, N = 900;
  let pulled = 0;
  objects.set("docs/dddddddddddd_big.zip", new Uint8Array(0));
  streams.set("docs/dddddddddddd_big.zip", () => new ReadableStream<Uint8Array>({ pull(c) { if (pulled >= N) { c.close(); return; } pulled++; c.enqueue(new Uint8Array(CH)); } }, { highWaterMark: 0 }));
  await admin("select public.semis_logi_ksync_hash_todo($1::jsonb)", [JSON.stringify({ start: true })]);
  calls.length = 0;
  r = await post({ act: "hash", run, items: [{ url: PUB + "docs/aaaaaaaaaaaa_a.pdf", sha: "f".repeat(64) }], path: "docs/x", sha256: "0".repeat(64) });
  streams.delete("docs/dddddddddddd_big.zip");
  replies.clear();
  assertEquals([r.status, r.d], [200, { ok: true, n: 1, left: 0 }], JSON.stringify(r.d));
  const docs = await one("select value from public.semis_logi_store where key = 'docs'") as Record<string, unknown>[];
  const fileOf = (id: string) => (docs.find((d) => d.id === id)!.files as Record<string, unknown>[])[0];
  assertEquals([fileOf("d1").sha, fileOf("d2").sha, fileOf("d3").sha, fileOf("d4").sha], [await sha("pdf1"), undefined, undefined, undefined],
    "저장소에서 읽어 잰 값(에이전트가 보낸 값 아님) · 다른 화면 문서는 범위 밖 · 못 읽음 · 큰 파일은 적지 않음");
  const sent = calls.find((c) => c.body.p_act === "hash_set")!.body.p as Record<string, unknown>;
  assertEquals([Object.keys(sent).sort(), (sent.items as Record<string, unknown>[]).map((x) => [String(x.url).replace(PUB, ""), x.err || "sha"]).sort()],
    [["items", "last", "run"], [["docs/aaaaaaaaaaaa_a.pdf", "sha"], ["docs/cccccccccccc_c.bat", "read"], ["docs/dddddddddddd_big.zip", "too_large"],
      ["docs/eeeeeeeeeeee_e.pdf", "busy"], ["docs/ffffffffffff_f.zip", "too_large"]]], "SQL 로는 재거나 못 읽은 결과만 · 저장소 일시 오류(503)는 busy");
  assertEquals(pulled < N, true, "50MB 를 넘은 곳에서 그만 읽음: " + pulled + " 조각");
  assertEquals(pulledF, 0, "길이 머리가 50MB 를 넘으면 읽기 전에 끊음");
  assertEquals([await one("select string_agg(why, ',' order by why) from semis_logi_private.ksync_hash_skip"), await one("select hash_req is null from semis_logi_private.ksync_state")],
    ["busy,read,too_large,too_large", false], "못 읽은 것 · 큰 파일은 하루 · 일시 오류는 한 시간 건너뜀 — 일시 오류가 남았으니 요청은 남김(한 시간 뒤 다시 읽음)");
  await db.exec("update semis_logi_private.ksync_hash_skip set at = now() - interval '2 hours' where why = 'busy'");
  objects.set("docs/eeeeeeeeeeee_e.pdf", new TextEncoder().encode("e!"));
  calls.length = 0;
  r = await post({ act: "hash", run });
  assertEquals([r.d, await one("select hash_req is null from semis_logi_private.ksync_state")], [{ ok: true, n: 1, left: 0 }, true], "한 시간 뒤 다시 읽어 채움 · 남은 것 없음 → 요청 지움");
  assertEquals(calls.filter((c) => c.body.p_act === "hash_todo" || c.body.p_act === "hash_set").map((c) => c.body.p_act), ["hash_todo", "hash_set"], "SQL 호출 둘(분당 셈 둘)");
  r = await post({ act: "hash_set", run, items: [{ url: PUB + "docs/aaaaaaaaaaaa_a.pdf", sha: "e".repeat(64) }] });
  assertEquals([r.status, r.d.error], [400, "bad"], "적는 동작(hash_set)은 Edge 밖에서 못 부름");
  r = await post({ act: "recon", map: 999, counts: {} });
  assertEquals([r.status, r.d.error], [409, "state"], "recon 은 SQL 에 그대로(연결 · dir_next 확인은 SQL)");
  await post({ act: "run", phase: "end", run, result: "ok" });
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
