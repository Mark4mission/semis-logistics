/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — CARES 연동 계층 (v1.12)
   CARES(airzeta-security-system, Firebase/Firestore)의 보안검색장비 데이터를
   REST로 읽어 화물 보안 허브(보안검색 현황 · 검색장비 유지관리)와 대시보드가 함께 쓴다.

   원칙
   - 장비 상태·배치·고장·점검·환경센서의 마스터는 CARES — Logistics는 읽기만 한다(쓰기 없음).
   - 공개 읽기 컬렉션만 사용: equipments · repairLogs · inspectionLogs · sensorLogs · sensorThresholds
     (deployLogs · locationStates는 로그인 전용이라 쓰지 않는다 — 배치는 equipments.location)
   - Firebase 웹 키는 코드(공개 저장소)에 두지 않고 공용 DB(semis_logi_store "caresCfg")에서 읽는다.
   - repairLogs의 사진(data URL)은 수 MB라 목록 조회에서 제외(select 투영), 상세에서만 1건씩 불러온다.
   - 묶음별 캐시(live 60초 · repairs 10분 · history 15분 · env 5분) · 화면 여러 곳이 동시에 불러도 요청은 한 번.
   - v1.28 화물보안 대시보드: 점검 조회 12주(주별 이행률) · 환경센서 24시간 추이(env — 이 브라우저에 24시간치를
     쌓아 두고 마지막 수신 이후만 새로 읽는다: 처음 한 번 약 1,440건, 이후 몇 건).
   - v1.36 위해물품 적발 월 집계(haz — CARES hazStats, 공개 · 개인정보 · AWB 없음). 기록 원본 hazFinds 는 CARES 비공개라 읽지 않는다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const PROJECT = "airzeta-security-system";
  const FS_DOCS = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";
  const CARES_URL = "https://airzeta-security-system.web.app";
  const KEY_CACHE = "semisl:caresKey";
  const ENV_CACHE = "semisl:caresEnv";   // v1.28 환경센서 24시간 기록(측정값뿐 — 이 브라우저에만)
  const ENV_HOURS = 24;
  const ENV_PAGE = 1600;
  const TTL_MS = 60000;
  const INSP_DAYS = 84;              // 일일점검 조회 구간(28일 표 · 장비 상세 최근 점검 · v1.28 대시보드 주별 이행률 12주)
  const OFFLINE_MS = 8 * 60 * 1000;  // 센서 3분 주기 × 2회 미수신 + 여유 (CARES와 동일)
  const DAY = 86400000;
  const KST = 9 * 3600000;

  let fetchImpl = null;              // 테스트용 주입
  const F = () => fetchImpl || (typeof fetch !== "undefined" ? fetch : null);

  /* ─────── 연동 키 ─────── */
  let apiKey = null;
  async function getKey() {
    if (apiKey) return apiKey;
    try { const c = localStorage.getItem(KEY_CACHE); if (c) { apiKey = c; return apiKey; } } catch (e) { /* 저장소 차단 */ }
    if (window.SemisSync && SemisSync.fetchKV) {
      const v = await SemisSync.fetchKV("caresCfg");
      if (v && v.apiKey) {
        apiKey = v.apiKey;
        try { localStorage.setItem(KEY_CACHE, apiKey); } catch (e) { /* 무시 */ }
        return apiKey;
      }
    }
    throw new Error("연동 키 미설정");
  }
  function dropKey() { apiKey = null; try { localStorage.removeItem(KEY_CACHE); } catch (e) { /* 무시 */ } }

  /* ─────── Firestore REST ─────── */
  function parseFs(v) {
    if (v == null || typeof v !== "object") return null;
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("integerValue" in v) return Number(v.integerValue);
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("mapValue" in v) {
      const out = {}, f = (v.mapValue && v.mapValue.fields) || {};
      Object.keys(f).forEach(k => { out[k] = parseFs(f[k]); });
      return out;
    }
    if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(parseFs);
    return null;
  }
  function parseDoc(doc) {
    const out = { id: String((doc && doc.name) || "").split("/").pop() };
    const f = (doc && doc.fields) || {};
    Object.keys(f).forEach(k => { out[k] = parseFs(f[k]); });
    return out;
  }
  async function http(url, opts) {
    const fx = F();
    if (!fx) throw new Error("오프라인");
    const res = await fx(url, opts);
    if (!res.ok) {
      if (res.status === 400 || res.status === 403) dropKey();   // 키 교체 가능성 — 다음 시도에서 다시 읽음
      throw new Error("CARES 응답 " + res.status);
    }
    return res.json();
  }
  async function fsList(coll, size) {
    const j = await http(FS_DOCS + "/" + coll + "?pageSize=" + (size || 50) + "&key=" + encodeURIComponent(await getKey()));
    return ((j && j.documents) || []).map(parseDoc);
  }
  async function fsQuery(sq) {
    const rows = await http(FS_DOCS + ":runQuery?key=" + encodeURIComponent(await getKey()), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ structuredQuery: sq })
    });
    return (Array.isArray(rows) ? rows : []).filter(r => r && r.document).map(r => parseDoc(r.document));
  }
  async function fsGet(path, fields) {
    const mask = (fields || []).map(f => "&mask.fieldPaths=" + encodeURIComponent(f)).join("");
    return parseDoc(await http(FS_DOCS + "/" + path + "?key=" + encodeURIComponent(await getKey()) + mask));
  }
  const sel = (fields) => ({ fields: fields.map(f => ({ fieldPath: f })) });
  const REPAIR_FIELDS = ["equipmentId", "equipmentName", "equipmentSerial", "reporter", "symptom", "reportedAtMs", "occurredAtMs",
    "resolvedAtMs", "status", "acceptedAtMs", "acceptedBy", "repairStartedAtMs", "repairStartedBy", "resolvedBy",
    "cause", "causeCategory", "rootCause", "parts", "handlingType", "reportPhotoCount"];
  const INSP_FIELDS = ["type", "equipmentId", "equipmentName", "equipmentType", "inspector", "inspectedAtMs", "checklist", "remark"];

  /* ─────── 상태 · 캐시 ───────
     읽기량(Firestore 문서 읽기)을 줄이려고 세 묶음으로 나눠 따로 갱신한다.
     - live    (60초):  장비(상태·배치) · 센서 최신값 · 오늘 점검          ≈ 35건
     - repairs (10분):  고장·수리 전체(투영) · 센서 임계치                 ≈ 40건
     - history (15분):  최근 12주 점검 · 정기점검(주간·월간…) 최근 기록     ≈ 800건 — 화면에 들어올 때만
     - env     (5분):   환경센서 24시간(이 브라우저에 쌓아 두고 마지막 수신 이후만) — 화물보안 대시보드만
     자동 새로고침(5분)은 live만 강제로, repairs는 유효기간이 지났을 때만 다시 읽는다. */
  const st = { ts: 0, ver: 0, err: null, loading: false, parts: { live: 0, repairs: 0, history: 0, env: 0, haz: 0 },
    equips: [], repairs: [], inspections: [], todayIns: [], periodic: [], sensors: {}, thresholds: {}, env: [], haz: [], errs: {} };
  const TTL = { live: TTL_MS, repairs: 10 * 60000, history: 15 * 60000, env: 5 * 60000, haz: 10 * 60000 };
  const ALL_PARTS = ["live", "repairs", "history"];   // env · haz 는 따로 요청할 때만(load({ parts: ["env"] }))
  const KNOWN_PARTS = ALL_PARTS.concat(["env", "haz"]);
  const inflight = {};
  const listeners = [];
  const why = (r) => r.status === "rejected" ? ((r.reason && r.reason.message) || "실패") : null;
  const val = (r) => r.status === "fulfilled" ? r.value : null;
  const inspQuery = (since, lim) => fsQuery({ select: sel(INSP_FIELDS), from: [{ collectionId: "inspectionLogs" }],
    where: { fieldFilter: { field: { fieldPath: "inspectedAtMs" }, op: "GREATER_THAN_OR_EQUAL", value: { integerValue: String(since) } } },
    orderBy: [{ field: { fieldPath: "inspectedAtMs" }, direction: "DESCENDING" }], limit: lim });

  async function fetchPart(p) {
    try {
      if (p === "live") {
        const res = await Promise.allSettled([
          fsList("equipments", 100),
          fsQuery({ from: [{ collectionId: "sensorLogs" }], orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }], limit: 12 }),
          inspQuery(dayStartMs(todayKey()), 200)
        ]);
        if (val(res[0])) st.equips = val(res[0]);
        if (val(res[1])) {
          const latest = {};
          val(res[1]).forEach(r => { const id = r.deviceId || DEVICE_ORDER[0]; if (!latest[id]) latest[id] = r; });
          st.sensors = latest;
        }
        if (val(res[2])) st.todayIns = val(res[2]);
        st.errs.equips = why(res[0]); st.errs.sensors = why(res[1]);
        st.err = why(res[0]);
        st.ts = Date.now();
      } else if (p === "repairs") {
        const res = await Promise.allSettled([
          fsQuery({ select: sel(REPAIR_FIELDS), from: [{ collectionId: "repairLogs" }],
            orderBy: [{ field: { fieldPath: "reportedAtMs" }, direction: "DESCENDING" }], limit: 500 }),
          fsList("sensorThresholds", 20)
        ]);
        if (val(res[0])) st.repairs = val(res[0]);
        if (val(res[1])) { const th = {}; val(res[1]).forEach(d => { th[d.id] = d; }); st.thresholds = th; }
        st.errs.repairs = why(res[0]);
      } else if (p === "env") {
        await fetchEnv();
      } else if (p === "haz") {
        try { st.haz = (await fsList("hazStats", 60)).filter(d => /^\d{4}-\d{2}$/.test(d.id)).sort((a, b) => a.id.localeCompare(b.id)); st.errs.haz = null; }
        catch (e) { st.errs.haz = (e && e.message) || "연동 실패"; }
      } else {
        const res = await Promise.allSettled([
          inspQuery(Date.now() - INSP_DAYS * DAY, 1000),
          /* 정기점검 최근일 — 45일 밖(연체)도 보이도록 유형 필터로 따로(투영 · 단일 필드라 색인 불필요) */
          fsQuery({ select: sel(["type", "equipmentId", "equipmentName", "equipmentType", "inspector", "inspectedAtMs", "remark"]),
            from: [{ collectionId: "inspectionLogs" }],
            where: { fieldFilter: { field: { fieldPath: "type" }, op: "IN", value: { arrayValue: { values:
              ["weekly", "monthly", "quarterly", "biannual", "annual", "special"].map(v => ({ stringValue: v })) } } } }, limit: 1000 })
        ]);
        if (val(res[0])) st.inspections = val(res[0]);
        if (val(res[1])) st.periodic = val(res[1]);
        st.errs.inspections = why(res[0]);
      }
    } catch (e) {
      if (p === "live") st.err = (e && e.message) || "연동 실패";
      if (p === "env") st.errs.env = (e && e.message) || "연동 실패";
    }
    st.parts[p] = Date.now();
    /* v1.28 실패한 묶음은 유효기간을 기다리지 않고 30초 뒤 다시 읽을 수 있게 */
    const failed = p === "live" ? st.err : p === "repairs" ? st.errs.repairs : p === "history" ? st.errs.inspections : p === "haz" ? st.errs.haz : st.errs.env;
    if (failed) st.parts[p] = Date.now() - TTL[p] + 30000;
  }
  /* 묶음을 읽었지만 실패해 쓸 자료가 없음 — 화면은 0건 대신 '불러오지 못함'을 보여야 한다 */
  function failed(p) {
    if (p === "repairs") return !!st.errs.repairs && !st.repairs.length;
    if (p === "history") return !!st.errs.inspections && !st.inspections.length;
    if (p === "env") return !!st.errs.env && !st.env.length;
    if (p === "haz") return !!st.errs.haz && !st.haz.length;
    return !!st.err && !st.equips.length;
  }
  const stale = (p) => !st.parts[p] || Date.now() - st.parts[p] >= TTL[p];
  /* load()            세 묶음 모두(유효기간 안이면 그대로)
     load(true)        세 묶음 모두 새로
     load({ parts, force })  parts: 필요한 묶음, force: true | 새로 읽을 묶음 배열 */
  function load(opts) {
    if (opts === true) opts = { force: true };
    opts = opts || {};
    const parts = (opts.parts || ALL_PARTS).filter(p => KNOWN_PARTS.indexOf(p) >= 0);
    const force = opts.force === true ? parts : (opts.force || []);
    if (!F()) { st.err = "오프라인"; return Promise.resolve(st); }
    const jobs = parts.map(p => {
      if (inflight[p]) return inflight[p];
      if (force.indexOf(p) < 0 && !stale(p)) return null;
      inflight[p] = fetchPart(p).then(() => { inflight[p] = null; });
      return inflight[p];
    }).filter(Boolean);
    if (!jobs.length) return Promise.resolve(st);
    st.loading = true;
    return Promise.all(jobs).then(() => {
      st.loading = KNOWN_PARTS.some(p => inflight[p]);
      st.ver++;
      listeners.slice().forEach(fn => { try { fn(st); } catch (e) { /* 화면 쪽 오류가 다른 구독을 막지 않도록 */ } });
      return st;
    });
  }
  function onLoad(fn) { if (listeners.indexOf(fn) < 0) listeners.push(fn); }
  const fresh = (parts) => (parts || ALL_PARTS).every(p => !stale(p));
  const has = (p) => !!st.parts[p];
  /* 최근 45일 + 오늘(live) 점검을 합친 목록 — 같은 기록은 한 번만 */
  function allInspections() {
    const seen = {}, out = [];
    st.todayIns.concat(st.inspections).forEach(r => { if (r && r.id && !seen[r.id]) { seen[r.id] = 1; out.push(r); } });
    return out.sort((a, b) => (b.inspectedAtMs || 0) - (a.inspectedAtMs || 0));
  }

  /* ─────── 공통 규약 (CARES와 동일) ─────── */
  const repairStatus = (r) => r.resolvedAtMs ? "resolved" : (r.status && r.status !== "resolved" ? r.status : "reported");
  const RS_META = {
    reported: { label: "접수 대기", tone: "red" },
    accepted: { label: "접수됨", tone: "amber" },
    in_repair: { label: "수리 중", tone: "blue" },
    resolved: { label: "수리 완료", tone: "green" }
  };
  const CAUSE = {
    environmental: { label: "환경", tone: "blue" },
    mechanical: { label: "기계", tone: "purple" },
    human: { label: "인적", tone: "amber" },
    other: { label: "기타", tone: "gray" }
  };
  const INS_TYPE = { daily: "일일", weekly: "주간", monthly: "월간", quarterly: "분기", biannual: "반기", annual: "연간", special: "특별" };

  function kindOf(t) {
    const s = String(t || "").toUpperCase().replace(/[\s-]/g, "");
    if (s.indexOf("XRAY") >= 0) return "xray";
    if (s.indexOf("ETD") >= 0) return "etd";
    if (s.indexOf("WTMD") >= 0) return "wtmd";
    if (s.indexOf("HHMD") >= 0) return "hhmd";
    return "etc";
  }
  const KIND_LABEL = { xray: "X-ray", etd: "ETD", wtmd: "WTMD", hhmd: "HHMD", etc: "기타" };
  const KIND_ORDER = { xray: 0, etd: 1, wtmd: 2, hhmd: 3, etc: 4 };
  const numOf = (s) => { const m = /(\d+)\s*호기/.exec(String(s || "")); return m ? Number(m[1]) : null; };
  const laneOf = (loc) => { const m = /x\s*-?\s*ray\s*(\d+)\s*호기/i.exec(String(loc || "")); return m ? Number(m[1]) : null; };
  const normSN = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
  function ledgerBySN(sn) {
    const k = normSN(sn);
    const list = (window.SeMIS && Array.isArray(SeMIS.data.equipment)) ? SeMIS.data.equipment : [];
    return k ? (list.find(x => normSN(x.serial) === k) || null) : null;
  }

  /* CARES 장비 → 화면용 단위 (X-ray는 이름이 모두 모델명이라 배치 위치의 호기 번호로 구분) */
  function units() {
    const actOf = (id) => st.repairs.filter(r => r.equipmentId === id && repairStatus(r) !== "resolved")
      .sort((a, b) => (b.reportedAtMs || 0) - (a.reportedAtMs || 0))[0] || null;
    return st.equips.map(c => {
      const kind = kindOf(c.type);
      const led = ledgerBySN(c.serial);
      const no = kind === "xray" ? (laneOf(c.location) || numOf(led && led.name) || numOf(c.name))
                                 : (numOf(c.name) || numOf(led && led.name));
      const label = kind === "xray" ? "X-ray " + (no || "?") + "호기" : (c.name || (led && led.name) || "장비");
      const model = kind === "xray" ? (c.name || "") : String(c.name || "").replace(/\s*\d+\s*호기/, "");
      const active = actOf(c.id);
      const state = active || c.status === "broken" ? "bad" : c.status === "warning" ? "warn" : "ok";
      return { id: c.id, kind, no, label, model, short: (kind === "xray" ? "X" : kind === "etd" ? "E" : "") + (no || "?"),
        serial: c.serial || "", location: c.location || "", lane: kind === "xray" ? no : laneOf(c.location),
        status: c.status || "", state, active, ledger: led };
    }).sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || ((a.no || 99) - (b.no || 99)));
  }
  function unitById(id) { return units().find(u => u.id === id) || null; }
  function stateLabel(u) {
    if (u.active) return RS_META[repairStatus(u.active)].label;
    return u.state === "bad" ? "고장" : u.state === "warn" ? "주의" : "정상";
  }
  const stateTone = (u) => u.state === "bad" ? (u.active ? RS_META[repairStatus(u.active)].tone : "red") : u.state === "warn" ? "amber" : "green";

  /* ─────── 날짜 (KST) ─────── */
  const dayKey = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
  const todayKey = () => dayKey(Date.now());
  const dayStartMs = (key) => Date.parse(key + "T00:00:00Z") - KST;
  function lastDays(n) {
    const out = [], t0 = dayStartMs(todayKey());
    for (let i = n - 1; i >= 0; i--) out.push(dayKey(t0 - i * DAY + 3600000));
    return out;
  }
  const hm = (ms) => ms ? new Date(ms + KST).toISOString().slice(11, 16) : "";
  const mdk = (key) => String(key || "").slice(5).replace("-", ".");
  const fmtMs = (ms) => ms ? new Date(ms + KST).toISOString().slice(0, 16).replace("T", " ").replace(/-/g, ".") : "-";
  function fmtDur(ms) {
    if (!(ms > 0)) return "-";
    const m = Math.round(ms / 60000);
    if (m < 60) return m + "분";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "시간" + (m % 60 ? " " + (m % 60) + "분" : "");
    return Math.floor(h / 24) + "일 " + (h % 24) + "시간";
  }

  /* ─────── 점검 ─────── */
  /* unitId → { days: { "YYYY-MM-DD": [logs] }, last: { daily, weekly, monthly } } */
  function inspIndex() {
    const idx = {};
    allInspections().concat(st.periodic || []).forEach(r => {
      if (!r || !r.equipmentId || !r.inspectedAtMs) return;
      const o = idx[r.equipmentId] || (idx[r.equipmentId] = { days: {}, last: {} });
      if (r.type === "daily") (o.days[dayKey(r.inspectedAtMs)] = o.days[dayKey(r.inspectedAtMs)] || []).push(r);
      if (!o.last[r.type] || o.last[r.type].inspectedAtMs < r.inspectedAtMs) o.last[r.type] = r;
    });
    return idx;
  }
  const badCount = (r) => ((r && r.checklist) || []).filter(e => e && e.result === "bad").length;
  const cautionCount = (r) => ((r && r.checklist) || []).filter(e => e && e.result === "caution").length;

  /* ─────── 고장 구간 · 가동률 ─────── */
  function spanOf(r, now) {
    const s = r.reportedAtMs || r.occurredAtMs || 0;
    const e = r.resolvedAtMs || now || Date.now();
    return [s, Math.max(s, e)];
  }
  /* 기간 [from, to) 안의 고장 일(KST) 집합 */
  function downDays(unitId, from, to) {
    const set = {};
    st.repairs.forEach(r => {
      if (r.equipmentId !== unitId) return;
      const sp = spanOf(r, to);
      const a = Math.max(sp[0], from), b = Math.min(sp[1], to);
      if (b <= a) return;
      for (let t = dayStartMs(dayKey(a)); t < b; t += DAY) set[dayKey(t + 3600000)] = true;
    });
    return set;
  }
  /* 연도별 장비 가동 통계 — 가동률은 KPI 산식(정상 가동일 ÷ 기간 일수), 다운타임은 신고→복귀 시간 */
  function yearStats(year, now) {
    now = now || Date.now();
    return rangeStats(dayStartMs(year + "-01-01"), Math.min(dayStartMs((year + 1) + "-01-01"), now));
  }
  function repairYears() {
    const ys = {};
    st.repairs.forEach(r => { if (r.reportedAtMs) ys[Number(dayKey(r.reportedAtMs).slice(0, 4))] = true; });
    ys[Number(todayKey().slice(0, 4))] = true;
    return Object.keys(ys).map(Number).sort((a, b) => b - a);
  }

  /* ─────── 환경센서 (CARES sensorEnv v2와 같은 기준) ─────── */
  const DEVICE_ORDER = ["ICN_CARGO_B", "ICN_ETD_CASE", "ICN_SEARCH_ROOM"];
  const DEVICES = {
    ICN_CARGO_B: { name: "화물터미널 입구", role: "준옥외 · 외기 부하" },
    ICN_ETD_CASE: { name: "ETD 보호케이스", role: "ETD 흡입 공기" },
    ICN_SEARCH_ROOM: { name: "검색실", role: "X-ray 설치 실내" }
  };
  const METRICS = [
    { key: "temp", label: "온도", unit: "℃", dec: 1 },
    { key: "humidity", label: "습도", unit: "%", dec: 0 },
    { key: "dewPoint", label: "이슬점", unit: "℃", dec: 1 },
    { key: "co2", label: "CO₂", unit: "ppm", dec: 0 },
    { key: "pm25", label: "PM2.5", unit: "㎍/㎥", dec: 0 },
    { key: "pm10", label: "PM10", unit: "㎍/㎥", dec: 0 },
    { key: "tvoc", label: "TVOC", unit: "mg/㎥", dec: 2 },
    { key: "hcho", label: "HCHO", unit: "mg/㎥", dec: 3 }
  ];
  /* 서버 임계치가 없을 때의 권장값 (CARES src/constants/sensorEnv.ts RECOMMENDED_THRESHOLDS) */
  const REC_TH = {
    ICN_CARGO_B: { temp: [0, 40], humidity: [null, 90], dewPoint: [null, 27], co2: [null, 2000], pm25: [null, 50], pm10: [null, 100], tvoc: [null, 3], hcho: [null, 0.1] },
    ICN_ETD_CASE: { temp: [5, 35], humidity: [20, 85], dewPoint: [null, 25], co2: [null, 2000], pm25: [null, 35], pm10: [null, 75], tvoc: [null, 1], hcho: [null, 0.1] },
    ICN_SEARCH_ROOM: { temp: [10, 30], humidity: [20, 70], dewPoint: [null, 18], co2: [null, 1000], pm25: [null, 35], pm10: [null, 75], tvoc: [null, 1], hcho: [null, 0.1] }
  };
  function thFor(id, key) {
    const s = st.thresholds[id] && st.thresholds[id][key];
    if (s && typeof s === "object" && (s.min != null || s.max != null)) return { min: s.min == null ? null : Number(s.min), max: s.max == null ? null : Number(s.max) };
    const r = (REC_TH[id] || REC_TH.ICN_SEARCH_ROOM)[key];
    return r ? { min: r[0], max: r[1] } : { min: null, max: null };
  }
  /* 이슬점 — Magnus-Tetens (CARES dewPointC와 동일) */
  function dewPoint(t, rh) {
    if (t == null || rh == null || !isFinite(t) || !isFinite(rh) || rh <= 0 || rh > 100) return null;
    const a = Math.log(rh / 100) + (17.62 * t) / (243.12 + t);
    const d = 17.62 - a;
    return d === 0 ? null : +((243.12 * a) / d).toFixed(1);
  }
  function exceed(v, th) {
    if (v == null || !th) return false;
    return (th.max != null && v > th.max) || (th.min != null && v < th.min);
  }
  function isOffline(r, now) {
    if (!r) return true;
    if (r.online === false) return true;
    const ms = r.timestamp ? Date.parse(r.timestamp) : 0;
    return !ms || (now || Date.now()) - ms > OFFLINE_MS;
  }
  function sensorRows(now) {
    const ids = DEVICE_ORDER.concat(Object.keys(st.sensors).filter(k => DEVICE_ORDER.indexOf(k) < 0));
    return ids.filter(id => st.sensors[id] || DEVICES[id]).map(id => {
      const r = st.sensors[id] || null;
      const off = isOffline(r, now);
      const vals = {};
      if (r && !off) {
        METRICS.forEach(m => { vals[m.key] = typeof r[m.key] === "number" ? r[m.key] : null; });
        vals.dewPoint = dewPoint(vals.temp, vals.humidity);
      }
      const over = off ? [] : METRICS.filter(m => exceed(vals[m.key], thFor(id, m.key))).map(m => m.key);
      return { id, name: (DEVICES[id] && DEVICES[id].name) || id, role: (DEVICES[id] && DEVICES[id].role) || "",
        at: r && r.timestamp ? Date.parse(r.timestamp) : 0, offline: off, vals, over };
    });
  }
  /* 결로 위험 교차 판정 — 가장 습한 지점의 이슬점과 가장 차가운 지점의 온도 (CARES assessCondensation) */
  function condensation(rows) {
    const pts = (rows || []).filter(r => !r.offline);
    const withDew = pts.filter(p => p.vals.dewPoint != null), withT = pts.filter(p => p.vals.temp != null);
    if (!withDew.length || !withT.length) return { level: "unknown", margin: null, text: "온도·습도 수신값이 부족합니다." };
    const wet = withDew.reduce((a, b) => (a.vals.dewPoint >= b.vals.dewPoint ? a : b));
    const cold = withT.reduce((a, b) => (a.vals.temp <= b.vals.temp ? a : b));
    const margin = Math.round((cold.vals.temp - wet.vals.dewPoint) * 10) / 10;
    if (wet.id === cold.id) return { level: "safe", margin, wet, cold, text: "가장 습한 곳과 가장 차가운 곳이 같아 지점 간 결로 위험 없음" };
    const head = wet.name + " 이슬점 " + wet.vals.dewPoint + "℃ · " + cold.name + " " + cold.vals.temp + "℃";
    if (margin <= 0) return { level: "danger", margin, wet, cold, text: head + " — 반입·문 개방 시 결로 발생 조건" };
    if (margin <= 3) return { level: "watch", margin, wet, cold, text: head + " — X-ray 터널 내벽·검출기 결로 주의" };
    return { level: "safe", margin, wet, cold, text: head };
  }

  /* ─────── 환경센서 24시간 (v1.28) ───────
     한 줄 = [기기, 시각(ms), 온도, 습도, CO₂, PM2.5, PM10, TVOC, HCHO] — 이 브라우저(localStorage)에 24시간치만.
     다시 읽을 때는 마지막 수신 시각 이후만 요청한다(Firestore 문서 읽기 절약). */
  const ENV_FIELDS = ["deviceId", "timestamp", "online", "temp", "humidity", "co2", "pm25", "pm10", "tvoc", "hcho"];
  const ENV_KEYS = ["temp", "humidity", "co2", "pm25", "pm10", "tvoc", "hcho"];
  const numOrNull = (v) => typeof v === "number" && isFinite(v) ? v : null;
  function envRead() {
    try {
      const j = JSON.parse(localStorage.getItem(ENV_CACHE) || "null");
      return j && j.v === 1 && Array.isArray(j.rows) ? j.rows.filter(r => Array.isArray(r) && r.length === 9 && typeof r[1] === "number") : [];
    } catch (e) { return []; }
  }
  function envWrite(rows) {
    try { localStorage.setItem(ENV_CACHE, JSON.stringify({ v: 1, rows })); } catch (e) { /* 저장 불가(용량·차단) — 이번 화면만 */ }
  }
  const envObj = (r) => ({ d: r[0], t: r[1], temp: r[2], humidity: r[3], co2: r[4], pm25: r[5], pm10: r[6], tvoc: r[7], hcho: r[8] });
  async function fetchEnv() {
    const now = Date.now();
    const from = now - ENV_HOURS * 3600000;
    const seen = {};
    const rows = (st.env.length ? st.env.map(o => [o.d, o.t].concat(ENV_KEYS.map(k => o[k]))) : envRead()).filter(r => r[1] >= from);
    rows.forEach(r => { seen[r[0] + "|" + r[1]] = 1; });
    let since = rows.reduce((m, r) => Math.max(m, r[1]), from);
    for (let page = 0; page < 3; page++) {
      const got = await fsQuery({ select: sel(ENV_FIELDS), from: [{ collectionId: "sensorLogs" }],
        where: { fieldFilter: { field: { fieldPath: "timestamp" }, op: "GREATER_THAN", value: { timestampValue: new Date(since).toISOString() } } },
        orderBy: [{ field: { fieldPath: "timestamp" }, direction: "ASCENDING" }], limit: ENV_PAGE });
      got.forEach(g => {
        const t = g.timestamp ? Date.parse(g.timestamp) : 0;
        if (!t || t < from || g.online === false) return;
        const d = g.deviceId || DEVICE_ORDER[0];
        if (seen[d + "|" + t]) return;
        seen[d + "|" + t] = 1;
        rows.push([d, t].concat(ENV_KEYS.map(k => numOrNull(g[k]))));
      });
      const last = got.reduce((m, g) => Math.max(m, g.timestamp ? Date.parse(g.timestamp) || 0 : 0), 0);
      if (got.length < ENV_PAGE || !(last > since)) break;
      since = last;
    }
    rows.sort((a, b) => a[1] - b[1]);
    envWrite(rows);
    st.env = rows.map(envObj);
    st.errs.env = null;
  }
  /* 기기별 24시간 시계열 { id: [{ t, temp, humidity, dewPoint, … }] } */
  function envSeries() {
    const out = {};
    st.env.forEach(o => {
      (out[o.d] = out[o.d] || []).push(Object.assign({}, o, { dewPoint: dewPoint(o.temp, o.humidity) }));
    });
    return out;
  }

  /* ─────── 기간 가동 통계 (v1.28) — yearStats 와 같은 산식을 임의 기간 [from, to) 로 ─────── */
  function rangeStats(from, to) {
    to = Math.min(to || Date.now(), Date.now());
    return units().map(u => {
      let start = from;
      const led = u.ledger;
      const inst = led && (led.installed || led.mfgDate);
      if (inst && /^\d{4}-\d{2}-\d{2}$/.test(inst)) start = Math.max(start, dayStartMs(inst));
      const days = to > start ? Math.ceil((to - start) / DAY) : 0;
      const dd = Object.keys(downDays(u.id, start, to)).length;
      let downMs = 0, n = 0, fixed = 0, fixMs = 0;
      const causes = {};
      st.repairs.forEach(r => {
        if (r.equipmentId !== u.id) return;
        const sp = spanOf(r, to);
        const a = Math.max(sp[0], start), b = Math.min(sp[1], to);
        if (b > a) downMs += b - a;
        if (r.reportedAtMs >= start && r.reportedAtMs < to) {
          n++;
          const c = CAUSE[r.causeCategory] ? r.causeCategory : "other";
          causes[c] = (causes[c] || 0) + 1;
          if (r.resolvedAtMs) { fixed++; fixMs += r.resolvedAtMs - r.reportedAtMs; }
        }
      });
      return { unit: u, from: start, days, downDays: dd, avail: days ? (days - dd) / days : null, downMs, count: n,
        mttrMs: fixed ? fixMs / fixed : null, fixed, fixMs, causes };
    });
  }

  /* ─────── 위해물품 적발 월 집계 (v1.36) ───────
     CARES hazStats/{YYYY-MM} = { total, cat:{liquid,powder,mixed,other,none}, loc:{'1','2','3',etc}, day:{DD}, withdrawn, review }
     작성은 프로에스콤(CARES 웹 '위해물품 적발 일지'). 여기서는 월 숫자만 쓴다. */
  const HAZ_CATS = [["liquid", "액체"], ["powder", "분말"], ["mixed", "분·액"], ["other", "기타"], ["none", "미기재"]];
  const ymKST = (off) => { const d = new Date(Date.now() + KST); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (off || 0), 1));
    return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0"); };
  const num = (v) => typeof v === "number" && isFinite(v) ? v : 0;
  function hazMonth(ym) {
    const d = st.haz.find(x => x.id === ym);
    const cat = {}, loc = {};
    HAZ_CATS.forEach(([k]) => { cat[k] = num(d && d.cat && d.cat[k]); });
    ["1", "2", "3", "etc"].forEach(k => { loc[k] = num(d && d.loc && d.loc[k]); });
    return { ym, has: !!d, total: num(d && d.total), cat, loc, withdrawn: num(d && d.withdrawn), review: num(d && d.review), day: (d && d.day) || {} };
  }
  /* 끝 달(기본 이번 달)까지 n개월 */
  function hazSeries(n, endYm) {
    const end = endYm || ymKST(0);
    const [y, m] = end.split("-").map(Number);
    return Array.from({ length: n }, (_, i) => { const t = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
      return hazMonth(t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0")); });
  }

  /* 상세 모달용 — 고장 1건의 사진(data URL) */
  async function repairPhotos(id) {
    const d = await fsGet("repairLogs/" + encodeURIComponent(id), ["reportPhotos", "repairPhotos"]);
    const ok = (a) => (Array.isArray(a) ? a : []).filter(u => typeof u === "string" && /^(data:image\/|https:\/\/)/.test(u));
    return { report: ok(d.reportPhotos), repair: ok(d.repairPhotos) };
  }

  window.SemisCares = {
    CARES_URL, load, onLoad, fresh, has, failed, allInspections, get state() { return st; },
    units, unitById, stateLabel, stateTone, repairStatus, RS_META, CAUSE, INS_TYPE, KIND_LABEL, kindOf, laneOf, normSN, ledgerBySN,
    inspIndex, badCount, cautionCount, yearStats, rangeStats, repairYears, downDays, spanOf,
    DEVICES, DEVICE_ORDER, METRICS, thFor, dewPoint, exceed, isOffline, sensorRows, condensation, repairPhotos, envSeries, ENV_CACHE,
    dayKey, todayKey, dayStartMs, lastDays, hm, mdk, fmtMs, fmtDur, HAZ_CATS, hazMonth, hazSeries, ymKST, HAZ_URL: CARES_URL + "/#/hazard",
    _setFetch(fn) { fetchImpl = fn; }, _reset() { st.ts = 0; st.err = null; st.loading = false; st.parts = { live: 0, repairs: 0, history: 0, env: 0, haz: 0 }; st.errs = {};
      st.equips = []; st.repairs = []; st.inspections = []; st.todayIns = []; st.periodic = []; st.sensors = {}; st.thresholds = {}; st.env = []; st.haz = []; apiKey = null; }
  };
})();
