/* 현장용 운항 현황(flight.html) — 현장 PIN → 12시간 표(서버가 발급 · 확인, tools/sql/semis-logi-flight.sql) → 지도 + 인천 접근 목록.
   지도 · 목록은 H:drive 와 같은 js/flightops.js(SemisFlight.dashHTML · mountDash). 표는 이 기기 localStorage 에만 —
   만료되거나 위치 서버가 거절(401)하면 지우고 PIN 화면으로. PIN 은 보관하지 않는다.
   v1.81 이 화면만: 실시간(5초 간격 위치 · 그 사이 이어 그리기 — setLive) · 처음 지도 = 인천 활주로 4개의 가운데에서 반경 5NM(setView).
   v1.84: 휴대폰에서 아직 앱으로 열지 않았으면 '앱으로 설치'(PIN 화면 아래 · 머리 띠 단추) → 안드로이드 설치 파일 / 아이폰 홈 화면 추가 안내. */
"use strict";

(() => {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  const RPC = SUPA_URL + "/rest/v1/rpc/";
  const LS = "hdflight:tok";
  const PIN_RE = /^[0-9]{6,10}$/;
  const { $, esc, icon } = SeMIS;
  const app = document.getElementById("fa-app");
  let mem = null;          // localStorage 를 못 쓰는 브라우저(사생활 보호 모드 등)
  let mo = null;

  function readTok() {
    let v = mem;
    try { const s = localStorage.getItem(LS); if (s) v = JSON.parse(s); } catch (e) { /* 메모리 값 */ }
    if (!v || typeof v.t !== "string" || !/^[0-9]{10}\.[0-9]{1,9}\.[0-9a-f]{64}$/.test(v.t) || !(Number(v.exp) * 1000 > Date.now() + 30000)) return null;
    return v;
  }
  function saveTok(t, exp) {
    mem = { t, exp };
    try { localStorage.setItem(LS, JSON.stringify(mem)); } catch (e) { /* 메모리만 */ }
  }
  function clearTok() {
    mem = null;
    try { localStorage.removeItem(LS); } catch (e) { /* 없음 */ }
  }
  window.SemisFieldAuth = {
    headers() { const v = readTok(); return v ? { "x-flight-token": v.t } : {}; },
    expired() { clearTok(); gate("다시 PIN 을 넣어 주세요."); }
  };

  const MSG = {
    pin: "PIN 이 맞지 않습니다.",
    invalid: "숫자 6~10자리를 넣어 주세요.",
    locked: "틀린 횟수가 많아 15분 뒤에 다시 할 수 있습니다.",
    paused: "잠시 후 다시 시도해 주세요.",
    off: "현장용 PIN 이 아직 정해지지 않았습니다.",
    net: "서버에 연결하지 못했습니다."
  };

  /* ── 앱으로 설치(v1.84) — 휴대폰 · 태블릿에서 아직 앱으로 열지 않았을 때만. 안내는 js/install-core.js ── */
  const INS = window.SemisInstall;
  const canIns = () => !!INS && INS.platform() !== "other" && !INS.standalone();
  function insSheet() {
    if (!INS || $("#fa-sheet")) return;
    const kind = INS.platform() === "android" ? "android" : "ios";
    const top = kind === "android"
      ? `<a class="fa-go fa-ins-go" href="${esc(INS.APK)}" download="hdrive-flight.apk">${icon("down", 18)}<span>설치 파일 받기</span><small>${esc(INS.APK_SIZE)}</small></a>`
      : INS.inKakao() ? `<a class="fa-go fa-ins-go" href="${esc(INS.externalHref(INS.abs(INS.FIELD)))}">Safari로 열기</a>` : "";
    const el = document.createElement("div");
    el.id = "fa-sheet";
    el.className = "fa-sheet";
    el.innerHTML = `<div class="fa-sheet-box" role="dialog" aria-modal="true" aria-labelledby="fa-sheet-t">
        <div class="fa-sheet-h"><h2 id="fa-sheet-t">${kind === "android" ? "안드로이드 앱 설치" : "홈 화면에 추가"}</h2>
          <button type="button" class="fa-sheet-x" id="fa-sheet-x">닫기</button></div>
        ${top}${INS.stepsHTML(kind, { here: true })}
        <p class="fa-sheet-n">${esc(INS.NOTE[kind])}</p>
        <a class="fa-sheet-more" href="${esc(INS.PAGE)}">설치 안내 전체</a>
      </div>`;
    document.body.appendChild(el);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    $("#fa-sheet-x").onclick = close;
    document.addEventListener("keydown", onKey);
    try { $("#fa-sheet-x").focus({ preventScroll: true }); } catch (e) { /* 포커스 불가 */ }
  }
  function insBtn(sel) {
    const b = $(sel);
    if (!b) return;
    b.hidden = !canIns();
    b.onclick = insSheet;
  }

  /* ── PIN 화면 ── */
  function gate(msg) {
    if (mo) { mo.disconnect(); mo = null; }
    document.body.classList.add("fa-locked");
    app.innerHTML = `<section class="fa-gate" aria-labelledby="fa-gt">
      <form class="fa-card" id="fa-form" novalidate>
        <span class="fa-mark"><img src="assets/mark.svg" alt="" width="44" height="44"></span>
        <h1 id="fa-gt">운항 현황</h1>
        <p class="fa-sub"><b>H:</b>drive</p>
        <label class="fa-lbl" for="fa-pin">PIN</label>
        <input id="fa-pin" class="fa-pin mono" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="10" required>
        <p class="fa-err" id="fa-err" role="alert">${esc(msg || "")}</p>
        <button type="submit" class="fa-go" id="fa-go">확인</button>
        <button type="button" class="fa-insl" id="fa-insl" hidden>앱으로 설치</button>
      </form>
    </section>`;
    insBtn("#fa-insl");
    const f = $("#fa-form"), inp = $("#fa-pin");
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/[^0-9]/g, "").slice(0, 10); });
    f.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
    try { inp.focus({ preventScroll: true }); } catch (e) { /* 포커스 불가 */ }
  }
  async function submit() {
    const inp = $("#fa-pin"), btn = $("#fa-go"), err = $("#fa-err");
    const pin = (inp.value || "").trim();
    if (!PIN_RE.test(pin)) { err.textContent = MSG.invalid; inp.focus(); return; }
    btn.disabled = true; btn.classList.add("is-busy"); err.textContent = "";
    let d = null;
    try {
      const r = await fetch(RPC + "semis_logi_flight_pin", {
        method: "POST", cache: "no-store",
        headers: { apikey: SemisSync.ANON, Authorization: "Bearer " + SemisSync.ANON, "Content-Type": "application/json" },
        body: JSON.stringify({ p_pin: pin })
      });
      d = r && r.ok ? await r.json() : null;
    } catch (e) { d = null; }
    if (!$("#fa-go")) return;
    btn.disabled = false; btn.classList.remove("is-busy");
    if (d && d.ok && typeof d.token === "string") {
      saveTok(d.token, d.exp);
      inp.value = "";
      main();
      return;
    }
    err.textContent = MSG[(d && d.error) || "net"] || MSG.net;
    inp.value = "";
    inp.focus();
  }

  /* ── 지도 + 인천 접근 목록 ── */
  function main() {
    document.body.classList.remove("fa-locked");
    const c = window.SemisFlightCore.HOME_CTR;
    SemisFlight.setView("dash", { lat: c.lat, lon: c.lon, nm: 5, label: "인천공항" });
    SemisFlight.setLive("dash", true);
    app.innerHTML = `<header class="fa-bar">
        <span class="fa-brand"><img src="assets/mark.svg" alt="" width="24" height="24"><span><b>H:</b>drive</span></span>
        <h1 class="fa-t">운항 현황</h1>
        <span class="fa-sp"></span>
        <span class="fa-upd" id="fa-upd" aria-live="polite"></span>
        <button type="button" class="fa-ins" id="fa-ins" hidden title="앱으로 설치" aria-label="앱으로 설치">${icon("down", 18)}</button>
        <button type="button" class="fa-ref" id="fa-ref" title="새로고침" aria-label="새로고침">${icon("refresh", 18)}</button>
      </header>
      <main class="fa-main" id="fa-main">${SemisFlight.dashHTML()}</main>`;
    insBtn("#fa-ins");
    const meta = $("#dflt-meta"), upd = $("#fa-upd");
    const copy = () => { if (meta && upd) upd.textContent = meta.textContent; };
    copy();
    if (meta && typeof MutationObserver !== "undefined") { mo = new MutationObserver(copy); mo.observe(meta, { childList: true, characterData: true, subtree: true }); }
    $("#fa-ref").onclick = async () => {
      const b = $("#fa-ref");
      b.disabled = true; b.classList.add("is-busy");
      try { await SemisFlight.refresh(true); } finally { const b2 = $("#fa-ref"); if (b2) { b2.disabled = false; b2.classList.remove("is-busy"); } }
    };
    SemisFlight.mountDash();
  }

  if (readTok()) main(); else gate("");
})();
