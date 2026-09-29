/* SeMIS · Logistics — Supabase Edge Function "semis-logi-favicon" (v1.23)
   바로가기(링크 메뉴) 아이콘용 — 사이트의 파비콘을 찾아 이미지 자체를 돌려준다.
   브라우저는 다른 사이트의 HTML·이미지 바이트를 읽을 수 없어서(CORS) 서버가 대신 받는다.
   - 인증: 요청 헤더 x-semis-token → public.semis_logi_file_auth() — 시스템관리자(rank 4)만 (메뉴 쓰기 등급과 같음)
   - 입력: { url } (http/https). 이미지 주소면 그 이미지, 웹 페이지면 <link rel="icon" …> 후보 → /favicon.ico
   - 출력: { ok: true, data: "data:<형식>;base64,…", type, src } / { ok: false, error: "not_found" | "unreachable" | "blocked" | "url" | … }
     unreachable = 어느 요청도 응답을 받지 못함(사내 DNS에만 있는 주소 · 해외 접속 차단 · 시간 초과)
     화면이 64px PNG로 줄여 메뉴(menus[].fav)에 저장한다 — 이 함수는 아무것도 저장하지 않는다
   - 보호: 사설망 · 루프백 · 링크로컬 · 메타데이터 주소 거부(리다이렉트 단계마다 다시 검사, DNS 조회가 되면 IP도 검사),
           포트 80 · 443 · 8080 · 8443만, 리다이렉트 5회, 페이지 512KB(넘으면 앞부분만) · 이미지 1.5MB · 요청마다 8초,
           이미지 형식은 파일 첫 바이트로 판정(서버가 준 Content-Type은 믿지 않음)
   - 배포: Supabase MCP deploy_edge_function (verify_jwt false — 위의 세션 확인으로 대신). 이 파일이 원본. */

const SUPA = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ORIGINS = ["https://mark4mission.github.io", "https://logistics.semis.pe.kr"];
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 SeMIS-Logistics-favicon";
const PAGE_MAX = 512 * 1024;
const IMG_MAX = 1536 * 1024;
const HOPS = 5;
const TIMEOUT = 8000;
const MAX_TRY = 5;
const PORTS = ["", "80", "443", "8080", "8443"];

type Who = { ok: boolean; kind?: string; rank?: number };
type Got = { url: string; bytes: Uint8Array; truncated: boolean };
type Trace = { reached: boolean };   // 한 번이라도 HTTP 응답을 받았는지(요청마다 따로)

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

/* ─── 주소 검사 (SSRF 방어) ─── */
export function privateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function privateV6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s)) return true;          // ULA · 링크로컬
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);                  // IPv4 매핑
  if (m) return privateV4(m[1]);
  return s.startsWith("::ffff:") || s.startsWith("64:ff9b:");
}
export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
      h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (/^\d+(\.\d+){3}$/.test(h)) return privateV4(h);
  if (h.includes(":")) return privateV6(h);
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return true;                // 정수 · 16진 IP 표기
  return !h.includes(".");                                             // 점 없는 이름(사내 호스트)
}
export function checkUrl(u: string): URL | null {
  let x: URL;
  try { x = new URL(u); } catch (_e) { return null; }
  if (x.protocol !== "https:" && x.protocol !== "http:") return null;
  if (x.username || x.password) return null;
  if (!PORTS.includes(x.port)) return null;
  if (privateHost(x.hostname)) return null;
  return x;
}
/* 이름이 사설 IP로 풀리면 막는다(사내 시스템 주소가 공용 DNS에 10.x 로 올라 있는 경우 등).
   DNS 조회 자체를 할 수 없으면 사설망 여부를 확인할 수 없으므로 막는다. */
async function resolvesPrivate(host: string): Promise<boolean> {
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return false;   // 숫자 주소는 checkUrl에서 이미 검사
  if (typeof Deno.resolveDns !== "function") return true;
  const ips: string[] = [];
  let looked = false;
  for (const rt of ["A", "AAAA"] as const) {
    try { ips.push(...await Deno.resolveDns(host, rt)); looked = true; }
    catch (e) { if (e instanceof Deno.errors.NotFound) looked = true; }
  }
  if (!looked) return true;
  return ips.some(ip => ip.includes(":") ? privateV6(ip) : privateV4(ip));
}

async function readCapped(r: Response, max: number, cut: boolean): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const len = Number(r.headers.get("content-length") || 0);
  if (!cut && len > max) { try { await r.body?.cancel(); } catch (_e) { /* */ } throw new Error("too_big"); }
  if (!r.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0, truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > max) {
      if (!cut) { try { await reader.cancel(); } catch (_e) { /* */ } throw new Error("too_big"); }
      chunks.push(value.subarray(0, max - n)); n = max; truncated = true;
      try { await reader.cancel(); } catch (_e) { /* */ }
      break;
    }
    chunks.push(value); n += value.length;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return { bytes: out, truncated };
}
async function get(url: string, max: number, cut: boolean, accept: string, tr: Trace): Promise<Got> {
  let cur = url;
  for (let hop = 0; hop <= HOPS; hop++) {
    const x = checkUrl(cur);
    if (!x) throw new Error("blocked");
    if (await resolvesPrivate(x.hostname)) throw new Error("blocked");
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(x.href, {
        redirect: "manual", signal: ctl.signal,
        headers: { "User-Agent": UA, "Accept": accept, "Accept-Language": "ko,en;q=0.8" }
      });
      tr.reached = true;
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) {
        try { await r.body?.cancel(); } catch (_e) { /* */ }
        cur = new URL(loc, x).href;
        continue;
      }
      if (!r.ok) { try { await r.body?.cancel(); } catch (_e) { /* */ } throw new Error("http " + r.status); }
      const { bytes, truncated } = await readCapped(r, max, cut);
      return { url: x.href, bytes, truncated };
    } finally {
      clearTimeout(tm);
    }
  }
  throw new Error("redirects");
}

/* ─── 이미지 판정 · 후보 찾기 ─── */
export function sniff(b: Uint8Array): string {
  if (b.length < 4) return "";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "image/x-icon";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 600)).replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if ((head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) && !head.includes("<html")) return "image/svg+xml";
  return "";
}
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  return out;
}
const unent = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/g, "/");
/* 우선순위: SVG 아이콘 > 32px 이상 icon(큰 것) > apple-touch-icon > 작은 icon — 마지막에 /favicon.ico */
export function candidates(html: string, pageUrl: string): string[] {
  let base = pageUrl;
  const bm = /<base\b[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(html);
  if (bm) { try { base = new URL(unent(bm[1]), pageUrl).href; } catch (_e) { /* */ } }
  const list: { s: number; u: string }[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = attrs(m[0]);
    const rel = (a.rel || "").toLowerCase().split(/\s+/);
    const href = unent((a.href || "").trim());
    if (!href || href.startsWith("data:") || href.startsWith("javascript:")) continue;
    const touch = rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed");
    if (!rel.includes("icon") && !touch) continue;
    let sz = 0;
    (a.sizes || "").toLowerCase().split(/\s+/).forEach(s => {
      const mm = /^(\d+)x(\d+)$/.exec(s);
      if (mm) sz = Math.max(sz, Number(mm[1]));
      if (s === "any") sz = Math.max(sz, 512);
    });
    const svg = (a.type || "").toLowerCase().includes("svg") || /\.svg($|[?#])/i.test(href);
    const s = svg ? 900 : touch ? 300 + Math.min(sz || 180, 256) : sz >= 32 ? 400 + Math.min(sz, 256) : 200 + sz;
    try { list.push({ s, u: new URL(href, base).href }); } catch (_e) { /* */ }
  }
  list.sort((x, y) => y.s - x.s);
  const out: string[] = [];
  list.forEach(c => { if (!out.includes(c.u)) out.push(c.u); });
  return out;
}
function b64(u8: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
}
const ok = (t: string, bytes: Uint8Array, src: string) => ({ ok: true, data: "data:" + t + ";base64," + b64(bytes), type: t, src });

export async function findIcon(url: string): Promise<Record<string, unknown>> {
  const tr: Trace = { reached: false };
  const list: string[] = [];
  let pageUrl = url;
  let blocked = false;
  try {
    const page = await get(url, PAGE_MAX, true, "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8", tr);
    pageUrl = page.url;
    const t = sniff(page.bytes);
    if (t && !page.truncated) return ok(t, page.bytes, page.url);        // 이미지 주소를 바로 준 경우
    if (!t) list.push(...candidates(new TextDecoder("utf-8", { fatal: false }).decode(page.bytes), page.url));
  } catch (e) {
    if ((e as Error).message === "blocked") blocked = true;
  }
  const fav = (u: string) => { try { const x = new URL(u); return x.protocol + "//" + x.host + "/favicon.ico"; } catch (_e) { return ""; } };
  [fav(pageUrl), fav(url)].forEach(u => { if (u && !list.includes(u)) list.push(u); });
  for (const c of list.slice(0, MAX_TRY)) {
    try {
      const im = await get(c, IMG_MAX, false, "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.5", tr);
      const t = sniff(im.bytes);
      if (t) return ok(t, im.bytes, im.url);
    } catch (e) {
      if ((e as Error).message === "blocked") blocked = true;
    }
  }
  return { ok: false, error: blocked ? "blocked" : tr.reached ? "not_found" : "unreachable" };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, origin);
  const w = await whoAmI(req);
  if (!w.ok || w.kind !== "user") return json({ ok: false, error: "auth" }, 401, origin);
  if ((w.rank || 0) < 4) return json({ ok: false, error: "forbidden" }, 403, origin);
  let body: { url?: unknown } = {};
  try { body = await req.json(); } catch (_e) { return json({ ok: false, error: "bad_request" }, 400, origin); }
  const url = String(body && body.url || "").trim().slice(0, 2000);
  if (!checkUrl(url)) return json({ ok: false, error: "url" }, 400, origin);
  try {
    return json(await findIcon(url), 200, origin);
  } catch (_e) {
    return json({ ok: false, error: "fetch" }, 200, origin);
  }
});
