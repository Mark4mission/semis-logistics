// H:drive — 접수 카운터 직원 접수함 SQL 로컬 검증 (PGlite, 세션 함수 ctx() · 저장소 표는 시험 표로 흉내)
// 실행: mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-desk-inbox.test.mjs . && node semis-logi-desk-inbox.test.mjs <저장소>/tools/sql/semis-logi-desk-inbox.sql
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
const submit = (p) => one("select public.semis_logi_desk_submit($1::jsonb)", [JSON.stringify(p)]);
const mine = () => one("select public.semis_logi_desk_mine()");
const inbox = () => one("select public.semis_logi_desk_inbox()");
const take = (id) => one("select public.semis_logi_desk_take($1::bigint)", [id]);
const close = (id, st, res) => one("select public.semis_logi_desk_close($1::bigint, $2, $3)", [id, st, res]);
const cancel = (id) => one("select public.semis_logi_desk_cancel($1::bigint)", [id]);
const put = (path, age) => db.query("insert into storage.objects(bucket_id, name, created_at) values ('semis-logi-files', $1, now() - $2::interval)", [path, age || "1 minute"]);
const P = (n) => "desk-in/mabc123def456gh_" + n;

await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema semis_logi_private;
  create schema storage;
  create table storage.objects (bucket_id text, name text, created_at timestamptz default now());
  create table semis_logi_private.accounts (id text primary key, login_id text, name text, role text, disabled boolean not null default false);
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create function semis_logi_private.rank_of(p_role text) returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2 when 'user' then 1 when 'vendor' then 1 else 0 end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N-' || t.account_id,
      case when t.kind = 'signer' then 'signer' else t.role end,
      case when t.kind = 'signer' then 0 else semis_logi_private.rank_of(t.role) end, t.kind, null from semis_logi_private.test_ctx t $$;
`);
await db.exec(SQL);
await db.exec(SQL);   // 다시 실행해도 같은 결과

// 0. 권한 — RPC 는 anon 만, 도우미 · 표는 막음
for (const f of ["public.semis_logi_desk_submit(jsonb)", "public.semis_logi_desk_mine()", "public.semis_logi_desk_cancel(bigint)",
  "public.semis_logi_desk_inbox()", "public.semis_logi_desk_take(bigint)", "public.semis_logi_desk_close(bigint, text, text)", "public.semis_logi_file_auth()"]) {
  eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", [f]), true, f + " anon");
  eq(await one("select has_function_privilege('authenticated', $1, 'EXECUTE')", [f]), false, f + " authenticated 차단");
}
for (const f of ["semis_logi_private.desk_me()", "semis_logi_private.desk_notify()", "semis_logi_private.desk_file_ok(text)"])
  eq(await one("select has_function_privilege('anon', $1, 'EXECUTE')", [f]), false, f + " 도우미 차단");
eq(await one("select has_table_privilege('anon', 'semis_logi_private.desk_inbox', 'SELECT')"), false, "표 직접 읽기 차단");
eq(await one("select relrowsecurity from pg_class where oid = 'semis_logi_private.desk_inbox'::regclass"), true, "RLS 켬");

// 1. 세션 없음 · 협력업체 · 서명 세션
await as(null);
eq((await submit({ path: P("a.pdf") })).error, "forbidden", "세션 없음");
eq((await mine()).error, "forbidden", "세션 없음 목록");
await as("v1", "vendor");
await put(P("v.pdf"));
eq((await submit({ path: P("v.pdf"), name: "v.pdf" })).error, "forbidden", "협력업체");
await as("s1", "user", "signer");
eq((await submit({ path: P("v.pdf") })).error, "forbidden", "서명 세션");
eq((await inbox()).error, "forbidden", "서명 세션 접수함");

// 2. 직원 올리기
await as("u1", "user");
await put(P("a.pdf"));
let r = await submit({ path: P("a.pdf"), name: "이수증\u0007_홍.pdf", size: 1234, ftype: "pdf" });
ok(r.ok && r.item && r.item.status === "new", "올리기");
eq([r.item.name, r.item.size, r.item.result], ["이수증_홍.pdf", 1234, ""], "이름 제어문자 제거 · 크기");
ok(!("by" in r.item) && !("path" in r.item), "직원 화면에는 경로 · 이름 안 줌");
const idA = r.item.id;
eq(await one("select by_name from semis_logi_private.desk_inbox where id = $1", [idA]), "N-u1", "올린 사람 이름은 표에만");
eq((await submit({ path: P("a.pdf") })).error, "dup", "같은 경로 두 번");
eq((await submit({ path: "docs/mabc123def456gh_x.pdf" })).error, "path", "다른 폴더");
eq((await submit({ path: "desk-in/../docs/x.pdf" })).error, "path", "상위 이동");
eq((await submit({ path: "desk-in/short_x.pdf" })).error, "path", "태그 형식");
eq((await submit({ path: P("none.pdf") })).error, "file", "저장소에 없는 원본");
await put(P("old.pdf"), "2 days");
eq((await submit({ path: P("old.pdf") })).error, "file", "하루 넘은 원본");
await put(P("b.hwp"));
r = await submit({ path: P("b.hwp"), name: "", size: "x", ftype: "HWP!" });
eq([r.item.name, r.item.size], ["file", 0], "빈 이름 · 숫자 아닌 크기");
eq(await one("select ftype from semis_logi_private.desk_inbox where id = $1", [r.item.id]), "", "종류 형식 검사");
const idB = r.item.id;
eq((await submit("[]")).error, "bad", "객체 아님");

// 3. 내가 올린 문서 — 본인 것만
eq((await mine()).items.map(x => x.id), [idB, idA], "최근 순");
await as("u2", "user");
eq((await mine()).items, [], "남의 것은 안 보임");
eq((await cancel(idA)).error, "state", "남의 것 취소 불가");

// 4. 접수함 — 안전보안파트 이상만
await as("u1", "user");
eq((await inbox()).error, "forbidden", "직원 접수함 불가");
eq((await take(idA)).error, "forbidden", "직원 가져가기 불가");
eq((await close(idA, "done", "x")).error, "forbidden", "직원 닫기 불가");
await as("m1", "manager");
eq((await inbox()).error, "forbidden", "manager 접수함 불가");
await as("h1", "hq");
let ib = await inbox();
eq(ib.items.map(x => x.id), [idA, idB], "새 것 오래된 순");
eq([ib.items[0].by, ib.items[0].path, ib.items[0].name], ["N-u1", P("a.pdf"), "이수증_홍.pdf"], "올린 사람 · 경로");
eq((await take(idA)).ok, true, "가져가기");
await as("a1", "admin");
eq((await take(idA)).error, "gone", "한 사람만");
eq((await inbox()).items.map(x => x.id), [idB], "가져간 것은 빠짐");
await db.query("update semis_logi_private.desk_inbox set taken_at = now() - interval '11 minutes' where id = $1", [idA]);
eq((await inbox()).items.map(x => x.id), [idA, idB], "10분 넘게 멈추면 다시");
eq((await take(idA)).ok, true, "다시 가져가기");

// 5. 취소 — 확인 전만
await as("u1", "user");
eq((await cancel(idA)).error, "state", "가져간 뒤 취소 불가");
eq((await cancel(idB)).ok, true, "확인 전 취소");
eq((await mine()).items.find(x => x.id === idB).status, "cancel");
await as("h1", "hq");
eq((await inbox()).items.length, 0, "취소한 것은 접수함에 없음");
eq((await close(idB, "done", "x")).error, "state", "취소한 것은 닫지 못함");

// 6. 닫기
eq((await close(idA, "nope", "")).error, "status", "상태 검사");
eq((await close(idA, "done", "일정 · 교육 이수 기록\u0007")).ok, true, "저장됨");
eq((await close(idA, "done", "일정 · 교육 이수 기록")).ok, true, "같은 상태로 다시 닫기");
eq((await close(idA, "back", "")).error, "state", "저장한 것을 반려로 못 바꿈");
await as("u1", "user");
let m = (await mine()).items.find(x => x.id === idA);
eq([m.status, m.result], ["done", "일정 · 교육 이수 기록"], "직원이 보는 처리 결과");
ok(!!m.done_at, "처리일");
await put(P("c.pdf"));
const idC = (await submit({ path: P("c.pdf"), name: "c.pdf" })).item.id;
await as("h1", "hq");
await take(idC);
eq((await close(idC, "back", "무시됨")).ok, true, "반려");
await as("u1", "user");
eq((await mine()).items.find(x => x.id === idC).result, "", "반려는 결과 글 없음");

// 7. 한도 · 정리
await db.query("update semis_logi_private.desk_inbox set at = now() - interval '200 days', done_at = now() - interval '200 days' where id = $1", [idA]);
await put(P("d.pdf"));
await submit({ path: P("d.pdf"), name: "d.pdf" });
eq(await one("select count(*)::int from semis_logi_private.desk_inbox where id = $1", [idA]), 0, "처리 끝난 줄 180일 뒤 정리");
const n0 = await one("select count(*)::int from semis_logi_private.desk_inbox where account_id = 'u1' and at > now() - interval '1 hour'");
for (let i = n0; i < 30; i++) { await put(P("r" + i + ".pdf")); ok((await submit({ path: P("r" + i + ".pdf") })).ok, "한도 안 " + i); }
await put(P("over.pdf"));
eq((await submit({ path: P("over.pdf") })).error, "rate", "한 시간 30건");

// 8. 파일 함수 세션 확인 — role
await as("v1", "vendor");
const fa = await one("select public.semis_logi_file_auth()");
eq([fa.ok, fa.kind, fa.rank, fa.role, fa.who], [true, "user", 1, "vendor", "v1"], "role 포함");
await as(null);
eq(await one("select public.semis_logi_file_auth()"), { ok: false }, "세션 없음");

console.log(`desk-inbox SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
