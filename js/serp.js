/* 팀위기대응계획 SERP(Station Emergency Response Plan) — 위기 시 통보 → 소집 → SERC 개설 → 시간대별 초동조치를 진행 · 기록.
   ※ 계획 원문 · 명단 · 번호는 공개 저장소에 넣지 않는다 — 공용 DB(semis_logi_store "serp")에만. */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "serp", KEY = "serp", RKEY = "serpRuns", TITLE = "팀위기대응계획 (SERP)";
  const LS_BY = "semisl:serp-by", LS_ROLE = "semisl:serp-role";
  const uid = (p) => (p || "sp") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

  /* ── 데이터 ──
     DATA.serp     계획 원문(절차 · 역할 · 인원 · 연락처 · 개정 이력) (읽기 2 · 쓰기 3)
     DATA.serpRuns [{ id, kind(real|drill), title, start, end, place, items[](초동조치 사본), cks[](체크리스트 사본),
                      tl{itemId:{at,by,note}}, ck{key:{at,by,note}}, notify{f{}, sent[]}, serc, log[], subs[] }] (읽기 2 · 쓰기 2) */
  const P = () => obj(SeMIS.data[KEY]);
  const roles = () => arr(P().roles).filter(r => r && r.id);
  const people = () => arr(P().people).filter(p => p && p.id);
  const timeline = () => arr(P().timeline).filter(x => x && x.id);
  const runs = () => arr(SeMIS.data[RKEY]).filter(r => r && r.id);
  const activeRun = () => runs().filter(r => !r.end).sort((a, b) => String(b.start).localeCompare(String(a.start)))[0] || null;
  const hasPlan = () => !!(P().title || roles().length || timeline().length);
  function ensurePlan() {
    const v = SeMIS.data[KEY];
    if (!v || typeof v !== "object" || Array.isArray(v)) SeMIS.data[KEY] = {};
    return SeMIS.data[KEY];
  }
  function ensureRuns() {
    if (!Array.isArray(SeMIS.data[RKEY])) SeMIS.data[RKEY] = [];
    return SeMIS.data[RKEY];
  }

  /* 역할 색 · 짧은 이름 — 역할 id 는 데이터(roles[].id). 보조 수행자(최초 인지 · 현장 · 업체)는 코드 */
  const TONE = { leader: "rose", sup: "blue", cargo: "amber", ext: "violet", hum: "green", first: "teal", field: "slate", vendor: "slate" };
  const SHORT = { leader: "리더", sup: "총괄", cargo: "화물", ext: "대외", hum: "인적 지원" };
  const AUX = { first: "최초 인지 직원", field: "현장 근무 직원", vendor: "교통지원 업체" };
  const roleOf = (id) => roles().find(r => r.id === id) || null;
  const roleName = (id) => (roleOf(id) || {}).name || AUX[id] || id;
  const roleShort = (id) => SHORT[id] || AUX[id] || roleName(id);
  const toneOf = (id) => TONE[id] || "slate";
  const rchip = (id, full) => `<span class="sp-rc t-${toneOf(id)}">${esc(full ? roleName(id) : roleShort(id))}</span>`;
  const peopleOf = (rid) => people().filter(p => p.role === rid);

  const pad = (n) => String(n).padStart(2, "0");
  const nowISO = () => new Date().toISOString();
  function hm(iso) { const d = new Date(iso); return isNaN(d) ? "-" : pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function ymdhm(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "-" : d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function dur(ms) {
    ms = Math.max(0, ms || 0);
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s % 60);
  }
  function durText(ms) {
    const m = Math.round(Math.max(0, ms || 0) / 60000);
    return m < 60 ? m + "분" : Math.floor(m / 60) + "시간" + (m % 60 ? " " + (m % 60) + "분" : "");
  }
  const tplus = (run, iso) => "T+" + durText(Date.parse(iso) - Date.parse(run.start));
  function localInput(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fromLocal(v) { const d = new Date(v); return isNaN(d) ? "" : d.toISOString(); }
  const phaseLabel = (min) => min < 60 || min % 60 ? min + "분 이내" : (min / 60) + "시간 이내";
  const phaseShort = (min) => min < 60 || min % 60 ? min + "분" : (min / 60) + "시간";
  const today = () => localInput().slice(0, 10);

  function telHref(num) {
    const s = String(num || "").split(/[,/~]/)[0].trim();
    const d = s.replace(/[^\d]/g, "");
    if (!d) return "";
    return /^\+/.test(s) ? "tel:+" + d : "tel:" + d;
  }
  const smsNum = (num) => String(num || "").replace(/[^\d]/g, "");
  function telA(num, label, cls) {
    const h = telHref(num);
    if (!h) return num ? `<span class="mono">${esc(num)}</span>` : "";
    const raw = String(num), cut = raw.search(/[,/~]/);
    const first = label || (cut > 0 ? raw.slice(0, cut).trim() : raw), rest = !label && cut > 0 ? raw.slice(cut).trim() : "";
    return `<span class="sp-telw"><a class="${cls || "sp-tel"}" href="${esc(h)}">${icon("phone", 15)}<span class="mono">${esc(first)}</span></a>${rest ? `<small class="sp-tmore mono">${esc(rest)}</small>` : ""}</span>`;
  }
  function fmtPhone(v) {
    if (window.SemisPhonebook && SemisPhonebook.fmtPhone) return SemisPhonebook.fmtPhone(v);
    return norm(v);
  }

  if (window.SemisDocs) SemisDocs.define("serp", [
    { id: "training", label: "위기대응 교육 · 훈련 결과" }, { id: "material", label: "교안 · 시나리오" }, { id: "plan", label: "계획 · 절차" }, { id: "misc", label: "기타" }
  ]);
  const TABS = [["init", "초동대응"], ["org", "조직 · 연락망"], ["contacts", "연락처"], ["forms", "체크리스트 · 양식"], ["runs", "대응 기록"], ["doc", "문서 · 개정"]];
  const RTABS = [["tl", "초동조치"], ["ck", "역할별 체크리스트"], ["notify", "통보 · 보고"], ["log", "상황 기록"], ["subs", "사고자료 대장"]];
  let tab = "init", runSel = "", runTab = "tl", roleF = "", cq = "";
  const drafts = {};   // 입력 중인 값 — 원격 변경으로 화면이 다시 그려져도 잃지 않게
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 사생활 보호 창 */ } }
  const recorder = () => norm(lsGet(LS_BY)) || ((SeMIS.user && SeMIS.user.name) || "");
  roleF = lsGet(LS_ROLE);

  const canRun = () => SeMIS.roleRank() >= 2;
  const canW = () => SeMIS.canEdit();
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "");
  function repaint() { if (routeNow() === MOD) SeMIS.renderView(); }
  function navSync() { try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ } }
  function commit(msg) { SeMIS.save(); repaint(); navSync(); if (msg) toast(msg); }

  /* ── 대응 기록 계산 ── */
  function runItems(run) { return arr(run && run.items).filter(x => x && x.id); }
  function runCks(run) { return arr(run && run.cks).filter(x => x && x.id); }
  const tlOf = (run) => obj(run && run.tl);
  const ckOf = (run) => obj(run && run.ck);
  function runStat(run, at) {
    const items = runItems(run), done = tlOf(run);
    const t = (at || Date.now()) - Date.parse(run.start);
    const end = run.end ? Date.parse(run.end) - Date.parse(run.start) : t;
    let n = 0, late = 0;
    items.forEach(x => {
      const d = done[x.id];
      if (d && d.at) { n++; if (Date.parse(d.at) - Date.parse(run.start) > x.min * 60000) late++; }
      else if (end > x.min * 60000) late++;
    });
    const ckTotal = runCks(run).reduce((s, r) => s + arr(r.items).length, 0);
    const ckDone = Object.keys(ckOf(run)).filter(k => ckOf(run)[k] && ckOf(run)[k].at).length;
    return { total: items.length, done: n, late, ckTotal, ckDone, elapsed: end };
  }
  function phases(items) {
    const out = [];
    items.forEach(x => { if (out.indexOf(x.min) < 0) out.push(x.min); });
    return out.sort((a, b) => a - b);
  }
  const kindChip = (run) => run.kind === "drill" ? ui.chip("훈련", "amber") : ui.chip("실제 상황", "red");
  const runTitle = (run) => norm(run.title) || (run.kind === "drill" ? "SERP 훈련" : "위기상황");

  /* ── 계획 화면 ── */
  function sectionsOf(t) { return arr(P().sections).filter(s => s && s.tab === t); }
  function paras(body) { return String(body || "").split("\n").map(norm).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join(""); }
  function secCard(s, extra, fold) {
    return `<section class="card sp-sec"${s.id ? ` data-sec="${esc(s.id)}"` : ""}${fold ? ui.mf("sec:" + (s.id || s.no)) : ""}>
      <header class="sp-sh${fold ? " mf-h" : ""}"><span class="sp-no mono">${esc(s.no || "")}</span><h3>${esc(s.title || "")}</h3><span class="spacer"></span>${extra || ""}
        ${canW() && s.id ? `<button type="button" class="sp-ed m-ed" data-sec-edit="${esc(s.id)}" aria-label="${esc(s.title)} 편집">${icon("edit", 15)}</button>` : ""}</header>
      <div class="sp-body">${paras(s.body)}</div></section>`;
  }
  const revBadge = () => P().rev ? `<span class="sp-rev">${esc(P().rev)}${P().revDate ? " " + esc(P().revDate.replace(/-/g, ".")) : ""}</span>` : "";

  /* 상단 비상 띠 — 대응 중이면 붉은 띠, 아니면 즉시 연락 · 대응 시작 */
  function alertBar() {
    const run = activeRun();
    if (run) {
      const st = runStat(run);
      return `<section class="sp-live${run.kind === "drill" ? " is-drill" : ""}" aria-label="대응 중">
        <div class="sp-live-l"><span class="sp-pulse" aria-hidden="true"></span>
          <div><b>${run.kind === "drill" ? "훈련 진행 중" : "위기상황 대응 중"}</b><small>${esc(runTitle(run))} · ${esc(ymdhm(run.start))} 발생</small></div></div>
        <span class="sp-clock mono" data-sp-t0="${esc(run.start)}">T+${dur(Date.now() - Date.parse(run.start))}</span>
        <span class="sp-live-n">초동조치 <b class="mono">${st.done}/${st.total}</b>${st.late ? ` · 기한 경과 <b class="mono">${st.late}</b>` : ""}</span>
        <button type="button" class="btn btn-sm sp-live-go" data-run-open="${esc(run.id)}">대응 화면</button>
      </section>`;
    }
    const occ = obj(P().occ);
    const apt = aptContact();
    return `<section class="sp-quick" aria-label="위기상황 발생 시">
      <div class="sp-q-l"><b>위기상황 발생 시</b><small class="m-hide">신속성 우선 — 확인된 내용부터 먼저 통보</small></div>
      <div class="sp-q-acts">
        ${occ.phone ? `<a class="sp-qbtn is-occ" href="${esc(telHref(occ.phone))}">${icon("phone", 17)}<span><b>종합통제팀 (OCC)</b><small class="mono">${esc(occ.phone)}</small></span></a>` : ""}
        ${apt ? `<a class="sp-qbtn" href="${esc(telHref(apt.phone))}">${icon("phone", 17)}<span><b>${esc(apt.org)}</b><small class="mono">${esc(apt.phone)}</small></span></a>` : ""}
        ${canRun() ? `<button type="button" class="sp-qbtn is-start" data-run-start="real">${icon("alert", 17)}<span><b>대응 시작</b><small>실제 상황</small></span></button>
        <button type="button" class="sp-qbtn is-drill" data-run-start="drill">${icon("clock", 17)}<span><b>훈련 시작</b><small>도상 · 실제 훈련</small></span></button>` : ""}
      </div></section>`;
  }
  function aptContact() {
    const c = arr(obj(P().chart).ext).find(x => /통합운영|비상관리/.test(x.org || ""));
    return c && c.phone ? c : null;
  }

  /* ── 초동대응 탭 ── */
  function initTab() {
    const occ = obj(P().occ), serc = obj(P().serc), items = timeline();
    const notifyF = arr(P().notify);
    const secs = sectionsOf("init"), inner = secs.filter(s => /^3\.1\./.test(s.no || "")), outer = secs.filter(s => inner.indexOf(s) < 0);
    const tlBody = phases(items).map(min => {
      const xs = items.filter(x => x.min === min && (!roleF || arr(x.roles).indexOf(roleF) >= 0));
      if (!xs.length) return "";
      return `<div class="sp-ph"><div class="sp-ph-h"><b>${esc(phaseLabel(min))}</b><span class="mono">${xs.length}</span></div>
        <ol class="sp-tl">${xs.map(x => `<li class="sp-ti"><span class="sp-box" aria-hidden="true"></span>
          <span class="sp-tt"><b>${esc(x.text)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span>
          <span class="sp-who">${arr(x.roles).map(r => rchip(r)).join("")}</span></li>`).join("")}</ol></div>`;
    }).join("");
    /* 모바일: 가장 먼저 할 일(3.6 초동조치)을 맨 위에, 원문 절은 접어 둔다. 통보처 전화는 위 띠와 겹쳐 모바일에서 숨김 */
    const occCard = `<section class="card sp-sec sp-occ"${ui.mf("occ")}>
        <header class="sp-sh mf-h"><span class="sp-no mono">3.1</span><h3>위기상황 발생 통보 (사내)</h3><span class="spacer"></span>
          ${canW() ? `<button type="button" class="sp-ed m-ed" id="sp-occ-edit" aria-label="통보처 편집">${icon("edit", 15)}</button>` : ""}</header>
        <div class="sp-body"><p>팀장을 포함한 팀의 모든 구성원은 위기상황을 인지하면 모든 통신수단으로 최대한 신속하게 본사 종합통제팀(OCC)에 보고한다.</p></div>
        ${occ.phone ? `<div class="sp-occbox m-hide"><div><small>접수</small><b>${esc(occ.team || "종합통제팀")}</b><small>${esc(occ.who || "")}</small></div>
          <a class="btn btn-danger sp-callbig" href="${esc(telHref(occ.phone))}">${icon("phone", 18)}<span class="mono">${esc(occ.phone)}</span></a></div>` : ""}
        ${inner.map(s => `<div class="sp-subsec" data-sec="${esc(s.id)}"><h4><span class="mono">${esc(s.no)}</span> ${esc(s.title)}
          ${canW() ? `<button type="button" class="sp-ed m-ed" data-sec-edit="${esc(s.id)}" aria-label="${esc(s.title)} 편집">${icon("edit", 14)}</button>` : ""}</h4>${paras(s.body)}</div>`).join("")}
      </section>`;
    const tlCard = `<section class="card sp-sec" id="sp-tlcard">
      <header class="sp-sh"><span class="sp-no mono">3.6</span><h3>시간대별 초동조치</h3><span class="spacer"></span>${roleSeg()}
        ${canW() ? `<button type="button" class="sp-ed m-ed" id="sp-tl-edit" aria-label="초동조치 편집">${icon("edit", 15)}</button>` : ""}</header>
      <p class="sp-hint m-hide">종합통제팀 최초 통보 후 다른 항목은 실제 상황과 관계당국 요청을 고려해 조치 시점을 조정할 수 있다.</p>
      <div class="sp-phs">${tlBody || ui.empty("해당 역할의 조치가 없습니다.")}</div>
    </section>`;
    const top = `<div class="sp-grid2">${occCard}${sercCard(serc)}</div>`;
    const rest = `${outer.length ? `<div class="sp-grid3">${outer.map(s => secCard(s, "", true)).join("")}</div>` : ""}
    ${notifyF.length ? `<section class="card sp-sec"${ui.mf("nf")}>
      <header class="sp-sh mf-h"><span class="sp-no mono">3.1.2</span><h3>위기상황 발생 통보 양식</h3><span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm mf-x" id="sp-form-copy">${icon("doc", 15)}<span>빈 양식 복사</span></button></header>
      <ol class="sp-nf">${notifyF.map(f => `<li><b>${esc(f.label)}</b>${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</li>`).join("")}</ol>
    </section>` : ""}`;
    return SeMIS.isMobile() ? tlCard + top + rest : top + tlCard + rest;
  }
  function sercCard(serc) {
    return `<section class="card sp-sec sp-serc"${ui.mf("serc")}>
      <header class="sp-sh mf-h"><span class="sp-no mono">3.5</span><h3>팀위기대응센터 (SERC)</h3><span class="spacer"></span>
        ${canW() ? `<button type="button" class="sp-ed m-ed" id="sp-serc-edit" aria-label="SERC 편집">${icon("edit", 15)}</button>` : ""}</header>
      <div class="sp-serc-t"><span class="sp-big mono">${esc(serc.within || 30)}분</span><span>위기상황 발생 시점부터 <b>${esc(serc.within || 30)}분 이내</b> 개설 원칙</span></div>
      ${serc.intro ? `<div class="sp-body"><p>${esc(serc.intro)}</p></div>` : ""}
      ${arr(serc.consider).length ? `<ul class="sp-dots">${arr(serc.consider).map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      ${serc.online ? `<div class="sp-online"><div class="sp-online-h">${icon("users", 16)}<b>온라인(가상) 위기대응센터</b>${revBadge()}</div><p>${esc(serc.online)}</p>
        ${serc.channel ? `<p class="sp-kv"><span>대체 통신 채널</span><b>${esc(serc.channel)}</b></p>` : ""}</div>` : ""}
      <dl class="sp-dl"><div><dt>SERC 위치</dt><dd>${serc.place ? esc(serc.place) : '<span class="sp-miss">미기재</span>'}</dd></div>
        <div><dt>보유 장비 · 시설</dt><dd>${serc.equip ? esc(serc.equip) : '<span class="sp-miss">미기재</span>'}</dd></div></dl>
    </section>`;
  }
  function roleSeg() {
    const opts = [["", "전체"]].concat(roles().map(r => [r.id, roleShort(r.id)]));
    return `<div class="seg sp-roleseg" role="group" aria-label="역할">${opts.map(([v, lb]) =>
      `<button type="button" class="seg-btn" data-role-f="${esc(v)}" aria-pressed="${roleF === v}">${esc(lb)}</button>`).join("")}</div>`;
  }

  /* ── 조직 · 연락망 탭 ── */
  function personLine(p, opt) {
    return `<div class="sp-pl" data-person="${esc(p.id)}"><b>${esc(p.name)}</b>${p.grade ? `<small>${esc(p.grade)}</small>` : ""}
      ${p.mobile ? telA(p.mobile) : '<span class="sp-miss">번호 없음</span>'}
      ${opt && opt.edit ? `<button type="button" class="sp-ed m-ed" data-person-edit="${esc(p.id)}" aria-label="${esc(p.name)} 편집">${icon("edit", 14)}</button>` : ""}</div>`;
  }
  function chartHTML() {
    const ch = obj(P().chart);
    const box = (c) => `<div class="sp-cbox"><b>${esc(c.org)}</b>${telA(c.phone)}</div>`;
    const lead = peopleOf("leader"), sup = peopleOf("sup");
    const col = (rid) => {
      const ps = peopleOf(rid);
      return `<div class="sp-ccol t-${toneOf(rid)}"><div class="sp-ccol-h">${esc(roleName(rid))}<span class="mono">${ps.length}</span></div>
        ${ps.map(p => personLine(p)).join("") || '<div class="sp-miss">배정 없음</div>'}</div>`;
    };
    const others = roles().filter(r => r.id !== "leader" && r.id !== "sup").map(r => r.id);
    return `<section class="card sp-sec sp-chart">
      <header class="sp-sh"><span class="sp-no mono">6.3</span><h3>팀 비상연락망</h3>${revBadge()}<span class="spacer"></span>
        ${canW() ? `<button type="button" class="sp-ed m-ed" id="sp-chart-edit" aria-label="연락망 기관 편집">${icon("edit", 15)}</button>` : ""}</header>
      <div class="sp-ctop">
        <div class="sp-cside"><small>대외 기관</small>${arr(ch.ext).map(box).join("")}</div>
        <div class="sp-chead t-rose"><small>팀장 (Station Manager)</small>${lead.map(p => `<b>${esc(p.name)}</b>${telA(p.mobile)}`).join("") || '<span class="sp-miss">미지정</span>'}</div>
        <div class="sp-cside"><small>본사</small>${arr(ch.hq).map(box).join("")}</div>
      </div>
      <div class="sp-csup t-blue"><small>${esc(roleName("sup"))}</small>${sup.map(p => personLine(p)).join("") || '<span class="sp-miss">미지정</span>'}</div>
      <div class="sp-ccols">${others.map(col).join("")}</div>
    </section>`;
  }
  function roleCard(r) {
    const ps = peopleOf(r.id), ed = canW();
    return `<section class="card sp-role t-${toneOf(r.id)}" data-role="${esc(r.id)}"${ui.mf("role:" + r.id)}>
      <header class="sp-role-h mf-h"><span class="sp-role-no mono">${esc(r.no || "")}</span>
        <div><h3>${esc(r.name)}</h3><small>${esc(r.en || "")}${r.who ? " · 수행자 " + esc(r.who) : ""}</small></div><span class="spacer"></span>
        ${ed ? `<button type="button" class="sp-ed m-ed" data-role-edit="${esc(r.id)}" aria-label="${esc(r.name)} 역할 편집">${icon("edit", 15)}</button>` : ""}</header>
      <div class="sp-role-b">
        <ul class="sp-dots">${arr(r.duties).map(d => `<li>${esc(d)}</li>`).join("")}</ul>
        <div class="sp-ppl">${ps.map(p => `<article class="sp-pc" data-person="${esc(p.id)}">
          <div class="sp-pc-h"><b>${esc(p.name)}</b>${p.grade ? `<small>${esc(p.grade)}</small>` : ""}
            ${ed ? `<button type="button" class="sp-ed m-ed" data-person-edit="${esc(p.id)}" aria-label="${esc(p.name)} 편집">${icon("edit", 14)}</button>` : ""}</div>
          <div class="sp-pc-n">${p.mobile ? telA(p.mobile) : ""}${p.office ? telA(p.office, "", "sp-tel is-office") : ""}
            ${p.email ? `<a class="sp-tel" href="mailto:${esc(p.email)}">${icon("mail", 15)}<span>${esc(p.email)}</span></a>` : ""}</div>
          ${p.place ? `<div class="sp-pc-m"><span>위기 시 근무 위치</span>${esc(p.place)}</div>` : ""}
          ${p.note ? `<div class="sp-pc-m is-note">※ ${esc(p.note)}</div>` : ""}
        </article>`).join("") || '<div class="sp-miss">배정된 인원이 없습니다.</div>'}
        ${ed ? `<button type="button" class="sp-padd m-ed" data-person-add="${esc(r.id)}">${icon("plus", 15)}<span>인원 추가</span></button>` : ""}</div>
      </div></section>`;
  }
  function orgTab() {
    return chartHTML() + `<h2 class="sp-h2">역할과 책임 · 임무 배정 <span>2.3 · 6.4</span></h2>` + roles().map(roleCard).join("") +
      `<details class="card sp-more"><summary>인력 구성 · 임무 배정 원칙 (2.1 · 2.2)</summary>${sectionsOf("org").map(s => secCard(s)).join("")}</details>`;
  }

  /* ── 연락처 탭 ── */
  function contactGroups() {
    const pl = P(), ch = obj(pl.chart), ov = obj(pl.overview);
    const g = [];
    const occ = obj(pl.occ);
    const hq = arr(ch.hq).map(c => ({ id: c.id, org: c.org, phone: c.phone, note: "", src: "chart" }));
    if (occ.phone && !hq.some(c => /종합통제/.test(c.org))) hq.unshift({ id: "occ", org: occ.team, phone: occ.phone, note: occ.who, src: "occ" });
    g.push({ id: "hq", title: "본사 (비상연락망)", rows: hq });
    g.push({ id: "ext", title: "대외 기관 (비상연락망)", rows: arr(ch.ext).map(c => ({ id: c.id, org: c.org, phone: c.phone, note: "", src: "chart" })) });
    g.push({ id: "fac", title: "지원 시설 (6.5)", rows: arr(pl.facilities).map(f => ({ id: f.id, org: f.name, phone: f.phone, note: [f.kind, f.note].filter(Boolean).join(" · "), conf: !!f.conf, src: "fac" })) });
    g.push({ id: "must", title: "주재국 관계 기관 의무 보고 (6.2)", rows: arr(ov.mandatory).map(m => ({ id: m.id, org: m.org, phone: m.phone, note: m.items || "", src: "must" })) });
    g.push({ id: "near", title: "인근 팀 (6.2)", rows: arr(ov.nearby).map(m => ({ id: m.id, org: m.org, phone: m.phone, note: m.support || "", src: "near" })) });
    const ags = arr(pl.agencies).filter(a => a && a.id);
    const grps = [];
    ags.forEach(a => { if (grps.indexOf(a.grp || "기타") < 0) grps.push(a.grp || "기타"); });
    grps.forEach(gr => g.push({ id: "ag:" + gr, title: gr, ag: true, rows: ags.filter(a => (a.grp || "기타") === gr).map(a => ({ id: a.id, org: a.org, phone: a.phone, note: a.note || "", src: "ag" })) }));
    return g.filter(x => x.rows.length);
  }
  function cMatch(r, gtitle, q) {
    if (!q) return true;
    const s = q.toLowerCase(), t = [gtitle, r.org, r.phone, r.note].join(" ").toLowerCase();
    if (t.indexOf(s) >= 0) return true;
    const d = s.replace(/[-\s]/g, "");
    return /\d{3,}/.test(d) && t.replace(/[-\s]/g, "").indexOf(d) >= 0;
  }
  function contactsBody() {
    const gs = contactGroups().map(g => Object.assign({}, g, { rows: g.rows.filter(r => cMatch(r, g.title, cq)) })).filter(g => g.rows.length);
    if (!gs.length) return ui.empty(cq ? "검색 결과가 없습니다." : "등록된 연락처가 없습니다.");
    const ed = canW();
    return `<div class="sp-cgrid">${gs.map(g => `<section class="sp-cg" data-cg="${esc(g.id)}"${ui.mf("cg:" + g.id, !!cq)}><h3 class="mf-h">${esc(g.title)}<span class="mono">${g.rows.length}</span></h3>
      <ul>${g.rows.map(r => `<li class="sp-cr${r.conf ? " is-conf" : ""}"><div class="sp-cr-t"><b>${esc(r.org)}</b>${r.conf ? ui.chip("대외비", "red") : ""}
        ${r.note ? `<small>${esc(r.note)}</small>` : ""}</div>${telA(r.phone)}
        ${ed && r.src !== "occ" ? `<button type="button" class="sp-ed m-ed" data-c-edit="${esc(r.src)}:${esc(r.id)}" aria-label="${esc(r.org)} 편집">${icon("edit", 14)}</button>` : ""}</li>`).join("")}</ul>
</section>`).join("")}</div>`;
  }
  function imagesHTML() {
    const im = arr(P().images).filter(x => x && x.url);
    if (!im.length) return "";
    return `<section class="card sp-sec"${ui.mf("img")}><header class="sp-sh mf-h"><h3>비상전파 · 통신체계 · Airport Grid map</h3></header>
      <div class="sp-imgs">${im.map((x, i) => `<button type="button" class="sp-img" data-img="${i}">
        <img src="${esc(x.thumb || x.url)}" alt="${esc(x.title)}" loading="lazy"><span><b>${esc(x.title)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ""}</span></button>`).join("")}</div></section>`;
  }
  function contactsTab() {
    return `<section class="card sp-sec"><div class="toolbar">${ui.search("sp-cq", "기관 · 이름 · 번호 검색", cq)}
      ${canW() ? `<span class="spacer m-ed"></span><button type="button" class="btn btn-ghost btn-sm m-ed" data-c-add="">${icon("plus", 15)}<span>관계 기관 추가</span></button>` : ""}</div>
      <div id="sp-cbody">${contactsBody()}</div></section>` + imagesHTML();
  }

  /* ── 체크리스트 · 양식 탭 ── */
  function ckTable(title, items, blanks) {
    return `<div class="table-wrap"><table class="tbl sp-cktbl"><thead><tr><th class="sp-ck-no">#</th><th>${esc(title)}</th><th class="sp-ck-at">조치 일시</th><th class="sp-ck-nt">비고 (조치 세부 내용)</th></tr></thead>
      <tbody>${items.map((t, i) => `<tr><td class="mono">${i + 1}</td><td>${esc(t)}</td><td></td><td></td></tr>`).join("")}
      ${Array.from({ length: blanks || 0 }, () => '<tr class="sp-blank"><td></td><td></td><td></td><td></td></tr>').join("")}</tbody></table></div>`;
  }
  const LEDGER_COLS = ["No.", "자료명", "관계기관", "관계기관 담당자(요청자) / 요청 일시", "요청 접수자", "제출자 / 일시", "제출방법", "비고 (근거)"];
  function formsTab() {
    const pl = P();
    return `<h2 class="sp-h2">위기대응 업무 체크리스트 <span>7.1 · 개인별</span></h2>
      <p class="sp-hint m-hide">실제 위기상황에서는 '대응 시작'으로 이 화면에서 바로 기록한다. 종이 · 태블릿용으로 인쇄해 쓸 수 있으며 항목은 상황에 맞게 가감한다.</p>
      <div class="sp-cks">${roles().map(r => `<section class="card sp-ckc t-${toneOf(r.id)}" data-ck-role="${esc(r.id)}"${ui.mf("ck:" + r.id)}>
        <header class="sp-sh mf-h"><h3>${esc(r.name)}</h3><small class="sp-ckn m-hide">성명:</small><span class="mono sp-mut">${arr(r.checklist).length}</span><span class="spacer"></span>
          ${canW() ? `<button type="button" class="sp-ed m-ed" data-ck-edit="${esc(r.id)}" aria-label="${esc(r.name)} 체크리스트 편집">${icon("edit", 15)}</button>` : ""}</header>
        ${ckTable("항목", arr(r.checklist), 2)}</section>`).join("")}</div>
      <section class="card sp-sec"${ui.mf("ledger")}><header class="sp-sh mf-h"><span class="sp-no mono">7.2</span><h3>사고자료 관리 대장 (양식)</h3></header>
        <p class="sp-hint m-hide">법규 또는 관계 당국 요청으로 외부기관에 사고자료를 제출할 때 기록한다. 본사 사고대책본부의 최종 지침이 있을 때까지 보존한다.</p>
        <div class="table-wrap"><table class="tbl sp-ledger"><thead><tr>${LEDGER_COLS.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>${Array.from({ length: 6 }, (x, i) => `<tr><td class="mono">${i + 1}</td>${"<td></td>".repeat(7)}</tr>`).join("")}</tbody></table></div>
        <p class="sp-foot">제출방법: 이메일(파일 첨부) · 지면(자료 사본) · 카톡(파일 첨부) 등 / 비고: 자료 제출 근거(법규)가 있으면 기입</p></section>
      <section class="card sp-sec"${ui.mf("docs")}><header class="sp-sh mf-h"><span class="sp-no mono">5.2</span><h3>제출 요청이 예상되는 사고자료</h3></header>
        ${pl.docsNote ? `<div class="sp-body"><p>${esc(pl.docsNote)}</p></div>` : ""}
        <ol class="sp-docs">${arr(pl.docs).map(d => `<li>${esc(d)}</li>`).join("")}</ol></section>
      <div class="sp-grid2">${sectionsOf("forms").map(s => secCard(s, "", true)).join("")}</div>`;
  }

  /* ── 대응 기록 탭 ── */
  function runsTab() {
    const list = runs().slice().sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const act = activeRun();
    return `<section class="card sp-sec"><header class="sp-sh"><h3>대응 기록</h3><span class="spacer"></span>
      ${canRun() && !act ? `<button type="button" class="btn btn-ghost btn-sm" data-run-start="drill">${icon("clock", 15)}<span>훈련 시작</span></button>
        <button type="button" class="btn btn-danger btn-sm" data-run-start="real">${icon("alert", 15)}<span>대응 시작</span></button>` : ""}</header>
      ${list.length ? `<div class="table-wrap"><table class="tbl tbl-cap sp-runs"><thead><tr><th>구분</th><th>제목</th><th>발생</th><th>종료 · 소요</th><th>초동조치</th><th>기록</th></tr></thead>
        <tbody>${list.map(r => { const s = runStat(r); return `<tr data-run-open="${esc(r.id)}" class="${r.end ? "" : "is-live"}">
          <td>${kindChip(r)}</td><td><b>${esc(runTitle(r))}</b>${r.place ? `<small class="sp-sub">${esc(r.place)}</small>` : ""}</td>
          <td class="mono">${esc(ymdhm(r.start))}</td>
          <td>${r.end ? `<span class="mono">${esc(hm(r.end))}</span> · ${esc(durText(s.elapsed))}` : ui.chip("진행 중", "red")}</td>
          <td class="mono">${s.done}/${s.total}${s.late ? ` <span class="sp-late">경과 ${s.late}</span>` : ""}</td>
          <td class="mono">${arr(r.log).length}</td></tr>`; }).join("")}</tbody></table></div>`
      : ui.empty("대응 기록이 없습니다. 위기상황 또는 훈련을 시작하면 시간대별 조치가 여기에 남습니다.")}</section>`;
  }

  /* ── 문서 · 개정 탭 ── */
  function docTab() {
    const pl = P(), ov = obj(pl.overview), ed = canW();
    const kv = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const miss = (v) => v ? esc(v) : '<span class="sp-miss">미기재</span>';
    const revs = arr(pl.revs);
    const cur = revs.slice().reverse().find(r => arr(r.changes).length) || null;
    const nextDue = (d) => { if (!d) return ""; const x = new Date(d); x.setFullYear(x.getFullYear() + 1); return localInput(x.toISOString()).slice(0, 10); };
    return `<div class="sp-grid2">
      <section class="card sp-sec"><header class="sp-sh"><h3>운영표</h3><span class="spacer"></span>
        ${ed ? `<button type="button" class="sp-ed m-ed" id="sp-meta-edit" aria-label="문서 정보 편집">${icon("edit", 15)}</button>` : ""}</header>
        <dl class="sp-dl">${kv("문서", esc(pl.title || "") + (pl.en ? ` <small>(${esc(pl.en)})</small>` : ""))}${kv("관리 번호", `<span class="mono">${esc(pl.docNo || "-")}</span>`)}
          ${kv("주관 · 관리 부서", esc(pl.dept || "-"))}${kv("제정권자", esc(pl.owner || "-"))}${kv("최초 시행", `<span class="mono">${esc(pl.firstDate || "-")}</span>`)}
          ${kv("현행", esc(pl.rev || "-") + (pl.revDate ? ` <span class="mono">${esc(pl.revDate)}</span>` : ""))}
          ${kv("원본", pl.fileUrl ? `<a href="${esc(pl.fileUrl)}${pl.fileUrl.indexOf("?") < 0 ? "?download=" + encodeURIComponent(pl.fileName || "SERP.docx") : ""}">${icon("down", 15)} ${esc(pl.fileName || "원본 파일")}</a>` : '<span class="sp-miss">없음</span>')}</dl>
        ${ed ? `<div class="sp-file m-ed"><button type="button" class="btn btn-ghost btn-sm" id="sp-file-up">${icon("doc", 15)}<span>원본 파일 ${pl.fileUrl ? "교체" : "등록"}</span></button>
          <input type="file" id="sp-file" hidden accept=".docx,.pdf,.hwp,.hwpx,.doc"></div>` : ""}
      </section>
      <section class="card sp-sec"${ui.mf("purpose")}><header class="sp-sh mf-h"><span class="sp-no mono">1</span><h3>목적 · 적용 범위</h3></header>
        <div class="sp-body"><p>${esc(pl.purpose || "")}</p></div>
        <ul class="sp-dots">${arr(pl.scope).map(s => `<li>${esc(s)}</li>`).join("")}</ul>
        ${pl.scopeNote ? `<p class="sp-foot">${esc(pl.scopeNote)}</p>` : ""}</section>
    </div>
    <section class="card sp-sec"${ui.mf("revs")}><header class="sp-sh mf-h"><h3>개정 이력</h3><span class="mono sp-mut">${revs.length}</span></header>
      <div class="table-wrap"><table class="tbl sp-revs"><thead><tr><th>개정 차수</th><th>개정일자</th><th>개정 조항</th><th>개정 사유</th></tr></thead>
      <tbody>${revs.map(r => `<tr><td>${esc(r.no)}</td><td class="mono">${esc(r.date)}</td><td>${esc(r.clauses)}</td><td>${esc(r.reason)}</td></tr>`).join("")}</tbody></table></div></section>
    ${cur ? `<section class="card sp-sec sp-cmp"${ui.mf("cmp")}><header class="sp-sh mf-h"><h3>${esc(cur.no)} 개정 주요 내용</h3><span class="mono sp-mut">${esc(cur.date)}</span></header>
      ${arr(cur.purpose).length ? `<div class="sp-purp"><b>개정 목적</b><ul class="sp-dots">${arr(cur.purpose).map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      ${arr(cur.changes).map(c => `<div class="sp-chg"><h4><span class="mono">${esc(c.clause)}</span> ${esc(c.title)}</h4>
        ${c.before ? `<div class="sp-ba"><div class="sp-b"><small>개정 전</small>${paras(c.before)}</div><div class="sp-a"><small>개정 후</small>${diffAfter(c.before, c.after)}</div></div>`
          : `<div class="sp-body">${paras(c.after)}</div>`}</div>`).join("")}</section>` : ""}
    <section class="card sp-sec"${ui.mf("mgmt")}><header class="sp-sh mf-h"><span class="sp-no mono">6.1</span><h3>관리 기준 · 점검</h3></header>
      ${pl.mgmtNote ? `<div class="sp-body"><p>${esc(pl.mgmtNote)}</p></div>` : ""}
      <div class="table-wrap"><table class="tbl sp-mgmt"><thead><tr><th>항목</th><th>점검 주기</th><th>최신화 요건</th><th>최근 점검</th><th>다음 점검</th>${ed ? '<th class="m-ed"></th>' : ""}</tr></thead>
      <tbody>${arr(pl.mgmt).map(m => { const nd = nextDue(m.checked), late = nd && nd < today(); return `<tr${late || !m.checked ? ' class="is-due"' : ""}>
        <td><b>${esc(m.item)}</b></td><td>${esc(m.cycle)}</td><td>${esc(m.req)}</td>
        <td class="mono">${m.checked ? esc(m.checked) : '<span class="sp-miss">기록 없음</span>'}</td>
        <td class="mono">${nd ? esc(nd) + (late ? " " + ui.chip("경과", "red") : "") : "-"}</td>
        ${ed ? `<td class="m-ed"><button type="button" class="btn btn-ghost btn-sm" data-mgmt="${esc(m.id)}">${icon("check", 15)}<span>오늘 점검</span></button></td>` : ""}</tr>`; }).join("")}</tbody></table></div></section>
    <section class="card sp-sec"${ui.mf("ov")}><header class="sp-sh mf-h"><span class="sp-no mono">6.2</span><h3>팀 위기대응 개황</h3><span class="spacer"></span>
      ${ed ? `<button type="button" class="sp-ed m-ed" id="sp-ov-edit" aria-label="개황 편집">${icon("edit", 15)}</button>` : ""}</header>
      <dl class="sp-dl sp-dl2">${kv("팀장", esc(ov.leader || "-"))}${kv("팀 가용 인력", `지점 <b class="mono">${esc(ov.staff || "-")}</b>명 · 조업사 <b class="mono">${esc(ov.vendor || "-")}</b>명`)}
        ${kv("SERC 위치 · 보유 장비", miss([obj(pl.serc).place, obj(pl.serc).equip].filter(Boolean).join(" · ")))}${kv("초동조치 지원 계약", miss(ov.contract))}
        ${kv("대체 공항", miss(ov.altApt))}${kv("지원 요청 가능 항공사", miss(ov.airline))}
        ${kv("국가별 가족 지원법", esc((ov.familyAct || "-") + (ov.familyName ? " · " + ov.familyName : "")))}
        ${kv("공항 비상대응 계획 (AEP)", esc((ov.aep || "-") + (ov.aepName ? " · " + ov.aepName : "")))}</dl></section>
    ${ed && arr(pl.gaps).length ? `<section class="card sp-sec sp-gaps m-ed"><header class="sp-sh"><h3>원문 확인 필요</h3><span class="mono sp-mut">${arr(pl.gaps).length}</span><span class="spacer"></span>
      <button type="button" class="sp-ed m-ed" id="sp-gaps-edit" aria-label="확인 필요 편집">${icon("edit", 15)}</button></header>
      <ol class="sp-docs">${arr(pl.gaps).map(g => `<li>${esc(g)}</li>`).join("")}</ol></section>` : ""}`;
  }
  /* 개정 후 문구 중 개정 전에 없던 문단을 강조 */
  function diffAfter(before, after) {
    const b = String(before || "").split("\n").map(norm);
    return String(after || "").split("\n").map(norm).filter(Boolean).map(p => b.indexOf(p) >= 0 ? `<p>${esc(p)}</p>` : `<p class="sp-new">${esc(p)}</p>`).join("");
  }

  /* ── 대응 화면 ── */
  function runView(run) {
    const st = runStat(run), live = !run.end;
    const serc = run.serc;
    const lead = peopleOf("leader")[0], sup = peopleOf("sup")[0], occ = obj(P().occ), apt = aptContact();
    const call = (lb, num) => num ? `<a class="sp-cbtn" href="${esc(telHref(num))}">${icon("phone", 15)}<span>${esc(lb)}</span></a>` : "";
    const body = runTab === "ck" ? runCkHTML(run) : runTab === "notify" ? runNotifyHTML(run) : runTab === "log" ? runLogHTML(run) : runTab === "subs" ? runSubsHTML(run) : runTlHTML(run);
    return `<section class="sp-status${run.kind === "drill" ? " is-drill" : ""}${live ? "" : " is-end"}">
        <div class="sp-st-a">${kindChip(run)}<b>${esc(runTitle(run))}</b>${run.place ? `<small>${esc(run.place)}</small>` : ""}</div>
        <div class="sp-st-t"><small>${live ? "경과" : "종료 · 소요"}</small>${live ? `<span class="sp-clock mono" data-sp-t0="${esc(run.start)}">T+${dur(Date.now() - Date.parse(run.start))}</span>`
          : `<span class="sp-clock mono">${esc(durText(st.elapsed))}</span>`}<small class="mono">발생 ${esc(ymdhm(run.start))}${run.end ? " · 종료 " + esc(hm(run.end)) : ""}</small></div>
        <div class="sp-st-p">${phases(runItems(run)).map(min => {
          const xs = runItems(run).filter(x => x.min === min), d = xs.filter(x => tlOf(run)[x.id] && tlOf(run)[x.id].at).length;
          const plate = d < xs.length && st.elapsed > min * 60000;
          return `<div class="sp-pp${plate ? " is-late" : ""}" data-sp-pmin="${min}" data-sp-pt0="${esc(run.start)}" data-sp-pdone="${d === xs.length ? 1 : 0}"${live ? "" : ' data-sp-end="1"'} title="${esc(phaseLabel(min))}">
            <span>${esc(phaseShort(min))}</span><b class="mono">${d}/${xs.length}</b><i style="--p:${xs.length ? Math.round(d / xs.length * 100) : 0}%"></i></div>`;
        }).join("")}</div>
        <div class="sp-st-s"><small>팀위기대응센터</small>${serc && serc.at ? `<b>${serc.mode === "online" ? "온라인 개설" : "현장 개설"}</b><small>${esc(serc.place || "")} · ${esc(hm(serc.at))}</small>`
          : `<b class="sp-miss">미개설</b>`}${live && canRun() ? `<button type="button" class="link-btn" data-act="serc">${serc && serc.at ? "변경" : "개설 기록"}</button>` : ""}</div>
      </section>
      ${live ? `<div class="sp-calls">${call("종합통제팀 OCC", occ.phone)}${apt ? call(apt.org, apt.phone) : ""}${lead ? call("팀장 " + lead.name, lead.mobile) : ""}${sup ? call("총괄 " + sup.name, sup.mobile) : ""}
        ${canRun() ? `<button type="button" class="sp-cbtn is-act" data-act="recall">${icon("users", 15)}<span>비상소집 문자</span></button>` : ""}
        <label class="sp-by">${icon("user", 15)}<span>기록자</span><input id="sp-by" list="sp-by-dl" value="${esc(recorder())}" autocomplete="off">
          <datalist id="sp-by-dl">${people().map(p => `<option value="${esc(p.name)}">`).join("")}</datalist></label></div>` : ""}
      <div class="eq-tabs sp-rtabs no-print" role="tablist" aria-label="대응 화면">${RTABS.map(([id, lb]) => {
        const n = id === "log" ? arr(run.log).length : id === "subs" ? arr(run.subs).length : id === "tl" ? `${st.done}/${st.total}` : id === "ck" ? `${st.ckDone}/${st.ckTotal}` : "";
        return `<button type="button" role="tab" class="eq-tab" data-rtab="${id}" aria-selected="${runTab === id}">${esc(lb)}${n !== "" ? ` <span class="mono sp-tn">${n}</span>` : ""}</button>`;
      }).join("")}</div>
      <div class="no-print" id="sp-rbody">${body}</div>
      <div class="print-only sp-report">${reportHTML(run)}</div>`;
  }
  function doneMeta(run, d) {
    return `<span class="sp-dm mono">${esc(hm(d.at))} · ${esc(tplus(run, d.at))}${d.by ? ` · <span>${esc(d.by)}</span>` : ""}</span>${d.note ? `<small class="sp-dn">${esc(d.note)}</small>` : ""}`;
  }
  const ACT_LABEL = { apt: "공항 확인", occ: "OCC 전화", lead: "팀장 전화", recall: "소집 문자", agency: "관계기관", near: "인근 팀", serc: "SERC 개설", report: "본사 보고", facility: "지원 시설" };
  function runTlHTML(run) {
    const items = runItems(run), done = tlOf(run), live = !run.end, can = canRun();
    const now = Date.now(), t0 = Date.parse(run.start);
    return `<div class="sp-rbar">${roleSeg()}</div>` + phases(items).map(min => {
      const xs = items.filter(x => x.min === min && (!roleF || arr(x.roles).indexOf(roleF) >= 0));
      if (!xs.length) return "";
      const due = new Date(t0 + min * 60000);
      return `<section class="card sp-rph"><header class="sp-rph-h"><b>${esc(phaseLabel(min))}</b><span class="mono">~${esc(hm(due.toISOString()))}</span>
        <span class="mono sp-mut">${xs.filter(x => done[x.id] && done[x.id].at).length}/${xs.length}</span></header>
        <ul class="sp-rl">${xs.map(x => {
          const d = done[x.id], ok = !!(d && d.at);
          const late = ok ? Date.parse(d.at) - t0 > min * 60000 : (live ? now - t0 > min * 60000 : Date.parse(run.end) - t0 > min * 60000);
          return `<li class="sp-ri${ok ? " is-done" : ""}${late ? " is-late" : ""}" data-item="${esc(x.id)}"${!ok && live ? ` data-sp-due="${min}" data-sp-t0="${esc(run.start)}"` : ""}>
            <button type="button" class="sp-chk" data-tl="${esc(x.id)}" aria-pressed="${ok}" aria-label="${esc(x.text)} ${ok ? "완료" : "완료 기록"}"${can && (live || ok) ? "" : " disabled"}>${icon("check", 18)}</button>
            <div class="sp-ri-t"><b>${esc(x.text)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}
              <div class="sp-ri-m">${arr(x.roles).map(r => rchip(r)).join("")}${ok ? doneMeta(run, d) + (late ? '<span class="sp-slow">기한 후 완료</span>' : "") : late ? '<span class="sp-late">기한 경과</span>' : ""}</div></div>
            ${live && x.act && ACT_LABEL[x.act] ? `<button type="button" class="btn btn-ghost btn-sm sp-ract" data-act="${esc(x.act)}">${esc(ACT_LABEL[x.act])}</button>` : ""}
          </li>`;
        }).join("")}</ul></section>`;
    }).join("");
  }
  function runCkHTML(run) {
    const ck = ckOf(run), live = !run.end, can = canRun();
    const list = runCks(run).filter(r => !roleF || r.id === roleF);
    return `<div class="sp-rbar">${roleSeg()}</div><div class="sp-cks">` + list.map(r => {
      const items = arr(r.items);
      const n = items.filter((t, i) => ck[r.id + ":" + i] && ck[r.id + ":" + i].at).length;
      return `<section class="card sp-ckc t-${toneOf(r.id)}"><header class="sp-sh"><h3>${esc(r.name)}</h3><span class="spacer"></span><span class="mono sp-mut">${n}/${items.length}</span></header>
        <ul class="sp-rl">${items.map((t, i) => {
          const k = r.id + ":" + i, d = ck[k], ok = !!(d && d.at);
          return `<li class="sp-ri${ok ? " is-done" : ""}"><button type="button" class="sp-chk" data-ck="${esc(k)}" aria-pressed="${ok}" aria-label="${esc(t)}"${can && (live || ok) ? "" : " disabled"}>${icon("check", 18)}</button>
            <div class="sp-ri-t"><b>${esc(t)}</b>${ok ? `<div class="sp-ri-m">${doneMeta(run, d)}</div>` : ""}</div></li>`;
        }).join("")}</ul></section>`;
    }).join("") + `</div>`;
  }
  function notifyText(run) {
    const fs = arr(P().notify), v = obj(obj(run.notify).f);
    const head = "[위기상황 발생 통보] " + (P().dept || "") + (run.kind === "drill" ? " (훈련)" : "");
    return head + "\n" + fs.map((f, i) => (i + 1) + ") " + f.label + ": " + norm(v[f.id] || "")).join("\n");
  }
  function runNotifyHTML(run) {
    const fs = arr(P().notify), v = obj(obj(run.notify).f), live = !run.end && canRun();
    const fleet = window.SemisFlight && SemisFlight.fleet ? SemisFlight.fleet() : [];
    const sent = arr(obj(run.notify).sent);
    return `<div class="sp-nwrap"><section class="card sp-sec"><header class="sp-sh"><span class="sp-no mono">3.1.2</span><h3>위기상황 발생 통보 양식</h3></header>
      <p class="sp-hint">정확성 · 완전성보다 신속성 — 확인된 항목부터 채워 먼저 보내고, 나머지는 추가 통보한다.</p>
      <div class="sp-nform">${fs.map((f, i) => {
        const id = "sp-nf-" + f.id, val = drafts[id] != null ? drafts[id] : (v[f.id] || "");
        const opts = arr(f.opts).length ? `<div class="sp-opts">${arr(f.opts).map(o => `<button type="button" class="sp-opt" data-nf-opt="${esc(f.id)}" data-v="${esc(o)}" aria-pressed="${val === o}"${live ? "" : " disabled"}>${esc(o)}</button>`).join("")}</div>` : "";
        const inp = f.long ? `<textarea id="${id}" data-nf="${esc(f.id)}" rows="2" placeholder="${esc(f.hint || "")}"${live ? "" : " readonly"}>${esc(val)}</textarea>`
          : `<input id="${id}" data-nf="${esc(f.id)}" value="${esc(val)}" placeholder="${esc(arr(f.opts).length ? "직접 입력" : (f.hint || ""))}" autocomplete="off"${f.fleet ? ' list="sp-fleet"' : ""}${live ? "" : " readonly"}>`;
        const quick = !live ? "" : f.auto ? `<button type="button" class="link-btn" data-nf-now="${esc(f.id)}">지금 · 기록자</button>`
          : f.start ? `<button type="button" class="link-btn" data-nf-start="${esc(f.id)}">발생 시각 입력</button>` : "";
        return `<div class="sp-nrow"><label for="${id}"><span class="mono">${i + 1})</span> ${esc(f.label)}</label><div class="sp-nin">${opts}${inp}${quick}</div></div>`;
      }).join("")}</div>
      ${fleet.length ? `<datalist id="sp-fleet">${fleet.map(a => `<option value="${esc(a.model || a.type || "")} ${esc(a.reg)}">`).join("")}</datalist>` : ""}
      </section>
      <section class="card sp-sec sp-npv"><header class="sp-sh"><h3>보낼 내용</h3></header>
        <pre class="sp-pre" id="sp-npre">${esc(notifyText(run))}</pre>
        <div class="sp-nacts"><button type="button" class="btn btn-primary btn-sm" data-copy-notify>${icon("doc", 15)}<span>복사</span></button>
          <button type="button" class="btn btn-ghost btn-sm" data-share-notify>${icon("forward", 15)}<span>공유 (카카오톡 등)</span></button>
          <a class="btn btn-ghost btn-sm" id="sp-nsms" href="sms:?&body=${encodeURIComponent(notifyText(run))}">${icon("megaphone", 15)}<span>문자</span></a>
          ${live ? `<button type="button" class="btn btn-danger btn-sm" data-notify-sent>${icon("check", 15)}<span>통보 완료 기록</span></button>` : ""}</div>
        ${sent.length ? `<ul class="sp-sent">${sent.map(s => `<li><span class="mono">${esc(hm(s.at))} · ${esc(tplus(run, s.at))}</span> ${esc(s.to || "")}${s.by ? " · " + esc(s.by) : ""}</li>`).join("")}</ul>` : ""}
      </section></div>`;
  }
  function runLogHTML(run) {
    const live = !run.end && canRun();
    const list = arr(run.log).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return `<section class="card sp-sec">${live ? `<div class="sp-logadd"><textarea id="sp-log" rows="2" placeholder="상황 · 지시 · 연락 내용을 짧게">${esc(drafts["sp-log"] || "")}</textarea>
        <button type="button" class="btn btn-primary" id="sp-log-add">${icon("plus", 16)}<span>기록</span></button></div>` : ""}
      ${list.length ? `<ol class="sp-log">${list.map(l => `<li><span class="sp-log-t mono">${esc(hm(l.at))}<small>${esc(tplus(run, l.at))}</small></span>
        <div><p>${esc(l.text)}</p>${l.by ? `<small>${esc(l.by)}</small>` : ""}</div>
        ${SeMIS.canDelete() ? `<button type="button" class="sp-ed" data-log-del="${esc(l.id)}" aria-label="기록 삭제">${icon("trash", 14)}</button>` : ""}</li>`).join("")}</ol>`
        : ui.empty("상황 기록이 없습니다.")}</section>`;
  }
  function runSubsHTML(run) {
    const live = !run.end && canRun(), list = arr(run.subs);
    return `<section class="card sp-sec"><header class="sp-sh"><span class="sp-no mono">7.2</span><h3>사고자료 관리 대장</h3><span class="spacer"></span>
      ${live ? `<button type="button" class="btn btn-primary btn-sm" id="sp-sub-add">${icon("plus", 15)}<span>제출 기록</span></button>` : ""}</header>
      <p class="sp-hint">법규상 제출 의무가 없는 자료는 본사 사고대책본부 지침을 받아 처리하고, 먼저 제출했으면 제출 당일 본사에 보고한다.</p>
      ${list.length ? `<div class="table-wrap"><table class="tbl sp-ledger"><thead><tr>${LEDGER_COLS.map(c => `<th>${esc(c)}</th>`).join("")}<th>본사 보고</th></tr></thead>
        <tbody>${list.map((s, i) => `<tr data-sub="${esc(s.id)}"><td class="mono">${i + 1}</td><td><b>${esc(s.doc)}</b></td><td>${esc(s.agency)}</td>
          <td>${esc(s.reqBy)}${s.reqAt ? `<small class="sp-sub mono">${esc(ymdhm(s.reqAt))}</small>` : ""}</td><td>${esc(s.recv)}</td>
          <td>${esc(s.by)}${s.at ? `<small class="sp-sub mono">${esc(ymdhm(s.at))}</small>` : ""}</td><td>${esc(s.method)}</td><td>${esc(s.basis)}</td>
          <td>${s.hq ? ui.chip("보고", "green") : ui.chip("미보고", "amber")}${live ? ` <button type="button" class="sp-ed" data-sub-edit="${esc(s.id)}" aria-label="수정">${icon("edit", 14)}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : ui.empty("제출 기록이 없습니다.")}</section>`;
  }
  /* A4 결과 보고 (인쇄 전용) */
  function reportHTML(run) {
    const st = runStat(run), done = tlOf(run), ck = ckOf(run), v = obj(obj(run.notify).f);
    const row = (k, val) => `<tr><th>${esc(k)}</th><td>${val}</td></tr>`;
    return `<h2>${run.kind === "drill" ? "SERP 훈련 결과" : "위기상황 대응 결과"} — ${esc(runTitle(run))}</h2>
      <table class="sp-rpt"><tbody>${row("구분", run.kind === "drill" ? "훈련" : "실제 상황")}${row("발생", esc(ymdhm(run.start)))}
        ${row("종료", run.end ? esc(ymdhm(run.end)) + " (소요 " + esc(durText(st.elapsed)) + ")" : "진행 중")}${row("장소 · 개요", esc(run.place || "-"))}
        ${row("팀위기대응센터", run.serc && run.serc.at ? esc((run.serc.mode === "online" ? "온라인 " : "현장 ") + (run.serc.place || "") + " · " + hm(run.serc.at) + " (" + tplus(run, run.serc.at) + ")") : "미개설")}
        ${row("초동조치", st.done + " / " + st.total + (st.late ? " · 기한 경과 " + st.late : ""))}${row("체크리스트", st.ckDone + " / " + st.ckTotal)}</tbody></table>
      <h3>시간대별 초동조치</h3><table class="sp-rpt"><thead><tr><th>시간대</th><th>조치사항</th><th>수행자</th><th>완료</th><th>기록자 · 비고</th></tr></thead>
        <tbody>${runItems(run).map(x => { const d = done[x.id]; return `<tr><td>${esc(phaseLabel(x.min))}</td><td>${esc(x.text)}${x.sub ? " (" + esc(x.sub) + ")" : ""}</td><td>${esc(x.who || arr(x.roles).map(roleName).join(", "))}</td>
          <td>${d && d.at ? esc(hm(d.at)) + " · " + esc(tplus(run, d.at)) : "-"}</td><td>${d ? esc([d.by, d.note].filter(Boolean).join(" · ")) : ""}</td></tr>`; }).join("")}</tbody></table>
      ${runCks(run).map(r => `<h3>${esc(r.name)} 체크리스트</h3><table class="sp-rpt"><tbody>${arr(r.items).map((t, i) => { const d = ck[r.id + ":" + i];
        return `<tr><td>${esc(t)}</td><td>${d && d.at ? esc(hm(d.at)) + " · " + esc(tplus(run, d.at)) : "-"}</td><td>${d ? esc([d.by, d.note].filter(Boolean).join(" · ")) : ""}</td></tr>`; }).join("")}</tbody></table>`).join("")}
      <h3>통보 양식</h3><table class="sp-rpt"><tbody>${arr(P().notify).map((f, i) => row((i + 1) + ") " + f.label, esc(v[f.id] || ""))).join("")}</tbody></table>
      <h3>상황 기록</h3><table class="sp-rpt"><tbody>${arr(run.log).slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).map(l => `<tr><td class="mono">${esc(hm(l.at))} · ${esc(tplus(run, l.at))}</td><td>${esc(l.text)}</td><td>${esc(l.by || "")}</td></tr>`).join("") || "<tr><td>-</td></tr>"}</tbody></table>
      <h3>사고자료 관리 대장</h3><table class="sp-rpt"><thead><tr>${LEDGER_COLS.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${arr(run.subs).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.doc)}</td><td>${esc(s.agency)}</td>
        <td>${esc(s.reqBy)} ${s.reqAt ? esc(ymdhm(s.reqAt)) : ""}</td><td>${esc(s.recv)}</td><td>${esc(s.by)} ${s.at ? esc(ymdhm(s.at)) : ""}</td><td>${esc(s.method)}</td><td>${esc(s.basis)}</td></tr>`).join("") || `<tr><td colspan="8">-</td></tr>`}</tbody></table>`;
  }

  /* ── 렌더 ── */
  function render(root) {
    const focus = captureFocus(root);
    const run = runSel ? runs().find(r => r.id === runSel) : null;
    if (runSel && !run) runSel = "";
    if (run) {
      const acts = [
        `<button type="button" class="btn btn-ghost btn-sm" id="sp-back">${icon("chevron", 15)}<span>계획</span></button>`,
        !run.end && canRun() ? `<button type="button" class="btn btn-danger btn-sm" id="sp-end">${icon("check", 15)}<span>대응 종료</span></button>` : "",
        run.end && canW() ? `<button type="button" class="btn btn-ghost btn-sm" id="sp-reopen">${icon("repeat", 15)}<span>다시 열기</span></button>` : "",
        SeMIS.canDelete() ? `<button type="button" class="btn btn-ghost btn-sm" id="sp-rdel">${icon("trash", 15)}<span>삭제</span></button>` : ""
      ].join("");
      root.innerHTML = ui.head({ title: run.kind === "drill" ? "SERP 훈련 기록" : "위기상황 대응", meta: P().docNo || "", actions: acts }) + runView(run);
    } else {
      const pl = P();
      const acts = canW() && !hasPlan() ? `<button type="button" class="btn btn-primary btn-sm" id="sp-meta-edit">${icon("plus", 15)}<span>기본 정보</span></button>` : "";
      if (!hasPlan()) {
        root.innerHTML = ui.head({ title: TITLE, actions: acts }) + `<section class="card">${ui.empty("등록된 팀위기대응계획이 없습니다.")}</section>`;
      } else {
        const body = tab === "org" ? orgTab() : tab === "contacts" ? contactsTab() : tab === "forms" ? formsTab() : tab === "runs" ? runsTab() + (window.SemisDocs ? SemisDocs.card(MOD, { title: "교육 · 훈련 기록 (문서)" }) : "") : tab === "doc" ? docTab() : initTab();
        root.innerHTML = ui.head({ title: TITLE, meta: [pl.docNo, pl.rev && (pl.rev + (pl.revDate ? " " + pl.revDate.replace(/-/g, ".") : ""))].filter(Boolean).join(" · ") })
          + alertBar()
          + `<div class="eq-tabs sp-tabs no-print" role="tablist" aria-label="팀위기대응계획">${TABS.map(([id, lb]) =>
            `<button type="button" role="tab" class="eq-tab" data-stab="${id}" aria-selected="${tab === id}">${esc(lb)}${id === "runs" && activeRun() ? ' <i class="sp-dot" aria-hidden="true"></i>' : ""}</button>`).join("")}</div>`
          + `<div class="sp-tabbody" data-tab="${esc(tab)}">${body}</div>`;
      }
    }
    wire(root);
    if (window.SemisDocs && tab === "runs") SemisDocs.wire(root, () => SeMIS.renderView());
    restoreFocus(root, focus);
    ensureTimer();
  }

  /* 원격 변경으로 다시 그릴 때 입력 중이던 칸 · 커서를 되살린다 */
  function captureFocus(root) {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    if (!a || !a.id || !root.contains(a) || !/^sp-/.test(a.id) || !("value" in a)) return null;
    let s = null, e = null;
    try { s = a.selectionStart; e = a.selectionEnd; } catch (err) { /* 선택 불가 입력 */ }
    return { id: a.id, value: a.value, s, e };
  }
  function restoreFocus(root, f) {
    if (!f) return;
    const el = root.querySelector("#" + f.id);
    if (!el) return;
    if (el.value !== f.value) el.value = f.value;
    try { el.focus(); if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (err) { /* jsdom */ }
  }

  /* 경과 시계 · 기한 경과 표시 — 1초마다 글자만 바꾼다(화면을 다시 그리지 않음) */
  let timer = 0;
  function ensureTimer() {
    if (timer || typeof setInterval === "undefined" || typeof document === "undefined") return;
    if (!document.querySelector("[data-sp-t0]")) return;
    timer = setInterval(tick, 1000);
  }
  function tick() {
    const els = document.querySelectorAll("[data-sp-t0]");
    if (!els.length) { clearInterval(timer); timer = 0; return; }
    const now = Date.now();
    els.forEach(el => {
      const t0 = Date.parse(el.dataset.spT0);
      if (el.classList.contains("sp-clock")) el.textContent = "T+" + dur(now - t0);
      else if (el.dataset.spDue) {
        const late = now - t0 > Number(el.dataset.spDue) * 60000;
        if (late && !el.classList.contains("is-late")) {
          el.classList.add("is-late");
          const m = el.querySelector(".sp-ri-m");
          if (m && !m.querySelector(".sp-late")) m.insertAdjacentHTML("beforeend", '<span class="sp-late">기한 경과</span>');
        }
      }
    });
    document.querySelectorAll("[data-sp-pmin]").forEach(el => {
      const late = !el.dataset.spEnd && el.dataset.spPdone !== "1" && now - Date.parse(el.dataset.spPt0) > Number(el.dataset.spPmin) * 60000;
      el.classList.toggle("is-late", late);
    });
  }

  /* ── 동작 ── */
  function wire(root) {
    $$("[data-stab]", root).forEach(b => b.onclick = () => { tab = b.dataset.stab; SeMIS.renderView(); });
    $$("[data-rtab]", root).forEach(b => b.onclick = () => { runTab = b.dataset.rtab; SeMIS.renderView(); });
    $$("[data-role-f]", root).forEach(b => b.onclick = () => { roleF = b.dataset.roleF; lsSet(LS_ROLE, roleF); SeMIS.renderView(); });
    $$("[data-run-start]", root).forEach(b => b.onclick = () => startForm(b.dataset.runStart));
    $$("[data-run-open]", root).forEach(b => b.onclick = () => openRun(b.dataset.runOpen));
    $$("[data-img]", root).forEach(b => b.onclick = () => openImages(Number(b.dataset.img)));
    const fc = $("#sp-form-copy", root);
    if (fc) fc.onclick = () => copyText("[위기상황 발생 통보] " + (P().dept || "") + "\n" + arr(P().notify).map((f, i) => (i + 1) + ") " + f.label + ": ").join("\n"), "빈 양식을 복사했습니다.");
    const cqi = $("#sp-cq", root);
    if (cqi) cqi.oninput = () => {
      const v = ui.searchValue(cqi.value);
      if (v === cq) return;
      cq = v;
      const box = $("#sp-cbody", root);
      if (box) { box.innerHTML = contactsBody(); wireEdit(box); }
    };
    wireRun(root);
    wireEdit(root);
  }
  function openRun(id) { runSel = id; runTab = "tl"; if (routeNow() === MOD) SeMIS.renderView(); else SeMIS.navigate(MOD); }

  function copyText(text, msg) {
    const done = () => toast(msg || "복사했습니다.");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done)); return; }
    } catch (e) { /* 아래 대체 */ }
    fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand && document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done(); else toast("복사하지 못했습니다. 내용을 길게 눌러 복사하세요.", true);
  }
  function share(text, title) {
    if (navigator.share) { navigator.share({ title: title || "SERP", text }).catch(() => {}); return; }
    copyText(text, "공유를 지원하지 않는 브라우저라 복사했습니다.");
  }

  /* ── 대응 시작 · 종료 ── */
  function startForm(kind) {
    if (!canRun()) return;
    const act = activeRun();
    if (act) { openRun(act.id); toast("진행 중인 대응이 있어 그 화면을 엽니다."); return; }
    if (!timeline().length) { toast("초동조치 항목이 없습니다. 계획을 먼저 등록하세요.", true); return; }
    const k = kind === "drill" ? "drill" : "real";
    openModal(`<h3>${k === "drill" ? "훈련 시작" : "위기상황 대응 시작"}</h3>
      <div class="seg sp-kseg" role="group" aria-label="구분"><button type="button" class="seg-btn" data-k="real" aria-pressed="${k === "real"}">실제 상황</button>
        <button type="button" class="seg-btn" data-k="drill" aria-pressed="${k === "drill"}">훈련</button></div>
      <div class="form-row"><label for="sp-s-title">상황</label><input id="sp-s-title" autocomplete="off" placeholder="${k === "drill" ? "예: 램프 화재 도상훈련" : "예: 화물기 램프 화재"}"></div>
      <div class="form-grid"><div class="form-row"><label for="sp-s-at">발생(인지) 시각</label><input id="sp-s-at" type="datetime-local" value="${esc(localInput())}"></div>
        <div class="form-row"><label for="sp-s-place">장소 · 개요</label><input id="sp-s-place" autocomplete="off"></div></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-danger" data-act="ok">시작</button></div>`);
    let kk = k;
    $$("#modal-box [data-k]").forEach(b => b.onclick = () => { kk = b.dataset.k; $$("#modal-box [data-k]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const start = fromLocal($("#sp-s-at").value) || nowISO();
      if (Date.parse(start) > Date.now() + 5 * 60000) { toast("발생 시각이 지금보다 늦습니다.", true); return; }
      const by = recorder();
      const run = {
        id: uid("sr"), kind: kk, title: norm($("#sp-s-title").value), place: norm($("#sp-s-place").value), start, end: "",
        items: timeline().map(x => ({ id: x.id, min: Number(x.min) || 0, text: x.text, sub: x.sub || "", who: x.who || "", roles: arr(x.roles).slice(), act: x.act || "" })),
        cks: roles().map(r => ({ id: r.id, name: r.name, items: arr(r.checklist).slice() })),
        tl: {}, ck: {}, notify: { f: {}, sent: [] }, serc: null, subs: [],
        log: [{ id: uid("sl"), at: nowISO(), by, text: (kk === "drill" ? "훈련 시작" : "대응 시작") + " — SERP 가동 기록" }],
        createdBy: (SeMIS.user && SeMIS.user.name) || "", createdAt: nowISO()
      };
      ensureRuns().push(run);
      runSel = run.id; runTab = "tl";
      closeModal(); SeMIS.save();
      if (routeNow() === MOD) SeMIS.renderView(); else SeMIS.navigate(MOD);
      navSync();
      toast(kk === "drill" ? "훈련을 시작했습니다." : "대응을 시작했습니다. 종합통제팀 통보부터 진행하세요.");
    };
  }
  const curRun = () => runs().find(r => r.id === runSel) || null;
  function mutRun(fn, msg) {
    const r = curRun();
    if (!r) return;
    fn(r);
    r.updatedAt = nowISO();
    commit(msg);
  }

  function wireRun(root) {
    const back = $("#sp-back", root);
    if (back) back.onclick = () => { runSel = ""; SeMIS.renderView(); };
    const end = $("#sp-end", root);
    if (end) end.onclick = () => confirmModal("대응을 종료합니다. 종료 후에는 기록을 보거나 인쇄할 수 있습니다.", () => mutRun(r => {
      r.end = nowISO();
      r.log = arr(r.log).concat([{ id: uid("sl"), at: r.end, by: recorder(), text: (r.kind === "drill" ? "훈련" : "대응") + " 종료" }]);
    }, "종료했습니다."));
    const re = $("#sp-reopen", root);
    if (re) re.onclick = () => {
      const act = activeRun();
      if (act) { toast("진행 중인 대응이 있어 다시 열 수 없습니다.", true); return; }
      mutRun(r => { r.end = ""; }, "다시 열었습니다.");
    };
    const del = $("#sp-rdel", root);
    if (del) del.onclick = () => confirmModal("이 대응 기록을 삭제합니다.", () => {
      SeMIS.data[RKEY] = runs().filter(x => x.id !== runSel);
      runSel = "";
      commit("삭제했습니다.");
    });
    const by = $("#sp-by", root);
    if (by) by.onchange = () => { lsSet(LS_BY, norm(by.value)); };
    $$("[data-tl]", root).forEach(b => b.onclick = () => toggleDone("tl", b.dataset.tl));
    $$("[data-ck]", root).forEach(b => b.onclick = () => toggleDone("ck", b.dataset.ck));
    $$("[data-act]", root).forEach(b => { if (b.closest("#modal-box")) return; b.onclick = () => doAct(b.dataset.act); });
    /* 통보 양식 */
    $$("[data-nf]", root).forEach(inp => {
      inp.oninput = () => { drafts[inp.id] = inp.value; paintNotifyPreview(); };
      inp.onchange = () => saveNotify(inp.dataset.nf, inp.value, inp.id);
    });
    $$("[data-nf-opt]", root).forEach(b => b.onclick = () => saveNotify(b.dataset.nfOpt, b.dataset.v, "sp-nf-" + b.dataset.nfOpt));
    $$("[data-nf-now]", root).forEach(b => b.onclick = () => saveNotify(b.dataset.nfNow, ymdhm(nowISO()) + ", " + recorder(), "sp-nf-" + b.dataset.nfNow));
    $$("[data-nf-start]", root).forEach(b => b.onclick = () => { const r = curRun(); if (r) saveNotify(b.dataset.nfStart, ymdhm(r.start) + "경 (한국시각)", "sp-nf-" + b.dataset.nfStart); });
    const cp = $("[data-copy-notify]", root);
    if (cp) cp.onclick = () => { const r = curRun(); if (r) copyText(notifyText(withDrafts(r)), "통보 내용을 복사했습니다."); };
    const sh = $("[data-share-notify]", root);
    if (sh) sh.onclick = () => { const r = curRun(); if (r) share(notifyText(withDrafts(r)), "위기상황 발생 통보"); };
    const sent = $("[data-notify-sent]", root);
    if (sent) sent.onclick = () => notifySentForm();
    /* 상황 기록 */
    const lg = $("#sp-log", root), la = $("#sp-log-add", root);
    if (lg) lg.oninput = () => { drafts["sp-log"] = lg.value; };
    if (la && lg) la.onclick = () => {
      const t = norm(lg.value);
      if (!t) { toast("내용을 입력하세요.", true); return; }
      delete drafts["sp-log"];
      mutRun(r => { r.log = arr(r.log).concat([{ id: uid("sl"), at: nowISO(), by: recorder(), text: t }]); });
    };
    $$("[data-log-del]", root).forEach(b => b.onclick = () => confirmModal("이 기록을 삭제합니다.", () =>
      mutRun(r => { r.log = arr(r.log).filter(l => l.id !== b.dataset.logDel); }, "삭제했습니다.")));
    const sa = $("#sp-sub-add", root);
    if (sa) sa.onclick = () => subForm("");
    $$("[data-sub-edit]", root).forEach(b => b.onclick = () => subForm(b.dataset.subEdit));
  }
  function withDrafts(r) {
    const f = Object.assign({}, obj(obj(r.notify).f));
    Object.keys(drafts).forEach(k => { if (/^sp-nf-/.test(k)) f[k.slice(6)] = drafts[k]; });
    return Object.assign({}, r, { notify: Object.assign({}, r.notify, { f }) });
  }
  function paintNotifyPreview() {
    const r = curRun(), pre = $("#sp-npre"), sms = $("#sp-nsms");
    if (!r || !pre) return;
    const t = notifyText(withDrafts(r));
    pre.textContent = t;
    if (sms) sms.setAttribute("href", "sms:?&body=" + encodeURIComponent(t));
  }
  function saveNotify(fid, val, inputId) {
    const r = curRun();
    if (!r || r.end) return;
    delete drafts[inputId];
    const n = obj(r.notify), f = obj(n.f);
    if ((f[fid] || "") === val) { paintNotifyPreview(); return; }
    mutRun(x => { x.notify = Object.assign({ sent: [] }, n, { f: Object.assign({}, f, { [fid]: val }) }); });
  }
  function notifySentForm() {
    const occ = obj(P().occ);
    const tos = [occ.team ? "종합통제팀 (OCC)" : ""].concat(arr(obj(P().chart).hq).map(c => c.org), arr(obj(P().chart).ext).map(c => c.org)).filter(Boolean);
    openModal(`<h3>통보 완료 기록</h3>
      <div class="form-row"><label for="sp-ns-to">통보처</label><input id="sp-ns-to" list="sp-ns-dl" value="${esc(tos[0] || "")}" autocomplete="off">
        <datalist id="sp-ns-dl">${Array.from(new Set(tos)).map(t => `<option value="${esc(t)}">`).join("")}</datalist></div>
      <div class="form-row"><label for="sp-ns-at">통보 시각</label><input id="sp-ns-at" type="datetime-local" value="${esc(localInput())}"></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">기록</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const to = norm($("#sp-ns-to").value), at = fromLocal($("#sp-ns-at").value) || nowISO(), by = recorder();
      closeModal();
      mutRun(r => {
        const n = obj(r.notify);
        r.notify = Object.assign({ f: {} }, n, { sent: arr(n.sent).concat([{ at, to, by }]) });
        r.log = arr(r.log).concat([{ id: uid("sl"), at, by, text: "위기상황 발생 통보 — " + (to || "통보처 미기재") }]);
        const occItem = runItems(r).find(x => x.act === "occ");
        if (occItem && /종합통제|OCC/i.test(to) && !(tlOf(r)[occItem.id] && tlOf(r)[occItem.id].at)) r.tl = Object.assign({}, tlOf(r), { [occItem.id]: { at, by, note: "" } });
      }, "기록했습니다.");
    };
  }

  /* 완료 체크: 미완료 → 지금 시각으로 완료 / 완료 → 시각 · 비고 수정 또는 취소 */
  function toggleDone(kind, key) {
    const r = curRun();
    if (!r || !canRun()) return;
    const map = kind === "tl" ? tlOf(r) : ckOf(r), d = map[key];
    if (!d || !d.at) {
      if (r.end) return;
      mutRun(x => { x[kind] = Object.assign({}, kind === "tl" ? tlOf(x) : ckOf(x), { [key]: { at: nowISO(), by: recorder(), note: "" } }); });
      return;
    }
    const label = kind === "tl" ? (runItems(r).find(x => x.id === key) || {}).text : ckLabel(r, key);
    openModal(`<h3>완료 기록</h3><p class="sp-mtitle">${esc(label || "")}</p>
      <div class="form-grid"><div class="form-row"><label for="sp-d-at">완료 시각</label><input id="sp-d-at" type="datetime-local" value="${esc(localInput(d.at))}"></div>
        <div class="form-row"><label for="sp-d-by">기록자</label><input id="sp-d-by" value="${esc(d.by || "")}" autocomplete="off"></div></div>
      <div class="form-row"><label for="sp-d-note">비고 (조치 세부 내용)</label><textarea id="sp-d-note" rows="2">${esc(d.note || "")}</textarea></div>
      <div class="modal-actions">${r.end && !canW() ? "" : '<button type="button" class="btn btn-danger" data-act="undo">완료 취소</button>'}<span class="spacer" style="flex:1"></span>
        <button type="button" class="btn btn-ghost" data-act="cancel">닫기</button>${r.end && !canW() ? "" : '<button type="button" class="btn btn-primary" data-act="ok">저장</button>'}</div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const set = (v) => mutRun(x => {
      const m = Object.assign({}, kind === "tl" ? tlOf(x) : ckOf(x));
      if (v) m[key] = v; else delete m[key];
      x[kind] = m;
    });
    const undo = $("#modal-box [data-act=undo]");
    if (undo) undo.onclick = () => { closeModal(); set(null); };
    const ok = $("#modal-box [data-act=ok]");
    if (ok) ok.onclick = () => {
      const at = fromLocal($("#sp-d-at").value), by = norm($("#sp-d-by").value), note = norm($("#sp-d-note").value);
      if (!at) { toast("시각을 입력하세요.", true); return; }
      closeModal();
      set({ at, by, note });
    };
  }
  function ckLabel(r, key) {
    const [rid, i] = String(key).split(":");
    const c = runCks(r).find(x => x.id === rid);
    return c ? arr(c.items)[Number(i)] : "";
  }

  /* 항목별 바로 하기 */
  function listModal(title, rows, extra) {
    openModal(`<h3>${esc(title)}</h3><ul class="sp-lm">${rows.map(x => `<li><div><b>${esc(x.org)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ""}</div>${telA(x.phone)}</li>`).join("") || '<li class="sp-miss">등록된 연락처가 없습니다.</li>'}</ul>
      ${extra || ""}<div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
  }
  function doAct(a) {
    const pl = P(), ch = obj(pl.chart), ov = obj(pl.overview);
    if (a === "serc") return sercForm();
    if (a === "recall") return recallForm();
    if (a === "occ") { const o = obj(pl.occ); return listModal("종합통제팀 통보", [{ org: o.team, phone: o.phone, note: o.who }], `<button type="button" class="btn btn-primary btn-sm sp-mgo" data-go-notify>${icon("doc", 15)}<span>통보 양식 작성</span></button>`) || wireGoNotify(); }
    if (a === "apt") return listModal("공항당국 상호 확인", arr(ch.ext).filter(c => /통합운영|비상관리/.test(c.org)).concat(arr(pl.agencies).filter(g => /공항 당국|항공 당국|관제탑/.test(g.grp || ""))));
    if (a === "lead") return listModal("팀장 보고", peopleOf("leader").map(p => ({ org: "팀장 " + p.name, phone: p.mobile })));
    if (a === "agency") return listModal("관계기관 통보", arr(ov.mandatory).map(m => ({ org: m.org, phone: m.phone, note: "의무 보고" + (m.items ? " · " + m.items : "") })).concat(arr(ch.ext)));
    if (a === "near") return listModal("인근 팀 비상연락", arr(ov.nearby).map(m => ({ org: m.org, phone: m.phone, note: m.support })));
    if (a === "report") return listModal("본사 사고대책본부 보고", arr(ch.hq), `<button type="button" class="btn btn-primary btn-sm sp-mgo" data-go-notify>${icon("doc", 15)}<span>보고 내용(통보 양식)</span></button>`) || wireGoNotify();
    if (a === "facility") return listModal("승무원 보호 · 가족 지원 시설", arr(pl.facilities).map(f => ({ org: f.name + (f.conf ? " (대외비)" : ""), phone: f.phone, note: [f.kind, f.note].filter(Boolean).join(" · ") })));
  }
  function wireGoNotify() {
    const b = $("#modal-box [data-go-notify]");
    if (b) b.onclick = () => { closeModal(); runTab = "notify"; SeMIS.renderView(); };
  }
  function sercForm() {
    const r = curRun();
    if (!r || r.end) return;
    const s = obj(r.serc), pl = obj(P().serc);
    const mode = s.mode || "onsite";
    openModal(`<h3>팀위기대응센터 (SERC) 개설</h3>
      <div class="seg sp-kseg" role="group" aria-label="개설 방식"><button type="button" class="seg-btn" data-m="onsite" aria-pressed="${mode === "onsite"}">현장 개설</button>
        <button type="button" class="seg-btn" data-m="online" aria-pressed="${mode === "online"}">온라인(가상) 개설</button></div>
      <p class="sp-mhint" id="sp-sc-hint"></p>
      <div class="form-row"><label for="sp-sc-place" id="sp-sc-lbl">장소</label><input id="sp-sc-place" autocomplete="off" value="${esc(s.place || "")}"></div>
      <div class="form-row"><label for="sp-sc-at">개설 시각</label><input id="sp-sc-at" type="datetime-local" value="${esc(localInput(s.at || undefined))}"></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">기록</button></div>`);
    let m = mode;
    const paint = () => {
      $("#sp-sc-lbl").textContent = m === "online" ? "대체 통신 채널" : "장소";
      $("#sp-sc-place").placeholder = m === "online" ? (pl.channel || "예: 카카오톡 위기대응 단체방") : (pl.place || "예: 팀 사무실");
      $("#sp-sc-hint").textContent = m === "online" ? "통신 · 사무 시설의 설치나 사용이 어려울 때 — 담당자는 본인 지정 업무 공간에서 대응 (3.5.1)" : "통신 · 시설 · 위치를 고려해 선정 (3.5.1)";
    };
    paint();
    $$("#modal-box [data-m]").forEach(b => b.onclick = () => { m = b.dataset.m; $$("#modal-box [data-m]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); paint(); });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const at = fromLocal($("#sp-sc-at").value) || nowISO(), place = norm($("#sp-sc-place").value), by = recorder();
      closeModal();
      mutRun(x => {
        x.serc = { mode: m, place, at, by };
        const it = runItems(x).find(i => i.act === "serc");
        if (it) x.tl = Object.assign({}, tlOf(x), { [it.id]: { at, by, note: (m === "online" ? "온라인 개설" : "현장 개설") + (place ? " · " + place : "") } });
        x.log = arr(x.log).concat([{ id: uid("sl"), at, by, text: "팀위기대응센터 " + (m === "online" ? "온라인(가상) 개설" : "현장 개설") + (place ? " — " + place : "") }]);
      }, "기록했습니다.");
    };
  }
  function recallForm() {
    const r = curRun();
    if (!r || r.end) return;
    const ps = people().filter(p => p.mobile);
    const s = obj(r.serc);
    const where = s.at ? (s.mode === "online" ? "온라인 위기대응센터(" + (s.place || "메신저") + ")" : (s.place || "팀 사무실")) : "팀 사무실 또는 팀장 지정 장소";
    const msg = `[비상소집] ${r.kind === "drill" ? "(훈련) " : ""}${runTitle(r)} — SERP 가동. 즉시 ${where}로 응소 바랍니다. ${P().dept || ""}`;
    openModal(`<h3>비상소집</h3>
      <div class="form-row"><label for="sp-rc-msg">문자 내용</label><textarea id="sp-rc-msg" rows="3">${esc(msg)}</textarea></div>
      <div class="sp-rcl">${ps.map(p => `<label><input type="checkbox" data-rc="${esc(p.id)}" checked><span>${esc(p.name)}</span>${rchip(p.role)}<span class="mono">${esc(p.mobile)}</span></label>`).join("")}</div>
      <div class="sp-nacts"><a class="btn btn-primary btn-sm" id="sp-rc-sms" href="#">${icon("megaphone", 15)}<span>문자 발송</span></a>
        <button type="button" class="btn btn-ghost btn-sm" id="sp-rc-copy">${icon("doc", 15)}<span>내용 복사</span></button>
        <button type="button" class="btn btn-ghost btn-sm" id="sp-rc-share">${icon("forward", 15)}<span>공유 (카카오톡 등)</span></button></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button><button type="button" class="btn btn-danger" data-act="ok">소집 완료 기록</button></div>`, { wide: true });
    const nums = () => $$("#modal-box [data-rc]").filter(c => c.checked).map(c => smsNum((people().find(p => p.id === c.dataset.rc) || {}).mobile)).filter(Boolean);
    const paint = () => { $("#sp-rc-sms").setAttribute("href", "sms:" + nums().join(",") + "?&body=" + encodeURIComponent($("#sp-rc-msg").value)); };
    paint();
    $("#sp-rc-msg").oninput = paint;
    $$("#modal-box [data-rc]").forEach(c => c.onchange = paint);
    $("#sp-rc-copy").onclick = () => copyText($("#sp-rc-msg").value, "소집 문자를 복사했습니다.");
    $("#sp-rc-share").onclick = () => share($("#sp-rc-msg").value, "비상소집");
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const n = nums().length, at = nowISO(), by = recorder();
      closeModal();
      mutRun(x => {
        const it = runItems(x).find(i => i.act === "recall");
        if (it && !(tlOf(x)[it.id] && tlOf(x)[it.id].at)) x.tl = Object.assign({}, tlOf(x), { [it.id]: { at, by, note: n + "명 소집" } });
        x.log = arr(x.log).concat([{ id: uid("sl"), at, by, text: "직원 비상소집 — " + n + "명" }]);
      }, "기록했습니다.");
    };
  }
  function subForm(id) {
    const r = curRun();
    if (!r || r.end) return;
    const s = id ? arr(r.subs).find(x => x.id === id) : null;
    const v = s || { doc: "", agency: "", reqBy: "", reqAt: "", recv: recorder(), by: recorder(), at: nowISO(), method: "", basis: "", hq: false };
    const f = (k, lb, html) => `<div class="form-row"><label for="sp-sb-${k}">${lb}</label>${html}</div>`;
    const inp = (k, val, list) => `<input id="sp-sb-${k}" value="${esc(val || "")}" autocomplete="off"${list ? ` list="${list}"` : ""}>`;
    openModal(`<h3>사고자료 제출 ${s ? "수정" : "기록"}</h3>
      ${f("doc", "자료명", inp("doc", v.doc, "sp-sb-dl"))}<datalist id="sp-sb-dl">${arr(P().docs).map(d => `<option value="${esc(d)}">`).join("")}</datalist>
      <div class="form-grid">${f("agency", "관계기관", inp("agency", v.agency))}${f("reqby", "담당자 (요청자)", inp("reqby", v.reqBy))}</div>
      <div class="form-grid">${f("reqat", "요청 일시", `<input id="sp-sb-reqat" type="datetime-local" value="${esc(v.reqAt ? localInput(v.reqAt) : "")}">`)}${f("recv", "요청 접수자", inp("recv", v.recv))}</div>
      <div class="form-grid">${f("by", "제출자", inp("by", v.by))}${f("at", "제출 일시", `<input id="sp-sb-at" type="datetime-local" value="${esc(v.at ? localInput(v.at) : "")}">`)}</div>
      <div class="form-grid">${f("method", "제출 방법", inp("method", v.method, "sp-sb-ml"))}${f("basis", "비고 (근거 법규)", inp("basis", v.basis))}</div>
      <datalist id="sp-sb-ml"><option value="이메일 (파일 첨부)"><option value="지면 (자료 사본)"><option value="카톡 (파일 첨부)"></datalist>
      <label class="sp-chkrow"><input type="checkbox" id="sp-sb-hq"${v.hq ? " checked" : ""}><span>제출 사실을 본사 사고대책본부에 보고함</span></label>
      <div class="modal-actions">${s ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    const val = (k) => norm(($("#sp-sb-" + k) || {}).value);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => { closeModal(); mutRun(x => { x.subs = arr(x.subs).filter(y => y.id !== id); }, "삭제했습니다."); };
    $("#modal-box [data-act=ok]").onclick = () => {
      const o = { doc: val("doc"), agency: val("agency"), reqBy: val("reqby"), reqAt: fromLocal($("#sp-sb-reqat").value), recv: val("recv"),
        by: val("by"), at: fromLocal($("#sp-sb-at").value), method: val("method"), basis: val("basis"), hq: $("#sp-sb-hq").checked };
      if (!o.doc || !o.agency) { toast("자료명과 관계기관을 입력하세요.", true); return; }
      closeModal();
      mutRun(x => {
        if (s) x.subs = arr(x.subs).map(y => y.id === id ? Object.assign({}, y, o) : y);
        else x.subs = arr(x.subs).concat([Object.assign({ id: uid("ss") }, o)]);
      }, "저장했습니다.");
    };
  }
  function openImages(i) {
    const im = arr(P().images).filter(x => x && x.url);
    if (!im.length) return;
    if (window.SemisFiles && SemisFiles.open) {
      SemisFiles.open(im.map(x => ({ url: x.url, name: x.title, kind: "img" })), Math.max(0, Math.min(i || 0, im.length - 1)));
    } else window.open(im[i].url, "_blank", "noopener");
  }

  /* ── hq 편집 ── */
  function wireEdit(root) {
    if (!canW()) return;
    const on = (sel, fn) => { const b = $(sel, root); if (b) b.onclick = fn; };
    on("#sp-meta-edit", metaForm);
    on("#sp-occ-edit", occForm);
    on("#sp-serc-edit", sercPlanForm);
    on("#sp-tl-edit", timelineForm);
    on("#sp-chart-edit", chartForm);
    on("#sp-ov-edit", overviewForm);
    on("#sp-gaps-edit", () => linesForm("원문 확인 필요", arr(P().gaps), (v) => { ensurePlan().gaps = v; }));
    $$("[data-sec-edit]", root).forEach(b => b.onclick = () => sectionForm(b.dataset.secEdit));
    $$("[data-person-edit]", root).forEach(b => b.onclick = () => personForm(b.dataset.personEdit, ""));
    $$("[data-person-add]", root).forEach(b => b.onclick = () => personForm("", b.dataset.personAdd));
    $$("[data-role-edit]", root).forEach(b => b.onclick = () => roleForm(b.dataset.roleEdit));
    $$("[data-ck-edit]", root).forEach(b => b.onclick = () => {
      const r = roleOf(b.dataset.ckEdit);
      if (r) linesForm(r.name + " 체크리스트", arr(r.checklist), (v) => { r.checklist = v; });
    });
    $$("[data-c-edit]", root).forEach(b => b.onclick = () => contactForm(b.dataset.cEdit, ""));
    $$("[data-c-add]", root).forEach(b => b.onclick = () => contactForm("", b.dataset.cAdd));
    $$("[data-mgmt]", root).forEach(b => b.onclick = () => {
      const m = arr(P().mgmt).find(x => x.id === b.dataset.mgmt);
      if (m) { m.checked = today(); commit("점검일을 기록했습니다."); }
    });
    const up = $("#sp-file-up", root), file = $("#sp-file", root);
    if (up && file) {
      up.onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files && file.files[0]; file.value = "";
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) { toast("20MB 이하 파일만 올릴 수 있습니다.", true); return; }
        try {
          const res = await SemisSync.uploadFile(f, "crisis");
          const pl = ensurePlan(); pl.fileUrl = res.url; pl.fileName = f.name;
          commit("원본 파일을 등록했습니다.");
        } catch (e) { toast("올리지 못했습니다.", true); }
      };
    }
  }
  const actions = (del) => `<div class="modal-actions">${del ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
    <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`;
  function bindModal(onOk, onDel) {
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => { if (onOk() !== false) closeModal(); };
    const d = $("#modal-box [data-act=del]");
    if (d && onDel) d.onclick = onDel;
  }
  const mv = (id) => norm(($("#" + id) || {}).value);
  const lines = (id) => String(($("#" + id) || {}).value || "").split("\n").map(norm).filter(Boolean);
  const row = (id, lb, html) => `<div class="form-row"><label for="${id}">${lb}</label>${html}</div>`;
  const tin = (id, v, ph) => `<input id="${id}" value="${esc(v || "")}" autocomplete="off"${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
  const tarea = (id, v, n) => `<textarea id="${id}" rows="${n || 4}">${esc(v || "")}</textarea>`;

  function metaForm() {
    const pl = P();
    openModal(`<h3>문서 정보</h3>
      <div class="form-grid">${row("sp-m-title", "문서명", tin("sp-m-title", pl.title || "팀위기대응계획"))}${row("sp-m-no", "관리 번호", tin("sp-m-no", pl.docNo))}</div>
      <div class="form-grid">${row("sp-m-dept", "주관 부서", tin("sp-m-dept", pl.dept))}${row("sp-m-owner", "제정권자", tin("sp-m-owner", pl.owner))}</div>
      <div class="form-grid">${row("sp-m-first", "최초 시행일", `<input id="sp-m-first" type="date" value="${esc(pl.firstDate || "")}">`)}
        ${row("sp-m-rev", "현행 개정", tin("sp-m-rev", pl.rev, "제1차 개정"))}</div>
      ${row("sp-m-revdate", "개정일", `<input id="sp-m-revdate" type="date" value="${esc(pl.revDate || "")}">`)}
      ${row("sp-m-purpose", "목적", tarea("sp-m-purpose", pl.purpose, 3))}
      ${row("sp-m-scope", "적용 범위 " + ui.tip("한 줄에 한 항목", "적용 범위 설명"), tarea("sp-m-scope", arr(pl.scope).join("\n"), 4))}
      ${actions(false)}`, { wide: true });
    bindModal(() => {
      const p = ensurePlan();
      Object.assign(p, { title: mv("sp-m-title"), docNo: mv("sp-m-no"), dept: mv("sp-m-dept"), owner: mv("sp-m-owner"),
        firstDate: mv("sp-m-first"), rev: mv("sp-m-rev"), revDate: mv("sp-m-revdate"), purpose: mv("sp-m-purpose"), scope: lines("sp-m-scope") });
      if (!p.title) { toast("문서명을 입력하세요.", true); return false; }
      commit("저장했습니다.");
    });
  }
  function occForm() {
    const o = obj(P().occ);
    openModal(`<h3>사내 통보처 (3.1.1)</h3>${row("sp-o-team", "접수 담당팀", tin("sp-o-team", o.team))}
      <div class="form-grid">${row("sp-o-phone", "전화", tin("sp-o-phone", o.phone))}${row("sp-o-who", "담당자", tin("sp-o-who", o.who))}</div>${actions(false)}`);
    bindModal(() => { ensurePlan().occ = Object.assign({}, o, { team: mv("sp-o-team"), phone: fmtPhone(mv("sp-o-phone")), who: mv("sp-o-who") }); commit("저장했습니다."); });
  }
  function sercPlanForm() {
    const s = obj(P().serc);
    openModal(`<h3>팀위기대응센터 (SERC)</h3>
      <div class="form-grid">${row("sp-sp-within", "개설 기한(분)", `<input id="sp-sp-within" type="number" min="5" max="240" value="${esc(s.within || 30)}">`)}${row("sp-sp-channel", "대체 통신 채널", tin("sp-sp-channel", s.channel, "예: 카카오톡 위기대응 단체방"))}</div>
      <div class="form-grid">${row("sp-sp-place", "SERC 위치", tin("sp-sp-place", s.place))}${row("sp-sp-equip", "보유 장비 · 시설", tin("sp-sp-equip", s.equip))}</div>
      ${row("sp-sp-intro", "개설 원칙", tarea("sp-sp-intro", s.intro, 2))}
      ${row("sp-sp-consider", "장소 선정 고려사항 " + ui.tip("한 줄에 한 항목", "고려사항 설명"), tarea("sp-sp-consider", arr(s.consider).join("\n"), 3))}
      ${row("sp-sp-online", "온라인(가상) 위기대응센터 단서", tarea("sp-sp-online", s.online, 4))}${actions(false)}`, { wide: true });
    bindModal(() => {
      ensurePlan().serc = Object.assign({}, s, { within: Math.max(5, Number(mv("sp-sp-within")) || 30), channel: mv("sp-sp-channel"), place: mv("sp-sp-place"),
        equip: mv("sp-sp-equip"), intro: mv("sp-sp-intro"), consider: lines("sp-sp-consider"), online: mv("sp-sp-online") });
      commit("저장했습니다.");
    });
  }
  function sectionForm(id) {
    const s = arr(P().sections).find(x => x.id === id);
    if (!s) return;
    openModal(`<h3>${esc(s.no)} ${esc(s.title)}</h3>${row("sp-sc-title", "제목", tin("sp-sc-title", s.title))}
      ${row("sp-sc-body", "본문 " + ui.tip("빈 줄 없이 한 줄이 한 문단", "본문 설명"), tarea("sp-sc-body", s.body, 8))}${actions(false)}`, { wide: true });
    bindModal(() => { s.title = mv("sp-sc-title"); s.body = lines("sp-sc-body").join("\n"); commit("저장했습니다."); });
  }
  function linesForm(title, list, apply) {
    openModal(`<h3>${esc(title)}</h3>${row("sp-lf", "항목 " + ui.tip("한 줄에 한 항목", "항목 설명"), tarea("sp-lf", list.join("\n"), 10))}${actions(false)}`, { wide: true });
    bindModal(() => { apply(lines("sp-lf")); commit("저장했습니다."); });
  }
  function roleForm(id) {
    const r = roleOf(id);
    if (!r) return;
    openModal(`<h3>${esc(r.name)}</h3>
      <div class="form-grid">${row("sp-ro-name", "직책", tin("sp-ro-name", r.name))}${row("sp-ro-en", "영문", tin("sp-ro-en", r.en))}</div>
      ${row("sp-ro-who", "수행자 기준", tin("sp-ro-who", r.who))}
      ${row("sp-ro-duties", "역할과 책임 " + ui.tip("한 줄에 한 항목", "역할 설명"), tarea("sp-ro-duties", arr(r.duties).join("\n"), 7))}${actions(false)}`, { wide: true });
    bindModal(() => {
      if (!mv("sp-ro-name")) { toast("직책을 입력하세요.", true); return false; }
      Object.assign(r, { name: mv("sp-ro-name"), en: mv("sp-ro-en"), who: mv("sp-ro-who"), duties: lines("sp-ro-duties") });
      commit("저장했습니다.");
    });
  }
  /* 초동조치 편집 — 한 줄: 분 | 조치 | 비고 | 수행자 | 역할 id(쉼표) | 바로 하기 */
  function timelineForm() {
    const txt = timeline().map(x => [x.min, x.text, x.sub || "", x.who || "", arr(x.roles).join(","), x.act || ""].join(" | ")).join("\n");
    openModal(`<h3>시간대별 초동조치</h3>
      <p class="sp-mhint">한 줄에 한 항목 — 분 | 조치사항 | 보충 | 수행자 | 역할(${roles().map(r => r.id).concat(Object.keys(AUX)).join(", ")}) | 바로 하기(${Object.keys(ACT_LABEL).join(", ")})</p>
      ${tarea("sp-tlf", txt, 16)}${actions(false)}`, { wide: true });
    bindModal(() => {
      const old = timeline(), out = [];
      let bad = 0;
      lines("sp-tlf").forEach((ln) => {
        const c = ln.split("|").map(norm);
        const min = Number(c[0]);
        if (!min || !c[1]) { bad++; return; }
        const prev = old.find(o => o.text === c[1] && o.min === min);
        out.push({ id: prev && !out.some(o => o.id === prev.id) ? prev.id : uid("t"), min, text: c[1], sub: c[2] || "", who: c[3] || "",
          roles: String(c[4] || "").split(",").map(norm).filter(Boolean), act: ACT_LABEL[c[5]] ? c[5] : "" });
      });
      if (bad) { toast("분 또는 조치사항이 빠진 줄이 " + bad + "개 있습니다.", true); return false; }
      ensurePlan().timeline = out;
      commit("저장했습니다. 진행 중인 대응에는 시작할 때의 항목이 유지됩니다.");
    });
  }
  function chartForm() {
    const ch = obj(P().chart);
    const txt = (list) => arr(list).map(c => c.org + " | " + c.phone).join("\n");
    openModal(`<h3>비상연락망 기관</h3><p class="sp-mhint">한 줄에 한 기관 — 기관명 | 전화</p>
      <div class="form-grid">${row("sp-ch-ext", "대외 기관", tarea("sp-ch-ext", txt(ch.ext), 5))}${row("sp-ch-hq", "본사", tarea("sp-ch-hq", txt(ch.hq), 5))}</div>${actions(false)}`, { wide: true });
    const parse = (id, pre, old) => lines(id).map((ln, i) => {
      const [org, phone] = ln.split("|").map(norm);
      const prev = arr(old).find(o => o.org === org);
      return org ? { id: prev ? prev.id : pre + Date.now().toString(36) + i, org, phone: fmtPhone(phone || "") } : null;
    }).filter(Boolean);
    bindModal(() => { ensurePlan().chart = { ext: parse("sp-ch-ext", "ce", ch.ext), hq: parse("sp-ch-hq", "ch", ch.hq) }; commit("저장했습니다."); });
  }
  function overviewForm() {
    const ov = obj(P().overview);
    const txt = (list, k) => arr(list).map(m => [m.org, m.phone, m[k] || ""].join(" | ")).join("\n");
    openModal(`<h3>팀 위기대응 개황 (6.2)</h3>
      <div class="form-grid">${row("sp-ov-leader", "팀장", tin("sp-ov-leader", ov.leader))}${row("sp-ov-airline", "지원 요청 가능 항공사", tin("sp-ov-airline", ov.airline))}</div>
      <div class="form-grid">${row("sp-ov-staff", "가용 인력 — 지점(명)", tin("sp-ov-staff", ov.staff))}${row("sp-ov-vendor", "가용 인력 — 조업사(명)", tin("sp-ov-vendor", ov.vendor))}</div>
      <div class="form-grid">${row("sp-ov-contract", "초동조치 지원 계약", tin("sp-ov-contract", ov.contract, "계약 여부 · 업체 · 지원 사항"))}${row("sp-ov-alt", "대체 공항", tin("sp-ov-alt", ov.altApt, "공항 · 거리 · 이동수단 · 소요시간"))}</div>
      ${row("sp-ov-must", "주재국 관계 기관 의무 보고 (기관 | 전화 | 보고 항목)", tarea("sp-ov-must", txt(ov.mandatory, "items"), 3))}
      ${row("sp-ov-near", "인근 팀 (팀 | 전화 | 지원 가능 사항)", tarea("sp-ov-near", txt(ov.nearby, "support"), 3))}
      <div class="form-grid">${row("sp-ov-fa", "국가별 가족 지원법", tin("sp-ov-fa", [ov.familyAct, ov.familyName].filter(Boolean).join(" · ")))}${row("sp-ov-aep", "공항 비상대응 계획 (AEP)", tin("sp-ov-aep", [ov.aep, ov.aepName].filter(Boolean).join(" · ")))}</div>
      ${actions(false)}`, { wide: true });
    const parse = (id, k, pre) => lines(id).map((ln, i) => { const c = ln.split("|").map(norm); return c[0] ? { id: pre + i, org: c[0], phone: fmtPhone(c[1] || ""), [k]: c[2] || "" } : null; }).filter(Boolean);
    const yn = (v) => { const m = /^([YN])\s*(?:·\s*)?(.*)$/i.exec(v); return m ? [m[1].toUpperCase(), m[2]] : ["", v]; };
    bindModal(() => {
      const fa = yn(mv("sp-ov-fa")), aep = yn(mv("sp-ov-aep"));
      ensurePlan().overview = Object.assign({}, ov, { leader: mv("sp-ov-leader"), airline: mv("sp-ov-airline"), staff: mv("sp-ov-staff"), vendor: mv("sp-ov-vendor"),
        contract: mv("sp-ov-contract"), altApt: mv("sp-ov-alt"), mandatory: parse("sp-ov-must", "items", "om"), nearby: parse("sp-ov-near", "support", "on"),
        familyAct: fa[0], familyName: fa[1], aep: aep[0], aepName: aep[1] });
      commit("저장했습니다.");
    });
  }
  /* 인원(6.4) — 저장하면 비상연락망 '인천화물팀' 섹션도 맞춘다 */
  function personForm(id, roleId) {
    const p = id ? people().find(x => x.id === id) : null;
    const v = p || { role: roleId || "cargo", name: "", grade: "", dept: (P().dept ? "에어제타 " + P().dept : ""), office: "", mobile: "", email: "", place: "", duties: [], note: "" };
    if (!p) { const same = peopleOf(v.role)[0]; if (same) { v.place = same.place; v.duties = arr(same.duties).slice(); v.note = same.note || ""; } }
    openModal(`<h3>${p ? "인원 수정" : "인원 추가"}</h3>
      <div class="form-grid">${row("sp-p-role", "직책", `<select id="sp-p-role">${roles().map(r => `<option value="${esc(r.id)}"${r.id === v.role ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select>`)}
        ${row("sp-p-name", "성명", tin("sp-p-name", v.name))}</div>
      <div class="form-grid">${row("sp-p-grade", "직급", tin("sp-p-grade", v.grade))}${row("sp-p-dept", "소속", tin("sp-p-dept", v.dept))}</div>
      <div class="form-grid">${row("sp-p-mobile", "휴대폰", `<input id="sp-p-mobile" type="tel" value="${esc(v.mobile || "")}" autocomplete="off">`)}
        ${row("sp-p-office", "사무실", `<input id="sp-p-office" type="tel" value="${esc(v.office || "")}" autocomplete="off">`)}</div>
      <div class="form-grid">${row("sp-p-email", "메일", `<input id="sp-p-email" type="email" value="${esc(v.email || "")}" autocomplete="off">`)}
        ${row("sp-p-place", "위기상황 시 근무 위치", tin("sp-p-place", v.place))}</div>
      ${row("sp-p-duties", "주요 업무 " + ui.tip("한 줄에 한 항목", "주요 업무 설명"), tarea("sp-p-duties", arr(v.duties).join("\n"), 3))}
      ${row("sp-p-note", "비고 (겸임 등)", tin("sp-p-note", v.note))}
      ${actions(!!p && SeMIS.canDelete())}`, { wide: true });
    bindModal(() => {
      const o = { role: $("#sp-p-role").value, name: mv("sp-p-name"), grade: mv("sp-p-grade"), dept: mv("sp-p-dept"), mobile: fmtPhone(mv("sp-p-mobile")),
        office: fmtPhone(mv("sp-p-office")), email: mv("sp-p-email"), place: mv("sp-p-place"), duties: lines("sp-p-duties"), note: mv("sp-p-note").replace(/^※\s*/, "") };
      if (!o.name) { toast("성명을 입력하세요.", true); return false; }
      if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) { toast("메일 주소 형식을 확인하세요.", true); return false; }
      const pl = ensurePlan();
      if (!Array.isArray(pl.people)) pl.people = [];
      if (p) Object.assign(p, o);
      else {
        const np = Object.assign({ id: uid("p") }, o);
        let at = -1;
        pl.people.forEach((x, i) => { if (x.role === o.role) at = i; });
        if (at >= 0) pl.people.splice(at + 1, 0, np); else pl.people.push(np);
      }
      const n = syncContacts();
      commit(n ? "저장했습니다. 비상연락망 인천화물팀에도 반영했습니다." : "저장했습니다.");
    }, () => confirmModal(p.name + " 님을 임무 배정에서 뺍니다.", () => {
      ensurePlan().people = people().filter(x => x.id !== p.id);
      syncContacts();
      commit("삭제했습니다.");
    }));
  }
  /* 연락처(6.5 · 6.6 · 6.2 · 연락망 기관) 한 줄 편집 */
  function contactForm(key, grp) {
    const pl = ensurePlan();
    const [src, id] = String(key || "ag:").split(":");
    const lists = { ag: () => pl.agencies, fac: () => pl.facilities, chart: () => arr(obj(pl.chart).ext).concat(arr(obj(pl.chart).hq)),
      must: () => obj(pl.overview).mandatory, near: () => obj(pl.overview).nearby };
    const x = id ? arr((lists[src] || lists.ag)()).find(y => y.id === id) : null;
    if (key && !x) return;
    const isFac = src === "fac", isAg = src === "ag";
    const grps = [];
    arr(pl.agencies).forEach(a => { if (a.grp && grps.indexOf(a.grp) < 0) grps.push(a.grp); });
    const v = x ? { grp: x.grp || x.kind || "", org: x.org || x.name || "", phone: x.phone || "", note: x.note || x.items || x.support || "", conf: !!x.conf }
      : { grp: grp || "", org: "", phone: "", note: "", conf: false };
    openModal(`<h3>${x ? "연락처 수정" : "관계 기관 추가"}</h3>
      ${isAg || isFac ? row("sp-c-grp", isFac ? "구분" : "분류", tin("sp-c-grp", v.grp) .replace("<input", '<input list="sp-c-gl"') + `<datalist id="sp-c-gl">${grps.map(g => `<option value="${esc(g)}">`).join("")}</datalist>`) : ""}
      <div class="form-grid">${row("sp-c-org", isFac ? "시설명" : "기관 · 이름", tin("sp-c-org", v.org))}${row("sp-c-phone", "전화", tin("sp-c-phone", v.phone))}</div>
      ${row("sp-c-note", "비고", tin("sp-c-note", v.note))}
      ${isFac ? `<label class="sp-chkrow"><input type="checkbox" id="sp-c-conf"${v.conf ? " checked" : ""}><span>대외비 (외부 노출 금지)</span></label>` : ""}
      ${actions(!!x && (isAg || isFac) && SeMIS.canDelete())}`);
    bindModal(() => {
      const o = { grp: mv("sp-c-grp"), org: mv("sp-c-org"), phone: fmtPhone(mv("sp-c-phone")), note: mv("sp-c-note") };
      if (!o.org || !o.phone) { toast("이름과 전화를 입력하세요.", true); return false; }
      if (isFac) Object.assign(x, { kind: o.grp, name: o.org, phone: o.phone, note: o.note, conf: $("#sp-c-conf").checked });
      else if (src === "must") Object.assign(x, { org: o.org, phone: o.phone, items: o.note });
      else if (src === "near") Object.assign(x, { org: o.org, phone: o.phone, support: o.note });
      else if (src === "chart") Object.assign(x, { org: o.org, phone: o.phone });
      else if (x) Object.assign(x, o);
      else {
        if (!Array.isArray(pl.agencies)) pl.agencies = [];
        const na = Object.assign({ id: uid("a") }, o, { grp: o.grp || "기타" });
        let at = -1;
        pl.agencies.forEach((y, i) => { if (y.grp === na.grp) at = i; });
        if (at >= 0) pl.agencies.splice(at + 1, 0, na); else pl.agencies.push(na);
      }
      if (cq && !cMatch({ org: o.org, phone: o.phone, note: o.note }, o.grp, cq)) { cq = ""; toast("저장했습니다. 저장한 연락처가 보이도록 검색을 해제했습니다."); SeMIS.save(); repaint(); return; }
      commit("저장했습니다.");
    }, () => confirmModal(v.org + " 연락처를 삭제합니다.", () => {
      if (isFac) pl.facilities = arr(pl.facilities).filter(y => y.id !== id);
      else pl.agencies = arr(pl.agencies).filter(y => y.id !== id);
      commit("삭제했습니다.");
    }));
  }

  /* 비상연락망(contacts) '인천화물팀' 섹션 = SERP 인원 (SERP 출처 행만 교체, 직접 넣은 행은 유지) */
  function syncContacts() {
    const c = SeMIS.data.contacts;
    const secs = c && Array.isArray(c.sections) ? c.sections : [];
    const team = norm(P().dept || "인천화물팀");
    const sec = secs.find(s => s && s.type === "people" && s.id === "cs-team") || secs.find(s => s && s.type === "people" && norm(s.title) === team);
    if (!sec) return 0;
    const mine = people().map(p => ({ id: "sp-" + p.id, serp: p.id, role: p.role === "leader" ? "팀장" : (p.grade || ""), name: p.name,
      mobile: p.mobile || "", office: p.office || "", email: p.email || "", duty: "SERP " + roleName(p.role), note: p.note || "" }));
    const others = arr(sec.rows).filter(r => r && !r.serp);
    const next = mine.concat(others);
    if (JSON.stringify(next) === JSON.stringify(arr(sec.rows))) return 0;
    sec.rows = next;
    return mine.length;
  }

  /* ── 대시보드 띠 · 메뉴 ── */
  function dashHTML() {
    const run = activeRun();
    if (!run) return "";
    const st = runStat(run);
    return `<section class="dash-serp${run.kind === "drill" ? " is-drill" : ""}" id="dash-serp" aria-label="위기대응">
      <button type="button" class="ds-go" data-dserp="${esc(run.id)}"><span class="sp-pulse" aria-hidden="true"></span>
        <span class="ds-t"><b>${run.kind === "drill" ? "SERP 훈련 진행 중" : "위기상황 대응 중"}</b><small>${esc(runTitle(run))} · ${esc(ymdhm(run.start))}</small></span>
        <span class="sp-clock mono" data-sp-t0="${esc(run.start)}">T+${dur(Date.now() - Date.parse(run.start))}</span>
        <span class="ds-n">초동조치 <b class="mono">${st.done}/${st.total}</b>${st.late ? ` · 기한 경과 <b class="mono">${st.late}</b>` : ""}</span>
        <span class="ds-open">대응 화면 ${icon("chevron", 15)}</span></button></section>`;
  }
  function mountDash() {
    const b = document.querySelector("#dash-serp [data-dserp]");
    if (b) b.onclick = () => openRun(b.dataset.dserp);
    ensureTimer();
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { return activeRun() ? "대응 중" : ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: "팀위기대응계획", ico: "alert", module: MOD,
    items: () => {
      const go = (t) => () => { tab = t; runSel = ""; if (routeNow() === MOD) setTimeout(() => SeMIS.renderView(), 0); };
      return people().map(p => ({ title: p.name, sub: roleName(p.role) + (p.mobile ? " · " + p.mobile : ""), text: [p.name, p.mobile, p.office, p.email, roleName(p.role)], route: MOD, pick: go("org") }))
        .concat(arr(P().agencies).map(a => ({ title: a.org, sub: [a.grp, a.phone].filter(Boolean).join(" · "), text: [a.org, a.grp, a.phone, a.note], route: MOD, pick: go("contacts") })))
        .concat(arr(P().facilities).map(f => ({ title: f.name, sub: [f.kind, f.phone].filter(Boolean).join(" · "), text: [f.name, f.kind, f.phone], route: MOD, pick: go("contacts") })))
        .concat(timeline().map(x => ({ title: x.text, sub: "초동조치 " + phaseLabel(x.min) + " · " + (x.who || ""), text: [x.text, x.sub, x.who], route: MOD, pick: go("init") })));
    }
  });

  (window.SemisDeep = window.SemisDeep || {})[MOD] = (sub) => { if (TABS.some(x => x[0] === sub)) tab = sub; };
  window.SemisSerp = {
    activeRun, runStat, phases, phaseLabel, notifyText, syncContacts, telHref, dur, durText, dashHTML, mountDash, tick,
    startForm, toggleDone, sercForm, recallForm, subForm, personForm, contactForm, timelineForm, doAct,
    getState: () => ({ tab, runSel, runTab, roleF, cq }),
    setState: (s) => {
      s = s || {};
      if (s.tab) tab = s.tab; if (s.runSel != null) runSel = s.runSel; if (s.runTab) runTab = s.runTab;
      if (s.roleF != null) roleF = s.roleF; if (s.cq != null) cq = s.cq;
    },
    stopTimer: () => { if (timer) { clearInterval(timer); timer = 0; } }
  };
})();
