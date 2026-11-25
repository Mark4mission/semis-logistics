-- v1.85 주기장 — semis_logi_adsb 에 칸 두 개(기체 행 stand · _meta 행 stand_fetched_at 잠금). Edge 함수 semis-logi-adsb 가 ?cron=1 때 채운다.
-- stand(jsonb): { st 주기장, ll [위도, 경도] | null, ex 좌표가 정확한 번호인지, by arr|dep, arr {flt, at, apt, st}, dep {…}, term }
--   _meta 행 stand: { at, icn 인천 지상 대수, n 주기장 찾은 대수, err }
alter table public.semis_logi_adsb add column if not exists stand jsonb;
alter table public.semis_logi_adsb add column if not exists stand_fetched_at timestamptz;
update public.semis_logi_adsb set stand_fetched_at = '2000-01-01T00:00:00Z' where hex = '_meta' and stand_fetched_at is null;
