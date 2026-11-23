/* Task 관리 화면 — 빠른 입력 · 담당자 칩 · 기한 묶음 목록 · 체크(되돌리기) · 마친 일.
   데이터 · 날짜 말 · 분류 · 사용 조건은 js/tasks-core.js 의 window.SemisTasks — 이 파일은 같은 객체에 화면 함수를 더한다 */
"use strict";

(() => {
  const { $, $$, esc, toast, ui, icon, openModal, closeModal, confirmModal } = SeMIS;
  const T = window.SemisTasks;
  const MOD = "tasks";
  const TITLE = "Task 관리";
  const PAGE = 100;   // 마친 일은 지우지 않고 쌓이므로 최근 것부터 끊어 그린다
  /* drafts · fk = 입력칸(빠른 입력 "q" · 회의 칸 "c"+이름)에 치던 글 · 포커스 — 원격 변경이 화면을 통째로 다시 그려도 남게.
     wk = 회의 칸 '이번 주 마친 일'을 펼친 칸 이름. th = 진행 기록을 펼친 줄(칸 표지 k — 회의 모드는 같은 할 일이 여러 칸에 있다).
     모두 모듈 상태에만(새로고침하면 목록 · 빈 칸) */
  const st = { tab: "todo", who: null, q: "", meet: false, doneN: PAGE, qSel: null, open: "", drafts: {}, fk: "", wk: [], th: [] };
  let root = null;

  const live = () => !!root && root.isConnected && !!$("#tk-list, #tk-meetbox", root);
  const dot = (n) => `<i class="tk-dot ev-${esc(T.personColor(n))}" aria-hidden="true"></i>`;

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
    const hay = [t.t, t.memo, t.place, t.who.join(" "), t.teams.join(" "), (t.notes || []).map(n => n.x).join(" ")].join(" ").toLowerCase();
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
  /* 홈 '오늘' 띠 — 남은 할 일이 없으면 칸을 그리지 않는다 */
  function todayData() {
    if (!T.canUse()) return null;
    const c = counts();
    return c.open ? { open: c.open, today: c.today, late: c.late } : null;
  }
  /* HTML(띠의 다른 줄처럼 경고 부분 em) — 숫자만 들어가므로 할 일 글이 섞이지 않는다 */
  const todaySub = (d) => "오늘 " + d.today + " · 지난 " + (d.late ? "<em>" + d.late + "</em>" : d.late);
  /* 탭 건수는 담당자 칩만 따른다 — 검색 글자를 칠 때는 목록만 다시 그리므로 */
  const todoCount = () => { const w = curWho(); return T.list().filter(t => !t.done && byWho(t, w)).length; };

  /* 진행 기록(펼침) — 적은 순 · 적은 사람(사람 색) · 때 · 지우기, 아래에 덧붙이기 칸(치던 글은 st.drafts "n"+k).
     Enter = 덧붙이기 · Shift+Enter = 줄바꿈 · Esc = 접기 */
  function threadHTML(t, k, td) {
    const ns = t.notes || [];
    return `<div class="tk-thread" id="tk-th-${esc(k)}">${ns.length ? `<ol class="tk-notes">${ns.map(n => `<li class="tk-note" data-nid="${esc(n.id)}">
        <div class="tk-nh"><span class="tk-nw">${n.by ? dot(n.by) + esc(n.by) : "-"}</span><span class="tk-nd">${esc(T.stamp(n.at, td))}</span>
          <button type="button" class="tk-ndel" data-hint="이 기록 지우기">${icon("x", 14)}<span class="sr-only">이 기록 지우기</span></button></div>
        <p class="tk-nx">${esc(n.x)}</p></li>`).join("")}</ol>` : ""}
      <div class="tk-nadd"><textarea class="tk-nin" rows="1" maxlength="${T.NOTE_MAX}" data-k="${esc(k)}" aria-label="진행 기록 덧붙이기" placeholder="진행 내용을 적고 Enter">${esc(st.drafts["n" + k] || "")}</textarea>
        <button type="button" class="btn btn-ghost btn-sm tk-nsend">덧붙이기</button></div></div>`;
  }
  /* m = 회의 칸({ col: 칸 이름, k: 칸 표지 }) — 같은 할 일이 여러 칸에 그려지므로 id 에 칸 표지를 붙이고, 담당은 칸 사람을 빼고 '함께'로.
     줄 오른쪽 끝 = [진행 기록][중요(리본 — 켜면 칠한 리본 · 제목 색)][지우기].
     기호마다 data-hint = 마우스를 올리면 뜨는 풀이(코어 이름표 — 누르기 전에 뜻을 알게, 지금 상태에 맞는 동작 말) */
  function rowHTML(t, td, m) {
    const k = (m ? m.k + "-" : "") + t.id, id = esc(t.id), tid = esc("tk-t-" + k), c = T.CATS[T.catOf(t)];
    const d = t.done ? null : T.dueInfo(t, td);
    const dueTT = t.due ? "기한 " + T.dayLabel(t.due, td) + (t.time ? " " + t.time : "") : "";
    const dd = t.done ? T.dayOf(t.doneAt) : "";
    const ns = t.notes || [], open = st.th.indexOf(k) >= 0, ln = ns[ns.length - 1];
    const who = (m ? t.who.filter(n => n !== m.col) : t.who).map(n => `<span class="tk-p">${dot(n)}${esc(n)}</span>`).join("");
    const meta = [
      t.done ? `<span class="tk-due tk-d-done">${esc((dd ? T.dayLabel(dd, td) + " " : "") + "마침" + (t.doneBy ? " · " + t.doneBy : ""))}</span>`
        : d.label ? `<span class="tk-due tk-d-${d.b}"${dueTT && dueTT.indexOf(d.label) < 0 ? ` data-hint="${esc(dueTT)}"` : ""}>${esc(d.label)}</span>` : "",
      t.place ? `<span class="tk-ic" data-hint="장소">${icon("map", 14)}${esc(t.place)}</span>` : "",
      m && who ? `<span class="tk-with">함께:${who}</span>` : who ? `<span class="tk-whos" data-hint="담당">${who}</span>` : "",
      t.teams.map(g => `<span class="tk-ic" data-hint="관련 팀">${icon("building", 14)}${esc(g)}</span>`).join(""),
      t.memo ? `<span class="tk-ic" data-hint="메모 있음 — 누르면 고치기 창">${icon("notes", 14)}<span class="sr-only">메모 있음</span></span>` : "",
      t.src === "desk" ? `<span class="tk-ic" data-hint="접수 카운터에서 등록">${icon("forward", 14)}접수</span>` : ""
    ].join("");
    /* 접힌 줄에는 마지막 진행 기록 한 줄 — 회의 때 펼치지 않고도 지금 상태가 보이게(누르면 펼침) */
    const last = ln && !open ? `<button type="button" class="tk-nlast" data-th="${esc(k)}" aria-expanded="false" data-hint="최근 진행 기록 — 누르면 모두 보기"><span class="tk-nlx">${esc(ln.x.split("\n")[0])}</span><span class="tk-nlm">${esc([ln.by, T.stamp(ln.at, td)].filter(Boolean).join(" · "))}</span></button>` : "";
    const nb = `${icon("comment", 17)}${ns.length ? `<span class="tk-nn" aria-hidden="true">${ns.length}</span>` : ""}<span class="sr-only">진행 기록${ns.length ? " " + ns.length + "건" : ""}</span>`;
    return `<li class="tk-row${d && d.b === "late" ? " tk-late" : ""}${t.done ? " tk-done" : ""}${t.star ? " tk-star-on" : ""}${open ? " tk-open" : ""}" data-id="${id}" data-k="${esc(k)}">
      <input type="checkbox" class="tk-chk" aria-labelledby="${tid}"${t.done ? " checked" : ""} data-hint="${t.done ? "다시 열기(할 일로)" : "완료 — 마친 일로"}">
      <span class="tk-cat ev-${esc(c.color)}" role="img" aria-label="분류: ${esc(c.label)}" data-hint="분류: ${esc(c.label)}">${icon(c.ico, 18)}</span>
      <div class="tk-body"><button type="button" class="tk-t" id="${tid}"><span class="tk-tt">${esc(t.t)}</span></button>${meta ? `<div class="tk-meta">${meta}</div>` : ""}${last}</div>
      <div class="tk-ra">
        <button type="button" class="tk-ab tk-nb${ns.length ? " has-n" : ""}" data-th="${esc(k)}" aria-expanded="${open}"${open ? ` aria-controls="tk-th-${esc(k)}"` : ""} aria-describedby="${tid}" data-hint="${open ? "진행 기록 접기" : ns.length ? "진행 기록 " + ns.length + "건 보기 · 덧붙이기" : "진행 기록 덧붙이기"}">${nb}</button>
        <button type="button" class="tk-ab tk-imp" aria-pressed="${t.star}" aria-describedby="${tid}" data-hint="${t.star ? "중요 — 누르면 해제" : "중요 표시"}">${icon("pin", 17)}<span class="sr-only">중요</span></button>
        <button type="button" class="tk-ab tk-del" aria-describedby="${tid}" data-hint="지우기(알림에서 되돌리기)">${icon("trash", 17)}<span class="sr-only">지우기</span></button>
      </div>${open ? threadHTML(t, k, td) : ""}
    </li>`;
  }
  const grpHTML = (b, lb, rows, td) => `<div class="tk-grp" data-b="${b}"><h3 class="tk-bh"><span class="tk-bl">${esc(lb)}</span><span class="tk-bn mono">${rows.length}</span></h3>
    <ul class="tk-rows">${rows.map(t => rowHTML(t, td)).join("")}</ul></div>`;
  /* 기한 묶음 → 중요 → 날짜 → 시각 → 만든 순 — 목록 묶음 안 · 회의 칸이 같은 순서 */
  function byDue(td) {
    const idx = new Map(T.list().map((t, i) => [t, i])), bs = T.BUCKETS.map(x => x[0]), bi = (t) => bs.indexOf(T.dueInfo(t, td).b);
    return (a, b) => bi(a) - bi(b) || (b.star - a.star) || a.due.localeCompare(b.due) || a.time.localeCompare(b.time) || idx.get(a) - idx.get(b);
  }
  function todoHTML(items, td) {
    const by = {}, order = byDue(td);
    items.forEach(t => { const b = T.dueInfo(t, td).b; (by[b] = by[b] || []).push(t); });
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
    if ($("#tk-meetbox", root)) paintMeet();
    else {
      const tb = $('[data-ct-tab="todo"]', root);
      if (tb) tb.textContent = "할 일 " + todoCount();
      paintList();
    }
    $$(".tk-nin", root).forEach(fit);
  }
  /* 진행 기록 칸은 글 줄만큼 늘어난다(최대 높이는 CSS) */
  function fit(el) {
    if (!el || !el.value) { if (el) el.style.height = ""; return; }
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }

  /* ── 회의 모드 — 사람별 칸 ── */
  /* 칸 = 파트 명단 순 + 할 일에 적힌 명단 밖 이름(가나다 순) + 담당 없는 할 일이 있을 때만 '담당 없음'(""),
     칸이 하나도 없으면 '담당 없음' 한 칸 — 입력할 곳이 있게.
     '할 일' = 남은 일 + 이번 주에 마친 일 — 회의 중 마지막 줄을 체크해도 그 칸(이번 주 마친 일 · 인쇄)이 사라지지 않게 */
  function meetCols() {
    const mon = T.weekStart(T.today()), part = T.partPeople(), extra = [];
    const seen = T.list().filter(t => !t.done || T.dayOf(t.doneAt) >= mon);
    seen.forEach(t => t.who.forEach(n => { if (part.indexOf(n) < 0 && extra.indexOf(n) < 0) extra.push(n); }));
    const cols = part.concat(extra.sort((a, b) => a.localeCompare(b, "ko")));
    if (!cols.length || seen.some(t => !t.who.length)) cols.push("");
    return cols;
  }
  function colNode(n) {
    const c = document.createElement("section"), who = n || "담당 없음";
    c.className = "tk-col";
    c.dataset.col = n;
    c.innerHTML = `<h3 class="tk-ch">${n ? dot(n) : ""}<span class="tk-cname">${esc(who)}</span><span class="tk-cnum mono"></span></h3>
      <ul class="tk-rows tk-clist"></ul>
      <input type="text" class="tk-cin" data-col="${esc(n)}" autocomplete="off" aria-label="${esc(who + " 할 일 추가")}" placeholder="${esc(n ? "+ " + n + " 할 일" : "+ 할 일")}">
      <div class="tk-wkdone"><button type="button" class="tk-wkb" data-wk="${esc(n)}" aria-expanded="false">이번 주 마친 일 <span class="mono"></span>${icon("chevdown", 15)}</button>
        <ul class="tk-rows tk-wklist" hidden></ul></div>`;
    $(".tk-cin", c).value = st.drafts["c" + n] || "";
    return c;
  }
  function fillCol(c, n, i, td) {
    const mine = (t) => (n ? t.who.indexOf(n) >= 0 : !t.who.length), mon = T.weekStart(td);
    const open = T.list().filter(t => !t.done && mine(t)).sort(byDue(td));
    const wk = T.list().filter(t => t.done && mine(t) && T.dayOf(t.doneAt) >= mon).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    $(".tk-cnum", c).textContent = open.length;
    $(".tk-clist", c).innerHTML = open.map(t => rowHTML(t, td, { col: n, k: "c" + i })).join("");
    const b = $("[data-wk]", c), ul = $(".tk-wklist", c), on = wk.length > 0 && st.wk.indexOf(n) >= 0;
    ul.id = "tk-wk-" + i;
    $(".mono", b).textContent = wk.length;
    b.disabled = !wk.length;
    b.setAttribute("aria-controls", ul.id);
    b.setAttribute("aria-expanded", String(on));
    ul.hidden = !on;
    ul.innerHTML = wk.map(t => rowHTML(t, td, { col: n, k: "w" + i })).join("");
  }
  /* 칸은 이름으로 짝지어 고쳐 그린다 — 있던 칸의 입력칸은 그대로 두고(한글 조합 · 포커스 · HANDOFF §6-11) 목록 · 수만 바꾸며,
     생긴 칸만 만들고 없어진 칸만 뺀다. 없어진 칸을 먼저 빼야 남은 칸이 제자리 — 노드를 옮기면 포커스 · 조합이 끊긴다.
     여러 담당 할 일은 다른 칸에도 들므로 모든 칸의 목록을 다시 그린다 */
  function paintMeet() {
    const box = $("#tk-cols", root), td = T.today(), cols = meetCols(), have = new Map();
    $$(".tk-col", box).forEach(c => { if (cols.indexOf(c.dataset.col) >= 0) have.set(c.dataset.col, c); else c.remove(); });
    let at = box.firstElementChild;
    cols.forEach((n, i) => {
      const c = have.get(n) || colNode(n);
      if (c === at) at = at.nextElementSibling; else box.insertBefore(c, at);
      fillCol(c, n, i, td);
    });
  }
  const colOf = (n) => $$(".tk-col", root).find(c => c.dataset.col === n);
  /* 담당 = 칸 사람 ∪ 글 속 이름('담당 없음' 칸은 글 속 이름만).
     글 · 기억은 add() 앞에 비운다 — 저장 중 화면이 다시 그려져도 넣은 글이 되살아나지 않게 */
  function colAdd(inp) {
    const text = inp.value.trim(), n = inp.dataset.col;
    if (!text) return;
    const p = parseIn(text);
    inp.value = "";
    delete st.drafts["c" + n];
    add({ t: p.t, due: p.due, time: p.time, who: union(n ? [n] : [], p.who), teams: p.teams }, "");
    refresh();
    toast("할 일을 추가했습니다.");
  }

  /* 입력칸 글 · 포커스 기억(st.drafts · st.fk). 검색칸("s")은 포커스만 — 글은 st.q 가 들고 있다 */
  const dkey = (el) => (el.id === "tk-quick" ? "q" : el.id === "tk-q" ? "s" : el.classList.contains("tk-cin") ? "c" + el.dataset.col
    : el.classList.contains("tk-nin") ? "n" + el.dataset.k : "");
  const inputOf = (k) => $$("#tk-quick, #tk-q, .tk-cin, .tk-nin", root).find(x => dkey(x) === k);
  function keepDraft(el) {
    const k = dkey(el);
    if (!k || k === "s") return;
    if (el.value) st.drafts[k] = el.value; else delete st.drafts[k];
  }
  /* 포커스가 빠진 까닭은 한 박자 뒤에 본다 — 다시 그리기로 칸이 문서 밖으로 나가 빠진 것은 기억을 두고
     (브라우저마다 그때 blur 가 오기도 · 안 오기도 한다), 사람이 다른 곳으로 옮긴 것만 지운다 */
  function dropFocus(x, k) {
    if (st.fk !== k) return;
    const a = document.activeElement;
    if (x.isConnected ? a !== x : a && a !== document.body && dkey(a) !== k) st.fk = "";
  }

  const parseIn = (text) => T.parse(text, { today: T.today(), names: T.partPeople(), teams: T.teamNames() });
  /* 담당을 비워 두면 회의 때 '누구 몫인지'가 다시 문제가 되므로 글 속 이름이 없으면 고른 칩 · 나를 켜 둔다
     (나는 계정 이름이 명단의 파트 사람일 때만 — meInPart). 회의 모드에는 담당자 칩이 보이지 않으므로 칩은 보지 않는다 */
  function quickCtx(text) {
    const people = T.partPeople();
    const p = parseIn(text);
    const w = st.meet ? "*" : curWho(), picked = w === "*" ? "" : w === "me" ? T.me() : w;
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
    qi.value = "";   // add() 앞에 비운다 — colAdd 와 같은 까닭
    delete st.drafts.q;
    st.qSel = null;
    $("#tk-qprev", root).innerHTML = "";
    add({ t: p.t, due: p.due, time: p.time, who: on.slice(), teams: p.teams }, "");
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
  const findT = (id) => T.list().find(x => x.id === id);
  const touch = (t) => { t.upAt = new Date().toISOString(); t.upBy = T.me(); };
  /* 다시 그린 뒤 같은 줄(칸 표지 k)의 같은 단추 · 칸으로 — 줄이 옮겨 가도(중요 → 묶음 위로) 포커스를 잃지 않게 */
  function refocus(k, sel) {
    const row = live() ? $$(".tk-row", root).find(r => r.dataset.k === k) : null, el = row && $(sel, row);
    if (el) el.focus();
    return !!el;
  }

  /* 지우기(줄 끝 휴지통 · 고치기 창) — 지운 할 일과 자리를 돌려준다(되돌리기용).
     마지막 한 건을 지우면 목록이 빈다 — 사람이 한 지우기이므로 대량 삭제 방어(2건 이상 → 0건)가 되살리지 않게 */
  function removeTask(id) {
    const arr = SeMIS.data[T.KEY], i = Array.isArray(arr) ? arr.findIndex(t => t.id === id) : -1;
    if (i < 0) return null;
    const x = arr.splice(i, 1)[0];
    if (!arr.length && window.SemisSync && SemisSync.confirmWipe) SemisSync.confirmWipe(T.KEY);
    persist();
    return { x, i };
  }
  /* 되돌리기 — 그 사이 같은 id 가 다시 생겼으면(다른 탭 되돌리기) 두 번 넣지 않는다 */
  function restoreTask(r) {
    const arr = SeMIS.data[T.KEY];
    if (!r || !Array.isArray(arr) || arr.some(t => t.id === r.x.id)) return false;
    arr.splice(Math.min(r.i, arr.length), 0, r.x);
    persist();
    refresh();
    return true;
  }
  /* 휴지통 = 확인 창 없이 바로 지우고 알림의 '되돌리기'로 살린다 — 키보드로 지웠으면 같은 자리의 다음 휴지통으로 */
  function delTask(id, b) {
    const box = b.closest("#tk-list, #tk-meetbox") || root, had = document.activeElement === b, at = $$(".tk-del", box).indexOf(b);
    const r = removeTask(id);
    refresh();
    if (!r) { toast("그 사이 지워진 할 일입니다.", true); return; }
    toast("할 일을 지웠습니다.", false, { label: "되돌리기", run: () => restoreTask(r) });
    if (had) { const ds = $$(".tk-del", box.isConnected ? box : root); (ds[Math.min(at, ds.length - 1)] || $("#tk-q, .tk-cin", root) || $("#tk-quick", root)).focus(); }
  }
  /* 중요 = 줄 끝 리본 — 켜면 칠한 리본 · 제목 색(별도 표시 없음). 묶음 안 순서는 중요가 위 */
  function toggleStar(id, k, b) {
    const t = findT(id), had = document.activeElement === b;
    if (!t) return;
    t.star = !t.star;
    touch(t);
    persist();
    refresh();
    if (had) refocus(k, ".tk-imp");
  }
  function toggleThread(k, b) {
    const i = st.th.indexOf(k), row = b.closest(".tk-row"), t = row && findT(row.dataset.id);
    if (i >= 0) st.th.splice(i, 1); else st.th.push(k);
    refresh();
    /* 기록이 없는 할 일을 펼쳤으면 바로 적게 덧붙이기 칸으로, 기록이 있으면(읽으려고 펼침) 단추에 둔다 — 모바일에서 자판이 저절로 뜨지 않게 */
    if (i < 0 && t && !(t.notes || []).length) refocus(k, ".tk-nin"); else refocus(k, ".tk-nb");
  }
  function addNote(inp) {
    if (!inp) return;
    const text = inp.value.trim(), k = inp.dataset.k, row = inp.closest(".tk-row"), t = row && findT(row.dataset.id);
    if (!text) { inp.focus(); return; }
    if (!t) { toast("그 사이 지워진 할 일입니다.", true); return; }
    inp.value = "";   // 저장 중 다시 그려져도 넣은 글이 되살아나지 않게(colAdd 와 같은 까닭)
    delete st.drafts["n" + k];
    t.notes = T.norm({ notes: (t.notes || []).concat(T.makeNote(text)) }).notes || [];
    touch(t);
    persist();
    refresh();
    st.fk = "n" + k;
    refocus(k, ".tk-nin");
  }
  function delNote(id, nid, k) {
    const t = findT(id), a = t && Array.isArray(t.notes) ? t.notes : [], i = a.findIndex(n => n.id === nid);
    if (i < 0) { refresh(); return; }
    const n = a.splice(i, 1)[0];
    if (!a.length) delete t.notes;
    touch(t);
    persist();
    refresh();
    refocus(k, ".tk-nin");
    toast("진행 기록을 지웠습니다.", false, { label: "되돌리기", run: () => {
      const x = findT(id);
      if (!x) return;
      const b = Array.isArray(x.notes) ? x.notes : [];
      if (b.some(y => y.id === n.id)) return;
      b.splice(Math.min(i, b.length), 0, n);
      x.notes = b;
      touch(x);
      persist();
      refresh();
    } });
  }
  /* 줄 끝 단추 · 진행 기록 칸의 누름 — 처리했으면 true(줄 상자 누름 = 고치기 창으로 넘기지 않음) */
  function rowAct(ev) {
    const b = ev.target.closest("[data-th], .tk-imp, .tk-del, .tk-ndel, .tk-nsend"), row = b && b.closest(".tk-row");
    if (!row) return false;
    const id = row.dataset.id, k = row.dataset.k;
    if (b.hasAttribute("data-th")) toggleThread(k, b);
    else if (b.classList.contains("tk-imp")) toggleStar(id, k, b);
    else if (b.classList.contains("tk-del")) delTask(id, b);
    else if (b.classList.contains("tk-ndel")) delNote(id, b.closest(".tk-note").dataset.nid, k);
    else addNote($(".tk-nin", row));
    return true;
  }
  /* 진행 기록 칸 Enter = 덧붙이기(한글 조합 중 Enter 는 넘김) · Shift+Enter = 줄바꿈 · Esc = 접고 단추로 */
  function noteKey(ev) {
    const inp = ev.target.closest(".tk-nin");
    if (!inp) return false;
    if (ev.key === "Escape") {
      ev.preventDefault();
      const k = inp.dataset.k, i = st.th.indexOf(k);
      if (i >= 0) st.th.splice(i, 1);
      refresh();
      refocus(k, ".tk-nb");
      return true;
    }
    if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing || ev.keyCode === 229) return false;
    ev.preventDefault();
    addNote(inp);
    return true;
  }

  /* Task 담당자 명단(시스템관리자) — 담당자 칩 · 회의 칸 · 글 속 이름 · '나'의 기준. 비우면 인원 관리의 안전보안파트 */
  function editMembers() {
    if (!T.canManage()) return;
    /* 연 때 명단(정하지 않았으면 안전보안파트)과 같으면 쓰지 않는다 — '저장'만 눌러 파트 명단이 고정되지 않게 */
    const list = T.partPeople().slice(), was = JSON.stringify(list), pool = [];
    const R = window.SemisRoster;
    if (R) R.active().forEach(p => { const n = String((p && p.name) || "").trim(); if (n && pool.indexOf(n) < 0) pool.push(n); });
    openModal(`<h3>Task 담당자 관리</h3>
      <div class="tk-mform">
        <ol class="tk-mlist" id="tk-mlist" aria-label="담당자 명단"></ol>
        <div class="tk-madd"><input id="tk-m-in" type="text" list="tk-m-pool" autocomplete="off" maxlength="200" aria-label="담당자 추가" placeholder="이름 — 여럿이면 쉼표로">
          <button type="button" class="btn btn-ghost" id="tk-m-add">${icon("plus", 16)}<span>추가</span></button></div>
        <datalist id="tk-m-pool">${pool.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
        <p class="tk-mnote">담당자 칩 · 회의 모드 칸에 이 순서로 보입니다(비우면 안전보안파트 전원).</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="save">저장</button>
      </div>`, { sticky: true });
    const ul = $("#tk-mlist"), inp = $("#tk-m-in");
    const paint = (fi, sel) => {
      ul.innerHTML = list.length ? list.map((n, i) => `<li class="tk-mrow" data-i="${i}"><span class="tk-mno mono">${i + 1}</span><span class="tk-mname">${esc(n)}</span>
          <button type="button" class="icon-btn" data-mv="-1"${i ? "" : " disabled"} data-hint="위로" aria-label="${esc(n)} 위로">${icon("chevup", 16)}</button>
          <button type="button" class="icon-btn" data-mv="1"${i < list.length - 1 ? "" : " disabled"} data-hint="아래로" aria-label="${esc(n)} 아래로">${icon("chevdown", 16)}</button>
          <button type="button" class="icon-btn" data-rm data-hint="빼기" aria-label="${esc(n)} 빼기">${icon("x", 16)}</button></li>`).join("")
        : `<li class="tk-mempty">비어 있음 — 저장하면 안전보안파트 명단(${T.rosterPart().length}명)</li>`;
      const r = fi != null ? $$(".tk-mrow", ul)[Math.min(fi, list.length - 1)] : null, f = r && ($(sel, r) || $("[data-rm]", r));
      if (f && !f.disabled) f.focus(); else if (fi != null) inp.focus();
    };
    const addIn = () => {
      const ns = T.splitNames(inp.value).map(x => x.slice(0, 40).trim()).filter(Boolean);
      let over = false;
      ns.forEach(n => { if (list.indexOf(n) >= 0) return; if (list.length >= T.MEMBERS_MAX) { over = true; return; } list.push(n); });
      inp.value = "";
      paint();
      if (over) toast("담당자는 " + T.MEMBERS_MAX + "명까지입니다.", true);
    };
    paint();
    $("#tk-m-add").onclick = () => { addIn(); inp.focus(); };
    inp.onkeydown = (ev) => {
      if (ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      addIn();
    };
    ul.onclick = (ev) => {
      const b = ev.target.closest("button"), r = b && b.closest(".tk-mrow");
      if (!r || b.disabled) return;
      const i = +r.dataset.i;
      if (b.hasAttribute("data-rm")) { list.splice(i, 1); paint(i, "[data-rm]"); return; }
      const j = i + Number(b.dataset.mv);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      paint(j, b.dataset.mv === "-1" ? '[data-mv="-1"]' : '[data-mv="1"]');
    };
    $('#modal-box [data-act="cancel"]').onclick = closeModal;
    /* 칸에 적어 두고 '추가'를 누르지 않은 이름도 넣는다 */
    $('#modal-box [data-act="save"]').onclick = () => {
      if (inp.value.trim()) addIn();
      closeModal();
      if (JSON.stringify(list) === was) return;
      const c = SeMIS.data[T.CFG], next = Object.assign({}, c && typeof c === "object" && !Array.isArray(c) ? c : {});
      if (list.length) next.members = list.slice(); else delete next.members;
      SeMIS.data[T.CFG] = next;
      persist();
      SeMIS.renderView();
      toast("담당자 명단을 저장했습니다.");
    };
  }

  function setState(o) {
    o = o || {};
    if (o.reset) Object.assign(st, { tab: "todo", who: null, q: "", meet: false, doneN: PAGE, qSel: null, open: "", drafts: {}, fk: "", wk: [], th: [] });
    if (o.tab === "todo" || o.tab === "done") st.tab = o.tab;
    if (typeof o.who === "string") pickWho(o.who);
    if (typeof o.q === "string") st.q = ui.searchValue(o.q);
    if (typeof o.meet === "boolean") st.meet = o.meet;
  }

  const DUE_CHIPS = [["today", "오늘"], ["tomorrow", "내일"], ["fri", "이번 주 금"], ["nextmon", "다음 주 월"], ["clear", "지움"]];
  /* '이번 주 금'은 이미 지났어도 이번 주(월~일)의 금요일 — 기한 묶음 · 요약과 같은 주를 본다 */
  function dueOf(k) {
    const td = T.today(), mon = T.weekStart(td);
    return k === "today" ? td : k === "tomorrow" ? T.addDays(td, 1) : k === "fri" ? T.addDays(mon, 4) : k === "nextmon" ? T.addDays(mon, 7) : "";
  }
  const union = (a, b) => a.concat(b.filter(x => a.indexOf(x) < 0));
  /* 장소 목록은 할 일에 적힌 장소에서만 모은다(코드에 값 없음) — 최근 고친 순 20개 */
  function recentPlaces() {
    const out = [];
    T.list().slice().sort((a, b) => String(b.upAt || b.at).localeCompare(String(a.upAt || a.at)))
      .forEach(t => { if (t.place && out.indexOf(t.place) < 0 && out.length < 20) out.push(t.place); });
    return out;
  }
  const chipsHTML = (gid, label, all, on, dots) => `<div class="form-row"><label id="${gid}-l" for="${gid}-x">${esc(label)}</label>
      <div class="tk-fchips" id="${gid}" role="group" aria-labelledby="${gid}-l">${all.map(n =>
        `<button type="button" class="tk-qw" aria-pressed="${on.indexOf(n) >= 0}" data-n="${esc(n)}">${dots ? dot(n) : ""}${esc(n)}</button>`).join("")}</div>
      <input id="${gid}-x" type="text" autocomplete="off" maxlength="200" placeholder="직접 적기 — 여럿이면 쉼표로"></div>`;

  const FORM_KEYS = ["t", "due", "time", "place", "who", "teams", "cat", "star", "memo"];

  /* id 가 없으면 새 할 일(preset = 처음 칸 값). 창은 오래 쓰므로 바깥 누르기 · Esc 로 닫지 않는다(sticky) */
  function edit(id, preset) {
    if (!T.canUse()) return;
    const x = id ? T.list().find(t => t.id === id) : null;
    if (id && !x) return;
    const v = x || T.norm(Object.assign({}, preset));
    /* 연 때 값(깊은 복사) — 저장할 때 이 창이 바꾼 칸만 지금 할 일에 얹는다. 창 값을 통째로 쓰면
       창이 열린 사이 회의 동료가 고친 칸(동기화로 들어온 값)을 옛 값으로 되돌린다 */
    const base0 = x ? T.norm(JSON.parse(JSON.stringify(x))) : null;
    const autoLb = (t) => "자동 — " + T.CATS[T.catOf(Object.assign({}, t, { cat: "" }))].label;
    const doneOn = !v.done;   // 단추 글(마침 · 다시 열기) = 누르면 할 일 — 연 때 정한다
    const file = x && x.src === "desk" && x.file && x.file.url ? x.file : null;
    openModal(`<h3>${x ? "할 일 고치기" : "할 일 추가"}</h3>
      <div class="tk-form">
        <div class="form-row"><label for="tk-f-t">내용</label><textarea id="tk-f-t" rows="2" maxlength="300">${esc(v.t)}</textarea></div>
        <div class="form-grid">
          <div class="form-row"><label for="tk-f-due">날짜</label><input type="date" id="tk-f-due" value="${esc(v.due)}"></div>
          <div class="form-row"><label for="tk-f-time">시각</label><input type="time" id="tk-f-time" value="${esc(v.time)}"${v.due ? "" : " disabled"}></div>
        </div>
        <div class="tk-fdues" role="group" aria-label="빠른 날짜">${DUE_CHIPS.map(([k, lb]) => `<button type="button" class="tk-qw" data-due="${k}">${lb}</button>`).join("")}</div>
        <div class="form-row"><label for="tk-f-place">장소</label><input id="tk-f-place" type="text" autocomplete="off" maxlength="100" list="tk-f-places" value="${esc(v.place)}">
          <datalist id="tk-f-places">${recentPlaces().map(p => `<option value="${esc(p)}">`).join("")}</datalist></div>
        ${chipsHTML("tk-f-who", "담당자", union(T.partPeople(), v.who), v.who, true)}
        ${chipsHTML("tk-f-teams", "관련 팀", union(T.teamNames(), v.teams), v.teams, false)}
        <div class="form-row"><label for="tk-f-cat">분류</label><select id="tk-f-cat"><option value="">${esc(autoLb(v))}</option>${T.CAT_ORDER.map(k =>
          `<option value="${k}"${v.cat === k ? " selected" : ""}>${esc(T.CATS[k].label)}</option>`).join("")}</select></div>
        <label class="tk-fchk"><input type="checkbox" id="tk-f-star"${v.star ? " checked" : ""}>${icon("pin", 16)}<span>중요</span></label>
        <div class="form-row"><label for="tk-f-memo">메모</label><textarea id="tk-f-memo" rows="3" maxlength="2000">${esc(v.memo)}</textarea></div>
        ${file ? `<div class="form-row"><button type="button" class="btn btn-ghost btn-sm" id="tk-f-file">${icon("doc", 15)}<span>접수 카운터 원본</span></button></div>` : ""}
      </div>
      <div class="modal-actions">
        ${x ? `<button type="button" class="btn btn-danger" data-act="del">지우기</button><span class="spacer"></span>
          <button type="button" class="btn btn-ghost" data-act="done">${doneOn ? "마침" : "다시 열기"}</button>` : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="save">저장</button>
      </div>`, { sticky: true });

    const form = $("#modal-box .tk-form"), due = $("#tk-f-due"), tm = $("#tk-f-time"), cat = $("#tk-f-cat");
    /* 연 때 이름 순서를 지킨다 — 칩 순서로 다시 쓰면 손대지 않은 담당도 '바뀐 칸'이 된다 */
    const names = (gid, was) => {
      const on = $$("#" + gid + " [aria-pressed=true]").map(b => b.dataset.n);
      return union(union(was.filter(n => on.indexOf(n) >= 0), on), T.splitNames($("#" + gid + "-x").value));
    };
    const fields = () => ({ t: $("#tk-f-t").value, due: due.value, time: tm.value, place: $("#tk-f-place").value,
      who: names("tk-f-who", v.who), teams: names("tk-f-teams", v.teams), cat: cat.value, star: $("#tk-f-star").checked, memo: $("#tk-f-memo").value });
    /* 날짜 없는 시각은 저장 때 지워지므로(norm) 시각 칸을 잠가 보이게 한다 */
    const syncTime = () => { tm.disabled = !due.value; if (!due.value) tm.value = ""; };
    const upAuto = () => { cat.options[0].textContent = autoLb(fields()); };
    due.onchange = syncTime;
    form.oninput = upAuto;
    form.onclick = (ev) => {
      const d = ev.target.closest("[data-due]"), c = ev.target.closest("[data-n]");
      if (d) { due.value = dueOf(d.dataset.due); syncTime(); }
      if (c) { c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); upAuto(); }
    };
    if (file) $("#tk-f-file").onclick = () => { if (window.SemisFiles) SemisFiles.open([{ url: file.url, name: file.name || SemisFiles.nameFromUrl(file.url) }], 0); };
    if (!x) $("#tk-f-t").focus();

    /* 창이 열린 사이 원격 변경이 배열을 바꿨을 수 있다 — 고칠 대상은 늘 id 로 다시 찾는다 */
    const cur = () => T.list().find(t => t.id === v.id);
    let dirty = false;
    function commit() {
      const f = fields();
      if (!T.norm({ t: f.t }).t) { toast("내용을 입력하세요.", true); $("#tk-f-t").focus(); return null; }
      if (!x) return add(f, "");
      const t = cur();
      if (!t) { closeModal(); refresh(); toast("그 사이 지워진 할 일입니다.", true); return null; }
      const J = JSON.stringify, mine = T.norm(Object.assign({}, base0, f)), out = Object.assign({}, t);
      FORM_KEYS.forEach(k => { if (J(mine[k]) !== J(base0[k])) out[k] = mine[k]; });
      const n = T.norm(out);   // 날짜 · 시각 짝을 다시 맞춘다(남이 날짜를 지웠으면 이 창의 시각도 남지 않게)
      /* 바뀐 것이 없으면 고친 때 · 사람을 두지 않는다 — 회의 중 '저장'만 눌러도 남이 고친 기록이 내 이름으로 바뀌지 않게 */
      dirty = J(n) !== J(T.norm(t));
      if (dirty) Object.assign(t, T.norm(Object.assign(n, { upAt: new Date().toISOString(), upBy: T.me() })));
      return t;
    }
    $('#modal-box [data-act="cancel"]').onclick = closeModal;
    $('#modal-box [data-act="save"]').onclick = () => {
      const t = commit();
      if (!t) return;
      if (x && dirty) persist();
      closeModal();
      refresh();
      toast(x ? "저장했습니다." : "할 일을 추가했습니다.");
    };
    if (!x) return;
    /* 고친 칸도 함께 저장한다 — 칸을 고치고 바로 '마침'을 눌러도 고친 글이 사라지지 않게.
       마침 · 다시 열기는 지금 할 일(cur)에 한다. 창을 연 사이 동료가 이미 그렇게 바꿨으면 그 사람의 마친 때 · 사람을 두고
       되돌리기도 주지 않는다 — 되돌리면 동료가 마친 일이 다시 열린다 */
    $('#modal-box [data-act="done"]').onclick = () => {
      const t = commit();
      if (!t) return;
      closeModal();
      const changed = setDone(t.id, doneOn);
      if (!changed) { if (dirty) persist(); refresh(); }
      if (doneOn && changed) toast("마쳤습니다.", false, { label: "되돌리기", run: () => setDone(t.id, false) });
      else toast(doneOn ? "이미 마친 할 일입니다." : "다시 할 일로 옮겼습니다.");
    };
    $('#modal-box [data-act="del"]').onclick = () => confirmModal(`할 일 "${v.t}"을(를) 지웁니다.`, () => {
      const r = removeTask(v.id);
      refresh();
      if (r) toast("지웠습니다."); else toast("그 사이 지워진 할 일입니다.", true);
    });
  }
  const onHere = () => (location.hash.replace(/^#\//, "") || "dashboard") === MOD;
  /* 앱은 tasks/<id> 주소를 풀지 않으므로 id 를 모듈 상태에 두고, 그려지면 창을 연다 — 이미 이 화면이면 이동이 없으므로 다시 그린다 */
  function hold(id) {
    st.open = String(id || "");
    if (onHere()) setTimeout(() => SeMIS.renderView(), 0);
  }
  /* 일정관리 · 아르고 결과 카드가 부른다(검색은 이동을 스스로 맡으므로 hold 만 — search.js goItem) */
  function open(id) {
    hold(id);
    if (!onHere()) SeMIS.navigate(MOD);
  }

  /* 일정관리 칩 — 일정 데이터에 저장하지 않고 그릴 때 만든다. chk · mark 는 점검 일정(seclog chkOf · calMark)과 같은 모양 */
  function calItems(from, to) {
    if (!T.canUse()) return [];
    const td = T.today();
    return T.list().filter(t => t.due && t.due >= from && t.due <= to).map(t => {
      const id = t.id;
      return { ik: "tk:" + id, start: t.due, end: t.due, title: "[할 일] " + t.t, color: T.CATS[T.catOf(t)].color,
        done: t.done, late: !t.done && T.dueInfo(t, td).b === "late",
        sub: [t.time, t.place, t.who.join(", ")].filter(Boolean).join(" · "),
        go: [{ lb: "Task 관리에서 열기", ico: "external", run: () => open(id) }],   // 체크 모양은 ○ 옆에서 잘못 누르기 쉽다
        chk: { parts: [], edit: true, on: !t.done, off: t.done },
        chkMsg: { on: "할 일을 마침으로 표시했습니다.", off: "할 일을 다시 열었습니다." },
        mark: (want) => (typeof want === "boolean" && setDone(id, want) ? 1 : 0) };
    });
  }
  /* 직전에 그린 화면이 이 화면이었나 — 다른 화면에서 들어올 때는 입력칸 포커스를 돌려주지 않는다
     (모바일에서 자판이 저절로 뜸). 치던 글은 남긴다 */
  let wasHere = false;
  SeMIS.onRerender(() => { wasHere = onHere(); });

  /* 체크 = 마침 · 끄면 다시 할 일 — 그 사이 지워졌거나 이미 바뀐 할 일이면 체크 모양만 되돌린다 */
  function checkRow(cb) {
    const id = cb.closest(".tk-row").dataset.id, on = cb.checked;
    if (!setDone(id, on)) { cb.checked = !on; return false; }
    if (on) toast("마쳤습니다.", false, { label: "되돌리기", run: () => setDone(id, false) });
    else toast("다시 할 일로 옮겼습니다.");
    return true;
  }
  /* 줄 상자 누름은 마우스 편의 — 키보드 · 화면 읽기 프로그램은 제목 단추로 같은 창(줄 상자에는 role · tabindex 없음) */
  function rowClick(ev) {
    const row = ev.target.closest(".tk-row"), hit = ev.target.closest("input, button, a, textarea, .tk-thread");
    if (!row || (hit && !hit.classList.contains("tk-t"))) return;
    if (typeof T.edit === "function") T.edit(row.dataset.id);
  }

  function wireList(el, qi, qp) {
    const box = $("#tk-list", el), qs = $("#tk-q", el);
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
      const had = document.activeElement === cb, at = $$(".tk-chk", box).indexOf(cb);
      if (!checkRow(cb)) return;
      /* 키보드로 체크하면 줄이 빠지며 포커스가 사라진다 — 같은 자리의 다음 줄로 */
      if (had) { const cs = $$(".tk-chk", box); (cs[Math.min(at, cs.length - 1)] || $("#tk-q", box)).focus(); }
    };
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
      if (!rowAct(ev)) rowClick(ev);
    };
    box.onkeydown = (ev) => { noteKey(ev); };   // on* 처리기가 false 를 돌려주면 기본 동작(글자 입력)이 막힌다
  }
  function wireMeet(el) {
    const mb = $("#tk-meetbox", el);
    paintMeet();
    mb.onkeydown = (ev) => {
      if (noteKey(ev)) return;
      const inp = ev.target.closest(".tk-cin");
      if (!inp || ev.key !== "Enter" || ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      colAdd(inp);
    };
    mb.onchange = (ev) => {
      const cb = ev.target.closest(".tk-chk");
      if (!cb) return;
      const ul = cb.closest("ul"), sel = ul.classList.contains("tk-wklist") ? ".tk-wklist" : ".tk-clist", n = cb.closest(".tk-col").dataset.col;
      const had = document.activeElement === cb, at = $$(".tk-chk", ul).indexOf(cb);
      if (!checkRow(cb)) return;
      /* 줄이 빠지며 포커스가 사라진다 — 그 칸 같은 목록의 같은 자리, 없으면 그 칸 입력칸(칸이 없어졌으면 첫 칸 입력칸) */
      if (had) {
        const c = colOf(n), cs = c ? $$(sel + " .tk-chk", c) : [];
        const to = cs[Math.min(at, cs.length - 1)] || (c && $(".tk-cin", c)) || $(".tk-cin", mb);
        if (to) to.focus();
      }
    };
    mb.onclick = (ev) => {
      const b = ev.target.closest("[data-wk]");
      if (!b) { if (!rowAct(ev)) rowClick(ev); return; }
      const n = b.dataset.wk, i = st.wk.indexOf(n);
      if (i >= 0) st.wk.splice(i, 1); else st.wk.push(n);
      b.setAttribute("aria-expanded", String(i < 0));
      $(".tk-wklist", b.closest(".tk-col")).hidden = i >= 0;
    };
  }

  function render(el) {
    root = el;
    const want = st.open;   // 한 번만 쓴다 — 나중에 다시 그릴 때 창이 또 뜨지 않게
    st.open = "";
    if (!wasHere) st.fk = "";
    if (!T.canUse()) { el.innerHTML = ui.head({ title: TITLE }) + `<section class="card">${ui.empty("볼 수 있는 권한이 없습니다.")}</section>`; return; }
    if (!st.drafts.q) st.qSel = null;   // 누른 담당 칩은 치던 글이 남아 있을 때만 이어 간다
    const w = curWho(), mday = T.dayLabel(T.today(), "");   // 기준 날을 비우면 연도까지 — 인쇄한 회의 자료의 날짜
    el.innerHTML =
      ui.head({
        title: TITLE,
        actions: `<button type="button" class="btn btn-primary" id="tk-add">${icon("plus", 17)}<span>할 일 추가</span></button>` +
          `<button type="button" class="btn btn-ghost" id="tk-meet">${icon("users", 17)}<span>${st.meet ? "목록 보기" : "회의 모드"}</span></button>` +
          (T.canManage() ? `<button type="button" class="btn btn-ghost btn-sm ph-rare" id="tk-members">${icon("sliders", 16)}<span>담당자 관리</span></button>` : "")
      }) +
      `<div id="tk-stats">${statsHTML()}</div>
      <section class="card tk-card${st.meet ? " tk-meeting" : ""}">
        <div class="tk-qbox">
          <div class="tk-qrow"><input id="tk-quick" type="text" autocomplete="off" aria-label="할 일 빠른 입력" placeholder="할 일을 적고 Enter — 예: 내일 오후 3시 보안교육 자료 제출">
            <button type="button" class="btn btn-ghost" id="tk-qadd">${icon("plus", 16)}<span>추가</span></button></div>
          <div class="tk-qprev" id="tk-qprev"></div>
        </div>
        ${st.meet ? `<div id="tk-meetbox"><p class="print-only tk-mdate">${esc(mday)}</p><div class="tk-cols" id="tk-cols"></div></div>`
          : `<div class="seg tk-whoseg" id="tk-who" role="group" aria-label="담당">${whoHTML(w)}</div>
        ${ui.tabs("tk", [["todo", "할 일 " + todoCount()], ["done", "마친 일"]], st.tab)}
        <div id="tk-list">${listHTML()}</div>`}
      </section>`;

    /* 입력칸을 다시 만들면 한글 조합이 자모로 풀린다 — 입력 중에는 미리보기 · 목록만 바꾼다 */
    const qi = $("#tk-quick", el), qp = $("#tk-qprev", el), card = $(".tk-card", el);
    qi.value = st.drafts.q || "";
    qp.innerHTML = prevHTML(qi.value);
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
    if (st.meet) wireMeet(el); else wireList(el, qi, qp);
    card.addEventListener("input", (ev) => { keepDraft(ev.target); if (ev.target.classList.contains("tk-nin")) fit(ev.target); });
    $$(".tk-nin", el).forEach(fit);
    card.addEventListener("focusin", (ev) => { const k = dkey(ev.target); if (k) st.fk = k; });
    card.addEventListener("focusout", (ev) => { const x = ev.target, k = dkey(x); if (k) setTimeout(() => dropFocus(x, k), 0); });
    $("#tk-add", el).onclick = () => { if (typeof T.edit === "function") T.edit(null); };
    const mg = $("#tk-members", el);
    if (mg) mg.onclick = editMembers;
    /* 코어 다시 그리기로 — 머리말 인쇄 단추는 코어가 붙인다 */
    $("#tk-meet", el).onclick = () => {
      st.meet = !st.meet;
      SeMIS.renderView();
      const b = $("#tk-meet", root);
      if (b) b.focus();
    };
    /* 다시 그리기 전에 입력칸에 있던 포커스를 돌려준다 — 다른 곳(열린 창 등)에 포커스가 있으면 빼앗지 않는다 */
    const fi = st.fk ? inputOf(st.fk) : null, a = document.activeElement;
    if (fi && (!a || a === document.body)) { fi.focus(); fi.setSelectionRange(fi.value.length, fi.value.length); }
    /* 오래된 검색 결과 · 일정 칩이 가리킨 할 일이 그 사이 지워졌으면 목록은 그대로 두고 알린다 — 말없이 목록만 보이면 누른 것이 안 된 줄 안다 */
    if (want) { if (T.list().some(t => t.id === want)) edit(want); else toast("찾지 못한 할 일입니다 — 지워졌을 수 있습니다.", true); }
  }

  Object.assign(T, { add, setDone, setState, edit, open, calItems, todayData, todaySub, editMembers });

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const c = counts(); return c.today + c.late || ""; },
    render
  });

  /* 찾는 글에 제목도 넣는다 — text 를 주면 검색은 제목을 따로 보지 않는다 */
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "check", module: MOD, minRank: 3,
    items: () => {
      if (!T.canUse()) return [];
      const td = T.today();
      return T.list().map(t => ({ title: t.t,
        sub: [t.done ? "마침" : "", t.due ? T.dayLabel(t.due, td) : "", t.who.join(", ")].filter(Boolean).join(" · "),
        text: [t.t, t.who, t.memo, t.place, t.teams, (t.notes || []).map(n => n.x)], route: MOD, pick: () => hold(t.id) }));
    }
  });
})();
