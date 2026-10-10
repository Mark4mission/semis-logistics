/* 아르고 — ARGOS AI 도우미(공통 패널). Edge Function semis-logi-argo 가 Claude 를 부르고, 도구는 이 화면이 실행한다
   (이미 권한대로 받은 자료 · 각 모듈 API · SeMIS.save → 동기화 · 409 병합 그대로). 쓰기는 안전보안파트(hq) 이상, 바로 실행 + 결과 카드 + 되돌리기.
   지우기 · 여러 건만 한 번 확인. 대화는 이 탭 sessionStorage(계정별 20개 질문) — 서버에는 남지 않는다.
   되돌리기는 실행 전후를 항목 단위로 비교한 역연산(추가 → 삭제, 고침 → 이전 값) — 그 사이 다른 사람이 고친 항목은 그대로 둔다. */
"use strict";

(() => {
  const { $, esc, toast, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "argo", PID = "argo", TITLE = "아르고";
  const MAX_TURNS = 20, MAX_CALLS = 6, MAX_FILES = 3, Q_MAX = 4000;
  const PDF_MAX = 4.5 * 1024 * 1024, IMG_SIDE = 1600, TEXT_MAX = 30000, RESULT_MAX = 24000, LOG_MAX = 900;
  const SS = "semisl:argo:";
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s));
  const isHM = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const str = (v, n) => (typeof v === "string" || typeof v === "number" ? norm(v).slice(0, n || 200) : "");
  const cut = (s, n) => { s = String(s == null ? "" : s).trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "";
  const todayISO = () => fixedToday || toISO(new Date());
  const addDays = (iso, n) => { const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
  const dot = (s) => (isISO(s) ? s.replace(/-/g, ".") : String(s || ""));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const me = () => { const u = SeMIS.user; return u ? u.name || u.id || "" : ""; };
  const rank = () => SeMIS.roleRank();
  const internal = () => { const u = SeMIS.user; return !!u && u.role !== "vendor" && u.role !== "signer"; };
  const canUse = () => internal() && SeMIS.hasModule(MOD);
  const canW = () => internal() && rank() >= 3;
  const C = () => window.SemisCalendar;
  /* 화면 권한 — 통합 검색과 같은 범위(메뉴가 보이고 모듈이 있는 것) */
  function canMod(m) {
    if (!m) return true;
    const mn = SeMIS.menuForModule && SeMIS.menuForModule(m);
    return !!(mn && (SeMIS.navVisible ? SeMIS.navVisible(mn) : SeMIS.canSee(mn)) && SeMIS.hasModule(m));
  }

  /* ── 대화 저장(이 탭) ── */
  let conv = null, convKey = "";
  const keyNow = () => SS + (SeMIS.user ? String(SeMIS.user.origId || SeMIS.user.id || "") : "_");
  function C0() {
    const k = keyNow();
    if (conv && convKey === k) return conv;
    convKey = k; conv = null;
    try { conv = JSON.parse(sessionStorage.getItem(k) || "null"); } catch (e) { conv = null; }
    if (!isObj(conv) || !Array.isArray(conv.turns)) conv = { turns: [], undo: [] };
    if (!Array.isArray(conv.undo)) conv.undo = [];
    conv.turns.forEach(t => {
      if (t.pending) { t.pending = false; if (!t.a && !t.err) t.err = "답을 받기 전에 화면이 닫혔습니다."; }
      arr(t.cards).forEach(c => { if (c.k === "confirm" && c.state === "wait") c.state = "no"; });
    });
    return conv;
  }
  function persist() {
    const c = C0();
    if (c.turns.length > MAX_TURNS) c.turns = c.turns.slice(-MAX_TURNS);
    const live = new Set();
    c.turns.forEach(t => arr(t.cards).forEach(x => { if (x.undo) live.add(x.undo); }));
    c.undo = c.undo.filter(u => live.has(u.id)).slice(-40);
    for (let i = 0; i < 3; i++) {
      try { sessionStorage.setItem(convKey, JSON.stringify(c)); return; } catch (e) { c.turns = c.turns.slice(-Math.max(2, Math.floor(c.turns.length / 2))); }
    }
  }

  /* ── Edge 호출 ── */
  const ERR = {
    auth: "접속이 만료되었습니다. 다시 로그인한 뒤 물어봐 주세요.", forbidden: "이 계정은 아르고를 쓸 수 없습니다.",
    no_key: "AI 설정이 없습니다. 시스템관리자에게 알려 주세요.", bad_key: "AI 설정 오류입니다. 시스템관리자에게 알려 주세요.",
    busy: "AI 사용량이 많습니다. 잠시 뒤 다시 물어봐 주세요.", too_large: "첨부가 너무 큽니다. 파일을 줄이거나 나눠서 보내 주세요.",
    bad_request: "요청을 보내지 못했습니다. '새 대화'로 다시 시도해 주세요.", offline: "인터넷 연결을 확인해 주세요."
  };
  function errText(e) {
    const c = e && e.code;
    if (c === "limit") return "오늘 사용량(" + (e.limit || 200) + "회)을 모두 썼습니다. 내일 0시에 다시 쓸 수 있습니다.";
    return ERR[c] || "답을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  }
  async function call(messages) {
    const A = window.SemisSync && SemisSync.auth;
    const tok = A && A.token ? A.token() : "";
    const url = window.SemisSync && SemisSync.FN_ARGO;
    if (!tok) { const e = new Error("auth"); e.code = "auth"; throw e; }
    if (!url || typeof fetch === "undefined") { const e = new Error("offline"); e.code = "offline"; throw e; }
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-semis-token": tok }, body: JSON.stringify({ messages }) });
    } catch (er) { const e = new Error("offline"); e.code = "offline"; throw e; }
    let d = null;
    try { d = await res.json(); } catch (er) { d = null; }
    if (res.status === 401 && A && A.check) { try { A.check(); } catch (er) { /* 세션 확인 실패는 무시 */ } }
    if (!res.ok || !d || d.ok !== true) {
      const e = new Error("argo " + ((d && d.error) || res.status));
      e.code = (d && d.error) || "http"; e.limit = d && d.limit; e.used = d && d.used;
      throw e;
    }
    return d;
  }

  /* ── 자료 요약(도구 결과) — 그림 · 서명 · 서식 원문 · 암호 칸은 빼고 길이를 줄인다 ── */
  const FILE_RE = /\/storage\/v1\/object\//;
  const SKIP = /^(sign|signs|img|image|images|photo|thumb|preview|pw|password|secret|token|hash|cipher|iv|salt|ai|base_at|raw|svg)$|html$/i;
  const FILE_KEYS = ["files", "notice", "docs", "pledgeFiles"];
  function slim(v, d) {
    d = d || 0;
    if (v == null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v === "string") { if (/^data:/.test(v)) return "(그림)"; if (FILE_RE.test(v)) return "(파일)"; return cut(v, 300); }
    if (Array.isArray(v)) {
      if (d > 3) return "[" + v.length + "건]";
      const a = v.slice(0, 40).map(x => slim(x, d + 1));
      if (v.length > 40) a.push("…외 " + (v.length - 40) + "건");
      return a;
    }
    if (typeof v === "object") {
      if (d > 3) return "{…}";
      const o = {};
      Object.keys(v).forEach(k => {
        const x = v[k];
        if (SKIP.test(k) || x === "" || x == null || (Array.isArray(x) && !x.length)) return;
        if (FILE_KEYS.indexOf(k) >= 0 && Array.isArray(x)) { o[k] = x.map(f => (f && f.name) || "파일"); return; }
        o[k] = slim(x, d + 1);
      });
      return o;
    }
    return String(v);
  }
  const names = (fs) => arr(fs).map(f => (f && f.name) || "파일");
  function capJSON(r) {
    let s = JSON.stringify(r == null ? {} : r);
    if (s.length <= RESULT_MAX) return s;
    if (isObj(r) && Array.isArray(r.items)) {
      const all = r.items.length;
      let items = r.items.slice();
      while (items.length > 1 && JSON.stringify(Object.assign({}, r, { items })).length > RESULT_MAX - 200) items = items.slice(0, Math.floor(items.length * 0.75));
      return JSON.stringify(Object.assign({}, r, { items, note: "전체 " + all + "건 중 앞 " + items.length + "건(길이 제한) — query · from/to 로 좁혀 다시 조회" }));
    }
    return JSON.stringify({ note: "길이 제한으로 잘림", text: s.slice(0, RESULT_MAX - 200) });
  }
  const terms = (q) => String(q || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  function pick(list, inp, dflt) {
    const ts = terms(inp.query);
    const from = isISO(inp.from) ? inp.from : "", to = isISO(inp.to) ? inp.to : "";
    let out = list;
    if (ts.length) out = out.filter(x => { const j = JSON.stringify(x).toLowerCase(); return ts.every(t => j.indexOf(t) >= 0); });
    if (from || to) out = out.filter(x => (JSON.stringify(x).match(/\d{4}-\d{2}-\d{2}/g) || []).some(d => (!from || d >= from) && (!to || d <= to)));
    const lim = Math.max(1, Math.min(200, Math.round(Number(inp.limit)) || dflt || 50));
    return { total: out.length, items: out.slice(0, lim) };
  }

  /* ── 읽기 도구 ── */
  const deny = (what) => ({ error: "권한 밖: " + what + " — 이 계정으로는 볼 수 없습니다." });
  function goOk(route) {
    const r = String(route || "");
    if (r === "dashboard") return true;
    if (r === "desk") return !!(SeMIS.supportOk && SeMIS.supportOk("desk"));
    if (!/^[a-z0-9-]{2,40}$/.test(r)) return false;
    return canMod(r);
  }
  function find(inp) {
    const q = str(inp.query, 80);
    if (!q) return { error: "query 가 비었습니다." };
    if (!window.SemisSearch) return { error: "검색을 쓸 수 없습니다." };
    const lim = Math.max(1, Math.min(20, Math.round(Number(inp.limit)) || 12));
    const hits = SemisSearch.search(q).slice(0, lim).map(it => {
      const go = it.route && goOk(it.route) ? it.route : (it.group === "메인 데스크" && goOk("desk") ? "desk" : "");
      return { group: it.group, title: cut(it.title, 120), sub: cut(it.sub, 160), go: go || undefined, link: it.url ? "외부 사이트" : undefined };
    });
    return { query: q, count: hits.length, items: hits };
  }

  /* 기간 일정 — 반복 일정은 회차로 펼치고 보안 기록부 점검 기한도 넣는다 */
  function schedOcc(from, to) {
    const CA = C();
    if (!CA) return [];
    const out = [];
    arr(D().schedules).forEach(e => {
      if (!e || !e.id || !isISO(e.start) || !CA.canSeePriv(e)) return;
      const dur = Math.max(0, dayDiff(e.start, isISO(e.end) ? e.end : e.start));
      const row = (s, dn) => ({ id: e.id, title: e.title, start: s, end: addDays(s, dur), time: e.allDay ? "" : e.time || "", timeEnd: e.allDay ? "" : e.timeEnd || "",
        assignee: e.assignee || "", color: e.color || "", done: !!dn, room: !!e.room, repeat: CA.isRepeat(e) ? CA.repeatLabel(e) : undefined, memo: cut(e.memo, 120) || undefined });
      if (!CA.isRepeat(e)) { if (e.start <= to && addDays(e.start, dur) >= from) out.push(row(e.start, e.done)); return; }
      const seen = {};
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const occ = CA.occursOn(e, d);
        if (occ && !seen[occ]) { seen[occ] = 1; out.push(row(occ, CA.occDone(e, occ))); }
      }
    });
    if (CA.inspOnDay && canMod("inspection")) {
      const seen = {};
      for (let d = from; d <= to; d = addDays(d, 1)) {
        arr(CA.inspOnDay(d)).forEach(x => {
          const k = x.ik || x.title + x.start;
          if (seen[k]) return;
          seen[k] = 1;
          out.push({ kind: "점검 기한", title: x.title, start: x.start, end: x.end, done: !!x.done });
        });
      }
    }
    return out.sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.time || "").localeCompare(String(b.time || "")));
  }
  function weekOf(t) { const dow = (new Date(t + "T00:00:00Z").getUTCDay() + 6) % 7; const s = addDays(t, -dow); return [s, addDays(s, 6)]; }
  function trainingDue(days) {
    const TR = window.SemisTraining;
    if (!TR || !canMod("training")) return null;
    return arr(TR.dueList(days, todayISO())).map(c => ({ name: c.p.name, dept: c.p.dept || undefined, course: c.g.name, status: (TR.ST[c.st] || {}).label || c.st,
      date: TR.ddDate(c) || undefined, dday: TR.ddLabel(c, todayISO()) || undefined }));
  }
  function openFindings() {
    const A = window.SemisAudit;
    if (!A || !canMod("audit")) return null;
    const t = todayISO();
    return arr(A.allFindings()).filter(x => x.a && !x.a.cancelled && x.f && x.f.status !== "done").map(({ a, f }) => ({
      audit: A.auditTitle(a), audit_id: a.id, id: f.id, type: (A.FTYPES[f.type] || {}).label || f.type, ref: f.ref || undefined, text: cut(f.text, 300),
      due: f.due || undefined, overdue: isISO(f.due) && f.due < t ? true : undefined, status: (A.FSTAT[f.status] || {}).label || f.status }));
  }
  function seclogMissing() {
    const SL = window.SemisSeclog;
    if (!SL || !canMod("inspection")) return null;
    const t = todayISO();
    return SL.templates().map(tp => {
      const s = SL.status(tp, t);
      if (s.event) return null;
      const miss = s.missing.map(c => SL.periodLabel(tp, c.k));
      if (!miss.length && s.cur.done) return null;
      return { form: tp.name, cycle: SL.cycLabel(tp), missing: miss.slice(-12), missingCount: miss.length, currentDone: !!s.cur.done, last: s.last || undefined };
    }).filter(Boolean);
  }
  function noticesList(n) {
    return arr(D().notices).filter(x => x && x.id).slice().sort((a, b) => (b.pinned - a.pinned) || String(b.created).localeCompare(String(a.created)))
      .slice(0, n).map(x => ({ id: x.id, title: x.title, date: String(x.created || "").slice(0, 10), pinned: !!x.pinned || undefined, body: cut(x.body, 300) }));
  }
  function status(inp) {
    const t = todayISO(), topic = String(inp.topic || "");
    if (topic === "sec_level") { const c = SeMIS.secCurrent(), n = SeMIS.secNext && SeMIS.secNext(); return { level: c.level, since: c.date || undefined, until: c.end || undefined, note: c.note || undefined, next: n ? { level: n.level, from: n.date } : undefined }; }
    if (topic === "notices") return { items: noticesList(10) };
    if (topic === "schedule") {
      if (!canMod("schedule")) return deny("일정관리(화물팀 관리자 이상)");
      let [from, to] = weekOf(t);
      if (isISO(inp.from)) { from = inp.from; to = isISO(inp.to) && inp.to >= from ? inp.to : addDays(from, 6); }
      else if (isISO(inp.to)) { to = inp.to; from = addDays(to, -6); }
      if (dayDiff(from, to) > 92) to = addDays(from, 92);
      return { from, to, items: schedOcc(from, to).slice(0, 150) };
    }
    if (topic === "training_due") {
      const days = Math.max(1, Math.min(400, Math.round(Number(inp.days)) || 90));
      const l = trainingDue(days);
      return l ? { days, count: l.length, items: l.slice(0, 120) } : deny("보안교육(화물팀 관리자 이상)");
    }
    if (topic === "audit_open") {
      const l = openFindings();
      if (!l) return deny("수검 대응(화물팀 관리자 이상)");
      const nx = window.SemisAudit.nextAudit(t);
      return { count: l.length, overdue: l.filter(x => x.overdue).length, next_audit: nx ? { title: window.SemisAudit.auditTitle(nx), start: nx.start, id: nx.id } : undefined, items: l.slice(0, 120) };
    }
    if (topic === "seclog_missing") { const l = seclogMissing(); return l ? { items: l } : deny("보안 기록부(화물팀 관리자 이상)"); }
    if (topic === "desk_pending") {
      if (!window.SemisDesk || !(SeMIS.supportOk && SeMIS.supportOk("desk"))) return deny("메인 데스크(안전보안파트 이상)");
      return { items: SemisDesk.pending().map(e => ({ title: e.title || (e.file && e.file.name) || "", at: String(e.at || "").slice(0, 10), status: e.status === "reading" ? "판독 중" : "확인 대기", err: e.err || undefined })) };
    }
    if (topic === "overview") {
      const c = SeMIS.secCurrent(), o = { today: t, sec_level: c.level };
      if (canMod("schedule")) { const [ws, we] = weekOf(t); const all = schedOcc(ws, we); o.schedules = { today: all.filter(x => x.start <= t && x.end >= t).length, this_week: all.length, open_this_week: all.filter(x => !x.done).length }; }
      const tr = trainingDue(90);
      if (tr) o.training = { needs_action: tr.length, expired_or_missing: tr.filter(x => /만료|미이수|정지|경과/.test(x.status)).length };
      const fs = openFindings();
      if (fs) { const nx = window.SemisAudit.nextAudit(t); o.audit = { open_findings: fs.length, overdue: fs.filter(x => x.overdue).length, next: nx ? window.SemisAudit.auditTitle(nx) + " " + (nx.start || "") : undefined }; }
      const sl = seclogMissing();
      if (sl) o.seclog = { forms_with_missing: sl.filter(x => x.missingCount).length, missing_total: sl.reduce((n, x) => n + x.missingCount, 0) };
      o.notices = noticesList(3).map(x => x.title);
      if (window.SemisDesk && SeMIS.supportOk && SeMIS.supportOk("desk")) o.desk_pending = SemisDesk.pending().length;
      return o;
    }
    return { error: "알 수 없는 topic" };
  }

  /* 자료 목록 — 화면 권한(메뉴)과 같은 범위, 민감보안정보는 안전보안파트 이상만 */
  function schedView(e) {
    const CA = C();
    return { id: e.id, title: e.title, start: e.start, end: e.end && e.end !== e.start ? e.end : undefined, time: e.allDay ? undefined : e.time || undefined,
      timeEnd: e.allDay ? undefined : e.timeEnd || undefined, assignee: e.assignee || undefined, color: e.color, done: !!e.done || undefined, room: !!e.room || undefined,
      repeat: CA && CA.isRepeat(e) ? CA.repeatLabel(e) : undefined, private: e.priv ? true : undefined, memo: cut(e.memo, 200) || undefined };
  }
  function trainingRows() {
    const TR = window.SemisTraining, t = D().training;
    if (!isObj(t)) return [];
    const ps = {}; arr(t.people).forEach(p => { if (p && p.id) ps[p.id] = p; });
    const cs = {}; (TR ? TR.courses() : arr(t.courses)).forEach(c => { if (c && c.id) cs[c.id] = c; });
    const people = Object.keys(ps).map(id => { const p = ps[id]; return { type: "인원", id, name: p.name, emp: p.emp || undefined, dept: p.dept || undefined,
      roles: arr(p.roles).length ? p.roles : undefined, left: p.left || undefined, pledge: p.pledge || undefined }; });
    const recs = arr(t.records).filter(r => r && r.id).map(r => ({ type: "이수 기록", id: r.id, name: (ps[r.pid] || {}).name || "", course: (cs[r.cid] || {}).name || r.cid,
      course_id: r.cid, date: r.date, expire: r.expire || undefined, org: r.org || undefined, certNo: r.certNo || undefined, files: names(r.files).length ? names(r.files) : undefined }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return people.concat(recs);
  }
  const COLS = {
    notices: { mod: "", label: "공지", rows: () => noticesList(500) },
    schedules: { mod: "schedule", label: "일정관리", rows: () => arr(D().schedules).filter(e => e && e.id && (!C() || C().canSeePriv(e))).map(schedView).sort((a, b) => String(b.start).localeCompare(String(a.start))) },
    minutes: { mod: "minutes", label: "회의록", rows: () => (window.SemisMinutes ? SemisMinutes.visibleAll() : []).map(m => ({ id: m.id, title: m.title, no: m.no || undefined,
      folder: SemisMinutes.folderName ? SemisMinutes.folderName(m.folder) : undefined, date: m.date, time: m.time || undefined, place: m.place || undefined,
      attendees: arr(m.attendees).length || undefined, agenda: cut(m.agenda, 300) || undefined, body: cut(m.body, 600) || undefined,
      decisions: arr(m.decisions).map(d => ({ task: cut(d.task, 200), owner: d.owner || undefined, due: d.due || undefined, done: !!d.done || undefined })),
      next: m.nextDate || undefined, status: m.status === "final" ? "확정" : "작성 중" })).sort((a, b) => String(b.date).localeCompare(String(a.date))) },
    phonebook: { mod: "phonebook", label: "업무 연락처", rows: () => { const p = isObj(D().phonebook) ? D().phonebook : {}; const g = {}; arr(p.groups).forEach(x => { if (x && x.id) g[x.id] = x.name; });
      return arr(p.rows).map(r => Object.assign({ zone: g[r.group] || undefined }, slim(r))); } },
    contacts: { mod: "contacts", label: "비상연락망", rows: () => { const c = isObj(D().contacts) ? D().contacts : {}; const out = [];
      arr(c.sections).forEach(s => arr(s && s.rows).forEach(r => out.push(Object.assign({ section: s.title }, slim(r))))); return out; } },
    crisis: { mod: "crisis", label: "위기대응 조직", rows: () => arr(isObj(D().crisis) ? D().crisis.rows : []).map(r => slim(r)) },
    training: { mod: "training", label: "보안교육", rows: trainingRows },
    audits: { mod: "audit", label: "수검 대응", rows: () => arr(D().audits).filter(a => a && a.id).map(a => ({ id: a.id, title: window.SemisAudit ? SemisAudit.auditTitle(a) : a.org,
      org: a.org, kind: a.kind, start: a.start, end: a.end || undefined, cancelled: a.cancelled || undefined, outcome: a.outcome || undefined, files: names(a.files).length ? names(a.files) : undefined,
      findings: arr(a.findings).map(f => ({ id: f.id, type: f.type, ref: f.ref || undefined, text: cut(f.text, 300), due: f.due || undefined, status: f.status })) }))
      .sort((a, b) => String(b.start).localeCompare(String(a.start))) },
    docs: { mod: "", label: "문서 서가", rows: () => arr(D().docs).filter(d => d && d.id && (!d.ssi || rank() >= 3) && canMod(d.mod)).map(d => ({ id: d.id, title: d.title,
      where: (SeMIS.menuForModule(d.mod) || {}).label + " › " + (window.SemisDocs ? SemisDocs.labelOf(d.mod, d.grp) : d.grp), go: d.mod, date: d.date || undefined, org: d.org || undefined,
      ssi: d.ssi || undefined, files: names(d.files) })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))) },
    regulations: { mod: "", label: "규정", rows: () => arr(D().regulations).filter(r => r && r.id && canMod("reg-" + (r.scope === "dg" ? "dg" : r.scope === "safety" ? "safety" : "sec")))
      .map(r => ({ id: r.id, scope: r.scope, title: r.title, rev: r.rev || undefined, date: r.date || undefined, org: r.org || undefined, note: cut(r.note, 200) || undefined, ideas: arr(r.ideas).length || undefined })) },
    equipment: { mod: "scr-equip", label: "검색장비", rows: () => arr(D().equipment).filter(x => x && x.id).map(x => Object.assign(slim(Object.assign({}, x, { logs: undefined })),
      { logs: arr(x.logs).slice(-5).map(l => ({ date: l.date, kind: l.kind, text: cut(l.text, 160) })) })) },
    sec_cases: { mod: "sec-cases", label: "보안 처리 대장", rows: () => arr(D().secCases).filter(x => x && x.id).map(x => slim(x)).sort((a, b) => String(b.date).localeCompare(String(a.date))) },
    dissem: { mod: "dissem", label: "전파교육", rows: () => arr(isObj(D().dissem) ? D().dissem.events : []).filter(x => x && x.id).map(x => ({ id: x.id, date: x.date, title: x.title, kind: x.kind,
      src: x.src || undefined, targets: arr(x.targets).length, done: window.SemisDissem && SemisDissem.done ? (() => { try { return SemisDissem.done(x); } catch (e) { return undefined; } })() : undefined, note: x.note || undefined }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date))) },
    partners: { mod: "partners", label: "협력사 · 보안요원", rows: () => { const p = isObj(D().partners) ? D().partners : {}; const vs = {}; arr(p.vendors).forEach(v => { if (v && v.id) vs[v.id] = v.name; });
      return arr(p.vendors).map(v => Object.assign({ type: "업체" }, slim(v))).concat(arr(p.staff).filter(s => s && !s.left).map(s => Object.assign({ type: "요원", vendor: vs[s.vid] || undefined }, slim(s)))); } },
    seclog: { mod: "inspection", label: "보안 기록부", rows: () => (window.SemisSeclog ? SemisSeclog.logs() : []).map(r => { const tp = SemisSeclog.tplOf(r.tid);
      return Object.assign({ form: tp ? tp.name : r.tid }, slim(Object.assign({}, r, { tid: undefined }))); }).sort((a, b) => String(b.date).localeCompare(String(a.date))) },
    contracts: { mod: "contracts", label: "계약 · 협약", rows: () => arr(D().contracts).filter(x => x && x.id).map(x => slim(x)) },
    kcra: { mod: "kc-ra", label: "상용화주 · RA", rows: () => arr(isObj(D().kcra) ? D().kcra.list : []).filter(x => x && x.id).map(x => slim(x)) }
  };
  function records(inp) {
    const c = COLS[inp.collection];
    if (!c) return { error: "알 수 없는 collection" };
    if (c.mod && !canMod(c.mod)) return deny(c.label);
    let rows = [];
    try { rows = c.rows() || []; } catch (e) { rows = []; }
    const r = pick(rows, inp, 50);
    return { collection: inp.collection, total: r.total, items: r.items };
  }
  function catalog() {
    const c = window.SemisDesk ? SemisDesk.catalog() : {};
    const cfg = isObj(D().desk) && isObj(D().desk.cfg) && isObj(D().desk.cfg.areas) ? D().desk.cfg.areas : {};
    return Object.assign({}, c, {
      colors: (C() ? C().COLORS : []).map(x => x.id + " " + x.label),
      assignees: SeMIS.assignees().map(a => a && a.name).filter(Boolean),
      areas: { security: cfg.security || "", safety: cfg.safety || "", industrial: cfg.industrial || "", dg: cfg.dg || "" }
    });
  }

  /* ── 되돌리기: 항목 단위 비교 ──
     경로 마디 = 객체 키(문자열) 또는 { id } (id 가 있는 객체 배열의 항목). 연산 add(추가됨 → 지움) · del(지워짐 → 되살림) · set(값 → 이전 값) */
  const idArr = (x) => Array.isArray(x) && x.every(e => isObj(e) && typeof e.id === "string" && e.id);
  function diff(b, a, path, out) {
    if (same(b, a)) return out;
    if (idArr(b) && idArr(a)) {
      const bm = {}, am = {};
      b.forEach(e => { bm[e.id] = e; }); a.forEach(e => { am[e.id] = e; });
      a.forEach(e => { if (!bm[e.id]) out.push({ t: "add", path, id: e.id }); });
      b.forEach((e, i) => { if (!am[e.id]) out.push({ t: "del", path, id: e.id, before: clone(e), idx: i }); });
      a.forEach(e => { if (bm[e.id] && !same(bm[e.id], e)) diff(bm[e.id], e, path.concat([{ id: e.id }]), out); });
      return out;
    }
    if (isObj(b) && isObj(a)) {
      Array.from(new Set(Object.keys(b).concat(Object.keys(a)))).forEach(k => diff(b[k], a[k], path.concat([k]), out));
      return out;
    }
    out.push({ t: "set", path, before: clone(b) });
    return out;
  }
  function resolve(path) {
    let cur = D();
    for (const seg of path) {
      if (cur == null) return undefined;
      cur = isObj(seg) ? (Array.isArray(cur) ? cur.find(e => e && e.id === seg.id) : undefined) : cur[seg];
    }
    return cur;
  }
  function invert(op) {
    if (op.t === "add") { const a = resolve(op.path); if (!Array.isArray(a)) return false; const i = a.findIndex(e => e && e.id === op.id); if (i < 0) return false; a.splice(i, 1); return true; }
    if (op.t === "del") { const a = resolve(op.path); if (!Array.isArray(a)) return false; if (a.some(e => e && e.id === op.id)) return true; a.splice(Math.min(op.idx, a.length), 0, clone(op.before)); return true; }
    if (op.t === "set") {
      if (op.path.length < 2) return false;
      const par = resolve(op.path.slice(0, -1)), k = op.path[op.path.length - 1];
      if (par == null || typeof par !== "object" || isObj(k)) return false;
      if (op.before === undefined) delete par[k]; else par[k] = clone(op.before);
      return true;
    }
    return false;
  }
  function latestUndo() { const u = C0().undo; for (let i = u.length - 1; i >= 0; i--) if (!u[i].done) return u[i]; return null; }
  function undo(id) {
    if (busy) { toast("답을 받는 중에는 되돌릴 수 없습니다.", true); return false; }
    const u = C0().undo.find(x => x.id === id);
    if (!u || u.done) return false;
    if (latestUndo() !== u) { toast("가장 최근에 실행한 것부터 되돌릴 수 있습니다.", true); return false; }
    let miss = 0;
    u.ops.slice().reverse().forEach(op => { if (!invert(op)) miss++; });
    u.done = true;
    SeMIS.save();
    C0().turns.forEach(t => arr(t.cards).forEach(c => { if (c.undo === id) c.state = "undone"; }));
    const t = C0().turns.find(x => arr(x.cards).some(c => c.undo === id));
    if (t) t.log = cut((t.log ? t.log + "; " : "") + "[되돌림] " + u.label, LOG_MAX);
    persist();
    paintLog();
    try { SeMIS.renderView(); } catch (e) { /* 뒤 화면 다시 그리기 실패는 무시 */ }
    toast(miss ? "되돌렸습니다 — 그 사이 바뀐 " + miss + "곳은 건너뛰었습니다." : "되돌렸습니다.");
    return true;
  }

  /* ── 쓰기 도구 ── */
  const COLORS = () => (C() ? C().COLORS.map(x => x.id) : ["blue"]);
  const REMS = ["2w", "1w", "1d", "1h"];
  function memoHtml(memo) {
    const h = String(memo || "").split("\n").filter(l => l.trim()).map(l => "<p>" + esc(l) + "</p>").join("");
    return window.SemisNotice ? SemisNotice.sanitizeHtml(h) : h;
  }
  function schedIn(it, i) {
    const title = str(it.title, 120);
    if (!title) return { error: (i != null ? (i + 1) + "번째 " : "") + "일정 이름이 없습니다." };
    if (!isISO(it.start)) return { error: "'" + title + "' 시작일(YYYY-MM-DD)이 필요합니다." };
    const end = isISO(it.end) && it.end >= it.start ? it.end : it.start;
    const time = isHM(it.time) ? it.time : "";
    const memo = [String(it.memo || "").trim().slice(0, 2000), it.place ? "장소: " + str(it.place, 80) : ""].filter(Boolean).join("\n");
    return { title, start: it.start, end, allDay: !time, time, timeEnd: time && isHM(it.time_end) ? it.time_end : "", memo, memoHtml: memoHtml(memo),
      color: COLORS().indexOf(it.color) >= 0 ? it.color : "blue", assignee: C() ? C().joinNames(C().splitNames(str(it.assignee, 120))) : str(it.assignee, 120),
      room: it.room === true || (/회의실/.test(it.place || "") && /화물\s*터미널/.test(it.place || "")), reminders: arr(it.reminders).filter(r => REMS.indexOf(r) >= 0) };
  }
  function schedRec(o) {
    return Object.assign({ id: uid("s"), memo: "", memoHtml: "", end: o.start, allDay: true, time: "", timeEnd: "", color: "blue", assignee: "", vehicle: false, room: false,
      reminders: [], repeat: { freq: "none", until: "" }, done: false, doneFrom: "", doneDates: [], undoneDates: [], priv: false, owner: "", autoDefer: false, autoExtend: false, src: "argo" }, o);
  }
  const findEv = (id) => arr(D().schedules).find(e => e && e.id === id && (!C() || C().canSeePriv(e))) || null;
  const evLine = (e) => dot(e.start) + (e.end && e.end !== e.start ? " ~ " + dot(e.end) : "") + (e.time && !e.allDay ? " " + e.time : "") + " " + e.title;
  const SCHED_GO = [{ label: "일정관리", route: "schedule" }];
  const audLink = (e) => /^(aud_|audf_)/.test(String(e && e.id));
  function backSync(e) { if (C() && C().backSyncInsp) { try { C().backSyncInsp(e); } catch (er) { /* 연동 실패는 일정만 */ } } }

  const W = {
    schedule_add: {
      label: "일정 등록", keys: ["schedules"],
      confirm: (inp) => arr(inp.items).length >= 2,
      preview: (inp) => arr(inp.items).slice(0, 20).map(it => dot(it.start) + (it.time ? " " + it.time : "") + " " + str(it.title, 80)),
      prep(inp) {
        const items = arr(inp.items).slice(0, 20);
        if (!items.length) return { error: "등록할 일정이 없습니다." };
        const list = [];
        for (let i = 0; i < items.length; i++) { const x = schedIn(isObj(items[i]) ? items[i] : {}, items.length > 1 ? i : null); if (x.error) return x; list.push(x); }
        return { list };
      },
      run(inp, ctx, p) {
        if (!Array.isArray(D().schedules)) D().schedules = [];
        const recs = p.list.map(o => schedRec(o));
        recs.forEach(r => D().schedules.push(r));
        return { lines: recs.map(evLine), go: SCHED_GO, result: { ids: recs.map(r => r.id) }, log: "schedule_add " + recs.map(r => r.id + " '" + r.title + "' " + r.start).join(", ") };
      }
    },
    schedule_update: {
      label: "일정 수정", keys: ["schedules", "audits"],
      prep(inp) {
        const e = findEv(inp.id);
        if (!e) return { error: "일정을 찾지 못했습니다(id 확인): " + str(inp.id, 40) };
        if (inp.start != null && !isISO(inp.start)) return { error: "start 는 YYYY-MM-DD 여야 합니다." };
        if (inp.end != null && !isISO(inp.end)) return { error: "end 는 YYYY-MM-DD 여야 합니다." };
        if (inp.time != null && inp.time !== "" && !isHM(inp.time)) return { error: "time 은 HH:MM 이어야 합니다." };
        if (inp.title != null && !str(inp.title, 120)) return { error: "일정 이름이 비었습니다." };
        return { e };
      },
      run(inp, ctx, p) {
        const e = p.e, ch = [];
        if (inp.title != null) { e.title = str(inp.title, 120); ch.push("이름"); }
        if (isISO(inp.start)) {
          const dur = Math.max(0, dayDiff(e.start, isISO(e.end) ? e.end : e.start));
          e.start = inp.start; e.end = isISO(inp.end) && inp.end >= inp.start ? inp.end : addDays(inp.start, dur); ch.push("날짜");
        } else if (isISO(inp.end)) { e.end = inp.end >= e.start ? inp.end : e.start; ch.push("종료일"); }
        if (inp.all_day === true) { e.allDay = true; e.time = ""; e.timeEnd = ""; ch.push("종일"); }
        else if (isHM(inp.time)) { e.allDay = false; e.time = inp.time; if (isHM(inp.time_end)) e.timeEnd = inp.time_end; ch.push("시각"); }
        else if (isHM(inp.time_end) && !e.allDay) { e.timeEnd = inp.time_end; ch.push("끝 시각"); }
        if (inp.memo != null || inp.place != null) {
          const memo = [inp.memo != null ? String(inp.memo).trim().slice(0, 2000) : String(e.memo || "").replace(/\n?장소: .*$/m, "").trim(),
            inp.place != null ? (str(inp.place, 80) ? "장소: " + str(inp.place, 80) : "") : ((/장소: .*$/m.exec(String(e.memo || "")) || [""])[0])].filter(Boolean).join("\n");
          e.memo = memo; e.memoHtml = memoHtml(memo); ch.push(inp.memo != null ? "메모" : "장소");
        }
        if (inp.assignee != null) { e.assignee = C() ? C().joinNames(C().splitNames(str(inp.assignee, 120))) : str(inp.assignee, 120); ch.push("담당자"); }
        if (inp.color != null && COLORS().indexOf(inp.color) >= 0) { e.color = inp.color; ch.push("색"); }
        if (typeof inp.room === "boolean") { e.room = inp.room; ch.push("회의실"); }
        if (Array.isArray(inp.reminders)) { e.reminders = inp.reminders.filter(r => REMS.indexOf(r) >= 0); ch.push("미리알림"); }
        if (!ch.length) return { error: "바꿀 내용이 없습니다." };
        backSync(e);
        return { lines: [evLine(e), "바뀐 칸: " + ch.join(" · ")], go: SCHED_GO, result: { id: e.id, changed: ch }, log: "schedule_update " + e.id + " (" + ch.join(",") + ")" };
      }
    },
    schedule_done: {
      label: "일정 완료", keys: ["schedules", "audits"],
      prep(inp) {
        const e = findEv(inp.id);
        if (!e) return { error: "일정을 찾지 못했습니다(id 확인): " + str(inp.id, 40) };
        if (typeof inp.done !== "boolean") return { error: "done(true · false)이 필요합니다." };
        const rep = C() && C().isRepeat(e);
        const scope = ["one", "future", "all"].indexOf(inp.scope) >= 0 ? inp.scope : "one";
        if (rep && scope !== "all") {
          if (!isISO(inp.date)) return { error: "반복 일정은 date(완료할 회차 날짜)가 필요합니다." };
          if (C().occursOn(e, inp.date) !== inp.date) return { error: inp.date + " 은 이 반복 일정의 회차가 아닙니다." };
        }
        return { e, rep, scope };
      },
      run(inp, ctx, p) {
        const e = p.e;
        C().applyOccDone(e, p.rep ? (isISO(inp.date) ? inp.date : e.start) : null, p.scope, !!inp.done);
        if (!p.rep) backSync(e);
        const what = (inp.done ? "완료" : "완료 해제") + (p.rep ? " · " + (p.scope === "all" ? "전체" : p.scope === "future" ? dot(inp.date) + " 이후 모두" : dot(inp.date) + " 회차") : "");
        return { lines: [evLine(e), what], go: SCHED_GO, result: { id: e.id, done: !!inp.done }, log: "schedule_done " + e.id + " " + what };
      }
    },
    schedule_delete: {
      label: "일정 삭제", keys: ["schedules", "audits"], danger: true,
      confirm: () => true,
      preview: (inp) => { const e = findEv(inp.id); return e ? [evLine(e)].concat(C() && C().isRepeat(e) ? ["반복 일정 전체가 지워집니다."] : [], audLink(e) ? ["수검 대응 센터 연동이 해제됩니다(수검 기록은 남음)."] : []) : [str(inp.id, 40)]; },
      prep(inp) { const e = findEv(inp.id); return e ? { e } : { error: "일정을 찾지 못했습니다(id 확인): " + str(inp.id, 40) }; },
      run(inp, ctx, p) {
        const e = p.e;
        if (audLink(e) && window.SemisAudit && SemisAudit.unlinkBySchedule) { try { SemisAudit.unlinkBySchedule(e.id); } catch (er) { /* 연동 해제 실패는 무시 */ } }
        D().schedules = arr(D().schedules).filter(x => x.id !== e.id);
        return { lines: [evLine(e)], go: SCHED_GO, result: { id: e.id, deleted: true }, log: "schedule_delete " + e.id + " '" + e.title + "'" };
      }
    },
    notice_add: {
      label: "공지 등록", keys: ["notices"],
      prep(inp) {
        const title = str(inp.title, 200), body = String(inp.body || "").trim().slice(0, 8000);
        return title && body ? { title, body } : { error: "제목과 본문이 필요합니다." };
      },
      run(inp, ctx, p) {
        if (!Array.isArray(D().notices)) D().notices = [];
        const n = { id: uid("n"), title: p.title, body: p.body, bodyHtml: memoHtml(p.body), pinned: inp.pinned === true, files: [], author: me(), created: new Date().toISOString(), src: "argo" };
        D().notices.push(n);
        return { lines: [n.title + (n.pinned ? " (상단 고정)" : "")], go: [{ label: "대시보드", route: "dashboard" }], result: { id: n.id }, log: "notice_add " + n.id + " '" + n.title + "'" };
      }
    },
    training_record: {
      label: "교육 이수 기록", keys: ["training", "schedules"],
      async prep(inp, ctx) {
        const SD = window.SemisDesk;
        if (!SD || !window.SemisTraining) return { error: "보안교육 모듈을 쓸 수 없습니다." };
        const emp = str(inp.emp, 20).replace(/\s+/g, "").toUpperCase();
        const a = { id: "x", k: "cert", on: true, name: str(inp.name, 30), emp, pid: SD.matchPerson(str(inp.name, 30), emp), cid: String(inp.course_id || ""), date: inp.date,
          expire: isISO(inp.expire) ? inp.expire : "", hours: Number(inp.hours) > 0 && Number(inp.hours) < 1000 ? String(Number(inp.hours)) : "", org: str(inp.org, 60),
          certNo: str(inp.cert_no, 40), course: "", sched: false };
        const m = SD.check(a);
        if (m) return { error: m + (/과정/.test(m) ? " (argos_catalog 의 courses id)" : "") };
        const tr = isObj(D().training) ? D().training : {};
        if (a.pid !== "_new" && arr(tr.records).some(r => r && r.pid === a.pid && r.cid === a.cid && r.date === a.date)) return { error: "이미 같은 기록(같은 사람 · 과정 · 수료일)이 있습니다." };
        const c = window.SemisTraining.courses().find(x => x.id === a.cid);
        a.sched = inp.next_schedule !== false && !!(c && Number(c.cycle) > 0);
        const files = {};
        if (inp.file) { const up = await upload(ctx, inp.file, "training"); if (up.error) return up; if (up.url) files.training = up; }
        return { a, files };
      },
      run(inp, ctx, p) {
        const out = window.SemisDesk.commit([p.a], p.files);
        return { lines: out.map(o => o.label).concat(p.a.pid === "_new" ? ["새 인원으로 등록"] : [], p.files.training ? ["원본 보관: " + p.files.training.name] : []),
          go: uniqGo(out.map(o => ({ label: o.k === "event" ? "일정관리" : "보안교육", route: o.route }))), result: { done: out.map(o => o.label) },
          log: "training_record " + out.map(o => o.label).join(" / ") };
      }
    },
    doc_shelve: {
      label: "문서 서가 보관", keys: ["docs"],
      async prep(inp, ctx) {
        const SD = window.SemisDesk;
        if (!SD) return { error: "문서 서가를 쓸 수 없습니다." };
        const a = { id: "x", k: "shelf", on: true, mod: String(inp.mod || ""), grp: String(inp.grp || ""), title: str(inp.title, 120), date: isISO(inp.date) ? inp.date : todayISO(), org: str(inp.org, 60), ssi: inp.ssi === true };
        const m = SD.check(a);
        if (m) return { error: m + " (argos_catalog 의 shelves)" };
        if (!inp.file) return { error: "보관할 첨부(file)가 필요합니다." };
        const fd = SD.folderFor(a), up = await upload(ctx, inp.file, fd);
        if (up.error) return up;
        if (!up.url) return { error: "원본 보관은 안전보안파트 이상만 할 수 있습니다." };
        return { a, files: { [fd]: up } };
      },
      run(inp, ctx, p) {
        const out = window.SemisDesk.commit([p.a], p.files);
        return { lines: out.map(o => o.label).concat([p.a.title + (p.a.ssi ? " (민감보안정보)" : "")]), go: uniqGo(out.map(o => ({ label: (SeMIS.menuForModule(o.route) || {}).label || "문서 서가", route: o.route }))),
          result: { done: out.map(o => o.label) }, log: "doc_shelve " + p.a.mod + "/" + p.a.grp + " '" + p.a.title + "'" };
      }
    },
    audit_findings_add: {
      label: "수검 지적사항 추가", keys: ["audits", "schedules"],
      confirm: (inp) => arr(inp.findings).length >= 2,
      preview: (inp) => arr(inp.findings).slice(0, 20).map(f => "[" + ({ car: "시정조치", rec: "개선권고", onsite: "현장시정", obs: "관찰사항" }[f.type] || "관찰사항") + "] " + cut(str(f.text, 300), 90) + (isISO(f.due) ? " · 기한 " + dot(f.due) : "")),
      async prep(inp, ctx) {
        const SD = window.SemisDesk;
        if (!SD) return { error: "수검 대응을 쓸 수 없습니다." };
        const n = isObj(inp.new_audit) ? inp.new_audit : {};
        const a = { id: "x", k: "audit", on: true, auditId: inp.audit_id ? String(inp.audit_id) : "_new", body: ["gov", "foreign", "internal"].indexOf(n.body) >= 0 ? n.body : "gov",
          org: str(n.org, 60), kind: str(n.kind, 60), start: isISO(n.start) ? n.start : "", end: isISO(n.end) ? n.end : "",
          findings: arr(inp.findings).slice(0, 60).filter(isObj).map(f => ({ on: true, type: ["car", "rec", "onsite", "obs"].indexOf(f.type) >= 0 ? f.type : "obs", ref: str(f.ref, 60), text: str(f.text, 500), due: isISO(f.due) ? f.due : "" })).filter(f => f.text) };
        if (!a.findings.length) return { error: "지적 내용(text)이 필요합니다." };
        const m = SD.check(a);
        if (m) return { error: m + (a.auditId !== "_new" ? " (argos_catalog 의 audits id)" : "") };
        const files = {};
        if (inp.file) { const up = await upload(ctx, inp.file, "audits"); if (up.error) return up; if (up.url) files.audits = up; }
        return { a, files };
      },
      run(inp, ctx, p) {
        const out = window.SemisDesk.commit([p.a], p.files);
        return { lines: out.map(o => o.label).concat(p.a.findings.map(f => "- " + cut(f.text, 80))), go: [{ label: "수검 대응", route: "audit" }], result: { done: out.map(o => o.label) },
          log: "audit_findings_add " + out.map(o => o.label).join(" / ") };
      }
    }
  };
  function uniqGo(l) { const s = {}; return l.filter(g => g.route && goOk(g.route) && !s[g.route] && (s[g.route] = 1)); }

  /* 첨부 원본 — 반영하는 순간 대상 폴더에 올린다(안전보안파트 이상). 같은 질문 안에서 같은 폴더는 한 번만 */
  async function upload(ctx, fid, folder) {
    const f = ctx.files[String(fid)];
    if (!f) return { error: "첨부 " + str(fid, 10) + " 를 찾지 못했습니다 — 첨부는 그 질문 안에서만 쓸 수 있습니다." };
    if (!canW()) return {};
    const k = f.fid + ":" + folder;
    if (ctx.up[k]) return ctx.up[k];
    if (!window.SemisSync || !SemisSync.uploadFile) return { error: "오프라인에서는 원본을 보관할 수 없습니다." };
    try { ctx.up[k] = await SemisSync.uploadFile(f.file, folder); } catch (e) { return { error: "원본을 올리지 못했습니다: " + f.name }; }
    return ctx.up[k];
  }

  const R = {
    argos_find: { min: 1, run: find },
    argos_status: { min: 1, run: status },
    argos_records: { min: 1, run: records },
    argos_catalog: { min: 3, run: catalog }
  };
  const TOOL_MIN = Object.assign({}, ...Object.keys(R).map(k => ({ [k]: R[k].min })), ...Object.keys(W).map(k => ({ [k]: 3 })));

  async function runTool(name, inp, ctx) {
    inp = isObj(inp) ? inp : {};
    if (!(name in TOOL_MIN)) return { error: "없는 도구입니다." };
    if (!internal() || rank() < TOOL_MIN[name]) return { error: "권한 밖: 안전보안파트(hq) 이상이 할 수 있는 작업입니다." };
    if (R[name]) return R[name].run(inp, ctx);
    const T = W[name];
    const p = await T.prep(inp, ctx);
    if (p && p.error) return p;
    if (T.confirm && T.confirm(inp)) {
      const yes = await askConfirm(ctx.turn, T.label + (T.danger ? "" : " " + (arr(inp.items).length || arr(inp.findings).length) + "건"), T.preview(inp), !!T.danger);
      if (!yes) return { cancelled: true, message: "사용자가 취소했습니다. 실행하지 않았습니다." };
    }
    const before = {};
    T.keys.forEach(k => { before[k] = clone(D()[k]); });
    const r = T.run(inp, ctx, p);
    if (r.error) { T.keys.forEach(k => { D()[k] = before[k]; }); return { error: r.error }; }
    const ops = [];
    T.keys.forEach(k => diff(before[k], D()[k], [k], ops));
    const u = { id: uid("u"), label: T.label, ops, at: new Date().toISOString(), done: false };
    if (ops.length) C0().undo.push(u);
    SeMIS.save();
    ctx.turn.cards.push({ k: "result", title: T.label, lines: r.lines || [], go: (r.go || []).filter(g => goOk(g.route)), undo: ops.length ? u.id : "", state: "done", danger: !!T.danger });
    ctx.log.push(r.log || T.label);
    ctx.wrote = true;
    try { SeMIS.renderView(); } catch (e) { /* 뒤 화면 다시 그리기 실패는 무시 */ }
    return Object.assign({ ok: true }, r.result || {});
  }

  /* ── 화면 ── */
  let root = null, busy = false, mood = "", moodT = null, pendingFiles = [], fseq = 0, lastUse = null;
  const confirms = {};
  const KLABEL = { image: "사진", pdf: "PDF", text: "문서" };
  function askConfirm(turn, title, lines, danger) {
    return new Promise(res => {
      const c = { k: "confirm", id: uid("c"), title, lines: arr(lines), danger, state: "wait" };
      turn.cards.push(c);
      confirms[c.id] = (ok) => {
        delete confirms[c.id];
        if (ok) turn.cards = turn.cards.filter(x => x !== c);     // 실행하면 결과 카드가 이 자리를 잇는다
        else c.state = "no";
        renderTurn(turn); res(ok);
      };
      setMood("");
      renderTurn(turn);
      const b = root && root.querySelector('[data-cf="' + c.id + '"][data-ok="1"]');
      if (b) { try { b.focus({ preventScroll: false }); } catch (e) { /* 포커스 불가 */ } }
    });
  }

  function inline(t) {
    let s = esc(t);
    s = s.replace(/\[\[([^\]|]{1,60})\|([a-z0-9/-]{1,60})\]\]/g, (x, lb, rt) => goOk(rt)
      ? '<button type="button" class="ag-go" data-go="' + rt + '">' + lb + icon("chevron", 14) + "</button>" : "<b>" + lb + "</b>");
    return s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
  }
  function md(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    let html = "", list = "";
    const close = () => { if (list) { html += "</" + list + ">"; list = ""; } };
    const open = (k) => { if (list !== k) { close(); html += "<" + k + ">"; list = k; } };
    lines.forEach(ln => {
      let m;
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(ln) && /-{3,}/.test(ln)) return;
      if ((m = /^\s*[-•*]\s+(.*)$/.exec(ln))) { open("ul"); html += "<li>" + inline(m[1]) + "</li>"; return; }
      if ((m = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(ln))) { open("ol"); html += "<li>" + inline(m[2]) + "</li>"; return; }
      if ((m = /^\s*\|(.*)\|\s*$/.exec(ln))) { open("ul"); html += "<li>" + m[1].split("|").map(c => inline(c.trim())).filter(Boolean).join(" · ") + "</li>"; return; }
      close();
      if ((m = /^\s*#{1,4}\s+(.*)$/.exec(ln))) { html += '<p class="ag-h">' + inline(m[1]) + "</p>"; return; }
      if (ln.trim()) html += "<p>" + inline(ln) + "</p>";
    });
    close();
    return html;
  }
  function cardHTML(c) {
    if (c.k === "confirm") {
      const wait = c.state === "wait";
      return `<div class="ag-card is-confirm${c.danger ? " is-danger" : ""}" role="group" aria-label="${esc(c.title)} 확인">
        <div class="ag-card-h">${icon(c.danger ? "trash" : "alert", 16)}<b>${esc(c.title)}</b><span class="ag-card-st">${wait ? "확인 필요" : c.state === "ok" ? "실행함" : "취소함"}</span></div>
        <ul class="ag-card-l">${c.lines.map(l => "<li>" + esc(l) + "</li>").join("")}</ul>
        ${wait ? `<div class="ag-acts"><button type="button" class="btn btn-ghost btn-sm" data-cf="${esc(c.id)}" data-ok="0">취소</button>
          <button type="button" class="btn ${c.danger ? "btn-danger" : "btn-primary"} btn-sm" data-cf="${esc(c.id)}" data-ok="1">${c.danger ? "삭제" : "실행"}</button></div>` : ""}
      </div>`;
    }
    const top = latestUndo();
    const canUndo = c.undo && c.state === "done" && top && top.id === c.undo && !busy;
    return `<div class="ag-card is-result${c.state === "undone" ? " is-undone" : ""}" role="group" aria-label="${esc(c.title)} 결과">
      <div class="ag-card-h">${icon(c.state === "undone" ? "refresh" : "check", 16)}<b>${esc(c.title)}</b><span class="ag-card-st">${c.state === "undone" ? "되돌림" : "완료"}</span></div>
      <ul class="ag-card-l">${arr(c.lines).map(l => "<li>" + esc(l) + "</li>").join("")}</ul>
      ${(c.state !== "undone" && arr(c.go).length) || canUndo ? `<div class="ag-acts">${c.state !== "undone" ? arr(c.go).filter(g => goOk(g.route)).map(g => `<button type="button" class="ag-go" data-go="${esc(g.route)}">${esc(g.label)}${icon("chevron", 14)}</button>`).join("") : ""}
        ${canUndo ? `<button type="button" class="link-btn ag-undo" data-undo="${esc(c.undo)}">${icon("refresh", 14)}되돌리기</button>` : ""}</div>` : ""}
    </div>`;
  }
  function turnHTML(t) {
    const files = arr(t.files);
    return `<section class="ag-turn" data-turn="${esc(t.id)}">
      <div class="ag-q"><div class="ag-qb">${t.q ? esc(t.q).replace(/\n/g, "<br>") : '<span class="ag-dim">첨부만 보냄</span>'}${files.length ? `<div class="ag-qf">${files.map(f => `<span class="ag-chip">${icon(f.kind === "image" ? "image" : "doc", 13)}${esc(f.name)}</span>`).join("")}</div>` : ""}</div></div>
      <div class="ag-a"><span class="ag-av" aria-hidden="true">${window.SemisOwl ? SemisOwl.svg(t.err ? "alert" : t.pending ? "thinking" : "idle", 30) : ""}</span>
        <div class="ag-ab">${t.a ? `<div class="ag-md">${md(t.a)}</div>` : ""}${arr(t.cards).map(cardHTML).join("")}
          ${t.err ? `<p class="ag-err" role="alert">${icon("alert", 15)}${esc(t.err)}</p>` : ""}
          ${t.pending && !arr(t.cards).some(c => c.k === "confirm" && c.state === "wait") ? '<p class="ag-wait" role="status"><span class="ag-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>답을 정리하고 있습니다</span></p>' : ""}</div></div>
    </section>`;
  }
  function suggestions() {
    const r = rank();
    const l = r >= 2 ? ["이번 주 일정 알려줘", "만료 임박 교육 있어?", "열린 지적사항 정리해줘"] : ["보안교육 화면은 어디 있어?", "지금 보안등급은?"];
    if (r >= 3) l.push("다음 주 화요일 14시 보안회의 일정 등록해줘");
    return l.concat(["SSOP 가 뭐야?", "ARGOS 사용법 알려줘"]).slice(0, 5);
  }
  function emptyHTML() {
    return `<div class="ag-empty"><span class="ag-hero" aria-hidden="true"></span><p class="ag-hello">무엇을 도와드릴까요?</p>
      <div class="ag-sugs">${suggestions().map(s => `<button type="button" class="ag-sug" data-sug="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`;
  }
  function wireLog(box) {
    box.querySelectorAll("[data-go]").forEach(b => { b.onclick = () => go(b.dataset.go); });
    box.querySelectorAll("[data-undo]").forEach(b => { b.onclick = () => undo(b.dataset.undo); });
    box.querySelectorAll("[data-cf]").forEach(b => { b.onclick = () => { const f = confirms[b.dataset.cf]; if (f) f(b.dataset.ok === "1"); }; });
    box.querySelectorAll("[data-sug]").forEach(b => { b.onclick = () => send(b.dataset.sug); });
  }
  const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  function paintLog() {
    if (!root) return;
    const log = root.querySelector(".ag-log");
    const ts = C0().turns;
    log.innerHTML = ts.length ? ts.map(turnHTML).join("") : emptyHTML();
    wireLog(log);
    const hero = log.querySelector(".ag-hero");
    if (hero && window.SemisOwl) SemisOwl.mount(hero, { size: SeMIS.isMobile && SeMIS.isMobile() ? 72 : 96, state: "idle" });
    log.scrollTop = log.scrollHeight;
  }
  function renderTurn(t) {
    if (!root) return;
    const log = root.querySelector(".ag-log");
    const stick = nearBottom(log);
    const old = log.querySelector('[data-turn="' + t.id + '"]');
    const tmp = document.createElement("div");
    tmp.innerHTML = turnHTML(t);
    const node = tmp.firstElementChild;
    if (old) old.replaceWith(node);
    else { const em = log.querySelector(".ag-empty"); if (em) em.remove(); log.appendChild(node); }
    wireLog(node);
    if (stick || !old) log.scrollTop = log.scrollHeight;
    /* 다른 결과 카드의 되돌리기 단추는 '가장 최근' 하나만 */
    log.querySelectorAll(".ag-turn").forEach(s => { if (s !== node && s.querySelector(".is-result")) { const tt = C0().turns.find(x => x.id === s.dataset.turn); if (tt) { const n2 = document.createElement("div"); n2.innerHTML = turnHTML(tt); const nn = n2.firstElementChild; s.replaceWith(nn); wireLog(nn); } } });
  }
  function go(route) {
    if (!goOk(route)) return;
    close();
    if (route === "desk") { setTimeout(() => SeMIS.openSupport("desk"), 0); return; }
    SeMIS.navigate(route);
  }
  function setMood(m) {
    mood = m || ""; clearTimeout(moodT);
    const h = window.SemisPanel && SemisPanel.get(PID);
    if (h) h.setMascot(busy ? "thinking" : mood || "idle");
    if (mood === "happy" || mood === "alert") moodT = setTimeout(() => { mood = ""; const h2 = window.SemisPanel && SemisPanel.get(PID); if (h2) h2.setMascot(busy ? "thinking" : "idle"); }, mood === "alert" ? 4000 : 2600);
  }
  function lock(on) {
    if (!root) return;
    const ta = root.querySelector("#ag-in"), sb = root.querySelector("#ag-send"), at = root.querySelector("#ag-attach");
    [sb, at].forEach(b => { if (b) b.disabled = !!on; });
    if (ta) ta.setAttribute("aria-busy", on ? "true" : "false");
  }
  function paintFiles() {
    if (!root) return;
    const box = root.querySelector("#ag-files");
    box.hidden = !pendingFiles.length;
    box.innerHTML = pendingFiles.map(f => `<span class="ag-chip is-up">${icon(f.kind === "image" ? "image" : "doc", 13)}<span>${esc(f.name)}</span>
      <button type="button" class="ag-chip-x" data-fx="${esc(f.fid)}" aria-label="${esc(f.name)} 첨부 빼기">${icon("x", 13)}</button></span>`).join("");
    box.querySelectorAll("[data-fx]").forEach(b => { b.onclick = () => { pendingFiles = pendingFiles.filter(x => x.fid !== b.dataset.fx); paintFiles(); }; });
  }
  function paintMeta() {
    if (!root) return;
    const m = root.querySelector("#ag-meta");
    if (!m) return;
    const show = lastUse && lastUse.limit && lastUse.used >= lastUse.limit * 0.8;
    m.hidden = !show;
    m.textContent = show ? "오늘 사용 " + lastUse.used + " / " + lastUse.limit + "회" : "";
  }

  /* 첨부 — 사진은 긴 변 1600px JPEG, PDF 4.5MB 까지, 워드 · 한글 · 엑셀 · PPT · TXT 는 글만 */
  const b64Of = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, "")); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  async function shrink(file) {
    if (typeof createImageBitmap !== "function") return file;
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { return file; }
    try {
      const s = Math.min(1, IMG_SIDE / Math.max(bmp.width, bmp.height));
      if (s === 1 && file.size < 1.2 * 1024 * 1024 && /jpe?g|png|webp/i.test(file.type || "")) return file;
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * s)); cv.height = Math.max(1, Math.round(bmp.height * s));
      const cx = cv.getContext && cv.getContext("2d");
      if (!cx) return file;
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      cx.drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
      return blob || file;
    } finally { try { bmp.close(); } catch (e) { /* 닫기 실패 무시 */ } }
  }
  const IMG_MT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  async function prepFile(file) {
    const DR = window.SemisDocRead;
    if (!DR) return { error: "첨부를 읽을 수 없습니다." };
    const kind = DR.kindOf(file.name);
    if (kind === "pdf") {
      if (file.size > PDF_MAX) return { error: file.name + ": PDF 는 4.5MB 까지입니다" + (SeMIS.supportOk && SeMIS.supportOk("desk") ? " — 큰 파일은 메인 데스크로 올려 주세요." : ".") };
      return { kind: "pdf", file, mt: "application/pdf", b64: await b64Of(file) };
    }
    if (kind === "image") {
      const x = await DR.extract(file);
      if (x.mode !== "file") return { error: file.name + ": 이 사진 형식은 읽지 못합니다. JPG · PNG 로 저장해 올려 주세요." };
      const small = await shrink(x.file);
      const ext = DR.extOf(x.file.name);
      const mt = small !== x.file ? "image/jpeg" : (IMG_MT[ext] || x.file.type || "image/jpeg");
      if (small.size > 4.5 * 1024 * 1024) return { error: file.name + ": 사진이 너무 큽니다." };
      return { kind: "image", file: x.file, mt, b64: await b64Of(small) };
    }
    if (kind === "legacy") return { error: file.name + ": 구 형식(HWP · DOC · XLS · PPT)은 읽지 못합니다. PDF 나 새 형식으로 저장해 올려 주세요." };
    if (kind === "other") return { error: file.name + ": 읽을 수 없는 형식입니다." };
    const x = await DR.extract(file);
    if (x.mode !== "text") return { error: file.name + ": 글을 뽑지 못했습니다." };
    return { kind: "text", file, text: x.text.length > TEXT_MAX ? x.text.slice(0, TEXT_MAX) + "\n…(이하 생략)" : x.text };
  }
  async function addFiles(list) {
    for (const file of Array.from(list || [])) {
      if (!file) continue;
      if (pendingFiles.length >= MAX_FILES) { toast("첨부는 한 번에 " + MAX_FILES + "개까지입니다.", true); break; }
      let x;
      try { x = await prepFile(file); } catch (e) { x = { error: file.name + ": 읽지 못했습니다." }; }
      if (x.error) { toast(x.error, true); continue; }
      pendingFiles.push(Object.assign({ fid: "f" + (++fseq), name: String(file.name || "file").slice(0, 120) }, x));
      paintFiles();
    }
  }
  function userContent(q, files) {
    const blocks = [], heads = [];
    files.forEach(f => {
      if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.mt, data: f.b64 } });
      else if (f.kind === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.b64 }, title: f.name });
      heads.push("[첨부 " + f.fid + ": " + f.name + " (" + KLABEL[f.kind] + ")]" + (f.kind === "text" ? "\n" + f.text : ""));
    });
    blocks.push({ type: "text", text: (heads.length ? heads.join("\n\n") + "\n\n" : "") + (q || "첨부 파일을 확인해 주세요.") });
    return blocks;
  }
  function history() {
    const out = [];
    C0().turns.forEach(t => {
      if (t.pending || !t.a) return;
      const fs = arr(t.files);
      out.push({ role: "user", content: (t.q || "(첨부)") + (fs.length ? "\n[첨부: " + fs.map(f => f.name).join(", ") + " — 앞 질문의 파일, 내용은 다시 보내지 않음]" : "") });
      out.push({ role: "assistant", content: t.a + (t.log ? "\n\n[실행 기록] " + t.log : "") });
    });
    return out.slice(-2 * MAX_TURNS);
  }

  async function send(text) {
    if (busy || !canUse()) return false;
    const ta = root && root.querySelector("#ag-in");
    const q = String(text != null ? text : ta ? ta.value : "").trim().slice(0, Q_MAX);
    const files = pendingFiles.splice(0);
    if (!q && !files.length) return false;
    if (ta && text == null) ta.value = "";
    if (ta && text == null && ta.dispatchEvent) ta.dispatchEvent(new Event("input"));
    paintFiles();
    const t = { id: uid("t"), q, files: files.map(f => ({ fid: f.fid, name: f.name, kind: f.kind })), a: "", log: "", cards: [], at: new Date().toISOString(), pending: true };
    C0().turns.push(t);
    persist();
    busy = true; lock(true); setMood("thinking"); renderTurn(t);
    const ctx = { turn: t, files: {}, up: {}, log: [], wrote: false };
    files.forEach(f => { ctx.files[f.fid] = f; });
    const msgs = history();
    msgs.push({ role: "user", content: userContent(q, files) });
    const texts = [];
    let err = null;
    try {
      for (let n = 0; n < MAX_CALLS; n++) {
        const d = await call(msgs);
        lastUse = { used: Number(d.used) || 0, limit: Number(d.limit) || 0 };
        let content = arr(d.content).filter(b => b && (b.type === "text" || b.type === "tool_use"));
        const uses = d.stop === "tool_use" ? content.filter(b => b.type === "tool_use") : [];
        if (!uses.length) content = content.filter(b => b.type === "text");
        content.forEach(b => { if (b.type === "text" && String(b.text || "").trim()) texts.push(String(b.text).trim()); });
        t.a = texts.join("\n\n");
        renderTurn(t);
        if (!uses.length) break;
        msgs.push({ role: "assistant", content });
        const results = [];
        for (const u of uses) {
          let r;
          try { r = await runTool(u.name, u.input, ctx); } catch (e) { r = { error: "실행하지 못했습니다." }; }
          results.push({ type: "tool_result", tool_use_id: u.id, content: capJSON(r), is_error: !!(r && r.error) || undefined });
          setMood("thinking");
          renderTurn(t);
        }
        msgs.push({ role: "user", content: results });
      }
    } catch (e) { err = e; }
    t.pending = false;
    if (err) t.err = errText(err);
    else if (!t.a) t.a = arr(t.cards).length ? "실행했습니다." : "답을 정리하지 못했습니다. 질문을 나눠서 다시 물어봐 주세요.";
    t.log = cut(ctx.log.join("; "), LOG_MAX);
    Object.keys(confirms).forEach(k => confirms[k](false));
    persist();
    busy = false; lock(false);
    renderTurn(t); paintMeta();
    setMood(err ? "alert" : "happy");
    return !err;
  }

  /* ── 패널 ── */
  function build() {
    const el = document.createElement("div");
    el.className = "ag";
    el.innerHTML = `<div class="ag-log" role="log" aria-live="polite" aria-label="아르고 대화"></div>
      <form class="ag-compose no-print" autocomplete="off">
        <div class="ag-files" id="ag-files" hidden></div>
        <div class="ag-box">
          <button type="button" class="ag-ib" id="ag-attach" aria-label="파일 첨부" title="파일 첨부 — 사진 · PDF · 워드 · 한글 · 엑셀">${icon("clip", 20)}</button>
          <textarea id="ag-in" rows="1" maxlength="${Q_MAX}" placeholder="아르고에게 물어보세요" aria-label="아르고에게 보낼 내용"></textarea>
          <button type="submit" class="ag-send" id="ag-send" aria-label="보내기" title="보내기 (Enter)">${icon("send", 19)}</button>
        </div>
        <input type="file" id="ag-file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.docx,.hwpx,.xlsx,.pptx,.txt,.csv,.md">
        <p class="ag-meta" id="ag-meta" hidden></p>
      </form>`;
    const form = el.querySelector("form"), ta = el.querySelector("#ag-in"), fi = el.querySelector("#ag-file");
    form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
    });
    ta.addEventListener("paste", (e) => {
      const fs = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (fs.length) { e.preventDefault(); addFiles(fs); }
    });
    el.querySelector("#ag-attach").onclick = () => fi.click();
    fi.onchange = () => { const l = Array.from(fi.files || []); fi.value = ""; addFiles(l); };
    return el;
  }
  function wireDrop(dlg) {
    if (!dlg || dlg._agDrop) return;
    dlg._agDrop = true;
    const has = (ev) => !!ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf("Files") >= 0;
    dlg.addEventListener("dragover", (ev) => { if (!has(ev)) return; ev.preventDefault(); try { ev.dataTransfer.dropEffect = "copy"; } catch (e) { /* 읽기 전용 */ } dlg.classList.add("ag-drag"); });
    dlg.addEventListener("dragleave", (ev) => { if (!ev.relatedTarget || !dlg.contains(ev.relatedTarget)) dlg.classList.remove("ag-drag"); });
    dlg.addEventListener("drop", (ev) => { dlg.classList.remove("ag-drag"); if (!has(ev)) return; ev.preventDefault(); if (!busy) addFiles(ev.dataTransfer.files); });
  }
  function newConv() {
    if (busy) return;
    const go2 = () => { const c = C0(); c.turns = []; c.undo = []; pendingFiles = []; persist(); paintFiles(); paintLog(); const ta = root && root.querySelector("#ag-in"); if (ta) ta.focus(); };
    if (!C0().turns.length) { go2(); return; }
    SeMIS.confirmModal("대화를 지우고 새로 시작합니다. 이 대화의 되돌리기도 함께 사라집니다.", go2);
  }
  function open() {
    if (!canUse() || !window.SemisPanel) return null;
    if (!root) root = build();
    const h = SemisPanel.open({
      id: PID, title: TITLE, sub: "ARGOS 도우미", mascot: busy ? "thinking" : mood || "idle", cls: "pnl-argo", body: root, focus: SeMIS.isMobile && SeMIS.isMobile() ? "" : "#ag-in",
      actions: '<button type="button" class="btn btn-ghost btn-sm" data-ag-new>' + icon("refresh", 16) + "<span>새 대화</span></button>",
      onActs: (box) => { const b = box.querySelector("[data-ag-new]"); if (b) b.onclick = newConv; },
      print: () => "아르고 대화 기록"
    });
    if (h) { wireDrop(h.el); paintLog(); paintFiles(); paintMeta(); }
    return h;
  }
  function close() { if (window.SemisPanel) SemisPanel.close(PID); }
  const isOpen = () => !!(window.SemisPanel && SemisPanel.isOpen(PID));

  SeMIS.registerModule(MOD, { title: TITLE, render: (r) => { SeMIS.navigate("dashboard"); setTimeout(open, 0); } });
  SeMIS.registerSupport(MOD, { ok: canUse, open: () => open() });
  SeMIS.registerPanelRoute(MOD, () => open());
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "info",
    items: () => (canUse() ? [{ title: TITLE, sub: "ARGOS 도우미 — 사용법 · 자료 찾기 · 등록", text: [TITLE, "도우미", "AI", "질문"], route: "", pick: () => open() }] : [])
  });

  window.SemisArgo = { open, close, isOpen, send, runTool, undo, diff, invert, md, slim, capJSON, records, status, find, catalog, userContent, history, prepFile, addFiles,
    TOOL_MIN, W, COLS, get conv() { return C0(); }, get busy() { return busy; }, get pending() { return pendingFiles; }, latestUndo, goOk,
    setToday(t) { fixedToday = isISO(t) ? t : ""; }, _reset() { conv = null; convKey = ""; pendingFiles = []; busy = false; root = null; } };
})();
