/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 화물 보안검색 현황 (v1.12, 라우트 scr-status)
   인천화물터미널 B동 보안검색 현장의 "지금" — CARES 실시간 읽기 전용.

   화면 구성
   - 요약 띠: X-ray 가동 · ETD 가동 · 오늘 일일점검 · 진행 중 고장 · 환경 기준 초과
   - 검색 라인 배치: X-ray 1~3호기와 옆에 배치된 ETD(CARES equipments.location), 환적·예비 구역
   - 일일점검 이행: 장비 × 최근 28일 (점검 · 미점검 · 고장/수리) + 주간·월간 최근일
   - 검색 환경: 센서 3곳 × 지표 표 (CARES 기기별 임계치) + 지점 간 결로 판정
   - 최근 고장·수리 5건 → 검색장비 유지관리 › 고장·수리 이력
   대시보드에는 같은 데이터를 4칸 요약 띠(dashHTML · mountDash)로 보여 준다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, ui, icon } = SeMIS;
  const C = () => window.SemisCares;
  const MOD = "scr-status";
  const TITLE = "화물 보안검색 현황";
  const DAYS = 28;
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const route = () => (location.hash.replace(/^#\//, "") || "dashboard");
  const fmtN = (v, dec) => v == null ? "-" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

  /* ─────── 공통 조각 ─────── */
  function metaText(s) {
    if (s.loading && !s.ts) return "CARES 불러오는 중";
    if (s.err) return "CARES 연동 불가";
    return s.ts ? "CARES · " + C().hm(s.ts) + " 갱신" : "CARES";
  }
  const dot = (state) => `<i class="st-dot" data-state="${esc(state)}" aria-hidden="true"></i>`;
  function todayInsp(idx, u) {
    const o = idx[u.id];
    const logs = o && o.days[C().todayKey()];
    return logs && logs.length ? logs.slice().sort((a, b) => a.inspectedAtMs - b.inspectedAtMs)[0] : null;
  }
  function summary(s) {
    const K = C();
    const us = K.units();
    const idx = K.inspIndex();
    const xr = us.filter(u => u.kind === "xray"), etd = us.filter(u => u.kind === "etd");
    const done = us.filter(u => todayInsp(idx, u));
    const active = K.state.repairs.filter(r => K.repairStatus(r) !== "resolved");
    const rows = K.sensorRows();
    const over = rows.reduce((n, r) => n + r.over.length, 0);
    const lastIns = K.allInspections().filter(r => r.type === "daily" && K.dayKey(r.inspectedAtMs) === K.todayKey())
      .sort((a, b) => b.inspectedAtMs - a.inspectedAtMs)[0] || null;
    const year = K.todayKey().slice(0, 4);
    const yearN = K.state.repairs.filter(r => r.reportedAtMs && K.dayKey(r.reportedAtMs).slice(0, 4) === year).length;
    return { us, idx, xr, etd, done, active, rows, over, lastIns, yearN };
  }
  const placeOf = (u) => {
    if (u.kind === "etd" && u.lane) return "X-ray " + u.lane + "호기";
    return u.location || "위치 미지정";
  };
  function etdPlaces(etd) {
    const c = {};
    etd.forEach(u => { const k = u.lane ? "배치" : (u.location || "기타"); c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).sort((a, b) => (b === "배치") - (a === "배치") || (a === "예비") - (b === "예비")).map(k => k + " " + c[k]).join(" · ");
  }

  /* ─────── 요약 띠 ─────── */
  function statsHTML(m) {
    const K = C();
    const xrOk = m.xr.filter(u => u.state === "ok").length, etOk = m.etd.filter(u => u.state === "ok").length;
    return ui.stats([
      { label: "X-ray 가동", value: m.xr.length ? xrOk + "/" + m.xr.length : "-", sub: "정상 / 전체", tone: m.xr.length && xrOk < m.xr.length ? "bad" : "ok" },
      { label: "ETD 가동", value: m.etd.length ? etOk + "/" + m.etd.length : "-", sub: etdPlaces(m.etd) || "", tone: m.etd.length && etOk < m.etd.length ? "bad" : "ok" },
      { label: "오늘 일일점검", value: m.us.length ? m.done.length + "/" + m.us.length : "-",
        sub: m.lastIns ? "최근 " + K.hm(m.lastIns.inspectedAtMs) + " · " + (m.lastIns.inspector || "") : "기록 없음",
        tone: m.us.length && m.done.length === m.us.length ? "ok" : "muted" },
      { label: "진행 중 고장", value: m.active.length, sub: "올해 신고 " + m.yearN + "건", tone: m.active.length ? "bad" : "ok" },
      { label: "환경 기준 초과", value: m.over, sub: m.rows.filter(r => r.over.length).map(r => r.name).join(" · ") || "모든 지점 기준 이내", tone: m.over ? "warn" : "ok" }
    ]);
  }

  /* ─────── 검색 라인 배치 ─────── */
  function tileHTML(u, idx) {
    const K = C();
    const ins = todayInsp(idx, u);
    const act = u.active;
    const late = act ? K.fmtDur(Date.now() - (act.reportedAtMs || Date.now())) : "";
    return `<button type="button" class="unit-tile" data-kind="${esc(u.kind)}" data-state="${esc(u.state)}" data-unit="${esc(u.id)}"
        title="${esc([u.label, u.model, u.serial, K.stateLabel(u)].filter(Boolean).join(" · "))}">
      <span class="ut-ico">${icon(u.kind === "xray" ? "xray" : "etd", 21)}</span>
      <span class="ut-body">
        <span class="ut-name">${dot(u.state)}<b>${esc(u.label)}</b></span>
        <span class="ut-sub mono">${esc(u.serial || u.model || "")}</span>
        <span class="ut-foot">${act ? ui.chip(K.stateLabel(u) + " · " + late, K.stateTone(u)) : u.state !== "ok" ? ui.chip(K.stateLabel(u), K.stateTone(u)) : ""}
          <span class="ut-ins${ins ? " done" : ""}">${ins ? icon("check", 14) + '<span>점검 <b class="mono">' + esc(K.hm(ins.inspectedAtMs)) + "</b></span>" : "오늘 미점검"}</span></span>
      </span>
    </button>`;
  }
  function laneHTML(m) {
    const lanes = m.xr.slice().sort((a, b) => (a.no || 99) - (b.no || 99));
    const placed = {};
    const cols = lanes.map(x => {
      const etds = m.etd.filter(e => e.lane && e.lane === x.no);
      etds.forEach(e => { placed[e.id] = true; });
      const all = [x].concat(etds);
      const worst = all.some(u => u.state === "bad") ? "bad" : all.some(u => u.state === "warn") ? "warn" : "ok";
      return `<div class="lane" data-state="${worst}">
        <div class="lane-h"><span class="lane-no mono">${esc(x.no || "?")}</span><span>검색대</span></div>
        ${tileHTML(x, m.idx)}
        <div class="lane-link" aria-hidden="true"></div>
        ${etds.length ? etds.map(e => tileHTML(e, m.idx)).join("") : '<span class="lane-none">배치된 ETD 없음</span>'}
      </div>`;
    });
    const zones = {};
    m.etd.filter(e => !placed[e.id]).forEach(e => { const k = placeOf(e); (zones[k] = zones[k] || []).push(e); });
    const zKeys = Object.keys(zones).sort((a, b) => (a === "예비") - (b === "예비") || a.localeCompare(b, "ko"));
    const zoneCol = zKeys.length ? `<div class="lane lane-zone">${zKeys.map(k => `<div class="zone">
        <div class="lane-h"><span>${esc(k)}</span><span class="mono">${zones[k].length}</span></div>
        ${zones[k].map(e => tileHTML(e, m.idx)).join("")}</div>`).join("")}</div>` : "";
    return `<section class="card scr-lanes" aria-label="검색 라인 배치">
      <h2 class="card-title">검색 라인 배치<span class="spacer"></span><span class="dc-meta">CARES 장비 위치 기준</span></h2>
      ${lanes.length || zKeys.length ? `<div class="lane-board" style="--lanes:${Math.max(1, lanes.length)};--cols:${Math.max(1, lanes.length) + (zKeys.length ? 1 : 0)}">${cols.join("")}${zoneCol}</div>` : ui.empty("CARES에 등록된 검색장비가 없습니다.")}
    </section>`;
  }

  /* ─────── 일일점검 이행 (장비 × 최근 28일) ─────── */
  function heatHTML(m) {
    const K = C();
    if (!K.has("history")) return `<section class="card scr-heat" aria-label="일일점검 이행"><h2 class="card-title">일일점검 이행</h2>
      <div class="scr-wait" role="status"><span class="cfe-spin" aria-hidden="true"></span>최근 점검 기록을 불러오는 중입니다.</div></section>`;
    const days = K.lastDays(DAYS);
    const today = K.todayKey();
    const from = K.dayStartMs(days[0]), to = Date.now();
    const wd = (k) => new Date(k + "T12:00:00Z").getUTCDay();
    const head = days.map((k, i) => {
      const w = wd(k);
      const mid = i === DAYS / 2;   // 좁은 화면(14일)에서 첫 칸
      const first = i === 0 || mid || k.slice(8) === "01";
      const show = k === today || first || w === 1;
      const lb = k === today ? "오늘" : first ? Number(k.slice(5, 7)) + "." + Number(k.slice(8)) : String(Number(k.slice(8)));
      return `<span class="hc-h${k === today ? " today" : ""}${w === 0 || w === 6 ? " we" : ""}${mid && k.slice(8) !== "01" ? " hc-mid" : ""}${w === 1 && !first && k !== today ? " wk" : ""}"${mid && w === 1 ? ' data-d="' + esc(String(Number(k.slice(8)))) + '"' : ""}>${show ? esc(lb) : ""}</span>`;
    }).join("");
    const rows = m.us.map(u => {
      const o = m.idx[u.id] || { days: {}, last: {} };
      const down = K.downDays(u.id, from, to);
      let done = 0;
      const cells = days.map(k => {
        const logs = o.days[k] || [];
        const isDown = !!down[k];
        const st = logs.length ? "done" : isDown ? "down" : k === today ? "wait" : "miss";
        if (logs.length) done++;
        const d = new Date(k + "T12:00:00Z");
        const bad = logs.reduce((n, r) => n + K.badCount(r), 0);
        const tip = K.mdk(k) + " (" + WEEK[d.getUTCDay()] + ") " + (logs.length
          ? "점검 " + logs.map(r => K.hm(r.inspectedAtMs) + " " + (r.inspector || "")).join(", ") + (bad ? " · 불량 " + bad : "") + (isDown ? " · 고장·수리 중" : "")
          : isDown ? "고장·수리 중 · 미점검" : k === today ? "아직 점검 전" : "미점검");
        return `<i class="hc" data-st="${st}"${bad ? ' data-bad="1"' : ""} title="${esc(tip)}"></i>`;
      }).join("");
      const rate = Math.round(done / DAYS * 100);
      /* 정기점검 최근일 — 주기(주간 7일 · 월간 31일)를 넘기면 경과 표시 */
      const CYCLE = { weekly: 7, monthly: 31 };
      const last = (t) => {
        const r = o.last[t];
        if (!r) return '<span class="heat-last mono" title="기록 없음">-</span>';
        const gap = Math.round((K.dayStartMs(today) - K.dayStartMs(K.dayKey(r.inspectedAtMs))) / 86400000);
        const late = gap > CYCLE[t];
        return `<span class="heat-last mono${late ? " late" : ""}" title="${esc((t === "weekly" ? "주간" : "월간") + " 점검 " + K.mdk(K.dayKey(r.inspectedAtMs)) + " · " + gap + "일 경과" + (r.inspector ? " · " + r.inspector : ""))}">${esc(K.mdk(K.dayKey(r.inspectedAtMs)))}</span>`;
      };
      return `<div class="heat-row">
        <span class="heat-lb"><b>${esc(u.label)}</b><small class="mono">${esc(u.serial)}</small></span>
        <span class="heat-cells">${cells}</span>
        <span class="heat-rate mono${rate < 80 ? " low" : ""}">${rate}%</span>
        ${last("weekly")}
        ${last("monthly")}
      </div>`;
    }).join("");
    return `<section class="card scr-heat" aria-label="일일점검 이행">
      <h2 class="card-title">일일점검 이행<span class="dc-meta"><span class="hl-long">최근 ${DAYS}일</span><span class="hl-short">최근 ${DAYS / 2}일</span></span><span class="spacer"></span>
        <span class="heat-legend"><span><i class="hc" data-st="done"></i>점검</span><span><i class="hc" data-st="miss"></i>미점검</span><span><i class="hc" data-st="down"></i>고장·수리</span></span></h2>
      ${m.us.length ? `<div class="heat-wrap"><div class="heat">
        <div class="heat-row heat-head"><span class="heat-lb"></span><span class="heat-cells">${head}</span>
          <span class="heat-rate">이행</span><span class="heat-last">주간</span><span class="heat-last">월간</span></div>
        ${rows}</div></div>` : ui.empty("점검 기록이 없습니다.")}
    </section>`;
  }

  /* ─────── 검색 환경 (지점 × 지표) ─────── */
  function envHTML(m) {
    const K = C();
    const rows = m.rows;
    if (!rows.length) return `<section class="card scr-env"><h2 class="card-title">검색 환경</h2>${ui.empty("센서 수신값이 없습니다.")}</section>`;
    const cond = K.condensation(rows);
    const thTxt = (id, key) => {
      const th = K.thFor(id, key);
      return th.min != null && th.max != null ? th.min + "~" + th.max : th.max != null ? "≤ " + th.max : th.min != null ? "≥ " + th.min : "기준 없음";
    };
    const body = K.METRICS.map(mt => `<tr><th scope="row">${esc(mt.label)}<small>${esc(mt.unit)}</small></th>
      ${rows.map(r => {
        if (r.offline) return '<td class="env-off">—</td>';
        const v = r.vals[mt.key];
        const over = r.over.indexOf(mt.key) >= 0;
        return `<td class="mono${over ? " over" : ""}" title="${esc(r.name + " " + mt.label + " 기준 " + thTxt(r.id, mt.key))}">${esc(fmtN(v, mt.dec))}${over ? '<span class="sr-only"> 기준 초과</span>' : ""}</td>`;
      }).join("")}</tr>`).join("");
    const LV = { safe: ["결로 위험 낮음", "green"], watch: ["결로 주의", "amber"], danger: ["결로 발생 조건", "red"], unknown: ["판정 불가", "gray"] };
    return `<section class="card scr-env" aria-label="검색 환경">
      <h2 class="card-title">검색 환경<span class="spacer"></span><span class="dc-meta">센서 3분 주기</span></h2>
      <div class="table-wrap"><table class="tbl env-tbl">
        <thead><tr><th></th>${rows.map(r => `<th scope="col"><span class="env-h">${dot(r.offline ? "off" : r.over.length ? "warn" : "ok")}${esc(r.name)}</span>
          <small>${r.offline ? "오프라인" : esc(K.hm(r.at) + " 수신")}</small></th>`).join("")}</tr></thead>
        <tbody>${body}</tbody></table></div>
      <div class="env-cond" data-level="${esc(cond.level)}"><div class="ec-top">${ui.chip(LV[cond.level][0], LV[cond.level][1])}
        ${cond.margin != null ? `<b class="mono">여유 ${esc(fmtN(cond.margin, 1))}℃</b>` : ""}<span class="spacer"></span>${ui.tip("가장 습한 지점의 이슬점과 가장 차가운 지점의 온도를 비교합니다. 습한 공기가 차가운 장비 표면(X-ray 터널 내벽·검출기)에 닿으면 결로가 생기므로 여유가 3℃ 이하이면 주의, 0℃ 이하이면 결로 발생 조건입니다. 임계치는 CARES 기기별 설정값입니다.", "결로 판정 기준")}</div>
        <p>${esc(cond.text)}</p></div>
    </section>`;
  }

  /* ─────── 최근 고장·수리 ─────── */
  function faultsHTML(m) {
    const K = C();
    if (!K.has("repairs")) return `<section class="card scr-faults" aria-label="최근 고장·수리"><h2 class="card-title">최근 고장·수리</h2>
      <div class="scr-wait" role="status"><span class="cfe-spin" aria-hidden="true"></span>고장 기록을 불러오는 중입니다.</div></section>`;
    const list = K.state.repairs.slice().sort((a, b) => (b.reportedAtMs || 0) - (a.reportedAtMs || 0)).slice(0, 5);
    return `<section class="card scr-faults" aria-label="최근 고장·수리">
      <h2 class="card-title">최근 고장·수리<span class="spacer"></span><button type="button" class="link-btn" data-go-equip="repairs">전체 이력</button></h2>
      ${list.length ? `<div class="flt-list">${list.map(r => {
        const u = K.unitById(r.equipmentId);
        const rs = K.repairStatus(r);
        const cz = K.CAUSE[r.causeCategory];
        const dur = r.resolvedAtMs ? K.fmtDur(r.resolvedAtMs - r.reportedAtMs) : K.fmtDur(Date.now() - r.reportedAtMs) + " 경과";
        return `<button type="button" class="flt-row" data-repair="${esc(r.id)}">
          <span class="flt-d mono">${esc(K.mdk(K.dayKey(r.reportedAtMs)))}</span>
          <span class="flt-b"><b>${esc(u ? u.label : (r.equipmentName || "장비"))}</b><span class="flt-s">${esc(r.symptom || "-")}</span></span>
          <span class="flt-m">${cz ? ui.chip(cz.label, cz.tone) : ""}${ui.chip(K.RS_META[rs].label, K.RS_META[rs].tone)}<small class="mono">${esc(dur)}</small></span>
        </button>`;
      }).join("")}</div>` : ui.empty("고장 기록이 없습니다.")}
    </section>`;
  }

  function bodyHTML(s) {
    if (!s.ts && !s.err) return `<div class="scr-wait" role="status"><span class="cfe-spin" aria-hidden="true"></span>CARES에서 장비·점검·센서 정보를 불러오는 중입니다.</div>`;
    if (s.err && !s.equips.length) return `<section class="card">${ui.empty("CARES에 연결하지 못했습니다. (" + s.err + ")",
      '<button type="button" class="btn btn-ghost btn-sm" data-scr-retry>다시 시도</button>')}</section>`;
    const m = summary(s);
    return statsHTML(m) + laneHTML(m) + `<div class="scr-grid">${envHTML(m)}${faultsHTML(m)}</div>` + heatHTML(m);
  }

  /* ─────── 조작 연결 ─────── */
  function goEquip(tab, opts) {
    if (window.SemisEquip) SemisEquip.setTab(tab || "list", opts);
    SeMIS.navigate("scr-equip");
  }
  function wire(root) {
    $$("[data-unit]", root).forEach(b => b.onclick = () => {
      if (window.SemisEquip && SemisEquip.openUnit) SemisEquip.openUnit(b.dataset.unit);
    });
    $$("[data-repair]", root).forEach(b => b.onclick = () => {
      if (window.SemisEquip && SemisEquip.openRepair) SemisEquip.openRepair(b.dataset.repair);
    });
    $$("[data-go-equip]", root).forEach(b => b.onclick = () => goEquip(b.dataset.goEquip));
    const rt = $("[data-scr-retry]", root);
    if (rt) rt.onclick = () => refresh(true);
  }
  function paint() {
    const box = document.getElementById("scr-body");
    if (!box) return;
    const s = C().state;
    box.innerHTML = bodyHTML(s);
    const meta = document.getElementById("scr-meta");
    if (meta) meta.textContent = metaText(s);
    wire(box);
  }
  async function refresh(force) {
    const btn = document.getElementById("scr-refresh");
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    const onStatus = !!document.getElementById("scr-body");
    const parts = onStatus ? undefined : DASH_PARTS;
    await C().load(force ? { parts, force: true } : { parts });
    if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    paint(); paintDash();
  }

  /* 5분마다 새로 읽기 — 보안검색 현황 · 대시보드를 보고 있을 때만(다른 탭·화면에서는 쉰다).
     장비·센서·오늘 점검(live)만 강제로 다시 읽고, 고장 기록은 10분 유효기간이 지났을 때만. */
  const DASH_PARTS = ["live", "repairs"];
  let timer = 0;
  function ensureTimer() {
    if (timer || typeof setInterval === "undefined") return;
    timer = setInterval(() => {
      const r = route();
      if ((r !== MOD && r !== "dashboard") || (typeof document !== "undefined" && document.hidden)) return;
      if (!document.getElementById("scr-body") && !document.getElementById("dash-scr")) return;
      C().load({ parts: DASH_PARTS, force: ["live"] }).then(() => { paint(); paintDash(); });
    }, 300000);
  }

  function render(root) {
    const s = C().state;
    root.innerHTML = ui.head({
      title: TITLE,
      meta: "인천화물터미널 B동",
      actions: `<span class="scr-meta" id="scr-meta">${esc(metaText(s))}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="scr-refresh" title="CARES에서 다시 읽기">${icon("refresh", 16)}<span>새로고침</span></button>`
    }) + `<div id="scr-body">${bodyHTML(s)}</div>`;
    wire(root);
    $("#scr-refresh", root).onclick = () => refresh(true);
    const v = s.ver;
    C().load().then(st2 => { if (st2.ver !== v) paint(); });
    ensureTimer();
  }

  /* ═════════ 대시보드 요약 띠 ═════════ */
  function monthBars() {
    const K = C();
    const now = K.todayKey();
    const y = Number(now.slice(0, 4)), mo = Number(now.slice(5, 7));
    const out = [];
    for (let i = 5; i >= 0; i--) {
      let yy = y, mm = mo - i;
      while (mm <= 0) { mm += 12; yy--; }
      const key = yy + "-" + String(mm).padStart(2, "0");
      out.push({ key, label: mm + "월", n: K.state.repairs.filter(r => r.reportedAtMs && K.dayKey(r.reportedAtMs).slice(0, 7) === key).length });
    }
    return out;
  }
  function dashInner(s) {
    const K = C();
    if (!s.ts && !s.err) return `<div class="dscr-cells is-wait" aria-hidden="true">${"<div class=\"dscr-cell\"><i class=\"sk\"></i><i class=\"sk sk-2\"></i></div>".repeat(4)}</div>`;
    if (s.err && !s.equips.length) return `<div class="dscr-err">CARES에 연결하지 못했습니다.<button type="button" class="link-btn" data-dscr-retry>다시 시도</button></div>`;
    const m = summary(s);
    const lanes = m.xr.slice().sort((a, b) => (a.no || 99) - (b.no || 99));
    const placed = {};
    const laneRows = lanes.map(x => {
      const es = m.etd.filter(e => e.lane === x.no);
      es.forEach(e => { placed[e.id] = true; });
      return `<div class="ml-row"><span class="ml-x" data-state="${esc(x.state)}" title="${esc(x.label + " " + K.stateLabel(x))}">${esc(x.short)}</span>
        <i class="ml-link" aria-hidden="true"></i>${es.map(e => `<span class="ml-e" data-state="${esc(e.state)}" title="${esc(e.label + " " + K.stateLabel(e))}">${esc(e.short)}</span>`).join("") || '<span class="ml-none">—</span>'}</div>`;
    }).join("");
    const rest = m.etd.filter(e => !placed[e.id]);
    const restTxt = rest.map(e => `<span class="ml-e" data-state="${esc(e.state)}" title="${esc(e.label + " · " + placeOf(e))}">${esc(e.short)}</span><small>${esc(placeOf(e))}</small>`).join("");
    const bars = monthBars();
    const bmax = Math.max(1, ...bars.map(b => b.n));
    const lastR = K.state.repairs.slice().sort((a, b) => (b.reportedAtMs || 0) - (a.reportedAtMs || 0))[0];
    const lastU = lastR ? K.unitById(lastR.equipmentId) : null;
    const cond = K.condensation(m.rows);
    return `<div class="dscr-cells">
      <button type="button" class="dscr-cell" data-dgo="scr-status" aria-label="검색 라인 배치 보기">
        <span class="dscr-h">검색 라인</span>
        <span class="ml">${laneRows}${rest.length ? `<span class="ml-rest">${restTxt}</span>` : ""}</span>
      </button>
      <button type="button" class="dscr-cell" data-dgo="scr-status" aria-label="일일점검 현황 보기">
        <span class="dscr-h">오늘 일일점검</span>
        <span class="dscr-n mono"><b>${m.done.length}</b>/${m.us.length}</span>
        <span class="ins-dots">${m.us.map(u => `<span class="ins-dot${todayInsp(m.idx, u) ? " on" : ""}" title="${esc(u.label + (todayInsp(m.idx, u) ? " 점검 완료" : " 미점검"))}">${esc(u.short)}</span>`).join("")}</span>
        <span class="dscr-sub">${m.lastIns ? "최근 " + esc(K.hm(m.lastIns.inspectedAtMs) + " · " + (m.lastIns.inspector || "")) : "오늘 기록 없음"}</span>
      </button>
      <button type="button" class="dscr-cell" data-dgo="scr-equip" data-dtab="repairs" aria-label="고장·수리 이력 보기">
        <span class="dscr-h">장비 고장<span class="dscr-hm">최근 6개월</span></span>
        <span class="mb" role="img" aria-label="${esc("월별 고장 신고 " + bars.map(b => b.label + " " + b.n + "건").join(", "))}">${bars.map(b => `<span class="mb-c" title="${esc(b.label + " " + b.n + "건")}">
          <span class="mb-v mono">${b.n || ""}</span><span class="mb-bar"><i style="height:${Math.round(b.n / bmax * 100)}%"></i></span><span class="mb-l">${esc(b.label)}</span></span>`).join("")}</span>
        <span class="dscr-sub">${m.active.length ? `<b class="bad">진행 중 ${m.active.length}건</b>` : "진행 중 없음"}${lastR ? " · 최근 " + esc(K.mdk(K.dayKey(lastR.reportedAtMs)) + " " + (lastU ? lastU.label : (lastR.equipmentName || ""))) : ""}</span>
      </button>
      <button type="button" class="dscr-cell" data-dgo="scr-status" aria-label="검색 환경 보기">
        <span class="dscr-h">검색 환경</span>
        <span class="env-mini">${m.rows.map(r => `<span class="em-row">${dot(r.offline ? "off" : r.over.length ? "warn" : "ok")}<span class="em-n">${esc(r.name)}</span>
          <span class="em-v mono">${r.offline ? "오프라인" : esc(fmtN(r.vals.temp, 1) + "℃ · " + fmtN(r.vals.humidity, 0) + "%")}</span></span>`).join("")}</span>
        <span class="dscr-sub">${cond.level === "danger" ? '<b class="bad">결로 발생 조건</b> · ' : cond.level === "watch" ? '<b class="warn">결로 주의</b> · ' : ""}${cond.margin != null ? "결로 여유 " + esc(fmtN(cond.margin, 1)) + "℃" : "결로 판정 불가"}${m.over ? ` · <b class="warn">기준 초과 ${m.over}</b>` : ""}</span>
      </button>
    </div>`;
  }
  function dashHTML() {
    const s = C().state;
    return `<section class="dash-scr" id="dash-scr" aria-label="화물 보안검색">
      <div class="dc-head"><h2>화물 보안검색</h2><span class="dc-meta" id="dscr-meta">${esc(metaText(s))}</span>
        <span class="spacer"></span><button type="button" class="link-btn" data-dgo="scr-status">현황</button><button type="button" class="link-btn" data-dgo="scr-equip">검색장비</button></div>
      <div id="dscr-body">${dashInner(s)}</div>
    </section>`;
  }
  function wireDash(box) {
    $$("[data-dgo]", box).forEach(b => b.onclick = () => {
      if (b.dataset.dgo === "scr-equip") goEquip(b.dataset.dtab || "list");
      else SeMIS.navigate(b.dataset.dgo);
    });
    const rt = $("[data-dscr-retry]", box);
    if (rt) rt.onclick = () => refresh(true);
  }
  function paintDash() {
    const box = document.getElementById("dash-scr");
    if (!box) return;
    const s = C().state;
    $("#dscr-body", box).innerHTML = dashInner(s);
    $("#dscr-meta", box).textContent = metaText(s);
    wireDash(box);
  }
  function mountDash() {
    const box = document.getElementById("dash-scr");
    if (!box) return;
    wireDash(box);
    const v = C().state.ver;
    C().load({ parts: DASH_PARTS }).then(st2 => { if (st2.ver !== v) paintDash(); });
    ensureTimer();
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });
  window.SemisScreen = { dashHTML, mountDash, paintDash, summary, monthBars, refresh };
})();
