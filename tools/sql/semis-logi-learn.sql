/* H:drive — 교육 전파 · 서명(온라인 이수) 서버 원본. 공개 저장소 — 명단 · 계정 · 키를 넣지 않는다.
   마이그레이션 semis_logi_learn_1 (이 파일 전체). PGlite 시험: tools/sql/semis-logi-learn.test.mjs

   - 교육 정의 = 공용 행 learn(권한표 2/3) { courses[{ id, code, state(draft|open|closed), title, kind, overview, host, place,
     start, end, body, items[{ id, type(doc|image|video), name, size, url, dur }], minSec, targets{ groups[], add[], except[] } … }] }
   - 명단 = 공용 행 roster(2/3, 인원 관리 화면 js/roster.js) { people[{ id, name, org, part, emp, gender(M|F|), title, left }], orgs[] }
     '그룹' = 에어제타 직원은 파트, 그 밖은 소속(회사). 학습 화면에는 대상 그룹 · 이름이 맞는 사람만 돌려준다
   - 이수 기록 · 서명 = 비공개 표 learn_done (공용 행에 넣지 않음 — 로그인 없는 화면이 쓰고, 서명 그림이 크다)
   - 학습 화면(learn.html, 로그인 없음): info(코드) → ticket(작업증명) → find(이름) → start → submit(서명).
     자료 파일은 Edge semis-logi-learn(op media)이 learn_media_ok(서비스 권한만)로 확인한 뒤 서명 URL
   - 관리(세션): stats · signs(manager 이상) · admin(hq 이상 — 무효 · 되살리기 · 명단 연결 · 지운 교육 기록 정리)
   - 시도 제한 표는 보안교육 이수 등록과 같은 edu_hits(종류 이름 l_*) */

insert into semis_logi_private.key_acl(key, read_rank, write_rank) values ('learn',2,3), ('roster',2,3)
on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank;

create table if not exists semis_logi_private.learn_tickets (
  ticket_hash text primary key,
  course_id   text not null,
  code        text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text not null default '',
  finds       int not null default 0,
  starts      int not null default 0
);
create index if not exists learn_tickets_exp_idx on semis_logi_private.learn_tickets(expires_at);
create table if not exists semis_logi_private.learn_done (
  id          text primary key,
  course_id   text not null,
  pkey        text not null,
  pid         text not null default '',
  name        text not null,
  org         text not null default '',
  part        text not null default '',
  emp         text not null default '',
  gender      text not null default '',
  manual      boolean not null default false,
  state       text not null default 'start' check (state in ('start', 'ok', 'void')),
  ticket_hash text not null default '',
  started_at  timestamptz not null default now(),
  done_at     timestamptz,
  secs        int not null default 0,
  sign        text not null default '',
  sid         text not null default '',
  ip          text not null default '',
  ua          text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  unique (course_id, pkey)
);
create index if not exists learn_done_course_idx on semis_logi_private.learn_done(course_id);
alter table semis_logi_private.learn_tickets enable row level security;
alter table semis_logi_private.learn_done enable row level security;
revoke all on semis_logi_private.learn_tickets, semis_logi_private.learn_done from public, anon, authenticated;

/* ─── 보조 ─── */
create or replace function semis_logi_private.learn_key(p text) returns text
language sql immutable set search_path = '' as $$ select lower(regexp_replace(coalesce(p, ''), '[[:space:]]+', '', 'g')) $$;
create or replace function semis_logi_private.learn_arr(v jsonb) returns jsonb
language sql immutable set search_path = '' as $$ select case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end $$;
create or replace function semis_logi_private.learn_group(p jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p ->> 'org', '')) = '에어제타' and btrim(coalesce(p ->> 'part', '')) <> ''
              then btrim(p ->> 'part') else btrim(coalesce(p ->> 'org', '')) end
$$;
/* 대상 여부 — add 는 늘 대상, except 는 늘 제외, 그 밖은 그룹이 groups 에 있으면 */
create or replace function semis_logi_private.learn_is_target(c jsonb, p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when semis_logi_private.learn_arr(c -> 'targets' -> 'add') ? (p ->> 'id') then true
    when semis_logi_private.learn_arr(c -> 'targets' -> 'except') ? (p ->> 'id') then false
    else semis_logi_private.learn_arr(c -> 'targets' -> 'groups') ? semis_logi_private.learn_group(p) end
$$;
/* 학습 화면 시도 제한 — 통과면 null. 사무실은 여럿이 한 공인 IP 를 쓴다(회의 중 QR 로 한꺼번에 들어와도 걸리지 않게) */
create or replace function semis_logi_private.learn_limit(p_kind text, p_ip text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare n int; lim10 int; limday int;
begin
  delete from semis_logi_private.edu_hits where at < now() - interval '2 days';
  select count(*) into n from semis_logi_private.edu_hits h where h.ip = p_ip and h.kind = 'bad' and h.at > now() - interval '15 minutes';
  if n >= 20 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 15); end if;
  lim10  := case p_kind when 'l_info' then 400 when 'l_ticket' then 200 when 'l_find' then 300 when 'l_start' then 200 when 'l_submit' then 200 else 100 end;
  limday := case p_kind when 'l_info' then 4000 when 'l_ticket' then 2000 when 'l_find' then 3000 when 'l_start' then 2000 when 'l_submit' then 1500 else 1000 end;
  select count(*) into n from semis_logi_private.edu_hits h where h.ip = p_ip and h.kind = p_kind and h.at > now() - interval '10 minutes';
  if n >= lim10 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 10); end if;
  select count(*) into n from semis_logi_private.edu_hits h where h.ip = p_ip and h.kind = p_kind and h.at > now() - interval '1 day';
  if n >= limday then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 60); end if;
  insert into semis_logi_private.edu_hits(ip, kind) values (p_ip, p_kind);
  return null;
end $$;
/* 코드 → 교육(공용 행 learn 안의 한 건). 없으면 null */
create or replace function semis_logi_private.learn_course(p_k text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select c from public.semis_logi_store s,
         jsonb_array_elements(semis_logi_private.learn_arr(s.value -> 'courses')) c
   where s.key = 'learn' and jsonb_typeof(c) = 'object' and c ->> 'code' = lower(btrim(coalesce(p_k, '')))
     and lower(btrim(coalesce(p_k, ''))) ~ '^[a-z2-9]{12}$'
   limit 1
$$;
create or replace function semis_logi_private.learn_course_by_id(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select c from public.semis_logi_store s,
         jsonb_array_elements(semis_logi_private.learn_arr(s.value -> 'courses')) c
   where s.key = 'learn' and jsonb_typeof(c) = 'object' and c ->> 'id' = p_id
   limit 1
$$;
/* 교육을 지금 받을 수 있는지 — 통과면 null. 없는 코드는 'bad' 시도로 센다 */
create or replace function semis_logi_private.learn_open_err(c jsonb, p_ip text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare d0 date; d1 date; t date := semis_logi_private.edu_today();
begin
  if c is null then
    insert into semis_logi_private.edu_hits(ip, kind) values (p_ip, 'bad');
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if coalesce(c ->> 'state', '') <> 'open' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  d0 := semis_logi_private.edu_date(c ->> 'start'); d1 := semis_logi_private.edu_date(c ->> 'end');
  if d0 is not null and t < d0 then return jsonb_build_object('ok', false, 'error', 'before', 'start', c ->> 'start'); end if;
  if d1 is not null and t > d1 then return jsonb_build_object('ok', false, 'error', 'after', 'end', c ->> 'end'); end if;
  return null;
end $$;
create or replace function semis_logi_private.learn_people() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select semis_logi_private.learn_arr(s.value -> 'people') from public.semis_logi_store s where s.key = 'roster'), '[]'::jsonb)
$$;
/* 표 확인 — 맞으면 표 행, 아니면 null */
create or replace function semis_logi_private.learn_ticket_row(p_ticket text, p_course text) returns semis_logi_private.learn_tickets
language plpgsql stable security definer set search_path = '' as $$
declare k semis_logi_private.learn_tickets%rowtype;
begin
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{48}$' then return null; end if;
  select * into k from semis_logi_private.learn_tickets x
   where x.ticket_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex') and x.expires_at > now() and x.course_id = p_course;
  if not found then return null; end if;
  return k;
end $$;
create or replace function semis_logi_private.learn_min(c jsonb) returns int
language sql immutable set search_path = '' as $$
  select least(3600, greatest(0, coalesce(case when jsonb_typeof(c -> 'minSec') = 'number' then (c ->> 'minSec')::numeric::int end, 0)))
$$;
create or replace function semis_logi_private.learn_items(c jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('i', o - 1, 'type', coalesce(x ->> 'type', 'doc'), 'name', left(coalesce(x ->> 'name', ''), 120),
           'dur', case when jsonb_typeof(x -> 'dur') = 'number' then (x ->> 'dur')::numeric else null end) order by o), '[]'::jsonb)
    from jsonb_array_elements(semis_logi_private.learn_arr(c -> 'items')) with ordinality as z(x, o)
   where jsonb_typeof(x) = 'object'
$$;
create or replace function semis_logi_private.learn_kst(t timestamptz) returns text
language sql immutable set search_path = '' as $$ select to_char(t at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') $$;
create or replace function semis_logi_private.learn_notify() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('key', 'learn:done', 'by', '', 'at', now()), 'change', 'semis-logi-sync', false);
exception when others then
  null;
end $$;
create or replace function semis_logi_private.learn_me() returns table(account_id text, login_id text, rank int)
language sql stable security definer set search_path = '' as $$
  select c.account_id, c.login_id, c.rank from semis_logi_private.ctx() c where c.kind = 'user' limit 1
$$;

/* ═════════════ 학습 화면 (로그인 없이) ═════════════ */
create or replace function public.semis_logi_learn_info(p_k text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ip text := semis_logi_private.client_ip(); v_err jsonb; c jsonb; ppl jsonb;
begin
  v_err := semis_logi_private.learn_limit('l_info', v_ip);
  if v_err is not null then return v_err; end if;
  c := semis_logi_private.learn_course(p_k);
  v_err := semis_logi_private.learn_open_err(c, v_ip);
  if v_err is not null then
    if c is not null then v_err := v_err || jsonb_build_object('title', left(coalesce(c ->> 'title', ''), 80)); end if;
    return v_err;
  end if;
  ppl := semis_logi_private.learn_people();
  return jsonb_build_object('ok', true,
    'title', left(coalesce(c ->> 'title', ''), 80), 'kind', left(coalesce(c ->> 'kind', ''), 10),
    'overview', left(coalesce(c ->> 'overview', ''), 600), 'host', left(coalesce(c ->> 'host', ''), 60),
    'place', left(coalesce(c ->> 'place', ''), 60), 'start', coalesce(c ->> 'start', ''), 'end', coalesce(c ->> 'end', ''),
    'minSec', semis_logi_private.learn_min(c), 'items', semis_logi_private.learn_items(c),
    'orgs', coalesce((select jsonb_agg(o order by (o <> '에어제타'), o) from (
        select distinct btrim(z ->> 'org') as o from jsonb_array_elements(ppl) z
         where jsonb_typeof(z) = 'object' and btrim(coalesce(z ->> 'org', '')) <> '' and coalesce(z ->> 'left', '') = ''
        union
        select distinct btrim(v) from jsonb_array_elements_text(semis_logi_private.learn_arr(
          (select s.value -> 'orgs' from public.semis_logi_store s where s.key = 'roster'))) v
         where btrim(v) <> ''
        union select '에어제타') q where length(o) <= 30 limit 40), '[]'::jsonb),
    'parts', coalesce((select jsonb_agg(p order by p) from (
        select distinct btrim(z ->> 'part') as p from jsonb_array_elements(ppl) z
         where jsonb_typeof(z) = 'object' and btrim(coalesce(z ->> 'org', '')) = '에어제타' and btrim(coalesce(z ->> 'part', '')) <> ''
           and coalesce(z ->> 'left', '') = '') q where length(p) <= 30 limit 30), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_learn_ticket(p_k text, p_pow jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ip text := semis_logi_private.client_ip(); v_err jsonb; v_pe text; c jsonb;
  v_tk text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  v_err := semis_logi_private.learn_limit('l_ticket', v_ip);
  if v_err is not null then return v_err; end if;
  v_pe := semis_logi_private.pow_check(p_pow);
  if v_pe is not null then return jsonb_build_object('ok', false, 'error', v_pe); end if;
  c := semis_logi_private.learn_course(p_k);
  v_err := semis_logi_private.learn_open_err(c, v_ip);
  if v_err is not null then return v_err; end if;
  delete from semis_logi_private.learn_tickets where expires_at < now() - interval '1 day';
  insert into semis_logi_private.learn_tickets(ticket_hash, course_id, code, expires_at, ip)
  values (encode(extensions.digest(v_tk, 'sha256'), 'hex'), c ->> 'id', c ->> 'code', now() + interval '3 hours', v_ip);
  return jsonb_build_object('ok', true, 'ticket', v_tk, 'exp', extract(epoch from now() + interval '3 hours')::bigint);
end $$;

/* 이름 찾기 — 띄어쓰기를 뺀 이름이 같은 사람만(한 글자로 명단을 훑지 못하게). 대상 밖이면 tgt false */
create or replace function public.semis_logi_learn_find(p_k text, p_ticket text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ip text := semis_logi_private.client_ip(); v_err jsonb; c jsonb; k semis_logi_private.learn_tickets%rowtype;
  v_key text := semis_logi_private.learn_key(p_name);
begin
  v_err := semis_logi_private.learn_limit('l_find', v_ip);
  if v_err is not null then return v_err; end if;
  c := semis_logi_private.learn_course(p_k);
  v_err := semis_logi_private.learn_open_err(c, v_ip);
  if v_err is not null then return v_err; end if;
  k := semis_logi_private.learn_ticket_row(p_ticket, c ->> 'id');
  if k.ticket_hash is null then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  if k.finds >= 40 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 10); end if;
  update semis_logi_private.learn_tickets x set finds = x.finds + 1 where x.ticket_hash = k.ticket_hash;
  if length(v_key) < 2 or length(v_key) > 20 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  return jsonb_build_object('ok', true, 'list', coalesce((
    select jsonb_agg(jsonb_build_object('pid', z ->> 'id', 'name', z ->> 'name', 'org', coalesce(z ->> 'org', ''),
             'part', coalesce(z ->> 'part', ''), 'emp', coalesce(z ->> 'emp', ''), 'title', coalesce(z ->> 'title', ''),
             'tgt', semis_logi_private.learn_is_target(c, z),
             'done', (select semis_logi_private.learn_kst(d.done_at) from semis_logi_private.learn_done d
                       where d.course_id = c ->> 'id' and d.pkey = 'p:' || (z ->> 'id') and d.state = 'ok'))
             order by semis_logi_private.learn_is_target(c, z) desc, z ->> 'org', z ->> 'part')
      from jsonb_array_elements(semis_logi_private.learn_people()) z
     where jsonb_typeof(z) = 'object' and coalesce(z ->> 'id', '') <> '' and coalesce(z ->> 'left', '') = ''
       and semis_logi_private.learn_key(z ->> 'name') = v_key), '[]'::jsonb));
end $$;

/* 시작 — p = { pid } 또는 명단에 없을 때 { name, org, part, emp(에어제타만) }.
   이미 이수했으면 done, 시작만 했으면 같은 기록으로 이어 간다(최소 학습 시간은 처음 시작부터) */
create or replace function public.semis_logi_learn_start(p_k text, p_ticket text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ip text := semis_logi_private.client_ip(); v_err jsonb; c jsonb; k semis_logi_private.learn_tickets%rowtype;
  per jsonb; v_pkey text; v_manual boolean := false; v_name text; v_org text; v_part text; v_emp text; v_gender text := '';
  d semis_logi_private.learn_done%rowtype; v_rid text; v_has boolean;
begin
  v_err := semis_logi_private.learn_limit('l_start', v_ip);
  if v_err is not null then return v_err; end if;
  c := semis_logi_private.learn_course(p_k);
  v_err := semis_logi_private.learn_open_err(c, v_ip);
  if v_err is not null then return v_err; end if;
  k := semis_logi_private.learn_ticket_row(p_ticket, c ->> 'id');
  if k.ticket_hash is null then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if coalesce(p ->> 'pid', '') <> '' then
    select z into per from jsonb_array_elements(semis_logi_private.learn_people()) z
     where jsonb_typeof(z) = 'object' and z ->> 'id' = p ->> 'pid' and coalesce(z ->> 'left', '') = '' limit 1;
    if per is null then return jsonb_build_object('ok', false, 'error', 'person'); end if;
  else
    v_name := semis_logi_private.edu_str(p ->> 'name', 20);
    v_org := semis_logi_private.edu_str(p ->> 'org', 30);
    v_part := coalesce(semis_logi_private.edu_str(p ->> 'part', 30), '');
    v_emp := upper(coalesce(semis_logi_private.edu_str(p ->> 'emp', 12), ''));
    if v_name is null or length(semis_logi_private.learn_key(v_name)) < 2 or v_name !~ '[가-힣A-Za-z]' then
      return jsonb_build_object('ok', false, 'error', 'name'); end if;
    if v_org is null or v_org = '' then return jsonb_build_object('ok', false, 'error', 'org'); end if;
    if v_org = '에어제타' then
      if v_emp !~ '^[0-9A-Z-]{3,12}$' then return jsonb_build_object('ok', false, 'error', 'emp'); end if;
      select z into per from jsonb_array_elements(semis_logi_private.learn_people()) z
       where jsonb_typeof(z) = 'object' and coalesce(z ->> 'left', '') = '' and btrim(coalesce(z ->> 'org', '')) = '에어제타'
         and semis_logi_private.edu_emp_key(z ->> 'emp') = semis_logi_private.edu_emp_key(v_emp) and semis_logi_private.edu_emp_key(v_emp) <> ''
       limit 1;
      if per is not null and semis_logi_private.learn_key(per ->> 'name') <> semis_logi_private.learn_key(v_name) then
        return jsonb_build_object('ok', false, 'error', 'emp_name'); end if;
    else
      v_emp := '';
    end if;
  end if;
  if per is not null then
    v_pkey := 'p:' || (per ->> 'id');
    v_name := per ->> 'name'; v_org := coalesce(per ->> 'org', ''); v_part := coalesce(per ->> 'part', ''); v_emp := coalesce(per ->> 'emp', '');
    v_gender := case when per ->> 'gender' in ('M', 'F') then per ->> 'gender' else '' end;
  else
    v_manual := true;
    v_pkey := 'm:' || v_org || '|' || semis_logi_private.learn_key(v_name);
  end if;
  select * into d from semis_logi_private.learn_done x where x.course_id = c ->> 'id' and x.pkey = v_pkey;
  v_has := found;
  if v_has and d.state = 'ok' then
    return jsonb_build_object('ok', true, 'done', semis_logi_private.learn_kst(d.done_at),
      'person', jsonb_build_object('name', d.name, 'org', d.org, 'part', d.part, 'emp', d.emp));
  end if;
  if k.starts >= 20 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 10); end if;
  update semis_logi_private.learn_tickets x set starts = x.starts + 1 where x.ticket_hash = k.ticket_hash;
  if v_has then
    update semis_logi_private.learn_done x set ticket_hash = k.ticket_hash, state = 'start',
      started_at = case when x.state = 'void' then now() else x.started_at end,
      name = v_name, org = v_org, part = v_part, emp = v_emp, gender = v_gender, ip = v_ip, updated_at = now(), updated_by = 'anon/learn'
     where x.id = d.id;
    v_rid := d.id;
  else
    v_rid := 'lr' || encode(extensions.gen_random_bytes(9), 'hex');
    insert into semis_logi_private.learn_done(id, course_id, pkey, pid, name, org, part, emp, gender, manual, ticket_hash, ip, ua, updated_by)
    values (v_rid, c ->> 'id', v_pkey, coalesce(per ->> 'id', ''), v_name, v_org, v_part, v_emp, v_gender, v_manual, k.ticket_hash, v_ip,
            left(coalesce(semis_logi_private.hdr('user-agent'), ''), 200), 'anon/learn');
  end if;
  return jsonb_build_object('ok', true, 'rid', v_rid, 'minSec', semis_logi_private.learn_min(c),
    'body', left(coalesce(c ->> 'body', ''), 30000), 'items', semis_logi_private.learn_items(c),
    'person', jsonb_build_object('name', v_name, 'org', v_org, 'part', v_part, 'emp', v_emp, 'manual', v_manual),
    'elapsed', (select greatest(0, extract(epoch from now() - x.started_at))::int from semis_logi_private.learn_done x where x.id = v_rid));
end $$;

/* 제출 — 서명(PNG data URL) · 최소 학습 시간(처음 시작부터) 확인. 같은 sid 를 다시 보내면 저장된 결과 */
create or replace function public.semis_logi_learn_submit(p_k text, p_ticket text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ip text := semis_logi_private.client_ip(); v_err jsonb; c jsonb; k semis_logi_private.learn_tickets%rowtype;
  d semis_logi_private.learn_done%rowtype; v_sign text := coalesce(p ->> 'sign', ''); v_sid text := coalesce(p ->> 'sid', '');
  v_min int; v_el numeric; v_secs int;
begin
  v_err := semis_logi_private.learn_limit('l_submit', v_ip);
  if v_err is not null then return v_err; end if;
  c := semis_logi_private.learn_course(p_k);
  v_err := semis_logi_private.learn_open_err(c, v_ip);
  if v_err is not null then return v_err; end if;
  k := semis_logi_private.learn_ticket_row(p_ticket, c ->> 'id');
  if k.ticket_hash is null then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  if jsonb_typeof(p) <> 'object' or v_sid !~ '^[A-Za-z0-9-]{8,64}$' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  select * into d from semis_logi_private.learn_done x where x.id = coalesce(p ->> 'rid', '') and x.course_id = c ->> 'id';
  if not found then return jsonb_build_object('ok', false, 'error', 'start'); end if;
  if d.state = 'ok' then
    if d.sid = v_sid then return jsonb_build_object('ok', true, 'at', semis_logi_private.learn_kst(d.done_at), 'name', d.name); end if;
    return jsonb_build_object('ok', false, 'error', 'done', 'at', semis_logi_private.learn_kst(d.done_at));
  end if;
  if d.state <> 'start' or d.ticket_hash <> k.ticket_hash then return jsonb_build_object('ok', false, 'error', 'start'); end if;
  if length(v_sign) < 300 or length(v_sign) > 200000 or v_sign !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
    return jsonb_build_object('ok', false, 'error', 'sign'); end if;
  v_min := semis_logi_private.learn_min(c);
  v_el := extract(epoch from now() - d.started_at);
  if v_el + 3 < v_min * 0.9 then
    return jsonb_build_object('ok', false, 'error', 'too_fast', 'wait', ceil(v_min * 0.9 - v_el - 3)::int);
  end if;
  v_secs := least(86400, greatest(0, coalesce(case when jsonb_typeof(p -> 'secs') = 'number' then (p ->> 'secs')::numeric::int end, v_el::int)));
  update semis_logi_private.learn_done x set state = 'ok', done_at = now(), secs = v_secs, sign = v_sign, sid = v_sid, ip = v_ip,
    ua = left(coalesce(semis_logi_private.hdr('user-agent'), ''), 200), updated_at = now(), updated_by = 'anon/learn'
   where x.id = d.id;
  perform semis_logi_private.learn_notify();
  return jsonb_build_object('ok', true, 'at', semis_logi_private.learn_kst(now()), 'name', d.name);
end $$;

/* Edge semis-logi-learn(서비스 권한)만 — 표 · 시작 기록 확인 뒤 자료 파일 경로 */
create or replace function public.semis_logi_learn_media_ok(p_k text, p_ticket text, p_rid text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c jsonb; k semis_logi_private.learn_tickets%rowtype; d semis_logi_private.learn_done%rowtype;
begin
  c := semis_logi_private.learn_course(p_k);
  if c is null or coalesce(c ->> 'state', '') <> 'open' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  k := semis_logi_private.learn_ticket_row(p_ticket, c ->> 'id');
  if k.ticket_hash is null then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  select * into d from semis_logi_private.learn_done x where x.id = coalesce(p_rid, '') and x.course_id = c ->> 'id';
  if not found or d.ticket_hash <> k.ticket_hash or d.state <> 'start' then return jsonb_build_object('ok', false, 'error', 'start'); end if;
  return jsonb_build_object('ok', true, 'files', coalesce((
    select jsonb_agg(jsonb_build_object('i', o - 1, 'type', coalesce(x ->> 'type', 'doc'),
             'path', substr(x ->> 'url', strpos(x ->> 'url', '/semis-logi-files/') + 18)) order by o)
      from jsonb_array_elements(semis_logi_private.learn_arr(c -> 'items')) with ordinality as z(x, o)
     where jsonb_typeof(x) = 'object' and coalesce(x ->> 'url', '') ~ '/object/public/semis-logi-files/learn/[A-Za-z0-9._-]{4,160}$'), '[]'::jsonb));
end $$;

/* ═════════════ 관리 (로그인 세션) ═════════════ */
/* 진행 현황 — manager 이상. p = { ids: [교육 id] } (비우면 전체). 서명 그림은 빼고 */
create or replace function public.semis_logi_learn_stats(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me record; v_ids text[];
begin
  select * into me from semis_logi_private.learn_me();
  if me.rank is null or me.rank < 2 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if jsonb_typeof(p -> 'ids') = 'array' then
    select array_agg(v) into v_ids from (select jsonb_array_elements_text(p -> 'ids') v limit 300) q;
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('rid', d.id, 'cid', d.course_id, 'pid', d.pid, 'name', d.name, 'org', d.org, 'part', d.part,
             'emp', d.emp, 'gender', d.gender, 'manual', d.manual, 'state', d.state,
             'start', semis_logi_private.learn_kst(d.started_at), 'at', case when d.done_at is null then '' else semis_logi_private.learn_kst(d.done_at) end,
             'secs', d.secs, 'sign', d.sign <> '') order by d.course_id, d.done_at nulls last, d.started_at)
      from (select * from semis_logi_private.learn_done x
             where v_ids is null or x.course_id = any(v_ids) order by x.started_at desc limit 20000) d), '[]'::jsonb));
end $$;
/* 서명 그림 — manager 이상, 교육 하나씩(기록부 인쇄 · 엑셀) */
create or replace function public.semis_logi_learn_signs(p_cid text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me record;
begin
  select * into me from semis_logi_private.learn_me();
  if me.rank is null or me.rank < 2 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'signs', coalesce((
    select jsonb_object_agg(d.id, d.sign) from semis_logi_private.learn_done d
     where d.course_id = coalesce(p_cid, '') and d.state = 'ok' and d.sign <> ''), '{}'::jsonb));
end $$;
/* hq 이상 — act: void(무효) · restore(되살리기) · link(명단에 없던 사람을 명단 사람으로) · purge(지운 교육의 기록 정리) */
create or replace function public.semis_logi_learn_admin(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record; v_act text := coalesce(p ->> 'act', ''); d semis_logi_private.learn_done%rowtype; per jsonb; n int;
begin
  select * into me from semis_logi_private.learn_me();
  if me.rank is null or me.rank < 3 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_act = 'purge' then
    if coalesce(p ->> 'cid', '') = '' or semis_logi_private.learn_course_by_id(p ->> 'cid') is not null then
      return jsonb_build_object('ok', false, 'error', 'exists'); end if;
    delete from semis_logi_private.learn_done x where x.course_id = p ->> 'cid';
    get diagnostics n = row_count;
    insert into semis_logi_private.audit(actor, action, detail, ip)
    values (me.account_id, 'learn_purge', jsonb_build_object('cid', p ->> 'cid', 'n', n), semis_logi_private.client_ip());
    return jsonb_build_object('ok', true, 'n', n);
  end if;
  select * into d from semis_logi_private.learn_done x where x.id = coalesce(p ->> 'rid', '');
  if not found then return jsonb_build_object('ok', false, 'error', 'none'); end if;
  if v_act = 'void' then
    update semis_logi_private.learn_done x set state = 'void', updated_at = now(), updated_by = coalesce(me.login_id, '') where x.id = d.id;
  elsif v_act = 'restore' then
    update semis_logi_private.learn_done x set state = case when x.sign <> '' and x.done_at is not null then 'ok' else 'start' end,
      updated_at = now(), updated_by = coalesce(me.login_id, '') where x.id = d.id;
  elsif v_act = 'link' then
    select z into per from jsonb_array_elements(semis_logi_private.learn_people()) z
     where jsonb_typeof(z) = 'object' and z ->> 'id' = coalesce(p ->> 'pid', '') limit 1;
    if per is null then return jsonb_build_object('ok', false, 'error', 'person'); end if;
    if exists (select 1 from semis_logi_private.learn_done x where x.course_id = d.course_id and x.pkey = 'p:' || (per ->> 'id') and x.id <> d.id) then
      return jsonb_build_object('ok', false, 'error', 'dup'); end if;
    update semis_logi_private.learn_done x set pkey = 'p:' || (per ->> 'id'), pid = per ->> 'id', manual = false,
      name = per ->> 'name', org = coalesce(per ->> 'org', ''), part = coalesce(per ->> 'part', ''), emp = coalesce(per ->> 'emp', ''),
      gender = case when per ->> 'gender' in ('M', 'F') then per ->> 'gender' else '' end,
      updated_at = now(), updated_by = coalesce(me.login_id, '') where x.id = d.id;
  else
    return jsonb_build_object('ok', false, 'error', 'act');
  end if;
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values (me.account_id, 'learn_' || v_act, jsonb_build_object('rid', d.id, 'cid', d.course_id, 'pid', coalesce(p ->> 'pid', '')), semis_logi_private.client_ip());
  perform semis_logi_private.learn_notify();
  return jsonb_build_object('ok', true);
end $$;

/* ─── 실행 권한 — 비공개 보조는 API 불가, 공개 RPC 는 anon · service_role(함수 안에서 코드 · 표 · 세션 확인), media_ok 는 서비스 권한만 ─── */
revoke all on function semis_logi_private.learn_key(text), semis_logi_private.learn_arr(jsonb), semis_logi_private.learn_group(jsonb),
  semis_logi_private.learn_is_target(jsonb, jsonb), semis_logi_private.learn_limit(text, text), semis_logi_private.learn_course(text),
  semis_logi_private.learn_course_by_id(text), semis_logi_private.learn_open_err(jsonb, text), semis_logi_private.learn_people(),
  semis_logi_private.learn_ticket_row(text, text), semis_logi_private.learn_min(jsonb), semis_logi_private.learn_items(jsonb),
  semis_logi_private.learn_kst(timestamptz), semis_logi_private.learn_notify(), semis_logi_private.learn_me()
  from public, anon, authenticated;
revoke execute on function public.semis_logi_learn_info(text), public.semis_logi_learn_ticket(text, jsonb),
  public.semis_logi_learn_find(text, text, text), public.semis_logi_learn_start(text, text, jsonb),
  public.semis_logi_learn_submit(text, text, jsonb), public.semis_logi_learn_media_ok(text, text, text),
  public.semis_logi_learn_stats(jsonb), public.semis_logi_learn_signs(text), public.semis_logi_learn_admin(jsonb)
  from public, anon, authenticated;
grant execute on function public.semis_logi_learn_info(text), public.semis_logi_learn_ticket(text, jsonb),
  public.semis_logi_learn_find(text, text, text), public.semis_logi_learn_start(text, text, jsonb),
  public.semis_logi_learn_submit(text, text, jsonb),
  public.semis_logi_learn_stats(jsonb), public.semis_logi_learn_signs(text), public.semis_logi_learn_admin(jsonb)
  to anon, service_role;
grant execute on function public.semis_logi_learn_media_ok(text, text, text) to service_role;
