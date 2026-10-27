/* 문서 글 뽑기 — 접수 카운터 · 아르고 첨부 판독용.
   DOCX · HWPX · PPTX 는 압축을 풀어 문단 · 표(칸은 " | ")를, XLSX 는 시트별 행(칸은 탭, 날짜 서식은 YYYY-MM-DD)을, TXT · CSV 는 그대로 글로 보낸다.
   한글 5.0(HWP) · 엑셀 97-2003(XLS)은 첨부 미리보기 엔진(SemisPreview)이 그린 문서에서 글을 뽑는다(암호 · 배포용 문서는 못 읽음).
   PDF · 이미지는 원본을 보낸다(이미지는 긴 변 2400px JPEG 로 줄임). 옛 워드 · 파워포인트(DOC · PPT)는 읽지 못한다 */
"use strict";

(() => {
  const MAX = 60000, XLSX_ROWS = 400;
  const IMG_SIDE = 2400, IMG_Q = 0.86, IMG_KEEP = 3.5 * 1024 * 1024;
  const KIND = {
    pdf: "pdf", jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", heic: "image", heif: "image",
    docx: "docx", hwpx: "hwpx", xlsx: "xlsx", xlsm: "xlsx", pptx: "pptx", txt: "text", csv: "text", md: "text",
    hwp: "hwp", xls: "xls", doc: "legacy", ppt: "legacy"
  };
  const extOf = (name) => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || "")); return m ? m[1].toLowerCase() : ""; };
  const kindOf = (name) => KIND[extOf(name)] || "other";
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const dec = (u8) => new TextDecoder("utf-8").decode(u8);
  const parse = (u8) => new DOMParser().parseFromString(typeof u8 === "string" ? u8 : dec(u8), "application/xml");
  const lname = (el) => el.localName || String(el.nodeName).replace(/^.*:/, "");
  const kids = (el) => Array.from(el.childNodes).filter(n => n.nodeType === 1);
  const byTag = (el, n) => Array.from(el.getElementsByTagNameNS("*", n));
  const clip = (s) => (s.length > MAX ? s.slice(0, MAX) + "\n…(이하 생략)" : s);

  /* 문단 글 — 안에 든 표는 따로 줄을 만든다 */
  function paraText(el) {
    let s = "";
    kids(el).forEach(k => {
      const n = lname(k);
      if (n === "tbl") return;
      if (n === "t") s += k.textContent;
      else if (n === "tab" || n === "br" || n === "lineBreak") s += " ";
      else s += paraText(k);
    });
    return s;
  }
  function innerTables(el, out) {
    kids(el).forEach(k => { if (lname(k) === "tbl") out.push(k); else innerTables(k, out); });
    return out;
  }
  function tableRows(tbl) {
    const rows = [];
    kids(tbl).forEach(tr => {
      if (lname(tr) !== "tr") return;
      const cells = kids(tr).filter(c => lname(c) === "tc").map(tc => { const o = []; walk(tc, o); return norm(o.join(" ")); });
      const line = cells.join(" | ");
      if (line.replace(/[|\s]/g, "")) rows.push(line);
    });
    return rows;
  }
  function walk(el, out) {
    kids(el).forEach(k => {
      const n = lname(k);
      if (n === "tbl") { tableRows(k).forEach(r => out.push(r)); return; }
      if (n === "p") {
        const s = norm(paraText(k));
        if (s) out.push(s);
        innerTables(k, []).forEach(tb => tableRows(tb).forEach(r => out.push(r)));
        return;
      }
      walk(k, out);
    });
    return out;
  }
  const numOf = (name) => Number((/(\d+)\.xml$/.exec(name) || [0, 0])[1]);
  /* DOCX(word/document.xml) · HWPX(Contents/section*.xml) · PPTX(ppt/slides/slide*.xml) */
  function xmlText(entries, re, label) {
    const parts = entries.filter(e => re.test(e.name)).sort((a, b) => numOf(a.name) - numOf(b.name));
    return parts.map((e, i) => {
      const lines = walk(parse(e.data), []);
      return (label ? `[${label} ${i + 1}]\n` : "") + lines.join("\n");
    }).join("\n\n");
  }

  /* XLSX — 공유 문자열 · 날짜 서식 · 시트 순서(workbook rels) */
  const XL_DATE_IDS = [14, 15, 16, 17, 22];
  const p2 = (n) => String(n).padStart(2, "0");
  function serialDate(v) {
    const n = Number(v);
    if (!isFinite(n) || n < 1 || n > 2958465) return String(v);
    const t = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    const d = t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate());
    const hm = t.getUTCHours() * 60 + t.getUTCMinutes();
    return hm ? d + " " + p2(t.getUTCHours()) + ":" + p2(t.getUTCMinutes()) : d;
  }
  function numText(v) {
    const n = Number(v);
    if (!isFinite(n)) return String(v);
    return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(Math.round(n * 1e6) / 1e6);
  }
  function xlsxText(entries) {
    const get = (n) => entries.find(e => e.name === n);
    const ss = get("xl/sharedStrings.xml");
    const strs = ss ? byTag(parse(ss.data), "si").map(si => byTag(si, "t").filter(t => lname(t.parentNode) !== "rPh").map(t => t.textContent).join("")) : [];
    const dateXf = new Set();
    const st = get("xl/styles.xml");
    if (st) {
      const d = parse(st.data), custom = {};
      byTag(d, "numFmt").forEach(n => { custom[n.getAttribute("numFmtId")] = n.getAttribute("formatCode") || ""; });
      const xfs = byTag(d, "cellXfs")[0];
      if (xfs) kids(xfs).forEach((xf, i) => {
        const id = Number(xf.getAttribute("numFmtId"));
        const code = String(custom[id] || "").replace(/\[[^\]]*\]|"[^"]*"/g, "");
        if (XL_DATE_IDS.indexOf(id) >= 0 || /[yd]/i.test(code)) dateXf.add(i);
      });
    }
    let sheets = [];
    const wb = get("xl/workbook.xml"), rels = get("xl/_rels/workbook.xml.rels");
    if (wb && rels) {
      const rmap = {};
      byTag(parse(rels.data), "Relationship").forEach(r => { rmap[r.getAttribute("Id")] = r.getAttribute("Target") || ""; });
      sheets = byTag(parse(wb.data), "sheet").map(s => {
        const id = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        const tg = String(rmap[id] || "").replace(/^\/?(xl\/)?/, "");
        return { name: s.getAttribute("name") || "", path: tg ? "xl/" + tg : "" };
      }).filter(s => s.path);
    }
    if (!sheets.length) sheets = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => numOf(a.name) - numOf(b.name)).map((e, i) => ({ name: "Sheet" + (i + 1), path: e.name }));
    const out = [];
    sheets.forEach(sh => {
      const e = get(sh.path);
      if (!e) return;
      out.push("[시트] " + sh.name);
      byTag(parse(e.data), "row").slice(0, XLSX_ROWS).forEach(r => {
        const cells = byTag(r, "c").map(c => {
          const t = c.getAttribute("t"), v = byTag(c, "v")[0], val = v ? v.textContent : "";
          if (t === "s") return val === "" ? "" : strs[Number(val)] || "";
          if (t === "inlineStr") return byTag(c, "t").map(x => x.textContent).join("");
          if (t === "b") return val === "1" ? "TRUE" : val === "0" ? "FALSE" : "";
          if (t === "str" || t === "e") return val;
          if (val === "") return "";
          return dateXf.has(Number(c.getAttribute("s"))) ? serialDate(val) : numText(val);
        });
        const line = cells.map(norm).join("\t").replace(/\t+$/, "");
        if (line.trim()) out.push(line);
      });
    });
    return out.join("\n");
  }

  function decodeText(u8) {
    const s = dec(u8);
    const bad = (s.match(/�/g) || []).length;
    if (bad > 3 && bad > s.length / 200) {
      try { return new TextDecoder("euc-kr").decode(u8); } catch (e) { /* 지원 안 함 */ }
    }
    return s.replace(/^﻿/, "");
  }
  /* 미리보기 엔진이 그린 문서(HTML) → 글. 표는 행마다 칸을 " | " 로, 문단은 한 줄씩 */
  function htmlText(html) {
    const d = new DOMParser().parseFromString(String(html || ""), "text/html");
    Array.from(d.querySelectorAll("br")).forEach(b => b.replaceWith(" "));
    const out = [];
    const walkH = (el) => {
      Array.from(el.children).forEach(k => {
        const n = k.tagName;
        if (n === "STYLE" || n === "SCRIPT" || n === "THEAD") return;
        if (n === "TABLE") {
          Array.from(k.querySelectorAll("tr")).forEach(tr => {
            if (tr.closest("table") !== k || tr.parentNode.tagName === "THEAD") return;
            const line = Array.from(tr.children).filter(c => c.tagName === "TD").map(c => norm(c.textContent)).join(" | ");
            if (line.replace(/[|\s]/g, "")) out.push(line);
          });
          return;
        }
        if (n === "P" || n === "LI" || /^H\d$/.test(n)) { const t = norm(k.textContent); if (t) out.push(t); return; }
        walkH(k);
      });
    };
    if (d.body) walkH(d.body);
    return out.join("\n");
  }
  /* 한글 5.0 · 엑셀 97-2003 — 미리보기 엔진으로 그린 뒤 글만. 실패하면 code(pw · enc · dist · legacy …)를 던진다 */
  async function previewText(name, u8) {
    const P = window.SemisPreview;
    if (!P || typeof P.build !== "function") throw Object.assign(new Error("preview"), { code: "preview" });
    const r = await P.build(name, u8);
    const parts = (r && r.parts) || [];
    return parts.map(pt => (parts.length > 1 && pt.name ? "[시트] " + pt.name + "\n" : "") + htmlText(pt.doc)).filter(x => x.trim()).join("\n\n");
  }

  /* 압축 문서 · 글 파일 → 글 */
  async function textOf(name, u8) {
    const k = kindOf(name);
    if (k === "text") return clip(decodeText(u8));
    if (k === "hwp" || k === "xls") return clip(await previewText(name, u8));
    if (["docx", "hwpx", "xlsx", "pptx"].indexOf(k) < 0) return "";
    if (!window.SemisHwpx || !SemisHwpx.unzip) throw new Error("unzip");
    const entries = await SemisHwpx.unzip(u8);
    let s = "";
    if (k === "docx") s = xmlText(entries, /^word\/document\.xml$/);
    else if (k === "hwpx") s = xmlText(entries, /^Contents\/section\d+\.xml$/);
    else if (k === "pptx") s = xmlText(entries, /^ppt\/slides\/slide\d+\.xml$/, "슬라이드");
    else s = xlsxText(entries);
    return clip(s);
  }

  async function bytesOf(file) {
    if (file && typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(new Uint8Array(fr.result));
      fr.onerror = () => rej(fr.error || new Error("read"));
      fr.readAsArrayBuffer(file);
    });
  }
  /* 사진 · 스캔 — 긴 변 2400px JPEG(작은 JPEG · PNG 는 그대로). 줄이지 못하면 원본 */
  async function prep(file) {
    const nm = String(file.name || "image");
    const ext = extOf(nm);
    if (!/^(jpe?g|png|webp|heic|heif)$/.test(ext) || typeof createImageBitmap !== "function") return file;
    const plain = /^(jpe?g|png|webp)$/.test(ext);
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) { return file; }
    try {
      const s = Math.min(1, IMG_SIDE / Math.max(bmp.width, bmp.height));
      if (plain && s === 1 && file.size <= IMG_KEEP) return file;
      const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const cx = cv.getContext && cv.getContext("2d");
      if (!cx) return file;
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h);
      cx.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((res) => { try { cv.toBlob(res, "image/jpeg", IMG_Q); } catch (e) { res(null); } });
      if (!blob || !blob.size || (plain && s === 1 && blob.size >= file.size)) return file;
      const name = (nm.replace(/\.[^.]+$/, "") || "image") + ".jpg";
      try { return new File([blob], name, { type: "image/jpeg" }); } catch (e) { blob.name = name; return blob; }
    } catch (e) {
      return file;
    } finally {
      try { bmp.close(); } catch (e) { /* 없음 */ }
    }
  }

  /* { kind, mode(file: 원본 판독 | text: 글 판독 | none: 판독 불가), file(올릴 파일), text } */
  async function extract(file) {
    const kind = kindOf(file && file.name);
    if (kind === "pdf") return { kind, mode: "file", file, text: "" };
    if (kind === "image") {
      const f2 = await prep(file);
      return { kind, mode: /\.(jpe?g|png|webp|gif)$/i.test(String(f2.name || "")) ? "file" : "none", file: f2, text: "" };
    }
    if (kind === "legacy" || kind === "other") return { kind, mode: "none", file, text: "", why: kind };
    let text = "", why = "";
    try { text = await textOf(file.name, await bytesOf(file)); } catch (e) { text = ""; why = String((e && e.code) || ""); }
    return { kind, mode: text.trim() ? "text" : "none", file, text, why };
  }
  /* 읽지 못한 까닭 — 접수 카운터 · 아르고 안내 문구(무엇을 하면 되는지 단계로) */
  const SAVE_PDF = "한글 · 워드 · 엑셀에서 [파일] → [다른 이름으로 저장] → 파일 형식 'PDF'로 저장해 다시 올리면 자동으로 정리됩니다.";
  function whyText(x) {
    const k = x && x.kind, w = x && x.why;
    if (w === "pw" || w === "hwppw" || w === "enc") return "문서에 암호가 걸려 있어 내용을 읽지 못했습니다. 암호를 푼 뒤 저장하거나, " + SAVE_PDF;
    if (w === "dist") return "배포용 한글 문서라 내용을 읽지 못했습니다. " + SAVE_PDF;
    if (k === "legacy" || w === "legacy") return "옛 형식(.doc · .ppt · 한글 97 이전)이라 내용을 읽지 못했습니다. " + SAVE_PDF;
    if (k === "image") return "이 사진 형식은 읽지 못합니다. JPG · PNG 로 저장해 다시 올려 주세요.";
    if (k === "other") return "읽을 수 없는 파일 형식입니다. PDF · 사진 · 한글 · 워드 · 엑셀 · 파워포인트 파일을 올려 주세요.";
    return "내용을 읽지 못했습니다. " + SAVE_PDF;
  }

  window.SemisDocRead = { kindOf, extOf, extract, textOf, xlsxText, xmlText, htmlText, serialDate, prep, whyText, SAVE_PDF, MAX };
})();
