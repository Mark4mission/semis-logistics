/* Task 관리 화면 — 빠른 입력 · 담당자 칩 · 기한 묶음 목록 · 체크(되돌리기) · 마친 일.
   데이터 · 날짜 말 · 분류 · 사용 조건은 js/tasks-core.js 의 window.SemisTasks — 이 파일은 같은 객체에 화면 함수를 더한다 */
"use strict";

(() => {
  const { $, $$, esc, toast, ui, icon } = SeMIS;
  const T = window.SemisTasks;
  const MOD = "tasks";
  const TITLE = "Task 관리";
  const PAGE = 100;   // 마친 일은 지우지 않고 쌓이므로 최근 것부터 끊어 그린다
  const st = { tab: "todo", who: null, q: "", meet: false, doneN: PAGE, qSel: null };
  let root = null;

  const live = () => !!root && root.isConnected && !!$("#tk-list", root);
  const dot =(n) => `<i class="tk-dot ev-${esc(T.personColor(n))}" aria-hidden="true"></i>`;

  /* 담당자 칩 = 파트 명단(코드에 이름 없음) 다음에 할 일에만 적힌 이름 — 명단이 비었거나 명단 밖 담당이어도 칩으로 고를 수 있게.
     '나' 칩이 있으면 내 이름 칩은 따로 두지 않는다 */
  function whoNames() {
    const me = T.meInPart() ? T.me() : "";
    const part = T.partPeople().filter(n => n !== me), extra = [];
    T.list().forEach(t => t.who.forEach(n => { if (n !== me && part.indexOf(n) < 0 && extra.indexOf(n) < 0) extra.push(n); }));
    return part.concat(extra.sort((a, b) => a.localeCompare(b, "ko")));
  }
  /* 기억해 둔 칩이 지금 없으면(명단이 바뀜 · 계정 이름이 명단 밖) 전체로 보인다 — 빈 목록으로 오해하지 않게 */
  function curWho() {
    if (st.who == null) st.who = String(SeMIS.navPrefs().tkWho || "*");
    const ok = st.who === "*" || (st.who === "me" ? T.meInPart() : whoNames().indexOf(st.who) >= 0);
    return ok ? st.who : "*";
  }
  function pickWho(v) {
    st.who = String(v || "*");
    SeMIS.setNavPref({ tkWho: st.who });
  }
  const byWho = (t, w) => w === "*" || t.who.indexOf(w === "me" ? T.me() : w) >= 0;
  function byQuery(t) {
    if (!st.q) return true;
    const hay = [t.t, t.memo, t.place, t.who.join(" "), t.teams.join(" ")].join(" ").toLowerCase();
    return st.q.toLowerCase().split(/\s+/).every(w => hay.indexOf(w) >= 0);
  }
  function whoHTML(w) {
    const chips = [["*", "전체", ""]].concat(T.meInPart() ? [["me", "나", T.me()]] : [], whoNames().map(n => [n, n, n]));
    return chips.map(([v, lb, n]) => `<button type="button" class="seg-btn" data-who="${esc(v)}" aria-pressed="${v === w}">${n ? dot(n) : ""}${esc(lb)}</button>`).join("");
  }

  function counts() {
    const td = T.today(), mon = T.weekStart(td), c = { open: 0, today: 0, late: 0, wk: 0 };
    T.list().forEach(t => {
      if (t.done) { if (T.dayOf(t.doneAt) >= mon) c.wk++; return; }
      c.open++;
      const b = T.dueInfo(t, td).b;
      if (b === "today") c.today++; else if (b === "late") c.late++;
    });
    return c;
  }
  function statsHTML() {
    const c = counts();
    return ui.stats([
      { label: "할 일", value: c.open },
      { label: "오늘", value: c.today, tone: c.today ? "warn" : "" },
      { label: "지난 일", value: c.late, tone: c.late ? "bad" : "ok" },
      { label: "이번 주 마친 일", value: c.wk }
    ]);
  }
  /* 탭 건수는 담당자 칩만 따른다 — 검색 글자를 칠 때는 목록만 다시 그리므로 */
  const todoCount = () => { const w = curWho(); return T.list().filter(t => !t.done && byWho(t, w)).length; };

  function rowHTML(t, td) {
    const id = esc(t.id), c = T.CATS[T.catOf(t)];
    const d = t.done ? null : T.dueInfo(t, td);
    const dd = t.done ? T.dayOf(t.doneAt) : "";
    const meta = [
      t.done ? `<span class="tk-due tk-d-done">${esc((dd ? T.dayLabel(dd, td) + " " : "") + "마침" + (t.doneBy ? " · " + t.doneBy : ""))}</span>`
        : d.label ? `<span class="tk-due tk-d-${d.b}">${esc(d.label)}</span>` : "",
      t.place ? `<span class="tk-ic">${icon("pin", 14)}${esc(t.place)}</span>` : "",
      t.who.map(n => `<span class="tk-p">${dot(n)}${esc(n)}</span>`).join(""),
      t.teams.map(g => `<span class="tk-ic">${icon("building", 14)}${esc(g)}</span>`).join(""),
      t.memo ? `<span class="tk-ic" title="메모 있음">${icon("notes", 14)}<span class="sr-only">메모 있음</span></span>` : "",
      t.star ? `<span class="tk-ic tk-star" title="중요">${icon("star", 14)}<span class="sr-only">중요</span></span>` : "",
      t.src === "desk" ? `<span class="tk-ic">${icon("forward", 14)}접수</span>` : ""
    ].join("");
    return `<li class="tk-row${d && d.b === "late" ? " tk-late" : ""}${t.done ? " tk-done" : ""}" data-id="${id}">
      <input type="checkbox" class="tk-chk" aria-labelledby="tk-t-${id}"${t.done ? " checked" : ""}>
      <span class="tk-cat ev-${esc(c.color)}" title="${esc(c.label)}">${icon(c.ico, 18)}</span>
      <div class="tk-body"><button type="button" class="tk-t" id="tk-t-${id}"><span class="tk-tt">${esc(t.t)}</span></button>${meta ? `<div class="tk-meta">${meta}</div>` : ""}</div>
    </li>`;
  }
  const grpHTML = (b, lb, rows, td) => `<div class="tk-grp" data-b="${b}"><h3 class="tk-bh"><span class="tk-bl">${esc(lb)}</span><span class="tk-bn mono">${rows.length}</span></h3>
    <ul class="tk-rows">${rows.map(t => rowHTML(t, td)).join("")}</ul></div>`;
  function todoHTML(items, td) {
    const idx = new Map(T.list().map((t, i) => [t, i])), by = {};
    items.forEach(t => { const b = T.dueInfo(t, td).b; (by[b] = by[b] || []).push(t); });
    const order = (a, b) => (b.star - a.star) || a.due.localeCompare(b.due) || a.time.localeCompare(b.time) || idx.get(a) - idx.get(b);
    return T.BUCKETS.filter(([b]) => by[b]).map(([b, lb]) => grpHTML(b, lb, by[b].sort(order), td)).join("");
  }
  /* 묶음 열쇠를 할 일 탭(today · late …)과 다르게 둔다 — 같으면 마친 '오늘'에 기한 경고 색이 붙는다 */
  function doneHTML(items, td) {
    const mon = T.weekStart(td), by = {};
    const all = items.slice().sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    const shown = all.slice(0, st.doneN);
    shown.forEach(t => { const d = T.dayOf(t.doneAt), g = d >= td ? "d-today" : d >= mon ? "d-week" : "d-before"; (by[g] = by[g] || []).push(t); });
    return [["d-today", "오늘"], ["d-week", "이번 주"], ["d-before", "그 전"]].filter(([g]) => by[g]).map(([g, lb]) => grpHTML(g, lb, by[g], td)).join("") +
      (all.length > shown.length ? '<button type="button" class="btn btn-ghost tk-showmore">더 보기</button>' : "");
  }
  /* 검색칸은 이 상자 안에 있다 — 다시 그릴 때 ui.repaintKeep 으로 검색칸만 남긴다.
     고르지 않은 탭 칸도 빈 채로 둔다 — 탭 단추의 aria-controls 가 가리킬 곳이 있어야 한다 */
  function listHTML() {
    const td = T.today(), w = curWho();
    const items = T.list().filter(t => (st.tab === "done") === t.done && byWho(t, w) && byQuery(t));
    const body = items.length ? (st.tab === "done" ? doneHTML(items, td) : todoHTML(items, td))
      : ui.empty(st.q ? "검색 결과가 없습니다." : st.tab === "done" ? "마친 일이 없습니다." : "할 일이 없습니다.");
    return `<div class="toolbar">${ui.search("tk-q", "내용 · 장소 · 담당 검색", st.q)}</div>` +
      ["todo", "done"].map(id => ui.pane("tk", id, st.tab, id === st.tab ? body : "")).join("");
  }
  function paintList() {
    const box = $("#tk-list", root);
    ui.repaintKeep(box, listHTML(), $("#tk-q", box));
  }
  /* 입력칸(빠른 입력 · 검색)을 다시 만들면 한글 조합 · 포커스가 끊기므로 추가 · 체크 뒤에도 입력칸은 두고 그린다 */
  function refresh() {
    if (!live()) return;
    $("#tk-stats", root).innerHTML = statsHTML();
    const tb = $('[data-ct-tab="todo"]', root);
    if (tb) tb.textContent = "할 일 " + todoCount();
    paintList();
  }

  /* 담당을 비워 두면 회의 때 '누구 몫인지'가 다시 문제가 되므로 글 속 이름이 없으면 고른 칩 · 나를 켜 둔다
     (나는 계정 이름이 명단의 파트 사람일 때만 — meInPart) */
  function quickCtx(text) {
    const people = T.partPeople();
    const p = T.parse(text, { today: T.today(), names: people, teams: T.teamNames() });
    const w = curWho(), picked = w === "*" ? "" : w === "me" ? T.me() : w;
    const def = p.who.length ? p.who : picked ? [picked] : T.meInPart() ? [T.me()] : [];
    const on = st.qSel || def, chips = people.slice();
    def.forEach(n => { if (chips.indexOf(n) < 0) chips.push(n); });
    return { p, on, chips };
  }
  function prevHTML(text) {
    if (!text.trim()) return "";
    const { p, on, chips } = quickCtx(text), td = T.today();
    const b = p.due ? T.dueInfo({ due: p.due }, td).b : "";
    return (p.due ? `<span class="tk-qc">${icon("calendar", 14)}${esc((b === "today" ? "오늘 " : b === "tomorrow" ? "내일 " : "") + T.dayLabel(p.due, td))}</span>` : "") +
      (p.time ? `<span class="tk-qc">${icon("clock", 14)}${esc(p.time)}</span>` : "") +
      p.teams.map(g => `<span class="tk-qc">${icon("building", 14)}${esc(g)}</span>`).join("") +
      (chips.length ? `<span class="tk-qwho" role="group" aria-labelledby="tk-qwl"><span class="tk-qwl" id="tk-qwl">담당</span>${chips.map(n =>
        `<button type="button" class="tk-qw" data-qwho="${esc(n)}" aria-pressed="${on.indexOf(n) >= 0}">${dot(n)}${esc(n)}</button>`).join("")}</span>` : "");
  }
  function quickAdd() {
    const qi = $("#tk-quick", root), text = qi.value.trim();
    if (!text) return;
    const { p, on } = quickCtx(text);
    add({ t: p.t, due: p.due, time: p.time, who: on.slice(), teams: p.teams }, "");
    qi.value = "";
    st.qSel = null;
    $("#tk-qprev", root).innerHTML = "";
    refresh();
    toast("할 일을 추가했습니다.");
  }

  /* add · setDone 은 다른 화면(일정관리 칩 · 회의 모드 · 고치기 창)도 쓴다 — setDone 은 이 화면이 열려 있으면 요약 · 목록도 다시 그린다 */
  /* save() 는 서버 보내기만 줄 세우고 메뉴는 다시 그리지 않는다 — 패널 배지(오늘 + 지난 일)가 남지 않게 직접 그린다 */
  function persist() {
    SeMIS.save();
    try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  }
  function add(fields, src) {
    const t = T.make(fields, src || "");
    SeMIS.data[T.KEY].push(t);
    persist();
    return t;
  }
  function setDone(id, on) {
    const t = T.list().find(x => x.id === id);
    if (!t || t.done === !!on) return false;
    const now = new Date().toISOString(), by = T.me();
    Object.assign(t, { done: !!on, doneAt: on ? now : "", doneBy: on ? by : "", upAt: now, upBy: by });
    persist();
    refresh();
    return true;
  }
  function setState(o) {
    o = o || {};
    if (o.reset) Object.assign(st, { tab: "todo", who: null, q: "", meet: false, doneN: PAGE, qSel: null });
    if (o.tab === "todo" || o.tab === "done") st.tab = o.tab;
    if (typeof o.who === "string") pickWho(o.who);
    if (typeof o.q === "string") st.q = ui.searchValue(o.q);
    if (typeof o.meet === "boolean") st.meet = o.meet;
  }

  function render(el) {
    root = el;
    if (!T.canUse()) { el.innerHTML = ui.head({ title: TITLE }) + `<section class="card">${ui.empty("볼 수 있는 권한이 없습니다.")}</section>`; return; }
    st.qSel = null;
    const w = curWho();
    el.innerHTML =
      ui.head({
        title: TITLE,
        actions: `<button type="button" class="btn btn-primary" id="tk-add">${icon("plus", 17)}<span>할 일 추가</span></button>` +
          `<button type="button" class="btn btn-ghost" id="tk-meet">${icon("users", 17)}<span>${st.meet ? "목록 보기" : "회의 모드"}</span></button>`
      }) +
      `<div id="tk-stats">${statsHTML()}</div>
      <section class="card tk-card">
        <div class="tk-qbox">
          <div class="tk-qrow"><input id="tk-quick" type="text" autocomplete="off" aria-label="할 일 빠른 입력" placeholder="할 일을 적고 Enter — 예: 내일 오후 3시 보안교육 자료 제출">
            <button type="button" class="btn btn-ghost" id="tk-qadd">${icon("plus", 16)}<span>추가</span></button></div>
          <div class="tk-qprev" id="tk-qprev"></div>
        </div>
        <div class="seg tk-whoseg" id="tk-who" role="group" aria-label="담당">${whoHTML(w)}</div>
        ${ui.tabs("tk", [["todo", "할 일 " + todoCount()], ["done", "마친 일"]], st.tab)}
        <div id="tk-list">${listHTML()}</div>
      </section>`;

    /* 입력칸을 다시 만들면 한글 조합이 자모로 풀린다 — 입력 중에는 미리보기 · 목록만 바꾼다 */
    const qi = $("#tk-quick", el), qp = $("#tk-qprev", el), box = $("#tk-list", el), qs = $("#tk-q", el);
    qi.oninput = () => {
      if (!qi.value.trim()) st.qSel = null;   // 글을 다 지우면 새로 쓰는 할 일 — 앞서 누른 담당을 끌고 가지 않게
      qp.innerHTML = prevHTML(qi.value);
    };
    qi.onkeydown = (ev) => {
      if (ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      quickAdd();
    };
    $("#tk-qadd", el).onclick = () => { quickAdd(); qi.focus(); };
    /* 미리보기 담당 칩은 그 자리에서 켜고 끈다 — 다시 그리면 누른 칩의 포커스가 사라진다 */
    qp.onclick = (ev) => {
      const b = ev.target.closest("[data-qwho]");
      if (!b) return;
      const sel = (st.qSel || quickCtx(qi.value).on).slice(), n = b.dataset.qwho, i = sel.indexOf(n);
      if (i >= 0) sel.splice(i, 1); else sel.push(n);
      st.qSel = sel;
      b.setAttribute("aria-pressed", String(i < 0));
    };
    $("#tk-who", el).onclick = (ev) => {
      const b = ev.target.closest("[data-who]");
      if (!b) return;
      pickWho(b.dataset.who);
      $$("[data-who]", b.parentNode).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      qp.innerHTML = prevHTML(qi.value);
      refresh();
    };
    ui.wireTabs(el, "tk", (id) => { st.tab = id; st.doneN = PAGE; paintList(); });
    qs.oninput = () => {
      const v = ui.searchValue(qs.value);
      if (v === st.q) return;
      st.q = v;
      st.doneN = PAGE;
      paintList();
    };
    box.onchange = (ev) => {
      const cb = ev.target.closest(".tk-chk");
      if (!cb) return;
      const id = cb.closest(".tk-row").dataset.id, on = cb.checked;
      const had = document.activeElement === cb, at = $$(".tk-chk", box).indexOf(cb);
      if (!setDone(id, on)) { cb.checked = !on; return; }   // 그 사이 지워졌거나 이미 바뀐 할 일 — 체크 모양만 남지 않게
      if (on) toast("마쳤습니다.", false, { label: "되돌리기", run: () => setDone(id, false) });
      else toast("다시 할 일로 옮겼습니다.");
      /* 키보드로 체크하면 줄이 빠지며 포커스가 사라진다 — 같은 자리의 다음 줄로 */
      if (had) { const cs = $$(".tk-chk", box); (cs[Math.min(at, cs.length - 1)] || $("#tk-q", box)).focus(); }
    };
    /* 줄 상자 누름은 마우스 편의 — 키보드 · 화면 읽기 프로그램은 제목 단추로 같은 창(줄 상자에는 role · tabindex 없음) */
    box.onclick = (ev) => {
      if (ev.target.closest(".tk-showmore")) {
        /* 누른 단추가 사라지므로 새로 보인 첫 줄로 — 마친 일 묶음은 최근 순 그대로라 줄 차례 = 보인 차례 */
        const n = $$(".tk-chk", box).length;
        st.doneN += PAGE;
        paintList();
        const c = $$(".tk-chk", box)[n];
        if (c) c.focus();
        return;
      }
      const row = ev.target.closest(".tk-row"), hit = ev.target.closest("input, button, a");
      if (!row || (hit && !hit.classList.contains("tk-t"))) return;
      if (typeof T.edit === "function") T.edit(row.dataset.id);
    };
    $("#tk-add", el).onclick = () => { if (typeof T.edit === "function") T.edit(null); };
    $("#tk-meet", el).onclick = () => { st.meet = !st.meet; render(el); };
  }

  Object.assign(T, { add, setDone, setState });

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const c = counts(); return c.today + c.late || ""; },
    render
  });
})();
