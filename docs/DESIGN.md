# SeMIS · Logistics — 설계서 (v1.0)

인천화물팀 안전보안파트의 **화물터미널 현장 안전·보안 관리 정보시스템**.
SeMIS v2(항공보안파트)의 검증된 플랫폼 구조를 그대로 이어받되, 데이터·메뉴·디자인 팔레트를 완전히 분리한 **독립 사이트**로 구축한다.

## 1. 목표와 범위

| 구분 | 내용 |
|---|---|
| 1차 목표 (본 릴리스) | 로그인·권한·메뉴 엔진·시스템 설정·실시간 동기화·대시보드·공지·일정·회의록·비상연락망·통합검색까지 **플랫폼 골격** 완성 |
| 2차 이후 | 화물보안·안전관리·점검·교육·협력사 등 업무 모듈을 **한 개씩 모듈(js 파일 1개) 단위로 추가** |
| 비범위 | SeMIS v2 데이터 이관(두 시스템은 독립 운용), CARES 실데이터 연동(링크만) |

## 2. 아키텍처

- **정적 SPA** (HTML + CSS + Vanilla JS, 빌드 도구 없음) — SeMIS v2와 동일. 어떤 정적 호스팅에서도 동작.
- **파일 구성**

```
SeMIS_Logistics/
├── index.html          앱 셸 (로그인 모달 · 헤더 · 사이드바 · 메인)
├── css/main.css        디자인 시스템 (Logistics 팔레트, Section Kit ds-*)
├── js/app.js           코어: 인증(SHA-256) · 저장소/정규화 · 메뉴 엔진 · 권한 · 라우터
├── js/modules.js       대시보드(공지·현황판) · 시스템 설정(메뉴/사용자/데이터/저장소) · 예정 모듈 안내
├── js/calendar.js      일정관리 (SeMIS v2 이식)
├── js/minutes.js       회의록 게시판 + 참석 QR 서명 (SeMIS v2 이식)
├── js/qr.js            순수 JS QR 인코더 (SeMIS v2 이식)
├── js/contacts.js      비상연락망·보고체계 (SeMIS v2 이식, 화물팀용 재구성)
├── js/search.js        전역 통합 검색 (Ctrl+K)
├── js/sync.js          Supabase 공용 DB 실시간 동기화 (semis_logi_store)
├── tests/run-tests.cjs jsdom 테스트
├── tools/bump-version.cjs 버전 스탬프
└── docs/DESIGN.md      본 문서
```

- **모듈 규약** — `SeMIS.registerModule(id, { title, render(root) })`. 메뉴 항목 `{type:"module", module:id}`가 라우트 `#/id`와 연결. 신규 모듈 추가 체크리스트는 README 참조.
- **예정 모듈(planned)** — 메뉴 항목에 `planned:true, desc`를 두면 라우트가 "준비 중" 안내 화면을 렌더한다. 실제 모듈 js가 등록되는 순간 자동으로 실화면으로 대체(멱등).

## 3. 데이터

- **저장소**: Supabase 프로젝트 `semis-v2`(mzyuzrxkdcpzxojenwat, 서울) 안에 **별도 테이블** `public.semis_logi_store`(key, value jsonb, updated_at, updated_by) + **별도 버킷** `semis-logi-files`. SeMIS v2의 `semis_store`와 완전히 분리되어 서로 영향 없음.
- **동기화**: 컬렉션 단위 KV. 로컬 `localStorage semisl:data` 오프라인 폴백 + pending 큐 + Realtime(폴링 폴백). SeMIS v2 sync.js와 동일 알고리즘.
- **컬렉션(SYNC_KEYS)**: menus · notices · schedules · assignees · assigneesSeeded · minutes · minuteFolders · levelHistory · safetyBoard · contacts · pwOverrides · userOverrides · customUsers · gcal · chatRooms(예약)
- **개인정보 원칙**: 연락처·명단은 코드에 시드하지 않고 공용 DB에서만 동기화 (저장소가 공개 저장소이므로).

## 4. 계정·권한

| 역할 | rank | 설명 |
|---|---|---|
| admin (시스템관리자) | 4 | `mark3464` — 시스템 설정. 권한 변경·삭제 불가(잠금 방지) |
| hq (안전보안파트) | 3 | 파트원 — 시스템 설정 외 모든 기능(편집) |
| manager (화물팀 관리자) | 2 | 팀 관리자·현장 감독자 — 관리 항목 열람, 편집 불가 |
| user (일반사용자) | 1 | 화물팀 직원·조업사 — 일반·안내 수준 열람 |
| vendor (협력업체) | 1/3 | 업체별 허용 라우트 화이트리스트(`VENDOR_ACCESS`) — 초기 비어 있음 |
| signer (서명 참석자) | 0 | 회의록 QR 서명 전용 세션 |

- 로그인은 **암호만 입력**(암호로 사용자 식별). 암호는 `SHA-256(SALT + ":" + pw)` 해시로만 코드·DB에 보관.
- 기본 계정: `mark3464`(admin, SeMIS v2와 동일 암호) · `cargo-ss`(hq) · `cargo-mgr`(manager) · `cargo-user`(user). 초기 암호는 별도 전달, 접속 후 변경 권장.
- 메뉴 접근 `vis`: all / mgr(관리자 이상) / hq(파트원 이상) / admin.

## 5. 메뉴 체계 (초기 시드)

```
🏠 대시보드                 all
📅 일정관리                 mgr
🗒️ 회의록 게시판            mgr
📊 안전보안 현황판          mgr   (planned — KPI·무재해·점검 지표 통합)
📂 규정 / 기준
   📘 항공보안 규정          all   (planned — 국가·자체 보안규정, 화물보안 기준)
   🦺 안전관리 규정          all   (planned — 산업안전·지상안전·SMS)
   ☢️ 위험물(DG) 기준         all   (planned)
📂 화물 보안
   🔎 화물 보안검색 현황      mgr   (planned — 일일 검색 실적·미검색 사유)
   🏷️ 상용화주(KC)·RA 관리    hq    (planned)
   🔧 보안검색장비 유지관리   mgr   (planned — X-ray·ETD, CARES 연계)
   🪪 보안구역 출입 관리      mgr   (planned)
📂 안전 관리
   ✅ 일일 안전점검          mgr   (planned)
   ⚠️ 위험성 평가            hq    (planned)
   🚨 사고·아차사고 보고      mgr   (planned)
   🚜 지상조업(GSE) 안전      mgr   (planned)
📂 점검 / 시정조치
   🕵️ 안전보안 점검 일정      mgr   (planned)
   📋 부적합·시정조치(CAR)    hq    (planned)
📂 교육 / 훈련
   🎓 안전보안 교육 관리      mgr   (planned)
   🎖 이수증 관리            mgr   (planned)
📂 협력사 / 조업사
   🤝 조업사·협력사 현황      mgr   (planned)
   💼 계약서 관리            hq    (planned)
📂 비상 대응
   ☎️ 비상연락망 · 보고체계    mgr   (모듈)
📂 참고 / 링크
   🛡️ SeMIS v2 (항공보안파트)  링크 https://semis.pe.kr
   🛰 CARES (보안장비 관제)     링크 https://airzeta-security-system.web.app
   📱 CARES Mobile             링크 (배포 주소 확인 후 등록)
   🛫 인천공항 화물터미널      링크 https://www.airport.kr
   📰 보안뉴스                 링크
⚙️ 시스템 설정              admin
```

메뉴 첨삭·순서·권한은 시스템 설정 → 메뉴 관리에서 운영자가 직접 조정하며, 외부 웹주소는 링크 메뉴(새 탭 / 내부 프레임)로 등록한다.

## 6. 디자인 (v1.0 — v1.8부터 §9 로 대체)

- **톤앤매너**: SeMIS v2와 같은 문법(다크 사이드바 · 흰 카드 · 필 헤더 · 라운드 패널 · 번호/체크 리스트)을 유지하되 **팔레트를 딥 페트롤(짙은 청록) + 틸 + 앰버 포인트**로 바꿔 한눈에 구분.

| 토큰 | SeMIS v2 | Logistics |
|---|---|---|
| 사이드바/헤더 | 네이비 #0f172a | 딥 페트롤 #0b1f26 → #103744 그라디언트 |
| Primary | 블루 #1d4ed8 | 틸 #0f766e (dark #115e59, soft #e6f5f2) |
| Accent | 스카이 #0ea5e9 | 앰버 #f59e0b (화물 라벨·주의 포인트) |
| Section Kit 계조 | 네이비→블루 | 페트롤 #0b2a33 → 틸 #14b8a6 |
| 배경 | #f4f6fa | #f3f6f6 (쿨 뉴트럴) |

- 글꼴 Pretendard Variable(jsdelivr CDN, 차단 시 시스템 글꼴 폴백). 기준 16.5px, 최소 .75rem.
- 로그인 화면: 페트롤 그라디언트 + 미세한 격자 패턴, 카드 라운드 18px. 브랜드 "SeMIS **Logistics**".
- 활성 메뉴는 틸 배경 + 좌측 앰버 인디케이터. 예정 모듈은 옅은 `예정` 태그.
- 반응형: 900px 이하 사이드바 오버레이, 대시보드 1열.
- **가독성 기준(v1.2)**: 기준 글꼴 17px·줄간격 1.62, 보조 문구 .81rem 이상, 보조 글자색은 `--text-2`/`--text-3`(대비 4.5:1 이상), 경계선은 `--border`/`--border-strong` 두 단계만 사용. 사이드바 글자 .95rem·그룹 라벨 .8rem으로 키우고 안내 문구는 2줄 이내로 유지.

## 6-1. A4 인쇄 (전 화면 공통 규칙)

모든 화면(대시보드·업무 모듈·예정 모듈 안내·시스템 설정)에 **A4 보고용 인쇄 버튼**을 둔다. 외부 링크 메뉴만 예외.
코어가 화면 머리말에 버튼을 자동으로 붙이므로 모듈은 별도 구현이 필요 없다(`SeMIS.attachPrintBtn` / `SeMIS.printView`).
인쇄 시 헤더·사이드바·조작 버튼이 빠지고, 문서 머리말(시스템명 · 화면명 · 출력일시 · 출력자)이 자동으로 붙는다(A4 세로, 여백 12/10/14mm).

## 6-2. 일정 담당자 (다중 지정)

담당자 목록은 `DATA.assignees`(시스템 설정 → 담당자 관리, 시스템관리자 전용). 일정 하나에 여러 명 지정 가능하며
저장은 `", "` 로 이어 붙인 문자열(`schedule.assignee`)이라 1명 기준의 기존 데이터·검색·ICS와 호환된다.
구글 캘린더 연동(API 키·ICS)은 일반 사용자에게 필요 없어 **시스템 설정 → 데이터 관리**로 이관했다.

## 6-6. 규정 관리 (v1.6)

`js/regulations.js` 하나가 `reg-sec` · `reg-safety` · `reg-dg` 세 라우트를 등록하고, 데이터는 `DATA.regulations[]`의 `scope`로 구분한다
(`sec` | `safety` | `dg`). SeMIS v2 `regulations.js`에서 이식하며 바꾼 점:

- 구분을 2종(intl/own) → 3종(sec/safety/dg)으로, 메뉴 라우트와 1:1 대응
- `lang` 필드 추가 — 같은 교범의 국문·영문본을 한 목록에서 구분
- 정렬을 개정일 역순 → **관리번호 → 제목** 순으로 (사내 문서번호 체계가 기준)
- 신구대조표 첨부를 전 구분에서 사용 가능하게
- 설명 문구 축약, 수정 열은 `no-print`

PDF는 `semis-logi-files/regs/` 버킷에 올라가고 공개 URL로 열람한다. 25MB 초과 시 등록이 거부된다.
초기 등록분(2026-09-20): 안전관리 14건 · 위험물(DG) 2건 — 화물서비스팀 교범·절차서 국·영문본.

## 6-5. 암호 관리 (v1.5)

`js/vault.js` — SeMIS v2 vault 이식본. 데이터는 `DATA.vault = { v, members[], data, updated }` 이며 SYNC_KEYS에 포함되지만
서버에는 암호문만 올라간다.

| 항목 | 값 |
|---|---|
| 대칭 암호 | AES-256-GCM (iv 12B, base64 보관) |
| 키 유도 | PBKDF2-SHA256 310,000회, salt 16B (멤버별) |
| 구조 | 엔벨로프 — vaultKey(32B)가 데이터, 멤버 KEK가 vaultKey를 래핑 |
| 세션 | 메모리 전용, 5분 자동 잠금 + 대시보드 이동, 라우트 이탈 시 즉시 키 제로화 |
| 권한 | 메뉴 vis `hq`, 렌더 시 `roleRank() < 3` 차단 |
| 정렬 | 기본 제목 오름차순, 헤더 클릭으로 키·방향 전환 |
| 인쇄 | `beforeprint`에 `.v-mask` 전부 재마스킹 |

v2와의 차이: 구버전 구글시트 연동 제거, 해제 UI 개편(멤버 칩·눈 아이콘·Caps Lock 안내·흔들림 피드백), 정렬 기본값을 제목으로 변경.

## 6-4. 메뉴 숨기기 (v1.4)

메뉴 항목의 `hidden: true` 한 필드로 동작한다. 권한(`vis`)과 직교하는 별도 축.

| 구분 | 판정 | 적용처 |
|---|---|---|
| 권한 | `canSee(menu)` — vis 대 roleRank | 라우트 접근 게이트 (변경 없음) |
| 숨김 | `menuHidden(menu)` — 본인 또는 상위 그룹의 `hidden` | — |
| 화면 노출 | `navVisible = canSee && !menuHidden` | 사이드바(일반·협력업체) · 통합검색 · 대시보드 바로가기/로드맵 |

- 숨겨도 `#/module` 직접 접근은 허용된다("기능을 없애지 않는다"는 요구사항).
- `dashboard` · `settings`는 `canHide()`가 false — 토글 버튼이 없고 `normalizeData()`가 `hidden`을 지운다.
- `hidden`은 true일 때만 저장하고 해제 시 필드를 삭제해 정규화가 멱등이다.

## 6-3. 데이터 보호 (v1.3)

| 계층 | 위치 | 동작 |
|---|---|---|
| 대량 삭제 방어 | `js/sync.js` `guardWipe()` | 스냅샷 대비 배열이 2건 이상 → 0건이면 push 차단·로컬 롤백·경고. `SemisSync.confirmWipe(key)`로 1회 허용, forcePush(백업 복원)는 우회 |
| 서버 자동 백업 | Supabase 트리거 `semis_store_snap` / `semis_logi_store_snap` | UPDATE/DELETE 직전 값을 `public.semis_store_history`(src·key·old_value·건수·시각·변경자)에 보관, 90일 보관 |
| 되돌리기 | 시스템 설정 → 데이터 관리 → 변경 이력 | `SemisSync.history()` / `restoreHistory(id)` — 해당 시점 값으로 복구 후 서버 반영 |

사고 기록: 2026-09-17 07:44:34Z `semis_logi_store.schedules`가 `[]`로 덮여 7건 전량 유실.
단일 키만 기록되어 백업 복원(forcePush) 경로가 아닌 **로컬 배열이 비워진 채 push된 경로**로 확인.
로컬·디스크·DB 어디에도 직전 값이 남아 있지 않아(트리거 도입 전) 인쇄 PDF·화면 캡처로 재구성 복원했다.

## 7. 배포

- GitHub `Mark4mission/semis-logistics` → GitHub Pages(main, root). 주소 `https://mark4mission.github.io/semis-logistics/`.
- 커스텀 도메인은 추후 `logistics.semis.pe.kr` CNAME(가비아 DNS) 등록 시 `CNAME` 파일 추가로 전환 가능.
- 릴리스: `npm run bump <ver>` → 테스트 → `git push`(main push 시 자동 반영).

## 8. 테스트

- `tests/run-tests.cjs`(jsdom): 코어(해시·로그인·권한·메뉴 시드·정규화 멱등·라우팅·설정 화면·예정 모듈 안내), 동기화(SYNC_KEYS·canon·mergeById), 이식 모듈 렌더 스모크, 버전 스탬프 검사.


## 9. 디자인 개편 v1.8 — "Terminal Calm"

2026-09-21. 메뉴가 29개로 늘어 사이드바가 화면 1.8배(약 1,600px)가 되고, 준비 중 메뉴 15개가 운영 메뉴 사이에 섞여
찾기 어렵던 문제를 해결하고, 앞으로 모듈을 하나씩 추가해도 화면이 저절로 정돈되도록 구조를 바꿨다.
시안: Claude Design 캔버스 "SeMIS Logistics 리디자인" (https://claude.ai/artifact/K4bh5sj4RESznSZXLAVMGc).
적용 기준: Impeccable(craft-floor·operate), Taste Skill(redesign-existing-projects), Emil Kowalski(design-eng) 스킬.

### 9-1. 정보구조 — 6개 업무 허브

| 허브(id · 아이콘) | 메뉴 |
|---|---|
| 홈 (`hub-home` · home) | 대시보드(항상 첫 항목) · 일정관리 · 회의록 게시판 · 안전보안 현황판(예정·숨김) |
| 화물 보안 (`hub-sec` · scan) | 화물 보안검색 현황 · 상용화주·RA · 검색장비 유지관리 · 보안구역 출입 |
| 안전 관리 (`hub-saf` · hardhat) | 일일 안전점검 · 위험성 평가 · 사고·아차사고 · 지상조업(GSE) 안전 |
| 점검 · 교육 (`hub-aud` · clipboard) | 안전보안 점검 일정 · 시정조치(CAR) · 교육 관리 · 이수증 관리 |
| 협력 · 비상 (`hub-ops` · users) | 비상연락망·보고체계 · 조업사·협력사 현황 · 계약서 관리 |
| 규정 · 자료 (`hub-doc` · book) | 항공보안 · 안전관리 · 위험물(DG) 규정 + 바로가기(외부 링크 5) |
| (허브 없음 = 레일 하단 "관리") | 암호 관리 · 시스템 설정 |

- **허브 = 최상위 그룹 메뉴**(`type:"group"`, `ico` = 아이콘 키). 시스템 설정 → 메뉴 관리에서 허브를 추가하면 레일에 자동으로 생긴다(하위 메뉴가 1개 이상일 때만 표시).
- 대시보드는 `parent:null`이지만 `hubOf()`가 항상 홈 허브로 본다(구버전 클라이언트의 `dash.parent=null` 정규화와 충돌하지 않도록).
- 허브가 없는 최상위 항목은 레일 하단 유틸리티로 간다(`utilEntries()`).
- **마이그레이션** `migrateHubs()` — 구버전 그룹(`grp-*`)이 있을 때만 1회 실행(멱등). 구그룹 → 허브 매핑,
  최상위 일정·회의록·현황판 → 홈 허브, 운영자가 만든 항목·숨김·권한·이름·바로가기는 보존, 숨겨 둔 구그룹의 하위는 개별 숨김으로 이어받음, seq는 시드 순서로 재배열.

### 9-2. 화면 구조

| 폭 | 구성 |
|---|---|
| ≥1100px | 레일(80px, 허브 아이콘) + 허브 패널(256px, 현재 허브 메뉴) + 상단바(경로 · 보안등급 · 사용자) + 본문. 상단바 왼쪽 버튼으로 패널 접기(계정별 저장) |
| 768–1099px | 레일 + 본문. 허브를 누르면 패널이 본문 위로 떠서 열림 |
| <768px | 앱바(로고 · 검색 · 보안등급 · 로그아웃) + 하단 떠 있는 탭(홈 · 일정 · 연락망 · 규정 · 전체) + "전체" 메뉴 시트(모든 허브를 세로로) |

- 허브 패널 섹션 순서: 운영 메뉴 → (홈) 고정한 메뉴(`quick`) → 준비 중인 모듈(접기/펼치기, 운영 메뉴가 없으면 기본 펼침) → 바로가기(링크).
- 패널과 모바일 시트는 **같은 마크업**(`#nav-menu .hub`)을 CSS만 바꿔 쓴다. 모든 허브 섹션이 DOM에 있고 데스크톱은 `.hub.on`만 보인다.
- 통합 검색은 Ctrl K(또는 `/`) 팔레트(`#cmdk`). 자주 쓰는 동작이라 애니메이션 없이 즉시 연다.

### 9-3. 디자인 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `--sidebar-bg` | #0b1f26 | 레일 · 모바일 탭 |
| `--ticket-bg` | #0f2a33 | 대시보드 화물 태그 카드 |
| `--primary` / `-soft` / `-dark` | #0f766e / #e1f1ee / #0b5550 | 주 버튼 · 선택 상태 |
| `--accent` / `-soft` | #f59e0b / #fef3dc | 시그널(코드 태그 · 준비 중 · 고정 아이콘) — 한 화면 1~2곳 |
| `--bg` / `--surface` / `--panel-bg` | #f2f4f3 / #fff / #f8faf9 | 바탕 · 카드 · 패널 |
| `--text` / `-2` / `-3` | #0e1a1f / #43535a / #5b6b71 | 본문 · 보조(대비 4.5:1 이상) |
| `--border` / `-strong` | #dfe5e3 / #c9d2cf | 경계선 2단계 |
| 글꼴 | IBM Plex Sans KR (본문·제목) + IBM Plex Mono (숫자·날짜·코드만) | Google Fonts, 실패 시 Pretendard·시스템 글꼴 |
| 모서리 | 16(카드) · 14 · 10(버튼) · 6(배지) | 안쪽일수록 작게 |
| 움직임 | 누름 scale(.97) 160ms · 패널 180ms `cubic-bezier(.23,1,.32,1)` · 모바일 시트 360ms `cubic-bezier(.32,.72,0,1)` · Ctrl K 0ms | `prefers-reduced-motion` 시 0ms |

- 국가 항공보안등급 색: 평시 녹 · 관심 청 · 주의 황 · 경계 주황 · 심각 적 (`.sec-badge[data-level]`, 카드의 5단계 눈금).
- 쓰지 않는 것: 그라디언트 면, 색 막대(border-left) 카드, 카드 안 카드, 제목 위 영문 라벨, 장식용 모노 글꼴, 제목·메뉴의 이모지.

### 9-4. 모듈 화면 키트 (새 모듈은 이것만 쓰면 된다)

| 조각 | 마크업 / API | 비고 |
|---|---|---|
| 머리말 | `SeMIS.ui.head({title, meta, desc, actions})` → `.page-head` | A4 인쇄 버튼 자동 부착 |
| 요약 수치 | `SeMIS.ui.stats([{label, value, sub, tone}])` → `.stat-row` | 한 장의 띠, tone: ok·warn·bad·muted |
| 검색 | `SeMIS.ui.search(id, placeholder, value)` → `.search-field` | 표 위 `.toolbar` 안에 |
| 목록 | `.card` > `.table-wrap` > `table.tbl.tbl-cap` | 코드·날짜 칸은 `.mono` |
| 상태 | `SeMIS.ui.chip(text, tone)` → `.badge-*` | green·amber·red·blue·gray |
| 빈 상태 | `SeMIS.ui.empty(text, actionsHtml)` | |
| 아이콘 | `SeMIS.icon(name, size)` | 키: `SeMIS.ICONS` (허브용 `HUB_ICONS`) |
| 메뉴 배지 | `registerModule(id, { navBadge() })` | 허브 패널 메뉴 옆 숫자 (예: 규정 건수) |

기존 모듈(일정·회의록·연락망·규정·암호)은 같은 클래스(`.page-head`·`.stat-row`·`.card`·`.tbl`)를 써서 토큰 변경만으로 새 디자인을 따른다.
화면 안쪽 버튼의 이모지는 해당 모듈을 손볼 때 선 아이콘으로 바꾼다(점진 정리).
참고 템플릿: `docs/module-template.js` (테스트 H17이 템플릿을 실제로 로드해 동작을 검증한다).

### 9-5. 모듈이 하나씩 늘어날 때 자동으로 바뀌는 것

1. `registerModule(id)` 순간 → 허브 패널에서 '준비 중인 모듈' → 운영 목록으로 이동, `예정` 태그 제거
2. 대시보드 '모듈 구축 현황'의 허브 막대 증가 (허브 행을 누르면 그 허브 패널이 열림)
3. 모바일 전체 메뉴 시트 · 하단 '규정' 탭(허브 첫 운영 모듈) 자동 반영
4. A4 인쇄 버튼 · 권한(vis) · 숨김(hidden) · 통합 검색(메뉴) 자동 적용
5. 예정 안내 화면은 같은 허브의 다른 메뉴(운영 중/준비 중)를 함께 보여 준다

### 9-6. 모듈 구축 순서 (제안)

| 단계 | 모듈 | 근거 |
|---|---|---|
| 1 | 시정조치(CAR) · 안전보안 점검 일정 · 교육 관리 · 이수증 | SeMIS v2 `carcap.js`·`inspection.js`·`training.js`·`certs.js` 이식 — 점검·교육 허브 완성 |
| 2 | 검색장비 유지관리 · 보안구역 출입 · 계약서 관리 | v2 `equipment.js`(CARES 연계)·`passes.js`·`contracts.js` 이식 |
| 3 | 일일 안전점검 · 사고·아차사고 · 위험성 평가 · GSE 안전 | 신규 설계 — 안전 관리 허브 |
| 4 | 화물 보안검색 현황 · 상용화주·RA · 조업사·협력사 현황 | 신규 설계 — 현장 실적 서식 확인 후 |
| 5 | 안전보안 현황판 | 각 모듈 지표 집계 — 데이터가 쌓인 뒤 마지막 |


## 10. v1.9 — 사진 · 3D · 일정 폼 (2026-09-22)

적용 기준: Impeccable 4.3.1(craft-floor · operate · colorize · layout · overdrive) — 좁은 개선(기존 Terminal Calm 유지)으로 진행.

### 10-1. 비주얼

| 위치 | 소재 | 구현 |
|---|---|---|
| 로그인 왼쪽 | 해 질 녘 이륙하는 화물기 사진 | `.login-brand` 배경 + 위아래 어두운 막. 제목 위 · 사진 가운데 · 화물 태그 아래. 860px 이하에서는 위쪽 34vh 사진 띠 |
| 대시보드 화물 태그 카드 | 3D 장면 (`js/hero3d.js`) | 화물기 주 화물칸 문 앞 하이로더가 돌리의 ULD를 받아 올려 싣는 10초 반복. 느린 선회 + 마우스 시차. 태그 카드 왼쪽(무재해 숫자)은 가림막(mask)으로 비워 둠 |
| 허브 화면 머리말 | 허브별 사진 6장 | `#view[data-hub]` 일 때 `.page-head`가 사진 배너(150px, 모바일 116px). 흰 버튼 · 반투명 안내칩으로 대비 확보. 인쇄 시 사진 제외 |

- 사진: Unsplash License, `assets/img/CREDITS.md`. WebP 2000/1000px, 장당 160KB 이하.
- 3D: Three.js r170 단일 파일을 `assets/vendor/`에 둠(CDN 차단 대비). 대시보드 첫 진입 때만 지연 로드, 캔버스 하나를 재사용.
  화면 밖·다른 탭·다른 화면에서는 렌더 중지. 소프트웨어 렌더링·평균 45ms/프레임 초과·prefers-reduced-motion → 정지 화면. WebGL 없음 → 사진.
- 대시보드 하단 시트: 다가오는 일정을 시트 첫 칸으로 옮겨 4칸(1500px 이하 2×2, 768px 이하 1열).

### 10-2. 일정 등록 폼

| 영역 | 내용 |
|---|---|
| 왼쪽(입력) | 일정명(예: OO회의) · 시작/종료일 · 종일 · 시간 · 반복 · 메모 |
| 오른쪽(설정, 패널 배경) | 색상 · 담당자 · 예약(차량/회의실) · 표시·자동 처리(나에게만 보이기/자동 연기/자동 연장) · 알림 · 완료 |
| 설명 | 폼 안 설명 문단 삭제 → ⓘ 말풍선(`SeMIS.ui.tip`) — 마우스 올림·키보드 포커스·탭, Esc·바깥 클릭으로 닫힘 |
| 체크 | 네이티브 체크박스를 숨긴 체크 칩(선 아이콘), 키보드 포커스 링 유지 |

### 10-3. 일정 색 12색

| id | 칠 | 글자 | | id | 칠 | 글자 |
|---|---|---|---|---|---|---|
| red | #d42a1e | 흰 | | blue | #1f4fd6 | 흰 |
| orange | #f58220 | 짙은 갈 | | purple | #9b35c4 | 흰 |
| yellow | #fde047 | 짙은 갈 | | pink | #d0306a | 흰 |
| green | #178236 | 흰 | | rose | #fdd1dc | 짙은 분홍 |
| teal | #0f766e | 흰 | | brown | #6f4323 | 흰 |
| sky | #a5dcfb | 짙은 파랑 | | gray | #646b73 | 흰 |

- 이전 15색은 파랑과 청록이 같은 값(#0d9488)이었고 보라/남색 ΔE 6.5, 황갈/주황 11.6으로 구분이 어려웠다. 새 팔레트 최소 ΔE2000 18.8.
- 구버전 id: lime→green, amber→orange, indigo→blue 로 그린다(`COLOR_ALIAS`, 데이터는 그대로). 수정 후 저장하면 새 id로 바뀐다.
- `--evf`(칠) / `--evc`(흰 바탕 글자색)를 나눠 밝은 3색도 시간 일정 글씨가 읽힌다.

### 10-4. v1.9.1 보완 (2026-09-22)

- **한글 줄바꿈**: `body { word-break: keep-all; overflow-wrap: break-word }` — "일정관\n리", "안\n내"처럼 어절 중간에서 끊기던 문제. 제목류는 `text-wrap: balance`.
- **대시보드 하단 시트**: 칸 수를 화면 폭(@media)이 아니라 시트 폭(`.dash-sheet-wrap` container query)으로 정한다 — 620px↑ 2칸, 1040px↑ 4칸(첫 칸 1.35배). 칸막이는 1px 간격(gap)으로 그려 칸 수가 바뀌어도 선이 맞는다.
- **일정 폼**: '완료'(반복 일정은 적용 범위 선택 포함)를 스크롤 본문에서 하단 버튼줄로 옮김. 설정 패널 폭 344px, 간격 압축, 알림 칩 한 줄.
- **3D**: three.js 주소 `?v=r170`, 불러오기 실패 시 다음 진입 때 재시도, 대체 사유를 `#dash-3d[data-h3d]`에 기록.
