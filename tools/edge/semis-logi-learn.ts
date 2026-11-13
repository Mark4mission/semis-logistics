/* H:drive — Supabase Edge Function "semis-logi-learn" (교육 전파 · 서명)
   - op "media": 학습 화면(learn.html, 로그인 없음)이 시작한 뒤 교육 자료(그림 · 동영상) 서명 URL(3시간).
     표 · 시작 기록 · 경로는 public.semis_logi_learn_media_ok(서비스 권한만)가 확인하고 learn/ 경로만 준다
   - op "sum": 관리 화면(hq 이상 세션)이 올린 자료를 실무자용 한 쪽 요약으로. PDF · 그림은 저장소 learn/ 원본,
     워드 · 한글 · 엑셀 · 파워포인트는 화면이 뽑은 글(text). 민감보안정보 교육은 화면이 부르지 않는다
   - 올리기 · 관리 화면의 열람 서명은 기존 semis-logi-files(폴더 learn = 기본 등급 3)
   - 배포: Supabase MCP deploy_edge_function (verify_jwt false — 위의 표 · 세션 확인으로 대신). 이 파일이 원본 */

const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "semis-logi-files";
const STORAGE = SUPA + "/storage/v1";
const ORIGINS = ["https://hdrive.kr", "https://mark4mission.github.io"];
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MEDIA_EXPIRES = 3 * 3600;
const AI_URL = "https://api.anthropic.com/v1/messages";
const AI_MODELS = ["claude-sonnet-5-5", "claude-sonnet-4-5", "claude-haiku-4-5"];
const AI_MAX_PDF = 15 * 1024 * 1024, AI_MAX_IMG = 5 * 1024 * 1024, MAX_TEXT = 60000;
const AI_IMG: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const SUM_SYSTEM = `당신은 항공화물터미널 안전보안 부서의 교육 담당입니다. 첨부 자료를 현장 실무자(화물 조업 · 보안검색 · 사무 직원)가 휴대폰으로 3분 안에 읽을 수 있는 A4 한 쪽 분량의 핵심 요약 교육 자료로 만듭니다.
JSON 객체 하나로만 답합니다. 설명 · 코드펜스 금지.
{"title": "교육명(40자 이내)", "overview": "무엇을 왜 알려 주는지 2문장", "body": "요약 본문"}
body 규칙:
- 실무자가 지켜야 할 것 · 달라진 것 · 하지 말아야 할 것 · 보고할 곳 위주. 회의 경과 · 인사말 · 참석자 명단 · 결재 문구는 뺀다.
- 형식: "## 소제목" 줄, "- " 목록 줄, 일반 문단. 강조는 **굵게**만. 표 · 링크 · 그림 · HTML 금지.
- 1,500자 이내. 소제목 3~5개. 쉬운 말, 업무 용어는 그대로.
- 자료에 있는 사실만. 날짜 · 수치 · 조항은 자료 그대로. 전화번호 · 주민번호 · 개인 연락처는 옮기지 않는다.`;

type Who = { ok: boolean; kind?: string; rank?: number };

function cors(origin: string): Record<string, string> {
  const allow = ORIGINS.includes(origin) || LOCAL_RE.test(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type, x-semis-token, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
    "Vary": "Origin"
  };
}
function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
const svc = (extra: Record<string, string> = {}) => ({ apikey: SERVICE, Authorization: "Bearer " + SERVICE, ...extra });
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const LEARN_PATH = /^learn\/[A-Za-z0-9._-]{4,160}$/;

async function whoAmI(req: Request): Promise<Who> {
  const tok = req.headers.get("x-semis-token") || "";
  if (!/^[0-9a-f]{64}$/.test(tok)) return { ok: false };
  try {
    const r = await fetch(SUPA + "/rest/v1/rpc/semis_logi_file_auth", {
      method: "POST",
      headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json", "x-semis-token": tok },
      body: "{}"
    });
    if (!r.ok) return { ok: false };
    const d = await r.json();
    return d && d.ok ? { ok: true, kind: String(d.kind), rank: Number(d.rank) || 0 } : { ok: false };
  } catch (_e) {
    return { ok: false };
  }
}

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  const r = await fetch(STORAGE + "/object/sign/" + BUCKET, {
    method: "POST", headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: MEDIA_EXPIRES, paths })
  });
  if (!r.ok) throw new Error("sign " + r.status);
  const rows = await r.json() as { path?: string; signedURL?: string | null; error?: string | null }[];
  const out: Record<string, string> = {};
  (Array.isArray(rows) ? rows : []).forEach((x) => {
    if (x && x.path && x.signedURL && !x.error) out[x.path] = encodeURI(STORAGE + x.signedURL);
  });
  return out;
}

async function media(body: Record<string, unknown>, origin: string): Promise<Response> {
  const k = String(body.k || "").trim().toLowerCase(), ticket = String(body.ticket || ""), rid = String(body.rid || "");
  if (!/^[a-z2-9]{12}$/.test(k) || !/^[0-9a-f]{48}$/.test(ticket) || !/^lr[0-9a-f]{18}$/.test(rid)) return json({ ok: false, error: "invalid" }, 400, origin);
  const r = await fetch(SUPA + "/rest/v1/rpc/semis_logi_learn_media_ok", {
    method: "POST", headers: svc({ "Content-Type": "application/json" }), body: JSON.stringify({ p_k: k, p_ticket: ticket, p_rid: rid })
  });
  if (!r.ok) return json({ ok: false, error: "check" }, 502, origin);
  const d = await r.json() as { ok?: boolean; error?: string; files?: { i: number; type: string; path: string }[] };
  if (!d || !d.ok) return json({ ok: false, error: String((d && d.error) || "check") }, 403, origin);
  const files = (Array.isArray(d.files) ? d.files : []).filter((f) => f && LEARN_PATH.test(String(f.path || ""))).slice(0, 30);
  const urls = files.length ? await signPaths(files.map((f) => f.path)) : {};
  return json({ ok: true, expires: MEDIA_EXPIRES, urls: files.filter((f) => urls[f.path]).map((f) => ({ i: f.i, type: f.type, url: urls[f.path] })) }, 200, origin);
}

function b64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function pickJson(t: string): Record<string, unknown> | null {
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch (_e) { return null; }
}

async function summarize(w: Who, body: Record<string, unknown>, origin: string): Promise<Response> {
  if (w.kind !== "user" || (w.rank ?? 0) < 3) return json({ ok: false, error: "forbidden" }, 403, origin);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!apiKey) return json({ ok: false, error: "no_key" }, 200, origin);
  const name = str(body.name, 160);
  const parts = (Array.isArray(body.parts) ? body.parts : []).slice(0, 4) as Record<string, unknown>[];
  const blocks: Record<string, unknown>[] = [];
  let textLeft = MAX_TEXT;
  for (const p of parts) {
    const text = typeof p.text === "string" ? p.text.slice(0, textLeft) : "";
    if (text.trim()) { textLeft -= text.length; blocks.push({ type: "text", text: `[자료 — ${str(p.name, 160) || "파일"}]\n${text}` }); continue; }
    const path = String(p.path || "");
    if (!LEARN_PATH.test(path)) return json({ ok: false, error: "path" }, 400, origin);
    const ext = (path.split(".").pop() || "").toLowerCase();
    if (ext !== "pdf" && !AI_IMG[ext]) return json({ ok: false, error: "unsupported" }, 200, origin);
    const f = await fetch(STORAGE + "/object/" + BUCKET + "/" + encPath(path), { headers: svc() });
    if (!f.ok) return json({ ok: false, error: "file" }, 404, origin);
    const u8 = new Uint8Array(await f.arrayBuffer());
    if (ext === "pdf") {
      if (u8.length > AI_MAX_PDF) return json({ ok: false, error: "too_large" }, 200, origin);
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(u8) } });
    } else {
      if (u8.length > AI_MAX_IMG) return json({ ok: false, error: "too_large" }, 200, origin);
      blocks.push({ type: "image", source: { type: "base64", media_type: AI_IMG[ext], data: b64(u8) } });
    }
  }
  if (!blocks.length) return json({ ok: false, error: "empty" }, 400, origin);
  const hint = str(body.title, 80);
  blocks.push({ type: "text", text: `${hint ? "관리자가 적은 교육명: " + hint + "\n" : ""}파일 이름: ${name || "-"}\n첨부 자료를 실무자용 한 쪽 요약으로 만들어 JSON 으로만 답하세요.` });
  const envModel = Deno.env.get("LOGI_AI_MODEL");
  const models = envModel ? [envModel, ...AI_MODELS.filter((m) => m !== envModel)] : AI_MODELS.slice();
  let res: Response | null = null, model = "";
  for (const m of models) {
    model = m;
    res = await fetch(AI_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: m, max_tokens: 3000, system: SUM_SYSTEM, messages: [{ role: "user", content: blocks }] })
    });
    if (res.status !== 404) break;
  }
  if (!res) return json({ ok: false, error: "ai" }, 200, origin);
  if (res.status === 401 || res.status === 403) return json({ ok: false, error: "bad_key" }, 200, origin);
  if (res.status === 429 || res.status === 529) return json({ ok: false, error: "busy" }, 200, origin);
  if (res.status === 413) return json({ ok: false, error: "too_large" }, 200, origin);
  if (!res.ok) return json({ ok: false, error: "ai " + res.status }, 200, origin);
  const d = await res.json() as { content?: { type: string; text?: string }[] };
  const o = pickJson((d.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n"));
  if (!o) return json({ ok: false, error: "parse" }, 200, origin);
  return json({ ok: true, model, data: { title: str(o.title, 80), overview: str(o.overview, 600), body: str(o.body, 6000) } }, 200, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, origin);
  if (origin && !ORIGINS.includes(origin) && !LOCAL_RE.test(origin)) return json({ ok: false, error: "origin" }, 403, origin);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 400000) return json({ ok: false, error: "too_large" }, 413, origin);
    body = JSON.parse(raw);
  } catch (_e) { return json({ ok: false, error: "bad_json" }, 400, origin); }
  const op = String((body && body.op) || "");
  try {
    if (op === "media") return await media(body, origin);
    if (op === "sum") {
      const w = await whoAmI(req);
      if (!w.ok) return json({ ok: false, error: "auth" }, 401, origin);
      return await summarize(w, body, origin);
    }
    return json({ ok: false, error: "op" }, 400, origin);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e).slice(0, 80) }, 500, origin);
  }
});
