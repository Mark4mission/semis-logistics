/* K드라이브 찾기 — K 색인 목록(이름 · 폴더 · 크기 · 날짜만)을 처음 필요할 때 받아 메모리에만 두고, 검색 프로바이더와 K 위치 창을 낸다.
   같이 쓰는 PC 라 K 이름은 localStorage · sessionStorage 에 남기지 않는다. 서버: RPC semis_logi_kidx_list(세션 등급 3 이상이 아니면 42501)
   → { on, at, win_root, dirs: ["" (뿌리), "a", "a/b", …], files: [[dirIndex, 이름, 크기, "YYYY-MM-DD", H 문서 id|null], …] } */
"use strict";

(() => {
  const { $, esc, toast, openModal, closeModal, icon } = SeMIS;
  const FRESH = 30 * 60e3, RETRY = 5 * 60e3;
  const ROOT_NAME = "항공보안";     // win_root 가 비었을 때 보여 줄 공유 폴더 이름
  let list = [], byKey = new Map(), meta = { at: "", root: "" };
  let isOn = false, got = 0, failAt = 0, pending = null;
  const subs = [];

  /* 브라우저 탭마다 다시 받아도 같은 파일은 같은 id — 아르고 답 속 k/<id> 단추가 목록을 다시 받은 뒤에도 같은 파일을 가리키게. 경로는 소문자로(K 는 대소문자를 가리지 않음) */
  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const segs = (p) => (p ? p.split("/") : []);
  const pad = (n) => String(n).padStart(2, "0");
  const fmtAt = (t) => { const d = new Date(t); return !t || isNaN(d) ? "-" : d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round((n || 0) / 1024)) + "KB");

  function canUse() {
    const u = SeMIS.user;
    return !!u && u.role !== "vendor" && u.role !== "signer" && SeMIS.roleRank() >= 3 && !!(window.SemisSync && SemisSync.rpc);
  }

  /* 찾는 글(text)은 받을 때 한 번 만든다 — 검색은 입력마다 수천 항목을 훑는다 */
  function mk(kind, path, x) {
    const parts = segs(path), title = parts.pop(), dir = parts.join("/");
    const it = { id: cyrb53(path.toLowerCase()).toString(36), kind, title,
      sub: [parts.join(" › "), kind === "file" ? x.date : "파일 " + x.n + "개"].filter(Boolean).join(" · "),
      text: [title].concat(parts).join(" ").toLowerCase(), route: "", path, dir,
      date: kind === "file" ? x.date : "", size: kind === "file" ? x.size : null, docId: x.docId || null, group: "K드라이브" };
    it.pick = (q) => openSheet(it, q);
    return it;
  }
  function load(d) {
    isOn = d.on === true;
    meta = { at: isOn ? String(d.at || "") : "", root: isOn ? String(d.win_root || "") : "" };
    const dirs = isOn && Array.isArray(d.dirs) ? d.dirs.map(String) : [];
    const files = isOn && Array.isArray(d.files) ? d.files : [];
    const n = dirs.map(() => 0);
    files.forEach(f => { n[f[0]]++; });
    const out = [];
    dirs.forEach((p, i) => { if (i && p) out.push(mk("folder", p, { n: n[i] })); });
    files.forEach(f => { const dir = dirs[f[0]], name = String(f[1]);
      out.push(mk("file", dir ? dir + "/" + name : name, { size: Number(f[2]) || 0, date: String(f[3] || ""), docId: f[4] ? String(f[4]) : null })); });
    list = out;
    byKey = new Map(out.map(it => [it.id, it]));
  }
  function clear() { list = []; byKey = new Map(); meta = { at: "", root: "" }; isOn = false; got = 0; }

  /* 실패(네트워크 · 500 · 42501)는 알리지 않고 목록을 버린다 — 권한이 바뀌었을 수도 있어서. 5분 동안 다시 부르지 않는다 */
  function ensure() {
    if (pending) return pending;
    if (!canUse()) return Promise.resolve(false);
    const now = Date.now();
    if (got && now - got < FRESH) return Promise.resolve(isOn);
    if (failAt && now - failAt < RETRY) return Promise.resolve(false);
    pending = SemisSync.rpc("semis_logi_kidx_list", {})
      .then(d => { if (!d || d.ok !== true) throw new Error("kidx"); load(d); got = Date.now(); failAt = 0; return isOn; })
      .catch(() => { clear(); failAt = Date.now(); return false; })
      .then(v => { pending = null; subs.forEach(fn => { try { fn(); } catch (e) { /* 다른 구독자는 계속 */ } }); return v; });
    return pending;
  }

  function winPath(it) {
    if (!it || !meta.root) return "";
    const p = it.kind === "file" ? it.dir : it.path;
    const base = meta.root.replace(/\\+$/, "");
    return p ? base + "\\" + segs(p).join("\\") : base;
  }
  const hDoc = (id) => {
    const d = id ? (SeMIS.data.docs || []).find(x => x && x.id === id) : null;
    return d && window.SemisDocs && SemisDocs.visible(d) ? d : null;
  };

  /* 브라우저는 K(SMB) 파일을 직접 열지 못한다(file:// 막힘) — 폴더 위치를 복사해 탐색기 주소창에 붙여 넣게 한다 */
  function openSheet(it, q) {
    if (!it) return;
    const wp = winPath(it), doc = hDoc(it.docId);
    const loc = wp ? `<span class="mono">${esc(wp)}</span>`
      : `${esc([ROOT_NAME].concat(segs(it.kind === "file" ? it.dir : it.path)).join(" › "))}<div class="form-hint">관리자가 경로 앞부분을 아직 넣지 않았습니다</div>`;
    openModal(`<h3>${esc(it.title)}</h3>
      <dl class="pn-dl">
        <div><dt>위치</dt><dd>${loc}</dd></div>
        ${it.kind === "file" ? `<div><dt>날짜</dt><dd class="mono">${esc(it.date || "-")}</dd></div><div><dt>크기</dt><dd class="mono">${esc(fmtSize(it.size))}</dd></div>` : ""}
        <div><dt>K 에서 확인</dt><dd class="mono">${esc(fmtAt(meta.at))}</dd></div>
      </dl>
      ${wp ? `<p class="form-hint">탐색기 주소창에 붙여 넣고(Ctrl+V) Enter</p>
      <div class="form-row" id="kx-pathrow" hidden><label for="kx-path">폴더 위치</label><input id="kx-path" class="mono" readonly value="${esc(wp)}"></div>` : ""}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">닫기</button>
        ${doc ? `<button type="button" class="btn btn-ghost" data-act="open">${icon("external", 15)}<span>H:drive 에서 바로 열기</span></button>` : ""}
        ${wp ? `<button type="button" class="btn btn-primary" data-act="copy">${icon("copy", 15)}<span>폴더 위치 복사</span></button>` : ""}
      </div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const cp = $("#modal-box [data-act=copy]");
    if (cp) cp.onclick = () => {
      const manual = () => { const row = $("#kx-pathrow"), inp = $("#kx-path"); if (!row || !inp) return; row.hidden = false; inp.focus(); inp.select(); };
      const c = navigator.clipboard;
      if (!c || !c.writeText) { manual(); return; }
      c.writeText(wp).then(() => toast("폴더 위치를 복사했습니다."), manual);
    };
    const op = $("#modal-box [data-act=open]");
    /* q 는 K 항목(폴더 이름까지)에 맞은 말이라 문서 자체에 없을 수 있다 — 그대로 넘기면 문서함이 그 문서를 걸러 낸다 */
    if (op) op.onclick = () => { closeModal(); SemisDocs.pickTo(doc.mod, q && SemisDocs.hits(doc, q) ? q : doc.title); SeMIS.navigate(doc.mod); };
  }

  window.SemisKidx = {
    canUse, ensure,
    ready: () => got > 0, on: () => isOn, loading: () => !!pending,
    items: () => list, byId: (id) => byKey.get(String(id)) || null,
    winPath, openSheet,
    onReady: (fn) => { if (typeof fn === "function") subs.push(fn); }
  };

  /* 이 파일은 search.js 보다 먼저 읽힌다 → search.js 가 읽힐 때 대기열(__semisSearchQ)을 등록한다 */
  const searchProvider = {
    id: "kdrive", group: "K드라이브", ico: "folder", minRank: 3,
    items: () => (SemisKidx.canUse() && SemisKidx.ready() ? SemisKidx.items() : [])
  };
  if (window.SemisSearch) SemisSearch.register(searchProvider);
  else (window.__semisSearchQ = window.__semisSearchQ || []).push(searchProvider);
})();
