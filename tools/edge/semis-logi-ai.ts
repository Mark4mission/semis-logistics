/* SeMIS · Logistics — Supabase Edge Function "semis-logi-ai" (AI 요약)
   지침·공지·공문·교육 자료를 직원 전파용으로 요약한다. (2026-09-21 배포, 호출하는 화면은 아직 없음)
   - 인증: 요청 헤더 x-semis-token (로그인 세션) → public.semis_logi_file_auth() 로 확인
           계정 세션만(회의 서명 세션 불가) · 등급 2(manager) 이상
   - 비밀키: ANTHROPIC_API_KEY (프로젝트 공통 Secret)
   - 모델: LOGI_AI_MODEL 환경변수로 교체 가능(기본 claude-sonnet-5 → claude-sonnet-4-5 폴백)
   - 입력: { task:"summary", title, text }   출력: { ok:true, html } | { ok:false, error }
   - 배포: Supabase MCP deploy_edge_function (verify_jwt false — 위의 세션 확인으로 대신). 이 파일이 원본.
   - v1.15 후속(2026-09-25): 고정 토큰(body.t) 방식 → 로그인 세션 확인으로 교체 */

const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODELS = ["claude-sonnet-5", "claude-sonnet-4-5"];
const MAX_TEXT = 60000;
const MIN_TEXT = 20;
const MIN_RANK = 2;
const ORIGINS = ["https://mark4mission.github.io", "https://logistics.semis.pe.kr"];
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const okOrigin = (o: string) => ORIGINS.includes(o) || LOCAL_RE.test(o);

function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": okOrigin(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-semis-token, apikey, authorization, x-client-info",
    "Access-Control-Max-Age": "3600",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/* 로그인 세션 확인 — semis-logi-files 와 같은 방식 */
async function whoAmI(req: Request): Promise<{ ok: boolean; kind?: string; rank?: number }> {
  const tok = req.headers.get("x-semis-token") || "";
  if (!/^[0-9a-f]{64}$/.test(tok)) return { ok: false };
  try {
    const r = await fetch(SUPA + "/rest/v1/rpc/semis_logi_file_auth", {
      method: "POST",
      headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json", "x-semis-token": tok },
      body: "{}",
    });
    if (!r.ok) return { ok: false };
    const d = await r.json();
    return d && d.ok ? { ok: true, kind: String(d.kind), rank: Number(d.rank) || 0 } : { ok: false };
  } catch (_e) {
    return { ok: false };
  }
}

const SYSTEM = `당신은 항공화물 회사 안전보안파트의 문서 요약 담당자입니다.
사용자가 준 지침·공지·공문·교육 자료를 직원 전파용으로 요약합니다.

[원칙]
- 원문에 있는 사실만 씁니다. 추측·해석·권고를 덧붙이지 않습니다.
- 날짜·기한·수치·조항 번호·대상·책임자·금지/의무 사항은 빠짐없이 원문 그대로 옮깁니다.
- 문체는 건조한 사무체(~함, ~할 것, ~임). 인사말·맺음말·"요약하면" 같은 표현 금지.
- 분량은 원문의 20~35% 이내. 원문이 짧으면 더 짧게.

[출력 형식]
- HTML 조각만 출력합니다. 코드펜스·설명·머리말 없이 바로 태그로 시작합니다.
- 사용 가능 태그: h3, p, ul, ol, li, strong, table, thead, tbody, tr, th, td, br
- 구성: <h3>핵심</h3> 2~4개 항목 목록 → 필요한 경우 <h3>세부 사항</h3>, <h3>일정·기한</h3>, <h3>조치 사항</h3> 순.
- 원문에 해당 내용이 없는 절은 만들지 않습니다.`;

async function callClaude(apiKey: string, model: string, title: string, text: string) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 2400, system: SYSTEM,
      messages: [{ role: "user", content: (title ? "[제목] " + title + "\n\n" : "") + "[원문]\n" + text }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function stripFence(s: string): string {
  return s.replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (origin && !okOrigin(origin)) return json({ ok: false, error: "FORBIDDEN" }, 403, origin);
  if (req.method !== "POST") return json({ ok: false, error: "METHOD" }, 405, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "BAD_JSON" }, 400, origin); }
  const w = await whoAmI(req);
  if (!w.ok) return json({ ok: false, error: "AUTH" }, 401, origin);
  if (w.kind !== "user" || (w.rank ?? 0) < MIN_RANK) return json({ ok: false, error: "FORBIDDEN" }, 403, origin);

  if (body.task !== "summary") return json({ ok: false, error: "TASK" }, 400, origin);
  const title = String(body.title || "").slice(0, 200);
  const text = String(body.text || "").replace(/\s+\n/g, "\n").trim().slice(0, MAX_TEXT);
  if (text.length < MIN_TEXT) return json({ ok: false, error: "TOO_SHORT" }, 200, origin);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!apiKey) return json({ ok: false, error: "NO_KEY" }, 200, origin);

  const envModel = Deno.env.get("LOGI_AI_MODEL");
  const models = envModel ? [envModel, ...MODELS.filter((m) => m !== envModel)] : MODELS.slice();
  try {
    let mi = 0;
    let r = await callClaude(apiKey, models[mi], title, text);
    while (r.status === 404 && mi + 1 < models.length) { mi++; r = await callClaude(apiKey, models[mi], title, text); }
    if (r.status === 401) return json({ ok: false, error: "BAD_KEY" }, 200, origin);
    if (r.status === 429 || r.status === 529) return json({ ok: false, error: "BUSY" }, 200, origin);
    if (r.status !== 200) return json({ ok: false, error: "UPSTREAM_" + r.status }, 200, origin);
    const d = r.data as { content?: { type: string; text?: string }[]; stop_reason?: string };
    const html = stripFence((d.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n"));
    if (!html) return json({ ok: false, error: "EMPTY" }, 200, origin);
    return json({ ok: true, html, model: models[mi], stop: d.stop_reason }, 200, origin);
  } catch (_e) {
    return json({ ok: false, error: "UPSTREAM" }, 200, origin);
  }
});
