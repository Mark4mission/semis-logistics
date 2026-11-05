/* ═══════════════════════════════════════════════════════
   H:drive — K드라이브(사내 네트워크 드라이브) ↔ H:drive 양방향 동기화
   - 동기화한 자료는 양쪽 모두 평소 자료: K 에서 온 파일 = 그 화면 문서함의 일반 문서(공용 행 docs), H 문서 = K 폴더의 일반 파일.
   - 실행은 Mac 에이전트(tools/ksync — 나가는 HTTPS 만) → Edge semis-logi-ksync(키 sha256 · 접속 IP 를 넘김) →
     public.semis_logi_ksync_agent(서비스 권한만) → semis_logi_private.ksync_*.
     PostgREST 는 public 스키마 함수만 부를 수 있어 입구 하나만 public 에 두고 나머지는 비공개 스키마에 둔다.
   - 감시 · 관리 RPC public.semis_logi_ksync_* 는 시스템관리자(rank 4) 세션만 — 아니면 42501.
   - 외부 침입 방어: 키는 sha256 만 저장 · 허용 IP(회사 출구) 밖은 거절(연결 안 됨 보고 net 만 예외) · 비어 있으면 hello 만 받고 후보 IP 로 ·
     키 실패 IP 당 15분 10회 → 1시간 차단 · 분당 호출 · 하루 전송량 상한 · 연결된 화면 · 분류 문서만 · 대량 변경 보류(서버도 셈) ·
     K 로 가는 실행 파일 차단 · 해시 불일치 거절 · 모든 실행 · 보안 이벤트 기록(180일).
   - 문서함 반영은 공용 행 docs 를 for update 로 잠근 뒤 고친다. updated_at 은 트리거가 찍는다(되돌리지 않는다) —
     열린 화면의 다음 저장은 409 → 병합으로 이어진다. 관리자 세션에서 고칠 때는 잠근 행의 updated_at 을 base_at 으로 넘긴다.
   - 적용: 마이그레이션 semis_logi_security_30_ksync. 이 파일이 원본(다시 실행해도 같은 결과).
     검증: node tools/sql/semis-logi-ksync.test.mjs tools/sql/semis-logi-ksync.sql (PGlite + pgcrypto)
   ═══════════════════════════════════════════════════════ */

/* ─── 표 ─── */
create table if not exists semis_logi_private.ksync_agents (
  id           bigserial primary key,
  name         text not null default '',
  key_hash     text not null unique,                   -- sha256(키 원문) — 원문은 저장하지 않는다
  created_at   timestamptz not null default now(),
  created_by   text not null default '',
  revoked_at   timestamptz,
  last_seen_at timestamptz,
  last_ip      text,
  version      text not null default '',
  host_label   text not null default '',
  min_at       timestamptz,                            -- 분당 호출 칸
  min_n        int not null default 0,
  day_kst      date,                                   -- 하루 전송량 칸
  day_bytes    bigint not null default 0
);
create table if not exists semis_logi_private.ksync_maps (
  id          bigserial primary key,
  k_path      text not null,                           -- 공유 안 상대 경로
  mod         text not null,
  grp         text not null,
  dir         text not null default 'both' check (dir in ('both', 'k2h', 'h2k')),
  ssi         boolean not null default false,
  state       text not null default 'preview' check (state in ('preview', 'active', 'paused')),
  preview     jsonb,                                   -- 미리보기 건수 { k2h, h2k, link, del, conflict, skip, total, at }
  hold        jsonb,                                   -- 대량 변경 보류 { run, at, n, base, ok? }
  n_files     int not null default 0,
  last_run_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  unique (mod, grp)
);
create unique index if not exists ksync_maps_kpath on semis_logi_private.ksync_maps(lower(k_path));
create table if not exists semis_logi_private.ksync_files (
  id        bigserial primary key,
  map_id    bigint not null references semis_logi_private.ksync_maps(id) on delete cascade,
  rel_path  text not null,                             -- 연결 폴더 안 경로(NFC)
  k_size    bigint,
  k_mtime   timestamptz,
  k_sha256  text,
  doc_id    text,
  ser       text,                                      -- 판 묶음 키(문서의 ser, 없으면 문서 id)
  h_url     text,
  h_name    text,
  h_size    bigint,
  synced_at timestamptz,
  state     text not null default 'ok' check (state in ('ok', 'del_k', 'del_h', 'conflict', 'skip', 'error', 'restore', 'trash')),
  note      text not null default '',
  unique (map_id, rel_path)
);
create table if not exists semis_logi_private.ksync_runs (
  id         bigserial primary key,
  agent_id   bigint,
  ip         text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  result     text check (result in ('ok', 'partial', 'fail', 'offline', 'held')),   -- null = 실행 중
  trigger    text not null default 'daily' check (trigger in ('daily', 'net', 'manual')),
  k2h        int not null default 0,
  h2k        int not null default 0,
  conflicts  int not null default 0,
  skipped    int not null default 0,
  errors     int not null default 0,
  msg        text not null default '',
  detail     jsonb not null default '[]'::jsonb,       -- 최근 200줄 { m, f, a, r } — 파일명 · 동작 · 이유만
  cnt        jsonb not null default '{}'::jsonb        -- 연결별 변경 · 삭제 대기 수(대량 변경 보류 — 서버가 셈)
);
create index if not exists ksync_runs_at on semis_logi_private.ksync_runs(started_at desc);
create table if not exists semis_logi_private.ksync_folders (
  agent_id bigint not null,
  path     text not null,
  depth    int not null,
  n_files  int not null default 0,
  seen_at  timestamptz not null default now(),
  primary key (agent_id, path)
);
create table if not exists semis_logi_private.ksync_events (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  kind     text not null check (kind in ('bad_key', 'ip_denied', 'revoked_key', 'rate', 'mass_hold', 'type_block', 'hash_mismatch', 'scope')),
  ip       text,
  agent_id bigint,
  detail   jsonb not null default '{}'::jsonb
);
create index if not exists ksync_events_ip on semis_logi_private.ksync_events(ip, kind, at);
create index if not exists ksync_events_at on semis_logi_private.ksync_events(at desc);
create table if not exists semis_logi_private.ksync_state (
  id           int primary key default 1 check (id = 1),
  requested_at timestamptz,                            -- '지금 동기화 요청'
  daily_at     text not null default '08:30' check (daily_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  net          jsonb not null default '{}'::jsonb,     -- { ok, at, msg }
  ip_allow     jsonb not null default '[]'::jsonb,     -- 회사 출구 IP(CIDR)
  ip_seen      jsonb not null default '[]'::jsonb,     -- 후보 IP { ip, at, agent }
  mass_limit   jsonb not null default '{"files": 200, "ratio": 0.3, "min": 20}'::jsonb,
  limits       jsonb not null default '{"perMin": 300, "dayBytes": 5368709120}'::jsonb,
  ev_seen_at   timestamptz
);
insert into semis_logi_private.ksync_state(id) values (1) on conflict (id) do nothing;
create table if not exists semis_logi_private.ksync_uploads (    -- 올리기 시작(put begin) → 확인(verify — 저장소에서 다시 잼) → 등록(apply — 문서함 한 번에)
  path     text primary key,
  agent_id bigint not null,
  run_id   bigint not null,
  map_id   bigint not null,
  rel_path text not null,
  size     bigint not null,
  sha256   text not null,
  mtime    timestamptz not null,
  mode     text not null check (mode in ('new', 'version', 'old')),
  row_id   bigint,
  state    text not null default 'ok',
  verified boolean not null default false,
  at       timestamptz not null default now()
);
alter table semis_logi_private.ksync_uploads add column if not exists verified boolean not null default false;
create table if not exists semis_logi_private.ksync_fails (      -- 키 실패(IP 차단 셈 — 기록 표 ksync_events 와 따로, 1시간만)
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists ksync_fails_ip on semis_logi_private.ksync_fails(ip, at);

do $$
declare t text;
begin
  foreach t in array array['ksync_agents', 'ksync_maps', 'ksync_files', 'ksync_runs', 'ksync_folders', 'ksync_events', 'ksync_state', 'ksync_uploads', 'ksync_fails'] loop
    execute format('alter table semis_logi_private.%I enable row level security', t);
    execute format('revoke all on semis_logi_private.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence semis_logi_private.ksync_agents_id_seq, semis_logi_private.ksync_maps_id_seq, semis_logi_private.ksync_files_id_seq,
  semis_logi_private.ksync_runs_id_seq, semis_logi_private.ksync_events_id_seq from public, anon, authenticated;

/* ─── 공통 도우미 ─── */
create or replace function semis_logi_private.ksync_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function semis_logi_private.ksync_txt(p text, n int) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g')), n)
$$;

create or replace function semis_logi_private.ksync_inet(p text) returns inet
language plpgsql immutable set search_path = '' as $$
begin
  return p::inet;
exception when others then
  return null;
end $$;

create or replace function semis_logi_private.ksync_ip_in(p_ip text, p_allow jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare a text; v inet := semis_logi_private.ksync_inet(p_ip);
begin
  if v is null or jsonb_typeof(p_allow) is distinct from 'array' then return false; end if;
  for a in select jsonb_array_elements_text(p_allow) loop
    begin
      if v <<= a::inet then return true; end if;
    exception when others then null;
    end;
  end loop;
  return false;
end $$;

/* 시스템관리자 세션 이름 — 아니면 42501 */
create or replace function semis_logi_private.ksync_admin() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select coalesce(nullif(c.name, ''), c.login_id, 'admin') into v
    from semis_logi_private.ctx() c where c.kind = 'user' and c.rank >= 4 limit 1;
  if v is null then raise exception using errcode = '42501', message = 'semis_ksync_admin'; end if;
  return left(v, 60);
end $$;

create or replace function semis_logi_private.ksync_event(p_kind text, p_ip text, p_agent bigint, p_detail jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  -- 같은 파일의 형식 차단은 30일에 한 번(매일 같은 경고가 쌓이지 않게)
  if p_kind = 'type_block' and exists (select 1 from semis_logi_private.ksync_events e where e.kind = 'type_block' and e.at > now() - interval '30 days'
                                         and e.detail ->> 'map' = p_detail ->> 'map' and e.detail ->> 'f' = p_detail ->> 'f') then
    return;
  end if;
  insert into semis_logi_private.ksync_events(kind, ip, agent_id, detail)
  values (p_kind, left(coalesce(p_ip, ''), 64), p_agent, coalesce(p_detail, '{}'::jsonb));
  delete from semis_logi_private.ksync_events where at < now() - interval '180 days';
end $$;

/* 연결 폴더 안 경로 — 상대 경로 · NFC · 상위 이동 · 숨김 표시 · 제어문자 · 드라이브 표시 금지. 틀리면 null */
create or replace function semis_logi_private.ksync_rel(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text; seg text;
begin
  if p is null then return null; end if;
  s := normalize(p, NFC);
  if length(s) < 1 or length(s) > 300 or s ~ '[[:cntrl:]\\:]' or left(s, 1) = '/' or right(s, 1) = '/' then return null; end if;
  foreach seg in array string_to_array(s, '/') loop
    if seg = '' or seg = '.' or seg = '..' or length(seg) > 160 then return null; end if;
  end loop;
  return s;
end $$;
create or replace function semis_logi_private.ksync_base(p text) returns text
language sql immutable set search_path = '' as $$ select regexp_replace(coalesce(p, ''), '^.*/', '') $$;
create or replace function semis_logi_private.ksync_stem(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(regexp_replace(semis_logi_private.ksync_base(p), '\.[^.]{1,10}$', ''), ''), semis_logi_private.ksync_base(p))
$$;
/* H 로 올리지 않는 형식(파일 함수 semis-logi-files 의 BLOCK_TYPES 와 같은 뜻) */
create or replace function semis_logi_private.ksync_h_blocked(p_name text) returns boolean
language sql immutable set search_path = '' as $$ select lower(coalesce(p_name, '')) ~ '\.(html?|xht(ml)?|m?js)$' $$;
/* K 로 쓰지 않는 형식 — 실행 파일 · 스크립트 · 바로 가기 */
create or replace function semis_logi_private.ksync_k_blocked(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(coalesce(p_name, '')) ~ '\.(exe|bat|cmd|com|scr|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|sh|command|app|jar|lnk|url|hta|html?|pif|cpl|reg|dll)$'
$$;
/* 표준 파일 주소 → 저장소 경로 */
create or replace function semis_logi_private.ksync_url_path(p_url text) returns text
language sql immutable set search_path = '' as $$
  select x[1] from (select regexp_match(coalesce(p_url, ''), '^https://[A-Za-z0-9.-]+/storage/v1/object/public/semis-logi-files/([A-Za-z0-9._/-]+)$') x) q
   where length(x[1]) between 3 and 300 and x[1] !~ '(^|/)\.\.?(/|$)'
$$;
create or replace function semis_logi_private.ksync_date(p timestamptz) returns text
language sql immutable set search_path = '' as $$ select to_char(p at time zone 'Asia/Seoul', 'YYYY-MM-DD') $$;

/* ─── 문서함(공용 행 docs) ─── */
create or replace function semis_logi_private.ksync_docs_lock() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  select s.value into v from public.semis_logi_store s where s.key = 'docs' for update;
  return case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end;
end $$;
create or replace function semis_logi_private.ksync_docs_save(p jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  -- base_at = 잠근 행의 updated_at: 관리자 세션에서 불려도 충돌 확인(check_base)을 정상으로 지난다. updated_at 은 트리거가 새로 찍는다
  update public.semis_logi_store set value = p, updated_by = 'ksync', base_at = updated_at where key = 'docs';
  if not found then insert into public.semis_logi_store(key, value, updated_by) values ('docs', p, 'ksync'); end if;
end $$;
/* 판 묶음의 현재 판 — 문서함(js/docshelf.js byDate)처럼 날짜 내림 · 제목 · 배열 순서 */
create or replace function semis_logi_private.ksync_cur(p_docs jsonb, p_mod text, p_grp text, p_ser text) returns jsonb
language sql stable set search_path = '' as $$
  select x.value from jsonb_array_elements(p_docs) with ordinality x(value, idx)
   where jsonb_typeof(x.value) = 'object' and x.value ->> 'mod' = p_mod and coalesce(x.value ->> 'grp', '') = p_grp
     and coalesce(nullif(x.value ->> 'ser', ''), x.value ->> 'id') = p_ser
   order by coalesce(x.value ->> 'date', '') desc, coalesce(x.value ->> 'title', '') collate "C", x.idx
   limit 1
$$;
/* H 쪽 현재 판 목록 — 판 묶음마다 현재 판의 파일 하나씩 */
create or replace function semis_logi_private.ksync_h_items(p_docs jsonb, p_map semis_logi_private.ksync_maps) returns jsonb
language sql stable set search_path = '' as $$
  with d as (
    select x.value as doc, x.idx, coalesce(nullif(x.value ->> 'ser', ''), x.value ->> 'id') as ser
      from jsonb_array_elements(p_docs) with ordinality x(value, idx)
     where jsonb_typeof(x.value) = 'object' and x.value ->> 'mod' = p_map.mod and coalesce(x.value ->> 'grp', '') = p_map.grp
       and coalesce(x.value ->> 'id', '') <> ''
  ), r as (
    select d.*, row_number() over (partition by d.ser order by coalesce(d.doc ->> 'date', '') desc, coalesce(d.doc ->> 'title', '') collate "C", d.idx) as rn from d
  )
  select coalesce(jsonb_agg(jsonb_build_object('doc', r.doc ->> 'id', 'ser', r.ser, 'title', coalesce(r.doc ->> 'title', ''),
           'date', coalesce(r.doc ->> 'date', ''), 'at', coalesce(r.doc ->> 'at', ''), 'ssi', coalesce((r.doc ->> 'ssi')::boolean, false),
           'name', f.value ->> 'name', 'size', case when coalesce(f.value ->> 'size', '') ~ '^[0-9]{1,12}$' then (f.value ->> 'size')::bigint else 0 end,
           'url', f.value ->> 'url') order by r.ser, f.idx), '[]'::jsonb)
    from r, jsonb_array_elements(case when jsonb_typeof(r.doc -> 'files') = 'array' then r.doc -> 'files' else '[]'::jsonb end) with ordinality f(value, idx)
   where r.rn = 1 and jsonb_typeof(f.value) = 'object' and coalesce(f.value ->> 'name', '') <> ''
     and semis_logi_private.ksync_url_path(f.value ->> 'url') is not null
     and (p_map.ssi or (not coalesce((r.doc ->> 'ssi')::boolean, false) and semis_logi_private.ksync_url_path(f.value ->> 'url') not like 'docs-ssi/%'))
$$;
/* 연결 범위 안 문서의 파일인지 — 범위 밖 · 민감보안정보(SSI 연결 아님)는 null */
create or replace function semis_logi_private.ksync_doc_file(p_docs jsonb, p_map semis_logi_private.ksync_maps, p_doc text, p_url text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('doc', d.value, 'file', f.value)
    from jsonb_array_elements(p_docs) d, jsonb_array_elements(case when jsonb_typeof(d.value -> 'files') = 'array' then d.value -> 'files' else '[]'::jsonb end) f
   where jsonb_typeof(d.value) = 'object' and d.value ->> 'id' = p_doc and d.value ->> 'mod' = p_map.mod and coalesce(d.value ->> 'grp', '') = p_map.grp
     and f.value ->> 'url' = p_url and semis_logi_private.ksync_url_path(p_url) is not null
     and (p_map.ssi or (not coalesce((d.value ->> 'ssi')::boolean, false) and semis_logi_private.ksync_url_path(p_url) not like 'docs-ssi/%'))
   limit 1
$$;

/* ─── 에이전트 확인 — 키 · IP · 횟수 ─── */
create or replace function semis_logi_private.ksync_auth(p_hash text, p_ip text, p_act text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a semis_logi_private.ksync_agents; st semis_logi_private.ksync_state; v_fail int; v_min timestamptz := date_trunc('minute', now());
  v_per int; v_seen jsonb;
begin
  -- 키 실패로 막힌 IP — 1시간 동안 아무것도 받지 않는다(기록도 남기지 않음 — 표가 불어나지 않게)
  if exists (select 1 from semis_logi_private.ksync_events e where e.ip = left(coalesce(p_ip, ''), 64) and e.kind = 'rate'
              and e.detail ->> 'why' = 'key' and e.at > now() - interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;
  if coalesce(p_hash, '') ~ '^[0-9a-f]{64}$' then
    select * into a from semis_logi_private.ksync_agents x where x.key_hash = p_hash for update;
  end if;
  if a.id is null or a.revoked_at is not null then
    -- 차단 셈은 따로(1시간만 둠) — 기록 표의 상한과 관계없이 IP 마다 늘 센다
    insert into semis_logi_private.ksync_fails(ip) values (left(coalesce(p_ip, ''), 64));
    delete from semis_logi_private.ksync_fails where at < now() - interval '1 hour';
    select count(*) into v_fail from semis_logi_private.ksync_fails f where f.ip = left(coalesce(p_ip, ''), 64) and f.at > now() - interval '15 minutes';
    -- 기록은 IP 마다 15분에 한 줄 · 전체 15분 500줄까지(여러 IP 로 표를 불리지 못하게)
    if not exists (select 1 from semis_logi_private.ksync_events e where e.ip = left(coalesce(p_ip, ''), 64) and e.kind in ('bad_key', 'revoked_key')
                    and e.at > now() - interval '15 minutes')
       and (select count(*) from semis_logi_private.ksync_events e where e.kind in ('bad_key', 'revoked_key') and e.at > now() - interval '15 minutes') < 500 then
      perform semis_logi_private.ksync_event(case when a.id is null then 'bad_key' else 'revoked_key' end, p_ip, a.id, jsonb_build_object('act', left(coalesce(p_act, ''), 12)));
    end if;
    if v_fail > 10 then perform semis_logi_private.ksync_event('rate', p_ip, a.id, jsonb_build_object('why', 'key', 'n', v_fail)); end if;
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  select * into st from semis_logi_private.ksync_state where id = 1;
  -- 허용 IP: 연결 안 됨 보고(net)는 회사 밖에서 오므로 예외(바꿀 수 있는 것은 '연결 안 됨' 표시 하나). 목록이 비면 hello 만
  if p_act <> 'net' and not semis_logi_private.ksync_ip_in(p_ip, st.ip_allow) then
    v_seen := coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(st.ip_seen) x where x ->> 'ip' <> left(coalesce(p_ip, ''), 64) limit 9) q), '[]'::jsonb);
    update semis_logi_private.ksync_state set ip_seen = jsonb_build_array(jsonb_build_object('ip', left(coalesce(p_ip, ''), 64), 'at', now(), 'agent', a.id)) || v_seen where id = 1;
    if p_act = 'hello' and jsonb_array_length(st.ip_allow) = 0 then
      update semis_logi_private.ksync_agents set last_seen_at = now(), last_ip = left(coalesce(p_ip, ''), 64) where id = a.id;
      return jsonb_build_object('ok', true, 'agent', a.id, 'allow', false);
    end if;
    if not exists (select 1 from semis_logi_private.ksync_events e where e.kind = 'ip_denied' and e.ip = left(coalesce(p_ip, ''), 64) and e.at > now() - interval '10 minutes') then
      perform semis_logi_private.ksync_event('ip_denied', p_ip, a.id, jsonb_build_object('act', left(coalesce(p_act, ''), 12)));
    end if;
    return jsonb_build_object('ok', false, 'error', 'ip');
  end if;
  v_per := coalesce(nullif(st.limits ->> 'perMin', '')::int, 300);
  if a.min_at = v_min then
    if a.min_n >= v_per then
      if a.min_n = v_per then perform semis_logi_private.ksync_event('rate', p_ip, a.id, jsonb_build_object('why', 'min', 'n', v_per)); end if;
      update semis_logi_private.ksync_agents set min_n = min_n + 1 where id = a.id;
      return jsonb_build_object('ok', false, 'error', 'rate');
    end if;
    update semis_logi_private.ksync_agents set min_n = min_n + 1, last_seen_at = now(), last_ip = left(coalesce(p_ip, ''), 64) where id = a.id;
  else
    update semis_logi_private.ksync_agents set min_at = v_min, min_n = 1, last_seen_at = now(), last_ip = left(coalesce(p_ip, ''), 64) where id = a.id;
  end if;
  return jsonb_build_object('ok', true, 'agent', a.id, 'allow', true);
end $$;

/* 하루 전송량 — 넘으면 false */
create or replace function semis_logi_private.ksync_quota(p_agent bigint, p_bytes bigint, p_ip text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare a semis_logi_private.ksync_agents; lim bigint; d date := semis_logi_private.ksync_today(); cur bigint;
begin
  select * into a from semis_logi_private.ksync_agents where id = p_agent for update;
  lim := coalesce(nullif((select s.limits ->> 'dayBytes' from semis_logi_private.ksync_state s where s.id = 1), '')::bigint, 5368709120);
  cur := case when a.day_kst = d then a.day_bytes else 0 end;
  if cur + greatest(p_bytes, 0) > lim then
    if cur <= lim and not exists (select 1 from semis_logi_private.ksync_events e where e.kind = 'rate' and e.agent_id = p_agent
                                   and e.detail ->> 'why' = 'day' and e.at > now() - interval '1 day') then
      perform semis_logi_private.ksync_event('rate', p_ip, p_agent, jsonb_build_object('why', 'day'));
    end if;
    return false;
  end if;
  update semis_logi_private.ksync_agents set day_kst = d, day_bytes = cur + greatest(p_bytes, 0) where id = p_agent;
  return true;
end $$;

/* 실행 중인 이 에이전트의 회차 */
create or replace function semis_logi_private.ksync_run_of(p_agent bigint, p jsonb) returns bigint
language sql stable security definer set search_path = '' as $$
  select r.id from semis_logi_private.ksync_runs r
   where r.id = case when coalesce(p ->> 'run', '') ~ '^[0-9]{1,15}$' then (p ->> 'run')::bigint end
     and r.agent_id = p_agent and r.result is null and r.started_at > now() - interval '12 hours'
$$;
create or replace function semis_logi_private.ksync_map_of(p jsonb) returns semis_logi_private.ksync_maps
language sql stable security definer set search_path = '' as $$
  select m.* from semis_logi_private.ksync_maps m
   where m.id = case when coalesce(p ->> 'map', '') ~ '^[0-9]{1,15}$' then (p ->> 'map')::bigint end
$$;
/* 대량 변경 보류 — 한 회차 · 한 연결의 변경 · 삭제 대기가 한도를 넘으면 그 연결은 보류(승인 전까지) */
create or replace function semis_logi_private.ksync_limit_hit(p_n int, p_base int, p_lim jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p_n > coalesce(nullif(p_lim ->> 'files', '')::int, 200)
      or (p_base > 0 and p_n >= coalesce(nullif(p_lim ->> 'min', '')::int, 20)
          and p_n::numeric / p_base > coalesce(nullif(p_lim ->> 'ratio', '')::numeric, 0.3))
$$;
create or replace function semis_logi_private.ksync_count(p_agent bigint, p_run bigint, p_map semis_logi_private.ksync_maps, p_ip text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare n int; base int; lim jsonb;
begin
  if coalesce((p_map.hold ->> 'ok')::boolean, false) then return true; end if;
  if p_map.hold is not null then return false; end if;     -- 승인 전 보류는 새 회차에도 그대로
  update semis_logi_private.ksync_runs set cnt = jsonb_set(cnt, array[p_map.id::text], to_jsonb(coalesce((cnt ->> p_map.id::text)::int, 0) + 1))
   where id = p_run returning (cnt ->> p_map.id::text)::int into n;
  select count(*) into base from semis_logi_private.ksync_files f where f.map_id = p_map.id and f.k_sha256 is not null and f.h_url is not null;
  select s.mass_limit into lim from semis_logi_private.ksync_state s where s.id = 1;
  if not semis_logi_private.ksync_limit_hit(n, base, lim) then return true; end if;
  if p_map.hold is null then
    update semis_logi_private.ksync_maps set hold = jsonb_build_object('run', p_run, 'at', now(), 'n', n, 'base', base, 'srv', true) where id = p_map.id;
    perform semis_logi_private.ksync_event('mass_hold', p_ip, p_agent, jsonb_build_object('map', p_map.id, 'n', n, 'base', base, 'run', p_run));
  end if;
  return false;
end $$;

/* ─── 에이전트 동작 ─── */
create or replace function semis_logi_private.ksync_hello(p_agent bigint, p_allow boolean, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare st semis_logi_private.ksync_state; m semis_logi_private.ksync_maps; maps jsonb := '[]'::jsonb; lists jsonb := '[]'::jsonb; docs jsonb;
begin
  update semis_logi_private.ksync_agents
     set version = case when coalesce(p ->> 'ver', '') ~ '^[0-9A-Za-z.+-]{1,20}$' then p ->> 'ver' else version end,
         host_label = case when p ? 'host' then semis_logi_private.ksync_txt(p ->> 'host', 60) else host_label end
   where id = p_agent;
  select * into st from semis_logi_private.ksync_state where id = 1;
  if not p_allow then
    return jsonb_build_object('ok', true, 'allow', false, 'now', now(), 'daily_at', st.daily_at);
  end if;
  update semis_logi_private.ksync_state set net = jsonb_build_object('ok', true, 'at', now(), 'msg', '') where id = 1;
  if coalesce((p ->> 'full')::boolean, false) then docs := semis_logi_private.ksync_docs_lock_free(); end if;
  for m in select * from semis_logi_private.ksync_maps order by id loop
    maps := maps || jsonb_build_array(jsonb_build_object('id', m.id, 'k_path', m.k_path, 'mod', m.mod, 'grp', m.grp, 'dir', m.dir, 'ssi', m.ssi,
      'state', m.state, 'hold', m.hold));
    if docs is not null and m.state <> 'paused' then
      lists := lists || jsonb_build_array(jsonb_build_object('map', m.id,
        'h', semis_logi_private.ksync_h_items(docs, m),
        'base', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'rel_path', f.rel_path, 'k_size', f.k_size, 'k_mtime', f.k_mtime, 'k_sha256', f.k_sha256,
          'doc_id', f.doc_id, 'ser', f.ser, 'h_url', f.h_url, 'h_name', f.h_name, 'h_size', f.h_size, 'state', f.state, 'note', f.note) order by f.rel_path)
          from semis_logi_private.ksync_files f where f.map_id = m.id), '[]'::jsonb)));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'allow', true, 'now', now(), 'daily_at', st.daily_at,
    'requested', st.requested_at is not null, 'requested_at', st.requested_at, 'mass_limit', st.mass_limit, 'maps', maps)
    || case when docs is not null then jsonb_build_object('lists', lists) else '{}'::jsonb end;
end $$;
/* 읽기만 할 때(잠그지 않음) */
create or replace function semis_logi_private.ksync_docs_lock_free() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when jsonb_typeof(s.value) = 'array' then s.value end from public.semis_logi_store s where s.key = 'docs'), '[]'::jsonb)
$$;

create or replace function semis_logi_private.ksync_net(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ok boolean := coalesce((p ->> 'ok')::boolean, false); v_msg text := semis_logi_private.ksync_txt(p ->> 'msg', 120); r record;
begin
  update semis_logi_private.ksync_state set net = jsonb_build_object('ok', v_ok, 'at', now(), 'msg', v_msg) where id = 1;
  if not v_ok then
    -- 하루 한 줄(다시 보고하면 그 줄의 끝 시각만 바꿈)
    select x.id, x.result, x.started_at into r from semis_logi_private.ksync_runs x where x.agent_id = p_agent order by x.started_at desc limit 1;
    if r.id is not null and r.result = 'offline' and semis_logi_private.ksync_date(r.started_at) = semis_logi_private.ksync_date(now()) then
      update semis_logi_private.ksync_runs set ended_at = now(), msg = v_msg where id = r.id;
    else
      insert into semis_logi_private.ksync_runs(agent_id, ip, ended_at, result, trigger, msg)
      values (p_agent, left(coalesce(p_ip, ''), 64), now(), 'offline', 'daily', v_msg);
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function semis_logi_private.ksync_folders_set(p_agent bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare x jsonb; v text; n int := 0;
begin
  if jsonb_typeof(p -> 'list') is distinct from 'array' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  delete from semis_logi_private.ksync_folders where agent_id = p_agent;
  for x in select value from jsonb_array_elements(p -> 'list') limit 3000 loop
    v := semis_logi_private.ksync_rel(x ->> 'path');
    if v is null or array_length(string_to_array(v, '/'), 1) > 3 then continue; end if;
    insert into semis_logi_private.ksync_folders(agent_id, path, depth, n_files)
    values (p_agent, v, array_length(string_to_array(v, '/'), 1),
            case when coalesce(x ->> 'n', '') ~ '^[0-9]{1,9}$' then (x ->> 'n')::int else 0 end)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

create or replace function semis_logi_private.ksync_preview_set(p_agent bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m semis_logi_private.ksync_maps := semis_logi_private.ksync_map_of(p); c jsonb := p -> 'counts'; o jsonb := '{}'::jsonb; k text;
begin
  if m.id is null or m.state <> 'preview' or jsonb_typeof(c) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  foreach k in array array['k2h', 'h2k', 'link', 'del', 'conflict', 'skip', 'total'] loop
    o := o || jsonb_build_object(k, case when coalesce(c ->> k, '') ~ '^[0-9]{1,9}$' then (c ->> k)::int else 0 end);
  end loop;
  update semis_logi_private.ksync_maps set preview = o || jsonb_build_object('at', now()) where id = m.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function semis_logi_private.ksync_run(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_run bigint; v_res text; v_det jsonb := '[]'::jsonb; x jsonb; m semis_logi_private.ksync_maps; i int := 0;
  num text := '^[0-9]{1,9}$';
begin
  if p ->> 'phase' = 'start' then
    update semis_logi_private.ksync_runs set result = 'fail', ended_at = now(), msg = '중단됨'
     where agent_id = p_agent and result is null;
    insert into semis_logi_private.ksync_runs(agent_id, ip, trigger)
    values (p_agent, left(coalesce(p_ip, ''), 64), case when p ->> 'trigger' in ('daily', 'net', 'manual') then p ->> 'trigger' else 'daily' end)
    returning id into v_run;
    update semis_logi_private.ksync_state set requested_at = null where id = 1;
    delete from semis_logi_private.ksync_runs where started_at < now() - interval '400 days';
    delete from semis_logi_private.ksync_uploads where at < now() - interval '1 day';
    return jsonb_build_object('ok', true, 'run', v_run);
  end if;
  v_run := semis_logi_private.ksync_run_of(p_agent, p);
  if v_run is null then return jsonb_build_object('ok', false, 'error', 'run'); end if;
  v_res := case when p ->> 'result' in ('ok', 'partial', 'fail', 'held') then p ->> 'result' else 'fail' end;
  if jsonb_typeof(p -> 'detail') = 'array' then
    for x in select value from jsonb_array_elements(p -> 'detail') loop
      exit when i >= 200;
      if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'a', '') !~ '^(k2h|h2k|link|rename|del_k|del_h|conflict|skip|error|trash|restore|held|drop)$' then continue; end if;
      v_det := v_det || jsonb_build_array(jsonb_build_object('m', case when coalesce(x ->> 'm', '') ~ num then (x ->> 'm')::int end,
        'f', semis_logi_private.ksync_txt(x ->> 'f', 200), 'a', x ->> 'a', 'r', semis_logi_private.ksync_txt(x ->> 'r', 40)));
      i := i + 1;
    end loop;
  end if;
  update semis_logi_private.ksync_runs
     set ended_at = now(), result = v_res,
         k2h = case when coalesce(p ->> 'k2h', '') ~ num then (p ->> 'k2h')::int else 0 end,
         h2k = case when coalesce(p ->> 'h2k', '') ~ num then (p ->> 'h2k')::int else 0 end,
         conflicts = case when coalesce(p ->> 'conflicts', '') ~ num then (p ->> 'conflicts')::int else 0 end,
         skipped = case when coalesce(p ->> 'skipped', '') ~ num then (p ->> 'skipped')::int else 0 end,
         errors = case when coalesce(p ->> 'errors', '') ~ num then (p ->> 'errors')::int else 0 end,
         msg = semis_logi_private.ksync_txt(p ->> 'msg', 200), detail = v_det
   where id = v_run;
  -- 연결별 결과: 보류 · 끝남(승인 한 번 씀) · 파일 수
  if jsonb_typeof(p -> 'maps') = 'array' then
    for x in select value from jsonb_array_elements(p -> 'maps') limit 100 loop
      m := semis_logi_private.ksync_map_of(jsonb_build_object('map', x ->> 'id'));
      continue when m.id is null;
      if coalesce((x ->> 'held')::boolean, false) then
        if m.hold is null or not coalesce((m.hold ->> 'ok')::boolean, false) then
          if m.hold is null then
            perform semis_logi_private.ksync_event('mass_hold', p_ip, p_agent, jsonb_build_object('map', m.id, 'run', v_run,
              'n', case when coalesce(x ->> 'n', '') ~ num then (x ->> 'n')::int else 0 end));
          end if;
          -- 보류가 이어지면 처음 보류한 회차는 그대로(대시보드의 [승인]이 그 회차를 가리킴), 건수만 새로
          update semis_logi_private.ksync_maps set hold = coalesce(hold, jsonb_build_object('run', v_run, 'at', now()))
            || jsonb_build_object('n', case when coalesce(x ->> 'n', '') ~ num then (x ->> 'n')::int else 0 end,
                                  'base', case when coalesce(x ->> 'base', '') ~ num then (x ->> 'base')::int else 0 end, 'last', v_run)
           where id = m.id;
        end if;
      elsif m.state = 'active' then
        -- 승인한 보류만, 그 연결을 끝까지 맞췄을 때 지운다(승인 전 보류는 에이전트가 지울 수 없음)
        update semis_logi_private.ksync_maps
           set hold = case when coalesce((hold ->> 'ok')::boolean, false) and coalesce((x ->> 'done')::boolean, false) then null else hold end,
               last_run_at = case when coalesce((x ->> 'done')::boolean, false) then now() else last_run_at end,
               n_files = case when coalesce(x ->> 'n_files', '') ~ num then (x ->> 'n_files')::int else n_files end
         where id = m.id;
      end if;
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end $$;

/* 판 묶음 키 — 문서함 판 묶음 칸처럼 공백을 하나로(문서함에서 저장해도 같은 키) */
create or replace function semis_logi_private.ksync_ser(p text) returns text
language sql immutable set search_path = '' as $$ select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), 300) $$;

/* 올리기 시작 — 파일 이름 부분(무작위 접두사_이름)은 Edge 가 newPath 로 정하고, 폴더(docs · 민감보안정보 docs-ssi)는 여기서 정한다.
   확인(verify) · 등록(apply)은 이 줄이 있어야 된다 */
create or replace function semis_logi_private.ksync_put_begin(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m semis_logi_private.ksync_maps := semis_logi_private.ksync_map_of(p); v_run bigint := semis_logi_private.ksync_run_of(p_agent, p);
  v_rel text := semis_logi_private.ksync_rel(p ->> 'rel_path'); v_size bigint; v_mode text := p ->> 'mode'; v_row bigint; fr semis_logi_private.ksync_files;
  v_part text := p ->> 'part'; v_path text; cur jsonb;
begin
  if v_run is null then return jsonb_build_object('ok', false, 'error', 'run'); end if;
  if m.id is null or v_rel is null or coalesce(v_mode, '') not in ('new', 'version', 'old') then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if coalesce(p ->> 'row', '') ~ '^[0-9]{1,15}$' then
    select * into fr from semis_logi_private.ksync_files f where f.id = (p ->> 'row')::bigint and f.map_id = m.id;
    v_row := fr.id;
  end if;
  -- 실행 중 연결 · K→H 방향만. 복원(restore) 줄은 방향과 관계없이
  if m.state <> 'active' or (m.dir = 'h2k' and coalesce(fr.state, '') <> 'restore') then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  if v_mode in ('version', 'old') and (v_row is null or fr.ser is null) then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  v_size := case when coalesce(p ->> 'size', '') ~ '^[0-9]{1,12}$' then (p ->> 'size')::bigint else -1 end;
  if v_size < 0 then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if v_size > 50 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'too_large'); end if;
  if semis_logi_private.ksync_h_blocked(v_rel) then return jsonb_build_object('ok', false, 'error', 'type'); end if;
  if coalesce(p ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if coalesce(v_part, '') !~ '^[a-z0-9]{12,24}_[A-Za-z0-9._-]{1,80}$' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  begin
    perform (p ->> 'mtime')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad');
  end;
  if fr.ser is not null then cur := semis_logi_private.ksync_cur(semis_logi_private.ksync_docs_lock_free(), m.mod, m.grp, fr.ser); end if;
  -- 기준선 줄이 있는 '새 문서'인데 그 판 묶음이 H 에 남아 있으면 새 판으로 등록하고 변경으로 센다(관리자가 고른 복원은 빼고)
  if v_mode = 'new' and cur is not null then v_mode := 'version'; end if;
  if v_mode = 'version' and coalesce(fr.state, '') <> 'restore' and not semis_logi_private.ksync_count(p_agent, v_run, m, p_ip) then
    return jsonb_build_object('ok', false, 'error', 'held');
  end if;
  -- 민감보안정보 판 묶음에 들어가는 판은 SSI 폴더로(연결이 SSI 가 아니어도)
  v_path := case when m.ssi or coalesce((cur ->> 'ssi')::boolean, false) then 'docs-ssi/' else 'docs/' end || v_part;
  if exists (select 1 from semis_logi_private.ksync_uploads x where x.path = v_path) then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if not semis_logi_private.ksync_quota(p_agent, v_size, p_ip) then return jsonb_build_object('ok', false, 'error', 'quota'); end if;
  insert into semis_logi_private.ksync_uploads(path, agent_id, run_id, map_id, rel_path, size, sha256, mtime, mode, row_id, state)
  values (v_path, p_agent, v_run, m.id, v_rel, v_size, p ->> 'sha256', (p ->> 'mtime')::timestamptz, v_mode, v_row,
          case when p ->> 'state' = 'conflict' then 'conflict' else 'ok' end);
  return jsonb_build_object('ok', true, 'path', v_path);
end $$;

create or replace function semis_logi_private.ksync_put_peek(p_agent bigint, p jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('ok', true, 'size', u.size, 'sha256', u.sha256)
    from semis_logi_private.ksync_uploads u where u.path = p ->> 'path' and u.agent_id = p_agent and not u.verified and u.at > now() - interval '1 hour'),
    jsonb_build_object('ok', false, 'error', 'state'))
$$;

/* 올리기 확인 — Edge 가 저장소에서 다시 읽어 잰 크기 · sha256 이 시작 때 값과 같아야 등록 대기로 둔다(다르면 버리고 기록) */
create or replace function semis_logi_private.ksync_put_verify(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare u semis_logi_private.ksync_uploads;
begin
  select * into u from semis_logi_private.ksync_uploads x where x.path = p ->> 'path' and x.agent_id = p_agent and not x.verified
     and x.at > now() - interval '1 hour' for update;
  if u.path is null then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  if coalesce(p ->> 'sha256', '') <> u.sha256 or coalesce(p ->> 'size', '') <> u.size::text then
    delete from semis_logi_private.ksync_uploads where path = u.path;
    perform semis_logi_private.ksync_event('hash_mismatch', p_ip, p_agent, jsonb_build_object('map', u.map_id, 'f', u.rel_path, 'dir', 'k2h'));
    return jsonb_build_object('ok', false, 'error', 'hash');
  end if;
  update semis_logi_private.ksync_uploads set verified = true where path = u.path;
  return jsonb_build_object('ok', true);
end $$;

/* 등록 — 확인한 올리기를 한 번에 문서함에 넣는다(공용 행 docs 를 한 번만 고침: 이력 · 변경 알림 한 번).
   새 판은 지금 판의 다른 첨부를 그대로 두고 이 파일만 바꾼다. 같은 판 묶음의 여러 파일은 차례로 이어진다 */
create or replace function semis_logi_private.ksync_put_apply(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_run bigint := semis_logi_private.ksync_run_of(p_agent, p); u semis_logi_private.ksync_uploads; m semis_logi_private.ksync_maps;
  fr semis_logi_private.ksync_files; docs jsonb; cur jsonb; nd jsonb; nf jsonb; files jsonb; v_pub text := p ->> 'prefix';
  v_id text; v_ser text; v_name text; v_date text; v_url text; v_hit boolean; out jsonb := '{}'::jsonb; dirty boolean := false;
begin
  if v_run is null then return jsonb_build_object('ok', false, 'error', 'run'); end if;
  if jsonb_typeof(p -> 'paths') is distinct from 'array' or coalesce(v_pub, '') !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/semis-logi-files/$' then
    return jsonb_build_object('ok', false, 'error', 'bad');
  end if;
  for u in select * from semis_logi_private.ksync_uploads x
            where x.agent_id = p_agent and x.verified and x.at > now() - interval '1 hour'
              and x.path in (select jsonb_array_elements_text(p -> 'paths') limit 200)
            order by x.at, x.path for update loop
    select * into m from semis_logi_private.ksync_maps where id = u.map_id;
    continue when m.id is null or m.state <> 'active';
    if not dirty then docs := semis_logi_private.ksync_docs_lock(); dirty := true; end if;
    fr := null;
    if u.row_id is not null then select * into fr from semis_logi_private.ksync_files where id = u.row_id and map_id = m.id; end if;
    v_name := semis_logi_private.ksync_base(u.rel_path);
    v_date := semis_logi_private.ksync_date(u.mtime);
    v_url := v_pub || u.path;
    v_id := 'ks' || encode(extensions.gen_random_bytes(6), 'hex');
    v_ser := coalesce(fr.ser, semis_logi_private.ksync_ser(u.rel_path));
    cur := case when u.mode <> 'new' or fr.ser is not null then semis_logi_private.ksync_cur(docs, m.mod, m.grp, v_ser) end;
    nf := jsonb_build_object('name', v_name, 'size', u.size, 'url', v_url);
    files := jsonb_build_array(nf);
    if u.mode = 'version' and cur is not null and jsonb_typeof(cur -> 'files') = 'array' and jsonb_array_length(cur -> 'files') > 0 then
      -- 이 파일 자리: 기준선 주소 → 이름 → 첨부가 하나뿐이면 그것, 없으면 뒤에 더함
      v_hit := exists (select 1 from jsonb_array_elements(cur -> 'files') f where f ->> 'url' = fr.h_url)
            or exists (select 1 from jsonb_array_elements(cur -> 'files') f where f ->> 'name' = fr.h_name)
            or jsonb_array_length(cur -> 'files') = 1;
      files := case when not v_hit then (cur -> 'files') || jsonb_build_array(nf)
        else (select jsonb_agg(case when (exists (select 1 from jsonb_array_elements(cur -> 'files') g where g ->> 'url' = fr.h_url) and f.value ->> 'url' = fr.h_url)
                                     or (not exists (select 1 from jsonb_array_elements(cur -> 'files') g where g ->> 'url' = fr.h_url)
                                         and (f.value ->> 'name' = fr.h_name or jsonb_array_length(cur -> 'files') = 1))
                                    then nf else f.value end order by f.i)
                from jsonb_array_elements(cur -> 'files') with ordinality f(value, i)) end;
    end if;
    nd := jsonb_build_object('id', v_id, 'mod', m.mod, 'grp', m.grp,
      'title', coalesce(cur ->> 'title', semis_logi_private.ksync_stem(u.rel_path)),
      'date', case when cur is null or coalesce(cur ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then v_date
                   when u.mode = 'old' then least(v_date, cur ->> 'date') else greatest(v_date, cur ->> 'date') end,
      'ser', v_ser, 'org', coalesce(cur ->> 'org', ''), 'note', coalesce(cur ->> 'note', ''),
      'ssi', m.ssi or coalesce((cur ->> 'ssi')::boolean, false) or u.path like 'docs-ssi/%',
      'mids', case when jsonb_typeof(cur -> 'mids') = 'array' then cur -> 'mids' else '[]'::jsonb end,
      'files', files,
      'src', 'ksync', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', 'K드라이브 동기화');
    -- 새 판은 맨 앞(같은 날짜 · 같은 제목이면 배열 앞이 현재 판), 이전 판으로 남길 것과 새 문서는 맨 뒤
    docs := case when u.mode = 'version' then jsonb_build_array(nd) || docs else docs || jsonb_build_array(nd) end;
    if u.mode <> 'old' then
      begin
        if fr.id is not null then
          update semis_logi_private.ksync_files set rel_path = u.rel_path, k_size = u.size, k_mtime = u.mtime, k_sha256 = u.sha256, doc_id = v_id, ser = v_ser,
                 h_url = v_url, h_name = v_name, h_size = u.size, synced_at = now(), state = u.state,
                 note = case when u.state = 'conflict' then 'K 쪽이 늦게 고침' else '' end
           where id = fr.id;
        else
          insert into semis_logi_private.ksync_files(map_id, rel_path, k_size, k_mtime, k_sha256, doc_id, ser, h_url, h_name, h_size, synced_at, state, note)
          values (m.id, u.rel_path, u.size, u.mtime, u.sha256, v_id, v_ser, v_url, v_name, u.size, now(), u.state,
                  case when u.state = 'conflict' then 'K 쪽이 늦게 고침' else '' end)
          on conflict (map_id, rel_path) do update set k_size = excluded.k_size, k_mtime = excluded.k_mtime, k_sha256 = excluded.k_sha256,
            doc_id = excluded.doc_id, ser = excluded.ser, h_url = excluded.h_url, h_name = excluded.h_name, h_size = excluded.h_size,
            synced_at = excluded.synced_at, state = excluded.state, note = excluded.note;
        end if;
      exception when others then null;   -- 기준선만 못 남김 — 다음 실행이 이름 · 크기로 다시 연결
      end;
    end if;
    delete from semis_logi_private.ksync_uploads where path = u.path;
    out := out || jsonb_build_object(u.path, v_id);
  end loop;
  if dirty then perform semis_logi_private.ksync_docs_save(docs); end if;
  return jsonb_build_object('ok', true, 'docs', out);
end $$;

/* 내려받기 — 연결 범위 안 문서의 파일만. K 로 쓰지 않는 형식은 거절 */
create or replace function semis_logi_private.ksync_get(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m semis_logi_private.ksync_maps := semis_logi_private.ksync_map_of(p); v_run bigint := semis_logi_private.ksync_run_of(p_agent, p);
  hit jsonb; v_size bigint; v_name text; v_restore boolean;
begin
  if v_run is null then return jsonb_build_object('ok', false, 'error', 'run'); end if;
  if m.id is null then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  hit := semis_logi_private.ksync_doc_file(semis_logi_private.ksync_docs_lock_free(), m, p ->> 'doc', p ->> 'url');
  if hit is null then
    perform semis_logi_private.ksync_event('scope', p_ip, p_agent, jsonb_build_object('map', m.id, 'act', 'get'));
    return jsonb_build_object('ok', false, 'error', 'scope');
  end if;
  v_restore := exists (select 1 from semis_logi_private.ksync_files f where f.map_id = m.id and f.state = 'restore' and f.h_url = p ->> 'url');
  if m.state <> 'active' or (m.dir = 'k2h' and not v_restore) then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  v_name := coalesce(hit -> 'file' ->> 'name', '');
  if semis_logi_private.ksync_k_blocked(v_name) then
    perform semis_logi_private.ksync_event('type_block', p_ip, p_agent, jsonb_build_object('map', m.id, 'f', semis_logi_private.ksync_txt(v_name, 160)));
    return jsonb_build_object('ok', false, 'error', 'type');
  end if;
  v_size := case when coalesce(hit -> 'file' ->> 'size', '') ~ '^[0-9]{1,12}$' then (hit -> 'file' ->> 'size')::bigint else 0 end;
  -- 덮어쓰기(이미 맞춘 K 파일이 있는 판 묶음)는 변경으로 센다 — 서버가 기준선으로 판단
  if exists (select 1 from semis_logi_private.ksync_files f where f.map_id = m.id and f.k_sha256 is not null and f.state <> 'restore'
              and f.ser = coalesce(nullif(hit -> 'doc' ->> 'ser', ''), hit -> 'doc' ->> 'id'))
     and not semis_logi_private.ksync_count(p_agent, v_run, m, p_ip) then
    return jsonb_build_object('ok', false, 'error', 'held');
  end if;
  if not semis_logi_private.ksync_quota(p_agent, v_size, p_ip) then return jsonb_build_object('ok', false, 'error', 'quota'); end if;
  return jsonb_build_object('ok', true, 'path', semis_logi_private.ksync_url_path(p ->> 'url'), 'name', v_name, 'size', v_size);
end $$;

/* 기준선 · 상태 — set(맞춘 뒤) · state(삭제 대기 · 충돌 · 건너뜀 · 오류) · drop · rename · event(해시 불일치 · 형식 차단) */
create or replace function semis_logi_private.ksync_mark(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m semis_logi_private.ksync_maps := semis_logi_private.ksync_map_of(p); v_run bigint := semis_logi_private.ksync_run_of(p_agent, p);
  x jsonb; fr semis_logi_private.ksync_files; v_rel text; n int := 0; bad int := 0; docs jsonb; dlocked boolean := false; hit jsonb;
  v_old text; v_new text; v_held boolean := false; wdocs jsonb; wdirty boolean := false;
begin
  if v_run is null then return jsonb_build_object('ok', false, 'error', 'run'); end if;
  if m.id is null or m.state <> 'active' or jsonb_typeof(p -> 'items') is distinct from 'array' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  for x in select value from jsonb_array_elements(p -> 'items') limit 500 loop
    fr := null;
    if coalesce(x ->> 'id', '') ~ '^[0-9]{1,15}$' then
      select * into fr from semis_logi_private.ksync_files f where f.id = (x ->> 'id')::bigint and f.map_id = m.id;
    end if;
    case x ->> 'op'
      when 'set' then
        v_rel := semis_logi_private.ksync_rel(x ->> 'rel_path');
        if v_rel is null or coalesce(x ->> 'k_sha256', '') !~ '^[0-9a-f]{64}$' then bad := bad + 1; continue; end if;
        if not dlocked then docs := semis_logi_private.ksync_docs_lock_free(); dlocked := true; end if;
        hit := semis_logi_private.ksync_doc_file(coalesce(wdocs, docs), m, x ->> 'doc_id', x ->> 'h_url');
        if hit is null then
          perform semis_logi_private.ksync_event('scope', p_ip, p_agent, jsonb_build_object('map', m.id, 'act', 'mark'));
          bad := bad + 1; continue;
        end if;
        begin
          if fr.id is not null then
            -- 같은 줄을 고친다(줄 번호가 바뀌면 이어지는 '이전 판 올리기'가 그 줄을 찾지 못함)
            update semis_logi_private.ksync_files
               set rel_path = v_rel, k_size = (x ->> 'k_size')::bigint, k_mtime = (x ->> 'k_mtime')::timestamptz, k_sha256 = x ->> 'k_sha256',
                   doc_id = x ->> 'doc_id', ser = coalesce(nullif(hit -> 'doc' ->> 'ser', ''), hit -> 'doc' ->> 'id'), h_url = x ->> 'h_url',
                   h_name = hit -> 'file' ->> 'name',
                   h_size = case when coalesce(hit -> 'file' ->> 'size', '') ~ '^[0-9]{1,12}$' then (hit -> 'file' ->> 'size')::bigint end,
                   synced_at = now(), state = case when x ->> 'state' = 'conflict' then 'conflict' else 'ok' end,
                   note = semis_logi_private.ksync_txt(x ->> 'note', 120)
             where id = fr.id;
          else
            insert into semis_logi_private.ksync_files(map_id, rel_path, k_size, k_mtime, k_sha256, doc_id, ser, h_url, h_name, h_size, synced_at, state, note)
            values (m.id, v_rel, (x ->> 'k_size')::bigint, (x ->> 'k_mtime')::timestamptz, x ->> 'k_sha256', x ->> 'doc_id',
                    coalesce(nullif(hit -> 'doc' ->> 'ser', ''), hit -> 'doc' ->> 'id'), x ->> 'h_url', hit -> 'file' ->> 'name',
                    case when coalesce(hit -> 'file' ->> 'size', '') ~ '^[0-9]{1,12}$' then (hit -> 'file' ->> 'size')::bigint end, now(),
                    case when x ->> 'state' = 'conflict' then 'conflict' else 'ok' end, semis_logi_private.ksync_txt(x ->> 'note', 120))
            on conflict (map_id, rel_path) do update set k_size = excluded.k_size, k_mtime = excluded.k_mtime, k_sha256 = excluded.k_sha256,
              doc_id = excluded.doc_id, ser = excluded.ser, h_url = excluded.h_url, h_name = excluded.h_name, h_size = excluded.h_size,
              synced_at = excluded.synced_at, state = excluded.state, note = excluded.note;
          end if;
        exception when others then bad := bad + 1; continue;
        end;
      when 'state' then
        if fr.id is null or coalesce(x ->> 'state', '') not in ('ok', 'del_k', 'del_h', 'conflict', 'skip', 'error') then bad := bad + 1; continue; end if;
        if x ->> 'state' in ('del_k', 'del_h') and fr.state not in ('del_k', 'del_h') then
          if v_held or not semis_logi_private.ksync_count(p_agent, v_run, m, p_ip) then v_held := true; bad := bad + 1; continue; end if;
        end if;
        update semis_logi_private.ksync_files set state = x ->> 'state', note = semis_logi_private.ksync_txt(x ->> 'note', 120) where id = fr.id;
      when 'drop' then
        if fr.id is null then bad := bad + 1; continue; end if;
        delete from semis_logi_private.ksync_files where id = fr.id;
      when 'rename' then
        v_rel := semis_logi_private.ksync_rel(x ->> 'rel_path');
        if fr.id is null or v_rel is null then bad := bad + 1; continue; end if;
        begin
          update semis_logi_private.ksync_files set rel_path = v_rel, k_mtime = coalesce((x ->> 'k_mtime')::timestamptz, k_mtime), synced_at = now() where id = fr.id;
        exception when others then bad := bad + 1; continue;
        end;
        -- 제목이 옛 파일 이름이면 새 이름으로(K→H 방향이 있을 때)
        v_old := semis_logi_private.ksync_stem(fr.rel_path); v_new := semis_logi_private.ksync_stem(v_rel);
        if m.dir <> 'h2k' and v_old <> v_new and fr.ser is not null then
          if wdocs is null then wdocs := semis_logi_private.ksync_docs_lock(); end if;
          if exists (select 1 from jsonb_array_elements(wdocs) d where d.value ->> 'mod' = m.mod and coalesce(d.value ->> 'grp', '') = m.grp
                      and coalesce(nullif(d.value ->> 'ser', ''), d.value ->> 'id') = fr.ser and d.value ->> 'title' = v_old) then
            wdocs := coalesce((select jsonb_agg(case when jsonb_typeof(d.value) = 'object' and d.value ->> 'mod' = m.mod and coalesce(d.value ->> 'grp', '') = m.grp
                       and coalesce(nullif(d.value ->> 'ser', ''), d.value ->> 'id') = fr.ser and d.value ->> 'title' = v_old
                     then jsonb_set(d.value, '{title}', to_jsonb(v_new)) else d.value end order by d.idx)
                     from jsonb_array_elements(wdocs) with ordinality d(value, idx)), '[]'::jsonb);
            wdirty := true;
          end if;
        end if;
      when 'event' then
        if coalesce(x ->> 'kind', '') not in ('hash_mismatch', 'type_block') then bad := bad + 1; continue; end if;
        perform semis_logi_private.ksync_event(x ->> 'kind', p_ip, p_agent, jsonb_build_object('map', m.id, 'f', semis_logi_private.ksync_txt(x ->> 'f', 160)));
      else
        bad := bad + 1; continue;
    end case;
    n := n + 1;
  end loop;
  if wdirty then perform semis_logi_private.ksync_docs_save(wdocs); end if;     -- 문서함은 한 번만 고침(이력 · 변경 알림 한 번)
  return jsonb_build_object('ok', true, 'n', n, 'bad', bad, 'held', v_held);
end $$;

/* ─── 입구(서비스 권한만 — Edge 가 부름) ─── */
create or replace function public.semis_logi_ksync_agent(p_act text, p_key_hash text, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; v_agent bigint; q jsonb := case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end;
begin
  if coalesce(p_act, '') not in ('hello', 'net', 'folders', 'preview', 'run', 'put', 'put_peek', 'put_verify', 'put_apply', 'get', 'mark') then
    return jsonb_build_object('ok', false, 'error', 'bad');
  end if;
  a := semis_logi_private.ksync_auth(p_key_hash, p_ip, p_act);
  if not (a ->> 'ok')::boolean then return a; end if;
  v_agent := (a ->> 'agent')::bigint;
  return case p_act
    when 'hello' then semis_logi_private.ksync_hello(v_agent, (a ->> 'allow')::boolean, q)
    when 'net' then semis_logi_private.ksync_net(v_agent, p_ip, q)
    when 'folders' then semis_logi_private.ksync_folders_set(v_agent, q)
    when 'preview' then semis_logi_private.ksync_preview_set(v_agent, q)
    when 'run' then semis_logi_private.ksync_run(v_agent, p_ip, q)
    when 'put' then semis_logi_private.ksync_put_begin(v_agent, p_ip, q)
    when 'put_peek' then semis_logi_private.ksync_put_peek(v_agent, q)
    when 'put_verify' then semis_logi_private.ksync_put_verify(v_agent, p_ip, q)
    when 'put_apply' then semis_logi_private.ksync_put_apply(v_agent, p_ip, q)
    when 'get' then semis_logi_private.ksync_get(v_agent, p_ip, q)
    else semis_logi_private.ksync_mark(v_agent, p_ip, q) end;
end $$;

/* ─── 감시 · 관리(시스템관리자) ─── */
create or replace function public.semis_logi_ksync_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st semis_logi_private.ksync_state; v_ok timestamptz; v_active int; v_hold int; v_ev int; v_stale boolean; v_last jsonb; v_today jsonb;
begin
  perform semis_logi_private.ksync_admin();
  select * into st from semis_logi_private.ksync_state where id = 1;
  select max(coalesce(r.ended_at, r.started_at)) into v_ok from semis_logi_private.ksync_runs r where r.result in ('ok', 'partial', 'held');
  select count(*) into v_active from semis_logi_private.ksync_maps where state = 'active';
  select count(*) into v_hold from semis_logi_private.ksync_maps where hold is not null and not coalesce((hold ->> 'ok')::boolean, false);
  select count(*) into v_ev from semis_logi_private.ksync_events e where e.at > coalesce(st.ev_seen_at, now() - interval '7 days');
  v_stale := v_active > 0 and coalesce(v_ok, '-infinity'::timestamptz) < now() - interval '2 days'
             and coalesce((select min(m.updated_at) from semis_logi_private.ksync_maps m where m.state = 'active'), now()) < now() - interval '2 days';
  select to_jsonb(r) - 'detail' - 'cnt' into v_last from semis_logi_private.ksync_runs r order by r.started_at desc limit 1;
  select to_jsonb(r) - 'detail' - 'cnt' into v_today from semis_logi_private.ksync_runs r
   where semis_logi_private.ksync_date(r.started_at) = semis_logi_private.ksync_date(now()) and r.result is distinct from 'offline'
   order by r.started_at desc limit 1;
  return jsonb_build_object('ok', true, 'now', now(),
    'state', jsonb_build_object('daily_at', st.daily_at, 'requested_at', st.requested_at, 'net', st.net, 'ip_allow', st.ip_allow,
      'ip_seen', st.ip_seen, 'mass_limit', st.mass_limit),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'created_at', a.created_at, 'created_by', a.created_by,
        'revoked_at', a.revoked_at, 'last_seen_at', a.last_seen_at, 'last_ip', a.last_ip, 'version', a.version, 'host', a.host_label) order by a.id desc)
      from semis_logi_private.ksync_agents a), '[]'::jsonb),
    'maps', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'k_path', m.k_path, 'mod', m.mod, 'grp', m.grp, 'dir', m.dir, 'ssi', m.ssi,
        'state', m.state, 'preview', m.preview, 'hold', m.hold, 'n_files', m.n_files, 'last_run_at', m.last_run_at,
        'n_sync', (select count(*) from semis_logi_private.ksync_files f where f.map_id = m.id),
        'n_wait', (select count(*) from semis_logi_private.ksync_files f where f.map_id = m.id and f.state <> 'ok')) order by m.id)
      from semis_logi_private.ksync_maps m), '[]'::jsonb),
    'last', v_last, 'today', v_today, 'last_ok', v_ok,
    'counts', jsonb_build_object('hold', v_hold, 'ev_new', v_ev,
      'wait', (select count(*) from semis_logi_private.ksync_files f where f.state <> 'ok')),
    'stale', v_stale, 'alert', v_stale or v_hold > 0 or v_ev > 0);
end $$;

create or replace function public.semis_logi_ksync_runs(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n int := least(greatest(coalesce(case when coalesce(p ->> 'limit', '') ~ '^[0-9]{1,4}$' then (p ->> 'limit')::int end, 30), 1), 100);
begin
  perform semis_logi_private.ksync_admin();
  return jsonb_build_object('ok', true, 'runs', coalesce((select jsonb_agg(to_jsonb(r) - 'cnt' order by r.started_at desc)
    from (select * from semis_logi_private.ksync_runs order by started_at desc limit n) r), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_ksync_events(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare n int := least(greatest(coalesce(case when coalesce(p ->> 'limit', '') ~ '^[0-9]{1,4}$' then (p ->> 'limit')::int end, 100), 1), 300);
  k text := nullif(p ->> 'kind', '');
begin
  perform semis_logi_private.ksync_admin();
  update semis_logi_private.ksync_state set ev_seen_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'kind', e.kind, 'ip', e.ip,
      'agent', e.agent_id, 'detail', e.detail) order by e.at desc)
    from (select * from semis_logi_private.ksync_events x where k is null or x.kind = k order by x.at desc limit n) e), '[]'::jsonb),
    'counts', coalesce((select jsonb_object_agg(kind, c) from (select kind, count(*) c from semis_logi_private.ksync_events
      where at > now() - interval '30 days' group by kind) q), '{}'::jsonb));
end $$;

create or replace function public.semis_logi_ksync_folders() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform semis_logi_private.ksync_admin();
  return jsonb_build_object('ok', true, 'folders', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'depth', f.depth, 'n', f.n, 'at', f.at) order by f.path)
    from (select path, min(depth) depth, max(n_files) n, max(seen_at) at from semis_logi_private.ksync_folders group by path) f), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_ksync_map_save(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin(); m semis_logi_private.ksync_maps; v_k text; v_mod text; v_grp text; v_dir text; v_id bigint;
begin
  if jsonb_typeof(p) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if coalesce(p ->> 'id', '') ~ '^[0-9]{1,15}$' then
    select * into m from semis_logi_private.ksync_maps where id = (p ->> 'id')::bigint for update;
    if m.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  end if;
  if m.id is not null and coalesce((p ->> 'pause')::boolean, false) then
    update semis_logi_private.ksync_maps set state = 'paused', updated_at = now(), updated_by = me where id = m.id;
    return jsonb_build_object('ok', true, 'id', m.id);
  end if;
  v_k := semis_logi_private.ksync_rel(coalesce(p ->> 'k_path', m.k_path));
  v_mod := coalesce(p ->> 'mod', m.mod); v_grp := coalesce(p ->> 'grp', m.grp);
  v_dir := coalesce(p ->> 'dir', m.dir, 'both');
  if v_k is null or v_k ~ '(^|/)(_H드라이브_휴지통|_H드라이브_이전판)(/|$)' then return jsonb_build_object('ok', false, 'error', 'k_path'); end if;
  if coalesce(v_mod, '') !~ '^[a-z][a-z0-9-]{1,39}$' or coalesce(v_grp, '') !~ '^[A-Za-z0-9_-]{1,40}$' then return jsonb_build_object('ok', false, 'error', 'target'); end if;
  if v_dir not in ('both', 'k2h', 'h2k') then return jsonb_build_object('ok', false, 'error', 'dir'); end if;
  -- 맞춘 파일이 있는 연결은 폴더 · 화면 · 분류를 바꾸지 않는다(기준선이 어긋남) — 지우고 새로 연결
  if m.id is not null and (lower(v_k) <> lower(m.k_path) or v_mod <> m.mod or v_grp <> m.grp)
     and exists (select 1 from semis_logi_private.ksync_files f where f.map_id = m.id) then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  if exists (select 1 from semis_logi_private.ksync_maps x where x.id is distinct from m.id
              and (lower(x.k_path) = lower(v_k) or lower(v_k) like lower(x.k_path) || '/%' or lower(x.k_path) like lower(v_k) || '/%')) then
    return jsonb_build_object('ok', false, 'error', 'k_dup');
  end if;
  if exists (select 1 from semis_logi_private.ksync_maps x where x.id is distinct from m.id and x.mod = v_mod and x.grp = v_grp) then
    return jsonb_build_object('ok', false, 'error', 'target_dup');
  end if;
  if m.id is null then
    insert into semis_logi_private.ksync_maps(k_path, mod, grp, dir, ssi, state, created_by, updated_by)
    values (v_k, v_mod, v_grp, v_dir, coalesce((p ->> 'ssi')::boolean, false), 'preview', me, me) returning id into v_id;
    update semis_logi_private.ksync_state set requested_at = now() where id = 1;     -- 미리보기 건수를 받으려고
  else
    update semis_logi_private.ksync_maps set k_path = v_k, mod = v_mod, grp = v_grp, dir = v_dir,
      ssi = coalesce((p ->> 'ssi')::boolean, ssi), updated_at = now(), updated_by = me where id = m.id;
    v_id := m.id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.semis_logi_ksync_map_delete(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform semis_logi_private.ksync_admin();
  delete from semis_logi_private.ksync_maps where id = p_id;     -- 기준선만 지운다(H 문서 · K 파일은 그대로)
  if not found then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_logi_ksync_map_start(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin();
begin
  -- 미리보기를 보고 시작 = 첫 실행 승인(처음 맞추는 건수는 대량 변경 한도를 넘기 쉽다)
  update semis_logi_private.ksync_maps
     set state = 'active', hold = case when state = 'preview' then jsonb_build_object('ok', true, 'at', now(), 'first', true) else hold end,
         updated_at = now(), updated_by = me
   where id = p_id and state in ('preview', 'paused');
  if not found then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  update semis_logi_private.ksync_state set requested_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_logi_ksync_pending() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_det jsonb;
begin
  perform semis_logi_private.ksync_admin();
  select r.detail into v_det from semis_logi_private.ksync_runs r where r.result in ('ok', 'partial', 'held', 'fail') order by r.started_at desc limit 1;
  return jsonb_build_object('ok', true,
    'holds', coalesce((select jsonb_agg(jsonb_build_object('map', m.id, 'k_path', m.k_path, 'mod', m.mod, 'grp', m.grp, 'run', m.hold -> 'run',
        'n', m.hold -> 'n', 'base', m.hold -> 'base', 'at', m.hold -> 'at') order by m.id)
      from semis_logi_private.ksync_maps m where m.hold is not null and not coalesce((m.hold ->> 'ok')::boolean, false)), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'map', f.map_id, 'rel_path', f.rel_path, 'state', f.state, 'note', f.note,
        'h_name', f.h_name, 'synced_at', f.synced_at) order by f.state, f.rel_path)
      from (select * from semis_logi_private.ksync_files where state <> 'ok' order by state, rel_path limit 500) f), '[]'::jsonb),
    'last', coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(v_det, '[]'::jsonb)) x where x ->> 'a' in ('skip', 'error')), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_ksync_resolve(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin(); v_act text := p ->> 'act'; fr semis_logi_private.ksync_files; m semis_logi_private.ksync_maps;
  docs jsonb; dirty boolean := false; n int := 0; v_ask boolean := false;
begin
  if coalesce(v_act, '') not in ('confirm', 'restore', 'dismiss') or jsonb_typeof(p -> 'ids') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'bad');
  end if;
  for fr in select f.* from semis_logi_private.ksync_files f
             where f.id in (select (x #>> '{}')::bigint from jsonb_array_elements(p -> 'ids') x where (x #>> '{}') ~ '^[0-9]{1,15}$' limit 500) for update loop
    select * into m from semis_logi_private.ksync_maps where id = fr.map_id;
    if v_act = 'dismiss' then
      if fr.state not in ('conflict', 'skip', 'error') then continue; end if;
      update semis_logi_private.ksync_files set state = 'ok', note = '' where id = fr.id;
    elsif fr.state not in ('del_k', 'del_h') then
      continue;
    elsif v_act = 'restore' then
      update semis_logi_private.ksync_files set state = 'restore', note = '' where id = fr.id; v_ask := true;
    elsif fr.state = 'del_h' then
      update semis_logi_private.ksync_files set state = 'trash', note = '' where id = fr.id; v_ask := true;   -- K 파일은 에이전트가 휴지통 폴더로
    else
      -- K 에서 지운 파일 확정 → 그 판 묶음 문서에서 이 파일을 빼고, 파일이 남지 않은 문서는 지운다
      if not dirty then docs := semis_logi_private.ksync_docs_lock(); dirty := true; end if;
      docs := coalesce((select jsonb_agg(v order by idx) from (
          select d.idx, case when jsonb_typeof(d.value) = 'object' and d.value ->> 'mod' = m.mod and coalesce(d.value ->> 'grp', '') = m.grp
                                  and coalesce(nullif(d.value ->> 'ser', ''), d.value ->> 'id') = fr.ser and jsonb_typeof(d.value -> 'files') = 'array'
                             then jsonb_set(d.value, '{files}', coalesce((select jsonb_agg(f.value order by f.i) from jsonb_array_elements(d.value -> 'files') with ordinality f(value, i)
                                                                            where f.value ->> 'name' is distinct from fr.h_name), '[]'::jsonb))
                             else d.value end as v
            from jsonb_array_elements(docs) with ordinality d(value, idx)) q
        where not (jsonb_typeof(v) = 'object' and v ->> 'mod' = m.mod and coalesce(v ->> 'grp', '') = m.grp
                   and coalesce(nullif(v ->> 'ser', ''), v ->> 'id') = fr.ser and jsonb_typeof(v -> 'files') = 'array' and jsonb_array_length(v -> 'files') = 0)), '[]'::jsonb);
      delete from semis_logi_private.ksync_files where id = fr.id;
    end if;
    n := n + 1;
  end loop;
  if dirty then perform semis_logi_private.ksync_docs_save(docs); end if;
  if v_ask then update semis_logi_private.ksync_state set requested_at = now() where id = 1; end if;
  return jsonb_build_object('ok', true, 'n', n, 'by', me);
end $$;

create or replace function public.semis_logi_ksync_hold(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin(); n int;
begin
  if coalesce(p ->> 'act', '') not in ('approve', 'reject') or coalesce(p ->> 'run_id', '') !~ '^[0-9]{1,15}$' then
    return jsonb_build_object('ok', false, 'error', 'bad');
  end if;
  if p ->> 'act' = 'approve' then
    update semis_logi_private.ksync_maps set hold = hold || jsonb_build_object('ok', true, 'by', me, 'ok_at', now()), updated_at = now(), updated_by = me
     where hold ->> 'run' = p ->> 'run_id' and not coalesce((hold ->> 'ok')::boolean, false)
       and (coalesce(p ->> 'map', '') = '' or id::text = p ->> 'map');
  else
    -- 거절 = 그 연결을 멈춤(바뀐 것을 확인한 뒤 '시작'으로 다시)
    update semis_logi_private.ksync_maps set hold = null, state = 'paused', updated_at = now(), updated_by = me
     where hold ->> 'run' = p ->> 'run_id' and not coalesce((hold ->> 'ok')::boolean, false)
       and (coalesce(p ->> 'map', '') = '' or id::text = p ->> 'map');
  end if;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  if p ->> 'act' = 'approve' then update semis_logi_private.ksync_state set requested_at = now() where id = 1; end if;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

create or replace function public.semis_logi_ksync_request() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform semis_logi_private.ksync_admin();
  update semis_logi_private.ksync_state set requested_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'at', now());
end $$;

/* CIDR 정리 — 너무 넓은 범위(IPv4 /16 · IPv6 /32 보다 넓음)는 거절 */
create or replace function semis_logi_private.ksync_cidr(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare v inet := semis_logi_private.ksync_inet(btrim(coalesce(p, '')));
begin
  if v is null then return null; end if;
  if (family(v) = 4 and masklen(v) < 16) or (family(v) = 6 and masklen(v) < 32) then return null; end if;
  return network(v)::text;
end $$;

create or replace function public.semis_logi_ksync_settings(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin(); v_allow jsonb := '[]'::jsonb; x text; c text; f int; r numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if p ? 'daily_at' then
    if coalesce(p ->> 'daily_at', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return jsonb_build_object('ok', false, 'error', 'daily_at'); end if;
    update semis_logi_private.ksync_state set daily_at = p ->> 'daily_at' where id = 1;
  end if;
  if p ? 'ip_allow' then
    if jsonb_typeof(p -> 'ip_allow') is distinct from 'array' or jsonb_array_length(p -> 'ip_allow') > 20 then return jsonb_build_object('ok', false, 'error', 'ip'); end if;
    for x in select jsonb_array_elements_text(p -> 'ip_allow') loop
      c := semis_logi_private.ksync_cidr(x);
      if c is null then return jsonb_build_object('ok', false, 'error', 'ip'); end if;
      if not v_allow ? c then v_allow := v_allow || to_jsonb(c); end if;
    end loop;
    update semis_logi_private.ksync_state set ip_allow = v_allow where id = 1;
  end if;
  if p ? 'mass_limit' then
    f := case when coalesce(p -> 'mass_limit' ->> 'files', '') ~ '^[0-9]{1,6}$' then (p -> 'mass_limit' ->> 'files')::int end;
    r := case when coalesce(p -> 'mass_limit' ->> 'ratio', '') ~ '^(0(\.[0-9]{1,3})?|1(\.0+)?)$' then (p -> 'mass_limit' ->> 'ratio')::numeric end;
    if f is null or f < 1 or r is null or r < 0.01 then return jsonb_build_object('ok', false, 'error', 'mass_limit'); end if;
    update semis_logi_private.ksync_state set mass_limit = mass_limit || jsonb_build_object('files', f, 'ratio', r) where id = 1;
  end if;
  return jsonb_build_object('ok', true, 'by', me);
end $$;

create or replace function public.semis_logi_ksync_ip_approve(p_ip text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v inet := semis_logi_private.ksync_inet(btrim(coalesce(p_ip, ''))); c text;
begin
  perform semis_logi_private.ksync_admin();
  if v is null then return jsonb_build_object('ok', false, 'error', 'ip'); end if;
  c := network(set_masklen(v, case when family(v) = 4 then 32 else 128 end))::text;
  update semis_logi_private.ksync_state
     set ip_allow = case when ip_allow ? c then ip_allow else ip_allow || to_jsonb(c) end,
         ip_seen = coalesce((select jsonb_agg(x) from jsonb_array_elements(ip_seen) x where semis_logi_private.ksync_inet(x ->> 'ip') is distinct from host(v)::inet), '[]'::jsonb)
   where id = 1;
  return jsonb_build_object('ok', true, 'cidr', c);
end $$;

create or replace function public.semis_logi_ksync_agent_new(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin(); v_key text := encode(extensions.gen_random_bytes(32), 'hex'); v_id bigint;
begin
  insert into semis_logi_private.ksync_agents(name, key_hash, created_by)
  values (coalesce(nullif(semis_logi_private.ksync_txt(p_name, 40), ''), 'Mac'), encode(extensions.digest(v_key, 'sha256'), 'hex'), me)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key);      -- 원문은 이때 한 번만
end $$;

create or replace function public.semis_logi_ksync_agent_revoke(p_id bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform semis_logi_private.ksync_admin();
  update semis_logi_private.ksync_agents set revoked_at = now() where id = p_id and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  return jsonb_build_object('ok', true);
end $$;

/* ─── 실행 권한 ─── */
revoke all on function public.semis_logi_ksync_agent(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.semis_logi_ksync_agent(text, text, text, jsonb) to service_role;
revoke all on function public.semis_logi_ksync_status(), public.semis_logi_ksync_runs(jsonb), public.semis_logi_ksync_events(jsonb),
  public.semis_logi_ksync_folders(), public.semis_logi_ksync_map_save(jsonb), public.semis_logi_ksync_map_delete(bigint),
  public.semis_logi_ksync_map_start(bigint), public.semis_logi_ksync_pending(), public.semis_logi_ksync_resolve(jsonb),
  public.semis_logi_ksync_hold(jsonb), public.semis_logi_ksync_request(), public.semis_logi_ksync_settings(jsonb),
  public.semis_logi_ksync_ip_approve(text), public.semis_logi_ksync_agent_new(text), public.semis_logi_ksync_agent_revoke(bigint)
  from public, authenticated;
grant execute on function public.semis_logi_ksync_status(), public.semis_logi_ksync_runs(jsonb), public.semis_logi_ksync_events(jsonb),
  public.semis_logi_ksync_folders(), public.semis_logi_ksync_map_save(jsonb), public.semis_logi_ksync_map_delete(bigint),
  public.semis_logi_ksync_map_start(bigint), public.semis_logi_ksync_pending(), public.semis_logi_ksync_resolve(jsonb),
  public.semis_logi_ksync_hold(jsonb), public.semis_logi_ksync_request(), public.semis_logi_ksync_settings(jsonb),
  public.semis_logi_ksync_ip_approve(text), public.semis_logi_ksync_agent_new(text), public.semis_logi_ksync_agent_revoke(bigint)
  to anon, service_role;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'semis_logi_private' and p.proname like 'ksync\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
