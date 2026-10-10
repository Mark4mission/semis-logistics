/* ═══════════════════════════════════════════════════════
   ARGOS — 아르고(AI 도우미) 계정별 하루 사용량
   - 대화 내용은 저장하지 않는다. 오늘(KST) 호출 수 · 토큰 수만 센다.
   - semis_logi_argo_begin(): 세션(x-semis-token) 확인과 호출 수 +1 을 한 번에. 내부 계정(user~admin)만 — 협력업체 · 서명 세션 제외.
     한도(settings k='argo' { calls, tokIn })를 넘으면 거절. Edge Function semis-logi-argo 가 Claude 를 부르기 전에 부른다.
   - semis_logi_argo_meter(): 방금 호출의 토큰 수를 자기 계정 오늘 줄에 더한다.
   - semis_logi_argo_usage(p_days): 시스템관리자 — 최근 사용량.
   - 실제 적용은 마이그레이션 semis_logi_security_27_argo. 이 파일은 참고용 사본이다.
   ═══════════════════════════════════════════════════════ */

create table if not exists semis_logi_private.argo_usage (
  account_id text not null references semis_logi_private.accounts(id) on delete cascade,
  day        date not null,
  calls      int not null default 0,
  tok_in     bigint not null default 0,
  tok_out    bigint not null default 0,
  tok_cache  bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, day)
);
alter table semis_logi_private.argo_usage enable row level security;
revoke all on semis_logi_private.argo_usage from public, anon, authenticated;

-- 한도: 하루 200회(Mark 결정 2026-10-10) · 입력 토큰 500만(첨부가 많은 날의 안전장치)
insert into semis_logi_private.settings(k, v) values ('argo', '{"calls": 200, "tokIn": 5000000}'::jsonb)
on conflict (k) do nothing;

create or replace function semis_logi_private.argo_day() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

create or replace function public.semis_logi_argo_begin() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c record; v_day date := semis_logi_private.argo_day(); v_cfg jsonb;
  v_lim int; v_tok bigint; v_calls int;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found or c.kind <> 'user' or c.account_id is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  if c.role not in ('admin', 'hq', 'manager', 'user') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select s.v into v_cfg from semis_logi_private.settings s where s.k = 'argo';
  v_lim := greatest(0, coalesce((v_cfg ->> 'calls')::int, 200));
  v_tok := greatest(0, coalesce((v_cfg ->> 'tokIn')::bigint, 5000000));
  insert into semis_logi_private.argo_usage(account_id, day) values (c.account_id, v_day)
  on conflict (account_id, day) do nothing;
  update semis_logi_private.argo_usage u
     set calls = u.calls + 1, updated_at = now()
   where u.account_id = c.account_id and u.day = v_day and u.calls < v_lim and u.tok_in < v_tok
  returning u.calls into v_calls;
  if not found then
    select u.calls into v_calls from semis_logi_private.argo_usage u where u.account_id = c.account_id and u.day = v_day;
    return jsonb_build_object('ok', false, 'error', 'limit', 'used', coalesce(v_calls, 0), 'limit', v_lim);
  end if;
  return jsonb_build_object('ok', true, 'rank', c.rank, 'role', c.role, 'name', coalesce(c.name, c.login_id),
                            'used', v_calls, 'limit', v_lim);
end $$;

create or replace function public.semis_logi_argo_meter(p_in int, p_out int, p_cache int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found or c.kind <> 'user' or c.account_id is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  update semis_logi_private.argo_usage u
     set tok_in    = u.tok_in    + least(greatest(coalesce(p_in, 0), 0), 2000000),
         tok_out   = u.tok_out   + least(greatest(coalesce(p_out, 0), 0), 200000),
         tok_cache = u.tok_cache + least(greatest(coalesce(p_cache, 0), 0), 2000000),
         updated_at = now()
   where u.account_id = c.account_id and u.day = semis_logi_private.argo_day();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_logi_argo_usage(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record; v_days int := least(greatest(coalesce(p_days, 7), 1), 90); v_cfg jsonb;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found or c.kind <> 'user' or c.rank < 4 then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select s.v into v_cfg from semis_logi_private.settings s where s.k = 'argo';
  return jsonb_build_object('ok', true,
    'limit', coalesce((v_cfg ->> 'calls')::int, 200),
    'today', semis_logi_private.argo_day(),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('day', u.day, 'id', a.login_id, 'name', a.name, 'role', a.role,
                                          'calls', u.calls, 'in', u.tok_in, 'out', u.tok_out, 'cache', u.tok_cache)
                       order by u.day desc, u.calls desc)
        from semis_logi_private.argo_usage u
        join semis_logi_private.accounts a on a.id = u.account_id
       where u.day > semis_logi_private.argo_day() - v_days), '[]'::jsonb));
end $$;

revoke all on function public.semis_logi_argo_begin() from public, authenticated;
revoke all on function public.semis_logi_argo_meter(int, int, int) from public, authenticated;
revoke all on function public.semis_logi_argo_usage(int) from public, authenticated;
revoke all on function semis_logi_private.argo_day() from public, anon, authenticated;
grant execute on function public.semis_logi_argo_begin() to anon, service_role;
grant execute on function public.semis_logi_argo_meter(int, int, int) to anon, service_role;
grant execute on function public.semis_logi_argo_usage(int) to anon, service_role;
