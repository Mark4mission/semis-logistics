/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 서버 보안 2단계: 잠금 (v1.15.0, 2026-09-25)
   새 앱(v1.15 — 로그인 세션 · 비공개 파일) 배포를 확인한 뒤 적용한다.
   이 시점부터 로그인하지 않은 요청(공개 키만 가진 요청)은 공용 데이터·파일을 읽고 쓸 수 없다.
   - 이 파일은 참고용 사본이다. 실제 적용은 Supabase 마이그레이션으로 했다.
   ═══════════════════════════════════════════════════════ */

/* 1) 공용 데이터: 누구나 읽기·쓰기·삭제 허용 정책 제거 (세션 정책만 남김) */
drop policy if exists "logi anon read"   on public.semis_logi_store;
drop policy if exists "logi anon insert" on public.semis_logi_store;
drop policy if exists "logi anon update" on public.semis_logi_store;
drop policy if exists "logi anon delete" on public.semis_logi_store;

/* 2) 변경 이력: Logistics 행은 시스템관리자 RPC(semis_logi_history)로만. SeMIS v2 행은 그대로 */
drop policy if exists "history read" on public.semis_store_history;
drop policy if exists "history read (v2 only)" on public.semis_store_history;
create policy "history read (v2 only)" on public.semis_store_history for select to anon, authenticated
  using (src <> 'semis_logi_store');

/* 3) Realtime 행 변경 방송 중단(값이 실린다) — 변경 알림은 Broadcast 트리거(컬렉션 이름만)가 대신 */
alter publication supabase_realtime drop table public.semis_logi_store;

/* 4) 파일 버킷 비공개 + 누구나 목록·올리기·삭제 정책 제거 — Edge Function 서명 URL로만 */
update storage.buckets set public = false, file_size_limit = 52428800 where id = 'semis-logi-files';
drop policy if exists "anon read semis-logi-files"   on storage.objects;
drop policy if exists "anon insert semis-logi-files" on storage.objects;
drop policy if exists "anon delete semis-logi-files" on storage.objects;

/* 5) 공용 데이터에 남은 옛 계정 자료(암호 해시) 삭제 — 서버 전용 표로 이관 완료.
      삭제 직전 값은 이력 트리거가 남기므로 이력 행도 함께 지운다. */
delete from public.semis_logi_store   where key in ('pwOverrides', 'userOverrides', 'customUsers', '__hist_probe');
delete from public.semis_store_history where src = 'semis_logi_store'
  and key in ('pwOverrides', 'userOverrides', 'customUsers', '__hist_probe');
