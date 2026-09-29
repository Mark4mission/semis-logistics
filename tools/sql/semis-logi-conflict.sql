/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics v1.24 — 저장 충돌 방지 (서버 기준 시각 확인)
   적용: 마이그레이션 semis_logi_security_12_base_check (1단계: base_at 을 보낸 저장만 확인)
         → 앱 배포 후 semis_logi_security_13_base_strict (2단계: 계정 세션의 저장은 base_at 필수)

   사고(2026-09-29): 9/28 09:21에 열어 둔 Edge 탭이 잠자기 탭으로 멈춰 있다가 이튿날 08:24에 깨어나
   일정 자동 연기를 저장하면서, 9/28 오전의 일정 26건으로 서버의 61건을 통째로 덮어썼다.
   → 앱은 저장할 때 마지막으로 받은 행의 updated_at 을 base_at 으로 함께 보낸다.
     그 사이 서버 값이 바뀌었으면(또는 base_at 이 없으면 — 옛 화면) 거절(HTTP 409, PT409 semis_conflict).
     앱은 서버 값을 다시 받아 3-way 병합 후 새 기준으로 다시 저장한다(js/sync.js).
   - 계정 세션(ctx().kind = 'user')의 저장만 확인한다. SQL(서비스 권한) · 회의 서명 RPC(signer)는 그대로.
   - base_at 은 확인에만 쓰고 저장하지 않는다(항상 null 로 되돌림 → 옛 화면의 upsert 는 base_at 이 비어 거절됨).
   - BEFORE INSERT 에는 걸지 않는다: INSERT … ON CONFLICT 의 excluded 값에 BEFORE INSERT 결과가 반영되므로
     거기서 지우면 이어지는 UPDATE 가 늘 충돌한다.
   ═══════════════════════════════════════════════════════ */

alter table public.semis_logi_store add column if not exists base_at timestamptz;
comment on column public.semis_logi_store.base_at is
  'v1.24 저장 충돌 확인용(앱이 마지막으로 받은 updated_at). 확인 후 null 로 되돌려 저장하지 않는다';

create or replace function semis_logi_private.check_base() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.base_at is distinct from old.updated_at
     and exists (select 1 from semis_logi_private.ctx() c where c.kind = 'user') then
    raise exception using errcode = 'PT409', message = 'semis_conflict', detail = new.key, hint = 'reload';
  end if;
  new.base_at := null;
  return new;
end $$;
revoke all on function semis_logi_private.check_base() from public, anon, authenticated;

-- BEFORE 트리거는 이름 순서로 돈다 — 0_ 으로 가장 먼저(거절이면 이력 · 시각 처리 전에 끝남)
drop trigger if exists semis_logi_store_0_base on public.semis_logi_store;
create trigger semis_logi_store_0_base before update on public.semis_logi_store
  for each row execute function semis_logi_private.check_base();
