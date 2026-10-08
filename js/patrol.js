/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 일일 보안 · 안전 순찰일지 (v1.27, 라우트 daily-safety)
   종이 「Daily 보안/안전 순찰일지」(A4 한 장 = 5일)를 전산으로 옮긴 화면. 예정 메뉴 '일일 안전점검'을 대체한다.

   하루 기록 = 오전 순찰자 · 서명 / 오후 순찰자 · 서명 / 특이사항 / 이상 항목 → 보안감독자 확인 서명으로 끝.
   - 서명: 사람마다 한 번 그려 등록 → 이름만 누르면 서명 칸에 들어간다(그 자리에서 다시 그릴 수도 있음).
   - 점검사항: 기본은 전 항목 이상 없음. 이상 있는 항목만 눌러 표시하면 특이사항에 함께 인쇄된다.
   - 휴무 · 당직: 순찰이 없는 날은 당직근무자가 이름과 서명을 그때그때 남긴다(명단 등록 없음, 확인 칸에 '당직근무자 · 이름 · 서명' 인쇄).
   - 보안감독자 확인이 끝난 날은 잠긴다(고치려면 확인 취소).
   - 인쇄: 종이 양식과 같은 A4 세로 — 1~5 · 6~10 · … · 26~말일 한 장씩(31일은 26~31 여섯 줄).

   화면: 일지 작성(날짜별) · 월별 일지(5일 묶음 표 · 일괄 확인 · 미리보기) · 순찰자 · 서명
   데이터
     patrolCfg    = { title, asOf, since, secs[{ id, name, items[{ id, text }] }] }   — 점검사항 문구는 공용 DB에만(코드는 구분 뼈대)
     patrolPeople = [{ id, name, roles[](patrol · sup), sign(서명 이미지 주소), signAt, active, order }]  — 명단은 공용 DB에만
     patrol       = [{ id, date, am, pm, sup, off{ name, sign, at, by }, note, ng[{ id, sec, t, note }], createdAt/By, updatedAt/By }]
                    am · pm · sup = { pid, name, sign, t(순찰 시각, 확인은 없음), at, by } — 서명 주소는 그때 것을 그대로 남긴다
   권한: 열람 · 기록 · 순찰자 등록 mgr(권한표 patrol 2/2 · patrolPeople 2/2) · 양식 hq(patrolCfg 2/3).
   파일: 비공개 버킷 patrol/ 폴더(서명 이미지, 열람 2 · 올리기 2).
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "daily-safety";
  const KEY = "patrol", CFG = "patrolCfg", PPL = "patrolPeople";
  const TITLE = "일일 보안 · 안전 순찰일지";
  const FOLDER = "patrol";
  const LS_ME = "semisl:patrolMe";
  const PER = 5;                                   // 종이 한 장 = 5일
  const DEF_CFG = { title: "Daily 보안/안전 순찰일지", asOf: "As of 01AUG'25",
    secs: [{ id: "sec", name: "보안" }, { id: "dg", name: "위험물" }, { id: "saf", name: "안전" }] };
  const SLOT_NAME = { am: "오전 순찰", pm: "오후 순찰", sup: "보안감독자 확인" };
  const WD = ["일", "월", "화", "수", "목", "금", "토"];

  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "", fixedNow = "";
  const todayISO = () => fixedToday || toISO(new Date());
  const nowHM = () => fixedNow || (p2(new Date().getHours()) + ":" + p2(new Date().getMinutes()));
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const isYM = (s) => /^\d{4}-\d{2}$/.test(String(s || ""));
  const isHM = (s) => /^\d{2}:\d{2}$/.test(String(s || ""));
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const fromUTC = (t) => { const d = new Date(t); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()); };
  const addDays = (iso, n) => fromUTC(utc(iso) + n * 86400000);
  const dow = (iso) => new Date(utc(iso)).getUTCDay();
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const md = (iso) => Number(iso.slice(5, 7)) + "." + Number(iso.slice(8, 10));
  const dayLabel = (iso) => md(iso) + "(" + WD[dow(iso)] + ")";
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const normText = (s) => String(s == null ? "" : s).replace(/\r/g, "").split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const arr = (a) => (Array.isArray(a) ? a : []);
  const obj = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});
  const me = () => (SeMIS.user && SeMIS.user.name) || "";
  const nowISO = () => new Date().toISOString();
  const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const addMonth = (ym, n) => { let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + "-" + p2(m); };
  const ymLabel = (ym) => Number(ym.slice(0, 4)) + "년 " + Number(ym.slice(5, 7)) + "월";
  const canW = () => !!SeMIS.user && SeMIS.roleRank() >= 2 && SeMIS.user.role !== "vendor";
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "") || "dashboard";
  const signOk = (u) => typeof u === "string" && (/^https:\/\/[^\s"'<>]+$/.test(u) || /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(u));

  /* ─────── 양식 ─────── */
  function cfg() {
    const c = obj(D()[CFG]);
    const secs = arr(c.secs).filter(s => s && s.id && norm(s.name)).map(s => ({ id: String(s.id), name: norm(s.name),
      items: arr(s.items).filter(it => it && it.id && norm(it.text)).map(it => ({ id: String(it.id), text: norm(it.text) })) }));
    return {
      title: norm(c.title) || DEF_CFG.title,
      asOf: typeof c.asOf === "string" ? norm(c.asOf) : DEF_CFG.asOf,
      since: isISO(c.since) ? c.since : "",
      secs: secs.length ? secs : DEF_CFG.secs.map(s => ({ id: s.id, name: s.name, items: [] }))
    };
  }
  const itemsAll = () => [].concat.apply([], cfg().secs.map(s => s.items.map(it => ({ id: it.id, text: it.text, sec: s.name }))));

  /* ─────── 순찰자 · 보안감독자 ─────── */
  function pplList() { let a = D()[PPL]; if (!Array.isArray(a)) a = D()[PPL] = []; return a; }
  const peopleAll = () => arr(D()[PPL]).filter(p => p && p.id && norm(p.name)).slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const people = () => peopleAll().filter(p => p.active !== false);
  const hasRole = (p, r) => arr(p && p.roles).indexOf(r) >= 0;
  function roleList(slot) {
    const r = slot === "sup" ? "sup" : "patrol";
    const a = people().filter(p => hasRole(p, r));
    return a.length ? a : people();
  }
  const personOf = (id) => peopleAll().find(p => p.id === id) || null;
  function meMap() { try { return obj(JSON.parse(localStorage.getItem(LS_ME) || "{}")); } catch (e) { return {}; } }
  function rememberMe(slot, pid) {
    try { const m = meMap(); m[slot === "sup" ? "sup" : "patrol"] = pid; localStorage.setItem(LS_ME, JSON.stringify(m)); } catch (e) { /* 저장소 없음 */ }
  }
  const lastPid = (slot) => meMap()[slot === "sup" ? "sup" : "patrol"] || "";

  /* ─────── 하루 기록 ─────── */
  function list() { let a = D()[KEY]; if (!Array.isArray(a)) a = D()[KEY] = []; return a; }
  const days = () => arr(D()[KEY]).filter(r => r && r.id && isISO(r.date));
  function dayOf(iso) {
    const rs = days().filter(r => r.date === iso);
    if (rs.length < 2) return rs[0] || null;
    return rs.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)))[0];
  }
  function ensureDay(iso) {
    let r = dayOf(iso);
    if (!r) {
      r = { id: uid("pt"), date: iso, am: null, pm: null, sup: null, off: null, note: "", ng: [], createdAt: nowISO(), createdBy: me() };
      list().push(r);
    }
    return r;
  }
  const touch = (r) => { r.updatedAt = nowISO(); r.updatedBy = me(); };
  const slotOk = (s) => !!(s && typeof s === "object" && norm(s.name));
  const hasPatrol = (r) => !!(r && (slotOk(r.am) || slotOk(r.pm)));
  const isOff = (r) => !!(r && r.off && norm(r.off.name) && !hasPatrol(r));
  const ngOf = (r) => arr(r && r.ng).filter(n => n && n.id && norm(n.t));
  const hasAny = (r) => !!(r && (hasPatrol(r) || isOff(r) || slotOk(r.sup) || norm(r.note) || ngOf(r).length));
  const locked = (r) => !!(r && slotOk(r.sup) && hasPatrol(r));
  /* 같은 날짜 기록이 둘 생기면(두 기기에서 동시에 처음 기록) 하나로 합친다 */
  function dedupe() {
    const by = {};
    days().forEach(r => { (by[r.date] = by[r.date] || []).push(r); });
    let changed = false;
    Object.keys(by).forEach(d => {
      const rs = by[d];
      if (rs.length < 2) return;
      const k = dayOf(d);
      rs.filter(x => x !== k).forEach(x => {
        ["am", "pm", "sup", "off"].forEach(s => { if (!(k[s] && (s === "off" ? norm(k[s].name) : slotOk(k[s]))) && x[s]) k[s] = x[s]; });
        const xn = normText(x.note);
        if (xn && normText(k.note).indexOf(xn) < 0) k.note = [normText(k.note), xn].filter(Boolean).join("\n");
        ngOf(x).forEach(n => { if (!ngOf(k).some(m => m.id === n.id)) { if (!Array.isArray(k.ng)) k.ng = []; k.ng.push(n); } });
      });
      D()[KEY] = list().filter(r => r.date !== d || r === k);
      changed = true;
    });
    return changed;
  }

  /* ─────── 상태 ─────── */
  function since() {
    const c = cfg();
    if (c.since) return c.since;
    const ds = days().filter(hasAny).map(r => r.date).sort();
    return ds[0] || todayISO();
  }
  /* done 확인 완료 · wait 확인 대기 · prog 작성 중(오늘) · todo 오늘 미작성 · miss 기록 없음 · off 휴무 · 당직 · none 해당 없음(앞날 · 시작 전) */
  function stOf(iso, t0, s0) {
    t0 = t0 || todayISO();
    const r = dayOf(iso);
    if (iso > t0) return "none";
    if (isOff(r)) return "off";
    if (hasPatrol(r)) {
      if (slotOk(r.sup)) return "done";
      return iso < t0 || (slotOk(r.am) && slotOk(r.pm)) ? "wait" : "prog";
    }
    if (iso === t0) return "todo";
    return iso >= (s0 || since()) ? "miss" : "none";
  }
  const ST = { done: ["확인 완료", "green"], wait: ["확인 대기", "amber"], prog: ["작성 중", "blue"], todo: ["미작성", "gray"],
    miss: ["기록 없음", "red"], off: ["휴무 · 당직", "gray"], none: ["", "gray"] };
  const stChip = (s) => ST[s] && ST[s][0] ? ui.chip(ST[s][0], ST[s][1]) : "";
  /* 확인 대기(시작일부터) · 기록 없음(최근 30일) */
  function pending(t0) {
    t0 = t0 || todayISO();
    const s0 = since(), out = { wait: [], miss: [] };
    const missFrom = addDays(t0, -30);
    for (let d = s0, g = 0; d <= t0 && g < 4000; d = addDays(d, 1), g++) {
      const s = stOf(d, t0, s0);
      if (s === "wait") out.wait.push(d);
      else if (s === "miss" && d >= missFrom) out.miss.push(d);
    }
    return out;
  }

  /* ─────── 5일 묶음(종이 한 장) ─────── */
  function sheetOf(iso) {
    const ym = iso.slice(0, 7), L = lastDay(ym);
    const i = Math.min(5, Math.floor((Number(iso.slice(8, 10)) - 1) / PER));
    const a = i * PER + 1, b = i === 5 ? L : Math.min(L, a + PER - 1);
    return { ym, i, from: ym + "-" + p2(a), to: ym + "-" + p2(b), n: b - a + 1 };
  }
  function sheetsOf(ym) {
    const out = [], L = lastDay(ym);
    for (let i = 0; i < 6 && i * PER + 1 <= L; i++) out.push(sheetOf(ym + "-" + p2(i * PER + 1)));
    return out;
  }
  function datesIn(from, to) { const out = []; for (let d = from, g = 0; d <= to && g < 400; d = addDays(d, 1), g++) out.push(d); return out; }
  const sheetLabel = (sh) => md(sh.from) + " ~ " + md(sh.to);

  /* ═════════ 서명 패드 — 손가락 · 펜 · 마우스. 여백을 잘라 투명 PNG로 올린다(실패하면 data URL) ═════════ */
  let padDone = null;
  function signPad(o, done) {
    o = o || {};
    openModal(`<h3>${esc(o.title || "서명")}</h3>
      ${o.sub ? `<p class="pt-padsub">${esc(o.sub)}</p>` : ""}
      <div class="pt-padwrap"><canvas id="pt-pad" class="pt-pad" aria-label="서명 칸"></canvas><span class="pt-padline" aria-hidden="true"></span></div>
      ${o.askRegister ? `<label class="pt-chk"><input type="checkbox" id="pt-padreg" ${o.askRegister === "on" ? "checked" : ""}> 등록 서명도 이것으로 바꾸기</label>` : ""}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="clear" style="margin-right:auto">지우기</button>
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`);
    const cv = $("#pt-pad");
    const wrap = cv && cv.parentElement;
    const cssW = Math.max(260, Math.min((wrap && wrap.clientWidth) || 440, 520)), cssH = 200;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
    cv.width = Math.round(cssW * ratio); cv.height = Math.round(cssH * ratio);
    let ctx = null;
    try { ctx = cv.getContext ? cv.getContext("2d") : null; } catch (e) { ctx = null; }
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1c2a5e"; }
    let drawing = false, drawn = false, last = null, pid = null;
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top, p: ev.pressure }; };
    const width = (q) => (q.p && q.p > 0 && q.p !== 0.5 ? 1.6 + q.p * 2.4 : 2.6);
    cv.addEventListener("pointerdown", (ev) => {
      if (ev.button > 0) return;
      ev.preventDefault(); drawing = true; pid = ev.pointerId; last = pos(ev);
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* 무시 */ }
      if (ctx) { ctx.beginPath(); ctx.fillStyle = "#1c2a5e"; ctx.arc(last.x, last.y, width(last) / 2, 0, Math.PI * 2); ctx.fill(); drawn = true; }
    });
    cv.addEventListener("pointermove", (ev) => {
      if (!drawing || ev.pointerId !== pid || !ctx) return;
      ev.preventDefault();
      const evs = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [ev];
      (evs.length ? evs : [ev]).forEach(e2 => {
        const q = pos(e2);
        ctx.lineWidth = width(q);
        ctx.beginPath(); ctx.moveTo(last.x, last.y);
        const mx = (last.x + q.x) / 2, my = (last.y + q.y) / 2;
        ctx.quadraticCurveTo(last.x, last.y, mx, my); ctx.lineTo(q.x, q.y); ctx.stroke();
        last = q;
      });
      drawn = true;
    });
    const end = (ev) => { if (ev && pid !== null && ev.pointerId !== pid) return; drawing = false; pid = null; };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    $("#modal-box [data-act=clear]").onclick = () => { if (ctx) ctx.clearRect(0, 0, cssW, cssH); drawn = false; };
    $("#modal-box [data-act=cancel]").onclick = () => { padDone = null; if (o.onCancel) o.onCancel(); else closeModal(); };
    const finish = (url) => {
      const reg = $("#pt-padreg");
      const f = padDone; padDone = null;
      if (f) f(url, { register: o.askRegister ? !!(reg && reg.checked) : true });
    };
    padDone = done;
    $("#modal-box [data-act=ok]").onclick = () => {
      if (!drawn || !ctx) { toast("서명을 그려 주세요.", true); return; }
      const out = cropCanvas(cv);
      const dataFallback = () => { try { finish(out.toDataURL("image/png")); } catch (e) { toast("서명을 저장하지 못했습니다.", true); } };
      if (!(out.toBlob && window.SemisSync && SemisSync.uploadFile)) return dataFallback();
      $("#modal-box [data-act=ok]").disabled = true;
      out.toBlob((blob) => {
        if (!blob) return dataFallback();
        (async () => {
          try {
            const file = new File([blob], "sign_" + Date.now() + ".png", { type: "image/png" });
            const up = await SemisSync.uploadFile(file, FOLDER);
            finish(up.url);
          } catch (e) { dataFallback(); }
        })();
      }, "image/png");
    };
  }
  /* 그린 부분만 남기고 여백(8px) — 인쇄 칸에 크게 들어가도록 */
  function cropCanvas(cv) {
    try {
      const g = cv.getContext("2d");
      const w = cv.width, h = cv.height;
      const px = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) return cv;
      const pad = 8 * ((typeof window !== "undefined" && window.devicePixelRatio) || 1);
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
      const out = document.createElement("canvas");
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext("2d").drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return out;
    } catch (e) { return cv; }
  }
  const signImg = (u, cls) => signOk(u) ? `<img class="${cls || "pt-sig"}" src="${esc(u)}" alt="서명">` : "";

  /* ═════════ 기록 동작 ═════════ */
  function slotOf(r, slot) { return r && slotOk(r[slot]) ? r[slot] : null; }
  function stamp(iso, slot, p, sign, t) {
    const r = ensureDay(iso);
    const s = { pid: p.id, name: p.name, sign: signOk(sign) ? sign : "", at: nowISO(), by: me() };
    if (slot !== "sup") { s.t = isHM(t) ? t : iso === todayISO() ? nowHM() : ""; r.off = null; }
    r[slot] = s;
    touch(r);
    rememberMe(slot, p.id);
    return r;
  }
  /* 서명이 등록돼 있으면 그대로, 없으면 그려서 등록한 뒤 cb(sign) */
  function withSign(p, cb) {
    if (signOk(p.sign)) return cb(p.sign);
    signPad({ title: p.name + " 서명 등록", sub: "등록한 서명은 다음부터 이름만 누르면 들어갑니다." }, (url) => {
      const pp = personOf(p.id) || p;
      pp.sign = url; pp.signAt = nowISO();
      cb(url);
    });
  }
  const blockMsg = (iso) => iso > todayISO() ? "앞으로의 날짜에는 기록할 수 없습니다." : "";
  /* 이름 칩 누르기 — 순찰은 바로 기록, 확인은 순찰 기록을 확인한 뒤 */
  function takeSlot(iso, slot, pid) {
    if (!canW()) return;
    const p = personOf(pid);
    if (!p) return;
    const bm = blockMsg(iso);
    if (bm) { toast(bm, true); return; }
    const r = dayOf(iso);
    if (slot !== "sup" && locked(r)) { toast("보안감독자 확인이 끝난 날입니다. 확인을 취소한 뒤 고치세요.", true); return; }
    const go = () => withSign(p, (sign) => {
      stamp(iso, slot, p, sign);
      SeMIS.save(); closeModal(); paint();
      toast(slot === "sup" ? dayLabel(iso) + " 확인했습니다." : SLOT_NAME[slot] + " " + p.name + " 기록했습니다.");
    });
    if (slot === "sup") {
      if (!hasPatrol(r)) { toast("순찰 기록이 없습니다.", true); return; }
      const miss = !slotOk(r.am) ? "오전" : !slotOk(r.pm) ? "오후" : "";
      if (miss) { confirmModal(`${dayLabel(iso)} ${miss} 순찰 기록이 없습니다. 이대로 확인합니다.`, go); return; }
    }
    go();
  }
  function personChips(slot, sel, attr) {
    const ps = roleList(slot), mine = lastPid(slot);
    if (!ps.length) return `<p class="pt-none">등록된 ${slot === "sup" ? "보안감독자" : "순찰자"}가 없습니다.</p>`;
    return ps.map(p => `<button type="button" class="pt-pchip${p.id === mine ? " is-mine" : ""}" ${attr}="${esc(p.id)}" aria-pressed="${sel === p.id}">
      ${signOk(p.sign) ? "" : `<span class="pt-nosig" title="서명 미등록">${icon("edit", 13)}</span>`}<span>${esc(p.name)}</span></button>`).join("");
  }
  /* 채워진 칸 누르기 — 사람 · 시각 · 서명 바꾸기 · 비우기 (확인 칸은 취소) */
  function slotForm(iso, slot, st) {
    if (!canW()) return;
    const r = dayOf(iso);
    const cur = slotOf(r, slot);
    if (!cur) return;
    if (slot !== "sup" && locked(r)) { toast("보안감독자 확인이 끝난 날입니다. 확인을 취소한 뒤 고치세요.", true); return; }
    st = st || { pid: cur.pid, t: cur.t || "", sign: cur.sign || "", newSign: false, reg: false };
    const p = personOf(st.pid);
    openModal(`<h3>${esc(SLOT_NAME[slot])} <small class="au-mh">${esc(dot(iso))} (${WD[dow(iso)]})</small></h3>
      <div class="form-row"><label>${slot === "sup" ? "확인자" : "순찰자"}</label><div class="pt-pchips" id="pt-fpeople">${personChips(slot, st.pid, "data-fp")}</div>
        ${p ? "" : `<p class="pt-none">${esc(cur.name)} (명단에 없음)</p>`}</div>
      ${slot === "sup" ? "" : `<div class="form-row"><label for="pt-ft">순찰 시각</label><input type="time" id="pt-ft" value="${esc(st.t)}"></div>`}
      <div class="form-row"><label>서명</label><div class="pt-fsig">${signImg(st.sign, "pt-sig-lg") || '<span class="pt-none">서명 없음</span>'}
        <button type="button" class="btn btn-ghost btn-sm" id="pt-fredo">${icon("edit", 15)}<span>다시 서명</span></button></div></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" data-act="del">${slot === "sup" ? "확인 취소" : "비우기"}</button><span class="spacer" style="flex:1"></span>
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`);
    const keepT = () => { const el = $("#pt-ft"); if (el) st.t = el.value; };
    $$("#pt-fpeople [data-fp]").forEach(b => b.onclick = () => {
      keepT();
      const np = personOf(b.dataset.fp);
      if (!np || np.id === st.pid) return;
      st.pid = np.id; st.newSign = false;
      if (signOk(np.sign)) { st.sign = np.sign; slotForm(iso, slot, st); }
      else signPad({ title: np.name + " 서명 등록", sub: "등록한 서명은 다음부터 이름만 누르면 들어갑니다.", onCancel: () => slotForm(iso, slot, Object.assign(st, { pid: cur.pid, sign: cur.sign })) }, (url) => {
        np.sign = url; np.signAt = nowISO(); st.sign = url; slotForm(iso, slot, st);
      });
    });
    $("#pt-fredo").onclick = () => {
      keepT();
      const who = personOf(st.pid);
      signPad({ title: (who ? who.name : cur.name) + " 서명", askRegister: who ? "on" : "", onCancel: () => slotForm(iso, slot, st) }, (url, o) => {
        st.sign = url; st.newSign = true; st.reg = !!(who && o && o.register);
        slotForm(iso, slot, st);
      });
    };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=del]").onclick = () => confirmModal(slot === "sup" ? `${dayLabel(iso)} 보안감독자 확인을 취소합니다.` : `${dayLabel(iso)} ${SLOT_NAME[slot]} 기록을 비웁니다.`, () => {
      const rr = dayOf(iso); if (!rr) return;
      rr[slot] = null; touch(rr); SeMIS.save(); paint(); toast(slot === "sup" ? "확인을 취소했습니다." : "비웠습니다.");
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      keepT();
      const rr = dayOf(iso); if (!rr) return;
      const np = personOf(st.pid);
      const s = Object.assign({}, rr[slot]);
      if (np) { s.pid = np.id; s.name = np.name; }
      s.sign = signOk(st.sign) ? st.sign : "";
      if (slot !== "sup") s.t = isHM(st.t) ? st.t : "";
      s.at = nowISO(); s.by = me();
      rr[slot] = s;
      if (st.reg && np) { np.sign = st.sign; np.signAt = nowISO(); }
      touch(rr); SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }
  /* 휴무 · 당직 — 순찰이 없는 날 당직근무자가 이름과 서명을 남긴다(명단에 등록하지 않음, 서명은 매번 새로) */
  function offForm(iso, st) {
    if (!canW()) return;
    const bm = blockMsg(iso);
    if (bm) { toast(bm, true); return; }
    const r = dayOf(iso);
    if (hasPatrol(r)) { toast("순찰 기록이 있는 날입니다.", true); return; }
    const cur = r && r.off && norm(r.off.name) ? r.off : null;
    st = st || { name: cur ? norm(cur.name) : "" };
    const hasSig = !!(cur && signOk(cur.sign));
    const names = Array.from(new Set(days().map(x => x.off && norm(x.off.name)).filter(Boolean))).slice(0, 40);
    openModal(`<h3>순찰 없음 · 휴무 <small class="au-mh">${esc(dot(iso))} (${WD[dow(iso)]})</small></h3>
      <div class="form-row"><label for="pt-offn">당직근무자</label><input id="pt-offn" value="${esc(st.name)}" maxlength="30" autocomplete="off" list="pt-dl-off"></div>
      <datalist id="pt-dl-off">${names.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      ${cur ? `<div class="form-row"><label>서명</label><div class="pt-fsig">${hasSig ? signImg(cur.sign, "pt-sig-lg") : '<span class="pt-none">서명 없음</span>'}</div></div>` : ""}
      <div class="modal-actions">
        ${cur ? '<button type="button" class="btn btn-danger" data-act="del">해제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        ${hasSig ? '<button type="button" class="btn btn-ghost" data-act="redo">다시 서명</button>' : ""}
        <button type="button" class="btn btn-primary" data-act="ok">${hasSig ? "저장" : "서명하고 저장"}</button>
      </div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => { const rr = dayOf(iso); if (rr) { rr.off = null; touch(rr); SeMIS.save(); } closeModal(); paint(); toast("해제했습니다."); };
    const sign = (n) => signPad({ title: n + " 서명", sub: "당직근무자 · " + dot(iso), onCancel: () => offForm(iso, { name: n }) }, (url) => {
      const rr = ensureDay(iso);
      rr.off = { name: n, sign: url, at: nowISO(), by: me() };
      touch(rr); SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    });
    const nameOf = () => {
      const n = norm($("#pt-offn").value);
      if (!n) { toast("당직근무자를 입력하세요.", true); $("#pt-offn").focus(); return ""; }
      return n;
    };
    const redo = $("#modal-box [data-act=redo]");
    if (redo) redo.onclick = () => { const n = nameOf(); if (n) sign(n); };
    $("#modal-box [data-act=ok]").onclick = () => {
      const n = nameOf();
      if (!n) return;
      if (hasSig && n === norm(cur.name)) { closeModal(); return; }   // 바뀐 것 없음
      sign(n);                                                        // 새 기록이거나 이름이 바뀌면 서명을 새로
    };
  }
  /* 보안감독자 일괄 확인 — 확인 대기인 날을 한 번에 */
  function bulkConfirm(from, to) {
    if (!canW()) return;
    const t0 = todayISO();
    const ds = pending(t0).wait.filter(d => (!from || d >= from) && (!to || d <= to));
    if (!ds.length) { toast("확인 대기인 날이 없습니다.", true); return; }
    let pid = roleList("sup").some(p => p.id === lastPid("sup")) ? lastPid("sup") : "";
    const picked = new Set(ds);
    const paintM = () => {
      openModal(`<h3>보안감독자 확인 <small class="au-mh">확인 대기 ${ds.length}일</small></h3>
        <div class="form-row"><label>확인자</label><div class="pt-pchips" id="pt-bpeople">${personChips("sup", pid, "data-bp")}</div></div>
        <div class="form-row"><label>확인할 날</label><ul class="pt-blist">${ds.map(d => {
          const r = dayOf(d), miss = !slotOk(r.am) ? "오전 없음" : !slotOk(r.pm) ? "오후 없음" : "";
          const note = [normText(r.note).split("\n")[0], ngOf(r).length ? "이상 " + ngOf(r).length : ""].filter(Boolean).join(" · ");
          return `<li><label><input type="checkbox" data-bd="${d}" ${picked.has(d) ? "checked" : ""}>
            <b class="mono">${esc(dayLabel(d))}</b><span>${esc([slotOk(r.am) ? r.am.name : "", slotOk(r.pm) ? r.pm.name : ""].filter(Boolean).join(" · "))}</span>
            ${miss ? ui.chip(miss, "amber") : ""}${note ? `<small>${esc(note)}</small>` : ""}</label></li>`;
        }).join("")}</ul></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
          <button type="button" class="btn btn-primary" data-act="ok">${icon("check", 16)}<span>확인 서명</span></button></div>`, { wide: true });
      $$("#pt-bpeople [data-bp]").forEach(b => b.onclick = () => { pid = b.dataset.bp; paintM(); });
      $$("[data-bd]").forEach(c => c.onchange = () => { if (c.checked) picked.add(c.dataset.bd); else picked.delete(c.dataset.bd); });
      $("#modal-box [data-act=cancel]").onclick = closeModal;
      $("#modal-box [data-act=ok]").onclick = () => {
        const p = personOf(pid);
        if (!p) { toast("확인자를 고르세요.", true); return; }
        const sel = ds.filter(d => picked.has(d));
        if (!sel.length) { toast("확인할 날을 고르세요.", true); return; }
        withSign(p, (sign) => {
          sel.forEach(d => { const r = dayOf(d); if (r && hasPatrol(r) && !slotOk(r.sup)) stamp(d, "sup", p, sign); });
          SeMIS.save(); closeModal(); paint(); toast(sel.length + "일 확인했습니다.");
        });
      };
    };
    paintM();
  }
  /* 특이사항 · 이상 항목 메모 — 글 입력은 조용히 저장(다시 그리지 않음) */
  function saveNote(iso, v) {
    const r = dayOf(iso);
    const t = normText(v);
    if (!r && !t) return;
    if (locked(r)) return;
    if (iso > todayISO()) return;
    const rr = r || ensureDay(iso);
    if (normText(rr.note) === t) return;
    rr.note = t; touch(rr); SeMIS.save();
  }
  function toggleNG(iso, id) {
    if (!canW()) return;
    const bm = blockMsg(iso);
    if (bm) { toast(bm, true); return; }
    const r0 = dayOf(iso);
    if (locked(r0)) { toast("보안감독자 확인이 끝난 날입니다. 확인을 취소한 뒤 고치세요.", true); return; }
    const it = itemsAll().find(x => x.id === id);
    const r = r0 || ensureDay(iso);
    if (!Array.isArray(r.ng)) r.ng = [];
    const i = r.ng.findIndex(n => n && n.id === id);
    if (i >= 0) r.ng.splice(i, 1);
    else if (it) r.ng.push({ id, sec: it.sec, t: it.text, note: "" });
    touch(r); SeMIS.save(); paint();
  }
  function saveNGNote(iso, id, v) {
    const r = dayOf(iso);
    if (!r || locked(r)) return;
    const n = ngOf(r).find(x => x.id === id);
    if (!n || norm(n.note) === norm(v)) return;
    n.note = norm(v); touch(r); SeMIS.save();
  }
  function clearNG(iso) {
    const r = dayOf(iso);
    if (!r || locked(r) || !ngOf(r).length) return;
    r.ng = []; touch(r); SeMIS.save(); paint();
  }

  /* ═════════ 순찰자 · 서명 관리 ═════════ */
  function personForm(id, after) {
    if (!canW()) return;
    const x = id ? personOf(id) : null;
    if (id && !x) return;
    const v = x || { name: "", roles: ["patrol"], active: true };
    const used = x && days().some(r => ["am", "pm", "sup"].some(s => r[s] && r[s].pid === x.id));
    openModal(`<h3>${x ? "순찰자 수정" : "사람 추가"}</h3>
      <div class="form-row"><label for="pt-pn">이름</label><input id="pt-pn" value="${esc(v.name)}" maxlength="20" autocomplete="off"></div>
      <div class="form-row"><label>역할</label><div class="pt-roles">
        <label class="pt-chk"><input type="checkbox" id="pt-rp" ${hasRole(v, "patrol") ? "checked" : ""}> 순찰자</label>
        <label class="pt-chk"><input type="checkbox" id="pt-rs" ${hasRole(v, "sup") ? "checked" : ""}> 보안감독자</label></div></div>
      ${x ? `<label class="pt-chk"><input type="checkbox" id="pt-pa" ${v.active !== false ? "checked" : ""}> 사용</label>` : ""}
      <div class="modal-actions">
        ${x && (SeMIS.isAdmin() || (!used && SeMIS.canEdit())) ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
        <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
        <button type="button" class="btn btn-primary" data-act="ok">저장</button>
      </div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`${x.name}을(를) 명단에서 삭제합니다.${used ? " 이미 남긴 순찰 · 확인 기록과 서명은 그대로 남습니다." : ""}`, () => {
      D()[PPL] = pplList().filter(p => p.id !== x.id); SeMIS.save(); paint(); toast("삭제했습니다.");
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const name = norm($("#pt-pn").value);
      if (!name) { toast("이름을 입력하세요.", true); $("#pt-pn").focus(); return; }
      if (peopleAll().some(p => p.name === name && (!x || p.id !== x.id))) { toast("같은 이름이 이미 있습니다.", true); return; }
      const roles = [$("#pt-rp").checked ? "patrol" : "", $("#pt-rs").checked ? "sup" : ""].filter(Boolean);
      if (!roles.length) { toast("역할을 하나 이상 고르세요.", true); return; }
      let p = x;
      if (p) { p.name = name; p.roles = roles; const a = $("#pt-pa"); p.active = a ? a.checked : true; }
      else {
        p = { id: uid("pp"), name, roles, sign: "", signAt: "", active: true, order: peopleAll().reduce((m, q) => Math.max(m, Number(q.order) || 0), 0) + 1 };
        pplList().push(p);
      }
      SeMIS.save(); closeModal();
      if (after) after(p); else { paint(); toast("저장했습니다."); }
    };
  }
  function registerSign(id) {
    if (!canW()) return;
    const p = personOf(id);
    if (!p) return;
    signPad({ title: p.name + " 서명 " + (signOk(p.sign) ? "재등록" : "등록"), sub: "이미 남긴 기록의 서명은 바뀌지 않습니다." }, (url) => {
      p.sign = url; p.signAt = nowISO(); SeMIS.save(); closeModal(); paint(); toast("서명을 등록했습니다.");
    });
  }
  function movePerson(id, dir) {
    const ps = peopleAll();
    const i = ps.findIndex(p => p.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= ps.length) return;
    ps.forEach((p, k) => { p.order = k + 1; });
    const a = ps[i].order; ps[i].order = ps[j].order; ps[j].order = a;
    SeMIS.save(); paint();
  }

  /* ═════════ 양식 편집 (hq) ═════════ */
  function cfgForm() {
    if (!SeMIS.canEdit()) return;
    const c = cfg();
    const secs = c.secs.map(s => ({ id: s.id, name: s.name, items: s.items.slice() }));
    const rowHTML = (s, i) => `<div class="pt-csec" data-ci="${i}">
      <div class="pt-csec-h"><input data-k="name" value="${esc(s.name)}" maxlength="12" aria-label="구분 이름">
        <span class="cell-sub">${s.items.length}개</span>
        <button type="button" class="mt-btn danger" data-cdel="${i}" aria-label="구분 삭제">${icon("x", 14)}</button></div>
      <textarea data-k="items" rows="${Math.min(12, Math.max(3, s.items.length + 1))}" aria-label="${esc(s.name)} 점검사항 (한 줄에 하나)">${esc(s.items.map(it => it.text).join("\n"))}</textarea></div>`;
    const pull = () => $$("#pt-csecs .pt-csec").forEach(el => {
      const s = secs[Number(el.dataset.ci)];
      s.name = norm($("[data-k=name]", el).value);
      const old = s.items;
      s.items = $("[data-k=items]", el).value.split("\n").map(norm).filter(Boolean)
        .map(text => ({ id: (old.find(o => o.text === text) || {}).id || uid("pi"), text }));
    });
    const paintRows = () => {
      $("#pt-csecs").innerHTML = secs.map(rowHTML).join("");
      $$("[data-cdel]").forEach(b => b.onclick = () => { pull(); secs.splice(Number(b.dataset.cdel), 1); paintRows(); });
    };
    openModal(`<h3>순찰일지 양식</h3>
      <div class="form-grid">
        <div class="form-row"><label for="pt-ct">제목</label><input id="pt-ct" value="${esc(c.title)}" maxlength="40"></div>
        <div class="form-row"><label for="pt-ca">양식 표기 ${ui.tip("인쇄물 오른쪽 아래에 찍히는 양식 개정 표기입니다.", "양식 표기 설명")}</label><input id="pt-ca" value="${esc(c.asOf)}" maxlength="30"></div>
      </div>
      <div class="form-row"><label for="pt-cs">기록 시작일 ${ui.tip("이 날부터 빠진 날(기록 없음)을 셉니다. 비우면 첫 기록일부터 셉니다.", "기록 시작일 설명")}</label><input type="date" id="pt-cs" value="${esc(c.since)}"></div>
      <div class="form-row"><label>점검사항 <span class="cell-sub">구분별 · 한 줄에 하나</span></label><div class="pt-csecs" id="pt-csecs"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="pt-cadd">${icon("plus", 15)}<span>구분 추가</span></button></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`, { wide: true });
    paintRows();
    $("#pt-cadd").onclick = () => { pull(); secs.push({ id: uid("ps"), name: "", items: [] }); paintRows(); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      pull();
      const out = secs.filter(s => s.name);
      if (!out.length) { toast("구분을 하나 이상 두세요.", true); return; }
      const cur = obj(D()[CFG]);
      D()[CFG] = Object.assign({}, cur, { title: norm($("#pt-ct").value) || DEF_CFG.title, asOf: norm($("#pt-ca").value),
        since: isISO($("#pt-cs").value) ? $("#pt-cs").value : "", secs: out });
      SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }

  /* ═════════ 화면 상태 ═════════ */
  let tab = "day", curDate = "", curMonth = "";
  let chkOpen = false;   // v1.29 모바일: 점검 항목 목록 펼침(이상 항목이 있으면 늘 펼침)
  const TABS = [["day", "일지 작성"], ["month", "월별 일지"], ["people", "순찰자 · 서명"]];
  const selDate = () => { if (!isISO(curDate) || curDate > todayISO()) curDate = todayISO(); return curDate; };
  const selMonth = () => { if (!isYM(curMonth)) curMonth = selDate().slice(0, 7); return curMonth; };

  /* ═════════ 일지 작성 (하루) ═════════ */
  function slotCard(iso, slot, r) {
    const s = slotOf(r, slot), lock = locked(r), w = canW();
    const label = `<div class="pt-slot-h"><span class="pt-slot-t">${esc(SLOT_NAME[slot])}</span>${s && s.t ? `<span class="mono pt-slot-tm">${esc(s.t)}</span>` : ""}</div>`;
    if (s) {
      const inner = `<b class="pt-slot-name">${esc(s.name)}</b>${signImg(s.sign) || '<span class="pt-none">서명 없음</span>'}`;
      return `<section class="pt-slot is-on${slot === "sup" ? " is-sup" : ""}" data-slot="${slot}">${label}
        ${w && (slot === "sup" || !lock) ? `<button type="button" class="pt-slot-b" data-pt-edit="${slot}" aria-label="${esc(SLOT_NAME[slot])} ${esc(s.name)} 고치기">${inner}</button>` : `<div class="pt-slot-b">${inner}</div>`}
        ${slot === "sup" && whenOf(s.at) ? `<div class="pt-slot-f">확인 <span class="mono">${esc(whenOf(s.at))}</span></div>` : ""}</section>`;
    }
    if (slot === "sup") {
      const can = hasPatrol(r);
      return `<section class="pt-slot is-sup" data-slot="sup">${label}
        ${can ? (w ? `<div class="pt-pchips">${personChips("sup", "", "data-pt-take-sup")}</div>` : '<p class="pt-none">확인 전</p>')
          : `<p class="pt-none">순찰을 기록하면 확인할 수 있습니다.</p>`}</section>`;
    }
    return `<section class="pt-slot" data-slot="${slot}">${label}
      ${w ? `<div class="pt-pchips">${personChips(slot, "", "data-pt-take-" + slot)}<button type="button" class="pt-pchip is-add" data-pt-addp="${slot}">${icon("plus", 14)}<span>사람</span></button></div>` : '<p class="pt-none">기록 없음</p>'}</section>`;
  }
  /* 기록 시각(ISO) → "09.30 17:20" (이 기기 시간대) */
  function whenOf(isoT) {
    if (!isoT) return "";
    const d = new Date(isoT);
    return isNaN(d.getTime()) ? "" : p2(d.getMonth() + 1) + "." + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }
  function dayHTML() {
    const iso = selDate(), t0 = todayISO(), r = dayOf(iso), st = stOf(iso, t0), lock = locked(r), w = canW();
    const sh = sheetOf(iso);
    const strip = datesIn(sh.from, sh.to).map(d => {
      const s = stOf(d, t0);
      return `<button type="button" class="pt-dchip" data-pt-day="${d}" data-st="${s}" ${d === iso ? 'aria-current="date"' : ""} ${d > t0 ? "disabled" : ""}
        title="${esc(dayLabel(d) + (ST[s][0] ? " · " + ST[s][0] : ""))}"><b class="mono">${Number(d.slice(8, 10))}</b><small>${WD[dow(d)]}</small></button>`;
    }).join("");
    const pend = pending(t0);
    const nav = `<div class="pt-daynav">
      <div class="pt-dn-l"><button type="button" class="mt-btn" data-pt-step="-1" aria-label="앞 날">${icon("chevl", 17)}</button>
        <input type="date" id="pt-date" class="pt-dn-in mono" value="${esc(iso)}" max="${esc(t0)}" aria-label="날짜"><span class="pt-dn-wd">${WD[dow(iso)]}요일</span>
        <button type="button" class="mt-btn" data-pt-step="1" aria-label="다음 날" ${iso >= t0 ? "disabled" : ""}>${icon("chevron", 17)}</button>
        ${iso !== t0 ? `<button type="button" class="btn btn-ghost btn-sm" data-pt-day="${t0}">오늘</button>` : ""}
        ${stChip(st)}</div>
      <div class="pt-dn-r"><span class="pt-sheetl">${esc(sheetLabel(sh))}</span><div class="pt-dchips" role="group" aria-label="이 장의 날짜">${strip}</div></div></div>`;
    const off = isOff(r);
    const slots = off
      ? `<section class="pt-slot pt-offcard"><div class="pt-slot-h"><span class="pt-slot-t">순찰 없음 · 휴무</span></div>
          <div class="pt-offb"><span>당직근무자</span><b>${esc(r.off.name)}</b>${signImg(r.off.sign) || '<span class="pt-none">서명 없음</span>'}</div>
          ${w ? `<div class="pt-offact"><button type="button" class="btn btn-ghost btn-sm" data-pt-off="1">${icon("edit", 15)}<span>변경 · 해제</span></button></div>` : ""}</section>`
      : slotCard(iso, "am", r) + slotCard(iso, "pm", r);
    const supCard = off ? `<section class="pt-slot is-sup"><div class="pt-slot-h"><span class="pt-slot-t">보안감독자 확인</span></div><p class="pt-none">휴무일은 당직근무자 기록으로 끝납니다.</p></section>` : slotCard(iso, "sup", r);
    const otherWait = pend.wait.filter(d => d !== iso).length;
    const ng = ngOf(r);
    const secs = cfg().secs;
    const nItems = secs.reduce((n, s) => n + s.items.length, 0);
    const noteCard = `<section class="card pt-notecard">
      <div class="pt-ch"><h2 class="card-title">특이사항</h2>${lock ? `<span class="pt-lock">${icon("lock", 14)}<span>확인 완료 — 잠김</span></span>` : ""}</div>
      <textarea id="pt-note" rows="4" maxlength="1500" ${w && !lock ? "" : "readonly"} placeholder="${w && !lock ? "순찰 중 특이사항 (없으면 비워 둠)" : ""}">${esc(r ? r.note || "" : "")}</textarea>
      ${ng.length ? `<div class="pt-nglist"><div class="pt-ngh">${icon("alert", 15)}<b>이상 항목 ${ng.length}</b><span class="cell-sub">인쇄 시 특이사항에 함께 표시</span></div>
        ${ng.map(n => `<div class="pt-ngrow"><span class="pt-ngsec">${esc(n.sec || "")}</span><span class="pt-ngt">${esc(n.t)}</span>
          <input id="pt-ngn-${esc(n.id)}" data-ngn="${esc(n.id)}" value="${esc(n.note || "")}" maxlength="200" placeholder="내용 · 조치" ${w && !lock ? "" : "readonly"} aria-label="${esc(n.t)} 내용"></div>`).join("")}</div>` : ""}
      ${w && !hasPatrol(r) && !off && !lock ? `<div class="pt-noteact"><button type="button" class="btn btn-ghost btn-sm" data-pt-off="1">${icon("calendar", 15)}<span>순찰 없음 (휴무 · 당직)</span></button></div>` : ""}
    </section>`;
    const chkCard = `<section class="card pt-chkcard">
      <div class="pt-ch"><h2 class="card-title">점검사항</h2>
        ${nItems ? `<span class="pt-chksum" data-ng="${ng.length ? 1 : 0}">${ng.length ? "이상 " + ng.length : "전 항목 이상 없음"}</span>` : ""}
        <span class="spacer"></span>${ng.length && w && !lock ? `<button type="button" class="btn btn-ghost btn-sm" id="pt-ngclear">모두 이상 없음</button>` : ""}</div>
      ${nItems ? `<details class="pt-chkfold"${!(SeMIS.isMobile && SeMIS.isMobile()) || ng.length || chkOpen ? " open" : ""}>
        <summary>${icon("chevdown", 15)}<span>항목 ${nItems}개 · 이상 있는 항목만 눌러 표시</span></summary>` : ""}
      ${nItems ? secs.map(s => s.items.length ? `<div class="pt-csg"><div class="pt-csg-h">${esc(s.name)}</div><ul class="pt-items">${s.items.map(it => {
          const on = ng.some(n => n.id === it.id);
          return `<li><button type="button" class="pt-item" data-ngt="${esc(it.id)}" aria-pressed="${on}" ${w && !lock ? "" : "disabled"}>
            <span class="pt-item-t">${esc(it.text)}</span><span class="pt-item-v">${on ? "이상" : "이상 없음"}</span></button></li>`;
        }).join("")}</ul></div>` : "").join("") + "</details>"
        : ui.empty("점검사항이 없습니다.", SeMIS.canEdit() ? `<button type="button" class="btn btn-primary btn-sm" data-pt-cfg="1">${icon("sliders", 15)}<span>양식에서 넣기</span></button>` : "")}
    </section>`;
    return nav
      + `<div class="pt-slots${off ? " is-off" : ""}">${slots}${supCard}</div>`
      + (otherWait && w ? `<div class="pt-waitbar">${icon("clock", 16)}<span>확인 대기 <b class="mono">${otherWait}</b>일이 더 있습니다.</span><button type="button" class="btn btn-soft btn-sm" data-pt-bulk="1">한 번에 확인</button></div>` : "")
      + `<div class="pt-cols">${noteCard}${chkCard}</div>`;
  }

  /* ═════════ 월별 일지 (5일 묶음 표) ═════════ */
  function noteLines(r) {
    const out = [];
    const n = normText(r && r.note);
    if (n) out.push(...n.split("\n"));
    ngOf(r).forEach(x => out.push("※ " + (x.sec ? "[" + x.sec + "] " : "") + x.t + (norm(x.note) ? " — " + norm(x.note) : "")));
    return out;
  }
  function sheetCard(sh, t0) {
    const ds = datesIn(sh.from, sh.to);
    const sts = ds.map(d => stOf(d, t0));
    const wait = sts.filter(s => s === "wait").length, miss = sts.filter(s => s === "miss").length;
    const done = sts.every(s => s === "done" || s === "off" || s === "none") && sts.some(s => s !== "none");
    const cell = (s) => s ? `<span class="pt-tn">${esc(s.name)}</span>` : "";
    const sig = (s) => s && signOk(s.sign) ? signImg(s.sign, "pt-tsig") : "";
    return `<section class="card pt-sheet" data-from="${sh.from}">
      <div class="pt-sh-h"><b>${sh.i + 1}장</b><span class="mono">${esc(sheetLabel(sh))}</span>
        ${done ? ui.chip("확인 완료", "green") : ""}${wait ? ui.chip("확인 대기 " + wait, "amber") : ""}${miss ? ui.chip("기록 없음 " + miss, "red") : ""}
        <span class="spacer"></span>
        ${wait && canW() ? `<button type="button" class="btn btn-soft btn-sm" data-pt-bulk="${sh.from}|${sh.to}">${icon("check", 15)}<span>일괄 확인</span></button>` : ""}
        <button type="button" class="btn btn-ghost btn-sm" data-pt-prev="${sh.from}">${icon("eye", 15)}<span>미리보기</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-pt-print="${sh.from}">${icon("print", 15)}<span>인쇄</span></button></div>
      <div class="table-wrap"><table class="pt-stbl">
        <colgroup><col class="c-d"><col><col class="c-s"><col><col class="c-s"><col class="c-v"></colgroup>
        <thead><tr><th>일자</th><th>오전순찰자</th><th>서명</th><th>오후순찰자</th><th>서명</th><th>보안감독자 확인</th></tr></thead>
        ${ds.map((d, i) => {
          const r = dayOf(d), s = sts[i], lines = noteLines(r);
          const sup = isOff(r) ? `<div class="pt-tduty"><span>당직근무자</span><b>${esc(r.off.name)}</b>${signImg(r.off.sign, "pt-tsig")}</div>`
            : slotOk(r && r.sup) ? (signImg(r.sup.sign, "pt-tsup") || `<span class="pt-tn">${esc(r.sup.name)}</span>`) : stChip(s);
          return `<tbody class="pt-tday" data-st="${s}" data-pt-open="${d}" tabindex="${d > t0 ? -1 : 0}">
            <tr class="pt-r1"><th scope="row" class="pt-td">${Number(d.slice(8, 10))}일<small>${WD[dow(d)]}</small></th>
              <td class="pt-tnm" data-l="오전">${cell(slotOf(r, "am"))}</td><td class="pt-tsg">${sig(slotOf(r, "am"))}</td>
              <td class="pt-tnm" data-l="오후">${cell(slotOf(r, "pm"))}</td><td class="pt-tsg">${sig(slotOf(r, "pm"))}</td>
              <td class="pt-tsv" rowspan="2">${sup}</td></tr>
            <tr class="pt-r2"><th scope="row" class="pt-tl">특이사항</th><td colspan="4" class="pt-tsp">${lines.map(l => `<div${/^※/.test(l) ? ' class="is-ng"' : ""}>${esc(l)}</div>`).join("")}</td></tr>
          </tbody>`;
        }).join("")}
      </table></div></section>`;
  }
  function monthHTML() {
    const ym = selMonth(), t0 = todayISO(), s0 = since();
    const ds = datesIn(ym + "-01", ym + "-" + p2(lastDay(ym)));
    const sts = ds.map(d => stOf(d, t0, s0));
    const cnt = (k) => sts.filter(s => s === k).length;
    const ngN = ds.reduce((n, d) => n + ngOf(dayOf(d)).length, 0);
    const shs = sheetsOf(ym);
    return `<div class="pt-mnav"><button type="button" class="mt-btn" data-pt-mon="-1" aria-label="앞 달">${icon("chevl", 17)}</button>
        <b class="pt-mlabel">${esc(ymLabel(ym))}</b>
        <button type="button" class="mt-btn" data-pt-mon="1" aria-label="다음 달" ${ym >= t0.slice(0, 7) ? "disabled" : ""}>${icon("chevron", 17)}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" data-pt-pmon="1">${icon("print", 15)}<span>${Number(ym.slice(5, 7))}월 전체 인쇄</span></button></div>`
      + ui.stats([
        { label: "확인 완료", value: cnt("done"), tone: "ok" },
        { label: "확인 대기", value: cnt("wait"), tone: cnt("wait") ? "warn" : "muted" },
        { label: "기록 없음", value: cnt("miss"), tone: cnt("miss") ? "bad" : "muted" },
        { label: "휴무 · 당직", value: cnt("off"), tone: "muted" },
        { label: "이상 표시", value: ngN, tone: ngN ? "warn" : "muted" }
      ])
      + shs.map(sh => sheetCard(sh, t0)).join("");
  }

  /* ═════════ 순찰자 · 서명 ═════════ */
  function peopleHTML() {
    const all = peopleAll(), w = canW();
    const card = (p, i) => `<section class="pt-pcard${p.active === false ? " is-off" : ""}">
      <div class="pt-pc-h"><b>${esc(p.name)}</b>${hasRole(p, "patrol") ? ui.chip("순찰자", "blue") : ""}${hasRole(p, "sup") ? ui.chip("보안감독자", "green") : ""}${p.active === false ? ui.chip("사용 안 함", "gray") : ""}</div>
      <div class="pt-pc-sig">${signImg(p.sign, "pt-sig-lg") || `<span class="pt-none">서명 미등록</span>`}</div>
      ${p.signAt ? `<div class="pt-pc-at cell-sub">등록 ${esc(dot(String(p.signAt).slice(0, 10)))}</div>` : ""}
      ${w ? `<div class="pt-pc-f"><button type="button" class="btn ${signOk(p.sign) ? "btn-ghost" : "btn-primary"} btn-sm" data-pt-sign="${esc(p.id)}">${icon("edit", 15)}<span>${signOk(p.sign) ? "서명 재등록" : "서명 등록"}</span></button>
        <button type="button" class="btn btn-ghost btn-sm" data-pt-pedit="${esc(p.id)}">수정</button><span class="pt-pc-mv">
        <button type="button" class="mt-btn" data-pt-pmv="${esc(p.id)}|-1" title="이름 단추 순서 앞으로" aria-label="이름 단추 순서 앞으로" ${i ? "" : "disabled"}>${icon("chevl", 14)}</button>
        <button type="button" class="mt-btn" data-pt-pmv="${esc(p.id)}|1" title="이름 단추 순서 뒤로" aria-label="이름 단추 순서 뒤로" ${i < all.length - 1 ? "" : "disabled"}>${icon("chevron", 14)}</button></span></div>` : ""}
    </section>`;
    return `<section class="card">${w ? `<div class="pt-ptools"><button type="button" class="btn btn-primary btn-sm" data-pt-addp="list">${icon("plus", 15)}<span>사람 추가</span></button></div>` : ""}
      ${all.length ? `<div class="pt-pgrid">${all.map(card).join("")}</div>` : ui.empty("등록된 순찰자가 없습니다.")}</section>`;
  }

  /* ═════════ 인쇄 — 종이 양식과 같은 A4 세로 한 장 = 5일 ═════════ */
  const LOGO_A = [[0.846, 0.151], [0.613, 0.151], [0.109, 0.551], [0.372, 0.551], [0.372, 0.389], [0.65, 0.389]];
  const LOGO_B = [[0.861, 0.418], [0.673, 0.418], [0.673, 0.632], [0.395, 0.632], [0.126, 0.879], [0.524, 0.879]];
  const pts = (a) => a.map(([x, y]) => (x * 30).toFixed(1) + "," + (y * 30).toFixed(1)).join(" ");
  const LOGO_SVG = `<svg class="lg" viewBox="0 0 156 30" aria-label="AIRZETA" role="img">
    <text x="1" y="24.5" textLength="118" lengthAdjust="spacingAndGlyphs" font-family="'Arial Black','Helvetica Neue',Arial,sans-serif" font-weight="900" font-style="italic" font-size="25" fill="#111">AIRZETA</text>
    <g transform="translate(123 -1)"><polygon points="${pts(LOGO_A)}" fill="#5a5a5a"/><polygon points="${pts(LOGO_B)}" fill="#111"/></g></svg>`;
  const PRINT_CSS = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; color: #111; background: #fff; word-break: keep-all; }
  .sheet { position: relative; width: 210mm; height: 296.6mm; padding: 7mm 10mm 5mm; overflow: hidden; break-after: page; page-break-after: always; display: flex; flex-direction: column; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .ttl { height: 9.5mm; margin: 0 2.5mm; background: #e4e4e4; display: flex; align-items: center; justify-content: center; font-size: 19.5pt; font-weight: 800; letter-spacing: -.2pt; }
  .ym { height: 6.2mm; padding: 1.2mm 1mm 0 0; text-align: right; font-size: 10.5pt; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .top { border: 1.6pt solid #111; }
  .top th, .top td { border: .8pt solid #111; padding: 0 1.2mm; text-align: center; vertical-align: middle; overflow: hidden; }
  .top thead th { height: 6.4mm; background: #dcdcdc; font-size: 10pt; font-weight: 700; letter-spacing: -.2pt; }
  .top .d, .top .l { font-size: 10.5pt; font-weight: 400; }
  .top tbody.day { border-top: 1.2pt solid #111; }
  .top .nm { font-size: 11.5pt; font-weight: 500; white-space: nowrap; }
  .top .sg img { display: block; margin: 0 auto; max-width: 100%; max-height: 6mm; object-fit: contain; }
  .top .sp { text-align: left; padding: 1.2mm 3mm; line-height: 1.32; }
  .top .sp div { overflow-wrap: anywhere; }
  .top .sp .ng { font-weight: 600; }
  .top .sv img { display: block; margin: 0 auto; max-width: 92%; object-fit: contain; }
  .top .duty { display: flex; flex-direction: column; align-items: center; gap: .3mm; font-size: 11pt; line-height: 1.3; }
  .top .duty span { font-size: 10pt; }
  .top .duty b { font-weight: 500; }
  .gap { height: 2mm; flex: none; }
  .ckw { position: relative; }
  .ck { border: 1.6pt solid #111; }
  .ck th { height: 5.6mm; border: .8pt solid #111; font-size: 10pt; font-weight: 700; letter-spacing: 1.1em; text-indent: 1.1em; }
  .ck td { border: 0; vertical-align: middle; overflow: hidden; }
  .ck td.sec { border-right: .8pt solid #111; border-bottom: 1.2pt solid #111; text-align: center; font-size: 10.5pt; font-weight: 700; }
  .ck td.it { border-left: 2.6pt double #111; border-bottom: .5pt solid #b9b9b9; padding: 0 2mm 0 1.6mm; white-space: nowrap; text-overflow: clip; }
  .ck tr.last td.it { border-bottom: 1.2pt solid #111; }
  .ck tr:last-child td { border-bottom: 0; }
  .it::before { content: ""; display: inline-block; width: 2.3mm; height: 2.5mm; margin-right: 1.9mm; vertical-align: -.1mm; background: #111; clip-path: polygon(0 0, 100% 50%, 0 100%); }
  .lgw { position: absolute; right: 0; bottom: 1.8mm; width: 39.6mm; height: 10.5mm; padding: 1.8mm 2.8mm 1.4mm 2.4mm; background: #fff; }
  .ckw::after { content: ""; position: absolute; inset: 0; border: 1.6pt solid #111; pointer-events: none; }
  .lg { display: block; width: 100%; height: 100%; }
  .asof { margin-top: auto; padding: 1.2mm 1mm 0 0; text-align: right; font-size: 9.8pt; font-weight: 700; letter-spacing: .1pt; }
  @media screen {
    body { background: #d9dedd; padding: 14px 0; }
    .sheet { margin: 0 auto 14px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.18); }
  }`;
  /* 특이사항 글자 크기 — 칸 높이 안에 들어가는 가장 큰 크기 */
  function fitPt(lines, hMM, wMM) {
    const sizes = [10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5];
    for (const f of sizes) {
      const em = f * 0.3528;                          // mm
      const per = Math.max(8, Math.floor(wMM / (em * 0.93)));
      const need = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / per)), 0);
      if (need * em * 1.32 <= hMM - 2.2) return f;
    }
    return 6;
  }
  function sheetHTML(sh, o) {
    o = o || {};
    const c = cfg(), blank = !!o.blank;
    const ds = datesIn(sh.from, sh.to);
    const rows = Math.max(PER, ds.length);
    const BLOCK = 128.4, NAME_H = 7;
    const specH = BLOCK / rows - NAME_H;
    const supMax = Math.max(8, Math.min(16, BLOCK / rows - 5));
    const body = [];
    for (let i = 0; i < rows; i++) {
      const d = ds[i] || "";
      const r = d && !blank ? dayOf(d) : null;
      const am = slotOf(r, "am"), pm = slotOf(r, "pm"), sup = slotOf(r, "sup");
      const lines = r ? noteLines(r) : [];
      const f = lines.length ? fitPt(lines, specH, 138) : 10.5;
      const sv = r && isOff(r) ? `<div class="duty"><span>당직근무자</span><b>${esc(r.off.name)}</b>${signOk(r.off.sign) ? `<img src="${esc(r.off.sign)}" alt="" style="max-height:${Math.max(5, supMax - 8).toFixed(1)}mm">` : ""}</div>`
        : sup ? (signOk(sup.sign) ? `<img src="${esc(sup.sign)}" alt="" style="max-height:${supMax.toFixed(1)}mm">` : `<div class="duty">${esc(sup.name)}</div>`) : "";
      const nm = (s) => s ? esc(s.name) : "";
      const sg = (s) => s && signOk(s.sign) ? `<img src="${esc(s.sign)}" alt="">` : "";
      body.push(`<tbody class="day"><tr style="height:${NAME_H}mm"><td class="d">${d ? Number(d.slice(8, 10)) + "일" : ""}</td><td class="nm">${nm(am)}</td><td class="sg">${sg(am)}</td><td class="nm">${nm(pm)}</td><td class="sg">${sg(pm)}</td><td class="sv" rowspan="2">${sv}</td></tr>
        <tr style="height:${specH.toFixed(2)}mm"><td class="l">특이사항</td><td class="sp" colspan="4" style="font-size:${f}pt">${lines.map(l => `<div${/^※/.test(l) ? ' class="ng"' : ""}>${esc(l)}</div>`).join("")}</td></tr></tbody>`);
    }
    const secs = c.secs;
    const n = Math.max(1, secs.reduce((k, s) => k + Math.max(1, s.items.length), 0));
    const ih = Math.min(4.9, 118.5 / n), fs = Math.min(9.4, ih * 2.02);
    const ck = secs.map(s => {
      const its = s.items.length ? s.items : [{ text: "" }];
      return its.map((it, j) => `<tr class="${j === its.length - 1 ? "last" : ""}" style="height:${ih.toFixed(2)}mm">${j ? "" : `<td class="sec" rowspan="${its.length}">${esc(s.name)}</td>`}<td class="it" style="font-size:${fs.toFixed(2)}pt">${esc(it.text)}</td></tr>`).join("");
    }).join("");
    return `<section class="sheet">
      <div class="ttl">${esc(c.title)}</div>
      <div class="ym">${esc(ymLabel(sh.ym))}</div>
      <table class="top"><colgroup><col style="width:12.4%"><col style="width:18.4%"><col style="width:18.3%"><col style="width:18.3%"><col style="width:18.2%"><col style="width:14.4%"></colgroup>
        <thead><tr><th>일자</th><th>오전순찰자</th><th>서명</th><th>오후순찰자</th><th>서명</th><th>보안감독자 확인</th></tr></thead>${body.join("")}</table>
      <div class="gap"></div>
      <div class="ckw"><table class="ck"><colgroup><col style="width:12.4%"><col></colgroup>
        <thead><tr><th>구분</th><th>점검사항</th></tr></thead><tbody>${ck}</tbody></table>
        <div class="lgw">${LOGO_SVG}</div></div>
      ${c.asOf ? `<div class="asof">${esc(c.asOf)}</div>` : ""}
    </section>`;
  }
  function printDocHTML(shs, o) {
    const c = cfg();
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(c.title)} ${esc(shs.length ? ymLabel(shs[0].ym) : "")}</title><style>${PRINT_CSS}</style></head><body>${shs.map(sh => sheetHTML(sh, o)).join("")}</body></html>`;
  }
  let lastPrint = "";
  async function prepHTML(shs, o) {
    let html = printDocHTML(shs, o);
    try { if (window.SemisFileAuth) html = await SemisFileAuth.signHtml(html); } catch (e) { /* 서명 URL 실패 — 원래 주소 그대로 */ }
    lastPrint = html;
    return html;
  }
  async function printSheets(shs, o) {
    if (!shs.length) return;
    try {
      toast("인쇄 문서 준비 중…");
      const html = await prepHTML(shs, o);
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
      document.body.appendChild(fr);
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fire = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } };
      const ready = () => waitImages(doc).then(() => setTimeout(fire, 200));
      if (doc.readyState === "complete") ready(); else fr.onload = ready;
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) { toast("인쇄 대화상자를 열 수 없습니다.", true); }
  }
  function waitImages(doc) {
    const imgs = Array.from(doc.images || []).filter(im => !im.complete);
    if (!imgs.length) return Promise.resolve();
    return Promise.race([Promise.all(imgs.map(im => new Promise(res => { im.onload = im.onerror = res; }))), new Promise(res => setTimeout(res, 4000))]);
  }
  /* 미리보기 — 인쇄 문서를 그대로 줄여 보여 준다 */
  async function previewSheets(shs, o) {
    if (!shs.length) return;
    openModal(`<h3>미리보기 <small class="au-mh">${esc(ymLabel(shs[0].ym))} · ${shs.length}장</small></h3>
      <div class="pt-prev" id="pt-prev"><iframe id="pt-prev-fr" title="인쇄 미리보기"></iframe></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button>
        <button type="button" class="btn btn-primary" data-act="ok">${icon("print", 16)}<span>인쇄</span></button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => { closeModal(); printSheets(shs, o); };
    const html = await prepHTML(shs, o);
    const fr = $("#pt-prev-fr"), box = $("#pt-prev");
    if (!fr || !box) return;
    const W = 794, H = 1121 * shs.length + 14 * (shs.length + 1);
    const s = Math.min(1, ((box.clientWidth || 700) - 2) / W);
    fr.style.width = W + "px"; fr.style.height = H + "px"; fr.style.transform = "scale(" + s.toFixed(4) + ")";
    box.style.height = Math.round(H * s) + "px";
    try { const doc = fr.contentWindow.document; doc.open(); doc.write(html); doc.close(); } catch (e) { /* jsdom */ }
  }
  function printMenu() {
    const iso = selDate(), ym = tab === "month" ? selMonth() : iso.slice(0, 7);
    const sh = tab === "month" && ym !== iso.slice(0, 7) ? sheetsOf(ym)[0] : sheetOf(iso);
    const shs = sheetsOf(ym);
    const opts = [
      ["sheet", "이 장", sheetLabel(sh), [sh], {}],
      ["month", Number(ym.slice(5, 7)) + "월 전체", shs.length + "장", shs, {}],
      ["blank", "빈 양식", ymLabel(ym) + " · " + shs.length + "장", shs, { blank: true }]
    ];
    openModal(`<h3>인쇄 <small class="au-mh">종이 양식 · A4 세로</small></h3>
      <div class="pt-popts">${opts.map(([k, t, s]) => `<div class="pt-popt"><div><b>${esc(t)}</b><span>${esc(s)}</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-pv="${k}">${icon("eye", 15)}<span>미리보기</span></button>
        <button type="button" class="btn btn-primary btn-sm" data-pp="${k}">${icon("print", 15)}<span>인쇄</span></button></div>`).join("")}</div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const pick = (k) => opts.find(x => x[0] === k);
    $$("[data-pp]").forEach(b => b.onclick = () => { const x = pick(b.dataset.pp); closeModal(); printSheets(x[3], x[4]); });
    $$("[data-pv]").forEach(b => b.onclick = () => { const x = pick(b.dataset.pv); previewSheets(x[3], x[4]); });
  }

  /* ═════════ 렌더 ═════════ */
  function bodyHTML() { return tab === "month" ? monthHTML() : tab === "people" ? peopleHTML() : dayHTML(); }
  function captureFocus(root) {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    if (!a || !a.id || !root.contains(a) || !/^pt-(note|ngn-)/.test(a.id)) return null;
    let s = null, e = null;
    try { s = a.selectionStart; e = a.selectionEnd; } catch (err) { /* 선택 불가 */ }
    return { id: a.id, value: a.value, s, e };
  }
  function restoreFocus(root, f) {
    if (!f) return;
    const el = root.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(f.id) : f.id));
    if (!el || el.readOnly) return;
    if (el.value !== f.value) el.value = f.value;
    try { el.focus(); if (f.s != null) el.setSelectionRange(f.s, f.e); } catch (err) { /* jsdom */ }
  }
  let noteTimer = 0;
  function wire(root) {
    const iso = selDate();
    $$("[data-pttab]", root).forEach(b => b.onclick = () => { tab = b.dataset.pttab; paint(); });
    const pb = $("#pt-print", root); if (pb) pb.onclick = printMenu;
    const fd = $(".pt-chkfold", root); if (fd) fd.addEventListener("toggle", () => { chkOpen = fd.open; });
    const cb = $("#pt-cfg", root); if (cb) cb.onclick = cfgForm;
    $$("[data-pt-cfg]", root).forEach(b => b.onclick = cfgForm);
    $$("[data-pt-bulk]", root).forEach(b => b.onclick = () => { const v = b.dataset.ptBulk; const k = v.indexOf("|"); if (k > 0) bulkConfirm(v.slice(0, k), v.slice(k + 1)); else bulkConfirm("", ""); });
    const di = $("#pt-date", root);
    if (di) di.onchange = () => { if (isISO(di.value)) { curDate = di.value > todayISO() ? todayISO() : di.value; paint(); } };
    $$("[data-pt-step]", root).forEach(b => b.onclick = () => { const d = addDays(iso, Number(b.dataset.ptStep)); if (d <= todayISO()) { curDate = d; paint(); } });
    $$("[data-pt-day]", root).forEach(b => b.onclick = () => { curDate = b.dataset.ptDay; tab = "day"; paint(); });
    ["am", "pm"].forEach(s => $$("[data-pt-take-" + s + "]", root).forEach(b => b.onclick = () => takeSlot(iso, s, b.getAttribute("data-pt-take-" + s))));
    $$("[data-pt-take-sup]", root).forEach(b => b.onclick = () => takeSlot(iso, "sup", b.getAttribute("data-pt-take-sup")));
    $$("[data-pt-edit]", root).forEach(b => b.onclick = () => slotForm(iso, b.dataset.ptEdit));
    $$("[data-pt-addp]", root).forEach(b => b.onclick = () => {
      const slot = b.dataset.ptAddp;
      personForm("", slot === "am" || slot === "pm" ? (p) => takeSlot(iso, slot, p.id) : null);
    });
    $$("[data-pt-off]", root).forEach(b => b.onclick = () => offForm(iso));
    const note = $("#pt-note", root);
    if (note && !note.readOnly) {
      note.onchange = () => { clearTimeout(noteTimer); saveNote(iso, note.value); };
      note.oninput = () => { clearTimeout(noteTimer); noteTimer = setTimeout(() => saveNote(iso, note.value), 1200); };
    }
    $$("[data-ngn]", root).forEach(el => { if (!el.readOnly) el.onchange = () => saveNGNote(iso, el.dataset.ngn, el.value); });
    $$("[data-ngt]", root).forEach(b => b.onclick = () => toggleNG(iso, b.dataset.ngt));
    const nc = $("#pt-ngclear", root); if (nc) nc.onclick = () => confirmModal("표시한 이상 항목을 모두 지웁니다.", () => clearNG(iso));
    $$("[data-pt-mon]", root).forEach(b => b.onclick = () => { const m = addMonth(selMonth(), Number(b.dataset.ptMon)); if (m <= todayISO().slice(0, 7)) { curMonth = m; paint(); } });
    $$("[data-pt-pmon]", root).forEach(b => b.onclick = () => printSheets(sheetsOf(selMonth())));
    $$("[data-pt-print]", root).forEach(b => b.onclick = () => printSheets([sheetOf(b.dataset.ptPrint)]));
    $$("[data-pt-prev]", root).forEach(b => b.onclick = () => previewSheets([sheetOf(b.dataset.ptPrev)]));
    $$("[data-pt-open]", root).forEach(tb => {
      const d = tb.dataset.ptOpen;
      if (d > todayISO()) return;
      const open = (ev) => { if (ev && ev.target.closest("button, a")) return; curDate = d; tab = "day"; paint(); };
      tb.onclick = open;
      tb.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
    $$("[data-pt-sign]", root).forEach(b => b.onclick = () => registerSign(b.dataset.ptSign));
    $$("[data-pt-pedit]", root).forEach(b => b.onclick = () => personForm(b.dataset.ptPedit));
    $$("[data-pt-pmv]", root).forEach(b => b.onclick = () => { const [id, dir] = b.dataset.ptPmv.split("|"); movePerson(id, Number(dir)); });
  }
  function render(root) {
    const focus = captureFocus(root);
    if (canW() && dedupe()) SeMIS.save();
    const w = canW(), pend = pending();
    const acts = [
      SeMIS.canEdit() ? `<button type="button" class="link-btn head-link m-ed" id="pt-cfg">양식</button>` : "",
      w && pend.wait.length ? `<button type="button" class="btn btn-soft btn-sm" data-pt-bulk="1">${icon("check", 16)}<span>일괄 확인 <b class="mono">${pend.wait.length}</b></span></button>` : "",
      `<button type="button" class="btn btn-ghost btn-sm no-print" id="pt-print" data-print-btn="1" title="종이 양식으로 인쇄">${icon("print", 17)}<span>Print</span></button>`
    ].join("");
    root.innerHTML = ui.head({ title: TITLE, meta: "오전 · 오후 순찰 → 보안감독자 확인", actions: acts })
      + `<div class="eq-tabs pt-tabs" role="tablist" aria-label="순찰일지 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-pttab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>`
      + `<div id="pt-body" data-tab="${tab}">${bodyHTML()}</div>`;
    wire(root);
    restoreFocus(root, focus);
  }
  function paint() {
    const view = typeof document !== "undefined" ? document.getElementById("view") : null;
    if (view && routeNow() === MOD) render(view);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { if (!canW()) return ""; const p = pending(); return (p.wait.length + p.miss.length) || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "clipboard", module: MOD,
    items: () => days().filter(r => hasAny(r)).slice(-400).map(r => ({
      title: "순찰일지 " + dot(r.date) + " (" + WD[dow(r.date)] + ")",
      sub: [slotOk(r.am) ? r.am.name : "", slotOk(r.pm) ? r.pm.name : "", isOff(r) ? "당직 " + r.off.name : "", ngOf(r).length ? "이상 " + ngOf(r).length : ""].filter(Boolean).join(" · "),
      text: [r.note, ngOf(r).map(n => n.t + " " + (n.note || "")).join(" "), slotOk(r.am) && r.am.name, slotOk(r.pm) && r.pm.name, isOff(r) && r.off.name],
      route: MOD, pick: () => { tab = "day"; curDate = r.date; }
    }))
  });

  window.SemisPatrol = {
    DEF_CFG, cfg, people, peopleAll, roleList, personOf, days, dayOf, ensureDay, stOf, pending, since, sheetOf, sheetsOf, datesIn,
    noteLines, isOff, hasPatrol, locked, dedupe, fitPt, sheetHTML, printDocHTML, printSheets, previewSheets, printMenu,
    takeSlot, slotForm, offForm, bulkConfirm, saveNote, toggleNG, saveNGNote, personForm, registerSign, cfgForm, signPad, stamp,
    lastPrint: () => lastPrint,
    /* 시험용 — 서명 패드의 저장을 흉내(캔버스가 없는 환경) */
    _padCommit(url, o) { const f = padDone; padDone = null; if (f) f(url, o || { register: true }); },
    setToday(t, hm) { fixedToday = isISO(t) ? t : ""; fixedNow = isHM(hm) ? hm : ""; },
    getState() { return { tab, curDate: selDate(), curMonth: selMonth() }; },
    setState(o) { o = o || {}; if (o.tab) tab = o.tab; if (o.curDate !== undefined) curDate = String(o.curDate || ""); if (o.curMonth !== undefined) curMonth = String(o.curMonth || ""); }
  };
})();
