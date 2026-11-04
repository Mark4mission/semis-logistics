/* H:drive — Supabase Edge Function "semis-logi-ksync" : K드라이브 동기화 에이전트(Mac, tools/ksync)의 유일한 출입구.
   - 사람 화면에서 부르지 않는다: Origin(또는 Sec-Fetch-Site) 헤더가 있는 요청은 거절하고 CORS 응답을 주지 않는다.
   - 인증: 헤더 x-ksync-key(32바이트 무작위 hex) → 여기서 sha256 → public.semis_logi_ksync_agent(서비스 권한만)가
     키 · 허용 IP · 횟수 · 연결 범위를 확인하고 기록한다. 키 원문은 DB 로 보내지 않는다.
   - 접속 IP 규칙은 SQL client_ip() 와 같다: cf-connecting-ip 우선, 없으면 x-forwarded-for 마지막 항목.
   - act: hello · net · folders · preview · run · mark = SQL 에 그대로 /
     put(phase begin = 경로를 정하고 업로드 서명 URL, commit = 저장소에서 다시 읽어 크기 · sha256 확인 뒤 문서함 등록) /
     get(연결된 문서의 파일만 — sha256 을 재고 서명 URL 10분).
   - 경로 규칙 · 50MB · 금지 형식은 semis-logi-files 와 같다(newPath — 무작위 접두사, 폴더 docs · 민감보안정보 docs-ssi).
   - 오류 응답은 짧은 코드만(경로 · 키 · 내부 사유를 돌려주지 않음). 서버는 에이전트에 명령을 보내지 않는다.
   - 배포: Supabase MCP deploy_edge_function (verify_jwt false — 위의 키 확인으로 대신). 이 파일이 원본. */

const SUPA = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "semis-logi-files";
const STORAGE = SUPA + "/storage/v1";
const PUBLIC_PREFIX = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/" + BUCKET + "/";   // 문서함이 쓰는 표준 주소(semis-logi-files 와 같음)
const MAX_BODY = 2 * 1024 * 1024;
const MAX_SIZE = 50 * 1024 * 1024;
const SIGN_SECS = 600;
const ACTS = ["hello", "net", "folders", "preview", "run", "mark", "put", "get"];
const STATUS: Record<string, number> = {
  auth: 401, ip: 403, origin: 403, scope: 403, rate: 429, quota: 429, type: 415, too_large: 413,
  hash: 409, held: 409, state: 409, run: 409, bad: 400, method: 405, server: 500
};

type Res = { ok?: boolean; error?: string; [k: string]: unknown };
const out = (body: Res, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (code: string) => out({ ok: false, error: STATUS[code] ? code : "bad" }, STATUS[code] || 400);
const svc = (extra: Record<string, string> = {}) => ({ apikey: SERVICE, Authorization: "Bearer " + SERVICE, ...extra });
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function sha256hex(data: string | Uint8Array): Promise<string> {
  const u8 = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", u8 as BufferSource));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function clientIp(h: Headers): string {
  const cf = (h.get("cf-connecting-ip") || "").trim();
  if (cf) return cf.slice(0, 64);
  const last = (h.get("x-forwarded-for") || "").split(",").pop()!.trim();
  return (last || "unknown").slice(0, 64);
}
/* semis-logi-files newPath 와 같은 규칙 */
export function newPath(folder: string, name: unknown): string {
  const safe = String(name || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file";
  const rand = crypto.getRandomValues(new Uint8Array(9));
  const tag = Date.now().toString(36) + Array.from(rand, (b) => (b % 36).toString(36)).join("");
  return folder + "/" + tag + "_" + safe;
}
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  txt: "text/plain", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  hwp: "application/x-hwp", hwpx: "application/hwp+zip", zip: "application/zip" };
export const mimeOf = (name: string) => MIME[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

async function rpc(act: string, hash: string, ip: string, p: Record<string, unknown>): Promise<Res> {
  const r = await fetch(SUPA + "/rest/v1/rpc/semis_logi_ksync_agent", {
    method: "POST", headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({ p_act: act, p_key_hash: hash, p_ip: ip, p })
  });
  if (!r.ok) throw new Error("rpc");
  return await r.json() as Res;
}
async function readObject(path: string): Promise<Uint8Array | null> {
  const r = await fetch(STORAGE + "/object/" + BUCKET + "/" + encPath(path), { headers: svc() });
  if (!r.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}
async function removeObject(path: string): Promise<void> {
  try {
    await fetch(STORAGE + "/object/" + BUCKET, { method: "DELETE", headers: svc({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: [path] }) });
  } catch (_e) { /* 연결 없는 파일 정리로 남는다 */ }
}
async function uploadSign(path: string): Promise<string> {
  const r = await fetch(STORAGE + "/object/upload/sign/" + BUCKET + "/" + encPath(path), { method: "POST", headers: svc({ "Content-Type": "application/json" }), body: "{}" });
  if (!r.ok) throw new Error("upload_sign");
  const d = await r.json() as { url?: string };
  if (!d || !d.url) throw new Error("upload_sign");
  return STORAGE + d.url;
}
async function downloadSign(path: string): Promise<string> {
  const r = await fetch(STORAGE + "/object/sign/" + BUCKET + "/" + encPath(path), {
    method: "POST", headers: svc({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: SIGN_SECS })
  });
  if (!r.ok) throw new Error("sign");
  const d = await r.json() as { signedURL?: string };
  if (!d || !d.signedURL) throw new Error("sign");
  return encodeURI(STORAGE + d.signedURL);
}

async function put(hash: string, ip: string, b: Record<string, unknown>): Promise<Response> {
  if (b.phase === "commit") {
    const path = String(b.path || "");
    if (!/^docs(-ssi)?\/[a-z0-9]{12,24}_[A-Za-z0-9._-]{1,80}$/.test(path)) return fail("bad");
    const peek = await rpc("put_peek", hash, ip, { path });
    if (!peek.ok) return fail(String(peek.error || "state"));
    const u8 = await readObject(path);
    if (!u8) return fail("state");
    const got = await sha256hex(u8);
    const d = await rpc("put_commit", hash, ip, { path, sha256: got, size: u8.length, url: PUBLIC_PREFIX + path });
    if (!d.ok) {
      if (d.error === "hash") await removeObject(path);
      return fail(String(d.error || "state"));
    }
    return out({ ok: true, doc: d.doc, url: PUBLIC_PREFIX + path });
  }
  const rel = typeof b.rel_path === "string" ? b.rel_path : "";
  const size = Number(b.size);
  if (!rel || rel.length > 300) return fail("bad");
  if (!(size >= 0)) return fail("bad");
  if (size > MAX_SIZE) return fail("too_large");
  const path = newPath(b.ssi === true ? "docs-ssi" : "docs", baseName(rel));
  const d = await rpc("put", hash, ip, { run: b.run, map: b.map, rel_path: rel, size, sha256: b.sha256, mtime: b.mtime, mode: b.mode, row: b.row, state: b.state, path });
  if (!d.ok) return fail(String(d.error || "bad"));
  return out({ ok: true, path, url: PUBLIC_PREFIX + path, upload: await uploadSign(path), type: mimeOf(baseName(rel)) });
}

async function get(hash: string, ip: string, b: Record<string, unknown>): Promise<Response> {
  const d = await rpc("get", hash, ip, { run: b.run, map: b.map, doc: b.doc, url: b.url });
  if (!d.ok) return fail(String(d.error || "bad"));
  const path = String(d.path || "");
  const u8 = await readObject(path);
  if (!u8) return fail("state");
  return out({ ok: true, url: await downloadSign(path), sha256: await sha256hex(u8), size: u8.length, name: d.name, expires: SIGN_SECS });
}

export async function handle(req: Request): Promise<Response> {
  if (req.headers.get("origin") || req.headers.get("sec-fetch-site") || req.headers.get("sec-fetch-mode")) return fail("origin");
  if (req.method !== "POST") return fail("method");
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return fail("too_large");
  let b: Record<string, unknown>;
  try {
    const t = await req.text();
    if (t.length > MAX_BODY) return fail("too_large");
    b = JSON.parse(t);
  } catch (_e) { return fail("bad"); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("bad");
  const act = String(b.act || "");
  if (ACTS.indexOf(act) < 0) return fail("bad");
  const key = req.headers.get("x-ksync-key") || "";
  const hash = /^[0-9a-f]{64}$/.test(key) ? await sha256hex(key) : "";
  const ip = clientIp(req.headers);
  try {
    if (act === "put") return await put(hash, ip, b);
    if (act === "get") return await get(hash, ip, b);
    const p = { ...b };
    delete p.act;
    const d = await rpc(act, hash, ip, p);
    return d.ok ? out(d) : fail(String(d.error || "bad"));
  } catch (_e) {
    return fail("server");
  }
}

Deno.serve(handle);
