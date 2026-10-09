/* 시작 진입점 — CSP 가 인라인 스크립트를 막아 별도 파일. 동기화는 로그인 뒤 app.js 가 시작 */
"use strict";
SeMIS.boot();
if (window.SemisSearch) SemisSearch.init();
if (window.SemisCalendar) SemisCalendar.startReminders();
