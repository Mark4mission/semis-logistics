/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 운항 현황 (v1.14)
   에어제타 화물기 실시간 위치(ADS-B) · 인천 접근 · 입출항 기록.
     대시보드: 지도(기체만) + 인천 접근 중 목록
     메뉴 "운항 현황"(#/flight): 요약 · 지도(비행 경로) · 인천 입항/출항 · 기체 현황 · 입출항 기록(48시간)
   데이터: Supabase Edge Function semis-logi-adsb (adsb.lol 중계, 2분마다 서버가 기록) — js/flightcore.js 가 해석
   지도: Leaflet 1.9.4(assets/vendor/leaflet, 필요할 때만 로드) + OpenStreetMap 타일
   관리 항목은 기체 목록(공용 DB fleet)뿐 — 스케줄은 쓰지 않는다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const F = window.SemisFlightCore;
  const MOD = "flight";
  const TITLE = "운항 현황";
  const LEAFLET_VER = "1.9.4";
  const FN_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co/functions/v1/semis-logi-adsb";
  const REFRESH_MS = 60000;
  const TYPES = ["B744", "B763", "B738"];

  const state = { ts: 0, err: "", ac: [], events: null, trail: false, fetchedAt: 0, srcErr: "", ver: 0, busy: null };

  /* ─────────── 데이터 ─────────── */
  function fleet() {
    const f = SeMIS.data.fleet;
    return Array.isArray(f) && f.length ? f : F.DEFAULT_FLEET;
  }
  function load(opts) {
    const o = opts || {};
    const wantTrail = !!o.trail, wantEvents = !!o.events;
    const age = Date.now() - state.ts;
    if (!o.force && state.ts && age < 30000 && !state.err && (!wantTrail || state.trail) && (!wantEvents || state.events)) return Promise.resolve(state);
    if (state.busy) return state.busy;
    state.busy = (async () => {
      try {
        const key = window.SemisSync && SemisSync.ANON;
        const qs = [wantTrail ? "trail=1" : "", wantEvents ? "events=1" : ""].filter(Boolean).join("&");
        const r = await fetch(FN_URL + (qs ? "?" + qs : ""), {
          cache: "no-store", headers: key ? { apikey: key, Authorization: "Bearer " + key } : {} });
        if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "-"));
        const j = await r.json();
        if (!j || Array.isArray(j) || !Array.isArray(j.ac)) throw new Error("응답 형식");
        state.ac = j.ac;
        state.fetchedAt = j.fetched_at ? Date.parse(j.fetched_at) : Date.now();
        state.srcErr = j.err || "";
        if (wantEvents) state.events = Array.isArray(j.events) ? j.events : [];
        state.trail = wantTrail;
        state.err = "";
      } catch (e) {
        state.err = String((e && e.message) || e);
      } finally {
        state.ts = Date.now();
        state.ver++;
        state.busy = null;
      }
      return state;
    })();
    return state.busy;
  }
  /* 기체 목록 × 서버 상태 → 판정 */
  function model(now) {
    now = now || Date.now();
    const by = {};
    (state.ac || []).forEach(r => { by[F.normHex(r.hex)] = r; });
    const items = fleet().map(f => {
      const row = by[F.normHex(f.hex)] || null;
      const st = F.status(row, now);
      return { f, row, st, fno: row && row.flight ? F.fnoOf(row.flight) : "", dep: F.lastDep(state.events, F.normHex(f.hex)) };
    });
    const of = (c) => items.filter(x => x.st.code === c);
    return {
      items, now,
      appr: of("appr").sort((a, b) => a.st.dHome - b.st.dHome),
      air: of("air"), emg: of("emg"), lost: of("lost"), none: of("none"),
      gnd: of("gnd"), gndHome: of("gnd").filter(x => x.st.at === F.HOME), gndAway: of("gnd").filter(x => x.st.at !== F.HOME)
    };
  }
  const typeName = (it) => F.AC_TYPES[(it.row && it.row.type) || it.f.type] || it.f.model || it.f.type || "";
  const nf = (n) => Number(n).toLocaleString("en-US");
  const altTxt = (r) => (r && r.alt != null ? nf(Math.round(r.alt / 25) * 25) + " ft" : "");
  const gsTxt = (r) => (r && r.gs != null ? Math.round(r.gs) + " kt" : "");
  function whereTxt(it) {
    const st = it.st;
    if (st.code === "gnd") return st.at ? F.aptName(st.at) : "공항 밖 지상";
    if (!st.pos) return "";
    const home = F.apt(F.HOME);
    const near = F.nearestApt(st.pos, 60);
    if (near && near !== F.HOME) return F.aptName(near) + " 부근";
    return "인천 " + F.dir8(F.bearing(home, st.pos)) + "쪽 " + nf(Math.round(st.dHome)) + " km";
  }
  function updText() {
    if (!state.ts) return "불러오는 중";
    if (state.err && !state.ac.length) return "연결 실패";
    return F.kstHM(state.fetchedAt || state.ts) + " 기준" + (state.err ? " · 갱신 실패" : "");
  }

  /* ─────────── 지도 (Leaflet) ─────────── */
  let leafletP = null;
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      if (!document.querySelector("link[data-leaflet]")) {
        const l = document.createElement("link");
        l.rel = "stylesheet"; l.href = "assets/vendor/leaflet/leaflet.css?v=" + LEAFLET_VER; l.dataset.leaflet = "1";
        document.head.appendChild(l);
      }
      const s = document.createElement("script");
      s.src = "assets/vendor/leaflet/leaflet.js?v=" + LEAFLET_VER; s.async = true;
      s.onload = () => (window.L && window.L.map ? res(window.L) : rej(new Error("leaflet")));
      s.onerror = () => { leafletP = null; rej(new Error("leaflet")); };
      document.head.appendChild(s);
    });
    return leafletP;
  }
  const PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6c.9 0 1.45 1 1.45 2.2v5.5l7.8 4.6v2.1l-7.8-2.4v4.9l2.5 1.8v1.6L12 21.2l-3.95.7v-1.6l2.5-1.8v-4.9l-7.8 2.4v-2.1l7.8-4.6V3.8c0-1.2.55-2.2 1.45-2.2z"/></svg>';
  const lonN = (lon) => (lon < -30 ? lon + 360 : lon);          // 태평양 중심 — 미주는 동쪽으로 이어 붙인다
  const near = (lon, ref) => { while (lon - ref > 180) lon -= 360; while (lon - ref < -180) lon += 360; return lon; };
  const maps = {};

  function mountMap(el, kind) {
    if (!el) return;
    loadLeaflet().then(L => {
      if (!el.isConnected) return;
      let m = maps[kind];
      if (m && m.el !== el) { try { m.map.remove(); } catch (e) { /* 이미 떨어진 지도 */ } m = null; }
      if (!m) {
        const map = L.map(el, { zoomSnap: 0.25, minZoom: 1.5, maxZoom: 11, worldCopyJump: false,
          scrollWheelZoom: kind === "full", attributionControl: true });
        map.attributionControl.setPrefix(false);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 11, className: "fo-tiles",
          attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · 위치 <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a>'
        }).addTo(map);
        map.setView([37.46, 126.44], 4);
        m = maps[kind] = { L, map, el, layer: L.layerGroup().addTo(map), marks: {}, fitted: false, lbl: [] };
        map.on("zoomend moveend resize", () => declutter(kind));
        el.classList.add("is-ready");
      }
      paintMap(kind);
      setTimeout(() => { if (maps[kind] === m) m.map.invalidateSize(); }, 60);
    }).catch(() => {
      if (!el.isConnected) return;
      el.classList.add("is-failed");
      el.innerHTML = '<div class="fo-map-msg">지도를 불러오지 못했습니다.</div>';
    });
  }
  function popHTML(it) {
    const st = it.st, r = it.row || {};
    const rows = [
      ["상태", esc(st.label) + (st.code === "lost" ? " · " + esc(F.ago(st.seen)) : "")],
      it.dep ? ["출발", esc((F.aptName(it.dep.apt) || "공항 미상") + " " + F.kstHM(Date.parse(it.dep.at))) + (it.dep.inferred ? " (추정)" : "")] : null,
      st.code !== "gnd" && r.alt != null ? ["고도", esc(altTxt(r)) + (r.vr != null && Math.abs(r.vr) >= 300 ? ` <small>${r.vr > 0 ? "상승" : "강하"} ${esc(nf(Math.abs(Math.round(r.vr))))} ft/분</small>` : "")] : null,
      st.code !== "gnd" && r.gs != null ? ["속도", esc(gsTxt(r))] : null,
      st.code === "appr" ? ["인천까지", esc(nf(Math.round(st.dHome)) + " km · 도착 예상 " + F.kstHM(st.eta))] : null,
      st.code === "gnd" && st.since ? ["도착", esc(F.kstHM(st.since))] : null,
      r.sqk ? ["스쿽", esc(r.sqk)] : null,
      st.seen ? ["수신", esc(F.kstHM(st.seen) + " · " + F.ago(st.seen))] : null
    ].filter(Boolean);
    return `<div class="fo-pop"><div class="fo-pop-h"><b class="mono">${esc(it.fno || it.f.reg)}</b><span>${esc(it.f.reg)} · ${esc(typeName(it))}</span></div>
      <dl>${rows.map(x => `<dt>${x[0]}</dt><dd>${x[1]}</dd>`).join("")}</dl></div>`;
  }
  function acIcon(L, it, pos, opts) {
    const st = it.st, r = it.row || {};
    const trk = r.trk != null ? Math.round(r.trk) : 0;
    const lbl = opts.label ? `<span class="fo-lb"><b>${esc(it.fno || it.f.reg)}</b>${it.fno ? esc(it.f.reg) : ""}</span>` : "";
    return L.divIcon({
      className: "fo-mk", iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<span class="fo-ac${opts.est ? " is-est" : ""}" data-tone="${esc(st.code)}" style="--r:${trk}deg">${PLANE}</span>${lbl}`
    });
  }
  function paintMap(kind) {
    const m = maps[kind];
    if (!m || !m.el.isConnected) return;
    const { L, layer, map } = m;
    layer.clearLayers();
    m.marks = {};
    m.lbl = [];
    const PR = { emg: 0, appr: 1, air: 2, lost: 3 };
    const md = model();
    const pts = [];
    const full = kind === "full";
    const home = F.apt(F.HOME);
    L.circleMarker([home.lat, home.lon], { radius: 5, weight: 2, color: "#0b1f26", fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(layer);

    const groups = {};
    md.items.forEach(it => {
      const st = it.st;
      if (!st.pos) return;
      if (st.code === "gnd") {
        const k = st.at || "@" + it.f.hex;
        (groups[k] = groups[k] || { at: st.at, pos: st.at ? F.apt(st.at) : st.pos, list: [] }).list.push(it);
        return;
      }
      const lon = lonN(st.pos.lon);
      if (st.code === "lost") {
        const last = [st.pos.lat, lon];
        L.circleMarker(last, { radius: 3, weight: 1.5, color: "#5b6b71", fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(layer);
        let at = last;
        if (st.est) {
          at = [st.est.lat, near(st.est.lon, lon)];
          L.polyline([last, at], { color: "#5b6b71", weight: 1.5, dashArray: "4 5", interactive: false }).addTo(layer);
        }
        const mk = L.marker(at, { icon: acIcon(L, it, at, { label: true, est: true }), keyboard: true, title: it.f.reg + " " + st.label })
          .bindPopup(popHTML(it), { className: "fo-popup", maxWidth: 280 }).addTo(layer);
        m.marks[it.f.hex] = mk;
        m.lbl.push({ mk, pr: PR.lost });
        pts.push(at);
        return;
      }
      const at = [st.pos.lat, lon];
      if (full && it.row && Array.isArray(it.row.trail) && it.row.trail.length > 1) {
        const tr = it.row.trail.slice();
        const line = [];
        let ref = lon;
        for (let i = tr.length - 1; i >= 0; i--) { const lo = near(tr[i][2], ref); line.unshift([tr[i][1], lo]); ref = lo; }
        line.push(at);
        L.polyline(line, { color: st.code === "appr" ? "#b45309" : "#0f766e", weight: 2, opacity: .55, interactive: false }).addTo(layer);
      }
      const mk = L.marker(at, { icon: acIcon(L, it, at, { label: true }), keyboard: true, title: (it.fno || it.f.reg) + " " + st.label, zIndexOffset: st.code === "appr" || st.code === "emg" ? 500 : 0 })
        .bindPopup(popHTML(it), { className: "fo-popup", maxWidth: 280 }).addTo(layer);
      m.marks[it.f.hex] = mk;
      m.lbl.push({ mk, pr: PR[st.code] == null ? 3 : PR[st.code] });
      pts.push(at);
    });
    Object.keys(groups).forEach(k => {
      const g = groups[k];
      const at = [g.pos.lat, lonN(g.pos.lon)];
      const isHome = g.at === F.HOME;
      const html = `<span class="fo-apt${isHome ? " is-home" : ""}"><b>${esc(g.at || "지상")}</b><i>${g.list.length}</i></span>`;
      const mk = L.marker(at, { icon: L.divIcon({ className: "fo-mk", iconSize: [54, 26], iconAnchor: [27, 13], html }), keyboard: true,
        title: (g.at ? F.aptName(g.at) : "지상") + " " + g.list.length + "대", zIndexOffset: -100 })
        .bindPopup(`<div class="fo-pop"><div class="fo-pop-h"><b>${esc(g.at ? F.aptName(g.at) : "지상")}</b><span>지상 ${g.list.length}대</span></div>
          <ul class="fo-pop-list">${g.list.map(it => `<li><b class="mono">${esc(it.f.reg)}</b><span>${esc(typeName(it))}</span><small>${esc(it.st.since ? F.kstHM(it.st.since) + " 도착" : F.ago(it.st.seen) + " 수신")}</small></li>`).join("")}</ul></div>`,
          { className: "fo-popup", maxWidth: 300 }).addTo(layer);
      g.list.forEach(it => { m.marks[it.f.hex] = mk; });
      pts.push(at);
    });
    if (!m.fitted) fitMap(kind, pts);
    declutter(kind);
    const leg = m.el.parentNode && m.el.parentNode.querySelector(".fo-legend");
    if (leg) leg.innerHTML = legendHTML(md);
  }
  /* 이름표 겹침 정리 — 비상 · 접근 · 비행 · 신호 없음 순으로 오른쪽 → 왼쪽 → 숨김(누르면 팝업으로 확인) */
  function declutter(kind) {
    const m = maps[kind];
    if (!m || !m.el.isConnected || !m.lbl.length) return;
    const hit = (a, b) => a.left < b.right + 2 && a.right + 2 > b.left && a.top < b.bottom + 1 && a.bottom + 1 > b.top;
    const icons = $$(".fo-ac, .fo-apt", m.el).map(x => x.getBoundingClientRect());
    const placed = [];
    m.lbl.slice().sort((a, b) => a.pr - b.pr).forEach(x => {
      const el = x.mk.getElement && x.mk.getElement();
      const lb = el && el.querySelector(".fo-lb");
      if (!lb) return;
      el.classList.remove("lb-l", "lb-x");
      const own = el.querySelector(".fo-ac").getBoundingClientRect();
      const clear = (r) => !placed.some(p => hit(r, p)) && !icons.some(i => i !== own && !(i.left === own.left && i.top === own.top) && hit(r, i));
      let r = lb.getBoundingClientRect();
      if (clear(r)) { placed.push(r); return; }
      el.classList.add("lb-l");
      r = lb.getBoundingClientRect();
      if (clear(r)) { placed.push(r); return; }
      el.classList.remove("lb-l");
      el.classList.add("lb-x");
    });
  }
  function fitMap(kind, pts) {
    const m = maps[kind];
    if (!m) return;
    if (!pts) {
      pts = [];
      m.layer.eachLayer(l => { if (l.getLatLng && l.options && l.options.icon) pts.push(l.getLatLng()); });
    }
    if (pts.length) {
      m.map.fitBounds(m.L.latLngBounds(pts).pad(kind === "full" ? 0.12 : 0.18), { maxZoom: 6, animate: false });
      m.fitted = true;
    }
  }
  function legendHTML(md) {
    const n = (a) => a.length;
    return [
      ["air", "비행 중", n(md.air) + n(md.emg)], ["appr", "인천 접근", n(md.appr)],
      ["gnd", "지상", n(md.gnd)], ["lost", "신호 없음", n(md.lost)]
    ].map(x => `<span data-tone="${x[0]}"><i></i>${esc(x[1])} <b class="mono">${x[2]}</b></span>`).join("");
  }
  function focusAc(kind, hex) {
    const m = maps[kind];
    const mk = m && m.marks[hex];
    if (!mk) return;
    m.map.setView(mk.getLatLng(), Math.max(m.map.getZoom(), 7), { animate: true });
    mk.openPopup();
  }

  /* ─────────── 인천 접근 중 목록 (대시보드 · 운항 현황 공용) ─────────── */
  function apprListHTML(md) {
    if (!md.appr.length) return '<p class="fo-none">지금 인천으로 접근 중인 항공기가 없습니다.</p>';
    return `<ol class="appr-list">${md.appr.map(it => {
      const st = it.st, r = it.row || {};
      const from = it.dep && it.dep.apt ? F.aptName(it.dep.apt) + " 출발" : "";
      return `<li><button type="button" class="appr-row" data-fo-focus="${esc(it.f.hex)}">
        <span class="ar-id"><b class="mono">${esc(it.fno || it.f.reg)}</b><span>${esc(it.f.reg)} · ${esc(typeName(it))}</span></span>
        <span class="ar-eta"><b class="mono">${esc(F.kstHM(st.eta))}</b><small>${esc(F.until(st.eta, md.now))} 후</small></span>
        <span class="ar-sub">${esc([from, nf(Math.round(st.dHome)) + " km", altTxt(r)].filter(Boolean).join(" · "))}${r.vr != null && r.vr <= -300 ? ' <span class="ar-dn" aria-label="강하 중">' + icon("down", 13) + "</span>" : ""}</span>
      </button></li>`;
    }).join("")}</ol>`;
  }

  /* 최근 인천 도착(12시간) — 접근 목록 아래 */
  function recentArrHTML(md) {
    if (!state.events) return "";
    const list = F.eventsOf(state.events, { kind: "arr", apt: F.HOME, since: md.now - 12 * 3600000 }).slice(0, 4);
    if (!list.length) return "";
    return `<div class="dflt-h dflt-h2"><h3>최근 인천 도착</h3></div><ul class="arr-mini">${list.map(e => {
      const t = Date.parse(e.at);
      const it = md.items.find(x => F.normHex(x.f.hex) === F.normHex(e.hex));
      return `<li><b class="mono">${esc(F.kstHM(t))}</b><span class="mono">${esc(e.flight ? F.fnoOf(e.flight) : "—")}</span><span>${esc(e.reg || (it ? it.f.reg : ""))}</span><small>${esc(F.ago(t, md.now))}</small></li>`;
    }).join("")}</ul>`;
  }

  /* ═════════ 대시보드 ═════════ */
  function dashHTML() {
    const md = model();
    return `<section class="dash-flt" id="dash-flt" aria-label="운항 현황">
      <div class="dc-head"><h2>운항 현황</h2><span class="dc-meta" id="dflt-meta">${esc(updText())}</span>
        <span class="spacer"></span><button type="button" class="link-btn" data-fo-go>전체 보기</button></div>
      <div class="dflt-body">
        <div class="fo-mapwrap dflt-mapwrap">
          <div class="fo-map" id="dflt-map" role="region" aria-label="에어제타 항공기 위치 지도"><div class="fo-map-msg">지도 불러오는 중</div></div>
          <div class="fo-legend" aria-hidden="true">${legendHTML(md)}</div>
          <button type="button" class="fo-fit" data-fo-fit="dash" title="전체 항공기 보기" aria-label="전체 항공기 보기">${icon("grid", 16)}</button>
        </div>
        <aside class="dflt-side" aria-label="인천 접근 중">
          <div class="dflt-h"><h3>인천 접근 중</h3><b class="mono" id="dflt-n">${md.appr.length}</b></div>
          <div id="dflt-appr">${apprListHTML(md)}</div>
          <div id="dflt-arr">${recentArrHTML(md)}</div>
        </aside>
      </div>
    </section>`;
  }
  function wireCommon(box, kind) {
    $$("[data-fo-focus]", box).forEach(b => b.onclick = () => focusAc(kind, b.dataset.foFocus));
    $$("[data-fo-fit]", box).forEach(b => b.onclick = () => fitMap(b.dataset.foFit));
    $$("[data-fo-go]", box).forEach(b => b.onclick = () => SeMIS.navigate(MOD));
  }
  function paintDash() {
    const box = document.getElementById("dash-flt");
    if (!box) return;
    const md = model();
    $("#dflt-meta", box).textContent = updText();
    $("#dflt-n", box).textContent = md.appr.length;
    $("#dflt-appr", box).innerHTML = apprListHTML(md);
    $("#dflt-arr", box).innerHTML = recentArrHTML(md);
    wireCommon(box, "dash");
    paintMap("dash");
  }
  function mountDash() {
    const box = document.getElementById("dash-flt");
    if (!box) return;
    wireCommon(box, "dash");
    mountMap($("#dflt-map", box), "dash");
    load({ events: true }).then(() => paintDash());
    ensureTimer();
  }

  /* ═════════ 운항 현황 화면 ═════════ */
  function statsHTML(md) {
    const day0 = F.kstDayStart(md.now);
    const arr = F.eventsOf(state.events, { kind: "arr", apt: F.HOME, since: day0 });
    const dep = F.eventsOf(state.events, { kind: "dep", apt: F.HOME, since: day0 });
    const flying = md.air.length + md.appr.length + md.emg.length;
    const evSub = (e) => (e ? F.kstHM(Date.parse(e.at)) + " " + (e.flight ? F.fnoOf(e.flight) : e.reg || "") : "");
    return ui.stats([
      { label: "비행 중", value: flying, sub: md.appr.length ? "인천 접근 " + md.appr.length : "" },
      { label: "인천 지상", value: md.gndHome.length },
      { label: "해외 지상", value: md.gndAway.length },
      { label: "신호 없음", value: md.lost.length, tone: md.lost.length ? "muted" : "", sub: md.none.length ? "수신 기록 없음 " + md.none.length : "" },
      { label: "오늘 인천 도착", value: state.events ? arr.length : "-", sub: evSub(arr[0]) },
      { label: "오늘 인천 출발", value: state.events ? dep.length : "-", sub: evSub(dep[0]) }
    ]);
  }
  function alertHTML(md) {
    const bad = md.emg;
    if (!bad.length && !(state.err && !state.ac.length)) return "";
    if (bad.length) return `<div class="fo-alert" role="alert">${icon("alert", 18)}<div>${bad.map(it =>
      `<b>${esc(it.fno || it.f.reg)} · ${esc(it.f.reg)}</b> ${esc(it.st.label)} — ${esc(whereTxt(it))}`).join("<br>")}</div></div>`;
    return `<div class="fo-alert is-soft">${icon("alert", 18)}<div>위치 서버에 연결하지 못했습니다. <button type="button" class="link-btn" data-fo-retry>다시 시도</button></div></div>`;
  }
  function evRow(e, showApt) {
    const t = Date.parse(e.at);
    const it = model().items.find(x => F.normHex(x.f.hex) === F.normHex(e.hex));
    return `<tr><td class="mono fo-t">${esc(F.kstHM(t))}</td>
      <td><b class="mono">${esc(e.flight ? F.fnoOf(e.flight) : "—")}</b></td>
      <td class="mono">${esc(e.reg || (it ? it.f.reg : ""))}</td>
      ${showApt ? `<td>${esc(e.apt ? F.aptName(e.apt) : "공항 미상")}</td>` : ""}
      <td class="fo-note">${e.inferred ? ui.chip("시각 추정", "gray") : ""}</td></tr>`;
  }
  function boardsHTML(md) {
    const day0 = F.kstDayStart(md.now);
    const arr = F.eventsOf(state.events, { kind: "arr", apt: F.HOME, since: day0 });
    const dep = F.eventsOf(state.events, { kind: "dep", apt: F.HOME, since: day0 });
    const waitRows = md.gndHome.slice().sort((a, b) => (a.st.since || 0) - (b.st.since || 0)).map(it => `<tr>
        <td class="mono fo-t">${esc(it.st.since ? F.kstHM(it.st.since) : "—")}</td>
        <td><b class="mono">${esc(it.f.reg)}</b></td><td>${esc(typeName(it))}</td>
        <td class="fo-note">${it.st.live ? "" : ui.chip(F.ago(it.st.seen) + " 수신", "gray")}</td></tr>`).join("");
    const evTable = (list, empty) => list.length
      ? `<table class="tbl fo-tbl"><tbody>${list.map(e => evRow(e, false)).join("")}</tbody></table>`
      : `<p class="fo-none">${esc(empty)}</p>`;
    return `<div class="fo-boards">
      <section class="card fo-board" aria-label="인천 입항">
        <h2 class="card-title">${icon("down", 18)}<span>인천 입항</span></h2>
        <div class="fo-sub"><h3>접근 중</h3><span class="mono">${md.appr.length}</span></div>
        ${apprListHTML(md)}
        <div class="fo-sub"><h3>오늘 도착</h3><span class="mono">${state.events ? arr.length : "-"}</span></div>
        ${state.events ? evTable(arr, "오늘 도착 기록이 없습니다.") : '<p class="fo-none">불러오는 중</p>'}
      </section>
      <section class="card fo-board" aria-label="인천 출항">
        <h2 class="card-title"><span class="fo-up">${icon("down", 18)}</span><span>인천 출항</span></h2>
        <div class="fo-sub"><h3>인천 지상</h3><span class="mono">${md.gndHome.length}</span></div>
        ${waitRows ? `<table class="tbl fo-tbl"><thead><tr><th>도착</th><th>기체</th><th>기종</th><th></th></tr></thead><tbody>${waitRows}</tbody></table>` : '<p class="fo-none">인천에 서 있는 항공기가 없습니다.</p>'}
        <div class="fo-sub"><h3>오늘 출발</h3><span class="mono">${state.events ? dep.length : "-"}</span></div>
        ${state.events ? evTable(dep, "오늘 출발 기록이 없습니다.") : '<p class="fo-none">불러오는 중</p>'}
      </section>
    </div>`;
  }
  function fleetHTML(md) {
    const order = { emg: 0, appr: 1, air: 2, lost: 3, gnd: 4, none: 5 };
    const list = md.items.slice().sort((a, b) => (order[a.st.code] - order[b.st.code]) || a.f.reg.localeCompare(b.f.reg));
    return `<section class="card" aria-label="기체 현황">
      <h2 class="card-title">${icon("grid", 18)}<span>기체 현황</span><span class="spacer"></span><span class="fo-cnt mono">${md.items.length}대</span></h2>
      <div class="table-wrap"><table class="tbl fo-fleet">
        <thead><tr><th>기체</th><th>상태</th><th>편명</th><th>위치</th><th>고도 · 속도</th><th>출발</th><th>수신</th></tr></thead>
        <tbody>${list.map(it => {
          const st = it.st, r = it.row || {};
          const fly = st.code === "air" || st.code === "appr" || st.code === "emg";
          return `<tr data-fo-row="${esc(it.f.hex)}">
            <td class="c-ac"><b class="mono">${esc(it.f.reg)}</b><small>${esc(typeName(it))}</small></td>
            <td class="c-st">${ui.chip(st.label, st.tone)}</td>
            <td class="c-fno mono${it.fno ? "" : " is-empty"}">${esc(it.fno || "—")}</td>
            <td class="c-wh${whereTxt(it) ? "" : " is-empty"}">${esc(whereTxt(it) || "—")}</td>
            <td class="c-alt mono${fly ? "" : " is-empty"}">${fly ? esc([altTxt(r), gsTxt(r)].filter(Boolean).join(" · ")) : "—"}</td>
            <td class="c-dep">${it.dep && (fly || st.code === "lost") ? esc((it.dep.apt ? F.aptName(it.dep.apt) : "공항 미상") + " " + F.kstHM(Date.parse(it.dep.at))) : "—"}</td>
            <td class="c-seen${st.seen ? "" : " is-empty"}">${st.seen ? esc(F.ago(st.seen, md.now)) : "—"}</td></tr>`;
        }).join("")}</tbody></table></div>
    </section>`;
  }
  function logHTML() {
    const list = F.eventsOf(state.events, { since: Date.now() - 48 * 3600000 });
    return `<section class="card" aria-label="입출항 기록">
      <h2 class="card-title">${icon("clipboard", 18)}<span>입출항 기록</span><span class="spacer"></span><span class="fo-cnt">최근 48시간</span></h2>
      ${!state.events ? '<p class="fo-none">불러오는 중</p>' : list.length ? `<div class="table-wrap"><table class="tbl fo-log">
        <thead><tr><th>일시</th><th>구분</th><th>공항</th><th>편명</th><th>기체</th><th></th></tr></thead>
        <tbody>${list.map(e => {
          const t = Date.parse(e.at);
          return `<tr><td class="mono fo-t">${esc(F.kstISO(t).slice(5).replace("-", ".") + " " + F.kstHM(t))}</td>
            <td>${e.kind === "arr" ? ui.chip("도착", "blue") : ui.chip("출발", "green")}</td>
            <td>${esc(e.apt ? F.aptName(e.apt) + " (" + e.apt + ")" : "공항 미상")}</td>
            <td class="mono">${esc(e.flight ? F.fnoOf(e.flight) : "—")}</td>
            <td class="mono">${esc(e.reg || "")}</td>
            <td class="fo-note">${e.inferred ? ui.chip("시각 추정", "gray") : ""}</td></tr>`;
        }).join("")}</tbody></table></div>` : '<p class="fo-none">최근 48시간 입출항 기록이 없습니다.</p>'}
    </section>`;
  }
  function paintPage() {
    const root = document.getElementById("fo-page");
    if (!root) return;
    const md = model();
    $("#fo-upd").textContent = updText();
    $("#fo-alertbox", root).innerHTML = alertHTML(md);
    $("#fo-stats", root).innerHTML = statsHTML(md);
    $("#fo-boardbox", root).innerHTML = boardsHTML(md);
    $("#fo-fleetbox", root).innerHTML = fleetHTML(md);
    $("#fo-logbox", root).innerHTML = logHTML();
    wireCommon(root, "full");
    $$("[data-fo-row]", root).forEach(tr => tr.onclick = () => {
      const mp = document.getElementById("fo-map");
      if (mp && mp.scrollIntoView) mp.scrollIntoView({ behavior: "smooth", block: "center" });
      focusAc("full", tr.dataset.foRow);
    });
    const rt = $("[data-fo-retry]", root);
    if (rt) rt.onclick = () => refresh(true);
    const leg = root.querySelector(".fo-legend");
    if (leg) leg.innerHTML = legendHTML(md);
    paintMap("full");
  }
  async function refresh(force) {
    const btn = document.getElementById("fo-refresh");
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    const onPage = !!document.getElementById("fo-page");
    await load({ trail: onPage, events: true, force: !!force });
    if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    paintPage(); paintDash();
  }
  function render(root) {
    const canEdit = SeMIS.canEdit();
    root.innerHTML = ui.head({
      title: TITLE,
      meta: "에어제타 화물기 " + fleet().length + "대 · ADS-B 실시간",
      actions: `<span class="fo-upd" id="fo-upd">${esc(updText())}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="fo-refresh" title="위치 다시 읽기">${icon("refresh", 16)}<span>새로고침</span></button>
        ${canEdit ? `<button type="button" class="btn btn-ghost btn-sm" id="fo-fleet-edit">${icon("sliders", 16)}<span>기체 목록</span></button>` : ""}`
    }) + `<div id="fo-page">
      <div id="fo-alertbox"></div>
      <div id="fo-stats"></div>
      <section class="card fo-mapcard" aria-label="항공기 위치">
        <div class="fo-mapwrap">
          <div class="fo-map fo-map-full" id="fo-map" role="region" aria-label="에어제타 항공기 위치 지도"><div class="fo-map-msg">지도 불러오는 중</div></div>
          <div class="fo-legend" aria-hidden="true"></div>
          <button type="button" class="fo-fit" data-fo-fit="full" title="전체 항공기 보기" aria-label="전체 항공기 보기">${icon("grid", 16)}</button>
        </div>
      </section>
      <div id="fo-boardbox"></div>
      <div id="fo-fleetbox"></div>
      <div id="fo-logbox"></div>
    </div>`;
    $("#fo-refresh", root).onclick = () => refresh(true);
    const fe = $("#fo-fleet-edit", root);
    if (fe) fe.onclick = fleetModal;
    paintPage();
    mountMap($("#fo-map", root), "full");
    load({ trail: true, events: true }).then(() => { paintPage(); });
    ensureTimer();
  }

  /* 1분마다 — 운항 현황 · 대시보드를 보고 있고 탭이 보일 때만 */
  let timer = 0;
  function ensureTimer() {
    if (timer || typeof setInterval === "undefined") return;
    timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      const onPage = !!document.getElementById("fo-page"), onDash = !!document.getElementById("dash-flt");
      if (!onPage && !onDash) return;
      load({ trail: onPage, events: true, force: true }).then(() => { paintPage(); paintDash(); });
    }, REFRESH_MS);
  }
  /* 다른 탭에 있다 돌아오면 바로 갱신 */
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (!document.getElementById("fo-page") && !document.getElementById("dash-flt")) return;
    if (Date.now() - state.ts > REFRESH_MS) refresh(false);
  });

  /* ═════════ 기체 목록 편집 (hq) ═════════ */
  function fleetModal() {
    let rows = fleet().map(f => Object.assign({}, f));
    const rowHTML = (f, i) => `<div class="fl-row" data-i="${i}">
      <input class="fl-reg mono" value="${esc(f.reg)}" placeholder="HL7421" aria-label="등록부호" maxlength="8">
      <input class="fl-hex mono" value="${esc(f.hex)}" placeholder="71bc21" aria-label="ICAO 주소(16진수 6자리)" maxlength="6">
      <select class="fl-type" aria-label="기종">${TYPES.concat(TYPES.indexOf(f.type) < 0 && f.type ? [f.type] : []).map(t => `<option value="${esc(t)}"${t === f.type ? " selected" : ""}>${esc(F.AC_TYPES[t] || t)}</option>`).join("")}</select>
      <input class="fl-model" value="${esc(f.model || "")}" placeholder="747-400F" aria-label="형식">
      <button type="button" class="mt-btn danger" data-fl-del="${i}" title="삭제" aria-label="삭제">${icon("x", 16)}</button></div>`;
    const paint = () => {
      $("#fl-list").innerHTML = rows.map(rowHTML).join("");
      $$("#fl-list .fl-reg").forEach(inp => inp.oninput = () => {
        const row = inp.closest(".fl-row"), hx = $(".fl-hex", row);
        const auto = F.hlHex(inp.value);
        if (auto && (!hx.value || hx.dataset.auto === "1" || F.hlHex(rows[+row.dataset.i].reg) === hx.value)) { hx.value = auto; hx.dataset.auto = "1"; }
      });
      $$("#fl-list [data-fl-del]").forEach(b => b.onclick = () => { collect(); rows.splice(+b.dataset.flDel, 1); paint(); });
    };
    const collect = () => {
      rows = $$("#fl-list .fl-row").map(r => ({
        reg: $(".fl-reg", r).value.trim().toUpperCase(), hex: F.normHex($(".fl-hex", r).value).slice(0, 6),
        type: $(".fl-type", r).value, model: $(".fl-model", r).value.trim()
      }));
    };
    openModal(`<h3>기체 목록</h3>
      <div class="fl-head"><span>등록부호</span><span>ICAO 주소 ${ui.tip("트랜스폰더 고유 주소(16진수 6자리). HL74xx·HL75xx·HL76xx·HL8xxx는 등록부호를 넣으면 자동으로 채워진다.", "ICAO 주소 설명")}</span><span>기종</span><span>형식</span><span></span></div>
      <div id="fl-list" class="fl-list"></div>
      <div class="fl-foot"><button type="button" class="btn btn-soft btn-sm" id="fl-add">${icon("plus", 16)}<span>기체 추가</span></button>
        <button type="button" class="link-btn" id="fl-reset">기본값(15대)</button></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="fl-cancel">취소</button><button type="button" class="btn btn-primary" id="fl-save">저장</button></div>`, { wide: true });
    paint();
    $("#fl-add").onclick = () => { collect(); rows.push({ reg: "", hex: "", type: "B744", model: "" }); paint(); const r = $$("#fl-list .fl-reg"); if (r.length) r[r.length - 1].focus(); };
    $("#fl-reset").onclick = () => { rows = F.DEFAULT_FLEET.map(f => Object.assign({}, f)); paint(); };
    $("#fl-cancel").onclick = closeModal;
    $("#fl-save").onclick = () => {
      collect();
      const list = rows.filter(r => r.reg || r.hex);
      const bad = list.find(r => !/^[A-Z0-9-]{3,8}$/.test(r.reg) || !/^[0-9a-f]{6}$/.test(r.hex));
      if (bad) { toast((bad.reg || "빈 칸") + " — 등록부호와 ICAO 주소(16진수 6자리)를 확인하세요."); return; }
      const dup = list.find((r, i) => list.findIndex(x => x.hex === r.hex) !== i);
      if (dup) { toast(dup.reg + " — ICAO 주소가 겹칩니다."); return; }
      if (!list.length) { toast("기체를 한 대 이상 두어야 합니다."); return; }
      SeMIS.data.fleet = list;
      SeMIS.save();
      closeModal();
      toast("기체 목록을 저장했습니다. 다음 갱신부터 반영됩니다.");
      paintPage(); paintDash();
    };
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const n = model().appr.length; return n || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "plane", module: MOD,
    items: () => fleet().map(f => ({ title: f.reg, sub: (F.AC_TYPES[f.type] || f.type) + " · " + (f.model || ""), route: MOD }))
  });

  window.SemisFlight = { dashHTML, mountDash, paintDash, load, model, state, refresh, fleet };
})();
