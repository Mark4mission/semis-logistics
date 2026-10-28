// H:drive — 설정성 자료 = 시스템관리자 SQL 로컬 검증 (PGlite, 세션 함수 ctx() 는 시험 표로 흉내)
// 실행: mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-admin-cfg.test.mjs . && node semis-logi-admin-cfg.test.mjs <저장소>/tools/sql/semis-logi-admin-cfg.sql
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
const get = (k) => one("select value from public.semis_logi_store where key = $1", [k]);
const put = (k, v) => db.query("update public.semis_logi_store set value = $2::jsonb where key = $1", [k, JSON.stringify(v)]);
const ins = (k, v) => db.query("insert into public.semis_logi_store(key, value) values ($1, $2::jsonb)", [k, JSON.stringify(v)]);
const seed = async () => {
  await as(null);
  await db.exec("delete from public.semis_logi_store");
  await ins("phonebook", { asOf: "26.10", groups: [{ id: "g1", name: "가" }], rows: [{ id: "r1", name: "갑" }] });
  await ins("threat", { title: "절차", steps: [{ id: "s1" }], form: { title: "양식", secs: [{ id: "a" }] } });
  await ins("desk", { cfg: { areas: { security: "가" } }, log: [] });
  await ins("schedules", [{ id: "e1" }]);
};

await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  create schema semis_logi_private;
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create table semis_logi_private.key_acl (key text primary key, read_rank int not null, write_rank int not null);
  insert into semis_logi_private.key_acl values ('safetyBoard',1,3), ('levelHistory',1,3), ('fleet',1,3), ('minuteFolders',1,2),
    ('seclogCfg',2,3), ('patrolCfg',2,3), ('selfCheckCfg',2,3), ('phonebook',2,3), ('threat',2,3), ('desk',3,3), ('schedules',2,2), ('menus',1,4);
  create function semis_logi_private.rank_of(p_role text) returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2 when 'user' then 1 when 'vendor' then 1 else 0 end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N-' || t.account_id,
      case when t.kind = 'signer' then 'signer' else t.role end,
      case when t.kind = 'signer' then 0 else semis_logi_private.rank_of(t.role) end, t.kind, null from semis_logi_private.test_ctx t $$;
  create function semis_logi_private.rank_now() returns int language sql stable as $$
    select coalesce((select c.rank from semis_logi_private.ctx() c where c.kind = 'user' limit 1), -1) $$;
  create table public.semis_logi_store (key text primary key, value jsonb, updated_at timestamptz default now(), updated_by text);
`);
await db.exec(SQL);
await db.exec(SQL);   // 다시 실행해도 같은 결과

// 0. 권한표 · 권한
const acl = (await db.query("select key, read_rank, write_rank from semis_logi_private.key_acl order by key")).rows.map(r => r.key + ":" + r.read_rank + "/" + r.write_rank).join(",");
eq(acl, "desk:3/3,fleet:1/4,levelHistory:1/4,menus:1/4,minuteFolders:1/4,patrolCfg:2/4,phonebook:2/3,safetyBoard:1/4,schedules:2/2,seclogCfg:2/4,selfCheckCfg:2/4,threat:2/3", "설정 컬렉션 7개 = 쓰기 4, 나머지 그대로");
for (const f of ["semis_logi_private.guard_admin_fields()", "semis_logi_private.admin_field_path(text)"]) {
  eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", [f]), false, f + " anon 차단");
  eq(await one("select has_function_privilege('authenticated', $1, 'EXECUTE')", [f]), false, f + " authenticated 차단");
}
eq(await one("select count(*)::int from pg_trigger where tgname = 'semis_logi_store_1_admin'"), 1, "트리거 하나(다시 실행해도)");

// 1. hq — 구역은 서버 값 그대로, 나머지는 저장
await seed();
await as("hq1", "hq");
await put("phonebook", { asOf: "26.11", groups: [{ id: "g9", name: "바꾼 구역" }], rows: [{ id: "r1", name: "갑" }, { id: "r2", name: "을" }] });
let v = await get("phonebook");
eq(v.groups, [{ id: "g1", name: "가" }], "hq 구역 변경 → 서버 값 유지");
eq(v.rows.length, 2, "hq 연락처 줄 추가는 저장"); eq(v.asOf, "26.11", "기본 정보도 저장");
await put("phonebook", { asOf: "26.12", rows: [] });
v = await get("phonebook");
eq(v.groups, [{ id: "g1", name: "가" }], "hq 가 구역을 빼고 보내도 유지"); eq(v.rows, [], "연락처는 비움 저장");

// 2. manager · user 도 같음(쓰기 권한은 RLS 몫 — 트리거는 칸만)
await as("m1", "manager");
await put("phonebook", { groups: [], rows: [] });
eq((await get("phonebook")).groups, [{ id: "g1", name: "가" }], "manager 구역 유지");

// 3. 시스템관리자 · SQL(세션 없음)은 그대로 바뀜
await as("a1", "admin");
await put("phonebook", { groups: [{ id: "g2", name: "나" }], rows: [] });
eq((await get("phonebook")).groups, [{ id: "g2", name: "나" }], "admin 구역 변경");
await as(null);
await put("phonebook", { groups: [{ id: "g3", name: "다" }], rows: [] });
eq((await get("phonebook")).groups, [{ id: "g3", name: "다" }], "SQL · 서비스 권한 변경");

// 4. 보고양식 · 분야별 담당
await seed();
await as("hq1", "hq");
await put("threat", { title: "절차 2", steps: [{ id: "s1" }, { id: "s2" }], form: { title: "바꾼 양식", secs: [] } });
v = await get("threat");
eq(v.form, { secs: [{ id: "a" }], title: "양식" }, "hq 보고양식 변경 → 유지(jsonb 키 순서)"); eq(v.steps.length, 2, "STEP 은 저장"); eq(v.title, "절차 2");
await put("desk", { cfg: { areas: { security: "나" }, other: 1 }, log: [{ id: "l1" }] });
v = await get("desk");
eq(v.cfg, { areas: { security: "가" }, other: 1 }, "hq 분야별 담당 변경 → 유지(같은 칸의 다른 값은 저장)"); eq(v.log.length, 1, "기록은 저장");
await put("desk", { log: [] });
eq((await get("desk")).cfg, { areas: { security: "가" } }, "cfg 를 빼고 보내도 담당 유지");
await put("desk", { cfg: "x", log: [] });
eq((await get("desk")).cfg, { areas: { security: "가" } }, "cfg 모양이 틀려도 담당 유지");

// 5. 서버에 없던 칸을 hq 가 새로 넣으면 뺌 · 새 행(insert)도
await as(null);
await put("desk", { cfg: {}, log: [] });
await as("hq1", "hq");
await put("desk", { cfg: { areas: { dg: "다" } }, log: [] });
eq((await get("desk")).cfg, {}, "없던 담당을 hq 가 넣으면 뺌");
await as(null); await db.exec("delete from public.semis_logi_store where key = 'phonebook'");
await as("hq1", "hq");
await ins("phonebook", { groups: [{ id: "gx" }], rows: [{ id: "r1" }] });
v = await get("phonebook");
ok(!("groups" in v) && v.rows.length === 1, "hq 새 행 — 구역 칸 없이 저장: " + JSON.stringify(v));

// 6. 행 모양을 바꿔 덮기 → 거절 · 다른 컬렉션은 영향 없음
await seed();
await as("hq1", "hq");
let err = "";
try { await put("phonebook", [{ id: "r1" }]); } catch (e) { err = String(e.code || "") + " " + e.message; }
ok(/42501/.test(err) && /semis_admin_field/.test(err), "배열로 덮기 거절: " + err);
eq((await get("phonebook")).groups, [{ id: "g1", name: "가" }], "거절 뒤 그대로");
await put("schedules", [{ id: "e1" }, { id: "e2" }]);
eq((await get("schedules")).length, 2, "다른 컬렉션은 그대로 저장");
await put("phonebook", { groups: [{ id: "g1", name: "가" }], rows: [{ id: "r5" }] });
eq((await get("phonebook")).rows, [{ id: "r5" }], "구역이 같으면 그대로 저장");

console.log(`semis-logi-admin-cfg: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
