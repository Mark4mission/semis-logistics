/* ═══════════════════════════════════════════════════════
   H:drive — 운항 현황 현장 웹앱(flight.html) PIN · 위치 서버 출입
   마이그레이션 이름: semis_logi_flight_1   (다시 실행해도 같은 결과)
   - 현장 PIN(숫자 6~10자리)은 bcrypt 해시로 settings 'flight' 에만 둔다. 바꾸거나 '모두 끊기'를 하면 ver 가 올라가 그 전 표는 모두 무효
   - PIN 이 맞으면 12시간 표 "<만료 epoch>.<ver>.<HMAC-SHA256 64자>" — 위치 서버(Edge semis-logi-adsb)가 semis_logi_flight_gate 로 확인
   - H:drive · SeMIS v2 로그인 세션(x-semis-token, 등급 1 이상)도 통과. strict = false 동안은 모두 통과(화면 · 위치 서버를 옮겨 가는 동안만)
   - 시도 제한: 같은 IP 15분에 10번 틀림 → 15분 / 전체 1시간에 60번 틀림 → 멈춤(새 PIN 을 정하면 셈을 비움)
   - 위치 표(semis_logi_adsb · semis_logi_adsb_events)의 공개 읽기를 막는다 — 위치 서버는 서비스 권한으로 읽음
   ═══════════════════════════════════════════════════════ */

insert into semis_logi_private.settings(k, v)
values ('flight', jsonb_build_object('secret', encode(extensions.gen_random_bytes(32), 'hex'), 'ver', 1, 'strict', false))
on conflict (k) do nothing;

create table if not exists semis_logi_private.flight_hits (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now(),
  ok boolean not null default false
);
create index if not exists flight_hits_ip_idx on semis_logi_private.flight_hits(ip, at);
create index if not exists flight_hits_at_idx on semis_logi_private.flight_hits(at);
alter table semis_logi_private.flight_hits enable row level security;
revoke all on semis_logi_private.flight_hits from public, anon, authenticated;

create or replace function semis_logi_private.flight_cfg() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.v from semis_logi_private.settings s where s.k = 'flight'), '{}'::jsonb)
$$;
create or replace function semis_logi_private.flight_sig(p_body text) returns text
language sql stable security definer set search_path = '' as $$
  select encode(extensions.hmac(p_body, (select s.v ->> 'secret' from semis_logi_private.settings s where s.k = 'flight'), 'sha256'), 'hex')
$$;
/* 표 확인 — 형식 · 서명 · 만료(12시간 + 여유 1시간 넘게 먼 만료는 거절) · ver */
create or replace function semis_logi_private.flight_tok_ok(p_tok text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := semis_logi_private.flight_cfg(); parts text[]; e bigint; now_s bigint := extract(epoch from now())::bigint;
begin
  if p_tok is null or length(p_tok) > 100 or p_tok !~ '^[0-9]{10}\.[0-9]{1,9}\.[0-9a-f]{64}$' then return false; end if;
  if (c ->> 'pin') is null or (c ->> 'secret') is null then return false; end if;
  parts := string_to_array(p_tok, '.');
  e := parts[1]::bigint;
  if e < now_s or e > now_s + 13 * 3600 then return false; end if;
  if parts[2]::bigint <> coalesce((c ->> 'ver')::bigint, 1) then return false; end if;
  return parts[3] = semis_logi_private.flight_sig(parts[1] || '.' || parts[2]);
end $$;

/* 현장 PIN → 12시간 표 (로그인 없는 화면 — anon) */
create or replace function public.semis_logi_flight_pin(p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_ip text := semis_logi_private.client_ip(); c jsonb := semis_logi_private.flight_cfg(); n int; e bigint; body text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6,10}$' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if (c ->> 'pin') is null then return jsonb_build_object('ok', false, 'error', 'off'); end if;
  delete from semis_logi_private.flight_hits where at < now() - interval '2 days';
  select count(*) into n from semis_logi_private.flight_hits h where h.ip = v_ip and not h.ok and h.at > now() - interval '15 minutes';
  if n >= 10 then return jsonb_build_object('ok', false, 'error', 'locked', 'wait', 15); end if;
  select count(*) into n from semis_logi_private.flight_hits h where not h.ok and h.at > now() - interval '1 hour';
  if n >= 60 then return jsonb_build_object('ok', false, 'error', 'paused', 'wait', 15); end if;
  if (c ->> 'pin') is distinct from extensions.crypt(p_pin, c ->> 'pin') then
    insert into semis_logi_private.flight_hits(ip, ok) values (v_ip, false);
    if n + 1 = 60 then
      insert into semis_logi_private.audit(actor, action, ip) values (null, 'flight_pin_paused', v_ip);
    end if;
    return jsonb_build_object('ok', false, 'error', 'pin');
  end if;
  insert into semis_logi_private.flight_hits(ip, ok) values (v_ip, true);
  e := extract(epoch from now())::bigint + 12 * 3600;
  body := e::text || '.' || coalesce((c ->> 'ver')::bigint, 1)::text;
  return jsonb_build_object('ok', true, 'token', body || '.' || semis_logi_private.flight_sig(body), 'exp', e);
end $$;

/* 위치 서버 출입 확인 — Edge 가 받은 x-semis-token 을 그대로 넘겨 부른다.
   같은 위치 서버를 SeMIS v2 운항 현황(js/flight.js)도 쓰므로 v2 로그인 세션(같은 머리글 이름, semis_v2_private)도 통과 */
create or replace function public.semis_logi_flight_gate(p_ftok text default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r int;
begin
  if coalesce((semis_logi_private.flight_cfg() ->> 'strict')::boolean, false) is not true then return true; end if;
  if semis_logi_private.rank_now() >= 1 then return true; end if;
  if to_regprocedure('semis_v2_private.rank_now()') is not null then
    execute 'select semis_v2_private.rank_now()' into r;
    if coalesce(r, -1) >= 1 then return true; end if;
  end if;
  return semis_logi_private.flight_tok_ok(p_ftok);
end $$;

/* 시스템관리자 — info(상태) · pin(새 PIN) · cut(현장 접속 모두 끊기) */
create or replace function public.semis_logi_flight_admin(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c jsonb := semis_logi_private.flight_cfg(); a text := p ->> 'act'; v_id text; v_who text; v_pin text; v_ver bigint;
begin
  if semis_logi_private.rank_now() < 4 then raise exception 'forbidden' using errcode = '42501'; end if;
  select x.account_id, coalesce(x.name, x.login_id) into v_id, v_who from semis_logi_private.ctx() x where x.kind = 'user' limit 1;
  v_ver := coalesce((c ->> 'ver')::bigint, 1);
  if a = 'info' then
    return jsonb_build_object('ok', true, 'set', (c ->> 'pin') is not null, 'at', c ->> 'at', 'by', c ->> 'by',
      'cutAt', c ->> 'cutAt', 'strict', coalesce((c ->> 'strict')::boolean, false),
      'fails', (select count(*) from semis_logi_private.flight_hits h where not h.ok and h.at > now() - interval '1 day'),
      'last', (select max(h.at) from semis_logi_private.flight_hits h where h.ok));
  elsif a = 'pin' then
    v_pin := p ->> 'pin';
    if v_pin is null or v_pin !~ '^[0-9]{6,10}$' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
    update semis_logi_private.settings
       set v = v || jsonb_build_object('pin', extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), 'ver', v_ver + 1, 'at', now(), 'by', v_who),
           updated_at = now()
     where k = 'flight';
    delete from semis_logi_private.flight_hits where not ok;
    insert into semis_logi_private.audit(actor, action, detail, ip) values (v_id, 'flight_pin', jsonb_build_object('ver', v_ver + 1), semis_logi_private.client_ip());
    return jsonb_build_object('ok', true);
  elsif a = 'cut' then
    if (c ->> 'pin') is null then return jsonb_build_object('ok', false, 'error', 'off'); end if;
    update semis_logi_private.settings
       set v = v || jsonb_build_object('ver', v_ver + 1, 'cutAt', now()), updated_at = now()
     where k = 'flight';
    insert into semis_logi_private.audit(actor, action, detail, ip) values (v_id, 'flight_cut', jsonb_build_object('ver', v_ver + 1), semis_logi_private.client_ip());
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'act');
end $$;

revoke all on function semis_logi_private.flight_cfg(), semis_logi_private.flight_sig(text), semis_logi_private.flight_tok_ok(text)
  from public, anon, authenticated;
revoke execute on function public.semis_logi_flight_pin(text), public.semis_logi_flight_gate(text), public.semis_logi_flight_admin(jsonb)
  from public, authenticated;
grant execute on function public.semis_logi_flight_pin(text), public.semis_logi_flight_gate(text), public.semis_logi_flight_admin(jsonb)
  to anon, service_role;

/* 위치 표 — 공개 읽기 끝(위치 서버 = 서비스 권한) */
drop policy if exists "adsb read" on public.semis_logi_adsb;
drop policy if exists "adsb events read" on public.semis_logi_adsb_events;
revoke select on public.semis_logi_adsb, public.semis_logi_adsb_events from anon, authenticated;
