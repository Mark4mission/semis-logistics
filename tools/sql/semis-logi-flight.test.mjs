// H:drive — 운항 현황 현장 웹앱 PIN · 위치 서버 출입 SQL 로컬 검증 (PGlite + pgcrypto, 서버 보조 함수는 흉내)
// 실행: mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-flight.test.mjs . && node semis-logi-flight.test.mjs <저장소>/tools/sql/semis-logi-flight.sql
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs";

const SQL = fs.readFileSync(process.argv[2], "utf8");
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b));
const one = async (q, p) => { const r = await db.query(q, p || []); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; };
const as = async (id, role, kind) => {
  await db.exec("delete from semis_logi_private.test_ctx");
  if (id) await db.query("insert into semis_logi_private.test_ctx values ($1, $2, $3)", [id, role, kind || "user"]);
};
const ip = (v) => db.query("insert into semis_logi_private.test_env values ('ip', $1) on conflict (k) do update set v = excluded.v", [v]);
const pin = (p) => one("select public.semis_logi_flight_pin($1)", [p]);
const gate = (t) => one("select public.semis_logi_flight_gate($1)", [t]);
const admin = (p) => one("select public.semis_logi_flight_admin($1::jsonb)", [JSON.stringify(p)]);
const cfg = () => one("select v from semis_logi_private.settings where k = 'flight'");
const forge = (e, ver) => one("select $1::text || '.' || $2::text || '.' || semis_logi_private.flight_sig($1::text || '.' || $2::text)", [String(e), String(ver)]);
const nowS = async () => Number(await one("select extract(epoch from now())::bigint"));

await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema semis_logi_private;
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create table semis_logi_private.test_env (k text primary key, v text);
  create table semis_logi_private.settings (k text primary key, v jsonb not null, updated_at timestamptz not null default now());
  create table semis_logi_private.audit (id bigserial primary key, at timestamptz not null default now(), actor text, action text not null, detail jsonb, ip text);
  create function semis_logi_private.rank_of(p_role text) returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2 when 'user' then 1 when 'vendor' then 1 else 0 end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N-' || t.account_id,
      case when t.kind = 'signer' then 'signer' else t.role end,
      case when t.kind = 'signer' then 0 else semis_logi_private.rank_of(t.role) end, t.kind, null from semis_logi_private.test_ctx t $$;
  create function semis_logi_private.rank_now() returns int language sql stable as $$
    select coalesce((select c.rank from semis_logi_private.ctx() c where c.kind = 'user' limit 1), -1) $$;
  create function semis_logi_private.client_ip() returns text language sql stable as $$ select coalesce((select v from semis_logi_private.test_env where k='ip'), '1.1.1.1') $$;
  create table public.semis_logi_adsb (hex text primary key, lat float8);
  create table public.semis_logi_adsb_events (id bigserial primary key, hex text);
  alter table public.semis_logi_adsb enable row level security;
  alter table public.semis_logi_adsb_events enable row level security;
  create policy "adsb read" on public.semis_logi_adsb for select using (true);
  create policy "adsb events read" on public.semis_logi_adsb_events for select using (true);
  grant select on public.semis_logi_adsb, public.semis_logi_adsb_events to anon, authenticated;
`);
await db.exec(SQL);
const sec0 = (await cfg()).secret;
await db.exec(SQL);   // 다시 실행해도 같은 결과(비밀값 그대로)

// 0. 처음 상태 · 권한
let c = await cfg();
eq([typeof c.secret, c.secret.length, c.ver, c.strict, c.pin], ["string", 64, 1, false, undefined], "F00 처음: 비밀값 64자 · ver 1 · strict 꺼짐 · PIN 없음");
eq(c.secret, sec0, "F00 다시 실행해도 비밀값 그대로");
for (const f of ["public.semis_logi_flight_pin(text)", "public.semis_logi_flight_gate(text)", "public.semis_logi_flight_admin(jsonb)"]) {
  eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", [f]), true, "F01 " + f + " anon 실행");
  eq(await one("select has_function_privilege('authenticated', $1, 'EXECUTE')", [f]), false, "F01 " + f + " authenticated 막음");
}
for (const f of ["semis_logi_private.flight_cfg()", "semis_logi_private.flight_sig(text)", "semis_logi_private.flight_tok_ok(text)"]) {
  eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", [f]), false, "F01 " + f + " anon 막음");
}
eq(await one("select has_table_privilege('anon', 'semis_logi_private.flight_hits', 'SELECT')"), false, "F01 시도 표 anon 막음");
eq(await one("select count(*)::int from pg_policy where polrelid in ('public.semis_logi_adsb'::regclass, 'public.semis_logi_adsb_events'::regclass)"), 0, "F02 위치 표 공개 읽기 정책 지움");
eq(await one("select has_table_privilege('anon', 'public.semis_logi_adsb', 'SELECT')"), false, "F02 위치 표 anon select 권한 회수");
eq(await one("select has_table_privilege('anon', 'public.semis_logi_adsb_events', 'SELECT')"), false, "F02 입출항 표 anon select 권한 회수");

// 1. PIN 없을 때 · 형식
eq(await pin("123456"), { ok: false, error: "off" }, "F03 PIN 미설정 → off");
eq(await pin("12345"), { ok: false, error: "invalid" }, "F03 5자리 → invalid");
eq(await pin("12345678901"), { ok: false, error: "invalid" }, "F03 11자리 → invalid");
eq(await pin("12a456"), { ok: false, error: "invalid" }, "F03 숫자 아님 → invalid");
eq(await gate(null), true, "F04 strict 꺼짐 → 누구나 통과(옮기는 동안)");

// 2. 관리자만 PIN 을 정함
await as("h1", "hq");
let err = ""; try { await admin({ act: "info" }); } catch (e) { err = String(e.message); }
ok(/forbidden/.test(err), "F05 hq → 거절");
await as(null);
err = ""; try { await admin({ act: "info" }); } catch (e) { err = String(e.message); }
ok(/forbidden/.test(err), "F05 세션 없음 → 거절");
await as("a1", "admin");
let info = await admin({ act: "info" });
eq([info.ok, info.set, info.strict, info.fails], [true, false, false, 0], "F06 info: 미설정");
eq(await admin({ act: "pin", pin: "12345" }), { ok: false, error: "invalid" }, "F06 관리자도 5자리는 거절");
eq(await admin({ act: "cut" }), { ok: false, error: "off" }, "F06 PIN 없으면 끊기 없음");
eq(await admin({ act: "pin", pin: "482913" }), { ok: true }, "F07 새 PIN 저장");
c = await cfg();
ok(c.pin && c.pin.startsWith("$2") && c.pin.indexOf("482913") < 0, "F07 PIN 은 bcrypt 해시로만");
eq([c.ver, c.by], [2, "N-a1"], "F07 ver 2 · 바꾼 사람");
eq(await one("select action from semis_logi_private.audit order by id desc limit 1"), "flight_pin", "F07 감사 기록");
info = await admin({ act: "info" });
eq([info.set, typeof info.at], [true, "string"], "F07 info: 설정됨 · 시각");
await as(null);

// 3. PIN 확인 → 표
await ip("10.0.0.1");
let r = await pin("000000");
eq(r, { ok: false, error: "pin" }, "F08 틀린 PIN");
r = await pin("482913");
ok(r.ok === true && /^[0-9]{10}\.2\.[0-9a-f]{64}$/.test(r.token), "F09 맞는 PIN → 표(만료.ver.서명)");
const n0 = await nowS();
ok(r.exp >= n0 + 12 * 3600 - 5 && r.exp <= n0 + 12 * 3600 + 5, "F09 12시간");
const T = r.token;

// 4. 출입 — strict 켬
await db.exec("update semis_logi_private.settings set v = v || '{\"strict\": true}' where k = 'flight'");
eq(await gate(null), false, "F10 strict: 표 없음 · 세션 없음 → 막음");
eq(await gate(T), true, "F10 맞는 표 → 통과");
eq(await gate(T.slice(0, -1) + (T.endsWith("0") ? "1" : "0")), false, "F10 서명 한 글자 바꿈 → 막음");
eq(await gate("x".repeat(80)), false, "F10 형식 아님 → 막음");
eq(await gate(await forge(n0 - 10, 2)), false, "F11 만료된 표 → 막음");
eq(await gate(await forge(n0 + 20 * 3600, 2)), false, "F11 너무 먼 만료(위조 의심) → 막음");
eq(await gate(await forge(n0 + 3600, 1)), false, "F11 옛 ver → 막음");
await as("u1", "user");   eq(await gate(null), true, "F12 H:drive 세션(일반 사용자) → 통과");
await as("v1", "vendor"); eq(await gate(null), true, "F12 협력업체 세션 → 통과(운항 메뉴 전체 공개)");
await as("s1", "user", "signer"); eq(await gate(null), false, "F12 회의 서명 세션 → 막음");
await as(null);
// SeMIS v2 세션(같은 위치 서버를 씀) — v2 함수가 있으면 그 등급도 봄
await db.exec(`create schema semis_v2_private; create table semis_v2_private.test_rank (r int);
  create function semis_v2_private.rank_now() returns int language sql stable as $$ select coalesce((select r from semis_v2_private.test_rank limit 1), -1) $$;`);
eq(await gate(null), false, "F12b v2 세션 없음 → 막음");
await db.exec("insert into semis_v2_private.test_rank values (1)");
eq(await gate(null), true, "F12b SeMIS v2 로그인 세션 → 통과");
await db.exec("delete from semis_v2_private.test_rank; insert into semis_v2_private.test_rank values (0)");
eq(await gate(null), false, "F12b v2 등급 0 → 막음");
await db.exec("drop schema semis_v2_private cascade");
eq(await gate(T), true, "F12b v2 함수가 없어도 표 확인은 그대로");

// 5. 끊기 · 새 PIN 이면 그 전 표 무효
await as("a1", "admin");
eq(await admin({ act: "cut" }), { ok: true }, "F13 현장 접속 모두 끊기");
await as(null);
eq(await gate(T), false, "F13 끊은 뒤 그 전 표 → 막음");
r = await pin("482913");
ok(r.ok && /\.3\./.test(r.token), "F13 다시 PIN → ver 3 표");
eq(await gate(r.token), true, "F13 새 표 통과");
await as("a1", "admin");
await admin({ act: "pin", pin: "7305512" });
await as(null);
eq(await gate(r.token), false, "F14 PIN 을 바꾸면 그 전 표 → 막음");
eq(await pin("482913"), { ok: false, error: "pin" }, "F14 옛 PIN → 틀림");
ok((await pin("7305512")).ok, "F14 새 PIN(7자리) → 표");

// 6. 시도 제한 — 같은 IP 15분 10번
await ip("10.0.0.9");
for (let i = 0; i < 10; i++) await pin("111111");
eq(await pin("7305512"), { ok: false, wait: 15, error: "locked" }, "F15 같은 IP 10번 틀림 → 맞는 PIN 도 잠김");
await ip("10.0.0.10");
ok((await pin("7305512")).ok, "F15 다른 IP 는 그대로");
// 전체 1시간 60번
for (let i = 0; i < 50; i++) { await ip("10.1.0." + i); await pin("222222"); }
await ip("10.2.0.1");
eq(await pin("7305512"), { ok: false, wait: 15, error: "paused" }, "F16 전체 60번 틀림 → 멈춤");
eq(await one("select count(*)::int from semis_logi_private.audit where action = 'flight_pin_paused'"), 1, "F16 멈춤 감사 기록 한 번");
await as("a1", "admin");
info = await admin({ act: "info" });
eq(info.fails, 60, "F17 info: 하루 실패 수");
await admin({ act: "pin", pin: "991100" });
await as(null);
ok((await pin("991100")).ok, "F17 새 PIN 을 정하면 실패 셈을 비움 → 다시 열림");
eq(await one("select count(*)::int from semis_logi_private.flight_hits where not ok"), 0, "F17 실패 줄 지움");

// 7. strict 끄면(되돌리기) 다시 모두 통과
await db.exec("update semis_logi_private.settings set v = v || '{\"strict\": false}' where k = 'flight'");
eq(await gate(null), true, "F18 strict 끄기 = 되돌리기");

console.log(`flight SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
