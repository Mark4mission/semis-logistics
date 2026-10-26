/* 첨부 미리보기 — 엑셀(XLSX · XLSM) · CSV · 워드(DOCX) · 한글(HWPX) · 파워포인트(PPTX) · 글(TXT)을 브라우저에서 직접 읽어 HTML 문서로 그린다.
   파일은 밖으로 보내지 않는다. 결과는 스크립트 없는 문서(sandbox iframe 의 srcdoc)로만 쓰고, 파일 속 글은 모두 이스케이프하며
   스타일에는 검사한 숫자 · 색(#RRGGBB)만 넣는다. 압축 풀기는 hwpx.js(SemisHwpx.unzip) */
"use strict";

(() => {
  const MAX_BYTES = 20 * 1024 * 1024, MAX_ROWS = 3000, MAX_COLS = 120, MAX_CELLS = 180000, MAX_TEXT = 400000;
  const KIND = { xlsx: "xlsx", xlsm: "xlsx", csv: "csv", tsv: "csv", txt: "text", md: "text", log: "text", docx: "docx", hwpx: "hwpx", pptx: "pptx" };
  const extOf = (s) => { const m = /\.([A-Za-z0-9]{1,5})(?:[?#]|$)/.exec(String(s || "")); return m ? m[1].toLowerCase() : ""; };
  const kindOf = (name) => KIND[extOf(name)] || "";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dec = (u8) => new TextDecoder("utf-8").decode(u8);
  function xml(u8) {
    const d = new DOMParser().parseFromString(typeof u8 === "string" ? u8 : dec(u8), "application/xml");
    if (d.getElementsByTagName("parsererror").length) throw new Error("xml");
    return d;
  }
  const ln = (el) => el.localName || String(el.nodeName).replace(/^.*:/, "");
  const kids = (el, n) => Array.from((el && el.childNodes) || []).filter(x => x.nodeType === 1 && (!n || ln(x) === n));
  const kid = (el, n) => kids(el, n)[0] || null;
  const byTag = (el, n) => (el ? Array.from(el.getElementsByTagNameNS("*", n)) : []);
  const at = (el, n) => (el ? el.getAttribute(n) : null);
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
  const f2 = (n) => String(Math.round(n * 100) / 100);
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rid = (el) => (el ? el.getAttribute("r:id") || el.getAttributeNS(REL, "id") || "" : "");
  const onOff = (el) => !!el && !/^(0|false|off|none)$/i.test(at(el, "val") || "");
  const FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif";
  const numOf = (name) => Number((/(\d+)\.xml$/.exec(name) || [0, 0])[1]);

  /* ── 색 ── */
  const hex6 = (v) => { const s = String(v || "").replace(/^#/, ""); return /^[0-9a-f]{8}$/i.test(s) ? s.slice(2) : /^[0-9a-f]{6}$/i.test(s) ? s : ""; };
  function tint(h, t) {
    if (!h || !t) return h;
    let r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let hh = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh /= 6;
    }
    l = t < 0 ? l * (1 + t) : l * (1 - t) + t;
    const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s, p2 = 2 * l - q2;
    const f = (x) => { if (x < 0) x += 1; if (x > 1) x -= 1; return x < 1 / 6 ? p2 + (q2 - p2) * 6 * x : x < 1 / 2 ? q2 : x < 2 / 3 ? p2 + (q2 - p2) * (2 / 3 - x) * 6 : p2; };
    const c = s === 0 ? [l, l, l] : [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
    return c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
  }
  const PALETTE = ("000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
    "800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF " +
    "000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 " +
    "3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333").split(" ");
  /* 엑셀 색 요소(rgb | theme + tint | indexed | auto) → "RRGGBB" | "" */
  function xlColor(el, wb) {
    if (!el) return "";
    let h = "";
    if (at(el, "rgb")) h = hex6(at(el, "rgb"));
    else if (at(el, "theme") != null) h = wb.theme[num(at(el, "theme"), -1)] || "";
    else if (at(el, "indexed") != null) { const i = num(at(el, "indexed"), -1); h = wb.palette[i] || (i === 64 ? "000000" : i === 65 ? "FFFFFF" : ""); }
    if (!h) return "";
    return tint(h, num(at(el, "tint"), 0));
  }

  /* ── 엑셀 표시 형식 ── */
  const BUILTIN = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: "#,##0;-#,##0", 6: "#,##0;[Red]-#,##0", 7: "#,##0.00;-#,##0.00",
    8: "#,##0.00;[Red]-#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "General", 13: "General", 14: "yyyy-mm-dd", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy",
    18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "yyyy-mm-dd h:mm", 32: "h:mm", 33: "h:mm:ss",
    37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)",
    41: '_-* #,##0_-;-* #,##0_-;_-* "-"_-;_-@_-', 42: '_-* #,##0_-;-* #,##0_-;_-* "-"_-;_-@_-',
    43: '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-', 44: '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-',
    45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@" };
  [27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58].forEach(i => { BUILTIN[i] = "yyyy-mm-dd"; });
  const COLOR_NAMES = { black: "000000", blue: "0000FF", cyan: "00FFFF", green: "008000", magenta: "FF00FF", red: "FF0000", white: "FFFFFF", yellow: "FFFF00" };
  function sections(code) {
    const out = [];
    let cur = "", q = false, br = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (q) { cur += ch; if (ch === '"') q = false; continue; }
      if (ch === "\\" && i + 1 < code.length) { cur += ch + code[++i]; continue; }
      if (ch === '"') { q = true; cur += ch; continue; }
      if (ch === "[") br = true; else if (ch === "]") br = false;
      if (ch === ";" && !br) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  /* 대괄호 — 색 · 조건 · 로캘은 떼고, 통화 기호는 글자로, 경과 시간([h])은 표시 */
  function brackets(sec) {
    let color = "", korean = false;
    const s = sec.replace(/\[([^\]]*)\]/g, (m, inner) => {
      const low = inner.toLowerCase();
      if (COLOR_NAMES[low]) { color = COLOR_NAMES[low]; return ""; }
      if (/^color\s*\d+$/.test(low)) return "";
      if (/^(h+|m+|s+)$/.test(low)) return "\u0001" + low + "\u0002";
      if (inner[0] === "$") {
        const mm = /^\$([^-]*)(?:-([0-9a-f]+))?$/i.exec(inner);
        if (mm && mm[2] && /^(4)?12$/i.test(mm[2].replace(/^0+/, "").slice(-3))) korean = true;
        return mm && mm[1] ? '"' + mm[1].replace(/"/g, "") + '"' : "";
      }
      return "";
    });
    return { s, color, korean };
  }
  const plain = (sec) => sec.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/[_*]./g, "").replace(/\u0001[^\u0002]*\u0002/g, "h");
  const isDateSec = (sec) => { const r = plain(sec).replace(/general/gi, ""); return /[ydhs]/i.test(r) || /a{3,4}/i.test(r) || (/m/i.test(r) && !/[0#?]/.test(r.replace(/\.0+/g, ""))); };
  function general(n) {
    if (!isFinite(n)) return String(n);
    if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
    if (Math.abs(n) >= 1e11 || (Math.abs(n) < 1e-9 && n !== 0)) return n.toExponential(5).replace(/\.?0+e/, "E").replace(/e/, "E").replace(/E(\d)/, "E+$1");
    return String(Number(n.toPrecision(11)));
  }
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const WEEK_KO = ["일", "월", "화", "수", "목", "금", "토"];
  function dateParts(n, d1904) {
    const serial = n + (d1904 ? 1462 : 0);
    const ms = Math.round((serial < 61 && !d1904 ? serial + 1 : serial) * 86400000);
    const t = new Date(Date.UTC(1899, 11, 30) + ms);
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), ms: t.getUTCMilliseconds(), total: serial };
  }
  function fmtDate(n, sec, d1904, korean) {
    if (n < 0) return "#####";
    const toks = [];
    for (let i = 0; i < sec.length;) {
      const rest = sec.slice(i), ch = sec[i];
      let m;
      if (ch === '"') { const j = sec.indexOf('"', i + 1); toks.push({ lit: sec.slice(i + 1, j < 0 ? sec.length : j) }); i = j < 0 ? sec.length : j + 1; continue; }
      if (ch === "\\") { toks.push({ lit: sec[i + 1] || "" }); i += 2; continue; }
      if (ch === "_") { toks.push({ lit: " " }); i += 2; continue; }
      if (ch === "*") { i += 2; continue; }
      if (ch === "\u0001") { const j = sec.indexOf("\u0002", i); toks.push({ el: sec.slice(i + 1, j) }); i = j + 1; continue; }
      if ((m = /^(am\/pm|a\/p|오전\/오후)/i.exec(rest))) { toks.push({ ap: m[1] }); i += m[1].length; continue; }
      if ((m = /^(y+|m+|d+|h+|s+|a{3,4})/i.exec(rest))) { toks.push({ k: m[1].toLowerCase() }); i += m[1].length; continue; }
      if ((m = /^\.(0+)/.exec(rest)) && toks.length && toks[toks.length - 1].k && toks[toks.length - 1].k[0] === "s") { toks.push({ fr: m[1].length }); i += m[0].length; continue; }
      toks.push({ lit: ch }); i++;
    }
    const ap = toks.some(x => x.ap);
    const frTok = toks.find(x => x.fr);
    const p = dateParts(frTok ? n : Math.round(n * 86400) / 86400, d1904);
    const code = (x) => (x.k ? x.k[0] : x.el ? "E" : x.ap ? "A" : "");
    const near = (i, dir) => { for (let j = i + dir; j >= 0 && j < toks.length; j += dir) { const c = code(toks[j]); if (c && c !== "A") return toks[j]; } return null; };
    const pad = (v, n) => String(v).padStart(n, "0");
    const secs = p.s, frac = p.ms;
    return toks.map((x, i) => {
      if (x.lit != null) return x.lit;
      if (x.ap) { const pm = p.h >= 12; if (/오전/.test(x.ap) || korean) return pm ? "오후" : "오전"; if (/^a\/p$/i.test(x.ap)) return pm ? "P" : "A"; return pm ? "PM" : "AM"; }
      if (x.fr) return "." + pad(Math.floor(frac / Math.pow(10, 3 - Math.min(3, x.fr))), Math.min(3, x.fr));
      if (x.el) {
        const tot = p.total * 86400;
        const v = x.el[0] === "h" ? Math.floor(tot / 3600) : x.el[0] === "m" ? Math.floor(tot / 60) : Math.round(tot);
        return pad(v, x.el.length);
      }
      const k = x.k;
      if (k[0] === "y") return k.length <= 2 ? pad(p.y % 100, 2) : String(p.y);
      if (k[0] === "m") {
        const prev = near(i, -1), next = near(i, 1);
        const minute = (prev && (code(prev) === "h" || code(prev) === "E")) || (next && code(next) === "s");
        if (minute && k.length <= 2) return k.length === 2 ? pad(p.mi, 2) : String(p.mi);
        if (k.length === 1) return String(p.mo + 1);
        if (k.length === 2) return pad(p.mo + 1, 2);
        if (k.length === 3) return MON[p.mo].slice(0, 3);
        if (k.length === 4) return MON[p.mo];
        return MON[p.mo][0];
      }
      if (k[0] === "d") return k.length === 1 ? String(p.d) : k.length === 2 ? pad(p.d, 2) : k.length === 3 ? WEEK[p.wd].slice(0, 3) : WEEK[p.wd];
      if (k[0] === "a") return k.length === 3 ? WEEK_KO[p.wd] : WEEK_KO[p.wd] + "요일";
      if (k[0] === "h") { let h = p.h; if (ap) { h = h % 12; if (!h) h = 12; } return k.length >= 2 ? pad(h, 2) : String(h); }
      if (k[0] === "s") return k.length >= 2 ? pad(secs % 60, 2) : String(secs % 60);
      return "";
    }).join("");
  }
  /* 소수 반올림 — 1.255 같은 이진 오차를 15자리에서 정리한 뒤 반올림(엑셀과 같게) */
  const fixed = (v, d) => { const k = Math.pow(10, d); return (Math.round(Number((v * k).toPrecision(15))) / k).toFixed(d); };
  /* 숫자 형식 한 구역 — 앞뒤 글자 · 자릿수(0 # ?) · 천 단위 쉼표 · 소수 · % · 지수 · 숫자 사이 글자(000-00-00000) */
  function fmtNumber(n, sec, withSign) {
    const toks = [];
    for (let i = 0; i < sec.length;) {
      const ch = sec[i];
      if (ch === '"') { const j = sec.indexOf('"', i + 1); toks.push({ lit: sec.slice(i + 1, j < 0 ? sec.length : j) }); i = j < 0 ? sec.length : j + 1; continue; }
      if (ch === "\\") { toks.push({ lit: sec[i + 1] || "" }); i += 2; continue; }
      if (ch === "_") { toks.push({ lit: " " }); i += 2; continue; }
      if (ch === "*") { i += 2; continue; }
      if (/[eE]/.test(ch) && /[+-]/.test(sec[i + 1] || "")) { toks.push({ e: sec[i + 1] }); i += 2; continue; }
      if (/[0#?.,%@]/.test(ch)) { toks.push({ ph: ch }); i++; continue; }
      toks.push({ lit: ch }); i++;
    }
    const isPh = (x) => x.ph && /[0#?]/.test(x.ph);
    const first = toks.findIndex(isPh);
    if (first < 0) {
      const t = toks.map(x => (x.lit != null ? x.lit : x.ph === "@" ? "" : x.ph === "%" ? "%" : x.ph === "." ? "." : "")).join("");
      return (withSign && n < 0 ? "-" : "") + t;
    }
    let last = toks.length - 1;
    while (last >= 0 && !(isPh(toks[last]) || toks[last].e != null)) last--;
    if (toks[last] && toks[last].e != null) { last++; while (last + 1 < toks.length && isPh(toks[last + 1])) last++; }
    let scale = 0;
    for (let j = last + 1; j < toks.length && toks[j].ph === ","; j++) { scale++; toks[j] = { lit: "" }; }
    const core = toks.slice(first, last + 1);
    const pre = toks.slice(0, first), post = toks.slice(last + 1);
    const pct = toks.filter(x => x.ph === "%").length;
    let v = Math.abs(n) * Math.pow(100, pct) / Math.pow(1000, scale);
    const litOf = (arr) => arr.map(x => (x.lit != null ? x.lit : x.ph === "%" ? "%" : x.ph === "," ? "," : x.ph === "." ? "." : "")).join("");
    const ei = core.findIndex(x => x.e != null);
    let body;
    if (ei >= 0) {
      const mant = core.slice(0, ei), expo = core.slice(ei + 1);
      const dot = mant.findIndex(x => x.ph === ".");
      const decs = dot < 0 ? 0 : mant.slice(dot + 1).filter(isPh).length;
      const intDigits = Math.max(1, (dot < 0 ? mant : mant.slice(0, dot)).filter(isPh).length);
      let e = v === 0 ? 0 : Math.floor(Math.log10(v));
      if (intDigits > 1) e = Math.floor(e / intDigits) * intDigits;
      let m = v / Math.pow(10, e);
      m = Number(m.toFixed(decs));
      if (m >= Math.pow(10, intDigits)) { m /= 10; e += 1; m = Number(m.toFixed(decs)); }
      const es = String(Math.abs(e)).padStart(Math.max(1, expo.filter(isPh).length), "0");
      body = m.toFixed(decs) + "E" + (e < 0 ? "-" : core[ei].e === "+" ? "+" : "") + es;
    } else {
      const dot = core.findIndex(x => x.ph === ".");
      const ip = dot < 0 ? core : core.slice(0, dot), dp = dot < 0 ? [] : core.slice(dot + 1);
      const maxDec = dp.filter(isPh).length, minDec = (() => { let k = 0; for (const x of dp) { if (!isPh(x)) continue; if (x.ph === "0") k++; else break; } return k; })();
      let s = fixed(v, maxDec);
      let [is, ds] = s.split(".");
      ds = ds || "";
      while (ds.length > minDec && ds.endsWith("0")) ds = ds.slice(0, -1);
      const group = ip.some(x => x.ph === ",");
      const iph = ip.filter(isPh);
      const minInt = iph.filter(x => x.ph === "0").length;
      if (is === "0" && minInt === 0) is = "";
      const others = ip.filter(x => !isPh(x) && x.ph !== ",");
      let ints;
      if (!others.length) {
        ints = is.padStart(minInt, "0");
        if (group) ints = ints.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      } else {
        const ds2 = is.split("");
        const out = [];
        for (let j = ip.length - 1; j >= 0; j--) {
          const x = ip[j];
          if (isPh(x)) { out.unshift(ds2.length ? ds2.pop() : x.ph === "0" ? "0" : x.ph === "?" ? " " : ""); }
          else if (x.ph === ",") continue;
          else { const leftZero = ip.slice(0, j).some(y => y.ph === "0"); if (ds2.length || leftZero) out.unshift(x.lit != null ? x.lit : ""); }
        }
        ints = ds2.join("") + out.join("");
      }
      body = dot < 0 ? ints : maxDec ? ints + (ds.length ? "." + ds : "") : ints + ".";
    }
    return (withSign && n < 0 && Number(body.replace(/[^0-9.]/g, "")) !== 0 ? "-" : "") + litOf(pre) + body + litOf(post);
  }
  /* 숫자 + 형식 문자열 → { t: 글자, color, date } */
  function format(n, code, d1904) {
    code = String(code == null ? "General" : code);
    if (!isFinite(n)) return { t: String(n) };
    if (/^general$/i.test(code.trim()) || !code.trim()) return { t: general(n) };
    const secs = sections(code);
    let si = 0, sign = true;
    if (secs.length >= 2 && n < 0) { si = 1; sign = false; }
    else if (secs.length >= 3 && n === 0) si = 2;
    const raw = secs[si] != null ? secs[si] : secs[0];
    const b = brackets(raw);
    if (/^\s*general\s*$/i.test(plain(b.s))) return { t: (sign ? "" : "") + general(si === 1 ? Math.abs(n) : n), color: b.color };
    if (isDateSec(b.s)) return { t: fmtDate(n, b.s, d1904, b.korean), color: b.color, date: true };
    if (/[?]\/[?#0]/.test(plain(b.s))) return { t: general(n), color: b.color };
    return { t: fmtNumber(n, b.s, sign), color: b.color };
  }

  /* ── XLSX ── */
  function workbook(entries) {
    const get = (n) => entries.find(e => e.name === n);
    const wb = { theme: [], palette: PALETTE.slice(), fmts: {}, fonts: [], fills: [], borders: [], xfs: [], strs: [], sheets: [], d1904: false, notes: [] };
    const th = entries.find(e => /^xl\/theme\/theme\d*\.xml$/.test(e.name));
    if (th) {
      const cs = byTag(xml(th.data), "clrScheme")[0];
      const val = (n) => { const e = kid(cs, n); const c = e && kids(e)[0]; return c ? hex6(at(c, "val") === "windowText" ? at(c, "lastClr") || "000000" : at(c, "lastClr") || at(c, "val")) : ""; };
      if (cs) wb.theme = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map(val);
    }
    const st = get("xl/styles.xml");
    if (st) {
      const d = xml(st.data);
      byTag(d, "numFmt").forEach(f => { wb.fmts[at(f, "numFmtId")] = at(f, "formatCode") || ""; });
      const ic = byTag(d, "indexedColors")[0];
      if (ic) kids(ic, "rgbColor").forEach((c, i) => { const h = hex6(at(c, "rgb")); if (h) wb.palette[i] = h; });
      const fonts = byTag(d, "fonts")[0], fills = byTag(d, "fills")[0], borders = byTag(d, "borders")[0], xfs = byTag(d, "cellXfs")[0];
      wb.fonts = kids(fonts, "font").map(f => ({ b: onOff(kid(f, "b")), i: onOff(kid(f, "i")), u: !!kid(f, "u") && at(kid(f, "u"), "val") !== "none",
        s: onOff(kid(f, "strike")), sz: num(at(kid(f, "sz"), "val"), 0), color: xlColor(kid(f, "color"), wb), va: at(kid(f, "vertAlign"), "val") || "" }));
      wb.fills = kids(fills, "fill").map(f => {
        const pf = kid(f, "patternFill");
        if (pf) { const pt = at(pf, "patternType"); if (!pt || pt === "none") return ""; return xlColor(kid(pf, "fgColor"), wb) || xlColor(kid(pf, "bgColor"), wb) || (pt === "solid" ? "" : ""); }
        const gf = kid(f, "gradientFill");
        if (gf) { const s0 = byTag(gf, "stop")[0]; return s0 ? xlColor(kid(s0, "color"), wb) : ""; }
        return "";
      });
      wb.borders = kids(borders, "border").map(b => {
        const side = (n, alt) => { const e = kid(b, n) || (alt ? kid(b, alt) : null); const s = at(e, "style"); return s && s !== "none" ? { s, c: xlColor(kid(e, "color"), wb) || "000000" } : null; };
        return { l: side("left", "start"), r: side("right", "end"), t: side("top"), b: side("bottom") };
      });
      wb.xfs = kids(xfs, "xf").map(x => {
        const al = kid(x, "alignment");
        return { fmt: num(at(x, "numFmtId"), 0), font: num(at(x, "fontId"), 0), fill: num(at(x, "fillId"), 0), border: num(at(x, "borderId"), 0),
          h: at(al, "horizontal") || "", v: at(al, "vertical") || "", wrap: /^(1|true)$/i.test(at(al, "wrapText") || ""),
          ind: num(at(al, "indent"), 0) };
      });
    }
    const ss = get("xl/sharedStrings.xml");
    if (ss) wb.strs = byTag(xml(ss.data), "si").map(si => byTag(si, "t").filter(t => ln(t.parentNode) !== "rPh").map(t => t.textContent).join(""));
    const w = get("xl/workbook.xml"), rels = get("xl/_rels/workbook.xml.rels");
    if (w) {
      const wd = xml(w.data);
      const pr = byTag(wd, "workbookPr")[0];
      wb.d1904 = !!pr && /^(1|true)$/i.test(at(pr, "date1904") || "");
      const rmap = {};
      if (rels) byTag(xml(rels.data), "Relationship").forEach(r => { rmap[at(r, "Id")] = at(r, "Target") || ""; });
      wb.sheets = byTag(wd, "sheet").map(s => {
        const tg = String(rmap[rid(s)] || "");
        const path = tg ? (tg[0] === "/" ? tg.slice(1) : "xl/" + tg.replace(/^(\.\/)/, "")) : "";
        return { name: at(s, "name") || "", path, hidden: /hidden/i.test(at(s, "state") || "") };
      }).filter(s => s.path && get(s.path));
    }
    if (!wb.sheets.length) wb.sheets = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort((a, b) => numOf(a.name) - numOf(b.name))
      .map((e, i) => ({ name: "Sheet" + (i + 1), path: e.name, hidden: false }));
    wb.get = get;
    return wb;
  }
  const colIdx = (s) => { let n = 0; for (const ch of String(s).toUpperCase()) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n; };
  const colName = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  function ref(s) { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(s || "")); return m ? { c: colIdx(m[1]), r: Number(m[2]) } : null; }
  const BORDER_CSS = { thin: "1px solid", hair: "1px dotted", dotted: "1px dotted", dashed: "1px dashed", dashDot: "1px dashed", dashDotDot: "1px dotted",
    medium: "2px solid", mediumDashed: "2px dashed", mediumDashDot: "2px dashed", mediumDashDotDot: "2px dashed", slantDashDot: "2px dashed", thick: "3px solid", double: "3px double" };
  const H_ALIGN = { left: "left", center: "center", centerContinuous: "center", right: "right", justify: "justify", distributed: "justify", fill: "left" };
  const V_ALIGN = { top: "top", center: "middle", bottom: "bottom", justify: "middle", distributed: "middle" };
  function cellValue(c, wb) {
    const xf = wb.xfs[c.s] || wb.xfs[0] || { fmt: 0 };
    if (c.t === "s") return { t: wb.strs[num(c.v, -1)] || "", kind: "s" };
    if (c.t === "inlineStr") return { t: c.is || "", kind: "s" };
    if (c.t === "str") return { t: c.v || "", kind: "s" };
    if (c.t === "b") return { t: c.v === "1" ? "TRUE" : c.v === "0" ? "FALSE" : "", kind: "b" };
    if (c.t === "e") return { t: c.v || "", kind: "e" };
    if (c.v == null || c.v === "") return { t: "", kind: "" };
    if (c.t === "d") {
      const t = Date.parse(c.v);
      if (!isFinite(t)) return { t: c.v, kind: "s" };
      const serial = (t - Date.UTC(1899, 11, 30)) / 86400000;
      const f = format(serial, wb.fmts[xf.fmt] != null ? wb.fmts[xf.fmt] : BUILTIN[xf.fmt] || "yyyy-mm-dd", false);
      return { t: f.t, kind: "n", color: f.color };
    }
    const n = Number(c.v);
    if (!isFinite(n)) return { t: c.v, kind: "s" };
    const code = wb.fmts[xf.fmt] != null ? wb.fmts[xf.fmt] : BUILTIN[xf.fmt] != null ? BUILTIN[xf.fmt] : "General";
    if (code === "@") return { t: general(n), kind: "n" };
    const f = format(n, code, wb.d1904);
    return { t: f.t, kind: "n", color: f.color };
  }
  function sheetHTML(wb, sh) {
    const d = xml(wb.get(sh.path).data);
    const notes = [];
    const sv = byTag(d, "sheetView")[0];
    const grid = !sv || !/^(0|false)$/i.test(at(sv, "showGridLines") || "");
    const fp = byTag(d, "sheetFormatPr")[0];
    const defW = num(at(fp, "defaultColWidth"), 0) || (num(at(fp, "baseColWidth"), 8) + 0.71);
    const defH = num(at(fp, "defaultRowHeight"), 15) || 15;
    const colW = {}, colHid = {}, colStyle = {};
    byTag(d, "col").forEach(c => {
      const a = num(at(c, "min"), 0), b = Math.min(num(at(c, "max"), 0), MAX_COLS + 50);
      for (let k = a; k <= b; k++) {
        if (at(c, "width") != null) colW[k] = num(at(c, "width"), defW);
        if (/^(1|true)$/i.test(at(c, "hidden") || "")) colHid[k] = true;
        if (at(c, "style") != null) colStyle[k] = num(at(c, "style"), 0);
      }
    });
    const rowH = {}, rowHid = {};
    const cells = new Map();
    let maxR = 0, maxC = 0, cut = false, rowNo = 0;
    const key = (r, c) => r * 20000 + c;
    const styled = (s) => { const x = wb.xfs[s]; if (!x) return false; const b = wb.borders[x.border]; return !!(wb.fills[x.fill] || (b && (b.l || b.r || b.t || b.b))); };
    byTag(d, "row").forEach(row => {
      rowNo = num(at(row, "r"), rowNo + 1);
      if (rowNo > MAX_ROWS) { cut = true; return; }
      if (at(row, "ht") != null) rowH[rowNo] = num(at(row, "ht"), defH);
      if (/^(1|true)$/i.test(at(row, "hidden") || "")) rowHid[rowNo] = true;
      let colNo = 0;
      kids(row, "c").forEach(c => {
        const rf = ref(at(c, "r"));
        colNo = rf ? rf.c : colNo + 1;
        if (colNo > MAX_COLS) { cut = true; return; }
        const v = kid(c, "v"), is = kid(c, "is");
        const cell = { s: num(at(c, "s"), 0), t: at(c, "t") || "", v: v ? v.textContent : null, is: is ? byTag(is, "t").filter(t => ln(t.parentNode) !== "rPh").map(t => t.textContent).join("") : "" };
        cells.set(key(rowNo, colNo), cell);
        const has = (cell.v != null && cell.v !== "") || cell.is;
        if (has || styled(cell.s)) { if (rowNo > maxR) maxR = rowNo; if (colNo > maxC) maxC = colNo; }
      });
    });
    const merges = [];
    byTag(d, "mergeCell").forEach(m => {
      const [a, b] = String(at(m, "ref") || "").split(":").map(ref);
      if (!a || !b) return;
      const g = { r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.min(Math.max(a.r, b.r), MAX_ROWS), c1: Math.min(Math.max(a.c, b.c), MAX_COLS) };
      if (g.r0 > MAX_ROWS || g.c0 > MAX_COLS) return;
      merges.push(g);
      if (g.r1 > maxR) maxR = g.r1;
      if (g.c1 > maxC) maxC = g.c1;
    });
    if (maxR * Math.max(1, maxC) > MAX_CELLS) { maxR = Math.max(1, Math.floor(MAX_CELLS / Math.max(1, maxC))); cut = true; }
    if (cut) notes.push("앞 " + maxR.toLocaleString("en-US") + "행 · " + colName(Math.min(maxC, MAX_COLS)) + "열까지만 표시");
    if (byTag(d, "drawing").length || byTag(d, "legacyDrawing").length) notes.push("그림 · 차트는 표시하지 않음");
    const anchor = new Map(), covered = new Set();
    merges.forEach(g => { anchor.set(key(g.r0, g.c0), g); for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) if (r !== g.r0 || c !== g.c0) covered.add(key(r, c)); });
    const rows = [], cols = [];
    for (let r = 1; r <= maxR; r++) if (!rowHid[r]) rows.push(r);
    for (let c = 1; c <= maxC; c++) if (!colHid[c]) cols.push(c);
    const cellAt = (r, c) => cells.get(key(r, c));
    const xfAt = (r, c) => { const x = cellAt(r, c); return wb.xfs[x ? x.s : colStyle[c] != null ? colStyle[c] : 0] || null; };
    const side = (r, c, sd) => {
      if (r < 1 || c < 1) return "";
      const x = xfAt(r, c); const b = x && wb.borders[x.border]; const e = b && b[sd];
      return e && BORDER_CSS[e.s] ? BORDER_CSS[e.s] + " #" + e.c : "";
    };
    const GRID = grid ? "1px solid #e1e4e8" : "none";
    const rank = (v) => (v ? parseInt(v, 10) * 10 + (/double/.test(v) ? 4 : /solid/.test(v) ? 3 : /dashed/.test(v) ? 2 : 1) : 0);
    const strong = (a, b) => (rank(b) > rank(a) ? b : a);
    const classes = new Map();
    const cls = (css) => { if (!css) return ""; let k = classes.get(css); if (!k) { k = "s" + classes.size; classes.set(css, k); } return k; };
    const visCount = (list, a, b) => list.filter(x => x >= a && x <= b).length;
    const empty = (r, c) => { if (covered.has(key(r, c)) || anchor.has(key(r, c))) return false; const x = cellAt(r, c); return !x || ((x.v == null || x.v === "") && !x.is); };
    const body = rows.map(r => {
      const tds = cols.map(c => {
        const k = key(r, c);
        if (covered.has(k)) return "";
        const g = anchor.get(k) || { r0: r, c0: c, r1: r, c1: c };
        const x = cellAt(r, c);
        const xf = xfAt(r, c) || { font: 0, fill: 0, h: "", v: "", wrap: false, ind: 0 };
        const val = x ? cellValue(x, wb) : { t: "", kind: "" };
        const font = wb.fonts[xf.font] || {};
        const st = [];
        if (font.b) st.push("font-weight:700");
        if (font.i) st.push("font-style:italic");
        if (font.u || font.s) st.push("text-decoration:" + [font.u ? "underline" : "", font.s ? "line-through" : ""].filter(Boolean).join(" "));
        if (font.sz && Math.abs(font.sz - 11) > 0.01) st.push("font-size:" + f2(font.sz) + "pt");
        const color = val.color || font.color;
        if (color && color.toUpperCase() !== "000000") st.push("color:#" + color);
        const fill = wb.fills[xf.fill];
        if (fill) st.push("background:#" + fill);
        const h = H_ALIGN[xf.h] || (val.kind === "n" ? "right" : val.kind === "b" || val.kind === "e" ? "center" : "");
        if (h && h !== "left") st.push("text-align:" + h);
        const va = V_ALIGN[xf.v] || "";
        if (va && va !== "bottom") st.push("vertical-align:" + va);
        if (xf.wrap) st.push("white-space:pre-wrap");
        if (xf.ind) st.push("padding-left:" + (3 + xf.ind * 9) + "px");
        /* 맞닿은 두 칸이 같은 변에 선을 두면 굵은 쪽 — 양쪽 칸이 같은 값을 갖게(표 테두리 겹침 규칙과 같게) */
        const L = strong(side(g.r0, g.c0, "l"), side(g.r0, g.c0 - 1, "r")), T = strong(side(g.r0, g.c0, "t"), side(g.r0 - 1, g.c0, "b"));
        const R = strong(side(g.r0, g.c1, "r") || (g.c1 !== g.c0 ? side(g.r0, g.c0, "r") : ""), side(g.r0, g.c1 + 1, "l"));
        const B = strong(side(g.r1, g.c0, "b") || (g.r1 !== g.r0 ? side(g.r0, g.c0, "b") : ""), side(g.r1 + 1, g.c0, "t"));
        st.push("border-left:" + (L || GRID), "border-top:" + (T || GRID), "border-right:" + (R || GRID), "border-bottom:" + (B || GRID));
        const cs = visCount(cols, g.c0, g.c1), rs = visCount(rows, g.r0, g.r1);
        const txt = xf.wrap ? val.t : String(val.t).replace(/\r?\n/g, " ");
        const ov = !xf.wrap && val.kind === "s" && txt && (!h || h === "left") && cs === 1 && empty(r, c + 1);
        const c2 = cls(st.join(";"));
        const tip = !xf.wrap && !ov && txt.length >= 6 ? ` title="${esc(txt)}"` : "";
        return `<td${c2 || ov ? ` class="${[c2, ov ? "ov" : ""].filter(Boolean).join(" ")}"` : ""}${cs > 1 ? ` colspan="${cs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""}${tip}>${esc(txt)}</td>`;
      }).join("");
      const ht = rowH[r] != null ? rowH[r] : defH;
      return `<tr style="height:${f2(ht)}pt"><th class="rh">${r}</th>${tds}</tr>`;
    }).join("");
    const px = (w) => Math.max(2, Math.round(w * 7 + 5));
    const colgroup = `<col style="width:40px">` + cols.map(c => `<col style="width:${px(colW[c] != null ? colW[c] : defW)}px">`).join("");
    const head = `<tr><th class="cn"></th>${cols.map(c => `<th>${colName(c)}</th>`).join("")}</tr>`;
    const total = 40 + cols.reduce((n, c) => n + px(colW[c] != null ? colW[c] : defW), 0);
    const css = Array.from(classes.entries()).map(([v, k]) => `.${k}{${v}}`).join("\n");
    const tbl = rows.length && cols.length
      ? `<table class="xl" style="width:${total}px"><colgroup>${colgroup}</colgroup><thead>${head}</thead><tbody>${body}</tbody></table>`
      : `<p class="pv-empty">빈 시트입니다.</p>`;
    return { doc: page(XL_CSS + css, tbl), notes };
  }
  const XL_CSS = `body{margin:0;background:#fff;color:#111;font:11pt/1.25 ${FONT}}
.xl{border-collapse:collapse;table-layout:fixed}
.xl td{padding:1px 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;word-break:keep-all;overflow-wrap:anywhere}
.xl td.ov{overflow:visible;position:relative;z-index:1}
.xl thead th{position:sticky;top:0;z-index:3;height:20px;background:#f3f4f6;color:#555;font:500 9pt/1 ${FONT};border:1px solid #d6d9de;text-align:center}
.xl th.rh{position:sticky;left:0;z-index:2;min-width:32px;background:#f3f4f6;color:#555;font:500 9pt/1 ${FONT};border:1px solid #d6d9de;text-align:center;padding:0 2px}
.xl thead th.cn{left:0;z-index:4}
.pv-empty{padding:24px;color:#666}`;
  async function xlsx(entries) {
    const wb = workbook(entries);
    const parts = wb.sheets.filter(s => !s.hidden).map(s => { try { const r = sheetHTML(wb, s); return { name: s.name, doc: r.doc, notes: r.notes }; } catch (e) { return { name: s.name, doc: page("", '<p class="pv-empty">이 시트를 읽지 못했습니다.</p>'), notes: [] }; } });
    if (!parts.length) throw new Error("xlsx");
    return { kind: "xlsx", parts };
  }

  /* ── CSV · 글 ── */
  function decodeText(u8) {
    const s = dec(u8);
    const bad = (s.match(/\ufffd/g) || []).length;
    if (bad > 3 && bad > s.length / 200) { try { return new TextDecoder("euc-kr").decode(u8); } catch (e) { /* 지원 안 함 */ } }
    return s.replace(/^\ufeff/, "");
  }
  function csvRows(text) {
    const first = text.split(/\r?\n/, 1)[0] || "";
    const cnt = (ch) => first.split(ch).length - 1;
    const sep = [",", "\t", ";"].sort((a, b) => cnt(b) - cnt(a))[0];
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
      if (ch === '"' && !cur) { q = true; continue; }
      if (ch === sep) { row.push(cur); cur = ""; continue; }
      if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; if (rows.length >= MAX_ROWS) break; continue; }
      cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function csv(u8) {
    const rows = csvRows(decodeText(u8));
    const n = Math.min(MAX_COLS, rows.reduce((m, r) => Math.max(m, r.length), 0));
    const notes = rows.length >= MAX_ROWS ? ["앞 " + MAX_ROWS.toLocaleString("en-US") + "행만 표시"] : [];
    const head = `<tr><th class="cn"></th>${Array.from({ length: n }, (x, i) => `<th>${colName(i + 1)}</th>`).join("")}</tr>`;
    const body = rows.map((r, i) => `<tr><th class="rh">${i + 1}</th>${Array.from({ length: n }, (x, j) => { const v = r[j] || ""; return `<td${/^-?[\d,]+(\.\d+)?%?$/.test(v.trim()) ? ' style="text-align:right"' : ""}>${esc(v)}</td>`; }).join("")}</tr>`).join("");
    const css = XL_CSS + "\n.xl td{border:1px solid #e1e4e8;min-width:60px;max-width:360px;height:20px}";
    return { kind: "csv", parts: [{ name: "", doc: page(css, n ? `<table class="xl"><thead>${head}</thead><tbody>${body}</tbody></table>` : '<p class="pv-empty">내용이 없습니다.</p>'), notes }] };
  }
  function text(u8) {
    let s = decodeText(u8);
    const notes = [];
    if (s.length > MAX_TEXT) { s = s.slice(0, MAX_TEXT); notes.push("앞부분만 표시"); }
    return { kind: "text", parts: [{ name: "", doc: page(`body{margin:0;background:#fff;color:#111;font:10.5pt/1.6 ${FONT}}pre{margin:0;padding:18px 22px;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;font:inherit}`, `<pre>${esc(s)}</pre>`), notes }] };
  }

  /* ── 문서 공통(종이) ── */
  const PAPER_CSS = `html{background:#e9ece9}body{margin:0;padding:14px 0;color:#111;font:10.5pt/1.55 ${FONT}}
.pg{box-sizing:border-box;background:#fff;margin:0 auto 14px;box-shadow:0 1px 4px rgba(0,0,0,.18);max-width:calc(100% - 16px)}
.pg p{margin:0;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}
.pg table{border-collapse:collapse;margin:4px 0}
.pg td{vertical-align:top;padding:2px 5px;word-break:keep-all;overflow-wrap:anywhere}
.tab{display:inline-block;width:2.5em}
.txbx{border:1px solid #999;padding:4px 6px;margin:4px 0}
.pic{display:inline-block;padding:1px 6px;margin:0 2px;border:1px dashed #aaa;border-radius:3px;color:#777;font-size:8.5pt}
@media (max-width:600px){body{padding:6px 0}.pg{padding:14px 12px!important}}`;
  const page = (css, bodyHtml) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${bodyHtml}</body></html>`;
  const tw2pt = (v) => num(v, 0) / 20;

  /* ── DOCX ── */
  const ROMAN = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  const GANADA = "가나다라마바사아자차카타파하".split(""), CHOSUNG = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ".split("");
  function counter(n, fmt) {
    const letters = (k, base) => { let s = ""; while (k > 0) { const m = (k - 1) % 26; s = String.fromCharCode(base + m) + s; k = Math.floor((k - 1) / 26); } return s; };
    switch (fmt) {
      case "upperLetter": return letters(n, 65);
      case "lowerLetter": return letters(n, 97);
      case "upperRoman": case "lowerRoman": { let s = "", k = n; ROMAN.forEach(([v, r]) => { while (k >= v) { s += r; k -= v; } }); return fmt === "lowerRoman" ? s.toLowerCase() : s; }
      case "ganada": case "koreanLegal": return GANADA[(n - 1) % GANADA.length];
      case "chosung": return CHOSUNG[(n - 1) % CHOSUNG.length];
      case "decimalEnclosedCircle": case "decimalEnclosedCircleChinese": return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
      case "decimalZero": return String(n).padStart(2, "0");
      case "none": return "";
      default: return String(n);
    }
  }
  const PUA = /[\uf000-\uf8ff]/;
  const PB = "\u0000PB\u0000";   // 쪽 나눔 표지
  function docx(entries) {
    const get = (n) => entries.find(e => e.name === n);
    const main = get("word/document.xml");
    if (!main) throw new Error("docx");
    const d = xml(main.data);
    const styles = {};
    let defSz = 10;
    const stx = get("word/styles.xml");
    if (stx) {
      const sd = xml(stx.data);
      const dr = byTag(sd, "rPrDefault")[0];
      if (dr) { const sz = byTag(dr, "sz")[0]; if (sz) defSz = num(at(sz, "w:val"), 20) / 2; }
      byTag(sd, "style").forEach(s => {
        const name = at(kid(s, "name"), "w:val") || "";
        styles[at(s, "w:styleId")] = { name, based: at(kid(s, "basedOn"), "w:val") || "", pPr: kid(s, "pPr"), rPr: kid(s, "rPr"), tblPr: kid(s, "tblPr"), type: at(s, "w:type") };
      });
    }
    const chain = (id) => { const out = []; for (let k = 0, s = styles[id]; s && k < 10; k++, s = styles[s.based]) out.push(s); return out; };
    const headLv = (id) => { for (const s of chain(id)) { const m = /^(?:heading|제목)\s*(\d)$/i.exec(s.name); if (m) return Number(m[1]); if (/^title$/i.test(s.name)) return 0; } return -1; };
    const nums = {};
    const nx = get("word/numbering.xml");
    if (nx) {
      const nd = xml(nx.data), abs = {};
      byTag(nd, "abstractNum").forEach(a => { abs[at(a, "w:abstractNumId")] = kids(a, "lvl").map(l => ({ fmt: at(kid(l, "numFmt"), "w:val") || "decimal", text: at(kid(l, "lvlText"), "w:val") || "", start: num(at(kid(l, "start"), "w:val"), 1) })); });
      byTag(nd, "num").forEach(n => { nums[at(n, "w:numId")] = abs[at(kid(n, "abstractNumId"), "w:val")] || []; });
    }
    const counters = {};
    let pics = 0;
    function listLabel(numPr) {
      const id = at(kid(numPr, "numId"), "w:val") || "", lv = Math.min(8, num(at(kid(numPr, "ilvl"), "w:val"), 0));
      const lvls = nums[id];
      if (!lvls || !lvls[lv] || id === "0") return "";
      const c = counters[id] = counters[id] || [];
      c[lv] = (c[lv] == null ? lvls[lv].start - 1 : c[lv]) + 1;
      for (let k = lv + 1; k < c.length; k++) c[k] = null;
      if (lvls[lv].fmt === "bullet") { const t = lvls[lv].text; return !t || PUA.test(t) || t.length > 2 ? "•" : t; }
      return lvls[lv].text.replace(/%(\d)/g, (m, k) => { const i = Number(k) - 1; return counter(c[i] != null ? c[i] : (lvls[i] ? lvls[i].start : 1), lvls[i] ? lvls[i].fmt : "decimal"); });
    }
    const valOf = (el, n) => at(kid(el, n), "w:val");
    function runCSS(rPr, base) {
      const st = Object.assign({}, base || {});
      if (!rPr) return st;
      const b = kid(rPr, "b"); if (b) st.b = onOff(b) && valOf(rPr, "b") !== "0";
      const i = kid(rPr, "i"); if (i) st.i = valOf(rPr, "i") !== "0" && valOf(rPr, "i") !== "false";
      const u = kid(rPr, "u"); if (u) st.u = (at(u, "w:val") || "single") !== "none";
      if (kid(rPr, "strike") || kid(rPr, "dstrike")) st.s = true;
      const sz = kid(rPr, "sz"); if (sz) st.sz = num(at(sz, "w:val"), 20) / 2;
      const c = hex6(valOf(rPr, "color")); if (c) st.color = c;
      const hl = valOf(rPr, "highlight"); if (hl && hl !== "none") st.hl = ({ yellow: "FFFF00", green: "00FF00", cyan: "00FFFF", magenta: "FF00FF", blue: "0000FF", red: "FF0000", lightGray: "D3D3D3", darkGray: "A9A9A9" })[hl] || "";
      const shd = kid(rPr, "shd"); if (shd && hex6(at(shd, "w:fill"))) st.hl = hex6(at(shd, "w:fill"));
      const va = valOf(rPr, "vertAlign"); if (va) st.va = va;
      return st;
    }
    const styleRun = (id) => { const arr = chain(id).reverse(); let st = {}; arr.forEach(s => { st = runCSS(s.rPr, st); }); return st; };
    const cssOf = (st) => [st.b ? "font-weight:700" : "", st.i ? "font-style:italic" : "", st.u || st.s ? "text-decoration:" + [st.u ? "underline" : "", st.s ? "line-through" : ""].filter(Boolean).join(" ") : "",
      st.sz && Math.abs(st.sz - defSz) > 0.01 ? "font-size:" + f2(st.sz) + "pt" : "", st.color && st.color !== "000000" ? "color:#" + st.color : "", st.hl ? "background:#" + st.hl : "",
      st.va === "superscript" ? "vertical-align:super;font-size:.75em" : st.va === "subscript" ? "vertical-align:sub;font-size:.75em" : ""].filter(Boolean).join(";");
    function inline(el, base, out) {
      kids(el).forEach(k => {
        const n = ln(k);
        if (n === "r") {
          const st = runCSS(kid(k, "rPr"), Object.assign({}, base, valOf(kid(k, "rPr"), "rStyle") ? styleRun(valOf(kid(k, "rPr"), "rStyle")) : {}));
          const css = cssOf(st);
          let h = "";
          const flush = () => { if (h) out.html += css ? `<span style="${css}">${h}</span>` : h; h = ""; };
          kids(k).forEach(x => {
            const m = ln(x);
            if (m === "t") h += esc(x.textContent);
            else if (m === "tab" || m === "ptab") h += '<span class="tab"></span>';
            else if (m === "br" || m === "cr") { if (at(x, "w:type") === "page") { flush(); out.parts.push(out.html); out.html = ""; } else h += "<br>"; }
            else if (m === "noBreakHyphen") h += "-";
            else if (m === "drawing" || m === "pict" || m === "object") {
              const tx = byTag(x, "txbxContent");
              if (tx.length) tx.forEach(t => { out.boxes.push('<div class="txbx">' + blocks(t) + "</div>"); });
              else { pics++; h += '<span class="pic">그림</span>'; }
            }
          });
          flush();
        } else if (n === "hyperlink" || n === "smartTag" || n === "ins" || n === "fldSimple" || n === "customXml" || n === "bdo" || n === "dir") inline(k, base, out);
        else if (n === "sdt") { const c = kid(k, "sdtContent"); if (c) inline(c, base, out); }
      });
    }
    const JC = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
    function para(p) {
      const pPr = kid(p, "pPr");
      const sid = valOf(pPr, "pStyle") || "";
      const lv = headLv(sid);
      const base = styleRun(sid);
      if (lv >= 0 && base.sz == null) base.sz = lv === 0 ? 20 : Math.max(11, 16 - lv * 1.5);
      if (lv >= 0 && base.b == null) base.b = true;
      const out = { html: "", parts: [], boxes: [] };
      inline(p, base, out);
      const st = [];
      let jc = valOf(pPr, "jc");
      if (!jc) for (const s of chain(sid)) { const j = valOf(s.pPr, "jc"); if (j) { jc = j; break; } }
      if (JC[jc] && JC[jc] !== "left") st.push("text-align:" + JC[jc]);
      const ind = kid(pPr, "ind");
      if (ind) {
        const l = tw2pt(at(ind, "w:left") || at(ind, "w:start")), r = tw2pt(at(ind, "w:right") || at(ind, "w:end"));
        const fl = tw2pt(at(ind, "w:firstLine")), hg = tw2pt(at(ind, "w:hanging"));
        if (l) st.push("margin-left:" + f2(l) + "pt");
        if (r) st.push("margin-right:" + f2(r) + "pt");
        if (fl || hg) st.push("text-indent:" + f2(fl - hg) + "pt");
      }
      const sp = kid(pPr, "spacing");
      if (sp) {
        const b4 = tw2pt(at(sp, "w:before")), af = tw2pt(at(sp, "w:after")), line = num(at(sp, "w:line"), 0), rule = at(sp, "w:lineRule") || "auto";
        if (b4) st.push("margin-top:" + f2(b4) + "pt");
        if (af) st.push("margin-bottom:" + f2(af) + "pt");
        if (line) st.push("line-height:" + (rule === "auto" ? f2(Math.max(0.8, line / 240) * 1.2) : f2(line / 20) + "pt"));
      }
      const shd = kid(pPr, "shd"); if (shd && hex6(at(shd, "w:fill"))) st.push("background:#" + hex6(at(shd, "w:fill")));
      let np = kid(pPr, "numPr");
      if (!np) for (const x of chain(sid)) { const n2 = kid(x.pPr, "numPr"); if (n2) { np = n2; break; } }
      const label = np ? listLabel(np) : "";
      if (lv >= 0 && !st.some(x => /^margin-top/.test(x))) st.push("margin-top:6pt");
      const pb = !!kid(pPr, "pageBreakBefore") && onOff(kid(pPr, "pageBreakBefore"));
      const pcss = st.join(";");
      const one = (h, first) => `<p${pcss ? ` style="${pcss}"` : ""}>${first && label ? `<span class="li">${esc(label)} </span>` : ""}${h || "&#8203;"}</p>`;
      /* 나눔 앞 글이 비었으면 빈 문단을 만들지 않는다 */
      let html = pb ? PB : "", first = true;
      out.parts.forEach(h => { if (h) { html += one(h, first); first = false; } html += PB; });
      if (out.html || !out.parts.length) html += one(out.html, first);
      return html + out.boxes.join("");
    }
    const BORDER = (e) => {
      if (!e) return "";
      const v = at(e, "w:val");
      if (!v || v === "none" || v === "nil") return "none";
      const w = Math.max(0.5, num(at(e, "w:sz"), 4) / 8);
      const c = hex6(at(e, "w:color")) || "000000";
      return f2(w) + "pt " + (v === "double" ? "double" : /dash/i.test(v) ? "dashed" : /dot/i.test(v) ? "dotted" : "solid") + " #" + c;
    };
    function table(t) {
      const tblPr = kid(t, "tblPr");
      let tb = kid(tblPr, "tblBorders");
      if (!tb) { const sid = valOf(tblPr, "tblStyle"); for (const s of chain(sid)) { const b = kid(s.tblPr, "tblBorders"); if (b) { tb = b; break; } } }
      const tbB = (n) => (tb ? BORDER(kid(tb, n)) : "");
      const grid = kids(kid(t, "tblGrid"), "gridCol").map(g => tw2pt(at(g, "w:w")));
      const rows = kids(t, "tr").map(tr => {
        const trPr = kid(tr, "trPr");
        let g = num(valOf(trPr, "gridBefore"), 0);
        const cells = kids(tr, "tc").concat(kids(tr, "sdt").reduce((a, s) => a.concat(kids(kid(s, "sdtContent"), "tc")), [])).map(tc => {
          const tcPr = kid(tc, "tcPr");
          const span = Math.max(1, num(valOf(tcPr, "gridSpan"), 1));
          const vm = kid(tcPr, "vMerge");
          const c = { tc, tcPr, g, span, vm: vm ? (at(vm, "w:val") === "restart" ? "start" : "cont") : "" };
          g += span;
          return c;
        });
        const h = kid(trPr, "trHeight");
        return { cells, h: h ? tw2pt(at(h, "w:val")) : 0 };
      });
      rows.forEach((r, ri) => r.cells.forEach(c => {
        if (c.vm !== "start") return;
        let n = 1;
        for (let k = ri + 1; k < rows.length; k++) { const x = rows[k].cells.find(y => y.g === c.g); if (x && x.vm === "cont") n++; else break; }
        c.rs = n;
      }));
      const nR = rows.length;
      const body = rows.map((r, ri) => `<tr${r.h ? ` style="height:${f2(r.h)}pt"` : ""}>${r.cells.map((c, ci) => {
        if (c.vm === "cont") return "";
        const st = [];
        /* 칸 테두리: 칸 지정(tcBorders) → 표 지정(바깥 · 안쪽 선) · 표 스타일 */
        const cb = kid(c.tcPr, "tcBorders");
        const own = (n, alt) => { const e = cb ? kid(cb, n) || (alt ? kid(cb, alt) : null) : null; return e ? BORDER(e) : ""; };
        const lastRow = ri + (c.rs || 1) >= nR, lastCol = c.g + c.span >= Math.max(grid.length, 1) || ci === r.cells.length - 1;
        const bl = own("left", "start") || (c.g === 0 ? tbB("left") || tbB("start") : tbB("insideV"));
        const br = own("right", "end") || (lastCol ? tbB("right") || tbB("end") : tbB("insideV"));
        const bt = own("top") || (ri === 0 ? tbB("top") : tbB("insideH"));
        const bb = own("bottom") || (lastRow ? tbB("bottom") : tbB("insideH"));
        [["left", bl], ["right", br], ["top", bt], ["bottom", bb]].forEach(([k, v]) => { if (v) st.push("border-" + k + ":" + v); });
        const shd = kid(c.tcPr, "shd"); if (shd && hex6(at(shd, "w:fill"))) st.push("background:#" + hex6(at(shd, "w:fill")));
        const va = valOf(c.tcPr, "vAlign"); if (va === "center") st.push("vertical-align:middle"); else if (va === "bottom") st.push("vertical-align:bottom");
        return `<td${c.span > 1 ? ` colspan="${c.span}"` : ""}${c.rs > 1 ? ` rowspan="${c.rs}"` : ""}${st.length ? ` style="${st.join(";")}"` : ""}>${blocks(c.tc).split(PB).join("")}</td>`;
      }).join("")}</tr>`).join("");
      const jc = valOf(tblPr, "jc");
      const total = grid.reduce((n, w) => n + w, 0);
      return `<table style="${total ? "width:" + f2(total) + "pt;" : ""}${jc === "center" ? "margin-left:auto;margin-right:auto;" : ""}">${grid.length ? `<colgroup>${grid.map(w => `<col style="width:${f2(w)}pt">`).join("")}</colgroup>` : ""}<tbody>${body}</tbody></table>`;
    }
    function blocks(el) {
      return kids(el).map(k => {
        const n = ln(k);
        if (n === "p") return para(k);
        if (n === "tbl") return table(k);
        if (n === "sdt") { const c = kid(k, "sdtContent"); return c ? blocks(c) : ""; }
        if (n === "customXml") return blocks(k);
        return "";
      }).join("");
    }
    const bodyEl = byTag(d, "body")[0];
    const sect = bodyEl ? kids(bodyEl, "sectPr").pop() || byTag(bodyEl, "sectPr").pop() : null;
    const pg = kid(sect, "pgSz"), mar = kid(sect, "pgMar");
    const wpt = tw2pt(at(pg, "w:w")) || 595.3;
    const m = (k, dflt) => (mar ? tw2pt(at(mar, "w:" + k)) : dflt);
    const pad = [m("top", 72), m("right", 72), m("bottom", 72), m("left", 72)].map(v => f2(Math.max(18, Math.min(v, 110))) + "pt").join(" ");
    const html = bodyEl ? blocks(bodyEl) : "";
    const pages = html.split(PB).map(h => `<div class="pg" style="width:${f2(wpt)}pt;padding:${pad};font-size:${f2(defSz)}pt">${h || "<p>&#8203;</p>"}</div>`).join("");
    const notes = pics ? ["그림은 표시하지 않음"] : [];
    return { kind: "docx", parts: [{ name: "", doc: page(PAPER_CSS + "\n.li{white-space:nowrap}", pages), notes }] };
  }

  /* ── HWPX — hwpx.js 의 A4 그리기를 구역(section)마다 ── */
  function hwpx(entries) {
    const H = window.SemisHwpx;
    if (!H || !H.html) throw new Error("hwpx");
    const head = entries.find(e => e.name === "Contents/header.xml");
    const secs = entries.filter(e => /^Contents\/section\d+\.xml$/.test(e.name)).sort((a, b) => numOf(a.name) - numOf(b.name));
    if (!head || !secs.length) throw new Error("hwpx");
    const pkg = { entries, head: H.parseXML(head.data), sec: H.parseXML(secs[0].data) };
    const css = H.css(pkg, { screen: true });
    let body = "", pics = 0;
    secs.forEach(s => { pkg.sec = H.parseXML(s.data); pics += byTag(pkg.sec, "pic").length; body += H.html(pkg); });
    const notes = pics ? ["그림은 표시하지 않음"] : [];
    return { kind: "hwpx", parts: [{ name: "", doc: page(css + `\n@media (max-width:600px){.hx-doc{width:auto!important;padding:12px!important;min-height:0!important}}`, body), notes }] };
  }

  /* ── PPTX — 슬라이드마다 글 · 표를 위에서 아래 순서로(배치 · 그림은 원본과 다름) ── */
  function pptx(entries) {
    const get = (n) => entries.find(e => e.name === n);
    const pres = get("ppt/presentation.xml"), rels = get("ppt/_rels/presentation.xml.rels");
    let order = [];
    if (pres && rels) {
      const rmap = {};
      byTag(xml(rels.data), "Relationship").forEach(r => { rmap[at(r, "Id")] = at(r, "Target") || ""; });
      order = byTag(xml(pres.data), "sldId").map(s => { const t = rmap[rid(s)] || ""; return t ? "ppt/" + t.replace(/^\/?ppt\//, "").replace(/^\.\//, "") : ""; }).filter(p => p && get(p));
    }
    if (!order.length) order = entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => numOf(a.name) - numOf(b.name)).map(e => e.name);
    if (!order.length) throw new Error("pptx");
    let pics = 0;
    const ALG = { ctr: "center", r: "right", just: "justify", dist: "justify" };
    function paras(txBody, title) {
      return kids(txBody, "p").map(p => {
        const pPr = kid(p, "pPr");
        const lvl = num(at(pPr, "lvl"), 0);
        const bu = kid(pPr, "buChar"), none = kid(pPr, "buNone");
        let h = "";
        kids(p).forEach(r => {
          const n = ln(r);
          if (n === "r" || n === "fld") {
            const rp = kid(r, "rPr"), t = kid(r, "t");
            const st = [];
            if (rp && /^(1|true)$/.test(at(rp, "b") || "")) st.push("font-weight:700");
            if (rp && /^(1|true)$/.test(at(rp, "i") || "")) st.push("font-style:italic");
            if (rp && at(rp, "u") && at(rp, "u") !== "none") st.push("text-decoration:underline");
            const clr = rp ? byTag(kid(rp, "solidFill"), "srgbClr")[0] : null;
            const c = clr ? hex6(at(clr, "val")) : "";
            if (c && !/^(FFFFFF|000000)$/i.test(c)) st.push("color:#" + c);
            const tx = t ? esc(t.textContent) : "";
            if (tx) h += st.length ? `<span style="${st.join(";")}">${tx}</span>` : tx;
          } else if (n === "br") h += "<br>";
        });
        if (!h) return "";
        const al = ALG[at(pPr, "algn")] || "";
        const bullet = !title && !none && (bu || lvl > 0) ? `<span class="bu">${bu && at(bu, "char") && !PUA.test(at(bu, "char")) ? esc(at(bu, "char")) : "•"}</span>` : "";
        return `<p style="${lvl ? "margin-left:" + lvl * 18 + "pt;" : ""}${al ? "text-align:" + al : ""}">${bullet}${h}</p>`;
      }).join("");
    }
    function shapes(tree) {
      const items = [];
      kids(tree).forEach(s => {
        const n = ln(s);
        const off = byTag(s, "off")[0];
        const pos = { y: num(at(off, "y"), 0), x: num(at(off, "x"), 0) };
        if (n === "sp") {
          const ph = byTag(kid(s, "nvSpPr"), "ph")[0];
          const title = !!ph && /title/i.test(at(ph, "type") || "");
          const tb = kid(s, "txBody");
          const h = tb ? paras(tb, title) : "";
          if (h) items.push(Object.assign({ h: title ? `<h2>${h.replace(/<\/?p[^>]*>/g, " ").trim()}</h2>` : `<div class="sp">${h}</div>`, title }, pos));
        } else if (n === "graphicFrame") {
          const tbl = byTag(s, "tbl")[0];
          if (tbl) {
            const rows = kids(tbl, "tr").map(tr => `<tr>${kids(tr, "tc").map(tc => {
              if (/^(1|true)$/.test(at(tc, "hMerge") || "") || /^(1|true)$/.test(at(tc, "vMerge") || "")) return "";
              const gs = num(at(tc, "gridSpan"), 1), rs = num(at(tc, "rowSpan"), 1);
              return `<td${gs > 1 ? ` colspan="${gs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""}>${paras(kid(tc, "txBody"), true)}</td>`;
            }).join("")}</tr>`).join("");
            items.push(Object.assign({ h: `<table class="pt">${rows}</table>` }, pos));
          } else pics++;
        } else if (n === "grpSp") items.push(...shapes(s));
        else if (n === "pic") pics++;
      });
      return items;
    }
    const slides = order.map((p, i) => {
      const sd = xml(get(p).data);
      const tree = byTag(sd, "spTree")[0];
      const items = tree ? shapes(tree).sort((a, b) => (b.title ? 1 : 0) - (a.title ? 1 : 0) || a.y - b.y || a.x - b.x) : [];
      return `<section class="sl"><div class="sn">슬라이드 ${i + 1}</div>${items.map(x => x.h).join("") || '<p class="emp">글 없음</p>'}</section>`;
    }).join("");
    const css = `html{background:#e9ece9}body{margin:0;padding:14px 10px;color:#111;font:12pt/1.5 ${FONT}}
.sl{box-sizing:border-box;max-width:960px;min-height:240px;margin:0 auto 14px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.18);padding:22px 32px 26px;position:relative}
.sn{position:absolute;top:8px;right:12px;font-size:8.5pt;color:#888}
.sl h2{margin:0 0 10px;font-size:18pt;line-height:1.3}
.sl p{margin:2px 0;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}
.sp+.sp{margin-top:8px}
.bu{display:inline-block;width:1.1em;color:#555}
.pt{border-collapse:collapse;margin:8px 0;font-size:10.5pt}.pt td{border:1px solid #999;padding:3px 6px;vertical-align:top}
.emp{color:#999}`;
    const notes = pics ? ["그림 · 도형은 표시하지 않음 · 배치는 원본과 다름"] : ["배치는 원본과 다름"];
    return { kind: "pptx", parts: [{ name: "", doc: page(css, slides), notes }] };
  }

  /* 바이트 → { kind, parts[{ name, doc, notes[] }] } */
  async function build(name, u8) {
    const k = kindOf(name);
    if (!k) throw new Error("kind");
    if (u8.length > MAX_BYTES) throw Object.assign(new Error("big"), { big: true });
    if (k === "csv") return csv(u8);
    if (k === "text") return text(u8);
    if (!window.SemisHwpx || !SemisHwpx.unzip) throw new Error("unzip");
    const entries = await SemisHwpx.unzip(u8);
    if (k === "xlsx") return xlsx(entries);
    if (k === "docx") return docx(entries);
    if (k === "hwpx") return hwpx(entries);
    return pptx(entries);
  }
  async function fromUrl(url, name) {
    let u = url;
    try { if (window.SemisFileAuth) u = await SemisFileAuth.resolve(url); } catch (e) { /* 원래 주소로 시도 */ }
    const res = await fetch(u);
    if (!res.ok) throw new Error("fetch " + res.status);
    const len = Number(res.headers && res.headers.get ? res.headers.get("content-length") : 0) || 0;
    if (len > MAX_BYTES) throw Object.assign(new Error("big"), { big: true });
    return build(name || url, new Uint8Array(await res.arrayBuffer()));
  }

  window.SemisPreview = { kindOf, build, fromUrl, format, general, MAX_BYTES, MAX_ROWS, colName, csvRows };
})();
