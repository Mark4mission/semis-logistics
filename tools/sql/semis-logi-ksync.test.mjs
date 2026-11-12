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
for (const t of ["ksync_agents", "ksync_maps", "ksync_files", "ksync_runs", "ksync_folders", "ksync_events", "ksync_state", "ksync_uploads", "ksync_fails", "ksync_run_sers"]) {
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
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'bad_key'"), 1, "bad_key 기록은 IP 마다 15분에 한 줄");
eq(await one("select count(*)::int from semis_logi_private.ksync_fails where ip = $1", [IP]), 2, "차단 셈은 실패마다");
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
eq((await call("put", { run: RUN1, map: M1, rel_path: "a.xlsx", size: 1, sha256: H64("a"), mtime: "2026-11-04T01:00:00Z", mode: "new", part: "abcdefghijkl_a.xlsx" })).error, "state", "미리보기 연결은 실행 안 됨");
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_map_start", M2, "::bigint")).error, "preview", "#9 미리보기 건수가 없으면 [시작] 거절");
eq(await one("select state || '|' || coalesce(hold::text, '-') from semis_logi_private.ksync_maps where id = $1", [M2]), "preview|-", "#9 거절하면 그대로(첫 실행 승인 없음)");
eq((await rpc("semis_logi_ksync_map_start", M1, "::bigint")).ok, true, "시작");
eq(await one("select hold ->> 'ok' from semis_logi_private.ksync_maps where id = $1", [M1]), "true", "첫 실행 승인");
eq(await one("select hold ->> 'n' from semis_logi_private.ksync_maps where id = $1", [M1]), "4", "#16 첫 실행 승인 건수 = 미리보기 전체 건수");
await call("preview", { map: M2, counts: { total: 0 } });
eq((await rpc("semis_logi_ksync_map_start", M2, "::bigint")).ok, true, "건수가 온 뒤 시작");

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
// 올리기 = 시작(put: Edge 가 이름 부분 part 만 넘기고 폴더 · 경로는 SQL 이 정함) → 확인(put_verify: 저장소에서 다시 잰 값) → 등록(put_apply: 여러 건 한 번에)
const part = (n) => "abcdefghijkl" + Math.random().toString(36).slice(2, 8) + "_" + (n || "f.xlsx");
const begin = (rel, o) => call("put", Object.assign({ run: RUN1, map: M1, rel_path: rel, size: 10, sha256: shaA, mtime: "2026-11-03T16:30:00Z", mode: "new", part: part() }, o || {}));
const verify = (path, sha256, size) => call("put_verify", { path, sha256, size });
const apply = (paths, o) => call("put_apply", Object.assign({ run: RUN1, paths, prefix: PUB }, o || {}));
const commit = async (path, sha256, size, o) => {
  const v = await verify(path, sha256, size);
  if (!v.ok) return v;
  const a = await apply([path], o);
  return { ok: a.ok, doc: a.docs && a.docs[path] };
};
eq((await begin("../x.xlsx")).error, "bad", "경로 탈출");
eq((await begin("a/./b.xlsx")).error, "bad", "점 경로");
eq((await begin("a:b.xlsx")).error, "bad", "드라이브 표시");
eq((await begin("big.zip", { size: 50 * 1024 * 1024 + 1 })).error, "too_large", "50MB 초과");
eq((await begin("page.html")).error, "type", "html 은 H 로 안 올림");
eq((await begin("ok.xlsx", { part: "docs-ssi/abcdefghijkl_x.xlsx" })).error, "bad", "이름 부분에 폴더를 넣을 수 없음");
eq((await begin("ok.xlsx", { part: "../docs/x" })).error, "bad", "이름 부분 형식");
eq((await begin("ok.xlsx", { part: undefined, path: "docs/abcdefghijkl_x.xlsx" })).error, "bad", "경로는 받지 않음(이름 부분만)");
eq((await begin("ok.xlsx", { run: 999 })).error, "run", "회차 없음");
const P1PART = "abcdefghijklmn_2026.xlsx";
r = await begin("점검/2026 점검표.xlsx", { part: P1PART, ssi: true });
eq([r.ok, r.path], [true, "docs/" + P1PART], "올리기 시작 — SSI 아닌 연결은 docs/(에이전트 ssi 무시)");
const P1 = r.path;
eq((await begin("점검/2026 점검표.xlsx", { part: P1PART })).error, "bad", "같은 경로 두 번 불가");
eq((await call("put_peek", { path: P1 })).sha256, shaA, "확인할 해시");
eq((await call("put_peek", { path: "docs/zzzzzzzzzzzz_z.xlsx" })).error, "state", "모르는 경로");
eq((await apply([P1])).docs, {}, "확인 전에는 등록 안 됨");
eq((await apply([P1], { prefix: "https://evil.example/x/" })).error, "bad", "주소 앞부분 형식");
eq((await apply("docs/x")).error, "bad", "경로 목록 형식");
eq((await apply([P1], { run: 999 })).error, "run", "등록도 실행 중 회차만");
eq((await verify(P1, shaA, 10)).ok, true, "확인");
eq((await call("put_peek", { path: P1 })).error, "state", "확인한 뒤에는 다시 확인 안 함");
r = await apply([P1]);
r = { ok: r.ok, doc: r.docs[P1] };
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
eq((await verify(P1, shaA, 10)).error, "state", "같은 확인 두 번 불가");
eq((await apply([P1])).docs, {}, "같은 등록 두 번 불가");

// 8-1. 해시 · 크기 불일치 — 버리고 기록
const P2 = (await begin("bad.xlsx")).path;
eq((await verify(P2, H64("b"), 10)).error, "hash", "해시 불일치");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where kind = 'hash_mismatch'"), 1, "hash_mismatch 기록");
eq((await verify(P2, shaA, 10)).error, "state", "불일치한 올리기는 버림");
const P2b = (await begin("bad2.xlsx")).path;
eq((await verify(P2b, shaA, 11)).error, "hash", "크기 불일치");

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
const shaV = H64("c");
eq((await begin("점검/2026 점검표.xlsx", { mode: "version" })).error, "bad", "새 판은 기준선 줄 필요");
r = await begin("점검/2026 점검표.xlsx", { mode: "version", row: B.id, sha256: shaV, size: 12, mtime: "2026-10-01T01:00:00Z" });
eq(r.ok, true, "새 판 시작");
const P3 = r.path;
r = await commit(P3, shaV, 12);
D = await docs();
eq(D[0].id, r.doc, "새 판은 맨 앞");
eq([D[0].ser, D[0].title, D[0].date], [nd.ser, "점검표(편집)", "2026-11-04"], "같은 ser · 지금 제목 · 날짜는 현재 판보다 이르지 않게");
eq(await one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'checklist', $2) ->> 'id'", [JSON.stringify(D), nd.ser]), r.doc, "현재 판 = 새 판");
B = await one("select to_jsonb(f) from semis_logi_private.ksync_files f where id = $1", [B.id]);
eq([B.k_sha256, B.doc_id, B.h_url, B.k_size], [shaV, r.doc, PUB + P3, 12], "기준선 갱신");
// 이전 판으로 남기기(충돌 — H 가 이김) → 맨 뒤 · 현재 판 아님 · 기준선 그대로
const P4 = (await begin("점검/2026 점검표.xlsx", { mode: "old", row: B.id, sha256: H64("d"), size: 3, mtime: "2026-12-01T00:00:00Z" })).path;
r = await commit(P4, H64("d"), 3);
D = await docs();
eq([D[D.length - 1].id, D[D.length - 1].date], [r.doc, "2026-11-04"], "이전 판은 맨 뒤 · 날짜는 현재 판보다 늦지 않게");
ok(await one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'checklist', $2) ->> 'id'", [JSON.stringify(D), nd.ser]) !== r.doc, "현재 판 아님");
eq(await one("select k_sha256 from semis_logi_private.ksync_files where id = $1", [B.id]), shaV, "기준선 그대로");

// 11. hello full — H 쪽 현재 판 목록(판 묶음마다 하나) · 기준선
r = await call("hello", { full: true });
const L1 = r.lists.find(l => l.map === M1);
eq(L1.h.filter(x => !x.hidden).map(x => x.doc).sort(), [D[0].id, "d-exe", "d-h1"].sort(), "현재 판만 · 다른 화면 문서 · SSI(SSI 아닌 연결) 없음");
eq(L1.h.filter(x => x.hidden), [{ ser: "d-ssi", hidden: true }], "SSI 아닌 연결: 현재 판이 SSI 인 판 묶음은 판 묶음 키만(이름 · 주소 없이) — 없는 것으로 보면 'H 에서 지움'");
ok(!JSON.stringify(L1).includes("cccccccccccc_s.pdf"), "SSI 파일 주소는 주지 않음");
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
r = await call("put", { run: RUN1, map: M2, rel_path: "k.pdf", size: 1, sha256: shaA, mtime: "2026-11-01T00:00:00Z", mode: "new", part: "abcdefghijklmn_k.pdf" });
eq([r.ok, r.path], [true, "docs-ssi/abcdefghijklmn_k.pdf"], "SSI 연결은 docs-ssi/");
const P5 = r.path;
r = await commit(P5, shaA, 1);
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
eq((await begin("점검/2026 정기 점검표.xlsx", { run: RUN2, mode: "version", row: B.id, sha256: H64("9") })).error, "held", "보류 중 새 판 거절");
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
eq((await call("put", { run: RUN4, map: M1, rel_path: "q.pdf", size: 101, sha256: shaA, mtime: "2026-11-01T00:00:00Z", mode: "new", part: "abcdefghijklmn_q.pdf" })).error, "quota", "하루 전송량");
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
const evNew = (await rpc("semis_logi_ksync_status")).counts.ev_new;
ok(evNew > 0, "새 이벤트 " + evNew);
r = await rpc("semis_logi_ksync_events", { kind: "scope" });
eq(r.events.length, 4, "종류별 거르기");
ok(r.counts.bad_key >= 2 && r.counts.revoked_key === 1, "종류별 건수 " + JSON.stringify(r.counts));
eq((await rpc("semis_logi_ksync_status")).counts.ev_new, evNew, "D3: 목록을 불러오기만 하면(seen 없음) 본 것 아님");
eq(await one("select ev_seen_at from semis_logi_private.ksync_state"), null, "D3: ev_seen_at 그대로");
await rpc("semis_logi_ksync_events", { seen: false });
eq((await rpc("semis_logi_ksync_status")).counts.ev_new, evNew, "D3: seen false 도 본 것 아님");
await rpc("semis_logi_ksync_events", { kind: "scope", seen: true });
eq([(await rpc("semis_logi_ksync_status")).counts.ev_new, await one("select ev_seen_at from semis_logi_private.ksync_state")], [evNew, null],
  "#8 종류로 거른 목록을 보여 줘도(seen) 본 것 아님 — 다른 종류의 새 이벤트를 보여 주지 않음");
await rpc("semis_logi_ksync_events", { seen: true });
eq((await rpc("semis_logi_ksync_status")).counts.ev_new, 0, "D3: 보안 이벤트 탭을 보여 줄 때(seen) 본 것 → 새 이벤트 0");

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
// #3 — 폴더를 열기만 해도 동작(아이콘 · 검색 연결) · 도움말 · 관리 콘솔 · 디스크 이미지 · 설치 꾸러미 · 브라우저로 열리는 문서도 K 로 쓰지 않음
for (const n of ["x.scf", "a.library-ms", "b.searchConnector-ms", "c.chm", "c.hlp", "d.msc", "e.iso", "e.img", "f.VHDX", "f.vhd", "g.appref-ms", "h.website", "i.rdp",
  "j.xll", "j.wll", "k.wsc", "l.sct", "l.ws", "l.application", "m.settingcontent-ms", "n.theme", "n.themepack", "n.diagcab", "o.xht", "p.XHTML", "q.svg", "r.mht", "r.mhtml",
  "s.inf", "s.ins", "s.isp", "t.cab", "u.msix", "u.msixbundle", "u.appx", "u.appxbundle", "u.gadget", "v.jnlp", "w.psd1", "w.ps1xml", "w.psc1", "w.vb", "x.shtml", "y.mde", "y.accde"]) {
  eq(await one("select semis_logi_private.ksync_k_blocked($1)", [n]), true, "#3 K 로 쓰지 않음 " + n);
}
for (const n of ["a.pdf", "b.xlsx", "c.docx", "d.zip", "e.hwp", "e.hwpx", "f.png", "g.txt", "h.pptx", "i.csv", "j.jpg", "k.msg", "l.website.pdf"]) {
  eq(await one("select semis_logi_private.ksync_k_blocked($1)", [n]), false, "#3 평소 문서는 그대로 " + n);
}

// 19. 리뷰 결함 재현 — 새 연결 M3(SSI 아님)
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();   // 문서함(js/docshelf.js) 판 묶음 칸 저장 규칙
await db.exec(`update semis_logi_private.ksync_state set limits = '{"perMin": 300, "dayBytes": 1000000000}'::jsonb`);
await as("a1", "admin");
await rpc("semis_logi_ksync_settings", { mass_limit: { files: 200, ratio: 0.3 } });
const M3 = (await rpc("semis_logi_ksync_map_save", { k_path: "공무/동기화", mod: "audit", grp: "plan" })).id;
await call("preview", { map: M3, counts: { total: 0 } });
await rpc("semis_logi_ksync_map_start", M3, "::bigint");
await as(null);
const U = (n) => PUB + "docs/" + n;
await db.query("update public.semis_logi_store set value = value || $1::jsonb where key = 'docs'", [JSON.stringify([
  { id: "d-multi", mod: "audit", grp: "plan", title: "여러 첨부", date: "2026-10-05", files: [{ name: "a.pdf", size: 1, url: U("mmmmmmmmmmm1_a.pdf") }, { name: "b.pdf", size: 2, url: U("mmmmmmmmmmm2_b.pdf") }, { name: "c.pdf", size: 3, url: U("mmmmmmmmmmm3_c.pdf") }] },
  { id: "d-x", mod: "audit", grp: "plan", ser: "s10-x", title: "x", date: "2026-10-03", files: [{ name: "x.pdf", size: 1, url: U("xxxxxxxxxxx1_x.pdf") }] },
  { id: "d-x-c1", mod: "audit", grp: "plan", ser: "s10-x", title: "x", date: "2026-10-02", files: [{ name: "x (충돌 2026-11-05).pdf", size: 1, url: U("xxxxxxxxxxx2_x.pdf") }] },
  { id: "d-x-c2", mod: "audit", grp: "plan", ser: "s10-x", title: "x", date: "2026-10-01", files: [{ name: "x (충돌 2026-11-05 2).pdf", size: 1, url: U("xxxxxxxxxxx3_x.pdf") }] },
  { id: "d-x-keep", mod: "audit", grp: "plan", ser: "s10-x", title: "x", date: "2026-09-30", files: [{ name: "x (충돌 메모).pdf", size: 1, url: U("xxxxxxxxxxx4_x.pdf") },
    { name: "xx (충돌 2026-11-05).pdf", size: 1, url: U("xxxxxxxxxxx5_x.pdf") }, { name: "x (충돌 2026-11-05).pdf", size: 1, url: U("xxxxxxxxxxx6_x.pdf") }] }
])]);
let RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
const b3 = (rel, o) => begin(rel, Object.assign({ run: RUN, map: M3 }, o || {}));
const c3 = (path, sha256, size) => commit(path, sha256, size, { run: RUN });
const mk = (items) => call("mark", { run: RUN, map: M3, items });
const end3 = (maps, result) => call("run", { phase: "end", run: RUN, result: result || "ok", maps });
const rowOf = (rel) => one("select id from semis_logi_private.ksync_files where map_id = $1 and rel_path = $2", [M3, rel]);
const cntOf = (run) => one("select (cnt ->> $2)::int from semis_logi_private.ksync_runs where id = $1", [run, String(M3)]);
const holdOf = () => one("select hold from semis_logi_private.ksync_maps where id = $1", [M3]);

// S5 — 판 묶음 키는 K 경로 원문이 아니라 공백 정리(문서함에서 저장해도 같은 키)
const S5REL = "보고서/2026  월간   보고 .pdf";
r = await c3((await b3(S5REL, { sha256: H64("5"), size: 5 })).path, H64("5"), 5);
const s5doc = (await docs()).find(d => d.id === r.doc);
const RS5 = await rowOf(S5REL);
eq([s5doc.ser, await one("select ser from semis_logi_private.ksync_files where id = $1", [RS5])], ["보고서/2026 월간 보고 .pdf", "보고서/2026 월간 보고 .pdf"], "S5: ser 공백 정리(문서 = 기준선)");
eq(norm(s5doc.ser), s5doc.ser, "S5: 문서함 저장 규칙을 거쳐도 같은 키");

// S8 · S10 기준선(첫 실행 승인 중)
eq((await mk([{ op: "set", rel_path: "multi/b.pdf", k_size: 2, k_mtime: "2026-10-05T00:00:00Z", k_sha256: H64("b"), doc_id: "d-multi", h_url: U("mmmmmmmmmmm2_b.pdf") },
  { op: "set", rel_path: "s10/x.pdf", k_size: 1, k_mtime: "2026-10-03T00:00:00Z", k_sha256: H64("ab"), doc_id: "d-x", h_url: U("xxxxxxxxxxx1_x.pdf") }])).n, 2, "기준선 2");
const RB = await rowOf("multi/b.pdf"), RX = await rowOf("s10/x.pdf");
eq((await mk([{ op: "state", id: RX, state: "del_k" }])).n, 1, "S10: K 에서 지움 → 삭제 대기");
await end3([{ id: M3, done: true }]);
eq(await holdOf(), null, "첫 실행 승인 다 씀");

// S10 — K 삭제 확정 때 그 파일의 충돌 이전 판('이름 (충돌 날짜[ n]).확장자')도 지움(남으면 현재 판이 됨)
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_resolve", { ids: [RX], act: "confirm" })).n, 1, "S10: K 삭제 확정");
await as(null);
D = (await docs()).filter(d => d.ser === "s10-x");
eq(D.map(d => d.id), ["d-x-keep"], "S10: 현재 판 · 충돌 이전 판(같은 날 두 번째 포함) 지움");
eq(D[0].files.map(f => f.name), ["x (충돌 메모).pdf", "xx (충돌 2026-11-05).pdf"], "S10: 날짜 형식 아닌 것 · 다른 이름은 남김");
eq(await one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'plan', 's10-x') ->> 'id'", [JSON.stringify(await docs())]), "d-x-keep", "S10: 남은 것만 판 묶음에");

// S10 — 판 묶음에서 맞춘 파일이 이것 하나면 첨부 하나인 판은 이름이 달라도 지움(H 새 판의 다른 이름 · 그때 이름으로 남긴 충돌 사본 — 남으면 현재 판이 되어 K 로 되돌아옴).
//        맞춘 첨부가 여럿인 판 묶음 · 첨부가 여럿인 판은 이름으로만(다른 첨부의 판을 지우지 않게)
await db.query("update public.semis_logi_store set value = value || $1::jsonb where key = 'docs'", [JSON.stringify([
  { id: "d-y", mod: "audit", grp: "plan", ser: "s10-y", title: "y", date: "2026-10-05", files: [{ name: "y-v2.pdf", size: 1, url: U("yyyyyyyyyyy1_y.pdf") }] },
  { id: "d-y0", mod: "audit", grp: "plan", ser: "s10-y", title: "y", date: "2026-10-01", files: [{ name: "y.pdf", size: 1, url: U("yyyyyyyyyyy2_y.pdf") }] },
  { id: "d-y-c", mod: "audit", grp: "plan", ser: "s10-y", title: "y", date: "2026-10-02", files: [{ name: "y (충돌 2026-11-05).pdf", size: 1, url: U("yyyyyyyyyyy3_y.pdf") }] },
  { id: "d-y-m", mod: "audit", grp: "plan", ser: "s10-y", title: "y", date: "2026-09-01", files: [{ name: "y-v2.pdf", size: 1, url: U("yyyyyyyyyyy4_y.pdf") }, { name: "별첨.pdf", size: 1, url: U("yyyyyyyyyyy5_y.pdf") }] },
  { id: "d-z", mod: "audit", grp: "plan", ser: "s10-z", title: "z", date: "2026-10-05", files: [{ name: "z1.pdf", size: 1, url: U("zzzzzzzzzzz1_z.pdf") }, { name: "z2.pdf", size: 1, url: U("zzzzzzzzzzz2_z.pdf") }] },
  { id: "d-z-old", mod: "audit", grp: "plan", ser: "s10-z", title: "z", date: "2026-10-01", files: [{ name: "z0.pdf", size: 1, url: U("zzzzzzzzzzz3_z.pdf") }] }
])]);
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
eq((await mk([{ op: "set", rel_path: "s10/y-v2.pdf", k_size: 1, k_mtime: "2026-10-05T00:00:00Z", k_sha256: H64("a1"), doc_id: "d-y", h_url: U("yyyyyyyyyyy1_y.pdf") },
  { op: "set", rel_path: "s10/z1.pdf", k_size: 1, k_mtime: "2026-10-05T00:00:00Z", k_sha256: H64("b2"), doc_id: "d-z", h_url: U("zzzzzzzzzzz1_z.pdf") },
  { op: "set", rel_path: "s10/z2.pdf", k_size: 1, k_mtime: "2026-10-05T00:00:00Z", k_sha256: H64("c3"), doc_id: "d-z", h_url: U("zzzzzzzzzzz2_z.pdf") }])).n, 3, "S10: 기준선 3");
const RY = await rowOf("s10/y-v2.pdf"), RZ1 = await rowOf("s10/z1.pdf");
eq((await mk([{ op: "state", id: RY, state: "del_k" }, { op: "state", id: RZ1, state: "del_k" }])).n, 2, "S10: 삭제 대기 2");
await end3([{ id: M3, done: true }]);
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_resolve", { ids: [RY, RZ1], act: "confirm" })).n, 2, "S10: K 삭제 확정 2");
await as(null);
D = await docs();
eq(D.filter(d => d.ser === "s10-y").map(d => [d.id, d.files.map(f => f.name)]), [["d-y-m", ["별첨.pdf"]]], "S10: 맞춘 파일 하나 → 첨부 하나인 판은 이름이 달라도 지움 · 첨부 여럿인 판은 이 파일만");
eq(D.filter(d => d.ser === "s10-z").map(d => [d.id, d.files.map(f => f.name)]), [["d-z", ["z2.pdf"]], ["d-z-old", ["z0.pdf"]]], "S10: 맞춘 첨부가 여럿인 판 묶음은 이름으로만");

// S3 — '새 문서'인데 기준선 줄의 판 묶음이 H 에 남아 있으면 새 판으로 · 변경으로 셈(복원은 셈 안 함)
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
D = await docs();
D.forEach(d => { if (d.ser) d.ser = norm(d.ser); });
await db.query("update public.semis_logi_store set value = $1::jsonb where key = 'docs'", [JSON.stringify(D)]);   // 문서함에서 한 번 저장
r = await b3(S5REL, { mode: "new", row: RS5, sha256: H64("6"), size: 6, mtime: "2026-11-05T00:00:00Z" });
eq([r.ok, await one("select mode from semis_logi_private.ksync_uploads where path = $1", [r.path])], [true, "version"], "S3: new → version");
eq(await cntOf(RUN), 1, "S3: 변경으로 셈");
r = await c3(r.path, H64("6"), 6);
D = await docs();
eq(D.filter(d => d.ser === s5doc.ser).length, 2, "S5: 문서함 저장 뒤에도 같은 판 묶음에 새 판");
eq([D[0].id, await one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'plan', $2) ->> 'id'", [JSON.stringify(D), s5doc.ser])], [r.doc, r.doc], "S3: 새 판 = 현재 판(맨 앞)");
await db.query("update semis_logi_private.ksync_files set state = 'restore' where id = $1", [RS5]);
r = await b3(S5REL, { mode: "new", row: RS5, sha256: H64("7"), size: 7 });
eq([r.ok, await one("select mode from semis_logi_private.ksync_uploads where path = $1", [r.path]), await cntOf(RUN)], [true, "version", 1], "S3: 관리자가 고른 복원은 셈하지 않음");
await db.query("update semis_logi_private.ksync_files set state = 'ok' where id = $1", [RS5]);

// S8 — 여러 첨부 문서의 한 파일을 K 에서 고치면 새 판은 다른 첨부를 그대로 두고 그 파일만 바꿈
r = await b3("multi/b.pdf", { mode: "version", row: RB, sha256: H64("c"), size: 22, mtime: "2026-11-05T00:00:00Z" });
const PB = r.path;
r = await c3(PB, H64("c"), 22);
D = await docs();
const nb = D.find(d => d.id === r.doc);
eq([nb.title, nb.ser, nb.files.map(f => [f.name, f.url])], ["여러 첨부", "d-multi", [["a.pdf", U("mmmmmmmmmmm1_a.pdf")], ["b.pdf", PUB + PB], ["c.pdf", U("mmmmmmmmmmm3_c.pdf")]]], "S8: 그 파일만 바꾼 새 판");
eq(D.find(d => d.id === "d-multi").files.map(f => f.url), [U("mmmmmmmmmmm1_a.pdf"), U("mmmmmmmmmmm2_b.pdf"), U("mmmmmmmmmmm3_c.pdf")], "S8: 이전 판 그대로");
eq(await one("select h_url || '|' || h_name from semis_logi_private.ksync_files where id = $1", [RB]), PUB + PB + "|b.pdf", "S8: 기준선은 바꾼 파일");
eq(await cntOf(RUN), 2, "S8: 변경으로 셈");

// S6 — H 가 이긴 충돌에서 H 새 파일 이름이 달라도 mark set(id)은 같은 줄을 고침 → 이어지는 '이전 판 올리기'가 그 줄을 찾음
await db.query("update public.semis_logi_store set value = $1::jsonb || value where key = 'docs'", [JSON.stringify([
  { id: "d-multi-h", mod: "audit", grp: "plan", ser: "d-multi", title: "여러 첨부", date: "2026-11-06", files: [{ name: "a.pdf", size: 1, url: U("mmmmmmmmmmm1_a.pdf") },
    { name: "b-수정.pdf", size: 9, url: U("mmmmmmmmmmm4_b.pdf") }, { name: "c.pdf", size: 3, url: U("mmmmmmmmmmm3_c.pdf") }] }])]);
const nRows = await one("select count(*)::int from semis_logi_private.ksync_files where map_id = $1", [M3]);
eq((await mk([{ op: "set", id: RB, rel_path: "multi/b-수정.pdf", k_size: 9, k_mtime: "2026-11-06T00:00:00Z", k_sha256: H64("d"), doc_id: "d-multi-h", h_url: U("mmmmmmmmmmm4_b.pdf"), state: "conflict" }])).n, 1, "S6: mark set");
eq([await rowOf("multi/b-수정.pdf"), await one("select count(*)::int from semis_logi_private.ksync_files where map_id = $1", [M3])], [RB, nRows], "S6: 같은 줄(id 그대로)");
eq(await one("select h_name || '|' || state from semis_logi_private.ksync_files where id = $1", [RB]), "b-수정.pdf|conflict", "S6: 줄 내용 갱신");
r = await b3("multi/b (충돌 2026-11-06).pdf", { mode: "old", row: RB, sha256: H64("e"), size: 4 });
eq(r.ok, true, "S6: 이어지는 이전 판 올리기가 줄을 찾음");
r = await c3(r.path, H64("e"), 4);
D = await docs();
eq([D[D.length - 1].id, D[D.length - 1].ser], [r.doc, "d-multi"], "S6: 이전 판은 같은 판 묶음 맨 뒤");

// S4 — SSI 아닌 연결이라도 민감보안정보 판 묶음에 들어가는 새 판은 docs-ssi/
await db.query("update public.semis_logi_store set value = (select jsonb_agg(case when d ->> 'ser' = $1 then d || '{\"ssi\": true}'::jsonb else d end order by i) from jsonb_array_elements(value) with ordinality x(d, i)) where key = 'docs'", [s5doc.ser]);
r = await b3(S5REL, { mode: "version", row: RS5, sha256: H64("8"), size: 8 });
ok(r.ok && /^docs-ssi\/[a-z0-9]{12,24}_/.test(r.path), "S4: docs-ssi/ " + JSON.stringify(r));
const PS4 = r.path;
r = await c3(PS4, H64("8"), 8);
const s4doc = (await docs()).find(d => d.id === r.doc);
eq([s4doc.ssi, s4doc.files[0].url], [true, PUB + PS4], "S4: 새 판 ssi · SSI 폴더 주소");
eq(await cntOf(RUN), 3, "변경 3");
// S4 뒤 — 현재 판이 SSI 가 된 판 묶음은 SSI 아닌 연결의 H 목록에서 판 묶음 키만 남음(빠지면 다음 실행이 그 K 파일을 'H 에서 지움'으로 봄)
r = await call("hello", { full: true });
const L3 = r.lists.find(l => l.map === M3);
eq([L3.h.filter(x => x.ser === s5doc.ser), JSON.stringify(L3.h).includes(PS4)], [[{ ser: s5doc.ser, hidden: true }], false], "S4 뒤: SSI 아닌 연결 — 판 묶음 키만(주소 없음)");
ok(L3.h.filter(x => !x.hidden).length > 0 && L3.h.filter(x => !x.hidden).every(x => x.url && !x.ssi), "S4 뒤: 다른 판 묶음은 그대로");
await db.exec(`update semis_logi_private.ksync_maps set ssi = true where id = ${M3}`);
r = await call("hello", { full: true });
eq(r.lists.find(l => l.map === M3).h.filter(x => x.ser === s5doc.ser).map(x => [x.doc, x.url, !!x.hidden]), [[s4doc.id, PUB + PS4, false]], "SSI 연결은 숨긴 표시 없이 그 판");
await db.exec(`update semis_logi_private.ksync_maps set ssi = false where id = ${M3}`);
await end3([{ id: M3, done: true }]);

// S2 — 대량 변경 보류는 승인 전까지 다음 회차에도 막고, 에이전트 done:true 로 지울 수 없음
await as("a1", "admin");
await rpc("semis_logi_ksync_settings", { mass_limit: { files: 2, ratio: 0.3 } });
await as(null);
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
const RUN7 = RUN;
eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("1"), size: 1 })).ok, true, "변경 1");
eq((await b3(S5REL, { mode: "version", row: RS5, sha256: H64("2"), size: 1 })).ok, true, "변경 2");
eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("3"), size: 1 })).error, "held", "S2: 변경 3 → 보류");
eq([(await holdOf()).run, (await holdOf()).ok], [RUN7, undefined], "S2: 보류(승인 전)");
await end3([{ id: M3, done: true, n_files: 4 }]);
eq([(await holdOf()).run, (await holdOf()).ok], [RUN7, undefined], "S2: 에이전트 done:true 로 승인 전 보류를 지울 수 없음");
RUN = (await call("run", { phase: "start", trigger: "daily" })).run;
eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("4"), size: 1 })).error, "held", "S2: 다음 회차 첫 변경도 보류");
eq((await mk([{ op: "state", id: RS5, state: "del_k" }])).held, true, "S2: 다음 회차 삭제 대기도 보류");
eq(await cntOf(RUN), null, "S2: 보류 중에는 세지도 않음");
await end3([{ id: M3, held: true, n: 3, base: 2 }], "held");
eq((await holdOf()).run, RUN7, "S2: 보류가 이어져도 처음 회차 그대로");
await as("a1", "admin");
eq((await rpc("semis_logi_ksync_hold", { run_id: String(RUN7), act: "approve" })).ok, true, "승인");
await as(null);

// S11 — 승인한 보류는 그 연결을 끝까지 맞춘 회차(done:true)에서만 다 씀(폴더 없음 등으로 못 맞춘 회차에는 남음)
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await end3([{ id: M3, done: false }], "partial");
eq((await holdOf()).ok, true, "S11: done 아님 → 승인 남음");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await end3([], "fail");
eq((await holdOf()).ok, true, "S11: 연결 결과 없음 → 승인 남음");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("5"), size: 1 })).ok, true, "S11: 승인 뒤 진행");
eq((await mk([{ op: "state", id: RS5, state: "del_k" }])).n, 1, "S11: 승인 뒤 삭제 대기");
await end3([{ id: M3, done: true }]);
eq(await holdOf(), null, "S11: 승인 + done:true 일 때만 지움");

// 기준선 줄 없는 새 문서의 판 묶음 키를 이미 쓰는 곳이 있으면 따로 묶음 — K 에서 q.pdf → q2.pdf 로 바꾼 뒤 새 q.pdf 를 만들면 옛 키(q.pdf)를 이어 쓰지 않음
await db.query("update public.semis_logi_store set value = value || $1::jsonb where key = 'docs'", [JSON.stringify([
  { id: "d-q", mod: "audit", grp: "plan", ser: "ren/q.pdf", title: "q2", date: "2026-10-01", files: [{ name: "q.pdf", size: 1, url: U("qqqqqqqqqqq1_q.pdf") }] },
  { id: "d-w", mod: "audit", grp: "plan", ser: "ren/w.pdf", title: "w2", date: "2026-10-01", files: [{ name: "w.pdf", size: 1, url: U("qqqqqqqqqqq2_w.pdf") }] }])]);
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
eq((await mk([{ op: "set", rel_path: "ren/q2.pdf", k_size: 1, k_mtime: "2026-10-01T00:00:00Z", k_sha256: H64("e1"), doc_id: "d-q", h_url: U("qqqqqqqqqqq1_q.pdf") },
  { op: "set", rel_path: "ren/w2.pdf", k_size: 1, k_mtime: "2026-10-01T00:00:00Z", k_sha256: H64("e2"), doc_id: "d-w", h_url: U("qqqqqqqqqqq2_w.pdf") }])).n, 2, "이름 바꾼 파일 기준선 2(옛 경로 키)");
await db.query("update public.semis_logi_store set value = (select jsonb_agg(x.v order by x.i) from jsonb_array_elements(value) with ordinality x(v, i) where x.v ->> 'id' <> 'd-w') where key = 'docs'");
r = await c3((await b3("ren/q.pdf", { sha256: H64("e3"), size: 3, mtime: "2026-11-06T00:00:00Z" })).path, H64("e3"), 3);
D = await docs();
eq([D.find(d => d.id === r.doc).ser, await one("select ser from semis_logi_private.ksync_files where map_id = $1 and rel_path = 'ren/q.pdf'", [M3])], ["ren/q.pdf (2)", "ren/q.pdf (2)"],
  "새 q.pdf 는 옛 키를 쓰는 판 묶음에 끼지 않음(문서 = 기준선)");
eq(await one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'plan', 'ren/q.pdf') ->> 'id'", [JSON.stringify(D)]), "d-q", "이름 바꾼 파일의 문서가 그대로 그 묶음의 현재 판");
r = await c3((await b3("ren/w.pdf", { sha256: H64("e4"), size: 3 })).path, H64("e4"), 3);
eq((await docs()).find(d => d.id === r.doc).ser, "ren/w.pdf (2)", "H 문서가 없어도 기준선 줄이 쓰는 키는 피함");
r = await c3((await b3("ren/n.pdf", { sha256: H64("e5"), size: 3 })).path, H64("e5"), 3);
eq((await docs()).find(d => d.id === r.doc).ser, "ren/n.pdf", "겹치지 않으면 경로 키 그대로");
await end3([{ id: M3, done: true }]);

// D1 — 미리보기 중 연결의 폴더 · 대상 · 방향 · SSI 를 바꾸면 옛 미리보기를 지우고 다시 요청
await as("a1", "admin");
const M4 = (await rpc("semis_logi_ksync_map_save", { k_path: "공무/미리보기", mod: "audit", grp: "misc" })).id;
const pv = async () => { await as(null); await call("preview", { map: M4, counts: { k2h: 5, total: 5 } }); await db.exec("update semis_logi_private.ksync_state set requested_at = null"); await as("a1", "admin"); };
const pvOf = () => one("select preview ->> 'k2h' from semis_logi_private.ksync_maps where id = $1", [M4]);
const reqOf = () => one("select requested_at is not null from semis_logi_private.ksync_state");
await pv();
eq((await rpc("semis_logi_ksync_map_save", { id: M4, k_path: "공무/미리보기", mod: "audit", grp: "misc", dir: "both", ssi: false })).ok, true, "같은 값 저장");
eq([await pvOf(), await reqOf()], ["5", false], "D1: 바뀐 것 없으면 미리보기 그대로");
await rpc("semis_logi_ksync_map_save", { id: M4, dir: "k2h" });
eq([await pvOf(), await reqOf()], [null, true], "D1: 방향 바꿈 → 미리보기 지움 · 다시 요청");
await pv();
await rpc("semis_logi_ksync_map_save", { id: M4, ssi: true });
eq([await pvOf(), await reqOf()], [null, true], "D1: SSI 바꿈");
await pv();
await rpc("semis_logi_ksync_map_save", { id: M4, k_path: "공무/미리보기2" });
eq([await pvOf(), await reqOf()], [null, true], "D1: 폴더 바꿈");
await pv();
await rpc("semis_logi_ksync_map_save", { id: M4, grp: "plan2" });
eq([await pvOf(), await reqOf()], [null, true], "D1: 분류 바꿈");
await db.exec("update semis_logi_private.ksync_state set requested_at = null");
await rpc("semis_logi_ksync_map_save", { id: M3, dir: "k2h" });
eq(await reqOf(), false, "D1: 실행 중 연결은 해당 없음");
await rpc("semis_logi_ksync_map_save", { id: M3, dir: "both" });

// #9 — 미리보기 건수는 hello 가 준 설정 시각(updated_at)과 같을 때만 받음 · 건수가 없으면 [시작] 거절
eq((await rpc("semis_logi_ksync_map_start", M4, "::bigint")).error, "preview", "#9 설정을 고쳐 건수가 지워진 연결은 [시작] 거절");
const m4at = (await call("hello", { full: true })).maps.find(m => m.id === M4).updated_at;
ok(!!m4at, "#9 hello 연결에 설정 시각");
await rpc("semis_logi_ksync_map_save", { id: M4, ssi: true });     // 에이전트가 hello 를 받은 뒤 관리자가 고침
await db.exec("update semis_logi_private.ksync_state set requested_at = null");
r = await call("preview", { map: M4, updated_at: m4at, counts: { k2h: 7, total: 7 } });
eq([r.ok, r.stale, await pvOf(), await reqOf()], [true, true, null, true], "#9 옛 설정으로 센 건수는 버리고(오류 아님) 다시 요청");
r = await call("preview", { map: M4, updated_at: "아님", counts: { k2h: 7, total: 7 } });
eq([r.stale, await pvOf()], [true, null], "#9 설정 시각 형식이 틀려도 버림");
const m4at2 = (await call("hello", { full: true })).maps.find(m => m.id === M4).updated_at;
r = await call("preview", { map: M4, updated_at: m4at2, counts: { k2h: 7, total: 7 } });
eq([r.ok, r.stale, await pvOf()], [true, undefined, "7"], "#9 지금 설정으로 센 건수는 받음");
eq((await rpc("semis_logi_ksync_map_start", M4, "::bigint")).ok, true, "#9 건수가 온 뒤 [시작]");
eq(await one("select (hold ->> 'n') || '|' || (hold ->> 'ok') || '|' || (hold ->> 'first') from semis_logi_private.ksync_maps where id = $1", [M4]), "7|true|true", "#16 첫 실행 승인 건수 = 미리보기 전체 건수");
await rpc("semis_logi_ksync_map_delete", M4, "::bigint");

// #12 — 폴더 겹침은 글자 그대로 비교('_' · '%' 는 와일드카드가 아님)
const m12 = [];
const save12 = async (k_path, grp) => { const x = await rpc("semis_logi_ksync_map_save", { k_path, mod: "audit", grp }); if (x.ok) m12.push(x.id); return x; };
eq((await save12("2026_점검", "k12a")).ok, true, "#12 '_' 든 폴더 연결");
eq((await save12("2026-점검/월별", "k12b")).ok, true, "#12 '_' 가 한 글자 와일드카드로 읽히지 않음(겹치지 않는 폴더)");
eq((await save12("2026_점검/월별", "k12c")).error, "k_dup", "#12 진짜 아래 폴더는 겹침");
eq((await save12("2026_점", "k12g")).ok, true, "#12 앞부분만 같은 이름은 겹치지 않음");
eq((await save12("a%", "k12d")).ok, true, "#12 '%' 든 폴더 연결");
eq((await save12("abcd/e", "k12e")).ok, true, "#12 '%' 도 글자 그대로");
eq((await save12("A%/x", "k12f")).error, "k_dup", "#12 대소문자는 가리지 않음");
eq((await save12("ABCD", "k12h")).error, "k_dup", "#12 위 폴더도 겹침");
for (const id of m12) await rpc("semis_logi_ksync_map_delete", id, "::bigint");

/* ─── 2차 리뷰 결함 재현(M3 — SSI 아님 · 양방향) ─── */
await rpc("semis_logi_ksync_settings", { mass_limit: { files: 200, ratio: 0.3 } });
await as(null);     // 문서함 직접 고치기는 세션 없이(관리자 세션이면 충돌 확인 409)
const addDocs =(list) => db.query("update public.semis_logi_store set value = value || $1::jsonb where key = 'docs'", [JSON.stringify(list)]);
const frontDocs = (list) => db.query("update public.semis_logi_store set value = $1::jsonb || value where key = 'docs'", [JSON.stringify(list)]);
const curOf = async (ser) => one("select semis_logi_private.ksync_cur($1::jsonb, 'audit', 'plan', $2)", [JSON.stringify(await docs()), ser]);
const serDocs = async (ser) => (await docs()).filter(d => d.mod === "audit" && d.grp === "plan" && d.ser === ser).map(d => [d.id, d.files.map(f => f.name)]);
const fileRow = (id) => one("select to_jsonb(f) from semis_logi_private.ksync_files f where id = $1", [id]);
const setRow = (rel, doc_id, url, sha) => ({ op: "set", rel_path: rel, k_size: 1, k_mtime: "2026-10-01T00:00:00Z", k_sha256: H64(sha), doc_id, h_url: url });

// #0 — K 삭제 확정: K 에서 지운 뒤 H 가 고친 판(다른 이름 · 같은 이름) · 이 연결이 볼 수 없는 민감보안정보 판은 지우지 않고 충돌로.
//       지울 때도 이름으로 고르는 것은 기준선 판보다 늦지 않은 판만(그 뒤 H 가 만든 판은 K 가 본 적 없는 H 작업)
await addDocs([
  { id: "d-k0a", mod: "audit", grp: "plan", ser: "k0-a", title: "a", date: "2026-10-01", files: [{ name: "a.pdf", size: 1, url: U("k0aaaaaaaaa1_a.pdf") }] },
  { id: "d-k0b", mod: "audit", grp: "plan", ser: "k0-b", title: "b", date: "2026-10-01", files: [{ name: "b.pdf", size: 1, url: U("k0bbbbbbbbb1_b.pdf") }] },
  { id: "d-k0c", mod: "audit", grp: "plan", ser: "k0-c", title: "c", date: "2026-10-01", files: [{ name: "c.pdf", size: 1, url: U("k0ccccccccc1_c.pdf") }] },
  { id: "d-k0d-old", mod: "audit", grp: "plan", ser: "k0-d", title: "d", date: "2026-09-01", files: [{ name: "d.pdf", size: 1, url: U("k0ddddddddd0_d.pdf") }] },
  { id: "d-k0d", mod: "audit", grp: "plan", ser: "k0-d", title: "d", date: "2026-10-01", files: [{ name: "d.pdf", size: 1, url: U("k0ddddddddd1_d.pdf") }] }]);
await as(null);
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
eq((await mk([setRow("k0/a.pdf", "d-k0a", U("k0aaaaaaaaa1_a.pdf"), "a1"), setRow("k0/b.pdf", "d-k0b", U("k0bbbbbbbbb1_b.pdf"), "b1"),
  setRow("k0/c.pdf", "d-k0c", U("k0ccccccccc1_c.pdf"), "c1"), setRow("k0/d.pdf", "d-k0d", U("k0ddddddddd1_d.pdf"), "d1")])).n, 4, "#0 기준선 4");
const K0 = { a: await rowOf("k0/a.pdf"), b: await rowOf("k0/b.pdf"), c: await rowOf("k0/c.pdf"), d: await rowOf("k0/d.pdf") };
eq((await mk(Object.values(K0).map(id => ({ op: "state", id, state: "del_k" })))).n, 4, "#0 K 에서 지움 → 삭제 대기 4");
await end3([{ id: M3, done: true }]);
await addDocs([
  { id: "d-k0a2", mod: "audit", grp: "plan", ser: "k0-a", title: "a", date: "2026-10-09", files: [{ name: "a-개정.pdf", size: 1, url: U("k0aaaaaaaaa2_a.pdf") }] },
  { id: "d-k0b2", mod: "audit", grp: "plan", ser: "k0-b", title: "b", date: "2026-10-09", files: [{ name: "b.pdf", size: 1, url: U("k0bbbbbbbbb2_b.pdf") }] },
  { id: "d-k0d2", mod: "audit", grp: "plan", ser: "k0-d", title: "d", date: "2026-10-09", files: [{ name: "d.pdf", size: 1, url: U("k0ddddddddd1_d.pdf") }, { name: "별첨.pdf", size: 1, url: U("k0ddddddddd3_d.pdf") }] },
  { id: "d-k0d-mid", mod: "audit", grp: "plan", ser: "k0-d", title: "d", date: "2026-10-05", files: [{ name: "d.pdf", size: 1, url: U("k0ddddddddd2_d.pdf") }, { name: "메모.pdf", size: 1, url: U("k0ddddddddd4_d.pdf") }] },
  { id: "d-k0d-x", mod: "audit", grp: "plan", ser: "k0-d", title: "d", date: "2026-10-07", files: [{ name: "다른.pdf", size: 1, url: U("k0ddddddddd5_d.pdf") }] }]);
await db.query("update public.semis_logi_store set value = (select jsonb_agg(case when d ->> 'id' = 'd-k0c' then d || '{\"ssi\": true}'::jsonb else d end order by i) from jsonb_array_elements(value) with ordinality x(d, i)) where key = 'docs'");
await as("a1", "admin");
r = await rpc("semis_logi_ksync_resolve", { ids: Object.values(K0), act: "confirm" });
eq([r.ok, r.n, r.kept], [true, 1, 3], "#0 확정 1 · 지우지 않고 충돌로 3");
for (const k of ["a", "b", "c"]) eq(await one("select state || '|' || note from semis_logi_private.ksync_files where id = $1", [K0[k]]), "conflict|H 에 새 판", "#0 " + k + ": 충돌 · 'H 에 새 판'");
eq(await serDocs("k0-a"), [["d-k0a", ["a.pdf"]], ["d-k0a2", ["a-개정.pdf"]]], "#0 H 가 다른 이름으로 만든 새 판 · 기준선 판 모두 남음");
eq(await serDocs("k0-b"), [["d-k0b", ["b.pdf"]], ["d-k0b2", ["b.pdf"]]], "#0 H 가 같은 이름으로 만든 새 판 · 기준선 판 모두 남음");
eq(await serDocs("k0-c"), [["d-k0c", ["c.pdf"]]], "#0 이 연결이 볼 수 없는 민감보안정보 판은 남음");
eq(await fileRow(K0.d), undefined, "#0 d: 확정 → 기준선 줄 지움");
eq(await serDocs("k0-d"), [["d-k0d2", ["별첨.pdf"]], ["d-k0d-mid", ["d.pdf", "메모.pdf"]], ["d-k0d-x", ["다른.pdf"]]],
  "#0 d: 이 파일(주소)은 모든 판에서 · 이름 · 첨부 하나인 판은 기준선 판보다 늦지 않은 판만 지움");

// #2 — 지금 판의 하나뿐인 첨부를 같은 판 묶음의 다른 기준선 줄이 맞추고 있으면 그 줄의 파일 — K 새 판은 그것을 바꾸지 않고 뒤에 더함
await as(null);
await addDocs([
  { id: "d-k2", mod: "audit", grp: "plan", ser: "k2", title: "k2", date: "2026-10-01", files: [{ name: "m1.pdf", size: 1, url: U("k2mmmmmmmm1_m1.pdf") }, { name: "m2.pdf", size: 1, url: U("k2mmmmmmmm2_m2.pdf") }] },
  { id: "d-k2s", mod: "audit", grp: "plan", ser: "k2s", title: "k2s", date: "2026-10-01", files: [{ name: "s.pdf", size: 1, url: U("k2ssssssss1_s.pdf") }] }]);
RUN =(await call("run", { phase: "start", trigger: "manual" })).run;
await mk([setRow("k2/m1.pdf", "d-k2", U("k2mmmmmmmm1_m1.pdf"), "e1"), setRow("k2/m2.pdf", "d-k2", U("k2mmmmmmmm2_m2.pdf"), "e2"), setRow("k2/s.pdf", "d-k2s", U("k2ssssssss1_s.pdf"), "e3")]);
const R21 = await rowOf("k2/m1.pdf"), R22 = await rowOf("k2/m2.pdf"), R2S = await rowOf("k2/s.pdf");
await frontDocs([{ id: "d-k2v", mod: "audit", grp: "plan", ser: "k2", title: "k2", date: "2026-10-08", files: [{ name: "m2.pdf", size: 1, url: U("k2mmmmmmmm2_m2.pdf") }] },
  { id: "d-k2s2", mod: "audit", grp: "plan", ser: "k2s", title: "k2s", date: "2026-10-08", files: [{ name: "s-개정.pdf", size: 1, url: U("k2ssssssss2_s.pdf") }] }]);
r = await c3((await b3("k2/m1.pdf", { mode: "new", row: R21, sha256: H64("21"), size: 21, mtime: "2026-11-06T00:00:00Z" })).path, H64("21"), 21);
let c2 = await curOf("k2");
eq([c2.id, c2.files.map(f => f.name), c2.files[0].url], [r.doc, ["m2.pdf", "m1.pdf"], U("k2mmmmmmmm2_m2.pdf")], "#2 H 가 m1 을 뺀 판에 K 가 m1 을 고침 → m2 는 그대로 · m1 은 뒤에 더함");
eq((await fileRow(R22)).h_url, U("k2mmmmmmmm2_m2.pdf"), "#2 m2 줄 그대로");
r = await c3((await b3("k2/s.pdf", { mode: "new", row: R2S, sha256: H64("22"), size: 22, mtime: "2026-11-06T00:00:00Z" })).path, H64("22"), 22);
c2 = await curOf("k2s");
eq([c2.id, c2.files.map(f => f.name)], [r.doc, ["s.pdf"]], "#2 맞춘 줄이 하나뿐인 판 묶음은 하나뿐인 첨부 자리에(H 가 이름을 바꾼 판)");
// #2 이름 — H 가 n1 을 빼고 n2 를 같은 이름 · 새 주소로 다시 올린 판. n2 줄의 받기가 등록 전에 돌지 않으면(K→H 만인 연결 · 받기 실패)
//    그 줄의 주소는 옛 판 그대로라 이름으로만 알아본다 — 바꾸면 H 의 새 n2 가 사라지고 n2 줄이 'H 에서 지움'이 되어 확정하면 K 의 n2 가 휴지통으로
await addDocs([{ id: "d-k2n", mod: "audit", grp: "plan", ser: "k2n", title: "k2n", date: "2026-10-01", files: [{ name: "n1.pdf", size: 1, url: U("k2nnnnnnnn1_n1.pdf") }, { name: "n2.pdf", size: 1, url: U("k2nnnnnnnn2_n2.pdf") }] }]);
await mk([setRow("k2n/n1.pdf", "d-k2n", U("k2nnnnnnnn1_n1.pdf"), "c6"), setRow("k2n/n2.pdf", "d-k2n", U("k2nnnnnnnn2_n2.pdf"), "c7")]);
const R2N1 = await rowOf("k2n/n1.pdf"), R2N2 = await rowOf("k2n/n2.pdf");
await frontDocs([{ id: "d-k2nv", mod: "audit", grp: "plan", ser: "k2n", title: "k2n", date: "2026-10-08", files: [{ name: "n2.pdf", size: 8, url: U("k2nnnnnnnn3_n2.pdf") }] }]);
r = await c3((await b3("k2n/n1.pdf", { mode: "new", row: R2N1, sha256: H64("23"), size: 23, mtime: "2026-11-06T00:00:00Z" })).path, H64("23"), 23);
c2 = await curOf("k2n");
eq([c2.id, c2.files.map(f => f.name), c2.files[0].url], [r.doc, ["n2.pdf", "n1.pdf"], U("k2nnnnnnnn3_n2.pdf")], "#2 H 가 n2 를 새 주소로 다시 올린 판 · K 가 n1 을 고침 → H 의 새 n2 는 그대로 · n1 은 뒤에 더함");
eq((await fileRow(R2N2)).h_url, U("k2nnnnnnnn2_n2.pdf"), "#2 n2 줄 그대로(다음 실행이 H 새 판으로 봄)");

// 복원 — K→H 만인 연결에서 K 에서 지운 뒤 H 가 새 판을 만듦: 계획은 지금 판(새 주소)을 받으러 온다. 복원 줄의 판 묶음이면 방향과 관계없이 받고,
//        다른 판 묶음은 그대로 방향 밖. 기준선 주소만 보면 거절되어 그 줄은 오류 → 다음 실행부터 건너뜀(dir)으로 다시 복원할 수 없게 된다
await addDocs([{ id: "d-kr", mod: "audit", grp: "plan", ser: "kr", title: "kr", date: "2026-10-01", files: [{ name: "r.pdf", size: 1, url: U("krrrrrrrrrr1_r.pdf") }] },
  { id: "d-kro", mod: "audit", grp: "plan", ser: "kro", title: "kro", date: "2026-10-01", files: [{ name: "o.pdf", size: 1, url: U("krrrrrrrrrr9_o.pdf") }] }]);
await mk([setRow("kr/r.pdf", "d-kr", U("krrrrrrrrrr1_r.pdf"), "c8")]);
const RKR = await rowOf("kr/r.pdf");
eq((await mk([{ op: "state", id: RKR, state: "del_k" }])).n, 1, "복원: K 에서 지움 → 삭제 대기");
await frontDocs([{ id: "d-kr2", mod: "audit", grp: "plan", ser: "kr", title: "kr", date: "2026-10-09", files: [{ name: "r.pdf", size: 2, url: U("krrrrrrrrrr2_r.pdf") }] }]);
await as("a1", "admin");
await rpc("semis_logi_ksync_map_save", { id: M3, dir: "k2h" });
eq((await rpc("semis_logi_ksync_resolve", { ids: [RKR], act: "restore" })).n, 1, "복원: [복원]");
await as(null);
r = await call("get", { run: RUN, map: M3, doc: "d-kr2", url: U("krrrrrrrrrr2_r.pdf") });
eq([r.ok, r.path, r.error], [true, "docs/krrrrrrrrrr2_r.pdf", undefined], "복원: K→H 만 · 복원 줄의 판 묶음 지금 판(H 새 판) → 받음");
eq((await call("get", { run: RUN, map: M3, doc: "d-kro", url: U("krrrrrrrrrr9_o.pdf") })).error, "state", "복원: K→H 만 · 다른 판 묶음은 그대로 방향 밖");
await as("a1", "admin");
await rpc("semis_logi_ksync_map_save", { id: M3, dir: "both" });
await as(null);

// #5 — 계획 뒤(올리기 시작 · 확인 뒤) H 가 새 판을 만들면 'K 만 바뀜' 새 판은 등록하지 않음 — 다음 실행이 충돌 규칙을 탄다
await addDocs([
  { id: "d-k5", mod: "audit", grp: "plan", ser: "k5", title: "w", date: "2026-10-01", files: [{ name: "w.pdf", size: 1, url: U("k5wwwwwwww1_w.pdf") }] },
  { id: "d-k5h", mod: "audit", grp: "plan", ser: "k5h", title: "h", date: "2026-10-01", files: [{ name: "h.pdf", size: 1, url: U("k5hhhhhhhh1_h.pdf") }] }]);
await mk([setRow("k5/w.pdf", "d-k5", U("k5wwwwwwww1_w.pdf"), "f1"), setRow("k5/h.pdf", "d-k5h", U("k5hhhhhhhh1_h.pdf"), "f2")]);
const R5 = await rowOf("k5/w.pdf"), R5H = await rowOf("k5/h.pdf");
const p5 = (await b3("k5/w.pdf", { mode: "version", row: R5, sha256: H64("51"), size: 5 })).path;
eq((await verify(p5, H64("51"), 5)).ok, true, "#5 확인");
await frontDocs([{ id: "d-k5v", mod: "audit", grp: "plan", ser: "k5", title: "w", date: "2026-10-09", files: [{ name: "w.pdf", size: 1, url: U("k5wwwwwwww2_w.pdf") }] }]);
const s5 = await one("select count(*)::int from public.test_hist where key = 'docs'");
r = await apply([p5], { run: RUN });
eq([r.ok, r.docs], [true, {}], "#5 H 가 그 사이 새 판을 만듦 → 등록하지 않음");
eq([(await curOf("k5")).id, (await fileRow(R5)).h_url, (await fileRow(R5)).k_sha256], ["d-k5v", U("k5wwwwwwww1_w.pdf"), H64("f1")], "#5 H 새 판이 현재 판 · 기준선 그대로(다음 실행 = 양쪽 다 바뀜)");
eq(await one("select count(*)::int from public.test_hist where key = 'docs'"), s5, "#5 넣은 것이 없으면 문서함 저장 안 함");
eq(await one("select count(*)::int from semis_logi_private.ksync_uploads where path = $1 and verified", [p5]), 1, "#5 올린 것은 등록 대기로 남았다가 버려짐");
const p5c = (await b3("k5/w.pdf", { mode: "version", row: R5, state: "conflict", sha256: H64("52"), size: 5 })).path;
r = await c3(p5c, H64("52"), 5);
eq([!!r.doc, (await curOf("k5")).id], [true, r.doc], "#5 충돌(K 가 이김)은 처음부터 H 도 바뀐 것 — 그대로 등록");
const p5h = (await b3("k5/h.pdf", { mode: "version", row: R5H, sha256: H64("53"), size: 5 })).path;
eq((await verify(p5h, H64("53"), 5)).ok, true, "#5 확인(숨긴 판 묶음)");
await frontDocs([{ id: "d-k5h2", mod: "audit", grp: "plan", ser: "k5h", title: "h", date: "2026-10-09", ssi: true, files: [{ name: "h.pdf", size: 1, url: PUB + "docs-ssi/k5hhhhhhhh2_h.pdf" }] }]);
r = await apply([p5h], { run: RUN });
ok(!!r.docs[p5h] && (await curOf("k5h")).id === r.docs[p5h], "#5 이 연결이 볼 수 없는 민감보안정보 판은 계획도 몰랐음 — 대 보지 않고 새 판(숨긴 판 묶음 규칙)");
// K 가 이긴 충돌 — 계획이 본 H 판(h_url)이 등록 때 지금 판에 없으면(그 사이 H 가 또 새 판) 등록하지 않음. 덮으면 그 H 판은 K 사본도 충돌 표시도 없이 이전 판으로 밀림
const p5k = (await b3("k5/w.pdf", { mode: "version", row: R5, state: "conflict", h_url: (await curOf("k5")).files[0].url, sha256: H64("54"), size: 5 })).path;
eq((await verify(p5k, H64("54"), 5)).ok, true, "#5 확인(K 가 이긴 충돌)");
await frontDocs([{ id: "d-k5v3", mod: "audit", grp: "plan", ser: "k5", title: "w", date: "2026-11-05", files: [{ name: "w.pdf", size: 1, url: U("k5wwwwwwww3_w.pdf") }] }]);
r = await apply([p5k], { run: RUN });
eq([r.docs, (await curOf("k5")).id], [{}, "d-k5v3"], "#5 K 가 이긴 충돌 · 등록 전에 H 가 또 새 판 → 등록하지 않음(H 새 판이 현재 판 그대로)");
r = await c3((await b3("k5/w.pdf", { mode: "version", row: R5, state: "conflict", h_url: U("k5wwwwwwww3_w.pdf"), sha256: H64("55"), size: 5 })).path, H64("55"), 5);
eq([!!r.doc, (await curOf("k5")).id], [true, r.doc], "#5 K 가 이긴 충돌 · 계획이 본 H 판이 그대로 → 등록");

// #10 — 이전 판(old)은 현재 판 날짜가 비어 있어도 현재 판이 되지 않음
await addDocs([{ id: "d-k10", mod: "audit", grp: "plan", ser: "k10", title: "e", date: "", files: [{ name: "e.pdf", size: 1, url: U("k10eeeeeeee1_e.pdf") }] }]);
await mk([setRow("k10/e.pdf", "d-k10", U("k10eeeeeeee1_e.pdf"), "a0")]);
const R10 = await rowOf("k10/e.pdf");
r = await c3((await b3("k10/e (충돌 2026-11-06).pdf", { mode: "old", row: R10, sha256: H64("a1"), size: 3, mtime: "2026-11-05T00:00:00Z" })).path, H64("a1"), 3);
eq([(await curOf("k10")).id, (await docs()).find(d => d.id === r.doc).date], ["d-k10", ""], "#10 이전 판 날짜는 현재 판 값 그대로('') — 현재 판 그대로");

// #3 — 내려받기도 같은 목록으로 거절
await addDocs([{ id: "d-k3", mod: "audit", grp: "plan", ser: "k3", title: "x", date: "2026-10-01", files: [{ name: "폴더 아이콘.scf", size: 1, url: U("k3xxxxxxxxx1_x.scf") }] }]);
eq((await call("get", { run: RUN, map: M3, doc: "d-k3", url: U("k3xxxxxxxxx1_x.scf") })).error, "type", "#3 .scf 내려받기 거절");

// #4 지난 실행이 못 보낸 기준선 표시를 다시 보냄 — 그 사이 H 에서 지운 문서 · 뺀 첨부는 받지 않기만(보안 기록 아님 — 관리자 배지를 켜지 않음).
//    다른 화면의 문서 · 민감보안정보 주소는 그대로 기록
const nScope = () => one("select count(*)::int from semis_logi_private.ksync_events where kind = 'scope'");
const sc4 = await nScope();
r = await mk([setRow("k4/gone.pdf", "d-k4-gone", U("k4gggggggggg_g.pdf"), "41"), setRow("k4/x.pdf", "d-k3", U("k4xxxxxxxxxx_x.pdf"), "42")]);
eq([r.n, r.bad, await nScope() - sc4], [0, 2, 0], "#4 지운 문서 · 그 문서에 없는 첨부 → 받지 않음 · 보안 기록 없음");
r = await mk([setRow("k4/o.pdf", "d-other", PUB + "docs/bbbbbbbbbbbb_o.pdf", "43"), setRow("k4/s.pdf", "d-k3", PUB + "docs-ssi/k4ssssssssss_s.pdf", "44")]);
eq([r.n, r.bad, await nScope() - sc4], [0, 2, 2], "#4 다른 화면의 문서 · 민감보안정보 주소 → 받지 않음 · 기록");

// #0 첨부 둘 중 하나(e1)를 양쪽에서 지움 — H 는 그 첨부를 뺀 판만 만들었고(남은 첨부는 다른 기준선 줄이 맞춤) 새 판이 아니므로 확정하면 지운다(충돌로 돌리지 않음)
await addDocs([{ id: "d-k0e", mod: "audit", grp: "plan", ser: "k0-e", title: "e", date: "2026-10-01",
  files: [{ name: "e1.pdf", size: 1, url: U("k0eeeeeeee1_e1.pdf") }, { name: "e2.pdf", size: 1, url: U("k0eeeeeeee2_e2.pdf") }] }]);
await mk([setRow("k0e/e1.pdf", "d-k0e", U("k0eeeeeeee1_e1.pdf"), "e5"), setRow("k0e/e2.pdf", "d-k0e", U("k0eeeeeeee2_e2.pdf"), "e6")]);
const K0E1 = await rowOf("k0e/e1.pdf"), K0E2 = await rowOf("k0e/e2.pdf");
eq((await mk([{ op: "state", id: K0E1, state: "del_k" }])).n, 1, "#0 e1 K 에서 지움 → 삭제 대기");
await frontDocs([{ id: "d-k0e2", mod: "audit", grp: "plan", ser: "k0-e", title: "e", date: "2026-10-09", files: [{ name: "e2.pdf", size: 1, url: U("k0eeeeeeee2_e2.pdf") }] }]);
await as("a1", "admin");
r = await rpc("semis_logi_ksync_resolve", { ids: [K0E1], act: "confirm" });
eq([r.ok, r.n, r.kept, await fileRow(K0E1)], [true, 1, 0, undefined], "#0 양쪽에서 뺀 첨부 → 확정(지움) · 'H 에 새 판'이라고 하지 않음");
eq([await serDocs("k0-e"), (await fileRow(K0E2)).h_url], [[["d-k0e2", ["e2.pdf"]], ["d-k0e", ["e2.pdf"]]], U("k0eeeeeeee2_e2.pdf")], "#0 남은 첨부(e2) · 그 줄은 그대로");
await as(null);

// G1 — K 에서 지운 뒤 H 사용자가 그 판만 다른 판 묶음으로 옮김(옛 판은 옛 묶음에 남음). 확정은 계획처럼 주소로 따라가 옮긴 판 묶음을 본다:
//      H 가 새 판을 만들지 않았으므로 지우고(kept 0) 옛 묶음의 옛 판은 그대로. 옮긴 묶음에 그 뒤 H 새 판이 있으면 그대로 'H 에 새 판'
const moveSer = (id, ser) => db.query("update public.semis_logi_store set value = (select jsonb_agg(case when d ->> 'id' = $1 then jsonb_set(d, '{ser}', to_jsonb($2::text)) else d end order by i) from jsonb_array_elements(value) with ordinality x(d, i)) where key = 'docs'", [id, ser]);
await addDocs([
  { id: "d-g1-old", mod: "audit", grp: "plan", ser: "g1", title: "g", date: "2026-09-01", files: [{ name: "g.pdf", size: 1, url: U("g1gggggggg0_g.pdf") }] },
  { id: "d-g1", mod: "audit", grp: "plan", ser: "g1", title: "g", date: "2026-10-01", files: [{ name: "g.pdf", size: 1, url: U("g1gggggggg1_g.pdf") }] },
  { id: "d-g1h-old", mod: "audit", grp: "plan", ser: "g1h", title: "h", date: "2026-09-01", files: [{ name: "h.pdf", size: 1, url: U("g1hhhhhhhh0_h.pdf") }] },
  { id: "d-g1h", mod: "audit", grp: "plan", ser: "g1h", title: "h", date: "2026-10-01", files: [{ name: "h.pdf", size: 1, url: U("g1hhhhhhhh1_h.pdf") }] }]);
await mk([setRow("g1/g.pdf", "d-g1", U("g1gggggggg1_g.pdf"), "a7"), setRow("g1/h.pdf", "d-g1h", U("g1hhhhhhhh1_h.pdf"), "a8")]);
const G1G = await rowOf("g1/g.pdf"), G1H = await rowOf("g1/h.pdf");
eq((await mk([{ op: "state", id: G1G, state: "del_k" }, { op: "state", id: G1H, state: "del_k" }])).n, 2, "G1 K 에서 지움 → 삭제 대기 2");
await moveSer("d-g1", "g1-옮김");
await moveSer("d-g1h", "g1h-옮김");
await frontDocs([{ id: "d-g1h-new", mod: "audit", grp: "plan", ser: "g1h-옮김", title: "h", date: "2026-10-09", files: [{ name: "h.pdf", size: 1, url: U("g1hhhhhhhh2_h.pdf") }] }]);
await as("a1", "admin");
r = await rpc("semis_logi_ksync_resolve", { ids: [G1G], act: "confirm" });
eq([r.ok, r.n, r.kept], [true, 1, 0], "G1 옮기기만 한 판 → 확정(지움) · 'H 에 새 판'이라고 하지 않음");
eq([await fileRow(G1G), await serDocs("g1-옮김"), await serDocs("g1")], [undefined, [], [["d-g1-old", ["g.pdf"]]]],
  "G1 기준선 줄 · 옮긴 판(이 파일) 지움 · 옛 묶음의 옛 판은 남음");
r = await rpc("semis_logi_ksync_resolve", { ids: [G1H], act: "confirm" });
eq([r.ok, r.n, r.kept], [true, 0, 1], "G1 옮긴 묶음에 그 뒤 H 새 판 → 지우지 않음");
eq([await one("select state || '|' || note from semis_logi_private.ksync_files where id = $1", [G1H]), await serDocs("g1h-옮김"), await serDocs("g1h")],
  ["conflict|H 에 새 판", [["d-g1h-new", ["h.pdf"]], ["d-g1h", ["h.pdf"]]], [["d-g1h-old", ["h.pdf"]]]], "G1 옮긴 뒤 H 새 판 → 'H 에 새 판' · 모두 남음");
await as(null);
// G1 — 주소로 따라간 판 묶음의 다른 판은 그 묶음 자신의 판: 기준선 주소의 첨부만 빼고 이름 · 하나뿐인 첨부 규칙은 쓰지 않는다.
//      (가) 그 묶음의 다른 기준선 줄이 맞추는 판 (나) 이 연결(SSI 아님)이 볼 수 없는 민감보안정보 판(다른 이름 · 맞추는 줄 없음)
//      (다) 맞추는 줄 없는 같은 이름의 옛 판 · 처음부터 첨부가 없던 판 — 모두 남음. 지우면 (가)의 줄은 다음 실행에서 'H 에서 지움'이 되고 확정하면 K 파일까지 휴지통으로
await addDocs([
  { id: "d-pa-old", mod: "audit", grp: "plan", ser: "g1pa", title: "r", date: "2026-09-01", files: [{ name: "r.pdf", size: 1, url: U("g1paaaaaaa0_r.pdf") }] },
  { id: "d-pa", mod: "audit", grp: "plan", ser: "g1pa", title: "r", date: "2026-10-01", files: [{ name: "r.pdf", size: 1, url: U("g1paaaaaaa1_r.pdf") }] },
  { id: "d-pb", mod: "audit", grp: "plan", ser: "g1pb", title: "r", date: "2026-09-15", files: [{ name: "r.pdf", size: 1, url: U("g1pbbbbbbb1_r.pdf") }] },
  { id: "d-qa", mod: "audit", grp: "plan", ser: "g1qa", title: "q", date: "2026-10-01", files: [{ name: "q.pdf", size: 1, url: U("g1qaaaaaaa1_q.pdf") }] },
  { id: "d-qc", mod: "audit", grp: "plan", ser: "g1qc", title: "s", date: "2026-09-15", ssi: true, files: [{ name: "secret.pdf", size: 1, url: PUB + "docs-ssi/g1qccccccc1_secret.pdf" }] },
  { id: "d-ra", mod: "audit", grp: "plan", ser: "g1ra", title: "t", date: "2026-10-01", files: [{ name: "t.pdf", size: 1, url: U("g1raaaaaaa1_t.pdf") }] },
  { id: "d-rc-old", mod: "audit", grp: "plan", ser: "g1rc", title: "t", date: "2026-09-10", files: [{ name: "t.pdf", size: 1, url: U("g1rccccccc0_t.pdf") }] },
  { id: "d-rc-memo", mod: "audit", grp: "plan", ser: "g1rc", title: "메모", date: "2026-09-12", files: [] },
  { id: "d-rc", mod: "audit", grp: "plan", ser: "g1rc", title: "u", date: "2026-09-15", files: [{ name: "u.pdf", size: 1, url: U("g1rccccccc1_u.pdf") }] }]);
await mk([setRow("g1a/r.pdf", "d-pa", U("g1paaaaaaa1_r.pdf"), "a9"), setRow("g1b/r.pdf", "d-pb", U("g1pbbbbbbb1_r.pdf"), "aa"), setRow("g1q/q.pdf", "d-qa", U("g1qaaaaaaa1_q.pdf"), "ab"),
  setRow("g1r/t.pdf", "d-ra", U("g1raaaaaaa1_t.pdf"), "ac"), setRow("g1r/u.pdf", "d-rc", U("g1rccccccc1_u.pdf"), "ad")]);
const PRA = await rowOf("g1a/r.pdf"), PRB = await rowOf("g1b/r.pdf"), PQA = await rowOf("g1q/q.pdf"), PRT = await rowOf("g1r/t.pdf"), PRU = await rowOf("g1r/u.pdf");
eq((await mk([PRA, PQA, PRT].map(id => ({ op: "state", id, state: "del_k" })))).n, 3, "G1 K 에서 지움 → 삭제 대기 3");
await moveSer("d-pa", "g1pb");
await moveSer("d-qa", "g1qc");
await moveSer("d-ra", "g1rc");
await as("a1", "admin");
r = await rpc("semis_logi_ksync_resolve", { ids: [PRA, PQA, PRT], act: "confirm" });
eq([r.ok, r.n, r.kept, await fileRow(PRA), await fileRow(PQA), await fileRow(PRT)], [true, 3, 0, undefined, undefined, undefined], "G1 옮겨 넣은 판 셋 → 확정(지움)");
eq([await serDocs("g1pb"), await serDocs("g1pa"), (await fileRow(PRB)).state], [[["d-pb", ["r.pdf"]]], [["d-pa-old", ["r.pdf"]]], "ok"],
  "G1 (가) 옮겨 넣은 판만 지움 · 그 묶음의 다른 기준선 줄이 맞추는 같은 이름 판은 남음 · 옛 묶음 그대로");
eq(await serDocs("g1qc"), [["d-qc", ["secret.pdf"]]], "G1 (나) 그 묶음에 기준선 줄이 없어도 볼 수 없는 민감보안정보 판은 남음");
eq([await serDocs("g1rc"), (await fileRow(PRU)).state], [[["d-rc-old", ["t.pdf"]], ["d-rc-memo", []], ["d-rc", ["u.pdf"]]], "ok"],
  "G1 (다) 맞추는 줄 없는 같은 이름 옛 판 · 처음부터 첨부가 없던 판도 남음");
await as(null);
// G1 (라) 옮겨 간 묶음에서 그 판이 지금 판이 아니면(더 늦은 판이 있고 그 판은 다른 기준선 줄이 맞춤) 그 묶음으로 따라가지 않는다 —
//      계획은 판 묶음마다 지금 판만 보므로 옮긴 판을 볼 수 없다. 옛 묶음은 비었으니 H 는 그대로 두고 삭제 대기 줄만 닫는다
await addDocs([
  { id: "d-mv", mod: "audit", grp: "plan", ser: "g1mv", title: "m", date: "2026-09-20", files: [{ name: "m.pdf", size: 1, url: U("g1mvvvvvvv1_m.pdf") }] },
  { id: "d-mt", mod: "audit", grp: "plan", ser: "g1mt", title: "n", date: "2026-10-05", files: [{ name: "n.pdf", size: 1, url: U("g1mttttttt1_n.pdf") }] }]);
await mk([setRow("g1m/m.pdf", "d-mv", U("g1mvvvvvvv1_m.pdf"), "9a"), setRow("g1m/n.pdf", "d-mt", U("g1mttttttt1_n.pdf"), "9b")]);
const PMV = await rowOf("g1m/m.pdf"), PMT = await rowOf("g1m/n.pdf");
eq((await mk([{ op: "state", id: PMV, state: "del_k" }])).n, 1, "G1 (라) K 에서 지움 → 삭제 대기");
await moveSer("d-mv", "g1mt");
await as("a1", "admin");
r = await rpc("semis_logi_ksync_resolve", { ids: [PMV], act: "confirm" });
eq([r.ok, r.n, r.kept, await fileRow(PMV)], [true, 1, 0, undefined], "G1 (라) 옮겨 간 묶음의 지금 판이 아닌 판 → 확정 · 삭제 대기 줄만 닫음");
eq([await serDocs("g1mt"), (await docs()).find(d => d.id === "d-mv")?.files.map(f => f.url), (await fileRow(PMT)).state],
  [[["d-mv", ["m.pdf"]], ["d-mt", ["n.pdf"]]], [U("g1mvvvvvvv1_m.pdf")], "ok"],
  "G1 (라) 옮긴 판(첨부 그대로)과 그 묶음의 지금 판은 H 에 남음 · 지금 판의 기준선 줄도 그대로");
await as(null);
// 같은 판 묶음 안에서도 다른 기준선 줄이 맞추는 파일(같은 이름 첨부 둘 — K 에는 'r.pdf' · 'r (2).pdf')은 이름이 같아도 남김
await addDocs([{ id: "d-sn", mod: "audit", grp: "plan", ser: "g1sn", title: "sn", date: "2026-10-01",
  files: [{ name: "r.pdf", size: 1, url: U("g1snnnnnnn1_r.pdf") }, { name: "r.pdf", size: 1, url: U("g1snnnnnnn2_r.pdf") }] }]);
await mk([setRow("g1sn/r.pdf", "d-sn", U("g1snnnnnnn1_r.pdf"), "ae"), setRow("g1sn/r (2).pdf", "d-sn", U("g1snnnnnnn2_r.pdf"), "af")]);
const SN1 = await rowOf("g1sn/r.pdf"), SN2 = await rowOf("g1sn/r (2).pdf");
await mk([{ op: "state", id: SN1, state: "del_k" }]);
await as("a1", "admin");
r = await rpc("semis_logi_ksync_resolve", { ids: [SN1], act: "confirm" });
eq([r.ok, r.n, r.kept, (await docs()).find(d => d.id === "d-sn")?.files.map(f => f.url), (await fileRow(SN2)).state], [true, 1, 0, [U("g1snnnnnnn2_r.pdf")], "ok"],
  "G1 같은 이름 첨부 중 지운 것만 뺌 · 다른 줄이 맞추는 첨부는 남음");
await as(null);
// SSI 아닌 연결 — 볼 수 없는 민감보안정보 판(문서 표시 · docs-ssi 주소)은 하나뿐인 첨부 규칙으로도 지우지 않음. 볼 수 있는 옛 판은 그대로 지움
await addDocs([
  { id: "d-ss-f", mod: "audit", grp: "plan", ser: "g1ss", title: "f", date: "2026-09-02", ssi: true, files: [{ name: "f.pdf", size: 1, url: U("g1ssssssss0_f.pdf") }] },
  { id: "d-ss-x", mod: "audit", grp: "plan", ser: "g1ss", title: "x", date: "2026-09-03", files: [{ name: "x.pdf", size: 1, url: PUB + "docs-ssi/g1ssssssss1_x.pdf" }] },
  { id: "d-ss-n", mod: "audit", grp: "plan", ser: "g1ss", title: "n", date: "2026-09-04", files: [{ name: "n.pdf", size: 1, url: U("g1ssssssss2_n.pdf") }] },
  { id: "d-ss", mod: "audit", grp: "plan", ser: "g1ss", title: "s", date: "2026-10-01", files: [{ name: "s.pdf", size: 1, url: U("g1ssssssss3_s.pdf") }] }]);
await mk([setRow("g1s/s.pdf", "d-ss", U("g1ssssssss3_s.pdf"), "a6")]);
const RSS = await rowOf("g1s/s.pdf");
await mk([{ op: "state", id: RSS, state: "del_k" }]);
await as("a1", "admin");
r = await rpc("semis_logi_ksync_resolve", { ids: [RSS], act: "confirm" });
eq([r.ok, r.n, r.kept, await serDocs("g1ss")], [true, 1, 0, [["d-ss-f", ["f.pdf"]], ["d-ss-x", ["x.pdf"]]]],
  "G1 민감보안정보 표시 판 · docs-ssi 파일 판은 남음 · 볼 수 있는 옛 판(이름 다름)과 기준선 판은 지움");
await as(null);

// G2 — 덮어쓰기로 세는 내려받기는 회차 시작 때 맞춘 판 묶음만(계획의 기준선과 같음). 첨부가 여럿인 새 H 문서는 앞 첨부를 받아 기준선 줄이 생겨도
//      뒤 첨부를 세지 않고, 복원 줄만 있던 판 묶음도 복원해 받은 뒤 다른 첨부를 세지 않는다 — 세면 계획은 0 인데 서버만 보류한다
await addDocs([
  { id: "d-g2", mod: "audit", grp: "plan", ser: "g2", title: "g2", date: "2026-10-01", files: ["a", "b", "c"].map(n => ({ name: n + ".pdf", size: 1, url: U("g2" + n.repeat(9) + "_" + n + ".pdf") })) },
  { id: "d-g2r", mod: "audit", grp: "plan", ser: "g2r", title: "g2r", date: "2026-10-01", files: ["p", "q"].map(n => ({ name: n + ".pdf", size: 1, url: U("g2r" + n.repeat(8) + "_" + n + ".pdf") })) },
  { id: "d-g2s", mod: "audit", grp: "plan", ser: "g2s", title: "g2s", date: "2026-10-01", files: [{ name: "s.pdf", size: 1, url: U("g2ssssssss1_s.pdf") }] }]);
await mk([setRow("g2r/p.pdf", "d-g2r", U("g2rpppppppp_p.pdf"), "b1"), setRow("g2r/q.pdf", "d-g2r", U("g2rqqqqqqqq_q.pdf"), "b2"), setRow("g2s/s.pdf", "d-g2s", U("g2ssssssss1_s.pdf"), "b3")]);
const G2P = await rowOf("g2r/p.pdf"), G2Q = await rowOf("g2r/q.pdf");
await db.query("update semis_logi_private.ksync_files set state = 'restore' where id in ($1, $2)", [G2P, G2Q]);
await frontDocs([{ id: "d-g2s2", mod: "audit", grp: "plan", ser: "g2s", title: "g2s", date: "2026-10-09", files: [{ name: "s.pdf", size: 1, url: U("g2ssssssss2_s.pdf") }] }]);
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
const g2get = async (doc, url) => (await call("get", { run: RUN, map: M3, doc, url: U(url) })).ok;
const g2cnt = async () => (await cntOf(RUN)) || 0;
eq(await g2get("d-g2", "g2aaaaaaaaa_a.pdf"), true, "G2 새 문서 첫 첨부 받음");
await mk([setRow("g2/a.pdf", "d-g2", U("g2aaaaaaaaa_a.pdf"), "b4")]);
eq([await g2get("d-g2", "g2bbbbbbbbb_b.pdf"), await g2get("d-g2", "g2ccccccccc_c.pdf"), await g2cnt()], [true, true, 0],
  "G2 새 문서의 둘째 · 셋째 첨부 — 첫 첨부의 기준선 줄은 이 회차에 생긴 것이라 덮어쓰기로 세지 않음(계획도 0)");
eq(await g2get("d-g2r", "g2rpppppppp_p.pdf"), true, "G2 복원 줄 받음");
await mk([Object.assign(setRow("g2r/p.pdf", "d-g2r", U("g2rpppppppp_p.pdf"), "b1"), { id: G2P })]);
eq([await g2get("d-g2r", "g2rqqqqqqqq_q.pdf"), await g2cnt()], [true, 0], "G2 복원 줄만 있던 판 묶음 — 복원해 받은 뒤 다른 첨부도 세지 않음(계획도 0)");
eq([await g2get("d-g2s2", "g2ssssssss2_s.pdf"), await g2cnt()], [true, 1], "G2 회차 시작 때 맞춘 판 묶음의 H 새 판 → 덮어쓰기로 셈");
// '새 문서'로 보낸 줄의 판 묶음 지금 판에 주소가 맞는 파일이 없으면(첨부 없는 새 판 · 저장소 밖 주소) H 목록에 없어 계획에는 H 에서 지운 것 —
// 새 판(맨 앞 — 지금 판)으로 등록하되 계획처럼 세지 않는다
await addDocs([
  { id: "d-g2e", mod: "audit", grp: "plan", ser: "g2e", title: "g2e", date: "2026-10-01", files: [{ name: "e.pdf", size: 1, url: U("g2eeeeeeee1_e.pdf") }] },
  { id: "d-g2x", mod: "audit", grp: "plan", ser: "g2x", title: "g2x", date: "2026-10-01", files: [{ name: "x.pdf", size: 1, url: U("g2xxxxxxxx1_x.pdf") }] }]);
await mk([setRow("g2e/e.pdf", "d-g2e", U("g2eeeeeeee1_e.pdf"), "b5"), setRow("g2x/x.pdf", "d-g2x", U("g2xxxxxxxx1_x.pdf"), "b6")]);
const G2E = await rowOf("g2e/e.pdf"), G2X = await rowOf("g2x/x.pdf");
await frontDocs([{ id: "d-g2e2", mod: "audit", grp: "plan", ser: "g2e", title: "g2e", date: "2026-10-09", files: [] },
  { id: "d-g2x2", mod: "audit", grp: "plan", ser: "g2x", title: "g2x", date: "2026-10-09", files: [{ name: "x.pdf", size: 1, url: "https://other.example/x.pdf" }] }]);
const pE = await b3("g2e/e.pdf", { mode: "new", row: G2E, sha256: H64("b7"), size: 7, mtime: "2026-11-05T00:00:00Z" });
const pX = await b3("g2x/x.pdf", { mode: "new", row: G2X, sha256: H64("b8"), size: 8, mtime: "2026-11-05T00:00:00Z" });
eq([pE.ok, pX.ok, await one("select string_agg(mode, ',' order by rel_path) from semis_logi_private.ksync_uploads where path in ($1, $2)", [pE.path, pX.path]), await g2cnt()],
  [true, true, "version,version", 1], "G2 지금 판에 주소가 맞는 파일이 없는 판 묶음 → 새 판으로 올리되 세지 않음(계획도 0)");
r = await c3(pE.path, H64("b7"), 7);
const r2x = await c3(pX.path, H64("b8"), 8);
eq([(await curOf("g2e")).id, (await curOf("g2x")).id, (await curOf("g2x")).files.map(f => f.url)], [r.doc, r2x.doc, [PUB + pX.path]], "G2 새 판이 지금 판(맨 앞) · 저장소 밖 주소 자리에");
// 회차 안에서 기준선을 다시 받으면(지난 실행이 못 보낸 표시를 먼저 보냄 → hello full) 덮어쓰기로 셀 판 묶음도 그 기준선으로 다시 잡는다 —
// 다시 이은 줄(판 묶음 바뀜)의 옛 판 묶음은 계획에는 기준선 줄이 없는 H 문서라 계획은 세지 않는다. 하나라도 센 뒤에는 다시 잡지 않음
await addDocs([
  { id: "d-g2m-old", mod: "audit", grp: "plan", ser: "g2m", title: "m", date: "2026-09-01", files: [{ name: "m0.pdf", size: 1, url: U("g2mmmmmmmm0_m0.pdf") }] },
  { id: "d-g2m", mod: "audit", grp: "plan", ser: "g2m", title: "m", date: "2026-10-01", files: [{ name: "m.pdf", size: 1, url: U("g2mmmmmmmm1_m.pdf") }] }]);
await mk([setRow("g2m/m.pdf", "d-g2m", U("g2mmmmmmmm1_m.pdf"), "b9")]);
const G2M = await rowOf("g2m/m.pdf");
await moveSer("d-g2m", "g2m-옮김");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
const snapOf = () => one("select string_agg(ser, ',' order by ser) from semis_logi_private.ksync_run_sers where run_id = $1 and map_id = $2 and ser like 'g2m%'", [RUN, M3]);
await mk([Object.assign(setRow("g2m/m.pdf", "d-g2m", U("g2mmmmmmmm1_m.pdf"), "b9"), { id: G2M })]);
eq([(await fileRow(G2M)).ser, await snapOf()], ["g2m-옮김", "g2m"], "G2 다시 보낸 표시가 줄을 옮긴 판 묶음으로 이음 · 회차 시작 때 것은 옛 판 묶음");
eq((await call("hello", { full: true, run: RUN })).ok, true, "G2 회차를 함께 보낸 hello full");
eq(await snapOf(), "g2m-옮김", "G2 덮어쓰기로 셀 판 묶음을 지금 기준선으로 다시 잡음");
eq([await g2get("d-g2m-old", "g2mmmmmmmm0_m0.pdf"), await g2cnt()], [true, 0], "G2 옛 판 묶음에 남은 판 받기 → 세지 않음(계획도 0)");
eq([await g2get("d-g2m", "g2mmmmmmmm1_m.pdf"), await g2cnt()], [true, 1], "G2 옮긴 판 묶음 받기 → 덮어쓰기로 셈");
// put_begin — 에이전트가 '새 판'으로 보낸 것은 지금 판의 첨부와 관계없이 센다(계획이 모든 새 판을 셈). '새 문서'로 온 줄은 지금 판에
// 이름 · 저장소 주소를 갖춘 첨부가 없으면 세지 않는다 — 이름 없는 첨부는 H 목록(ksync_h_items)에 없어 계획에는 H 에서 지운 것과 같다
await addDocs([
  { id: "d-g2v", mod: "audit", grp: "plan", ser: "g2v", title: "v", date: "2026-10-01", files: [{ name: "v.pdf", size: 1, url: U("g2vvvvvvvv1_v.pdf") }] },
  { id: "d-g2u", mod: "audit", grp: "plan", ser: "g2u", title: "u", date: "2026-10-01", files: [{ name: "u.pdf", size: 1, url: U("g2uuuuuuuu1_u.pdf") }] }]);
await mk([setRow("g2v/v.pdf", "d-g2v", U("g2vvvvvvvv1_v.pdf"), "ba"), setRow("g2u/u.pdf", "d-g2u", U("g2uuuuuuuu1_u.pdf"), "bb")]);
const G2V = await rowOf("g2v/v.pdf"), G2U = await rowOf("g2u/u.pdf");
await frontDocs([{ id: "d-g2v2", mod: "audit", grp: "plan", ser: "g2v", title: "v", date: "2026-10-09", files: [] },
  { id: "d-g2u2", mod: "audit", grp: "plan", ser: "g2u", title: "u", date: "2026-10-09", files: [{ name: "", size: 1, url: U("g2uuuuuuuu2_u.pdf") }] }]);
let cG2 = await g2cnt();
const pV = await b3("g2v/v.pdf", { mode: "version", row: G2V, sha256: H64("bc"), size: 3 });
eq([pV.ok, await g2cnt() - cG2], [true, 1], "G2 '새 판'으로 보낸 것 → 지금 판에 첨부가 없어도 셈(계획과 같음)");
cG2 = await g2cnt();
const pU = await b3("g2u/u.pdf", { mode: "new", row: G2U, sha256: H64("bd"), size: 3 });
eq([pU.ok, await g2cnt() - cG2, await one("select mode from semis_logi_private.ksync_uploads where path = $1", [pU.path])], [true, 0, "version"],
  "G2 '새 문서'로 온 줄 · 지금 판에 이름 없는 첨부만 → 세지 않음 · 새 판으로 올림");
// 센 뒤에는 기준선이 바뀌어도(줄을 지움) hello full 이 다시 잡지 않는다
await mk([{ op: "drop", id: G2M }]);
cG2 = await g2cnt();
await call("hello", { full: true, run: RUN });
eq([await snapOf(), await g2get("d-g2m", "g2mmmmmmmm1_m.pdf"), await g2cnt() - cG2], ["g2m-옮김", true, 1], "G2 하나라도 센 뒤에는 hello full 이 다시 잡지 않음");

// #16 — 승인한 보류는 그때 센 건수 + 한도(files)까지만 한 회차에 허용 · 넘으면 새 보류(에이전트 계획과 같은 규칙)
await end3([{ id: M3, done: true }]);
await as("a1", "admin");
await rpc("semis_logi_ksync_settings", { mass_limit: { files: 2, ratio: 0.3 } });
await as(null);
const evMH = () => one("select count(*)::int from semis_logi_private.ksync_events where kind = 'mass_hold'");
const setHold = (h) => db.query("update semis_logi_private.ksync_maps set hold = $2::jsonb where id = $1", [M3, JSON.stringify(h)]);
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await setHold({ run: 1, n: 1, ok: true });
let nMH = await evMH();
for (let i = 1; i <= 3; i++) eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("c" + i), size: 1 })).ok, true, "#16 승인 건수 1 + 한도 2 까지 " + i);
eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("c4"), size: 1 })).error, "held", "#16 넘으면 보류");
let h16 = await holdOf();
eq([h16.ok, h16.run, h16.n, h16.srv, await evMH()], [undefined, RUN, 4, true, nMH + 1], "#16 승인을 버리고 이 회차의 새 보류(승인 전) · mass_hold 기록");
eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("c5"), size: 1 })).error, "held", "#16 새 보류는 승인 전까지 막음");
await end3([{ id: M3, held: true, n: 4, base: 3 }], "held");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await setHold({ run: 1, n: 5, ok: true });
nMH = await evMH();
await end3([{ id: M3, held: true, n: 7, base: 3 }], "held");
eq([(await holdOf()).ok, await evMH()], [true, nMH], "#16 승인 건수 + 한도 안의 보류 보고 = 승인 전 보류를 보고 멈춘 실행(그 사이 승인) — 승인 그대로");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await end3([{ id: M3, held: true, n: 8, base: 3 }], "held");
h16 = await holdOf();
eq([h16.ok, h16.run, h16.n, await evMH()], [undefined, RUN, 8, nMH + 1], "#16 에이전트가 승인 건수 + 한도보다 많이 세어 보류 → 승인을 버리고 새 보류");
// 넘는 몫은 비율 한도도 본다 — 건수(files)만 보면 작은 연결은 승인이 남아 있는 동안 폴더를 통째로 지우거나 덮어도 지나간다
const ml16 = await one("select mass_limit from semis_logi_private.ksync_state");
await db.query("update semis_logi_private.ksync_state set mass_limit = '{\"files\": 200, \"ratio\": 0.01, \"min\": 2}'::jsonb");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await setHold({ run: 1, n: 1, ok: true });
for (let i = 1; i <= 2; i++) eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("d" + i), size: 1 })).ok, true, "#16 승인 건수 1 + 넘는 몫이 최소 건수(2) 미만 " + i);
eq((await b3("multi/b-수정.pdf", { mode: "version", row: RB, sha256: H64("d3"), size: 1 })).error, "held", "#16 넘는 몫(2)이 비율 한도를 넘음 → 보류(건수 한도 200 안이어도)");
await end3([{ id: M3, held: true, n: 3, base: 3 }], "held");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await setHold({ run: 1, n: 5, ok: true });
await end3([{ id: M3, held: true, n: 6, base: 3 }], "held");
eq((await holdOf()).ok, true, "#16 보류 보고의 넘는 몫(1)이 한도 안 → 승인 그대로");
RUN = (await call("run", { phase: "start", trigger: "manual" })).run;
await end3([{ id: M3, held: true, n: 7, base: 3 }], "held");
h16 = await holdOf();
eq([h16.ok, h16.n], [undefined, 7], "#16 보류 보고의 넘는 몫(2)이 비율 한도를 넘음 → 승인을 버리고 새 보류(서버와 같은 규칙)");
await db.query("update semis_logi_private.ksync_maps set hold = null where id = $1", [M3]);
await db.query("update semis_logi_private.ksync_state set mass_limit = $1::jsonb", [JSON.stringify(ml16)]);
await as("a1", "admin");
await rpc("semis_logi_ksync_settings", { mass_limit: { files: 200, ratio: 0.3 } });

// S1 — 키 실패 기록 상한이 차도 IP 차단 셈은 그대로: 46 IP × 11번 + 기록 상한을 채운 뒤에도 새 IP 11번이면 차단
await as(null);
for (let i = 0; i < 46; i++) for (let j = 0; j < 11; j++) await call("hello", {}, { hash: H64("8"), ip: "203.0.113." + (100 + i) });
eq(await one("select count(distinct ip)::int from semis_logi_private.ksync_events where kind = 'rate' and detail ->> 'why' = 'key' and ip like '203.0.113.1%'"), 46, "S1: 46 IP 모두 차단");
await db.exec("insert into semis_logi_private.ksync_events(kind, ip, detail) select 'bad_key', 'x' || g, '{}'::jsonb from generate_series(1, 500) g");
ok(await one("select count(*)::int from semis_logi_private.ksync_events where kind in ('bad_key', 'revoked_key') and at > now() - interval '15 minutes'") >= 500, "S1: 기록 상한 참");
const NEWIP = "192.0.2.201";
for (let j = 0; j < 11; j++) eq((await call("hello", {}, { hash: H64("9"), ip: NEWIP })).error, "auth", "새 IP 실패 " + (j + 1));
eq((await call("hello", {}, { ip: NEWIP })).error, "rate", "S1: 기록 상한이 차도 새 IP 차단(맞는 키도)");
eq(await one("select count(*)::int from semis_logi_private.ksync_events where ip = $1 and kind = 'bad_key'", [NEWIP]), 0, "S1: 상한이 차면 기록은 안 늘어남");
eq((await call("hello", {})).ok, true, "S1: 다른 IP(에이전트)는 그대로");

// #13 — 키 실패 셈: 시각 색인 · 1시간 지난 줄은 실패마다가 아니라 가끔 지움 · IPv6 는 /64 로 셈 · 차단
eq(await one("select count(*)::int from pg_indexes where schemaname = 'semis_logi_private' and indexname = 'ksync_fails_at'"), 1, "#13 시각 색인");
const nFails = (ips) => one("select count(*)::int from semis_logi_private.ksync_fails where ip = any($1)", [ips]);
await db.exec("insert into semis_logi_private.ksync_fails(ip, at) values ('t-old1', now() - interval '90 minutes')");
await call("hello", {}, { hash: H64("6"), ip: "192.0.2.211" });
eq(await nFails(["t-old1"]), 1, "#13 1시간 지난 줄을 실패마다 지우지 않음");
await db.exec("insert into semis_logi_private.ksync_fails(ip, at) values ('t-old2', now() - interval '3 hours')");
await call("hello", {}, { hash: H64("6"), ip: "192.0.2.211" });
eq(await nFails(["t-old1", "t-old2"]), 0, "#13 가장 오래된 줄이 2시간을 넘으면 1시간 지난 줄을 지움");
eq(await nFails(["192.0.2.211"]), 2, "#13 최근 실패는 남음");
for (let j = 1; j <= 11; j++) eq((await call("hello", {}, { hash: H64("5"), ip: "2001:db8:1:2::" + j.toString(16) })).error, "auth", "#13 IPv6 실패 " + j);
eq(await nFails(["2001:db8:1:2::/64"]), 11, "#13 IPv6 는 /64 로 셈");
eq((await call("hello", {}, { ip: "2001:db8:1:2::ff" })).error, "rate", "#13 같은 /64 의 다른 주소로 바꿔 가며 실패해도 차단(맞는 키도)");
eq((await call("hello", {}, { ip: "2001:db8:1:3::1" })).error, "ip", "#13 다른 /64 는 차단 아님");
eq([await one("select semis_logi_private.ksync_fail_key('::ffff:192.0.2.1')"), await one("select semis_logi_private.ksync_fail_key('192.0.2.1')"),
  await one("select semis_logi_private.ksync_fail_key('nope')")], ["::ffff:192.0.2.1", "192.0.2.1", "nope"], "#13 IPv4 · IPv4 를 담은 IPv6 는 주소 하나 · 모르는 값은 그대로");

// v1.64 기준일(since) — 연결마다 날짜 하나(한국 시각 그날 0시부터). 미리보기 중에는 자유롭게, 시작한 뒤에는 더 늦은 날로만 · 키가 없으면 그대로 ·
// 서버도 기준선 줄 없는 기준일 전 새 문서를 받지 않음(다른 연결 기준선과 해시가 같으면 받음) · 막는 형식에 인증서 · 바로 가기
await db.exec(`update semis_logi_private.ksync_state set limits = '{"perMin": 100000, "dayBytes": 1000000000}'::jsonb`);
await as("a1", "admin");
const save = (p) => rpc("semis_logi_ksync_map_save", p);
const sinceOf = (id) => one("select since::text from semis_logi_private.ksync_maps where id = $1", [id]);
const pvSet = (id) => db.query("update semis_logi_private.ksync_maps set preview = '{\"total\": 1}'::jsonb where id = $1", [id]);
for (const bad of ["2025-8-1", "2025/08/01", "20250801", "2025-02-30", "2025-13-01", "x", 20250801]) {
  eq((await save({ k_path: "기준일/가", mod: "audit", grp: "since-a", since: bad })).error, "since", "기준일 형식 오류 " + JSON.stringify(bad));
}
eq(await one("select count(*)::int from semis_logi_private.ksync_maps where grp = 'since-a'"), 0, "형식 오류면 만들지 않음");
r = await save({ k_path: "기준일/가", mod: "audit", grp: "since-a", since: "2025-08-01" });
const MS = r.id;
eq([r.ok, await sinceOf(MS)], [true, "2025-08-01"], "새 연결에 기준일");
const MN = (await save({ k_path: "기준일/나", mod: "audit", grp: "since-b" })).id;
eq(await sinceOf(MN), null, "기준일 없이 만들면 비어 있음");
await pvSet(MS);
eq([(await save({ id: MS, since: "2025-07-01" })).ok, await sinceOf(MS), await one("select preview from semis_logi_private.ksync_maps where id = $1", [MS])], [true, "2025-07-01", null],
  "미리보기 중에는 더 이른 날도 · 바꾸면 건수를 지우고 다시 셈");
eq([(await save({ id: MS, since: "" })).ok, await sinceOf(MS)], [true, null], "미리보기 중에는 비우기도(빈 값)");
eq([(await save({ id: MS, since: "2025-08-01" })).ok, await sinceOf(MS)], [true, "2025-08-01"], "다시 넣기");
eq([(await save({ id: MS, since: null })).ok, await sinceOf(MS)], [true, null], "null 도 비우기");
await save({ id: MS, since: "2025-08-01" });
await pvSet(MS);
eq([(await save({ id: MS, dir: "both", ssi: false })).ok, await sinceOf(MS), await one("select preview ->> 'total' from semis_logi_private.ksync_maps where id = $1", [MS])], [true, "2025-08-01", "1"],
  "키 없는 편집(방향 · SSI 만) → 기준일 · 건수 그대로");
eq((await save({ id: MS, since: "2025-02-30" })).error, "since", "고칠 때도 없는 날은 거절");
eq((await rpc("semis_logi_ksync_map_start", MS, "::bigint")).ok, true, "기준일 연결 시작");
for (const [v, why] of [["2025-07-31", "더 이른 날"], ["", "비우기"], [null, "null"]]) eq((await save({ id: MS, since: v })).error, "locked", "시작한 뒤 " + why + " → locked");
eq(await sinceOf(MS), "2025-08-01", "거절하면 그대로");
eq((await save({ id: MS, since: "2025-08-01" })).ok, true, "같은 날은 그대로 받음");
eq([(await save({ id: MS, since: "2025-09-01" })).ok, await sinceOf(MS)], [true, "2025-09-01"], "시작한 뒤 더 늦은 날 → 허용(좁히기)");
eq([(await save({ id: MS, dir: "both" })).ok, await sinceOf(MS)], [true, "2025-09-01"], "시작한 뒤 키 없는 편집 → 기준일 그대로");
await pvSet(MN);
await rpc("semis_logi_ksync_map_start", MN, "::bigint");
await as(null);
const hs = await call("hello", { full: true });
eq([hs.maps.find(m => m.id === MS).since, hs.maps.find(m => m.id === MN).since], ["2025-09-01", null], "hello 연결 정보에 기준일");
await as("a1", "admin");
eq([(await save({ id: MN, since: "2025-08-01" })).ok, await sinceOf(MN)], [true, "2025-08-01"], "시작한 뒤 기준일이 없던 연결에 날짜 넣기 = 좁히기 → 허용");
await save({ id: MN, pause: true });
eq((await save({ id: MN, since: "2025-07-01" })).error, "locked", "멈춘 연결도 시작한 뒤라 더 이른 날 → locked");
eq((await rpc("semis_logi_ksync_status")).maps.find(m => m.id === MS).since, "2025-09-01", "상태 연결 목록에 기준일");
const MP = (await save({ k_path: "기준일/다", mod: "audit", grp: "since-c", since: "2025-08-01" })).id;
await as(null);
eq((await call("preview", { map: MP, counts: { k2h: 2, old: 5, total: 2 } })).ok, true, "미리보기 건수에 old");
eq(await one("select preview - 'at' from semis_logi_private.ksync_maps where id = $1", [MP]), { del: 0, h2k: 0, k2h: 2, old: 5, link: 0, skip: 0, total: 2, conflict: 0 }, "기준일 전 건수(old) 저장");
// put_begin — 기준일 2025-09-01 = 2025-08-31T15:00:00Z
const RS = (await call("run", { phase: "start", trigger: "manual" })).run;
const bS = (rel, o) => begin(rel, Object.assign({ run: RS, map: MS }, o || {}));
eq((await bS("old.pdf", { mtime: "2025-08-31T14:59:59.999Z", sha256: H64("9f81") })).error, "old", "put_begin: 기준선 줄 없는 기준일 전 새 문서 → old");
eq((await bS("new.pdf", { mtime: "2025-08-31T15:00:00Z", sha256: H64("9f82") })).ok, true, "put_begin: 기준일 0시(한국)부터는 받음");
eq((await bS("nomt.pdf", { mtime: undefined, sha256: H64("9f83") })).error, "old", "put_begin: 수정 시각 없음 → old(옛 에이전트도 막음)");
eq((await bS("badmt.pdf", { mtime: "어제", sha256: H64("9f84") })).error, "old", "put_begin: 수정 시각 틀림 → old");
await db.query("insert into semis_logi_private.ksync_files(map_id, rel_path, k_size, k_mtime, k_sha256, state) values ($1, 'moved.pdf', 10, now(), $2, 'ok')", [MN, H64("9f85")]);
eq((await bS("moved.pdf", { mtime: "2025-01-01T00:00:00Z", sha256: H64("9f85") })).ok, true, "put_begin: 다른 연결 기준선과 해시가 같은 옛 파일(연결 폴더끼리 옮김) → 받음");
r = await call("hello", { full: true });
eq([r.lists.some(l => l.map === MN), r.paused_base.filter(b => b.k_sha256 === H64("9f85")).map(b => b.k_size), (await call("hello", {})).paused_base],
  [false, [10], undefined], "hello full: 멈춘 연결은 목록 없이 기준선 크기 · 해시만(paused_base — 에이전트도 그 폴더에서 옮긴 옛 파일을 새 파일로)");
const RB2 = await one("insert into semis_logi_private.ksync_files(map_id, rel_path, k_size, k_mtime, k_sha256, doc_id, ser, h_url, h_name, state) values ($1, 'base.pdf', 3, now(), $2, 'd-sb', 'sb', $3, 'base.pdf', 'ok') returning id",
  [MS, H64("9f86"), PUB + "docs/sbsbsbsbsbsb_base.pdf"]);
eq((await bS("base.pdf", { mode: "version", row: RB2, mtime: "2025-01-01T00:00:00Z", sha256: H64("9f87") })).ok, true, "put_begin: 기준선 줄 있는 새 판은 날짜와 관계없이");
eq((await bS("base.pdf", { mode: "new", row: RB2, mtime: "2025-01-01T00:00:00Z", sha256: H64("9f88") })).ok, true, "put_begin: 기준선 줄 있는 새 문서(복원 · H 가 첨부를 뺌)도 그대로");
eq((await bS("base (충돌 2026-11-10).pdf", { mode: "old", row: RB2, mtime: "2025-01-01T00:00:00Z", sha256: H64("9f89") })).ok, true, "put_begin: 충돌 사본(이전 판)도 그대로");
eq((await begin("old-nosince.pdf", { run: RS, map: M3, mtime: "2020-01-01T00:00:00Z", sha256: H64("9f8a") })).ok, true, "put_begin: 기준일 없는 연결은 지금처럼");
for (const n of ["a.pfx", "b.P12", "c.pem", "d.kdbx", "e.lnk", "f.URL", "g.html", "h.mjs"]) eq(await one("select semis_logi_private.ksync_h_blocked($1)", [n]), true, "H 로 올리지 않음 " + n);
for (const n of ["a.key", "b.pdf", "c.pemx", "d.urls", "e.xlsx"]) eq(await one("select semis_logi_private.ksync_h_blocked($1)", [n]), false, "H 로 올림 " + n);
eq((await bS("cert.pfx", { mtime: "2026-01-01T00:00:00Z", sha256: H64("9f8b") })).error, "type", "put_begin: 인증서 → type");
// 파일 전체를 다시 실행(마이그레이션 semis_logi_security_32_ksync_since) — 기준일 · 기준선 · 권한 그대로
await db.exec(SQL);
eq([await sinceOf(MS), await sinceOf(MN), await one("select count(*)::int from semis_logi_private.ksync_files where map_id = $1", [MN])], ["2025-09-01", "2025-08-01", 1], "다시 실행해도 기준일 · 기준선 그대로");
eq([await one("select has_function_privilege('service_role', 'public.semis_logi_ksync_agent(text, text, text, jsonb)', 'EXECUTE')"),
  await one("select has_function_privilege('anon', 'public.semis_logi_ksync_agent(text, text, text, jsonb)', 'EXECUTE')"),
  await one("select has_function_privilege('anon', 'public.semis_logi_ksync_map_save(jsonb)', 'EXECUTE')")], [true, false, true], "다시 실행해도 권한 그대로");

console.log(`ksync SQL: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
