# Task 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안전보안파트(hq) · 시스템관리자가 함께 쓰는 할 일 메뉴 'Task 관리'(`#/tasks`) — 맨 앞 체크 · 한 줄 빠른 입력(날짜 말 알아듣기) · 색 · 아이콘 자동 구분 · 회의 모드 · 일정관리 칩 · 아르고 도구 · 접수 카운터 '할 일' 줄.

**Architecture:** 공용 행 `tasks`(할 일 배열, key_acl 3/3) 하나에 모두 저장한다. 순수 로직(`js/tasks-core.js` → `window.SemisTasks`)과 화면(`js/tasks.js` — 같은 객체에 화면 함수를 더함)을 나누고, 일정관리 · 홈 띠 · 검색 · 아르고 · 접수 카운터는 `SemisTasks` API 로만 읽고 쓴다.

**Tech Stack:** 바닐라 JS(정적 웹앱 · jsdom 시험 `tests/run-tests.cjs`) · Supabase key_acl(SQL 참고본) · Deno Edge(`semis-logi-argo`).

**Spec:** `docs/superpowers/specs/2026-11-15-task-manager-design.md` — 각 Task 는 spec 의 § 를 근거로 한다. 구현자는 둘 다 읽고, `docs/HANDOFF.md` §6(반드시 지킬 규칙 — 큰 파일이니 `Read` offset 188 limit 33) · `docs/module-template.js` 를 먼저 읽는다.

## Global Constraints

- 브랜치 `claude/task-manager-b8aa4b` = PR #18(`claude/v173-k-search`) 끝 위. base 가 바뀌면 **merge** 로 따라간다(rebase · force 금지). 버전 **1.75.0**(`node tools/bump-version.cjs 1.75.0` + `package.json` · `package-lock.json` version — Task 8 에서만).
- **운영 변경 금지**: 운영 Supabase(마이그레이션 · SQL 쓰기 · Edge 배포) · K드라이브 · Mac 설치본을 건드리지 않는다. Supabase MCP 쓰기 도구를 부르지 않는다.
- 공개 저장소: 사람 이름 · 연락처 · 실제 업무 자료 금지. 시험 이름은 지어낸 것만(`가나다` · `라마바` · `사아자`). 토큰 · 64자 16진 금지(C03 · SEC09).
- 화면 규칙(HANDOFF §6): `SeMIS.ui.*` · `SeMIS.icon()` 만, 이모지 금지(단추 · 제목) · 머리말 주 단추 1개(TA09) · 검색 · 입력칸 다시 만들지 않기(§6-11 — `ui.searchValue` + 목록만 다시 그리기/`ui.repaintKeep`) · 글자 `rem`, .86rem 밑은 `max(var(--fs-min), …)`(HV08) · 모바일 CSS 는 `@media screen and (max-width: 767px)` · `word-break: keep-all` 규칙(§6-9) · 모달 저장 · 취소 · 마침은 `.modal-actions`(§6-10) · 보이는 글자가 있는 단추에 aria-label 금지(§6-28) · 클릭 칸 안 단추는 제목을 `<button>` 으로(§6-29 ⑥) · 주석은 '왜'만(§6-19) · 스크립트 `defer`(LG01).
- 쓰기는 사람 확인 뒤: 아르고 쓰기는 기존 확인 카드(`runTool`) · 접수 카운터는 '이대로 저장'(`apply` → `commit`) 뒤에만. 확인 없이 쓰는 새 길 금지.
- 아르고 **모델 · 생각 깊이(effort) · MAX_TOKENS · MAX_ROUNDS 변경 금지**(AR13 이 문자열 확인).
- 사용 조건 `SemisTasks.canUse()` = `SeMIS.roleRank() >= 3 && role !== "vendor" && role !== "signer"`(spec §5).
- 날짜: 한국 시각 오늘(`SemisTasks.today()` — 시험 훅 `SemisTasks.setToday(iso)`), 날짜 칸 `YYYY-MM-DD` · 시각 `HH:MM`. 주 = 월~일.
- 커밋: `git -c user.name=Mark -c user.email=mark4mission@gmail.com commit`, 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 메시지 머리 `Task 관리 — …`. `npm audit fix` 금지.
- 시험 실행: `npm test`(전체 — 실패 0). 새 시험 묶음 이름 `[TK]`(시험 id `TK01`…), `tests/run-tests.cjs` 의 [LN] 묶음 뒤에 둔다. 한국 시각 00~09시에 날짜 경계 실패가 나면 기존 SC05 · SC06 등과 같은 까닭인지 확인(HANDOFF §1 테스트 칸).

## Review Focus

1. **회의 중 두 사람이 동시에 고침** — 한 사람은 할 일 A 를 체크, 다른 사람은 B 를 고침 → 409 병합 뒤 둘 다 남아야 한다(`SemisSync.merge3` 할 일 단위). → Task 1 TK08.
2. **한글 조합 중 입력** — 빠른 입력 · 회의 칸 입력 · 검색칸에서 글자를 치거나 Enter 로 추가한 뒤에도 같은 입력칸 노드 · 포커스가 남아야 한다. → Task 2 TK13 · Task 4 TK27.
3. **명단 밖 담당자 · 명단 없음** — 인원 관리 명단이 비었거나(권한 · 미등록) 할 일 담당이 명단에 없는 이름이어도 목록 · 칩 · 회의 칸에 보여야 한다. → Task 2 TK15 · Task 4 TK26.
4. **연도 · 월 경계 날짜 말** — 12월에 `1/5` → 다음 해, 지난 `5일` → 다음 달, 과거 요일 '이번 주 월요일'은 그대로(지난 일). → Task 1 TK03.
5. **권한 밖 계정** — manager · user · 협력업체(편집 허용 업체 포함) · 서명 세션에게 메뉴 · 일정관리 칩 · 홈 띠 · 검색 결과 · 아르고 읽기가 모두 없어야 한다. → Task 2 TK19 · Task 5 TK33 · Task 6 TK38.

---

### Task 1: 데이터 · 서버 권한표 · 순수 로직(`js/tasks-core.js`)

spec §5 · §6-2(알아듣는 말) · §6-6(분류).

**Files:**
- Create: `js/tasks-core.js` · `tools/sql/semis-logi-tasks.sql`
- Modify: `tools/sql/semis-logi-security.sql:71-93`(key_acl insert 안에 한 줄) · `js/sync.js:18`(SYNC_KEYS 끝에 `"tasks"`) · `js/app.js`(freshData `tasks: []` · normalizeData rows 표 + 칸 정리) · `index.html`(search.js 뒤 `<script src="js/tasks-core.js?v=1.73.0" defer>`) · `tests/run-tests.cjs`(FILES · Y01 기대 문자열 · 새 TK01~TK08)

**Interfaces:**
- Produces(`window.SemisTasks`, 다른 Task 가 모두 씀):
  - `KEY = "tasks"` · `list(): Task[]`(= `SeMIS.data.tasks` 배열, 없으면 `[]`)
  - `CATS: { equip, check, edu, meet, doc, etc }` 각 `{ label, ico, color }` — 값: equip `장비 · 시설`/`wrench`/`teal` · check `점검 · 수검`/`clipboard`/`red` · edu `교육`/`book`/`green` · meet `회의`/`users`/`blue` · doc `보고 · 제출`/`doc`/`brown` · etc `기타`/`pin`/`gray`. `CAT_ORDER = ["equip","check","edu","meet","doc","etc"]`(판정 순서 = 표 순서, 말 목록은 spec §6-6 표).
  - `catOf(t): string` — `t.cat` 이 CATS 키면 그것, 아니면 `t.t + " " + t.memo` 를 CAT_ORDER 순으로 맞춰 첫 키, 없으면 `"etc"`.
  - `norm(t): Task` — 새 객체(멱등). spec §5 의 칸 규칙: t 300자(줄바꿈 1개까지 — 둘째 줄바꿈부터 띄어쓰기로) · memo 2000 · place 100 · due ISO 아니면 `""` · time `HH:MM` 아니거나 due 없으면 `""` · who/teams 다듬은 문자열 중복 없이 8개 · 각 40자 · cat CATS 키 아니면 `""` · star/done 불리언 · done 이 false 면 doneAt/doneBy `""` · src ∈ `["", "desk", "argo"]` · file 은 `{ name, url }`(url 문자열)일 때만 · id 그대로.
  - `make(fields, src): Task` — `norm({ ...fields, id: "tk_"+무작위 10자, at/upAt: 지금 ISO, by/upBy: me(), done: false, src })`.
  - `parse(text, opts): { t, due, time, who: string[], teams: string[], hits: string[] }` — opts `{ today, names: string[], teams: string[] }`. hits = 알아들은 날짜 · 시각 원문(미리보기용). 규칙은 spec §6-2.
  - `dueInfo(t, today): { b, label, days }` — b ∈ `late|today|tomorrow|week|later|none`(묶음 키), label 은 아래 시험 값.
  - `BUCKETS = [["late","지난 일"],["today","오늘"],["tomorrow","내일"],["week","이번 주"],["later","그 뒤"],["none","날짜 없음"]]`
  - `canUse(): boolean` · `me(): string`(`SeMIS.user` 게터의 name, 없으면 `""`) · `meInPart(): boolean`(`partPeople()` 에 `me()` 가 있음 — '나' 칩 · 담당 기본값의 조건, spec §6-1) · `partPeople(): string[]`(`SemisRoster.active()` 중 `groupOf(p) === "안전보안파트"` 이름, 명단 순서 · SemisRoster 없으면 `[]`) · `teamNames(): string[]`(`SemisRoster.groups()` 의 `g`) · `personColor(name): string`(이름 해시 → `["blue","green","orange","purple","teal","rose"]` 중 하나)
  - `today(): string` · `setToday(iso|null)`(시험 훅)

- [ ] **Step 1: 실패하는 시험 쓰기** — `[TK]` 묶음, `today = "2026-11-18"`(수요일 — `SemisTasks.setToday`):

```js
t("TK01 권한표 · 동기화 · 기본값 · 마이그레이션 파일", () => {
  eq(ACL.tasks.join(","), "3,3"); ok(e.w.SemisSync.SYNC_KEYS.indexOf("tasks") >= 0);
  ok(Array.isArray(fresh.tasks) && fresh.tasks.length === 0);
  ok(/\('tasks',3,3\)/.test(read("tools/sql/semis-logi-tasks.sql")) && /on conflict \(key\) do update/.test(read("tools/sql/semis-logi-tasks.sql")));
});
t("TK02 날짜 말", () => { const P = s => TK.parse(s, { today: "2026-11-18", names: [], teams: [] });
  eq(P("오늘 a").due, "2026-11-18"); eq(P("내일 a").due, "2026-11-19"); eq(P("모레 a").due, "2026-11-20"); eq(P("글피 a").due, "2026-11-21");
  eq(P("금요일 a").due, "2026-11-20"); eq(P("수요일 a").due, "2026-11-18"); eq(P("월요일 a").due, "2026-11-23");
  eq(P("이번 주 금요일 a").due, "2026-11-20"); eq(P("이번주 월요일 a").due, "2026-11-16");
  eq(P("다음 주 수요일 a").due, "2026-11-25"); eq(P("다음주 a").due, "2026-11-23"); eq(P("차주 금 a").due, "2026-11-27");
  eq(P("11/20 a").due, "2026-11-20"); eq(P("11.20 a").due, "2026-11-20"); eq(P("11월 20일 a").due, "2026-11-20");
  eq(P("2027-01-05 a").due, "2027-01-05"); eq(P("2026.11.20 a").due, "2026-11-20");
  eq(P("2일간 교육").due, ""); eq(P("a 3시간").time, "");
  const r20 = P("20일 이내 회신"); eq(r20.due, ""); eq(r20.t, "20일 이내 회신"); eq(P("월말 보고").due, ""); eq(P("월말 보고").t, "월말 보고");
});
t("TK03 경계: 연도 넘김 · 지난 날짜 · 다음 주가 해를 넘김", () => {
  eq(TK.parse("1/5 a", { today: "2026-12-20", names: [], teams: [] }).due, "2027-01-05");
  eq(TK.parse("11/1 a", { today: "2026-11-18", names: [], teams: [] }).due, "2026-11-01");
  eq(TK.parse("다음 주 월요일 a", { today: "2026-12-30", names: [], teams: [] }).due, "2027-01-04");
});
t("TK04 시각 · 말 빼기 · 담당 · 관련 팀", () => { const o = { today: "2026-11-18", names: ["가나다"], teams: ["수출파트"] };
  const r = TK.parse("내일 오후 3시 보안교육 자료 제출", o); eq([r.t, r.due, r.time].join("|"), "보안교육 자료 제출|2026-11-19|15:00");
  eq(TK.parse("a 오전 10시 30분", o).time, "10:30"); eq(TK.parse("a 3시 반", o).time, "15:30"); eq(TK.parse("a 14:00", o).time, "14:00"); eq(TK.parse("a 9시", o).time, "09:00");
  eq(TK.parse("내일", o).t, "내일");
  const n = TK.parse("가나다 수출파트 회신 받기", o); eq(n.who.join(), "가나다"); eq(n.teams.join(), "수출파트"); eq(n.t, "가나다 수출파트 회신 받기");
  ok(r.hits.length === 2);
});
t("TK05 분류 자동 · 직접", () => { const C = s => TK.catOf({ t: s, memo: "" });
  eq(C("검색장비 정기 점검"), "equip"); eq(C("AEO 심사 준비"), "check"); eq(C("보안교육 자료 제출"), "edu");
  eq(C("파트 회의 자료 작성"), "meet"); eq(C("월간 보고서 제출"), "doc"); eq(C("택배 받기"), "etc");
  eq(TK.catOf({ t: "택배", memo: "", cat: "meet" }), "meet"); eq(TK.CATS.meet.color, "blue");
});
t("TK06 정규화 멱등 · 칸 규칙", () => { const n = TK.norm({ id: "tk_a", t: "x".repeat(400), due: "2026-13-01", time: "9:00", who: ["가나다", "가나다", " "], cat: "zzz", done: false, doneAt: "2026-11-01T00:00:00Z" });
  eq(n.t.length, 300); eq(n.due, ""); eq(n.time, ""); eq(n.who.join(), "가나다"); eq(n.cat, ""); eq(n.doneAt, "");
  eq(JSON.stringify(TK.norm(n)), JSON.stringify(n));
  e.S.data.tasks = [n, { t: "id 없음" }]; e.S.normalizeData(); eq(e.S.data.tasks.length, 1); eq(e.S.normalizeData(), false, "멱등");
});
t("TK07 기한 상태 · 묶음 이름", () => { const D = (due, time) => TK.dueInfo({ due, time: time || "" }, "2026-11-18");
  eq(D("2026-11-15").b + "|" + D("2026-11-15").label, "late|3일 지남"); eq(D("2026-11-18", "15:00").label, "오늘 15:00");
  eq(D("2026-11-19").b + "|" + D("2026-11-19").label, "tomorrow|내일"); eq(D("2026-11-21").b + "|" + D("2026-11-21").label, "week|11-21(토)");
  eq(D("2026-11-23").b, "later"); eq(D("").b, "none");
});
t("TK08 회의 중 동시 고침 = 할 일 단위 병합", () => { const a = TK.norm({ id: "tk_a", t: "A" }), b = TK.norm({ id: "tk_b", t: "B" });
  const local = [{ ...a, done: true }, b], remote = [a, { ...b, due: "2026-11-20" }];
  const m = e.w.SemisSync.merge3([a, b], local, remote);
  eq(m.find(x => x.id === "tk_a").done, true); eq(m.find(x => x.id === "tk_b").due, "2026-11-20");
});
```

(`TK = e.w.SemisTasks`, `fresh` = 새 env 의 freshData 결과 — 기존 Y02 가 쓰는 방법을 따른다. `ACL` 은 기존 C05 가 security.sql 에서 뽑는 표.)

- [ ] **Step 2: 시험이 실패하는지 확인** — Run: `npm test 2>&1 | grep -E "TK0|결과"` · Expected: TK01~TK08 FAIL(SemisTasks 없음), Y01 FAIL 아님(아직 안 바꿈).
- [ ] **Step 3: 구현** — `tools/sql/semis-logi-security.sql` key_acl insert 에 `('tasks',3,3),    -- Task 관리 — 안전보안파트 할 일(마이그레이션 semis_logi_tasks_1)`(띄어쓰기 없는 튜플 — C05 정규식). `tools/sql/semis-logi-tasks.sql` = 머리 주석 2줄(역할 · 운영 적용은 마이그레이션 `semis_logi_tasks_1`) + 같은 insert 한 문장(`on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank`). `js/sync.js` SYNC_KEYS 끝에 `"tasks"`, Y01 기대 문자열도. `js/app.js` freshData `tasks: [],` · normalizeData: `rows("tasks")` 표에 넣고, `window.SemisTasks` 가 있으면 각 줄을 `norm` 결과와 JSON 이 다를 때만 바꿔(바뀜 표시 — normalizeData 의 기존 바뀜 셈 방식을 따름) 멱등 유지. `js/tasks-core.js` = Interfaces 의 API(파일 머리 1~2줄 역할 주석). 한국 시각 오늘은 기존 모듈의 `todayISO` 방식을 따른다(KST).
- [ ] **Step 4: 통과 확인** — Run: `npm test 2>&1 | tail -3` · Expected: `0 실패`(TK01~TK08 포함, Y01 · Y02 · C05 통과).
- [ ] **Step 5: 커밋** — `git add js/tasks-core.js tools/sql/semis-logi-tasks.sql tools/sql/semis-logi-security.sql js/sync.js js/app.js index.html tests/run-tests.cjs` → `Task 관리 — 데이터 · 권한표 · 날짜 말 · 분류(순수 로직)`.

### Task 2: 화면 — 메뉴 · 빠른 입력 · 목록 · 체크 · 마친 일(`js/tasks.js`)

spec §6-1 · §6-2(입력 동작) · §6-3 · §10(메뉴 · 배지).

**Files:**
- Create: `js/tasks.js`(템플릿 `docs/module-template.js` 에서 시작)
- Modify: `js/app.js`(defaultMenus 홈 허브 `schedule` 다음 줄 · `GLOSS` 한 줄) · 메뉴 아이콘을 모듈 id 로 고르는 곳이 있으면 거기에 `tasks: "check"`(예: `js/hubhome.js` `MOD_ICO` — 이웃 메뉴가 쓰는 방식 그대로) · `css/main.css`(맨 끝 `/* ── Task 관리 ── */` 구획) · `index.html`(tasks-core.js 뒤 `js/tasks.js` defer) · `tests/run-tests.cjs`(FILES · D02 `5/5` → `6/6` · TK10~TK19)

**Interfaces:**
- Consumes: Task 1 `SemisTasks` 전부.
- Produces: `SeMIS.registerModule("tasks", { title: "Task 관리", navBadge, render })` · `SemisTasks.setState({ reset?, tab?, who?, q?, meet? })`(시험 훅) · `SemisTasks.setDone(id, on)`(체크 · 되돌리기 공통 — 저장 · 다시 그리기 포함, 다른 Task 가 씀) · `SemisTasks.add(fields, src)`(make → push → `SeMIS.save()` → 새 Task 반환) · 화면 DOM id: `#tk-quick`(빠른 입력) · `#tk-qadd` · `#tk-qprev` · `#tk-who`(담당 칩 `.seg`, 단추 `data-who="*"|"me"|이름`) · `#tk-q`(검색) · `#tk-list` · 줄 `.tk-row[data-id]` · 체크 `input.tk-chk` · 제목 단추 `.tk-t` · 머리말 `#tk-add` · `#tk-meet`.

- [ ] **Step 1: 실패하는 시험 쓰기**(hq 로그인 · `setToday("2026-11-18")` · 샘플 할 일 4개 — 지난 · 오늘 · 날짜 없음 · 마침 1, 명단 `roster` 에 안전보안파트 `Thq`(시험 hq 계정 이름 — '나'가 명단에 있는 경우) · `가나다` · `라마바`):
  - `TK10 메뉴 · 모듈`: `menuForModule("tasks")` → parent `hub-home`, vis `hq`, 홈 허브에서 `schedule` 바로 다음 · `navVisible` · `hasModule("tasks")` · 머리말 `.btn-primary` 1개(글자 '할 일 추가') · `#tk-meet` 있음.
  - `TK11 묶음 · 순서`: `#tk-list` 묶음 머리 글이 차례로 `지난 일 · 오늘 · 날짜 없음`(빈 묶음 숨김) · 같은 묶음 안 별표가 위 · 지난 줄에 `.tk-late` · 날짜 칩 글 `3일 지남`.
  - `TK12 체크 → 빠짐 · 되돌리기`: 오늘 줄의 `input.tk-chk` 클릭 → 그 할 일 `done === true` · `doneBy === "Thq"`(시험 계정 이름 — `sessPayload` 의 name) · 목록에서 빠짐 · 알림에 '되돌리기' 단추 → 누르면 `done === false` 로 돌아오고 다시 보임.
  - `TK13 빠른 입력 · 미리보기 · 한글`: `#tk-quick` 에 `내일 오후 3시 보안교육 자료 제출` 넣고 input 이벤트 → `#tk-qprev` 에 `11-19` 와 `15:00` 칩 + 담당 칩 `[data-qwho]` 3개(Thq · 가나다 · 라마바), `Thq` 만 `aria-pressed="true"` · Enter(keydown) → 새 할 일 `{ t: "보안교육 자료 제출", due: "2026-11-19", time: "15:00", who: ["Thq"] }` · 입력칸 비어 있고 **같은 노드**(`q(e,"#tk-quick") === before`) · `document.activeElement` 그대로.
  - `TK14 담당 기본값 · 바로 바꾸기`: `#tk-who [data-who="가나다"]` 클릭 → 목록에 가나다 담당만 · 빠른 입력 `a` → 미리보기 `가나다` 켜짐 → Enter → who `["가나다"]` · 글에 `라마바` 가 있으면 who `["라마바"]`(글 속 이름 우선) · 미리보기 `[data-qwho="라마바"]` 눌러 켜고 Enter → who 에 라마바 포함, 그 뒤 다음 입력은 다시 기본값 · `data-who="me"` = 계정 이름 담당만.
  - `TK15 명단 밖 · 명단 없음`: `roster` 를 비우고 다시 그림 → '나' 칩 없음(`meInPart` false) · 칩 = `전체` + 할 일에 적힌 이름(`사아자`) · 그 할 일이 목록에 보임 · 빠른 입력 `a` Enter → who `[]`.
  - `TK16 마친 일 탭`: 탭 `done` → 마친 줄 체크 켜짐 · 끄면 다시 할 일(`done false`, `doneAt ""`) · 마친 일 101건이면 처음 100줄 + '더 보기'.
  - `TK17 검색칸`: `#tk-q` 에 `회의실` → 장소에 '회의실'인 할 일만 · 입력칸 같은 노드(`ui.repaintKeep`).
  - `TK18 배지 · 요약`: `navBadge()` = 지난 + 오늘 수(샘플 2) · 모두 마치면 `""` · `ui.stats` 칸 '지난 일' 값 1, tone bad.
  - `TK19 권한`: manager · user · vendor(`VENDOR_ACCESS` 편집 허용 업체 흉내 포함) · signer 로그인 → 메뉴 안 보임 · `SemisTasks.canUse() === false` · `go(e,"tasks")` 해도 할 일 글이 그려지지 않음(`#tk-list` 없음).
- [ ] **Step 2: 실패 확인** — Run: `npm test 2>&1 | grep -E "TK1|D02|결과"` · Expected: TK10~TK19 FAIL.
- [ ] **Step 3: 구현** — spec §6-1 · §6-2 · §6-3 그대로. 다시 그리기 규칙: 빠른 입력의 input 이벤트는 `#tk-qprev` 만, 검색은 `#tk-list` 만(`repaintKeep`), 추가 · 체크 뒤에는 요약 띠(`#tk-stats` 감싼 칸) · 탭 건수 · `#tk-list` 만 — 입력칸은 그대로 두고 값만 비움. 줄의 체크박스는 `<input type="checkbox" aria-labelledby>`(제목 단추 id), 제목 단추를 누르면 Task 3 의 고치기 창(이 Task 에서는 `SemisTasks.edit` 가 없으면 아무 일 없음 — 있으면 부름). 줄 상자 클릭(체크박스 · 단추 밖)도 같은 동작이되 줄 상자에는 `role` · `tabindex` 를 주지 않는다(HANDOFF §6-29 ⑥ — `js/calendar.js` `wireInsp` 방식). 담당 칩 선택은 계정별 navPrefs 키 `tkWho` 에 기억(기존 navPrefs 쓰는 법을 따름). 사람 색은 칩 앞 작은 동그라미(색만으로 구분하지 않게 이름 글자 함께). 알림 '되돌리기' = `toast(msg, false, { label: "되돌리기", run })`. CSS: 체크박스 28px · 줄 사이 · 날짜 칩 상태 색(토큰 · 일정 색 이름 → 기존 일정 색 CSS 가 있으면 그 변수/클래스 재사용) · 390px 에서 둘째 줄 칩이 줄바꿈.
- [ ] **Step 4: 통과 확인** — Run: `npm test 2>&1 | tail -3` · Expected: `0 실패`.
- [ ] **Step 5: 커밋** — `Task 관리 — 화면: 메뉴 · 빠른 입력 · 목록 · 체크 · 마친 일`.

### Task 3: 고치기 창 · 지우기 · 특정 할 일 열기

spec §6-4 · §10(특정 할 일 열기).

**Files:**
- Modify: `js/tasks.js` · `css/main.css`(같은 구획) · `tests/run-tests.cjs`(TK20~TK24)

**Interfaces:**
- Consumes: Task 2 `SemisTasks.add` · `setDone`.
- Produces: `SemisTasks.edit(id|null, preset?)`(고치기 창 — id 없으면 새 할 일, preset = 처음 칸 값) · `SemisTasks.open(id)`(모듈 상태에 id 를 두고 `SeMIS.navigate("tasks")`, 이미 그 화면이면 다시 그림 — 렌더 뒤 `edit(id)`; 다른 Task 가 씀) · 창 DOM: `#tk-f-t`(내용) · `#tk-f-due` · `#tk-f-time` · `#tk-f-place` · `#tk-f-who`(사람 칩 `button[aria-pressed]` + `#tk-f-who-x` 직접 적기) · `#tk-f-teams`(+ `#tk-f-teams-x`) · `#tk-f-cat`(select, 값 `""` = 자동) · `#tk-f-star` · `#tk-f-memo` · 날짜 칩 `[data-due="today|tomorrow|fri|nextmon|clear"]` · `.modal-actions` 단추 `[data-act="del"|"done"|"cancel"|"save"]`.

- [ ] **Step 1: 실패하는 시험 쓰기**
  - `TK20 새 할 일 창`: `#tk-add` 클릭 → 창 · `[data-act="del"]` 없음 · 내용 비우고 저장 → 저장 안 됨 + 오류 알림 · 내용 `가` · 날짜 칩 `nextmon` → `#tk-f-due` 값 `2026-11-23` · 사람 칩 `가나다` 켬 · 관련 팀 직접 `협력업체A` · 저장 → 할 일 1개 `{ t: "가", due: "2026-11-23", who: ["가나다"], teams: ["협력업체A"] }` · 창 닫힘.
  - `TK21 고치기 · 분류 직접`: 줄 제목 단추 클릭 → 창 칸에 값 · 분류 select 첫 항목 글에 자동 판정 이름(예 `자동 — 회의`) · `edu` 고르고 저장 → `cat: "edu"` · `upBy === "Thq"` · 목록 줄 아이콘 칸에 `tk-c-green` 같은 분류 색 표시(클래스 이름은 구현이 정함 — 시험은 `CATS.edu.color` 문자열이 그 줄 HTML 에 있는지).
  - `TK22 마침 · 다시 열기 단추`: 창 `[data-act="done"]`(글 '마침') → done true · 창 닫힘 · 마친 할 일 창에서는 같은 단추 글 '다시 열기'.
  - `TK23 지우기`: `[data-act="del"]` → 확인 창 → 확인 → 배열에서 빠짐 · 취소면 그대로.
  - `TK24 open(id)`: 다른 화면에서 `SemisTasks.open(id)` → 주소 `#/tasks` · 그 할 일 창이 열림 · 이미 `#/tasks` 에서 불러도 열림 · 없는 id 면 창 없이 목록만.
- [ ] **Step 2: 실패 확인** — Run: `npm test 2>&1 | grep -E "TK2|결과"` · Expected: TK20~TK24 FAIL.
- [ ] **Step 3: 구현** — spec §6-4. 장소 datalist = 할 일들의 장소(중복 없이 최근 20). 사람 칩 = `partPeople()` ∪ 이 할 일의 who, 팀 칩 = `teamNames()` ∪ 이 할 일의 teams. 직접 적기 칸은 쉼표로 나눔. 출처(`src === "desk"` · `file`)면 '접수 카운터 원본' 단추 — 첨부 뷰어(`js/files.js` 의 열기 함수)로. 창은 `openModal(html, { sticky: true })`(오래 쓰는 창 — 게시판 쓰기 관례). 지우기 확인 = `confirmModal`.
- [ ] **Step 4: 통과 확인** — `npm test 2>&1 | tail -3` · Expected `0 실패`.
- [ ] **Step 5: 커밋** — `Task 관리 — 고치기 창 · 지우기 · 특정 할 일 열기`.

### Task 4: 회의 모드 · 인쇄

spec §6-5.

**Files:**
- Modify: `js/tasks.js` · `css/main.css` · `tests/run-tests.cjs`(TK25~TK29)

**Interfaces:**
- Consumes: Task 2 `add` · `setDone` · 줄 그리기 · Task 3 `edit`.
- Produces: 회의 DOM — `#tk-meetbox` · 칸 `.tk-col[data-col="이름"|""]`(`""` = 담당 없음) · 칸 입력 `input.tk-cin[data-col]` · 칸 목록 `.tk-clist` · 이번 주 마친 일 `.tk-wkdone`(펼침 단추 `[data-wk]`).

- [ ] **Step 1: 실패하는 시험 쓰기**
  - `TK25 칸 구성`: `#tk-meet` 클릭 → `#tk-meetbox` · 머리말 단추 글 '목록 보기' · 칸 = `가나다 · 라마바`(명단 순) + 할 일에 적힌 명단 밖 `사아자` + 담당 없는 할 일이 있을 때만 `담당 없음` · 담당 2명 할 일은 두 칸 모두에 · 칸 머리 남은 수.
  - `TK26 명단 밖 · 명단 없음`: 명단 비움 → 칸 = 할 일에 적힌 이름들 + 담당 없음(있을 때) · 아무 할 일도 없고 명단도 없으면 `담당 없음` 한 칸(입력할 곳이 있게 — 그 칸 입력은 글 속 이름만 담당).
  - `TK27 칸 입력`: `라마바` 칸 `input.tk-cin` 에 `금요일 장비 교체` Enter → `{ t: "장비 교체", due: "2026-11-20", who: ["라마바"] }` · 그 입력칸 같은 노드 · 값 비움 · 포커스 그대로 · 다른 칸 입력칸도 같은 노드.
  - `TK28 체크 · 이번 주 마친 일`: 칸 줄 체크 → 빠지고 그 칸 '이번 주 마친 일 1' · 펼쳐 체크 끄면 다시 할 일 · 지난주에 마친 일은 세지 않음.
  - `TK29 인쇄 · 되돌아가기`: 회의 모드에서 `.page-head` 인쇄 단추가 있고(코어) 인쇄용 날짜 줄(`2026-11-18(수)`)이 회의 상자 안에 · 이번 주 마친 일은 인쇄 CSS 에서 펼쳐짐(`@media print` 규칙이 css 에 있음 — 문자열 확인) · '목록 보기' → 목록으로.
- [ ] **Step 2: 실패 확인** — Run: `npm test 2>&1 | grep -E "TK2[5-9]|결과"` · Expected FAIL.
- [ ] **Step 3: 구현** — spec §6-5. 칸 입력 Enter: `parse` 로 날짜 · 시각 · 담당 이름을 뽑고 who = `[칸 사람] ∪ 글 속 이름`(담당 없음 칸이면 글 속 이름만). 다시 그리기는 그 칸 `.tk-clist` 와 머리 수만 — 입력칸은 그대로. 회의 모드 큰 글자 · 체크박스 32px 은 `rem`. PC 1024 이상 `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))` 류, 모바일은 한 줄. 회의 모드 켜짐은 모듈 상태에만(새로고침 때 목록).
- [ ] **Step 4: 통과 확인** — `npm test 2>&1 | tail -3` · Expected `0 실패`.
- [ ] **Step 5: 커밋** — `Task 관리 — 회의 모드 · 인쇄`.

### Task 5: 일정관리 칩 · 홈 '오늘' 띠 · 통합 검색

spec §7 · §10.

**Files:**
- Modify: `js/tasks.js`(calItems · todayData · todaySub · 검색 프로바이더) · `js/calendar.js:529`(INSP_SRC 한 줄) · `js/calendar.js:579-586`(inspToggle 알림 글 — 항목 `chkMsg`) · `js/modules.js:177-239`(todayHTML 한 덩어리 · 371-377 클릭 연결이 필요하면 같이) · `js/search.js:204-212`(KIND_OF `"Task 관리": "할 일"`) · `tests/run-tests.cjs`(TK30~TK34)

**Interfaces:**
- Consumes: Task 1 `dueInfo` · `catOf` · `CATS` · Task 2 `setDone` · Task 3 `open`.
- Produces: `SemisTasks.calItems(from, to): Item[]`(spec §7 항목 모양 · `chk`/`mark` 는 `js/seclog.js` 의 `chkOf` · `mark` 가 주는 모양 그대로 · `chkMsg: { on: "할 일을 마침으로 표시했습니다.", off: "할 일을 다시 열었습니다." }`) · `SemisTasks.todayData(): { open, today, late } | null`(canUse 아님 · open 0 이면 null) · `SemisTasks.todaySub(d): string`(`오늘 2 · 지난 1`).

- [ ] **Step 1: 실패하는 시험 쓰기**
  - `TK30 일정관리 칩`: hq · 일정관리 11월 → `[할 일] …` 칩(날짜 있는 할 일만, 마친 일 포함) · 날짜 없는 할 일 없음 · 칩 색 = 분류 색 · 상세의 'Task 관리에서 열기' → `#/tasks` 에서 그 할 일 창.
  - `TK31 칩 ○ 마침`: 칩 ○ 누름 → 그 할 일 `done true` · 알림 글 `할 일을 마침으로 표시했습니다.`(보안 기록부 문구 아님) · 기존 점검 일정 ○ 알림은 예전 문구 그대로(기존 시험 통과).
  - `TK32 홈 띠`: hq 대시보드 → `#td-tk` 글에 `오늘 1 · 지난 1` · 누르면 `#/tasks` · 할 일 모두 마치면 `#td-tk` 없음.
  - `TK33 권한 밖`: manager 일정관리 → `[할 일]` 칩 없음 · 대시보드 `#td-tk` 없음 · 검색 `보안교육` 결과에 'Task 관리' 묶음 없음.
  - `TK34 검색`: hq 검색 `보안교육` → 'Task 관리' 묶음 결과 · 꼬리표 '할 일' · 마친 일 결과 아래 줄에 '마침' · 결과 누름 → `#/tasks` 에서 그 할 일 창.
- [ ] **Step 2: 실패 확인** — Run: `npm test 2>&1 | grep -E "TK3[0-4]|결과"` · Expected FAIL.
- [ ] **Step 3: 구현** — spec §7 · §10. 검색 프로바이더는 `js/tasks.js` 끝에서 `SemisSearch.register({ id: "tasks", group: "Task 관리", ico: "check", module: "tasks", minRank: 3, items })`, `pick: () => SemisTasks.open(id)` 의 '모듈 상태만 두기' 꼴(검색이 이동을 맡는 관례 — `js/search.js` `goItem` 을 읽고 맞춤). calItems 는 `canUse()` 아니면 `[]`.
- [ ] **Step 4: 통과 확인** — `npm test 2>&1 | tail -3` · Expected `0 실패`.
- [ ] **Step 5: 커밋** — `Task 관리 — 일정관리 칩 · 홈 오늘 띠 · 통합 검색`.

### Task 6: 아르고 — 읽기 · 쓰기 도구 4개 · 안내 지식

spec §8.

**Files:**
- Modify: `js/argo.js`(COLS `tasks` · W `task_add` · `task_update` · `task_done` · `task_delete` · CTX) · `tools/edge/semis-logi-argo.ts`(COLLECTIONS · toolList 4개 · 쓰기 지침 한 줄) · `tools/edge/semis-logi-argo.test.ts`(hq 시험에 한 줄) · `docs/ARGO-GUIDE.md`(메뉴 표 한 줄 · §6 용어 풀이 'Task' 한 줄(화면 GLOSS 와 같은 뜻) · §7 쓰기 기능 한 줄) · `tools/edge/argo-guide.ts`(`npm run argo:guide` 로 다시 만듦) · `tests/run-tests.cjs`(TK35~TK39)

**Interfaces:**
- Consumes: Task 1 `canUse` · `make` · `norm` · `catOf` · `CATS` · Task 2 `setDone`(또는 같은 칸 규칙).
- Produces: 도구 이름 `task_add` `{ items: [{ t, due?, time?, place?, who?: string[], teams?: string[], memo?, star? }] (1~10) }` · `task_update` `{ id, t?, due?, time?, place?, who?, teams?, memo?, star?, cat? }` · `task_done` `{ id, done }` · `task_delete` `{ id }` — 모두 min 3. COLS 줄 모양(spec §8): `{ id, title, due, time, place, who, teams, cat(분류 이름), star, done, doneAt(날짜 10자), memo(200자), src }`(빈 칸은 빼기).

- [ ] **Step 1: 실패하는 시험 쓰기**(기존 AR 시험의 아르고 구동 방법 — 가짜 모델 응답으로 tool_use 를 주고 확인 카드를 누르는 꼴 — 을 그대로 따름)
  - `TK35 읽기`: hq `argos_records { collection: "tasks", from: "2026-11-16", to: "2026-11-22" }` → 이번 주 기한 · 이번 주 마친 일만(다음 달 기한이면서 이번 주에 만든 할 일은 없음 — at 칸이 줄에 없어서) · 줄에 `title` · `cat` 이름.
  - `TK36 추가 = 확인 카드 뒤`: `task_add` 1건 → 확인 카드(동사 '추가하기') · 누르기 전 `tasks` 그대로 · 누르면 1건(`src: "argo"`) · 결과 카드 되돌리기 → 0건. 2건이면 '바로 실행'(navPrefs `argoAuto`)이어도 확인 카드.
  - `TK37 고치기 · 마침 · 지우기`: `task_update { id, due }` → 바뀐 칸 줄 · `task_done { id, done: true }` → done · `task_delete` → '바로 실행'이어도 확인 카드(위험 단추) · 없는 id → 오류 결과('찾지 못했습니다').
  - `TK38 권한`: manager 로 `argos_records tasks` → 권한 밖 결과 · TOOL_MIN 에 task_* 모두 3.
  - `TK39 Edge 대조 · 안내 지식`: AR13 이 통과(COLS ↔ COLLECTIONS · 도구 min) · `docs/ARGO-GUIDE.md` 메뉴 표에 `| tasks | hq 이상 |` 줄 · AR12(route 실재 · argo-guide.ts 동기화) 통과 · Edge 원본에 `"claude-sonnet-5-5"` · `const MAX_TOKENS = 2500;` 그대로.
  - Deno `tools/edge/semis-logi-argo.test.ts` hq 시험: 도구 목록에 `task_add` · `task_delete`, collection enum 에 `tasks` — user 시험(정확한 목록)은 그대로 통과해야 함.
- [ ] **Step 2: 실패 확인** — Run: `npm test 2>&1 | grep -E "TK3[5-9]|AR1[23]|결과"` · Expected TK35~TK39 FAIL.
- [ ] **Step 3: 구현** — W 항목은 `schedule_add` · `schedule_update` · `schedule_done` · `schedule_delete` 와 같은 짝 · 같은 꼴(`label` '할 일 추가' · '할 일 고치기' · '할 일 마침' · '할 일 지우기', `keys: ["tasks"]`, `task_add.confirm = inp => items ≥ 2`, `task_delete.danger = true` · `confirm: () => true`, `go` = Task 관리 화면). 검사(`prep`): t 필수 300자 · due ISO 또는 빈 값 · time 은 due 있을 때 `HH:MM` · who/teams 문자열 배열. Edge toolList 는 `SCHED_FIELDS` 처럼 `TASK_FIELDS` 공유 객체 · 설명은 짧게. 쓰기 지침 한 줄(spec §8). ARGO-GUIDE 메뉴 표 줄: `| 홈 | Task 관리 | tasks | hq 이상 | 안전보안파트 할 일 — 맨 앞 체크 · 날짜 · 장소 · 담당 · 관련 팀 · 회의 모드, 날짜 있는 할 일은 일정관리에 칩 |` → `npm run argo:guide`.
- [ ] **Step 4: 통과 확인** — Run: `npm test 2>&1 | tail -3` → `0 실패` · Run: `deno test --node-modules-dir=none --allow-net --allow-env --allow-read tools/edge/semis-logi-argo.test.ts` → `ok | 7 passed` · 생긴 `deno.lock` 은 지움(커밋 금지).
- [ ] **Step 5: 커밋** — `Task 관리 — 아르고: 할 일 읽기 · 추가 · 고치기 · 마침 · 지우기(확인 카드)`.

### Task 7: 접수 카운터 — '할 일' 저장할 곳

spec §9.

**Files:**
- Modify: `js/desk.js`(KINDS · plan · '저장할 곳 추가' · actBody · rowSub · check · commit) · `tests/run-tests.cjs`(DK04 기대값 · TK40~TK44)

**Interfaces:**
- Consumes: Task 1 `canUse` · `make` · `teamNames` · Task 2 `add` 는 쓰지 않음(commit 은 한 번에 `SeMIS.save()` — 기존 `apply` 흐름).
- Produces: act 모양 `{ id, k: "task", on, t, due, time, place, who: string(쉼표), teams: string(쉼표), memo, file: boolean }` · 기록 `{ k: "task", label: "할 일 · MM-DD 내용", route: "tasks" }`.

- [ ] **Step 1: 실패하는 시험 쓰기**(기존 `deskEnv` · `AI()` 도우미)
  - `DK04` 기대값: 기한 일정 줄 `false:false:` 로(회의 줄은 `true:true:보안담당` 그대로) + 같은 계획에 `k === "task"` 줄 1개 `on: true` · `t === "회신 — <문서 제목>"`(AI 기본 제목과 다를 때) · `due === "2026-10-30"`.
  - `TK40 기한 없으면 할 일 줄 없음`: 회의 일정만 있는 notice → task 줄 0 · '저장할 곳 추가' 에 `[data-add="task"]` 단추 → 누르면 켜진 빈 할 일 줄(칸 펼침).
  - `TK41 저장 전에는 안 씀`: DK07 흐름(판독 → wait) 에서 `tasks` 0 건 · `apply` 뒤 1건 `{ src: "desk", due, who }` · `file.url` 이 tasks/ 사본 주소(사본 흉내 — DK07 의 filesCall 가짜 응답) · 기록 `acts` 에 `k: "task"` · route `tasks`.
  - `TK42 끈 줄은 저장 안 함`: task 줄 `on: false` 로 apply → `tasks` 0 건.
  - `TK43 검사`: task 줄 내용 비움 → apply 막힘(그 줄 펼침 · 검사 문구) · 날짜 `2026-13-01` → 막힘.
  - `TK44 할 일을 못 쓰는 계정`: `SemisTasks.canUse()` 가 false 인 상황(SemisTasks 없음 흉내)에서는 task 줄 · 추가 단추 없고 기한 일정 줄은 예전처럼 켜짐.
- [ ] **Step 2: 실패 확인** — Run: `npm test 2>&1 | grep -E "DK0|TK4|결과"` · Expected DK04 · TK40~TK44 FAIL.
  - `TK45 원본 첨부 끔`: task 줄 `file: false` 로 apply → 사본 요청(`filesCall` copy)에 `tasks` 폴더 없음 · 저장된 할 일에 `file` 없음.
- [ ] **Step 3: 구현** — spec §9. `KINDS.task = { label: "할 일", save: "Task 관리에 할 일로 저장", folder: "tasks", route: "tasks" }` · `folderFor` 에 `a.k === "task" && !a.file ? ""`. `plan()`: canUse 일 때만 기한(`cat === "deadline"`) 일정마다 task 줄(켬)을 그 일정 줄 바로 뒤에 + 그 일정 줄 끔. '저장할 곳 추가' 네 번째 단추 `data-add="task"`(내용 처음 값 = 문서 제목). [DK] 묶음 전체를 돌려 기대값 확인. 담당 = `areaNames(area)`(일정 줄과 같음), 관련 팀 = `ai.org` 가 `teamNames()` 에 있을 때만. `commit`: 일정 줄 분기처럼 사본 주소를 받아 `SeMIS.data.tasks.push(SemisTasks.make({ t, due, time, place, who: 쉼표 나눔, teams: 쉼표 나눔, memo, file }, "desk"))`. `sayHTML` · 단추 · 셈은 그대로(n곳에 자동 포함).
- [ ] **Step 4: 통과 확인** — `npm test 2>&1 | tail -3` · Expected `0 실패`.
- [ ] **Step 5: 커밋** — `Task 관리 — 접수 카운터: 기한 있는 공문은 '할 일' 줄을 켜서 제안(저장 뒤에만)`.

### Task 8: 문서 · 버전 · 전체 검증

spec §12 · §13 · §14.

**Files:**
- Modify: `docs/HANDOFF.md`(§1 현재 버전 칸 맨 앞 v1.75.0 한 덩어리 · 테스트 칸 맨 앞 건수 · §4-1 홈 허브 줄 · §4-2 표 `tasks` 한 줄 · §5 데이터 한 항목 · SYNC_KEYS 수(43 → 실제 수) · §7 운영 적용 순서 한 항목 · §8 기록 맨 위 한 줄) · `docs/DESIGN.md`(맨 끝 `## 21. v1.75 — Task 관리` 짧게 — 화면 규칙 · 내 판단 표 요약, spec 링크) · `index.html` · `edu.html` · `learn.html` · `js/app.js`(bump) · `package.json` · `package-lock.json`

- [ ] **Step 1: 버전** — Run: `node tools/bump-version.cjs 1.75.0` → package.json · package-lock.json(맨 위 두 version) 1.75.0.
- [ ] **Step 2: 문서** — HANDOFF 의 기존 v1.73.0 항목 꼴을 따름. §7 = spec §13 운영 적용 순서 그대로(마이그레이션 `semis_logi_tasks_1` 병합 전 → 병합 → Edge `semis-logi-argo` 재배포 → 확인 · 되돌리기, #17 · #18 · v1.74 다음). '내 판단' 표(spec §14)는 §8 기록 줄에 요약 + spec 링크.
- [ ] **Step 3: 전체 시험** — Run: `npm test 2>&1 | tail -3` → `0 실패`(건수 기록) · Run: `deno test --node-modules-dir=none --allow-net --allow-env --allow-read tools/edge/semis-logi-argo.test.ts` → 통과 · `git status` 에 deno.lock · node_modules 변경 없음.
- [ ] **Step 4: 커밋** — `Task 관리 — 문서 · v1.75.0`.

(브라우저 화면 확인 · 브랜치 전체 리뷰 · PR 은 오케스트레이터가 이 계획 밖에서 한다.)
