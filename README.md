# ARGOS — 인천화물팀 안전보안 종합정보

**ARGOS**(Air-cargo Risk & Guard Operations System)는 에어제타 **인천화물팀 안전보안파트**의 화물터미널 안전 · 보안 업무 플랫폼이다.
본사 항공보안파트의 [SeMIS v2](https://semis.pe.kr) 플랫폼 구조에서 출발했지만 데이터 · 메뉴 · 화면은 완전히 분리된 독립 사이트다(구 이름 SeMIS · Logistics — 저장소 · 주소 · DB 이름은 그대로).

**접속 주소: https://mark4mission.github.io/semis-logistics/** (GitHub Pages, `main` push 시 자동 반영)

- 세션 인계서: [docs/HANDOFF.md](docs/HANDOFF.md) — 새 작업은 여기서 시작(현황 · 배포 · 메뉴 구조 · 규칙 · 미결)
- 지난 경위: [docs/HISTORY.md](docs/HISTORY.md) · 설계서: [docs/DESIGN.md](docs/DESIGN.md) · 새 모듈 견본: [docs/module-template.js](docs/module-template.js)

## 구조

```
index.html        앱 셸 — 로그인 · 레일(허브) · 허브 패널 · 상단바 · 탭 묶음 줄(#subtabs) · 본문 · 모바일 하단 탭 · 검색 팔레트
edu.html          보안교육 이수 등록 페이지(로그인 없음 · 링크 코드 + 작업증명)
css/main.css      디자인 시스템 "Terminal Calm"(토큰 · 내비 · 반응형 · 모듈별 스타일 · 인쇄)
js/app.js         코어 — 세션 · 저장소 · 정규화(메뉴 시드 · 이전) · 메뉴 엔진(허브 · 탭 묶음 · 링크 묶음) · 권한 · 라우터 · A4 인쇄 · 화면 정돈 · 화면 키트(SeMIS.ui · icon)
js/sync.js        공용 DB 동기화(세션 토큰 · 권한별 컬렉션 · 409 병합 · 대량 삭제 방어)
js/fileauth.js    비공개 버킷 파일 → 서명 URL
js/<모듈>.js      업무 화면 — 목록은 HANDOFF §4-2
assets/           로고 · 허브 사진 · 국가항공보안 수준관리지침 별표 양식(HWPX) · vendor(supabase-js · three.js · leaflet · pdf.js, 버전 고정 로컬 사본)
tools/            버전 스탬프 · 서버 SQL 원본 · Edge Function 원본
tests/            jsdom 테스트(npm test)
```

## 계정 · 권한

| 계정 | 역할 | rank | 범위 |
|---|---|---|---|
| `mark3464` | 시스템관리자 (admin) | 4 | 시스템 설정 포함 전체 |
| `cargo-ss` | 안전보안파트 (hq) | 3 | 시스템 설정 외 전체(편집) |
| `cargo-mgr` | 화물팀 관리자 (manager) | 2 | 관리 항목 열람 |
| `cargo-user` | 일반사용자 (user) | 1 | 일반 · 안내 열람 |

- 로그인은 암호만. 계정 · 암호는 서버 전용 표에만 있고(bcrypt), 코드 · 공용 데이터에는 없다. 로그인 창은 보이지 않는 작업증명으로 자동 공격을 막는다.
- 협력업체(vendor) 계정은 `js/app.js` `VENDOR_ACCESS` 에 업체별 허용 화면을 둔다.
- 메뉴 권한 `vis`(all · mgr · hq · admin)와 숨김은 시스템 설정 › 메뉴에서. 숨김은 권한과 별개(화면 · 데이터는 그대로, 메뉴 · 검색 · 대시보드에서만 빠짐).

## 화면 공통

- **A4 인쇄** — 모든 화면 머리말(`.page-head` · `.ds-head`)에 `Print` 버튼이 자동으로 붙는다(머리말: 시스템명 · 화면명 · 출력일시 · 출력자).
- **메뉴** — 허브(레일) › 메뉴 › 탭 묶음(비슷한 화면을 한 줄로, 본문 위 탭으로 이동) · 링크 묶음(바로가기 여러 개를 카드 화면 하나로). 예정 모듈(`planned`)은 '준비 중' 안내 화면이고, 같은 id 로 `registerModule` 되면 실화면이 된다. 운영 화면이 없는 허브는 레일에 나오지 않는다.
- **모바일** — 하단 탭(홈 · 일정 · 순찰 · 운항 · 전체) · 머리말 더보기(…) · 표는 행 카드로. 모바일 CSS 는 `@media screen and (max-width: 767px)`.
- **통합 검색** — Ctrl K / `/`. 모듈이 `SemisSearch.register()` 로 항목을 낸다.

## 데이터 · 보안

- Supabase(서울) — 테이블 `semis_logi_store`(key/value jsonb, 세션 RLS · 컬렉션별 읽기/쓰기 등급표), 비공개 버킷 `semis-logi-files`, Edge Function(파일 서명 · 이수증 판독 · AI 요약 · 운항 중계). SeMIS v2 와 완전 분리.
- 변경 직전 값은 서버가 90일 보관(`semis_store_history`) → 시스템 설정 › 데이터 › 변경 이력에서 복원. 2건 이상 → 0건 저장은 클라이언트가 막는다.
- 연락처 · 명단 · 민감보안정보 원문은 코드 · 테스트 · 문서에 넣지 않는다(공개 저장소). 공용 DB 와 Mac 로컬 `~/SeMIS_v2/_ssi/` 에만.
- 암호 관리는 브라우저에서 AES-256-GCM(엔벨로프, PBKDF2 31만 회) — 서버에는 암호문만.

## 개발 · 배포

```
npm install         # jsdom
npm test            # jsdom 테스트 전부 통과해야 배포
npm run bump 1.46.0 # app.js VERSION · index.html / edu.html 캐시 스탬프
```

배포는 컨테이너 → Mac → GitHub 경로(패치 · `git am`)로 한다 — HANDOFF §3.
