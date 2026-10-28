/* 게시판 — 공지사항 · 일반게시판 · 자료실 등. 글 · 댓글 · 열람 기록은 서버 비공개 표(RPC semis_logi_bbs_*)에서 쪽 단위로 받고,
   게시판 정의(ID · 이름 · 권한 · 기능 토글)는 공용 행 boards(시스템관리자). 주소 #/board/<게시판 ID>[/<글 id>].
   글쓰기 · 고치기는 모달 — 다른 사람의 변경으로 화면을 다시 그려도 쓰던 글이 남는다 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const RANK = SeMIS.BBS_RANK;
  const LV = { all: "전체 사용자", mgr: "화물팀 관리자 이상", hq: "안전보안파트 이상", admin: "시스템관리자" };
  const LV_SHORT = { all: "전체", mgr: "관리자", hq: "파트", admin: "시스템" };
  const OPT = {
    pin: ["상단 고정", "중요한 글을 목록 맨 위에 둡니다(안전보안파트 이상)."],
    attach: ["파일 첨부", "글마다 파일을 30개까지(파일당 50MB)."],
    editor: ["서식 편집기", "굵게 · 목록 · 표 · 이미지 붙여넣기."],
    views: ["조회수", "목록 · 본문에 조회수를 보입니다(계정당 한 번)."],
    readers: ["열람 확인", "읽은 사람 · 안 읽은 사람 명단(안전보안파트 · 작성자만)."],
    comment: ["댓글", ""],
    reply: ["답글", "글 아래에 답글(3단계까지)."],
    cat: ["분류(말머리)", "분류 목록에서 고르고 목록을 분류로 거릅니다."],
    dash: ["대시보드 표시", "대시보드 공지 칸에 최근 글을 보입니다."]
  };
  const VIEW = { list: "목록형", file: "자료형", gallery: "사진형" };
  const FILE_MAX = 50 * 1024 * 1024;
  const FILES_MAX = 30;
  const CACHE_MS = 30000;

  const rank = () => SeMIS.roleRank();
  const isAdmin = () => SeMIS.isAdmin();
  const internal = () => !!SeMIS.user && SeMIS.user.role !== "vendor" && SeMIS.user.role !== "signer";
  const boards = () => (Array.isArray(D().boards) ? D().boards : []);
  const bdef = (id) => SeMIS.boardDef(id);
  const canRead = (b) => SeMIS.canReadBoard(b);
  const canWrite = (b) => !!b && canRead(b) && rank() >= (RANK[b.write] || 3);
  const manage = () => rank() >= 3;
  const folder = (b) => "bbs" + (RANK[b.read] || 3);
  const pad = (n) => String(n).padStart(2, "0");
  function rpc(name, args) {
    if (!window.SemisSync || !SemisSync.rpc) return Promise.reject(new Error("offline"));
    return SemisSync.rpc(name, args);
  }
  const ERR = { auth: "접속이 만료되었습니다. 다시 로그인해 주세요.", forbidden: "권한이 없습니다.", nf: "글을 찾을 수 없습니다(지워졌거나 옮겨졌습니다).",
    title: "제목을 입력하세요.", body: "내용을 입력하세요.", rate: "잠시 뒤 다시 시도하세요(1분에 10건까지).", replies: "다른 사람의 답글이 달린 글은 안전보안파트만 지울 수 있습니다.",
    reply: "이 글에는 답글을 달 수 없습니다.", off: "이 게시판은 댓글을 쓰지 않습니다.", confirm: "확인이 필요합니다." };
  const errMsg = (d) => ERR[(d && d.error) || ""] || "처리하지 못했습니다" + (d && d.error ? " (" + d.error + ")" : " — 네트워크를 확인하세요.");
  const menuOf = (b) => SeMIS.menuForBoard(b.id);
  const label = (b) => { const m = menuOf(b); return (m && m.label) || b.name; };
  const nowRoute = () => String(location.hash || "").replace(/^#\//, "");

  function fmt(iso, full) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const ymd = String(d.getFullYear()).slice(2) + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate());
    const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (full) return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) + " " + hm;
    const t = new Date();
    return d.toDateString() === t.toDateString() ? hm : ymd;
  }
  function size(n) {
    n = Number(n) || 0;
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  const noOf = (b, n) => b + "-" + String(n).padStart(4, "0");

  /* ── 캐시 — 같은 화면을 다시 그릴 때(원격 변경 · 폭 전환) 서버를 또 부르지 않게. 게시판 변경 알림 · 내 쓰기에서 세대 증가 ── */
  const gen = {};
  const listCache = {}, postCache = {};
  const bump = (b) => { gen[b] = (gen[b] || 0) + 1; recent.at = 0; };
  const fresh = (c, b) => c && c.gen === (gen[b] || 0) && Date.now() - c.at < CACHE_MS;

  /* ── 목록 상태(게시판별) — 글을 읽고 돌아와도 쪽 · 검색이 남는다 ── */
  const st = {};
  const S = (id) => st[id] || (st[id] = { page: 1, size: 0, q: "", qd: "", f: "all", cat: "", sel: new Set() });
  const drafts = {};   // 댓글 쓰던 글(글 id → 내용)

  /* ── 메뉴 배지 · 통합 검색 색인 ── */
  let stats = { boards: {}, index: [], at: 0 }, statsBusy = null;
  function refreshStats(force) {
    if (!internal() || !window.SemisSync || !(SemisSync.auth && SemisSync.auth.token && SemisSync.auth.token())) return Promise.resolve(false);
    if (statsBusy) return statsBusy;
    if (!force && Date.now() - stats.at < 60000) return Promise.resolve(false);
    statsBusy = rpc("semis_logi_bbs_stats", {}).then(d => {
      if (!d || !d.ok) return false;
      const before = JSON.stringify(stats.boards);
      stats = { boards: d.boards || {}, index: Array.isArray(d.index) ? d.index : [], at: Date.now() };
      if (JSON.stringify(stats.boards) !== before) { try { SeMIS.renderNav(); } catch (e) { /* 메뉴 없음 */ } }
      return true;
    }).catch(() => false).finally(() => { statsBusy = null; });
    return statsBusy;
  }
  function navBadge(id) {
    const s = stats.boards[id];
    return s && s.unread > 0 ? String(s.unread) : "";
  }

  /* ── 대시보드 · 아르고 — 최근 글(대시보드 표시 켠 게시판) ── */
  const recent = { rows: [], boards: [], at: 0, busy: null };
  function loadRecent(force) {
    if (!internal()) return Promise.resolve(recent);
    if (!force && recent.at && Date.now() - recent.at < 60000) return Promise.resolve(recent);
    if (recent.busy) return recent.busy;
    recent.busy = rpc("semis_logi_bbs_recent", { p: { n: 6 } }).then(d => {
      if (d && d.ok) { recent.rows = d.rows || []; recent.boards = d.boards || []; recent.at = Date.now(); }
      return recent;
    }).catch(() => recent).finally(() => { recent.busy = null; });
    return recent.busy;
  }

  /* ── 목록 ── */
  function render(view, rest) {
    const parts = String(rest || "").split("/");
    const b = bdef(parts[0]);
    if (!b) return;
    if (/^\d{1,15}$/.test(parts[1] || "")) renderPost(view, b, Number(parts[1]));
    else renderList(view, b);
    refreshStats(false);
  }

  function headActions(b) {
    return (canWrite(b) ? `<button type="button" class="btn btn-primary" id="bb-write">${icon("edit", 16)}<span>글쓰기</span></button>` : "") +
      (isAdmin() ? `<button type="button" class="btn btn-ghost btn-sm ph-rare" id="bb-cfg">${icon("sliders", 16)}<span>게시판 설정</span></button>` : "");
  }
  function wireHead(view, b) {
    const w = $("#bb-write", view); if (w) w.onclick = () => write(b.id);
    const c = $("#bb-cfg", view); if (c) c.onclick = () => boardForm(b.id);
  }

  function renderList(view, b) {
    const s = S(b.id);
    if (!s.size) s.size = b.perPage;
    const cats = b.opt.cat ? b.cats : [];
    view.innerHTML = ui.head({ title: label(b), meta: b.id, actions: headActions(b), desc: b.desc }) +
      `<section class="card bb-card" aria-label="${esc(label(b))} 목록">
        <div class="bb-bar">
          ${cats.length ? `<div class="bb-cats" role="group" aria-label="분류">${[""].concat(cats).map(c =>
            `<button type="button" class="bb-cat-b" data-bcat="${esc(c)}" aria-pressed="${s.cat === c}">${esc(c || "전체")}</button>`).join("")}</div>` : ""}
          <form class="bb-search" id="bb-sf" role="search" aria-label="${esc(label(b))} 검색">
            <select id="bb-f" aria-label="검색 범위">${[["all", "제목 + 내용"], ["title", "제목"], ["body", "내용"], ["author", "작성자"]].map(([v, l]) =>
              `<option value="${v}"${s.f === v ? " selected" : ""}>${l}</option>`).join("")}</select>
            ${ui.search("bb-q", "검색어", s.qd || s.q)}
            <button type="submit" class="btn btn-ghost btn-sm">검색</button>
          </form>
        </div>
        <div id="bb-body" class="bb-body"></div>
      </section>`;
    wireHead(view, b);
    const sf = $("#bb-sf", view), qi = $("#bb-q", view);
    if (qi) qi.oninput = () => { s.qd = qi.value; };
    sf.onsubmit = (ev) => {
      ev.preventDefault();
      s.q = ui.searchValue(qi.value); s.qd = s.q; s.f = $("#bb-f", view).value; s.page = 1; s.sel.clear();
      loadList(view, b);
    };
    $$("[data-bcat]", view).forEach(x => x.onclick = () => {
      s.cat = x.dataset.bcat; s.page = 1; s.sel.clear();
      $$("[data-bcat]", view).forEach(y => y.setAttribute("aria-pressed", String(y === x)));
      loadList(view, b);
    });
    loadList(view, b);
  }

  function loadList(view, b) {
    const s = S(b.id);
    const key = [b.id, s.page, s.size, s.q, s.f, s.cat].join("|");
    const box = $("#bb-body", view);
    if (!box) return;
    const c = listCache[key];
    if (fresh(c, b.id)) { paintList(view, b, c.d); return; }
    if (!box.innerHTML) box.innerHTML = `<div class="bb-wait" role="status">${icon("refresh", 16)}<span>불러오는 중…</span></div>`;
    box.setAttribute("aria-busy", "true");
    const route = nowRoute(), g = gen[b.id] || 0;
    rpc("semis_logi_bbs_list", { p: { b: b.id, page: s.page, size: s.size, q: s.q, f: s.f, cat: s.cat } }).then(d => {
      if (!d || !d.ok) throw Object.assign(new Error("bbs"), { d });
      listCache[key] = { d, at: Date.now(), gen: g };
      if (nowRoute() === route && view.isConnected && $("#bb-body", view)) paintList(view, b, d);
    }).catch(e => {
      if (nowRoute() !== route || !$("#bb-body", view)) return;
      const bx = $("#bb-body", view);
      bx.removeAttribute("aria-busy");
      bx.innerHTML = `<div class="bb-err" role="alert"><span>${esc(errMsg(e && e.d))}</span><button type="button" class="btn btn-ghost btn-sm" data-bb-retry>다시 시도</button></div>`;
      const r = $("[data-bb-retry]", bx); if (r) r.onclick = () => loadList(view, b);
    });
  }

  const newMark = (r) => (r.fresh ? '<span class="bb-n" role="img" title="새 글" aria-label="새 글">N</span>' : "");
  const marks = (b, r) => (r.nf && b.opt.attach ? `<span class="bb-ic" role="img" title="첨부 ${r.nf}" aria-label="첨부 ${r.nf}개">${icon("clip", 14)}</span>` : "") +
    (r.nc ? `<span class="bb-nc" title="댓글 ${r.nc}"><span class="sr-only">댓글 </span>[${r.nc}]</span>` : "") + newMark(r);
  const href = (b, r) => "#/board/" + esc(b.id) + "/" + esc(r.id);
  function titleCell(b, r, pin) {
    const ind = r.depth ? ` style="--bb-ind:${Math.min(3, r.depth)}"` : "";
    return `<div class="bb-tw${r.depth ? " is-re" : ""}"${ind}>${r.depth ? `<span class="bb-re" aria-label="답글">${icon("reply", 14)}</span>` : ""}` +
      `${pin ? '<span class="badge badge-red bb-pin">공지</span>' : ""}<a class="bb-t" href="${href(b, r)}">${esc(r.title)}</a>${marks(b, r)}</div>`;
  }
  function fileCell(r) {
    const f = r.f1;
    if (!f || !f.url) return '<span class="cell-sub">-</span>';
    return `<div class="bb-fw"><a class="bb-f" href="${esc(f.url)}" target="_blank" rel="noopener" download="${esc(f.name || "")}" title="${esc(f.name || "")}">${icon("down", 14)}<span>${esc(f.name || "첨부")}</span></a>` +
      (r.nf > 1 ? `<span class="cell-sub">외 ${r.nf - 1}</span>` : "") + (f.size ? `<span class="cell-sub mono">${esc(size(f.size))}</span>` : "") + `</div>`;
  }

  function rowHTML(b, r, mng, pin) {
    const cls = ["bb-row", pin ? "is-pin" : "", !r.read ? "is-unread" : ""].filter(Boolean).join(" ");
    return `<tr class="${cls}" data-bid="${esc(r.id)}">` +
      (mng ? `<td class="bb-ck">${pin ? "" : `<input type="checkbox" data-bsel="${esc(r.id)}" aria-label="${esc(r.title)} 선택"${S(b.id).sel.has(String(r.id)) ? " checked" : ""}>`}</td>` : "") +
      `<td class="bb-no mono">${pin ? icon("pin", 14) : r.depth ? "" : esc(r.no)}</td>` +
      (b.opt.cat ? `<td class="bb-catc">${r.cat ? esc(r.cat) : ""}</td>` : "") +
      `<td class="bb-tc" data-role="title">${titleCell(b, r, pin)}</td>` +
      (b.view === "file" ? `<td class="bb-fc">${fileCell(r)}</td>` : "") +
      `<td class="bb-by">${esc(r.by)}</td><td class="bb-at mono">${esc(fmt(r.at))}</td>` +
      (b.opt.views ? `<td class="bb-v mono">${esc(r.views)}</td>` : "") + `</tr>`;
  }
  function mobileHTML(b, rows, pins) {
    const item = (r, pin) => `<a class="bb-mi${pin ? " is-pin" : ""}${!r.read ? " is-unread" : ""}${r.depth ? " is-re" : ""}" href="${href(b, r)}">
        <span class="bb-mt">${pin ? '<span class="badge badge-red bb-pin">공지</span>' : ""}${r.depth ? `<span class="bb-re">${icon("reply", 13)}</span>` : ""}${b.opt.cat && r.cat ? `<span class="bb-mcat">${esc(r.cat)}</span>` : ""}<span class="bb-mtt">${esc(r.title)}</span>${marks(b, r)}</span>
        <span class="bb-ms">${esc(r.by)} · <span class="mono">${esc(fmt(r.at))}</span>${b.opt.views ? ` · 조회 <span class="mono">${esc(r.views)}</span>` : ""}</span></a>`;
    return `<div class="bb-mlist">${pins.map(r => item(r, true)).join("")}${rows.map(r => item(r, false)).join("")}</div>`;
  }
  function galleryHTML(b, rows, pins) {
    const card = (r, pin) => `<a class="bb-gi${!r.read ? " is-unread" : ""}" href="${href(b, r)}">
        <span class="bb-gimg">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" decoding="async">` : icon("image", 28)}</span>
        <span class="bb-gt">${pin ? '<span class="badge badge-red bb-pin">공지</span>' : ""}<span class="bb-gtt">${esc(r.title)}</span>${marks(b, r)}</span>
        <span class="bb-ms">${esc(r.by)} · <span class="mono">${esc(fmt(r.at))}</span></span></a>`;
    return `<div class="bb-grid">${pins.map(r => card(r, true)).join("")}${rows.filter(r => !r.depth).map(r => card(r, false)).join("")}</div>`;
  }
  function pagerHTML(total, page, sz) {
    const last = Math.max(1, Math.ceil(total / sz));
    if (last <= 1) return "";
    const b0 = Math.floor((page - 1) / 10) * 10 + 1, b1 = Math.min(last, b0 + 9);
    const btn = (p, lbl, aria, dis, cur) => `<button type="button" class="bb-pg${cur ? " on" : ""}" data-bpg="${p}"${dis ? " disabled" : ""}${cur ? ' aria-current="page"' : ""} aria-label="${esc(aria)}">${lbl}</button>`;
    let h = btn(1, "«", "첫 쪽", page === 1) + btn(Math.max(1, b0 - 1), "‹", "앞 10쪽", b0 === 1);
    for (let p = b0; p <= b1; p++) h += btn(p, String(p), p + " 쪽", false, p === page);
    h += btn(Math.min(last, b1 + 1), "›", "다음 10쪽", b1 === last) + btn(last, "»", "끝 쪽", page === last);
    return `<nav class="bb-pager" aria-label="쪽 이동">${h}<span class="bb-pgi mono">${page} / ${last}</span></nav>`;
  }

  function paintList(view, b, d) {
    const s = S(b.id), box = $("#bb-body", view);
    if (!box) return;
    box.removeAttribute("aria-busy");
    s.page = d.page;
    const rows = d.rows || [], pins = d.pins || [];
    const mng = manage() && !SeMIS.isMobile();
    const searching = !!(s.q || s.cat);
    const cols = (mng ? 1 : 0) + 4 + (b.opt.cat ? 1 : 0) + (b.view === "file" ? 1 : 0) + (b.opt.views ? 1 : 0);
    let body;
    if (!rows.length && !pins.length) body = ui.empty(searching ? "조건에 맞는 글이 없습니다." : "등록된 글이 없습니다.",
      !searching && canWrite(b) ? '<button type="button" class="btn btn-soft btn-sm" data-bb-first>첫 글 쓰기</button>' : "");
    else if (b.view === "gallery") body = galleryHTML(b, rows, pins);
    else if (SeMIS.isMobile()) body = mobileHTML(b, rows, pins);
    else body = `<div class="table-wrap"><table class="tbl bb-tbl tbl-keep" data-no-stack>
        <colgroup>${mng ? '<col class="c-ck">' : ""}<col class="c-no">${b.opt.cat ? '<col class="c-cat">' : ""}<col>${b.view === "file" ? '<col class="c-file">' : ""}<col class="c-by"><col class="c-at">${b.opt.views ? '<col class="c-v">' : ""}</colgroup>
        <thead><tr>${mng ? `<th class="bb-ck"><input type="checkbox" id="bb-all" aria-label="이 쪽 모두 선택"></th>` : ""}<th class="bb-no">번호</th>${b.opt.cat ? "<th>분류</th>" : ""}<th>제목</th>${b.view === "file" ? "<th>첨부</th>" : ""}<th>작성자</th><th class="bb-at">작성일</th>${b.opt.views ? '<th class="bb-v">조회</th>' : ""}</tr></thead>
        <tbody>${pins.map(r => rowHTML(b, r, mng, true)).join("")}${rows.map(r => rowHTML(b, r, mng, false)).join("")}
        ${!rows.length ? `<tr><td colspan="${cols}">${ui.empty("조건에 맞는 글이 없습니다.")}</td></tr>` : ""}</tbody></table></div>`;
    box.innerHTML = `<div class="bb-meta">
        <span>전체 <b class="mono">${esc(d.total)}</b>건${s.q ? ` · <q>${esc(s.q)}</q> 검색` : ""}</span>
        ${s.q ? '<button type="button" class="link-btn" data-bb-clear>검색 해제</button>' : ""}
        <span class="spacer"></span>
        ${mng && rows.length ? `<span class="bb-bulk m-hide"><button type="button" class="btn btn-ghost btn-sm" data-bb-move disabled>이동</button><button type="button" class="btn btn-danger btn-sm" data-bb-del disabled>선택 삭제</button></span>` : ""}
        <select id="bb-size" class="bb-size m-hide" aria-label="쪽당 글 수">${SeMIS.BBS_SIZES.map(n => `<option value="${n}"${n === d.size ? " selected" : ""}>${n}개씩</option>`).join("")}</select>
      </div>${body}${pagerHTML(d.total, d.page, d.size)}`;
    $$("[data-bpg]", box).forEach(x => x.onclick = () => { s.page = Number(x.dataset.bpg); s.sel.clear(); loadList(view, b); scrollTop(view); });
    const sz = $("#bb-size", box); if (sz) sz.onchange = () => { s.size = Number(sz.value); s.page = 1; loadList(view, b); };
    const cl = $("[data-bb-clear]", box); if (cl) cl.onclick = () => { s.q = ""; s.qd = ""; s.page = 1; const qi = $("#bb-q", view); if (qi) qi.value = ""; loadList(view, b); };
    const fw = $("[data-bb-first]", box); if (fw) fw.onclick = () => write(b.id);
    if (mng) wireBulk(view, b, box);
  }
  function scrollTop(view) { try { const h = view.querySelector(".bb-card"); if (h && h.scrollIntoView && h.getBoundingClientRect().top < 0) h.scrollIntoView({ block: "start" }); } catch (e) { /* 스크롤 실패 무시 */ } }

  function wireBulk(view, b, box) {
    const s = S(b.id);
    const sync = () => {
      const n = s.sel.size;
      const del = $("[data-bb-del]", box), mv = $("[data-bb-move]", box);
      if (del) { del.disabled = !n; del.textContent = n ? "선택 삭제 " + n : "선택 삭제"; }
      if (mv) mv.disabled = !n;
      const all = $("#bb-all", box), cbs = $$("[data-bsel]", box);
      if (all) all.checked = cbs.length > 0 && cbs.every(c => c.checked);
    };
    $$("[data-bsel]", box).forEach(c => c.onchange = () => { if (c.checked) s.sel.add(c.dataset.bsel); else s.sel.delete(c.dataset.bsel); sync(); });
    const all = $("#bb-all", box);
    if (all) all.onchange = () => { $$("[data-bsel]", box).forEach(c => { c.checked = all.checked; if (all.checked) s.sel.add(c.dataset.bsel); else s.sel.delete(c.dataset.bsel); }); sync(); };
    const del = $("[data-bb-del]", box);
    if (del) del.onclick = () => {
      const ids = Array.from(s.sel);
      confirmModal("선택한 글 " + ids.length + "건(답글 포함)을 삭제하시겠습니까?", () => remove(ids).then(d => {
        if (d && d.ok) { s.sel.clear(); toast("삭제했습니다(" + d.n + "건)."); loadList(view, b); }
      }));
    };
    const mv = $("[data-bb-move]", box);
    if (mv) mv.onclick = () => moveForm(Array.from(s.sel), b, () => { s.sel.clear(); loadList(view, b); });
    sync();
  }

  /* ── 글 읽기 ── */
  function renderPost(view, b, id) {
    view.innerHTML = ui.head({ title: label(b), meta: b.id,
      actions: `<button type="button" class="btn btn-ghost" data-go="board/${esc(b.id)}">${icon("chevl", 16)}<span>목록</span></button>` + headActions(b) }) +
      `<div id="bb-post"><div class="card"><div class="bb-wait" role="status">${icon("refresh", 16)}<span>불러오는 중…</span></div></div></div>`;
    wireHead(view, b);
    $$("[data-go]", view).forEach(x => x.onclick = () => SeMIS.navigate(x.dataset.go));
    const c = postCache[id];
    if (fresh(c, b.id)) { paintPost(view, b, c.d); return; }
    const route = nowRoute(), g = gen[b.id] || 0;
    rpc("semis_logi_bbs_get", { p_id: id }).then(d => {
      if (!d || !d.ok) throw Object.assign(new Error("bbs"), { d });
      if (d.post.b !== b.id) { SeMIS.navigate("board/" + d.post.b + "/" + d.post.id); return; }
      postCache[id] = { d, at: Date.now(), gen: g };
      if (d.first) refreshStats(true);
      if (nowRoute() === route && view.isConnected) paintPost(view, b, d);
    }).catch(e => {
      if (nowRoute() !== route || !$("#bb-post", view)) return;
      $("#bb-post", view).innerHTML = `<div class="card"><div class="bb-err" role="alert"><span>${esc(errMsg(e && e.d))}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-go="board/${esc(b.id)}">목록</button></div></div>`;
      $$("[data-go]", view).forEach(x => x.onclick = () => SeMIS.navigate(x.dataset.go));
    });
  }

  function filesHTML(files) {
    if (!files || !files.length) return "";
    return `<div class="bb-files"><div class="bb-files-h">${icon("clip", 15)}<b>첨부 파일</b><span class="mono">${files.length}</span></div><ul>${files.map(f =>
      `<li><a class="bb-file" href="${esc(f.url)}" target="_blank" rel="noopener" download="${esc(f.name || "")}">${icon("down", 15)}<span>${esc(f.name || "첨부")}</span></a>${f.size ? `<span class="cell-sub mono">${esc(size(f.size))}</span>` : ""}</li>`).join("")}</ul></div>`;
  }
  function readersHTML(r) {
    if (!r) return "";
    const read = r.read || [], un = r.unread || [];
    return `<details class="bb-readers no-print-open">
      <summary>${icon("eye", 15)}<span>열람 확인</span><b>읽음 <span class="mono">${read.length}</span></b><b class="${un.length ? "is-un" : ""}">안 읽음 <span class="mono">${un.length}</span></b></summary>
      <div class="bb-rd"><div><h4>읽음</h4>${read.length ? read.map(x => `<span class="bb-chip">${esc(x.name)} <small class="mono">${esc(fmt(x.at))}</small></span>`).join("") : '<span class="cell-sub">없음</span>'}</div>
      <div><h4>안 읽음</h4>${un.length ? un.map(n => `<span class="bb-chip is-un">${esc(n)}</span>`).join("") : '<span class="cell-sub">모두 읽었습니다</span>'}</div></div></details>`;
  }
  function commentsHTML(b, d) {
    if (!b.opt.comment) return "";
    const cm = d.comments || [];
    return `<section class="card bb-cmts" aria-label="댓글">
      <h3 class="card-title">댓글 <span class="mono">${cm.length}</span></h3>
      ${cm.length ? `<ul class="bb-cl">${cm.map(c => `<li class="bb-c"><div class="bb-ch"><b>${esc(c.by)}</b><span class="mono cell-sub">${esc(fmt(c.at, true))}</span>
          ${c.mine || manage() ? `<button type="button" class="mt-btn danger no-print" data-cdel="${esc(c.id)}" aria-label="댓글 삭제" title="삭제">${icon("trash", 14)}</button>` : ""}</div>
          <p>${esc(c.body).replace(/\n/g, "<br>")}</p></li>`).join("")}</ul>` : ""}
      ${d.can.comment ? `<form class="bb-cform no-print" id="bb-cf"><textarea id="bb-ct" rows="2" maxlength="2000" placeholder="댓글을 입력하세요" aria-label="댓글">${esc(drafts[d.post.id] || "")}</textarea>
        <button type="submit" class="btn btn-primary btn-sm">등록</button></form>` : ""}
    </section>`;
  }
  function paintPost(view, b, d) {
    const p = d.post, can = d.can;
    const box = $("#bb-post", view);
    if (!box) return;
    const html = window.SemisNotice ? SemisNotice.sanitizeHtml(p.html || "") : esc(p.body || "");
    const edited = p.up && p.at && Math.abs(new Date(p.up) - new Date(p.at)) > 60000;
    box.innerHTML = `<article class="card bb-post">
        <header class="bb-ph">
          <div class="bb-ptl">${p.pin ? '<span class="badge badge-red">공지</span>' : ""}${p.cat ? ui.chip(p.cat, "blue") : ""}${p.depth ? `<span class="bb-re">${icon("reply", 15)}</span>` : ""}<h2>${esc(p.title)}</h2></div>
          <div class="bb-pm"><b>${esc(p.by)}</b><span class="mono">${esc(fmt(p.at, true))}</span>${edited ? `<span>수정 <span class="mono">${esc(fmt(p.up, true))}</span></span>` : ""}
            ${b.opt.views ? `<span>조회 <span class="mono">${esc(p.views)}</span></span>` : ""}<span class="mono bb-pno">No. ${esc(noOf(b.id, p.no))}</span></div>
        </header>
        ${filesHTML(p.files)}
        <div class="bb-content notice-html">${html || '<p class="cell-sub">내용 없음</p>'}</div>
        ${readersHTML(d.readers)}
        <footer class="bb-pa no-print">
          <button type="button" class="btn btn-ghost btn-sm" data-go="board/${esc(b.id)}">목록</button>
          ${can.reply ? `<button type="button" class="btn btn-ghost btn-sm" data-bb-reply>${icon("reply", 15)}<span>답글</span></button>` : ""}
          <span class="spacer"></span>
          ${can.manage && boards().filter(x => x.id !== b.id && canRead(x)).length && !p.depth ? '<button type="button" class="link-btn" data-bb-mv>이동</button>' : ""}
          ${can.edit ? `<button type="button" class="btn btn-ghost btn-sm" data-bb-edit>${icon("edit", 15)}<span>수정</span></button>` : ""}
          ${can.del ? `<button type="button" class="btn btn-danger btn-sm" data-bb-del>${icon("trash", 15)}<span>삭제</span></button>` : ""}
        </footer>
      </article>
      ${commentsHTML(b, d)}
      ${d.prev || d.next ? `<nav class="bb-pn no-print" aria-label="앞뒤 글">
        ${d.next ? `<a href="#/board/${esc(b.id)}/${esc(d.next.id)}"><span class="bb-pnl">${icon("chevup", 15)}다음 글</span><span class="bb-pnt">${esc(d.next.title)}</span></a>` : ""}
        ${d.prev ? `<a href="#/board/${esc(b.id)}/${esc(d.prev.id)}"><span class="bb-pnl">${icon("chevdown", 15)}이전 글</span><span class="bb-pnt">${esc(d.prev.title)}</span></a>` : ""}</nav>` : ""}`;
    $$("[data-go]", box).forEach(x => x.onclick = () => SeMIS.navigate(x.dataset.go));
    const rp = $("[data-bb-reply]", box); if (rp) rp.onclick = () => write(b.id, null, p);
    const ed = $("[data-bb-edit]", box); if (ed) ed.onclick = () => write(b.id, p);
    const mv = $("[data-bb-mv]", box); if (mv) mv.onclick = () => moveForm([p.id], b, () => SeMIS.navigate("board/" + b.id));
    const dl = $("[data-bb-del]", box);
    if (dl) dl.onclick = () => confirmModal(p.replies ? "이 글과 답글 " + p.replies + "건을 삭제하시겠습니까?" : "이 글을 삭제하시겠습니까?",
      () => remove([p.id]).then(r => { if (r && r.ok) { toast("삭제했습니다."); SeMIS.navigate("board/" + b.id); } }));
    const cf = $("#bb-cf", box), ct = $("#bb-ct", box);
    if (ct) {
      ct.oninput = () => { drafts[p.id] = ct.value; };
      ct.onkeydown = (ev) => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); cf.requestSubmit ? cf.requestSubmit() : cf.onsubmit(ev); } };
    }
    if (cf) cf.onsubmit = (ev) => {
      ev.preventDefault();
      const v = String(ct.value || "").trim();
      if (!v) { toast("댓글을 입력하세요.", true); return; }
      const btn = $("button[type=submit]", cf); btn.disabled = true;
      rpc("semis_logi_bbs_comment", { p: { post: p.id, body: v } }).then(r => {
        if (!r || !r.ok) { toast(errMsg(r), true); btn.disabled = false; return; }
        delete drafts[p.id]; bump(b.id); SeMIS.renderView();
      }).catch(() => { toast(errMsg(null), true); btn.disabled = false; });
    };
    $$("[data-cdel]", box).forEach(x => x.onclick = () => confirmModal("이 댓글을 삭제하시겠습니까?", () =>
      rpc("semis_logi_bbs_comment", { p: { del: Number(x.dataset.cdel) } }).then(r => {
        if (!r || !r.ok) { toast(errMsg(r), true); return; }
        bump(b.id); SeMIS.renderView();
      }).catch(() => toast(errMsg(null), true))));
  }

  function remove(ids) {
    return rpc("semis_logi_bbs_delete", { p: { ids: ids.map(Number) } }).then(d => {
      if (!d || !d.ok) { toast(errMsg(d), true); return d; }
      const bs = new Set(); ids.forEach(i => { const c = postCache[i]; if (c) bs.add(c.d.post.b); delete postCache[i]; });
      Object.keys(gen).concat(Array.from(bs)).forEach(bump);
      refreshStats(true);
      return d;
    }).catch(() => { toast(errMsg(null), true); return null; });
  }

  function moveForm(ids, from, done) {
    const targets = boards().filter(x => x.id !== from.id && canRead(x));
    if (!targets.length) { toast("옮길 게시판이 없습니다.", true); return; }
    openModal(`<h3>다른 게시판으로 이동</h3>
      <p class="form-hint">원글 ${ids.length}건과 그 답글을 옮깁니다. 글 번호는 새 게시판에서 다시 매깁니다.</p>
      <div class="form-row"><label for="bb-mvto">옮길 게시판</label><select id="bb-mvto">${targets.map(x => `<option value="${esc(x.id)}">${esc(x.id + " · " + x.name)}</option>`).join("")}</select></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">이동</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const to = $("#bb-mvto").value;
      rpc("semis_logi_bbs_move", { p: { ids: ids.map(Number), to } }).then(d => {
        if (!d || !d.ok) { toast(errMsg(d), true); return; }
        closeModal(); bump(from.id); bump(to); ids.forEach(i => { delete postCache[i]; });
        toast((bdef(to) || {}).name + "(으)로 옮겼습니다(" + d.n + "건).");
        refreshStats(true);
        if (done) done();
      }).catch(() => toast(errMsg(null), true));
    };
  }

  /* ── 글쓰기 · 고치기 · 답글 (모달) ── */
  function write(boardId, post, parent) {
    const b = bdef(boardId);
    if (!b) { toast("게시판을 찾을 수 없습니다.", true); return; }
    if (!post && !canWrite(b)) { toast("이 게시판에 글을 쓸 권한이 없습니다.", true); return; }
    let files = post && Array.isArray(post.files) ? post.files.slice() : [];
    let busy = 0;
    const pinOk = b.opt.pin && manage() && !parent && !(post && post.depth);
    const title0 = post ? post.title : parent ? "Re: " + String(parent.title || "").replace(/^(Re:\s*)+/i, "") : "";
    openModal(`<h3>${post ? "글 수정" : parent ? "답글 쓰기" : "글쓰기"} <small class="au-mh">${esc(label(b))}</small></h3>
      <div class="bb-form">
        ${b.opt.cat && b.cats.length ? `<div class="form-row"><label for="bb-wcat">분류</label><select id="bb-wcat"><option value="">선택 안 함</option>${b.cats.map(c =>
          `<option${post && post.cat === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>` : ""}
        <div class="form-row"><label for="bb-wt">제목</label><input id="bb-wt" maxlength="200" value="${esc(title0)}" autocomplete="off"></div>
        ${pinOk ? `<div class="form-row bb-pinrow"><label class="bb-chk"><input type="checkbox" id="bb-wpin"${post && post.pin ? " checked" : ""}> 상단 고정</label>
          <label class="bb-until">고정 기한 <input type="date" id="bb-wuntil" value="${esc(post && post.pinUntil ? String(post.pinUntil).slice(0, 10) : "")}"></label>${ui.tip("비워 두면 계속 고정합니다. 기한이 지나면 목록 맨 위에서 내려옵니다.", "고정 기한 설명")}</div>` : ""}
        <div class="form-row"><label>${b.opt.editor ? "내용" : '<span id="bb-wbl">내용</span>'}</label>
          ${b.opt.editor ? `<div class="nb-toolbar" role="toolbar" aria-label="서식">
            <button type="button" data-cmd="bold" title="굵게"><b>B</b></button><button type="button" data-cmd="italic" title="기울임"><i>I</i></button>
            <button type="button" data-cmd="underline" title="밑줄"><u>U</u></button><button type="button" data-cmd="strikeThrough" title="취소선"><s>S</s></button>
            <span class="nb-sep"></span><button type="button" data-cmd="insertUnorderedList" title="글머리 목록">• 목록</button><button type="button" data-cmd="insertOrderedList" title="번호 목록">1. 목록</button>
            <span class="nb-sep"></span><button type="button" id="bb-wtbl" title="표 삽입(3×3)">표</button><button type="button" id="bb-wimg" title="이미지 삽입">이미지</button><button type="button" id="bb-wlink" title="선택한 글자에 링크">링크</button>
          </div><div id="bb-wed" class="nb-editor bb-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="내용"></div>
          <input type="file" id="bb-wimgf" accept="image/*" hidden>`
          : `<textarea id="bb-wta" rows="12" maxlength="100000" aria-labelledby="bb-wbl"></textarea>`}</div>
        ${b.opt.attach ? `<div class="form-row"><label>첨부 파일</label><div class="bb-drop" id="bb-wdrop">
            <div id="bb-wfl" class="bb-wfl"></div>
            <label class="btn btn-ghost btn-sm bb-add">${icon("clip", 15)}<span>파일 추가</span><input type="file" id="bb-wfile" multiple hidden></label>
            <span class="cell-sub">끌어다 놓아도 됩니다 · 파일당 50MB</span></div></div>` : ""}
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">${post ? "저장" : "등록"}</button></div>`,
      { wide: true, sticky: true });
    const ed = $("#bb-wed"), ta = $("#bb-wta");
    if (ed) {
      ed.innerHTML = post ? (window.SemisNotice ? SemisNotice.sanitizeHtml(post.html || "") : "") : "";
      if (window.SemisNotice) SemisNotice.wireRichMedia(ed, folder(b));
      const exec = (cmd, val) => { ed.focus(); try { document.execCommand(cmd, false, val); } catch (e) { /* 지원 안 함 */ } };
      const ins = (h) => { ed.focus(); try { if (!document.execCommand("insertHTML", false, h)) ed.innerHTML += h; } catch (e) { ed.innerHTML += h; } };
      $$("#modal-box .nb-toolbar [data-cmd]").forEach(x => { x.onmousedown = (ev) => ev.preventDefault(); x.onclick = () => exec(x.dataset.cmd); });
      $("#bb-wtbl").onclick = () => ins(`<table class="nb-table"><tbody>${("<tr>" + "<td>&nbsp;</td>".repeat(3) + "</tr>").repeat(3)}</tbody></table><p><br></p>`);
      $("#bb-wlink").onclick = () => { let u = ""; try { u = window.prompt("링크 주소(https://…)", "https://") || ""; } catch (e) { u = ""; } if (/^https?:\/\/.+/.test(u)) exec("createLink", u); };
      $("#bb-wimg").onclick = () => $("#bb-wimgf").click();
      $("#bb-wimgf").onchange = async (ev) => {
        const f = ev.target.files[0]; ev.target.value = "";
        if (!f || !window.SemisSync) return;
        busy++; toast("이미지 올리는 중…");
        try {
          const slim = window.SemisNotice ? await SemisNotice.shrinkImage(f, 1600) : f;
          const up = await SemisSync.uploadFile(slim, folder(b));
          ins(`<img src="${esc(up.url)}" alt="${esc(f.name)}">`);
        } catch (e) { toast("이미지를 올리지 못했습니다.", true); }
        busy--;
      };
    } else if (ta) ta.value = post ? String(post.body || "") : "";
    const paintFiles = () => {
      const fl = $("#bb-wfl"); if (!fl) return;
      fl.innerHTML = files.map((f, i) => `<span class="bb-wf"><span class="bb-wfn">${esc(f.name)}</span><small class="mono">${esc(size(f.size))}</small>
        <button type="button" class="mt-btn danger" data-wfx="${i}" aria-label="${esc(f.name)} 빼기">${icon("x", 14)}</button></span>`).join("");
      $$("[data-wfx]", fl).forEach(x => x.onclick = () => { files.splice(Number(x.dataset.wfx), 1); paintFiles(); });
    };
    async function addFiles(list) {
      for (const f of Array.from(list || [])) {
        if (files.length >= FILES_MAX) { toast("첨부는 " + FILES_MAX + "개까지입니다.", true); break; }
        if (f.size > FILE_MAX) { toast(f.name + ": 50MB를 넘습니다.", true); continue; }
        if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 첨부할 수 없습니다.", true); break; }
        busy++;
        const tmp = { name: f.name, size: f.size, url: "", type: f.type || "", up: true };
        files.push(tmp); paintFiles();
        try {
          const up = await SemisSync.uploadFile(f, folder(b));
          Object.assign(tmp, { url: up.url, size: up.size || f.size }); delete tmp.up;
        } catch (e) { files = files.filter(x => x !== tmp); toast("올리지 못했습니다: " + f.name, true); }
        busy--; paintFiles();
      }
    }
    paintFiles();
    const fi = $("#bb-wfile"); if (fi) fi.onchange = (ev) => { const l = Array.from(ev.target.files || []); ev.target.value = ""; addFiles(l); };
    const drop = $("#bb-wdrop");
    if (drop) {
      drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("on"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("on"));
      drop.addEventListener("drop", (ev) => { ev.preventDefault(); drop.classList.remove("on"); if (ev.dataTransfer && ev.dataTransfer.files) addFiles(ev.dataTransfer.files); });
    }
    const pin = $("#bb-wpin"), until = $("#bb-wuntil");
    const syncPin = () => { if (until) until.disabled = !(pin && pin.checked); };
    if (pin) pin.onchange = syncPin;
    syncPin();
    const dirty = () => {
      const t = $("#bb-wt").value.trim();
      const body = ed ? (ed.textContent || "").trim() || !!ed.querySelector("img,table") : String(ta ? ta.value : "").trim();
      return (t && t !== title0) || !!body && !post || files.length !== (post && post.files ? post.files.length : 0);
    };
    $("#modal-box [data-act=cancel]").onclick = () => {
      if (!dirty()) { closeModal(); return; }
      const c = $("#modal-box [data-act=cancel]");
      if (c.dataset.sure) { closeModal(); return; }
      c.dataset.sure = "1"; c.textContent = "작성 취소 확인";
      c.classList.add("btn-danger");
      setTimeout(() => { if (c.isConnected) { delete c.dataset.sure; c.textContent = "취소"; c.classList.remove("btn-danger"); } }, 3500);
    };
    setTimeout(() => { const t = $("#bb-wt"); if (t && !post) t.focus(); }, 30);
    $("#modal-box [data-act=ok]").onclick = () => {
      if (busy > 0 || files.some(f => f.up)) { toast("파일을 올리는 중입니다. 잠시 뒤 저장하세요.", true); return; }
      const title = $("#bb-wt").value.replace(/\s+/g, " ").trim();
      if (!title) { toast("제목을 입력하세요.", true); $("#bb-wt").focus(); return; }
      let html, body;
      if (ed) {
        html = window.SemisNotice ? SemisNotice.sanitizeHtml(ed.innerHTML) : "";
        const t = document.createElement("div"); t.innerHTML = html; body = (t.textContent || "").replace(/ /g, " ").trim();
      } else {
        body = String(ta.value || "").trim();
        html = body.split("\n").map(l => "<p>" + (esc(l) || "<br>") + "</p>").join("");
      }
      const okBtn = $("#modal-box [data-act=ok]"); okBtn.disabled = true;
      const p = { b: b.id, title, html, body, files: files.map(f => ({ name: f.name, url: f.url, size: f.size || 0, type: f.type || "" })),
        cat: $("#bb-wcat") ? $("#bb-wcat").value : "", pin: !!(pin && pin.checked), pinUntil: pin && pin.checked && until && until.value ? until.value : "" };
      if (post) p.id = post.id;
      if (parent) p.parent = parent.id;
      rpc("semis_logi_bbs_save", { p }).then(d => {
        if (!d || !d.ok) { okBtn.disabled = false; toast(errMsg(d), true); return; }
        closeModal(); bump(b.id); delete postCache[d.id];
        toast(post ? "저장했습니다." : "등록했습니다.");
        refreshStats(true);
        const to = "board/" + b.id + "/" + d.id;
        if (nowRoute() === to) SeMIS.renderView(); else SeMIS.navigate(to);
      }).catch(() => { okBtn.disabled = false; toast(errMsg(null), true); });
    };
  }

  /* ── 원격 변경(다른 사람이 이 게시판에 쓰거나 지움) ── */
  let remoteT = null;
  function remote(boardId) {
    bump(boardId);
    clearTimeout(remoteT);
    remoteT = setTimeout(() => {
      refreshStats(true);
      const r = nowRoute();
      if (SeMIS.boardIdOf(r) !== boardId) return;
      const view = $("#view");
      const ct = view && $("#bb-ct", view);
      if (ct && ct.value.trim() && document.activeElement === ct) return;   // 댓글 쓰는 중이면 다음 화면 이동 때 반영
      SeMIS.renderView();
    }, 500);
  }

  /* ── 대시보드 — 최근 글 칸 ── */
  function dashBoards() { return boards().filter(b => b.opt.dash && canRead(b)); }
  function paintDash(box, meta) {
    if (!box) return;
    const draw = () => {
      if (!box.isConnected) return;
      const rows = recent.rows || [];
      const many = dashBoards().length > 1;
      if (meta) { const un = dashBoards().reduce((n, b) => n + (Number((stats.boards[b.id] || {}).unread) || 0), 0); meta.textContent = un ? "새 글 " + un : ""; }
      box.innerHTML = rows.length ? rows.map(r => {
        const b = bdef(r.b) || { id: r.b, name: r.b };
        return `<a class="notice-item bb-dash${!r.read ? " is-unread" : ""}" href="#/board/${esc(r.b)}/${esc(r.id)}">
          <div class="notice-title">${r.pin ? '<span class="badge badge-red">고정</span>' : ""}${many ? `<span class="badge badge-gray">${esc(b.name)}</span>` : ""}<span>${esc(r.title)}</span>${r.nf ? `<span class="nt-clip" title="첨부 ${r.nf}">${icon("clip", 14)}</span>` : ""}${newMark(r)}</div>
          <div class="notice-meta">${esc(r.by)} · ${esc(fmt(r.at))}</div></a>`;
      }).join("") : (recent.at ? '<div class="empty">등록된 글이 없습니다.</div>' : `<div class="bb-wait" role="status">${icon("refresh", 15)}<span>불러오는 중…</span></div>`);
    };
    draw();
    if (!recent.at || Date.now() - recent.at > 60000) loadRecent(true).then(draw);
  }

  /* ── 게시판 관리(시스템 설정 › 게시판) ── */
  let counts = {};
  function loadCounts() {
    return rpc("semis_logi_bbs_admin", { p: { op: "counts" } }).then(d => { if (d && d.ok) counts = d.boards || {}; return counts; }).catch(() => counts);
  }
  function nextId() {
    const ids = boards().map(b => b.id).concat(Object.keys(counts));
    const n = ids.reduce((m, id) => Math.max(m, Number(String(id).slice(1)) || 0), 0) + 1;
    return "B" + String(n).padStart(3, "0");
  }
  function adminTab(box) {
    const render2 = () => {
      const bs = boards();
      const orphan = Object.keys(counts).filter(id => !bs.some(b => b.id === id) && (counts[id].total || counts[id].deleted));
      box.innerHTML = `<div class="card">
        <div class="card-title">게시판 <span class="mono cell-sub">${bs.length}</span><span class="spacer"></span>
          <button type="button" class="link-btn" id="bb-trash">휴지통</button>
          <button type="button" class="btn btn-primary btn-sm" id="bb-new">${icon("plus", 15)}<span>게시판 만들기</span></button></div>
        <div class="table-wrap"><table class="tbl bb-adm tbl-keep" data-no-stack><thead><tr><th>ID</th><th>이름</th><th>형식</th><th>읽기 · 쓰기</th><th>켠 기능</th><th class="bb-v">글</th><th>메뉴</th><th class="td-act"></th></tr></thead><tbody>
        ${bs.map(b => {
          const m = SeMIS.data.menus.find(x => x && x.type === "board" && x.board === b.id);
          const hub = m && m.parent ? SeMIS.data.menus.find(x => x.id === m.parent) : null;
          const c = counts[b.id] || {};
          return `<tr data-bbid="${esc(b.id)}"><td class="mono"><b>${esc(b.id)}</b></td>
            <td><b>${esc(b.name)}</b>${b.desc ? `<div class="cell-sub">${esc(b.desc)}</div>` : ""}</td>
            <td>${esc((SeMIS.BBS_KIND[b.kind] || {}).label || "")} · ${esc(VIEW[b.view])}</td>
            <td>${esc(LV_SHORT[b.read])} · ${esc(LV_SHORT[b.write])}</td>
            <td class="bb-optc">${SeMIS.BBS_OPTS.filter(o => b.opt[o]).map(o => `<span class="bb-oc">${esc(OPT[o][0])}</span>`).join("") || '<span class="cell-sub">없음</span>'}</td>
            <td class="bb-v mono">${c.total != null ? esc(c.total) : "-"}</td>
            <td>${m ? `<span class="cell-sub">${esc(hub ? hub.label + " › " : "")}</span>${esc(m.label)}${m.hidden ? ' <span class="badge badge-gray">숨김</span>' : ""}`
              : `<button type="button" class="link-btn" data-bbmenu="${esc(b.id)}">메뉴에 추가</button>`}</td>
            <td class="td-act"><button type="button" class="mt-btn" data-bbopen="${esc(b.id)}" title="열기" aria-label="${esc(b.name)} 열기">${icon("chevron", 16)}</button>
              <button type="button" class="mt-btn" data-bbedit="${esc(b.id)}" title="설정" aria-label="${esc(b.name)} 설정">${icon("edit", 16)}</button>
              <button type="button" class="mt-btn danger" data-bbdel="${esc(b.id)}" title="삭제" aria-label="${esc(b.name)} 삭제">${icon("trash", 16)}</button></td></tr>`;
        }).join("")}
        ${orphan.map(id => `<tr class="is-orphan"><td class="mono"><b>${esc(id)}</b></td><td colspan="4"><span class="cell-sub">정의가 없는 글 묶음(지운 게시판)</span></td>
            <td class="bb-v mono">${esc(counts[id].total || 0)}</td><td></td><td class="td-act"><button type="button" class="link-btn" data-bbdrop="${esc(id)}">비우기</button></td></tr>`).join("")}
        </tbody></table></div></div>`;
      $("#bb-new", box).onclick = () => boardForm(null, render2);
      $("#bb-trash", box).onclick = () => trashForm();
      $$("[data-bbedit]", box).forEach(x => x.onclick = () => boardForm(x.dataset.bbedit, render2));
      $$("[data-bbopen]", box).forEach(x => x.onclick = () => SeMIS.navigate("board/" + x.dataset.bbopen));
      $$("[data-bbmenu]", box).forEach(x => x.onclick = () => { addMenu(bdef(x.dataset.bbmenu)); render2(); });
      $$("[data-bbdel]", box).forEach(x => x.onclick = () => dropBoard(x.dataset.bbdel, render2));
      $$("[data-bbdrop]", box).forEach(x => x.onclick = () => confirmModal("정의가 없는 " + x.dataset.bbdrop + " 의 글 " + ((counts[x.dataset.bbdrop] || {}).total || 0) + "건을 모두 지웁니다. 되살릴 수 없습니다.", () =>
        rpc("semis_logi_bbs_admin", { p: { op: "drop", b: x.dataset.bbdrop, confirm: x.dataset.bbdrop } }).then(d => {
          if (!d || !d.ok) { toast(errMsg(d), true); return; }
          delete counts[x.dataset.bbdrop]; toast("비웠습니다(" + d.n + "건)."); render2();
        }).catch(() => toast(errMsg(null), true))));
    };
    render2();
    loadCounts().then(() => { if (box.isConnected) render2(); });
  }
  function addMenu(b, parent) {
    if (!b) return null;
    const menus = SeMIS.data.menus;
    const hub = parent || (menus.some(m => m.id === "hub-bbs" && m.type === "group") ? "hub-bbs" : SeMIS.homeHubId());
    const sib = menus.filter(m => m.parent === hub).map(m => Number(m.seq) || 0);
    const h = menus.find(m => m.id === hub);
    const seq = sib.length ? Math.round((Math.max.apply(null, sib) + 0.01) * 1e4) / 1e4 : (h ? (Number(h.seq) || 0) + 0.01 : menus.reduce((mx, m) => Math.max(mx, m.seq || 0), 0) + 1);
    const id = menus.some(m => m.id === "bbs-" + b.id) ? "bbs-" + b.id + "-" + Date.now().toString(36) : "bbs-" + b.id;
    const m = { id, seq, type: "board", label: b.name, board: b.id, vis: "all", parent: hub || null };
    menus.push(m);
    SeMIS.save(); SeMIS.renderNav();
    toast("메뉴에 추가했습니다.");
    return m;
  }
  const sw = (id, on, lbl, hint) => `<label class="sw-row"><span class="sw-l"><b>${esc(lbl)}</b>${hint ? `<small>${esc(hint)}</small>` : ""}</span>
    <span class="sw"><input type="checkbox" role="switch" id="${esc(id)}"${on ? " checked" : ""}><i aria-hidden="true"></i></span></label>`;
  const lvSel = (id, v, min) => `<select id="${esc(id)}">${Object.keys(LV).filter(k => !min || RANK[k] >= RANK[min]).map(k => `<option value="${k}"${v === k ? " selected" : ""}>${esc(LV[k])}</option>`).join("")}</select>`;
  function boardForm(id, done) {
    if (!isAdmin()) return;
    const cur = id ? bdef(id) : null;
    const newId = cur ? cur.id : nextId();
    const b = cur ? JSON.parse(JSON.stringify(cur)) : SeMIS.boardPreset("general", newId, "");
    const groups = SeMIS.sortedMenus().filter(m => m.type === "group");
    openModal(`<h3>${cur ? "게시판 설정" : "게시판 만들기"} <small class="au-mh mono">${esc(newId)}</small></h3>
      <div class="form-grid">
        <div class="form-row"><label for="bf-name">이름</label><input id="bf-name" maxlength="30" value="${esc(b.name)}" placeholder="예) 공지사항"></div>
        <div class="form-row"><label for="bf-kind">형식 ${ui.tip("형식을 고르면 아래 권한 · 기능이 그 형식의 기본값으로 바뀝니다. 그 뒤에 하나씩 고칠 수 있습니다.", "형식 설명")}</label>
          <select id="bf-kind">${Object.keys(SeMIS.BBS_KIND).map(k => `<option value="${k}"${b.kind === k ? " selected" : ""}>${esc(SeMIS.BBS_KIND[k].label)}</option>`).join("")}</select></div>
      </div>
      <div class="form-row"><label for="bf-desc">설명</label><input id="bf-desc" maxlength="200" value="${esc(b.desc)}" placeholder="목록 위에 한 줄로 보입니다(비워도 됨)"></div>
      <div class="form-grid">
        <div class="form-row"><label for="bf-view">목록 보기</label><select id="bf-view">${Object.keys(VIEW).map(k => `<option value="${k}"${b.view === k ? " selected" : ""}>${esc(VIEW[k])}</option>`).join("")}</select></div>
        <div class="form-row"><label for="bf-size">쪽당 글 수</label><select id="bf-size">${SeMIS.BBS_SIZES.map(n => `<option value="${n}"${b.perPage === n ? " selected" : ""}>${n}개</option>`).join("")}</select></div>
        <div class="form-row"><label for="bf-read">읽기</label>${lvSel("bf-read", b.read)}</div>
        <div class="form-row"><label for="bf-write">글쓰기</label>${lvSel("bf-write", b.write)}</div>
      </div>
      <div class="bf-sw" role="group" aria-label="기능">${SeMIS.BBS_OPTS.map(o => sw("bf-o-" + o, b.opt[o], OPT[o][0], OPT[o][1])).join("")}</div>
      <div class="form-grid">
        <div class="form-row" id="bf-cmtrow"><label for="bf-cmt">댓글 쓰기</label>${lvSel("bf-cmt", b.cmt)}</div>
        <div class="form-row"><label for="bf-new">새 글 표시(N) 기간</label><div class="bf-inl"><input id="bf-new" type="number" min="0" max="30" value="${esc(b.opt.newDays)}"><span>일</span></div></div>
      </div>
      <div class="form-row" id="bf-catrow"><label for="bf-cats">분류 목록</label><input id="bf-cats" value="${esc(b.cats.join(", "))}" placeholder="쉼표로 구분 — 예) 규정 · 지침, 양식, 교육 자료"></div>
      ${cur ? "" : `<div class="form-row"><label for="bf-hub">사이드 메뉴</label><select id="bf-hub"><option value="">메뉴에 넣지 않음</option>${groups.map(g =>
        `<option value="${esc(g.id)}"${g.id === (groups.some(x => x.id === "hub-bbs") ? "hub-bbs" : SeMIS.homeHubId()) ? " selected" : ""}>${esc(g.label)} 허브</option>`).join("")}</select></div>`}
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">${cur ? "저장" : "만들기"}</button></div>`, { wide: true });
    const syncRows = () => {
      $("#bf-catrow").hidden = !$("#bf-o-cat").checked;
      $("#bf-cmtrow").style.visibility = $("#bf-o-comment").checked ? "" : "hidden";
    };
    $("#bf-o-cat").onchange = syncRows; $("#bf-o-comment").onchange = syncRows; syncRows();
    $("#bf-kind").onchange = () => {
      const p = SeMIS.boardPreset($("#bf-kind").value, newId, "");
      $("#bf-view").value = p.view; $("#bf-read").value = p.read; $("#bf-write").value = p.write; $("#bf-new").value = p.opt.newDays;
      SeMIS.BBS_OPTS.forEach(o => { $("#bf-o-" + o).checked = !!p.opt[o]; });
      if (p.cats.length && !$("#bf-cats").value.trim()) $("#bf-cats").value = p.cats.join(", ");
      syncRows();
    };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const name = $("#bf-name").value.replace(/\s+/g, " ").trim();
      if (!name) { toast("이름을 입력하세요.", true); $("#bf-name").focus(); return; }
      if (boards().some(x => x.id !== newId && x.name === name)) { toast("같은 이름의 게시판이 있습니다.", true); return; }
      const opt = {};
      SeMIS.BBS_OPTS.forEach(o => { opt[o] = $("#bf-o-" + o).checked; });
      opt.newDays = Math.max(0, Math.min(30, Math.round(Number($("#bf-new").value) || 0)));
      const nb = SeMIS.normBoard(Object.assign({}, b, { id: newId, name, desc: $("#bf-desc").value, kind: $("#bf-kind").value, view: $("#bf-view").value,
        perPage: Number($("#bf-size").value), read: $("#bf-read").value, write: $("#bf-write").value, cmt: $("#bf-cmt").value, opt,
        cats: $("#bf-cats").value.split(/\s*,\s*/) }));
      if (nb.opt.cat && !nb.cats.length) { toast("분류를 켜려면 분류 목록을 하나 이상 적으세요.", true); return; }
      if (cur) {
        const i = D().boards.findIndex(x => x.id === newId);
        const old = D().boards[i];
        if (old.created) nb.created = old.created;
        if (old.by) nb.by = old.by;
        D().boards[i] = nb;
        SeMIS.data.menus.forEach(m => { if (m.type === "board" && m.board === newId && m.label === old.name) m.label = name; });
      } else {
        nb.created = new Date().toISOString().slice(0, 10); nb.by = (SeMIS.user && SeMIS.user.name) || "";
        D().boards.push(nb);
      }
      SeMIS.save();
      closeModal();
      bump(newId);
      toast(cur ? "저장했습니다." : nb.id + " 게시판을 만들었습니다.");
      if (!cur && hubPick) addMenu(nb, hubPick);
      SeMIS.renderNav();
      if (done) done(); else SeMIS.renderView();
    };
    let hubPick = "";
    const hs = $("#bf-hub"); if (hs) { hubPick = hs.value; hs.onchange = () => { hubPick = hs.value; }; }
  }
  function dropBoard(id, done) {
    const b = bdef(id);
    if (!b) return;
    const n = (counts[id] || {}).total;
    confirmModal(`${b.id} '${b.name}' 게시판을 삭제합니다. ${n ? "글 " + n + "건과 댓글 · 첨부 연결도 함께 지워지며 되살릴 수 없습니다." : "글이 없습니다."} 연결된 메뉴도 지웁니다.`, () => {
      rpc("semis_logi_bbs_admin", { p: { op: "drop", b: id, confirm: id } }).then(d => {
        if (!d || !d.ok) { toast(errMsg(d), true); return; }
        D().boards = D().boards.filter(x => x.id !== id);
        if (!D().boards.length && window.SemisSync && SemisSync.confirmWipe) SemisSync.confirmWipe("boards");
        SeMIS.data.menus = SeMIS.data.menus.filter(m => !(m.type === "board" && m.board === id));
        delete counts[id];
        SeMIS.save(); SeMIS.renderNav();
        toast("삭제했습니다" + (d.n ? "(글 " + d.n + "건)." : "."));
        if (done) done();
      }).catch(() => toast(errMsg(null), true));
    });
  }
  function trashForm() {
    openModal(`<h3>휴지통 <small class="au-mh">지운 글 · 90일 보관</small></h3><div id="bb-tr" class="bb-tr"><div class="bb-wait">${icon("refresh", 15)}<span>불러오는 중…</span></div></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const paint = () => rpc("semis_logi_bbs_admin", { p: { op: "trash" } }).then(d => {
      const box = $("#bb-tr"); if (!box) return;
      const rows = (d && d.ok && d.rows) || [];
      box.innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl tbl-keep" data-no-stack><thead><tr><th>게시판</th><th>제목</th><th>작성</th><th>삭제</th><th></th></tr></thead><tbody>${rows.map(r =>
        `<tr><td class="mono">${esc(r.b)}-${esc(r.no)}</td><td>${r.depth ? icon("reply", 13) : ""}${esc(r.title)}</td><td>${esc(r.by)}<div class="cell-sub mono">${esc(fmt(r.at, true))}</div></td>
          <td>${esc(r.delBy || "")}<div class="cell-sub mono">${esc(fmt(r.del, true))}</div></td><td>${r.depth ? "" : `<button type="button" class="link-btn" data-tre="${esc(r.id)}">되살리기</button>`}</td></tr>`).join("")}</tbody></table></div>`
        : '<div class="empty">지운 글이 없습니다.</div>';
      $$("[data-tre]", box).forEach(x => x.onclick = () => rpc("semis_logi_bbs_admin", { p: { op: "restore", id: Number(x.dataset.tre) } }).then(r => {
        if (!r || !r.ok) { toast(errMsg(r), true); return; }
        bump(r.b); refreshStats(true); toast("되살렸습니다(" + r.n + "건)."); paint();
      }).catch(() => toast(errMsg(null), true)));
    }).catch(() => { const box = $("#bb-tr"); if (box) box.innerHTML = '<div class="empty">불러오지 못했습니다.</div>'; });
    paint();
  }

  /* 저장소 관리 — 게시판 글이 쓰는 파일(연결 없는 파일로 잘못 지우지 않게) */
  function fileRefs() {
    return rpc("semis_logi_bbs_admin", { p: { op: "files" } }).then(d => (d && d.ok && Array.isArray(d.urls) ? d.urls : null)).catch(() => null);
  }

  /* 아르고 — 공지 등록 · 되돌리기 */
  function post(p) { return rpc("semis_logi_bbs_save", { p }).then(d => { if (d && d.ok) { bump(d.b); refreshStats(true); } return d; }); }

  /* 통합 검색 — 최근 글 300건 제목(권한은 서버가 거른 목록) */
  if (window.SemisSearch) SemisSearch.register({
    id: "bbs", group: "게시판", icon: "📋",
    items: () => (internal() ? stats.index : []).map(x => {
      const b = bdef(x.b);
      return b ? { title: x.title, sub: b.name + " · " + x.by + " · " + fmt(x.at), text: [x.title, x.by, b.name, x.cat], route: "board/" + x.b + "/" + x.id } : null;
    }).filter(Boolean)
  });

  /* 배지는 화면을 그릴 때(1분에 한 번까지) · 5분마다 · 게시판 변경 알림 때 다시 받는다 */
  let beat = null;
  SeMIS.onRerender(() => {
    refreshStats(false);
    if (!beat && typeof setInterval === "function") beat = setInterval(() => { if (SeMIS.user) refreshStats(true); }, 5 * 60 * 1000);
  });

  window.SemisBoard = {
    render, write, remote, navBadge, refreshStats, loadRecent, paintDash, dashBoards, adminTab, boardForm, addMenu, fileRefs, post, remove,
    canWrite, get stats() { return stats; }, get recent() { return recent; }, fmt, size, _st: st
  };
})();
