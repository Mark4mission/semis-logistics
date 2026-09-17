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

## 6. 디자인

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

## 6-1. A4 인쇄 (전 화면 공통 규칙)

모든 화면(대시보드·업무 모듈·예정 모듈 안내·시스템 설정)에 **A4 보고용 인쇄 버튼**을 둔다. 외부 링크 메뉴만 예외.
코어가 화면 머리말에 버튼을 자동으로 붙이므로 모듈은 별도 구현이 필요 없다(`SeMIS.attachPrintBtn` / `SeMIS.printView`).
인쇄 시 헤더·사이드바·조작 버튼이 빠지고, 문서 머리말(시스템명 · 화면명 · 출력일시 · 출력자)이 자동으로 붙는다(A4 세로, 여백 12/10/14mm).

## 7. 배포

- GitHub `Mark4mission/semis-logistics` → GitHub Pages(main, root). 주소 `https://mark4mission.github.io/semis-logistics/`.
- 커스텀 도메인은 추후 `logistics.semis.pe.kr` CNAME(가비아 DNS) 등록 시 `CNAME` 파일 추가로 전환 가능.
- 릴리스: `npm run bump <ver>` → 테스트 → `git push`(main push 시 자동 반영).

## 8. 테스트

- `tests/run-tests.cjs`(jsdom): 코어(해시·로그인·권한·메뉴 시드·정규화 멱등·라우팅·설정 화면·예정 모듈 안내), 동기화(SYNC_KEYS·canon·mergeById), 이식 모듈 렌더 스모크, 버전 스탬프 검사.
