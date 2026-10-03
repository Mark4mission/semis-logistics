/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 자체 보안점검 (v1.32, 라우트 selfcheck · 점검 · 교육 허브)
   국가항공보안 수준관리지침(국토교통부예규 제217호) 별표 점검표를 화물터미널 자체 점검 기록으로 쓴다.
     제3조 3호 · 제16조 3호 · 제23조 1항 3호 — 항공화물터미널운영자는 현장보안확인 · 보안점검 · 불시평가 대상
     제8조 4항 — 항공화물터미널운영자 등은 자체 보안점검 · 불시평가를 실시
     제14조 — 점검결과 보고서 3년 이상 보존(시정조치가 끝나지 않은 것은 끝날 때까지)
     제53~55조 · 별표 15 — 문제점을 인적 · 장비 · 규정 · 조직 · 기타 환경 분야로 나눠 연간 건수 · 증감률 기록
     제55조 4항 — 이행 시기 현장조치 · 단기(10일 이내) · 중기(10일 이상 3개월 미만) · 장기(3개월 이상)
   양식: js/nasforms.js(표 · 칸 주소) + assets/forms/nas/b*.hwpx(별표 원본을 HWPX 로 바꾼 것)
     → 기록을 그 양식 칸에 채워 HWPX 내려받기 · 같은 모양 A4 인쇄 · 미리보기(js/hwpx.js)
   화면: 점검 기록 · 양식 · 지적 · 조치 · 문제점 분석(별표 15) / 기록 화면(브라우저 뒤로 = 목록)
   데이터 selfChecks = [{ id, form(b1·b3·…), date, insp(점검자 · 감독관 칸), org(수검자 및 기관), appr[3](별표 1 결재),
     ans{항목id: Y|N|RC|NA (별표 1: G 양호 | P 미흡)}, txt{항목id: 글 | [칸별 값]}, nm{항목id: 장비명}, rm{"표,행,열": 비고},
     fx{항목id: { cat(별표 15 세부 id), act, term(onsite|short|mid|long), due, done }}, note, files[], status(draft|done),
     createdAt/By, updatedAt/By }]
   지적 = R/C(Required Correction) · 미흡. 권한: 열람 · 기록 mgr(권한표 selfChecks 2/2), 삭제 hq 또는 작성자.
   v1.35 표시(시스템관리자): selfCheckCfg.vis = { 별표 id: { m: "dim" | "hide", msg } } — 숨김은 없는 것처럼(카드 · 기록 · 지적 · 통계 · 일정),
     흐리게는 카드에 제목 + 안내 문구만. 하드카피 기록(종이 점검표를 보고 넣는 요약) = selfChecks 안
     { id, form, hc: true, date, insp, find(지적 건수), open(미결 건수), note, createdAt/By, updatedAt/By } → 다음 기한 · 대시보드 · 증빙 2.7 · 일정관리에 반영
   수검 대응 센터 증빙: window.SemisEvidence.selfcheck(2.7 · 2.8). 별표 15 집계에는 수검 지적의 '문제점 분야'도 넣을 수 있다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "selfcheck", KEY = "selfChecks";
  const TITLE = "자체 보안점검";
  const ASSET = "assets/forms/nas/";
  const FOLDER = "seclog";                       // 보안 기록과 같은 폴더(열람 2 · 올리기 2)
  const FILE_MAX = 50 * 1024 * 1024;
  const LS_INSP = "semisl:scInsp", LS_ORG = "semisl:scOrg";
  const DEF_ORG = "에어제타 인천화물팀";
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "";
  const todayISO = () => fixedToday || toISO(new Date());
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const normText = (s) => String(s == null ? "" : s).replace(/\r/g, "").split("\n").map(x => x.replace(/\s+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
  const me = () => (SeMIS.user && SeMIS.user.name) || "";
  const filesOf = (a) => (Array.isArray(a) ? a.filter(f => f && f.url) : []);
  function addDays(iso, n) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }
  function addMonths(iso, n) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, +iso.slice(8, 10))); return d.toISOString().slice(0, 10); }
  const ymd = (iso) => String(iso || "").replace(/-/g, "");
  const dateText = (iso) => isISO(iso) ? `${iso.slice(0, 4)}. ${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.` : "";
  /* 글자 폭(한글 · 전각 2, 그 밖 1) — 종이 양식의 빈칸 맞춤 */
  const wid = (s) => Array.from(String(s || "")).reduce((n, ch) => n + (/[ᄀ-ᇿ　-〿㄰-㆏가-힣＀-￯]/.test(ch) ? 2 : 1), 0);
  const sp = (n) => " ".repeat(Math.max(0, n));
  const cssEsc = (v) => (typeof window !== "undefined" && window.CSS && window.CSS.escape) ? window.CSS.escape(v) : String(v).replace(/["\\\]\[]/g, "\\$&");

  /* ─────── 양식 ─────── */
  const NF = () => window.SemisNasForms || { SRC: {}, FORMS: [] };
  const allForms = () => NF().FORMS || [];
  /* v1.35 — 표시(시스템관리자): 숨김 · 흐리게 (selfCheckCfg.vis) */
  const VIS_MSG = "하드카피본 확인";
  function visMap() { const c = D()[CFG], v = c && typeof c === "object" ? c.vis : null; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function visOf(id) {
    const v = visMap()[id];
    const m = v && (v.m === "dim" || v.m === "hide") ? v.m : "";
    return { m, msg: m === "dim" ? (norm(v.msg) || VIS_MSG) : "" };
  }
  const isHid = (id) => visOf(id).m === "hide";
  const isDim = (f) => !!f && visOf(f.id).m === "dim";
  const forms = () => allForms().filter(f => f.kind !== "ana" && !isHid(f.id));
  const formOf = (id) => allForms().find(f => f.id === id) || null;
  const anaForm = () => allForms().find(f => f.kind === "ana") || null;
  const bno = (f) => "별표 " + String(f.id).slice(1);
  const fname = (f) => `[${bno(f)}] ${f.title}`;
  const fileName = (f, iso) => (fname(f) + (iso ? "_" + ymd(iso) : "")).replace(/[\\/:*?"<>|]/g, "_") + ".hwpx";
  const BASIS = {
    b1: "제15~18조 현장보안확인 · 제16조 3호 항공화물터미널운영자",
    insp: "제23~24조 보안점검 · 제8조 4항 자체 보안점검",
    b15: "제53~56조 결과 분석 · 문제점 분포 · 증감률"
  };
  const REG_PDF = "assets/regs/nas-217.pdf";   // 지침 본문 + 화물 관련 별표 9종(규정 자료에도 같은 파일)
  /* v1.33 — 별표는 항공보안감독관이 쓰는 점검표: 이 메뉴의 기록은 '국토부 수검대비 자체 점검'으로 표시해 구분한다 */
  const MARK = "국토부 수검대비 자체 점검";
  const OFFICIAL = {            // 지침상 실제 점검 — 주체 → 대상 · 주기(조항)
    b1: { by: "항공보안감독관 · 지방항공청", target: "화물터미널운영자 · 상주업체", cyc: "항목별 주 2회 이상", ref: "제16 · 17조" },
    insp: { by: "항공보안감독관", target: "화물터미널운영자 등", cyc: "연 1회 이상", ref: "제23조" },
    b15: { by: "항공보안감독관", target: "점검 결과", cyc: "점검 뒤 기록", ref: "제55조" }
  };
  /* 자체 점검 주기: 연 1회 이상 + 국토부 수검 7일 전까지(수검 전 90일 안에 끝낸 기록이 있으면 주기만) */
  const SELF = { by: "인천화물팀", cyc: "연 1회 이상 · 국토부 수검 전", months: 12, before: 7, fresh: 90 };
  /* v1.34 — 안내(누가 · 누구를 · 주기)는 안전보안파트(hq) 이상이 고친다. 공용 DB selfCheckCfg —
     { selfBy, months, before, fresh, forms: { 별표 id: { by, target, cyc } } } · 비거나 기본값과 같으면 저장하지 않는다(코드 기본값) */
  const CFG = "selfCheckCfg";
  const CYC_M = { 1: "월 1회 이상", 3: "분기 1회 이상", 6: "반기 1회 이상", 12: "연 1회 이상" };
  const cfgObj = () => { const c = D()[CFG]; return c && typeof c === "object" && !Array.isArray(c) ? c : {}; };
  const intIn = (v, lo, hi, d) => { if (v === "" || v == null) return d; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  function selfCfg() {
    const c = cfgObj();
    const months = CYC_M[Number(c.months)] ? Number(c.months) : SELF.months;
    return { by: norm(c.selfBy) || SELF.by, months, before: intIn(c.before, 0, 60, SELF.before), fresh: intIn(c.fresh, 0, 365, SELF.fresh), cycOnly: CYC_M[months], cyc: CYC_M[months] + " · 국토부 수검 전" };
  }
  const offBase = (f) => OFFICIAL[f.id] || (f.kind === "insp" ? OFFICIAL.insp : OFFICIAL.b15);
  function offOf(f) {
    const b = offBase(f), fs = cfgObj().forms, o = fs && typeof fs === "object" ? fs[f.id] : null;
    if (!o || typeof o !== "object") return b;
    const pick = (k) => norm(o[k]) || b[k];
    return { by: pick("by"), target: pick("target"), cyc: pick("cyc"), ref: b.ref };
  }
  const basisOf = (f) => BASIS[f.id] || (f.kind === "insp" ? BASIS.insp : "");
  const ITEMS = {};
  function itemsOf(f) {
    if (!f) return [];
    if (ITEMS[f.id]) return ITEMS[f.id];
    const out = [];
    (f.secs || []).forEach((s, si) => (s.items || []).forEach(it => out.push(Object.assign({ si, sn: s.n, st: s.title }, it))));
    ITEMS[f.id] = out;
    return out;
  }
  const CHOICE = { insp: [["Y", "Y"], ["N", "N"], ["RC", "R/C"], ["NA", "N/A"]], fsc: [["G", "양호"], ["P", "미흡"]] };
  const isChoice = (it) => it.k === "yn" || it.k === "gp" || it.k === "eq";
  const TERMS = { onsite: "현장조치", short: "단기 (10일 이내)", mid: "중기 (10일 이상 3개월 미만)", long: "장기 (3개월 이상)" };
  const TERM_KEYS = ["onsite", "short", "mid", "long"];
  function termDue(term, base) {
    if (!isISO(base)) return "";
    return term === "onsite" ? base : term === "short" ? addDays(base, 10) : term === "mid" ? addMonths(base, 3) : "";
  }
  /* 문제점 분야(제54조 · 별표 15) — 세부 id = 별표 15 표의 행 */
  const cats = () => (anaForm() ? anaForm().cats : []);
  function catOf(id) {
    for (const c of cats()) { const it = c.items.find(x => x.id === id); if (it) return { id, cat: c.n, t: it.t }; }
    return null;
  }
  const catLabel = (id) => { const c = catOf(id); return c ? c.cat + " · " + c.t : ""; };
  const catSelect = (id, val, attrs) => `<select id="${esc(id)}" ${attrs || ""}><option value="">분야 미지정</option>${cats().map(c =>
    `<optgroup label="${esc(c.n)}">${c.items.map(it => `<option value="${esc(it.id)}" ${val === it.id ? "selected" : ""}>${esc(it.t)}</option>`).join("")}</optgroup>`).join("")}</select>`;

  /* ─────── 데이터 ─────── */
  function list() { let a = D()[KEY]; if (!Array.isArray(a)) a = D()[KEY] = []; return a; }
  const recs = () => (Array.isArray(D()[KEY]) ? D()[KEY] : []).filter(r => r && r.id && !r.hc && formOf(r.form) && formOf(r.form).kind !== "ana" && !isHid(r.form) && isISO(r.date));
  /* 하드카피 기록(v1.35) — fid 를 주면 그 양식만 */
  const hcRecs = (fid) => (Array.isArray(D()[KEY]) ? D()[KEY] : []).filter(r => r && r.id && r.hc && formOf(r.form) && formOf(r.form).kind !== "ana" && !isHid(r.form) && isISO(r.date) && (!fid || r.form === fid));
  const hcN = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const hcOpen = (fid) => hcRecs(fid).reduce((n, r) => n + Math.min(hcN(r.open), hcN(r.find) || hcN(r.open)), 0);
  const recOf = (id) => recs().find(r => r.id === id) || null;
  const bag = (r, k) => { if (!r[k] || typeof r[k] !== "object" || Array.isArray(r[k])) r[k] = {}; return r[k]; };
  const ansOf = (r, id) => (r && r.ans && r.ans[id]) || "";
  const txtOf = (r, id) => { const v = r && r.txt ? r.txt[id] : ""; return typeof v === "string" ? v : ""; };
  const arrOf = (r, id, n) => { const v = r && r.txt ? r.txt[id] : null; const a = Array.isArray(v) ? v.map(x => String(x == null ? "" : x)) : []; while (a.length < (n || 0)) a.push(""); return a; };
  const rmKey = (ref) => Array.isArray(ref) ? ref.join(",") : "";
  const rmOf = (r, k) => (r && r.rm && typeof r.rm[k] === "string" ? r.rm[k] : "");
  const nmOf = (r, id) => (r && r.nm && typeof r.nm[id] === "string" ? r.nm[id] : "");
  const fxOf = (r, id) => (r && r.fx && r.fx[id] && typeof r.fx[id] === "object" ? r.fx[id] : {});
  const isFind = (f, it, a) => !!f && (f.kind === "fsc" ? isChoice(it) && a === "P" : it.k === "yn" && a === "RC");
  function findingsOf(r) {
    const f = formOf(r.form);
    return itemsOf(f).filter(it => isFind(f, it, ansOf(r, it.id))).map(it => ({ r, f, it, fx: fxOf(r, it.id) }));
  }
  const allFindings = () => recs().reduce((a, r) => a.concat(findingsOf(r)), []);
  function fState(fx, t) {
    if (isISO(fx && fx.done)) return "done";
    if (fx && isISO(fx.due) && fx.due < (t || todayISO())) return "late";
    return "open";
  }
  const FST = { open: ["조치 중", "amber"], late: ["기한 경과", "red"], done: ["조치 완료", "green"] };
  function counts(r) {
    const f = formOf(r.form);
    const c = { Y: 0, N: 0, RC: 0, NA: 0, G: 0, P: 0, need: 0, done: 0, fx: 0, open: 0, late: 0 };
    itemsOf(f).forEach(it => {
      if (!isChoice(it)) return;
      if (it.k === "eq" && !it.t && !nmOf(r, it.id) && !ansOf(r, it.id)) return;   // 빈 장비 줄은 셈하지 않음
      c.need++;
      const a = ansOf(r, it.id);
      if (a) { c.done++; if (c[a] !== undefined) c[a]++; }
    });
    const t = todayISO();
    findingsOf(r).forEach(x => { c.fx++; const s = fState(x.fx, t); if (s !== "done") c.open++; if (s === "late") c.late++; });
    return c;
  }
  function resultText(r, c) {
    const f = formOf(r.form);
    c = c || counts(r);
    const parts = f.kind === "fsc" ? [["양호", c.G], ["미흡", c.P]] : [["Y", c.Y], ["N", c.N], ["R/C", c.RC], ["N/A", c.NA]];
    return parts.filter(([, n]) => n).map(([k, n]) => k + " " + n).join(" · ") + (c.need > c.done ? (c.done ? " · " : "") + "미응답 " + (c.need - c.done) : "");
  }
  /* 보존 — 제14조: 3년 이상, 시정조치가 끝나지 않으면 끝날 때까지 */
  function keepText(r) {
    const c = counts(r);
    if (c.open) return "보존: 조치 완료 때까지 (제14조)";
    return "보존: " + dot(addMonths(r.date, 36)) + "까지 (제14조)";
  }
  /* 다음 국토부(지방항공청 포함) 수검 — 수검 대응 센터 기록 */
  function govAudit(t) {
    t = t || todayISO();
    const as = (Array.isArray(D().audits) ? D().audits : []).filter(a => a && !a.cancelled && a.body === "gov" && isISO(a.start) && a.start >= t);
    return as.sort((a, b) => a.start.localeCompare(b.start))[0] || null;
  }
  /* 양식별 다음 자체 점검일 — { due, why(수검 전 | 주기 | ""), last(마지막 완료일), draft(작성 중 기록), audit } */
  function nextDue(f, t) {
    t = t || todayISO();
    const rs = recs().filter(r => r.form === f.id);
    const last = rs.filter(r => r.status === "done").map(r => r.date).concat(hcRecs(f.id).map(r => r.date)).sort().pop() || "";
    const out = { due: "", why: "", last, draft: rs.find(r => r.status !== "done") || null, audit: null };
    if (f.kind === "ana") return out;
    const C = selfCfg();
    const cyc = last ? addMonths(last, C.months) : "";
    const a = govAudit(t);
    let pre = "";
    if (a && (!last || last < addDays(a.start, -C.fresh))) { pre = addDays(a.start, -C.before); if (pre < t) pre = t; }
    if (pre && (!cyc || pre <= cyc)) { out.due = pre; out.why = "수검 전"; out.audit = a; }
    else if (cyc) { out.due = cyc; out.why = "주기"; }
    return out;
  }
  const dday = (due, t) => { if (!isISO(due)) return ""; const n = Math.round((Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10)) - Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))) / 86400000); return n === 0 ? "오늘" : n > 0 ? "D-" + n : "지남 " + (-n) + "일"; };
  const touch = (r) => { r.updatedAt = new Date().toISOString(); r.updatedBy = me(); };
  const canW = () => !!SeMIS.user && SeMIS.roleRank() >= 2 && SeMIS.user.role !== "vendor";
  const canDel = (r) => SeMIS.canEdit() || (!!r && !!SeMIS.user && (r.createdBy === me() && canW()));
  const remember = (k, v) => { try { if (v) localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } };
  const recall = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };

  /* ─────── 문제점 분석(별표 15) — 연도별 세부 건수 · 전년 대비 ─────── */
  function auditFindings() {
    const as = Array.isArray(D().audits) ? D().audits : [];
    const out = [];
    as.forEach(a => { if (!a || a.cancelled) return; (Array.isArray(a.findings) ? a.findings : []).forEach(f => { if (f && f.cat) out.push({ date: a.start || "", cat: f.cat, a, f }); }); });
    return out;
  }
  function analysis(year, withAudit) {
    const y = String(year), py = String(Number(year) - 1);
    const cnt = {}, prev = {};
    let none = 0, total = 0, ptotal = 0, fromAudit = 0;
    const add = (iso, cat, src) => {
      const yy = String(iso || "").slice(0, 4);
      if (yy !== y && yy !== py) return;
      if (!cat || !catOf(cat)) { if (yy === y) none++; return; }
      if (yy === y) { cnt[cat] = (cnt[cat] || 0) + 1; total++; if (src === "a") fromAudit++; }
      else { prev[cat] = (prev[cat] || 0) + 1; ptotal++; }
    };
    allFindings().forEach(x => add(x.r.date, x.fx.cat, "s"));
    if (withAudit) auditFindings().forEach(x => add(x.date, x.cat, "a"));
    return { year: y, cnt, prev, none, total, ptotal, fromAudit };
  }
  function pctText(A, id) {
    const c = A.cnt[id] || 0, p = A.prev[id] || 0;
    if (!p) return c ? "-" : "";
    const v = Math.round((c - p) / p * 100);
    return (v > 0 ? "+" : "") + v;
  }

  /* ═════════ HWPX 채우기 ═════════ */
  const VER = () => (SeMIS.VERSION || "");
  async function loadPkg(f) {
    if (!window.SemisHwpx) throw new Error("hwpx");
    return SemisHwpx.open(ASSET + f.id + ".hwpx" + (VER() ? "?v=" + VER() : ""));
  }
  /* 별표 1 점검일 · 점검자 줄 — 원본 빈칸 폭(22 · 14칸)에 맞춘다 */
  function fscLine(r) {
    const d = dateText(r.date), n = norm(r.insp);
    return "점검일 : " + d + sp(22 - 1 - wid(d)) + "점검자 : " + n + sp(14 - 1 - wid(n)) + "(서명)";
  }
  /* 첫 줄([별표 N] …) 끝에 수검대비 자체 점검 표시 — 줄이 늘지 않게 같은 문단에 붙인다 */
  function markPkg(pkg) {
    const H = SemisHwpx, p = H.topParas(pkg)[0];
    if (!p) return pkg;
    const txt = H.paraText(p).replace(/\s+$/, "");
    if (txt.indexOf(MARK) < 0) H.setPara(p, txt + "      ※ " + MARK);
    return pkg;
  }
  function fill(pkg, f, r) {
    const H = SemisHwpx;
    markPkg(pkg);
    const set = (ref, lines, o) => { const tc = H.cell(pkg, ref); if (tc) H.setCell(tc, lines, o); };
    const plain = H.plainPara(pkg);
    if (f.kind === "insp") {
      if (isISO(r.date)) set(f.head.date, dateText(r.date));
      if (norm(r.insp)) set(f.head.insp, norm(r.insp));
      if (norm(r.org)) set(f.head.org, norm(r.org));
      itemsOf(f).forEach(it => {
        if (it.k === "yn") {
          const i = ["Y", "N", "RC", "NA"].indexOf(ansOf(r, it.id));
          if (i >= 0) set(it.b[i], "■");
        } else if (it.k === "tx") {
          const v = normText(txtOf(r, it.id));
          if (v) set(it.a, v.split("\n"), { para: plain });
        } else if (it.k === "pr") {
          const vs = arrOf(r, it.id, it.p.length).map(norm);
          if (!vs.some(Boolean)) return;
          const tc = H.cell(pkg, it.a);
          if (!tc) return;
          H.cellParas(tc).filter(p => norm(H.paraText(p))).forEach((p, i) => { if (vs[i]) H.setPara(p, H.paraText(p).replace(/\s+$/, "") + " " + vs[i]); });
        } else if (it.k === "un") {
          const vs = arrOf(r, it.id, it.u.length).map(norm);
          if (vs.some(Boolean)) set(it.a, it.u.map(([l, u], i) => (l ? l + ": " : "") + (vs[i] || " ") + " " + u).join("/"));
        }
      });
    } else if (f.kind === "fsc") {
      const ap = (Array.isArray(r.appr) ? r.appr : []).slice(0, 3);
      if (!norm(ap[0]) && norm(r.insp)) ap[0] = r.insp;   // 결재란 점검자 = 점검자(비워 두면)
      const ctr = H.centerPara(pkg), cop = ctr == null ? undefined : { para: ctr };
      ap.forEach((n, i) => { if (norm(n) && f.head.appr[i]) set(f.head.appr[i], norm(n), cop); });
      const tp = H.topParas(pkg)[f.head.line];
      if (tp && (isISO(r.date) || norm(r.insp))) H.setPara(tp, fscLine(r));
      const groups = {};
      /* 빈 장비명 칸은 원본에서 큰 글자(빈 줄용)라 — 바로 위 장비명 칸의 문단 · 글자 모양을 쓴다 */
      const nameStyle = (it) => {
        const all = itemsOf(f), i = all.indexOf(it);
        const ref = all.slice(0, i).reverse().find(x => x.k === "eq" && x.t && x.nm) || all.find(x => x.k === "eq" && x.t && x.nm);
        const tc = ref && H.cell(pkg, ref.nm), p = tc && H.cellParas(tc)[0];
        const run = p && Array.from(p.getElementsByTagNameNS(H.NS.hp, "run")).find(r => r.getElementsByTagNameNS(H.NS.hp, "t").length);
        return p ? { para: p.getAttribute("paraPrIDRef"), char: run ? run.getAttribute("charPrIDRef") : null } : undefined;
      };
      itemsOf(f).forEach(it => {
        const i = ["G", "P"].indexOf(ansOf(r, it.id));
        if (i >= 0) set(it.b[i], "○", cop);
        if (it.k === "eq") {
          if (!it.t && norm(nmOf(r, it.id))) set(it.nm, norm(nmOf(r, it.id)), nameStyle(it));
          const v = normText(rmOf(r, rmKey(it.rm)));
          if (v) set(it.rm, v.split("\n"));
        } else if (it.k === "gp" && it.rm) groups[rmKey(it.rm)] = it.rm;
      });
      Object.keys(groups).forEach(k => { const v = normText(rmOf(r, k)); if (v) set(groups[k], v.split("\n"), { para: plain }); });
    }
    return pkg;
  }
  function fillAna(pkg, f, A, org) {
    const H = SemisHwpx;
    markPkg(pkg);
    const tp = H.topParas(pkg)[f.head.org];
    if (tp && norm(org)) {
      const old = H.paraText(tp), lab = "(" + norm(org) + ")";
      const W = wid(old.replace(/\s+$/, ""));
      H.setPara(tp, sp(W - wid(lab)) + lab);
    }
    f.cats.forEach(c => c.items.forEach(it => {
      const tcN = H.cell(pkg, it.n), tcP = H.cell(pkg, it.pct);
      if (tcN) H.setCell(tcN, String(A.cnt[it.id] || 0));
      const pc = pctText(A, it.id);
      if (tcP && pc) H.setCell(tcP, pc);
    }));
    return pkg;
  }
  const preview = (f, r) => [fname(f), r ? dateText(r.date) + " " + norm(r.insp) + " " + norm(r.org) : ""].join("\n");
  async function recordPkg(r) { const f = formOf(r.form); return fill(await loadPkg(f), f, r); }
  async function anaPkg(year, withAudit, org) { const f = anaForm(); return fillAna(await loadPkg(f), f, analysis(year, withAudit), org); }
  async function downloadRecord(r) {
    const f = formOf(r.form);
    try {
      const pkg = await recordPkg(r);
      const u8 = await SemisHwpx.build(pkg, { splitTables: true, preview: preview(f, r) });
      SemisHwpx.download(u8, fileName(f, r.date));
    } catch (e) { toast("HWPX 파일을 만들지 못했습니다.", true); }
  }
  async function downloadAna(year, withAudit, org) {
    const f = anaForm();
    try {
      const pkg = await anaPkg(year, withAudit, org);
      SemisHwpx.download(await SemisHwpx.build(pkg, { preview: fname(f) + "\n" + year }), fileName(f).replace(/\.hwpx$/, "_" + year + ".hwpx"));
    } catch (e) { toast("HWPX 파일을 만들지 못했습니다.", true); }
  }

  /* ═════════ 인쇄 · 미리보기 (양식 모양 그대로) ═════════ */
  let lastPrint = "";
  function docHTML(pkg, title, screen) {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${SemisHwpx.css(pkg, { screen })}</style></head><body>${SemisHwpx.html(pkg)}</body></html>`;
  }
  function printPkg(pkg, title) {
    try {
      const html = docHTML(pkg, title, false);
      lastPrint = html;
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
      document.body.appendChild(fr);
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fire = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } };
      if (doc.readyState === "complete") setTimeout(fire, 250); else fr.onload = () => setTimeout(fire, 250);
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) { toast("인쇄 대화상자를 열 수 없습니다.", true); }
  }
  function previewPkg(pkg, title, onPrint, onHwpx) {
    const html = docHTML(pkg, title, true);
    lastPrint = html;
    openModal(`<h3>미리보기 <small class="au-mh">${esc(title)}</small></h3>
      <div class="sc-prev" id="sc-prev"><iframe id="sc-prev-fr" title="양식 미리보기"></iframe></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button>
        ${onHwpx ? `<button type="button" class="btn btn-ghost" data-act="hwpx">${icon("down", 16)}<span>HWPX</span></button>` : ""}
        <button type="button" class="btn btn-primary" data-act="ok">${icon("print", 16)}<span>인쇄</span></button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => { closeModal(); onPrint(); };
    const hb = $("#modal-box [data-act=hwpx]");
    if (hb) hb.onclick = () => onHwpx();
    const fr = $("#sc-prev-fr"), box = $("#sc-prev");
    if (!fr || !box) return;
    const W = 816;
    const s = Math.min(1, ((box.clientWidth || 700) - 4) / W);
    fr.style.width = W + "px";
    fr.style.transform = "scale(" + s.toFixed(4) + ")";
    try {
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fit = () => { const h = Math.max(600, doc.documentElement.scrollHeight || 1123); fr.style.height = h + "px"; box.style.height = Math.round(h * s) + "px"; };
      fit(); setTimeout(fit, 120);
    } catch (e) { /* jsdom */ }
  }
  async function printRecord(r, pv) {
    const f = formOf(r.form);
    try {
      const pkg = await recordPkg(r);
      const title = fname(f) + " " + dot(r.date);
      if (pv) previewPkg(pkg, title, () => printPkg(pkg, title), () => downloadRecord(r));
      else printPkg(pkg, title);
    } catch (e) { toast("양식을 불러오지 못했습니다.", true); }
  }
  async function printBlank(f, pv) {
    try {
      const pkg = await loadPkg(f);
      if (pv) previewPkg(pkg, fname(f), () => printPkg(pkg, fname(f)), () => blankDownload(f));
      else printPkg(pkg, fname(f));
    } catch (e) { toast("양식을 불러오지 못했습니다.", true); }
  }
  async function printAna(pv) {
    const f = anaForm();
    try {
      const pkg = await anaPkg(anaYear(), anaAudit, anaOrg());
      const title = fname(f) + " " + anaYear();
      if (pv) previewPkg(pkg, title, () => printPkg(pkg, title), () => downloadAna(anaYear(), anaAudit, anaOrg()));
      else printPkg(pkg, title);
    } catch (e) { toast("양식을 불러오지 못했습니다.", true); }
  }
  function blankDownload(f) {
    const a = document.createElement("a");
    a.href = ASSET + f.id + ".hwpx" + (VER() ? "?v=" + VER() : "");
    a.download = fileName(f);
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 2000);
  }

  /* ─────── 수검 대응 센터 증빙 — 2.7 자체 점검 기록 · 2.8 지적 개선 관리 ─────── */
  function evidence(mid) {
    mid = String(mid || "");
    if (mid !== "2.7" && mid !== "2.8") return null;
    const t = todayISO(), from = addDays(t, -365);
    const rs = recs().filter(r => r.date >= from && r.date <= t);
    if (mid === "2.7") {
      const done = rs.filter(r => r.status === "done");
      const hc = hcRecs().filter(r => r.date >= from && r.date <= t).length;
      return { ok: done.length + hc > 0, text: `자체 보안점검(수준관리지침 별표) ${done.length + hc}건(1년${hc ? " · 하드카피 " + hc : ""})${rs.length > done.length ? " · 작성 중 " + (rs.length - done.length) : ""}` };
    }
    const fs = rs.reduce((a, r) => a.concat(findingsOf(r)), []);
    const late = fs.filter(x => fState(x.fx, t) === "late").length, done = fs.filter(x => fState(x.fx, t) === "done").length;
    return { ok: rs.length > 0 && late === 0, text: fs.length ? `자체 점검 지적 ${fs.length} · 조치 완료 ${done}${late ? " · 기한 경과 " + late : ""}` : (rs.length ? "자체 점검 지적 없음" : "자체 점검 기록 없음") };
  }
  if (typeof window !== "undefined") (window.SemisEvidence = window.SemisEvidence || {})[MOD] = evidence;

  /* ═════════ 화면 상태 ═════════ */
  let tab = "list", q = "", fForm = "", fYear = "", fOpen = true, rid = "", focusItem = "", anaY = "", anaAudit = true;
  let pendingOpen = false;
  const TABS = [["list", "점검 기록"], ["forms", "양식"], ["fx", "지적 · 조치"], ["ana", "문제점 분석"]];
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "") || "dashboard";
  const hay = (a) => a.map(v => String(v || "")).join(" ").toLowerCase();
  const anaYear = () => anaY || todayISO().slice(0, 4);
  const anaOrg = () => recall(LS_ORG) || DEF_ORG;
  function years() {
    const ys = new Set([todayISO().slice(0, 4)]);
    recs().concat(hcRecs()).forEach(r => ys.add(r.date.slice(0, 4)));
    return Array.from(ys).sort().reverse();
  }
  function fileChips(files) {
    return filesOf(files).map(f => `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>`).join("");
  }
  const stChip = (r) => r.status === "done" ? ui.chip("완료", "green") : ui.chip("작성 중", "blue");

  /* ═════════ 점검 기록 ═════════ */
  function listRows() {
    return recs().concat(hcRecs()).filter(r => {
      if (fForm && r.form !== fForm) return false;
      if (fYear && r.date.slice(0, 4) !== fYear) return false;
      if (!q) return true;
      const f = formOf(r.form);
      return hay([fname(f), r.insp, r.org, r.note, dot(r.date), r.hc ? "하드카피" : ""]).indexOf(q.toLowerCase()) >= 0;
    }).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }
  const hcRowHTML = (r) => { const f = formOf(r.form), fd = hcN(r.find), op = Math.min(hcN(r.open), fd || hcN(r.open));
    return `<tr data-schc="${esc(r.form)}" tabindex="0" class="is-click sc-hcrow">
      <td><span class="mono">${esc(dot(r.date))}</span></td>
      <td data-role="title"><b>${esc(bno(f))}</b> ${esc(f.title)}</td>
      <td>${esc(r.insp || "-")}</td><td>-</td>
      <td class="sc-res">${esc(r.note || "-")}</td>
      <td>${fd ? ui.chip((op ? "미결 " + op : "완료") + " / " + fd, op ? "amber" : "green") : '<span class="cell-sub">없음</span>'}</td>
      <td>${ui.chip("하드카피", "gray")}</td></tr>`; };
  function listBodyHTML() {
    const rows = listRows();
    if (!rows.length) return ui.empty(recs().length ? "조건에 맞는 기록이 없습니다." : "등록된 점검 기록이 없습니다.");
    return `<div class="table-wrap"><table class="tbl tbl-cap sc-tbl">
      <thead><tr><th>점검일</th><th>양식</th><th>점검자</th><th>수검자 및 기관</th><th>결과</th><th>지적</th><th>상태</th></tr></thead>
      <tbody>${rows.map(r => {
        if (r.hc) return hcRowHTML(r);
        const f = formOf(r.form), c = counts(r);
        return `<tr data-scid="${esc(r.id)}" tabindex="0" class="is-click">
          <td><span class="mono">${esc(dot(r.date))}</span></td>
          <td data-role="title"><b>${esc(bno(f))}</b> ${esc(f.title)}</td>
          <td>${esc(r.insp || "-")}</td><td>${esc(r.org || "-")}</td>
          <td class="sc-res">${esc(resultText(r, c) || "-")}</td>
          <td>${c.fx ? `${ui.chip((c.open ? "미결 " + c.open : "완료") + " / " + c.fx, c.late ? "red" : c.open ? "amber" : "green")}` : '<span class="cell-sub">없음</span>'}</td>
          <td>${stChip(r)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function listHTML() {
    const all = recs(), y = todayISO().slice(0, 4);
    const fs = allFindings(), t = todayISO();
    const hy = hcRecs().filter(r => r.date.slice(0, 4) === y).length;
    const open = fs.filter(x => fState(x.fx, t) !== "done").length + hcOpen(), late = fs.filter(x => fState(x.fx, t) === "late").length;
    const ys = years();
    if (fYear && ys.indexOf(fYear) < 0) fYear = "";
    return ui.stats([
      { label: y + "년 점검", value: all.filter(r => r.date.slice(0, 4) === y).length + hy, sub: "완료 " + (all.filter(r => r.date.slice(0, 4) === y && r.status === "done").length + hy) + (hy ? " · 하드카피 " + hy : "") },
      { label: "작성 중", value: all.filter(r => r.status !== "done").length, tone: all.some(r => r.status !== "done") ? "warn" : "muted" },
      { label: "미결 지적", value: open, sub: "R/C · 미흡", tone: open ? "warn" : "ok" },
      { label: "기한 경과", value: late, tone: late ? "bad" : "ok" }
    ]) + `<section class="card" id="sc-list">
      <div class="toolbar">
        ${ui.search("sc-q", "양식 · 점검자 · 기관 검색", q)}
        <label class="ck-f"><span>양식</span><select id="sc-fform"><option value="">전체</option>${forms().map(f => `<option value="${esc(f.id)}" ${fForm === f.id ? "selected" : ""}>${esc(bno(f) + " " + f.title)}</option>`).join("")}</select></label>
        <label class="ck-f"><span>연도</span><select id="sc-fyear"><option value="">전체</option>${ys.map(v => `<option value="${v}" ${fYear === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      </div>
      <div id="sc-lbody">${listBodyHTML()}</div>
    </section>`;
  }

  /* ═════════ 양식 ═════════ */
  /* 양식 카드 · 기록 화면에 함께 쓰는 표시 — 감독관 점검표 · 수검대비 자체 점검 */
  const tagsHTML = (f) => `<span class="sc-tags"><span class="sc-tag is-off" title="${esc(offOf(f).ref)} — 항공보안감독관이 쓰는 양식">감독관 점검표</span><span class="sc-tag is-mark">${esc(f.kind === "ana" ? "수검대비 자체 분석" : "수검대비 자체 점검")}</span></span>`;
  const offText = (f) => { const o = offOf(f); return `${o.by} → ${o.target} · ${o.cyc}`; };
  function selfText(f, t) {
    const C = selfCfg();
    if (f.kind === "ana") return `${C.by} · 연 1회 (연말)`;
    const n = nextDue(f, t);
    const tail = n.due ? `다음 ${dot(n.due).slice(5)} (${dday(n.due, t)}${n.why === "수검 전" ? " · 수검 전" : ""})` : n.last ? "최근 " + dot(n.last) : "기록 없음";
    return `${C.by} · ${C.cycOnly} · ${tail}`;
  }
  const whoHTML = (f, t) => `<dl class="sc-who">
      <div><dt>감독관</dt><dd title="${esc(offOf(f).ref)}">${esc(offText(f))}</dd></div>
      <div><dt>자체</dt><dd>${esc(selfText(f, t))}</dd></div>
    </dl>`;
  function formsHTML() {
    const w = canW(), t = todayISO();
    const card = (f) => {
      if (isDim(f)) return `<button type="button" class="sc-fcard is-dim" data-fid="${esc(f.id)}" data-sc-hc="${esc(f.id)}" aria-label="${esc(bno(f) + " " + f.title + " — " + visOf(f.id).msg)}">
        <span class="sc-fcard-h"><span class="sc-bno mono">${esc(bno(f))}</span><b>${esc(f.title)}</b></span>
        <span class="sl-dim">${icon("doc", 16)}<span>${esc(visOf(f.id).msg)}</span></span>
      </button>`;
      const n = nextDue(f, t);
      const soon = n.due && n.due <= addDays(t, 30);
      return `<section class="sc-fcard${soon ? " is-soon" : ""}" data-fid="${esc(f.id)}">
        <div class="sc-fcard-h"><span class="sc-bno mono">${esc(bno(f))}</span><b>${esc(f.title)}</b></div>
        ${tagsHTML(f)}
        ${whoHTML(f, t)}
        <div class="sc-fcard-f"><span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-sc-blank="${esc(f.id)}" title="빈 양식 미리보기 · 인쇄">${icon("eye", 15)}<span>빈 양식</span></button>
          <button type="button" class="btn btn-ghost btn-sm" data-sc-bdl="${esc(f.id)}" title="빈 양식 HWPX 내려받기">${icon("down", 15)}<span>HWPX</span></button>
          ${w ? `<button type="button" class="btn btn-primary btn-sm" data-sc-new="${esc(f.id)}">${icon(n.draft ? "edit" : "plus", 15)}<span>${n.draft ? "이어 쓰기" : "점검"}</span></button>` : ""}</div>
      </section>`;
    };
    const a = anaForm();
    return `<div class="sc-fcards">${forms().map(card).join("")}${a ? `<section class="sc-fcard is-ana">
        <div class="sc-fcard-h"><span class="sc-bno mono">${esc(bno(a))}</span><b>${esc(a.title)}</b></div>
        ${tagsHTML(a)}
        ${whoHTML(a, t)}
        <div class="sc-fcard-f"><span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-sc-bdl="${esc(a.id)}">${icon("down", 15)}<span>빈 양식 HWPX</span></button>
          <button type="button" class="btn btn-primary btn-sm" data-sc-tab="ana">${icon("chart", 15)}<span>문제점 분석</span></button></div>
      </section>` : ""}</div>
      <p class="sc-src">${esc(NF().SRC.title || "")} (${esc(NF().SRC.rev || "")}, ${esc(dot(NF().SRC.date || ""))}) 별표 — 국가법령정보센터 원본 양식 · <a href="${esc(REG_PDF)}" target="_blank" rel="noopener">지침 본문 PDF</a></p>`;
  }

  /* ═════════ 안내 편집 (v1.34, hq 이상) — 누가 · 누구를 · 주기 ═════════ */
  function cfgForm() {
    if (!SeMIS.canEdit()) return;
    const C = selfCfg(), fl = allForms().filter(f => !isHid(f.id));
    const inp = (k, v, ph, max) => `<input data-c="${k}" value="${esc(v)}" placeholder="${esc(ph)}" maxlength="${max || 40}">`;
    const frow = (f) => { const o = offOf(f), b = offBase(f); return `<div class="sc-cfg-r" data-cf="${esc(f.id)}">
        <span class="sc-cfg-f"><b class="mono">${esc(bno(f))}</b><small>${esc(f.title)}</small></span>
        <label><span>누가</span>${inp("by", o.by, b.by)}</label>
        <label><span>누구를</span>${inp("target", o.target, b.target)}</label>
        <label><span>주기</span>${inp("cyc", o.cyc, b.cyc, 30)}</label>
      </div>`; };
    openModal(`<h3>점검 안내 <small class="au-mh">${esc(TITLE)}</small></h3>
      <section class="sc-cfg-sec"><h4>자체 점검 (${esc(MARK)})</h4>
        <div class="sc-cfg-g">
          <label><span>누가</span><input id="sc-c-by" value="${esc(C.by)}" placeholder="${esc(SELF.by)}" maxlength="30"></label>
          <label><span>주기</span><select id="sc-c-m">${Object.keys(CYC_M).map(k => `<option value="${k}" ${Number(k) === C.months ? "selected" : ""}>${esc(CYC_M[k])}</option>`).join("")}</select></label>
          <label><span>국토부 수검 며칠 전</span><input id="sc-c-before" type="number" min="0" max="60" value="${C.before}"></label>
          <label><span>수검 전 인정 기간(일)</span><input id="sc-c-fresh" type="number" min="0" max="365" value="${C.fresh}" title="수검 시작 전 이 기간 안에 끝낸 점검이 있으면 주기만 따릅니다"></label>
        </div>
      </section>
      <section class="sc-cfg-sec"><h4>감독관 점검 (수준관리지침)</h4>
        <div class="sc-cfg-rows">${fl.map(frow).join("")}</div>
      </section>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="sc-c-reset">기본값</button><span class="spacer"></span><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    $("#sc-c-reset").onclick = () => {
      $("#sc-c-by").value = SELF.by; $("#sc-c-m").value = String(SELF.months); $("#sc-c-before").value = SELF.before; $("#sc-c-fresh").value = SELF.fresh;
      $$("#modal-box [data-cf]").forEach(r => { const b = offBase(formOf(r.dataset.cf)); $$("[data-c]", r).forEach(i => { i.value = b[i.dataset.c]; }); });
    };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const out = { forms: {} }, prev = cfgObj();
      if (prev.vis && typeof prev.vis === "object") out.vis = prev.vis;                       // 표시(시스템관리자) 값은 그대로
      allForms().forEach(f => { if (isHid(f.id) && prev.forms && prev.forms[f.id]) out.forms[f.id] = prev.forms[f.id]; });   // 숨긴 별표 안내도 그대로
      const by = norm($("#sc-c-by").value), m = Number($("#sc-c-m").value);
      const before = intIn($("#sc-c-before").value, 0, 60, -1), fresh = intIn($("#sc-c-fresh").value, 0, 365, -1);
      if (before < 0 || fresh < 0) { toast("일수는 0~60 · 0~365 사이로 넣으세요.", true); return; }
      if (by && by !== SELF.by) out.selfBy = by;
      if (CYC_M[m] && m !== SELF.months) out.months = m;
      if (before !== SELF.before) out.before = before;
      if (fresh !== SELF.fresh) out.fresh = fresh;
      $$("#modal-box [data-cf]").forEach(r => {
        const f = formOf(r.dataset.cf); if (!f) return;
        const b = offBase(f), o = {};
        $$("[data-c]", r).forEach(i => { const v = norm(i.value); if (v && v !== b[i.dataset.c]) o[i.dataset.c] = v; });
        if (Object.keys(o).length) out.forms[f.id] = o;
      });
      D()[CFG] = out;
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장했습니다.");
    };
  }

  /* ═════════ 표시 관리 (v1.35, 시스템관리자) ═════════ */
  function visForm() {
    if (!SeMIS.isAdmin()) return;
    const vm = visMap(), fl = allForms().filter(f => f.kind !== "ana");
    SeMIS.ui.visForm({
      title: TITLE,
      rows: fl.map(f => ({ id: f.id, name: bno(f) + " " + f.title, sub: "", m: visOf(f.id).m, msg: (vm[f.id] && vm[f.id].msg) || "" })),
      onSave(map) {
        const c = Object.assign({}, cfgObj());
        if (Object.keys(map).length) c.vis = map; else delete c.vis;
        if (!c.forms || typeof c.forms !== "object") c.forms = {};
        D()[CFG] = c;
        SeMIS.save(); SeMIS.renderView(); toast("저장했습니다.");
      }
    });
  }

  /* ═════════ 하드카피 기록 (v1.35) — 종이 점검표를 보고 점검일 · 점검자 · 지적 · 미결 건수만 남긴다 ═════════ */
  function hcForm(fid) {
    const f = formOf(fid);
    if (!f || f.kind === "ana" || isHid(f.id)) return;
    const w = canW(), t0 = todayISO();
    let editId = "";
    const rowsHTML = () => {
      const rs = hcRecs(f.id).sort((a, b) => b.date.localeCompare(a.date));
      return rs.length ? `<ol class="hc-list">${rs.map(r => { const fd = hcN(r.find), op = Math.min(hcN(r.open), fd || hcN(r.open));
        return `<li${r.id === editId ? ' class="is-edit"' : ""}><span class="mono">${esc(dot(r.date))}</span><span class="hc-li">${esc(r.insp || "-")}${r.note ? `<small>${esc(r.note)}</small>` : ""}</span>
          <span class="hc-fx">${fd ? ui.chip((op ? "미결 " + op : "조치 완료") + " / 지적 " + fd, op ? "amber" : "green") : '<span class="cell-sub">지적 없음</span>'}</span>
          ${w ? `<button type="button" class="mt-btn" data-hce="${esc(r.id)}" aria-label="수정">${icon("edit", 14)}</button>` : ""}
          ${canDel(r) ? `<button type="button" class="mt-btn danger" data-hcx="${esc(r.id)}" aria-label="삭제">${icon("x", 14)}</button>` : ""}</li>`; }).join("")}</ol>`
        : `<p class="hc-none">하드카피 기록이 없습니다.</p>`;
    };
    const formHTML = (r) => !w ? "" : `<div class="hc-form">
        <label><span>점검일</span><input type="date" id="hcs-date" value="${esc((r && r.date) || t0)}" max="${esc(t0)}"></label>
        <label><span>점검자</span><input id="hcs-insp" value="${esc((r && r.insp) || recall(LS_INSP) || "")}" maxlength="40" autocomplete="off"></label>
        <label><span>지적 (R/C · 미흡)</span><input type="number" id="hcs-find" min="0" max="999" inputmode="numeric" value="${esc(r && hcN(r.find) ? hcN(r.find) : "")}"></label>
        <label><span>미결</span><input type="number" id="hcs-open" min="0" max="999" inputmode="numeric" value="${esc(r && hcN(r.open) ? hcN(r.open) : "")}"></label>
        <label class="hc-wide"><span>메모</span><input id="hcs-note" value="${esc((r && r.note) || "")}" maxlength="200" autocomplete="off"></label>
      </div>`;
    const paintBox = () => {
      const r = editId ? hcRecs(f.id).find(x => x.id === editId) : null;
      $("#hcs-body").innerHTML = formHTML(r) + rowsHTML();
      const ok = $("#modal-box [data-act=ok]"); if (ok) ok.textContent = editId ? "수정 저장" : "추가";
      const nw = $("#modal-box [data-act=new]"); if (nw) nw.classList.toggle("hidden", !editId);
      $$("#hcs-body [data-hce]").forEach(b => b.onclick = () => { editId = b.dataset.hce; paintBox(); });
      $$("#hcs-body [data-hcx]").forEach(b => b.onclick = () => {
        const x = hcRecs(f.id).find(y => y.id === b.dataset.hcx);
        if (!x || !canDel(x)) return;
        D()[KEY] = list().filter(y => y.id !== x.id);
        if (editId === x.id) editId = "";
        SeMIS.save(); paintBox(); refreshViews(); toast("삭제했습니다.");
      });
    };
    openModal(`<h3>하드카피 기록 <small class="au-mh">${esc(bno(f))} ${esc(f.title)}</small></h3>
      <div id="hcs-body"></div>
      <div class="modal-actions">${w ? '<button type="button" class="btn btn-ghost hidden" data-act="new">새 기록</button><span class="spacer"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">닫기</button>${w ? '<button type="button" class="btn btn-primary" data-act="ok">추가</button>' : ""}</div>`, { wide: true });
    paintBox();
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const nw = $("#modal-box [data-act=new]"); if (nw) nw.onclick = () => { editId = ""; paintBox(); };
    const okb = $("#modal-box [data-act=ok]");
    if (okb) okb.onclick = () => {
      const date = $("#hcs-date").value, insp = norm($("#hcs-insp").value), note = norm($("#hcs-note").value);
      const fv = $("#hcs-find").value, ov = $("#hcs-open").value;
      const fd = fv === "" ? 0 : Math.round(Number(fv)), op = ov === "" ? 0 : Math.round(Number(ov));
      if (!isISO(date) || date > t0) { toast("점검일을 확인하세요.", true); return; }
      if (!Number.isFinite(fd) || !Number.isFinite(op) || fd < 0 || op < 0 || fd > 999) { toast("건수를 확인하세요.", true); return; }
      if (op > fd) { toast("미결은 지적 건수보다 많을 수 없습니다.", true); $("#hcs-open").focus(); return; }
      const now = new Date().toISOString();
      const x = editId ? list().find(y => y.id === editId) : null;
      if (x) Object.assign(x, { date, insp, find: fd, open: op, note, updatedAt: now, updatedBy: me() });
      else list().push({ id: uid("sh"), form: f.id, hc: true, date, insp, find: fd, open: op, note, createdAt: now, createdBy: me() });
      remember(LS_INSP, insp);
      editId = "";
      SeMIS.save(); paintBox(); refreshViews(); toast("저장했습니다.");
    };
  }

  /* ═════════ 일정관리 연동 (v1.35) — 기간 [from, to]: 다음 자체 점검 기한(같은 날 묶음) · 완료한 점검(전산 · 하드카피) ═════════ */
  function calItems(from, to, today) {
    today = today || todayISO();
    const out = [];
    if (!isISO(from) || !isISO(to) || from > to) return out;
    const w = canW();
    const dash = { lb: "점검 · 교육 대시보드", ico: "grid", run: () => SeMIS.navigate("aud-dash") };
    const toForms = () => { tab = "forms"; rid = ""; if (routeNow() === MOD) SeMIS.renderView(); else SeMIS.navigate(MOD); };
    const by = {};
    forms().forEach(f => { const n = nextDue(f, today); if (isISO(n.due) && n.due >= from && n.due <= to) (by[n.due] = by[n.due] || []).push({ f, n }); });
    Object.keys(by).forEach(d => {
      const fs = by[d], one = fs.length === 1 ? fs[0].f : null;
      out.push({ ik: "scd:" + d, start: d, end: d, title: "[점검] " + (one ? bno(one) + " 자체 점검" : "자체 보안점검 " + fs.length + "종"), done: false, late: d < today, color: "red",
        sub: [fs.map(x => bno(x.f)).join(" · "), fs[0].n.why === "수검 전" && fs[0].n.audit ? "국토부 수검 " + dot(fs[0].n.audit.start).slice(5) + " 전" : selfCfg().cycOnly,
          fs.some(x => isDim(x.f)) ? VIS_MSG : ""].filter(Boolean).join(" · "),
        go: [{ lb: one ? (isDim(one) ? "하드카피 기록" : "점검표") : "양식", ico: "clipboard", run: one && w ? () => startForm(one.id) : toForms }, dash] });
    });
    recs().filter(r => r.status === "done" && r.date >= from && r.date <= to).forEach(r => { const f = formOf(r.form);
      out.push({ ik: "scr:" + r.id, start: r.date, end: r.date, title: "[점검] " + bno(f) + " 자체 점검", done: true, late: false, color: "red",
        sub: [f.title, r.insp].filter(Boolean).join(" · "), go: [{ lb: "점검 기록", ico: "clipboard", run: () => openRecord(r.id) }, dash] }); });
    hcRecs().filter(r => r.date >= from && r.date <= to).forEach(r => { const f = formOf(r.form);
      out.push({ ik: "scr:" + r.id, start: r.date, end: r.date, title: "[점검] " + bno(f) + " 자체 점검", done: true, late: false, color: "red",
        sub: [f.title, r.insp, "하드카피"].filter(Boolean).join(" · "), go: [{ lb: "하드카피 기록", ico: "clipboard", run: () => hcForm(f.id) }, dash] }); });
    return out;
  }

  /* ═════════ 지적 · 조치 ═════════ */
  function fxRows() {
    const t = todayISO();
    return allFindings().filter(x => !fOpen || fState(x.fx, t) !== "done")
      .sort((a, b) => ({ late: 0, open: 1, done: 2 })[fState(a.fx, t)] - ({ late: 0, open: 1, done: 2 })[fState(b.fx, t)] || String(a.fx.due || "9").localeCompare(String(b.fx.due || "9")) || b.r.date.localeCompare(a.r.date));
  }
  function fxHTML() {
    const rows = fxRows(), t = todayISO();
    const fs = allFindings();
    const none = fs.filter(x => !x.fx.cat).length;
    return `<section class="card" id="sc-fx">
      <div class="toolbar"><button type="button" class="pb-chk" id="sc-fopen" aria-pressed="${fOpen}">${icon("alert", 14)}<span>미결만</span></button>
        <span class="cell-sub">전체 ${fs.length} · 분야 미지정 ${none}</span></div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap sc-tbl">
        <thead><tr><th>점검일</th><th>양식 · 항목</th><th>문제점 분야</th><th>이행 구분</th><th>기한</th><th>상태</th></tr></thead>
        <tbody>${rows.map(x => {
          const s = fState(x.fx, t);
          return `<tr data-scfx="${esc(x.r.id)}|${esc(x.it.id)}" tabindex="0" class="is-click">
            <td><span class="mono">${esc(dot(x.r.date))}</span></td>
            <td data-role="title"><span class="cell-sub">${esc(bno(x.f))} ${esc(x.it.sn ? x.it.sn + "." : "")}${esc(x.it.l ? " " + x.it.l + "." : "")}</span> ${esc(itemTitle(x.it, x.r))}${x.fx.act ? `<div class="cell-sub">조치: ${esc(x.fx.act)}</div>` : ""}</td>
            <td>${x.fx.cat ? esc(catLabel(x.fx.cat)) : '<span class="cell-sub">미지정</span>'}</td>
            <td>${x.fx.term ? esc(TERMS[x.fx.term] || "") : "-"}</td>
            <td><span class="mono">${esc(dot(x.fx.due) || "-")}</span>${x.fx.done ? `<div class="cell-sub mono">완료 ${esc(dot(x.fx.done))}</div>` : ""}</td>
            <td>${ui.chip(FST[s][0], FST[s][1])}</td></tr>`;
        }).join("")}</tbody></table></div>` : ui.empty(fs.length ? "미결 지적이 없습니다." : "R/C · 미흡으로 표시한 항목이 없습니다.")}
    </section>`;
  }
  const itemTitle = (it, r) => it.k === "eq" ? (it.g ? it.g.replace(/\s+/g, " ") + " · " : "") + (it.t || nmOf(r, it.id) || "장비") : it.t;

  /* ═════════ 문제점 분석 (별표 15) ═════════ */
  function anaHTML() {
    const f = anaForm();
    if (!f) return ui.empty("분석표 양식이 없습니다.");
    const y = anaYear();
    const hasAud = auditFindings().length > 0;
    const A = analysis(y, anaAudit && hasAud);
    const ys = years();
    if (ys.indexOf(y) < 0) ys.unshift(y);
    return `<section class="card" id="sc-ana">
      <div class="toolbar">
        <label class="ck-f"><span>연도</span><select id="sc-ay">${ys.map(v => `<option value="${v}" ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        ${hasAud ? `<button type="button" class="pb-chk" id="sc-aaud" aria-pressed="${anaAudit}">${icon("check", 14)}<span>수검 지적 포함</span></button>` : ""}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="sc-apv">${icon("eye", 15)}<span>미리보기</span></button>
        <button type="button" class="btn btn-ghost btn-sm" id="sc-adl">${icon("down", 15)}<span>HWPX</span></button>
      </div>
      <div class="table-wrap"><table class="tbl sc-ana tbl-keep">
        <thead><tr><th class="sc-ana-g">구분</th><th>세부사항</th><th class="num">${esc(y)}<span class="sc-dk">년 발생</span></th><th class="num">${esc(String(Number(y) - 1))}<span class="sc-dk">년</span></th><th class="num">증감<span class="sc-dk">률(</span>%<span class="sc-dk">)</span></th></tr></thead>
        <tbody>${f.cats.map(c => `<tr class="sc-ana-cat"><th colspan="4">${esc(c.n)}</th></tr>` + c.items.map((it, i) => `<tr>${i ? "" : `<th scope="rowgroup" class="sc-ana-g" rowspan="${c.items.length}">${esc(c.n)}</th>`}
          <td>${esc(it.t)}</td><td class="num mono">${A.cnt[it.id] || 0}</td><td class="num mono">${A.prev[it.id] || 0}</td><td class="num mono">${esc(pctText(A, it.id) || "-")}</td></tr>`).join("")).join("")}
          <tr class="sc-ana-sum"><th class="sc-ana-g"></th><th>합계</th><td class="num mono">${A.total}</td><td class="num mono">${A.ptotal}</td><td class="num mono">${A.ptotal ? esc(((A.total - A.ptotal) / A.ptotal * 100 > 0 ? "+" : "") + Math.round((A.total - A.ptotal) / A.ptotal * 100)) : "-"}</td></tr>
        </tbody></table></div>
      <p class="sc-src">${A.none ? `분야 미지정 ${A.none}건은 집계에서 빠집니다. ` : ""}${A.fromAudit ? `수검 지적 ${A.fromAudit}건 포함. ` : ""}전년 0건인 세부사항의 증감률은 '-'.</p>
    </section>`;
  }

  /* ═════════ 기록 화면 ═════════ */
  const segHTML = (f, it, a, dis) => `<div class="sc-seg${f.kind === "fsc" ? " is-gp" : ""}" role="group" aria-label="${esc(it.l ? it.l + "." : it.t || "결과")}">${CHOICE[f.kind].map(([v, lb]) =>
    `<button type="button" data-sv="${v}" aria-pressed="${a === v}"${dis}>${lb}</button>`).join("")}</div>`;
  function fxBoxHTML(r, it, dis) {
    const fx = fxOf(r, it.id), id = it.id, k = "fx|" + id + "|";
    const st = fState(fx);
    return `<div class="sc-fxbox" data-fxbox="${esc(id)}">
      <div class="sc-fxh">${ui.chip(FST[st][0], FST[st][1])}<span>지적 · 조치</span></div>
      <div class="sc-fxg">
        <label><span>문제점 분야</span>${catSelect("sc-cat-" + id.replace(/[^\w가-힣.-]/g, "_"), fx.cat || "", `data-k="${esc(k)}cat"${dis}`)}</label>
        <label><span>이행 구분</span><select data-k="${esc(k)}term"${dis}><option value="">선택</option>${TERM_KEYS.map(t => `<option value="${t}" ${fx.term === t ? "selected" : ""}>${esc(TERMS[t])}</option>`).join("")}</select></label>
        <label><span>조치 기한</span><input type="date" data-k="${esc(k)}due" value="${esc(fx.due || "")}"${dis}></label>
        <label><span>완료일</span><input type="date" data-k="${esc(k)}done" value="${esc(fx.done || "")}"${dis}></label>
      </div>
      <label class="sc-fxa"><span>지적 내용 · 조치</span><textarea rows="2" maxlength="1000" data-k="${esc(k)}act"${dis}>${esc(fx.act || "")}</textarea></label>
    </div>`;
  }
  function itemHTML(f, r, it, dis) {
    const a = ansOf(r, it.id);
    const head = `<div class="sc-q">${it.l ? `<span class="sc-l">${esc(it.l)}.</span>` : ""}<span class="sc-t">${esc(it.t)}</span></div>`;
    if (it.k === "yn" || it.k === "gp") {
      return `<li class="sc-it is-ch" data-iid="${esc(it.id)}" data-a="${esc(a)}">${head}${segHTML(f, it, a, dis)}${isFind(f, it, a) ? fxBoxHTML(r, it, dis) : ""}</li>`;
    }
    if (it.k === "eq") {
      const nm = it.t ? `<span class="sc-t">${esc(it.t)}</span>` : `<input class="sc-nm" data-k="nm|${esc(it.id)}" value="${esc(nmOf(r, it.id))}" maxlength="40" placeholder="장비명 (예: 폭발물흔적탐지장비)" aria-label="장비명"${dis}>`;
      return `<li class="sc-it is-ch is-eq" data-iid="${esc(it.id)}" data-a="${esc(a)}"><div class="sc-q">${nm}</div>${segHTML(f, it, a, dis)}
        <input class="sc-rmi" data-k="rm|${esc(rmKey(it.rm))}" value="${esc(rmOf(r, rmKey(it.rm)))}" maxlength="200" placeholder="비고 (주요내용)" aria-label="비고"${dis}>
        ${isFind(f, it, a) ? fxBoxHTML(r, it, dis) : ""}</li>`;
    }
    if (it.k === "tx") {
      const v = txtOf(r, it.id);
      return `<li class="sc-it is-tx" data-iid="${esc(it.id)}">${head}<textarea class="sc-ta" rows="${Math.min(8, Math.max(2, v.split("\n").length))}" maxlength="3000" data-k="tx|${esc(it.id)}" placeholder="${esc(it.d || "")}"${dis}>${esc(v)}</textarea></li>`;
    }
    if (it.k === "pr") {
      const vs = arrOf(r, it.id, it.p.length);
      return `<li class="sc-it is-tx" data-iid="${esc(it.id)}">${head}<div class="sc-prs">${it.p.map((pp, i) =>
        `<label><span>${esc(pp.replace(/^-\s*/, "").replace(/\s*:$/, ""))}</span><input data-k="pr|${esc(it.id)}|${i}" value="${esc(vs[i])}" maxlength="300"${dis}></label>`).join("")}</div></li>`;
    }
    if (it.k === "un") {
      const vs = arrOf(r, it.id, it.u.length);
      return `<li class="sc-it is-un" data-iid="${esc(it.id)}">${head}<div class="sc-uns">${it.u.map(([l, u], i) =>
        `<label>${l ? `<span>${esc(l)}</span>` : ""}<input data-k="un|${esc(it.id)}|${i}" value="${esc(vs[i])}" maxlength="12" inputmode="decimal"${dis}><span>${esc(u)}</span></label>`).join("")}</div></li>`;
    }
    return "";
  }
  function sectionsHTML(f, r, dis) {
    return (f.secs || []).map((s, si) => {
      const its = itemsOf(f).filter(it => it.si === si);
      let body = "", grp = "", sub = "";
      its.forEach((it, i) => {
        if (it.k === "eq" && it.g !== grp) { grp = it.g; body += `<li class="sc-grp">${esc(grp.replace(/\s+/g, " "))}</li>`; }
        if (it.k === "gp" && it.sub && it.sub !== sub) { sub = it.sub; body += `<li class="sc-grp">${esc(sub)}</li>`; }
        body += itemHTML(f, r, it, dis);
        const nx = its[i + 1];
        if (it.k === "gp" && it.rm && (!nx || rmKey(nx.rm) !== rmKey(it.rm))) {
          const k = rmKey(it.rm);
          body += `<li class="sc-rm"><label><span>비고</span><textarea rows="2" maxlength="1000" data-k="rm|${esc(k)}"${dis}>${esc(rmOf(r, k))}</textarea></label></li>`;
        }
      });
      const ch = its.filter(isChoice), done = ch.filter(it => ansOf(r, it.id)).length;
      return `<section class="card sc-sec" data-si="${si}">
        <h2 class="card-title">${esc(s.n)}. ${esc(s.title)}${ch.length ? `<span class="dc-meta" data-secprog="${si}">${done}/${ch.length}</span>` : ""}</h2>
        ${s.note ? `<p class="sc-note">※ ${esc(s.note)}</p>` : ""}
        <ol class="sc-items">${body}</ol>
      </section>`;
    }).join("");
  }
  function recordPage(root) {
    const r = recOf(rid);
    const f = formOf(r.form);
    const w = canW();
    const dis = w ? "" : " disabled";
    const c = counts(r);
    const head = `<div class="page-head sc-head">
        <button type="button" class="btn btn-ghost btn-sm sc-back" data-keep data-scback aria-label="점검 기록으로">${icon("chevl", 16)}<span>목록</span></button>
        <div class="page-title">${esc(bno(f))} ${esc(f.title)}</div><span class="page-meta">${esc(dot(r.date))}${r.insp ? " · " + esc(r.insp) : ""}</span>
        <span class="spacer"></span>
        ${w ? (r.status === "done" ? `<button type="button" class="btn btn-ghost btn-sm" id="sc-reopen">${icon("edit", 16)}<span>다시 열기</span></button>`
          : `<button type="button" class="btn btn-primary btn-sm" id="sc-done">${icon("check", 16)}<span>점검 완료</span></button>`) : ""}
        <button type="button" class="btn btn-ghost btn-sm" id="sc-hwpx">${icon("down", 16)}<span>HWPX</span></button>
        <button type="button" class="btn btn-ghost btn-sm" id="sc-pv">${icon("eye", 16)}<span>미리보기</span></button>
        <button type="button" class="btn btn-ghost btn-sm no-print" id="sc-print" data-print-btn="1" title="별표 양식으로 인쇄">${icon("print", 17)}<span>Print</span></button>
        ${canDel(r) ? `<button type="button" class="btn btn-ghost btn-sm m-ed" id="sc-del">${icon("trash", 16)}<span>삭제</span></button>` : ""}
      </div>`;
    const appr = f.kind === "fsc" ? `<div class="sc-apprw"><div class="sc-appr-h">결재란</div><div class="sc-appr">${f.head.apprL.map((lb, i) =>
      `<label><span>${esc(lb)}</span><input data-k="appr|${i}" value="${esc((r.appr || [])[i] || "")}" maxlength="20"${i === 0 ? ' placeholder="점검자와 같음"' : ""}${dis}></label>`).join("")}</div></div>` : "";
    const info = `<section class="card sc-info">
      <div class="sc-mark">${tagsHTML(f)}<span class="sc-mark-t">${esc(offText(f))}</span></div>
      <div class="sc-infog">
        <label><span>점검일</span><input type="date" data-k="date" value="${esc(r.date)}" max="${esc(todayISO())}"${dis}></label>
        <label><span>${f.kind === "insp" ? "점검자 (양식 '감독관' 칸)" : "점검자"}</span><input data-k="insp" value="${esc(r.insp || "")}" maxlength="40" list="sc-dl-insp" autocomplete="off"${dis}></label>
        ${f.kind === "insp" ? `<label><span>수검자 및 기관</span><input data-k="org" value="${esc(r.org || "")}" maxlength="60" list="sc-dl-org" autocomplete="off"${dis}></label>` : ""}
      </div>
      ${appr}
      <div class="sc-prog"><span id="sc-prog">${esc(resultText(r, c) || "응답 없음")}</span>
        <span class="cell-sub">${esc(keepText(r))}</span>
        ${w && c.need > c.done ? `<button type="button" class="btn btn-ghost btn-sm" id="sc-fillrest">${icon("check", 15)}<span>남은 항목 ${f.kind === "fsc" ? "양호" : "Y"}</span></button>` : ""}</div>
    </section>`;
    const tail = `<section class="card sc-sec">
      <h2 class="card-title">메모 · 첨부<span class="dc-meta">시스템에만 남음</span></h2>
      <textarea class="sc-ta" rows="2" maxlength="2000" data-k="note" aria-label="메모"${dis}>${esc(r.note || "")}</textarea>
      <div class="au-files" id="sc-files">${fileChips(r.files)}</div>
      ${w ? `<input type="file" id="sc-file" multiple hidden><button type="button" class="btn btn-ghost btn-sm" id="sc-fbtn">${icon("link", 15)}<span>사진 · 파일</span></button>` : ""}
    </section>`;
    root.innerHTML = `<div class="sc-page" id="sc-page">` + head + info + sectionsHTML(f, r, dis) + tail
      + `</div><datalist id="sc-dl-insp">${names("insp").map(n => `<option value="${esc(n)}">`).join("")}</datalist><datalist id="sc-dl-org">${names("org").map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
    wireRecord($("#sc-page", root));
    if (focusItem) {
      const el = root.querySelector(`[data-iid="${cssEsc(focusItem)}"]`);
      focusItem = "";
      if (el && el.scrollIntoView) try { el.scrollIntoView({ block: "center" }); el.classList.add("is-flash"); } catch (e) { /* jsdom */ }
    }
  }
  function names(k) {
    const s = new Set();
    recs().forEach(r => { if (norm(r[k])) s.add(norm(r[k])); });
    if (k === "org") s.add(DEF_ORG);
    return Array.from(s).slice(0, 30);
  }

  /* ─────── 입력 반영 — 화면을 다시 그리지 않고 기록만 고친다(한글 입력 보호) ─────── */
  let saveT = null;
  function saveSoon(now) {
    if (saveT) { clearTimeout(saveT); saveT = null; }
    if (now) { SeMIS.save(); return; }
    saveT = setTimeout(() => { saveT = null; SeMIS.save(); }, 600);
  }
  function applyField(r, k, el) {
    const v = el.value;
    const parts = k.split("|");
    const f = formOf(r.form);
    switch (parts[0]) {
      case "date": if (isISO(v) && v <= todayISO()) r.date = v; break;
      case "insp": r.insp = norm(v); break;
      case "org": r.org = norm(v); break;
      case "note": r.note = normText(v); break;
      case "appr": { if (!Array.isArray(r.appr)) r.appr = ["", "", ""]; r.appr[Number(parts[1])] = norm(v); break; }
      case "tx": bag(r, "txt")[parts[1]] = normText(v); break;
      case "pr": case "un": {
        const it = itemsOf(f).find(x => x.id === parts[1]);
        const n = it ? (it.p || it.u || []).length : 0;
        const a = arrOf(r, parts[1], n);
        a[Number(parts[2])] = norm(v);
        bag(r, "txt")[parts[1]] = a;
        break;
      }
      case "nm": bag(r, "nm")[parts[1]] = norm(v); break;
      case "rm": bag(r, "rm")[parts[1]] = normText(v); break;
      case "fx": {
        const fx = bag(r, "fx")[parts[1]] = Object.assign({}, fxOf(r, parts[1]));
        const fld = parts[2];
        if (fld === "act") fx.act = normText(v);
        else if (fld === "cat") fx.cat = catOf(v) ? v : "";
        else if (fld === "term") fx.term = TERMS[v] ? v : "";
        else if (fld === "due" || fld === "done") fx[fld] = isISO(v) ? v : "";
        break;
      }
      default: return false;
    }
    touch(r);
    return true;
  }
  function wireRecord(page) {
    const root = page;
    const R = () => recOf(rid);
    const onEdit = (now) => (ev) => {
      const el = ev.target.closest("[data-k]");
      if (!el || !canW()) return;
      const r = R();
      if (!r) return;
      const k = el.dataset.k;
      if (!applyField(r, k, el)) return;
      if (k.indexOf("fx|") === 0 && /\|term$/.test(k)) {   // 이행 구분 → 기한 제안(비어 있을 때)
        const id = k.split("|")[1], fx = r.fx[id];
        const due = termDue(fx.term, r.date);
        if (due && !fx.due) { fx.due = due; const de = page.querySelector(`[data-k="fx|${cssEsc(id)}|due"]`); if (de) de.value = due; }
      }
      if (k.indexOf("fx|") === 0) repaintFxHead(root, r, k.split("|")[1]);
      if (k === "insp") remember(LS_INSP, r.insp);
      if (k === "org") remember(LS_ORG, r.org);
      if (k === "date" || k === "insp") { const m = root.querySelector(".sc-head .page-meta"); if (m) m.textContent = dot(r.date) + (r.insp ? " · " + r.insp : ""); }
      saveSoon(now);
    };
    root.addEventListener("input", onEdit(false));
    root.addEventListener("change", onEdit(true));
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-sv]");
      if (!b || !canW()) return;
      const li = b.closest("[data-iid]");
      const r = R();
      if (!li || !r) return;
      const f = formOf(r.form);
      const id = li.dataset.iid, it = itemsOf(f).find(x => x.id === id);
      if (!it) return;
      const cur = ansOf(r, id), v = cur === b.dataset.sv ? "" : b.dataset.sv;
      const ans = bag(r, "ans");
      if (v) ans[id] = v; else delete ans[id];
      touch(r);
      saveSoon(true);
      repaintItem(root, r, f, it);
    });
    const back = $("[data-scback]", root); if (back) back.onclick = backToList;
    const bd = $("#sc-done", root); if (bd) bd.onclick = () => finish(R());
    const br = $("#sc-reopen", root); if (br) br.onclick = () => { const r = R(); if (!r) return; r.status = "draft"; touch(r); SeMIS.save(); repaint(); };
    const bh = $("#sc-hwpx", root); if (bh) bh.onclick = () => { flush(); downloadRecord(R()); };
    const bp = $("#sc-pv", root); if (bp) bp.onclick = () => { flush(); printRecord(R(), true); };
    const bpr = $("#sc-print", root); if (bpr) bpr.onclick = () => { flush(); printRecord(R(), false); };
    const bdel = $("#sc-del", root); if (bdel) bdel.onclick = () => {
      const r = R(); if (!r) return;
      confirmModal(`${fname(formOf(r.form))} ${dot(r.date)} 기록을 삭제합니다.`, () => {
        D()[KEY] = list().filter(x => x.id !== r.id);
        rid = ""; SeMIS.save(); backToList(); toast("삭제했습니다.");
      });
    };
    const fr = $("#sc-fillrest", root); if (fr) fr.onclick = () => {
      const r = R(); if (!r) return;
      const f = formOf(r.form), v = f.kind === "fsc" ? "G" : "Y";
      const ans = bag(r, "ans");
      itemsOf(f).forEach(it => { if (isChoice(it) && !ans[it.id] && !(it.k === "eq" && !it.t && !nmOf(r, it.id))) ans[it.id] = v; });
      touch(r); SeMIS.save(); repaint();
    };
    const fb = $("#sc-fbtn", root), fi = $("#sc-file", root);
    if (fb && fi) { fb.onclick = () => fi.click(); fi.onchange = () => { const fl = Array.from(fi.files || []); fi.value = ""; upload(fl); }; }
  }
  const flush = () => { if (saveT) saveSoon(true); };
  function repaintItem(root, r, f, it) {
    const li = root.querySelector(`li[data-iid="${cssEsc(it.id)}"]`);
    if (!li) return;
    const a = ansOf(r, it.id);
    li.dataset.a = a;
    $$("[data-sv]", li).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sv === a)));
    const box = $(".sc-fxbox", li);
    if (isFind(f, it, a) && !box) li.insertAdjacentHTML("beforeend", fxBoxHTML(r, it, ""));
    else if (!isFind(f, it, a) && box) box.remove();
    const c = counts(r);
    const pg = $("#sc-prog", root); if (pg) pg.textContent = resultText(r, c) || "응답 없음";
    const sp2 = root.querySelector(`[data-secprog="${it.si}"]`);
    if (sp2) { const ch = itemsOf(f).filter(x => x.si === it.si && isChoice(x)); sp2.textContent = ch.filter(x => ansOf(r, x.id)).length + "/" + ch.length; }
  }
  function repaintFxHead(root, r, id) {
    const box = root.querySelector(`[data-fxbox="${cssEsc(id)}"] .sc-fxh`);
    if (!box) return;
    const st = fState(fxOf(r, id));
    box.innerHTML = `${ui.chip(FST[st][0], FST[st][1])}<span>지적 · 조치</span>`;
  }
  function finish(r) {
    if (!r) return;
    flush();
    const c = counts(r);
    const go = () => { r.status = "done"; touch(r); SeMIS.save(); repaint(); toast("점검을 완료했습니다."); };
    if (c.need > c.done) confirmModal(`미응답 ${c.need - c.done}개가 남아 있습니다. 그대로 완료할까요?`, go);
    else go();
  }
  async function upload(arr) {
    const r = recOf(rid);
    if (!r || !arr.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of arr) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("올리는 중: " + file.name);
      try {
        const up = await SemisSync.uploadFile(file, FOLDER);
        const x = recOf(rid) || r;
        if (!Array.isArray(x.files)) x.files = [];
        x.files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url });
        touch(x); SeMIS.save();
      } catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    repaint();
  }

  /* ─────── 새 점검 ─────── */
  function newRecord(fid) {
    if (!canW()) return;
    const f = formOf(fid);
    if (!f || f.kind === "ana" || isHid(f.id)) return;
    if (isDim(f)) return hcForm(f.id);
    const r = { id: uid("sc"), form: f.id, date: todayISO(), insp: recall(LS_INSP) || "", org: f.kind === "insp" ? (recall(LS_ORG) || DEF_ORG) : "",
      appr: f.kind === "fsc" ? ["", "", ""] : undefined, ans: {}, txt: {}, rm: {}, nm: {}, fx: {}, note: "", files: [], status: "draft",
      createdAt: new Date().toISOString(), createdBy: me() };
    if (!r.appr) delete r.appr;
    list().push(r);
    SeMIS.save();
    openRecord(r.id);
  }
  /* 점검표 바로 가기 — 작성 중 기록이 있으면 그것을, 없으면 새로 */
  function startForm(fid) {
    if (!canW()) return;
    const f = formOf(fid);
    if (!f || f.kind === "ana" || isHid(f.id)) return;
    if (isDim(f)) return hcForm(f.id);
    const d = recs().filter(r => r.form === f.id && r.status !== "done").sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0];
    if (d) openRecord(d.id); else newRecord(f.id);
  }
  function pickForm() {
    openModal(`<h3>점검할 양식</h3><div class="sl-pick">${forms().filter(f => !isDim(f)).map(f => `<button type="button" class="sl-pbtn" data-pick="${esc(f.id)}"><b>${esc(bno(f))} ${esc(f.title)}</b><span>감독관: ${esc(offText(f))}</span><span>자체: ${esc(selfText(f, todayISO()))}</span></button>`).join("")}</div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $$("[data-pick]").forEach(b => b.onclick = () => { closeModal(); newRecord(b.dataset.pick); });
  }

  /* ─────── 화면 이동 (기록 화면 — 브라우저 뒤로 = 목록) ─────── */
  function openRecord(id, item) {
    if (!recOf(id)) return;
    rid = id; focusItem = item || "";
    if (routeNow() !== MOD) { pendingOpen = true; SeMIS.navigate(MOD); return; }
    try { history.pushState({ sc: "r:" + id }, "", location.hash); } catch (e) { /* noop */ }
    SeMIS.renderView();
  }
  function backToList() {
    flush();
    const st = typeof history !== "undefined" && history.state && history.state.sc;
    if (st) { try { history.back(); return; } catch (e) { /* 아래로 */ } }
    rid = ""; SeMIS.renderView();
  }
  if (typeof window !== "undefined") window.addEventListener("popstate", () => {
    if (routeNow() !== MOD) return;
    const st = String((history.state && history.state.sc) || "");
    const nr = st.indexOf("r:") === 0 ? st.slice(2) : "";
    if (nr === rid) return;
    flush();
    rid = nr; SeMIS.renderView();
  });

  /* ═════════ 렌더 ═════════ */
  function bodyHTML() { return tab === "forms" ? formsHTML() : tab === "fx" ? fxHTML() : tab === "ana" ? anaHTML() : listHTML(); }
  function wire(box) {
    const qi = $("#sc-q", box);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const b = document.getElementById("sc-lbody");
      if (b) { b.innerHTML = listBodyHTML(); wire(b); }
    };
    const ff = $("#sc-fform", box); if (ff) ff.onchange = () => { fForm = ff.value; paint(); };
    const fy = $("#sc-fyear", box); if (fy) fy.onchange = () => { fYear = fy.value; paint(); };
    const fo = $("#sc-fopen", box); if (fo) fo.onclick = () => { fOpen = !fOpen; paint(); };
    const ay = $("#sc-ay", box); if (ay) ay.onchange = () => { anaY = ay.value; paint(); };
    const aa = $("#sc-aaud", box); if (aa) aa.onclick = () => { anaAudit = !anaAudit; paint(); };
    const apv = $("#sc-apv", box); if (apv) apv.onclick = () => printAna(true);
    const adl = $("#sc-adl", box); if (adl) adl.onclick = () => downloadAna(anaYear(), anaAudit && auditFindings().length > 0, anaOrg());
    $$("[data-sc-new]", box).forEach(b => b.onclick = () => startForm(b.dataset.scNew));
    $$("[data-sc-hc]", box).forEach(b => b.onclick = () => hcForm(b.dataset.scHc));
    $$("tr[data-schc]", box).forEach(tr => {
      tr.onclick = () => hcForm(tr.dataset.schc);
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); hcForm(tr.dataset.schc); } };
    });
    $$("[data-sc-blank]", box).forEach(b => b.onclick = () => { const f = formOf(b.dataset.scBlank); if (f) printBlank(f, true); });
    $$("[data-sc-bdl]", box).forEach(b => b.onclick = () => { const f = formOf(b.dataset.scBdl); if (f) blankDownload(f); });
    $$("[data-sc-tab]", box).forEach(b => b.onclick = () => { tab = b.dataset.scTab; SeMIS.renderView(); });
    $$("tr[data-scid]", box).forEach(tr => {
      const open = () => openRecord(tr.dataset.scid);
      tr.onclick = (ev) => { if (ev.target.closest("a")) return; open(); };
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
    $$("tr[data-scfx]", box).forEach(tr => {
      const [id, item] = tr.dataset.scfx.split("|");
      tr.onclick = () => openRecord(id, item);
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); openRecord(id, item); } };
    });
  }
  function paint() {
    if (routeNow() !== MOD) return;
    if (rid) { SeMIS.renderView(); return; }
    const box = document.getElementById("sc-body");
    if (!box) { SeMIS.renderView(); return; }
    box.innerHTML = bodyHTML();
    wire(box);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
    if (SeMIS.tidyView) try { SeMIS.tidyView(); } catch (e) { /* 정돈만 영향 */ }
  }
  const repaint = () => { if (routeNow() === MOD) SeMIS.renderView(); if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* noop */ } };
  /* 하드카피 기록은 대시보드 · 일정관리에서도 연다 — 그 화면도 다시 그림 */
  const refreshViews = () => { const r = routeNow(); if (r === MOD || r === "aud-dash" || r === "schedule") SeMIS.renderView(); if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* noop */ } };
  /* 원격 변경으로 다시 그릴 때 입력 중 칸 · 커서를 지킨다 */
  function captureFocus(root) {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    if (!a || !root.contains(a) || !a.dataset || !a.dataset.k) return null;
    let s = null, e = null;
    try { s = a.selectionStart; e = a.selectionEnd; } catch (err) { /* 선택 불가 */ }
    return { k: a.dataset.k, value: a.value, s, e, rid };
  }
  function restoreFocus(root, f) {
    if (!f || f.rid !== rid) return;
    const el = Array.from(root.querySelectorAll("[data-k]")).find(x => x.dataset.k === f.k);
    if (!el || el.disabled) return;
    if (el.value !== f.value) {
      el.value = f.value;
      const r = recOf(rid);
      if (r && applyField(r, f.k, el)) saveSoon(false);
    }
    try { el.focus(); if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (err) { /* date · select */ }
  }
  function render(root) {
    const st = String((typeof history !== "undefined" && history.state && history.state.sc) || "");
    if (pendingOpen) {
      pendingOpen = false;
      if (rid) try { history.replaceState({ sc: "r:" + rid }, "", location.hash); } catch (e) { /* noop */ }
    } else if (st) rid = st.indexOf("r:") === 0 ? st.slice(2) : "";
    else rid = "";
    if (rid && !recOf(rid)) rid = "";
    if (rid) {
      const fcs = captureFocus(root);
      recordPage(root);
      restoreFocus(root, fcs);
      return;
    }
    const w = canW();
    const acts = [
      w ? `<button type="button" class="btn btn-primary btn-sm" id="sc-add">${icon("plus", 16)}<span>점검</span></button>` : "",
      tab === "forms" && SeMIS.canEdit() ? `<button type="button" class="btn btn-ghost btn-sm m-ed" id="sc-cfg" title="누가 · 누구를 · 주기">${icon("edit", 16)}<span>안내 편집</span></button>` : "",
      tab === "forms" && SeMIS.isAdmin() ? `<button type="button" class="btn btn-ghost btn-sm m-ed" id="sc-vis" title="표시 · 흐리게 · 숨김">${icon("eye", 16)}<span>표시 관리</span></button>` : "",
      tab === "ana" ? `<button type="button" class="btn btn-ghost btn-sm no-print" id="sc-aprint" data-print-btn="1" title="별표 15 양식으로 인쇄">${icon("print", 17)}<span>Print</span></button>` : ""
    ].join("");
    root.innerHTML = ui.head({ title: TITLE, meta: MARK + " — 항공보안감독관 점검표(수준관리지침 별표) 사용", actions: acts })
      + `<div class="eq-tabs" role="tablist" aria-label="자체 보안점검 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-sctab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>`
      + `<div id="sc-body" data-tab="${tab}">${bodyHTML()}</div>`;
    $$("[data-sctab]", root).forEach(b => b.onclick = () => { tab = b.dataset.sctab; SeMIS.renderView(); });
    const ab = $("#sc-add", root); if (ab) ab.onclick = pickForm;
    const cb = $("#sc-cfg", root); if (cb) cb.onclick = cfgForm;
    const vb = $("#sc-vis", root); if (vb) vb.onclick = visForm;
    const ap = $("#sc-aprint", root); if (ap) ap.onclick = () => printAna(false);
    wire(root);
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { if (!canW()) return ""; const t = todayISO(); return (allFindings().filter(x => fState(x.fx, t) !== "done").length + hcOpen()) || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "clipboard", module: MOD,
    items: () => recs().slice(-300).map(r => { const f = formOf(r.form); return {
      title: fname(f) + " " + dot(r.date), sub: [r.insp, r.org, r.status === "done" ? "완료" : "작성 중"].filter(Boolean).join(" · "),
      text: [f.title, r.insp, r.org, r.note], route: MOD, pick: () => { rid = r.id; pendingOpen = true; } }; })
  });

  window.SemisSelfcheck = {
    KEY, forms, formOf, anaForm, itemsOf, counts, resultText, findingsOf, allFindings, fState, analysis, pctText, catOf, catLabel, cats,
    TERMS, termDue, isFind, evidence, fill, fillAna, fscLine, recordPkg, anaPkg, downloadRecord, downloadAna, printRecord, printBlank, printAna,
    newRecord, openRecord, startForm, backToList, applyField, keepText, fileName, dateText,
    MARK, OFFICIAL, SELF, offOf, nextDue, govAudit, dday, markPkg, selfCfg, cfgForm, offText, CYC_M,
    visOf, isDim, hcRecs, hcOpen, hcForm, visForm, VIS_MSG, calItems,
    lastPrint: () => lastPrint,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    getState() { return { tab, q, fForm, fYear, fOpen, rid, anaY, anaAudit }; },
    setState(o) {
      o = o || {};
      if (o.tab) tab = o.tab;
      if (o.q !== undefined) q = String(o.q || "");
      if (o.fForm !== undefined) fForm = String(o.fForm || "");
      if (o.fYear !== undefined) fYear = String(o.fYear || "");
      if (o.fOpen !== undefined) fOpen = !!o.fOpen;
      if (o.anaY !== undefined) anaY = String(o.anaY || "");
      if (o.anaAudit !== undefined) anaAudit = !!o.anaAudit;
      if (o.rid !== undefined) { rid = String(o.rid || ""); pendingOpen = !!rid; }
    }
  };
})();
