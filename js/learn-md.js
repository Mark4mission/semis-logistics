/* 교육 전파 요약 글 → 안전한 HTML(관리 화면 미리보기 · 학습 화면 · 기록부 인쇄 공통).
   쓸 수 있는 것: "## 소제목", "### 작은 제목", "- 목록", "1. 번호 목록", 빈 줄 = 문단, **굵게**. 글자는 모두 이스케이프한다 */
"use strict";

(function (root) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inline = (s) => esc(s).replace(/\*\*([^*\n]{1,200})\*\*/g, "<strong>$1</strong>");
  function html(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let list = "", para = [];
    const flushPara = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
    const closeList = () => { if (list) { out.push("</" + list + ">"); list = ""; } };
    lines.forEach((raw) => {
      const ln = raw.replace(/\s+$/, "");
      let m;
      if (!ln.trim()) { flushPara(); closeList(); return; }
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
    flushPara(); closeList();
    return out.join("");
  }
  /* 글자 수(요약 길이 안내 · 읽는 시간 계산) — 표시 기호 제외 */
  const plain = (text) => String(text == null ? "" : text).replace(/^\s*(#{2,}|[-*•·]|\d{1,2}[.)])\s+/gm, "").replace(/\*\*/g, "");
  /* 읽는 데 드는 시간(초) — 한글 업무 글 분당 약 450자, 짧아도 20초 */
  const readSec = (text) => Math.max(20, Math.round(plain(text).replace(/\s+/g, "").length / 7.5));
  root.SemisLearnMd = { html, plain, readSec, esc };
})(typeof window !== "undefined" ? window : this);
