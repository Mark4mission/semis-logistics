/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 업무 연락처 (v1.18)
   현장·협력사·유관기관 업무용 연락처를 구역(색)별로 한 화면에 모은다.
   보기 3가지: 구역별(카드) · 빠른 연락(전화 · 문자 · 메일 큰 버튼) · 표(전체 항목)
   전화는 tel:, 문자는 sms:, 메일은 mailto:, 내선은 누르면 복사. 구역 전체 메일 작성.
   원문이 불확실한 항목은 '확인 필요'(메모) 표시 → 필터로 모아 보고 고친다.
   hq: 연락처 추가 · 수정 · 삭제 · 구역 관리(이름 · 색 · 순서) · 기본 정보

   데이터: DATA.phonebook = { asOf, notes[], groups: [{ id, name, color }],
             rows: [{ id, group, org, dept, name, title, duty, ext, office, mobile, email, note, check, verify }] }
   ※ 연락처는 공개 저장소 코드에 넣지 않는다 — 공용 DB(semis_logi_store "phonebook")에만.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "phonebook", KEY = "phonebook", TITLE = "업무 연락처";
  const uid = (p) => (p || "pb") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  /* 구역 색 — 위기대응 담당자와 같은 계열(표식 · 머리띠에만 사용) */
  const PALETTE = ["#d42a1e", "#1f4fd6", "#0f766e", "#178236", "#9b35c4", "#f58220", "#0369a1", "#a16207", "#d0306a", "#6f4323", "#646b73"];
  const VIEWS = [["group", "구역별"], ["quick", "빠른 연락"], ["table", "표"]];

  const P = () => {
    const v = SeMIS.data[KEY];
    return v && typeof v === "object" && !Array.isArray(v) ? v : { groups: [], rows: [] };
  };
  const rows = () => (Array.isArray(P().rows) ? P().rows : []);
  const groups = () => (Array.isArray(P().groups) ? P().groups : []).filter(g => g && g.id);
  const notes = () => (Array.isArray(P().notes) ? P().notes : []).filter(Boolean);

  /* 화면 상태 (모듈 메모리) */
  let view = "group", grp = "", query = "", onlyCheck = false;

  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const groupOf = (id) => groups().find(g => g.id === id) || null;
  const colorOf = (id) => { const g = groupOf(id); return g && g.color ? g.color : "#646b73"; };
  const label = (r) => r.name || r.dept || r.org || "(이름 없음)";
  const sub = (r) => [r.org, r.dept].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i && v !== label(r)).join(" · ");

  /* ─────── 번호 ─────── */
  function telHref(num) {
    const s = String(num || "").split(/[,/~]/)[0].trim();
    const d = s.replace(/[^\d]/g, "");
    if (!d) return "";
    return /^\+/.test(s) ? "tel:+" + d : "tel:" + d;
  }
  const isMobile = (num) => /^01\d/.test(String(num || "").replace(/[^\d]/g, ""));
  /* 입력값 정리 — 하이픈 없이 적은 번호만 모양을 맞춘다(7자리 = 032 지역번호 보충) */
  function fmtPhone(v) {
    const s = norm(v);
    if (!s || /[^\d\s]/.test(s)) return s;
    const d = s.replace(/\s/g, "");
    if (/^01\d{9}$/.test(d)) return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
    if (/^01\d{8}$/.test(d)) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    if (/^02\d{8}$/.test(d)) return "02-" + d.slice(2, 6) + "-" + d.slice(6);
    if (/^0\d{2}\d{7,8}$/.test(d)) return d.slice(0, 3) + "-" + d.slice(3, d.length - 4) + "-" + d.slice(-4);
    if (/^\d{7}$/.test(d)) return "032-" + d.slice(0, 3) + "-" + d.slice(3);
    if (/^\d{8}$/.test(d)) return d.slice(0, 4) + "-" + d.slice(4);
    return s;
  }

  /* ─────── 검색 ─────── */
  const FIELDS = ["org", "dept", "name", "title", "duty", "ext", "office", "mobile", "email", "note", "verify"];
  function matches(r, q) {
    if (!q) return true;
    const s = q.toLowerCase().replace(/\s+/g, "");
    const g = groupOf(r.group);
    const text = FIELDS.map(k => r[k]).concat(g ? g.name : "").map(v => String(v || "").toLowerCase().replace(/\s+/g, "")).join("|");
    if (text.indexOf(s) >= 0) return true;
    const nd = s.replace(/-/g, "");   // 번호: 하이픈 무시
    return /^\d{3,}$/.test(nd) && text.replace(/-/g, "").indexOf(nd) >= 0;
  }
  const filtered = () => rows().filter(r => (!grp || r.group === grp) && (!onlyCheck || r.check) && matches(r, query));
  function hl(text, q) {
    const e = esc(text);
    if (!q) return e;
    try {
      const re = new RegExp("(" + q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      return e.replace(re, "<mark>$1</mark>");
    } catch (err) { return e; }
  }
  /* 구역 순서대로 · 구역에 없는(삭제된) 구역 id 는 맨 뒤 '미분류' */
  function byGroup(list) {
    const out = groups().map(g => ({ g, rs: list.filter(r => r.group === g.id) }));
    const lost = list.filter(r => !groupOf(r.group));
    if (lost.length) out.push({ g: { id: "", name: "미분류", color: "#646b73" }, rs: lost });
    return out.filter(x => x.rs.length);
  }

  /* ─────── 조각 ─────── */
  const dot = (c) => `<i class="pb-dot" style="--gc:${esc(c)}"></i>`;
  const flag = (r) => r.check ? `<span class="pb-flag" title="${esc(r.verify || "확인 필요")}">${icon("alert", 13)}<span>확인 필요</span></span>` : "";
  function acts(r, q) {
    const out = [];
    if (r.ext) out.push(`<button type="button" class="pb-act is-ext" data-copy="${esc(r.ext)}" title="내선 번호 복사"><span class="pb-k">내선</span><span class="mono">${hl(r.ext, q)}</span></button>`);
    if (r.office) out.push(`<a class="pb-act" href="${esc(telHref(r.office))}" title="전화 걸기">${icon("phone", 14)}<span class="mono">${hl(r.office, q)}</span></a>`);
    if (r.mobile) out.push(`<span class="pb-pair"><a class="pb-act is-mob" href="${esc(telHref(r.mobile))}" title="휴대폰 전화">${icon("phone", 14)}<span class="mono">${hl(r.mobile, q)}</span></a>${isMobile(r.mobile)
      ? `<a class="pb-sms" href="sms:${esc(r.mobile.replace(/[^\d]/g, ""))}" title="문자 보내기">문자</a>` : ""}</span>`);
    if (r.email) out.push(`<span class="pb-pair"><a class="pb-act is-mail" href="mailto:${esc(r.email)}" title="메일 쓰기">${icon("notes", 14)}<span>${hl(r.email, q)}</span></a><button type="button" class="pb-cp" data-copy="${esc(r.email)}" title="주소 복사" aria-label="메일 주소 복사">복사</button></span>`);
    return out.join("");
  }
  const editBtn = (r) => `<button type="button" class="pb-edit" data-edit="${esc(r.id)}" aria-label="${esc(label(r))} 수정">${icon("sliders", 15)}</button>`;

  function rowHTML(r, canWrite) {
    const s = sub(r);
    return `<div class="pb-row${r.check ? " is-check" : ""}" data-row="${esc(r.id)}">
      <div class="pb-who">
        <div class="pb-nm"><b>${hl(label(r), query)}</b>${r.title ? `<span class="pb-title">${hl(r.title, query)}</span>` : ""}${flag(r)}</div>
        ${s || r.duty ? `<div class="pb-meta">${s ? `<span>${hl(s, query)}</span>` : ""}${r.duty ? `<span class="pb-duty">${hl(r.duty, query)}</span>` : ""}</div>` : ""}
        ${r.note ? `<div class="pb-note">${hl(r.note, query)}</div>` : ""}
        ${r.check && r.verify ? `<div class="pb-verify">${icon("info", 13)}<span>${hl(r.verify, query)}</span></div>` : ""}
      </div>
      <div class="pb-acts">${acts(r, query)}</div>
      ${canWrite ? editBtn(r) : ""}
    </div>`;
  }
  function mailAll(rs) {
    const ms = rs.map(r => r.email).filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
    return ms.length > 1 ? `<a class="pb-mailall" href="mailto:${esc(ms.join(","))}" title="이 구역 ${ms.length}명에게 메일">${icon("notes", 14)}<span>전체 메일</span></a>` : "";
  }

  /* ─────── 보기별 본문 ─────── */
  function groupView(list, canWrite) {
    return `<div class="pb-grid">${byGroup(list).map(({ g, rs }) => `<section class="card pb-sec" style="--gc:${esc(g.color || "#646b73")}" data-group="${esc(g.id)}">
      <header class="pb-sechead"><h3>${esc(g.name)}</h3><span class="pb-cnt mono">${rs.length}</span><span class="spacer"></span>${mailAll(rs)}</header>
      <div class="pb-rows">${rs.map(r => rowHTML(r, canWrite)).join("")}</div>
    </section>`).join("")}</div>`;
  }
  function quickView(list) {
    const tile = (r) => {
      const call = r.mobile || r.office;
      return `<article class="pb-tile" style="--gc:${esc(colorOf(r.group))}">
        <div class="pb-tt"><b>${hl(label(r), query)}</b>${r.title ? `<span class="pb-title">${hl(r.title, query)}</span>` : ""}${flag(r)}</div>
        <div class="pb-ts">${hl([sub(r), r.duty].filter(Boolean).join(" · ") || (groupOf(r.group) || {}).name || "", query)}</div>
        <div class="pb-big">
          ${call ? `<a class="pb-b is-call" href="${esc(telHref(call))}" title="${esc(call)}">${icon("phone", 17)}<span>전화</span></a>` : ""}
          ${r.mobile && isMobile(r.mobile) ? `<a class="pb-b" href="sms:${esc(r.mobile.replace(/[^\d]/g, ""))}"><span>문자</span></a>` : ""}
          ${r.email ? `<a class="pb-b" href="mailto:${esc(r.email)}" title="${esc(r.email)}">${icon("notes", 17)}<span>메일</span></a>` : ""}
          ${r.ext ? `<button type="button" class="pb-b is-ext" data-copy="${esc(r.ext)}" title="내선 번호 복사"><span class="pb-k">내선</span><span class="mono">${esc(r.ext)}</span></button>` : ""}
        </div>
      </article>`;
    };
    return byGroup(list).map(({ g, rs }) => `<section class="pb-qsec" style="--gc:${esc(g.color || "#646b73")}">
      <h3 class="pb-qh">${dot(g.color)}${esc(g.name)}<span class="mono">${rs.length}</span></h3>
      <div class="pb-tiles">${rs.map(tile).join("")}</div></section>`).join("");
  }
  function tableView(list, canWrite) {
    const tel = (n) => n ? `<a href="${esc(telHref(n))}" class="mono">${hl(n, query)}</a>` : "";
    const cols = canWrite ? 9 : 8;
    return `<section class="card pb-tcard"><div class="table-wrap"><table class="pb-tbl">
      <thead><tr><th>이름 · 직책</th><th>소속 · 부서</th><th>담당 · 관계</th><th>내선</th><th>유선</th><th>휴대폰</th><th>이메일</th><th>비고</th>${canWrite ? "<th></th>" : ""}</tr></thead>
      ${byGroup(list).map(({ g, rs }) => `<tbody style="--gc:${esc(g.color || "#646b73")}">
        <tr class="pb-tgrp"><th colspan="${cols}" scope="colgroup">${dot(g.color)}${esc(g.name)}<span class="mono">${rs.length}</span></th></tr>
        ${rs.map(r => `<tr class="${r.check ? "is-check" : ""}">
        <td class="pb-tn"><b>${hl(r.name || r.dept || r.org || "", query)}</b>${r.title ? ` <span class="pb-title">${hl(r.title, query)}</span>` : ""}${flag(r)}</td>
        <td>${hl([r.org, r.dept].filter(Boolean).filter(v => v !== (r.name || r.dept || r.org)).join(" · "), query)}</td>
        <td>${hl(r.duty || "", query)}</td>
        <td>${r.ext ? `<button type="button" class="pb-link mono" data-copy="${esc(r.ext)}" title="복사">${hl(r.ext, query)}</button>` : ""}</td>
        <td>${tel(r.office)}</td><td>${tel(r.mobile)}</td>
        <td>${r.email ? `<a href="mailto:${esc(r.email)}">${hl(r.email, query)}</a>` : ""}</td>
        <td class="pb-tnote">${hl([r.note, r.check ? r.verify : ""].filter(Boolean).join(" / "), query)}</td>
        ${canWrite ? `<td>${editBtn(r)}</td>` : ""}</tr>`).join("")}</tbody>`).join("")}
      </table></div></section>`;
  }

  function notesHTML() {
    const ns = notes();
    if (!ns.length) return "";
    return `<section class="card pb-notes"><h3>참고</h3><ul>${ns.map(n => `<li>${esc(n)}</li>`).join("")}</ul></section>`;
  }

  /* ─────── 렌더 ─────── */
  function render(root) {
    const all = rows();
    const canWrite = SeMIS.canEdit();
    const p = P();
    const actions = canWrite ? [
      all.length || groups().length ? `<button type="button" class="btn btn-ghost btn-sm" id="pb-groups">${icon("palette", 16)}<span>구역 관리</span></button>` : "",
      `<button type="button" class="btn btn-ghost btn-sm" id="pb-meta">${icon("sliders", 16)}<span>기본 정보</span></button>`,
      `<button type="button" class="btn btn-primary btn-sm" id="pb-add">${icon("plus", 16)}<span>추가</span></button>`
    ].join("") : "";
    const head = ui.head({ title: TITLE, meta: p.asOf ? "기준 " + p.asOf : "", desc: "현장 · 협력사 · 유관기관 업무 연락처", actions });
    if (!all.length) {
      root.innerHTML = head + `<section class="card">${ui.empty("등록된 연락처가 없습니다.")}</section>`;
      wire(root, canWrite);
      return;
    }
    if (grp && !groupOf(grp)) grp = "";
    const checks = all.filter(r => r.check).length;
    root.innerHTML = head +
      ui.stats([
        { label: "연락처", value: all.length },
        { label: "구역", value: byGroup(all).length },
        { label: "휴대폰 · 이메일", value: all.filter(r => r.mobile).length + " · " + all.filter(r => r.email).length },
        { label: "확인 필요", value: checks, tone: checks ? "warn" : "ok" }
      ]) + `<div id="pb-main">${mainHTML(canWrite)}</div>` + notesHTML();
    wire(root, canWrite);
  }
  /* 구역 줄 · 검색/보기 줄 · 본문 — 검색어 입력 때는 이 부분만 다시 그린다(입력칸은 유지) */
  function mainHTML(canWrite) {
    const all = rows();
    const list = filtered();
    const checks = all.filter(r => r.check).length;
    const strip = `<div class="pb-groups" role="group" aria-label="구역">
      <button type="button" class="pb-gbtn" data-grp="" aria-pressed="${!grp}"><span class="n">전체</span><span class="c mono">${all.length}</span></button>
      ${byGroup(all).map(({ g, rs }) => `<button type="button" class="pb-gbtn" data-grp="${esc(g.id)}" aria-pressed="${grp === g.id}" style="--gc:${esc(g.color || "#646b73")}">${dot(g.color)}<span class="n">${esc(g.name)}</span><span class="c mono">${rs.length}</span></button>`).join("")}
    </div>`;
    const narrowed = !!(grp || query || onlyCheck);
    const toolbar = `<div class="pb-bar">
      ${ui.search("pb-q", "이름 · 소속 · 번호 · 메일 검색", query)}
      <div class="seg" role="group" aria-label="보기">${VIEWS.map(([v, lb]) =>
        `<button type="button" class="seg-btn" data-view="${v}" aria-pressed="${view === v}">${lb}</button>`).join("")}</div>
      ${checks ? `<button type="button" class="pb-chk" id="pb-only" aria-pressed="${onlyCheck}">${icon("alert", 14)}<span>확인 필요 <b class="mono">${checks}</b></span></button>` : ""}
      ${narrowed ? `<span class="pb-result"><b class="mono">${list.length}</b> / ${all.length}<button type="button" class="pb-clear" id="pb-clear">조건 해제</button></span>` : ""}
    </div>`;
    const body = !list.length ? `<section class="card">${ui.empty("조건에 맞는 연락처가 없습니다.")}</section>`
      : view === "quick" ? quickView(list)
      : view === "table" ? tableView(list, canWrite)
      : groupView(list, canWrite);
    return strip + toolbar + `<div id="pb-body" data-mode="${esc(view)}">${body}</div>`;
  }

  function rerender() { SeMIS.renderView(); }
  function wire(root, canWrite) {
    const qi = $("#pb-q", root);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === query) return;
      query = v;
      const main = $("#pb-main");
      if (main) { ui.repaintKeep(main, mainHTML(canWrite), qi); wire(main, canWrite); }
      else rerender();
    };
    $$(".seg-btn[data-view]", root).forEach(b => b.onclick = () => { view = b.dataset.view; rerender(); });
    $$(".pb-gbtn", root).forEach(b => b.onclick = () => { grp = b.dataset.grp === grp ? "" : b.dataset.grp; rerender(); });
    const only = $("#pb-only", root); if (only) only.onclick = () => { onlyCheck = !onlyCheck; rerender(); };
    const clr = $("#pb-clear", root); if (clr) clr.onclick = () => { grp = ""; query = ""; onlyCheck = false; rerender(); };
    $$("[data-copy]", root).forEach(b => b.onclick = (ev) => { ev.preventDefault(); copyText(b.dataset.copy); });
    if (!canWrite) return;
    $$("[data-edit]", root).forEach(b => b.onclick = () => editRow(b.dataset.edit));
    const add = $("#pb-add", root); if (add) add.onclick = () => editRow("");
    const gb = $("#pb-groups", root); if (gb) gb.onclick = editGroups;
    const mt = $("#pb-meta", root); if (mt) mt.onclick = editMeta;
  }

  function copyText(txt) {
    const done = () => toast("복사했습니다: " + txt);
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done();
      } catch (e) { toast("복사하지 못했습니다.", true); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(fallback);
    else fallback();
  }

  /* ─────── 편집 (hq) ─────── */
  function ensureStore() {
    let v = SeMIS.data[KEY];
    if (!v || typeof v !== "object" || Array.isArray(v)) v = SeMIS.data[KEY] = { groups: [], rows: [] };
    if (!Array.isArray(v.groups)) v.groups = [];
    if (!Array.isArray(v.rows)) v.rows = [];
    return v;
  }
  const uniq = (arr) => arr.map(norm).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b, "ko"));
  const datalist = (id, vals) => `<datalist id="${id}">${vals.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;

  function editRow(id) {
    const r = id ? rows().find(x => x.id === id) : null;
    if (id && !r) return;
    if (!groups().length) { toast("먼저 구역을 만드세요.", true); editGroups(); return; }
    const v = r || { group: grp || groups()[0].id };
    const f = (k, lb, html, wide) => `<div class="form-row${wide ? " pb-wide" : ""}"><label for="pb-f-${k}">${lb}</label>${html}</div>`;
    const inp = (k, ph, list, type) => `<input id="pb-f-${k}" value="${esc(v[k] || "")}" autocomplete="off"${ph ? ` placeholder="${esc(ph)}"` : ""}${list ? ` list="${list}"` : ""}${type ? ` type="${type}" inputmode="${type === "email" ? "email" : "tel"}"` : ""}>`;
    openModal(`<h3>${r ? "연락처 수정" : "연락처 추가"}</h3>
      <div class="form-grid">
        ${f("group", "구역", `<select id="pb-f-group">${groups().map(g => `<option value="${esc(g.id)}"${g.id === v.group ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select>`)}
        ${f("org", "소속 기관 · 업체", inp("org", "", "pb-dl-org"))}
        ${f("dept", "부서 · 장소", inp("dept", "", "pb-dl-dept"))}
        ${f("name", "이름", inp("name"))}
        ${f("title", "직위 · 직책", inp("title", "", "pb-dl-title"))}
        ${f("duty", "담당 · 관계", inp("duty"))}
        ${f("ext", "내선", inp("ext", "4자리", "", "tel"))}
        ${f("office", "유선", inp("office", "032-000-0000", "", "tel"))}
        ${f("mobile", "휴대폰", inp("mobile", "010-0000-0000", "", "tel"))}
        ${f("email", "이메일", inp("email", "", "", "email"))}
      </div>
      ${f("note", "비고", `<textarea id="pb-f-note" rows="2">${esc(v.note || "")}</textarea>`)}
      <div class="form-row pb-checkrow"><label class="pb-cb"><input type="checkbox" id="pb-f-check"${v.check ? " checked" : ""}><span>확인 필요</span></label>
        <input id="pb-f-verify" value="${esc(v.verify || "")}" placeholder="무엇을 확인할지" autocomplete="off" aria-label="확인할 내용"></div>
      ${datalist("pb-dl-org", uniq(rows().map(x => x.org)))}${datalist("pb-dl-dept", uniq(rows().map(x => x.dept)))}${datalist("pb-dl-title", uniq(rows().map(x => x.title)))}
      <div class="modal-actions">
        ${r && SeMIS.canDelete() ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`, { wide: true });
    const val = (k) => norm(($("#pb-f-" + k) || {}).value);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`'${label(r)}' 연락처를 삭제합니다.`, () => {
      ensureStore().rows = rows().filter(x => x.id !== r.id);
      SeMIS.save(); rerender(); toast("삭제했습니다.");
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const o = { group: $("#pb-f-group").value, org: val("org"), dept: val("dept"), name: val("name"), title: val("title"), duty: val("duty"),
        ext: val("ext"), office: fmtPhone(val("office")), mobile: fmtPhone(val("mobile")), email: val("email"), note: val("note"),
        check: !!$("#pb-f-check").checked, verify: val("verify") };
      if (!o.name && !o.dept && !o.org) { toast("이름 · 부서 · 소속 중 하나는 입력하세요.", true); return; }
      if (!o.ext && !o.office && !o.mobile && !o.email) { toast("내선 · 유선 · 휴대폰 · 이메일 중 하나는 입력하세요.", true); return; }
      if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) { toast("이메일 형식을 확인하세요.", true); return; }
      if (!o.check) o.verify = "";
      const s = ensureStore();
      if (r) Object.assign(r, o);
      else {
        const nr = Object.assign({ id: uid("pb") }, o);
        let at = -1;
        s.rows.forEach((x, i) => { if (x.group === o.group) at = i; });
        if (at >= 0) s.rows.splice(at + 1, 0, nr); else s.rows.push(nr);
      }
      const saved = r || o;
      if ((grp && grp !== saved.group) || (onlyCheck && !saved.check) || !matches(saved, query)) {
        grp = ""; query = ""; onlyCheck = false;
        toast("저장했습니다. 저장한 연락처가 보이도록 조건을 해제했습니다.");
      } else toast("저장했습니다.");
      closeModal(); SeMIS.save(); rerender();
    };
  }

  /* 구역 관리 — 이름 · 색 · 순서 · 추가 · 삭제(연락처가 없는 구역만) */
  function editGroups() {
    let work = groups().map(g => Object.assign({}, g));
    const count = (id) => rows().filter(r => r.group === id).length;
    const draw = () => {
      const box = $("#pb-glist");
      if (!box) return;
      box.innerHTML = work.map((g, i) => `<div class="pb-grow" data-i="${i}">
        <span class="pb-gsw" style="--gc:${esc(g.color)}"></span>
        <input class="pb-gname" value="${esc(g.name)}" aria-label="구역 이름">
        <select class="pb-gcol" aria-label="색">${PALETTE.map((c, k) => `<option value="${c}"${c === g.color ? " selected" : ""}>색 ${k + 1}</option>`).join("")}</select>
        <span class="pb-gn mono">${count(g.id)}</span>
        <button type="button" class="pb-gmv" data-mv="-1" aria-label="위로"${i === 0 ? " disabled" : ""}>▲</button>
        <button type="button" class="pb-gmv" data-mv="1" aria-label="아래로"${i === work.length - 1 ? " disabled" : ""}>▼</button>
        <button type="button" class="pb-gdel" aria-label="구역 삭제"${count(g.id) ? " disabled title=\"연락처가 있는 구역은 지울 수 없습니다\"" : ""}>${icon("trash", 15)}</button>
      </div>`).join("");
      $$(".pb-grow", box).forEach(el => {
        const i = Number(el.dataset.i);
        $(".pb-gname", el).oninput = (ev) => { work[i].name = ev.target.value; };
        $(".pb-gcol", el).onchange = (ev) => { work[i].color = ev.target.value; draw(); };
        $$(".pb-gmv", el).forEach(b => b.onclick = () => {
          const j = i + Number(b.dataset.mv);
          if (j < 0 || j >= work.length) return;
          const t = work[i]; work[i] = work[j]; work[j] = t; draw();
        });
        $(".pb-gdel", el).onclick = () => { if (count(work[i].id)) return; work.splice(i, 1); draw(); };
      });
    };
    openModal(`<h3>구역 관리</h3>
      <div id="pb-glist" class="pb-glist"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="pb-gadd">${icon("plus", 15)}<span>구역 추가</span></button>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    draw();
    $("#pb-gadd").onclick = () => {
      work.push({ id: uid("g"), name: "새 구역", color: PALETTE[work.length % PALETTE.length] });
      draw();
      const ins = $$("#pb-glist .pb-gname");
      if (ins.length) { ins[ins.length - 1].focus(); ins[ins.length - 1].select(); }
    };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      work.forEach(g => { g.name = norm(g.name); });
      if (work.some(g => !g.name)) { toast("구역 이름을 입력하세요.", true); return; }
      ensureStore().groups = work;
      closeModal(); SeMIS.save(); rerender(); toast("저장했습니다.");
    };
  }

  function editMeta() {
    const p = P();
    openModal(`<h3>기본 정보</h3>
      <div class="form-row"><label for="pb-m-asof">기준 시점</label><input id="pb-m-asof" value="${esc(p.asOf || "")}" placeholder="26년 9월"></div>
      <div class="form-row"><label for="pb-m-notes">참고 사항 ${ui.tip("한 줄에 한 항목. 화면 맨 아래에 표시됩니다.", "참고 사항 설명")}</label>
        <textarea id="pb-m-notes" rows="4">${esc(notes().join("\n"))}</textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const s = ensureStore();
      s.asOf = norm($("#pb-m-asof").value);
      s.notes = String($("#pb-m-notes").value || "").split("\n").map(norm).filter(Boolean);
      closeModal(); SeMIS.save(); rerender(); toast("저장했습니다.");
    };
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "phone", module: MOD,
    items: () => rows().map(r => ({
      title: label(r) + (r.title ? " " + r.title : ""),
      sub: [sub(r), r.mobile || r.office || (r.ext ? "내선 " + r.ext : "") || r.email].filter(Boolean).join(" · "),
      text: FIELDS.map(k => r[k]).filter(Boolean),
      route: MOD,
      pick: () => { view = "group"; grp = ""; onlyCheck = false; query = label(r); if (/^#\/phonebook$/.test(location.hash)) SeMIS.renderView(); }
    }))
  });

  window.SemisPhonebook = {
    matches, fmtPhone, telHref, byGroup,
    getState: () => ({ view, grp, query, onlyCheck }),
    setState: (s) => { if (s.view) view = s.view; if (s.grp != null) grp = s.grp; if (s.query != null) query = s.query; if (s.onlyCheck != null) onlyCheck = !!s.onlyCheck; },
    editRow, editGroups, editMeta
  };
})();
