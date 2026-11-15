/* Task 관리 화면 — 빠른 입력 · 담당자 칩 · 기한 묶음 목록 · 체크(되돌리기) · 마친 일.
   데이터 · 날짜 말 · 분류 · 사용 조건은 js/tasks-core.js 의 window.SemisTasks — 이 파일은 같은 객체에 화면 함수를 더한다 */
"use strict";

(() => {
  const { $, $$, esc, toast, ui, icon, openModal, closeModal, confirmModal } = SeMIS;
  const T = window.SemisTasks;
  const MOD = "tasks";
  const TITLE = "Task 관리";
  const PAGE = 100;   // 마친 일은 지우지 않고 쌓이므로 최근 것부터 끊어 그린다
  const st = { tab: "todo", who: null, q: "", meet: false, doneN: PAGE, qSel: null, open: "" };
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
    if (o.reset) Object.assign(st, { tab: "todo", who: null, q: "", meet: false, doneN: PAGE, qSel: null, open: "" });
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
        <label class="tk-fchk"><input type="checkbox" id="tk-f-star"${v.star ? " checked" : ""}>${icon("star", 16)}<span>중요</span></label>
        <div class="form-row"><label for="tk-f-memo">메모</label><textarea id="tk-f-memo" rows="3" maxlength="2000">${esc(v.memo)}</textarea></div>
        ${file ? `<div class="form-row"><button type="button" class="btn btn-ghost btn-sm" id="tk-f-file">${icon("doc", 15)}<span>접수 카운터 원본</span></button></div>` : ""}
      </div>
      <div class="modal-actions">
        ${x ? `<button type="button" class="btn btn-danger" data-act="del">지우기</button><span class="spacer"></span>
          <button type="button" class="btn btn-ghost" data-act="done">${v.done ? "다시 열기" : "마침"}</button>` : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="save">저장</button>
      </div>`, { sticky: true });

    const form = $("#modal-box .tk-form"), due = $("#tk-f-due"), tm = $("#tk-f-time"), cat = $("#tk-f-cat");
    /* 연 때 이름 순서를 지킨다 — 칩 순서로 다시 쓰면 손대지 않은 담당도 '바뀐 칸'이 된다 */
    const names = (gid, was) => {
      const on = $$("#" + gid + " [aria-pressed=true]").map(b => b.dataset.n);
      return union(union(was.filter(n => on.indexOf(n) >= 0), on), $("#" + gid + "-x").value.split(/[,，]/).map(s => s.trim()).filter(Boolean));
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
    /* 고친 칸도 함께 저장한다 — 칸을 고치고 바로 '마침'을 눌러도 고친 글이 사라지지 않게 */
    $('#modal-box [data-act="done"]').onclick = () => {
      const t = commit(), on = !v.done;
      if (!t) return;
      closeModal();
      if (!setDone(t.id, on)) { if (dirty) persist(); refresh(); }
      if (on) toast("마쳤습니다.", false, { label: "되돌리기", run: () => setDone(t.id, false) });
      else toast("다시 할 일로 옮겼습니다.");
    };
    $('#modal-box [data-act="del"]').onclick = () => confirmModal(`할 일 "${v.t}"을(를) 지웁니다.`, () => {
      const arr = SeMIS.data[T.KEY], i = Array.isArray(arr) ? arr.findIndex(t => t.id === v.id) : -1;
      if (i >= 0) { arr.splice(i, 1); persist(); }
      refresh();
      if (i >= 0) toast("지웠습니다."); else toast("그 사이 지워진 할 일입니다.", true);
    });
  }
  /* 검색 · 일정관리 · 아르고 결과 카드가 부른다 — 앱은 tasks/<id> 주소를 풀지 않으므로 id 를 들고 이동한 뒤, 그려지면 창을 연다 */
  function open(id) {
    st.open = String(id || "");
    if ((location.hash.replace(/^#\//, "") || "dashboard") === MOD) setTimeout(() => SeMIS.renderView(), 0);
    else SeMIS.navigate(MOD);
  }

  function render(el) {
    root = el;
    const want = st.open;   // 한 번만 쓴다 — 나중에 다시 그릴 때 창이 또 뜨지 않게
    st.open = "";
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
    /* 오래된 검색 결과 · 일정 칩이 가리킨 할 일이 그 사이 지워졌으면 목록은 그대로 두고 알린다 — 말없이 목록만 보이면 누른 것이 안 된 줄 안다 */
    if (want) { if (T.list().some(t => t.id === want)) edit(want); else toast("찾지 못한 할 일입니다 — 지워졌을 수 있습니다.", true); }
  }

  Object.assign(T, { add, setDone, setState, edit, open });

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const c = counts(); return c.today + c.late || ""; },
    render
  });
})();
