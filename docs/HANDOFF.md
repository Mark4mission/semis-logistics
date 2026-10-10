# ARGOS — 세션 인계서

> ARGOS(Air-cargo Risk & Guard Operations System) = 에어제타 인천화물팀 안전보안 종합정보 플랫폼(구 SeMIS · Logistics, v1.46 에서 이름 변경 — 저장소 · 주소 · DB 이름은 그대로).
> 새 세션은 이 문서부터 읽는다. 작업이 끝날 때마다 §1 · §4 · §7 · §8 을 갱신하고, 끝난 일의 자세한 경위는 `docs/HISTORY.md` 로 옮긴다.

## 1. 현황

| 항목 | 값 |
|---|---|
| 현재 버전 | **v1.49.0** (2026-10-10) — **아르고 AI 도우미**(지원 카드 · 공통 패널 · 도구 12종 · 바로 실행 + 결과 카드 + 되돌리기 · 첨부 · 하루 200회). 앞 버전 v1.48 = 디자인 '화물 태그' · 지원 카드 · 공통 패널 · 부엉이 |
| 접속 주소 | https://mark4mission.github.io/semis-logistics/ |
| 저장소 | GitHub `Mark4mission/semis-logistics` (공개) · Mac `~/SeMIS_Logistics` |
| 테스트 | `npm test` 553건 전부 통과(v1.49.0) · Edge `deno test --allow-net --allow-env tools/edge/semis-logi-argo.test.ts` 6건 · SQL PGlite `tools/sql/semis-logi-argo.test.mjs` 19건 |
| 백엔드 | Supabase `mzyuzrxkdcpzxojenwat` — 테이블 `semis_logi_store`(세션 RLS), **비공개** 버킷 `semis-logi-files`, 비공개 스키마 `semis_logi_private`(계정 · 세션 · 로그인 시도 · 접속 기록 · 권한표), RPC `semis_logi_*`, Edge Function `semis-logi-files`(서명 URL · 이수증 판독 · 데스크 판독 · 사본, v11) · `semis-logi-ai`(AI 요약) · `semis-logi-favicon` · `semis-logi-adsb`(운항, pg_cron 2분) · **`semis-logi-argo`(아르고, v2)** |

## 2. 새 세션 시작

Mark가 새 세션 첫 메시지로 붙여넣는 문구:

```
ARGOS(구 SeMIS · Logistics) 작업을 이어서 한다.
GitHub Mark4mission/semis-logistics 의 docs/HANDOFF.md 를 먼저 읽고 현황을 파악한 뒤,
이번에는 [모듈명 / 작업 내용] 을 진행해줘.
```

Claude가 할 일(순서대로):

1. `git clone --depth 1 https://github.com/Mark4mission/semis-logistics.git /home/claude/logi` (컨테이너에서 clone 가능 — push는 불가)
2. `cd /home/claude/logi && npm install && npm test` — 기준선 통과 확인
3. 이 문서 §4 · §6 · §7 확인 후 작업 시작(지난 경위는 `docs/HISTORY.md` 를 grep)
4. 화면 확인 하네스(v1.48 세션에서 씀 — 저장소 밖 스크래치, 필요하면 다시 만든다): playwright 가 저장소 파일을 `http://logi.local/` 로 내주고 supabase 는 whoami · GET 만 가짜 응답(저장 POST 는 서버로 보내지 않고 성공처럼 답함 · 함수 호출 403), 로그인은 `sessionStorage semisl:tok` + 가짜 whoami. 운영 메뉴 구조는 SQL 로 이름 · 순서 · 숨김만 뽑아 가짜 자료에 넣는다(임시 세션으로 운영 자료 전체를 읽는 방식은 2026-10-10 권한 정책에 막힘)
5. 디자인 작업이면 Impeccable 스킬을 세션에 설치: `git clone --depth 1 https://github.com/pbakaus/impeccable.git /tmp/imp && mkdir -p ~/.claude/skills && cp -r /tmp/imp/.claude/skills/impeccable ~/.claude/skills/` → `~/.claude/skills/impeccable/scripts/impeccable context` (PRODUCT.md 없음 — 좁은 개선은 그대로 진행 가능)

## 3. 배포 절차 (컨테이너 → Mac → GitHub Pages)

컨테이너에는 GitHub 쓰기 권한이 없으므로 **Mac을 거쳐 push**한다. 같은 저장소를 다른 세션이 동시에 고칠 수 있으므로
(2026-09-22~) **tar 덮어쓰기 대신 패치**로 옮긴다.

1. 컨테이너: 작업 전후로 `git fetch && git rebase origin/main`(최신 위에서 작업) → `npm run bump <ver>`(v1.39~ edu.html 스탬프도) → `package.json`·`package-lock.json` version 맞춤 → `npm test` 전부 통과
2. 컨테이너에서 커밋(작성자 Mark) → `git format-patch --binary origin/main -o /mnt/user-data/outputs/logi-patch-v<ver>/`
3. `SendUserFile` → `device_commit_files`로 `~/SeMIS_v2/_logi_transfer/`에 놓기 (SeMIS_v2가 연결 폴더)
4. `Control_your_Mac__osascript`:
   `do shell script "cd ~/SeMIS_Logistics && git pull --ff-only && git am -3 ~/SeMIS_v2/_logi_transfer/<patch> && git push"`
   → 컨테이너 커밋의 tree 해시와 Mac `git rev-parse HEAD^{tree}` 대조
   (Cowork VM의 `device_bash`에서는 git 인증이 없어 push 실패 — 반드시 osascript)
5. 약 80초 후 내장 브라우저(Claude_Browser)로 `index.html`의 `app.js?v=` 스탬프 확인
   (2026-09-25 확인: 컨테이너 playwright로도 github.io 접속 가능 — supabase.co 비-GET 차단 상태에서만)

**Claude Code(웹) 세션(2026-09-30 v1.28~)**: 저장소가 세션에 연결되어 있으면 지정 브랜치(`claude/…`)에 커밋 · push → draft PR → Mark가 main 에 병합하면 GitHub Pages 배포(위 Mac 경로 불필요). 이 컨테이너는 프록시가 `*.supabase.co` 를 막아(firestore.googleapis.com · pypi · npm 은 됨) 공용 DB 작업은 **Supabase MCP**(execute_sql · apply_migration)로 한다. 브라우저 확인: playwright 의 `page.route` 로 저장소 파일을 직접 내주고(`http://logi.local/…`, 로컬 http 서버는 프록시를 타서 405) supabase.co 는 whoami · GET 만 가짜 응답 · 나머지 차단, 크롬은 `proxy: { server: $HTTPS_PROXY }` + `ignoreHTTPSErrors`(CARES 실데이터 읽기용), 로그인은 `SeMIS.devSession(payload)`.

## 4. 메뉴 구조 · 모듈 현황

### 4-1. 메뉴 2판 (v1.46 — Mark 승인안)

허브(레일) › 메뉴(허브 패널) › [탭 묶음 안 탭]. 탭 묶음(`type: "bundle"`)은 패널에 한 줄, 누르면 첫 화면이고 화면 위 밑줄 탭(`#subtabs`)으로 오간다. **주소(`#/모듈`) · 바로가기 · 검색 · 증빙 링크는 모듈 단위 그대로.**

| 허브 | 메뉴 (탭 묶음은 [탭 · 탭]) | 들어갈 정보 기준 |
|---|---|---|
| (최상위) | 대시보드 | — |
| (패널 맨 위) | **지원 카드**(v1.48) — 검색(Ctrl K) · 메인 데스크(hq) · 아르고(내부 전 계정, v1.49). 패널을 접었을 때 · 태블릿 · 모바일은 상단바 아이콘 3개 | 메뉴가 아니라 어디서나 여는 도구 |
| 홈 `hub-home` | 일정관리 · 회의록 · 운항 현황 · 바로가기 (+ 링크) | 매일 보는 것 |
| 화물 보안 `hub-sec` | 화물보안 대시보드 · 보안검색 현황 · 검색장비 관리 · 보안 처리 대장 · 상용화주 · RA · 협력사 · 보안요원 · (예정) 보안구역 출입 | 화물 · 검색 · 장비 · 보안요원 운영 |
| 점검 · 교육 `hub-aud` | 점검 · 교육 대시보드 · 점검 · 순찰 `bd-check`[보안 기록부 · 순찰일지] · 수검 대응 `bd-audit`[수검 · 지적사항 · 자체 보안점검(선택)] · 보안교육 `bd-edu`[이수 · 자격 · 전파교육] | 주기적으로 기록하는 것 |
| 비상 · 연락 `hub-ops` | 팀위기대응 (SERP) · 위협전화 대응 · 연락처 `bd-contact`[업무 연락처 · 비상연락망 · 체계도 · 위기대응 조직] | 사람 · 연락처 · 비상 절차 |
| 규정 · 문서 `hub-doc` | 규정 `bd-regs`[항공보안 · 안전관리 · 위험물] · 계약 · 협약 (+ 링크) | 기준 문서 · 계약 |
| 안전 관리 `hub-saf` | (예정) 위험성 평가 · 사고 · 아차사고 · GSE — 운영 화면이 생길 때까지 레일에서 숨김(`hubList`) | 산업안전 |
| (레일 아래) | 암호 관리 · 시스템 설정 | — |

- 삭제: 예정 '안전보안 현황판'(대시보드와 중복) · 예정 'CAR'(수검 지적사항이 대신)
- 이전(`migrateMenus`, 대시보드 메뉴 `mv: 2` 로 한 번): 시드 메뉴를 시드 자리(소속 · 순서)로, 이름은 옛 기본 이름일 때만 새 이름(`RENAMED`), 운영자가 만든 링크 · 숨김은 그대로. 운영 메뉴 데이터는 시스템관리자(menus 쓰기 4)가 새 버전으로 접속할 때 저장된다
- 옛 화면이 묶음 소속을 풀어 저장해도 다음 정규화가 시드 묶음으로 되돌린다. 설정에서 묶음을 지우면 안의 메뉴는 허브로 옮겨진다
- 탭이 하나만 보이면(나머지 숨김 · 권한 밖) 탭 줄은 숨는다. 지금 운영 데이터는 **순찰일지가 숨김**이라 '점검 · 순찰'에 보안 기록부만 보인다
- **메뉴가 아닌 기능(v1.48)**: `PANEL_ONLY`(지금 desk)는 시드에 없고, 운영 menus 에 남아 있으면 `normalizeData()` 가 지운다(ensureSeedMenus 가 되살리지 않음). 운영 menus 저장은 시스템관리자가 v1.48 로 처음 접속할 때 — 그 전에도 각 화면은 정규화로 메뉴를 숨긴다
- 새 메뉴: `defaultMenus()` 시드에 한 줄(탭 묶음이면 `parent: "bd-…"`, `tab: "짧은 이름"`) → 운영 데이터에 없으면 `ensureSeedMenus()` 가 시드 자리에 넣는다

### 4-2. 모듈 (라우트 · 파일 · 권한)

| 라우트 | 파일 | 권한 | 내용 |
|---|---|---|---|
| dashboard | modules.js · hero3d.js | all | 3D 화물 태그(무재해 · 보안등급) · 오늘 · 띠(검색 환경 · 위협전화 · SERP · 수검 · 운항) · 공지 · 결정사항 · 모듈 구축 현황 |
| (패널) desk | desk.js · docread.js | hq | **메인 데스크**(v1.48 부터 라우트 화면이 아니라 공통 패널) — 지원 카드 · 상단바 · 어디서나 끌어다 놓기(보던 화면 그대로) · `#/desk`(대시보드 위에 패널) · 검색 결과로 연다. 탭 [올리기 · 확인 대기][접수 대장 — A4 Print]. 머리 부엉이 표정 = 판독 중 thinking · 반영 직후 happy · 판독 실패 alert. 문서 올리기 → AI 판독 → 반영안 확인 · 수정 → 반영(이수 기록 + 다음 이수 기간 일정 · 일정 · 전파교육 · 수검 지적 · 처리 대장 · 하드카피 집계 · 문서 서가) · 보관만 |
| (패널) argo | argo.js | user~admin(협력업체 · 서명 제외) | **아르고 AI 도우미**(v1.49) — 지원 카드 · 상단바 부엉이 · `#/argo`(대시보드 위 패널) · 검색 결과로 연다. 사용법 · 용어 Q&A(docs/ARGO-GUIDE.md) · 메뉴 찾기(바로 가기) · 자료 찾기 · 현황 · 쓰기(hq — 일정 등록 · 수정 · 완료 · 삭제 · 공지 · 이수 기록 · 서가 보관 · 수검 지적) · 첨부(사진 · PDF 4.5MB · 워드 · 한글 · 엑셀 · PPT 글) · 결과 카드 · 되돌리기 · 지우기 · 여러 건 확인 · 대화 Print. 설계 DESIGN §18 |
| (공통) | panel.js | — | **공통 패널 모달** `SeMIS.ui.panel(o)` = `SemisPanel.open(o)` — 검색 · 메인 데스크 · 아르고 |
| (공통) | argo-owl.js | — | **부엉이 아르고** `SemisOwl.mount(el, { size, state })` · `SemisOwl.svg(state, size)` |
| schedule | calendar.js | mgr | 일정(담당자 다중 · 12색 · 반복 · 미리알림) · 점검 기한 · 수검 일정 연동 |
| minutes | minutes.js | mgr | 회의록 · QR 참석 서명 · 결정사항 |
| flight | flightcore.js · flightops.js | all | 에어제타 화물기 15대 ADS-B 위치 · 인천 입출항 |
| shortcuts | shortcuts.js | all | 링크 메뉴 카드 · 사이트 아이콘 |
| sec-dash | secdash.js · secpost.js · hazfind.js | mgr | 화물보안 대시보드 — 장비 가동 · 점검 이행 · 검색 환경 · 경비대원 배치도 · 위해물품 적발(CARES 월 집계) |
| scr-status | screening.js · cares.js · scrstats.js | mgr | 보안검색 현황(CARES 실시간) · 검색 실적 |
| scr-equip | equipment.js · cares.js | mgr | 검색장비 대장 · 고장 · 수리 · 가동 분석 · 내용연수 |
| sec-cases | seccases.js | mgr | 보안 처리 대장(특별보안검색 · DIP · 의심화물 등) |
| kc-ra | kcra.js | hq | 상용화주 · RA |
| partners | partners.js · docshelf.js | mgr | 협력사 · 보안요원(요원 현황 · 교육 이력 · 업체 문서) |
| aud-dash | auddash.js | mgr | 점검 · 교육 대시보드(교육 · 자격 · 수검 · 기록부) |
| inspection | seclog.js | mgr | 보안 기록부(양식별 주기 기록 · 누락 · 하드카피 집계) |
| daily-safety | patrol.js | mgr | 일일 보안 · 안전 순찰일지(5일 한 장 · 등록 서명) |
| audit | audit.js | mgr | 수검 대응 센터(수검 일정 · 체크리스트 70항목 · SSOP 조항 · 지적사항) |
| selfcheck | selfcheck.js · hwpx.js · nasforms.js | mgr | 자체 보안점검(수준관리지침 별표 · HWPX) — 선택 실행 |
| training | training.js · edu.html · edu-form.js · edu-shim.js | mgr | 보안교육 · 자격(인원 · 교육 기록 · 직무 · 과정 기준표 · SSI 서약 · 이수 등록 페이지) |
| dissem | dissem.js | mgr | 보안 전파교육 이행표 |
| serp | serp.js | mgr | 팀위기대응계획(초동조치 · 조직 · 연락처 · 대응 기록) |
| threat | threat.js | mgr | 테러 위협전화 대응(응대 가이드 · 보고양식 · 녹음 전화 점검) |
| phonebook | phonebook.js | mgr | 업무 연락처(구역 9 · 확인 필요) |
| contacts | contacts.js · flowpdf.js | mgr | 비상연락망 · 보고 체계도 3종(PDF 반자동 반영) |
| crisis | crisis.js | mgr | 위기대응 조직 · 담당자(엑셀 대조) |
| reg-sec · reg-safety · reg-dg | regulations.js | mgr | 규정 3종 · PDF 뷰어 · 개정 아이디어 |
| contracts | contracts.js | hq | 계약 · 협약 |
| vault | vault.js | hq | 암호 관리(AES-256-GCM, 공용/개인) |
| settings | modules.js | admin | 메뉴(탭 묶음 포함) · 사용자 · 담당자 · 데이터 이력 · 저장소 · 보안 |
| (서가) | docshelf.js | 화면별 | 문서 서가 `SemisDocs` — 체크리스트 증빙 · SSI 잠금 |

모듈별 자세한 동작 · 데이터 모양은 각 파일 머리 주석과 `docs/HISTORY.md` §A.

## 5. 데이터 · 백엔드

- **SYNC_KEYS(41)**: menus · notices · schedules · assignees · assigneesSeeded · minutes · minuteFolders · levelHistory · safetyBoard · contacts · gcal · vault · regulations · equipment · crisis · fleet · audits · phonebook · training · seclog · seclogCfg · serp · serpRuns · threat · threatRuns · threatChecks · patrol · patrolCfg · patrolPeople · secPost · secPostImg · selfChecks · selfCheckCfg · docs · partners · contracts · kcra · secCases · dissem · scrStats · desk (계정 자료 pwOverrides·userOverrides·customUsers는 v1.15에 서버 전용 표로 이관·삭제)
- **v1.39 보안교육 이수 등록(배포용 edu.html — 새 컬렉션 없음, training 칸 추가)**: people `apt{직무: 임명일}` · `emp`(사번, v1.39.2 — 대조 키 `edu_emp_key` = 영문 · 숫자 소문자, 앞 KJ 뺌) · `src: "self"` · `selfAt` / records `src: "self"` · `selfAt` · `chkAt` · `chkBy`(안전보안파트 확인). 비공개 표 `semis_logi_private.edu_links`(코드 12자 · 제목 · 기한(그날 23:59:59 KST) · active · target training|eduTest) · `edu_tickets`(sha256, 3시간) · `edu_uploads`(경로 · 표 · used_by) · `edu_submits`(제출 원본 결과 — 같은 sid 재전송은 저장된 결과 반환) · `edu_hits`(IP 제한). 공개 RPC(anon): `semis_logi_edu_info(p_k)` · `semis_logi_edu_ticket(p_k, p_pow)`(작업증명 = 로그인과 같은 challenge) · `semis_logi_edu_submit(p_k, p_ticket, p)`, 관리(hq): `semis_logi_edu_links()` · `semis_logi_edu_link_save(p)`, 서비스 권한만: `semis_logi_edu_claim(…)` · `semis_logi_edu_read_ok(p_ticket, p_path)`(v1.39.2 판독 전 확인 · 횟수 · 과정 목록)(파일 함수가 부름). 병합 = 순수 함수 `semis_logi_private.edu_merge(t, p, m)`. 시험 행 `eduTest`(권한표 9/9 — 시스템관리자만 target 'eduTest' 링크를 만들 수 있음). 제출은 계정 세션이 아니라 check_base(409)를 타지 않고, 열린 화면은 변경 알림으로 다시 받는다(updated_by `anon/edu-self`)
- **v1.35 점검 표시 · 하드카피(새 컬렉션 · 권한표 변경 없음)**: `seclogCfg.vis` = { 양식id: { m: "dim" | "hide", msg? } }(msg 는 기본 '하드카피본 확인'과 다를 때만, 표시는 넣지 않음) · `selfCheckCfg.vis` = { 별표 id: 같은 모양 } · 보안 기록부 하드카피 집계 = `seclog` 안 한 줄 { id: "hc-"+양식id, tid, hc: true, marks{ 주기키: ok | ng | miss }, cnt{ "YYYY-MM": 건수 }(편별 · 수시), updatedAt/By } — 날짜가 없어 `logs()` · 대시보드 기록 집계에 안 잡힘 · 자체 보안점검 하드카피 기록 = `selfChecks` 안 { id, form, hc: true, date, insp, find, open, note, createdAt/By, updatedAt/By } — status 없음, `recs()` 에서 빠지고 `hcRecs()` 로 셈. 쓰기 권한: vis 는 화면에서 admin 만(서버 권한표는 seclogCfg 3 · selfCheckCfg 3 그대로)
- **CARES 위해물품 월 집계(v1.36)**: `js/cares.js` 묶음 `haz`(10분 캐시, 따로 요청할 때만) = CARES Firestore `hazStats` 목록(GET) → `SemisCares.hazMonth(ym)` · `hazSeries(n)` · `ymKST(off)` · `HAZ_CATS` · `HAZ_URL`. 문서 = { total, cat:{liquid,powder,mixed,other,none}, loc:{'1','2','3',etc}, day, withdrawn, review } — CARES 함수(hazStatsOnWrite)가 만들고 공개 읽기. 기록 원본 `hazFinds`(AWB · 업체 · 근무자)는 CARES 비공개라 Logistics 는 읽지 않는다(테스트 HZ01). 분류 색 #2b59c3 · #d97706 · #9d174d · #0d9488(dataviz 검증기 --pairs all 통과)
- **메인 데스크(v1.47 · v1.48 패널)**: 컬렉션 `desk`(권한표 3/3, 마이그레이션 `semis_logi_security_26_desk`) = { cfg{ areas{ security · safety · industrial · dg } — 분야별 일정 담당(이름 쉼표 구분 — 공용 DB 에만, 화면 '분야별 담당'), log[최근 500 — { id, at, by, file{ name, size, url, type(pdf · image · docx · hwpx · xlsx · pptx · text · legacy · other) }, status(reading · wait · done · kept), err, type(cert · notice · dissem · audit · special · hardcopy · other), title, summary, ai(확인 대기 중 판독 결과 — 반영 · 보관하면 지움), acts[{ k, label, route }], doneAt, doneBy }] }
  - 파일: 원본은 `desk/`(열람 · 올리기 3). 반영할 때 Edge `copy` 로 대상 폴더에 사본(이수 기록 training · 일정 schedules · 전파교육 dissem · 수검 audits · 처리 대장 cases · 서가 docs / 민감 docs-ssi) — 대상 화면 열람 등급을 따르게
  - 판독: DOCX · HWPX · XLSX · PPTX · TXT 는 화면(`js/docread.js`)이 글을 뽑아(문단 · 표 칸 ` | ` · 엑셀 날짜 서식 · 6만 자) 보내고, PDF(15MB) · 이미지(긴 변 2400px JPEG, 5MB)는 함수가 저장소 원본을 읽는다. HWP · DOC · XLS · PPT 구 형식은 판독 불가(보관 · 수동 반영). AI 에 보내는 목록 = 교육 과정 · 수검 · 기록부 양식 · 처리 유형 · 서가 묶음 · 전파 구분(이름 · 담당자는 보내지 않음). 결과는 화면이 다시 검사(`SemisDesk.clean` — 목록 밖 id · 틀린 날짜 · 시각은 비움)
  - 반영: 이수 기록(사번 → 이름 순으로 재직자 맞춤, 없으면 새 인원 · 같은 사람 · 과정 · 수료일이 있으면 기본 꺼짐 · 유효기한은 계산값과 다를 때만) + 다음 이수 기간 일정(id `dsk_tr_<인원>_<묶음>` — 다시 반영하면 덮어씀, 지침 제13조는 1년 되는 날 30일 전 · 위험물은 만료 3개월 전, 지났으면 오늘) / 일정(색: 회의 파랑 · 교육 초록 · 점검 · 심사 빨강 · 규정 · 절차 갈색 · 기한 빨강 · 행사 · 견학 회색, 회의실 = 장소에 '화물터미널' + '회의실', 담당 = 분야별 담당) / 전파교육(대상 파트 전부) / 수검(기존 또는 새로 + 지적 → 일정 연동) / 처리 대장 / 하드카피 집계(주기 양식은 그 주기 확인 · 이상, 수시 양식은 그 달 건수 더하기) / 문서 서가
  - 운영 DB `desk` 행은 SQL 로 분야별 담당 시드(updated_by `desk-seed`, 보안 · 안전 · 산업안전 — 위험물은 비움)
- **아르고(v1.49)** — 새 컬렉션 없음(대화는 탭 `sessionStorage semisl:argo:<계정>`, 질문 20개 · 되돌리기 목록, 로그아웃 때 지움). 기록에 `src: "argo"`(일정 · 공지) / 이수 기록 · 서가는 메인 데스크 반영 경로(`src: "desk"`) 그대로
  - Edge `semis-logi-argo`(원본 `tools/edge/semis-logi-argo.ts` + `argo-guide.ts`, verify_jwt false): x-semis-token → RPC `semis_logi_argo_begin()`(세션 · 내부 계정 · 오늘 호출 +1 · 한도) → Claude(`ARGO_MODEL` → claude-sonnet-5-5 → sonnet-4-5 → haiku-4-5, max_tokens 2500, 캐시 = 도구 + 고정 지침 + 마지막 블록) → `semis_logi_argo_meter(p_in, p_out, p_cache)`. 비밀값 `ANTHROPIC_API_KEY`(데스크 판독과 같은 키). 대화 검사: 역할 교대 · 도구 이름(등급별) · tool_use/tool_result 짝 · 첨부 6개 · base64 9.5M자 · 본문 10MB
  - SQL `tools/sql/semis-logi-argo.sql`(마이그레이션 `semis_logi_security_27_argo`): 비공개 표 `semis_logi_private.argo_usage`(account_id × day(KST) · calls · tok_in · tok_out · tok_cache) · settings `argo` { calls 200, tokIn 5000000 } — 한도 바꾸기: `update semis_logi_private.settings set v = jsonb_set(v, '{calls}', '300') where k = 'argo'` · 사용량 보기(시스템관리자 세션 RPC 또는 SQL): `select a.login_id, u.* from semis_logi_private.argo_usage u join semis_logi_private.accounts a on a.id = u.account_id order by day desc`
  - 안내 지식: `docs/ARGO-GUIDE.md` 를 고치면 `npm run argo:guide` → Edge 재배포(파일 2개). 메뉴가 바뀌면 §4 표와 함께 고친다(테스트 AR12 가 route 가 실제 모듈인지 확인)
- SYNC_KEYS 밖 설정 행: `caresCfg`(CARES Firebase 웹 키 — `SemisSync.fetchKV`로만 읽음, 앱이 쓰지 않음) · `auditMaster`(v1.19 수검 체크리스트 원본 — 민감보안정보, 권한표 읽기 3 · 쓰기 9, hq가 상세를 열 때 `fetchKV`로 받아 메모리에만 둠)
- 신규 컬렉션 추가 시: `freshData()` 기본값 → `normalizeData()` 보정(멱등 — v1.45~ `obj` · `rows` 표에 키 한 줄) → `sync.js` SYNC_KEYS → 테스트 Y01 기대 문자열 갱신 → **서버 권한표 등록**(아래)
- **서버 보안(v1.15)** — 원본 SQL `tools/sql/semis-logi-security.sql`(1단계) · `tools/sql/semis-logi-lockdown.sql`(2단계 잠금). 실제 적용은 마이그레이션 `semis_logi_security_1~6`(6 = RPC 실행 권한: public `semis_logi_*`는 anon·service_role만, authenticated 차단)
  - **작업증명(v1.16, 마이그레이션 `semis_logi_security_7_pow`, SQL `tools/sql/semis-logi-pow.sql`)**: 로그인 창이 뜨면 `semis_logi_challenge()`(HMAC 서명 {nonce·만료 2분·난이도}, 비밀값은 `semis_logi_private.settings`)를 받아 `js/pow.js` Web Worker가 미리 푼다 → `semis_logi_login(p_pw, p_ua, p_pow)` — 해답 없으면 `pow`, 만료 `pow_expired`, 재사용 `pow_used`(클라이언트가 새 문제로 1회 재시도). 기본 18비트(약 0.2초), 15분 전체 실패 50/150/400 → +2/+4/+6. 6자리 서명 코드는 1시간 실패 200회 초과 시 15분 `sign_paused`. 보안 탭 통계(fail15·fail60·powBits·signPaused). SeMIS v2 v2.53과 같은 파일·방식
  - 로그인: RPC `semis_logi_login(p_pw, p_ua, p_pow)` → 서버가 `bcrypt(sha256('SeMISv2::'+암호))`로 확인 → 세션 토큰 64자(원문은 저장 안 함, sha256만). 같은 IP 15분 20회 실패 → 15분 제한. 6자리 숫자는 회의 서명 코드(회의일 ±90일)
  - 토큰은 이 탭의 `sessionStorage semisl:tok`, 모든 요청에 `x-semis-token` 헤더. 세션 24시간 무활동 만료(10분마다 `semis_logi_whoami`로 확인·연장) · 최대 30일. 서버가 끊으면 로그인 창만 다시 뜨고, 같은 계정이면 미전송분을 이어서 저장
  - RLS: `semis_logi_store`는 정책 "logi session read/insert/update"만 — `rank_now() >= read_rank(key)` / `write_rank(key)`. 권한표 `semis_logi_private.key_acl`(9 = 앱에서 불가). **새 컬렉션은 여기에 (key, 읽기, 쓰기) 등록**(없으면 2/3). SQL 파일에도 같은 줄(테스트 C05가 대조)
  - 서버가 `updated_at`(서버 시각)·`updated_by`(`계정ID/클라이언트ID`)를 찍는다(트리거 `semis_logi_store_a_stamp`). 변경 알림은 트리거 `semis_logi_store_notify` → Broadcast 채널 `semis-logi-sync`(컬렉션 이름만) → 클라이언트가 그 컬렉션만 GET
  - 관리자 RPC: `semis_logi_users` · `semis_logi_user_save(p)` · `semis_logi_user_delete` · `semis_logi_set_password`(다른 접속 끊김) · `semis_logi_history` · `semis_logi_history_value` · `semis_logi_security`(접속 중 · 기록) · `semis_logi_end_sessions`. 회의 서명: `semis_logi_sign_submit`(그 회의 한 건만 수정 — signer 세션은 공용 DB 직접 조회 불가)
  - 계정 표는 SQL(서비스 권한)로만 직접 볼 수 있다: `select id, login_id, role, last_login_at from semis_logi_private.accounts`
- **데이터 사본**: `sessionStorage semisl:data`(탭 단위 — 탭을 닫거나 로그아웃하면 사라짐) · 캐시 주인 `semisl:owner`(다른 계정이 로그인하면 비움) · 읽을 권한이 없는 컬렉션은 로그인 때 기본값으로 비운다. pending 큐 · 강제 push 표시도 sessionStorage. 옛 버전의 `localStorage semisl:data`는 시작할 때 지운다
- **파일(v1.15)**: 버킷 비공개. 저장값은 표준 주소(`…/object/public/semis-logi-files/경로`) 그대로. `js/fileauth.js`(SemisFileAuth)가 화면의 img · iframe · a 등을 서명 URL(1시간)로 바꿔 끼우고(원래 주소는 `data-sf`), 서명 전 링크는 새 창을 먼저 연 뒤 보낸다. 서명·업로드·목록·삭제는 Edge Function `semis-logi-files`(원본 `tools/edge/semis-logi-files.ts`, verify_jwt false — 세션은 `semis_logi_file_auth()`로 확인). 폴더 등급: 열람 notices·attach·minutes·minutes-sign 1 / schedules·contacts·crisis·regs·regs-diff·audits·training·seclog·threat·patrol 2 / 그 밖 3, 올리기 minutes·minutes-sign·seclog·threat·patrol 2(서명 세션은 minutes-sign만) / 나머지 3. 업로드 경로는 함수가 정한다(무작위 접두사). html·js 형식은 거부, 50MB 제한
- **대량 삭제 방어**(sync.js `guardWipe`): 2건 이상 → 0건 push 차단. 정상 전체 삭제는 `SemisSync.confirmWipe(key)`
- **저장 충돌 방지(v1.24)** — 원본 SQL `tools/sql/semis-logi-conflict.sql`, 마이그레이션 `semis_logi_security_12_base_check`(완화) → `semis_logi_security_13_base_strict`(엄격)
  - 열 `semis_logi_store.base_at`(확인용 — 트리거가 늘 null 로 되돌려 저장 안 됨) · BEFORE UPDATE 트리거 `semis_logi_store_0_base` → `semis_logi_private.check_base()`: **계정 세션(ctx kind user)** 의 저장은 `base_at` 이 지금 행의 `updated_at` 과 같아야 한다(없으면 = 옛 화면 → 거절). 거절은 `PT409` → HTTP 409 `{message:"semis_conflict", details:<key>}`. SQL(서비스 권한) · 회의 서명 RPC(signer)는 확인하지 않음. BEFORE INSERT 에 걸면 안 됨(INSERT … ON CONFLICT 의 excluded 에 반영되어 늘 충돌)
  - 앱(js/sync.js): 행마다 받은 `updated_at` 을 `serverAt[key]` 로 기억(`""` = 서버에 행 없음, 모르면 먼저 받음) → upsert `?select=key,updated_at` + `return=representation` 으로 새 시각 갱신. 409 면 그 컬렉션을 다시 받아 **3-way 병합**(`SemisSync.merge3(base, local, remote)`: id 배열은 항목 단위 · 원시값 배열은 값 집합 · 객체는 키 단위 · 같은 곳을 다르게 고쳤으면 이 탭 우선 · 한쪽이 지운 항목을 다른 쪽이 고쳤으면 남김 · `vault` 는 통째로) 후 다시 저장(3번까지, 넘으면 오프라인 표시 · 30초 뒤 재시도). base = `snapshots[key]`(마지막으로 서버와 맞춘 값, `baseOK`) — 기준을 모르면(새로고침 직후 미전송분) 합집합 · 이 탭 우선(옛 mergeById 와 같음)
  - push · pull 은 한 줄로(`serial`) — 서로 끼어들어 기준 시각이 엇갈리지 않게. 데이터 요청 20초 시간 제한. 이미 서버와 같은 컬렉션은 보내지 않음(불필요한 이력 방지)
  - 깨어남 감지: 15초 타이머가 3분 넘게 멈췄음 · 탭이 3분 넘게 숨었다 보임 · `resume`(얼린 탭 풀림) · `pageshow`(persisted) → 전체 다시 받기(`SemisSync.isStale()` 이 그동안 true). 실시간 채널이 다시 연결(SUBSCRIBED)돼도 한 번 받음. 일정 자동 연기(calendar.js `autoRollIfAllowed`)는 stale 이거나 1분 주기가 2.5분 넘게 밀린 회차에는 건너뜀
  - **SQL로 공용 DB를 고치면 `updated_at` 이 바뀌므로** 열려 있던 화면의 다음 저장은 한 번 409 → 병합으로 이어진다(정상). 반대로 **SQL로 `updated_at` 을 옛 값으로 되돌리지 말 것**(충돌 확인이 무력화)
- **서버 자동 백업**: 트리거가 모든 변경 직전 값을 `public.semis_store_history`에 90일 보관 → 시스템 설정 › 데이터 관리 › 변경 이력에서 복원
- 규정 PDF: `semis-logi-files/regs/` (v1.15부터 비공개 — 서명 URL). 2026-09-20 등록 18건(안전관리 16 · DG 2)
- 예외: **국가항공보안 수준관리지침**(v1.32) PDF는 저장소 `assets/regs/nas-217.pdf`(공개 법령 본문 + 화물 관련 별표 9종 — 컨테이너가 supabase.co 에 못 붙어 버킷 대신 저장소, `fileUrl` 상대 경로)
- SeMIS v2와 **데이터 완전 분리** — v2는 `semis_store` · `semis-files`

## 6. 반드시 지킬 규칙

1. **A4 인쇄 버튼**(표시 이름 `Print`, v1.29부터 모바일은 머리말 더보기(…) 안): 모든 화면(새 탭으로 여는 외부 링크 제외, 내부 링크 화면은 프레임 내용을 A4 한 장으로 인쇄). `.page-head`/`.ds-head`만 두면 코어가 자동 부착
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
12. **서버 보안(v1.15)**: ① 새 컬렉션 → `key_acl` 등록(+SQL 파일) ② 새 파일 폴더 → `tools/edge/semis-logi-files.ts` 등급표 추가 후 재배포 ③ 파일 주소는 표준(public) 주소로 저장하고 화면에 그대로 쓰면 자동 서명된다(v1.43~ `#page=N` 같은 조각은 서명 주소 뒤에 그대로 붙음) — 단, 화면 밖 `new Image()`·`fetch`는 `SemisFileAuth.resolve(url)`, 별도 인쇄 문서(iframe document.write)는 `SemisFileAuth.signHtml(html)`, 편집기 HTML 저장은 `SemisNotice.sanitizeHtml`(서명 흔적 되돌림) ④ CSP(`script-src 'self'` + supabase-js 한 파일): 인라인 `<script>`·`onclick=` 금지, 외부 스크립트 추가 시 index.html CSP 수정 ⑤ 코드·문서에 토큰·해시·명단 금지(테스트 C03·SEC09) ⑥ 브라우저 확인은 로컬(route로 파일 제공) + 공용 DB 비-GET·`semis_logi_sign_submit` 차단 상태에서, 임시 계정은 확인 후 삭제
14. **민감보안정보(SSI) 보관 위치(2026-09-26 Mark 결정)**: 원문 · 원본 파일은 Mac `~/SeMIS_v2/_ssi/`(연결 폴더, git 제외 — `.git/info/exclude`에 `_ssi/` · `_logi_transfer/` 등록)와 공용 DB(권한표로 보호)에만 둔다. 제약 없이 써도 되는 곳은 이 두 곳뿐이고, 커밋 · push 되는 코드 · 테스트 · 문서에는 넣지 않는다(두 저장소 모두 GitHub 공개 + github.io로 누구나 받을 수 있음). 현재 `_ssi/checklist/`에 점검관용 CHK-LIST 원본 docx · `auditMaster.json` · 파싱 스크립트 보관
16. **허브 대시보드(v1.28 · v1.31)**: 레일 허브를 누르면 대시보드로 가는 허브는 app.js `HUB_HOME`(hub-sec → sec-dash · hub-aud → aud-dash). 새 허브 대시보드는 그 허브 맨 위 메뉴로 넣고(normalizeData 1회 추가), 다른 모듈 데이터는 각 모듈이 내보낸 API로 읽기만 한다
15. **화면 정돈 "Calm"(v1.29, 2026-10-01)** — 모듈은 지금처럼 `.page-head` · `.stat-row` · `table` 을 쓰면 코어(`app.js` tidyView — #view MutationObserver)가 알아서 정돈한다. ① 머리말: 첫 `.btn-primary` 하나만 모바일에 남고 나머지 `.btn`은 더보기(…) 액션 시트로(원래 버튼을 click() — 권한 · 동작 그대로). 모바일에 꼭 남길 버튼은 `data-keep` ② 주 버튼이 없는 화면은 모든 버튼이 더보기로 ③ 표: 머리글이 3칸 이상이면 칸마다 `data-label` · 제목 칸 `data-role="title"` · 조작 칸 `td-act` · 빈 칸 `td-nil` 표시, 모바일에서 넘치거나 좁은 칸이 세로로 늘어나면 `tbl-stack`. 행 병합 표 · 서식 본문 · 모달 안 표는 제외, 쌓지 않을 표는 `tbl-keep`/`data-no-stack` ④ 모바일 CSS는 반드시 `@media screen and (max-width: 767px)`(인쇄 폭 A4 ≈ 718px 이 max-width 조건에 걸림) ⑤ 모바일 · PC 구성이 다른 화면은 `SeMIS.isMobile()` 로 갈라 그린다 — 폭이 경계를 넘으면 코어가 다시 그림 ⑥ 설명 문장(`.page-desc` · `.page-note`)은 모바일에서 숨으므로 꼭 필요한 정보는 넣지 말 것 ⑦ 하단 탭은 `MOBILE_TABS`(홈 · 일정 · 순찰 · 운항, Mark 결정) ⑧ **(v1.30) 편집 전용 단추는 `m-ed`** — 모바일에서 평소 숨고 더보기 › '편집'일 때만 보인다(코어가 `.m-ed` 가 있으면 시트 첫 줄에 '편집'을 넣음). 권한 없는 사용자에게는 `m-ed` 를 붙이지 말 것(대신 `m-hide`) — 붙으면 '편집'이 생긴다. 대응 · 응대 화면(진행 중 기록 삭제 등)에는 쓰지 않는다 ⑨ **(v1.30) 긴 묶음은 `SeMIS.ui.mf(key, force)`** — 카드에 속성, 머리 요소(카드의 직계 자식)에 `mf-h`. 검색 · 필터 중에는 force=true. 머리 안 보조 단추 중 접힌 동안 숨길 것은 `mf-x`. 늘 펼칠 핵심(초동조치 · STEP · 우리 팀)은 접지 않는다. 접힌 묶음 안 표는 펼칠 때 정돈된다 ⑩ `m-hide` = 모바일에서 숨기는 보조 정보(설명 · 복사 단추 · 위 띠와 겹치는 안내)
17. **점검 숨김 · 흐리게(v1.35)**: 점검(양식 · 별표)을 셈하는 새 코드는 반드시 각 모듈 API(`SemisSeclog.templates()` · `logs()` · `status()` / `SemisSelfcheck.forms()` · `recs()` · `hcRecs()` · `hcOpen()`)를 거칠 것 — `SeMIS.data.seclog` · `selfChecks` 를 직접 읽으면 숨긴 점검 · 하드카피 줄이 섞인다. 흐리게 점검의 '점검표' 바로 가기는 `recordForm` · `startForm` 을 부르면 알아서 집계 창으로 간다
13. **스크립트는 `defer`(v1.17.1)**: index.html 본문의 스크립트는 모두 `defer` — CSP `<meta>` 때문에 브라우저 미리 읽기가 멈춰 스크립트를 하나씩 받느라 앱 준비가 수 초 늦었다. `<head>` 에는 `js/loginguard.js`(v2와 같은 파일) 하나만 즉시 실행으로 두고, 앱 준비 전에 누른 로그인은 이 파일이 붙잡았다가 boot 가 이어서 처리한다. 새 모듈 스크립트도 `defer` 로 추가(테스트 LG01)

18. **버튼 위계(v1.41, Mark: "동일한 버튼을 여러 개 만들어 헷갈리게 하지 말고 중요한 버튼은 강조, 덜 중요하거나 관리자용은 텍스트화 · 작게" — 사이트 전반)**: 머리말 강조(`.btn-primary`)는 하나. 관리 · 설정 동작(표시 관리 · 양식 · 폴더 관리 · 엑셀 반영 · 기본 정보 · 등록 페이지 등)은 머리말에서 `link-btn head-link`(글자 버튼). 카드 · 행마다 반복되는 동작은 강조하지 않는다(`btn-ghost` 또는 작은 아이콘 `mt-btn`). 같은 동작을 두 곳에 두지 않는다(예: 제목 = 원문 열기, 행 클릭 수정 대신 연필 아이콘 하나). 버튼에 그림 문자(이모지) 금지 — `SeMIS.icon`. 문서 서가의 '문서 추가'는 카드마다 하나(묶음은 등록 창에서 고름). 테스트 TA09
19. **주석은 '왜'만(v1.45)**: 코드 주석에는 버전 · 날짜 · 결정 경위 · 바뀐 내력을 쓰지 않는다(그건 이 문서 §7 · §8 과 docs/HISTORY.md). 남길 것 = 보안 제약 · 규정 근거 · 브라우저 함정 · 데이터 모양 · 경고. 파일 머리는 역할 1~2줄, 800줄 넘는 파일만 `/* ── 구역 ── */` 한 줄 표지. 새 메뉴는 `defaultMenus()` 에만 넣으면 운영 데이터에 없을 때 `ensureSeedMenus()` 가 시드 순서 자리에 넣는다(예정 메뉴는 넣지 않음)
22. **아르고 도구(v1.49)**: 새 모듈 자료를 아르고가 읽게 하려면 `js/argo.js` `COLS`(목록 · 요약) 한 줄 + Edge `COLLECTIONS` 한 줄(이름 · 등급 — 테스트 AR13 이 두 곳을 대조). 쓰기 도구는 `W` 에 { label, keys(되돌릴 컬렉션), prep(검사 · 업로드), run(바꾸기 → lines · go · result · log) } + Edge `toolList` 정의(min 3). 쓰기 권한은 그 화면의 편집 권한과 같게. 안내 지식 · 메뉴 표는 docs/ARGO-GUIDE.md(공개 저장소 — 이름 · 연락처 · SSI 금지)
20. **공통 패널(v1.48)** — 검색 · 메인 데스크 · 아르고처럼 '어디서나 여는 큰 화면'은 `SeMIS.ui.panel({ id, title, sub, mascot(부엉이 상태) | icon, tabs[{ id, label, badge }], tab, onTab, render(body, h), actions, onActs, print, focus, onClose, cls })`. 폼 입력은 지금처럼 `openModal`(작은 모달). 패널이 열려 있으면 `openModal` · `toast` · 말풍선 · 액션 시트가 패널 안에 붙는다(밖은 inert). 지원 카드 기능은 `SeMIS.registerSupport(id, { ok, badge, open })`, 옛 주소 처리는 `SeMIS.registerPanelRoute(id, fn)`, 원격 변경 때 다시 그리기는 `SeMIS.onRerender(fn)`. 패널 본문의 표 정돈은 `SeMIS.tidyTables(body)`. Esc 는 안쪽 모달 → 패널 순으로 하나씩
21. **화물 태그 문법(v1.48, Mark 선택 B안)** — 크림 종이(`--tag` · `--tag-2`) · 앰버 띠 · 절취선(`--tag-perf`) · 페트롤 잉크(`--tag-ink`)는 지원 카드 · 패널 · 선택 상태(탭 · 세그먼트 · 메뉴) · 배지 · 표 머리에만. 카드 · 업무 본문은 흰 바탕 그대로. 종이 위 보조 글자도 `--text-2`/`--text-3`. 부엉이는 그림이라 이모지 금지 규칙과 무관하되 메뉴 · 버튼 이름에는 넣지 않는다

## 7. 미결 · 주의 (열린 일만 — 끝나면 HISTORY.md 로)

- **계정 암호**: v1.14 까지 계정 해시가 공개 저장소 git 이력 · 옛 공용 DB(`pwOverrides`)에 있었다 → 네 계정(mark3464 · cargo-ss · cargo-mgr · cargo-user) 새 암호로 바꿨는지 확인 필요
- **메뉴 2판 저장**: 시스템관리자가 v1.46 으로 한 번 접속하면 운영 menus 에 저장된다. 배포 직후 열려 있던 옛 탭은 새로고침할 것(옛 화면은 탭 묶음을 모른다)
- **순찰일지 숨김**: 운영 설정에서 숨김 상태 — '점검 · 순찰' 탭 묶음에 보안 기록부만 보인다. 쓰기 시작하면 설정 › 메뉴에서 표시
- **보안교육**: DGR 5명 기록은 KF 교육 이력(2026.09.30) 기준 — 이수증 받으면 각 기록에 파일 첨부 · 이수 등록 페이지 팀 공지 / 제출 확인 · 쓰이지 않은 시험 업로드(edutestcode*) 정리 · 방사선안전관리자 소관 확인
- **SSOP Rev.01**(2026.10.13 시행): 수검 체크리스트 의견의 '확인 필요'(배포 · 개정 교육 기록 등)와 Rev.01 에도 없는 조항(NTAS 경보 · ACISP 8.5.5 · Quarterly Self-Audit 등) — HISTORY §B
- **원문 확인 필요 목록**: SERP 9건 · 위협전화 10건 · 업무 연락처 9건 — 각 화면(hq)에 표시
- **CSS**: `@media (max-width: …)` 에 `screen` 이 없는 34곳 — A4 인쇄 폭(≈718px)에 걸릴 수 있어 인쇄 확인 후 정리
- **공통 도우미**: 모듈마다 비슷한 isISO · uid · telHref · copyText 가 따로 있음(메시지 · 동작이 조금씩 다름) · serp · threat 응대 화면 공통 코드
- **메인 데스크 실사용 확인**: 실제 이수증 · 공문 · 점검 결과 · 처리 보고서 · 대장 스캔으로 판독 품질을 본 뒤 기본값(문서 구분별 기본 선택 · 일정 색 · 미리알림) 조정. 위험물 분야 담당은 비어 있음(화면 '분야별 담당'). 접수 대장 '지우기'는 시스템관리자만 원본까지 지운다(hq 는 기록만 — 원본은 저장소 관리의 연결 없는 파일)
- **저장소 정리**: 판독 시험 파일 3건(`desk/…_zz-test-notice.txt` · `desk/…_zz-test-cert.pdf` · `schedules/…_zz-test-notice.txt`) — 시스템 설정 › 저장소 관리(연결 없는 파일)에서 삭제
- **v1.48 메뉴 저장**: 시스템관리자가 v1.48 로 한 번 접속하면 운영 menus 에서 '메인 데스크' 항목이 지워져 저장된다. 배포 직후 열려 있던 옛 탭은 새로고침
- **정규화 검증 범위(v1.48)**: 운영 자료 전체 사본으로는 확인하지 못함(임시 세션 생성이 권한 정책에 막힘) — 운영 메뉴 구조(SQL 로 이름 · 순서 · 숨김만)로 옛/새 `normalizeData` 비교: 메인 데스크 1건만 빠지고 나머지 61건 · 다른 컬렉션 동일 · 두 번째 정규화 변화 없음
- **아르고 운영(v1.49)**: 실사용에서 답 품질 · 사용량을 보고 안내 지식(docs/ARGO-GUIDE.md) · 한도(settings `argo`) 조정. 아르고로 반영한 뒤 되돌린 기록의 첨부 원본은 저장소에 남는다(시스템 설정 › 저장소 관리 '연결 없는 파일'에서 정리). 테스트 TR12 · ED04 는 jsdom 시간 의존이라 가끔 한 번 실패 — 다시 돌리면 통과
- **아르고 운영 확인(10-10)**: 임시 계정 user 1 · hq 1 로 실서버 시나리오 11개 통과 — user: 사용법 · 용어(ACAS RFS/DNL 등) · 메뉴 찾기 · 보안등급 현황 · 쓰기 요청 거절 / hq: 이번 주 일정 + 만료 임박 교육 · 일정 등록 → 되돌리기(서버 반영 · 원복 SQL 확인) · 지우기 확인 카드 → 삭제 · 이수증 사진 → 새 인원 + 이수 기록 + 다음 이수 일정 + 원본 보관 → 되돌리기 · 지적사항 + 기록부 누락 · 계정 만들기 요청 거절. 시험 자료 삭제 확인(`semis_logi_store` 에 흔적 없음). 임시 계정 `zz-argo-user` · `zz-argo-hq` 는 **비활성 · 세션 삭제 · 사용량 행 삭제**(계정 행은 남김 — 다시 쓸 때 disabled=false + 새 암호). hq 는 저장소 파일을 지울 수 없다(파일 삭제는 시스템관리자) → 되돌린 첨부 원본은 시스템관리자가 저장소 관리에서 정리. 답 길이 · 내부 동작 언급 금지 지침은 Edge v2 에서 보강(평균 응답 3~7초)
- **부엉이 3D**: 48px 이상 자리(패널 머리 · 빈 화면)만 3D — 첫 사용 때 three.js(약 0.6MB, 대시보드 3D 와 같은 파일) 로드. 렌더러 하나를 나눠 쓰고 30fps · 화면 밖/숨은 탭 정지 · 평균 28ms 넘으면 모두 SVG
- **AI**: 문서 판독은 `semis-logi-files`(desk-read)가 한다. `semis-logi-ai` 요약 함수는 부르는 화면 없음 — 쓰지 않으면 정리 대상

## 8. 작업 기록 (최근 — 전체는 HISTORY.md §C)

| 버전 | 날짜 | 내용 |
|---|---|---|
| v1.49.0 | 10-10 | **아르고 AI 도우미** — 지원 카드 · 상단바 · `#/argo` → 공통 패널 대화. Edge `semis-logi-argo`(Claude 프록시 · 세션 · 등급별 도구 · 캐시 · 대화 저장 없음) + SQL `argo_usage`(계정별 하루 200회, Mark 결정). 도구 12종(찾기 · 현황 · 자료 목록 · 등록 목록 / hq: 일정 등록 · 수정 · 완료 · 삭제 · 공지 · 이수 기록 · 서가 보관 · 수검 지적) — 브라우저 실행 · 바로 실행 + 결과 카드 + 항목 단위 되돌리기 · 지우기 · 여러 건 확인. 첨부(사진 1600px · PDF 4.5MB · 워드 · 한글 · 엑셀 · PPT 글) · 원본은 반영 때 대상 폴더(hq, Mark 결정). 일정 쓰기는 화면과 같게 hq 이상(Mark 결정). 안내 지식 docs/ARGO-GUIDE.md. axe 0 · 1440/390 넘침 0. 테스트 AR01~AR14 (553 통과). 운영 확인 시나리오 11개(user · hq 임시 계정, 시험 자료 삭제 · 계정 비활성) |
| v1.48.0 | 10-10 | **디자인 '화물 태그'(B안) · 지원 카드 · 공통 패널 · 아르고** — 허브 패널 맨 위 지원 카드(검색 · 메인 데스크 배지 · 아르고, 권한별) · 패널 접힘/태블릿/모바일은 상단바 아이콘 · 공통 패널 모달 `SeMIS.ui.panel`(dialog · Esc · 바깥 누르기 · 포커스 가두기 · 스크롤 잠금 · 열고 닫는 움직임 · 야경 실루엣 · 모바일 전체 화면 · 더보기 시트 · A4 Print) · 통합 검색과 메인 데스크를 패널로(메뉴 · 라우트 화면 제거, `#/desk` 는 대시보드 위 패널, 끌어다 놓으면 보던 화면 그대로) · 검색어 없을 때 허브별 메뉴 · 제목에 검색어가 모두 있으면 위로 · 부엉이 경비대원 아르고(로우폴리 3D + 같은 모양 SVG, 상태 4종) · 탭 · 세그먼트 · 메뉴 선택 · 배지 · 표 머리 · 폼 모달에 태그 문법 · 모바일 요약 띠 키보드 스크롤. axe WCAG 2.1 AA 12 화면 0건. 테스트 UI01~UI06 · DK12 (539 통과) |
| v1.47.1 | 10-09 | 사진 머리말(허브 배너) 위 글자 버튼(`head-link` — 폴더 관리 · 분야별 담당 등)이 어두운 사진에 묻히던 것 → 밝은 글자(모바일 흰 머리말은 그대로) |
| v1.47.0 | 10-09 | **메인 데스크** — 홈 허브 첫 메뉴 · 머리말 버튼(hq). 문서 올리기(어느 화면에서나 끌어다 놓기 · 모바일 촬영) → AI 판독(Edge `desk-read`, 워드 · 한글 · 엑셀 · PPT 는 화면이 글 추출) → 반영안 확인 · 수정 → 반영(이수 기록 + 다음 이수 기간 일정 · 일정 · 전파교육 · 수검 지적 · 처리 대장 · 하드카피 집계 · 문서 서가) · 보관만 · 접수 대장. 서버: 권한표 desk 3/3 · 폴더 desk 3/3 · op copy. 테스트 DK01~DK11 (532 통과) |
| v1.46.0 | 10-09 | **ARGOS** — 이름 변경(화면 · 인쇄 · 이수 등록 페이지) · 메뉴 2판(탭 묶음 5 · 협력사 → 화물 보안 · 계약 → 규정 · 문서 · 이름 정리 · 현황판 · CAR 삭제 · 예정만 있는 허브 숨김) · 모듈 템플릿 사고 보고로 · 인계서 정리(지난 기록 HISTORY.md) |
| v1.0.x | 09-14 | 사이트 구축 · 배포, 관리자 암호(v2 운영 해시) 반영 |
| v1.1.0 | 09-17 | 일정 담당자 관리(시스템 설정), A4 인쇄 버튼 전 화면 |
| v1.2.0 | 09-17 | 담당자 다중 선택, 구글캘린더 설정 이관, 가독성 개선 |
| v1.3.0 | 09-17 | 일정 유실 사고 대응 — 대량 삭제 방어 · 서버 변경 이력 · 복원 UI (7건 재구성 복구) |
| v1.4.0 | 09-20 | 메뉴 숨기기 (권한과 별개) |
| v1.5.0 | 09-20 | 암호 관리 (v2 vault 이식, 해제 UI 개편, 제목 정렬) |
