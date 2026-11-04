// H:drive — K드라이브 동기화 SQL 로컬 검증 (PGlite + pgcrypto, 세션 함수 ctx() · 공용 행 트리거는 시험용으로 흉내 — 충돌 확인은 실제 파일)
// 실행: mkdir -p <스크래치>/pgl && cd <스크래치>/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-ksync.test.mjs . &&
//       node semis-logi-ksync.test.mjs <저장소>/tools/sql/semis-logi-ksync.sql <저장소>/tools/sql/semis-logi-conflict.sql
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import crypto from "crypto";
import fs from "fs";

const SQL = fs.readFileSync(process.argv[2], "utf8");
const CONFLICT = fs.readFileSync(process.argv[3] || process.argv[2].replace(/semis-logi-ksync\.sql$/, "semis-logi-conflict.sql"), "utf8");
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b));
const one = async (q, p) => { const r = await db.query(q, p || []); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; };
const rows = async (q, p) => (await db.query(q, p || [])).rows;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const as = async (id, role, kind) => {
  await db.exec("delete from semis_logi_private.test_ctx");
  if (id) await db.query("insert into semis_logi_private.test_ctx values ($1, $2, $3)", [id, role, kind || "user"]);
};
const rpc = (name, arg, typ) => one(`select public.${name}(${arg === undefined ? "" : "$1" + (typ || "::jsonb")})`, arg === undefined ? [] : [typeof arg === "string" || typeof arg === "number" ? arg : JSON.stringify(arg)]);
const raises = async (fn, code) => { try { await fn(); return false; } catch (e) { return !code || e.code === code; } };
let KEY = "", IP = "203.0.113.7";
const call = (act, p, o) => one("select public.semis_logi_ksync_agent($1, $2, $3, $4::jsonb)", [act, (o && o.hash !== undefined) ? o.hash : sha(KEY), (o && o.ip) || IP, JSON.stringify(p || {})]);
const docs = async () => (await one("select value from public.semis_logi_store where key = 'docs'")) || [];
const PUB = "https://proj.supabase.co/storage/v1/object/public/semis-logi-files/";
const H64 = (c) => c.repeat(64).slice(0, 64);

await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema semis_logi_private;
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create function semis_logi_private.rank_of(p_role text) returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2 when 'user' then 1 when 'vendor' then 1 else 0 end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N-' || t.account_id,
      case when t.kind = 'signer' then 'signer' else t.role end,
      case when t.kind = 'signer' then 0 else semis_logi_private.rank_of(t.role) end, t.kind, null from semis_logi_private.test_ctx t $$;
  create table public.semis_logi_store (key text primary key, value jsonb, updated_at timestamptz default now(), updated_by text);
  create table public.test_hist (id serial primary key, key text, value jsonb, at timestamptz default now());
  create table public.test_notify (id serial primary key, key text, by text);
  -- 시각 · 작성자(semis-logi-security.sql stamp 와 같은 규칙: 세션 계정 또는 anon + '/' + 클라이언트 ID)
  create function semis_logi_private.stamp() returns trigger language plpgsql as $$
  declare who text;
  begin
    new.updated_at := clock_timestamp();
    select c.login_id into who from semis_logi_private.ctx() c limit 1;
    new.updated_by := left(coalesce(who, 'anon') || '/' || regexp_replace(coalesce(new.updated_by, ''), '^.*/', ''), 80);
    return new;
  end $$;
  create trigger semis_logi_store_a_stamp before insert or update on public.semis_logi_store for each row execute function semis_logi_private.stamp();
  create function public.test_snap() returns trigger language plpgsql as $$
  begin insert into public.test_hist(key, value) values (old.key, old.value); return new; end $$;
  create trigger semis_store_snap before update on public.semis_logi_store for each row execute function public.test_snap();
  create function public.test_note() returns trigger language plpgsql as $$
  begin insert into public.test_notify(key, by) values (new.key, regexp_replace(coalesce(new.updated_by, ''), '^.*/', '')); return null; end $$;
  create trigger semis_logi_store_notify after insert or update on public.semis_logi_store for each row execute function public.test_note();
`);
await db.exec(CONFLICT);
await db.exec(SQL);
await db.exec(SQL);   // 다시 실행해도 같은 결과
await db.exec("grant usage on schema semis_logi_private to anon, service_role");

// 0. 권한 — 에이전트 입구는 서비스 권한만, 관리 RPC 는 anon(세션 확인), 비공개 함수 · 표는 막음
eq(await one("select has_function_privilege('service_role', 'public.semis_logi_ksync_agent(text, text, text, jsonb)', 'EXECUTE')"), true, "입구 service_role");
eq(await one("select has_function_privilege('anon', 'public.semis_logi_ksync_agent(text, text, text, jsonb)', 'EXECUTE')"), false, "입구 anon 차단");
eq(await one("select has_function_privilege('authenticated', 'public.semis_logi_ksync_agent(text, text, text, jsonb)', 'EXECUTE')"), false, "입구 authenticated 차단");
const ADMIN = ["semis_logi_ksync_status()", "semis_logi_ksync_runs(jsonb)", "semis_logi_ksync_events(jsonb)", "semis_logi_ksync_folders()",
  "semis_logi_ksync_map_save(jsonb)", "semis_logi_ksync_map_delete(bigint)", "semis_logi_ksync_map_start(bigint)", "semis_logi_ksync_pending()",
  "semis_logi_ksync_resolve(jsonb)", "semis_logi_ksync_hold(jsonb)", "semis_logi_ksync_request()", "semis_logi_ksync_settings(jsonb)",
  "semis_logi_ksync_ip_approve(text)", "semis_logi_ksync_agent_new(text)", "semis_logi_ksync_agent_revoke(bigint)"];
for (const f of ADMIN) {
  eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", ["public." + f]), true, f + " anon");
  eq(await one("select has_function_privilege('authenticated', $1, 'EXECUTE')", ["public." + f]), false, f + " authenticated 차단");
}
const priv = await rows("select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'semis_logi_private' and p.proname like 'ksync\\_%'");
ok(priv.length >= 25, "비공개 함수 " + priv.length);
for (const r of priv) eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", [r.sig]), false, r.sig + " anon 차단");
for (const t of ["ksync_agents", "ksync_maps", "ksync_files", "ksync_runs", "ksync_folders", "ksync_events", "ksync_state", "ksync_uploads"]) {
  eq(await one("select has_table_privilege('anon', $1, 'SELECT')", ["semis_logi_private." + t]), false, t + " 읽기 차단");
  eq(await one("select relrowsecurity from pg_class where oid = $1::regclass", ["semis_logi_private." + t]), true, t + " RLS");
}

// 1. 관리 RPC — 시스템관리자 아니면 42501
await as(null);
ok(await raises(() => rpc("semis_logi_ksync_status"), "42501"), "세션 없음 42501");
await as("h1", "hq");
ok(await raises(() => rpc("semis_logi_ksync_status"), "42501"), "hq 42501");
ok(await raises(() => rpc("semis_logi_ksync_agent_new", "x", "::text"), "42501"), "hq 키 발급 불가");
await as("s1", "user", "signer");
ok(await raises(() => rpc("semis_logi_ksync_request"), "42501"), "서명 세션 42501");
await as("a1", "admin");
let r = await rpc("semis_logi_ksync_status");
eq([r.ok, r.state.daily_at, r.state.ip_allow, r.alert], [true, "08:30", [], false], "처음 상태");

// 2. 키 발급 — 원문은 한 번만, 서버에는 sha256 만
r = await rpc("semis_logi_ksync_agent_new", "Mark Mac", "::text");
ok(r.ok && /^[0-9a-f]{64}$/.test(r.key), "키 64자");
KEY = r.key; const AG = r.id;
eq(await one("select key_hash from semis_logi_private.ksync_agents where id = $1", [AG]), sha(KEY), "sha256 만 저장");
eq(await one("select count(*)::int from semis_logi_private.ksync_agents where key_hash = $1", [KEY]), 0, "원문 없음");
ok(!JSON.stringify(await rpc("semis_logi_ksync_status")).includes(KEY), "상태에 키 없음");

// 3. 키 없음 · 틀린 키 · 폐기 키 → auth + 기록
await as(null);
eq((await call("hello", {}, { hash: "" })).error, "auth", "키 없음");
eq((await call("hello", {}, { hash: H64("0") })).error, "auth", "틀린 키");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'bad_key'"), 2, "bad_key 기록 2");
await as("a1", "admin");
const old = await rpc("semis_logi_ksync_agent_new", "old", "::text");
await rpc("semis_logi_ksync_agent_revoke", old.id, "::bigint");
await as(null);
eq((await call("hello", {}, { hash: sha(old.key), ip: "198.51.100.9" })).error, "auth", "폐기 키");
eq(await one("select kind from semis_logi_private.ksync_events where ip = '198.51.100.9'"), "revoked_key", "revoked_key 기록");
eq(JSON.stringify(await call("hello", {}, { hash: H64("1") })).includes("revoked"), false, "응답은 짧은 코드만");

// 4. 허용 IP 비어 있음 → hello 만(후보 IP), 다른 동작은 ip_denied
r = await call("hello", { ver: "1.61.0", host: "Mac\u0007 mini" });
eq([r.ok, r.allow, r.maps], [true, false, undefined], "빈 허용 목록 hello = 설정만");
eq(await one("select ip_seen -> 0 ->> 'ip' from semis_logi_private.ksync_state"), IP, "후보 IP");
eq(await one("select host_label from semis_logi_private.ksync_agents where id = $1", [AG]), "Mac mini", "호스트 이름 정리");
eq((await call("folders", { list: [] })).error, "ip", "다른 동작 거절");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'ip_denied'"), 1, "ip_denied");
eq((await call("net", { ok: false, msg: "445 연결 안 됨" }, { ip: "192.0.2.50" })).ok, true, "연결 안 됨 보고는 회사 밖에서도");
eq(await one("select result from semis_logi_private.ksync_runs order by id desc limit 1"), "offline", "offline 줄");
await call("net", { ok: false, msg: "다시" }, { ip: "192.0.2.50" });
eq(await one("select count(*)::int from semis_logi_private.ksync_runs where result = 'offline'"), 1, "하루 한 줄");
eq(await one("select net ->> 'msg' from semis_logi_private.ksync_state"), "다시", "마지막 확인");

// 5. 설정 — 허용 IP 검사 · 승인
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_settings", { ip_allow: ["0.0.0.0/0"] })).error, "ip", "너무 넓은 범위 거절");
eq((await rpc("semis_logi_ksync_settings", { ip_allow: ["nope"] })).error, "ip", "형식");
eq((await rpc("semis_logi_ksync_settings", { daily_at: "25:00" })).error, "daily_at", "시각 형식");
eq((await rpc("semis_logi_ksync_settings", { mass_limit: { files: 0, ratio: 0.3 } })).error, "mass_limit", "한도 형식");
eq((await rpc("semis_logi_ksync_settings", { daily_at: "07:50", ip_allow: ["198.51.100.0/24"], mass_limit: { files: 200, ratio: 0.3 } })).ok, true, "설정 저장");
eq(await one("select ip_allow from semis_logi_private.ksync_state"), ["198.51.100.0/24"], "CIDR 저장");
r = await rpc("semis_logi_ksync_ip_approve", IP, "::text");
eq([r.ok, r.cidr], [true, IP + "/32"], "후보 IP 허용");
eq(await one("select jsonb_array_length(ip_seen) from semis_logi_private.ksync_state"), 0, "후보에서 빠짐");
await as(null);
eq((await call("hello", {}, { ip: "192.0.2.50" })).error, "ip", "허용 밖 hello 거절");
r = await call("hello", { full: true });
eq([r.ok, r.allow, r.daily_at, r.maps.length, r.lists.length], [true, true, "07:50", 0, 0], "허용 IP hello");
eq(await one("select net ->> 'ok' from semis_logi_private.ksync_state"), "true", "사내망 연결됨");

// 6. 연결 저장 검사
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_map_save", { k_path: "/abs", mod: "audit", grp: "checklist" })).error, "k_path", "절대 경로");
eq((await rpc("semis_logi_ksync_map_save", { k_path: "a/../b", mod: "audit", grp: "checklist" })).error, "k_path", "상위 이동");
eq((await rpc("semis_logi_ksync_map_save", { k_path: "a/_H드라이브_휴지통", mod: "audit", grp: "checklist" })).error, "k_path", "휴지통 폴더");
eq((await rpc("semis_logi_ksync_map_save", { k_path: "안전/점검", mod: "Bad Mod", grp: "x" })).error, "target", "화면 id 형식");
r = await rpc("semis_logi_ksync_map_save", { k_path: "안전보안/점검표", mod: "audit", grp: "checklist", dir: "both" });
ok(r.ok, "연결 추가"); const M1 = r.id;
eq((await rpc("semis_logi_ksync_map_save", { k_path: "안전보안/점검표/2026", mod: "audit", grp: "plan" })).error, "k_dup", "겹치는 폴더");
eq((await rpc("semis_logi_ksync_map_save", { k_path: "다른", mod: "audit", grp: "checklist" })).error, "target_dup", "같은 화면 · 분류");
r = await rpc("semis_logi_ksync_map_save", { k_path: "보안/SSI", mod: "audit", grp: "misc", ssi: true });
const M2 = r.id;
eq(await one("select requested_at is not null from semis_logi_private.ksync_state"), true, "새 연결 → 미리보기 요청");

// 7. 미리보기 → 시작
await as(null);
r = await call("run", { phase: "start", trigger: "manual" });
const RUN1 = r.run; ok(RUN1 > 0, "회차 시작");
eq(await one("select requested_at from semis_logi_private.ksync_state"), null, "요청 표시 지움");
eq((await call("preview", { map: M1, counts: { k2h: 3, h2k: 1, link: 0, del: 0, total: 4, bogus: 9 } })).ok, true, "미리보기 건수");
eq(await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [M1]), { del: 0, h2k: 1, k2h: 3, link: 0, skip: 0, total: 4, conflict: 0 }, "건수만 저장");
eq((await call("put", { run: RUN1, map: M1, rel_path: "a.xlsx", size: 1, sha256: H64("a"), mtime: "2026-11-04T01:00:00Z", mode: "new", path: "docs/abcdefghijkl_a.xlsx" })).error, "state", "미리보기 연결은 실행 안 됨");
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_map_start", M1, "::bigint")).ok, true, "시작");
eq(await one("select hold ->> 'ok' from semis_logi_private.ksync_maps where id = $1", [M1]), "true", "첫 실행 승인");
await rpc("semis_logi_ksync_map_start", M2, "::bigint");

// 8. K→H 새 문서 — 문서함 모양 그대로, 공용 행 트리거 · 이력 · 알림
await as(null);
await db.query("insert into public.semis_logi_store(key, value, updated_by) values ('docs', $1::jsonb, 'x')", [JSON.stringify([
  { id: "d-h1", mod: "audit", grp: "checklist", title: "H 문서", date: "2026-10-01", ser: "", org: "", note: "", ssi: false, mids: ["2.7"], files: [{ name: "h.pdf", size: 5, url: PUB + "docs/aaaaaaaaaaaa_h.pdf" }], at: "2026-10-01T00:00:00.000Z", by: "가" },
  { id: "d-other", mod: "partners", grp: "x", title: "남의 화면", date: "2026-10-01", files: [{ name: "o.pdf", size: 5, url: PUB + "docs/bbbbbbbbbbbb_o.pdf" }] },
  { id: "d-ssi", mod: "audit", grp: "checklist", title: "SSI", date: "2026-10-02", ssi: true, files: [{ name: "s.pdf", size: 5, url: PUB + "docs-ssi/cccccccccccc_s.pdf" }] },
  { id: "d-exe", mod: "audit", grp: "checklist", title: "실행", date: "2026-10-03", files: [{ name: "tool.exe", size: 5, url: PUB + "docs/dddddddddddd_tool.exe" }] }
])]);
const at0 = await one("select updated_at from public.semis_logi_store where key = 'docs'");
const shaA = H64("a");
const begin = (rel, o) => call("put", Object.assign({ run: RUN1, map: M1, rel_path: rel, size: 10, sha256: shaA, mtime: "2026-11-03T16:30:00Z", mode: "new", path: "docs/abcdefghijkl" + Math.random().toString(36).slice(2, 8) + "_f.xlsx" }, o || {}));
eq((await begin("../x.xlsx")).error, "bad", "경로 탈출");
eq((await begin("a/./b.xlsx")).error, "bad", "점 경로");
eq((await begin("a:b.xlsx")).error, "bad", "드라이브 표시");
eq((await begin("big.zip", { size: 50 * 1024 * 1024 + 1 })).error, "too_large", "50MB 초과");
eq((await begin("page.html")).error, "type", "html 은 H 로 안 올림");
eq((await begin("ok.xlsx", { path: "docs-ssi/abcdefghijkl_x.xlsx" })).error, "bad", "SSI 아닌 연결은 docs/");
eq((await begin("ok.xlsx", { path: "../docs/x" })).error, "bad", "경로 형식");
eq((await begin("ok.xlsx", { run: 999 })).error, "run", "회차 없음");
const P1 = "docs/abcdefghijklmn_2026.xlsx";
eq((await begin("점검/2026 점검표.xlsx", { path: P1 })).ok, true, "올리기 시작");
eq((await call("put_peek", { path: P1 })).sha256, shaA, "확인할 해시");
eq((await call("put_peek", { path: "docs/zzzzzzzzzzzz_z.xlsx" })).error, "state", "모르는 경로");
eq((await call("put_commit", { path: P1, sha256: shaA, size: 10, url: PUB + "docs/other_x.xlsx" })).error, "bad", "주소와 경로가 다름");
r = await call("put_commit", { path: P1, sha256: shaA, size: 10, url: PUB + P1 });
ok(r.ok && /^ks[0-9a-f]{12}$/.test(r.doc), "등록 " + JSON.stringify(r));
let D = await docs();
const nd = D.find(d => d.id === r.doc);
eq(Object.keys(nd).sort().join(","), "at,by,date,files,grp,id,mids,mod,note,org,ser,src,ssi,title", "문서 칸");
eq([nd.mod, nd.grp, nd.title, nd.date, nd.ser, nd.ssi, nd.src, nd.by, nd.files.map(f => [f.name, f.size, f.url])], ["audit", "checklist", "2026 점검표", "2026-11-04", "점검/2026 점검표.xlsx", false, "ksync", "K드라이브 동기화",
  [["2026 점검표.xlsx", 10, PUB + P1]]], "문서 모양(날짜 = K 수정 시각 한국 날짜)");
ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(nd.at) && Array.isArray(nd.mids) && nd.org === "" && nd.note === "", "at(ISO) · mids · org · note");
eq(D[D.length - 1].id, nd.id, "새 문서는 맨 뒤");
const at1 = await one("select updated_at from public.semis_logi_store where key = 'docs'");
ok(new Date(at1) > new Date(at0), "updated_at 은 앞으로만");
eq(await one("select updated_by from public.semis_logi_store where key = 'docs'"), "anon/ksync", "작성자 표시");
eq(await one("select by from public.test_notify where key = 'docs' order by id desc limit 1"), "ksync", "변경 알림");
eq(await one("select count(*)::int from public.test_hist where key = 'docs'"), 1, "이력 남음");
let B = await one("select to_jsonb(f) from semis_logi_private.ksync_files f where map_id = $1 and rel_path = $2", [M1, "점검/2026 점검표.xlsx"]);
eq([B.k_sha256, B.doc_id, B.ser, B.h_url, B.h_name, B.state], [shaA, nd.id, nd.ser, PUB + P1, "2026 점검표.xlsx", "ok"], "기준선");
eq((await call("put_commit", { path: P1, sha256: shaA, size: 10, url: PUB + P1 })).error, "state", "같은 확인 두 번 불가");

// 8-1. 해시 불일치
const P2 = "docs/abcdefghijklmn_bad.xlsx";
await begin("bad.xlsx", { path: P2 });
eq((await call("put_commit", { path: P2, sha256: H64("b"), size: 10, url: PUB + P2 })).error, "hash", "해시 불일치");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'hash_mismatch'"), 1, "hash_mismatch 기록");

// 9. 열린 화면 — 옛 기준으로 저장하면 409, 새 기준이면 저장
await as("u9", "hq");
ok(await raises(() => db.query("update public.semis_logi_store set value = '[]'::jsonb, base_at = $1 where key = 'docs'", [at0]), "PT409"), "옛 기준 저장 409");
const at2 = await one("select updated_at from public.semis_logi_store where key = 'docs'");
D = await docs();
await db.query("update public.semis_logi_store set value = $1::jsonb, base_at = $2 where key = 'docs'", [JSON.stringify(D), at2]);
ok(new Date(await one("select updated_at from public.semis_logi_store where key = 'docs'")) > new Date(at2), "새 기준 저장 됨");
await as(null);

// 10. K 만 바뀜 → 같은 ser 새 판(맨 앞 · 날짜 ≥ · 제목 · 체크리스트 번호 유지)
await db.query("update public.semis_logi_store set value = jsonb_set(value, '{4,title}', '\"점검표(편집)\"') where key = 'docs'");
const shaV = H64("c"), P3 = "docs/abcdefghijklmn_v2.xlsx";
eq((await begin("점검/2026 점검표.xlsx", { path: P3, mode: "version" })).error, "bad", "새 판은 기준선 줄 필요");
eq((await begin("점검/2026 점검표.xlsx", { path: P3, mode: "version", row: B.id, sha256: shaV, size: 12, mtime: "2026-10-01T01:00:00Z" })).ok, true, "새 판 시작");
r = await call("put_commit", { path: P3, sha256: shaV, size: 12, url: PUB + P3 });
D = await docs();
eq(D[0].id, r.doc, "새 판은 맨 앞");
eq([D[0].ser, D[0].title, D[0].date], [nd.ser, "점검표(편집)", "2026-11-04"], "같은 ser · 지금 제목 · 날짜는 현재 판보다 이르지 않게");
eq(await one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'checklist', $2) ->> 'id'", [JSON.stringify(D), nd.ser]), r.doc, "현재 판 = 새 판");
B = await one("select to_jsonb(f) from semis_logi_private.ksync_files f where id = $1", [B.id]);
eq([B.k_sha256, B.doc_id, B.h_url, B.k_size], [shaV, r.doc, PUB + P3, 12], "기준선 갱신");
// 이전 판으로 남기기(충돌 — H 가 이김) → 맨 뒤 · 현재 판 아님 · 기준선 그대로
const P4 = "docs/abcdefghijklmn_old.xlsx";
await begin("점검/2026 점검표.xlsx", { path: P4, mode: "old", row: B.id, sha256: H64("d"), size: 3, mtime: "2026-12-01T00:00:00Z" });
r = await call("put_commit", { path: P4, sha256: H64("d"), size: 3, url: PUB + P4 });
D = await docs();
eq([D[D.length - 1].id, D[D.length - 1].date], [r.doc, "2026-11-04"], "이전 판은 맨 뒤 · 날짜는 현재 판보다 늦지 않게");
ok(await one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'checklist', $2) ->> 'id'", [JSON.stringify(D), nd.ser]) !== r.doc, "현재 판 아님");
eq(await one("select k_sha256 from semis_logi_private.ksync_files where id = $1", [B.id]), shaV, "기준선 그대로");

// 11. hello full — H 쪽 현재 판 목록(판 묶음마다 하나) · 기준선
r = await call("hello", { full: true });
const L1 = r.lists.find(l => l.map === M1);
eq(L1.h.map(x => x.doc).sort(), [D[0].id, "d-exe", "d-h1"].sort(), "현재 판만 · 다른 화면 문서 · SSI(SSI 아닌 연결) 없음");
ok(!JSON.stringify(r).includes("d-other"), "연결 밖 문서 안 줌");
eq(L1.base.length, 1, "기준선 1");
eq(r.maps.map(m => m.state), ["active", "active"], "연결 상태");

// 12. 내려받기 — 범위 · SSI · 형식
eq((await call("get", { run: RUN1, map: M1, doc: "d-h1", url: PUB + "docs/aaaaaaaaaaaa_h.pdf" })).path, "docs/aaaaaaaaaaaa_h.pdf", "범위 안");
eq((await call("get", { run: RUN1, map: M1, doc: "d-other", url: PUB + "docs/bbbbbbbbbbbb_o.pdf" })).error, "scope", "연결 밖 문서");
eq((await call("get", { run: RUN1, map: M1, doc: "d-h1", url: PUB + "docs/bbbbbbbbbbbb_o.pdf" })).error, "scope", "다른 문서 파일 주소");
eq((await call("get", { run: RUN1, map: M1, doc: "d-ssi", url: PUB + "docs-ssi/cccccccccccc_s.pdf" })).error, "scope", "SSI 아닌 연결은 SSI 문서 안 줌");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'scope'"), 3, "scope 기록 3");
eq((await call("get", { run: RUN1, map: M1, doc: "d-exe", url: PUB + "docs/dddddddddddd_tool.exe" })).error, "type", "실행 파일 차단");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'type_block'"), 1, "type_block 기록");
await call("get", { run: RUN1, map: M1, doc: "d-exe", url: PUB + "docs/dddddddddddd_tool.exe" });
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'type_block'"), 1, "같은 파일 차단은 30일에 한 번 기록");
await db.query("update public.semis_logi_store set value = value || $1::jsonb where key = 'docs'", [JSON.stringify([{ id: "d-ssi2", mod: "audit", grp: "misc", ssi: true, title: "s2", date: "2026-10-02", files: [{ name: "s2.pdf", size: 1, url: PUB + "docs-ssi/eeeeeeeeeeee_s2.pdf" }] }])]);
eq((await call("get", { run: RUN1, map: M2, doc: "d-ssi2", url: PUB + "docs-ssi/eeeeeeeeeeee_s2.pdf" })).ok, true, "SSI 연결은 SSI 문서");
const P5 = "docs-ssi/abcdefghijklmn_k.pdf";
eq((await call("put", { run: RUN1, map: M2, rel_path: "k.pdf", size: 1, sha256: shaA, mtime: "2026-11-01T00:00:00Z", mode: "new", path: P5 })).ok, true, "SSI 연결은 docs-ssi/");
r = await call("put_commit", { path: P5, sha256: shaA, size: 1, url: PUB + P5 });
eq((await docs()).find(d => d.id === r.doc).ssi, true, "ssi: true");

// 13. 기준선 · 상태
r = await call("mark", { run: RUN1, map: M1, items: [{ op: "set", rel_path: "h.pdf", k_size: 5, k_mtime: "2026-11-01T00:00:00Z", k_sha256: H64("e"), doc_id: "d-h1", h_url: PUB + "docs/aaaaaaaaaaaa_h.pdf" },
  { op: "set", rel_path: "o.pdf", k_size: 5, k_mtime: "2026-11-01T00:00:00Z", k_sha256: H64("e"), doc_id: "d-other", h_url: PUB + "docs/bbbbbbbbbbbb_o.pdf" },
  { op: "nope" }, { op: "event", kind: "bad_key" }, { op: "event", kind: "hash_mismatch", f: "x.pdf" }] });
eq([r.n, r.bad], [2, 3], "범위 밖 문서 기준선 거절 · 모르는 동작 거절");
const RH = await one("select id from semis_logi_private.ksync_files where map_id = $1 and rel_path = 'h.pdf'", [M1]);
eq(await one("select ser || '|' || h_name from semis_logi_private.ksync_files where id = $1", [RH]), "d-h1|h.pdf", "ser = 문서 id(ser 없음) · 이름은 서버 값");
r = await call("mark", { run: RUN1, map: M1, items: [{ op: "rename", id: B.id, rel_path: "점검/2026 정기 점검표.xlsx" }] });
eq(r.n, 1, "이름 바꿈");
eq(await one("select rel_path from semis_logi_private.ksync_files where id = $1", [B.id]), "점검/2026 정기 점검표.xlsx", "기준선 경로");
D = await docs();
eq(D.filter(d => d.ser === nd.ser).map(d => d.title).sort(), ["점검표(편집)", "점검표(편집)", "점검표(편집)"].sort(), "제목이 파일 이름이 아니면 그대로");
await call("mark", { run: RUN1, map: M1, items: [{ op: "rename", id: RH, rel_path: "H 문서.pdf" }] });
await db.query("update public.semis_logi_store set value = jsonb_set(value, '{0,title}', '\"2026 정기 점검표\"') where key = 'docs'");
eq(await one("select ser from semis_logi_private.ksync_files where id = $1", [RH]), "d-h1", "");
// 제목 = 옛 파일 이름이면 새 이름으로
const tid = await one("select id from semis_logi_private.ksync_files where map_id = $1 and rel_path = 'H 문서.pdf'", [M1]);
await call("mark", { run: RUN1, map: M1, items: [{ op: "rename", id: tid, rel_path: "새 이름.pdf" }] });
eq((await docs()).find(d => d.id === "d-h1").title, "새 이름", "제목 = 옛 파일 이름 → 새 이름");

// 14. 대량 변경 보류(서버도 셈) — 한도 2건
await as("a1", "admin");
await rpc("semis_logi_ksync_settings", { mass_limit: { files: 2, ratio: 0.3 } });
await as(null);
await call("run", { phase: "end", run: RUN1, result: "ok", maps: [{ id: M1, done: true, n_files: 3 }, { id: M2, done: true }] });
eq(await one("select hold from semis_logi_private.ksync_maps where id = $1", [M1]), null, "끝나면 첫 실행 승인 지움");
const RUN2 = (await call("run", { phase: "start", trigger: "daily" })).run;
for (const id of [B.id, RH]) eq((await call("mark", { run: RUN2, map: M1, items: [{ op: "state", id, state: "del_k" }] })).n, 1, "삭제 대기 " + id);
const R3 = (await call("mark", { run: RUN2, map: M1, items: [{ op: "set", rel_path: "z.pdf", k_size: 1, k_mtime: "2026-11-01T00:00:00Z", k_sha256: H64("f"), doc_id: "d-exe", h_url: PUB + "docs/dddddddddddd_tool.exe" }] }));
const RZ = await one("select id from semis_logi_private.ksync_files where map_id = $1 and rel_path = 'z.pdf'", [M1]);
r = await call("mark", { run: RUN2, map: M1, items: [{ op: "state", id: RZ, state: "del_h" }] });
eq([r.n, r.held], [0, true], "세 번째 변경 → 보류");
eq(await one("select hold ->> 'n' from semis_logi_private.ksync_maps where id = $1", [M1]), "3", "연결 보류 표시");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'mass_hold'"), 1, "mass_hold 기록");
eq((await begin("점검/2026 정기 점검표.xlsx", { run: RUN2, path: "docs/abcdefghijklmn_v3.xlsx", mode: "version", row: B.id, sha256: H64("9") })).error, "held", "보류 중 새 판 거절");
await call("run", { phase: "end", run: RUN2, result: "held", maps: [{ id: M1, held: true, n: 3, base: 3 }] });
await as("a1", "admin");
r = await rpc("semis_logi_ksync_status");
eq([r.alert, r.counts.hold], [true, 1], "상태 경고(보류)");
r = await rpc("semis_logi_ksync_pending");
eq([r.holds.length, r.holds[0].run], [1, RUN2], "확인 필요 — 보류");
eq((await rpc("semis_logi_ksync_hold", { run_id: String(RUN2), act: "approve" })).ok, true, "승인");
eq(await one("select hold ->> 'ok' from semis_logi_private.ksync_maps where id = $1", [M1]), "true", "승인 표시");
await as(null);
const RUN3 = (await call("run", { phase: "start", trigger: "manual" })).run;
eq((await call("mark", { run: RUN3, map: M1, items: [{ op: "state", id: RZ, state: "del_h" }] })).n, 1, "승인 뒤 진행");
await call("run", { phase: "end", run: RUN3, result: "ok", maps: [{ id: M1, done: true }] });
eq(await one("select hold from semis_logi_private.ksync_maps where id = $1", [M1]), null, "승인 한 번 쓰고 지움");

// 15. 확인 필요 — 삭제 확정 · 복원 · 확인
await as("a1", "admin");
r = await rpc("semis_logi_ksync_pending");
eq(r.files.map(f => f.state).sort(), ["del_h", "del_k", "del_k"], "삭제 대기 3");
const before = (await docs()).length;
eq((await rpc("semis_logi_ksync_resolve", { ids: [B.id], act: "confirm" })).n, 1, "K 삭제 확정");
D = await docs();
eq(D.filter(d => d.ser === nd.ser).length, 0, "판 묶음 문서 모두 지움");
eq(D.length, before - 3, "그 판 3개만");
eq(await one("select count(*)::int from semis_logi_private.ksync_files where id = $1", [B.id]), 0, "기준선 줄 지움");
eq((await rpc("semis_logi_ksync_resolve", { ids: [RZ], act: "confirm" })).n, 1, "H 삭제 확정");
eq(await one("select state from semis_logi_private.ksync_files where id = $1", [RZ]), "trash", "K 파일은 휴지통으로(에이전트)");
eq((await rpc("semis_logi_ksync_resolve", { ids: [RH], act: "restore" })).n, 1, "복원");
eq(await one("select state from semis_logi_private.ksync_files where id = $1", [RH]), "restore", "복원 표시");
eq((await rpc("semis_logi_ksync_resolve", { ids: [RH], act: "dismiss" })).n, 0, "삭제 대기 아님 → 확인 안 됨");
await db.query("update semis_logi_private.ksync_files set state = 'conflict' where id = $1", [RH]);
eq((await rpc("semis_logi_ksync_resolve", { ids: [RH], act: "dismiss" })).n, 1, "충돌 확인");
eq(await one("select updated_by from public.semis_logi_store where key = 'docs'"), "a1/ksync", "관리자 세션에서 고쳐도 충돌 확인 통과");

// 16. 횟수 제한 — 분당 · 하루 전송량 · 키 실패 IP 차단
await db.exec(`update semis_logi_private.ksync_state set limits = '{"perMin": 3, "dayBytes": 100}'::jsonb`);
await db.exec("update semis_logi_private.ksync_agents set min_at = null, min_n = 0, day_kst = null, day_bytes = 0");
await as(null);
for (let i = 0; i < 3; i++) await call("hello", {});
eq((await call("hello", {})).error, "rate", "분당 상한");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'rate' and detail ->> 'why' = 'min'"), 1, "rate 기록");
await db.exec(`update semis_logi_private.ksync_state set limits = '{"perMin": 300, "dayBytes": 100}'::jsonb`);
await db.exec("update semis_logi_private.ksync_agents set min_at = null");
const RUN4 = (await call("run", { phase: "start" })).run;
eq((await call("put", { run: RUN4, map: M1, rel_path: "q.pdf", size: 101, sha256: shaA, mtime: "2026-11-01T00:00:00Z", mode: "new", path: "docs/abcdefghijklmn_q.pdf" })).error, "quota", "하루 전송량");
const BAD = "203.0.113.99";
for (let i = 0; i < 11; i++) await call("hello", {}, { hash: H64("7"), ip: BAD });
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'rate' and ip = $1", [BAD]), 1, "키 실패 10회 넘음 → 차단");
const nEv = await one("select count(*)::int from semis_logi_private.ksync_events where ip = $1", [BAD]);
eq((await call("hello", {}, { ip: BAD })).error, "rate", "차단된 IP 는 맞는 키도 거절");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where ip = $1", [BAD]), nEv, "차단 중에는 기록 안 늘어남");
eq((await call("hello", {})).ok, true, "다른 IP 는 그대로");

// 17. 회차 끝 — 기록 정리 · 폴더 목록
r = await call("run", { phase: "end", run: RUN4, result: "partial", k2h: 2, errors: "x", msg: "끝\u0001", detail: [{ m: M1, f: "a.xlsx", a: "k2h", r: "" }, { a: "rm -rf" }, "x", { m: 1, f: "b".repeat(300), a: "skip", r: "too_large" }] });
const run4 = await one("select to_jsonb(r) from semis_logi_private.ksync_runs r where id = $1", [RUN4]);
eq([run4.result, run4.k2h, run4.errors, run4.msg, run4.detail.length, run4.detail[1].f.length], ["partial", 2, 0, "끝", 2, 200], "회차 기록 정리");
eq((await call("run", { phase: "end", run: RUN4, result: "ok" })).error, "run", "끝난 회차 다시 못 씀");
r = await call("folders", { list: [{ path: "안전보안", n: 3 }, { path: "안전보안/점검표", n: 12 }, { path: "a/b/c/d" }, { path: "../x" }, { path: "a\\b" }] });
eq(r.n, 2, "폴더 3단계까지 · 잘못된 경로 빼기");
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_folders")).folders.map(f => f.path), ["안전보안", "안전보안/점검표"], "폴더 목록");
r = await rpc("semis_logi_ksync_runs", { limit: 5 });
ok(r.runs.length >= 4 && !("cnt" in r.runs[0]), "실행 기록");
r = await rpc("semis_logi_ksync_events", { kind: "scope" });
eq(r.events.length, 4, "종류별 거르기");
ok(r.counts.bad_key >= 13, "종류별 건수");
eq((await rpc("semis_logi_ksync_status")).counts.ev_new, 0, "본 뒤 새 이벤트 0");

// 18. 오래 성공이 없으면 경고 · 연결 지우기는 기준선만
await db.exec("update semis_logi_private.ksync_runs set started_at = started_at - interval '3 days', ended_at = ended_at - interval '3 days'");
await db.exec("update semis_logi_private.ksync_maps set updated_at = now() - interval '5 days'");
r = await rpc("semis_logi_ksync_status");
eq([r.stale, r.alert], [true, true], "이틀 넘게 성공 없음");
const nDocs = (await docs()).length;
eq((await rpc("semis_logi_ksync_map_delete", M2, "::bigint")).ok, true, "연결 지우기");
eq([(await docs()).length, await one("select count(*)::int from semis_logi_private.ksync_files where map_id = $1", [M2])], [nDocs, 0], "H 문서는 그대로 · 기준선만");
eq((await rpc("semis_logi_ksync_map_save", { id: M1, k_path: "다른 폴더", mod: "audit", grp: "checklist" })).error, "locked", "맞춘 파일이 있으면 폴더 못 바꿈");
eq((await rpc("semis_logi_ksync_map_save", { id: M1, pause: true })).ok, true, "멈춤");
await as(null);
r = await call("hello", { full: true });
eq([r.maps.find(m => m.id === M1).state, r.lists.length], ["paused", 0], "멈춘 연결은 목록 안 줌");
eq(await one("select semis_logi_private.ksync_rel($1)", ["가".normalize("NFD") + "/b.pdf"]), "가/b.pdf", "NFD → NFC");
eq(await one("select semis_logi_private.ksync_k_blocked('a.COMMAND')"), true, "형식 차단 대소문자");

console.log(`ksync SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
