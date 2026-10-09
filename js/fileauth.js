/* 비공개 첨부 버킷 주소 변환 — 데이터에는 표준 public 주소만 저장하고,
   화면에 나타나면 세션 서명 URL(1시간)로 바꿔 끼운다(MutationObserver). 저장 전엔 canon() 으로 되돌림 */
"use strict";

(() => {
  const HOST = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/";
  const BUCKET = "semis-logi-files";
  const PUB = HOST + "public/" + BUCKET + "/";
  const SIGN = HOST + "sign/" + BUCKET + "/";
  const ATTR = { IMG: "src", IFRAME: "src", SOURCE: "src", EMBED: "src", VIDEO: "src", AUDIO: "src", OBJECT: "data", A: "href" };
  const MARK = "/object/public/" + BUCKET + "/";
  const SEL = ["img[src", "iframe[src", "source[src", "embed[src", "video[src", "audio[src", "object[data", "a[href"]
    .map(s => s + '*="' + MARK + '"]').join(",");
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const PUB_RE = /https:\/\/mzyuzrxkdcpzxojenwat\.supabase\.co\/storage\/v1\/object\/public\/semis-logi-files\/([^\s"'<>?#\\]+)((?:\?[^\s"'<>#\\]*)?)/g;
  const SIGN_RE = /https:\/\/mzyuzrxkdcpzxojenwat\.supabase\.co\/storage\/v1\/object\/sign\/semis-logi-files\/([^\s"'<>?#\\]+)\?token=[A-Za-z0-9._-]+((?:&(?:amp;)?[^\s"'<>#\\]*)?)/g;
  const MARGIN = 5 * 60 * 1000;          // 만료 5분 전부터 재서명

  const cache = new Map();               // 경로 → { url, exp }
  const denied = new Set();
  let queue = new Set(), timer = null, waiters = [], mo = null, started = false, refreshTimer = null, warmTimer = null;

  const S = () => window.SemisSync;
  function dec(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }

  /* 표준 주소 → { path, extra } / 서명 주소 → { path, extra, signed:true } / 그 밖 → null */
  function parse(url) {
    const u = String(url || "");
    let rest = null, signed = false;
    if (u.indexOf(PUB) === 0) rest = u.slice(PUB.length);
    else if (u.indexOf(SIGN) === 0) { rest = u.slice(SIGN.length); signed = true; }
    if (rest === null) return null;
    const h = rest.indexOf("#");
    const hash = h >= 0 ? rest.slice(h) : "";               // #page=N 등 조각은 서명 뒤에도 유지
    if (h >= 0) rest = rest.slice(0, h);
    const q = rest.indexOf("?");
    const path = dec(q >= 0 ? rest.slice(0, q) : rest);
    let params = q >= 0 ? rest.slice(q + 1).split("&").filter(Boolean) : [];
    if (signed) params = params.filter(x => x.indexOf("token=") !== 0);
    if (!path) return null;
    return { path, extra: params.join("&"), signed, hash };
  }
  function fresh(path) {
    const c = cache.get(path);
    return c && c.exp - MARGIN > Date.now() ? c.url : null;
  }
  const withExtra = (signed, extra) => extra ? signed + (signed.indexOf("?") >= 0 ? "&" : "?") + extra : signed;
  const full = (signed, p) => withExtra(signed, p.extra) + (p.hash || "");

  /* 서명 요청 — 25ms 모아 일괄 */
  function request(paths) {
    const need = (paths || []).filter(p => p && !fresh(p) && !denied.has(p));
    if (!need.length) return Promise.resolve();
    need.forEach(p => queue.add(p));
    return new Promise(res => {
      waiters.push(res);
      if (!timer) timer = setTimeout(flush, 25);
    });
  }
  async function flush() {
    timer = null;
    const paths = Array.from(queue).slice(0, 200);
    paths.forEach(p => queue.delete(p));
    const done = waiters; waiters = [];
    if (paths.length && S() && S().signFiles) {
      try {
        const r = await S().signFiles(paths);
        const exp = Date.now() + (r.expires || 3600) * 1000;
        Object.keys(r.urls || {}).forEach(p => cache.set(p, { url: r.urls[p], exp }));
        (r.denied || []).forEach(p => denied.add(p));
      } catch (e) { /* 오프라인·세션 만료 — 원래 주소 유지 */ }
    }
    if (queue.size) { waiters = waiters.concat(done); timer = setTimeout(flush, 0); return; }
    done.forEach(fn => { try { fn(); } catch (e) {} });
  }
  async function resolve(url) {
    const p = parse(url);
    if (!p) return String(url || "");
    if (!fresh(p.path)) await request([p.path]);
    const hit = fresh(p.path);
    return hit ? full(hit, p) : String(url || "");
  }
  function resolveSync(url) {
    const p = parse(url);
    if (!p) return String(url || "");
    const hit = fresh(p.path);
    return hit ? full(hit, p) : null;
  }

  function fixEl(el) {
    if (!el || el.nodeType !== 1) return;
    const at = ATTR[el.tagName];
    if (!at) return;
    const v = el.getAttribute(at);
    if (!v || v.indexOf(PUB) !== 0) return;
    const p = parse(v);
    if (!p) return;
    el.setAttribute("data-sf", v);
    const hit = fresh(p.path);
    if (hit) { el.setAttribute(at, full(hit, p)); return; }
    if (el.tagName === "IMG") el.setAttribute("src", PIXEL);
    else if (el.tagName === "IFRAME" || el.tagName === "EMBED") el.setAttribute("src", "about:blank");
    request([p.path]).then(() => {
      if (el.getAttribute("data-sf") !== v) return;
      const h = fresh(p.path);
      if (h) el.setAttribute(at, full(h, p));
      else if (el.tagName === "IMG") el.setAttribute("alt", el.getAttribute("alt") || "파일을 불러올 수 없습니다");
    });
  }
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    fixEl(root);
    if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(fixEl);
  }

  /* 서명 전 링크 클릭 — 새 창을 먼저 연 뒤(팝업 차단 방지) 서명 주소로 보낸다 */
  function onClick(ev) {
    if (ev.defaultPrevented || !ev.target || !ev.target.closest) return;
    const a = ev.target.closest("a[href]");
    if (!a) return;
    const orig = a.getAttribute("data-sf") || a.getAttribute("href") || "";
    const p = parse(orig);
    if (!p || p.signed) return;
    const hit = fresh(p.path);
    if (hit) { a.setAttribute("href", full(hit, p)); return; }   // 기본 동작이 새 주소로 진행
    ev.preventDefault();
    let w = null;
    try { w = window.open("", a.getAttribute("target") || "_blank"); } catch (e) { w = null; }
    request([p.path]).then(() => {
      const h = fresh(p.path);
      if (h) {
        const to = full(h, p);
        if (w) { try { w.opener = null; w.location.href = to; } catch (e) { window.open(to, "_blank", "noopener"); } }
        else window.open(to, "_blank", "noopener");
      } else {
        if (w) { try { w.close(); } catch (e) {} }
        try { SeMIS.toast("파일을 열 수 없습니다 — 권한 또는 연결을 확인하세요.", true); } catch (e) {}
      }
    });
  }

  /* 저장 전 서명 URL → 표준 주소. signHtml: 인쇄용 iframe HTML 미리 서명 */
  function canon(html) {
    return String(html == null ? "" : html).replace(SIGN_RE, (m, path, rest) =>
      PUB + path + (rest ? "?" + rest.replace(/^&(amp;)?/, "") : ""));
  }
  /* DOM 조각 안의 변환 흔적(data-sf · 임시 그림)을 원래 주소로 */
  function canonNode(root) {
    if (!root || !root.querySelectorAll) return root;
    root.querySelectorAll("[data-sf]").forEach(el => {
      const at = ATTR[el.tagName];
      if (at) el.setAttribute(at, el.getAttribute("data-sf"));
      el.removeAttribute("data-sf");
    });
    return root;
  }
  async function signHtml(html) {
    const s = String(html == null ? "" : html);
    const paths = [];
    s.replace(PUB_RE, (m, path) => { paths.push(dec(path)); return m; });
    if (paths.length) await request(Array.from(new Set(paths)));
    return s.replace(PUB_RE, (m, path, q) => {
      const hit = fresh(dec(path));
      return hit ? withExtra(hit, String(q || "").replace(/^\?/, "").replace(/&amp;/g, "&")) : m;
    });
  }

  /* 데이터에 들어 있는 파일 주소를 미리 서명(화면에 나타날 때 바로 바꿔 끼우도록) */
  function warm() {
    if (warmTimer) return;
    warmTimer = setTimeout(() => {
      warmTimer = null;
      let json = "";
      try { json = JSON.stringify((window.SeMIS && SeMIS.data) || {}); } catch (e) { return; }
      const paths = new Set();
      json.replace(PUB_RE, (m, path) => { paths.add(dec(path)); return m; });
      const need = Array.from(paths).filter(p => !fresh(p) && !denied.has(p));
      for (let i = 0; i < need.length; i += 200) request(need.slice(i, i + 200));
    }, 50);
  }

  function start() {
    if (started || typeof document === "undefined") return;
    started = true;
    denied.clear();
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(muts => {
        muts.forEach(m => {
          if (m.type === "attributes") fixEl(m.target);
          else m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); });
        });
      });
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href", "data"] });
    }
    document.addEventListener("click", onClick);
    scan(document.body);
    warm();
    refreshTimer = setInterval(warm, 10 * 60 * 1000);
  }
  function stop() {
    if (mo) { mo.disconnect(); mo = null; }
    if (typeof document !== "undefined") document.removeEventListener("click", onClick);
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    cache.clear(); denied.clear(); queue.clear(); started = false;
  }

  window.SemisFileAuth = { start, stop, parse, resolve, resolveSync, request, canon, canonNode, signHtml, warm, scan,
    PUB, SIGN, get size() { return cache.size; }, _cache: cache };
})();
