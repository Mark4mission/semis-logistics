/* H:drive — Task 관리(안전보안파트 할 일, 공용 행 tasks) 권한표. 읽기 · 쓰기 모두 3(안전보안파트 · 시스템관리자).
   운영 적용은 마이그레이션 semis_logi_tasks_1 (이 파일 전체 — semis-logi-security.sql 의 같은 줄과 맞춘다). */

insert into semis_logi_private.key_acl(key, read_rank, write_rank) values ('tasks',3,3)
on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank;
