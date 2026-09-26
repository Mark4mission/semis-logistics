/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 수검 대응 센터 (v1.17, 라우트 audit)
   외부·사내 점검을 "받는" 쪽의 준비 → 수검 → 지적 조치 → 종결을 한 화면에서 관리한다.

   대상: 국토부 · 지방항공청 / 해외 당국 · 화주(TSA · EU ACC3 · 화주 감사) / 사내 심사(내부심사 · IOSA · 교차심사)

   화면
   - 수검 일정: 요약(다음 수검 D-day · 준비 진행 · 미결 지적 · 기한 경과 · 올해 수검) + 목록(구분 · 진행 필터, 검색)
   - 지적사항: 모든 수검의 지적을 한 표로(미결 · 완료 · 구분 필터, 검색) — 같은 조항이 다른 수검에서도 나오면 '재발'
   - 상세: 기본 정보 · 공문/결과 첨부 · 점검 체크리스트(v1.19) · 지적사항(유형 · 조항 · 조치 · 기한)
     점검 체크리스트: 점검관용 CHK-LIST 원본(auditMaster, hq 열람)에서 영역을 골라 항목을 만들고, 항목마다
     문서 · 시행 점수(0 시정조치 ~ 4 우수) · N/A · 의견 · 증빙(파일 · 연결 화면)을 관리한다.
     준비됨 = 증빙 있음 + 문서 · 시행 모두 3점 이상. 영역별 소계 · 평균 · 준비율, A4 인쇄는 점검관용 양식과 같은 열.
   - 대시보드 띠(mgr): 60일 안의 다음 수검 D-day · 준비율 · 미결 지적 — 해당 없으면 띠를 그리지 않는다

   데이터 DATA.audits = [{ id, body(gov|foreign|internal), org, kind, start, end, place, lead, scope, memo,
       outcome(""|"none" 지적 없음), cancelled, linkCal(일정관리 연동, 기본 true), noCalMain(수검 일정만 연동 해제),
       files[{name,size,url}], checklist[{id,mid(원본 번호),sec,text,ref,owner,note,docScore,impScore(0~4|null),na,files[],links[]?}],
       chkSecs[{no,title}], chkSrc{title,asOf,ssi},
       findings[{id,type(car|rec|onsite|obs),ref,text,action,owner,due,status(open|doing|done),doneDate,noCal,files[]}],
       createdAt, createdBy, updatedAt, updatedBy }]
   진행 단계는 저장하지 않고 날짜·지적으로 계산한다: 준비 → 수검 중 → (결과 대기) → 조치 중 → 종결 / 취소
   일정관리 연동: 수검 기간 "aud_<id>", 지적 기한 "audf_<id>"(src "aud:<id>"). 일정관리에서 옮기거나 완료하면
   calendar.js 가 syncFromSchedule 로 되반영한다. 첨부는 비공개 버킷 audits/ 폴더(열람 mgr · 올리기 hq).
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "audit";
  const KEY = "audits";
  const TITLE = "수검 대응 센터";
  const FOLDER = "audits";
  const FILE_MAX = 50 * 1024 * 1024;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "";                                  // 테스트용 오늘
  const todayISO = () => fixedToday || toISO(new Date());
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const md = (s) => String(s || "").slice(5).replace("-", ".");
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const me = () => (SeMIS.user && SeMIS.user.name) || "";
  const localDay = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso || "").slice(0, 10) : toISO(d); };
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  /* ─────── 구분 · 유형 ─────── */
  const BODIES = {
    gov: { label: "국토부 · 지방항공청", short: "국토부", tone: "blue",
      kinds: ["정기점검", "불시점검", "항공보안 감독", "특별점검"], orgs: ["국토교통부", "서울지방항공청", "부산지방항공청", "제주지방항공청"] },
    foreign: { label: "해외 당국 · 화주", short: "해외 · 화주", tone: "amber",
      kinds: ["TSA 점검", "EU ACC3 검증", "해외 당국 점검", "화주 · 포워더 감사"], orgs: ["미국 교통보안청(TSA)", "EU ACC3 검증기관"] },
    internal: { label: "사내 심사", short: "사내", tone: "gray",
      kinds: ["안전보안 내부심사", "IOSA", "교차심사", "본사 점검"], orgs: ["안전보안실", "안전심사팀"] }
  };
  const BODY_KEYS = ["gov", "foreign", "internal"];
  const bodyOf = (a) => BODIES[a && a.body] || BODIES.gov;

  /* ─────── 점검 체크리스트 원본 (v1.19) ───────
     원본(점검관용 CHK-LIST — 영역 · 항목 · 관련근거 · 근거 본문 요지)은 민감보안정보라 코드에 두지 않는다.
     공용 DB 행 auditMaster(권한표 읽기 3 · 쓰기 9 — 등록은 SQL로만)를 hq 이상만 필요할 때 받아 메모리에만 둔다.
     { title, source, asOf, ssi, scoreScale[5], sections[{ no, title, items[{ no, text, ref, basis }] }] }
     불러온 항목은 text · ref 만 수검(audits)으로 복사한다 — 근거 요지는 원본에서만 본다(hq). */
  const MASTER_KEY = "auditMaster";
  const SCORES = ["시정조치", "개선권고", "현장시정-보완", "적합", "우수"];   // 0 ~ 4 (점검관용 평가점수)
  const SCORE_TONE = ["red", "amber", "amber", "green", "blue"];
  const READY_MIN = 3;                                                     // 적합 이상
  /* 구분별 기본 영역 — 국토부 1~8 · 해외 당국(TSA) 6 · 7 · 9 · 사내 전체 */
  const PRESET = { gov: ["1", "2", "3", "4", "5", "6", "7", "8"], foreign: ["6", "7", "9"], internal: null };
  let master = null, masterWait = null, masterErr = "";
  const canMaster = () => !!(SeMIS.roleRank && SeMIS.roleRank() >= 3);
  const validMaster = (m) => !!(m && typeof m === "object" && Array.isArray(m.sections) && m.sections.length);
  function loadMaster(force) {
    if (!canMaster()) return Promise.resolve(null);
    if (master && !force) return Promise.resolve(master);
    if (masterWait) return masterWait;
    if (!window.SemisSync || !SemisSync.fetchKV) return Promise.resolve(null);
    masterErr = "";
    masterWait = SemisSync.fetchKV(MASTER_KEY).then(v => {
      master = validMaster(v) ? v : null;
      if (!master) masterErr = "empty";
      return master;
    }).catch(() => { masterErr = "fail"; return null; }).then(v => { masterWait = null; return v; });
    return masterWait;
  }
  const midParts = (s) => String(s || "").split(".").map(x => parseInt(x, 10) || 0);
  function cmpMid(a, b) {
    const x = midParts(a), y = midParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }
  const secOfMid = (mid) => String(mid || "").split(".")[0];
  function masterItem(mid) {
    if (!master) return null;
    for (const s of master.sections) for (const it of (s.items || [])) if (it && it.no === mid) return { sec: s, item: it };
    return null;
  }
  /* 근거 요지 — 비어 있으면 같은 영역의 "[a~b 공통]" 요지를 쓴다(2.10 · 2.10.1 → 2.10.2) */
  function basisOf(mid) {
    const hit = masterItem(mid);
    if (!hit) return "";
    if (hit.item.basis) return hit.item.basis;
    for (const it of (hit.sec.items || [])) {
      const m = /^\[([\d.]+)\s*~\s*([\d.]+)\s*공통\]/.exec(it.basis || "");
      if (m && cmpMid(mid, m[1]) >= 0 && cmpMid(mid, m[2]) <= 0) return it.basis;
    }
    return "";
  }

  /* ─────── 증빙 화면 연결 (evidence map) ───────
     항목 번호 → 그 항목을 증명하는 Logistics 화면. 메뉴가 새로 열리면(registerModule) 자동으로 '증빙 있음'이 된다.
     항목별로 바꾸면 그 항목의 links[] 가 우선(수검마다 따로). 번호와 화면 이름만 있어 민감정보가 아니다. */
  const EVIDENCE = {
    training: ["1.1", "1.2", "1.3", "1.4", "2.10", "2.10.1", "3.4", "8.2", "9.2", "9.2.1"],
    dashboard: ["2.1", "2.2", "2.2.1"],
    "reg-sec": ["2.3", "2.4", "2.4.1", "2.5", "2.10.2"],
    contacts: ["2.6", "2.9"],
    crisis: ["2.9"],
    audit: ["2.8"],
    inspection: ["2.7", "4.1", "4.2", "4.3", "5.3", "5.4", "7.2", "7.6", "9.1.2", "9.4", "9.6"],
    partners: ["3.1", "3.2", "3.3", "3.5"],
    "sec-cases": ["6.3.1", "6.4", "6.6", "6.10", "9.3", "9.8", "9.12", "9.13"],
    "kc-ra": ["6.5", "6.5.1", "9.9"],
    "scr-equip": ["8.1"],
    "scr-status": ["8.1", "8.3"]
  };
  const DEF_LINKS = (() => {
    const out = {};
    Object.keys(EVIDENCE).forEach(r => EVIDENCE[r].forEach(mid => { (out[mid] = out[mid] || []).push(r); }));
    return out;
  })();
  /* 연결 화면 이름 — 준비 중인 메뉴는 앞으로 열릴 이름으로 */
  const ROUTE_NAME = {
    dashboard: "보안등급 이력", audit: "수검 지적 관리", training: "보안교육 · 자격 관리", inspection: "보안 기록부",
    partners: "협력사 · 보안용역 관리", "sec-cases": "보안 처리 대장", "kc-ra": "상용화주 · RA 관리"
  };
  const routeLive = (r) => !!(SeMIS.hasModule && SeMIS.hasModule(r));
  function routeLabel(r) {
    if (ROUTE_NAME[r]) return ROUTE_NAME[r];
    const mn = (D().menus || []).find(m => m && m.type === "module" && m.module === r);
    return (mn && mn.label) || r;
  }
  /* 연결 후보 — 메뉴의 업무 화면(링크 · 설정 · 암호 관리 제외) + 앞으로 열릴 화면 */
  function routeChoices() {
    const seen = {}, out = [];
    const add = (r) => { if (r && !seen[r]) { seen[r] = true; out.push(r); } };
    Object.keys(EVIDENCE).forEach(add);
    (D().menus || []).forEach(m => { if (m && m.type === "module" && routeLive(m.module) && ["settings", "vault"].indexOf(m.module) < 0) add(m.module); });
    return out;
  }
  const sc = (v) => (Number.isInteger(v) && v >= 0 && v <= 4 ? v : null);
  const linksOf = (c) => (c && Array.isArray(c.links) ? c.links : (c && c.mid && DEF_LINKS[c.mid]) || []).filter(r => typeof r === "string" && r);
  const hasEvidence = (c) => filesOf(c).length > 0 || linksOf(c).some(routeLive);
  /* 항목 상태 — N/A · 미평가(문서·시행 중 하나라도 비었음) · 보완 필요(3점 미만) · 증빙 없음 · 준비됨 */
  function itemState(c) {
    if (!c) return "todo";
    if (c.na) return "na";
    const d = sc(c.docScore), i = sc(c.impScore);
    if (d == null || i == null) return "todo";
    if (Math.min(d, i) < READY_MIN) return "low";
    return hasEvidence(c) ? "ready" : "noev";
  }
  const CST = {
    ready: { label: "준비됨", tone: "green" }, noev: { label: "증빙 없음", tone: "amber" }, low: { label: "보완 필요", tone: "red" },
    todo: { label: "미평가", tone: "gray" }, na: { label: "N/A", tone: "gray" }
  };
  /* 사용 흔적이 없는 항목(v1.17 기본 문구 등) — 체크리스트를 불러올 때 빼도 잃을 것이 없다 */
  const unusedItem = (c) => !!c && !c.mid && !c.done && !filesOf(c).length && !norm(c.ref) && !norm(c.note) && !norm(c.owner)
    && sc(c.docScore) == null && sc(c.impScore) == null && !c.na;

  const FTYPES = {
    car: { label: "시정조치", tone: "red" }, rec: { label: "개선권고", tone: "amber" },
    onsite: { label: "현장시정", tone: "green" }, obs: { label: "관찰사항", tone: "blue" }
  };
  const FT_KEYS = ["car", "rec", "onsite", "obs"];
  const FSTAT = { open: { label: "접수", tone: "gray" }, doing: { label: "조치 중", tone: "amber" }, done: { label: "완료", tone: "green" } };
  const PH = {
    plan: { label: "준비", tone: "blue" }, live: { label: "수검 중", tone: "amber" }, wait: { label: "결과 대기", tone: "gray" },
    action: { label: "조치 중", tone: "red" }, closed: { label: "종결", tone: "green" }, cancel: { label: "취소", tone: "gray" }
  };

  /* ─────── 데이터 계산 ─────── */
  const list = () => (Array.isArray(D()[KEY]) ? D()[KEY] : []);
  const store = () => { if (!Array.isArray(D()[KEY])) D()[KEY] = []; return D()[KEY]; };
  const findingsOf = (a) => (a && Array.isArray(a.findings) ? a.findings : []);
  const checksOf = (a) => (a && Array.isArray(a.checklist) ? a.checklist : []);
  const filesOf = (x) => (x && Array.isArray(x.files) ? x.files : []);
  const isOpenF = (f) => !!f && f.status !== "done";
  const endOf = (a) => (isISO(a.end) && a.end >= a.start ? a.end : a.start);
  const byId = (id) => list().find(a => a && a.id === id) || null;
  const auditTitle = (a) => norm([a && a.org, a && a.kind].filter(Boolean).join(" ")) || "수검";

  function phase(a, t) {
    t = t || todayISO();
    if (!a) return "plan";
    if (a.cancelled) return "cancel";
    if (!isISO(a.start) || t < a.start) return "plan";
    if (t <= endOf(a)) return "live";
    const fs = findingsOf(a);
    if (fs.some(isOpenF)) return "action";
    if (fs.length || a.outcome === "none") return "closed";
    return "wait";
  }
  const isActive = (a) => { const p = phase(a); return p !== "closed" && p !== "cancel"; };
  function dday(a, t) { return a && isISO(a.start) ? dayDiff(t || todayISO(), a.start) : null; }
  function ddayText(a) {
    const p = phase(a);
    if (p === "live") return "수검 중";
    const d = dday(a);
    if (d == null) return "일정 미정";
    if (d > 0) return "D-" + d;
    if (d === 0) return "D-Day";
    return "";
  }
  /* 준비율 = 준비됨(증빙 있음 · 문서 · 시행 3점 이상) ÷ 해당 항목(N/A 제외) */
  function prep(a) {
    const c = checksOf(a).filter(x => x && !x.na);
    const done = c.filter(x => itemState(x) === "ready").length;
    return { done, total: c.length, pct: c.length ? Math.round(done / c.length * 100) : 0 };
  }
  /* 영역별(또는 전체) 소계 — 평균은 매긴 항목만으로 */
  function tally(items) {
    const ap = items.filter(x => x && !x.na);
    const ds = ap.map(x => sc(x.docScore)).filter(v => v != null), is = ap.map(x => sc(x.impScore)).filter(v => v != null);
    const sum = (arr) => arr.reduce((s, v) => s + v, 0);
    const cnt = (st) => ap.filter(x => itemState(x) === st).length;
    return {
      n: items.length, ap: ap.length, na: items.length - ap.length, ready: cnt("ready"), low: cnt("low"), noev: cnt("noev"), todo: cnt("todo"),
      dSum: sum(ds), dN: ds.length, iSum: sum(is), iN: is.length,
      dAvg: ds.length ? sum(ds) / ds.length : null, iAvg: is.length ? sum(is) / is.length : null
    };
  }
  const avgTxt = (v) => (v == null ? "-" : v.toFixed(1));
  /* 체크리스트를 영역별로 — 원본 항목은 번호 순, 직접 추가한 항목은 마지막 '추가 항목' */
  function groupsOf(a) {
    const secs = Array.isArray(a.chkSecs) ? a.chkSecs : [];
    const byNo = {}, order = [], extra = [];
    checksOf(a).forEach(c => {
      if (!c) return;
      if (!c.mid) { extra.push(c); return; }
      const k = String(c.sec || secOfMid(c.mid));
      if (!byNo[k]) { byNo[k] = []; order.push(k); }
      byNo[k].push(c);
    });
    order.sort(cmpMid);
    const out = order.map(k => ({ no: k, title: (secs.find(s => s && s.no === k) || {}).title || "", items: byNo[k].slice().sort((x, y) => cmpMid(x.mid, y.mid)) }));
    if (extra.length) out.push({ no: "", title: "추가 항목", items: extra });
    return out;
  }
  const refKey = (r) => String(r || "").replace(/\s+/g, "").toLowerCase();
  function allFindings() {
    const out = [];
    list().forEach(a => findingsOf(a).forEach(f => { if (f) out.push({ a, f }); }));
    return out;
  }
  /* 같은 조항(공백·대소문자 무시)이 지적된 수검 수 — 2 이상이면 재발 */
  function repeatCount(f) {
    const k = refKey(f && f.ref);
    if (!k) return 0;
    const seen = {};
    allFindings().forEach(x => { if (!x.a.cancelled && refKey(x.f.ref) === k) seen[x.a.id] = true; });
    return Object.keys(seen).length;
  }
  const overdueF = (f, t) => isOpenF(f) && isISO(f.due) && f.due < (t || todayISO());
  function nextAudit(t) {
    t = t || todayISO();
    return list().filter(a => a && !a.cancelled && isISO(a.start) && endOf(a) >= t)
      .sort((x, y) => String(x.start).localeCompare(String(y.start)))[0] || null;
  }
  function stamp(a) { a.updatedAt = new Date().toISOString(); a.updatedBy = me(); }

  /* ─────── 일정관리 연동 ─────── */
  const SID = (id) => "aud_" + id;
  const FID = (id) => "audf_" + id;
  const SRC = (id) => "aud:" + id;
  const CAL_AUDIT = "purple", CAL_FIX = "orange";
  function schedules() { if (!Array.isArray(D().schedules)) D().schedules = []; return D().schedules; }
  function put(rec, onCreate) {
    const s = schedules();
    const cur = s.find(x => x && x.id === rec.id);
    if (cur) Object.assign(cur, rec);
    else s.push(Object.assign({ done: false, vehicle: false, room: false, reminders: [], assignee: "",
      repeat: { freq: "none", until: "" }, doneFrom: "", doneDates: [], undoneDates: [] }, onCreate || {}, rec));
  }
  function syncCalendar(a) {
    if (!a || !a.id) return;
    const src = SRC(a.id);
    const keep = {};
    const on = a.linkCal !== false && !a.cancelled;
    if (on && !a.noCalMain && isISO(a.start)) {
      keep[SID(a.id)] = true;
      put({ id: SID(a.id), src, title: "[수검] " + auditTitle(a),
        memo: ["수검 대응 센터에서 관리되는 일정입니다.", a.place ? "장소: " + a.place : "", a.scope ? "범위: " + a.scope : ""].filter(Boolean).join("\n"),
        start: a.start, end: endOf(a), allDay: true, time: "", timeEnd: "", color: CAL_AUDIT },
      { reminders: ["1w", "1d"], assignee: a.lead || "" });
    }
    if (on) findingsOf(a).forEach(f => {
      if (!f || !f.id || f.noCal || !isISO(f.due)) return;
      keep[FID(f.id)] = true;
      put({ id: FID(f.id), src, title: "[지적 조치] " + norm(f.text).slice(0, 60),
        memo: "수검 대응 센터에서 관리되는 일정입니다 — " + auditTitle(a) + (a.start ? " (" + a.start + ")" : "") + (f.owner ? " · 담당 " + f.owner : ""),
        start: f.due, end: f.due, allDay: true, time: "", timeEnd: "", color: CAL_FIX, done: f.status === "done" },
      { reminders: ["1d"], assignee: f.owner || "" });
    });
    D().schedules = schedules().filter(x => !x || x.src !== src || keep[x.id]);
  }
  function dropCalendar(id) {
    const src = SRC(id);
    D().schedules = schedules().filter(x => !x || x.src !== src);
  }
  /* 일정관리에서 옮김 · 기간 조정 · 완료 → 원본 되반영 (calendar.js backSyncInsp) */
  function syncFromSchedule(sid, v) {
    sid = String(sid || ""); v = v || {};
    if (sid.indexOf("audf_") === 0) {
      const hit = allFindings().find(x => FID(x.f.id) === sid);
      if (!hit) return false;
      const due = isISO(v.end) ? v.end : v.start;
      if (isISO(due)) hit.f.due = due;
      if (v.done === true && hit.f.status !== "done") { hit.f.status = "done"; hit.f.doneDate = todayISO(); }
      else if (v.done === false && hit.f.status === "done") { hit.f.status = "doing"; hit.f.doneDate = ""; }
      stamp(hit.a);
      return true;
    }
    if (sid.indexOf("aud_") === 0) {
      const a = list().find(x => x && SID(x.id) === sid);
      if (!a || !isISO(v.start)) return false;
      a.start = v.start;
      a.end = isISO(v.end) && v.end >= v.start ? v.end : v.start;
      stamp(a);
      return true;
    }
    return false;
  }
  /* 일정관리에서 연동 일정을 지우면 — 그 일정만 연동 해제(수검 기록은 그대로) */
  function unlinkBySchedule(sid) {
    sid = String(sid || "");
    if (sid.indexOf("audf_") === 0) {
      const hit = allFindings().find(x => FID(x.f.id) === sid);
      if (hit) { hit.f.noCal = true; stamp(hit.a); return true; }
    } else if (sid.indexOf("aud_") === 0) {
      const a = list().find(x => x && SID(x.id) === sid);
      if (a) { a.noCalMain = true; stamp(a); return true; }
    }
    return false;
  }

  /* ─────── 화면 상태 ─────── */
  let tab = "list", sel = "", query = "", bodyF = "all", stF = "active";
  let fq = "", fStF = "open", fBodyF = "all";
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "") || "dashboard";
  if (typeof window !== "undefined") window.addEventListener("hashchange", () => { if (routeNow() !== MOD) sel = ""; });

  const segHTML = (name, items, cur) => `<div class="seg" role="group" aria-label="${esc(name)}">${items.map(([v, lb]) =>
    `<button type="button" class="seg-btn" data-aseg="${esc(name)}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(lb)}</button>`).join("")}</div>`;
  const BODY_FILTERS = [["all", "전체"]].concat(BODY_KEYS.map(k => [k, BODIES[k].short]));
  const ST_FILTERS = [["active", "진행"], ["closed", "종결 · 취소"], ["all", "전체"]];
  const FST_FILTERS = [["open", "미결"], ["late", "기한 경과"], ["done", "완료"], ["all", "전체"]];
  const hay = (arr) => arr.map(v => String(v || "")).join(" ").toLowerCase();
  const matchAudit = (a, q) => !q || hay([a.org, a.kind, a.scope, a.place, a.lead, a.memo, bodyOf(a).label]
    .concat(findingsOf(a).map(f => [f.text, f.ref, f.action, f.owner].join(" ")))).indexOf(q.toLowerCase()) >= 0;

  function filteredAudits() {
    return list().filter(a => {
      if (!a) return false;
      if (bodyF !== "all" && a.body !== bodyF) return false;
      const p = phase(a);
      if (stF === "active" && (p === "closed" || p === "cancel")) return false;
      if (stF === "closed" && p !== "closed" && p !== "cancel") return false;
      return matchAudit(a, query);
    }).sort((x, y) => {
      const ax = isActive(x) ? 0 : 1, ay = isActive(y) ? 0 : 1;
      if (ax !== ay) return ax - ay;
      const sx = String(x.start || "9999"), sy = String(y.start || "9999");
      return ax === 0 ? sx.localeCompare(sy) : sy.localeCompare(sx);
    });
  }
  function filteredFindings() {
    const q = fq.toLowerCase(), t = todayISO();
    return allFindings().filter(({ a, f }) => {
      if (a.cancelled) return false;
      if (fBodyF !== "all" && a.body !== fBodyF) return false;
      if (fStF === "open" && !isOpenF(f)) return false;
      if (fStF === "late" && !overdueF(f, t)) return false;
      if (fStF === "done" && isOpenF(f)) return false;
      return !q || hay([f.text, f.ref, f.action, f.owner, a.org, a.kind]).indexOf(q) >= 0;
    }).sort((x, y) => {
      const ox = isOpenF(x.f) ? 0 : 1, oy = isOpenF(y.f) ? 0 : 1;
      if (ox !== oy) return ox - oy;
      return String(x.f.due || "9999").localeCompare(String(y.f.due || "9999"))
        || String(y.a.start || "").localeCompare(String(x.a.start || ""));
    });
  }

  /* ─────── 조각 ─────── */
  const phaseChip = (a) => { const p = PH[phase(a)]; return ui.chip(p.label, p.tone); };
  const bodyChip = (a) => ui.chip(bodyOf(a).short, bodyOf(a).tone);
  const range = (a) => !isISO(a.start) ? "일정 미정" : endOf(a) !== a.start ? dot(a.start) + " – " + md(endOf(a)) : dot(a.start);
  const bar = (pct) => `<span class="au-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`;
  function fileChips(files, delAttr) {
    return (files || []).map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>${
      delAttr ? `<button type="button" class="mt-btn danger" data-${delAttr}="${i}" aria-label="첨부 빼기">${icon("x", 14)}</button>` : ""}</span>`).join("");
  }
  function dueChip(f) {
    if (!isISO(f.due)) return '<span class="cell-sub">기한 없음</span>';
    if (!isOpenF(f)) return `<span class="mono">${esc(md(f.due))}</span>`;
    const d = dayDiff(todayISO(), f.due);
    return `<span class="mono">${esc(md(f.due))}</span> ${d < 0 ? ui.chip("D+" + (-d), "red") : d <= 7 ? ui.chip(d ? "D-" + d : "D-Day", "amber") : ""}`;
  }

  /* ═════════ 수검 일정 (목록) ═════════ */
  function listHTML() {
    const t = todayISO();
    const nx = nextAudit(t);
    const pr = nx ? prep(nx) : null;
    const openF = allFindings().filter(x => !x.a.cancelled && isOpenF(x.f));
    const late = openF.filter(x => overdueF(x.f, t)).length;
    const yr = t.slice(0, 4);
    const thisYear = list().filter(a => a && !a.cancelled && String(a.start || "").slice(0, 4) === yr);
    const rows = filteredAudits();
    return ui.stats([
      { label: "다음 수검", value: nx ? ddayText(nx) : "-", sub: nx ? md(nx.start) + " " + auditTitle(nx) : "예정 없음", tone: nx ? "warn" : "muted" },
      { label: "준비 진행", value: pr ? pr.pct + "%" : "-", sub: pr ? "준비 항목 " + pr.done + "/" + pr.total : "", tone: pr && pr.total && pr.pct < 100 ? "warn" : pr ? "ok" : "muted" },
      { label: "미결 지적", value: openF.length, tone: openF.length ? "bad" : "ok" },
      { label: "기한 경과", value: late, tone: late ? "bad" : "ok" },
      { label: yr + "년 수검", value: thisYear.length, sub: "종결 " + thisYear.filter(a => phase(a) === "closed").length }
    ]) + `<section class="card" id="au-list">
      <div class="toolbar">
        ${ui.search("au-q", "기관 · 유형 · 지적 내용 검색", query)}
        ${segHTML("body", BODY_FILTERS, bodyF)}
        ${segHTML("st", ST_FILTERS, stF)}
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap au-tbl" style="--cap:1320px">
        <thead><tr><th>일정</th><th>수검</th><th>구분</th><th>준비</th><th>지적</th><th>상태</th></tr></thead>
        <tbody>${rows.map(a => {
          const pr2 = prep(a), fs = findingsOf(a), op = fs.filter(isOpenF).length;
          const dd = isActive(a) ? ddayText(a) : "";
          return `<tr data-aud="${esc(a.id)}" tabindex="0" class="${a.cancelled ? "is-cancel" : ""}">
            <td class="c-date"><span class="mono">${esc(range(a))}</span>${dd ? `<div class="cell-sub au-dd">${esc(dd)}</div>` : ""}</td>
            <td class="c-name"><button type="button" class="tbl-open" data-aud-open="${esc(a.id)}">${esc(auditTitle(a))}</button>
              ${a.scope || a.place ? `<div class="cell-sub">${esc([a.place, a.scope].filter(Boolean).join(" · "))}</div>` : ""}</td>
            <td class="c-body">${bodyChip(a)}</td>
            <td class="c-prep">${pr2.total ? `${bar(pr2.pct)}<span class="cell-sub mono">${pr2.done}/${pr2.total}</span>` : '<span class="cell-sub">-</span>'}</td>
            <td class="c-f">${fs.length ? `<span class="mono">${op ? `<b class="au-open">${op}</b> / ` : ""}${fs.length}</span><span class="m-only cell-sub"> 지적</span>` : '<span class="cell-sub">-</span>'}</td>
            <td class="c-st">${phaseChip(a)}</td>
          </tr>`;
        }).join("")}</tbody></table></div>`
      : ui.empty(list().length ? "조건에 맞는 수검이 없습니다." : "등록된 수검이 없습니다.")}
    </section>`;
  }

  /* ═════════ 지적사항 (전체) ═════════ */
  function findingsHTML() {
    const t = todayISO();
    const all = allFindings().filter(x => !x.a.cancelled);
    const open = all.filter(x => isOpenF(x.f));
    const repeated = {};
    all.forEach(x => { if (repeatCount(x.f) >= 2) repeated[refKey(x.f.ref)] = true; });
    const rows = filteredFindings();
    return ui.stats([
      { label: "전체 지적", value: all.length },
      { label: "미결", value: open.length, tone: open.length ? "bad" : "ok" },
      { label: "기한 경과", value: open.filter(x => overdueF(x.f, t)).length, tone: open.some(x => overdueF(x.f, t)) ? "bad" : "ok" },
      { label: "시정조치", value: all.filter(x => x.f.type === "car").length, sub: "개선권고 " + all.filter(x => x.f.type === "rec").length },
      { label: "재발 조항", value: Object.keys(repeated).length, sub: "2개 이상 수검에서 지적", tone: Object.keys(repeated).length ? "warn" : "muted" }
    ]) + `<section class="card" id="au-flist">
      <div class="toolbar">
        ${ui.search("au-fq", "지적 내용 · 조항 · 담당 검색", fq)}
        ${segHTML("fbody", BODY_FILTERS, fBodyF)}
        ${segHTML("fst", FST_FILTERS, fStF)}
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap au-ftbl" style="--cap:1320px">
        <thead><tr><th>기한</th><th>유형</th><th>지적 내용</th><th>수검</th><th>담당</th><th>상태</th></tr></thead>
        <tbody>${rows.map(({ a, f }) => findingRow(a, f, true)).join("")}</tbody></table></div>`
      : ui.empty(!all.length ? "등록된 지적사항이 없습니다." : fStF === "open" && !fq && fBodyF === "all" ? "미결 지적이 없습니다." : "조건에 맞는 지적이 없습니다.")}
    </section>`;
  }
  function findingRow(a, f, withAudit) {
    const ft = FTYPES[f.type] || FTYPES.obs, st = FSTAT[f.status] || FSTAT.open;
    const rep = repeatCount(f);
    const canW = SeMIS.canEdit();
    return `<tr data-fnd="${esc(f.id)}" data-fa="${esc(a.id)}" ${canW ? 'tabindex="0" class="is-click"' : ""}>
      <td class="c-due">${dueChip(f)}</td>
      <td class="c-ft">${ui.chip(ft.label, ft.tone)}</td>
      <td class="c-txt"><div class="au-ftxt">${esc(f.text || "")}</div>
        <div class="cell-sub">${f.ref ? `<span class="au-ref">${esc(f.ref)}</span>` : ""}${rep >= 2 ? ` ${ui.chip("재발 " + rep + "회", "red")}` : ""}${f.action ? `<span class="au-act">조치: ${esc(f.action)}</span>` : ""}</div>
        ${filesOf(f).length ? `<div class="au-files">${fileChips(filesOf(f))}</div>` : ""}</td>
      ${withAudit ? `<td class="c-aud"><button type="button" class="tbl-open" data-aud-open="${esc(a.id)}">${esc(auditTitle(a))}</button><div class="cell-sub mono">${esc(dot(a.start || ""))}</div></td>` : ""}
      <td class="c-own">${esc(f.owner || "-")}</td>
      <td class="c-st">${ui.chip(st.label, st.tone)}${f.status === "done" && f.doneDate ? `<div class="cell-sub mono">${esc(md(f.doneDate))}</div>` : ""}</td>
    </tr>`;
  }

  /* ═════════ 상세 ═════════ */
  function detailHTML(a) {
    const canW = SeMIS.canEdit();
    const b = bodyOf(a), fs = findingsOf(a);
    const op = fs.filter(isOpenF).length;
    const dd = isActive(a) ? ddayText(a) : "";
    const row = (k, v) => v ? `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>` : "";
    const ph = phase(a);
    const outcome = fs.length ? "지적 " + fs.length + "건" + (op ? " · 미결 " + op : "") : a.outcome === "none" ? "지적 없음" : ph === "plan" || ph === "live" ? "" : "미등록";
    return `<section class="card au-detail">
        <div class="au-dh">
          <button type="button" class="btn btn-ghost btn-sm" id="au-back">${icon("chevron", 16)}<span>목록</span></button>
          <h2 class="au-title">${esc(auditTitle(a))}</h2>
          <span class="au-chips">${bodyChip(a)}${phaseChip(a)}${dd ? `<span class="au-ddchip mono">${esc(dd)}</span>` : ""}</span>
          <span class="spacer"></span>
          ${canW ? `<button type="button" class="btn btn-ghost btn-sm" id="au-edit">${icon("notes", 16)}<span>수정</span></button>` : ""}
        </div>
        <dl class="eqd-grid au-info">
          ${row("수검 기간", `<span class="mono">${esc(range(a))}</span>`)}
          ${row("구분 · 유형", esc(b.label + (a.kind ? " · " + a.kind : "")))}
          ${row("점검 기관", esc(a.org || ""))}
          ${row("장소", esc(a.place || ""))}
          ${row("수검 책임", esc(a.lead || ""))}
          ${row("결과", esc(outcome))}
          ${row("범위 · 대상", esc(a.scope || ""))}
          ${row("메모", a.memo ? `<span class="au-pre">${esc(a.memo)}</span>` : "")}
        </dl>
        ${filesOf(a).length ? `<div class="au-sub"><h4>공문 · 결과 통보</h4><div class="au-files">${fileChips(filesOf(a))}</div></div>` : ""}
      </section>
      ${checklistHTML(a, canW)}
      <section class="card au-sec" id="au-finds">
        <div class="au-sh"><h3>지적사항</h3><span class="au-cnt mono">${fs.length}</span>${op ? ui.chip("미결 " + op, "red") : ""}
          <span class="spacer"></span>
          ${canW && !fs.length && ph !== "plan" && a.outcome !== "none" ? `<button type="button" class="btn btn-ghost btn-sm" id="au-none">${icon("check", 15)}<span>지적 없음</span></button>` : ""}
          ${canW ? `<button type="button" class="btn btn-ghost btn-sm" id="au-f-add">${icon("plus", 15)}<span>지적 추가</span></button>` : ""}
        </div>
        ${fs.length ? `<div class="table-wrap"><table class="tbl au-ftbl au-ftbl-in">
          <thead><tr><th>기한</th><th>유형</th><th>지적 내용</th><th>담당</th><th>상태</th></tr></thead>
          <tbody>${fs.map(f => findingRow(a, f, false)).join("")}</tbody></table></div>`
        : `<p class="au-none">${a.outcome === "none" ? "지적 없이 종결되었습니다." : "등록된 지적사항이 없습니다."}</p>`}
      </section>`;
  }

  /* ═════════ 점검 체크리스트 (v1.19 — 점검관용 양식: 문서 · 시행 0~4점 · N/A · 비고) ═════════ */
  let ckSec = "all", ckSt = "all";
  const CK_ST = [["all", "전체"], ["open", "미준비"], ["low", "보완 필요"], ["noev", "증빙 없음"], ["todo", "미평가"], ["ready", "준비됨"], ["na", "N/A"]];
  function ckMatch(c) {
    const st = itemState(c);
    if (ckSt === "all") return true;
    if (ckSt === "open") return st !== "ready" && st !== "na";
    return st === ckSt;
  }
  const refLines = (r) => String(r || "").split("\n").map(norm).filter(Boolean);
  const refChips = (r) => refLines(r).map(x => `<span class="au-ref">${esc(x)}</span>`).join("");
  const secKey = (g) => g.no || "etc";
  const secName = (g) => (g.no ? g.no + ". " : "") + (g.title || (g.no ? "영역 " + g.no : "추가 항목"));
  function scoreHTML(c, kind, canW) {
    const key = kind === "doc" ? "docScore" : "impScore", lb = kind === "doc" ? "문서" : "시행";
    const v = sc(c[key]);
    if (c.na) return `<span class="ck-sc is-na"><span class="ck-sc-k">${lb}</span><b>-</b></span>`;
    if (!canW) return `<span class="ck-sc" data-v="${v == null ? "" : v}"><span class="ck-sc-k">${lb}</span><b class="mono">${v == null ? "-" : v}</b>${v == null ? "" : `<small>${esc(SCORES[v])}</small>`}</span>`;
    return `<label class="ck-sc" data-v="${v == null ? "" : v}"><span class="ck-sc-k">${lb}</span><select data-sc="${kind}" data-cid="${esc(c.id)}" aria-label="${esc(lb + " 점수 " + (c.mid || ""))}">
      <option value="">-</option>${SCORES.map((s, i) => `<option value="${i}" ${v === i ? "selected" : ""}>${i} ${esc(s)}</option>`).join("")}</select></label>`;
  }
  function linkChips(c) {
    return linksOf(c).map(r => routeLive(r)
      ? `<button type="button" class="ck-link" data-ck-go="${esc(r)}">${icon("forward", 13)}<span>${esc(routeLabel(r))}</span></button>`
      : `<span class="ck-link is-plan"><span>${esc(routeLabel(r))}</span><small>준비 중</small></span>`).join("");
  }
  function ckRow(c, canW, canB) {
    const st = CST[itemState(c)];
    const ev = filesOf(c).length || linksOf(c).length;
    return `<li class="ck-row" data-st="${itemState(c)}" data-cid="${esc(c.id)}">
      <div class="ck-no mono">${esc(c.mid || "·")}</div>
      <div class="ck-main">
        <div class="ck-head"><div class="ck-t">${c.mid ? `<span class="ck-no-m mono">${esc(c.mid)}</span>` : ""}${esc(c.text || "")}</div><span class="ck-state">${ui.chip(st.label, st.tone)}</span></div>
        ${c.ref ? `<div class="ck-refs">${refChips(c.ref)}</div>` : ""}
        <div class="ck-ctl">
          ${scoreHTML(c, "doc", canW)}${scoreHTML(c, "imp", canW)}
          ${canW ? `<button type="button" class="ck-na" data-na="${esc(c.id)}" aria-pressed="${!!c.na}">N/A</button>` : ""}
          <span class="spacer"></span>
          ${canB && c.mid ? `<button type="button" class="btn btn-ghost btn-sm ck-basis" data-basis="${esc(c.mid)}">${icon("book", 15)}<span>근거 요지</span></button>` : ""}
          ${canW ? `<button type="button" class="mt-btn" data-ck-edit="${esc(c.id)}" aria-label="항목 수정">${icon("notes", 15)}</button>` : ""}
        </div>
        ${c.owner || c.note ? `<div class="ck-meta">${[c.owner ? "담당 " + esc(c.owner) : "", c.note ? `<span class="ck-note">${esc(c.note)}</span>` : ""].filter(Boolean).join('<span class="au-sep">·</span>')}</div>` : ""}
        ${ev ? `<div class="ck-ev">${fileChips(filesOf(c))}${linkChips(c)}</div>` : ""}
      </div>
    </li>`;
  }
  function groupHTML(g, items, canW, canB) {
    const t = tally(g.items);
    return `<div class="ck-grp" data-sec="${esc(secKey(g))}">
      <div class="ck-gh"><h4>${esc(secName(g))}</h4>
        <span class="ck-gsum">준비 <b class="mono">${t.ready}/${t.ap}</b><span class="au-sep">·</span>문서 <b class="mono">${avgTxt(t.dAvg)}</b><span class="au-sep">·</span>시행 <b class="mono">${avgTxt(t.iAvg)}</b></span>
        ${bar(t.ap ? Math.round(t.ready / t.ap * 100) : 0)}</div>
      <ul class="ck-rows">${items.map(c => ckRow(c, canW, canB)).join("")}</ul>
    </div>`;
  }
  const scTxt = (c, key) => (c.na ? "" : sc(c[key]) == null ? "" : String(sc(c[key])));
  /* A4 인쇄 — 점검관용 양식과 같은 열(항목 · 관련근거 · 문서 · 시행 · N/A · 비고), 영역별 소계 */
  function printTable(a, groups) {
    const t = tally(checksOf(a).filter(Boolean)), pr = prep(a);
    const src = a.chkSrc || {};
    const sub = (s) => `문서 ${s.dSum}/${s.dN * 4} · 시행 ${s.iSum}/${s.iN * 4} · 평균 ${avgTxt(s.dAvg)} / ${avgTxt(s.iAvg)} · 준비 ${s.ready}/${s.ap}`;
    const remark = (c) => [c.note ? esc(c.note) : "", filesOf(c).length ? "첨부 " + filesOf(c).length : "", linksOf(c).filter(routeLive).map(r => esc(routeLabel(r))).join(", ")]
      .filter(Boolean).join("<br>");
    return `<div class="print-only au-print">
      <div class="au-pcap"><b>${esc(src.title || "점검 체크리스트")}${src.asOf ? " (" + esc(src.asOf) + ")" : ""}</b>
        <span>평가점수: ${SCORES.map((s, i) => esc(s) + " " + i).join(" · ")}</span></div>
      <table class="au-ptbl">
        <colgroup><col style="width:39%"><col style="width:25%"><col style="width:6%"><col style="width:6%"><col style="width:5%"><col style="width:19%"></colgroup>
        <thead><tr><th>CHK-LIST 항목</th><th>관련근거</th><th>문서</th><th>시행</th><th>N/A</th><th>비고</th></tr></thead>
        <tbody>${groups.map(g => {
          const s = tally(g.items);
          return `<tr class="au-psec"><td colspan="6"><b>${esc(secName(g))}</b><span>${sub(s)}</span></td></tr>` + g.items.map(c =>
            `<tr><td class="au-pt">${c.mid ? `<b class="mono">${esc(c.mid)}</b> ` : ""}${esc(c.text || "")}</td><td class="au-pr">${refLines(c.ref).map(esc).join("<br>")}</td>
              <td class="c mono">${scTxt(c, "docScore")}</td><td class="c mono">${scTxt(c, "impScore")}</td><td class="c">${c.na ? "✓" : ""}</td><td class="au-pn">${remark(c)}</td></tr>`).join("");
        }).join("")}
        <tr class="au-ptot"><td colspan="6"><b>합계</b><span>${sub(t)} · 준비율 ${pr.pct}%</span></td></tr></tbody>
      </table>
      ${src.ssi ? `<div class="au-pssi">민감보안정보 — ${esc(src.ssi)}</div>` : ""}
    </div>`;
  }
  function checklistHTML(a, canW) {
    const all = checksOf(a).filter(Boolean);
    const t = tally(all), pr = prep(a);
    const groups = groupsOf(a);
    const canB = canMaster();
    if (ckSec !== "all" && !groups.some(g => secKey(g) === ckSec)) ckSec = "all";
    const vis = groups.filter(g => ckSec === "all" || secKey(g) === ckSec)
      .map(g => ({ g, items: g.items.filter(ckMatch) })).filter(x => x.items.length);
    const shown = vis.reduce((n, x) => n + x.items.length, 0);
    const kpi = (label, val, sub, st, tone) => `<button type="button" class="ck-kpi${tone ? " t-" + tone : ""}" ${st ? `data-ckst="${st}" aria-pressed="${ckSt === st}"` : "disabled"}>
      <span class="ck-kpi-l">${esc(label)}</span><b class="mono">${esc(String(val))}</b>${sub ? `<small class="mono">${esc(sub)}</small>` : ""}</button>`;
    const src = a.chkSrc && a.chkSrc.title ? `<p class="ck-src">${esc(a.chkSrc.title)}${a.chkSrc.asOf ? " · " + esc(a.chkSrc.asOf) : ""}</p>` : "";
    return `<section class="card au-sec" id="au-checks">
        <div class="au-sh"><h3>점검 체크리스트</h3><span class="au-cnt mono">${pr.done}/${pr.total}</span>${pr.total ? bar(pr.pct) : ""}
          <span class="spacer"></span>
          ${canW && canB ? `<button type="button" class="btn btn-ghost btn-sm" id="au-load">${icon("clipboard", 15)}<span>체크리스트 불러오기</span></button>` : ""}
          ${canW ? `<button type="button" class="btn btn-ghost btn-sm" id="au-ck-add">${icon("plus", 15)}<span>항목 추가</span></button>` : ""}
        </div>
        ${src}
        ${all.length ? `<div class="ck-kpis no-print">
            ${kpi("준비율", pr.pct + "%", pr.done + "/" + pr.total, "ready", pr.total && pr.pct === 100 ? "ok" : "")}
            ${kpi("평가", (t.ap - t.todo) + "/" + t.ap, "", "todo", t.todo ? "" : "ok")}
            ${kpi("문서 평균", avgTxt(t.dAvg), t.dN ? t.dSum + "/" + t.dN * 4 : "", "", "")}
            ${kpi("시행 평균", avgTxt(t.iAvg), t.iN ? t.iSum + "/" + t.iN * 4 : "", "", "")}
            ${kpi("보완 필요", t.low, "", "low", t.low ? "bad" : "")}
            ${kpi("증빙 없음", t.noev, "", "noev", t.noev ? "warn" : "")}
            ${t.na ? kpi("N/A", t.na, "", "na", "") : ""}
          </div>
          <div class="ck-bar no-print">
            <label class="ck-f"><span>영역</span><select id="ck-sec"><option value="all">전체 영역</option>${groups.map(g =>
              `<option value="${esc(secKey(g))}" ${ckSec === secKey(g) ? "selected" : ""}>${esc(secName(g))}</option>`).join("")}</select></label>
            <label class="ck-f"><span>상태</span><select id="ck-st">${CK_ST.map(([v, lb]) => `<option value="${v}" ${ckSt === v ? "selected" : ""}>${esc(lb)}</option>`).join("")}</select></label>
            <span class="ck-shown mono">${shown}/${all.length}</span>
            ${ckSec !== "all" || ckSt !== "all" ? `<button type="button" class="pb-clear" id="ck-clear">조건 해제</button>` : ""}
          </div>
          <div class="ck-list no-print">${vis.length ? vis.map(({ g, items }) => groupHTML(g, items, canW, canB)).join("")
            : `<p class="au-none">조건에 맞는 항목이 없습니다.</p>`}</div>
          ${printTable(a, groups)}`
        : `<p class="au-none">${canW ? (canB ? "체크리스트를 불러오거나 항목을 추가하세요." : "항목을 추가하세요.") : "등록된 항목이 없습니다."}</p>`}
      </section>`;
  }

  /* 원본에서 영역을 골라 항목 만들기 — 이미 있는 번호는 건너뛰고, 원본 항목은 번호 순 · 직접 추가 항목은 뒤 */
  function applyChecklist(a, m, secNos, opts) {
    opts = opts || {};
    if (!a || !validMaster(m)) return 0;
    const want = {};
    (secNos || []).forEach(n => { want[String(n)] = true; });
    if (!Array.isArray(a.checklist)) a.checklist = [];
    if (opts.drop) a.checklist = a.checklist.filter(c => !unusedItem(c));
    const have = {};
    a.checklist.forEach(c => { if (c && c.mid) have[c.mid] = true; });
    const secs = (Array.isArray(a.chkSecs) ? a.chkSecs : []).filter(x => x && x.no).map(x => ({ no: x.no, title: x.title || "" }));
    const fresh = [];
    m.sections.forEach(s => {
      if (!s || !want[String(s.no)]) return;
      if (!secs.some(x => x.no === String(s.no))) secs.push({ no: String(s.no), title: norm(s.title) });
      (s.items || []).forEach(it => {
        if (!it || !it.no || have[it.no]) return;
        have[it.no] = true;
        fresh.push({ id: uid("ck"), mid: String(it.no), sec: String(s.no), text: String(it.text || "").trim(), ref: String(it.ref || "").trim(),
          owner: "", note: "", docScore: null, impScore: null, na: false, files: [] });
      });
    });
    const mids = a.checklist.filter(c => c && c.mid).concat(fresh).sort((x, y) => cmpMid(x.mid, y.mid));
    a.checklist = mids.concat(a.checklist.filter(c => c && !c.mid));
    a.chkSecs = secs.sort((x, y) => cmpMid(x.no, y.no));
    a.chkSrc = { title: norm(m.title), asOf: norm(m.asOf), ssi: norm(m.ssi) };
    stamp(a);
    return fresh.length;
  }
  function loadForm(aid) {
    const a = byId(aid);
    if (!a || !SeMIS.canEdit() || !canMaster()) return;
    openModal(`<h3>체크리스트 불러오기</h3>
      <div id="cl-body" class="cl-body"><p class="au-none">원본을 불러오는 중…</p></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok" disabled>불러오기</button>
      </div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    return loadMaster().then(m => {
      const body = document.getElementById("cl-body");
      if (!body) return;                                   // 그사이 창을 닫음
      if (!m) { body.innerHTML = `<p class="au-none">${masterErr === "fail" ? "원본을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요." : "등록된 체크리스트 원본이 없습니다."}</p>`; return; }
      const have = {};
      checksOf(a).forEach(c => { if (c && c.mid) have[c.mid] = true; });
      const preset = PRESET[a.body];
      const unused = checksOf(a).filter(unusedItem).length;
      body.innerHTML = `<p class="cl-src"><b>${esc(m.title || "")}</b>${m.asOf ? ` <span class="mono">${esc(m.asOf)}</span>` : ""}</p>
        <div class="cl-secs">${m.sections.map(s => {
          const its = s.items || [], got = its.filter(it => have[it.no]).length, full = its.length && got === its.length;
          const on = !full && (!preset || preset.indexOf(String(s.no)) >= 0);
          return `<label class="cl-sec${full ? " is-have" : ""}"><input type="checkbox" value="${esc(s.no)}" ${on ? "checked" : ""} ${full ? "disabled" : ""}>
            <span class="cl-no mono">${esc(s.no)}.</span><span class="cl-st">${esc(s.title || "")}</span>
            <span class="cl-n mono">${full ? "불러옴" : got ? got + "/" + its.length : its.length}</span></label>`;
        }).join("")}</div>
        ${unused ? `<label class="au-opt cl-drop"><input type="checkbox" id="cl-drop" checked> 사용하지 않은 기존 항목 ${unused}개 빼기</label>` : ""}`;
      const ok = $("#modal-box [data-act=ok]");
      const picked = () => $$(".cl-sec input:checked", body).map(i => i.value);
      const count = () => {
        const want = {}; picked().forEach(n => { want[n] = true; });
        let n = 0;
        m.sections.forEach(s => { if (want[String(s.no)]) (s.items || []).forEach(it => { if (it && !have[it.no]) n++; }); });
        ok.disabled = !n;
        ok.textContent = n ? n + "개 불러오기" : "불러오기";
      };
      $$(".cl-sec input", body).forEach(i => { i.onchange = count; });
      count();
      ok.onclick = () => {
        const n = applyChecklist(a, m, picked(), { drop: !!($("#cl-drop") && $("#cl-drop").checked) });
        closeModal(); ckSec = "all"; ckSt = "all";
        SeMIS.save(); paint(); toast(n + "개 항목을 불러왔습니다.");
      };
    });
  }
  /* 근거 본문 요지 (hq) — 원본에서만 읽고 수검 기록에는 남기지 않는다 */
  function basisHTML(b) {
    return String(b || "").split("\n").map(l => l.trim()).filter(Boolean).map(l =>
      l.indexOf("■") === 0 ? `<h5>${esc(l.replace(/^■\s*/, ""))}</h5>`
      : l.indexOf("※") === 0 ? `<p class="bs-note">${esc(l)}</p>`
      : /^[①-⑳]/.test(l) ? `<p class="bs-li">${esc(l)}</p>` : `<p>${esc(l)}</p>`).join("");
  }
  function basisView(mid) {
    return loadMaster().then(m => {
      const hit = m ? masterItem(mid) : null;
      if (!hit) { toast(m ? "원본에 없는 항목입니다." : "근거 요지를 불러오지 못했습니다.", true); return; }
      const b = basisOf(mid);
      openModal(`<h3><span class="mono">${esc(mid)}</span> 근거 본문 요지 <span class="bs-ssi">민감보안정보</span></h3>
        <p class="bs-t">${esc(hit.item.text || "")}</p>
        ${hit.item.ref ? `<div class="ck-refs">${refChips(hit.item.ref)}</div>` : ""}
        <div class="bs-body">${b ? basisHTML(b) : '<p class="au-none">요지가 없습니다.</p>'}</div>
        <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="cancel">닫기</button></div>`, { wide: true });
      $("#modal-box [data-act=cancel]").onclick = closeModal;
    });
  }
  /* 체크리스트 카드만 다시 그린다(점수 · N/A · 필터) — 바꾼 입력칸에 초점을 되돌린다 */
  function paintChecks(a, focusSel) {
    const old = document.getElementById("au-checks");
    if (!old) { paint(); return; }
    const tmp = document.createElement("div");
    tmp.innerHTML = checklistHTML(a, SeMIS.canEdit());
    const neo = tmp.firstElementChild;
    old.parentNode.replaceChild(neo, old);
    wireChecks(neo, a);
    if (focusSel) { const f = neo.querySelector(focusSel); if (f) try { f.focus(); } catch (e) { /* 초점 실패 무시 */ } }
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  }
  function wireChecks(sec, a) {
    if (!sec || !a) return;
    const canW = SeMIS.canEdit();
    const cOf = (id) => checksOf(a).find(x => x && x.id === id);
    const cssq = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'));
    const ld = $("#au-load", sec);
    if (ld) ld.onclick = () => loadForm(a.id);
    const ad = $("#au-ck-add", sec);
    if (ad) ad.onclick = () => checkForm(a.id, null);
    const fs = $("#ck-sec", sec), ft = $("#ck-st", sec), cl = $("#ck-clear", sec);
    if (fs) fs.onchange = () => { ckSec = fs.value; paintChecks(a, "#ck-sec"); };
    if (ft) ft.onchange = () => { ckSt = ft.value; paintChecks(a, "#ck-st"); };
    if (cl) cl.onclick = () => { ckSec = "all"; ckSt = "all"; paintChecks(a, "#ck-sec"); };
    $$("[data-ckst]", sec).forEach(b => b.onclick = () => {
      ckSt = ckSt === b.dataset.ckst ? "all" : b.dataset.ckst;
      paintChecks(a, `[data-ckst="${cssq(b.dataset.ckst)}"]`);
    });
    $$("[data-ck-go]", sec).forEach(b => b.onclick = () => SeMIS.navigate(b.dataset.ckGo));
    $$("[data-basis]", sec).forEach(b => b.onclick = () => basisView(b.dataset.basis));
    if (!canW) return;
    $$("select[data-sc]", sec).forEach(el => el.onchange = () => {
      const c = cOf(el.dataset.cid);
      if (!c) return;
      const v = el.value === "" ? null : Number(el.value);
      c[el.dataset.sc === "doc" ? "docScore" : "impScore"] = sc(v);
      stamp(a); SeMIS.save();
      paintChecks(a, `select[data-sc="${el.dataset.sc}"][data-cid="${cssq(c.id)}"]`);
    });
    $$("[data-na]", sec).forEach(b => b.onclick = () => {
      const c = cOf(b.dataset.na);
      if (!c) return;
      c.na = !c.na;
      stamp(a); SeMIS.save();
      paintChecks(a, `[data-na="${cssq(c.id)}"]`);
    });
    $$("[data-ck-edit]", sec).forEach(b => b.onclick = () => checkForm(a.id, b.dataset.ckEdit));
  }

  /* ═════════ 폼 ═════════ */
  const fld = (idn, label, html, tip) => `<div class="form-row"><label for="${idn}">${esc(label)}${tip ? " " + ui.tip(tip, label + " 설명") : ""}</label>${html}</div>`;
  const dl = (id, vals) => `<datalist id="${id}">${vals.filter(Boolean).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const people = () => {
    const s = {};
    (SeMIS.assignees ? SeMIS.assignees() : []).forEach(x => { if (x && x.name) s[x.name] = true; });
    list().forEach(a => { if (a.lead) s[a.lead] = true; findingsOf(a).forEach(f => { if (f.owner) s[f.owner] = true; }); checksOf(a).forEach(c => { if (c.owner) s[c.owner] = true; }); });
    return Object.keys(s).sort((x, y) => x.localeCompare(y, "ko"));
  };
  const pastRefs = () => {
    const s = {};
    allFindings().forEach(x => { if (x.f.ref) s[norm(x.f.ref)] = true; });
    list().forEach(a => checksOf(a).forEach(c => { if (c.ref) s[norm(c.ref)] = true; }));
    return Object.keys(s).sort((x, y) => x.localeCompare(y, "ko"));
  };

  /* 첨부 — 비공개 버킷 audits/ (올리면 표준 주소로 저장, 화면에서는 자동 서명) */
  async function uploadInto(files, fileList, done) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of arr) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("올리는 중: " + file.name);
      try {
        const up = await SemisSync.uploadFile(file, FOLDER);
        files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url });
      } catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }
  /* 폼 안의 첨부 칸 — files 배열을 직접 고친다 */
  function fileBox(prefix, files) {
    return `<div class="form-row"><label>첨부</label>
      <div class="au-files au-files-edit" id="${prefix}-files">${fileChips(files, prefix + "-fdel")}</div>
      <input type="file" id="${prefix}-file" multiple hidden>
      <button type="button" class="btn btn-ghost btn-sm" id="${prefix}-fbtn">${icon("link", 15)}<span>파일 올리기</span></button></div>`;
  }
  function wireFileBox(prefix, files) {
    const paint = () => {
      const box = $("#" + prefix + "-files");
      if (!box) return;
      box.innerHTML = fileChips(files, prefix + "-fdel");
      $$("[data-" + prefix + "-fdel]", box).forEach(b => b.onclick = () => {
        files.splice(Number(b.getAttribute("data-" + prefix + "-fdel")), 1); paint();
      });
    };
    paint();
    const inp = $("#" + prefix + "-file"), btn = $("#" + prefix + "-fbtn");
    if (btn && inp) {
      btn.onclick = () => inp.click();
      inp.onchange = () => { const fl = Array.from(inp.files || []); inp.value = ""; uploadInto(files, fl, paint); };
    }
  }

  function auditForm(id, preset) {
    if (!SeMIS.canEdit()) return;
    const x = id ? byId(id) : null;
    if (id && !x) return;
    const v = Object.assign({ body: "gov", org: "", kind: "", start: "", end: "", place: "", lead: "", scope: "", memo: "",
      outcome: "", cancelled: false, linkCal: true }, preset || {}, x || {});
    const files = filesOf(x).map(f => Object.assign({}, f));
    const bodySel = `<select id="af-body">${BODY_KEYS.map(k => `<option value="${k}" ${v.body === k ? "selected" : ""}>${esc(BODIES[k].label)}</option>`).join("")}</select>`;
    openModal(`<h3>${x ? "수검 수정" : "수검 등록"}</h3>
      <div class="form-grid">
        ${fld("af-body", "구분", bodySel)}
        ${fld("af-kind", "유형", `<input id="af-kind" value="${esc(v.kind)}" maxlength="40" autocomplete="off" list="af-dl-kind" placeholder="예: 정기점검">`)}
        ${fld("af-org", "점검 기관", `<input id="af-org" value="${esc(v.org)}" maxlength="60" autocomplete="off" list="af-dl-org">`)}
        ${fld("af-lead", "수검 책임", `<input id="af-lead" value="${esc(v.lead)}" maxlength="40" autocomplete="off" list="af-dl-p">`)}
        ${fld("af-start", "시작일", `<input type="date" id="af-start" value="${esc(v.start)}">`)}
        ${fld("af-end", "종료일", `<input type="date" id="af-end" value="${esc(v.end)}">`)}
      </div>
      ${fld("af-place", "장소", `<input id="af-place" value="${esc(v.place)}" maxlength="80" placeholder="예: 인천 화물터미널">`)}
      ${fld("af-scope", "범위 · 대상", `<textarea id="af-scope" rows="2" maxlength="400">${esc(v.scope)}</textarea>`)}
      ${fld("af-memo", "메모", `<textarea id="af-memo" rows="3" maxlength="2000">${esc(v.memo)}</textarea>`)}
      ${fileBox("af", files)}
      <div class="au-opts">
        <label class="au-opt"><input type="checkbox" id="af-cal" ${v.linkCal !== false && !v.noCalMain ? "checked" : ""}> 일정관리에 표시 ${ui.tip("수검 기간과 지적 조치 기한이 일정관리에 올라갑니다. 일정관리에서 날짜를 옮기거나 완료하면 여기에도 반영됩니다.", "일정관리 연동 설명")}</label>
        ${!x && canMaster() ? `<label class="au-opt"><input type="checkbox" id="af-tpl" checked> 점검 체크리스트 불러오기</label>` : ""}
        ${x ? `<label class="au-opt"><input type="checkbox" id="af-cancel" ${v.cancelled ? "checked" : ""}> 취소된 수검</label>` : ""}
      </div>
      ${dl("af-dl-kind", [])}${dl("af-dl-org", [])}${dl("af-dl-p", people())}
      <div class="modal-actions">
        ${x && SeMIS.canDelete() ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`, { wide: true });
    const fillLists = () => {
      const b = BODIES[$("#af-body").value] || BODIES.gov;
      const used = (k) => list().filter(a => a.body === $("#af-body").value).map(a => a[k]);
      $("#af-dl-kind").innerHTML = uniq(b.kinds.concat(used("kind"))).map(s => `<option value="${esc(s)}">`).join("");
      $("#af-dl-org").innerHTML = uniq(b.orgs.concat(used("org"))).map(s => `<option value="${esc(s)}">`).join("");
    };
    fillLists();
    $("#af-body").onchange = fillLists;
    wireFileBox("af", files);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`수검 "${auditTitle(x)}"을(를) 삭제합니다. 준비 항목 · 지적사항 · 연동 일정도 함께 지워집니다.`, () => {
      D()[KEY] = list().filter(a => a.id !== x.id);
      dropCalendar(x.id);
      if (sel === x.id) sel = "";
      SeMIS.save(); SeMIS.renderView(); toast("삭제했습니다.");
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const val = (k) => norm(($("#af-" + k) || {}).value);
      let s = ($("#af-start") || {}).value || "", e = ($("#af-end") || {}).value || "";
      if (!val("org") && !val("kind")) { toast("점검 기관이나 유형을 입력하세요.", true); $("#af-org").focus(); return; }
      if (s && e && e < s) { const tmp = s; s = e; e = tmp; }
      if (!s && e) { s = e; e = ""; }
      const rec = {
        body: BODIES[$("#af-body").value] ? $("#af-body").value : "gov", org: val("org"), kind: val("kind"),
        start: s, end: e && e !== s ? e : "", place: val("place"), lead: val("lead"),
        scope: String($("#af-scope").value || "").trim(), memo: String($("#af-memo").value || "").trim(),
        files: files.slice(), linkCal: !!$("#af-cal").checked,
        cancelled: $("#af-cancel") ? !!$("#af-cancel").checked : false
      };
      rec.noCalMain = false;              // 체크 = 수검 기간 · 지적 기한 모두 표시, 해제 = 모두 내림
      const pick = !x && !!($("#af-tpl") && $("#af-tpl").checked);
      let saved;
      if (x) { Object.assign(x, rec); saved = x; }
      else {
        saved = Object.assign({ id: uid("au"), outcome: "", checklist: [], findings: [], createdAt: new Date().toISOString(), createdBy: me() }, rec);
        store().push(saved);
      }
      stamp(saved);
      syncCalendar(saved);
      closeModal();
      if (!x) {
        sel = saved.id; ckSec = "all"; ckSt = "all";
        SeMIS.save(); SeMIS.renderView(); toast("등록했습니다.");
        if (pick) loadForm(saved.id);            // 바로 영역을 골라 체크리스트를 만든다
        return;
      }
      SeMIS.save(); paint(); toast("저장했습니다.");
    };
  }
  const uniq = (arr) => arr.map(norm).filter((s, i, all) => s && all.indexOf(s) === i);

  function checkForm(aid, cid) {
    const a = byId(aid);
    if (!a || !SeMIS.canEdit()) return;
    const c = cid ? checksOf(a).find(x => x && x.id === cid) : null;
    if (cid && !c) return;
    const fixed = !!(c && c.mid);                       // 원본 항목 — 문구 · 관련근거는 원본 그대로
    const v = Object.assign({ text: "", ref: "", owner: "", note: "", docScore: null, impScore: null, na: false }, c || {});
    const files = filesOf(c).map(f => Object.assign({}, f));
    const cur = linksOf(v);
    const def = (fixed && DEF_LINKS[c.mid]) || [];
    const scSel = (idn, val) => `<select id="${idn}"><option value="">-</option>${SCORES.map((t, i) =>
      `<option value="${i}" ${sc(val) === i ? "selected" : ""}>${i} ${esc(t)}</option>`).join("")}</select>`;
    openModal(`<h3>${c ? "항목 수정" : "항목 추가"}${fixed ? ` <small class="au-mh mono">${esc(c.mid)}</small>` : ""}</h3>
      ${fixed ? `<div class="ck-fixed"><p class="ck-t">${esc(v.text)}</p>${v.ref ? `<div class="ck-refs">${refChips(v.ref)}</div>` : ""}</div>`
        : fld("ac-text", "항목", `<input id="ac-text" value="${esc(v.text)}" maxlength="200" autocomplete="off">`)
          + fld("ac-ref", "관련근거", `<input id="ac-ref" value="${esc(norm(v.ref))}" maxlength="120" autocomplete="off" list="ac-dl-ref" placeholder="예: ICNKF SSOP 4.2.3">`)}
      <div class="form-grid">
        ${fld("ac-doc", "문서", scSel("ac-doc", v.docScore))}
        ${fld("ac-imp", "시행", scSel("ac-imp", v.impScore))}
      </div>
      <label class="au-opt"><input type="checkbox" id="ac-na" ${v.na ? "checked" : ""}> N/A (해당 없음)</label>
      ${fld("ac-owner", "담당", `<input id="ac-owner" value="${esc(v.owner)}" maxlength="40" autocomplete="off" list="ac-dl-p">`)}
      ${fld("ac-note", "의견 · 비고", `<textarea id="ac-note" rows="2" maxlength="500">${esc(v.note)}</textarea>`)}
      ${fileBox("ac", files)}
      <div class="form-row"><label>증빙 화면 ${ui.tip("이 항목을 증명하는 화면입니다. 열린 화면이 연결되어 있거나 파일이 첨부되어 있으면 증빙이 있는 것으로 봅니다.", "증빙 화면 설명")}</label>
        <div class="ck-rchoose" id="ac-links">${routeChoices().map(r => `<label class="ck-rc"><input type="checkbox" value="${esc(r)}" ${cur.indexOf(r) >= 0 ? "checked" : ""}>
          <span>${esc(routeLabel(r))}</span>${routeLive(r) ? "" : "<small>준비 중</small>"}</label>`).join("")}</div></div>
      ${dl("ac-dl-ref", pastRefs())}${dl("ac-dl-p", people())}
      <div class="modal-actions">
        ${c ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`, { wide: true });
    wireFileBox("ac", files);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => {
      a.checklist = checksOf(a).filter(x => x !== c);
      stamp(a); SeMIS.save(); closeModal(); paint(); toast("삭제했습니다.");
    };
    $("#modal-box [data-act=ok]").onclick = () => {
      const pickSc = (id) => { const el = $("#" + id); return el && el.value !== "" ? sc(Number(el.value)) : null; };
      const rec = { owner: norm($("#ac-owner").value), note: String($("#ac-note").value || "").trim(), files: files.slice(),
        docScore: pickSc("ac-doc"), impScore: pickSc("ac-imp"), na: !!$("#ac-na").checked };
      if (!fixed) {
        rec.text = norm($("#ac-text").value);
        if (!rec.text) { toast("항목을 입력하세요.", true); $("#ac-text").focus(); return; }
        rec.ref = norm($("#ac-ref").value);
      }
      const links = $$("#ac-links input:checked").map(i => i.value);
      const same = links.length === def.length && links.every(r => def.indexOf(r) >= 0);
      if (!Array.isArray(a.checklist)) a.checklist = [];
      const tgt = c || Object.assign({ id: uid("ck") }, { files: [] });
      Object.assign(tgt, rec);
      if (same) delete tgt.links; else tgt.links = links;   // 기본 연결과 같으면 기본값을 따른다(메뉴가 늘면 자동 반영)
      if (!c) a.checklist.push(tgt);
      stamp(a); SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }

  function findingForm(aid, fid) {
    const a = byId(aid);
    if (!a || !SeMIS.canEdit()) return;
    const f = fid ? findingsOf(a).find(x => x.id === fid) : null;
    if (fid && !f) return;
    const v = Object.assign({ type: "car", ref: "", text: "", action: "", owner: "", due: "", status: "open", doneDate: "" }, f || {});
    const files = filesOf(f).map(x => Object.assign({}, x));
    openModal(`<h3>${f ? "지적사항 수정" : "지적사항 추가"} <small class="au-mh">${esc(auditTitle(a))}</small></h3>
      <div class="form-grid">
        ${fld("fd-type", "유형", `<select id="fd-type">${FT_KEYS.map(k => `<option value="${k}" ${v.type === k ? "selected" : ""}>${esc(FTYPES[k].label)}</option>`).join("")}</select>`)}
        ${fld("fd-ref", "근거 조항", `<input id="fd-ref" value="${esc(v.ref)}" maxlength="80" autocomplete="off" list="fd-dl-ref">`,
          "같은 조항이 다른 수검에서도 지적되면 '재발'로 표시됩니다.")}
      </div>
      <div id="fd-rep" class="au-rep" role="status"></div>
      ${fld("fd-text", "지적 내용", `<textarea id="fd-text" rows="3" maxlength="1000">${esc(v.text)}</textarea>`)}
      ${fld("fd-action", "조치 내용", `<textarea id="fd-action" rows="2" maxlength="1000">${esc(v.action)}</textarea>`)}
      <div class="form-grid">
        ${fld("fd-owner", "담당", `<input id="fd-owner" value="${esc(v.owner)}" maxlength="40" autocomplete="off" list="fd-dl-p">`)}
        ${fld("fd-due", "조치 기한", `<input type="date" id="fd-due" value="${esc(v.due)}">`)}
        ${fld("fd-status", "상태", `<select id="fd-status">${Object.keys(FSTAT).map(k => `<option value="${k}" ${v.status === k ? "selected" : ""}>${esc(FSTAT[k].label)}</option>`).join("")}</select>`)}
        ${fld("fd-donedate", "완료일", `<input type="date" id="fd-donedate" value="${esc(v.doneDate)}">`)}
      </div>
      ${fileBox("fd", files)}
      ${dl("fd-dl-ref", pastRefs())}${dl("fd-dl-p", people())}
      <div class="modal-actions">
        ${f ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`, { wide: true });
    wireFileBox("fd", files);
    const showRep = () => {
      const k = refKey($("#fd-ref").value);
      const hits = k ? allFindings().filter(x => x.f !== f && refKey(x.f.ref) === k) : [];
      $("#fd-rep").innerHTML = hits.length ? `${ui.chip("이전 지적 " + hits.length + "건", "red")} ${hits.slice(0, 3).map(x =>
        `<span class="au-rep-i"><span class="mono">${esc(dot(x.a.start || ""))}</span> ${esc(auditTitle(x.a))} — ${esc(norm(x.f.text).slice(0, 40))}</span>`).join("")}` : "";
    };
    showRep();
    $("#fd-ref").oninput = showRep;
    $("#fd-type").onchange = () => {   // 현장시정은 대개 그 자리에서 끝난다
      if ($("#fd-type").value === "onsite" && $("#fd-status").value === "open") {
        $("#fd-status").value = "done";
        if (!$("#fd-donedate").value) $("#fd-donedate").value = isISO(a.start) ? endOf(a) : todayISO();
      }
    };
    $("#fd-status").onchange = () => { if ($("#fd-status").value === "done" && !$("#fd-donedate").value) $("#fd-donedate").value = todayISO(); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => {
      a.findings = findingsOf(a).filter(x => x.id !== f.id);
      stamp(a); syncCalendar(a); SeMIS.save(); closeModal(); paint(); toast("삭제했습니다.");
    };
    $("#modal-box [data-act=ok]").onclick = () => {
      const text = String($("#fd-text").value || "").trim();
      if (!text) { toast("지적 내용을 입력하세요.", true); $("#fd-text").focus(); return; }
      const status = FSTAT[$("#fd-status").value] ? $("#fd-status").value : "open";
      const rec = {
        type: FTYPES[$("#fd-type").value] ? $("#fd-type").value : "obs", ref: norm($("#fd-ref").value), text,
        action: String($("#fd-action").value || "").trim(), owner: norm($("#fd-owner").value), due: $("#fd-due").value || "",
        status, doneDate: status === "done" ? ($("#fd-donedate").value || todayISO()) : "", files: files.slice()
      };
      if (!Array.isArray(a.findings)) a.findings = [];
      if (f) Object.assign(f, rec); else a.findings.push(Object.assign({ id: uid("fd") }, rec));
      if (a.outcome === "none") a.outcome = "";
      stamp(a); syncCalendar(a); SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }

  /* ═════════ 렌더 ═════════ */
  const TABS = [["list", "수검 일정"], ["findings", "지적사항"]];
  function bodyHTML() {
    const a = sel ? byId(sel) : null;
    if (a) return detailHTML(a);
    return tab === "findings" ? findingsHTML() : listHTML();
  }
  function openAudit(id) {
    if (!byId(id)) return;
    if (sel !== id) { ckSec = "all"; ckSt = "all"; }
    sel = id;
    if (routeNow() === MOD) SeMIS.renderView(); else SeMIS.navigate(MOD);
  }
  function wire(root) {
    const box = $("#au-body", root) || root;
    $$("[data-aud]", box).forEach(tr => {
      const open = () => openAudit(tr.dataset.aud);
      tr.onclick = (ev) => { if (!ev.target.closest("a")) open(); };
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
    $$("[data-aud-open]", box).forEach(b => b.onclick = (ev) => { ev.stopPropagation(); openAudit(b.dataset.audOpen); });
    if (SeMIS.canEdit()) $$("tr[data-fnd]", box).forEach(tr => {
      const open = () => findingForm(tr.dataset.fa, tr.dataset.fnd);
      tr.onclick = (ev) => { if (!ev.target.closest("a") && !ev.target.closest("[data-aud-open]")) open(); };
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
    $$("[data-aseg]", box).forEach(b => b.onclick = () => {
      const v = b.dataset.v, k = b.dataset.aseg;
      if (k === "body") bodyF = v; else if (k === "st") stF = v; else if (k === "fbody") fBodyF = v; else if (k === "fst") fStF = v;
      paint();
    });
    const liveSearch = (id, set) => {
      const el = $("#" + id, box);
      if (!el) return;
      /* v1.13.1 — 입력칸은 그대로 두고 나머지만 다시 그린다(한글 조합 보호) */
      el.oninput = () => {
        set(ui.searchValue(el.value));
        const b = document.getElementById("au-body");
        if (!b || !b.contains(el)) { paint(); return; }
        ui.repaintKeep(b, bodyHTML(), el);
        wire(b.parentNode);
      };
    };
    liveSearch("au-q", v => { query = v; });
    liveSearch("au-fq", v => { fq = v; });
    const a = sel ? byId(sel) : null;
    if (!a) return;
    const back = $("#au-back", box);
    if (back) back.onclick = () => { sel = ""; SeMIS.renderView(); };
    const ed = $("#au-edit", box);
    if (ed) ed.onclick = () => auditForm(a.id);
    wireChecks($("#au-checks", box), a);
    const fa = $("#au-f-add", box);
    if (fa) fa.onclick = () => findingForm(a.id, null);
    const none = $("#au-none", box);
    if (none) none.onclick = () => confirmModal("지적사항 없이 결과를 확정합니다.", () => {
      a.outcome = "none"; stamp(a); SeMIS.save(); paint(); toast("지적 없음으로 종결했습니다.");
    });
  }
  function paint() {
    const box = document.getElementById("au-body");
    if (!box) { if (routeNow() === MOD) SeMIS.renderView(); return; }
    box.innerHTML = bodyHTML();
    wire(box.parentNode);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  }
  function render(root) {
    if (sel && !byId(sel)) sel = "";
    const canW = SeMIS.canEdit();
    root.innerHTML = ui.head({
      title: TITLE,
      meta: "국토부 · 해외 당국 · 화주 · 사내 심사",
      actions: canW && !sel ? `<button type="button" class="btn btn-primary" id="au-add">${icon("plus", 17)}<span>수검 등록</span></button>` : ""
    }) + (sel ? "" : `<div class="eq-tabs" role="tablist" aria-label="수검 대응 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-atab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>`)
      + `<div id="au-body">${bodyHTML()}</div>`;
    $$("[data-atab]", root).forEach(b => b.onclick = () => { tab = b.dataset.atab; SeMIS.renderView(); });
    if (sel && canMaster()) loadMaster();              // 근거 요지 · 불러오기를 바로 열 수 있게 미리 받아 둔다(메모리만)
    const add = $("#au-add", root);
    if (add) add.onclick = () => auditForm(null);
    wire(root);
  }

  /* ═════════ 대시보드 띠 (mgr) — 60일 안의 수검 또는 미결 지적이 있을 때만 ═════════ */
  const DASH_DAYS = 60;
  function dashData() {
    const t = todayISO();
    let nx = nextAudit(t);
    if (nx && dayDiff(t, nx.start) > DASH_DAYS) nx = null;
    const open = allFindings().filter(x => !x.a.cancelled && isOpenF(x.f));
    const late = open.filter(x => overdueF(x.f, t)).length;
    return (nx || open.length) ? { nx, open: open.length, late } : null;
  }
  function dashHTML() {
    const d = dashData();
    if (!d) return "";
    const pr = d.nx ? prep(d.nx) : null;
    return `<section class="dash-aud" id="dash-aud" aria-label="수검 대응">
      <div class="dc-head"><h2>수검 대응</h2><span class="spacer"></span><button type="button" class="link-btn" data-dau-go>수검 대응 센터</button></div>
      <div class="da-row">
        ${d.nx ? `<button type="button" class="da-next" data-dau-open="${esc(d.nx.id)}">
          <span class="da-dd mono">${esc(ddayText(d.nx))}</span>
          <span class="da-t"><b>${esc(auditTitle(d.nx))}</b><small class="mono">${esc(range(d.nx))}${pr.total ? " · 준비 " + pr.done + "/" + pr.total : ""}</small></span>
          ${pr.total ? bar(pr.pct) : ""}</button>` : ""}
        <button type="button" class="da-f${d.late ? " bad" : ""}" data-dau-f>
          <span>미결 지적 <b class="mono">${d.open}</b></span><span>기한 경과 <b class="mono">${d.late}</b></span></button>
      </div>
    </section>`;
  }
  function mountDash() {
    const box = document.getElementById("dash-aud");
    if (!box) return;
    $$("[data-dau-go]", box).forEach(b => b.onclick = () => { sel = ""; tab = "list"; SeMIS.navigate(MOD); });
    $$("[data-dau-open]", box).forEach(b => b.onclick = () => openAudit(b.dataset.dauOpen));
    $$("[data-dau-f]", box).forEach(b => b.onclick = () => { sel = ""; tab = "findings"; fStF = "open"; SeMIS.navigate(MOD); });
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { return allFindings().filter(x => !x.a.cancelled && isOpenF(x.f)).length || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "clipboard", module: MOD,
    items: () => {
      const goTo = (id) => () => { sel = id; if (routeNow() === MOD) setTimeout(() => SeMIS.renderView(), 0); };
      return list().filter(Boolean).map(a => ({ title: auditTitle(a), sub: [bodyOf(a).short, range(a)].join(" · "),
        text: [a.org, a.kind, a.scope, a.place, a.lead, a.memo], route: MOD, pick: goTo(a.id) }))
        .concat(allFindings().map(({ a, f }) => ({ title: norm(f.text).slice(0, 60) || "지적사항",
          sub: [(FTYPES[f.type] || FTYPES.obs).label, f.ref, auditTitle(a)].filter(Boolean).join(" · "),
          text: [f.text, f.ref, f.action, f.owner], route: MOD, pick: goTo(a.id) })));
    }
  });

  window.SemisAudit = {
    BODIES, FTYPES, FSTAT, PH, SCORES, EVIDENCE, PRESET, CST,
    phase, dday, ddayText, prep, repeatCount, overdueF, nextAudit, allFindings, auditTitle,
    syncCalendar, syncFromSchedule, unlinkBySchedule, dropCalendar, uploadInto,
    itemState, linksOf, tally, groupsOf, applyChecklist, loadForm, loadMaster, basisOf, basisView, cmpMid, unusedItem,
    setMaster(m) { master = validMaster(m) ? m : null; masterErr = ""; masterWait = null; },
    dashHTML, mountDash, dashData, open: openAudit, form: auditForm, checkForm, findingForm,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    getState() { return { tab, sel, query, bodyF, stF, fq, fStF, fBodyF, ckSec, ckSt }; },
    setState(o) {
      o = o || {};
      if (o.tab === "list" || o.tab === "findings") tab = o.tab;
      if (o.sel !== undefined) sel = String(o.sel || "");
      if (o.query !== undefined) query = String(o.query || "");
      if (o.bodyF) bodyF = o.bodyF; if (o.stF) stF = o.stF;
      if (o.fq !== undefined) fq = String(o.fq || "");
      if (o.fStF) fStF = o.fStF; if (o.fBodyF) fBodyF = o.fBodyF;
      if (o.ckSec) ckSec = String(o.ckSec); if (o.ckSt) ckSt = String(o.ckSt);
    }
  };
})();
