// semis-logi-files 로컬 검증(v1.59 직원 접수 desk-in 중심) — Supabase RPC · 저장소 · Claude API 는 가짜로 바꿔 끼우고 함수를 실제로 띄워 요청한다.
// 실행: deno test --allow-net --allow-env tools/edge/semis-logi-files.test.ts   (포트 8000 사용)
import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "https://supa.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");
Deno.env.set("ANTHROPIC_API_KEY", "k");

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
let who: Record<string, unknown> = { ok: true, kind: "user", rank: 1, role: "user", who: "u1" };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://localhost")) return realFetch(input, init);
  let body: Record<string, unknown> = {};
  try { body = init && init.body && typeof init.body === "string" ? JSON.parse(init.body) : {}; } catch (_e) { body = {}; }
  calls.push({ url, body });
  if (url.endsWith("/rpc/semis_logi_file_auth")) return new Response(JSON.stringify(who), { status: 200 });
  if (url.includes("/storage/v1/object/upload/sign/")) return new Response(JSON.stringify({ url: "/object/upload/sign/x?token=t" }), { status: 200 });
  if (url.endsWith("/storage/v1/object/sign/semis-logi-files")) {
    const ps = (body.paths as string[]) || [];
    return new Response(JSON.stringify(ps.map((p) => ({ path: p, signedURL: "/object/sign/semis-logi-files/" + p + "?token=t", error: null }))), { status: 200 });
  }
  if (url.endsWith("/storage/v1/object/copy")) return new Response(JSON.stringify({ Key: "ok" }), { status: 200 });
  if (url === "https://api.anthropic.com/v1/messages") return new Response(JSON.stringify({ content: [{ type: "text", text: '{"type":"notice","title":"회의"}' }] }), { status: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

await import("./semis-logi-files.ts");
const TOK = "a".repeat(64);
const post = async (body: unknown) => {
  const r = await realFetch("http://localhost:8000/", { method: "POST", headers: { "content-type": "application/json", "x-semis-token": TOK, origin: "https://mark4mission.github.io" }, body: JSON.stringify(body) });
  return { status: r.status, d: await r.json() };
};
const as = (role: string, rank: number, kind = "user") => { who = { ok: true, kind, rank, role, who: role }; };
const up = (prefix: string) => post({ op: "upload", prefix, name: "이수증 a.pdf", size: 10, type: "application/pdf" });

Deno.test("desk-in 올리기: 내부 직원(user · manager · hq · admin)만 · 협력업체 · 서명 세션 거절 · 경로 형식", async () => {
  for (const [role, rank] of [["user", 1], ["manager", 2], ["hq", 3], ["admin", 4]] as [string, number][]) {
    as(role, rank);
    const r = await up("desk-in");
    assertEquals(r.status, 200, role);
    assertEquals(/^desk-in\/[a-z0-9]{12,24}_[A-Za-z0-9._-]{1,80}$/.test(r.d.path), true, "접수함 SQL 경로 형식과 같음: " + r.d.path);
  }
  as("vendor", 1);
  assertEquals((await up("desk-in")).d.error, "forbidden", "협력업체");
  as("vendor", 3);
  assertEquals((await up("desk-in")).d.error, "forbidden", "편집 협력업체도");
  as("", 0, "signer");
  assertEquals((await up("desk-in")).d.error, "forbidden", "서명 세션");
  as("user", 1);
  assertEquals((await up("desk")).d.error, "forbidden", "desk/ 는 그대로 3");
});

Deno.test("desk-in 열람 · 판독 · 복사: 안전보안파트 이상 · 복사는 desk · desk-in → 다른 폴더만", async () => {
  as("user", 1);
  let r = await post({ op: "sign", paths: ["desk-in/abcdefghijkl_a.pdf"] });
  assertEquals([Object.keys(r.d.urls).length, r.d.denied.length], [0, 1], "직원은 열람 불가(본인 것도)");
  r = await post({ op: "desk-read", path: "desk-in/abcdefghijkl_a.txt", text: "본문" });
  assertEquals(r.d.error, "forbidden", "직원 판독 불가");
  as("hq", 3);
  r = await post({ op: "sign", paths: ["desk-in/abcdefghijkl_a.pdf"] });
  assertEquals(Object.keys(r.d.urls).length, 1, "hq 열람");
  r = await post({ op: "desk-read", path: "desk-in/abcdefghijkl_a.txt", name: "a.txt", text: "보안회의 안내" });
  assertEquals([r.status, r.d.ok, r.d.data.type], [200, true, "notice"], "hq 판독(desk-in)");
  r = await post({ op: "desk-read", path: "docs/abcdefghijkl_a.txt", text: "x" });
  assertEquals(r.d.error, "path", "다른 폴더 판독 불가");
  r = await post({ op: "copy", from: "desk-in/abcdefghijkl_a.pdf", prefix: "schedules" });
  assertEquals([r.d.ok, /^schedules\//.test(r.d.path)], [true, true], "desk-in → schedules");
  r = await post({ op: "copy", from: "desk/abcdefghijkl_a.pdf", prefix: "desk-in" });
  assertEquals(r.d.error, "prefix", "desk-in 으로 복사 불가");
  r = await post({ op: "copy", from: "docs/abcdefghijkl_a.pdf", prefix: "schedules" });
  assertEquals(r.d.error, "path", "원본은 desk · desk-in 만");
  as("manager", 2);
  r = await post({ op: "copy", from: "desk-in/abcdefghijkl_a.pdf", prefix: "minutes" });
  assertEquals(r.d.error, "forbidden", "manager 는 desk-in 원본 열람 불가 → 복사 불가");
});
