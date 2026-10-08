/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 보안교육 이수 등록 (배포용 웹앱 edu.html, v1.39.0, 2026-10-08)
   마이그레이션 semis_logi_security_19_edu_1_tables · _2_helpers · _3_public · _4_submit_admin 으로 나눠 적용. 이 파일은 참고용 사본이다.

   흐름
   - 안전보안파트(hq 이상)가 '이수 등록 링크'를 만든다(코드 12자 · 기한 · 제목). 메일로 링크를 보낸다.
   - 받은 사람은 로그인 없이 edu.html#코드 에서 본인 정보 · 직무(임명일) · 이수 교육(수료일 · 이수증)을 적어 제출한다.
     · semis_logi_edu_info(코드)      — 링크 확인 + 직무 · 과정 기준(협력사 과정 제외) · 소속/교육기관 예시
     · semis_logi_edu_ticket(코드, 작업증명) — 업로드 · 제출용 표(3시간). 작업증명은 로그인과 같은 semis_logi_challenge
     · 파일 함수 semis-logi-files op "edu-upload"(표) → semis_logi_edu_claim(서비스 권한만)으로 기록 후 서명 업로드 URL
     · semis_logi_edu_submit(코드, 표, 내용) — 서버 확인 후 공용 DB training 에 병합(같은 이름 재직자 = 갱신)
   - 병합 규칙(edu_merge — 순수 함수, 시험은 같은 함수에 가짜 자료를 넣어 확인)
     · 사람: 이름(공백 무시)이 같은 재직자 1명 → 그 사람. 여럿이면 소속이 서로 포함되는 1명. 못 가리면 새 사람(메모 '동명이인')
       소속은 새 값, 직무는 기존 + 새 직무(빼지 않음), 임명일(apt{직무: 날짜})은 새 값으로
     · 이수 기록: 같은 사람 · 과정 · 수료일이 있으면 그 기록을 고침(첨부는 더함, 확인 표시 지움), 없으면 새 기록 src 'self'
     · 모든 본인 등록 기록에 selfAt — 화면이 '본인 등록' 표시, 안전보안파트가 확인(chkAt · chkBy)
   - 공용 DB 저장은 계정 세션이 아니므로 저장 충돌 확인(check_base)을 타지 않는다. 열린 화면은 변경 알림으로 다시 받고,
     그 사이 저장하려던 화면은 409 → 3-way 병합(js/sync.js)이라 이 기록을 덮어쓰지 않는다.
   - 관리(hq 이상): semis_logi_edu_links(목록 · 최근 제출) · semis_logi_edu_link_save(만들기 · 끄기 · 연장)
   - 제한: IP별 10분 · 하루 시도 수(사무실 공용 IP 고려해 넉넉히), 잘못된 코드 15분 20회, 표마다 파일 15개 · 120MB, 파일 20MB(PDF · 이미지)
   - 시험 대상: 링크 target 'eduTest'(시스템관리자만 만듦) → 공용 DB 행 eduTest (앱에서 읽기 · 쓰기 불가)
   v1.39.2 (Mark 요청 — 화면 단순화: 이름 · 사번 · 임명일 · 직무 · 이수증)
   - 사번(emp) 필수 · 소속 선택(새 사람은 '인천화물팀'). 사람 찾기 = 사번이 같은 재직자 → 없으면 이름이 같은 재직자(다른 사번이 적힌 사람 제외)
   - 이수증 판독: 파일 함수 op "edu-read" 가 semis_logi_edu_read_ok(서비스 권한만 — 표 · 경로 · 판독 횟수 확인, 과정 목록)를
     부른 뒤 저장소에서 파일을 읽어 Claude 로 과정 · 수료일 · 기관 · 번호 · 시간을 뽑는다(edu_uploads.reads: 파일당 3회 · 표당 30회)
   - 적용(2026-10-08): MCP 마이그레이션 semis_logi_security_20_edu_emp(edu_emp_key · edu_merge · reads 열) · _21_edu_read_ok · _22_edu_submit_emp
     — 운영 함수 본문 md5 = 이 파일(4개 일치) · 권한 확인(read_ok = service_role 만)
   ═══════════════════════════════════════════════════════ */

create table if not exists semis_logi_private.edu_links (
  code       text primary key check (code ~ '^[a-z2-9]{12}$'),
  title      text not null default '',
  note       text not null default '',
  target     text not null default 'training' check (target in ('training', 'eduTest')),
  expires_at timestamptz not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
create table if not exists semis_logi_private.edu_tickets (
  ticket_hash text primary key,
  code        text not null references semis_logi_private.edu_links(code) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text not null default ''
);
create index if not exists edu_tickets_code_idx on semis_logi_private.edu_tickets(code);
create table if not exists semis_logi_private.edu_uploads (
  path        text primary key,
  code        text not null references semis_logi_private.edu_links(code) on delete cascade,
  ticket_hash text not null,
  name        text not null default '',
  size        bigint not null default 0,
  type        text not null default '',
  at          timestamptz not null default now(),
  used_by     text
);
create index if not exists edu_uploads_ticket_idx on semis_logi_private.edu_uploads(ticket_hash);
create table if not exists semis_logi_private.edu_submits (
  id        text primary key,
  submit_id text not null unique,
  code      text not null,
  at        timestamptz not null default now(),
  ip        text not null default '',
  ua        text not null default '',
  name      text not null default '',
  dept      text not null default '',
  pid       text not null default '',
  kind      text not null default '',
  n_recs    int not null default 0,
  result    jsonb
);
create index if not exists edu_submits_at_idx on semis_logi_private.edu_submits(at desc);
create index if not exists edu_submits_code_idx on semis_logi_private.edu_submits(code);
create table if not exists semis_logi_private.edu_hits (
  id   bigserial primary key,
  at   timestamptz not null default now(),
  ip   text,
  kind text not null,
  ok   boolean not null default false
);
create index if not exists edu_hits_ip_idx on semis_logi_private.edu_hits(ip, kind, at);
create index if not exists edu_hits_at_idx on semis_logi_private.edu_hits(at);
alter table semis_logi_private.edu_links   enable row level security;
alter table semis_logi_private.edu_tickets enable row level security;
alter table semis_logi_private.edu_uploads enable row level security;
alter table semis_logi_private.edu_submits enable row level security;
alter table semis_logi_private.edu_hits    enable row level security;
revoke all on semis_logi_private.edu_links, semis_logi_private.edu_tickets, semis_logi_private.edu_uploads,
  semis_logi_private.edu_submits, semis_logi_private.edu_hits from public, anon, authenticated;
revoke all on sequence semis_logi_private.edu_hits_id_seq from public, anon, authenticated;

/* 시험 대상 행 — 앱에서 읽기 · 쓰기 불가 */
insert into semis_logi_private.key_acl(key, read_rank, write_rank) values ('eduTest', 9, 9)
on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank;

/* ─── 보조 ─── */
/* 날짜 문자열 → date (형식이 틀리거나 없는 날이면 null) */
create or replace function semis_logi_private.edu_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
declare d date;
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  d := p::date;
  if to_char(d, 'YYYY-MM-DD') <> p then return null; end if;
  return d;
exception when others then
  return null;
end $$;
create or replace function semis_logi_private.edu_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Seoul')::date $$;
create or replace function semis_logi_private.edu_rid(p_prefix text) returns text
language sql volatile set search_path = '' as $$ select p_prefix || encode(extensions.gen_random_bytes(7), 'hex') $$;
/* 한 줄 문자열 — 공백 정리, 제어문자는 거절(null) */
create or replace function semis_logi_private.edu_str(p text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(regexp_replace(coalesce(p, ''), '[[:space:]]+', ' ', 'g'));
begin
  if s ~ '[[:cntrl:]]' or length(s) > p_max then return null; end if;
  return s;
end $$;

/* 사번 대조 키 — 영문 · 숫자만, 소문자, 앞의 항공사 코드 KJ 는 뺀다 (SeMIS v2 보안서약서와 같은 규칙) */
create or replace function semis_logi_private.edu_emp_key(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '^kj(?=[0-9])', '')
$$;

/* IP별 시도 수 제한 — 통과면 null, 아니면 오류 JSON */
create or replace function semis_logi_private.edu_limit(p_kind text, p_ip text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare n int; lim10 int; limday int;
begin
  delete from semis_logi_private.edu_hits where at < now() - interval '2 days';
  select count(*) into n from semis_logi_private.edu_hits h where h.ip = p_ip and h.kind = 'bad' and h.at > now() - interval '15 minutes';
  if n >= 20 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 15); end if;
  /* 사무실은 여러 사람이 같은 공인 IP 를 쓴다 — 메일을 받은 팀원이 한꺼번에 제출해도 걸리지 않게 넉넉히 */
  lim10  := case p_kind when 'info' then 300 when 'ticket' then 120 when 'submit' then 60 else 100 end;
  limday := case p_kind when 'info' then 3000 when 'ticket' then 1000 when 'submit' then 400 else 1000 end;
  select count(*) into n from semis_logi_private.edu_hits h where h.ip = p_ip and h.kind = p_kind and h.at > now() - interval '10 minutes';
  if n >= lim10 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 10); end if;
  select count(*) into n from semis_logi_private.edu_hits h where h.ip = p_ip and h.kind = p_kind and h.at > now() - interval '1 day';
  if n >= limday then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 60); end if;
  if p_kind = 'submit' then
    select count(*) into n from semis_logi_private.edu_hits h where h.kind = 'submit' and h.at > now() - interval '1 hour';
    if n >= 400 then return jsonb_build_object('ok', false, 'error', 'busy', 'wait', 10); end if;
  end if;
  insert into semis_logi_private.edu_hits(ip, kind) values (p_ip, p_kind);
  return null;
end $$;

/* 링크 확인 — 통과면 null, 아니면 오류 JSON (없는 코드는 'bad' 시도로 센다) */
create or replace function semis_logi_private.edu_link_check(p_k text, p_ip text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare l semis_logi_private.edu_links%rowtype; v_k text := lower(btrim(coalesce(p_k, '')));
begin
  select * into l from semis_logi_private.edu_links x where x.code = v_k;
  if not found then
    insert into semis_logi_private.edu_hits(ip, kind) values (p_ip, 'bad');
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if not l.active then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if l.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired', 'expires', to_char(l.expires_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'));
  end if;
  return null;
end $$;

/* 배포 화면에 주는 과정 — 협력사 과정 제외 */
create or replace function semis_logi_private.edu_courses(t jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(c order by o), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(t -> 'courses') = 'array' then t -> 'courses' else '[]'::jsonb end)
         with ordinality as x(c, o)
   where jsonb_typeof(c) = 'object' and coalesce(c ->> 'id', '') <> '' and coalesce(c ->> 'vendor', '') <> 'true'
$$;

/* ═════════════ 병합 (순수 — 공용 DB를 읽지 않는다) ═════════════
   t = training 값, p = 확인을 마친 제출 { name, emp, dept, roles[], apt{}, recs[{cid,date,expire,hours,org,certNo,files[]}] },
   m = { now: ISO 시각, today: YYYY-MM-DD }
   → { t: 새 training, pid, kind(new|updated|dup), person{…}, records[{id,cid,date,expire}](그 사람 전체), ids[](이번 기록) } */
create or replace function semis_logi_private.edu_merge(t jsonb, p jsonb, m jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  ppl  jsonb := case when jsonb_typeof(t -> 'people') = 'array' then t -> 'people' else '[]'::jsonb end;
  recs jsonb := case when jsonb_typeof(t -> 'records') = 'array' then t -> 'records' else '[]'::jsonb end;
  v_nk text := lower(regexp_replace(coalesce(p ->> 'name', ''), '[[:space:]]', '', 'g'));
  v_dk text := regexp_replace(coalesce(p ->> 'dept', ''), '[[:space:]]', '', 'g');
  v_ek text := semis_logi_private.edu_emp_key(p ->> 'emp');
  v_today text := m ->> 'today';
  v_now text := m ->> 'now';
  cand int[]; cand2 int[];
  v_idx int; v_kind text; v_pid text;
  per jsonb; roles jsonb; apt jsonb; r jsonb; x jsonb; f jsonb; j int; ids jsonb := '[]'::jsonb;
begin
  /* 1) 사번이 같은 재직자 */
  if v_ek <> '' then
    select array_agg((o.ord - 1)::int order by o.ord) into cand
      from jsonb_array_elements(ppl) with ordinality as o(x, ord)
     where jsonb_typeof(o.x) = 'object' and coalesce(o.x ->> 'id', '') <> ''
       and semis_logi_private.edu_emp_key(o.x ->> 'emp') = v_ek
       and not (coalesce(o.x ->> 'left', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (o.x ->> 'left') <= v_today);
    if coalesce(array_length(cand, 1), 0) >= 1 then v_idx := cand[1]; end if;
  end if;
  /* 2) 이름이 같은 재직자 — 다른 사번이 적힌 사람은 다른 사람 */
  cand := null;
  if v_idx is null then
    select array_agg((o.ord - 1)::int order by o.ord) into cand
      from jsonb_array_elements(ppl) with ordinality as o(x, ord)
     where jsonb_typeof(o.x) = 'object' and coalesce(o.x ->> 'id', '') <> ''
       and lower(regexp_replace(coalesce(o.x ->> 'name', ''), '[[:space:]]', '', 'g')) = v_nk
       and (v_ek = '' or semis_logi_private.edu_emp_key(o.x ->> 'emp') in ('', v_ek))
       and not (coalesce(o.x ->> 'left', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (o.x ->> 'left') <= v_today);
  end if;
  if v_idx is not null then
    null;
  elsif coalesce(array_length(cand, 1), 0) = 1 then
    v_idx := cand[1];
  elsif coalesce(array_length(cand, 1), 0) > 1 then
    select array_agg(c) into cand2 from unnest(cand) as c
     where v_dk <> '' and regexp_replace(coalesce(ppl -> c ->> 'dept', ''), '[[:space:]]', '', 'g') <> ''
       and (strpos(regexp_replace(ppl -> c ->> 'dept', '[[:space:]]', '', 'g'), v_dk) > 0
            or strpos(v_dk, regexp_replace(ppl -> c ->> 'dept', '[[:space:]]', '', 'g')) > 0);
    if coalesce(array_length(cand2, 1), 0) = 1 then v_idx := cand2[1]; else v_kind := 'dup'; end if;
  end if;

  if v_idx is not null then
    per := ppl -> v_idx;
    v_pid := per ->> 'id';
    roles := case when jsonb_typeof(per -> 'roles') = 'array' then per -> 'roles' else '[]'::jsonb end;
    apt := case when jsonb_typeof(per -> 'apt') = 'object' then per -> 'apt' else '{}'::jsonb end;
    for r in select * from jsonb_array_elements(coalesce(p -> 'roles', '[]'::jsonb)) loop
      if not roles @> jsonb_build_array(r) then roles := roles || jsonb_build_array(r); end if;
    end loop;
    apt := apt || coalesce(p -> 'apt', '{}'::jsonb);
    per := per || jsonb_build_object('dept', coalesce(nullif(p ->> 'dept', ''), per ->> 'dept', ''), 'roles', roles, 'apt', apt,
                                     'emp', coalesce(nullif(p ->> 'emp', ''), per ->> 'emp', ''),
                                     'selfAt', v_now, 'updatedAt', v_now, 'updatedBy', '본인 등록');
    ppl := jsonb_set(ppl, array[v_idx::text], per);
    v_kind := 'updated';
  else
    v_pid := semis_logi_private.edu_rid('tps');
    per := jsonb_build_object('id', v_pid, 'name', p ->> 'name', 'dept', coalesce(nullif(p ->> 'dept', ''), '인천화물팀'),
                              'emp', coalesce(p ->> 'emp', ''),
                              'roles', coalesce(p -> 'roles', '[]'::jsonb), 'apt', coalesce(p -> 'apt', '{}'::jsonb),
                              'left', '', 'pledge', '', 'pledgeFiles', '[]'::jsonb,
                              'note', case when v_kind = 'dup' then '동명이인 — 본인 등록 확인 필요' else '' end,
                              'src', 'self', 'selfAt', v_now, 'createdAt', v_now, 'createdBy', '본인 등록',
                              'updatedAt', v_now, 'updatedBy', '본인 등록');
    ppl := ppl || jsonb_build_array(per);
    v_kind := coalesce(v_kind, 'new');
  end if;

  for r in select * from jsonb_array_elements(coalesce(p -> 'recs', '[]'::jsonb)) loop
    j := null;
    select (o.ord - 1)::int into j from jsonb_array_elements(recs) with ordinality as o(x, ord)
     where o.x ->> 'pid' = v_pid and o.x ->> 'cid' = r ->> 'cid' and o.x ->> 'date' = r ->> 'date'
     order by o.ord limit 1;
    if j is not null then
      x := recs -> j;
      f := case when jsonb_typeof(x -> 'files') = 'array' then x -> 'files' else '[]'::jsonb end;
      f := f || coalesce((select jsonb_agg(nf) from jsonb_array_elements(coalesce(r -> 'files', '[]'::jsonb)) nf
                           where not exists (select 1 from jsonb_array_elements(f) ef where ef ->> 'url' = nf ->> 'url')), '[]'::jsonb);
      x := (x || jsonb_build_object(
              'expire', coalesce(nullif(r ->> 'expire', ''), x ->> 'expire', ''),
              'hours', case when jsonb_typeof(r -> 'hours') = 'number' then r -> 'hours' else coalesce(x -> 'hours', 'null'::jsonb) end,
              'org', coalesce(nullif(r ->> 'org', ''), x ->> 'org', ''),
              'certNo', coalesce(nullif(r ->> 'certNo', ''), x ->> 'certNo', ''),
              'files', f, 'selfAt', v_now, 'updatedAt', v_now, 'updatedBy', '본인 등록')) - 'chkAt' - 'chkBy';
      recs := jsonb_set(recs, array[j::text], x);
    else
      x := jsonb_build_object('id', semis_logi_private.edu_rid('trs'), 'pid', v_pid, 'cid', r ->> 'cid', 'date', r ->> 'date',
                              'expire', coalesce(r ->> 'expire', ''),
                              'hours', case when jsonb_typeof(r -> 'hours') = 'number' then r -> 'hours' else 'null'::jsonb end,
                              'score', null, 'org', coalesce(r ->> 'org', ''), 'certNo', coalesce(r ->> 'certNo', ''),
                              'files', coalesce(r -> 'files', '[]'::jsonb), 'note', '', 'src', 'self', 'selfAt', v_now,
                              'createdAt', v_now, 'createdBy', '본인 등록');
      recs := recs || jsonb_build_array(x);
    end if;
    ids := ids || jsonb_build_array(x ->> 'id');
  end loop;

  return jsonb_build_object(
    't', t || jsonb_build_object('people', ppl, 'records', recs),
    'pid', v_pid, 'kind', v_kind,
    'person', jsonb_build_object('id', v_pid, 'name', per ->> 'name', 'dept', coalesce(per ->> 'dept', ''), 'emp', coalesce(per ->> 'emp', ''),
                                 'roles', coalesce(per -> 'roles', '[]'::jsonb), 'apt', coalesce(per -> 'apt', '{}'::jsonb)),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', z ->> 'id', 'cid', z ->> 'cid', 'date', z ->> 'date',
                                                             'expire', coalesce(z ->> 'expire', '')) order by z ->> 'date')
                           from jsonb_array_elements(recs) z where z ->> 'pid' = v_pid), '[]'::jsonb),
    'ids', ids);
end $$;

/* ═════════════ 배포 화면 (로그인 없이) ═════════════ */
create or replace function public.semis_logi_edu_info(p_k text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip text := semis_logi_private.client_ip(); v_err jsonb; l semis_logi_private.edu_links%rowtype; t jsonb;
begin
  v_err := semis_logi_private.edu_limit('info', v_ip);
  if v_err is not null then return v_err; end if;
  v_err := semis_logi_private.edu_link_check(p_k, v_ip);
  if v_err is not null then return v_err; end if;
  select * into l from semis_logi_private.edu_links x where x.code = lower(btrim(p_k));
  select s.value into t from public.semis_logi_store s where s.key = l.target;
  return jsonb_build_object('ok', true, 'title', l.title, 'note', l.note,
    'expires', to_char(l.expires_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
    'courses', semis_logi_private.edu_courses(t),
    'depts', coalesce((select jsonb_agg(d order by d) from (
        select distinct btrim(z ->> 'dept') as d
          from jsonb_array_elements(case when jsonb_typeof(t -> 'people') = 'array' then t -> 'people' else '[]'::jsonb end) z
         where btrim(coalesce(z ->> 'dept', '')) <> '' limit 20) q), '[]'::jsonb),
    'orgs', coalesce((select jsonb_agg(o order by o) from (
        select distinct btrim(z ->> 'org') as o
          from jsonb_array_elements(case when jsonb_typeof(t -> 'records') = 'array' then t -> 'records' else '[]'::jsonb end) z
         where btrim(coalesce(z ->> 'org', '')) <> '' limit 30) q), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_edu_ticket(p_k text, p_pow jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip text := semis_logi_private.client_ip(); v_err jsonb; v_pe text;
  v_tk text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  v_err := semis_logi_private.edu_limit('ticket', v_ip);
  if v_err is not null then return v_err; end if;
  v_pe := semis_logi_private.pow_check(p_pow);
  if v_pe is not null then return jsonb_build_object('ok', false, 'error', v_pe); end if;
  v_err := semis_logi_private.edu_link_check(p_k, v_ip);
  if v_err is not null then return v_err; end if;
  delete from semis_logi_private.edu_tickets where expires_at < now() - interval '1 day';
  insert into semis_logi_private.edu_tickets(ticket_hash, code, expires_at, ip)
  values (encode(extensions.digest(v_tk, 'sha256'), 'hex'), lower(btrim(p_k)), now() + interval '3 hours', v_ip);
  return jsonb_build_object('ok', true, 'ticket', v_tk, 'exp', extract(epoch from now() + interval '3 hours')::bigint);
end $$;

/* 파일 함수(서비스 권한)만 부른다 — 표 확인 · 개수 · 용량 제한 후 업로드 기록 */
create or replace function public.semis_logi_edu_claim(p_ticket text, p_path text, p_name text, p_size bigint, p_type text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare k semis_logi_private.edu_tickets%rowtype; l semis_logi_private.edu_links%rowtype; n int; b bigint;
begin
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{48}$' then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  if p_path is null or p_path !~ '^training/[A-Za-z0-9._-]{4,120}$' then return jsonb_build_object('ok', false, 'error', 'path'); end if;
  if coalesce(p_size, 0) <= 0 or p_size > 20971520 then return jsonb_build_object('ok', false, 'error', 'too_large'); end if;
  select * into k from semis_logi_private.edu_tickets x
   where x.ticket_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex') and x.expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  select * into l from semis_logi_private.edu_links x where x.code = k.code;
  if not found or not l.active or l.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  select count(*), coalesce(sum(u.size), 0) into n, b from semis_logi_private.edu_uploads u where u.ticket_hash = k.ticket_hash;
  if n >= 15 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  if b + p_size > 125829120 then return jsonb_build_object('ok', false, 'error', 'too_large'); end if;
  insert into semis_logi_private.edu_uploads(path, code, ticket_hash, name, size, type)
  values (p_path, k.code, k.ticket_hash, left(coalesce(p_name, ''), 120), p_size, left(coalesce(p_type, ''), 80));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_logi_edu_submit(p_k text, p_ticket text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip text := semis_logi_private.client_ip(); v_err jsonb; v_prev jsonb;
  l semis_logi_private.edu_links%rowtype;
  v_sid text; v_name text; v_dept text; v_emp text; v_today date := semis_logi_private.edu_today();
  t jsonb; v_has boolean; okroles text[]; okcids text[];
  v_roles jsonb := '[]'::jsonb; v_apt jsonb := '{}'::jsonb; v_recs jsonb := '[]'::jsonb; v_paths text[] := '{}';
  r jsonb; f jsonb; v_r text; v_a text; v_d date; v_e date; v_files jsonb; v_path text; v_fname text; v_sz bigint; v_h jsonb;
  v_org text; v_no text; v_keys text[] := '{}';
  mg jsonb; v_id text := semis_logi_private.edu_rid('es'); v_res jsonb; v_now timestamptz := now();
  pre text := 'https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/';
begin
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  v_sid := btrim(coalesce(p ->> 'sid', ''));
  if v_sid !~ '^[A-Za-z0-9-]{8,64}$' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  select x.result into v_prev from semis_logi_private.edu_submits x where x.submit_id = v_sid;
  if found then return v_prev; end if;   -- 같은 제출의 재전송

  v_err := semis_logi_private.edu_limit('submit', v_ip);
  if v_err is not null then return v_err; end if;
  v_err := semis_logi_private.edu_link_check(p_k, v_ip);
  if v_err is not null then return v_err; end if;
  select * into l from semis_logi_private.edu_links x where x.code = lower(btrim(p_k));
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{48}$' or not exists (
       select 1 from semis_logi_private.edu_tickets k where k.ticket_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex')
          and k.code = l.code and k.expires_at > now()) then
    return jsonb_build_object('ok', false, 'error', 'ticket');
  end if;

  /* ─ 본인 정보 ─ */
  v_name := semis_logi_private.edu_str(p ->> 'name', 30);
  v_dept := semis_logi_private.edu_str(p ->> 'dept', 40);
  v_emp := semis_logi_private.edu_str(p ->> 'emp', 20);
  if v_name is null or v_dept is null or v_emp is null then return jsonb_build_object('ok', false, 'error', 'too_long'); end if;
  if v_name = '' then return jsonb_build_object('ok', false, 'error', 'required'); end if;
  if semis_logi_private.edu_emp_key(v_emp) = '' then return jsonb_build_object('ok', false, 'error', 'emp'); end if;

  select s.value, true into t, v_has from public.semis_logi_store s where s.key = l.target for update;
  if t is null or jsonb_typeof(t) <> 'object' then t := jsonb_build_object('courses', '[]'::jsonb, 'people', '[]'::jsonb, 'records', '[]'::jsonb, 'sessions', '[]'::jsonb); end if;
  select array_agg(distinct c ->> 'id'), array_agg(distinct rr) filter (where rr is not null and rr <> '') into okcids, okroles
    from jsonb_array_elements(semis_logi_private.edu_courses(t)) c
    left join lateral jsonb_array_elements_text(case when jsonb_typeof(c -> 'roles') = 'array' then c -> 'roles' else '[]'::jsonb end) rr on true;
  if okcids is null then return jsonb_build_object('ok', false, 'error', 'catalog'); end if;

  /* ─ 직무 · 임명일 ─ */
  if jsonb_typeof(p -> 'roles') <> 'array' or jsonb_array_length(p -> 'roles') < 1 or jsonb_array_length(p -> 'roles') > 16 then
    return jsonb_build_object('ok', false, 'error', 'roles');
  end if;
  for r in select * from jsonb_array_elements(p -> 'roles') loop
    v_r := btrim(coalesce(r ->> 'r', ''));
    if v_r = '' or not coalesce(v_r = any(okroles), false) then return jsonb_build_object('ok', false, 'error', 'roles'); end if;
    if not v_roles @> jsonb_build_array(v_r) then v_roles := v_roles || jsonb_build_array(v_r); end if;
    v_a := btrim(coalesce(r ->> 'apt', ''));
    if v_a <> '' then
      v_d := semis_logi_private.edu_date(v_a);
      if v_d is null or v_d < date '1970-01-01' or v_d > v_today + 180 then return jsonb_build_object('ok', false, 'error', 'date'); end if;
      v_apt := v_apt || jsonb_build_object(v_r, v_a);
    end if;
  end loop;

  /* ─ 이수 기록 ─ */
  if p ? 'recs' and jsonb_typeof(p -> 'recs') <> 'array' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if jsonb_array_length(coalesce(p -> 'recs', '[]'::jsonb)) > 10 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  for r in select * from jsonb_array_elements(coalesce(p -> 'recs', '[]'::jsonb)) loop
    if jsonb_typeof(r) <> 'object' or not coalesce(coalesce(r ->> 'cid', '') = any(okcids), false) then return jsonb_build_object('ok', false, 'error', 'course'); end if;
    v_d := semis_logi_private.edu_date(r ->> 'date');
    if v_d is null or v_d < date '2000-01-01' or v_d > v_today + 1 then return jsonb_build_object('ok', false, 'error', 'date'); end if;
    if coalesce(((r ->> 'cid') || '|' || (r ->> 'date')) = any(v_keys), false) then return jsonb_build_object('ok', false, 'error', 'dup_rec'); end if;
    v_keys := v_keys || ((r ->> 'cid') || '|' || (r ->> 'date'));
    v_e := null;
    if coalesce(r ->> 'expire', '') <> '' then
      v_e := semis_logi_private.edu_date(r ->> 'expire');
      if v_e is null or v_e <= v_d or v_e > v_d + 3660 then return jsonb_build_object('ok', false, 'error', 'date'); end if;
    end if;
    v_h := 'null'::jsonb;
    if r ? 'hours' and jsonb_typeof(r -> 'hours') <> 'null' then
      if jsonb_typeof(r -> 'hours') <> 'number' or (r ->> 'hours')::numeric < 0 or (r ->> 'hours')::numeric > 999 then
        return jsonb_build_object('ok', false, 'error', 'invalid');
      end if;
      v_h := r -> 'hours';
    end if;
    v_org := semis_logi_private.edu_str(r ->> 'org', 60);
    v_no := semis_logi_private.edu_str(r ->> 'certNo', 40);
    if v_org is null or v_no is null then return jsonb_build_object('ok', false, 'error', 'too_long'); end if;
    if jsonb_typeof(r -> 'files') <> 'array' or jsonb_array_length(r -> 'files') < 1 or jsonb_array_length(r -> 'files') > 5 then
      return jsonb_build_object('ok', false, 'error', 'files');
    end if;
    v_files := '[]'::jsonb;
    for f in select * from jsonb_array_elements(r -> 'files') loop
      v_path := coalesce(f ->> 'path', '');
      v_fname := semis_logi_private.edu_str(f ->> 'name', 120);
      if v_fname is null or v_fname = '' then v_fname := '이수증'; end if;
      if coalesce(v_path = any(v_paths), false) then return jsonb_build_object('ok', false, 'error', 'files'); end if;
      select (o.metadata ->> 'size')::bigint into v_sz
        from semis_logi_private.edu_uploads u
        join storage.objects o on o.bucket_id = 'semis-logi-files' and o.name = u.path
       where u.path = v_path and u.code = l.code and u.used_by is null and u.at > now() - interval '1 day';
      if v_sz is null or v_sz > 20971520 then return jsonb_build_object('ok', false, 'error', 'files'); end if;
      v_paths := v_paths || v_path;
      v_files := v_files || jsonb_build_array(jsonb_build_object('name', v_fname, 'size', v_sz, 'url', pre || v_path));
    end loop;
    v_recs := v_recs || jsonb_build_array(jsonb_build_object('cid', r ->> 'cid', 'date', r ->> 'date',
      'expire', coalesce(to_char(v_e, 'YYYY-MM-DD'), ''), 'hours', v_h, 'org', v_org, 'certNo', v_no, 'files', v_files));
  end loop;

  /* ─ 병합 · 저장 ─ */
  mg := semis_logi_private.edu_merge(t,
          jsonb_build_object('name', v_name, 'dept', v_dept, 'emp', v_emp, 'roles', v_roles, 'apt', v_apt, 'recs', v_recs),
          jsonb_build_object('now', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'today', to_char(v_today, 'YYYY-MM-DD')));
  if v_has then
    update public.semis_logi_store set value = mg -> 't', updated_by = 'edu-self' where key = l.target;
  else
    insert into public.semis_logi_store(key, value, updated_by) values (l.target, mg -> 't', 'edu-self');
  end if;
  if cardinality(v_paths) > 0 then
    update semis_logi_private.edu_uploads set used_by = v_id where path = any(v_paths);
  end if;
  v_res := jsonb_build_object('ok', true, 'receipt', upper(substr(v_id, 3, 8)),
    'at', to_char(v_now at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), 'kind', mg ->> 'kind',
    'person', mg -> 'person', 'records', mg -> 'records', 'ids', mg -> 'ids');
  insert into semis_logi_private.edu_submits(id, submit_id, code, at, ip, ua, name, dept, pid, kind, n_recs, result)
  values (v_id, v_sid, l.code, v_now, v_ip, left(coalesce(semis_logi_private.hdr('user-agent'), ''), 300), v_name, v_dept,
          mg ->> 'pid', mg ->> 'kind', jsonb_array_length(v_recs), v_res);
  update semis_logi_private.edu_hits set ok = true
   where id = (select max(h.id) from semis_logi_private.edu_hits h where h.ip = v_ip and h.kind = 'submit');
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values ('edu', 'edu_submit', jsonb_build_object('code', l.code, 'name', v_name, 'pid', mg ->> 'pid', 'kind', mg ->> 'kind',
          'recs', jsonb_array_length(v_recs), 'target', l.target), v_ip);
  return v_res;
end $$;

/* 이수증 판독 전 확인 — 파일 함수(서비스 권한)만. 표 · 경로(같은 링크) · 판독 횟수(파일 3 · 표 30), 판독에 쓸 과정 목록 */
alter table semis_logi_private.edu_uploads add column if not exists reads int not null default 0;
create or replace function public.semis_logi_edu_read_ok(p_ticket text, p_path text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare k semis_logi_private.edu_tickets%rowtype; l semis_logi_private.edu_links%rowtype; u semis_logi_private.edu_uploads%rowtype; n int; t jsonb;
begin
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{48}$' then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  select * into k from semis_logi_private.edu_tickets x
   where x.ticket_hash = encode(extensions.digest(p_ticket, 'sha256'), 'hex') and x.expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'ticket'); end if;
  select * into l from semis_logi_private.edu_links x where x.code = k.code;
  if not found or not l.active or l.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  select * into u from semis_logi_private.edu_uploads x where x.path = p_path and x.code = k.code for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'path'); end if;
  if u.reads >= 3 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  select coalesce(sum(x.reads), 0) into n from semis_logi_private.edu_uploads x where x.ticket_hash = k.ticket_hash;
  if n >= 30 then return jsonb_build_object('ok', false, 'error', 'too_many'); end if;
  update semis_logi_private.edu_uploads x set reads = x.reads + 1 where x.path = p_path;
  select s.value into t from public.semis_logi_store s where s.key = l.target;
  return jsonb_build_object('ok', true, 'type', u.type, 'size', u.size,
    'courses', coalesce((select jsonb_agg(jsonb_build_object('id', c ->> 'id', 'name', c ->> 'name', 'kind', c ->> 'kind', 'roles', c -> 'roles'))
                           from jsonb_array_elements(semis_logi_private.edu_courses(t)) c), '[]'::jsonb));
end $$;

/* ═════════════ 관리 (안전보안파트 hq 이상) ═════════════ */
create or replace function semis_logi_private.edu_admin() returns table(account_id text, login_id text, rank int)
language sql stable security definer set search_path = '' as $$
  select c.account_id, c.login_id, c.rank from semis_logi_private.ctx() c where c.kind = 'user' and c.rank >= 3 limit 1
$$;
create or replace function semis_logi_private.edu_link_json(l semis_logi_private.edu_links) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', l.code, 'title', l.title, 'note', l.note, 'target', l.target,
    'expires', to_char(l.expires_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'), 'active', l.active,
    'open', l.active and l.expires_at > now(),
    'createdAt', l.created_at, 'createdBy', l.created_by, 'updatedAt', l.updated_at,
    'submits', (select count(*) from semis_logi_private.edu_submits s where s.code = l.code),
    'lastAt', (select max(s.at) from semis_logi_private.edu_submits s where s.code = l.code))
$$;

create or replace function public.semis_logi_edu_links() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_logi_private.edu_admin()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true,
    'links', coalesce((select jsonb_agg(q.j order by q.ca desc)
                         from (select semis_logi_private.edu_link_json(x) as j, x.created_at as ca
                                 from semis_logi_private.edu_links x order by x.created_at desc limit 50) q), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', s.at, 'name', s.name, 'dept', s.dept, 'kind', s.kind,
                                                            'n', s.n_recs, 'pid', s.pid, 'code', s.code) order by s.at desc)
                          from (select * from semis_logi_private.edu_submits order by at desc limit 40) s), '[]'::jsonb));
end $$;

/* 만들기(code 없음: days · title · note) · 고치기(code: active · days(오늘부터 다시) · title · note) */
create or replace function public.semis_logi_edu_link_save(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me record; l semis_logi_private.edu_links%rowtype;
  v_code text := lower(btrim(coalesce(p ->> 'code', '')));
  v_title text := semis_logi_private.edu_str(p ->> 'title', 60);
  v_note text := semis_logi_private.edu_str(p ->> 'note', 200);
  v_days int; v_exp timestamptz; b bytea; i int;
  abc text := 'abcdefghijkmnpqrstuvwxyz23456789';
begin
  select * into me from semis_logi_private.edu_admin();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or v_title is null or v_note is null then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if p ? 'days' then
    begin
      v_days := (p ->> 'days')::int;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid');
    end;
    if v_days < 1 or v_days > 365 then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
    v_exp := ((semis_logi_private.edu_today() + v_days)::timestamp + time '23:59:59') at time zone 'Asia/Seoul';
  end if;

  if v_code = '' then
    if v_exp is null then v_exp := ((semis_logi_private.edu_today() + 30)::timestamp + time '23:59:59') at time zone 'Asia/Seoul'; end if;
    loop
      b := extensions.gen_random_bytes(12);
      v_code := '';
      for i in 0 .. 11 loop v_code := v_code || substr(abc, (get_byte(b, i) % 32) + 1, 1); end loop;
      exit when not exists (select 1 from semis_logi_private.edu_links x where x.code = v_code);
    end loop;
    insert into semis_logi_private.edu_links(code, title, note, target, expires_at, created_by, updated_by)
    values (v_code, v_title, v_note, case when p ->> 'target' = 'eduTest' and me.rank >= 4 then 'eduTest' else 'training' end,
            v_exp, coalesce(me.login_id, ''), coalesce(me.login_id, ''))
    returning * into l;
    insert into semis_logi_private.audit(actor, action, detail, ip)
    values (me.account_id, 'edu_link_add', jsonb_build_object('code', l.code, 'target', l.target, 'expires', l.expires_at), semis_logi_private.client_ip());
    return jsonb_build_object('ok', true, 'link', semis_logi_private.edu_link_json(l));
  end if;

  select * into l from semis_logi_private.edu_links x where x.code = v_code for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update semis_logi_private.edu_links x set
    title = case when p ? 'title' then v_title else x.title end,
    note = case when p ? 'note' then v_note else x.note end,
    active = case when p ? 'active' then (p ->> 'active') = 'true' else x.active end,
    expires_at = coalesce(v_exp, x.expires_at),
    updated_at = now(), updated_by = coalesce(me.login_id, '')
   where x.code = v_code
   returning * into l;
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values (me.account_id, 'edu_link_edit', jsonb_build_object('code', l.code, 'active', l.active, 'expires', l.expires_at), semis_logi_private.client_ip());
  return jsonb_build_object('ok', true, 'link', semis_logi_private.edu_link_json(l));
end $$;

/* ─── 실행 권한 ───
   비공개 보조 함수는 API로 부를 수 없게. 공개 RPC 는 anon · service_role(함수 안에서 링크 · 표 · 세션 확인),
   업로드 기록(claim)은 파일 함수의 서비스 권한만 */
revoke all on function semis_logi_private.edu_emp_key(text) from public, anon, authenticated;
revoke all on function semis_logi_private.edu_date(text), semis_logi_private.edu_today(), semis_logi_private.edu_rid(text),
  semis_logi_private.edu_str(text, int), semis_logi_private.edu_limit(text, text), semis_logi_private.edu_link_check(text, text),
  semis_logi_private.edu_courses(jsonb), semis_logi_private.edu_merge(jsonb, jsonb, jsonb), semis_logi_private.edu_admin(),
  semis_logi_private.edu_link_json(semis_logi_private.edu_links) from public, anon, authenticated;
revoke execute on function public.semis_logi_edu_info(text), public.semis_logi_edu_ticket(text, jsonb),
  public.semis_logi_edu_submit(text, text, jsonb), public.semis_logi_edu_links(), public.semis_logi_edu_link_save(jsonb),
  public.semis_logi_edu_claim(text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.semis_logi_edu_info(text), public.semis_logi_edu_ticket(text, jsonb),
  public.semis_logi_edu_submit(text, text, jsonb), public.semis_logi_edu_links(), public.semis_logi_edu_link_save(jsonb)
  to anon, service_role;
grant execute on function public.semis_logi_edu_claim(text, text, text, bigint, text) to service_role;
revoke execute on function public.semis_logi_edu_read_ok(text, text) from public, anon, authenticated;
grant execute on function public.semis_logi_edu_read_ok(text, text) to service_role;
