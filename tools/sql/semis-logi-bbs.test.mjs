// H:drive — 게시판 SQL 로컬 검증 (PGlite, 세션 함수 ctx() 는 시험 표로 흉내)
// 실행: mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite && cp <저장소>/tools/sql/semis-logi-bbs.test.mjs . && node semis-logi-bbs.test.mjs <저장소>/tools/sql/semis-logi-bbs.sql
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
const call = (fn, arg) => one(`select public.${fn}($1::jsonb)`, [JSON.stringify(arg || {})]);
const get = (id) => one("select public.semis_logi_bbs_get($1::bigint)", [id]);
const URL0 = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/";

await db.exec(`
  do $$ begin create role anon; exception when others then null; end $$;
  do $$ begin create role authenticated; exception when others then null; end $$;
  do $$ begin create role service_role; exception when others then null; end $$;
  create schema semis_logi_private;
  create table semis_logi_private.accounts (id text primary key, login_id text, name text, role text, disabled boolean not null default false);
  create table semis_logi_private.key_acl (key text primary key, read_rank int not null, write_rank int not null);
  create table public.semis_logi_store (key text primary key, value jsonb, updated_at timestamptz default now(), updated_by text);
  create table semis_logi_private.test_ctx (account_id text, role text, kind text);
  create function semis_logi_private.rank_of(p_role text) returns int language sql immutable as $$
    select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2 when 'user' then 1 when 'vendor' then 1 else 0 end $$;
  create function semis_logi_private.ctx() returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
    language sql stable as $$ select 'h', t.account_id, t.account_id, 'N-' || t.account_id,
      case when t.kind = 'signer' then 'signer' else t.role end,
      case when t.kind = 'signer' then 0 else semis_logi_private.rank_of(t.role) end, t.kind, null from semis_logi_private.test_ctx t $$;
  insert into semis_logi_private.accounts(id, login_id, name, role, disabled) values
    ('u1','u1','N-u1','user',false), ('u2','u2','N-u2','user',false), ('m1','m1','N-m1','manager',false),
    ('h1','h1','N-h1','hq',false), ('a1','a1','N-a1','admin',false), ('v1','v1','N-v1','vendor',false), ('x1','x1','N-x1','user',true);
  insert into public.semis_logi_store(key, value) values ('notices', '[
    {"id":"n1","title":"오픈 안내","body":"첫 줄\\n<둘째>","author":"시스템관리자","pinned":true,"created":"2026-09-14T04:28:49.217Z"},
    {"id":"n2","title":"교육 안내","bodyHtml":"<p>교육</p>","author":"파트","pinned":false,"created":"2026-09-20T00:00:00Z",
     "files":[{"name":"a.pdf","url":"${URL0}attach/abc_a.pdf","size":10},{"name":"x","url":"https://evil.example/x.pdf"}]}]');
`);
await db.exec(SQL);

// 0. 시드 · 이관
eq(await one("select count(*)::int from semis_logi_private.bbs_posts where board = 'B001'"), 2, "옛 공지 2건 이관");
const mig = (await db.query("select no, title, html, pinned, files, author_name from semis_logi_private.bbs_posts order by no")).rows;
eq([mig[0].no, mig[0].title, mig[0].pinned, mig[0].author_name], [1, "오픈 안내", true, "시스템관리자"], "이관 순서 · 고정 · 작성자");
eq(mig[0].html, "첫 줄<br>&lt;둘째&gt;", "글 본문은 이스케이프 + 줄바꿈");
eq([mig[1].html, mig[1].files.length, mig[1].files[0].name], ["<p>교육</p>", 1, "a.pdf"], "서식 본문 · 바깥 주소 첨부 제외");
await db.exec(SQL);
eq(await one("select count(*)::int from semis_logi_private.bbs_posts"), 2, "다시 실행해도 중복 없음");
eq(await one("select jsonb_array_length(value)::int from public.semis_logi_store where key = 'boards'"), 3, "기본 게시판 3개");
eq(await one("select read_rank || '/' || write_rank from semis_logi_private.key_acl where key = 'boards'"), "1/4", "boards 권한표");
eq(await one("select has_function_privilege('anon', 'semis_logi_private.bbs_me()', 'EXECUTE')"), false, "도우미는 anon 이 직접 못 부름");
eq(await one("select has_function_privilege('anon', 'public.semis_logi_bbs_list(jsonb)', 'EXECUTE')"), true, "RPC 는 anon 호출");
eq(await one("select has_function_privilege('authenticated', 'public.semis_logi_bbs_list(jsonb)', 'EXECUTE')"), false, "authenticated 차단");

// 1. 세션
await as(null);
eq((await call("semis_logi_bbs_list", { b: "B001" })).error, "auth", "세션 없음");
await as("v1", "vendor");
eq((await call("semis_logi_bbs_list", { b: "B001" })).error, "auth", "협력업체 제외");
await as("u1", "user", "signer");
eq((await call("semis_logi_bbs_list", { b: "B001" })).error, "auth", "서명 세션 제외");

// 2. 목록 · 쓰기 권한
await as("u1", "user");
let r = await call("semis_logi_bbs_list", { b: "B001" });
eq([r.ok, r.total, r.rows.length, r.pins.length, r.rows[0].no], [true, 2, 2, 1, 2], "user 공지 목록 · 고정 1");
eq((await call("semis_logi_bbs_list", { b: "B999" })).error, "nf", "없는 게시판");
eq((await call("semis_logi_bbs_save", { b: "B001", title: "몰래 공지" })).error, "forbidden", "user 는 공지 못 씀");
eq((await call("semis_logi_bbs_save", { b: "B002", title: "  " })).error, "title", "제목 필수");
r = await call("semis_logi_bbs_save", { b: "B002", title: "첫\n글", html: "<p>본문</p>", body: "본문", pin: true, cat: "없는분류",
  files: [{ name: "a.png", url: URL0 + "bbs1/t_a.png", size: 99, type: "image/png" }, { name: "b", url: URL0 + "../x" }, { url: "javascript:alert(1)" }] });
eq([r.ok, r.no], [true, 1], "user 일반게시판 글");
const p1 = r.id;
let row = (await db.query("select * from semis_logi_private.bbs_posts where id = $1", [p1])).rows[0];
eq([row.title, row.pinned, row.cat, row.files.length, row.author_name, row.thread == p1], ["첫 글", false, "", 1, "N-u1", true], "줄바꿈 정리 · 고정 무시 · 분류 비움 · 첨부 검사");

// 3. 고정 — hq 만, 기한
await as("h1", "hq");
r = await call("semis_logi_bbs_save", { b: "B001", title: "보안등급 상향", html: "<b>주의</b>", body: "주의", pin: true, pinUntil: "2000-01-01" });
eq([r.ok, r.no], [true, 3], "hq 공지 · 번호 3");
r = await call("semis_logi_bbs_list", { b: "B001" });
eq(r.pins.map(x => x.title), ["오픈 안내"], "지난 고정 기한은 고정 목록에서 빠짐");
await call("semis_logi_bbs_save", { id: r.rows[0].id, title: "보안등급 상향", pin: true });
eq((await call("semis_logi_bbs_list", { b: "B001" })).pins.length, 2, "기한 없는 고정");

// 4. 쪽 나누기 · 검색
await as("u2", "user");
for (let i = 0; i < 10; i++) await call("semis_logi_bbs_save", { b: "B002", title: "자료 " + i, body: i % 2 && i < 9 ? "화물 보안" : "안전", html: "" });
eq((await call("semis_logi_bbs_save", { b: "B002", title: "열한 번째" })).error, "rate", "1분 10건 제한");
await db.exec("update semis_logi_private.bbs_posts set created_at = created_at - interval '2 minutes'");
for (let i = 10; i < 24; i++) {
  await call("semis_logi_bbs_save", { b: "B002", title: "자료 " + i, body: "기타", html: "" });
  await db.exec("update semis_logi_private.bbs_posts set created_at = created_at - interval '10 seconds'");
}
await db.exec("update semis_logi_private.bbs_posts set created_at = created_at - interval '2 minutes' where created_at > now() - interval '1 minute'");
r = await call("semis_logi_bbs_list", { b: "B002", size: 10, page: 3 });
eq([r.total, r.page, r.rows.length], [25, 3, 5], "25건 · 3쪽 5건");
eq(r.rows[4].no, 1, "마지막 쪽 끝은 첫 글");
r = await call("semis_logi_bbs_list", { b: "B002", size: 10, page: 99 });
eq(r.page, 3, "넘는 쪽은 마지막 쪽");
eq((await call("semis_logi_bbs_list", { b: "B002", size: 7 })).size, 20, "허용 밖 크기는 20");
eq((await call("semis_logi_bbs_list", { b: "B002", q: "화물 보안" })).total, 4, "낱말 모두 포함");
eq((await call("semis_logi_bbs_list", { b: "B002", q: "보안 화물" })).total, 4, "낱말 순서 무관");
eq((await call("semis_logi_bbs_list", { b: "B002", q: "화물", f: "title" })).total, 0, "제목만");
eq((await call("semis_logi_bbs_list", { b: "B002", q: "N-u1", f: "author" })).total, 1, "작성자");
eq((await call("semis_logi_bbs_list", { b: "B002", q: "%" })).total, 0, "% 는 글자 그대로");

// 5. 읽기 · 조회 · 열람 확인
await as("u1", "user");
let g = await get(p1);
eq([g.ok, g.first, g.post.views, g.can.edit, g.can.del, g.can.reply, g.can.comment, g.readers], [true, true, 1, true, true, true, true, null], "작성자 읽기");
g = await get(p1);
eq([g.first, g.post.views], [false, 1], "같은 계정 다시 읽어도 조회 그대로");
await as("u2", "user");
g = await get(p1);
eq([g.post.views, g.can.edit, g.can.del], [2, false, false], "다른 계정 · 수정 불가");
eq((await call("semis_logi_bbs_save", { id: p1, title: "남의 글" })).error, "forbidden", "남의 글 수정 불가");
const notice = (await call("semis_logi_bbs_list", { b: "B001" })).rows.find(x => x.no === 3).id;
g = await get(notice);
eq([g.readers, g.can.comment, g.can.reply], [null, false, false], "user 는 열람 확인 · 댓글 · 답글 없음(공지)");
await as("h1", "hq");
g = await get(notice);
eq(g.readers.read.map(x => x.name), ["N-u2"], "열람자");
eq(g.readers.unread, ["N-a1", "N-m1", "N-u1"], "미열람(작성자 · 비활성 · 협력업체 제외)");

// 6. 답글 · 지우기 · 되살리기
await as("u2", "user");
r = await call("semis_logi_bbs_save", { b: "B002", parent: p1, title: "Re: 첫 글" });
const rp = r.id;
r = await call("semis_logi_bbs_save", { b: "B002", parent: rp, title: "Re: Re" });
row = (await db.query("select depth, path, thread from semis_logi_private.bbs_posts where id = $1", [r.id])).rows[0];
eq([row.depth, row.path, Number(row.thread)], [2, "001.001.", p1], "답글 깊이 · 경로");
r = await call("semis_logi_bbs_list", { b: "B002", size: 100 });
const ord = r.rows.map(x => x.title);
eq(ord.slice(-3), ["첫 글", "Re: 첫 글", "Re: Re"], "답글은 원글 바로 아래");
eq((await call("semis_logi_bbs_save", { b: "B001", parent: notice, title: "x" })).error, "forbidden", "공지에는 user 답글 불가");
await as("u1", "user");
eq((await call("semis_logi_bbs_delete", { ids: [p1] })).error, "replies", "남의 답글 달린 글은 작성자도 못 지움");
await as("h1", "hq");
r = await call("semis_logi_bbs_delete", { ids: [p1] });
eq([r.ok, r.n], [true, 3], "hq 는 답글까지 지움");
eq((await get(p1)).error, "nf", "지운 글 읽기 불가");
eq((await call("semis_logi_bbs_admin", { op: "trash" })).error, "forbidden", "휴지통은 시스템관리자");
await as("a1", "admin");
r = await call("semis_logi_bbs_admin", { op: "trash", b: "B002" });
eq(r.rows.length, 3, "휴지통 3건");
r = await call("semis_logi_bbs_admin", { op: "restore", id: p1 });
eq([r.ok, r.n], [true, 3], "되살리기 답글까지");

// 7. 댓글
await as("u2", "user");
r = await call("semis_logi_bbs_comment", { post: p1, body: "  좋습니다 " });
const cm = r.id;
eq(r.ok, true, "댓글");
eq((await call("semis_logi_bbs_comment", { post: p1, body: "" })).error, "body", "빈 댓글");
eq((await call("semis_logi_bbs_comment", { post: notice, body: "x" })).error, "off", "공지 댓글 꺼짐");
await as("u1", "user");
eq((await call("semis_logi_bbs_comment", { del: cm })).error, "forbidden", "남의 댓글 못 지움");
g = await get(p1);
eq([g.comments.length, g.comments[0].body, g.comments[0].mine], [1, "좋습니다", false], "댓글 목록");
eq((await call("semis_logi_bbs_list", { b: "B002", size: 100 })).rows.find(x => x.id === p1).nc, 1, "목록 댓글 수");
await as("h1", "hq");
eq((await call("semis_logi_bbs_comment", { del: cm })).ok, true, "hq 댓글 지움");
eq(await one("select ncomments from semis_logi_private.bbs_posts where id = $1", [p1]), 0, "댓글 수 줄어듦");

// 8. 배지 · 색인 · 최근
await as("m1", "manager");
r = await one("select public.semis_logi_bbs_stats()");
eq([r.ok, r.boards.B001.total, r.boards.B001.unread, r.index.length > 0], [true, 3, 1, true], "관리자: 공지 3 · 새 글 안 읽음 1(옛 공지는 새 글 아님)");
await get(notice);
eq((await one("select public.semis_logi_bbs_stats()")).boards.B001.unread, 0, "읽으면 0");
r = await call("semis_logi_bbs_recent", { n: 5 });
eq([r.boards, r.rows[0].pin], [["B001"], true], "대시보드 = 공지 · 고정 먼저");
r = await call("semis_logi_bbs_recent", { b: ["B002"], n: 3 });
eq([r.rows.length, r.rows.every(x => x.b === "B002" && x.depth === 0)], [3, true], "지정 게시판 원글만");

// 9. 권한 높은 게시판
await db.exec(`update public.semis_logi_store set value = value || '[{"id":"B004","name":"파트 내부","read":"hq","write":"hq","opt":{"attach":true}}]'::jsonb where key = 'boards'`);
await as("h1", "hq");
const secret = (await call("semis_logi_bbs_save", { b: "B004", title: "내부 자료" })).id;
await as("m1", "manager");
eq((await call("semis_logi_bbs_list", { b: "B004" })).error, "forbidden", "목록 거절");
eq((await get(secret)).error, "forbidden", "읽기 거절");
r = await one("select public.semis_logi_bbs_stats()");
ok(!r.boards.B004 && !r.index.some(x => x.b === "B004"), "배지 · 색인에서 빠짐");
eq((await call("semis_logi_bbs_delete", { ids: [secret] })).n, 0, "못 읽는 글은 못 지움");

// 10. 옮기기
await as("u1", "user");
eq((await call("semis_logi_bbs_move", { ids: [p1], to: "B003" })).error, "forbidden", "user 옮기기 불가");
await as("h1", "hq");
r = await call("semis_logi_bbs_move", { ids: [p1], to: "B003" });
eq([r.ok, r.n], [true, 3], "답글까지 옮김");
eq((await db.query("select board, no from semis_logi_private.bbs_posts where id = $1", [p1])).rows[0], { board: "B003", no: 1 }, "새 게시판 번호");

// 11. 관리
await as("a1", "admin");
r = await call("semis_logi_bbs_admin", { op: "counts" });
eq([r.boards.B003.total, r.boards.B004.total], [3, 1], "글 수");
r = await call("semis_logi_bbs_admin", { op: "files" });
ok(r.urls.indexOf(URL0 + "bbs1/t_a.png") >= 0 && r.urls.indexOf(URL0 + "attach/abc_a.pdf") >= 0, "참조 파일");
eq((await call("semis_logi_bbs_admin", { op: "drop", b: "B004" })).error, "confirm", "확인 없이 비우기 거절");
r = await call("semis_logi_bbs_admin", { op: "drop", b: "B004", confirm: "B004" });
eq([r.ok, r.n], [true, 1], "게시판 비우기");

// 12. 90일 지난 지운 글 정리
await as("h1", "hq");
const old = (await call("semis_logi_bbs_save", { b: "B002", title: "옛 글" })).id;
await call("semis_logi_bbs_delete", { ids: [old] });
await db.exec("update semis_logi_private.bbs_posts set deleted_at = now() - interval '91 days' where id = " + old);
await call("semis_logi_bbs_delete", { ids: [] });
eq(await one("select count(*)::int from semis_logi_private.bbs_posts where id = $1", [old]), 0, "90일 지나면 정리");

// 13. 분류 · 기능 꺼짐 · hq 수정
await as("h1", "hq");
r = await call("semis_logi_bbs_save", { b: "B003", title: "양식 1", cat: "양식" });
eq(await one("select cat from semis_logi_private.bbs_posts where id = $1", [r.id]), "양식", "목록 안 분류");
eq((await call("semis_logi_bbs_list", { b: "B003", cat: "양식" })).total, 1, "분류 거르기");
await db.exec(`update public.semis_logi_store set value = value || '[{"id":"B005","name":"꺼짐","read":"all","write":"all","opt":{}}]'::jsonb where key = 'boards'`);
r = await call("semis_logi_bbs_save", { b: "B005", title: "t", pin: true, files: [{ name: "a", url: URL0 + "bbs1/t_a.png" }] });
row = (await db.query("select pinned, files from semis_logi_private.bbs_posts where id = $1", [r.id])).rows[0];
eq([row.pinned, row.files.length], [false, 0], "고정 · 첨부 꺼진 게시판");
await as("u1", "user");
const mineB5 = (await call("semis_logi_bbs_save", { b: "B005", title: "user 글" })).id;
await as("h1", "hq");
eq((await call("semis_logi_bbs_save", { id: mineB5, title: "hq 가 고침" })).ok, true, "hq 는 남의 글 수정");
eq(await one("select updated_by from semis_logi_private.bbs_posts where id = $1", [mineB5]), "N-h1", "고친 사람");
await as("u1", "user");
eq((await call("semis_logi_bbs_delete", { ids: [mineB5] })).n, 1, "작성자 본인 삭제");

console.log(`게시판 SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
