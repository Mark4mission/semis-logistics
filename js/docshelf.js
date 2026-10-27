/* 증빙 문서 서가 — 화면마다 붙는 '관련 문서' 묶음. 같은 문서의 여러 판(ser)은 최신 판만 보이고 이전 판은 접는다.
   원본은 비공개 버킷(docs/ · 민감보안정보는 docs-ssi/ — hq 이상 열람). 문서 · 판 이름은 공용 DB 에만.
   SeMIS.data.docs = [{ id, mod, grp, title, date, ser, org, note, ssi, mids[], files[{name,size,url}], src, at, by }]
   사용: define(mod, [{ id, label, short? }], { tab?, pick? }) → card(mod, { q? }) / groupsHTML(mod) → wire(box)
   문서가 BOARD_MIN 건 이상인 화면은 게시판형(분류 탭 · 검색 · 표 · 쪽), 적으면 묶음형. opts.q 를 주면 화면의 검색칸이 거르고 자체 검색칸은 없다 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const all = () => (Array.isArray(D().docs) ? D().docs : []);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const uid = () => "dk" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const me = () => { const u = SeMIS.user; return u ? u.name || u.id || "" : ""; };
  const FILE_MAX = 50 * 1024 * 1024;
  const GROUPS = {};          // mod → [{ id, label, short }]
  const OPTS = {};            // mod → { tab: 문서가 있는 탭(SemisDeep), pick(q): 검색 결과로 갈 때 화면 검색어 }
  const open = {};            // 펼친 이전 판 (ser 키)

  function define(mod, groups, o) {
    GROUPS[mod] = (groups || []).map(g => ({ id: String(g.id), label: String(g.label || g.id), short: String(g.short || g.label || g.id) }));
    OPTS[mod] = o || {};
  }
  const groupsOf = (mod) => GROUPS[mod] || [];
  const labelOf = (mod, grp) => { const g = groupsOf(mod).find(x => x.id === grp); return g ? g.label : grp || "기타"; };
  const shortOf = (mod, grp) => { const g = groupsOf(mod).find(x => x.id === grp); return g ? g.short : grp || "기타"; };
  const byDate = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.title || "").localeCompare(String(b.title || ""), "ko");
  const serOf = (d) => d.ser || d.id;

  function list(mod, grp) {
    return all().filter(d => d && d.mod === mod && (!grp || d.grp === grp)).sort(byDate);
  }
  /* 판 묶음 — [{ cur, old[] }] 최신 판이 앞, 묶음은 최신 판 날짜 순 */
  function series(mod, grp) {
    const m = new Map();
    list(mod, grp).forEach(d => { const k = serOf(d); if (!m.has(k)) m.set(k, []); m.get(k).push(d); });
    return Array.from(m.values()).map(v => ({ cur: v[0], old: v.slice(1) }));
  }
  function latest(mod, grp) { return list(mod, grp)[0] || null; }
  /* 체크리스트 항목 번호로 찾기 — 판 묶음마다 최신 판만 */
  const midsOf = (d) => (Array.isArray(d.mids) ? d.mids.map(String) : []);
  function forMid(mid) {
    const m = String(mid || "");
    if (!m) return [];
    const seen = new Set();
    return all().filter(d => d && midsOf(d).indexOf(m) >= 0 && (d.files || []).length).sort(byDate)
      .filter(d => { const k = d.mod + "|" + serOf(d); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  const daysAgo = (iso) => { if (!isISO(iso)) return Infinity; return Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 864e5); };
  /* 증빙 판단 — 묶음에 문서가 있고(days 를 주면 그 기간 안) 파일이 붙어 있으면 ok */
  function evid(mod, grps, days) {
    const gs = Array.isArray(grps) ? grps : [grps];
    const hit = all().filter(d => d && d.mod === mod && (!grps || gs.indexOf(d.grp) >= 0) && (d.files || []).length).sort(byDate);
    if (!hit.length) return { ok: false, text: "문서 없음" };
    const top = hit[0];
    if (days && daysAgo(top.date) > days) return { ok: false, text: "최근 " + dot(top.date) + " (기간 경과)" };
    return { ok: true, text: "문서 " + hit.length + "건 · 최근 " + (dot(top.date) || "-") };
  }

  const ext = (f) => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String((f && f.name) || "")); return m ? m[1].toUpperCase() : "FILE"; };
  function fileLink(f, label, cls, ts) {
    return `<a class="nb-file ${cls || ""}" href="${esc(f.url)}" target="_blank" rel="noopener" data-name="${esc(f.name || "")}">${mark(label || f.name || "첨부", ts)}</a>`;
  }

  /* ── 검색 — 문서 이름 · 첨부 파일명 · 기관 · 비고 · 판 묶음 · 묶음 이름 · 날짜. 잠긴 민감보안정보(SSI)는 파일명을 넣지 않는다 ── */
  const termsOf = (q) => String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  const lockedOf = (d) => !!d.ssi && SeMIS.roleRank() < 3;
  function hay(d) {
    return [d.title, d.org, d.note, d.ser, labelOf(d.mod, d.grp), shortOf(d.mod, d.grp), d.date, dot(d.date)]
      .concat(lockedOf(d) ? [] : (d.files || []).map(f => f && f.name))
      .filter(Boolean).join(" \n ").toLowerCase();
  }
  const hits = (d, ts) => !ts.length || ts.every(t => hay(d).indexOf(t) >= 0);
  const serHit = (s, ts) => hits(s.cur, ts) || s.old.some(d => hits(d, ts));
  const oldHit = (s, ts) => ts.length > 0 && s.old.some(d => hits(d, ts));     // 이전 판에서만 걸리면 펼쳐 보인다
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function mark(text, ts) {
    const s = String(text == null ? "" : text);
    if (!ts || !ts.length) return esc(s);
    const re = new RegExp("(" + ts.map(reEsc).join("|") + ")", "gi");
    return s.split(re).map((p, i) => (i % 2 ? '<mark class="dk-hl">' + esc(p) + "</mark>" : esc(p))).join("");
  }

  /* 화면별 상태 — 검색어 · 분류 · 쪽. ext = 화면 검색칸이 검색어를 정한다(규정 화면) */
  const BOARD_MIN = 20, SIZES = [10, 20, 50, 100];
  const ST = {};
  const stOf = (mod) => ST[mod] || (ST[mod] = { q: "", cat: "", page: 1, size: 20, ext: false });
  function setQuery(mod, q) { const s = stOf(mod); s.q = SeMIS.ui.searchValue(q); s.cat = ""; s.page = 1; }
  const isBoard = (mod) => list(mod).length >= BOARD_MIN;

  function rowHTML(d, canW, sub, ts) {
    const locked = lockedOf(d);
    const files = locked ? [] : (d.files || []);
    const f0 = files[0];
    const meta = [dot(d.date), d.org, d.note].filter(Boolean).map(esc).join('<span class="dk-sep">·</span>');
    return `<li class="dk-row${sub ? " is-old" : ""}" data-dk="${esc(d.id)}">
      <span class="dk-ext mono" aria-hidden="true">${esc(f0 ? ext(f0) : "—")}</span>
      <div class="dk-main">
        <div class="dk-t">${f0 ? fileLink(f0, d.title, "", ts) : `<span>${mark(d.title, ts)}</span>`}${d.ssi ? ' <span class="dk-ssi" title="민감보안정보">SSI</span>' : ""}</div>
        ${meta ? `<div class="dk-meta">${meta}</div>` : ""}
        ${files.length > 1 ? `<div class="dk-more">${files.slice(1).map(f => fileLink(f, f.name, "dk-f", ts)).join("")}</div>` : ""}
        ${ts && ts.length && f0 && !hits(Object.assign({}, d, { files: [] }), ts) ? `<div class="dk-fhit">${mark(f0.name, ts)}</div>` : ""}
      </div>
      ${canW ? `<button type="button" class="mt-btn dk-edit m-ed" data-dk-edit="${esc(d.id)}" aria-label="문서 수정">${icon("notes", 15)}</button>` : ""}
    </li>`;
  }
  function seriesHTML(s, canW, ts) {
    const k = serOf(s.cur);
    const on = !!open[k] || oldHit(s, ts);
    return rowHTML(s.cur, canW, false, ts).replace(/<\/li>\s*$/, "")
      + (s.old.length ? `<button type="button" class="link-btn dk-old-btn" data-dk-old="${esc(k)}" aria-expanded="${on}">이전 판 ${s.old.length}</button>` : "")
      + `</li>` + (s.old.length && on ? `<li class="dk-olds"><ul>${s.old.map(d => rowHTML(d, canW, true, ts)).join("")}</ul></li>` : "");
  }
  function shelf(mod, grp, opts) {
    opts = opts || {};
    const canW = opts.canEdit === undefined ? SeMIS.canEdit() : !!opts.canEdit;
    const ts = opts.ts || [];
    const ss = series(mod, grp).filter(s => serHit(s, ts));
    if (!ss.length) return opts.emptyText === null ? "" : `<p class="dk-empty">${esc(opts.emptyText || "등록된 문서가 없습니다.")}</p>`;
    return `<ul class="dk-list" data-dk-mod="${esc(mod)}" data-dk-grp="${esc(grp || "")}">${ss.map(s => seriesHTML(s, canW, ts)).join("")}</ul>`;
  }
  /* 문서 추가 — 화면마다 한 곳(묶음은 등록 창에서 고른다) */
  const addBtn = (mod, grp) => `<button type="button" class="link-btn dk-add m-ed" data-dk-add="${esc(mod)}|${esc(grp || "")}">${icon("plus", 14)}<span>문서 추가</span></button>`;
  /* 묶음 순서 — 정의된 묶음 순서대로(정의 밖 묶음은 뒤에) */
  function grpIds(mod, only) {
    const have = Array.from(new Set(list(mod).map(d => d.grp || "")));
    const defs = groupsOf(mod).filter(g => !only || only.indexOf(g.id) >= 0);
    return defs.map(g => g.id).concat(only ? [] : have.filter(g => !defs.some(x => x.id === g)));
  }

  /* ── 게시판형 — 판 묶음 한 줄(최신 판) · 번호는 날짜 순으로 고정(오래된 것 1) ── */
  function rowsOf(mod) {
    const m = new Map();
    list(mod).forEach(d => { const k = (d.grp || "") + "|" + serOf(d); if (!m.has(k)) m.set(k, []); m.get(k).push(d); });
    const rows = Array.from(m.values()).map(v => ({ cur: v[0], old: v.slice(1) }));
    rows.forEach((r, i) => { r.no = rows.length - i; });
    return rows;
  }
  function catsHTML(mod) {
    const s = stOf(mod), ts = termsOf(s.q);
    const rows = rowsOf(mod).filter(r => serHit(r, ts));
    const ids = grpIds(mod).filter(g => !g || list(mod, g).length);
    const btn = (id, lbl, n) => `<button type="button" class="bb-cat-b" data-dkb-cat="${esc(id)}" aria-pressed="${s.cat === id}">${esc(lbl)} <span class="dkb-cn mono">${n}</span></button>`;
    return btn("", "전체", rows.length) + ids.map(g => btn(g, shortOf(mod, g), rows.filter(r => (r.cur.grp || "") === g).length)).join("");
  }
  function trHTML(mod, d, no, canW, ts, oldN, on) {
    const locked = lockedOf(d), files = locked ? [] : (d.files || []), f0 = files[0];
    const old = no == null;
    const sub = [d.org, d.note].filter(Boolean).map(x => mark(x, ts)).join('<span class="dk-sep">·</span>');
    const k = (d.grp || "") + "|" + serOf(d);
    const title = f0 ? fileLink(f0, d.title, "dkb-t", ts) : `<span class="dkb-t">${mark(d.title, ts)}</span>`;
    return `<tr class="dkb-row${old ? " is-old" : ""}" data-dk="${esc(d.id)}">
      <td class="bb-no mono">${old ? "" : esc(no)}</td>
      <td class="bb-catc" title="${esc(labelOf(mod, d.grp))}">${old ? "" : mark(shortOf(mod, d.grp), ts)}</td>
      <td class="dkb-tc" data-role="title"><div class="dkb-tw">${old ? '<span class="dkb-om">이전 판</span>' : ""}${title}${d.ssi ? '<span class="dk-ssi" title="민감보안정보">SSI</span>' : ""}${oldN ? `<button type="button" class="link-btn dkb-ob" data-dkb-old="${esc(k)}" aria-expanded="${on}">이전 판 ${oldN}</button>` : ""}</div>${sub ? `<div class="dkb-sub">${sub}</div>` : ""}${files.length > 1 ? `<div class="dk-more">${files.slice(1).map(f => fileLink(f, f.name, "dk-f", ts)).join("")}</div>` : ""}</td>
      <td class="dkb-fc">${f0 ? `<span class="dkb-fn" title="${esc(f0.name || "")}"><span class="dkb-x mono">${esc(ext(f0))}</span><span class="dkb-fnn">${mark(f0.name || "", ts)}</span></span>${files.length > 1 ? `<span class="cell-sub">외 ${files.length - 1}</span>` : ""}` : '<span class="cell-sub">-</span>'}</td>
      <td class="bb-at mono">${esc(dot(d.date) || "-")}</td>
      ${canW ? `<td class="dkb-act"><button type="button" class="mt-btn dk-edit m-ed" data-dk-edit="${esc(d.id)}" aria-label="문서 수정">${icon("notes", 15)}</button></td>` : ""}
    </tr>`;
  }
  function miHTML(mod, d, canW, ts, oldN, on, old) {
    const locked = lockedOf(d), files = locked ? [] : (d.files || []), f0 = files[0];
    const k = (d.grp || "") + "|" + serOf(d);
    const title = f0 ? fileLink(f0, d.title, "dkb-t", ts) : `<span class="dkb-t">${mark(d.title, ts)}</span>`;
    const bits = [old ? "이전 판" : mark(shortOf(mod, d.grp), ts), `<span class="mono">${esc(dot(d.date) || "-")}</span>`]
      .concat(f0 ? [`<span class="dkb-mf">${mark(f0.name || "", ts)}</span>`] : []);
    return `<div class="dkb-mi${old ? " is-old" : ""}" data-dk="${esc(d.id)}">
      <div class="dkb-mt">${title}${d.ssi ? '<span class="dk-ssi" title="민감보안정보">SSI</span>' : ""}${canW ? `<button type="button" class="mt-btn dk-edit m-ed" data-dk-edit="${esc(d.id)}" aria-label="문서 수정">${icon("notes", 15)}</button>` : ""}</div>
      <div class="bb-ms">${bits.join(" · ")}</div>
      ${oldN ? `<button type="button" class="link-btn dkb-ob" data-dkb-old="${esc(k)}" aria-expanded="${on}">이전 판 ${oldN}</button>` : ""}
    </div>`;
  }
  function pagerHTML(total, page, sz) {
    const last = Math.max(1, Math.ceil(total / sz));
    if (last <= 1) return "";
    const b0 = Math.floor((page - 1) / 10) * 10 + 1, b1 = Math.min(last, b0 + 9);
    const btn = (p, lbl, aria, dis, cur) => `<button type="button" class="bb-pg${cur ? " on" : ""}" data-dkb-pg="${p}"${dis ? " disabled" : ""}${cur ? ' aria-current="page"' : ""} aria-label="${esc(aria)}">${lbl}</button>`;
    let h = btn(1, "«", "첫 쪽", page === 1) + btn(Math.max(1, b0 - 1), "‹", "앞 10쪽", b0 === 1);
    for (let p = b0; p <= b1; p++) h += btn(p, String(p), p + " 쪽", false, p === page);
    h += btn(Math.min(last, b1 + 1), "›", "다음 10쪽", b1 === last) + btn(last, "»", "끝 쪽", page === last);
    return `<nav class="bb-pager" aria-label="쪽 이동">${h}<span class="bb-pgi mono">${page} / ${last}</span></nav>`;
  }
  let printing = false;
  function boardBodyHTML(mod, canW, all) {
    const s = stOf(mod), ts = termsOf(s.q);
    all = all || printing;
    if (s.cat && !list(mod, s.cat).length) s.cat = "";
    const rows = rowsOf(mod).filter(r => serHit(r, ts) && (!s.cat || (r.cur.grp || "") === s.cat));
    const last = Math.max(1, Math.ceil(rows.length / s.size));
    s.page = Math.min(last, Math.max(1, s.page || 1));
    const pg = all ? rows : rows.slice((s.page - 1) * s.size, s.page * s.size);
    const on = (r) => !!open[(r.cur.grp || "") + "|" + serOf(r.cur)] || oldHit(r, ts);
    const mob = SeMIS.isMobile();
    let body;
    if (!rows.length) body = ui.empty(ts.length || s.cat ? "조건에 맞는 문서가 없습니다." : "등록된 문서가 없습니다.");
    else if (mob) body = `<div class="dkb-mlist">${pg.map(r => miHTML(mod, r.cur, canW, ts, r.old.length, on(r), false)
      + (r.old.length && on(r) ? `<div class="dkb-molds">${r.old.map(d => miHTML(mod, d, canW, ts, 0, false, true)).join("")}</div>` : "")).join("")}</div>`;
    else body = `<div class="table-wrap"><table class="tbl bb-tbl dkb-tbl tbl-keep" data-no-stack>
        <colgroup><col class="c-no"><col class="c-cat"><col><col class="c-file"><col class="c-at">${canW ? '<col class="c-act">' : ""}</colgroup>
        <thead><tr><th class="bb-no">번호</th><th>분류</th><th>문서명</th><th>첨부파일</th><th class="bb-at">날짜</th>${canW ? '<th class="dkb-act"><span class="sr-only">수정</span></th>' : ""}</tr></thead>
        <tbody>${pg.map(r => trHTML(mod, r.cur, r.no, canW, ts, r.old.length, on(r))
          + (r.old.length && on(r) ? r.old.map(d => trHTML(mod, d, null, canW, ts, 0, false)).join("") : "")).join("")}</tbody></table></div>`;
    return `<div class="bb-meta">
        <span>${s.cat ? esc(shortOf(mod, s.cat)) + " " : "전체 "}<b class="mono">${rows.length}</b>건${s.q ? ` · <q>${esc(s.q)}</q> 검색` : ""}</span>
        ${s.q && !s.ext ? '<button type="button" class="link-btn" data-dkb-clear>검색 해제</button>' : ""}
        <span class="spacer"></span>
        ${rows.length > SIZES[0] ? `<select class="bb-size m-hide" data-dkb-size aria-label="쪽당 문서 수">${SIZES.map(n => `<option value="${n}"${n === s.size ? " selected" : ""}>${n}개씩</option>`).join("")}</select>` : ""}
      </div>${body}${all ? "" : pagerHTML(rows.length, s.page, s.size)}`;
  }
  function boardHTML(mod, canW) {
    const s = stOf(mod);
    return `<div class="dkb" data-dkb="${esc(mod)}" data-dkb-w="${canW ? 1 : 0}">
      <div class="bb-bar dkb-bar">
        <div class="bb-cats" role="group" aria-label="분류" data-dkb-cats>${catsHTML(mod)}</div>
        ${s.ext ? "" : `<div class="bb-search dkb-search" role="search" aria-label="문서 검색">${ui.search("dkb-q-" + mod, "문서명 · 파일명 검색", s.q)}</div>`}
      </div>
      <div class="dkb-body" data-dkb-body>${boardBodyHTML(mod, canW)}</div>
    </div>`;
  }
  function wireBoard(el) {
    const mod = el.dataset.dkb, s = stOf(mod), canW = el.dataset.dkbW === "1";
    const cats = $("[data-dkb-cats]", el), body = $("[data-dkb-body]", el);
    if (!cats || !body) return;
    const paint = (top, all) => {
      cats.innerHTML = catsHTML(mod);
      body.innerHTML = boardBodyHTML(mod, canW, all);
      inner();
      if (top) try { if (el.getBoundingClientRect().top < 0 && el.scrollIntoView) el.scrollIntoView({ block: "start" }); } catch (e) { /* 스크롤 실패 무시 */ }
    };
    function inner() {
      $$("[data-dkb-cat]", cats).forEach(b => b.onclick = () => { s.cat = b.dataset.dkbCat; s.page = 1; paint(); });
      $$("[data-dkb-pg]", body).forEach(b => b.onclick = () => { s.page = Number(b.dataset.dkbPg); paint(true); });
      $$("[data-dkb-old]", body).forEach(b => b.onclick = () => { const k = b.dataset.dkbOld; open[k] = !open[k]; paint(); });
      $$("[data-dk-edit]", body).forEach(b => b.onclick = () => form(b.dataset.dkEdit));
      const sz = $("[data-dkb-size]", body);
      if (sz) sz.onchange = () => { s.size = Number(sz.value) || 20; s.page = 1; paint(); };
      const cl = $("[data-dkb-clear]", body);
      if (cl) cl.onclick = () => { s.q = ""; s.page = 1; if (qi) qi.value = ""; paint(); };
    }
    /* 검색칸은 다시 그리지 않는다(한글 조합 보호) — 분류 탭 · 목록만 바꾼다 */
    const qi = $("#dkb-q-" + (window.CSS && CSS.escape ? CSS.escape(mod) : mod), el);
    if (qi) qi.oninput = () => { const v = ui.searchValue(qi.value); if (v === s.q) return; s.q = v; s.page = 1; paint(); };
    el._dkbPaint = paint;
    inner();
  }
  /* A4 인쇄는 쪽 나누기 없이 지금 조건(분류 · 검색어)에 맞는 문서 전부 */
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("beforeprint", () => { printing = true; $$("[data-dkb]").forEach(el => { if (el._dkbPaint) el._dkbPaint(false, true); }); });
    window.addEventListener("afterprint", () => { printing = false; $$("[data-dkb]").forEach(el => { if (el._dkbPaint) el._dkbPaint(false, false); }); });
  }

  /* 화면 전체 문서 — 많으면 게시판형, 적으면 묶음형. opts.q 가 있으면 그 검색어로 거른다 */
  function groupsHTML(mod, opts) {
    opts = opts || {};
    const s = stOf(mod);
    if (opts.q !== undefined) {
      const v = SeMIS.ui.searchValue(opts.q);
      if (v !== s.q) { s.q = v; s.page = 1; }
      s.ext = true;
    }
    const canW = opts.canEdit === undefined ? SeMIS.canEdit() : !!opts.canEdit;
    const top = canW && !opts.noAdd ? `<div class="dk-top">${addBtn(mod, opts.only && opts.only.length === 1 ? opts.only[0] : "")}</div>` : "";
    if (!opts.only && isBoard(mod)) return top + boardHTML(mod, canW);
    const ts = termsOf(s.q);
    const shown = grpIds(mod, opts.only).filter(g => series(mod, g).some(x => serHit(x, ts)));
    const qbar = s.q && !s.ext ? `<div class="bb-meta dk-qbar"><span><q>${esc(s.q)}</q> 검색 · <b class="mono">${shown.reduce((n, g) => n + series(mod, g).filter(x => serHit(x, ts)).length, 0)}</b>건</span><button type="button" class="link-btn" data-dk-qclear="${esc(mod)}">검색 해제</button></div>` : "";
    if (!shown.length) return top + qbar + ui.empty(ts.length && list(mod).length ? "조건에 맞는 문서가 없습니다." : "등록된 문서가 없습니다.");
    return top + qbar + `<div class="dk-grps">${shown.map(g => {
      const n = ts.length ? series(mod, g).filter(x => serHit(x, ts)).length : list(mod, g).length;
      return `<div class="dk-grp"><div class="dk-gh"><h4>${esc(labelOf(mod, g))}</h4><span class="dk-n mono">${n}</span></div>${shelf(mod, g, { canEdit: canW, emptyText: "문서 없음", ts })}</div>`;
    }).join("")}</div>`;
  }
  function card(mod, opts) {
    opts = opts || {};
    const canW = opts.canEdit === undefined ? SeMIS.canEdit() : !!opts.canEdit;
    const body = groupsHTML(mod, Object.assign({}, opts, { noAdd: true }));
    return `<section class="card dk-card" data-dk-card="${esc(mod)}"><div class="card-title">${icon("folder", 18)}<span>${esc(opts.title || "관련 문서")}</span>${canW ? `<span class="spacer"></span>${addBtn(mod, "")}` : ""}</div><div class="dk-cbody" data-dk-body="${esc(mod)}">${body}</div></section>`;
  }
  /* 화면 검색칸이 바뀌었을 때 카드 본문만 다시 그린다(검색칸은 카드 밖이라 그대로) */
  function refresh(scope, mod, opts) {
    const box = scope ? $(`[data-dk-body="${(window.CSS && CSS.escape ? CSS.escape(mod) : mod)}"]`, scope) : null;
    if (!box) return false;
    box.innerHTML = groupsHTML(mod, Object.assign({}, opts || {}, { noAdd: true }));
    wire(box);
    return true;
  }
  /* 검색어에 걸리는 줄 수(판 묶음 단위) */
  function count(mod, q) { const ts = termsOf(q); return (isBoard(mod) ? rowsOf(mod) : grpIds(mod).reduce((a, g) => a.concat(series(mod, g)), [])).filter(r => serHit(r, ts)).length; }

  let onChange = null;
  function wire(box, after) {
    if (!box) return;
    onChange = after || onChange;
    $$("[data-dkb]", box).forEach(wireBoard);
    $$("[data-dk-old]", box).forEach(b => b.onclick = () => { const k = b.dataset.dkOld; open[k] = !open[k]; repaint(); });
    $$("[data-dk-edit]", box).forEach(b => b.onclick = () => form(b.dataset.dkEdit));
    $$("[data-dk-add]", box).forEach(b => b.onclick = () => { const [m, g] = b.dataset.dkAdd.split("|"); form("", { mod: m, grp: g }); });
    $$("[data-dk-qclear]", box).forEach(b => b.onclick = () => { stOf(b.dataset.dkQclear).q = ""; repaint(); });
  }
  function repaint() {
    if (typeof onChange === "function") { try { onChange(); return; } catch (e) { /* 실패 시 화면 전체 다시 그리기 */ } }
    if (SeMIS.renderView) SeMIS.renderView();
  }

  async function uploadInto(files, fileList, ssi, done) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of arr) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("업로드 중: " + file.name);
      try {
        const up = await SemisSync.uploadFile(file, ssi ? "docs-ssi" : "docs");
        files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url });
      } catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }

  function form(id, preset) {
    if (!SeMIS.canEdit()) return;
    const d = id ? all().find(x => x && x.id === id) : null;
    if (id && !d) return;
    const v = Object.assign({ mod: "", grp: "", title: "", date: new Date().toISOString().slice(0, 10), ser: "", org: "", note: "", ssi: false, files: [] }, preset || {}, d || {});
    const files = (v.files || []).map(f => Object.assign({}, f));
    const gs = groupsOf(v.mod);
    const sers = Array.from(new Set(list(v.mod).filter(x => x.ser).map(x => x.ser)));
    const chips = () => files.map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name)}</span></a><button type="button" class="mt-btn danger" data-dkf="${i}" aria-label="첨부 삭제">${icon("x", 14)}</button></span>`).join("");
    openModal(`<h3>${d ? "문서 수정" : "문서 추가"}</h3>
      <div class="form-row"><label for="dk-title">문서 이름</label><input id="dk-title" value="${esc(v.title)}" maxlength="160" autocomplete="off"></div>
      <div class="form-grid">
        <div class="form-row"><label for="dk-grp">묶음</label><select id="dk-grp">${(gs.length ? gs : [{ id: v.grp, label: labelOf(v.mod, v.grp) }]).map(g => `<option value="${esc(g.id)}" ${g.id === v.grp ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></div>
        <div class="form-row"><label for="dk-date">문서 날짜</label><input id="dk-date" type="date" value="${esc(isISO(v.date) ? v.date : "")}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="dk-org">기관 · 업체</label><input id="dk-org" value="${esc(v.org)}" maxlength="60" autocomplete="off"></div>
        <div class="form-row"><label for="dk-ser">판 묶음 ${ui.tip("같은 문서의 개정판 · 연도별 판을 한 줄로 묶는 이름입니다. 같은 이름의 문서는 최신 판만 보이고 나머지는 '이전 판'으로 접힙니다.", "판 묶음 설명")}</label>
          <input id="dk-ser" value="${esc(v.ser)}" maxlength="60" autocomplete="off" list="dk-sers"><datalist id="dk-sers">${sers.map(s => `<option value="${esc(s)}">`).join("")}</datalist></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label for="dk-note">비고</label><input id="dk-note" value="${esc(v.note)}" maxlength="200" autocomplete="off"></div>
        <div class="form-row"><label for="dk-mids">체크리스트 번호 ${ui.tip("수검 대응 센터 점검 체크리스트에서 이 문서를 증빙으로 보여 줄 항목 번호입니다. 쉼표로 여러 개.", "체크리스트 번호 설명")}</label><input id="dk-mids" value="${esc(midsOf(v).join(", "))}" maxlength="80" autocomplete="off" placeholder="예: 2.7, 4.2"></div>
      </div>
      <label class="au-opt"><input type="checkbox" id="dk-ssi" ${v.ssi ? "checked" : ""}> 민감보안정보 (안전보안파트 이상 열람)</label>
      <div class="form-row"><label>파일</label><div class="au-files au-files-edit" id="dk-files">${chips()}</div>
        <input type="file" id="dk-file" multiple hidden>
        <button type="button" class="btn btn-ghost btn-sm" id="dk-fbtn">${icon("link", 15)}<span>파일 첨부</span></button></div>
      <div class="modal-actions">
        ${d ? '<button type="button" class="link-btn danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`, { wide: true });
    const paint = () => {
      const box = $("#dk-files");
      if (!box) return;
      box.innerHTML = chips();
      $$("[data-dkf]", box).forEach(b => b.onclick = () => { files.splice(Number(b.dataset.dkf), 1); paint(); });
    };
    paint();
    $("#dk-fbtn").onclick = () => $("#dk-file").click();
    $("#dk-file").onchange = () => { const fl = Array.from($("#dk-file").files || []); $("#dk-file").value = ""; uploadInto(files, fl, $("#dk-ssi").checked, paint); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal("이 문서를 목록에서 삭제할까요? (원본 파일은 저장소에 남습니다)", () => {
      D().docs = all().filter(x => x !== d);
      SeMIS.save(); toast("삭제했습니다."); repaint();
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const title = norm($("#dk-title").value);
      if (!title) { toast("문서 이름을 입력하세요.", true); $("#dk-title").focus(); return; }
      const rec = { mod: v.mod, grp: $("#dk-grp").value, title, date: $("#dk-date").value || "", ser: norm($("#dk-ser").value),
        org: norm($("#dk-org").value), note: norm($("#dk-note").value), ssi: !!$("#dk-ssi").checked, files: files.slice(), at: new Date().toISOString(), by: me(),
        mids: String($("#dk-mids").value || "").split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d+(\.\d+)*$/.test(x)) };
      if (!Array.isArray(D().docs)) D().docs = [];
      if (d) Object.assign(d, rec); else D().docs.push(Object.assign({ id: uid() }, rec));
      SeMIS.save(); closeModal(); toast("저장했습니다."); repaint();
    };
  }

  const modVisible = (mod) => {
    const mn = SeMIS.menuForModule ? SeMIS.menuForModule(mod) : null;
    if (!mn || !(SeMIS.hasModule && SeMIS.hasModule(mod))) return false;
    return SeMIS.navVisible ? SeMIS.navVisible(mn) : SeMIS.canSee(mn);
  };
  /* 검색 결과로 갈 때 — 문서가 있는 탭으로 바꾸고 그 화면 문서 목록을 검색어로 거른다 */
  function pickTo(mod, q) {
    const o = OPTS[mod] || {};
    if (o.tab && window.SemisDeep && typeof SemisDeep[mod] === "function") { try { SemisDeep[mod](o.tab); } catch (e) { /* 탭만 영향 */ } }
    setQuery(mod, q);
    if (typeof o.pick === "function") { try { o.pick(stOf(mod).q); } catch (e) { /* 화면 검색어 지정 실패는 이동만 */ } }
    if (typeof location !== "undefined" && location.hash === "#/" + mod) setTimeout(() => SeMIS.renderView(), 0);
  }
  /* 이 파일은 search.js 보다 먼저 읽힌다 → search.js 가 읽힐 때 대기열(__semisSearchQ)을 등록한다 */
  const searchProvider = {
    id: "docs", group: "관련 문서", ico: "folder", minRank: 2,
    items: () => all().filter(d => d && d.mod && modVisible(d.mod) && (!d.ssi || SeMIS.roleRank() >= 3)).map(d => {
      const fn = (d.files || []).map(f => f && f.name).filter(Boolean);
      return {
        title: d.title, sub: [labelOf(d.mod, d.grp), dot(d.date), d.org].concat(fn).filter(Boolean).join(" · "),
        text: [d.title, d.org, d.note, d.ser, labelOf(d.mod, d.grp), d.date, dot(d.date), d.ssi ? "" : d.sum].concat(fn), route: d.mod,
        pick: (q) => pickTo(d.mod, q) };
    })
  };
  if (window.SemisSearch) SemisSearch.register(searchProvider);
  else (window.__semisSearchQ = window.__semisSearchQ || []).push(searchProvider);

  window.SemisDocs = { define, groupsOf, labelOf, shortOf, list, series, latest, forMid, midsOf, evid, shelf, groupsHTML, card, refresh, count, wire, form, daysAgo,
    setQuery, getQuery: (mod) => stOf(mod).q, isBoard, BOARD_MIN, hits: (d, q) => hits(d, termsOf(q)), pickTo };
})();
