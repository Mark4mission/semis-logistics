/* SeMIS · Logistics — Supabase Edge Function "semis-logi-adsb" (v1.14)
   에어제타 기체의 ADS-B 위치를 adsb.lol(무료 · ODbL)에서 받아 public.semis_logi_adsb 에 마지막 상태로 보관하고,
   지상↔공중 전환을 입출항 기록(public.semis_logi_adsb_events)으로 남긴다. 스케줄 자료는 쓰지 않는다.
   - adsb.lol 은 브라우저 직접 호출(CORS)을 막아 두어 이 함수가 중계한다.
   - adsb.lol 조회는 50초에 한 번(_meta 행 조건부 갱신으로 잠금). pg_cron 이 2분마다 ?cron=1 로 호출해 끊김 없이 기록.
   - 기체 목록: semis_logi_store.fleet[].hex (없으면 기본 15대)
   - GET ?trail=1 → 비행 경로 포함 · ?events=1 → 최근 48시간 입출항 기록 포함
   - 배포: Supabase MCP deploy_edge_function (verify_jwt true, anon 키로 호출). 이 파일이 원본. */
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false }
});
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
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

async function fleetHex(): Promise<string[]> {
  try {
    const { data } = await db.from("semis_logi_store").select("value").eq("key", "fleet").maybeSingle();
    const list = (Array.isArray(data?.value) ? data!.value : []).map((f: { hex?: string }) => String(f.hex || "").toLowerCase())
      .filter((h: string) => /^[0-9a-f]{6}$/.test(h));
    if (list.length) return Array.from(new Set(list)) as string[];
  } catch (_) { /* 기본값 */ }
  return DEFAULT_HEX;
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
      const flight = a.flight ? String(a.flight).trim() : (p?.flight as string) || null;
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
  let note = "";
  try { note = await refresh(); } catch (e) { note = "error " + (e as Error).message; }
  if (u.searchParams.get("cron") === "1") return json({ ok: true, note });
  const cols = COLS + (u.searchParams.get("trail") === "1" ? ",trail" : "") + ",fetched_at,err";
  const { data, error } = await db.from("semis_logi_adsb").select(cols);
  if (error) return json({ error: error.message }, 500);
  const rows = (data || []) as unknown as Row[];
  const meta = rows.find(r => r.hex === "_meta") || {};
  const out: Row = {
    now: iso(Date.now()), note, fetched_at: meta.fetched_at || null, err: meta.err || null, src: "adsb.lol (ODbL)",
    ac: rows.filter(r => r.hex !== "_meta").map(r => { delete r.fetched_at; delete r.err; return r; })
  };
  if (u.searchParams.get("events") === "1") {
    const { data: ev } = await db.from("semis_logi_adsb_events").select("hex,reg,flight,kind,apt,at,inferred")
      .gte("at", iso(Date.now() - 48 * 3600_000)).order("at", { ascending: false }).limit(300);
    out.events = ev || [];
  }
  return json(out);
});
