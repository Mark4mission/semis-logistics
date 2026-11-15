/* K드라이브 새 폴더 → H:drive 화면 › 분류 추천. 화면 없이 계산만 하고(그리기는 js/ksync.js), 규칙이 못 맞춘 폴더만 아르고(Edge semis-logi-argo mode "kfolder")에 묻는다.
   path = 색인 뿌리 기준 경로('04 수검/새 폴더'), 연결의 k_path = 공유 뿌리 기준(색인 뿌리 이름이 앞에 붙음). 비교는 대소문자 무시(K 는 대소문자를 가리지 않음).
   추천은 사람이 보고 누르는 것이라 이유를 늘 한 줄로 단다. */
"use strict";

(() => {
  const W_EXACT = 10, W_SYN = 7;          // 폴더 이름 낱말이 분류 이름 · short · aka 에 — 그대로(조사 뗀 꼴 포함) · 동의어로만
  const W_MENU = 3;                       // 낱말이 화면(메뉴) 이름에만
  const W_UP = 2, W_UP_MENU = 1;          // 위 폴더 이름 낱말 — 약하게
  const W_PARENT = 5, W_TOP = 3;          // 이웃 화면 — 같은 위 폴더 · 같은 맨 위 폴더 아래 다른 연결이 쓰는 화면
  /* 폴더 이름 낱말이 분류에 하나라도 맞아야 넘는다 — 이웃 점수만으로는 넘지 못한다(한 업무 폴더 아래 아무 분류나 고르지 않게, 기타만 예외) */
  const PASS = W_SYN;
  const AI_MS = 10000, AI_MAX = 10;
  const NONE = "알맞은 분류가 없습니다 — 새 분류가 필요하면 코드 배포(개발 요청)";
  const NEAR = " · 같은 업무 폴더의 다른 연결이 이 화면";

  const low = (s) => String(s == null ? "" : s).toLowerCase();
  const segs = (p) => String(p || "").split("/");
  const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* 분류와 상관없는 꼬리표(끝 (SSI) · 건별 (MM.DD) · 앞 정렬 번호 '04 ' · 연도 20NN)를 떼고 낱말로 — 글자 그대로(이유에 보여 줌) */
  function words(name) {
    return String(name || "").replace(/\s*\(ssi\)\s*$/i, "").replace(/\(\d{1,2}\.\d{1,2}\)/g, " ").replace(/^\s*\d{2}\s+/, "")
      .replace(/(^|\D)20\d{2}(?!\d)/g, "$1 ").split(/[·,_\s]+/).filter(w => w.length >= 2);
  }
  const tokens = (name) => words(name).map(low);
  const ssiOf = (path) => segs(path).some(s => /\(ssi\)$/i.test(s.trim()));

  /* 검색의 동의어 · 조사 뗀 꼴 — search.js 가 이 파일보다 늦게 읽혀도 되게 부를 때 찾는다 */
  const altsOf = (w) => (window.SemisSearch && SemisSearch.altsOf ? SemisSearch.altsOf(w) : [{ s: w, b: false }]);
  /* 짧은 영문(aeo · ra …)은 다른 영문 낱말 속에서 맞지 않게 낱말 경계에서만 */
  const has = (hay, a) => (a.b || /^[a-z0-9-]{1,3}$/.test(a.s)
    ? new RegExp("(^|[^a-z0-9])" + reEsc(a.s) + "([^a-z0-9]|$)").test(hay) : hay.indexOf(a.s) >= 0);
  function hit(tok, hay) {
    let w = 0;
    altsOf(tok).forEach(a => { if (has(hay, a)) w = Math.max(w, tok.indexOf(a.s) === 0 ? W_EXACT : W_SYN); });
    return w;
  }

  /* 연결의 K 경로 → 색인 뿌리 기준. 뿌리 밖이면 null */
  function relOf(kp, root) {
    const k = String(kp || ""), r = String(root || "");
    if (!r) return k;
    return low(k).indexOf(low(r) + "/") === 0 ? k.slice(r.length + 1) : null;
  }
  const usedBy = (ctx, mod, grp) => (ctx.maps || []).find(m => m.mod === mod && m.grp === grp) || null;
  const list = (ctx) => [].concat(...(ctx.targets || []).map(t => (t.groups || []).map(g =>
    ({ key: t.mod + "|" + g.id, mod: t.mod, grp: g.id, label: t.label + " › " + g.label, t, g }))));

  /* 가장 많이 쓰는 기준일 — 같은 수면 늦은 날(덜 올림) */
  function mode(ms) {
    const n = new Map();
    ms.forEach(m => { const v = String(m.since || ""); n.set(v, (n.get(v) || 0) + 1); });
    let best = "", c = 0;
    n.forEach((k, v) => { if (k > c || (k === c && v > best)) { best = v; c = k; } });
    return best;
  }
  /* 함께 정하는 값 — 방향은 K → H 만, 기준일은 같은 맨 위 폴더 아래 연결 → 없으면 모든 연결 → 연결이 없으면 비움 */
  function common(path, ctx) {
    const top = low(segs(path)[0]), ms = ctx.maps || [];
    const near = ms.filter(m => { const r = relOf(m.k_path, ctx.root); return r != null && low(segs(r)[0]) === top; });
    return { ssi: ssiOf(path), dir: "k2h", since: mode(near.length ? near : ms) };
  }

  function score(path, ctx) {
    const ps = segs(path), up = ps.slice(0, -1);
    const own = [...new Set(words(ps[ps.length - 1]))], ups = [...new Set([].concat(...up.map(tokens)))];
    const top = low(ps[0]), parent = low(up.join("/"));
    const nb = {};
    (ctx.maps || []).forEach(m => {
      const r = relOf(m.k_path, ctx.root);
      if (r == null || low(segs(r)[0]) !== top) return;
      const w = low(segs(r).slice(0, -1).join("/")) === parent ? W_PARENT : W_TOP;
      nb[m.mod] = Math.max(nb[m.mod] || 0, w);
    });
    return list(ctx).map(c => {
      const hay = low([c.g.label, c.g.short, c.g.aka].join(" ")), menu = low(c.t.label);
      const x = Object.assign({ own: 0, sc: 0, words: [], nb: nb[c.mod] || 0 }, c);
      own.forEach(w0 => {
        const w = low(w0), h = hit(w, hay);
        if (h) { x.own += h; x.words.push(w0); } else if (hit(w, menu)) x.sc += W_MENU;
      });
      ups.forEach(w => { if (hit(w, hay)) x.sc += W_UP; else if (hit(w, menu)) x.sc += W_UP_MENU; });
      x.sc += x.own + x.nb;
      return x;
    });
  }
  const best = (cs) => cs.reduce((b, c) => (!b || c.sc > b.sc ? c : b), null);

  function result(path, ctx, c, why, by) {
    const base = common(path, ctx);
    if (!c) return Object.assign({ kind: "none" }, base, { reason: NONE, by });
    const r = { kind: "link", mod: c.mod, grp: c.grp, label: c.label }, m = usedBy(ctx, c.mod, c.grp);
    if (m) {
      const moved = (ctx.gone || []).indexOf(m.id) >= 0;
      r.kind = moved ? "moved" : "taken";
      r.map = { id: m.id, k_path: m.k_path };
      why += " — " + (moved ? "연결 '" + m.k_path + "'의 폴더 이름이 바뀐 것 같습니다. 그 연결을 지우고 이 폴더로 다시 연결하거나 K 이름을 되돌리세요"
        : "이 분류는 '" + m.k_path + "' 폴더에 연결돼 있습니다. 이 폴더를 그 안으로 옮기면 저절로 올라갑니다(K 에서 직접)");
    }
    return Object.assign(r, base, { reason: why, by });
  }

  /* 규칙만 — 문턱을 넘는 후보가 없으면 none(화면이 AI 에 묻는다) */
  function recommend(path, ctx) {
    const cs = score(path, ctx);
    const c = best(cs.filter(x => x.own >= PASS));
    if (c) return result(path, ctx, c, "이름 '" + c.words.join(", ") + "' ↔ 분류 '" + c.g.label + "'" + (c.nb ? NEAR : ""), "rule");
    /* 기타는 이름이 맞지 않아도 이웃 화면이면 후보 — 이름이 맞는 후보가 하나라도 있으면 그쪽 */
    const m = best(cs.filter(x => x.grp === "misc" && x.nb > 0));
    return m ? result(path, ctx, m, "이름이 맞는 분류가 없음" + NEAR, "rule") : result(path, ctx, null, "", "rule");
  }

  /* AI 로 보낼 후보 — Edge 가 null 을 거절하므로 없는 aka · taken 은 키째 빼고, Edge 길이 제한으로 자른다 */
  function cats(ctx) {
    return list(ctx).map(c => {
      const o = { key: c.key, label: cut(c.label, 120) }, m = usedBy(ctx, c.mod, c.grp);
      if (c.g.aka) o.aka = cut(String(c.g.aka), 200);
      if (m) o.taken = cut(segs(m.k_path).slice(-2).join("/"), 200);
      return o;
    });
  }

  /* 한 번에 앞 10개 — 실패 · 10초 넘김이면 빈 결과(던지지 않음, 화면은 '알맞은 분류가 없습니다'로) */
  async function ask(paths, cs) {
    const A = window.SemisSync && SemisSync.auth, url = window.SemisSync && SemisSync.FN_ARGO;
    const tok = A && A.token ? A.token() : "", ps = (paths || []).slice(0, AI_MAX);
    if (!tok || !url || !ps.length || !(cs && cs.length) || typeof fetch === "undefined") return {};
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    let tm = null;
    const late = new Promise(r => { tm = setTimeout(() => { if (ac) ac.abort(); r(null); }, AI_MS); });
    const call = fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-semis-token": tok },
      body: JSON.stringify({ mode: "kfolder", items: ps.map(path => ({ path })), cats: cs }), signal: ac ? ac.signal : undefined })
      .then(res => (res.ok ? res.json() : null)).catch(() => null);
    const d = await Promise.race([call, late]);
    clearTimeout(tm);
    const out = {};
    if (d && d.ok === true && Array.isArray(d.picks)) d.picks.forEach(p => {
      if (p && typeof p.path === "string") out[p.path] = { key: typeof p.key === "string" ? p.key : null, reason: String(p.reason || "") };
    });
    return out;
  }

  /* AI 결과를 다시 검사 — 지금 후보에 있는 키만, 비었는지는 규칙과 같게 */
  function applyAI(path, pick, ctx) {
    const c = pick && typeof pick.key === "string" ? list(ctx).find(x => x.key === pick.key) : null;
    return c ? result(path, ctx, c, "AI 추천: " + String(pick.reason || ""), "ai") : result(path, ctx, null, "", "ai");
  }

  window.SemisKfolder = { tokens, ssiOf, recommend, cats, ask, applyAI };
})();
