/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 수검 대응 센터 (v1.17, 라우트 audit)
   외부·사내 점검을 "받는" 쪽의 준비 → 수검 → 지적 조치 → 종결을 한 화면에서 관리한다.

   대상: 국토부 · 지방항공청 / 해외 당국 · 화주(TSA · EU ACC3 · 화주 감사) / 사내 심사(내부심사 · IOSA · 교차심사)

   화면
   - 수검 일정: 요약(다음 수검 D-day · 준비 진행 · 미결 지적 · 기한 경과 · 올해 수검) + 목록(구분 · 진행 필터, 검색)
   - 지적사항: 모든 수검의 지적을 한 표로(미결 · 완료 · 구분 필터, 검색) — 같은 조항이 다른 수검에서도 나오면 '재발'
   - 상세: 기본 정보 · 공문/결과 첨부 · 준비 체크리스트(구분별 기본 항목 · 증빙 파일) · 지적사항(유형 · 조항 · 조치 · 기한)
   - 대시보드 띠(mgr): 60일 안의 다음 수검 D-day · 준비율 · 미결 지적 — 해당 없으면 띠를 그리지 않는다

   데이터 DATA.audits = [{ id, body(gov|foreign|internal), org, kind, start, end, place, lead, scope, memo,
       outcome(""|"none" 지적 없음), cancelled, linkCal(일정관리 연동, 기본 true), noCalMain(수검 일정만 연동 해제),
       files[{name,size,url}], checklist[{id,text,ref,owner,note,done,doneAt,doneBy,files[]}],
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

  /* 구분별 기본 준비 항목 — 불러온 뒤 자유롭게 고치고 조항(근거)을 채운다 */
  const TEMPLATES = {
    gov: [
      "자체보안계획 최신 개정본 · 승인 공문 비치",
      "전 차 점검 지적사항 조치 결과 정리",
      "보안교육 실시 · 이수 기록(초기 · 정기)",
      "보안검색요원 자격 · 교육 현황",
      "보안검색장비 성능검사 · 일일점검 기록",
      "화물 보안검색 기록(검색 방법 · 미검색 사유)",
      "상용화주 · 보안업체(RA) 지정 · 확인 기록",
      "보호구역 출입 통제 기록(출입증 · 임시 출입)",
      "보안사고 · 위반 보고와 조치 기록",
      "비상연락망 · 보고체계 최신화"
    ],
    foreign: [
      "지정서 · 이전 검증 보고서 유효기간 확인(ACC3 등)",
      "화물 보안 통제 절차서(영문) 최신본",
      "보안교육 기록 — 대상 인원 이수 · 재교육 주기",
      "보안검색 기록 샘플(검색 방법 · 수량)",
      "보안 상태 표기 · 보안선언서 샘플",
      "인수부터 탑재까지 보안 유지 기록(봉인 · 보호)",
      "보안검색장비 인증 · 성능 기록",
      "전 차 권고사항 이행 결과"
    ],
    internal: [
      "규정 · 절차서 최신본과 현장 적용 일치 확인",
      "전 차 심사 지적 조치 결과",
      "교육 · 자격 기록",
      "점검 · 검색 기록 누락 여부",
      "문서 관리(개정 이력 · 배포)",
      "변경 · 위험 관리 기록"
    ]
  };

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
  function prep(a) {
    const c = checksOf(a);
    const done = c.filter(x => x && x.done).length;
    return { done, total: c.length, pct: c.length ? Math.round(done / c.length * 100) : 0 };
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
    const b = bodyOf(a), pr = prep(a), fs = findingsOf(a);
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
      <section class="card au-sec" id="au-checks">
        <div class="au-sh"><h3>준비 체크리스트</h3><span class="au-cnt mono">${pr.done}/${pr.total}</span>${pr.total ? bar(pr.pct) : ""}
          <span class="spacer"></span>
          ${canW ? `${!pr.total && TEMPLATES[a.body] ? `<button type="button" class="btn btn-ghost btn-sm" id="au-tpl">${icon("clipboard", 15)}<span>기본 항목</span></button>` : ""}
            <button type="button" class="btn btn-ghost btn-sm" id="au-ck-add">${icon("plus", 15)}<span>항목 추가</span></button>` : ""}
        </div>
        ${pr.total ? `<ul class="au-checks">${checksOf(a).map((c, i) => `<li class="au-ck-row${c.done ? " is-done" : ""}">
            ${canW ? `<button type="button" class="au-ck" data-ck="${esc(c.id)}" aria-pressed="${!!c.done}" aria-label="${esc((c.done ? "완료 해제: " : "완료: ") + (c.text || ""))}">${c.done ? icon("check", 15) : ""}</button>`
              : `<span class="au-ck" aria-hidden="true">${c.done ? icon("check", 15) : ""}</span>`}
            <div class="au-ck-b"><span class="au-ck-n mono">${i + 1}</span><span class="au-ck-t">${esc(c.text || "")}</span>
              ${c.ref || c.owner || c.note || (c.done && c.doneAt) ? `<div class="au-ck-s">${[c.ref ? `<span class="au-ref">${esc(c.ref)}</span>` : "", c.owner ? esc(c.owner) : "", c.note ? esc(c.note) : "",
                c.done && c.doneAt ? `<span><span class="mono">${esc(md(localDay(c.doneAt)))}</span>${c.doneBy ? " " + esc(c.doneBy) : ""}</span>` : ""].filter(Boolean).join('<span class="au-sep">·</span>')}</div>` : ""}
              ${filesOf(c).length ? `<div class="au-files">${fileChips(filesOf(c))}</div>` : ""}</div>
            ${canW ? `<button type="button" class="mt-btn" data-ck-edit="${esc(c.id)}" aria-label="항목 수정">${icon("notes", 15)}</button>` : ""}
          </li>`).join("")}</ul>`
        : `<p class="au-none">${canW ? "기본 항목을 불러오거나 항목을 추가하세요." : "등록된 준비 항목이 없습니다."}</p>`}
      </section>
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
        ${!x ? `<label class="au-opt"><input type="checkbox" id="af-tpl" checked> 기본 준비 항목 넣기</label>` : ""}
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
      let saved;
      if (x) { Object.assign(x, rec); saved = x; }
      else {
        saved = Object.assign({ id: uid("au"), outcome: "", checklist: [], findings: [], createdAt: new Date().toISOString(), createdBy: me() }, rec);
        if ($("#af-tpl") && $("#af-tpl").checked) saved.checklist = templateItems(saved.body);
        store().push(saved);
      }
      stamp(saved);
      syncCalendar(saved);
      closeModal();
      if (!x) { sel = saved.id; SeMIS.save(); SeMIS.renderView(); toast("등록했습니다."); return; }
      SeMIS.save(); paint(); toast("저장했습니다.");
    };
  }
  const uniq = (arr) => arr.map(norm).filter((s, i, all) => s && all.indexOf(s) === i);
  function templateItems(body) {
    return (TEMPLATES[body] || []).map(text => ({ id: uid("ck"), text, ref: "", owner: "", note: "", done: false, files: [] }));
  }

  function checkForm(aid, cid) {
    const a = byId(aid);
    if (!a || !SeMIS.canEdit()) return;
    const c = cid ? checksOf(a).find(x => x.id === cid) : null;
    if (cid && !c) return;
    const v = Object.assign({ text: "", ref: "", owner: "", note: "", done: false }, c || {});
    const files = filesOf(c).map(f => Object.assign({}, f));
    openModal(`<h3>${c ? "준비 항목 수정" : "준비 항목 추가"}</h3>
      ${fld("ac-text", "항목", `<input id="ac-text" value="${esc(v.text)}" maxlength="160" autocomplete="off">`)}
      <div class="form-grid">
        ${fld("ac-ref", "근거 조항", `<input id="ac-ref" value="${esc(v.ref)}" maxlength="80" autocomplete="off" list="ac-dl-ref" placeholder="예: 자체보안계획 7.3">`)}
        ${fld("ac-owner", "담당", `<input id="ac-owner" value="${esc(v.owner)}" maxlength="40" autocomplete="off" list="ac-dl-p">`)}
      </div>
      ${fld("ac-note", "비고", `<input id="ac-note" value="${esc(v.note)}" maxlength="200">`)}
      ${fileBox("ac", files)}
      <label class="au-opt"><input type="checkbox" id="ac-done" ${v.done ? "checked" : ""}> 준비 완료</label>
      ${dl("ac-dl-ref", pastRefs())}${dl("ac-dl-p", people())}
      <div class="modal-actions">
        ${c ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`);
    wireFileBox("ac", files);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => {
      a.checklist = checksOf(a).filter(x => x.id !== c.id);
      stamp(a); SeMIS.save(); closeModal(); paint(); toast("삭제했습니다.");
    };
    $("#modal-box [data-act=ok]").onclick = () => {
      const text = norm($("#ac-text").value);
      if (!text) { toast("항목을 입력하세요.", true); $("#ac-text").focus(); return; }
      const done = !!$("#ac-done").checked;
      const rec = { text, ref: norm($("#ac-ref").value), owner: norm($("#ac-owner").value), note: norm($("#ac-note").value), files: files.slice(), done };
      if (done && !(c && c.done)) { rec.doneAt = new Date().toISOString(); rec.doneBy = me(); }
      if (!done) { rec.doneAt = ""; rec.doneBy = ""; }
      if (!Array.isArray(a.checklist)) a.checklist = [];
      if (c) Object.assign(c, rec); else a.checklist.push(Object.assign({ id: uid("ck") }, rec));
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
    const tpl = $("#au-tpl", box);
    if (tpl) tpl.onclick = () => {
      a.checklist = checksOf(a).concat(templateItems(a.body));
      stamp(a); SeMIS.save(); paint(); toast("기본 준비 항목을 넣었습니다.");
    };
    const ad = $("#au-ck-add", box);
    if (ad) ad.onclick = () => checkForm(a.id, null);
    $$("[data-ck]", box).forEach(b => b.onclick = () => {
      const c = checksOf(a).find(x => x.id === b.dataset.ck);
      if (!c || !SeMIS.canEdit()) return;
      c.done = !c.done;
      c.doneAt = c.done ? new Date().toISOString() : ""; c.doneBy = c.done ? me() : "";
      stamp(a); SeMIS.save(); paint();
    });
    $$("[data-ck-edit]", box).forEach(b => b.onclick = () => checkForm(a.id, b.dataset.ckEdit));
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
    BODIES, TEMPLATES, FTYPES, FSTAT, PH,
    phase, dday, ddayText, prep, repeatCount, overdueF, nextAudit, allFindings, auditTitle,
    syncCalendar, syncFromSchedule, unlinkBySchedule, dropCalendar, templateItems, uploadInto,
    dashHTML, mountDash, dashData, open: openAudit, form: auditForm, checkForm, findingForm,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    getState() { return { tab, sel, query, bodyF, stF, fq, fStF, fBodyF }; },
    setState(o) {
      o = o || {};
      if (o.tab === "list" || o.tab === "findings") tab = o.tab;
      if (o.sel !== undefined) sel = String(o.sel || "");
      if (o.query !== undefined) query = String(o.query || "");
      if (o.bodyF) bodyF = o.bodyF; if (o.stF) stF = o.stF;
      if (o.fq !== undefined) fq = String(o.fq || "");
      if (o.fStF) fStF = o.fStF; if (o.fBodyF) fBodyF = o.fBodyF;
    }
  };
})();
