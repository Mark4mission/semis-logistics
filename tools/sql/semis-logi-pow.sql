/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 로그인 자동공격 방어 (v1.16.0, 2026-09-26)
   마이그레이션 이름: semis_logi_security_7_pow   (SeMIS v2 v2.53 과 같은 방식)
   ① 작업증명(PoW): 서버가 서명한 문제{nonce·만료 2분·난이도}를 브라우저가 풀어 로그인에 첨부(1회용)
   ② 전체 실패 수(모든 IP, 15분)가 늘면 난이도를 올린다(50/150/400 → +2/+4/+6)
   ③ 회의 서명 코드(6자리)는 전체 실패가 1시간 200회를 넘으면 15분 동안 받지 않는다
   ④ IP별 15분 20회 실패 → 15분 제한 (기존)
   - 해답 없는 login 호출은 거부된다(구버전 v1.15 화면은 새로고침해야 로그인 가능).
   - 이 파일은 참고용 사본이다. 실제 적용은 Supabase 마이그레이션으로 했다.
   ═══════════════════════════════════════════════════════ */

create table if not exists semis_logi_private.settings (
  k          text primary key,
  v          jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists semis_logi_private.pow_used (
  nonce text primary key,
  at    timestamptz not null default now()
);
alter table semis_logi_private.settings enable row level security;
alter table semis_logi_private.pow_used enable row level security;
revoke all on semis_logi_private.settings, semis_logi_private.pow_used from public, anon, authenticated;
create index if not exists login_attempts_at_idx on semis_logi_private.login_attempts(at);

-- 비밀값은 서버에서 만든다(코드·저장소에 없음)
insert into semis_logi_private.settings(k, v)
values ('pow', jsonb_build_object('secret', encode(extensions.gen_random_bytes(32), 'hex'), 'base', 18))
on conflict (k) do nothing;

create or replace function semis_logi_private.fail_count(p_minutes int, p_kind text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from semis_logi_private.login_attempts la
   where not la.ok and la.at > now() - make_interval(mins => p_minutes)
     and (p_kind is null or la.kind = p_kind)
$$;
create or replace function semis_logi_private.pow_bits() returns int
language plpgsql stable security definer set search_path = '' as $$
declare base int; f int;
begin
  select coalesce((v ->> 'base')::int, 16) into base from semis_logi_private.settings where k = 'pow';
  base := coalesce(base, 16);
  f := semis_logi_private.fail_count(15, null);
  return base + case when f >= 400 then 6 when f >= 150 then 4 when f >= 50 then 2 else 0 end;
end $$;
create or replace function semis_logi_private.pow_sig(p_body text) returns text
language sql stable security definer set search_path = '' as $$
  select left(encode(extensions.hmac(p_body, (select v ->> 'secret' from semis_logi_private.settings where k = 'pow'), 'sha256'), 'hex'), 32)
$$;
/* sha256(c ':' x) 의 앞 d 비트가 0 인지 */
create or replace function semis_logi_private.pow_ok(p_c text, p_x text, p_d int) returns boolean
language plpgsql immutable set search_path = '' as $$
declare h bytea; v bigint;
begin
  if p_x is null or p_x !~ '^[0-9]{1,16}$' or p_d < 1 or p_d > 30 then return false; end if;
  h := extensions.digest(p_c || ':' || p_x, 'sha256');
  v := (get_byte(h, 0)::bigint << 24) | (get_byte(h, 1)::bigint << 16) | (get_byte(h, 2)::bigint << 8) | get_byte(h, 3)::bigint;
  return (v >> (32 - p_d)) = 0;
end $$;
/* 확인 — 통과면 null, 아니면 오류 코드 */
create or replace function semis_logi_private.pow_check(p_pow jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare c text; x text; parts text[]; n text; e bigint; d int; base int; cnt int;
begin
  if p_pow is null or jsonb_typeof(p_pow) <> 'object' then return 'pow'; end if;
  c := p_pow ->> 'c'; x := p_pow ->> 'x';
  if c is null or length(c) > 120 then return 'pow'; end if;
  parts := string_to_array(c, '.');
  if array_length(parts, 1) <> 4 or parts[1] !~ '^[0-9a-f]{32}$' or parts[2] !~ '^[0-9]{10}$' or parts[3] !~ '^[0-9]{1,2}$' then
    return 'pow';
  end if;
  n := parts[1]; e := parts[2]::bigint; d := parts[3]::int;
  if parts[4] is distinct from semis_logi_private.pow_sig(n || '.' || e || '.' || d) then return 'pow'; end if;
  if e < extract(epoch from now())::bigint then return 'pow_expired'; end if;
  select coalesce((v ->> 'base')::int, 16) into base from semis_logi_private.settings where k = 'pow';
  if d < coalesce(base, 16) then return 'pow'; end if;
  if not semis_logi_private.pow_ok(c, x, d) then return 'pow'; end if;
  insert into semis_logi_private.pow_used(nonce) values (n) on conflict do nothing;
  get diagnostics cnt = row_count;
  if cnt = 0 then return 'pow_used'; end if;
  return null;
end $$;

create or replace function public.semis_logi_challenge() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare n text := encode(extensions.gen_random_bytes(16), 'hex');
        e bigint := extract(epoch from now())::bigint + 120;
        d int := semis_logi_private.pow_bits();
        body text;
begin
  body := n || '.' || e || '.' || d;
  return jsonb_build_object('ok', true, 'c', body || '.' || semis_logi_private.pow_sig(body), 'd', d);
end $$;

drop function if exists public.semis_logi_login(text, text);
create or replace function public.semis_logi_login(p_pw text, p_ua text default null, p_pow jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip   text := semis_logi_private.client_ip();
  v_now  timestamptz := now();
  v_fail int;
  v_err  text;
  v_acc  semis_logi_private.accounts%rowtype;
  v_tok  text;
  v_mid  text;
begin
  if p_pw is null or length(p_pw) = 0 or length(p_pw) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  v_err := semis_logi_private.pow_check(p_pow);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  delete from semis_logi_private.sessions where hard_expires_at < v_now or expires_at < v_now - interval '1 day';
  delete from semis_logi_private.login_attempts where at < v_now - interval '2 days';
  delete from semis_logi_private.audit where at < v_now - interval '400 days';
  delete from semis_logi_private.pow_used where at < v_now - interval '10 minutes';

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

  /* 6자리 = 회의 참석 서명 코드 (회의일 ±90일 안의 회의만) — 실패가 몰리면 잠시 받지 않는다 */
  if p_pw ~ '^\d{6}$' then
    if semis_logi_private.fail_count(60, 'sign') >= 200
       and exists (select 1 from semis_logi_private.login_attempts la
                    where not la.ok and la.kind = 'sign' and la.at > v_now - interval '15 minutes') then
      insert into semis_logi_private.audit(actor, action, ip) values (null, 'sign_paused', v_ip);
      return jsonb_build_object('ok', false, 'error', 'sign_paused', 'wait', 15);
    end if;
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

/* 보안 탭 — 실패 통계 추가(stats) */
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
                           group by la.ip having count(*) >= 20) x), '[]'::jsonb),
    'stats', jsonb_build_object(
      'fail15', semis_logi_private.fail_count(15, null),
      'fail60', semis_logi_private.fail_count(60, null),
      'signFail60', semis_logi_private.fail_count(60, 'sign'),
      'powBits', semis_logi_private.pow_bits(),
      'powBase', coalesce((select (v ->> 'base')::int from semis_logi_private.settings where k = 'pow'), 16),
      'signPaused', semis_logi_private.fail_count(60, 'sign') >= 200
                    and exists (select 1 from semis_logi_private.login_attempts la
                                 where not la.ok and la.kind = 'sign' and la.at > now() - interval '15 minutes')));
end $$;

/* 실행 권한 — 비공개 함수는 막고, 공개 RPC 는 anon 만 */
revoke execute on all functions in schema semis_logi_private from public, anon, authenticated;
grant execute on function semis_logi_private.rank_now()        to anon, authenticated, service_role;
grant execute on function semis_logi_private.read_rank(text)   to anon, authenticated, service_role;
grant execute on function semis_logi_private.write_rank(text)  to anon, authenticated, service_role;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'semis\_logi\_%' loop
    execute format('revoke execute on function %s from public, authenticated', f.sig);
    execute format('grant execute on function %s to anon, service_role', f.sig);
  end loop;
end $$;
