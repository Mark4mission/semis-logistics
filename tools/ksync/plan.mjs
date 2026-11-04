/* H:drive K드라이브 동기화 — 계획(순수 함수). 파일 · 네트워크를 건드리지 않는다.
   plan({ map, baseline, kList, hList, limit, today, maxSize }) → { actions[], held, n, base, counts, detail[] }
   - baseline = 마지막으로 맞춘 상태(ksync_files 줄), kList = K 색인 [{ rel, size, mtime(ms), sha }], hList = H 쪽 현재 판 [{ doc, ser, name, url, size, at, date, title }]
   - 삭제는 전파하지 않는다(삭제 대기). 양쪽이 바뀌면 수정 시각이 늦은 쪽이 현재 판, 다른 쪽은 남긴다(H 이전 판 / K '이름 (충돌 날짜)').
   - 변경 · 삭제 대기 수 n 은 서버(ksync_count)와 같은 규칙: 새 판 올리기 · 맞춘 판 묶음 덮어쓰기 · 새 삭제 대기 */

export const MAX_SIZE = 50 * 1024 * 1024;
export const TRASH = "_H드라이브_휴지통";
export const PREV = "_H드라이브_이전판";
/* H 로 올리지 않는 형식(semis-logi-files BLOCK_TYPES) · K 로 쓰지 않는 형식(실행 파일 · 스크립트 · 바로 가기) — SQL 과 같은 목록 */
export const H_BLOCK = /\.(html?|xht(ml)?|m?js)$/i;
export const K_BLOCK = /\.(exe|bat|cmd|com|scr|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|sh|command|app|jar|lnk|url|hta|html?|pif|cpl|reg|dll)$/i;
export const CONFLICT_RE = / \(충돌 \d{4}-\d{2}-\d{2}(?: \d+)?\)(\.[^./]{1,10})?$/;

/* 색인에서 빼는 이름 — 임시 · 숨김 · 시스템 파일 · 동기화가 쓰는 폴더 · 충돌 사본 */
export function excluded(name, isDir) {
  const n = String(name || "");
  if (!n || n.startsWith(".") || n.startsWith("~$")) return true;
  if (isDir) return n === TRASH || n === PREV;
  const l = n.toLowerCase();
  return l === "thumbs.db" || l === "desktop.ini" || l.endsWith(".tmp") || CONFLICT_RE.test(n.normalize("NFC"));
}
export const nfc = (s) => String(s == null ? "" : s).normalize("NFC");
export const baseOf = (p) => { const s = String(p || ""); return s.slice(s.lastIndexOf("/") + 1); };
export const dirOf = (p) => { const s = String(p || ""); const i = s.lastIndexOf("/"); return i < 0 ? "" : s.slice(0, i); };
export const extOf = (p) => { const m = /(\.[^./]{1,10})$/.exec(baseOf(p)); return m ? m[1] : ""; };
export const stemOf = (p) => { const b = baseOf(p), e = extOf(b); return (e ? b.slice(0, -e.length) : b) || b; };
export const join = (d, n) => (d ? d + "/" + n : n);
/* H 파일 이름 → K 에 쓸 이름 */
export function safeName(name) {
  let s = nfc(name).replace(/[\u0000-\u001f\u007f/\\:]/g, "_").trim();
  if (s.startsWith(".") || s.startsWith("~$")) s = "_" + s;
  if (s.length > 150) { const e = extOf(s); s = s.slice(0, 150 - e.length) + e; }
  return s || "file";
}
export const conflictName = (rel, today, n) => join(dirOf(rel), stemOf(rel) + " (충돌 " + today + (n > 1 ? " " + n : "") + ")" + extOf(rel));
export function limitHit(n, base, lim) {
  const files = Number(lim && lim.files) || 200, ratio = Number(lim && lim.ratio) || 0.3, min = Number(lim && lim.min) || 20;
  return n > files || (base > 0 && n >= min && n / base > ratio);
}
const hTime = (it) => { const a = Date.parse(it.at || ""); if (!isNaN(a)) return a; const d = Date.parse((it.date || "") + "T00:00:00+09:00"); return isNaN(d) ? 0 : d; };

export function plan(input) {
  const map = input.map || {};
  const maxSize = input.maxSize || MAX_SIZE;
  const today = input.today || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const canK2H = map.dir !== "h2k", canH2K = map.dir !== "k2h";
  const rows = (input.baseline || []).slice();
  const kList = (input.kList || []).map(k => Object.assign({}, k, { rel: nfc(k.rel) }));
  const hList = (input.hList || []).filter(it => it && it.url && it.name && (map.ssi || !it.ssi));
  const kBy = new Map(kList.map(k => [k.rel, k]));
  const rowRel = new Set(rows.map(r => r.rel_path));
  const actions = [], detail = [];
  const counts = { k2h: 0, h2k: 0, link: 0, del: 0, conflict: 0, skip: 0, total: 0 };
  let n = 0;
  const line = (f, a, r) => detail.push({ m: map.id, f: String(f || "").slice(0, 200), a, r: r || "" });
  const add = (a) => { actions.push(a); return a; };

  /* H 현재 판 ↔ 기준선 — 판 묶음(ser) 안에서 파일 이름으로, 남은 것이 하나씩이면 이름이 달라도 같은 문서의 새 판 */
  const pairH = new Map(), usedH = new Set();
  const bySer = (arr, key) => { const m = new Map(); arr.forEach(x => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
  const hSer = bySer(hList, x => x.ser), rSer = bySer(rows.filter(r => r.ser), r => r.ser);
  rSer.forEach((rs, ser) => {
    const its = hSer.get(ser) || [];
    rs.forEach(r => { const it = its.find(i => !usedH.has(i) && i.name === r.h_name); if (it) { pairH.set(r.id, it); usedH.add(it); } });
    const lr = rs.filter(r => !pairH.has(r.id)), li = its.filter(i => !usedH.has(i));
    if (lr.length === 1 && li.length === 1) { pairH.set(lr[0].id, li[0]); usedH.add(li[0]); }
  });
  /* K 이름 바꿈 · 이동 — K 에서 사라진 줄과 같은 해시 · 크기의 새 파일이 하나뿐이면 */
  const untrackedK = kList.filter(k => !rowRel.has(k.rel));
  const usedK = new Set();
  const renamed = new Map();
  rows.forEach(r => {
    if (kBy.has(r.rel_path) || !r.k_sha256 || r.state === "trash") return;
    const c = untrackedK.filter(k => !usedK.has(k) && k.sha === r.k_sha256 && k.size === r.k_size);
    if (c.length === 1) { renamed.set(r.id, c[0]); usedK.add(c[0]); }
  });
  /* 맞춘 판 묶음을 K 에 다시 쓰면 서버도 변경으로 센다 */
  const overSer = new Set(rows.filter(r => r.k_sha256 && r.state !== "restore").map(r => r.ser));
  const taken = new Set(kList.map(k => k.rel).concat(rows.map(r => r.rel_path)));
  const freePath = (rel) => {
    if (!taken.has(rel)) { taken.add(rel); return rel; }
    for (let i = 2; i < 1000; i++) { const p = join(dirOf(rel), stemOf(rel) + " (" + i + ")" + extOf(rel)); if (!taken.has(p)) { taken.add(p); return p; } }
    return null;
  };
  const putOk = (k, rel) => {
    if (k.size > maxSize || !k.sha) return "too_large";
    if (H_BLOCK.test(rel)) return "type";
    return "";
  };
  const getOk = (it) => (K_BLOCK.test(it.name) ? "type_block" : excluded(safeName(it.name), false) ? "name" : "");
  const skipRow = (r, why, f) => {
    counts.skip++; line(f || r.rel_path, "skip", why);
    if (r.state !== "skip" || r.note !== why) add({ op: "state", row: r.id, state: "skip", note: why, rel: r.rel_path });
    if (why === "type_block") add({ op: "event", kind: "type_block", f: f || r.rel_path });
  };
  const putA = (k, rel, mode, r, extra) => {
    const why = putOk(k, rel);
    if (why) { if (r && mode !== "old") skipRow(r, why, rel); else { counts.skip++; line(rel, "skip", why); } return null; }
    if (mode === "version") n++;
    if (mode !== "old") counts.k2h++;
    line(rel, "k2h", mode === "version" ? "새 판" : mode === "old" ? "이전 판" : "새 문서");
    return add(Object.assign({ op: "put", rel, mode, row: r ? r.id : null, k }, extra || {}));
  };
  const getA = (it, rel, r, extra) => {
    const why = getOk(it);
    if (why) { if (r) skipRow(r, why, it.name); else { counts.skip++; line(it.name, "skip", why); if (why === "type_block") add({ op: "event", kind: "type_block", f: it.name }); } return null; }
    const over = overSer.has(it.ser);
    if (over) n++;
    counts.h2k++;
    line(rel, "h2k", r ? "새 판" : "새 파일");
    return add(Object.assign({ op: "get", rel, it, row: r ? r.id : null, over }, extra || {}));
  };
  const pend = (r, st) => {
    counts.del++;
    line(r.rel_path, st, st === "del_k" ? "K드라이브에서 지움" : "H:drive 에서 지움");
    if (r.state !== st) { n++; add({ op: "state", row: r.id, state: st, note: "", rel: r.rel_path }); }
  };

  const tail = [];
  rows.forEach(r => {
    let k = kBy.get(r.rel_path);
    const rk = renamed.get(r.id);
    if (!k && rk) { k = rk; add({ op: "rename", row: r.id, rel: rk.rel, from: r.rel_path, k }); counts.link++; line(rk.rel, "rename", "이름 바꿈 · 이동"); }
    const it = pairH.get(r.id);
    const rel = k ? k.rel : r.rel_path;
    const kCh = !!k && (k.size !== r.k_size || (!!k.sha && k.sha !== r.k_sha256) || (!k.sha && k.size > maxSize));
    const hCh = !!it && it.url !== r.h_url;
    const hTarget = () => {
      if (it.name === r.h_name) return rel;
      const t = join(dirOf(rel), safeName(it.name));
      return t === rel ? t : freePath(t) || rel;
    };
    if (r.state === "trash") { if (k) { tail.push({ op: "trash", row: r.id, rel }); line(rel, "trash", "휴지통으로"); } else tail.push({ op: "drop", row: r.id }); return; }
    if (r.state === "restore") {
      if (!it && k) { putA(k, rel, "new", r); line(rel, "restore", "H:drive 로 복원"); }
      else if (!k && it) { getA(it, r.rel_path, r); line(r.rel_path, "restore", "K드라이브로 복원"); }
      else if (k && it) add({ op: "state", row: r.id, state: "ok", note: "", rel });
      else tail.push({ op: "drop", row: r.id });
      return;
    }
    if ((r.state === "del_k" && !k) || (r.state === "del_h" && !it)) { counts.del++; line(r.rel_path, r.state, "확인 대기"); return; }
    if (!k && !it) { tail.push({ op: "drop", row: r.id }); line(r.rel_path, "drop", "양쪽 모두 없음"); return; }
    if (!k) { if (hCh && canH2K) getA(it, hTarget(), r); else pend(r, "del_k"); return; }
    if (!it) { if (kCh && canK2H) putA(k, rel, "new", r); else pend(r, "del_h"); return; }
    if (!kCh && !hCh) { if (r.state === "del_k" || r.state === "del_h") add({ op: "state", row: r.id, state: "ok", note: "", rel }); return; }
    if (kCh && !hCh) { if (canK2H) putA(k, rel, "version", r); else skipRow(r, "dir", rel); return; }
    if (!kCh && hCh) { if (canH2K) getA(it, hTarget(), r, { backup: rel }); else skipRow(r, "dir", rel); return; }
    /* 양쪽 다 바뀜 */
    counts.conflict++;
    const kWins = map.dir === "k2h" ? true : map.dir === "h2k" ? false : k.mtime >= hTime(it);
    line(rel, "conflict", kWins ? "K 쪽이 늦게 고침" : "H:drive 쪽이 늦게 고침");
    if (kWins) {
      if (putA(k, rel, "version", r, { state: "conflict" }) && canH2K) getA(it, conflictName(join(dirOf(rel), safeName(it.name)), today, 1), null, { copy: true, ser: it.ser });
    } else {
      const why = getOk(it);
      if (why) { skipRow(r, why, it.name); return; }
      const cf = conflictName(rel, today, 1);
      add({ op: "kconf", row: r.id, rel, to: cf });
      if (getA(it, hTarget(), r, { state: "conflict" }) && canK2H) putA(Object.assign({}, k, { rel: cf }), cf, "old", r);
    }
  });

  /* K 에만 있는 파일 */
  untrackedK.forEach(k => {
    if (usedK.has(k)) return;
    const it = hList.find(i => !usedH.has(i) && nfc(i.name) === baseOf(k.rel) && Number(i.size) === k.size);
    if (it) { usedH.add(it); counts.link++; line(k.rel, "link", "같은 파일"); add({ op: "link", rel: k.rel, k, it }); return; }
    if (canK2H) putA(k, k.rel, "new", null);
  });
  /* H 에만 있는 문서 */
  hList.forEach(it => {
    if (usedH.has(it) || !canH2K) return;
    const why = getOk(it);
    if (why) { counts.skip++; line(it.name, "skip", why); if (why === "type_block") add({ op: "event", kind: "type_block", f: it.name }); return; }
    const rel = freePath(safeName(it.name));
    if (!rel) { counts.skip++; line(it.name, "skip", "name"); return; }
    getA(it, rel, null);
  });
  tail.forEach(a => actions.push(a));

  const base = rows.filter(r => r.k_sha256 && r.h_url).length;
  const held = !(map.hold && map.hold.ok) && (!!map.hold || limitHit(n, base, input.limit));
  counts.total = counts.k2h + counts.h2k + counts.link + counts.del + counts.conflict + counts.skip;
  return { actions: held ? [] : actions, planned: actions, held, n, base, counts, detail };
}
