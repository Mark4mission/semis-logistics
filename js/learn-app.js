/* 교육 이수 화면(learn.html#코드) — 로그인 없는 공개 화면. ① 교육 안내 · 이름 확인 ② 교육 내용(끝까지 읽기 · 동영상 끝까지) ③ 서명 · 제출.
   보안: 코드 확인(semis_logi_learn_info) 뒤 작업증명 표(semis_logi_challenge → semis_logi_learn_ticket, 3시간)로만 이름 찾기 · 시작 · 제출.
   이름 찾기는 띄어쓰기를 뺀 이름이 같은 사람만 돌려준다. 최소 학습 시간은 서버가 처음 시작 시각부터 다시 잰다.
   자료 파일은 Edge semis-logi-learn(op media)이 시작 기록을 확인한 뒤 서명 URL. 작성 중 내용은 이 탭(sessionStorage)에만 */
"use strict";

(function () {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  // anon(publishable) 공개 키(sync.js 와 같은 값) — 이 화면은 공개 RPC · 학습 함수만 부른다
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const RPC = SUPA_URL + "/rest/v1/rpc/";
  const FN = SUPA_URL + "/functions/v1/semis-logi-learn";
  const DRAFT = "semisl:learn:";
  const SELF_ORG = "에어제타";

  const MD = () => window.SemisLearnMd;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const nameKey = (s) => String(s == null ? "" : s).replace(/\s+/g, "");
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const span = (a, b) => (a && b && a !== b ? dot(a) + " ~ " + dot(b).slice(5) : dot(a || b));
  const uid = () => {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 아래로 */ }
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  };
  const ICO = {
    check: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
  };

  /* ── 상태 ── */
  const st = {
    view: "load", code: "", info: null, err: "", errInfo: null,
    ticket: "", ticketExp: 0, ticketBusy: null,
    q: "", list: null, findMsg: "", pick: null, manual: null,
    rid: "", body: "", items: [], minSec: 0, elapsed0: 0, t0: 0, person: null,
    media: {}, mediaErr: "", seen: false, vids: {}, sid: "", ink: 0, msg: "", done: null, sign: "", cert: ""
  };
  let now = () => Date.now();

  /* ── 서버 ── */
  const hdr = () => ({ apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" });
  async function rpc(name, body) {
    const res = await fetch(RPC + name, { method: "POST", headers: hdr(), body: JSON.stringify(body || {}) });
    if (!res.ok) { const e = new Error("http " + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  async function ensureTicket(force) {
    if (!force && st.ticket && st.ticketExp * 1000 - now() > 10 * 60000) return st.ticket;
    if (st.ticketBusy) return st.ticketBusy;
    st.ticketBusy = (async () => {
      let d = null;
      for (let i = 0; i < 2; i++) {
        const ch = await rpc("semis_logi_challenge", {});
        if (!ch || !ch.ok || !ch.c) throw new Error("challenge");
        const x = await window.SemisPow.solve(String(ch.c), Number(ch.d) || 18);
        d = await rpc("semis_logi_learn_ticket", { p_k: st.code, p_pow: { c: String(ch.c), x: String(x) } });
        if (!(d && /^pow/.test(String(d.error || "")))) break;
      }
      if (!d || !d.ok || !d.ticket) { const e = new Error(String((d && d.error) || "ticket")); e.code = d && d.error; e.d = d; throw e; }
      st.ticket = String(d.ticket); st.ticketExp = Number(d.exp) || Math.floor(now() / 1000) + 3 * 3600;
      return st.ticket;
    })();
    try { return await st.ticketBusy; } finally { st.ticketBusy = null; }
  }
  function warm() { if (!st.ticket && !st.ticketBusy) ensureTicket().catch(() => { /* 찾기 때 다시 */ }); }

  /* ── 작성 중 내용(이 탭) ── */
  function saveDraft() {
    try { sessionStorage.setItem(DRAFT + st.code, JSON.stringify({ q: st.q, pick: st.pick, manual: st.manual, sid: st.sid })); } catch (e) { /* 저장소 없음 */ }
  }
  function loadDraft() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT + st.code) || "null"); } catch (e) { d = null; }
    if (!d || typeof d !== "object") return;
    st.q = norm(d.q).slice(0, 20);
    if (d.pick && typeof d.pick === "object" && /^[A-Za-z0-9_-]{1,40}$/.test(String(d.pick.pid || ""))) st.pick = d.pick;
    if (d.manual && typeof d.manual === "object") st.manual = { name: norm(d.manual.name).slice(0, 20), org: norm(d.manual.org).slice(0, 30), orgx: norm(d.manual.orgx).slice(0, 30), part: norm(d.manual.part).slice(0, 30), emp: norm(d.manual.emp).slice(0, 12) };
    if (/^[A-Za-z0-9-]{8,64}$/.test(String(d.sid || ""))) st.sid = d.sid;
  }
  function dropDraft() { try { sessionStorage.removeItem(DRAFT + st.code); } catch (e) { /* 저장소 없음 */ } }

  /* ── 공통 그리기 ── */
  const app = () => $("#ln-app");
  function busy(on, text) {
    const b = $("#ln-busy");
    if (!b) return;
    b.classList.toggle("hidden", !on);
    if (text) $("#ln-busy-t").textContent = text;
  }
  function stepsHTML(n) {
    const lb = ["본인 확인", "교육 내용", "서명"];
    return `<nav class="ln-steps" aria-label="진행 단계">${lb.map((t, i) => `${i ? '<span class="ln-step-line" aria-hidden="true"></span>' : ""}<span class="ln-step${i + 1 === n ? " on" : (i + 1 < n ? " ok" : "")}"${i + 1 === n ? ' aria-current="step"' : ""}><i>${i + 1}</i><span>${lb[i]}</span></span>`).join("")}</nav>`;
  }
  function heroHTML(full) {
    const f = st.info || {};
    const minTxt = f.minSec >= 60 ? "약 " + Math.round(f.minSec / 60) + "분" : (f.minSec > 0 ? "약 1분" : "");
    return `<section class="ln-hero">
      <div class="ln-kicker">${f.kind ? `<span class="ln-chip kind-${esc(f.kind)}">${esc(f.kind)} 교육</span>` : ""}<span class="mono">${esc(span(f.start, f.end))}</span></div>
      <h1>${esc(f.title || "교육")}</h1>
      ${full && f.overview ? `<p class="ln-ov">${esc(f.overview)}</p>` : ""}
      ${full ? `<dl class="ln-meta">${f.host ? `<dt>교육 주관</dt><dd>${esc(f.host)}</dd>` : ""}${f.place ? `<dt>장소</dt><dd>${esc(f.place)}</dd>` : ""}${minTxt ? `<dt>학습 시간</dt><dd>${minTxt}</dd>` : ""}</dl>` : ""}
    </section>`;
  }
  const ERR = {
    invalid: ["교육 주소를 확인할 수 없습니다", "받은 주소나 QR 코드가 맞는지 확인해 주세요."],
    closed: ["지금은 열려 있지 않은 교육입니다", "교육 담당 부서에 문의해 주세요."],
    before: ["교육 기간 전입니다", (i) => dot(i.start) + "부터 들을 수 있습니다."],
    after: ["교육 기간이 끝났습니다", (i) => dot(i.end) + "까지였습니다. 교육 담당 부서에 문의해 주세요."],
    limit: ["잠시 후 다시 시도해 주세요", (i) => "요청이 많습니다. " + (i.wait || 10) + "분 뒤에 다시 열어 주세요."],
    network: ["연결할 수 없습니다", "인터넷 연결을 확인한 뒤 새로 고침해 주세요."]
  };
  function errHTML() {
    const e = ERR[st.err] || ERR.network, i = st.errInfo || {};
    return `<section class="ln-card ln-err">${i.title ? `<p class="ln-msg info">${esc(i.title)}</p>` : ""}<h1>${esc(e[0])}</h1><p>${esc(typeof e[1] === "function" ? e[1](i) : e[1])}</p></section>`;
  }
  function fail(code, info) {
    st.view = "err"; st.err = ERR[code] ? code : "network"; st.errInfo = info || null;
    render();
  }

  /* ── ① 본인 확인 ── */
  const isSelf = (o) => o === SELF_ORG;
  function manualOk() {
    const m = st.manual;
    if (!m) return false;
    const org = m.org === "__x" ? norm(m.orgx) : m.org;
    if (nameKey(m.name).length < 2 || !org) return false;
    if (isSelf(org) && !/^[0-9A-Za-z-]{3,12}$/.test(nameKey(m.emp))) return false;
    return true;
  }
  const canNext1 = () => !!((st.pick && !st.pick.done) || (!st.pick && manualOk()));
  function pickHTML(p) {
    const sel = st.pick && st.pick.pid === p.pid;
    const note = p.done ? `<span class="ln-note ok">이미 이수했습니다 · <span class="mono">${esc(p.done)}</span></span>`
      : (!p.tgt ? `<span class="ln-note">이번 교육 대상 명단에는 없습니다. 본인이 맞으면 그대로 진행하세요.</span>` : "");
    return `<button type="button" class="ln-pick" data-pid="${esc(p.pid)}" aria-pressed="${sel}" ${p.done ? "disabled" : ""}>
      <b>${esc(p.name)}</b>
      <span class="ln-org">${esc([p.org, p.part, p.title].filter(Boolean).join(" · "))}</span>
      <span class="ln-emp">${p.emp ? `사번<span class="mono">${esc(p.emp)}</span>` : ""}</span>
      ${note}</button>`;
  }
  function manualHTML() {
    const m = st.manual || {}, f = st.info || {};
    const orgs = (f.orgs || []).filter(Boolean);
    const org = m.org === "__x" ? norm(m.orgx) : m.org;
    return `<div class="ln-manual" id="ln-manual">
      <p class="ln-msg info">명단에 없으면 소속을 고르고 이름을 적어 주세요.</p>
      <div class="ln-f"><label class="ln-l" for="ln-m-org">소속</label>
        <select id="ln-m-org"><option value="">선택</option>${orgs.map(o => `<option ${m.org === o ? "selected" : ""}>${esc(o)}</option>`).join("")}<option value="__x" ${m.org === "__x" ? "selected" : ""}>기타(직접 입력)</option></select></div>
      ${m.org === "__x" ? `<div class="ln-f"><label class="ln-l" for="ln-m-orgx">소속 이름</label><input id="ln-m-orgx" maxlength="30" autocomplete="organization" value="${esc(m.orgx || "")}"></div>` : ""}
      ${isSelf(org) ? `<div class="ln-f"><label class="ln-l" for="ln-m-part">파트</label><select id="ln-m-part"><option value="">선택</option>${(f.parts || []).map(p => `<option ${m.part === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></div>
        <div class="ln-f"><label class="ln-l" for="ln-m-emp">사번</label><input id="ln-m-emp" inputmode="numeric" maxlength="12" autocomplete="off" value="${esc(m.emp || "")}"></div>` : ""}
      <div class="ln-f"><label class="ln-l" for="ln-m-name">이름</label><input id="ln-m-name" maxlength="20" autocomplete="name" value="${esc(m.name || "")}"></div>
    </div>`;
  }
  function p1HTML() {
    const L = st.list;
    return stepsHTML(1) + heroHTML(true) + `<section class="ln-card">
      <h2>본인 확인</h2>
      <div class="ln-f"><label class="ln-l" for="ln-name">이름</label>
        <div class="ln-row"><input id="ln-name" maxlength="20" autocomplete="name" enterkeyhint="search" value="${esc(st.q)}"><button type="button" class="ln-btn" id="ln-find">확인</button></div></div>
      <div id="ln-found">${st.findMsg ? `<p class="ln-msg">${esc(st.findMsg)}</p>` : ""}
        ${L && L.length ? `<div class="ln-res" role="group" aria-label="찾은 사람">${L.map(pickHTML).join("")}</div>` : ""}
        ${L && L.length === 0 ? `<p class="ln-msg">명단에서 찾지 못했습니다.</p>` : ""}
        ${st.manual ? manualHTML() : (L ? `<button type="button" class="ln-link" id="ln-manual-go">명단에 없나요? 직접 입력</button>` : "")}</div>
    </section>
    <button type="button" class="ln-btn pri wide" id="ln-next1" ${canNext1() ? "" : "disabled"}>다음</button>`;
  }
  async function find() {
    const v = norm($("#ln-name") ? $("#ln-name").value : st.q).slice(0, 20);
    st.q = v; st.findMsg = ""; st.pick = null;
    if (nameKey(v).length < 2) { st.findMsg = "이름을 두 글자 이상 적어 주세요."; st.list = null; render(); return; }
    busy(true, "확인하는 중");
    try {
      let d = null;
      for (let i = 0; i < 2; i++) {
        const tk = await ensureTicket(i > 0);
        d = await rpc("semis_logi_learn_find", { p_k: st.code, p_ticket: tk, p_name: v });
        if (!(d && d.error === "ticket")) break;
      }
      if (!d || !d.ok) {
        if (d && ERR[d.error] && d.error !== "invalid") { busy(false); fail(d.error, d); return; }
        st.findMsg = d && d.error === "name" ? "이름을 다시 확인해 주세요." : "확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        st.list = null;
      } else {
        st.list = (d.list || []).slice(0, 10);
        const cand = st.list.filter(p => !p.done);
        if (cand.length === 1 && cand[0].tgt && st.list.length === 1) st.pick = cand[0];
        if (!st.list.length) st.manual = Object.assign({ org: "", orgx: "", part: "", emp: "" }, st.manual || {}, { name: v });
        else st.manual = null;
      }
    } catch (e) {
      st.findMsg = e && e.code && ERR[e.code] ? ERR[e.code][0] : "연결할 수 없습니다. 인터넷 연결을 확인해 주세요.";
    } finally { busy(false); }
    saveDraft();
    render();
    const pk = $(".ln-pick[aria-pressed=true]") || $(".ln-pick:not(:disabled)") || $("#ln-m-org");
    if (pk && pk.focus) pk.focus();
  }
  function wireP1() {
    const inp = $("#ln-name");
    if (inp) {
      inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); find(); } });
      inp.addEventListener("focus", warm, { once: true });
    }
    const fb = $("#ln-find"); if (fb) fb.onclick = find;
    $$(".ln-pick").forEach(b => { b.onclick = () => {
      const p = (st.list || []).find(x => x.pid === b.dataset.pid);
      if (!p || p.done) return;
      st.pick = p; st.manual = null; saveDraft(); render();
    }; });
    const mg = $("#ln-manual-go");
    if (mg) mg.onclick = () => { st.pick = null; st.manual = { name: st.q, org: "", orgx: "", part: "", emp: "" }; render(); const s = $("#ln-m-org"); if (s) s.focus(); };
    const upd = (k, re) => (ev) => { st.manual[k] = ev.target.value; if (re) render(); else { const n = $("#ln-next1"); if (n) n.disabled = !canNext1(); } saveDraft(); };
    if ($("#ln-m-org")) $("#ln-m-org").onchange = upd("org", true);
    if ($("#ln-m-orgx")) $("#ln-m-orgx").oninput = upd("orgx");
    if ($("#ln-m-part")) $("#ln-m-part").onchange = upd("part");
    if ($("#ln-m-emp")) $("#ln-m-emp").oninput = upd("emp");
    if ($("#ln-m-name")) $("#ln-m-name").oninput = upd("name");
    const nx = $("#ln-next1"); if (nx) nx.onclick = start;
  }
  async function start() {
    if (!canNext1()) return;
    const m = st.manual, org = m ? (m.org === "__x" ? norm(m.orgx) : m.org) : "";
    const p = st.pick ? { pid: st.pick.pid } : { name: norm(m.name), org, part: isSelf(org) ? norm(m.part) : "", emp: isSelf(org) ? nameKey(m.emp) : "" };
    busy(true, "교육을 여는 중");
    try {
      let d = null;
      for (let i = 0; i < 2; i++) {
        const tk = await ensureTicket(i > 0);
        d = await rpc("semis_logi_learn_start", { p_k: st.code, p_ticket: tk, p });
        if (!(d && d.error === "ticket")) break;
      }
      busy(false);
      if (!d || !d.ok) {
        if (d && ERR[d.error] && d.error !== "invalid") { fail(d.error, d); return; }
        st.findMsg = { emp: "사번을 확인해 주세요.", emp_name: "사번과 이름이 명단과 다릅니다. 다시 확인해 주세요.", name: "이름을 확인해 주세요.", org: "소속을 골라 주세요.", person: "명단에서 찾지 못했습니다. 다시 확인해 주세요." }[d && d.error] || "시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        render(); return;
      }
      st.person = d.person || {};
      if (d.done) { st.done = { at: d.done, name: st.person.name, again: true }; st.view = "done"; dropDraft(); render(); return; }
      st.rid = String(d.rid || ""); st.body = String(d.body || ""); st.items = Array.isArray(d.items) ? d.items : [];
      st.minSec = Number(d.minSec) || 0; st.elapsed0 = Number(d.elapsed) || 0; st.t0 = now();
      st.seen = false; st.vids = {}; st.media = {}; st.mediaErr = "";
      st.items.forEach(it => { if (it.type === "video") st.vids[it.i] = { max: 0, done: false }; });
      st.view = "p2";
      saveDraft();
      render();
      try { window.scrollTo(0, 0); } catch (e) { /* 없음 */ }
      loadMedia();
    } catch (e) {
      busy(false);
      st.findMsg = "연결할 수 없습니다. 인터넷 연결을 확인해 주세요.";
      render();
    }
  }

  /* ── ② 교육 내용 ── */
  const FAST = 1.2;
  const need = () => Math.ceil(st.minSec * 0.9);
  const elapsed = () => st.elapsed0 + Math.max(0, (now() - st.t0) / 1000);
  const left = () => Math.max(0, Math.ceil(need() - elapsed()));
  const vidsLeft = () => Object.keys(st.vids).filter(k => !st.vids[k].done).length;
  const complete = () => st.seen && !vidsLeft() && left() === 0;
  async function loadMedia() {
    if (!st.items.some(it => it.type === "image" || it.type === "video" || it.type === "doc")) return;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "media", k: st.code, ticket: st.ticket, rid: st.rid }) });
        let d = null;
        try { d = await res.json(); } catch (e) { d = null; }
        if (d && d.ok) {
          (d.urls || []).forEach(u => { st.media[u.i] = u.url; });
          paintMedia();
          return;
        }
        if (i === 0 && d && (d.error === "ticket" || d.error === "start")) { await ensureTicket(true); await restart(); continue; }
        st.mediaErr = "자료를 불러오지 못했습니다. 새로 고침해 주세요.";
      } catch (e) { st.mediaErr = "자료를 불러오지 못했습니다. 새로 고침해 주세요."; }
      break;
    }
    paintMedia();
  }
  /* 표가 바뀌면 같은 기록으로 다시 시작(서버가 처음 시작 시각을 지킨다) */
  async function restart() {
    const p = st.pick ? { pid: st.pick.pid } : (() => { const m = st.manual, org = m.org === "__x" ? norm(m.orgx) : m.org; return { name: norm(m.name), org, part: isSelf(org) ? norm(m.part) : "", emp: isSelf(org) ? nameKey(m.emp) : "" }; })();
    const d = await rpc("semis_logi_learn_start", { p_k: st.code, p_ticket: st.ticket, p });
    if (d && d.ok && d.rid) { st.rid = d.rid; st.elapsed0 = Number(d.elapsed) || st.elapsed0; st.t0 = now(); return true; }
    return false;
  }
  function itemHTML(it) {
    const nm = esc(it.name || "");
    if (it.type === "image") return `<figure class="img"><img data-mi="${it.i}" alt="${nm}"></figure>`;
    if (it.type === "video") {
      const v = st.vids[it.i] || {};
      return `<figure class="vid"><video data-mi="${it.i}" controls playsinline preload="metadata" controlsList="nodownload noplaybackrate" disablepictureinpicture aria-label="교육 동영상"></video>
        <figcaption><button type="button" class="ln-spd" data-spd="${it.i}" aria-pressed="false">1.2배 빠르게</button><span class="ln-vst${v.done ? " ok" : ""}" data-vst="${it.i}">${v.done ? "시청 완료" : "끝까지 시청해 주세요"}</span></figcaption></figure>`;
    }
    return `<div class="ln-file"><span>원문</span><span>${nm}</span><a data-mi="${it.i}" target="_blank" rel="noopener" hidden>열기</a></div>`;
  }
  function p2HTML() {
    return stepsHTML(2) + heroHTML(false) + `<section class="ln-card">
      <h2>교육 내용</h2>
      <div class="ln-body">${MD() ? MD().html(st.body) : esc(st.body)}</div>
      ${st.items.length ? `<div class="ln-media">${st.items.map(itemHTML).join("")}</div>` : ""}
      <p class="ln-msg" id="ln-media-err"${st.mediaErr ? "" : " hidden"}>${esc(st.mediaErr)}</p>
      <div class="ln-end" id="ln-end"></div>
    </section>
    <div class="ln-foot" id="ln-foot"><div class="ln-foot-in"><div class="ln-foot-t" id="ln-foot-t"></div>
      <button type="button" class="ln-btn pri" id="ln-next2" hidden>다음</button></div></div>`;
  }
  function paintMedia() {
    $$("[data-mi]").forEach(el => {
      const u = st.media[el.dataset.mi];
      if (!u) return;
      if (el.tagName === "A") { el.href = u; el.hidden = false; }
      else if (el.getAttribute("src") !== u) el.setAttribute("src", u);
    });
    const me = $("#ln-media-err");
    if (me) { me.textContent = st.mediaErr; me.hidden = !st.mediaErr; }
  }
  function foot() {
    const t = $("#ln-foot-t"), nx = $("#ln-next2"), box = $("#ln-foot");
    if (!t || !nx) return;
    /* 동영상 교육은 시청이 끝나면 '다음'만 보인다(시간 막대 없음). 글 · 사진 교육은 남은 일 + 시간 막대 */
    const hasVid = Object.keys(st.vids).length > 0, vl = vidsLeft(), l = left();
    const todo = [];
    if (!hasVid && !st.seen) todo.push("끝까지 읽어 주세요");
    if (hasVid && !vl && !st.seen) todo.push("아래 끝까지 내려 주세요");
    if (!todo.length && !vl && l) todo.push(l + "초 뒤에 다음으로 넘어갈 수 있습니다");
    const pct = need() ? Math.min(100, Math.round(elapsed() / need() * 100)) : 100;
    t.innerHTML = complete() ? "<b>교육 내용을 모두 확인했습니다.</b>" : esc(todo.join(" · ")) + (hasVid ? "" : '<div class="ln-bar" aria-hidden="true"><i></i></div>');
    const bi = t.querySelector(".ln-bar i");   // CSP: 인라인 style 속성 대신 CSSOM
    if (bi) bi.style.width = pct + "%";
    nx.hidden = !complete();
    if (box) box.hidden = hasVid && !complete() && !todo.length;
  }
  let ticker = null, io = null;
  function checkEnd() {
    const e = $("#ln-end");
    if (!e || st.seen) return;
    const r = e.getBoundingClientRect();
    const h = window.innerHeight || document.documentElement.clientHeight || 0;
    if (h && r.top <= h + 4) { st.seen = true; foot(); }
  }
  function wireVideo(v) {
    const i = v.dataset.mi, s = st.vids[i] || (st.vids[i] = { max: 0, done: false });
    v.addEventListener("timeupdate", () => { if (!v.seeking && v.currentTime > s.max && v.currentTime - s.max < 2.5) s.max = v.currentTime; });
    v.addEventListener("seeking", () => { if (!s.done && v.currentTime > s.max + 1) v.currentTime = s.max; });
    /* 빠르게 보기는 1.2배까지만 */
    const spd = $(`[data-spd="${i}"]`);
    const paintSpd = () => { if (spd) { const on = v.playbackRate > 1.01; spd.setAttribute("aria-pressed", on ? "true" : "false"); spd.textContent = on ? "1.2배 보는 중" : "1.2배 빠르게"; } };
    v.addEventListener("ratechange", () => { if (!s.done && v.playbackRate > FAST + 0.01) v.playbackRate = FAST; paintSpd(); });
    if (spd) spd.onclick = () => { try { v.playbackRate = v.playbackRate > 1.01 ? 1 : FAST; } catch (e) { /* 없음 */ } paintSpd(); };
    /* 화면을 내려도 크기가 바뀌지 않게 — 영상 비율을 받아 자리를 고정(CSP: CSSOM) */
    v.addEventListener("loadedmetadata", () => { if (v.videoWidth && v.videoHeight) v.style.aspectRatio = v.videoWidth + " / " + v.videoHeight; });
    v.addEventListener("ended", () => {
      const dur = Number(v.duration) || 0;
      if (s.done || (dur && s.max < dur - 3)) return;
      s.done = true;
      const lb = $(`[data-vst="${i}"]`);
      if (lb) { lb.textContent = "시청 완료"; lb.classList.add("ok"); }
      foot();
    });
  }
  function wireP2() {
    $$("video[data-mi]").forEach(wireVideo);
    const end = $("#ln-end");
    if (end && typeof window.IntersectionObserver === "function") {
      io = new IntersectionObserver((es) => { if (es.some(x => x.isIntersecting)) { st.seen = true; foot(); } });
      io.observe(end);
    }
    window.addEventListener("scroll", checkEnd, { passive: true });
    setTimeout(checkEnd, 300);
    $("#ln-next2").onclick = () => { if (!complete()) return; st.view = "p3"; render(); try { window.scrollTo(0, 0); } catch (e) { /* 없음 */ } };
    paintMedia();
    foot();
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => { if (st.view !== "p2") { clearInterval(ticker); ticker = null; return; } foot(); }, 1000);
  }

  /* ── ③ 서명 ── */
  let pad = null;
  function p3HTML() {
    const p = st.person || {};
    /* 서명란이 화면 가운데 바로 보이게 — 위쪽은 이름 한 줄만 */
    return stepsHTML(3) + `<section class="ln-card ln-sign">
      <h2>서명</h2>
      <p class="ln-who1"><b>${esc(p.name || "")}</b><span>${esc([p.org, p.part].filter(Boolean).join(" · "))}</span>${p.emp ? `<span class="mono">${esc(p.emp)}</span>` : ""}</p>
      <div class="ln-pad${st.ink ? " inked" : ""}" id="ln-pad"><canvas id="ln-canvas" aria-label="서명란"></canvas><span class="ln-pad-ph">여기에 서명해 주세요</span></div>
      <div class="ln-pad-acts"><button type="button" class="ln-link" id="ln-back">교육 내용 다시 보기</button><button type="button" class="ln-link" id="ln-clear">지우기</button></div>
      <p class="ln-agree">교육 내용을 확인하였으며, 업무에서 지키겠습니다.</p>
      <p class="ln-msg" id="ln-msg"${st.msg ? "" : " hidden"}>${esc(st.msg)}</p>
      <button type="button" class="ln-btn pri wide" id="ln-submit" ${st.ink >= 8 ? "" : "disabled"}>제출</button>
    </section>`;
  }
  function wireP3() {
    const cv = $("#ln-canvas"), box = $("#ln-pad");
    st.ink = 0;
    const ctx = cv && cv.getContext ? cv.getContext("2d") : null;
    const fit = () => {
      if (!ctx) return;
      const r = cv.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.6; ctx.strokeStyle = "#111827";
    };
    fit();
    let down = false, last = null;
    const pt = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const mark = () => {
      st.ink++;
      if (box) box.classList.add("inked");
      const sb = $("#ln-submit"); if (sb) sb.disabled = st.ink < 8;
    };
    cv.addEventListener("pointerdown", (ev) => { down = true; last = pt(ev); try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* 없음 */ } if (ctx) { ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = "#111827"; ctx.fill(); } mark(); ev.preventDefault(); });
    cv.addEventListener("pointermove", (ev) => {
      if (!down) return;
      const p = pt(ev);
      if (ctx) { ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
      last = p; mark(); ev.preventDefault();
    });
    const up = () => { down = false; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up); cv.addEventListener("pointerleave", up);
    pad = { cv, ctx };
    $("#ln-clear").onclick = () => { if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); st.ink = 0; if (box) box.classList.remove("inked"); $("#ln-submit").disabled = true; };
    $("#ln-back").onclick = () => { st.view = "p2"; render(); };
    $("#ln-submit").onclick = submit;
  }
  /* 서명 그림 — 가로 480px PNG(투명 바탕)로 줄여 보낸다 */
  function exportSign() {
    if (!pad || !pad.ctx) return "";
    const W = 480, H = Math.max(120, Math.round(pad.cv.height * W / Math.max(1, pad.cv.width)));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.drawImage(pad.cv, 0, 0, W, H);
    return c.toDataURL("image/png");
  }
  async function submit() {
    if (st.ink < 8) return;
    const sign = api.exportSign();
    if (!/^data:image\/png;base64,/.test(sign)) { st.msg = "서명을 저장하지 못했습니다. 다시 서명해 주세요."; showMsg(); return; }
    if (!st.sid) st.sid = uid();
    saveDraft();
    busy(true, "제출하는 중");
    try {
      let d = null;
      for (let i = 0; i < 2; i++) {
        d = await rpc("semis_logi_learn_submit", { p_k: st.code, p_ticket: st.ticket, p: { rid: st.rid, sign, sid: st.sid, secs: Math.round(elapsed()) } });
        if (!(d && (d.error === "ticket" || d.error === "start") && i === 0)) break;
        await ensureTicket(true);
        if (!(await restart())) break;
      }
      busy(false);
      if (d && d.ok) {
        st.done = { at: d.at, name: d.name || (st.person && st.person.name) };
        st.sign = sign; st.cert = "";
        st.view = "done"; dropDraft(); render();
        try { window.scrollTo(0, 0); } catch (e) { /* 없음 */ }
        return;
      }
      if (d && ERR[d.error] && d.error !== "invalid") { fail(d.error, d); return; }
      st.msg = d && d.error === "too_fast" ? "교육 내용을 확인하는 시간이 부족합니다. " + (d.wait || 10) + "초 뒤에 다시 제출해 주세요."
        : d && d.error === "done" ? "이미 이수했습니다(" + (d.at || "") + ")."
        : d && d.error === "sign" ? "서명을 다시 해 주세요."
        : "제출하지 못했습니다. 잠시 후 다시 눌러 주세요.";
    } catch (e) {
      busy(false);
      st.msg = "연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.";
    }
    showMsg();
  }
  function showMsg() { const m = $("#ln-msg"); if (m) { m.textContent = st.msg; m.hidden = !st.msg; } }

  /* ── 완료 ── */
  function doneHTML() {
    const d = st.done || {};
    return heroHTML(false) + `<section class="ln-card ln-done">
      <div class="ln-done-ico">${ICO.check}</div>
      <h1>${d.again ? "이미 이수하셨습니다." : "수고하셨습니다."}</h1>
      <p>${esc(d.name || "")}님의 교육 이수${d.again ? "가 확인됩니다" : "가 접수되었습니다"}.</p>
      <p class="mono">${esc(d.at || "")}</p>
      ${!d.again && st.sign ? `<div class="ln-cert" id="ln-cert" hidden><img id="ln-cert-img" alt="교육 이수증">
        <button type="button" class="ln-btn pri wide" id="ln-save">이수증 사진 저장</button>
        <p class="ln-msg info" id="ln-save-msg" hidden></p></div>` : ""}
    </section>`;
  }
  /* ── 교육 이수증(서명 포함) 카드 그림 — 사진첩에 저장 ── */
  const LG_A = [[0.846, 0.151], [0.613, 0.151], [0.109, 0.551], [0.372, 0.551], [0.372, 0.389], [0.65, 0.389]];
  const LG_B = [[0.861, 0.418], [0.673, 0.418], [0.673, 0.632], [0.395, 0.632], [0.126, 0.879], [0.524, 0.879]];
  function drawLogo(x, ox, oy, h) {   // 회사 로고(글자 + 표지) — 높이 h
    const k = h / 30;
    x.save(); x.translate(ox, oy); x.scale(k, k);
    x.fillStyle = "#111"; x.textBaseline = "alphabetic"; x.textAlign = "left";
    x.font = "italic 900 25px 'Arial Black','Helvetica Neue',Arial,sans-serif";
    const w = x.measureText("AIRZETA").width || 118;
    x.save(); x.translate(1, 24.5); x.scale(118 / w, 1); x.fillText("AIRZETA", 0, 0); x.restore();
    const poly = (a, c) => { x.beginPath(); a.forEach(([px, py], i) => { const X = 123 + px * 30, Y = -1 + py * 30; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }); x.closePath(); x.fillStyle = c; x.fill(); };
    poly(LG_A, "#5a5a5a"); poly(LG_B, "#111");
    x.restore();
  }
  function wrapText(x, text, maxW, maxLines) {
    const out = []; let line = "";
    Array.from(String(text || "")).forEach(ch => {
      if (x.measureText(line + ch).width > maxW && line) { out.push(line); line = ch === " " ? "" : ch; } else line += ch;
    });
    if (line) out.push(line);
    if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].slice(0, -1) + "…"; }
    return out;
  }
  function certCanvas(signImg) {
    const W = 720, H = 900, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext ? c.getContext("2d") : null;
    if (!x) return null;
    const f = st.info || {}, p = st.person || {}, d = st.done || {};
    const F = "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif";
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#0f766e"; x.fillRect(0, 0, W, 14);
    x.strokeStyle = "#d9dee0"; x.lineWidth = 2; x.strokeRect(1, 1, W - 2, H - 2);
    x.textAlign = "left"; x.textBaseline = "alphabetic";
    x.fillStyle = "#0f766e"; x.font = "700 26px " + F; x.fillText("교육 이수증", 56, 92);
    x.fillStyle = "#6b7780"; x.font = "500 22px " + F; x.textAlign = "right"; x.fillText((f.kind ? f.kind + " 교육" : "교육"), W - 56, 92); x.textAlign = "left";
    x.fillStyle = "#0e1a1f"; x.font = "700 40px " + F;
    let y = 170;
    wrapText(x, f.title || "교육", W - 112, 3).forEach(l => { x.fillText(l, 56, y); y += 54; });
    y += 14; x.strokeStyle = "#e3e7e9"; x.lineWidth = 2; x.beginPath(); x.moveTo(56, y); x.lineTo(W - 56, y); x.stroke(); y += 52;
    const row = (k, v) => { if (!v) return; x.fillStyle = "#6b7780"; x.font = "500 24px " + F; x.fillText(k, 56, y); x.fillStyle = "#0e1a1f"; x.font = "600 28px " + F; x.fillText(wrapText(x, v, W - 112 - 150, 1)[0] || "", 206, y); y += 50; };
    row("이름", d.name || p.name || "");
    row("소속", [p.org, p.part].filter(Boolean).join(" · "));
    row("사번", p.emp || "");
    row("이수 일시", d.at || "");
    const by = Math.max(y + 8, 520), bh = H - 130 - by;
    x.fillStyle = "#f6f8f8"; x.fillRect(56, by, W - 112, bh);
    x.strokeStyle = "#d9dee0"; x.lineWidth = 2; x.strokeRect(56, by, W - 112, bh);
    x.fillStyle = "#6b7780"; x.font = "500 20px " + F; x.fillText("서명", 72, by + 34);
    if (signImg && signImg.width) {
      const k = Math.min((W - 160) / signImg.width, (bh - 50) / signImg.height);
      const sw = signImg.width * k, sh = signImg.height * k;
      x.drawImage(signImg, (W - sw) / 2, by + 40 + (bh - 50 - sh) / 2, sw, sh);
    }
    drawLogo(x, 56, H - 84, 34);
    x.fillStyle = "#6b7780"; x.font = "500 20px " + F; x.textAlign = "right"; x.fillText("H:drive 교육 전파 · 서명", W - 56, H - 58);
    return c;
  }
  function makeCert() {
    return new Promise((res) => {
      try {
        const im = new Image();
        im.onload = () => { try { const c = certCanvas(im); res(c ? c.toDataURL("image/png") : ""); } catch (e) { res(""); } };
        im.onerror = () => res("");
        im.src = st.sign;
      } catch (e) { res(""); }
    });
  }
  async function saveCert() {
    const msg = $("#ln-save-msg"), say = (t) => { if (msg) { msg.textContent = t; msg.hidden = !t; } };
    const name = "교육이수증_" + String((st.done && st.done.at) || "").slice(0, 10).replace(/-/g, "") + ".png";
    try {
      const bin = atob(String(st.cert).split(",")[1] || ""), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8], { type: "image/png" });   // CSP: data: 주소는 fetch 하지 않는다
      const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); say("공유 창에서 '이미지 저장'을 고르면 사진첩에 들어갑니다."); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      const u = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = u; a.download = name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(u); } catch (e) { /* 없음 */ } }, 4000);
      say("저장했습니다. 안 보이면 그림을 길게 눌러 저장하세요.");
    } catch (e) { say("그림을 길게 눌러 '사진 앱에 저장'을 고르세요."); }
  }
  async function wireDone() {
    const box = $("#ln-cert");
    if (!box) return;
    if (!st.cert) st.cert = await makeCert();
    const img = $("#ln-cert-img");
    if (!st.cert || !img) return;
    img.src = st.cert; box.hidden = false;
    const b = $("#ln-save"); if (b) b.onclick = saveCert;
  }

  function render() {
    const a = app();
    if (!a) return;
    if (io) { try { io.disconnect(); } catch (e) { /* 없음 */ } io = null; }
    window.removeEventListener("scroll", checkEnd);
    if (st.view === "err") a.innerHTML = errHTML();
    else if (st.view === "p1") { a.innerHTML = p1HTML(); wireP1(); }
    else if (st.view === "p2") { a.innerHTML = p2HTML(); wireP2(); }
    else if (st.view === "p3") { st.msg = ""; a.innerHTML = p3HTML(); wireP3(); }
    else if (st.view === "done") { a.innerHTML = doneHTML(); wireDone(); }
    document.title = (st.info && st.info.title ? st.info.title + " — " : "") + "교육 이수 — H:drive";
  }

  async function boot() {
    st.code = String(location.hash || "").replace(/^#\/?/, "").trim().toLowerCase();
    if (!/^[a-z2-9]{12}$/.test(st.code)) { fail("invalid"); return; }
    try {
      const d = await rpc("semis_logi_learn_info", { p_k: st.code });
      if (!d || !d.ok) { fail((d && d.error) || "network", d); return; }
      st.info = d;
      loadDraft();
      st.view = "p1";
      render();
      warm();
    } catch (e) { fail("network"); }
  }

  const api = { st, boot, render, find, start, submit, exportSign, foot, complete, left, makeCert, certCanvas, saveCert,
    _clock(fn) { now = fn; }, _seen() { st.seen = true; foot(); } };
  window.SemisLearnApp = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => api.boot());
  else api.boot();
})();
