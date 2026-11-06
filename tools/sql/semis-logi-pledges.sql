/* ═══════════════════════════════════════════════════════
   H:drive — SSI 서약 명단 조회 (참고용 사본)
   원본은 SeMIS v2 보안서약서 관리(비공개 표 semis_v2_private.pledges, v2 저장소 tools/sql/semis-v2-pledges.sql).
   적용: v2 마이그레이션 semis_v2_security_14_pledges · 15_pledge_expiry · 16_pledge_cancel.
   Logistics 세션(manager 이상)에 사람별 최신 서약 1건(무효 제외 최신)의 성명 · 소속 · 직위 · 서약일 · 상태 · 해지일 · 서약 횟수만 준다.
   상태: 유효 · 만료 예정(퇴사·전출 일자 전) → valid, 만료(퇴사·전출 일자부터) → left, 무효 → void. 해지(left · void)면 off = 해지일.
   해지일부터 90일이 지난 기록은 v2 서버(pledge_purge, 매일 00:05 KST)가 지운다.
   사번 · 생년월일 · 서명 · IP 는 주지 않는다(국토부 제출용 관리대장은 v2 에서 출력).
   ═══════════════════════════════════════════════════════ */
create or replace function public.semis_logi_pledges() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if semis_logi_private.rank_now() < 2 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
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
end $$;
revoke execute on function public.semis_logi_pledges() from public, authenticated;
grant execute on function public.semis_logi_pledges() to anon, service_role;
