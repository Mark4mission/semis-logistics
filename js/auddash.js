/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 점검 · 교육 대시보드 (v1.31, 라우트 aud-dash)
   레일의 '점검 · 교육' 허브를 누르면 열리는 허브 대시보드(화물보안 대시보드와 같은 방식 — app.js HUB_HOME).
   데이터는 각 모듈이 계산한 값을 그대로 쓴다(읽기만):
   - 교육 · 자격: window.SemisTraining (stats · roleStats · dueList · expiryByMonth · sessionsByMonth)
   - 수검 대응: window.SemisAudit (nextAudit · prep · phase · allFindings · overdueF · repeatCount)
   - 보안 기록부: window.SemisSeclog (templates · status · isNG)
   - 자체 보안점검: window.SemisSelfcheck (forms · allFindings · fState · openRecord) — v1.32
   메뉴가 숨겨졌거나 권한 밖인 모듈의 카드는 그리지 않는다. 색: 상태 3색(유효 · 갱신 필요 · 정지 · 미이수)과
   교육 실시 2색(당사 · 협력사) — dataviz 검증기(CVD ΔE ≥ 8) 통과값.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, ui, icon } = SeMIS;
  const MOD = "aud-dash", TITLE = "점검 · 교육 대시보드";
  const STC = { good: "#2f8f5b", warn: "#d99a0b", bad: "#c2402f" };
  const KIND = { own: "#2b59c3", vendor: "#d97706" };
  const TR = () => window.SemisTraining, AU = () => window.SemisAudit, SL = () => window.SemisSeclog, SC = () => window.SemisSelfcheck;
  const p2 = (n) => String(n).padStart(2, "0");
  let fixedToday = "";
  const todayISO = () => { if (fixedToday) return fixedToday; const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const addDays = (iso, n) => { const t = new Date(utc(iso) + n * 86400000); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const md = (s) => (isISO(s) ? s.slice(5).replace(/-/g, ".") : "");
  const mob = () => !!(SeMIS.isMobile && SeMIS.isMobile());
  const CYC = { day: "매일", week: "매주", month: "매월", quarter: "분기", year: "연 1회", event: "수시" };
  const cycLabel = (t) => t.kind === "flight" ? "편별" : t.cycle === "day" && t.days === "weekday" ? "평일" : CYC[t.cycle] || "";
  /* 그 모듈을 이 사용자가 볼 수 있는지(메뉴 숨김 · 권한) */
  function can(module) {
    const mn = SeMIS.menuForModule && SeMIS.menuForModule(module);
    return !!(mn && SeMIS.navVisible && SeMIS.navVisible(mn) && SeMIS.hasModule && SeMIS.hasModule(module));
  }

  /* ═════════ 차트 조각 ═════════ */
  /* 가로 누적 막대 — 칸 사이 2px, 값은 오른쪽 글자 */
  function sbar(label, parts, total, sub, tt) {
    const tot = total || parts.reduce((n, p) => n + p.v, 0) || 1;
    return `<div class="ad-sb"${tt ? ` data-tt="${esc(tt)}" tabindex="0"` : ""}>
      <span class="ad-sb-l">${esc(label)}</span>
      <span class="ad-sb-t">${parts.filter(p => p.v > 0).map(p => `<i style="flex:${p.v};--c:${p.c}"></i>`).join("")}</span>
      <span class="ad-sb-v mono">${esc(sub)}</span></div>`;
  }
  function colChart(cols, o) {
    o = o || {};
    const max = Math.max(1, ...cols.map(c => c.parts.reduce((n, p) => n + p.v, 0)));
    return `<div class="cc" style="--n:${cols.length};--h:${o.h || 110}px" role="img" aria-label="${esc(o.label || "")}">
      <div class="cc-plot">${cols.map(c => {
        const tot = c.parts.reduce((n, p) => n + p.v, 0);
        return `<div class="cc-col" data-tt="${esc(c.tt || (c.label + " " + tot))}" tabindex="-1">
          <span class="cc-v mono">${tot || ""}</span>
          <span class="cc-bar" style="height:${(tot / max * 100).toFixed(1)}%">${c.parts.filter(p => p.v).map(p => `<i style="flex:${p.v};--c:${p.c}"></i>`).join("")}</span></div>`;
      }).join("")}</div>
      <div class="cc-x">${cols.map(c => `<span>${esc(c.xl != null ? c.xl : c.label)}</span>`).join("")}</div>
    </div>`;
  }
  const legend = (items) => `<span class="sd-legend">${items.map(x => `<span><i style="--c:${x.c}"></i>${esc(x.name)}</span>`).join("")}</span>`;

  /* ═════════ 요약 지표 ═════════ */
  function kpiHTML(t) {
    const tiles = [];
    if (can("training") && TR()) {
      const s = TR().stats(t);
      tiles.push({ label: "자격 유효율", value: s.valid == null ? "-" : s.valid + "%", sub: "재직 " + s.people + "명 · 필수 " + s.cells + "건", tone: s.valid == null ? "muted" : s.valid === 100 ? "ok" : "warn" });
      tiles.push({ label: "갱신 · 조치 필요", value: s.act, sub: "정지 · 만료 · 미이수 " + s.bad, tone: s.bad ? "bad" : s.act ? "warn" : "ok" });
      tiles.push({ label: "SSI 서약", value: s.ssi ? (s.ssi - s.ssiMiss) + "/" + s.ssi : "-", sub: s.ssiMiss ? "누락 " + s.ssiMiss : "취급자", tone: s.ssiMiss ? "bad" : s.ssi ? "ok" : "muted" });
    }
    if (can("audit") && AU()) {
      const A = AU(), nx = A.nextAudit(t);
      const open = A.allFindings().filter(x => !x.a.cancelled && x.f.status !== "done");
      const late = open.filter(x => A.overdueF(x.f, t)).length;
      tiles.push({ label: "다음 수검", value: nx ? (A.ddayText(nx) || "-") : "-", sub: nx ? A.auditTitle(nx) : "예정 없음", tone: nx ? "muted" : "muted" });
      tiles.push({ label: "미결 지적", value: open.length, sub: late ? "기한 경과 " + late : "기한 경과 0", tone: late ? "bad" : open.length ? "warn" : "ok" });
    }
    if (can("inspection") && SL()) {
      const S = SL();
      const ts = S.templates();
      let past = 0, done = 0, miss = 0;
      ts.forEach(x => { const s = S.status(x, t); if (s.event) return; past += s.past.length; done += s.past.length - s.missing.length; miss += s.missing.length; });
      tiles.push({ label: "기록부 이행률", value: past ? Math.round(done / past * 100) + "%" : "-", sub: "누락 " + miss + "칸", tone: !past ? "muted" : miss ? "warn" : "ok" });
    }
    if (can("selfcheck") && SC()) {
      const fs = SC().allFindings(), open = fs.filter(x => SC().fState(x.fx, t) !== "done"), late = open.filter(x => SC().fState(x.fx, t) === "late").length;
      tiles.push({ label: "자체 점검 지적", value: open.length, sub: late ? "기한 경과 " + late : "R/C · 미흡 미결", tone: late ? "bad" : open.length ? "warn" : "ok" });
    }
    return tiles.length ? ui.stats(tiles) : "";
  }

  /* ═════════ 교육 · 자격 ═════════ */
  function trainCard(t) {
    const T = TR();
    const rs = T.roleStats(t);
    const due = T.dueList(90, t);
    const ex = T.expiryByMonth(12, t);
    const se = T.sessionsByMonth(12, t);
    const st = T.stats(t);
    const tot = rs.reduce((n, r) => n + r.cells, 0);
    const bars = rs.map(r => sbar(r.role, [{ v: r.good, c: STC.good }, { v: r.warn, c: STC.warn }, { v: r.bad, c: STC.bad }], r.cells,
      r.good + "/" + r.cells, `${r.role} · 인원 ${r.people} · 유효 ${r.good} · 갱신 필요 ${r.warn} · 정지 · 미이수 ${r.bad}`)).join("");
    const lim = mob() ? 5 : 8;
    const dueRows = due.slice(0, lim).map(c => {
      const S = T.ST[c.st];
      const d = isISO(c.at) ? dayDiff(t, c.at) : null;
      const dd = c.st === "none" ? "미이수" : c.st === "susp" || c.st === "lapsed" ? "정지" : d == null ? "-" : d > 0 ? "D-" + d : d === 0 ? "D-Day" : "D+" + (-d);
      return `<button type="button" class="ad-due" data-ad-person="${esc(c.p.id)}" data-st="${esc(c.st)}">
        <span class="ad-dd mono" data-lv="${S.lv}">${esc(dd)}</span>
        <span class="ad-dn"><b>${esc(c.p.name)}</b><small>${esc(String(c.g.name || "").replace(/\s*\(.*\)\s*$/, "") + (c.st === "none" ? "" : " · " + T.stText(c, true)))}</small></span>
        ${ui.chip(S.label, S.tone)}</button>`;
    }).join("");
    const exCols = ex.map(m => ({ label: m.label, xl: m.label.replace("월", ""), parts: [{ v: m.n, c: STC.warn }],
      tt: m.y + "년 " + m.label + " 유효기한 " + m.n + "건" + (m.names.length ? " · " + m.names.slice(0, 4).join(", ") + (m.names.length > 4 ? " 외" : "") : "") }));
    const seCols = se.map(m => ({ label: m.label, xl: m.label.replace("월", ""), parts: [{ v: m.own, c: KIND.own }, { v: m.vendor, c: KIND.vendor }],
      tt: m.y + "년 " + m.label + " · 당사 실시 " + m.own + "건(" + m.hours + "시간) · 협력사 확인 " + m.vendor + "건" }));
    const seTot = se.reduce((n, m) => n + m.own + m.vendor, 0), hrs = se.reduce((n, m) => n + m.hours, 0);
    return `<section class="card sd-card ad-card" aria-label="교육 · 자격">
      <h2 class="card-title">교육 · 자격<span class="dc-meta">재직 ${st.people}명</span><span class="spacer"></span><button type="button" class="link-btn" data-ad-go="training">보안교육 · 자격 관리</button></h2>
      <div class="sd-grid ad-grid2">
        <div class="sd-pane">
          <div class="sd-ph"><b>직무별 자격 상태</b>${legend([{ name: "유효", c: STC.good }, { name: "갱신 필요", c: STC.warn }, { name: "정지 · 미이수", c: STC.bad }])}</div>
          ${tot ? `<div class="ad-sbs">${bars}</div>` : ui.empty("직무가 지정된 재직 인원이 없습니다.")}
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>갱신 · 조치 필요</b><span class="dc-meta">90일 안 · ${due.length}건</span></div>
          ${due.length ? `<div class="ad-dues">${dueRows}</div>${due.length > lim ? `<button type="button" class="link-btn ad-more" data-ad-go="training" data-ad-act>전체 ${due.length}건 보기</button>` : ""}` : `<p class="ad-ok">${icon("check", 16)}<span>90일 안에 갱신할 자격이 없습니다.</span></p>`}
        </div>
      </div>
      <div class="sd-grid ad-grid2 sd-grid-b">
        <div class="sd-pane">
          <div class="sd-ph"><b>유효기한 도래</b><span class="dc-meta">앞으로 12개월 · 재직 필수 과정</span></div>
          ${colChart(exCols, { label: "월별 유효기한 도래 " + ex.map(m => m.label + " " + m.n + "건").join(", ") })}
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>교육 실시</b>${legend([{ name: "당사 실시", c: KIND.own }, { name: "협력사 확인", c: KIND.vendor }])}</div>
          ${colChart(seCols, { label: "월별 교육 실시 " + se.map(m => m.label + " 당사 " + m.own + " 협력사 " + m.vendor).join(", ") })}
          <p class="sd-foot">최근 12개월 <b class="mono">${seTot}</b>건 · 당사 교육 <b class="mono">${hrs}</b>시간</p>
        </div>
      </div>
    </section>`;
  }

  /* ═════════ 수검 대응 ═════════ */
  function auditCard(t) {
    const A = AU();
    const list = (Array.isArray(SeMIS.data.audits) ? SeMIS.data.audits : []).filter(a => a && a.id);
    const up = list.filter(a => !a.cancelled && isISO(a.start) && (isISO(a.end) && a.end >= a.start ? a.end : a.start) >= t)
      .sort((x, y) => String(x.start).localeCompare(String(y.start))).slice(0, 3);
    const fs = A.allFindings().filter(x => !x.a.cancelled);
    const open = fs.filter(x => x.f.status !== "done");
    const late = open.filter(x => A.overdueF(x.f, t)).length;
    const done = fs.length - open.length;
    const rep = open.filter(x => A.repeatCount(x.f) >= 2).length;
    const yr = t.slice(0, 4);
    const thisYear = list.filter(a => !a.cancelled && String(a.start || "").slice(0, 4) === yr).length;
    const upRows = up.map(a => {
      const pr = A.prep(a), ph = A.PH[A.phase(a, t)] || { label: "", tone: "gray" };
      return `<button type="button" class="ad-aud" data-ad-aud="${esc(a.id)}">
        <span class="ad-dd mono">${esc(A.ddayText(a) || "-")}</span>
        <span class="ad-dn"><b>${esc(A.auditTitle(a))}</b><small class="mono">${esc(dot(a.start))}${pr.total ? " · 준비 " + pr.done + "/" + pr.total : ""}</small></span>
        ${pr.total ? `<span class="ad-pg" aria-label="준비율 ${pr.pct}%"><i style="width:${pr.pct}%"></i></span><span class="mono ad-pc">${pr.pct}%</span>` : ui.chip(ph.label, ph.tone)}
      </button>`;
    }).join("");
    return `<section class="card sd-card ad-card" aria-label="수검 대응">
      <h2 class="card-title">수검 대응<span class="dc-meta">올해 ${thisYear}건</span><span class="spacer"></span><button type="button" class="link-btn" data-ad-go="audit">수검 대응 센터</button></h2>
      <div class="sd-grid ad-grid2">
        <div class="sd-pane">
          <div class="sd-ph"><b>다가오는 수검</b></div>
          ${up.length ? `<div class="ad-dues">${upRows}</div>` : `<p class="ad-ok">${icon("calendar", 16)}<span>예정된 수검이 없습니다.</span></p>`}
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>지적사항</b>${legend([{ name: "완료", c: STC.good }, { name: "조치 중", c: STC.warn }, { name: "기한 경과", c: STC.bad }])}</div>
          ${fs.length ? sbar("전체 " + fs.length + "건", [{ v: done, c: STC.good }, { v: open.length - late, c: STC.warn }, { v: late, c: STC.bad }], fs.length, done + "/" + fs.length,
            `완료 ${done} · 조치 중 ${open.length - late} · 기한 경과 ${late}`) : ""}
          <div class="ad-nums">
            <button type="button" data-ad-find="open"><b class="mono">${open.length}</b><span>미결</span></button>
            <button type="button" data-ad-find="late"${late ? ' class="bad"' : ""}><b class="mono">${late}</b><span>기한 경과</span></button>
            <span><b class="mono">${rep}</b><span>재발 조항</span></span>
          </div>
        </div>
      </div>
    </section>`;
  }

  /* ═════════ 보안 기록부 ═════════ */
  function seclogCard(t) {
    const S = SL();
    const ts = S.templates();
    const logs = (Array.isArray(SeMIS.data.seclog) ? SeMIS.data.seclog : []).filter(r => r && r.id && isISO(r.date));
    const from = addDays(t, -29);
    const ng30 = logs.filter(r => r.date >= from && r.date <= t && S.isNG(r)).length;
    const n30 = logs.filter(r => r.date >= from && r.date <= t).length;
    const rows = ts.map(x => {
      const s = S.status(x, t);
      if (s.event) return sbar(x.name, [{ v: s.count ? 1 : 0, c: STC.good }], 1,
        s.count + "건", `${x.name} · ${cycLabel(x)} · 최근 ${s.days === 365 ? "1년" : s.days + "일"} ${s.count}건${s.ng ? " · 이상 " + s.ng : ""}`);
      const n = s.past.length, k = n - s.missing.length;
      return sbar(x.name, [{ v: k, c: STC.good }, { v: s.missing.length, c: STC.bad }], n || 1, n ? k + "/" + n : (s.cur.done ? "기록" : "-"),
        `${x.name} · ${cycLabel(x)} · 지난 주기 ${n}칸 중 기록 ${k} · 누락 ${s.missing.length}${s.cur.done ? " · 이번 주기 기록" : " · 이번 주기 미기록"}`);
    }).join("");
    const pend = ts.filter(x => { const s = S.status(x, t); return !s.event && !s.cur.done; });
    return `<section class="card sd-card ad-card" aria-label="보안 기록부">
      <h2 class="card-title">보안 기록부<span class="dc-meta">최근 30일 ${n30}건 · 이상 ${ng30}건</span><span class="spacer"></span><button type="button" class="link-btn" data-ad-go="inspection">보안 기록부</button></h2>
      <div class="sd-grid ad-grid2">
        <div class="sd-pane">
          <div class="sd-ph"><b>양식별 기록 이행</b>${legend([{ name: "기록", c: STC.good }, { name: "누락", c: STC.bad }])}</div>
          ${ts.length ? `<div class="ad-sbs">${rows}</div>` : ui.empty("사용 중인 양식이 없습니다.")}
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>이번 주기 미기록</b><span class="dc-meta">${pend.length}개 양식</span></div>
          ${pend.length ? `<ul class="ad-pend">${pend.slice(0, mob() ? 5 : 10).map(x => `<li><button type="button" data-ad-go="inspection"><b>${esc(x.name)}</b><small>${esc(cycLabel(x))}</small></button></li>`).join("")}</ul>${pend.length > (mob() ? 5 : 10) ? `<p class="sd-foot">외 ${pend.length - (mob() ? 5 : 10)}개</p>` : ""}`
            : `<p class="ad-ok">${icon("check", 16)}<span>이번 주기 기록을 모두 마쳤습니다.</span></p>`}
        </div>
      </div>
    </section>`;
  }

  /* ═════════ 자체 보안점검 (v1.32) ═════════ */
  function selfcheckCard(t) {
    const S = SC();
    const y = t.slice(0, 4);
    const recs = (Array.isArray(SeMIS.data.selfChecks) ? SeMIS.data.selfChecks : []).filter(r => r && r.id && isISO(r.date) && S.formOf(r.form));
    const yr = recs.filter(r => r.date.slice(0, 4) === y);
    const rows = S.forms().map(f => {
      const rs = yr.filter(r => r.form === f.id), done = rs.filter(r => r.status === "done").length;
      const last = recs.filter(r => r.form === f.id).map(r => r.date).sort().pop();
      return sbar("별표 " + f.id.slice(1) + " " + f.title.replace(/ 점검표$/, ""), [{ v: done, c: STC.good }, { v: rs.length - done, c: STC.warn }], Math.max(1, rs.length), rs.length ? done + "/" + rs.length : "-",
        `별표 ${f.id.slice(1)} ${f.title} · ${y}년 ${rs.length}건(완료 ${done})${last ? " · 최근 " + dot(last) : ""}`);
    }).join("");
    const open = S.allFindings().filter(x => S.fState(x.fx, t) !== "done")
      .sort((a, b) => (S.fState(a.fx, t) === "late" ? 0 : 1) - (S.fState(b.fx, t) === "late" ? 0 : 1) || String(a.fx.due || "9").localeCompare(String(b.fx.due || "9")));
    const n = mob() ? 5 : 8;
    return `<section class="card sd-card ad-card" aria-label="자체 보안점검">
      <h2 class="card-title">자체 보안점검<span class="dc-meta">${y}년 ${yr.length}건 · 수준관리지침 별표</span><span class="spacer"></span><button type="button" class="link-btn" data-ad-go="selfcheck">자체 보안점검</button></h2>
      <div class="sd-grid ad-grid2">
        <div class="sd-pane">
          <div class="sd-ph"><b>양식별 ${y}년 점검</b>${legend([{ name: "완료", c: STC.good }, { name: "작성 중", c: STC.warn }])}</div>
          <div class="ad-sbs">${rows}</div>
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>미결 지적</b><span class="dc-meta">${open.length}건</span></div>
          ${open.length ? `<ul class="ad-pend">${open.slice(0, n).map(x => `<li><button type="button" data-ad-sc="${esc(x.r.id)}|${esc(x.it.id)}"><b>${esc(x.it.t || x.it.g || "장비")}</b><small>${esc("별표 " + x.f.id.slice(1) + " · " + dot(x.r.date) + (x.fx.due ? " · 기한 " + dot(x.fx.due) : ""))}${S.fState(x.fx, t) === "late" ? " · 기한 경과" : ""}</small></button></li>`).join("")}</ul>${open.length > n ? `<p class="sd-foot">외 ${open.length - n}건</p>` : ""}`
            : `<p class="ad-ok">${icon("check", 16)}<span>미결 지적이 없습니다.</span></p>`}
        </div>
      </div>
    </section>`;
  }

  /* ═════════ 말풍선 · 연결 ═════════ */
  let tt = null;
  function ttBox() {
    if (tt && document.body.contains(tt)) return tt;
    tt = document.createElement("div");
    tt.className = "sd-tt"; tt.setAttribute("role", "tooltip"); tt.hidden = true;
    document.body.appendChild(tt);
    return tt;
  }
  const hideTT = () => { if (tt) tt.hidden = true; };
  function wire(root) {
    $$("[data-tt]", root).forEach(el => {
      const on = () => {
        const b = ttBox(), r = el.getBoundingClientRect();
        b.textContent = el.dataset.tt; b.hidden = false;
        const w = b.offsetWidth || 180, h = b.offsetHeight || 40, vw = window.innerWidth || 1200;
        b.style.left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2)) + "px";
        b.style.top = Math.max(8, r.top - h - 10) + "px";
      };
      el.addEventListener("mouseenter", on); el.addEventListener("mouseleave", hideTT);
      el.addEventListener("focus", on); el.addEventListener("blur", hideTT);
    });
    $$("[data-ad-go]", root).forEach(b => b.onclick = () => {
      if (b.hasAttribute("data-ad-act") && TR()) TR().setState({ tab: "people", onlyAct: true, pid: "" });
      SeMIS.navigate(b.dataset.adGo);
    });
    $$("[data-ad-person]", root).forEach(b => b.onclick = () => { if (TR()) TR().openPerson(b.dataset.adPerson); });
    $$("[data-ad-aud]", root).forEach(b => b.onclick = () => { if (AU()) AU().open(b.dataset.adAud); });
    $$("[data-ad-find]", root).forEach(b => b.onclick = () => { if (AU()) AU().setState({ tab: "findings", sel: "", fStF: b.dataset.adFind }); SeMIS.navigate("audit"); });
    $$("[data-ad-sc]", root).forEach(b => b.onclick = () => { const [id, it] = b.dataset.adSc.split("|"); if (SC()) SC().openRecord(id, it); });
  }
  function render(root) {
    const t = todayISO();
    hideTT();
    const cards = [];
    if (can("training") && TR()) cards.push(trainCard(t));
    if (can("audit") && AU()) cards.push(auditCard(t));
    if (can("inspection") && SL()) cards.push(seclogCard(t));
    if (can("selfcheck") && SC()) cards.push(selfcheckCard(t));
    root.innerHTML = ui.head({ title: TITLE, meta: "기준 " + dot(t) }) + kpiHTML(t)
      + (cards.length ? cards.join("") : `<section class="card">${ui.empty("볼 수 있는 점검 · 교육 메뉴가 없습니다.")}</section>`);
    wire(root);
    /* SSI 서약 명단을 받아 오면(처음 한 번) 다시 그린다 */
    if (can("training") && TR() && TR().loadPledges) TR().loadPledges(false).then(ch => { if (ch && (location.hash.replace(/^#\//, "") === MOD)) SeMIS.renderView(); });
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });
  window.SemisAudDash = { render, kpiHTML, trainCard, auditCard, seclogCard, selfcheckCard, setToday(t) { fixedToday = isISO(t) ? t : ""; } };
})();
