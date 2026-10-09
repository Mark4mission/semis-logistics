/* 로그인 폼 조기 제출 보호 — <head> 에서 먼저 읽혀, 앱 스크립트 로드 전 제출(새로고침·암호 소실)을
   붙잡아 두고 앱이 준비되면 app.js 가 이어서 로그인. SeMIS v2 와 같은 파일 */
"use strict";
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__semisReady === undefined) window.__semisReady = false;
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || f.id !== "login-form" || window.__semisReady) return;
    e.preventDefault();
    var pw = document.getElementById("login-pw");
    if (!pw || !pw.value) return;
    window.__semisLoginQueued = true;
    var er = document.getElementById("login-error");
    if (er) er.textContent = "확인 중…";
  }, true);
})();
