// semis-logi-learn 로컬 검증 — Supabase RPC · 저장소 · Claude API 는 가짜로 바꿔 끼우고 함수를 실제로 띄워 요청한다.
// 실행: deno test --allow-net --allow-env tools/edge/semis-logi-learn.test.ts   (포트 8000 사용)
import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://supa.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");
Deno.env.set("ANTHROPIC_API_KEY", "k");

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
const calls: Call[] = [];
let who: Record<string, unknown> = { ok: true, kind: "user", rank: 3, role: "hq" };
let mediaOk: Record<string, unknown> = { ok: true, files: [{ i: 0, type: "video", path: "learn/aa11_v.mp4" }, { i: 2, type: "image", path: "docs/x.png" }] };
let aiText = '{"title":"11월 협의체","overview":"요약","body":"## 핵심\\n- 통로 확보","extra":1}';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://localhost")) return realFetch(input, init);
  let body: Record<string, unknown> = {};
  try { body = init && init.body && typeof init.body === "string" ? JSON.parse(init.body) : {}; } catch (_e) { body = {}; }
  calls.push({ url, body, headers: (init && init.headers || {}) as Record<string, string> });
  if (url.endsWith("/rpc/semis_logi_file_auth")) return new Response(JSON.stringify(who), { status: 200 });
  if (url.endsWith("/rpc/semis_logi_learn_media_ok")) return new Response(JSON.stringify(mediaOk), { status: 200 });
  if (url.endsWith("/storage/v1/object/sign/semis-logi-files")) {
    const ps = (body.paths as string[]) || [];
    return new Response(JSON.stringify(ps.map((p) => ({ path: p, signedURL: "/object/sign/semis-logi-files/" + p + "?token=t", error: null }))), { status: 200 });
  }
  if (url.startsWith("https://supa.test/storage/v1/object/semis-logi-files/learn/")) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
  if (url === "https://api.anthropic.com/v1/messages") return new Response(JSON.stringify({ content: [{ type: "text", text: aiText }] }), { status: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

await import("./semis-logi-learn.ts");
const post = async (body: unknown, o: { tok?: boolean; origin?: string } = {}) => {
  const h: Record<string, string> = { "content-type": "application/json", origin: o.origin ?? "https://hdrive.kr" };
  if (o.tok !== false) h["x-semis-token"] = "a".repeat(64);
  const r = await realFetch("http://localhost:8000/", { method: "POST", headers: h, body: JSON.stringify(body) });
  return { status: r.status, d: await r.json(), acao: r.headers.get("access-control-allow-origin") };
};
const K = "abcdefgh2345", TK = "f".repeat(48), RID = "lr" + "0".repeat(18);

Deno.test("media: 형식 검사 · 서비스 권한 확인 · learn/ 경로만 서명 · 3시간", async () => {
  assertEquals((await post({ op: "media", k: "bad", ticket: TK, rid: RID }, { tok: false })).d.error, "invalid");
  assertEquals((await post({ op: "media", k: K, ticket: "x", rid: RID }, { tok: false })).d.error, "invalid");
  calls.length = 0;
  const r = await post({ op: "media", k: K.toUpperCase(), ticket: TK, rid: RID }, { tok: false });
  assertEquals(r.status, 200);
  assertEquals(r.acao, "https://hdrive.kr");
  assertEquals(r.d.urls.length, 1, "docs/ 경로는 버림");
  assertEquals(r.d.urls[0].i, 0);
  assertEquals(r.d.expires, 10800);
  const chk = calls.find((c) => c.url.endsWith("/rpc/semis_logi_learn_media_ok"))!;
  assertEquals(chk.body, { p_k: K.toLowerCase(), p_ticket: TK, p_rid: RID });
  assertEquals(chk.headers.apikey, "svc", "서비스 키로 확인");
  const sg = calls.find((c) => c.url.endsWith("/object/sign/semis-logi-files"))!;
  assertEquals(sg.body.paths, ["learn/aa11_v.mp4"]);
  mediaOk = { ok: false, error: "start" };
  const r2 = await post({ op: "media", k: K, ticket: TK, rid: RID }, { tok: false });
  assertEquals([r2.status, r2.d.error], [403, "start"]);
});

Deno.test("sum: 세션 없음 401 · hq 미만 403 · 경로 · 글/PDF 요약 · 결과 다듬기", async () => {
  assertEquals((await post({ op: "sum", parts: [{ text: "가" }] }, { tok: false })).status, 401);
  who = { ok: true, kind: "user", rank: 2, role: "manager" };
  assertEquals((await post({ op: "sum", parts: [{ text: "가" }] })).status, 403);
  who = { ok: true, kind: "signer", rank: 0 };
  assertEquals((await post({ op: "sum", parts: [{ text: "가" }] })).status, 403);
  who = { ok: true, kind: "user", rank: 3, role: "hq" };
  assertEquals((await post({ op: "sum", parts: [{ path: "docs/a.pdf" }] })).d.error, "path");
  assertEquals((await post({ op: "sum", parts: [{ path: "learn/../a.pdf" }] })).d.error, "path");
  assertEquals((await post({ op: "sum", parts: [] })).d.error, "empty");
  calls.length = 0;
  let r = await post({ op: "sum", name: "결과.hwpx", title: "협의체", parts: [{ name: "결과.hwpx", text: "1. 통로 확보" }] });
  assertEquals(r.d.ok, true);
  assertEquals(r.d.data, { title: "11월 협의체", overview: "요약", body: "## 핵심\n- 통로 확보" });
  const ai = calls.find((c) => c.url === "https://api.anthropic.com/v1/messages")!;
  const msg = (ai.body.messages as { content: { type: string; text?: string }[] }[])[0].content;
  assertEquals(msg[0].type, "text");
  assertEquals(msg[msg.length - 1].text!.includes("관리자가 적은 교육명: 협의체"), true);
  calls.length = 0;
  r = await post({ op: "sum", parts: [{ path: "learn/ab12_a.pdf" }] });
  assertEquals(r.d.ok, true);
  const ai2 = calls.find((c) => c.url === "https://api.anthropic.com/v1/messages")!;
  assertEquals((ai2.body.messages as { content: { type: string }[] }[])[0].content[0].type, "document");
  aiText = "죄송합니다";
  assertEquals((await post({ op: "sum", parts: [{ text: "가" }] })).d.error, "parse");
});

Deno.test("출처 · 형식: 다른 출처 403 · GET 405 · 모르는 op", async () => {
  assertEquals((await post({ op: "media" }, { origin: "https://evil.example" })).status, 403);
  const g = await realFetch("http://localhost:8000/", { method: "GET" });
  assertEquals(g.status, 405); await g.body?.cancel();
  assertEquals((await post({ op: "nope" })).d.error, "op");
});
