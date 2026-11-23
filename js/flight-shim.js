/* 현장용 운항 현황(flight.html) — js/flightops.js 가 쓰는 SeMIS · SemisSync 일부만 흉내(edu-shim.js 와 같은 방식).
   로그인 없는 화면: 위치 서버 출입은 현장 PIN 표(x-flight-token)로 — 표는 이 기기에만(js/flight-app.js 가 관리).
   아이콘 글자는 js/app.js ICONS 와 같아야 한다(시험 FA09). */
"use strict";

(() => {
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const ICONS = {
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    locate: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    zoombox: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M12 4h1.5M4 12v1.5M4 17v1.5A1.5 1.5 0 0 0 5.5 20H8M17 4h1.5A1.5 1.5 0 0 1 20 5.5V8"/><circle cx="15" cy="15" r="3.2"/><path d="m17.4 17.4 2.8 2.8"/>',
    down: '<path d="M12 4v11"/><path d="m7.5 11.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>'
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function icon(name, size) {
    const d = ICONS[name] || "";
    const z = size || 20;
    return '<svg class="ico" width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  let toastT = 0;
  function toast(msg, isErr) {
    let el = document.getElementById("fa-toast");
    if (!el) { el = document.createElement("div"); el.id = "fa-toast"; el.className = "fa-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = String(msg || "");
    el.classList.toggle("is-err", !!isErr);
    el.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("is-on"), 3200);
  }
  const noop = () => {};
  window.SeMIS = {
    $: (s, r) => (r || document).querySelector(s),
    $$: (s, r) => Array.from((r || document).querySelectorAll(s)),
    esc, icon, toast,
    openModal: noop, closeModal: noop, confirmModal: noop,
    ui: {
      chip(text, tone) { return '<span class="badge badge-' + esc(tone || "gray") + '">' + esc(text) + '</span>'; },
      head: () => "", stats: () => "", tip: () => ""
    },
    data: {},
    canEdit: () => false, isAdmin: () => false,
    isMobile: () => !!(window.matchMedia && window.matchMedia("(max-width: 767px)").matches),
    navigate: noop, registerModule: noop,
    flightAuth: () => (window.SemisFieldAuth ? window.SemisFieldAuth.headers() : {}),
    onFlightAuth: () => { if (window.SemisFieldAuth) window.SemisFieldAuth.expired(); }
  };
  window.SemisSync = { ANON: SUPA_KEY };
})();
