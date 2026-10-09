/* ARGOS — Supabase Edge Function "semis-logi-files" (v1.15 · v1.39 edu-upload · edu-read · v1.47 desk-read · copy)
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
   - v1.47 메인 데스크: desk/ 폴더(열람 · 올리기 3). op "desk-read" = 접수 문서 판독(hq 이상, 목록은 화면이 보냄 · 이름 · 연락처는 보내지 않음),
     op "copy" = desk/ 원본을 반영 대상 폴더로 복사(원본 열람 · 대상 폴더 올리기 등급 확인)
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
  docs: 2, cases: 2, dissem: 2            // v1.40 증빙 문서 · 보안 처리 대장 · 전파교육 (docs-ssi · contracts · desk 는 기본 3 = hq)
};
const WRITE_RANK: Record<string, number> = {
  minutes: 2, "minutes-sign": 2, seclog: 2, threat: 2, patrol: 2,
  schedules: 3, notices: 3, attach: 3, contacts: 3, crisis: 3, regs: 3, "regs-diff": 3, audits: 3, training: 3,
  docs: 3, "docs-ssi": 3, contracts: 3, cases: 3, dissem: 3, desk: 3
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
const DESK_MAX_TEXT = 60000;
const DESK_SYSTEM = `당신은 항공화물터미널 안전보안 부서의 문서 접수 담당입니다. 첨부 문서를 읽고 업무 시스템에 반영할 내용을 JSON 객체 하나로만 답합니다. 설명 · 코드펜스 금지.
문서 구분 type:
- cert: 교육 이수증 · 수료증 · 수료자 명단
- notice: 공문 · 회의 · 행사 · 교육 실시 안내처럼 날짜가 정해진 일이 있는 문서
- dissem: 본사 · 당국의 보안 전파 통보(규정 개정 · 보안등급 · 보고체계 · 지침 강화 등 팀 전파교육 대상)
- audit: 점검 · 심사 결과 통보, 지적사항
- special: 특별보안검색 · 의심화물 등 보안 처리 활동 보고서
- hardcopy: 손으로 쓴 점검 기록부 · 관리대장(월별 위해물품 관리대장 등)의 스캔본
- other: 그 밖
형식:
{"type": "", "title": "문서 제목", "summary": "핵심 2~3문장", "date": "문서 일자 또는 null", "org": "발신 · 작성 기관", "conf": 0~1,
 "certs": [{"name": "이수자", "emp": "사번", "cid": "과정 id 또는 null", "course": "과정명", "date": "수료일", "expire": "이수증 기재 유효기한 또는 null", "org": "교육기관", "certNo": "번호", "hours": 숫자 또는 null}],
 "events": [{"title": "", "start": "", "end": "또는 null", "time": "HH:MM 또는 null", "timeEnd": "HH:MM 또는 null", "place": "", "cat": "meeting|training|inspection|regulation|deadline|event|other", "area": "security|safety|industrial|dg|", "memo": "대상 · 준비물 한 줄"}],
 "dissem": {"kind": "전파 구분", "title": "전파 내용 한 줄", "due": "전파 · 회신 기한 또는 null"} 또는 null,
 "audit": {"auditId": "수검 id 또는 null", "body": "gov|foreign|internal", "org": "점검 기관", "kind": "점검 유형", "start": "", "end": "또는 null", "findings": [{"type": "car|rec|onsite|obs", "ref": "근거 조항", "text": "지적 내용", "due": "조치 기한 또는 null"}]} 또는 null,
 "case": {"type": "처리 유형 id", "date": "", "ref": "운송장(MAWB)", "flight": "편명", "pcs": "", "uld": "", "agent": "대리점", "shipper": "화주", "region": "지역", "start": "HH:MM", "end": "HH:MM", "by": "확인자", "result": "처리 결과", "note": ""} 또는 null,
 "hardcopy": {"tid": "기록부 양식 id 또는 null", "date": "기록한 기간 중 하루(월별 대장은 그 달 1일)", "result": "ok|ng", "count": 건수 또는 null, "note": "이상 · 특이사항"} 또는 null,
 "shelf": {"mod": "서가 화면 id", "grp": "묶음 id", "title": "보관 문서 이름", "date": ""} 또는 null}
규칙:
- 문서에 적힌 사실만. 없는 값은 null 또는 "". 추측 금지. 날짜는 서기 YYYY-MM-DD, 연도가 없으면 기준일에 가까운 연도.
- 해당 없는 항목은 빈 배열 또는 null. 한 문서에 여러 항목이 있으면 모두 채운다(예: 전파 통보에 회신 기한 → dissem 과 events 의 deadline).
- events 는 회의 · 교육 · 점검 · 행사 · 제출 기한처럼 날짜가 정해진 것만. cat: 회의 meeting, 교육 training, 점검 · 심사 · 평가 inspection, 규정 · 절차 · 매뉴얼 시행 regulation, 제출 · 회신 기한 deadline, 행사 · 견학 event.
- area: 항공 · 화물 보안 security, 항공 · 지상 안전 safety, 산업안전(산안법 · 중대재해) industrial, 위험물 dg. 애매하면 빈 문자열.
- cid · auditId · tid · case.type · shelf.mod · shelf.grp · dissem.kind 는 아래 목록의 값만. 맞는 것이 없으면 null.
- shelf 는 문서를 원본째 보관할 곳(점검 기록부 스캔 · 보고서 · 절차서 등). cert · notice 는 보통 null.
- audit.findings.type: 시정조치 car, 개선권고 rec, 현장시정 onsite, 관찰사항 obs.
- summary · memo 에 전화번호 · 주민번호를 옮기지 않는다.`;

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

/* 메인 데스크 판독 — hq 이상 · desk/ 파일. 워드 · 한글 · 엑셀은 화면이 뽑은 글(text)로, PDF · 이미지는 저장소 원본으로 */
const capped = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []) as Record<string, unknown>[];
function deskCatalog(c: Record<string, unknown>): string {
  const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  const today = typeof o.today === "string" && ISO_RE.test(o.today) ? o.today : new Date().toISOString().slice(0, 10);
  const rows = (title: string, xs: string[]) => `[${title}]\n${xs.filter(Boolean).join("\n") || "-"}`;
  return [
    "기준일: " + today,
    rows("교육 과정 (id | 과정 | 구분)", capped(o.courses, 120).map((x) => [str(x.id, 30), str(x.name, 60), str(x.kind, 10)].join(" | "))),
    rows("수검 (id | 점검 | 시작일)", capped(o.audits, 40).map((x) => [str(x.id, 30), str(x.title, 60), str(x.start, 10)].join(" | "))),
    rows("기록부 양식 (id | 이름 | 주기)", capped(o.templates, 80).map((x) => [str(x.id, 30), str(x.name, 60), str(x.cycle, 10)].join(" | "))),
    rows("처리 유형 (id | 이름)", capped(o.caseTypes, 20).map((x) => [str(x.id, 20), str(x.label, 40)].join(" | "))),
    rows("문서 서가 (화면 id | 묶음 id | 이름)", capped(o.shelves, 120).map((x) => [str(x.mod, 30), str(x.grp, 30), str(x.label, 60)].join(" | "))),
    rows("전파 구분", (Array.isArray(o.dissemKinds) ? o.dissemKinds.slice(0, 20) : []).map((k) => str(k, 30)))
  ].join("\n\n");
}
async function deskRead(w: Who, body: Record<string, unknown>, origin: string): Promise<Response> {
  if (w.kind !== "user" || (w.rank ?? 0) < 3) return json({ ok: false, error: "forbidden" }, 403, origin);
  const path = String(body.path || "");
  if (!/^desk\/[A-Za-z0-9._-]{4,160}$/.test(path)) return json({ ok: false, error: "path" }, 400, origin);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!apiKey) return json({ ok: false, error: "no_key" }, 200, origin);
  const name = str(body.name, 160);
  const text = typeof body.text === "string" ? body.text.slice(0, DESK_MAX_TEXT) : "";
  const blocks: Record<string, unknown>[] = [];
  if (text.trim()) blocks.push({ type: "text", text: `[문서 본문 — ${name || "파일"}]\n${text}` });
  else {
    const f = await fetch(STORAGE + "/object/" + BUCKET + "/" + encPath(path), { headers: svc() });
    if (!f.ok) return json({ ok: false, error: "file" }, 404, origin);
    const u8 = new Uint8Array(await f.arrayBuffer());
    const ext = (path.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") {
      if (u8.length > AI_MAX_PDF) return json({ ok: false, error: "too_large" }, 200, origin);
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(u8) } });
    } else if (AI_IMG[ext]) {
      if (u8.length > AI_MAX_IMG) return json({ ok: false, error: "too_large" }, 200, origin);
      blocks.push({ type: "image", source: { type: "base64", media_type: AI_IMG[ext], data: b64(u8) } });
    } else return json({ ok: false, error: "unsupported" }, 200, origin);
  }
  blocks.push({ type: "text", text: deskCatalog(body.cat as Record<string, unknown>) + `\n\n파일 이름: ${name || "-"}\n첨부 문서를 판독해 JSON 으로만 답하세요.` });
  const envModel = Deno.env.get("LOGI_AI_MODEL");
  const models = envModel ? [envModel, ...AI_MODELS.filter((m) => m !== envModel)] : AI_MODELS.slice();
  let res: Response | null = null, model = "";
  for (const m of models) {
    model = m;
    res = await fetch(AI_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: m, max_tokens: 4000, system: DESK_SYSTEM, messages: [{ role: "user", content: blocks }] })
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
  if (!o || JSON.stringify(o).length > 120000) return json({ ok: false, error: "parse" }, 200, origin);
  return json({ ok: true, model, data: o }, 200, origin);
}

/* desk/ 원본 → 반영 대상 폴더 사본 */
async function copyOut(w: Who, body: Record<string, unknown>, origin: string): Promise<Response> {
  const from = cleanPath(body.from);
  const folder = String(body.prefix || "");
  if (!from || folderOf(from) !== "desk") return json({ ok: false, error: "path" }, 400, origin);
  if (!/^[a-z0-9-]{2,30}$/.test(folder) || folder === "desk") return json({ ok: false, error: "prefix" }, 400, origin);
  if (w.kind !== "user" || !canRead(w, from) || !canWrite(w, folder)) return json({ ok: false, error: "forbidden" }, 403, origin);
  const base = from.slice(from.lastIndexOf("/") + 1).replace(/^[a-z0-9]{12,24}_/, "");
  const path = newPath(folder, base);
  const r = await fetch(STORAGE + "/object/copy", {
    method: "POST", headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({ bucketId: BUCKET, sourceKey: from, destinationKey: path })
  });
  if (!r.ok) return json({ ok: false, error: "copy " + r.status }, 502, origin);
  return json({ ok: true, path, url: PUBLIC_PREFIX + path }, 200, origin);
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

    if (op === "desk-read") return await deskRead(w, body, origin);
    if (op === "copy") return await copyOut(w, body, origin);

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
