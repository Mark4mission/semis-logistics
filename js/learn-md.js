/* 교육 전파 요약 글 → 안전한 HTML(관리 화면 미리보기 · 학습 화면 · 기록부 인쇄 공통).
   쓸 수 있는 것: "## 소제목", "### 작은 제목", "- 목록", "1. 번호 목록", 빈 줄 = 문단, **굵게**,
   표("| 칸 | 칸 |" 줄 — 둘째 줄이 "|---|---|" 면 첫 줄이 머리), 흐름("[접수] -> [확인] -> [보고]" 한 줄). 글자는 모두 이스케이프한다 */
"use strict";

(function (root) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inline = (s) => esc(s).replace(/\*\*([^*\n]{1,200})\*\*/g, "<strong>$1</strong>");
  function html(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let list = "", para = [], tbl = [];
    const cells = (ln) => ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
    const flushTbl = () => {
      if (!tbl.length) return;
      const sep = (r) => r.every(c => /^:?-{2,}:?$/.test(c));
      const head = tbl.length > 1 && sep(tbl[1]) ? tbl[0] : null;
      const rows = tbl.filter((r, i) => !sep(r) && !(head && i === 0)).slice(0, 30);
      const n = Math.min(6, Math.max.apply(null, tbl.map(r => r.length)));
      const tr = (r, t) => "<tr>" + Array.from({ length: n }, (_, i) => "<" + t + ">" + inline(r[i] || "") + "</" + t + ">").join("") + "</tr>";
      out.push("<table>" + (head ? "<thead>" + tr(head, "th") + "</thead>" : "") + "<tbody>" + rows.map(r => tr(r, "td")).join("") + "</tbody></table>");
      tbl = [];
    };
    const flushPara = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
    const closeList = () => { if (list) { out.push("</" + list + ">"); list = ""; } };
    lines.forEach((raw) => {
      const ln = raw.replace(/\s+$/, "");
      let m;
      if (/^\s*\|.*\|\s*$/.test(ln)) { flushPara(); closeList(); tbl.push(cells(ln)); return; }
      flushTbl();
      if (!ln.trim()) { flushPara(); closeList(); return; }
      if (/^\s*\[[^\]\n]{1,40}\](\s*(->|→)\s*\[[^\]\n]{1,40}\]){1,7}\s*$/.test(ln)) {
        flushPara(); closeList();
        out.push('<div class="md-flow">' + ln.split(/\s*(?:->|→)\s*/).map(x => "<span>" + inline(x.trim().replace(/^\[|\]$/g, "")) + "</span>").join("<i>→</i>") + "</div>");
        return;
      }
      if ((m = /^\s*#{2}\s+(.+)$/.exec(ln)) && !/^\s*###/.test(ln)) { flushPara(); closeList(); out.push("<h3>" + inline(m[1]) + "</h3>"); return; }
      if ((m = /^\s*#{3,}\s+(.+)$/.exec(ln))) { flushPara(); closeList(); out.push("<h4>" + inline(m[1]) + "</h4>"); return; }
      if ((m = /^\s*(?:[-*•·]|[○●■□▪◦])\s+(.+)$/.exec(ln))) {
        flushPara();
        if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
        out.push("<li>" + inline(m[1]) + "</li>"); return;
      }
      if ((m = /^\s*\d{1,2}[.)]\s+(.+)$/.exec(ln))) {
        flushPara();
        if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
        out.push("<li>" + inline(m[1]) + "</li>"); return;
      }
      closeList();
      para.push(ln.trim());
    });
    flushTbl(); flushPara(); closeList();
    return out.join("");
  }
  /* 글자 수(요약 길이 안내 · 읽는 시간 계산) — 표시 기호 제외 */
  const plain = (text) => String(text == null ? "" : text).replace(/^\s*(#{2,}|[-*•·]|\d{1,2}[.)])\s+/gm, "").replace(/\*\*/g, "").replace(/^\s*\|[\s:|-]+\|\s*$/gm, "").replace(/[|\[\]]/g, " ");
  /* 읽는 데 드는 시간(초) — 한글 업무 글 분당 약 450자, 짧아도 20초 */
  const readSec = (text) => Math.max(20, Math.round(plain(text).replace(/\s+/g, "").length / 7.5));
  root.SemisLearnMd = { html, plain, readSec, esc };
})(typeof window !== "undefined" ? window : this);
