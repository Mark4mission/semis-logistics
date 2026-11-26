// H:drive — 계정별 메뉴 범위 SQL 로컬 검증 (PGlite, 세션 함수 ctx() 는 시험 표로 흉내)
// 실행: mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-scope.test.mjs . && node semis-logi-scope.test.mjs <저장소>
// 게시판 표 · 도우미는 tools/sql/semis-logi-bbs.sql 을 먼저 적용해 만든다(운영과 같은 순서). 범위 계산은 js/scope.js 와 결과를 대조한다.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const REPO = process.argv[2];
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const SCOPE_SQL = read("tools/sql/semis-logi-scope.sql");
const BBS_SQL = read("tools/sql/semis-logi-bbs.sql");
const SEC_SQL = read("tools/sql/semis-logi-security.sql");
const S = createRequire(import.meta.url)(path.join(REPO, "js/scope.js"));
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const eq = (a, b, m) => ok(JSON.stringify(canon(a)) === JSON.stringify(canon(b)), m + " — got " + JSON.stringify(canon(a)) + " want " + JSON.stringify(canon(b)));
const one = async (q, p) => { const r = await db.query(q, p || []); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; };
const as = async (id, role, kind) => {
  await db.exec("reset role; delete from semis_logi_private.test_ctx");
  if (id) await db.query("insert into semis_logi_private.test_ctx values ($1, $2, $3)", [id, role, kind || "user"]);
};
const call = (fn, arg) => one(`select public.${fn}($1::jsonb)`, [JSON.stringify(arg || {})]);
const setScope = (id, sc) => db.query("update semis_logi_private.accounts set scope = $2::jsonb where id = $1", [id, sc == null ? null : JSON.stringify(sc)]);
const URL0 = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/";

const ACL = (() => {
  const m = /insert into semis_logi_private\.key_acl\(key, read_rank, write_rank\) values([\s\S]*?)on conflict/.exec(SEC_SQL);
  const out = {};
  m[1].replace(/\('([^']+)',(\d+),(\d+)\)/g, (x, k, r, w) => { out[k] = [Number(r), Number(w)]; return x; });
  return out;
})();
ACL.caresCfg = ACL.caresCfg || [2, 9];

await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema semis_logi_private;
  create schema extensions;
  create schema realtime;
  create schema semis_v2_private;
  grant usage on schema semis_logi_private to anon, authenticated, service_role;
  create function realtime.send(p jsonb, e text, t text, x boolean) returns void language sql as $$ select null::void $$;
  create function extensions.gen_salt(text, int) returns text language sql as $$ select 'salt' $$;
  create function extensions.crypt(text, text) returns text language sql as $$ select md5($1) $$;
  create table semis_logi_private.accounts (id text primary key, login_id text, name text, role text, vendor text not null default '',
    pw_hash text, base boolean not null default false, disabled boolean not null default false,
    pw_changed_at timestamptz, last_login_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
  create table semis_logi_private.sessions (token_hash text, account_id text, expires_at timestamptz);
  create table semis_logi_private.audit (actor text, action text, detail jsonb, ip text, at timestamptz default now());
  create table semis_logi_private.key_acl (key text primary key, read_rank int not null, write_rank int not null);
  create table semis_logi_private.settings (k text primary key, v jsonb);
  create table semis_logi_private.argo_usage (account_id text, day date, calls int default 0, tok_in bigint default 0, updated_at timestamptz, primary key (account_id, day));
  create table public.semis_logi_store (key text primary key, value jsonb, updated_at timestamptz default now(), updated_by text);
  alter table public.semis_logi_store enable row level security;
  grant select, insert, update on public.semis_logi_store to anon, authenticated;
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  grant select on semis_logi_private.test_ctx to anon;
  create function semis_logi_private.rank_of(p_role text) returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2 when 'user' then 1 when 'vendor' then 1 else 0 end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable security definer as $$ select 'h', t.account_id, t.account_id, 'N-' || t.account_id,
      case when t.kind = 'signer' then 'signer' else t.role end,
      case when t.kind = 'signer' then 0 else semis_logi_private.rank_of(t.role) end, t.kind, null from semis_logi_private.test_ctx t $$;
  create function semis_logi_private.rank_now() returns int language sql stable security definer as $$
    select coalesce((select c.rank from semis_logi_private.ctx() c where c.kind = 'user' limit 1), -1) $$;
  create function semis_logi_private.read_rank(p_key text) returns int language sql stable security definer as $$
    select coalesce((select a.read_rank from semis_logi_private.key_acl a where a.key = p_key), 2) $$;
  create function semis_logi_private.write_rank(p_key text) returns int language sql stable security definer as $$
    select coalesce((select a.write_rank from semis_logi_private.key_acl a where a.key = p_key), 3) $$;
  grant execute on function semis_logi_private.rank_now(), semis_logi_private.read_rank(text), semis_logi_private.write_rank(text) to anon, authenticated;
  create function semis_logi_private.admin_ctx() returns table(account_id text, token_hash text) language sql stable security definer as $$
    select c.account_id, c.token_hash from semis_logi_private.ctx() c where c.kind = 'user' and c.rank >= 4 limit 1 $$;
  create function semis_logi_private.sign_view(p text) returns jsonb language sql as $$ select '{}'::jsonb $$;
  create function semis_logi_private.client_ip() returns text language sql as $$ select '127.0.0.1' $$;
  create function semis_logi_private.legacy_hash(p text) returns text language sql as $$ select 'h:' || p $$;
  create function semis_logi_private.pw_problem(p text, l text, x text) returns text language sql as $$ select case when length(coalesce(p, '')) < 8 then 'short' end $$;
  create function semis_logi_private.flight_cfg() returns jsonb language sql as $$ select '{"strict": true}'::jsonb $$;
  create function semis_logi_private.flight_tok_ok(p text) returns boolean language sql as $$ select coalesce(p, '') = 'good' $$;
  create function semis_logi_private.argo_day() returns date language sql as $$ select current_date $$;
  create table semis_v2_private.pledges (emp_id text, name text, dept text, position text, at timestamptz, state text, state_at timestamptz);
  create function semis_v2_private.pledge_pkey(e text, n text) returns text language sql as $$ select coalesce(e, n) $$;
  create function semis_v2_private.pledge_eff_state(s text, a timestamptz) returns text language sql as $$ select s $$;
`);
const aclRows = Object.keys(ACL).map(k => `('${k}',${ACL[k][0]},${ACL[k][1]})`).join(",");
await db.exec(`insert into semis_logi_private.key_acl values ${aclRows};`);
await db.exec(`insert into semis_logi_private.accounts(id, login_id, name, role, vendor) values
  ('a1','a1','N-a1','admin',''), ('h1','h1','N-h1','hq',''), ('m1','m1','N-m1','manager',''), ('u1','u1','N-u1','user',''),
  ('u2','u2','N-u2','user',''), ('v1','v1','N-v1','vendor','가나'), ('mark3464','mark3464','최고','admin','');`);
const KEYS = Object.keys(ACL).filter(k => ACL[k][0] < 9).sort();
for (const k of KEYS) if (k !== "boards") await db.query("insert into public.semis_logi_store(key, value) values ($1, $2::jsonb)", [k, JSON.stringify({ k })]);
await db.exec(BBS_SQL);
const MENUS = [
  { id: "dashboard", type: "module", module: "dashboard" }, { id: "schedule", type: "module", module: "schedule" },
  { id: "bbs-B001", type: "board", board: "B001" }, { id: "bbs-B002", type: "board", board: "B002" }, { id: "bbs-B003", type: "board", board: "B003" },
  { id: "my-B002", type: "board", board: "B002" }
];
await db.query("update public.semis_logi_store set value = $1::jsonb where key = 'menus'", [JSON.stringify(MENUS)]);
await db.exec(SCOPE_SQL);
await db.exec(SCOPE_SQL);   // 다시 실행해도 같은 결과
const BOARDS = await one("select value from public.semis_logi_store where key = 'boards'");

// 0. 대응표 = js/scope.js
const sm = (await db.query("select menu, res, kind from semis_logi_private.scope_map")).rows.map(r => r.menu + "|" + r.res + "|" + r.kind).sort();
const want = [];
Object.keys(S.MAP).forEach(id => {
  const e = S.MAP[id];
  (e.own || []).forEach(k => want.push(id + "|k:" + k + "|own"));
  (e.ref || []).forEach(k => { if ((e.own || []).indexOf(k) < 0) want.push(id + "|k:" + k + "|ref"); });
  Object.keys(e.files || {}).forEach(f => want.push(id + "|f:" + f + "|" + e.files[f]));
});
eq(sm, want.sort(), "scope_map = js/scope.js MAP");
eq((await db.query("select menu, view from semis_logi_private.scope_menu")).rows.map(r => r.menu + ":" + r.view).sort(),
  Object.keys(S.MAP).sort().map(id => id + ":" + S.MAP[id].view), "scope_menu = MAP view");
for (const f of ["semis_logi_private.scope_acl(jsonb,integer)", "semis_logi_private.me_scope()", "semis_logi_private.mod_rank(text,boolean)", "semis_logi_private.bbs_rr(jsonb)", "semis_logi_private.scope_fol(jsonb,integer)"])
  eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", [f]), false, f + " anon 차단");
eq(await one("select has_function_privilege('anon', 'semis_logi_private.acl_now()', 'EXECUTE')"), true, "acl_now 는 정책이 씀");
eq(await one("select has_table_privilege('anon', 'semis_logi_private.scope_map', 'SELECT')"), false, "대응표 anon 차단");

// 1. 범위 계산 = js/scope.js (여러 범위 · 등급)
const CASES = [
  [{ home: true, m: {} }, 1], [{ home: false, m: { schedule: "r" } }, 1], [{ home: false, m: { schedule: "w" } }, 1],
  [{ home: true, m: { audit: "r", training: "w" } }, 2], [{ home: false, m: { audit: "r" } }, 3], [{ home: false, m: { audit: "w" } }, 1],
  [{ home: false, m: { "us-rescreen": "w", vault: "r" } }, 1], [{ home: true, m: { "bbs-B001": "r", "my-B002": "w", "inspection": "w" } }, 2],
  [{ home: false, m: { "kc-ra": "r", contracts: "w", "daily-safety": "w", learn: "r", "aud-dash": "r", "sec-dash": "r" } }, 1]
];
for (const [sc, base] of CASES) {
  const got = await one("select semis_logi_private.scope_acl($1::jsonb, $2)", [JSON.stringify(sc), base]);
  const exp = S.acl(sc, base, ACL);
  eq(got, Object.fromEntries(Object.keys(exp).sort().map(k => [k, exp[k]])), "scope_acl " + JSON.stringify(sc) + " 등급 " + base);
  const fol = await one("select semis_logi_private.scope_fol($1::jsonb, $2)", [JSON.stringify(sc), base]);
  const fexp = S.folders(sc, base, MENUS, BOARDS);
  eq(fol, Object.fromEntries(Object.keys(fexp).sort().map(k => [k, fexp[k]])), "scope_fol " + JSON.stringify(sc));
}
eq(await one("select semis_logi_private.scope_clean($1::jsonb, 'user')", [JSON.stringify({ home: 1, m: { schedule: "w", "x y": "r", settings: "w", dashboard: "r", audit: "z", vault: "r" }, cf: true })]),
  { m: { vault: "r", schedule: "w" }, home: false }, "정리 — 이상한 id · 단계 · 설정 · 홈 키 제외, home 은 true 만");
eq(await one("select semis_logi_private.scope_clean(null, 'vendor')"), { m: {}, cf: false, home: true }, "협력업체 기본 = 홈만");
eq(await one("select semis_logi_private.scope_clean('{\"home\":true}'::jsonb, 'admin')"), null, "시스템관리자는 범위 없음");
eq(await one("select semis_logi_private.scope_clean(null, 'user')"), null, "범위 없음 그대로");
eq(S.norm({ home: 1, m: { schedule: "w", "x y": "r", settings: "w", dashboard: "r", audit: "z", vault: "r" }, cf: true }, "user"), { home: true, m: { schedule: "w", vault: "r" } }, "js norm — home 은 참 값이면");

// 2. 공용 DB 정책 — 범위 계정은 판정표대로, 범위 없는 계정은 예전 그대로
const visible = async () => { await db.exec("set role anon"); try { return (await db.query("select key from public.semis_logi_store")).rows.map(r => r.key).sort(); } finally { await db.exec("reset role"); } };
const tryWrite = async (k) => {
  await db.exec("set role anon");
  try { const r = await db.query("update public.semis_logi_store set value = '{\"w\":1}'::jsonb where key = $1", [k]); await db.exec("reset role"); return r.affectedRows === 1; }
  catch (e) { await db.exec("reset role"); return false; }
};
for (const [role, id] of [["user", "u1"], ["manager", "m1"], ["hq", "h1"], ["admin", "a1"]]) {
  await setScope(id, null);
  await as(id, role);
  const r = S.norm(null, role) === null ? semis_rank(role) : 0;
  eq(await visible(), KEYS.filter(k => ACL[k][0] <= r).sort(), role + " 범위 없음 — 읽기 등급대로");
}
function semis_rank(role) { return { admin: 4, hq: 3, manager: 2, user: 1, vendor: 1 }[role]; }
const SC1 = { home: false, m: { schedule: "w", audit: "r", "bbs-B002": "r" } };
await setScope("u1", SC1);
await as("u1", "user");
const a1 = S.acl(SC1, 1, ACL);
eq(await visible(), Object.keys(a1).filter(k => a1[k][0] && ACL[k][0] < 9).sort(), "범위 계정 읽기 = 판정표");
ok(!(await visible()).includes("vault") && !(await visible()).includes("auditMaster"), "열람 단계는 SSI 원본 · 암호 못 읽음");
ok((await visible()).includes("audits") && (await visible()).includes("training"), "수검 대응 열람 — 수검 · 증빙 자료 읽음");
eq(await tryWrite("schedules"), true, "편집 메뉴 행 쓰기");
eq(await tryWrite("audits"), false, "열람 메뉴 행 쓰기 거절");
eq(await tryWrite("assignees"), false, "설정 행(쓰기 4)은 편집 단계라도 거절");
eq(await tryWrite("training"), false, "참고 행 쓰기 거절");
await setScope("u1", { home: false, m: { "us-rescreen": "w" } });
eq(await tryWrite("usRescreen"), true, "미주행 재보안검색 편집 = 입력 가능(쓰기 4 예외)");
eq(await tryWrite("menus"), false, "메뉴 행은 못 씀");
await setScope("h1", { home: true, m: { audit: "r" } });
await as("h1", "hq");
ok((await visible()).includes("auditMaster"), "안전보안파트 계정의 열람 = 그 등급으로 읽음");
eq(await tryWrite("audits"), false, "안전보안파트라도 열람 단계는 쓰기 거절");
ok(!(await visible()).includes("vault") && !(await visible()).includes("phonebook"), "범위 밖 메뉴 자료는 안전보안파트라도 못 읽음");
await setScope("h1", null);
await as("v1", "vendor");
eq(await visible(), ["boards", "levelHistory", "menus", "safetyBoard"], "협력업체(범위 저장 없음) = 홈만");
await as("u1", "user", "signer");
eq(await visible(), [], "서명 세션은 공용 DB 직접 조회 불가");
await as(null);
eq(await visible(), [], "세션 없음");

// 3. 로그인 응답
await setScope("u1", SC1);
let pl = await one("select semis_logi_private.session_payload('u1', 'user', null)");
eq([pl.user.scope.m.schedule, pl.def, pl.acl.schedules, pl.acl.audits, pl.acl.vault, pl.rank], ["w", [9, 9], [0, 0], [0, 9], [9, 9], 1], "범위 계정 응답 — 판정표를 등급 모양으로");
pl = await one("select semis_logi_private.session_payload('m1', 'user', null)");
eq([pl.user.scope, pl.def, pl.acl.schedules], [null, [2, 3], ACL.schedules], "범위 없는 계정은 예전 응답");
pl = await one("select semis_logi_private.session_payload('v1', 'user', null)");
eq([pl.user.scope.home, pl.user.scope.cf], [true, false], "협력업체 기본 범위");

// 4. 계정 저장
await as("a1", "admin");
let r = await call("semis_logi_user_save", { id: "s1", name: "범위", role: "user", pw: "abcdefgh1", scope: { home: false, m: { flight: "r", "bad id": "w" } } });
eq(r.ok, true, "범위 계정 만들기");
eq(await one("select scope from semis_logi_private.accounts where id = 's1'"), { m: { flight: "r" }, home: false }, "저장 모양");
r = await call("semis_logi_user_save", { origId: "s1", id: "s1", name: "범위2", role: "user" });
eq(await one("select scope from semis_logi_private.accounts where id = 's1'"), { m: { flight: "r" }, home: false }, "옛 화면(범위 칸 없음) 수정은 범위 유지");
r = await call("semis_logi_user_save", { origId: "s1", id: "s1", name: "범위2", role: "user", scope: null });
eq(await one("select scope from semis_logi_private.accounts where id = 's1'"), null, "범위 없음으로 되돌림");
eq((await call("semis_logi_user_save", { origId: "s1", id: "s1", name: "x", role: "user", scope: [1] })).error, "bad_scope", "모양이 틀리면 거절");
r = await call("semis_logi_user_save", { origId: "mark3464", id: "mark3464", name: "최고", role: "user", scope: { home: true, m: { flight: "r" } } });
eq(await one("select role || ':' || coalesce(scope::text, 'null') from semis_logi_private.accounts where id = 'mark3464'"), "admin:null", "최고관리자는 늘 시스템관리자 · 범위 없음");
r = await call("semis_logi_user_save", { id: "v2", name: "업체", role: "vendor", vendor: "다라", pw: "abcdefgh2" });
eq(await one("select scope from semis_logi_private.accounts where id = 'v2'"), { m: {}, cf: false, home: true }, "협력업체 새 계정 = 홈만");
const us = await one("select public.semis_logi_users()");
eq(us.users.find(u => u.origId === "v2").scope.home, true, "목록에 범위");
ok(/"scope"/.test(JSON.stringify((await db.query("select detail from semis_logi_private.audit where action = 'user_create' and detail ->> 'id' = 'v2'")).rows[0].detail)), "감사 기록에 범위");
await as("h1", "hq");
eq((await call("semis_logi_user_save", { id: "s9", name: "x", role: "user", pw: "abcdefgh9" })).error, "forbidden", "시스템관리자만");

// 5. 파일 함수 · 다른 문턱
await as("u1", "user");
let fa = await one("select public.semis_logi_file_auth()");
eq([fa.rank, fa.scoped, fa.fol.schedules, fa.fol.audits, fa.fol.bbs1], [0, true, [3, 3], [2, 0], [1, 0]], "파일 — 등급 0 + 폴더표");
await setScope("u1", null);
fa = await one("select public.semis_logi_file_auth()");
eq([fa.rank, fa.fol], [1, undefined], "범위 없음 — 예전 응답");
await setScope("u1", { home: false, m: { training: "r" } });
eq(await one("select semis_logi_private.mod_rank('training', false)"), 2, "열람 = 보기 수준 2");
eq(await one("select semis_logi_private.mod_rank('training', true)"), -1, "열람은 편집 등급 없음");
eq(await one("select count(*)::int from semis_logi_private.edu_admin()"), 0, "이수 등록 페이지 관리 = 편집 단계만");
eq((await one("select public.semis_logi_pledges()")).error, undefined, "서약 명단 — 열람 통과(명단 표는 시험 밖)");
eq(await one("select rank from semis_logi_private.learn_me()"), -1, "교육 전파 범위 밖");
await setScope("u1", { home: false, m: { training: "w", learn: "r" } });
eq(await one("select rank from semis_logi_private.edu_admin()"), 3, "편집 단계 = 관리 가능");
eq(await one("select rank from semis_logi_private.learn_me()"), 2, "교육 전파 열람 = 보기만(2)");
await setScope("u1", { home: false, m: { learn: "w" } });
eq(await one("select rank from semis_logi_private.learn_me()"), 3, "교육 전파 편집 = 관리(3)");
eq(await one("select count(*)::int from semis_logi_private.desk_me()"), 0, "접수 카운터 — 범위 계정 제외");
eq((await one("select public.semis_logi_argo_begin()")).error, "forbidden", "아르고 — 범위 계정 제외");
eq(await one("select public.semis_logi_flight_gate(null)"), false, "운항 위치 — 운항 · 홈 둘 다 없으면 거절");
await setScope("u1", { home: true, m: {} });
eq(await one("select public.semis_logi_flight_gate(null)"), true, "홈(대시보드 지도) 있으면 허용");
await setScope("u1", null);
eq([await one("select public.semis_logi_flight_gate(null)"), await one("select count(*)::int from semis_logi_private.desk_me()"), await one("select rank from semis_logi_private.learn_me()")], [true, 1, 1], "범위 없음 — 예전 그대로");
await as("h1", "hq");
eq(await one("select rank from semis_logi_private.edu_admin()"), 3, "안전보안파트 — 예전 그대로");

// 6. 게시판 — 범위 게시판만 · 열람은 읽기만 · 편집은 안전보안파트처럼
await as("u2", "user");
r = await call("semis_logi_bbs_save", { b: "B002", title: "범위 전 글" });
eq(r.ok, true, "범위 없는 user — 일반게시판 글(예전 그대로)");
const pid = r.id;
await setScope("u2", { home: false, m: { "bbs-B002": "r" } });
eq((await call("semis_logi_bbs_list", { b: "B002" })).ok, true, "열람 게시판 목록");
eq((await call("semis_logi_bbs_list", { b: "B001" })).error, "forbidden", "범위 밖 게시판 거절");
eq((await call("semis_logi_bbs_save", { b: "B002", title: "몰래" })).error, "forbidden", "열람 단계 글쓰기 거절");
eq((await call("semis_logi_bbs_save", { id: pid, title: "고침" })).error, "forbidden", "열람 단계는 자기 글도 못 고침");
let g = await one("select public.semis_logi_bbs_get($1::bigint)", [pid]);
eq([g.ok, g.can.edit, g.can.comment, g.can.manage], [true, false, false, false], "열람 — 글 보기만");
eq(Object.keys((await one("select public.semis_logi_bbs_stats()")).boards), ["B002"], "새 글 수 = 범위 게시판만");
eq((await call("semis_logi_bbs_recent", { b: ["B001", "B002"] })).boards, ["B002"], "최근 글 = 범위 게시판만");
await setScope("u2", { home: false, m: { "my-B002": "w", "bbs-B002": "r" } });
r = await call("semis_logi_bbs_save", { b: "B002", title: "편집 글", pin: true });
eq(r.ok, true, "같은 게시판 메뉴 둘 중 높은 단계(편집)");
eq(await one("select pinned from semis_logi_private.bbs_posts where id = $1", [r.id]), true, "편집 = 안전보안파트처럼 고정 가능");
eq((await call("semis_logi_bbs_save", { b: "B001", title: "공지" })).error, "forbidden", "범위 밖 공지 거절");
eq((await call("semis_logi_bbs_move", { ids: [String(pid)], to: "B001" })).error, "forbidden", "범위 밖 게시판으로 이동 거절");
await setScope("v1", { home: false, m: { "bbs-B001": "r" }, cf: false });
await as("v1", "vendor");
eq((await call("semis_logi_bbs_list", { b: "B001" })).ok, true, "협력업체 — 범위 게시판 열람");
eq((await call("semis_logi_bbs_list", { b: "B002" })).error, "forbidden", "협력업체 — 범위 밖 게시판");
await setScope("v1", null);
eq((await call("semis_logi_bbs_list", { b: "B001" })).error, "forbidden", "협력업체 기본(홈만) — 게시판 없음");
await as("m1", "manager");
eq((await call("semis_logi_bbs_save", { b: "B001", title: "공지" })).error, "forbidden", "범위 없는 manager — 공지 못 씀(예전 그대로)");
await as("h1", "hq");
eq((await call("semis_logi_bbs_save", { b: "B001", title: "공지" })).ok, true, "범위 없는 hq — 공지(예전 그대로)");

console.log(`scope SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
