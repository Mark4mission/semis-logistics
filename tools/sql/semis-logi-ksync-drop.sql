-- K드라이브 동기화 제거 — 운영자 결정: 보안상 자동 동기화(양방향 모두)를 두지 않고 H:drive 를 단일 저장소로 쓴다.
-- 이미 문서함에 들어온 문서(src "ksync")와 저장소 파일은 그대로 둔다.
-- 동기화 기록 표(기준선 · 실행 · 보안 이벤트)는 지우지 않고 아무 역할도 접근할 수 없는 보관 스키마로 옮긴다.
-- 완전히 지우려면: drop schema semis_logi_ksync_archive cascade;

drop trigger if exists semis_logi_store_ksync_req on public.semis_logi_store;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname like 'semis\_logi\_ksync\_%')
        or (n.nspname = 'semis_logi_private' and p.proname like 'ksync\_%')
  loop
    execute 'drop function if exists ' || r.f::text;
  end loop;
end $$;

create schema if not exists semis_logi_ksync_archive;
revoke all on schema semis_logi_ksync_archive from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['ksync_agents', 'ksync_maps', 'ksync_files', 'ksync_runs', 'ksync_run_sers', 'ksync_folders',
                           'ksync_events', 'ksync_state', 'ksync_uploads', 'ksync_fails'] loop
    if to_regclass('semis_logi_private.' || t) is not null then
      execute format('alter table semis_logi_private.%I set schema semis_logi_ksync_archive', t);
      execute format('revoke all on semis_logi_ksync_archive.%I from public, anon, authenticated, service_role', t);
    end if;
  end loop;
end $$;
