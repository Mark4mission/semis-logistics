/* 첨부 미리보기 — DrawingML 그리기: 파워포인트 슬라이드(위치 · 크기 · 도형 · 선 · 색 · 글 · 표 · 그림 그대로)와 엑셀 시트의 그림 · 도형.
   좌표는 EMU(1px = 9525). 슬라이드는 cqw(슬라이드 폭 기준 %)로 그려 창 폭에 맞춰 줄고 는다. 글은 이스케이프, 색은 #RRGGBB/rgba 숫자만 */
"use strict";

(() => {
  const SP = window.SemisPreview;
  if (!SP || !SP._h) return;
  const { esc, xml, kids, kid, byTag, at, num, hex6, relsOf, mediaURI, FONT, ln, numOf, MAX_IMG } = SP._h;
  const EMU = 9525;
  const r3 = (n) => String(Math.round(n * 1000) / 1000);
  const PUA = /[\uf000-\uf8ff]/;

  /* ── 색 ── */
  const PRST = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", lime: "00FF00", blue: "0000FF", yellow: "FFFF00", cyan: "00FFFF", aqua: "00FFFF",
    magenta: "FF00FF", fuchsia: "FF00FF", gray: "808080", grey: "808080", silver: "C0C0C0", ltGray: "D3D3D3", lightGray: "D3D3D3", dkGray: "A9A9A9", darkGray: "A9A9A9",
    orange: "FFA500", navy: "000080", purple: "800080", maroon: "800000", olive: "808000", teal: "008080", brown: "A52A2A", pink: "FFC0CB", gold: "FFD700", darkBlue: "00008B", darkRed: "8B0000", darkGreen: "006400" };
  const SCHEME = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  function toHsl(h) {
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let hh = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6; }
    return [hh, s, l];
  }
  function fromHsl(hh, s, l) {
    l = Math.max(0, Math.min(1, l)); s = Math.max(0, Math.min(1, s));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (x) => { if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
    const c = s === 0 ? [l, l, l] : [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
    return c.map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const CLR = { srgbClr: 1, schemeClr: 1, prstClr: 1, sysClr: 1, scrgbClr: 1, hslClr: 1 };
  /* 색 요소 → { h: "RRGGBB", a: 0~1 } */
  function clr(el, ctx) {
    if (!el) return null;
    const n = ln(el);
    let h = "";
    if (n === "srgbClr") h = hex6(at(el, "val"));
    else if (n === "schemeClr") {
      const v = at(el, "val") || "";
      if (v === "phClr") return ctx.ph ? Object.assign({}, ctx.ph) : null;
      const k = ctx.map[v] || v;
      h = ctx.theme[k] || "";
    } else if (n === "prstClr") h = PRST[at(el, "val")] || "";
    else if (n === "sysClr") h = hex6(at(el, "lastClr")) || (at(el, "val") === "window" ? "FFFFFF" : "000000");
    else if (n === "scrgbClr") h = [at(el, "r"), at(el, "g"), at(el, "b")].map(v => Math.round(Math.max(0, Math.min(100000, num(v, 0))) / 100000 * 255).toString(16).padStart(2, "0")).join("");
    else if (n === "hslClr") h = fromHsl(num(at(el, "hue"), 0) / 21600000, num(at(el, "sat"), 0) / 100000, num(at(el, "lum"), 0) / 100000);
    if (!h) return null;
    let a = 1;
    kids(el).forEach(m => {
      const v = num(at(m, "val"), 0) / 100000, mn = ln(m);
      if (mn === "alpha") a = v;
      else if (mn === "lumMod" || mn === "lumOff") { const x = toHsl(h); h = fromHsl(x[0], x[1], mn === "lumMod" ? x[2] * v : x[2] + v); }
      else if (mn === "tint") h = h.match(/../g).map(c => Math.round(parseInt(c, 16) * v + 255 * (1 - v)).toString(16).padStart(2, "0")).join("");
      else if (mn === "shade") h = h.match(/../g).map(c => Math.round(parseInt(c, 16) * v).toString(16).padStart(2, "0")).join("");
      else if (mn === "satMod") { const x = toHsl(h); h = fromHsl(x[0], x[1] * v, x[2]); }
    });
    return { h: h.toUpperCase(), a };
  }
  const scheme = (v, ctx) => { const h = ctx.theme[ctx.map[v] || v]; return h ? { h, a: 1 } : { h: "000000", a: 1 }; };
  const firstClr = (parent, ctx) => { const e = kids(parent).find(x => CLR[ln(x)]); return e ? clr(e, ctx) : null; };
  const css = (c) => (!c ? "none" : c.a < 1 ? `rgba(${parseInt(c.h.slice(0, 2), 16)},${parseInt(c.h.slice(2, 4), 16)},${parseInt(c.h.slice(4, 6), 16)},${r3(Math.max(0, c.a))})` : "#" + c.h);

  function themeOf(entries, path) {
    const out = { theme: {}, fonts: { mj: "", mn: "", mjEa: "", mnEa: "" } };
    const e = path && entries.find(x => x.name === path);
    if (!e) return out;
    const d = xml(e.data);
    const cs = byTag(d, "clrScheme")[0];
    if (cs) SCHEME.forEach(k => { const c = kid(cs, k); const x = c && kids(c)[0]; if (x) out.theme[k] = ln(x) === "sysClr" ? hex6(at(x, "lastClr")) || (at(x, "val") === "window" ? "FFFFFF" : "000000") : hex6(at(x, "val")); });
    const fs = byTag(d, "fontScheme")[0];
    if (fs) {
      const mj = kid(fs, "majorFont"), mn = kid(fs, "minorFont");
      const hang = (f) => { const h = kids(f, "font").find(x => at(x, "script") === "Hang"); return h ? at(h, "typeface") || "" : at(kid(f, "ea"), "typeface") || ""; };
      out.fonts = { mj: at(kid(mj, "latin"), "typeface") || "", mn: at(kid(mn, "latin"), "typeface") || "", mjEa: mj ? hang(mj) : "", mnEa: mn ? hang(mn) : "" };
    }
    return out;
  }
  const CLRMAP_DEF = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
  function clrMapOf(el) {
    if (!el) return Object.assign({}, CLRMAP_DEF);
    const m = {};
    ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].forEach(k => { if (at(el, k)) m[k] = at(el, k); });
    return Object.assign({}, CLRMAP_DEF, m);
  }

  /* ── 채우기 · 선 ── */
  function blipOf(parent, ctx) {
    const b = kid(parent, "blip");
    const id = b ? b.getAttribute("r:embed") || b.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed") : "";
    const rel = id && ctx.rels[id];
    if (!rel) return "";
    const u = mediaURI(ctx.entries, rel.path, ctx.budget);
    if (!u) ctx.flags.pic = true;
    return u;
  }
  /* → null(없음) | { c } | { grad:[c1,c2], ang } | { img } ; undefined = 지정 없음 */
  function fillOf(spPr, ctx) {
    if (!spPr) return undefined;
    for (const e of kids(spPr)) {
      const n = ln(e);
      if (n === "noFill") return null;
      if (n === "solidFill") return { c: firstClr(e, ctx) };
      if (n === "gradFill") {
        const gs = byTag(e, "gs").map(g => ({ p: num(at(g, "pos"), 0), c: firstClr(g, ctx) })).filter(x => x.c).sort((a, b) => a.p - b.p);
        if (!gs.length) return null;
        const lin = kid(e, "lin");
        return { grad: [gs[0].c, gs[gs.length - 1].c], ang: lin ? num(at(lin, "ang"), 0) / 60000 : 90 };
      }
      if (n === "blipFill") { const u = blipOf(e, ctx); return u ? { img: u } : null; }
      if (n === "pattFill") { const c = firstClr(kid(e, "fgClr"), ctx); return c ? { c } : null; }
      if (n === "grpFill") return ctx.grpFill || null;
    }
    return undefined;
  }
  const DASH = { dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], sysDashDot: [3, 1, 1, 1], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDotDot: [3, 1, 1, 1, 1, 1] };
  function lineOf(spPr, style, ctx, isLine) {
    const lnEl = kid(spPr, "ln");
    let c, w = 9525, dash = "", head = "", tail = "", none = false;
    const ref = style ? kid(style, "lnRef") : null;
    if (lnEl) {
      w = num(at(lnEl, "w"), ref && num(at(ref, "idx"), 0) > 0 ? 9525 * num(at(ref, "idx"), 1) : 9525);
      for (const e of kids(lnEl)) {
        const n = ln(e);
        if (n === "noFill") none = true;
        else if (n === "solidFill") c = firstClr(e, ctx);
        else if (n === "gradFill") { const g = byTag(e, "gs")[0]; c = g ? firstClr(g, ctx) : null; }
        else if (n === "prstDash") dash = at(e, "val") || "";
        else if (n === "headEnd") head = at(e, "type") || "";
        else if (n === "tailEnd") tail = at(e, "type") || "";
      }
    }
    if (none) return null;
    if (!c && ref && num(at(ref, "idx"), 0) > 0) c = firstClr(ref, ctx);
    if (!c && !lnEl && !ref) return null;
    if (!c && lnEl && !ref) c = isLine ? { h: "000000", a: 1 } : null;
    if (!c) return null;
    return { c, w: Math.max(0.25, w / EMU), dash, head: head === "none" ? "" : head, tail: tail === "none" ? "" : tail };
  }

  /* ── 도형 모양(prstGeom) → SVG path ── */
  const adjOf = (geom, i, d) => { const g = byTag(geom, "gd").find(x => at(x, "name") === "adj" + (i || "") || (i === 1 && at(x, "name") === "adj")); const m = g ? /val\s+(-?\d+)/.exec(at(g, "fmla") || "") : null; return m ? Number(m[1]) : d; };
  const P = (pts) => "M" + pts.map(p => r3(p[0]) + " " + r3(p[1])).join(" L") + " Z";
  const ELL = (w, h) => `M0 ${r3(h / 2)} A${r3(w / 2)} ${r3(h / 2)} 0 1 0 ${r3(w)} ${r3(h / 2)} A${r3(w / 2)} ${r3(h / 2)} 0 1 0 0 ${r3(h / 2)} Z`;
  function star(n, w, h, inner) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? inner : 1; pts.push([w / 2 + Math.cos(a) * r * w / 2, h / 2 + Math.sin(a) * r * h / 2]); }
    return P(pts);
  }
  function geomPath(prst, w, h, g) {
    const m = Math.min(w, h), A = (i, d) => adjOf(g, i, d) / 100000;
    switch (prst) {
      case "roundRect": case "flowChartAlternateProcess": { const r = Math.min(m * A(1, 16667), m / 2); return { d: `M${r3(r)} 0 H${r3(w - r)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(w)} ${r3(r)} V${r3(h - r)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(w - r)} ${r3(h)} H${r3(r)} A${r3(r)} ${r3(r)} 0 0 1 0 ${r3(h - r)} V${r3(r)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(r)} 0 Z` }; }
      case "flowChartTerminator": { const r = h / 2; return { d: `M${r3(r)} 0 H${r3(w - r)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(w - r)} ${r3(h)} H${r3(r)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(r)} 0 Z` }; }
      case "ellipse": case "flowChartConnector": case "sun": case "cloud": case "heart": case "smileyFace": case "donut": case "noSmoking": case "flowChartMagneticDisk": case "can":
        return { d: ELL(w, h), extra: prst === "noSmoking" ? `M${r3(w * 0.15)} ${r3(h * 0.15)} L${r3(w * 0.85)} ${r3(h * 0.85)}` : "" };
      case "flowChartSummingJunction": { const k = 0.1464; return { d: ELL(w, h), extra: `M${r3(w * k)} ${r3(h * k)} L${r3(w * (1 - k))} ${r3(h * (1 - k))} M${r3(w * (1 - k))} ${r3(h * k)} L${r3(w * k)} ${r3(h * (1 - k))}` }; }
      case "flowChartOr": return { d: ELL(w, h), extra: `M${r3(w / 2)} 0 V${r3(h)} M0 ${r3(h / 2)} H${r3(w)}` };
      case "triangle": case "flowChartExtract": { const a = w * A(1, 50000); return { d: P([[a, 0], [w, h], [0, h]]) }; }
      case "flowChartMerge": return { d: P([[0, 0], [w, 0], [w / 2, h]]) };
      case "rtTriangle": return { d: P([[0, 0], [w, h], [0, h]]) };
      case "diamond": case "flowChartDecision": return { d: P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) };
      case "parallelogram": case "flowChartInputOutput": { const a = prst === "parallelogram" ? m * A(1, 25000) : w / 5; return { d: P([[a, 0], [w, 0], [w - a, h], [0, h]]) }; }
      case "trapezoid": case "flowChartManualOperation": { const a = prst === "trapezoid" ? m * A(1, 25000) : w / 5; return { d: prst === "trapezoid" ? P([[0, h], [a, 0], [w - a, 0], [w, h]]) : P([[0, 0], [w, 0], [w - a, h], [a, h]]) }; }
      case "pentagon": return { d: P([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]) };
      case "homePlate": { const a = Math.min(m * A(1, 50000), w); return { d: P([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h]]) }; }
      case "chevron": { const a = Math.min(m * A(1, 50000), w / 2); return { d: P([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h], [a, h / 2]]) }; }
      case "hexagon": { const a = m * A(1, 25000); return { d: P([[a, 0], [w - a, 0], [w, h / 2], [w - a, h], [a, h], [0, h / 2]]) }; }
      case "octagon": { const a = m * A(1, 29289); return { d: P([[a, 0], [w - a, 0], [w, a], [w, h - a], [w - a, h], [a, h], [0, h - a], [0, a]]) }; }
      case "plus": case "flowChartPredefinedProcess": {
        if (prst === "flowChartPredefinedProcess") return { d: P([[0, 0], [w, 0], [w, h], [0, h]]), extra: `M${r3(w / 8)} 0 V${r3(h)} M${r3(w * 7 / 8)} 0 V${r3(h)}` };
        const a = m * A(1, 25000); return { d: P([[a, 0], [w - a, 0], [w - a, a], [w, a], [w, h - a], [w - a, h - a], [w - a, h], [a, h], [a, h - a], [0, h - a], [0, a], [a, a]]) };
      }
      case "star4": return { d: star(4, w, h, 0.38) };
      case "star5": return { d: star(5, w, h, 0.38) };
      case "star6": return { d: star(6, w, h, 0.5) };
      case "star8": case "irregularSeal1": case "irregularSeal2": return { d: star(8, w, h, 0.6) };
      case "rightArrow": case "leftArrow": { const sh = h * A(1, 50000), hl = Math.min(m * A(2, 50000), w), y0 = (h - sh) / 2, y1 = (h + sh) / 2;
        const pts = [[0, y0], [w - hl, y0], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, y1], [0, y1]];
        return { d: P(prst === "leftArrow" ? pts.map(p => [w - p[0], p[1]]) : pts) }; }
      case "downArrow": case "upArrow": { const sw = w * A(1, 50000), hl = Math.min(m * A(2, 50000), h), x0 = (w - sw) / 2, x1 = (w + sw) / 2;
        const pts = [[x0, 0], [x1, 0], [x1, h - hl], [w, h - hl], [w / 2, h], [0, h - hl], [x0, h - hl]];
        return { d: P(prst === "upArrow" ? pts.map(p => [p[0], h - p[1]]) : pts) }; }
      case "leftRightArrow": { const sh = h * A(1, 50000), hl = Math.min(m * A(2, 50000), w / 2), y0 = (h - sh) / 2, y1 = (h + sh) / 2;
        return { d: P([[0, h / 2], [hl, 0], [hl, y0], [w - hl, y0], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, y1], [hl, y1], [hl, h]]) }; }
      case "upDownArrow": { const sw = w * A(1, 50000), hl = Math.min(m * A(2, 50000), h / 2), x0 = (w - sw) / 2, x1 = (w + sw) / 2;
        return { d: P([[w / 2, 0], [w, hl], [x1, hl], [x1, h - hl], [w, h - hl], [w / 2, h], [0, h - hl], [x0, h - hl], [x0, hl], [0, hl]]) }; }
      case "arc": return { d: `M${r3(w / 2)} 0 A${r3(w / 2)} ${r3(h / 2)} 0 0 1 ${r3(w)} ${r3(h / 2)}`, open: true };
      case "line": case "straightConnector1": case "bentConnector2": case "bentConnector3": case "bentConnector4": case "curvedConnector2": case "curvedConnector3": case "curvedConnector4":
        return { d: `M0 0 L${r3(w)} ${r3(h)}`, open: true, line: true };
      case "leftBracket": return { d: `M${r3(w)} 0 Q0 0 0 ${r3(h / 2)} Q0 ${r3(h)} ${r3(w)} ${r3(h)}`, open: true };
      case "rightBracket": return { d: `M0 0 Q${r3(w)} 0 ${r3(w)} ${r3(h / 2)} Q${r3(w)} ${r3(h)} 0 ${r3(h)}`, open: true };
      default: return { d: P([[0, 0], [w, 0], [w, h], [0, h]]) };
    }
  }
  /* 자유형(custGeom) — moveTo · lnTo · cubicBezTo · quadBezTo · arcTo · close */
  function custPath(geom, w, h) {
    let d = "";
    kids(kid(geom, "pathLst"), "path").forEach(p => {
      const pw = num(at(p, "w"), 0) || w * EMU, ph = num(at(p, "h"), 0) || h * EMU;
      const sx = w / (pw || 1), sy = h / (ph || 1);
      let cx = 0, cy = 0;
      const pt = (e) => [num(at(e, "x"), 0) * sx, num(at(e, "y"), 0) * sy];
      kids(p).forEach(c => {
        const n = ln(c), ps = kids(c, "pt").map(pt);
        if (n === "moveTo" && ps[0]) { d += `M${r3(ps[0][0])} ${r3(ps[0][1])} `; [cx, cy] = ps[0]; }
        else if (n === "lnTo" && ps[0]) { d += `L${r3(ps[0][0])} ${r3(ps[0][1])} `; [cx, cy] = ps[0]; }
        else if (n === "cubicBezTo" && ps.length === 3) { d += "C" + ps.map(q => r3(q[0]) + " " + r3(q[1])).join(" ") + " "; [cx, cy] = ps[2]; }
        else if (n === "quadBezTo" && ps.length === 2) { d += "Q" + ps.map(q => r3(q[0]) + " " + r3(q[1])).join(" ") + " "; [cx, cy] = ps[1]; }
        else if (n === "arcTo") {
          const wr = num(at(c, "wR"), 0) * sx, hr = num(at(c, "hR"), 0) * sy, st = num(at(c, "stAng"), 0) / 60000 * Math.PI / 180, sw = num(at(c, "swAng"), 0) / 60000 * Math.PI / 180;
          const ox = cx - wr * Math.cos(st), oy = cy - hr * Math.sin(st);
          const ex = ox + wr * Math.cos(st + sw), ey = oy + hr * Math.sin(st + sw);
          d += `A${r3(wr)} ${r3(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${r3(ex)} ${r3(ey)} `; cx = ex; cy = ey;
        } else if (n === "close") d += "Z ";
      });
    });
    return d.trim();
  }

  /* ── 글 ── 상속 순서(chain): 도형 lstStyle → (자리표시자) 레이아웃 · 마스터 → 마스터 글 스타일 → 프레젠테이션 기본 */
  const lvlPr = (src, lv) => kid(src, "lvl" + (lv + 1) + "pPr");
  function pAttr(chain, lv, pPr, a) { if (pPr && at(pPr, a) != null) return at(pPr, a); for (const s of chain) { const e = lvlPr(s, lv); if (e && at(e, a) != null) return at(e, a); } return null; }
  function pKid(chain, lv, pPr, names) { const f = (e) => kids(e).find(x => names.indexOf(ln(x)) >= 0); const own = pPr ? f(pPr) : null; if (own) return own; for (const s of chain) { const e = lvlPr(s, lv); const x = e ? f(e) : null; if (x) return x; } return null; }
  function rAttr(chain, lv, rPr, a) { if (rPr && at(rPr, a) != null) return at(rPr, a); for (const s of chain) { const e = kid(lvlPr(s, lv), "defRPr"); if (e && at(e, a) != null) return at(e, a); } return null; }
  function rKid(chain, lv, rPr, n) { const own = rPr ? kid(rPr, n) : null; if (own) return own; for (const s of chain) { const e = kid(lvlPr(s, lv), "defRPr"); const x = e ? kid(e, n) : null; if (x) return x; } return null; }
  const AUTONUM = (type, n) => {
    const t = String(type || "arabicPeriod");
    const roman = (k) => { let s = ""; [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]].forEach(([v, r]) => { while (k >= v) { s += r; k -= v; } }); return s; };
    const base = /^alphaLc/.test(t) ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : /^alphaUc/.test(t) ? String.fromCharCode(64 + ((n - 1) % 26) + 1)
      : /^romanLc/.test(t) ? roman(n).toLowerCase() : /^romanUc/.test(t) ? roman(n) : /^circleNum/.test(t) ? (n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n))
      : /^(ea1Jpn|hanja|ea1Chs)/.test(t) ? String(n) : String(n);
    return /ParenBoth$/.test(t) ? "(" + base + ")" : /ParenR$/.test(t) ? base + ")" : /Period$/.test(t) ? base + "." : /Plain$/.test(t) ? base : base + ".";
  };
  function fontFamily(chain, lv, rPr, ctx) {
    const face = (n) => { const e = rKid(chain, lv, rPr, n); let f = e ? at(e, "typeface") || "" : ""; if (/^\+mj/.test(f)) f = n === "latin" ? ctx.fonts.mj : ctx.fonts.mjEa; else if (/^\+mn/.test(f)) f = n === "latin" ? ctx.fonts.mn : ctx.fonts.mnEa; return f.replace(/['"<>;{}\\]/g, ""); };
    const list = [face("latin"), face("ea")].filter(Boolean).map(f => "'" + f + "'");
    return list.length ? list.join(",") + "," + FONT : "";
  }
  function textHTML(txBody, ctx, chain, bodyChain) {
    if (!txBody) return "";
    const chainAll = [kid(txBody, "lstStyle")].concat(chain || []).filter(Boolean);
    const bp = (a) => { for (const b of [kid(txBody, "bodyPr")].concat(bodyChain || [])) { if (b && at(b, a) != null) return at(b, a); } return null; };
    const bodyKid = (n) => { for (const b of [kid(txBody, "bodyPr")].concat(bodyChain || [])) { const x = b ? kid(b, n) : null; if (x) return x; } return null; };
    const nf = bodyKid("normAutofit");
    const scale = nf ? num(at(nf, "fontScale"), 100000) / 100000 : 1;
    const lnRed = nf ? num(at(nf, "lnSpcReduction"), 0) / 100000 : 0;
    const counters = {};
    let any = false;
    const ps = kids(txBody, "p").map(p => {
      const pPr = kid(p, "pPr");
      const lv = Math.min(8, num(at(pPr, "lvl"), 0));
      let h = "";
      let maxSz = 0;
      const runs = kids(p).filter(x => /^(r|br|fld)$/.test(ln(x)));
      runs.forEach(r => {
        if (ln(r) === "br") { h += "<br>"; return; }
        const rPr = kid(r, "rPr"), t = kid(r, "t");
        const tx = t ? t.textContent : "";
        if (!tx) return;
        any = any || /\S/.test(tx);
        const sz = num(rAttr(chainAll, lv, rPr, "sz"), 1800) / 100 * scale;
        maxSz = Math.max(maxSz, sz);
        const st = ["font-size:" + ctx.F(sz)];
        if (/^(1|true)$/.test(rAttr(chainAll, lv, rPr, "b") || "")) st.push("font-weight:700");
        if (/^(1|true)$/.test(rAttr(chainAll, lv, rPr, "i") || "")) st.push("font-style:italic");
        const u = rAttr(chainAll, lv, rPr, "u"), sk = rAttr(chainAll, lv, rPr, "strike");
        if ((u && u !== "none") || (sk && sk !== "noStrike")) st.push("text-decoration:" + [u && u !== "none" ? "underline" : "", sk && sk !== "noStrike" ? "line-through" : ""].filter(Boolean).join(" "));
        const fill = rKid(chainAll, lv, rPr, "solidFill");
        const c = fill ? firstClr(fill, ctx) : ctx.textColor || scheme("tx1", ctx);
        if (c) st.push("color:" + css(c));
        const hl = rPr ? kid(rPr, "highlight") : null; const hc = hl ? firstClr(hl, ctx) : null; if (hc) st.push("background:" + css(hc));
        const ff = fontFamily(chainAll, lv, rPr, ctx); if (ff) st.push("font-family:" + ff);
        const bl = num(rAttr(chainAll, lv, rPr, "baseline"), 0); if (bl) st.push("vertical-align:" + (bl > 0 ? "super" : "sub"));
        h += `<span style="${st.join(";")}">${esc(tx)}</span>`;
      });
      if (!maxSz) { const e = kid(p, "endParaRPr"); maxSz = num(at(e, "sz"), num(rAttr(chainAll, lv, null, "sz"), 1800)) / 100 * scale; }
      const st = [];
      const al = pAttr(chainAll, lv, pPr, "algn");
      const AL = { ctr: "center", r: "right", just: "justify", dist: "justify", justLow: "justify" };
      if (AL[al]) st.push("text-align:" + AL[al]);
      const marL = num(pAttr(chainAll, lv, pPr, "marL"), 0) / EMU, ind = num(pAttr(chainAll, lv, pPr, "indent"), 0) / EMU;
      if (marL) st.push("padding-left:" + ctx.L(marL));
      if (ind) st.push("text-indent:" + ctx.L(ind));
      const ls = pKid(chainAll, lv, pPr, ["lnSpc"]);
      const pct = ls && kid(ls, "spcPct") ? num(at(kid(ls, "spcPct"), "val"), 100000) / 100000 : 1;
      const pts = ls && kid(ls, "spcPts") ? num(at(kid(ls, "spcPts"), "val"), 0) / 100 : 0;
      st.push("line-height:" + (pts ? ctx.F(pts) : r3(Math.max(0.6, (pct - lnRed) * 1.2))));
      const sb = pKid(chainAll, lv, pPr, ["spcBef"]), sa = pKid(chainAll, lv, pPr, ["spcAft"]);
      const spc = (e) => { if (!e) return 0; const p2 = kid(e, "spcPts"); if (p2) return num(at(p2, "val"), 0) / 100; const p1 = kid(e, "spcPct"); return p1 ? num(at(p1, "val"), 0) / 100000 * maxSz : 0; };
      if (spc(sb)) st.push("margin-top:" + ctx.F(spc(sb)));
      if (spc(sa)) st.push("margin-bottom:" + ctx.F(spc(sa)));
      st.push("font-size:" + ctx.F(maxSz));
      let bu = "";
      const bk = pKid(chainAll, lv, pPr, ["buNone", "buChar", "buAutoNum", "buBlip"]);
      if (h && bk && ln(bk) !== "buNone") {
        let ch = "•";
        if (ln(bk) === "buChar") { const c = at(bk, "char") || "•"; ch = PUA.test(c) || /^[§ØüÜ]$/.test(c) ? "•" : c; }
        else if (ln(bk) === "buAutoNum") { const k = lv + "|" + at(bk, "type"); counters[k] = (counters[k] || num(at(bk, "startAt"), 1) - 1) + 1; ch = AUTONUM(at(bk, "type"), counters[k]); }
        const bc = pKid(chainAll, lv, pPr, ["buClr"]); const bcc = bc ? firstClr(bc, ctx) : null;
        bu = `<span class="bu"${bcc ? ` style="color:${css(bcc)}"` : ""}>${esc(ch)}</span>`;
      }
      return `<p style="${st.join(";")}">${bu}${h || "&#8203;"}</p>`;
    });
    if (!any) return "";
    const ins = (a, d) => num(bp(a), d) / EMU;
    const anchor = bp("anchor") || "t";
    const vert = bp("vert") || "";
    const wrapNone = bp("wrap") === "none";
    const jc = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
    const st = [`padding:${ctx.L(ins("tIns", 45720))} ${ctx.L(ins("rIns", 91440))} ${ctx.L(ins("bIns", 45720))} ${ctx.L(ins("lIns", 91440))}`, "justify-content:" + jc];
    if (/vert|eaVert|wordArtVert/.test(vert)) st.push("writing-mode:vertical-rl");
    if (wrapNone) st.push("white-space:pre");
    return `<div class="tx${wrapNone ? " nw" : ""}" style="${st.join(";")}">${ps.join("")}</div>`;
  }

  /* ── 도형 하나 ── box = { x, y, w, h }(px) */
  function svgShape(geomEl, w, h, fill, line, flipH, flipV, ctx) {
    const prst = geomEl && ln(geomEl) === "custGeom" ? "" : (geomEl && at(geomEl, "prst")) || "rect";
    const W = Math.max(w, 0.01), H = Math.max(h, 0.01);
    const g = prst ? geomPath(prst, W, H, geomEl) : { d: custPath(geomEl, W, H) || P([[0, 0], [W, 0], [W, H], [0, H]]) };
    const tf = flipH || flipV ? ` transform="translate(${flipH ? r3(W) : 0} ${flipV ? r3(H) : 0}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1})"` : "";
    let defs = "", f = "none";
    if (fill && !g.open) {
      if (fill.c) f = css(fill.c);
      else if (fill.grad) {
        const id = "g" + (++ctx.uid);
        const a = (fill.ang || 0) * Math.PI / 180;
        defs += `<linearGradient id="${id}" x1="${r3(0.5 - Math.cos(a) / 2)}" y1="${r3(0.5 - Math.sin(a) / 2)}" x2="${r3(0.5 + Math.cos(a) / 2)}" y2="${r3(0.5 + Math.sin(a) / 2)}"><stop offset="0" stop-color="${css(fill.grad[0])}"/><stop offset="1" stop-color="${css(fill.grad[1])}"/></linearGradient>`;
        f = `url(#${id})`;
      } else if (fill.img) {
        const id = "c" + (++ctx.uid);
        defs += `<clipPath id="${id}"><path d="${g.d}"/></clipPath>`;
        const img = `<image href="${fill.img}" x="0" y="0" width="${r3(W)}" height="${r3(H)}" preserveAspectRatio="none" clip-path="url(#${id})"/>`;
        return `<svg class="g" viewBox="0 0 ${r3(W)} ${r3(H)}" preserveAspectRatio="none" aria-hidden="true"><defs>${defs}</defs><g${tf}>${img}${line ? `<path d="${g.d}" fill="none" ${strokeAttrs(line)}/>` : ""}</g></svg>`;
      }
    }
    if (f === "none" && !line) return "";
    let body = `<path d="${g.d}" fill="${f}"${line ? " " + strokeAttrs(line) : ""}/>`;
    if (g.extra && line) body += `<path d="${g.extra}" fill="none" ${strokeAttrs(line)}/>`;
    if (line && (line.head || line.tail) && g.open) body += arrows(g, W, H, line);
    return `<svg class="g" viewBox="0 0 ${r3(W)} ${r3(H)}" preserveAspectRatio="none" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ""}<g${tf}>${body}</g></svg>`;
  }
  const strokeAttrs = (l) => `stroke="${css(l.c)}" stroke-width="${r3(l.w)}"${DASH[l.dash] ? ` stroke-dasharray="${DASH[l.dash].map(x => r3(x * l.w)).join(" ")}"` : ""} stroke-linejoin="round"`;
  function arrows(g, W, H, l) {
    const m = /^M(\S+) (\S+) L(\S+) (\S+)/.exec(g.d);
    if (!m) return "";
    const x1 = +m[1], y1 = +m[2], x2 = +m[3], y2 = +m[4];
    const head = (px, py, qx, qy) => {
      const a = Math.atan2(py - qy, px - qx), s = Math.max(4, l.w * 3);
      const p1 = [px - s * Math.cos(a - 0.45), py - s * Math.sin(a - 0.45)], p2 = [px - s * Math.cos(a + 0.45), py - s * Math.sin(a + 0.45)];
      return `<path d="M${r3(px)} ${r3(py)} L${r3(p1[0])} ${r3(p1[1])} L${r3(p2[0])} ${r3(p2[1])} Z" fill="${css(l.c)}"/>`;
    };
    return (l.tail ? head(x2, y2, x1, y1) : "") + (l.head ? head(x1, y1, x2, y2) : "");
  }
  function boxHTML(box, ctx, inner, rot, extraCls) {
    return `<div class="sh${extraCls ? " " + extraCls : ""}" style="left:${ctx.L(box.x)};top:${ctx.L(box.y)};width:${ctx.L(box.w)};height:${ctx.L(box.h)}${rot ? `;transform:rotate(${r3(rot)}deg)` : ""}">${inner}</div>`;
  }
  const xfrmOf = (spPr) => kid(spPr, "xfrm");
  function rawBox(xf) {
    const o = kid(xf, "off"), e = kid(xf, "ext");
    if (!o && !e) return null;
    return { x: num(at(o, "x"), 0), y: num(at(o, "y"), 0), w: num(at(e, "cx"), 0), h: num(at(e, "cy"), 0) };
  }
  /* T: EMU 상자 → px 상자(그룹 좌표 변환 포함) */
  const T0 = (b) => ({ x: b.x / EMU, y: b.y / EMU, w: b.w / EMU, h: b.h / EMU });
  function groupT(T, grpSpPr) {
    const xf = xfrmOf(grpSpPr);
    if (!xf) return T;
    const o = kid(xf, "off"), e = kid(xf, "ext"), co = kid(xf, "chOff"), ce = kid(xf, "chExt");
    const ox = num(at(o, "x"), 0), oy = num(at(o, "y"), 0), cx = num(at(e, "cx"), 0), cy = num(at(e, "cy"), 0);
    const chx = num(at(co, "x"), 0), chy = num(at(co, "y"), 0), chcx = num(at(ce, "cx"), 0), chcy = num(at(ce, "cy"), 0);
    const sx = chcx ? cx / chcx : 1, sy = chcy ? cy / chcy : 1;
    if (!cx && !cy && !chcx && !chcy && !ox && !oy) return T;
    return (b) => T({ x: ox + (b.x - chx) * sx, y: oy + (b.y - chy) * sy, w: b.w * sx, h: b.h * sy });
  }
  function shapeEl(sp, ctx, T, ph) {
    const spPr = kid(sp, "spPr"), style = kid(sp, "style");
    let xf = xfrmOf(spPr);
    let raw = xf ? rawBox(xf) : null;
    if ((!raw || (!raw.w && !raw.h)) && ph && ph.xfrm) { xf = ph.xfrm; raw = rawBox(xf); }
    if (!raw) return "";
    const box = T(raw);
    const geomEl = kid(spPr, "prstGeom") || kid(spPr, "custGeom") || (ph && ph.geom) || null;
    const isLine = !!geomEl && /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(at(geomEl, "prst") || "");
    let fill = fillOf(spPr, ctx);
    if (fill === undefined && ph && ph.spPr) fill = fillOf(ph.spPr, ctx);
    if (fill === undefined) { const fr = style ? kid(style, "fillRef") : null; fill = fr && num(at(fr, "idx"), 0) > 0 ? { c: firstClr(fr, ctx) } : null; }
    let line = lineOf(spPr, style, ctx, isLine);
    if (!line && !kid(spPr, "ln") && ph && ph.spPr && kid(ph.spPr, "ln")) line = lineOf(ph.spPr, null, ctx, isLine);
    const rot = num(at(xf, "rot"), 0) / 60000;
    const svg = svgShape(geomEl, box.w, box.h, fill, line, /^(1|true)$/.test(at(xf, "flipH") || ""), /^(1|true)$/.test(at(xf, "flipV") || ""), ctx);
    const fr = style ? kid(style, "fontRef") : null;
    const saved = ctx.textColor;
    if (fr && firstClr(fr, ctx)) ctx.textColor = firstClr(fr, ctx);
    const tx = textHTML(kid(sp, "txBody"), ctx, ph ? ph.chain : ctx.otherChain, ph ? ph.bodies : []);
    ctx.textColor = saved;
    if (!svg && !tx) return "";
    return boxHTML(box, ctx, svg + tx, rot);
  }
  function picEl(pic, ctx, T) {
    const spPr = kid(pic, "spPr"), xf = xfrmOf(spPr), raw = xf ? rawBox(xf) : null;
    if (!raw) return "";
    const box = T(raw);
    const bf = kid(pic, "blipFill");
    const u = blipOf(bf, ctx);
    const rot = num(at(xf, "rot"), 0) / 60000;
    if (!u) return boxHTML(box, ctx, '<span class="ph">그림</span>', rot, "pic0");
    const sr = kid(bf, "srcRect");
    const l = num(at(sr, "l"), 0) / 100000, t = num(at(sr, "t"), 0) / 100000, r = num(at(sr, "r"), 0) / 100000, b = num(at(sr, "b"), 0) / 100000;
    const fw = 1 - l - r, fh = 1 - t - b;
    const img = fw > 0.01 && fh > 0.01 && (l || t || r || b)
      ? `<img src="${u}" alt="" style="position:absolute;left:${r3(-l / fw * 100)}%;top:${r3(-t / fh * 100)}%;width:${r3(100 / fw)}%;height:${r3(100 / fh)}%">`
      : `<img src="${u}" alt="" style="width:100%;height:100%">`;
    const fx = /^(1|true)$/.test(at(xf, "flipH") || "") ? "scaleX(-1)" : "";
    const line = lineOf(spPr, kid(pic, "style"), ctx, false);
    return `<div class="sh pic" style="left:${ctx.L(box.x)};top:${ctx.L(box.y)};width:${ctx.L(box.w)};height:${ctx.L(box.h)}${rot || fx ? `;transform:${rot ? `rotate(${r3(rot)}deg) ` : ""}${fx}` : ""}${line ? `;outline:${ctx.L(line.w)} solid ${css(line.c)}` : ""}">${img}</div>`;
  }
  function tableEl(frame, tbl, ctx, T) {
    const raw = rawBox(kid(frame, "xfrm"));
    if (!raw) return "";
    const box = T(raw);
    const cols = kids(kid(tbl, "tblGrid"), "gridCol").map(g => num(at(g, "w"), 0) / EMU);
    const total = cols.reduce((n, w) => n + w, 0) || box.w;
    const sideCss = (e) => { if (!e) return ""; if (kid(e, "noFill")) return "none"; const c = firstClr(kid(e, "solidFill"), ctx); return c ? ctx.L(Math.max(0.5, num(at(e, "w"), 12700) / EMU)) + " solid " + css(c) : ""; };
    const rows = kids(tbl, "tr").map(tr => {
      const h = num(at(tr, "h"), 0) / EMU;
      return `<tr style="height:${ctx.L(h)}">${kids(tr, "tc").map(tc => {
        if (/^(1|true)$/.test(at(tc, "hMerge") || "") || /^(1|true)$/.test(at(tc, "vMerge") || "")) return "";
        const tcPr = kid(tc, "tcPr");
        const st = [];
        const f = fillOf(tcPr, ctx);
        if (f && f.c) st.push("background:" + css(f.c));
        [["lnL", "left"], ["lnR", "right"], ["lnT", "top"], ["lnB", "bottom"]].forEach(([k, s]) => { const v = sideCss(kid(tcPr, k)); st.push("border-" + s + ":" + (v || ctx.L(1) + " solid rgba(0,0,0,.35)")); });
        const an = at(tcPr, "anchor");
        if (an === "ctr") st.push("vertical-align:middle"); else if (an === "b") st.push("vertical-align:bottom");
        const gs = num(at(tc, "gridSpan"), 1), rs = num(at(tc, "rowSpan"), 1);
        const pad = `padding:${ctx.L(num(at(tcPr, "marT"), 45720) / EMU)} ${ctx.L(num(at(tcPr, "marR"), 91440) / EMU)} ${ctx.L(num(at(tcPr, "marB"), 45720) / EMU)} ${ctx.L(num(at(tcPr, "marL"), 91440) / EMU)}`;
        const tx = textHTML(kid(tc, "txBody"), Object.assign({}, ctx, { L: () => "0" }), ctx.otherChain, []).replace(/^<div class="tx[^"]*" style="[^"]*">/, "").replace(/<\/div>$/, "");
        return `<td${gs > 1 ? ` colspan="${gs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""} style="${st.join(";")};${pad}">${tx}</td>`;
      }).join("")}</tr>`;
    }).join("");
    return `<div class="sh tb" style="left:${ctx.L(box.x)};top:${ctx.L(box.y)};width:${ctx.L(box.w)}"><table><colgroup>${cols.map(w => `<col style="width:${r3(w / total * 100)}%">`).join("")}</colgroup>${rows}</table></div>`;
  }
  /* 도형 목록 — mc:AlternateContent 는 Choice(안 되면 Fallback) */
  function tree(nodes, ctx, T, phOf) {
    let h = "";
    nodes.forEach(n => {
      const k = ln(n);
      if (k === "AlternateContent") {
        const ch = kids(n, "Choice")[0], fb = kid(n, "Fallback");
        const inner = ch ? tree(kids(ch), ctx, T, phOf) : "";
        h += inner || (fb ? tree(kids(fb), ctx, T, phOf) : "");
      } else if (k === "sp") {
        const ph = phOf ? phOf(n) : null;
        if (ph === false) return;
        h += shapeEl(n, ctx, T, ph);
      } else if (k === "cxnSp") h += shapeEl(n, ctx, T, null);
      else if (k === "pic") h += picEl(n, ctx, T);
      else if (k === "grpSp") {
        const gp = kid(n, "grpSpPr");
        const saved = ctx.grpFill;
        const gf = fillOf(gp, ctx); if (gf !== undefined) ctx.grpFill = gf;
        h += tree(kids(n), ctx, groupT(T, gp), phOf);
        ctx.grpFill = saved;
      } else if (k === "graphicFrame") {
        const gd = byTag(n, "graphicData")[0];
        const uri = at(gd, "uri") || "";
        const tbl = byTag(gd, "tbl")[0];
        if (tbl) h += tableEl(n, tbl, ctx, T);
        else {
          const raw = rawBox(kid(n, "xfrm"));
          if (/diagram/.test(uri) && ctx.diagram && raw) {
            const dt = ctx.diagram(n);
            if (dt) { h += tree(kids(dt), ctx, (b) => T({ x: raw.x + b.x, y: raw.y + b.y, w: b.w, h: b.h }), null); return; }
          }
          if (raw) { ctx.flags.chart = true; h += boxHTML(T(raw), ctx, `<span class="ph">${/chart/.test(uri) ? "차트" : "개체"}</span>`, 0, "pic0"); }
        }
      }
    });
    return h;
  }

  /* ── 파워포인트 ── */
  const isTitle = (t) => t === "title" || t === "ctrTitle";
  const phInfo = (sp) => { const p = byTag(kid(sp, "nvSpPr") || kid(sp, "nvPicPr") || sp, "ph")[0]; return p ? { type: at(p, "type") || "body", idx: at(p, "idx") } : null; };
  function phIndex(spTree) {
    const list = [];
    if (spTree) byTag(spTree, "sp").forEach(sp => { const p = phInfo(sp); if (p) list.push({ p, sp }); });
    return list;
  }
  function phFind(list, p) {
    if (!list || !p) return null;
    let hit = p.idx != null ? list.find(x => x.p.idx === p.idx) : null;
    if (!hit) hit = list.find(x => x.p.type === p.type || (isTitle(x.p.type) && isTitle(p.type)));
    if (!hit && !isTitle(p.type) && !/^(dt|ftr|sldNum|hdr)$/.test(p.type)) hit = list.find(x => x.p.type === "body" || x.p.type === "obj");
    return hit ? hit.sp : null;
  }
  function bgOf(cSld, ctx) {
    const bg = kid(cSld, "bg");
    if (!bg) return null;
    const pr = kid(bg, "bgPr");
    if (pr) { const f = fillOf(pr, ctx); return f || null; }
    const ref = kid(bg, "bgRef");
    if (ref) { const c = firstClr(ref, ctx); return c ? { c } : null; }
    return null;
  }
  function pptx(entries) {
    const get = (n) => entries.find(e => e.name === n);
    const presPath = "ppt/presentation.xml";
    const pres = get(presPath);
    if (!pres) throw new Error("pptx");
    const pd = xml(pres.data);
    const sz = byTag(pd, "sldSz")[0];
    const W = num(at(sz, "cx"), 9144000) / EMU, H = num(at(sz, "cy"), 6858000) / EMU;
    const prels = relsOf(entries, presPath);
    let order = byTag(pd, "sldId").map(s => { const r = prels[s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")]; return r ? r.path : ""; }).filter(p => p && get(p));
    if (!order.length) order = entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => numOf(a.name) - numOf(b.name)).map(e => e.name);
    if (!order.length) throw new Error("pptx");
    const defStyle = byTag(pd, "defaultTextStyle")[0] || null;
    const budget = { left: MAX_IMG };
    const flags = {};
    const cache = {};
    const part = (path) => { if (!cache[path]) { const e = get(path); cache[path] = e ? { doc: xml(e.data), rels: relsOf(entries, path), path } : null; } return cache[path]; };
    const relOfType = (rels, t) => { const k = Object.keys(rels).find(id => rels[id].type === t); return k ? rels[k].path : ""; };
    const slides = order.map((sp, i) => {
      const s = part(sp);
      const lay = part(relOfType(s.rels, "slideLayout")) || null;
      const mas = lay ? part(relOfType(lay.rels, "slideMaster")) : null;
      const th = themeOf(entries, mas ? relOfType(mas.rels, "theme") : "");
      const ctx = { entries, W, H, theme: th.theme, fonts: th.fonts, map: clrMapOf(mas ? byTag(mas.doc, "clrMap")[0] : null), budget, flags, uid: i * 100000,
        L: (px) => r3(px / W * 100) + "cqw", F: (pt) => r3(pt * 96 / 72 / W * 100) + "cqw" };
      const ovr = byTag(s.doc, "clrMapOvr")[0], om = ovr ? byTag(ovr, "overrideClrMapping")[0] : null;
      if (om) ctx.map = clrMapOf(om);
      const txSt = mas ? byTag(mas.doc, "txStyles")[0] : null;
      const tsTitle = txSt ? kid(txSt, "titleStyle") : null, tsBody = txSt ? kid(txSt, "bodyStyle") : null, tsOther = txSt ? kid(txSt, "otherStyle") : null;
      ctx.otherChain = [defStyle, tsOther].filter(Boolean);
      const lTree = lay ? byTag(lay.doc, "spTree")[0] : null, mTree = mas ? byTag(mas.doc, "spTree")[0] : null;
      const lPh = phIndex(lTree), mPh = phIndex(mTree);
      const phOf = (spEl, own) => {
        const p = phInfo(spEl);
        if (!p) return null;
        if (!own) return false;                                   // 레이아웃 · 마스터의 자리표시자는 안내 글이라 그리지 않는다
        const l = phFind(lPh, p), m = phFind(mPh, l ? phInfo(l) || p : p);
        const lst = [l, m].filter(Boolean).map(x => kid(kid(x, "txBody"), "lstStyle")).filter(Boolean);
        const ts = isTitle(p.type) ? tsTitle : /^(dt|ftr|sldNum|hdr)$/.test(p.type) ? tsOther : tsBody;
        const xf = [l, m].filter(Boolean).map(x => xfrmOf(kid(x, "spPr"))).find(Boolean) || null;
        return { chain: lst.concat([ts, defStyle]).filter(Boolean), bodies: [l, m].filter(Boolean).map(x => kid(kid(x, "txBody"), "bodyPr")).filter(Boolean),
          xfrm: xf, spPr: l ? kid(l, "spPr") : null, geom: l ? kid(kid(l, "spPr"), "prstGeom") : null };
      };
      const cSld = kid(s.doc.documentElement, "cSld");
      let bg = bgOf(cSld, ctx);
      if (!bg && lay) bg = bgOf(kid(lay.doc.documentElement, "cSld"), ctx);
      if (!bg && mas) bg = bgOf(kid(mas.doc.documentElement, "cSld"), ctx);
      let shapes = "";
      const showM = (d) => !/^(0|false)$/.test(at(d && d.documentElement, "showMasterSp") || "");
      if (mas && mTree && showM(s.doc) && (!lay || showM(lay.doc))) { ctx.rels = mas.rels; shapes += tree(kids(mTree), ctx, T0, (x) => (phInfo(x) ? false : null)); }
      if (lay && lTree && showM(s.doc)) { ctx.rels = lay.rels; shapes += tree(kids(lTree), ctx, T0, (x) => (phInfo(x) ? false : null)); }
      ctx.rels = s.rels;
      const drawings = Object.keys(s.rels).filter(k => s.rels[k].type === "diagramDrawing").map(k => s.rels[k].path);
      let di = 0;
      ctx.diagram = () => { const p = drawings[di++]; const pp = p ? part(p) : null; return pp ? byTag(pp.doc, "spTree")[0] : null; };
      const sTree = byTag(s.doc, "spTree")[0];
      if (sTree) shapes += tree(kids(sTree), ctx, T0, (x) => phOf(x, true));
      const bgCss = !bg ? "#fff" : bg.c ? css(bg.c) : bg.grad ? `linear-gradient(${r3((bg.ang || 0) + 90)}deg,${css(bg.grad[0])},${css(bg.grad[1])})` : "#fff";
      const bgImg = bg && bg.img ? `<img class="bgi" src="${bg.img}" alt="">` : "";
      return `<section class="sl" aria-label="슬라이드 ${i + 1}"><div class="sb" style="aspect-ratio:${r3(W)}/${r3(H)};background:${bgCss}">${bgImg}${shapes}</div><div class="sn">${i + 1} / ${order.length}</div></section>`;
    }).join("");
    const css0 = `html{background:#e9ece9}body{margin:0;padding:12px 10px;color:#000;font:12pt/1.2 ${FONT}}
.sl{max-width:1280px;margin:0 auto 6px}
.sb{position:relative;container-type:inline-size;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.sn{margin:4px 2px 10px;text-align:right;font-size:9pt;color:#666}
.sh{position:absolute;box-sizing:border-box}
.sh .g{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.sh.pic{overflow:hidden}.sh.pic img{display:block}
.bgi{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tx{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:visible;word-break:keep-all;overflow-wrap:break-word}
.tx.nw{overflow:visible}
.tx p{margin:0;white-space:pre-wrap}.tx.nw p{white-space:pre}
.bu{display:inline-block;min-width:1em;margin-right:.35em;text-indent:0}
.tb table{width:100%;border-collapse:collapse;table-layout:fixed}.tb td{vertical-align:top;overflow:hidden}.tb td p{margin:0}
.pic0{border:1px dashed #999;display:flex;align-items:center;justify-content:center}.ph{font-size:9pt;color:#777;background:rgba(255,255,255,.8);padding:0 4px}`;
    const notes = [];
    if (flags.pic || budget.over) notes.push("일부 그림(EMF · 큰 그림)은 표시하지 않음");
    if (flags.chart) notes.push("차트 · 개체는 자리만 표시");
    return { kind: "pptx", parts: [{ name: "", doc: SP._h.page(css0, slides), notes }] };
  }

  /* ── 엑셀 시트의 그림 · 도형 → [{ r, c(1부터), dx, dy(px), w, h, html }] ── */
  function sheetDrawings(entries, sheetPath, sheetDoc, budget) {
    const srels = relsOf(entries, sheetPath);
    const dEl = byTag(sheetDoc, "drawing")[0];
    const id = dEl ? dEl.getAttribute("r:id") || dEl.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") : "";
    const path = id && srels[id] ? srels[id].path : "";
    const e = path && entries.find(x => x.name === path);
    if (!e) return { items: [], flags: {} };
    const d = xml(e.data);
    const wbRels = relsOf(entries, "xl/workbook.xml");
    const tk = Object.keys(wbRels).find(k => wbRels[k].type === "theme");
    const th = themeOf(entries, tk ? wbRels[tk].path : "xl/theme/theme1.xml");
    const flags = {};
    const ctx = { entries, theme: th.theme, fonts: th.fonts, map: Object.assign({}, CLRMAP_DEF), budget, flags, uid: 0, rels: relsOf(entries, path),
      L: (px) => r3(px) + "px", F: (pt) => r3(pt) + "pt", otherChain: [] };
    const items = [];
    kids(d.documentElement).forEach(a => {
      const k = ln(a);
      if (!/Anchor$/.test(k)) return;
      const fr = kid(a, "from"), to = kid(a, "to");
      const cell = (x) => ({ c: num(kid(x, "col") && kid(x, "col").textContent, 0) + 1, r: num(kid(x, "row") && kid(x, "row").textContent, 0) + 1,
        dx: num(kid(x, "colOff") && kid(x, "colOff").textContent, 0) / EMU, dy: num(kid(x, "rowOff") && kid(x, "rowOff").textContent, 0) / EMU });
      const el = kids(a).find(x => /^(pic|sp|cxnSp|grpSp|graphicFrame)$/.test(ln(x)));
      if (!el) return;
      const own = ln(el) === "grpSp" ? xfrmOf(kid(el, "grpSpPr")) : ln(el) === "graphicFrame" ? kid(el, "xfrm") : xfrmOf(kid(el, "spPr"));
      const ob = own ? rawBox(own) : null;
      const ext = kid(a, "ext");
      let w = ob && ob.w ? ob.w / EMU : ext ? num(at(ext, "cx"), 0) / EMU : 0, h = ob && ob.h ? ob.h / EMU : ext ? num(at(ext, "cy"), 0) / EMU : 0;
      const pos = k === "absoluteAnchor" ? kid(a, "pos") : null;
      const f = fr ? cell(fr) : { c: 1, r: 1, dx: pos ? num(at(pos, "x"), 0) / EMU : 0, dy: pos ? num(at(pos, "y"), 0) / EMU : 0 };
      const item = { r: f.r, c: f.c, dx: f.dx, dy: f.dy, w, h, to: to ? cell(to) : null };
      /* 내용은 상자(0,0 기준)에 — 자기 좌표(off)를 빼서 그린다 */
      const base = ob || { x: 0, y: 0, w: w * EMU, h: h * EMU };
      item.render = (W2, H2) => {
        const sx = base.w ? W2 * EMU / base.w : 1, sy = base.h ? H2 * EMU / base.h : 1;
        const T = (b) => ({ x: (b.x - base.x) * sx / EMU, y: (b.y - base.y) * sy / EMU, w: b.w * sx / EMU, h: b.h * sy / EMU });
        return tree([el], ctx, T, null);
      };
      items.push(item);
    });
    return { items, flags };
  }

  const DRAW_CSS = `.dr{position:absolute;z-index:5;pointer-events:none}
.dr .sh{position:absolute;box-sizing:border-box}
.dr .sh .g{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.dr .sh.pic{overflow:hidden}.dr .sh.pic img{display:block}
.dr .tx{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;white-space:normal;word-break:keep-all}
.dr .tx p{margin:0;white-space:pre-wrap}
.dr .bu{display:inline-block;min-width:1em;margin-right:.35em}
.dr .pic0{border:1px dashed #999;display:flex;align-items:center;justify-content:center}.dr .ph{font-size:8pt;color:#777}
td.anc{position:relative;overflow:visible}`;

  SP.register = SP.register || {};
  SP.register.draw = { pptx, sheetDrawings, DRAW_CSS, clr, themeOf, geomPath };
})();
