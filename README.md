# SeMIS · Logistics — 인천화물팀 안전보안 관리 정보시스템

에어제타 **인천화물팀 안전보안파트**의 화물터미널 현장 안전·보안 업무 정보시스템.
[SeMIS v2](https://semis.pe.kr)(항공보안파트)의 플랫폼 구조를 이어받되 데이터·메뉴·팔레트를 완전히 분리한 **독립 사이트**.

**접속 주소: https://mark4mission.github.io/semis-logistics/** (GitHub Pages, `main` push 시 자동 반영)

설계서: [docs/DESIGN.md](docs/DESIGN.md)

## 구조

```
SeMIS_Logistics/
├── index.html          앱 셸 (로그인 모달 · 헤더 · 사이드바 · 메인)
├── css/main.css        디자인 시스템 (딥 페트롤 + 틸 + 앰버, Section Kit ds-*)
├── js/app.js           코어: 인증(SHA-256) · 저장소/정규화 · 메뉴 엔진 · 권한 · 라우터 · 예정 모듈 안내 · A4 인쇄
├── js/modules.js       대시보드(공지 · 안전보안 현황 · 결정사항 · 로드맵) · 시스템 설정(메뉴/사용자/담당자/데이터/저장소)
├── js/calendar.js      일정관리 (SeMIS v2 이식)
├── js/minutes.js       회의록 게시판 + QR 참석 서명 (SeMIS v2 이식)
├── js/qr.js            순수 JS QR 인코더
├── js/contacts.js      비상연락망 · 보고체계 (섹션 추가/삭제 · 기본 구성 시드)
├── js/search.js        전역 통합 검색 (Ctrl+K)
├── js/sync.js          Supabase 공용 DB 실시간 동기화 (semis_logi_store · semis-logi-files)
├── tests/run-tests.cjs jsdom 테스트 (npm test)
└── tools/bump-version.cjs 버전 스탬프 (npm run bump 1.0.1)
```

## 계정 · 권한

| 계정 | 역할 | rank | 범위 |
|---|---|---|---|
| `mark3464` | 시스템관리자 (admin) | 4 | 시스템 설정 포함 전체. SeMIS v2와 **동일 암호** |
| `cargo-ss` | 안전보안파트 (hq) | 3 | 시스템 설정 외 전체(편집) |
| `cargo-mgr` | 화물팀 관리자 (manager) | 2 | 관리 항목 열람 |
| `cargo-user` | 일반사용자 (user) | 1 | 일반·안내 열람 |

- 로그인은 암호만 입력. 암호는 SHA-256 해시로만 보관(코드·DB에 평문 없음). 초기 암호는 별도 전달 — 접속 후 시스템 설정 → 사용자/암호에서 변경.
- 협력업체(vendor) 계정은 `js/app.js`의 `VENDOR_ACCESS`에 업체명별 허용 라우트를 추가해 사용.
- 메뉴 접근 `vis`: all / mgr / hq / admin — 시스템 설정 → 메뉴 관리에서 조정.

## A4 인쇄 (보고용) — 모든 화면 공통

모든 화면에 **🖨 인쇄** 버튼이 자동으로 붙는다(`SeMIS.attachPrintBtn`, 외부 링크 메뉴 제외).
누르면 문서 머리말(시스템명 · 화면명 · 출력일시 · 출력자)이 붙고 헤더·사이드바·버튼이 빠진 **A4 세로** 형태로 인쇄된다.

- 모듈 쪽에서 따로 할 일은 없다. 화면 머리말(`.ds-head` 또는 `.page-head`)만 두면 버튼이 그 오른쪽에 들어간다.
- 모듈이 자체 인쇄 버튼을 넣고 싶으면 `data-print-btn` 속성을 단 버튼을 직접 두면 자동 부착이 생략된다.
- 인쇄 전용 스타일은 `css/main.css` 의 `@media print` 블록. 큰 카드에 `break-inside: avoid` 를 걸면 첫 장이 통째로 비므로 조각 단위로만 적용한다.

## 일정 담당자 관리

일정관리의 담당자 태그 목록은 코드가 아니라 데이터(`DATA.assignees`)에 있고,
**시스템 설정 → 담당자 관리**에서 시스템관리자가 추가·수정·삭제·순서변경한다(공용 DB 실시간 공유).

- 목록에 없는 이름도 일정 등록 시 자유 입력 가능하며, 그렇게 쓰인 이름은 같은 탭의 **직접 입력된 담당자**에 모여 [목록에 추가]로 승격할 수 있다.
- 담당자 이름을 바꾸면 이미 배정된 일정의 담당자 이름도 함께 바뀐다. 삭제해도 일정의 담당자 이름은 보존된다.
- 최초 1회만 기본값(최상일)을 시드하며(`assigneesSeeded`), 전부 삭제해도 되살아나지 않는다.

## 예정 모듈(planned)

메뉴 항목에 `planned:true, desc`가 있으면 라우트가 "준비 중" 안내 화면을 그린다.
같은 module id로 `SeMIS.registerModule()`이 호출되는 순간 실화면으로 자동 대체되며 사이드바의 `예정` 태그도 사라진다.
시스템 설정 → 메뉴 추가 → **예정 모듈** 유형으로 운영자가 직접 추가할 수도 있다.

## 신규 모듈 추가 체크리스트

1. `js/<module>.js` 작성 — `SeMIS.registerModule("<id>", { title, render(root) })`. 데이터 컬렉션은 `SeMIS.data.<key>`.
2. `js/app.js` — `freshData()`에 컬렉션 기본값, `normalizeData()`에 배열 보정(멱등), 필요 시 `VIEW_WIDTH` 폭 티어.
3. 메뉴 — 기존 예정 메뉴의 module id를 그대로 쓰면 자동 대체. 새 라우트면 `defaultMenus()` + `normalizeData`의 `ensureModuleMenu`.
4. `js/sync.js` — `SYNC_KEYS`에 컬렉션 키 추가.
5. `js/search.js` — `register({...})` 프로바이더 추가.
6. `index.html` — `<script src="js/<module>.js?v=...">` 등록.
7. `tests/run-tests.cjs` — `FILES`에 추가 + 테스트(Y01 SYNC_KEYS 기대 문자열 갱신).
8. `npm run bump <ver>` → `npm test` → `git push`.

## 데이터 저장

- Supabase 프로젝트 `semis-v2`(서울) 내 **별도 테이블** `public.semis_logi_store`(key/value jsonb) + **별도 버킷** `semis-logi-files`. SeMIS v2 데이터와 완전 분리.
- 오프라인 폴백: localStorage(`semisl:data`), 변경분 pending 큐 → 재연결 시 자동 push. Realtime 구독(폴링 폴백).
- 개인정보(연락처 등)는 코드에 시드하지 않고 공용 DB에서만 동기화.

## 개발 · 배포

```
npm install        # jsdom
npm test           # jsdom 테스트
npm run bump 1.0.1 # app.js VERSION + index.html 캐시 스탬프
git push           # GitHub Pages 자동 반영
```
