/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 대시보드 3D 장면 (v1.9)
   화물기 주 화물칸 문 앞에서 하이로더가 ULD를 싣는 장면을 로우폴리로 그린다.
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
  function loadThree() {
    if (S.T) return Promise.resolve(S.T);
    if (!S.loading) {
      const url = new URL(THREE_URL, document.baseURI).href;
      S.loading = import(url).then(m => (S.T = m)).catch(err => { S.loading = null; S.reason = "load"; throw err; });
    }
    return S.loading;
  }

  /* ─────────── 장면 ─────────── */
  function build(T) {
    const scene = new T.Scene();
    const FOG = 0x0f2a33;
    scene.fog = new T.Fog(FOG, 26, 52);

    const M = (color, o) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, o || {}));
    const MB = (color) => new T.MeshBasicMaterial({ color });
    const mat = {
      body: M(0xeef2f1, { roughness: 0.42, metalness: 0.12 }),
      belly: M(0xc9d3d3, { roughness: 0.5, metalness: 0.15 }),
      tail: M(0x0f766e, { roughness: 0.45 }),
      stripe: M(0x14b8a6, { roughness: 0.4 }),
      engine: M(0xd8e0df, { roughness: 0.3, metalness: 0.45 }),
      intake: M(0x0b1f26, { roughness: 0.4, metalness: 0.6 }),
      glass: M(0x0b1f26, { roughness: 0.15, metalness: 0.7 }),
      gear: M(0x2b3a40, { roughness: 0.7 }),
      tyre: M(0x151d20, { roughness: 0.9 }),
      hold: new T.MeshStandardMaterial({ color: 0x0a1519, emissive: 0x6b4a14, emissiveIntensity: 0.55, roughness: 0.9, side: T.DoubleSide }),
      ground: M(0x10303a, { roughness: 0.95, metalness: 0 }),
      lineY: MB(0xf5b400), lineW: MB(0xcfe0de), lineR: MB(0xb42318),
      gse: M(0xf59e0b, { roughness: 0.55 }),
      gseDark: M(0x1e3a44, { roughness: 0.7 }),
      uld: M(0xc6d0d4, { roughness: 0.34, metalness: 0.72 }),
      uldEdge: M(0x8e9ca2, { roughness: 0.4, metalness: 0.6 }),
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

    /* 바닥(에이프런) + 표시선 */
    const ground = new T.Mesh(new T.PlaneGeometry(90, 60), mat.ground);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);
    const flat = (w, d, m, x, z) => {
      const p = new T.Mesh(new T.PlaneGeometry(w, d), m);
      p.rotation.x = -Math.PI / 2; p.position.set(x, 0.012, z); scene.add(p); return p;
    };
    flat(30, 0.09, mat.lineY, 0, 0);                    // 유도선
    flat(0.09, 2.2, mat.lineY, 8.3, 0);                 // 정지선
    for (let i = -12; i <= 12; i += 1.6) {              // 장비 제한선(점선)
      flat(0.9, 0.07, mat.lineW, i, 5.4);
      flat(0.9, 0.07, mat.lineW, i, -5.4);
    }
    flat(0.07, 3.6, mat.lineR, -1.2, 3.6);              // 적색 안전 구역선
    flat(0.07, 3.6, mat.lineR, -5.3, 3.6);

    /* ── 화물기 ── */
    const ac = new T.Group();
    scene.add(ac);
    const CY = 2.6, R = 1.05;
    const prof = [[0, -7.4], [0.22, -7.3], [0.46, -6.8], [0.72, -5.9], [0.94, -4.7], [R, -3.6], [R, 4.6], [1.0, 5.4],
      [0.9, 6.0], [0.74, 6.55], [0.52, 6.95], [0.26, 7.25], [0, 7.36]];
    const Rof = (y) => {                                 // 길이 방향 위치의 동체 반지름
      for (let i = 1; i < prof.length; i++) {
        if (y <= prof[i][1]) {
          const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
          return r0 + (r1 - r0) * ((y - y0) / (y1 - y0 || 1));
        }
      }
      return 0;
    };
    const lathe = (y0, y1, dr, phiStart, phiLen, steps) => {
      const pts = [];
      const n = steps || 24;
      for (let i = 0; i <= n; i++) {
        const y = y0 + (y1 - y0) * (i / n);
        pts.push(new T.Vector2(Rof(y) + dr, y));
      }
      const g = new T.LatheGeometry(pts, 48, phiStart, phiLen);
      g.rotateZ(-Math.PI / 2);                           // 길이 방향 Y → X (기수 = +X)
      return g;
    };
    const fusePts = prof.map(([r, y]) => new T.Vector2(r, y));
    const fuseGeo = new T.LatheGeometry(fusePts, 56);
    fuseGeo.rotateZ(-Math.PI / 2);
    add(ac, fuseGeo, mat.body, 0, CY, 0);
    // 조종석 창 · 동체 띠 · 주 화물칸 문 개구부(따뜻한 조명)
    add(ac, lathe(5.72, 6.2, 0.012, Math.PI * 1.17, Math.PI * 0.66, 6), mat.glass, 0, CY, 0, false);
    add(ac, lathe(-3.4, 4.9, 0.006, -0.12, 0.09, 2), mat.stripe, 0, CY, 0, false);
    add(ac, lathe(-3.4, 4.9, 0.006, Math.PI * 2 - 0.12 - Math.PI, 0.09, 2), mat.stripe, 0, CY, 0, false);
    const DOOR = { x0: -3.95, x1: -2.6, phiS: -0.94, phiL: 0.99 };
    add(ac, lathe(DOOR.x0, DOOR.x1, 0.01, DOOR.phiS, DOOR.phiL, 2), mat.hold, 0, CY, 0, false);
    // 열린 문짝 — 윗변 힌지로 들어 올림
    const hingeY = CY + R * Math.sin(-DOOR.phiS) * 1.01, hingeZ = R * Math.cos(DOOR.phiS) * 1.01;
    const doorPivot = new T.Group();
    doorPivot.position.set(0, hingeY, hingeZ);
    ac.add(doorPivot);
    const doorGeo = lathe(DOOR.x0, DOOR.x1, 0.03, DOOR.phiS, DOOR.phiL, 2);
    doorGeo.translate(0, CY - hingeY, -hingeZ);
    const doorPanel = new T.Mesh(doorGeo, new T.MeshStandardMaterial({ color: 0xe6ecea, roughness: 0.45, metalness: 0.15, side: T.DoubleSide }));
    doorPanel.castShadow = true;
    doorPivot.add(doorPanel);
    doorPivot.rotation.x = -1.95;

    // 주날개 + 엔진 (한쪽을 만들고 거울 복제)
    const wingShape = (le0, te0, span, le1, te1) => {
      const s = new T.Shape();
      s.moveTo(le0, 0); s.lineTo(le1, span); s.lineTo(te1, span); s.lineTo(te0, 0); s.closePath();
      return s;
    };
    const extrude = (shape, depth) => new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    const side = new T.Group();
    const wingGeo = extrude(wingShape(2.3, -1.3, 7.4, -1.5, -2.45), 0.14);
    wingGeo.rotateX(Math.PI / 2);
    add(side, wingGeo, mat.body, 0.25, CY - 0.45, 0);
    const eng = new T.Group();
    const nac = new T.CylinderGeometry(0.5, 0.42, 2.1, 32, 1, false);
    nac.rotateZ(-Math.PI / 2);
    add(eng, nac, mat.engine, 0, 0, 0);
    const ring = new T.TorusGeometry(0.5, 0.055, 10, 32);
    ring.rotateY(Math.PI / 2);
    add(eng, ring, mat.stripe, 1.05, 0, 0, false);
    const inlet = new T.CircleGeometry(0.46, 28);
    inlet.rotateY(Math.PI / 2);
    add(eng, inlet, mat.intake, 1.04, 0, 0, false);
    add(eng, new T.BoxGeometry(1.3, 0.42, 0.12), mat.belly, -0.2, 0.42, 0);
    eng.position.set(1.55, CY - 1.12, 2.85);
    side.add(eng);
    add(side, new T.SphereGeometry(0.07, 10, 8), mat.navR, -1.6, CY - 0.36, 7.62, false);   // 좌현 적색등(+Z)
    side.rotation.x = -0.05;
    ac.add(side);
    const side2 = side.clone(true);
    side2.scale.z = -1;
    side2.traverse(o => { if (o.isMesh && o.material === mat.navR) o.material = mat.navG; });
    ac.add(side2);
    // 수평 · 수직 꼬리날개
    const hs = extrude(wingShape(-5.3, -6.95, 3.1, -6.85, -7.55), 0.1);
    hs.rotateX(Math.PI / 2);
    const hsL = add(ac, hs, mat.body, 0, CY + 0.35, 0);
    const hsR = hsL.clone(); hsR.scale.z = -1; ac.add(hsR);
    const finShape = new T.Shape();
    finShape.moveTo(-4.7, 0); finShape.lineTo(-6.75, 3.3); finShape.lineTo(-7.7, 3.3); finShape.lineTo(-7.35, 0); finShape.closePath();
    const fin = extrude(finShape, 0.16);
    fin.translate(0, 0, -0.08);
    add(ac, fin, mat.tail, 0, CY + 0.72, 0);
    // 착륙장치
    const gearLeg = (x, z, wheels) => {
      add(ac, new T.CylinderGeometry(0.07, 0.07, 1.2, 8), mat.gear, x, 1.0, z);
      const tyre = new T.CylinderGeometry(0.3, 0.3, 0.22, 18);
      tyre.rotateX(Math.PI / 2);
      for (let i = 0; i < wheels; i++) add(ac, tyre, mat.tyre, x + (i - (wheels - 1) / 2) * 0.66, 0.3, z);
    };
    gearLeg(5.3, 0, 1);
    gearLeg(-1.4, 1.0, 3); gearLeg(-1.4, -1.0, 3);
    // 충돌방지등
    const beaconTop = add(ac, new T.SphereGeometry(0.09, 10, 8), mat.beacon, -0.6, CY + R + 0.05, 0, false);
    const beaconBot = add(ac, new T.SphereGeometry(0.09, 10, 8), mat.beacon, 0.8, CY - R - 0.05, 0, false);

    /* ── 하이로더 (주 화물칸 로더) ── */
    const doorX = (DOOR.x0 + DOOR.x1) / 2, sillY = CY - 0.05;
    const loader = new T.Group();
    loader.position.set(doorX, 0, 2.05);
    scene.add(loader);
    add(loader, new T.BoxGeometry(2.3, 0.42, 1.9), mat.gseDark, 0, 0.5, 0.1);
    const lwheel = new T.CylinderGeometry(0.26, 0.26, 0.2, 16);
    lwheel.rotateX(Math.PI / 2);
    [[-0.85, -0.9], [0.85, -0.9], [-0.85, 1.1], [0.85, 1.1]].forEach(([x, z]) => add(loader, lwheel, mat.tyre, x, 0.26, z));
    add(loader, new T.BoxGeometry(0.9, 0.9, 0.7), mat.gse, 0.75, 1.15, 1.35);                // 운전석
    add(loader, new T.BoxGeometry(0.7, 0.36, 0.72), mat.glass, 0.75, 1.36, 1.35, false);
    const platform = new T.Group();
    loader.add(platform);
    add(platform, new T.BoxGeometry(2.1, 0.18, 1.5), mat.gse, 0, -0.09, 0);
    add(platform, new T.BoxGeometry(2.1, 0.32, 0.06), mat.gse, 0, 0.1, 0.72);                 // 난간
    const legs = [];
    [-0.62, 0.62].forEach(z => {
      [1, -1].forEach(sg => {
        const leg = add(loader, new T.BoxGeometry(2.0, 0.08, 0.08), mat.gseDark, 0, 0, z);
        leg.userData.sg = sg;
        legs.push(leg);
      });
    });
    const LOW = 0.72, HIGH = sillY;
    const setLift = (topY) => {
      platform.position.y = topY;
      const base = 0.72, span = Math.max(0.02, topY - 0.18 - base);
      const ang = Math.asin(Math.min(0.98, span / 2.0));
      legs.forEach(l => { l.position.y = base + span / 2; l.rotation.z = ang * l.userData.sg; });
    };
    setLift(LOW);

    /* ── ULD · 돌리 · 토잉카 ── */
    const uldGeo = (() => {
      const s = new T.Shape();
      s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0.5, 0.52); s.lineTo(0.28, 0.8); s.lineTo(-0.5, 0.8); s.closePath();
      const g = new T.ExtrudeGeometry(s, { depth: 0.84, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
      g.translate(0, 0, -0.42);
      g.rotateY(Math.PI / 2);                            // 윤곽(모서리 깎인 쪽)이 동체 반대편(+Z)
      g.rotateY(Math.PI);
      return g;
    })();
    const makeUld = (tag) => {
      const u = new T.Group();
      add(u, uldGeo, mat.uld, 0, 0.03, 0);
      add(u, new T.BoxGeometry(0.9, 0.05, 1.04), mat.uldEdge, 0, 0.025, 0);
      const t = new T.Mesh(new T.PlaneGeometry(0.2, 0.13), tag);
      t.position.set(0.1, 0.44, 0.515);
      u.add(t);
      return u;
    };
    const dollyGeo = new T.BoxGeometry(1.0, 0.1, 1.14);
    const dwheel = new T.CylinderGeometry(0.14, 0.14, 0.1, 12);
    dwheel.rotateX(Math.PI / 2);
    const DZ = 4.0, BED = 0.5;
    const dollies = [];
    for (let i = 0; i < 3; i++) {
      const d = new T.Group();
      d.position.set(doorX + i * 1.3, 0, DZ);
      add(d, dollyGeo, mat.gseDark, 0, BED - 0.05, 0);
      [[-0.36, -0.45], [0.36, -0.45], [-0.36, 0.45], [0.36, 0.45]].forEach(([x, z]) => add(d, dwheel, mat.tyre, x, 0.14, z));
      add(d, new T.BoxGeometry(0.34, 0.04, 0.04), mat.gear, 0.66, 0.3, 0);
      const u = makeUld(i % 2 ? mat.tagA : mat.tagT);
      u.position.y = BED;
      d.add(u);
      dollies.push({ g: d, u });
      scene.add(d);
    }
    const tug = new T.Group();
    tug.position.set(doorX + 3 * 1.3 + 0.3, 0, DZ);
    add(tug, new T.BoxGeometry(1.1, 0.5, 0.9), mat.gse, 0, 0.45, 0);
    add(tug, new T.BoxGeometry(0.5, 0.4, 0.8), mat.glass, 0.1, 0.9, 0, false);
    [[-0.35, -0.42], [0.35, -0.42], [-0.35, 0.42], [0.35, 0.42]].forEach(([x, z]) => add(tug, dwheel, mat.tyre, x, 0.15, z));
    scene.add(tug);
    // 옮겨지는 ULD
    const mover = makeUld(mat.tagA);
    scene.add(mover);

    /* ── 투광등 ── */
    [-13, -2, 10].forEach((x, i) => {
      add(scene, new T.CylinderGeometry(0.1, 0.14, 6.2, 8), mat.mast, x, 3.1, -15 - i * 0.8, false);
      add(scene, new T.BoxGeometry(0.9, 0.3, 0.3), mat.lamp, x, 6.2, -14.8 - i * 0.8, false);
    });

    /* ── 조명 ── */
    scene.add(new T.HemisphereLight(0xcdeee8, 0x0b1f26, 1.25));
    const sun = new T.DirectionalLight(0xffe2b8, 2.1);
    sun.position.set(9, 16, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10, near: 2, far: 45 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const rim = new T.DirectionalLight(0x2dd4bf, 1.1);
    rim.position.set(-12, 7, -10);
    scene.add(rim);
    const holdLight = new T.PointLight(0xffc36b, 2.2, 5, 1.6);
    holdLight.position.set(doorX, CY + 0.35, 1.6);
    scene.add(holdLight);

    /* ── 카메라 ── */
    const camera = new T.PerspectiveCamera(27, 2, 0.5, 120);
    const target = new T.Vector3(-0.7, 2.5, 1.0);

    /* ── 애니메이션 (10초 주기) ── */
    const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
    const d0 = dollies[0];
    function update(t, pr) {
      const c = t % 10;
      // 1) 돌리 → 플랫폼 (0–1.6s)  2) 상승 (1.6–4)  3) 기내 반입 (4–5.8)  4) 하강 (5.8–8)  5) 다음 ULD 준비 (8–10)
      const slide = smooth(0, 1.6, c), lift = smooth(1.6, 4, c) - smooth(5.8, 8, c), load = smooth(4, 5.8, c);
      setLift(LOW + (HIGH - LOW) * lift);
      if (c < 5.8) {
        mover.visible = true;
        const z0 = DZ, z1 = 2.05, zIn = 0.2;
        mover.position.set(doorX, 0, z0 + (z1 - z0) * slide + (zIn - z1) * load);
        mover.position.y = (c < 1.6) ? BED + (LOW - BED) * slide : platform.position.y;
      } else mover.visible = false;
      // 앞 돌리의 ULD: 옮겨지는 동안 비었다가 8–10초에 위에서 내려앉음
      const back = smooth(8, 9.6, c);
      d0.u.visible = c >= 8;
      d0.u.position.y = BED + (1 - back) * 0.55;
      d0.u.scale.setScalar(0.001 + 0.999 * smooth(8, 8.6, c));
      // 충돌방지등 점멸
      const blink = (t % 1.2) < 0.12 ? 1 : 0.08;
      mat.beacon.opacity = blink;
      beaconTop.visible = beaconBot.visible = true;
      // 카메라: 느린 좌우 선회 + 포인터 시차
      const az = 0.52 + 0.14 * Math.sin(t * 0.09) + pr.x * 0.18;
      const pol = 1.3 - pr.y * 0.05;
      const rad = S.dist || 31;
      camera.position.set(
        target.x + rad * Math.sin(pol) * Math.sin(az),
        target.y + rad * Math.cos(pol),
        target.z + rad * Math.sin(pol) * Math.cos(az));
      camera.lookAt(target);
    }
    update(3, { x: 0, y: 0 });
    return { scene, camera, update, dispose() {
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      Object.values(mat).forEach(m => m.dispose());
    } };
  }

  /* ─────────── 렌더 루프 ─────────── */
  function resize() {
    if (!S.renderer || !S.host) return;
    const w = Math.max(1, S.host.clientWidth), h = Math.max(1, S.host.clientHeight);
    S.renderer.setSize(w, h, false);
    S.rig.camera.aspect = w / h;
    // 좁은 화면일수록 멀리서 (화물기 전체가 들어오게)
    // 장면 폭(화물기+로더 약 17)이 캔버스 폭의 ~58%를 차지하도록 거리 계산
    const asp = w / h, vf = asp < 1.3 ? 36 : 28;
    S.rig.camera.fov = vf;
    const th = Math.tan((vf * Math.PI / 180) / 2) * asp;
    const tv = Math.tan((vf * Math.PI / 180) / 2);
    const fitW = (17 / (asp < 1.6 ? 0.82 : 0.72)) / 2 / th;   // 가로 채움
    const fitH = (9.4 / 0.9) / 2 / tv;                         // 꼬리날개까지 세로로 들어오게
    S.dist = Math.max(15, Math.min(40, Math.max(fitW, fitH)));
    S.rig.camera.updateProjectionMatrix();
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
    loadThree().then(T => {
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
        S.rig = build(T);
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
