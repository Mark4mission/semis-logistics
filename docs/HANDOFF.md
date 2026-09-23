# SeMIS · Logistics — 세션 인계서

> 새 세션은 이 문서부터 읽는다. 작업이 끝날 때마다 **§4 모듈 현황**과 **§8 작업 기록**을 갱신한다.

## 1. 현황

| 항목 | 값 |
|---|---|
| 현재 버전 | **v1.12.1** (2026-09-23) — 첨부 뷰어(공지·일정 메모·회의록 파일/이미지 미리보기 · 원래 이름 내려받기) |
| 접속 주소 | https://mark4mission.github.io/semis-logistics/ |
| 저장소 | GitHub `Mark4mission/semis-logistics` (공개) · Mac `~/SeMIS_Logistics` |
| 테스트 | `npm test` 226건 전부 통과 (코드·문서에 암호 평문·CARES 키 없음) |
| 백엔드 | Supabase `mzyuzrxkdcpzxojenwat` — 테이블 `semis_logi_store`, 버킷 `semis-logi-files` |

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
   (컨테이너 Chromium은 github.io 접속 불가)

## 4. 모듈 현황

**완료**

| 라우트 | 파일 | 권한 | 비고 |
|---|---|---|---|
| dashboard | modules.js · hero3d.js | all | 화물 태그 카드(무재해·보안등급) + 3D 장면(에어제타 B747-400F 기수 화물문 탑재) · 하단 4칸(다가오는 일정 · 공지 · 결정사항 · 모듈 구축 현황) |
| schedule | calendar.js | mgr | 담당자 다중 지정 · 드래그 이동 · 등록 폼 2단(입력/설정) · 12색 |
| minutes | minutes.js | mgr | 회의록 + QR 참석 서명 |
| reg-sec · reg-safety · reg-dg | regulations.js | mgr (편집 hq) | 규정 3종 · PDF 뷰어 · 개정 아이디어 노트 |
| contacts | contacts.js | mgr (편집 hq) | 비상연락망 · 보고체계 (2026-09-22 SeMIS v2 연락망 69건 이관 — 12섹션 78행) · **보고 체계도 탭**(v1.10: 보안사고 20 · 안전사고 18 · 위험물사고 29행, 미리보기 → 전체 화면 뷰어) |
| vault | vault.js | hq | 암호 관리 (AES-256-GCM, 5분 자동 잠금, 공용/개인용 — 개인용은 본인 키로만 해독) |
| settings | modules.js | admin | 메뉴(숨기기 포함) · 사용자 · 담당자 · 데이터(변경 이력 복원) · 저장소 |
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

SeMIS v2에 같은 성격의 모듈이 있으면 이식한다(v2 저장소: Mac `~/SeMIS_v2`, 연결 폴더라 `device_bash`로 바로 읽기 가능).
v2 대응: inspection.js · carcap.js · training.js · certs.js · contracts.js · equipment.js · passes.js 등.

## 5. 데이터 · 백엔드

- **SYNC_KEYS(18)**: menus · notices · schedules · assignees · assigneesSeeded · minutes · minuteFolders · levelHistory · safetyBoard · contacts · pwOverrides · userOverrides · customUsers · gcal · chatRooms · vault · regulations · equipment
- SYNC_KEYS 밖 설정 행: `caresCfg`(CARES Firebase 웹 키 — `SemisSync.fetchKV`로만 읽음, 앱이 쓰지 않음)
- 신규 컬렉션 추가 시: `freshData()` 기본값 → `normalizeData()` 보정(멱등) → `sync.js` SYNC_KEYS → 테스트 Y01 기대 문자열 갱신
- **대량 삭제 방어**(sync.js `guardWipe`): 2건 이상 → 0건 push 차단. 정상 전체 삭제는 `SemisSync.confirmWipe(key)`
- **서버 자동 백업**: 트리거가 모든 변경 직전 값을 `public.semis_store_history`에 90일 보관 → 시스템 설정 › 데이터 관리 › 변경 이력에서 복원
- 규정 PDF: `semis-logi-files/regs/` (공개 URL). 2026-09-20 등록 18건(안전관리 16 · DG 2)
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
10. **모달 버튼줄**: 저장·취소처럼 자주 누르는 조작(완료 체크 포함)은 스크롤되는 본문이 아니라 하단 `.modal-actions`에 둔다

## 7. 미결 · 주의

- 기본 계정 초기 암호가 공개 저장소 git 이력에 남아 있으나, 2026-09-21 네 계정 모두 운영 암호로 변경 완료(`pwOverrides` 확인). 코드·테스트에 평문 재유입 금지
- 커스텀 도메인 미설정 (추후 `logistics.semis.pe.kr` CNAME 가능)
- CARES Mobile 배포 주소 링크 미등록
- 연락망 이관(2026-09-22): SeMIS v2 `semis_store.contacts`에서 안전보안실 28 · 국토부 항공보안정책과 8 · 서울지방항공청 보안과 16 · 비상안전기획관실 3 · 대테러센터·국가위기관리센터 4 · 서면보고 이메일 10을 복사(두 시스템은 이후 따로 관리). 이관 직전 값은 `semis_store_history` id 112. 서면보고 섹션의 v2 비고("지점 내 별도 유지…")는 지점 기준 문구라 옮기지 않음
- 인천화물팀 안전보안파트 · 인천화물팀 · 인천공항공사 섹션은 아직 비어 있음(v2에 대응 자료 없음). 체계도 3종의 연락처는 `contacts.flows`에 따로 있음
- **보고 체계도(v1.10)**: 데이터 `contacts.flows[]` = { id, title, short(탭 이름), ver, steps(한 줄에 한 단계), memo, fileUrl, imgUrl, thumbUrl, rows[{grp, role, office, mobile, note}] }. 파일은 `semis-logi-files/contacts/flow-{sec|saf|dg}-2609.{pdf,webp}`(+`-thumb.webp` 640px, 원본 1800px). 반영 직전 값은 `semis_store_history` id 116. 개정판이 오면 화면의 ✎ 편집에서 PDF·이미지만 바꾸면 됨(PDF만 새로 올리면 옛 이미지는 자동으로 떼어 PDF 뷰어로 표시)
- 체계도 원문 차이: AAP탑재 번호가 안전사고 체계도는 744-5470, 위험물 체계도는 270-5470 — 원문대로 각각 입력. 원문의 7자리 번호는 032 지역번호를 붙여 저장, 해외 번호(TSOC·IIR in SIN)는 +1·+65 국제 형식
- **링크 묶음(v1.12.2)**: 링크 메뉴에 `open:"group"` 을 주면 묶음, 하위 링크는 `parent` 가 그 링크의 id. 허브를 늘리지 않으려고 링크 안에 한 단계만 둔 구조라 `hubOf` 가 허브가 아닌 값을 돌려준다 — 허브 목록(`hubEntries`)·레일에서 자동으로 빠지고, 빵부스러기·레일 강조는 `hubOfDeep` 로 상위를 따라 올라간다. 라우트 `#/links/<id>`. 사내망(10.31.61.163) 주소는 https 화면에서 iframe 이 막히므로 하위 링크는 새 탭 방식으로 등록했다. SCAN 하위 4건(파트별 박스)은 사람 이름이라 공개 저장소 코드에 넣지 않고 공용 DB `semis_logi_store.menus` 에만 등록
- **첨부 뷰어(v1.12.1)**: `js/files.js` 가 문서 전체에서 `a.nb-file` · `.nb-file > a` · 본문 이미지(.nb-editor/.notice-html/.ag-memo/.cn-rich) 클릭을 가로채 `<dialog id="fv-viewer">` 로 연다. 저장소 경로는 한글이 `_` 로 바뀌어 있어 이름은 칩 글자(또는 img alt)에서 얻는다. 규정 모듈의 PDF 뷰어는 자체 모달을 그대로 쓴다(변경 없음). DOCX·HWP 등은 미리보기 불가 — 외부 문서 뷰어(Microsoft/Google)로 보내면 내부 문서 주소가 외부로 나가므로 쓰지 않았다
- **CARES 연동(v1.12)**: `js/cares.js` 한 곳에서 Firestore REST로 **읽기만**(equipments · repairLogs · inspectionLogs · sensorLogs · sensorThresholds — 공개 읽기 규칙). deployLogs · locationStates는 로그인 전용이라 안 씀 → 배치는 `equipments.location`("X-ray n호기" · "환적화물" · "예비"). repairLogs 사진이 data URL이라 목록은 `select` 투영(2.3MB→80KB), 사진은 상세에서 1건만. 읽기량을 줄이려고 세 묶음으로 캐시 — live(장비·센서 12건·오늘 점검, 60초) · repairs(고장·임계치, 10분) · history(45일 점검·정기점검, 15분 — 보안검색 현황·검색장비 화면에 들어올 때만). 자동 새로고침은 5분마다 live만(보안검색 현황·대시보드를 보고 있고 탭이 보일 때). 대시보드는 history를 읽지 않는다. CARES Firebase 요금제(무료 한도 여부)는 확인하지 못했음 — 읽기량이 문제되면 자동 새로고침 주기(screening.js DASH_PARTS 타이머)부터 늘릴 것. 키: 공용 DB `caresCfg` → `localStorage semisl:caresKey`(400/403이면 삭제 후 재조회). CARES 쪽 컬렉션 규칙이 바뀌어 403이 나면 화면은 "CARES 연동 불가"와 재시도 버튼, 대장은 그대로 표시
- 대장 이관(2026-09-22): SeMIS v2 `semis_store.equipment` 22대(X-ray 3 · ETD 5 · WTMD 4 · HHMD 10, 모두 인천 화물터미널 B동)를 `semis_logi_store.equipment`로 복사(이후 따로 관리). 유지보수 계약 · 비용 · 대금 청구(`equipMaint` · `billing`)는 옮기지 않음 — v2 항공보안파트 업무
- 2026-09-22 CARES 실데이터에서 확인한 점(화면에 그대로 드러남): X-ray 일일점검이 3일에 한 번 기록 없음(09-15 · 18 · 21 — ETD만 점검, 이행 64%) · 주간 점검 최근 기록 08-27(26일 경과) · X-ray 월간 점검 최근 07-30 · ETD 보호케이스 CO₂(2,000ppm↑)·TVOC(1mg/㎥↑), 입구 HCHO(0.1↑) 기준 초과
- 화물 보안검색 '실적'(X-ray·ETD·개봉검색 건수 · 미검색 사유)은 CARES·v2 어디에도 데이터가 없어 넣지 않았다 — 현장 실적 서식을 받으면 scr-status에 입력 탭으로 추가
- **개정 PDF 반자동 반영(v1.11)**: 체계도 ✎ 편집 → PDF 올리기 → `js/flowpdf.js`가 pdf.js(`assets/vendor/pdfjs/`, 4.10.38 legacy, Apache-2.0, 필요할 때만 불러옴)로 1쪽 글자·위치를 읽어 번호·라벨을 뽑고 등록 행과 대조(그대로 · 바뀜[이름/위치] · 빈 칸 채움 · 새 번호[구분 추정] · PDF에 없음) + 1쪽을 WebP 1800/640px로 만들어 자동 업로드. 사용자가 고른 항목만 행에 반영(강조 표시) → 저장. 대조 키는 번호 숫자 끝 7자리 이상 일치(032 생략 표기 대응). 이름(기관명) 변경은 감지하지 않음 — 번호 기준. 스캔 PDF(글자 없음)는 안내만. 실PDF 3종 재업로드 시 오탐 0 확인
- `normalizeData`는 `contacts.flows`를 만들지 않는다(구버전 데이터에 빈 배열을 넣으면 동기화 push가 생김) — contacts.js가 없으면 빈 목록으로 읽음
- 3D 장면: GPU 없는 PC(소프트웨어 렌더링)·느린 PC(평균 45ms/프레임 초과)·동작 줄이기 설정에서는 정지 화면, WebGL 없으면 사진. 사진이 보이면 대시보드에서 `document.querySelector('#dash-3d').dataset.h3d`로 사유 확인(no-webgl · webgl-context · load · live · static)
- 2026-09-22 v1.9.0 배포 직후 Mark의 Chrome에서 3D 대신 사진이 보였음 — 같은 Mac의 내장 브라우저에서는 3D 정상(Apple M4 Pro, Metal). 배포 전 요청한 three.js 404가 CDN에 남은 것으로 추정해 v1.9.1에서 주소에 버전을 붙임. 재발 시 위 사유 값과 chrome://gpu의 WebGL 항목 확인

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
| v1.9.1 | 09-22 | 한글 어절 단위 줄바꿈(전역 keep-all) · 대시보드 하단 시트 칸 수를 시트 폭으로 결정(container query, 1040px↑ 4칸) · 일정 폼 '완료'를 하단 버튼줄로(스크롤 없이 보임) · 오른쪽 설정 패널 압축(1512×825에서 스크롤 없음) · 3D 불러오기 주소에 버전 부여(배포 직후 옛 404 캐시 회피)·실패 사유 기록(`#dash-3d[data-h3d]`) |
