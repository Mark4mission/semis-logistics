/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 보안 기록부 (v1.22, 라우트 inspection)
   예정 메뉴 '안전보안 점검 일정(inspection)'을 대체하는 주기형 보안 점검 일지.
   일일 · 월간 · 분기 · 불시 자체점검, 위해물품 월점검, 브리핑 · 순찰, Quarterly Self-Audit,
   주기 경비 · 화물칸 점검(편별) 같은 반복 기록을 한 화면에서 남기고, 빠진 날(주기)을 찾는다.

   화면
   - 오늘: 양식별 이번 주기 기록 여부 · 누락 · 바로 기록(순찰은 '순찰 +1', 편별 양식은 '편 추가') — 모바일 우선
   - 기록 현황: 양식별 최근 주기 칸(완료 · 이상 · 누락 · 진행 중) · 누락 목록(사후 기록)
   - 기록 목록: 양식 · 월 · 이상만 · 검색 → 기록 열기 · 수정
   - 점검 양식(hq): 이름 · 종류(점검 · 순찰 · 편별 · 문서) · 주기 · 평일만 · 시작일 · 점검 항목 · 순찰 최소 횟수 · 체크리스트 번호

   데이터
     seclogCfg = { since, templates[{ id, name, kind(check|patrol|flight|doc), cycle(day|week|month|quarter|year|event),
                   days(all|weekday), from, items[{ id, text }], rounds, photo, evidence[], active, order, note }] }
       — 점검 항목 문구는 규정(민감보안정보)에서 오므로 코드에 두지 않고 공용 DB에만 둔다(코드 기본값은 양식 뼈대뿐).
     seclog = [{ id, tid, date, time, by, checks[{ t, v(ok|ng|na) }], result(ok|ng), note, action,
                 rounds[{ t, by, note }], flight{ no, reg, dest }, files[], createdAt/By, updatedAt/By }]
       — 점검 항목은 기록할 때 문구째 남긴다(양식을 고쳐도 옛 기록은 그때 점검한 그대로).
   권한: 열람 · 기록 mgr(권한표 seclog 2/2) · 양식 hq(seclogCfg 2/3). 파일: 비공개 버킷 seclog/ 폴더(열람 2 · 올리기 2).
   수검 대응 센터 증빙: window.SemisEvidence.inspection(mid) → { ok, text } (2.7 · 4.1~4.3 · 5.3 · 5.4 · 7.2 · 7.6 · 9.1.2 · 9.4 · 9.6)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "inspection";
  const KEY = "seclog", CFG = "seclogCfg";
  const TITLE = "보안 기록부";
  const FOLDER = "seclog";
  const FILE_MAX = 50 * 1024 * 1024;
  const LS_BY = "semisl:seclogBy";
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "", fixedNow = "";
  const todayISO = () => fixedToday || toISO(new Date());
  const nowHM = () => fixedNow || (p2(new Date().getHours()) + ":" + p2(new Date().getMinutes()));
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const isHM = (s) => /^\d{2}:\d{2}$/.test(String(s || ""));
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const fromUTC = (t) => { const d = new Date(t); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()); };
  const addDays = (iso, n) => fromUTC(utc(iso) + n * 86400000);
  const dow = (iso) => new Date(utc(iso)).getUTCDay();          // 0 일 ~ 6 토
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const me = () => (SeMIS.user && SeMIS.user.name) || "";
  const filesOf = (a) => (Array.isArray(a) ? a.filter(f => f && f.url) : []);
  const WD = ["일", "월", "화", "수", "목", "금", "토"];

  /* ─────── 양식 뼈대 (점검 항목은 공용 DB에서 hq가 채운다) ─────── */
  const KINDS = { check: "점검", patrol: "순찰", flight: "편별", doc: "문서" };
  const CYCLES = { day: "매일", week: "매주", month: "매월", quarter: "분기", year: "연 1회 이상", event: "수시" };
  const DEF_TEMPLATES = [
    { id: "t-daily", name: "일일 보안점검", kind: "check", cycle: "day", days: "all", evidence: ["2.7", "4.3", "5.3"] },
    { id: "t-patrol", name: "보안 브리핑 · 순찰", kind: "patrol", cycle: "day", days: "all", rounds: 0, evidence: ["5.4"] },
    { id: "t-uld", name: "ULD · 화물장비 적재 전 확인", kind: "check", cycle: "day", days: "all", evidence: ["7.2", "7.6"] },
    { id: "t-hazmat", name: "위해물품 월간 점검", kind: "check", cycle: "month", evidence: ["4.2", "4.3"] },
    { id: "t-regular", name: "정기 보안점검", kind: "check", cycle: "quarter", evidence: ["2.7"] },
    { id: "t-surprise", name: "불시 보안점검", kind: "check", cycle: "year", evidence: ["2.7"] },
    { id: "t-selfaudit", name: "Quarterly Self-Audit (미주행)", kind: "check", cycle: "quarter", photo: false, evidence: ["9.1.2"] },
    { id: "t-guard", name: "주기 경비 (미주행)", kind: "flight", cycle: "event", evidence: ["9.4"] },
    { id: "t-hold", name: "화물칸 보안 점검 (미주행)", kind: "flight", cycle: "event", evidence: ["9.6"] },
    { id: "t-appoint", name: "위해물품 관리책임자 지정", kind: "doc", cycle: "year", evidence: ["4.1"] }
  ];
  const cycLabel = (t) => t.kind === "flight" ? "편별" : t.cycle === "day" && t.days === "weekday" ? "평일" : CYCLES[t.cycle];
  /* 누락을 찾는 기간(최근 주기 수) */
  const WINDOW = { day: 30, week: 13, month: 12, quarter: 4, year: 2 };
  const EVENT_DAYS = { flight: 30, doc: 365, check: 365, patrol: 30 };

  /* ─────── 데이터 ─────── */
  function cfg() {
    let c = D()[CFG];
    if (!c || typeof c !== "object" || Array.isArray(c)) c = D()[CFG] = { since: "", templates: [] };
    if (!Array.isArray(c.templates)) c.templates = [];
    return c;
  }
  /* 누락을 세기 시작하는 날 — 양식 저장 때 정한 날, 없으면 첫 기록일(기록을 시작한 날), 그것도 없으면 오늘 */
  function since() {
    const c = D()[CFG];
    if (c && isISO(c.since)) return c.since;
    const ds = logs().map(r => r.date).sort();
    return ds[0] || todayISO();
  }
  function fixT(t, i) {
    const x = Object.assign({ kind: "check", cycle: "day", days: "all", from: "", items: [], rounds: 0, photo: true, evidence: [], active: true, order: i, note: "" }, t);
    if (!KINDS[x.kind]) x.kind = "check";
    if (!CYCLES[x.cycle]) x.cycle = "day";
    if (x.kind === "flight") x.cycle = "event";
    x.items = (Array.isArray(x.items) ? x.items : []).filter(it => it && norm(it.text)).map(it => ({ id: it.id || uid("i"), text: norm(it.text) }));
    x.evidence = (Array.isArray(x.evidence) ? x.evidence : []).map(norm).filter(Boolean);
    x.rounds = Math.max(0, Math.round(Number(x.rounds) || 0));
    return x;
  }
  function templates(all) {
    const c = D()[CFG];
    const list = c && Array.isArray(c.templates) && c.templates.length ? c.templates : DEF_TEMPLATES;
    return list.filter(t => t && t.id && t.name).map(fixT).filter(t => all || t.active !== false)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }
  const tplOf = (id) => templates(true).find(t => t.id === id) || null;
  const logs = () => (Array.isArray(D()[KEY]) ? D()[KEY] : []).filter(r => r && r.id && r.tid && isISO(r.date));
  function list() { let a = D()[KEY]; if (!Array.isArray(a)) a = D()[KEY] = []; return a; }
  const checksOf = (r) => (Array.isArray(r.checks) ? r.checks : []);
  const roundsOf = (r) => (Array.isArray(r.rounds) ? r.rounds : []).filter(x => x && isHM(x.t));
  const isNG = (r) => r.result === "ng" || checksOf(r).some(c => c && c.v === "ng");

  /* ─────── 주기 ─────── */
  function monday(iso) { const d = dow(iso); return addDays(iso, d === 0 ? -6 : 1 - d); }
  function periodOf(t, iso) {
    switch (t.cycle) {
      case "week": return "W" + monday(iso);
      case "month": return iso.slice(0, 7);
      case "quarter": return iso.slice(0, 4) + "-Q" + (Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1);
      case "year": return iso.slice(0, 4);
      case "event": return iso;
      default: return iso;
    }
  }
  function periodLabel(t, k) {
    if (t.cycle === "week") return dot(k.slice(6)) + " 주";
    if (t.cycle === "month") return k.slice(0, 4) + "." + k.slice(5, 7);
    if (t.cycle === "quarter") return k.slice(0, 4) + " " + k.slice(-1) + "분기";
    if (t.cycle === "year") return k + "년";
    return dot(k.slice(5)) + "(" + WD[dow(k)] + ")";
  }
  /* 주기의 첫날 — 사후 기록 날짜 기본값 */
  function periodStart(t, k) {
    if (t.cycle === "week") return k.slice(1);
    if (t.cycle === "month") return k + "-01";
    if (t.cycle === "quarter") return k.slice(0, 4) + "-" + p2((Number(k.slice(-1)) - 1) * 3 + 1) + "-01";
    if (t.cycle === "year") return k + "-01-01";
    return k;
  }
  /* 오늘로부터 최근 n개 주기(오래된 것 → 이번 주기). 평일만 양식은 주말을 건너뛴다 */
  function periodsBack(t, today, n) {
    const out = [];
    if (t.cycle === "day") {
      let d = today;
      for (let guard = 0; out.length < n && guard < n * 3; guard++, d = addDays(d, -1)) {
        if (t.days === "weekday" && (dow(d) === 0 || dow(d) === 6)) continue;
        out.unshift(d);
      }
      return out;
    }
    let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    if (t.cycle === "week") { let w = monday(today); for (let i = 0; i < n; i++, w = addDays(w, -7)) out.unshift("W" + w); return out; }
    if (t.cycle === "month") { for (let i = 0; i < n; i++) { out.unshift(y + "-" + p2(m)); m--; if (!m) { m = 12; y--; } } return out; }
    if (t.cycle === "quarter") { let q = Math.floor((m - 1) / 3) + 1; for (let i = 0; i < n; i++) { out.unshift(y + "-Q" + q); q--; if (!q) { q = 4; y--; } } return out; }
    if (t.cycle === "year") { for (let i = 0; i < n; i++) out.unshift(String(y - i)); return out; }
    return out;
  }
  /* 한 주기의 기록 완료 판정 — 순찰은 최소 횟수 이상 */
  function doneIn(t, rs) {
    if (!rs.length) return false;
    if (t.kind === "patrol" && t.rounds > 0) return rs.reduce((n, r) => n + roundsOf(r).length, 0) >= t.rounds;
    return true;
  }
  /* 양식 상태: 최근 주기 · 누락 · 이번 주기 완료 여부 (시작일 이전 주기는 보지 않는다) */
  function status(t, today) {
    today = today || todayISO();
    const rs = logs().filter(r => r.tid === t.id);
    if (t.cycle === "event") {
      const days = EVENT_DAYS[t.kind] || 30;
      const from = addDays(today, -(days - 1));
      const recent = rs.filter(r => r.date >= from && r.date <= today);
      return { event: true, days, recent, count: recent.length, ng: recent.filter(isNG).length, last: rs.map(r => r.date).sort().pop() || "" };
    }
    const start = isISO(t.from) ? t.from : since();
    const cur = periodOf(t, today);
    const first = periodOf(t, start);
    const keys = periodsBack(t, today, WINDOW[t.cycle] || 30).filter(k => k >= first);
    const by = {};
    rs.forEach(r => { const k = periodOf(t, r.date); (by[k] = by[k] || []).push(r); });
    const cells = keys.map(k => {
      const g = by[k] || [];
      const done = doneIn(t, g);
      return { k, cur: k === cur, done, part: !done && g.length > 0, ng: g.some(isNG), rs: g };
    });
    const past = cells.filter(c => !c.cur);
    const missing = past.filter(c => !c.done);
    const curCell = cells.find(c => c.cur) || { k: cur, cur: true, done: doneIn(t, by[cur] || []), rs: by[cur] || [] };
    return { cells, past, missing, cur: curCell, ng: cells.filter(c => c.ng).length, last: rs.map(r => r.date).sort().pop() || "" };
  }
  const missCount = (today) => templates().reduce((n, t) => { const s = status(t, today); return n + (s.event ? 0 : s.missing.length); }, 0);

  /* ─────── 수검 대응 센터 증빙 연결 ───────
     체크리스트 번호에 연결된 양식이 최근 주기에 빠짐없이 기록됐는지(편별 · 문서는 기간 안 기록이 있는지). 번호만 쓰고 원문은 쓰지 않는다. */
  function evidence(mid) {
    mid = String(mid || "");
    const ts = templates().filter(t => t.evidence.indexOf(mid) >= 0);
    if (!ts.length) return null;
    const today = todayISO();
    const parts = ts.map(t => {
      const s = status(t, today);
      if (s.event) return { ok: s.count > 0, text: `${t.name} ${s.count}건(${s.days === 365 ? "1년" : s.days + "일"})` };
      const n = s.past.length, k = n - s.missing.length;
      if (!n) return { ok: s.cur.done, text: `${t.name} ${s.cur.done ? "이번 주기 기록" : "기록 없음"}` };
      return { ok: s.missing.length === 0, text: `${t.name} ${k}/${n}${t.cycle === "day" ? "일" : t.cycle === "week" ? "주" : t.cycle === "month" ? "개월" : t.cycle === "quarter" ? "분기" : "년"}` };
    });
    return { ok: parts.every(p => p.ok), text: parts.map(p => p.text).join(" · ") };
  }
  if (typeof window !== "undefined") (window.SemisEvidence = window.SemisEvidence || {})[MOD] = evidence;

  /* ─────── 화면 상태 ─────── */
  let tab = "today", q = "", fTid = "", fMonth = "", fNG = false;
  const TABS = [["today", "오늘"], ["status", "기록 현황"], ["list", "기록 목록"]];
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "") || "dashboard";
  const canW = () => !!SeMIS.user && SeMIS.roleRank() >= 2 && SeMIS.user.role !== "vendor";
  const hay = (a) => a.map(v => String(v || "")).join(" ").toLowerCase();
  function fileChips(files) {
    return filesOf(files).map(f => `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>`).join("");
  }
  const evTags = (t) => t.evidence.length ? `<span class="sl-ev mono" title="수검 체크리스트 번호">${esc(t.evidence.join(" · "))}</span>` : "";

  /* ═════════ 오늘 ═════════ */
  function todayHTML() {
    const t0 = todayISO();
    const ts = templates();
    const st = ts.map(t => ({ t, s: status(t, t0) }));
    const due = st.filter(x => !x.s.event && !x.s.cur.done).length;
    const miss = st.reduce((n, x) => n + (x.s.event ? 0 : x.s.missing.length), 0);
    const todayN = logs().filter(r => r.date === t0).length;
    const ng = logs().filter(r => r.date >= addDays(t0, -29) && isNG(r)).length;
    return ui.stats([
      { label: "이번 주기 미기록", value: due, sub: "양식 " + ts.filter(t => t.cycle !== "event").length + "종 중", tone: due ? "warn" : "ok" },
      { label: "누락", value: miss, sub: "지난 주기", tone: miss ? "bad" : "ok" },
      { label: "오늘 기록", value: todayN, sub: dot(t0) + "(" + WD[dow(t0)] + ")" },
      { label: "이상 (30일)", value: ng, tone: ng ? "warn" : "muted" }
    ]) + (ts.length ? `<div class="sl-cards">${st.map(x => cardHTML(x.t, x.s, t0)).join("")}</div>` : ui.empty("사용 중인 점검 양식이 없습니다."));
  }
  function cardHTML(t, s, t0) {
    const w = canW();
    let state, tone, sub = "";
    if (s.event) {
      state = s.count ? `최근 ${s.days === 365 ? "1년" : s.days + "일"} ${s.count}건` : "기록 없음";
      tone = s.count ? "ok" : "none";
      sub = s.last ? "최근 " + dot(s.last) : "";
    } else {
      const cur = s.cur;
      const lb = t.cycle === "day" ? "오늘" : t.cycle === "week" ? "이번 주" : t.cycle === "month" ? "이번 달" : t.cycle === "quarter" ? "이번 분기" : "올해";
      if (t.kind === "patrol") {
        const n = cur.rs.reduce((a, r) => a + roundsOf(r).length, 0);
        const lastT = cur.rs.map(r => roundsOf(r).map(x => x.t)).reduce((a, b) => a.concat(b), []).sort().pop();
        state = `${lb} ${n}회${t.rounds ? " / " + t.rounds : ""}`; tone = cur.done ? "ok" : n ? "part" : "none";
        sub = lastT ? "마지막 " + lastT : "";
      } else {
        state = cur.done ? `${lb} 기록` : `${lb} 미기록`; tone = cur.done ? (cur.ng ? "ng" : "ok") : "none";
        sub = cur.done ? cur.rs.map(r => r.by).filter(Boolean).slice(0, 2).join(", ") : "";
      }
      if (s.missing.length) sub = (sub ? sub + " · " : "") + `누락 ${s.missing.length}`;
    }
    const btn = !w ? "" : t.kind === "patrol"
      ? `<button type="button" class="btn btn-primary btn-sm" data-sl-round="${esc(t.id)}">${icon("plus", 15)}<span>순찰 기록</span></button>`
      : `<button type="button" class="btn ${s.event || !s.cur.done ? "btn-primary" : "btn-ghost"} btn-sm" data-sl-new="${esc(t.id)}">${icon("plus", 15)}<span>${t.kind === "flight" ? "편 추가" : s.event || !s.cur.done ? "기록" : "추가 기록"}</span></button>`;
    return `<section class="sl-card" data-tone="${tone}" data-tid="${esc(t.id)}">
      <div class="sl-card-h"><b>${esc(t.name)}</b><span class="sl-cyc">${esc(cycLabel(t))}</span></div>
      <div class="sl-card-s"><span class="sl-dot" aria-hidden="true"></span><span>${esc(state)}</span></div>
      ${sub ? `<div class="sl-card-sub">${esc(sub)}</div>` : ""}
      <div class="sl-card-f">${evTags(t)}<span class="spacer"></span>${btn}</div>
    </section>`;
  }

  /* ═════════ 기록 현황 ═════════ */
  function statusHTML() {
    const t0 = todayISO();
    const ts = templates();
    return `<section class="card" id="sl-status">
      <div class="sl-legend"><span data-c="ok">기록</span><span data-c="ng">이상 있음</span><span data-c="part">일부</span><span data-c="miss">누락</span><span data-c="cur">진행 중</span></div>
      ${ts.length ? ts.map(t => {
        const s = status(t, t0);
        if (s.event) return `<div class="sl-row"><div class="sl-row-h"><b>${esc(t.name)}</b><span class="sl-cyc">편별 · 수시</span>${evTags(t)}</div>
          <div class="sl-row-b">${s.count ? `최근 ${s.days === 365 ? "1년" : s.days + "일"} <b class="mono">${s.count}</b>건${s.ng ? ` · 이상 <b class="mono">${s.ng}</b>` : ""} · 최근 ${esc(dot(s.last))}` : "기록 없음"}</div></div>`;
        const k = s.past.length - s.missing.length;
        return `<div class="sl-row"><div class="sl-row-h"><b>${esc(t.name)}</b><span class="sl-cyc">${esc(cycLabel(t))}</span>${evTags(t)}
            <span class="spacer"></span><span class="sl-rate mono">${s.past.length ? k + "/" + s.past.length : "-"}</span></div>
          <div class="sl-strip" role="list">${s.cells.map(c => {
            const cls = c.cur ? (c.done ? (c.ng ? "ng" : "ok") : "cur") : c.done ? (c.ng ? "ng" : "ok") : c.part ? "part" : "miss";
            const lab = periodLabel(t, c.k) + " · " + ({ ok: "기록", ng: "이상 있음", part: "일부", miss: "누락", cur: "진행 중" })[cls];
            return `<button type="button" class="sl-cell" role="listitem" data-c="${cls}" data-sl-cell="${esc(t.id)}|${esc(c.k)}" title="${esc(lab)}" aria-label="${esc(lab)}"></button>`;
          }).join("")}</div>
          ${s.missing.length ? `<div class="sl-miss"><span>누락</span>${s.missing.slice(-8).map(c => canW()
            ? `<button type="button" class="sl-mbtn mono" data-sl-late="${esc(t.id)}|${esc(c.k)}">${esc(periodLabel(t, c.k))}</button>`
            : `<span class="mono">${esc(periodLabel(t, c.k))}</span>`).join("")}${s.missing.length > 8 ? `<span class="cell-sub">외 ${s.missing.length - 8}</span>` : ""}</div>` : ""}
        </div>`;
      }).join("") : ui.empty("사용 중인 점검 양식이 없습니다.")}
    </section>`;
  }

  /* ═════════ 기록 목록 ═════════ */
  function listRows() {
    return logs().filter(r => {
      if (fTid && r.tid !== fTid) return false;
      if (fMonth && r.date.slice(0, 7) !== fMonth) return false;
      if (fNG && !isNG(r)) return false;
      if (!q) return true;
      const t = tplOf(r.tid);
      return hay([t && t.name, r.by, r.note, r.action, r.flight && r.flight.no, r.flight && r.flight.reg, r.date]).indexOf(q.toLowerCase()) >= 0;
    }).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
  }
  function listBodyHTML() {
    const rows = listRows();
    if (!rows.length) return ui.empty(logs().length ? "조건에 맞는 기록이 없습니다." : "등록된 기록이 없습니다.");
    return `<div class="table-wrap"><table class="tbl tbl-cap sl-tbl" style="--cap:1320px">
      <thead><tr><th>일자</th><th>양식</th><th>점검자</th><th>결과</th><th>내용</th></tr></thead>
      <tbody>${rows.slice(0, 400).map(r => {
        const t = tplOf(r.tid);
        const rr = roundsOf(r);
        const ch = checksOf(r);
        const ng = ch.filter(c => c.v === "ng").length;
        const what = [r.flight && r.flight.no ? r.flight.no + (r.flight.reg ? " · " + r.flight.reg : "") : "",
          rr.length ? `순찰 ${rr.length}회 (${rr.map(x => x.t).sort().join(", ")})` : "", ch.length ? `항목 ${ch.length}${ng ? " · 이상 " + ng : ""}` : "",
          r.note].filter(Boolean).join(" · ");
        return `<tr data-slid="${esc(r.id)}" tabindex="0" class="is-click">
          <td class="c-date"><span class="mono">${esc(dot(r.date))}</span>${r.time ? `<div class="cell-sub mono">${esc(r.time)}</div>` : ""}</td>
          <td class="c-name"><b>${esc(t ? t.name : "삭제된 양식")}</b></td>
          <td class="c-by">${esc(r.by || "-")}</td>
          <td class="c-res">${isNG(r) ? ui.chip("이상", "amber") : ui.chip("적합", "green")}${filesOf(r.files).length ? ` <span class="cell-sub">${icon("link", 13)} ${filesOf(r.files).length}</span>` : ""}</td>
          <td class="c-what">${esc(what || "-")}${r.action ? `<div class="cell-sub">조치: ${esc(r.action)}</div>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>${rows.length > 400 ? `<p class="au-none">최근 400건만 표시 — 월 · 양식으로 좁히세요.</p>` : ""}`;
  }
  function listHTML() {
    const months = Array.from(new Set(logs().map(r => r.date.slice(0, 7)))).sort().reverse();
    if (fMonth && months.indexOf(fMonth) < 0) fMonth = "";
    const ts = templates(true);
    return `<section class="card" id="sl-list">
      <div class="toolbar">
        ${ui.search("sl-q", "양식 · 점검자 · 편명 · 내용 검색", q)}
        <label class="ck-f"><span>양식</span><select id="sl-ftid"><option value="">전체</option>${ts.map(t => `<option value="${esc(t.id)}" ${fTid === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        ${months.length ? `<label class="ck-f"><span>월</span><select id="sl-fmon"><option value="">전체</option>${months.map(m => `<option value="${m}" ${fMonth === m ? "selected" : ""}>${m.replace("-", ".")}</option>`).join("")}</select></label>` : ""}
        <button type="button" class="pb-chk" id="sl-fng" aria-pressed="${fNG}">${icon("alert", 14)}<span>이상만</span></button>
      </div>
      <div id="sl-lbody">${listBodyHTML()}</div>
    </section>`;
  }

  /* ═════════ 기록 입력 ═════════ */
  function byDefault() {
    try { const v = localStorage.getItem(LS_BY); if (v) return v; } catch (e) { /* 저장소 없음 */ }
    return "";
  }
  function rememberBy(v) { try { if (v) localStorage.setItem(LS_BY, v); } catch (e) { /* 무시 */ } }
  const byNames = () => Array.from(new Set(logs().map(r => norm(r.by)).filter(Boolean))).slice(0, 40);
  async function uploadInto(files, fileList, done) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of arr) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("올리는 중: " + file.name);
      try { const up = await SemisSync.uploadFile(file, FOLDER); files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url }); }
      catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }
  const segV = (name, cur) => `<div class="sl-seg" role="group" aria-label="${esc(name)}">${[["ok", "적합"], ["ng", "이상"], ["na", "해당 없음"]].map(([v, lb]) =>
    `<button type="button" data-v="${v}" aria-pressed="${cur === v}">${lb}</button>`).join("")}</div>`;

  /* 기록 폼 — tid 양식, rid 기존 기록(없으면 새로), preset { date } */
  function recordForm(tid, rid, preset) {
    if (!canW()) return;
    const x = rid ? logs().find(r => r.id === rid) : null;
    if (rid && !x) return;
    const t = tplOf(x ? x.tid : tid) || templates()[0];
    if (!t) return;
    const v = Object.assign({ date: (preset && preset.date) || todayISO(), time: x ? "" : nowHM(), by: byDefault(), checks: null, result: "ok",
      note: "", action: "", rounds: [], flight: { no: "", reg: "", dest: "" }, files: [] }, x ? JSON.parse(JSON.stringify(x)) : {});
    /* 점검 항목: 기존 기록은 그때 문구 그대로, 새 기록은 양식 항목 */
    let checks = x && checksOf(x).length ? checksOf(x).map(c => ({ t: c.t, v: c.v })) : t.items.map(it => ({ t: it.text, v: "" }));
    const files = filesOf(v.files).map(f => Object.assign({}, f));
    const rounds = roundsOf(v).map(r => Object.assign({}, r));
    const fl = Object.assign({ no: "", reg: "", dest: "" }, v.flight || {});
    const canDel = !!x && SeMIS.canEdit();
    openModal(`<h3>${x ? "기록 수정" : "기록"} <small class="au-mh">${esc(t.name)}</small></h3>
      <div class="form-grid">
        <div class="form-row"><label for="sl-date">일자</label><input type="date" id="sl-date" value="${esc(v.date)}" max="${esc(todayISO())}"></div>
        <div class="form-row"><label for="sl-time">시각</label><input type="time" id="sl-time" value="${esc(v.time || "")}"></div>
      </div>
      <div class="form-row"><label for="sl-by">점검자</label><input id="sl-by" value="${esc(v.by || "")}" maxlength="40" autocomplete="off" list="sl-dl-by"></div>
      ${t.kind === "flight" ? `<div class="form-grid sl-g3">
        <div class="form-row"><label for="sl-fno">편명</label><input id="sl-fno" value="${esc(fl.no)}" maxlength="12" autocomplete="off" placeholder="KJ000"></div>
        <div class="form-row"><label for="sl-freg">등록부호</label><input id="sl-freg" value="${esc(fl.reg)}" maxlength="10" autocomplete="off" placeholder="HL0000"></div>
        <div class="form-row"><label for="sl-fdst">목적지</label><input id="sl-fdst" value="${esc(fl.dest)}" maxlength="10" autocomplete="off"></div></div>` : ""}
      ${t.kind === "patrol" ? `<div class="form-row"><label>순찰${t.rounds ? ` <span class="cell-sub">(하루 ${t.rounds}회 이상)</span>` : ""}</label>
        <div id="sl-rounds" class="sl-rounds"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="sl-radd">${icon("plus", 15)}<span>순찰 추가</span></button></div>` : ""}
      ${checks.length ? `<div class="form-row"><label>점검 항목 <button type="button" class="sl-allok" id="sl-allok">모두 적합</button></label>
        <ol class="sl-checks" id="sl-checks">${checks.map((c, i) => `<li data-ci="${i}"><span class="sl-ct">${esc(c.t)}</span>${segV("항목 " + (i + 1), c.v)}</li>`).join("")}</ol></div>`
        : `<div class="form-row"><label>결과</label><div id="sl-result">${segV("결과", v.result === "ng" ? "ng" : "ok")}</div></div>`}
      <div class="form-row sl-ngbox${isNG(Object.assign({}, v, { checks })) ? "" : " hidden"}" id="sl-ngbox"><label for="sl-action">이상 내용 · 조치</label>
        <textarea id="sl-action" rows="2" maxlength="1000">${esc(v.action || "")}</textarea></div>
      <div class="form-row"><label for="sl-note">메모</label><textarea id="sl-note" rows="2" maxlength="1000">${esc(v.note || "")}</textarea></div>
      <div class="form-row"><label>사진 · 파일</label>
        <div class="au-files au-files-edit" id="sl-files"></div>
        <input type="file" id="sl-cam" accept="image/*" capture="environment" hidden>
        <input type="file" id="sl-file" multiple hidden>
        <div class="sl-fbtns">${t.photo !== false ? `<button type="button" class="btn btn-ghost btn-sm" id="sl-cbtn">${icon("scan", 15)}<span>사진 찍기</span></button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" id="sl-fbtn">${icon("link", 15)}<span>파일 올리기</span></button></div></div>
      <datalist id="sl-dl-by">${byNames().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="modal-actions">
        ${canDel ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`, { wide: true });
    const ngNow = () => checks.some(c => c.v === "ng") || (!checks.length && $("#sl-result [aria-pressed=true]") && $("#sl-result [aria-pressed=true]").dataset.v === "ng");
    const syncNG = () => $("#sl-ngbox").classList.toggle("hidden", !ngNow());
    $$("#sl-checks li").forEach(li => $$("[data-v]", li).forEach(b => b.onclick = () => {
      const i = Number(li.dataset.ci);
      checks[i].v = checks[i].v === b.dataset.v ? "" : b.dataset.v;
      $$("[data-v]", li).forEach(o => o.setAttribute("aria-pressed", String(o.dataset.v === checks[i].v)));
      syncNG();
    }));
    const allok = $("#sl-allok");
    if (allok) allok.onclick = () => { checks.forEach((c, i) => { if (!c.v) c.v = "ok"; const li = $(`#sl-checks li[data-ci="${i}"]`); $$("[data-v]", li).forEach(o => o.setAttribute("aria-pressed", String(o.dataset.v === c.v))); }); syncNG(); };
    $$("#sl-result [data-v]").forEach(b => b.onclick = () => { $$("#sl-result [data-v]").forEach(o => o.setAttribute("aria-pressed", String(o === b))); syncNG(); });
    const paintRounds = () => {
      const box = $("#sl-rounds");
      if (!box) return;
      rounds.sort((a, b) => a.t.localeCompare(b.t));
      box.innerHTML = rounds.length ? rounds.map((r, i) => `<div class="sl-round"><input type="time" data-rt="${i}" value="${esc(r.t)}" aria-label="순찰 시각">
        <input data-rb="${i}" value="${esc(r.by || "")}" maxlength="40" placeholder="순찰자" list="sl-dl-by" aria-label="순찰자">
        <input data-rn="${i}" value="${esc(r.note || "")}" maxlength="200" placeholder="특이사항" aria-label="특이사항">
        <button type="button" class="mt-btn danger" data-rdel="${i}" aria-label="순찰 빼기">${icon("x", 14)}</button></div>`).join("") : '<p class="au-none">순찰 기록이 없습니다.</p>';
      $$("[data-rt]", box).forEach(el => el.onchange = () => { if (isHM(el.value)) rounds[Number(el.dataset.rt)].t = el.value; });
      $$("[data-rb]", box).forEach(el => el.oninput = () => { rounds[Number(el.dataset.rb)].by = norm(el.value); });
      $$("[data-rn]", box).forEach(el => el.oninput = () => { rounds[Number(el.dataset.rn)].note = norm(el.value); });
      $$("[data-rdel]", box).forEach(b => b.onclick = () => { rounds.splice(Number(b.dataset.rdel), 1); paintRounds(); });
    };
    paintRounds();
    const radd = $("#sl-radd");
    if (radd) radd.onclick = () => { rounds.push({ t: nowHM(), by: norm($("#sl-by").value), note: "" }); paintRounds(); };
    const paintFiles = () => {
      const box = $("#sl-files");
      box.innerHTML = files.map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a><button type="button" class="mt-btn danger" data-fdel="${i}" aria-label="첨부 빼기">${icon("x", 14)}</button></span>`).join("");
      $$("[data-fdel]", box).forEach(b => b.onclick = () => { files.splice(Number(b.dataset.fdel), 1); paintFiles(); });
    };
    paintFiles();
    [["#sl-cbtn", "#sl-cam"], ["#sl-fbtn", "#sl-file"]].forEach(([bs, is]) => {
      const b = $(bs), inp = $(is);
      if (b && inp) { b.onclick = () => inp.click(); inp.onchange = () => { const fl2 = Array.from(inp.files || []); inp.value = ""; uploadInto(files, fl2, paintFiles); }; }
    });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const date = $("#sl-date").value, time = $("#sl-time").value;
      if (!isISO(date)) { toast("일자를 입력하세요.", true); $("#sl-date").focus(); return; }
      if (date > todayISO()) { toast("앞으로의 날짜에는 기록할 수 없습니다.", true); return; }
      const by = norm($("#sl-by").value);
      if (!by) { toast("점검자를 입력하세요.", true); $("#sl-by").focus(); return; }
      if (checks.length && checks.some(c => !c.v)) { toast("점검 항목의 결과를 모두 고르세요.", true); return; }
      if (t.kind === "flight" && !norm($("#sl-fno").value)) { toast("편명을 입력하세요.", true); $("#sl-fno").focus(); return; }
      if (t.kind === "patrol" && !rounds.length) { toast("순찰을 하나 이상 추가하세요.", true); return; }
      const res = checks.length ? (checks.some(c => c.v === "ng") ? "ng" : "ok") : ($("#sl-result [aria-pressed=true]") || { dataset: { v: "ok" } }).dataset.v;
      const rec = {
        tid: t.id, date, time: isHM(time) ? time : "", by, checks: checks.map(c => ({ t: c.t, v: c.v })), result: res,
        action: res === "ng" ? norm($("#sl-action").value) : "", note: norm($("#sl-note").value), files: files.slice(),
        rounds: t.kind === "patrol" ? rounds.filter(r => isHM(r.t)).map(r => ({ t: r.t, by: norm(r.by), note: norm(r.note) })) : [],
        flight: t.kind === "flight" ? { no: norm($("#sl-fno").value).toUpperCase(), reg: norm($("#sl-freg").value).toUpperCase(), dest: norm($("#sl-fdst").value).toUpperCase() } : null
      };
      if (!rec.flight) delete rec.flight;
      const arr = list();
      if (x) { Object.assign(x, rec); x.updatedAt = new Date().toISOString(); x.updatedBy = me(); }
      else arr.push(Object.assign({ id: uid("sl"), createdAt: new Date().toISOString(), createdBy: me() }, rec));
      rememberBy(by);
      SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`${t.name} ${dot(x.date)} 기록을 삭제합니다.`, () => {
      D()[KEY] = list().filter(r => r.id !== x.id);
      SeMIS.save(); paint(); toast("삭제했습니다.");
    });
  }
  /* 순찰 +1 — 오늘 순찰 기록에 지금 시각을 더한다(없으면 새 기록) */
  function quickRound(tid) {
    if (!canW()) return;
    const t = tplOf(tid);
    if (!t) return;
    const t0 = todayISO();
    const cur = logs().find(r => r.tid === t.id && r.date === t0);
    openModal(`<h3>순찰 기록 <small class="au-mh">${esc(t.name)} · ${esc(dot(t0))}</small></h3>
      <div class="form-grid">
        <div class="form-row"><label for="sl-qt">시각</label><input type="time" id="sl-qt" value="${esc(nowHM())}"></div>
        <div class="form-row"><label for="sl-qb">순찰자</label><input id="sl-qb" value="${esc(byDefault())}" maxlength="40" autocomplete="off" list="sl-dl-by"></div>
      </div>
      <div class="form-row"><label for="sl-qn">특이사항</label><input id="sl-qn" maxlength="200" autocomplete="off"></div>
      ${cur ? `<p class="cell-sub">오늘 ${roundsOf(cur).length}회 기록됨${roundsOf(cur).length ? " — " + esc(roundsOf(cur).map(r => r.t).sort().join(", ")) : ""}</p>` : ""}
      <datalist id="sl-dl-by">${byNames().map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="modal-actions">
        ${cur ? '<button type="button" class="btn btn-ghost" data-act="full">전체 기록 열기</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const full = $("#modal-box [data-act=full]");
    if (full) full.onclick = () => recordForm(t.id, cur.id);
    $("#modal-box [data-act=ok]").onclick = () => {
      const tm = $("#sl-qt").value, by = norm($("#sl-qb").value);
      if (!isHM(tm)) { toast("시각을 입력하세요.", true); return; }
      if (!by) { toast("순찰자를 입력하세요.", true); $("#sl-qb").focus(); return; }
      const round = { t: tm, by, note: norm($("#sl-qn").value) };
      let rec = logs().find(r => r.tid === t.id && r.date === t0);
      if (rec) { rec.rounds = roundsOf(rec).concat([round]).sort((a, b) => a.t.localeCompare(b.t)); rec.updatedAt = new Date().toISOString(); rec.updatedBy = me(); }
      else list().push({ id: uid("sl"), tid: t.id, date: t0, time: tm, by, checks: [], result: "ok", note: "", action: "", files: [],
        rounds: [round], createdAt: new Date().toISOString(), createdBy: me() });
      rememberBy(by);
      SeMIS.save(); closeModal(); paint(); toast("순찰을 기록했습니다.");
    };
  }
  /* 기록 현황 칸 누르기 — 그 주기의 기록이 있으면 열고, 없으면 사후 기록 */
  function openCell(key) {
    const i = String(key || "").indexOf("|");
    const t = tplOf(key.slice(0, i)), k = key.slice(i + 1);
    if (!t) return;
    const rs = logs().filter(r => r.tid === t.id && periodOf(t, r.date) === k);
    if (rs.length === 1 && canW()) return recordForm(t.id, rs[0].id);
    if (rs.length) { tab = "list"; fTid = t.id; fMonth = rs[0].date.slice(0, 7); q = ""; SeMIS.renderView(); return; }
    if (canW()) recordForm(t.id, "", { date: t.cycle === "day" ? k : periodStart(t, k) > todayISO() ? todayISO() : periodStart(t, k) });
  }

  /* ═════════ 점검 양식 (hq) ═════════ */
  function templatesForm() {
    if (!SeMIS.canEdit()) return;
    const ts = templates(true).map(t => JSON.parse(JSON.stringify(t)));
    const used = (id) => logs().some(r => r.tid === id);
    const row = (t, i) => `<div class="sl-tpl" data-ti="${i}">
      <div class="sl-tpl-h"><input data-k="name" value="${esc(t.name)}" maxlength="40" aria-label="양식 이름">
        <label class="sl-on"><input type="checkbox" data-k="active" ${t.active !== false ? "checked" : ""}> 사용</label>
        ${used(t.id) ? "" : `<button type="button" class="mt-btn danger" data-tdel="${i}" aria-label="양식 삭제">${icon("x", 14)}</button>`}</div>
      <div class="sl-tpl-g">
        <label>종류<select data-k="kind">${Object.keys(KINDS).map(k => `<option value="${k}" ${t.kind === k ? "selected" : ""}>${KINDS[k]}</option>`).join("")}</select></label>
        <label>주기<select data-k="cycle">${Object.keys(CYCLES).map(k => `<option value="${k}" ${t.cycle === k ? "selected" : ""}>${CYCLES[k]}</option>`).join("")}</select></label>
        <label>요일<select data-k="days"><option value="all" ${t.days !== "weekday" ? "selected" : ""}>매일</option><option value="weekday" ${t.days === "weekday" ? "selected" : ""}>평일만</option></select></label>
        <label>시작일<input type="date" data-k="from" value="${esc(t.from || "")}"></label>
        <label>순찰 최소<input type="number" min="0" max="48" data-k="rounds" value="${esc(t.rounds || 0)}"></label>
        <label>체크리스트 번호<input data-k="evidence" value="${esc(t.evidence.join(", "))}" maxlength="60" placeholder="2.7, 4.3"></label>
      </div>
      <label class="sl-tpl-items">점검 항목 (한 줄에 하나)<textarea data-k="items" rows="3">${esc(t.items.map(it => it.text).join("\n"))}</textarea></label>
    </div>`;
    const paintRows = () => { $("#sl-tpls").innerHTML = ts.map(row).join(""); wireRows(); };
    const pull = () => $$("#sl-tpls .sl-tpl").forEach(el => {
      const t = ts[Number(el.dataset.ti)];
      $$("[data-k]", el).forEach(f => {
        const k = f.dataset.k;
        if (k === "active") t.active = f.checked;
        else if (k === "rounds") t.rounds = Math.max(0, Math.round(Number(f.value) || 0));
        else if (k === "evidence") t.evidence = f.value.split(/[,\s·]+/).map(norm).filter(s => /^\d+(\.\d+)*$/.test(s));
        else if (k === "items") {
          const old = t.items || [];
          t.items = f.value.split(/\n/).map(norm).filter(Boolean).map(text => ({ id: (old.find(o => o.text === text) || {}).id || uid("i"), text }));
        } else t[k] = k === "name" ? norm(f.value) : f.value;
      });
    });
    const wireRows = () => $$("[data-tdel]").forEach(b => b.onclick = () => { pull(); ts.splice(Number(b.dataset.tdel), 1); paintRows(); });
    openModal(`<h3>점검 양식</h3>
      <div class="sl-tpls" id="sl-tpls"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="sl-tadd">${icon("plus", 15)}<span>양식 추가</span></button>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    paintRows();
    $("#sl-tadd").onclick = () => { pull(); ts.push(fixT({ id: uid("t"), name: "", from: todayISO() }, ts.length)); paintRows(); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      pull();
      const out = ts.filter(t => t.name);
      if (!out.length) { toast("양식을 하나 이상 두세요.", true); return; }
      out.forEach((t, i) => { t.order = i; if (t.kind === "flight") t.cycle = "event"; });
      const since0 = since();                              // 첫 저장: 이미 쌓인 기록의 첫날부터(없으면 오늘)
      const c = cfg();
      if (!isISO(c.since)) c.since = since0;
      c.templates = out.map(fixT);
      SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }

  /* ═════════ 렌더 ═════════ */
  function bodyHTML() { return tab === "status" ? statusHTML() : tab === "list" ? listHTML() : todayHTML(); }
  function wire(box) {
    const qi = $("#sl-q", box);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const b = document.getElementById("sl-lbody");
      if (b) { b.innerHTML = listBodyHTML(); wire(b); } else paint();
    };
    const ft = $("#sl-ftid", box); if (ft) ft.onchange = () => { fTid = ft.value; paint(); };
    const fm = $("#sl-fmon", box); if (fm) fm.onchange = () => { fMonth = fm.value; paint(); };
    const fn = $("#sl-fng", box); if (fn) fn.onclick = () => { fNG = !fNG; paint(); };
    $$("[data-sl-new]", box).forEach(b => b.onclick = () => recordForm(b.dataset.slNew, ""));
    $$("[data-sl-round]", box).forEach(b => b.onclick = () => quickRound(b.dataset.slRound));
    $$("[data-sl-cell]", box).forEach(b => b.onclick = () => openCell(b.dataset.slCell));
    $$("[data-sl-late]", box).forEach(b => b.onclick = () => openCell(b.dataset.slLate));
    $$("tr[data-slid]", box).forEach(tr => {
      const open = (ev) => { if (ev && ev.target.closest("a")) return; if (canW()) recordForm("", tr.dataset.slid); else viewRecord(tr.dataset.slid); };
      tr.onclick = open;
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
  }
  function viewRecord(id) {
    const r = logs().find(x => x.id === id);
    if (!r) return;
    const t = tplOf(r.tid);
    openModal(`<h3>${esc(t ? t.name : "기록")} <small class="au-mh">${esc(dot(r.date))} ${esc(r.time || "")}</small></h3>
      <dl class="eqd-grid"><div><dt>점검자</dt><dd>${esc(r.by || "-")}</dd></div><div><dt>결과</dt><dd>${isNG(r) ? "이상" : "적합"}</dd></div></dl>
      ${checksOf(r).length ? `<ol class="sl-checks is-view">${checksOf(r).map(c => `<li><span class="sl-ct">${esc(c.t)}</span>${ui.chip({ ok: "적합", ng: "이상", na: "해당 없음" }[c.v] || "-", c.v === "ng" ? "amber" : c.v === "ok" ? "green" : "gray")}</li>`).join("")}</ol>` : ""}
      ${roundsOf(r).length ? `<p>순찰 ${roundsOf(r).map(x => esc(x.t + (x.by ? " " + x.by : ""))).join(", ")}</p>` : ""}
      ${r.action ? `<p>조치: ${esc(r.action)}</p>` : ""}${r.note ? `<p>${esc(r.note)}</p>` : ""}
      ${filesOf(r.files).length ? `<div class="au-files">${fileChips(r.files)}</div>` : ""}
      <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="cancel">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
  }
  function paint() {
    const box = document.getElementById("sl-body");
    if (!box) { if (routeNow() === MOD) SeMIS.renderView(); return; }
    box.innerHTML = bodyHTML();
    wire(box);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  }
  function render(root) {
    const act = [
      SeMIS.canEdit() ? `<button type="button" class="btn btn-ghost btn-sm" id="sl-tpl">${icon("sliders", 16)}<span>점검 양식</span></button>` : "",
      canW() ? `<button type="button" class="btn btn-primary btn-sm" id="sl-add">${icon("plus", 16)}<span>기록</span></button>` : ""
    ].join("");
    root.innerHTML = ui.head({ title: TITLE, meta: "일일 · 정기 · 불시 점검 · 순찰 · 편별 점검", actions: act })
      + `<div class="eq-tabs" role="tablist" aria-label="보안 기록부 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-sltab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>`
      + `<div id="sl-body">${bodyHTML()}</div>`;
    $$("[data-sltab]", root).forEach(b => b.onclick = () => { tab = b.dataset.sltab; SeMIS.renderView(); });
    const tb = $("#sl-tpl", root); if (tb) tb.onclick = templatesForm;
    const ab = $("#sl-add", root); if (ab) ab.onclick = () => pickTemplate();
    wire(root);
  }
  /* 머리말 '기록' — 양식 고르기 */
  function pickTemplate() {
    const ts = templates();
    if (!ts.length) { toast("사용 중인 점검 양식이 없습니다.", true); return; }
    openModal(`<h3>기록할 양식</h3><div class="sl-pick">${ts.map(t => `<button type="button" class="sl-pbtn" data-pick="${esc(t.id)}"><b>${esc(t.name)}</b><span>${esc(cycLabel(t))}</span></button>`).join("")}</div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $$("[data-pick]").forEach(b => b.onclick = () => { const t = tplOf(b.dataset.pick); if (t && t.kind === "patrol") quickRound(t.id); else recordForm(b.dataset.pick, ""); });
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const n = templates().filter(t => { const s = status(t); return !s.event && s.missing.length; }).length; return n || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "clipboard", module: MOD,
    items: () => logs().slice(-300).map(r => { const t = tplOf(r.tid); return {
      title: (t ? t.name : "기록") + " " + dot(r.date), sub: [r.by, r.flight && r.flight.no, isNG(r) ? "이상" : ""].filter(Boolean).join(" · "),
      text: [t && t.name, r.by, r.note, r.action, r.flight && r.flight.no], route: MOD, pick: () => { tab = "list"; q = ""; fTid = r.tid; fMonth = r.date.slice(0, 7); } }; })
  });

  window.SemisSeclog = {
    DEF_TEMPLATES, templates, tplOf, status, evidence, periodOf, periodsBack, periodLabel, missCount, isNG,
    recordForm, quickRound, templatesForm, openCell,
    setToday(t, hm) { fixedToday = isISO(t) ? t : ""; fixedNow = isHM(hm) ? hm : ""; },
    getState() { return { tab, q, fTid, fMonth, fNG }; },
    setState(o) {
      o = o || {};
      if (o.tab) tab = o.tab; if (o.q !== undefined) q = String(o.q || "");
      if (o.fTid !== undefined) fTid = String(o.fTid || ""); if (o.fMonth !== undefined) fMonth = String(o.fMonth || "");
      if (o.fNG !== undefined) fNG = !!o.fNG;
    }
  };
})();
