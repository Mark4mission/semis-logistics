/* SeMIS · Logistics — Supabase Edge Function "semis-logi-adsb" (v1.14 · v1.24.1 편명 보정)
   에어제타 기체의 ADS-B 위치를 adsb.lol(무료 · ODbL)에서 받아 public.semis_logi_adsb 에 마지막 상태로 보관하고,
   지상↔공중 전환을 입출항 기록(public.semis_logi_adsb_events)으로 남긴다. 스케줄 자료는 쓰지 않는다.
   - adsb.lol 은 브라우저 직접 호출(CORS)을 막아 두어 이 함수가 중계한다.
   - adsb.lol 조회는 50초에 한 번(_meta 행 조건부 갱신으로 잠금). pg_cron 이 2분마다 ?cron=1 로 호출해 끊김 없이 기록.
   - 기체 목록: semis_logi_store.fleet[].hex (없으면 기본 15대)
   - GET ?trail=1 → 비행 경로 포함 · ?events=1 → 최근 48시간 입출항 기록 포함 · 응답에 기체 목록 fleet(공용 DB 에 있을 때)
   - 출입(v1.80): H:drive 로그인 세션(x-semis-token) 또는 현장 웹앱 PIN 표(x-flight-token) — 판정은 SQL semis_logi_flight_gate
     (tools/sql/semis-logi-flight.sql, strict 가 꺼져 있으면 모두 통과). ?cron=1 은 기록만 하고 위치를 돌려주지 않으므로 확인하지 않음
   - 실시간(v1.81 · 현장 웹앱): GET ?live=1 → adsb.lol 을 5초 간격으로 받아 DB 를 거치지 않고 그대로 돌려준다(기록 · 입출항 판정은 위 경로만).
     ?live=1&stream=1 → 한 번 연결로 5초마다 이어 보냄(text/event-stream, 처음엔 전체 · 그 뒤엔 바뀐 기체만). 연결 하나 = 호출 1건.
     조회는 이 함수 인스턴스 안에서 화면 여럿이 함께 쓰고(4.5초 안이면 다시 묻지 않음), 실패하면 10초 → 60초로 물러난다. 출입 확인은 같음.
   - 배포: Supabase MCP deploy_edge_function (verify_jwt true, anon 키로 호출). 이 파일이 원본. */
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false }
});
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-semis-token, x-flight-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
const MIN_GAP = 50_000;            // adsb.lol 조회 최소 간격
const TRAIL_GAP = 240;             // 경로 점 간격(초)
const TRAIL_KEEP = 20 * 3600;      // 경로 보관(초)
const TRAIL_MAX = 400;
const RECENT = 20 * 60_000;        // 직전 수신이 이 안이면 착륙·이륙 시각을 그대로 인정
const EVENT_KEEP_DAYS = 45;
const DEFAULT_HEX = ["71bc17", "71bc19", "71bc20", "71bc21", "71bc23", "71bc36", "71be16", "71be20", "71be45", "71be46",
  "71bd07", "71c319", "71c338", "71c355", "71c503"];
const COLS = "hex,reg,type,flight,lat,lon,alt,gnd,gnd_inferred,gs,trk,vr,sqk,emg,pos_at,seen_at,gnd_since,air_since,updated_at";
const EMG_SQK = ["7500", "7600", "7700"];
/* 공항 좌표 — js/flightcore.js AIRPORTS 와 같은 목록 */
const APTS: Record<string, [number, number]> = {"ICN":[37.4602,126.4407],"GMP":[37.5583,126.7906],"PUS":[35.1795,128.9382],"CJU":[33.5113,126.493],"CJJ":[36.7166,127.4991],"TAE":[35.8941,128.6589],"MWX":[34.9914,126.3828],"NRT":[35.772,140.3929],"HND":[35.5494,139.7798],"KIX":[34.4347,135.244],"NGO":[34.8584,136.8054],"FUK":[33.5859,130.4507],"CTS":[42.7752,141.6923],"OKA":[26.1958,127.6459],"PVG":[31.1443,121.8083],"SHA":[31.1979,121.3363],"PEK":[40.0799,116.6031],"PKX":[39.5098,116.4105],"TSN":[39.1244,117.3464],"YNT":[37.6572,120.9872],"TAO":[36.3619,120.0883],"CTU":[30.5785,103.9471],"TFU":[30.3197,104.445],"CAN":[23.3924,113.2988],"SZX":[22.6393,113.8107],"XMN":[24.544,118.1277],"HGH":[30.2295,120.4344],"NKG":[31.742,118.862],"CGO":[34.5197,113.8409],"WUH":[30.7838,114.2081],"SHE":[41.6398,123.4834],"DLC":[38.9657,121.5386],"CKG":[29.7192,106.6417],"XIY":[34.4471,108.7516],"KMG":[25.1019,102.9292],"TNA":[36.8572,117.2158],"HKG":[22.308,113.9185],"MFM":[22.1496,113.5916],"TPE":[25.0797,121.2342],"KHH":[22.5771,120.35],"HAN":[21.2212,105.8072],"SGN":[10.8188,106.6519],"DAD":[16.0439,108.1994],"BKK":[13.69,100.7501],"DMK":[13.9126,100.6067],"SIN":[1.3644,103.9915],"KUL":[2.7456,101.7072],"MNL":[14.5086,121.0198],"CRK":[15.186,120.56],"CGK":[-6.1256,106.6559],"DAC":[23.8433,90.3978],"DEL":[28.5562,77.1],"BOM":[19.0896,72.8656],"MAA":[12.9941,80.1709],"ALA":[43.3521,77.0405],"NQZ":[51.0222,71.4669],"TAS":[41.2579,69.2812],"NVI":[40.1172,65.1708],"DXB":[25.2532,55.3657],"DWC":[24.8961,55.1614],"DOH":[25.2731,51.6081],"IST":[41.2753,28.7519],"STN":[51.885,0.235],"LHR":[51.47,-0.4543],"FRA":[50.0379,8.5622],"HHN":[49.9487,7.2639],"VIE":[48.1103,16.5697],"MXP":[45.6306,8.7281],"BRU":[50.9014,4.4844],"LGG":[50.6374,5.4432],"AMS":[52.3105,4.7683],"CDG":[49.0097,2.5479],"LUX":[49.6233,6.2044],"MUC":[48.3538,11.7861],"BUD":[47.4298,19.2611],"WAW":[52.1657,20.9671],"PRG":[50.1008,14.26],"LEJ":[51.4239,12.2363],"CGN":[50.8659,7.1427],"MAD":[40.4983,-3.5676],"ANC":[61.1743,-149.9982],"FAI":[64.8151,-147.8561],"SEA":[47.4502,-122.3088],"LAX":[33.9416,-118.4085],"SFO":[37.6213,-122.379],"ONT":[34.056,-117.6012],"LAS":[36.084,-115.1537],"ORD":[41.9742,-87.9073],"RFD":[42.1954,-89.0972],"DFW":[32.8998,-97.0403],"IAH":[29.9902,-95.3368],"ATL":[33.6407,-84.4277],"JFK":[40.6413,-73.7781],"EWR":[40.6895,-74.1745],"MIA":[25.7959,-80.287],"CVG":[39.0488,-84.6678],"IND":[39.7173,-86.2944],"MEM":[35.0421,-89.9792],"SDF":[38.1744,-85.736],"HNL":[21.3187,-157.9225],"GUM":[13.4834,144.796],"YVR":[49.1967,-123.1815],"YYZ":[43.6777,-79.6248]};

type Row = Record<string, unknown>;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" }
});
const iso = (ms: number) => new Date(ms).toISOString();
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/* 응답에 빠진 값(콜사인 · 속도 등이 잠깐 안 올 때) — 기존 행이 있으면 그대로 두고(undefined → 필드 제외), 없으면 null */
const keep = (p: unknown) => (p ? undefined : null);
/* 콜사인 — 트랜스폰더가 비워 보내면 "@@@@@@@@" 같은 값이 온다. 영문 · 숫자 2~8자만 인정 */
const flOk = (v: unknown) => typeof v === "string" && /^[A-Z0-9]{2,8}$/.test(v.trim().toUpperCase());
function distKm(a1: number, o1: number, a2: number, o2: number) {
  const r = Math.PI / 180, dp = (a2 - a1) * r, dl = (o2 - o1) * r;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dl / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function nearestApt(lat: unknown, lon: unknown, maxKm = 12): string | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  let best: string | null = null, bd = Infinity;
  for (const k of Object.keys(APTS)) {
    const d = distKm(lat, lon, APTS[k][0], APTS[k][1]);
    if (d < bd) { bd = d; best = k; }
  }
  return bd <= maxKm ? best : null;
}

type Fleet = { reg: string; hex: string; type: string; model: string };
const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
/* 공용 DB 기체 목록 — 없거나 읽지 못하면 null(화면 · 조회는 기본 15대) */
async function fleetList(): Promise<Fleet[] | null> {
  try {
    const { data } = await db.from("semis_logi_store").select("value").eq("key", "fleet").maybeSingle();
    const seen = new Set<string>();
    const list = (Array.isArray(data?.value) ? data!.value : []).map((f: Record<string, unknown>) => ({
      reg: str(f && f.reg, 12), hex: str(f && f.hex, 6).toLowerCase(), type: str(f && f.type, 8), model: str(f && f.model, 40)
    })).filter((f: Fleet) => /^[0-9a-f]{6}$/.test(f.hex) && !seen.has(f.hex) && !!seen.add(f.hex));
    return list.length ? list as Fleet[] : null;
  } catch (_) { return null; }
}
async function fleetHex(): Promise<string[]> {
  const fl = await fleetList();
  return fl ? fl.map(f => f.hex) : DEFAULT_HEX;
}
/* 출입 — 로그인 세션 토큰을 그대로 넘겨 SQL 이 판정. 오류 · 시간 초과는 막음 */
async function allowed(req: Request): Promise<boolean> {
  const st = (req.headers.get("x-semis-token") || "").trim();
  const ft = (req.headers.get("x-flight-token") || "").trim();
  if (st.length > 100 || ft.length > 100) return false;
  try {
    const c = createClient(SB_URL, ANON_KEY, { auth: { persistSession: false }, global: { headers: st ? { "x-semis-token": st } : {} } });
    const { data, error } = await c.rpc("semis_logi_flight_gate", { p_ftok: ft || null });
    return !error && data === true;
  } catch (_) { return false; }
}

/* ── 실시간 중계(v1.81) — DB 를 읽지도 쓰지도 않는다(기체 목록만 5분에 한 번) ── */
const LIVE_UA = "H-drive/1.81 (AirZeta ICN cargo team field map; live)";
const LIVE_GAP = 4_500;            // adsb.lol 실시간 조회 최소 간격
const LIVE_TICK = 5_000;           // 이어 보내는 간격
const LIVE_STREAM_MS = 105_000;    // 한 번 연결로 보내는 시간 — 실행 한도(무료 150초) 안쪽. 그 전에 끊겨도 화면이 바로 다시 잇는다
const LIVE_HEX_KEEP = 300_000;
/* 한 줄 = [hex, lat, lon, alt, gs, trk, vr, 지상(1 · 0 · null=모름), sqk, 비상(1 · 0), 편명, 위치 나이(초), 수신 나이(초)] */
type LRow = (string | number | null)[];
type Snap = { t: number; at: number; rows: LRow[]; err: boolean };
let liveSnap: Snap = { t: 0, at: 0, rows: [], err: false };
let liveBusy: Promise<void> | null = null;
let liveFail = 0, liveHold = 0;
let liveHex: string[] | null = null, liveHexAt = 0;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const rd = (v: unknown, m: number) => (fin(v) ? Math.round(v * m) / m : null);
function liveRow(a: Record<string, unknown>, hexes: string[]): LRow | null {
  const hex = String(a.hex || "").toLowerCase().replace(/^~/, "");
  if (hexes.indexOf(hex) < 0) return null;
  const lp = a.lastPosition as Record<string, unknown> | undefined;
  const pos = fin(a.lat) && fin(a.lon) ? { lat: a.lat, lon: a.lon, sp: Number(a.seen_pos) || 0 }
    : lp && fin(lp.lat) && fin(lp.lon) ? { lat: lp.lat, lon: lp.lon, sp: Number(lp.seen_pos) || 0 } : null;
  const alt = fin(a.alt_baro) ? a.alt_baro : (fin(a.alt_geom) ? a.alt_geom : null);
  // 지상/공중 — 기록 경로(refresh)와 같은 기준. 확정 못 하면 null(화면이 직전 상태를 유지)
  const airSure = a.alt_baro !== "ground" && ((alt ?? 0) >= 800 || (Number(a.gs) || 0) >= 150);
  const g = a.alt_baro === "ground" ? 1 : airSure ? 0 : null;
  const sqk = a.squawk ? String(a.squawk).slice(0, 4) : null;
  const emg = (a.emergency && a.emergency !== "none") || (sqk ? EMG_SQK.indexOf(sqk) >= 0 : false);
  return [hex, pos ? rd(pos.lat, 1e5) : null, pos ? rd(pos.lon, 1e5) : null, g === 1 ? null : rd(alt, 1), rd(a.gs, 10),
    rd(a.track ?? a.true_heading, 10), rd(a.baro_rate ?? a.geom_rate, 1), g, sqk, emg ? 1 : 0,
    flOk(a.flight) ? String(a.flight).trim().toUpperCase() : null, pos ? rd(pos.sp, 10) : null, rd(Number(a.seen) || 0, 10)];
}
async function liveFetch(): Promise<void> {
  try {
    if (!liveHex || Date.now() - liveHexAt > LIVE_HEX_KEEP) { liveHex = await fleetHex(); liveHexAt = Date.now(); }
    const hexes = liveHex;
    const res = await fetch("https://api.adsb.lol/v2/hex/" + hexes.join(","), {
      headers: { "User-Agent": LIVE_UA }, signal: AbortSignal.timeout(4_000)
    });
    if (!res.ok) throw new Error("adsb.lol HTTP " + res.status);
    const j = await res.json();
    const at = Date.now();
    let t0 = Number(j.now) || at;
    if (Math.abs(at - t0) > 120_000) t0 = at;                     // 원본 시계가 크게 다르면 이쪽 시계로
    const rows: LRow[] = [];
    for (const a of (Array.isArray(j.ac) ? j.ac : [])) { const r = liveRow(a, hexes); if (r) rows.push(r); }
    liveSnap = { t: t0, at, rows, err: false };
    liveFail = 0;
  } catch (_) {
    liveFail++;
    liveHold = Date.now() + Math.min(60_000, LIVE_TICK * 2 ** Math.min(liveFail, 4));
    liveSnap = { ...liveSnap, err: true };
  }
}
async function liveGet(): Promise<Snap> {
  const now = Date.now();
  if (now - liveSnap.at < LIVE_GAP || now < liveHold) return liveSnap;
  if (!liveBusy) liveBusy = liveFetch().finally(() => { liveBusy = null; });
  await liveBusy;
  return liveSnap;
}
/* t = 자료 기준 시각(ms) · a = 그 뒤 지난 시간(ms) · ac = 줄 · e = 원본 조회 실패(직전 자료) */
function liveMsg(s: Snap, rows: LRow[]): Row {
  const o: Row = { t: s.t, a: Math.max(0, Date.now() - s.t), ac: rows };
  if (s.err) o.e = 1;
  return o;
}
function liveStream(req: Request): Response {
  const enc = new TextEncoder();
  const until = Date.now() + LIVE_STREAM_MS;
  const sent = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined, closed = false, stop = () => { closed = true; };
  /* 보내는 동안 이 인스턴스가 먼저 정리되지 않게 붙잡아 둠(Supabase EdgeRuntime.waitUntil — 로컬 시험에는 없음) */
  let release = () => {};
  const held = new Promise<void>((r) => { release = r; });
  try { (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(held); } catch (_) { /* 없으면 그대로 */ }
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      stop = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        release();
        try { ctrl.close(); } catch (_) { /* 이미 닫힘 */ }
      };
      const push = (o: unknown) => { try { ctrl.enqueue(enc.encode("data: " + JSON.stringify(o) + "\n\n")); } catch (_) { stop(); } };
      const tick = async () => {
        if (closed) return;
        const began = Date.now();
        const s = await liveGet();
        if (closed) return;
        const rows: LRow[] = [];
        for (const r of s.rows) {
          const k = JSON.stringify(r.slice(0, 11));
          if (sent.get(r[0] as string) !== k) { sent.set(r[0] as string, k); rows.push(r); }
        }
        push(liveMsg(s, rows));
        if (Date.now() >= until) { push({ end: 1 }); stop(); return; }
        timer = setTimeout(tick, Math.max(1_000, LIVE_TICK - (Date.now() - began)));
      };
      req.signal.addEventListener("abort", () => stop());
      tick();
    },
    cancel() { closed = true; clearTimeout(timer); release(); }
  });
  return new Response(body, { headers: { ...CORS, "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

async function refresh(): Promise<string> {
  const now = Date.now();
  const { data: lock } = await db.from("semis_logi_adsb").update({ fetched_at: iso(now) })
    .eq("hex", "_meta").lt("fetched_at", iso(now - MIN_GAP)).select("hex");
  if (!lock || !lock.length) return "cached";
  try {
    const hexes = await fleetHex();
    const res = await fetch("https://api.adsb.lol/v2/hex/" + hexes.join(","), {
      headers: { "User-Agent": "SeMIS-Logistics/1.14 (AirZeta ICN cargo team dashboard)" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!res.ok) throw new Error("adsb.lol HTTP " + res.status);
    const j = await res.json();
    const t0 = Number(j.now) || now;
    const { data: prev } = await db.from("semis_logi_adsb")
      .select("hex,reg,flight,lat,lon,alt,gnd,gnd_inferred,trail,gnd_since,air_since,pos_at,seen_at").neq("hex", "_meta");
    const pm = new Map(((prev || []) as Row[]).map(r => [r.hex as string, r]));
    const rows: Row[] = [];
    const events: Row[] = [];
    const seenHex = new Set<string>();
    const airFlight: { hex: string; flight: string }[] = [];
    for (const a of (j.ac || [])) {
      const hex = String(a.hex || "").toLowerCase().replace(/^~/, "");
      if (hexes.indexOf(hex) < 0) continue;
      seenHex.add(hex);
      const p = pm.get(hex);
      const pos = a.lat != null && a.lon != null ? { lat: a.lat, lon: a.lon, sp: Number(a.seen_pos) || 0 }
        : a.lastPosition ? { lat: a.lastPosition.lat, lon: a.lastPosition.lon, sp: Number(a.lastPosition.seen_pos) || 0 } : null;
      const seenMs = t0 - (Number(a.seen) || 0) * 1000;
      const posMs = pos ? t0 - pos.sp * 1000 : null;
      const alt = typeof a.alt_baro === "number" ? a.alt_baro : (typeof a.alt_geom === "number" ? a.alt_geom : null);
      // 지상/공중 — 이착륙 활주 중 잠깐 뒤바뀌는 값을 걸러, 공중은 800ft 이상 또는 150kt 이상일 때만 확정
      const airSure = a.alt_baro !== "ground" && ((alt ?? 0) >= 800 || (Number(a.gs) || 0) >= 150);
      const gnd = a.alt_baro === "ground" ? true : airSure ? false : (p ? !!p.gnd : false);
      const prevSeen = p?.seen_at ? Date.parse(p.seen_at as string) : 0;
      const recent = !!prevSeen && seenMs - prevSeen < RECENT;
      const flight = flOk(a.flight) ? String(a.flight).trim().toUpperCase() : (flOk(p?.flight) ? (p!.flight as string) : null);
      const reg = a.r || (p?.reg as string) || null;
      let trail: number[][] = Array.isArray(p?.trail) ? (p!.trail as number[][]) : [];
      let gndSince = (p?.gnd_since as string) || null, airSince = (p?.air_since as string) || null;
      if (gnd) {
        if (!p) gndSince = null;
        else if (!p.gnd) {                                   // 착륙
          gndSince = recent ? iso(seenMs) : null;
          const ap = nearestApt(pos?.lat, pos?.lon, 15);
          events.push({ hex, reg, flight, kind: "arr", apt: ap, lat: pos?.lat ?? null, lon: pos?.lon ?? null, at: iso(seenMs), inferred: !recent });
        }
      } else {
        if (p && p.gnd) {                                    // 이륙 — 출발 공항은 지상에 있던 위치로
          airSince = recent && !p.gnd_inferred ? iso(seenMs) : null;
          trail = [];
          const ap = nearestApt(p.lat, p.lon, 15) || ((alt ?? 99999) < 6000 ? nearestApt(pos?.lat, pos?.lon, 40) : null);
          events.push({ hex, reg, flight, kind: "dep", apt: ap, lat: (p.lat as number) ?? null, lon: (p.lon as number) ?? null,
            at: iso(seenMs), inferred: !recent || !!p.gnd_inferred });
        }
        gndSince = null;
        if (flOk(a.flight)) airFlight.push({ hex, flight: String(a.flight).trim().toUpperCase() });
      }
      if (!gnd && pos && posMs) {
        const ts = Math.round(posMs / 1000);
        const last = trail[trail.length - 1];
        if (!last || ts - last[0] >= TRAIL_GAP) trail = trail.concat([[ts, r4(pos.lat), r4(pos.lon), alt ?? 0]]);
        const cut = Math.round(t0 / 1000) - TRAIL_KEEP;
        trail = trail.filter(x => x[0] >= cut).slice(-TRAIL_MAX);
      }
      const sqk = a.squawk ? String(a.squawk) : null;
      rows.push({
        hex, reg: reg ?? keep(p), type: a.t || keep(p), flight: flight ?? keep(p),
        lat: pos ? pos.lat : keep(p), lon: pos ? pos.lon : keep(p),
        alt: gnd ? null : (alt ?? keep(p)), gnd, gnd_inferred: false,
        gs: a.gs ?? keep(p), trk: a.track ?? a.true_heading ?? keep(p), vr: a.baro_rate ?? a.geom_rate ?? keep(p),
        sqk, emg: (a.emergency && a.emergency !== "none") || (sqk ? EMG_SQK.indexOf(sqk) >= 0 : false),
        pos_at: posMs ? iso(posMs) : (p?.pos_at ?? null), seen_at: iso(seenMs),
        gnd_since: gndSince, air_since: airSince, trail, updated_at: iso(now)
      });
    }
    // 응답에 없는 기체 — 공항 근처 낮은 고도에서 끊겼으면 착륙으로 본다(지상에서 트랜스폰더를 끄는 경우)
    for (const [hex, p] of pm) {
      if (seenHex.has(hex) || hexes.indexOf(hex) < 0 || p.gnd || !p.seen_at) continue;
      const age = now - Date.parse(p.seen_at as string);
      if (age < 10 * 60_000 || age > 45 * 60_000) continue;   // 10분 넘게 안 잡힐 때만(접근 중 잠깐 끊김은 제외)
      if (typeof p.alt !== "number" || (p.alt as number) > 3000) continue;
      const ap = nearestApt(p.lat, p.lon, 15);
      if (!ap) continue;
      rows.push({ hex, gnd: true, gnd_inferred: true, gnd_since: p.seen_at, alt: null, updated_at: iso(now) });
      events.push({ hex, reg: p.reg ?? null, flight: p.flight ?? null, kind: "arr", apt: ap, lat: p.lat ?? null, lon: p.lon ?? null,
        at: p.seen_at, inferred: true });
    }
    // undefined 필드 제거 → upsert 가 기존 값을 유지
    rows.forEach(r => Object.keys(r).forEach(k => { if (r[k] === undefined) delete r[k]; }));
    for (const r of rows) {
      const { error } = await db.from("semis_logi_adsb").upsert(r, { onConflict: "hex" });
      if (error) throw new Error("upsert " + error.message);
    }
    if (events.length) {
      // 같은 기체 · 같은 종류 · 같은 공항이 15분 안에 이미 있으면 건너뜀(값 흔들림 방지)
      const { data: last } = await db.from("semis_logi_adsb_events").select("hex,kind,apt,at")
        .gte("at", iso(now - 60 * 60_000)).order("at", { ascending: false });
      const fresh = events.filter(e => !((last || []) as Row[]).some(l => l.hex === e.hex && l.kind === e.kind && l.apt === e.apt &&
        Math.abs(Date.parse(l.at as string) - Date.parse(e.at as string)) < 15 * 60_000));
      if (fresh.length) {
        const { error } = await db.from("semis_logi_adsb_events").insert(fresh);
        if (error) throw new Error("events " + error.message);
      }
    }
    /* 출발 기록의 편명 보정 — 이륙 순간에는 트랜스폰더가 직전(도착) 편의 콜사인을 그대로 보내는 일이 있다
       (2026-09-29 HL7421: 인천 출발이 도착 편 AIH281 로 기록, 실제는 AIH967). 공중에서 받은 지금 콜사인이
       그 기체의 가장 최근 기록(3시간 안의 출발)과 다르면 지금 콜사인으로 고친다. */
    if (airFlight.length) {
      const { data: recent } = await db.from("semis_logi_adsb_events").select("id,hex,kind,flight,at")
        .in("hex", airFlight.map(x => x.hex)).gte("at", iso(now - 3 * 3600_000)).order("at", { ascending: false });
      for (const x of airFlight) {
        const last = ((recent || []) as Row[]).find(d => d.hex === x.hex);
        if (last && last.kind === "dep" && last.flight !== x.flight) {
          await db.from("semis_logi_adsb_events").update({ flight: x.flight }).eq("id", last.id as number);
        }
      }
    }
    if (new Date(now).getUTCMinutes() < 2) {
      await db.from("semis_logi_adsb_events").delete().lt("at", iso(now - EVENT_KEEP_DAYS * 86400_000));
    }
    await db.from("semis_logi_adsb").update({ err: null }).eq("hex", "_meta");
    return "fetched " + seenHex.size + (events.length ? " events " + events.length : "");
  } catch (e) {
    await db.from("semis_logi_adsb").update({ err: String((e as Error).message || e).slice(0, 200) }).eq("hex", "_meta");
    return "error";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(req.url);
  const live = u.searchParams.get("live") === "1";
  const cron = !live && u.searchParams.get("cron") === "1";        // 실시간은 위치를 돌려주므로 cron 과 함께 와도 출입 확인
  if (!cron && !(await allowed(req))) return json({ error: "auth" }, 401);
  if (live) {
    if (u.searchParams.get("stream") === "1") return liveStream(req);
    const s = await liveGet();
    return json(liveMsg(s, s.rows));
  }
  let note = "";
  try { note = await refresh(); } catch (e) { note = "error " + (e as Error).message; }
  if (cron) return json({ ok: true, note });
  const cols = COLS + (u.searchParams.get("trail") === "1" ? ",trail" : "") + ",fetched_at,err";
  const { data, error } = await db.from("semis_logi_adsb").select(cols);
  if (error) return json({ error: error.message }, 500);
  const rows = (data || []) as unknown as Row[];
  const meta = rows.find(r => r.hex === "_meta") || {};
  const out: Row = {
    now: iso(Date.now()), note, fetched_at: meta.fetched_at || null, err: meta.err || null, src: "adsb.lol (ODbL)",
    ac: rows.filter(r => r.hex !== "_meta").map(r => { delete r.fetched_at; delete r.err; return r; })
  };
  const fl = await fleetList();
  if (fl) out.fleet = fl;
  if (u.searchParams.get("events") === "1") {
    const { data: ev } = await db.from("semis_logi_adsb_events").select("hex,reg,flight,kind,apt,at,inferred")
      .gte("at", iso(Date.now() - 48 * 3600_000)).order("at", { ascending: false }).limit(300);
    out.events = ev || [];
  }
  return json(out);
});
