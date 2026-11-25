/* 운항 현황 앱 설치 안내(v1.84) — 현장 화면(flight.html)의 '설치' 단추와 설치 안내 페이지(install.html)가 함께 쓴다.
   안드로이드: 설치 파일 dl/hdrive-flight.apk(현장 화면을 주소창 없이 여는 앱 kr.hdrive.flight — 서명 키는 저장소 밖,
   사이트 확인 파일 .well-known/assetlinks.json) · 아이폰: Safari '홈 화면에 추가'(flight.html 은 홈 화면 앱 설정이 되어 있음).
   카카오톡 안에서 열면 kakaotalk://web/openExternal 로 기본 브라우저(아이폰 = Safari)에서 다시 연다. */
"use strict";

(() => {
  const APK = "dl/hdrive-flight.apk";
  const APK_SIZE = "약 1.7MB";
  const FIELD = "flight.html";
  const PAGE = "install.html";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const abs = (p) => { try { return new URL(p, location.href).href.replace(/[?#].*$/, ""); } catch (e) { return p; } };
  const uaOf = (ua) => (ua != null ? String(ua) : (typeof navigator !== "undefined" && navigator.userAgent) || "");

  /* ios · android · other — iPadOS 는 맥 UA 를 쓰므로 터치 지점 수로 가린다 */
  function platform(ua) {
    const u = uaOf(ua);
    const touchMac = /Macintosh/.test(u) && typeof navigator !== "undefined" && Number(navigator.maxTouchPoints) > 1;
    if (/iPhone|iPad|iPod/.test(u) || touchMac) return "ios";
    if (/Android/i.test(u)) return "android";
    return "other";
  }
  const inKakao = (ua) => /KAKAOTALK/i.test(uaOf(ua));
  /* 이미 앱으로 열림 — 홈 화면 앱(standalone) · 아이폰 홈 화면 · 안드로이드 앱(처음 연 주소의 리퍼러 android-app://) */
  function standalone() {
    try {
      if (typeof matchMedia === "function" && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches)) return true;
    } catch (e) { /* 지원 안 함 */ }
    if (typeof navigator !== "undefined" && navigator.standalone === true) return true;
    try {
      if (/^android-app:\/\//.test(document.referrer || "")) { sessionStorage.setItem("hd:app", "1"); return true; }
      if (sessionStorage.getItem("hd:app") === "1") return true;
    } catch (e) { /* 저장 불가 */ }
    return false;
  }
  /* 카카오톡 안 → 기본 브라우저에서 열기 */
  const externalHref = (url) => "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);

  const SHARE = '<svg class="ins-sh" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="공유 버튼"><path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M8 11H6v9h12v-9h-2"/></svg>';

  /* 단계 — kind: android | ios. opts.here: 지금 이 화면이 현장 화면(flight.html)인지 */
  function steps(kind, opts) {
    const o = opts || {};
    if (kind === "android") return [
      "카카오톡으로 받은 <b>hdrive-flight.apk</b> 를 누르거나 <b>설치 파일 받기</b>로 받습니다.",
      "'출처를 알 수 없는 앱' 창이 나오면 <b>설정</b>에서 허용을 켜고 돌아옵니다.",
      "<b>설치</b>를 누릅니다. 보안 확인 창이 나오면 설치를 계속합니다.",
      "홈 화면의 <b>운항 현황</b>을 엽니다. 처음 한 번 PIN 을 넣습니다."
    ];
    return [
      o.here ? "이 화면을 <b>Safari</b>에서 엽니다. 카카오톡에서 열었으면 오른쪽 아래 공유 버튼 → Safari."
        : "<b>Safari</b>에서 운항 현황(" + esc(abs(FIELD).replace(/^https?:\/\//, "")) + ")을 엽니다. 카카오톡에서 열었으면 오른쪽 아래 공유 버튼 → Safari.",
      "공유 버튼 " + SHARE + " 을 누릅니다. iOS 26 은 주소창 옆 <b>⋯</b> → <b>공유</b>.",
      "<b>홈 화면에 추가</b>를 누릅니다. 목록에 없으면 아래로 내려 찾습니다.",
      "이름이 '운항 현황'인지 보고 <b>추가</b>를 누릅니다.",
      "홈 화면의 <b>운항 현황</b>을 엽니다. 처음 한 번 PIN 을 넣습니다."
    ];
  }
  const stepsHTML = (kind, opts) => `<ol class="ins-steps">${steps(kind, opts).map(s => `<li>${s}</li>`).join("")}</ol>`;
  const NOTE = {
    android: "안드로이드 7.0 이상. 크롬이 있어야 주소창 없이 열립니다.",
    ios: "홈 화면 앱은 Safari 와 따로 저장되므로 처음 한 번 PIN 을 다시 넣습니다."
  };

  window.SemisInstall = { APK, APK_SIZE, FIELD, PAGE, abs, platform, inKakao, standalone, externalHref, steps, stepsHTML, NOTE };
})();
