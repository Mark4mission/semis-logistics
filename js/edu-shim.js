/* 이수 등록 화면(edu.html)용 최소 코어 — training.js 의 기준 · 유효기한 계산을 쓰려고 SeMIS 자리만 만든다.
   화면 · 저장 · 권한 기능 없음(로그인하지 않는 공개 화면). */
"use strict";

(function () {
  if (window.SeMIS) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const noop = () => {};
  window.SeMIS = {
    data: { training: { courses: [], people: [], records: [], sessions: [] } },
    user: null,
    $: (s, r) => (r || document).querySelector(s),
    $$: (s, r) => Array.from((r || document).querySelectorAll(s)),
    esc, toast: noop, openModal: noop, closeModal: noop, confirmModal: noop,
    ui: {}, icon: () => "",
    registerModule: noop, renderView: noop, navigate: noop, save: noop,
    isMobile: () => false, canEdit: () => false, canDelete: () => false,
    edu: true
  };
})();
