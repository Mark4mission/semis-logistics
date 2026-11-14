/* ═══════════════════════════════════════════════════════
   H:drive — K드라이브(사내 네트워크 드라이브) ↔ H:drive 양방향 동기화
   - 동기화한 자료는 양쪽 모두 평소 자료: K 에서 온 파일 = 그 화면 문서함의 일반 문서(공용 행 docs), H 문서 = K 폴더의 일반 파일.
   - 실행은 Mac 에이전트(tools/ksync — 나가는 HTTPS 만) → Edge semis-logi-ksync(키 sha256 · 접속 IP 를 넘김) →
     public.semis_logi_ksync_agent(서비스 권한만) → semis_logi_private.ksync_*.
     PostgREST 는 public 스키마 함수만 부를 수 있어 입구 하나만 public 에 두고 나머지는 비공개 스키마에 둔다.
   - 감시 · 관리 RPC public.semis_logi_ksync_* 는 시스템관리자(rank 4) 세션만 — 아니면 42501.
   - 외부 침입 방어: 키는 sha256 만 저장 · 허용 IP(회사 출구) 밖은 거절(연결 안 됨 보고 net 만 예외) · 비어 있으면 hello 만 받고 후보 IP 로 ·
     키 실패 IP(IPv6 는 /64) 당 15분 10회 → 1시간 차단 · 분당 호출 · 하루 전송량 상한 · 연결된 화면 · 분류 문서만 · 대량 변경 보류(서버도 셈) ·
     K 로 가는 실행 파일 차단 · 해시 불일치 거절 · 모든 실행 · 보안 이벤트 기록(180일).
   - 문서함 반영은 공용 행 docs 를 for update 로 잠근 뒤 고친다. updated_at 은 트리거가 찍는다(되돌리지 않는다) —
     열린 화면의 다음 저장은 409 → 병합으로 이어진다. 관리자 세션에서 고칠 때는 잠근 행의 updated_at 을 base_at 으로 넘긴다.
   - 적용: 마이그레이션 semis_logi_security_30_ksync · v1.64 기준일 · 막는 형식 semis_logi_security_32_ksync_since ·
     v1.68 링크 정확도 semis_logi_security_34_ksync_links · 보고 · 지정 제외 · H → K 준실시간 semis_logi_security_35_ksync_report ·
     v1.72 '양쪽' 안전 전환 · H 첨부 해시 semis_logi_security_36_ksync_both(이 파일 전체).
     이 파일이 원본(다시 실행해도 같은 결과).
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
  preview     jsonb,                                   -- 미리보기 건수 { k2h, h2k, link, del, conflict, skip, total, old?, at }
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
alter table semis_logi_private.ksync_maps add column if not exists since date;     -- 기준일(v1.64) — 기준선에 없는 K 파일 중 한국 시각 그날 0시 전에 고친 것은 올리지 않음
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
-- 새 동작의 깃발(SQL 로만 바꿈 — 끄면 그 전 동작). link_all = H 옛 판까지 · 기준일 전 K 파일도 '연결만' 후보로
alter table semis_logi_private.ksync_state add column if not exists flags jsonb not null default '{"link_all": false}'::jsonb;
-- 지정 제외 — 전체(공유 뿌리 기준 경로, 20개 이하) · 연결마다(연결 폴더 안 경로, 20개 이하). 에이전트는 그 아래를 걷지 않고 '모름'으로 넘긴다
-- (그냥 빼면 그 아래 기준선 줄이 '지워진 것'으로 보인다 — 모름이라 삭제 · 덮어쓰기 · 올리기 모두 없음). 전체 제외는 연결 안 된 폴더 보고에서도 뺀다
alter table semis_logi_private.ksync_state add column if not exists excludes jsonb not null default '[]'::jsonb;
alter table semis_logi_private.ksync_maps add column if not exists excludes jsonb not null default '[]'::jsonb;
alter table semis_logi_private.ksync_maps add column if not exists report jsonb;     -- 마지막 실행의 보고 { out: {이유: 건수}, mismatch, run, at }
-- '양쪽' 전환 미리보기 — dir_next = 바꿔 볼 방향(양쪽만), recon = 에이전트가 그 방향으로 계획을 한 번 더 돌려 센 건수
-- { k2h, h2k, h2k_new(내려올 새 파일), dup('이름 (2)' 로 내려올 것), link, link_old(옛 판으로 연결), del, conflict, skip, total, n, bytes(올릴 바이트),
--   held(그 회차 평소 계획이 대량 변경으로 보류됨 — 이 건수로는 바꾸지 않음), at }
alter table semis_logi_private.ksync_maps add column if not exists dir_next text check (dir_next = 'both');
alter table semis_logi_private.ksync_maps add column if not exists recon jsonb;
-- H 첨부 해시 채우기 요청(관리자) — 에이전트가 회차마다 Edge hash 로 채우고, 남은 것이 없으면 지운다.
-- ksync_hash_skip = 기다릴 주소: 'try'(내주고 결과가 아직 없음) · 'busy'(저장소 일시 오류)는 한 시간, 그 밖(읽지 못함 · 50MB 초과)은 하루.
-- ksync_hash_val = 잰 값(아직 문서함에 안 적음) — 회차의 마지막 호출이거나 남은 것이 없을 때 한 번에 적는다(열린 화면의 문서함을 호출마다 바꾸지 않게)
alter table semis_logi_private.ksync_state add column if not exists hash_req timestamptz;
create table if not exists semis_logi_private.ksync_hash_skip (
  url  text primary key,
  at   timestamptz not null default now(),
  why  text not null default ''
);
create table if not exists semis_logi_private.ksync_hash_val (
  url  text primary key,
  sha  text not null,
  at   timestamptz not null default now()
);
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
  h_url    text,                                       -- 새 판이 바꿀 H 파일(계획 때 현재 판에 있던 주소) — 등록 때 없으면 그 사이 H 가 새 판을 만든 것
  at       timestamptz not null default now()
);
alter table semis_logi_private.ksync_uploads add column if not exists verified boolean not null default false;
alter table semis_logi_private.ksync_uploads add column if not exists h_url text;
create table if not exists semis_logi_private.ksync_fails (      -- 키 실패(IP 차단 셈 — 기록 표 ksync_events 와 따로, 1~2시간만)
  ip text not null,                                    -- 셈 단위(ksync_fail_key — IPv6 는 /64)
  at timestamptz not null default now()
);
create index if not exists ksync_fails_ip on semis_logi_private.ksync_fails(ip, at);
create index if not exists ksync_fails_at on semis_logi_private.ksync_fails(at);     -- 오래된 줄 정리가 표 전체를 훑지 않게
create table if not exists semis_logi_private.ksync_run_sers (   -- 계획이 본 기준선의 판 묶음(회차 시작 · 회차 안의 hello full) — 내려받기가 덮어쓰기인지 볼 때만, 회차가 끝나면 지움
  run_id bigint not null,
  map_id bigint not null,
  ser    text not null,
  primary key (run_id, map_id, ser)
);

do $$
declare t text;
begin
  foreach t in array array['ksync_agents', 'ksync_maps', 'ksync_files', 'ksync_runs', 'ksync_folders', 'ksync_events', 'ksync_state', 'ksync_uploads', 'ksync_fails', 'ksync_run_sers', 'ksync_hash_skip', 'ksync_hash_val'] loop
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

/* 키 실패 셈 · 차단 단위 — IPv4 는 주소 하나, IPv6 는 /64(한 회선이 주소를 바꿔 가며 셈을 피하지 못하게).
   IPv4 를 담은 IPv6 주소(::ffff:a.b.c.d)는 IPv4 처럼 주소 하나 — /64 로 묶으면 모든 IPv4 가 한 덩어리가 된다 */
create or replace function semis_logi_private.ksync_fail_key(p_ip text) returns text
language plpgsql immutable set search_path = '' as $$
declare v inet := semis_logi_private.ksync_inet(p_ip);
begin
  if v is not null and family(v) = 6 and not v <<= '::ffff:0:0/96'::inet then return network(set_masklen(v, 64))::text; end if;
  return left(coalesce(p_ip, ''), 64);
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
/* 지정 제외 목록 — 경로 배열(20개 이하) · 각각 ksync_rel · 대소문자만 다른 것은 하나로. 틀리면 null */
create or replace function semis_logi_private.ksync_excl(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare x jsonb; v text; o jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 20 then return null; end if;
  for x in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(x) <> 'string' then return null; end if;
    v := semis_logi_private.ksync_rel(btrim(x #>> '{}'));
    if v is null or v ~ '(^|/)(_H드라이브_휴지통|_H드라이브_이전판)(/|$)' then return null; end if;
    if not exists (select 1 from jsonb_array_elements_text(o) e where lower(e) = lower(v)) then o := o || to_jsonb(v); end if;
  end loop;
  return o;
end $$;
/* 경로가 목록의 어느 경로와 같거나 그 아래인지(맥 SMB 처럼 대소문자 무시) */
create or replace function semis_logi_private.ksync_under(p_path text, p_list jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(p_list) = 'array' then p_list else '[]'::jsonb end) e
                  where lower(p_path) = lower(e) or starts_with(lower(p_path), lower(e) || '/'))
$$;
create or replace function semis_logi_private.ksync_base(p text) returns text
language sql immutable set search_path = '' as $$ select regexp_replace(coalesce(p, ''), '^.*/', '') $$;
create or replace function semis_logi_private.ksync_stem(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(regexp_replace(semis_logi_private.ksync_base(p), '\.[^.]{1,10}$', ''), ''), semis_logi_private.ksync_base(p))
$$;
/* H 로 올리지 않는 형식 — 동기화 전용 목록(plan.mjs H_BLOCK 과 같음). html · js 류는 파일 함수 semis-logi-files 의 BLOCK_TYPES 와 같은 뜻,
   더해 인증서 · 키 보관 파일(pfx · p12 · pem · kdbx) · 바로 가기(lnk · url) */
create or replace function semis_logi_private.ksync_h_blocked(p_name text) returns boolean
language sql immutable set search_path = '' as $$ select lower(coalesce(p_name, '')) ~ '\.(html?|xht(ml)?|m?js|pfx|p12|pem|kdbx|lnk|url)$' $$;
/* K 로 쓰지 않는 형식 — 실행 파일 · 스크립트 · 바로 가기 · 폴더를 열기만 해도 동작하는 것(아이콘 · 검색 연결 — NTLM 해시 유출) ·
   도움말 · 관리 콘솔 · 디스크 이미지 · 설치 꾸러미 · 브라우저로 열리는 문서(html 과 같은 위험). K 에 쓴 파일은 인터넷에서 온 표시가 없다 */
create or replace function semis_logi_private.ksync_k_blocked(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(coalesce(p_name, '')) ~ '\.(exe|bat|cmd|com|scr|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|sh|command|app|jar|lnk|url|hta|html?|pif|cpl|reg|dll|scf|library-ms|searchconnector-ms|chm|hlp|msc|iso|img|vhd|vhdx|appref-ms|website|rdp|xll|wll|wsc|sct|ws|application|settingcontent-ms|theme|themepack|diagcab|cab|appx|appxbundle|msix|msixbundle|gadget|inf|ins|isp|mde|accde|jnlp|ps1xml|psc1|psd1|vb|xht|xhtml|svg|mht|mhtml|shtml)$'
$$;
/* 표준 파일 주소 → 저장소 경로 */
create or replace function semis_logi_private.ksync_url_path(p_url text) returns text
language sql immutable set search_path = '' as $$
  select x[1] from (select regexp_match(coalesce(p_url, ''), '^https://[A-Za-z0-9.-]+/storage/v1/object/public/semis-logi-files/([A-Za-z0-9._/-]+)$') x) q
   where length(x[1]) between 3 and 300 and x[1] !~ '(^|/)\.\.?(/|$)'
$$;
create or replace function semis_logi_private.ksync_date(p timestamptz) returns text
language sql immutable set search_path = '' as $$ select to_char(p at time zone 'Asia/Seoul', 'YYYY-MM-DD') $$;
/* 첨부의 sha256(64자 hex) — 동기화가 등록한 첨부 · 문서함에서 올린 첨부 · 해시 채우기가 적은 것만 있다. 없거나 틀리면 null */
create or replace function semis_logi_private.ksync_sha(p_file jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_file) = 'object' and coalesce(p_file ->> 'sha', '') ~ '^[0-9a-f]{64}$' then p_file ->> 'sha' end
$$;

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
/* H 쪽 현재 판 목록 — 판 묶음마다 현재 판의 파일 하나씩.
   SSI 아닌 연결에서 현재 판의 파일이 민감보안정보라 빠진 판 묶음은 {ser, hidden} 만(이름 · 주소 없이) — 빼 버리면 에이전트가
   그 판 묶음의 K 파일을 'H 에서 지움'으로 보고, 확정하면 K 파일이 휴지통으로 간다(K 수정은 docs-ssi 판이 되어 다시 숨으므로 되풀이) */
create or replace function semis_logi_private.ksync_h_items(p_docs jsonb, p_map semis_logi_private.ksync_maps) returns jsonb
language sql stable set search_path = '' as $$
  with d as (
    select x.value as doc, x.idx, coalesce(nullif(x.value ->> 'ser', ''), x.value ->> 'id') as ser
      from jsonb_array_elements(p_docs) with ordinality x(value, idx)
     where jsonb_typeof(x.value) = 'object' and x.value ->> 'mod' = p_map.mod and coalesce(x.value ->> 'grp', '') = p_map.grp
       and coalesce(x.value ->> 'id', '') <> ''
  ), r as (
    select d.*, row_number() over (partition by d.ser order by coalesce(d.doc ->> 'date', '') desc, coalesce(d.doc ->> 'title', '') collate "C", d.idx) as rn from d
  ), fl as (
    select r.doc, r.ser, f.value as file, f.idx as fidx,
           p_map.ssi or (not coalesce((r.doc ->> 'ssi')::boolean, false) and semis_logi_private.ksync_url_path(f.value ->> 'url') not like 'docs-ssi/%') as seen
      from r, jsonb_array_elements(case when jsonb_typeof(r.doc -> 'files') = 'array' then r.doc -> 'files' else '[]'::jsonb end) with ordinality f(value, idx)
     where r.rn = 1 and jsonb_typeof(f.value) = 'object' and coalesce(f.value ->> 'name', '') <> ''
       and semis_logi_private.ksync_url_path(f.value ->> 'url') is not null
  )
  select coalesce((select jsonb_agg(jsonb_build_object('doc', fl.doc ->> 'id', 'ser', fl.ser, 'title', coalesce(fl.doc ->> 'title', ''),
           'date', coalesce(fl.doc ->> 'date', ''), 'at', coalesce(fl.doc ->> 'at', ''), 'ssi', coalesce((fl.doc ->> 'ssi')::boolean, false),
           'name', fl.file ->> 'name', 'size', case when coalesce(fl.file ->> 'size', '') ~ '^[0-9]{1,12}$' then (fl.file ->> 'size')::bigint else 0 end,
           'url', fl.file ->> 'url', 'sha', semis_logi_private.ksync_sha(fl.file)) order by fl.ser, fl.fidx) from fl where fl.seen), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('ser', h.ser, 'hidden', true) order by h.ser)
                     from (select distinct fl.ser from fl where not fl.seen) h), '[]'::jsonb)
$$;
/* H 쪽 옛 판 — 기준선에 없는 K 파일을 이을 후보로만(flags.link_all). 판 묶음의 현재 판이 아닌 판의 파일, ksync_h_items 와 같은 SSI 거름.
   현재 판이 숨은 판 묶음({ser, hidden})과 현재 판과 짝지을 수 없는 판 묶음은 뺀다(이으면 다음 실행이 그 K 파일을 'H 에서 지움'으로 본다).
   현재 판에도 있는 주소(첨부를 그대로 이어 쓴 판)도 뺀다 — 현재 판과 같은 파일이라 현재 판으로 짝짓는다 */
create or replace function semis_logi_private.ksync_h_olds(p_docs jsonb, p_map semis_logi_private.ksync_maps) returns jsonb
language sql stable set search_path = '' as $$
  with d as (
    select x.value as doc, x.idx, coalesce(nullif(x.value ->> 'ser', ''), x.value ->> 'id') as ser
      from jsonb_array_elements(p_docs) with ordinality x(value, idx)
     where jsonb_typeof(x.value) = 'object' and x.value ->> 'mod' = p_map.mod and coalesce(x.value ->> 'grp', '') = p_map.grp
       and coalesce(x.value ->> 'id', '') <> ''
  ), r as (
    select d.*, row_number() over (partition by d.ser order by coalesce(d.doc ->> 'date', '') desc, coalesce(d.doc ->> 'title', '') collate "C", d.idx) as rn from d
  ), fl as (
    select r.doc, r.ser, r.rn, f.value as file, f.idx as fidx,
           p_map.ssi or (not coalesce((r.doc ->> 'ssi')::boolean, false) and semis_logi_private.ksync_url_path(f.value ->> 'url') not like 'docs-ssi/%') as seen
      from r, jsonb_array_elements(case when jsonb_typeof(r.doc -> 'files') = 'array' then r.doc -> 'files' else '[]'::jsonb end) with ordinality f(value, idx)
     where jsonb_typeof(f.value) = 'object' and coalesce(f.value ->> 'name', '') <> ''
       and semis_logi_private.ksync_url_path(f.value ->> 'url') is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('ser', o.ser, 'doc', o.doc ->> 'id', 'name', o.file ->> 'name',
           'size', case when coalesce(o.file ->> 'size', '') ~ '^[0-9]{1,12}$' then (o.file ->> 'size')::bigint else 0 end,
           'url', o.file ->> 'url', 'date', coalesce(o.doc ->> 'date', ''), 'sha', semis_logi_private.ksync_sha(o.file)) order by o.ser, o.rn, o.fidx), '[]'::jsonb)
    from fl o
   where o.rn > 1 and o.seen
     -- 현재 판에 보이는 첨부가 하나뿐이거나 같은 이름 첨부가 있을 때만 — 그래야 다음 실행이 이은 줄을 현재 판과 짝짓는다
     -- (첨부가 여럿인데 같은 이름이 없으면 짝을 못 지어 'H 에서 지움'이 되고 현재 판 첨부를 모두 새로 받는다)
     and ((select count(*) from fl c where c.ser = o.ser and c.rn = 1 and c.seen) = 1
          or exists (select 1 from fl c where c.ser = o.ser and c.rn = 1 and c.seen and c.file ->> 'name' = o.file ->> 'name'))
     and not exists (select 1 from fl c where c.ser = o.ser and c.rn = 1 and not c.seen)
     and not exists (select 1 from fl c where c.rn = 1 and c.file ->> 'url' = o.file ->> 'url')
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
/* 해시 채우기 범위 — 어느 연결이든 그 연결이 볼 수 있는 문서(ksync_h_items 와 같은 SSI 거름)의 저장소 파일, 주소마다 한 줄.
   todo = 그 주소의 첨부 중 sha 가 없는 것이 있음(옛 판 첨부도 — 링크는 옛 판과도 잇는다) */
create or replace function semis_logi_private.ksync_seen(p_doc jsonb, p_url text) returns boolean
language sql stable set search_path = '' as $$
  select semis_logi_private.ksync_url_path(p_url) is not null
     and exists (select 1 from semis_logi_private.ksync_maps m
                  where p_doc ->> 'mod' = m.mod and coalesce(p_doc ->> 'grp', '') = m.grp
                    and (m.ssi or (not coalesce((p_doc ->> 'ssi')::boolean, false) and semis_logi_private.ksync_url_path(p_url) not like 'docs-ssi/%')))
$$;
create or replace function semis_logi_private.ksync_hash_scope(p_docs jsonb) returns table(url text, size bigint, todo boolean)
language sql stable set search_path = '' as $$
  select f.value ->> 'url',
         max(case when coalesce(f.value ->> 'size', '') ~ '^[0-9]{1,12}$' then (f.value ->> 'size')::bigint else 0 end),
         bool_or(semis_logi_private.ksync_sha(f.value) is null)
    from jsonb_array_elements(case when jsonb_typeof(p_docs) = 'array' then p_docs else '[]'::jsonb end) d,
         jsonb_array_elements(case when jsonb_typeof(d.value) = 'object' and jsonb_typeof(d.value -> 'files') = 'array' then d.value -> 'files' else '[]'::jsonb end) f
   where coalesce(d.value ->> 'id', '') <> '' and jsonb_typeof(f.value) = 'object' and semis_logi_private.ksync_seen(d.value, f.value ->> 'url')
   group by f.value ->> 'url'
$$;
/* 지금 내주지 않을 주소 — 잰 값이 아직 적히지 않았거나, 기다리는 중(시도함 · 일시 오류 한 시간, 그 밖 하루) */
create or replace function semis_logi_private.ksync_hash_wait(p_url text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from semis_logi_private.ksync_hash_val v where v.url = p_url)
      or exists (select 1 from semis_logi_private.ksync_hash_skip k where k.url = p_url
                  and k.at > now() - case when k.why in ('try', 'busy') then interval '1 hour' else interval '1 day' end)
$$;
/* 일시적으로 기다리는 주소(시도함 · 일시 오류)가 남았는지 — 있으면 남은 것이 없어도 해시 채우기 요청을 지우지 않는다(한 시간 뒤 다시 읽음) */
create or replace function semis_logi_private.ksync_hash_busy(p_docs jsonb) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from semis_logi_private.ksync_hash_scope(p_docs) h join semis_logi_private.ksync_hash_skip k on k.url = h.url
                  where h.todo and k.why in ('try', 'busy') and k.at > now() - interval '1 hour')
$$;
/* 모아 둔 잰 값을 문서함에 한 번에 적는다 — 그 주소의 첨부 중 해시가 없고 연결이 볼 수 있는 것에 sha 칸만 더함(범위를 다시 본다).
   문서함 저장은 한 번(이력 · 변경 알림 한 번, updated_by …/ksync — 준실시간 트리거가 깨지 않음). 적은 값 · 이제 범위 밖인 값은 지운다 */
create or replace function semis_logi_private.ksync_hash_flush() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_set jsonb; docs jsonb; n int := 0;
begin
  select coalesce(jsonb_object_agg(v.url, v.sha), '{}'::jsonb) into v_set from semis_logi_private.ksync_hash_val v;
  if v_set = '{}'::jsonb then return 0; end if;
  docs := semis_logi_private.ksync_docs_lock();
  select count(*) into n
    from jsonb_array_elements(docs) d,
         jsonb_array_elements(case when jsonb_typeof(d.value) = 'object' and jsonb_typeof(d.value -> 'files') = 'array' then d.value -> 'files' else '[]'::jsonb end) f
   where jsonb_typeof(f.value) = 'object' and v_set ? (f.value ->> 'url') and semis_logi_private.ksync_sha(f.value) is null
     and coalesce(d.value ->> 'id', '') <> '' and semis_logi_private.ksync_seen(d.value, f.value ->> 'url');
  if n > 0 then
    -- 첨부가 빈 문서는 그대로(jsonb_agg 가 null 이면 원래 첨부)
    docs := (select jsonb_agg(case when jsonb_typeof(d.value) = 'object' and jsonb_typeof(d.value -> 'files') = 'array' and coalesce(d.value ->> 'id', '') <> ''
               then jsonb_set(d.value, '{files}', coalesce((select jsonb_agg(case when jsonb_typeof(f.value) = 'object' and v_set ? (f.value ->> 'url')
                                                                                     and semis_logi_private.ksync_sha(f.value) is null and semis_logi_private.ksync_seen(d.value, f.value ->> 'url')
                                                                                   then f.value || jsonb_build_object('sha', v_set ->> (f.value ->> 'url')) else f.value end order by f.i)
                                                               from jsonb_array_elements(d.value -> 'files') with ordinality f(value, i)), d.value -> 'files'))
               else d.value end order by d.idx)
               from jsonb_array_elements(docs) with ordinality d(value, idx));
    perform semis_logi_private.ksync_docs_save(docs);
  end if;
  delete from semis_logi_private.ksync_hash_val where url in (select jsonb_object_keys(v_set));
  return n;
end $$;

/* ─── 에이전트 확인 — 키 · IP · 횟수 ─── */
create or replace function semis_logi_private.ksync_auth(p_hash text, p_ip text, p_act text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a semis_logi_private.ksync_agents; st semis_logi_private.ksync_state; v_fail int; v_min timestamptz := date_trunc('minute', now());
  v_per int; v_seen jsonb; v_key text := semis_logi_private.ksync_fail_key(p_ip);
begin
  -- 키 실패로 막힌 IP(IPv6 는 /64) — 1시간 동안 아무것도 받지 않는다(기록도 남기지 않음 — 표가 불어나지 않게)
  if exists (select 1 from semis_logi_private.ksync_events e where e.ip = v_key and e.kind = 'rate'
              and e.detail ->> 'why' = 'key' and e.at > now() - interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'rate');
  end if;
  if coalesce(p_hash, '') ~ '^[0-9a-f]{64}$' then
    select * into a from semis_logi_private.ksync_agents x where x.key_hash = p_hash for update;
  end if;
  if a.id is null or a.revoked_at is not null then
    -- 차단 셈은 따로 — 기록 표의 상한과 관계없이 셈 단위마다 늘 센다
    insert into semis_logi_private.ksync_fails(ip) values (v_key);
    -- 1시간 지난 줄은 가끔만(가장 오래된 줄이 2시간을 넘었을 때) 지운다 — 실패마다 지우면 공격 중 요청마다 지우기가 겹친다
    if exists (select 1 from semis_logi_private.ksync_fails f where f.at < now() - interval '2 hours') then
      delete from semis_logi_private.ksync_fails where at < now() - interval '1 hour';
    end if;
    select count(*) into v_fail from semis_logi_private.ksync_fails f where f.ip = v_key and f.at > now() - interval '15 minutes';
    -- 기록은 IP 마다 15분에 한 줄 · 전체 15분 500줄까지(여러 IP 로 표를 불리지 못하게)
    if not exists (select 1 from semis_logi_private.ksync_events e where e.ip = left(coalesce(p_ip, ''), 64) and e.kind in ('bad_key', 'revoked_key')
                    and e.at > now() - interval '15 minutes')
       and (select count(*) from semis_logi_private.ksync_events e where e.kind in ('bad_key', 'revoked_key') and e.at > now() - interval '15 minutes') < 500 then
      perform semis_logi_private.ksync_event(case when a.id is null then 'bad_key' else 'revoked_key' end, p_ip, a.id, jsonb_build_object('act', left(coalesce(p_act, ''), 12)));
    end if;
    -- 차단 기록의 IP 칸은 셈 단위(IPv6 는 /64) — 위의 차단 확인이 같은 값으로 찾는다
    if v_fail > 10 then perform semis_logi_private.ksync_event('rate', v_key, a.id, jsonb_build_object('why', 'key', 'n', v_fail)); end if;
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
declare n int; base int; lim jsonb; v_ok boolean := coalesce((p_map.hold ->> 'ok')::boolean, false);
begin
  if p_map.hold is not null and not v_ok then return false; end if;     -- 승인 전 보류는 새 회차에도 그대로
  update semis_logi_private.ksync_runs set cnt = jsonb_set(cnt, array[p_map.id::text], to_jsonb(coalesce((cnt ->> p_map.id::text)::int, 0) + 1))
   where id = p_run returning (cnt ->> p_map.id::text)::int into n;
  select count(*) into base from semis_logi_private.ksync_files f where f.map_id = p_map.id and f.k_sha256 is not null and f.h_url is not null;
  select s.mass_limit into lim from semis_logi_private.ksync_state s where s.id = 1;
  if v_ok then
    -- 승인한 보류는 그때 센 건수(hold.n)를 넘는 몫이 그 자체로 대량 변경(건수 · 비율 한도)일 때 다시 보류 — 승인 뒤 새로 생긴 대량 변경(에이전트 계획과 같은 규칙).
    -- 건수만 보면 작은 연결은 승인이 남아 있는 동안 폴더를 통째로 지우거나 덮어도 지나간다
    if not semis_logi_private.ksync_limit_hit(n - (case when coalesce(p_map.hold ->> 'n', '') ~ '^[0-9]{1,9}$' then (p_map.hold ->> 'n')::int else 0 end), base, lim) then
      return true;
    end if;
  elsif not semis_logi_private.ksync_limit_hit(n, base, lim) then
    return true;
  end if;
  update semis_logi_private.ksync_maps set hold = jsonb_build_object('run', p_run, 'at', now(), 'n', n, 'base', base, 'srv', true) where id = p_map.id;
  perform semis_logi_private.ksync_event('mass_hold', p_ip, p_agent, jsonb_build_object('map', p_map.id, 'n', n, 'base', base, 'run', p_run));
  return false;
end $$;

/* 덮어쓰기로 셀 판 묶음 = 계획이 보는 기준선과 같은 줄(plan.mjs overSer — K 해시가 있고 복원 대기가 아닌 줄) */
create or replace function semis_logi_private.ksync_run_snap(p_run bigint) returns void
language sql volatile security definer set search_path = '' as $$
  delete from semis_logi_private.ksync_run_sers where run_id = p_run;
  insert into semis_logi_private.ksync_run_sers(run_id, map_id, ser)
  select distinct p_run, f.map_id, f.ser from semis_logi_private.ksync_files f
   where f.k_sha256 is not null and f.state <> 'restore' and f.ser is not null;
$$;

/* ─── 에이전트 동작 ─── */
create or replace function semis_logi_private.ksync_hello(p_agent bigint, p_allow boolean, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare st semis_logi_private.ksync_state; m semis_logi_private.ksync_maps; maps jsonb := '[]'::jsonb; lists jsonb := '[]'::jsonb; docs jsonb;
  v_run bigint; pbase jsonb := '[]'::jsonb;
begin
  update semis_logi_private.ksync_agents
     set version = case when coalesce(p ->> 'ver', '') ~ '^[0-9A-Za-z.+-]{1,20}$' then p ->> 'ver' else version end,
         host_label = case when p ? 'host' then semis_logi_private.ksync_txt(p ->> 'host', 60) else host_label end
   where id = p_agent;
  select * into st from semis_logi_private.ksync_state where id = 1;
  if not p_allow then
    return jsonb_build_object('ok', true, 'allow', false, 'now', now(), 'daily_at', st.daily_at);
  end if;
  if coalesce((p ->> 'full')::boolean, false) then
    docs := semis_logi_private.ksync_docs_lock_free();
    -- 회차 안에서 기준선을 다시 받으면(지난 실행이 못 보낸 표시를 먼저 보낸 뒤) 덮어쓰기로 셀 판 묶음도 이 기준선으로 다시 잡는다.
    -- 회차 시작 때 것으로 세면 다시 이은 줄(판 묶음 바뀜)의 옛 판 묶음은 계획에는 기준선 줄이 없는 H 문서인데 서버만 덮어쓰기로 세어
    -- 서버만 대량 변경 보류를 건다. 이미 하나라도 센 뒤에는 바꾸지 않는다(센 몫과 세는 기준이 어긋나지 않게)
    v_run := semis_logi_private.ksync_run_of(p_agent, p);
    if v_run is not null and exists (select 1 from semis_logi_private.ksync_runs r where r.id = v_run and r.cnt = '{}'::jsonb) then
      perform semis_logi_private.ksync_run_snap(v_run);
    end if;
  end if;
  for m in select * from semis_logi_private.ksync_maps order by id loop
    -- updated_at = 이 설정을 고친 시각 — 미리보기 건수를 보낼 때 되돌려 받아, 그 사이 관리자가 고쳤으면 옛 설정으로 센 건수를 버린다
    maps := maps || jsonb_build_array(jsonb_build_object('id', m.id, 'k_path', m.k_path, 'mod', m.mod, 'grp', m.grp, 'dir', m.dir, 'ssi', m.ssi,
      'state', m.state, 'hold', m.hold, 'updated_at', m.updated_at, 'since', m.since, 'excludes', m.excludes,
      'dir_next', m.dir_next, 'recon_at', m.recon ->> 'at'));
    if docs is not null and m.state <> 'paused' then
      -- olds = 옛 판(링크 후보) — flags.link_all 이 꺼져 있으면 빈 배열(에이전트는 그 전과 같게 동작)
      lists := lists || jsonb_build_array(jsonb_build_object('map', m.id,
        'h', semis_logi_private.ksync_h_items(docs, m),
        'olds', case when st.flags -> 'link_all' = 'true'::jsonb then semis_logi_private.ksync_h_olds(docs, m) else '[]'::jsonb end,
        'base', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'rel_path', f.rel_path, 'k_size', f.k_size, 'k_mtime', f.k_mtime, 'k_sha256', f.k_sha256,
          'doc_id', f.doc_id, 'ser', f.ser, 'h_url', f.h_url, 'h_name', f.h_name, 'h_size', f.h_size, 'state', f.state, 'note', f.note) order by f.rel_path)
          from semis_logi_private.ksync_files f where f.map_id = m.id), '[]'::jsonb)));
    elsif docs is not null then
      -- 멈춘 연결은 목록 대신 기준선 크기 · 해시만 — 그 폴더에서 다른 연결 폴더로 옮긴 기준일 전 파일도 새 파일로(put_begin 과 같은 '어느 연결이든')
      pbase := pbase || coalesce((select jsonb_agg(jsonb_build_object('k_size', f.k_size, 'k_sha256', f.k_sha256))
        from semis_logi_private.ksync_files f where f.map_id = m.id and f.k_sha256 is not null), '[]'::jsonb);
    end if;
  end loop;
  -- 상태 줄은 목록을 다 만든 뒤에 고친다 — 그 줄을 잡은 채 문서함을 훑으면 그동안 문서함 트리거가 요청 표시를 켜지 못한다(건너뜀)
  update semis_logi_private.ksync_state set net = jsonb_build_object('ok', true, 'at', now(), 'msg', '') where id = 1;
  return jsonb_build_object('ok', true, 'allow', true, 'now', now(), 'daily_at', st.daily_at,
    'requested', st.requested_at is not null, 'requested_at', st.requested_at, 'mass_limit', st.mass_limit, 'flags', st.flags, 'excludes', st.excludes, 'maps', maps,
    'hash', st.hash_req is not null)
    || case when docs is not null then jsonb_build_object('lists', lists, 'paused_base', pbase) else '{}'::jsonb end;
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
declare m semis_logi_private.ksync_maps := semis_logi_private.ksync_map_of(p); c jsonb := p -> 'counts'; o jsonb := '{}'::jsonb; k text; v_at timestamptz;
begin
  if m.id is null or m.state <> 'preview' or jsonb_typeof(c) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  -- 건수를 센 설정(hello 의 updated_at)이 지금 설정과 다르면 버린다 — 실행 중 관리자가 방향 · SSI 를 바꾼 뒤 옛 건수로 [시작]하지 않게.
  -- 오류로 돌려주지 않고(이번 실행은 그대로 이어 감) 다시 요청한다 — 고친 때가 hello 와 회차 시작 사이면 회차 시작이 그 요청을 지웠다.
  -- updated_at 을 보내지 않으면 설정 시각을 대 보지 않고 받는다
  if p ? 'updated_at' then
    begin
      v_at := (p ->> 'updated_at')::timestamptz;
    exception when others then v_at := null;
    end;
    if v_at is distinct from m.updated_at then
      update semis_logi_private.ksync_state set requested_at = now() where id = 1;
      return jsonb_build_object('ok', true, 'stale', true);
    end if;
  end if;
  foreach k in array array['k2h', 'h2k', 'link', 'del', 'conflict', 'skip', 'total'] loop
    o := o || jsonb_build_object(k, case when coalesce(c ->> k, '') ~ '^[0-9]{1,9}$' then (c ->> k)::int else 0 end);
  end loop;
  -- 기준일 전이라 뺀 수(v1.64 에이전트부터 보냄 — 없으면 적지 않음)
  if c ? 'old' then o := o || jsonb_build_object('old', case when coalesce(c ->> 'old', '') ~ '^[0-9]{1,9}$' then (c ->> 'old')::int else 0 end); end if;
  -- K 에 '이름 (2)' 로 내려올 것(v1.72 에이전트부터 — reconOf 의 dup). 양쪽 · H → K 만 연결은 0 이어야 [시작](map_start 'dup')
  if c ? 'name2' then o := o || jsonb_build_object('name2', case when coalesce(c ->> 'name2', '') ~ '^[0-9]{1,9}$' then (c ->> 'name2')::int else 0 end); end if;
  update semis_logi_private.ksync_maps set preview = o || jsonb_build_object('at', now()) where id = m.id;
  return jsonb_build_object('ok', true);
end $$;

/* '양쪽' 전환 미리보기 건수 — 활성 연결이고 dir_next 가 있을 때만. 에이전트가 그 회차의 같은 색인으로 계획을 dir_next 방향으로 한 번 더 돌려 센다(K 에 쓰지 않음).
   preview_set 처럼 센 설정(hello 의 updated_at)이 지금과 다르면 버리고 다시 요청한다 — 옛 설정으로 센 건수로 바꾸지 않게.
   에이전트는 한 회차에 한 곳만 세므로, 아직 건수가 없는 다른 연결이 있으면 다음 깨우기를 요청한다 */
create or replace function semis_logi_private.ksync_recon_set(p_agent bigint, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m semis_logi_private.ksync_maps := semis_logi_private.ksync_map_of(p); c jsonb := p -> 'counts'; o jsonb := '{}'::jsonb; k text; v_at timestamptz;
begin
  if m.id is null or m.state <> 'active' or m.dir_next is null or m.dir_next = m.dir or jsonb_typeof(c) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'error', 'state');
  end if;
  begin
    v_at := (p ->> 'updated_at')::timestamptz;
  exception when others then v_at := null;
  end;
  if v_at is distinct from m.updated_at then
    update semis_logi_private.ksync_state set requested_at = now() where id = 1;
    return jsonb_build_object('ok', true, 'stale', true);
  end if;
  foreach k in array array['k2h', 'h2k', 'h2k_new', 'dup', 'link', 'link_old', 'del', 'conflict', 'skip', 'total', 'n'] loop
    o := o || jsonb_build_object(k, case when coalesce(c ->> k, '') ~ '^[0-9]{1,9}$' then (c ->> k)::int else 0 end);
  end loop;
  -- held = 그 회차의 평소 계획이 대량 변경으로 보류됨(승인 전 · 거절한 변경이 건수에 들어 있다) — 이 건수로는 바꾸지 않는다(map_save 'hold')
  o := o || jsonb_build_object('bytes', case when coalesce(c ->> 'bytes', '') ~ '^[0-9]{1,15}$' then (c ->> 'bytes')::bigint else 0 end,
    'held', coalesce(p ->> 'held', '') = 'true', 'at', now());
  update semis_logi_private.ksync_maps set recon = o where id = m.id;
  if exists (select 1 from semis_logi_private.ksync_maps x where x.id <> m.id and x.state = 'active' and x.dir_next is not null and x.dir_next <> x.dir and x.recon is null) then
    update semis_logi_private.ksync_state set requested_at = now() where id = 1;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function semis_logi_private.ksync_run(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_run bigint; v_res text; v_det jsonb := '[]'::jsonb; x jsonb; m semis_logi_private.ksync_maps; i int := 0;
  num text := '^[0-9]{1,9}$'; v_seen timestamptz; v_xat timestamptz; v_same boolean;
begin
  if p ->> 'phase' = 'start' then
    update semis_logi_private.ksync_runs set result = 'fail', ended_at = now(), msg = '중단됨'
     where agent_id = p_agent and result is null;
    insert into semis_logi_private.ksync_runs(agent_id, ip, trigger)
    values (p_agent, left(coalesce(p_ip, ''), 64), case when p ->> 'trigger' in ('daily', 'net', 'manual') then p ->> 'trigger' else 'daily' end)
    returning id into v_run;
    -- 덮어쓰기로 셀 판 묶음 = 이 회차가 시작할 때 맞춘 것(계획의 기준선과 같음). 회차 안에서 생긴 기준선 줄(여러 첨부 새 문서의 앞 첨부 ·
    -- 복원해 받은 줄)로 세면 계획은 0 인데 서버만 세어 대량 변경 보류를 건다. 회차 안에서 기준선을 다시 받으면 hello 가 다시 잡는다
    delete from semis_logi_private.ksync_run_sers s
     where not exists (select 1 from semis_logi_private.ksync_runs r where r.id = s.run_id and r.result is null and r.started_at > now() - interval '12 hours');
    perform semis_logi_private.ksync_run_snap(v_run);
    delete from semis_logi_private.ksync_runs where started_at < now() - interval '400 days';
    delete from semis_logi_private.ksync_uploads where at < now() - interval '1 day';
    -- 요청 표시는 계획이 본 문서함(hello full 시각 seen) 전에 켜진 것만 끈다 — 그 뒤 사람이 고친 것은 이 회차 계획에 없으므로 남겨 다음 깨우기에 맞춘다.
    -- seen 이 없으면(옛 에이전트) 그대로 끈다. 상태 줄은 맨 끝에 잡는다(잡은 동안 문서함 트리거는 요청을 켜지 못하고 건너뜀)
    begin
      v_seen := (p ->> 'seen')::timestamptz;
    exception when others then v_seen := null;
    end;
    update semis_logi_private.ksync_state set requested_at = null where id = 1 and (v_seen is null or requested_at <= v_seen);
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
  delete from semis_logi_private.ksync_run_sers where run_id = v_run;
  -- 연결별 결과: 보류 · 끝남(승인 한 번 씀) · 파일 수
  if jsonb_typeof(p -> 'maps') = 'array' then
    for x in select value from jsonb_array_elements(p -> 'maps') limit 100 loop
      m := semis_logi_private.ksync_map_of(jsonb_build_object('map', x ->> 'id'));
      continue when m.id is null;
      -- 보고(범위 밖 이유별 건수 · 불일치) — 그 연결을 계획한 마지막 실행 것만, 아는 이유만 숫자로
      if jsonb_typeof(x -> 'rep') = 'object' and m.state = 'active' then
        update semis_logi_private.ksync_maps set report = jsonb_build_object(
            'out', coalesce((select jsonb_object_agg(k, (x -> 'rep' -> 'out' ->> k)::int)
                               from unnest(array['type', 'type_block', 'too_large', 'ssi', 'old', 'excl', 'dir', 'name']) k
                              where coalesce(x -> 'rep' -> 'out' ->> k, '') ~ num), '{}'::jsonb),
            'mismatch', case when coalesce(x -> 'rep' ->> 'mismatch', '') ~ num then (x -> 'rep' ->> 'mismatch')::int else 0 end,
            'run', v_run, 'at', now())
         where id = m.id;
      end if;
      -- hello 때 받은 설정 시각(updated_at)을 보낸 에이전트(1.72~)는 그 값이 지금과 같을 때만 보류 · 승인을 다룬다 — 그 사이 [양쪽으로 바꾸기] 등으로
      -- 설정이 바뀌었으면 이 회차는 옛 설정으로 맞춘 것이라, 새로 심은 첫 회차 승인을 쓰거나(지우거나) 바꾸지 않는다. 보내지 않으면(옛 에이전트) 그 전처럼
      v_xat := null;
      begin
        v_xat := (x ->> 'updated_at')::timestamptz;
      exception when others then v_xat := null;
      end;
      v_same := not (x ? 'updated_at') or v_xat is not distinct from m.updated_at;
      if coalesce((x ->> 'held')::boolean, false) then
        continue when not v_same;
        -- 승인한 보류인데 에이전트가 센 건수에서 승인한 건수를 뺀 몫이 대량 변경이면 새 대량 변경 — 승인을 버리고 새 보류로(ksync_count 와 같은 규칙).
        -- 그 안이면 승인 전 보류를 보고 멈춘 실행이 끝난 사이에 승인한 것 — 승인을 그대로 둔다
        if coalesce((m.hold ->> 'ok')::boolean, false) then
          if semis_logi_private.ksync_limit_hit(
               (case when coalesce(x ->> 'n', '') ~ num then (x ->> 'n')::int else 0 end)
                 - (case when coalesce(m.hold ->> 'n', '') ~ num then (m.hold ->> 'n')::int else 0 end),
               (select count(*)::int from semis_logi_private.ksync_files f where f.map_id = m.id and f.k_sha256 is not null and f.h_url is not null),
               (select s.mass_limit from semis_logi_private.ksync_state s where s.id = 1)) then
            m.hold := null;
          else
            continue;
          end if;
        end if;
        if m.hold is null then
          perform semis_logi_private.ksync_event('mass_hold', p_ip, p_agent, jsonb_build_object('map', m.id, 'run', v_run,
            'n', case when coalesce(x ->> 'n', '') ~ num then (x ->> 'n')::int else 0 end));
        end if;
        -- 보류가 이어지면 처음 보류한 회차는 그대로(대시보드의 [승인]이 그 회차를 가리킴), 건수만 새로
        update semis_logi_private.ksync_maps set hold = coalesce(m.hold, jsonb_build_object('run', v_run, 'at', now()))
          || jsonb_build_object('n', case when coalesce(x ->> 'n', '') ~ num then (x ->> 'n')::int else 0 end,
                                'base', case when coalesce(x ->> 'base', '') ~ num then (x ->> 'base')::int else 0 end, 'last', v_run)
         where id = m.id;
      elsif m.state = 'active' then
        -- 승인한 보류만, 그 연결을 끝까지 맞췄을 때 지운다(승인 전 보류는 에이전트가 지울 수 없음)
        update semis_logi_private.ksync_maps
           set hold = case when v_same and coalesce((hold ->> 'ok')::boolean, false) and coalesce((x ->> 'done')::boolean, false) then null else hold end,
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
  v_part text := p ->> 'part'; v_path text; cur jsonb; v_mt timestamptz;
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
  -- 기준일(한국 시각 그날 0시) 전 새 문서는 받지 않는다 — 기준선 줄이 없는 것만(이름 바꿈 · 새 판 · 복원 · 충돌 사본은 줄이 있음).
  -- 어느 연결이든 기준선과 해시가 같으면(연결 폴더끼리 옮긴 파일) 받는다. 수정 시각이 없거나 틀리면 받지 않음 — 옛 에이전트도 옛 파일을 올리지 못하게
  if m.since is not null and v_row is null then
    begin
      v_mt := (p ->> 'mtime')::timestamptz;
    exception when others then
      v_mt := null;
    end;
    if v_mt is null or (v_mt < (m.since::timestamp at time zone 'Asia/Seoul')
                        and not exists (select 1 from semis_logi_private.ksync_files f where f.k_sha256 = p ->> 'sha256')) then
      return jsonb_build_object('ok', false, 'error', 'old');
    end if;
  end if;
  begin
    perform (p ->> 'mtime')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad');
  end;
  if fr.ser is not null then cur := semis_logi_private.ksync_cur(semis_logi_private.ksync_docs_lock_free(), m.mod, m.grp, fr.ser); end if;
  -- 기준선 줄이 있는 '새 문서'인데 그 판 묶음이 H 에 남아 있으면 새 판으로 등록하고(맨 앞 — 지금 판이 된다) 변경으로 센다(관리자가 고른 복원은 빼고).
  -- 다만 '새 문서'로 온 줄은 지금 판에 이름 · 저장소 주소를 갖춘 첨부가 하나도 없으면 세지 않는다 — 그 판 묶음은 H 목록(ksync_h_items)에 없어
  -- 계획에는 H 에서 지운 것과 같고 계획은 세지 않는다(서버만 세면 서버만 대량 변경 보류를 건다)
  if v_mode = 'new' and cur is not null then v_mode := 'version'; end if;
  if v_mode = 'version' and coalesce(fr.state, '') <> 'restore'
     and (p ->> 'mode' = 'version'
          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cur -> 'files') = 'array' then cur -> 'files' else '[]'::jsonb end) f
                      where jsonb_typeof(f) = 'object' and coalesce(f ->> 'name', '') <> '' and semis_logi_private.ksync_url_path(f ->> 'url') is not null))
     and not semis_logi_private.ksync_count(p_agent, v_run, m, p_ip) then
    return jsonb_build_object('ok', false, 'error', 'held');
  end if;
  -- 민감보안정보 판 묶음에 들어가는 판은 SSI 폴더로(연결이 SSI 가 아니어도)
  v_path := case when m.ssi or coalesce((cur ->> 'ssi')::boolean, false) then 'docs-ssi/' else 'docs/' end || v_part;
  if exists (select 1 from semis_logi_private.ksync_uploads x where x.path = v_path) then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if not semis_logi_private.ksync_quota(p_agent, v_size, p_ip) then return jsonb_build_object('ok', false, 'error', 'quota'); end if;
  -- 계획이 고른 새 판이 바꿀 H 파일을 적어 둔다 — 등록 때 지금 판에 없으면 그 사이 H 가 고친 것. 'K 만 바뀜'은 기준선 파일,
  -- 충돌(K 가 이김 — H 도 바뀜)은 계획이 본 H 판(에이전트가 보낸 주소 — 지금 판과 대 보기만 하고 등록하지 않는다. 보내지 않으면 적지 않아 등록 때 대 보지 않음).
  -- '새 문서'에서 바뀐 새 판(H 에서 이 첨부가 빠짐 · 복원)은 처음부터 지금 판에 없으므로 적지 않는다
  insert into semis_logi_private.ksync_uploads(path, agent_id, run_id, map_id, rel_path, size, sha256, mtime, mode, row_id, state, h_url)
  values (v_path, p_agent, v_run, m.id, v_rel, v_size, p ->> 'sha256', (p ->> 'mtime')::timestamptz, v_mode, v_row,
          case when p ->> 'state' = 'conflict' then 'conflict' else 'ok' end,
          case when p ->> 'mode' <> 'version' then null
               when coalesce(p ->> 'state', '') <> 'conflict' then fr.h_url
               when length(p ->> 'h_url') between 1 and 2000 then p ->> 'h_url' end);
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
  v_id text; v_ser text; v_name text; v_date text; v_url text; v_hit boolean; out jsonb := '{}'::jsonb; dirty boolean := false; v_i int;
  v_one boolean; v_add boolean := false;
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
    -- 기준선 줄 없는 새 문서인데 그 키를 이미 다른 판 묶음 · 다른 파일이 쓰면 따로 묶는다(K 에서 이름을 바꾼 파일은 옛 경로 키를 그대로 쓴다).
    -- 끼어들면 새 문서가 그 묶음의 현재 판이 되어 이름을 바꾼 파일의 문서를 가리고, 다음 실행이 그 파일을 'H 에서 지움'으로 본다
    v_i := 1;
    while fr.ser is null and (semis_logi_private.ksync_cur(docs, m.mod, m.grp, v_ser) is not null
          or exists (select 1 from semis_logi_private.ksync_files f where f.map_id = m.id and f.ser = v_ser and f.rel_path <> u.rel_path)) loop
      v_i := v_i + 1;
      v_ser := semis_logi_private.ksync_ser(u.rel_path) || ' (' || v_i || ')';
    end loop;
    cur := case when u.mode <> 'new' or fr.ser is not null then semis_logi_private.ksync_cur(docs, m.mod, m.grp, v_ser) end;
    -- 계획 뒤 H 가 새 판을 만들었으면(지금 판에 바꿀 H 파일이 없음) 등록하지 않는다 — 덮으면 H 의 새 판이 충돌 표시 없이 이전 판으로 밀린다.
    -- 올린 것은 등록 대기로 두었다가 버려지고, 다음 실행이 '양쪽 다 바뀜'으로 보아 충돌 규칙(늦게 고친 쪽이 현재 판)을 탄다.
    -- 이 연결이 볼 수 없는 민감보안정보 판은 계획도 H 쪽을 몰랐으므로(숨긴 판 묶음) 대 보지 않고 새 판으로 등록한다
    if u.h_url is not null and cur is not null
       and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cur -> 'files') = 'array' then cur -> 'files' else '[]'::jsonb end) f where f ->> 'url' = u.h_url)
       and (m.ssi or not (coalesce((cur ->> 'ssi')::boolean, false)
                          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cur -> 'files') = 'array' then cur -> 'files' else '[]'::jsonb end) f
                                      where semis_logi_private.ksync_url_path(f ->> 'url') like 'docs-ssi/%'))) then
      continue;
    end if;
    -- sha = 확인(verify)이 저장소에서 다시 잰 값 — 다음 실행의 링크(같은 내용 파일 잇기)가 쓴다
    nf := jsonb_build_object('name', v_name, 'size', u.size, 'url', v_url, 'sha', u.sha256);
    files := jsonb_build_array(nf);
    if u.mode = 'version' and cur is not null and jsonb_typeof(cur -> 'files') = 'array' and jsonb_array_length(cur -> 'files') > 0 then
      -- 이 파일 자리: 기준선 주소 → 이름 → 첨부가 하나뿐이면 그것(H 가 이름을 바꾼 새 판), 없으면 뒤에 더함.
      -- 하나뿐인 첨부를 이 연결의 다른 기준선 줄이 맞추고 있으면(주소 · 같은 판 묶음의 이름) 그 줄의 파일 — 바꾸면 그 파일이 H 에서 사라져 'H 에서 지움'이 된다
      v_one := jsonb_array_length(cur -> 'files') = 1
        and not exists (select 1 from semis_logi_private.ksync_files o where o.map_id = m.id and o.id is distinct from fr.id
                          and (o.h_url = cur -> 'files' -> 0 ->> 'url' or (o.ser = v_ser and o.h_name = cur -> 'files' -> 0 ->> 'name')));
      v_hit := exists (select 1 from jsonb_array_elements(cur -> 'files') f where f ->> 'url' = fr.h_url)
            or exists (select 1 from jsonb_array_elements(cur -> 'files') f where f ->> 'name' = fr.h_name)
            or v_one;
      files := case when not v_hit then (cur -> 'files') || jsonb_build_array(nf)
        else (select jsonb_agg(case when (exists (select 1 from jsonb_array_elements(cur -> 'files') g where g ->> 'url' = fr.h_url) and f.value ->> 'url' = fr.h_url)
                                     or (not exists (select 1 from jsonb_array_elements(cur -> 'files') g where g ->> 'url' = fr.h_url)
                                         and (f.value ->> 'name' = fr.h_name or v_one))
                                    then nf else f.value end order by f.i)
                from jsonb_array_elements(cur -> 'files') with ordinality f(value, i)) end;
    end if;
    nd := jsonb_build_object('id', v_id, 'mod', m.mod, 'grp', m.grp,
      'title', coalesce(cur ->> 'title', semis_logi_private.ksync_stem(u.rel_path)),
      -- 이전 판(old)은 현재 판보다 늦은 날짜가 되지 않는다 — 현재 판 날짜가 비었거나 형식이 달라도 그 값을 그대로 써서(맨 뒤라 현재 판이 못 됨)
      'date', case when u.mode = 'old' and cur is not null then
                     case when coalesce(cur ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then least(v_date, cur ->> 'date') else coalesce(cur ->> 'date', '') end
                   when cur is null or coalesce(cur ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then v_date
                   else greatest(v_date, cur ->> 'date') end,
      'ser', v_ser, 'org', coalesce(cur ->> 'org', ''), 'note', coalesce(cur ->> 'note', ''),
      'ssi', m.ssi or coalesce((cur ->> 'ssi')::boolean, false) or u.path like 'docs-ssi/%',
      'mids', case when jsonb_typeof(cur -> 'mids') = 'array' then cur -> 'mids' else '[]'::jsonb end,
      'files', files,
      'src', 'ksync', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', 'K드라이브 동기화');
    -- 새 판은 맨 앞(같은 날짜 · 같은 제목이면 배열 앞이 현재 판), 이전 판으로 남길 것과 새 문서는 맨 뒤
    docs := case when u.mode = 'version' then jsonb_build_array(nd) || docs else docs || jsonb_build_array(nd) end;
    v_add := true;
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
  if v_add then perform semis_logi_private.ksync_docs_save(docs); end if;     -- 하나도 넣지 않았으면 저장하지 않는다(이력 · 변경 알림 없이)
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
  -- 복원 줄은 방향과 관계없이 — 그 판 묶음의 파일이면(K 에서 지운 뒤 H 가 새 판을 만들었으면 계획은 지금 판을 받으러 온다.
  -- 기준선 주소만 보면 K→H 만인 연결에서 거절되어 그 줄은 다시 복원할 수 없게 된다)
  v_restore := exists (select 1 from semis_logi_private.ksync_files f where f.map_id = m.id and f.state = 'restore'
                        and (f.h_url = p ->> 'url' or f.ser = coalesce(nullif(hit -> 'doc' ->> 'ser', ''), hit -> 'doc' ->> 'id')));
  if m.state <> 'active' or (m.dir = 'k2h' and not v_restore) then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  v_name := coalesce(hit -> 'file' ->> 'name', '');
  if semis_logi_private.ksync_k_blocked(v_name) then
    perform semis_logi_private.ksync_event('type_block', p_ip, p_agent, jsonb_build_object('map', m.id, 'f', semis_logi_private.ksync_txt(v_name, 160)));
    return jsonb_build_object('ok', false, 'error', 'type');
  end if;
  v_size := case when coalesce(hit -> 'file' ->> 'size', '') ~ '^[0-9]{1,12}$' then (hit -> 'file' ->> 'size')::bigint else 0 end;
  -- 덮어쓰기(회차 시작 때 이미 맞춘 K 파일이 있던 판 묶음)는 변경으로 센다 — 서버가 기준선으로 판단
  if exists (select 1 from semis_logi_private.ksync_run_sers s where s.run_id = v_run and s.map_id = m.id
              and s.ser = coalesce(nullif(hit -> 'doc' ->> 'ser', ''), hit -> 'doc' ->> 'id'))
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
          -- 보안 기록은 다른 화면 · 분류의 문서나 민감보안정보 주소를 가리킬 때만. 그 사이 H 에서 지운 문서 · 뺀 첨부는 정상 동기화에서도 생긴다
          -- (지난 실행이 못 보낸 표시를 다음 실행이 다시 보낼 때) — 받지 않기만 한다
          if exists (select 1 from jsonb_array_elements(coalesce(wdocs, docs)) d
                      where jsonb_typeof(d) = 'object' and d ->> 'id' = x ->> 'doc_id'
                        and (d ->> 'mod' is distinct from m.mod or coalesce(d ->> 'grp', '') <> m.grp))
             or (not m.ssi and coalesce(semis_logi_private.ksync_url_path(x ->> 'h_url'), '') like 'docs-ssi/%') then
            perform semis_logi_private.ksync_event('scope', p_ip, p_agent, jsonb_build_object('map', m.id, 'act', 'mark'));
          end if;
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

/* 해시 채우기(관리자가 요청한 동안 · 회차 안에서만) — Edge hash 가 부른다. 해시가 없는 H 첨부를 20개까지(합계 100MB 를 넘기 전까지 — 첫 것은 늘)
   저장소 경로와 함께 준다. 기다리는 주소(ksync_hash_wait)는 빼고, 그 크기를 하루 전송량에 센다. 내준 주소에는 '시도함'을 적는다 —
   Edge 가 결과 없이 멈춰도(작업자 메모리 · 시간) 다음 호출 · 회차가 같은 주소를 되풀이하지 않게(결과가 오면 지우거나 바꿈, 한 시간 뒤 다시).
   남은 것이 없으면 모아 둔 값을 적고, 일시적으로 기다리는 주소도 없으면 요청을 지운다 */
create or replace function semis_logi_private.ksync_hash_todo(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_run bigint := semis_logi_private.ksync_run_of(p_agent, p); v_items jsonb; v_sum bigint;
begin
  if v_run is null then return jsonb_build_object('ok', false, 'error', 'run'); end if;
  if (select s.hash_req from semis_logi_private.ksync_state s where s.id = 1) is null then return jsonb_build_object('ok', false, 'error', 'state'); end if;
  with c as (
    select h.url, least(h.size, 50 * 1024 * 1024) as size, semis_logi_private.ksync_url_path(h.url) as path
      from semis_logi_private.ksync_hash_scope(semis_logi_private.ksync_docs_lock_free()) h
     where h.todo and not semis_logi_private.ksync_hash_wait(h.url)
     order by h.url limit 20
  ), w as (
    select c.*, sum(c.size) over (order by c.url) - c.size as before from c
  )
  select coalesce(jsonb_agg(jsonb_build_object('url', w.url, 'path', w.path, 'size', w.size) order by w.url), '[]'::jsonb), coalesce(sum(w.size), 0)::bigint
    into v_items, v_sum
    from w where w.before < 100 * 1024 * 1024;
  if jsonb_array_length(v_items) = 0 then
    perform semis_logi_private.ksync_hash_flush();
    if not semis_logi_private.ksync_hash_busy(semis_logi_private.ksync_docs_lock_free()) then
      update semis_logi_private.ksync_state set hash_req = null where id = 1;
    end if;
    return jsonb_build_object('ok', true, 'items', '[]'::jsonb, 'left', 0);
  end if;
  if not semis_logi_private.ksync_quota(p_agent, v_sum, p_ip) then return jsonb_build_object('ok', false, 'error', 'quota'); end if;
  insert into semis_logi_private.ksync_hash_skip(url, at, why)
  select x ->> 'url', now(), 'try' from jsonb_array_elements(v_items) x
  on conflict (url) do update set at = excluded.at, why = excluded.why;
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

/* 해시 채우기 결과 — Edge 가 저장소에서 읽어 잰 sha256 은 잰 값 표에 모으고(문서함은 아직 안 고침), 못 읽은 주소는 기다림에 둔다
   ('busy' = 저장소 일시 오류 한 시간 · 그 밖 하루, 'later' = 이번에 안 읽음 — 시도함만 지움). 회차의 마지막 호출(last)이거나 남은 것이 없으면
   모은 값을 한 번에 적는다(문서함 저장은 회차에 한 번). 마지막 호출에 남았으면 다음 깨우기를 요청하고, 남은 것도 일시적으로 기다리는 것도 없으면 요청을 지운다 */
create or replace function semis_logi_private.ksync_hash_set(p_agent bigint, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_run bigint := semis_logi_private.ksync_run_of(p_agent, p); x jsonb; n int := 0; v_left int; v_last boolean := coalesce(p ->> 'last', '') = 'true';
begin
  if v_run is null then return jsonb_build_object('ok', false, 'error', 'run'); end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  for x in select value from jsonb_array_elements(p -> 'items') limit 20 loop
    continue when jsonb_typeof(x) <> 'object' or semis_logi_private.ksync_url_path(x ->> 'url') is null;
    if coalesce(x ->> 'sha', '') ~ '^[0-9a-f]{64}$' then
      insert into semis_logi_private.ksync_hash_val(url, sha) values (x ->> 'url', x ->> 'sha')
      on conflict (url) do update set sha = excluded.sha, at = now();
      delete from semis_logi_private.ksync_hash_skip where url = x ->> 'url';
      n := n + 1;
    elsif coalesce(x ->> 'later', '') = 'true' then
      delete from semis_logi_private.ksync_hash_skip where url = x ->> 'url' and why = 'try';
    else
      insert into semis_logi_private.ksync_hash_skip(url, at, why) values (x ->> 'url', now(), semis_logi_private.ksync_txt(x ->> 'err', 20))
      on conflict (url) do update set at = excluded.at, why = excluded.why;
    end if;
  end loop;
  delete from semis_logi_private.ksync_hash_skip where at < now() - interval '30 days';
  delete from semis_logi_private.ksync_hash_val where at < now() - interval '30 days';
  select count(*) into v_left
    from semis_logi_private.ksync_hash_scope(semis_logi_private.ksync_docs_lock_free()) h
   where h.todo and not semis_logi_private.ksync_hash_wait(h.url);
  if v_last or v_left = 0 then perform semis_logi_private.ksync_hash_flush(); end if;
  update semis_logi_private.ksync_state
     set hash_req = case when v_left = 0 and not semis_logi_private.ksync_hash_busy(semis_logi_private.ksync_docs_lock_free()) then null else hash_req end,
         requested_at = case when v_left > 0 and hash_req is not null and v_last then now() else requested_at end
   where id = 1;
  return jsonb_build_object('ok', true, 'n', n, 'left', v_left);
end $$;

/* ─── 입구(서비스 권한만 — Edge 가 부름) ─── */
create or replace function public.semis_logi_ksync_agent(p_act text, p_key_hash text, p_ip text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a jsonb; v_agent bigint; q jsonb := case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end;
begin
  if coalesce(p_act, '') not in ('hello', 'net', 'folders', 'preview', 'recon', 'run', 'put', 'put_peek', 'put_verify', 'put_apply', 'get', 'mark', 'hash_todo', 'hash_set') then
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
    when 'recon' then semis_logi_private.ksync_recon_set(v_agent, q)
    when 'hash_todo' then semis_logi_private.ksync_hash_todo(v_agent, p_ip, q)
    when 'hash_set' then semis_logi_private.ksync_hash_set(v_agent, p_ip, q)
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
      'ip_seen', st.ip_seen, 'mass_limit', st.mass_limit, 'excludes', st.excludes, 'flags', st.flags),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'created_at', a.created_at, 'created_by', a.created_by,
        'revoked_at', a.revoked_at, 'last_seen_at', a.last_seen_at, 'last_ip', a.last_ip, 'version', a.version, 'host', a.host_label) order by a.id desc)
      from semis_logi_private.ksync_agents a), '[]'::jsonb),
    'maps', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'k_path', m.k_path, 'mod', m.mod, 'grp', m.grp, 'dir', m.dir, 'ssi', m.ssi,
        'state', m.state, 'preview', m.preview, 'hold', m.hold, 'n_files', m.n_files, 'last_run_at', m.last_run_at, 'since', m.since,
        'excludes', m.excludes, 'report', m.report, 'dir_next', m.dir_next, 'recon', m.recon,
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
  -- 화면이 보안 이벤트 목록을 실제로 보여 줄 때만(seen) '본 것'으로 — 탭을 열기만 해서 새 이벤트 경고가 꺼지지 않게.
  -- 종류로 거른 목록은 다른 종류의 새 이벤트를 보여 주지 않으므로 '본 것'이 아니다
  if coalesce((p ->> 'seen')::boolean, false) and k is null then
    update semis_logi_private.ksync_state set ev_seen_at = now() where id = 1;
  end if;
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

/* 보고 — 연결 안 된 폴더(에이전트가 하루 한 번 알려 준 3단계 나무 기준) · 활성 연결의 마지막 실행이 센 범위 밖 이유별 건수 · 불일치 · 지정 제외 수.
   연결 안 된 폴더 = 어느 연결 · 전체 제외에도 들지 않은 폴더 중 ① 아래도 모두 연결 밖인 맨 위 폴더(n = 그 아래 3단계까지 파일 수) ·
   ② 아래에 연결이 있는 폴더 바로 아래 파일(part — n = 그 폴더 바로 아래 파일 수, 있을 때만). K 로 안 간 H 문서 = K → H 만 연결의 H 문서 ·
   K 로 쓰지 않는 형식 · 쓸 수 없는 이름 */
create or replace function public.semis_logi_ksync_report() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare st semis_logi_private.ksync_state; v_f jsonb;
begin
  perform semis_logi_private.ksync_admin();
  select * into st from semis_logi_private.ksync_state where id = 1;
  with f as (
    select path, max(n_files) n from semis_logi_private.ksync_folders group by path
  ), c as (
    select f.*,
           exists (select 1 from semis_logi_private.ksync_maps m where lower(f.path) = lower(m.k_path) or starts_with(lower(f.path), lower(m.k_path) || '/'))
             or semis_logi_private.ksync_under(f.path, st.excludes) as cov,
           exists (select 1 from semis_logi_private.ksync_maps m where starts_with(lower(m.k_path), lower(f.path) || '/'))
             or exists (select 1 from jsonb_array_elements_text(st.excludes) e where starts_with(lower(e), lower(f.path) || '/')) as part
      from f
  )
  select coalesce(jsonb_agg(jsonb_build_object('path', c.path, 'part', c.part,
           'n', case when c.part then c.n else (select coalesce(sum(d.n), 0)::int from c d where d.path = c.path or starts_with(d.path, c.path || '/')) end) order by c.path), '[]'::jsonb)
    into v_f
    from c
   where not c.cov
     and ((c.part and c.n > 0)
          or (not c.part and (position('/' in c.path) = 0
                              or exists (select 1 from c p where p.path = regexp_replace(c.path, '/[^/]*$', '') and p.part))));
  return jsonb_build_object('ok', true, 'folders', v_f, 'at', (select max(seen_at) from semis_logi_private.ksync_folders),
    'out', coalesce((select jsonb_object_agg(q.k, q.s) from (select e.k, sum(e.v::int)::int s from semis_logi_private.ksync_maps m, jsonb_each_text(coalesce(m.report -> 'out', '{}'::jsonb)) e(k, v)
                      where m.state = 'active' and e.v ~ '^[0-9]{1,9}$' group by e.k) q), '{}'::jsonb),
    'sum', jsonb_build_object(
      'mismatch', coalesce((select sum((m.report ->> 'mismatch')::int) from semis_logi_private.ksync_maps m where m.state = 'active' and coalesce(m.report ->> 'mismatch', '') ~ '^[0-9]{1,9}$'), 0),
      'old', coalesce((select sum((m.report -> 'out' ->> 'old')::int) from semis_logi_private.ksync_maps m where m.state = 'active' and coalesce(m.report -> 'out' ->> 'old', '') ~ '^[0-9]{1,9}$'), 0),
      'h_out', coalesce((select sum(case when m.dir = 'k2h' and coalesce(m.report -> 'out' ->> 'dir', '') ~ '^[0-9]{1,9}$' then (m.report -> 'out' ->> 'dir')::int else 0 end
                                    + case when coalesce(m.report -> 'out' ->> 'type_block', '') ~ '^[0-9]{1,9}$' then (m.report -> 'out' ->> 'type_block')::int else 0 end
                                    + case when coalesce(m.report -> 'out' ->> 'name', '') ~ '^[0-9]{1,9}$' then (m.report -> 'out' ->> 'name')::int else 0 end)
                           from semis_logi_private.ksync_maps m where m.state = 'active'), 0),
      'excl', jsonb_array_length(st.excludes) + coalesce((select sum(jsonb_array_length(m.excludes)) from semis_logi_private.ksync_maps m), 0)::int));
end $$;

create or replace function public.semis_logi_ksync_map_save(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin(); m semis_logi_private.ksync_maps; v_k text; v_mod text; v_grp text; v_dir text; v_id bigint;
  v_redo boolean; v_since date; v_ex jsonb; v_chg boolean; v_switch boolean; v_add boolean;
begin
  if jsonb_typeof(p) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  if coalesce(p ->> 'id', '') ~ '^[0-9]{1,15}$' then
    select * into m from semis_logi_private.ksync_maps where id = (p ->> 'id')::bigint for update;
    if m.id is null then return jsonb_build_object('ok', false, 'error', 'gone'); end if;
  end if;
  if m.id is not null and coalesce((p ->> 'pause')::boolean, false) then
    -- 멈추면 양쪽 미리보기 건수는 버린다(다시 시작하면 새로 셈 — 멈춘 사이의 변경 · 거절한 보류를 옛 건수로 덮지 않게)
    update semis_logi_private.ksync_maps set state = 'paused', recon = null, updated_at = now(), updated_by = me where id = m.id;
    return jsonb_build_object('ok', true, 'id', m.id);
  end if;
  -- '양쪽' 전환 미리보기 요청(다시 요청하면 다시 셈) · 그만(빈 값) — 돌고 있고 아직 양쪽이 아닌 연결만. 연결 설정은 바꾸지 않는다(K 에 쓰는 것도 없음)
  if m.id is not null and p ? 'dir_next' then
    if coalesce(p ->> 'dir_next', '') = '' then
      update semis_logi_private.ksync_maps set dir_next = null, recon = null where id = m.id;
      return jsonb_build_object('ok', true, 'id', m.id);
    end if;
    if p ->> 'dir_next' <> 'both' then return jsonb_build_object('ok', false, 'error', 'dir'); end if;
    if m.state <> 'active' or m.dir = 'both' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
    update semis_logi_private.ksync_maps set dir_next = 'both', recon = null where id = m.id;
    update semis_logi_private.ksync_state set requested_at = now() where id = 1;
    return jsonb_build_object('ok', true, 'id', m.id);
  end if;
  v_k := semis_logi_private.ksync_rel(coalesce(p ->> 'k_path', m.k_path));
  v_mod := coalesce(p ->> 'mod', m.mod); v_grp := coalesce(p ->> 'grp', m.grp);
  v_dir := coalesce(p ->> 'dir', m.dir, 'both');
  if v_k is null or v_k ~ '(^|/)(_H드라이브_휴지통|_H드라이브_이전판)(/|$)' then return jsonb_build_object('ok', false, 'error', 'k_path'); end if;
  if coalesce(v_mod, '') !~ '^[a-z][a-z0-9-]{1,39}$' or coalesce(v_grp, '') !~ '^[A-Za-z0-9_-]{1,40}$' then return jsonb_build_object('ok', false, 'error', 'target'); end if;
  if v_dir not in ('both', 'k2h', 'h2k') then return jsonb_build_object('ok', false, 'error', 'dir'); end if;
  -- 전체 지정 제외 아래 폴더는 잇지 않는다(그 아래는 동기화 · 보고 모두 하지 않기로 한 곳)
  if semis_logi_private.ksync_under(v_k, (select s.excludes from semis_logi_private.ksync_state s where s.id = 1)) then
    return jsonb_build_object('ok', false, 'error', 'excluded');
  end if;
  -- 이 연결에서 뺄 경로(연결 폴더 안). 키가 없으면 그대로
  v_ex := coalesce(m.excludes, '[]'::jsonb);
  if p ? 'excludes' then
    v_ex := semis_logi_private.ksync_excl(p -> 'excludes');
    if v_ex is null then return jsonb_build_object('ok', false, 'error', 'excludes'); end if;
  end if;
  -- 기준일: 'YYYY-MM-DD'(있는 날) 또는 빈 값 · null(없앰). 키가 없으면 그대로(방향 · SSI 만 고치는 편집이 기준일을 지우지 않게)
  v_since := m.since;
  if p ? 'since' then
    v_since := null;
    if coalesce(p ->> 'since', '') <> '' then
      if p ->> 'since' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return jsonb_build_object('ok', false, 'error', 'since'); end if;
      begin
        v_since := (p ->> 'since')::date;
      exception when others then
        return jsonb_build_object('ok', false, 'error', 'since');
      end;
    end if;
  end if;
  -- 돌기 시작한 뒤에는 더 늦은 날로만(좁히기) — 비우거나 이르게 하면 옛 파일이 한꺼번에 '새 파일'로 올라간다(새 파일은 대량 변경 보류에 세지 않음)
  if m.id is not null and m.state <> 'preview' and v_since is distinct from m.since and (v_since is null or v_since < m.since) then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  -- 맞춘 파일이 있는 연결은 폴더 · 화면 · 분류를 바꾸지 않는다(기준선이 어긋남) — 지우고 새로 연결
  if m.id is not null and (lower(v_k) <> lower(m.k_path) or v_mod <> m.mod or v_grp <> m.grp)
     and exists (select 1 from semis_logi_private.ksync_files f where f.map_id = m.id) then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;
  -- 겹침 = 같은 폴더이거나 한쪽이 다른 쪽 아래 — 글자 그대로 앞부분 비교('_' · '%' 가 든 폴더 이름이 LIKE 의 와일드카드로 읽히지 않게)
  if exists (select 1 from semis_logi_private.ksync_maps x where x.id is distinct from m.id
              and (lower(x.k_path) = lower(v_k) or starts_with(lower(v_k), lower(x.k_path) || '/') or starts_with(lower(x.k_path), lower(v_k) || '/'))) then
    return jsonb_build_object('ok', false, 'error', 'k_dup');
  end if;
  if exists (select 1 from semis_logi_private.ksync_maps x where x.id is distinct from m.id and x.mod = v_mod and x.grp = v_grp) then
    return jsonb_build_object('ok', false, 'error', 'target_dup');
  end if;
  -- 돌던(미리보기 아닌) 한 방향 연결에 방향을 더하는 바꾸기는 모두 관문을 거친다 — 보내지 않던 쪽이 한꺼번에 온다(H 에만 있는 문서가 K 에
  -- '이름 (2)' 로 · H 새 판이 K 를 덮음 · K 백로그가 H 로). 한 방향끼리(K → H 만 ↔ H → K 만)는 바로 바꾸지 않는다(oneway — 양쪽으로 바꾼 뒤 줄임).
  -- 양쪽으로 바꿀 때는 그 방향으로 센 미리보기(recon)가 있어야 한다: 이틀 안에 셌고 · 보류 없는 계획으로 셌고(held 아님) · 'K 이름 (2)' 로
  -- 내려올 것(dup)이 0 이고 · 방향 말고는 센 때 설정 그대로. 승인 전 대량 변경 보류가 있으면 바꾸지 않는다(첫 회차 승인으로 덮으면 그 보류를 승인한 것이 된다)
  v_add := m.id is not null and m.state <> 'preview' and m.dir <> 'both' and v_dir <> m.dir;
  if v_add and v_dir <> 'both' then return jsonb_build_object('ok', false, 'error', 'oneway'); end if;
  v_switch := v_add;
  if v_switch then
    if m.state <> 'active' then return jsonb_build_object('ok', false, 'error', 'state'); end if;
    if (m.hold is not null and not coalesce((m.hold ->> 'ok')::boolean, false)) or coalesce((m.recon ->> 'held')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'hold');
    end if;
    if m.recon is null or m.dir_next is distinct from 'both' or coalesce(m.recon ->> 'at', '') = ''
       or (m.recon ->> 'at')::timestamptz < now() - interval '2 days'
       or (v_k, v_mod, v_grp, coalesce((p ->> 'ssi')::boolean, m.ssi), v_since, v_ex) is distinct from (m.k_path, m.mod, m.grp, m.ssi, m.since, m.excludes) then
      return jsonb_build_object('ok', false, 'error', 'recon');
    end if;
    if coalesce(m.recon ->> 'dup', '') !~ '^[0-9]{1,9}$' or (m.recon ->> 'dup')::int > 0 then return jsonb_build_object('ok', false, 'error', 'dup'); end if;
  end if;
  if m.id is null then
    insert into semis_logi_private.ksync_maps(k_path, mod, grp, dir, ssi, since, excludes, state, created_by, updated_by)
    values (v_k, v_mod, v_grp, v_dir, coalesce((p ->> 'ssi')::boolean, false), v_since, v_ex, 'preview', me, me) returning id into v_id;
    update semis_logi_private.ksync_state set requested_at = now() where id = 1;     -- 미리보기 건수를 받으려고
  else
    v_chg := (v_k, v_mod, v_grp, v_dir, coalesce((p ->> 'ssi')::boolean, m.ssi), v_since, v_ex) is distinct from (m.k_path, m.mod, m.grp, m.dir, m.ssi, m.since, m.excludes);
    -- 미리보기 중에 폴더 · 대상 · 방향 · SSI · 기준일 · 뺄 경로를 바꾸면 옛 건수로 [시작]하지 않게 건수를 지우고 다시 받는다.
    -- '양쪽' 미리보기(recon)도 같다 — 설정을 고치면 지우고(dir_next 가 있으면 다시 셈), 옛 설정으로 센 건수로 바꾸지 않게
    v_redo := m.state = 'preview' and v_chg;
    -- 바꾸는 순간 첫 회차 승인을 심는다([시작]과 같은 기계): 한 방향일 때 보내지 않던 몫이 한꺼번에 오므로 대량 변경 한도에 걸리기 쉽다.
    -- 승인 건수 = 서버가 실제로 세는 것과 같은 기준 = 미리보기 변경 수(n — 새 판 · 덮어쓰기 · 새 삭제 대기) + 옛 판 연결(link_old — 다음 회차에
    -- 현재 판으로 덮어씀), 승인한 보류가 남아 있으면 그 건수를 더함. 전체 건수(total)로 하면 받기 · 연결만까지 셈해 승인이 너무 넓다.
    -- 그 건수 + 한도를 넘으면 다시 보류(ksync_count). 방향을 다르게 바꾸면(양쪽에서 되돌림 등) 아직 쓰지 않은 첫 회차 승인은 지운다(옛 방향으로 센 승인)
    update semis_logi_private.ksync_maps set k_path = v_k, mod = v_mod, grp = v_grp, dir = v_dir,
      ssi = coalesce((p ->> 'ssi')::boolean, ssi), since = v_since, excludes = v_ex, preview = case when v_redo then null else preview end,
      recon = case when v_chg then null else recon end,
      dir_next = case when v_switch or v_dir = dir_next then null else dir_next end,
      hold = case when v_switch then jsonb_build_object('ok', true, 'at', now(), 'first', true,
                     'n', (case when coalesce(m.recon ->> 'n', '') ~ '^[0-9]{1,9}$' then (m.recon ->> 'n')::int else 0 end)
                          + (case when coalesce(m.recon ->> 'link_old', '') ~ '^[0-9]{1,9}$' then (m.recon ->> 'link_old')::int else 0 end)
                          + case when coalesce((m.hold ->> 'ok')::boolean, false) and coalesce(m.hold ->> 'n', '') ~ '^[0-9]{1,9}$' then (m.hold ->> 'n')::int else 0 end)
                  when v_dir <> m.dir and coalesce((m.hold ->> 'ok')::boolean, false) and coalesce((m.hold ->> 'first')::boolean, false) then null
                  else hold end,
      updated_at = now(), updated_by = me where id = m.id;
    if v_redo or v_switch or (v_chg and m.dir_next is not null and v_dir <> m.dir_next) then
      update semis_logi_private.ksync_state set requested_at = now() where id = 1;
    end if;
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
  -- 미리보기를 보고 시작 = 첫 실행 승인(처음 맞추는 건수는 대량 변경 한도를 넘기 쉽다). 승인 건수 n = 미리보기 전체 건수 —
  -- 이 승인은 그 건수 + 한도까지만 덮는다(ksync_count). 건수가 아직 없으면(설정을 고친 뒤 · 다른 창의 옛 화면) 시작하지 않는다.
  -- H → K 를 받는 미리보기 연결(양쪽 · H → K 만)은 K 에 '이름 (2)' 로 내려올 것(name2)이 0 이어야 한다(돌던 연결의 양쪽 전환과 같은 관문)
  if exists (select 1 from semis_logi_private.ksync_maps x where x.id = p_id and x.state = 'preview' and x.dir <> 'k2h'
              and coalesce(x.preview ->> 'name2', '') ~ '^[0-9]{1,9}$' and (x.preview ->> 'name2')::int > 0) then
    return jsonb_build_object('ok', false, 'error', 'dup');
  end if;
  -- 멈췄던 연결을 다시 시작하면 양쪽 미리보기 건수는 버린다(새로 셈)
  update semis_logi_private.ksync_maps
     set state = 'active', recon = null,
         hold = case when state = 'preview' then jsonb_build_object('ok', true, 'at', now(), 'first', true,
                       'n', case when coalesce(preview ->> 'total', '') ~ '^[0-9]{1,9}$' then (preview ->> 'total')::int else 0 end) else hold end,
         updated_at = now(), updated_by = me
   where id = p_id and (state = 'paused' or (state = 'preview' and preview is not null));
  if not found then
    return jsonb_build_object('ok', false, 'error',
      case when exists (select 1 from semis_logi_private.ksync_maps where id = p_id and state = 'preview') then 'preview' else 'state' end);
  end if;
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
  docs jsonb; dirty boolean := false; n int := 0; v_ask boolean := false; v_solo boolean; cur jsonb; v_cf jsonb; v_bdate text; v_kept int := 0; v_ser text;
  v_moved boolean;
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
      if docs is null then docs := semis_logi_private.ksync_docs_lock(); end if;
      v_ser := fr.ser;
      cur := semis_logi_private.ksync_cur(docs, m.mod, m.grp, v_ser);
      -- 문서함에서 그 판만 다른 판 묶음으로 옮겼으면(옛 판은 옛 묶음에 남음) 계획처럼 주소로 따라가 지금 판에 이 파일이 있는 판 묶음을 본다.
      -- 옛 묶음으로 보면 H 가 새 판을 만들지 않았는데도 'H 에 새 판'으로 남고, 다음 실행이 다시 삭제 대기로 돌려 확정할 때마다 되풀이한다
      if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(cur -> 'files') = 'array' then cur -> 'files' else '[]'::jsonb end) f
                      where f ->> 'url' = fr.h_url) then
        v_ser := coalesce((select s.ser from (select distinct coalesce(nullif(d ->> 'ser', ''), d ->> 'id') as ser from jsonb_array_elements(docs) d
                                                where jsonb_typeof(d) = 'object' and d ->> 'mod' = m.mod and coalesce(d ->> 'grp', '') = m.grp
                                                  and jsonb_typeof(d -> 'files') = 'array'
                                                  and exists (select 1 from jsonb_array_elements(d -> 'files') f where f ->> 'url' = fr.h_url)) s,
                                  lateral (select semis_logi_private.ksync_cur(docs, m.mod, m.grp, s.ser) -> 'files' as fs) c
                            where s.ser <> fr.ser and jsonb_typeof(c.fs) = 'array'
                              and exists (select 1 from jsonb_array_elements(c.fs) f where f ->> 'url' = fr.h_url)
                            order by s.ser limit 1), fr.ser);
        cur := semis_logi_private.ksync_cur(docs, m.mod, m.grp, v_ser);
      end if;
      -- K 에서 지운 뒤 H 가 고쳤으면(지금 판에 이 파일이 없음) · 지금 판이 이 연결이 볼 수 없는 민감보안정보면 지우지 않는다 —
      -- 고친 것이 삭제 대기보다 우선(K 는 그 판을 본 적이 없다). 충돌로 돌려 관리자가 보게 하고, 다음 실행이 H 판을 K 로 받는다.
      -- 지금 판의 첨부가 모두 같은 판 묶음의 다른 기준선 줄이 맞추는 파일이면 H 는 이 첨부를 뺐을 뿐(양쪽에서 지움 — 새 판이 아님)이라 지운다
      v_cf := case when jsonb_typeof(cur -> 'files') = 'array' then cur -> 'files' else '[]'::jsonb end;
      if cur is not null
         and ((not exists (select 1 from jsonb_array_elements(v_cf) f where f ->> 'url' = fr.h_url)
               and (jsonb_array_length(v_cf) = 0
                    or exists (select 1 from jsonb_array_elements(v_cf) f
                                where not exists (select 1 from semis_logi_private.ksync_files o
                                                   where o.map_id = fr.map_id and o.ser = v_ser and o.id <> fr.id and o.h_url = f ->> 'url'))))
              or (not m.ssi and (coalesce((cur ->> 'ssi')::boolean, false)
                                 or exists (select 1 from jsonb_array_elements(v_cf) f
                                             where semis_logi_private.ksync_url_path(f ->> 'url') like 'docs-ssi/%')))) then
        update semis_logi_private.ksync_files set state = 'conflict', note = 'H 에 새 판' where id = fr.id;
        v_kept := v_kept + 1;
        continue;
      end if;
      -- K 에서 지운 파일 확정 → 그 판 묶음 문서에서 이 파일(기준선 주소)을 빼고, 파일이 남지 않은 문서는 지운다.
      -- 이름으로 고르는 것은 기준선 판보다 늦지 않은 판만(그 뒤 H 가 만든 판은 K 가 본 적 없는 H 작업):
      -- 충돌 때 이전 판으로 남긴 '이름 (충돌 날짜[ n]).확장자' 도 같은 파일 — 남기면 그 판이 현재 판이 된다.
      -- 이 판 묶음에서 맞춘 파일이 이것 하나뿐이면 첨부가 하나인 판은 이름이 달라도 이 파일의 판이다
      -- (H 새 판의 다른 이름 · K 이름 바꿈 · 그때 이름으로 남긴 충돌 사본 — 이름으로만 고르면 옛 판이 현재 판이 되어 K 로 되돌아온다).
      -- 주소로 따라간 판 묶음(H 가 이 판만 옮겨 넣음)의 다른 판은 이 파일의 이력이 아니라 그 묶음 자신의 판이다 — 기준선 주소의 첨부만 뺀다.
      -- 어느 경우든 다른 기준선 줄이 맞추는 파일(같은 이름 첨부 · 옮겨 온 판)과, SSI 아닌 연결이 볼 수 없는 민감보안정보 판 · 파일은 남긴다 —
      -- 지우면 그 줄은 다음 실행에서 'H 에서 지움'이 되고, 확정하면 맞춰 둔 K 파일까지 휴지통으로 간다
      v_moved := v_ser is distinct from fr.ser;
      v_solo := not exists (select 1 from semis_logi_private.ksync_files o where o.map_id = fr.map_id and o.ser = v_ser and o.id <> fr.id);
      -- 기준선 판 날짜 — 그 문서가 없으면 이 파일이 든 가장 늦은 판
      v_bdate := coalesce(
        (select coalesce(d ->> 'date', '') from jsonb_array_elements(docs) d
          where jsonb_typeof(d) = 'object' and d ->> 'id' = fr.doc_id and d ->> 'mod' = m.mod and coalesce(d ->> 'grp', '') = m.grp
            and coalesce(nullif(d ->> 'ser', ''), d ->> 'id') = v_ser limit 1),
        (select max(coalesce(d ->> 'date', '')) from jsonb_array_elements(docs) d
          where jsonb_typeof(d) = 'object' and d ->> 'mod' = m.mod and coalesce(d ->> 'grp', '') = m.grp and coalesce(nullif(d ->> 'ser', ''), d ->> 'id') = v_ser
            and jsonb_typeof(d -> 'files') = 'array' and exists (select 1 from jsonb_array_elements(d -> 'files') f where f ->> 'url' = fr.h_url)), '');
      if cur is not null then
        docs := coalesce((select jsonb_agg(v order by idx) from (
            select d.idx, case when jsonb_typeof(d.value) = 'object' and d.value ->> 'mod' = m.mod and coalesce(d.value ->> 'grp', '') = m.grp
                                    and coalesce(nullif(d.value ->> 'ser', ''), d.value ->> 'id') = v_ser and jsonb_typeof(d.value -> 'files') = 'array'
                               then jsonb_set(d.value, '{files}', coalesce((select jsonb_agg(f.value order by f.i) from jsonb_array_elements(d.value -> 'files') with ordinality f(value, i)
                                                                              where not ((f.value ->> 'url' is not distinct from fr.h_url
                                                                                          or (not v_moved and coalesce(d.value ->> 'date', '') <= v_bdate
                                                                                              and ((v_solo and jsonb_array_length(d.value -> 'files') = 1)
                                                                                                   or f.value ->> 'name' is not distinct from fr.h_name
                                                                                                   or regexp_replace(coalesce(f.value ->> 'name', ''), ' \(충돌 \d{4}-\d{2}-\d{2}( \d+)?\)(\.[^./]{1,10})?$', '\2')
                                                                                                      is not distinct from fr.h_name)))
                                                                                         and not exists (select 1 from semis_logi_private.ksync_files o
                                                                                                          where o.map_id = fr.map_id and o.id <> fr.id and o.h_url = f.value ->> 'url')
                                                                                         and (m.ssi or (not coalesce((d.value ->> 'ssi')::boolean, false)
                                                                                                        and coalesce(semis_logi_private.ksync_url_path(f.value ->> 'url'), '') not like 'docs-ssi/%')))), '[]'::jsonb))
                               else d.value end as v, d.value as o
              from jsonb_array_elements(docs) with ordinality d(value, idx)) q
          -- 지우는 문서는 이번에 첨부를 빼서 비게 된 것만(처음부터 첨부가 없던 판은 이 파일의 판이 아니다)
          where not (jsonb_typeof(v) = 'object' and v ->> 'mod' = m.mod and coalesce(v ->> 'grp', '') = m.grp
                     and coalesce(nullif(v ->> 'ser', ''), v ->> 'id') = v_ser and jsonb_typeof(v -> 'files') = 'array' and jsonb_array_length(v -> 'files') = 0
                     and jsonb_array_length(o -> 'files') > 0)), '[]'::jsonb);
        dirty := true;
      end if;
      delete from semis_logi_private.ksync_files where id = fr.id;
    end if;
    n := n + 1;
  end loop;
  if dirty then perform semis_logi_private.ksync_docs_save(docs); end if;
  if v_ask then update semis_logi_private.ksync_state set requested_at = now() where id = 1; end if;
  -- kept = H 에 새 판이 있어 지우지 않고 충돌로 돌린 줄 수
  return jsonb_build_object('ok', true, 'n', n, 'by', me, 'kept', v_kept);
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
    update semis_logi_private.ksync_maps set hold = null, state = 'paused', recon = null, updated_at = now(), updated_by = me
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

/* H 첨부 해시 채우기 — 진행(연결이 볼 수 있는 H 첨부 주소: 전체 · 해시 있음 · 남음 · 하루 건너뜀(읽지 못함)) · {start: true} 면 요청.
   에이전트가 다음 회차부터 Edge hash 로 채운다(저장소에서 읽어 잼 — 에이전트 · 화면이 값을 보내지 않음). 문서함 첨부에 sha 칸만 더한다 */
create or replace function public.semis_logi_ksync_hash_todo(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me text := semis_logi_private.ksync_admin(); v_total int; v_todo int; v_skip int; v_pend int; v_req timestamptz;
begin
  -- 진행: 해시 있음(done — 잰 값을 아직 안 적은 것 pend 도 셈) · 남음(todo) · 기다림(skip — 못 읽음 · 일시 오류 · 시도 중)
  select count(*)::int,
         (count(*) filter (where h.todo and not semis_logi_private.ksync_hash_wait(h.url)))::int,
         (count(*) filter (where h.todo and semis_logi_private.ksync_hash_wait(h.url)
                             and not exists (select 1 from semis_logi_private.ksync_hash_val v where v.url = h.url)))::int,
         (count(*) filter (where h.todo and exists (select 1 from semis_logi_private.ksync_hash_val v where v.url = h.url)))::int
    into v_total, v_todo, v_skip, v_pend
    from semis_logi_private.ksync_hash_scope(semis_logi_private.ksync_docs_lock_free()) h;
  if jsonb_typeof(p) = 'object' and coalesce(p ->> 'start', '') = 'true' and v_todo + v_pend > 0 then
    update semis_logi_private.ksync_state set hash_req = now(), requested_at = now() where id = 1;
  end if;
  select s.hash_req into v_req from semis_logi_private.ksync_state s where s.id = 1;
  return jsonb_build_object('ok', true, 'total', v_total, 'done', v_total - v_todo - v_skip, 'todo', v_todo, 'skip', v_skip, 'pend', v_pend, 'req', v_req, 'by', me);
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
declare me text := semis_logi_private.ksync_admin(); v_allow jsonb := '[]'::jsonb; x text; c text; f int; r numeric; v_ex jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return jsonb_build_object('ok', false, 'error', 'bad'); end if;
  -- 전체 지정 제외 — 이미 이은 연결 폴더를 덮는 경로는 받지 않는다(그 연결을 먼저 지우거나 연결마다 제외로)
  if p ? 'excludes' then
    v_ex := semis_logi_private.ksync_excl(p -> 'excludes');
    if v_ex is null then return jsonb_build_object('ok', false, 'error', 'excludes'); end if;
    if exists (select 1 from semis_logi_private.ksync_maps m where semis_logi_private.ksync_under(m.k_path, v_ex)) then
      return jsonb_build_object('ok', false, 'error', 'excluded');
    end if;
    update semis_logi_private.ksync_state set excludes = v_ex where id = 1;
  end if;
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

/* ─── H → K 준실시간 — 문서함에서 사람이 고치면 '지금 동기화 요청'을 켠다 ───
   H → K 를 받는 활성 연결(양쪽 · H → K 만)의 화면 · 분류 문서가 바뀐 때만. 동기화 · 관리 동작이 고친 것(updated_by 가 '…/ksync')은 보지 않는다 —
   자기 변경에 다시 깨어나지 않게(관리 동작은 필요하면 스스로 요청을 켠다). 에이전트가 10분마다 깨어 요청을 보고 맞춘다.
   어떤 오류도 문서함 저장을 막지 않는다. 운영 중인 변경 알림 트리거(notify_change)와 따로 둔다 */
create or replace function semis_logi_private.ksync_docs_of(p jsonb, p_mod text, p_grp text) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(x.value order by x.idx), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality x(value, idx)
   where jsonb_typeof(x.value) = 'object' and x.value ->> 'mod' = p_mod and coalesce(x.value ->> 'grp', '') = p_grp
$$;
create or replace function semis_logi_private.ksync_req_on_docs() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare v_old jsonb; v_lt text;
begin
  if new.key is distinct from 'docs' or coalesce(new.updated_by, '') like '%/ksync' then return null; end if;
  if tg_op = 'UPDATE' then
    if old.value is not distinct from new.value then return null; end if;     -- 내용이 같은 저장
    v_old := old.value;
  end if;
  if not exists (select 1 from semis_logi_private.ksync_maps m where m.state = 'active' and m.dir <> 'k2h') then return null; end if;
  if exists (select 1 from semis_logi_private.ksync_maps m
              where m.state = 'active' and m.dir <> 'k2h'
                and semis_logi_private.ksync_docs_of(v_old, m.mod, m.grp) is distinct from semis_logi_private.ksync_docs_of(new.value, m.mod, m.grp)) then
    -- 문서함 저장은 오래 기다리지 않는다 — 상태 줄을 다른 동기화 트랜잭션이 잡고 있으면 0.3초까지만 기다리고(그쪽은 줄을 맨 끝에 잡아 곧 끝남),
    -- 넘으면 아래 예외 처리로 요청만 건너뛰고 저장은 그대로. 잠금 대기 한도는 이 갱신에만(그 저장의 나머지에는 원래 값).
    -- 시각은 늘 새로(회차 시작은 계획이 본 문서함 시각 전에 켜진 요청만 끈다 — 그 뒤 고친 것이 남는다)
    v_lt := current_setting('lock_timeout');
    perform set_config('lock_timeout', '300ms', true);
    update semis_logi_private.ksync_state set requested_at = clock_timestamp() where id = 1;
    perform set_config('lock_timeout', v_lt, true);
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists semis_logi_store_ksync_req on public.semis_logi_store;
create trigger semis_logi_store_ksync_req after insert or update on public.semis_logi_store
  for each row when (new.key = 'docs') execute function semis_logi_private.ksync_req_on_docs();

/* ─── 실행 권한 ─── */
revoke all on function public.semis_logi_ksync_agent(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.semis_logi_ksync_agent(text, text, text, jsonb) to service_role;
revoke all on function public.semis_logi_ksync_status(), public.semis_logi_ksync_runs(jsonb), public.semis_logi_ksync_events(jsonb),
  public.semis_logi_ksync_folders(), public.semis_logi_ksync_report(), public.semis_logi_ksync_map_save(jsonb), public.semis_logi_ksync_map_delete(bigint),
  public.semis_logi_ksync_map_start(bigint), public.semis_logi_ksync_pending(), public.semis_logi_ksync_resolve(jsonb),
  public.semis_logi_ksync_hold(jsonb), public.semis_logi_ksync_request(), public.semis_logi_ksync_settings(jsonb),
  public.semis_logi_ksync_ip_approve(text), public.semis_logi_ksync_agent_new(text), public.semis_logi_ksync_agent_revoke(bigint),
  public.semis_logi_ksync_hash_todo(jsonb)
  from public, authenticated;
grant execute on function public.semis_logi_ksync_status(), public.semis_logi_ksync_runs(jsonb), public.semis_logi_ksync_events(jsonb),
  public.semis_logi_ksync_folders(), public.semis_logi_ksync_report(), public.semis_logi_ksync_map_save(jsonb), public.semis_logi_ksync_map_delete(bigint),
  public.semis_logi_ksync_map_start(bigint), public.semis_logi_ksync_pending(), public.semis_logi_ksync_resolve(jsonb),
  public.semis_logi_ksync_hold(jsonb), public.semis_logi_ksync_request(), public.semis_logi_ksync_settings(jsonb),
  public.semis_logi_ksync_ip_approve(text), public.semis_logi_ksync_agent_new(text), public.semis_logi_ksync_agent_revoke(bigint),
  public.semis_logi_ksync_hash_todo(jsonb)
  to anon, service_role;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'semis_logi_private' and p.proname like 'ksync\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
