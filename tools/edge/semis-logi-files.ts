/* SeMIS · Logistics — Supabase Edge Function "semis-logi-files" (v1.15 · v1.39 edu-upload · edu-read)
   비공개 버킷 semis-logi-files 의 유일한 출입구. 브라우저는 버킷에 직접 접근하지 못한다.
   - 인증: 요청 헤더 x-semis-token (로그인 세션) → public.semis_logi_file_auth() 로 확인
   - op "sign"   : 파일 열람용 서명 URL(1시간) — 폴더별 열람 등급 확인
   - op "upload" : 업로드용 서명 URL — 폴더별 작성 등급 확인, 저장 경로는 이 함수가 정한다
   - op "list" / "delete" : 시스템관리자만 (시스템 설정 › 저장소 관리)
   - 회의 서명 세션(signer)은 minutes-sign/ 폴더만 올리고 볼 수 있다
   - op "edu-upload" (v1.39): 보안교육 이수 등록 화면(edu.html, 로그인 없음)의 이수증 — 세션 대신 표(ticket)로 확인.
     PDF · 이미지만, 20MB 이하, training/ 폴더. public.semis_logi_edu_claim(서비스 권한)이 표 · 개수 · 용량을 확인하고 기록한다
   - op "edu-read" (v1.39.2): 올린 이수증을 Claude(ANTHROPIC_API_KEY · LOGI_AI_MODEL)로 판독 → { cid, course, date, expire, org, certNo, hours, name, conf }.
     public.semis_logi_edu_read_ok(서비스 권한)가 표 · 경로 · 판독 횟수를 확인하고 과정 목록을 준다. PDF 15MB · 이미지 5MB(jpeg · png · webp · gif)
   - v1.40 폴더: docs(열람 2) · docs-ssi(3, 민감보안정보) · contracts(3) · cases(2) · dissem(2) — 올리기는 모두 3(hq)
   - 배포: Supabase MCP deploy_edge_function (verify_jwt false — 위의 세션 확인으로 대신). 이 파일이 원본. */

const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "semis-logi-files";
const STORAGE = SUPA + "/storage/v1";
const PUBLIC_PREFIX = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/" + BUCKET + "/";
const ORIGINS = ["https://mark4mission.github.io", "https://logistics.semis.pe.kr"];
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const EXPIRES = 3600;
const MAX_SIZE = 50 * 1024 * 1024;
const MAX_SIGN = 200;
/* 폴더별 등급 — 권한 서열 admin 4 · hq 3 · manager 2 · user 1 (공용 DB 권한표와 맞춘다) */
const READ_RANK: Record<string, number> = {
  notices: 1, attach: 1, minutes: 1, "minutes-sign": 1,
  schedules: 2, contacts: 2, crisis: 2, regs: 2, "regs-diff": 2, audits: 2, training: 2, seclog: 2, threat: 2, patrol: 2,
  docs: 2, cases: 2, dissem: 2            // v1.40 증빙 문서 · 보안 처리 대장 · 전파교육 (docs-ssi · contracts 는 기본 3 = hq)
};
const WRITE_RANK: Record<string, number> = {
  minutes: 2, "minutes-sign": 2, seclog: 2, threat: 2, patrol: 2,
  schedules: 3, notices: 3, attach: 3, contacts: 3, crisis: 3, regs: 3, "regs-diff": 3, audits: 3, training: 3,
  docs: 3, "docs-ssi": 3, contracts: 3, cases: 3, dissem: 3
};
const DEFAULT_READ = 3, DEFAULT_WRITE = 3;
const BLOCK_TYPES = /^(text\/html|application\/xhtml\+xml|text\/javascript|application\/(x-)?javascript)/i;
const EDU_MAX = 20 * 1024 * 1024;
const EDU_EXT = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;
const EDU_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/i;
const AI_URL = "https://api.anthropic.com/v1/messages";
const AI_MODELS = ["claude-sonnet-5-5", "claude-sonnet-4-5", "claude-haiku-4-5"];
const AI_MAX_PDF = 15 * 1024 * 1024, AI_MAX_IMG = 5 * 1024 * 1024;
const AI_IMG: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const AI_SYSTEM = `당신은 항공보안 교육 이수증(수료증 · 이수증명서) 판독기입니다. 첨부 파일에 적힌 사실만 읽어 JSON 객체 하나로만 답합니다. 설명 · 코드펜스 금지.
형식: {"cid": "과정 목록의 id 또는 null", "course": "이수증에 적힌 과정명", "date": "수료일 YYYY-MM-DD 또는 null", "expire": "이수증에 적힌 유효기한 YYYY-MM-DD 또는 null", "org": "교육기관", "certNo": "이수증 번호", "hours": 교육시간 숫자 또는 null, "name": "이수자 성명", "conf": 0~1}
규칙:
- cid: 과정 목록에서 이수증의 교육과 같은 과정(초기 · 정기 · 보수 구분 포함)을 고른다. 보수교육은 정기로 본다. 확실하지 않으면 null.
- date: 교육 기간이 여러 날이면 마지막 날. 서기 YYYY-MM-DD. 이수일 · 수료일 · 발급일 중 이수(수료)일을 우선.
- 이수증에 없는 값은 null 또는 빈 문자열. 추측하지 않는다.`;

type Who = { ok: boolean; kind?: string; rank?: number; who?: string };

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
const svc = (extra: Record<string, string> = {}) =>
  ({ apikey: SERVICE, Authorization: "Bearer " + SERVICE, ...extra });

/* 저장소 경로 — 상대 경로만, 상위 이동·제어문자 금지 */
function cleanPath(p: unknown): string | null {
  const s = String(p ?? "");
  if (!s || s.length > 300) return null;
  if (s.startsWith("/") || s.includes("..") || s.includes("\\") || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}
const folderOf = (p: string) => (p.indexOf("/") > 0 ? p.slice(0, p.indexOf("/")) : "");
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

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
    return d && d.ok ? { ok: true, kind: String(d.kind), rank: Number(d.rank) || 0, who: String(d.who || "") } : { ok: false };
  } catch (_e) {
    return { ok: false };
  }
}
function canRead(w: Who, path: string): boolean {
  const f = folderOf(path);
  if (w.kind === "signer") return f === "minutes-sign";
  return (w.rank ?? 0) >= (READ_RANK[f] ?? DEFAULT_READ);
}
function canWrite(w: Who, folder: string): boolean {
  if (w.kind === "signer") return folder === "minutes-sign";
  return (w.rank ?? 0) >= (WRITE_RANK[folder] ?? DEFAULT_WRITE);
}

function newPath(folder: string, name: unknown): string {
  const safe = String(name || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file";
  const rand = crypto.getRandomValues(new Uint8Array(9));
  const tag = Date.now().toString(36) + Array.from(rand, (b) => (b % 36).toString(36)).join("");
  return folder + "/" + tag + "_" + safe;
}
async function uploadSign(path: string): Promise<string> {
  const r = await fetch(STORAGE + "/object/upload/sign/" + BUCKET + "/" + encPath(path), {
    method: "POST", headers: svc({ "Content-Type": "application/json" }), body: "{}"
  });
  if (!r.ok) throw new Error("upload_sign " + r.status);
  const d = await r.json() as { url?: string };
  if (!d || !d.url) throw new Error("upload_sign");
  return STORAGE + d.url;
}

/* 이수 등록 화면 — 표 확인 · 기록(서비스 권한 RPC) 후 업로드 URL */
async function eduUpload(body: Record<string, unknown>, origin: string): Promise<Response> {
  const ticket = String(body.ticket || "");
  if (!/^[0-9a-f]{48}$/.test(ticket)) return json({ ok: false, error: "ticket" }, 401, origin);
  const name = String(body.name || "file").slice(0, 160);
  const type = String(body.type || "");
  const size = Number(body.size) || 0;
  if (!EDU_EXT.test(name) || (type && !EDU_TYPES.test(type))) return json({ ok: false, error: "type" }, 415, origin);
  if (size <= 0 || size > EDU_MAX) return json({ ok: false, error: "too_large" }, 413, origin);
  const path = newPath("training", name);
  const r = await fetch(SUPA + "/rest/v1/rpc/semis_logi_edu_claim", {
    method: "POST", headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({ p_ticket: ticket, p_path: path, p_name: name, p_size: size, p_type: type })
  });
  if (!r.ok) return json({ ok: false, error: "claim " + r.status }, 502, origin);
  const d = await r.json() as { ok?: boolean; error?: string };
  if (!d || !d.ok) return json({ ok: false, error: String((d && d.error) || "claim") }, 403, origin);
  return json({ ok: true, path, url: PUBLIC_PREFIX + path, upload: await uploadSign(path) }, 200, origin);
}

/* 이수증 판독 — 표 · 경로 확인(서비스 권한 RPC) → 저장소에서 읽기 → Claude */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
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
const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
async function eduRead(body: Record<string, unknown>, origin: string): Promise<Response> {
  const ticket = String(body.ticket || ""), path = String(body.path || "");
  if (!/^[0-9a-f]{48}$/.test(ticket)) return json({ ok: false, error: "ticket" }, 401, origin);
  if (!/^training\/[A-Za-z0-9._-]{4,120}$/.test(path)) return json({ ok: false, error: "path" }, 400, origin);
  const roles = (Array.isArray(body.roles) ? body.roles : []).slice(0, 16).map((r) => str(r, 30)).filter(Boolean);
  const r0 = await fetch(SUPA + "/rest/v1/rpc/semis_logi_edu_read_ok", {
    method: "POST", headers: svc({ "Content-Type": "application/json" }), body: JSON.stringify({ p_ticket: ticket, p_path: path })
  });
  if (!r0.ok) return json({ ok: false, error: "check " + r0.status }, 502, origin);
  const chk = await r0.json() as { ok?: boolean; error?: string; courses?: { id: string; name: string; kind: string; roles?: string[] }[] };
  if (!chk || !chk.ok) return json({ ok: false, error: String((chk && chk.error) || "check") }, 403, origin);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!apiKey) return json({ ok: false, error: "no_key" }, 200, origin);
  const f = await fetch(STORAGE + "/object/" + BUCKET + "/" + encPath(path), { headers: svc() });
  if (!f.ok) return json({ ok: false, error: "file" }, 404, origin);
  const u8 = new Uint8Array(await f.arrayBuffer());
  const ext = (path.split(".").pop() || "").toLowerCase();
  let block: Record<string, unknown>;
  if (ext === "pdf") {
    if (u8.length > AI_MAX_PDF) return json({ ok: false, error: "too_large" }, 200, origin);
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(u8) } };
  } else if (AI_IMG[ext]) {
    if (u8.length > AI_MAX_IMG) return json({ ok: false, error: "too_large" }, 200, origin);
    block = { type: "image", source: { type: "base64", media_type: AI_IMG[ext], data: b64(u8) } };
  } else return json({ ok: false, error: "unsupported" }, 200, origin);
  const courses = Array.isArray(chk.courses) ? chk.courses : [];
  const list = courses.map((c) => `${c.id} | ${c.name} | ${c.kind} | 대상: ${(c.roles || []).join(", ") || "-"}`).join("\n");
  const ask = `[과정 목록]\n${list}\n\n[이 사람이 고른 직무]\n${roles.join(", ") || "-"}\n\n첨부한 이수증을 판독해 JSON 으로만 답하세요.`;
  const envModel = Deno.env.get("LOGI_AI_MODEL");
  const models = envModel ? [envModel, ...AI_MODELS.filter((m) => m !== envModel)] : AI_MODELS.slice();
  let res: Response | null = null, model = "";
  for (const m of models) {
    model = m;
    res = await fetch(AI_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: m, max_tokens: 500, system: AI_SYSTEM, messages: [{ role: "user", content: [block, { type: "text", text: ask }] }] })
    });
    if (res.status !== 404) break;
  }
  if (!res) return json({ ok: false, error: "ai" }, 200, origin);
  if (res.status === 401 || res.status === 403) return json({ ok: false, error: "bad_key" }, 200, origin);
  if (res.status === 429 || res.status === 529) return json({ ok: false, error: "busy" }, 200, origin);
  if (!res.ok) return json({ ok: false, error: "ai " + res.status }, 200, origin);
  const d = await res.json() as { content?: { type: string; text?: string }[] };
  const o = pickJson((d.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n"));
  if (!o) return json({ ok: false, error: "parse" }, 200, origin);
  const ids = courses.map((c) => c.id);
  const cid = typeof o.cid === "string" && ids.includes(o.cid) ? o.cid : "";
  const date = typeof o.date === "string" && ISO_RE.test(o.date) ? o.date : "";
  const expire = typeof o.expire === "string" && ISO_RE.test(o.expire) ? o.expire : "";
  const h = Number(o.hours);
  return json({ ok: true, model, data: {
    cid, course: str(o.course, 80), date, expire, org: str(o.org, 60), certNo: str(o.certNo, 40),
    hours: isFinite(h) && h > 0 && h < 1000 ? h : null, name: str(o.name, 30), conf: Math.max(0, Math.min(1, Number(o.conf) || 0))
  } }, 200, origin);
}

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  const r = await fetch(STORAGE + "/object/sign/" + BUCKET, {
    method: "POST", headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: EXPIRES, paths })
  });
  if (!r.ok) throw new Error("sign " + r.status);
  const rows = await r.json() as { path?: string; signedURL?: string | null; error?: string | null }[];
  const out: Record<string, string> = {};
  (Array.isArray(rows) ? rows : []).forEach((x) => {
    if (x && x.path && x.signedURL && !x.error) out[x.path] = encodeURI(STORAGE + x.signedURL);
  });
  return out;
}

async function listFolder(prefix: string) {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await fetch(STORAGE + "/object/list/" + BUCKET, {
      method: "POST", headers: svc({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } })
    });
    if (!r.ok) throw new Error("list " + r.status);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((x: Record<string, unknown>) => out.push(x));
    if (rows.length < 100) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, origin);
  if (origin && !ORIGINS.includes(origin) && !LOCAL_RE.test(origin)) return json({ ok: false, error: "origin" }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_e) { return json({ ok: false, error: "bad_json" }, 400, origin); }
  const op = String(body.op || "");
  if (op === "edu-upload" || op === "edu-read") {
    try { return op === "edu-upload" ? await eduUpload(body, origin) : await eduRead(body, origin); }
    catch (e) { return json({ ok: false, error: String((e as Error).message || e) }, 500, origin); }
  }
  const w = await whoAmI(req);
  if (!w.ok) return json({ ok: false, error: "auth" }, 401, origin);

  try {
    if (op === "sign") {
      const raw = Array.isArray(body.paths) ? body.paths.slice(0, MAX_SIGN) : [];
      const paths = Array.from(new Set(raw.map(cleanPath).filter((p): p is string => !!p)));
      const allowed = paths.filter((p) => canRead(w, p));
      const urls = allowed.length ? await signPaths(allowed) : {};
      const denied = paths.filter((p) => allowed.indexOf(p) < 0);
      return json({ ok: true, expires: EXPIRES, urls, denied }, 200, origin);
    }

    if (op === "upload") {
      const folder = String(body.prefix || "files");
      if (!/^[a-z0-9-]{2,30}$/.test(folder)) return json({ ok: false, error: "prefix" }, 400, origin);
      if (!canWrite(w, folder)) return json({ ok: false, error: "forbidden" }, 403, origin);
      const size = Number(body.size) || 0;
      if (size > MAX_SIZE) return json({ ok: false, error: "too_large" }, 413, origin);
      const type = String(body.type || "");
      if (BLOCK_TYPES.test(type)) return json({ ok: false, error: "type" }, 415, origin);
      const path = newPath(folder, body.name);
      return json({ ok: true, path, url: PUBLIC_PREFIX + path, upload: await uploadSign(path) }, 200, origin);
    }

    if (op === "list") {
      if ((w.rank ?? 0) < 4 || w.kind !== "user") return json({ ok: false, error: "forbidden" }, 403, origin);
      const roots = await listFolder("");
      const files: Record<string, unknown>[] = [];
      const mk = (folder: string, x: Record<string, unknown>) => {
        const meta = (x.metadata || {}) as Record<string, unknown>;
        return { path: (folder ? folder + "/" : "") + String(x.name), name: String(x.name), folder,
                 size: Number(meta.size || 0), updated: String(x.updated_at || x.created_at || "") };
      };
      for (const x of roots) {
        if (!x || !x.name) continue;
        if (x.id) { files.push(mk("", x)); continue; }
        const kids = await listFolder(String(x.name) + "/");
        kids.forEach((k) => { if (k && k.id && k.name) files.push(mk(String(x.name), k)); });
      }
      return json({ ok: true, files }, 200, origin);
    }

    if (op === "delete") {
      if ((w.rank ?? 0) < 4 || w.kind !== "user") return json({ ok: false, error: "forbidden" }, 403, origin);
      const raw = Array.isArray(body.paths) ? body.paths.slice(0, 100) : [];
      const paths = raw.map(cleanPath).filter((p): p is string => !!p);
      if (!paths.length) return json({ ok: true, deleted: [] }, 200, origin);
      const r = await fetch(STORAGE + "/object/" + BUCKET, {
        method: "DELETE", headers: svc({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: paths })
      });
      if (!r.ok) return json({ ok: false, error: "delete " + r.status }, 502, origin);
      const rows = await r.json();
      const deleted = (Array.isArray(rows) ? rows : []).map((x: Record<string, unknown>) => String(x.name || ""));
      return json({ ok: true, deleted }, 200, origin);
    }

    return json({ ok: false, error: "op" }, 400, origin);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500, origin);
  }
});
