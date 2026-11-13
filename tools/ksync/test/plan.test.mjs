// K드라이브 동기화 계획(plan.mjs) · 도우미(lib.mjs) 단위 시험 — 의존성 없음. 실행: node tools/ksync/test/plan.test.mjs (npm test 가 함께 돌림)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { plan, excluded, safeName, conflictName, limitHit, holdHit, CONFLICT_RE, K_BLOCK, H_BLOCK, MAX_SIZE, PREV, TRASH } from "../plan.mjs";
import fsp from "node:fs/promises";
import * as LIB from "../lib.mjs";
import { relOk, safeAbs, parseSmb, checkConfig, kstDay, kstMin, hhmm, indexDir, moveAside, moveNew, folderTree, place, conflictPath, netRetry, mountUrl, lock, agentPid, makeClient, PACE, dailyWin, winText } from "../lib.mjs";
import { runAgent } from "../ksync.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("✗", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + " — got " + JSON.stringify(a) + " want " + JSON.stringify(b));
const H = (c) => c.repeat(64).slice(0, 64);
const MAP = { id: 1, dir: "both", ssi: false, state: "active", hold: null };
const LIM = { files: 200, ratio: 0.3, min: 20 };
const T = Date.parse("2026-11-04T00:00:00Z");
const row = (id, rel, o) => Object.assign({ id, rel_path: rel, k_size: 1, k_mtime: new Date(T).toISOString(), k_sha256: H(String(id % 10)), doc_id: "d" + id, ser: "s" + id,
  h_url: "u" + id, h_name: rel.split("/").pop(), h_size: 1, state: "ok", note: "" }, o || {});
const kOf = (r, o) => Object.assign({ rel: r.rel_path, size: r.k_size, mtime: T, sha: r.k_sha256 }, o || {});
const hOf = (r, o) => Object.assign({ doc: r.doc_id, ser: r.ser, name: r.h_name, url: r.h_url, size: r.h_size, at: new Date(T).toISOString(), date: "2026-11-04", title: "t" }, o || {});
const P = (o) => plan(Object.assign({ map: MAP, baseline: [], kList: [], hList: [], limit: LIM, today: "2026-11-04" }, o));
const ops = (p) => p.actions.map(a => a.op + ":" + (a.mode || a.state || a.kind || "") + ":" + (a.rel || a.f || ""));

/* 이름 규칙 */
["~$a.docx", ".DS_Store", "._x.pdf", "Thumbs.db", "desktop.ini", "a.TMP", ".hidden", "a (충돌 2026-11-04).xlsx", "a (충돌 2026-11-04 2).xlsx"].forEach(n => ok(excluded(n, false), "제외 " + n));
["a.xlsx", "가.pdf", "충돌 정리.xlsx", "a (충돌).xlsx"].forEach(n => ok(!excluded(n, false), "포함 " + n));
ok(excluded("_H드라이브_휴지통", true) && excluded("_H드라이브_이전판", true) && !excluded("업무", true), "동기화 폴더 제외");
eq([safeName("../../x.pdf"), safeName("a/b\\c:d.pdf"), safeName(".env"), safeName("~$a.docx"), safeName("가".normalize("NFD") + ".pdf")],
  ["_.._.._x.pdf", "a_b_c_d.pdf", "_.env", "_~$a.docx", "가.pdf"], "H 이름 → K 이름(경로 탈출 · 숨김 · NFC)");
eq(conflictName("d/a.xlsx", "2026-11-04", 1), "d/a (충돌 2026-11-04).xlsx", "충돌 사본 이름");
ok(CONFLICT_RE.test(conflictName("a.xlsx", "2026-11-04", 3)), "충돌 사본은 색인 제외 대상");
["a.exe", "b.BAT", "c.ps1", "d.command", "e.lnk", "f.html", "g.js", "h.app", "i.jar"].forEach(n => ok(K_BLOCK.test(n), "K 차단 " + n));
["a.pdf", "b.xlsx", "c.json", "d.hwp"].forEach(n => ok(!K_BLOCK.test(n), "K 허용 " + n));
/* 탐색기에서 폴더를 보기만 해도 밖으로 접속(.scf · .library-ms · .searchConnector-ms)하거나 열면 코드가 도는 형식 · 디스크 이미지 · html 류 */
["x.scf", "y.library-ms", "z.searchConnector-ms", "m.chm", "n.ISO", "o.vhdx", "p.xhtml", "q.svg", "r.mht", "s.settingcontent-ms", "t.appref-ms", "u.application", "v.ps1xml", "w.msc", "x.rdp", "y.website"]
  .forEach(n => ok(K_BLOCK.test(n), "K 차단(보기 · 열기만 해도 동작) " + n));
["e.docx", "f.png", "g.zip", "h.csv", "i.txt", "j.pptx", "k.hwpx", "news.txt"].forEach(n => ok(!K_BLOCK.test(n), "K 허용 " + n));
ok(H_BLOCK.test("x.htm") && H_BLOCK.test("x.mjs") && !H_BLOCK.test("x.exe"), "H 차단 = 파일 함수와 같은 뜻");
eq([limitHit(200, 1000, LIM), limitHit(201, 1000, LIM), limitHit(19, 20, LIM), limitHit(20, 60, LIM), limitHit(20, 70, LIM), limitHit(5, 0, LIM)], [false, true, false, true, false, false], "대량 변경 한도");

/* 새 파일 · 링크 · 멱등 */
let p = P({ kList: [{ rel: "a.xlsx", size: 3, mtime: T, sha: H("a") }], hList: [{ doc: "h1", ser: "h1", name: "h.pdf", url: "uh", size: 4 }] });
eq(ops(p), ["put:new:a.xlsx", "get::h.pdf"], "K 에만 · H 에만 새 것");
eq([p.counts.k2h, p.counts.h2k, p.n], [1, 1, 0], "새 것은 변경 수에 안 셈");
p = P({ kList: [{ rel: "2025/h.pdf", size: 4, mtime: T, sha: H("a") }], hList: [{ doc: "h1", ser: "h1", name: "h.pdf", url: "uh", size: 4 }] });
eq(ops(p), ["link::2025/h.pdf"], "이름 · 크기가 같으면 연결만(첫 동기화 중복 방지)");
const B = [row(1, "a.xlsx"), row(2, "d/b.pdf")];
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: B.map(r => hOf(r)) });
eq([p.actions.length, p.counts.total], [0, 0], "맞춘 상태 → 할 일 0");
p = P({ baseline: B, kList: [kOf(B[0], { rel: "a.xlsx".normalize("NFD") }), kOf(B[1])], hList: B.map(r => hOf(r)) });
eq(p.actions.length, 0, "NFD 이름도 같은 파일");

/* 한쪽만 바뀜 */
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: B.map(r => hOf(r)) });
eq([ops(p), p.n], [["put:version:a.xlsx"], 1], "K 만 바뀜 → 새 판(변경 1)");
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[0], { url: "new" }), hOf(B[1])] });
eq([ops(p), p.actions[0].backup, p.actions[0].over, p.n], [["get::a.xlsx"], "a.xlsx", true, 1], "H 만 바뀜 → K 덮어쓰기(옛 파일 이전판)");
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[0], { url: "new", name: "a_v2.xlsx" }), hOf(B[1])] });
eq(ops(p), ["get::a_v2.xlsx"], "H 새 판 이름이 다르면 그 이름으로(옛 파일은 이전판)");
p = P({ map: Object.assign({}, MAP, { dir: "h2k" }), baseline: B, kList: [kOf(B[0], { sha: H("z") }), kOf(B[1])], hList: B.map(r => hOf(r)) });
eq(ops(p), ["state:skip:a.xlsx"], "H→K 만인 연결은 K 변경을 올리지 않음");
p = P({ map: Object.assign({}, MAP, { dir: "k2h" }), baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[0], { url: "n" }), hOf(B[1])] });
eq(ops(p), ["state:skip:a.xlsx"], "K→H 만인 연결은 H 변경을 쓰지 않음");

/* 이름 바꿈 · 이동 */
p = P({ baseline: B, kList: [kOf(B[0], { rel: "new/a2.xlsx" }), kOf(B[1])], hList: B.map(r => hOf(r)) });
eq([ops(p), p.n], [["rename::new/a2.xlsx"], 0], "같은 해시가 다른 경로 → 이름 바꿈(기준선만)");
p = P({ baseline: B, kList: [kOf(B[0], { rel: "x.xlsx" }), kOf(B[0], { rel: "y.xlsx" }), kOf(B[1])], hList: B.map(r => hOf(r)) });
eq(ops(p).sort(), ["put:new:x.xlsx", "put:new:y.xlsx", "state:del_k:a.xlsx"].sort(), "같은 해시 둘 → 이름 바꿈으로 보지 않음");

/* 충돌 */
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("k"), mtime: T + 1000 }), kOf(B[1])], hList: [hOf(B[0], { url: "nh", at: new Date(T).toISOString() }), hOf(B[1])] });
eq([ops(p), p.counts.conflict, p.n], [["put:version:a.xlsx", "get::a (충돌 2026-11-04).xlsx"], 1, 2], "K 가 늦음 → H 새 판 + K 에 H 쪽 사본");
ok(p.actions[1].copy && p.actions[0].state === "conflict", "사본 · 충돌 표시");
eq(p.actions[0].h_url, "nh", "K 가 이긴 충돌 새 판은 계획이 본 H 판 주소를 함께 보냄(등록 전에 H 가 또 고치면 서버가 등록하지 않음)");
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("k"), mtime: T - 1000 }), kOf(B[1])], hList: [hOf(B[0], { url: "nh" }), hOf(B[1])] });
eq([ops(p), p.n], [["kconf::a.xlsx", "get:conflict:a.xlsx", "put:old:a (충돌 2026-11-04).xlsx"], 1], "H 가 늦음 → K 파일 사본 이름 · H 현재 판 · K 쪽은 H 이전 판");
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("k"), mtime: T - 1000 }), kOf(B[1])], hList: [hOf(B[0], { url: "nh", name: "a.exe" }), hOf(B[1])] });
eq(ops(p), ["state:skip:a.xlsx", "event:type_block:a.exe"], "H 가 이겨도 실행 파일이면 K 를 건드리지 않음");

/* 삭제 대기 · 확정 · 복원 */
p = P({ baseline: B, kList: [kOf(B[1])], hList: B.map(r => hOf(r)) });
eq([ops(p), p.n], [["state:del_k:a.xlsx"], 1], "K 에서 지움 → 삭제 대기(H 그대로)");
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[1])] });
eq(ops(p), ["state:del_h:a.xlsx"], "H 에서 지움 → 삭제 대기(K 그대로)");
const pend = [row(1, "a.xlsx", { state: "del_k" }), B[1]];
p = P({ baseline: pend, kList: [kOf(B[1])], hList: B.map(r => hOf(r)) });
eq([p.actions.length, p.n, p.counts.del], [0, 0, 1], "대기 중이면 다시 세지 않음");
p = P({ baseline: [row(1, "a.xlsx", { state: "trash" }), B[1]], kList: B.map(r => kOf(r)), hList: [hOf(B[1])] });
eq(ops(p), ["trash::a.xlsx"], "H 삭제 확정 → K 휴지통");
p = P({ baseline: [row(1, "a.xlsx", { state: "restore" }), B[1]], kList: B.map(r => kOf(r)), hList: [hOf(B[1])] });
eq(ops(p), ["put:new:a.xlsx"], "복원(H 쪽)");
p = P({ baseline: [row(1, "a.xlsx", { state: "restore" }), B[1]], kList: [kOf(B[1])], hList: B.map(r => hOf(r)) });
eq([ops(p), p.n], [["get::a.xlsx"], 0], "복원(K 쪽) — 변경 수에 안 셈");
p = P({ baseline: B, kList: [kOf(B[1])], hList: [hOf(B[1])] });
eq(ops(p), ["drop::"], "양쪽 다 없음 → 기준선 정리");

/* 삭제 대기 중에 다른 쪽이 고침 — 고친 것이 삭제 대기보다 우선(그대로 두면 [삭제 확정]이 상대가 본 적 없는 판까지 지운다) */
const dk = [row(1, "a.xlsx", { state: "del_k" }), B[1]];
p = P({ baseline: dk, kList: [kOf(B[1])], hList: [hOf(B[0], { url: "new" }), hOf(B[1])] });
eq([ops(p), (p.actions[0] || {}).row, (p.actions[0] || {}).state || "", p.counts.del], [["get::a.xlsx"], 1, "", 0], "K 에서 지운 뒤 H 새 판 → K 로 받음(같은 줄 · 대기 풀림)");
p = P({ baseline: dk, kList: [kOf(B[1])], hList: [hOf(B[0], { url: "new", name: "a_v2.xlsx" }), hOf(B[1])] });
eq(ops(p), ["get::a_v2.xlsx"], "K 에서 지운 뒤 H 새 판(다른 이름) → 그 이름으로 받음");
p = P({ map: Object.assign({}, MAP, { dir: "k2h" }), baseline: dk, kList: [kOf(B[1])], hList: [hOf(B[0], { url: "new" }), hOf(B[1])] });
eq([ops(p), p.counts.del], [[], 1], "K→H 만인 연결 → 그대로 삭제 대기(H 판을 K 로 쓰지 않음)");
/* K→H 만인 연결에서 [삭제 확정]을 서버가 거절(충돌 'H 에 새 판') — 다음 실행이 다시 삭제 대기로 돌리면 확정 · 거절을 끝없이 되풀이(매번 변경 수로도 셈) */
const K2H = Object.assign({}, MAP, { dir: "k2h" });
p = P({ map: K2H, baseline: [row(1, "a.xlsx", { state: "conflict", note: "H 에 새 판" }), B[1]], kList: [kOf(B[1])], hList: [hOf(B[0], { url: "new" }), hOf(B[1])] });
eq([ops(p), (p.actions[0] || {}).note, p.n, p.counts.del], [["state:skip:a.xlsx"], "dir", 0, 0], "K→H 만 · 서버가 확정을 거절한 줄 → 삭제 대기로 되돌리지 않고 건너뜀(dir · 변경 수 0)");
p = P({ map: K2H, baseline: [row(1, "a.xlsx", { state: "skip", note: "dir" }), B[1]], kList: [kOf(B[1])], hList: [hOf(B[0], { url: "new" }), hOf(B[1])] });
eq([ops(p), p.n], [[], 0], "K→H 만 · 다음 실행은 그대로(되풀이 없음)");
p = P({ map: K2H, baseline: B, kList: [kOf(B[1])], hList: [hOf(B[0], { url: "new" }), hOf(B[1])] });
eq([ops(p), p.n, p.counts.del], [["state:skip:a.xlsx"], 0, 0], "K→H 만 · K 에서 지운 뒤 H 새 판 → 확정할 수 없는 삭제 대기 대신 건너뜀(dir)");
const dh = [row(1, "a.xlsx", { state: "del_h" }), B[1]];
p = P({ baseline: dh, kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: [hOf(B[1])] });
eq([ops(p), (p.actions[0] || {}).row, p.counts.del, p.n], [["put:new:a.xlsx"], 1, 0, 0], "H 에서 지운 뒤 K 수정 → H 로 다시 올림(같은 줄 · 대기 풀림)");
p = P({ map: Object.assign({}, MAP, { dir: "h2k" }), baseline: dh, kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: [hOf(B[1])] });
eq([ops(p), p.counts.del], [[], 1], "H→K 만인 연결 → 그대로 삭제 대기");
const tr = [row(1, "a.xlsx", { state: "trash" }), B[1]];
p = P({ baseline: tr, kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: [hOf(B[1])] });
eq([ops(p), (p.actions[0] || {}).state, (p.actions[1] || {}).note, p.counts.conflict], [["put:new:a.xlsx", "state:conflict:a.xlsx"], "conflict", "K 에서 고친 뒤 삭제 확정", 1],
  "삭제 확정 뒤 K 수정 → 휴지통으로 옮기지 않고 H 로 다시 올림 · 충돌로 남김");
p = P({ baseline: tr, kList: B.map(r => kOf(r)), hList: [hOf(B[1])] });
eq([ops(p), (p.actions[0].k || {}).size, (p.actions[0].k || {}).mtime], [["trash::a.xlsx"], 1, T], "삭제 확정 · K 그대로 → 휴지통(옮기기 직전에 대 볼 색인 값)");
p = P({ map: Object.assign({}, MAP, { dir: "h2k" }), baseline: tr, kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: [hOf(B[1])] });
eq([ops(p), (p.actions[0] || {}).row, p.counts.skip, p.counts.conflict, p.detail.map(d => d.a + ":" + d.r)], [["drop::"], 1, 1, 0, ["skip:K 에서 고친 뒤 삭제 확정 · K 에 남김"]],
  "H→K 만 · 삭제 확정 뒤 K 수정 → 휴지통으로 옮기지 않음(K 수정을 H 로 보낼 수 없어 업무 폴더에서 사라짐) · K 파일은 두고 기준선만 지움");
p = P({ map: Object.assign({}, MAP, { dir: "h2k" }), baseline: [B[1]], kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: [hOf(B[1])] });
eq([ops(p), p.n], [[], 0], "H→K 만 · 다음 실행: K 에 남긴 파일은 할 일 없음(삭제 대기 · 확정을 되풀이하지 않음)");
p = P({ map: Object.assign({}, MAP, { dir: "h2k" }), baseline: tr, kList: B.map(r => kOf(r)), hList: [hOf(B[1])] });
eq(ops(p), ["trash::a.xlsx"], "H→K 만 · 삭제 확정 · K 그대로 → 확정한 대로 휴지통");

/* 등록에서 빠진 올리기(그 사이 H 가 새 판) — 다음 실행은 '오류' 줄도 보통 충돌로 본다(늦게 고친 쪽이 현재 판, 다른 쪽은 남김) */
const er = [row(1, "a.xlsx", { state: "error", note: "apply" }), B[1]];
p = P({ baseline: er, kList: [kOf(B[0], { sha: H("k"), mtime: T + 1000 }), kOf(B[1])], hList: [hOf(B[0], { url: "nh", at: new Date(T).toISOString() }), hOf(B[1])] });
eq([ops(p), p.actions[0].state], [["put:version:a.xlsx", "get::a (충돌 2026-11-04).xlsx"], "conflict"], "오류 줄 · 양쪽 바뀜 · K 가 늦음 → H 새 판 + K 에 H 쪽 사본");
p = P({ baseline: er, kList: [kOf(B[0], { sha: H("k"), mtime: T - 1000 }), kOf(B[1])], hList: [hOf(B[0], { url: "nh" }), hOf(B[1])] });
eq(ops(p), ["kconf::a.xlsx", "get:conflict:a.xlsx", "put:old:a (충돌 2026-11-04).xlsx"], "오류 줄 · 양쪽 바뀜 · H 가 늦음 → K 쪽은 H 이전 판 · K 사본");

/* 건너뜀 */
p = P({ kList: [{ rel: "big.zip", size: MAX_SIZE + 1, mtime: T, sha: null }, { rel: "x.html", size: 1, mtime: T, sha: H("h") }], hList: [{ doc: "e", ser: "e", name: "run.bat", url: "ue", size: 1 }] });
eq([ops(p), p.counts.skip], [["event:type_block:run.bat"], 3], "50MB · html · 실행 파일");
p = P({ hList: [{ doc: "f", ser: "f", name: "manual.chm", url: "uf", size: 1 }, { doc: "g", ser: "g", name: "x.scf", url: "ug", size: 1 }] });
eq(ops(p), ["event:type_block:manual.chm", "event:type_block:x.scf"], "H 의 .chm · .scf → K 에 쓰지 않음 · 차단 기록");
p = P({ hList: [{ doc: "s", ser: "s", name: "s.pdf", url: "us", size: 1, ssi: true }] });
eq(p.actions.length, 0, "SSI 아닌 연결은 SSI 문서 안 받음");
p = P({ kList: [{ rel: "a.pdf", size: 1, mtime: T, sha: H("q") }], hList: [{ doc: "x", ser: "x", name: "a.pdf", url: "ux", size: 9 }] });
eq(ops(p), ["put:new:a.pdf", "get::a (2).pdf"], "같은 이름 다른 파일 → 새 이름");

/* S4 뒤 — SSI 아닌 연결에서 현재 판이 SSI 인 판 묶음({ser, hidden}): H 에 있으나 내용은 모름 — 'H 에서 지움' · 받기 · K 삭제 대기 모두 아님 */
const HID = { ser: B[0].ser, hidden: true };
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [HID, hOf(B[1])] });
eq([ops(p), p.n, p.counts.del], [[], 0, 0], "숨은 판 묶음 · K 그대로 → 할 일 없음(H 에서 지움 아님)");
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[1])] });
eq(ops(p), ["state:del_h:a.xlsx"], "판 묶음이 정말 없으면 그대로 'H 에서 지움'");
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: [HID, hOf(B[1])] });
eq([ops(p), p.n], [["put:version:a.xlsx"], 1], "숨은 판 묶음 · K 수정 → 새 판(서버가 docs-ssi 에 둠 · 변경 1)");
p = P({ baseline: B, kList: [kOf(B[1])], hList: [HID, hOf(B[1])] });
eq([ops(p), p.actions[0].note, p.n, p.counts.del, p.counts.skip], [["state:skip:a.xlsx"], "ssi", 0, 0, 1], "숨은 판 묶음 · K 에서 지움 → 건너뜀(ssi) · 삭제 대기 아님");
p = P({ baseline: [row(1, "a.xlsx", { state: "skip", note: "ssi" }), B[1]], kList: [kOf(B[1])], hList: [HID, hOf(B[1])] });
eq(p.actions.length, 0, "건너뜀(ssi) 표시는 다시 보내지 않음");
for (const st of ["del_h", "del_k"]) {
  p = P({ baseline: [row(1, "a.xlsx", { state: st }), B[1]], kList: B.map(r => kOf(r)), hList: [HID, hOf(B[1])] });
  eq([ops(p), p.n], [["state:ok:a.xlsx"], 0], "숨은 판 묶음 · K 있음 · 대기 " + st + " → 정상으로");
}
p = P({ baseline: [row(1, "a.xlsx", { state: "skip", note: "ssi" }), B[1]], kList: B.map(r => kOf(r)), hList: [HID, hOf(B[1])] });
eq(ops(p), ["state:ok:a.xlsx"], "건너뜀(ssi) 뒤 K 파일이 그대로 돌아옴 → 정상으로");
p = P({ baseline: [row(1, "a.xlsx", { state: "del_k" }), B[1]], kList: [kOf(B[1])], hList: [HID, hOf(B[1])] });
eq([p.actions.length, p.counts.del], [0, 1], "이미 K 삭제 대기면 그대로(관리자 판단)");
p = P({ map: Object.assign({}, MAP, { dir: "h2k" }), baseline: B, kList: [kOf(B[0], { sha: H("z") }), kOf(B[1])], hList: [HID, hOf(B[1])] });
eq([ops(p), p.actions[0].note], [["state:skip:a.xlsx"], "dir"], "H→K 만인 연결 · K 수정 → 건너뜀(dir)");
p = P({ baseline: [row(1, "a.xlsx", { state: "restore" }), B[1]], kList: B.map(r => kOf(r)), hList: [HID, hOf(B[1])] });
eq(ops(p), ["put:new:a.xlsx"], "복원(H 쪽)은 관리자가 고른 대로");
const MB = [row(1, "m1.pdf", { ser: "m" }), row(2, "m2.pdf", { ser: "m" })];
p = P({ baseline: MB, kList: MB.map(r => kOf(r)), hList: [hOf(MB[1]), { ser: "m", hidden: true }] });
eq(ops(p), [], "여러 첨부 중 하나만 숨음 — 보이는 첨부는 짝짓고, 숨은 첨부도 지운 것으로 보지 않음");
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[0]), { ser: "new", hidden: true }] });
eq(ops(p), ["state:del_h:d/b.pdf"], "숨은 표시는 H 에만 있는 문서로 받지 않음 · 다른 판 묶음에 번지지 않음");

/* 대량 변경 보류 */
const many = Array.from({ length: 70 }, (_, i) => row(i + 1, "f" + i + ".pdf", { k_sha256: H("a").slice(0, 60) + String(1000 + i) }));
p = P({ baseline: many, kList: many.map((r, i) => kOf(r, i < 25 ? { sha: H("z").slice(0, 60) + String(1000 + i) } : {})), hList: many.map(r => hOf(r)) });
eq([p.held, p.n, p.actions.length, p.planned.length], [true, 25, 0, 25], "30% 넘음(25/70) → 보류 · 실행 없음");
p = P({ baseline: many, kList: many.map((r, i) => kOf(r, i < 19 ? { sha: H("z").slice(0, 60) + String(1000 + i) } : {})), hList: many.map(r => hOf(r)) });
eq(p.held, false, "20건 미만은 비율 안 봄");
p = P({ map: Object.assign({}, MAP, { hold: { ok: true, n: 25 } }), baseline: many, kList: many.map((r, i) => kOf(r, i < 25 ? { sha: H("z").slice(0, 60) + String(1000 + i) } : {})), hList: many.map(r => hOf(r)) });
eq([p.held, p.actions.length], [false, 25], "승인되면 진행");
p = P({ map: Object.assign({}, MAP, { hold: { run: 3 } }), baseline: B, kList: B.map(r => kOf(r)), hList: B.map(r => hOf(r)) });
eq(p.held, true, "승인 전 보류는 그대로");
/* 승인한 보류는 승인한 만큼만 — 보류 때 센 수(hold.n) + 한도(files)까지. 승인 뒤(전송량 상한으로 여러 날 이어질 때) 새로 생긴 대량 변경은 다시 보류 */
const big = Array.from({ length: 300 }, (_, i) => row(i + 1, "g" + i + ".pdf", { k_sha256: H("b").slice(0, 60) + String(1000 + i) }));
const bigP = (hold, m) => P({ map: Object.assign({}, MAP, { hold }), baseline: big, kList: big.map((r, i) => kOf(r, i < m ? { sha: H("y").slice(0, 60) + String(1000 + i) } : {})), hList: big.map(r => hOf(r)) });
p = bigP({ ok: true, n: 25 }, 226);
eq([p.n, p.held, p.actions.length], [226, true, 0], "승인(25건) + 한도(200)를 넘음 → 다시 보류");
p = bigP({ ok: true, n: 25 }, 115);
eq([p.n, p.held, p.actions.length], [115, false, 115], "승인(25건)을 넘는 몫이 한도 안(90건 = 300건의 30%)이면 진행");
/* 넘는 몫은 비율 한도도 본다 — 건수(files)만 보면 작은 연결은 승인이 남아 있는 동안 폴더를 통째로 지우거나 덮어도 지나간다 */
p = bigP({ ok: true, n: 25 }, 116);
eq([p.n, p.held, p.actions.length], [116, true, 0], "승인(25건)을 넘는 몫(91건)이 300건의 30%를 넘음 → 다시 보류");
const small = Array.from({ length: 30 }, (_, i) => row(i + 1, "s" + i + ".pdf", { k_sha256: H("c").slice(0, 60) + String(1000 + i) }));
p = P({ map: Object.assign({}, MAP, { hold: { ok: true, n: 3 } }), baseline: small, kList: [], hList: small.map(r => hOf(r)) });
eq([p.n, p.held, p.actions.length], [30, true, 0], "작은 연결(30건) · 승인(3건) 뒤 K 폴더를 통째로 지움 → 다시 보류");
p = bigP({ ok: true, at: "x", first: true }, 201);
eq(p.held, true, "[시작] 승인에 건수가 없으면 한도까지만");
/* H 가 첨부를 뺀 판 묶음(같은 판 묶음이 H 에 남음)의 기준선 줄을 K 가 고침 — '새 문서'로 보내도 서버(put_begin)가 새 판으로 바꿔 센다.
   계획이 세지 않으면 보류 때 센 수(hold.n)가 모자라 승인한 뒤에도 서버가 다시 보류한다(승인 한 번에 한도만큼씩만 지나감) */
const MS = [row(1, "m1.pdf", { ser: "m" }), row(2, "m2.pdf", { ser: "m" })];
p = P({ baseline: MS, kList: [kOf(MS[0], { sha: H("z"), size: 2 }), kOf(MS[1])], hList: [hOf(MS[1])] });
eq([ops(p), p.n], [["put:new:m1.pdf"], 1], "#16 H 가 뺀 첨부를 K 가 고침 → 새 문서로 보내지만 변경 수로 셈(서버와 같음)");
p = P({ baseline: [row(1, "m1.pdf", { ser: "m", state: "restore" }), MS[1]], kList: MS.map(r => kOf(r)), hList: [hOf(MS[1])] });
eq([ops(p), p.n], [["put:new:m1.pdf"], 0], "#16 관리자가 고른 복원은 판 묶음이 H 에 있어도 세지 않음(서버와 같음)");
p = P({ baseline: [row(1, "m1.pdf", { ser: "m", state: "del_h" }), MS[1]], kList: [kOf(MS[0], { sha: H("z"), size: 2 }), kOf(MS[1])], hList: [hOf(MS[1])] });
eq([ops(p), p.n], [["put:new:m1.pdf"], 1], "#16 'H 에서 지움' 대기 중 K 수정(판 묶음이 H 에 남음) → 셈");
for (const [hl, nm] of [[[hOf(MS[1])], "H 에 남음"], [[{ ser: "m", hidden: true }], "숨은 판 묶음"]]) {
  p = P({ baseline: [row(1, "m1.pdf", { ser: "m", state: "trash" }), MS[1]], kList: [kOf(MS[0], { sha: H("z"), size: 2 }), kOf(MS[1])], hList: hl });
  eq([ops(p), p.n], [["put:new:m1.pdf", "state:conflict:m1.pdf"], 1], "#16 삭제 확정 뒤 K 수정 · 판 묶음이 " + nm + " → 서버가 새 판으로 셈 · 계획도 셈");
}
const ms = Array.from({ length: 45 }, (_, i) => row(i + 1, "n" + i + ".pdf", { ser: "S", k_sha256: H("a").slice(0, 60) + String(1000 + i) }));
const msK = ms.map((r, i) => kOf(r, i ? { sha: H("e").slice(0, 60) + String(1000 + i), size: 2 } : {}));
p = P({ baseline: ms, kList: msK, hList: [hOf(ms[0])] });
eq([p.n, p.held, p.planned.filter(a => a.op === "put" && a.mode === "new").length], [44, true, 44], "#16 첨부 45 중 H 가 하나만 남긴 판 · K 가 나머지 44 를 고침 → 44 건 · 보류");
p = P({ map: Object.assign({}, MAP, { hold: { ok: true, n: p.n } }), baseline: ms, kList: msK, hList: [hOf(ms[0])] });
eq([p.held, p.actions.length], [false, 44], "#16 그 건수로 승인 → 한 번에 진행(서버도 같은 수를 세어 다시 보류하지 않음)");
eq([holdHit(5, 10, LIM, { run: 3 }), holdHit(0, 0, LIM, null), holdHit(201, 0, LIM, null), holdHit(230, 1000, { files: 10 }, { ok: true, n: 220 }), holdHit(231, 1000, { files: 10 }, { ok: true, n: 220 })],
  [true, false, true, false, true], "보류 규칙(서버 ksync_count 와 같음)");

/* A1 색인 오류 — 읽지 못한 파일 · 폴더(그 아래 전부)는 '모름': K 삭제로도, H 로 덮어쓸 곳으로도 보지 않는다 */
const E = [row(1, "a.xlsx"), row(2, "d/b.pdf"), row(3, "d/e/c.pdf"), row(4, "z.pdf")];
const EERR = [{ f: "d", r: "EACCES", dir: true }, { f: "a.xlsx", r: "EBUSY" }];
p = P({ baseline: E, kList: [kOf(E[3])], kErr: EERR, hList: E.map(r => hOf(r)) });
eq([ops(p), p.n, p.counts.del, p.fatal], [[], 0, 0, ""], "A1 읽지 못한 파일 · 폴더 아래 → 삭제 대기 아님");
p = P({ baseline: E, kList: [kOf(E[3])], kErr: EERR, hList: [hOf(E[0], { url: "n1" }), hOf(E[1], { url: "n2" }), hOf(E[2]), hOf(E[3])] });
eq(ops(p), [], "A1 읽지 못한 파일에 H 새 판이 와도 덮어쓰지 않음");
p = P({ baseline: [E[0]], kList: [kOf(E[0], { rel: "copy.xlsx" })], kErr: [{ f: "a.xlsx", r: "EBUSY" }], hList: [hOf(E[0])] });
eq(ops(p), ["put:new:copy.xlsx"], "A1 읽지 못한 파일과 같은 해시의 새 파일은 이름 바꿈이 아님");
p = P({ baseline: [E[3]], kList: [kOf(E[3])], kErr: [{ f: "a.xlsx", r: "EBUSY" }, { f: "Docs", r: "EACCES", dir: true }],
  hList: [hOf(E[3]), { doc: "n", ser: "n", name: "A.xlsx", url: "un", size: 5 }, { doc: "m", ser: "m", name: "docs", url: "um", size: 5 }] });
eq(ops(p), ["get::A (2).xlsx", "get::docs (2)"], "A1 · A2 읽지 못한 경로의 이름은 비어 있는 것으로 보지 않음(대소문자 무시)");
p = P({ baseline: E, kList: [], kErr: [{ f: ".", r: "EACCES", dir: true }], hList: E.map(r => hOf(r)) });
eq([p.fatal, p.actions.length, p.planned.length, p.held], ["read", 0, 0, false], "A1 연결 폴더를 못 읽으면 그 연결 건너뜀");
p = P({ baseline: E, kList: [kOf(E[3])], kCapped: true, hList: E.map(r => hOf(r)) });
eq([p.fatal, p.actions.length, p.planned.length, p.counts.del], ["too_many", 0, 0, 0], "A1 색인 상한 → 그 연결 건너뜀");

/* A2 맥 SMB 는 대소문자를 가리지 않음 — K 에 쓸 이름 비교 · 폴더 이름 */
p = P({ kList: [{ rel: "a.pdf", size: 1, mtime: T, sha: H("q") }, { rel: "Docs/x.pdf", size: 1, mtime: T, sha: H("w") }],
  hList: [{ doc: "x", ser: "x", name: "A.pdf", url: "ux", size: 9 }, { doc: "y", ser: "y", name: "docs", url: "uy", size: 2 }] });
eq(ops(p), ["put:new:a.pdf", "put:new:Docs/x.pdf", "get::A (2).pdf", "get::docs (2)"], "A2 새 이름은 대소문자 무시 · 같은 이름 폴더도 피함");
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[0], { url: "new", name: "A.XLSX" }), hOf(B[1])] });
eq([ops(p), p.actions[0].backup], [["get::A.XLSX"], "a.xlsx"], "A2 H 이름이 대소문자만 바뀜 → 그 자리에(옛 파일은 이전판)");

/* A5 판 묶음만 바뀜(문서함에서 고침) — 주소로 먼저 짝짓고 기준선의 링크 · 문서 id 만 고친다 */
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[0], { ser: "새 묶음", doc: "d9" }), hOf(B[1])] });
eq([ops(p), p.n, p.counts.del, p.counts.h2k], [["relink:ok:a.xlsx"], 0, 0, 0], "A5 판 묶음만 바뀜 → 기준선만 고침(K 중복 · 삭제 대기 없음)");
eq([p.actions[0].row, p.actions[0].it.doc, p.actions[0].it.url, p.actions[0].k_sha256], [1, "d9", "u1", B[0].k_sha256], "A5 같은 줄 · 새 문서 id");
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("z"), size: 2 }), kOf(B[1])], hList: [hOf(B[0], { ser: "새 묶음" }), hOf(B[1])] });
eq([ops(p), p.n], [["relink:ok:a.xlsx", "put:version:a.xlsx"], 1], "A5 판 묶음이 바뀌고 K 도 바뀜 → 기준선을 먼저 고친 뒤 새 판");
p = P({ baseline: B, kList: [kOf(B[0], { rel: "new/a2.xlsx" }), kOf(B[1])], hList: [hOf(B[0], { ser: "새 묶음" }), hOf(B[1])] });
eq(ops(p), ["relink:ok:a.xlsx", "rename::new/a2.xlsx"], "A5 판 묶음 고침은 이름 바꿈보다 먼저(옛 경로로 고친 뒤 새 경로)");
p = P({ baseline: [row(1, "a.xlsx", { state: "conflict", note: "K 쪽이 늦게 고침" })], kList: [kOf(B[0])], hList: [hOf(B[0], { ser: "y" })] });
eq([ops(p), p.actions[0].note], [["relink:conflict:a.xlsx"], "K 쪽이 늦게 고침"], "A5 충돌 표시는 그대로");
p = P({ baseline: B, kList: [kOf(B[1])], hList: [hOf(B[0], { ser: "새 묶음" }), hOf(B[1])] });
eq(ops(p), ["state:del_k:a.xlsx"], "A5 K 에서 지운 파일은 다시 잇지 않음(삭제 대기)");
p = P({ map: Object.assign({}, MAP, { dir: "h2k" }), baseline: [row(1, "a.xlsx", { state: "skip", note: "dir" })], kList: [kOf(B[0], { sha: H("z") })], hList: [hOf(B[0], { ser: "y" })] });
eq(ops(p), ["relink:ok:a.xlsx", "state:skip:a.xlsx"], "A5 다시 이은 줄의 건너뜀 표시는 다시 보냄(이음이 'ok' 로 바꾸므로)");

/* A4 · A6 · A7 — 실행에 넘기는 값: 충돌 사본 이름의 바탕 · 옮기기 전 확인할 색인 값 */
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("k"), mtime: T + 1000 }), kOf(B[1])], hList: [hOf(B[0], { url: "nh", at: new Date(T).toISOString() }), hOf(B[1])] });
eq([p.actions[1].copy, p.actions[1].base], [true, "a.xlsx"], "A6 K 가 이긴 충돌 사본 — 이름 바탕(같은 날 두 번째는 실행 때 '(충돌 날짜 2)')");
p = P({ baseline: B, kList: [kOf(B[0], { sha: H("k"), mtime: T - 1000 }), kOf(B[1])], hList: [hOf(B[0], { url: "nh" }), hOf(B[1])] });
eq([p.actions[0].op, p.actions[0].k.sha, p.actions[0].k.mtime], ["kconf", H("k"), T - 1000], "A4 · A7 H 가 이긴 충돌 — 바꿀 K 파일의 색인 값");
p = P({ baseline: B, kList: B.map(r => kOf(r)), hList: [hOf(B[0], { url: "new" }), hOf(B[1])] });
eq([p.actions[0].k.size, p.actions[0].k.mtime], [1, T], "A7 H 만 바뀜 — 덮어쓸 K 파일의 색인 값");
eq([conflictName("d/a.xlsx", "2026-11-04", 2), excluded("a (충돌 2026-11-04 2).xlsx", false), excluded("a (충돌 2026-11-04) 2.xlsx", false)],
  ["d/a (충돌 2026-11-04 2).xlsx", true, false], "A6 두 번째 충돌 사본은 '(충돌 날짜 2)' — 색인 제외 규칙(= SQL)과 같은 꼴");

/* v1.64 기준일(since) — 기준선에 없는 K 파일 중 한국 시각 그날 0시 전에 고친 것은 올리지 않고 · 연결만도 하지 않고 · 덮지 않고 건수만(old).
   기준선 파일은 날짜와 관계없이 맞추고, 다른 연결 기준선과 해시가 같은 옛 파일(연결 폴더끼리 옮김)은 새 파일로 */
{
  const SINCE = Date.parse("2025-08-01T00:00:00+09:00"), OLD = SINCE - 864e5, NEW = SINCE + 864e5;
  const PS = (o) => P(Object.assign({ since: SINCE }, o));
  p = PS({ kList: [{ rel: "old.pdf", size: 3, mtime: OLD, sha: H("1") }, { rel: "new.pdf", size: 4, mtime: NEW, sha: H("2") }] });
  eq([ops(p), p.counts.old, p.counts.k2h, p.n, p.counts.total, p.detail.map(d => d.f)], [["put:new:new.pdf"], 1, 1, 0, 1, ["new.pdf"]], "① 기준일 전 새 파일 → 올리지 않음 · 건수만(old) · 변경 수 0 · 기록 줄 · total 에 없음");
  p = PS({ kList: [{ rel: "old.pdf", size: MAX_SIZE + 1, mtime: OLD, sha: null }, { rel: "o2.pdf", size: 3, mtime: OLD, sha: null }] });
  eq([ops(p), p.counts.old, p.counts.skip], [[], 2, 0], "① 해시하지 않은 옛 파일(sha 없음)도 옛 파일 — 50MB 건너뜀으로 보지 않음");
  const BO = [row(1, "a.xlsx", { k_mtime: new Date(OLD).toISOString() })];
  p = PS({ baseline: BO, kList: [kOf(BO[0], { mtime: OLD, sha: H("z"), size: 2 })], hList: BO.map(r => hOf(r)) });
  eq([ops(p), p.n, p.counts.old], [["put:version:a.xlsx"], 1, 0], "② 기준선의 옛 파일을 고침(수정 날짜는 기준일 전 그대로) → 새 판");
  p = PS({ baseline: BO, kList: [kOf(BO[0], { rel: "d/a.xlsx", mtime: OLD })], hList: BO.map(r => hOf(r)) });
  eq([ops(p), p.counts.old], [["rename::d/a.xlsx"], 0], "③ 기준선 파일을 같은 연결 안에서 옮김(옛 날짜) → 이름 바꿈");
  p = PS({ kList: [{ rel: "moved.pdf", size: 5, mtime: OLD, sha: H("3") }], allSha: new Set([H("3")]) });
  eq([ops(p), p.counts.old], [["put:new:moved.pdf"], 0], "④ 다른 연결의 기준선과 해시가 같은 옛 날짜 파일(연결 폴더끼리 옮김) → 올림");
  p = PS({ kList: [{ rel: "규정.pdf", size: 3, mtime: OLD, sha: null }], hList: [{ doc: "h1", ser: "h1", name: "규정.pdf", url: "uh", size: 9 }] });
  eq([ops(p), p.counts.old], [["get::규정 (2).pdf"], 1], "⑤ H 에만 있는 문서 이름이 옛 K 파일과 같음(양쪽) → '이름 (2)' 로 받고 옛 파일을 덮지 않음");
  const hSame = [{ doc: "h1", ser: "h1", name: "same.pdf", url: "uh", size: 4 }];
  p = PS({ kList: [{ rel: "same.pdf", size: 4, mtime: OLD, sha: H("4") }], hList: hSame });
  eq([ops(p), p.counts.link, p.counts.old], [["get::same (2).pdf"], 0, 1], "⑥ 옛 K 파일과 이름 · 크기가 같은 H 문서 → 연결만 하지 않음(H 문서는 새 이름으로)");
  p = PS({ map: Object.assign({}, MAP, { dir: "k2h" }), kList: [{ rel: "same.pdf", size: 4, mtime: OLD, sha: H("4") }], hList: hSame });
  eq([ops(p), p.counts.link, p.counts.old], [[], 0, 1], "⑥ K → H 만 연결도 연결만 · 올리기 없음");
  p = PS({ baseline: BO, kList: [], hList: BO.map(r => hOf(r)) });
  eq([ops(p), p.counts.del], [["state:del_k:a.xlsx"], 1], "⑦ 기준선 파일이 K 에서 사라짐 → K 에서 지움(기준일과 무관)");
  const many = Array.from({ length: 500 }, (_, i) => ({ rel: "old/" + i + ".pdf", size: 10 + i, mtime: OLD, sha: null }));
  p = PS({ baseline: B, kList: B.map(r => kOf(r)).concat(many), hList: B.map(r => hOf(r)) });
  eq([p.held, p.actions.length, p.counts.old, p.n, p.detail.length], [false, 0, 500, 0, 0], "⑧ 옛 파일 500개 → 보류 아님 · 올리기 · 기록 줄 없음");
  const b1 = Date.parse("2025-07-31T14:59:59Z"), b2 = Date.parse("2025-07-31T15:00:00Z");
  p = PS({ kList: [{ rel: "x.pdf", size: 1, mtime: b1, sha: H("5") }, { rel: "y.pdf", size: 1, mtime: b2, sha: H("6") }] });
  eq([ops(p), p.counts.old, SINCE], [["put:new:y.pdf"], 1, b2], "⑨ 경계: 2025-07-31T14:59:59Z 는 옛 파일, 15:00:00Z(한국 8-1 0시)는 새 파일");
  eq([LIB.sinceMs("2025-08-01"), LIB.sinceMs(""), LIB.sinceMs(null), LIB.sinceMs("2025-02-30"), LIB.sinceMs("2025-8-1"), LIB.sinceMs("2025-08-01T00:00")].map(x => (isNaN(x) ? "NaN" : x)),
    [b2, 0, 0, "NaN", "NaN", "NaN"], "기준일 → 한국 시각 그날 0시(없으면 0, 없는 날 · 다른 꼴은 NaN)");
  p = P({ kList: ["cert.pfx", "key.P12", "ca.pem", "pw.kdbx", "바로 가기.lnk", "site.url"].map((n, i) => ({ rel: n, size: 1, mtime: T, sha: H(String(i)) })) });
  eq([ops(p), p.counts.skip, p.detail.map(d => d.a + ":" + d.r).join()], [[], 6, "skip:type,skip:type,skip:type,skip:type,skip:type,skip:type"], "⑩ 인증서 · 키 보관 · 바로 가기 → 올리지 않고 건너뜀(type)");
  ok(["a.pfx", "b.p12", "c.pem", "d.kdbx", "e.lnk", "f.url"].every(n => H_BLOCK.test(n)) && !H_BLOCK.test("g.key") && !H_BLOCK.test("h.pdf"), "⑩ H 차단에 인증서 · 바로 가기(.key 는 Keynote 와 같아 막지 않음)");
  p = P({ kList: [{ rel: "old.pdf", size: 3, mtime: OLD, sha: H("1") }] });
  eq([ops(p), p.counts.old], [["put:new:old.pdf"], 0], "⑪ 기준일 없음 → 옛 파일도 지금처럼 올림");
}

/* v1.68 링크 정확도(서버 flags.link_all → linkAll) — 기준선에 없는 K 파일의 짝을 H 옛 판에서도 찾고, 기준일 전 파일도 먼저 이어 본다
   (기준일은 '올리지 않음'일 뿐). 같은 내용 파일이 여럿이면 이름이 같은 후보로 이름 바꿈을 고른다. 깃발을 끄면 그 전 그대로 */
{
  const SINCE = Date.parse("2025-08-01T00:00:00+09:00"), OLD = SINCE - 864e5;
  const PL = (o) => P(Object.assign({ linkAll: true }, o));
  const cur = { doc: "dc", ser: "S", name: "보고 v2.pdf", url: "uc", size: 9, title: "t" };
  const oldv = { doc: "do", ser: "S", name: "보고.pdf", url: "uo", size: 4, date: "2025-01-01" };
  const k4 = { rel: "보고.pdf", size: 4, mtime: T, sha: H("1") };
  p = PL({ kList: [k4], hList: [cur], hOlds: [oldv] });
  eq([ops(p), p.actions[0] && [p.actions[0].it.doc, p.actions[0].it.url], p.counts.link, p.counts.k2h, p.counts.h2k, p.detail.map(d => d.r)],
    [["link::보고.pdf"], ["do", "uo"], 1, 0, 0, ["옛 판과 같은 파일"]], "① 옛 판과 이름 · 크기가 같음 → 연결만(올리지 않음) · 그 판 묶음의 현재 판은 이번에 받지 않음(K '이름 (2)' 없음)");
  p = P({ kList: [k4], hList: [cur], hOlds: [oldv] });
  eq(ops(p), ["put:new:보고.pdf", "get::보고 v2.pdf"], "① 깃발을 끄면 그 전 그대로(옛 판은 보지 않음 — 새 문서로 올리고 현재 판을 받음)");
  const hSame = [{ doc: "h1", ser: "h1", name: "same.pdf", url: "uh", size: 4 }];
  p = PL({ since: SINCE, kList: [{ rel: "same.pdf", size: 4, mtime: OLD, sha: H("4") }], hList: hSame });
  eq([ops(p), p.counts.link, p.counts.old], [["link::same.pdf"], 1, 0], "② 기준일 전 K 파일도 H 짝(현재 판)과 연결만 — 기준일은 '올리지 않음'이지 '잇지 않음'이 아님");
  p = PL({ since: SINCE, kList: [Object.assign({}, k4, { mtime: OLD })], hList: [cur], hOlds: [oldv] });
  eq([ops(p), p.counts.old], [["link::보고.pdf"], 0], "② 기준일 전 K 파일 ↔ 옛 판도 연결만");
  p = PL({ since: SINCE, kList: [{ rel: "same.pdf", size: 4, mtime: OLD, sha: null }], hList: hSame });
  eq([ops(p), p.counts.old], [["get::same (2).pdf"], 1], "② 해시하지 않은 옛 파일은 잇지 않음(기준선 표시는 K 해시가 있어야 받음) — 그 전처럼 건수만");
  p = PL({ since: SINCE, kList: [{ rel: "x.pdf", size: 3, mtime: OLD, sha: H("3") }], hList: [cur], hOlds: [oldv] });
  eq([ops(p), p.counts.old, p.detail.filter(d => d.f === "x.pdf").length], [["get::보고 v2.pdf"], 1, 0], "③ 기준일 전 · 짝 없음 → 올리지 않고 건수만(기록 줄 없음)");
  p = PL({ kList: [k4], hList: [{ ser: "S", hidden: true }], hOlds: [oldv] });
  eq(ops(p), ["put:new:보고.pdf"], "④ 숨은 SSI 판 묶음의 옛 판은 후보가 아님");
  const old2 = { doc: "do2", ser: "S", name: "보고 초안.pdf", url: "uo2", size: 3, date: "2024-12-01" };
  p = PL({ kList: [k4, { rel: "보고 초안.pdf", size: 3, mtime: T, sha: H("2") }], hList: [cur], hOlds: [oldv, old2] });
  eq(ops(p), ["link::보고.pdf", "put:new:보고 초안.pdf"], "옛 판은 판 묶음마다 회차에 하나만(둘 다 이으면 다음 실행이 하나 빼고 'H 에서 지움'으로 봄)");
  const RL = [row(41, "보고.pdf", { k_size: 4, k_sha256: H("1"), doc_id: "do", ser: "S", h_url: "uo", h_name: "보고.pdf", h_size: 4 })];
  p = PL({ baseline: RL, kList: [kOf(RL[0]), { rel: "사본/보고.pdf", size: 4, mtime: T, sha: H("9") }], hList: [cur], hOlds: [oldv] });
  eq(ops(p).filter(x => x.startsWith("link")), [], "기준선 줄이 있는 판 묶음의 옛 판은 후보가 아님");
  // 해시가 실린 H 첨부(해시를 채운 문서)는 해시가 양쪽에 하나뿐이면 이름이 달라도 · 여럿이면 이름도 같을 때만
  p = PL({ kList: [{ rel: "이름 다름.pdf", size: 4, mtime: T, sha: H("5") }], hList: [Object.assign({}, cur, { sha: H("5") })] });
  eq(ops(p), ["link::이름 다름.pdf"], "해시가 양쪽에 하나뿐 → 이름이 달라도 연결만");
  p = PL({ kList: [{ rel: "이름 다름.pdf", size: 4, mtime: T, sha: H("5") }, { rel: "또 다름.pdf", size: 4, mtime: T, sha: H("5") }], hList: [Object.assign({}, cur, { sha: H("5") })] });
  eq(ops(p).filter(x => x.startsWith("link")), [], "같은 해시 K 파일이 둘 → 해시만으로 잇지 않음");
  p = PL({ kList: [{ rel: "보고 v2.pdf", size: 4, mtime: T, sha: H("5") }, { rel: "또 다름.pdf", size: 4, mtime: T, sha: H("5") }], hList: [Object.assign({}, cur, { sha: H("5") })] });
  eq(ops(p).filter(x => x.startsWith("link")), ["link::보고 v2.pdf"], "같은 해시가 여럿이면 해시 + 이름이 같은 후보만");
  // ⑤ 같은 내용 파일 둘(같은 안내 문서가 여러 폴더에) — 이름 바꿈을 마음대로 고르지 않음
  const BR = [row(1, "a/안내.pdf", { k_sha256: H("7"), k_size: 5 })];
  const twin = [{ rel: "b/안내.pdf", size: 5, mtime: T, sha: H("7") }, { rel: "c/다른 이름.pdf", size: 5, mtime: T, sha: H("7") }];
  p = P({ baseline: BR, kList: twin, hList: BR.map(r => hOf(r)) });
  eq([ops(p).filter(x => x.startsWith("rename")), p.counts.dup], [[], 1], "⑤ 같은 해시 후보 둘 → 이름 바꿈 안 함 · counts.dup(깃발과 관계없는 보고)");
  p = PL({ baseline: BR, kList: twin, hList: BR.map(r => hOf(r)) });
  eq([ops(p).filter(x => x.startsWith("rename")), p.counts.dup], [["rename::b/안내.pdf"], 0], "⑤ linkAll — 이름이 같은 후보를 고름");
  p = PL({ baseline: BR, kList: twin.concat([{ rel: "d/안내.pdf", size: 5, mtime: T, sha: H("7") }]), hList: BR.map(r => hOf(r)) });
  eq([ops(p).filter(x => x.startsWith("rename")), p.counts.dup], [[], 1], "⑤ 이름도 같은 후보가 둘 → 고르지 않고 dup");
  // ⑥ 옛 판에 이은 줄의 다음 실행 — 현재 판이 그 판 묶음의 새 판으로 보인다
  p = P({ map: Object.assign({}, MAP, { dir: "k2h" }), baseline: RL, kList: [kOf(RL[0])], hList: [cur] });
  eq([ops(p), p.detail.map(d => d.a + ":" + d.r), p.counts.k2h], [["state:skip:보고.pdf"], ["skip:dir"], 0], "⑥ K → H 만: H 쪽이 더 새로움(dir)으로 건너뜀 — 중복 올리기 없음");
  p = P({ baseline: RL, kList: [kOf(RL[0])], hList: [cur] });
  eq([ops(p), p.actions[0].backup, p.n], [["get::보고 v2.pdf"], "보고.pdf", 1], "⑥ 양쪽: 현재 판을 받고 옛 K 파일은 이전판으로(backup)");
}

/* 도우미 — 경로 · 설정 · 시각 */
["a/b.pdf", "가/나 다.xlsx"].forEach(x => ok(relOk(x), "경로 " + x));
["/etc/x", "../x", "a/../b", "a//b", "a\\b", "C:x", "", "a/"].forEach(x => ok(!relOk(x), "경로 거절 " + x));
eq(parseSmb("smb://nas.example/share/sub%20dir"), { host: "nas.example", port: 445, share: "share", sub: ["sub dir"], url: "smb://nas.example/share/sub%20dir" }, "SMB 주소");
eq([parseSmb("smb://h/"), parseSmb("http://h/s"), parseSmb('smb://h/s"x'), parseSmb("smb://h/s/../t")], [null, null, null, null], "SMB 주소 거절");
eq(checkConfig({ server: "https://x.supabase.co/functions/v1/semis-logi-ksync", smbUrl: "smb://h/s" }), "", "설정 정상");
ok(checkConfig({ server: "http://x/", smbUrl: "smb://h/s" }) && checkConfig({ server: "https://x/", smbUrl: "smb://h/s", dailyAt: "9" }), "설정 거절");
eq([kstDay(Date.parse("2026-11-03T15:00:00Z")), kstMin(Date.parse("2026-11-03T23:30:00Z")), hhmm("08:30"), hhmm("8:30")], ["2026-11-04", 510, 510, null], "한국 시각");
/* 매일 창 — 시작부터 30분(끝은 빼고) · 자정을 넘는 창은 시작한 날의 창 */
const kt = (s) => Date.parse(s + "+09:00");
eq(["2026-11-04T08:29:59", "2026-11-04T08:30:00", "2026-11-04T08:59:59", "2026-11-04T09:00:00", "2026-11-04T23:00:00"].map(s => { const w = dailyWin(kt(s), 510); return (w.in ? "in" : "out") + ":" + w.day; }),
  ["out:2026-11-03", "in:2026-11-04", "in:2026-11-04", "out:2026-11-04", "out:2026-11-04"], "매일 창 08:30~09:00");
eq(["2026-11-04T23:44:00", "2026-11-04T23:50:00", "2026-11-05T00:10:00", "2026-11-05T00:15:00"].map(s => { const w = dailyWin(kt(s), 23 * 60 + 45); return (w.in ? "in" : "out") + ":" + w.day; }),
  ["out:2026-11-03", "in:2026-11-04", "in:2026-11-04", "out:2026-11-04"], "자정을 넘는 창(23:45~00:15)은 시작한 날");
eq([winText(510), winText(23 * 60 + 45), winText(7 * 60 + 5)], ["08:30~09:00", "23:45~00:15", "07:05~07:35"], "창 표시");

/* 파일 — 링크 · 경로 탈출 · 색인 · 옮기기 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ksync-unit-"));
const root = path.join(TMP, "k");
fs.mkdirSync(path.join(root, "d"), { recursive: true });
fs.writeFileSync(path.join(root, "d", "a.pdf"), "A");
fs.writeFileSync(path.join(root, "가".normalize("NFD") + ".pdf"), "N");
fs.writeFileSync(path.join(root, "~$t.docx"), "x");
fs.symlinkSync(TMP, path.join(root, "up"));
fs.symlinkSync(path.join(root, "d", "a.pdf"), path.join(root, "l.pdf"));
const idx = await indexDir(root, new Map());
eq(idx.list.map(x => x.rel).sort(), ["d/a.pdf", "가.pdf"], "색인: 링크 · 임시 파일 제외 · NFC");
let threw = "";
try { await safeAbs(root, "up/x.pdf"); } catch (e) { threw = e.code; }
eq(threw, "path", "링크 폴더 거쳐 쓰기 거절");
threw = "";
try { await safeAbs(root, "../x.pdf"); } catch (e) { threw = e.code; }
eq(threw, "path", "상위 이동 거절");
ok((await safeAbs(root, "new/x.pdf")).startsWith(root + path.sep), "새 폴더는 연결 안");
const dst = await moveAside(root, path.join(root, "d", "a.pdf"), "d/a.pdf", "trash", Date.parse("2026-09-01T00:00:00Z"));
ok(dst.endsWith(path.join("_H드라이브_휴지통", "2026-09-01", "d", "a.pdf")), "휴지통 날짜 폴더");
fs.writeFileSync(path.join(root, "d", "a.pdf"), "A2");
const dst2 = await moveAside(root, path.join(root, "d", "a.pdf"), "d/a.pdf", "trash", Date.parse("2026-09-01T00:00:00Z"));
ok(dst2.endsWith(path.join("2026-09-01", "d", "a (2).pdf")), "같은 날 같은 파일은 '이름 (2)'(계획의 새 이름과 같은 꼴) " + dst2);
eq((await folderTree(root)).map(f => f.path), ["d"], "폴더 목록(동기화 폴더 · 링크 제외)");
ok(!("cleanTrash" in LIB) && !Object.keys(LIB).some(k => /trash|purge/i.test(k)), "휴지통을 비우는 도우미 없음(K 자료를 지우지 않음)");

/* A1 색인 상한 · 읽지 못한 폴더 */
const capDir = path.join(TMP, "cap");
fs.mkdirSync(capDir);
["1.pdf", "2.pdf", "3.pdf"].forEach(n => fs.writeFileSync(path.join(capDir, n), n));
const ic = await indexDir(capDir, new Map(), { maxFiles: 2 });
eq([ic.capped, ic.list.length], [true, 2], "A1 색인 상한에 닿으면 capped");
eq((await indexDir(capDir, new Map())).capped, false, "A1 상한 아래는 capped 아님");
const NOROOT = !(process.getuid && process.getuid() === 0);
if (NOROOT) {
  const lockedDir = path.join(TMP, "rd");
  fs.mkdirSync(path.join(lockedDir, "잠김"), { recursive: true });
  fs.writeFileSync(path.join(lockedDir, "잠김", "x.pdf"), "x");
  fs.chmodSync(path.join(lockedDir, "잠김"), 0o000);
  const ie = await indexDir(lockedDir, new Map());
  fs.chmodSync(path.join(lockedDir, "잠김"), 0o755);
  ok(ie.errors.some(e => e.f === "잠김" && e.dir) && ie.list.length === 0, "A1 읽지 못한 폴더 → 오류(dir: true) " + JSON.stringify(ie.errors));
}

/* A9 남은 내려받기 임시 파일 — 하루 지난 것만 정리, --dry-run(cleanBefore 없음)은 지우지 않음 */
const partDir = path.join(TMP, "part");
fs.mkdirSync(partDir);
fs.writeFileSync(path.join(partDir, ".ksync-0123456789ab.part"), "old");
fs.utimesSync(path.join(partDir, ".ksync-0123456789ab.part"), (T - 2 * 864e5) / 1000, (T - 2 * 864e5) / 1000);
fs.writeFileSync(path.join(partDir, ".ksync-ba9876543210.part"), "new");
fs.writeFileSync(path.join(partDir, "a.pdf"), "a");
await indexDir(partDir, new Map());
eq(fs.readdirSync(partDir).sort(), [".ksync-0123456789ab.part", ".ksync-ba9876543210.part", "a.pdf"], "A9 정리 옵션 없으면 그대로");
const ip = await indexDir(partDir, new Map(), { cleanBefore: Date.now() - 864e5 });
eq([fs.readdirSync(partDir).sort(), ip.list.map(x => x.rel)], [[".ksync-ba9876543210.part", "a.pdf"], ["a.pdf"]], "A9 하루 지난 임시 파일만 지움");

/* v1.64 기준일 색인 — 기준선에 없고 기준일 전이며 크기가 어느 연결 기준선과도 다르면 해시하지 않음(올리지 않을 파일) */
{
  const sinceDir = path.join(TMP, "since"), SN = Date.parse("2025-08-01T00:00:00+09:00");
  const hx = (s) => crypto.createHash("sha256").update(s).digest("hex");
  fs.mkdirSync(sinceDir);
  const sw = (n, s, t) => { fs.writeFileSync(path.join(sinceDir, n), s); fs.utimesSync(path.join(sinceDir, n), t / 1000, t / 1000); };
  sw("old.pdf", "OLD1", SN - 864e5); sw("oldsz.pdf", "OLDSIZE", SN - 864e5); sw("new.pdf", "NEW", SN); sw("base.pdf", "BASE", SN - 864e5);
  const sx = await indexDir(sinceDir, new Map([["base.pdf", { k_sha256: H("b"), k_size: 1, k_mtime: new Date(SN - 9e9).toISOString() }]]), { since: SN, sizes: new Set([7]) });
  const shaOf = (n) => (sx.list.find(x => x.rel === n) || {}).sha;
  eq(["old.pdf", "oldsz.pdf", "new.pdf", "base.pdf"].map(shaOf), [null, hx("OLDSIZE"), hx("NEW"), hx("BASE")],
    "기준일 색인: 옛 파일은 해시 안 함 · 크기가 어느 연결 기준선과 같으면 잼 · 기준일 0시부터는 잼 · 기준선 파일은 날짜와 관계없이");
  eq(sx.list.length, 4, "옛 파일도 색인에는 남음(이름 차지 — 받는 파일이 덮지 않음)");
  ok((await indexDir(sinceDir, new Map())).list.every(x => x.sha), "기준일 없음 → 모두 잼(지금과 같음)");
  const sn = await indexDir(sinceDir, new Map(), { since: SN, sizes: new Set(), names: new Set(["old.pdf|4"]) });
  eq(["old.pdf", "oldsz.pdf"].map(n => (sn.list.find(x => x.rel === n) || {}).sha), [hx("OLD1"), null], "link_all: 기준일 전 파일 중 H 링크 후보(소문자 이름|크기)와 같은 것만 잼");
}

/* 받은 파일 놓기(place) — A2 추적하지 않는 K 항목은 옮기지 않음 · A4 충돌 사본 이름은 받은 뒤 · A6 '(충돌 날짜 2)' · A7 색인 뒤 바뀐 파일은 건드리지 않음 */
const pr = path.join(TMP, "pl");
fs.mkdirSync(pr);
const rd = (r) => fs.readFileSync(path.join(pr, ...r.split("/")), "utf8");
const tmpf = (n, s) => { const f = path.join(pr, ".t" + n); fs.writeFileSync(f, s); return f; };
const kst = (r) => { const s = fs.statSync(path.join(pr, r)); return { size: s.size, mtime: Math.floor(s.mtimeMs) }; };
const D4 = "2026-11-04";
fs.writeFileSync(path.join(pr, "n.pdf"), "U");
let g = await place(pr, tmpf(1, "H"), "n.pdf", { today: D4 });
eq([g.rel, rd("n.pdf"), rd(g.rel)], ["n (2).pdf", "U", "H"], "A2 같은 이름의 추적하지 않는 파일은 옮기지 않고 새 이름(계획과 같은 ' (2)' 꼴)");
if (fs.existsSync(path.join(pr, "N.PDF"))) {          // 대소문자를 가리지 않는 파일 시스템(맥 기본 · SMB)에서만
  g = await place(pr, tmpf(2, "H2"), "N.pdf", { today: D4 });
  eq([g.rel, rd("n.pdf")], ["N (3).pdf", "U"], "A2 대소문자만 다른 이름도 옮기지 않음");
}
fs.mkdirSync(path.join(pr, "Docs"));
g = await place(pr, tmpf(3, "H3"), "Docs", { today: D4 });
eq([g.rel, fs.statSync(path.join(pr, "Docs")).isDirectory()], ["Docs (2)", true], "A2 같은 이름 폴더는 옮기지 않음");
fs.writeFileSync(path.join(pr, "b.pdf"), "OLD");
g = await place(pr, tmpf(4, "NEW"), "b.pdf", { backup: { abs: path.join(pr, "b.pdf"), rel: "b.pdf", k: kst("b.pdf") }, now: T });
eq([g.rel, rd("b.pdf"), fs.readdirSync(path.join(pr, PREV)).length], ["b.pdf", "NEW", 1], "추적 중인 옛 파일만 이전판으로");
fs.writeFileSync(path.join(pr, "c.pdf"), "K1");
const kc1 = kst("c.pdf");
fs.writeFileSync(path.join(pr, "c.pdf"), "K22");
threw = "";
try { await place(pr, tmpf(5, "H5"), "c.pdf", { backup: { abs: path.join(pr, "c.pdf"), rel: "c.pdf", k: kc1 }, now: T }); } catch (e) { threw = e.code; }
eq([threw, rd("c.pdf"), fs.readdirSync(path.join(pr, PREV)).length], ["changed", "K22", 1], "A7 색인 뒤 바뀐 K 파일은 덮어쓰지 않음(다음 실행에서 충돌로)");
fs.writeFileSync(path.join(pr, "x.xlsx"), "K");
fs.writeFileSync(path.join(pr, "x (충돌 2026-11-04).xlsx"), "earlier");
g = await place(pr, tmpf(6, "H"), "x.xlsx", { conf: { abs: path.join(pr, "x.xlsx"), rel: "x.xlsx", k: kst("x.xlsx") }, today: D4 });
eq([g.rel, g.conf, rd("x.xlsx"), rd(g.conf), excluded(g.conf, false)], ["x.xlsx", "x (충돌 2026-11-04 2).xlsx", "H", "K", true],
  "A4 · A6 H 가 이긴 충돌: 받은 뒤 K 파일을 충돌 사본으로 · 같은 날 두 번째는 '(충돌 날짜 2)'(색인 제외)");
fs.writeFileSync(path.join(pr, "y.xlsx"), "K");
const ky = kst("y.xlsx");
fs.writeFileSync(path.join(pr, "y.xlsx"), "K-later");
threw = "";
try { await place(pr, tmpf(7, "H"), "y.xlsx", { conf: { abs: path.join(pr, "y.xlsx"), rel: "y.xlsx", k: ky }, today: D4 }); } catch (e) { threw = e.code; }
eq([threw, rd("y.xlsx"), fs.readdirSync(pr).filter(f => /^y /.test(f))], ["changed", "K-later", []], "A4 · A7 그 사이 K 가 또 바뀌면 이름을 바꾸지 않음");
g = await place(pr, tmpf(8, "HC"), "x (충돌 2026-11-04).xlsx", { copy: "x.xlsx", today: D4 });
eq([g.rel, rd(g.rel), rd("x (충돌 2026-11-04).xlsx")], ["x (충돌 2026-11-04 3).xlsx", "HC", "earlier"], "A6 K 가 이긴 충돌 사본도 '(충돌 날짜 n)'");
eq(path.basename(await conflictPath(pr, "z.xlsx", D4)), "z (충돌 2026-11-04).xlsx", "A6 충돌 사본 첫 이름");
fs.writeFileSync(path.join(pr, "w.xlsx"), "K"); fs.writeFileSync(path.join(pr, "w (충돌 2026-11-04).xlsx"), "OTHER");
threw = "";
try { await place(pr, tmpf(9, "H"), "w.xlsx", { conf: { abs: path.join(pr, "w.xlsx"), rel: "w.xlsx", k: kst("w.xlsx"), to: path.join(pr, "w (충돌 2026-11-04).xlsx") }, today: D4 }); } catch (e) { threw = e.code; }
eq([threw, rd("w.xlsx"), rd("w (충돌 2026-11-04).xlsx")], ["changed", "K", "OTHER"], "미리 정한 충돌 사본 자리를 다른 파일이 차지 → 덮지 않음");

/* K 파일은 덮지 않는다 — rename 은 같은 이름을 말없이 덮으므로 옮길 이름을 O_EXCL 로 먼저 차지(moveNew) */
const nc = path.join(TMP, "nc");
fs.mkdirSync(nc);
const rdn = (n) => { try { return fs.readFileSync(path.isAbsolute(n) ? n : path.join(nc, n), "utf8"); } catch (e) { return null; } };
fs.writeFileSync(path.join(nc, "src.pdf"), "SRC"); fs.writeFileSync(path.join(nc, "dst.pdf"), "USER");
threw = "";
try { await moveNew(path.join(nc, "src.pdf"), path.join(nc, "dst.pdf")); } catch (e) { threw = e.code; }
eq([threw, rdn("src.pdf"), rdn("dst.pdf")], ["changed", "SRC", "USER"], "moveNew: 같은 이름이 있으면 옮기지 않음(둘 다 그대로)");
await moveNew(path.join(nc, "src.pdf"), path.join(nc, "new.pdf"));
eq([fs.existsSync(path.join(nc, "src.pdf")), rdn("new.pdf")], [false, "SRC"], "moveNew: 빈 이름이면 옮김");
threw = "";
try { await moveNew(path.join(nc, "none.pdf"), path.join(nc, "z.pdf")); } catch (e) { threw = e.code; }
eq([threw, fs.existsSync(path.join(nc, "z.pdf"))], ["ENOENT", false], "moveNew: 옮기기 실패 → 방금 차지한 빈 자리만 치움");
/* SMB 가 옮기기를 끝내고도 오류를 돌려줌 — 그 자리는 옮겨진 사용자 파일(크기 0)이라 지우지 않음 · 빈 자리에 누가 내용을 썼어도 지우지 않음 */
const rn0 = fsp.rename;
fs.writeFileSync(path.join(nc, "empty.pdf"), "");
fsp.rename = async (a, b) => { await rn0(a, b); throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); };
threw = "";
try { await moveNew(path.join(nc, "empty.pdf"), path.join(nc, "moved.pdf")); } catch (e) { threw = e.code; } finally { fsp.rename = rn0; }
eq([threw, rdn("moved.pdf"), rdn("empty.pdf")], ["ETIMEDOUT", "", null], "moveNew: 옮긴 뒤 오류만 돌아옴 → 옮겨진 크기 0 사용자 파일은 지우지 않음");
fs.writeFileSync(path.join(nc, "s2.pdf"), "S2");
fsp.rename = async (a, b) => { fs.writeFileSync(b, "USER-WROTE"); throw Object.assign(new Error("busy"), { code: "EBUSY" }); };
threw = "";
try { await moveNew(path.join(nc, "s2.pdf"), path.join(nc, "taken.pdf")); } catch (e) { threw = e.code; } finally { fsp.rename = rn0; }
eq([threw, rdn("taken.pdf"), rdn("s2.pdf")], ["EBUSY", "USER-WROTE", "S2"], "moveNew: 차지한 빈 자리에 누가 내용을 썼으면 치우지 않음");
/* 미리 정한 충돌 사본 자리(conf.to)를 확인 뒤 옮기기 전에 누가 차지 — 덮지 않고 'changed'(K 쪽 판 · 받은 판은 제자리) */
const raceTo = async (target, fn) => {
  const rl = fsp.lstat, ro = fsp.open;
  let fired = false;
  const take = () => { if (!fired) { fired = true; fs.writeFileSync(target, "USER-NEW"); } };
  fsp.lstat = async (p, ...r) => { try { return await rl(p, ...r); } catch (e) { if (p === target && e.code === "ENOENT") take(); throw e; } };
  fsp.open = async (p, ...r) => { if (p === target) take(); return ro(p, ...r); };
  try { await fn(); return "ok"; } catch (e) { return e.code; } finally { fsp.lstat = rl; fsp.open = ro; }
};
fs.writeFileSync(path.join(nc, "k.xlsx"), "K-k");
const kTmp = path.join(nc, ".ksync-0000000000bb.part"), kTo = path.join(nc, "k (충돌 2026-11-04).xlsx");
fs.writeFileSync(kTmp, "H-k");
const kK = (() => { const s = fs.statSync(path.join(nc, "k.xlsx")); return { size: s.size, mtime: Math.floor(s.mtimeMs) }; })();
eq([await raceTo(kTo, () => place(nc, kTmp, "k.xlsx", { conf: { abs: path.join(nc, "k.xlsx"), rel: "k.xlsx", k: kK, to: kTo }, today: D4 })), rdn("k.xlsx"), rdn(kTo), rdn(kTmp)],
  ["changed", "K-k", "USER-NEW", "H-k"], "미리 정한 충돌 사본 자리를 확인 직후 누가 만든 파일 → 덮지 않음");
/* 경쟁 — 이름이 비었는지 본(lstat ENOENT) 직후 공유의 다른 사용자가 같은 이름을 만든다(그 이름의 n 번째 확인 뒤) */
const race = async (target, nth, fn) => {
  const real = fsp.lstat;
  let n = 0;
  fsp.lstat = async (p, ...r) => {
    try { return await real(p, ...r); }
    catch (e) { if (p === target && e.code === "ENOENT" && ++n === nth) fs.writeFileSync(target, "USER-NEW"); throw e; }
  };
  try { await fn(); return "ok"; } catch (e) { return e.code; } finally { fsp.lstat = real; }
};
fs.writeFileSync(path.join(nc, "old.pdf"), "OLD");
const prevTo = path.join(nc, PREV, "old (2026-11-04 090000).pdf");
eq([await race(prevTo, 1, () => moveAside(nc, path.join(nc, "old.pdf"), "old.pdf", "prev", T)), rdn("old.pdf"), rdn(prevTo)], ["changed", "OLD", "USER-NEW"],
  "이전판 자리를 확인한 직후 누가 만든 파일 → 덮지 않음(옛 파일도 제자리)");
fs.writeFileSync(path.join(nc, "c.xlsx"), "K-c");
const cTmp = path.join(nc, ".ksync-0000000000aa.part");
fs.writeFileSync(cTmp, "H-c");
const cK = (() => { const s = fs.statSync(path.join(nc, "c.xlsx")); return { size: s.size, mtime: Math.floor(s.mtimeMs) }; })();
eq([await race(path.join(nc, "c.xlsx"), 2, () => place(nc, cTmp, "c.xlsx", { conf: { abs: path.join(nc, "c.xlsx"), rel: "c.xlsx", k: cK }, today: D4 })),
  rdn("c.xlsx"), rdn("c (충돌 2026-11-04).xlsx"), rdn(".ksync-0000000000aa.part")], ["changed", "USER-NEW", "K-c", "H-c"],
  "H 판을 놓을 자리를 확인한 직후 누가 만든 파일 → 덮지 않고, K 쪽 판을 되돌릴 때도 덮지 않음(K 쪽 판은 충돌 사본 이름으로 남음)");
fs.writeFileSync(path.join(nc, ".ksync-0a0a0a0a0a0a.part"), "USER");
const rb0 = crypto.randomBytes;
crypto.randomBytes = () => Buffer.from("0a0a0a0a0a0a", "hex");
threw = "";
try { await LIB.download(async () => new Response("H"), "https://store.example/dl/x", nc, crypto.createHash("sha256").update("H").digest("hex"), 1); } catch (e) { threw = e.code; } finally { crypto.randomBytes = rb0; }
eq([threw, rdn(".ksync-0a0a0a0a0a0a.part")], ["EEXIST", "USER"], "내려받기 임시 파일은 새 파일로만 — 같은 이름이 있으면 덮지 않음");

/* A3 휴지통 · 이전판 폴더가 링크면 연결 폴더 밖으로 옮기지 않음 */
const outside = path.join(TMP, "outside"), lr = path.join(TMP, "lr");
fs.mkdirSync(path.join(outside, "2026-01-01"), { recursive: true });
fs.mkdirSync(lr);
fs.symlinkSync(outside, path.join(lr, TRASH));
fs.symlinkSync(outside, path.join(lr, PREV));
fs.writeFileSync(path.join(lr, "f.pdf"), "F");
threw = "";
try { await moveAside(lr, path.join(lr, "f.pdf"), "f.pdf", "prev", T); } catch (e) { threw = e.code; }
eq([threw, fs.existsSync(path.join(lr, "f.pdf")), fs.readdirSync(outside)], ["path", true, ["2026-01-01"]], "A3 이전판 폴더가 링크 → 옮기지 않음");
threw = "";
try { await moveAside(lr, path.join(lr, "f.pdf"), "f.pdf", "trash", T); } catch (e) { threw = e.code; }
eq([threw, fs.existsSync(path.join(lr, "f.pdf"))], ["path", true], "A3 휴지통 폴더가 링크 → 옮기지 않음");

/* A8 잠금 — 살아 있는 실행은 12시간까지 양보 · 풀 때는 내 잠금만 */
const lk = path.join(TMP, "lockapp", "ksync.lock");
const agentYes = async () => true;     // 잠금의 PID 가 이 에이전트라고 봄(아래에서 실제 확인도 따로)
const rel1 = await lock(lk, T, agentYes);
ok(!!rel1 && fs.existsSync(lk), "A8 잠금");
eq(await lock(lk, T + 1, agentYes), null, "A8 실행 중이면 양보");
rel1();
ok(!fs.existsSync(lk), "A8 내 잠금 풀기");
fs.writeFileSync(lk, JSON.stringify({ pid: process.ppid, at: T - 4 * 3600e3 }));
eq(await lock(lk, T, agentYes), null, "A8 살아 있는 실행은 3시간이 넘어도 양보");
fs.writeFileSync(lk, JSON.stringify({ pid: process.ppid, at: T - 13 * 3600e3 }));
const rel2 = await lock(lk, T, agentYes);
ok(!!rel2, "A8 12시간 넘은 잠금은 가져옴");
fs.writeFileSync(lk, JSON.stringify({ pid: process.ppid, at: T + 5 }));
rel2();
ok(fs.existsSync(lk), "A8 다른 실행이 가져간 잠금은 지우지 않음");
fs.writeFileSync(lk, JSON.stringify({ pid: 2 ** 30, at: T }));
const rel3 = await lock(lk, T, agentYes);
ok(!!rel3, "A8 끝난 실행의 잠금은 가져옴");
rel3();
/* 실행 중 꺼진 뒤 다시 켜면 그 PID 를 다른 프로그램이 쓴다 — 살아 있어도 이 에이전트(같은 프로그램)가 아니면 가져옴 */
const otherProc = spawn("/bin/sleep", ["30"]);
await new Promise((r) => otherProc.once("spawn", r));
fs.writeFileSync(lk, JSON.stringify({ pid: otherProc.pid, at: T - 3600e3 }));
const rel4 = await lock(lk, T);
eq([!!rel4, await agentPid(otherProc.pid), await agentPid(process.pid)], [true, false, true], "A8 살아 있는 PID 라도 다른 프로그램이면 잠금을 가져옴(같은 프로그램이면 양보)");
otherProc.kill();
if (rel4) rel4();
fs.writeFileSync(lk, JSON.stringify({ pid: process.pid, at: T - 3600e3 }));
eq(await lock(lk, T), null, "A8 같은 프로그램이 잡은 잠금은 양보(기본 확인)");
fs.rmSync(lk, { force: true });

/* A10 마운트 주소 — 인코딩된 공유 이름 */
eq([mountUrl(parseSmb("smb://nas.example/my%20share/sub")), mountUrl(parseSmb("smb://nas.example/공유 폴더")), mountUrl(parseSmb("smb://nas.example/data$"))],
  ["smb://nas.example/my%20share", "smb://nas.example/%EA%B3%B5%EC%9C%A0%20%ED%8F%B4%EB%8D%94", "smb://nas.example/data$"], "A10 마운트 주소는 인코딩된 공유 이름");

/* A15 445 확인 — 5초 간격 3번까지(기다림은 주입) */
let n445 = 0;
const sl = [];
let nr = await netRetry(async () => (++n445 < 3 ? { ok: false, msg: "x" } : { ok: true }), "h", async (ms) => { sl.push(ms); });
eq([nr.ok, n445, sl], [true, 3, [5000, 5000]], "A15 두 번 실패 뒤 세 번째에 연결");
n445 = 0; sl.length = 0;
nr = await netRetry(async () => { n445++; return { ok: false, msg: "시간 초과" }; }, "h", async (ms) => { sl.push(ms); });
eq([nr.ok, nr.msg, n445, sl.length], [false, "시간 초과", 3, 2], "A15 세 번 다 실패해야 연결 안 됨");

/* 서버 응답 — 게이트웨이 오류(JSON 아님 · 5xx)는 'server'(처리했는지 모름 → 실행을 멈춤) · 분당 상한은 한 번만 쉬고 다시 · 1분에 PACE 까지만 보냄 */
const RS = (body, status, type) => new Response(body, { status, headers: { "content-type": type || "application/json" } });
const codeOf = async (mk) => { try { await makeClient(async () => mk(), "https://edge.example/f", "k", async () => {}).call("apply", {}); return "ok"; } catch (e) { return e.code; } };
eq([await codeOf(() => RS("<html>502 Bad Gateway</html>", 502, "text/html")), await codeOf(() => RS('{"message":"boot"}', 503)), await codeOf(() => RS("not found", 404, "text/plain")),
  await codeOf(() => RS('{"ok":false,"error":"state"}', 409)), await codeOf(() => RS('{"msg":"jwt"}', 401)), await codeOf(() => RS('{"ok":false,"error":"server"}', 500))],
  ["server", "server", "server", "state", "http401", "server"], "게이트웨이 · JSON 아님 · 5xx → server");
let nFetch = 0;
const slp = [];
let mc = makeClient(async () => { nFetch++; return RS('{"ok":false,"error":"rate"}', 429); }, "https://edge.example/f", "k", async (ms) => { slp.push(ms); }, () => T);
let mcode = "";
try { await mc.call("mark", {}); } catch (e) { mcode = e.code; }
eq([mcode, nFetch, slp], ["rate", 2, [61000]], "분당 상한 → 1분 쉬고 한 번만 다시");
const okRes = async () => RS('{"ok":true}', 200);
mc = makeClient(okRes, "https://edge.example/f", "k", async (ms) => { slp.push(ms); }, () => T);
slp.length = 0;
for (let i = 0; i < PACE; i++) await mc.call("mark", {});
const slp0 = slp.slice();
await mc.call("mark", {});
eq([PACE <= 240, slp0, slp], [true, [], [60000]], "1분에 PACE 까지(분당 300 의 80%) · 넘으면 가장 오래된 것이 빠질 때까지 기다림");
mc = makeClient(okRes, "https://edge.example/f", "k", async (ms) => { slp.push(ms); }, () => T);
slp.length = 0;
for (let i = 0; i < PACE / 2; i++) await mc.call("put", { phase: "verify", path: "p" });
const slp1 = slp.slice();
await mc.call("put", { phase: "begin" });
eq([slp1, slp], [[], [60000]], "확인(verify)은 서버 호출 둘(put_peek · put_verify)로 셈");
let ck = T;
mc = makeClient(async () => { ck += 100; return RS('{"ok":true}', 200); }, "https://edge.example/f", "k", async (ms) => { slp.push(ms); ck += ms; }, () => ck);
slp.length = 0;
for (let i = 0; i <= PACE; i++) await mc.call("get", {});
eq(slp, [60000 - PACE * 100], "시계가 가면 남은 만큼만 기다림");

/* 에이전트 흐름(가짜 서버 · 가짜 445 · 실제 파일) — A11 · A12 · A14 · A15 · 매일 창 · 연결 안 될 때 5분 간격 3번 · 휴지통을 비우지 않음 */
const AG = path.join(TMP, "ag");
fs.mkdirSync(path.join(AG, "share", "m"), { recursive: true });
const ST = path.join(AG, "state.json");
const readSt = () => JSON.parse(fs.readFileSync(ST, "utf8"));
const agentDeps = (o) => {
  const calls = [], bodies = [], notes = [], sleeps = [], hello = (o && o.hello) || {};
  const d = Object.assign({
    paths: { app: AG, config: path.join(AG, "config.json"), state: ST, lock: path.join(AG, "ksync.lock"), log: path.join(AG, "ksync.log") },
    config: { server: "https://edge.example/functions/v1/semis-logi-ksync", smbUrl: "smb://nas.example/share" },
    log: () => {}, out: () => {}, now: () => T, sleep: async (ms) => { sleeps.push(ms); },
    fetch: async (u, i) => {
      const b = JSON.parse(i.body);
      calls.push(b.act + (b.phase ? ":" + b.phase : "")); bodies.push(b);
      const r = b.act === "hello" ? Object.assign({ ok: true, allow: true, daily_at: "08:30", requested: false, maps: [], lists: [], mass_limit: LIM }, hello)
        : b.act === "run" && b.phase === "start" ? { ok: true, run: 7 } : { ok: true };
      return new Response(JSON.stringify(r));
    },
    key: async () => "k", netCheck: async () => ({ ok: true }), mountRoot: async () => path.join(AG, "share"), notify: async (m) => { notes.push(m); }, host: "test"
  }, o || {});
  return Object.assign(d, { calls, bodies, notes, sleeps });
};
const offline = async () => ({ ok: false, msg: "ECONNREFUSED" });
let dg = agentDeps({ netCheck: offline });
let rr = await runAgent(dg, { dryRun: true });
eq([rr.status, dg.calls, dg.notes.length, fs.existsSync(ST), dg.sleeps], ["offline", [], 0, false, [5000, 5000]], "A14 --dry-run 은 사내망 밖에서도 보고 · 알림 · 상태 변경 없음");
dg = agentDeps({ netCheck: offline });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls, dg.notes.length, dg.sleeps], ["offline", [], 0, [5000, 5000]], "사내망 밖 · 창 밖 깨우기 → 한 번만 보고 끝(보고 · 알림 · 5분 기다림 없음)");
fs.rmSync(ST, { force: true });
dg = agentDeps({ netCheck: offline });
rr = await runAgent(dg, { once: true });
eq([rr.status, dg.calls, dg.notes.length, dg.sleeps], ["offline", ["net"], 0, [5000, 5000]], "--once · 사내망 밖 → 한 번만 시도 · 연결 안 됨 보고(알림 · 5분 기다림 없음)");
fs.rmSync(ST, { force: true });

/* 매일 창 08:30~09:00 — 창 안에서만 매일 실행, 창이 지나면 그날은 따라잡지 않음(지금 동기화 요청은 언제든) */
const K0800 = Date.parse("2026-11-03T23:00:00Z"), K0840 = Date.parse("2026-11-03T23:40:00Z"), K0850 = Date.parse("2026-11-03T23:50:00Z"), K1000 = Date.parse("2026-11-04T01:00:00Z");
const trig = (d) => (d.bodies.find(b => b.act === "run" && b.phase === "start") || {}).trigger || "";
dg = agentDeps({ now: () => K0800 });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls], ["idle", ["hello"]], "창 전(08:00) → 매일 실행 없음");
fs.rmSync(ST, { force: true });
dg = agentDeps({ now: () => K0840 });
rr = await runAgent(dg, {});
eq([rr.status, trig(dg), readSt().lastOkDay], ["ok", "daily", "2026-11-04"], "창 안(08:40) → 매일 실행");
fs.rmSync(ST, { force: true });
dg = agentDeps({ now: () => K1000 });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls, readSt().lastOkDay], ["idle", ["hello"], undefined], "창 뒤(10:00) · 오늘 안 했음 → 따라잡지 않음");
dg = agentDeps({ now: () => K1000 + 6 * 60e3, hello: { requested: true } });
rr = await runAgent(dg, {});
eq([rr.status, trig(dg)], ["ok", "manual"], "창 뒤라도 지금 동기화 요청은 실행");
fs.rmSync(ST, { force: true });
dg = agentDeps({ now: () => Date.parse("2026-11-03T22:00:00Z") });
rr = await runAgent(dg, { once: true });
eq([rr.status, readSt().lastOkDay === "2026-11-04", !!readSt().lastOk], ["ok", false, true], "A12 창(08:30) 전 --once → 그날 매일 실행을 대신하지 않음");
dg = agentDeps({ now: () => K0840 });
rr = await runAgent(dg, {});
eq([rr.status, trig(dg)], ["ok", "daily"], "A12 그날 창이 오면 매일 실행");

/* 창 안에서 K드라이브에 닿지 않음 — 5분 간격 3번까지(445 를 5초 간격 3번 = 한 번), 그래도 안 되면 그날은 건너뜀 */
const fails = (n) => { let c = 0; return async () => (++c <= n * 3 ? { ok: false, msg: "ECONNREFUSED" } : { ok: true }); };
fs.rmSync(ST, { force: true });
dg = agentDeps({ now: () => K0840, netCheck: fails(1) });
rr = await runAgent(dg, {});
eq([rr.status, dg.sleeps, trig(dg), dg.notes, dg.calls.filter(c => c === "net"), readSt().skipDay], ["ok", [5000, 5000, 300000], "daily", [], [], undefined], "첫 시도 실패 → 5분 뒤 두 번째에 연결 · 동기화");
fs.rmSync(ST, { force: true });
let helloNet = 0;
dg = agentDeps({ now: () => K0840 });
const f0 = dg.fetch;
dg.fetch = async (u, i) => { if (JSON.parse(i.body).act === "hello" && !helloNet++) throw new TypeError("fetch failed"); return f0(u, i); };
rr = await runAgent(dg, {});
eq([rr.status, dg.sleeps.filter(x => x === 300000).length, trig(dg)], ["ok", 1, "daily"], "hello 가 서버까지 못 감(망 오류)도 같은 시도로 셈 → 5분 뒤 다시");
fs.rmSync(ST, { force: true });
dg = agentDeps({ now: () => K0840, netCheck: offline });
rr = await runAgent(dg, {});
eq([rr.status, dg.sleeps.filter(x => x === 300000), dg.sleeps.length, dg.calls, dg.notes, readSt().skipDay],
  ["offline", [300000, 300000], 8, ["net"], ["K드라이브에 연결하지 못해 오늘 동기화를 건너뜁니다. 내일 08:30~09:00 에 다시 시도합니다."], "2026-11-04"],
  "3번 다 실패 → 5분 기다림 두 번 · 오늘 건너뜀 · 연결 안 됨 보고 한 번 · 알림 한 번");
const net0 = dg.bodies.find(b => b.act === "net") || {};
ok(/건너뜀/.test(net0.msg) && net0.ok === false, "보고에 '오늘 동기화 건너뜀'(대시보드 다음 예정이 내일로)");
dg = agentDeps({ now: () => K0850, netCheck: offline });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls, dg.notes.length, dg.sleeps.filter(x => x === 300000).length], ["offline", [], 0, 0], "같은 날 다시 깨어남(아직 창 안 · 여전히 안 됨) → 다시 시도 · 보고 · 알림 없음");
dg = agentDeps({ now: () => K0850 + 6 * 60e3 });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls], ["idle", ["hello"]], "같은 날 연결됨(아직 창 안) → 매일 실행은 건너뛴 채");
dg = agentDeps({ now: () => K0850 + 12 * 60e3, hello: { requested: true } });
rr = await runAgent(dg, {});
eq([rr.status, trig(dg)], ["ok", "manual"], "건너뛴 날에도 지금 동기화 요청은 실행");
dg = agentDeps({ now: () => K0840 + 864e5 });
rr = await runAgent(dg, {});
eq([rr.status, trig(dg), readSt().lastOkDay], ["ok", "daily", "2026-11-05"], "다음 날 창 안 → 다시 매일 실행");
fs.writeFileSync(ST, JSON.stringify({ skipDay: "2026-11-04", lastOkDay: "2026-11-04" }));
dg = agentDeps({ now: () => K0840 + 864e5 + 2 * 60e3, netCheck: offline });
rr = await runAgent(dg, {});
eq([rr.status, dg.sleeps.filter(x => x === 300000).length, dg.notes.length, readSt().skipDay], ["offline", 2, 1, "2026-11-05"], "다음 날 창 안 · 또 안 됨 → 다시 3번 시도");
/* 창 안이라도 --once · --dry-run · --status 는 한 번만 시도 — 5분 기다림 · 건너뜀 · 알림 없음(--once 만 연결 안 됨 보고) */
for (const [flag, calls] of [["once", ["net"]], ["dryRun", []], ["status", []]]) {
  fs.rmSync(ST, { force: true });
  dg = agentDeps({ now: () => K0840, netCheck: offline });
  rr = await runAgent(dg, { [flag]: true });
  eq([rr.status, dg.sleeps, dg.calls, dg.notes, (fs.existsSync(ST) ? readSt() : {}).skipDay || ""], ["offline", [5000, 5000], calls, [], ""],
    "창 안(08:40) · 연결 안 됨 · " + flag + " → 한 번만 시도");
}
/* 창 끝(08:59)에 깨어나 다시 시도하다 창을 넘겨도(세 번째가 09:09) 그날 매일 실행 — 기다림이 시계를 움직인다 */
fs.rmSync(ST, { force: true });
let lateClk = Date.parse("2026-11-03T23:59:00Z");
const lateSl = [];
dg = agentDeps({ now: () => lateClk, netCheck: fails(2), sleep: async (ms) => { lateSl.push(ms); lateClk += ms; } });
rr = await runAgent(dg, {});
eq([rr.status, lateSl.filter(x => x === 300000).length, kstMin(lateClk), trig(dg), readSt().lastOkDay], ["ok", 2, 9 * 60 + 9, "daily", "2026-11-04"],
  "창 끝에 시작 · 세 번째 시도(09:09)에 연결 → 그날 매일 실행으로 셈");
eq([readSt().lastSeen, readSt().lastOk], [lateClk, new Date(lateClk).toISOString()], "기다린 뒤 연결 → lastSeen · lastOk 는 시작한 때(08:59)가 아니라 실제 시각(09:09)");
/* 다시 시도를 기다리는 사이 Mac 이 잠듦(덮었다가 몇 시간 뒤 엶) — 계획보다 늦었고 그날 창도 지났으면 매일 실행 없음 · 건너뜀 표시 · 연결 안 됨 보고 · 알림도 없음.
   늦었어도 아직 그날 창 안이면 그대로 다시 시도 */
const jc = { t: 0, sl: [] };
const jumpDeps = (start, jump, n) => { jc.t = start; jc.sl = []; return agentDeps({ now: () => jc.t, netCheck: fails(n), sleep: async (ms) => { jc.sl.push(ms); jc.t += ms === 300000 ? jump : ms; } }); };
fs.rmSync(ST, { force: true });
dg = jumpDeps(Date.parse("2026-11-03T23:45:00Z"), 5 * 3600e3, 1);
rr = await runAgent(dg, {});
eq([rr.status, dg.calls, trig(dg), dg.notes, jc.sl.filter(x => x === 300000).length, readSt().lastOkDay, readSt().skipDay, readSt().lastSeen],
  ["missed", [], "", [], 1, undefined, undefined, undefined], "08:45 첫 시도 실패 · 기다리는 사이 5시간 잠듦(13:45 에 깸) → 매일 실행 · 다시 시도 · 보고 · 알림 없음");
dg = agentDeps({ now: () => jc.t + 15 * 60e3 });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls], ["idle", ["hello"]], "그 뒤 깨우기(14:00) → 창이 지나 매일 실행 없음(건너뜀 표시 없이도)");
fs.rmSync(ST, { force: true });
dg = jumpDeps(K0840, 864e5 + 5 * 60e3, 1);
rr = await runAgent(dg, {});
eq([rr.status, dg.calls, readSt().lastOkDay], ["missed", [], undefined], "기다리는 사이 하루 넘게 잠들어 다음 날 창(08:45)에 깸 → 전날 몫으로 실행하지 않음");
fs.rmSync(ST, { force: true });
dg = jumpDeps(Date.parse("2026-11-03T23:31:00Z"), 8 * 60e3, 2);
rr = await runAgent(dg, {});
eq([rr.status, jc.sl.filter(x => x === 300000).length, kstMin(jc.t), trig(dg), readSt().lastOkDay, readSt().lastSeen], ["ok", 2, 8 * 60 + 47, "daily", "2026-11-04", jc.t],
  "08:31 시작 · 기다릴 때마다 3분씩 늦음(아직 창 안) → 계속 다시 시도 · 세 번째(08:47)에 연결 → 매일 실행");
/* 대시보드에서 시작 시각을 바꾸면(hello daily_at) 창이 옮겨 간다 — 받은 시각은 상태에 두고, 서버에 닿기 전 판단(다시 시도할지)에 쓴다 */
const K1010 = Date.parse("2026-11-04T01:10:00Z");
fs.writeFileSync(ST, JSON.stringify({ dailyAt: "08:30" }));
dg = agentDeps({ now: () => K1010, hello: { daily_at: "10:00" } });
rr = await runAgent(dg, {});
eq([rr.status, trig(dg), readSt().dailyAt, readSt().lastOkDay], ["ok", "daily", "10:00", "2026-11-04"], "시작 시각 10:00 으로 바뀜 → 10:10 깨우기에 매일 실행 · 받은 시각을 상태에 둠");
fs.rmSync(ST, { force: true });
dg = agentDeps({ now: () => K0840, hello: { daily_at: "10:00" } });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls], ["idle", ["hello"]], "시작 시각 10:00 → 08:40 깨우기는 매일 실행 없음");
fs.writeFileSync(ST, JSON.stringify({ dailyAt: "10:00" }));
dg = agentDeps({ now: () => K1010, netCheck: offline });
rr = await runAgent(dg, {});
eq([rr.status, dg.sleeps.filter(x => x === 300000).length, dg.notes, readSt().skipDay],
  ["offline", 2, ["K드라이브에 연결하지 못해 오늘 동기화를 건너뜁니다. 내일 10:00~10:30 에 다시 시도합니다."], "2026-11-04"], "받아 둔 시작 시각(10:00) · 연결 안 됨 → 그 창에서 3번 시도 · 알림에 그 창");
fs.rmSync(ST, { force: true });
dg = agentDeps();
rr = await runAgent(dg, { dryRun: true });
eq([rr.status, dg.calls, fs.existsSync(ST)], ["dry-run", ["hello", "hello"], false], "A14 --dry-run(사내망) → 읽기(hello)만 · 상태 파일 안 씀");
n445 = 0;
dg = agentDeps({ netCheck: async () => (++n445 < 3 ? { ok: false, msg: "x" } : { ok: true }) });
rr = await runAgent(dg, { once: true });
eq([rr.status, dg.notes.length, dg.sleeps, dg.calls], ["ok", 0, [5000, 5000], ["hello", "hello", "run:start", "folders", "run:end"]], "A15 로그인 직후 445 두 번 실패 → 알림 없이 이어서 동기화");
eq(readSt().lastOkDay, "2026-11-04", "A12 창 시작 뒤에 시작한 실행 → 오늘 끝냄");
fs.writeFileSync(ST, JSON.stringify({ lastOkDay: "2026-11-04", lastSeen: T - 26 * 60e3, logDay: "2026-11-04", foldersDay: "2026-11-04" }));
dg = agentDeps();
rr = await runAgent(dg, {});
eq([rr.status, dg.calls], ["idle", ["hello"]], "A11 오늘 끝냈어도 25분 지나면 서버를 봄(지금 동기화 요청 확인)");
fs.writeFileSync(ST, JSON.stringify({ lastOkDay: "2026-11-04", lastSeen: T - 20 * 60e3, logDay: "2026-11-04" }));
dg = agentDeps();
rr = await runAgent(dg, {});
eq([rr.status, dg.calls], ["done-today", []], "A11 25분 안이면 서버도 부르지 않음");
/* 5분 안에 다시 깨어남(네트워크 변경 · 로그인 · 30분 깨우기가 잇달아) — 창 밖이면 445 · 서버 없이 끝, 그날 매일 실행이 남은 창 안이면 막지 않음 */
const K0830 = Date.parse("2026-11-03T23:30:00Z");
fs.writeFileSync(ST, JSON.stringify({ lastSeen: K0830 - 2 * 60e3 }));
dg = agentDeps({ now: () => K0830 });
rr = await runAgent(dg, {});
eq([rr.status, trig(dg), readSt().lastOkDay], ["ok", "daily", "2026-11-04"], "2분 전에 서버를 봤어도 창 안(08:30) · 오늘 안 함 → 매일 실행");
let nRecent = 0;
fs.writeFileSync(ST, JSON.stringify({ lastSeen: K1000 - 2 * 60e3 }));
dg = agentDeps({ now: () => K1000, netCheck: async () => { nRecent++; return { ok: true }; } });
rr = await runAgent(dg, {});
eq([rr.status, dg.calls, nRecent], ["recent", [], 0], "2분 전에 서버를 봄 · 창 밖(10:00) → 445 · 서버 없이 끝");
/* 휴지통 폴더는 에이전트가 비우지 않는다 — 오래된 날짜 폴더도 매일 실행 · 수동 실행 뒤 그대로 */
const trashOld = path.join(AG, "share", "m", TRASH, "2026-10-04"), trashOlder = path.join(AG, "share", "m", TRASH, "2025-01-01", "sub");
fs.mkdirSync(trashOld, { recursive: true }); fs.mkdirSync(trashOlder, { recursive: true });
fs.writeFileSync(path.join(trashOld, "x.pdf"), "X"); fs.writeFileSync(path.join(trashOlder, "y.pdf"), "Y");
const mapM = { maps: [{ id: 1, k_path: "m", mod: "a", grp: "b", dir: "both", ssi: false, state: "active", hold: null }], lists: [{ map: 1, h: [], base: [] }] };
fs.rmSync(ST, { force: true });
dg = agentDeps({ now: () => K0840, hello: mapM });
rr = await runAgent(dg, {});
const rr2 = await runAgent(agentDeps({ hello: mapM }), { once: true });
eq([rr.status, trig(dg), rr2.status, rdn(path.join(trashOld, "x.pdf")), rdn(path.join(trashOlder, "y.pdf")), dg.calls.filter(c => c.startsWith("put"))],
  ["ok", "daily", "ok", "X", "Y", []], "31일 지난 휴지통 날짜 폴더도 실행 뒤 그대로(올리지도 않음)");

/* 올리기 3단계(begin → PUT → verify) · 등록(apply) 모으기 · H 가 이긴 충돌 순서 — 가짜 서버 · 실제 파일 */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const M2 = path.join(AG, "share2"), KD = path.join(M2, "m2");
fs.mkdirSync(KD, { recursive: true });
const kw = (n, s) => { fs.writeFileSync(path.join(KD, n), s); fs.utimesSync(path.join(KD, n), (T - 3600e3) / 1000, (T - 3600e3) / 1000); };
kw("a.xlsx", "new-a"); kw("c.xlsx", "K-c"); kw("new.pdf", "N");
const bRow = (id, rel, old, url) => ({ id, rel_path: rel, k_size: old.length, k_mtime: new Date(T - 864e5).toISOString(), k_sha256: sha(old), doc_id: "d" + id, ser: "s" + id,
  h_url: url, h_name: rel, h_size: 3, state: "ok", note: "" });
const lists2 = [{ map: 2, base: [bRow(1, "a.xlsx", "old-a", "ua"), bRow(2, "c.xlsx", "old-c", "uc1")],
  h: [{ doc: "d1", ser: "s1", name: "a.xlsx", url: "ua", size: 3, at: new Date(T - 864e5).toISOString() }, { doc: "d2b", ser: "s2", name: "c.xlsx", url: "uc2", size: 3, at: new Date(T).toISOString() }] }];
const seq = [], bodies = [];
let nUp = 0;
const kNow = (n) => fs.readFileSync(path.join(KD, n), "utf8");
fs.rmSync(ST, { force: true });
dg = agentDeps({ mountRoot: async () => M2, fetch: async (u, i) => {
  const url = String(u);
  if (url.startsWith("https://store.example/up/")) { seq.push("PUT " + i.headers["Content-Type"]); return new Response("{}"); }
  if (url === "https://store.example/dl/c") { seq.push("GET(K=" + kNow("c.xlsx") + ")"); return new Response("H-c"); }
  const b = JSON.parse(i.body);
  bodies.push(b);
  const tag = b.act + (b.phase ? ":" + b.phase : "");
  let r = { ok: true }, label = tag;
  if (b.act === "hello") r = { ok: true, allow: true, daily_at: "08:30", requested: false, mass_limit: LIM, lists: lists2,
    maps: [{ id: 2, k_path: "m2", mod: "a", grp: "b", dir: "both", ssi: true, state: "active", hold: null }] };
  else if (tag === "run:start") r = { ok: true, run: 9 };
  else if (tag === "put:begin") { nUp++; label += " " + b.rel_path + " " + b.mode; r = { ok: true, path: "docs/p" + nUp, url: "https://store.example/pub/p" + nUp, upload: "https://store.example/up/" + nUp, type: "application/x-test" }; }
  else if (b.act === "apply") { label += " " + b.paths.join(",") + "(K=" + kNow("c.xlsx") + ")"; r = { ok: true, docs: Object.fromEntries(b.paths.map(p => [p, "ks-" + p])) }; }
  else if (b.act === "get") { label += "(K=" + kNow("c.xlsx") + ")"; r = { ok: true, url: "https://store.example/dl/c", sha256: sha("H-c"), size: 3, name: "c.xlsx" }; }
  seq.push(label);
  return new Response(JSON.stringify(r));
} });
rr = await runAgent(dg, { once: true });
eq(seq, ["hello", "hello", "run:start", "folders",
  "put:begin a.xlsx version", "PUT application/x-test", "put:verify",
  "get(K=K-c)", "GET(K=K-c)",
  "put:begin c (충돌 2026-11-04).xlsx old", "PUT application/x-test", "put:verify",
  "apply docs/p1,docs/p2(K=K-c)",
  "mark",
  "put:begin new.pdf new", "PUT application/x-test", "put:verify",
  "apply docs/p3(K=H-c)",
  "run:end"], "올리기 begin → PUT(Content-Type = type) → verify · 등록은 모아서 · H 가 이긴 충돌: H 판을 받아 확인 → K 쪽 판을 이전 판으로 등록 → 그 뒤에야 K 파일 이름을 바꿈");
const begins = bodies.filter(b => b.act === "put" && b.phase === "begin");
ok(begins.every(b => !("ssi" in b) && !("path" in b) && !("part" in b) && !("prefix" in b) && b.run === 9 && b.map === 2), "begin 에 ssi · path · part · prefix 를 보내지 않음(폴더는 서버가 정함)");
eq([begins[0].sha256 === sha("new-a"), begins[0].size, begins[0].row, begins[1].row, begins[2].row, begins[1].sha256 === sha("K-c")], [true, 5, 1, 2, null, true], "begin 값(크기 · sha256 · 기준선 줄)");
eq(bodies.filter(b => b.phase === "verify").map(b => Object.keys(b).sort().join(",")), ["act,path,phase", "act,path,phase", "act,path,phase"], "verify 는 path 만");
eq(bodies.filter(b => b.act === "apply").map(b => Object.keys(b).sort().join(",") + ":" + b.run), ["act,paths,run:9", "act,paths,run:9"], "apply 는 run · paths 만");
const end = bodies.find(b => b.act === "run" && b.phase === "end");
eq([rr.status, end.k2h, end.h2k, end.conflicts, end.errors, kNow("c.xlsx"), kNow("c (충돌 2026-11-04).xlsx"), kNow("a.xlsx")], ["ok", 2, 1, 1, 0, "H-c", "K-c", "new-a"], "결과 · K 파일(H 판을 놓고 K 쪽은 충돌 사본)");
ok(!bodies.some(b => b.phase === "commit"), "옛 commit 단계는 쓰지 않음");
eq(end.maps.map(x => [x.id, x.held, x.done]), [[2, false, true]], "끝까지 맞춘 연결 → done:true");

/* H 가 이긴 충돌에서 K 쪽 판을 올리기 · 확인 · 등록 중 하나라도 못 하면 받은 H 판을 놓지 않음 — K 파일 이름 · 기준선이 그대로라 다음 실행이 다시 충돌로 본다 */
const KD3 = path.join(AG, "share3", "m3");
fs.mkdirSync(KD3, { recursive: true });
for (const how of ["upload", "verify", "apply"]) {
  fs.rmSync(KD3, { recursive: true, force: true });
  fs.mkdirSync(KD3, { recursive: true });
  fs.writeFileSync(path.join(KD3, "c.xlsx"), "K-c");
  fs.utimesSync(path.join(KD3, "c.xlsx"), (T - 3600e3) / 1000, (T - 3600e3) / 1000);
  fs.rmSync(ST, { force: true });
  const fb = [];
  let nP = 0;
  dg = agentDeps({ mountRoot: async () => path.join(AG, "share3"), fetch: async (u, i) => {
    const url = String(u);
    if (url.startsWith("https://store.example/up/")) return new Response("{}", { status: how === "upload" ? 500 : 200 });
    if (url === "https://store.example/dl/c") return new Response("H-c");
    const b = JSON.parse(i.body);
    fb.push(b);
    const tag = b.act + (b.phase ? ":" + b.phase : "");
    let r = { ok: true };
    if (b.act === "hello") r = { ok: true, allow: true, daily_at: "08:30", requested: false, mass_limit: LIM,
      lists: [{ map: 3, base: [bRow(2, "c.xlsx", "old-c", "uc1")], h: [{ doc: "d2b", ser: "s2", name: "c.xlsx", url: "uc2", size: 3, at: new Date(T).toISOString() }] }],
      maps: [{ id: 3, k_path: "m3", mod: "a", grp: "b", dir: "both", ssi: false, state: "active", hold: null }] };
    else if (tag === "run:start") r = { ok: true, run: 12 };
    else if (tag === "put:begin") { nP++; r = { ok: true, path: "docs/f" + nP, url: "https://store.example/pub/f" + nP, upload: "https://store.example/up/f" + nP, type: "application/x-test" }; }
    else if (tag === "put:verify" && how === "verify") r = { ok: false, error: "hash" };
    else if (b.act === "apply") r = { ok: true, docs: how === "apply" ? {} : Object.fromEntries(b.paths.map(p => [p, "ks-" + p])) };
    else if (b.act === "get") r = { ok: true, url: "https://store.example/dl/c", sha256: sha("H-c"), size: 3, name: "c.xlsx" };
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 409 });
  } });
  rr = await runAgent(dg, { once: true });
  const fend = fb.find(b => b.act === "run" && b.phase === "end"), items = fb.filter(b => b.act === "mark").flatMap(b => b.items);
  const why = how === "verify" ? "hash" : how;
  eq([rr.status, fs.readdirSync(KD3).sort(), fs.readFileSync(path.join(KD3, "c.xlsx"), "utf8")], ["partial", ["c.xlsx"], "K-c"],
    how + ": K 파일 이름 · 내용 그대로(충돌 사본 · 임시 파일 없음)");
  eq([items.filter(x => x.op === "set").length, items.filter(x => x.op === "state" && x.id === 2).map(x => x.state + ":" + x.note)], [0, ["error:" + why]],
    how + ": 기준선은 고치지 않고 오류 표시 한 번");
  eq([fend.errors, fend.h2k, fend.k2h, fend.conflicts, fend.detail.filter(d => d.a === "error").map(d => d.f + ":" + d.r)], [1, 0, 0, 0, ["c.xlsx:" + why]], how + ": 실행 기록");
}

/* 하루 전송량 상한으로 중간에 멈춘 연결은 끝까지 맞춘 것이 아님 — done:false(서버가 승인한 보류를 쓰지 않음) */
kw("q.pdf", "Q");
fs.rmSync(ST, { force: true });
const qb = [];
dg = agentDeps({ mountRoot: async () => M2, fetch: async (u, i) => {
  const b = JSON.parse(i.body);
  qb.push(b);
  const tag = b.act + (b.phase ? ":" + b.phase : "");
  let r = { ok: true };
  if (b.act === "hello") r = { ok: true, allow: true, daily_at: "08:30", requested: false, mass_limit: LIM, lists: [{ map: 2, base: [], h: [] }],
    maps: [{ id: 2, k_path: "m2", mod: "a", grp: "b", dir: "both", ssi: false, state: "active", hold: { run: 5, ok: true } }] };
  else if (tag === "run:start") r = { ok: true, run: 11 };
  else if (tag === "put:begin") r = { ok: false, error: "quota" };
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 429 });
} });
rr = await runAgent(dg, { once: true });
const qend = qb.find(b => b.act === "run" && b.phase === "end");
eq([rr.status, qend.msg, qb.filter(b => b.act === "put").length, qend.maps.map(x => [x.id, x.held, x.done])], ["partial", "하루 전송량 상한", 1, [[2, false, false]]],
  "quota → 그 자리에서 멈춤 · done:false");

/* ── 에이전트 흐름(가짜 서버 · 응답 주입 · 실제 파일) ── */
const FS = path.join(AG, "fs");
const AT = new Date(T - 864e5).toISOString();
const mkK = (dir, files) => {
  const d = path.join(FS, dir);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  for (const [n, s] of Object.entries(files || {})) { fs.writeFileSync(path.join(d, n), s); fs.utimesSync(path.join(d, n), (T - 3600e3) / 1000, (T - 3600e3) / 1000); }
  return d;
};
const mapOf = (id, dir, o) => Object.assign({ id, k_path: dir, mod: "a", grp: "b", dir: "both", ssi: false, state: "active", hold: null }, o || {});
const hIt = (doc, name, url, o) => Object.assign({ doc, ser: "s-" + doc, name, url, size: 2, at: AT }, o || {});
const DL = "https://store.example/dl/";
const fakeSrv = (o) => {
  const seq = [], bodies = [];
  let nUp = 0;
  const fetch = async (u, i) => {
    const url = String(u);
    if (url.startsWith("https://store.example/up/")) { seq.push("PUT"); return new Response("{}"); }
    if (url.startsWith(DL)) { seq.push("GET"); return new Response(o.dl[url.slice(DL.length)]); }
    const b = JSON.parse(i.body);
    bodies.push(b);
    const tag = b.act + (b.phase ? ":" + b.phase : "");
    seq.push(tag === "put:begin" ? tag + " " + b.rel_path + " " + b.mode : b.act === "get" ? "get " + b.doc : tag);
    const x = o.reply ? await o.reply(b, tag) : null;
    if (x instanceof Response) return x;
    if (x) return new Response(JSON.stringify(x), { status: x.ok ? 200 : 409 });
    let r = { ok: true };
    if (b.act === "hello") r = { ok: true, allow: true, daily_at: "08:30", requested: false, mass_limit: LIM, maps: o.maps, lists: o.lists, paused_base: o.paused_base, flags: o.flags };
    else if (tag === "run:start") r = { ok: true, run: 21 };
    else if (tag === "put:begin") { nUp++; r = { ok: true, path: "docs/z" + nUp, url: "https://store.example/pub/z" + nUp, upload: "https://store.example/up/z" + nUp, type: "application/x-test" }; }
    else if (b.act === "apply") r = { ok: true, docs: Object.fromEntries(b.paths.map(p => [p, "ks-" + p])) };
    else if (b.act === "get") r = { ok: true, url: DL + b.doc, sha256: sha(o.dl[b.doc]), size: Buffer.byteLength(o.dl[b.doc]), name: (o.names && o.names[b.doc]) || "f.pdf" };
    return new Response(JSON.stringify(r));
  };
  return { fetch, seq, bodies, items: () => bodies.filter(b => b.act === "mark").flatMap(b => b.items) };
};
const runFake = async (s, o) => {
  const dg = agentDeps(Object.assign({ mountRoot: async () => FS, fetch: s.fetch }, o || {}));
  const r = await runAgent(dg, { once: true });
  return Object.assign(r, { dg, end: s.bodies.filter(b => b.act === "run" && b.phase === "end").pop() });
};
const kRead = (dir, n) => { try { return fs.readFileSync(path.join(FS, dir, n), "utf8"); } catch (e) { return null; } };
const html = (status) => new Response("<html>" + status + " Bad Gateway</html>", { status, headers: { "content-type": "text/html" } });
let rf, sv;

/* 표시(mark)는 서버가 받은 뒤에만 지운다 — 게이트웨이 오류로 못 보낸 기준선 표시('set')는 상태 파일에 두었다가 다음 실행이 계획 전에 먼저 보낸다 */
fs.rmSync(ST, { force: true });
mkK("m5");
const L5 = { maps: [mapOf(5, "m5")], lists: [{ map: 5, base: [], h: [hIt("dh5", "h.pdf", "uh5")] }], dl: { dh5: "H5" } };
sv = fakeSrv(Object.assign({ reply: (b) => (b.act === "mark" ? html(502) : null) }, L5));
rf = await runFake(sv);
const kept5 = readSt().marks || [];
eq([rf.status, kRead("m5", "h.pdf"), kept5.map(k => [k.map, k.items.map(x => x.op + ":" + x.rel_path + ":" + x.h_url)])], ["fail", "H5", [[5, ["set:h.pdf:uh5"]]]],
  "표시를 못 보냄(502 · JSON 아님) → 실행 멈춤 · 받은 파일의 기준선 표시는 상태 파일에 남김");
sv = fakeSrv(L5);
rf = await runFake(sv);
const m5 = sv.bodies.filter(b => b.act === "mark");
eq([rf.status, sv.seq.slice(0, 5), JSON.stringify(m5[0] && m5[0].items) === JSON.stringify(kept5[0] && kept5[0].items), m5[0] && m5[0].run, readSt().marks],
  ["ok", ["hello", "hello", "run:start", "mark", "hello"], true, 21, undefined], "다음 실행: 남긴 표시를 계획 전에 먼저 보내고 목록을 다시 받음");

/* 표시가 'state'(관리자가 연결을 멈춤 등)로 거절 → 그 연결만 멈추고 다음 연결은 그대로 · 서버가 받지 않은 표시(bad)는 오류로 셈 */
fs.rmSync(ST, { force: true });
mkK("m6", { "l.pdf": "LL" }); mkK("m7");
sv = fakeSrv({ maps: [mapOf(6, "m6"), mapOf(7, "m7")], lists: [{ map: 6, base: [], h: [hIt("dl6", "l.pdf", "ul6")] }, { map: 7, base: [], h: [hIt("dh7", "h7.pdf", "uh7")] }],
  dl: { dh7: "H7" }, reply: (b) => (b.act === "mark" && b.map === 6 ? { ok: false, error: "state" } : b.act === "mark" && b.map === 7 ? { ok: true, n: 0, bad: 1, held: false } : null) });
rf = await runFake(sv);
eq([rf.status, rf.end.maps.map(x => [x.id, x.done]), rf.end.detail.filter(d => d.a === "error").map(d => d.m + ":" + d.r), kRead("m7", "h7.pdf"),
  (readSt().marks || []).map(k => k.map + ":" + k.items.map(x => x.op + ":" + x.rel_path).join())],
  ["partial", [[6, false], [7, true]], ["6:state", "7:mark"], "H7", ["6:set:l.pdf"]], "한 연결의 표시 거절 → 그 연결만 멈춤(done:false · 표시는 남김) · bad 는 오류");

/* 등록(apply) 응답을 잃음(게이트웨이 504) — 서버가 등록했을 수 있으므로 오류 표시를 보내지 않고 실행을 멈춘다 */
fs.rmSync(ST, { force: true });
mkK("m8", { "v.pdf": "V2" });
sv = fakeSrv({ maps: [mapOf(8, "m8")], lists: [{ map: 8, base: [bRow(61, "v.pdf", "V1", "uv")], h: [hIt("d61", "v.pdf", "uv", { ser: "s61" })] }], reply: (b) => (b.act === "apply" ? html(504) : null) });
rf = await runFake(sv);
eq([rf.status, sv.seq.filter(t => t.startsWith("put:begin")), sv.items().filter(x => x.op === "state")], ["fail", ["put:begin v.pdf version"], []], "등록 응답을 잃음 → 오류 표시 없이 멈춤");

/* 분당 상한(rate) — 1분 쉬고 한 번만 다시, 그래도 막히면 실행을 멈춤(남은 파일마다 실패하지 않음) */
fs.rmSync(ST, { force: true });
mkK("m9", { "a.pdf": "A", "b.pdf": "B" });
sv = fakeSrv({ maps: [mapOf(9, "m9")], lists: [{ map: 9, base: [], h: [] }], reply: (b, tag) => (tag === "put:begin" ? new Response('{"ok":false,"error":"rate"}', { status: 429 }) : null) });
rf = await runFake(sv);
const b9 = sv.seq.filter(t => t.startsWith("put:begin"));
eq([rf.status, rf.dg.sleeps, b9.length, new Set(b9).size], ["fail", [61000], 2, 1], "rate → 한 번 쉬고 다시 · 그래도 rate 면 멈춤");

/* H 가 이긴 충돌에서 K 쪽 판은 H 이전 판으로 한 번만 — K 파일 이름을 못 바꿔도(공유에서 열려 있음) 다음 실행이 다시 올리지 않고 충돌로 둔다 */
if (NOROOT) {
  fs.rmSync(ST, { force: true });
  const d10 = mkK("m10", { "c.xlsx": "K-c" });
  let ro10 = true;
  const L10 = () => ({ maps: [mapOf(10, "m10")], lists: [{ map: 10, base: [bRow(71, "c.xlsx", "old-c", "uc1")], h: [hIt("d71b", "c.xlsx", "uc2", { ser: "s71", size: 3, at: new Date(T).toISOString() })] }],
    dl: { d71b: "H-c" }, names: { d71b: "c.xlsx" }, reply: (b) => { if (b.act === "apply" && ro10) fs.chmodSync(d10, 0o555); return null; } });   // 이전 판 등록 뒤 · 이름 바꾸기 전에 폴더를 읽기 전용으로
  sv = fakeSrv(L10());
  try { rf = await runFake(sv); } finally { fs.chmodSync(d10, 0o755); }
  eq([rf.status, sv.seq.filter(t => / old$/.test(t)).length, sv.items().filter(x => x.id === 71).map(x => x.op + ":" + x.state), kRead("m10", "c.xlsx"), Object.values(readSt().olds || {}).length],
    ["partial", 1, ["state:conflict"], "K-c", 1], "K 파일 이름을 못 바꿈 → K 쪽 판은 이미 H 이전 판 · 줄은 충돌로");
  ro10 = false;
  sv = fakeSrv(L10());
  rf = await runFake(sv);
  eq([rf.status, sv.seq.filter(t => / old$/.test(t)).length, kRead("m10", "c.xlsx"), kRead("m10", "c (충돌 2026-11-04).xlsx"), sv.items().filter(x => x.id === 71).map(x => x.op + ":" + x.state), readSt().olds],
    ["ok", 0, "H-c", "K-c", ["set:conflict"], undefined], "다음 실행: 이전 판은 다시 올리지 않고 이름 바꾸기 · 놓기만");
}

/* 삭제 확정(trash) — 옮기기 직전에 색인 값과 다시 대 본다: 그 사이 K 에서 고쳤으면 옮기지 않음 */
fs.rmSync(ST, { force: true });
const d11 = mkK("m11", { "t.pdf": "T1" });
const r81 = Object.assign(bRow(81, "t.pdf", "T1", "ut"), { state: "trash", k_mtime: new Date(T - 3600e3).toISOString() });
sv = fakeSrv({ maps: [mapOf(11, "m11")], lists: [{ map: 11, base: [r81], h: [hIt("dg11", "g.pdf", "ug11")] }], dl: { dg11: "G1" },
  reply: (b) => { if (b.act === "get") fs.writeFileSync(path.join(d11, "t.pdf"), "T1-edited"); return null; } });
rf = await runFake(sv);
eq([kRead("m11", "t.pdf"), fs.existsSync(path.join(d11, TRASH)), sv.items().filter(x => x.op === "drop" || x.id === 81), rf.end.detail.filter(d => d.f === "t.pdf" && d.a === "skip").map(d => d.r)],
  ["T1-edited", false, [], ["changed"]], "확정 뒤 · 옮기기 전에 K 에서 고침 → 휴지통으로 옮기지 않음(다음 실행이 고친 것으로 봄)");

/* 색인한 뒤 올리기 전에 K 파일이 바뀜 — sha 를 다시 재어 건너뜀(changed): 시작(begin) · 올리기 없음 · 오류 표시 없음 */
fs.rmSync(ST, { force: true });
const d12 = mkK("m12", { "a.pdf": "A1", "b.pdf": "B1" });
let first12 = "";
sv = fakeSrv({ maps: [mapOf(12, "m12")], lists: [{ map: 12, base: [], h: [] }],
  reply: (b, tag) => { if (tag === "put:begin" && !first12) { first12 = b.rel_path; fs.writeFileSync(path.join(d12, first12 === "a.pdf" ? "b.pdf" : "a.pdf"), "X2"); } return null; } });
rf = await runFake(sv);
const other12 = first12 === "a.pdf" ? "b.pdf" : "a.pdf";
eq([rf.status, sv.seq.filter(t => t.startsWith("put:begin")), rf.end.detail.filter(d => d.f === other12).map(d => d.a + ":" + d.r), sv.items().filter(x => x.op === "state")],
  ["ok", ["put:begin " + first12 + " new"], ["skip:changed"], []], "색인 뒤 바뀐 K 파일 → 올리지 않고 건너뜀(changed)");

/* 확인까지 끝난 올리기는 가장 오래된 것이 20분이 되면 내려받기 사이에도 등록(서버는 1시간 뒤 버림) */
fs.rmSync(ST, { force: true });
mkK("m13", { "n.pdf": "N1" });
let clk = T;
sv = fakeSrv({ maps: [mapOf(13, "m13")], lists: [{ map: 13, base: [], h: ["g1", "g2", "g3"].map(d => hIt(d, d + ".pdf", "u" + d)) }], dl: { g1: "G1", g2: "G2", g3: "G3" },
  reply: (b) => { if (b.act === "get") clk += 11 * 60e3; return null; } });
rf = await runFake(sv, { now: () => clk });
eq([rf.status, sv.seq.filter(t => t === "apply" || t.startsWith("get "))], ["ok", ["get g1", "get g2", "apply", "get g3"]], "올리기 20분 → 다음 내려받기 전에 등록");

/* 이름 바꿈 · 판 묶음 다시 잇기 표시는 같은 실행의 올리기보다 먼저 보낸다(새 판이 새 판 묶음으로 가도록) */
fs.rmSync(ST, { force: true });
mkK("m14", { "p.pdf": "P2", "r2.pdf": "R1" });
sv = fakeSrv({ maps: [mapOf(14, "m14")], lists: [{ map: 14, base: [bRow(91, "p.pdf", "P1", "up"), bRow(92, "r.pdf", "R1", "ur")],
  h: [hIt("dp2", "p.pdf", "up", { ser: "새 묶음" }), hIt("d92", "r.pdf", "ur", { ser: "s92" })] }] });
rf = await runFake(sv);
const fm14 = sv.seq.indexOf("mark"), fb14 = sv.seq.findIndex(t => t.startsWith("put:begin"));
eq([rf.status, fm14 >= 0 && fm14 < fb14, sv.bodies.find(b => b.act === "mark").items.map(x => x.op + ":" + x.id), sv.seq[fb14]], ["ok", true, ["set:91", "rename:92"], "put:begin p.pdf version"],
  "다시 잇기 · 이름 바꿈 표시 → 그 뒤 올리기");

/* 미리보기 건수에는 센 설정의 시각(hello 의 updated_at)을 붙인다 — 그 사이 관리자가 설정을 고쳤으면 서버가 옛 건수를 버린다 */
fs.rmSync(ST, { force: true });
mkK("m15", { "a.pdf": "A" });
const UPD15 = "2026-11-04T00:00:00.123456+00:00";
sv = fakeSrv({ maps: [mapOf(15, "m15", { state: "preview", updated_at: UPD15 })], lists: [{ map: 15, base: [], h: [] }] });
rf = await runFake(sv);
const pv15 = sv.bodies.find(b => b.act === "preview");
eq([rf.status, pv15 && pv15.map, pv15 && pv15.counts.k2h, pv15 && pv15.updated_at], ["ok", 15, 1, UPD15], "미리보기 건수와 함께 센 설정 시각을 보냄");

/* 미리보기 건수를 보내는 사이 관리자가 [시작] · 멈춤 · 지우기(state) — 그 건수만 버리고 다음 연결은 그대로 맞춤(실행 전체를 '실패'로 끝내지 않음).
   다른 거절(bad 등)은 그 연결의 오류로 셈 */
for (const [err, status, errors] of [["state", "ok", 0], ["bad", "partial", 1]]) {
  fs.rmSync(ST, { force: true });
  mkK("m16", { "a.pdf": "A" }); mkK("m17");
  sv = fakeSrv({ maps: [mapOf(16, "m16", { state: "preview" }), mapOf(17, "m17")], lists: [{ map: 16, base: [], h: [] }, { map: 17, base: [], h: [hIt("dh17", "h17.pdf", "uh17")] }],
    dl: { dh17: "H17" }, reply: (b) => (b.act === "preview" ? { ok: false, error: err } : null) });
  rf = await runFake(sv);
  eq([rf.status, kRead("m17", "h17.pdf"), rf.end && rf.end.maps.map(x => [x.id, x.done]), rf.end && rf.end.errors], [status, "H17", [[16, false], [17, true]], errors],
    "미리보기 건수 거절(" + err + ") → 그 연결만 · 다음 연결은 맞춤");
}

/* v1.64 기준일 — 에이전트가 연결의 기준일 · 모든 연결 기준선(크기 · 해시)을 색인 · 계획에 넘긴다: 옛 파일은 올리지 않고(미리보기 건수 old),
   다른 연결 기준선과 해시가 같은 옛 파일은 올림 · 파일 수는 옛 파일을 빼고 · 기준일을 읽지 못하면 그 연결을 건너뜀 · 새 문서 시작에 수정 시각을 보냄 */
{
  fs.rmSync(ST, { force: true });
  const SN = Date.parse("2025-08-01T00:00:00+09:00");
  const kt = (d, n, s, t) => { fs.writeFileSync(path.join(d, n), s); fs.utimesSync(path.join(d, n), t / 1000, t / 1000); };
  const d18 = mkK("m18"), d19 = mkK("m19"), d21 = mkK("m21");
  mkK("m20");
  kt(d18, "old.pdf", "O18", SN - 864e5); kt(d18, "new.pdf", "N18", SN + 864e5); kt(d18, "moved.pdf", "MOVED", SN - 864e5);
  kt(d19, "x.pdf", "X19", SN + 864e5);
  kt(d21, "old.pdf", "O21", SN - 864e5); kt(d21, "new.pdf", "N21", SN + 864e5);
  sv = fakeSrv({ maps: [mapOf(18, "m18", { since: "2025-08-01" }), mapOf(19, "m19", { since: "2025-02-30" }), mapOf(20, "m20"), mapOf(21, "m21", { state: "preview", since: "2025-08-01" })],
    lists: [{ map: 18, base: [], h: [] }, { map: 19, base: [], h: [] }, { map: 20, base: [bRow(95, "gone/moved.pdf", "MOVED", "um")], h: [hIt("d95", "moved.pdf", "um")] }, { map: 21, base: [], h: [] }] });
  // 점검용 --dry-run 도 같은 기준일 · 전체 기준선 — 옮기기 전 이름 확인이 실제 실행과 같게
  const outs = [];
  const rd = await runAgent(agentDeps({ mountRoot: async () => FS, fetch: sv.fetch, out: (o) => outs.push(o) }), { dryRun: true });
  const o18 = outs.find(o => o.map === 18), o21 = outs.find(o => o.map === 21);
  eq([rd.status, o18 && o18.actions.slice().sort(), o18 && o18.counts.old, outs.find(o => o.map === 19), o21 && o21.counts.old],
    ["dry-run", ["put moved.pdf new", "put new.pdf new"], 1, { map: 19, k_path: "m19", error: "since" }, 1], "--dry-run: 옛 파일은 계획에 없고 old 로 셈 · 다른 연결 기준선과 해시가 같으면 올림 · 기준일을 못 읽은 연결은 since");
  rf = await runFake(sv);
  const bg = sv.bodies.filter(b => b.act === "put" && b.phase === "begin");
  const pv21 = sv.bodies.find(b => b.act === "preview");
  eq([rf.status, bg.map(b => b.map + ":" + b.rel_path).sort(), rf.end.maps.find(x => x.id === 18).n_files, rf.end.detail.filter(d => d.r === "since").map(d => d.m + ":" + d.f), rf.end.detail.some(d => /old\.pdf/.test(d.f))],
    ["partial", ["18:moved.pdf", "18:new.pdf"], 2, ["19:m19"], false], "에이전트: 옛 파일은 올리지 않음 · 다른 연결 기준선과 해시가 같으면 올림 · 파일 수는 옛 파일 빼고 · 기준일을 못 읽은 연결은 건너뜀");
  eq(bg.map(b => b.rel_path + "@" + b.mtime).sort(), ["moved.pdf@" + new Date(SN - 864e5).toISOString(), "new.pdf@" + new Date(SN + 864e5).toISOString()], "새 문서 시작에 수정 시각(서버도 기준일로 대 봄)");
  eq([pv21 && pv21.map, pv21 && pv21.counts.k2h, pv21 && pv21.counts.old], [21, 1, 1], "미리보기 건수에 기준일 전 파일 수(old)");
  // 멈춘 연결은 목록이 없다 — 그 기준선(hello full 의 paused_base)과 해시가 같은 옛 파일도 새 파일로(서버 put_begin 과 같은 '어느 연결이든')
  fs.rmSync(ST, { force: true });
  const d22 = mkK("m22");
  kt(d22, "moved.pdf", "MOVED22", SN - 864e5); kt(d22, "old.pdf", "OLD22", SN - 864e5);
  sv = fakeSrv({ maps: [mapOf(22, "m22", { since: "2025-08-01" }), mapOf(23, "m23", { state: "paused" })], lists: [{ map: 22, base: [], h: [] }],
    paused_base: [{ k_size: 7, k_sha256: sha("MOVED22") }] });
  rf = await runFake(sv);
  eq([rf.status, sv.bodies.filter(b => b.act === "put" && b.phase === "begin").map(b => b.map + ":" + b.rel_path + ":" + b.mode), rf.end.maps.find(x => x.id === 22).n_files],
    ["ok", ["22:moved.pdf:new"], 1], "멈춘 연결 폴더에서 옮긴 옛 파일 → 올림(그 밖의 옛 파일은 그대로 뺌)");
}

/* v1.68 링크 — 에이전트는 hello 의 flags.link_all 을 따른다: 켜지면 옛 판(lists[].olds)을 계획에 넘기고 기준일 전 파일 중 링크 후보만 해시해 연결만,
   깃발이 없거나(옛 서버) 꺼지면 그 전 그대로(옛 판 무시 · 기준일 전 파일은 해시도 연결도 안 함) */
{
  fs.rmSync(ST, { force: true });
  const SN = Date.parse("2025-08-01T00:00:00+09:00");
  const d24 = mkK("m24");
  fs.writeFileSync(path.join(d24, "보고.pdf"), "OLDV"); fs.utimesSync(path.join(d24, "보고.pdf"), (SN - 864e5) / 1000, (SN - 864e5) / 1000);
  const L24 = (flags) => ({ flags, maps: [mapOf(24, "m24", { since: "2025-08-01", dir: "k2h" })],
    lists: [{ map: 24, base: [], h: [hIt("dc24", "보고 v2.pdf", "uc24", { ser: "S24", size: 9 })], olds: [{ ser: "S24", doc: "do24", name: "보고.pdf", size: 4, url: "uo24", date: "2025-01-01" }] }] });
  for (const f of [undefined, { link_all: false }]) {
    sv = fakeSrv(L24(f));
    rf = await runFake(sv);
    eq([rf.status, sv.items().filter(x => x.op === "set").length, sv.bodies.filter(b => b.act === "put").length], ["ok", 0, 0], "깃발 " + JSON.stringify(f) + " → 옛 판 무시 · 기준일 전 파일은 그대로 뺌");
  }
  sv = fakeSrv(L24({ link_all: true }));
  rf = await runFake(sv);
  eq([rf.status, sv.items().filter(x => x.op === "set").map(x => [x.rel_path, x.doc_id, x.h_url, x.k_sha256 === sha("OLDV")]), sv.bodies.filter(b => b.act === "put").length],
    ["ok", [["보고.pdf", "do24", "uo24", true]], 0], "link_all → 기준일 전 K 파일을 해시해 옛 판과 연결만(올리기 없음)");
}

/* 설치 · 제거(install.sh · uninstall.sh) — HOME 은 임시 폴더, 키체인(security) · launchctl 은 가짜 명령 */
{
  const IH = path.join(TMP, "home"), BIN = path.join(TMP, "bin"), LC = path.join(TMP, "launchctl.log");
  const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  fs.mkdirSync(BIN, { recursive: true }); fs.mkdirSync(IH, { recursive: true });
  fs.writeFileSync(path.join(BIN, "security"), "#!/bin/sh\nif [ \"$1\" = find-generic-password ]; then echo " + "a".repeat(64) + "; fi\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(BIN, "launchctl"), "#!/bin/sh\necho \"$@\" >> \"$KSYNC_TEST_LC\"\n", { mode: 0o755 });
  const sh = (script, input) => spawnSync("/bin/bash", [path.join(SRC, script)], { input, encoding: "utf8", timeout: 30000,
    env: { PATH: process.env.PATH, HOME: IH, USER: "tester", KSYNC_NODE: process.execPath, KSYNC_SECURITY: path.join(BIN, "security"), KSYNC_LAUNCHCTL: path.join(BIN, "launchctl"), KSYNC_TEST_LC: LC } });
  const APPD = path.join(IH, "Library", "Application Support", "hdrive-ksync"), PL = path.join(IH, "Library", "LaunchAgents", "kr.hdrive.ksync.plist"), CFG = path.join(APPD, "config.json");
  const plist = () => fs.readFileSync(PL, "utf8");
  const cal = () => { const m = /<key>StartCalendarInterval<\/key>\s*<dict><key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer><\/dict>/.exec(plist()); return m ? [Number(m[1]), Number(m[2])] : null; };
  let ri = sh("install.sh", "https://edge.example/functions/v1/semis-logi-ksync\nsmb://nas.example/share\nn\n");
  eq([ri.status, cal()], [0, [8, 30]], "설치: 매일 실행 시작 시각(기본 08:30)에도 깨움 " + ri.stderr);
  ok(/<key>RunAtLoad<\/key><true\/>/.test(plist()) && /<key>StartInterval<\/key><integer>1800<\/integer>/.test(plist()) && /<key>WatchPaths<\/key>\s*<array><string>\/Library\/Preferences\/SystemConfiguration<\/string><\/array>/.test(plist()),
    "설치: 로그인 때 · 30분마다 · 네트워크가 바뀔 때는 그대로");
  if (fs.existsSync("/usr/bin/plutil")) {
    const pj = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", PL], { encoding: "utf8" });
    const j = JSON.parse(pj.stdout || "{}");
    eq([pj.status, j.StartCalendarInterval, j.StartInterval, j.RunAtLoad, j.WatchPaths], [0, { Hour: 8, Minute: 30 }, 1800, true, ["/Library/Preferences/SystemConfiguration"]], "설치: plist 형식(plutil)");
  }
  eq([fs.readdirSync(path.join(APPD, "agent")).sort(), JSON.parse(fs.readFileSync(CFG, "utf8")).smbUrl, (fs.statSync(CFG).mode & 0o777).toString(8), /bootstrap gui\/\d+ /.test(fs.readFileSync(LC, "utf8"))],
    [["ksync.mjs", "lib.mjs", "package.json", "plan.mjs"], "smb://nas.example/share", "600", true], "설치: 에이전트 사본 · 설정(600) · LaunchAgent 등록");
  fs.writeFileSync(CFG, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(CFG, "utf8")), { dailyAt: "07:05" })));
  ri = sh("install.sh", "\n\nn\n");
  eq([ri.status, cal(), JSON.parse(fs.readFileSync(CFG, "utf8")).dailyAt], [0, [7, 5], "07:05"], "다시 설치: 설정 dailyAt(07:05)을 따름 · 주소는 Enter 로 그대로");
  // 형식이 틀린 dailyAt — 에이전트(checkConfig)가 돌지 않는 설정이면 설치도 멈춤(LaunchAgent 는 그대로 · 다시 등록하지 않음)
  for (const bad of ["9:5", "", 830]) {
    fs.writeFileSync(CFG, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(CFG, "utf8")), { dailyAt: bad })));
    fs.writeFileSync(LC, "");
    ri = sh("install.sh", "\n\nn\n");
    eq([ri.status !== 0, /dailyAt 형식/.test(ri.stderr), cal(), fs.readFileSync(LC, "utf8"), checkConfig({ server: "https://edge.example/f", smbUrl: "smb://nas.example/share", dailyAt: bad })],
      [true, true, [7, 5], "", "dailyAt 형식(HH:MM)"], "설정 dailyAt 형식이 틀림(" + JSON.stringify(bad) + ") → 에이전트처럼 설치도 멈춤 " + ri.stderr);
  }
  fs.writeFileSync(LC, "");
  const ru = sh("uninstall.sh", "n\n");
  eq([ru.status, fs.existsSync(PL), fs.existsSync(path.join(APPD, "agent")), fs.existsSync(CFG), /bootout gui\/\d+\/kr\.hdrive\.ksync/.test(fs.readFileSync(LC, "utf8"))], [0, false, false, true, true],
    "제거: LaunchAgent · 에이전트 사본만 지우고 설정은 남김");
}
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`ksync plan: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
