/* 첨부 미리보기 — 엑셀 97-2003(.xls, BIFF8) 읽기. 셀 · 서식 · 병합 · 열 너비 · 행 높이 · 그림(PNG · JPEG · BMP)을
   XLSX 와 같은 시트 모델로 만들어 preview.js 의 표 그리기에 넘긴다. 문서 암호(RC4 · RC4 CryptoAPI)도 푼다.
   엑셀 95 이전(BIFF5 이하)은 옛 형식이라 다루지 않는다. */
"use strict";

(() => {
  const SP = window.SemisPreview;
  if (!SP) return;
  const R = SP.register = SP.register || {};

  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const s16 = (b, i) => (u16(b, i) << 16) >> 16;
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const f64 = (b, i) => new DataView(b.buffer, b.byteOffset + i, 8).getFloat64(0, true);
  const hex = (r, g, b) => [r, g, b].map(v => (v & 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  const fail = (code) => Object.assign(new Error(code), { code });

  /* 레코드 목록 { t, o: 자료 시작, n: 길이 } */
  function records(w) {
    const out = [];
    for (let p = 0; p + 4 <= w.length;) {
      const t = u16(w, p), n = u16(w, p + 2);
      if (p + 4 + n > w.length) break;
      out.push({ t, o: p + 4, n });
      p += 4 + n;
    }
    return out;
  }

  /* ── 문서 암호 ── */
  const PLAIN = new Set([0x0809, 0x002F, 0x0194, 0x0195, 0x00E1, 0x0196, 0x0138]);
  function decrypt(w, recs, pw) {
    const fp = recs.find(r => r.t === 0x002F);
    if (!fp) return w;
    const C = R.cfb;
    if (!C) throw fail("enc");
    const o = fp.o;
    if (u16(w, o) !== 1) throw fail("enc");                 // XOR 난독화(옛 방식)
    const vMaj = u16(w, o + 2), vMin = u16(w, o + 4);
    let keyOf, check;
    if (vMaj === 1 && vMin === 1) {                         // RC4(MD5)
      const salt = w.slice(o + 6, o + 22), ev = w.slice(o + 22, o + 38), eh = w.slice(o + 38, o + 54);
      keyOf = (p) => { const h1 = C.md5(C.cat(...Array.from({ length: 16 }, () => C.cat(C.md5(C.utf16(p)).slice(0, 5), salt)))).slice(0, 5); return (blk) => C.md5(C.cat(h1, C.le32(blk))); };
      check = (k) => { const ks = C.rc4(k(0))(32); const v = ev.map((x, i) => x ^ ks[i]), h = eh.map((x, i) => x ^ ks[16 + i]); return C.same(C.md5(v), h, 16); };
    } else if ((vMaj === 2 || vMaj === 3 || vMaj === 4) && vMin === 2) {   // RC4 CryptoAPI
      const hsz = u32(w, o + 10), h = o + 14;
      const alg = u32(w, h + 8), bits = u32(w, h + 16) || 40;
      if (alg && alg !== 0x6801) throw fail("enc");
      const v = h + hsz, ss = u32(w, v);
      const salt = w.slice(v + 4, v + 4 + ss), ev = w.slice(v + 4 + ss, v + 20 + ss), eh = w.slice(v + 24 + ss, v + 44 + ss);
      keyOf = (p) => { const h0 = C.sha1(C.cat(salt, C.utf16(p))); return (blk) => { const hf = C.sha1(C.cat(h0, C.le32(blk))); if (bits === 40) { const k = new Uint8Array(16); k.set(hf.subarray(0, 5)); return k; } return hf.slice(0, bits / 8); }; };
      check = (k) => { const ks = C.rc4(k(0))(36); const vv = ev.map((x, i) => x ^ ks[i]), hh = eh.map((x, i) => x ^ ks[16 + i]); return C.same(C.sha1(vv), hh, 20); };
    } else throw fail("enc");
    const tries = pw == null || pw === "" ? ["VelvetSweatshop"] : [String(pw)];
    let key = null;
    for (const p of tries) { const k = keyOf(p); if (check(k)) { key = k; break; } }
    if (!key) throw fail(pw ? "badpw" : "pw");
    /* 자리 기준 열쇠 흐름(1024바이트마다 새 열쇠) — 레코드 머리와 정해진 레코드는 풀지 않는다 */
    const out = w.slice();
    let blk = -1, ks = null;
    const xor = (a, b) => {
      for (let i = a; i < b; i++) {
        const k = Math.floor(i / 1024);
        if (k !== blk) { blk = k; ks = C.rc4(key(k))(1024); }
        out[i] ^= ks[i % 1024];
      }
    };
    recs.forEach(r => {
      if (PLAIN.has(r.t)) return;
      xor(r.t === 0x0085 ? r.o + 4 : r.o, r.o + r.n);
    });
    return out;
  }

  /* ── 문자열(CONTINUE 경계를 넘는 글자는 새 경계에서 글꼴 폭 표시 1바이트가 다시 온다) ── */
  function reader(segs) {
    let si = 0, p = 0;
    const cur = () => segs[si];
    const next = () => { si++; p = 0; return si < segs.length; };
    const need = () => { while (si < segs.length && p >= cur().length) if (!next()) return false; return si < segs.length; };
    const byte = () => { if (!need()) throw fail("eof"); return cur()[p++]; };
    const r = {
      u8: byte,
      u16: () => byte() | (byte() << 8),
      u32: () => (r.u16() | (r.u16() << 16)) >>> 0,
      skip: (n) => { while (n > 0) { if (!need()) return; const k = Math.min(n, cur().length - p); p += k; n -= k; } },
      chars: (n, high) => {
        let s = "";
        while (n > 0) {
          if (p >= cur().length) { if (!next()) break; high = !!(cur()[p++] & 1); continue; }
          if (high) { if (p + 1 >= cur().length) { p = cur().length; continue; } s += String.fromCharCode(cur()[p] | (cur()[p + 1] << 8)); p += 2; }
          else s += String.fromCharCode(cur()[p++]);
          n--;
        }
        return s;
      },
      str: (wide) => {                                       // XLUnicodeString(wide: 글자 수 2바이트)
        const n = wide ? r.u16() : r.u8(), fl = r.u8();
        const runs = fl & 8 ? r.u16() : 0, ext = fl & 4 ? r.u32() : 0;
        const s = r.chars(n, !!(fl & 1));
        r.skip(runs * 4 + ext);
        return s;
      },
      left: () => si < segs.length && (p < cur().length || segs.slice(si + 1).some(x => x.length))
    };
    return r;
  }

  const ERR = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0F: "#VALUE!", 0x17: "#REF!", 0x1D: "#NAME?", 0x24: "#NUM!", 0x2A: "#N/A", 0x2B: "#GETTING_DATA" };
  const H_AL = ["", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"];
  const V_AL = ["top", "center", "bottom", "justify", "distributed", "", "", ""];
  const DG = ["", "thin", "medium", "dashed", "dotted", "thick", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot", "", ""];
  const THEME = ["FFFFFF", "000000", "EEECE1", "1F497D", "4F81BD", "C0504D", "9BBB59", "8064A2", "4BACC6", "F79646", "0000FF", "800080"];
  const MIX = { 1: 1, 2: 0.5, 3: 0.75, 4: 0.25, 17: 0.125, 18: 0.0625 };
  function rk(v) {
    let n;
    if (v & 2) n = (v | 0) >> 2;
    else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, v & 0xFFFFFFFC, true); b.setUint32(0, 0, true); n = b.getFloat64(0, true); }
    return v & 1 ? n / 100 : n;
  }
  const mix = (a, b, t) => { const p = (h, k) => parseInt(h.substr(k, 2), 16); return hex(...[0, 2, 4].map(k => Math.round(p(a, k) * t + p(b, k) * (1 - t)))); };

  /* ── 통합 문서 전역부 ── */
  function globals(w, recs, H) {
    const wb = { theme: THEME.slice(), palette: H.PALETTE.slice(), fmts: {}, fonts: [], fills: [], borders: [], xfs: [], strs: [], sheets: [], d1904: false, notes: [], group: [] };
    const rawX = [];
    let i = 0;
    const segs = (k) => { const a = [w.subarray(recs[k].o, recs[k].o + recs[k].n)]; for (let j = k + 1; j < recs.length && recs[j].t === 0x003C; j++) a.push(w.subarray(recs[j].o, recs[j].o + recs[j].n)); return a; };
    for (; i < recs.length; i++) {
      const r = recs[i], o = r.o;
      if (r.t === 0x000A) break;
      if (r.t === 0x0022) wb.d1904 = u16(w, o) === 1;
      else if (r.t === 0x0031) {
        const g = u16(w, o + 2), bls = u16(w, o + 6), uls = w[o + 10];
        wb.fonts.push({ b: bls >= 600, i: !!(g & 2), s: !!(g & 8), u: uls === 1 || uls === 2 || uls === 0x21 || uls === 0x22, sz: u16(w, o) / 20, icv: u16(w, o + 4), va: ["", "superscript", "subscript"][u16(w, o + 8)] || "" });
      } else if (r.t === 0x041E) { try { const rd = reader(segs(i)); const id = rd.u16(); wb.fmts[id] = rd.str(true); } catch (e) { /* 건너뜀 */ } }
      else if (r.t === 0x00E0 && r.n >= 20) rawX.push(w.subarray(o, o + 20));
      else if (r.t === 0x0092) { const n = u16(w, o); for (let k = 0; k < n && 8 + k < 64; k++) wb.palette[8 + k] = hex(w[o + 2 + 4 * k], w[o + 3 + 4 * k], w[o + 4 + 4 * k]); }
      else if (r.t === 0x0085) {
        try { const rd = reader([w.subarray(o + 6, o + r.n)]); wb.sheets.push({ pos: u32(w, o), hidden: (w[o + 4] & 3) !== 0, dt: w[o + 5], name: rd.str(false) }); } catch (e) { /* 건너뜀 */ }
      } else if (r.t === 0x00FC) {
        const rd = reader(segs(i));
        rd.skip(4); const n = rd.u32();
        for (let k = 0; k < n && rd.left(); k++) { try { wb.strs.push(rd.str(true)); } catch (e) { break; } }
      } else if (r.t === 0x00EB) segs(i).forEach(s => wb.group.push(s));
      else if (r.t === 0x087D && r.n >= 20) rawX.ext = (rawX.ext || []).concat([w.subarray(o, o + r.n)]);
    }
    const color = (icv, auto) => (icv < 64 ? wb.palette[icv] || "" : icv === 64 ? auto || "000000" : icv === 65 ? "FFFFFF" : "");
    wb.fonts.forEach(f => { f.color = f.icv === 0x7FFF || f.icv === 64 ? "" : color(f.icv); });
    rawX.forEach((x, k) => {
      const ifnt = u16(x, 0), a = x[6], bd = u16(x, 10), c1 = u16(x, 12), c2 = u32(x, 14), c3 = u16(x, 18);
      const fls = (c2 >>> 26) & 63, fore = c3 & 127, back = (c3 >> 7) & 127;
      const side = (dg, icv) => (DG[dg] ? { s: DG[dg], c: color(icv) || "000000" } : null);
      wb.borders[k] = { l: side(bd & 15, c1 & 127), r: side((bd >> 4) & 15, (c1 >> 7) & 127), t: side((bd >> 8) & 15, c2 & 127), b: side((bd >> 12) & 15, (c2 >> 7) & 127) };
      const fc = color(fore, "000000"), bc = color(back, "FFFFFF") || "FFFFFF";
      wb.fills[k] = !fls ? "" : fls === 1 ? fc : fc ? mix(fc, bc, MIX[fls] || 0.5) : "";
      wb.xfs[k] = { fmt: u16(x, 2), font: ifnt < 4 ? ifnt : ifnt - 1, fill: k, border: k, h: H_AL[a & 7], v: V_AL[(a >> 4) & 7], wrap: !!(a & 8), ind: x[8] & 15 };
    });
    /* XFEXT — 2007 이후 저장본의 정확한 RGB · 테마 색 */
    (rawX.ext || []).forEach(e => {
      const xf = wb.xfs[u16(e, 14)];
      if (!xf) return;
      const n = u16(e, 18);
      for (let k = 0, p = 20; k < n && p + 4 <= e.length; k++) {
        const ty = u16(e, p), cb = u16(e, p + 2);
        if (cb < 4) break;
        const d = p + 4;
        const full = () => {
          const t = u16(e, d), tint = s16(e, d + 2) / 32767, v = d + 4;
          let h = t === 2 ? hex(e[v], e[v + 1], e[v + 2]) : t === 1 ? color(u32(e, v)) : t === 3 ? wb.theme[u32(e, v)] || "" : "";
          if (h && tint && SP._h.tint) h = SP._h.tint(h, tint);
          return h;
        };
        const b = wb.borders[xf.border];
        if (ty === 4) { const h = full(); if (h && wb.fills[xf.fill]) wb.fills[xf.fill] = h; }
        else if (ty >= 7 && ty <= 10) { const s = b && b[{ 7: "t", 8: "b", 9: "l", 10: "r" }[ty]]; const h = full(); if (s && h) s.c = h; }
        else if (ty === 13) { const h = full(); const f = wb.fonts[xf.font]; if (h && f && h !== (f.color || "000000")) { wb.fonts.push(Object.assign({}, f, { color: h })); xf.font = wb.fonts.length - 1; } }
        p += cb;
      }
    });
    if (!wb.xfs.length) wb.xfs = [{ fmt: 0, font: 0, fill: 0, border: 0, h: "", v: "", wrap: false, ind: 0 }];
    return wb;
  }

  /* ── 그림(OfficeArt) ── */
  function escher(b, o, end, out) {
    for (let p = o; p + 8 <= end;) {
      const vi = u16(b, p), ty = u16(b, p + 2), len = u32(b, p + 4), d = p + 8;
      if (d > end) break;
      const rec = { ty, inst: vi >> 4, d, len: Math.min(len, end - d), kids: null };
      if ((vi & 15) === 15) { rec.kids = []; escher(b, d, Math.min(end, d + len), rec.kids); }
      out.push(rec);
      p = d + len;
    }
    return out;
  }
  function concat(list) { const n = list.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; list.forEach(x => { o.set(x, p); p += x.length; }); return o; }
  function blips(wb) {
    if (wb._blips) return wb._blips;
    const out = [];
    if (wb.group.length) {
      const b = concat(wb.group);
      const walk = (list) => list.forEach(r => {
        if (r.ty === 0xF007) {
          const nm = b[r.d + 33], q = r.d + 36 + nm;
          const inner = q + 8 <= r.d + r.len ? escher(b, q, r.d + r.len, [])[0] : null;
          out.push(inner ? { b, rec: inner } : null);
        } else if (r.kids) walk(r.kids);
      });
      walk(escher(b, 0, b.length, []));
    }
    return (wb._blips = out);
  }
  const UIDS = { 0x46A: 1, 0x46B: 2, 0x6E2: 1, 0x6E3: 2, 0x6E0: 1, 0x6E1: 2, 0x7A8: 1, 0x7A9: 2 };
  function blipURI(wb, idx, H) {
    const x = blips(wb)[idx - 1];
    if (!x) return "";
    const { b, rec } = x;
    const mime = { 0xF01D: "image/jpeg", 0xF02A: "image/jpeg", 0xF01E: "image/png", 0xF01F: "image/bmp" }[rec.ty];
    if (!mime) return "";
    const skip = 16 * (UIDS[rec.inst] || 1) + 1;
    let data = b.subarray(rec.d + skip, rec.d + rec.len);
    if (rec.ty === 0xF01F && data.length > 40) {           // DIB → BMP 파일 머리 붙이기
      const hs = u32(data, 0), bpp = u16(data, 14), comp = u32(data, 16), used = u32(data, 32);
      const pal = bpp <= 8 ? (used || 1 << bpp) * 4 : comp === 3 && hs === 40 ? 12 : 0;
      const head = new Uint8Array(14); head[0] = 0x42; head[1] = 0x4D;
      const put = (i, v) => { head[i] = v & 255; head[i + 1] = (v >>> 8) & 255; head[i + 2] = (v >>> 16) & 255; head[i + 3] = (v >>> 24) & 255; };
      put(2, 14 + data.length); put(10, 14 + hs + pal);
      data = concat([head, data]);
    }
    const s = H.b64(data);
    if (wb.budget.left < s.length) { wb.budget.over = true; return ""; }
    wb.budget.left -= s.length;
    return "data:" + mime + ";base64," + s;
  }
  function sheetPics(wb, m, dg, H) {
    const b = concat(dg), items = [], flags = {};
    const colPx = (c) => (m.colHid[c] ? 0 : H.colPx(m.colW[c] != null ? m.colW[c] : m.defW));
    const rowPx = (r) => (m.rowHid[r] ? 0 : (m.rowH[r] != null ? m.rowH[r] : m.defH) * 96 / 72);
    const walk = (list) => list.forEach(r => {
      if (r.ty === 0xF004 && r.kids) {
        const opt = r.kids.find(k => k.ty === 0xF00B), an = r.kids.find(k => k.ty === 0xF010);
        if (!opt || !an || an.len < 18) return;
        let pib = 0;
        for (let k = 0; k < opt.inst; k++) { const id = u16(b, opt.d + 6 * k) & 0x3FFF, v = u32(b, opt.d + 6 * k + 2); if (id === 0x0104 || (id === 0x0186 && !pib)) pib = v; }
        if (!pib) return;
        const a = an.d, cL = u16(b, a + 2) + 1, rT = u16(b, a + 6) + 1, cR = u16(b, a + 10) + 1, rB = u16(b, a + 14) + 1;
        const uri = blipURI(wb, pib, H);
        if (!uri) { flags.pic = true; return; }
        items.push({ r: rT, c: cL, dx: u16(b, a + 4) / 1024 * colPx(cL), dy: u16(b, a + 8) / 256 * rowPx(rT), w: 0, h: 0,
          to: { r: rB, c: cR, dx: u16(b, a + 12) / 1024 * colPx(cR), dy: u16(b, a + 16) / 256 * rowPx(rB) },
          render: () => `<img src="${uri}" alt="" style="display:block;width:100%;height:100%">` });
      } else if (r.kids) walk(r.kids);
    });
    try { walk(escher(b, 0, b.length, [])); } catch (e) { flags.pic = true; }
    return { items, flags };
  }

  /* ── 시트 ── */
  function sheet(w, recs, start, wb, sh, H) {
    const m = { name: sh.name, grid: true, defW: 8.43, defH: 15, colW: {}, colHid: {}, colStyle: {}, rowH: {}, rowHid: {}, cells: new Map(), merges: [], maxR: 0, maxC: 0, cut: false, draw: null };
    const dg = [];
    let depth = 0, last = 0, pend = null, chart = false;
    const put = (r, c, cell) => {
      if (r + 1 > H.MAX_ROWS || c + 1 > H.MAX_COLS) { m.cut = true; return; }
      H.putCell(wb, m, r + 1, c + 1, cell);
    };
    const segs = (k) => { const a = [w.subarray(recs[k].o, recs[k].o + recs[k].n)]; for (let j = k + 1; j < recs.length && recs[j].t === 0x003C; j++) a.push(w.subarray(recs[j].o, recs[j].o + recs[j].n)); return a; };
    for (let i = start; i < recs.length; i++) {
      const r = recs[i], o = r.o, t = r.t;
      if (t === 0x0809) { depth++; if (depth > 1) chart = true; continue; }
      if (t === 0x000A) { depth--; if (depth <= 0) break; continue; }
      if (depth > 1) continue;
      if (t === 0x003C) { if (last === 0x00EC) dg.push(w.subarray(o, o + r.n)); continue; }
      last = t;
      switch (t) {
        case 0x0055: if (!m.stdW) m.defW = u16(w, o) + 0.71; break;
        case 0x0099: m.defW = u16(w, o) / 256; m.stdW = true; break;
        case 0x0225: m.defH = u16(w, o + 2) / 20 || 15; break;
        case 0x007D: {
          const a = u16(w, o), b = Math.min(u16(w, o + 2), H.MAX_COLS + 50), cw = u16(w, o + 4) / 256, xf = u16(w, o + 6), hid = u16(w, o + 8) & 1;
          for (let k = a; k <= b; k++) { m.colW[k + 1] = cw; if (hid) m.colHid[k + 1] = true; m.colStyle[k + 1] = xf; }
          break;
        }
        case 0x0208: {
          const rw = u16(w, o) + 1, ht = u16(w, o + 6) & 0x7FFF, g = u16(w, o + 12);
          if (rw > H.MAX_ROWS) { m.cut = true; break; }
          m.rowH[rw] = ht / 20;
          if (g & 0x20) m.rowHid[rw] = true;
          break;
        }
        case 0x00FD: put(u16(w, o), u16(w, o + 2), { s: u16(w, o + 4), t: "inlineStr", v: null, is: wb.strs[u32(w, o + 6)] || "" }); break;
        case 0x0204: case 0x00D6: { try { const rd = reader(segs(i)); rd.skip(6); put(u16(w, o), u16(w, o + 2), { s: u16(w, o + 4), t: "inlineStr", v: null, is: rd.str(true) }); } catch (e) { /* 건너뜀 */ } break; }
        case 0x0203: put(u16(w, o), u16(w, o + 2), { s: u16(w, o + 4), t: "", v: String(f64(w, o + 6)), is: "" }); break;
        case 0x027E: put(u16(w, o), u16(w, o + 2), { s: u16(w, o + 4), t: "", v: String(rk(u32(w, o + 6))), is: "" }); break;
        case 0x00BD: {
          const rw = u16(w, o), c0 = u16(w, o + 2), n = (r.n - 6) / 6;
          for (let k = 0; k < n; k++) put(rw, c0 + k, { s: u16(w, o + 4 + 6 * k), t: "", v: String(rk(u32(w, o + 6 + 6 * k))), is: "" });
          break;
        }
        case 0x0201: put(u16(w, o), u16(w, o + 2), { s: u16(w, o + 4), t: "", v: null, is: "" }); break;
        case 0x00BE: {
          const rw = u16(w, o), c0 = u16(w, o + 2), n = (r.n - 6) / 2;
          for (let k = 0; k < n; k++) put(rw, c0 + k, { s: u16(w, o + 4 + 2 * k), t: "", v: null, is: "" });
          break;
        }
        case 0x0205: { const v = w[o + 6], e = w[o + 7]; put(u16(w, o), u16(w, o + 2), e ? { s: u16(w, o + 4), t: "e", v: ERR[v] || "#ERR", is: "" } : { s: u16(w, o + 4), t: "b", v: v ? "1" : "0", is: "" }); break; }
        case 0x0006: {
          const rw = u16(w, o), cl = u16(w, o + 2), xf = u16(w, o + 4);
          if (u16(w, o + 12) === 0xFFFF) {
            const ty = w[o + 6];
            if (ty === 0) { pend = { rw, cl, xf }; break; }
            put(rw, cl, ty === 1 ? { s: xf, t: "b", v: w[o + 8] ? "1" : "0", is: "" } : ty === 2 ? { s: xf, t: "e", v: ERR[w[o + 8]] || "#ERR", is: "" } : { s: xf, t: "inlineStr", v: null, is: "" });
          } else put(rw, cl, { s: xf, t: "", v: String(f64(w, o + 6)), is: "" });
          break;
        }
        case 0x0207: if (pend) { let s = ""; try { s = reader(segs(i)).str(true); } catch (e) { /* 빈 글 */ } put(pend.rw, pend.cl, { s: pend.xf, t: "inlineStr", v: null, is: s }); pend = null; } break;
        case 0x00E5: {
          const n = u16(w, o);
          for (let k = 0; k < n && 2 + 8 * k + 8 <= r.n; k++) { const p = o + 2 + 8 * k; H.addMerge(m, u16(w, p) + 1, u16(w, p + 4) + 1, u16(w, p + 2) + 1, u16(w, p + 6) + 1); }
          break;
        }
        case 0x023E: m.grid = !!(u16(w, o) & 2); break;
        case 0x00EC: dg.push(w.subarray(o, o + r.n)); break;
        default: break;
      }
    }
    if (dg.length) { m.draw = sheetPics(wb, m, dg, H); }
    if (chart) { m.draw = m.draw || { items: [], flags: {} }; m.draw.flags.chartOff = true; }
    return m;
  }

  /* CFB 문서 → { kind, parts } */
  function xls(doc, opts) {
    const H = SP._h;
    let w = doc.get("Workbook");
    if (!w) { if (doc.get("Book")) throw fail("legacy"); throw fail("xls"); }
    let recs = records(w);
    if (!recs.length || recs[0].t !== 0x0809) throw fail("xls");
    if (u16(w, recs[0].o) !== 0x0600) throw fail("legacy");
    w = decrypt(w, recs, opts && opts.password);
    recs = records(w);
    const wb = globals(w, recs, H);
    wb.budget = { left: H.MAX_IMG };
    const at = new Map(recs.map((r, i) => [r.o - 4, i]));
    const parts = [];
    wb.sheets.forEach(sh => {
      if (sh.hidden || sh.dt !== 0) return;
      const k = at.get(sh.pos);
      if (k == null) return;
      try { const m = sheet(w, recs, k, wb, sh, H); const out = H.renderSheet(wb, m); parts.push({ name: sh.name, doc: out.doc, notes: out.notes }); }
      catch (e) { parts.push({ name: sh.name, doc: H.page("", '<p class="pv-empty">이 시트를 읽지 못했습니다.</p>'), notes: [] }); }
    });
    if (!parts.length) throw fail("xls");
    return { kind: "xls", parts, enc: recs.some(r => r.t === 0x002F) };
  }

  R.xls = { xls, records, rk };
})();
