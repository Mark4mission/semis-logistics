/* H:drive K드라이브 동기화 — 계획(순수 함수). 파일 · 네트워크를 건드리지 않는다.
   plan({ map, baseline, kList, kErr, kCapped, hList, limit, today, maxSize, since, allSha }) → { actions[], held, n, base, counts, detail[], fatal }
   - baseline = 마지막으로 맞춘 상태(ksync_files 줄), kList = K 색인 [{ rel, size, mtime(ms), sha }], hList = H 쪽 현재 판 [{ doc, ser, name, url, size, at, date, title, sha }]
     (sha = 첨부에 적힌 sha256 — 동기화 · 문서함 올리기 · 해시 채우기가 적은 것만, 없으면 null)
     + SSI 아닌 연결에서 현재 판이 민감보안정보라 보이지 않는 판 묶음 [{ ser, hidden: true }] — H 에 있으나 내용은 모름(H 삭제로 보지 않음)
   - kErr = 색인 오류 [{ f, r, dir }] — 읽지 못한 파일 · 폴더(그 아래 전부)는 '모름'이라 건너뛴다(K 삭제 · H 로 덮어쓰기로 보지 않음).
     지정 제외 경로도 { f, r: "excluded", dir: true } 로 온다(색인이 걷지 않은 곳 — 같은 '모름', counts.out.excl).
     연결 폴더 자체를 못 읽었거나 kCapped(색인 상한)이면 그 연결은 통째로 건너뛴다(fatal)
   - 삭제는 전파하지 않는다(삭제 대기). 양쪽이 바뀌면 수정 시각이 늦은 쪽이 현재 판, 다른 쪽은 남긴다(H 이전 판 / K '이름 (충돌 날짜)').
   - 변경 · 삭제 대기 수 n 은 서버(ksync_count)와 같은 규칙: 새 판 올리기(판 묶음이 H 에 남은 기준선 줄의 새 문서 포함) · 맞춘 판 묶음 덮어쓰기 · 새 삭제 대기
   - since = 연결의 기준일(한국 시각 그날 0시, ms — 0 이면 없음), allSha = 모든 연결 기준선의 K 해시. 기준선에 없는 K 파일 중 그 전에 고친 것은
     올리지 않고 건수만(counts.old — 기록 줄 · total 에 넣지 않음). 해시가 어느 연결 기준선과 같으면(연결 폴더끼리 옮김) 새 파일로
   - linkAll(서버 flags.link_all) · hOlds = H 옛 판 [{ ser, doc, name, size, url, date }]. 켜면 기준선에 없는 K 파일을 H 현재 판 · 옛 판과
     해시(양쪽에 하나뿐) → 이름 + 크기 → 해시 + 이름 순서로 '연결만' 해 보고, 기준일 전 파일도 먼저 이어 본 뒤 못 이었을 때만 old 로 센다
     (기준일은 '올리지 않음'이지 '잇지 않음'이 아니다). 끄면 현재 판 이름 + 크기만 · 기준일 전은 잇지 않음 */

export const MAX_SIZE = 50 * 1024 * 1024;
export const TRASH = "_H드라이브_휴지통";
export const PREV = "_H드라이브_이전판";
/* H 로 올리지 않는 형식(동기화 전용 — html · js 류는 파일 함수 semis-logi-files BLOCK_TYPES 와 같은 뜻, 더해 인증서 · 키 보관 파일 · 바로 가기) ·
   K 로 쓰지 않는 형식(실행 파일 · 스크립트 · 바로 가기 · 디스크 이미지 ·
   탐색기에서 폴더를 보기만 해도 밖으로 접속하거나 열면 코드가 도는 형식 — 직접 쓴 파일이라 '인터넷에서 받음' 표시가 없다) — SQL 과 같은 목록 */
export const H_BLOCK = /\.(html?|xht(ml)?|m?js|pfx|p12|pem|kdbx|lnk|url)$/i;
export const K_BLOCK = /\.(exe|bat|cmd|com|scr|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|sh|command|app|jar|lnk|url|hta|html?|pif|cpl|reg|dll|scf|library-ms|searchconnector-ms|chm|hlp|msc|iso|img|vhd|vhdx|appref-ms|website|rdp|xll|wll|wsc|sct|ws|application|settingcontent-ms|theme|themepack|diagcab|cab|appx|appxbundle|msix|msixbundle|gadget|inf|ins|isp|mde|accde|jnlp|ps1xml|psc1|psd1|vb|xht|xhtml|svg|mht|mhtml|shtml)$/i;
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
/* 승인한 보류는 승인한 만큼만 — 보류 때 센 수(hold.n, [시작] 승인은 미리보기 건수)를 넘는 몫이 그 자체로 대량 변경(건수 · 비율 한도)이면
   승인 뒤 새로 생긴 대량 변경이라 다시 보류(서버 ksync_count 와 같은 규칙). 건수만 보면 작은 연결은 폴더를 통째로 지워도 지나간다 */
export function holdHit(n, base, lim, hold) {
  if (hold && hold.ok) return limitHit(n - (Number(hold.n) || 0), base, lim);
  return !!hold || limitHit(n, base, lim);
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
  const hidSer = new Set((input.hList || []).filter(it => it && it.hidden).map(it => it.ser));
  const linkAll = !!input.linkAll;
  // 숨은 SSI 판 묶음의 옛 판은 후보가 아니다(서버도 뺌) — SSI 아닌 연결이 SSI 판 묶음에 새 판을 만드는 길을 늘리지 않게
  const hOlds = linkAll ? (input.hOlds || []).filter(o => o && o.url && o.name && o.ser != null && !hidSer.has(o.ser)).map(o => Object.assign({}, o, { old: true })) : [];
  const kBy = new Map(kList.map(k => [k.rel, k]));
  const rowRel = new Set(rows.map(r => r.rel_path));
  const actions = [], detail = [];
  const since = Number(input.since) || 0, allSha = input.allSha || new Set();
  /* out = 범위 밖 이유별 건수(보고 — 형식 · 크기 · 민감보안정보 판 묶음 · 기준일 전 · 지정 제외 경로 · 한 방향 · 쓸 수 없는 이름),
     mismatch = 범위 안인데 이번에 못 맞춘 것(삭제 대기 · 보류된 전송 — 실행 중 못 한 전송은 에이전트가 더함) */
  const counts = { k2h: 0, h2k: 0, link: 0, del: 0, conflict: 0, skip: 0, old: 0, dup: 0, total: 0,
    out: { type: 0, type_block: 0, too_large: 0, ssi: 0, old: 0, excl: 0, dir: 0, name: 0 }, mismatch: 0 };
  const out = counts.out;
  const skipN = (why) => { counts.skip++; if (why in out) out[why]++; };
  let n = 0;
  const line = (f, a, r) => detail.push({ m: map.id, f: String(f || "").slice(0, 200), a, r: r || "" });
  const add = (a) => { actions.push(a); return a; };
  const base = rows.filter(r => r.k_sha256 && r.h_url).length;

  /* 색인 오류 — 빠진 파일을 K 에서 지운 것으로 보면 삭제 대기 · H 로 덮어쓰기가 된다.
     지정 제외({ r: "excluded" })도 같은 '모름'이다(걷지 않았을 뿐 지운 것이 아님) — 관리자가 적은 대소문자가 실제 폴더와 달라도(맥 SMB 는 가리지 않음) 맞춘다 */
  const kErr = (input.kErr || []).filter(e => e && e.f != null);
  const errDirs = kErr.filter(e => e.dir).map(e => nfc(e.f)), errFiles = new Set(kErr.filter(e => !e.dir).map(e => nfc(e.f)));
  const exDirs = [...new Set(kErr.filter(e => e.r === "excluded").map(e => nfc(e.f).toLowerCase()))];
  out.excl = exDirs.length;
  const fatal = input.kCapped ? "too_many" : errDirs.some(d => d === "" || d === ".") ? "read" : "";
  if (fatal) return { actions: [], planned: [], held: false, n: 0, base, counts, detail, fatal };
  const unknown = (rel) => {
    if (errFiles.has(rel) || errDirs.some(d => rel === d || rel.startsWith(d + "/"))) return true;
    const l = nfc(rel).toLowerCase();
    return exDirs.some(d => l === d || l.startsWith(d + "/"));
  };

  /* H 현재 판 ↔ 기준선 — 먼저 같은 주소(문서함에서 판 묶음만 바꿔도 같은 파일), 다음 판 묶음(ser) 안에서 파일 이름,
     남은 것이 하나씩이면 이름이 달라도 같은 문서의 새 판 */
  const pairH = new Map(), usedH = new Set();
  const bySer = (arr, key) => { const m = new Map(); arr.forEach(x => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
  const hSer = bySer(hList, x => x.ser), rSer = bySer(rows.filter(r => r.ser), r => r.ser), hUrl = bySer(hList, x => x.url);
  rows.forEach(r => {
    const its = (hUrl.get(r.h_url) || []).filter(i => !usedH.has(i));
    const it = its.find(i => i.ser === r.ser) || its[0];
    if (it) { pairH.set(r.id, it); usedH.add(it); }
  });
  rSer.forEach((rs, ser) => {
    const its = hSer.get(ser) || [];
    rs.forEach(r => { if (pairH.has(r.id)) return; const it = its.find(i => !usedH.has(i) && i.name === r.h_name); if (it) { pairH.set(r.id, it); usedH.add(it); } });
    const lr = rs.filter(r => !pairH.has(r.id)), li = its.filter(i => !usedH.has(i));
    if (lr.length === 1 && li.length === 1) { pairH.set(lr[0].id, li[0]); usedH.add(li[0]); }
  });
  /* K 이름 바꿈 · 이동 — K 에서 사라진 줄과 같은 해시 · 크기의 새 파일이 하나뿐이면(읽지 못한 경로는 사라진 것이 아님).
     같은 내용 파일이 여럿이면(같은 안내 문서가 여러 폴더에) linkAll 은 이름이 같은 후보를 고르고, 그래도 갈리면 고르지 않고 counts.dup 로 센다 */
  const untrackedK = kList.filter(k => !rowRel.has(k.rel));
  const usedK = new Set();
  const renamed = new Map();
  rows.forEach(r => {
    if (kBy.has(r.rel_path) || !r.k_sha256 || r.state === "trash" || unknown(r.rel_path)) return;
    let c = untrackedK.filter(k => !usedK.has(k) && k.sha === r.k_sha256 && k.size === r.k_size);
    if (c.length > 1 && linkAll) { const nm = c.filter(k => baseOf(k.rel) === baseOf(r.rel_path)); if (nm.length === 1) c = nm; }
    if (c.length > 1) counts.dup++;
    if (c.length === 1) { renamed.set(r.id, c[0]); usedK.add(c[0]); }
  });
  /* 맞춘 판 묶음을 K 에 다시 쓰면 서버도 변경으로 센다 — 실행 시작 때 기준선만(서버 ksync_run_sers 와 같음). 이 실행에서 생긴 줄(여러 첨부 새 문서의 앞 첨부 · 복원해 받은 줄)은 덮어쓰기가 아니다 */
  const overSer = new Set(rows.filter(r => r.k_sha256 && r.state !== "restore").map(r => r.ser));
  /* K 에 쓸 이름 — 맥 SMB 는 대소문자를 가리지 않으므로 소문자로 비교. 폴더 이름 · 읽지 못한 경로도 차지한 것으로 */
  const low = (s) => nfc(s).toLowerCase();
  const taken = new Set();
  const take = (rel) => { for (let s = rel; s; s = dirOf(s)) taken.add(low(s)); };
  kList.forEach(k => take(k.rel)); rows.forEach(r => take(r.rel_path)); kErr.forEach(e => take(nfc(e.f)));
  const freePath = (rel) => {
    if (!taken.has(low(rel))) { taken.add(low(rel)); return rel; }
    for (let i = 2; i < 1000; i++) { const p = join(dirOf(rel), stemOf(rel) + " (" + i + ")" + extOf(rel)); if (!taken.has(low(p))) { taken.add(low(p)); return p; } }
    return null;
  };
  const putOk = (k, rel) => {
    if (k.size > maxSize || !k.sha) return "too_large";
    if (H_BLOCK.test(rel)) return "type";
    return "";
  };
  const getOk = (it) => (K_BLOCK.test(it.name) ? "type_block" : excluded(safeName(it.name), false) ? "name" : "");
  const relinked = new Set();     // 기준선을 고친 줄은 서버에서 상태가 'ok' 로 바뀐다 — 건너뜀 표시를 다시 보낸다
  const skipRow = (r, why, f) => {
    skipN(why); line(f || r.rel_path, "skip", why);
    if (relinked.has(r.id) || r.state !== "skip" || r.note !== why) add({ op: "state", row: r.id, state: "skip", note: why, rel: r.rel_path });
    if (why === "type_block") add({ op: "event", kind: "type_block", f: f || r.rel_path });
  };
  /* 기준선 줄이 있는 '새 문서'인데 그 판 묶음이 H 에 남아 있으면(H 가 이 첨부만 뺌) 서버(put_begin)가 새 판으로 바꿔 센다 — 계획도 같이 세야
     보류 때 센 수(hold.n)가 서버가 셀 몫을 덮는다. 덜 세면 승인한 뒤에도 서버가 다시 보류해 승인 한 번에 한도만큼씩만 지나간다(관리자가 고른 복원은 빼고) */
  const asVersion = (mode, r) => mode === "version" || (mode === "new" && !!r && r.state !== "restore" && (hSer.has(r.ser) || hidSer.has(r.ser)));
  const putA = (k, rel, mode, r, extra) => {
    const why = putOk(k, rel);
    if (why) { if (r && mode !== "old") skipRow(r, why, rel); else { skipN(why); line(rel, "skip", why); } return null; }
    if (asVersion(mode, r)) n++;
    if (mode !== "old") counts.k2h++;
    line(rel, "k2h", mode === "version" ? "새 판" : mode === "old" ? "이전 판" : "새 문서");
    return add(Object.assign({ op: "put", rel, mode, row: r ? r.id : null, k }, extra || {}));
  };
  const getA = (it, rel, r, extra) => {
    const why = getOk(it);
    if (why) { if (r) skipRow(r, why, it.name); else { skipN(why); line(it.name, "skip", why); if (why === "type_block") add({ op: "event", kind: "type_block", f: it.name }); } return null; }
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
    if (!k && unknown(r.rel_path)) return;      // 읽지 못한 파일 · 폴더 — 색인 오류로만 남기고 손대지 않는다
    const rk = renamed.get(r.id);
    const it = pairH.get(r.id);
    /* 같은 주소인데 판 묶음이 바뀜(문서함에서 고침) — 기준선의 문서 · 판 묶음만 고친다. 이어지는 새 판 올리기가 새 판 묶음으로 가도록 먼저 */
    if (it && (k || rk) && r.k_sha256 && r.state !== "trash" && it.url === r.h_url && it.ser !== r.ser) {
      add({ op: "relink", row: r.id, rel: r.rel_path, it, k_size: r.k_size, k_mtime: r.k_mtime, k_sha256: r.k_sha256,
        state: r.state === "conflict" ? "conflict" : "ok", note: r.state === "conflict" ? r.note || "" : "" });
      relinked.add(r.id); counts.link++; line(r.rel_path, "link", "판 묶음 바뀜");
    }
    if (!k && rk) { k = rk; add({ op: "rename", row: r.id, rel: rk.rel, from: r.rel_path, k }); counts.link++; line(rk.rel, "rename", "이름 바꿈 · 이동"); }
    const rel = k ? k.rel : r.rel_path;
    const kCh = !!k && (k.size !== r.k_size || (!!k.sha && k.sha !== r.k_sha256) || (!k.sha && k.size > maxSize));
    const hCh = !!it && it.url !== r.h_url;
    /* H 가 이름을 바꾼 새 판의 K 자리 — 그 이름을 다른 K 파일이 쓰면 '이름 (2)' 로(tdup — 양쪽 전환 미리보기의 dup 으로 셈) */
    let tdup = false;
    const hTarget = () => {
      tdup = false;
      if (it.name === r.h_name) return rel;
      const t = join(dirOf(rel), safeName(it.name));
      if (low(t) === low(rel)) return t;     // 대소문자만 바뀐 이름은 그 파일 자리 그대로
      const f = freePath(t);
      tdup = !!f && f !== t;
      return f || rel;
    };
    const dupX = (x) => (tdup ? Object.assign({ dup: true }, x || {}) : x);
    /* 삭제 확정 뒤 K 에서 고쳤으면 휴지통으로 옮기지 않는다 — H 로 다시 올리고 충돌로 남겨 관리자가 보게 한다(고친 것이 삭제 대기보다 우선).
       H→K 만인 연결은 K 수정을 H 로 보낼 수 없다 — 휴지통에 넣으면 K 수정이 업무 폴더에서 사라지므로 K 파일은 그대로 두고 기준선만 지운다
       (충돌로 남기면 다음 실행이 다시 'H 에서 지움'으로 돌려 확정 · 거절을 되풀이). 옮기기 직전에 색인 값과 다시 대 본다 */
    if (r.state === "trash") {
      if (k && kCh && canK2H) {
        counts.conflict++; line(rel, "conflict", "K 에서 고친 뒤 삭제 확정");
        if (putA(k, rel, "new", r, { state: "conflict" })) add({ op: "state", row: r.id, state: "conflict", note: "K 에서 고친 뒤 삭제 확정", rel });
      } else if (k && kCh) { counts.skip++; line(rel, "skip", "K 에서 고친 뒤 삭제 확정 · K 에 남김"); tail.push({ op: "drop", row: r.id }); }
      else if (k) { tail.push({ op: "trash", row: r.id, rel, k }); line(rel, "trash", "휴지통으로"); }
      else tail.push({ op: "drop", row: r.id });
      return;
    }
    if (r.state === "restore") {
      if (!it && k) { putA(k, rel, "new", r); line(rel, "restore", "H:drive 로 복원"); }
      else if (!k && it) { getA(it, r.rel_path, r); line(r.rel_path, "restore", "K드라이브로 복원"); }
      else if (k && it) add({ op: "state", row: r.id, state: "ok", note: "", rel });
      else tail.push({ op: "drop", row: r.id });
      return;
    }
    const hid = !it && hidSer.has(r.ser);
    /* 삭제 대기 중에 다른 쪽이 고쳤으면 고친 것이 우선 — K 에서 지운 뒤 H 새 판은 K 로 받고, H 에서 지운 뒤 K 수정은 H 로 다시 올린다(대기가 풀림).
       그대로 두면 [삭제 확정]이 상대가 본 적 없는 새 판까지 지운다 */
    if ((r.state === "del_k" && !k && !(hCh && canH2K)) || (r.state === "del_h" && !it && !hid && !(kCh && canK2H))) { counts.del++; line(r.rel_path, r.state, "확인 대기"); return; }
    /* H 판 묶음은 있으나 지금 판이 민감보안정보라 안 보임 — 없는 것으로 보면 'H 에서 지움'이 되고, 확정하면 K 파일이 휴지통으로 간다.
       K 수정만 새 판으로 올리고(서버가 docs-ssi 에 둠), K 에서 지운 것은 판단하지 않는다(H 쪽 판을 모르므로 삭제 대기 · 받기 모두 안 됨) */
    if (hid) {
      if (!k) skipRow(r, "ssi");
      else if (kCh) { if (canK2H) putA(k, rel, "version", r); else skipRow(r, "dir", rel); }
      else if (r.state === "del_k" || r.state === "del_h" || (r.state === "skip" && r.note === "ssi")) add({ op: "state", row: r.id, state: "ok", note: "", rel });
      return;
    }
    if (!k && !it) { tail.push({ op: "drop", row: r.id }); line(r.rel_path, "drop", "양쪽 모두 없음"); return; }
    /* K 에서 지웠는데 H 가 고침 — 고친 것이 우선이라 삭제 대기로 두지 않는다(서버도 [삭제 확정]을 'H 에 새 판'으로 거절하므로 대기 ↔ 충돌을 되풀이).
       K→H 만인 연결은 H 판을 K 로 쓰지 않으므로 건너뜀(dir) */
    if (!k) { if (!hCh) pend(r, "del_k"); else if (canH2K) { const t = hTarget(); getA(it, t, r, dupX()); } else skipRow(r, "dir"); return; }
    if (!it) { if (kCh && canK2H) putA(k, rel, "new", r); else pend(r, "del_h"); return; }
    if (!kCh && !hCh) { if (r.state === "del_k" || r.state === "del_h") add({ op: "state", row: r.id, state: "ok", note: "", rel }); return; }
    if (kCh && !hCh) { if (canK2H) putA(k, rel, "version", r); else skipRow(r, "dir", rel); return; }
    if (!kCh && hCh) { if (canH2K) { const t = hTarget(); getA(it, t, r, dupX({ backup: rel, k })); } else skipRow(r, "dir", rel); return; }
    /* 양쪽 다 바뀜 */
    counts.conflict++;
    const kWins = map.dir === "k2h" ? true : map.dir === "h2k" ? false : k.mtime >= hTime(it);
    line(rel, "conflict", kWins ? "K 쪽이 늦게 고침" : "H:drive 쪽이 늦게 고침");
    if (kWins) {
      const cb = join(dirOf(rel), safeName(it.name));     // 사본 이름의 바탕 — 같은 날 두 번째면 실행 때 '(충돌 날짜 2)'
      // h_url = 계획이 본 H 판 — 등록 전에 H 가 또 새 판을 만들면 서버가 등록하지 않는다(덮으면 그 판은 K 사본도 충돌 표시도 없이 이전 판으로 밀림)
      if (putA(k, rel, "version", r, { state: "conflict", h_url: it.url }) && canH2K) getA(it, conflictName(cb, today, 1), null, { copy: true, ser: it.ser, base: cb });
    } else {
      const why = getOk(it);
      if (why) { skipRow(r, why, it.name); return; }
      const cf = conflictName(rel, today, 1);
      add({ op: "kconf", row: r.id, rel, to: cf, k });
      const t = hTarget();
      if (getA(it, t, r, dupX({ state: "conflict" })) && canK2H) putA(Object.assign({}, k, { rel: cf }), cf, "old", r);
    }
  });

  /* K 에만 있는 파일 — 같은 H 문서가 있으면 '연결만'(전송 없이 기준선만). 모든 K 파일을 현재 판과 먼저 잇고(1차), 남은 것만 옛 판(linkAll — 2차):
     한 번에 돌면 옛 판의 K 사본이 파일 순서에 따라 현재 판의 K 사본보다 먼저 그 판 묶음을 차지한다(현재 판 사본이 새 문서로 중복 · 다음 실행이 옛 사본을 덮음).
     옛 판은 기준선 줄이 없는 판 묶음에서 회차마다 하나만(같은 판 묶음의 옛 판 여럿에 이으면 다음 실행이 하나 빼고 'H 에서 지움'으로 본다),
     그 판 묶음의 현재 판에 보이는 첨부가 하나뿐이거나 같은 이름 첨부가 있을 때만(아니면 다음 실행이 그 줄을 현재 판과 짝짓지 못해 'H 에서 지움'이 되고
     현재 판 첨부를 모두 새로 받는다) */
  const rSerAll = new Set(rows.map(r => r.ser).filter(s => s != null)), linkedSer = new Set();
  const kShaN = new Map();
  untrackedK.forEach(k => { if (k.sha) kShaN.set(k.sha, (kShaN.get(k.sha) || 0) + 1); });
  // 이름은 다음 실행의 짝짓기(판 묶음 안 h_name)와 같은 비교 — 글자 그대로(NFC · NFD 가 다르면 그 실행도 짝을 못 짓는다)
  const pairable = (o) => { const c = hList.filter(i => i.ser === o.ser); return c.length === 1 || c.some(i => i.name === o.name); };
  const linkIn = (k, cands) => {
    const nm = baseOf(k.rel), same = (i) => nfc(i.name) === nm && Number(i.size) === k.size;
    if (!linkAll) return cands.find(same);
    // H 첨부의 해시는 해시를 채운 문서에만 있다(sha) — 없으면 이름 + 크기만
    const bySha = (f) => { const c = k.sha ? cands.filter(i => i.sha === k.sha && f(i)) : []; return c.length === 1 ? c[0] : null; };
    return (kShaN.get(k.sha) === 1 && bySha(() => true)) || cands.find(same) || bySha(i => nfc(i.name) === nm);
  };
  const linkK = (k, it) => {
    usedH.add(it); counts.link++;
    // 옛 판에 이으면 그 판 묶음의 현재 판은 이번에 받지 않는다 — 다음 실행이 'H 가 더 새로움'으로 맞춘다(받으면 K 에 '이름 (2)' 가 생김)
    if (it.old) hList.forEach(i => { if (i.ser === it.ser) usedH.add(i); });
    if (linkAll) linkedSer.add(it.ser);
    // 옛 판에 이으면 다음 회차가 현재 판을 그 K 파일 자리에 받는다 — 현재 판 이름(첨부 하나)을 다른 K 파일이 쓰면 그때 '이름 (2)'(dup 으로 미리 셈)
    const cur = it.old ? hList.filter(i => i.ser === it.ser) : [];
    const ct = cur.length === 1 && cur[0].name !== it.name ? join(dirOf(k.rel), safeName(cur[0].name)) : "";
    const dup = !!ct && low(ct) !== low(k.rel) && taken.has(low(ct));
    line(k.rel, "link", it.old ? "옛 판과 같은 파일" : "같은 파일"); add(Object.assign({ op: "link", rel: k.rel, k, it }, dup ? { dup: true } : {}));
  };
  const rest = [];
  untrackedK.forEach(k => {
    if (usedK.has(k)) return;
    // 기준일 전 파일 — 건수만(줄을 남기면 수백 줄이 실행 기록의 오류 줄을 밀어낸다). 올리지 않을 뿐 — linkAll 이면 먼저 이어 본다
    const old = since && k.mtime < since && !(k.sha && allSha.has(k.sha));
    if (old && !linkAll) { counts.old++; return; }
    const it = !linkAll || k.sha ? linkIn(k, hList.filter(i => !usedH.has(i))) : null;      // 기준선 표시(mark set)는 K 해시가 있어야 받는다
    if (it) linkK(k, it); else rest.push([k, old]);
  });
  rest.forEach(([k, old]) => {
    // 현재 판 첨부를 이번에 다른 줄이 이미 가져간 판 묶음도 아님(다른 판 묶음의 기준선 줄이 주소로 짝지어짐 — 문서함에서 판 묶음을 옮김 등):
    // 다음 실행에 그 판 묶음 줄이 둘이 되어 하나가 'H 에서 지움'이 된다
    const it = linkAll && k.sha ? linkIn(k, hOlds.filter(o => !rSerAll.has(o.ser) && !linkedSer.has(o.ser) && !hList.some(i => i.ser === o.ser && usedH.has(i)) && pairable(o))) : null;
    if (it) linkK(k, it);
    else if (old) counts.old++;
    else if (canK2H) putA(k, k.rel, "new", null); else out.dir++;
  });
  /* H 에만 있는 문서 */
  hList.forEach(it => {
    if (usedH.has(it)) return;
    if (!canH2K) { out.dir++; return; }
    const why = getOk(it);
    if (why) { skipN(why); line(it.name, "skip", why); if (why === "type_block") add({ op: "event", kind: "type_block", f: it.name }); return; }
    const rel = freePath(safeName(it.name));
    if (!rel) { skipN("name"); line(it.name, "skip", "name"); return; }
    getA(it, rel, null, rel !== safeName(it.name) ? { dup: true } : null);
  });
  tail.forEach(a => actions.push(a));

  const held = holdHit(n, base, input.limit, map.hold);
  counts.total = counts.k2h + counts.h2k + counts.link + counts.del + counts.conflict + counts.skip;
  out.old = counts.old; out.ssi = hidSer.size;
  counts.mismatch = counts.del + (held ? counts.k2h + counts.h2k : 0);
  return { actions: held ? [] : actions, planned: actions, held, n, base, counts, detail, fatal: "" };
}

/* '양쪽' 전환 미리보기(recon) — 같은 입력으로 바꿀 방향의 plan() 을 돈 결과를 센다(K 에 쓰지 않음). 서버(ksync_recon_set)가 받는 칸:
   h2k_new = 내려올 새 파일(H 에만 있는 문서), dup = K 에 '이름 (2)' 가 생길 것 — H 에만 있는 문서 · 이름을 바꾼 H 새 판의 이름을 다른 K 파일이 씀,
   옛 판에 이은 줄의 현재 판 이름을 다른 K 파일이 씀(다음 회차). 0 이 아니면 전환을 막는다(H 옛 판 · 잘못 묶인 판 묶음이나 잇지 못한 기준일 전 K 파일).
   link_old = 옛 판으로 연결, bytes = 올릴 파일 크기 합계(저장소 증가 상한) */
export function reconOf(p) {
  const acts = p.planned || [], c = p.counts || {};
  const fresh = acts.filter(a => a.op === "get" && !a.row && !a.copy);
  return { k2h: c.k2h || 0, h2k: c.h2k || 0, h2k_new: fresh.length, dup: acts.filter(a => a.dup).length,
    link: c.link || 0, link_old: acts.filter(a => a.op === "link" && a.it && a.it.old).length, del: c.del || 0, conflict: c.conflict || 0,
    skip: c.skip || 0, total: c.total || 0, n: p.n || 0, bytes: acts.filter(a => a.op === "put").reduce((s, a) => s + (Number(a.k && a.k.size) || 0), 0) };
}
