/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 검색장비 유지관리 (v1.12, 라우트 scr-equip)
   SeMIS v2 equipment.js 이식 — 인천화물터미널 B동 보안검색장비 대장 + CARES 실시간 연동.

   탭
   - 장비 대장: 대장(DATA.equipment) + CARES 상태·배치·고장 건수(S/N 매칭) + 내용연수
   - 고장·수리 이력: CARES repairLogs (연도·유형·검색) → 상세(처리 단계·원인·부품·사진)
   - 가동 분석: 장비별 가동률(정상 가동일 ÷ 기간 일수) · 다운타임 · 평균 복구 · 원인 분류

   데이터
   - DATA.equipment = [{ id, type, name, serial, location, vendor, installed, mfgDate, lifeYears,
       replaceDue, price, cert, status, logs[{id,date,kind,text,by}], note }]  (v2 스키마 그대로)
     2026-09-22 SeMIS v2 대장 22대를 복사(이후 두 시스템은 따로 관리)
   - 장비 상태·고장·점검의 마스터는 CARES — 여기서는 읽기만(수정은 CARES에서)
   - 구입가는 대외비(canConfid) — hq 이상만 보이고 입력
   v2에서 옮기지 않은 것: 유지보수 계약·비용 기록·대금 청구(항공보안파트 업무)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const C = () => window.SemisCares;
  const D = () => SeMIS.data;
  const MOD = "scr-equip";
  const TITLE = "검색장비 유지관리";
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const todayISO = () => C().todayKey();

  const TYPES = ["X-Ray", "ETD(폭발물흔적)", "WTMD(문형)", "HHMD(휴대용)", "CCTV", "기타"];
  const TYPE_LIFE = { "X-Ray": 10, "ETD(폭발물흔적)": 5, "WTMD(문형)": 10, "HHMD(휴대용)": 4, "CCTV": 0, "기타": 0 };
  const STATUSES = ["정상", "점검필요", "고장", "수리중", "폐기"];
  const ST_TONE = { "정상": "green", "주의": "amber", "점검필요": "amber", "고장": "red", "수리중": "blue", "폐기": "gray" };
  const LOG_KINDS = ["점검", "고장", "수리", "기타"];
  const LOG_TONE = { "점검": "blue", "고장": "red", "수리": "green", "기타": "gray" };
  const KIND_FILTERS = [["all", "전체"], ["xray", "X-ray"], ["etd", "ETD"], ["wtmd", "WTMD"], ["hhmd", "HHMD"]];
  const ST_FILTERS = [["all", "전체"], ["due", "내용연수 임박"], ["broken", "고장·수리 중"], ["disposed", "폐기"]];
  const CAUSE_COLOR = { environmental: "#0d9488", mechanical: "#8b3fd0", human: "#d97706", other: "#9aa6aa" };
  const ETD_TARGET = 0.9;

  const list = () => (Array.isArray(D().equipment) ? D().equipment : []);
  const kindOfLedger = (x) => C().kindOf(x && x.type);

  /* ─────── 내용연수 (v2 규칙) ─────── */
  function addMonths(dateStr, months) {
    if (!dateStr || !months) return "";
    const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7)), day = Number(dateStr.slice(8, 10));
    const t = new Date(Date.UTC(y, m - 1 + Number(months), 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return t.toISOString().slice(0, 10);
  }
  const daysLeft = (d) => d ? Math.round((new Date(d) - new Date(todayISO())) / 86400000) : null;
  const lifeBase = (x) => x.mfgDate || x.installed || "";
  const lifeYearsOf = (x) => (x.lifeYears != null && x.lifeYears !== "") ? Number(x.lifeYears) : (TYPE_LIFE[x.type] || 0);
  function replaceDue(x) {
    if (x.replaceDue) return x.replaceDue;
    const b = lifeBase(x), y = lifeYearsOf(x);
    return b && y ? addMonths(b, y * 12) : "";
  }
  const isLifeDue = (x) => x.status !== "폐기" && !!replaceDue(x) && daysLeft(replaceDue(x)) <= 365;
  function lifeChip(x) {
    if (x.status === "폐기") return "";
    const r = replaceDue(x);
    if (!r) return ui.chip("미지정", "gray");
    const d = daysLeft(r);
    if (d < 0) return ui.chip("만료 D+" + (-d), "red");
    if (d <= 365) return ui.chip("교체 D-" + d, "amber");
    return ui.chip("잔여 " + (d / 365).toFixed(1) + "년", "gray");
  }

  /* ─────── CARES 연결 (S/N) ─────── */
  function unitOf(x) {
    const k = C().normSN(x && x.serial);
    return k ? (C().units().find(u => C().normSN(u.serial) === k) || null) : null;
  }
  function effStatus(x) {
    if (x.status === "폐기") return "폐기";
    const u = unitOf(x);
    if (!u) return x.status || "정상";
    if (u.active) return C().repairStatus(u.active) === "in_repair" ? "수리중" : "고장";
    return u.state === "bad" ? "고장" : u.state === "warn" ? "주의" : "정상";
  }
  const repairsOf = (unitId) => C().state.repairs.filter(r => r.equipmentId === unitId)
    .sort((a, b) => (b.reportedAtMs || 0) - (a.reportedAtMs || 0));
  function caresOnly() {
    const sns = {};
    list().forEach(x => { const k = C().normSN(x.serial); if (k) sns[k] = true; });
    return C().units().filter(u => !sns[C().normSN(u.serial)]);
  }

  /* ─────── 화면 상태 ─────── */
  let tab = "list", query = "", kindF = "all", stF = "all";
  let rYear = "", rKind = "all", rQuery = "";
  let aYear = 0;

  function filtered() {
    const q = query.toLowerCase();
    return list().filter(x => {
      const k = kindOfLedger(x);
      if (kindF !== "all" && k !== kindF) return false;
      const st = effStatus(x);
      if (stF === "due" && !isLifeDue(x)) return false;
      if (stF === "broken" && st !== "고장" && st !== "수리중") return false;
      if (stF === "disposed" && st !== "폐기") return false;
      if (!q) return true;
      const u = unitOf(x);
      return [x.type, x.name, x.serial, x.location, x.vendor, x.note, x.cert, u && u.location]
        .some(v => String(v || "").toLowerCase().indexOf(q) >= 0);
    }).sort((a, b) => {
      const order = { xray: 0, etd: 1, wtmd: 2, hhmd: 3, etc: 4 };
      const oa = order[kindOfLedger(a)], ob = order[kindOfLedger(b)];
      if (oa !== ob) return oa - ob;
      const da = a.status === "폐기" ? 1 : 0, db = b.status === "폐기" ? 1 : 0;
      if (da !== db) return da - db;
      return String(a.name).localeCompare(String(b.name), "ko", { numeric: true }) || String(a.serial).localeCompare(String(b.serial));
    });
  }
  function ledgerStats() {
    const l = list().filter(x => x.status !== "폐기");
    const broken = l.filter(x => { const s = effStatus(x); return s === "고장" || s === "수리중"; }).length;
    const linked = l.filter(x => unitOf(x)).length;
    return { total: l.length, ok: l.filter(x => effStatus(x) === "정상" && !isLifeDue(x)).length,
      due: l.filter(isLifeDue).length, broken, linked };
  }

  const segHTML = (name, items, cur) => `<div class="seg" role="group" aria-label="${esc(name)}">${items.map(([v, lb]) =>
    `<button type="button" class="seg-btn" data-seg="${esc(name)}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(lb)}</button>`).join("")}</div>`;

  /* ═════════ 장비 대장 ═════════ */
  function ledgerHTML() {
    const s = ledgerStats();
    const items = filtered();
    const extras = kindF === "all" && stF === "all" && !query ? caresOnly() : [];
    let lastKind = null;
    const counts = {};
    items.forEach(x => { const k = kindOfLedger(x); counts[k] = (counts[k] || 0) + 1; });
    const rows = items.map(x => {
      const k = kindOfLedger(x);
      const u = unitOf(x);
      const st = effStatus(x);
      const nRep = u ? repairsOf(u.id).length : 0;
      const place = !u ? "" : u.kind === "etd" ? (u.lane ? "X-ray " + u.lane + "호기 옆 배치" : u.location) : u.kind === "xray" ? (u.no ? "검색대 " + u.no : "") : u.location;
      const grp = k !== lastKind ? `<tr class="grp-row"><td colspan="7"><b>${esc(C().KIND_LABEL[k] || "기타")}</b> <span class="mono">${counts[k]}</span></td></tr>` : "";
      lastKind = k;
      return grp + `<tr data-eq="${esc(x.id)}" class="${x.status === "폐기" ? "is-disposed" : ""}" tabindex="0">
        <td class="c-name"><button type="button" class="tbl-open" data-eq-open="${esc(x.id)}">${esc(x.name)}</button>${u ? ' <span class="badge badge-blue" title="CARES 연동 (S/N 일치)">CARES</span>' : ""}
          ${place ? `<div class="cell-sub">${esc(place)}</div>` : ""}</td>
        <td class="mono cell-sn c-sn">${esc(x.serial || "-")}</td>
        <td class="col-ext c-ven">${esc(x.vendor || "-")}</td>
        <td class="mono c-base">${esc(lifeBase(x) || "-")}</td>
        <td class="c-life">${lifeChip(x)}${lifeYearsOf(x) ? `<div class="cell-sub mono">${lifeYearsOf(x)}년 · ${esc(replaceDue(x))}</div>` : ""}</td>
        <td class="c-rep">${nRep ? `<span class="cell-n mono"><span class="m-only">고장 </span>${nRep}건</span>` : '<span class="cell-sub">-</span>'}${(x.logs || []).length ? `<div class="cell-sub">메모 ${(x.logs || []).length}</div>` : ""}</td>
        <td class="c-st">${ui.chip(st, ST_TONE[st] || "gray")}</td>
      </tr>`;
    }).join("");
    const extraRows = extras.map(u => `<tr data-cares-only="${esc(u.id)}" tabindex="0" class="is-extra">
        <td class="c-name"><button type="button" class="tbl-open" data-cares-open="${esc(u.id)}">${esc(u.label)}</button> <span class="badge badge-amber">대장 미등록</span>
          <div class="cell-sub">${esc(u.location || "")}</div></td>
        <td class="mono cell-sn c-sn">${esc(u.serial || "-")}</td><td class="col-ext c-ven">-</td><td class="c-base">-</td><td class="c-life">-</td>
        <td class="c-rep">${repairsOf(u.id).length ? `<span class="cell-n mono"><span class="m-only">고장 </span>${repairsOf(u.id).length}건</span>` : "-"}</td>
        <td class="c-st">${ui.chip(C().stateLabel(u), C().stateTone(u))}</td></tr>`).join("");
    return ui.stats([
      { label: "운용 장비", value: s.total, sub: "폐기 제외" },
      { label: "정상", value: s.ok, sub: "내용연수 이내", tone: "ok" },
      { label: "내용연수 임박", value: s.due, sub: "1년 이내 · 만료", tone: s.due ? "warn" : "muted" },
      { label: "고장 · 수리 중", value: s.broken, sub: "CARES 상태", tone: s.broken ? "bad" : "ok" },
      { label: "CARES 연동", value: s.linked + "/" + s.total, sub: "S/N 일치 장비" }
    ]) + `<section class="card">
      <div class="toolbar">
        ${ui.search("eq-q", "장비명 · S/N · 업체 · 배치 검색", query)}
        ${segHTML("kind", KIND_FILTERS, kindF)}
        ${segHTML("st", ST_FILTERS, stF)}
      </div>
      ${rows || extraRows ? `<div class="table-wrap"><table class="tbl tbl-cap eq-tbl" style="--cap:1320px">
        <thead><tr><th>장비명<span class="th-hint"> · 배치</span></th><th>S/N</th><th class="col-ext">제작 · 유지보수</th><th>기산일</th><th>내용연수</th><th>고장 이력</th><th>상태</th></tr></thead>
        <tbody>${rows}${extraRows}</tbody></table></div>`
      : ui.empty(query || kindF !== "all" || stF !== "all" ? "조건에 맞는 장비가 없습니다." : "등록된 장비가 없습니다.")}
    </section>`;
  }

  /* 장비 상세 (전 권한) */
  function eqDetail(id) {
    const x = list().find(e => e.id === id);
    if (!x) return;
    const K = C();
    const u = unitOf(x);
    const st = effStatus(x);
    const conf = SeMIS.canConfid();
    const row = (k, v) => v ? `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>` : "";
    const reps = u ? repairsOf(u.id) : [];
    const insp = u ? K.allInspections().filter(r => r.equipmentId === u.id).slice(0, 8) : [];
    openModal(`
      <h3 class="eqd-title">${esc(x.name)} ${ui.chip(st, ST_TONE[st] || "gray")}${u ? ' <span class="badge badge-blue">CARES 연동</span>' : ""}</h3>
      <dl class="eqd-grid">
        ${row("유형", esc(x.type || "-"))}
        ${row("S/N", `<span class="mono">${esc(x.serial || "-")}</span>`)}
        ${row("배치 (CARES)", u ? esc(u.kind === "etd" && u.lane ? "X-ray " + u.lane + "호기 옆" : u.location || "-") : "")}
        ${row("설치 위치", esc(x.location || "-"))}
        ${row("제작 · 유지보수", esc(x.vendor || "-"))}
        ${row("제조 · 설치", `<span class="mono">${esc(x.mfgDate || "-")} · ${esc(x.installed || "-")}</span>`)}
        ${row("내용연수", `${lifeYearsOf(x) || "-"}년 · <span class="mono">${esc(replaceDue(x) || "-")}</span> ${lifeChip(x)}`)}
        ${conf && x.price != null && x.price !== "" ? row("구입가", `<span class="mono">${esc(Number(x.price).toLocaleString("ko-KR"))}</span>원`) : ""}
        ${row("인증", esc(x.cert || ""))}
        ${row("비고", esc(x.note || ""))}
      </dl>
      ${u ? `<div class="eqd-sec"><h4>고장 · 수리 <span class="mono">${reps.length}</span></h4>
        ${reps.length ? `<div class="flt-list">${reps.slice(0, 8).map(r => repairRow(r)).join("")}</div>` : '<p class="eqd-none">고장 기록이 없습니다.</p>'}</div>
      <div class="eqd-sec"><h4>최근 점검 <small>최근 45일</small></h4>
        ${insp.length ? `<div class="ins-list">${insp.map(r => {
          const bad = K.badCount(r), cau = K.cautionCount(r);
          return `<div class="ins-row"><span class="mono">${esc(K.fmtMs(r.inspectedAtMs))}</span>${ui.chip(K.INS_TYPE[r.type] || r.type || "점검", "blue")}
            <span class="ins-who">${esc(r.inspector || "-")}</span>${ui.chip(bad ? "불량 " + bad : cau ? "주의 " + cau : "양호", bad ? "red" : cau ? "amber" : "green")}
            ${r.remark ? `<span class="ins-rm">${esc(r.remark)}</span>` : ""}</div>`;
        }).join("")}</div>` : '<p class="eqd-none">최근 45일 점검 기록이 없습니다.</p>'}</div>` : ""}
      ${(x.logs || []).length ? `<div class="eqd-sec"><h4>자체 기록</h4><div class="ins-list">${x.logs.map(l =>
        `<div class="ins-row"><span class="mono">${esc(l.date || "-")}</span>${ui.chip(l.kind || "기타", LOG_TONE[l.kind] || "gray")}<span class="ins-rm">${esc(l.text || "")}</span>${l.by ? `<span class="ins-who">${esc(l.by)}</span>` : ""}</div>`).join("")}</div></div>` : ""}
      <div class="modal-actions">
        <a class="btn btn-ghost" href="${esc(C().CARES_URL)}" target="_blank" rel="noopener" style="margin-right:auto">${icon("external", 16)}<span>CARES</span></a>
        ${SeMIS.canEdit() ? '<button type="button" class="btn btn-ghost" id="eqd-edit">수정</button>' : ""}
        <button type="button" class="btn btn-primary" id="eqd-close">닫기</button>
      </div>`, { wide: true });
    $("#eqd-close").onclick = closeModal;
    if ($("#eqd-edit")) $("#eqd-edit").onclick = () => eqForm(x.id);
    $$("#modal-box [data-repair]").forEach(b => b.onclick = () => repairDetail(b.dataset.repair, () => eqDetail(x.id)));
  }
  function caresOnlyDetail(unitId) {
    const u = C().unitById(unitId);
    if (!u) return;
    const reps = repairsOf(u.id);
    openModal(`
      <h3 class="eqd-title">${esc(u.label)} ${ui.chip(C().stateLabel(u), C().stateTone(u))} <span class="badge badge-amber">대장 미등록</span></h3>
      <dl class="eqd-grid">
        <div><dt>유형</dt><dd>${esc(C().KIND_LABEL[u.kind] || "-")}</dd></div>
        <div><dt>S/N</dt><dd class="mono">${esc(u.serial || "-")}</dd></div>
        <div><dt>배치 (CARES)</dt><dd>${esc(u.location || "-")}</dd></div>
      </dl>
      <div class="eqd-sec"><h4>고장 · 수리 <span class="mono">${reps.length}</span></h4>
        ${reps.length ? `<div class="flt-list">${reps.slice(0, 8).map(r => repairRow(r)).join("")}</div>` : '<p class="eqd-none">고장 기록이 없습니다.</p>'}</div>
      <div class="modal-actions">
        ${SeMIS.canEdit() ? '<button type="button" class="btn btn-ghost" id="eqd-reg" style="margin-right:auto">대장에 등록</button>' : ""}
        <button type="button" class="btn btn-primary" id="eqd-close">닫기</button></div>`, { wide: true });
    $("#eqd-close").onclick = closeModal;
    if ($("#eqd-reg")) $("#eqd-reg").onclick = () => eqForm(null, {
      type: u.kind === "xray" ? "X-Ray" : u.kind === "etd" ? "ETD(폭발물흔적)" : "기타", name: u.label, serial: u.serial });
    $$("#modal-box [data-repair]").forEach(b => b.onclick = () => repairDetail(b.dataset.repair, () => caresOnlyDetail(u.id)));
  }

  /* 장비 등록·수정 (hq 이상) */
  function eqForm(id, preset) {
    if (!SeMIS.canEdit()) return;
    const x = id ? list().find(e => e.id === id) : null;
    const v = Object.assign({ type: TYPES[0], status: "정상", location: "인천 화물터미널 B동" }, preset || {}, x || {});
    let logs = x ? (x.logs || []).map(l => Object.assign({}, l)) : [];
    const conf = SeMIS.canConfid();
    const f = (idn, label, html, tip) => `<div class="form-row"><label for="${idn}">${esc(label)}${tip ? " " + ui.tip(tip, label + " 설명") : ""}</label>${html}</div>`;
    openModal(`
      <h3>${x ? "장비 수정" : "장비 등록"}</h3>
      <div class="form-grid">
        ${f("e-type", "장비 유형", `<select id="e-type">${TYPES.map(t => `<option ${v.type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`)}
        ${f("e-status", "상태", `<select id="e-status">${STATUSES.map(s => `<option ${v.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>`,
          "CARES와 연동된 장비는 CARES 상태가 우선 표시됩니다. 여기서는 CARES 미연동 장비의 상태와 폐기 여부를 관리합니다.")}
        ${f("e-name", "장비명 · 모델", `<input id="e-name" value="${esc(v.name || "")}" maxlength="60" placeholder="예: RAP-638DV 1호기">`)}
        ${f("e-serial", "제조번호 (S/N)", `<input id="e-serial" class="mono" value="${esc(v.serial || "")}" maxlength="40">`,
          "CARES에 같은 S/N의 장비가 있으면 상태·배치·고장·점검 이력이 자동으로 연결됩니다.")}
        ${f("e-location", "설치 위치", `<input id="e-location" value="${esc(v.location || "")}" maxlength="60">`)}
        ${f("e-vendor", "제작 · 유지보수 업체", `<input id="e-vendor" value="${esc(v.vendor || "")}" maxlength="60" placeholder="예: 라피스캔 / 인씨스">`)}
        ${f("e-mfg", "제조일", `<input type="date" id="e-mfg" value="${esc(v.mfgDate || "")}">`, "내용연수 기산일입니다. 비우면 설치일부터 계산합니다.")}
        ${f("e-installed", "설치 · 취득일", `<input type="date" id="e-installed" value="${esc(v.installed || "")}">`)}
        ${f("e-life", "내용연수 (년)", `<input type="number" id="e-life" min="0" max="30" value="${esc(v.lifeYears != null ? v.lifeYears : "")}" placeholder="유형 기본값">`,
          "비우면 유형 기본값을 씁니다 — X-Ray 10년 · ETD 5년 · WTMD 10년 · HHMD 4년.")}
        ${f("e-repdue", "교체 예정일", `<input type="date" id="e-repdue" value="${esc(v.replaceDue || "")}">`, "지정하면 내용연수 계산 대신 이 날짜를 씁니다.")}
        ${conf ? f("e-price", "구입가 (원)", `<input type="number" id="e-price" min="0" value="${esc(v.price != null ? v.price : "")}">`) : ""}
        ${f("e-cert", "인증", `<input id="e-cert" value="${esc(v.cert || "")}" maxlength="120" placeholder="예: TSA, STAC, KIAST">`)}
      </div>
      ${f("e-note", "비고", `<input id="e-note" value="${esc(v.note || "")}" maxlength="200">`)}
      <div class="form-row"><label>자체 기록 ${ui.tip("CARES 밖에서 따로 남길 점검·고장·수리 메모입니다.", "자체 기록 설명")}</label>
        <div id="e-logs" class="elog-list"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="elog-add">${icon("plus", 15)}<span>기록 추가</span></button></div>
      <div class="modal-actions">
        ${x && SeMIS.canDelete() ? '<button type="button" class="btn btn-danger" id="e-del" style="margin-right:auto">삭제</button>' : ""}
        <button type="button" class="btn btn-ghost" id="e-cancel">취소</button>
        <button type="button" class="btn btn-primary" id="e-save">저장</button>
      </div>`, { wide: true });

    function collect() {
      $$("#e-logs .elog-row").forEach((row, i) => {
        logs[i].date = $("input[type=date]", row).value;
        logs[i].kind = $("select", row).value;
        logs[i].text = $("input[type=text]", row).value;
      });
    }
    function paintLogs() {
      $("#e-logs").innerHTML = logs.map((l, i) => `<div class="elog-row">
          <input type="date" value="${esc(l.date || "")}" aria-label="날짜">
          <select aria-label="구분">${LOG_KINDS.map(k => `<option ${l.kind === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>
          <input type="text" value="${esc(l.text || "")}" maxlength="200" placeholder="내용" aria-label="내용">
          <button type="button" class="mt-btn danger" data-log-del="${i}" aria-label="기록 삭제">${icon("x", 16)}</button>
        </div>`).join("");
      $$("#e-logs [data-log-del]").forEach(b => b.onclick = () => { collect(); logs.splice(Number(b.dataset.logDel), 1); paintLogs(); });
    }
    paintLogs();
    $("#elog-add").onclick = () => {
      collect();
      logs.push({ id: uid("el"), date: todayISO(), kind: "기타", text: "", by: (SeMIS.user && SeMIS.user.name) || "" });
      paintLogs();
    };
    $("#e-cancel").onclick = () => { closeModal(); if (x) eqDetail(x.id); };
    if ($("#e-del")) $("#e-del").onclick = () => confirmModal(`장비 "${x.name}"을(를) 대장에서 삭제하시겠습니까? (CARES 데이터는 그대로입니다)`, () => {
      D().equipment = list().filter(e => e.id !== x.id);
      SeMIS.save(); SeMIS.renderView(); toast("삭제되었습니다.");
    });
    $("#e-save").onclick = () => {
      const name = $("#e-name").value.trim();
      if (!name) { toast("장비명을 입력하세요.", true); $("#e-name").focus(); return; }
      collect();
      const clean = logs.filter(l => String(l.text || "").trim())
        .map(l => ({ id: l.id || uid("el"), date: l.date || "", kind: LOG_KINDS.indexOf(l.kind) >= 0 ? l.kind : "기타",
          text: String(l.text).trim(), by: l.by || "" }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const life = $("#e-life").value;
      const rec = {
        type: $("#e-type").value, name, serial: $("#e-serial").value.trim(), location: $("#e-location").value.trim(),
        vendor: $("#e-vendor").value.trim(), mfgDate: $("#e-mfg").value || "", installed: $("#e-installed").value || "",
        lifeYears: life === "" ? null : Math.max(0, Number(life) || 0), replaceDue: $("#e-repdue").value || "",
        price: !conf ? (x && x.price != null ? x.price : null) : ($("#e-price").value === "" ? null : Math.max(0, Number($("#e-price").value) || 0)),
        cert: $("#e-cert").value.trim(), status: $("#e-status").value, logs: clean, note: $("#e-note").value.trim()
      };
      if (!Array.isArray(D().equipment)) D().equipment = [];
      if (x) Object.assign(x, rec); else D().equipment.push(Object.assign({ id: uid("eq") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ═════════ 고장 · 수리 이력 ═════════ */
  function repairRow(r) {
    const K = C();
    const u = K.unitById(r.equipmentId);
    const rs = K.repairStatus(r);
    const cz = K.CAUSE[r.causeCategory];
    const dur = r.resolvedAtMs ? K.fmtDur(r.resolvedAtMs - r.reportedAtMs) : K.fmtDur(Date.now() - r.reportedAtMs) + " 경과";
    return `<button type="button" class="flt-row" data-repair="${esc(r.id)}">
      <span class="flt-d mono">${esc(K.mdk(K.dayKey(r.reportedAtMs)))}</span>
      <span class="flt-b"><b>${esc(u ? u.label : (r.equipmentName || "장비"))}</b><span class="flt-s">${esc(r.symptom || "-")}</span></span>
      <span class="flt-m">${cz ? ui.chip(cz.label, cz.tone) : ""}${ui.chip(K.RS_META[rs].label, K.RS_META[rs].tone)}<small class="mono">${esc(dur)}</small></span>
    </button>`;
  }
  function repairsFiltered() {
    const K = C();
    const q = rQuery.toLowerCase();
    return K.state.repairs.filter(r => {
      if (rYear && rYear !== "all" && K.dayKey(r.reportedAtMs || 0).slice(0, 4) !== String(rYear)) return false;
      const u = K.unitById(r.equipmentId);
      const kind = u ? u.kind : K.kindOf(r.equipmentName && /ionab|etd/i.test(r.equipmentName) ? "ETD" : "X-RAY");
      if (rKind !== "all" && kind !== rKind) return false;
      if (!q) return true;
      return [r.symptom, r.cause, r.rootCause, r.reporter, r.equipmentName, r.equipmentSerial, u && u.label]
        .some(v => String(v || "").toLowerCase().indexOf(q) >= 0);
    }).sort((a, b) => (b.reportedAtMs || 0) - (a.reportedAtMs || 0));
  }
  function repairsHTML() {
    const K = C();
    if (!rYear) rYear = K.todayKey().slice(0, 4);
    const rows = repairsFiltered();
    const active = rows.filter(r => K.repairStatus(r) !== "resolved").length;
    const fixed = rows.filter(r => r.resolvedAtMs);
    const mttr = fixed.length ? fixed.reduce((n, r) => n + (r.resolvedAtMs - r.reportedAtMs), 0) / fixed.length : 0;
    const down = rows.reduce((n, r) => { const sp = K.spanOf(r); return n + (sp[1] - sp[0]); }, 0);
    const env = rows.filter(r => r.causeCategory === "environmental").length;
    const years = [["all", "전체"]].concat(K.repairYears().map(y => [String(y), y + "년"]));
    return ui.stats([
      { label: "고장 신고", value: rows.length, sub: rYear === "all" ? "전체 기간" : rYear + "년" },
      { label: "진행 중", value: active, tone: active ? "bad" : "ok" },
      { label: "평균 복구", value: fixed.length ? (mttr / 3600000).toFixed(1) + "시간" : "-", sub: fixed.length ? K.fmtDur(mttr) + " · 신고 → 복귀" : "신고 → 복귀" },
      { label: "총 다운타임", value: rows.length ? Math.round(down / 3600000).toLocaleString("ko-KR") + "시간" : "-", sub: "신고 → 복귀 합" },
      { label: "환경 요인", value: rows.length ? Math.round(env / rows.length * 100) + "%" : "-", sub: env + "건 · 온습도·분진 등", tone: "muted" }
    ]) + `<section class="card">
      <div class="toolbar">
        ${ui.search("rp-q", "증상 · 원인 · 신고자 검색", rQuery)}
        ${segHTML("ryear", years, rYear)}
        ${segHTML("rkind", [["all", "전체"], ["xray", "X-ray"], ["etd", "ETD"]], rKind)}
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap rp-tbl" style="--cap:1400px">
        <thead><tr><th>신고 일시</th><th>장비</th><th>증상</th><th>원인</th><th>처리</th><th>소요</th><th class="col-ext">신고자</th></tr></thead>
        <tbody>${rows.map(r => {
          const u = K.unitById(r.equipmentId);
          const rs = K.repairStatus(r);
          const cz = K.CAUSE[r.causeCategory];
          const dur = r.resolvedAtMs ? K.fmtDur(r.resolvedAtMs - r.reportedAtMs) : K.fmtDur(Date.now() - r.reportedAtMs) + " 경과";
          return `<tr data-repair-row="${esc(r.id)}" tabindex="0">
            <td class="mono nowrap c-date">${esc(K.fmtMs(r.reportedAtMs))}</td>
            <td class="nowrap c-unit"><b>${esc(u ? u.label : (r.equipmentName || "-"))}</b></td>
            <td class="rp-sym c-sym"><span>${esc(r.symptom || "-")}</span></td>
            <td class="c-cause">${cz ? ui.chip(cz.label, cz.tone) : '<span class="cell-sub">미분류</span>'}</td>
            <td class="c-st">${ui.chip(K.RS_META[rs].label, K.RS_META[rs].tone)}</td>
            <td class="mono nowrap c-dur">${esc(dur)}</td>
            <td class="col-ext">${esc(r.reporter || "-")}</td></tr>`;
        }).join("")}</tbody></table></div>` : ui.empty("조건에 맞는 고장 기록이 없습니다.")}
    </section>`;
  }
  function repairDetail(id, back) {
    const K = C();
    const r = K.state.repairs.find(x => x.id === id);
    if (!r) return;
    const u = K.unitById(r.equipmentId);
    const rs = K.repairStatus(r);
    const cz = K.CAUSE[r.causeCategory];
    const steps = [
      ["신고", r.reportedAtMs, r.reporter],
      ["접수", r.acceptedAtMs, r.acceptedBy],
      ["수리 시작", r.repairStartedAtMs, r.repairStartedBy],
      ["수리 완료", r.resolvedAtMs, r.resolvedBy]
    ];
    const parts = Array.isArray(r.parts) ? r.parts.filter(p => p && p.part) : [];
    openModal(`
      <h3 class="eqd-title">${esc(u ? u.label : (r.equipmentName || "장비"))} ${ui.chip(K.RS_META[rs].label, K.RS_META[rs].tone)}${cz ? " " + ui.chip(cz.label, cz.tone) : ""}</h3>
      <ol class="rp-steps">${steps.map(([lb, ms, by], i) => `<li class="${ms ? "on" : ""}">
        <span class="rp-dot" aria-hidden="true">${ms ? icon("check", 13) : ""}</span>
        <b>${esc(lb)}</b><span class="mono">${ms ? esc(K.fmtMs(ms)) : "-"}</span><small>${esc(by || "")}</small>
        ${i && ms && steps[i - 1][1] ? `<small class="rp-gap mono">+${esc(K.fmtDur(ms - steps[i - 1][1]))}</small>` : ""}</li>`).join("")}</ol>
      <dl class="eqd-grid one">
        <div><dt>증상</dt><dd class="pre">${esc(r.symptom || "-")}</dd></div>
        ${r.cause ? `<div><dt>원인 · 조치</dt><dd class="pre">${esc(r.cause)}</dd></div>` : ""}
        ${r.rootCause ? `<div><dt>근본 원인</dt><dd class="pre">${esc(r.rootCause)}</dd></div>` : ""}
        ${r.handlingType ? `<div><dt>처리 주체</dt><dd>${esc(r.handlingType === "manufacturer" ? "제조사" : r.handlingType === "vendor" ? "유지보수 업체" : r.handlingType)}</dd></div>` : ""}
        ${parts.length ? `<div><dt>교체 부품</dt><dd>${parts.map(p => `<span class="rp-part">${esc(p.part)} × ${esc(p.qty || 1)} ${ui.chip(p.isPaid ? "유상" : "무상", p.isPaid ? "amber" : "gray")}</span>`).join("")}</dd></div>` : ""}
        <div><dt>소요</dt><dd class="mono">${esc(r.resolvedAtMs ? K.fmtDur(r.resolvedAtMs - r.reportedAtMs) : K.fmtDur(Date.now() - r.reportedAtMs) + " 경과")}</dd></div>
      </dl>
      <div class="rp-photos" id="rp-photos"></div>
      <div class="modal-actions">
        ${back ? '<button type="button" class="btn btn-ghost" id="rp-back" style="margin-right:auto">장비로</button>' : ""}
        <a class="btn btn-ghost" href="${esc(K.CARES_URL)}" target="_blank" rel="noopener">${icon("external", 16)}<span>CARES</span></a>
        <button type="button" class="btn btn-primary" id="rp-close">닫기</button>
      </div>`, { wide: true });
    $("#rp-close").onclick = closeModal;
    if ($("#rp-back")) $("#rp-back").onclick = back;
    const box = $("#rp-photos");
    box.innerHTML = '<span class="cell-sub">사진 확인 중…</span>';
    K.repairPhotos(id).then(p => {
      const b2 = document.getElementById("rp-photos");
      if (!b2) return;
      const all = p.report.map(s => ["신고", s]).concat(p.repair.map(s => ["수리", s]));
      b2.innerHTML = all.length ? `<h4>사진 <span class="mono">${all.length}</span></h4><div class="rp-ph">${all.map(([lb, s], i) =>
        `<a href="#" data-ph="${i}" aria-label="${esc(lb)} 사진 ${i + 1} 크게 보기"><img src="${esc(s)}" alt="" loading="lazy"><small>${esc(lb)}</small></a>`).join("")}</div>` : "";
      $$("[data-ph]", b2).forEach(a => a.onclick = (ev) => {
        ev.preventDefault();
        const w = window.open("", "_blank");
        if (w) { w.document.title = "사진"; const img = w.document.createElement("img"); img.src = all[Number(a.dataset.ph)][1]; img.style.maxWidth = "100%"; w.document.body.appendChild(img); }
      });
    }).catch(() => { const b2 = document.getElementById("rp-photos"); if (b2) b2.innerHTML = ""; });
  }

  /* ═════════ 가동 분석 ═════════ */
  function analysisHTML() {
    const K = C();
    const years = K.repairYears();
    if (!aYear || years.indexOf(aYear) < 0) aYear = years[0];
    const stats = K.yearStats(aYear);
    const groups = ["xray", "etd"].map(k => ({ k, rows: stats.filter(s => s.unit.kind === k) })).filter(g => g.rows.length);
    const pct = (v) => v == null ? "-" : (Math.floor(v * 1000) / 10).toFixed(1) + "%";
    const hrs = (ms) => ms ? (ms / 3600000 >= 10 ? Math.round(ms / 3600000) : (ms / 3600000).toFixed(1)) + "h" : "0h";
    const minAv = Math.min(0.8, ...stats.filter(s => s.avail != null).map(s => s.avail));
    const lo = Math.max(0, Math.floor(minAv * 20) / 20 - 0.05);   // 막대 축 하한 — 차이가 보이도록(표에 실제 값)
    const xPos = (v) => ((v - lo) / (1 - lo)) * 100;
    const allN = stats.reduce((n, s) => n + s.count, 0);
    const etd = stats.filter(s => s.unit.kind === "etd" && s.avail != null);
    const etdAvg = etd.length ? etd.reduce((n, s) => n + s.avail, 0) / etd.length : null;
    const worst = stats.slice().sort((a, b) => b.count - a.count)[0] || null;
    const firstMs = K.state.repairs.reduce((m, r) => r.reportedAtMs && r.reportedAtMs < m ? r.reportedAtMs : m, Infinity);
    const firstRec = isFinite(firstMs) ? K.dayKey(firstMs) : "";
    const bars = groups.map(g => `<div class="av-grp">
        <div class="av-gh"><b>${esc(K.KIND_LABEL[g.k])}</b>${g.k === "etd" ? `<span class="av-tg">목표 ${ETD_TARGET * 100}% ${ui.tip("ETD 연간 가동률 90% 이상 — 가동률 = 정상 가동일 ÷ 기간 일수(고장 신고부터 복귀까지 걸친 날은 비가동). SeMIS v2 KPI(ETD 보안장비 관리 디지털화)와 같은 산식입니다.", "가동률 목표 설명")}</span>` : ""}</div>
        ${g.rows.map(s => `<div class="av-row" title="${esc(s.unit.label + " · 가동률 " + pct(s.avail) + " · 고장 " + s.count + "건 · 비가동 " + s.downDays + "일 · 다운타임 " + hrs(s.downMs))}">
          <span class="av-lb">${esc(s.unit.label)}</span>
          <span class="av-track">${g.k === "etd" ? `<i class="av-target" style="left:${xPos(ETD_TARGET).toFixed(1)}%" aria-hidden="true"></i>` : ""}
            <i class="av-bar${g.k === "etd" && s.avail != null && s.avail < ETD_TARGET ? " low" : ""}" style="width:${s.avail == null ? 0 : Math.max(1, xPos(s.avail)).toFixed(1)}%"></i></span>
          <span class="av-v mono">${pct(s.avail)}</span>
          <span class="av-s mono">${s.count}건 · ${hrs(s.downMs)}</span>
        </div>`).join("")}
      </div>`).join("");
    const byKind = ["xray", "etd"].map(k => {
      const c = {}; let n = 0;
      stats.filter(s => s.unit.kind === k).forEach(s => Object.keys(s.causes).forEach(z => { c[z] = (c[z] || 0) + s.causes[z]; n += s.causes[z]; }));
      return { k, c, n };
    }).filter(x => x.n);
    const causeKeys = ["environmental", "mechanical", "human", "other"];
    const causeHTML = byKind.length ? `<div class="cz-list">${byKind.map(x => `<div class="cz-row">
        <span class="av-lb">${esc(K.KIND_LABEL[x.k])} <span class="mono">${x.n}</span></span>
        <span class="cz-bar" role="img" aria-label="${esc(K.KIND_LABEL[x.k] + " 원인 " + causeKeys.filter(z => x.c[z]).map(z => K.CAUSE[z].label + " " + x.c[z] + "건").join(", "))}">${causeKeys.filter(z => x.c[z]).map(z =>
          `<i style="flex:${x.c[z]};background:${CAUSE_COLOR[z]}" title="${esc(K.CAUSE[z].label + " " + x.c[z] + "건")}"><span>${x.c[z]}</span></i>`).join("")}</span></div>`).join("")}
        <div class="cz-legend">${causeKeys.map(z => `<span><i style="background:${CAUSE_COLOR[z]}"></i>${esc(K.CAUSE[z].label)}</span>`).join("")}</div></div>`
      : ui.empty(aYear + "년 고장 기록이 없습니다.");
    const table = `<div class="table-wrap"><table class="tbl tbl-cap av-tbl" style="--cap:1100px">
      <thead><tr><th>장비</th><th>고장</th><th>비가동 일</th><th>다운타임</th><th>평균 복구</th><th>가동률</th></tr></thead>
      <tbody>${stats.map(s => `<tr><td><b>${esc(s.unit.label)}</b> <span class="cell-sub mono">${esc(s.unit.serial)}</span></td>
        <td class="mono">${s.count}</td><td class="mono">${s.downDays} / ${s.days}</td><td class="mono">${esc(hrs(s.downMs))}</td>
        <td class="mono">${s.mttrMs ? esc(K.fmtDur(s.mttrMs)) : "-"}</td>
        <td class="mono">${s.unit.kind === "etd" && s.avail != null && s.avail < ETD_TARGET ? ui.chip(pct(s.avail) + " 목표 미달", "amber") : esc(pct(s.avail))}</td></tr>`).join("")}</tbody></table></div>`;
    return ui.stats([
      { label: "고장 신고", value: allN, sub: aYear + "년 · X-ray · ETD" },
      { label: "ETD 평균 가동률", value: pct(etdAvg), sub: "목표 90%", tone: etdAvg == null ? "muted" : etdAvg >= ETD_TARGET ? "ok" : "warn" },
      { label: "총 다운타임", value: Math.round(stats.reduce((n, s) => n + s.downMs, 0) / 3600000).toLocaleString("ko-KR") + "h",
        sub: worst && worst.count ? "최다 " + worst.unit.label + " " + worst.count + "건" : "신고 → 복귀 합" },
      { label: "분석 기간", value: aYear === Number(K.todayKey().slice(0, 4)) ? "1.1~" + Number(K.todayKey().slice(5, 7)) + "." + Number(K.todayKey().slice(8)) : "1.1~12.31",
        sub: firstRec && firstRec.slice(0, 4) === String(aYear) && firstRec.slice(5) !== "01-01" ? "CARES 고장 기록은 " + K.mdk(firstRec) + "부터" : "설치일 이후만 계산", tone: "muted" }
    ]) + `<div class="toolbar">${segHTML("ayear", years.map(y => [y, y + "년"]), aYear)}</div>
      <div class="av-grid">
        <section class="card"><h2 class="card-title">장비별 가동률<span class="spacer"></span><span class="dc-meta">막대 축 ${Math.round(lo * 100)}~100%</span></h2>${bars || ui.empty("CARES 장비가 없습니다.")}</section>
        <section class="card"><h2 class="card-title">고장 원인 분류</h2>${causeHTML}</section>
      </div>
      <section class="card"><h2 class="card-title">장비별 지표</h2>${table}</section>`;
  }

  /* ═════════ 렌더 ═════════ */
  function syncText(s) {
    if (s.loading && !s.ts) return "CARES 불러오는 중";
    if (s.err) return "CARES 연동 불가 — 대장만 표시";
    return s.ts ? "CARES · " + C().hm(s.ts) + " 갱신" : "";
  }
  function tabBody() {
    const s = C().state;
    if (tab !== "list" && !C().has("repairs")) return s.err
      ? `<section class="card">${ui.empty("CARES에 연결하지 못했습니다. (" + s.err + ")", '<button type="button" class="btn btn-ghost btn-sm" data-eq-retry>다시 시도</button>')}</section>`
      : `<div class="scr-wait" role="status"><span class="cfe-spin" aria-hidden="true"></span>CARES에서 고장·점검 기록을 불러오는 중입니다.</div>`;
    return tab === "repairs" ? repairsHTML() : tab === "analysis" ? analysisHTML() : ledgerHTML();
  }
  function wire(root) {
    const box = $("#eq-body", root) || root;
    $$("[data-eq]", box).forEach(tr => {
      const open = () => eqDetail(tr.dataset.eq);
      tr.onclick = (ev) => { if (!ev.target.closest("a")) open(); };
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
    $$("[data-cares-only]", box).forEach(tr => {
      tr.onclick = () => caresOnlyDetail(tr.dataset.caresOnly);
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); caresOnlyDetail(tr.dataset.caresOnly); } };
    });
    $$("[data-repair-row]", box).forEach(tr => {
      tr.onclick = () => repairDetail(tr.dataset.repairRow);
      tr.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); repairDetail(tr.dataset.repairRow); } };
    });
    $$("[data-seg]", box).forEach(b => b.onclick = () => {
      const v = b.dataset.v;
      if (b.dataset.seg === "kind") kindF = v;
      else if (b.dataset.seg === "st") stF = v;
      else if (b.dataset.seg === "ryear") rYear = v;
      else if (b.dataset.seg === "rkind") rKind = v;
      else if (b.dataset.seg === "ayear") aYear = Number(v);
      paint();
    });
    const liveSearch = (id, set) => {
      const el = $("#" + id, box);
      if (!el) return;
      el.oninput = () => {
        set(el.value.trim());
        paint();
        const n = document.getElementById(id);
        if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
      };
    };
    liveSearch("eq-q", v => { query = v; });
    liveSearch("rp-q", v => { rQuery = v; });
    const rt = $("[data-eq-retry]", box);
    if (rt) rt.onclick = () => refresh(true);
  }
  function paint() {
    const box = document.getElementById("eq-body");
    if (!box) return;
    box.innerHTML = tabBody();
    const m = document.getElementById("eq-meta");
    if (m) m.textContent = syncText(C().state);
    wire(box.parentNode);
  }
  async function refresh(force) {
    const btn = document.getElementById("eq-refresh");
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    await C().load(!!force);
    if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    paint();
  }
  const TABS = [["list", "장비 대장"], ["repairs", "고장 · 수리 이력"], ["analysis", "가동 분석"]];
  function render(root) {
    const s = C().state;
    const canWrite = SeMIS.canEdit();
    root.innerHTML = ui.head({
      title: TITLE,
      meta: "X-ray · ETD · WTMD · HHMD",
      actions: `<span class="scr-meta" id="eq-meta">${esc(syncText(s))}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="eq-refresh" title="CARES에서 다시 읽기">${icon("refresh", 16)}<span>새로고침</span></button>
        ${canWrite ? `<button type="button" class="btn btn-primary" id="eq-add">${icon("plus", 17)}<span>장비 등록</span></button>` : ""}`
    }) + `<div class="eq-tabs" role="tablist" aria-label="검색장비 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-etab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>
      <div id="eq-body">${tabBody()}</div>`;
    $$("[data-etab]", root).forEach(b => b.onclick = () => { tab = b.dataset.etab; SeMIS.renderView(); });
    $("#eq-refresh", root).onclick = () => refresh(true);
    if ($("#eq-add", root)) $("#eq-add", root).onclick = () => eqForm(null);
    wire(root);
    const v = s.ver;
    C().load().then(st2 => { if (st2.ver !== v) paint(); });
  }
  /* 허브 패널 메뉴 배지(진행 중 고장 수) — CARES를 새로 읽어 값이 바뀌었을 때만 메뉴를 다시 그린다 */
  const activeCount = () => C().state.repairs.filter(r => C().repairStatus(r) !== "resolved").length;
  let lastBadge = 0;
  C().onLoad(() => {
    const n = activeCount();
    if (n === lastBadge || !SeMIS.user) return;
    lastBadge = n;
    try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  });

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { return C().has("repairs") ? (activeCount() || "") : ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "scan", module: MOD,
    items: () => list().map(x => ({ title: x.name, sub: [x.type, x.serial, x.vendor].filter(Boolean).join(" · "),
      text: [x.name, x.type, x.serial, x.vendor, x.location, x.cert, x.note], route: MOD }))
  });

  window.SemisEquip = {
    TYPES, TYPE_LIFE, addMonths, lifeBase, lifeYearsOf, replaceDue, isLifeDue, effStatus, unitOf, ledgerStats, filtered,
    setTab(t, opts) { if (["list", "repairs", "analysis"].indexOf(t) >= 0) tab = t; if (opts && opts.year) rYear = String(opts.year); },
    setFilter(k, s) { if (k) kindF = k; if (s) stF = s; }, setQuery(q) { query = String(q || ""); },
    openUnit(caresId) {
      const u = C().unitById(caresId);
      if (!u) return;
      const x = list().find(e => C().normSN(e.serial) === C().normSN(u.serial));
      if (x) eqDetail(x.id); else caresOnlyDetail(u.id);
    },
    openRepair(id) { repairDetail(id); },
    detail: eqDetail, form: eqForm
  };
})();
