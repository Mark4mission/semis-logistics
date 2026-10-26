/* 첨부 미리보기 — 한글 5.0 문서(.hwp, 복합 문서) 읽기. 글자 · 문단 모양 · 표 · 쪽 설정을 HWPX(OWPML) 머리 · 본문 XML 로 옮겨
   한글 HWPX 와 같은 그리기(hwpx.js)를 쓴다. 배포용 · 암호 문서와 한글 97 이전(3.0) 형식은 다루지 않는다. */
"use strict";

(() => {
  const SP = window.SemisPreview;
  if (!SP) return;
  const R = SP.register = SP.register || {};
  const fail = (code) => Object.assign(new Error(code), { code });
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const s32 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
  const u32 = (b, i) => s32(b, i) >>> 0;
  const s8 = (v) => (v << 24) >> 24;
  const x = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
  const rgb = (c) => "#" + [c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  const wstr = (b, o, n) => { let s = ""; for (let i = 0; i < n && o + 2 * i + 1 < b.length; i++) s += String.fromCharCode(u16(b, o + 2 * i)); return s; };

  /* raw deflate 풀기(RFC 1951) — 한글 압축 스트림은 끝에 군더더기 바이트가 붙어 있어 브라우저 DecompressionStream 이
     오류로 앞서 푼 내용까지 버리는 일이 있다. 마지막 블록에서 멈추는 작은 풀이기를 쓴다 */
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const ORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function huff(lens, n) {
    const count = new Uint16Array(16), sym = new Uint16Array(n), offs = new Uint16Array(16);
    for (let i = 0; i < n; i++) count[lens[i]]++;
    count[0] = 0;
    for (let l = 1; l < 15; l++) offs[l + 1] = offs[l] + count[l];
    for (let i = 0; i < n; i++) if (lens[i]) sym[offs[lens[i]]++] = i;
    return { count, sym };
  }
  function inflate(src) {
    let out = new Uint8Array(Math.max(4096, src.length * 4)), op = 0, ip = 0, bb = 0, bc = 0;
    const room = (n) => { if (op + n <= out.length) return; let m = out.length * 2; while (m < op + n) m *= 2; const o = new Uint8Array(m); o.set(out.subarray(0, op)); out = o; };
    const bits = (n) => { while (bc < n) { if (ip >= src.length) throw fail("inflate"); bb |= src[ip++] << bc; bc += 8; } const v = bb & ((1 << n) - 1); bb >>>= n; bc -= n; return v; };
    const dec = (h) => {
      let code = 0, first = 0, idx = 0;
      for (let l = 1; l < 16; l++) {
        code |= bits(1);
        const c = h.count[l];
        if (code - c < first) return h.sym[idx + code - first];
        idx += c; first = (first + c) << 1; code <<= 1;
      }
      throw fail("inflate");
    };
    let fixL = null, fixD = null;
    for (let last = 0; !last;) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bb = 0; bc = 0;
        if (ip + 4 > src.length) throw fail("inflate");
        const len = src[ip] | (src[ip + 1] << 8); ip += 4;
        if (ip + len > src.length) throw fail("inflate");
        room(len); out.set(src.subarray(ip, ip + len), op); op += len; ip += len;
        continue;
      }
      let L, D;
      if (type === 1) {
        if (!fixL) { const l = new Uint8Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); fixL = huff(l, 288); fixD = huff(new Uint8Array(30).fill(5), 30); }
        L = fixL; D = fixD;
      } else if (type === 2) {
        const nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4;
        const cl = new Uint8Array(19);
        for (let i = 0; i < nc; i++) cl[ORD[i]] = bits(3);
        const ch = huff(cl, 19), lens = new Uint8Array(nl + nd);
        for (let i = 0; i < nl + nd;) {
          const sym = dec(ch);
          if (sym < 16) { lens[i++] = sym; continue; }
          let rep = 0, val = 0;
          if (sym === 16) { if (!i) throw fail("inflate"); val = lens[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > nl + nd) throw fail("inflate");
          while (rep--) lens[i++] = val;
        }
        L = huff(lens.subarray(0, nl), nl); D = huff(lens.subarray(nl), nd);
      } else throw fail("inflate");
      for (;;) {
        const sym = dec(L);
        if (sym < 256) { room(1); out[op++] = sym; continue; }
        if (sym === 256) break;
        const k = sym - 257;
        if (k >= 29) throw fail("inflate");
        const len = LBASE[k] + bits(LEXT[k]);
        const ds = dec(D);
        if (ds >= 30) throw fail("inflate");
        const dist = DBASE[ds] + bits(DEXT[ds]);
        if (dist > op) throw fail("inflate");
        room(len);
        for (let q = 0; q < len; q++, op++) out[op] = out[op - dist];
      }
    }
    return out.slice(0, op);
  }

  /* 레코드 → 나무(수준 번호로 부모 · 자식) */
  function records(b) {
    const out = [];
    for (let p = 0; p + 4 <= b.length;) {
      const h = u32(b, p); p += 4;
      let size = h >>> 20;
      if (size === 0xFFF) { if (p + 4 > b.length) break; size = u32(b, p); p += 4; }
      if (p + size > b.length) size = b.length - p;
      out.push({ tag: h & 0x3FF, lv: (h >>> 10) & 0x3FF, d: b.subarray(p, p + size), kids: [] });
      p += size;
    }
    return out;
  }
  function tree(list) {
    const root = { lv: -1, kids: [] }, st = [root];
    list.forEach(r => {
      while (st.length > 1 && st[st.length - 1].lv >= r.lv) st.pop();
      st[st.length - 1].kids.push(r);
      st.push(r);
    });
    return root.kids;
  }

  /* ── 문서 정보(DocInfo) → 머리 XML ── */
  const ALIGN = ["JUSTIFY", "LEFT", "RIGHT", "CENTER", "DISTRIBUTE", "DISTRIBUTE_SPACE", "JUSTIFY", "JUSTIFY"];
  const LINE = (t) => (t === 0 ? "NONE" : t === 1 ? "SOLID" : t === 3 || t === 7 ? "DOT" : t >= 8 && t <= 11 ? "DOUBLE_SLIM" : t === 2 || (t >= 4 && t <= 6) ? "DASH" : "SOLID");
  const WIDTH = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];
  function head(di, ver) {
    const list = records(di);
    const idm = list.find(r => r.tag === 17);
    const ids = idm ? Array.from({ length: Math.floor(idm.d.length / 4) }, (_, i) => s32(idm.d, 4 * i)) : [];
    const nHan = ids[1] || 0;
    let faces = list.filter(r => r.tag === 19).slice(0, nHan || undefined).map(r => wstr(r.d, 3, u16(r.d, 1)));
    if (!faces.length) faces = [""];
    const fx = faces.map((f, i) => `<hh:font id="${i}" face="${x(f)}" type="TTF"/>`).join("");
    const bfs = list.filter(r => r.tag === 20).map((r, i) => {
      const d = r.d;
      const side = (k, n) => { const o = 2 + 6 * k; return o + 6 <= d.length ? `<hh:${n} type="${LINE(d[o])}" width="${WIDTH[d[o + 1]] || 0.12} mm" color="${rgb(u32(d, o + 2))}"/>` : `<hh:${n} type="NONE" width="0.1 mm" color="#000000"/>`; };
      let fill = "";
      if (d.length >= 40 && (u32(d, 32) & 1)) { const c = u32(d, 36); if (!(c >>> 24)) fill = `<hc:fillBrush><hc:winBrush faceColor="${rgb(c)}" hatchColor="#000000" alpha="0"/></hc:fillBrush>`; }
      return `<hh:borderFill id="${i + 1}">${side(0, "leftBorder")}${side(1, "rightBorder")}${side(2, "topBorder")}${side(3, "bottomBorder")}${fill}</hh:borderFill>`;
    }).join("");
    const chars = list.filter(r => r.tag === 21).map((r, i) => {
      const d = r.d, at = d.length >= 50 ? u32(d, 46) : 0;
      const sz = d.length >= 46 ? s32(d, 42) : 1000;
      return `<hh:charPr id="${i}" height="${sz > 0 ? sz : 1000}" textColor="${d.length >= 56 ? rgb(u32(d, 52)) : "#000000"}"><hh:fontRef hangul="${u16(d, 0)}"/><hh:spacing hangul="${d.length > 21 ? s8(d[21]) : 0}"/>`
        + (at & 2 ? "<hh:bold/>" : "") + (at & 1 ? "<hh:italic/>" : "") + (at & 12 ? '<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>' : "") + "</hh:charPr>";
    }).join("");
    const newLS = ver >= 0x05000205;
    const paras = list.filter(r => r.tag === 25).map((r, i) => {
      const d = r.d, a1 = u32(d, 0);
      /* 문단 여백(왼 · 오른 · 위 · 아래)은 두 배 값으로 저장된다. 들여쓰기는 그대로 */
      const half = (o) => (d.length >= o + 4 ? Math.round(s32(d, o) / 2) : 0);
      let lt = a1 & 3, lv = d.length >= 28 ? s32(d, 24) : 160;
      if (newLS && d.length >= 54) { lt = u32(d, 46) & 31; lv = u32(d, 50); }
      const type = lt === 1 || lt === 3 ? "FIXED" : "PERCENT";
      if (type === "PERCENT" && (lt === 2 || lv <= 0 || lv > 1000)) lv = 160;
      return `<hh:paraPr id="${i}"><hh:align horizontal="${ALIGN[(a1 >>> 2) & 7]}" vertical="BASELINE"/><hh:margin><hc:intent value="${d.length >= 16 ? s32(d, 12) : 0}" unit="HWPUNIT"/>`
        + `<hc:left value="${half(4)}" unit="HWPUNIT"/><hc:right value="${half(8)}" unit="HWPUNIT"/><hc:prev value="${half(16)}" unit="HWPUNIT"/><hc:next value="${half(20)}" unit="HWPUNIT"/></hh:margin>`
        + `<hh:lineSpacing type="${type}" value="${lv}" unit="HWPUNIT"/></hh:paraPr>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hh:head xmlns:hh="${NS.hh}" xmlns:hc="${NS.hc}" xmlns:hp="${NS.hp}" version="1.4" secCnt="1"><hh:refList>`
      + `<hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="${faces.length}">${fx}</hh:fontface></hh:fontfaces>`
      + `<hh:borderFills>${bfs}</hh:borderFills><hh:charProperties>${chars || '<hh:charPr id="0" height="1000" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr>'}</hh:charProperties>`
      + `<hh:paraProperties>${paras || '<hh:paraPr id="0"><hh:align horizontal="JUSTIFY"/></hh:paraPr>'}</hh:paraProperties></hh:refList></hh:head>`;
  }

  /* ── 본문(BodyText/SectionN) → 구역 XML ── */
  const EXT = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);
  const INLINE = new Set([4, 5, 6, 7, 8, 9, 19, 20]);
  const ctrlId = (d) => (d.length >= 4 ? String.fromCharCode(d[3], d[2], d[1], d[0]) : "");
  function section(nodes, st) {
    const paras = (list) => list.filter(n => n.tag === 66).map(para).join("");
    function table(ctrl) {
      const cd = ctrl.d, tb = ctrl.kids.find(k => k.tag === 77);
      if (!tb) return "";
      const t = tb.d, rows = u16(t, 4), cols = u16(t, 6);
      const cells = [];
      let cur = null;
      ctrl.kids.forEach(k => {
        if (k.tag === 72) {
          const d = k.d;
          if (d.length < 34) { cur = null; return; }
          cur = { col: u16(d, 8), row: u16(d, 10), cs: u16(d, 12) || 1, rs: u16(d, 14) || 1, w: u32(d, 16), h: u32(d, 20),
            pad: [u16(d, 24), u16(d, 26), u16(d, 28), u16(d, 30)], bf: u16(d, 32), va: ["TOP", "CENTER", "BOTTOM", "CENTER"][(u32(d, 4) >>> 5) & 3], ps: [] };
          cells.push(cur);
        } else if (k.tag === 66 && cur) cur.ps.push(k);
      });
      const byRow = new Map();
      cells.forEach(c => { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row).push(c); });
      const trs = Array.from(byRow.keys()).sort((a, b) => a - b).map(r => "<hp:tr>" + byRow.get(r).sort((a, b) => a.col - b.col).map(c =>
        `<hp:tc borderFillIDRef="${c.bf}" hasMargin="1"><hp:subList vertAlign="${c.va}">${c.ps.map(para).join("") || '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"/></hp:p>'}</hp:subList>`
        + `<hp:cellAddr colAddr="${c.col}" rowAddr="${c.row}"/><hp:cellSpan colSpan="${c.cs}" rowSpan="${c.rs}"/><hp:cellSz width="${c.w}" height="${c.h}"/>`
        + `<hp:cellMargin left="${c.pad[0]}" right="${c.pad[1]}" top="${c.pad[2]}" bottom="${c.pad[3]}"/></hp:tc>`).join("") + "</hp:tr>").join("");
      const w = cd.length >= 20 ? u32(cd, 16) : 0, h = cd.length >= 24 ? u32(cd, 20) : 0;
      return `<hp:tbl rowCnt="${rows}" colCnt="${cols}" borderFillIDRef="${t.length >= 20 + 2 * rows ? u16(t, 18 + 2 * rows) : 1}"><hp:sz width="${w}" height="${h}"/>`
        + `<hp:inMargin left="${u16(t, 10)}" right="${u16(t, 12)}" top="${u16(t, 14)}" bottom="${u16(t, 16)}"/>${trs}</hp:tbl>`;
    }
    function secPr(ctrl) {
      const pd = ctrl.kids.find(k => k.tag === 73);
      if (!pd || pd.d.length < 36) return "";
      const d = pd.d, v = (i) => u32(d, 4 * i);
      return `<hp:secPr><hp:pagePr landscape="${d.length >= 40 && (u32(d, 36) & 1) ? "NARROWLY" : "WIDELY"}" width="${v(0)}" height="${v(1)}" gutterType="LEFT_ONLY">`
        + `<hp:margin left="${v(2)}" right="${v(3)}" top="${v(4)}" bottom="${v(5)}" header="${v(6)}" footer="${v(7)}" gutter="${v(8)}"/></hp:pagePr></hp:secPr>`;
    }
    const hasPic = (n) => n.tag === 85 || n.kids.some(hasPic);
    function para(p) {
      const h = p.d;
      const ps = h.length >= 10 ? u16(h, 8) : 0, brk = h.length >= 12 ? h[11] : 0;
      const txt = p.kids.find(k => k.tag === 67), shp = p.kids.find(k => k.tag === 68);
      const ctrls = p.kids.filter(k => k.tag === 71);
      const marks = [];
      if (shp) for (let o = 0; o + 8 <= shp.d.length; o += 8) marks.push([u32(shp.d, o), u32(shp.d, o + 4)]);
      if (!marks.length) marks.push([0, 0]);
      let mi = 0, cs = marks[0][1], t = "";
      const runs = [];
      let body = "";
      const flushT = () => { if (t) { body += `<hp:t>${t}</hp:t>`; t = ""; } };
      const flushRun = () => { flushT(); if (body) runs.push(`<hp:run charPrIDRef="${cs}">${body}</hp:run>`); body = ""; };
      const b = txt ? txt.d : new Uint8Array(0), n = b.length >> 1;
      let ci = 0;
      for (let i = 0; i < n;) {
        while (mi + 1 < marks.length && marks[mi + 1][0] <= i) { mi++; if (marks[mi][1] !== cs) { flushRun(); cs = marks[mi][1]; } }
        const c = u16(b, 2 * i);
        if (c >= 32) { t += x(String.fromCharCode(c)); i++; continue; }
        if (EXT.has(c)) {
          const id = i + 2 < n ? String.fromCharCode(u16(b, 2 * i + 4) >> 8, u16(b, 2 * i + 4) & 255, u16(b, 2 * i + 2) >> 8, u16(b, 2 * i + 2) & 255) : "";
          let k = ci;
          while (k < ctrls.length && ctrlId(ctrls[k].d) !== id) k++;
          const ctrl = k < ctrls.length ? ctrls[k] : null;
          if (ctrl) ci = k + 1;
          if (ctrl && id === "tbl ") { flushT(); body += table(ctrl); }
          else if (ctrl && id === "secd") { flushT(); body += secPr(ctrl); }
          else if (ctrl && id === "gso " && hasPic(ctrl)) { flushT(); body += "<hp:pic/>"; st.pics++; }
          i += 8; continue;
        }
        if (INLINE.has(c)) { if (c === 9) t += "<hp:tab/>"; i += 8; continue; }
        if (c === 13) break;
        if (c === 10) t += "<hp:lineBreak/>";
        else if (c === 24) t += "-";
        else if (c === 30) t += "<hp:nbSpace/>";
        else if (c === 31) t += "<hp:fwSpace/>";
        i++;
      }
      flushRun();
      if (!runs.length) runs.push(`<hp:run charPrIDRef="${cs}"/>`);
      return `<hp:p paraPrIDRef="${ps}" styleIDRef="0" pageBreak="${brk & 4 ? 1 : 0}" columnBreak="0" merged="0">${runs.join("")}</hp:p>`;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec xmlns:hs="${NS.hs}" xmlns:hp="${NS.hp}" xmlns:hc="${NS.hc}">${paras(nodes)}</hs:sec>`;
  }

  const NS = { hp: "http://www.hancom.co.kr/hwpml/2011/paragraph", hs: "http://www.hancom.co.kr/hwpml/2011/section", hh: "http://www.hancom.co.kr/hwpml/2011/head", hc: "http://www.hancom.co.kr/hwpml/2011/core" };

  async function hwp(doc) {
    const fh = doc.get("FileHeader");
    if (!fh || fh.length < 40) throw fail("hwp");
    if (!/^HWP Document File/.test(String.fromCharCode(...fh.subarray(0, 17)))) throw fail("hwp");
    const ver = u32(fh, 32), at = u32(fh, 36);
    if ((ver >>> 24) < 5) throw fail("legacy");
    if (at & 2) throw fail("hwppw");
    if (at & 4) throw fail("dist");
    if (at & 16) throw fail("enc");
    const z = !!(at & 1);
    const read = (p) => { const d = doc.get(p); if (!d) return null; return z ? inflate(d) : d; };
    const di = read("DocInfo");
    if (!di) throw fail("hwp");
    const secs = doc.list().map(p => /^bodytext\/section(\d+)$/.exec(p)).filter(Boolean).map(m => Number(m[1])).sort((a, b) => a - b);
    if (!secs.length) throw fail("hwp");
    const enc = new TextEncoder(), st = { pics: 0 };
    const entries = [{ name: "Contents/header.xml", data: enc.encode(head(di, ver)) }];
    for (const k of secs) {
      const d = read("BodyText/Section" + k);
      if (!d) continue;
      entries.push({ name: "Contents/section" + k + ".xml", data: enc.encode(section(tree(records(d)), st)) });
    }
    const out = SP._h.hwpx(entries);
    out.kind = "hwp";
    return out;
  }

  R.hwp = { hwp, records, tree, section, head, inflate };
})();
