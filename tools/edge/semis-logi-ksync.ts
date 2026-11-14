/* H:drive — Supabase Edge Function "semis-logi-ksync" : K드라이브 동기화 에이전트(Mac, tools/ksync)의 유일한 출입구.
   - 사람 화면에서 부르지 않는다: Origin(또는 Sec-Fetch-Site) 헤더가 있는 요청은 거절하고 CORS 응답을 주지 않는다.
     Sec-Fetch-Mode 는 보지 않는다 — Node fetch(에이전트)가 늘 'cors' 로 보내므로 그것까지 막으면 에이전트가 붙지 못한다.
   - 인증: 헤더 x-ksync-key(32바이트 무작위 hex) → 여기서 sha256 → public.semis_logi_ksync_agent(서비스 권한만)가
     키 · 허용 IP · 횟수 · 연결 범위를 확인하고 기록한다. 키 원문은 DB 로 보내지 않는다.
   - 접속 IP 규칙은 SQL client_ip() 와 같다: cf-connecting-ip 우선, 없으면 x-forwarded-for 마지막 항목.
   - act: hello · net · folders · preview · recon · run · mark = SQL 에 그대로 /
     hash(해시 채우기 — SQL 이 고른 H 첨부를 저장소에서 읽어 sha256 을 재고 SQL 이 적는다. 에이전트는 값 · 경로를 보내지 않음) /
     put(phase begin = 이름 부분만 여기서 정하고 폴더 · 경로는 SQL 이 정함 → 업로드 서명 URL,
         verify = 저장소에서 다시 읽어 잰 크기 · sha256 을 SQL 이 시작 때 값과 대조 — 다르면 파일을 지움.
                  서명 업로드 URL 은 크기를 막지 않으므로 시작 때 크기를 넘는 순간 읽기를 끊고 불일치로 본다) /
     apply(확인한 올리기 여러 건을 문서함에 한 번에 — 공용 행 이력 · 변경 알림이 파일 수만큼 생기지 않게) /
     get(연결된 문서의 파일만 — sha256 을 재고 서명 URL 10분).
   - 에이전트가 보낸 경로 · 폴더 · ssi · 주소 앞부분은 쓰지 않는다: 폴더(민감보안정보 docs-ssi)는 연결 · 판 묶음을 아는 SQL 이,
     문서함 주소 앞부분은 여기서(PUBLIC_PREFIX) 정한다 — 키를 가진 쪽이 SSI 파일을 docs/ 에 두거나 다른 주소를 등록하지 못하게.
   - 경로 규칙 · 50MB 는 semis-logi-files 와 같다(newPath — 무작위 접두사, 폴더 docs · 민감보안정보 docs-ssi). 올리지 않는 형식은 SQL ksync_h_blocked(동기화 전용 — 파일 함수보다 넓음).
   - 본문 2MB 상한은 Content-Length 가 없어도(chunked) 읽는 중에 끊는다 — 다 받아 놓고 재면 상한이 메모리를 지키지 못한다.
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
const HASH_MAX = 20, HASH_BYTES = 100 * 1024 * 1024;     // 해시 채우기 한 번에 — 20개 · 합계 100MB 까지(넘으면 남은 것은 다음 호출)
const ACTS = ["hello", "net", "folders", "preview", "recon", "run", "mark", "put", "apply", "get", "hash"];
const STATUS: Record<string, number> = {
  auth: 401, ip: 403, origin: 403, scope: 403, rate: 429, quota: 429, type: 415, too_large: 413,
  hash: 409, held: 409, state: 409, run: 409, old: 409, bad: 400, method: 405, server: 500
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
  if (b.phase === "verify") {
    const path = String(b.path || "");
    if (!/^docs(-ssi)?\/[a-z0-9]{12,24}_[A-Za-z0-9._-]{1,80}$/.test(path)) return fail("bad");
    const peek = await rpc("put_peek", hash, ip, { path });
    if (!peek.ok) return fail(String(peek.error || "state"));
    const max = Number(peek.size);
    const r = await fetch(STORAGE + "/object/" + BUCKET + "/" + encPath(path), { headers: svc() });
    if (!r.ok) return fail("state");
    // 시작 때 크기를 넘으면 그 자리에서 끊는다 — 키를 가진 쪽이 큰 파일을 올려 여기서 통째로 읽게 하면 Edge 메모리가 찬다.
    // 넘은 크기를 그대로 넘겨 SQL 이 불일치(hash_mismatch)로 기록 · 올리기를 버리게 하고, 아래에서 파일을 지운다
    const u8 = await readCapped(r.body, max);
    const d = await rpc("put_verify", hash, ip, u8 ? { path, sha256: await sha256hex(u8), size: u8.length } : { path, sha256: "", size: max + 1 });
    if (!d.ok) {
      if (d.error === "hash") await removeObject(path);
      return fail(String(d.error || "state"));
    }
    return out({ ok: true });
  }
  if (b.phase !== "begin") return fail("bad");
  const rel = typeof b.rel_path === "string" ? b.rel_path : "";
  const size = Number(b.size);
  if (!rel || rel.length > 300) return fail("bad");
  if (!(size >= 0)) return fail("bad");
  if (size > MAX_SIZE) return fail("too_large");
  const part = newPath("", baseName(rel)).slice(1);     // '태그_이름' 만 — 폴더는 SQL 이 정한다
  // h_url = 충돌(K 가 이김) 새 판이 바꿀, 계획이 본 H 판 — SQL 이 등록 때 지금 판에 있는지 대 보기만 한다(등록하는 주소가 아님)
  const hUrl = typeof b.h_url === "string" ? b.h_url : undefined;
  const d = await rpc("put", hash, ip, { run: b.run, map: b.map, rel_path: rel, size, sha256: b.sha256, mtime: b.mtime, mode: b.mode, row: b.row, state: b.state, h_url: hUrl, part });
  if (!d.ok) return fail(String(d.error || "bad"));
  const path = String(d.path || "");
  return out({ ok: true, path, url: PUBLIC_PREFIX + path, upload: await uploadSign(path), type: mimeOf(baseName(rel)) });
}

async function apply(hash: string, ip: string, b: Record<string, unknown>): Promise<Response> {
  const d = await rpc("put_apply", hash, ip, { run: b.run, paths: b.paths, prefix: PUBLIC_PREFIX });
  if (!d.ok) return fail(String(d.error || "bad"));
  return out({ ok: true, docs: d.docs });
}

async function get(hash: string, ip: string, b: Record<string, unknown>): Promise<Response> {
  const d = await rpc("get", hash, ip, { run: b.run, map: b.map, doc: b.doc, url: b.url });
  if (!d.ok) return fail(String(d.error || "bad"));
  const path = String(d.path || "");
  const u8 = await readObject(path);
  if (!u8) return fail("state");
  return out({ ok: true, url: await downloadSign(path), sha256: await sha256hex(u8), size: u8.length, name: d.name, expires: SIGN_SECS });
}

/* 해시 채우기 — SQL(hash_todo)이 연결 범위 안 · 해시 없는 H 첨부의 저장소 경로를 주고, 여기서 읽어 잰 sha256 을 SQL(hash_set)이 그 첨부에 적는다.
   읽기 전용(저장소 파일을 바꾸거나 지우지 않음). 50MB 를 넘으면 그 자리에서 끊고(too_large), 못 읽은 것은 SQL 이 하루 건너뛴다 */
async function hashFill(hash: string, ip: string, b: Record<string, unknown>): Promise<Response> {
  const t = await rpc("hash_todo", hash, ip, { run: b.run });
  if (!t.ok) return fail(String(t.error || "bad"));
  const items = Array.isArray(t.items) ? (t.items as Record<string, unknown>[]).slice(0, HASH_MAX) : [];
  if (!items.length) return out({ ok: true, n: 0, left: Number(t.left) || 0 });
  const res: Record<string, unknown>[] = [];
  let read = 0;
  for (const it of items) {
    if (read >= HASH_BYTES) break;     // 남은 것은 다음 호출이 다시 받는다(적지 않았으므로)
    const path = String(it.path || "");
    if (!/^[A-Za-z0-9._/-]{3,300}$/.test(path) || /(^|\/)\.\.?(\/|$)/.test(path)) { res.push({ url: it.url, err: "path" }); continue; }
    try {
      const r = await fetch(STORAGE + "/object/" + BUCKET + "/" + encPath(path), { headers: svc() });
      if (!r.ok) { await r.body?.cancel().catch(() => {}); res.push({ url: it.url, err: "read" }); continue; }
      const u8 = await readCapped(r.body, MAX_SIZE);
      if (!u8) { res.push({ url: it.url, err: "too_large" }); continue; }
      read += u8.length;
      res.push({ url: it.url, sha: await sha256hex(u8) });
    } catch (_e) { res.push({ url: it.url, err: "read" }); }
  }
  const s = await rpc("hash_set", hash, ip, { run: b.run, items: res, last: b.last === true });
  if (!s.ok) return fail(String(s.error || "bad"));
  return out({ ok: true, n: s.n, left: s.left });
}

/* 흐름을 읽으며 바이트를 세고 상한을 넘으면 그 자리에서 끊는다(null) */
async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}
async function readBody(req: Request): Promise<string | null> {
  const u8 = await readCapped(req.body, MAX_BODY);
  return u8 === null ? null : new TextDecoder().decode(u8);
}

export async function handle(req: Request): Promise<Response> {
  if (req.headers.get("origin") || req.headers.get("sec-fetch-site")) return fail("origin");
  if (req.method !== "POST") return fail("method");
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return fail("too_large");
  let b: Record<string, unknown>;
  try {
    const t = await readBody(req);
    if (t === null) return fail("too_large");
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
    if (act === "apply") return await apply(hash, ip, b);
    if (act === "get") return await get(hash, ip, b);
    if (act === "hash") return await hashFill(hash, ip, b);
    const p = { ...b };
    delete p.act;
    const d = await rpc(act, hash, ip, p);
    return d.ok ? out(d) : fail(String(d.error || "bad"));
  } catch (_e) {
    return fail("server");
  }
}

Deno.serve(handle);
