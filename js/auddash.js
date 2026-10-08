/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 점검 · 교육 대시보드 (v1.31, 라우트 aud-dash)
   레일의 '점검 · 교육' 허브를 누르면 열리는 허브 대시보드(화물보안 대시보드와 같은 방식 — app.js HUB_HOME).
   데이터는 각 모듈이 계산한 값을 그대로 쓴다(읽기만):
   - 교육 · 자격: window.SemisTraining (stats · roleStats · dueList · expiryByMonth · sessionsByMonth)
   - 수검 대응: window.SemisAudit (nextAudit · prep · phase · allFindings · overdueF · repeatCount)
   - 보안 기록부: window.SemisSeclog (templates · status · isNG)
   - 자체 보안점검(국토부 수검대비)은 v1.42 부터 선택 실행 — 이 대시보드 · 통계 · 달력에 넣지 않는다(팀 이름만 그 설정에서 읽음)
   - 위해물품 적발 일지: window.SemisHaz (CARES 월 집계 한 줄, 보안 기록부 카드 안) — v1.36
   v1.35: 숨긴 점검(시스템관리자 '표시 관리')은 각 모듈 API 에서 이미 빠져 있고, 흐리게 한 점검은 하드카피 집계 · 기록이 통계에 들어온다
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
    return `<div class="ie-sb"${tt ? ` data-tt="${esc(tt)}" tabindex="0"` : ""}>
      <span class="ie-sb-l">${esc(label)}</span>
      <span class="ie-sb-t">${parts.filter(p => p.v > 0).map(p => `<i style="flex:${p.v};--c:${p.c}"></i>`).join("")}</span>
      <span class="ie-sb-v mono">${esc(sub)}</span></div>`;
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
      tiles.push({ label: "SSI 서약", value: s.ssi ? (s.ssi - s.ssiMiss) + "/" + s.ssi : "-", sub: s.ssiMiss ? "누락 " + s.ssiMiss : "대상", tone: s.ssiMiss ? "bad" : s.ssi ? "ok" : "muted" });
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
      return `<button type="button" class="ie-due" data-ie-person="${esc(c.p.id)}" data-st="${esc(c.st)}">
        <span class="ie-dd mono" data-lv="${S.lv}">${esc(dd)}</span>
        <span class="ie-dn"><b>${esc(c.p.name)}</b><small>${esc(String(c.g.name || "").replace(/\s*\(.*\)\s*$/, "") + (c.st === "none" ? "" : " · " + T.stText(c, true)))}</small></span>
        ${ui.chip(S.label, S.tone)}</button>`;
    }).join("");
    const exCols = ex.map(m => ({ label: m.label, xl: m.label.replace("월", ""), parts: [{ v: m.n, c: STC.warn }],
      tt: m.y + "년 " + m.label + " 유효기한 " + m.n + "건" + (m.names.length ? " · " + m.names.slice(0, 4).join(", ") + (m.names.length > 4 ? " 외" : "") : "") }));
    const seCols = se.map(m => ({ label: m.label, xl: m.label.replace("월", ""), parts: [{ v: m.own, c: KIND.own }, { v: m.vendor, c: KIND.vendor }],
      tt: m.y + "년 " + m.label + " · 당사 실시 " + m.own + "건(" + m.hours + "시간) · 협력사 확인 " + m.vendor + "건" }));
    const seTot = se.reduce((n, m) => n + m.own + m.vendor, 0), hrs = se.reduce((n, m) => n + m.hours, 0);
    return `<section class="card sd-card ie-card" aria-label="교육 · 자격">
      <h2 class="card-title">교육 · 자격<span class="dc-meta">재직 ${st.people}명</span><span class="spacer"></span>${TR().exportDue ? `<button type="button" class="link-btn ie-xls" data-ie-xls title="만료 · 만료 예정 명단(.xlsx)">${icon("down", 14)}<span>Excel</span></button>` : ""}<button type="button" class="link-btn" data-ie-go="training">보안교육 · 자격 관리</button></h2>
      <div class="sd-grid ie-grid2">
        <div class="sd-pane">
          <div class="sd-ph"><b>직무별 자격 상태</b>${legend([{ name: "유효", c: STC.good }, { name: "갱신 필요", c: STC.warn }, { name: "정지 · 미이수", c: STC.bad }])}</div>
          ${tot ? `<div class="ie-sbs">${bars}</div>` : ui.empty("직무가 지정된 재직 인원이 없습니다.")}
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>갱신 · 조치 필요</b><span class="dc-meta">90일 안 · ${due.length}건</span></div>
          ${due.length ? `<div class="ie-dues">${dueRows}</div>${due.length > lim ? `<button type="button" class="link-btn ie-more" data-ie-go="training" data-ie-act>전체 ${due.length}건 보기</button>` : ""}` : `<p class="ie-ok">${icon("check", 16)}<span>90일 안에 갱신할 자격이 없습니다.</span></p>`}
        </div>
      </div>
      <div class="sd-grid ie-grid2 sd-grid-b">
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
      return `<button type="button" class="ie-aud" data-ie-aud="${esc(a.id)}">
        <span class="ie-dd mono">${esc(A.ddayText(a) || "-")}</span>
        <span class="ie-dn"><b>${esc(A.auditTitle(a))}</b><small class="mono">${esc(dot(a.start))}${pr.total ? " · 준비 " + pr.done + "/" + pr.total : ""}</small></span>
        ${pr.total ? `<span class="ie-pg" aria-label="준비율 ${pr.pct}%"><i style="width:${pr.pct}%"></i></span><span class="mono ie-pc">${pr.pct}%</span>` : ui.chip(ph.label, ph.tone)}
      </button>`;
    }).join("");
    return `<section class="card sd-card ie-card" aria-label="수검 대응">
      <h2 class="card-title">수검 대응<span class="dc-meta">올해 ${thisYear}건</span><span class="spacer"></span><button type="button" class="link-btn" data-ie-go="audit">수검 대응 센터</button></h2>
      <div class="sd-grid ie-grid2">
        <div class="sd-pane">
          <div class="sd-ph"><b>다가오는 수검</b></div>
          ${up.length ? `<div class="ie-dues">${upRows}</div>` : `<p class="ie-ok">${icon("calendar", 16)}<span>예정된 수검이 없습니다.</span></p>`}
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>지적사항</b>${legend([{ name: "완료", c: STC.good }, { name: "조치 중", c: STC.warn }, { name: "기한 경과", c: STC.bad }])}</div>
          ${fs.length ? sbar("전체 " + fs.length + "건", [{ v: done, c: STC.good }, { v: open.length - late, c: STC.warn }, { v: late, c: STC.bad }], fs.length, done + "/" + fs.length,
            `완료 ${done} · 조치 중 ${open.length - late} · 기한 경과 ${late}`) : ""}
          <div class="ie-nums">
            <button type="button" data-ie-find="open"><b class="mono">${open.length}</b><span>미결</span></button>
            <button type="button" data-ie-find="late"${late ? ' class="bad"' : ""}><b class="mono">${late}</b><span>기한 경과</span></button>
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
    const logs = S.logs ? S.logs() : (Array.isArray(SeMIS.data.seclog) ? SeMIS.data.seclog : []).filter(r => r && r.id && isISO(r.date));   // v1.35 숨긴 양식 · 하드카피 집계 줄 제외
    const from = addDays(t, -29);
    const ng30 = logs.filter(r => r.date >= from && r.date <= t && S.isNG(r)).length + (S.hcNgIn ? S.hcNgIn(from, t) : 0);
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
    return `<section class="card sd-card ie-card" aria-label="보안 기록부">
      <h2 class="card-title">보안 기록부<span class="dc-meta">최근 30일 ${n30}건 · 이상 ${ng30}건</span><span class="spacer"></span><button type="button" class="link-btn" data-ie-go="inspection">보안 기록부</button></h2>
      <div class="sd-grid ie-grid2">
        <div class="sd-pane">
          <div class="sd-ph"><b>양식별 기록 이행</b>${legend([{ name: "기록", c: STC.good }, { name: "누락", c: STC.bad }])}</div>
          ${ts.length ? `<div class="ie-sbs">${rows}</div>` : ui.empty("사용 중인 양식이 없습니다.")}
          ${window.SemisHaz && SemisHaz.canShow() ? SemisHaz.slot("ie") : ""}
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>이번 주기 미기록</b><span class="dc-meta">${pend.length}개 양식</span></div>
          ${pend.length ? `<ul class="ie-pend">${pend.slice(0, mob() ? 5 : 10).map(x => `<li><button type="button" data-ie-go="inspection"><b>${esc(x.name)}</b><small>${esc(cycLabel(x))}</small></button></li>`).join("")}</ul>${pend.length > (mob() ? 5 : 10) ? `<p class="sd-foot">외 ${pend.length - (mob() ? 5 : 10)}개</p>` : ""}`
            : `<p class="ie-ok">${icon("check", 16)}<span>이번 주기 기록을 모두 마쳤습니다.</span></p>`}
        </div>
      </div>
    </section>`;
  }

  /* ═════════ 다가오는 점검 (v1.33 → v1.42) — ICNKF 수검(우리 팀이 받는 점검) · ICNKF 실행(우리 팀이 하는 점검) 두 구역 ═════════
     실행: 대상별 묶음 · 가까운 날짜 순 · 30일 안 강조 · 점검표 바로 가기 / 수검: 수검 대응 센터 일정 */
  const SOON = 30;
  const canW = () => !!SeMIS.user && SeMIS.roleRank() >= 2 && SeMIS.user.role !== "vendor";
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const wd = (iso) => WD[new Date(utc(iso)).getUTCDay()];
  const team = () => (SC() && SC().selfCfg ? SC().selfCfg().by : "인천화물팀");
  function ddText(due, t) {
    if (!isISO(due)) return "";
    const n = dayDiff(t, due);
    return n === 0 ? "오늘" : n > 0 ? "D-" + n : "지남 " + (-n) + "일";
  }
  const audEnd = (a) => (isISO(a.end) && a.end >= a.start ? a.end : a.start);
  const audits = () => (Array.isArray(SeMIS.data.audits) ? SeMIS.data.audits : []).filter(a => a && a.id && !a.cancelled && isISO(a.start));
  const showOwn = () => can("inspection") && !!SL();
  const showRecv = () => can("audit") && !!AU();
  function upData(t) {
    const own = [], recv = [], daily = [];
    const S = SL(), A = AU(), tm = team();
    if (can("inspection") && S) S.templates().forEach(x => {
      const n = S.nextDue(x, t);
      if (n.event) return;
      if (n.daily) { daily.push({ x, n }); return; }
      own.push({ grp: x.grp, due: n.due, own: true, name: x.name, sub: [S.whoText(x), cycLabel(x), x.vis === "dim" ? x.dimMsg : "", n.missing ? "누락 " + n.missing : ""].filter(Boolean).join(" · "),
        miss: n.missing, sl: x.id, patrol: x.kind === "patrol", dim: x.vis === "dim" });
    });
    if (can("audit") && A) audits().filter(a => audEnd(a) >= t).forEach(a => recv.push({ grp: "recv", due: a.start, end: audEnd(a), own: false, name: A.auditTitle(a),
      sub: (a.org || (A.BODIES && A.BODIES[a.body] ? A.BODIES[a.body].short : "외부")) + " → " + tm + (audEnd(a) > a.start ? " · ~" + md(audEnd(a)) : ""), aud: a.id }));
    const GL = Object.assign({}, S ? S.GRPS : {});
    const groups = {};
    own.forEach(r => { (groups[r.grp] = groups[r.grp] || { key: r.grp, label: GL[r.grp] || "기타", rows: [] }).rows.push(r); });
    const key = (d) => d || "9999-12-31";
    const gs = Object.keys(groups).map(k => groups[k]);
    gs.forEach(g => { g.rows.sort((a, b) => key(a.due).localeCompare(key(b.due)) || a.name.localeCompare(b.name)); g.first = g.rows[0].due; });
    gs.sort((a, b) => key(a.first).localeCompare(key(b.first)) || a.label.localeCompare(b.label));
    recv.sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
    const all = own.concat(recv);
    const soon = all.filter(r => isISO(r.due) && r.due <= addDays(t, SOON) && !(r.end && r.due < t)).length;
    const late = own.filter(r => isISO(r.due) && r.due < t).length;
    return { groups: gs, recv, daily, soon, late, total: all.length, own: own.length, team: tm };
  }
  function upRowHTML(r, t, w) {
    const now = !!(r.end && r.due <= t && r.end >= t);
    const n = isISO(r.due) ? dayDiff(t, r.due) : null;
    const cls = now ? " is-now" : n === null ? "" : n < 0 ? " is-late" : n <= SOON ? " is-soon" : "";
    const dd = now ? "진행 중" : n === null ? "-" : ddText(r.due, t);
    const date = !isISO(r.due) ? "" : r.due.slice(0, 4) === t.slice(0, 4) ? `${md(r.due)}(${wd(r.due)})` : `${r.due.slice(2, 4)}.${md(r.due)}`;   // 다른 해는 연도(요일 대신)
    let act = "";
    if (r.own && w) act = `<button type="button" class="btn btn-sm ${cls ? "btn-primary" : "btn-ghost"} uc-go" data-ie-sl="${esc(r.sl)}"${r.patrol ? " data-ie-round" : ""}>${icon(r.patrol && !r.dim ? "plus" : "clipboard", 15)}<span>${r.dim ? "집계" : "점검표"}</span></button>`;
    else if (r.aud) act = `<span class="uc-recv">${icon("chevron", 15)}</span>`;
    const inner = `<span class="uc-d mono">${esc(dd)}</span>
        <span class="uc-dt mono">${esc(date)}</span>
        <span class="uc-n"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span>`;
    return r.aud
      ? `<li class="uc-row is-recv${cls}"><button type="button" class="uc-main" data-ie-aud="${esc(r.aud)}">${inner}${act}</button></li>`
      : `<li class="uc-row${cls}"><div class="uc-main">${inner}</div><div class="uc-act">${act}</div></li>`;
  }
  const secHead = (cls, title, sub, meta) => `<h3 class="uc-sh ${cls}"><b>${esc(title)}</b><span>${esc(sub)}</span><span class="dc-meta">${esc(meta)}</span></h3>`;
  function upcomingCard(t) {
    const U = upData(t), w = canW(), LIM = 4;
    const lim = (rs) => `<ul class="uc-list">${rs.slice(0, LIM).join("")}</ul>${rs.length > LIM ? `<details class="uc-more"><summary>외 ${rs.length - LIM}건</summary><ul class="uc-list">${rs.slice(LIM).join("")}</ul></details>` : ""}`;
    let recvSec = "";
    if (showRecv()) {
      const rs = U.recv.map(r => upRowHTML(r, t, w));
      recvSec = `<section class="uc-sec is-recv" aria-label="ICNKF 수검">
        ${secHead("is-recv", "ICNKF 수검", "외부 점검 수검 일정", "예정 " + U.recv.length + "건")}
        ${rs.length ? lim(rs) : `<p class="uc-empty">예정된 수검이 없습니다.</p>`}
      </section>`;
    }
    let ownSec = "";
    if (showOwn()) {
      const daily = U.daily.length ? `<div class="uc-daily" aria-label="매일 점검"><span class="uc-daily-h">오늘 · 매일</span>${U.daily.map(({ x, n }) =>
        `<button type="button" class="uc-day${n.done ? " is-done" : ""}" ${w ? `data-ie-sl="${esc(x.id)}"${x.kind === "patrol" ? " data-ie-round" : ""}` : `data-ie-go="inspection"`} title="${esc(SL().whoText(x))}">${icon(n.done ? "check" : "clipboard", 14)}<span>${esc(x.name)}</span></button>`).join("")}</div>` : "";
      const groups = U.groups.map(g => {
        const nSoon = g.rows.filter(r => isISO(r.due) && r.due <= addDays(t, SOON)).length;
        return `<section class="uc-grp" data-grp="${esc(g.key)}">
          <h4 class="uc-gh"><b>${esc(g.label)}</b><span class="dc-meta">${g.rows.length}건${nSoon ? " · 30일 안 " + nSoon : ""}</span></h4>
          ${lim(g.rows.map(r => upRowHTML(r, t, w)))}
        </section>`;
      }).join("");
      ownSec = `<section class="uc-sec is-own" aria-label="ICNKF 실행">
        ${secHead("is-own", "ICNKF 실행", "보안 기록부 점검", U.own + "건" + (U.daily.length ? " · 매일 " + U.daily.length : ""))}
        ${daily}
        ${groups ? `<div class="uc-grps">${groups}</div>` : `<p class="uc-empty">예정된 점검이 없습니다.</p>`}
      </section>`;
    }
    const ed = SeMIS.canEdit() && can("inspection") && SL()
      ? `<button type="button" class="btn btn-ghost btn-sm m-ed" data-ie-cfg title="누가 · 누구를 · 주기">${icon("edit", 15)}<span>안내 편집</span></button>` : "";
    return `<section class="card sd-card ie-card ie-up" aria-label="다가오는 점검">
      <h2 class="card-title">다가오는 점검<span class="dc-meta">30일 안 ${U.soon}건${U.late ? " · 지남 " + U.late : ""}</span><span class="spacer"></span>${ed}</h2>
      <div class="uc-split${recvSec && ownSec ? " is-two" : ""}">${recvSec}${ownSec}</div>
    </section>`;
  }
  /* 안내 편집 — 보안 기록부 양식(주체 · 대상 · 주기) */
  function cfgPick() {
    if (!SeMIS.canEdit()) return;
    const opts = [];
    if (can("inspection") && SL()) opts.push(["sl", "보안 기록부 양식", "매일 · 월간 · 분기 점검 — 누가 · 누구를 · 주기 · 대상 묶음"]);
    if (opts.length === 1) { pickCfg(opts[0][0]); return; }
    SeMIS.openModal(`<h3>점검 안내 편집</h3>
      <div class="ie-pick">${opts.map(([k, a, b]) => `<button type="button" data-ie-pick="${k}"><b>${esc(a)}</b><small>${esc(b)}</small></button>`).join("")}</div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = SeMIS.closeModal;
    $$("#modal-box [data-ie-pick]").forEach(b => b.onclick = () => { const k = b.dataset.iePick; SeMIS.closeModal(); pickCfg(k); });
  }
  function pickCfg(k) { if (k === "sl" && SL()) SL().templatesForm(); }

  /* ═════════ 점검 일정 달력 (v1.34) — 이번 달 기본 · ‹ › 로 앞뒤 달 ═════════
     ICNKF 수검(수검 기간) · ICNKF 실행 기한(기록 없는 주기의 마지막 날) · 완료(기록한 날) */
  let calYM = "", calSel = "";
  const ymOf = (iso) => iso.slice(0, 7);
  const ymAdd = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1); };
  const lastDay = (ym) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)); return ym + "-" + p2(d.getUTCDate()); };
  const KORD = { recv: 0, late: 1, due: 2, done: 3 };
  const KLB = { recv: "수검", late: "지남", due: "기한", done: "완료" };
  function calRange(ym) {
    const f = ym + "-01", l = lastDay(ym);
    const from = addDays(f, -new Date(utc(f)).getUTCDay()), to = addDays(l, 6 - new Date(utc(l)).getUTCDay());
    return { from, to, first: f, last: l };
  }
  function calData(ym, t) {
    const R = calRange(ym), ev = [];
    const S = SL(), A = AU();
    if (can("audit") && A) audits().forEach(a => {
      const e = audEnd(a);
      if (e < R.from || a.start > R.to) return;
      for (let d = a.start > R.from ? a.start : R.from, g = 0; d <= e && d <= R.to && g < 62; d = addDays(d, 1), g++)
        ev.push({ d, kind: "recv", name: A.auditTitle(a), sub: (a.org || "외부") + " → " + team() + (e > a.start ? " · " + md(a.start) + "~" + md(e) : ""), aud: a.id });
    });
    if (can("inspection") && S && S.calEvents) S.calEvents(R.from, R.to, t).forEach(x => {
      const tp = S.tplOf(x.tid);
      ev.push({ d: x.d, kind: x.kind, name: x.name, sub: (tp ? S.whoText(tp) + " · " + cycLabel(tp) : "") + (x.kind === "done" ? (x.ng ? " · 이상 있음" : "") : " · 기록 없음"), cell: x.cell, ng: !!x.ng });
    });
    const days = {};
    ev.forEach(e => (days[e.d] = days[e.d] || []).push(e));
    Object.keys(days).forEach(d => days[d].sort((a, b) => KORD[a.kind] - KORD[b.kind] || a.name.localeCompare(b.name)));
    return { R, days, n: ev.filter(e => e.d >= R.first && e.d <= R.last).length };
  }
  const evAttr = (e, w) => e.aud ? `data-ie-aud="${esc(e.aud)}"` : e.cell ? (w ? `data-ie-cell="${esc(e.cell)}"` : `data-ie-go="inspection"`) : "";
  function calAgenda(d, list, t, w, auto) {
    const head = `${md(d)}(${wd(d)})${d === t ? " · 오늘" : ""}`;
    return `<div class="ic-ag${auto ? " is-auto" : ""}" aria-live="polite">
      <div class="ic-ag-h"><b>${esc(head)}</b><span class="dc-meta">${list.length ? list.length + "건" : "일정 없음"}</span></div>
      ${list.length ? `<ul class="ic-ag-l">${list.map(e => `<li><button type="button" class="ic-ag-i is-${e.kind}" ${evAttr(e, w)}><span class="ic-k">${esc(KLB[e.kind])}</span><span class="uc-n"><b>${esc(e.name)}</b><small>${esc(e.sub)}</small></span>${icon("chevron", 15)}</button></li>`).join("")}</ul>` : ""}
    </div>`;
  }
  function calInner(t) {
    if (!calYM) calYM = ymOf(t);
    const ym = calYM, C = calData(ym, t), w = canW(), MAX = 3;
    const sel = calSel && calSel >= C.R.from && calSel <= C.R.to ? calSel : "";
    const autoDay = sel || (ymOf(t) === ym ? t : (Object.keys(C.days).filter(d => d >= C.R.first && d <= C.R.last).sort()[0] || C.R.first));
    const cells = [];
    for (let d = C.R.from; d <= C.R.to; d = addDays(d, 1)) {
      const es = C.days[d] || [], out = d < C.R.first || d > C.R.last, dw = new Date(utc(d)).getUTCDay();
      const kinds = Object.keys(KORD).filter(k => es.some(e => e.kind === k));
      cells.push(`<div class="ic-c${out ? " is-out" : ""}${d === t ? " is-today" : ""}${d === autoDay ? " is-sel" : ""}${dw === 0 ? " is-sun" : dw === 6 ? " is-sat" : ""}${es.length ? " has-ev" : ""}" data-ie-day="${d}">
        <button type="button" class="ic-n" data-ie-dayb="${d}" aria-label="${esc(md(d) + "(" + WD[dw] + ") " + (es.length ? es.length + "건" : "일정 없음"))}">${Number(d.slice(8))}</button>
        ${es.length ? `<span class="ic-dots" aria-hidden="true">${kinds.map(k => `<i class="is-${k}"></i>`).join("")}</span>
        <ul class="ic-evs">${es.slice(0, MAX).map(e => `<li><button type="button" class="ic-ev is-${e.kind}${e.ng ? " is-ng" : ""}" ${evAttr(e, w)} title="${esc(KLB[e.kind] + " · " + e.name + " — " + e.sub)}">${esc(e.name)}</button></li>`).join("")}${es.length > MAX ? `<li><button type="button" class="ic-more" data-ie-dayb="${d}">+${es.length - MAX}</button></li>` : ""}</ul>` : ""}
      </div>`);
    }
    const title = ym.slice(0, 4) + "년 " + Number(ym.slice(5)) + "월";
    return `<h2 class="card-title">${ymOf(t) === ym ? "이번 달 점검 일정" : "점검 일정"}<span class="dc-meta">${esc(title)} · ${C.n}건</span><span class="spacer"></span>
        <span class="ic-nav"><button type="button" class="btn btn-ghost btn-sm" data-ie-cm="-1" aria-label="이전 달">${icon("chevl", 15)}</button><button type="button" class="btn btn-ghost btn-sm" data-ie-cm="0"${ymOf(t) === ym ? " disabled" : ""}>이번 달</button><button type="button" class="btn btn-ghost btn-sm" data-ie-cm="1" aria-label="다음 달">${icon("chevron", 15)}</button></span></h2>
      <div class="ic-lg">${[["recv", "ICNKF 수검"], ["due", "ICNKF 실행 기한"], ["late", "기한 경과"], ["done", "완료"]].map(([k, v]) => `<span class="is-${k}"><i></i>${esc(v)}</span>`).join("")}</div>
      <div class="ic-grid" role="group" aria-label="${esc(title)}">
        ${WD.map((x, i) => `<span class="ic-wd${i === 0 ? " is-sun" : i === 6 ? " is-sat" : ""}">${x}</span>`).join("")}
        ${cells.join("")}
      </div>
      ${calAgenda(autoDay, C.days[autoDay] || [], t, w, !sel)}`;
  }
  const calCard = (t) => `<section class="card sd-card ie-card ie-cal" aria-label="점검 일정">${calInner(t)}</section>`;
  function paintCal() {
    const box = document.querySelector("#view .ie-cal");
    if (!box) return;
    hideTT();
    box.innerHTML = calInner(todayISO());
    wire(box);
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
    $$("[data-ie-go]", root).forEach(b => b.onclick = () => {
      if (b.hasAttribute("data-ie-act") && TR()) TR().setState({ tab: "people", onlyAct: true, pid: "" });
      SeMIS.navigate(b.dataset.ieGo);
    });
    $$("[data-ie-person]", root).forEach(b => b.onclick = () => { if (TR()) TR().openPerson(b.dataset.iePerson); });
    $$("[data-ie-xls]", root).forEach(b => b.onclick = () => { if (TR() && TR().exportDue) TR().exportDue(); });
    $$("[data-ie-aud]", root).forEach(b => b.onclick = () => { if (AU()) AU().open(b.dataset.ieAud); });
    $$("[data-ie-find]", root).forEach(b => b.onclick = () => { if (AU()) AU().setState({ tab: "findings", sel: "", fStF: b.dataset.ieFind }); SeMIS.navigate("audit"); });
    $$("[data-ie-sl]", root).forEach(b => b.onclick = () => { if (!SL()) return; if (b.hasAttribute("data-ie-round")) SL().quickRound(b.dataset.ieSl); else SL().recordForm(b.dataset.ieSl, ""); });
    $$("[data-ie-cell]", root).forEach(b => b.onclick = () => {
      if (!SL()) return;
      SL().openCell(b.dataset.ieCell);
      const ov = document.getElementById("modal-overlay");
      if (!ov || ov.classList.contains("hidden")) SeMIS.navigate("inspection");   // 한 주기에 기록이 여럿이면 기록 목록으로
    });
    $$("[data-ie-cfg]", root).forEach(b => b.onclick = cfgPick);
    if (window.SemisHaz) SemisHaz.fill(root);
    $$("[data-ie-cm]", root).forEach(b => b.onclick = () => { const n = Number(b.dataset.ieCm), t = todayISO(); calYM = n ? ymAdd(calYM || ymOf(t), n) : ymOf(t); calSel = ""; paintCal(); });
    $$("[data-ie-dayb]", root).forEach(b => b.onclick = (ev) => { ev.stopPropagation(); calSel = b.dataset.ieDayb; paintCal(); });
    $$("[data-ie-day]", root).forEach(c => c.onclick = (ev) => { if (ev.target.closest(".ic-ev, .ic-n, .ic-more")) return; calSel = c.dataset.ieDay; paintCal(); });
  }
  function render(root) {
    const t = todayISO();
    hideTT();
    const cards = [];
    /* 카드 하나가 실패해도 나머지는 그린다 */
    const add = (name, fn) => { try { cards.push(fn(t)); } catch (err) {
      if (typeof console !== "undefined") console.error("[aud-dash] " + name, err);
      cards.push(`<section class="card ie-card ie-err" aria-label="${esc(name)}"><h2 class="card-title">${esc(name)}</h2><p class="ie-ok">${icon("alert", 16)}<span>이 카드를 표시하지 못했습니다. 새로 고침 후에도 같으면 관리자에게 알려 주세요.</span></p></section>`);
    } };
    if ((can("inspection") && SL()) || (can("audit") && AU())) { add("점검 일정", calCard); add("다가오는 점검", upcomingCard); }
    if (can("training") && TR()) add("교육 · 자격", trainCard);
    if (can("audit") && AU()) add("수검 대응", auditCard);
    if (can("inspection") && SL()) add("보안 기록부", seclogCard);
    let kpi = "";
    try { kpi = kpiHTML(t); } catch (err) { if (typeof console !== "undefined") console.error("[aud-dash] kpi", err); }
    root.innerHTML = ui.head({ title: TITLE, meta: "기준 " + dot(t) }) + kpi
      + (cards.length ? cards.join("") : `<section class="card">${ui.empty("볼 수 있는 점검 · 교육 메뉴가 없습니다.")}</section>`);
    wire(root);
    /* SSI 서약 명단을 받아 오면(처음 한 번) 다시 그린다 */
    if (can("training") && TR() && TR().loadPledges) TR().loadPledges(false).then(ch => { if (ch && (location.hash.replace(/^#\//, "") === MOD)) SeMIS.renderView(); });
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });
  window.SemisAudDash = { render, kpiHTML, upData, upcomingCard, calData, calCard, cfgPick, trainCard, auditCard, seclogCard,
    setToday(t) { fixedToday = isISO(t) ? t : ""; }, setCal(ym, sel) { calYM = /^\d{4}-\d{2}$/.test(ym || "") ? ym : ""; calSel = isISO(sel) ? sel : ""; } };
})();
