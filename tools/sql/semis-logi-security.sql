/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 서버 보안 (v1.15.0, 2026-09-25)
   1단계(추가만): 계정·세션·권한표·RPC·세션 기반 RLS 정책·변경 알림
   - 기존 anon 정책은 2단계(semis-logi-lockdown.sql)에서 제거한다.
   - 이 파일은 참고용 사본이다. 실제 적용은 Supabase 마이그레이션으로 했다.
   ═══════════════════════════════════════════════════════ */

create schema if not exists semis_logi_private;
revoke all on schema semis_logi_private from public;
grant usage on schema semis_logi_private to anon, authenticated, service_role;

/* ─── 계정 · 세션 · 시도 · 감사 · 권한표 ─── */
create table if not exists semis_logi_private.accounts (
  id            text primary key,                 -- 고정 키(구 origId)
  login_id      text not null unique,             -- 화면에 보이는 계정 ID
  name          text not null,
  role          text not null check (role in ('admin','hq','manager','user','vendor')),
  vendor        text not null default '',
  pw_hash       text not null,                    -- bcrypt( sha256('SeMISv2::'||암호) hex )
  base          boolean not null default false,
  disabled      boolean not null default false,
  pw_changed_at timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists semis_logi_private.sessions (
  token_hash      text primary key,               -- sha256(토큰) — 토큰 원문은 저장하지 않음
  account_id      text references semis_logi_private.accounts(id) on delete cascade,
  kind            text not null default 'user' check (kind in ('user','signer')),
  minute_id       text,
  created_at      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  expires_at      timestamptz not null,
  hard_expires_at timestamptz not null,
  ip              text,
  ua              text
);
create index if not exists sessions_account_idx on semis_logi_private.sessions(account_id);
create table if not exists semis_logi_private.login_attempts (
  id   bigserial primary key,
  at   timestamptz not null default now(),
  ip   text,
  ok   boolean not null,
  kind text
);
create index if not exists login_attempts_ip_at_idx on semis_logi_private.login_attempts(ip, at);
create table if not exists semis_logi_private.audit (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  actor  text,
  action text not null,
  detail jsonb,
  ip     text
);
create index if not exists audit_at_idx on semis_logi_private.audit(at desc);
create table if not exists semis_logi_private.key_acl (
  key        text primary key,
  read_rank  int not null,
  write_rank int not null
);
alter table semis_logi_private.accounts       enable row level security;
alter table semis_logi_private.sessions       enable row level security;
alter table semis_logi_private.login_attempts enable row level security;
alter table semis_logi_private.audit          enable row level security;
alter table semis_logi_private.key_acl        enable row level security;
revoke all on all tables    in schema semis_logi_private from public, anon, authenticated;
revoke all on all sequences in schema semis_logi_private from public, anon, authenticated;

/* 권한 서열: admin 4 · hq 3 · manager 2 · user/vendor 1 · 9 = 앱에서 읽기·쓰기 불가 */
insert into semis_logi_private.key_acl(key, read_rank, write_rank) values
  ('menus',1,4), ('notices',1,3), ('levelHistory',1,3), ('safetyBoard',1,3), ('fleet',1,3), ('chatRooms',1,3),
  ('minutes',1,2), ('minuteFolders',1,2),
  ('schedules',2,2), ('assignees',2,4), ('assigneesSeeded',2,4), ('gcal',2,4),
  ('contacts',2,3), ('crisis',2,3), ('regulations',2,3), ('equipment',2,3), ('caresCfg',2,9),
  ('vault',3,3),
  ('pwOverrides',9,9), ('userOverrides',9,9), ('customUsers',9,9), ('__hist_probe',9,9)
on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank;

/* ─── 요청 정보 ─── */
create or replace function semis_logi_private.hdr(p_name text) returns text
language sql stable set search_path = '' as $$
  select nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::json ->> p_name, '')), '')
$$;
/* 접속 IP — Cloudflare가 넣는 cf-connecting-ip 우선(클라이언트가 위조 불가).
   x-forwarded-for 는 첫 항목을 클라이언트가 꾸밀 수 있어 마지막 항목만 예비로 쓴다 */
create or replace function semis_logi_private.client_ip() returns text
language sql stable set search_path = '' as $$
  select left(coalesce(semis_logi_private.hdr('cf-connecting-ip'),
                       nullif(btrim(reverse(split_part(reverse(coalesce(semis_logi_private.hdr('x-forwarded-for'), '')), ',', 1))), ''),
                       'unknown'), 64)
$$;
create or replace function semis_logi_private.rank_of(p_role text) returns int
language sql immutable set search_path = '' as $$
  select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2
                     when 'user' then 1 when 'vendor' then 1 else 0 end
$$;

/* ─── 현재 세션 (x-semis-token 헤더) ─── */
create or replace function semis_logi_private.ctx()
returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text, minute_id text)
language plpgsql stable security definer set search_path = '' as $$
declare t text; th text;
begin
  t := semis_logi_private.hdr('x-semis-token');
  if t is null or length(t) <> 64 then return; end if;
  th := encode(extensions.digest(t, 'sha256'), 'hex');
  return query
    select s.token_hash, s.account_id, a.login_id, a.name,
           case when s.kind = 'signer' then 'signer' else a.role end,
           case when s.kind = 'signer' then 0 else semis_logi_private.rank_of(a.role) end,
           s.kind, s.minute_id
      from semis_logi_private.sessions s
      left join semis_logi_private.accounts a on a.id = s.account_id
     where s.token_hash = th
       and s.expires_at > now() and s.hard_expires_at > now()
       and (s.kind = 'signer' or (a.id is not null and not a.disabled));
end $$;

create or replace function semis_logi_private.rank_now() returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.rank from semis_logi_private.ctx() c where c.kind = 'user' limit 1), -1)
$$;
create or replace function semis_logi_private.read_rank(p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.read_rank from semis_logi_private.key_acl a where a.key = p_key), 2)
$$;
create or replace function semis_logi_private.write_rank(p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.write_rank from semis_logi_private.key_acl a where a.key = p_key), 3)
$$;


/* ─── 회의 서명 코드 (js minutes signCodeFor 와 같은 djb2 파생) ─── */
create or replace function semis_logi_private.sign_code(p_id text) returns text
language plpgsql immutable set search_path = '' as $$
declare h bigint := 5381; i int;
begin
  for i in 1 .. coalesce(length(p_id), 0) loop
    h := ((h * 33) & 4294967295) # ascii(substr(p_id, i, 1));
  end loop;
  return (100000 + (h % 900000))::text;
end $$;

/* 서명 화면에 필요한 만큼만 (다른 참석자의 서명 이미지는 보내지 않는다) */
create or replace function semis_logi_private.sign_view(p_mid text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m ->> 'id', 'title', coalesce(m ->> 'title', ''), 'date', coalesce(m ->> 'date', ''),
    'time', coalesce(m ->> 'time', ''), 'place', coalesce(m ->> 'place', ''), 'folder', coalesce(m ->> 'folder', ''),
    'folderName', (select f ->> 'name' from public.semis_logi_store s2, jsonb_array_elements(
                     case when jsonb_typeof(s2.value) = 'array' then s2.value else '[]'::jsonb end) f
                    where s2.key = 'minuteFolders' and f ->> 'id' = m ->> 'folder' limit 1),
    'folderIcon', (select f ->> 'icon' from public.semis_logi_store s2, jsonb_array_elements(
                     case when jsonb_typeof(s2.value) = 'array' then s2.value else '[]'::jsonb end) f
                    where s2.key = 'minuteFolders' and f ->> 'id' = m ->> 'folder' limit 1),
    'attendees', case when jsonb_typeof(m -> 'attendees') = 'array' then coalesce((
        select jsonb_agg(jsonb_build_object('name', coalesce(a ->> 'name', ''), 'org', coalesce(a ->> 'org', ''),
                                            'role', coalesce(a ->> 'role', ''), 'signed', coalesce(a ->> 'sign', '') <> '')
                         order by t.ord)
          from jsonb_array_elements(m -> 'attendees') with ordinality as t(a, ord)), '[]'::jsonb)
      else '[]'::jsonb end)
  from public.semis_logi_store s, jsonb_array_elements(
         case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) m
  where s.key = 'minutes' and m ->> 'id' = p_mid
  limit 1
$$;

/* 로그인·확인 응답 공통 */
create or replace function semis_logi_private.session_payload(p_account text, p_kind text, p_minute text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a semis_logi_private.accounts%rowtype;
begin
  if p_kind = 'signer' then
    return jsonb_build_object('kind', 'signer',
      'user', jsonb_build_object('id', '__signer__', 'name', '회의록 참석 서명', 'role', 'signer', 'signMinuteId', p_minute),
      'minute', semis_logi_private.sign_view(p_minute));
  end if;
  select * into a from semis_logi_private.accounts where id = p_account;
  return jsonb_build_object('kind', 'user',
    'user', jsonb_build_object('id', a.login_id, 'origId', a.id, 'name', a.name, 'role', a.role,
                               'vendor', a.vendor, 'base', a.base),
    'rank', semis_logi_private.rank_of(a.role),
    'acl', coalesce((select jsonb_object_agg(k.key, jsonb_build_array(k.read_rank, k.write_rank)) from semis_logi_private.key_acl k), '{}'::jsonb),
    'def', jsonb_build_array(2, 3));
end $$;

/* 암호 규칙 · 중복 확인 */
create or replace function semis_logi_private.legacy_hash(p_pw text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest('SeMISv2::' || p_pw, 'sha256'), 'hex')
$$;
create or replace function semis_logi_private.pw_problem(p_pw text, p_login text, p_except text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare lg text;
begin
  if p_pw is null or length(p_pw) < 8 then return 'short'; end if;
  if length(p_pw) > 64 then return 'long'; end if;
  if btrim(p_pw) = '' then return 'short'; end if;
  if lower(p_pw) = lower(coalesce(p_login, '')) then return 'same_as_id'; end if;
  if p_pw ~ '^\d{6}$' then return 'six_digits'; end if;   -- 6자리 숫자는 회의 서명 코드와 겹친다
  lg := semis_logi_private.legacy_hash(p_pw);
  if exists (select 1 from semis_logi_private.accounts a
              where a.id is distinct from p_except and a.pw_hash = extensions.crypt(lg, a.pw_hash)) then
    return 'in_use';
  end if;
  return null;
end $$;

/* ═════════════ 공개 RPC ═════════════ */

create or replace function public.semis_logi_login(p_pw text, p_ua text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip   text := semis_logi_private.client_ip();
  v_now  timestamptz := now();
  v_fail int;
  v_acc  semis_logi_private.accounts%rowtype;
  v_tok  text;
  v_mid  text;
begin
  if p_pw is null or length(p_pw) = 0 or length(p_pw) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  delete from semis_logi_private.sessions where hard_expires_at < v_now or expires_at < v_now - interval '1 day';
  delete from semis_logi_private.login_attempts where at < v_now - interval '2 days';
  delete from semis_logi_private.audit where at < v_now - interval '400 days';

  select count(*) into v_fail from semis_logi_private.login_attempts
   where ip = v_ip and not ok and at > v_now - interval '15 minutes';
  if v_fail >= 20 then
    insert into semis_logi_private.audit(actor, action, ip) values (null, 'login_locked', v_ip);
    return jsonb_build_object('ok', false, 'error', 'locked', 'wait', 15);
  end if;

  select * into v_acc from semis_logi_private.accounts a
   where not a.disabled and a.pw_hash = extensions.crypt(semis_logi_private.legacy_hash(p_pw), a.pw_hash)
   limit 1;
  if found then
    v_tok := encode(extensions.gen_random_bytes(32), 'hex');
    insert into semis_logi_private.sessions(token_hash, account_id, kind, expires_at, hard_expires_at, ip, ua)
    values (encode(extensions.digest(v_tok, 'sha256'), 'hex'), v_acc.id, 'user',
            v_now + interval '24 hours', v_now + interval '30 days', v_ip, left(coalesce(p_ua, ''), 200));
    update semis_logi_private.accounts set last_login_at = v_now where id = v_acc.id;
    insert into semis_logi_private.login_attempts(ip, ok, kind) values (v_ip, true, 'user');
    insert into semis_logi_private.audit(actor, action, ip) values (v_acc.id, 'login', v_ip);
    return jsonb_build_object('ok', true, 'token', v_tok) || semis_logi_private.session_payload(v_acc.id, 'user', null);
  end if;

  /* 6자리 = 회의 참석 서명 코드 (회의일 ±90일 안의 회의만) */
  if p_pw ~ '^\d{6}$' then
    select m ->> 'id' into v_mid
      from public.semis_logi_store s, jsonb_array_elements(
             case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) m
     where s.key = 'minutes'
       and coalesce(m ->> 'id', '') <> ''
       and coalesce(m ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
       and (m ->> 'date')::date between (v_now - interval '90 days')::date and (v_now + interval '90 days')::date
       and semis_logi_private.sign_code(m ->> 'id') = p_pw
     order by m ->> 'date' desc
     limit 1;
    if v_mid is not null then
      v_tok := encode(extensions.gen_random_bytes(32), 'hex');
      insert into semis_logi_private.sessions(token_hash, account_id, kind, minute_id, expires_at, hard_expires_at, ip, ua)
      values (encode(extensions.digest(v_tok, 'sha256'), 'hex'), null, 'signer', v_mid,
              v_now + interval '3 hours', v_now + interval '12 hours', v_ip, left(coalesce(p_ua, ''), 200));
      insert into semis_logi_private.login_attempts(ip, ok, kind) values (v_ip, true, 'sign');
      insert into semis_logi_private.audit(actor, action, detail, ip) values ('signer', 'sign_open', jsonb_build_object('minute', v_mid), v_ip);
      return jsonb_build_object('ok', true, 'token', v_tok) || semis_logi_private.session_payload(null, 'signer', v_mid);
    end if;
  end if;

  insert into semis_logi_private.login_attempts(ip, ok, kind)
  values (v_ip, false, case when p_pw ~ '^\d{6}$' then 'sign' else 'user' end);
  insert into semis_logi_private.audit(actor, action, ip) values (null, 'login_fail', v_ip);
  return jsonb_build_object('ok', false, 'error', 'invalid');
end $$;

create or replace function public.semis_logi_whoami(p_touch boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_touch then
    update semis_logi_private.sessions
       set last_seen = now(),
           expires_at = least(hard_expires_at, now() + case when kind = 'signer' then interval '3 hours' else interval '24 hours' end)
     where token_hash = c.token_hash and last_seen < now() - interval '2 minutes';
  end if;
  return jsonb_build_object('ok', true) || semis_logi_private.session_payload(c.account_id, c.kind, c.minute_id);
end $$;

/* 파일 함수(semis-logi-files)용 가벼운 확인 */
create or replace function public.semis_logi_file_auth() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'rank', c.rank, 'who', coalesce(c.login_id, c.kind));
end $$;

create or replace function public.semis_logi_logout() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if found then
    delete from semis_logi_private.sessions where token_hash = c.token_hash;
    insert into semis_logi_private.audit(actor, action, ip) values (coalesce(c.account_id, c.kind), 'logout', semis_logi_private.client_ip());
  end if;
  return jsonb_build_object('ok', true);
end $$;

/* ─── 회의 참석 서명 (signer 세션) ─── */
create or replace function public.semis_logi_sign_submit(p_idx int, p_expect text, p_name text, p_org text, p_role text, p_sign text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c record; v_list jsonb; v_pos int; v_m jsonb; v_att jsonb; v_n int; v_t int := -1; i int; a jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_org  text := btrim(coalesce(p_org, ''));
  v_role text := btrim(coalesce(p_role, ''));
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found or c.kind <> 'signer' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if v_name = '' or v_org = '' then return jsonb_build_object('ok', false, 'error', 'required'); end if;
  if length(v_name) > 30 or length(v_org) > 40 or length(v_role) > 24 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  if p_sign is not null and p_sign <> '' and not (
       (p_sign like 'https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-logi-files/minutes-sign/%'
        and length(p_sign) < 400 and p_sign !~ '[[:space:]"''<>\\]')
    or (p_sign like 'data:image/png;base64,%' and length(p_sign) <= 400000
        and p_sign ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$')) then
    return jsonb_build_object('ok', false, 'error', 'bad_sign');
  end if;

  select s.value into v_list from public.semis_logi_store s where s.key = 'minutes' for update;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select (t.ord - 1)::int into v_pos
    from jsonb_array_elements(v_list) with ordinality as t(m, ord)
   where t.m ->> 'id' = c.minute_id limit 1;
  if v_pos is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_m := v_list -> v_pos;
  v_att := case when jsonb_typeof(v_m -> 'attendees') = 'array' then v_m -> 'attendees' else '[]'::jsonb end;
  v_n := jsonb_array_length(v_att);
  if p_idx is not null and p_idx >= 0 and p_idx < v_n
     and btrim(coalesce(v_att -> p_idx ->> 'name', '')) = btrim(coalesce(p_expect, '')) then
    v_t := p_idx;
  end if;
  if v_t < 0 then
    for i in 0 .. v_n - 1 loop
      a := v_att -> i;
      if btrim(coalesce(a ->> 'name', '')) = v_name
         and (btrim(coalesce(a ->> 'org', '')) = '' or btrim(a ->> 'org') = v_org) then
        v_t := i; exit;
      end if;
    end loop;
  end if;
  if v_t < 0 then
    if v_n >= 60 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
    v_att := v_att || jsonb_build_array(jsonb_build_object('name', '', 'org', '', 'role', '', 'note', '', 'sign', ''));
    v_t := v_n;
  end if;
  a := (v_att -> v_t) || jsonb_build_object('name', v_name, 'org', v_org, 'role', v_role);
  if p_sign is not null then a := a || jsonb_build_object('sign', p_sign); end if;
  v_att := jsonb_set(v_att, array[v_t::text], a);
  v_m := jsonb_set(v_m, '{attendees}', v_att);
  v_list := jsonb_set(v_list, array[v_pos::text], v_m);
  update public.semis_logi_store set value = v_list, updated_by = 'signer' where key = 'minutes';
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values ('signer', case when p_sign is null then 'sign_info' else 'sign' end,
          jsonb_build_object('minute', c.minute_id, 'name', v_name), semis_logi_private.client_ip());
  return jsonb_build_object('ok', true, 'index', v_t, 'minute', semis_logi_private.sign_view(c.minute_id));
end $$;

/* ─── 시스템관리자 전용 ─── */
create or replace function semis_logi_private.admin_ctx() returns table(account_id text, token_hash text)
language sql stable security definer set search_path = '' as $$
  select c.account_id, c.token_hash from semis_logi_private.ctx() c where c.kind = 'user' and c.rank >= 4 limit 1
$$;

create or replace function public.semis_logi_users() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_logi_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.login_id, 'origId', a.id, 'name', a.name, 'role', a.role,
             'vendor', a.vendor, 'base', a.base, 'disabled', a.disabled,
             'pwChangedAt', a.pw_changed_at, 'lastLoginAt', a.last_login_at,
             'sessions', (select count(*) from semis_logi_private.sessions s where s.account_id = a.id and s.expires_at > now()))
           order by a.base desc, a.created_at, a.id)
      from semis_logi_private.accounts a), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_user_save(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me record; v_orig text := nullif(btrim(coalesce(p ->> 'origId', '')), '');
  v_login text := btrim(coalesce(p ->> 'id', '')); v_name text := btrim(coalesce(p ->> 'name', ''));
  v_role text := coalesce(p ->> 'role', ''); v_vendor text := btrim(coalesce(p ->> 'vendor', ''));
  v_pw text := p ->> 'pw'; v_prob text; v_cur semis_logi_private.accounts%rowtype;
begin
  select * into me from semis_logi_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_login !~ '^[A-Za-z0-9_-]{2,20}$' then return jsonb_build_object('ok', false, 'error', 'bad_id'); end if;
  if v_name = '' or length(v_name) > 20 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if v_role not in ('admin','hq','manager','user','vendor') then return jsonb_build_object('ok', false, 'error', 'bad_role'); end if;
  if v_role = 'vendor' and v_vendor = '' then return jsonb_build_object('ok', false, 'error', 'vendor'); end if;
  if v_role <> 'vendor' then v_vendor := ''; end if;
  if length(v_vendor) > 40 then return jsonb_build_object('ok', false, 'error', 'vendor'); end if;

  if v_orig is null then
    if exists (select 1 from semis_logi_private.accounts where login_id = v_login or id = v_login) then
      return jsonb_build_object('ok', false, 'error', 'dup_id');
    end if;
    v_prob := semis_logi_private.pw_problem(v_pw, v_login, null);
    if v_prob is not null then return jsonb_build_object('ok', false, 'error', 'pw_' || v_prob); end if;
    insert into semis_logi_private.accounts(id, login_id, name, role, vendor, pw_hash, base, pw_changed_at)
    values (v_login, v_login, v_name, v_role, v_vendor,
            extensions.crypt(semis_logi_private.legacy_hash(v_pw), extensions.gen_salt('bf', 10)), false, now());
    insert into semis_logi_private.audit(actor, action, detail, ip)
    values (me.account_id, 'user_create', jsonb_build_object('id', v_login, 'role', v_role), semis_logi_private.client_ip());
    return jsonb_build_object('ok', true);
  end if;

  select * into v_cur from semis_logi_private.accounts where id = v_orig;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if exists (select 1 from semis_logi_private.accounts where login_id = v_login and id <> v_orig) then
    return jsonb_build_object('ok', false, 'error', 'dup_id');
  end if;
  if v_orig = 'mark3464' then v_role := 'admin'; v_vendor := ''; end if;
  if v_orig = me.account_id and v_role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'self_role'); end if;
  update semis_logi_private.accounts
     set login_id = v_login, name = v_name, role = v_role, vendor = v_vendor, updated_at = now()
   where id = v_orig;
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values (me.account_id, 'user_update', jsonb_build_object('id', v_orig, 'login', v_login, 'role', v_role), semis_logi_private.client_ip());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_logi_user_delete(p_orig text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record;
begin
  select * into me from semis_logi_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_orig = 'mark3464' or p_orig = me.account_id then return jsonb_build_object('ok', false, 'error', 'protected'); end if;
  delete from semis_logi_private.accounts where id = p_orig;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values (me.account_id, 'user_delete', jsonb_build_object('id', p_orig), semis_logi_private.client_ip());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_logi_set_password(p_orig text, p_new text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record; v_acc semis_logi_private.accounts%rowtype; v_prob text; v_n int;
begin
  select * into me from semis_logi_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into v_acc from semis_logi_private.accounts where id = p_orig;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_prob := semis_logi_private.pw_problem(p_new, v_acc.login_id, v_acc.id);
  if v_prob is not null then return jsonb_build_object('ok', false, 'error', 'pw_' || v_prob); end if;
  update semis_logi_private.accounts
     set pw_hash = extensions.crypt(semis_logi_private.legacy_hash(p_new), extensions.gen_salt('bf', 10)),
         pw_changed_at = now(), updated_at = now()
   where id = p_orig;
  delete from semis_logi_private.sessions where account_id = p_orig and token_hash <> me.token_hash;
  get diagnostics v_n = row_count;
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values (me.account_id, 'pw_change', jsonb_build_object('id', p_orig, 'ended', v_n), semis_logi_private.client_ip());
  return jsonb_build_object('ok', true, 'ended', v_n);
end $$;

create or replace function public.semis_logi_history(p_key text default null, p_limit int default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_logi_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'key', h.key, 'old_len', h.old_len, 'new_len', h.new_len,
                                        'changed_at', h.changed_at, 'changed_by', h.changed_by) order by h.id desc)
      from (select * from public.semis_store_history h
             where h.src = 'semis_logi_store'
               and semis_logi_private.read_rank(h.key) <= 4
               and (p_key is null or p_key = '' or h.key = p_key)
             order by h.id desc
             limit least(greatest(coalesce(p_limit, 60), 1), 300)) h), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_history_value(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  if not exists (select 1 from semis_logi_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select h.id, h.key, h.old_value into r from public.semis_store_history h
   where h.id = p_id and h.src = 'semis_logi_store' and semis_logi_private.read_rank(h.key) <= 4;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'row', jsonb_build_object('id', r.id, 'key', r.key, 'old_value', r.old_value));
end $$;

/* 접속 기록 · 활성 세션 */
create or replace function public.semis_logi_security(p_limit int default 120) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me record;
begin
  select * into me from semis_logi_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true,
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'actor', coalesce(a.login_id, e.actor), 'action', e.action,
                                                             'detail', e.detail, 'ip', e.ip) order by e.id desc)
                          from (select * from semis_logi_private.audit order by id desc
                                 limit least(greatest(coalesce(p_limit, 120), 1), 500)) e
                          left join semis_logi_private.accounts a on a.id = e.actor), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('account', coalesce(a.login_id, s.kind), 'name', coalesce(a.name, '회의 서명'),
                                                               'kind', s.kind, 'created', s.created_at, 'lastSeen', s.last_seen,
                                                               'expires', s.expires_at, 'ip', s.ip, 'current', s.token_hash = me.token_hash)
                                           order by s.last_seen desc)
                            from semis_logi_private.sessions s
                            left join semis_logi_private.accounts a on a.id = s.account_id
                           where s.expires_at > now() and s.hard_expires_at > now()), '[]'::jsonb),
    'locked', coalesce((select jsonb_agg(x.ip) from (
                          select la.ip from semis_logi_private.login_attempts la
                           where not la.ok and la.at > now() - interval '15 minutes'
                           group by la.ip having count(*) >= 20) x), '[]'::jsonb));
end $$;

create or replace function public.semis_logi_end_sessions() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record; v_n int;
begin
  select * into me from semis_logi_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  delete from semis_logi_private.sessions where token_hash <> me.token_hash;
  get diagnostics v_n = row_count;
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values (me.account_id, 'sessions_end', jsonb_build_object('ended', v_n), semis_logi_private.client_ip());
  return jsonb_build_object('ok', true, 'ended', v_n);
end $$;

/* ─── 저장 시각 · 작성자 표시(서버 기준) + 변경 알림 ─── */
create or replace function semis_logi_private.stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  new.updated_at := now();
  select coalesce(c.login_id, c.kind) into who from semis_logi_private.ctx() c limit 1;
  if who is null then
    who := case when semis_logi_private.hdr('x-semis-token') is not null then 'expired'
                when coalesce(current_setting('request.headers', true), '') = '' then 'sql' else 'anon' end;
  end if;
  new.updated_by := left(who || '/' || regexp_replace(coalesce(new.updated_by, ''), '^.*/', ''), 80);
  return new;
end $$;
drop trigger if exists semis_logi_store_a_stamp on public.semis_logi_store;
create trigger semis_logi_store_a_stamp before insert or update on public.semis_logi_store
  for each row execute function semis_logi_private.stamp();

create or replace function semis_logi_private.notify_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('key', new.key, 'by', new.updated_by, 'at', new.updated_at),
                        'change', 'semis-logi-sync', false);
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists semis_logi_store_notify on public.semis_logi_store;
create trigger semis_logi_store_notify after insert or update on public.semis_logi_store
  for each row execute function semis_logi_private.notify_change();

/* ─── 세션 기반 RLS 정책 (기존 anon 정책과 공존 — 2단계에서 anon 정책 제거) ─── */
drop policy if exists "logi session read"   on public.semis_logi_store;
drop policy if exists "logi session insert" on public.semis_logi_store;
drop policy if exists "logi session update" on public.semis_logi_store;
create policy "logi session read" on public.semis_logi_store for select to anon, authenticated
  using ((select semis_logi_private.rank_now()) >= semis_logi_private.read_rank(key));
create policy "logi session insert" on public.semis_logi_store for insert to anon, authenticated
  with check ((select semis_logi_private.rank_now()) >= semis_logi_private.write_rank(key));
create policy "logi session update" on public.semis_logi_store for update to anon, authenticated
  using ((select semis_logi_private.rank_now()) >= semis_logi_private.write_rank(key))
  with check ((select semis_logi_private.rank_now()) >= semis_logi_private.write_rank(key));

/* ─── 기존 계정 이관 (코드·공용 DB에 있던 해시 → bcrypt 로 감싸 서버 전용 표에) ─── */
insert into semis_logi_private.accounts(id, login_id, name, role, vendor, pw_hash, base, pw_changed_at)
select b.id,
       coalesce(nullif(uo.value -> b.id ->> 'id', ''), b.id),
       coalesce(nullif(uo.value -> b.id ->> 'name', ''), b.name),
       case when b.id = 'mark3464' then 'admin'
            when coalesce(uo.value -> b.id ->> 'role', '') in ('admin','hq','manager','user','vendor') then uo.value -> b.id ->> 'role'
            else b.role end,
       coalesce(uo.value -> b.id ->> 'vendor', ''),
       case when coalesce(pw.value ->> b.id, '') ~ '^[0-9a-f]{64}$'
            then extensions.crypt(pw.value ->> b.id, extensions.gen_salt('bf', 10))
            else '!' end,
       true, now()
  from (values ('mark3464', '시스템관리자', 'admin'), ('cargo-ss', '안전보안파트', 'hq'),
               ('cargo-mgr', '화물팀 관리자', 'manager'), ('cargo-user', '화물팀 사용자', 'user')) b(id, name, role)
  left join public.semis_logi_store pw on pw.key = 'pwOverrides'
  left join public.semis_logi_store uo on uo.key = 'userOverrides'
 where coalesce((uo.value -> b.id ->> 'deleted')::boolean, false) = false
on conflict (id) do nothing;

insert into semis_logi_private.accounts(id, login_id, name, role, vendor, pw_hash, base, pw_changed_at)
select cu ->> 'id', cu ->> 'id', coalesce(nullif(cu ->> 'name', ''), cu ->> 'id'),
       case when cu ->> 'role' in ('admin','hq','manager','user','vendor') then cu ->> 'role' else 'user' end,
       coalesce(cu ->> 'vendor', ''),
       case when coalesce(cu ->> 'hash', '') ~ '^[0-9a-f]{64}$' then extensions.crypt(cu ->> 'hash', extensions.gen_salt('bf', 10)) else '!' end,
       false, now()
  from public.semis_logi_store s, jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) cu
 where s.key = 'customUsers' and coalesce(cu ->> 'id', '') ~ '^[A-Za-z0-9_-]{2,20}$'
on conflict (id) do nothing;

/* ─── 권한 정리: 비공개 스키마 함수는 정책 보조 3개만 호출 허용 ─── */
revoke execute on all functions in schema semis_logi_private from public, anon, authenticated;
grant execute on function semis_logi_private.rank_now()        to anon, authenticated, service_role;
grant execute on function semis_logi_private.read_rank(text)   to anon, authenticated, service_role;
grant execute on function semis_logi_private.write_rank(text)  to anon, authenticated, service_role;
