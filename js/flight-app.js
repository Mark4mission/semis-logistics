/* 현장용 운항 현황(flight.html) — 현장 PIN → 12시간 표(서버가 발급 · 확인, tools/sql/semis-logi-flight.sql) → 지도 + 인천 접근 목록.
   지도 · 목록은 H:drive 와 같은 js/flightops.js(SemisFlight.dashHTML · mountDash). 표는 이 기기 localStorage 에만 —
   만료되거나 위치 서버가 거절(401)하면 지우고 PIN 화면으로. PIN 은 보관하지 않는다. */
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
      </form>
    </section>`;
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
    app.innerHTML = `<header class="fa-bar">
        <span class="fa-brand"><img src="assets/mark.svg" alt="" width="24" height="24"><span><b>H:</b>drive</span></span>
        <h1 class="fa-t">운항 현황</h1>
        <span class="fa-sp"></span>
        <span class="fa-upd" id="fa-upd" aria-live="polite"></span>
        <button type="button" class="fa-ref" id="fa-ref" title="새로고침" aria-label="새로고침">${icon("refresh", 18)}</button>
      </header>
      <main class="fa-main" id="fa-main">${SemisFlight.dashHTML()}</main>`;
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
