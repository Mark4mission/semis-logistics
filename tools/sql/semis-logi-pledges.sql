/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — SSI 서약 명단 조회 (v1.21, 2026-09-27)
   원본은 SeMIS v2 보안서약서 관리(비공개 표 semis_v2_private.pledges, v2 저장소 tools/sql/semis-v2-pledges.sql).
   적용: v2 마이그레이션 semis_v2_security_14_pledges 에 함께 들어 있다. 이 파일은 Logistics 쪽 참고용 사본이다.
   Logistics 세션(manager 이상)에 사람별 최신 서약 1건의 성명 · 소속 · 직위 · 서약일 · 상태 · 서약 횟수만 준다.
   사번 · 생년월일 · 서명 · IP 는 주지 않는다(국토부 제출용 명단은 v2 에서 출력).
   ═══════════════════════════════════════════════════════ */
create or replace function public.semis_logi_pledges() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if semis_logi_private.rank_now() < 2 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'asOf', now(), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('name', z.name, 'dept', z.dept, 'position', z.position,
                                        'date', to_char(z.at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
                                        'state', z.state, 'n', z.n) order by z.at desc)
      from (select distinct on (semis_v2_private.pledge_pkey(x.emp_id, x.name))
                   x.name, x.dept, x.position, x.at, x.state,
                   count(*) over (partition by semis_v2_private.pledge_pkey(x.emp_id, x.name)) as n
              from semis_v2_private.pledges x
             order by semis_v2_private.pledge_pkey(x.emp_id, x.name), (x.state = 'valid') desc, x.at desc) z), '[]'::jsonb));
end $$;
revoke execute on function public.semis_logi_pledges() from public, authenticated;
grant execute on function public.semis_logi_pledges() to anon, service_role;
