/* 미주행 재보안검색 현황(라우트 us-rescreen) — 화물터미널 출발지별 월 실적: MIX(MAWB · PCs · 중량) · THRU(ULD).
   원본 = 반출입 물동량현황(B3503 → MIX) · FLT별 반출입현황(B3505 → THRU). 비중 · 소계는 저장하지 않고 늘 계산한다.
   SeMIS.data.usRescreen = { origins[{ id, c(색 칸), off? }], months{ "YYYY-MM": { mix{ 출발지: { mawb, pcs, wt(톤) } }, thru{ 출발지: ULD }, at, by } } }
   ETC 는 목록에 넣지 않는 고정 칸(늘 맨 끝). 화물보안 대시보드 탭 · 홈 '오늘' 띠는 이 파일의 sdPane · todayData 로 읽는다. */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "us-rescreen", KEY = "usRescreen", TITLE = "미주행 재보안검색";
  const ETC = "ETC";
  const BASE = ["CHINA", "HKG", "HAN"];
  /* 색 칸 순서 = 인접 쌍 CVD 검증 통과 순서(dataviz 검증기, 흰 바탕) — ETC 는 노랑 고정, 새 출발지는 비어 있는 다음 칸 */
  const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4", "#008300", "#e34948"];
  const ETC_COLOR = "#eda100";
  const MAX_ORIGINS = COLORS.length;
  const WRITE_RANK = 4;   // 서버 권한표 usRescreen 쓰기 4 와 같게 — 입력 권한을 넓힐 때 둘 다 바꾼다
  const MIX_F = [["mawb", "MAWB"], ["pcs", "PCs"], ["wt", "WT(T)"]];
  const METRICS = [["mawb", "MAWB", "MIX MAWB"], ["pcs", "PCs", "MIX PCs"], ["wt", "중량(T)", "MIX 중량"], ["uld", "THRU(ULD)", "THRU ULD"]];
  const MAX_V = 9999999;

  /* ── 날짜 ── */
  let todayOverride = "";
  const pad = (n) => String(n).padStart(2, "0");
  const ymOf = (y, m) => y + "-" + pad(m);
  const isYM = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));
  function nowYM() {
    if (todayOverride) return todayOverride.slice(0, 7);
    const d = new Date();
    return ymOf(d.getFullYear(), d.getMonth() + 1);
  }
  function ymAdd(ym, n) {
    const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5)) - 1 + n;
    return ymOf(Math.floor(t / 12), (t % 12) + 1);
  }
  const ymLabel = (ym) => ym.slice(0, 4) + "년 " + Number(ym.slice(5)) + "월";
  const mLabel = (ym) => Number(ym.slice(5)) + "월";

  /* ── 숫자 ── */
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const add = (a, b) => Math.round(((a || 0) + (b || 0)) * 1e6) / 1e6;
  const decOf = (k) => (k === "wt" ? 1 : 0);
  const fmtN = (v, dec) => (v == null || !isFinite(v) ? "-" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }));
  const fmtV = (k, v) => fmtN(v, decOf(k));
  const pctTxt = (v) => (v == null || !isFinite(v) ? "-" : (Math.round(v * 1000) / 10).toFixed(1) + "%");
  const share = (v, tot) => (v != null && tot ? v / tot : null);
  /* 변화율 — 앞 값이 0 · 없음이면 계산하지 않는다 */
  function change(cur, prev) {
    if (cur == null || prev == null) return null;
    if (!prev) return cur ? Infinity : 0;
    return (cur - prev) / prev;
  }
  function chgTxt(c) {
    if (c == null) return "-";
    if (c === Infinity) return "신규";
    const r = Math.round(Math.abs(c) * 1000) / 10;
    return (r === 0 ? "– " : c > 0 ? "▲ " : "▼ ") + r.toFixed(1) + "%";
  }
  const chgCls = (c) => (c == null || c === Infinity ? "" : Math.round(Math.abs(c) * 1000) === 0 ? "" : c > 0 ? " up" : " down");
  /* 입력 글자 → 값. 쉼표 · 빈칸 허용, 개수는 정수, 중량은 소수 5자리까지 */
  function parseIn(s, k) {
    const t = String(s == null ? "" : s).replace(/[,\s]/g, "");
    if (t === "") return { ok: true, v: null };
    if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false };
    const v = Number(t);
    if (!isFinite(v) || v > MAX_V) return { ok: false };
    if (k !== "wt" && !Number.isInteger(v)) return { ok: false };
    if (k === "wt" && (t.split(".")[1] || "").length > 5) return { ok: false };
    return { ok: true, v };
  }

  /* ── 자료 ── */
  const S = () => { const v = SeMIS.data[KEY]; return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const isCode = (s) => /^[A-Z0-9][A-Z0-9-]{1,9}$/.test(String(s || ""));
  function originList() {
    const raw = Array.isArray(S().origins) && S().origins.length ? S().origins : BASE.map((id, i) => ({ id, c: i }));
    const seen = new Set(), used = new Set();
    const out = [];
    raw.forEach(o => {
      if (!o || !isCode(o.id) || o.id === ETC || seen.has(o.id) || out.length >= MAX_ORIGINS) return;
      seen.add(o.id);
      out.push({ id: o.id, c: Number.isInteger(o.c) && o.c >= 0 && o.c < COLORS.length ? o.c : -1, off: !!o.off });
    });
    out.forEach(o => { if (o.c >= 0 && !used.has(o.c)) used.add(o.c); else o.c = -1; });
    out.forEach(o => { if (o.c < 0) { let i = 0; while (used.has(i)) i++; o.c = i; used.add(i); } });
    return out;
  }
  function colorOf(id) {
    if (id === ETC) return ETC_COLOR;
    const o = originList().find(x => x.id === id);
    return COLORS[o ? o.c % COLORS.length : COLORS.length - 1];
  }
  function months() { const m = S().months; return m && typeof m === "object" && !Array.isArray(m) ? m : {}; }
  function rec(ym) { const r = months()[ym]; return r && typeof r === "object" && !Array.isArray(r) ? r : null; }
  const mixOf = (r, id) => { const x = r && r.mix && r.mix[id]; return x && typeof x === "object" ? x : {}; };
  function val(r, id, k) { return k === "uld" ? num(r && r.thru && r.thru[id]) : num(mixOf(r, id)[k]); }
  function hasOrigin(r, id) { return !!r && (val(r, id, "uld") != null || MIX_F.some(([k]) => val(r, id, k) != null)); }
  function filled(r) {
    if (!r) return false;
    const ids = Object.keys(r.mix || {}).concat(Object.keys(r.thru || {}));
    return ids.some(id => hasOrigin(r, id));
  }
  function allYMs() { return Object.keys(months()).filter(k => isYM(k) && filled(rec(k))).sort(); }
  function latest() { const a = allYMs(); return a.length ? a[a.length - 1] : ""; }
  function years() {
    const ys = new Set(allYMs().map(k => k.slice(0, 4)));
    ys.add(nowYM().slice(0, 4));
    return Array.from(ys).sort();
  }
  function total(r, k) {
    if (!r) return null;
    const src = k === "uld" ? r.thru : r.mix;
    if (!src || typeof src !== "object") return null;
    let s = null;
    Object.keys(src).forEach(id => { const v = val(r, id, k); if (v != null) s = add(s, v); });
    return s;
  }
  /* 보이는 출발지 — 숨기지 않은 것 + 그 기간에 값이 있는 것, ETC 는 늘 끝 */
  function idsFor(yms) {
    return originList().filter(o => !o.off || yms.some(ym => hasOrigin(rec(ym), o.id))).map(o => o.id).concat([ETC]);
  }
  function monthCalc(r, ids) {
    const mix = ids.map(id => ({ id, mawb: val(r, id, "mawb"), pcs: val(r, id, "pcs"), wt: val(r, id, "wt") }));
    const thru = ids.map(id => ({ id, uld: val(r, id, "uld") }));
    const sum = (rows, k) => rows.reduce((s, x) => (x[k] == null ? s : add(s, x[k])), null);
    const tot = { mawb: sum(mix, "mawb"), pcs: sum(mix, "pcs"), wt: sum(mix, "wt"), uld: sum(thru, "uld") };
    mix.forEach(x => MIX_F.forEach(([k]) => { x["p_" + k] = share(x[k], tot[k]); }));
    thru.forEach(x => { x.p_uld = share(x.uld, tot.uld); });
    return { mix, thru, tot };
  }
  function yearMonths(y) { const out = []; for (let m = 1; m <= 12; m++) out.push(ymOf(y, m)); return out; }
  /* 기간 합계 — 출발지 × 지표 */
  function rangeAgg(yms) {
    const ids = idsFor(yms);
    const by = {}, tot = { mawb: null, pcs: null, wt: null, uld: null };
    ids.forEach(id => { by[id] = { mawb: null, pcs: null, wt: null, uld: null }; });
    yms.forEach(ym => {
      const r = rec(ym);
      if (!filled(r)) return;
      ids.forEach(id => METRICS.forEach(([k]) => {
        const v = val(r, id, k);
        if (v != null) { by[id][k] = add(by[id][k], v); tot[k] = add(tot[k], v); }
      }));
    });
    return { ids, by, tot, n: yms.filter(ym => filled(rec(ym))).length };
  }
  /* 지난달 · 전년 같은 달 대비 */
  function compare(ym) {
    const r = rec(ym), p = rec(ymAdd(ym, -1)), q = rec(ymAdd(ym, -12));
    const out = {};
    METRICS.forEach(([k]) => {
      const cur = total(r, k);
      out[k] = { cur, mom: filled(p) ? change(cur, total(p, k)) : null, yoy: filled(q) ? change(cur, total(q, k)) : null };
    });
    return out;
  }

  /* ── 권한 ── */
  const canRead = () => SeMIS.roleRank() >= 2;
  const canWrite = () => SeMIS.roleRank() >= WRITE_RANK;
  const menuOk = () => { const mn = SeMIS.menuForModule(MOD); return !!(mn && SeMIS.navVisible(mn)); };

  /* ── 화면 상태 ── */
  let view = "month", year = "", ym = "", metric = "mawb", ymode = "v";
  let draft = null;     // { ym, v{ "mix:ID:k" | "thru:ID": 글자 }, dirty }
  let focusKey = "";
  function defaultYM() {
    const last = latest(), now = nowYM();
    if (!last) return ymAdd(now, -1);
    const next = ymAdd(last, 1);
    return next < now ? next : last;
  }
  function ensureState() {
    if (!isYM(ym)) ym = defaultYM();
    if (!/^\d{4}$/.test(year)) year = ym.slice(0, 4);
  }
  function draftFor(target) {
    if (draft && draft.ym === target) return draft;
    const r = rec(target), v = {};
    idsFor([target]).forEach(id => {
      MIX_F.forEach(([k]) => { const x = val(r, id, k); v["mix:" + id + ":" + k] = x == null ? "" : String(x); });
      const u = val(r, id, "uld"); v["thru:" + id] = u == null ? "" : String(u);
    });
    draft = { ym: target, v, dirty: false };
    return draft;
  }
  const dirty = () => !!(draft && draft.dirty);
  function leave(fn) {
    if (!dirty()) { draft = null; fn(); return; }
    confirmModal(ymLabel(draft.ym) + " 입력을 저장하지 않았습니다. 버리고 이동하시겠습니까?", () => { draft = null; fn(); });
  }
  if (typeof window !== "undefined") window.addEventListener("beforeunload", (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } });

  /* 입력값 → 계산용 기록(검사 결과 포함) */
  function draftRec(d) {
    const out = { mix: {}, thru: {} }, bad = [];
    Object.keys(d.v).forEach(key => {
      const p = key.split(":");
      const k = p[0] === "thru" ? "uld" : p[2];
      const r = parseIn(d.v[key], k);
      if (!r.ok) { bad.push(key); return; }
      if (r.v == null) return;
      if (p[0] === "thru") out.thru[p[1]] = r.v;
      else (out.mix[p[1]] = out.mix[p[1]] || {})[k] = r.v;
    });
    return { r: out, bad };
  }

  /* ── 머리말 ── */
  function headHTML() {
    const w = canWrite();
    const last = latest();
    const acts = [];
    if (view === "month" && w) acts.push(`<button type="button" class="btn btn-primary" id="ur-save">${icon("check", 17)}<span>저장</span></button>`);
    acts.push(`<button type="button" class="btn ${view === "year" ? "btn-primary" : "btn-ghost"}" id="ur-xlsx">${icon("down", 16)}<span>엑셀 내려받기</span></button>`);
    if (w) acts.push(`<button type="button" class="btn btn-ghost btn-sm ph-rare" id="ur-origins">${icon("sliders", 16)}<span>출발지 관리</span></button>`);
    if (w && view === "month" && filled(rec(ym))) acts.push(`<button type="button" class="btn btn-ghost btn-sm ph-rare" id="ur-del-cur">${icon("trash", 16)}<span>이 달 자료 삭제</span></button>`);
    return ui.head({ title: TITLE, meta: last ? "최근 " + ymLabel(last) : "", actions: acts.join("") });
  }
  function barHTML() {
    const ys = years();
    const yi = ys.indexOf(year);
    const ynav = `<div class="ur-ynav" role="group" aria-label="연도">
        <button type="button" class="icon-btn" id="ur-yprev" aria-label="이전 연도"${yi <= 0 && Number(year) <= Number(ys[0]) ? " disabled" : ""}>${icon("chevl", 18)}</button>
        <b class="mono">${esc(year)}</b>
        <button type="button" class="icon-btn" id="ur-ynext" aria-label="다음 연도"${Number(year) >= Number(nowYM().slice(0, 4)) ? " disabled" : ""}>${icon("chevron", 18)}</button></div>`;
    const seg = `<div class="seg" role="group" aria-label="보기"><button type="button" class="seg-btn" data-urv="month" aria-pressed="${view === "month"}">월간 보기</button><button type="button" class="seg-btn" data-urv="year" aria-pressed="${view === "year"}">연간 보기</button></div>`;
    let right = "";
    if (view === "month") {
      const now = nowYM();
      right = `<div class="seg ur-mseg" role="group" aria-label="월">${yearMonths(year).map(k => {
        const has = filled(rec(k));
        return `<button type="button" class="seg-btn${has ? " has" : ""}" data-urm="${k}" aria-pressed="${k === ym}"${k > now ? " disabled" : ""} title="${esc(ymLabel(k) + (has ? " · 입력됨" : " · 자료 없음"))}">${Number(k.slice(5))}월</button>`;
      }).join("")}</div>`;
    } else {
      right = `<div class="seg" role="group" aria-label="지표">${METRICS.map(([k, lb]) => `<button type="button" class="seg-btn" data-urk="${k}" aria-pressed="${k === metric}">${esc(lb)}</button>`).join("")}</div>
        <div class="seg" role="group" aria-label="표시"><button type="button" class="seg-btn" data-ury="v" aria-pressed="${ymode === "v"}">값</button><button type="button" class="seg-btn" data-ury="p" aria-pressed="${ymode === "p"}">비중</button></div>`;
    }
    return `<div class="toolbar ur-bar">${seg}${ynav}${right}<span class="spacer"></span><span class="ur-dirty badge badge-amber" id="ur-dirty"${dirty() ? "" : " hidden"}>저장하지 않은 변경</span></div>`;
  }

  /* ── 월간 보기(입력) ── */
  const swc = (c) => `<i class="ur-sw" style="--c:${c}" aria-hidden="true"></i>`;
  const sw = (id) => swc(colorOf(id));
  function monthHTML() {
    const d = draftFor(ym);
    const w = canWrite();
    const ids = idsFor([ym]);
    const { r } = draftRec(d);
    const c = monthCalc(r, ids);
    let ri = 0;
    const cell = (key, k, lb, row, col) => {
      const raw = d.v[key] == null ? "" : d.v[key];
      return w ? `<input type="text" class="ur-in mono${parseIn(raw, k).ok ? "" : " bad"}" inputmode="${k === "wt" ? "decimal" : "numeric"}" autocomplete="off" data-k="${esc(key)}" data-f="${k}" data-r="${row}" data-c="${col}" value="${esc(raw)}" aria-label="${esc(lb)}">`
        : `<span class="mono">${fmtV(k, parseIn(raw, k).v)}</span>`;
    };
    const mixRows = c.mix.map(x => {
      const row = ri++;
      return `<tr data-id="${esc(x.id)}"><th scope="row">${sw(x.id)}${esc(x.id)}</th>${MIX_F.map(([k, lb], ci) =>
        `<td class="ur-v">${cell("mix:" + x.id + ":" + k, k, x.id + " " + lb, row, ci)}</td><td class="ur-p mono" data-p="mix:${esc(x.id)}:${k}">${pctTxt(x["p_" + k])}</td>`).join("")}</tr>`;
    }).join("");
    const thruRows = c.thru.map((x, i) => `<tr data-id="${esc(x.id)}"><th scope="row">${sw(x.id)}${esc(x.id)}</th>
        <td class="ur-v">${cell("thru:" + x.id, "uld", x.id + " ULD", i, 0)}</td><td class="ur-p mono" data-p="thru:${esc(x.id)}">${pctTxt(x.p_uld)}</td></tr>`).join("");
    const cmp = compareDraft(c.tot);
    return `<div class="ur-two">
      <section class="card ur-card"><h2 class="card-title"><span class="ct-t">MIX</span><span class="dc-meta">${esc(ymLabel(ym))} · 반출입 물동량현황</span></h2>
        <div class="table-wrap"><table class="tbl ur-grid tbl-keep" data-no-stack data-grid="mix">
          <thead><tr><th>출발지</th>${MIX_F.map(([, lb]) => `<th class="ur-v">${esc(lb)}</th><th class="ur-p">비중</th>`).join("")}</tr></thead>
          <tbody>${mixRows}</tbody>
          <tfoot><tr><th scope="row">소계</th>${MIX_F.map(([k]) => `<td class="ur-v mono" data-t="${k}">${fmtV(k, c.tot[k])}</td><td class="ur-p mono">${c.tot[k] ? "100.0%" : "-"}</td>`).join("")}</tr></tfoot>
        </table></div>
        <p class="sd-foot" id="ur-cmp">${cmp}</p>
      </section>
      <section class="card ur-card"><h2 class="card-title"><span class="ct-t">THRU</span><span class="dc-meta">ULD · FLT별 반출입현황</span></h2>
        <div class="table-wrap"><table class="tbl ur-grid tbl-keep" data-no-stack data-grid="thru">
          <thead><tr><th>출발지</th><th class="ur-v">ULD</th><th class="ur-p">비중</th></tr></thead>
          <tbody>${thruRows}</tbody>
          <tfoot><tr><th scope="row">합계</th><td class="ur-v mono" data-t="uld">${fmtV("uld", c.tot.uld)}</td><td class="ur-p mono">${c.tot.uld ? "100.0%" : "-"}</td></tr></tfoot>
        </table></div>
      </section>
    </div>`;
  }
  function compareDraft(tot) {
    const p = rec(ymAdd(ym, -1));
    if (!filled(p)) return "전월 자료 없음";
    return "전월 대비 " + METRICS.map(([k, , lb]) => `${esc(lb)} <b class="ur-chg${chgCls(change(tot[k], total(p, k)))}">${esc(chgTxt(change(tot[k], total(p, k))))}</b>`).join(" · ");
  }
  /* 입력 중 — 입력칸은 그대로 두고 비중 · 소계 칸만 고친다 */
  function recalc(root) {
    const d = draft;
    if (!d) return;
    const ids = idsFor([ym]);
    const { r, bad } = draftRec(d);
    const c = monthCalc(r, ids);
    c.mix.forEach(x => MIX_F.forEach(([k]) => { const el = root.querySelector(`[data-p="mix:${x.id}:${k}"]`); if (el) el.textContent = pctTxt(x["p_" + k]); }));
    c.thru.forEach(x => { const el = root.querySelector(`[data-p="thru:${x.id}"]`); if (el) el.textContent = pctTxt(x.p_uld); });
    $$("[data-t]", root).forEach(el => { const k = el.dataset.t; el.textContent = fmtV(k, c.tot[k]); const pc = el.nextElementSibling; if (pc) pc.textContent = c.tot[k] ? "100.0%" : "-"; });
    $$(".ur-in", root).forEach(el => el.classList.toggle("bad", bad.indexOf(el.dataset.k) >= 0));
    const cm = $("#ur-cmp", root);
    if (cm) cm.innerHTML = compareDraft(c.tot);
    const dt = $("#ur-dirty", root);
    if (dt) dt.hidden = !d.dirty;
  }
  /* 붙여넣기 — 엑셀에서 복사한 칸(탭 · 줄바꿈). 첫 칸이 출발지 이름이면 그 줄에, 비중 칸이 섞여 있으면(5칸 이상) 값 칸만 */
  function pasteGrid(root, el, text) {
    const g = el.closest("[data-grid]");
    if (!g) return false;
    const grid = g.dataset.grid;
    const lines = String(text || "").replace(/\r/g, "").split("\n").filter(l => l.trim() !== "");
    if (!lines.length || (lines.length === 1 && lines[0].indexOf("\t") < 0)) return false;
    const ids = $$("tbody tr", g).map(tr => tr.dataset.id);
    const ncol = grid === "mix" ? 3 : 1;
    const r0 = Number(el.dataset.r), c0 = Number(el.dataset.c);
    let n = 0;
    lines.forEach((line, i) => {
      let cells = line.split("\t").map(s => s.trim());
      let row = r0 + i, col = c0;
      const head = (cells[0] || "").toUpperCase();
      if (head && !/^[\d.,%\s-]*$/.test(head)) {
        const at = ids.indexOf(head);
        if (at < 0) return;   // 소계 · 합계 · 모르는 줄
        row = at; col = 0; cells = cells.slice(1);
      }
      if (ncol === 3 && cells.length >= 5) cells = cells.filter((_, j) => j % 2 === 0);
      if (ncol === 1) cells = cells.slice(0, 1);
      cells.forEach((v, j) => {
        const cc = col + j;
        if (row >= ids.length || cc >= ncol) return;
        const key = grid === "mix" ? "mix:" + ids[row] + ":" + MIX_F[cc][0] : "thru:" + ids[row];
        const inp = g.querySelector(`.ur-in[data-k="${key}"]`);
        if (!inp) return;
        const clean = String(v).replace(/[,\s]/g, "");
        inp.value = clean; draft.v[key] = clean; n++;
      });
    });
    if (!n) return false;
    draft.dirty = true;
    recalc(root);
    return true;
  }
  function moveFocus(root, el, dr, dc) {
    const g = el.closest("[data-grid]");
    if (!g) return;
    const r = Number(el.dataset.r) + dr, c = Number(el.dataset.c) + dc;
    const t = g.querySelector(`.ur-in[data-r="${r}"][data-c="${c}"]`);
    if (t) { t.focus(); t.select(); }
  }
  function wireMonth(root) {
    $$(".ur-in", root).forEach(el => {
      el.addEventListener("focus", () => { focusKey = el.dataset.k; });
      el.addEventListener("input", () => {
        draft.v[el.dataset.k] = el.value;
        draft.dirty = true;
        recalc(root);
      });
      el.addEventListener("paste", (e) => {
        const tx = e.clipboardData && e.clipboardData.getData("text/plain");
        if (tx && pasteGrid(root, el, tx)) e.preventDefault();
      });
      el.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) { e.preventDefault(); saveMonth(); return; }
        if (e.key === "Enter") {   // Enter = 다음 칸(Tab 과 같은 순서) · Shift+Enter = 앞 칸
          e.preventDefault();
          const all = $$(".ur-in", root), i = all.indexOf(el);
          const t = all[i + (e.shiftKey ? -1 : 1)];
          if (t) { t.focus(); t.select(); }
          return;
        }
        if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(root, el, 1, 0); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(root, el, -1, 0); }
      });
    });
    if (focusKey && (!document.activeElement || document.activeElement === document.body)) {
      const el = root.querySelector(`.ur-in[data-k="${focusKey}"]`);
      if (el) { el.focus(); try { const n = el.value.length; el.setSelectionRange(n, n); } catch (e) { /* 선택 불가 입력 */ } }
    }
  }
  function saveMonth() {
    if (!canWrite() || !draft) return;
    const { r, bad } = draftRec(draft);
    if (bad.length) { toast("숫자를 확인하세요. MAWB · PCs · ULD 는 정수, 중량은 소수 5자리까지입니다.", true); return; }
    const target = draft.ym;
    const has = filled(r);
    if (!has && !filled(rec(target))) { toast("입력한 값이 없습니다.", true); return; }
    const put = () => {
      const st = S();
      const next = Object.assign({}, st);
      if (!Array.isArray(next.origins) || !next.origins.length) next.origins = originList().map(o => Object.assign({ id: o.id, c: o.c }, o.off ? { off: true } : {}));
      const ms = Object.assign({}, months());
      if (has) ms[target] = { mix: r.mix, thru: r.thru, at: new Date().toISOString(), by: (SeMIS.user && SeMIS.user.name) || "" };
      else delete ms[target];
      next.months = ms;
      SeMIS.data[KEY] = next;
      SeMIS.save();
      draft = null;
      toast(ymLabel(target) + (has ? " 자료를 저장했습니다." : " 자료를 삭제했습니다."));
      SeMIS.renderView();
    };
    if (!has) confirmModal("모든 칸이 비어 있습니다. " + ymLabel(target) + " 자료를 삭제하시겠습니까?", put);
    else put();
  }
  function deleteMonth(target) {
    if (!canWrite() || !filled(rec(target))) return;
    confirmModal(ymLabel(target) + " 자료(MIX · THRU)를 삭제하시겠습니까?", () => {
      const next = Object.assign({}, S());
      const ms = Object.assign({}, months());
      delete ms[target];
      next.months = ms;
      SeMIS.data[KEY] = next;
      SeMIS.save();
      if (draft && draft.ym === target) draft = null;
      toast(ymLabel(target) + " 자료를 삭제했습니다.");
      SeMIS.renderView();
    });
  }

  /* ── 연간 보기 ── */
  function yearHTML() {
    const yms = yearMonths(year);
    const ag = rangeAgg(yms);
    const w = canWrite();
    const mk = METRICS.find(x => x[0] === metric) || METRICS[0];
    const k = mk[0];
    const stats = ui.stats(METRICS.map(([kk, , lb]) => ({ label: lb, value: fmtV(kk, ag.tot[kk]), sub: ag.n ? ag.n + "개월 · 월평균 " + fmtN(ag.tot[kk] == null ? null : ag.tot[kk] / ag.n, decOf(kk)) : "자료 없음" })));
    if (!ag.n) return stats + `<section class="card">${ui.empty(year + "년 자료가 없습니다.", w ? `<button type="button" class="btn btn-ghost btn-sm" data-urgo="${esc(defaultYMin(year))}">${icon("plus", 16)}<span>입력하기</span></button>` : "")}</section>`;
    const max = Math.max(1, ...yms.map(m => total(rec(m), k) || 0));
    const rows = yms.map(m => {
      const r = rec(m), has = filled(r);
      const t = total(r, k), p = rec(ymAdd(m, -1));
      const cg = has && filled(p) ? change(t, total(p, k)) : null;
      const label = has || (w && m <= nowYM()) ? `<button type="button" class="ur-mlink" data-urgo="${m}">${esc(mLabel(m))}</button>` : esc(mLabel(m));
      return `<tr class="${has ? "" : "ur-nil"}"><th scope="row">${label}</th>${ag.ids.map(id => {
        const v = has ? val(r, id, k) : null;
        return `<td class="mono ur-v">${has ? (ymode === "p" ? pctTxt(share(v, t)) : fmtV(k, v)) : ""}</td>`;
      }).join("")}<td class="mono ur-v ur-tot">${has ? fmtV(k, t) : ""}</td>
        <td class="mono ur-v"><span class="ur-chg${chgCls(cg)}">${has ? esc(chgTxt(cg)) : ""}</span></td>
        <td class="ur-barc" aria-hidden="true">${has ? `<span class="ur-mbar" style="width:${Math.max(2, Math.round((t || 0) / max * 100))}%">${ag.ids.map(id => { const v = val(r, id, k); return v ? `<i style="flex:${v};--c:${colorOf(id)}"></i>` : ""; }).join("")}</span>` : ""}</td>
        ${w ? `<td class="td-act">${has ? `<button type="button" class="mt-btn danger" data-urdel="${m}" title="${esc(ymLabel(m))} 삭제" aria-label="${esc(ymLabel(m))} 삭제">${icon("trash", 16)}</button>` : ""}</td>` : ""}</tr>`;
    }).join("");
    const tot = ag.tot[k];
    const foot = `<tr><th scope="row">합계</th>${ag.ids.map(id => `<td class="mono ur-v">${fmtV(k, ag.by[id][k])}</td>`).join("")}<td class="mono ur-v ur-tot">${fmtV(k, tot)}</td><td></td><td></td>${w ? "<td></td>" : ""}</tr>
      <tr><th scope="row">비중</th>${ag.ids.map(id => `<td class="mono ur-v">${pctTxt(share(ag.by[id][k], tot))}</td>`).join("")}<td class="mono ur-v">${tot ? "100.0%" : "-"}</td><td></td><td></td>${w ? "<td></td>" : ""}</tr>
      <tr><th scope="row">월평균</th>${ag.ids.map(id => `<td class="mono ur-v">${fmtN(ag.by[id][k] == null ? null : ag.by[id][k] / ag.n, decOf(k))}</td>`).join("")}<td class="mono ur-v">${fmtN(tot == null ? null : tot / ag.n, decOf(k))}</td><td></td><td></td>${w ? "<td></td>" : ""}</tr>`;
    return stats + `<section class="card ur-card"><h2 class="card-title"><span class="ct-t">${esc(year)}년 · ${esc(mk[2])}</span><span class="dc-meta">${k === "uld" ? "ULD · FLT별 반출입현황" : "반출입 물동량현황"}${ymode === "p" ? " · 월 합계 대비 비중" : ""}</span></h2>
      <div class="table-wrap"><table class="tbl ur-year tbl-keep" data-no-stack>
        <thead><tr><th>월</th>${ag.ids.map(id => `<th class="ur-v">${sw(id)}${esc(id)}</th>`).join("")}<th class="ur-v">합계</th><th class="ur-v">전월 대비</th><th aria-label="구성 막대"></th>${w ? '<th aria-label="삭제"></th>' : ""}</tr></thead>
        <tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
    </section>`;
  }
  function defaultYMin(y) {
    const now = nowYM();
    const c = yearMonths(y).filter(m => m <= now && !filled(rec(m)));
    return c[0] || ymOf(y, 1);
  }

  /* ── 출발지 관리(시스템관리자) ── */
  function originsModal() {
    if (!canWrite()) return;
    let list = originList().map(o => Object.assign({}, o));
    const usedIn = (id) => allYMs().filter(m => hasOrigin(rec(m), id)).length;
    const paint = () => {
      $("#ur-olist").innerHTML = list.map((o, i) => {
        const n = usedIn(o.id);
        return `<li><span class="ur-oname">${swc(COLORS[o.c % COLORS.length])}<b>${esc(o.id)}</b><small>${n ? n + "개월 자료" : "자료 없음"}</small></span>
          <label class="ur-ochk"><input type="checkbox" data-uoon="${i}"${o.off ? "" : " checked"}> 입력 칸 표시</label>
          <button type="button" class="mt-btn" data-uoup="${i}" aria-label="${esc(o.id)} 위로"${i ? "" : " disabled"}>${icon("chevup", 16)}</button>
          <button type="button" class="mt-btn" data-uodn="${i}" aria-label="${esc(o.id)} 아래로"${i < list.length - 1 ? "" : " disabled"}>${icon("chevdown", 16)}</button>
          <button type="button" class="mt-btn danger" data-uodel="${i}" aria-label="${esc(o.id)} 삭제"${n ? ` disabled title="자료가 있어 지울 수 없습니다 — 입력 칸 표시를 끄세요"` : ""}>${icon("trash", 16)}</button></li>`;
      }).join("") + `<li class="ur-oetc"><span class="ur-oname">${sw(ETC)}<b>ETC</b><small>기타 — 고정</small></span></li>`;
      $$("[data-uoon]").forEach(b => b.onchange = () => { list[+b.dataset.uoon].off = !b.checked; });
      $$("[data-uoup]").forEach(b => b.onclick = () => { const i = +b.dataset.uoup; [list[i - 1], list[i]] = [list[i], list[i - 1]]; paint(); });
      $$("[data-uodn]").forEach(b => b.onclick = () => { const i = +b.dataset.uodn; [list[i + 1], list[i]] = [list[i], list[i + 1]]; paint(); });
      $$("[data-uodel]").forEach(b => b.onclick = () => { list.splice(+b.dataset.uodel, 1); paint(); });
      $("#ur-oadd").disabled = list.length >= MAX_ORIGINS;
    };
    openModal(`<h3>출발지 관리</h3>
      <ul class="ur-olist" id="ur-olist"></ul>
      <div class="ur-oform"><input type="text" id="ur-onew" maxlength="10" autocomplete="off" placeholder="새 출발지 코드 (예: SGN)" aria-label="새 출발지 코드">
        <button type="button" class="btn btn-ghost btn-sm" id="ur-oadd">${icon("plus", 16)}<span>추가</span></button></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="ur-ocancel">취소</button><button type="button" class="btn btn-primary" id="ur-osave">저장</button></div>`);
    paint();
    const addOne = () => {
      const inp = $("#ur-onew");
      const id = String(inp.value || "").trim().toUpperCase();
      if (!isCode(id) || id === ETC) { toast("영문 대문자 · 숫자 2~10자로 입력하세요.", true); return; }
      if (list.some(o => o.id === id)) { toast("이미 있는 출발지입니다.", true); return; }
      if (list.length >= MAX_ORIGINS) { toast("출발지는 " + MAX_ORIGINS + "곳까지입니다.", true); return; }
      const used = new Set(list.map(o => o.c));
      let c = 0; while (used.has(c)) c++;
      list.push({ id, c, off: false });
      inp.value = "";
      paint();
    };
    $("#ur-oadd").onclick = addOne;
    $("#ur-onew").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addOne(); } };
    $("#ur-ocancel").onclick = closeModal;
    $("#ur-osave").onclick = () => {
      if (!canWrite()) return;
      const next = Object.assign({}, S());
      next.origins = list.map(o => Object.assign({ id: o.id, c: o.c }, o.off ? { off: true } : {}));
      SeMIS.data[KEY] = next;
      SeMIS.save();
      closeModal();
      draft = dirty() ? draft : null;
      toast("출발지 목록을 저장했습니다.");
      SeMIS.renderView();
    };
  }

  /* ── 엑셀(.xlsx) — 외부 라이브러리 없이(ZIP = SemisHwpx.zip). 비중 · 소계 · 합계는 수식(+ 계산값) ── */
  const xesc = (v) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colName = (i) => { let s = "", n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  /* 셀 모양: 0 기본 · 1 제목 · 2 머리 · 3 글자 · 4 정수 · 5 소수 · 6 비율 · 7 합계 글자 · 8 합계 정수 · 9 합계 소수 · 10 합계 비율 · 11 안내 · 12 월(가운데) */
  const ST = { title: 1, head: 2, text: 3, int: 4, dec: 5, pct: 6, ttext: 7, tint: 8, tdec: 9, tpct: 10, note: 11, month: 12 };
  function sheetXML(sh) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const rows = sh.rows.map((row, ri) => `<row r="${ri + 1}">${(row || []).map((cell, ci) => {
      if (cell == null) return "";
      const o = typeof cell === "object" ? cell : { v: cell };
      const ref = colName(ci) + (ri + 1), st = o.s ? ` s="${o.s}"` : "";
      if (o.f) {
        const cv = o.v;
        if (typeof cv === "number" && isFinite(cv)) return `<c r="${ref}"${st}><f>${xesc(o.f)}</f><v>${Math.round(cv * 1e9) / 1e9}</v></c>`;
        return `<c r="${ref}"${st} t="str"><f>${xesc(o.f)}</f><v>${xesc(cv == null ? "" : cv)}</v></c>`;
      }
      if (o.v == null || o.v === "") return o.s ? `<c r="${ref}"${st}/>` : "";
      if (typeof o.v === "number" && isFinite(o.v)) return `<c r="${ref}"${st}><v>${o.v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xesc(o.v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const fz = sh.freeze ? (() => {
      const xs = sh.freeze.x || 0, ys = sh.freeze.y || 0;
      const tl = colName(xs) + (ys + 1);
      const pane = xs && ys ? "bottomRight" : ys ? "bottomLeft" : "topRight";
      return `<pane${xs ? ` xSplit="${xs}"` : ""}${ys ? ` ySplit="${ys}"` : ""} topLeftCell="${tl}" activePane="${pane}" state="frozen"/><selection pane="${pane}"/>`;
    })() : "";
    const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
    return X + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0">${fz}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16.5"/>${(sh.widths || []).length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : ""}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sh.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  }
  function bookParts(sheets) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const NSM = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", NSR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
    const font = (b, sz, rgb) => `<font>${b ? "<b/>" : ""}<sz val="${sz}"/>${rgb ? `<color rgb="${rgb}"/>` : ""}<name val="맑은 고딕"/><family val="3"/></font>`;
    const line = '<left style="thin"><color rgb="FFB8C2C0"/></left><right style="thin"><color rgb="FFB8C2C0"/></right><top style="thin"><color rgb="FFB8C2C0"/></top><bottom style="thin"><color rgb="FFB8C2C0"/></bottom><diagonal/>';
    const xf = (nf, f, fill, b, al) => `<xf numFmtId="${nf}" fontId="${f}" fillId="${fill}" borderId="${b}" xfId="0"${nf ? ' applyNumberFormat="1"' : ""}${f ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${b ? ' applyBorder="1"' : ""}${al ? ` applyAlignment="1"><alignment ${al}/></xf>` : "/>"}`;
    const C = 'horizontal="center" vertical="center"', V = 'vertical="center"';
    const xfs = [xf(0, 0, 0, 0), xf(0, 1, 0, 0), xf(0, 2, 2, 1, C + ' wrapText="1"'), xf(0, 0, 0, 1, V), xf(3, 0, 0, 1, V), xf(164, 0, 0, 1, V), xf(165, 0, 0, 1, V),
      xf(0, 2, 3, 1, V), xf(3, 2, 3, 1, V), xf(164, 2, 3, 1, V), xf(165, 2, 3, 1, V), xf(0, 3, 0, 0), xf(0, 2, 0, 1, C)];
    const styles = X + `<styleSheet xmlns="${NSM}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="4">${font(false, 10)}${font(true, 14)}${font(true, 10)}${font(false, 9, "FF5B6B71")}</fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EFEC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F2E8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${line}</border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const parts = [
      { name: "[Content_Types].xml", text: X + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", text: X + `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${NSR}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", text: X + `<workbook xmlns="${NSM}" xmlns:r="${NSR}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xesc(String(s.name).replace(/[\\/?*[\]:]/g, " ").slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", text: X + `<Relationships xmlns="${PR}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NSR}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${NSR}/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", text: styles }
    ];
    sheets.forEach((s, i) => parts.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", text: sheetXML(s) }));
    return parts;
  }
  /* 연간 통합 문서 — MIX(월 묶음 + TOTAL) · THRU(출발지 × 월) · 월별 합계 */
  function yearBook(y, stamp) {
    const yms = yearMonths(y).filter(m => filled(rec(m)));
    const ids = idsFor(yms);
    const note = (t) => [{ v: t, s: ST.note }];
    const dIdx = (id) => ids.indexOf(id);
    /* MIX */
    const mx = [[{ v: y + "년 미주행 재보안검색 현황 [MIX]", s: ST.title }], note("원본: 반출입 물동량현황(B3503) · WT(T) = 톤 · " + stamp), [],
      ["월", "출발지", "MAWB", "%", "PCs", "%", "WT(T)", "%"].map(v => ({ v, s: ST.head }))];
    const merges = [], blocks = [];
    const valCell = (k, v) => (v == null ? { s: k === "wt" ? ST.dec : ST.int } : { v, s: k === "wt" ? ST.dec : ST.int });
    const pctF = (col, r, tr, v, t, tot) => ({ f: `IF(${col}$${tr}=0,"",${col}${r}/${col}$${tr})`, v: t ? (v || 0) / t : "", s: tot ? ST.tpct : ST.pct });
    yms.forEach(m => {
      const r = rec(m);
      const c = monthCalc(r, ids);
      const r0 = mx.length + 1, tr = r0 + ids.length;
      c.mix.forEach((x, i) => {
        const rn = r0 + i;
        mx.push([i ? { s: ST.month } : { v: mLabel(m), s: ST.month }, { v: x.id, s: ST.text },
          valCell("mawb", x.mawb), pctF("C", rn, tr, x.mawb, c.tot.mawb), valCell("pcs", x.pcs), pctF("E", rn, tr, x.pcs, c.tot.pcs), valCell("wt", x.wt), pctF("G", rn, tr, x.wt, c.tot.wt)]);
      });
      const sumF = (col, k) => ({ f: `SUM(${col}${r0}:${col}${tr - 1})`, v: c.tot[k] || 0, s: k === "wt" ? ST.tdec : ST.tint });
      mx.push([{ s: ST.month }, { v: "S-TTL", s: ST.ttext }, sumF("C", "mawb"), pctF("C", tr, tr, c.tot.mawb, c.tot.mawb, true), sumF("E", "pcs"), pctF("E", tr, tr, c.tot.pcs, c.tot.pcs, true), sumF("G", "wt"), pctF("G", tr, tr, c.tot.wt, c.tot.wt, true)]);
      merges.push("A" + r0 + ":A" + tr);
      blocks.push({ r0, tr });
    });
    if (yms.length) {
      const ag = rangeAgg(yms);
      const r0 = mx.length + 1, tr = r0 + ids.length;
      ids.forEach((id, i) => {
        const rn = r0 + i;
        const sf = (col, k) => ({ f: blocks.map(b => col + (b.r0 + dIdx(id))).join("+"), v: ag.by[id][k] || 0, s: k === "wt" ? ST.dec : ST.int });
        mx.push([i ? { s: ST.month } : { v: "TOTAL", s: ST.month }, { v: id, s: ST.text },
          sf("C", "mawb"), pctF("C", rn, tr, ag.by[id].mawb, ag.tot.mawb), sf("E", "pcs"), pctF("E", rn, tr, ag.by[id].pcs, ag.tot.pcs), sf("G", "wt"), pctF("G", rn, tr, ag.by[id].wt, ag.tot.wt)]);
      });
      const sumF = (col, k) => ({ f: `SUM(${col}${r0}:${col}${tr - 1})`, v: ag.tot[k] || 0, s: k === "wt" ? ST.tdec : ST.tint });
      mx.push([{ s: ST.month }, { v: "TOTAL", s: ST.ttext }, sumF("C", "mawb"), pctF("C", tr, tr, ag.tot.mawb, ag.tot.mawb, true), sumF("E", "pcs"), pctF("E", tr, tr, ag.tot.pcs, ag.tot.pcs, true), sumF("G", "wt"), pctF("G", tr, tr, ag.tot.wt, ag.tot.wt, true)]);
      merges.push("A" + r0 + ":A" + tr);
    } else mx.push(note("자료가 없습니다."));
    /* THRU — 출발지 × 월(ULD · %) + TTL */
    const th = [[{ v: y + "년 미주행 재보안검색 현황 [THRU]", s: ST.title }], note("단위: ULD · 원본: FLT별 반출입현황(B3505) · " + stamp), []];
    const hd = [{ v: "출발지", s: ST.head }];
    yms.forEach(m => { hd.push({ v: mLabel(m), s: ST.head }, { v: "%", s: ST.head }); });
    hd.push({ v: "TTL", s: ST.head }, { v: "%", s: ST.head });
    th.push(hd);
    const tr0 = th.length + 1, ttr = tr0 + ids.length;
    const agT = rangeAgg(yms);
    ids.concat(["TOTAL"]).forEach((id, i) => {
      const rn = tr0 + i, isT = id === "TOTAL";
      const row = [{ v: id, s: isT ? ST.ttext : ST.text }];
      yms.forEach((m, j) => {
        const col = colName(1 + j * 2);
        const r = rec(m), t = total(r, "uld");
        if (isT) row.push({ f: `SUM(${col}${tr0}:${col}${ttr - 1})`, v: t || 0, s: ST.tint });
        else { const v = val(r, id, "uld"); row.push(v == null ? { s: ST.int } : { v, s: ST.int }); }
        row.push({ f: `IF(${col}$${ttr}=0,"",${col}${rn}/${col}$${ttr})`, v: t ? (isT ? t : (val(r, id, "uld") || 0)) / t : "", s: isT ? ST.tpct : ST.pct });
      });
      const tc = colName(1 + yms.length * 2);
      const tv = isT ? agT.tot.uld : agT.by[id].uld;
      row.push({ f: yms.length ? yms.map((_, j) => colName(1 + j * 2) + rn).join("+") : "0", v: tv || 0, s: isT ? ST.tint : ST.int });
      row.push({ f: `IF(${tc}$${ttr}=0,"",${tc}${rn}/${tc}$${ttr})`, v: agT.tot.uld ? (tv || 0) / agT.tot.uld : "", s: isT ? ST.tpct : ST.pct });
      th.push(row);
    });
    /* 월별 합계 */
    const sm = [[{ v: y + "년 미주행 재보안검색 월별 합계", s: ST.title }], note(stamp), [],
      ["월", "MIX MAWB", "MIX PCs", "MIX WT(T)", "THRU ULD"].map(v => ({ v, s: ST.head }))];
    const s0 = sm.length + 1;
    yms.forEach(m => {
      const r = rec(m);
      sm.push([{ v: mLabel(m), s: ST.text }, valCell("mawb", total(r, "mawb")), valCell("pcs", total(r, "pcs")), valCell("wt", total(r, "wt")), valCell("uld", total(r, "uld"))]);
    });
    if (yms.length) {
      const se = sm.length;
      const ag = rangeAgg(yms);
      sm.push([{ v: "합계", s: ST.ttext }].concat([["B", "mawb"], ["C", "pcs"], ["D", "wt"], ["E", "uld"]].map(([c, k]) => ({ f: `SUM(${c}${s0}:${c}${se})`, v: ag.tot[k] || 0, s: k === "wt" ? ST.tdec : ST.tint }))));
      sm.push([{ v: "월평균", s: ST.ttext }].concat([["B", "mawb"], ["C", "pcs"], ["D", "wt"], ["E", "uld"]].map(([c, k]) => ({ f: `AVERAGE(${c}${s0}:${c}${se})`, v: (ag.tot[k] || 0) / yms.length, s: ST.tdec }))));
    }
    return [
      { name: "MIX", widths: [8, 11, 11, 9, 11, 9, 12, 9], freeze: { y: 4 }, merges, rows: mx },
      { name: "THRU", widths: [11].concat(yms.flatMap(() => [8, 8])).concat([10, 8]), freeze: { x: 1, y: 4 }, rows: th, landscape: true },
      { name: "월별 합계", widths: [10, 12, 12, 12, 12], freeze: { y: 4 }, rows: sm }
    ];
  }
  async function xlsxBytes(sheets) {
    const Z = window.SemisHwpx;
    if (!Z || !Z.zip) throw new Error("zip");
    const te = new TextEncoder();
    return Z.zip(bookParts(sheets).map(p => ({ name: p.name, data: te.encode(p.text) })));
  }
  function stampText() {
    const d = new Date();
    return "H:drive 내보내기 " + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  async function exportYear(y) {
    y = y || year;
    try {
      const u8 = await xlsxBytes(yearBook(y, stampText()));
      const blob = new Blob([u8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "미주행_재보안검색_" + y + ".xlsx"; a.rel = "noopener";
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
      toast(y + "년 자료를 엑셀로 내려받았습니다.");
    } catch (e) { toast("엑셀 파일을 만들지 못했습니다.", true); }
  }

  /* ── 화면 ── */
  function render(root) {
    ensureState();
    if (!canRead()) { root.innerHTML = ui.head({ title: TITLE }) + `<section class="card">${ui.empty("볼 수 있는 권한이 없습니다.")}</section>`; return; }
    if (view === "month" && draft && draft.ym !== ym) draft = null;
    root.innerHTML = headHTML() + barHTML() + (view === "month" ? monthHTML() : yearHTML());
    wire(root);
  }
  function wire(root) {
    const sv = $("#ur-save", root);
    if (sv) sv.onclick = saveMonth;
    $("#ur-xlsx", root).onclick = () => exportYear(year);
    const og = $("#ur-origins", root);
    if (og) og.onclick = originsModal;
    const dc = $("#ur-del-cur", root);
    if (dc) dc.onclick = () => deleteMonth(ym);
    $$("[data-urv]", root).forEach(b => b.onclick = () => { if (b.dataset.urv === view) return; leave(() => { view = b.dataset.urv; if (view === "month" && ym.slice(0, 4) !== year) ym = defaultYMin(year); SeMIS.renderView(); }); });
    const yp = $("#ur-yprev", root), yn = $("#ur-ynext", root);
    const goYear = (d) => leave(() => {
      year = String(Number(year) + d);
      if (view === "month") { const k = ymOf(year, Number(ym.slice(5))); ym = k <= nowYM() ? k : defaultYMin(year); }
      SeMIS.renderView();
    });
    if (yp) yp.onclick = () => goYear(-1);
    if (yn) yn.onclick = () => goYear(1);
    $$("[data-urm]", root).forEach(b => b.onclick = () => { if (b.dataset.urm === ym) return; leave(() => { ym = b.dataset.urm; SeMIS.renderView(); }); });
    $$("[data-urk]", root).forEach(b => b.onclick = () => { metric = b.dataset.urk; SeMIS.renderView(); });
    $$("[data-ury]", root).forEach(b => b.onclick = () => { ymode = b.dataset.ury; SeMIS.renderView(); });
    $$("[data-urgo]", root).forEach(b => b.onclick = () => { ym = b.dataset.urgo; year = ym.slice(0, 4); view = "month"; draft = null; SeMIS.renderView(); });
    $$("[data-urdel]", root).forEach(b => b.onclick = () => deleteMonth(b.dataset.urdel));
    if (view === "month" && canWrite()) wireMonth(root);
  }

  /* ── 화물보안 대시보드 탭(manager 이상) ── */
  let sdMetric = "mawb";
  const INK = "#1f2d33", INK_PREV = "#98a2a8";
  const sdOk = () => canRead() && allYMs().length > 0;
  function lastN(n) { const end = latest(); const out = []; for (let i = n - 1; i >= 0; i--) out.push(ymAdd(end, -i)); return out; }
  function kpiCells(ymk) {
    const c = compare(ymk);
    return `<div class="ur-kpis" role="group" aria-label="${esc(ymLabel(ymk))} 실적">${METRICS.map(([k, , lb]) => `<div class="ur-kpi">
        <span class="ur-kl">${esc(lb)}</span><b class="mono">${fmtV(k, c[k].cur)}</b>
        <span class="ur-ks"><span>전월 <span class="ur-chg${chgCls(c[k].mom)}">${esc(chgTxt(c[k].mom))}</span></span><span>전년 <span class="ur-chg${chgCls(c[k].yoy)}">${esc(chgTxt(c[k].yoy))}</span></span></span></div>`).join("")}</div>`;
  }
  function colsHTML(yms, ids, k) {
    const tots = yms.map(m => total(rec(m), k) || 0);
    const max = Math.max(1, ...tots);
    const peak = tots.indexOf(Math.max(...tots));
    return `<div class="cc ur-cc" style="--n:${yms.length};--h:150px" role="img" aria-label="${esc("월별 " + (METRICS.find(x => x[0] === k) || [])[2] + " " + yms.map((m, i) => mLabel(m) + " " + fmtV(k, tots[i])).join(", "))}">
      <div class="cc-plot">${yms.map((m, i) => {
        const r = rec(m), t = tots[i];
        const tt = ymLabel(m) + (filled(r) ? " · 합계 " + fmtV(k, t) + " · " + ids.filter(id => val(r, id, k) != null).map(id => id + " " + fmtV(k, val(r, id, k)) + " (" + pctTxt(share(val(r, id, k), t)) + ")").join(" · ") : " · 자료 없음");
        return `<div class="cc-col" data-tt="${esc(tt)}" tabindex="-1">
          <span class="cc-v mono">${t && (i === peak || i === yms.length - 1) ? esc(fmtN(t, 0)) : ""}</span>
          <span class="cc-bar" style="height:${(t / max * 100).toFixed(1)}%">${ids.map(id => { const v = val(r, id, k); return v ? `<i style="flex:${v};--c:${colorOf(id)}"></i>` : ""; }).join("")}</span></div>`;
      }).join("")}</div>
      <div class="cc-x">${yms.map(m => `<span>${esc(m.slice(5) === "01" ? m.slice(2, 4) + "." + Number(m.slice(5)) : String(Number(m.slice(5))))}</span>`).join("")}</div></div>`;
  }
  function shareHTML(ag, k) {
    const tot = ag.tot[k];
    const rows = ag.ids.map(id => ({ id, v: ag.by[id][k] })).filter(x => x.v != null);
    const mx = Math.max(...rows.map(x => x.v || 0), 1);
    return `<div class="ur-share">${rows.map(x => `<div class="ur-sr" data-tt="${esc(x.id + " · " + fmtV(k, x.v) + " · " + pctTxt(share(x.v, tot)))}">
        <span class="ur-sl">${sw(x.id)}${esc(x.id)}</span><span class="ur-st"><i style="width:${Math.max(1, x.v / mx * 100).toFixed(1)}%;--c:${colorOf(x.id)}"></i></span>
        <b class="mono">${pctTxt(share(x.v, tot))}</b><span class="mono ur-sv">${fmtV(k, x.v)}</span></div>`).join("")}</div>`;
  }
  function yoyHTML(k) {
    const SD = window.SemisSecDash;
    const ly = latest().slice(0, 4), py = String(Number(ly) - 1);
    const series = [[ly, INK], [py, INK_PREV]].filter(([y]) => yearMonths(y).some(m => filled(rec(m))))
      .map(([y, color]) => ({ key: y, name: y + "년", color, pts: yearMonths(y).map((m, i) => [i + 1, filled(rec(m)) ? total(rec(m), k) : null]) }));
    if (!SD || !SD.lineChart || !series.length) return "";
    const lc = SD.lineChart({ id: "ur-yoy", series, x0: 1, x1: 12, yMin: 0, markers: "all", h: 140, fmt: (v) => fmtN(v, 0),
      xTicks: [1, 3, 5, 7, 9, 11].map(m => ({ t: m, label: m + "월" })), label: "연도별 월 추이 " + series.map(s => s.name).join(" · ") });
    const ch = SD.charts && SD.charts["ur-yoy"];
    if (ch) {
      ch.idx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      ch.tip = (i) => `<b>${i + 1}월</b>` + series.map(s => `<span><i style="--c:${s.color}"></i>${esc(s.name)} <b class="mono">${esc(s.pts[i][1] == null ? "-" : fmtV(k, s.pts[i][1]))}</b></span>`).join("");
    }
    return `<div class="sd-ph sd-ph2"><b>연도별 월 추이</b>${legendHTML(series.map(s => ({ name: s.name, color: s.color })))}</div>${lc}`;
  }
  const legendHTML = (items) => `<div class="sd-legend">${items.map(x => `<span><i style="--c:${x.color}"></i>${esc(x.name)}</span>`).join("")}</div>`;
  function tableHTML(yms, ids, k) {
    const has = yms.filter(m => filled(rec(m)));
    return `<details class="ur-tblv"><summary>표로 보기</summary><div class="table-wrap"><table class="tbl tbl-keep" data-no-stack>
      <thead><tr><th>월</th>${ids.map(id => `<th class="ur-v">${esc(id)}</th>`).join("")}<th class="ur-v">합계</th></tr></thead>
      <tbody>${has.map(m => `<tr><th scope="row">${esc(ymLabel(m))}</th>${ids.map(id => `<td class="mono ur-v">${fmtV(k, val(rec(m), id, k))}</td>`).join("")}<td class="mono ur-v">${fmtV(k, total(rec(m), k))}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
  function sdInner() {
    const k = sdMetric;
    const yms = lastN(12);
    const ag = rangeAgg(yms);
    const ids = ag.ids;
    const mk = METRICS.find(x => x[0] === k) || METRICS[0];
    const top = ids.map(id => ({ id, v: ag.by[id][k] || 0 })).sort((a, b) => b.v - a.v)[0];
    return `<div class="toolbar ur-sdbar"><div class="seg" role="group" aria-label="지표">${METRICS.map(([kk, lb]) => `<button type="button" class="seg-btn" data-ursd="${kk}" aria-pressed="${kk === k}">${esc(lb)}</button>`).join("")}</div>
        <span class="dc-meta">기준 ${esc(ymLabel(latest()))}</span></div>
      ${kpiCells(latest())}
      <div class="sd-grid">
        <div class="sd-pane"><div class="sd-ph"><b>월별 출발지 구성 · ${esc(mk[2])}</b>${legendHTML(ids.map(id => ({ name: id, color: colorOf(id) })))}</div>
          ${colsHTML(yms, ids, k)}
          <p class="sd-foot">최근 12개월 합계 <b class="mono">${fmtV(k, ag.tot[k])}</b> · 월평균 <b class="mono">${fmtN(ag.n && ag.tot[k] != null ? ag.tot[k] / ag.n : null, decOf(k))}</b>${top && top.v ? " · 최다 " + esc(top.id) + " <b class=\"mono\">" + pctTxt(share(top.v, ag.tot[k])) + "</b>" : ""}</p></div>
        <div class="sd-pane"><div class="sd-ph"><b>출발지 비중</b><span class="dc-meta">최근 12개월</span></div>${shareHTML(ag, k)}
          ${yoyHTML(k)}</div>
      </div>
      ${tableHTML(yms, ids, k)}`;
  }
  function sdPane() {
    if (!sdOk()) return "";
    return `<section class="card sd-card ur-sd" aria-label="미주행 재보안검색">
      <h2 class="card-title"><span class="ct-t">미주행 재보안검색</span><span class="dc-meta">MIX · THRU 출발지별</span><span class="spacer"></span>${menuOk() ? '<button type="button" class="link-btn" data-sd-go="us-rescreen">전체 보기</button>' : ""}</h2>
      <div id="ur-sdbody">${sdInner()}</div></section>`;
  }
  function sdWire(root) {
    const box = root && root.querySelector("#ur-sdbody");
    if (!box) return;
    $$("[data-ursd]", box).forEach(b => b.onclick = () => {
      sdMetric = b.dataset.ursd;
      box.innerHTML = sdInner();
      const SD = window.SemisSecDash;
      if (SD && SD.wireCharts) SD.wireCharts(box);
      sdWire(root);
    });
  }

  /* ── 홈 '오늘' 띠 — 전월 대비 변화율만 ── */
  function todayData() {
    if (!canRead()) return null;
    const last = latest();
    if (!last) return null;
    const p = rec(ymAdd(last, -1));
    const r = rec(last);
    return { ym: last, mix: filled(p) ? change(total(r, "mawb"), total(p, "mawb")) : null, thru: filled(p) ? change(total(r, "uld"), total(p, "uld")) : null, prev: filled(p) };
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });
  window.SemisUsr = {
    KEY, ETC, BASE, COLORS, ETC_COLOR, METRICS, MAX_ORIGINS,
    originList, colorOf, rec, filled, allYMs, latest, total, val, idsFor, monthCalc, rangeAgg, compare, change, chgTxt, parseIn, ymAdd,
    yearBook, bookParts, xlsxBytes, exportYear, sdOk, sdPane, sdWire, todayData,
    setToday(d) { todayOverride = d || ""; },
    setState(o) { o = o || {}; if (o.view) view = o.view; if (o.ym) { ym = o.ym; year = o.ym.slice(0, 4); } if (o.year) year = o.year; if (o.metric) metric = o.metric; if (o.ymode) ymode = o.ymode; if (o.reset) { draft = null; focusKey = ""; } },
    get draft() { return draft; }
  };
})();
