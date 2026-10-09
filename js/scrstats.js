/* 화물 보안검색 실적 카드 — 월별 수출 검색 합계와 서울지방항공청 월간 보고(위해물품 · 비인가자) 수치.
   원본 기록(운송장 · 품명)은 두지 않고 월별 합계만 저장.
   SeMIS.data.scrStats = { asOf, src, months{ "YYYY-MM": { mawb, pcs, wt(톤), xray, etd, both, visual, doc, us, kj, oz, tk, oth } },
     haz{ "YYYY-MM": { chk, find, intrude } }, note } */
"use strict";

(() => {
  const { $$, esc, ui, icon } = SeMIS;
  const S = () => { const v = SeMIS.data.scrStats; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const isYM = (s) => /^\d{4}-\d{2}$/.test(String(s || ""));
  const fmt = (v, dec) => (v == null || v === "" ? "-" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }));
  const mLabel = (ym) => Number(ym.slice(5)) + "월";
  let view = "scr", year = "";

  const SCR_COLS = [["mawb", "MAWB"], ["pcs", "PCS"], ["wt", "중량(톤)", 1], ["xray", "X-ray"], ["etd", "ETD"], ["both", "X-ray+ETD"], ["visual", "육안 · 개봉"], ["us", "미주행"]];
  const HAZ_COLS = [["chk", "위해물품 확인"], ["find", "위해물품 적발"], ["intrude", "비인가자 진입"]];

  function monthsOf(key) {
    const m = S()[key];
    return m && typeof m === "object" ? Object.keys(m).filter(isYM).sort() : [];
  }
  const yearsOf = (key) => Array.from(new Set(monthsOf(key).map(k => k.slice(0, 4)))).sort().reverse();
  function tableHTML(key, cols) {
    const ys = yearsOf(key);
    const y = ys.indexOf(year) >= 0 ? year : ys[0];
    const ms = monthsOf(key).filter(k => k.slice(0, 4) === y);
    const data = S()[key] || {};
    if (!ms.length) return ui.empty("등록된 실적이 없습니다.");
    const barKey = cols[0][0];
    const mx = Math.max(1, ...ms.map(k => Number((data[k] || {})[barKey]) || 0));
    const tot = cols.map(([k]) => ms.reduce((a, m) => a + (Number((data[m] || {})[k]) || 0), 0));
    return `${ys.length > 1 ? `<div class="seg ss-years" role="group" aria-label="연도">${ys.map(v => `<button type="button" class="seg-btn" data-ssy="${esc(v)}" aria-pressed="${v === y}">${esc(v)}</button>`).join("")}</div>` : ""}
      <div class="table-wrap"><table class="tbl ss-tbl tbl-keep"><thead><tr><th>월</th>${cols.map(([, lb]) => `<th>${esc(lb)}</th>`).join("")}<th aria-label="막대"></th></tr></thead>
      <tbody>${ms.map(m => { const r = data[m] || {}; return `<tr><td>${esc(mLabel(m))}</td>${cols.map(([k, , dec]) => `<td class="mono">${fmt(r[k], dec)}</td>`).join("")}
        <td class="kc-bar"><i style="width:${Math.round((Number(r[barKey]) || 0) / mx * 100)}%"></i></td></tr>`; }).join("")}</tbody>
      <tfoot><tr><td>합계</td>${tot.map((x, i) => `<td class="mono"><b>${fmt(x, cols[i][2])}</b></td>`).join("")}<td></td></tr>
        <tr><td>월 평균</td>${tot.map((x, i) => `<td class="mono">${fmt(x / ms.length, cols[i][2])}</td>`).join("")}<td></td></tr></tfoot></table></div>`;
  }
  function cardHTML() {
    const s = S();
    const hasScr = monthsOf("months").length, hasHaz = monthsOf("haz").length;
    if (!hasScr && !hasHaz) return "";
    const v = view === "haz" && hasHaz ? "haz" : hasScr ? "scr" : "haz";
    return `<section class="card ss-card" id="ss-card"><div class="card-title">${icon("grid", 18)}<span>보안검색 실적</span>
        ${hasScr && hasHaz ? `<span class="spacer"></span><div class="seg" role="group" aria-label="실적 보기"><button type="button" class="seg-btn" data-ssv="scr" aria-pressed="${v === "scr"}">수출 보안검색</button><button type="button" class="seg-btn" data-ssv="haz" aria-pressed="${v === "haz"}">위해물품 · 비인가자</button></div>` : ""}</div>
      <div id="ss-body">${v === "scr" ? tableHTML("months", SCR_COLS) : tableHTML("haz", HAZ_COLS)}</div>
      <p class="pn-note">${v === "scr" ? esc(s.src ? "원본: " + s.src + (s.asOf ? " · 기준 " + s.asOf : "") : "") + " — 화물터미널 수출 보안검색 기록(KJ + 타 항공사)을 월별로 합산. 미주행 = 화물기 · 여객기 · BUC/BUP · Container 검색"
        : "서울지방항공청 월간 '위해물품 적발 및 비인가자 불법진입 처리현황' 보고 수치. 위해물품 확인 = X-ray 검색 때 위험물 은닉 여부를 확인한 개수"}</p></section>`;
  }
  function wire(box) {
    if (!box) return;
    $$("[data-ssv]", box).forEach(b => b.onclick = () => { view = b.dataset.ssv; year = ""; repaint(); });
    $$("[data-ssy]", box).forEach(b => b.onclick = () => { year = b.dataset.ssy; repaint(); });
  }
  function repaint() {
    const c = document.getElementById("ss-card");
    if (!c) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = cardHTML();
    const n = tmp.firstElementChild;
    if (n) { c.replaceWith(n); wire(n); }
  }
  /* 6.7 보안검색 기록 보관(1년) · 6.8 화물 보안검색 기록(60일) */
  function evidence(mid) {
    const ms = monthsOf("months"), hz = monthsOf("haz");
    if (mid === "6.8") return ms.length ? { ok: true, text: "월별 검색 실적 " + ms.length + "개월 (최근 " + ms[ms.length - 1] + ")" } : { ok: false, text: "검색 실적 없음" };
    return ms.length || hz.length ? { ok: true, text: "검색 실적 " + ms.length + "개월 · 적발 보고 " + hz.length + "개월" } : { ok: false, text: "실적 없음" };
  }
  if (window.SemisDocs) SemisDocs.define("scr-status", [
    { id: "stats", label: "보안검색 통계 · 실적" }, { id: "haz", label: "위해물품 · 비인가자 적발 보고" }, { id: "proc", label: "검색 절차 · 기준" }, { id: "misc", label: "기타" }
  ]);
  /* 화물 보안검색 현황 화면의 증빙: 6.7 · 6.8 = 실적, 그 밖(8.1 · 8.3 등) = CARES 연동 화면 */
  window.SemisEvidence = window.SemisEvidence || {};
  window.SemisEvidence["scr-status"] = (mid) => (mid === "6.7" || mid === "6.8" ? evidence(mid) : { ok: true, text: "" });
  window.SemisScrStats = { cardHTML, wire, evidence, monthsOf };
})();
