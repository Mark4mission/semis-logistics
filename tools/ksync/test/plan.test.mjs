// K드라이브 동기화 계획(plan.mjs) · 도우미(lib.mjs) 단위 시험 — 의존성 없음. 실행: node tools/ksync/test/plan.test.mjs (npm test 가 함께 돌림)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plan, excluded, safeName, conflictName, limitHit, CONFLICT_RE, K_BLOCK, H_BLOCK, MAX_SIZE } from "../plan.mjs";
import { relOk, safeAbs, parseSmb, checkConfig, kstDay, kstMin, hhmm, indexDir, moveAside, cleanTrash, folderTree } from "../lib.mjs";

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

/* 건너뜀 */
p = P({ kList: [{ rel: "big.zip", size: MAX_SIZE + 1, mtime: T, sha: null }, { rel: "x.html", size: 1, mtime: T, sha: H("h") }], hList: [{ doc: "e", ser: "e", name: "run.bat", url: "ue", size: 1 }] });
eq([ops(p), p.counts.skip], [["event:type_block:run.bat"], 3], "50MB · html · 실행 파일");
p = P({ hList: [{ doc: "s", ser: "s", name: "s.pdf", url: "us", size: 1, ssi: true }] });
eq(p.actions.length, 0, "SSI 아닌 연결은 SSI 문서 안 받음");
p = P({ kList: [{ rel: "a.pdf", size: 1, mtime: T, sha: H("q") }], hList: [{ doc: "x", ser: "x", name: "a.pdf", url: "ux", size: 9 }] });
eq(ops(p), ["put:new:a.pdf", "get::a (2).pdf"], "같은 이름 다른 파일 → 새 이름");

/* 대량 변경 보류 */
const many = Array.from({ length: 70 }, (_, i) => row(i + 1, "f" + i + ".pdf", { k_sha256: H("a").slice(0, 60) + String(1000 + i) }));
p = P({ baseline: many, kList: many.map((r, i) => kOf(r, i < 25 ? { sha: H("z").slice(0, 60) + String(1000 + i) } : {})), hList: many.map(r => hOf(r)) });
eq([p.held, p.n, p.actions.length, p.planned.length], [true, 25, 0, 25], "30% 넘음(25/70) → 보류 · 실행 없음");
p = P({ baseline: many, kList: many.map((r, i) => kOf(r, i < 19 ? { sha: H("z").slice(0, 60) + String(1000 + i) } : {})), hList: many.map(r => hOf(r)) });
eq(p.held, false, "20건 미만은 비율 안 봄");
p = P({ map: Object.assign({}, MAP, { hold: { ok: true } }), baseline: many, kList: many.map((r, i) => kOf(r, i < 25 ? { sha: H("z").slice(0, 60) + String(1000 + i) } : {})), hList: many.map(r => hOf(r)) });
eq([p.held, p.actions.length], [false, 25], "승인되면 진행");
p = P({ map: Object.assign({}, MAP, { hold: { run: 3 } }), baseline: B, kList: B.map(r => kOf(r)), hList: B.map(r => hOf(r)) });
eq(p.held, true, "승인 전 보류는 그대로");

/* 도우미 — 경로 · 설정 · 시각 */
["a/b.pdf", "가/나 다.xlsx"].forEach(x => ok(relOk(x), "경로 " + x));
["/etc/x", "../x", "a/../b", "a//b", "a\\b", "C:x", "", "a/"].forEach(x => ok(!relOk(x), "경로 거절 " + x));
eq(parseSmb("smb://nas.example/share/sub%20dir"), { host: "nas.example", port: 445, share: "share", sub: ["sub dir"], url: "smb://nas.example/share/sub%20dir" }, "SMB 주소");
eq([parseSmb("smb://h/"), parseSmb("http://h/s"), parseSmb('smb://h/s"x'), parseSmb("smb://h/s/../t")], [null, null, null, null], "SMB 주소 거절");
eq(checkConfig({ server: "https://x.supabase.co/functions/v1/semis-logi-ksync", smbUrl: "smb://h/s" }), "", "설정 정상");
ok(checkConfig({ server: "http://x/", smbUrl: "smb://h/s" }) && checkConfig({ server: "https://x/", smbUrl: "smb://h/s", dailyAt: "9" }), "설정 거절");
eq([kstDay(Date.parse("2026-11-03T15:00:00Z")), kstMin(Date.parse("2026-11-03T23:30:00Z")), hhmm("08:30"), hhmm("8:30")], ["2026-11-04", 510, 510, null], "한국 시각");

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
eq(await cleanTrash(root, Date.parse("2026-11-04T00:00:00Z")), 1, "30일 지난 휴지통 정리");
eq((await folderTree(root)).map(f => f.path), ["d"], "폴더 목록(동기화 폴더 · 링크 제외)");
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`ksync plan: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
