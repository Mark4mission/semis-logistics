// ARGOS — 아르고 사용량 SQL 로컬 검증 (PGlite, 세션 함수 ctx() 는 시험 표로 흉내)
// 실행: mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-argo.test.mjs . && node semis-logi-argo.test.mjs <저장소>/tools/sql/semis-logi-argo.sql
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const SQL = fs.readFileSync(process.argv[2], "utf8");
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b));
const one = async (q, p) => { const r = await db.query(q, p || []); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; };
const as = async (id, role, kind) => {
  await db.exec("delete from semis_logi_private.test_ctx");
  if (id) await db.query("insert into semis_logi_private.test_ctx values ($1, $2, $3)", [id, role, kind || "user"]);
};

await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema semis_logi_private;
  create table semis_logi_private.accounts (id text primary key, login_id text, name text, role text);
  create table semis_logi_private.settings (k text primary key, v jsonb not null, updated_at timestamptz not null default now());
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create function semis_logi_private.rank_of(p_role text) returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2 when 'user' then 1 when 'vendor' then 1 else 0 end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N-' || t.account_id,
      case when t.kind = 'signer' then 'signer' else t.role end,
      case when t.kind = 'signer' then 0 else semis_logi_private.rank_of(t.role) end, t.kind, null from semis_logi_private.test_ctx t $$;
  insert into semis_logi_private.accounts values ('u1','u1','사용자','user'), ('h1','h1','파트','hq'), ('v1','v1','업체','vendor'), ('a1','a1','관리','admin');
`);
await db.exec(SQL);

// 1. 세션 없음 · 서명 세션 · 협력업체 거절
await as(null);
eq((await one("select public.semis_logi_argo_begin()")).error, "auth", "세션 없음");
await as("u1", "user", "signer");
eq((await one("select public.semis_logi_argo_begin()")).error, "auth", "서명 세션");
await as("v1", "vendor");
eq((await one("select public.semis_logi_argo_begin()")).error, "forbidden", "협력업체");
eq(await one("select count(*)::int from semis_logi_private.argo_usage"), 0, "거절은 기록 안 함");

// 2. 내부 계정 — 호출 수 +1, 등급 · 이름
await as("u1", "user");
let r = await one("select public.semis_logi_argo_begin()");
eq([r.ok, r.rank, r.role, r.used, r.limit], [true, 1, "user", 1, 200], "user 첫 호출");
r = await one("select public.semis_logi_argo_begin()");
eq(r.used, 2, "두 번째 호출");

// 3. 한도 — 호출 수
await db.exec(`update semis_logi_private.settings set v = '{"calls": 3, "tokIn": 5000000}' where k = 'argo'`);
r = await one("select public.semis_logi_argo_begin()");
eq([r.ok, r.used], [true, 3], "세 번째 = 한도");
r = await one("select public.semis_logi_argo_begin()");
eq([r.ok, r.error, r.used, r.limit], [false, "limit", 3, 3], "한도 넘음");
eq(await one("select calls from semis_logi_private.argo_usage where account_id = 'u1'"), 3, "넘은 호출은 세지 않음");

// 4. 다른 계정은 따로
await as("h1", "hq");
r = await one("select public.semis_logi_argo_begin()");
eq([r.ok, r.used, r.rank], [true, 1, 3], "hq 따로 셈");

// 5. 토큰 — 자기 줄에만, 음수 · 과대값 제한, 입력 토큰 한도
await one("select public.semis_logi_argo_meter(1200, 300, 5000)");
await one("select public.semis_logi_argo_meter(-50, 99999999, null)");
const h = (await db.query("select tok_in, tok_out, tok_cache from semis_logi_private.argo_usage where account_id = 'h1'")).rows[0];
eq([Number(h.tok_in), Number(h.tok_out), Number(h.tok_cache)], [1200, 300 + 200000, 5000], "토큰 누적 · 범위");
eq(Number(await one("select tok_in from semis_logi_private.argo_usage where account_id = 'u1'")), 0, "다른 계정 줄은 그대로");
await db.exec(`update semis_logi_private.settings set v = '{"calls": 200, "tokIn": 1000}' where k = 'argo'`);
r = await one("select public.semis_logi_argo_begin()");
eq([r.ok, r.error], [false, "limit"], "입력 토큰 한도");

// 6. 사용량 보기 — 시스템관리자만
eq((await one("select public.semis_logi_argo_usage(7)")).error, "forbidden", "hq 는 사용량 못 봄");
await as("a1", "admin");
r = await one("select public.semis_logi_argo_usage(7)");
eq([r.ok, r.rows.length, r.rows[0].id], [true, 2, "u1"], "admin 사용량(많이 쓴 순)");

// 7. 날짜 기준 KST
eq(await one("select semis_logi_private.argo_day() = (now() at time zone 'Asia/Seoul')::date"), true, "KST 날짜");

// 8. 실행 권한
const ex = async (fn) => (await db.query(`select array(select r.rolname::text from pg_roles r where has_function_privilege(r.oid, '${fn}', 'execute') and r.rolname in ('anon','authenticated','service_role') order by 1) a`)).rows[0].a;
eq(await ex("public.semis_logi_argo_begin()"), ["anon", "service_role"], "begin 실행 권한");
eq(await ex("public.semis_logi_argo_meter(int,int,int)"), ["anon", "service_role"], "meter 실행 권한");
eq(await ex("public.semis_logi_argo_usage(int)"), ["anon", "service_role"], "usage 실행 권한");

console.log(`argo SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
