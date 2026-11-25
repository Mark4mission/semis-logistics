// semis-logi-adsb 로컬 검증 — Supabase REST · RPC · adsb.lol 은 가짜로 바꿔 끼우고 함수를 실제로 띄워 요청한다(출입 · 기체 목록 · cron · 실시간).
// 실행: deno test --node-modules-dir=none --allow-net --allow-env --allow-read tools/edge/semis-logi-adsb.test.ts   (포트 8000 사용 · 실시간 시험은 5초 간격을 기다려 20초쯤 걸림)
import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://supa.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");

type Call = { url: string; method: string; body: Record<string, unknown>; headers: Headers };
const calls: Call[] = [];
let gate: boolean | "err" = false;
let adsb: "ok" | "fail" = "ok", adsbN = 0, lat = 37.3;
let fleet: unknown = [{ reg: " HL7421 ", hex: "71BC21", type: "B744", model: "747-400F" }, { reg: "X", hex: "zz" },
  { reg: "HL7421b", hex: "71bc21" }, { reg: "HL8503", hex: "71c503", type: "B763", model: "767-300F".repeat(9) }];
let iiac: "ok" | "xml" = "ok", standLock = false, adsbRows: unknown = null;
const iiacCalls: URL[] = [];
const STANDS_TXT = await Deno.readTextFile(new URL("../icn-stands/icn-stands.json", import.meta.url));
const TABLE = JSON.parse(STANDS_TXT).stands;
let standsN = 0, standsBad = false;
const KSTs = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().replace(/[-T:]/g, "").slice(0, 12);   // "YYYYMMDDHHmm"(한국 시각)
const T0 = Date.now();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : null;
  const url = String(req ? req.url : input);
  if (url.startsWith("http://localhost")) return realFetch(input, init);
  const method = (init && init.method) || (req && req.method) || "GET";
  const headers = new Headers((init && init.headers) || (req && req.headers) || {});
  let body: Record<string, unknown> = {};
  try { const t = init && typeof init.body === "string" ? init.body : (req ? await req.clone().text() : ""); body = t ? JSON.parse(t) : {}; } catch (_e) { body = {}; }
  calls.push({ url, method, body, headers });
  if (url.startsWith("https://api.adsb.lol/")) {
    adsbN++;
    if (adsb === "fail") return new Response("busy", { status: 429 });
    lat = Math.round((lat + 0.004) * 1e5) / 1e5;
    return new Response(JSON.stringify({ now: Date.now(), ac: [
      { hex: "71BC21", flight: "AIH970  ", lat, lon: 126.512345678, alt_baro: 4100, gs: 182.44, track: 331.26, baro_rate: -832, squawk: "2041", emergency: "none", seen_pos: 0.42, seen: 0.1 },
      { hex: "71c503", flight: "@@@@@@@@", lat: 37.4601, lon: 126.4402, alt_baro: "ground", gs: 0, seen_pos: 3.14, seen: 1.2 },
      { hex: "abcdef", lat: 1, lon: 2, alt_baro: 30000, gs: 450 }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url === "https://hdrive.kr/tools/icn-stands/icn-stands.json") {
    standsN++;
    return new Response(standsBad ? STANDS_TXT.replace("37.47505", "37.47506") : STANDS_TXT, { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith("https://apis.data.go.kr/B551177/statusOfAllFltDeOdp/")) {
    const u = new URL(url);
    iiacCalls.push(u);
    if (iiac === "xml") return new Response("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>", { status: 200 });
    const arr = u.pathname.endsWith("/getFltArrivalsDeOdp");
    const items = arr ? [
      { aircraftRegNo: "HL7421", flightId: "KJ970", estimatedDatetime: KSTs(T0 - 2 * 3600_000), scheduleDatetime: KSTs(T0 - 3 * 3600_000), fstandPosition: "0651", airportCode: "ANC", terminalId: "C02", remark: "도착" },
      { aircraftRegNo: "HL-7421", flightId: "KJ968", estimatedDatetime: KSTs(T0 - 50 * 3600_000), fstandPosition: "612", airportCode: "LAX", terminalId: "C02", remark: "도착" },
      { aircraftRegNo: "HL8503", flightId: "KJ374", estimatedDatetime: KSTs(T0 - 5 * 3600_000), fstandPosition: "999X", airportCode: "NRT", terminalId: "C01", remark: "도착" },
      { aircraftRegNo: "HL7507", flightId: "KJ281", estimatedDatetime: KSTs(T0 - 1 * 3600_000), fstandPosition: "", airportCode: "PVG", terminalId: "C02", remark: "도착" }
    ] : [
      { aircraftRegNo: "HL7421", flightId: "KJ971", estimatedDatetime: KSTs(T0 + 3 * 3600_000), fstandPosition: "645", airportCode: "ANC", terminalId: "C02", remark: "" },
      { aircraftRegNo: "HL7421", flightId: "KJ969", estimatedDatetime: KSTs(T0 - 30 * 60_000), fstandPosition: "612", airportCode: "LAX", terminalId: "C02", remark: "출발" },
      { aircraftRegNo: "HL7507", flightId: "KJ282", estimatedDatetime: KSTs(T0 + 2 * 3600_000), fstandPosition: "652L", airportCode: "PVG", terminalId: "C02", remark: "" }
    ];
    return new Response(JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { items: { item: items }, numOfRows: 500, pageNo: 1, totalCount: items.length } } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/rest/v1/rpc/semis_logi_flight_gate")) {
    if (gate === "err") return new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(gate), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/rest/v1/semis_logi_adsb?") && method === "PATCH") {
    const lockOk = standLock && "stand_fetched_at" in body;
    return new Response(lockOk ? '[{"hex":"_meta"}]' : "[]", { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/rest/v1/semis_logi_store?")) return new Response(JSON.stringify(fleet === null ? null : { value: fleet }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/rest/v1/semis_logi_adsb_events?")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/rest/v1/semis_logi_adsb?") && adsbRows) return new Response(JSON.stringify(adsbRows), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/rest/v1/semis_logi_adsb?")) {
    return new Response(JSON.stringify([{ hex: "_meta", fetched_at: "2026-11-23T00:00:00Z", err: null },
      { hex: "71bc21", reg: "HL7421", lat: 37.4, lon: 126.5, fetched_at: null, err: null }]), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const mod = await import("./semis-logi-adsb.ts");
const get = async (qs = "", h: Record<string, string> = {}) => {
  const r = await realFetch("http://localhost:8000/" + qs, { headers: h });
  return { status: r.status, d: await r.json() };
};
const gateCalls = () => calls.filter(c => c.url.endsWith("/rpc/semis_logi_flight_gate"));
const lockCalls = () => calls.filter(c => c.method === "PATCH");

Deno.test("OPTIONS — 출입 머리글 두 개 허용 · 사전 확인 기억 2시간", async () => {
  const r = await realFetch("http://localhost:8000/", { method: "OPTIONS" });
  await r.text();
  const ah = r.headers.get("access-control-allow-headers") || "";
  assertEquals(ah.includes("x-semis-token") && ah.includes("x-flight-token"), true);
  assertEquals(r.headers.get("access-control-max-age"), "7200");      // 사전 확인을 2시간 기억 — 요청마다 호출이 두 배가 되지 않게
});

Deno.test("출입 없음 → 401 · 위치 · 조회 안 함", async () => {
  calls.length = 0; gate = false;
  const r = await get("?events=1");
  assertEquals(r.status, 401);
  assertEquals(r.d, { error: "auth" });
  assertEquals(gateCalls().length, 1);
  assertEquals(gateCalls()[0].body, { p_ftok: null });
  assertEquals(gateCalls()[0].headers.get("x-semis-token"), null);
  assertEquals(lockCalls().length, 0);
  assertEquals(calls.some(c => c.url.includes("/rest/v1/semis_logi_adsb?")), false);
});

Deno.test("현장 표 → RPC 로 넘김 · 통과면 위치 + 기체 목록(형식 맞는 것만 · 중복 · 길이 정리)", async () => {
  calls.length = 0; gate = true;
  const r = await get("?events=1", { "x-flight-token": "1790000000.2." + "a".repeat(64) });
  assertEquals(r.status, 200);
  assertEquals(gateCalls()[0].body, { p_ftok: "1790000000.2." + "a".repeat(64) });
  assertEquals(r.d.ac.length, 1);
  assertEquals(r.d.fleet.length, 2);
  assertEquals(r.d.fleet[0], { reg: "HL7421", hex: "71bc21", type: "B744", model: "747-400F" });
  assertEquals(r.d.fleet[1].model.length, 40);
  assertEquals(Array.isArray(r.d.events), true);
});

Deno.test("로그인 세션 → x-semis-token 을 그대로 RPC 머리글로", async () => {
  calls.length = 0; gate = true;
  const tok = "b".repeat(64);
  const r = await get("", { "x-semis-token": tok });
  assertEquals(r.status, 200);
  assertEquals(gateCalls()[0].headers.get("x-semis-token"), tok);
  assertEquals(gateCalls()[0].body, { p_ftok: null });
});

Deno.test("RPC 오류 · 너무 긴 표 → 막음(실패는 닫힘)", async () => {
  calls.length = 0; gate = "err";
  assertEquals((await get("", { "x-flight-token": "1.1.1" })).status, 401);
  calls.length = 0; gate = true;
  assertEquals((await get("", { "x-flight-token": "x".repeat(101) })).status, 401);
  assertEquals(gateCalls().length, 0);
});

Deno.test("cron=1 — 출입 확인 없이 기록만(위치는 돌려주지 않음)", async () => {
  calls.length = 0; gate = false;
  const r = await get("?cron=1");
  assertEquals(r.status, 200);
  assertEquals(r.d.ok, true);
  assertEquals(r.d.ac, undefined);
  assertEquals(gateCalls().length, 0);
  assertEquals(lockCalls().length, 1);
});

Deno.test("공용 DB 기체 목록이 없으면 fleet 없음(화면은 기본 15대)", async () => {
  calls.length = 0; gate = true; fleet = null;
  const r = await get("");
  assertEquals(r.status, 200);
  assertEquals(r.d.fleet, undefined);
});

/* ── 실시간(v1.81) — 아래 시험은 순서대로(같은 인스턴스의 조회 보관을 이어 씀) ── */
const loose = { sanitizeOps: false, sanitizeResources: false };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FT = { "x-flight-token": "1790000000.2." + "a".repeat(64) };
const dbCalls = () => calls.filter(c => c.url.includes("/rest/v1/semis_logi_adsb"));

Deno.test("실시간: 출입 없음 → 401 · 원본 조회 안 함 · cron 과 함께 와도 막음", async () => {
  calls.length = 0; gate = false; adsbN = 0;
  assertEquals((await get("?live=1")).status, 401);
  assertEquals((await get("?live=1&stream=1")).status, 401);
  assertEquals((await get("?cron=1&live=1")).status, 401);
  assertEquals((await get("?cron=1&live=1&stream=1")).status, 401);
  assertEquals(adsbN, 0);
  assertEquals(gateCalls().length, 4);
});

Deno.test({ name: "실시간 한 번(?live=1): 줄 모양 · 목록 밖 기체 제외 · DB 를 읽지도 쓰지도 않음 · 4.5초 안에는 다시 묻지 않음", ...loose, fn: async () => {
  calls.length = 0; gate = true; adsb = "ok"; adsbN = 0;
  const r = await get("?live=1", FT);
  assertEquals(r.status, 200);
  assertEquals(adsbN, 1);
  assertEquals(typeof r.d.t, "number");
  assertEquals(r.d.a >= 0 && r.d.a < 5000, true);
  assertEquals(r.d.e, undefined);
  assertEquals(r.d.ac.length, 2);
  assertEquals(r.d.ac[0], ["71bc21", lat, 126.51235, 4100, 182.4, 331.3, -832, 0, "2041", 0, "AIH970", 0.4, 0.1]);
  assertEquals(r.d.ac[1], ["71c503", 37.4601, 126.4402, null, 0, null, null, 1, null, 0, null, 3.1, 1.2]);
  assertEquals(dbCalls().length, 0);
  assertEquals(calls.some(c => c.method === "PATCH" || c.method === "POST" && !c.url.endsWith("/rpc/semis_logi_flight_gate")), false);
  const r2 = await get("?live=1", FT);
  assertEquals(r2.d.ac[0][1], r.d.ac[0][1]);
  assertEquals(adsbN, 1);
  assertEquals(gateCalls().length, 2);
} });

Deno.test({ name: "실시간 이어 받기(stream): 처음엔 전체 · 5초 뒤엔 바뀐 기체만 · 끊으면 원본 조회도 멈춤", ...loose, fn: async () => {
  calls.length = 0; gate = true; adsb = "ok";
  const n0 = adsbN;
  const ac = new AbortController();
  const r = await realFetch("http://localhost:8000/?live=1&stream=1", { headers: FT, signal: ac.signal });
  assertEquals(r.status, 200);
  assertEquals((r.headers.get("content-type") || "").startsWith("text/event-stream"), true);
  assertEquals(r.headers.get("cache-control"), "no-store, no-transform");
  assertEquals(r.headers.get("access-control-allow-origin"), "*");
  const rdr = r.body!.getReader(), dec = new TextDecoder();
  let buf = "";
  const next = async () => {
    for (;;) {
      const i = buf.indexOf("\n\n");
      if (i >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); return JSON.parse(b.replace(/^data: /, "")); }
      const c = await rdr.read();
      if (c.done) throw new Error("끝남");
      buf += dec.decode(c.value, { stream: true });
    }
  };
  const t0 = Date.now();
  const m1 = await next();
  assertEquals(m1.ac.length, 2);                       // 처음 = 전체(직전 조회 보관분)
  assertEquals(Date.now() - t0 < 1500, true);
  const m2 = await next();
  const dt = Date.now() - t0;
  assertEquals(dt > 3500 && dt < 8000, true);
  assertEquals(adsbN, n0 + 1);
  assertEquals(m2.ac.length, 1);                       // 움직인 기체만 — 지상 기체는 그대로라 안 보냄
  assertEquals(m2.ac[0][0], "71bc21");
  assertEquals(m2.ac[0][1] > m1.ac[0][1], true);
  assertEquals(m2.t >= m1.t, true);
  assertEquals(gateCalls().length, 1);                 // 출입 확인은 연결할 때 한 번
  assertEquals(dbCalls().length, 0);
  ac.abort();
  try { await rdr.read(); } catch (_e) { /* 끊김 */ }
  const n1 = adsbN;
  await wait(6500);
  assertEquals(adsbN <= n1 + 1, true);                 // 끊는 순간 돌던 한 번까지만
  const n2 = adsbN;
  await wait(5500);
  assertEquals(adsbN, n2);
} });

Deno.test({ name: "실시간: 원본 조회 실패 → 직전 자료 + e · 물러나는 동안 다시 묻지 않음", ...loose, fn: async () => {
  calls.length = 0; gate = true; adsb = "fail";
  const n0 = adsbN;
  const r = await get("?live=1", FT);
  assertEquals(r.status, 200);
  assertEquals(adsbN, n0 + 1);
  assertEquals(r.d.e, 1);
  assertEquals(r.d.ac.length, 2);
  assertEquals(r.d.a >= 5000, true);                   // 자료가 그만큼 묵었음을 알림
  await get("?live=1", FT);
  assertEquals(adsbN, n0 + 1);
  adsb = "ok";
} });

/* ── 주기장(v1.85) — 인천공항공사 운항 현황(화물기) ── */
const iso = (ms: number) => new Date(ms).toISOString();
const mi = (ms: number) => Math.floor(ms / 60000) * 60000;             // 공공데이터 시각은 분 단위
const standPatches = () => calls.filter(c => c.method === "PATCH" && "stand" in c.body);
Deno.test("주기장: 인증키 없으면 조회 안 함(cron 기록은 그대로)", async () => {
  calls.length = 0; iiacCalls.length = 0; Deno.env.delete("IIAC_SERVICE_KEY");
  const r = await get("?cron=1");
  assertEquals(r.d.stand, "stand: no key");
  assertEquals(iiacCalls.length, 0);
});
Deno.test("주기장: 15분 잠금이 안 풀리면 조회 안 함", async () => {
  calls.length = 0; iiacCalls.length = 0; standLock = false; Deno.env.set("IIAC_SERVICE_KEY", "k");
  const r = await get("?cron=1");
  assertEquals(r.d.stand, "stand: cached");
  assertEquals(iiacCalls.length, 0);
});
Deno.test("주기장: 좌표표가 원본과 다르면(SHA-256) 좌표 없이 번호만 · 10분 동안 다시 받지 않음", async () => {
  calls.length = 0; iiacCalls.length = 0; standLock = true; iiac = "ok"; standsBad = true; mod._standsReset(); Deno.env.set("IIAC_SERVICE_KEY", "k");
  adsbRows = [{ hex: "_meta" }, { hex: "71bc21", reg: "HL7421", gnd: true, gnd_since: iso(T0 - 2 * 3600_000), lat: 37.47, lon: 126.46, stand: null }];
  const n0 = standsN;
  await get("?cron=1");
  await get("?cron=1");
  adsbRows = null; standLock = false; standsBad = false;
  assertEquals(standsN, n0 + 1);
  const s1 = standPatches().find(c => new URL(c.url).searchParams.get("hex") === "eq.71bc21")!.body.stand as Record<string, unknown>;
  assertEquals([s1.st, s1.ll], ["651", null]);
});
Deno.test("주기장: 인천 지상 기체만 · 화물기(C) · 도착(지상 시작일 ~ 오늘) + 출발 → 기체 행 stand(좌표 · 출발 주기장) · 다른 기체는 비움 · 바뀐 것만 씀", async () => {
  calls.length = 0; iiacCalls.length = 0; standLock = true; iiac = "ok"; mod._standsReset();
  Deno.env.set("IIAC_SERVICE_KEY", "abc%2Bdef%3D%3D");                 // 'Encoding' 키를 넣어도 한 번만 인코딩되게
  adsbRows = [
    { hex: "_meta", fetched_at: iso(T0), err: null },
    { hex: "71bc21", reg: "HL7421", gnd: true, gnd_since: iso(T0 - 2 * 3600_000), lat: 37.4931, lon: 126.4312, stand: null },
    { hex: "71c503", reg: "HL8503", gnd: true, gnd_since: iso(T0 - 5 * 3600_000), lat: 37.47, lon: 126.46, stand: null },
    { hex: "71bd07", reg: "HL7507", gnd: true, gnd_since: iso(T0 - 1 * 3600_000), lat: 37.47, lon: 126.46,
      stand: { term: "C02", dep: { st: "652L", apt: "PVG", at: iso(mi(T0 + 2 * 3600_000)), flt: "KJ282" }, arr: { st: "", flt: "KJ281", apt: "PVG", at: iso(mi(T0 - 3600_000)) },
        by: "dep", ex: true, ll: [37.475839, 126.465778], st: "652L" } },   // 지금 계산과 같은 내용 · 키 순서만 다름(jsonb)
    { hex: "71be45", reg: "HL7645", gnd: true, gnd_since: iso(T0 - 3600_000), lat: 33.94, lon: -118.38, stand: { st: "612" } },
    { hex: "71bc19", reg: "HL7419", gnd: false, lat: 47.5, lon: 18.1, stand: null }
  ];
  const r = await get("?cron=1");
  adsbRows = null; standLock = false;
  assertEquals(r.d.stand.startsWith("stand 3/3"), true, r.d.stand);
  const days = iiacCalls.map(u => u.pathname.split("/").pop() + ":" + u.searchParams.get("searchDate"));
  const kd = (ms: number) => KSTs(ms).slice(0, 8);
  assertEquals(days.filter(d => d.startsWith("getFltArrivalsDeOdp")).sort(), Array.from(new Set([kd(T0 - 11 * 3600_000), kd(T0)])).sort().map(d => "getFltArrivalsDeOdp:" + d));
  assertEquals(days.filter(d => d.startsWith("getFltDeparturesDeOdp")).length >= 1, true);
  iiacCalls.forEach(u => {
    assertEquals([u.searchParams.get("passengerOrCargo"), u.searchParams.get("type"), u.searchParams.get("searchdtCode"), u.searchParams.get("serviceKey")], ["C", "json", "E", "abc+def=="]);
  });
  const by = new Map(standPatches().map(c => [new URL(c.url).searchParams.get("hex"), c.body.stand as Record<string, unknown> | null]));
  const s1 = by.get("eq.71bc21")!;
  assertEquals([s1.st, s1.ex, s1.by, (s1.arr as Record<string, unknown>).flt, (s1.dep as Record<string, unknown>).flt, (s1.dep as Record<string, unknown>).st, s1.term], ["651", true, "arr", "KJ970", "KJ971", "645", "C02"]);
  assertEquals(s1.ll, [37.47505, 126.464828]);                         // AIP 651
  const s2 = by.get("eq.71c503")!;
  assertEquals([s2.st, s2.ll], ["999X", null]);                         // 표에 없는 번호 — 번호만
  assertEquals(by.has("eq.71bd07"), false);                             // 같은 내용(키 순서만 다름) → 안 씀
  assertEquals(by.get("eq.71be45"), null);                              // 인천이 아님 → 비움
  assertEquals(by.has("eq.71bc19"), false);                             // 원래 비어 있음
  const meta = standPatches().find(c => new URL(c.url).searchParams.get("hex") === "eq._meta")!.body.stand as Record<string, unknown>;
  assertEquals([meta.icn, meta.n, meta.err], [3, 3, null]);
});
Deno.test("주기장: 공공데이터 오류(XML) → _meta 에 오류 · 기체 행은 그대로", async () => {
  calls.length = 0; iiacCalls.length = 0; standLock = true; iiac = "xml"; Deno.env.set("IIAC_SERVICE_KEY", "k");
  adsbRows = [{ hex: "_meta" }, { hex: "71bc21", reg: "HL7421", gnd: true, gnd_since: iso(T0 - 3600_000), lat: 37.47, lon: 126.46, stand: null }];
  const r = await get("?cron=1");
  adsbRows = null; standLock = false; iiac = "ok"; Deno.env.delete("IIAC_SERVICE_KEY");
  assertEquals(r.d.stand, "stand error iiac SERVICE_KEY_IS_NOT_REGISTERED_ERROR");
  const ps = standPatches();
  assertEquals(ps.length, 1);
  assertEquals((ps[0].body.stand as Record<string, unknown>).err, "iiac SERVICE_KEY_IS_NOT_REGISTERED_ERROR");
});
Deno.test("주기장 고르기(pickStand): 지상 시작 6시간 전부터의 마지막 도착 · 떠난 편 · 결항 제외 · 도착 주기장이 없으면 출발 주기장", () => {
  const now = T0;
  const f = (flt: string, h: number, st: string, rmk = "") => ({ reg: "HL1", flt, t: now + h * 3600_000, st, apt: "X", term: "C01", rmk });
  const a = mod.pickStand("HL1", now - 3600_000, [f("A1", -20, "601"), f("A2", -1, "612"), f("A3", 2, "613")], [f("D0", -0.2, "699", "출발"), f("D1", 4, "614"), f("D2", 6, "615", "결항")], now, TABLE)!;
  assertEquals([a.st, (a.arr as Record<string, unknown>).flt, (a.dep as Record<string, unknown>).flt], ["612", "A2", "D1"]);
  const b = mod.pickStand("HL1", now - 3600_000, [], [f("D1", 4, "652R")], now, TABLE)!;
  assertEquals([b.st, b.by, b.ex, b.ll], ["652R", "dep", true, [37.475611, 126.465378]]);
  assertEquals(mod.pickStand("HL1", now, [f("A1", -1, "")], [], now, TABLE), null);
  const c = mod.pickStand("HL1", now, [f("A1", -1, "652X")], [], now, TABLE)!;
  assertEquals([c.st, c.ex, c.ll], ["652X", false, TABLE["652"]]);   // 표에 없는 글자 — 번호(652) 자리로
});
