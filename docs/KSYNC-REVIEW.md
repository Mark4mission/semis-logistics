# K드라이브 동기화 v1.61 — 리뷰 결함 · 수정 인계 (로컬에서 이어서)

> 클라우드 세션(2026-11-04)에서 PR #7(`claude/ksync`)을 독립 리뷰(영역 6개 → 결함마다 반박 시도 3회)했다. 41건이 나왔고, 클라우드 사용 한도가 차서 28건은 검증이 끝나지 않았다.
> 이 브랜치(`claude/ksync-wip`)는 **수정 작업 중간 상태**다. SQL 은 일부만 고쳤고 Edge · 에이전트 · 대시보드 · 시험은 아직이다 → **시험이 깨진 상태이니 병합 · 배포 금지**.
> **PR #7 도 이 수정이 끝나기 전에는 운영 적용(마이그레이션 · Edge 배포 · Mac 설치) 금지** — 아래 E1 때문에 실제 에이전트는 Edge 에 한 번도 붙지 못한다.

## 1. 로컬에서 이어서 하는 법

```
cd ~/SeMIS_Logistics && git fetch origin && git switch claude/ksync-wip
npm install && npm i --no-save @electric-sql/pglite
```
그다음 Claude Code(데스크톱)에 이렇게 맡긴다:

```
H:drive K드라이브 동기화 v1.61 리뷰 결함 수정을 이어서 한다.
docs/KSYNC-REVIEW.md 를 먼저 읽고 §3 '남은 일'을 순서대로 끝내고, §4 시험을 모두 통과시킨 뒤
claude/ksync 에 합쳐(브랜치 claude/ksync-wip 의 커밋을 가져오거나 같은 수정을 다시 적용) PR #7 을 갱신해줘.
운영 Supabase 변경은 하지 말 것(Mark 확인 뒤 따로).
```

## 2. 결함 목록

상태: **확인**(반박 3회 중 다수가 실제라고 봄 · 직접 재현) / **반박**(다수가 아니라고 봄) / **미검증**(한도로 검증 못 함 — 각 항목을 코드로 다시 확인할 것). 수정: ✅ 이 브랜치에 반영 · ⬜ 남음 · — 안 고침(이유).

| # | 영역 | 상태 | 수정 | 내용 · 고칠 방법 |
|---|---|---|---|---|
| E1 | Edge | **확인(직접)** · 치명 | ⬜ | Node `fetch` 는 늘 `sec-fetch-mode: cors` 를 보낸다(로컬 HTTP 로 재현) → `handle()` 이 Sec-Fetch-Mode 를 거절해 **실제 에이전트의 모든 요청이 403 origin**. E2E 가 처리기를 직접 불러 못 잡음. → `origin` · `sec-fetch-site` 만 거절, deno 시험에 'sec-fetch-mode 만 있으면 통과' 추가, E2E 를 **실제 로컬 HTTP 서버**(node http → Request → handle)로 돌리게 바꿀 것 |
| E2 | Edge | 미검증 | ⬜ | Content-Length 없을 때 2MB 상한을 다 읽은 뒤에 봄 → 스트림을 읽으며 상한에서 끊기 |
| S1 | SQL | **확인 3/3** | ✅ | 키 실패 기록 상한(15분 500줄)이 IP 차단 셈까지 꺼 버림(재현) → 셈은 새 표 `ksync_fails`(1시간), 기록은 IP 당 15분 한 줄 + 전체 상한 |
| S2 | SQL | **확인 2/3** | ✅ | 승인 전 보류가 다음 회차에 안 막힘 · 에이전트가 `done:true` 로 보류를 지울 수 있음 → `ksync_count` 는 보류 있으면 거절, 회차 끝은 '승인된 보류 + 끝까지 맞춤'일 때만 지움 |
| S3 | SQL | **확인 3/3** | ✅ | `put` mode 'new' + 기준선 줄로 셈 없이 새 현재 판 → 그 판 묶음이 H 에 있으면 version 으로 바꾸고 셈(복원은 제외) |
| S4 | SQL | **확인 3/3** | ✅ | SSI 를 끈 연결에서 K 수정이 ssi 문서인데 파일은 docs/(관리자 열람 가능) → 폴더를 SQL 이 정함(연결 SSI 또는 판 묶음 SSI 면 docs-ssi), Edge 는 이름 부분(`part`)만 넘김 |
| S5 | SQL | **확인 3/3** | ✅ | 판 묶음 키 = K 경로 원문 → 문서함 저장 때 공백이 하나로 바뀌어 묶음이 깨짐 → `ksync_ser()`(공백 하나 · 앞뒤 정리)로 만듦 |
| S6 | SQL | **확인 3/3** | ✅ | H 가 이긴 충돌에서 H 새 파일 이름이 다르면 mark set 이 줄을 지우고 새로 만들어 이어지는 '이전 판 올리기'가 줄을 못 찾음 → mark set 은 id 가 있으면 같은 줄 고침 |
| S7 | SQL | **확인 3/3** · 낮음 | — | 현재 판 순서: SQL 은 제목을 C 정렬, 문서함은 `localeCompare('ko')` → 같은 날짜 · 다른 제목에서만 어긋남. 같은 판 묶음은 제목이 같아 실사용 영향 작음(필요하면 `collate "ko-x-icu"` — Supabase 에 있는지 확인 뒤) |
| S8 | SQL | 미검증(에이전트 영역에서 제기) · 높음 | ✅ | 여러 첨부 문서의 한 파일을 K 에서 고치면 새 판에 그 파일 하나만 → 나머지 첨부가 'H 에서 지움'으로 → 새 판은 지금 판의 첨부를 그대로 두고 그 파일만 바꿈(`ksync_put_apply`) |
| S9 | SQL | 반박 0/3(설계 판단) | ✅ | 올릴 때마다 공용 행 docs 를 고쳐 이력(90일 전체 사본) · 변경 알림이 파일 수만큼 → 올리기를 begin → verify(저장소 재측정) → **apply(여러 건을 한 번에)** 로 바꿈(SQL 반영, Edge · 에이전트는 ⬜). rename 제목 변경도 mark 호출당 한 번 저장 |
| S10 | SQL | 반박 1/1 | ⬜ | K 삭제 확정 때 그 파일의 '(충돌 날짜)' 이전 판이 남아 현재 판이 됨 → `semis_logi_ksync_resolve` confirm 에서 `regexp_replace(name, ' \(충돌 \d{4}-\d{2}-\d{2}( \d+)?\)(\.[^./]{1,10})?$', '\2') = h_name` 인 파일도 뺄 것(작아서 그냥 고치길 권함) |
| S11 | SQL | 미검증 | ⬜ | 승인한 보류가 그 연결을 못 맞춘 회차(폴더 없음 등)에 소진 → S2 수정으로 'done 일 때만 지움'이 되어 해결됐는지 시험으로 확인 |
| S12 | SQL | 반박 | — | `ksync_url_path` 가 docs/ · docs-ssi/ 밖 폴더도 받음(문서함 문서에 다른 폴더 파일이 붙을 수 있어 그대로) · 내려받기 전송량을 문서 JSON 크기로 셈(작음) |
| D1 | 대시보드(SQL) | 미검증 | ⬜ | 미리보기 연결의 방향 · SSI 를 바꿔도 옛 미리보기 그대로 → `map_save` 에서 preview 상태면 preview = null + 요청 표시 |
| D2 | 대시보드 | 미검증 | ⬜ | 늦게 온 불러오기 · 동작 결과가 다른 설정 탭 위에 그려짐 → `paint()` 앞에서 K드라이브 탭이 지금 선택인지 · box 가 붙어 있는지 확인 |
| D3 | 대시보드 | 미검증 | ⬜ | 탭을 열기만 해도 보안 이벤트를 '본 것'으로 → `_events` 는 `p.seen` 일 때만 ev_seen_at 갱신, 새 이벤트가 있으면 보안 카드를 '보안 이벤트' 탭으로 열고 그때 seen |
| D4 | 대시보드 | 미검증 | ⬜ | 이 탭에서 [삭제 확정] · 에이전트 등록으로 docs 가 바뀌면 설정 화면이 다시 그려져 '메뉴 관리'로 튕김 → modules.js 설정 화면이 마지막 탭을 기억(다른 시험 영향 확인) |
| D5 | 대시보드 | 미검증 | ⬜ | 건너뜀 · 오류가 기준선 줄과 마지막 실행 기록에서 두 번 → 같은 연결 · 경로는 한 번 |
| D6 | 대시보드 | 미검증 | ⬜ | 레일 배지를 10분마다 확인하지 않음(화면을 다시 그릴 때만) → setInterval 10분(보이는 탭 · 시스템관리자만, jsdom 제외) |
| D7 | 대시보드 | 미검증 | ⬜ | [발급] 두 번 누르면 키 두 개(첫 키는 못 봄) → 누르는 동안 단추 끄기 |
| A1 | 에이전트 | 미검증 | ⬜ | 색인 오류(읽기 · stat 실패 · 2만 개 상한)를 K 삭제로 봄, 또는 충돌 없이 H 로 덮어씀 → 색인 오류 경로(폴더면 그 아래 전부)는 계획에서 '모름'으로 건너뜀, 상한이면 그 연결 건너뜀 |
| A2 | 에이전트 | 미검증 | ⬜ | 맥 SMB 는 대소문자를 안 가림: H 새 파일 'A.pdf' 가 K 의 'a.pdf' · 같은 이름 폴더를 이전판으로 옮김 → `freePath` 를 소문자로 비교, `getOne` 은 추적하지 않는 K 항목을 옮기지 말고 새 이름으로 |
| A3 | 에이전트 | 미검증 | ⬜ | `_H드라이브_휴지통` · `_H드라이브_이전판` 이 링크면 연결 폴더 밖을 지우거나 옮김 → `cleanTrash` · `moveAside` 가 기준 폴더를 lstat 해서 링크면 거절 |
| A4 | 에이전트 | 미검증 | ⬜ | H 가 이긴 충돌에서 K 파일 이름부터 바꿈 → 내려받기 실패 시 K 수정이 H 로 안 가고 충돌도 안 남음 → 먼저 임시 파일로 받고 확인한 뒤 K 파일 이름 바꾸고 놓기 |
| A5 | 에이전트 | 미검증 | ⬜ | H 짝짓기가 판 묶음+이름만 → 문서함에서 판 묶음을 바꾸면 K 에 중복 → 먼저 주소(url) 같은 것끼리 짝짓고, 판 묶음이 바뀌었으면 기준선만 고침(link + id) |
| A6 | 에이전트 | 미검증 | ⬜ | 같은 날 두 번째 충돌 사본 이름이 `x (충돌 D) 2.ext` 라 색인 제외 규칙에 안 걸림 → `conflictName(rel, today, n)` 으로 `x (충돌 D 2).ext` |
| A7 | 에이전트 | 미검증 | ⬜ | H 만 바뀐 덮어쓰기 직전에 K 파일이 바뀌었는지 다시 보지 않음 → 색인 때 크기 · 수정 시각과 다르면 'changed' 로 건너뜀(다음 실행에서 충돌로) |
| A8 | 에이전트 | 미검증 | ⬜ | 잠금 파일: 3시간 넘으면 살아 있는 실행도 낡은 것으로 · 해제가 남의 잠금도 지움 → 내 pid 일 때만 해제, 살아 있으면 12시간까지 양보 |
| A9 | 에이전트 | 미검증 | ⬜ | `.ksync-*.part` 임시 파일이 남으면 안 지움 → 색인 때 하루 지난 것 정리 |
| A10 | 에이전트 | 미검증 | ⬜ | `ensureMount` 가 % 해석된 공유 이름을 마운트 주소에 넣음 → 원래(인코딩된) 공유 이름으로 |
| A11 | 에이전트 | 미검증 | ⬜ | '오늘 끝냄' 30분 가드 = 실행 간격 30분 → 25분으로 |
| A12 | 에이전트 | 미검증 | ⬜ | 매일 시각 전의 수동 · `--once` 실행이 그날 매일 실행을 써 버림 → 매일 시각 이후에 끝난 실행만 '오늘 끝냄' |
| A13 | 에이전트 | 미검증 | ⬜ | 휴지통 정리 실패가 실행 전체를 'fail' 로 → 연결마다 try/catch · 경고만 |
| A14 | 에이전트 | 미검증 | ⬜ | `--dry-run` 이 사내망 밖에서 보고 · 알림 · 상태 변경 → dry-run 은 출력만 |
| A15 | 에이전트 | 미검증 | ⬜ | 로그인 직후 445 한 번 실패로 '연결 안 됨' 알림 → 5초 간격 3번까지 |

## 3. 남은 일 (순서)

1. **SQL** (`tools/sql/semis-logi-ksync.sql` — 이 브랜치에서 S1~S6 · S8 · S9 반영됨): S10 · D1 · D3(`_events` 의 `p.seen`) 마저. `ksync_put_commit` 은 없어지고 `put_verify` · `put_apply` 로 바뀜(입구 함수 동작 목록도)
2. **Edge** (`tools/edge/semis-logi-ksync.ts`): E1 · E2 · 올리기 3단계 — `put {phase:'begin'}` 은 `part = newPath('', 이름)` 의 '태그_이름'만 SQL 로 넘기고 SQL 이 돌려준 `path` 로 업로드 서명 URL, `put {phase:'verify', path}` = `put_peek` → 저장소에서 다시 읽어 sha256 · 크기 → `put_verify`(불일치면 파일 지움), 새 동작 `apply {run, paths[]}` → `put_apply`(prefix 는 **Edge 가 PUBLIC_PREFIX 를 넣음** — 에이전트 값 쓰지 말 것)
3. **에이전트** (`tools/ksync/*.mjs`): A1~A15, 올리기를 begin → 업로드 → verify 로 하고 연결마다(또는 50건마다) `apply` 한 번
4. **대시보드** (`js/ksync.js` · `js/modules.js`): D2~D7
5. **시험**: SQL(`put_commit` → verify/apply, S1 차단 재현(46 IP × 11 → 새 IP 도 차단), S2 보류 유지, S3 셈, S4 docs-ssi, S5 공백, S6 줄 유지, S8 여러 첨부, S10) · Edge(E1 — sec-fetch-mode 통과 · origin 거절, 3단계 올리기) · 에이전트 계획(A1 · A2 · A5 · A6) · E2E(실제 HTTP 서버, 여러 첨부 문서, 이름 다른 H 승 충돌, 읽기 실패 파일) · jsdom [KS](D1~D7)
6. 문서: `docs/KSYNC.md` §4 · §6(올리기 3단계 · 차단 셈 · 보류 규칙) · HANDOFF §7 · §8 · 이 파일 상태 갱신
7. `claude/ksync` 에 합치고 PR #7 갱신 → Mark 확인 뒤 운영 적용(마이그레이션 → Edge → 병합 → Mac 설치)

## 4. 시험 명령

```
npm test
node tools/sql/semis-logi-ksync.test.mjs tools/sql/semis-logi-ksync.sql tools/sql/semis-logi-conflict.sql
deno test --node-modules-dir=none --allow-net --allow-env --allow-read tools/edge/semis-logi-ksync.test.ts
node tools/ksync/test/plan.test.mjs
node tools/ksync/test/e2e.test.mjs
```
`npm test` 의 FL04 · FL08 은 한국 시각 00~03시쯤 날짜 경계로 main 에서도 실패한다(2026-11-04 확인) — 낮에 다시 돌릴 것.
