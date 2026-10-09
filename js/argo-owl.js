/* 아르고 — 밤새 터미널을 지키는 부엉이 경비대원. 큰 자리(48px 이상)는 로우폴리 3D(Three.js, 첫 사용 때 지연 로드),
   작은 자리 · WebGL 없음 · 동작 줄이기 · 느린 GPU는 같은 모양의 정적 SVG. 화면 밖 · 숨은 탭에서는 렌더를 멈춘다.
   SemisOwl.mount(el, { size, state }) → { set(state), destroy() } / SemisOwl.svg(state, size) / 상태: idle · thinking · happy · alert */
"use strict";

window.SemisOwl = (() => {
  const STATES = ["idle", "thinking", "happy", "alert"];
  const MIN_3D = 48;
  const THREE_URL = "assets/vendor/three.module.min.js?v=r170";
  const C = {
    ink: "#0b1f26", cap: "#0b1f26", capTop: "#17343d", visor: "#06141a", band: "#0f766e", bandAlert: "#b42318",
    body: "#24596a", bodyShade: "#1d4b59", wing: "#163c47", wingShade: "#12333d", tuft: "#2a6676", tuftShade: "#215463",
    belly: "#e7efea", bellyShade: "#d7e3dd", chev: "#a9c0b8", disc: "#eef5f1", discShade: "#e3ede8",
    iris: "#f5a524", irisAlert: "#f97316", beak: "#f2a62a", beakShade: "#d48912", badge: "#f5a524"
  };
  const normState = (s) => (STATES.indexOf(s) >= 0 ? s : "idle");

  /* ── 정적 SVG (64 × 64) ── */
  function svg(state, size, label) {
    state = normState(state);
    const z = Math.round(Number(size) || 40);
    const P = (pts, f) => '<polygon points="' + pts + '" fill="' + f + '"/>';
    const happy = state === "happy", think = state === "thinking", alert = state === "alert";
    const px = think ? -1.4 : 0, py = think ? -1.6 : 0, pr = alert ? 2.3 : 3.3;
    const eye = (cx) => happy
      ? '<path d="M' + (cx - 4.6) + ' 32.2q4.6-4.8 9.2 0" fill="none" stroke="' + C.ink + '" stroke-width="2.2" stroke-linecap="round"/>'
      : '<circle cx="' + cx + '" cy="31" r="5.9" fill="' + (alert ? C.irisAlert : C.iris) + '"/>' +
        '<circle cx="' + (cx + px) + '" cy="' + (31 + py) + '" r="' + pr + '" fill="' + C.ink + '"/>' +
        '<circle cx="' + (cx + px + 1.5) + '" cy="' + (29.5 + py) + '" r="1.15" fill="#fff"/>';
    return '<svg class="owl-svg" width="' + z + '" height="' + z + '" viewBox="0 0 64 64" data-state="' + state + '"' +
      (label ? ' role="img" aria-label="' + String(label).replace(/[<>&"]/g, "") + '"' : ' aria-hidden="true"') + ' focusable="false">' +
      P("15,21 10.5,13.5 19.5,18", C.tuft) + P("49,21 53.5,13.5 44.5,18", C.tuftShade) +
      P("20,22 44,22 50,30 52,42 48,54 40,60 24,60 16,54 12,42 14,30", C.body) +
      P("32,22 44,22 50,30 52,42 48,54 40,60 32,60", C.bodyShade) +
      P("13.5,33 10.5,45 15,56 21,51 19.5,38", C.wing) + P("50.5,33 53.5,45 49,56 43,51 44.5,38", C.wingShade) +
      P("32,37.5 40.5,41 42,50 37,58 27,58 22,50 23.5,41", C.belly) + P("32,37.5 40.5,41 42,50 37,58 32,58", C.bellyShade) +
      '<path d="M27.5 45.5l2 1.8 2-1.8M32.5 45.5l2 1.8 2-1.8M30 50.5l2 1.8 2-1.8" fill="none" stroke="' + C.chev +
        '" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="24" cy="31" r="9.6" fill="' + C.disc + '"/><circle cx="40" cy="31" r="9.6" fill="' + C.discShade + '"/>' +
      eye(24) + eye(40) +
      P("29.8,35.4 34.2,35.4 32,40.8", C.beak) + P("32,35.4 34.2,35.4 32,40.8", C.beakShade) +
      P("26,59.5 28,62.5 30,59.5", C.beak) + P("34,59.5 36,62.5 38,59.5", C.beak) +
      P("17,21.5 19.5,9 32,6 44.5,9 47,21.5", C.cap) + P("19.5,9 32,6 44.5,9 32,11.5", C.capTop) +
      P("17,17 47,17 47,21.6 17,21.6", alert ? C.bandAlert : C.band) +
      P("15.5,21.4 48.5,21.4 44.5,25.6 19.5,25.6", C.visor) +
      P("32,10.2 35.6,11.4 35.2,14.6 32,16.4 28.8,14.6 28.4,11.4", C.badge) +
      '</svg>';
  }

  /* ── 3D ── */
  const S = { T: null, loading: null, failed: false, slow: false, r: null, scene: null, cam: null, rig: null, parts: null,
    dim: 0, list: [], raf: 0, last: 0, cost: [], io: null };
  const env = () => typeof window !== "undefined" && typeof document !== "undefined";
  function webglOK() {
    if (!env() || typeof window.WebGLRenderingContext === "undefined") return false;
    if (/jsdom/i.test((navigator && navigator.userAgent) || "")) return false;
    return true;
  }
  const reduce = () => !!(env() && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const want3D = (size) => size >= MIN_3D && !S.failed && !S.slow && webglOK() && !reduce();
  function load() {
    if (S.T) return Promise.resolve(S.T);
    if (!S.loading) {
      const url = new URL(THREE_URL, document.baseURI).href;
      S.loading = import(url).then(m => (S.T = m)).catch(e => { S.loading = null; throw e; });
    }
    return S.loading;
  }

  function build(T) {
    const hex = (s) => new T.Color(s);
    const mat = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: hex(c), roughness: 0.78, metalness: 0, flatShading: true }, o || {}));
    const M = {
      body: mat(C.body), wing: mat(C.wing), tuft: mat(C.tuft), belly: mat(C.belly), disc: mat(C.disc),
      iris: mat(C.iris, { roughness: 0.45 }), irisAlert: mat(C.irisAlert, { roughness: 0.45 }), pupil: mat(C.ink, { roughness: 0.3 }),
      glint: new T.MeshBasicMaterial({ color: 0xffffff }), beak: mat(C.beak), cap: mat(C.cap, { roughness: 0.6 }),
      band: mat(C.band), bandAlert: mat(C.bandAlert), visor: mat(C.visor, { roughness: 0.35 }),
      badge: mat(C.badge, { roughness: 0.35, metalness: 0.25, emissive: hex("#3a2300") })
    };
    const add = (par, geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); par.add(o); return o; };
    const rig = new T.Group();                 // 몸 전체(뛰기 · 기울이기)
    const head = new T.Group();                // 얼굴 · 모자(갸웃)
    head.position.y = 0.5;
    rig.add(head);
    const body = add(rig, new T.IcosahedronGeometry(1, 1), M.body, 0, -0.25, 0);
    body.scale.set(1, 1.18, 0.9);
    const belly = add(rig, new T.IcosahedronGeometry(0.72, 1), M.belly, 0, -0.45, 0.5);
    belly.scale.set(0.95, 1.05, 0.55);
    const wings = [-1, 1].map(s => {
      const pivot = new T.Group();
      pivot.position.set(s * 0.78, 0.05, -0.05);
      rig.add(pivot);
      const w = add(pivot, new T.IcosahedronGeometry(0.55, 0), M.wing, s * 0.16, -0.38, 0);
      w.scale.set(0.45, 1.05, 0.82);
      w.rotation.z = -s * 0.18;
      return pivot;
    });
    [-1, 1].forEach(s => {
      const f = add(rig, new T.ConeGeometry(0.075, 0.2, 4), M.beak, s * 0.24, -1.38, 0.5);
      f.rotation.x = Math.PI / 2;
    });
    /* 얼굴 — head 기준 좌표(y 0 = 눈 높이 근처) */
    const eyes = [-1, 1].map(s => {
      const disc = add(head, new T.CylinderGeometry(0.42, 0.42, 0.1, 10), M.disc, s * 0.36, -0.16, 0.7);
      disc.rotation.set(Math.PI / 2, 0, 0);
      disc.rotation.y = s * 0.2;
      const g = new T.Group();
      g.position.set(s * 0.36, -0.16, 0.79);
      head.add(g);
      const iris = add(g, new T.SphereGeometry(0.25, 14, 10), M.iris, 0, 0, 0);
      iris.scale.z = 0.55;
      const pupil = add(g, new T.SphereGeometry(0.135, 12, 8), M.pupil, 0, 0, 0.1);
      pupil.scale.z = 0.6;
      const glint = add(g, new T.SphereGeometry(0.045, 8, 6), M.glint, 0.07, 0.07, 0.19);
      const arc = add(head, new T.TorusGeometry(0.17, 0.035, 6, 14, Math.PI), M.pupil, s * 0.36, -0.2, 0.84);
      arc.visible = false;
      return { g, iris, pupil, glint, arc };
    });
    const beak = add(head, new T.ConeGeometry(0.1, 0.3, 4), M.beak, 0, -0.4, 0.86);
    beak.rotation.set(Math.PI + 0.25, Math.PI / 4, 0);
    [-1, 1].forEach(s => {
      const t = add(head, new T.ConeGeometry(0.13, 0.42, 4), M.tuft, s * 0.74, 0.32, 0.02);
      t.rotation.z = -s * 0.62;
    });
    const crown = add(head, new T.CylinderGeometry(0.64, 0.78, 0.5, 8), M.cap, 0, 0.56, -0.02);
    crown.rotation.y = Math.PI / 8;
    const band = add(head, new T.CylinderGeometry(0.795, 0.805, 0.13, 8), M.band, 0, 0.36, -0.02);
    band.rotation.y = Math.PI / 8;
    const visor = add(head, new T.CylinderGeometry(0.66, 0.66, 0.045, 14, 1, false, -Math.PI / 2, Math.PI), M.visor, 0, 0.31, 0.32);
    visor.rotation.x = 0.2;
    const badge = add(head, new T.CylinderGeometry(0.13, 0.13, 0.05, 6), M.badge, 0, 0.6, 0.72);
    badge.rotation.set(Math.PI / 2 - 0.14, 0, Math.PI / 6);
    rig.position.y = 0.05;
    return { rig, head, wings, eyes, band, badge, M };
  }

  function initGL(T) {
    if (S.r) return true;
    try {
      const r = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: false });
      r.setClearColor(0x000000, 0);
      r.autoClear = false;
      if ("outputColorSpace" in r && T.SRGBColorSpace) r.outputColorSpace = T.SRGBColorSpace;
      const scene = new T.Scene();
      scene.add(new T.HemisphereLight(0xe6f4f1, 0x0b1f26, 1.35));
      const key = new T.DirectionalLight(0xffffff, 1.9); key.position.set(-2.2, 3, 4); scene.add(key);
      const rim = new T.DirectionalLight(0x5eead4, 0.9); rim.position.set(3, 1.5, -3); scene.add(rim);
      const cam = new T.PerspectiveCamera(26, 1, 0.1, 50);
      cam.position.set(0, 0.35, 7.2);
      cam.lookAt(0, -0.08, 0);
      S.parts = build(T);
      scene.add(S.parts.rig);
      Object.assign(S, { r, scene, cam });
      const cv = r.domElement;
      cv.addEventListener("webglcontextlost", (e) => { e.preventDefault(); S.failed = true; downgradeAll(); });
      return true;
    } catch (e) { S.failed = true; return false; }
  }

  /* 상태별 자세 — t: 초, since: 상태가 바뀐 뒤 초 */
  function pose(inst, t) {
    const P = S.parts, st = inst.state, since = t - inst.since;
    const blinkPhase = (t + inst.seed) % 4.2;
    let blink = blinkPhase < 0.14 ? 1 - Math.abs(blinkPhase - 0.07) / 0.07 : 0;
    let tilt = 0, yaw = 0.16 * Math.sin(t * 0.45 + inst.seed), hop = 0, flap = 0, look = [0, 0], pupil = 1, shake = 0;
    const breathe = 1 + 0.018 * Math.sin(t * 2.1 + inst.seed);
    if (st === "idle") {
      const k = Math.sin(t * 0.6 + inst.seed * 2);
      tilt = 0.14 * Math.sign(k) * Math.pow(Math.abs(k), 6);
    } else if (st === "thinking") {
      tilt = 0.2; yaw = -0.18 + 0.06 * Math.sin(t * 0.9);
      look = [-0.05, 0.07];
      hop = 0.025 * Math.sin(t * 3);
    } else if (st === "happy") {
      blink = 0;
      const e = Math.max(0, 1 - since / 1.6);
      hop = 0.16 * Math.abs(Math.sin(t * 6)) * e;
      flap = 0.5 * Math.sin(t * 14) * e + 0.12;
      yaw = 0.1 * Math.sin(t * 0.8);
    } else if (st === "alert") {
      blink = 0; pupil = 0.62; yaw = 0;
      shake = 0.07 * Math.sin(t * 26) * Math.max(0, 1 - since / 0.9);
    }
    P.rig.position.y = 0.05 + hop;
    P.rig.scale.set(1, breathe, 1);
    P.rig.rotation.set(0, yaw, shake);
    P.head.rotation.set(0, 0, tilt);
    P.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * flap; });
    const happy = st === "happy";
    P.eyes.forEach(E => {
      E.g.visible = !happy; E.arc.visible = happy;
      E.g.scale.set(1, Math.max(0.08, 1 - blink), 1);
      E.iris.material = st === "alert" ? P.M.irisAlert : P.M.iris;
      E.pupil.position.set(look[0], look[1], 0.1);
      E.pupil.scale.set(pupil, pupil, 0.6 * pupil);
      E.glint.position.set(0.07 + look[0], 0.07 + look[1], 0.19);
    });
    P.band.material = st === "alert" ? P.M.bandAlert : P.M.band;
  }

  /* ── 인스턴스 · 렌더 루프 ── */
  const dpr = () => Math.min(2, (env() && window.devicePixelRatio) || 1);
  function frame(now) {
    S.raf = 0;
    if (!S.r || document.hidden) return;
    S.list = S.list.filter(i => !i.dead && i.el._owl === i && i.el.isConnected && i.mode === "3d");
    const live = S.list.filter(i => i.vis);
    if (!live.length) return;
    if (now - S.last >= 33) {
      S.last = now;
      const t0 = performance.now(), t = now / 1000;
      const need = Math.max.apply(null, live.map(i => i.px));
      if (need > S.dim) { S.dim = need; S.r.setSize(need, need, false); }
      const cv = S.r.domElement;
      live.forEach(i => {
        pose(i, t);
        S.r.setViewport(0, 0, i.px, i.px);
        S.r.setScissor(0, 0, i.px, i.px);
        S.r.setScissorTest(true);
        S.r.clear();
        S.r.render(S.scene, S.cam);
        i.ctx.clearRect(0, 0, i.px, i.px);
        i.ctx.drawImage(cv, 0, S.dim - i.px, i.px, i.px, 0, 0, i.px, i.px);
      });
      S.cost.push(performance.now() - t0);
      if (S.cost.length > 30) S.cost.shift();
      if (S.cost.length === 30 && S.cost.reduce((a, b) => a + b, 0) / 30 > 28) { S.slow = true; downgradeAll(); return; }
    }
    S.raf = requestAnimationFrame(frame);
  }
  function kick() { if (!S.raf && S.r && env() && !document.hidden) S.raf = requestAnimationFrame(frame); }
  function observer() {
    if (S.io || typeof IntersectionObserver === "undefined") return S.io;
    S.io = new IntersectionObserver(es => {
      es.forEach(e => { const i = e.target._owl; if (i) i.vis = e.isIntersecting; });
      kick();
    });
    return S.io;
  }
  function toSvg(inst) {
    inst.mode = "svg";
    if (S.io) try { S.io.unobserve(inst.el); } catch (e) { /* 이미 해제 */ }
    inst.el.innerHTML = svg(inst.state, inst.size);
    inst.el.dataset.owl = "svg";
  }
  function downgradeAll() { S.list.forEach(toSvg); S.list = []; }
  function upgrade(inst) {
    if (inst.dead || !inst.el.isConnected || !want3D(inst.size) || !initGL(S.T)) return;
    const px = Math.round(inst.size * dpr());
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = px;
    cv.className = "owl-3d";
    cv.setAttribute("aria-hidden", "true");
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    Object.assign(inst, { mode: "3d", px, ctx, vis: true });
    inst.el.replaceChildren(cv);
    inst.el.dataset.owl = "3d";
    S.list.push(inst);
    const io = observer();
    if (io) io.observe(inst.el);
    kick();
  }

  function mount(el, o) {
    if (!el) return null;
    o = o || {};
    if (el._owl) el._owl.dead = true;
    const size = Math.max(16, Math.round(Number(o.size) || 40));
    const inst = { el, size, state: normState(o.state), since: 0, seed: Math.random() * 6, mode: "svg", vis: true, dead: false };
    inst.since = env() && typeof performance !== "undefined" ? performance.now() / 1000 : 0;
    el._owl = inst;
    el.classList.add("owl");
    el.style.width = size + "px"; el.style.height = size + "px";
    toSvg(inst);
    if (want3D(size)) load().then(() => upgrade(inst)).catch(() => { S.failed = true; });
    return {
      el,
      get mode() { return inst.mode; },
      get state() { return inst.state; },
      set(s) { setState(el, s); },
      destroy() { inst.dead = true; S.list = S.list.filter(x => x !== inst); if (S.io) try { S.io.unobserve(el); } catch (e) { /* noop */ } el._owl = null; }
    };
  }
  function setState(el, s) {
    const inst = el && el._owl;
    if (!inst) return;
    s = normState(s);
    if (inst.state === s) return;
    inst.state = s;
    inst.since = typeof performance !== "undefined" ? performance.now() / 1000 : 0;
    if (inst.mode === "svg") inst.el.innerHTML = svg(s, inst.size);
    else kick();
  }

  if (env()) document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });

  return { svg, mount, set: setState, STATES, MIN_3D, get state() { return { failed: S.failed, slow: S.slow, live: S.list.length }; } };
})();
