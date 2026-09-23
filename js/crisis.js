/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 위기대응 담당자 (v1.13)
   회사 위기대응 조직(초동조치센터 등)별 임무와 팀별 담당자(정 · 부)를 한 화면에서 찾는다.
   보기 4가지: 조직별 · 팀별 · 담당자별 · 매트릭스(팀 × 조직). 우리 팀 임무는 맨 위 띠로 고정.
   이름을 누르면 그 사람의 임무 전체, 비상연락망에 같은 이름이 한 명뿐이면 전화 버튼.
   hq: 엑셀(연간 명단 원본) 올려 대조 후 반영 · 행 추가/수정/삭제 · 기본 정보

   데이터: DATA.crisis = { title, asOf, homeTeam, notes[], fileUrl, fileName, updatedAt,
                           rows: [{ id, div, team, org, task, main, sub }] }
   ※ 명단(이름)은 공개 저장소 코드에 넣지 않는다 — 공용 DB(semis_logi_store "crisis")에만.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "crisis", KEY = "crisis", TITLE = "위기대응 담당자";
  const HOME_DEFAULT = "인천화물팀";
  const FILE_MAX = 10 * 1024 * 1024;
  const uid = () => "cr" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const C = () => {
    const v = SeMIS.data[KEY];
    return v && typeof v === "object" && !Array.isArray(v) ? v : { rows: [] };
  };
  const all = () => (Array.isArray(C().rows) ? C().rows : []);
  const notes = () => (Array.isArray(C().notes) ? C().notes : []).filter(Boolean);
  const homeTeam = () => C().homeTeam || HOME_DEFAULT;

  /* 화면 상태 (모듈 메모리) */
  let view = "org", org = "", query = "";

  /* 위기대응 조직 표시 순서 · 표식 색(일정 12색 팔레트 재사용 — 점 표식에만 사용) */
  const ORG_ORDER = ["초동조치센터", "종합지원센터", "언론대응센터", "사고조사센터", "현장사고조사센터", "현장지원센터",
    "현장인적지원센터", "승무원문의센터", "화물문의센터", "보험/보상센터", "기체복구센터"];
  const ORG_COLOR = ["#d42a1e", "#1f4fd6", "#9b35c4", "#6f4323", "#f58220", "#0f766e",
    "#178236", "#d0306a", "#0369a1", "#a16207", "#646b73"];
  const VIEWS = [["org", "조직별"], ["team", "팀별"], ["person", "담당자별"], ["matrix", "매트릭스"]];

  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  /* 사람 이름으로 볼 값인가 — "아래 주) 참조" 같은 안내 문구는 제외 */
  const isPerson = (n) => !!n && !/[\s()（）:：]/.test(n) && n.length <= 10;

  function orgs(list) {
    const seen = [];
    (list || all()).forEach(r => { if (r.org && seen.indexOf(r.org) < 0) seen.push(r.org); });
    return seen.sort((a, b) => rank(a) - rank(b) || seen.indexOf(a) - seen.indexOf(b));
  }
  function rank(o) { const i = ORG_ORDER.indexOf(o); return i < 0 ? 100 : i; }
  function orgColor(o) {
    const i = ORG_ORDER.indexOf(o);
    if (i >= 0) return ORG_COLOR[i];
    const extra = orgs().filter(x => ORG_ORDER.indexOf(x) < 0).indexOf(o);
    return extra >= 0 ? ORG_COLOR[(ORG_ORDER.length + extra) % ORG_COLOR.length] : "#646b73";
  }
  const shortOrg = (o) => String(o || "").replace(/센터$/, "");
  function teamsOf(list) {
    const out = [];
    list.forEach(r => { if (r.team && out.indexOf(r.team) < 0) out.push(r.team); });
    return out;
  }
  function divsOf(list) {
    const out = [];
    list.forEach(r => { const d = r.div || "기타"; if (out.indexOf(d) < 0) out.push(d); });
    return out;
  }

  /* ─────── 검색 ─────── */
  function matches(r, q) {
    if (!q) return true;
    const s = q.toLowerCase().replace(/\s+/g, "");
    return [r.div, r.team, r.org, r.task, r.main, r.sub].some(v => String(v || "").toLowerCase().replace(/\s+/g, "").indexOf(s) >= 0);
  }
  const filtered = () => all().filter(r => (!org || r.org === org) && matches(r, query));
  function hl(text, q) {
    const e = esc(text);
    if (!q) return e;
    try {
      const re = new RegExp("(" + q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      return e.replace(re, "<mark>$1</mark>");
    } catch (err) { return e; }
  }

  /* ─────── 사람 색인 ─────── */
  function people(list) {
    const map = {};
    (list || all()).forEach(r => {
      [["main", r.main], ["sub", r.sub]].forEach(([k, n]) => {
        n = norm(n);
        if (!isPerson(n)) return;
        const p = map[n] || (map[n] = { name: n, main: [], sub: [], teams: [] });
        p[k].push(r);
        if (r.team && p.teams.indexOf(r.team) < 0) p.teams.push(r.team);
      });
    });
    return Object.keys(map).sort((a, b) => a.localeCompare(b, "ko")).map(k => map[k]);
  }
  /* 비상연락망(contacts.sections people)에 같은 이름이 정확히 한 명일 때만 번호를 잇는다 */
  function contactOf(name) {
    const secs = SeMIS.data.contacts && Array.isArray(SeMIS.data.contacts.sections) ? SeMIS.data.contacts.sections : [];
    const hits = [];
    secs.forEach(s => {
      if (s.type !== "people") return;
      (s.rows || []).forEach(r => { if (norm(r.name) === name && (r.mobile || r.office)) hits.push(r); });
    });
    return hits.length === 1 ? hits[0] : null;
  }
  function telHref(num) {
    const d = String(num || "").split(/[,/~]/)[0].replace(/[^\d+]/g, "");
    return d ? "tel:" + d : "";
  }

  /* ─────── 조각 ─────── */
  function personHTML(n, q) {
    n = norm(n);
    if (!n) return '<span class="cr-none">-</span>';
    if (!isPerson(n)) return `<button type="button" class="cr-ref" data-jump="notes">${esc(n)}</button>`;
    const c = contactOf(n);
    const num = c ? (c.mobile || c.office) : "";
    return `<span class="cr-p"><button type="button" class="cr-pn" data-person="${esc(n)}" title="${esc(n)} 임무 전체">${hl(n, q)}</button>${num
      ? `<a class="cr-tel" href="${esc(telHref(num))}" title="${esc(num)}" aria-label="${esc(n)} 전화">${icon("phone", 15)}</a>` : ""}</span>`;
  }
  const dot = (o) => `<i class="cr-dot" style="--oc:${orgColor(o)}"></i>`;
  const orgTag = (o, q) => `<span class="cr-orgtag">${dot(o)}${hl(o, q)}</span>`;
  const editBtn = (r) => `<button type="button" class="cr-edit" data-edit="${esc(r.id)}" aria-label="행 편집">${icon("sliders", 15)}</button>`;

  function lineHTML(r, o) {
    const home = r.team === homeTeam();
    return `<div class="cr-line${home ? " is-home" : ""}" data-row="${esc(r.id)}">
      <div class="cr-task">${o.showOrg ? orgTag(r.org, query) : ""}<span class="cr-tt">${hl(r.task, query)}</span></div>
      <div class="cr-who"><span class="cr-lbl">정</span>${personHTML(r.main, query)}</div>
      <div class="cr-who is-sub"><span class="cr-lbl">부</span>${personHTML(r.sub, query)}</div>
      ${o.canWrite ? editBtn(r) : ""}
    </div>`;
  }
  /* 팀 묶음: 왼쪽 팀명 칸 + 오른쪽 업무 줄 */
  function teamGroups(list, o) {
    return teamsOf(list).map(t => {
      const rs = list.filter(r => r.team === t);
      const home = t === homeTeam();
      return `<div class="cr-tg${home ? " is-home" : ""}">
        <div class="cr-team"><b>${hl(t, query)}</b>${o.showDiv && rs[0].div ? `<small>${hl(rs[0].div, query)}</small>` : ""}</div>
        <div class="cr-lines">${rs.map(r => lineHTML(r, o)).join("")}</div>
      </div>`;
    }).join("");
  }
  const thead = (first, second, canWrite) => `<div class="cr-th${canWrite ? " has-edit" : ""}" aria-hidden="true"><span>${first}</span><span>${second}</span><span>정</span><span>부</span></div>`;

  /* ─────── 보기별 본문 ─────── */
  function orgView(list, canWrite) {
    return orgs(list).map(o => {
      const rs = list.filter(r => r.org === o);
      return `<section class="card cr-sec" data-org="${esc(o)}">
        <header class="cr-sechead">${dot(o)}<h3>${esc(o)}</h3><span class="cr-cnt">팀 <b class="mono">${teamsOf(rs).length}</b> · 임무 <b class="mono">${rs.length}</b></span></header>
        <div class="cr-tbl${canWrite ? " has-edit" : ""}">${thead("팀", "위기대응 업무", canWrite)}${teamGroups(rs, { showDiv: true, canWrite })}</div>
      </section>`;
    }).join("");
  }
  function teamView(list, canWrite) {
    return divsOf(list).map(d => {
      const rs = list.filter(r => (r.div || "기타") === d);
      return `<section class="card cr-sec">
        <header class="cr-sechead"><h3>${esc(d)}</h3><span class="cr-cnt">팀 <b class="mono">${teamsOf(rs).length}</b> · 임무 <b class="mono">${rs.length}</b></span></header>
        <div class="cr-tbl${canWrite ? " has-edit" : ""}">${thead("팀", "위기대응 조직 · 업무", canWrite)}${teamGroups(rs, { showOrg: true, canWrite })}</div>
      </section>`;
    }).join("");
  }
  function personView(list) {
    // 검색어가 사람 이름에 걸리면 그 사람만, 아니면 걸린 임무의 담당자 전원
    const all0 = people(list);
    const qs = norm(query).replace(/\s+/g, "");
    const byName = qs ? all0.filter(p => p.name.indexOf(qs) >= 0) : [];
    const ps = byName.length ? byName : all0;
    if (!ps.length) return "";
    const item = (p) => {
      const c = contactOf(p.name);
      const num = c ? (c.mobile || c.office) : "";
      const home = p.teams.indexOf(homeTeam()) >= 0;
      const tasks = p.main.map(r => ["정", r]).concat(p.sub.map(r => ["부", r]));
      return `<article class="cr-person${home ? " is-home" : ""}">
        <header>
          <b class="cr-pname">${hl(p.name, query)}</b>
          ${num ? `<a class="cr-ptel" href="${esc(telHref(num))}">${icon("phone", 15)}<span class="mono">${esc(num)}</span></a>` : ""}
          <span class="cr-pteams">${p.teams.map(t => hl(t, query)).join(" · ")}</span>
        </header>
        <ul>${tasks.map(([k, r]) => `<li><span class="cr-role${k === "부" ? " is-sub" : ""}">${k}</span>
          <span class="cr-ptask">${orgTag(r.org, query)}<span>${hl(r.task, query)}</span></span></li>`).join("")}</ul>
      </article>`;
    };
    return `<section class="card cr-sec"><div class="cr-people">${ps.map(item).join("")}</div></section>`;
  }
  function matrixView(list) {
    const os = orgs(all());
    const max = Math.max(1, ...teamsOf(list).map(t => Math.max(...os.map(o => list.filter(r => r.team === t && r.org === o).length))));
    const body = divsOf(list).map(d => {
      const rs = list.filter(r => (r.div || "기타") === d);
      return `<tr class="cr-mxdiv"><th colspan="${os.length + 2}" scope="colgroup">${esc(d)}</th></tr>` +
        teamsOf(rs).map(t => {
          const tr = rs.filter(r => r.team === t);
          return `<tr${t === homeTeam() ? ' class="is-home"' : ""}><th scope="row">${esc(t)}</th>${os.map(o => {
            const n = tr.filter(r => r.org === o).length;
            const a = 0.16 + 0.7 * n / max;
            return n ? `<td><button type="button" class="cr-mx${a > 0.5 ? " is-strong" : ""}" data-mx-team="${esc(t)}" data-mx-org="${esc(o)}" style="--a:${a.toFixed(2)}" aria-label="${esc(t)} · ${esc(o)} ${n}건">${n}</button></td>` : "<td></td>";
          }).join("")}<td class="cr-mxsum mono">${tr.length}</td></tr>`;
        }).join("");
    }).join("");
    return `<section class="card cr-sec"><div class="table-wrap"><table class="cr-mxt">
      <thead><tr><th scope="col">팀</th>${os.map(o => `<th scope="col"><span class="cr-mxh">${dot(o)}${esc(shortOrg(o))}</span></th>`).join("")}<th scope="col">계</th></tr></thead>
      <tbody>${body}</tbody></table></div></section>`;
  }

  /* ─────── 우리 팀 띠 ─────── */
  function homeBand() {
    const t = homeTeam();
    const rs = all().filter(r => r.team === t);
    if (!rs.length) return "";
    const pair = (r) => norm(r.main) + "|" + norm(r.sub);
    const same = rs.every(r => pair(r) === pair(rs[0]));
    const os = orgs(rs);
    const whoBlock = (r) => `<div class="cr-hw"><span class="cr-hk">정</span>${personHTML(r.main, "")}</div>
      <div class="cr-hw"><span class="cr-hk">부</span>${personHTML(r.sub, "")}</div>`;
    return `<section class="cr-home" aria-label="${esc(t)} 위기대응 임무">
      <div class="cr-home-main">
        <div class="cr-home-top"><h2>${esc(t)}</h2>${os.map(o => `<span class="cr-home-org">${dot(o)}${esc(o)}</span>`).join("")}</div>
        <ul class="cr-home-list">${rs.map(r => `<li><span>${esc(r.task)}</span>${same ? "" : `<span class="cr-home-pair">${whoBlock(r)}</span>`}</li>`).join("")}</ul>
      </div>
      ${same ? `<div class="cr-home-side">${whoBlock(rs[0])}</div>` : ""}
    </section>`;
  }

  function notesHTML() {
    const ns = notes();
    if (!ns.length) return "";
    const link = (s) => esc(s).replace(/(\d{2,3}-\d{3,4}-\d{4})/g, (m) => `<a href="tel:${m.replace(/\D/g, "")}">${m}</a>`);
    return `<section class="card cr-notes" id="cr-notes"><h3>참고</h3><ol>${ns.map(n => `<li>${link(n)}</li>`).join("")}</ol></section>`;
  }

  /* ─────── 렌더 ─────── */
  function render(root) {
    const rows = all();
    const canWrite = SeMIS.canEdit();
    const c = C();
    const actions = [
      c.fileUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(c.fileUrl)}${c.fileUrl.indexOf("?") < 0 ? "?download=" + encodeURIComponent(c.fileName || "위기대응담당자.xlsx") : ""}" id="cr-file">${icon("down", 16)}<span>원본</span></a>` : "",
      canWrite ? `<button type="button" class="btn btn-ghost btn-sm" id="cr-import">${icon("doc", 16)}<span>엑셀 반영</span></button>` : "",
      canWrite && rows.length ? `<button type="button" class="btn btn-ghost btn-sm" id="cr-meta">${icon("sliders", 16)}<span>기본 정보</span></button>` : "",
      canWrite ? `<button type="button" class="btn btn-primary btn-sm" id="cr-add">${icon("plus", 16)}<span>추가</span></button>` : "",
      canWrite ? `<input type="file" id="cr-xlsx" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>` : ""
    ].join("");
    const head = ui.head({
      title: TITLE,
      meta: c.asOf ? "기준 " + c.asOf : "",
      desc: c.title || "위기 상황 시 위기대응 조직별 임무와 담당자(정 · 부)",
      actions
    });
    if (!rows.length) {
      root.innerHTML = head + `<section class="card">${ui.empty(canWrite ? "등록된 명단이 없습니다. 연간 위기대응 담당자 엑셀을 올려 주세요." : "등록된 명단이 없습니다.")}</section>`;
      wire(root, canWrite);
      return;
    }
    if (org && !rows.some(r => r.org === org)) org = "";
    const ps = people(rows);
    root.innerHTML = head + homeBand() +
      ui.stats([
        { label: "위기대응 조직", value: orgs(rows).length },
        { label: "참여 팀", value: teamsOf(rows).length },
        { label: "임무", value: rows.length },
        { label: "담당자", value: ps.length, sub: "정 · 부 합산 인원" }
      ]) + `<div id="cr-main">${mainHTML(canWrite)}</div>` + notesHTML();
    wire(root, canWrite);
  }
  /* 조직 줄 · 검색/보기 줄 · 본문 — 검색어 입력 때는 이 부분만 다시 그린다(입력칸은 유지) */
  function mainHTML(canWrite) {
    const rows = all();
    const list = filtered();
    const os = orgs(rows);
    const strip = `<div class="cr-orgs" role="group" aria-label="위기대응 조직">
      <button type="button" class="cr-orgbtn" data-org="" aria-pressed="${!org}"><span class="n">전체</span><span class="c mono">${rows.length}</span></button>
      ${os.map(o => `<button type="button" class="cr-orgbtn" data-org="${esc(o)}" aria-pressed="${org === o}">${dot(o)}<span class="n">${esc(o)}</span><span class="c mono">${rows.filter(r => r.org === o).length}</span></button>`).join("")}
    </div>`;
    const narrowed = !!(org || query);
    const toolbar = `<div class="cr-bar">
      ${ui.search("cr-q", "이름 · 팀 · 업무 검색", query)}
      <div class="seg" role="group" aria-label="보기">${VIEWS.map(([v, lb]) =>
        `<button type="button" class="seg-btn" data-view="${v}" aria-pressed="${view === v}">${lb}</button>`).join("")}</div>
      ${narrowed ? `<span class="cr-result">임무 <b class="mono">${list.length}</b> / ${rows.length}<button type="button" class="cr-clear" id="cr-clear">조건 해제</button></span>` : ""}
    </div>`;
    const body = !list.length ? `<section class="card">${ui.empty("조건에 맞는 임무가 없습니다.", '<button type="button" class="btn btn-ghost btn-sm" id="cr-clear2">조건 해제</button>')}</section>`
      : view === "team" ? teamView(list, canWrite)
      : view === "person" ? (personView(list) || `<section class="card">${ui.empty("조건에 맞는 담당자가 없습니다.")}</section>`)
      : view === "matrix" ? matrixView(list)
      : orgView(list, canWrite);
    return strip + toolbar + `<div id="cr-body" data-mode="${esc(view)}">${body}</div>`;
  }

  function rerender() { SeMIS.renderView(); }
  function wire(root, canWrite) {
    const qi = $("#cr-q", root);
    if (qi) qi.oninput = () => {
      // 한글 조합 중에도 입력칸을 새로 만들지 않는다 — 조합이 깨져 자모로 풀리는 문제(v1.13.1)
      const v = ui.searchValue(qi.value);
      if (v === query) return;
      query = v;
      const main = $("#cr-main");
      if (main) { ui.repaintKeep(main, mainHTML(canWrite), qi); wire(main, canWrite); }
      else rerender();
    };
    $$(".seg-btn[data-view]", root).forEach(b => b.onclick = () => { view = b.dataset.view; rerender(); });
    $$(".cr-orgbtn", root).forEach(b => b.onclick = () => { org = b.dataset.org === org ? "" : b.dataset.org; rerender(); });
    ["#cr-clear", "#cr-clear2"].forEach(id => { const b = $(id, root); if (b) b.onclick = () => { org = ""; query = ""; rerender(); }; });
    $$("[data-person]", root).forEach(b => b.onclick = () => { view = "person"; org = ""; query = b.dataset.person; rerender(); scrollTop(); });
    $$("[data-jump=notes]", root).forEach(b => b.onclick = () => { const n = $("#cr-notes"); if (n && n.scrollIntoView) n.scrollIntoView({ behavior: "smooth", block: "start" }); });
    $$("[data-mx-team]", root).forEach(b => b.onclick = () => { view = "org"; org = b.dataset.mxOrg; query = b.dataset.mxTeam; rerender(); scrollTop(); });
    if (!canWrite) return;
    $$("[data-edit]", root).forEach(b => b.onclick = () => editRow(b.dataset.edit));
    const add = $("#cr-add", root); if (add) add.onclick = () => editRow("");
    const meta = $("#cr-meta", root); if (meta) meta.onclick = editMeta;
    const file = $("#cr-xlsx", root), imp = $("#cr-import", root);
    if (imp && file) {
      imp.onclick = () => file.click();
      file.onchange = () => { const f = file.files && file.files[0]; file.value = ""; if (f) importFile(f); };
    }
  }
  function scrollTop() {
    const b = $("#cr-body");
    if (b && b.scrollIntoView) try { b.scrollIntoView({ block: "start" }); } catch (e) { /* jsdom */ }
  }

  /* ─────── 행 편집 (hq) ─────── */
  function datalist(id, vals) { return `<datalist id="${id}">${vals.map(v => `<option value="${esc(v)}">`).join("")}</datalist>`; }
  function editRow(id) {
    const r = id ? all().find(x => x.id === id) : null;
    if (id && !r) return;
    const v = r || { div: "", team: "", org: org || "", task: "", main: "", sub: "" };
    const f = (idn, label, html) => `<div class="form-row"><label for="${idn}">${label}</label>${html}</div>`;
    const inp = (idn, val, list) => `<input id="${idn}" value="${esc(val || "")}" autocomplete="off"${list ? ` list="${list}"` : ""}>`;
    openModal(`<h3>${r ? "임무 수정" : "임무 추가"}</h3>
      <div class="form-grid">
        ${f("cr-f-div", "본부", inp("cr-f-div", v.div, "cr-dl-div"))}
        ${f("cr-f-team", "팀", inp("cr-f-team", v.team, "cr-dl-team"))}
      </div>
      ${f("cr-f-org", "위기대응 조직", inp("cr-f-org", v.org, "cr-dl-org"))}
      ${f("cr-f-task", "위기대응 업무", `<textarea id="cr-f-task" rows="2">${esc(v.task || "")}</textarea>`)}
      <div class="form-grid">
        ${f("cr-f-main", "담당자(정)", inp("cr-f-main", v.main, "cr-dl-p"))}
        ${f("cr-f-sub", "담당자(부)", inp("cr-f-sub", v.sub, "cr-dl-p"))}
      </div>
      ${datalist("cr-dl-div", divsOf(all()).filter(d => d !== "기타"))}${datalist("cr-dl-team", teamsOf(all()))}
      ${datalist("cr-dl-org", orgs(all()))}${datalist("cr-dl-p", people().map(p => p.name))}
      <div class="modal-actions">
        ${r && SeMIS.canDelete() ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`);
    const val = (k) => norm(($("#cr-f-" + k) || {}).value);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal("이 임무를 삭제합니다.", () => {
      C().rows = all().filter(x => x.id !== r.id);
      SeMIS.save(); rerender(); toast("삭제했습니다.");
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const o = { div: val("div"), team: val("team"), org: val("org"), task: val("task"), main: val("main"), sub: val("sub") };
      if (!o.team || !o.org || !o.task) { toast("팀 · 위기대응 조직 · 업무를 입력하세요.", true); return; }
      ensureStore();
      if (r) Object.assign(r, o);
      else {
        const nr = Object.assign({ id: uid() }, o);
        const list = all();
        let at = -1;
        list.forEach((x, i) => { if (x.team === o.team) at = i; });
        if (at >= 0) list.splice(at + 1, 0, nr); else list.push(nr);
      }
      const saved = r || o;
      if ((org && org !== saved.org) || !matches(saved, query)) {
        org = ""; query = "";
        toast("저장했습니다. 저장한 임무가 보이도록 조건을 해제했습니다.");
      } else toast("저장했습니다.");
      closeModal(); SeMIS.save(); rerender();
    };
  }
  function ensureStore() {
    const v = SeMIS.data[KEY];
    if (!v || typeof v !== "object" || Array.isArray(v)) SeMIS.data[KEY] = { rows: [] };
    if (!Array.isArray(SeMIS.data[KEY].rows)) SeMIS.data[KEY].rows = [];
    return SeMIS.data[KEY];
  }

  function editMeta() {
    const c = C();
    const teams = teamsOf(all());
    openModal(`<h3>기본 정보</h3>
      <div class="form-row"><label for="cr-m-title">제목</label><input id="cr-m-title" value="${esc(c.title || "")}"></div>
      <div class="form-grid">
        <div class="form-row"><label for="cr-m-asof">기준 시점</label><input id="cr-m-asof" value="${esc(c.asOf || "")}" placeholder="26년 9월"></div>
        <div class="form-row"><label for="cr-m-home">우리 팀</label><select id="cr-m-home">${teams.map(t => `<option${t === homeTeam() ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      </div>
      <div class="form-row"><label for="cr-m-notes">참고 사항 ${ui.tip("한 줄에 한 항목. 전화번호(02-0000-0000)는 화면에서 바로 걸 수 있게 바뀝니다.", "참고 사항 설명")}</label>
        <textarea id="cr-m-notes" rows="4">${esc(notes().join("\n"))}</textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const s = ensureStore();
      s.title = norm($("#cr-m-title").value);
      s.asOf = norm($("#cr-m-asof").value);
      s.homeTeam = $("#cr-m-home").value || HOME_DEFAULT;
      s.notes = String($("#cr-m-notes").value || "").split("\n").map(norm).filter(Boolean);
      closeModal(); SeMIS.save(); rerender(); toast("저장했습니다.");
    };
  }

  /* ═════════════ 엑셀(.xlsx) 읽기 — 외부 라이브러리 없이 ZIP + XML ═════════════ */
  let inflateRaw = async (u8) => {
    if (typeof DecompressionStream === "undefined") throw new Error("inflate");
    const ds = new DecompressionStream("deflate-raw");
    const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  };
  function utf8(u8) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(u8);
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return decodeURIComponent(escape(s));
  }
  async function unzip(ab) {
    const u8 = new Uint8Array(ab), dv = new DataView(ab);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("zip");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = utf8(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (!/\.(xml|rels)$/i.test(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = u8.subarray(start, start + csize);
      out[name] = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    }
    return out;
  }
  const xml = (u8) => new DOMParser().parseFromString(utf8(u8), "application/xml");
  const tags = (node, name) => Array.from(node.getElementsByTagName(name));
  function colIdx(ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref || "");
    if (!m) return null;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { r: Number(m[2]), c };
  }
  async function readXlsx(ab) {
    const z = await unzip(ab);
    const get = (n) => z[n] || z[n.replace(/^\//, "")];
    const shared = [];
    if (get("xl/sharedStrings.xml")) {
      tags(xml(get("xl/sharedStrings.xml")), "si").forEach(si => {
        shared.push(tags(si, "t").filter(t => !(t.parentNode && t.parentNode.nodeName === "rPh") &&
          !(t.parentNode && t.parentNode.parentNode && t.parentNode.parentNode.nodeName === "rPh")).map(t => t.textContent).join(""));
      });
    }
    const wb = get("xl/workbook.xml");
    if (!wb) throw new Error("xlsx");
    const rels = {};
    if (get("xl/_rels/workbook.xml.rels")) tags(xml(get("xl/_rels/workbook.xml.rels")), "Relationship").forEach(r => {
      const tg = r.getAttribute("Target") || "";
      rels[r.getAttribute("Id")] = tg.charAt(0) === "/" ? tg.slice(1) : "xl/" + tg.replace(/^\.\//, "");
    });
    const sheets = [];
    tags(xml(wb), "sheet").forEach((s, i) => {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const path = rels[rid] || "xl/worksheets/sheet" + (i + 1) + ".xml";
      const doc = get(path) ? xml(get(path)) : null;
      if (!doc) return;
      const cells = {};
      let maxR = 0, maxC = 0;
      tags(doc, "c").forEach(c => {
        const at = colIdx(c.getAttribute("r"));
        if (!at) return;
        const t = c.getAttribute("t"), v = tags(c, "v")[0];
        let val = "";
        if (t === "s") val = v ? shared[Number(v.textContent)] || "" : "";
        else if (t === "inlineStr") val = tags(c, "t").map(x => x.textContent).join("");
        else val = v ? v.textContent : "";
        if (val === "") return;
        cells[at.r + "," + at.c] = val;
        maxR = Math.max(maxR, at.r); maxC = Math.max(maxC, at.c);
      });
      tags(doc, "mergeCell").forEach(mc => {
        const [a, b] = String(mc.getAttribute("ref") || "").split(":").map(colIdx);
        if (!a || !b) return;
        const v = cells[a.r + "," + a.c];
        if (v === undefined) return;
        for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) cells[r + "," + c] = v;
        maxR = Math.max(maxR, b.r); maxC = Math.max(maxC, b.c);
      });
      sheets.push({ name: s.getAttribute("name") || "Sheet" + (i + 1), cells, maxR, maxC });
    });
    return sheets;
  }

  /* 시트 → 명단. 머리글 행("팀" · "위기대응 업무" · "담당자(정)" · "담당자(부)")을 찾아 그 아래를 읽는다.
     '전체' 시트는 합본, 나머지 시트 이름은 본부. 합본에 없는 행(예: 본부 시트에만 있는 팀)은 덧붙인다. */
  function parseSheets(sheets) {
    const cleanTask = (s) => norm(String(s || "").replace(/^[☐□■◻◼▪•·\-\s]+/, ""));
    let title = "", asOf = "";
    const noteLines = [];
    const perSheet = sheets.map(sh => {
      const cell = (r, c) => { const v = sh.cells[r + "," + c]; return v == null ? "" : String(v); };
      let hr = 0, col = {};
      for (let r = 1; r <= Math.min(sh.maxR, 30) && !hr; r++) {
        const m = {};
        for (let c = 1; c <= sh.maxC; c++) {
          const v = norm(cell(r, c)).replace(/\s/g, "");
          if (v === "팀") m.team = c;
          else if (/위기대응조직/.test(v)) m.org = c;
          else if (/위기대응업무/.test(v)) m.task = c;
          else if (/담당자\(?정\)?/.test(v)) m.main = c;
          else if (/담당자\(?부\)?/.test(v)) m.sub = c;
        }
        if (m.team && m.task && m.main) { hr = r; col = m; }
      }
      if (!hr) return { name: sh.name, rows: [] };
      for (let r = 1; r < hr; r++) for (let c = 1; c <= sh.maxC; c++) {
        const v = norm(cell(r, c));
        if (!v) continue;
        const m = /기준\s*시점\s*[:：]?\s*(.+)$/.exec(v);
        if (m) { if (!asOf) asOf = norm(m[1]); }
        else if (!title) title = v;
      }
      const rows = [];
      let inNotes = false;
      for (let r = hr + 1; r <= sh.maxR; r++) {
        const a = norm(cell(r, 1));
        if (/^<\s*end\s*>$/i.test(a)) break;
        if (/^주\s*\)/.test(a)) { inNotes = true; continue; }
        if (inNotes) {
          const raw = String(cell(r, 1) || "").replace(/\s+/g, " ").trim();
          if (raw) noteLines.push({ sheet: sh.name, text: raw });
          continue;
        }
        const task = cleanTask(cell(r, col.task));
        if (!task) continue;
        const main = norm(cell(r, col.main)), sub = col.sub ? norm(cell(r, col.sub)) : "";
        rows.push({ team: norm(cell(r, col.team)), org: col.org ? norm(cell(r, col.org)) : "", task,
          main, sub: sub && sub === main ? "" : sub });
      }
      return { name: sh.name, rows };
    });
    const withRows = perSheet.filter(s => s.rows.length);
    const isAll = (s) => /전체|합본|종합\s*$|^all$/i.test(norm(s.name)) && withRows.length > 1;
    const master = withRows.find(isAll);
    const divSheets = withRows.filter(s => s !== master);
    const key = (r) => [r.team, r.org, r.task].join("|");
    const divOf = {};
    if (master || divSheets.length > 1) divSheets.forEach(s => s.rows.forEach(r => { if (!divOf[r.team]) divOf[r.team] = s.name; }));
    const out = [], seen = {};
    const push = (r, div) => { const k = key(r); if (seen[k]) return; seen[k] = 1; out.push(Object.assign({ id: uid() + out.length, div: div || "" }, r)); };
    if (master) {
      master.rows.forEach(r => push(r, divOf[r.team]));
      divSheets.forEach(s => s.rows.forEach(r => {
        if (seen[key(r)]) return;
        // 합본에 없던 행 — 같은 팀(없으면 같은 본부)의 마지막 행 뒤에 넣는다
        let at = -1;
        out.forEach((x, i) => { if (x.team === r.team) at = i; });
        if (at < 0) out.forEach((x, i) => { if (x.div === s.name) at = i; });
        const nr = Object.assign({ id: uid() + out.length, div: s.name }, r);
        seen[key(r)] = 1;
        if (at >= 0) out.splice(at + 1, 0, nr); else out.push(nr);
      }));
    } else divSheets.forEach(s => s.rows.forEach(r => push(r, divSheets.length > 1 ? s.name : "")));
    // 주석: 번호(1. 2.)로 시작하면 새 항목, 아니면 앞 항목에 이어 붙인다
    const ns = [];
    noteLines.forEach(l => {
      if (/^\d+[.)]\s*/.test(l.text) || !ns.length) ns.push(l.text.replace(/^\d+[.)]\s*/, ""));
      else ns[ns.length - 1] = norm(ns[ns.length - 1] + " " + l.text);
    });
    return { title, asOf, rows: out, notes: ns.filter((n, i) => ns.indexOf(n) === i) };
  }

  function diff(oldRows, newRows) {
    const key = (r) => [r.team, r.org, r.task].join("|");
    const om = {}, nm = {};
    oldRows.forEach(r => { om[key(r)] = r; });
    newRows.forEach(r => { nm[key(r)] = r; });
    const added = newRows.filter(r => !om[key(r)]);
    const removed = oldRows.filter(r => !nm[key(r)]);
    const changed = newRows.filter(r => om[key(r)] && (norm(om[key(r)].main) !== norm(r.main) || norm(om[key(r)].sub) !== norm(r.sub)))
      .map(r => ({ before: om[key(r)], after: r }));
    return { added, removed, changed };
  }

  async function importFile(file) {
    if (!/\.xlsx$/i.test(file.name || "")) { toast("엑셀(.xlsx) 파일만 올릴 수 있습니다.", true); return; }
    if (file.size > FILE_MAX) { toast("10MB를 초과합니다.", true); return; }
    let parsed;
    try {
      const ab = await file.arrayBuffer();
      parsed = parseSheets(await readXlsx(ab));
    } catch (e) { toast("엑셀을 읽지 못했습니다. .xlsx 형식인지 확인하세요.", true); return; }
    if (!parsed.rows.length) { toast("'팀 · 위기대응 업무 · 담당자(정)' 머리글이 있는 표를 찾지 못했습니다.", true); return; }
    previewImport(parsed, file);
  }
  function previewImport(parsed, file) {
    const cur = all();
    const d = diff(cur, parsed.rows);
    const line = (r) => `<li><b>${esc(r.team)}</b> · ${esc(r.task)}</li>`;
    const chg = (x) => `<li><b>${esc(x.after.team)}</b> · ${esc(x.after.task)}<br><span class="cr-dv">정 ${esc(x.before.main || "-")} → <b>${esc(x.after.main || "-")}</b> · 부 ${esc(x.before.sub || "-")} → <b>${esc(x.after.sub || "-")}</b></span></li>`;
    const block = (title, arr, fn) => arr.length ? `<div class="cr-dsec"><h4>${title} <span class="mono">${arr.length}</span></h4><ul>${arr.slice(0, 40).map(fn).join("")}${arr.length > 40 ? `<li>외 ${arr.length - 40}건</li>` : ""}</ul></div>` : "";
    const same = cur.length && !d.added.length && !d.removed.length && !d.changed.length;
    openModal(`<h3>엑셀 반영</h3>
      <dl class="cr-dsum">
        <div><dt>파일</dt><dd>${esc(file.name)}</dd></div>
        ${parsed.title ? `<div><dt>제목</dt><dd>${esc(parsed.title)}</dd></div>` : ""}
        <div><dt>기준 시점</dt><dd>${esc(C().asOf || "-")} → <b>${esc(parsed.asOf || "-")}</b></dd></div>
        <div><dt>임무</dt><dd><span class="mono">${cur.length}</span> → <b class="mono">${parsed.rows.length}</b> · 팀 <span class="mono">${teamsOf(parsed.rows).length}</span> · 담당자 <span class="mono">${people(parsed.rows).length}</span></dd></div>
      </dl>
      ${cur.length ? (same ? '<p class="cr-dsame">담당자 변경 없음 — 기준 시점 · 참고 사항 · 원본 파일만 바뀝니다.</p>'
        : block("담당자 변경", d.changed, chg) + block("새 임무", d.added, line) + block("빠지는 임무", d.removed, line)) : ""}
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">반영</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = async () => {
      const btn = $("#modal-box [data-act=ok]");
      if (btn) btn.disabled = true;
      let up = null;
      if (window.SemisSync && typeof fetch !== "undefined") {
        try { up = await SemisSync.uploadFile(file, "crisis"); } catch (e) { up = null; }
      }
      const s = ensureStore();
      s.title = parsed.title || s.title || "";
      s.asOf = parsed.asOf || s.asOf || "";
      s.notes = parsed.notes;
      s.rows = parsed.rows;
      s.updatedAt = new Date().toISOString().slice(0, 10);
      if (up) { s.fileUrl = up.url; s.fileName = file.name; }
      if (!s.rows.some(r => r.team === homeTeam())) delete s.homeTeam;
      org = ""; query = "";
      closeModal(); SeMIS.save(); rerender();
      toast(up || !window.SemisSync ? "반영했습니다." : "반영했습니다. 원본 파일은 올리지 못했습니다.", !up && !!window.SemisSync);
    };
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "users", module: MOD,
    items: () => people().map(p => ({
      title: p.name, sub: p.teams.join(" · ") + " · 정 " + p.main.length + " · 부 " + p.sub.length,
      text: [p.name].concat(p.teams, p.main.map(r => r.task), p.sub.map(r => r.task)),
      route: MOD,
      pick: () => { view = "person"; org = ""; query = p.name; if (/^#\/crisis$/.test(location.hash)) SeMIS.renderView(); }
    }))
  });

  window.SemisCrisis = {
    readXlsx, parseSheets, diff, people, contactOf, isPerson, matches, orgs,
    setInflate: (fn) => { inflateRaw = fn; },
    getState: () => ({ view, org, query }),
    setState: (s) => { if (s.view) view = s.view; if (s.org != null) org = s.org; if (s.query != null) query = s.query; },
    editRow, editMeta, previewImport
  };
})();
