// SeMIS · Logistics v1.39 — 이수 등록 SQL 로컬 검증 (PGlite + pgcrypto, 서버 보조 함수는 흉내)
// 실행: mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-edu.test.mjs . && node semis-logi-edu.test.mjs <저장소>/tools/sql/semis-logi-edu.sql
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs";

const SQL = fs.readFileSync(process.argv[2], "utf8");
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
await db.exec(SQL);

const setCtx = async (rank) => { await db.exec("delete from semis_logi_private.test_ctx"); if (rank != null) await db.query("insert into semis_logi_private.test_ctx values ('acc','tester',$1,'user')", [rank]); };
const setIp = async (ip) => db.query("insert into semis_logi_private.test_env values ('ip',$1) on conflict (k) do update set v=excluded.v", [ip]);
const rpc = async (fn, args) => { const ph = args.map((_, i) => "$" + (i + 1)).join(","); return one(`select public.${fn}(${ph}) as r`, args); };

const C = (id, fam, kind, cycle, roles, o) => Object.assign({ id, fam, name: id, kind, cycle, rule: "kr", roles }, o || {});
const training = {
  catVer: 3, sessions: [{ id: "s1" }],
  courses: [C("c-sup-i", "sup", "초기", 12, ["항공사보안감독자"]), C("c-sup-r", "sup", "정기", 12, ["항공사보안감독자"]),
    C("c-dg-i", "dgr", "초기", 24, ["위험물 취급자"], { rule: "dg" }), C("c-dg-r", "dgr", "정기", 24, ["위험물 취급자"], { rule: "dg" }),
    C("c-icao", "icao", "1회", 0, []), C("v-screen", "v-screen", "정기", 12, [], { vendor: true })],
  people: [
    { id: "p1", name: "김 철수", dept: "인천화물팀", roles: ["항공사보안감독자"], left: "", note: "" },
    { id: "p2", name: "이영희", dept: "인천화물팀", roles: [], left: "", apt: { "x": "2020-01-01" } },
    { id: "p3", name: "이영희", dept: "화물운송팀", roles: [], left: "" },
    { id: "p4", name: "박민수", dept: "인천화물팀", roles: [], left: "2024-01-01" },
    { id: "p5", name: "최동명", dept: "인천화물팀 A", roles: [], left: "" },
    { id: "p6", name: "최동명", dept: "인천화물팀 B", roles: [], left: "" }
  ],
  records: [{ id: "r1", pid: "p1", cid: "c-sup-r", date: "2025-10-17", expire: "", files: [{ name: "a.pdf", url: "u-a" }], chkAt: "2025-10-20", chkBy: "관리" }]
};
await db.query("insert into public.semis_logi_store(key, value) values ('training', $1)", [JSON.stringify(training)]);

/* ─ 링크 ─ */
await setCtx(null);
eq((await rpc("semis_logi_edu_link_save", [JSON.stringify({ days: 30 })])).error, "forbidden", "L01 비로그인 만들기 거절");
await setCtx(2);
eq((await rpc("semis_logi_edu_links", [])).error, "forbidden", "L02 manager 목록 거절");
await setCtx(3);
let r = await rpc("semis_logi_edu_link_save", [JSON.stringify({ days: 14, title: "2026 하반기", target: "eduTest" })]);
ok(r.ok && /^[a-z2-9]{12}$/.test(r.link.code) && r.link.target === "training" && r.link.open, "L03 hq 만들기 · 시험 대상은 admin 만 " + JSON.stringify(r));
const CODE = r.link.code;
await setCtx(4);
r = await rpc("semis_logi_edu_link_save", [JSON.stringify({ days: 3, target: "eduTest" })]);
ok(r.ok && r.link.target === "eduTest", "L04 admin 시험 링크");
const TCODE = r.link.code;
eq((await rpc("semis_logi_edu_link_save", [JSON.stringify({ days: 0 })])).error, "invalid", "L05 기한 0일 거절");
eq((await rpc("semis_logi_edu_link_save", [JSON.stringify({ days: 36501 })])).error, "invalid", "L05b 36500일 넘음 거절");
r = await rpc("semis_logi_edu_link_save", [JSON.stringify({ days: 36500, title: "상시" })]);
ok(r.ok && r.link.open && r.link.expires > "2120-01-01", "L05c 상시 주소(36500일) " + JSON.stringify(r).slice(0, 160));
await rpc("semis_logi_edu_link_save", [JSON.stringify({ code: r.link.code, active: false })]);
eq((await rpc("semis_logi_edu_link_save", [JSON.stringify({ title: "x".repeat(61) })])).error, "invalid", "L06 제목 길이");
const exp = await one("select to_char(expires_at at time zone 'Asia/Seoul','HH24:MI:SS') from semis_logi_private.edu_links where code=$1", [CODE]);
eq(exp, "23:59:59", "L07 기한 = 그날 끝(한국 시각)");

/* ─ 정보 ─ */
await setCtx(null);
eq((await rpc("semis_logi_edu_info", ["nope"])).error, "invalid", "I01 잘못된 코드");
r = await rpc("semis_logi_edu_info", [CODE.toUpperCase() + " "]);
ok(r.ok && r.title === "2026 하반기" && r.courses.length === 5 && !r.courses.some(c => c.vendor), "I02 정보 · 협력사 과정 제외 " + JSON.stringify(r).slice(0, 200));
ok(r.depts.indexOf("인천화물팀") >= 0 && r.depts.indexOf("화물운송팀") >= 0, "I03 소속 예시");
await setIp("9.9.9.9");
for (let i = 0; i < 20; i++) await rpc("semis_logi_edu_info", ["bad" + i]);
eq((await rpc("semis_logi_edu_info", [CODE])).error, "limit", "I04 잘못된 코드 20회 → 15분 제한");
await setIp("1.1.1.1");

/* ─ 표 ─ */
eq((await rpc("semis_logi_edu_ticket", [CODE, JSON.stringify({ x: "bad" })])).error, "pow", "T01 작업증명 실패");
eq((await rpc("semis_logi_edu_ticket", ["zzzzzzzzzzzz", JSON.stringify({ x: "ok" })])).error, "invalid", "T02 코드 확인");
r = await rpc("semis_logi_edu_ticket", [CODE, JSON.stringify({ x: "ok" })]);
ok(r.ok && /^[0-9a-f]{48}$/.test(r.ticket), "T03 표 발급");
const TK = r.ticket;

/* ─ 업로드 기록 ─ */
const claim = (tk, path, size) => rpc("semis_logi_edu_claim", [tk, path, "이수증.pdf", size || 1000, "application/pdf"]);
eq((await claim("0".repeat(48), "training/aaaa_x.pdf")).error, "ticket", "U01 없는 표");
eq((await claim(TK, "notices/aaaa_x.pdf")).error, "path", "U02 폴더 고정");
eq((await claim(TK, "training/aaaa_x.pdf", 30 * 1024 * 1024)).error, "too_large", "U03 20MB");
for (const n of ["f1", "f2", "f3", "f4", "f5", "f6"]) eq((await claim(TK, "training/" + n + "_cert.pdf")).ok, true, "U04 기록 " + n);
const obj = (n, size) => db.query("insert into storage.objects values ('semis-logi-files', $1, $2)", ["training/" + n + "_cert.pdf", JSON.stringify({ size: size || 1000, mimetype: "application/pdf" })]);
for (const n of ["f1", "f2", "f3", "f4"]) await obj(n);
const F = (n) => ({ path: "training/" + n + "_cert.pdf", name: n + ".pdf" });

/* ─ 제출 ─ */
let empSeq = 900000;
const sub = (p, code, tk) => rpc("semis_logi_edu_submit", [code || CODE, tk || TK, JSON.stringify(Object.assign({ sid: "sid-" + Math.random().toString(36).slice(2, 12), emp: String(++empSeq) }, p))]);
eq((await sub({ name: "", dept: "x", roles: [{ r: "위험물 취급자" }] })).error, "required", "S01 이름 필수");
eq((await sub({ name: "a\u0001b", dept: "x", roles: [{ r: "위험물 취급자" }] })).error, "too_long", "S02 제어문자");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [] })).error, "required", "S03 직무도 이수 기록도 없으면 거절");
eq((await sub({ name: "홍길동", dept: "인천화물팀" })).error, "required", "S03b 직무 없이 빈 제출 거절");
eq((await sub({ name: "홍길동", roles: "x" })).error, "roles", "S03c 직무 형식");
r = await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "없는 직무" }] }); eq(r.error, "roles", "S04 기준표 직무만 " + JSON.stringify(r));
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자", apt: "2026-02-30" }] })).error, "date", "S05 없는 날");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "v-screen", date: "2026-01-02", files: [F("f1")] }] })).error, "course", "S06 협력사 과정 거절");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "c-dg-i", date: "2026-01-02", files: [] }] })).error, "files", "S07 이수증 필수");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "c-dg-i", date: "2026-01-02", files: [F("f5")] }] })).error, "files", "S08 저장소에 없는 파일");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "c-dg-i", date: "2026-01-02", files: [{ path: "training/zz_cert.pdf" }] }] })).error, "files", "S09 기록 없는 파일");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "c-dg-i", date: "2026-01-02", expire: "2025-01-01", files: [F("f1")] }] })).error, "date", "S10 유효기한 < 수료일");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }] }, CODE, "1".repeat(48))).error, "ticket", "S11 표 없음");
eq((await sub({ name: "홍길동", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "c-dg-i", date: "2026-01-02", files: [F("f1")] }, { cid: "c-dg-i", date: "2026-01-02", files: [F("f2")] }] })).error, "dup_rec", "S12 같은 기록 두 번");

/* 새 사람 */
const SID = "sid-newperson-1";
const p1 = { sid: SID, name: "홍길동", dept: "인천화물팀", emp: "KJ300001", roles: [{ r: "위험물 취급자", apt: "2026-03-02" }, { r: "위험물 취급자" }],
  recs: [{ cid: "c-dg-i", date: "2026-03-10", hours: 40, org: "항공위험물교육원", certNo: "DG-1", files: [F("f1")] }] };
r = await rpc("semis_logi_edu_submit", [CODE, TK, JSON.stringify(p1)]);
ok(r.ok && r.kind === "new" && /^[A-Z0-9]{8}$/.test(r.receipt), "S13 새 사람 " + JSON.stringify(r));
eq(r.person.roles, ["위험물 취급자"], "S14 직무 중복 제거");
eq(r.person.apt, { "위험물 취급자": "2026-03-02" }, "S15 임명일");
eq(r.records.map(x => x.cid + "|" + x.date), ["c-dg-i|2026-03-10"], "S16 기록");
let T = await one("select value from public.semis_logi_store where key='training'");
const np = T.people.find(x => x.name === "홍길동");
ok(np && np.src === "self" && np.selfAt && np.createdBy === "본인 등록" && np.pledge === "" && Array.isArray(np.pledgeFiles), "S17 새 사람 칸");
const nr = T.records.find(x => x.pid === np.id);
ok(nr && nr.src === "self" && nr.hours === 40 && nr.files[0].url.endsWith("/semis-logi-files/training/f1_cert.pdf") && nr.files[0].size === 1000 && nr.files[0].name === "f1.pdf", "S18 기록 칸 " + JSON.stringify(nr));
ok(T.catVer === 3 && T.courses.length === 6 && T.sessions.length === 1, "S19 다른 칸 그대로");
const again = await rpc("semis_logi_edu_submit", [CODE, TK, JSON.stringify(p1)]);
eq(again.receipt, r.receipt, "S20 같은 제출 재전송 = 같은 결과");
T = await one("select value from public.semis_logi_store where key='training'");
eq(T.people.filter(x => x.name === "홍길동").length, 1, "S21 재전송으로 사람 늘지 않음");
eq((await sub({ name: "누구", dept: "x", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "c-dg-r", date: "2026-03-11", files: [F("f1")] }] })).error, "files", "S22 쓴 파일 재사용 거절");

/* 기존 사람 갱신 */
r = await sub({ name: "김철수", dept: "인천화물팀", emp: "KJ100418", roles: [{ r: "위험물 취급자", apt: "2025-01-02" }, { r: "항공사보안감독자", apt: "2024-05-01" }],
  recs: [{ cid: "c-sup-r", date: "2025-10-17", certNo: "S-9", files: [F("f2")] }, { cid: "c-icao", date: "2019-06-01", files: [F("f3")] }] });
ok(r.ok && r.kind === "updated" && r.person.id === "p1", "S23 이름(공백 무시) 같은 재직자 갱신 " + JSON.stringify(r));
eq(r.person.roles, ["항공사보안감독자", "위험물 취급자"], "S24 직무 더함(빼지 않음)");
T = await one("select value from public.semis_logi_store where key='training'");
const r1 = T.records.find(x => x.id === "r1");
ok(r1.files.length === 2 && r1.certNo === "S-9" && !("chkAt" in r1) && !("chkBy" in r1) && r1.selfAt && r1.src === undefined, "S25 같은 과정 · 수료일 = 그 기록 고침(첨부 더함 · 확인 지움) " + JSON.stringify(r1));
eq(T.records.filter(x => x.pid === "p1").length, 2, "S26 새 과정 기록 더함");
eq(r.records.length, 2, "S27 결과 = 그 사람 기록 전체");

/* 사번 */
eq((await sub({ name: "사번없음", dept: "", emp: "", roles: [{ r: "위험물 취급자" }] })).error, "emp", "P01 사번 필수");
eq((await sub({ name: "사번없음", dept: "", emp: "-- ", roles: [{ r: "위험물 취급자" }] })).error, "emp", "P02 숫자 · 영문 없는 사번");
T = await one("select value from public.semis_logi_store where key='training'");
eq(T.people.find(x => x.id === "p1").emp, "KJ100418", "P03 이름으로 찾은 사람에 사번 기록");
r = await sub({ name: "김 철 수 ", dept: "", emp: "100418", roles: [{ r: "위험물 취급자" }] });
ok(r.ok && r.kind === "updated" && r.person.id === "p1" && r.person.dept === "인천화물팀", "P04 사번(KJ 앞자리 무시)으로 찾음 · 소속 비면 그대로 " + JSON.stringify(r.person));
r = await sub({ name: "김철수", dept: "", emp: "200000", roles: [{ r: "위험물 취급자" }] });
ok(r.ok && r.kind === "new" && r.person.id !== "p1" && r.person.dept === "인천화물팀" && r.person.emp === "200000", "P05 같은 이름 · 다른 사번 = 새 사람(소속 기본 인천화물팀)");
r = await sub({ name: "다른이름", dept: "", emp: "200000", roles: [{ r: "항공사보안감독자", apt: "2024-01-01" }] });
ok(r.kind === "updated" && r.person.name === "김철수", "P06 이름이 달라도 사번이 같으면 그 사람");
eq((await claim(TK, "training/f7_cert.pdf")).ok, true, "P07a 업로드 기록");
await obj("f7");
r = await sub({ name: "직무없음", emp: "KJ777001", recs: [{ cid: "c-icao", date: "2026-01-05", org: "교육원", certNo: "77", files: [F("f7")] }] });
ok(r.ok && r.kind === "new" && JSON.stringify(r.person.roles) === "[]" && r.person.dept === "인천화물팀" && r.records.length === 1, "P07 v1.39.3 이름 · 사번 · 이수증만(직무 없음) " + JSON.stringify(r).slice(0, 220));

/* 동명이인 */
r = await sub({ name: "이영희", dept: "화물운송팀", roles: [{ r: "위험물 취급자" }] });
ok(r.ok && r.kind === "updated" && r.person.id === "p3", "S28 동명이인 → 소속으로 가림");
eq(r.person.apt, {}, "S29 임명일 없음 = 빈 객체");
r = await sub({ name: "이영희", dept: "본사", roles: [{ r: "위험물 취급자" }] });
ok(r.ok && r.kind === "updated" && r.person.id === "p2", "S30 다른 사번이 적힌 동명이인(p3)은 빼고 남은 한 사람(p2) " + JSON.stringify(r.person));
r = await sub({ name: "최동명", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }] });
eq(r.kind, "dup", "S32 소속이 둘 다 포함되면 못 가림 → 새 사람");
T = await one("select value from public.semis_logi_store where key='training'");
ok(/동명이인/.test(T.people.find(x => x.id === r.person.id).note) && ["p5", "p6"].indexOf(r.person.id) < 0, "S31 동명이인 메모");
r = await sub({ name: "박민수", dept: "인천화물팀", roles: [{ r: "위험물 취급자" }] });
ok(r.kind === "new" && r.person.id !== "p4", "S33 퇴직자 같은 이름 → 새 사람");

/* 이수증 판독 확인 */
const rok = (tk, path) => rpc("semis_logi_edu_read_ok", [tk, path]);
eq((await rok(TK, "training/zz_none.pdf")).error, "path", "R01 기록 없는 경로");
eq((await rok("0".repeat(48), "training/f6_cert.pdf")).error, "ticket", "R02 표");
r = await rok(TK, "training/f6_cert.pdf");
ok(r.ok && r.courses.length === 5 && r.courses.every(c => c.id && c.name) && r.type === "application/pdf", "R03 과정 목록(협력사 제외) " + JSON.stringify(r).slice(0, 120));
await rok(TK, "training/f6_cert.pdf"); await rok(TK, "training/f6_cert.pdf");
eq((await rok(TK, "training/f6_cert.pdf")).error, "too_many", "R04 파일당 3회");

/* 링크 끄기 · 기한 */
await setCtx(3);
r = await rpc("semis_logi_edu_link_save", [JSON.stringify({ code: CODE, active: false })]);
ok(r.ok && r.link.active === false && r.link.open === false, "L08 끄기");
await setCtx(null);
eq((await rpc("semis_logi_edu_info", [CODE])).error, "closed", "L09 끈 링크");
eq((await claim(TK, "training/f9_cert.pdf")).error, "closed", "L10 끈 링크 업로드 거절");
await db.query("update semis_logi_private.edu_links set active = true, expires_at = now() - interval '1 minute' where code = $1", [CODE]);
r = await rpc("semis_logi_edu_info", [CODE]);
ok(r.error === "expired" && r.expires, "L11 기한 지남");
await setCtx(3);
r = await rpc("semis_logi_edu_link_save", [JSON.stringify({ code: CODE, days: 7 })]);
ok(r.ok && r.link.open, "L12 연장");
r = await rpc("semis_logi_edu_links", []);
ok(r.ok && r.links.length === 3 && r.links.find(x => x.code === CODE).submits >= 6 && r.recent.length >= 6 && r.recent[0].name, "L13 목록 · 최근 제출 " + JSON.stringify(r.recent[0]));
const au = await one("select count(*)::int from semis_logi_private.audit where action in ('edu_submit','edu_link_add','edu_link_edit')");
ok(au >= 9, "L14 감사 기록 " + au);

/* 시험 대상 행 — 없으면 만들고 training 은 그대로 */
await setCtx(null);
const before = JSON.stringify(await one("select value from public.semis_logi_store where key='training'"));
await db.query("insert into public.semis_logi_store(key, value) values ('eduTest', $1)", [JSON.stringify({ courses: training.courses, people: [], records: [], sessions: [] })]);
r = await rpc("semis_logi_edu_ticket", [TCODE, JSON.stringify({ x: "ok" })]);
const TK2 = r.ticket;
eq((await claim(TK2, "training/t1_cert.pdf")).ok, true, "E01 시험 업로드 기록");
await obj("t1");
r = await sub({ name: "시험", dept: "시험", roles: [{ r: "위험물 취급자" }], recs: [{ cid: "c-dg-i", date: "2026-01-02", files: [F("t1")] }] }, TCODE, TK2);
ok(r.ok && r.kind === "new", "E02 시험 대상 제출");
eq(JSON.stringify(await one("select value from public.semis_logi_store where key='training'")), before, "E03 training 그대로");
eq((await one("select value from public.semis_logi_store where key='eduTest'")).people.length, 1, "E04 eduTest 에 기록");
eq((await sub({ name: "x", dept: "x", roles: [{ r: "위험물 취급자" }] }, CODE, TK2)).error, "ticket", "E05 다른 링크의 표 거절");

/* 제출 제한 */
await setIp("7.7.7.7");
let lim = null;
for (let i = 0; i < 62 && !lim; i++) { const x = await sub({ name: "", dept: "", roles: [] }); if (x.error === "limit") lim = i; }
eq(lim, 60, "R01 10분 60회 제한");

console.log(`SQL 검증: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
