/* 테러 위협전화 대응 — 협박 전화(메일 · 편지) 접수 시 응대 → 보고 → 후속조치(근거: 보안 위해 상황 비상대책 · 응대요령 및 보고절차 · 폭발물 위협 보고양식).
   ※ 원문 · 번호 · 이름은 공개 저장소에 넣지 않는다 — 공용 DB(semis_logi_store "threat")에만. */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "threat", KEY = "threat", RKEY = "threatRuns", CKEY = "threatChecks", TITLE = "테러 위협전화 대응";
  const LS_BY = "semisl:threat-by", LS_DEPT = "semisl:threat-dept";
  const FOLDER = "threat";
  const uid = (p) => (p || "tc") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const clone = (v) => JSON.parse(JSON.stringify(v == null ? null : v));

  /* ── 데이터 ──
     DATA.threat       절차 원문 · 보고 순서 · 녹음 전화 · 보고양식 정의 (읽기 2 · 쓰기 3)
     DATA.threatRuns   [{ id, kind(real|drill), start, callEnd, end, recv{name,dept}, line, caller, rec, steps[](사본), st{key:{at,by,note}},
                          form[](양식 사본), ans{fid | fid:etc}, chain[](사본), rep{id:{at,by,note}}, us, tsoc{pos}, cmd{lead,rank,place,at,by},
                          log[], files[], result, createdBy, createdAt, updatedAt }] (읽기 2 · 쓰기 2)
     DATA.threatChecks 녹음 전화 점검 [{ id, date, by, rows{phoneId:{rec,form}}, note, createdAt }] (읽기 2 · 쓰기 2) */
  const P = () => obj(SeMIS.data[KEY]);
  const steps = () => arr(P().steps).filter(s => s && s.id);
  const chain = () => arr(P().chain).filter(c => c && c.id);
  const phones = () => arr(P().phones).filter(p => p && p.id);
  const formSecs = () => arr(obj(P().form).secs).filter(s => s && s.id);
  const runs = () => arr(SeMIS.data[RKEY]).filter(r => r && r.id);
  const checks = () => arr(SeMIS.data[CKEY]).filter(c => c && c.id);
  const activeRun = () => runs().filter(r => !r.end).sort((a, b) => String(b.start).localeCompare(String(a.start)))[0] || null;
  const hasPlan = () => !!(P().title || steps().length || chain().length);
  function ensurePlan() {
    const v = SeMIS.data[KEY];
    if (!v || typeof v !== "object" || Array.isArray(v)) SeMIS.data[KEY] = {};
    return SeMIS.data[KEY];
  }
  function ensureArr(k) {
    if (!Array.isArray(SeMIS.data[k])) SeMIS.data[k] = [];
    return SeMIS.data[k];
  }

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
  const today = () => localInput().slice(0, 10);
  function monthsSince(ymd) {
    const d = new Date(ymd + "T00:00:00");
    if (isNaN(d)) return Infinity;
    const n = new Date();
    return (n.getFullYear() - d.getFullYear()) * 12 + (n.getMonth() - d.getMonth()) - (n.getDate() < d.getDate() ? 1 : 0);
  }

  function telHref(num) {
    const s = String(num || "").split(/[,/~]/)[0].trim();
    const d = s.replace(/[^\d]/g, "");
    if (!d) return "";
    return /^\+/.test(s) ? "tel:+" + d : "tel:" + d;
  }
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

  const TABS = [["guide", "응대 가이드"], ["proc", "관리 절차"], ["phones", "녹음 전화"], ["form", "보고양식"], ["runs", "접수 기록"]];
  const RTABS = [["call", "통화 중"], ["report", "보고 · 전파"], ["log", "기록 · 첨부"]];
  let tab = "guide", runSel = "", runTab = "call";
  const drafts = {};   // 입력 중인 값 — 원격 변경으로 화면이 다시 그려져도 잃지 않게
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 사생활 보호 창 */ } }
  const recorder = () => norm(lsGet(LS_BY)) || ((SeMIS.user && SeMIS.user.name) || "");

  const canRun = () => SeMIS.roleRank() >= 2;
  const canW = () => SeMIS.canEdit();
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "");
  function repaint() { if (routeNow() === MOD) SeMIS.renderView(); }
  function navSync() { try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ } }
  function commit(msg) { SeMIS.save(); repaint(); navSync(); if (msg) toast(msg); }
  const edBtn = (attr, val, label) => canW() ? `<button type="button" class="sp-ed m-ed" ${attr}="${esc(val)}" aria-label="${esc(label)}">${icon("edit", 15)}</button>` : "";
  function paras(body) { return String(body || "").split("\n").map(norm).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join(""); }
  const kindChip = (run) => run.kind === "drill" ? ui.chip("훈련", "amber") : ui.chip("실제 상황", "red");

  /* ── 응대 기록 계산 ── */
  /* 체크 단위: 단계에 세부 항목이 있으면 세부 항목, 없으면 단계 자체 + 단계 뒤 전달 사항(after) */
  function stepUnits(list) {
    const out = [];
    arr(list).forEach(s => {
      if (!s || !s.id) return;
      const subs = arr(s.subs).filter(x => x && x.id);
      if (subs.length) subs.forEach(x => out.push({ key: s.id + ":" + x.id, step: s, sub: x }));
      else out.push({ key: s.id, step: s, sub: null });
      if (s.after && norm(s.after.ko)) out.push({ key: s.id + ":after", step: s, sub: s.after, after: true });
    });
    return out;
  }
  const callSteps = (run) => arr(run && run.steps).filter(s => s && s.phase !== "report");
  const stOf = (run) => obj(run && run.st);
  const repOf = (run) => obj(run && run.rep);
  const ansOf = (run) => obj(run && run.ans);
  const runChain = (run) => arr(run && run.chain).filter(c => c && c.id && (!c.us || run.us));
  function runStat(run, at) {
    const units = stepUnits(callSteps(run)), st = stOf(run), rep = repOf(run);
    const t = (at || Date.now()) - Date.parse(run.start);
    const cs = runChain(run);
    return {
      stepTotal: units.length, stepDone: units.filter(u => st[u.key] && st[u.key].at).length,
      repTotal: cs.length, repDone: cs.filter(c => rep[c.id] && rep[c.id].at).length,
      elapsed: run.end ? Date.parse(run.end) - Date.parse(run.start) : t
    };
  }
  const runTitle = (run) => {
    const a = ansOf(run);
    const bits = [a.place, a.flight].map(v => Array.isArray(v) ? v.join(", ") : norm(v)).filter(Boolean);
    return (run.kind === "drill" ? "훈련" : "위협전화") + (bits.length ? " — " + bits.join(" · ") : "");
  };
  const channelOf = (run) => norm(run.channel) || "전화";

  /* 답 표시 — 다중 선택은 쉼표, '기타' 는 직접 쓴 내용을 괄호로 */
  function ansText(run, f) {
    const a = ansOf(run);
    if (f.auto === "recv") return [obj(run.recv).dept, obj(run.recv).name].map(norm).filter(Boolean).join(" ");
    if (f.auto === "start") return ymdhm(run.start);
    let v = a[f.id];
    v = Array.isArray(v) ? v.slice() : (norm(v) ? [norm(v)] : []);
    const etc = norm(a[f.id + ":etc"]), i = f.other ? v.indexOf(f.other) : -1;
    if (etc && i >= 0) v[i] = f.other + " (" + etc + ")";
    return v.join(", ");
  }

  /* ── 계획 화면 ── */
  function quickBar() {
    const run = activeRun();
    if (run) {
      const st = runStat(run);
      return `<section class="sp-live tc-live${run.kind === "drill" ? " is-drill" : ""}" aria-label="응대 중">
        <div class="sp-live-l"><span class="sp-pulse" aria-hidden="true"></span>
          <div><b>${run.kind === "drill" ? "위협전화 훈련 진행 중" : "위협전화 응대 중"}</b><small>${esc(ymdhm(run.start))} 접수${obj(run.recv).name ? " · " + esc(run.recv.name) : ""}</small></div></div>
        <span class="sp-clock mono" data-tc-t0="${esc(run.start)}">T+${dur(Date.now() - Date.parse(run.start))}</span>
        <span class="sp-live-n">응대 <b class="mono">${st.stepDone}/${st.stepTotal}</b> · 보고 <b class="mono">${st.repDone}/${st.repTotal}</b></span>
        <button type="button" class="btn btn-sm sp-live-go" data-tc-open="${esc(run.id)}">응대 화면</button>
      </section>`;
    }
    const pl = P();
    const quick = arr(pl.quick).filter(q => q && q.num).slice(0, 2);
    return `<section class="sp-quick tc-quick" aria-label="위협전화 수신 시">
      <div class="sp-q-l"><b>위협전화 수신 시</b><small class="m-hide">${esc(pl.trigger || "")}</small></div>
      <div class="sp-q-acts">
        ${quick.map(q => `<a class="sp-qbtn" href="${esc(telHref(q.num))}">${icon("phone", 17)}<span><b>${esc(q.label)}</b><small class="mono">${esc(q.num)}</small></span></a>`).join("")}
        ${canRun() ? `<button type="button" class="sp-qbtn is-start" data-tc-start="real">${icon("alert", 17)}<span><b>응대 시작</b><small>실제 수신</small></span></button>
        <button type="button" class="sp-qbtn is-drill" data-tc-start="drill">${icon("clock", 17)}<span><b>훈련 시작</b><small>응대 연습</small></span></button>` : ""}
      </div></section>`;
  }

  /* ── 응대 가이드 ── */
  function stepCard(s, i) {
    const subs = arr(s.subs).filter(x => x && norm(x.ko));
    return `<li class="tc-step${s.phase === "report" ? " is-report" : ""}" data-step="${esc(s.id)}">
      <span class="tc-sn"><small>STEP</small><b class="mono">${esc(s.no || i + 1)}</b></span>
      <div class="tc-sb"><div class="tc-sh"><b>${esc(s.ko)}</b>${edBtn("data-step-edit", s.id, "STEP " + (s.no || i + 1) + " 편집")}</div>
        ${s.en ? `<small class="tc-en">${esc(s.en)}</small>` : ""}
        ${subs.length ? `<ol class="tc-subs">${subs.map(x => `<li><span>${esc(x.ko)}</span>${x.en ? `<small class="tc-en">${esc(x.en)}</small>` : ""}</li>`).join("")}</ol>` : ""}
        ${s.after && norm(s.after.ko) ? `<p class="tc-after">${icon("forward", 15)}<span>${esc(s.after.ko)}${s.after.en ? `<small class="tc-en">${esc(s.after.en)}</small>` : ""}</span></p>` : ""}
      </div></li>`;
  }
  function chainPhones(c) {
    return arr(c.phones).filter(p => p && (p.num || p.label)).map(p => `<span class="tc-cp"><small>${esc(p.label || "")}</small>${telA(p.num)}</span>`).join("");
  }
  function chainItem(c, i) {
    return `<li class="tc-ci${c.us ? " is-us" : ""}" data-chain="${esc(c.id)}">
      <span class="tc-cn mono">${i + 1}</span>
      <div class="tc-cb"><div class="tc-ch"><b>${esc(c.to)}</b>${c.us ? ui.chip("미주 행/발 편", "blue") : ""}${c.when ? `<span class="tc-when">${esc(c.when)}</span>` : ""}
          <span class="spacer"></span>${edBtn("data-chain-edit", c.id, (c.to || "") + " 편집")}</div>
        ${c.from || c.how ? `<p class="tc-how">${c.from ? `<span>${esc(c.from)}</span>` : ""}${c.how ? `<span>${esc(c.how)}</span>` : ""}</p>` : ""}
        <div class="tc-cps">${chainPhones(c)}${c.flow ? `<button type="button" class="link-btn" data-flow-open="${esc(c.flow === true ? "보안" : c.flow)}">보고 체계도</button>` : ""}</div>
        ${c.basis ? `<small class="tc-basis">${esc(c.basis)}</small>` : ""}</div></li>`;
  }
  function tsocCard() {
    const t = obj(P().tsoc);
    if (!arr(t.phones).length && !arr(t.items).length) return "";
    return `<section class="card sp-sec tc-tsoc"${ui.mf("tsoc")}><header class="sp-sh mf-h">${t.no ? `<span class="sp-no mono">${esc(t.no)}</span>` : ""}<h3>${esc(t.title || "미주 행/발 편 — TSOC 즉시 보고")}</h3><span class="spacer"></span>
        ${canW() ? `<button type="button" class="sp-ed m-ed" id="tc-tsoc-edit" aria-label="TSOC 편집">${icon("edit", 15)}</button>` : ""}</header>
      ${t.note ? `<p class="sp-hint">${esc(t.note)}</p>` : ""}
      <div class="tc-tsocp">${arr(t.phones).map(p => `<span class="tc-cp"><small>${esc(p.label || "")}</small>${telA(p.num)}</span>`).join("")}</div>
      ${arr(t.items).length ? `<ol class="tc-tsoci">${arr(t.items).map(x => `<li><span>${esc(x.ko)}</span>${x.en ? `<small class="tc-en">${esc(x.en)}</small>` : ""}</li>`).join("")}</ol>` : ""}
    </section>`;
  }
  function guideTab() {
    const pl = P(), ss = steps(), cs = chain();
    return `<div class="tc-guide">
      <section class="card sp-sec tc-flow"><header class="sp-sh"><h3>대응 및 보고 절차</h3>${pl.docRef ? `<span class="sp-mut m-hide">${esc(pl.docRef)}</span>` : ""}<span class="spacer"></span>
          ${canW() ? `<button type="button" class="btn btn-ghost btn-sm m-ed" id="tc-step-add">${icon("plus", 15)}<span>STEP</span></button>` : ""}</header>
        ${pl.trigger ? `<p class="tc-trigger">${icon("alert", 17)}<span>${esc(pl.trigger)}</span></p>` : ""}
        ${ss.length ? `<ol class="tc-steps">${ss.map(stepCard).join("")}</ol>` : ui.empty("등록된 절차가 없습니다.")}</section>
      <div class="sp-grid2 tc-g2">
        <section class="card sp-sec tc-tipc"${ui.mf("tips")}><header class="sp-sh mf-h"><h3>응대 요령</h3><span class="spacer"></span>
            ${canW() ? `<button type="button" class="sp-ed m-ed" id="tc-tips-edit" aria-label="응대 요령 편집">${icon("edit", 15)}</button>` : ""}</header>
          <ul class="tc-tips">${arr(pl.tips).map(t => `<li>${esc(t)}</li>`).join("")}</ul></section>
        ${tsocCard()}
      </div>
      <section class="card sp-sec tc-chainc"${ui.mf("chain")}><header class="sp-sh mf-h"><h3>보고 순서</h3><span class="mono sp-mut">${cs.length}</span><span class="spacer"></span>
          ${canW() ? `<button type="button" class="btn btn-ghost btn-sm m-ed" id="tc-chain-add">${icon("plus", 15)}<span>보고처</span></button>` : ""}</header>
        ${cs.length ? `<ol class="tc-chain">${cs.map(chainItem).join("")}</ol>` : ui.empty("등록된 보고처가 없습니다.")}</section>
    </div>`;
  }

  /* ── 관리 절차 ── */
  function secCard(s) {
    return `<section class="card sp-sec tc-sec" data-sec="${esc(s.id)}"${ui.mf("sec:" + s.id)}>
      <header class="sp-sh mf-h">${s.no ? `<span class="sp-no mono">${esc(s.no)}</span>` : ""}<h3>${esc(s.title || "")}</h3><span class="spacer"></span>
        ${s.link === "phones" ? `<button type="button" class="link-btn" data-ttab="phones">녹음 전화 보기</button>` : ""}
        ${edBtn("data-sec-edit", s.id, (s.title || "") + " 편집")}</header>
      <div class="sp-body">${paras(s.body)}</div></section>`;
  }
  function cmdCard() {
    const c = obj(P().cmd);
    if (!arr(c.order).length && !c.place) return "";
    return `<section class="card sp-sec tc-cmdc"${ui.mf("cmd")}><header class="sp-sh mf-h">${c.no ? `<span class="sp-no mono">${esc(c.no)}</span>` : ""}<h3>임시 통제반</h3><span class="spacer"></span>
        ${canW() ? `<button type="button" class="sp-ed m-ed" id="tc-cmd-edit" aria-label="임시 통제반 편집">${icon("edit", 15)}</button>` : ""}</header>
      <p class="sp-hint">통제반장 보임 순서</p>
      <ol class="tc-cmd">${arr(c.order).map((o, i) => `<li><span class="mono">${i + 1}</span><b>${esc(o)}</b></li>`).join("")}</ol>
      ${c.place ? `<div class="sp-kv"><span>설치 장소</span><b>${esc(c.place)}</b></div>` : ""}</section>`;
  }
  function procTab() {
    const pl = P(), secs = arr(pl.sections).filter(s => s && s.id);
    return `<div class="tc-proc">
      ${canW() ? `<div class="tc-bar m-ed"><button type="button" class="btn btn-ghost btn-sm" id="tc-meta-edit">${icon("edit", 15)}<span>기본 정보</span></button>
        <button type="button" class="btn btn-ghost btn-sm" id="tc-sec-add">${icon("plus", 15)}<span>절</span></button></div>` : ""}
      ${secs.length ? secs.map(secCard).join("") : ui.empty("등록된 절차 원문이 없습니다.")}
      ${tsocCard()}
      ${cmdCard()}
      ${canW() ? `<section class="card sp-sec tc-gaps m-ed"><header class="sp-sh"><h3>원문 확인 필요</h3><span class="mono sp-mut">${arr(pl.gaps).length}</span><span class="spacer"></span>
          <button type="button" class="sp-ed m-ed" id="tc-gaps-edit" aria-label="원문 확인 필요 편집">${icon("edit", 15)}</button></header>
        ${arr(pl.gaps).length ? `<ol class="tc-gapl">${arr(pl.gaps).map(g => `<li>${esc(g)}</li>`).join("")}</ol>` : `<p class="sp-miss">없음</p>`}</section>` : ""}
    </div>`;
  }

  /* ── 녹음 전화 ── */
  const CHK = { ok: ["정상", "green"], ng: ["이상", "red"] };
  /* 전화별 마지막 점검 결과 — 항목(녹음 작동 · 양식 비치)마다 값이 있는 가장 최근 기록 */
  function lastCheck(pid, k) {
    const cs = checks().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    for (const c of cs) { const r = obj(obj(c.rows)[pid]); if (r[k] === "ok" || r[k] === "ng") return { v: r[k], date: c.date, by: c.by }; }
    return null;
  }
  function chkCell(pid, k) {
    const c = lastCheck(pid, k), cyc = Number(P().checkCycle) || 0;
    if (!c) return `<span class="tc-ck is-none">미점검</span>`;
    const due = cyc > 0 && monthsSince(c.date) >= cyc;
    return `<span class="tc-ck is-${c.v}${due ? " is-due" : ""}" title="${esc(c.by || "")}">${esc(CHK[c.v][0])}<small class="mono">${esc(c.date.slice(2).replace(/-/g, "."))}</small></span>`;
  }
  function phonesStat() {
    const ps = phones();
    let ng = 0, none = 0;
    ps.forEach(p => {
      const r = lastCheck(p.id, "rec"), f = lastCheck(p.id, "form");
      if ((r && r.v === "ng") || (f && f.v === "ng")) ng++;
      if (!r || !f) none++;
    });
    return { total: ps.length, ng, none };
  }
  function phonesTab() {
    const pl = P(), rec = obj(pl.rec), ps = phones();
    const posts = ps.filter(p => p.grp !== "line"), lines = ps.filter(p => p.grp === "line");
    const st = phonesStat();
    const hist = checks().slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);
    return `<div class="tc-phones">
      ${ui.stats([{ label: "녹음 전화", value: st.total }, { label: "이상", value: st.ng, tone: st.ng ? "bad" : "ok" }, { label: "미점검 항목 있음", value: st.none, tone: st.none ? "warn" : "ok" },
        { label: "마지막 점검", value: hist[0] ? hist[0].date.replace(/-/g, ".") : "-" }])}
      <div class="sp-grid2 tc-g2">
        <section class="card sp-sec tc-rec"><header class="sp-sh"><h3>녹취 열람</h3><span class="spacer"></span>
            ${canW() ? `<button type="button" class="sp-ed m-ed" id="tc-rec-edit" aria-label="녹취 열람 편집">${icon("edit", 15)}</button>` : ""}</header>
          ${rec.url ? `<a class="tc-url" href="${esc(rec.url)}" target="_blank" rel="noopener">${icon("external", 15)}<span>${esc(rec.url.replace(/^https?:\/\//, ""))}</span></a>` : `<p class="sp-miss">열람 사이트 미등록</p>`}
          <dl class="sp-dl">${rec.idRule ? `<div><dt>사용자 ID</dt><dd>${esc(rec.idRule)}${rec.idEx ? `<small class="tc-ex mono">${esc(rec.idEx)}</small>` : ""}</dd></div>` : ""}
            <div><dt>비밀번호</dt><dd>암호 관리 보관${canW() ? ` <button type="button" class="link-btn" id="tc-vault">암호 관리에서 열기</button>` : ""}</dd></div>
            ${rec.who ? `<div><dt>열람</dt><dd>${esc(rec.who)}</dd></div>` : ""}</dl>
          ${rec.note ? `<p class="sp-foot">${esc(rec.note)}</p>` : ""}</section>
        <section class="card sp-sec tc-chkc"><header class="sp-sh"><h3>점검 기록</h3><span class="spacer"></span>
            ${canRun() && ps.length ? `<button type="button" class="btn btn-primary btn-sm" id="tc-chk-add">${icon("check", 15)}<span>점검 기록</span></button>` : ""}</header>
          ${hist.length ? `<ul class="tc-chks">${hist.map(c => {
            const vs = Object.keys(obj(c.rows)).map(k => obj(c.rows[k]));
            const ok = vs.reduce((n, r) => n + (r.rec === "ok") + (r.form === "ok"), 0), ng = vs.reduce((n, r) => n + (r.rec === "ng") + (r.form === "ng"), 0);
            return `<li data-chk="${esc(c.id)}"><span class="mono">${esc(c.date.replace(/-/g, "."))}</span><span>${esc(c.by || "")}</span>
              <span class="tc-chkn">정상 <b class="mono">${ok}</b>${ng ? ` · 이상 <b class="mono is-bad">${ng}</b>` : ""}</span>${c.note ? `<small>${esc(c.note)}</small>` : ""}
              ${canRun() ? `<button type="button" class="sp-ed m-ed" data-chk-edit="${esc(c.id)}" aria-label="점검 기록 수정">${icon("edit", 14)}</button>` : ""}</li>`;
          }).join("")}</ul>` : ui.empty("점검 기록이 없습니다.")}
          ${pl.checkCycle ? `<p class="sp-foot">점검 주기 ${esc(pl.checkCycle)}개월</p>` : ""}</section>
      </div>
      <section class="card sp-sec tc-postc"><header class="sp-sh"><h3>녹음 가능 자리</h3><span class="mono sp-mut">${posts.length}</span><span class="spacer"></span>
          ${canW() ? `<button type="button" class="btn btn-ghost btn-sm m-ed" id="tc-phones-edit">${icon("edit", 15)}<span>전화 목록</span></button>` : ""}</header>
        ${pl.phoneNote ? `<p class="sp-hint">${esc(pl.phoneNote)}</p>` : ""}
        ${posts.length ? `<div class="table-wrap"><table class="tbl tc-ptbl"><thead><tr><th>자리</th><th>번호</th><th>녹음 작동</th><th>양식 비치</th><th>비고</th></tr></thead>
          <tbody>${posts.map(p => `<tr data-phone="${esc(p.id)}"><td><b>${esc(p.label)}</b></td><td>${telA(p.num)}</td><td>${chkCell(p.id, "rec")}</td><td>${chkCell(p.id, "form")}</td><td>${esc(p.note || "")}</td></tr>`).join("")}</tbody></table></div>`
          : ui.empty("등록된 전화가 없습니다.")}</section>
      ${lines.length ? `<section class="card sp-sec tc-linec"${ui.mf("lines")}><header class="sp-sh mf-h"><h3>${esc(pl.lineTitle || "업무 담당 녹음 전화")}</h3><span class="mono sp-mut">${lines.length}</span></header>
        <div class="tc-lines">${lines.map(p => `<div class="tc-ln" data-phone="${esc(p.id)}">${telA(p.num)}<span class="tc-lnck">${chkCell(p.id, "rec")}${chkCell(p.id, "form")}</span>${p.note ? `<small>${esc(p.note)}</small>` : ""}</div>`).join("")}</div>
        <p class="sp-foot">녹음 작동 · 양식 비치 순</p></section>` : ""}
    </div>`;
  }

  /* ── 보고양식 ── */
  const isOpt = (f) => f.kind === "one" || f.kind === "multi" || f.kind === "yn";
  const optsOf = (f) => f.kind === "yn" ? ["예", "아니오"] : arr(f.opts);
  /* 종이 양식 모양 — 빈 양식 · 미리보기 · 결과 보고에 같이 쓴다. run 이 있으면 답을 채우고 고른 선택지에 동그라미 */
  function paperHTML(secs, run, o) {
    o = o || {};
    const a = run ? ansOf(run) : {};
    let grp = "";
    const val = (f) => run ? ansText(run, f) : "";
    const cell = (f) => {
      if (isOpt(f)) {
        const sel = run ? (Array.isArray(a[f.id]) ? a[f.id] : [a[f.id]]) : [];
        const etc = run ? norm(a[f.id + ":etc"]) : "";
        return `<div class="tcf-f is-opt${f.wide ? " is-wide" : ""}">${f.label ? `<span class="tcf-l">${esc(f.label)}</span>` : ""}<span class="tcf-os">${optsOf(f).map(x =>
          `<span class="tcf-o${sel.indexOf(x) >= 0 ? " is-on" : ""}">${esc(x)}${x === f.other && etc ? ` <em>${esc(etc)}</em>` : ""}</span>`).join("")}</span></div>`;
      }
      return `<div class="tcf-f${f.kind === "long" ? " is-long" : ""}${f.wide || f.kind === "long" ? " is-wide" : ""}"><span class="tcf-l">${esc(f.label)}${f.kind === "text" || f.auto ? ":" : ""}</span><span class="tcf-v">${esc(val(f))}</span></div>`;
    };
    return `<div class="tcf${o.compact ? " is-compact" : ""}">
      ${o.noTitle ? "" : `<div class="tcf-t">${esc(obj(P().form).title || "보고양식")}</div>`}
      ${o.noTips ? "" : `<ul class="tcf-tips">${arr(obj(P().form).tips).map(t => `<li>${esc(t)}</li>`).join("")}</ul>`}
      ${secs.map(s => {
        const g = s.group && s.group !== grp ? `<div class="tcf-g">${esc(s.group)}</div>` : "";
        grp = s.group || grp;
        return g + `<div class="tcf-s is-${esc(s.mode || "ask")}">${s.title ? `<div class="tcf-st">${esc(s.title)}</div>` : ""}<div class="tcf-b">${arr(s.fields).map(cell).join("")}</div></div>`;
      }).join("")}
      ${obj(P().form).foot ? `<div class="tcf-foot">${esc(obj(P().form).foot)}</div>` : ""}</div>`;
  }
  function formTab() {
    const pl = P(), fs = arr(pl.files).filter(f => f && f.url);
    return `<div class="tc-form">
      <div class="tc-bar"><button type="button" class="btn btn-primary btn-sm" id="tc-print-card">${icon("print", 15)}<span>비치용 A4 (가로)</span></button>
        <button type="button" class="btn btn-ghost btn-sm" id="tc-print-blank">${icon("print", 15)}<span>빈 보고양식</span></button>
        ${canW() ? `<button type="button" class="btn btn-ghost btn-sm m-ed" id="tc-form-edit">${icon("edit", 15)}<span>양식 편집</span></button>
        <button type="button" class="btn btn-ghost btn-sm m-ed" id="tc-file-up">${icon("plus", 15)}<span>원본 파일</span></button><input type="file" id="tc-file" hidden>` : ""}</div>
      ${fs.length ? `<div class="au-files tc-orig">${fs.map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "원본")}</span></a>${canW() ? `<button type="button" class="mt-btn danger m-ed" data-orig-del="${i}" aria-label="원본 삭제">${icon("x", 14)}</button>` : ""}</span>`).join("")}</div>` : ""}
      <section class="card tc-paper">${formSecs().length ? paperHTML(formSecs(), null) : ui.empty("등록된 보고양식이 없습니다.")}</section>
    </div>`;
  }

  /* ── 접수 기록 ── */
  function runsTab() {
    const list = runs().slice().sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const real = list.filter(r => r.kind !== "drill"), drill = list.filter(r => r.kind === "drill");
    return `${ui.stats([{ label: "전체", value: list.length }, { label: "실제 수신", value: real.length, tone: real.length ? "warn" : "ok" },
        { label: "훈련", value: drill.length }, { label: "최근 훈련", value: drill[0] ? ymdhm(drill[0].start).slice(0, 10) : "-" }])}
      <section class="card">${list.length ? `<div class="table-wrap"><table class="tbl tbl-cap tc-runs"><thead><tr><th>구분</th><th>접수</th><th>수단</th><th>접수자</th><th>내용</th><th>응대</th><th>보고</th><th>상태</th></tr></thead>
        <tbody>${list.map(r => { const st = runStat(r); const a = ansOf(r);
          return `<tr data-run="${esc(r.id)}" tabindex="0"><td>${kindChip(r)}</td><td class="mono">${esc(ymdhm(r.start))}</td><td>${esc(channelOf(r))}</td>
            <td>${esc([obj(r.recv).dept, obj(r.recv).name].map(norm).filter(Boolean).join(" ") || "-")}</td><td class="tc-rsum">${esc(norm(a.threat) || runTitle(r))}</td>
            <td class="mono">${st.stepDone}/${st.stepTotal}</td><td class="mono">${st.repDone}/${st.repTotal}</td>
            <td>${r.end ? ui.chip("종료", "gray") : ui.chip("진행 중", "red")}</td></tr>`; }).join("")}</tbody></table></div>`
        : ui.empty("접수 기록이 없습니다.")}</section>`;
  }

  /* ── 응대 화면 ── */
  const fieldOf = (run, id) => { for (const s of arr(run.form)) { const f = arr(s.fields).find(x => x && x.id === id); if (f) return f; } return null; };
  const fieldText = (run, id) => { const f = fieldOf(run, id); return f ? ansText(run, f) : norm(ansOf(run)[id]); };
  const recvText = (run) => [obj(run.recv).dept, obj(run.recv).name].map(norm).filter(Boolean).join(" ");
  function statusBand(run) {
    const st = runStat(run), live = !run.end;
    const bar = (lb, d, t) => `<div class="sp-pp tc-pp"><span>${esc(lb)}</span><b class="mono">${d}/${t}</b><i style="--p:${t ? Math.round(d / t * 100) : 0}%"></i></div>`;
    return `<section class="sp-status tc-status${run.kind === "drill" ? " is-drill" : ""}${live ? "" : " is-end"}">
      <div class="sp-st-a">${kindChip(run)}<b>${esc(runTitle(run))}</b><small>${esc(channelOf(run))}${recvText(run) ? " · 접수 " + esc(recvText(run)) : ""}</small></div>
      <div class="sp-st-t"><small>${live ? "경과" : "종료 · 소요"}</small>${live ? `<span class="sp-clock mono" data-tc-t0="${esc(run.start)}">T+${dur(Date.now() - Date.parse(run.start))}</span>`
        : `<span class="sp-clock mono">${esc(durText(st.elapsed))}</span>`}<small class="mono">접수 ${esc(ymdhm(run.start))}${run.callEnd ? " · 통화 종료 " + esc(hm(run.callEnd)) : ""}${run.end ? " · 종료 " + esc(hm(run.end)) : ""}</small></div>
      <div class="sp-st-p tc-st-p">${bar("응대", st.stepDone, st.stepTotal)}${bar("보고", st.repDone, st.repTotal)}</div>
      <div class="sp-st-s"><small>녹음</small>${run.rec === "예" ? "<b>녹음함</b>" : run.rec === "아니오" ? `<b class="sp-miss">녹음 못 함</b>` : `<b class="sp-miss">미확인</b>`}</div>
    </section>`;
  }
  function doneMeta(run, d) {
    return `<span class="sp-dm mono">${esc(hm(d.at))} · ${esc(tplus(run, d.at))}${d.by ? ` · <span>${esc(d.by)}</span>` : ""}</span>${d.note ? `<small class="sp-dn">${esc(d.note)}</small>` : ""}`;
  }
  /* STEP 체크 줄 — 세부 항목이 없는 단계는 단계 자체가 한 줄(번호 · 제목), 있으면 제목 아래 세부 줄, 전달 사항은 마지막 줄 */
  function stepsRail(run) {
    const st = stOf(run), live = !run.end && canRun();
    const unit = (u, label, en, badge) => {
      const d = st[u.key], ok = !!(d && d.at);
      return `<li class="tc-ru${ok ? " is-done" : ""}${u.after ? " is-after" : ""}${badge ? " is-self" : ""}" data-unit="${esc(u.key)}">
        <button type="button" class="sp-chk" data-st="${esc(u.key)}" aria-pressed="${ok}" aria-label="${esc(label)} ${ok ? "완료 기록 보기" : "완료"}"${live || ok ? "" : " disabled"}>${icon("check", 18)}</button>
        <div class="tc-rut">${badge ? `<span class="tc-rsn mono">${esc(badge)}</span>` : ""}<span class="tc-rul-t">${esc(label)}${en ? `<small class="tc-en">${esc(en)}</small>` : ""}</span>
          ${ok ? `<div class="sp-ri-m">${doneMeta(run, d)}</div>` : ""}</div></li>`;
    };
    return callSteps(run).map(s => {
      const us = stepUnits([s]), subs = us.filter(u => u.sub && !u.after), self = us.find(u => !u.sub), after = us.find(u => u.after);
      return `<div class="tc-rs">${subs.length ? `<div class="tc-rsh"><span class="tc-rsn mono">${esc(s.no || "")}</span><b>${esc(s.ko)}</b></div>` : ""}
        <ul class="tc-rul">${self ? unit(self, s.ko, "", s.no || " ") : ""}${subs.map(u => unit(u, u.sub.ko, "", "")).join("")}${after ? unit(after, after.sub.ko, "", "") : ""}</ul></div>`;
    }).join("");
  }
  const segBtns = (name, list, cur, live) => `<div class="seg tc-seg" role="group">${list.map(v =>
    `<button type="button" class="seg-btn" data-${name}="${esc(v)}" aria-pressed="${cur === v}"${live ? "" : " disabled"}>${esc(v)}</button>`).join("")}</div>`;
  function fieldInput(run, f, live) {
    const a = ansOf(run), id = "tc-a-" + f.id;
    if (f.auto) return "";
    if (isOpt(f)) {
      const sel = f.kind === "multi" ? arr(a[f.id]) : (a[f.id] ? [a[f.id]] : []);
      const eid = id + "-etc", etcOn = f.other && sel.indexOf(f.other) >= 0;
      const ev = drafts[eid] != null ? drafts[eid] : (a[f.id + ":etc"] || "");
      return `<div class="tc-fo${f.kind === "multi" ? " is-multi" : ""}" data-field="${esc(f.id)}">${f.label || f.kind === "multi" ? `<span class="tc-flb">${esc(f.label)}${f.kind === "multi" ? ` <small>여럿 고름</small>` : ""}</span>` : ""}
        <div class="tc-opts">${optsOf(f).map(x => `<button type="button" class="tc-opt" data-opt="${esc(f.id)}" data-v="${esc(x)}" aria-pressed="${sel.indexOf(x) >= 0}"${live ? "" : " disabled"}>${esc(x)}</button>`).join("")}</div>
        ${etcOn ? `<input id="${esc(eid)}" data-ans="${esc(f.id)}:etc" value="${esc(ev)}" placeholder="${esc(f.other)} — 내용" autocomplete="off"${live ? "" : " readonly"}>` : ""}</div>`;
    }
    const v = drafts[id] != null ? drafts[id] : (a[f.id] || "");
    return `<label class="tc-fl${f.kind === "long" ? " is-long" : ""}" for="${esc(id)}"><span class="tc-flb">${esc(f.label)}</span>
      ${f.kind === "long" ? `<textarea id="${esc(id)}" data-ans="${esc(f.id)}" rows="3"${live ? "" : " readonly"}>${esc(v)}</textarea>`
        : `<input id="${esc(id)}" data-ans="${esc(f.id)}" value="${esc(v)}" autocomplete="off"${live ? "" : " readonly"}>`}</label>`;
  }
  function callTab(run) {
    const live = !run.end && canRun();
    const lineOpts = phones().map(p => `<option value="${esc(p.num)}">${esc(p.label)}</option>`).join("");
    const inp = (id, lb, v, extra) => `<label class="tc-fl" for="${id}"><span class="tc-flb">${lb}</span><input id="${id}" value="${esc(drafts[id] != null ? drafts[id] : (v || ""))}" autocomplete="off"${extra || ""}${live ? "" : " readonly"}></label>`;
    let grp = "";
    const qs = arr(run.form).filter(s => s && s.mode !== "head").map(s => {
      const fs = arr(s.fields).filter(f => f && !f.auto);
      if (!fs.length) return "";
      const g = s.group && s.group !== grp ? `<h3 class="tc-qg">${esc(s.group)}</h3>` : "";
      grp = s.group || grp;
      return g + `<section class="card tc-q is-${esc(s.mode || "ask")}" data-qsec="${esc(s.id)}">${s.title ? `<h4 class="tc-qt">${esc(s.title)}</h4>` : ""}
        <div class="tc-qf">${fs.map(f => fieldInput(run, f, live)).join("")}</div></section>`;
    }).join("");
    return `<div class="tc-callg">
      <aside class="tc-rail">
        <section class="card tc-railst">${stepsRail(run)}</section>
        ${live ? (run.callEnd ? `<p class="tc-ended">${icon("check", 15)}<span>통화 종료 <b class="mono">${esc(hm(run.callEnd))}</b></span><button type="button" class="link-btn" data-rtab="report">보고 · 전파</button></p>`
          : `<button type="button" class="btn btn-danger tc-callend" id="tc-callend">${icon("phone", 17)}<span>통화 종료 → 보고</span></button>`) : ""}
        <section class="card tc-meta">
          <div class="tc-m2">${inp("tc-caller", "발신 번호", run.caller, ' placeholder="표시 없음이면 비움"')}${inp("tc-line", "수신 번호", run.line, ' list="tc-line-dl"')}</div>
          <div class="tc-fo"><span class="tc-flb">통화 녹음</span>${segBtns("rec", ["예", "아니오"], run.rec, live)}</div>
          <div class="tc-m2">${inp("tc-recv", "접수자", obj(run.recv).name)}${inp("tc-dept", "소속", obj(run.recv).dept)}</div>
          <datalist id="tc-line-dl">${lineOpts}</datalist>
          <div class="tc-fo"><span class="tc-flb">수단</span>${segBtns("ch", ["전화", "메일", "편지", "기타"], channelOf(run), live)}</div>
        </section>
      </aside>
      <div class="tc-qs">
        ${arr(P().tips).length ? `<ul class="tc-tipbar">${arr(P().tips).map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        ${qs || ui.empty("보고양식이 없습니다.")}
      </div></div>`;
  }
  function msgText(run) {
    const pl = P(), out = [];
    out.push("접수: " + ymdhm(run.start) + (recvText(run) ? " · " + recvText(run) : ""));
    out.push("수단: " + channelOf(run) + (run.line ? " · 수신 " + run.line : "") + (run.caller ? " · 발신 " + run.caller : ""));
    out.push("녹음: " + (run.rec || "미확인"));
    arr(run.form).filter(s => s && (s.mode === "ask" || s.mode === "note")).forEach(s => arr(s.fields).forEach(f => {
      if (!f || f.auto) return;
      const v = ansText(run, f);
      if (v) out.push((f.short || f.label) + ": " + v);
    }));
    const c = obj(run.cmd);
    if (c.at) out.push("임시 통제반: " + [c.lead, c.place].map(norm).filter(Boolean).join(" · "));
    return "[테러 위협전화 접수" + (run.kind === "drill" ? " · 훈련" : "") + "] " + (pl.dept || "") + "\n" + out.map(l => "- " + l).join("\n");
  }
  function tsocVal(run, k) {
    if (k === "airline") return norm(obj(P().tsoc).airline);
    if (k === "flight") return fieldText(run, "flight");
    if (k === "route") return [fieldText(run, "dep"), fieldText(run, "arr")].filter(Boolean).join(" → ");
    if (k === "pos") return norm(drafts["tc-tsoc-pos"] != null ? drafts["tc-tsoc-pos"] : obj(run.tsoc).pos);
    if (k === "threat") return fieldText(run, "threat");
    if (k === "person") return ["org", "name", "loc", "sex", "age", "lang"].map(id => fieldText(run, id)).filter(Boolean).join(", ");
    if (k === "src") return [channelOf(run), run.line ? "수신 " + run.line : "", run.caller ? "발신 " + run.caller : "", recvText(run) ? "접수 " + recvText(run) : ""].filter(Boolean).join(" · ");
    return "";
  }
  function tsocText(run) {
    const t = obj(P().tsoc);
    return "[TSOC] " + ymdhm(run.start) + " KST\n" + arr(t.items).map((x, i) => (i + 1) + ". " + (x.en ? x.en + " (" + x.ko + ")" : x.ko) + ": " + tsocVal(run, x.key)).join("\n");
  }
  function reportTab(run) {
    const live = !run.end && canRun(), rep = repOf(run), t = obj(P().tsoc), c = obj(run.cmd), cp = obj(P().cmd);
    const allCs = arr(run.chain).filter(x => x && x.id);
    const ci = (x, i) => {
      const d = rep[x.id], ok = !!(d && d.at);
      return `<li class="tc-rci${ok ? " is-done" : ""}${x.us ? " is-us" : ""}" data-rchain="${esc(x.id)}">
        <button type="button" class="sp-chk" data-rep="${esc(x.id)}" aria-pressed="${ok}" aria-label="${esc(x.to)} ${ok ? "완료 기록 보기" : "보고 완료"}"${live || ok ? "" : " disabled"}>${icon("check", 18)}</button>
        <div class="tc-cb"><div class="tc-ch"><span class="tc-cn mono">${i + 1}</span><b>${esc(x.to)}</b>${x.us ? ui.chip("미주 편", "blue") : ""}${x.when ? `<span class="tc-when">${esc(x.when)}</span>` : ""}</div>
          ${x.from || x.how ? `<p class="tc-how">${x.from ? `<span>${esc(x.from)}</span>` : ""}${x.how ? `<span>${esc(x.how)}</span>` : ""}</p>` : ""}
          <div class="tc-cps">${chainPhones(x)}${x.flow ? `<button type="button" class="link-btn" data-flow-open="${esc(x.flow === true ? "보안" : x.flow)}">보고 체계도</button>` : ""}</div>
          ${ok ? `<div class="sp-ri-m">${doneMeta(run, d)}</div>` : ""}</div></li>`;
    };
    const shown = runChain(run);
    const posV = drafts["tc-tsoc-pos"] != null ? drafts["tc-tsoc-pos"] : (obj(run.tsoc).pos || "");
    return `<div class="tc-repg">
      <section class="card sp-sec tc-rchain"><header class="sp-sh"><h3>보고 순서</h3><span class="spacer"></span>
          ${allCs.some(x => x.us) ? `<label class="sp-chkrow tc-usbox"><input type="checkbox" id="tc-us"${run.us ? " checked" : ""}${live ? "" : " disabled"}><span>미주 행/발 편</span></label>` : ""}</header>
        ${shown.length ? `<ol class="tc-rchl">${shown.map(ci).join("")}</ol>` : ui.empty("보고처가 없습니다.")}</section>
      <div class="tc-rside">
        <section class="card sp-sec tc-msg"><header class="sp-sh"><h3>보고 문자</h3></header>
          <pre class="sp-pre" id="tc-msg-pre">${esc(msgText(run))}</pre>
          <div class="sp-nacts"><button type="button" class="btn btn-primary btn-sm" data-copy-msg>${icon("doc", 15)}<span>복사</span></button>
            <button type="button" class="btn btn-ghost btn-sm" data-share-msg>${icon("forward", 15)}<span>공유 (카카오톡 등)</span></button>
            <a class="btn btn-ghost btn-sm" id="tc-msg-sms" href="sms:?&body=${encodeURIComponent(msgText(run))}">${icon("megaphone", 15)}<span>문자</span></a></div></section>
        ${run.us && arr(t.items).length ? `<section class="card sp-sec tc-rtsoc"><header class="sp-sh"><h3>TSOC 보고</h3><span class="spacer"></span><span class="tc-cps">${arr(t.phones).map(p => `<span class="tc-cp"><small>${esc(p.label || "")}</small>${telA(p.num)}</span>`).join("")}</span></header>
          <label class="tc-fl" for="tc-tsoc-pos"><span class="tc-flb">항공기 현재 위치</span><input id="tc-tsoc-pos" value="${esc(posV)}" autocomplete="off"${live ? "" : " readonly"}></label>
          <pre class="sp-pre" id="tc-tsoc-pre">${esc(tsocText(run))}</pre>
          <div class="sp-nacts"><button type="button" class="btn btn-ghost btn-sm" data-copy-tsoc>${icon("doc", 15)}<span>복사</span></button></div></section>` : ""}
        <section class="card sp-sec tc-rcmd"><header class="sp-sh"><h3>임시 통제반</h3>${c.at ? `<span class="sp-mut mono">${esc(hm(c.at))} 구성</span>` : ""}</header>
          ${arr(cp.order).length ? `<div class="tc-ranks" role="group" aria-label="통제반장 보임 순서">${arr(cp.order).map((o, i) =>
            `<button type="button" class="tc-rank" data-cmd-rank="${i}" aria-pressed="${c.rank === i}"${live ? "" : " disabled"}><span class="mono">${i + 1}</span>${esc(o)}</button>`).join("")}</div>` : ""}
          <div class="tc-m2"><label class="tc-fl" for="tc-cmd-lead"><span class="tc-flb">통제반장</span><input id="tc-cmd-lead" value="${esc(drafts["tc-cmd-lead"] != null ? drafts["tc-cmd-lead"] : (c.lead || ""))}" autocomplete="off"${live ? "" : " readonly"}></label>
            <label class="tc-fl" for="tc-cmd-place"><span class="tc-flb">설치 장소</span><input id="tc-cmd-place" value="${esc(drafts["tc-cmd-place"] != null ? drafts["tc-cmd-place"] : (c.place || ""))}" placeholder="${esc(cp.place || "")}" autocomplete="off"${live ? "" : " readonly"}></label></div>
          ${live ? `<div class="sp-nacts"><button type="button" class="btn btn-primary btn-sm" id="tc-cmd-save">${icon("check", 15)}<span>${c.at ? "수정" : "구성 기록"}</span></button></div>` : ""}</section>
        ${live && SeMIS.hasModule && SeMIS.hasModule("serp") ? `<p class="tc-esc">${icon("alert", 15)}<span>위기상황으로 번지면</span><button type="button" class="link-btn" data-go-serp>팀위기대응계획 (SERP)</button></p>` : ""}
      </div></div>`;
  }
  function filesOf(list) { return arr(list).filter(f => f && f.url); }
  function logTab(run) {
    const live = !run.end && canRun();
    const list = arr(run.log).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const fs = filesOf(run.files);
    const res = drafts["tc-result"] != null ? drafts["tc-result"] : (run.result || "");
    return `<div class="sp-grid2 tc-g2">
      <section class="card sp-sec"><header class="sp-sh"><h3>상황 기록</h3></header>
        ${live ? `<div class="sp-logadd"><textarea id="tc-log" rows="2" placeholder="지시 · 연락 · 조치 내용을 짧게">${esc(drafts["tc-log"] || "")}</textarea>
          <button type="button" class="btn btn-primary" id="tc-log-add">${icon("plus", 16)}<span>기록</span></button></div>` : ""}
        ${list.length ? `<ol class="sp-log">${list.map(l => `<li><span class="sp-log-t mono">${esc(hm(l.at))}<small>${esc(tplus(run, l.at))}</small></span>
          <div><p>${esc(l.text)}</p>${l.by ? `<small>${esc(l.by)}</small>` : ""}</div>
          ${SeMIS.canDelete() ? `<button type="button" class="sp-ed" data-log-del="${esc(l.id)}" aria-label="기록 삭제">${icon("trash", 14)}</button>` : ""}</li>`).join("")}</ol>` : ui.empty("상황 기록이 없습니다.")}</section>
      <div>
        <section class="card sp-sec tc-files"><header class="sp-sh"><h3>첨부</h3><span class="sp-mut">녹취 파일 · 보고양식 사진 등</span><span class="spacer"></span>
            ${live ? `<button type="button" class="btn btn-ghost btn-sm" id="tc-up">${icon("plus", 15)}<span>파일</span></button><input type="file" id="tc-upf" multiple hidden>` : ""}</header>
          ${fs.length ? `<div class="au-files">${fs.map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>${live ? `<button type="button" class="mt-btn danger" data-fdel="${i}" aria-label="첨부 삭제">${icon("x", 14)}</button>` : ""}</span>`).join("")}</div>`
            : `<p class="sp-miss">첨부 없음</p>`}</section>
        <section class="card sp-sec"><header class="sp-sh"><h3>처리 결과 · 상황 종료</h3></header>
          <textarea id="tc-result" rows="4" placeholder="수색 · 조치 결과, 상황 종료 시각과 판단"${live || (run.end && canW()) ? "" : " readonly"}>${esc(res)}</textarea></section>
      </div></div>`;
  }
  /* A4 결과 보고 (인쇄 전용) */
  function reportHTML(run) {
    const st = runStat(run), sts = stOf(run), rep = repOf(run), c = obj(run.cmd);
    const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const dm = (d) => d && d.at ? esc(hm(d.at)) + " · " + esc(tplus(run, d.at)) : "-";
    return `<h2>${run.kind === "drill" ? "테러 위협전화 대응 훈련 결과" : "테러 위협전화 접수 보고"}</h2>
      <table class="sp-rpt"><tbody>${row("구분", run.kind === "drill" ? "훈련" : "실제 수신")}${row("접수 일시", esc(ymdhm(run.start)))}
        ${row("접수자", esc(recvText(run) || "-"))}${row("수단 · 번호", esc(channelOf(run) + (run.line ? " · 수신 " + run.line : "") + (run.caller ? " · 발신 " + run.caller : "")))}
        ${row("통화 녹음", esc(run.rec || "미확인"))}${row("통화 종료", run.callEnd ? esc(ymdhm(run.callEnd)) : "-")}
        ${row("응대 종료", run.end ? esc(ymdhm(run.end)) + " (소요 " + esc(durText(st.elapsed)) + ")" : "진행 중")}
        ${row("임시 통제반", c.at ? esc([c.lead, c.place].map(norm).filter(Boolean).join(" · ") + " · " + hm(c.at)) : "-")}</tbody></table>
      ${paperHTML(arr(run.form), run, { noTips: true })}
      <h3>응대 절차 이행</h3><table class="sp-rpt"><thead><tr><th>단계</th><th>내용</th><th>완료</th><th>기록자 · 비고</th></tr></thead><tbody>
        ${stepUnits(callSteps(run)).map(u => { const d = sts[u.key]; return `<tr><td>STEP ${esc(u.step.no || "")}</td><td>${esc(u.sub ? u.sub.ko : u.step.ko)}</td><td>${dm(d)}</td><td>${d ? esc([d.by, d.note].filter(Boolean).join(" · ")) : ""}</td></tr>`; }).join("")}</tbody></table>
      <h3>보고 · 전파</h3><table class="sp-rpt"><thead><tr><th>순서</th><th>보고처</th><th>방법</th><th>완료</th><th>기록자 · 비고</th></tr></thead><tbody>
        ${runChain(run).map((x, i) => { const d = rep[x.id]; return `<tr><td>${i + 1}</td><td>${esc(x.to)}</td><td>${esc(x.how || "")}</td><td>${dm(d)}</td><td>${d ? esc([d.by, d.note].filter(Boolean).join(" · ")) : ""}</td></tr>`; }).join("")}</tbody></table>
      ${run.us ? `<h3>TSOC 보고 내용</h3><pre class="tc-pre">${esc(tsocText(run))}</pre>` : ""}
      <h3>상황 기록</h3><table class="sp-rpt"><tbody>${arr(run.log).slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).map(l => `<tr><td class="mono">${esc(hm(l.at))} · ${esc(tplus(run, l.at))}</td><td>${esc(l.text)}</td><td>${esc(l.by || "")}</td></tr>`).join("") || "<tr><td>-</td></tr>"}</tbody></table>
      ${filesOf(run.files).length ? `<h3>첨부</h3><ul>${filesOf(run.files).map(f => `<li>${esc(f.name || "첨부")}</li>`).join("")}</ul>` : ""}
      <h3>처리 결과</h3><p>${esc(run.result || "-")}</p>`;
  }
  function runView(run) {
    const st = runStat(run), live = !run.end;
    const quick = arr(P().quick).filter(q => q && q.num);
    const body = runTab === "report" ? reportTab(run) : runTab === "log" ? logTab(run) : callTab(run);
    return statusBand(run)
      + (live ? `<div class="sp-calls">${quick.map(q => `<a class="sp-cbtn" href="${esc(telHref(q.num))}">${icon("phone", 15)}<span>${esc(q.label)}</span></a>`).join("")}
        <label class="sp-by">${icon("user", 15)}<span>기록자</span><input id="tc-by" value="${esc(recorder())}" autocomplete="off"></label></div>` : "")
      + `<div class="eq-tabs sp-rtabs no-print" role="tablist" aria-label="응대 화면">${RTABS.map(([id, lb]) => {
        const n = id === "call" ? `${st.stepDone}/${st.stepTotal}` : id === "report" ? `${st.repDone}/${st.repTotal}` : String(arr(run.log).length + filesOf(run.files).length);
        return `<button type="button" role="tab" class="eq-tab" data-rtab="${id}" aria-selected="${runTab === id}">${esc(lb)} <span class="mono sp-tn">${n}</span></button>`;
      }).join("")}</div>
      <div class="no-print" id="tc-rbody">${body}</div>
      <div class="print-only sp-report tc-report">${reportHTML(run)}</div>`;
  }

  /* ── 렌더 ── */
  function render(root) {
    const focus = captureFocus(root);
    const run = runSel ? runs().find(r => r.id === runSel) : null;
    if (runSel && !run) runSel = "";
    const pl = P();
    if (run) {
      const acts = [
        `<button type="button" class="btn btn-ghost btn-sm" id="tc-back">${icon("chevl", 15)}<span>가이드</span></button>`,
        !run.end && canRun() ? `<button type="button" class="btn btn-danger btn-sm" id="tc-end">${icon("check", 15)}<span>응대 종료</span></button>` : "",
        run.end && canW() ? `<button type="button" class="btn btn-ghost btn-sm" id="tc-reopen">${icon("repeat", 15)}<span>다시 열기</span></button>` : "",
        SeMIS.canDelete() ? `<button type="button" class="btn btn-ghost btn-sm" id="tc-rdel">${icon("trash", 15)}<span>삭제</span></button>` : ""
      ].join("");
      root.innerHTML = ui.head({ title: run.kind === "drill" ? "위협전화 대응 훈련" : "위협전화 응대", meta: pl.docRef || "", actions: acts }) + runView(run);
    } else if (!hasPlan()) {
      const acts = canW() ? `<button type="button" class="btn btn-primary btn-sm" id="tc-meta-edit">${icon("plus", 15)}<span>기본 정보</span></button>` : "";
      root.innerHTML = ui.head({ title: TITLE, actions: acts }) + `<section class="card">${ui.empty("등록된 대응 절차가 없습니다.")}</section>`;
    } else {
      const body = tab === "proc" ? procTab() : tab === "phones" ? phonesTab() : tab === "form" ? formTab() : tab === "runs" ? runsTab() : guideTab();
      const ng = phonesStat().ng;
      root.innerHTML = ui.head({ title: pl.title || TITLE, meta: [pl.docRef, pl.asOf ? "기준 " + String(pl.asOf).replace(/-/g, ".") : ""].filter(Boolean).join(" · ") })
        + quickBar()
        + `<div class="eq-tabs sp-tabs tc-tabs no-print" role="tablist" aria-label="${esc(TITLE)}">${TABS.map(([id, lb]) =>
          `<button type="button" role="tab" class="eq-tab" data-ttab="${id}" aria-selected="${tab === id}">${esc(lb)}${id === "runs" && activeRun() ? ' <i class="sp-dot" aria-hidden="true"></i>' : ""}${id === "phones" && ng ? ` <span class="mono sp-tn">이상 ${ng}</span>` : ""}</button>`).join("")}</div>`
        + `<div class="tc-tabbody" data-tab="${esc(tab)}">${body}</div>`;
    }
    wire(root);
    restoreFocus(root, focus);
    ensureTimer();
  }

  /* 원격 변경으로 다시 그릴 때 입력 중이던 칸 · 커서를 되살린다 */
  function captureFocus(root) {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    if (!a || !a.id || !root.contains(a) || !/^tc-/.test(a.id) || !("value" in a)) return null;
    let s = null, e = null;
    try { s = a.selectionStart; e = a.selectionEnd; } catch (err) { /* 선택 불가 입력 */ }
    return { id: a.id, value: a.value, s, e };
  }
  function restoreFocus(root, f) {
    if (!f) return;
    const el = root.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(f.id) : f.id));
    if (!el) return;
    if (el.value !== f.value) el.value = f.value;
    try { el.focus(); if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (err) { /* jsdom */ }
  }

  /* 경과 시계 — 1초마다 글자만 바꾼다(화면을 다시 그리지 않음) */
  let timer = 0;
  function ensureTimer() {
    if (timer || typeof setInterval === "undefined" || typeof document === "undefined") return;
    if (!document.querySelector("[data-tc-t0]")) return;
    timer = setInterval(tick, 1000);
  }
  function tick() {
    const els = document.querySelectorAll("[data-tc-t0]");
    if (!els.length) { clearInterval(timer); timer = 0; return; }
    const now = Date.now();
    els.forEach(el => { el.textContent = "T+" + dur(now - Date.parse(el.dataset.tcT0)); });
  }

  /* ── 동작 ── */
  function wire(root) {
    $$("[data-ttab]", root).forEach(b => b.onclick = () => { tab = b.dataset.ttab; runSel = ""; SeMIS.renderView(); });
    $$("[data-rtab]", root).forEach(b => b.onclick = () => { runTab = b.dataset.rtab; SeMIS.renderView(); });
    $$("[data-tc-start]", root).forEach(b => b.onclick = () => startRun(b.dataset.tcStart));
    $$("[data-tc-open]", root).forEach(b => b.onclick = () => openRun(b.dataset.tcOpen));
    $$("tr[data-run]", root).forEach(tr => {
      tr.onclick = () => openRun(tr.dataset.run);
      tr.onkeydown = (ev) => { if (ev.key === "Enter") openRun(tr.dataset.run); };
    });
    $$("[data-flow-open]", root).forEach(b => b.onclick = () => openFlow(b.dataset.flowOpen));
    const pc = $("#tc-print-card", root);
    if (pc) pc.onclick = () => printDoc(cardHTML(), true, "비치용 대응 절차 · 보고양식");
    const pb = $("#tc-print-blank", root);
    if (pb) pb.onclick = () => printDoc(blankHTML(), false, "폭발물 위협 보고양식");
    const vb = $("#tc-vault", root);
    if (vb) vb.onclick = openVault;
    const ca = $("#tc-chk-add", root);
    if (ca) ca.onclick = () => checkForm("");
    $$("[data-chk-edit]", root).forEach(b => b.onclick = () => checkForm(b.dataset.chkEdit));
    wireRun(root);
    wireEdit(root);
  }
  function openRun(id) { runSel = id; runTab = "call"; if (routeNow() === MOD) SeMIS.renderView(); else SeMIS.navigate(MOD); }
  function openFlow(key) {
    SeMIS.navigate("contacts");
    const pick = () => {
      const C = window.SemisContacts;
      if (!C || !C.flows) return;
      const f = C.flows().find(x => String(x.short || x.title || "").indexOf(key || "보안") >= 0);
      if (!f) return;
      C.selectFlowTab(f.id);
      const el = document.getElementById("ctf-panel-" + f.id);
      if (el && el.scrollIntoView) try { el.scrollIntoView({ block: "start" }); } catch (e) { /* jsdom */ }
    };
    setTimeout(pick, 80);
  }
  function openVault() {
    const rec = obj(P().rec);
    if (window.SemisVault && SemisVault.request) {
      SemisVault.request({ title: rec.vaultTitle || "위협전화 녹취 열람", url: rec.url || "", account: rec.idRule || "", note: rec.idEx || "", category: "웹사이트" });
    }
    SeMIS.navigate("vault");
  }

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
    if (navigator.share) { navigator.share({ title: title || TITLE, text }).catch(() => {}); return; }
    copyText(text, "공유를 지원하지 않는 브라우저라 복사했습니다.");
  }

  /* 응대 시작 — 전화를 받는 중이므로 묻지 않고 바로 연다(시각 · 접수자는 화면에서 고침) */
  function startRun(kind) {
    if (!canRun()) return;
    const act = activeRun();
    if (act) { openRun(act.id); toast("진행 중인 응대가 있어 그 화면을 엽니다."); return; }
    if (!steps().length) { toast("대응 절차가 없습니다. 먼저 등록하세요.", true); return; }
    const k = kind === "drill" ? "drill" : "real", at = nowISO(), by = recorder();
    const run = {
      id: uid("tr"), kind: k, start: at, callEnd: "", end: "", channel: "전화",
      recv: { name: by, dept: norm(lsGet(LS_DEPT)) }, line: "", caller: "", rec: "",
      steps: clone(steps()), st: {}, form: clone(formSecs()), ans: {}, chain: clone(chain()), rep: {}, us: false, tsoc: { pos: "" }, cmd: {},
      log: [{ id: uid("tl"), at, by, text: k === "drill" ? "훈련 시작" : "위협전화 접수 — 응대 시작" }], files: [], result: "",
      createdBy: (SeMIS.user && SeMIS.user.name) || "", createdAt: at
    };
    ensureArr(RKEY).push(run);
    runSel = run.id; runTab = "call";
    SeMIS.save();
    if (routeNow() === MOD) SeMIS.renderView(); else SeMIS.navigate(MOD);
    navSync();
    toast(k === "drill" ? "훈련을 시작했습니다." : "응대를 시작했습니다. 통화를 길게 유지하세요.");
  }
  const curRun = () => runs().find(r => r.id === runSel) || null;
  function mutRun(fn, msg) {
    const r = curRun();
    if (!r) return;
    fn(r);
    r.updatedAt = nowISO();
    commit(msg);
  }
  /* 입력칸 값 저장 — 화면은 이미 그 값을 보이고 있으므로 다시 그리지 않는다(바로 다음 누름이 사라지지 않게) */
  function quietRun(fn) {
    const r = curRun();
    if (!r) return;
    fn(r);
    r.updatedAt = nowISO();
    SeMIS.save();
  }
  const addLog = (r, text, at) => { r.log = arr(r.log).concat([{ id: uid("tl"), at: at || nowISO(), by: recorder(), text }]); };

  function wireRun(root) {
    const on = (sel, fn) => { const b = $(sel, root); if (b) b.onclick = fn; };
    on("#tc-back", () => { runSel = ""; SeMIS.renderView(); });
    on("#tc-end", () => confirmModal("응대를 종료합니다. 종료 후에는 기록을 보거나 인쇄할 수 있습니다.", () => mutRun(r => {
      r.end = nowISO();
      if (!r.callEnd) r.callEnd = r.end;
      addLog(r, (r.kind === "drill" ? "훈련" : "응대") + " 종료", r.end);
    }, "종료했습니다.")));
    on("#tc-reopen", () => {
      if (activeRun()) { toast("진행 중인 응대가 있어 다시 열 수 없습니다.", true); return; }
      mutRun(r => { r.end = ""; }, "다시 열었습니다.");
    });
    on("#tc-rdel", () => confirmModal("이 접수 기록을 삭제합니다.", () => {
      SeMIS.data[RKEY] = runs().filter(x => x.id !== runSel);
      runSel = "";
      commit("삭제했습니다.");
    }));
    const by = $("#tc-by", root);
    if (by) by.onchange = () => lsSet(LS_BY, norm(by.value));
    $$("[data-st]", root).forEach(b => b.onclick = () => toggleDone("st", b.dataset.st));
    $$("[data-rep]", root).forEach(b => b.onclick = () => toggleDone("rep", b.dataset.rep));
    /* 접수 정보 */
    const meta = { "tc-recv": (r, v) => { r.recv = Object.assign({}, obj(r.recv), { name: v }); },
      "tc-dept": (r, v) => { r.recv = Object.assign({}, obj(r.recv), { dept: v }); lsSet(LS_DEPT, v); },
      "tc-line": (r, v) => { r.line = v ? fmtPhone(v) : ""; }, "tc-caller": (r, v) => { r.caller = v ? fmtPhone(v) : ""; } };
    Object.keys(meta).forEach(id => {
      const el = $("#" + id, root);
      if (!el) return;
      el.oninput = () => { drafts[id] = el.value; };
      el.onchange = () => { delete drafts[id]; quietRun(r => meta[id](r, norm(el.value))); };
    });
    $$("[data-ch]", root).forEach(b => b.onclick = () => mutRun(r => { r.channel = b.dataset.ch; }));
    $$("[data-rec]", root).forEach(b => b.onclick = () => mutRun(r => {
      const v = r.rec === b.dataset.rec ? "" : b.dataset.rec;
      r.rec = v;
      if (v) addLog(r, "통화 녹음 — " + v);
    }));
    /* 보고양식 답 */
    $$("[data-ans]", root).forEach(el => {
      el.oninput = () => { drafts[el.id] = el.value; };
      el.onchange = () => { delete drafts[el.id]; saveAns(el.dataset.ans, norm(el.value)); };
    });
    $$("[data-opt]", root).forEach(b => b.onclick = () => pickOpt(b.dataset.opt, b.dataset.v));
    on("#tc-callend", () => mutRun(r => { r.callEnd = nowISO(); addLog(r, "통화 종료", r.callEnd); runTab = "report"; }, "보고 · 전파를 진행하세요."));
    /* 보고 · 전파 */
    const us = $("#tc-us", root);
    if (us) us.onchange = () => mutRun(r => { r.us = us.checked; if (us.checked) addLog(r, "미주 행/발 편 — TSOC 보고 대상"); });
    const cp = $("[data-copy-msg]", root);
    if (cp) cp.onclick = () => { const r = curRun(); if (r) copyText(msgText(r), "보고 문자를 복사했습니다."); };
    const sh = $("[data-share-msg]", root);
    if (sh) sh.onclick = () => { const r = curRun(); if (r) share(msgText(r), "테러 위협전화 접수"); };
    const pos = $("#tc-tsoc-pos", root);
    if (pos) {
      pos.oninput = () => { drafts["tc-tsoc-pos"] = pos.value; const r = curRun(), pre = $("#tc-tsoc-pre"); if (r && pre) pre.textContent = tsocText(r); };
      pos.onchange = () => { delete drafts["tc-tsoc-pos"]; quietRun(r => { r.tsoc = Object.assign({}, obj(r.tsoc), { pos: norm(pos.value) }); }); };
    }
    const ct = $("[data-copy-tsoc]", root);
    if (ct) ct.onclick = () => { const r = curRun(); if (r) copyText(tsocText(r), "TSOC 보고 내용을 복사했습니다."); };
    $$("[data-cmd-rank]", root).forEach(b => b.onclick = () => {
      const i = Number(b.dataset.cmdRank);
      mutRun(r => { const c = obj(r.cmd); r.cmd = Object.assign({}, c, { rank: c.rank === i ? null : i }); });
    });
    ["tc-cmd-lead", "tc-cmd-place"].forEach(id => { const el = $("#" + id, root); if (el) el.oninput = () => { drafts[id] = el.value; }; });
    on("#tc-cmd-save", () => {
      const lead = norm(($("#tc-cmd-lead", root) || {}).value), place = norm(($("#tc-cmd-place", root) || {}).value) || norm(obj(P().cmd).place);
      if (!lead) { toast("통제반장을 입력하세요.", true); return; }
      delete drafts["tc-cmd-lead"]; delete drafts["tc-cmd-place"];
      mutRun(r => {
        const c = obj(r.cmd), first = !c.at;
        r.cmd = Object.assign({}, c, { lead, place, at: c.at || nowISO(), by: recorder() });
        addLog(r, (first ? "임시 통제반 구성 — " : "임시 통제반 변경 — ") + [lead, place].filter(Boolean).join(" · "));
      }, "기록했습니다.");
    });
    on("[data-go-serp]", () => SeMIS.navigate("serp"));
    /* 기록 · 첨부 */
    const lg = $("#tc-log", root);
    if (lg) lg.oninput = () => { drafts["tc-log"] = lg.value; };
    on("#tc-log-add", () => {
      const t = norm(lg && lg.value);
      if (!t) { toast("내용을 입력하세요.", true); return; }
      delete drafts["tc-log"];
      mutRun(r => addLog(r, t));
    });
    $$("[data-log-del]", root).forEach(b => b.onclick = () => confirmModal("이 기록을 삭제합니다.", () =>
      mutRun(r => { r.log = arr(r.log).filter(l => l.id !== b.dataset.logDel); }, "삭제했습니다.")));
    const res = $("#tc-result", root);
    if (res) {
      res.oninput = () => { drafts["tc-result"] = res.value; };
      res.onchange = () => { delete drafts["tc-result"]; quietRun(r => { r.result = String(res.value || "").trim(); }); };
    }
    const up = $("#tc-up", root), upf = $("#tc-upf", root);
    if (up && upf) {
      up.onclick = () => upf.click();
      upf.onchange = async () => {
        const list = Array.from(upf.files || []); upf.value = "";
        if (!list.length) return;
        if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
        const got = [];
        for (const f of list) {
          if (f.size > 50 * 1024 * 1024) { toast(f.name + " — 50MB 이하만 올릴 수 있습니다.", true); continue; }
          try { const u = await SemisSync.uploadFile(f, FOLDER); got.push({ name: u.name || f.name, size: u.size || f.size || 0, url: u.url }); }
          catch (e) { toast(f.name + " — 올리지 못했습니다.", true); }
        }
        if (got.length) mutRun(r => { r.files = filesOf(r.files).concat(got); addLog(r, "첨부 " + got.map(g => g.name).join(", ")); }, "첨부했습니다.");
      };
    }
    $$("[data-fdel]", root).forEach(b => b.onclick = () => confirmModal("이 첨부를 뺍니다.", () =>
      mutRun(r => { const fs = filesOf(r.files); fs.splice(Number(b.dataset.fdel), 1); r.files = fs; }, "삭제했습니다.")));
  }
  function saveAns(key, val) {
    const r = curRun();
    if (!r || r.end) return;
    const cur = ansOf(r)[key];
    if ((Array.isArray(cur) ? cur.join(",") : norm(cur)) === val) return;
    quietRun(x => {
      const a = Object.assign({}, ansOf(x));
      if (val) a[key] = val; else delete a[key];
      x.ans = a;
    });
  }
  function pickOpt(fid, v) {
    const r = curRun();
    if (!r || r.end || !canRun()) return;
    const f = fieldOf(r, fid);
    if (!f) return;
    mutRun(x => {
      const a = Object.assign({}, ansOf(x));
      if (f.kind === "multi") {
        const cur = arr(a[fid]).slice(), i = cur.indexOf(v);
        if (i >= 0) cur.splice(i, 1); else cur.push(v);
        if (cur.length) a[fid] = cur; else delete a[fid];
      } else if (a[fid] === v) delete a[fid];
      else a[fid] = v;
      x.ans = a;
    });
  }

  /* 완료 체크: 미완료 → 지금 시각으로 완료 / 완료 → 시각 · 비고 수정 또는 취소 */
  function unitLabel(r, kind, key) {
    if (kind === "rep") return (arr(r.chain).find(x => x.id === key) || {}).to || "";
    const u = stepUnits(callSteps(r)).find(x => x.key === key);
    return u ? (u.sub ? u.sub.ko : u.step.ko) : "";
  }
  function toggleDone(kind, key) {
    const r = curRun();
    if (!r || !canRun()) return;
    const map = kind === "rep" ? repOf(r) : stOf(r), d = map[key];
    if (!d || !d.at) {
      if (r.end) return;
      mutRun(x => { x[kind] = Object.assign({}, kind === "rep" ? repOf(x) : stOf(x), { [key]: { at: nowISO(), by: recorder(), note: "" } }); });
      return;
    }
    const lock = r.end && !canW();
    openModal(`<h3>완료 기록</h3><p class="sp-mtitle">${esc(unitLabel(r, kind, key))}</p>
      <div class="form-grid"><div class="form-row"><label for="tc-d-at">완료 시각</label><input id="tc-d-at" type="datetime-local" value="${esc(localInput(d.at))}"${lock ? " readonly" : ""}></div>
        <div class="form-row"><label for="tc-d-by">기록자</label><input id="tc-d-by" value="${esc(d.by || "")}" autocomplete="off"${lock ? " readonly" : ""}></div></div>
      <div class="form-row"><label for="tc-d-note">비고</label><textarea id="tc-d-note" rows="2"${lock ? " readonly" : ""}>${esc(d.note || "")}</textarea></div>
      <div class="modal-actions">${lock ? "" : '<button type="button" class="btn btn-danger" data-act="undo">완료 취소</button>'}<span class="spacer" style="flex:1"></span>
        <button type="button" class="btn btn-ghost" data-act="cancel">닫기</button>${lock ? "" : '<button type="button" class="btn btn-primary" data-act="ok">저장</button>'}</div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const set = (v) => mutRun(x => {
      const m = Object.assign({}, kind === "rep" ? repOf(x) : stOf(x));
      if (v) m[key] = v; else delete m[key];
      x[kind] = m;
    });
    const undo = $("#modal-box [data-act=undo]");
    if (undo) undo.onclick = () => { closeModal(); set(null); };
    const ok = $("#modal-box [data-act=ok]");
    if (ok) ok.onclick = () => {
      const at = fromLocal($("#tc-d-at").value), by = norm($("#tc-d-by").value), note = norm($("#tc-d-note").value);
      if (!at) { toast("시각을 입력하세요.", true); return; }
      closeModal();
      set({ at, by, note });
    };
  }

  /* ── 녹음 전화 점검 기록 ── */
  function checkForm(id) {
    if (!canRun()) return;
    const c = id ? checks().find(x => x.id === id) : null;
    const rows = Object.assign({}, obj(c && c.rows));
    const ps = phones();
    const seg = (pid, k) => {
      const v = obj(rows[pid])[k] || "";
      return `<div class="seg tc-cseg" role="group">${[["ok", "정상"], ["ng", "이상"], ["", "-"]].map(([val, lb]) =>
        `<button type="button" class="seg-btn" data-cr="${esc(pid)}" data-ck="${k}" data-v="${val}" aria-pressed="${v === val}">${lb}</button>`).join("")}</div>`;
    };
    openModal(`<h3>녹음 전화 점검 ${c ? "수정" : "기록"}</h3>
      <div class="form-grid"><div class="form-row"><label for="tc-c-date">점검일</label><input id="tc-c-date" type="date" value="${esc(c ? c.date : today())}"></div>
        <div class="form-row"><label for="tc-c-by">점검자</label><input id="tc-c-by" value="${esc(c ? c.by : recorder())}" autocomplete="off"></div></div>
      <div class="tc-call-all"><button type="button" class="btn btn-ghost btn-sm" data-all="rec">녹음 작동 모두 정상</button><button type="button" class="btn btn-ghost btn-sm" data-all="form">양식 비치 모두 정상</button></div>
      <div class="table-wrap tc-cwrap"><table class="tbl tc-ctbl"><thead><tr><th>전화</th><th>녹음 작동</th><th>양식 비치</th></tr></thead>
        <tbody>${ps.map(p => `<tr><td><b>${esc(p.label)}</b><small class="mono">${esc(p.num)}</small></td><td>${seg(p.id, "rec")}</td><td>${seg(p.id, "form")}</td></tr>`).join("")}</tbody></table></div>
      <div class="form-row"><label for="tc-c-note">비고</label><input id="tc-c-note" value="${esc(c ? c.note || "" : "")}" autocomplete="off"></div>
      <div class="modal-actions">${c && SeMIS.canDelete() ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    const setV = (pid, k, v) => {
      const r = Object.assign({}, obj(rows[pid]));
      if (v) r[k] = v; else delete r[k];
      if (Object.keys(r).length) rows[pid] = r; else delete rows[pid];
      $$(`#modal-box [data-cr="${pid}"][data-ck="${k}"]`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    };
    $$("#modal-box [data-cr]").forEach(b => b.onclick = () => setV(b.dataset.cr, b.dataset.ck, b.dataset.v));
    $$("#modal-box [data-all]").forEach(b => b.onclick = () => ps.forEach(p => setV(p.id, b.dataset.all, "ok")));
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => { closeModal(); SeMIS.data[CKEY] = checks().filter(x => x.id !== id); commit("삭제했습니다."); };
    $("#modal-box [data-act=ok]").onclick = () => {
      const date = $("#tc-c-date").value, by = norm($("#tc-c-by").value), note = norm($("#tc-c-note").value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("점검일을 입력하세요.", true); return; }
      if (!Object.keys(rows).length) { toast("점검 결과를 하나 이상 선택하세요.", true); return; }
      closeModal();
      const rec = { date, by, rows, note };
      if (c) SeMIS.data[CKEY] = checks().map(x => x.id === id ? Object.assign({}, x, rec, { updatedAt: nowISO() }) : x);
      else ensureArr(CKEY).push(Object.assign({ id: uid("tk"), createdAt: nowISO() }, rec));
      if (by) lsSet(LS_BY, by);
      commit("저장했습니다.");
    };
  }

  /* ── 인쇄 문서(숨김 iframe) — 비치용 A4 가로 · 빈 보고양식 ── */
  const PRINT_CSS = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif; color: #111; margin: 0; font-size: 9.2pt; line-height: 1.35; }
  .tcf-t { font-size: 13pt; font-weight: 800; margin: 0 0 2mm; }
  .tcf-tips { list-style: none; margin: 0 0 3mm; padding: 0; }
  .tcf-tips li::before { content: "▷ "; }
  .tcf-g { font-weight: 800; color: #1d3fa8; margin: 3mm 0 1mm; }
  .tcf-s { margin-bottom: 2.2mm; break-inside: avoid; }
  .tcf-st { font-weight: 800; margin-bottom: .8mm; }
  .tcf-b { display: flex; flex-wrap: wrap; border-top: 1px solid #333; border-left: 1px solid #333; }
  .tcf-f { flex: 1 1 32%; min-width: 0; display: flex; gap: 4px; align-items: baseline; padding: 1.2mm 1.6mm; border-right: 1px solid #333; border-bottom: 1px solid #333; min-height: 7mm; }
  .tcf-f.is-wide { flex-basis: 100%; }
  .tcf-f.is-long { flex-direction: column; min-height: 16mm; }
  .tcf-f.is-opt { flex-basis: 100%; flex-wrap: wrap; }
  .tcf-l { color: #222; white-space: nowrap; }
  .tcf-v { flex: 1; font-weight: 600; }
  .tcf-os { display: flex; flex-wrap: wrap; gap: 1mm 4mm; }
  .tcf-o { padding: 0 1.6mm; border: 1px solid transparent; border-radius: 999px; }
  .tcf-o.is-on { border-color: #111; font-weight: 700; }
  .tcf-o em { font-style: normal; font-weight: 600; }
  .tcf-foot { margin-top: 2mm; font-weight: 800; }
  .tcf-foot::before { content: "☞ "; }
  .tcf.is-compact { font-size: 6.9pt; line-height: 1.22; }
  .tcf.is-compact .tcf-t { font-size: 8.4pt; margin-bottom: .6mm; }
  .tcf.is-compact .tcf-tips { display: grid; grid-template-columns: 1fr 1fr; gap: 0 3mm; margin-bottom: 1mm; }
  .tcf.is-compact .tcf-s { margin-bottom: .8mm; }
  .tcf.is-compact .tcf-s.is-obs { display: grid; grid-template-columns: 17mm 1fr; align-items: stretch; margin-bottom: 0; }
  .tcf.is-compact .tcf-s.is-obs .tcf-st { margin: 0; padding: .4mm 1mm; border: 1px solid #333; border-right: 0; background: #f3f4f6; font-size: 6.3pt; }
  .tcf.is-compact .tcf-s.is-obs + .tcf-s.is-obs .tcf-st, .tcf.is-compact .tcf-s.is-obs + .tcf-s.is-obs .tcf-b { border-top: 0; }
  .tcf.is-compact .tcf-g { margin: 1mm 0 .5mm; }
  .tcf.is-compact .tcf-f { padding: .5mm 1mm; min-height: 4.3mm; }
  .tcf.is-compact .tcf-f.is-long { min-height: 9mm; }
  .tcf.is-compact .tcf-os { gap: .2mm 2.2mm; }
  .tcf.is-compact .tcf-foot { margin-top: 1mm; }
  .blank .tcf-f { min-height: 9mm; }
  .blank .tcf-f.is-long { min-height: 26mm; }
  .blank .tcf-f.is-opt { min-height: 0; padding: 1.8mm; }
  .cs { display: flex; flex-direction: column; }
  .cs-top { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 1mm; margin-bottom: 1.6mm; }
  .cs-title { font-size: 12pt; font-weight: 800; }
  .cs-title span { font-weight: 700; color: #333; margin-left: 2mm; }
  .cs-sub { font-size: 8pt; color: #444; }
  .cs-cols { display: grid; grid-template-columns: minmax(0, 43fr) minmax(0, 57fr); gap: 3.5mm; }
  .cs-l { display: flex; flex-direction: column; gap: .8mm; }
  .cs-trig { padding: 1.2mm 2mm; border: 1.5px solid #b42318; color: #b42318; font-weight: 800; text-align: center; font-size: 9pt; }
  .cs-step { display: grid; grid-template-columns: 13mm 1fr; gap: 2mm; padding: 1.2mm 1.8mm; border: 1px solid #888; background: #f3f4f6; break-inside: avoid; font-size: 7.8pt; line-height: 1.28; }
  .cs-no { align-self: start; background: #111; color: #fff; font-weight: 800; text-align: center; padding: .5mm 0; font-size: 7.6pt; }
  .cs-step b { font-size: 8.6pt; }
  .cs-en { display: block; color: #1d3fa8; font-weight: 700; font-size: 7pt; }
  .cs-step ol { margin: .5mm 0 0; padding-left: 4mm; }
  .cs-step li { margin-top: .4mm; }
  .cs-after { padding: .4mm 1.8mm; font-weight: 700; font-size: 7.8pt; line-height: 1.28; }
  .cs-arrow { text-align: center; line-height: .9; font-size: 7.5pt; color: #555; }
  .cs-r { border-left: 1px solid #999; padding-left: 3mm; }
  .cs-ct { margin-top: 1.6mm; border-top: 1.5px solid #111; padding-top: 1mm; break-inside: avoid; }
  .cs-ct b.h { display: block; font-size: 8.4pt; margin-bottom: .6mm; }
  .cs-cl { display: grid; grid-template-columns: repeat(3, 1fr); gap: .4mm 4mm; font-size: 7.4pt; }
  .cs-cl div::before { content: "□ "; }
  .cs-cl span { font-family: ui-monospace, Menlo, monospace; }
  .cs-foot { margin-top: 1mm; color: #b42318; font-weight: 800; font-size: 7.8pt; }
  .doc-h { border-bottom: 2px solid #111; padding-bottom: 2mm; margin-bottom: 4mm; font-size: 8.5pt; color: #444; }`;
  function docWrap(title, body, landscape) {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}
      @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: ${landscape ? "7mm 9mm" : "13mm 12mm"}; }</style></head><body>${body}</body></html>`;
  }
  function cardHTML() {
    const pl = P(), ss = steps();
    const contacts = chain().filter(c => arr(c.phones).some(p => p && p.num)).map(c => {
      const ps = arr(c.phones).filter(p => p && p.num).slice(0, 2);
      return `<div><b>${esc(c.to)}</b>${ps.map(p => ` <span>${esc(p.num)}</span>`).join(",")}</div>`;
    }).join("");
    const body = `<div class="cs">
      <div class="cs-top"><div class="cs-title">${esc(pl.cardTitle || pl.title || TITLE)}${pl.cardEn ? `<span>${esc(pl.cardEn)}</span>` : ""}</div><div class="cs-sub">${esc(pl.dept || "")}${pl.docRef ? " · " + esc(pl.docRef) : ""}</div></div>
      <div class="cs-cols"><div class="cs-l">
        ${pl.trigger ? `<div class="cs-trig">${esc(pl.trigger)}</div>` : ""}
        ${ss.map((s, i) => `${i || pl.trigger ? '<div class="cs-arrow">↓</div>' : ""}<div class="cs-step"><span class="cs-no">STEP ${esc(s.no || i + 1)}</span><div><b>${esc(s.ko)}</b>${s.en ? `<span class="cs-en">${esc(s.en)}</span>` : ""}
          ${arr(s.subs).length ? `<ol>${arr(s.subs).map(x => `<li>${esc(x.ko)}${x.en ? `<span class="cs-en">${esc(x.en)}</span>` : ""}</li>`).join("")}</ol>` : ""}</div></div>
          ${s.after && norm(s.after.ko) ? `<div class="cs-after">※ ${esc(s.after.ko)}${s.after.en ? `<span class="cs-en">${esc(s.after.en)}</span>` : ""}</div>` : ""}`).join("")}
      </div><div class="cs-r">${paperHTML(formSecs(), null, { compact: true })}</div></div>
      ${contacts ? `<div class="cs-ct"><b class="h">■ 비상연락처 Emergency contact point.</b><div class="cs-cl">${contacts}</div></div>` : ""}
      ${pl.cardFoot ? `<div class="cs-foot">${esc(pl.cardFoot)}</div>` : ""}</div>`;
    return docWrap((pl.cardTitle || TITLE), body, true);
  }
  function blankHTML() {
    const pl = P();
    return docWrap(obj(pl.form).title || "보고양식", `<div class="doc-h">${esc(pl.dept || "")}${pl.docRef ? " · " + esc(pl.docRef) : ""}</div><div class="blank">${paperHTML(formSecs(), null)}</div>`, false);
  }
  let lastPrint = "";
  function printDoc(html, landscape, label) {
    lastPrint = html;
    try {
      toast((label || "인쇄 문서") + " 준비 중…");
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
      document.body.appendChild(fr);
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fire = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } };
      if (doc.readyState === "complete") setTimeout(fire, 300); else fr.onload = () => setTimeout(fire, 300);
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) { toast("인쇄 대화상자를 열 수 없습니다.", true); }
  }

  /* ── hq 편집 ── */
  function wireEdit(root) {
    if (!canW()) return;
    const on = (sel, fn) => { const b = $(sel, root); if (b) b.onclick = fn; };
    on("#tc-meta-edit", metaForm);
    on("#tc-step-add", () => stepForm(""));
    on("#tc-chain-add", () => chainForm(""));
    on("#tc-tips-edit", () => linesForm("응대 요령", arr(P().tips), (v) => { ensurePlan().tips = v; }));
    on("#tc-gaps-edit", () => linesForm("원문 확인 필요", arr(P().gaps), (v) => { ensurePlan().gaps = v; }));
    on("#tc-tsoc-edit", tsocForm);
    on("#tc-cmd-edit", cmdForm);
    on("#tc-rec-edit", recForm);
    on("#tc-phones-edit", phonesForm);
    on("#tc-sec-add", () => secForm(""));
    on("#tc-form-edit", formEditor);
    $$("[data-step-edit]", root).forEach(b => b.onclick = () => stepForm(b.dataset.stepEdit));
    $$("[data-chain-edit]", root).forEach(b => b.onclick = () => chainForm(b.dataset.chainEdit));
    $$("[data-sec-edit]", root).forEach(b => b.onclick = () => secForm(b.dataset.secEdit));
    $$("[data-orig-del]", root).forEach(b => b.onclick = () => confirmModal("이 원본 파일을 목록에서 뺍니다.", () => {
      const fs = arr(P().files).filter(f => f && f.url); fs.splice(Number(b.dataset.origDel), 1); ensurePlan().files = fs; commit("삭제했습니다.");
    }));
    const up = $("#tc-file-up", root), file = $("#tc-file", root);
    if (up && file) {
      up.onclick = () => file.click();
      file.onchange = async () => {
        const f = file.files && file.files[0]; file.value = "";
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) { toast("20MB 이하 파일만 올릴 수 있습니다.", true); return; }
        try {
          const res = await SemisSync.uploadFile(f, FOLDER);
          const pl = ensurePlan(); pl.files = arr(pl.files).concat([{ url: res.url, name: f.name }]);
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
  const tin = (id, v, ph) => `<input id="${id}" value="${esc(v == null ? "" : v)}" autocomplete="off"${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
  const tarea = (id, v, n) => `<textarea id="${id}" rows="${n || 4}">${esc(v || "")}</textarea>`;
  /* "왼쪽 | 오른쪽" 줄 ↔ [{a, b}] */
  const pairs = (list, a, b) => arr(list).map(x => [x[a] || "", x[b] || ""].filter((v, i) => i === 0 || v).join(" | ")).join("\n");
  const unpairs = (id, a, b) => lines(id).map(l => { const [x, y] = l.split("|").map(norm); return { [a]: x || "", [b]: y || "" }; }).filter(o => o[a] || o[b]);
  function phonesOut(id) { return unpairs(id, "label", "num").map(p => ({ label: p.label, num: p.num ? fmtPhone(p.num) : "" })); }

  function linesForm(title, list, apply) {
    openModal(`<h3>${esc(title)}</h3>${row("tc-lf", "한 줄에 하나", tarea("tc-lf", arr(list).join("\n"), 8))}${actions(false)}`, { wide: true });
    bindModal(() => { apply(lines("tc-lf")); commit("저장했습니다."); });
  }
  function metaForm() {
    const pl = P();
    openModal(`<h3>기본 정보</h3>
      <div class="form-grid">${row("tc-m-title", "화면 제목", tin("tc-m-title", pl.title, TITLE))}${row("tc-m-dept", "부서", tin("tc-m-dept", pl.dept))}</div>
      <div class="form-grid">${row("tc-m-ref", "근거 문서", tin("tc-m-ref", pl.docRef))}${row("tc-m-asof", "기준일", `<input id="tc-m-asof" type="date" value="${esc(pl.asOf || "")}">`)}</div>
      ${row("tc-m-trig", "적용 상황", tin("tc-m-trig", pl.trigger))}
      ${row("tc-m-quick", "상단 바로 걸기 (이름 | 번호, 2줄까지)", tarea("tc-m-quick", pairs(pl.quick, "label", "num"), 2))}
      <div class="form-grid">${row("tc-m-cyc", "녹음 전화 점검 주기 (개월, 비우면 없음)", `<input id="tc-m-cyc" type="number" min="0" max="36" value="${esc(pl.checkCycle || "")}">`)}${row("tc-m-lt", "업무 전화 목록 제목", tin("tc-m-lt", pl.lineTitle))}</div>
      ${row("tc-m-pn", "녹음 가능 자리 설명", tin("tc-m-pn", pl.phoneNote))}
      <div class="form-grid">${row("tc-m-ct", "비치용 A4 제목", tin("tc-m-ct", pl.cardTitle))}${row("tc-m-ce", "비치용 A4 영문 제목", tin("tc-m-ce", pl.cardEn))}</div>
      ${row("tc-m-cf", "비치용 A4 아래 문구", tin("tc-m-cf", pl.cardFoot))}${actions(false)}`, { wide: true });
    bindModal(() => {
      const pl2 = ensurePlan();
      Object.assign(pl2, { title: mv("tc-m-title") || TITLE, dept: mv("tc-m-dept"), docRef: mv("tc-m-ref"), asOf: mv("tc-m-asof"), trigger: mv("tc-m-trig"),
        quick: phonesOut("tc-m-quick").slice(0, 2), checkCycle: Math.max(0, Math.min(36, Number(mv("tc-m-cyc")) || 0)) || "", lineTitle: mv("tc-m-lt"),
        phoneNote: mv("tc-m-pn"), cardTitle: mv("tc-m-ct"), cardEn: mv("tc-m-ce"), cardFoot: mv("tc-m-cf") });
      commit("저장했습니다.");
    });
  }
  function stepForm(id) {
    const s = id ? steps().find(x => x.id === id) : null;
    const v = s || { no: String(steps().length + 1), ko: "", en: "", phase: "call", subs: [], after: { ko: "", en: "" } };
    openModal(`<h3>STEP ${s ? "편집" : "추가"}</h3>
      <div class="form-grid">${row("tc-s-no", "번호", tin("tc-s-no", v.no))}<div class="form-row"><label class="sp-chkrow"><input type="checkbox" id="tc-s-rep"${v.phase === "report" ? " checked" : ""}><span>보고 단계 (응대 화면 '보고 · 전파' 탭에서 진행)</span></label></div></div>
      ${row("tc-s-ko", "내용", tin("tc-s-ko", v.ko))}${row("tc-s-en", "영문", tin("tc-s-en", v.en))}
      ${row("tc-s-subs", "세부 항목 (한국어 | English, 한 줄에 하나)", tarea("tc-s-subs", pairs(v.subs, "ko", "en"), 4))}
      <div class="form-grid">${row("tc-s-ako", "단계 뒤 전달 사항", tin("tc-s-ako", obj(v.after).ko))}${row("tc-s-aen", "전달 사항 영문", tin("tc-s-aen", obj(v.after).en))}</div>${actions(!!s)}`, { wide: true });
    bindModal(() => {
      const ko = mv("tc-s-ko");
      if (!ko) { toast("내용을 입력하세요.", true); return false; }
      const old = arr(s && s.subs);
      const subs = unpairs("tc-s-subs", "ko", "en").map((x, i) => Object.assign({ id: (old.find(o => o.ko === x.ko) || old[i] || {}).id || "u" + (i + 1) }, x));
      const seen = {}; subs.forEach((x, i) => { if (seen[x.id]) x.id = "u" + (i + 1) + uid("").slice(-3); seen[x.id] = 1; });
      const o = { no: mv("tc-s-no"), ko, en: mv("tc-s-en"), phase: $("#tc-s-rep").checked ? "report" : "call", subs, after: { ko: mv("tc-s-ako"), en: mv("tc-s-aen") } };
      const pl = ensurePlan();
      if (s) pl.steps = steps().map(x => x.id === id ? Object.assign({}, x, o) : x);
      else pl.steps = steps().concat([Object.assign({ id: uid("st") }, o)]);
      commit("저장했습니다.");
    }, () => confirmModal("이 STEP 을 삭제합니다.", () => { ensurePlan().steps = steps().filter(x => x.id !== id); closeModal(); commit("삭제했습니다."); }));
  }
  function chainForm(id) {
    const cs = chain(), c = id ? cs.find(x => x.id === id) : null;
    const v = c || { when: "", from: "", to: "", how: "", basis: "", us: false, flow: "", phones: [] };
    const pos = c ? cs.indexOf(c) : cs.length;
    openModal(`<h3>보고처 ${c ? "편집" : "추가"}</h3>
      <div class="form-grid">${row("tc-c-to", "보고처", tin("tc-c-to", v.to))}${row("tc-c-pos", "순서", `<select id="tc-c-pos">${cs.concat(c ? [] : [null]).map((x, i) => `<option value="${i}"${i === pos ? " selected" : ""}>${i + 1}</option>`).join("")}</select>`)}</div>
      <div class="form-grid">${row("tc-c-from", "누가", tin("tc-c-from", v.from))}${row("tc-c-when", "시점", tin("tc-c-when", v.when, "예: 즉시"))}</div>
      ${row("tc-c-how", "방법", tin("tc-c-how", v.how))}${row("tc-c-basis", "근거", tin("tc-c-basis", v.basis))}
      ${row("tc-c-ph", "번호 (이름 | 번호, 한 줄에 하나)", tarea("tc-c-ph", pairs(v.phones, "label", "num"), 3))}
      <label class="sp-chkrow"><input type="checkbox" id="tc-c-us"${v.us ? " checked" : ""}><span>미주 행/발 편일 때만</span></label>
      ${row("tc-c-flow", "비상연락망 보고 체계도 연결 (탭 이름 일부, 비우면 없음)", tin("tc-c-flow", v.flow === true ? "보안" : v.flow))}${actions(!!c)}`, { wide: true });
    bindModal(() => {
      const to = mv("tc-c-to");
      if (!to) { toast("보고처를 입력하세요.", true); return false; }
      const o = { to, from: mv("tc-c-from"), when: mv("tc-c-when"), how: mv("tc-c-how"), basis: mv("tc-c-basis"), phones: phonesOut("tc-c-ph"), us: $("#tc-c-us").checked, flow: mv("tc-c-flow") };
      const list = cs.filter(x => !c || x.id !== id);
      const item = c ? Object.assign({}, c, o) : Object.assign({ id: uid("ch") }, o);
      list.splice(Math.max(0, Math.min(list.length, Number($("#tc-c-pos").value) || 0)), 0, item);
      ensurePlan().chain = list;
      commit("저장했습니다.");
    }, () => confirmModal("이 보고처를 삭제합니다.", () => { ensurePlan().chain = chain().filter(x => x.id !== id); closeModal(); commit("삭제했습니다."); }));
  }
  function tsocForm() {
    const t = obj(P().tsoc);
    openModal(`<h3>미주 행/발 편 — TSOC</h3>
      <div class="form-grid">${row("tc-t-no", "절 번호", tin("tc-t-no", t.no))}${row("tc-t-title", "제목", tin("tc-t-title", t.title))}</div>
      ${row("tc-t-note", "설명", tin("tc-t-note", t.note))}${row("tc-t-air", "보고 항공사명", tin("tc-t-air", t.airline))}
      ${row("tc-t-ph", "연락처 (이름 | 번호)", tarea("tc-t-ph", pairs(t.phones, "label", "num"), 2))}
      ${row("tc-t-items", "필수 보고사항 (한국어 | English | 자동 채움: airline · flight · route · pos · threat · person · src)", tarea("tc-t-items", arr(t.items).map(x => [x.ko, x.en || "", x.key || ""].join(" | ").replace(/( \| )+$/, "")).join("\n"), 7))}${actions(false)}`, { wide: true });
    bindModal(() => {
      const items = lines("tc-t-items").map(l => { const [ko, en, key] = l.split("|").map(norm); return { ko: ko || "", en: en || "", key: key || "" }; }).filter(x => x.ko);
      ensurePlan().tsoc = Object.assign({}, t, { no: mv("tc-t-no"), title: mv("tc-t-title"), note: mv("tc-t-note"), airline: mv("tc-t-air"), phones: phonesOut("tc-t-ph"), items });
      commit("저장했습니다.");
    });
  }
  function cmdForm() {
    const c = obj(P().cmd);
    openModal(`<h3>임시 통제반</h3>${row("tc-k-no", "절 번호", tin("tc-k-no", c.no))}
      ${row("tc-k-order", "통제반장 보임 순서 (한 줄에 하나)", tarea("tc-k-order", arr(c.order).join("\n"), 5))}${row("tc-k-place", "설치 장소", tin("tc-k-place", c.place))}${actions(false)}`, { wide: true });
    bindModal(() => { ensurePlan().cmd = { no: mv("tc-k-no"), order: lines("tc-k-order"), place: mv("tc-k-place") }; commit("저장했습니다."); });
  }
  function recForm() {
    const r = obj(P().rec);
    openModal(`<h3>녹취 열람</h3>${row("tc-r-url", "열람 사이트", tin("tc-r-url", r.url, "https://"))}
      <div class="form-grid">${row("tc-r-id", "사용자 ID 규칙", tin("tc-r-id", r.idRule))}${row("tc-r-ex", "예시", tin("tc-r-ex", r.idEx))}</div>
      ${row("tc-r-who", "열람", tin("tc-r-who", r.who))}${row("tc-r-note", "비고", tin("tc-r-note", r.note))}${row("tc-r-vt", "암호 관리 항목 제목", tin("tc-r-vt", r.vaultTitle, "위협전화 녹취 열람"))}${actions(false)}`, { wide: true });
    bindModal(() => {
      const url = mv("tc-r-url");
      if (url && !/^https?:\/\//i.test(url)) { toast("주소는 https:// 로 시작해야 합니다.", true); return false; }
      ensurePlan().rec = { url, idRule: mv("tc-r-id"), idEx: mv("tc-r-ex"), who: mv("tc-r-who"), note: mv("tc-r-note"), vaultTitle: mv("tc-r-vt") };
      commit("저장했습니다.");
    });
  }
  function phonesForm() {
    const ps = phones();
    openModal(`<h3>녹음 전화 목록</h3>
      ${row("tc-p-list", "한 줄에 하나 — 자리 | 이름 | 번호 | 비고  (업무 전화는 '업무 | 이름 | 번호 | 비고')", tarea("tc-p-list", ps.map(p => [p.grp === "line" ? "업무" : "자리", p.label, p.num, p.note || ""].join(" | ").replace(/ \| $/, "")).join("\n"), 14))}${actions(false)}`, { wide: true });
    bindModal(() => {
      const used = {};
      const out = [];
      for (const l of lines("tc-p-list")) {
        const [g, label, num, note] = l.split("|").map(norm);
        if (!num) { toast("번호가 없는 줄이 있습니다: " + l, true); return false; }
        const n = fmtPhone(num), key = n.replace(/\D/g, "");
        const old = ps.find(p => !used[p.id] && String(p.num).replace(/\D/g, "") === key);
        const id = old ? old.id : uid("ph");
        used[id] = 1;
        out.push({ id, grp: g === "업무" ? "line" : "post", label: label || (g === "업무" ? "업무 전화" : ""), num: n, note: note || "" });
      }
      ensurePlan().phones = out;
      commit("저장했습니다.");
    });
  }
  function secForm(id) {
    const list = arr(P().sections).filter(s => s && s.id), s = id ? list.find(x => x.id === id) : null;
    const v = s || { no: "", title: "", body: "", link: "" };
    openModal(`<h3>절 ${s ? "편집" : "추가"}</h3><div class="form-grid">${row("tc-e-no", "번호", tin("tc-e-no", v.no))}${row("tc-e-title", "제목", tin("tc-e-title", v.title))}</div>
      ${row("tc-e-body", "본문 (한 줄 = 한 문단)", tarea("tc-e-body", v.body, 10))}
      <label class="sp-chkrow"><input type="checkbox" id="tc-e-link"${v.link === "phones" ? " checked" : ""}><span>'녹음 전화 보기' 버튼</span></label>${actions(!!s)}`, { wide: true });
    bindModal(() => {
      const title = mv("tc-e-title");
      if (!title) { toast("제목을 입력하세요.", true); return false; }
      const body = String($("#tc-e-body").value || "").split("\n").map(norm).filter(Boolean).join("\n");
      const o = { no: mv("tc-e-no"), title, body, link: $("#tc-e-link").checked ? "phones" : "" };
      ensurePlan().sections = s ? list.map(x => x.id === id ? Object.assign({}, x, o) : x) : list.concat([Object.assign({ id: uid("se") }, o)]);
      commit("저장했습니다.");
    }, () => confirmModal("이 절을 삭제합니다.", () => { ensurePlan().sections = list.filter(x => x.id !== id); closeModal(); commit("삭제했습니다."); }));
  }
  /* 보고양식 편집 — 줄 형식
     ## 섹션 제목 | 구분(head · note · ask · obs) | 묶음 제목
     항목ID | 항목 이름 | 형식(text · long · one · multi · yn · recv · start) | 선택지(쉼표) | 직접 쓰는 선택지 | 문자용 이름 */
  const KINDS = ["text", "long", "one", "multi", "yn", "recv", "start"];
  function formText() {
    const f = obj(P().form);
    const head = ["@ " + (f.title || ""), "@@ " + (f.foot || "")].concat(arr(f.tips).map(t => "> " + t));
    return head.concat(formSecs().map(s => ["## " + [s.title || "", s.mode || "ask", s.group || ""].join(" | ").replace(/( \| )+$/, "")].concat(arr(s.fields).map(x =>
      [x.id, x.label, x.auto || x.kind, arr(x.opts).join(", "), x.other || "", x.short || ""].join(" | ").replace(/( \| )+$/, ""))).join("\n"))).join("\n");
  }
  function parseForm(text, oldSecs) {
    const out = { title: "", foot: "", tips: [], secs: [] }, ids = {};
    let cur = null;
    const lns = String(text || "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
    for (let i = 0; i < lns.length; i++) {
      const l = lns[i].trim();
      if (/^@@ ?/.test(l)) { out.foot = norm(l.replace(/^@@ ?/, "")); continue; }
      if (/^@ ?/.test(l)) { out.title = norm(l.replace(/^@ ?/, "")); continue; }
      if (/^> ?/.test(l)) { out.tips.push(norm(l.replace(/^> ?/, ""))); continue; }
      if (/^## ?/.test(l)) {
        const [title, mode, group] = l.replace(/^## ?/, "").split("|").map(norm);
        const m = ["head", "note", "ask", "obs"].indexOf(mode) >= 0 ? mode : "ask";
        const old = arr(oldSecs).find(s => s.title === title && !out.secs.some(o => o.id === s.id));
        cur = { id: old ? old.id : "fs" + (out.secs.length + 1) + uid("").slice(-3), title: title || "", mode: m, group: group || "", fields: [] };
        out.secs.push(cur);
        continue;
      }
      if (!cur) return { error: (i + 1) + "번째 줄: 섹션(## 제목) 앞에 항목이 있습니다." };
      const [id, label, kind, opts, other, short] = l.split("|").map(norm);
      if (!/^[a-z][a-z0-9_-]*$/i.test(id || "")) return { error: (i + 1) + "번째 줄: 항목ID 는 영문 · 숫자로 시작해야 합니다." };
      if (ids[id]) return { error: (i + 1) + "번째 줄: 항목ID '" + id + "' 가 겹칩니다." };
      if (KINDS.indexOf(kind) < 0) return { error: (i + 1) + "번째 줄: 형식은 " + KINDS.join(" · ") + " 중 하나입니다." };
      const ol = String(opts || "").split(",").map(norm).filter(Boolean);
      if ((kind === "one" || kind === "multi") && !ol.length) return { error: (i + 1) + "번째 줄: 선택지가 없습니다." };
      ids[id] = 1;
      const f = { id, label: label || "" };
      if (kind === "recv" || kind === "start") { f.kind = "text"; f.auto = kind; } else f.kind = kind;
      if (ol.length && (kind === "one" || kind === "multi")) f.opts = ol;
      if (other && ol.indexOf(other) >= 0) f.other = other;
      if (short) f.short = short;
      cur.fields.push(f);
    }
    return out;
  }
  function formEditor() {
    openModal(`<h3>보고양식 편집</h3>
      <p class="sp-mhint">@ 제목 · @@ 맨 아래 문구 · &gt; 응대 요령 · ## 섹션 | head·note·ask·obs | 묶음 · 항목ID | 이름 | text·long·one·multi·yn·recv·start | 선택지(쉼표) | 직접 쓰는 선택지 | 문자용 이름</p>
      ${row("tc-fe", "양식 정의", `<textarea id="tc-fe" rows="22" class="mono" spellcheck="false">${esc(formText())}</textarea>`)}
      <p class="sp-mhint">진행 중 · 지난 접수 기록은 시작할 때 복사한 양식을 그대로 씁니다.</p>${actions(false)}`, { wide: true });
    bindModal(() => {
      const r = parseForm($("#tc-fe").value, formSecs());
      if (r.error) { toast(r.error, true); return false; }
      if (!r.secs.length) { toast("섹션이 없습니다.", true); return false; }
      ensurePlan().form = { title: r.title, foot: r.foot, tips: r.tips, secs: r.secs };
      commit("저장했습니다.");
    });
  }

  /* ── 대시보드 띠 · 메뉴 · 검색 · 증빙 ── */
  function dashHTML() {
    const run = activeRun();
    if (!run) return "";
    const st = runStat(run);
    return `<section class="dash-serp dash-threat${run.kind === "drill" ? " is-drill" : ""}" id="dash-threat" aria-label="위협전화 응대">
      <button type="button" class="ds-go" data-dthreat="${esc(run.id)}"><span class="sp-pulse" aria-hidden="true"></span>
        <span class="ds-t"><b>${run.kind === "drill" ? "위협전화 훈련 진행 중" : "위협전화 응대 중"}</b><small>${esc(ymdhm(run.start))} 접수${recvText(run) ? " · " + esc(recvText(run)) : ""}</small></span>
        <span class="sp-clock mono" data-tc-t0="${esc(run.start)}">T+${dur(Date.now() - Date.parse(run.start))}</span>
        <span class="ds-n">응대 <b class="mono">${st.stepDone}/${st.stepTotal}</b> · 보고 <b class="mono">${st.repDone}/${st.repTotal}</b></span>
        <span class="ds-open">응대 화면 ${icon("chevron", 15)}</span></button></section>`;
  }
  function mountDash() {
    const b = document.querySelector("#dash-threat [data-dthreat]");
    if (b) b.onclick = () => openRun(b.dataset.dthreat);
    ensureTimer();
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { return activeRun() ? "응대 중" : ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "phone", module: MOD,
    items: () => {
      const go = (t) => () => { tab = t; runSel = ""; if (routeNow() === MOD) setTimeout(() => SeMIS.renderView(), 0); };
      return phones().map(p => ({ title: p.label || p.num, sub: "녹음 전화 · " + p.num, text: [p.label, p.num, p.note], route: MOD, pick: go("phones") }))
        .concat(chain().map(c => ({ title: c.to, sub: "보고 순서" + (arr(c.phones)[0] && arr(c.phones)[0].num ? " · " + arr(c.phones)[0].num : ""), text: [c.to, c.how, c.basis].concat(arr(c.phones).map(p => p.label + " " + p.num)), route: MOD, pick: go("guide") })))
        .concat(arr(P().sections).filter(s => s && s.id).map(s => ({ title: s.title, sub: "관리 절차 " + (s.no || ""), text: [s.no, s.title, s.body], route: MOD, pick: go("proc") })));
    }
  });

  /* 수검 체크리스트 증빙 — 절차 · 보고 순서가 등록돼 있으면 충족(최근 훈련 · 점검은 설명으로) */
  window.SemisEvidence = window.SemisEvidence || {};
  window.SemisEvidence[MOD] = () => {
    const d = runs().filter(r => r.kind === "drill" && r.end).sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
    const c = checks().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const ok = steps().length > 0 && chain().length > 0;
    return { ok, text: ok ? ["대응 절차 · 보고 순서 " + chain().length + "곳", d ? "최근 훈련 " + ymdhm(d.start).slice(0, 10) : "", c ? "녹음 전화 점검 " + c.date.replace(/-/g, ".") : ""].filter(Boolean).join(" · ") : "대응 절차 미등록" };
  };

  window.SemisThreat = {
    activeRun, runStat, stepUnits, ansText, msgText, tsocText, paperHTML, cardHTML, blankHTML, parseForm, formText, lastCheck, phonesStat,
    startRun, toggleDone, checkForm, dashHTML, mountDash, tick, telHref,
    lastPrint: () => lastPrint,
    getState: () => ({ tab, runSel, runTab }),
    setState: (s) => { s = s || {}; if (s.tab) tab = s.tab; if (s.runSel != null) runSel = s.runSel; if (s.runTab) runTab = s.runTab; },
    stopTimer: () => { if (timer) { clearInterval(timer); timer = 0; } }
  };
})();
