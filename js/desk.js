/* 접수 카운터(옛 이름 메인 데스크, 주소 #/desk · 모듈 id desk 그대로) — 업무 문서를 올리면 AI 가 읽고 저장할 곳을 제안한다. 확인 · 고치기 후 '이대로 저장'하면 각 화면 자료에 들어간다.
   화면은 공통 패널(지원 카드 · 상단바 · 시작 바 · 모바일 탭 · 어디서나 끌어다 놓기 · #/desk): 안전보안파트 [올리기 · 확인] [올린 문서 기록(A4 인쇄)] / 직원 [올리기] [내가 올린 문서].
   교육 이수증 → 이수 기록 + 다음 이수 기간 일정 / 공문 · 회의 · 행사 → 일정 / 전파 통보 → 보안 전파교육 / 점검 결과 → 수검 지적사항 /
   보안 처리 보고서 → 보안 처리 대장 / 기록부 · 대장 스캔 → 하드카피 집계 + 문서함 / 그 밖 → 문서함.
   DATA.desk = { cfg{ areas{ security, safety, industrial, dg } — 분야별 일정 담당(이름은 공용 DB 에만) },
     log[{ id, at, by, inbox?(직원 접수 id), file{ name, size, url, type }, status(reading|wait|done|kept), err, type, title, summary, ai(대기 중 판독 결과),
           acts[{ k, label, route }], doneAt, doneBy }] }
   권한: 열람 · 편집 hq(3). 원본은 비공개 버킷 desk/(hq), 저장할 때 대상 화면 폴더로 복사한다(Edge Function op copy).
   직원(user · manager): 원본은 desk-in/(올리기 1 · 열람 3) + 비공개 접수함(RPC semis_logi_desk_*). 자기 접수 · 처리 상태만 보고,
   안전보안파트 화면이 접수함을 가져와 판독 · 확인 · 저장한다(tools/sql/semis-logi-desk-inbox.sql). */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "desk", KEY = "desk", TITLE = "접수 카운터", FOLDER = "desk", FOLDER_IN = "desk-in";
  const SUB = "문서 올리기 — 파일을 올리면 알아서 정리";
  const FILE_MAX = 50 * 1024 * 1024, LOG_MAX = 500, STALE_MS = 10 * 60 * 1000;
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const isHM = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const str = (v, n) => (typeof v === "string" || typeof v === "number" ? norm(v).slice(0, n || 200) : "");
  const nosp = (s) => String(s || "").replace(/\s+/g, "");
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "";
  const todayISO = () => fixedToday || toISO(new Date());
  const addDays = (iso, n) => { const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  const dot = (s) => (isISO(s) ? s.replace(/-/g, ".") : String(s || ""));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const me = () => { const u = SeMIS.user; return u ? u.name || u.id || "" : ""; };
  const canW = () => !!SeMIS.user && SeMIS.user.role !== "vendor" && SeMIS.roleRank() >= 3;
  const canUse = () => { const u = SeMIS.user; return !!u && u.role !== "vendor" && u.role !== "signer" && SeMIS.roleRank() >= 1; };
  const num = (v) => { const n = Number(v); return v === "" || v == null || !isFinite(n) ? null : n; };
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round((n || 0) / 1024)) + "KB");

  const TYPES = {
    cert: ["교육 이수증", "green"], notice: ["공문 · 회의 · 행사", "blue"], dissem: ["전파 통보", "amber"], audit: ["점검 결과", "red"],
    special: ["보안 처리 보고서", "blue"], hardcopy: ["기록부 · 대장 스캔", "gray"], other: ["기타 문서", "gray"]
  };
  const AREAS = [["security", "보안"], ["safety", "안전"], ["industrial", "산업안전"], ["dg", "위험물"]];
  /* 일정 색 — 회의 파랑 · 교육 초록 · 점검 · 심사 빨강 · 규정 · 절차 갈색 · 견학 · 참고 회색(일정관리 운영 기준) */
  const CATS = { meeting: ["회의", "blue", ["1d"]], training: ["교육", "green", ["1w", "1d"]], inspection: ["점검 · 심사", "red", ["1w", "1d"]],
    regulation: ["규정 · 절차", "brown", ["1w"]], deadline: ["기한", "red", ["1w", "1d"]], event: ["행사 · 견학", "gray", ["1d"]], other: ["기타", "gray", ["1d"]] };
  const KINDS = {
    cert: { label: "교육 이수 기록", save: "교육 기록에 저장", folder: "training", route: "training" },
    event: { label: "일정", save: "일정에 저장", folder: "schedules", route: "schedule" },
    dissem: { label: "보안 전파교육", save: "전파교육에 저장", folder: "dissem", route: "dissem" },
    audit: { label: "수검 · 지적사항", save: "수검 기록에 저장", folder: "audits", route: "audit" },
    case: { label: "보안 처리 대장", save: "보안 처리 대장에 저장", folder: "cases", route: "sec-cases" },
    hc: { label: "기록부 하드카피 확인", save: "하드카피 집계에 저장", folder: "", route: "inspection" },
    shelf: { label: "문서함", save: "문서함에 저장", folder: "docs", route: "" }
  };
  const ST = { reading: ["내용 확인 중", "amber"], wait: ["확인 대기", "blue"], done: ["저장됨", "green"], kept: ["보관", "gray"] };
  const FTYPES = { car: "시정조치", rec: "개선권고", onsite: "현장시정", obs: "관찰사항" };
  const BODIES = { gov: "국토부 · 지방항공청", foreign: "해외 당국 · 화주", internal: "사내 심사" };
  const ROOM = (place) => /회의실/.test(place) && /화물\s*터미널/.test(place);

  /* ── 자료 ── */
  function V() {
    let v = D()[KEY];
    if (!isObj(v)) v = D()[KEY] = { cfg: {}, log: [] };
    if (!isObj(v.cfg)) v.cfg = {};
    if (!Array.isArray(v.log)) v.log = [];
    return v;
  }
  const logs = () => V().log.filter(x => x && x.id);
  const findLog = (id) => logs().find(x => x.id === id) || null;
  const areaNames = (a) => { const m = isObj(V().cfg.areas) ? V().cfg.areas : {}; return norm(m[a] || ""); };
  const TRD = () => { const t = D().training; return isObj(t) ? t : { courses: [], people: [], records: [], sessions: [] }; };
  const people = () => (Array.isArray(TRD().people) ? TRD().people : []).filter(p => p && p.id);
  const activeP = () => people().filter(p => !(isISO(p.left) && p.left <= todayISO()));
  const courses = () => (window.SemisTraining ? SemisTraining.courses() : []).filter(c => c && !c.vendor);
  const courseOf = (id) => courses().find(c => c.id === id) || null;
  const audits = () => (Array.isArray(D().audits) ? D().audits : []).filter(a => a && a.id && !a.cancelled)
    .sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));
  const auditTitle = (a) => (window.SemisAudit ? SemisAudit.auditTitle(a) : norm([a.org, a.kind].join(" ")));
  const templates = () => (window.SemisSeclog ? SemisSeclog.templates() : []);
  const tplOf = (id) => templates().find(t => t.id === id) || null;
  const caseTypes = () => (window.SemisCases ? SemisCases.TYPES : []);
  const dissemKinds = () => (window.SemisDissem ? SemisDissem.KINDS : ["기타"]);
  function shelfMods() {
    if (!window.SemisDocs) return [];
    const seen = {};
    return (D().menus || []).filter(m => m && m.type === "module" && SemisDocs.groupsOf(m.module).length && SeMIS.canSee(m))
      .filter(m => (seen[m.module] ? false : (seen[m.module] = true)))
      .map(m => ({ mod: m.module, label: m.label, groups: SemisDocs.groupsOf(m.module) }));
  }
  const shelfOk = (mod, grp) => shelfMods().some(m => m.mod === mod && m.groups.some(g => g.id === grp));
  const pathOf = (url) => { const pre = window.SemisSync ? SemisSync.PUBLIC_PREFIX : ""; const u = String(url || ""); return pre && u.indexOf(pre) === 0 ? decodeURIComponent(u.slice(pre.length)) : ""; };

  /* AI 에 보내는 목록 — 이름 · 연락처는 넣지 않는다 */
  function catalog() {
    const shelves = [];
    shelfMods().forEach(m => m.groups.forEach(g => shelves.push({ mod: m.mod, grp: g.id, label: m.label + " › " + g.label })));
    return {
      today: todayISO(),
      courses: courses().map(c => ({ id: c.id, name: c.name, kind: c.kind })),
      audits: audits().slice(0, 40).map(a => ({ id: a.id, title: auditTitle(a), start: a.start || "" })),
      templates: templates().map(t => ({ id: t.id, name: t.name, cycle: t.cycle })),
      caseTypes: caseTypes().map(t => ({ id: t.id, label: t.label })),
      shelves, dissemKinds: dissemKinds()
    };
  }

  /* 판독 결과 정리 — 형식 · 목록 밖 값은 비운다 */
  function clean(o) {
    o = isObj(o) ? o : {};
    const d = (v) => (isISO(v) ? v : ""), hm = (v) => (isHM(v) ? v : "");
    const arr = (v, n) => (Array.isArray(v) ? v.filter(isObj).slice(0, n) : []);
    const ids = (xs) => xs.map(x => x.id);
    const cIds = ids(courses()), aIds = ids(audits()), tIds = ids(templates()), kIds = ids(caseTypes());
    const out = {
      type: TYPES[o.type] ? o.type : "other", title: str(o.title, 120), summary: str(o.summary, 600), date: d(o.date), org: str(o.org, 60),
      conf: Math.max(0, Math.min(1, Number(o.conf) || 0)),
      certs: arr(o.certs, 60).map(c => {
        const h = Number(c.hours);
        return { name: str(c.name, 30), emp: str(c.emp, 20).replace(/\s+/g, "").toUpperCase(), cid: cIds.indexOf(c.cid) >= 0 ? c.cid : "",
          course: str(c.course, 80), date: d(c.date), expire: d(c.expire), org: str(c.org, 60), certNo: str(c.certNo, 40),
          hours: isFinite(h) && h > 0 && h < 1000 ? h : null };
      }),
      events: arr(o.events, 20).map(e => ({ title: str(e.title, 120), start: d(e.start), end: d(e.end), time: hm(e.time), timeEnd: hm(e.timeEnd),
        place: str(e.place, 80), cat: CATS[e.cat] ? e.cat : "other", area: AREAS.some(a => a[0] === e.area) ? e.area : "", memo: str(e.memo, 200) })).filter(e => e.title && e.start),
      dissem: null, audit: null, case: null, hardcopy: null, shelf: null
    };
    if (isObj(o.dissem) && str(o.dissem.title)) out.dissem = { kind: dissemKinds().indexOf(o.dissem.kind) >= 0 ? o.dissem.kind : "", title: str(o.dissem.title, 160), due: d(o.dissem.due) };
    if (isObj(o.audit)) {
      const a = o.audit;
      out.audit = { auditId: aIds.indexOf(a.auditId) >= 0 ? a.auditId : "", body: BODIES[a.body] ? a.body : "gov", org: str(a.org, 60), kind: str(a.kind, 60),
        start: d(a.start), end: d(a.end),
        findings: arr(a.findings, 60).map(f => ({ type: FTYPES[f.type] ? f.type : "obs", ref: str(f.ref, 60), text: str(f.text, 500), due: d(f.due) })).filter(f => f.text) };
    }
    if (isObj(o.case)) {
      const c = o.case, x = { type: kIds.indexOf(c.type) >= 0 ? c.type : "", date: d(c.date) };
      ["ref", "flight", "pcs", "uld", "agent", "shipper", "region", "by", "result", "note"].forEach(k => { x[k] = str(c[k], 120); });
      x.start = hm(c.start); x.end = hm(c.end);
      out.case = x;
    }
    if (isObj(o.hardcopy)) {
      const h = o.hardcopy, n = Math.round(Number(h.count));
      out.hardcopy = { tid: tIds.indexOf(h.tid) >= 0 ? h.tid : "", date: d(h.date), result: h.result === "ng" ? "ng" : "ok", count: n > 0 && n < 1000 ? n : null, note: str(h.note, 200) };
    }
    if (isObj(o.shelf)) {
      const s = o.shelf;
      out.shelf = shelfOk(s.mod, s.grp) ? { mod: s.mod, grp: s.grp, title: str(s.title, 120), date: d(s.date) } : null;
    }
    return out;
  }

  /* ── 반영안 ── */
  function matchPerson(name, emp) {
    const ps = activeP();
    if (emp) { const e = ps.find(p => nosp(p.emp).toUpperCase() === emp); if (e) return e.id; }
    const n = nosp(name);
    const hit = n ? ps.find(p => nosp(p.name) === n) : null;
    return hit ? hit.id : "_new";
  }
  const dupRec = (pid, cid, date) => (TRD().records || []).some(r => r && r.pid === pid && r.cid === cid && r.date === date);
  let seq = 0;
  const aid = () => "a" + (++seq);
  function certAct(c, on) {
    const pid = matchPerson(c.name, c.emp);
    const cr = courseOf(c.cid);
    const a = { id: aid(), k: "cert", on, name: c.name, emp: c.emp, pid, cid: c.cid, date: c.date, expire: c.expire, hours: c.hours == null ? "" : String(c.hours),
      org: c.org, certNo: c.certNo, course: c.course, sched: !!(cr && Number(cr.cycle) > 0) };
    if (pid !== "_new" && dupRec(pid, a.cid, a.date)) a.on = false;
    return a;
  }
  function eventAct(e, on, src) {
    return { id: aid(), k: "event", on, title: e.title, start: e.start, end: e.end, time: e.time, timeEnd: e.timeEnd, place: e.place, cat: e.cat,
      area: e.area, assignee: areaNames(e.area), room: ROOM(e.place), memo: e.memo, file: src !== false };
  }
  function shelfAct(s, on, ai) {
    s = s || {};
    return { id: aid(), k: "shelf", on, mod: s.mod || "", grp: s.grp || "", title: s.title || (ai && ai.title) || "", date: s.date || (ai && ai.date) || todayISO(),
      org: (ai && ai.org) || "", ssi: false };
  }
  /* 점검표 · 체크리스트(빈 양식)는 수검 · 점검 활동에 쓰는 문서 — 판독이 서가 위치를 못 고르면 수검 대응 센터 › 점검표로.
     손으로 채운 기록부 스캔(hardcopy)은 보안 기록부 쪽이라 제외 */
  const CHECK_RE = /(?:점검|심사|평가)\s?표(?![준시현])|체크\s?리스트|(?:점검|심사)\s?양식|che?c?k\s?-?\s?list/i;
  const CHECK_AT = ["audit", "checklist"];
  function guessShelf(ai, name) {
    if (ai && ai.type === "hardcopy") return null;
    if (!CHECK_RE.test([ai && ai.title, name].filter(Boolean).join(" ")) || !shelfOk(CHECK_AT[0], CHECK_AT[1])) return null;
    return { mod: CHECK_AT[0], grp: CHECK_AT[1], title: (ai && ai.title) || "", date: (ai && ai.date) || "" };
  }
  function plan(ai, name) {
    ai = ai || clean({});
    const T = ai.type, out = [];
    ai.certs.forEach(c => out.push(certAct(c, T === "cert")));
    ai.events.forEach(e => out.push(eventAct(e, T === "notice" || T === "dissem" || T === "other")));
    if (ai.dissem) out.push({ id: aid(), k: "dissem", on: T === "dissem", date: ai.date || todayISO(), title: ai.dissem.title, kind: ai.dissem.kind || dissemKinds().slice(-1)[0], src: ai.org, due: ai.dissem.due });
    if (ai.audit) {
      const a = ai.audit;
      out.push({ id: aid(), k: "audit", on: T === "audit", auditId: a.auditId || "_new", body: a.body, org: a.org || ai.org, kind: a.kind, start: a.start, end: a.end,
        findings: a.findings.map(f => Object.assign({ on: true }, f)) });
    }
    if (ai.case) out.push(Object.assign({ id: aid(), k: "case", on: T === "special" }, ai.case, { date: ai.case.date || ai.date }));
    if (ai.hardcopy) out.push(Object.assign({ id: aid(), k: "hc", on: T === "hardcopy" && !!ai.hardcopy.tid }, ai.hardcopy, { date: ai.hardcopy.date || ai.date }));
    const sh = ai.shelf || (T === "other" ? guessShelf(ai, name) : null);
    if (sh || T === "hardcopy" || T === "other") out.push(shelfAct(sh, (T === "hardcopy" || T === "other") && !!sh, ai));
    return out;
  }

  /* ── 반영 ── */
  function check(a) {
    switch (a.k) {
      case "cert":
        if (a.pid === "_new" ? !norm(a.name) : !people().some(p => p.id === a.pid)) return "이수자를 고르세요.";
        if (!courseOf(a.cid)) return "과정을 고르세요.";
        if (!isISO(a.date)) return "수료일을 입력하세요.";
        return "";
      case "event": return !norm(a.title) ? "일정 이름을 입력하세요." : !isISO(a.start) ? "일정 날짜를 입력하세요." : "";
      case "dissem": return !norm(a.title) ? "전파 내용을 입력하세요." : !isISO(a.date) ? "전파교육 날짜를 입력하세요." : "";
      case "audit":
        if (a.auditId !== "_new" && !audits().some(x => x.id === a.auditId)) return "수검을 고르세요.";
        if (a.auditId === "_new" && !norm(a.org) && !norm(a.kind)) return "점검 기관이나 유형을 입력하세요.";
        return "";
      case "case": return !caseTypes().some(t => t.id === a.type) ? "처리 유형을 고르세요." : !isISO(a.date) ? "처리 일자를 입력하세요." : "";
      case "hc": {
        const t = tplOf(a.tid);
        if (!t) return "기록부 양식을 고르세요.";
        if (!isISO(a.date)) return "기록 날짜를 입력하세요.";
        return "";
      }
      case "shelf": return !shelfOk(a.mod, a.grp) ? "문서함 위치(화면 · 묶음)를 고르세요." : !norm(a.title) ? "문서 이름을 입력하세요." : "";
      default: return "알 수 없는 항목";
    }
  }
  const folderFor = (a) => (a.k === "shelf" ? (a.ssi ? "docs-ssi" : "docs") : a.k === "event" && !a.file ? "" : KINDS[a.k].folder);
  const pickColor = (cat) => (CATS[cat] || CATS.other)[1];
  function schedRec(o) {
    return Object.assign({ memo: "", memoHtml: "", end: o.start, allDay: true, time: "", timeEnd: "", color: "blue", assignee: "", vehicle: false, room: false,
      reminders: [], repeat: { freq: "none", until: "" }, done: false, doneFrom: "", doneDates: [], undoneDates: [], priv: false, owner: "", autoDefer: false, autoExtend: false }, o);
  }
  function schedules() { if (!Array.isArray(D().schedules)) D().schedules = []; return D().schedules; }

  /* 다음 이수 기간 — 지침 제13조 · 위험물 규칙의 이수 기간 시작일(지났으면 오늘)에 한 건. 같은 사람 · 같은 묶음은 덮어쓴다 */
  function nextTraining(pid, cid) {
    const TR = window.SemisTraining;
    const c = courseOf(cid), p = people().find(x => x.id === pid);
    if (!TR || !c || !p || !(Number(c.cycle) > 0)) return null;
    const g = TR.fams().find(x => x.fam === (c.fam || c.id));
    if (!g) return null;
    const s = TR.famStatus(p, g, todayISO());
    if (!s || !isISO(s.exp)) return null;
    const win = isISO(s.winS);
    let start = win ? s.winS : addDays(s.exp, -30);
    if (start < todayISO()) start = todayISO();
    const memo = (win ? "이수 기간 " + dot(s.winS) + " ~ " + dot(s.winE) + " · " : "") + "유효기한 " + dot(s.exp) + " — 접수 카운터(" + c.name + ")";
    const id = "dsk_tr_" + p.id + "_" + g.fam;
    const area = g.rule === "dg" ? "dg" : "security";
    const rec = schedRec({ id, src: "desk", title: "[교육] " + p.name + " " + g.name + (win ? " 이수 기간" : " 유효기한 임박"), memo, start, end: start,
      color: "green", assignee: areaNames(area), reminders: ["1w"] });
    const arr = schedules(), cur = arr.find(x => x && x.id === id);
    if (cur) Object.assign(cur, rec); else arr.push(rec);
    return { start, exp: s.exp };
  }

  function commit(acts, files, e) {
    const out = [];
    const nowS = new Date().toISOString(), by = me();
    const fileArr = (a) => { const f = files[folderFor(a)]; return f ? [Object.assign({}, f)] : []; };
    acts.forEach(a => {
      if (a.k === "cert") {
        const t = D().training = isObj(D().training) ? D().training : { courses: [], people: [], records: [], sessions: [] };
        ["people", "records"].forEach(k => { if (!Array.isArray(t[k])) t[k] = []; });
        let pid = a.pid;
        if (pid === "_new") {
          const p = { id: uid("tp"), name: norm(a.name), emp: String(a.emp || "").replace(/\s+/g, "").toUpperCase().slice(0, 20), dept: "", roles: [], apt: {}, left: "",
            note: "접수 카운터 등록", pledge: "", pledgeFiles: [], createdAt: nowS, createdBy: by };
          t.people.push(p); pid = p.id;
        }
        const calc = window.SemisTraining ? SemisTraining.previewExpire(pid, a.cid, a.date, "") : "";
        t.records.push({ id: uid("tr"), pid, cid: a.cid, date: a.date, expire: isISO(a.expire) && a.expire !== calc ? a.expire : "", hours: num(a.hours), score: null,
          org: norm(a.org), certNo: norm(a.certNo), note: "", files: fileArr(a), src: "desk", createdAt: nowS, createdBy: by });
        const p = people().find(x => x.id === pid), c = courseOf(a.cid);
        out.push({ k: "cert", label: "이수 기록 · " + (p ? p.name : "") + " · " + (c ? c.name : ""), route: "training" });
        if (a.sched) { const n = nextTraining(pid, a.cid); if (n) out.push({ k: "event", label: "다음 이수 일정 " + dot(n.start), route: "schedule" }); }
      } else if (a.k === "event") {
        const f = files[folderFor(a)];
        const cat = CATS[a.cat] ? a.cat : "other";
        const memo = [norm(a.memo), a.place ? "장소: " + norm(a.place) : ""].filter(Boolean).join("\n");
        const html = memo.split("\n").map(l => "<p>" + esc(l) + "</p>").join("") +
          (f ? '<p><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + "</a></p>" : "");
        const time = isHM(a.time) ? a.time : "";
        schedules().push(schedRec({ id: uid("s"), title: norm(a.title), memo, memoHtml: window.SemisNotice ? SemisNotice.sanitizeHtml(html) : html,
          start: a.start, end: isISO(a.end) && a.end >= a.start ? a.end : a.start, allDay: !time, time, timeEnd: time && isHM(a.timeEnd) ? a.timeEnd : "",
          color: pickColor(cat), assignee: norm(a.assignee), room: !!a.room, reminders: CATS[cat][2].slice() }));
        out.push({ k: "event", label: "일정 · " + dot(a.start) + " " + norm(a.title), route: "schedule" });
      } else if (a.k === "dissem") {
        const v = isObj(D().dissem) ? D().dissem : (D().dissem = {});
        if (!Array.isArray(v.events)) v.events = [];
        const depts = Array.isArray(v.depts) && v.depts.length ? v.depts : (window.SemisDissem ? SemisDissem.DEF_DEPTS : []);
        v.events.push({ id: uid("dv"), date: a.date, title: norm(a.title), kind: a.kind, src: norm(a.src), notice: fileArr(a), docs: [],
          targets: depts.map(d => d.id), res: {}, note: isISO(a.due) ? "기한 " + dot(a.due) : "" });
        out.push({ k: "dissem", label: "전파교육 · " + norm(a.title), route: "dissem" });
      } else if (a.k === "audit") {
        if (!Array.isArray(D().audits)) D().audits = [];
        let au = a.auditId !== "_new" ? D().audits.find(x => x && x.id === a.auditId) : null;
        if (!au) {
          let s = isISO(a.start) ? a.start : "", en = isISO(a.end) ? a.end : "";
          if (!s && en) { s = en; en = ""; }
          au = { id: uid("au"), body: BODIES[a.body] ? a.body : "gov", org: norm(a.org), kind: norm(a.kind), start: s, end: en && en !== s ? en : "", place: "", lead: "",
            scope: "", memo: "", outcome: "", cancelled: false, linkCal: true, noCalMain: false, checklist: [], findings: [], files: [], createdAt: nowS, createdBy: by };
          D().audits.push(au);
        }
        au.files = (Array.isArray(au.files) ? au.files : []).concat(fileArr(a));
        if (!Array.isArray(au.findings)) au.findings = [];
        const fs = (a.findings || []).filter(f => f.on && norm(f.text));
        fs.forEach(f => au.findings.push({ id: uid("fd"), type: FTYPES[f.type] ? f.type : "obs", ref: norm(f.ref), text: norm(f.text), action: "", owner: "",
          due: isISO(f.due) ? f.due : "", status: "open", doneDate: "", files: [] }));
        if (fs.length && au.outcome === "none") au.outcome = "";
        au.updatedAt = nowS; au.updatedBy = by;
        if (window.SemisAudit) SemisAudit.syncCalendar(au);
        out.push({ k: "audit", label: "수검 · " + auditTitle(au) + (fs.length ? " · 지적 " + fs.length + "건" : ""), route: "audit" });
      } else if (a.k === "case") {
        if (!Array.isArray(D().secCases)) D().secCases = [];
        const rec = { id: uid("sc"), type: a.type, date: a.date, files: fileArr(a), at: nowS, who: by, chk: "" };
        ["ref", "flight", "pcs", "uld", "agent", "shipper", "region", "start", "end", "by", "result", "note"].forEach(k => { rec[k] = norm(a[k]); });
        D().secCases.push(rec);
        const t = caseTypes().find(x => x.id === a.type);
        out.push({ k: "case", label: (t ? t.label : "처리") + " · " + dot(a.date) + (rec.ref ? " · " + rec.ref : ""), route: "sec-cases" });
      } else if (a.k === "hc") {
        const t = tplOf(a.tid);
        if (!Array.isArray(D().seclog)) D().seclog = [];
        let it = D().seclog.find(r => r && r.hc && r.tid === t.id);
        if (!it) { it = { id: "hc-" + t.id, tid: t.id, hc: true, marks: {}, cnt: {} }; D().seclog.push(it); }
        if (!isObj(it.marks)) it.marks = {};
        if (!isObj(it.cnt)) it.cnt = {};
        let lb;
        if (t.cycle === "event") {
          const m = a.date.slice(0, 7), n = Math.max(1, Math.round(Number(a.count) || 1));
          it.cnt[m] = (Math.round(Number(it.cnt[m])) || 0) + n;
          lb = m.replace("-", ".") + " " + n + "건";
        } else {
          const k = SemisSeclog.periodOf(t, a.date);
          it.marks[k] = a.result === "ng" ? "ng" : "ok";
          lb = SemisSeclog.periodLabel(t, k) + " " + (a.result === "ng" ? "이상" : "확인");
        }
        it.updatedAt = nowS; it.updatedBy = by;
        out.push({ k: "hc", label: "하드카피 · " + t.name + " " + lb, route: "inspection" });
      } else if (a.k === "shelf") {
        if (!Array.isArray(D().docs)) D().docs = [];
        /* sum = 판독 요약(검색 색인용 — 화면에는 보이지 않음). 민감보안정보 문서는 요약도 남기지 않는다 */
        const sum = !a.ssi && e && e.summary ? norm(e.summary).slice(0, 300) : "";
        D().docs.push(Object.assign({ id: uid("dk"), mod: a.mod, grp: a.grp, title: norm(a.title), date: isISO(a.date) ? a.date : "", ser: "", org: norm(a.org), note: "",
          ssi: !!a.ssi, mids: [], files: fileArr(a), src: "desk", at: nowS, by }, sum ? { sum } : {}));
        const m = shelfMods().find(x => x.mod === a.mod);
        out.push({ k: "shelf", label: "문서함 · " + (m ? m.label : a.mod) + " › " + (window.SemisDocs ? SemisDocs.labelOf(a.mod, a.grp) : a.grp), route: a.mod });
      }
    });
    return out;
  }

  /* ── 접수 · 판독 ── */
  const busy = {};          // id → up | read | apply (이 탭에서 진행 중)
  const temp = [];          // 올리는 중인 파일 [{ id, name, size }]
  const drafts = {};        // id → 저장할 내용(고치는 중)
  const fixOpen = {};       // id → { aid: true } — [고치기]로 펼친 줄
  let filterS = "", repaintT = null;
  const ERR = {
    no_key: "AI 설정이 없습니다. 시스템관리자에게 알려 주세요.", busy: "AI 사용량이 많습니다. 잠시 뒤 '다시 읽기'를 눌러 주세요.",
    too_large: "읽을 수 있는 크기(PDF 15MB · 사진 5MB)를 넘습니다. 나눠서 올리거나 '보관만 하기'를 누르세요.",
    unsupported: "읽을 수 없는 형식입니다.", parse: "읽은 내용을 정리하지 못했습니다. '다시 읽기'를 눌러 주세요.", forbidden: "권한이 없습니다.", file: "원본 파일을 찾지 못했습니다."
  };
  const PID = "desk";
  function repaint() {
    if (repaintT) return;
    repaintT = setTimeout(() => {
      repaintT = null;
      if (window.SemisPanel && SemisPanel.isOpen(PID)) SemisPanel.refresh(PID, headPatch());
      if (SeMIS.renderSupport) SeMIS.renderSupport();
    }, 30);
  }
  let mood = "", moodT = null;      // 부엉이 — 저장 직후 happy · 실패 직후 alert (잠깐)
  function setMood(m) {
    mood = m; clearTimeout(moodT);
    moodT = setTimeout(() => { mood = ""; repaint(); }, 2600);
  }

  async function intake(list) {
    if (!canUse()) { toast("이 계정은 접수 카운터를 쓸 수 없습니다.", true); return; }
    if (!window.SemisSync || !SemisSync.uploadFile || !window.SemisDocRead) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    if (!canW()) return submit(list);
    for (const file of Array.from(list || [])) {
      if (!file) continue;
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      const id = uid("dk");
      temp.push({ id, name: file.name, size: file.size || 0 });
      busy[id] = "up"; repaint();
      let x, up;
      try {
        x = await SemisDocRead.extract(file);
        up = await SemisSync.uploadFile(x.file, FOLDER);
      } catch (e) {
        temp.splice(temp.findIndex(t => t.id === id), 1); delete busy[id];
        toast("올리지 못했습니다: " + file.name, true); repaint();
        continue;
      }
      temp.splice(temp.findIndex(t => t.id === id), 1);
      const e = { id, at: new Date().toISOString(), by: me(), file: { name: up.name || x.file.name, size: up.size || x.file.size || 0, url: up.url, type: x.kind },
        status: "reading", type: "", title: "", summary: "" };
      const v = V();
      v.log.unshift(e);
      if (v.log.length > LOG_MAX) v.log = v.log.slice(0, LOG_MAX);
      SeMIS.save();
      read(e.id, x);
    }
  }
  async function read(id, x) {
    const e0 = findLog(id);
    if (!e0) return;
    if (x.mode === "none") {
      e0.status = "wait"; e0.ai = null;
      e0.err = SemisDocRead.whyText ? SemisDocRead.whyText(x) : "내용을 읽지 못했습니다.";
      e0.info = true;
      delete busy[id]; SeMIS.save(); repaint();
      return;
    }
    busy[id] = "read"; repaint();
    let ai = null, err = "";
    try {
      const d = await SemisSync.filesCall({ op: "desk-read", path: pathOf(e0.file.url), name: e0.file.name, text: x.mode === "text" ? x.text : "", cat: catalog() });
      ai = clean(d.data);
    } catch (er) {
      err = ERR[er && er.code] || "내용을 읽지 못했습니다. '다시 읽기'를 눌러 주세요.";
    }
    const e = findLog(id) || (V().log.unshift(e0), e0);
    e.status = "wait";
    delete e.info;
    if (ai) { e.ai = ai; e.type = ai.type; e.title = ai.title; e.summary = ai.summary; delete e.err; }
    else { e.ai = null; e.err = err; setMood("alert"); }
    delete drafts[id]; delete fixOpen[id]; delete busy[id];
    SeMIS.save(); repaint();
  }
  /* 다시 읽기 — 저장된 원본을 받아 글을 다시 뽑는다(직원 접수를 가져올 때도 이 길) */
  async function reread(id) {
    const e = findLog(id);
    if (!e || busy[id]) return;
    busy[id] = "read"; repaint();
    try {
      const p = pathOf(e.file.url);
      const s = await SemisSync.signFiles([p]);
      const url = s.urls[p];
      if (!url) throw new Error("sign");
      const r = await fetch(url);
      if (!r.ok) throw new Error("fetch");
      const blob = await r.blob();
      let f;
      try { f = new File([blob], e.file.name, { type: blob.type }); } catch (er) { f = blob; f.name = e.file.name; }
      const x = SemisDocRead.kindOf(e.file.name) === "image" ? { kind: "image", mode: "file", file: f, text: "" } : await SemisDocRead.extract(f);
      e.status = "reading";
      await read(id, x);
    } catch (er) {
      delete busy[id];
      if (e.status === "reading") { e.status = "wait"; e.err = "원본을 받지 못했습니다. '다시 읽기'를 눌러 주세요."; SeMIS.save(); }
      toast("원본을 받지 못했습니다.", true); repaint();
    }
  }
  /* 처리 결과 한 줄(직원이 보는 '저장한 곳') — 화면 이름만, 사람 이름 · 내용은 넣지 않는다 */
  const resultText = (acts) => Array.from(new Set((acts || []).map(a => (KINDS[a.k] || {}).label).filter(Boolean))).join(" · ").slice(0, 200);
  function closeInbox(e, status) {
    if (!e || !e.inbox || !window.SemisSync || !SemisSync.rpc) return Promise.resolve(false);
    return SemisSync.rpc("semis_logi_desk_close", { p_id: e.inbox, p_status: status, p_result: status === "done" ? resultText(e.acts) : "" })
      .then(d => !!(d && d.ok)).catch(() => false);
  }
  async function apply(id) {
    const e = findLog(id), acts = (drafts[id] || []).filter(a => a.on);
    if (!e || busy[id]) return;
    if (!acts.length) { toast("저장할 곳을 하나 이상 고르세요.", true); return; }
    for (const a of acts) { const m = check(a); if (m) { (fixOpen[id] = fixOpen[id] || {})[a.id] = true; repaint(); toast(KINDS[a.k].label + ": " + m, true); return; } }
    busy[id] = "apply"; repaint();
    const files = {};
    try {
      const from = pathOf(e.file.url);
      for (const fd of Array.from(new Set(acts.map(folderFor).filter(Boolean)))) {
        const d = await SemisSync.filesCall({ op: "copy", from, prefix: fd });
        files[fd] = { name: e.file.name, size: e.file.size || 0, url: d.url };
      }
    } catch (er) {
      delete busy[id]; toast("파일을 옮기지 못했습니다. 다시 눌러 주세요.", true); repaint();
      return;
    }
    const done = commit(acts, files, e);
    const cur = findLog(id) || e;
    Object.assign(cur, { status: "done", acts: done, doneAt: new Date().toISOString(), doneBy: me() });
    delete cur.ai; delete cur.err; delete cur.info;
    delete drafts[id]; delete fixOpen[id]; delete busy[id];
    setMood("happy");
    SeMIS.save(); repaint();
    closeInbox(cur, "done");
    const go = done.find(x => x.route && goOk(x.route));
    const where = Array.from(new Set(done.map(x => (KINDS[x.k] || {}).label).filter(Boolean)));
    toast("저장했습니다 — " + (where.length > 2 ? where.slice(0, 2).join(" · ") + " 외 " + (where.length - 2) + "곳" : where.join(" · ")), false,
      go ? { label: "바로 가기", run: () => { close(); SeMIS.navigate(go.route); } } : null);
  }
  const goOk = (route) => { const mn = SeMIS.menuForModule && SeMIS.menuForModule(route); return !!(mn && SeMIS.navVisible(mn) && SeMIS.hasModule(route)); };
  function keep(id) {
    const e = findLog(id);
    if (!e) return;
    Object.assign(e, { status: "kept", doneAt: new Date().toISOString(), doneBy: me(), acts: [] });
    delete e.ai; delete drafts[id]; delete fixOpen[id];
    SeMIS.save(); repaint();
    closeInbox(e, "kept");
    toast("보관했습니다. '올린 문서 기록'에서 찾을 수 있습니다.");
  }
  function drop(id) {
    const e = findLog(id);
    if (!e) return;
    const fromStaff = !!e.inbox;
    confirmModal(fromStaff ? "직원이 올린 문서를 처리하지 않고 지웁니다. 올린 사람 화면에는 '반려'로 보입니다." : "올린 기록을 지웁니다. 각 화면에 저장한 자료는 그대로 남습니다.", async () => {
      if (fromStaff && !(await closeInbox(e, "back"))) { toast("접수함에 알리지 못했습니다. 잠시 뒤 다시 지워 주세요.", true); return; }
      V().log = logs().filter(x => x.id !== id);
      delete drafts[id]; delete fixOpen[id];
      if (SeMIS.isAdmin() && SemisSync.deleteFile) SemisSync.deleteFile(pathOf(e.file.url)).catch(() => {});
      SeMIS.save(); repaint();
    });
  }
  const draftOf = (e) => drafts[e.id] || (drafts[e.id] = plan(e.ai || null, e.file && e.file.name));
  const stale = (e) => e.status === "reading" && !busy[e.id] && Date.now() - Date.parse(e.at || 0) > STALE_MS;

  /* ── 직원 접수(안전보안파트 미만) — desk-in/ 에 올리고 비공개 접수함에 한 줄. 안전보안파트 화면이 가져가 판독한다 ── */
  let mine = null, mineAt = 0;
  const MST = { new: ["확인 대기", "blue"], taken: ["확인 중", "amber"], done: ["저장됨", "green"], kept: ["보관", "gray"], back: ["반려", "red"], cancel: ["올리기 취소", "gray"] };
  async function submit(list) {
    let sent = 0;
    for (const file of Array.from(list || [])) {
      if (!file) continue;
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      const id = uid("up");
      temp.push({ id, name: file.name, size: file.size || 0 });
      repaint();
      try {
        const k = SemisDocRead.kindOf(file.name);
        const f = k === "image" && SemisDocRead.prep ? await SemisDocRead.prep(file) : file;
        const up = await SemisSync.uploadFile(f, FOLDER_IN);
        const d = await SemisSync.rpc("semis_logi_desk_submit", { p: { path: pathOf(up.url), name: String(up.name || f.name || "file").slice(0, 160), size: up.size || f.size || 0, ftype: SemisDocRead.kindOf(f.name || file.name) } });
        if (!d || !d.ok) throw Object.assign(new Error("submit"), { code: d && d.error });
        if (Array.isArray(mine) && d.item) mine.unshift(d.item);
        sent++;
      } catch (er) {
        toast("올리지 못했습니다: " + file.name + (er && er.code === "rate" ? " — 잠시 뒤 다시 올려 주세요." : ""), true);
      } finally {
        const i = temp.findIndex(t => t.id === id);
        if (i >= 0) temp.splice(i, 1);
        repaint();
      }
    }
    if (sent) { toast("올렸습니다. 안전보안파트가 확인한 뒤 알맞은 화면에 정리합니다."); loadMine(true); }
  }
  async function loadMine(force) {
    if (!canUse() || canW() || !window.SemisSync || !SemisSync.rpc) return;
    if (!force && mine && Date.now() - mineAt < 20000) return;
    try {
      const d = await SemisSync.rpc("semis_logi_desk_mine", {});
      if (d && d.ok && Array.isArray(d.items)) { mine = d.items; mineAt = Date.now(); repaint(); }
    } catch (e) { /* 다음에 다시 */ }
  }
  async function cancelMine(id) {
    try {
      const d = await SemisSync.rpc("semis_logi_desk_cancel", { p_id: id });
      if (!d || !d.ok) throw new Error("cancel");
      toast("올리기를 취소했습니다.");
    } catch (e) { toast("취소하지 못했습니다. 이미 확인 중일 수 있습니다.", true); }
    loadMine(true);
  }
  const minePending = () => (Array.isArray(mine) ? mine.filter(x => x.status === "new" || x.status === "taken").length : 0);

  /* 안전보안파트 화면 — 직원 접수를 가져와 '확인 대기'로(한 사람만 가져가도록 서버가 잠근다) */
  let inboxBusy = 0, inboxAt = 0;          // inboxBusy = 시작 시각(응답 없는 요청이 90초 넘게 막지 않게)
  const kindOfName = (n) => (window.SemisDocRead ? SemisDocRead.kindOf(n) : "other");
  async function pullInbox(force) {
    if (!canW() || (inboxBusy && Date.now() - inboxBusy < 90000) || !window.SemisSync || !SemisSync.rpc || !SemisSync.auth || !SemisSync.auth.token || !SemisSync.auth.token()) return;
    if (!force && Date.now() - inboxAt < 60000) return;
    inboxBusy = inboxAt = Date.now();
    try {
      const d = await SemisSync.rpc("semis_logi_desk_inbox", {});
      const list = d && d.ok && Array.isArray(d.items) ? d.items : [];
      for (const it of list) {
        if (!it || !it.id || !/^desk-in\//.test(String(it.path || ""))) continue;
        const have = logs().find(e => e.inbox === it.id);
        if (have) { if (have.status === "done" || have.status === "kept") closeInbox(have, have.status); continue; }
        const t = await SemisSync.rpc("semis_logi_desk_take", { p_id: it.id }).catch(() => null);
        if (!t || !t.ok || logs().some(e => e.inbox === it.id)) continue;
        const e = { id: uid("dk"), at: it.at || new Date().toISOString(), by: str(it.by, 40), inbox: it.id,
          file: { name: str(it.name, 160) || "file", size: Number(it.size) || 0, url: SemisSync.PUBLIC_PREFIX + it.path, type: kindOfName(it.name) },
          status: "reading", type: "", title: "", summary: "" };
        const v = V();
        v.log.unshift(e);
        if (v.log.length > LOG_MAX) v.log = v.log.slice(0, LOG_MAX);
        SeMIS.save(); repaint();
        reread(e.id);
      }
    } catch (er) { /* 다음 차례에 */ }
    inboxBusy = 0;
  }
  function remoteInbox() {
    if (canW()) pullInbox(true);
    else if (isOpen()) loadMine(true);
  }

  /* ── 화면: 확인 카드 ── */
  const opt = (v, lb, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? " selected" : ""}>${esc(lb)}</option>`;
  const fld = (lb, html, wide) => `<label class="dk-f${wide ? " dk-w" : ""}"><span>${esc(lb)}</span>${html}</label>`;
  const inp = (a, f, lb, type, wide, extra) => fld(lb, `<input${type ? ` type="${type}"` : ""} data-f="${f}" value="${esc(a[f] == null ? "" : a[f])}"${extra || ""}>`, wide);
  const sel = (a, f, lb, opts, re, wide) => fld(lb, `<select data-f="${f}"${re ? " data-re" : ""}>${opts}</select>`, wide);
  const ck = (a, f, lb) => `<label class="dk-ck"><input type="checkbox" data-f="${f}"${a[f] ? " checked" : ""}><span>${esc(lb)}</span></label>`;
  function actBody(a) {
    switch (a.k) {
      case "cert": {
        const ps = activeP().slice().sort((x, y) => String(x.name).localeCompare(String(y.name), "ko"));
        const c = courseOf(a.cid);
        const pid = a.pid === "_new" ? "" : a.pid;
        const calc = pid && c && isISO(a.date) && window.SemisTraining ? SemisTraining.previewExpire(pid, a.cid, a.date, "") : "";
        const dup = pid && dupRec(pid, a.cid, a.date);
        return sel(a, "pid", "이수자", ps.map(p => opt(p.id, p.name + (p.dept ? " · " + p.dept : ""), a.pid)).join("") + opt("_new", "새 인원 등록", a.pid), true)
          + (a.pid === "_new" ? inp(a, "name", "새 인원 이름") + inp(a, "emp", "사번") : "")
          + sel(a, "cid", "과정", opt("", "선택", a.cid) + courses().map(x => opt(x.id, x.name, a.cid)).join(""), true, true)
          + inp(a, "date", "수료일", "date", false, " data-re") + inp(a, "expire", "유효기한(이수증)", "date")
          + inp(a, "hours", "교육 시간", "number", false, ' min="0" step="0.5"') + inp(a, "org", "교육기관") + inp(a, "certNo", "이수증 번호")
          + (c && Number(c.cycle) > 0 ? ck(a, "sched", "다음 이수 기간 일정") : "")
          + `<p class="dk-note">${a.course ? "이수증: " + esc(a.course) : ""}${calc ? " · 계산 유효기한 " + esc(dot(calc)) : ""}${dup ? " · " + ui.chip("이미 등록된 기록", "amber") : ""}</p>`;
      }
      case "event":
        return inp(a, "title", "일정", "", true) + inp(a, "start", "시작일", "date") + inp(a, "end", "종료일", "date") + inp(a, "time", "시작", "time") + inp(a, "timeEnd", "종료", "time")
          + sel(a, "cat", "구분", Object.keys(CATS).map(k => opt(k, CATS[k][0], a.cat)).join(""))
          + sel(a, "area", "분야", opt("", "-", a.area) + AREAS.map(x => opt(x[0], x[1], a.area)).join(""), true)
          + fld("담당", `<input data-f="assignee" value="${esc(a.assignee)}" list="dk-dl-as" autocomplete="off">`)
          + inp(a, "place", "장소", "", true) + inp(a, "memo", "메모", "", true) + ck(a, "room", "회의실") + ck(a, "file", "원본 첨부");
      case "dissem":
        return inp(a, "title", "전파 내용", "", true) + inp(a, "date", "전파교육일", "date") + sel(a, "kind", "구분", dissemKinds().map(k => opt(k, k, a.kind)).join(""))
          + inp(a, "src", "발신") + inp(a, "due", "기한", "date");
      case "audit": {
        const isNew = a.auditId === "_new";
        return sel(a, "auditId", "수검", opt("_new", "새 수검 등록", a.auditId) + audits().slice(0, 40).map(x => opt(x.id, auditTitle(x) + (x.start ? " · " + dot(x.start) : ""), a.auditId)).join(""), true, true)
          + (isNew ? sel(a, "body", "구분", Object.keys(BODIES).map(k => opt(k, BODIES[k], a.body)).join("")) + inp(a, "org", "점검 기관") + inp(a, "kind", "점검 유형")
            + inp(a, "start", "시작일", "date") + inp(a, "end", "종료일", "date") : "")
          + `<div class="dk-w dk-finds">${(a.findings || []).map((f, i) => `<div class="dk-find" data-fi="${i}">
              <label class="dk-ck"><input type="checkbox" data-ff="on"${f.on ? " checked" : ""}><span class="sr-only">저장</span></label>
              <select data-ff="type" aria-label="지적 구분">${Object.keys(FTYPES).map(k => opt(k, FTYPES[k], f.type)).join("")}</select>
              <input data-ff="text" value="${esc(f.text)}" aria-label="지적 내용">
              <input data-ff="ref" value="${esc(f.ref)}" placeholder="근거" aria-label="근거 조항">
              <input type="date" data-ff="due" value="${esc(f.due)}" aria-label="조치 기한"></div>`).join("") || '<p class="dk-note">지적사항 없음 — 결과 문서만 붙입니다.</p>'}
            <button type="button" class="link-btn" data-fadd>${icon("plus", 14)}<span>지적 추가</span></button></div>`;
      }
      case "case":
        return sel(a, "type", "유형", opt("", "선택", a.type) + caseTypes().map(t => opt(t.id, t.label, a.type)).join("")) + inp(a, "date", "일자", "date")
          + inp(a, "ref", "운송장(MAWB)") + inp(a, "flight", "편명") + inp(a, "pcs", "수량") + inp(a, "uld", "ULD") + inp(a, "agent", "대리점") + inp(a, "shipper", "화주")
          + inp(a, "region", "지역") + inp(a, "start", "시작", "time") + inp(a, "end", "종료", "time") + inp(a, "by", "확인") + inp(a, "result", "처리 결과", "", true) + inp(a, "note", "비고", "", true);
      case "hc": {
        const t = tplOf(a.tid);
        return sel(a, "tid", "기록부 양식", opt("", "선택", a.tid) + templates().map(x => opt(x.id, x.name + " (" + (SemisSeclog.cycLabel ? SemisSeclog.cycLabel(x) : x.cycle) + ")", a.tid)).join(""), true, true)
          + inp(a, "date", "기록 날짜", "date", false, " data-re")
          + (t && t.cycle === "event" ? inp(a, "count", "건수", "number", false, ' min="1"') : sel(a, "result", "결과", opt("ok", "확인", a.result) + opt("ng", "이상", a.result)))
          + (t && t.cycle !== "event" && isISO(a.date) ? `<p class="dk-note">주기: ${esc(SemisSeclog.periodLabel(t, SemisSeclog.periodOf(t, a.date)))}</p>` : "");
      }
      case "shelf": {
        const ms = shelfMods(), m = ms.find(x => x.mod === a.mod);
        return sel(a, "mod", "화면", opt("", "선택", a.mod) + ms.map(x => opt(x.mod, x.label, a.mod)).join(""), true)
          + sel(a, "grp", "묶음", opt("", "선택", a.grp) + (m ? m.groups.map(g => opt(g.id, g.label, a.grp)).join("") : ""))
          + inp(a, "title", "문서 이름", "", true) + inp(a, "date", "문서 일자", "date") + inp(a, "org", "기관") + ck(a, "ssi", "민감보안정보");
      }
      default: return "";
    }
  }
  /* 저장할 곳 한 줄 요약 — 무엇이 어디에 들어가는지만 */
  function rowSub(a) {
    const d = (s) => (isISO(s) ? dot(s) : "");
    switch (a.k) {
      case "cert": {
        const p = a.pid === "_new" ? null : people().find(x => x.id === a.pid);
        const c = courseOf(a.cid);
        return [p ? p.name : (norm(a.name) ? norm(a.name) + "(새 인원)" : "이수자 미정"), c ? c.name : (a.course || "과정 미정"), a.date ? "수료 " + d(a.date) : ""].filter(Boolean).join(" · ")
          + (a.sched ? " · 다음 교육 일정 포함" : "");
      }
      case "event": return [d(a.start) + (isISO(a.end) && a.end > a.start ? "~" + d(a.end) : "") + (isHM(a.time) ? " " + a.time : ""), norm(a.title), a.assignee ? "담당 " + norm(a.assignee) : ""].filter(Boolean).join(" · ");
      case "dissem": return [d(a.date), norm(a.title)].filter(Boolean).join(" · ");
      case "audit": {
        const au = a.auditId !== "_new" ? audits().find(x => x.id === a.auditId) : null;
        const n = (a.findings || []).filter(f => f.on && norm(f.text)).length;
        return (au ? auditTitle(au) : "새 수검 · " + [norm(a.org), norm(a.kind)].filter(Boolean).join(" ")) + " · 지적 " + n + "건";
      }
      case "case": { const t = caseTypes().find(x => x.id === a.type); return [t ? t.label : "유형 미정", d(a.date), norm(a.ref)].filter(Boolean).join(" · "); }
      case "hc": { const t = tplOf(a.tid); return [t ? t.name : "양식 미정", d(a.date), t && t.cycle === "event" ? (Number(a.count) || 1) + "건" : a.result === "ng" ? "이상" : "확인"].filter(Boolean).join(" · "); }
      case "shelf": {
        const m = shelfMods().find(x => x.mod === a.mod);
        return [(m ? m.label : "화면 미정") + (a.grp && window.SemisDocs ? " › " + SemisDocs.labelOf(a.mod, a.grp) : ""), norm(a.title)].filter(Boolean).join(" · ") + (a.ssi ? " · 민감보안정보" : "");
      }
      default: return "";
    }
  }
  function actHTML(e, a) {
    const msg = a.on ? check(a) : "";
    const dup = a.k === "cert" && a.pid !== "_new" && dupRec(a.pid, a.cid, a.date);
    const open = !!((fixOpen[e.id] || {})[a.id]) || !!msg;
    return `<div class="dkc-row${a.on ? " on" : ""}" data-aid="${esc(a.id)}">
      <div class="dkc-rh"><label class="dkc-ck"><input type="checkbox" data-f="on"${a.on ? " checked" : ""}>
        <span class="dkc-rt"><b>${esc(KINDS[a.k].save)}</b><small>${esc(rowSub(a))}</small></span></label>
        ${dup ? ui.chip("이미 등록된 기록", "amber") : ""}${msg ? `<span class="dkc-need">${icon("alert", 14)}${esc(msg)}</span>` : ""}
        <button type="button" class="btn btn-ghost dkc-fix" data-fix aria-expanded="${open}">${icon(open ? "chevup" : "edit", 16)}<span>${open ? "접기" : "고치기"}</span></button></div>
      <div class="dk-ab"${open ? "" : " hidden"}>${actBody(a)}</div></div>`;
  }
  /* 한 문장 확인 — 판독 결과에서 핵심 값만 강조 */
  function sayHTML(e, acts) {
    const ai = e.ai, k = (s) => `<mark class="dkc-k">${esc(s)}</mark>`;
    if (!ai) return "";
    let s = "";
    const T = ai.type;
    if (T === "cert" && ai.certs.length) {
      const c = ai.certs[0], cr = courseOf(c.cid);
      s = k(c.name || "이름 미상") + "님의 " + k((cr && cr.name) || c.course || "교육") + " 이수증입니다." + (c.date ? " 수료일은 " + k(dot(c.date)) + "입니다." : "")
        + (ai.certs.length > 1 ? " 이 문서에 " + k(ai.certs.length + "명") + "이 있습니다." : "");
    } else if (T === "notice" && ai.events.length) {
      const v = ai.events[0];
      s = k(v.title) + " — " + k(dot(v.start) + (v.time ? " " + v.time : "")) + " 일정이 있는 문서입니다.";
    } else if (T === "dissem" && ai.dissem) s = k(ai.dissem.title) + " 전파 통보입니다." + (ai.dissem.due ? " 기한은 " + k(dot(ai.dissem.due)) + "입니다." : "");
    else if (T === "audit" && ai.audit) {
      const n = ai.audit.findings.length;
      s = k([ai.audit.org || ai.org, ai.audit.kind].filter(Boolean).join(" ") || "점검") + " 결과입니다." + (n ? " 지적사항 " + k(n + "건") + "이 있습니다." : "");
    } else if (T === "special" && ai.case) { const t = caseTypes().find(x => x.id === ai.case.type); s = k(t ? t.label : "보안 처리") + " 보고서입니다." + (ai.case.date ? " 처리일은 " + k(dot(ai.case.date)) + "입니다." : ""); }
    else if (T === "hardcopy" && ai.hardcopy) { const t = tplOf(ai.hardcopy.tid); s = k(t ? t.name : "기록부") + " 스캔입니다."; }
    else s = ai.title ? k(ai.title) + " 문서입니다." : "";
    const n = acts.filter(a => a.on).length;
    s += n ? " 아래 " + k(n + "곳") + "에 저장할까요?" : " 저장할 곳을 고르거나 '보관만 하기'를 누르세요.";
    return `<div class="dkc-say"><span class="dkc-owl" aria-hidden="true">${window.SemisOwl ? SemisOwl.svg("idle", 36) : ""}</span><div><p class="dkc-s">${s}</p>${ai.summary ? `<p class="dkc-sum">${esc(ai.summary)}</p>` : ""}</div></div>`;
  }
  function itemHTML(e) {
    const b = busy[e.id];
    const st = b === "read" || e.status === "reading" ? (stale(e) ? ["읽기 멈춤", "red"] : ST.reading) : b === "apply" ? ["저장 중", "amber"] : ST[e.status] || ST.wait;
    const ty = TYPES[e.type];
    const acts = e.status === "wait" && !b ? draftOf(e) : [];
    const lock = !!b || e.status === "reading" && !stale(e);
    const n = acts.filter(a => a.on).length;
    return `<article class="dk-item dkc" data-dk="${esc(e.id)}">
      <header class="dk-ih">${icon("doc", 18)}<a class="nb-file dk-fn" href="${esc(e.file.url)}" target="_blank" rel="noopener" data-name="${esc(e.file.name)}">${esc(e.file.name)}</a>
        <small class="mono">${esc(fmtSize(e.file.size))}</small>${e.inbox ? ui.chip("직원 접수", "blue") : ""}${ty ? ui.chip(ty[0], ty[1]) : ""}${ui.chip(st[0], st[1])}<span class="spacer"></span>
        <small class="dk-by">${esc(dot(String(e.at || "").slice(0, 10)))} ${esc(e.by || "")}</small>
        <button type="button" class="icon-btn dkc-more" data-do="more" aria-label="${esc(e.file.name)} 더보기" title="더보기"${lock ? " disabled" : ""}>${icon("more", 20)}</button></header>
      ${e.status === "wait" && !b ? sayHTML(e, acts) : ""}
      ${e.status === "reading" || b === "read" ? `<p class="dkc-wait">${stale(e) ? "읽기가 멈췄습니다. 더보기(…) › '다시 읽기'를 눌러 주세요." : "내용을 읽고 있습니다. 창을 닫아도 계속 읽습니다."}</p>` : ""}
      ${e.err ? `<p class="${e.info ? "dkc-info" : "dk-err"}" role="${e.info ? "note" : "alert"}">${icon(e.info ? "info" : "alert", 16)}<span>${esc(e.err)}</span></p>` : ""}
      ${acts.length ? `<div class="dkc-acts">${acts.map(a => actHTML(e, a)).join("")}</div>` : ""}
      ${e.status === "wait" && !b ? `<div class="dkc-add"><span>저장할 곳 추가</span>
        <button type="button" class="link-btn" data-add="event">${icon("plus", 14)}<span>일정</span></button>
        <button type="button" class="link-btn" data-add="cert">${icon("plus", 14)}<span>이수 기록</span></button>
        <button type="button" class="link-btn" data-add="shelf">${icon("plus", 14)}<span>문서함</span></button></div>
      <footer class="dkc-foot">
        <button type="button" class="btn btn-ghost dkc-keep" data-do="keep"${lock ? " disabled" : ""}>보관만 하기</button><span class="spacer"></span>
        <button type="button" class="btn btn-primary dkc-go" data-do="apply"${lock || !n ? " disabled" : ""}>${icon("check", 18)}<span>이대로 저장${n ? " · " + n + "곳" : ""}</span></button></footer>` : ""}</article>`;
  }

  /* ── 패널 ── */
  let tab = "up";
  const pending = () => logs().filter(e => e.status === "wait" || e.status === "reading");
  const reading = () => logs().filter(e => (e.status === "reading" && !stale(e)) || busy[e.id] === "read").length + temp.length;
  function headPatch() {
    if (!canW()) {
      const n = minePending();
      return { sub: SUB, mascot: mood || (temp.length ? "thinking" : "idle"),
        tabs: [{ id: "up", label: "올리기" }, { id: "mine", label: "내가 올린 문서", badge: n || "" }] };
    }
    const n = pending().length, r = reading();
    return {
      sub: [r ? "내용 확인 중 " + r : "", n ? "확인 대기 " + n : ""].filter(Boolean).join(" · ") || SUB,
      mascot: mood || (r ? "thinking" : "idle"),
      tabs: [{ id: "up", label: "올리기 · 확인", badge: n || "" }, { id: "log", label: "올린 문서 기록" }]
    };
  }
  function open(t) {
    if (!canUse()) { toast("이 계정은 접수 카운터를 쓸 수 없습니다.", true); return null; }
    const tabs = canW() ? ["up", "log"] : ["up", "mine"];
    if (tabs.indexOf(t) >= 0) tab = t;
    if (tabs.indexOf(tab) < 0) tab = "up";
    if (canW()) pullInbox(); else loadMine();
    return SeMIS.ui.panel(Object.assign({
      id: PID, title: TITLE, tab, cls: "pnl-desk",
      onTab: (x) => { tab = x; if (x === "mine") loadMine(); }, render: paint,
      actions: canW() ? '<button type="button" class="link-btn head-link" data-dk-areas>분야별 담당</button>' : "",
      onActs: (box) => { const b = box.querySelector("[data-dk-areas]"); if (b) b.onclick = areasForm; },
      print: () => TITLE + " — " + (tab === "mine" ? "내가 올린 문서" : "올린 문서 기록")
    }, headPatch()));
  }
  const close = () => { if (window.SemisPanel) SemisPanel.close(PID); };
  const isOpen = () => !!(window.SemisPanel && SemisPanel.isOpen(PID));

  function logRows() {
    return logs().filter(e => e.status !== "wait" && e.status !== "reading" && (!filterS || e.status === filterS)).slice(0, 200);
  }
  function logHTML() {
    const rs = logRows();
    const segs = [["", "전체"], ["done", "저장됨"], ["kept", "보관"]];
    return `<div class="toolbar no-print"><div class="seg" role="group" aria-label="처리 상태">${segs.map(([v, lb]) => `<button type="button" class="seg-btn" data-dks="${v}" aria-pressed="${filterS === v}">${lb}</button>`).join("")}</div>
        <span class="spacer"></span><small class="dk-cnt">${rs.length}건</small></div>
      ${rs.length ? `<div class="table-wrap"><table class="tbl dk-tbl"><thead><tr><th>올린 날</th><th>파일</th><th>구분</th><th>제목</th><th>저장한 곳</th><th>처리</th></tr></thead>
      <tbody>${rs.map(e => { const ty = TYPES[e.type]; return `<tr>
        <td class="mono">${esc(dot(String(e.at || "").slice(0, 10)))}<div class="cell-sub">${esc(e.by || "")}${e.inbox ? " · 직원 접수" : ""}</div></td>
        <td><a class="nb-file" href="${esc(e.file.url)}" target="_blank" rel="noopener" data-name="${esc(e.file.name)}">${esc(e.file.name)}</a></td>
        <td>${ty ? ui.chip(ty[0], ty[1]) : "-"}</td><td data-role="title">${esc(e.title || "-")}</td>
        <td>${(e.acts || []).length ? (e.acts || []).map(a => `<button type="button" class="dk-go" data-go="${esc(a.route || "")}">${esc(a.label)}</button>`).join("") : '<span class="cell-sub">보관</span>'}</td>
        <td class="mono">${esc(dot(String(e.doneAt || "").slice(0, 10)))}<div class="cell-sub">${esc(e.doneBy || "")}</div></td></tr>`; }).join("")}</tbody></table></div>`
        : ui.empty("올린 문서 기록이 없습니다.")}`;
  }
  function mineHTML(all) {
    if (!Array.isArray(mine)) return `<p class="dkc-wait">불러오는 중입니다…</p>`;
    const rs = all ? mine : mine.slice(0, 5);
    if (!rs.length) return all ? ui.empty("아직 올린 문서가 없습니다.") : "";
    const row = (x) => { const s = MST[x.status] || MST.new; return `<tr>
        <td class="mono">${esc(dot(String(x.at || "").slice(0, 10)))}</td>
        <td data-role="title">${esc(x.name || "")}</td>
        <td>${ui.chip(s[0], s[1])}</td>
        <td>${esc(x.status === "done" ? (x.result || "저장됨") : x.status === "back" ? "처리하지 않음 — 필요하면 안전보안파트에 문의" : x.status === "kept" ? "문서만 보관" : "")}</td>
        <td class="td-act">${x.status === "new" ? `<button type="button" class="link-btn danger" data-cancel="${esc(x.id)}">올리기 취소</button>` : esc(dot(String(x.done_at || "").slice(0, 10)))}</td></tr>`; };
    return `${all ? "" : `<h3 class="dkc-h">내가 올린 문서 <small>최근 ${rs.length}건</small></h3>`}
      <div class="table-wrap"><table class="tbl dk-tbl"><thead><tr><th>올린 날</th><th>파일</th><th>상태</th><th>처리 결과</th><th>처리일</th></tr></thead>
      <tbody>${rs.map(row).join("")}</tbody></table></div>
      ${!all && mine.length > rs.length ? `<button type="button" class="link-btn" data-tab-mine>${mine.length}건 모두 보기</button>` : ""}`;
  }
  function stepsHTML() {
    const hq = canW();
    const r = hq ? reading() : temp.length, w = hq ? pending().filter(e => e.status === "wait").length : 0;
    const cur = r ? 2 : w ? 3 : 1;
    const names = hq ? ["파일 올리기", "내용 확인 중", "확인하고 저장"] : ["파일 올리기", "안전보안파트 확인", "알맞은 화면에 저장"];
    return `<ol class="dkc-steps" aria-label="진행 단계">${names.map((nm, i) => {
      const k = i + 1, done = hq && k < cur, now = hq ? k === cur : k === 1;
      return `<li class="${done ? "is-done" : ""}${now ? " is-now" : ""}"${now ? ' aria-current="step"' : ""}><span class="dkc-n" aria-hidden="true">${done ? icon("check", 16) : k}</span><span>${esc(nm)}</span></li>`;
    }).join("")}</ol>${hq && r ? '<p class="dkc-note">창을 닫아도 계속 읽습니다. 다 되면 접수 카운터 숫자로 알려 드립니다.</p>' : ""}`;
  }
  function upHTML() {
    const hq = canW();
    const pd = hq ? pending() : [];
    const asNames = (SeMIS.assignees ? SeMIS.assignees() : []).map(a => a.name);
    return stepsHTML() + `<section class="dkc-drop no-print" id="dk-drop">
          <span class="dk-dico">${icon("up", 28)}</span>
          <div class="dk-dt"><b>파일을 여기에 놓으세요</b><small>PDF · 사진 · 한글 · 워드 · 엑셀 · 파워포인트 — 어느 화면에서든 끌어다 놓아도 됩니다</small></div>
          <div class="dk-db"><button type="button" class="btn btn-primary dkc-pick" id="dk-pick">${icon("plus", 18)}<span>파일 고르기</span></button>
            <button type="button" class="btn btn-ghost dk-cam" id="dk-cam">${icon("image", 18)}<span>사진 찍기</span></button></div>
          <input type="file" id="dk-file" multiple hidden><input type="file" id="dk-photo" accept="image/*" capture="environment" hidden></section>
        <ul class="dkc-ex no-print" aria-label="올리면 이렇게 정리됩니다">
          <li><b>교육 이수증</b><span>교육 기록 + 다음 교육 일정</span></li>
          <li><b>공문 · 회의 통보</b><span>일정</span></li>
          <li><b>점검 결과</b><span>수검 · 지적사항</span></li></ul>`
      + (temp.length || pd.length ? `<section class="dk-queue" aria-label="확인 대기">
          ${temp.map(t => `<article class="dk-item is-up"><header class="dk-ih">${icon("doc", 18)}<span class="dk-fn">${esc(t.name)}</span><small class="mono">${esc(fmtSize(t.size))}</small>${ui.chip("올리는 중", "amber")}</header></article>`).join("")}
          ${pd.map(itemHTML).join("")}</section>`
        : hq ? `<div class="dk-none"><span class="dk-owl"></span><p>확인할 문서가 없습니다.</p></div>` : "")
      + (hq ? "" : `<section class="dkc-mine">${mineHTML(false)}</section>`)
      + `<datalist id="dk-dl-as">${asNames.map(n => `<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  }
  function paint(body, h) {
    body.innerHTML = tab === "log" ? `<section class="dk-log" id="dk-log">${logHTML()}</section>`
      : tab === "mine" ? `<section class="dk-log">${mineHTML(true)}</section>` : upHTML();
    const pb = h && h.el ? h.el.querySelector(".pnl-print") : null;
    if (pb) pb.hidden = tab === "up";
    const ow = body.querySelector(".dk-owl");
    if (ow && window.SemisOwl) SemisOwl.mount(ow, { size: 96, state: "idle" });
    wire(body);
    const raf = window.requestAnimationFrame || ((f) => setTimeout(f, 16));
    if (SeMIS.tidyTables) raf(() => SeMIS.tidyTables(body));
  }
  function setField(a, el) {
    const f = el.dataset.f;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (f === "area") a.assignee = areaNames(v);
    if (f === "place" && ROOM(v)) a.room = true;
    if (f === "mod") a.grp = "";
    if (f === "cid") { const c = courseOf(v); a.sched = !!(c && Number(c.cycle) > 0); }
    a[f] = v;
  }
  function wire(root) {
    const dz = $("#dk-drop", root);
    if (dz) {
      const fi = $("#dk-file", root), ph = $("#dk-photo", root);
      $("#dk-pick", root).onclick = (ev) => { ev.stopPropagation(); fi.click(); };
      $("#dk-cam", root).onclick = (ev) => { ev.stopPropagation(); ph.click(); };
      dz.onclick = (ev) => { if (!ev.target.closest("button")) fi.click(); };
      [fi, ph].forEach(i => { i.onchange = () => { const l = Array.from(i.files || []); i.value = ""; intake(l); }; });
      dz.addEventListener("dragover", (ev) => { ev.preventDefault(); dz.classList.add("on"); });
      dz.addEventListener("dragleave", () => dz.classList.remove("on"));
      dz.addEventListener("drop", (ev) => { ev.preventDefault(); dz.classList.remove("on"); dragOff(); intake(Array.from((ev.dataTransfer && ev.dataTransfer.files) || [])); });
    }
    const ar = $("#dk-areas", root); if (ar) ar.onclick = areasForm;
    $$("[data-dks]", root).forEach(b => b.onclick = () => { filterS = b.dataset.dks; if (isOpen()) SemisPanel.refresh(PID); });
    $$("[data-go]", root).forEach(b => b.onclick = () => { if (!b.dataset.go) return; close(); SeMIS.navigate(b.dataset.go); });
    $$("[data-cancel]", root).forEach(b => b.onclick = () => cancelMine(b.dataset.cancel));
    $$("[data-tab-mine]", root).forEach(b => b.onclick = () => SemisPanel.setTab(PID, "mine"));
    $$(".dk-item[data-dk]", root).forEach(wireItem);
  }
  function wireItem(card) {
    const id = card.dataset.dk, e = findLog(id);
    if (!e) return;
    const repaintCard = (focusSel) => {
      const n = document.createElement("div");
      n.innerHTML = itemHTML(findLog(id) || e);
      const nc = n.firstElementChild;
      card.replaceWith(nc);
      wireItem(nc);
      if (focusSel) { const f = nc.querySelector(focusSel); if (f) { try { f.focus(); } catch (er) { /* 포커스 불가 */ } } }
    };
    const onEdit = (ev) => {
      const el = ev.target, box = el.closest("[data-aid]");
      if (!box) return;
      const a = (drafts[id] || []).find(x => x.id === box.dataset.aid);
      if (!a) return;
      if (el.dataset.ff) {
        const fr = el.closest("[data-fi]"), f = a.findings && a.findings[Number(fr.dataset.fi)];
        if (f) f[el.dataset.ff] = el.type === "checkbox" ? el.checked : el.value;
        return;
      }
      if (!el.dataset.f) return;
      setField(a, el);
      if (ev.type === "change" && (el.hasAttribute("data-re") || el.dataset.f === "on" || el.dataset.f === "area"))
        repaintCard('[data-aid="' + a.id + '"] [data-f="' + el.dataset.f + '"]');
      else if (ev.type === "change") {          // 요약 줄 · 확인 문장만 새로
        const sub = box.querySelector(".dkc-rt small");
        if (sub) sub.textContent = rowSub(a);
      }
    };
    card.addEventListener("input", onEdit);
    card.addEventListener("change", onEdit);
    $$("[data-fix]", card).forEach(b => b.onclick = () => {
      const aid = b.closest("[data-aid]").dataset.aid;
      const m = fixOpen[id] = fixOpen[id] || {};
      m[aid] = b.getAttribute("aria-expanded") !== "true";
      repaintCard('[data-aid="' + aid + '"] [data-fix]');
    });
    $$("[data-fadd]", card).forEach(b => b.onclick = () => {
      const a = (drafts[id] || []).find(x => x.id === b.closest("[data-aid]").dataset.aid);
      if (a) { (a.findings = a.findings || []).push({ on: true, type: "obs", ref: "", text: "", due: "" }); repaintCard(); }
    });
    $$("[data-add]", card).forEach(b => b.onclick = () => {
      const ds = draftOf(e), k = b.dataset.add, ai = e.ai || null;
      let a;
      if (k === "event") a = eventAct({ title: (ai && ai.title) || "", start: (ai && ai.date) || todayISO(), end: "", time: "", timeEnd: "", place: "", cat: "other", area: "", memo: "" }, true);
      else if (k === "cert") a = certAct({ name: "", emp: "", cid: "", date: "", expire: "", org: "", certNo: "", hours: null, course: "" }, true);
      else a = shelfAct(guessShelf(ai, e.file && e.file.name), true, ai);
      ds.push(a);
      (fixOpen[id] = fixOpen[id] || {})[a.id] = true;
      repaintCard('[data-aid="' + a.id + '"] [data-fix]');
    });
    $$("[data-do]", card).forEach(b => b.onclick = () => {
      const d = b.dataset.do;
      if (d === "apply") apply(id); else if (d === "keep") keep(id); else if (d === "more") moreSheet(e, b);
    });
  }
  function moreSheet(e, from) {
    const canRe = e.file.type !== "legacy" && e.file.type !== "other";
    const items = [];
    if (canRe) items.push({ label: "다시 읽기", icon: icon("refresh"), run: () => reread(e.id) });
    items.push({ label: "원본 보기", icon: icon("eye"), run: () => { const a = document.querySelector('[data-dk="' + e.id + '"] .dk-fn'); if (a) a.click(); } });
    items.push({ label: e.inbox ? "처리하지 않고 지우기(반려)" : "지우기", icon: icon("trash"), danger: true, run: () => drop(e.id) });
    SeMIS.actionSheet(items, { title: e.file.name }, from);
  }
  function areasForm() {
    if (!canW()) return;
    const m = isObj(V().cfg.areas) ? V().cfg.areas : {};
    openModal(`<h3>분야별 담당</h3>
      ${AREAS.map(([k, lb]) => `<div class="form-row"><label for="dk-a-${k}">${esc(lb)}</label><input id="dk-a-${k}" value="${esc(m[k] || "")}" list="dk-dl-as" autocomplete="off" placeholder="이름, 이름"></div>`).join("")}
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const o = {};
      AREAS.forEach(([k]) => { const v = norm($("#dk-a-" + k).value); if (v) o[k] = v; });
      V().cfg.areas = o;
      SeMIS.save(); closeModal(); toast("저장했습니다.");
    };
  }

  /* ── 어디서나 끌어다 놓기 — 다른 화면의 첨부 칸은 그대로(그 칸이 먼저 처리). 계정마다 처음 한 번은 보낼지 묻는다 ── */
  const deskOn = () => { const app = document.getElementById("app"); return !!SeMIS.supportOk && SeMIS.supportOk("desk") && !!app && !app.classList.contains("hidden"); };
  const modalOpen = () => { const m = document.getElementById("modal-overlay"); return !!m && !m.classList.contains("hidden"); };
  const hasFiles = (ev) => !!ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf("Files") >= 0;
  let dragT = null;
  const dragOff = () => { clearTimeout(dragT); dragT = null; document.body.classList.remove("desk-drag"); };
  function sendDropped(l) {
    const go = () => {
      tab = "up";
      if (!isOpen()) open("up"); else SemisPanel.setTab(PID, "up");
      intake(l);
    };
    const P = SeMIS.navPrefs ? SeMIS.navPrefs() : {};
    if (P.dropOk || isOpen()) { go(); return; }
    openModal(`<h3>접수 카운터로 보낼까요?</h3>
      <p class="dkc-ask">${l.length === 1 ? "<b>" + esc(l[0].name) + "</b>" : "<b>파일 " + l.length + "개</b>"}를 접수 카운터에 올립니다. ${canW() ? "내용을 읽고 저장할 곳을 제안합니다." : "안전보안파트가 확인한 뒤 알맞은 화면에 정리합니다."}</p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">보내기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => { closeModal(); if (SeMIS.setNavPref) SeMIS.setNavPref({ dropOk: 1 }); go(); };
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("dragover", (ev) => {
      if (ev.defaultPrevented || !hasFiles(ev) || !deskOn() || modalOpen()) return;
      ev.preventDefault();
      try { ev.dataTransfer.dropEffect = "copy"; } catch (e) { /* 읽기 전용 */ }
      document.body.classList.add("desk-drag");
      clearTimeout(dragT); dragT = setTimeout(dragOff, 400);     // 끌기를 취소하면 dragleave 가 오지 않는 브라우저가 있다
    });
    window.addEventListener("dragleave", (ev) => { if (!ev.relatedTarget) dragOff(); });
    window.addEventListener("drop", (ev) => {
      dragOff();
      if (ev.defaultPrevented || !hasFiles(ev) || !deskOn() || modalOpen()) return;
      ev.preventDefault();
      const l = Array.from(ev.dataTransfer.files || []);
      if (!l.length) return;
      sendDropped(l);
    });
    /* 직원 접수 가져오기 — 3분마다(탭이 보일 때) · 다시 보일 때 */
    setInterval(() => { if (typeof document === "undefined" || document.visibilityState !== "hidden") pullInbox(); }, 180000);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullInbox(); });
  }

  SeMIS.registerSupport("desk", { ok: canUse, badge: () => (canW() ? pending().length : minePending()) || "", open: () => open() });
  if (SeMIS.onSupport) SeMIS.onSupport(() => { if (canW()) pullInbox(); });
  SeMIS.registerPanelRoute(MOD, () => open());
  SeMIS.onRerender(() => { if (isOpen()) repaint(); });
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "doc", minRank: 1,
    items: () => (canUse() ? [{ title: TITLE, sub: SUB + (canW() ? " · 확인 대기 " + pending().length : ""), text: [TITLE, "메인 데스크", "문서 올리기", "올린 문서", "접수", "업로드"], route: "", pick: () => open("up") }] : [])
      .concat(canW() ? logs().map(e => ({ title: e.title || e.file.name, sub: [(TYPES[e.type] || [""])[0], dot(String(e.at || "").slice(0, 10)), (ST[e.status] || [""])[0]].filter(Boolean).join(" · "),
        text: [e.title, e.summary, e.file.name], route: "", pick: () => open(e.status === "wait" || e.status === "reading" ? "up" : "log") })) : [])
  });

  window.SemisDesk = { TYPES, KINDS, CATS, AREAS, clean, plan, guessShelf, check, commit, catalog, matchPerson, nextTraining, intake, read, reread, apply, keep, drop, folderFor, pathOf, shelfMods,
    drafts, busy, fixOpen, open, close, isOpen, pending, sayHTML, rowSub, itemHTML, pullInbox, remoteInbox, loadMine, submit, sendDropped, resultText,
    TITLE, SUB, canUse, canW, get mine() { return mine; }, set mine(v) { mine = v; },
    get tab() { return tab; }, setToday(t) { fixedToday = isISO(t) ? t : ""; } };
})();
