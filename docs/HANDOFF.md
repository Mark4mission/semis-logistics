# SeMIS · Logistics — 세션 인계서

> 새 세션은 이 문서부터 읽는다. 작업이 끝날 때마다 **§4 모듈 현황**과 **§8 작업 기록**을 갱신한다.

## 1. 현황

| 항목 | 값 |
|---|---|
| 현재 버전 | **v1.6.0** (2026-09-20) |
| 접속 주소 | https://mark4mission.github.io/semis-logistics/ |
| 저장소 | GitHub `Mark4mission/semis-logistics` (공개) · Mac `~/SeMIS_Logistics` |
| 테스트 | `npm test` 132건 전부 통과 (코드·문서에 암호 평문 없음) |
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

## 3. 배포 절차 (컨테이너 → Mac → GitHub Pages)

컨테이너에는 GitHub 쓰기 권한이 없으므로 **Mac을 거쳐 push**한다.

1. 컨테이너: `npm run bump <ver>` → `package.json` version 맞춤 → `npm test` 전부 통과
2. `tar czf /mnt/user-data/outputs/semis-logistics-v<ver>.tgz -C /home/claude/logi --exclude=node_modules --exclude=.git .`
3. `SendUserFile` → `device_commit_files`로 `~/SeMIS_v2/_logi_transfer/`에 놓기 (SeMIS_v2가 연결 폴더)
4. `Control_your_Mac__osascript`:
   `do shell script "cd ~/SeMIS_Logistics && tar xzf ~/SeMIS_v2/_logi_transfer/semis-logistics-v<ver>.tgz && git add -A && git -c user.name='Mark' -c user.email='mark4mission@gmail.com' commit -m '<msg>' && git push"`
   (Cowork VM의 `device_bash`에서는 git 인증이 없어 push 실패 — 반드시 osascript)
5. 약 80초 후 내장 브라우저(Claude_Browser)로 `index.html`의 `app.js?v=` 스탬프 확인
   (컨테이너 Chromium은 github.io 접속 불가)

## 4. 모듈 현황

**완료**

| 라우트 | 파일 | 권한 | 비고 |
|---|---|---|---|
| dashboard | modules.js | all | 요약 스트립 · 공지 · 현황 · 결정사항 · 로드맵 |
| schedule | calendar.js | mgr | 담당자 다중 지정 · 드래그 이동 |
| minutes | minutes.js | mgr | 회의록 + QR 참석 서명 |
| reg-sec · reg-safety · reg-dg | regulations.js | mgr (편집 hq) | 규정 3종 · PDF 뷰어 · 개정 아이디어 노트 |
| contacts | contacts.js | mgr | 비상연락망 · 보고체계 |
| vault | vault.js | hq | 암호 관리 (AES-256-GCM, 5분 자동 잠금) |
| settings | modules.js | admin | 메뉴(숨기기 포함) · 사용자 · 담당자 · 데이터(변경 이력 복원) · 저장소 |

**예정 (15)** — `planned:true` 메뉴. 같은 module id로 `registerModule` 하면 자동 대체된다.

| 그룹 | 라우트 · 메뉴명 (vis) |
|---|---|
| (최상위) | board 안전보안 현황판 (mgr) |
| 화물 보안 | scr-status 화물 보안검색 현황 (mgr) · kc-ra 상용화주·RA 관리 (hq) · scr-equip 검색장비 유지관리 (mgr) · access 보안구역 출입 관리 (mgr) |
| 안전 관리 | daily-safety 일일 안전점검 (mgr) · risk 위험성 평가 (hq) · incident 사고·아차사고 보고 (mgr) · gse 지상조업(GSE) 안전 (mgr) |
| 점검 / 시정조치 | inspection 안전보안 점검 일정 (mgr) · car 시정조치 CAR (hq) |
| 교육 / 훈련 | training 안전보안 교육 관리 (mgr) · certs 이수증 관리 (mgr) |
| 협력사 / 조업사 | partners 조업사·협력사 현황 (mgr) · contracts 계약서 관리 (hq) |

SeMIS v2에 같은 성격의 모듈이 있으면 이식한다(v2 저장소: Mac `~/SeMIS_v2`, 연결 폴더라 `device_bash`로 바로 읽기 가능).
v2 대응: inspection.js · carcap.js · training.js · certs.js · contracts.js · equipment.js · passes.js 등.

## 5. 데이터 · 백엔드

- **SYNC_KEYS(17)**: menus · notices · schedules · assignees · assigneesSeeded · minutes · minuteFolders · levelHistory · safetyBoard · contacts · pwOverrides · userOverrides · customUsers · gcal · chatRooms · vault · regulations
- 신규 컬렉션 추가 시: `freshData()` 기본값 → `normalizeData()` 보정(멱등) → `sync.js` SYNC_KEYS → 테스트 Y01 기대 문자열 갱신
- **대량 삭제 방어**(sync.js `guardWipe`): 2건 이상 → 0건 push 차단. 정상 전체 삭제는 `SemisSync.confirmWipe(key)`
- **서버 자동 백업**: 트리거가 모든 변경 직전 값을 `public.semis_store_history`에 90일 보관 → 시스템 설정 › 데이터 관리 › 변경 이력에서 복원
- 규정 PDF: `semis-logi-files/regs/` (공개 URL). 2026-09-20 등록 18건(안전관리 16 · DG 2)
- SeMIS v2와 **데이터 완전 분리** — v2는 `semis_store` · `semis-files`

## 6. 반드시 지킬 규칙

1. **A4 인쇄 버튼**: 모든 화면(외부 링크 제외). `.page-head`/`.ds-head`만 두면 코어가 자동 부착
2. **안내 문구 최소화**: 권한상 자명한 "○○ 전용", 선택지 하나뿐인 입력 안내, 그 단계에서 불필요한 안내는 넣지 않는다. 보안 방식 같은 의미 있는 정보만 한 줄
3. **테스트 통과 후에만 배포**. 브라우저 확인(playwright)은 `addInitScript`로 supabase.co 비-GET 요청을 차단한 상태에서만 (운영 DB 오염 방지)
4. **공개 저장소**: 연락처·명단·암호 평문을 코드에 넣지 않는다. 실데이터는 공용 DB에만
5. 애매한 요구는 질문 후 진행 (AskUserQuestion), 보고는 간결하게
6. 가독성 기준: 본문 17px · 보조 문구 `.81rem` 이상 · 보조 색은 `--text-2`/`--text-3`만

## 7. 미결 · 주의

- ⚠️ **기본 계정 초기 암호 공개 노출** — 과거 테스트 파일에 `cargo-ss`(hq) · `cargo-mgr`(manager) · `cargo-user` 초기 암호 평문이 있었고 저장소가 공개 상태다.
  2026-09-21 현재 파일에서는 제거했지만 **git 이력에는 남아 있다.** 운영 DB `pwOverrides` 기준 `cargo-user`만 변경됨 →
  **`cargo-ss` · `cargo-mgr` 암호를 시스템 설정 › 사용자/암호에서 반드시 변경**(변경 여부는 `semis_logi_store.pwOverrides` 키로 확인)
- 커스텀 도메인 미설정 (추후 `logistics.semis.pe.kr` CNAME 가능)
- CARES Mobile 배포 주소 링크 미등록

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
