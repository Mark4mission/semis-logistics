// semis-logi-argo 로컬 검증 — Supabase RPC · Claude API 는 가짜로 바꿔 끼우고 함수를 실제로 띄워 요청한다.
// 실행: deno test --allow-net --allow-env tools/edge/semis-logi-argo.test.ts   (포트 8000 사용)
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://supa.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("ANTHROPIC_API_KEY", "k");
Deno.env.delete("ARGO_MODEL");

type Call = { url: string; body: Record<string, unknown>; headers: Headers };
const calls: Call[] = [];
let begin: Record<string, unknown> = { ok: true, rank: 1, role: "user", name: "시험", used: 1, limit: 200 };
let ai: (body: Record<string, unknown>) => Response = () =>
  new Response(JSON.stringify({ content: [{ type: "text", text: "안녕하세요" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 } }), { status: 200 });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://localhost")) return realFetch(input, init);
  const body = init && init.body ? JSON.parse(String(init.body)) : {};
  calls.push({ url, body, headers: new Headers(init && init.headers) });
  if (url.endsWith("/rpc/semis_logi_argo_begin")) return new Response(JSON.stringify(begin), { status: 200 });
  if (url.endsWith("/rpc/semis_logi_argo_meter")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  if (url === "https://api.anthropic.com/v1/messages") return ai(body);
  return new Response("{}", { status: 404 });
}) as typeof fetch;

await import("./semis-logi-argo.ts");
const TOK = "a".repeat(64);
const post = (body: unknown, tok = TOK, origin = "https://mark4mission.github.io") =>
  realFetch("http://localhost:8000/", { method: "POST", headers: { "content-type": "application/json", "x-semis-token": tok, origin }, body: JSON.stringify(body) });
const userMsg = (t: string) => ({ role: "user", content: t });
const aiCalls = () => calls.filter((c) => c.url.includes("anthropic"));

Deno.test("CORS · 토큰 없음 · 다른 출처", async () => {
  const o = await realFetch("http://localhost:8000/", { method: "OPTIONS", headers: { origin: "https://mark4mission.github.io" } });
  await o.body?.cancel();
  assertEquals(o.status, 204);
  assertEquals(o.headers.get("access-control-allow-origin"), "https://mark4mission.github.io");
  let r = await post({ messages: [userMsg("a")] }, "bad");
  assertEquals([r.status, (await r.json()).error], [401, "auth"]);
  r = await post({ messages: [userMsg("a")] }, TOK, "https://evil.example");
  assertEquals([r.status, (await r.json()).error], [403, "origin"]);
});

Deno.test("서버 판정: 협력업체 거절 · 한도 넘음 — AI 를 부르지 않는다", async () => {
  calls.length = 0;
  begin = { ok: false, error: "forbidden" };
  let r = await post({ messages: [userMsg("a")] });
  assertEquals([r.status, (await r.json()).error], [403, "forbidden"]);
  begin = { ok: false, error: "limit", used: 200, limit: 200 };
  r = await post({ messages: [userMsg("a")] });
  const d = await r.json();
  assertEquals([r.status, d.error, d.limit], [429, "limit", 200]);
  assertEquals(aiCalls().length, 0);
  assertEquals(calls[0].headers.get("x-semis-token"), TOK, "세션 토큰으로 RPC");
});

Deno.test("user: 조회 도구만 · 자료 목록은 공지만 · 시스템 캐시 · 마지막 블록 캐시 · 토큰 계량", async () => {
  calls.length = 0;
  begin = { ok: true, rank: 1, role: "user", name: "시험", used: 5, limit: 200 };
  const r = await post({ messages: [userMsg("안녕"), { role: "assistant", content: "네" }, { role: "user", content: [{ type: "text", text: "공지 알려줘", cache_control: { type: "x" } }] }] });
  const d = await r.json();
  assertEquals([r.status, d.ok, d.content[0].text, d.used, d.limit], [200, true, "안녕하세요", 5, 200]);
  const b = aiCalls()[0].body as Record<string, any>;
  assertEquals(b.model, "claude-sonnet-5-5");
  assertEquals(b.tools.map((t: any) => t.name).join(), "argos_find,argos_status,argos_records");
  assertEquals(b.tools[2].input_schema.properties.collection.enum, ["notices"]);
  assert(!("tool_choice" in b));
  assertEquals(b.system[0].cache_control.type, "ephemeral");
  assert(b.system[0].text.includes("[안내 지식]") && b.system[0].text.includes("조회 · 안내만"));
  assert(/\[지금\] \d{4}-\d{2}-\d{2}\(.\) \d{2}:\d{2} KST/.test(b.system[1].text) && b.system[1].text.includes("일반사용자"));
  const last = b.messages[2].content;
  assertEquals(last[last.length - 1].cache_control.type, "ephemeral", "마지막 블록 캐시(화면이 보낸 cache_control 은 무시)");
  const meter = calls.find((c) => c.url.endsWith("semis_logi_argo_meter"))!;
  assertEquals([meter.body.p_in, meter.body.p_out, meter.body.p_cache], [10, 5, 7]);
});

Deno.test("hq: 쓰기 도구 · 계약 목록 · 왕복 5회째는 도구 없이 답(tool_choice none) · tool_use 는 그대로 돌려줌", async () => {
  calls.length = 0;
  begin = { ok: true, rank: 3, role: "hq", name: "파트", used: 9, limit: 200 };
  ai = () => new Response(JSON.stringify({ content: [{ type: "tool_use", id: "tu_9", name: "schedule_add", input: { items: [] } }, { type: "thinking", thinking: "x" }], stop_reason: "tool_use", usage: {} }), { status: 200 });
  const msgs: unknown[] = [userMsg("일정 등록")];
  for (let i = 0; i < 5; i++) {
    msgs.push({ role: "assistant", content: [{ type: "tool_use", id: "tu_" + i, name: "argos_status", input: { topic: "overview" } }] });
    msgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_" + i, content: "{}" }] });
  }
  const r = await post({ messages: msgs });
  const d = await r.json();
  assertEquals(d.rounds, 5);
  const b = aiCalls()[0].body as Record<string, any>;
  assert(b.tools.some((t: any) => t.name === "training_record") && b.tools.some((t: any) => t.name === "argos_catalog"));
  assert(b.tools.find((t: any) => t.name === "argos_records").input_schema.properties.collection.enum.includes("contracts"));
  assertEquals(b.tool_choice, { type: "none" });
  assertEquals(d.content.map((x: any) => x.type).join(), "tool_use", "thinking 등 다른 블록은 빼고 돌려줌");
  const r2 = await post({ messages: msgs.slice(0, 3) });
  await r2.json();
  assert(!("tool_choice" in (aiCalls()[1].body as Record<string, unknown>)), "1회째는 자유");
});

Deno.test("대화 검사: 첫 말 · 순서 · 모르는 도구 · 짝 안 맞는 결과 · 첨부 수 · 첨부 형식", async () => {
  begin = { ok: true, rank: 1, role: "user", name: "시험", used: 1, limit: 200 };
  const bad = async (messages: unknown, detail: string) => {
    const r = await post({ messages });
    const d = await r.json();
    assertEquals([r.status, d.error, d.detail], [400, "bad_request", detail], detail);
  };
  await bad([{ role: "assistant", content: "x" }], "order");
  await bad([userMsg("a"), userMsg("b")], "order");
  await bad([userMsg("a"), { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "schedule_add", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] }], "tool_use");
  await bad([userMsg("a"), { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "argos_find", input: { query: "x" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "{}" }] }], "pairing");
  const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
  await bad([{ role: "user", content: Array(7).fill(img).concat([{ type: "text", text: "a" }]) }], "too_large");
  await bad([{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://x" } }, { type: "text", text: "a" }] }], "media");
  await bad([{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "text/html", data: "PGgxPg==" } }] }], "media");
  await bad([{ role: "user", content: [{ type: "text", text: "  " }] }], "empty");
});

Deno.test("모델 폴백 · 사용량 많음 · 키 오류", async () => {
  calls.length = 0;
  begin = { ok: true, rank: 2, role: "manager", name: "관리", used: 1, limit: 200 };
  let n = 0;
  ai = (b) => { n++; return b.model === "claude-sonnet-5-5" ? new Response("{}", { status: 404 }) : new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }), { status: 200 }); };
  let r = await post({ messages: [userMsg("a")] });
  let d = await r.json();
  assertEquals([d.ok, d.model, n], [true, "claude-sonnet-4-5", 2]);
  ai = () => new Response("{}", { status: 529 });
  r = await post({ messages: [userMsg("a")] }); d = await r.json();
  assertEquals(d.error, "busy");
  ai = () => new Response("{}", { status: 401 });
  r = await post({ messages: [userMsg("a")] }); d = await r.json();
  assertEquals(d.error, "bad_key");
});
