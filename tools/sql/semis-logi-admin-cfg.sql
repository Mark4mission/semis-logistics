/* H:drive — 설정성 자료는 시스템관리자만 고친다(서버에서도)
   ① 설정만 담은 컬렉션 → 쓰기 등급 4(key_acl): 무재해 기준일 · 보안등급 이력 · 기체 목록 · 회의록 폴더 · 보안 기록부 양식 · 순찰일지 양식 · 자체 점검 안내
   ② 업무 자료와 한 행에 섞인 설정 칸 → 시스템관리자가 아닌 계정 세션이 바꾸면 그 칸만 서버 값 그대로 두고 나머지는 저장
      phonebook.groups(구역) · threat.form(보고양식) · desk.cfg.areas(분야별 담당)
      (거절하지 않는 까닭: 한 번에 보낸 다른 컬렉션까지 되돌려지지 않게 — 화면은 이 칸을 시스템관리자에게만 열어 둠)
   SQL · 서비스 권한(세션 없음, rank_now() = -1)은 막지 않는다.
   적용: 마이그레이션 semis_logi_security_29_admin_cfg · 검증: node semis-logi-admin-cfg.test.mjs semis-logi-admin-cfg.sql (PGlite) */

update semis_logi_private.key_acl set write_rank = 4
 where key in ('safetyBoard', 'levelHistory', 'fleet', 'minuteFolders', 'seclogCfg', 'patrolCfg', 'selfCheckCfg');

create or replace function semis_logi_private.admin_field_path(p_key text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_key when 'phonebook' then array['groups'] when 'threat' then array['form'] when 'desk' then array['cfg', 'areas'] end
$$;

create or replace function semis_logi_private.guard_admin_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r int; p text[]; n int; keep jsonb;
begin
  p := semis_logi_private.admin_field_path(new.key);
  if p is null then return new; end if;
  r := semis_logi_private.rank_now();
  if r < 0 or r >= 4 then return new; end if;
  -- 행 모양을 바꿔 설정 칸을 통째로 덮는 것은 거절(화면은 늘 객체로 보냄)
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception using errcode = '42501', message = 'semis_admin_field', detail = new.key;
  end if;
  keep := case when tg_op = 'UPDATE' and jsonb_typeof(old.value) = 'object' then old.value #> p end;
  if (new.value #> p) is not distinct from keep then return new; end if;
  if keep is null then
    new.value := new.value #- p;
  else
    n := array_length(p, 1);
    if n > 1 and jsonb_typeof(new.value #> p[1:n - 1]) is distinct from 'object' then
      new.value := jsonb_set(new.value, p[1:n - 1], '{}'::jsonb, true);
    end if;
    new.value := jsonb_set(new.value, p, keep, true);
  end if;
  return new;
end $$;
revoke all on function semis_logi_private.admin_field_path(text) from public, anon, authenticated;
revoke all on function semis_logi_private.guard_admin_fields() from public, anon, authenticated;

-- BEFORE 트리거는 이름 순서 — 저장 충돌 확인(0_) 다음, 시각 · 이력(a_ · snap) 전
drop trigger if exists semis_logi_store_1_admin on public.semis_logi_store;
create trigger semis_logi_store_1_admin before insert or update on public.semis_logi_store
  for each row execute function semis_logi_private.guard_admin_fields();
