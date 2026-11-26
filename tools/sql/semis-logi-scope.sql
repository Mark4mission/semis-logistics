/* H:drive — 계정별 메뉴 범위(시스템 설정 › 사용자 › 메뉴 범위) · 마이그레이션 semis_logi_scope_1
   범위 계정 = accounts.scope 가 있는 계정(협력업체는 늘 — 없으면 홈만). 고른 메뉴의 자료 · 파일만 읽고, '편집'을 준 메뉴의 자료만 쓴다.
   - 단계: 열람(r) = 그 메뉴 보기 수준(scope_menu.view, 계정 등급이 더 높으면 그 등급 — 3까지) · 쓰기 없음
           편집(w) = 그 메뉴 안에서 안전보안파트(3)와 같음. 쓰기 등급 4(시스템관리자) 설정 행은 대응표에서 ref 로 두어 그대로 시스템관리자만
   - 범위 없는 계정은 예전과 같다(등급 · 권한표 key_acl) — 아래 함수들은 범위가 없으면 rank_now() 와 같은 값을 돌려준다
   - 대응표 scope_menu · scope_map 은 js/scope.js MAP 과 같다: 바꾸면 `node tools/gen-scope-map.cjs --write` (시험 SP01 이 대조)
   - 다시 실행해도 같은 결과 */

alter table semis_logi_private.accounts add column if not exists scope jsonb;

create table if not exists semis_logi_private.scope_menu (
  menu text primary key,
  view int not null check (view between 1 and 3)
);
create table if not exists semis_logi_private.scope_map (
  menu text not null,
  res  text not null check (res ~ '^[kf]:'),
  kind text not null check (kind in ('own', 'ref')),
  primary key (menu, res)
);
alter table semis_logi_private.scope_menu enable row level security;
alter table semis_logi_private.scope_map  enable row level security;
revoke all on semis_logi_private.scope_menu, semis_logi_private.scope_map from public, anon, authenticated;

-- <scope-map> (node tools/gen-scope-map.cjs)
delete from semis_logi_private.scope_map;
delete from semis_logi_private.scope_menu;
insert into semis_logi_private.scope_menu(menu, view) values
  ('*',1),
  ('dashboard',1),
  ('schedule',2),
  ('tasks',3),
  ('minutes',2),
  ('flight',1),
  ('shortcuts',1),
  ('sec-dash',2),
  ('scr-status',2),
  ('us-rescreen',3),
  ('scr-equip',2),
  ('sec-cases',2),
  ('kc-ra',3),
  ('partners',2),
  ('aud-dash',2),
  ('inspection',2),
  ('daily-safety',2),
  ('audit',2),
  ('selfcheck',2),
  ('training',2),
  ('dissem',2),
  ('learn',2),
  ('serp',2),
  ('threat',2),
  ('phonebook',2),
  ('contacts',2),
  ('crisis',2),
  ('roster',2),
  ('reg-sec',2),
  ('reg-safety',2),
  ('reg-dg',2),
  ('contracts',3),
  ('vault',3);
insert into semis_logi_private.scope_map(menu, res, kind) values
  ('*','k:menus','ref'),
  ('*','k:boards','ref'),
  ('*','k:levelHistory','ref'),
  ('dashboard','k:safetyBoard','ref'),
  ('schedule','k:schedules','own'),
  ('schedule','k:assignees','ref'),
  ('schedule','k:assigneesSeeded','ref'),
  ('schedule','k:gcal','ref'),
  ('schedule','f:schedules','own'),
  ('tasks','k:tasks','own'),
  ('tasks','k:taskCfg','ref'),
  ('tasks','k:roster','ref'),
  ('tasks','f:tasks','own'),
  ('minutes','k:minutes','own'),
  ('minutes','k:schedules','own'),
  ('minutes','k:minuteFolders','ref'),
  ('minutes','f:minutes','own'),
  ('minutes','f:minutes-sign','own'),
  ('flight','k:fleet','ref'),
  ('sec-dash','k:equipment','ref'),
  ('sec-dash','k:secPost','ref'),
  ('sec-dash','k:secPostImg','ref'),
  ('sec-dash','k:usRescreen','ref'),
  ('sec-dash','k:scrStats','ref'),
  ('sec-dash','k:caresCfg','ref'),
  ('scr-status','k:scrStats','own'),
  ('scr-status','k:docs','own'),
  ('scr-status','k:equipment','ref'),
  ('scr-status','k:caresCfg','ref'),
  ('scr-status','f:docs','own'),
  ('scr-status','f:docs-ssi','own'),
  ('us-rescreen','k:usRescreen','own'),
  ('scr-equip','k:equipment','own'),
  ('scr-equip','k:docs','own'),
  ('scr-equip','k:caresCfg','ref'),
  ('scr-equip','f:docs','own'),
  ('scr-equip','f:docs-ssi','own'),
  ('sec-cases','k:secCases','own'),
  ('sec-cases','f:cases','own'),
  ('kc-ra','k:kcra','own'),
  ('kc-ra','k:docs','own'),
  ('kc-ra','k:contracts','ref'),
  ('kc-ra','f:docs','own'),
  ('kc-ra','f:docs-ssi','own'),
  ('kc-ra','f:contracts','ref'),
  ('partners','k:partners','own'),
  ('partners','k:docs','own'),
  ('partners','f:docs','own'),
  ('partners','f:docs-ssi','own'),
  ('aud-dash','k:audits','ref'),
  ('aud-dash','k:patrol','ref'),
  ('aud-dash','k:patrolCfg','ref'),
  ('aud-dash','k:training','ref'),
  ('aud-dash','k:seclog','ref'),
  ('aud-dash','k:seclogCfg','ref'),
  ('aud-dash','k:selfChecks','ref'),
  ('aud-dash','k:selfCheckCfg','ref'),
  ('aud-dash','k:learn','ref'),
  ('aud-dash','k:dissem','ref'),
  ('aud-dash','k:roster','ref'),
  ('inspection','k:seclog','own'),
  ('inspection','k:docs','own'),
  ('inspection','k:seclogCfg','ref'),
  ('inspection','f:seclog','own'),
  ('inspection','f:docs','own'),
  ('inspection','f:docs-ssi','own'),
  ('daily-safety','k:patrol','own'),
  ('daily-safety','k:patrolPeople','own'),
  ('daily-safety','k:patrolCfg','ref'),
  ('daily-safety','f:patrol','own'),
  ('audit','k:audits','own'),
  ('audit','k:docs','own'),
  ('audit','k:schedules','own'),
  ('audit','k:auditMaster','ref'),
  ('audit','k:assignees','ref'),
  ('audit','k:training','ref'),
  ('audit','k:partners','ref'),
  ('audit','k:dissem','ref'),
  ('audit','k:contracts','ref'),
  ('audit','k:kcra','ref'),
  ('audit','k:secCases','ref'),
  ('audit','k:scrStats','ref'),
  ('audit','k:seclog','ref'),
  ('audit','k:seclogCfg','ref'),
  ('audit','k:selfChecks','ref'),
  ('audit','k:selfCheckCfg','ref'),
  ('audit','k:patrol','ref'),
  ('audit','k:roster','ref'),
  ('audit','f:audits','own'),
  ('audit','f:docs','own'),
  ('audit','f:docs-ssi','own'),
  ('audit','f:training','ref'),
  ('audit','f:seclog','ref'),
  ('audit','f:cases','ref'),
  ('audit','f:dissem','ref'),
  ('audit','f:contracts','ref'),
  ('audit','f:patrol','ref'),
  ('selfcheck','k:selfChecks','own'),
  ('selfcheck','k:selfCheckCfg','ref'),
  ('selfcheck','k:audits','ref'),
  ('selfcheck','f:seclog','own'),
  ('training','k:training','own'),
  ('training','k:docs','own'),
  ('training','k:roster','ref'),
  ('training','f:training','own'),
  ('training','f:docs','own'),
  ('training','f:docs-ssi','own'),
  ('dissem','k:dissem','own'),
  ('dissem','k:docs','own'),
  ('dissem','k:learn','ref'),
  ('dissem','k:roster','ref'),
  ('dissem','f:dissem','own'),
  ('dissem','f:docs','own'),
  ('dissem','f:docs-ssi','own'),
  ('learn','k:learn','own'),
  ('learn','k:dissem','own'),
  ('learn','k:roster','ref'),
  ('learn','f:learn','own'),
  ('serp','k:serp','own'),
  ('serp','k:serpRuns','own'),
  ('serp','k:contacts','ref'),
  ('serp','k:phonebook','ref'),
  ('serp','k:fleet','ref'),
  ('serp','k:docs','ref'),
  ('serp','f:crisis','own'),
  ('serp','f:contacts','ref'),
  ('serp','f:docs','ref'),
  ('threat','k:threat','own'),
  ('threat','k:threatRuns','own'),
  ('threat','k:threatChecks','own'),
  ('threat','f:threat','own'),
  ('phonebook','k:phonebook','own'),
  ('contacts','k:contacts','own'),
  ('contacts','f:contacts','own'),
  ('crisis','k:crisis','own'),
  ('crisis','k:contacts','ref'),
  ('crisis','k:phonebook','ref'),
  ('crisis','f:crisis','own'),
  ('roster','k:roster','own'),
  ('roster','k:partners','ref'),
  ('reg-sec','k:regulations','own'),
  ('reg-sec','k:docs','own'),
  ('reg-sec','f:regs','own'),
  ('reg-sec','f:regs-diff','own'),
  ('reg-sec','f:docs','own'),
  ('reg-sec','f:docs-ssi','own'),
  ('reg-safety','k:regulations','own'),
  ('reg-safety','k:docs','own'),
  ('reg-safety','f:regs','own'),
  ('reg-safety','f:regs-diff','own'),
  ('reg-safety','f:docs','own'),
  ('reg-safety','f:docs-ssi','own'),
  ('reg-dg','k:regulations','own'),
  ('reg-dg','k:docs','own'),
  ('reg-dg','f:regs','own'),
  ('reg-dg','f:regs-diff','own'),
  ('reg-dg','f:docs','own'),
  ('reg-dg','f:docs-ssi','own'),
  ('contracts','k:contracts','own'),
  ('contracts','k:docs','own'),
  ('contracts','f:contracts','own'),
  ('contracts','f:docs','own'),
  ('contracts','f:docs-ssi','own'),
  ('vault','k:vault','own');
-- </scope-map>

/* ─── 범위 계산 ─── */
/* 저장된 범위 → 판정에 쓰는 범위. 시스템관리자 = 늘 없음, 협력업체 = 늘 있음 */
create or replace function semis_logi_private.scope_of(p_role text, p_scope jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_role = 'admin' then null
              when jsonb_typeof(p_scope) = 'object' then p_scope
              when p_role = 'vendor' then '{"home": true, "m": {}, "cf": false}'::jsonb
              else null end
$$;
/* 화면에서 받은 범위 → 저장 모양(js/scope.js norm 과 같음) */
create or replace function semis_logi_private.scope_clean(p jsonb, p_role text) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_role = 'admin' then null
              when p is null or jsonb_typeof(p) <> 'object' then case when p_role = 'vendor' then '{"home": true, "m": {}, "cf": false}'::jsonb end
              else jsonb_build_object('home', coalesce(p ->> 'home', '') = 'true',
                     'm', coalesce((select jsonb_object_agg(e.key, e.value) from (
                             select x.key, x.value from jsonb_each_text(case when jsonb_typeof(p -> 'm') = 'object' then p -> 'm' else '{}'::jsonb end) x
                              where x.key ~ '^[A-Za-z0-9_-]{1,40}$' and x.key not in ('*', 'dashboard', 'settings') and x.value in ('r', 'w')
                              order by x.key limit 200) e), '{}'::jsonb))
                   || case when p_role = 'vendor' then jsonb_build_object('cf', coalesce(p ->> 'cf', '') = 'true') else '{}'::jsonb end
         end
$$;
/* 지금 세션(계정)의 기본 등급 · 범위 — 계정 세션이 아니면 행 없음 */
create or replace function semis_logi_private.me_scope() returns table(rank int, scope jsonb, role text, account_id text)
language sql stable security definer set search_path = '' as $$
  select c.rank, semis_logi_private.scope_of(a.role, a.scope), c.role, c.account_id
    from semis_logi_private.ctx() c
    join semis_logi_private.accounts a on a.id = c.account_id
   where c.kind = 'user'
   limit 1
$$;
/* (메뉴, 단계) — 공통 "*" 와 홈(대시보드)은 열람 */
create or replace function semis_logi_private.scope_levels(p_scope jsonb) returns table(menu text, lvl text)
language sql immutable set search_path = '' as $$
  select '*'::text, 'r'::text where p_scope is not null
  union all
  select 'dashboard', 'r' where coalesce(p_scope ->> 'home', '') = 'true'
  union all
  select e.key, e.value from jsonb_each_text(case when jsonb_typeof(p_scope -> 'm') = 'object' then p_scope -> 'm' else '{}'::jsonb end) e
   where e.value in ('r', 'w') and e.key not in ('*', 'dashboard')
$$;
create or replace function semis_logi_private.scope_lvl(p_scope jsonb, p_menu text) returns text
language sql immutable set search_path = '' as $$
  select case when p_scope is null then null
              when p_menu = '*' then 'r'
              when p_menu = 'dashboard' then case when coalesce(p_scope ->> 'home', '') = 'true' then 'r' else '' end
              when (p_scope -> 'm' ->> p_menu) in ('r', 'w') then p_scope -> 'm' ->> p_menu
              else '' end
$$;
/* 메뉴 안의 등급: 편집 3 · 열람 = 보기 수준과 계정 등급(3까지) 중 큰 값 · 없음 -1 */
create or replace function semis_logi_private.scope_eff(p_menu text, p_lvl text, p_base int) returns int
language sql stable security definer set search_path = '' as $$
  select case p_lvl when 'w' then 3
                    when 'r' then greatest(coalesce((select m.view from semis_logi_private.scope_menu m where m.menu = p_menu), 1), least(coalesce(p_base, 0), 3))
                    else -1 end
$$;
/* 행별 [읽기 1|0, 쓰기 1|0] (js/scope.js acl 과 같음) */
create or replace function semis_logi_private.scope_acl(p_scope jsonb, p_base int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(k.key, jsonb_build_array(
           case when k.read_rank <= 3 and exists (
                  select 1 from semis_logi_private.scope_levels(p_scope) l
                    join semis_logi_private.scope_map m on m.menu = l.menu and m.res = 'k:' || k.key
                   where semis_logi_private.scope_eff(l.menu, l.lvl, p_base) >= k.read_rank) then 1 else 0 end,
           case when k.write_rank < 9 and exists (
                  select 1 from semis_logi_private.scope_levels(p_scope) l
                    join semis_logi_private.scope_map m on m.menu = l.menu and m.res = 'k:' || k.key and m.kind = 'own'
                   where l.lvl = 'w') then 1 else 0 end)), '{}'::jsonb)
    from semis_logi_private.key_acl k
   where p_scope is not null
$$;
/* 게시판 메뉴의 단계(같은 게시판을 가리키는 메뉴가 여럿이면 높은 쪽): 2 편집 · 1 열람 · 0 없음 */
create or replace function semis_logi_private.scope_board(p_scope jsonb, p_board text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(case semis_logi_private.scope_lvl(p_scope, m ->> 'id') when 'w' then 2 when 'r' then 1 else 0 end), 0)
    from public.semis_logi_store s,
         jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) m
   where s.key = 'menus' and p_scope is not null and jsonb_typeof(m) = 'object'
     and m ->> 'type' = 'board' and m ->> 'board' = p_board
$$;
/* 파일 폴더별 [열람 등급, 올리기 등급] (js/scope.js folders 와 같음) */
create or replace function semis_logi_private.scope_fol(p_scope jsonb, p_base int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(z.f, jsonb_build_array(z.r, z.w)), '{}'::jsonb) from (
    select y.f, max(y.r) r, max(y.w) w from (
      select substr(m.res, 3) f, semis_logi_private.scope_eff(l.menu, l.lvl, p_base) r,
             case when m.kind = 'own' and l.lvl = 'w' then 3 else 0 end w
        from semis_logi_private.scope_levels(p_scope) l
        join semis_logi_private.scope_map m on m.menu = l.menu and m.res like 'f:%'
      union all
      select 'bbs' || semis_logi_private.bbs_rank(b ->> 'read'),
             case when v.lv = 2 then greatest(3, semis_logi_private.bbs_rank(b ->> 'read')) else semis_logi_private.bbs_rank(b ->> 'read') end,
             case when v.lv = 2 then 3 else 0 end
        from semis_logi_private.bbs_boards() b
        cross join lateral (select semis_logi_private.scope_board(p_scope, b ->> 'id') lv) v
       where v.lv > 0) y
    group by y.f) z
   where p_scope is not null
$$;
/* 지금 세션의 행 판정표 — 범위 없으면 null(등급 · 권한표로 판정) */
create or replace function semis_logi_private.acl_now() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when me.scope is null then null else semis_logi_private.scope_acl(me.scope, me.rank) end
    from semis_logi_private.me_scope() me
$$;
create or replace function semis_logi_private.acl_ok(p_acl jsonb, p_rank int, p_key text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_acl is null
              then coalesce(p_rank, -1) >= case when p_write then semis_logi_private.write_rank(p_key) else semis_logi_private.read_rank(p_key) end
              else coalesce(p_acl -> p_key ->> (case when p_write then 1 else 0 end), '0') = '1' end
$$;
/* RPC 문턱용 — 그 메뉴에서의 등급(범위 없으면 rank_now 와 같음, 계정 세션이 아니면 -1). p_write = 편집 단계만 3 */
create or replace function semis_logi_private.mod_rank(p_menu text, p_write boolean) returns int
language plpgsql stable security definer set search_path = '' as $$
declare me record; l text;
begin
  select * into me from semis_logi_private.me_scope();
  if not found then return -1; end if;
  if me.scope is null then return me.rank; end if;
  l := semis_logi_private.scope_lvl(me.scope, p_menu);
  if p_write then return case when l = 'w' then 3 else -1 end; end if;
  return semis_logi_private.scope_eff(p_menu, l, me.rank);
end $$;
/* 게시판 읽기 · 쓰기 등급(범위 없으면 계정 등급) */
create or replace function semis_logi_private.bbs_rr(p_b jsonb) returns int
language plpgsql stable security definer set search_path = '' as $$
declare me record; v int;
begin
  select * into me from semis_logi_private.me_scope();
  if not found then return -1; end if;
  if me.scope is null then return me.rank; end if;
  v := semis_logi_private.scope_board(me.scope, p_b ->> 'id');
  return case v when 2 then greatest(3, semis_logi_private.bbs_rank(p_b ->> 'read')) when 1 then semis_logi_private.bbs_rank(p_b ->> 'read') else -1 end;
end $$;
create or replace function semis_logi_private.bbs_rw(p_b jsonb) returns int
language plpgsql stable security definer set search_path = '' as $$
declare me record;
begin
  select * into me from semis_logi_private.me_scope();
  if not found then return -1; end if;
  if me.scope is null then return me.rank; end if;
  return case when semis_logi_private.scope_board(me.scope, p_b ->> 'id') = 2 then 3 else -1 end;
end $$;

/* ─── 공용 DB 읽기 · 쓰기 정책 — 범위 계정은 행 판정표, 나머지는 예전 그대로 ─── */
drop policy if exists "logi session read"   on public.semis_logi_store;
drop policy if exists "logi session insert" on public.semis_logi_store;
drop policy if exists "logi session update" on public.semis_logi_store;
create policy "logi session read" on public.semis_logi_store for select to anon, authenticated
  using (semis_logi_private.acl_ok((select semis_logi_private.acl_now()), (select semis_logi_private.rank_now()), key, false));
create policy "logi session insert" on public.semis_logi_store for insert to anon, authenticated
  with check (semis_logi_private.acl_ok((select semis_logi_private.acl_now()), (select semis_logi_private.rank_now()), key, true));
create policy "logi session update" on public.semis_logi_store for update to anon, authenticated
  using (semis_logi_private.acl_ok((select semis_logi_private.acl_now()), (select semis_logi_private.rank_now()), key, true))
  with check (semis_logi_private.acl_ok((select semis_logi_private.acl_now()), (select semis_logi_private.rank_now()), key, true));

/* ─── 로그인 · 확인 응답 — 범위 계정은 행 판정표를 등급 모양([0|9, 0|9])으로 ─── */
create or replace function semis_logi_private.session_payload(p_account text, p_kind text, p_minute text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare a semis_logi_private.accounts%rowtype; v_s jsonb; v_acl jsonb;
begin
  if p_kind = 'signer' then
    return jsonb_build_object('kind', 'signer',
      'user', jsonb_build_object('id', '__signer__', 'name', '회의록 참석 서명', 'role', 'signer', 'signMinuteId', p_minute),
      'minute', semis_logi_private.sign_view(p_minute));
  end if;
  select * into a from semis_logi_private.accounts where id = p_account;
  v_s := semis_logi_private.scope_of(a.role, a.scope);
  if v_s is null then
    v_acl := coalesce((select jsonb_object_agg(k.key, jsonb_build_array(k.read_rank, k.write_rank)) from semis_logi_private.key_acl k), '{}'::jsonb);
  else
    select coalesce(jsonb_object_agg(e.key, jsonb_build_array(case when e.value ->> 0 = '1' then 0 else 9 end, case when e.value ->> 1 = '1' then 0 else 9 end)), '{}'::jsonb)
      into v_acl from jsonb_each(semis_logi_private.scope_acl(v_s, semis_logi_private.rank_of(a.role))) e;
  end if;
  return jsonb_build_object('kind', 'user',
    'user', jsonb_build_object('id', a.login_id, 'origId', a.id, 'name', a.name, 'role', a.role,
                               'vendor', a.vendor, 'base', a.base, 'scope', v_s),
    'rank', semis_logi_private.rank_of(a.role),
    'acl', v_acl,
    'def', case when v_s is null then jsonb_build_array(2, 3) else jsonb_build_array(9, 9) end);
end $function$;

/* ─── 계정 관리 (시스템관리자) ─── */
create or replace function public.semis_logi_users()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if not exists (select 1 from semis_logi_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.login_id, 'origId', a.id, 'name', a.name, 'role', a.role,
             'vendor', a.vendor, 'base', a.base, 'disabled', a.disabled,
             'scope', semis_logi_private.scope_of(a.role, a.scope),
             'pwChangedAt', a.pw_changed_at, 'lastLoginAt', a.last_login_at,
             'sessions', (select count(*) from semis_logi_private.sessions s where s.account_id = a.id and s.expires_at > now()))
           order by a.base desc, a.created_at, a.id)
      from semis_logi_private.accounts a), '[]'::jsonb));
end $function$;

/* p.scope: 없으면(옛 화면) 고칠 때는 그대로 두고 만들 때는 범위 없음 · null = 범위 없음(등급대로) · 객체 = 범위 */
create or replace function public.semis_logi_user_save(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  me record; v_orig text := nullif(btrim(coalesce(p ->> 'origId', '')), '');
  v_login text := btrim(coalesce(p ->> 'id', '')); v_name text := btrim(coalesce(p ->> 'name', ''));
  v_role text := coalesce(p ->> 'role', ''); v_vendor text := btrim(coalesce(p ->> 'vendor', ''));
  v_pw text := p ->> 'pw'; v_prob text; v_cur semis_logi_private.accounts%rowtype;
  v_has boolean := p ? 'scope'; v_scope jsonb;
begin
  select * into me from semis_logi_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_login !~ '^[A-Za-z0-9_-]{2,20}$' then return jsonb_build_object('ok', false, 'error', 'bad_id'); end if;
  if v_name = '' or length(v_name) > 20 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if v_role not in ('admin','hq','manager','user','vendor') then return jsonb_build_object('ok', false, 'error', 'bad_role'); end if;
  if v_role = 'vendor' and v_vendor = '' then return jsonb_build_object('ok', false, 'error', 'vendor'); end if;
  if v_role <> 'vendor' then v_vendor := ''; end if;
  if length(v_vendor) > 40 then return jsonb_build_object('ok', false, 'error', 'vendor'); end if;
  if v_has and p -> 'scope' is not null and jsonb_typeof(p -> 'scope') not in ('object', 'null') then
    return jsonb_build_object('ok', false, 'error', 'bad_scope');
  end if;

  if v_orig is null then
    if exists (select 1 from semis_logi_private.accounts where login_id = v_login or id = v_login) then
      return jsonb_build_object('ok', false, 'error', 'dup_id');
    end if;
    v_prob := semis_logi_private.pw_problem(v_pw, v_login, null);
    if v_prob is not null then return jsonb_build_object('ok', false, 'error', 'pw_' || v_prob); end if;
    v_scope := semis_logi_private.scope_clean(case when v_has then p -> 'scope' end, v_role);
    insert into semis_logi_private.accounts(id, login_id, name, role, vendor, pw_hash, base, pw_changed_at, scope)
    values (v_login, v_login, v_name, v_role, v_vendor,
            extensions.crypt(semis_logi_private.legacy_hash(v_pw), extensions.gen_salt('bf', 10)), false, now(), v_scope);
    insert into semis_logi_private.audit(actor, action, detail, ip)
    values (me.account_id, 'user_create', jsonb_build_object('id', v_login, 'role', v_role, 'scope', v_scope), semis_logi_private.client_ip());
    return jsonb_build_object('ok', true);
  end if;

  select * into v_cur from semis_logi_private.accounts where id = v_orig;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if exists (select 1 from semis_logi_private.accounts where login_id = v_login and id <> v_orig) then
    return jsonb_build_object('ok', false, 'error', 'dup_id');
  end if;
  if v_orig = 'mark3464' then v_role := 'admin'; v_vendor := ''; end if;
  if v_orig = me.account_id and v_role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'self_role'); end if;
  v_scope := semis_logi_private.scope_clean(case when v_has then p -> 'scope' else v_cur.scope end, v_role);
  update semis_logi_private.accounts
     set login_id = v_login, name = v_name, role = v_role, vendor = v_vendor, scope = v_scope, updated_at = now()
   where id = v_orig;
  insert into semis_logi_private.audit(actor, action, detail, ip)
  values (me.account_id, 'user_update', jsonb_build_object('id', v_orig, 'login', v_login, 'role', v_role, 'scope', v_scope), semis_logi_private.client_ip());
  return jsonb_build_object('ok', true);
end $function$;

/* ─── 파일 함수 — 범위 계정은 등급 0 + 폴더별 등급표(fol) ─── */
create or replace function public.semis_logi_file_auth()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare c record; v_s jsonb;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  if c.kind = 'user' then
    select semis_logi_private.scope_of(a.role, a.scope) into v_s from semis_logi_private.accounts a where a.id = c.account_id;
  end if;
  if v_s is not null then
    return jsonb_build_object('ok', true, 'kind', c.kind, 'rank', 0, 'role', coalesce(c.role, ''), 'who', coalesce(c.login_id, c.kind),
                              'scoped', true, 'fol', semis_logi_private.scope_fol(v_s, c.rank));
  end if;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'rank', c.rank, 'role', coalesce(c.role, ''), 'who', coalesce(c.login_id, c.kind));
end $function$;

/* ─── 다른 기능의 문턱 ─── */
/* 접수 카운터 — 범위 계정 제외 */
create or replace function semis_logi_private.desk_me()
 returns table(account_id text, name text, role text, rank integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.account_id, coalesce(nullif(c.name, ''), c.login_id), c.role, c.rank
    from semis_logi_private.ctx() c
    join semis_logi_private.accounts a on a.id = c.account_id
   where c.kind = 'user' and c.account_id is not null and c.role in ('admin', 'hq', 'manager', 'user')
     and semis_logi_private.scope_of(a.role, a.scope) is null
   limit 1
$function$;
/* 게시판 — 협력업체도(범위로 게시판을 받았을 때만 bbs_rr 이 통과) */
create or replace function semis_logi_private.bbs_me()
 returns table(account_id text, name text, role text, rank integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.account_id, coalesce(nullif(c.name, ''), c.login_id), c.role, c.rank
    from semis_logi_private.ctx() c
   where c.kind = 'user' and c.account_id is not null and c.role in ('admin', 'hq', 'manager', 'user', 'vendor')
   limit 1
$function$;
/* 보안교육 이수 등록 페이지 관리 — 보안교육 · 자격 '편집' */
create or replace function semis_logi_private.edu_admin()
 returns table(account_id text, login_id text, rank integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.account_id, c.login_id, semis_logi_private.mod_rank('training', true)
    from semis_logi_private.ctx() c
   where c.kind = 'user' and semis_logi_private.mod_rank('training', true) >= 3
   limit 1
$function$;
/* 교육 전파 · 서명 — 보기 2 · 관리 3(열람 단계는 2까지) */
create or replace function semis_logi_private.learn_me()
 returns table(account_id text, login_id text, rank integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select c.account_id, c.login_id,
         case when semis_logi_private.acl_now() is null then c.rank
              when semis_logi_private.mod_rank('learn', true) >= 3 then 3
              else least(semis_logi_private.mod_rank('learn', false), 2) end
    from semis_logi_private.ctx() c
   where c.kind = 'user'
   limit 1
$function$;
/* SSI 서약 명단(보안교육 · 자격 화면) */
create or replace function public.semis_logi_pledges()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if semis_logi_private.mod_rank('training', false) < 2 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'asOf', now(), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('name', z.name, 'dept', z.dept, 'position', z.position,
                                        'date', to_char(z.at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
                                        'state', case z.eff when 'leaving' then 'valid' when 'expired' then 'left' else z.eff end,
                                        'off', case when z.eff in ('expired', 'void') then to_char(z.state_at, 'YYYY-MM-DD') end,
                                        'n', z.n) order by z.at desc)
      from (select distinct on (semis_v2_private.pledge_pkey(x.emp_id, x.name))
                   x.name, x.dept, x.position, x.at, x.state_at, semis_v2_private.pledge_eff_state(x.state, x.state_at) as eff,
                   count(*) over (partition by semis_v2_private.pledge_pkey(x.emp_id, x.name)) as n
              from semis_v2_private.pledges x
             order by semis_v2_private.pledge_pkey(x.emp_id, x.name), (x.state <> 'void') desc, x.at desc) z), '[]'::jsonb));
end $function$;
/* 운항 위치 — 운항 현황 또는 홈(대시보드 지도)을 받은 범위 계정만 */
create or replace function public.semis_logi_flight_gate(p_ftok text DEFAULT NULL::text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare r int;
begin
  if coalesce((semis_logi_private.flight_cfg() ->> 'strict')::boolean, false) is not true then return true; end if;
  if greatest(semis_logi_private.mod_rank('flight', false), semis_logi_private.mod_rank('dashboard', false)) >= 1 then return true; end if;
  if to_regprocedure('semis_v2_private.rank_now()') is not null then
    execute 'select semis_v2_private.rank_now()' into r;
    if coalesce(r, -1) >= 1 then return true; end if;
  end if;
  return semis_logi_private.flight_tok_ok(p_ftok);
end $function$;
/* 아르고 — 범위 계정 제외(여러 화면 자료를 함께 다루는 도구) */
create or replace function public.semis_logi_argo_begin()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  c record; v_day date := semis_logi_private.argo_day(); v_cfg jsonb;
  v_lim int; v_tok bigint; v_calls int;
begin
  select * into c from semis_logi_private.ctx() limit 1;
  if not found or c.kind <> 'user' or c.account_id is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  if c.role not in ('admin', 'hq', 'manager', 'user') or semis_logi_private.acl_now() is not null then
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
end $function$;

/* ─── 게시판 RPC — 등급 비교를 게시판별 읽기(bbs_rr) · 쓰기(bbs_rw)로. 범위 없는 계정은 둘 다 계정 등급이라 예전과 같다 ─── */
create or replace function public.semis_logi_bbs_list(p jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  c record; b jsonb; v_b text := left(coalesce(p ->> 'b', ''), 8);
  v_page int; v_size int; v_terms text[]; v_f text := coalesce(p ->> 'f', 'all'); v_cat text := left(coalesce(p ->> 'cat', ''), 40);
  v_total int; v_rows jsonb; v_pins jsonb; v_new int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  b := semis_logi_private.bbs_board(v_b);
  if b is null then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  if semis_logi_private.bbs_rr(b) < semis_logi_private.bbs_rank(b ->> 'read') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_new := semis_logi_private.bbs_newdays(b);
  v_size := semis_logi_private.bbs_int(p ->> 'size', semis_logi_private.bbs_int(b ->> 'perPage', 20));
  if v_size not in (10, 15, 20, 30, 50, 100) then v_size := 20; end if;
  v_page := greatest(1, least(semis_logi_private.bbs_int(p ->> 'page', 1), 100000));
  v_terms := semis_logi_private.bbs_terms(p ->> 'q');
  if v_f not in ('all', 'title', 'body', 'author') then v_f := 'all'; end if;

  select count(*) into v_total from semis_logi_private.bbs_posts x
   where x.board = v_b and x.deleted_at is null and (v_cat = '' or x.cat = v_cat)
     and semis_logi_private.bbs_like(case v_f when 'title' then x.title when 'body' then x.body when 'author' then x.author_name
                                      else x.title || ' ' || x.body || ' ' || x.author_name end, v_terms);
  if (v_page - 1) * v_size >= v_total and v_total > 0 then v_page := ((v_total - 1) / v_size) + 1; end if;

  select coalesce(jsonb_agg(semis_logi_private.bbs_row(x, c.account_id, v_new) order by x.thread desc, x.path), '[]'::jsonb) into v_rows
    from semis_logi_private.bbs_posts x
    join (select k.id from semis_logi_private.bbs_posts k
           where k.board = v_b and k.deleted_at is null and (v_cat = '' or k.cat = v_cat)
             and semis_logi_private.bbs_like(case v_f when 'title' then k.title when 'body' then k.body when 'author' then k.author_name
                                              else k.title || ' ' || k.body || ' ' || k.author_name end, v_terms)
           order by k.thread desc, k.path
           offset (v_page - 1) * v_size limit v_size) pg on pg.id = x.id;

  v_pins := '[]'::jsonb;
  if semis_logi_private.bbs_on(b, 'pin') and v_page = 1 and cardinality(v_terms) = 0 and v_cat = '' then
    select coalesce(jsonb_agg(semis_logi_private.bbs_row(x, c.account_id, v_new) order by x.created_at desc), '[]'::jsonb) into v_pins
      from semis_logi_private.bbs_posts x
      join (select k.id from semis_logi_private.bbs_posts k
             where k.board = v_b and k.deleted_at is null and k.pinned
               and (k.pin_until is null or k.pin_until >= semis_logi_private.bbs_today())
             order by k.created_at desc limit 10) pg on pg.id = x.id;
  end if;
  return jsonb_build_object('ok', true, 'total', v_total, 'page', v_page, 'size', v_size, 'rows', v_rows, 'pins', v_pins,
    'rank', semis_logi_private.bbs_rw(b), 'me', c.account_id);
end $function$;

create or replace function public.semis_logi_bbs_get(p_id bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  c record; x semis_logi_private.bbs_posts%rowtype; b jsonb; v_read int; v_mng boolean; v_mine boolean; v_first boolean := false;
  v_cm jsonb := '[]'::jsonb; v_rd jsonb := null; v_prev jsonb; v_next jsonb; v_kids int; v_rw int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select * into x from semis_logi_private.bbs_posts where id = p_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  b := semis_logi_private.bbs_board(x.board);
  if b is null then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  v_read := semis_logi_private.bbs_rank(b ->> 'read');
  if semis_logi_private.bbs_rr(b) < v_read then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_rw := semis_logi_private.bbs_rw(b);
  v_mng := v_rw >= 3;
  v_mine := x.author_id is not distinct from c.account_id;

  insert into semis_logi_private.bbs_reads(post, account_id) values (x.id, c.account_id) on conflict do nothing;
  get diagnostics v_kids = row_count;
  if v_kids > 0 then
    v_first := true;
    update semis_logi_private.bbs_posts set views = views + 1 where id = x.id returning views into x.views;
  end if;

  if semis_logi_private.bbs_on(b, 'comment') then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'by', m.author_name, 'at', m.created_at,
             'mine', m.author_id is not distinct from c.account_id) order by m.id), '[]'::jsonb) into v_cm
      from semis_logi_private.bbs_comments m where m.post = x.id and m.deleted_at is null;
  end if;
  if semis_logi_private.bbs_on(b, 'readers') and (v_mng or v_mine) then
    select jsonb_build_object(
      'read', coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'at', r.at) order by r.at)
                          from semis_logi_private.bbs_reads r join semis_logi_private.accounts a on a.id = r.account_id
                         where r.post = x.id and r.account_id is distinct from x.author_id), '[]'::jsonb),
      'unread', coalesce((select jsonb_agg(a.name order by a.name) from semis_logi_private.accounts a
                           where not a.disabled and a.role in ('admin', 'hq', 'manager', 'user')
                             and semis_logi_private.rank_of(a.role) >= v_read
                             and a.id is distinct from x.author_id
                             and not exists (select 1 from semis_logi_private.bbs_reads r where r.post = x.id and r.account_id = a.id)), '[]'::jsonb))
      into v_rd;
  end if;
  select jsonb_build_object('id', y.id, 'title', y.title) into v_prev from semis_logi_private.bbs_posts y
   where y.board = x.board and y.deleted_at is null and y.depth = 0 and y.id < x.thread order by y.id desc limit 1;
  select jsonb_build_object('id', y.id, 'title', y.title) into v_next from semis_logi_private.bbs_posts y
   where y.board = x.board and y.deleted_at is null and y.depth = 0 and y.id > x.thread order by y.id limit 1;
  select count(*) into v_kids from semis_logi_private.bbs_posts y
   where y.thread = x.thread and y.deleted_at is null and y.depth > x.depth and y.path like x.path || '%' and y.id <> x.id;

  return jsonb_build_object('ok', true, 'first', v_first,
    'post', jsonb_build_object('id', x.id, 'no', x.no, 'b', x.board, 'cat', x.cat, 'title', x.title, 'html', x.html, 'body', x.body,
      'files', x.files, 'by', x.author_name, 'at', x.created_at, 'up', x.updated_at, 'views', x.views,
      'pin', x.pinned, 'pinUntil', x.pin_until, 'depth', x.depth, 'parent', x.parent, 'mine', v_mine, 'replies', v_kids),
    'comments', v_cm, 'readers', v_rd, 'prev', v_prev, 'next', v_next,
    'can', jsonb_build_object(
      'edit', (v_mine and v_rw >= 0) or v_mng,
      'del', v_mng or (v_mine and v_rw >= 0 and not exists (select 1 from semis_logi_private.bbs_posts y where y.thread = x.thread and y.deleted_at is null
                                                and y.depth > x.depth and y.path like x.path || '%' and y.author_id is distinct from c.account_id)),
      'reply', semis_logi_private.bbs_on(b, 'reply') and x.depth < 3 and v_rw >= semis_logi_private.bbs_rank(b ->> 'write'),
      'comment', semis_logi_private.bbs_on(b, 'comment') and v_rw >= semis_logi_private.bbs_rank(coalesce(b ->> 'cmt', b ->> 'read')),
      'manage', v_mng));
end $function$;

create or replace function public.semis_logi_bbs_save(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  c record; b jsonb; x semis_logi_private.bbs_posts%rowtype; par semis_logi_private.bbs_posts%rowtype;
  v_id bigint := semis_logi_private.bbs_int(p ->> 'id', 0); v_b text := left(coalesce(p ->> 'b', ''), 8);
  v_title text := left(btrim(regexp_replace(coalesce(p ->> 'title', ''), '[\r\n\t]+', ' ', 'g')), 200);
  v_html text := left(coalesce(p ->> 'html', ''), 300000); v_body text := left(coalesce(p ->> 'body', ''), 100000);
  v_files jsonb := semis_logi_private.bbs_files(p -> 'files');
  v_cat text := left(btrim(coalesce(p ->> 'cat', '')), 40);
  v_pin boolean := coalesce(p ->> 'pin', '') = 'true'; v_until date := null;
  v_par bigint := semis_logi_private.bbs_int(p ->> 'parent', 0); v_no int; v_n int; v_rw int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if v_title = '' then return jsonb_build_object('ok', false, 'error', 'title'); end if;
  if coalesce(p ->> 'pinUntil', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin v_until := (p ->> 'pinUntil')::date; exception when others then v_until := null; end;
  end if;

  if v_id > 0 then
    select * into x from semis_logi_private.bbs_posts where id = v_id and deleted_at is null for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
    v_b := x.board;
  end if;
  b := semis_logi_private.bbs_board(v_b);
  if b is null then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  if semis_logi_private.bbs_rr(b) < semis_logi_private.bbs_rank(b ->> 'read') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  v_rw := semis_logi_private.bbs_rw(b);
  if v_rw < 0 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not semis_logi_private.bbs_on(b, 'attach') then v_files := '[]'::jsonb; end if;
  if not semis_logi_private.bbs_on(b, 'cat') or not exists (
       select 1 from jsonb_array_elements_text(case when jsonb_typeof(b -> 'cats') = 'array' then b -> 'cats' else '[]'::jsonb end) k where k = v_cat) then
    v_cat := '';
  end if;
  if not (semis_logi_private.bbs_on(b, 'pin') and v_rw >= 3) then
    v_pin := case when v_id > 0 then x.pinned else false end;
    v_until := case when v_id > 0 then x.pin_until else null end;
  end if;
  if not v_pin then v_until := null; end if;

  if v_id > 0 then
    if not (x.author_id is not distinct from c.account_id or v_rw >= 3) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
    update semis_logi_private.bbs_posts
       set title = v_title, html = v_html, body = v_body, files = v_files, cat = v_cat, pinned = v_pin, pin_until = v_until,
           updated_at = now(), updated_by = c.name
     where id = v_id;
    perform semis_logi_private.bbs_notify(v_b);
    return jsonb_build_object('ok', true, 'id', v_id, 'no', x.no, 'b', v_b);
  end if;

  if v_rw < semis_logi_private.bbs_rank(b ->> 'write') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select count(*) into v_n from semis_logi_private.bbs_posts
   where author_id = c.account_id and created_at > now() - interval '1 minute';
  if v_n >= 10 then return jsonb_build_object('ok', false, 'error', 'rate'); end if;
  if v_par > 0 then
    if not semis_logi_private.bbs_on(b, 'reply') then return jsonb_build_object('ok', false, 'error', 'reply'); end if;
    select * into par from semis_logi_private.bbs_posts where id = v_par and board = v_b and deleted_at is null;
    if not found or par.depth >= 3 then return jsonb_build_object('ok', false, 'error', 'reply'); end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('semis_logi_bbs:' || v_b));
  select coalesce(max(no), 0) + 1 into v_no from semis_logi_private.bbs_posts where board = v_b;
  insert into semis_logi_private.bbs_posts(board, no, title, html, body, files, cat, pinned, pin_until, author_id, author_name, updated_by,
                                           parent, depth, thread, path, src)
  values (v_b, v_no, v_title, v_html, v_body, v_files, v_cat, v_pin and v_par = 0, case when v_par = 0 then v_until end,
          c.account_id, c.name, c.name,
          case when v_par > 0 then par.id end, case when v_par > 0 then par.depth + 1 else 0 end,
          case when v_par > 0 then par.thread end,
          case when v_par > 0 then par.path || lpad(((select count(*) from semis_logi_private.bbs_posts y where y.parent = par.id) + 1)::text, 3, '0') || '.' else '' end,
          case when coalesce(p ->> 'src', '') = 'argo' then 'argo' end)
  returning id into v_id;
  if v_par = 0 then update semis_logi_private.bbs_posts set thread = v_id where id = v_id; end if;
  perform semis_logi_private.bbs_notify(v_b);
  return jsonb_build_object('ok', true, 'id', v_id, 'no', v_no, 'b', v_b);
end $function$;

create or replace function public.semis_logi_bbs_comment(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c record; x semis_logi_private.bbs_posts%rowtype; b jsonb; m semis_logi_private.bbs_comments%rowtype;
  v_body text := left(btrim(coalesce(p ->> 'body', '')), 2000); v_id bigint; v_n int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if semis_logi_private.bbs_int(p ->> 'del', 0) > 0 then
    select * into m from semis_logi_private.bbs_comments where id = semis_logi_private.bbs_int(p ->> 'del', 0) and deleted_at is null;
    if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
    select * into x from semis_logi_private.bbs_posts where id = m.post;
    b := semis_logi_private.bbs_board(x.board);
    if b is null or semis_logi_private.bbs_rr(b) < semis_logi_private.bbs_rank(b ->> 'read') then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
    if not ((m.author_id is not distinct from c.account_id and semis_logi_private.bbs_rw(b) >= 0) or semis_logi_private.bbs_rw(b) >= 3) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    update semis_logi_private.bbs_comments set deleted_at = now() where id = m.id;
    update semis_logi_private.bbs_posts set ncomments = greatest(0, ncomments - 1) where id = m.post;
    perform semis_logi_private.bbs_notify(x.board);
    return jsonb_build_object('ok', true);
  end if;
  select * into x from semis_logi_private.bbs_posts where id = semis_logi_private.bbs_int(p ->> 'post', 0) and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  b := semis_logi_private.bbs_board(x.board);
  if b is null or not semis_logi_private.bbs_on(b, 'comment') then return jsonb_build_object('ok', false, 'error', 'off'); end if;
  if semis_logi_private.bbs_rr(b) < semis_logi_private.bbs_rank(b ->> 'read')
     or semis_logi_private.bbs_rw(b) < semis_logi_private.bbs_rank(coalesce(b ->> 'cmt', b ->> 'read')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if v_body = '' then return jsonb_build_object('ok', false, 'error', 'body'); end if;
  select count(*) into v_n from semis_logi_private.bbs_comments where author_id = c.account_id and created_at > now() - interval '1 minute';
  if v_n >= 20 then return jsonb_build_object('ok', false, 'error', 'rate'); end if;
  insert into semis_logi_private.bbs_comments(post, body, author_id, author_name) values (x.id, v_body, c.account_id, c.name) returning id into v_id;
  update semis_logi_private.bbs_posts set ncomments = ncomments + 1 where id = x.id;
  perform semis_logi_private.bbs_notify(x.board);
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

create or replace function public.semis_logi_bbs_delete(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c record; x semis_logi_private.bbs_posts%rowtype; b jsonb; v_id text; v_n int := 0; v_k int; v_boards text[] := '{}'; v_rw int;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  for v_id in select jsonb_array_elements_text(case when jsonb_typeof(p -> 'ids') = 'array' then p -> 'ids' else '[]'::jsonb end) limit 200 loop
    select * into x from semis_logi_private.bbs_posts where id = semis_logi_private.bbs_int(v_id, 0) and deleted_at is null;
    if not found then continue; end if;
    b := semis_logi_private.bbs_board(x.board);
    if b is not null and semis_logi_private.bbs_rr(b) < semis_logi_private.bbs_rank(b ->> 'read') then continue; end if;
    v_rw := case when b is null then c.rank else semis_logi_private.bbs_rw(b) end;
    if v_rw < 3 then
      if v_rw < 0 or x.author_id is distinct from c.account_id then return jsonb_build_object('ok', false, 'error', 'forbidden', 'n', v_n); end if;
      if exists (select 1 from semis_logi_private.bbs_posts y where y.thread = x.thread and y.deleted_at is null and y.depth > x.depth
                   and y.path like x.path || '%' and y.author_id is distinct from c.account_id) then
        return jsonb_build_object('ok', false, 'error', 'replies', 'n', v_n);
      end if;
    end if;
    update semis_logi_private.bbs_posts y set deleted_at = now(), deleted_by = c.name
     where y.deleted_at is null and (y.id = x.id or (y.thread = x.thread and y.depth > x.depth and y.path like x.path || '%'));
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
    v_boards := array_append(v_boards, x.board);
  end loop;
  delete from semis_logi_private.bbs_posts where deleted_at < now() - interval '90 days';
  perform semis_logi_private.bbs_notify(t) from (select distinct unnest(v_boards) t) z;
  return jsonb_build_object('ok', true, 'n', v_n);
end $function$;

create or replace function public.semis_logi_bbs_move(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c record; bt jsonb; bf jsonb; x semis_logi_private.bbs_posts%rowtype; v_to text := left(coalesce(p ->> 'to', ''), 8); v_id text; v_no int; v_n int := 0;
  y record; v_from text[] := '{}';
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  bt := semis_logi_private.bbs_board(v_to);
  if (case when bt is null then c.rank else semis_logi_private.bbs_rw(bt) end) < 3 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if bt is null or semis_logi_private.bbs_rr(bt) < semis_logi_private.bbs_rank(bt ->> 'read') then return jsonb_build_object('ok', false, 'error', 'nf'); end if;
  perform pg_advisory_xact_lock(hashtext('semis_logi_bbs:' || v_to));
  for v_id in select jsonb_array_elements_text(case when jsonb_typeof(p -> 'ids') = 'array' then p -> 'ids' else '[]'::jsonb end) limit 200 loop
    select * into x from semis_logi_private.bbs_posts where id = semis_logi_private.bbs_int(v_id, 0) and deleted_at is null and depth = 0 and board <> v_to;
    if not found then continue; end if;
    bf := semis_logi_private.bbs_board(x.board);
    if bf is not null and (semis_logi_private.bbs_rr(bf) < semis_logi_private.bbs_rank(bf ->> 'read') or semis_logi_private.bbs_rw(bf) < 3) then continue; end if;
    v_from := array_append(v_from, x.board);
    for y in select id from semis_logi_private.bbs_posts where thread = x.thread order by path loop
      select coalesce(max(no), 0) + 1 into v_no from semis_logi_private.bbs_posts where board = v_to;
      update semis_logi_private.bbs_posts set board = v_to, no = v_no, cat = case when semis_logi_private.bbs_on(bt, 'cat') then cat else '' end,
             updated_at = now(), updated_by = c.name where id = y.id;
      v_n := v_n + 1;
    end loop;
  end loop;
  perform semis_logi_private.bbs_notify(v_to);
  perform semis_logi_private.bbs_notify(t) from (select distinct unnest(v_from) t) z;
  return jsonb_build_object('ok', true, 'n', v_n);
end $function$;

create or replace function public.semis_logi_bbs_recent(p jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare c record; v_n int; v_ids text[]; v_rows jsonb;
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  v_n := greatest(1, least(semis_logi_private.bbs_int(p ->> 'n', 6), 30));
  select coalesce(array_agg(b ->> 'id'), '{}') into v_ids from semis_logi_private.bbs_boards() b
   where semis_logi_private.bbs_rr(b) >= semis_logi_private.bbs_rank(b ->> 'read')
     and (case when jsonb_typeof(p -> 'b') = 'array' then (b ->> 'id') in (select jsonb_array_elements_text(p -> 'b'))
               else semis_logi_private.bbs_on(b, 'dash') end);
  select coalesce(jsonb_agg(semis_logi_private.bbs_row(x, c.account_id, 3) order by (x.pinned and (x.pin_until is null or x.pin_until >= semis_logi_private.bbs_today())) desc, x.created_at desc), '[]'::jsonb)
    into v_rows
    from semis_logi_private.bbs_posts x
    join (select k.id from semis_logi_private.bbs_posts k where k.board = any(v_ids) and k.deleted_at is null and k.depth = 0
           order by (k.pinned and (k.pin_until is null or k.pin_until >= semis_logi_private.bbs_today())) desc, k.created_at desc limit v_n) pg on pg.id = x.id;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'boards', to_jsonb(v_ids));
end $function$;

create or replace function public.semis_logi_bbs_stats()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare c record; v_out jsonb := '{}'::jsonb; v_idx jsonb; r record; v_ids text[];
begin
  select * into c from semis_logi_private.bbs_me();
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select coalesce(array_agg(b ->> 'id'), '{}') into v_ids from semis_logi_private.bbs_boards() b
   where semis_logi_private.bbs_rr(b) >= semis_logi_private.bbs_rank(b ->> 'read');
  for r in select b ->> 'id' as id, semis_logi_private.bbs_newdays(b) as nd from semis_logi_private.bbs_boards() b
            where (b ->> 'id') = any(v_ids) loop
    v_out := v_out || jsonb_build_object(r.id, (
      select jsonb_build_object('total', count(*),
               'fresh', count(*) filter (where x.created_at > now() - make_interval(days => r.nd)),
               'unread', count(*) filter (where x.created_at > now() - make_interval(days => r.nd)
                                            and x.author_id is distinct from c.account_id
                                            and not exists (select 1 from semis_logi_private.bbs_reads d where d.post = x.id and d.account_id = c.account_id)))
        from semis_logi_private.bbs_posts x where x.board = r.id and x.deleted_at is null));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'b', x.board, 'no', x.no, 'title', x.title, 'by', x.author_name, 'at', x.created_at, 'cat', x.cat)
                            order by x.created_at desc), '[]'::jsonb) into v_idx
    from (select x.* from semis_logi_private.bbs_posts x
           where x.deleted_at is null and x.board = any(v_ids)
           order by x.created_at desc limit 300) x;
  return jsonb_build_object('ok', true, 'boards', v_out, 'index', v_idx);
end $function$;

/* ─── 실행 권한 — 도우미는 anon 이 직접 부르지 못하게(정책이 쓰는 두 함수만 허용) ─── */
revoke all on function semis_logi_private.scope_of(text, jsonb), semis_logi_private.scope_clean(jsonb, text),
  semis_logi_private.me_scope(), semis_logi_private.scope_levels(jsonb), semis_logi_private.scope_lvl(jsonb, text),
  semis_logi_private.scope_eff(text, text, int), semis_logi_private.scope_acl(jsonb, int), semis_logi_private.scope_board(jsonb, text),
  semis_logi_private.scope_fol(jsonb, int), semis_logi_private.mod_rank(text, boolean),
  semis_logi_private.bbs_rr(jsonb), semis_logi_private.bbs_rw(jsonb)
  from public, anon, authenticated;
revoke all on function semis_logi_private.acl_now(), semis_logi_private.acl_ok(jsonb, int, text, boolean) from public;
grant execute on function semis_logi_private.acl_now(), semis_logi_private.acl_ok(jsonb, int, text, boolean) to anon, authenticated, service_role;
