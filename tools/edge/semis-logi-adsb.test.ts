// semis-logi-adsb 로컬 검증 — Supabase REST · RPC · adsb.lol 은 가짜로 바꿔 끼우고 함수를 실제로 띄워 요청한다(출입 · 기체 목록 · cron · 실시간).
// 실행: deno test --node-modules-dir=none --allow-net --allow-env tools/edge/semis-logi-adsb.test.ts   (포트 8000 사용 · 실시간 시험은 5초 간격을 기다려 20초쯤 걸림)
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
  if (url.endsWith("/rest/v1/rpc/semis_logi_flight_gate")) {
    if (gate === "err") return new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(gate), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/rest/v1/semis_logi_adsb?") && method === "PATCH") return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/rest/v1/semis_logi_store?")) return new Response(JSON.stringify(fleet === null ? null : { value: fleet }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/rest/v1/semis_logi_adsb_events?")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/rest/v1/semis_logi_adsb?")) {
    return new Response(JSON.stringify([{ hex: "_meta", fetched_at: "2026-11-23T00:00:00Z", err: null },
      { hex: "71bc21", reg: "HL7421", lat: 37.4, lon: 126.5, fetched_at: null, err: null }]), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

await import("./semis-logi-adsb.ts");
const get = async (qs = "", h: Record<string, string> = {}) => {
  const r = await realFetch("http://localhost:8000/" + qs, { headers: h });
  return { status: r.status, d: await r.json() };
};
const gateCalls = () => calls.filter(c => c.url.endsWith("/rpc/semis_logi_flight_gate"));
const lockCalls = () => calls.filter(c => c.method === "PATCH");

Deno.test("OPTIONS — 출입 머리글 두 개 허용", async () => {
  const r = await realFetch("http://localhost:8000/", { method: "OPTIONS" });
  await r.text();
  const ah = r.headers.get("access-control-allow-headers") || "";
  assertEquals(ah.includes("x-semis-token") && ah.includes("x-flight-token"), true);
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
