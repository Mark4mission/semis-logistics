# K드라이브 새 폴더 알림 · 분류 추천 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** K드라이브 '항공보안'에 새로 생긴 폴더를 시스템관리자에게 빠짐없이 알리고(배지 · 동기화 탭 · 홈 '오늘'), 연결 밖 둘째 폴더에는 H 화면 · 분류를 추천해 [이대로 연결] 한 번으로 미리보기 연결을 만든다.

**Architecture:** v1.73 의 비공개 표 `kidx`(폴더 줄 · `first_seen`)에 기준선(`kidx_base`)과 처리 기록 표(`kidx_ack`)를 더하고, SQL 함수 `ksync_newdirs` 가 종류(`link` · `top` · `out` · `auto` · `excl`) · 처리됨 · 묶음을 계산해 관리 RPC 와 상태 RPC(배지)에 준다. 추천은 화면(`js/kfolder.js` — 분류 목록이 화면 코드에 있으므로)에서 규칙으로 하고, 못 맞추면 Edge `semis-logi-argo` 의 새 `mode: "kfolder"` 로 AI 에게 묻는다. 에이전트 · Edge `semis-logi-ksync` 는 바꾸지 않는다.

**Tech Stack:** 바닐라 JS(정적 웹앱, jsdom 시험) · Supabase Postgres(plpgsql, PGlite 시험) · Deno Edge Function · Node 에이전트(바뀌지 않음, E2E 만).

**Spec:** `docs/superpowers/specs/2026-11-15-k-new-folder-design.md` (Mark 승인 11-15) — 각 Task 는 spec 의 § 를 근거로 한다. 구현자는 둘 다 읽는다.

## Global Constraints

- 브랜치 `claude/v174-k-new-folder` 는 PR #18(`claude/v173-k-search`, v1.73.0 — PR #17 위) 위. #18 · #17 이 바뀌거나 병합되면 **merge** 로 따라간다(rebase · force 금지). 버전 **1.74.0**(`node tools/bump-version.cjs 1.74.0` + `package.json` · `package-lock.json` version).
- 마이그레이션 이름 `semis_logi_security_38_ksync_newdirs` = `tools/sql/semis-logi-ksync.sql` 전체 다시 실행(두 번 실행해도 같은 결과 — SQL 시험이 두 번 돈다). 비공개 함수 이름은 `ksync_` 로 시작(0번 anon 차단 목록에 걸리게).
- 경로 비교는 **대소문자 무시**, 접두 비교는 `starts_with(lower(a), lower(b) || '/')` 또는 `left()` — `LIKE` 금지(폴더 이름의 `_` · `%`).
- 연결 단위 깊이 = **2**(색인 뿌리 기준 — 맨 위 업무 폴더 1, 둘째 폴더 2). 한 번 누름 연결은 깊이 2 `link` 줄에만.
- 한 번 누름 = `semis_logi_ksync_map_save` 그대로(미리보기 상태 — 파일 안 올라감). 추천 기본값: `dir: "k2h"`, `ssi` = 색인 뿌리 아래 경로의 어느 마디든 이름 끝이 `(SSI)`(대소문자 · 앞뒤 공백 무시), `since` = 같은 맨 위 폴더 아래 연결의 최빈값 → 전체 연결 최빈값 → 비움, 뺄 폴더 없음.
- 보는 사람 · 누르는 사람 = **시스템관리자만**: 화면 `SeMIS.isAdmin()` 단추 + 함수 첫 줄 + 서버 `ksync_admin()` · Edge `kfolder` 는 `semis_logi_argo_begin` 의 `rank === 4`.
- AI 로 보내는 것 = 규칙이 못 맞춘 `link` 줄의 색인 뿌리 기준 경로(한 번에 10줄까지) + 후보 분류 목록뿐. 결과는 탭 메모리에만. 모델 = Edge 의 지금 목록(`ARGO_MODEL` → Sonnet 5.5 → 폴백), 생각 깊이 설정 넣지 않음.
- 공개 저장소: 서버 주소 · IP · 계정 · 사람 이름 · 실제 K 파일 · 폴더 이름을 코드 · 시험 · 문서에 넣지 않는다(HANDOFF §6). 시험의 경로 · 이름은 지어낸 것만.
- 화면 규칙: HANDOFF §6 — 버튼 위계(18 — 행마다 되풀이되는 단추는 강조하지 않음) · 화면 패턴(29 — 블록 4개 이하, 카드 안 탭 `ui.tabs`/`ui.pane`) · 쉬운 말(28) · 글자 하한(6) · 줄바꿈(9) · 아이콘 `SeMIS.icon` · 이모지 금지 · 스크립트 `defer`(13) · 주석은 '왜'만(19) · 390px · 1024px.
- 커밋: `git -c user.name=Mark -c user.email=mark4mission@gmail.com commit`, 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 시험 5종: `npm test` · SQL `node tools/sql/semis-logi-ksync.test.mjs tools/sql/semis-logi-ksync.sql tools/sql/semis-logi-conflict.sql` · Edge `deno test --node-modules-dir=none --allow-net --allow-env --allow-read tools/edge/semis-logi-ksync.test.ts` 와 `deno test --allow-net --allow-env tools/edge/semis-logi-argo.test.ts` · `node tools/ksync/test/plan.test.mjs` · `node tools/ksync/test/e2e.test.mjs`. PGlite 는 `npm i --no-save @electric-sql/pglite` 로 받고 끝나면 `npm prune`. 한국 시각 00~03시에는 날짜 경계 시험이 main 에서도 실패하므로 낮에 돌린다. `npm audit fix` 금지. 생기는 `deno.lock` 은 커밋하지 않는다.
- 운영 Supabase(마이그레이션 · Edge 배포 · 쓰기 SQL) · Mac 재설치는 하지 않는다 — Mark 승인 뒤 HANDOFF §7 순서로.

## Review Focus

1. **대소문자만 다른 경로**(맥 SMB 는 대소문자 무시) — 연결 `k_path` 가 `…/Aeo`, 색인 줄이 `…/AEO/2027` 이면 `auto`(연결 안)여야 한다. 처리 기록도 대소문자 무시 → Task 2 `NEWD-13`.
2. **폴더 이름의 `_` · `%` · `(SSI)` · `[`** — `LIKE` 로 접두를 비교하면 `a_b` 가 `axb` 아래로 잡힌다 → Task 2 `NEWD-13`, 화면 정규식 escape → Task 4 `KF01`.
3. **한꺼번에 많은 새 폴더**(폴더 묶음 복사로 1,000개) — 서버는 머리 줄만 300줄 · 전체 수, 화면은 '전체 N줄 중 300줄', AI 는 10줄만 → Task 2 `NEWD-11` · Task 5 `KS-N5`.
4. **목록 RPC 실패 · 찾기 꺼짐 · 옛 서버(마이그레이션 전 — RPC 없음 404)** — 동기화 탭의 다른 카드 · 배지는 그대로, 묶음 자리에 한 줄, 홈 줄 없음, 오류 알림을 되풀이하지 않음 → Task 5 `KS-N8`.
5. **[이대로 연결] 두 번 누름 · 늦은 응답** — 보내는 동안 단추를 잠가 연결 요청은 한 번, 두 번째로 생긴 서버 거절(`target_dup` · `k_dup`)이 창을 연달아 열지 않음 → Task 5 `KS-N2`.

---

### Task 1: SQL — 기준선 · 처리 기록 표

**Files:**
- Modify: `tools/sql/semis-logi-ksync.sql` (표 정의 ~183-207 · `ksync_kidx_end` 1354-1386 · `semis_logi_ksync_kidx_save` 2020-2028 · RLS 목록)
- Test: `tools/sql/semis-logi-ksync.test.mjs` (KIDX-13 뒤에 새 묶음 `// NEWD 새 폴더 알림`)

**Interfaces:**
- Produces (SQL):
  - `ksync_state.kidx_base timestamptz`(null 허용) · `ksync_state.kidx_base_err jsonb not null default '[]'`
  - 표 `semis_logi_private.kidx_ack(path text not null, act text not null check (act in ('skip','seen')), at timestamptz not null default now(), by text)` + `unique index kidx_ack_lpath on kidx_ack (lower(path))`, RLS 켜고 public · anon · authenticated 권한 없음(기존 표 목록에 추가)
  - `ksync_kidx_end` 동작 추가(한 트랜잭션 안):
    - 덧쓰기 전 `v_had` = `kidx` 에 줄이 있음, `v_keep` = stage 의 경로와 **정확히 같은** `kidx` 줄이 하나라도 있음. `not v_had or not v_keep` 이면 덧쓰기 뒤 `kidx_base = now()`, `kidx_base_err = 이번 err(검사 통과분)` (spec §4 ⓐ · ⓑ).
    - 그 밖이면: 새로 넣는 줄 중 `ksync_under(path, kidx_base_err)` 인 줄은 `first_seen = kidx_base`(있는 줄은 `first_seen` 을 건드리지 않는 기존 규칙 그대로) → 덧쓰기 뒤 `kidx_base_err` 에서 이번 `err` 에 없는 경로(대소문자 무시)를 뺀다.
    - 맨 끝: `delete from kidx_ack a where not exists (select 1 from kidx k where k.is_dir and lower(k.path) = lower(a.path))`.
  - `semis_logi_ksync_kidx_save` 의 뿌리 바꿈 가지: 지금 지우는 것에 더해 `kidx_ack` 비움 · `kidx_base = null` · `kidx_base_err = '[]'`.
  - 파일 끝(실행 권한 앞) 한 번 채움: `update … set kidx_base = (select min(first_seen) from kidx) where id = 1 and kidx_base is null and exists (select 1 from kidx);`

- [x] **Step 1: 실패하는 시험을 쓴다** — 기존 KIDX 도우미(`kx` · `ks` · `one` · `eq`, 걷기 begin → rows → end)를 그대로 쓴다. 시험 경로는 지어낸 것.
  - `NEWD-01` 권한: `kidx_ack` anon SELECT 차단 · RLS 켜짐.
  - `NEWD-02` 첫 걷기(빈 표, 폴더 `가/나`, `가/나/다`, 파일 1) 뒤 `kidx_base` = 그 줄들의 `first_seen` · `kidx_base_err = []`.
  - `NEWD-03` 둘째 걷기(같은 줄 + 새 폴더 `가/새`) 뒤 `kidx_base` 그대로 · `가/새` 만 `first_seen > kidx_base`.
  - `NEWD-04` ⓑ 겹침 0: 옛 뿌리 줄(`옛/x`)이 든 표에 전혀 다른 경로(`가/나`)만 보낸 덧쓰기 → `kidx_base` = 그 덧쓰기 시각, 새 폴더 0. `delete from kidx` 뒤 첫 덧쓰기도 다시 기준선.
  - `NEWD-05` 기준선 `err`: 첫 걷기 `err: ["잠김"]`(그 아래 줄 없음) → `kidx_base_err = ["잠김"]`; 다음 걷기에 `잠김/a`, `잠김/a/b` 가 처음 들어오고 `err: []` → 두 줄 `first_seen = kidx_base` · `kidx_base_err = []`; 그다음 걷기에 생긴 `잠김/c` 는 새 폴더(`> kidx_base`).
  - `NEWD-06` 뿌리 바꿈(`ks({root: "다른"})`) → `kidx_base` null · `kidx_base_err = []` · `kidx_ack` 0줄. 대소문자만 바꾸면 그대로.
  - `NEWD-07` 처리 기록 정리: `kidx_ack` 에 `가/새`(있음) · `가/없음`(색인에 없음) → 다음 덧쓰기 뒤 `가/새` 만 남음.
  - `NEWD-08` 마이그레이션 채움: `kidx_base` 를 null 로 바꾸고 SQL 파일을 다시 실행 → `min(first_seen)`; 한 번 더 실행해도 그대로.
- [x] **Step 2: 돌려 실패를 본다** — Run: `node tools/sql/semis-logi-ksync.test.mjs tools/sql/semis-logi-ksync.sql tools/sql/semis-logi-conflict.sql` — Expected: NEWD-01~08 FAIL(열 · 표 없음).
- [x] **Step 3: 위 Interfaces 대로 구현한다.** 기존 KIDX-01~13 은 그대로 통과해야 한다.
- [x] **Step 4: 돌려 통과를 본다** — 같은 명령, Expected: 실패 0.
- [x] **Step 5: 커밋** — `K드라이브 새 폴더 알림 — 서버: 기준선 · 처리 기록 표`

### Task 2: SQL — 새 폴더 계산 · 관리 RPC · 상태(배지)

**Files:**
- Modify: `tools/sql/semis-logi-ksync.sql` (`semis_logi_ksync_status` 1422-1454 · 새 함수는 `semis_logi_kidx_list` 뒤 · 실행 권한 2071-2086)
- Test: `tools/sql/semis-logi-ksync.test.mjs` (NEWD 묶음 이어서 · `ADMIN` 목록에 새 RPC 2개)

**Interfaces:**
- Consumes: Task 1 의 `kidx_base` · `kidx_ack`.
- Produces (SQL):
  - `semis_logi_private.ksync_newdirs(p_limit int) returns jsonb` — spec §4 규칙 그대로. 결과 `{ on, base, at, n, n_link, items, gone }`:
    - 새 폴더 집합 N = `kidx` 폴더 줄 중 `first_seen > kidx_base`(`kidx.on` 거짓 · `root` 빔 · `kidx_base` null 이면 `{ on: false, n: 0, n_link: 0, items: [], gone: [] }`).
    - F 마다: `full = root || '/' || path`, `depth` = 마디 수, `unit` = 깊이 ≤ 2 면 자기, 아니면 앞 두 마디.
    - 안에 든 연결 M = `lower(full) = lower(k_path)` 이거나 `full` 이 `k_path` 아래. 처리됨(연결) = M 있음 and `first_seen <= M.created_at`.
    - 처리됨(사람) = 처리 기록 A 가 있어 (`lower(F.path) = lower(A.path)` 또는 (F 가 A 아래 and A 의 깊이 ≥ 2)) and `F.first_seen <= A.at`.
    - `cls`: M 이 있으면 F 가 M 의 `excludes`(연결 기준 상대 경로) 아래면 `excl`, 아니면 `auto` / 없으면 `ksync_under(full, ksync_state.excludes)` 면 `excl` / 아니면 깊이 1 `top` · 깊이 2 `link` · 깊이 ≥ 3 `out`.
    - 머리 줄 = 처리 안 된 F 중 (깊이 ≤ 2) 또는 (부모가 N 에 있고 처리 안 됨 — 이 경우가 아니어야 머리). 즉 깊이 ≥ 3 이고 부모가 처리 안 된 새 폴더면 묶여 들어간다.
    - 줄 = `{ path, first_seen, cls, part, unit, unit_skip, unit_part, more, files, bytes, bytes50, map, excl }` — `part` = `link` 이고 그 아래에 연결 있음, `unit_skip` = `out` 이고 단위 경로에 `act = 'skip'` 기록, `unit_part` = `out` 이고 단위 아래(또는 같은)에 연결 있음, `more` = 같은 단위 안 아래의 처리 안 된 새 폴더 수, `files` · `bytes` · `bytes50`(size ≤ 52428800 만) = F 아래 파일 줄 합, `map` = `{ id, k_path, mod, grp, state, dir }`(M 있을 때), `excl` = 걸린 제외 경로.
    - `n` = 머리 줄 전체 수, `n_link` = 그중 `link` 수, `items` = 정렬(`link` · `top` · `out` · `auto` · `excl` 순, 그 안 `first_seen` 최근) 뒤 앞 `p_limit` 줄.
    - `gone` = `state in ('active','preview','paused')` 연결 중 `k_path` 가 `root` 아래이고 그 상대 경로가 `kidx.excludes` 아래가 아니며 `created_at < (kidx_last ->> 'at')::timestamptz` 인데 같은 경로(대소문자 무시)의 `kidx` 폴더 줄이 없는 것 → `[{ id, k_path, mod, grp }]`.
  - `public.semis_logi_ksync_newdirs() returns jsonb` — `perform ksync_admin()` → `{ ok: true, root, ...ksync_newdirs(300) }`.
  - `public.semis_logi_ksync_newdir_ack(p jsonb) returns jsonb` — `ksync_admin()`. `p.act in ('skip','seen')` · `p.paths` 문자열 배열 1~300개가 아니면 `{ ok: false, error: "bad" }`. 경로마다 `ksync_rel` 통과 and 지금 `kidx` 폴더 줄(대소문자 무시)일 때만 `insert … on conflict (lower(path)) do update set act, at = now(), by` (`by` = 세션 이름 — 기존 관리 RPC 가 `created_by` 에 쓰는 값과 같게) → `{ ok: true, n: 적은 수, skipped: 건너뛴 수 }`.
  - `semis_logi_ksync_status()` 결과에 `'newdirs', { n, n_link, gone: gone 수 }`(`ksync_newdirs(0)`) · `alert` 에 `or n > 0 or gone > 0`.
  - 두 새 RPC 를 기존 revoke(public, authenticated) · grant(anon, service_role) 목록에 넣는다.

- [x] **Step 1: 실패하는 시험을 쓴다** — 연결은 `map_save` 로 만든다(`k_path` = `항공보안/…`, 색인 뿌리 `항공보안`).
  - `NEWD-09` 권한 · 꺼짐: 새 RPC 2개 `ADMIN` 목록(시스템관리자 밖 42501 — 기존 0번 대조가 확인) · 찾기 꺼짐이면 `{ ok: true, on: false, n: 0 … }`.
  - `NEWD-10` 종류: 기준선 뒤 새 폴더 `업무1`(top) · `업무1/둘째`(link — top 아래지만 둘째 폴더라 따로 머리) · `업무2/옛둘째/2027`(out, 부모 연결 없음) · `업무2/연결됨/2027`(auto — `업무2/연결됨` 연결) · `업무2/연결됨/임시/x`(excl — 연결 `excludes: ["임시"]`, `excl` = `임시`) · `보관/새`(excl — 전체 제외 `항공보안/보관`) → 각 `cls`, `map` · `excl` 칸, 정렬 순서.
  - `NEWD-11` 묶음 · 상한: `업무3/새둘째/a/b`(넷 다 새것) → 머리는 `업무3/새둘째` 하나(`more` 2 — `a`, `a/b`) + `업무3` 은 top 한 줄; 머리 줄 305개를 만들면 `items` 300 · `n` 305.
  - `NEWD-12` 처리됨: (가) `map_save` 로 `업무1/둘째` 연결 → 그 줄과 미리 있던 아래 폴더 빠짐, 그 뒤 걷기에 생긴 `업무1/둘째/2028` 은 `auto` 로 뜸. (나) `newdir_ack({paths:["업무3/새둘째"], act:"skip"})` → 머리 · 묶인 아래 빠짐, 다음 걷기에 생긴 `업무3/새둘째/c` 는 `out`(`unit_skip` true). (다) `업무1` 에 `seen` → `업무1` 만 빠지고 그 뒤 생긴 새 둘째 폴더는 여전히 `link`.
  - `NEWD-13` 대소문자 · 특수 문자: 연결 `k_path` `항공보안/업무4/Aeo` · 색인 `업무4/AEO/2027` → `auto`; 처리 기록 `업무5/X` 가 `업무5/x` 를 덮음; 폴더 `업무6/a_b` 연결이 있을 때 `업무6/axb/새` 는 연결 안이 아님(`out`); 이름에 `%` · `(SSI)` · `[` 가 있어도 오류 없음.
  - `NEWD-14` `part` · `unit_part`: `업무7/새둘째/깊은` 을 먼저 연결한 뒤 `업무7/새둘째` 줄은 `part` true; `out` 줄의 단위 아래 연결 있으면 `unit_part` true.
  - `NEWD-15` 크기: 줄의 `files` · `bytes` · `bytes50`(60MB 파일 하나는 `bytes` 에만).
  - `NEWD-16` 사라진 연결: 연결 `항공보안/업무8/둘째`(마지막 걷기 전에 만듦) 폴더가 색인에 없으면 `gone` 에 있음; 마지막 걷기 뒤 만든 연결 · 찾기 `excludes` 아래 연결 · 뿌리 밖 연결은 없음.
  - `NEWD-17` 상태: 새 폴더 · gone 있으면 `newdirs` 숫자 · `alert` true; 모두 처리하면 `n` 0 · (다른 조건 없으면) `alert` false.
  - `NEWD-18` ack 검사: `act` 다른 값 · 빈 배열 · 301개 → `bad`; 색인에 없는 경로 · `../x` → `skipped`.
- [x] **Step 2: 돌려 실패를 본다** — Task 1 과 같은 명령, Expected: NEWD-09~18 FAIL.
- [x] **Step 3: 위 Interfaces 대로 구현한다.** 한 번 부를 때 폴더 1,400 · 연결 30 기준 수십 ms 안(재귀 CTE 또는 집합 조인 — 구현자 판단, `LIKE` 금지).
- [x] **Step 4: 돌려 통과를 본다** — Expected: 실패 0(기존 시험 포함).
- [x] **Step 5: 커밋** — `K드라이브 새 폴더 알림 — 서버: 새 폴더 계산 · 관리 RPC · 배지`

### Task 3: Edge `semis-logi-argo` — `mode: "kfolder"`

**Files:**
- Modify: `tools/edge/semis-logi-argo.ts` (본문 파싱 뒤 · 세션 확인 뒤 갈래)
- Test: `tools/edge/semis-logi-argo.test.ts` (새 `Deno.test` 하나 — 기존 가짜 fetch 도우미 그대로)

**Interfaces:**
- Produces (HTTP, 같은 주소 · 같은 헤더 `x-semis-token`):
  - 요청 `{ mode: "kfolder", items: [{ path: string }], cats: [{ key: string, label: string, aka?: string, taken?: string }] }` — `items` 1~10개 · `path` 1~300자, `cats` 1~300개 · `key` 가 `^[a-z][a-z0-9-]{1,39}\|[A-Za-z0-9_-]{1,40}$` · `label` 120자 이하 · `aka` · `taken` 200자 이하. 틀리면 400 `{ ok: false, error: "bad_request" }`.
  - 세션 · 사용량은 지금처럼 `semis_logi_argo_begin` → `rank !== 4` 면 403 `{ ok: false, error: "forbidden" }`(AI 를 부르지 않음).
  - AI 요청: 고정 지침 상수 `KFOLDER_SYSTEM`(spec §7 문장), 도구 하나 `kfolder_pick`(`input_schema` = `{ picks: [{ path: string, key: string|null, reason: string }] }`), `tool_choice: { type: "tool", name: "kfolder_pick" }`, `max_tokens` 1024, 모델 목록 · 폴백 · 오류 응답(429/529 → 503 busy 등)은 지금 대화와 같은 함수를 함께 쓴다.
  - 응답 200 `{ ok: true, picks: [{ path, key: string|null, reason: string(80자까지) }], model }` — 보낸 `path` 가 아닌 것은 버리고, `cats` 에 없는 `key` 는 `null` 로. `semis_logi_argo_meter` 로 토큰 셈.
  - `mode` 가 없으면 지금 대화 흐름 그대로.

- [x] **Step 1: 실패하는 시험** `Deno.test("kfolder: 시스템관리자만 · 입력 검사 · 강제 도구 · 결과 거르기 · 사용량", …)`: rank 3 → 403 이고 AI fetch 0회; items 11개 · 키 형식 틀림 → 400; rank 4 정상 → AI 요청 본문에 `tool_choice.name === "kfolder_pick"` · `tools.length === 1` · system 에 `KFOLDER_SYSTEM`; 가짜 AI 가 `[{path:"업무1/둘째", key:"audit|gov"}, {path:"모름", key:"audit|gov"}, {path:"업무1/셋째", key:"x|y"}]` 를 주면 응답 `picks` = `[{path:"업무1/둘째", key:"audit|gov", …}, {path:"업무1/셋째", key:null, …}]`; meter 1회.
- [x] **Step 2: 돌려 실패를 본다** — Run: `deno test --allow-net --allow-env tools/edge/semis-logi-argo.test.ts` — Expected: 새 시험 FAIL, 기존 7건 PASS.
- [x] **Step 3: 구현한다**(위 Interfaces).
- [x] **Step 4: 돌려 통과를 본다** — Expected: 8 passed.
- [x] **Step 5: 커밋** — `K드라이브 새 폴더 알림 — Edge argo: kfolder 추천(시스템관리자)`

### Task 4: 추천 — 새 `js/kfolder.js`

**Files:**
- Create: `js/kfolder.js` (`window.SemisKfolder` — 화면 없이 계산만, AI 호출 하나)
- Modify: `index.html` (`js/ksync.js` 앞에 `<script src="js/kfolder.js?v=1.74.0" defer></script>`)
- Test: `tests/run-tests.cjs` (새 묶음 `[KF]` — [KS] 묶음 뒤)

**Interfaces:**
- Consumes: `SemisSearch.altsOf(word)` · `SemisSearch.SYN`(동의어), `SemisSync.FN_ARGO` · `SemisSync.auth.token()`, Task 3 의 HTTP.
- Produces:
  - `SemisKfolder.tokens(name: string) → string[]` — 끝 `(SSI)` · 앞 두 자리 번호 + 빈칸 · `20NN` · `(MM.DD)` 를 떼고 `·` `,` `_` 공백으로 나눈 낱말(2글자 이상, 소문자).
  - `SemisKfolder.ssiOf(path: string) → boolean` — `/` 로 나눈 마디 중 하나라도 `trim()` 뒤 `/\(ssi\)$/i`.
  - `SemisKfolder.recommend(path: string, ctx: Ctx) → Rec` — 규칙만. 
    - `Ctx = { root: string, maps: [{ id, k_path, mod, grp, since, state }], targets: [{ mod, label, groups: [{ id, label, short?, aka? }] }], gone: number[] }`(`targets` = `js/ksync.js` 의 `targets()` 와 같은 모양, `gone` = 사라진 연결 id).
    - `Rec = { kind: "link"|"taken"|"moved"|"none", mod?, grp?, label?(화면 › 분류), map?: { id, k_path }, ssi: boolean, dir: "k2h", since: string, reason: string, by: "rule"|"ai" }` — `taken` = 맞는 분류를 연결 `map` 이 씀(그 폴더 있음), `moved` = 그 연결이 `gone`, `none` = 문턱 넘는 후보 없음.
  - `SemisKfolder.cats(ctx: Ctx) → [{ key, label, aka, taken }]` — AI 로 보낼 후보(`taken` = 쓰는 연결 `k_path` 끝 두 마디).
  - `SemisKfolder.ask(paths: string[], cats) → Promise<{ [path]: { key: string|null, reason: string } }>` — `fetch(FN_ARGO, { mode: "kfolder", items, cats })`, 10초 넘거나 실패하면 `{}`(던지지 않음). `paths` 는 앞 10개만.
  - `SemisKfolder.applyAI(path, pick, ctx) → Rec` — `pick.key` 가 후보이고 비었으면 `link`(`by: "ai"`, `reason` 앞 'AI 추천: '), 쓰였으면 `taken`/`moved`, 없거나 모르는 키면 `none`. `ssi` · `dir` · `since` 는 `recommend` 와 같은 규칙.
  - 점수 숫자 · 문턱은 구현자 판단 — 아래 시험이 기준.

- [x] **Step 1: 실패하는 시험** — 지어낸 분류 · 연결로(예: 화면 `수검 대응`(`audit`: `gov` '국토부 · 지방항공청 보안점검' · `aeo` 'AEO 인증 · 심사' · `misc` '기타'), 화면 `보안 기록부`(`inspection`: `monthly` '월간 자체 보안점검' · `quarterly` '분기 자체 보안점검 · Self Audit' · `misc` '기타'), 연결 `항공보안/04 수검/AEO`(audit/aeo, since 2025-08-01) · `항공보안/03 점검/월간`(inspection/monthly, since 2025-08-01)):
  - `KF01 tokens`: `"04 수검"` → `["수검"]` · `"(03.15) 현장 점검 2026"` → `["현장", "점검"]` · `"위해물품·적발 (SSI)"` → `["위해물품", "적발"]` · `"a[b+(c)"` 에서 예외 없음.
  - `KF02 ssiOf`: `"04 수검/지방청 점검 (SSI)/2026"` true · `"a/b (ssi)  "` true · `"a/SSI 자료"` false.
  - `KF03 이름 · 동의어`: `"04 수검/지방항공청 점검"` → link `audit|gov`; `"04 수검/국토교통부 보안점검"` → link `audit|gov`(국토부 ↔ 국토교통부, `reason` 에 분류 이름).
  - `KF04 이웃`: `"03 점검/분기 점검"` → link `inspection|quarterly`(같은 맨 위 폴더 연결이 `inspection`).
  - `KF05 taken · moved`: `"04 수검/AEO 2차"` → `taken`, `map.id` = AEO 연결; 같은 입력에 `gone: [그 id]` → `moved`.
  - `KF06 misc`: `"03 점검/양식"` → link `inspection|misc`; `"11 새업무/알수없음"` → `none`.
  - `KF07 기본값`: `dir` 언제나 `"k2h"`; `since` = 같은 맨 위 폴더 연결 최빈값 → 없으면 전체 최빈값 → 연결 없으면 `""`; `ssi` = `ssiOf`.
  - `KF08 applyAI`: 빈 후보 키 → link(`by "ai"`, 'AI 추천: '로 시작) · 쓰인 키 → `taken` · 모르는 키 / `null` → `none`.
  - `KF09 ask`: 가짜 fetch 가 받은 본문 `mode === "kfolder"` · `items.length <= 10` · 헤더 `x-semis-token`; 실패 · 10초 넘김(가짜 타이머) → `{}`.
- [x] **Step 2: 돌려 실패를 본다** — Run: `T_ONLY='^KF' npm test` — Expected: KF01~09 FAIL(`SemisKfolder` 없음).
- [x] **Step 3: 구현한다.** 낱말 비교에 정규식을 만들면 escape(Review Focus 2).
- [x] **Step 4: 돌려 통과를 본다** — Run: `T_ONLY='^KF' npm test` → PASS, 그다음 `npm test` 전체 실패 0(스크립트 `defer` 시험 LG01 포함).
- [x] **Step 5: 커밋** — `K드라이브 새 폴더 알림 — 화면: 분류 추천(규칙 · AI)`

### Task 5: 화면 — 동기화 탭 '새 K 폴더' · 레일 배지 · 홈 '오늘' 한 줄

**Files:**
- Modify: `js/ksync.js` (`load` 59-78 · `alertOf` 55 · `poll` 94-100 · `pendHTML` 248-286 · `wire` 343~ · `mapForm` 417-463 · `window.SemisKsync` 652)
- Modify: `js/modules.js` (`todayHTML` 177-238 · 시스템 설정 `render` 600-640 — 열 탭 지정)
- Modify: `css/main.css` (줄 모양 · 꼬리표 — 기존 `.ks-*` 규칙 옆)
- Test: `tests/run-tests.cjs` ([KS] 묶음에 `KS-N1`~`KS-N9`)

**Interfaces:**
- Consumes: Task 2 RPC `semis_logi_ksync_newdirs` · `semis_logi_ksync_newdir_ack` · 상태 `newdirs`, Task 4 `SemisKfolder`, 기존 `semis_logi_ksync_map_save` · `targets()` · `storeLeft()` · `mapForm`.
- Produces:
  - `load()` 가 `semis_logi_ksync_newdirs` 를 함께 부른다(`.catch(() => null)` — 실패해도 나머지는 그림) → `st.nd`.
  - `alertOf()` 에 `st.s.newdirs && (st.s.newdirs.n > 0 || st.s.newdirs.gone > 0)`. `poll()` 과 `load()` 는 받은 `s.newdirs` 를 `st.ndc` 에 두고, 숫자가 바뀌었고 지금 주소가 홈(`dashboard`)이면 `SeMIS.renderView()` 로 다시 그린다(검색 입력칸이 없는 화면이라 §6-11 과 무관).
  - `SemisKsync.newdirs() → { n, n_link, gone } | null` — 홈 줄이 쓰는 숫자(새 요청 없음).
  - `pendHTML()` 의 탭 맨 앞에 `["new", "새 K 폴더 " + n]`(n > 0 이면 그 탭이 처음 고른 탭), 카드 머리 숫자에도 더함. 카드 ⋯(`c-rare`)에 [알림만 모두 확인].
  - 줄 · 단추는 spec §8 그대로: 꼬리표 `연결 결정` · `새 업무 폴더` · `연결 안 된 폴더 안` · `저절로 올라감` · `올리지 않음`; `link` 결과 `link` = [이대로 연결](`btn btn-ghost btn-sm`) · 글자 링크 [고쳐서 연결] · [연결 안 함]; `taken` · `moved` · `none` · `part` = [고쳐서 연결](part 없음) · [연결 안 함]; `top` = [확인]; `out` = [확인] · (`!unit_part && !unit_skip`) [고쳐서 연결]; `auto` · `excl` = [확인]. `auto` 의 표시는 `map.state` · `map.dir` 에 따라 spec §4 문장. `bytes50 > storeLeft()` 면 경고 한 줄.
  - 추천: 그릴 때 `link` 줄마다 `SemisKfolder.recommend(path, ctx)`(`out` 줄의 [고쳐서 연결]은 `recommend(unit, ctx)` 값으로 채움 — AI 없음); `none` 이고 `!part` 인 줄의 경로를 모아(아직 물은 적 없는 것만, 10개) `SemisKfolder.ask` 한 번 → `st.ai[path]` 에 두고 다시 그림(`applyAI`). 물은 경로는 다시 묻지 않음. 묻는 동안 그 줄 추천 자리에 '추천 찾는 중'.
  - [이대로 연결] → 단추 잠금 → `rpc("semis_logi_ksync_map_save", { p: { k_path: root + "/" + path, mod, grp, dir, ssi, since? } })`(since 빈 값이면 키 없음) → 성공: 알림 `연결을 만들었습니다 — Mac 이 건수를 세면(10분 안) 폴더 연결에서 [시작]하세요.` · `load()` · `paint()`; 거절: `ERR` 문구 알림 + `mapForm(null, null, 채울값)`.
  - `mapForm(m, kp0, pre)` — `pre = { k_path, mod, grp, ssi, dir, since }` 이면 K 폴더 칸(`#ks-kp-in` 또는 `#ks-kp`) · `#ks-tg` · `#ks-ssi` · `#ks-dir` · `#ks-since` 를 그 값으로. 기존 호출(`mapForm(m)` · `mapForm(null, kp)`)은 그대로.
  - [연결 안 함] → `newdir_ack({ paths: [path], act: "skip" })`, [확인] → `act: "seen"`, [알림만 모두 확인] → 지금 받은 `top` · `out` · `auto` · `excl` 머리 줄 경로 모두(300 이하) `seen` → 성공하면 `load()` · `paint()`.
  - 찾기 꺼짐(`st.nd && st.nd.on === false`) → 탭 자리 한 줄 `새 폴더 알림은 K드라이브 찾기를 켜야 동작합니다`; RPC 실패(`st.nd === null`) → 탭 자리 `새 폴더 목록을 불러오지 못했습니다`(알림 창 없음).
  - `modules.js`: `SeMIS.settingsTab(id: string, opt?: { pane?: string })` — 다음 시스템 설정 그리기에서 그 탭을 열고(`setTab = id`), `ksync` 면 `SemisKsync` 가 '확인 필요' 카드의 `opt.pane` 탭을 고른다. `todayHTML` 에 줄 하나(`SeMIS.isAdmin()` 이고 `SemisKsync.newdirs()` 의 `n + gone > 0` 일 때만, 보안교육 자격 줄 앞): `{ id: "td-knew", icon: "folder", color: n_link || gone ? "amber" : "slate", title: "K드라이브 새 폴더", sub: "연결 결정 " + n_link + " · 알림 " + (n - n_link) + (gone ? " · 연결 폴더 안 보임 " + gone : ""), val: n + gone, go: "settings" }` — 누르면 `SeMIS.settingsTab("ksync", { pane: "new" })`.

- [x] **Step 1: 실패하는 시험**(기존 [KS] 가짜 rpc · 시스템관리자 세션 도우미, 지어낸 경로):
  - `KS-N1 묶음`: `newdirs` 응답에 다섯 종류 + `gone` 1 → 탭 '새 K 폴더 6' 이 먼저 골라짐 · 경고 줄이 맨 위 · 꼬리표 · 종류별 단추 수(위 표) · `n: 305` 면 '전체 305줄 중 300줄'.
  - `KS-N2 [이대로 연결]`: 보내는 값 `{ k_path: "항공보안/업무1/둘째", mod, grp, dir: "k2h", ssi: false, since: "2025-08-01" }` · 확인 창 없음 · 두 번 눌러도 `map_save` 1회 · 성공 뒤 목록 다시 읽음 · `{ ok: false, error: "target_dup" }` → 알림 1번 + 연결 창이 채운 값으로 열림.
  - `KS-N3 [고쳐서 연결]`: 연결 창 `#ks-tg` 값 `audit|gov` · `#ks-dir` `k2h` · `#ks-ssi` 켜짐(경로에 `(SSI)`) · K 폴더 칸 = 전체 경로; `out` 줄은 단위 둘째 폴더 경로로 채움.
  - `KS-N4 처리`: [연결 안 함] → `{ paths: [path], act: "skip" }` · [확인] → `seen` · [알림만 모두 확인] → `link` 를 뺀 머리 줄 모두 `seen`.
  - `KS-N5 AI`: 규칙이 못 맞춘 `link` 줄 12개 → `fetch` 1회 · 본문 `items` 10개 · 결과 반영(`AI 추천:`) · 다시 그려도 fetch 늘지 않음 · fetch 실패 → '알맞은 분류가 없습니다' 문구.
  - `KS-N6 배지`: 상태 `newdirs: { n: 1, n_link: 0, gone: 0 }` · 다른 조건 없음 → `alert` true → `SemisKsync.badge() === "확인"`; 탭이 열린 동안 `alertOf()` 도 같음.
  - `KS-N7 홈 줄`: 시스템관리자 · `n: 3, n_link: 1, gone: 1` → '오늘' 에 `#td-knew`(제목 · '연결 결정 1 · 알림 2 · 연결 폴더 안 보임 1' · 값 4); 누르면 시스템 설정 › K드라이브 동기화 탭 · 새 K 폴더 칸; 숫자 0 이면 줄 없음; 안전보안파트(hq) 세션이면 줄 없음.
  - `KS-N8 실패 · 꺼짐`: `newdirs` RPC 404 → 다른 카드 그대로 · 탭 자리 한 줄 · 알림 창 없음; `{ on: false }` → 찾기 켜기 안내 한 줄.
  - `KS-N9 저장소`: `bytes50` 이 `storeLeft()` 보다 크면 그 줄에 '남은 저장소보다 큼' 경고, 작으면 없음.
- [x] **Step 2: 돌려 실패를 본다** — Run: `T_ONLY='^KS-N' npm test` — Expected: KS-N1~9 FAIL.
- [x] **Step 3: 구현한다.** 함수 첫 줄에서 `if (!SeMIS.isAdmin()) return;`(단추 처리 · 처리 RPC · 연결 · AI 호출 모두).
- [x] **Step 4: 돌려 통과를 본다** — `T_ONLY='^KS' npm test` → PASS, 그다음 `npm test` 전체 실패 0(KS01 · KS12 등 기존 기대값이 탭 수 · 카드 숫자 때문에 바뀌면 그 이유를 커밋 메시지에).
- [x] **Step 5: 브라우저 확인**(HANDOFF §6-3 — 운영 DB 비-GET 차단, 가짜 응답): 동기화 탭 새 K 폴더 칸 · 홈 '오늘' 줄을 390px · 1024px 에서 넘침 없이. playwright 가 없으면 확인 못 했다고 기록. — playwright 없음, 확인 못 함(HANDOFF §7 에 기록).
- [x] **Step 6: 커밋** — `K드라이브 새 폴더 알림 — 화면: 동기화 탭 새 K 폴더 · 배지 · 홈 오늘 한 줄`

### Task 6: E2E · 문서 · 버전 1.74.0

**Files:**
- Modify: `tools/ksync/test/e2e.test.mjs` (19-18 kidx 묶음 뒤 `19-19`)
- Modify: `docs/KSYNC.md` (§1 표의 마이그레이션 목록 · §5 대시보드 한 줄 · §8 운영 적용 순서에 v1.74 · 새 §11 '새 폴더 알림 (v1.74)')
- Modify: `docs/HANDOFF.md` (§1 현재 버전 · 테스트 수 · §7 'K드라이브 새 폴더 알림(v1.74.0) — 운영 적용 전' 과 적용 순서(spec §11) · §8 작업 기록)
- Modify: 버전 스탬프(`node tools/bump-version.cjs 1.74.0` 이 고치는 파일 전부) · `package.json` · `package-lock.json`
- Modify: `docs/superpowers/plans/2026-11-15-k-new-folder.md`(이 파일 — 끝낸 칸 체크)

**Interfaces:**
- Consumes: Task 1 · 2 의 SQL(실제 Edge `semis-logi-ksync` 코드 ↔ 실제 SQL 을 PGlite 로 — 기존 E2E 와 같음).

- [x] **Step 1: 실패하는 E2E**(`19-19`): 임시 K 의 `항공보안` 에서 회차 1(첫 걷기 = 기준선) → `semis_logi_ksync_newdirs` 의 `n` 0 → 새 폴더 `업무9/새둘째` 와 이미 있는 연결 폴더 안 `…/2027` 을 만들고 다음 날 회차(상태 파일 `kidxDay` 를 어제로) → `link` 1 · `auto` 1 → `map_save` 로 `항공보안/업무9/새둘째` 연결 → `link` 빠짐 → `auto` 경로 `newdir_ack seen` → `n` 0 · 상태 `alert` 이 새 폴더 때문에 켜지지 않음. K 에 아무것도 쓰지 않았는지(걷기 전후 임시 K 나무 같음).
- [x] **Step 2: 돌려 실패 → 통과를 본다** — Run: `node tools/ksync/test/e2e.test.mjs` — Expected: 새 묶음 통과, 기존 287건 그대로. `node tools/ksync/test/plan.test.mjs` 도 그대로(405).
- [x] **Step 3: 버전 · 문서** — `node tools/bump-version.cjs 1.74.0` · package 두 파일. KSYNC §11 은 spec §4 · §6 · §8 의 규칙을 운영자 말로(누가 보나 · 무엇이 뜨나 · 단추 · 한계 · 되돌리기 SQL). HANDOFF §7 은 spec §11 순서(마이그레이션 38 → Edge argo 재배포 → main 병합 → 확인, Mac 재설치 없음). 실제 K 이름 · 서버 값 금지.
- [x] **Step 4: 시험 5종 모두** — 위 Global Constraints 의 명령 5개 모두 실패 0. 숫자(건수)를 HANDOFF §1 테스트 칸에.
- [x] **Step 5: 커밋** — `v1.74.0 K드라이브 새 폴더 알림 · 분류 추천 — E2E · 문서`
