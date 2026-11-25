/* 운항 현황 앱 설치 안내(install.html · v1.84) — 안드로이드(설치 파일) · 아이폰(홈 화면에 추가) 두 칸.
   휴대폰에서는 그 기종 칸이 먼저, PC 는 나란히. 인쇄(A4 한 장)에는 두 칸 모두 + QR(안드로이드 = 설치 파일 · 아이폰 = 현장 화면). */
"use strict";

(() => {
  const I = window.SemisInstall, Q = window.SemisQR;
  const app = document.getElementById("ins-app");
  if (!I || !app) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kind = I.platform();
  const apk = I.abs(I.APK), field = I.abs(I.FIELD);
  const qr = (url) => (Q ? `<div class="ins-qr">${Q.svg(url, { ecc: "M", size: 168, margin: 2 })}</div>` : "");
  const short = (u) => u.replace(/^https?:\/\//, "");

  const android = `<section class="ins-card" data-k="android" aria-labelledby="ins-a">
      <h2 id="ins-a">안드로이드</h2>
      <div class="ins-row">${qr(apk)}
        <div class="ins-act"><a class="ins-go" id="ins-apk" href="${esc(I.APK)}" download="hdrive-flight.apk">설치 파일 받기 <small>${esc(I.APK_SIZE)}</small></a>
          <p class="ins-url">${esc(short(apk))}</p></div></div>
      ${I.stepsHTML("android")}
      <p class="ins-note">${esc(I.NOTE.android)}</p>
    </section>`;
  const openHref = kind === "ios" && I.inKakao() ? I.externalHref(field) : I.FIELD;
  const ios = `<section class="ins-card" data-k="ios" aria-labelledby="ins-i">
      <h2 id="ins-i">아이폰</h2>
      <div class="ins-row">${qr(field)}
        <div class="ins-act"><a class="ins-go" id="ins-open" href="${esc(openHref)}">${kind === "ios" && I.inKakao() ? "Safari로 운항 현황 열기" : "운항 현황 열기"}</a>
          <p class="ins-url">${esc(short(field))}</p></div></div>
      ${I.stepsHTML("ios")}
      <p class="ins-note">${esc(I.NOTE.ios)}</p>
    </section>`;

  app.innerHTML = `<div class="ins-head"><h1>운항 현황 앱 설치</h1><p>H:drive 현장용 운항 현황을 휴대폰 앱처럼 씁니다.</p></div>
    <div class="ins-grid${kind === "other" ? " is-wide" : ""}">${kind === "ios" ? ios + android : android + ios}</div>`;
  document.body.dataset.k = kind;

  const pb = document.getElementById("ins-print");
  if (pb) pb.onclick = () => { try { window.print(); } catch (e) { /* 인쇄 불가 */ } };
})();
