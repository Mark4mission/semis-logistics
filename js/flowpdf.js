/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 보고 체계도 PDF 분석 (v1.11 개정 반자동 반영)
   개정 PDF를 올리면
     ① 1쪽 글자·위치를 읽어 전화번호와 그 옆/위의 이름(라벨)을 찾고
     ② 지금 등록된 연락처와 번호를 대조해 그대로 · 바뀜 · 새 번호 · 못 찾음으로 나누고
     ③ 1쪽을 미리보기 이미지(1800px · 640px)로 만든다.
   반영은 사람이 확인해 고른 항목만 한다(contacts.js 편집 모달).
   PDF 읽기는 pdf.js(assets/vendor/pdfjs, legacy 빌드)를 필요할 때만 불러온다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const PDFJS_VER = "4.10.38";
  const LIB_URL = "assets/vendor/pdfjs/pdf.min.mjs?v=" + PDFJS_VER;
  const WORKER_URL = "assets/vendor/pdfjs/pdf.worker.min.mjs?v=" + PDFJS_VER;

  /* ─────── 번호 인식 ─────── */
  // 032-270-0700 · 270-0800 · 02-6026-1359, 1363 · 032-741-3906~8 · 1-734-484-0088 · 080-004 4949 · 740-2700,4,16
  const PHONE_RE = /(?:\+?\d{1,3}-)?(?:\d{2,4}[- ]){1,2}\d{4}(?:\s*~\s*\d{1,4})?(?:\s*,\s*\d{1,4})*/g;
  const SYMBOLS = /[☎☏📞📱✆℡]/g;

  const firstPart = (num) => String(num || "").split(/[~,/]/)[0];
  const keyOf = (num) => firstPart(num).replace(/\D/g, "");
  function sameNum(a, b) {
    if (!a || !b) return false;
    const s = a.length <= b.length ? a : b, l = a.length <= b.length ? b : a;
    return s.length >= 7 && l.endsWith(s);
  }
  /* 저장 형식: 7자리 지역 번호(270-0800)는 032를 붙이고, 공백 구분은 하이픈으로 */
  function formatNum(raw) {
    let s = String(raw || "").replace(/\s+/g, " ").trim();
    s = s.replace(/\s*~\s*/g, "~").replace(/\s*,\s*/g, ", ");
    s = s.replace(/^(\+?\d{1,4}-\d{3,4}) (\d{4})/, "$1-$2");
    if (/^[2-9]\d{2}-\d{4}(?!\d)/.test(s)) s = "032-" + s;
    else if (/^[2-9]\d{2}-\d{3}-\d{4}$/.test(s)) s = "+1-" + s;          // 북미(703-563-3240) — 국내 번호는 0으로 시작
    else if (/^[1-9]\d-\d{4}-\d{4}$/.test(s)) s = "+" + s;              // 국가번호 2자리(65-6476-9487)
    return s;
  }
  const clean = (t) => String(t || "").replace(SYMBOLS, " ").replace(/[\/·|]+/g, " ")
    .replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim();

  /* ─────── 글자 조각 → 줄 조각(segment) ───────
     items: [{ s, x, y, w, h }] — y 는 위에서부터(글자 기준선). 같은 높이라도 멀리 떨어진 글자는 다른 상자로 본다. */
  function buildSegments(items) {
    const list = (items || []).filter(i => i && String(i.s || "").trim()).slice()
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    list.forEach(it => {
      const h = Math.max(4, it.h || 10);
      const row = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, 0.45 * Math.min(h, r.h)));
      if (row) { row.items.push(it); row.h = Math.max(row.h, h); }
      else rows.push({ y: it.y, h, items: [it] });
    });
    const segs = [];
    rows.forEach(r => {
      r.items.sort((a, b) => a.x - b.x);
      let cur = null;
      r.items.forEach(it => {
        const h = Math.max(4, it.h || r.h);
        const gap = cur ? it.x - cur.x1 : 0;
        if (!cur || gap > Math.max(10, 1.4 * h)) {
          cur = { text: "", x0: it.x, x1: it.x + (it.w || 0), y: r.y, h: r.h };
          segs.push(cur);
        } else if (gap > 0.18 * h) cur.text += " ";
        cur.text += String(it.s);
        cur.x1 = Math.max(cur.x1, it.x + (it.w || 0));
      });
    });
    segs.forEach(s => { s.text = s.text.replace(/\s+/g, " ").trim(); });
    return segs.filter(s => s.text);
  }

  const overlapX = (a, b, tol) => a.x0 - tol <= b.x1 && b.x0 - tol <= a.x1;

  /* 번호 목록 — 각 번호에 라벨(이름 후보)·괄호 메모·위치를 붙인다 */
  function extractPhones(items) {
    const segs = buildSegments(items);
    const phones = [];
    segs.forEach((sg, si) => {
      const found = [];
      let m;
      PHONE_RE.lastIndex = 0;
      while ((m = PHONE_RE.exec(sg.text))) {
        const raw = m[0].trim().replace(/[\s,]+$/, "");
        if (keyOf(raw).length < 7) continue;
        found.push({ raw, start: m.index, end: m.index + m[0].length });
      }
      sg.phoneCount = found.length;
      sg.rest = clean(found.reduceRight((t, f) => t.slice(0, f.start) + " " + t.slice(f.end), sg.text));
      found.forEach((f, k) => {
        const len = Math.max(1, sg.text.length);
        let before = clean(sg.text.slice(k ? found[k - 1].end : 0, f.start));
        const wrapped = /^\(([^)]*)\)$/.exec(before);          // "(메모)" 뿐이면 이름이 아니라 메모
        let openNote = "";
        if (!wrapped && /^\([^)]*$/.test(before)) { openNote = before.slice(1).trim(); before = ""; }  // "(근무시간 외 010-…)"
        if (wrapped) before = "";
        if (!/[가-힣A-Za-z]/.test(before)) before = "";
        const after = sg.text.slice(f.end, k + 1 < found.length ? found[k + 1].start : undefined);
        const paren = /^\s*\(([^)]{1,30})\)?/.exec(after);
        const x0 = sg.x0 + (sg.x1 - sg.x0) * (f.start / len), x1 = sg.x0 + (sg.x1 - sg.x0) * (f.end / len);
        phones.push({ raw: f.raw, num: formatNum(f.raw), key: keyOf(f.raw), seg: si,
          x0, x1, y: sg.y, h: sg.h, sameLine: before.length >= 2 ? before : "",
          note: paren ? clean(paren[1]) : wrapped ? clean(wrapped[1]) : openNote });
      });
    });
    // 같은 줄에 이름이 없으면 ① 바로 왼쪽 조각 ② 위쪽(같은 상자) 순서로 번호가 아닌 글자를 찾는다
    const isName = (t) => t.length >= 2 && /[가-힣A-Za-z]/.test(t) && !/^\(.*\)$/.test(t) && !/^(보고|및|통보|내부|외부)$/.test(t);
    phones.forEach(p => {
      if (p.sameLine) { p.label = p.sameLine; return; }
      const box = { x0: p.x0, x1: p.x1 };
      const left = segs.filter(s => Math.abs(s.y - p.y) < 0.5 * p.h && s.x1 <= p.x0 + 1 && p.x0 - s.x1 < 6 * p.h && isName(s.rest))
        .sort((a, b) => b.x1 - a.x1)[0];
      const above = segs.filter(s => s.y < p.y - 1 && s.y > p.y - 5.5 * p.h && overlapX(s, box, 6) && isName(s.rest))
        .sort((a, b) => b.y - a.y)[0];
      p.label = (left && left.rest) || (above && above.rest) || "";
      if (!p.note) {
        const par = segs.find(s => !s.phoneCount && s.y < p.y - 1 && s.y > p.y - 2.4 * p.h && overlapX(s, box, 6) && /^\(.+\)$/.test(s.rest));
        if (par) p.note = par.rest.slice(1, -1).trim();
      }
    });
    return phones;
  }
  function detectVersion(items) {
    const t = (items || []).map(i => i.s).join(" ");
    const m = /Ver\s*\.?\s*(\d{2}\s*\.\s*\d{2})/i.exec(t.replace(/\s+/g, " "));
    return m ? m[1].replace(/\s+/g, "") : "";
  }

  /* ─────── 등록 연락처와 대조 ───────
     rows: [{ id, grp, role, office, mobile, note }] · phones: extractPhones 결과
     → { same:[{ri,f}], changed:[{ri,f,old,num,label}], added:[{num,label,note,grp}], missing:[{ri,f,old}] } */
  const nrm = (t) => String(t || "").replace(/\([^)]*\)/g, "").replace(/[\s·\-_/]+/g, "").toLowerCase();
  function similar(a, b) {
    const x = nrm(a), y = nrm(b);
    if (x.length < 2 || y.length < 2) return 0;
    if (x === y) return 3;
    if (x.includes(y) || y.includes(x)) return 2;
    for (let n = Math.min(x.length, y.length); n >= 3; n--) {
      for (let i = 0; i + n <= x.length; i++) if (y.includes(x.slice(i, i + n))) return 1;
    }
    return 0;
  }
  function diffRows(rows, phones) {
    rows = rows || []; phones = phones || [];
    const out = { same: [], changed: [], added: [], missing: [] };
    const used = new Set();
    const fields = [];
    rows.forEach((r, ri) => ["office", "mobile"].forEach(f => {
      const k = keyOf(r[f]);
      if (k) fields.push({ ri, f, k, old: r[f] });
    }));
    // ① 같은 번호
    fields.forEach(fd => {
      let pi = phones.findIndex((p, i) => !used.has(i) && sameNum(fd.k, p.key));
      if (pi < 0) pi = phones.findIndex(p => sameNum(fd.k, p.key));   // 한 번호가 여러 줄에 쓰인 경우
      if (pi >= 0) { used.add(pi); fd.pi = pi; out.same.push({ ri: fd.ri, f: fd.f }); }
    });
    const miss = fields.filter(fd => fd.pi == null);
    const free = () => phones.map((p, i) => i).filter(i => !used.has(i));
    // ② 바뀐 번호 — 같은 행의 다른 번호 바로 옆(같은 상자)에 새 번호가 있으면
    miss.forEach(fd => {
      const buddy = fields.find(o => o.ri === fd.ri && o.pi != null);
      if (!buddy) return;
      const b = phones[buddy.pi];
      const pi = free().find(i => {
        const p = phones[i];
        return Math.abs(p.y - b.y) <= 3.2 * Math.max(p.h, b.h) && (p.seg === b.seg || overlapX(p, b, 30));
      });
      if (pi != null) { used.add(pi); fd.pi = pi; fd.how = "pos"; }
    });
    // ③ 바뀐 번호 — 라벨이 행 이름과 같거나 비슷하면 (가장 비슷한 한 건)
    miss.filter(fd => fd.pi == null).forEach(fd => {
      const role = rows[fd.ri].role;
      let best = -1, bs = 0, tie = false;
      free().forEach(i => {
        const s = similar(phones[i].label, role);
        if (s > bs) { bs = s; best = i; tie = false; } else if (s && s === bs) tie = true;
      });
      if (best >= 0 && bs >= 2 && !tie) { used.add(best); fd.pi = best; fd.how = "label"; }
    });
    // ③-b 빈 칸 채움 — 행에 없던 번호(예: 휴대전화 신설)가 그 행 번호 옆이나 같은 이름 아래에 생긴 경우
    free().forEach(i => {
      const p = phones[i], f = /^01\d/.test(p.key) ? "mobile" : "office";
      const cands = rows.map((r, ri) => ri).filter(ri => !keyOf(rows[ri][f]) && fields.some(o => o.ri === ri && o.pi != null && !o.how));
      const near = cands.filter(ri => fields.some(o => {
        if (o.ri !== ri || o.pi == null) return false;
        const b = phones[o.pi];
        return Math.abs(p.y - b.y) <= 2.4 * Math.max(p.h, b.h) && (p.seg === b.seg || overlapX(p, b, 20));
      }));
      const byName = cands.filter(ri => similar(p.label, rows[ri].role) >= 2);
      const pick = near.length === 1 ? near[0] : (!near.length && byName.length === 1 ? byName[0] : -1);
      if (pick >= 0) { used.add(i); out.changed.push({ ri: pick, f, old: "", num: p.num, label: p.label, how: "fill" }); }
    });
    miss.forEach(fd => {
      if (fd.pi == null) out.missing.push({ ri: fd.ri, f: fd.f, old: fd.old });
      else out.changed.push({ ri: fd.ri, f: fd.f, old: fd.old, num: phones[fd.pi].num, label: phones[fd.pi].label, how: fd.how });
    });
    // ④ 새 번호 — 구분은 위치상 가장 가까운 등록 번호의 구분을 빌려 온다
    const matched = fields.filter(fd => fd.pi != null && !fd.how);
    free().forEach(i => {
      const p = phones[i];
      let grp = "", bd = Infinity;
      matched.forEach(fd => {
        const q = phones[fd.pi];
        const d = Math.abs(q.y - p.y) + 0.5 * Math.abs((q.x0 + q.x1) / 2 - (p.x0 + p.x1) / 2);
        if (d < bd) { bd = d; grp = rows[fd.ri].grp || ""; }
      });
      out.added.push({ num: p.num, label: p.label || "", note: p.note || "", grp, mobile: /^01\d/.test(p.key) });
    });
    return out;
  }

  /* ─────── pdf.js (필요할 때만) ─────── */
  let libP = null;
  function loadLib() {
    if (!libP) {
      const base = (typeof document !== "undefined" && document.baseURI) || "";
      libP = import(new URL(LIB_URL, base).href).then(lib => {
        lib.GlobalWorkerOptions.workerSrc = new URL(WORKER_URL, base).href;
        return lib;
      }).catch(e => { libP = null; throw e; });
    }
    return libP;
  }
  function canvasToBlob(cv, type, q) {
    return new Promise((res, rej) => {
      try { cv.toBlob(b => (b ? res(b) : rej(new Error("toBlob"))), type, q); } catch (e) { rej(e); }
    });
  }
  async function toImage(cv, w, name) {
    let src = cv;
    if (cv.width !== w) {
      src = document.createElement("canvas");
      src.width = w; src.height = Math.round(cv.height * w / cv.width);
      const g = src.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(cv, 0, 0, src.width, src.height);
    }
    let b = await canvasToBlob(src, "image/webp", w > 1000 ? 0.84 : 0.8);
    if (b.type !== "image/webp") b = await canvasToBlob(src, "image/jpeg", 0.86);   // Safari: webp 인코딩 미지원
    const ext = b.type === "image/webp" ? "webp" : "jpg";
    return new File([b], name + "." + ext, { type: b.type });
  }
  /* file(PDF) → { items, W, H, phones, ver, pages, image, thumb } — 이미지는 실패해도 글자 분석 결과는 돌려준다 */
  async function analyze(file, opts) {
    const lib = await loadLib();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    try {
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter(i => i && typeof i.str === "string" && i.str.trim()).map(i => ({
        s: i.str, x: i.transform[4], y: vp.height - i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) }));
      const res = { items, W: vp.width, H: vp.height, pages: doc.numPages, phones: extractPhones(items), ver: detectVersion(items) };
      if (!(opts && opts.noImage)) {
        try {
          const scale = 1800 / vp.width;
          const v2 = page.getViewport({ scale });
          const cv = document.createElement("canvas");
          cv.width = Math.round(v2.width); cv.height = Math.round(v2.height);
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
          await page.render({ canvasContext: ctx, viewport: v2 }).promise;
          const stem = "flow-" + Date.now().toString(36);
          res.image = await toImage(cv, 1800, stem);
          res.thumb = await toImage(cv, 640, stem + "-thumb");
        } catch (e) { res.imageError = String(e && e.message || e); }
      }
      return res;
    } finally { try { doc.destroy(); } catch (e) { /* noop */ } }
  }

  window.SemisFlowPdf = { analyze, loadLib, extractPhones, buildSegments, detectVersion, diffRows, formatNum, keyOf, sameNum, similar,
    LIB_URL, WORKER_URL };
})();
