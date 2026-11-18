/* H:drive — Task 관리 권한표(semis-logi-security.sql 의 같은 줄과 맞춘다).
   - tasks   : 안전보안파트 할 일(공용 행) — 읽기 · 쓰기 3(안전보안파트 · 시스템관리자). 마이그레이션 semis_logi_tasks_1
   - taskCfg : 담당자 명단 { members: [이름] } — 읽기 3 · 쓰기 4(시스템관리자, 설정성 자료). 마이그레이션 semis_logi_tasks_2
   운영 적용은 이 파일 전체를 다시 넣어도 된다(on conflict 로 같은 값). */

insert into semis_logi_private.key_acl(key, read_rank, write_rank) values ('tasks',3,3), ('taskCfg',3,4)
on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank;
