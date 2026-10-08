/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 화물보안 대시보드 (v1.28, 라우트 sec-dash)
   레일의 '화물 보안' 허브를 누르면 열리는 허브 대시보드. CARES 읽기 전용 + 배치도(js/secpost.js).

   화면 구성
   - 요약 지표: 가동률(12개월) · 고장 신고(12개월) · 평균 복구 시간 · 일일점검 이행률(28일) · 경비 지점
   - 화물 보안검색 띠: 검색 라인 · 오늘 일일점검 · 장비 고장(메인 대시보드에서 옮김 — js/screening.js opsHTML)
   - 경비대원 배치도(js/secpost.js)
   - 장비 가동 · 고장 추이: 월별 고장 신고 12개월(X-ray · ETD) · 장비별 가동률 12개월 · 평균 고장 간격
   - 점검 이행 분석: 주별 일일점검 이행률 12주(X-ray · ETD) · 점검 시각 분포 · 점검자별 건수(28일) · 정기점검 경과 · 점검 이상 항목
   - 위해물품 적발 일지(v1.36, js/hazfind.js): 이번 달 합계 · 분류 · 호기 + 12개월 — CARES 월 집계만
   - 검색 환경 24시간: 온도 · 습도 · 결로 여유 추이(지점 3곳) · 기준 초과 시간 · 표로 보기
   차트는 SVG(선) + HTML(막대 · 축 글자) — 화면 폭에 따라 글자가 줄어들지 않게. 색은 CVD 검증 통과값.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, ui, icon } = SeMIS;
  const C = () => window.SemisCares;
  const MOD = "sec-dash", TITLE = "화물보안 대시보드";
  const DAY = 86400000, HOUR = 3600000;
  const PARTS = ["live", "repairs", "history", "env"];
  const KIND_COLOR = { xray: "#2b59c3", etd: "#d97706" };
  const LOC_COLOR = { ICN_CARGO_B: "#7c3aed", ICN_ETD_CASE: "#d97706", ICN_SEARCH_ROOM: "#0d9488" };
  const ONE = "#0f766e";   // 단일 계열
  const route = () => (location.hash.replace(/^#\//, "") || "dashboard");
  const fmtN = (v, dec) => v == null || !isFinite(v) ? "-" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  const pct = (v, dec) => v == null || !isFinite(v) ? "-" : (Math.floor(v * 1000) / 10).toFixed(dec == null ? 1 : dec) + "%";
  const pct0 = (v) => v == null || !isFinite(v) ? "-" : Math.round(v * 100) + "%";
  function hmDur(min) {
    if (!(min > 0)) return "0분";
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? h + "시간" + (m ? " " + m + "분" : "") : m + "분";
  }

  /* ═════════ 통계 계산 ═════════ */
  function equipStats(now) {
    const K = C();
    now = now || Date.now();
    const from = now - 365 * DAY;
    const rows = K.rangeStats(from, now);
    const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);
    const avail = (arr) => { const d = sum(arr, x => x.days); return d ? (d - sum(arr, x => x.downDays)) / d : null; };
    const xr = rows.filter(r => r.unit.kind === "xray"), etd = rows.filter(r => r.unit.kind === "etd");
    const count = sum(rows, x => x.count), fixed = sum(rows, x => x.fixed), fixMs = sum(rows, x => x.fixMs);
    const unitDays = sum(rows, x => x.days);
    return { rows, avail: avail(rows), xr: avail(xr), etd: avail(etd), count, downMs: sum(rows, x => x.downMs),
      mttrMs: fixed ? fixMs / fixed : null, fixed, mtbfDays: count ? unitDays / count : null,
      active: K.state.repairs.filter(r => K.repairStatus(r) !== "resolved") };
  }
  function monthly(n) {
    const K = C();
    const now = K.todayKey();
    let y = Number(now.slice(0, 4)), mo = Number(now.slice(5, 7));
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      let yy = y, mm = mo - i;
      while (mm <= 0) { mm += 12; yy--; }
      const key = yy + "-" + String(mm).padStart(2, "0");
      const rs = K.state.repairs.filter(r => r.reportedAtMs && K.dayKey(r.reportedAtMs).slice(0, 7) === key);
      const kindOf = (r) => { const u = K.unitById(r.equipmentId); return u ? u.kind : K.kindOf(/RAP|X-?RAY/i.test(r.equipmentName || "") ? "XRAY" : "ETD"); };
      out.push({ key, label: mm + "월", y: yy, xray: rs.filter(r => kindOf(r) === "xray").length, etd: rs.filter(r => kindOf(r) !== "xray").length });
    }
    return out;
  }
  /* 주별 일일점검 이행률 — 어제까지 7일 창 12개(오늘은 아직 진행 중이라 뺀다).
     분모 = 장비 × 날짜 중 고장 · 수리로 멈춘 날을 뺀 것, 분자 = 그중 일일점검 기록이 있는 날.
     장비 유형마다 CARES 에 일일점검 기록이 처음 나온 날부터 센다(기록을 시작하기 전은 빈칸 — 0%로 보이지 않게) */
  function weekly(n) {
    const K = C();
    const idx = K.inspIndex();
    const us = K.units();
    const today = K.dayStartMs(K.todayKey());
    const firstOf = {};
    ["xray", "etd"].forEach(k => {
      const ids = {};
      us.filter(u => u.kind === k).forEach(u => { ids[u.id] = 1; });
      const oldest = K.allInspections().filter(r => r.type === "daily" && ids[r.equipmentId]).reduce((m, r) => Math.min(m, r.inspectedAtMs || Infinity), Infinity);
      firstOf[k] = isFinite(oldest) ? K.dayStartMs(K.dayKey(oldest)) : today;
    });
    const out = [];
    for (let w = n - 1; w >= 0; w--) {
      const end = today - w * 7 * DAY;          // 창 끝(그날 0시, 미포함)
      const start = end - 7 * DAY;
      const res = {};
      ["xray", "etd"].forEach(k => {
        let exp = 0, done = 0;
        us.filter(u => u.kind === k).forEach(u => {
          const down = K.downDays(u.id, start, end);
          const o = idx[u.id] || { days: {} };
          for (let t = Math.max(start, firstOf[k]); t < end; t += DAY) {
            const key = K.dayKey(t + HOUR);
            if (down[key]) continue;
            exp++;
            if (o.days[key] && o.days[key].length) done++;
          }
        });
        res[k] = exp ? done / exp : null;
        res[k + "N"] = [done, exp];
      });
      const lastDay = K.dayKey(end - DAY + HOUR);
      out.push(Object.assign({ t: end - DAY / 2, label: K.mdk(lastDay), from: K.mdk(K.dayKey(start + HOUR)), to: K.mdk(lastDay) }, res));
    }
    return out;
  }
  function inspect28() {
    const K = C();
    const since = K.dayStartMs(K.todayKey()) - 27 * DAY;
    const daily = K.allInspections().filter(r => r.type === "daily" && r.inspectedAtMs >= since);
    const hours = new Array(24).fill(0);
    const who = {};
    daily.forEach(r => {
      hours[Number(K.hm(r.inspectedAtMs).slice(0, 2))]++;
      const n = String(r.inspector || "").trim() || "(이름 없음)";
      who[n] = (who[n] || 0) + 1;
    });
    const sorted = daily.map(r => r.inspectedAtMs).map(ms => { const h = K.hm(ms); return Number(h.slice(0, 2)) * 60 + Number(h.slice(3)); }).sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    return { n: daily.length, hours, who: Object.keys(who).map(k => ({ name: k, n: who[k] })).sort((a, b) => b.n - a.n),
      median: med == null ? "" : String(Math.floor(med / 60)).padStart(2, "0") + ":" + String(med % 60).padStart(2, "0") };
  }
  /* 28일 이행률(오늘 포함 — 보안검색 현황 표와 같은 셈) */
  function rate28() {
    const K = C();
    const idx = K.inspIndex();
    const days = K.lastDays(28);
    const from = K.dayStartMs(days[0]), to = Date.now();
    const res = { all: [0, 0], xray: [0, 0], etd: [0, 0] };
    K.units().forEach(u => {
      const o = idx[u.id] || { days: {} };
      const down = K.downDays(u.id, from, to);
      days.forEach(k => {
        const done = !!(o.days[k] && o.days[k].length);
        if (!done && (down[k] || k === K.todayKey())) return;   // 고장 중 · 오늘 아직 = 분모에서 뺌
        ["all", u.kind].forEach(g => { if (!res[g]) return; res[g][1]++; if (done) res[g][0]++; });
      });
    });
    const r = (a) => a[1] ? a[0] / a[1] : null;
    return { all: r(res.all), xray: r(res.xray), etd: r(res.etd) };
  }
  function periodicLate() {
    const K = C();
    const idx = K.inspIndex();
    const today = K.dayStartMs(K.todayKey());
    const CYCLE = { weekly: 7, monthly: 31 };
    const out = { weekly: [], monthly: [] };
    K.units().forEach(u => {
      if (u.active) return;
      const o = idx[u.id] || { last: {} };
      Object.keys(CYCLE).forEach(t => {
        const r = o.last[t];
        const gap = r ? Math.round((today - K.dayStartMs(K.dayKey(r.inspectedAtMs))) / DAY) : null;
        if (gap == null || gap > CYCLE[t]) out[t].push({ u, gap });
      });
    });
    return out;
  }
  function anomalies(n) {
    const K = C();
    const out = [];
    K.allInspections().forEach(r => (r.checklist || []).forEach(c => {
      if (c && (c.result === "bad" || c.result === "caution")) out.push({ r, c });
    }));
    out.sort((a, b) => b.r.inspectedAtMs - a.r.inspectedAtMs);
    return { total: out.length, bad: out.filter(x => x.c.result === "bad").length, list: out.slice(0, n) };
  }
  /* 검색 환경 24시간 — 지점별 온도 · 습도 · 이슬점, 3분 칸마다 결로 여유(가장 차가운 곳 온도 − 가장 습한 곳 이슬점) */
  function envModel() {
    const K = C();
    const ser = K.envSeries();
    const ids = K.DEVICE_ORDER.filter(id => ser[id] && ser[id].length).concat(Object.keys(ser).filter(id => K.DEVICE_ORDER.indexOf(id) < 0));
    const slot = {};
    ids.forEach(id => ser[id].forEach(o => {
      const k = Math.round(o.t / 180000);
      const s = slot[k] || (slot[k] = { t: k * 180000, temps: [], dews: [] });
      if (o.temp != null) s.temps.push(o.temp);
      if (o.dewPoint != null) s.dews.push(o.dewPoint);
    }));
    const margin = Object.keys(slot).map(Number).sort((a, b) => a - b).map(k => slot[k])
      .filter(s => s.temps.length >= 2 && s.dews.length >= 2)
      .map(s => [s.t, Math.round((Math.min.apply(null, s.temps) - Math.max.apply(null, s.dews)) * 10) / 10]);
    const metrics = K.METRICS;
    const over = ids.map(id => {
      const m = {};
      metrics.forEach(mt => {
        const th = K.thFor(id, mt.key);
        m[mt.key] = ser[id].filter(o => K.exceed(o[mt.key], th)).length * 3;
      });
      return { id, name: (K.DEVICES[id] && K.DEVICES[id].name) || id, m };
    });
    const overKeys = metrics.filter(mt => over.some(o => o.m[mt.key] > 0));
    const t1 = Date.now(), t0 = t1 - 24 * HOUR;
    const n = ids.reduce((s, id) => s + ser[id].length, 0);
    return { ids, ser, margin, over, overKeys, t0, t1, n };
  }

  /* ═════════ 차트 조각 ═════════ */
  const charts = {};
  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    const raw = (hi - lo) / Math.max(1, n || 4);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw) || raw;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  /* 선 차트 — o: { id, series[{ key, name, color, pts[[t, v]] }], x0, x1, yMin?, yMax?, fmt(v), unit, xTicks[{ t, label }], refs[{ v, label }], h, gap(ms) } */
  function lineChart(o) {
    const all = [];
    o.series.forEach(s => s.pts.forEach(p => { if (p[1] != null) all.push(p[1]); }));
    (o.refs || []).forEach(r => all.push(r.v));
    let lo = o.yMin != null ? o.yMin : Math.min.apply(null, all.length ? all : [0]);
    let hi = o.yMax != null ? o.yMax : Math.max.apply(null, all.length ? all : [1]);
    if (o.yMin == null && o.yMax == null && hi - lo < (o.minSpan || 1)) { const c = (hi + lo) / 2; lo = c - (o.minSpan || 1) / 2; hi = c + (o.minSpan || 1) / 2; }
    const ticks = niceTicks(lo, hi, 4);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const tdec = Math.abs(step - Math.round(step)) > 1e-9 ? 1 : 0;   // 2.5 간격이면 소수 한 자리(22.5를 23으로 보이지 않게)
    const tickTxt = (v) => o.fmt ? o.fmt(v, tdec) : fmtN(v, tdec);
    const y0 = o.yMin != null ? o.yMin : ticks[0], y1 = o.yMax != null ? o.yMax : ticks[ticks.length - 1];
    const X = (t) => (t - o.x0) / (o.x1 - o.x0) * 1000;
    const Y = (v) => 1000 - (v - y0) / (y1 - y0) * 1000;
    const pctY = (v) => (Y(v) / 10).toFixed(2);
    const gap = o.gap || Infinity;
    const lines = o.series.map(s => {
      const segs = []; let cur = [];
      s.pts.forEach((p, i) => {
        if (p[1] == null) { if (cur.length) segs.push(cur); cur = []; return; }
        if (cur.length && p[0] - s.pts[i - 1][0] > gap) { segs.push(cur); cur = []; }
        cur.push(X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1));
      });
      if (cur.length) segs.push(cur);
      return segs.map(sg => sg.length === 1 ? `<polyline points="${sg[0]} ${sg[0]}" stroke="${s.color}" class="lc-ln lc-one"/>`
        : `<polyline points="${sg.join(" ")}" stroke="${s.color}" class="lc-ln"/>`).join("");
    }).join("");
    const grid = ticks.filter(v => v >= y0 && v <= y1).map(v => `<line x1="0" x2="1000" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="lc-grid"/>`).join("");
    const refs = (o.refs || []).filter(r => r.v >= y0 && r.v <= y1).map(r => `<line x1="0" x2="1000" y1="${Y(r.v).toFixed(1)}" y2="${Y(r.v).toFixed(1)}" class="lc-ref"/>`).join("");
    const ends = o.series.map(s => {
      const last = s.pts.slice().reverse().find(p => p[1] != null);
      return last && o.markers !== "all" ? `<i class="lc-dot" style="left:${(X(last[0]) / 10).toFixed(2)}%;top:${pctY(last[1])}%;--c:${s.color}"></i>` : "";
    }).join("") + (o.markers === "all" ? o.series.map(s => s.pts.filter(p => p[1] != null).map(p =>
      `<i class="lc-dot" style="left:${(X(p[0]) / 10).toFixed(2)}%;top:${pctY(p[1])}%;--c:${s.color}"></i>`).join("")).join("") : "");
    charts[o.id] = { o, y0, y1 };
    return `<div class="lc" data-lc="${esc(o.id)}" style="--h:${o.h || 150}px">
      <div class="lc-plot" role="img" aria-label="${esc(o.label || "")}">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">${grid}${refs}${lines}</svg>
        ${ticks.filter(v => v >= y0 && v <= y1).map(v => `<span class="lc-yt mono" style="top:${pctY(v)}%">${esc(tickTxt(v))}</span>`).join("")}
        ${(o.refs || []).filter(r => r.v >= y0 && r.v <= y1).map(r => `<span class="lc-rl" style="top:${pctY(r.v)}%">${esc(r.label)}</span>`).join("")}
        ${ends}
        <div class="lc-hv" hidden><i class="lc-vl"></i></div>
      </div>
      <div class="lc-x">${(o.xTicks || []).map(x => `<span class="mono" style="left:${(X(x.t) / 10).toFixed(2)}%">${esc(x.label)}</span>`).join("")}</div>
    </div>`;
  }
  const legend = (items) => `<div class="sd-legend">${items.map(x => `<span><i style="--c:${x.color}"${x.dash ? ' class="dash"' : ""}></i>${esc(x.name)}</span>`).join("")}</div>`;
  /* 세로 막대 — cols[{ label, parts[{ v, color, name }], tt }], 값은 막대 끝에 */
  function colChart(cols, o) {
    o = o || {};
    const max = Math.max(1, ...cols.map(c => c.parts.reduce((n, p) => n + p.v, 0)));
    return `<div class="cc${o.dense ? " dense" : ""}" style="--n:${cols.length};--h:${o.h || 120}px" role="img" aria-label="${esc(o.label || "")}">
      <div class="cc-plot">${cols.map(c => {
        const tot = c.parts.reduce((n, p) => n + p.v, 0);
        return `<div class="cc-col" data-tt="${esc(c.tt || (c.label + " " + tot))}" tabindex="-1">
          <span class="cc-v mono">${tot && (!o.sparse || tot === max || c.show) ? tot : ""}</span>
          <span class="cc-bar" style="height:${(tot / max * 100).toFixed(1)}%">${c.parts.filter(p => p.v).map(p =>
            `<i style="flex:${p.v};--c:${p.color}"></i>`).join("")}</span></div>`;
      }).join("")}</div>
      <div class="cc-x">${cols.map(c => `<span>${esc(c.xl != null ? c.xl : c.label)}</span>`).join("")}</div>
    </div>`;
  }
  const hbar = (label, frac, val, sub, opts) => `<div class="av-row sd-hb"${opts && opts.tt ? ` data-tt="${esc(opts.tt)}"` : ""}>
      <span class="av-lb">${esc(label)}</span>
      <span class="av-track"><i class="av-bar${opts && opts.low ? " low" : ""}" style="width:${Math.max(frac > 0 ? 1 : 0, Math.min(100, frac * 100)).toFixed(1)}%"></i></span>
      <span class="av-v mono">${esc(val)}</span><span class="av-s mono">${esc(sub || "")}</span></div>`;
  const wait = (t) => `<div class="scr-wait" role="status"><span class="cfe-spin" aria-hidden="true"></span>${esc(t)}</div>`;
  const failBox = (t) => `<div class="dscr-err sd-fail">${esc(t)}<button type="button" class="link-btn" data-sd-retry>다시 시도</button></div>`;

  /* ═════════ 카드 ═════════ */
  function kpiHTML(s) {
    const K = C();
    const SP = window.SemisSecPost;
    const tiles = [];
    if (K.has("repairs") && !K.failed("repairs") && s.equips.length) {
      const e = equipStats();
      tiles.push({ label: "장비 가동률", value: pct(e.avail), sub: "12개월 · X-ray " + pct(e.xr) + " · ETD " + pct(e.etd), tone: e.avail != null && e.avail < 0.9 ? "warn" : "ok" });
      tiles.push({ label: "고장 신고", value: e.count + "건", sub: "12개월 · 진행 중 " + e.active.length + "건" });
      tiles.push({ label: "평균 복구 시간", value: e.mttrMs ? K.fmtDur(e.mttrMs) : "-", sub: "신고 → 복귀 · 완료 " + e.fixed + "건" });
    }
    if (K.has("history") && !K.failed("history") && s.equips.length) {
      const r = rate28();
      tiles.push({ label: "일일점검 이행률", value: pct0(r.all), sub: "28일 · X-ray " + pct0(r.xray) + " · ETD " + pct0(r.etd), tone: r.all != null && r.all < 0.8 ? "warn" : "ok" });
    }
    if (K.has("haz") && !K.failed("haz")) {
      const hz = K.hazMonth(K.ymKST(0)), hp = K.hazMonth(K.ymKST(-1));
      tiles.push({ label: "위해물품 적발", value: hz.total + "건", sub: "이번 달 · 지난달 " + hp.total + "건" });
    }
    if (SP && SP.canRead() && SP.hasData()) {
      const ps = SP.stats();
      tiles.push({ label: "경비 지점", value: ps.total + "곳", sub: "카드리더 " + ps.cr + " · 문형 금속탐지기 " + ps.dmd });
    }
    return tiles.length ? ui.stats(tiles) : "";
  }
  function equipCard() {
    const K = C();
    if (!K.has("repairs")) return `<section class="card sd-card" aria-label="장비 가동 · 고장 추이"><h2 class="card-title">장비 가동 · 고장 추이</h2>${wait("고장 기록을 불러오는 중입니다.")}</section>`;
    if (K.failed("repairs")) return `<section class="card sd-card" aria-label="장비 가동 · 고장 추이"><h2 class="card-title">장비 가동 · 고장 추이</h2>${failBox("CARES 고장 기록을 불러오지 못했습니다. (" + K.state.errs.repairs + ")")}</section>`;
    const e = equipStats();
    const ms = monthly(12);
    const cols = ms.map(m => ({ label: m.label, xl: m.label.replace("월", ""), parts: [{ v: m.xray, color: KIND_COLOR.xray }, { v: m.etd, color: KIND_COLOR.etd }],
      tt: m.y + "년 " + m.label + " · X-ray " + m.xray + "건 · ETD " + m.etd + "건" }));
    const peak = ms.reduce((a, b) => (b.xray + b.etd > a.xray + a.etd ? b : a), ms[0]);
    const rows = e.rows.slice();
    const bars = rows.map(r => hbar(r.unit.label, r.avail == null ? 0 : r.avail, pct(r.avail), r.count + "건 · " + (r.downMs ? K.fmtDur(r.downMs) : "0분"),
      { low: r.avail != null && r.avail < 0.9, tt: r.unit.label + " · 가동률 " + pct(r.avail) + " · 고장 " + r.count + "건 · 비가동 " + r.downDays + "일 / " + r.days + "일" + (r.mttrMs ? " · 평균 복구 " + K.fmtDur(r.mttrMs) : "") })).join("");
    return `<section class="card sd-card" aria-label="장비 가동 · 고장 추이">
      <h2 class="card-title">장비 가동 · 고장 추이<span class="dc-meta">최근 12개월</span><span class="spacer"></span><button type="button" class="link-btn" data-sd-equip="analysis">가동 분석</button></h2>
      <div class="sd-grid">
        <div class="sd-pane">
          <div class="sd-ph"><b>월별 고장 신고</b>${legend([{ name: "X-ray", color: KIND_COLOR.xray }, { name: "ETD", color: KIND_COLOR.etd }])}</div>
          ${colChart(cols, { label: "월별 고장 신고 " + ms.map(m => m.label + " " + (m.xray + m.etd) + "건").join(", "), h: 132 })}
          <p class="sd-foot">12개월 <b class="mono">${e.count}</b>건 · 월평균 <b class="mono">${fmtN(e.count / 12, 1)}</b>건${peak && peak.xray + peak.etd ? " · 최다 " + esc(peak.label) + " " + (peak.xray + peak.etd) + "건" : ""} · 장비당 평균 고장 간격 <b class="mono">${e.mtbfDays ? fmtN(e.mtbfDays, 0) + "일" : "-"}</b></p>
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>장비별 가동률</b><span class="dc-meta">고장 · 다운타임</span></div>
          <div class="sd-bars">${bars || ui.empty("CARES 장비가 없습니다.")}</div>
        </div>
      </div>
    </section>`;
  }
  function inspCard() {
    const K = C();
    if (!K.has("history")) return `<section class="card sd-card" aria-label="점검 이행 분석"><h2 class="card-title">점검 이행 분석</h2>${wait("최근 12주 점검 기록을 불러오는 중입니다.")}</section>`;
    if (K.failed("history")) return `<section class="card sd-card" aria-label="점검 이행 분석"><h2 class="card-title">점검 이행 분석</h2>${failBox("CARES 점검 기록을 불러오지 못했습니다. (" + K.state.errs.inspections + ")")}</section>`;
    const wk = weekly(12);
    const t0 = wk[0].t - 3.5 * DAY, t1 = wk[wk.length - 1].t + 3.5 * DAY;
    const series = ["xray", "etd"].map(k => ({ key: k, name: K.KIND_LABEL[k], color: KIND_COLOR[k], pts: wk.map(w => [w.t, w[k] == null ? null : Math.round(w[k] * 1000) / 10]) }));
    const line = lineChart({ id: "wk", series, x0: t0, x1: t1, yMin: 0, yMax: 100, fmt: (v) => v + "%", markers: "all", h: 150,
      xTicks: wk.filter((w, i) => i % 2 === 1 || i === wk.length - 1).map(w => ({ t: w.t, label: w.label })),
      label: "주별 일일점검 이행률 " + wk.map(w => w.label + " X-ray " + (w.xray == null ? "-" : Math.round(w.xray * 100) + "%") + " ETD " + (w.etd == null ? "-" : Math.round(w.etd * 100) + "%")).join(", ") });
    charts.wk.tip = (i) => {
      const w = wk[i];
      return `<b>${esc(w.from)} ~ ${esc(w.to)}</b>` + ["xray", "etd"].map(k => `<span><i style="--c:${KIND_COLOR[k]}"></i>${esc(K.KIND_LABEL[k])} <b class="mono">${w[k] == null ? "-" : pct0(w[k])}</b> <small class="mono">${w[k + "N"][0]}/${w[k + "N"][1]}</small></span>`).join("");
    };
    charts.wk.idx = wk.map(w => w.t);
    const i28 = inspect28();
    const hrs = i28.hours.map((n, h) => ({ label: h + "시", xl: h % 3 === 0 ? String(h) : "", parts: [{ v: n, color: ONE }], tt: String(h).padStart(2, "0") + "시대 " + n + "건" }));
    const maxWho = Math.max(1, ...i28.who.map(w => w.n));
    const late = periodicLate();
    const an = anomalies(5);
    const lateTxt = (arr) => arr.length ? arr.map(x => x.u.label + (x.gap == null ? " 기록 없음" : " " + x.gap + "일")).join(" · ") : "없음";
    return `<section class="card sd-card" aria-label="점검 이행 분석">
      <h2 class="card-title">점검 이행 분석<span class="dc-meta">CARES 점검 기록</span><span class="spacer"></span><button type="button" class="link-btn" data-sd-go="scr-status">일일점검 표</button></h2>
      <div class="sd-grid">
        <div class="sd-pane">
          <div class="sd-ph"><b>주별 일일점검 이행률</b><span class="dc-meta">12주 · 어제까지</span>${legend(series)}</div>
          ${line}
          <p class="sd-foot">분모에서 고장 · 수리로 멈춘 날은 뺍니다.</p>
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>점검 시각</b><span class="dc-meta">28일 · 일일점검 ${i28.n}건${i28.median ? " · 가운데값 " + esc(i28.median) : ""}</span></div>
          ${colChart(hrs, { label: "시간대별 일일점검 건수", h: 84, dense: true, sparse: true })}
          <div class="sd-ph sd-ph2"><b>점검자별</b><span class="dc-meta">28일 · 일일점검</span></div>
          <div class="sd-bars">${i28.who.length ? i28.who.slice(0, 6).map(w => hbar(w.name, w.n / maxWho, w.n + "건", pct0(w.n / Math.max(1, i28.n)))).join("") : ui.empty("최근 28일 기록이 없습니다.")}</div>
        </div>
      </div>
      <div class="sd-grid sd-grid-b">
        <div class="sd-pane">
          <div class="sd-ph"><b>정기점검 주기 경과</b><span class="dc-meta">주간 7일 · 월간 31일 초과</span></div>
          <div class="sd-late"><span class="sd-lk">주간</span><span class="sd-lv${late.weekly.length ? " bad" : ""}"><b class="mono">${late.weekly.length}</b>대</span><span class="sd-lt">${esc(lateTxt(late.weekly))}</span></div>
          <div class="sd-late"><span class="sd-lk">월간</span><span class="sd-lv${late.monthly.length ? " bad" : ""}"><b class="mono">${late.monthly.length}</b>대</span><span class="sd-lt">${esc(lateTxt(late.monthly))}</span></div>
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>점검 이상 항목</b><span class="dc-meta">12주 · 불량 ${an.bad} · 주의 ${an.total - an.bad}</span></div>
          ${an.list.length ? `<div class="sd-an">${an.list.map(x => {
            const u = K.unitById(x.r.equipmentId);
            return `<div class="sd-an-row"><span class="mono">${esc(K.mdk(K.dayKey(x.r.inspectedAtMs)))}</span><b>${esc(u ? u.label : (x.r.equipmentName || ""))}</b>
              <span class="sd-an-i">${esc(x.c.itemName || "")}${x.c.note || x.r.remark ? `<small>${esc(x.c.note || x.r.remark)}</small>` : ""}</span>${ui.chip(x.c.result === "bad" ? "불량" : "주의", x.c.result === "bad" ? "red" : "amber")}</div>`;
          }).join("")}</div>` : `<div class="ok-line">${icon("check", 16)}최근 12주 불량 · 주의 항목 없음</div>`}
        </div>
      </div>
    </section>`;
  }
  function envCard() {
    const K = C();
    const head = `<h2 class="card-title">검색 환경 추이<span class="dc-meta">최근 24시간 · 센서 3분 주기</span><span class="spacer"></span><button type="button" class="link-btn" data-sd-go="scr-status">지금 값</button></h2>`;
    if (!K.has("env")) return `<section class="card sd-card" aria-label="검색 환경 추이">${head}${wait("센서 기록을 불러오는 중입니다.")}</section>`;
    const m = envModel();
    if (K.failed("env")) return `<section class="card sd-card" aria-label="검색 환경 추이">${head}${failBox("CARES 센서 기록을 불러오지 못했습니다. (" + K.state.errs.env + ")")}</section>`;
    if (!m.n) return `<section class="card sd-card" aria-label="검색 환경 추이">${head}${ui.empty("최근 24시간 센서 기록이 없습니다.")}</section>`;
    const name = (id) => (K.DEVICES[id] && K.DEVICES[id].name) || id;
    const color = (id, i) => LOC_COLOR[id] || ["#7c3aed", "#d97706", "#0d9488"][i % 3];
    const xt = [];
    const h0 = Math.ceil(m.t0 / (6 * HOUR)) * 6 * HOUR;
    for (let t = h0; t <= m.t1; t += 6 * HOUR) xt.push({ t, label: K.hm(t) });
    const mk = (key) => m.ids.map((id, i) => ({ key: id, name: name(id), color: color(id, i), pts: m.ser[id].map(o => [o.t, o[key]]) }));
    const common = { x0: m.t0, x1: m.t1, xTicks: xt, gap: 12 * 60000, h: 128 };
    const tSer = mk("temp"), hSer = mk("humidity");
    const tChart = lineChart(Object.assign({ id: "env-t", series: tSer, fmt: (v, d) => fmtN(v, d) + "℃", unit: "℃", dec: 1, minSpan: 4, label: "지점별 온도 24시간" }, common));
    const hChart = lineChart(Object.assign({ id: "env-h", series: hSer, fmt: (v, d) => fmtN(v, d) + "%", unit: "%", dec: 0, minSpan: 10, label: "지점별 습도 24시간" }, common));
    const mSer = [{ key: "margin", name: "결로 여유", color: ONE, pts: m.margin }];
    const mChart = lineChart(Object.assign({ id: "env-m", series: mSer, fmt: (v, d) => fmtN(v, d) + "℃", unit: "℃", dec: 1, minSpan: 4,
      refs: [{ v: 3, label: "주의 3℃" }, { v: 0, label: "결로 0℃" }], label: "결로 여유 24시간" }, common));
    const lastM = m.margin.length ? m.margin[m.margin.length - 1][1] : null;
    const minM = m.margin.length ? m.margin.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
    const watchMin = m.margin.filter(x => x[1] <= 3).length * 3;
    const legendItems = m.ids.map((id, i) => ({ name: name(id), color: color(id, i) }));
    const stat = (id, key) => {
      const v = m.ser[id].map(o => o[key]).filter(x => x != null);
      if (!v.length) return null;
      return { min: Math.min.apply(null, v), max: Math.max.apply(null, v), avg: v.reduce((a, b) => a + b, 0) / v.length, last: v[v.length - 1] };
    };
    const tblRows = m.ids.map(id => {
      const t = stat(id, "temp"), h = stat(id, "humidity"), d = stat(id, "dewPoint");
      const cell = (s, dec) => s ? `<td class="mono">${fmtN(s.min, dec)} / ${fmtN(s.avg, dec)} / ${fmtN(s.max, dec)}</td><td class="mono">${fmtN(s.last, dec)}</td>` : "<td>-</td><td>-</td>";
      return `<tr><th scope="row">${esc(name(id))}</th>${cell(t, 1)}${cell(h, 0)}${cell(d, 1)}<td class="mono">${m.ser[id].length}</td></tr>`;
    }).join("");
    return `<section class="card sd-card" aria-label="검색 환경 추이">${head}
      ${legend(legendItems)}
      <div class="sd-env">
        <div class="sd-pane"><div class="sd-ph"><b>온도</b></div>${tChart}</div>
        <div class="sd-pane"><div class="sd-ph"><b>습도</b></div>${hChart}</div>
        <div class="sd-pane"><div class="sd-ph"><b>결로 여유</b>${ui.tip("3분마다 가장 차가운 지점의 온도에서 가장 습한 지점의 이슬점을 뺀 값입니다. 3℃ 이하면 X-ray 터널 내벽 · 검출기 결로 주의, 0℃ 이하면 결로 발생 조건입니다.", "결로 여유 설명")}</div>${mChart}
          <p class="sd-foot">지금 <b class="mono">${lastM == null ? "-" : fmtN(lastM, 1) + "℃"}</b> · 최저 <b class="mono">${minM ? fmtN(minM[1], 1) + "℃" : "-"}</b>${minM ? " (" + esc(K.hm(minM[0])) + ")" : ""} · 3℃ 이하 <b class="mono">${esc(hmDur(watchMin))}</b></p></div>
      </div>
      <div class="sd-ph sd-ph2"><b>기준 초과 시간</b><span class="dc-meta">24시간 · CARES 기기별 임계치</span></div>
      ${m.overKeys.length ? `<div class="table-wrap"><table class="tbl sd-over">
        <thead><tr><th></th>${m.overKeys.map(mt => `<th scope="col">${esc(mt.label)}<small>${esc(mt.unit)}</small></th>`).join("")}</tr></thead>
        <tbody>${m.over.map(o => `<tr><th scope="row">${esc(o.name)}</th>${m.overKeys.map(mt => {
          const th = K.thFor(o.id, mt.key);
          const tt = th.max != null && th.min != null ? th.min + "~" + th.max : th.max != null ? "≤ " + th.max : th.min != null ? "≥ " + th.min : "기준 없음";
          return `<td class="mono${o.m[mt.key] ? " over" : ""}" title="${esc(o.name + " " + mt.label + " 기준 " + tt)}">${o.m[mt.key] ? esc(hmDur(o.m[mt.key])) : "—"}</td>`;
        }).join("")}</tr>`).join("")}</tbody></table></div>`
        : `<div class="ok-line">${icon("check", 16)}24시간 동안 기준 초과 없음</div>`}
      <details class="sd-tbl"><summary>표로 보기</summary><div class="table-wrap"><table class="tbl">
        <thead><tr><th></th><th>온도 최저 / 평균 / 최고</th><th>지금</th><th>습도 최저 / 평균 / 최고</th><th>지금</th><th>이슬점 최저 / 평균 / 최고</th><th>지금</th><th>수신</th></tr></thead>
        <tbody>${tblRows}</tbody></table></div></details>
    </section>`;
  }
  function bodyHTML() {
    const s = C().state;
    if (!s.ts && !s.err) return wait("CARES에서 장비 · 점검 · 센서 기록을 불러오는 중입니다.");
    if (s.err && !s.equips.length) return `<section class="card">${ui.empty("CARES에 연결하지 못했습니다. (" + s.err + ")",
      '<button type="button" class="btn btn-ghost btn-sm" data-sd-retry>다시 시도</button>')}</section>`;
    return equipCard() + inspCard() + (window.SemisHaz ? SemisHaz.sdCard() : "") + envCard();
  }
  function metaText() {
    return window.SemisScreen && SemisScreen.metaText ? SemisScreen.metaText(C().state) : "CARES";
  }

  /* ═════════ 말풍선(차트 값) — 문서에 하나 ═════════ */
  let tt = null;
  function ttBox() {
    if (tt && document.body.contains(tt)) return tt;
    tt = document.createElement("div");
    tt.className = "sd-tt"; tt.setAttribute("role", "tooltip"); tt.hidden = true;
    document.body.appendChild(tt);
    return tt;
  }
  function showTT(html, x, y) {
    const b = ttBox();
    b.innerHTML = html; b.hidden = false;
    const w = b.offsetWidth || 180, h = b.offsetHeight || 60;
    const vw = window.innerWidth || 1200;
    b.style.left = Math.max(8, Math.min(vw - w - 8, x - w / 2)) + "px";
    b.style.top = Math.max(8, y - h - 12) + "px";
  }
  const hideTT = () => { if (tt) tt.hidden = true; };
  function wireCharts(root) {
    $$("[data-tt]", root).forEach(el => {
      const on = () => { const r = el.getBoundingClientRect(); showTT(esc(el.dataset.tt), r.left + r.width / 2, r.top); };
      el.addEventListener("mouseenter", on); el.addEventListener("mouseleave", hideTT);
      el.addEventListener("focus", on); el.addEventListener("blur", hideTT);
    });
    $$(".lc", root).forEach(box => {
      const ch = charts[box.dataset.lc];
      const plot = $(".lc-plot", box);
      if (!ch || !plot) return;
      const hv = $(".lc-hv", plot);
      const move = (e) => {
        const r = plot.getBoundingClientRect();
        if (!r.width) return;
        const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const t = ch.o.x0 + fx * (ch.o.x1 - ch.o.x0);
        let tx = null, rows = [];
        if (ch.idx) {   // 주별 — 가장 가까운 칸
          let bi = 0;
          ch.idx.forEach((v, i) => { if (Math.abs(v - t) < Math.abs(ch.idx[bi] - t)) bi = i; });
          tx = ch.idx[bi];
          showTT(ch.tip(bi), e.clientX, r.top);
        } else {
          ch.o.series.forEach(s => {
            let best = null;
            s.pts.forEach(p => { if (p[1] != null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p; });
            if (best && Math.abs(best[0] - t) <= 10 * 60000) { rows.push({ s, p: best }); if (tx == null) tx = best[0]; }
          });
          if (!rows.length) { hv.hidden = true; hideTT(); return; }
          showTT(`<b>${esc(C().hm(tx))}</b>` + rows.map(x => `<span><i style="--c:${x.s.color}"></i>${esc(x.s.name)} <b class="mono">${esc(fmtN(x.p[1], ch.o.dec == null ? 1 : ch.o.dec) + (ch.o.unit || ""))}</b></span>`).join(""), e.clientX, r.top);
        }
        hv.hidden = false;
        hv.style.left = ((tx - ch.o.x0) / (ch.o.x1 - ch.o.x0) * 100).toFixed(2) + "%";
      };
      plot.addEventListener("pointermove", move);
      plot.addEventListener("pointerdown", move);
      plot.addEventListener("pointerleave", () => { hv.hidden = true; hideTT(); });
    });
  }

  /* ═════════ 그리기 · 불러오기 ═════════ */
  function wire(root) {
    $$("[data-sd-go]", root).forEach(b => b.onclick = () => SeMIS.navigate(b.dataset.sdGo));
    $$("[data-sd-equip]", root).forEach(b => b.onclick = () => { if (window.SemisEquip) SemisEquip.setTab(b.dataset.sdEquip); SeMIS.navigate("scr-equip"); });
    $$("[data-sd-retry]", root).forEach(b => b.onclick = () => refresh(true));
    wireCharts(root);
    if (window.SemisHaz) SemisHaz.fill(root);
  }
  function paint() {
    const box = document.getElementById("sd-body");
    if (!box) return;
    hideTT();
    box.innerHTML = bodyHTML();
    const k = document.getElementById("sd-kpi");
    if (k) k.innerHTML = kpiHTML(C().state);
    const meta = document.getElementById("sd-meta");
    if (meta) meta.textContent = metaText();
    wire(box);
    if (window.SemisScreen) SemisScreen.paintDash();
  }
  async function refresh(force) {
    const btn = document.getElementById("sd-refresh");
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    await C().load(force ? { parts: PARTS, force: true } : { parts: PARTS });
    if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    paint();
  }
  let timer = 0, hooked = false;
  function ensureTimer() {
    if (!hooked && C() && C().onLoad) { hooked = true; C().onLoad(() => { if (route() === MOD) paint(); }); }
    if (timer || typeof setInterval === "undefined") return;
    timer = setInterval(() => {
      if (route() !== MOD || (typeof document !== "undefined" && document.hidden) || !document.getElementById("sd-body")) return;
      C().load({ parts: PARTS, force: ["live", "env"] });
    }, 300000);
  }
  const scrVisible = () => {
    const mn = SeMIS.menuForModule("scr-status");
    return !!(mn && SeMIS.navVisible(mn) && window.SemisScreen);
  };

  function render(root) {
    const s = C().state;
    const SP = window.SemisSecPost;
    root.innerHTML = ui.head({
      title: TITLE,
      meta: "인천화물터미널 B동",
      actions: `<span class="scr-meta" id="sd-meta">${esc(metaText())}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="sd-refresh" title="CARES 자료 새로고침">${icon("refresh", 16)}<span>새로고침</span></button>`
    }) + `<div id="sd-kpi">${kpiHTML(s)}</div>` +
      (scrVisible() ? SemisScreen.opsHTML() : "") +
      (SP ? SP.cardHTML() : "") +
      `<div id="sd-body">${bodyHTML()}</div>`;
    if (SP) SP.mount(root);
    if (window.SemisScreen && document.getElementById("sd-scr")) SemisScreen.mountDash();
    wire($("#sd-body", root));
    $("#sd-refresh", root).onclick = () => refresh(true);
    ensureTimer();
    C().load({ parts: PARTS });   // 새로 읽은 묶음이 있으면 onLoad 가 다시 그린다
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });
  window.SemisSecDash = { equipStats, monthly, weekly, inspect28, rate28, periodicLate, anomalies, envModel, niceTicks, lineChart, refresh, paint, charts };
})();
