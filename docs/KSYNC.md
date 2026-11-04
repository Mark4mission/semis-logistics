# K드라이브 동기화 (v1.61)

H:drive 의 자료와 K드라이브(사내 네트워크 드라이브, SMB 공유)의 자료를 같은 상태로 유지한다.
동기화된 자료는 양쪽 모두 평소 자료다 — K 에서 온 파일은 그 화면 문서함의 일반 문서, H:drive 문서는 K 폴더의 일반 파일.
H:drive 안에서 K드라이브를 들여다보는 화면은 없고, **동기화 작업의 감시 · 관리만 시스템관리자 전용**이다(시스템 설정 › K드라이브 동기화).

> 이 문서는 공개 저장소에 있다. 실제 서버 주소 · 공유 이름 · IP · 계정 · 키는 적지 않는다(예시는 `smb://<서버>/<공유>`, IP 는 문서용 예시 대역).

## 1. 구조

```
[K드라이브 SMB] ⇄ [Mac 에이전트 tools/ksync — launchd, 색인 · 계획 · 실행, 나가는 HTTPS 만 · 들어오는 포트 없음]
                        ⇅ HTTPS, 에이전트 키 + 허용 IP(회사 출구 IP)에서만
             [Edge semis-logi-ksync] → 버킷 semis-logi-files (docs/ · docs-ssi/ — 기존 문서함 폴더)
                        ⇣           → public.semis_logi_ksync_agent(서비스 권한만) → semis_logi_private.ksync_* → 공용 행 docs(행 잠금 후 수정)
             [비공개 표 ksync_*] ← 관리 RPC semis_logi_ksync_*(시스템관리자) ← [시스템 설정 › K드라이브 동기화]
```

| 부분 | 파일 | 시험 |
|---|---|---|
| SQL(표 · 관리 RPC · 에이전트 함수) | `tools/sql/semis-logi-ksync.sql` (마이그레이션 `semis_logi_security_30_ksync`) | `node tools/sql/semis-logi-ksync.test.mjs tools/sql/semis-logi-ksync.sql tools/sql/semis-logi-conflict.sql` (PGlite + pgcrypto) |
| Edge | `tools/edge/semis-logi-ksync.ts` (verify_jwt false) | `deno test --node-modules-dir=none --allow-net --allow-env --allow-read tools/edge/semis-logi-ksync.test.ts` (실제 SQL 을 PGlite 로) |
| Mac 에이전트 | `tools/ksync/ksync.mjs` · `plan.mjs`(계획 — 순수 함수) · `lib.mjs` · `install.sh` · `uninstall.sh` | `node tools/ksync/test/plan.test.mjs`(npm test 에 포함) · `node tools/ksync/test/e2e.test.mjs`(에이전트 ↔ 실제 Edge 코드 ↔ 실제 SQL, K = 임시 폴더) |
| 대시보드 | `js/ksync.js` (시스템 설정 탭) | `npm test` [KS] |

PGlite 는 `npm i --no-save @electric-sql/pglite` 로 받고 끝나면 `npm prune`. E2E 는 Node 22.18 이상(.ts 형식 제거).

## 2. 설치 (Mac — 데스크톱 연결 세션에서)

1. `~/SeMIS_Logistics` 에서 `git pull`
2. Finder › 서버에 연결(⌘K) › `smb://<서버>/<공유>` — **'키체인에 암호 저장'**을 켠다(에이전트가 이 암호로 다시 연결)
3. H:drive › 시스템 설정 › K드라이브 동기화 › ⋯ › **에이전트 키 발급** — 키는 그 창에서 한 번만 보인다
4. 터미널: `bash ~/SeMIS_Logistics/tools/ksync/install.sh`
   - 묻는 것: 동기화 서버 주소(`https://<프로젝트>.supabase.co/functions/v1/semis-logi-ksync`) · K드라이브 주소(`smb://<서버>/<공유>`) · 키(키체인 `security` 가 직접 묻는다 — 두 번, 화면에 안 보임)
   - 만드는 것: `~/Library/Application Support/hdrive-ksync/`(설정 `config.json` 600 · 에이전트 사본 `agent/`) · 키체인 항목 `hdrive-ksync` · LaunchAgent `~/Library/LaunchAgents/kr.hdrive.ksync.plist`(로그인 때 · 30분마다 · 네트워크 설정이 바뀔 때 — 사내망 · VPN 연결 감지)
   - Node 는 `/opt/homebrew/bin/node` 또는 `/usr/local/bin/node`(20 이상) 절대 경로
5. 첫 실행: `node "$HOME/Library/Application Support/hdrive-ksync/agent/ksync.mjs" --once` (사내망 · VPN 에서)
   → 대시보드 '보안 › 허용 IP'의 **후보 IP** 가 회사 출구 IP 인지 확인(Mac 에서 `curl -s https://ifconfig.me` 결과와 비교) → [허용]
6. '폴더 연결 › 연결 추가' — K 폴더(에이전트가 하루 한 번 알려 준 3단계 목록) ↔ 화면 › 분류(문서함이 있는 화면) · 방향 · SSI → **미리보기 건수**가 나오면 [시작]
7. 다음 확인(30분 안) 때 첫 동기화 — '실행 기록'과 그 화면 문서함 · K 폴더를 확인

다시 설치(주소 · 키 바꾸기)는 `install.sh` 를 다시 실행한다. 제거는 `uninstall.sh`(서버 쪽 키는 대시보드에서 [폐기]).

명령: `--once`(지금 한 번 — 오늘 이미 했어도) · `--dry-run`(계획만 출력, 아무것도 바꾸지 않음) · `--status`. 기록: `~/Library/Logs/hdrive-ksync.log`(30일).

## 3. 언제 도나

- **매일 1회**: 대시보드의 '매일 실행 시각'(기본 08:30, 한국 시각) 이후 Mac 이 사내망에 처음 연결됐을 때. 오늘 끝냈으면 30분 안에는 서버도 부르지 않는다
- **지금 동기화 요청**(대시보드 주 단추): 다음 확인(30분 안) 때 바로. 서버가 에이전트에 보낼 수 있는 것은 이 표시 하나뿐(원격 실행 경로 없음)
- **사내망이 아니면**(SMB 서버 TCP 445 가 4초 안에 안 열림): Mac 알림 하루 한 번("K드라이브에 연결할 수 없습니다. 사내망(VPN)에 연결되면 자동으로 동기화합니다") + 서버에 '연결 안 됨' 보고(1시간에 한 번) → 대시보드 '사내망: 연결 안 됨'. 연결되면 자동으로 이어서

## 4. 판정 규칙 (기준선 = 마지막으로 맞춘 상태)

| 경우 | 동작 |
|---|---|
| K 에만 새 파일 | H 문서 새로 등록(AI 판독 없음, `src: "ksync"`, 제목 = 파일 이름, 날짜 = K 수정 날짜, 판 묶음 = K 경로). SSI 연결이면 `docs-ssi/` + `ssi: true` |
| K 만 바뀜 | H 에 새 판(같은 판 묶음, 지금 제목 · 체크리스트 번호 유지, 날짜는 현재 판보다 이르지 않게 · 배열 맨 앞) |
| H 에만 새 문서 · 새 판 | K 에 저장(연결 폴더 맨 위, 같은 이름이 있으면 ` (2)`). 덮어쓸 옛 파일은 `_H드라이브_이전판/<경로>/<이름> (날짜 시각).<확장자>` |
| 양쪽 다 바뀜 | 수정 시각이 늦은 쪽이 현재 판. 진 쪽은 **H 이전 판**과 **K `이름 (충돌 YYYY-MM-DD).확장자`** 로 남기고 대시보드 '충돌'([확인]) |
| 같은 해시가 다른 경로로 | 이름 바꿈 · 이동 — 기준선만 고침(H 제목이 옛 파일 이름이면 제목도) |
| K 에서 지움 / H 에서 지움 | 자동 전파 안 함 — '삭제 대기'. 대시보드 [삭제 확정] / [복원] |
| 삭제 확정 | K 에서 지운 것 → H 문서(그 판 묶음의 그 파일) 지움 · H 에서 지운 것 → K 파일을 연결 폴더 안 `_H드라이브_휴지통/YYYY-MM-DD/` 로(30일 뒤 에이전트가 정리) |
| 복원 | 지워진 쪽으로 다시 내려받기 · 올리기 |
| 50MB 초과 · 올리지 않는 형식(html · js) · 읽기 실패 | 건너뜀 / 오류 — 이유와 함께 대시보드 |
| K 로 가는 실행 파일 · 스크립트 | K 에 쓰지 않음(형식 차단, 30일에 한 번 기록) |

- 방향: 양쪽 · K → H 만(H 변경은 K 에 쓰지 않음, 충돌은 K 우선) · H → K 만(반대)
- SSI 가 아닌 연결은 H:drive 의 민감보안정보 문서를 K 로 보내지 않는다(서버가 목록에서 뺌)
- 색인에서 빼는 것: `~$*` · `.DS_Store` · `._*` · `Thumbs.db` · `desktop.ini` · `*.tmp` · 숨김(점으로 시작) · `_H드라이브_휴지통` · `_H드라이브_이전판` · `이름 (충돌 날짜)` 사본 · 링크(따라가지 않음). 한글 이름은 NFC 로(맥 SMB 의 NFD 대비)
- 크기 · 수정 시각이 기준선과 같으면 해시를 다시 재지 않는다(변경분만)
- 처음 연결할 때 K 파일과 H 문서가 이름 · 크기가 같으면 전송 없이 '연결만'(중복 방지)

## 5. 대시보드 (시스템 설정 › K드라이브 동기화)

- 머리말: [지금 동기화 요청] · ⋯(에이전트 키 발급 · 폐기 · 매일 실행 시각 · 대량 변경 한도) · 인쇄
- 상태 띠: 에이전트(마지막 연락 · 버전) · 사내망 · 마지막 성공 · 다음 예정 · 오늘 결과. 이틀 넘게 성공이 없으면 경고색 + 한 줄 이유
- 폴더 연결 · 확인 필요(대량 변경 보류 · 삭제 대기 · 충돌 · 건너뜀 · 오류) · 실행 기록(최근 30, A4 인쇄) · 보안(허용 IP · 후보 IP · 에이전트 키 · 보안 이벤트, A4 인쇄)
- 레일 '시스템 설정' 배지: 시스템관리자에게만, 이틀 넘게 실패 · 보류 · 새 보안 이벤트일 때(10분마다 확인)
- 문서함 · 검색 · 아르고는 그대로(동기화된 문서는 일반 문서로 보인다)

## 6. 보안 설계 — 외부 침입자가 동기화 경로를 악용하지 못하게

(사용자 열람 제한을 새로 만드는 것이 아니다 — 문서는 그 화면의 평소 권한 그대로.)

1. **에이전트 키**: 32바이트 무작위. 서버에는 sha256 만(원문은 발급 창에서 한 번), Mac 은 키체인에만. Edge 가 키를 sha256 으로 바꿔 DB 로 넘긴다(원문은 DB 로 가지 않음). 즉시 폐기 · 재발급, 90일 지나면 대시보드에 교체 안내
2. **허용 IP**: 에이전트 호출은 `ip_allow`(회사 출구 IP — 사무실 · VPN 경유) 안에서 온 것만. 목록이 비면 `hello` 만 받고 그 IP 를 후보로(**fail closed** — [허용] 해야 동기화가 열림). 너무 넓은 범위(IPv4 /16 · IPv6 /32 보다 넓음)는 넣을 수 없다. 예외: '연결 안 됨' 보고(`net`)는 회사 밖에서 오므로 허용 IP 를 보지 않는다(키 · 횟수 확인은 그대로, 바꿀 수 있는 것은 그 표시 하나). 접속 IP 규칙은 SQL `client_ip()` 와 같다(cf-connecting-ip, 없으면 x-forwarded-for 마지막 항목)
3. **브라우저 차단**: Origin(또는 Sec-Fetch-*) 헤더가 있는 요청은 거절, CORS 응답 없음
4. **횟수 제한**: 키 실패 IP 당 15분 10회 넘으면 1시간 차단(맞는 키도) · 분당 호출 300 · 하루 전송량 5GB(`ksync_state.limits` — SQL 로만 바꿈)
5. **최소 권한**: 에이전트는 연결된 폴더 · 화면 · 분류의 문서 · 파일만 읽고 고친다(다른 컬렉션 · 다른 화면 문서 · 계정 정보 불가). 올린 파일은 시작(put) 때 서버가 정한 경로 · 크기 · sha256 과 저장소에서 다시 잰 값이 같아야 등록. 입구 함수는 서비스 권한만, 관리 RPC 는 시스템관리자 세션만(아니면 42501)
6. **대량 변경 보류**(랜섬웨어 · 실수 대비): 한 번의 실행에서 한 연결의 변경(새 판 · 덮어쓰기) · 새 삭제 대기가 200건 또는 30%(20건 이상일 때)를 넘으면 그 연결은 실행하지 않고 '보류' → [승인]하면 다음 확인 때 진행, [거절]하면 연결을 멈춤. 에이전트가 미리 세고 **서버도 같은 규칙으로 센다**. 새 연결의 [시작]은 첫 실행 승인을 겸한다
7. **K 쪽 파일 검사**: 실행 파일 · 스크립트(.exe · .bat · .cmd · .com · .scr · .msi · .ps1 · .vbs · .js · .jse · .wsf · .sh · .command · .app · .jar · .lnk · .url · .hta · .html · .htm 등)는 서버가 내려주지 않고 에이전트도 쓰지 않음(`type_block`). 받은 파일의 sha256 이 서버 값과 다르면 버림(`hash_mismatch`). 연결 폴더 밖 경로(.. · 절대 경로 · 링크)는 거절, 임시 파일에 받아 확인한 뒤 이름 바꿈
8. **기록**: 모든 실행(`ksync_runs`, 최근 200줄 — 파일명 · 동작 · 이유만, 400일)과 보안 이벤트(`ksync_events`, 180일)를 대시보드에서 본다. 버킷은 비공개 그대로, 문서함 변경은 기존 90일 이력이 함께 남는다

## 7. 문제 해결

| 증상 | 확인 |
|---|---|
| 대시보드 '에이전트: 없음' / 연락 없음 | Mac 이 켜져 있는지 · `launchctl print gui/$(id -u)/kr.hdrive.ksync` · `~/Library/Application Support/hdrive-ksync/launchd.log` · 로그 |
| '허용 IP 가 없어…' | 첫 hello 뒤 후보 IP 를 확인하고 [허용] |
| 로그 '서버가 이 접속 IP 를 허용하지 않음' | VPN 이 인터넷 전체를 회사로 보내지 않는(분할 터널) 경우 집 IP 로 나간다 — 후보 IP 가 회사 출구가 아니면 허용하지 말 것. 회사 출구 IP 가 바뀌었으면 새 IP 를 허용하고 옛 IP 를 지움 |
| 후보 IP 가 늘 같은 내부 주소로 보임 | Edge 가 받는 IP 헤더가 예상과 다른 것 — 에이전트를 멈추고 Edge IP 규칙(cf-connecting-ip · x-forwarded-for)을 점검 |
| '사내망: 연결 안 됨'이 계속 | Mac 에서 Finder 로 `smb://<서버>/<공유>` 가 열리는지, VPN 연결 상태 |
| 마운트 실패 | Finder 연결 때 '키체인에 암호 저장'을 했는지 |
| 대량 변경 보류 | 그 K 폴더에서 무엇이 바뀌었는지 확인(랜섬웨어 · 대량 이동) → [승인] 또는 [거절] |
| 해시 불일치 · 형식 차단 이벤트 | 저장소 · 네트워크 이상 또는 실행 파일 업로드 — 보안 이벤트의 파일 · IP 확인 |
| 키 유출 의심 | 대시보드에서 [폐기] → 새 키 발급 → Mac 에서 `install.sh` 다시 실행 |
| 계획만 보고 싶음 | `… ksync.mjs --dry-run` |

## 8. 운영 적용 순서

1. 마이그레이션 `semis_logi_security_30_ksync`(= `tools/sql/semis-logi-ksync.sql`)
2. Edge `semis-logi-ksync` 배포(verify_jwt false, 파일 하나)
3. main 병합(GitHub Pages — 대시보드 탭)
4. Mac 설치(§2)

월간 보안 점검 대상에 Edge `semis-logi-ksync` 와 `ksync_events` 를 더한다.
