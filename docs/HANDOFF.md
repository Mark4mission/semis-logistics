# SeMIS · Logistics — 세션 인계서

> 새 세션은 이 문서부터 읽는다. 작업이 끝날 때마다 **§4 모듈 현황**과 **§8 작업 기록**을 갱신한다.

## 1. 현황

| 항목 | 값 |
|---|---|
| 현재 버전 | **v1.17.0** (2026-09-26) — **수검 대응 센터**(국토부 · 해외 당국 · 화주 · 사내 심사 수검의 준비 · 증빙 · 지적 조치 · 재발 추적) · v1.16 로그인 자동공격 방어 · v1.15 서버 보안 위 |
| 접속 주소 | https://mark4mission.github.io/semis-logistics/ |
| 저장소 | GitHub `Mark4mission/semis-logistics` (공개) · Mac `~/SeMIS_Logistics` |
| 테스트 | `npm test` 300건 전부 통과 (가짜 서버로 로그인(작업증명 포함)·RLS·파일 함수 흉내 · 코드에 해시·토큰 없음) |
| 백엔드 | Supabase `mzyuzrxkdcpzxojenwat` — 테이블 `semis_logi_store`(세션 RLS), **비공개** 버킷 `semis-logi-files`, 비공개 스키마 `semis_logi_private`(계정 · 세션 · 로그인 시도 · 접속 기록 · 권한표), RPC `semis_logi_*`, Edge Function `semis-logi-files`(서명 URL) · 운항 현황: Edge Function `semis-logi-adsb` + 테이블 `semis_logi_adsb` · `semis_logi_adsb_events` + pg_cron 2분 |

## 2. 새 세션 시작

Mark가 새 세션 첫 메시지로 붙여넣는 문구:

```
SeMIS · Logistics 작업을 이어서 한다.
GitHub Mark4mission/semis-logistics 의 docs/HANDOFF.md 를 먼저 읽고 현황을 파악한 뒤,
이번에는 [모듈명 / 작업 내용] 을 진행해줘.
```

Claude가 할 일(순서대로):

1. `git clone --depth 1 https://github.com/Mark4mission/semis-logistics.git /home/claude/logi` (컨테이너에서 clone 가능 — push는 불가)
2. `cd /home/claude/logi && npm install && npm test` — 기준선 통과 확인
3. 이 문서 §4 · §6 · §7 확인 후 작업 시작
4. 디자인 작업이면 Impeccable 스킬을 세션에 설치: `git clone --depth 1 https://github.com/pbakaus/impeccable.git /tmp/imp && mkdir -p ~/.claude/skills && cp -r /tmp/imp/.claude/skills/impeccable ~/.claude/skills/` → `~/.claude/skills/impeccable/scripts/impeccable context` (PRODUCT.md 없음 — 좁은 개선은 그대로 진행 가능)

## 3. 배포 절차 (컨테이너 → Mac → GitHub Pages)

컨테이너에는 GitHub 쓰기 권한이 없으므로 **Mac을 거쳐 push**한다. 같은 저장소를 다른 세션이 동시에 고칠 수 있으므로
(2026-09-22~) **tar 덮어쓰기 대신 패치**로 옮긴다.

1. 컨테이너: 작업 전후로 `git fetch && git rebase origin/main`(최신 위에서 작업) → `npm run bump <ver>` → `package.json`·`package-lock.json` version 맞춤 → `npm test` 전부 통과
2. 컨테이너에서 커밋(작성자 Mark) → `git format-patch --binary origin/main -o /mnt/user-data/outputs/logi-patch-v<ver>/`
3. `SendUserFile` → `device_commit_files`로 `~/SeMIS_v2/_logi_transfer/`에 놓기 (SeMIS_v2가 연결 폴더)
4. `Control_your_Mac__osascript`:
   `do shell script "cd ~/SeMIS_Logistics && git pull --ff-only && git am -3 ~/SeMIS_v2/_logi_transfer/<patch> && git push"`
   → 컨테이너 커밋의 tree 해시와 Mac `git rev-parse HEAD^{tree}` 대조
   (Cowork VM의 `device_bash`에서는 git 인증이 없어 push 실패 — 반드시 osascript)
5. 약 80초 후 내장 브라우저(Claude_Browser)로 `index.html`의 `app.js?v=` 스탬프 확인
   (2026-09-25 확인: 컨테이너 playwright로도 github.io 접속 가능 — supabase.co 비-GET 차단 상태에서만)

## 4. 모듈 현황

**완료**

| 라우트 | 파일 | 권한 | 비고 |
|---|---|---|---|
| dashboard | modules.js · hero3d.js | all | 화물 태그 카드(무재해·보안등급) + 3D 장면(에어제타 B747-400F 기수 화물문 탑재) · 하단 4칸(다가오는 일정 · 공지 · 결정사항 · 모듈 구축 현황) |
| flight | flightcore.js · flightops.js | all (기체 목록 편집 hq) | **운항 현황**(v1.14) — 에어제타 화물기 15대 ADS-B 실시간 위치(adsb.lol 중계). 요약(비행 중 · 인천 지상 · 해외 지상 · 신호 없음 · 오늘 인천 도착/출발) · 지도(Leaflet, 비행 경로 · 이름표 겹침 정리) · 인천 입항(접근 중 · 오늘 도착) / 출항(인천 지상 · 오늘 출발) · 기체 현황 15행 · 입출항 기록 48시간. 대시보드: 지도(기체만) + 인천 접근 중 목록 + 최근 인천 도착 |
| schedule | calendar.js | mgr | 담당자 다중 지정 · 드래그 이동 · 등록 폼 2단(입력/설정) · 12색 |
| minutes | minutes.js | mgr | 회의록 + QR 참석 서명 |
| reg-sec · reg-safety · reg-dg | regulations.js | mgr (편집 hq) | 규정 3종 · PDF 뷰어 · 개정 아이디어 노트 |
| crisis | crisis.js | mgr (편집 hq) | **위기대응 담당자**(v1.13) — 회사 위기대응 조직 11곳 × 27팀 × 임무 96건 × 담당자 78명(2026년 명단, 기준 26년 9월). 우리 팀(인천화물팀) 임무 띠 · 조직 줄 필터 · 검색 · 보기 4종(조직별 · 팀별 · 담당자별 · 매트릭스) · 이름 누르면 그 사람 임무 전체 · 비상연락망 동명 1명이면 전화 버튼 · hq: 엑셀 반영(대조 후) · 행 편집 · 기본 정보 · 원본 엑셀 내려받기 |
| contacts | contacts.js | mgr (편집 hq) | 비상연락망 · 보고체계 (2026-09-22 SeMIS v2 연락망 69건 이관 — 12섹션 78행) · **보고 체계도 탭**(v1.10: 보안사고 20 · 안전사고 18 · 위험물사고 29행, 미리보기 → 전체 화면 뷰어) |
| vault | vault.js | hq | 암호 관리 (AES-256-GCM, 5분 자동 잠금, 공용/개인용 — 개인용은 본인 키로만 해독) |
| audit | audit.js | mgr (편집 hq) | **수검 대응 센터**(v1.17, M1) — 외부·사내 점검을 받는 쪽의 준비 → 수검 → 지적 조치 → 종결. 구분 3종(국토부 · 지방항공청 / 해외 당국 · 화주 / 사내 심사). 수검 일정 탭(다음 수검 D-day · 준비 진행 · 미결 지적 · 기한 경과 · 올해 수검, 구분 · 진행 필터) · 지적사항 탭(전 수검 지적 한 표, 미결 · 기한 경과 · 완료) · 상세(기본 정보 · 공문/결과 첨부 · 준비 체크리스트(구분별 기본 항목 · 근거 조항 · 담당 · 증빙 파일 · 제자리 완료 체크) · 지적사항(시정조치 · 개선권고 · 현장시정 · 관찰사항, 조항 · 조치 · 담당 · 기한 · 상태 · 증빙)). 같은 조항이 2개 이상 수검에서 지적되면 '재발'. 일정관리 연동(수검 기간 · 지적 기한). 대시보드 띠(mgr, 60일 안 수검 또는 미결 지적이 있을 때만) · 메뉴 배지(미결 지적) · 통합 검색 · 390px 행 카드 · A4 인쇄 |
| settings | modules.js | admin | 메뉴(숨기기 포함) · 사용자(서버 계정 RPC) · 담당자 · 데이터(변경 이력 복원 — 관리자 RPC) · 저장소(파일 함수) · **보안**(접속 중 · 접속 기록 · 다른 접속 모두 끊기, v1.15) |
| scr-status | screening.js · cares.js | mgr | 화물 보안검색 현황 — 검색 라인 배치(검색대별 X-ray·ETD · 환적·예비) · 오늘 일일점검 · 장비 × 28일 점검 이행(+주간·월간 최근일) · 센서 3곳 × 지표 + 결로 판정 · 최근 고장. 대시보드 4칸 요약 띠(mgr) |
| scr-equip | equipment.js · cares.js | mgr (편집 hq) | 검색장비 유지관리 — 장비 대장 22대(v2 이관, 내용연수 · CARES 상태) · 고장·수리 이력(처리 단계 · 원인 · 부품 · 사진) · 가동 분석(가동률 · 다운타임 · 원인 분류) |

**예정 (13)** — `planned:true` 메뉴. 같은 module id로 `registerModule` 하면 자동으로 정식 메뉴가 되고, 허브 패널의 "준비 중인 모듈"에서 빠져 위쪽 목록으로 올라간다.

| 허브 | 라우트 · 메뉴명 (vis) |
|---|---|
| 홈 (hub-home) | board 안전보안 현황판 (mgr) |
| 화물 보안 (hub-sec) | kc-ra 상용화주·RA 관리 (hq) · access 보안구역 출입 관리 (mgr) |
| 안전 관리 (hub-saf) | daily-safety 일일 안전점검 (mgr) · risk 위험성 평가 (hq) · incident 사고·아차사고 보고 (mgr) · gse 지상조업(GSE) 안전 (mgr) |
| 점검 · 교육 (hub-aud) | inspection 안전보안 점검 일정 (mgr) · car 시정조치 CAR (hq) · training 안전보안 교육 관리 (mgr) · certs 이수증 관리 (mgr) |
| 협력 · 비상 (hub-ops) | partners 조업사·협력사 현황 (mgr) · contracts 계약서 관리 (hq) |

권장 개발 순서(DESIGN.md §9-6): ① car · inspection · training · certs → ② access · contracts → ③ 안전 관리 4종 → ④ kc-ra · partners → ⑤ board. (scr-status · scr-equip은 v1.12에서 완료)
수검 대응 센터(audit, v1.17)는 새 라우트 — 예정 메뉴 inspection(내부 점검 일정) · car(시정조치)와 별개다. car 를 만들 때는 수검 지적사항(`audits[].findings`)을 끌어오거나 링크하는 방식을 검토할 것.

SeMIS v2에 같은 성격의 모듈이 있으면 이식한다(v2 저장소: Mac `~/SeMIS_v2`, 연결 폴더라 `device_bash`로 바로 읽기 가능).
v2 대응: inspection.js · carcap.js · training.js · certs.js · contracts.js · equipment.js · passes.js 등.

## 5. 데이터 · 백엔드

- **SYNC_KEYS(18)**: menus · notices · schedules · assignees · assigneesSeeded · minutes · minuteFolders · levelHistory · safetyBoard · contacts · gcal · chatRooms · vault · regulations · equipment · crisis · fleet · audits (계정 자료 pwOverrides·userOverrides·customUsers는 v1.15에 서버 전용 표로 이관·삭제)
- SYNC_KEYS 밖 설정 행: `caresCfg`(CARES Firebase 웹 키 — `SemisSync.fetchKV`로만 읽음, 앱이 쓰지 않음)
- 신규 컬렉션 추가 시: `freshData()` 기본값 → `normalizeData()` 보정(멱등) → `sync.js` SYNC_KEYS → 테스트 Y01 기대 문자열 갱신 → **서버 권한표 등록**(아래)
- **서버 보안(v1.15)** — 원본 SQL `tools/sql/semis-logi-security.sql`(1단계) · `tools/sql/semis-logi-lockdown.sql`(2단계 잠금). 실제 적용은 마이그레이션 `semis_logi_security_1~6`(6 = RPC 실행 권한: public `semis_logi_*`는 anon·service_role만, authenticated 차단)
  - **작업증명(v1.16, 마이그레이션 `semis_logi_security_7_pow`, SQL `tools/sql/semis-logi-pow.sql`)**: 로그인 창이 뜨면 `semis_logi_challenge()`(HMAC 서명 {nonce·만료 2분·난이도}, 비밀값은 `semis_logi_private.settings`)를 받아 `js/pow.js` Web Worker가 미리 푼다 → `semis_logi_login(p_pw, p_ua, p_pow)` — 해답 없으면 `pow`, 만료 `pow_expired`, 재사용 `pow_used`(클라이언트가 새 문제로 1회 재시도). 기본 18비트(약 0.2초), 15분 전체 실패 50/150/400 → +2/+4/+6. 6자리 서명 코드는 1시간 실패 200회 초과 시 15분 `sign_paused`. 보안 탭 통계(fail15·fail60·powBits·signPaused). SeMIS v2 v2.53과 같은 파일·방식
  - 로그인: RPC `semis_logi_login(p_pw, p_ua, p_pow)` → 서버가 `bcrypt(sha256('SeMISv2::'+암호))`로 확인 → 세션 토큰 64자(원문은 저장 안 함, sha256만). 같은 IP 15분 20회 실패 → 15분 제한. 6자리 숫자는 회의 서명 코드(회의일 ±90일)
  - 토큰은 이 탭의 `sessionStorage semisl:tok`, 모든 요청에 `x-semis-token` 헤더. 세션 24시간 무활동 만료(10분마다 `semis_logi_whoami`로 확인·연장) · 최대 30일. 서버가 끊으면 로그인 창만 다시 뜨고, 같은 계정이면 미전송분을 이어서 저장
  - RLS: `semis_logi_store`는 정책 "logi session read/insert/update"만 — `rank_now() >= read_rank(key)` / `write_rank(key)`. 권한표 `semis_logi_private.key_acl`(9 = 앱에서 불가). **새 컬렉션은 여기에 (key, 읽기, 쓰기) 등록**(없으면 2/3). SQL 파일에도 같은 줄(테스트 C05가 대조)
  - 서버가 `updated_at`(서버 시각)·`updated_by`(`계정ID/클라이언트ID`)를 찍는다(트리거 `semis_logi_store_a_stamp`). 변경 알림은 트리거 `semis_logi_store_notify` → Broadcast 채널 `semis-logi-sync`(컬렉션 이름만) → 클라이언트가 그 컬렉션만 GET
  - 관리자 RPC: `semis_logi_users` · `semis_logi_user_save(p)` · `semis_logi_user_delete` · `semis_logi_set_password`(다른 접속 끊김) · `semis_logi_history` · `semis_logi_history_value` · `semis_logi_security`(접속 중 · 기록) · `semis_logi_end_sessions`. 회의 서명: `semis_logi_sign_submit`(그 회의 한 건만 수정 — signer 세션은 공용 DB 직접 조회 불가)
  - 계정 표는 SQL(서비스 권한)로만 직접 볼 수 있다: `select id, login_id, role, last_login_at from semis_logi_private.accounts`
- **데이터 사본**: `sessionStorage semisl:data`(탭 단위 — 탭을 닫거나 로그아웃하면 사라짐) · 캐시 주인 `semisl:owner`(다른 계정이 로그인하면 비움) · 읽을 권한이 없는 컬렉션은 로그인 때 기본값으로 비운다. pending 큐 · 강제 push 표시도 sessionStorage. 옛 버전의 `localStorage semisl:data`는 시작할 때 지운다
- **파일(v1.15)**: 버킷 비공개. 저장값은 표준 주소(`…/object/public/semis-logi-files/경로`) 그대로. `js/fileauth.js`(SemisFileAuth)가 화면의 img · iframe · a 등을 서명 URL(1시간)로 바꿔 끼우고(원래 주소는 `data-sf`), 서명 전 링크는 새 창을 먼저 연 뒤 보낸다. 서명·업로드·목록·삭제는 Edge Function `semis-logi-files`(원본 `tools/edge/semis-logi-files.ts`, verify_jwt false — 세션은 `semis_logi_file_auth()`로 확인). 폴더 등급: 열람 notices·attach·minutes·minutes-sign 1 / schedules·contacts·crisis·regs·regs-diff·audits 2 / 그 밖 3, 올리기 minutes·minutes-sign 2(서명 세션은 minutes-sign만) / 나머지 3. 업로드 경로는 함수가 정한다(무작위 접두사). html·js 형식은 거부, 50MB 제한
- **대량 삭제 방어**(sync.js `guardWipe`): 2건 이상 → 0건 push 차단. 정상 전체 삭제는 `SemisSync.confirmWipe(key)`
- **서버 자동 백업**: 트리거가 모든 변경 직전 값을 `public.semis_store_history`에 90일 보관 → 시스템 설정 › 데이터 관리 › 변경 이력에서 복원
- 규정 PDF: `semis-logi-files/regs/` (v1.15부터 비공개 — 서명 URL). 2026-09-20 등록 18건(안전관리 16 · DG 2)
- SeMIS v2와 **데이터 완전 분리** — v2는 `semis_store` · `semis-files`

## 6. 반드시 지킬 규칙

1. **A4 인쇄 버튼**(표시 이름 `Print`): 모든 화면(새 탭으로 여는 외부 링크 제외, 내부 링크 화면은 프레임 내용을 A4 한 장으로 인쇄). `.page-head`/`.ds-head`만 두면 코어가 자동 부착
2. **안내 문구 최소화**: 권한상 자명한 "○○ 전용", 선택지 하나뿐인 입력 안내, 그 단계에서 불필요한 안내는 넣지 않는다. 보안 방식 같은 의미 있는 정보만 한 줄
3. **테스트 통과 후에만 배포**. 브라우저 확인(playwright)은 `addInitScript`로 supabase.co 비-GET 요청을 차단한 상태에서만 (운영 DB 오염 방지)
4. **공개 저장소**: 연락처·명단·암호 평문을 코드에 넣지 않는다. 실데이터는 공용 DB에만
5. 애매한 요구는 질문 후 진행 (AskUserQuestion), 보고는 간결하게
6. 가독성 기준: 본문 17px · 보조 문구 `.81rem` 이상 · 보조 색은 `--text-2`/`--text-3`만
7. **디자인 규칙(v1.8~)**: 새 모듈은 `docs/module-template.js`를 복사해 시작. 화면은 `SeMIS.ui.head/stats/search/empty/chip`, 아이콘은 `SeMIS.icon()`만 사용. 제목·메뉴에 이모지 금지. 메뉴는 반드시 허브(hub-*)에 소속. 390px 모바일 화면까지 확인
8. **비주얼 규칙(v1.9)**: 허브에 속한 화면은 `.page-head`가 자동으로 허브 사진 배너가 된다(`#view[data-hub]`, 사진은 `assets/img/hero-*.webp`). 새 허브를 만들면 홈 사진이 기본 — 전용 사진은 CSS `#view[data-hub="hub-…"]` 한 줄 추가. 입력 폼의 설명 문구는 문단으로 쓰지 말고 `SeMIS.ui.tip(text, label)`(ⓘ 말풍선)로. 일정 색은 12색(`SemisCalendar.COLORS`) — 추가 시 ΔE2000 18 이상·글자 대비 4.5:1 이상 확인
9. **줄바꿈(v1.9.1)**: 본문 전체 `word-break: keep-all`(한글은 어절 단위). 글자 단위로 끊는 `word-break: break-word`는 쓰지 말고 `overflow-wrap: break-word`로. 좁은 칸의 머리글(제목·건수·링크)은 `white-space: nowrap`. 새 화면은 390px에서 가로 넘침이 없는지 확인
11. **검색 입력칸은 다시 만들지 않는다(v1.13.1)**: 입력 이벤트에서 화면(입력칸 포함)을 통째로 다시 그리면 한글 조합이 끊겨 "ㅊㅗㅣ"처럼 자모로 풀린다. `SeMIS.ui.searchValue(v)`(끝의 조합 중 자모 제거)로 검색어를 만들고, 목록은 입력칸 밖 영역만 바꾸거나 `SeMIS.ui.repaintKeep(box, html, input)`(입력칸과 조상 노드는 그대로, 주변만 교체)을 쓴다. 검증: playwright CDP `Input.imeSetComposition`/`insertText`로 조합 입력 후 입력칸 노드 동일성 확인
10. **모달 버튼줄**: 저장·취소처럼 자주 누르는 조작(완료 체크 포함)은 스크롤되는 본문이 아니라 하단 `.modal-actions`에 둔다
12. **서버 보안(v1.15)**: ① 새 컬렉션 → `key_acl` 등록(+SQL 파일) ② 새 파일 폴더 → `tools/edge/semis-logi-files.ts` 등급표 추가 후 재배포 ③ 파일 주소는 표준(public) 주소로 저장하고 화면에 그대로 쓰면 자동 서명된다 — 단, 화면 밖 `new Image()`·`fetch`는 `SemisFileAuth.resolve(url)`, 별도 인쇄 문서(iframe document.write)는 `SemisFileAuth.signHtml(html)`, 편집기 HTML 저장은 `SemisNotice.sanitizeHtml`(서명 흔적 되돌림) ④ CSP(`script-src 'self'` + supabase-js 한 파일): 인라인 `<script>`·`onclick=` 금지, 외부 스크립트 추가 시 index.html CSP 수정 ⑤ 코드·문서에 토큰·해시·명단 금지(테스트 C03·SEC09) ⑥ 브라우저 확인은 로컬(route로 파일 제공) + 공용 DB 비-GET·`semis_logi_sign_submit` 차단 상태에서, 임시 계정은 확인 후 삭제

## 7. 미결 · 주의

- **(v1.15 이전 노출) 암호 해시**: v1.14까지 계정 해시(SHA-256, SALT 공개)가 공개 저장소 git 이력과 누구나 읽을 수 있던 공용 DB(`pwOverrides`)에 있었다 → **네 계정 모두 새 암호로 바꿀 것**(시스템 설정 › 사용자/암호, 8자 이상). 특히 `mark3464`는 SeMIS v2와 같은 암호이고 v2 공용 DB(`semis_store.pwOverrides`)는 아직 누구나 읽을 수 있으므로 **Logistics 전용의 다른 암호**를 권장
- ~~SeMIS v2도 같은 구조적 노출~~ → **2026-09-26 v2.53.0 배포 + 잠금 완료**(서버 세션·비공개 버킷·ICS/AI 토큰 폐지, 상세는 프로젝트 문서 `claude/semis-v2-security-handoff.md`). 이때 공용 이력 트리거 `public.semis_store_snapshot()`이 BEFORE DELETE에서 NEW(NULL)를 돌려 **행 삭제가 조용히 취소되던 문제**(Logistics 공용)를 고침 — 이제 OLD 반환
- v1.15 화면을 열어 둔 탭은 로그인(작업증명 없음)이 거부되므로 새로고침 필요(v1.16)
- Edge Function `semis-logi-ai`(AI 요약, 원본 `tools/edge/semis-logi-ai.ts`): 2026-09-25 고정 토큰 → 로그인 세션 확인(계정 세션 · manager 이상)으로 교체. 호출하는 화면은 아직 없음 — 붙일 때 `x-semis-token` 헤더로 `{ task:"summary", title, text }` 전송(ANTHROPIC_API_KEY는 v2 `semi-chat`과 공유)
- 운영 확인용 임시 계정(`zz-t-*`)과 그 접속 기록은 2026-09-25 확인 후 삭제 — 보안 탭의 접속 기록은 그 이후 것만 실제. v1.14 화면을 열어 둔 탭은 저장이 거부되므로 새로고침 후 로그인해야 한다
- CARES Firestore(equipments · repairLogs · inspectionLogs · sensorLogs · sensorThresholds) 공개 읽기 규칙은 CARES 쪽 설정 — Logistics는 읽기만 한다
- 커스텀 도메인 미설정 (추후 `logistics.semis.pe.kr` CNAME 가능)
- CARES Mobile 배포 주소 링크 미등록
- 연락망 이관(2026-09-22): SeMIS v2 `semis_store.contacts`에서 안전보안실 28 · 국토부 항공보안정책과 8 · 서울지방항공청 보안과 16 · 비상안전기획관실 3 · 대테러센터·국가위기관리센터 4 · 서면보고 이메일 10을 복사(두 시스템은 이후 따로 관리). 이관 직전 값은 `semis_store_history` id 112. 서면보고 섹션의 v2 비고("지점 내 별도 유지…")는 지점 기준 문구라 옮기지 않음
- 인천화물팀 안전보안파트 · 인천화물팀 · 인천공항공사 섹션은 아직 비어 있음(v2에 대응 자료 없음). 체계도 3종의 연락처는 `contacts.flows`에 따로 있음
- **보고 체계도(v1.10)**: 데이터 `contacts.flows[]` = { id, title, short(탭 이름), ver, steps(한 줄에 한 단계), memo, fileUrl, imgUrl, thumbUrl, rows[{grp, role, office, mobile, note}] }. 파일은 `semis-logi-files/contacts/flow-{sec|saf|dg}-2609.{pdf,webp}`(+`-thumb.webp` 640px, 원본 1800px). 반영 직전 값은 `semis_store_history` id 116. 개정판이 오면 화면의 ✎ 편집에서 PDF·이미지만 바꾸면 됨(PDF만 새로 올리면 옛 이미지는 자동으로 떼어 PDF 뷰어로 표시)
- 체계도 원문 차이: AAP탑재 번호가 안전사고 체계도는 744-5470, 위험물 체계도는 270-5470 — 원문대로 각각 입력. 원문의 7자리 번호는 032 지역번호를 붙여 저장, 해외 번호(TSOC·IIR in SIN)는 +1·+65 국제 형식
- **링크 묶음(v1.12.2)**: 링크 메뉴에 `open:"group"` 을 주면 묶음, 하위 링크는 `parent` 가 그 링크의 id. 허브를 늘리지 않으려고 링크 안에 한 단계만 둔 구조라 `hubOf` 가 허브가 아닌 값을 돌려준다 — 허브 목록(`hubEntries`)·레일에서 자동으로 빠지고, 빵부스러기·레일 강조는 `hubOfDeep` 로 상위를 따라 올라간다. 라우트 `#/links/<id>`. 사내망(10.31.61.163) 주소는 https 화면에서 iframe 이 막히므로 하위 링크는 새 탭 방식으로 등록했다. SCAN 하위 4건(파트별 박스)은 사람 이름이라 공개 저장소 코드에 넣지 않고 공용 DB `semis_logi_store.menus` 에만 등록
- **위기대응 담당자(v1.13)**: 데이터 `crisis` = { title, asOf(원문 그대로 "26년 9월"), homeTeam(기본 인천화물팀), notes[], fileUrl, fileName, updatedAt, rows[{ id, div(본부=시트 이름), team, org, task, main, sub }] } — 명단은 공용 DB에만(2026-09-23 SQL로 96행 등록, updated_by `crisis-import`), 원본 엑셀은 `semis-logi-files/crisis/`. 엑셀 읽기는 외부 라이브러리 없이 ZIP(DecompressionStream deflate-raw) + XML을 직접 읽는다: 머리글('팀 · 위기대응 업무 · 담당자(정) · 담당자(부)')을 찾아 그 아래를 `<End>`까지 읽고, 병합 셀은 값을 채우고, '전체' 시트는 합본·나머지 시트 이름은 본부로 쓰며, 합본에 없는 행(2026년 명단의 종합통제팀 5행)은 본부 시트에서 덧붙인다. '주)' 아래 줄은 참고 사항(번호로 시작하면 새 항목). 가로 병합으로 정=부가 같으면 부를 비움. "아래 주) 참조" 같은 비(非)이름 값은 사람 색인에서 빠지고 참고로 이동하는 버튼으로 표시. 반영 전 대조(담당자 변경 · 새 임무 · 빠지는 임무, 키 = 팀|조직|업무). 메뉴는 기존 메뉴 데이터에 없으면 `normalizeData`가 비상연락망 바로 아래에 추가(이후 숨김·이름은 운영자 설정 유지). 비상연락망 머리말에 '위기대응 담당자' 버튼. 통합 검색 항목에 `pick`(이동 전 화면 상태 지정) 지원 추가(search.js `goItem`)
- 비상연락망 검색줄(`.ct-searchwrap`)의 sticky 위치가 머리글 아래로 숨던 문제를 `top: var(--header-h)`로 함께 고침
- **목록 필터 잔존 버그(v1.12.3)**: 규정·장비 대장·연락망의 검색어/필터는 모듈 메모리(`let query`)에 있어 화면을 옮겨도 유지되고 새로고침해야 초기화된다. 검색어를 켠 채 새 항목을 등록하면 목록에서 걸러져 "등록했는데 사라졌다(새로고침하면 보임)"로 보였다. → 저장한 항목이 현재 조건에 안 걸리면 조건을 자동 해제하고 토스트로 알린다(규정·장비: 조건 판정 후 해제, 연락망: 검색어 해제). 규정 화면은 검색 중 '검색 결과 N / 전체 M · 검색 해제'를 항상 표시. 새 목록 화면을 만들 때 같은 함정을 주의할 것(vault는 화면을 나가면 잠기며 query가 초기화되어 해당 없음)
- **pull 경합 방어(v1.12.3)**: `pull()`이 GET 이전의 pending+dirty 를 기억한다. GET 이 도는 동안 push 가 끝나 pending 이 비면 아직 서버에 없는 로컬 변경을 서버 옛 값으로 덮어쓸 수 있었다(같은 증상: 저장한 게 사라졌다가 새로고침하면 보임). 이제 dirty 키는 덮지 않고 id 기준 병합 후 재push
- **첨부 뷰어(v1.12.1)**: `js/files.js` 가 문서 전체에서 `a.nb-file` · `.nb-file > a` · 본문 이미지(.nb-editor/.notice-html/.ag-memo/.cn-rich) 클릭을 가로채 `<dialog id="fv-viewer">` 로 연다. 저장소 경로는 한글이 `_` 로 바뀌어 있어 이름은 칩 글자(또는 img alt)에서 얻는다. 규정 모듈의 PDF 뷰어는 자체 모달을 그대로 쓴다(변경 없음). DOCX·HWP 등은 미리보기 불가 — 외부 문서 뷰어(Microsoft/Google)로 보내면 내부 문서 주소가 외부로 나가므로 쓰지 않았다
- **CARES 연동(v1.12)**: `js/cares.js` 한 곳에서 Firestore REST로 **읽기만**(equipments · repairLogs · inspectionLogs · sensorLogs · sensorThresholds — 공개 읽기 규칙). deployLogs · locationStates는 로그인 전용이라 안 씀 → 배치는 `equipments.location`("X-ray n호기" · "환적화물" · "예비"). repairLogs 사진이 data URL이라 목록은 `select` 투영(2.3MB→80KB), 사진은 상세에서 1건만. 읽기량을 줄이려고 세 묶음으로 캐시 — live(장비·센서 12건·오늘 점검, 60초) · repairs(고장·임계치, 10분) · history(45일 점검·정기점검, 15분 — 보안검색 현황·검색장비 화면에 들어올 때만). 자동 새로고침은 5분마다 live만(보안검색 현황·대시보드를 보고 있고 탭이 보일 때). 대시보드는 history를 읽지 않는다. CARES Firebase 요금제(무료 한도 여부)는 확인하지 못했음 — 읽기량이 문제되면 자동 새로고침 주기(screening.js DASH_PARTS 타이머)부터 늘릴 것. 키: 공용 DB `caresCfg` → `localStorage semisl:caresKey`(400/403이면 삭제 후 재조회). CARES 쪽 컬렉션 규칙이 바뀌어 403이 나면 화면은 "CARES 연동 불가"와 재시도 버튼, 대장은 그대로 표시
- 대장 이관(2026-09-22): SeMIS v2 `semis_store.equipment` 22대(X-ray 3 · ETD 5 · WTMD 4 · HHMD 10, 모두 인천 화물터미널 B동)를 `semis_logi_store.equipment`로 복사(이후 따로 관리). 유지보수 계약 · 비용 · 대금 청구(`equipMaint` · `billing`)는 옮기지 않음 — v2 항공보안파트 업무
- 2026-09-22 CARES 실데이터에서 확인한 점(화면에 그대로 드러남): X-ray 일일점검이 3일에 한 번 기록 없음(09-15 · 18 · 21 — ETD만 점검, 이행 64%) · 주간 점검 최근 기록 08-27(26일 경과) · X-ray 월간 점검 최근 07-30 · ETD 보호케이스 CO₂(2,000ppm↑)·TVOC(1mg/㎥↑), 입구 HCHO(0.1↑) 기준 초과
- 화물 보안검색 '실적'(X-ray·ETD·개봉검색 건수 · 미검색 사유)은 CARES·v2 어디에도 데이터가 없어 넣지 않았다 — 현장 실적 서식을 받으면 scr-status에 입력 탭으로 추가
- **개정 PDF 반자동 반영(v1.11)**: 체계도 ✎ 편집 → PDF 올리기 → `js/flowpdf.js`가 pdf.js(`assets/vendor/pdfjs/`, 4.10.38 legacy, Apache-2.0, 필요할 때만 불러옴)로 1쪽 글자·위치를 읽어 번호·라벨을 뽑고 등록 행과 대조(그대로 · 바뀜[이름/위치] · 빈 칸 채움 · 새 번호[구분 추정] · PDF에 없음) + 1쪽을 WebP 1800/640px로 만들어 자동 업로드. 사용자가 고른 항목만 행에 반영(강조 표시) → 저장. 대조 키는 번호 숫자 끝 7자리 이상 일치(032 생략 표기 대응). 이름(기관명) 변경은 감지하지 않음 — 번호 기준. 스캔 PDF(글자 없음)는 안내만. 실PDF 3종 재업로드 시 오탐 0 확인
- `normalizeData`는 `contacts.flows`를 만들지 않는다(구버전 데이터에 빈 배열을 넣으면 동기화 push가 생김) — contacts.js가 없으면 빈 목록으로 읽음
- 3D 장면: GPU 없는 PC(소프트웨어 렌더링)·느린 PC(평균 45ms/프레임 초과)·동작 줄이기 설정에서는 정지 화면, WebGL 없으면 사진. 사진이 보이면 대시보드에서 `document.querySelector('#dash-3d').dataset.h3d`로 사유 확인(no-webgl · webgl-context · load · live · static)
- 2026-09-22 v1.9.0 배포 직후 Mark의 Chrome에서 3D 대신 사진이 보였음 — 같은 Mac의 내장 브라우저에서는 3D 정상(Apple M4 Pro, Metal). 배포 전 요청한 three.js 404가 CDN에 남은 것으로 추정해 v1.9.1에서 주소에 버전을 붙임. 재발 시 위 사유 값과 chrome://gpu의 WebGL 항목 확인

- **수검 대응 센터(v1.17, M1)** — Mark 결정(2026-09-26): 제안안(수검 등록 → 규정 조항별 준비 체크리스트 · 증빙 → 수검 기록 → 지적 조치 추적 → 과거 지적 이력 · 재발 · A4 인쇄 · 대시보드 D-day), 대상은 국토부 · 지방항공청 / 해외 당국 · 화주 / 사내 심사(공항공사 제외)
  - 데이터 `audits[]` = { id, body(gov|foreign|internal), org, kind, start, end, place, lead, scope, memo, outcome(""|"none"), cancelled, linkCal, noCalMain, files[], checklist[{id,text,ref,owner,note,done,doneAt,doneBy,files[]}], findings[{id,type(car|rec|onsite|obs),ref,text,action,owner,due,status(open|doing|done),doneDate,noCal,files[]}], createdAt/By, updatedAt/By }. 진행 단계는 저장하지 않고 계산(준비 → 수검 중 → 결과 대기 → 조치 중 → 종결 / 취소). 결과 대기 = 수검이 끝났는데 지적도 '지적 없음' 확정도 없는 상태
  - 권한표 `audits` 2/3(마이그레이션 `semis_logi_security_8_audits`) · 파일 폴더 `audits/` 열람 2 · 올리기 3(Edge Function `semis-logi-files` v2 재배포). 첨부는 저장소에서 지워지지 않는다(시스템 설정 › 저장소에서 미참조 파일 정리)
  - 일정관리 연동: 수검 기간 `aud_<id>`(보라 · 1주/1일 전 알림) · 지적 기한 `audf_<id>`(주황 · 완료 연동), src `aud:<id>`. `calendar.js` 의 연동 일정 표 `LINKED`(insp_ · aud_ · audf_) 로 옮기기 · 기간 조정 · 완료 · 자동 연기가 원본에 되반영. 일정관리에서 지우면 그 일정만 연동 해제(`noCalMain` / 지적 `noCal`). 수검 폼의 '일정관리에 표시'를 다시 켜면 복구. 저장할 때만 일정을 맞춘다(정규화에서 건드리지 않음 — 접속마다 저장 반복 방지)
  - 기본 준비 항목(구분별 6~10개)은 코드 `TEMPLATES` — 조항 번호는 넣지 않았다(규정 개정 때마다 틀어지므로 항목에서 직접 입력). 조항 입력칸은 지금까지 쓴 조항을 자동 완성으로 보여 준다
  - 이번에 함께 고친 것: 회의록 조치 일정 동기화가 일정관리 자동 연기로 밀린 날짜를 되돌려 **접속할 때마다 schedules 저장이 반복**될 수 있던 문제(SeMIS v2.53에서 같은 문제 수정 — minutes.js syncDecisions)
- **운항 현황(v1.14)** — 스케줄 파일은 쓰지 않는다(Mark 결정 2026-09-25: 스케줄이 매달 바뀌어 손으로 최신화하기 어려움 → 등록 기체 15대의 실시간 입출항만 감시). 관리 항목은 기체 목록(공용 DB `fleet`, 비면 코드 기본 15대)뿐.
  - 데이터 흐름: pg_cron `semis-logi-adsb`(2분) → Edge Function `semis-logi-adsb`(verify_jwt, anon 키) → adsb.lol `/v2/hex/<15개>` 1회 → `semis_logi_adsb`(기체별 마지막 상태 · 비행 경로 20시간 · 4분 간격) 갱신 + 지상↔공중 전환을 `semis_logi_adsb_events`(dep/arr · 공항 · 시각 · 추정 여부, 45일 보관)에 기록. 화면이 부르면 50초 안의 값은 그대로(_meta 행 잠금). 함수 원본 `tools/edge/semis-logi-adsb.ts`(바꾸면 MCP deploy_edge_function으로 재배포)
  - 판정(js/flightcore.js `status`): 비상(7500·7600·7700) · 인천 접근 중(250km 안 · 인천 쪽 ±60° · 강하 -300ft/분 이하 또는 15,000ft 이하, 상승 제외) · 비행 중 · 지상(공항 반경 15km) · 착륙 추정(공항 15km · 3,000ft 이하에서 끊김) · 신호 없음(순항 10,000ft 이상에서 끊겼으면 마지막 방위·속도로 3시간까지 직진 추정 표시) · 수신 기록 없음. 4분 넘게 안 잡히면 신호 없음
  - 입출항 감지(서버): 공중 확정 = 800ft 이상 또는 150kt 이상(활주 중 흔들림 제외). 착륙·이륙 시각은 직전 수신이 20분 안일 때만 그대로, 아니면 '시각 추정'. 공항 근처 3,000ft 이하에서 10분 넘게 끊기면 착륙으로 기록(지상에서 트랜스폰더를 끄는 경우). 같은 기체·종류·공항 15분 안 중복은 건너뜀
  - 공항 목록 103곳(취항지 + 대체·경유 화물 공항): `js/flightcore.js AIRPORTS` 와 Edge Function `APTS` 가 같아야 함 — 공항을 늘리면 둘 다 고치고 재배포
  - 한계: ADS-B 지상 수신기 기반이라 태평양·시베리아 등 대양·오지 구간은 몇 시간씩 끊김(직진 추정으로 보완). adsb.lol 은 무료·무보증(ODbL, 출처 표시 — 지도 오른쪽 아래). 실사용 통지를 권장하므로 필요 시 adsb.lol 에 연락. 첫날(2026-09-25)은 대부분 기체가 '수신 기록 없음'으로 시작해 운항하면서 채워진다
  - 지도: Leaflet 1.9.4 로컬(`assets/vendor/leaflet`, BSD-2) · OpenStreetMap 타일(무료 · 출처 표시 · 소량 사용 조건) 채도 뺀 필터. 태평양 중심(미주 경도 +360). 대시보드 지도는 휠 확대 끔(스크롤 방해), 운항 현황 지도는 켬
  - 기체 등록부호 → ICAO 주소: HL7Nyy → 71B(8+N)yy, HL8xyz → 71Cxyz (tar1090-db로 15대 확인). 기체 목록 편집에서 자동 채움
  - 대시보드 순서: 태그 카드 → 화물 보안검색 띠(mgr) → 운항 현황. 메뉴를 숨기면 대시보드 칸도 빠짐

## 8. 작업 기록

| 버전 | 날짜 | 내용 |
|---|---|---|
| v1.0.x | 09-14 | 사이트 구축 · 배포, 관리자 암호(v2 운영 해시) 반영 |
| v1.1.0 | 09-17 | 일정 담당자 관리(시스템 설정), A4 인쇄 버튼 전 화면 |
| v1.2.0 | 09-17 | 담당자 다중 선택, 구글캘린더 설정 이관, 가독성 개선 |
| v1.3.0 | 09-17 | 일정 유실 사고 대응 — 대량 삭제 방어 · 서버 변경 이력 · 복원 UI (7건 재구성 복구) |
| v1.4.0 | 09-20 | 메뉴 숨기기 (권한과 별개) |
| v1.5.0 | 09-20 | 암호 관리 (v2 vault 이식, 해제 UI 개편, 제목 정렬) |
| v1.6.0 | 09-20 | 규정 관리 3종 (v2 regulations 이식) · 문서 18건 등록 · 안내 문구 정리 |
| v1.7.0 | 09-21 | 암호 관리 공용/개인용 구분 (개인용 = 멤버별 개인 키 암호화). SeMIS v2도 v2.52.0으로 동일 적용 |
| v1.8.0 | 09-21 | 디자인 개편 Terminal Calm — 6개 허브(아이콘 줄 + 허브 패널), 모바일 하단 탭 · 메뉴 시트, Ctrl K 검색 팔레트, 대시보드 개편, 모듈 화면 키트(SeMIS.ui · icon · navBadge), v1.7 메뉴 자동 이전, docs/module-template.js |
| v1.9.0 | 09-22 | 로그인 실사 사진 · 대시보드 3D 장면(Three.js r170 로컬, 화물기 ULD 탑재 애니메이션) · 허브 화면 사진 배너 6종 · 일정 등록 폼 2단 재구성(설명은 ⓘ 말풍선, 일정명 예시 'OO회의') · 일정 색 15→12색(파랑=청록 중복 해소, 최소 ΔE 18.8) · SeMIS v2 연락망 이관 · Impeccable 스킬 적용 |
| v1.10.0 | 09-22 | 비상연락망 보고 체계도 — 사고 유형별 탭(보안·안전·위험물), 체계도 미리보기 → 전체 화면 뷰어(`<dialog>` · 누른 지점 확대 · ←/→ · Esc · 휴대폰 뒤로 = 닫기), 보고 순서 줄 · 구분별 원터치 연락처 67행 · 조치 사항, hq 편집(PDF·이미지 올리기) · 통합 검색 포함 · 인쇄 시 3종 모두 펼침. 전화 링크: `~` 범위·`+` 국제번호 처리 |
| v1.10.1 | 09-22 | 대시보드 3D를 에어제타 B747-400F로 교체 — 흰 동체 · AIRZETA 글자(남색) · 파란 꼬리·후방 동체 · 꼬리 로고 · 빨간 윙렛 · 2층 혹(-400F 단축형) · 엔진 4기 · 기수 화물문을 들어 올리고 로더가 컨테이너/팔레트를 번갈아 탑재 · 테이퍼 날개(로프트) · 화면 비율별 자동 거리(fitDist) |
| v1.10.2 | 09-22 | 3D 보완 — 들어 올린 기수를 사진 비례로 축소(길이 ≈ 동체 지름 0.85배) · 기수 아래 옆면에 회사 로고(빨강·파랑, 들어 올린 상태에서 똑바로) · 꼬리 로고를 제공 로고 윤곽 그대로(빨강·흰색) · 화물을 기수 탑재에 맞는 긴 화물(8.5m 목재 상자 / 회전날개 뗀 헬기)로 교체, 20ft 돌리 |
| v1.10.3 | 09-22 | 기수 로고를 들어 올린 화물문에서 빼 문 경계 뒤 고정 동체 아래쪽(앞바퀴 위)으로 · 인쇄 버튼 'A4 인쇄' → 'Print' · 내부 링크 화면의 iframe 차단 안내 문구 삭제 · 내부 링크 화면 인쇄 시 빈 장 대신 프레임 내용(A4 한 장) |
| v1.11.0 | 09-22 | 보고 체계도 개정 PDF 반자동 반영 — PDF 올리면 번호·이름 읽기(pdf.js, 로컬 legacy 빌드) → 등록 연락처와 대조 목록(바뀜·새 번호·PDF에 없음·버전) → 고른 항목만 반영(행 강조) · 미리보기 이미지(1800/640 WebP) 자동 생성 · 새 체계도는 PDF만으로 연락처 일괄 입력(같은 이름 휴대전화는 한 행으로) · 해외 번호 +1/+국가번호 보정 |
| v1.11.1 | 09-22 | 개정 PDF 미리보기 이미지 렌더를 intent "print"로 — 창이 가려진 상태에서 멈추던 문제(requestAnimationFrame 정지) 해소, 20초 안전장치(넘으면 이미지 없이 번호 대조만) |
| v1.12.0 | 09-22 | 화물 보안 허브 — **화물 보안검색 현황**(scr-status: 검색 라인 배치 · 오늘 일일점검 · 28일 점검 이행 + 주간·월간 경과 · 센서 3곳 × 지표 표 + 결로 교차 판정 · 최근 고장) · **검색장비 유지관리**(scr-equip: v2 equipment.js 이식 — 대장 22대 이관 · 내용연수 · CARES 상태 · 고장·수리 이력/상세(단계 · 원인 · 부품 · 사진) · 가동 분석(정상 가동일 ÷ 기간, ETD 목표 90%, 원인 분류)) · 대시보드 요약 띠(검색 라인 미니 배치도 · 오늘 점검 · 6개월 고장 막대 · 검색 환경) · CARES 연동 계층 js/cares.js(읽기 전용) · 인쇄 규칙(A4 2쪽) · 모바일 행 카드 |
| v1.12.1 | 09-23 | **첨부 뷰어**(js/files.js) — 공지·일정 메모·회의록의 파일 칩(.nb-file)과 본문 이미지를 누르면 열린다. 사진·PDF는 그 자리 미리보기, 그 밖은 형식 안내 + 다운로드/새 탭. 편집 중인 메모에서도 눌러 열리고(그동안은 contenteditable 안이라 링크가 먹지 않았음) 뷰어에서 바로 첨부를 뺄 수 있다. 같은 글의 첨부는 ←/→ 로 이동. 내려받기는 올릴 때 이름 그대로(Supabase `?download=`), `<dialog>`라 모달 위에 겹치고 Esc는 뷰어만 닫는다 |
| v1.12.2 | 09-23 | **링크 묶음** — 바로가기 하나(홈 'SCAN 폴더')에 하위 링크를 달아, 메뉴는 한 줄로 두고 누르면 카드 화면(`#/links/<id>`)이 열린다. 카드별 열기 방식(새 탭·내부 화면·중첩 묶음) · 사내망 표시 · 묶음 자체 주소는 '전체 열기' · 내부 화면에서 묶음으로 복귀 · 설정에서 3단 트리와 '소속' 선택 · 정합성 자동 보정(하위 있는 링크는 묶음 승격, 상위 잃은 링크는 소속 해제). SCAN 하위 파트별 박스 4건 등록 |
| v1.12.3 | 09-23 | **목록 필터 잔존 버그 수정** — 규정 자료에서 검색어를 켠 채 새 규정을 등록하면 목록에서 걸러져 보이지 않던 문제. 저장한 항목이 현재 검색·필터에 안 걸리면 조건을 자동 해제하고 알린다(규정·검색장비 대장·비상연락망). 규정 화면은 검색 중 '검색 결과 N / 전체 M · 검색 해제' 표시, 빈 결과도 검색 때문임을 안내. 더불어 `pull()` 경합 방어(push 중 도착한 옛 서버 값이 로컬 변경을 덮지 않게) |
| v1.13.0 | 09-23 | **위기대응 담당자** — 2026년 에어제타 위기대응 담당자 명단(엑셀 7개 시트)을 별도 화면으로. 우리 팀 임무 띠(짙은 판, 정·부 · 전화) · 요약(조직 11 · 팀 27 · 임무 96 · 담당자 78) · 조직 줄(색 점 · 건수, 누르면 필터) · 검색(이름 · 팀 · 업무, 강조) · 보기 4종: 조직별(팀 묶음 표) · 팀별(본부 묶음) · 담당자별(이름 누르면 이동, 정/부 배지) · 매트릭스(팀 × 조직 건수, 칸 누르면 조직별 필터) · 참고(OCC 번호 원터치) · hq 엑셀 반영(대조 후) · 행 편집 · 기본 정보 · 원본 내려받기 · 모바일 행 카드 · 인쇄 |
| v1.13.1 | 09-23 | **검색칸 한글 입력 깨짐 수정** — 위기대응 담당자 · 검색장비 유지관리(장비 대장 · 고장 이력) 검색칸에서 한글을 치면 글자마다 화면을 새로 그리며 입력칸이 바뀌어 "ㅊㅗㅣㅅㅏㅇ"처럼 자모로 풀리던 문제. 입력칸은 유지하고 나머지만 다시 그림(`ui.repaintKeep`), 조합 중 자모는 검색어에서 제외(`ui.searchValue`). 비상연락망 · 규정 · 암호 관리 · 회의록은 원래 입력칸 밖만 다시 그려 해당 없음(조합 입력 시험으로 확인). 모듈 템플릿도 같은 방식으로 수정 |
| v1.14.0 | 09-25 | **운항 현황** — 에어제타 화물기 15대 ADS-B 실시간 위치(adsb.lol 무료 · Supabase Edge Function 중계 · pg_cron 2분 기록). 대시보드 지도(기체만) + 인천 접근 중 목록 + 최근 인천 도착 · 메뉴 '운항 현황'(홈 허브, 전체 공개): 요약 · 지도(비행 경로 · 신호 없음 직진 추정 · 이름표 겹침 정리) · 인천 입항/출항 · 기체 현황 · 입출항 기록 48시간 · 비상 부호 경고 · 기체 목록 편집(hq, ICAO 자동 채움). 스케줄 파일 미사용(매달 바뀌어 유지 곤란) |
| v1.15.0 | 09-25 | **서버 보안** — 공개 키만으로 공용 DB·파일 전부를 읽고 고칠 수 있던 구조를 닫음. 서버 로그인(RPC · bcrypt · IP별 시도 제한) → 탭 세션 토큰 · 권한표(key_acl) 기반 RLS(권한 밖 컬렉션은 받지도 못함) · 계정·세션·접속 기록 비공개 스키마 · 파일 버킷 비공개 + Edge Function 서명 URL(js/fileauth.js 자동 변환) · 회의 서명은 그 회의 한 건만(RPC) · 데이터 사본 localStorage → sessionStorage · 변경 알림 Broadcast(이름만) · 서버 시각·작성자 기록 · 설정에 보안 탭(접속 중 · 기록 · 모두 끊기) · CSP · 살균기 template 파싱 · v2 ICS 토큰 제거 · 후속: RPC 실행 권한 정리(anon만) · AI 요약 함수 세션 확인 · 임시 계정·기록 정리 |
| v1.16.0 | 09-26 | **로그인 자동공격 방어** — reCAPTCHA 대신 보이지 않는 작업증명: 서버 서명 문제(2분 · 1회용)를 로그인 창에서 Web Worker가 미리 풀어 첨부(js/pow.js, v2와 같은 파일) · 전체 실패가 늘면 난이도 자동 상향 · 6자리 회의 서명 코드 실패 급증 시 15분 중지 · 보안 탭 실패 통계 · 로그인 안내 문구(제한 · 중지 · 확인 실패) · CSP worker-src · 라이브 확인(해답 없는 로그인 거부, 로그인 1.6초) 후 임시 계정·기록 삭제 |
| v1.17.0 | 09-26 | **수검 대응 센터**(M1) — 국토부 · 지방항공청 / 해외 당국 · 화주 / 사내 심사 수검을 준비 → 수검 → 지적 조치 → 종결로 관리. 수검 일정 · 지적사항 탭, 상세(준비 체크리스트 · 증빙 파일 · 지적사항), 재발 조항 표시, 일정관리 양방향 연동, 대시보드 띠 · 메뉴 배지 · 통합 검색 · 390px · A4 인쇄. 서버: 권한표 audits 2/3 · 파일 폴더 audits. 회의록 조치 일정 자동 연기 되돌림 수정 |
| v1.9.1 | 09-22 | 한글 어절 단위 줄바꿈(전역 keep-all) · 대시보드 하단 시트 칸 수를 시트 폭으로 결정(container query, 1040px↑ 4칸) · 일정 폼 '완료'를 하단 버튼줄로(스크롤 없이 보임) · 오른쪽 설정 패널 압축(1512×825에서 스크롤 없음) · 3D 불러오기 주소에 버전 부여(배포 직후 옛 404 캐시 회피)·실패 사유 기록(`#dash-3d[data-h3d]`) |
