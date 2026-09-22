/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 대시보드 3D 장면 (v1.9)
   에어제타 B747-400F(흰 동체 · AIRZETA · 파란 꼬리 · 빨간 윙렛)가 기수 화물문을 들어 올리고
   로더가 긴 화물(목재 상자 · 헬기 동체)을 번갈아 싣는 장면을 로우폴리로 그린다. (v1.10.2)
   - Three.js r170 (assets/vendor, 대시보드에 처음 들어올 때만 지연 로드)
   - 캔버스 하나를 계속 재사용: 대시보드가 다시 그려지면 새 자리로 옮겨 붙인다
   - 화면 밖·다른 탭·다른 화면에서는 렌더링을 멈춘다
   - prefers-reduced-motion: 정지 화면 한 장만 그린다
   - WebGL이 없으면 사진(assets/img/dusk-wide.webp)으로 대체
   ═══════════════════════════════════════════════════════ */
"use strict";

window.SemisHero3D = (() => {
  const S = {
    T: null, loading: null, failed: false,
    renderer: null, scene: null, camera: null, canvas: null, host: null,
    rig: null, running: false, visible: true, raf: 0,
    ptr: { x: 0, y: 0, cx: 0, cy: 0 }, io: null, ro: null, reduce: false, t0: 0, last: 0
  };

  function webglOK() {
    if (typeof window === "undefined" || typeof window.WebGLRenderingContext === "undefined") return false;
    if (/jsdom/i.test(navigator.userAgent || "")) return false;
    return true;
  }
  /* 대체 사진으로 바꾸고 이유를 남긴다 (host.dataset.h3d / SemisHero3D.state.reason) */
  function fallback(host, reason) {
    S.reason = reason || S.reason || "unknown";
    if (!host) return;
    host.classList.add("h3d-fallback");
    host.classList.remove("h3d-on");
    host.dataset.h3d = S.reason;
  }
  /* 파일 주소에 버전을 붙여 배포 직후 CDN에 남은 옛 응답(404)을 피한다.
     불러오기 실패는 일시적일 수 있으므로 영구 실패로 두지 않고 다음 대시보드 진입 때 다시 시도한다. */
  const THREE_URL = "assets/vendor/three.module.min.js?v=r170";
  /* 동체 글자(AIRZETA)를 캔버스에 그리기 전에 글꼴을 기다린다(최대 1.5초) */
  function fontReady() {
    try {
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      return Promise.race([
        document.fonts.load('700 64px "IBM Plex Sans KR"').catch(() => null),
        new Promise(r => setTimeout(r, 1500))
      ]);
    } catch (err) { return Promise.resolve(); }
  }
  function loadThree() {
    if (S.T) return Promise.resolve(S.T);
    if (!S.loading) {
      const url = new URL(THREE_URL, document.baseURI).href;
      S.loading = import(url).then(m => (S.T = m)).catch(err => { S.loading = null; S.reason = "load"; throw err; });
    }
    return S.loading;
  }

  /* ─────────── 장면: 에어제타 B747-400F 기수 화물문 탑재 ───────────
     단위 1 = 약 3.4m. 기수 = +X, 우현(카메라 쪽) = +Z.
     실측 비율: 전장 70.6m(20.6) · 날개폭 64.4m(18.9) · 꼬리 높이 19.4m(5.7) · 동체 지름 6.5m(1.9)
     도장: 흰 동체 + 전방 동체 "AIRZETA"(남색) + 파란 꼬리·후방 동체 + 빨간 윙렛 + 꼬리 로고 */
  const AZ = { white: "#f3f5f6", navy: "#27348b", blue: "#22379a", red: "#e23a3f" };
  const hex = (s) => parseInt(s.slice(1), 16);

  /* 동체 도장 텍스처 — u = 길이(꼬리→기수), v = 둘레(0 아래 · .25 좌현 · .5 위 · .75 우현) */
  function liveryCanvas(xmin, xmax, R) {
    const L = xmax - xmin, C = 2 * Math.PI * R;
    const W = 2048, H = Math.round(W * C / L / 8) * 8, px = W / L;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const X = (x) => (x - xmin) * px;
    g.fillStyle = AZ.white; g.fillRect(0, 0, W, H);
    // 후방 동체 파란 도장 — 위(수직꼬리 앞전)에서 아래로 갈수록 뒤로 물러나는 곡선
    g.fillStyle = AZ.blue;
    g.beginPath(); g.moveTo(0, 0);
    for (let i = 0; i <= 96; i++) {
      const y = i / 96 * H, d = Math.abs(y - 0.5 * H) / (0.5 * H);
      g.lineTo(X(-5.35 - 2.5 * Math.pow(d, 1.35)), y);
    }
    g.lineTo(0, H); g.closePath(); g.fill();
    // 회사 이름 — 우현은 그대로, 좌현은 180° 돌려 그려야 바르게 읽힌다
    const word = (cy, flip) => {
      g.save();
      g.translate(X(3.55), cy);
      if (flip) g.rotate(Math.PI);
      const size = 0.98 * px;
      g.font = "700 " + size + 'px "IBM Plex Sans KR", "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif';
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = AZ.navy;
      const letters = "AIRZETA".split(""), gap = 0.2 * size;
      const ws = letters.map(ch => g.measureText(ch).width);
      const total = ws.reduce((a, b) => a + b, 0) + gap * (letters.length - 1);
      const sx = Math.min(1.25, (6.5 * px) / total);           // 글자 길이 약 6.5(22m)로 맞춤
      g.scale(sx, 1);
      let x = -total / 2;
      letters.forEach((ch, i) => { g.fillText(ch, x + ws[i] / 2, 0); x += ws[i] + gap; });
      g.restore();
    };
    word(0.75 * H - 0.16 * px, false);
    word(0.25 * H + 0.16 * px, true);
    // 앞쪽 승무원 출입문(R1 · L1) 윤곽
    g.strokeStyle = "#c3ccd0"; g.lineWidth = Math.max(1.5, px * 0.02);
    [[0.75 * H - 0.12 * px], [0.25 * H + 0.12 * px]].forEach(([cy]) => {
      const w = 0.3 * px, h = 0.58 * px, x0 = X(7.2) - w / 2, y0 = cy - h / 2, r = w * 0.35;
      g.beginPath();
      g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, r); g.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
      g.arcTo(x0, y0 + h, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath(); g.stroke();
    });
    return cv;
  }
  /* 회사 로고 — 제공받은 로고 이미지를 윤곽 추출한 좌표(0~1). 빨강 위 · 파랑 아래 조각이 엇갈린 계단형.
     파란 꼬리 위에서는 파랑 조각을 흰색으로(실기 도장과 같음) */
  const LOGO_RED = [[0.846, 0.151], [0.613, 0.151], [0.109, 0.551], [0.372, 0.551], [0.372, 0.389], [0.65, 0.389]];
  const LOGO_BLUE = [[0.861, 0.418], [0.673, 0.418], [0.673, 0.632], [0.395, 0.632], [0.126, 0.879], [0.524, 0.879]];
  const LOGO_C = { red: "#df4552", blue: "#1b3088" };
  function drawLogo(g, size, lower) {
    const poly = (pts, c) => {
      g.fillStyle = c; g.beginPath();
      pts.forEach(([x, y], i) => i ? g.lineTo((x - 0.5) * size, (y - 0.515) * size) : g.moveTo((x - 0.5) * size, (y - 0.515) * size));
      g.closePath(); g.fill();
    };
    poly(LOGO_RED, LOGO_C.red);
    poly(LOGO_BLUE, lower);
  }
  function tailLogoCanvas() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const g = cv.getContext("2d");
    g.translate(128, 128);
    drawLogo(g, 256, "#ffffff");
    return cv;
  }
  /* 기수(화물문) 도장 — 흰색 + 아래쪽 옆면 로고. 문을 들어 올린 상태에서 똑바로 보이도록 들어 올린 각도만큼 미리 돌려 그린다 */
  function visorCanvas(len, R, rLogo, uLogo, angle) {
    const C = 2 * Math.PI * R, px = 180;
    const W = Math.round(len * px), H = Math.round(C * px);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.fillStyle = AZ.white; g.fillRect(0, 0, W, H);
    const size = 0.46 * px, squash = R / rLogo;           // 기수 끝으로 갈수록 둘레가 짧아지는 만큼 세로를 늘려 그림
    [[0.75 + 0.1, angle, 1], [0.25 - 0.1, Math.PI - angle, -1]].forEach(([v, rot]) => {
      g.save();
      g.translate(uLogo * W, v * H);
      g.scale(1, squash);
      g.rotate(rot);
      drawLogo(g, size, LOGO_C.blue);
      g.restore();
    });
    return cv;
  }
  /* 팔레트 화물 그물 텍스처 */
  function netCanvas() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "#b9966a"; g.fillRect(0, 0, 128, 128);
    g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
    g.strokeStyle = "#3b2b1c"; g.lineWidth = 3;
    for (let i = -128; i <= 256; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
      g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke();
    }
    return cv;
  }
  function apronCanvas() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "#10303a"; g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#16404b"; g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128);
    return cv;
  }

  function build(T, aniso) {
    const scene = new T.Scene();
    scene.fog = new T.Fog(0x0f2a33, 44, 95);
    const tex = (cv, o) => {
      const t = new T.CanvasTexture(cv);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = aniso || 4;
      Object.assign(t, o || {});
      return t;
    };

    const M = (color, o) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, o || {}));
    const MB = (color) => new T.MeshBasicMaterial({ color });
    const R = 0.95, CY = 1.86;                       // 동체 반지름 · 중심 높이
    const XT = -10.4, XN = 9.62, NX = 8.0;           // 꼬리 끝 · 기수 끝 · 기수 화물문 경계 (기수 길이 1.62 ≈ 5.5m)
    const livery = tex(liveryCanvas(XT, NX, R), { flipY: false });
    const apron = tex(apronCanvas(), { wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping });
    apron.repeat.set(45, 30);
    const net = tex(netCanvas(), { wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping });
    net.repeat.set(2, 1);
    const mat = {
      body: M(0xffffff, { map: livery, roughness: 0.38, metalness: 0.08, side: T.DoubleSide }),
      white: M(hex(AZ.white), { roughness: 0.38, metalness: 0.08 }),
      visor: null,
      wing: M(0xdde3e5, { roughness: 0.42, metalness: 0.22 }),
      tail: M(hex(AZ.blue), { roughness: 0.4, metalness: 0.1 }),
      red: M(hex(AZ.red), { roughness: 0.45 }),
      logo: new T.MeshStandardMaterial({ map: tex(tailLogoCanvas()), transparent: true, alphaTest: 0.4, roughness: 0.45 }),
      nacelle: M(0xeef1f2, { roughness: 0.3, metalness: 0.2 }),
      lip: M(0xc9d0d4, { roughness: 0.22, metalness: 0.85 }),
      core: M(0x7d878c, { roughness: 0.4, metalness: 0.6 }),
      intake: M(0x0b1418, { roughness: 0.5, metalness: 0.5 }),
      glass: M(0x0b1f26, { roughness: 0.12, metalness: 0.7 }),
      gear: M(0x2b3a40, { roughness: 0.7 }),
      tyre: M(0x151d20, { roughness: 0.9 }),
      hold: new T.MeshStandardMaterial({ color: 0x1a1612, emissive: 0x5a3c12, emissiveIntensity: 0.6, roughness: 0.9 }),
      floor: new T.MeshStandardMaterial({ color: 0x8a7a64, emissive: 0x4a3414, emissiveIntensity: 0.5, roughness: 0.8 }),
      ground: M(0xffffff, { map: apron, roughness: 0.95, metalness: 0 }),
      lineY: MB(0xf5b400), lineW: MB(0xcfe0de), lineR: MB(0xb42318),
      gse: M(0xf59e0b, { roughness: 0.55 }),
      gseDark: M(0x1e3a44, { roughness: 0.7 }),
      rail: M(0xffc21a, { roughness: 0.5 }),
      uld: M(0xc6d0d4, { roughness: 0.32, metalness: 0.75 }),
      uldEdge: M(0x8e9ca2, { roughness: 0.4, metalness: 0.6 }),
      cargo: M(0xffffff, { map: net, roughness: 0.85 }),
      crate: M(0xb48a58, { roughness: 0.85 }),
      slat: M(0x7a5a36, { roughness: 0.9 }),
      wrap: M(0xa9b2b7, { roughness: 0.45, metalness: 0.15 }),
      tagT: MB(0x14b8a6), tagA: MB(0xf59e0b),
      mast: M(0x2c434b, { roughness: 0.8 }),
      lamp: MB(0xfff1cf),
      navR: MB(0xff4d4d), navG: MB(0x3dff9a), beacon: new T.MeshBasicMaterial({ color: 0xff3b30, transparent: true })
    };
    const add = (parent, geo, m, x, y, z, cast) => {
      const o = new T.Mesh(geo, m);
      o.position.set(x || 0, y || 0, z || 0);
      if (cast !== false) o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    const extrude = (shape, depth) => new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1 });
    const shape = (pts) => { const s = new T.Shape(); pts.forEach(([a, b], i) => i ? s.lineTo(a, b) : s.moveTo(a, b)); s.closePath(); return s; };
    /* 날개 단면(NACA 4자리 두께 분포)을 스팬 방향으로 이어 붙인 로프트 — 뿌리는 두껍고 끝으로 갈수록 얇다.
       stations: [{ z, le, te, t, dy }]  (z = 스팬, le/te = 앞·뒷전 x, t = 두께비) */
    const loft = (stations, nc) => {
      const xs = [];
      for (let i = 0; i <= nc; i++) xs.push((1 - Math.cos(Math.PI * i / nc)) / 2);
      const ring = [];
      for (let i = nc; i >= 0; i--) ring.push([xs[i], 1]);
      for (let i = 1; i < nc; i++) ring.push([xs[i], -1]);
      const n = ring.length, pos = [], idx = [];
      stations.forEach(st => {
        const c = st.le - st.te;
        ring.forEach(([u, sd]) => {
          const yt = 5 * st.t * c * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
          pos.push(st.le - u * c, sd * yt + (st.dy || 0), st.z);
        });
      });
      for (let k = 0; k < stations.length - 1; k++) for (let i = 0; i < n; i++) {
        const a = k * n + i, b = k * n + (i + 1) % n, c2 = (k + 1) * n + i, d = (k + 1) * n + (i + 1) % n;
        idx.push(a, b, c2, b, d, c2);
      }
      const last = stations[stations.length - 1], base = (stations.length - 1) * n, ctr = pos.length / 3;
      pos.push((last.le + last.te) / 2, last.dy || 0, last.z);
      for (let i = 0; i < n; i++) idx.push(base + i, ctr, base + (i + 1) % n);
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };

    /* 바닥(에이프런) + 표시선 */
    const ground = new T.Mesh(new T.PlaneGeometry(90, 60), mat.ground);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    const flat = (w, d, m, x, z) => {
      const p = new T.Mesh(new T.PlaneGeometry(w, d), m);
      p.rotation.x = -Math.PI / 2; p.position.set(x, 0.012, z); scene.add(p); return p;
    };
    flat(40, 0.09, mat.lineY, 0, 0);                    // 유도선
    flat(0.09, 2.4, mat.lineY, 7.55, 0);                // 정지선(앞바퀴)
    for (let i = -4; i <= 16; i += 1.5) flat(0.9, 0.07, mat.lineW, i, 3.45);   // 장비 통로선
    flat(0.07, 2.2, mat.lineR, 8.05, 2.2);              // 적색 안전 구역선
    flat(5.2, 0.07, mat.lineR, 10.6, 3.3);

    /* ── 동체 (꼬리 올림 · 기수 약간 처짐) ── */
    const ac = new T.Group();
    scene.add(ac);
    const XTC = -4.9, XNC = 7.25;
    const rAt = (x) => {
      if (x < XTC) { const t = Math.min(1, (XTC - x) / (XTC - XT)); return Math.max(0.09, R * Math.pow(1 - Math.pow(t, 1.8), 0.62)); }
      if (x > XNC) { const t = Math.min(1, (x - XNC) / (XN - XNC)); return Math.max(0.02, R * Math.pow(1 - Math.pow(t, 2.1), 1 / 2.1)); }
      return R;
    };
    const liftAt = (x) => { const r = rAt(x); return x < XTC ? (R - r) * 0.86 : x > XNC ? -(R - r) * 0.22 : 0; };
    /* 길이 방향으로 고르게 나눈 회전체 — u/v를 바꿔 u=길이, v=둘레 로 만든다 */
    const hull = (x0, x1, n, seg) => {
      const pts = [];
      for (let j = 0; j <= n; j++) { const x = x0 + (x1 - x0) * j / n; pts.push(new T.Vector2(rAt(x), x)); }
      const g = new T.LatheGeometry(pts, seg, Math.PI / 2, Math.PI * 2);
      g.rotateZ(-Math.PI / 2);
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        p.setY(i, p.getY(i) + liftAt(p.getX(i)));
        const u = uv.getX(i), v = uv.getY(i);
        uv.setXY(i, v, u);
      }
      g.computeVertexNormals();
      return g;
    };
    add(ac, hull(XT, NX, 110, 72), mat.body, 0, CY, 0);
    add(ac, new T.CylinderGeometry(0.09, 0.09, 0.05, 12).rotateZ(Math.PI / 2), mat.intake, XT + 0.01, CY + liftAt(XT), 0, false);

    // 기수 화물문(바이저) — 윗부분 힌지로 들어 올린 상태
    const hinge = new T.Group();
    hinge.position.set(NX + 0.05, CY + R * 0.93, 0);
    ac.add(hinge);
    const OPEN = 1.38, uLogo = 0.5;
    mat.visor = M(0xffffff, { map: tex(visorCanvas(XN - NX, R, rAt(NX + (XN - NX) * uLogo), uLogo, OPEN), { flipY: false }),
      roughness: 0.4, metalness: 0.08, side: T.DoubleSide });
    const visor = add(hinge, hull(NX, XN, 30, 64), mat.visor, 0, 0, 0);
    visor.position.set(-hinge.position.x, CY - hinge.position.y, 0);
    hinge.rotation.z = OPEN;

    // 주 화물칸 내부(바닥 · 칸막이 · 조명)
    const floorY = CY - R * 0.38;
    const fl = add(ac, new T.PlaneGeometry(3.0, 1.7), mat.floor, 6.55, floorY, 0, false);
    fl.rotation.x = -Math.PI / 2;
    add(ac, new T.CircleGeometry(R * 0.99, 40).rotateY(Math.PI / 2), mat.hold, 5.1, CY, 0, false);
    const sleeve = new T.CylinderGeometry(R * 0.965, R * 0.965, NX - 5.1, 40, 1, true).rotateZ(Math.PI / 2);
    add(ac, sleeve, new T.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.85, side: T.BackSide }), (NX + 5.1) / 2, CY, 0, false);

    /* ── 2층 조종실 혹(-400F 단축형) — 위쪽 로브가 뒤로 갈수록 동체 속으로 가라앉는 페어링 ── */
    const HX0 = 1.3, HX1 = 8.02, HF = 7.25, HFULL = 4.3;
    const HA = R * 0.7, HB = R * 0.7, HFLOOR = CY + R * 0.7;
    const domeAt = (x) => x > HF ? Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(1, (x - HF) / (HX1 - HF)), 2))) : 1;
    const sm = (e0, e1, v) => { const k = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
    const lobeC = (x) => CY + R * (0.3 + 0.49 * sm(HX0, HFULL, x));            // 로브 중심 높이
    const lobeW = (x) => 0.78 + 0.22 * sm(HX0, HFULL, x);                       // 폭(뒤로 갈수록 약간 좁게)
    const hump = (x0, x1, n, phiS, phiL, grow) => {
      const pts = [];
      for (let j = 0; j <= n; j++) { const x = x0 + (x1 - x0) * j / n; pts.push(new T.Vector2(Math.max(0.001, domeAt(x)) * (grow || 1), x)); }
      const g = new T.LatheGeometry(pts, 48, phiS, phiL);
      g.rotateZ(-Math.PI / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        p.setY(i, Math.max(HFLOOR - (x < HFULL ? R * 0.5 : 0), lobeC(x) + HB * p.getY(i)));
        p.setZ(i, HA * lobeW(x) * p.getZ(i));
      }
      g.computeVertexNormals();
      return g;
    };
    add(ac, hump(HX0, HX1, 70, 0, Math.PI * 2), mat.white);
    const HC = lobeC(6);
    // 조종석 창(앞 경사면 4장) · 2층 창(좌우 3개씩)
    [-0.95, -0.49, 0.03, 0.49].forEach(a => add(ac, hump(7.5, 7.84, 6, Math.PI * 1.5 + a, 0.42, 1.012), mat.glass, 0, 0, 0, false));
    [6.55, 6.2, 5.85].forEach(x => [1, -1].forEach(sg =>
      add(ac, new T.BoxGeometry(0.1, 0.13, 0.02), mat.glass, x, HC + 0.06, sg * (HA + 0.004), false)));

    /* ── 날개 · 엔진 4기 · 윙렛 (한쪽을 만들고 좌우 대칭) ── */
    const WY = CY - R * 0.52, DIH = 0.105;
    const leAt = (z) => 2.0 - z * (7.55 / 9.45);
    const wingGeo = loft([
      { z: 0, le: 2.0, te: -2.95, t: 0.12, dy: -0.12 },
      { z: 3.9, le: leAt(3.9), te: -3.45, t: 0.1, dy: -0.1 },
      { z: 9.45, le: -5.55, te: -6.8, t: 0.08, dy: -0.05 }
    ], 14);
    const wletGeo = extrude(shape([[-5.78, 0], [-6.52, 0.56], [-6.82, 0.56], [-6.76, 0]]), 0.045);
    wletGeo.translate(0, 0, -0.025);
    const nacGeo = new T.CylinderGeometry(0.37, 0.3, 1.55, 32).rotateZ(-Math.PI / 2);
    const lipGeo = new T.TorusGeometry(0.355, 0.045, 10, 32).rotateY(Math.PI / 2);
    const inletGeo = new T.CircleGeometry(0.34, 28).rotateY(Math.PI / 2);
    const spinGeo = new T.ConeGeometry(0.1, 0.24, 16).rotateZ(-Math.PI / 2);
    const plugGeo = new T.ConeGeometry(0.17, 0.5, 16).rotateZ(Math.PI / 2);
    const pylonGeo = new T.BoxGeometry(1.45, 0.2, 0.08);
    const makeSide = (sg) => {
      const side = new T.Group();
      side.position.set(0, WY, 0);
      side.rotation.x = -DIH * sg;
      side.scale.z = sg;
      add(side, wingGeo, mat.wing, 0, 0, 0);
      const wl = new T.Group();
      wl.position.set(0, 0, 9.45);
      wl.rotation.x = 0.32;
      add(wl, wletGeo, mat.red, 0, 0, 0);
      side.add(wl);
      [3.45, 6.15].forEach(z => {
        const le = leAt(z), cx = le + 0.15, cy = -0.67;
        const e = new T.Group();
        e.position.set(cx, cy, z);
        add(e, nacGeo, mat.nacelle, 0, 0, 0);
        add(e, lipGeo, mat.lip, 0.775, 0, 0, false);
        add(e, inletGeo, mat.intake, 0.74, 0, 0, false);
        add(e, spinGeo, mat.lip, 0.72, 0, 0, false);
        add(e, plugGeo, mat.core, -0.95, 0, 0, false);
        add(e, pylonGeo, mat.wing, -0.35, 0.44, 0);
        side.add(e);
      });
      add(side, new T.SphereGeometry(0.06, 10, 8), sg > 0 ? mat.navG : mat.navR, -5.62, 0.02, 9.5, false);
      // 수평꼬리
      const hs = new T.Group();
      hs.position.set(0, CY + 0.3 - WY, 0);
      hs.rotation.x = -0.02 * sg;
      const hsGeo = loft([{ z: 0, le: -7.35, te: -9.55, t: 0.1 }, { z: 3.25, le: -9.7, te: -10.45, t: 0.08 }], 10);
      add(hs, hsGeo, mat.wing, 0, 0, 0);
      side.add(hs);
      ac.add(side);
    };
    makeSide(1); makeSide(-1);

    /* ── 수직꼬리(파란색 + 로고) ── */
    const finGeo = extrude(shape([[-5.7, 0], [-8.75, 2.95], [-9.85, 2.95], [-9.75, 0]]), 0.14);
    finGeo.translate(0, 0, -0.07);
    const FINY = CY + R * 0.84;
    add(ac, finGeo, mat.tail, 0, FINY, 0);
    const logoGeo = new T.PlaneGeometry(1.72, 1.72);
    add(ac, logoGeo, mat.logo, -8.45, FINY + 1.6, 0.1, false);
    const logoP = add(ac, logoGeo, mat.logo, -8.45, FINY + 1.6, -0.1, false);
    logoP.rotation.y = Math.PI;

    /* ── 착륙장치: 앞바퀴 1 · 날개 2 · 동체 2 (보기 4바퀴) ── */
    const tyreGeo = new T.CylinderGeometry(0.19, 0.19, 0.13, 18).rotateX(Math.PI / 2);
    const legGeo = new T.CylinderGeometry(0.06, 0.06, 1, 8);
    const gearLeg = (x, z, h, wheels) => {
      const leg = add(ac, legGeo, mat.gear, x, 0.19 + h / 2, z);
      leg.scale.y = h;
      wheels.forEach(([dx, dz]) => add(ac, tyreGeo, mat.tyre, x + dx, 0.19, z + dz));
    };
    gearLeg(7.55, 0, CY - R - 0.1, [[0, 0.12], [0, -0.12]]);
    const bogie = [[0.3, 0.2], [-0.3, 0.2], [0.3, -0.2], [-0.3, -0.2]];
    [1, -1].forEach(s => { gearLeg(-1.3, 1.75 * s, WY - 0.3, bogie); gearLeg(-2.35, 0.55 * s, CY - R - 0.1, bogie); });
    // 충돌방지등
    const beaconTop = add(ac, new T.SphereGeometry(0.09, 10, 8), mat.beacon, 1.2, CY + R + 0.04, 0, false);
    const beaconBot = add(ac, new T.SphereGeometry(0.09, 10, 8), mat.beacon, 0.6, CY - R - 0.04, 0, false);

    /* ── 주 화물칸 로더(기수 앞) ── */
    const LOW = 0.26, HIGH = floorY, LX = 9.5;
    const loader = new T.Group();
    loader.position.set(LX, 0, 0);
    scene.add(loader);
    const lw = new T.CylinderGeometry(0.11, 0.11, 0.1, 14).rotateX(Math.PI / 2);
    add(loader, new T.BoxGeometry(3.0, 0.14, 1.45), mat.gseDark, 0, 0.17, 0);
    [[-1.2, 0.72], [1.2, 0.72], [-1.2, -0.72], [1.2, -0.72]].forEach(([x, z]) => add(loader, lw, mat.tyre, x, 0.11, z));
    add(loader, new T.BoxGeometry(0.62, 0.72, 0.55), mat.gse, 1.3, 0.6, -0.95);            // 조작석
    add(loader, new T.BoxGeometry(0.5, 0.34, 0.57), mat.glass, 1.3, 0.78, -0.95, false);
    const platform = new T.Group();
    loader.add(platform);
    add(platform, new T.BoxGeometry(2.75, 0.1, 1.36), mat.gse, -0.05, -0.05, 0);
    const railTop = new T.BoxGeometry(2.7, 0.05, 0.05), railHalf = new T.BoxGeometry(1.3, 0.05, 0.05), post = new T.BoxGeometry(0.05, 0.34, 0.05);
    add(platform, railTop, mat.rail, -0.05, 0.34, -0.68);
    add(platform, new T.BoxGeometry(0.4, 0.05, 0.05), mat.rail, -1.2, 0.34, 0.68);         // 우현은 옆 이송구(긴 화물) — 앞쪽 짧은 난간만
    [-1.35, -0.7, -0.05, 0.6, 1.25].forEach(x => add(platform, post, mat.rail, x, 0.17, -0.68));
    [-1.35, -1.02].forEach(x => add(platform, post, mat.rail, x, 0.17, 0.68));
    const legs = [];
    [-0.5, 0.5].forEach(z => [1, -1].forEach(sg => {
      const leg = add(loader, new T.BoxGeometry(2.3, 0.07, 0.07), mat.gseDark, 0, 0, z);
      leg.userData.sg = sg; legs.push(leg);
    }));
    const setLift = (topY) => {
      platform.position.y = topY;
      const base = 0.24, span = Math.max(0.01, topY - 0.1 - base);
      const ang = Math.asin(Math.min(0.95, span / 2.3));
      legs.forEach(l => { l.position.y = base + span / 2; l.rotation.z = ang * l.userData.sg; });
    };
    setLift(LOW);

    /* ── 긴 화물(Long cargo) · 20ft 돌리 · 토잉카 ──
       기수 화물문은 메인 도어로 못 싣는 긴 화물용 — 20ft 팔레트 위 긴 목재 상자와 포장한 헬기 동체를 번갈아 싣는다 */
    const CL = 2.5;                                        // 화물 길이 약 8.5m
    const makeCargo = (kind) => {
      const u = new T.Group();
      add(u, new T.BoxGeometry(CL + 0.1, 0.045, 0.72), mat.uldEdge, 0, 0.022, 0);        // 20ft 팔레트
      if (kind === "crate") {
        add(u, new T.BoxGeometry(CL, 0.56, 0.6), mat.crate, 0, 0.33, 0);
        [-1.05, -0.35, 0.35, 1.05].forEach(x => add(u, new T.BoxGeometry(0.07, 0.58, 0.62), mat.slat, x, 0.33, 0, false));
        add(u, new T.BoxGeometry(CL + 0.02, 0.07, 0.62), mat.slat, 0, 0.6, 0, false);
        const t = new T.Mesh(new T.PlaneGeometry(0.34, 0.16), mat.tagA);
        t.position.set(0.9, 0.36, 0.305); u.add(t);
      } else {
        // 헬기(주 회전날개를 떼어 낸 상태) — 옆모습 윤곽을 둥글게 압출한 동체 · 큰 조종석 창 · 엔진 덮개 · 꼬리 붐 · 스키드
        const ex = (pts, depth, bev) => {
          const g = new T.ExtrudeGeometry(shape(pts), { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 4 });
          g.translate(0, 0, -depth / 2);
          return g;
        };
        const hx = 0.2;                                    // 전체 길이 약 2.6 이 팔레트 위에 오도록
        const cabin = [[-0.35, 0.07], [0.75, 0.07], [0.97, 0.16], [1.07, 0.3], [1.02, 0.46], [0.82, 0.6], [0.35, 0.64],
          [0.3, 0.73], [-0.2, 0.75], [-0.36, 0.6], [-0.56, 0.47], [-0.56, 0.34]].map(([x, y]) => [x + hx, y + 0.08]);
        add(u, ex(cabin, 0.42, 0.06), mat.wrap, 0, 0, 0);
        const canopy = [[0.64, 0.3], [0.99, 0.25], [1.08, 0.33], [1.02, 0.48], [0.82, 0.62], [0.6, 0.63]].map(([x, y]) => [x + hx, y + 0.08]);
        add(u, ex(canopy, 0.46, 0.065), mat.glass, 0, 0, 0, false);
        add(u, new T.CylinderGeometry(0.1, 0.05, 1.05, 14).rotateZ(Math.PI / 2), mat.wrap, -1.0 + hx, 0.54, 0);
        const fin = add(u, ex([[-1.43, 0.5], [-1.3, 0.5], [-1.4, 0.92], [-1.54, 0.92]].map(([x, y]) => [x + hx, y]), 0.03, 0.01), mat.wrap, 0, 0, 0);
        fin.castShadow = true;
        add(u, new T.BoxGeometry(0.16, 0.025, 0.46), mat.wrap, -1.22 + hx, 0.55, 0);
        add(u, new T.CylinderGeometry(0.05, 0.065, 0.14, 12), mat.gear, 0.12 + hx, 0.88, 0);
        add(u, new T.CylinderGeometry(0.14, 0.14, 0.035, 18), mat.gear, 0.12 + hx, 0.96, 0);
        const skid = new T.CylinderGeometry(0.022, 0.022, 1.25, 8).rotateZ(Math.PI / 2);
        [-0.29, 0.29].forEach(z => {
          add(u, skid, mat.gear, 0.32 + hx, 0.07, z);
          [-0.1, 0.7].forEach(x => add(u, new T.BoxGeometry(0.035, 0.12, 0.035), mat.gear, x + hx, 0.13, z * 0.9, false));
        });
      }
      return u;
    };
    const BED = LOW, DZ = 2.35, PX = LX - 0.05;            // PX = 로더 플랫폼 중앙
    const dollyGeo = new T.BoxGeometry(CL + 0.25, 0.07, 0.86);
    const dwheel = new T.CylinderGeometry(0.08, 0.08, 0.07, 12).rotateX(Math.PI / 2);
    const dollies = [];
    [PX, PX + 2.95].forEach((x) => {
      const d = new T.Group();
      d.position.set(x, 0, DZ);
      add(d, dollyGeo, mat.gseDark, 0, BED - 0.04, 0);
      [-1.1, 0, 1.1].forEach(a => [-0.36, 0.36].forEach(b => add(d, dwheel, mat.tyre, a, 0.08, b)));
      add(d, new T.BoxGeometry(0.3, 0.03, 0.03), mat.gear, CL / 2 + 0.28, 0.14, 0);
      const us = { crate: makeCargo("crate"), heli: makeCargo("heli") };
      Object.values(us).forEach(u => { u.position.y = BED; d.add(u); });
      dollies.push({ g: d, us });
      scene.add(d);
    });
    const tug = new T.Group();
    tug.position.set(PX + 4.95, 0, DZ);
    add(tug, new T.BoxGeometry(1.0, 0.42, 0.82), mat.gse, 0, 0.36, 0);
    add(tug, new T.BoxGeometry(0.45, 0.36, 0.72), mat.glass, 0.12, 0.75, 0, false);
    [[-0.32, -0.38], [0.32, -0.38], [-0.32, 0.38], [0.32, 0.38]].forEach(([a, b]) => add(tug, dwheel, mat.tyre, a, 0.1, b));
    scene.add(tug);
    const movers = { crate: makeCargo("crate"), heli: makeCargo("heli") };
    Object.values(movers).forEach(m => scene.add(m));

    /* ── 투광등 ── */
    [-16, 2, 20].forEach((x, i) => {
      add(scene, new T.CylinderGeometry(0.12, 0.16, 7.0, 8), mat.mast, x, 3.5, -26 - i * 1.2, false);
      add(scene, new T.BoxGeometry(1.0, 0.32, 0.32), mat.lamp, x, 7.0, -25.8 - i * 1.2, false);
    });

    /* ── 조명 ── */
    scene.add(new T.HemisphereLight(0xd6efea, 0x0b1f26, 1.3));
    const sun = new T.DirectionalLight(0xffe2b8, 2.2);
    sun.position.set(10, 18, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 16, bottom: -16, near: 2, far: 60 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const rim = new T.DirectionalLight(0x2dd4bf, 1.0);
    rim.position.set(-14, 8, -12);
    scene.add(rim);
    const holdLight = new T.PointLight(0xffc36b, 3.2, 6, 1.4);
    holdLight.position.set(7.0, CY + 0.2, 0);
    scene.add(holdLight);

    /* ── 카메라 — 우현 앞쪽 3/4 시점 ── */
    const camera = new T.PerspectiveCamera(28, 2, 0.5, 160);
    const target = new T.Vector3(2.0, 2.6, 0.6);
    const AZ0 = 0.92, POL0 = 1.37;
    // 화면에 반드시 들어올 기준점(꼬리·기수 화물문·로더·첫 돌리). 가까운 날개 끝은 왼쪽 가림막 쪽으로 잘려도 된다
    const FIT = [[-10.45, CY + 0.3, 0], [-9.85, FINY + 2.95, 0], [-6.8, WY + 1.2, -9.5],
      [XN, 0.3, 0], [LX + 1.4, 0.3, -0.7], [PX + 1.3, 0.3, DZ], [PX - 1.3, 0.3, DZ]]
      .map(p => new T.Vector3(p[0], p[1], p[2]));
    ac.updateMatrixWorld(true);
    const vb = new T.Box3().setFromObject(visor);
    FIT.push(vb.max.clone(), new T.Vector3(vb.max.x, vb.min.y, 0));
    const UP = new T.Vector3(0, 1, 0);
    const camDir = (az, pol) => new T.Vector3(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
    /* 화면 비율에 맞춰 모든 기준점이 들어오는 최소 거리.
       sx·sy = 화면 이동량(setViewOffset) — 오른쪽·위로 민 만큼 반대쪽 여유를 더 준다 */
    function fitDist(aspect, fov, sx, sy) {
      const tv = Math.tan(fov * Math.PI / 360), th = tv * aspect;
      sx = sx || 0; sy = sy || 0;
      let best = 12;
      [AZ0 - 0.1, AZ0, AZ0 + 0.1].forEach(az => {
        const f = camDir(az, POL0).negate();
        const r = new T.Vector3().crossVectors(f, UP).normalize();
        const u = new T.Vector3().crossVectors(r, f).normalize();
        FIT.forEach(p => {
          const d = p.clone().sub(target);
          const zf = d.dot(f), x = d.dot(r), y = d.dot(u);
          const lx = th * 0.96 * (x > 0 ? 1 - 2 * sx : 1 + 2 * sx);
          const ly = tv * 0.97 * (y > 0 ? 1 - 2 * sy : 1 + 2 * sy);
          best = Math.max(best, Math.abs(x) / lx - zf, Math.abs(y) / ly - zf);
        });
      });
      return best;
    }

    /* ── 애니메이션 (10초 주기, 긴 상자·헬기 동체 번갈아) ── */
    const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
    const KINDS = ["crate", "heli"];
    function update(t, pr) {
      const c = t % 10, cyc = Math.floor(t / 10);
      const kind = KINDS[cyc % 2], next = KINDS[(cyc + 1) % 2];
      // 1) 돌리 → 로더 옆 이송 (0–1.8s)  2) 상승 (1.8–4)  3) 기수로 반입 (4–6.6)  4) 하강 (6.4–8.2)  5) 다음 화물 준비 (8.2–10)
      const slide = smooth(0, 1.8, c), lift = smooth(1.8, 4, c) - smooth(6.4, 8.2, c), load = smooth(4, 6.6, c);
      setLift(LOW + (HIGH - LOW) * lift);
      Object.entries(movers).forEach(([k, m]) => {
        m.visible = k === kind && c < 6.6;
        if (!m.visible) return;
        const xIn = 5.1 - CL / 2 - 0.2;                    // 칸막이 뒤로 완전히 들어가는 위치
        m.position.set(PX + (xIn - PX) * load, c < 1.8 ? BED : platform.position.y, DZ * (1 - slide));
      });
      // 첫 돌리: 옮기는 동안 비었다가 8.2–10초에 다음 화물이 내려앉음 · 둘째 돌리는 그다음 차례
      const drop = smooth(8.2, 9.7, c);
      Object.entries(dollies[0].us).forEach(([k, u]) => {
        u.visible = k === next && c >= 8.2;
        u.position.y = BED + (1 - drop) * 0.55;
        u.scale.setScalar(0.001 + 0.999 * smooth(8.2, 8.8, c));
      });
      Object.entries(dollies[1].us).forEach(([k, u]) => { u.visible = k === (c >= 8.2 ? kind : next); });
      mat.beacon.opacity = (t % 1.2) < 0.12 ? 1 : 0.08;
      beaconTop.visible = beaconBot.visible = true;
      // 카메라: 느린 좌우 선회 + 포인터 시차
      const az = AZ0 + 0.1 * Math.sin(t * 0.09) + pr.x * 0.14;
      const pol = POL0 - pr.y * 0.05;
      const dir = camDir(az, pol).multiplyScalar(S.dist || 34);
      camera.position.copy(target).add(dir);
      camera.lookAt(target);
    }
    update(3, { x: 0, y: 0 });
    return { scene, camera, update, fitDist, dispose() {
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      Object.values(mat).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    } };
  }

  /* ─────────── 렌더 루프 ─────────── */
  function resize() {
    if (!S.renderer || !S.host) return;
    const w = Math.max(1, S.host.clientWidth), h = Math.max(1, S.host.clientHeight);
    S.renderer.setSize(w, h, false);
    const cam = S.rig.camera, asp = w / h;
    cam.aspect = asp;
    cam.fov = asp < 1.3 ? 34 : 28;
    // 넓은 카드(데스크톱)는 왼쪽에 숫자가 있으므로 장면을 오른쪽으로, 아래 돌리가 보이도록 위로 조금 민다
    const sx = asp > 2 ? 0.07 : 0, sy = 0.06;
    S.dist = Math.max(14, Math.min(60, S.rig.fitDist(asp, cam.fov, sx, sy)));
    cam.setViewOffset(w, h, -w * sx, h * sy, w, h);
    cam.updateProjectionMatrix();
    if (S.reduce || S.slow || !S.running) frame(performance.now());
  }
  function frame(now) {
    if (!S.renderer) return;
    const t = (S.reduce || S.slow) ? 3 : (now - S.t0) / 1000;
    const p = S.ptr;
    p.cx += (p.x - p.cx) * 0.06; p.cy += (p.y - p.cy) * 0.06;
    S.rig.update(t, (S.reduce || S.slow) ? { x: 0, y: 0 } : { x: p.cx, y: p.cy });
    S.renderer.render(S.rig.scene, S.rig.camera);
  }
  function loop(now) {
    S.raf = 0;
    if (!S.running) return;
    if (!S.canvas || !S.canvas.isConnected) { stop(); return; }
    if (S.visible && document.visibilityState !== "hidden") {
      frame(now);
      // 처음 90프레임 평균이 45ms를 넘으면(느린 PC) 정지 화면으로 전환
      if (S.probe && S.probe.n < 90) {
        if (S.probe.last) S.probe.sum += now - S.probe.last;
        S.probe.last = now; S.probe.n++;
        if (S.probe.n === 90 && S.probe.sum / 89 > 45) { S.slow = true; if (S.host) S.host.dataset.h3d = "static"; stop(); return; }
      }
    } else if (S.probe) S.probe.last = 0;
    S.raf = requestAnimationFrame(loop);
  }
  function start() {
    if (S.reduce || S.slow) { frame(performance.now()); return; }
    if (!S.probe) S.probe = { n: 0, sum: 0, last: 0 };
    if (S.running) return;
    S.running = true;
    S.raf = requestAnimationFrame(loop);
  }
  function stop() {
    S.running = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
  }
  function onPointer(ev) {
    if (!S.host) return;
    const r = S.host.getBoundingClientRect();
    S.ptr.x = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / (r.width || 1)) * 2 - 1));
    S.ptr.y = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / (r.height || 1)) * 2 - 1));
  }
  function onLeave() { S.ptr.x = 0; S.ptr.y = 0; }

  /* 대시보드가 그려질 때마다 호출 — host는 3D가 들어갈 자리(.tk-stage) */
  function mount(host) {
    if (!host) return;
    if (!webglOK()) { fallback(host, "no-webgl"); return; }
    if (S.failed) { fallback(host, "webgl-context"); return; }
    S.reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    Promise.all([loadThree(), fontReady()]).then(([T]) => {
      if (!host.isConnected) return;
      if (!S.renderer) {
        let r;
        try {
          r = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
        } catch (err) { S.failed = true; fallback(host, "webgl-context"); return; }
        r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        r.outputColorSpace = T.SRGBColorSpace;
        r.toneMapping = T.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.05;
        r.shadowMap.enabled = true;
        r.shadowMap.type = T.PCFSoftShadowMap;
        r.setClearColor(0x000000, 0);
        S.renderer = r;
        // 소프트웨어 렌더링(GPU 없음)이면 움직임 없이 정지 화면만 — CPU 점유 방지
        try {
          const gl = r.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
          const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
          if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) S.slow = true;
        } catch (err) { /* 정보 없음 — 프레임 시간으로 판단 */ }
        S.canvas = r.domElement;
        S.canvas.setAttribute("aria-hidden", "true");
        S.canvas.className = "h3d-canvas";
        S.rig = build(T, r.capabilities.getMaxAnisotropy ? Math.min(8, r.capabilities.getMaxAnisotropy()) : 4);
        S.t0 = performance.now();
        S.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); });
        S.canvas.addEventListener("webglcontextrestored", () => { resize(); start(); });
      }
      // 이전 자리의 관찰자 정리 후 새 자리로 캔버스 이동
      if (S.io) S.io.disconnect();
      if (S.ro) S.ro.disconnect();
      if (S.host && S.host !== host) {
        const oldTicket = S.host.closest(".ticket");
        if (oldTicket) { oldTicket.removeEventListener("pointermove", onPointer); oldTicket.removeEventListener("pointerleave", onLeave); }
      }
      S.host = host;
      host.appendChild(S.canvas);
      host.classList.remove("h3d-fallback");
      host.dataset.h3d = S.slow ? "static" : "live";
      const tk = host.closest(".ticket") || host;
      tk.addEventListener("pointermove", onPointer, { passive: true });
      tk.addEventListener("pointerleave", onLeave, { passive: true });
      if ("IntersectionObserver" in window) {
        S.io = new IntersectionObserver((ents) => { S.visible = ents.some(e => e.isIntersecting); }, { rootMargin: "120px" });
        S.io.observe(host);
      }
      if ("ResizeObserver" in window) { S.ro = new ResizeObserver(resize); S.ro.observe(host); }
      resize();
      frame(performance.now());
      requestAnimationFrame(() => host.classList.add("h3d-on"));
      start();
    }).catch(() => fallback(host, S.reason === "load" ? "load" : "error"));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.canvas && S.canvas.isConnected) start();
  });

  return { mount, stop, get state() { return S; } };
})();
