/* 위해물품 적발 월 집계 — CARES hazStats(공개, 개인정보 · AWB 없음)의 월 숫자만 보여 준다. 원본 hazFinds 는 CARES 비공개라 읽지 않음.
   자리(data-hz)를 먼저 그리고 집계를 받으면 그 자리만 채운다(다시 그리기 없음 — 검색 입력 보호). 분류 색 4개는 CVD 검증(전 쌍) 통과값. */
"use strict";

(() => {
  const { esc, icon } = SeMIS;
  const C = () => window.SemisCares;
  const COLOR = { liquid: "#2b59c3", powder: "#d97706", mixed: "#9d174d", other: "#0d9488", none: "#94a3b8" };
  const TITLE = "위해물품 적발 일지";
  const ym2 = (ym) => Number(ym.slice(5, 7)) + "월";
  const ymDot = (ym) => ym.replace("-", ".");
  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
  const link = () => `<a class="link-btn hzf-link" href="${esc(C().HAZ_URL)}" target="_blank" rel="noopener">CARES${icon("external", 13)}</a>`;
  const ready = () => !!(C() && C().has("haz"));
  const failed = () => !!(C() && C().failed("haz"));

  /* 분류 누적 막대 한 줄 */
  function catBar(m) {
    const parts = C().HAZ_CATS.filter(([k]) => m.cat[k]).map(([k, lb]) => `<i style="flex:${m.cat[k]};--c:${COLOR[k]}" title="${esc(lb + " " + m.cat[k])}"></i>`).join("");
    return `<span class="hzf-bar" role="img" aria-label="${esc(C().HAZ_CATS.map(([k, lb]) => lb + " " + m.cat[k]).join(", "))}">${parts}</span>`;
  }
  const legend = () => `<div class="sd-legend">${C().HAZ_CATS.slice(0, 4).map(([k, lb]) => `<span><i style="--c:${COLOR[k]}"></i>${esc(lb)}</span>`).join("")}</div>`;

  /* ── 화물보안 대시보드 카드 ── */
  function sdHTML() {
    if (!ready()) return `<div class="scr-wait" role="status"><span class="cfe-spin" aria-hidden="true"></span>CARES 위해물품 적발 집계를 불러오는 중입니다.</div>`;
    if (failed()) return `<div class="dscr-err sd-fail">CARES 위해물품 적발 집계를 불러오지 못했습니다.</div>`;
    const K = C();
    const ser = K.hazSeries(12);
    const cur = ser[11], prev = ser[10];
    const max = Math.max(1, ...ser.map(m => m.total));
    const cols = ser.map(m => `<div class="cc-col" data-tt="${esc(ymDot(m.ym) + " · " + m.total + "건" + (m.total ? " · " + K.HAZ_CATS.filter(([k]) => m.cat[k]).map(([k, lb]) => lb + " " + m.cat[k]).join(" · ") : ""))}" tabindex="-1">
        <span class="cc-v mono">${m.total || ""}</span>
        <span class="cc-bar" style="height:${(m.total / max * 100).toFixed(1)}%">${K.HAZ_CATS.filter(([k]) => m.cat[k]).map(([k]) => `<i style="flex:${m.cat[k]};--c:${COLOR[k]}"></i>`).join("")}</span></div>`).join("");
    const locs = [["1", "1호기"], ["2", "2호기"], ["3", "3호기"]];
    const head = (m) => m.has ? `<b class="hzf-big mono">${fmt(m.total)}</b><span>건</span>` : `<b class="hzf-big mono">0</b><span>건</span>`;
    return `<div class="sd-grid">
        <div class="sd-pane">
          <div class="sd-ph"><b>${esc(ym2(cur.ym))} 적발</b><span class="dc-meta">${prev.has ? "지난달 " + fmt(prev.total) + "건" : ""}</span></div>
          <div class="hzf-head">${head(cur)}</div>
          ${cur.total ? catBar(cur) : ""}
          <dl class="hzf-dl">${K.HAZ_CATS.filter(([k]) => k !== "none" || cur.cat.none).map(([k, lb]) => `<div><dt><i style="--c:${COLOR[k]}"></i>${esc(lb)}</dt><dd class="mono">${fmt(cur.cat[k])}</dd></div>`).join("")}</dl>
          <dl class="hzf-dl is-loc">${locs.map(([k, lb]) => `<div><dt>${lb}</dt><dd class="mono">${fmt(cur.loc[k])}</dd></div>`).join("")}<div><dt>반입취하</dt><dd class="mono">${fmt(cur.withdrawn)}</dd></div></dl>
        </div>
        <div class="sd-pane">
          <div class="sd-ph"><b>월별 적발</b>${legend()}</div>
          <div class="cc" style="--n:12;--h:132px" role="img" aria-label="${esc("월별 위해물품 적발 " + ser.map(m => ym2(m.ym) + " " + m.total + "건").join(", "))}">
            <div class="cc-plot">${cols}</div>
            <div class="cc-x">${ser.map(m => `<span>${esc(String(Number(m.ym.slice(5, 7))))}</span>`).join("")}</div>
          </div>
          <p class="sd-foot">12개월 <b class="mono">${fmt(ser.reduce((n, m) => n + m.total, 0))}</b>건 · 월평균 <b class="mono">${fmt(Math.round(ser.reduce((n, m) => n + m.total, 0) / 12))}</b>건 · 작성 프로에스콤(CARES)</p>
        </div>
      </div>`;
  }
  function sdCard() {
    return `<section class="card sd-card" aria-label="${TITLE}">
      <h2 class="card-title">${TITLE}<span class="dc-meta">X-ray 1~3호기</span><span class="spacer"></span>${C() ? link() : ""}</h2>
      <div data-hz="sd">${sdHTML()}</div></section>`;
  }

  /* ── 보안 기록부 '오늘' 카드 ── */
  function slCardHTML() {
    const K = C();
    const cur = ready() && !failed() ? K.hazMonth(K.ymKST(0)) : null, prev = cur ? K.hazMonth(K.ymKST(-1)) : null;
    const tone = !cur ? "" : cur.total ? "ok" : "none";
    const state = !ready() ? "불러오는 중" : failed() ? "CARES 연결 실패" : `이번 달 ${fmt(cur.total)}건`;
    const sub = cur ? `지난달 ${fmt(prev.total)}건${cur.withdrawn ? " · 반입취하 " + cur.withdrawn : ""}` : "";
    return `<section class="sl-card hzf-card" data-tone="${tone}">
      <div class="sl-card-h"><b>${TITLE}</b><span class="sl-cyc">CARES · 수시</span></div>
      <div class="sl-who">${icon("user", 14)}<span>프로에스콤 → X-ray 검색 화물</span></div>
      <div class="sl-card-s"><span class="sl-dot" aria-hidden="true"></span><span>${esc(state)}</span></div>
      ${sub ? `<div class="sl-card-sub">${esc(sub)}</div>` : ""}
      <div class="sl-card-f"><span class="spacer"></span>${C() ? link() : ""}</div>
    </section>`;
  }
  /* ── 보안 기록부 '기록 현황' 줄 ── */
  function slRowHTML() {
    const K = C();
    const head = `<div class="sl-row-h"><b>${TITLE}</b><span class="sl-cyc">CARES · 월 집계</span>`;
    if (!ready()) return `<div class="sl-row">${head}</div><div class="sl-row-b">불러오는 중</div></div>`;
    if (failed()) return `<div class="sl-row">${head}</div><div class="sl-row-b">CARES 위해물품 적발 집계를 불러오지 못했습니다.</div></div>`;
    const ser = K.hazSeries(12);
    const past = ser.slice(0, 11), k = past.filter(m => m.total).length;
    return `<div class="sl-row">${head}<span class="spacer"></span><span class="sl-rate mono">${k}/${past.length}</span></div>
      <div class="sl-strip" role="list">${ser.map((m, i) => {
        const c = i === 11 ? (m.total ? "ok" : "cur") : m.total ? "ok" : "miss";
        const lab = ymDot(m.ym) + " · " + (m.total ? m.total + "건" : i === 11 ? "진행 중" : "기록 없음");
        return `<span class="sl-cell" role="listitem" data-c="${c}" title="${esc(lab)}" aria-label="${esc(lab)}"></span>`;
      }).join("")}</div></div>`;
  }
  /* ── 점검 · 교육 대시보드 한 줄 ── */
  function ieHTML() {
    if (!ready()) return `<p class="sd-foot">${TITLE} · 불러오는 중</p>`;
    if (failed()) return `<p class="sd-foot">${TITLE} · CARES 연결 실패</p>`;
    const K = C(), cur = K.hazMonth(K.ymKST(0)), prev = K.hazMonth(K.ymKST(-1));
    return `<div class="hzf-line"><span class="hzf-t">${TITLE}<small>CARES</small></span>${cur.total ? catBar(cur) : `<span class="hzf-bar is-empty"></span>`}
      <span class="hzf-v mono">${esc(ym2(cur.ym))} ${fmt(cur.total)}건</span><span class="hzf-s mono">${esc(ym2(prev.ym))} ${fmt(prev.total)}건</span></div>`;
  }

  const KINDS = { sd: sdHTML, "sl-card": slCardHTML, "sl-row": slRowHTML, ie: ieHTML };
  /* 자리 표시 — 처음 그릴 때 */
  const slot = (kind) => `<div class="hzf-slot" data-hz="${kind}">${KINDS[kind]()}</div>`;
  /* 그린 뒤 — 자료가 없으면 한 번 받아 자리만 채운다 */
  function fill(root) {
    const K = C();
    if (!K || !root) return;
    const boxes = Array.prototype.slice.call(root.querySelectorAll("[data-hz]"));
    if (!boxes.length) return;
    const put = () => boxes.forEach(b => { if (document.body.contains(b) && KINDS[b.dataset.hz]) b.innerHTML = KINDS[b.dataset.hz](); });
    if (ready() && K.fresh(["haz"])) return;
    K.load({ parts: ["haz"] }).then(put).catch(() => {});
  }
  const canShow = () => !!C();

  window.SemisHaz = { COLOR, slot, fill, sdCard, sdHTML, slCardHTML, slRowHTML, ieHTML, canShow };
})();
