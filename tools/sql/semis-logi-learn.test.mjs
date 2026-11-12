// H:drive — 교육 전파 · 서명 SQL 로컬 검증 (PGlite + pgcrypto, 서버 보조 함수는 흉내)
// 실행: npm i --no-save @electric-sql/pglite && node tools/sql/semis-logi-learn.test.mjs tools/sql/semis-logi-edu.sql tools/sql/semis-logi-learn.sql
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs";

const EDU = fs.readFileSync(process.argv[2], "utf8");
const SQL = fs.readFileSync(process.argv[3], "utf8");
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b));
const one = async (q, p) => { const r = await db.query(q, p || []); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; };

await db.exec(`
  create schema extensions; create extension pgcrypto schema extensions;
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema semis_logi_private; create schema storage;
  create table storage.objects (bucket_id text, name text, metadata jsonb);
  create table public.semis_logi_store (key text primary key, value jsonb, updated_at timestamptz default now(), updated_by text, base_at timestamptz);
  create table semis_logi_private.key_acl (key text primary key, read_rank int not null, write_rank int not null);
  create table semis_logi_private.audit (id bigserial primary key, at timestamptz not null default now(), actor text, action text not null, detail jsonb, ip text);
  create table semis_logi_private.test_ctx (account_id text, login_id text, rank int, kind text);
  create table semis_logi_private.test_env (k text primary key, v text);
  create function semis_logi_private.client_ip() returns text language sql stable as $$ select coalesce((select v from semis_logi_private.test_env where k='ip'), '1.1.1.1') $$;
  create function semis_logi_private.hdr(p_name text) returns text language sql stable as $$ select case when p_name='user-agent' then 'UA-test' end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', account_id, login_id, login_id, 'x', rank, kind, null from semis_logi_private.test_ctx $$;
  create function semis_logi_private.pow_check(p_pow jsonb) returns text language sql volatile as $$ select case when p_pow->>'x' = 'ok' then null else 'pow' end $$;
`);
await db.exec(EDU);
await db.exec(SQL);

const setCtx = async (rank) => { await db.exec("delete from semis_logi_private.test_ctx"); if (rank != null) await db.query("insert into semis_logi_private.test_ctx values ('acc','tester',$1,'user')", [rank]); };
const setIp = async (ip) => db.query("insert into semis_logi_private.test_env values ('ip',$1) on conflict (k) do update set v=excluded.v", [ip]);
const rpc = async (fn, args) => { const ph = args.map((_, i) => "$" + (i + 1)).join(","); return one(`select public.${fn}(${ph}) as r`, args); };
const today = await one("select to_char(semis_logi_private.edu_today(), 'YYYY-MM-DD')");
const addD = async (n) => one(`select to_char(semis_logi_private.edu_today() + ${n}, 'YYYY-MM-DD')`);
const PUB = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/";

const CODE = "abcdefgh2345", CODE2 = "zzzzzzzz9999", CODE3 = "yyyyyyyy8888", CODE4 = "xxxxxxxx7777";
const learn = {
  courses: [
    { id: "c1", code: CODE, state: "open", title: "11월 안전보건협의체 결과", kind: "안전", overview: "개요", host: "파트장", place: "온라인",
      start: await addD(-1), end: await addD(5), body: "## 핵심\n- 지게차 통로", minSec: 60,
      items: [{ id: "i1", type: "video", name: "v.mp4", url: PUB + "learn/aa11_v.mp4", dur: 50 }, { id: "i2", type: "image", name: "a.png", url: PUB + "learn/bb22_a.png" },
        { id: "i3", type: "image", name: "x.png", url: PUB + "docs/cc33_x.png" }],
      targets: { groups: ["안전보안파트", "AAP"], add: ["p5"], except: ["p2"] } },
    { id: "c2", code: CODE2, state: "draft", title: "준비 중", start: today, end: today },
    { id: "c3", code: CODE3, state: "open", title: "끝남", start: await addD(-10), end: await addD(-1) },
    { id: "c4", code: CODE4, state: "open", title: "예정", start: await addD(2), end: await addD(9) }
  ]
};
const people = {
  people: [
    { id: "p1", name: "김 철수", org: "에어제타", part: "안전보안파트", emp: "100001", gender: "M", title: "과장" },
    { id: "p2", name: "이영희", org: "에어제타", part: "안전보안파트", emp: "100002", gender: "F" },
    { id: "p3", name: "이영희", org: "에어제타", part: "수출파트", emp: "100003", gender: "F" },
    { id: "p4", name: "박바다", org: "에어제타", part: "안전보안파트", emp: "100004", left: "2026-01-01" },
    { id: "p5", name: "최마루", org: "에어제타", part: "수입파트", emp: "100005" },
    { id: "p6", name: "정하늘", org: "AAP", part: "", emp: "" }
  ],
  orgs: ["AAP", "프로에스콤"]
};
await db.query("insert into public.semis_logi_store(key, value) values ('learn', $1), ('roster', $2)", [JSON.stringify(learn), JSON.stringify(people)]);

/* ─ 권한표 ─ */
eq(await one("select read_rank || '/' || write_rank from semis_logi_private.key_acl where key='learn'"), "2/3", "A01 learn 2/3");
eq(await one("select read_rank || '/' || write_rank from semis_logi_private.key_acl where key='roster'"), "2/3", "A02 roster 2/3");

/* ─ 정보 ─ */
await setCtx(null);
eq((await rpc("semis_logi_learn_info", ["nope"])).error, "invalid", "I01 잘못된 코드");
eq((await rpc("semis_logi_learn_info", [CODE2])).error, "closed", "I02 준비 중(draft)");
let r = await rpc("semis_logi_learn_info", [CODE3]);
ok(r.error === "after" && r.title === "끝남", "I03 기간 지남 + 제목 " + JSON.stringify(r));
eq((await rpc("semis_logi_learn_info", [CODE4])).error, "before", "I04 시작 전");
r = await rpc("semis_logi_learn_info", [" " + CODE.toUpperCase() + " "]);
ok(r.ok && r.title === "11월 안전보건협의체 결과" && r.minSec === 60 && r.items.length === 3 && r.items[0].type === "video" && r.items[0].dur === 50, "I05 정보 " + JSON.stringify(r).slice(0, 300));
ok(!("body" in r) && !JSON.stringify(r).includes("learn/aa11") && !JSON.stringify(r).includes("100001"), "I06 본문 · 파일 경로 · 사번은 정보에 없음");
eq(r.orgs[0], "에어제타", "I07 소속 목록 첫 줄 = 에어제타");
ok(r.orgs.includes("AAP") && r.orgs.includes("프로에스콤") && r.parts.includes("안전보안파트") && r.parts.includes("수출파트"), "I08 소속 · 파트 " + JSON.stringify([r.orgs, r.parts]));
await setIp("9.9.9.9");
for (let i = 0; i < 20; i++) await rpc("semis_logi_learn_info", ["badbadbad" + String(i).padStart(3, "2")]);
eq((await rpc("semis_logi_learn_info", [CODE])).error, "limit", "I09 잘못된 코드 20회 → 제한");
await setIp("1.1.1.1");

/* ─ 표 ─ */
eq((await rpc("semis_logi_learn_ticket", [CODE, JSON.stringify({ x: "bad" })])).error, "pow", "T01 작업증명 실패");
eq((await rpc("semis_logi_learn_ticket", [CODE2, JSON.stringify({ x: "ok" })])).error, "closed", "T02 준비 중 교육 표 없음");
r = await rpc("semis_logi_learn_ticket", [CODE, JSON.stringify({ x: "ok" })]);
ok(r.ok && /^[0-9a-f]{48}$/.test(r.ticket), "T03 표 발급");
const TK = r.ticket;
const TK2 = (await rpc("semis_logi_learn_ticket", [CODE, JSON.stringify({ x: "ok" })])).ticket;
const TK4 = (await rpc("semis_logi_learn_ticket", [CODE4, JSON.stringify({ x: "ok" })]));
eq(TK4.error, "before", "T04 시작 전 교육 표 없음");

/* ─ 찾기 ─ */
eq((await rpc("semis_logi_learn_find", [CODE, "f".repeat(48), "김철수"])).error, "ticket", "F01 틀린 표");
eq((await rpc("semis_logi_learn_find", [CODE, TK, "김"])).error, "name", "F02 한 글자 거절");
r = await rpc("semis_logi_learn_find", [CODE, TK, " 김철 수 "]);
ok(r.ok && r.list.length === 1 && r.list[0].pid === "p1" && r.list[0].emp === "100001" && r.list[0].tgt === true && r.list[0].done === null, "F03 띄어쓰기 무시 · 사번 · 대상 " + JSON.stringify(r));
r = await rpc("semis_logi_learn_find", [CODE, TK, "이영희"]);
ok(r.ok && r.list.length === 2 && r.list.find(x => x.pid === "p2").tgt === false && r.list.find(x => x.pid === "p3").tgt === false, "F04 동명이인 · except · 다른 파트 " + JSON.stringify(r.list));
eq((await rpc("semis_logi_learn_find", [CODE, TK, "박바다"])).list.length, 0, "F05 퇴직자 제외");
r = await rpc("semis_logi_learn_find", [CODE, TK, "최마루"]);
ok(r.list[0].tgt === true, "F06 add = 대상");
r = await rpc("semis_logi_learn_find", [CODE, TK, "정하늘"]);
ok(r.list[0].tgt === true && r.list[0].org === "AAP", "F07 협력업체 그룹 대상");
eq((await rpc("semis_logi_learn_find", [CODE3, TK, "김철수"])).error, "after", "F08 다른(끝난) 교육 코드");

/* ─ 시작 ─ */
eq((await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ pid: "p4" })])).error, "person", "S01 퇴직자 시작 불가");
r = await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ pid: "p1" })]);
ok(r.ok && /^lr[0-9a-f]{18}$/.test(r.rid) && r.body.includes("지게차") && r.minSec === 60 && r.person.emp === "100001" && r.items.length === 3, "S02 시작 " + JSON.stringify(r).slice(0, 300));
const RID1 = r.rid;
r = await rpc("semis_logi_learn_start", [CODE, TK2, JSON.stringify({ pid: "p1" })]);
ok(r.ok && r.rid === RID1, "S03 다른 표로 이어 하기 = 같은 기록");
eq(await one("select ticket_hash = encode(extensions.digest($1,'sha256'),'hex') from semis_logi_private.learn_done where id=$2", [TK2, RID1]), true, "S04 이어 하기 표로 바뀜");
r = await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ pid: "p1" })]);
ok(r.ok && r.rid === RID1, "S04b 원래 표로 다시");
eq((await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ name: "김", org: "AAP" })])).error, "name", "S05 직접 입력 이름 짧음");
eq((await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ name: "홍길동", org: "" })])).error, "org", "S06 소속 없음");
eq((await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ name: "홍길동", org: "에어제타", emp: "" })])).error, "emp", "S07 에어제타는 사번 필수");
eq((await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ name: "홍길동", org: "에어제타", emp: "100001" })])).error, "emp_name", "S08 남의 사번");
r = await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ name: "김철수", org: "에어제타", emp: "KJ100001" })]);
ok(r.ok && r.rid === RID1 && r.person.manual === false, "S09 직접 입력이어도 사번 · 이름이 맞으면 명단 사람 " + JSON.stringify(r).slice(0, 200));
r = await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ name: "홍 길동", org: "프로에스콤", emp: "999" })]);
ok(r.ok && r.person.manual === true && r.person.emp === "", "S10 명단 외 협력업체(사번 버림)");
const RIDM = r.rid;
eq(await one("select pkey from semis_logi_private.learn_done where id=$1", [RIDM]), "m:프로에스콤|홍길동", "S11 명단 외 키");
r = await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ name: "홍길동", org: "에어제타", emp: "100777", part: "수출파트" })]);
ok(r.ok && r.person.manual && r.person.emp === "100777" && r.person.part === "수출파트", "S12 명단에 없는 에어제타 직원");

/* ─ 자료(Edge 전용) ─ */
r = await rpc("semis_logi_learn_media_ok", [CODE, TK, RID1]);
ok(r.ok && r.files.length === 2 && r.files[0].path === "learn/aa11_v.mp4" && r.files[1].i === 1, "M01 learn/ 경로만 " + JSON.stringify(r));
eq((await rpc("semis_logi_learn_media_ok", [CODE, TK2, RID1])).error, "start", "M02 다른 표");
eq((await rpc("semis_logi_learn_media_ok", [CODE2, TK, RID1])).error, "closed", "M03 준비 중 교육");

/* ─ 제출 ─ */
const SIGN = "data:image/png;base64," + "A".repeat(600);
eq((await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RID1, sign: SIGN, sid: "short" })])).error, "invalid", "U01 sid 형식");
r = await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RID1, sign: SIGN, sid: "sid-00000001", secs: 61 })]);
ok(r.error === "too_fast" && r.wait > 40, "U02 최소 시간 전 " + JSON.stringify(r));
await db.query("update semis_logi_private.learn_done set started_at = now() - interval '70 seconds' where id=$1", [RID1]);
eq((await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RID1, sign: "data:image/png;base64,AAA", sid: "sid-00000001" })])).error, "sign", "U03 서명 너무 짧음");
eq((await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RID1, sign: "data:image/svg+xml;base64," + "A".repeat(600), sid: "sid-00000001" })])).error, "sign", "U04 PNG 만");
eq((await rpc("semis_logi_learn_submit", [CODE, TK2, JSON.stringify({ rid: RID1, sign: SIGN, sid: "sid-00000001" })])).error, "start", "U05 시작한 표가 아님");
r = await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RID1, sign: SIGN, sid: "sid-00000001", secs: 75 })]);
ok(r.ok && r.name === "김 철수" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.at), "U06 제출 " + JSON.stringify(r));
r = await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RID1, sign: SIGN, sid: "sid-00000001" })]);
ok(r.ok, "U07 같은 sid 다시 = 성공");
eq((await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RID1, sign: SIGN, sid: "sid-00000002" })])).error, "done", "U08 다른 sid = 이미 이수");
r = await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ pid: "p1" })]);
ok(r.ok && r.done && !r.rid, "U09 이수 뒤 다시 시작 = done");
r = await rpc("semis_logi_learn_find", [CODE, TK, "김철수"]);
ok(r.list[0].done && /^\d{4}-/.test(r.list[0].done), "U10 찾기에 이수 일시");
eq((await rpc("semis_logi_learn_media_ok", [CODE, TK, RID1])).error, "start", "U11 이수 뒤 자료 서명 없음");
eq(await one("select secs from semis_logi_private.learn_done where id=$1", [RID1]), 75, "U12 학습 시간");

/* 최소 시간 0 교육 */
await db.query("update public.semis_logi_store set value = jsonb_set(value, '{courses,0,minSec}', '0') where key='learn'");
r = await rpc("semis_logi_learn_submit", [CODE, TK, JSON.stringify({ rid: RIDM, sign: SIGN, sid: "sid-00000003" })]);
ok(r.ok && r.name === "홍 길동", "U13 최소 시간 0 → 바로 제출 · 명단 외");

/* 표당 시작 수 제한 */
await db.query("update semis_logi_private.learn_tickets set starts = 20 where ticket_hash = encode(extensions.digest($1,'sha256'),'hex')", [TK2]);
eq((await rpc("semis_logi_learn_start", [CODE, TK2, JSON.stringify({ pid: "p6" })])).error, "limit", "U14 표당 시작 20명");

/* ─ 관리 ─ */
await setCtx(null);
eq((await rpc("semis_logi_learn_stats", [JSON.stringify({})])).error, "forbidden", "G01 비로그인");
await setCtx(1);
eq((await rpc("semis_logi_learn_stats", [JSON.stringify({})])).error, "forbidden", "G02 user 거절");
await setCtx(2);
r = await rpc("semis_logi_learn_stats", [JSON.stringify({ ids: ["c1"] })]);
ok(r.ok && r.rows.length === 3 && r.rows.every(x => !("sign" in x) || x.sign === true || x.sign === false), "G03 현황 3줄 · 서명 그림 없음 " + JSON.stringify(r).slice(0, 200));
ok(!JSON.stringify(r).includes("AAAA"), "G04 서명 그림 미포함");
const rowM = r.rows.find(x => x.rid === RIDM);
ok(rowM.manual && rowM.state === "ok" && rowM.org === "프로에스콤", "G05 명단 외 줄");
r = await rpc("semis_logi_learn_signs", ["c1"]);
ok(r.ok && r.signs[RID1] === SIGN && Object.keys(r.signs).length === 2, "G06 서명 그림");
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "void", rid: RID1 })])).error, "forbidden", "G07 manager 무효 불가");
await setCtx(3);
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "void", rid: RID1 })])).ok, true, "G08 hq 무효");
eq(await one("select state from semis_logi_private.learn_done where id=$1", [RID1]), "void", "G09 무효 상태");
r = await rpc("semis_logi_learn_start", [CODE, TK, JSON.stringify({ pid: "p1" })]);
ok(r.ok && r.rid === RID1, "G10 무효 뒤 다시 시작 가능");
eq(await one("select state from semis_logi_private.learn_done where id=$1", [RID1]), "start", "G11 다시 시작 상태");
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "restore", rid: RID1 })])).ok, true, "G12 되살리기");
eq(await one("select state from semis_logi_private.learn_done where id=$1", [RID1]), "ok", "G13 서명 있으면 ok 로");
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "link", rid: RIDM, pid: "p1" })])).error, "dup", "G14 이미 기록 있는 사람에 연결 불가");
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "link", rid: RIDM, pid: "zz" })])).error, "person", "G15 없는 사람");
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "link", rid: RIDM, pid: "p6" })])).ok, true, "G16 명단 사람으로 연결");
eq(await one("select pkey || '|' || manual::text || '|' || org from semis_logi_private.learn_done where id=$1", [RIDM]), "p:p6|false|AAP", "G17 연결 결과");
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "purge", cid: "c1" })])).error, "exists", "G18 있는 교육은 정리 불가");
await db.query("insert into semis_logi_private.learn_done(id, course_id, pkey, name) values ('lrgone', 'gone', 'p:x', 'x')");
eq((await rpc("semis_logi_learn_admin", [JSON.stringify({ act: "purge", cid: "gone" })])).n, 1, "G19 지운 교육 기록 정리");
ok(await one("select count(*)::int from semis_logi_private.audit where action like 'learn_%'") >= 4, "G20 감사 기록");

/* ─ 실행 권한 ─ */
const ex = async (fn, role) => one(`select has_function_privilege('${role}', '${fn}', 'execute')`);
eq(await ex("public.semis_logi_learn_media_ok(text, text, text)", "anon"), false, "P01 media_ok 는 anon 불가");
eq(await ex("public.semis_logi_learn_media_ok(text, text, text)", "service_role"), true, "P02 media_ok 서비스 권한");
eq(await ex("public.semis_logi_learn_submit(text, text, jsonb)", "anon"), true, "P03 submit anon");
eq(await ex("public.semis_logi_learn_submit(text, text, jsonb)", "authenticated"), false, "P04 authenticated 차단");
eq(await ex("semis_logi_private.learn_limit(text, text)", "anon"), false, "P05 보조 함수 차단");

console.log(`\n교육 전파 SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
