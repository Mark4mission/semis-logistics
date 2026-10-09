/* HWPX(한글 OWPML) 양식 읽기 · 채우기 · 쓰기 · A4 인쇄 미리보기 — 외부 라이브러리 없이 ZIP + XML 직접 처리.
   양식 원본: assets/forms/ (국가법령정보센터 별표 HWP → HWPX 변환) */
"use strict";

(() => {
  const NS = {
    hp: "http://www.hancom.co.kr/hwpml/2011/paragraph",
    hs: "http://www.hancom.co.kr/hwpml/2011/section",
    hh: "http://www.hancom.co.kr/hwpml/2011/head",
    hc: "http://www.hancom.co.kr/hwpml/2011/core"
  };
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';

  const enc = (s) => new TextEncoder().encode(s);
  const dec = (u8) => new TextDecoder("utf-8").decode(u8);
  let CRC = null;
  function crc32(u8) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /* 압축 스트림 — 쓰기와 읽기를 함께 돌려 역압으로 멈추지 않게 */
  async function pipe(u8, ts) {
    const w = ts.writable.getWriter();
    const wp = w.write(u8).then(() => w.close());
    const r = ts.readable.getReader();
    const parts = [];
    let n = 0;
    for (;;) { const { value, done } = await r.read(); if (done) break; parts.push(value); n += value.length; }
    await wp;
    const out = new Uint8Array(n);
    let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }
  const inflate = (u8) => {
    if (typeof DecompressionStream === "undefined") throw new Error("inflate");
    return pipe(u8, new DecompressionStream("deflate-raw"));
  };
  const deflate = (u8) => typeof CompressionStream === "undefined" ? Promise.resolve(null) : pipe(u8, new CompressionStream("deflate-raw")).catch(() => null);

  /* ZIP 읽기 — 항목 순서 유지 */
  async function unzip(ab) {
    const u8 = ab instanceof Uint8Array ? ab : new Uint8Array(ab);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("zip");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = u8.slice(start, start + csize);
      if (method !== 0 && method !== 8) throw new Error("zip-method");
      out.push({ name, data: method === 0 ? raw : await inflate(raw), store: method === 0 });
    }
    return out;
  }
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  /* mimetype 은 첫 항목 · 무압축(OWPML 규칙), 나머지는 줄어들 때만 deflate */
  async function zip(entries, now) {
    const t = dosTime(now || new Date());
    const parts = [], cds = [];
    let off = 0;
    for (const e of entries) {
      const name = enc(e.name), raw = e.data;
      const crc = crc32(raw);
      let body = raw, method = 0;
      if (!e.store && e.name !== "mimetype") { const z = await deflate(raw); if (z && z.length < raw.length) { body = z; method = 8; } }
      const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, method, true);
      lv.setUint16(10, t.time, true); lv.setUint16(12, t.date, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, body.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      lh.set(name, 30);
      const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true); cv.setUint16(10, method, true);
      cv.setUint16(12, t.time, true); cv.setUint16(14, t.date, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, body.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, off, true);
      cd.set(name, 46);
      parts.push(lh, body); cds.push(cd);
      off += lh.length + body.length;
    }
    const cdSize = cds.reduce((n, c) => n + c.length, 0);
    const eo = new Uint8Array(22), ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
    const all = parts.concat(cds, [eo]);
    const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
    let o = 0;
    all.forEach(a => { out.set(a, o); o += a.length; });
    return out;
  }

  function parseXML(u8) {
    const doc = new DOMParser().parseFromString(dec(u8), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("xml");
    return doc;
  }
  const serialize = (doc) => XML_DECL + new XMLSerializer().serializeToString(doc.documentElement);
  const kids = (el, name, ns) => Array.from((el && el.childNodes) || []).filter(n => n.nodeType === 1 && n.localName === name && (!ns || n.namespaceURI === ns));
  const kid = (el, name, ns) => kids(el, name, ns)[0] || null;
  const all = (el, name, ns) => Array.from(el.getElementsByTagNameNS(ns || NS.hp, name));

  /* → { entries[{ name, data, store }], sec: section0.xml, head: header.xml } */
  async function open(src) {
    let ab = src;
    if (typeof src === "string") {
      const r = await fetch(src, { cache: "no-cache" });
      if (!r.ok) throw new Error("fetch " + r.status);
      ab = await r.arrayBuffer();
    }
    const entries = await unzip(ab);
    const get = (n) => entries.find(e => e.name === n);
    const s = get("Contents/section0.xml"), h = get("Contents/header.xml");
    if (!s || !h) throw new Error("hwpx");
    return { entries, sec: parseXML(s.data), head: parseXML(h.data) };
  }

  const tables = (pkg) => all(pkg.sec, "tbl");
  function cellsOf(tbl) {
    return kids(tbl, "tr", NS.hp).reduce((a, tr) => a.concat(kids(tr, "tc", NS.hp)), []);
  }
  function addr(tc) {
    const a = kid(tc, "cellAddr", NS.hp), s = kid(tc, "cellSpan", NS.hp), z = kid(tc, "cellSz", NS.hp);
    return { r: Number(a && a.getAttribute("rowAddr")) || 0, c: Number(a && a.getAttribute("colAddr")) || 0,
      rs: Number(s && s.getAttribute("rowSpan")) || 1, cs: Number(s && s.getAttribute("colSpan")) || 1,
      w: Number(z && z.getAttribute("width")) || 0, h: Number(z && z.getAttribute("height")) || 0 };
  }
  function cell(pkg, ref) {
    if (!Array.isArray(ref)) return null;
    const t = tables(pkg)[ref[0]];
    if (!t) return null;
    return cellsOf(t).find(tc => { const a = addr(tc); return a.r === ref[1] && a.c === ref[2]; }) || null;
  }
  const cellParas = (tc) => kids(kid(tc, "subList", NS.hp), "p", NS.hp);
  const topParas = (pkg) => kids(pkg.sec.documentElement, "p", NS.hp);
  function paraText(p) {
    return kids(p, "run", NS.hp).map(r => kids(r, "t", NS.hp).map(t => tText(t)).join("")).join("");
  }
  function tText(t) {
    return Array.from(t.childNodes).map(n => n.nodeType === 3 ? n.nodeValue : n.nodeType === 1 ? ({ tab: "    ", lineBreak: "\n", nbSpace: " ", fwSpace: "　", hyphen: "-" })[n.localName] || "" : "").join("");
  }
  const cellText = (tc) => cellParas(tc).map(paraText).join("\n");
  /* 문단 글 바꾸기 — 글자 모양은 첫 글 조각(없으면 첫 조각)의 것을 쓴다. 조판 부호(secPr · ctrl)는 그대로 둔다 */
  function setPara(p, text) {
    const doc = p.ownerDocument;
    const runs = kids(p, "run", NS.hp);
    let run = runs.find(r => kids(r, "t", NS.hp).length) || runs[runs.length - 1];
    if (!run) {
      run = doc.createElementNS(NS.hp, "hp:run");
      run.setAttribute("charPrIDRef", "0");
      const lsa = kid(p, "linesegarray", NS.hp);
      p.insertBefore(run, lsa);
    }
    runs.forEach(r => kids(r, "t", NS.hp).forEach(t => r.removeChild(t)));
    const s = String(text == null ? "" : text).replace(/\t/g, "    ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    if (s) {
      const t = doc.createElementNS(NS.hp, "hp:t");
      t.appendChild(doc.createTextNode(s));
      run.appendChild(t);
    }
    kids(p, "linesegarray", NS.hp).forEach(n => p.removeChild(n));
  }
  /* 칸 글 바꾸기 — 줄마다 문단 하나(첫 문단 모양을 복제) */
  function setCell(tc, lines, o) {
    if (!tc) return false;
    const ls = (Array.isArray(lines) ? lines : String(lines == null ? "" : lines).split("\n")).map(x => String(x == null ? "" : x));
    const ps = cellParas(tc);
    if (!ps.length) return false;
    const model = ps[0];
    ps.slice(1).forEach(p => p.parentNode.removeChild(p));
    if (o && o.para != null) model.setAttribute("paraPrIDRef", String(o.para));
    setPara(model, ls[0] || "");
    if (o && o.char != null) kids(model, "run", NS.hp).forEach(r => r.setAttribute("charPrIDRef", String(o.char)));   // 글자 모양(크기 · 글꼴)
    let prev = model;
    for (let i = 1; i < ls.length; i++) {
      const np = model.cloneNode(true);
      setPara(np, ls[i]);
      prev.parentNode.insertBefore(np, prev.nextSibling);
      prev = np;
    }
    return true;
  }

  /* 왼쪽 정렬 · 들여쓰기 없는 문단 모양 id — 서술형 답을 칸 왼쪽부터 쓰기 위해(없으면 null) */
  function plainPara(pkg) {
    if (pkg._plain !== undefined) return pkg._plain;
    const H = headInfo(pkg);
    const id = Object.keys(H.paras).find(k => { const x = H.paras[k]; return (x.align === "JUSTIFY" || x.align === "LEFT") && !x.left && !x.indent && !x.right && x.lsType === "PERCENT"; });
    pkg._plain = id == null ? null : id;
    return pkg._plain;
  }

  /* 가운데 정렬 · 여백 없는 문단 모양 id — ○ · 결재 이름을 칸 가운데에(없으면 null) */
  function centerPara(pkg) {
    if (pkg._center !== undefined) return pkg._center;
    const H = headInfo(pkg);
    const id = Object.keys(H.paras).find(k => { const x = H.paras[k]; return x.align === "CENTER" && !x.left && !x.indent && !x.right && x.lsType === "PERCENT"; });
    pkg._center = id == null ? null : id;
    return pkg._center;
  }

  /* 줄 배치 캐시(linesegarray)는 지워 한글이 열 때 다시 배치하게 한다 */
  async function build(pkg, o) {
    o = o || {};
    all(pkg.sec, "linesegarray").forEach(n => n.parentNode.removeChild(n));
    if (o.splitTables) tables(pkg).forEach(t => { if (t.getAttribute("pageBreak") === "NONE") t.setAttribute("pageBreak", "CELL"); });
    const entries = pkg.entries.map(e => {
      if (e.name === "Contents/section0.xml") return { name: e.name, data: enc(serialize(pkg.sec)) };
      if (e.name === "Preview/PrvText.txt" && o.preview != null) return { name: e.name, data: enc(String(o.preview)) };
      return { name: e.name, data: e.data, store: e.store };
    });
    return zip(entries, o.now);
  }
  function download(u8, name) {
    const blob = new Blob([u8], { type: "application/hwp+zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  /* A4 그리기(인쇄 · 미리보기). 길이 단위 HWPUNIT = 1/7200 in */
  const mm = (hu) => (Number(hu) || 0) * 25.4 / 7200;
  const f2 = (n) => (Math.round(n * 100) / 100).toString();
  const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SERIF = "'Batang','바탕','AppleMyungjo','Nanum Myeongjo','Noto Serif KR','Noto Serif CJK KR',serif";
  const SANS = "'Gulim','굴림','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";
  function family(face) {
    const f = String(face || "");
    if (/고딕|굴림|돋움|Gothic|Gulim|Dotum|Malgun|맑은|Sans|나눔고딕|Arial|Helvetica/i.test(f)) return (f ? "'" + f.replace(/'/g, "") + "'," : "") + SANS;
    return (f ? "'" + f.replace(/'/g, "") + "'," : "") + SERIF;
  }
  function headInfo(pkg) {
    if (pkg._head) return pkg._head;
    const h = pkg.head;
    const faces = {};
    const ff = all(h, "fontface", NS.hh).find(f => f.getAttribute("lang") === "HANGUL");
    if (ff) kids(ff, "font", NS.hh).forEach(f => { faces[f.getAttribute("id")] = f.getAttribute("face"); });
    const chars = {};
    all(h, "charPr", NS.hh).forEach(c => {
      const fr = kid(c, "fontRef", NS.hh), sp = kid(c, "spacing", NS.hh), ul = kid(c, "underline", NS.hh);
      chars[c.getAttribute("id")] = {
        pt: (Number(c.getAttribute("height")) || 1000) / 100, bold: !!kid(c, "bold", NS.hh), italic: !!kid(c, "italic", NS.hh),
        ul: !!ul && ul.getAttribute("type") !== "NONE", color: c.getAttribute("textColor") || "#000000",
        face: faces[fr ? fr.getAttribute("hangul") : "0"] || "", sp: sp ? Number(sp.getAttribute("hangul")) || 0 : 0
      };
    });
    const paras = {};
    all(h, "paraPr", NS.hh).forEach(p => {
      const al = kid(p, "align", NS.hh);
      const m = all(p, "margin", NS.hh)[0], ls = all(p, "lineSpacing", NS.hh)[0];
      const v = (n) => { const e = m ? Array.from(m.childNodes).find(x => x.nodeType === 1 && x.localName === n) : null; return e ? Number(e.getAttribute("value")) || 0 : 0; };
      paras[p.getAttribute("id")] = { align: al ? al.getAttribute("horizontal") : "JUSTIFY", left: v("left"), right: v("right"), indent: v("intent"),
        prev: v("prev"), next: v("next"), lsType: ls ? ls.getAttribute("type") : "PERCENT", ls: ls ? Number(ls.getAttribute("value")) || 160 : 160 };
    });
    const borders = {};
    all(h, "borderFill", NS.hh).forEach(b => {
      const side = (n) => { const e = kid(b, n, NS.hh); return e ? { type: e.getAttribute("type") || "NONE", w: parseFloat(e.getAttribute("width")) || 0.12, color: e.getAttribute("color") || "#000000" } : null; };
      const wb = all(b, "winBrush", NS.hc)[0];
      const bg = wb && wb.getAttribute("faceColor") && wb.getAttribute("faceColor") !== "none" ? wb.getAttribute("faceColor") : "";
      borders[b.getAttribute("id")] = { l: side("leftBorder"), r: side("rightBorder"), t: side("topBorder"), b: side("bottomBorder"), bg };
    });
    pkg._head = { faces, chars, paras, borders };
    return pkg._head;
  }
  function borderCSS(s) {
    if (!s || s.type === "NONE") return "none";
    const st = /DOUBLE/.test(s.type) ? "double" : /DASH/.test(s.type) ? "dashed" : /DOT|CIRCLE/.test(s.type) ? "dotted" : "solid";
    const w = st === "double" ? Math.max(0.6, s.w) : Math.max(0.1, s.w);
    return f2(w) + "mm " + st + " " + (s.color || "#000");
  }
  const ALIGN = { JUSTIFY: "justify", LEFT: "left", RIGHT: "right", CENTER: "center", DISTRIBUTE: "justify", DISTRIBUTE_SPACE: "justify" };
  function runHTML(run, H, out) {
    const cp = H.chars[run.getAttribute("charPrIDRef")] || H.chars["0"] || { pt: 10 };
    const st = `font-size:${f2(cp.pt)}pt;` + (cp.bold ? "font-weight:700;" : "") + (cp.italic ? "font-style:italic;" : "") + (cp.ul ? "text-decoration:underline;" : "")
      + (cp.color && cp.color !== "#000000" ? `color:${cp.color};` : "") + `font-family:${family(cp.face)};` + (cp.sp ? `letter-spacing:${f2(cp.sp / 100)}em;` : "");
    out.pt = Math.max(out.pt || 0, cp.pt);
    if (!out.st) out.st = st;
    Array.from(run.childNodes).forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.localName === "t") {
        const txt = Array.from(n.childNodes).map(x => x.nodeType === 3 ? escH(x.nodeValue) : x.nodeType === 1
          ? ({ tab: "    ", lineBreak: "<br>", nbSpace: "&nbsp;", fwSpace: "&#12288;", hyphen: "-" })[x.localName] || "" : "").join("");
        if (txt) out.html += `<span style="${st}">${txt}</span>`;
      } else if (n.localName === "tbl") out.tbls.push(n);
    });
  }
  /* last: 칸 안 마지막 문단 — 한글은 칸 높이에 마지막 줄의 줄 간격을 넣지 않는다 */
  function paraHTML(p, H, inCell, last) {
    const pp = H.paras[p.getAttribute("paraPrIDRef")] || { align: "JUSTIFY", ls: 160, lsType: "PERCENT" };
    const o = { html: "", tbls: [], pt: 0, st: "" };
    kids(p, "run", NS.hp).forEach(r => runHTML(r, H, o));
    const fs = o.pt || 10;                                       // 문단의 가장 큰 글자(pt)
    const pct = pp.lsType === "PERCENT";
    const lh = pct ? f2(Math.max(1, pp.ls / 100)) : f2(mm(pp.ls)) + "mm";
    /* 한글의 퍼센트 줄 간격: 글자는 줄 맨 위, 간격((비율-1)×글자)은 줄 아래. CSS 는 위아래 반씩이라 반만큼 끌어올린다 */
    const hl = pct ? Math.max(0, pp.ls / 100 - 1) * fs / 2 : 0;   // pt
    const mt = mm(pp.prev || 0) - hl * 25.4 / 72, mb = mm(pp.next || 0) + (last ? -hl : hl) * 25.4 / 72;
    /* 한글의 내어쓰기(음수 들여쓰기)는 첫 줄이 왼쪽 여백에서 시작하고 둘째 줄부터 들어간다 */
    const left = pp.left + (pp.indent < 0 ? -pp.indent : 0);
    const st = `font-size:${f2(fs)}pt;text-align:${ALIGN[pp.align] || "justify"};line-height:${lh};` + (left ? `margin-left:${f2(mm(left))}mm;` : "") + (pp.right ? `margin-right:${f2(mm(pp.right))}mm;` : "")
      + (pp.indent ? `text-indent:${f2(mm(pp.indent))}mm;` : "") + (Math.abs(mt) > 0.005 ? `margin-top:${f2(mt)}mm;` : "") + (Math.abs(mb) > 0.005 ? `margin-bottom:${f2(mb)}mm;` : "");
    const pb = !inCell && p.getAttribute("pageBreak") === "1" ? " hx-pb" : "";
    let s = "";
    if (o.html || !o.tbls.length) s += `<p class="hx-p${pb}" style="${st}${o.st && !o.html ? o.st : ""}">${o.html || "&nbsp;"}</p>`;
    /* 표는 블록(display:table)으로 — inline-table 은 인쇄 때 쪽 나눔이 안 돼 통째로 다음 장으로 밀린다 */
    const tm = pp.align === "CENTER" ? "margin-left:auto;margin-right:auto" : pp.align === "RIGHT" ? "margin-left:auto" : "";
    const tgap = pct ? Math.max(0, pp.ls / 100 - 1) * fs * 25.4 / 72 : 0;   // 표를 품은 줄의 줄 간격
    o.tbls.forEach((t, i) => { s += `<div class="hx-tp${pb && !i && !o.html ? pb : ""}"${tgap && !last ? ` style="margin-bottom:${f2(tgap)}mm"` : ""}>${tableHTML(t, H, tm)}</div>`; });
    return s;
  }
  function tableHTML(tbl, H, tm) {
    const colCnt = Number(tbl.getAttribute("colCnt")) || 1;
    const im = kid(tbl, "inMargin", NS.hp);
    const tin = im ? ["top", "right", "bottom", "left"].map(k => Number(im.getAttribute(k)) || 0) : [141, 141, 141, 141];
    const cs = cellsOf(tbl).map(tc => Object.assign(addr(tc), { tc }));
    const cw = new Array(colCnt).fill(null);
    for (let guard = 0, changed = true; changed && guard < 60; guard++) {
      changed = false;
      cs.forEach(c => {
        const unk = [];
        let known = 0;
        for (let k = c.c; k < c.c + c.cs && k < colCnt; k++) { if (cw[k] == null) unk.push(k); else known += cw[k]; }
        if (unk.length === 1) { cw[unk[0]] = Math.max(0, c.w - known); changed = true; }
      });
    }
    const sz = kid(tbl, "sz", NS.hp);
    const total = Number(sz && sz.getAttribute("width")) || cs.filter(c => c.c === 0).reduce((m, c) => Math.max(m, c.w), 0);
    const knownSum = cw.reduce((n, w) => n + (w || 0), 0), unknown = cw.filter(w => w == null).length;
    for (let k = 0; k < colCnt; k++) if (cw[k] == null) cw[k] = unknown ? Math.max(0, (total - knownSum) / unknown) : 0;
    const rows = {};
    cs.forEach(c => { (rows[c.r] = rows[c.r] || []).push(c); });
    const body = Object.keys(rows).map(Number).sort((a, b) => a - b).map(r => `<tr>${rows[r].sort((a, b) => a.c - b.c).map(c => {
      const bf = H.borders[c.tc.getAttribute("borderFillIDRef")] || {};
      const own = c.tc.getAttribute("hasMargin") === "1" ? kid(c.tc, "cellMargin", NS.hp) : null;
      const pad = own ? ["top", "right", "bottom", "left"].map(k => Number(own.getAttribute(k)) || 0) : tin;
      const sl = kid(c.tc, "subList", NS.hp);
      const va = sl ? ({ TOP: "top", CENTER: "middle", BOTTOM: "bottom" })[sl.getAttribute("vertAlign")] || "middle" : "middle";
      const st = `border-left:${borderCSS(bf.l)};border-right:${borderCSS(bf.r)};border-top:${borderCSS(bf.t)};border-bottom:${borderCSS(bf.b)};`
        + (bf.bg ? `background:${bf.bg};` : "") + `vertical-align:${va};padding:${pad.map(v => f2(mm(v)) + "mm").join(" ")};`
        + (c.rs === 1 && c.h ? `height:${f2(mm(c.h))}mm;` : "");
      return `<td${c.cs > 1 ? ` colspan="${c.cs}"` : ""}${c.rs > 1 ? ` rowspan="${c.rs}"` : ""} style="${st}">${cellParas(c.tc).map((p, i, ps) => paraHTML(p, H, true, i === ps.length - 1)).join("")}</td>`;
    }).join("")}</tr>`).join("");
    return `<table class="hx-t" style="width:${f2(mm(total))}mm${tm ? ";" + tm : ""}"><colgroup>${cw.map(w => `<col style="width:${f2(mm(w))}mm">`).join("")}</colgroup><tbody>${body}</tbody></table>`;
  }
  function page(pkg) {
    const pp = all(pkg.sec, "pagePr")[0];
    const m = pp ? kid(pp, "margin", NS.hp) : null;
    const g = (k, d) => m ? Number(m.getAttribute(k)) || 0 : d;
    let w = pp ? Number(pp.getAttribute("width")) || 59528 : 59528, h = pp ? Number(pp.getAttribute("height")) || 84188 : 84188;
    if (pp && pp.getAttribute("landscape") === "NARROWLY" && w < h) { const x = w; w = h; h = x; }
    return { w: mm(w), h: mm(h), top: mm(g("top", 5668) + g("header", 0)), bottom: mm(g("bottom", 4252) + g("footer", 0)), left: mm(g("left", 8504)), right: mm(g("right", 8504)) };
  }
  /* 본문 HTML — 쪽 나눔(문단 pageBreak)마다 .hx-doc 한 장 */
  function html(pkg) {
    const H = headInfo(pkg);
    const pages = [[]];
    topParas(pkg).forEach((p, i) => {
      if (i && p.getAttribute("pageBreak") === "1") pages.push([]);
      pages[pages.length - 1].push(paraHTML(p, H, true));
    });
    return pages.map(ps => `<div class="hx-doc">${ps.join("")}</div>`).join("");
  }
  /* 인쇄 문서 스타일 — 양식 하나를 A4 한 장 크기로(넘치면 다음 장) */
  function css(pkg, o) {
    const pg = page(pkg);
    o = o || {};
    return `@page { size: ${f2(pg.w)}mm ${f2(pg.h)}mm; margin: ${f2(pg.top)}mm ${f2(pg.right)}mm ${f2(pg.bottom)}mm ${f2(pg.left)}mm; }
      html, body { margin: 0; padding: 0; background: #fff; color: #000; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: ${SERIF}; }
      .hx-doc { width: ${f2(pg.w - pg.left - pg.right)}mm; }
      .hx-doc + .hx-doc { break-before: page; }
      .hx-p { margin: 0; white-space: pre-wrap; word-break: keep-all; overflow-wrap: break-word; }
      .hx-tp { margin: 0; }
      .hx-pb { break-before: page; }
      .hx-t { display: table; border-collapse: collapse; table-layout: fixed; text-align: left; }
      .hx-doc > .hx-p:has(+ .hx-tp) { break-after: avoid; }
      .hx-t td { overflow: hidden; box-sizing: border-box; }
      .hx-t tr { break-inside: avoid; }
      ${o.screen ? `@media screen { body { background: #e9ece9; padding: 10px 0; } .hx-doc { box-sizing: content-box; background: #fff; margin: 0 auto 12px; padding: ${f2(pg.top)}mm ${f2(pg.right)}mm ${f2(pg.bottom)}mm ${f2(pg.left)}mm; min-height: ${f2(pg.h - pg.top - pg.bottom)}mm; box-shadow: 0 1px 4px rgba(0,0,0,.18); } }` : ""}`;
  }

  window.SemisHwpx = { NS, open, unzip, zip, crc32, build, download, tables, cellsOf, addr, cell, cellParas, topParas, paraText, cellText, setPara, setCell, plainPara, centerPara, html, css, page, headInfo, parseXML, serialize };
})();
