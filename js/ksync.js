/* K드라이브 동기화 감시 · 관리 — 시스템 설정 › 'K드라이브 동기화' 탭(시스템관리자만). 동기화한 자료 자체는 각 화면 문서함 · K 폴더의 일반 자료라 여기서 보여 주지 않는다.
   서버: RPC semis_logi_ksync_*(시스템관리자 세션이 아니면 42501) — tools/sql/semis-logi-ksync.sql. 실행은 Mac 에이전트(tools/ksync)가 하고 이 화면은 요청 표시 · 설정 · 확인 처리만 한다.
   SemisKsync = { tab(box), badge(), poll(force), _st } */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const rpc = (name, args) => SemisSync.rpc(name, args || {});
  const RES = { ok: ["정상", "green"], partial: ["일부 오류", "amber"], fail: ["실패", "red"], held: ["보류", "amber"], offline: ["연결 안 됨", "gray"], "": ["실행 중", "blue"] };
  const TRIG = { daily: "매일", net: "연결 때", manual: "요청" };
  const DIR = { both: "양쪽", k2h: "K → H 만", h2k: "H → K 만" };
  const MSTATE = { preview: ["미리보기", "blue"], active: ["동기화 중", "green"], paused: ["멈춤", "gray"] };
  const FSTATE = { del_k: "K드라이브에서 지움", del_h: "H:drive 에서 지움", conflict: "충돌", skip: "건너뜀", error: "오류", restore: "복원 대기", trash: "삭제 확정 대기" };
  const EVK = { bad_key: "틀린 키", revoked_key: "폐기한 키", ip_denied: "허용 밖 IP", rate: "횟수 초과", mass_hold: "대량 변경 보류", type_block: "실행 파일 차단", hash_mismatch: "해시 불일치", scope: "연결 밖 접근" };
  const WHY = { too_large: "50MB 초과", type: "올리지 않는 형식", type_block: "실행 파일 · 스크립트(K 에 쓰지 않음)", name: "쓸 수 없는 이름", dir: "이 연결의 방향 밖", hash: "해시 불일치", changed: "읽는 중 바뀜",
    no_folder: "K 폴더 없음", quota: "하루 전송량 상한", ssi: "민감보안정보", upload: "올리기 실패", download: "받기 실패", path: "연결 폴더 밖 경로", held: "보류",
    mark: "서버가 맞춘 기록 일부를 받지 않음", state: "연결을 멈추거나 지워서 이 연결은 중단", run: "서버에서 이 실행이 이미 끝나 중단",
    apply: "문서함에 등록하지 못함(그 사이 H:drive 에 새 판 등) — 다음 실행에서 다시 맞춤",
    old: "기준일 전에 고친 파일이라 서버가 받지 않음", since: "기준일 형식이 틀려 이 연결은 건너뜀", excluded: "지정 제외" };
  const st = { s: null, p: null, runs: null, ev: null, folders: null, rep: null, evKind: "", err: "", busy: false, alert: false, at: 0, box: null };

  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (t) => { const d = new Date(t); return !t || isNaN(d) ? "-" : (d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const ago = (t) => {
    const d = new Date(t);
    if (!t || isNaN(d)) return "연락 없음";
    const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    return m < 1 ? "방금" : m < 60 ? m + "분 전" : m < 48 * 60 ? Math.round(m / 60) + "시간 전" : Math.round(m / 1440) + "일 전";
  };
  const days = (t) => Math.floor((Date.now() - new Date(t).getTime()) / 864e5);
  const modLabel = (mod) => { const mn = SeMIS.menuForModule ? SeMIS.menuForModule(mod) : null; return (mn && mn.label) || mod; };
  const target = (m) => modLabel(m.mod) + " › " + (window.SemisDocs ? SemisDocs.labelOf(m.mod, m.grp) : m.grp);
  const mapOf = (id) => ((st.s && st.s.maps) || []).find(m => m.id === id);
  /* 방향 밖(dir) = 한 방향 연결에서 보내지 않는 쪽이 더 새로움 — 어느 쪽인지는 연결의 방향으로 */
  const why = (r, mapId) => {
    if (r === "dir") { const m = mapId != null ? mapOf(Number(mapId)) : null; if (m && m.dir !== "both") return (m.dir === "h2k" ? "K드라이브" : "H:drive") + " 쪽이 더 새로움 — 이 연결은 한 방향"; }
    return WHY[r] || r || "";
  };
  const errText = (e) => (e && e.status === 403 ? "시스템관리자만 쓸 수 있습니다." : "서버에 연결할 수 없습니다.");
  const ERR = { k_path: "K 폴더 경로를 확인하세요(연결 폴더 안 상대 경로).", target: "화면 · 분류를 고르세요.", k_dup: "이미 연결했거나 겹치는 K 폴더입니다.", target_dup: "그 화면 · 분류는 이미 다른 폴더와 연결되어 있습니다.",
    locked: "바꿀 수 없습니다 — 맞춘 파일이 있으면 폴더 · 화면을, 시작한 연결은 기준일을 비우거나 더 이른 날로 바꿀 수 없습니다. 연결을 지우고 새로 만드세요.", since: "기준일 형식을 확인하세요(YYYY-MM-DD).", ip: "IP 형식을 확인하세요(너무 넓은 범위는 넣을 수 없음).", daily_at: "시각 형식(HH:MM)", mass_limit: "한도 값을 확인하세요.", gone: "이미 처리되었습니다.", state: "지금 상태에서는 할 수 없습니다.", bad: "입력을 확인하세요.",
    preview: "미리보기 건수가 온 뒤에 시작할 수 있습니다.", excludes: "뺄 경로를 확인하세요(한 줄에 하나 · 20개까지 · 상대 경로).",
    excluded: "지정 제외 아래 폴더입니다 — 전체 제외에서 빼거나, 이미 이은 연결을 덮는 경로는 연결마다 제외로 넣으세요." };
  const fail = (d) => toast(ERR[(d && d.error) || ""] || "처리하지 못했습니다.", true);
  const isDom = () => typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
  /* #tab-body 는 설정 탭이 모두 함께 쓰는 칸 — 늦게 온 결과가 다른 탭 위에 그려지지 않게 */
  const on = () => !!(st.box && st.box.isConnected && document.querySelector('#view .tab.active[data-tab="ksync"]'));
  const alertOf = () => !!(st.s && (st.s.stale || (st.s.counts && st.s.counts.hold) || st.evNew));

  /* ── 불러오기 ── */
  /* quiet = 원격 변경 등으로 화면만 다시 그린 것 — 아무도 보고 있지 않을 수 있어(숨은 창) '본 것'으로 하지 않는다 */
  async function load(full, quiet) {
    st.busy = true;
    try {
      /* 보안 이벤트 목록을 실제로 보여 줄 때만 '본 것' — 종류로 거른 목록은 다른 종류의 새 이벤트를 보여 주지 않는다 */
      const look = !quiet && st.secTab === "ev" && !st.evKind && on();
      const jobs = [rpc("semis_logi_ksync_status"), rpc("semis_logi_ksync_pending"), rpc("semis_logi_ksync_runs", { p: { limit: 30 } }),
        rpc("semis_logi_ksync_events", { p: { kind: st.evKind || null, limit: 100, seen: look } }),
        rpc("semis_logi_ksync_report").catch(() => null)];     // 보고는 없어도 나머지는 그린다
      if (full || !st.folders) jobs.push(rpc("semis_logi_ksync_folders"));
      const r = await Promise.all(jobs);
      st.s = r[0]; st.p = r[1]; st.runs = r[2].runs || []; st.ev = r[3]; st.rep = r[4] && r[4].ok ? r[4] : null; if (r[5]) st.folders = r[5].folders || [];
      st.err = "";
      st.evNew = !look && !!(st.s && st.s.counts && st.s.counts.ev_new);
      if (full && st.evNew && on()) { st.secTab = "ev"; st.evKind = ""; await seen(); }     // 새 보안 이벤트는 열 때 그 칸을 전체로 펴서 보여 준다
      setAlert(alertOf());
    } catch (e) { st.err = errText(e); }
    st.busy = false;
  }
  async function seen() {
    if (st.evKind) return;     // 거른 목록으로는 '본 것'이 아니다 — [전체]를 볼 때
    try {
      const d = await rpc("semis_logi_ksync_events", { p: { kind: st.evKind || null, limit: 100, seen: true } });
      if (d && d.ok) { st.ev = d; st.evNew = false; setAlert(alertOf()); }
    } catch (e) { /* 다음에 목록을 볼 때 다시 */ }
  }
  function setAlert(v) {
    st.at = Date.now();
    if (st.alert === v) return;
    st.alert = v;
    if (SeMIS.renderNav) SeMIS.renderNav();
  }
  /* 레일 '시스템 설정' 배지 — 시스템관리자에게만, 이틀 넘게 실패 · 보류 · 새 보안 이벤트일 때 */
  function badge() { return SeMIS.isAdmin && SeMIS.isAdmin() && st.alert ? "확인" : ""; }
  async function poll(force) {
    if (!SeMIS.user || !SeMIS.isAdmin() || !window.SemisSync) return;
    if (isDom() && !window.__ksyncPoll) return;
    if (!force && Date.now() - st.at < 10 * 60 * 1000) return;
    st.at = Date.now();
    try { const s = await rpc("semis_logi_ksync_status"); if (s && s.ok) setAlert(!!s.alert); } catch (e) { /* 다음 확인 때 */ }
  }
  /* 화면을 다시 그리지 않아도 10분마다 — 숨은 탭에서는 묻지 않는다 */
  function tick() { if (document.visibilityState !== "hidden") poll(true); }

  /* ── 화면 ── */
  /* again = 같은 화면을 다시 그린 것(사용자가 탭을 연 것이 아님) — 보던 칸을 그대로 두고 새 보안 이벤트를 '본 것'으로 하지 않는다 */
  async function tab(box, again) {
    st.box = box;
    heads();
    box.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';
    await load(!again, !!again);
    if (st.box === box && box.isConnected !== false) paint();
  }
  /* 시스템 설정 머리말: [지금 동기화 요청] [⋯ 에이전트 키 발급 · 폐기 · 매일 실행 시각 · 대량 변경 한도] [인쇄] */
  function heads() {
    const head = $("#view .page-head");
    if (!head) return;
    $$(".ks-hb", head).forEach(b => b.remove());
    /* 화면을 처음 그릴 때는 인쇄 단추가 아직 없다 — 코어가 설명 앞에 붙이므로 그 앞에 두어야 인쇄가 끝에 온다 */
    const pb = head.querySelector("[data-print-btn]") || head.querySelector(":scope > .page-desc");
    const mk = (cls, id, ico, label) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-sm ks-hb " + cls; b.id = id; b.innerHTML = icon(ico, 16) + "<span>" + esc(label) + "</span>"; head.insertBefore(b, pb || null); return b; };
    mk("btn-primary", "ks-req", "refresh", "지금 동기화 요청").onclick = request;
    mk("btn-ghost ph-rare", "ks-key-new", "lock", "에이전트 키 발급").onclick = keyNew;
    mk("btn-ghost ph-rare", "ks-key-revoke", "x", "에이전트 키 폐기").onclick = keyRevokePick;
    mk("btn-ghost ph-rare", "ks-daily", "clock", "매일 실행 시각").onclick = dailyForm;
    mk("btn-ghost ph-rare", "ks-limit", "alert", "대량 변경 한도").onclick = limitForm;
    mk("btn-ghost ph-rare", "ks-excl", "x", "지정 제외").onclick = exclForm;
  }
  function paint() {
    const box = st.box;
    if (!on()) return;
    if (st.err || !st.s) { box.innerHTML = `<div class="card"><div class="empty">${esc(st.err || "불러오지 못했습니다.")}</div></div>`; return; }
    box.innerHTML = stripHTML() + repHTML() + mapsHTML() + pendHTML() + runsHTML() + secHTML();
    wire(box);
  }

  function stripHTML() {
    const s = st.s, state = s.state || {}, net = state.net || {};
    const live = (s.agents || []).filter(a => !a.revoked_at).sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")));
    const ag = live[0];
    const today = s.today, res = today ? RES[today.result || ""] || RES.fail : null;
    const next = schedule(s);
    const warn = setupWarn();
    return `<div class="ks-strip${s.stale ? " is-stale" : ""}">${ui.stats([
      { label: "에이전트", value: ag ? ago(ag.last_seen_at) : "없음", sub: ag ? [ag.version && "v" + ag.version, ag.host].filter(Boolean).join(" · ") : "키 발급 · Mac 설치 필요", tone: ag && ag.last_seen_at && days(ag.last_seen_at) < 2 ? "ok" : "warn" },
      { label: "사내망", value: net.at ? (net.ok ? "연결됨" : "연결 안 됨") : "-", sub: net.at ? "확인 " + fmt(net.at) : "", tone: net.at && !net.ok ? "warn" : net.ok ? "ok" : "muted" },
      { label: "마지막 성공", value: s.last_ok ? fmt(s.last_ok) : "없음", tone: s.stale ? "bad" : "muted" },
      { label: "다음 예정", value: next.value, sub: next.sub, tone: "muted" },
      { label: "오늘 결과", value: res ? res[0] : "아직 없음", sub: today ? `K→H ${today.k2h} · H→K ${today.h2k}${today.errors ? " · 오류 " + today.errors : ""}` : "", tone: !res ? "muted" : today.result === "ok" ? "ok" : today.result === "fail" ? "bad" : "warn" }
    ])}${warn ? `<p class="ks-warn" role="status">${icon("alert", 16)}<span>${esc(warn)}</span></p>` : ""}</div>`;
  }
  /* 보고(범위 밖) — 연결 안 된 폴더 · 기준일 전이라 안 올림 · K 로 안 간 H 문서 · 지정 제외. 0 인 칸은 숨기고, 모두 0 이면 줄도 없다.
     불일치(범위 안인데 못 맞춘 것)는 연결마다 '폴더 연결' 줄에 */
  function repHTML() {
    const r = st.rep;
    if (!r) return "";
    const fl = r.folders || [], sum = r.sum || {};
    const tiles = [
      fl.length && { label: "연결 안 된 폴더", value: fl.length + "곳", sub: "파일 " + fl.reduce((a, f) => a + (Number(f.n) || 0), 0) + "개(3단계까지)", tone: "warn" },
      sum.old && { label: "기준일 전이라 안 올림", value: sum.old + "개", sub: "연결의 기준일 전에 고친 K 파일", tone: "muted" },
      sum.h_out && { label: "K 로 안 간 H 문서", value: sum.h_out + "개", sub: "K → H 만 연결 · K 에 쓰지 않는 형식 · 이름", tone: "muted" },
      sum.excl && { label: "지정 제외", value: sum.excl + "곳", sub: "동기화하지 않는 폴더(⋯ › 지정 제외 · 연결마다)", tone: "muted" }].filter(Boolean);
    if (!tiles.length) return "";
    return `<div class="ks-rep">${ui.stats(tiles)}${fl.length ? `<button type="button" class="link-btn" id="ks-unlinked">연결 안 된 폴더 보기</button>` : ""}</div>`;
  }
  function unlinked() {
    const fl = (st.rep && st.rep.folders) || [];
    openModal(`<h3>연결 안 된 폴더</h3>
      <p class="ks-note">어느 연결 · 지정 제외에도 들지 않은 K 폴더입니다(Mac 에이전트가 하루 한 번 알려 준 3단계 목록 기준). 잇지 않을 폴더는 ⋯ › 지정 제외에 넣으면 이 목록에서 빠집니다.</p>
      <div class="table-wrap ks-det"><table class="tbl ks-tbl"><thead><tr><th>K 폴더</th><th>파일</th><th></th></tr></thead><tbody>${fl.map((f, i) => `<tr>
        <td data-role="title"><span class="ks-path">${esc(f.path)}</span>${f.part ? '<div class="cell-sub">이 폴더 바로 아래 파일만(아래 폴더 일부는 연결됨)</div>' : ""}</td>
        <td class="mono">${esc(String(f.n || 0))}</td>
        <td class="td-act">${f.part ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-ks-link="${i}">연결 추가</button>`}</td></tr>`).join("")}</tbody></table></div>
      <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="ok">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=ok]").onclick = closeModal;
    $$("#modal-box [data-ks-link]").forEach(b => b.onclick = () => mapForm(null, fl[Number(b.dataset.ksLink)].path));
  }
  /* 다음 매일 실행 — 한국 시각 시작부터 30분 창(에이전트와 같은 규칙). 창이 지났거나 오늘 끝냈거나(창 시작 뒤에 시작해 성공)
     연결이 안 돼 오늘을 건너뛰었으면(에이전트가 '오늘 동기화 건너뜀'으로 보고) 내일 — 창이 지난 뒤에는 그날 따라잡지 않는다.
     끝냄은 오늘 회차의 시작 시각으로 — 에이전트도 시작한 때로 센다(last_ok 는 끝난 시각이라 창 전에 시작한 수동 실행도 끝냄으로 보게 됨).
     건너뜀은 사내망 표시나 그날의 '연결 안 됨' 줄 — 뒤에 연결되면 hello 가 사내망 표시를 '연결됨'으로 덮어도 그 줄은 남는다 */
  function schedule(s) {
    const state = s.state || {}, net = state.net || {}, t = s.today || {}, last = s.last || {};
    const kst = (t) => new Date(new Date(t).getTime() + 9 * 3600e3);
    const day = (t) => kst(t).toISOString().slice(0, 10), min = (t) => { const d = kst(t); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
    const hm = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
    const at = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(state.daily_at || ""));
    const start = at ? Number(at[1]) * 60 + Number(at[2]) : 8 * 60 + 30;
    const win = hm(start) + "~" + hm((start + 30) % 1440);
    const now = s.now || Date.now(), d0 = day(now), m0 = min(now);
    const done = !!(t.started_at && day(t.started_at) === d0 && min(t.started_at) >= start && /^(ok|partial|held)$/.test(t.result || ""));
    const skipped = (net.ok === false && !!net.at && day(net.at) === d0 && /건너뜀/.test(net.msg || ""))
      || (last.result === "offline" && !!last.started_at && day(last.started_at) === d0 && /건너뜀/.test(last.msg || ""));
    const later = m0 < start || (m0 < start + 30 && !done && !skipped);
    return { value: (later ? "오늘 " : "내일 ") + win, sub: "매일 " + win + " · 연결이 안 되면 5분 간격 3번, 그래도 안 되면 다음 날" };
  }
  /* 한 줄 이유 — 설치가 덜 됐거나 이틀 넘게 성공이 없을 때 */
  function setupWarn() {
    const s = st.s, state = s.state || {}, net = state.net || {};
    const live = (s.agents || []).filter(a => !a.revoked_at);
    if (!live.length) return "에이전트 키를 발급해 Mac 에 설치하세요(⋯ › 에이전트 키 발급).";
    if (!(state.ip_allow || []).length) return "허용 IP 가 없어 동기화가 열리지 않습니다 — 아래 '보안 › 허용 IP'에서 회사 출구 IP 를 [허용]하세요.";
    if (!s.stale) return "";
    const seen = live.map(a => a.last_seen_at).filter(Boolean).sort().pop();
    if (!seen || days(seen) >= 2) return "Mac 에이전트 연락이 이틀 넘게 없습니다(마지막 " + (seen ? fmt(seen) : "없음") + ") — Mac 이 켜져 있는지, 에이전트가 설치되어 있는지 확인하세요.";
    if (net.at && !net.ok) return "사내망(VPN)에 연결되지 않아 이틀 넘게 동기화하지 못했습니다 — " + (net.msg || "K드라이브 응답 없음") + ".";
    if (s.last && s.last.result === "fail") return "마지막 실행이 실패했습니다: " + (s.last.msg || "원인 불명") + ".";
    if (s.counts && s.counts.hold) return "대량 변경 보류가 승인을 기다리고 있습니다.";
    return "이틀 넘게 성공한 동기화가 없습니다.";
  }

  function mapsHTML() {
    const maps = st.s.maps || [];
    const rows = maps.map(m => {
      const ms = MSTATE[m.state] || MSTATE.paused, pv = m.preview;
      const act = m.state === "preview"
        ? `<button type="button" class="btn btn-ghost btn-sm" data-ks-start="${m.id}"${pv ? "" : " disabled"}>시작</button>`
        : m.state === "paused" ? `<button type="button" class="btn btn-ghost btn-sm" data-ks-start="${m.id}">다시 시작</button>` : "";
      const sub0 = m.state === "preview" ? (pv ? `미리보기 K→H ${pv.k2h} · H→K ${pv.h2k}${pv.link ? " · 연결만 " + pv.link : ""}${pv.skip ? " · 건너뜀 " + pv.skip : ""}` : "미리보기 건수를 기다리는 중")
        : m.hold && !m.hold.ok ? "대량 변경 보류" : "";
      const sn = m.since ? "기준일 " + m.since + (m.state === "preview" && pv && pv.old != null ? " · 기준일 전 " + pv.old + "개 뺌" : "") : "";
      // 불일치 = 범위 안인데 마지막 실행에서 못 맞춘 것(삭제 대기 · 보류 · 오류) — 목표는 모든 활성 연결이 0
      const mis = m.state === "active" && m.report && Number(m.report.mismatch) ? "불일치 " + m.report.mismatch : "";
      const ex = (m.excludes || []).length ? "제외 " + m.excludes.length + "곳" : "";
      const sub = [sub0, sn, mis, ex].filter(Boolean).join(" · ");
      return `<tr>
        <td data-role="title"><b class="ks-path">${esc(m.k_path)}</b>${sub ? `<div class="cell-sub">${esc(sub)}</div>` : ""}</td>
        <td>${esc(target(m))}</td><td>${esc(DIR[m.dir] || m.dir)}</td><td>${m.ssi ? '<span class="dk-ssi" title="민감보안정보">SSI</span>' : '<span class="cell-sub">-</span>'}</td>
        <td class="mono">${esc(String(m.n_files || 0))}${m.n_wait ? `<div class="cell-sub">확인 ${esc(String(m.n_wait))}</div>` : ""}</td>
        <td>${ui.chip(ms[0], ms[1])}</td><td class="mono">${esc(m.last_run_at ? fmt(m.last_run_at) : "-")}</td>
        <td class="td-act">${act}<button type="button" class="mt-btn" data-ks-map="${m.id}" aria-label="${esc(m.k_path)} 관리">${icon("more", 16)}</button></td></tr>`;
    }).join("");
    const misAll = maps.reduce((a, m) => a + (m.state === "active" && m.report ? Number(m.report.mismatch) || 0 : 0), 0);
    return `<div class="card ks-card" data-ks-card="maps"><div class="card-title">${icon("folder", 17)}<span>폴더 연결</span><span class="badge badge-gray">${maps.length}</span>${misAll ? `<span class="badge badge-amber ks-mis">불일치 ${misAll}</span>` : ""}<span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm c-act" id="ks-map-add">${icon("plus", 15)}<span>연결 추가</span></button></div>
      ${maps.length ? `<div class="table-wrap"><table class="tbl ks-tbl"><thead><tr><th>K 폴더</th><th>화면 › 분류</th><th>방향</th><th>SSI</th><th>파일 수</th><th>상태</th><th>마지막 동기화</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : ui.empty("연결한 폴더가 없습니다. [연결 추가]로 K 폴더와 화면 · 분류를 이으세요.")}</div>`;
  }

  function pendHTML() {
    const p = st.p || {}, holds = p.holds || [], files = p.files || [], last = p.last || [];
    const del = files.filter(f => f.state === "del_k" || f.state === "del_h"), conf = files.filter(f => f.state === "conflict");
    const wait = files.filter(f => f.state === "restore" || f.state === "trash");
    /* 기준선이 있는 파일은 건너뛸 때 그 줄 상태도 바뀌고 실행 기록에도 남는다 — 연결 · 경로마다 한 번.
       기록에 경로 대신 H 파일 이름이 남는 것은 H 쪽에서 건너뛴 줄(쓸 수 없는 이름 · 실행 파일)뿐 — 그 이유일 때만 H 이름으로 맞춰야 같은 이름의 다른 K 파일 줄을 숨기지 않는다 */
    const hSide = (r) => r === "name" || r === "type_block";
    const once = new Set();
    const skip = files.filter(f => f.state === "skip" || f.state === "error").concat(last.map(x => ({ last: true, map: x.m, rel_path: x.f, state: x.a, note: x.r })))
      .filter(f => {
        const k = f.map + "|" + f.rel_path;
        if (once.has(k) || (f.last && once.has("h|" + k + "|" + f.note))) return false;
        once.add(k);
        if (!f.last && f.h_name && hSide(f.note)) once.add("h|" + f.map + "|" + f.h_name + "|" + f.note);
        return true;
      });
    const n = holds.length + del.length + conf.length + skip.length;
    const mp = (id) => { const m = mapOf(id); return m ? m.k_path : ""; };
    const row = (f, acts) => `<tr><td data-role="title"><span class="ks-path">${esc(f.rel_path || f.h_name || "")}</span><div class="cell-sub">${esc(mp(f.map))}</div></td>
      <td>${esc(FSTATE[f.state] || f.state)}${f.note ? `<div class="cell-sub">${esc(why(f.note, f.map))}</div>` : ""}</td><td class="td-act">${acts || ""}</td></tr>`;
    const tbl = (rows, empty) => rows ? `<div class="table-wrap"><table class="tbl ks-tbl"><thead><tr><th>파일</th><th>내용</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="ks-none">${esc(empty)}</p>`;
    const sel = holds.length ? "hold" : del.length ? "del" : conf.length ? "conf" : "skip";
    const tabs = [["hold", "대량 변경 보류 " + holds.length], ["del", "삭제 대기 " + del.length], ["conf", "충돌 " + conf.length], ["skip", "건너뜀 · 오류 " + skip.length]];
    return `<div class="card ks-card" data-ks-card="pend"><div class="card-title">${icon("alert", 17)}<span>확인 필요</span><span class="badge ${n ? "badge-amber" : "badge-gray"}">${n}</span></div>
      ${ui.tabs("kspend", tabs, sel)}
      ${ui.pane("kspend", "hold", sel, holds.length ? `<div class="table-wrap"><table class="tbl ks-tbl"><thead><tr><th>K 폴더</th><th>변경 · 삭제 대기</th><th></th></tr></thead><tbody>${holds.map(h => `<tr>
          <td data-role="title"><b class="ks-path">${esc(h.k_path)}</b><div class="cell-sub">${esc(target(h))} · ${esc(fmt(h.at))}</div></td>
          <td class="mono">${esc(String(h.n || 0))}건 / 맞춘 파일 ${esc(String(h.base || 0))}건</td>
          <td class="td-act"><button type="button" class="btn btn-ghost btn-sm" data-ks-hold="approve" data-run="${esc(String(h.run))}" data-map="${h.map}">승인</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ks-hold="reject" data-run="${esc(String(h.run))}" data-map="${h.map}">거절</button></td></tr>`).join("")}</tbody></table></div>
          <p class="ks-note">한 번에 많이 바뀌면(랜섬웨어 · 실수 대비) 그 연결만 멈춥니다. 바뀐 내용을 확인한 뒤 승인하면 다음 확인 때 진행하고, 거절하면 연결을 멈춥니다.</p>` : `<p class="ks-none">보류된 연결이 없습니다.</p>`)}
      ${ui.pane("kspend", "del", sel, tbl(del.map(f => row(f, `<button type="button" class="btn btn-ghost btn-sm" data-ks-res="confirm" data-id="${f.id}">삭제 확정</button>
          <button type="button" class="btn btn-ghost btn-sm" data-ks-res="restore" data-id="${f.id}">복원</button>`)).join("") + wait.map(f => row(f, "")).join(""), "삭제 대기가 없습니다.")
        + (del.length ? `<p class="ks-note">삭제 확정 — K 에서 지웠으면 H:drive 문서를 지우고, H:drive 에서 지웠으면 K 파일을 연결 폴더 안 '_H드라이브_휴지통'으로 옮깁니다. 휴지통은 에이전트가 지우지 않습니다 — 필요하면 직접 정리하세요. 복원 — 지워진 쪽에 다시 만듭니다.</p>` : ""))}
      ${ui.pane("kspend", "conf", sel, tbl(conf.map(f => row(f, `<button type="button" class="btn btn-ghost btn-sm" data-ks-res="dismiss" data-id="${f.id}">확인</button>`)).join(""), "충돌이 없습니다.")
        + (conf.length ? `<p class="ks-note">양쪽에서 함께 고친 파일 — 늦게 고친 쪽이 현재 판이고, 다른 쪽은 H:drive 이전 판과 K '이름 (충돌 날짜)' 파일로 남겼습니다.</p>` : ""))}
      ${ui.pane("kspend", "skip", sel, tbl(skip.map(f => row(f, f.last ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-ks-res="dismiss" data-id="${f.id}">확인</button>`)).join(""), "건너뛴 파일 · 오류가 없습니다."))}
    </div>`;
  }

  function runsHTML() {
    const runs = st.runs || [];
    return `<div class="card ks-card" data-ks-card="runs"><div class="card-title">${icon("repeat", 17)}<span>실행 기록</span><span class="badge badge-gray">최근 ${runs.length}</span><span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm c-act no-print" data-ks-print="runs">${icon("print", 15)}<span>인쇄</span></button></div>
      ${runs.length ? `<div class="table-wrap"><table class="tbl ks-tbl"><thead><tr><th>시작</th><th>결과</th><th>계기</th><th>K→H</th><th>H→K</th><th>충돌</th><th>건너뜀</th><th>오류</th><th>내용</th></tr></thead><tbody>${runs.map(r => {
          const rs = RES[r.result || ""] || RES.fail;
          return `<tr><td data-role="title"><button type="button" class="link-btn ks-run" data-ks-run="${r.id}">${esc(fmt(r.started_at))}</button></td><td>${ui.chip(rs[0], rs[1])}</td>
            <td>${esc(TRIG[r.trigger] || r.trigger)}</td><td class="mono">${r.k2h}</td><td class="mono">${r.h2k}</td><td class="mono">${r.conflicts}</td><td class="mono">${r.skipped}</td><td class="mono">${r.errors}</td>
            <td>${esc(r.msg || "")}</td></tr>`;
        }).join("")}</tbody></table></div>` : ui.empty("아직 실행 기록이 없습니다.")}</div>`;
  }

  function secHTML() {
    const s = st.s, state = s.state || {}, ev = st.ev || {}, evs = ev.events || [], cnt = ev.counts || {};
    const allow = state.ip_allow || [], seen = (state.ip_seen || []).filter(x => !allow.some(a => a === x.ip + "/32"));
    const agents = s.agents || [];
    const ipPane = `<div class="ks-sub"><h3>허용 IP <small>회사 출구 IP(사무실 · VPN 경유) — 여기서 온 에이전트 호출만 받습니다</small></h3>
        ${allow.length ? `<ul class="ks-ips">${allow.map(a => `<li><span class="mono">${esc(a)}</span><button type="button" class="mt-btn danger" data-ks-ipdel="${esc(a)}" aria-label="${esc(a)} 지우기">${icon("trash", 15)}</button></li>`).join("")}</ul>`
          : `<p class="ks-none">허용 IP 가 없습니다 — 에이전트는 hello 만 할 수 있고 동기화는 열리지 않습니다.</p>`}
        <div class="ks-ipadd"><label for="ks-ip" class="sr-only">허용할 IP 또는 범위</label><input id="ks-ip" class="mono" placeholder="203.0.113.10 또는 203.0.113.0/24" autocomplete="off" maxlength="43">
          <button type="button" class="btn btn-ghost btn-sm" id="ks-ip-add">추가</button></div>
        <h3>후보 IP <small>맞는 키로 연락한 IP — 회사 출구 IP 일 때만 허용</small></h3>
        ${seen.length ? `<div class="table-wrap"><table class="tbl ks-tbl"><thead><tr><th>IP</th><th>마지막</th><th></th></tr></thead><tbody>${seen.map(x => `<tr><td class="mono" data-role="title">${esc(x.ip)}</td><td class="mono">${esc(fmt(x.at))}</td>
          <td class="td-act"><button type="button" class="btn btn-ghost btn-sm" data-ks-ipok="${esc(x.ip)}">허용</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="ks-none">후보가 없습니다.</p>`}</div>`;
    const keyPane = `<div class="ks-sub">${agents.length ? `<div class="table-wrap"><table class="tbl ks-tbl"><thead><tr><th>이름</th><th>발급</th><th>마지막 연락</th><th>마지막 사용 IP</th><th>상태</th><th></th></tr></thead><tbody>${agents.map(a => {
        const old = !a.revoked_at && days(a.created_at) >= 90;
        return `<tr><td data-role="title"><b>${esc(a.name || "Mac")}</b><div class="cell-sub">${esc([a.version && "v" + a.version, a.host].filter(Boolean).join(" · "))}</div></td>
          <td class="mono">${esc(fmt(a.created_at))}<div class="cell-sub">${esc(a.created_by || "")}</div></td><td>${esc(ago(a.last_seen_at))}</td><td class="mono">${esc(a.last_ip || "-")}</td>
          <td>${a.revoked_at ? ui.chip("폐기 " + fmt(a.revoked_at), "gray") : old ? ui.chip("교체 권장 · " + days(a.created_at) + "일", "amber") : ui.chip("사용 중", "green")}</td>
          <td class="td-act">${a.revoked_at ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-ks-revoke="${a.id}">폐기</button>`}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="ks-none">발급한 키가 없습니다.</p>`}
      <p class="ks-note">키는 Mac 키체인에만 두고 서버에는 지문(sha256)만 남깁니다. 발급 후 90일이 지나면 새 키를 발급해 Mac 에서 install.sh 로 바꾸고 옛 키를 폐기하세요.</p></div>`;
    const kinds = [["", "전체"]].concat(Object.keys(EVK).filter(k => cnt[k] || st.evKind === k).map(k => [k, EVK[k] + " " + (cnt[k] || 0)]));
    const evPane = `<div class="ks-sub"><div class="seg" role="group" aria-label="이벤트 종류">${kinds.map(([k, lb]) => `<button type="button" class="seg-btn" data-ks-evk="${esc(k)}" aria-pressed="${st.evKind === k}">${esc(lb)}</button>`).join("")}</div>
      ${evs.length ? `<div class="table-wrap"><table class="tbl ks-tbl"><thead><tr><th>시각</th><th>종류</th><th>IP</th><th>내용</th></tr></thead><tbody>${evs.map(e => {
          const d = e.detail || {}, m = d.map ? mapOf(Number(d.map)) : null;
          const info = [m && m.k_path, d.f, d.act && "동작 " + d.act, d.why && ({ key: "키 실패 반복 → 1시간 차단", min: "분당 상한", day: "하루 전송량" }[d.why] || d.why), d.n != null && d.n + "건"].filter(Boolean).join(" · ");
          return `<tr><td class="mono" data-role="title">${esc(fmt(e.at))}</td><td>${ui.chip(EVK[e.kind] || e.kind, e.kind === "mass_hold" || e.kind === "type_block" ? "amber" : "red")}</td><td class="mono">${esc(e.ip || "-")}</td><td>${esc(info)}</td></tr>`;
        }).join("")}</tbody></table></div>` : `<p class="ks-none">보안 이벤트가 없습니다.</p>`}</div>`;
    return `<div class="card ks-card" data-ks-card="sec"><div class="card-title">${icon("shield", 17)}<span>보안</span><span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm c-act no-print" data-ks-print="sec">${icon("print", 15)}<span>인쇄</span></button></div>
      ${ui.tabs("kssec", [["ip", "허용 IP " + allow.length], ["key", "에이전트 키"], ["ev", "보안 이벤트 " + evs.length]], st.secTab || "ip")}
      ${ui.pane("kssec", "ip", st.secTab || "ip", ipPane)}${ui.pane("kssec", "key", st.secTab || "ip", keyPane)}${ui.pane("kssec", "ev", st.secTab || "ip", evPane)}</div>`;
  }

  /* ── 동작 ── */
  async function act(name, args, okMsg) {
    try {
      const d = await rpc(name, args);
      if (!d || !d.ok) { fail(d); return null; }
      if (okMsg) toast(typeof okMsg === "function" ? okMsg(d) : okMsg);
      await load(false); paint();
      return d;
    } catch (e) { toast(errText(e), true); return null; }
  }
  function wire(box) {
    /* 숨어 있던 칸의 표는 처음 정돈 때 잴 수 없었다 — 고를 때 다시(모바일 한 줄 쌓기) */
    const retidy = () => { if (SeMIS.tidyTables) SeMIS.tidyTables(box); };
    ui.wireTabs(box, "kspend", retidy);
    ui.wireTabs(box, "kssec", (id) => { st.secTab = id; retidy(); if (id === "ev" && st.evNew) seen(); });
    const add = $("#ks-map-add", box); if (add) add.onclick = () => mapForm();
    const ul = $("#ks-unlinked", box); if (ul) ul.onclick = unlinked;
    $$("[data-ks-start]", box).forEach(b => b.onclick = () => {
      const m = mapOf(Number(b.dataset.ksStart));
      const pv = (m && m.preview) || {};
      // 뺀 수는 에이전트가 센 때만(1.64 전 에이전트는 old 를 보내지 않음 — 0개로 적지 않는다)
      const cut = m && m.since ? ` 기준일 ${m.since} 전에 고친 K 파일${pv.old != null ? " " + pv.old + "개는" : "은"} 올리지 않습니다(시작한 뒤 기준일은 더 늦은 날로만 바꿀 수 있음).` : "";
      confirmModal(m && m.state === "preview" ? `'${m.k_path}' 동기화를 시작할까요? K→H ${pv.k2h || 0}건 · H→K ${pv.h2k || 0}건을 맞춥니다.${cut}` : "이 연결을 다시 시작할까요?",
        () => act("semis_logi_ksync_map_start", { p_id: Number(b.dataset.ksStart) }, "시작했습니다 — Mac 이 다음에 확인할 때 맞춥니다."));
    });
    $$("[data-ks-map]", box).forEach(b => b.onclick = () => mapMenu(Number(b.dataset.ksMap), b));
    $$("[data-ks-hold]", box).forEach(b => b.onclick = () => {
      const ap = b.dataset.ksHold === "approve";
      confirmModal(ap ? "보류된 변경을 승인할까요? 다음 확인 때 그대로 맞춥니다." : "거절하면 이 연결을 멈춥니다. 바뀐 내용을 확인한 뒤 다시 시작하세요.",
        () => act("semis_logi_ksync_hold", { p: { run_id: b.dataset.run, act: b.dataset.ksHold, map: b.dataset.map } }, ap ? "승인했습니다." : "연결을 멈췄습니다."));
    });
    $$("[data-ks-res]", box).forEach(b => b.onclick = () => {
      const a = b.dataset.ksRes;
      // K 에서 지운 뒤 H 에 새 판이 생긴 줄은 서버가 지우지 않고 충돌로 돌린다(kept)
      const go = () => act("semis_logi_ksync_resolve", { p: { ids: [Number(b.dataset.id)], act: a } },
        a === "confirm" ? (d) => (d.kept ? "H:drive 에 새 판이 있어 지우지 않았습니다 — '충돌'에서 확인하세요." : "삭제를 확정했습니다.") : a === "restore" ? "복원을 요청했습니다." : "확인했습니다.");
      if (a === "confirm") confirmModal("삭제를 확정할까요? 지워진 쪽에 맞춰 다른 쪽도 지웁니다(H:drive 문서는 변경 이력 90일 · K 파일은 휴지통 폴더로 옮김 — 휴지통은 에이전트가 지우지 않습니다, 필요하면 직접 정리). 다른 연결 폴더로 옮긴 파일은 아닌지 확인하세요.", go); else go();
    });
    $$("[data-ks-run]", box).forEach(b => b.onclick = () => runDetail(Number(b.dataset.ksRun)));
    $$("[data-ks-print]", box).forEach(b => b.onclick = () => printCard(b.dataset.ksPrint));
    $$("[data-ks-evk]", box).forEach(b => b.onclick = async () => { st.evKind = b.dataset.ksEvk; st.secTab = "ev"; await load(false); paint(); });
    $$("[data-ks-ipok]", box).forEach(b => b.onclick = () => confirmModal(`${b.dataset.ksIpok} 를 허용할까요? 회사 출구 IP 가 맞는지 확인하세요.`,
      () => act("semis_logi_ksync_ip_approve", { p_ip: b.dataset.ksIpok }, "허용했습니다.")));
    $$("[data-ks-ipdel]", box).forEach(b => b.onclick = () => confirmModal(`${b.dataset.ksIpdel} 를 허용 목록에서 지울까요?`,
      () => act("semis_logi_ksync_settings", { p: { ip_allow: (st.s.state.ip_allow || []).filter(x => x !== b.dataset.ksIpdel) } }, "지웠습니다.")));
    const ipAdd = $("#ks-ip-add", box);
    if (ipAdd) ipAdd.onclick = () => {
      const v = String($("#ks-ip", box).value || "").trim();
      if (!v) { $("#ks-ip", box).focus(); return; }
      act("semis_logi_ksync_settings", { p: { ip_allow: (st.s.state.ip_allow || []).concat([v]) } }, "추가했습니다.");
    };
    $$("[data-ks-revoke]", box).forEach(b => b.onclick = () => keyRevoke(Number(b.dataset.ksRevoke)));
  }

  function request() { act("semis_logi_ksync_request", {}, "요청했습니다 — Mac 이 사내망에 연결되어 있으면 다음 확인(10분 안) 때 동기화합니다."); }

  function mapMenu(id, anchor) {
    const m = mapOf(id);
    if (!m) return;
    const items = [{ label: "방향 · SSI 바꾸기", icon: icon("edit"), run: () => mapForm(m) }];
    if (m.state === "active") items.push({ label: "멈춤", icon: icon("x"), run: () => act("semis_logi_ksync_map_save", { p: { id, pause: true } }, "멈췄습니다.") });
    items.push({ label: "연결 지우기", icon: icon("trash"), danger: true, run: () => confirmModal(`'${m.k_path}' 연결을 지울까요? 동기화 기준선만 지우고 H:drive 문서 · K 파일은 그대로 둡니다.`,
      () => act("semis_logi_ksync_map_delete", { p_id: id }, "연결을 지웠습니다.")) });
    if (SeMIS.actionSheet) SeMIS.actionSheet(items, { title: m.k_path }, anchor); else items[0].run();
  }
  /* 연결할 화면 · 분류 — SemisDocs.define 로 문서함을 가진 화면만 */
  function targets() {
    const out = [], seen = new Set();
    (SeMIS.data.menus || []).forEach(mn => {
      if (!mn || mn.type !== "module" || !mn.module || seen.has(mn.module) || !window.SemisDocs) return;
      const gs = SemisDocs.groupsOf(mn.module);
      if (!gs.length) return;
      seen.add(mn.module);
      out.push({ mod: mn.module, label: mn.label, groups: gs });
    });
    return out;
  }
  const lines = (s) => String(s || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  /* kp0 = 채워 둘 K 폴더(연결 안 된 폴더 목록의 [연결 추가]) */
  function mapForm(m, kp0) {
    const ts = targets(), edit = !!m, used = new Set(((st.s && st.s.maps) || []).filter(x => !m || x.id !== m.id).map(x => x.mod + "|" + x.grp));
    const fl = st.folders || [];
    const opts = ts.map(t => `<optgroup label="${esc(t.label)}">${t.groups.map(g => `<option value="${esc(t.mod + "|" + g.id)}"${used.has(t.mod + "|" + g.id) ? " disabled" : ""}${m && m.mod === t.mod && m.grp === g.id ? " selected" : ""}>${esc(t.label + " › " + g.label)}</option>`).join("")}</optgroup>`).join("");
    const started = edit && m.state !== "preview";
    openModal(`<h3>${edit ? "연결 바꾸기" : "폴더 연결 추가"}</h3>
      <div class="form-row"><label for="ks-kp">K 폴더 ${ui.tip("공유 안의 업무 폴더입니다. 목록은 Mac 에이전트가 하루 한 번 알려 준 폴더 이름(3단계까지)입니다. 더 깊은 폴더는 아래 칸에 경로를 직접 적으세요.", "K 폴더 설명")}</label>
        ${fl.length && !edit ? `<select id="ks-kp"><option value="">고르세요</option>${fl.map(f => `<option value="${esc(f.path)}">${esc("  ".repeat(Math.max(0, f.depth - 1)) + f.path.split("/").pop())} (${esc(String(f.n))})</option>`).join("")}</select>
          <input id="ks-kp-in" maxlength="200" autocomplete="off" placeholder="직접 적기 — 예: 안전보안/점검표/2025" aria-label="K 폴더 경로 직접 적기" value="${esc(kp0 || "")}">`
          : `<input id="ks-kp" value="${esc(m ? m.k_path : kp0 || "")}" maxlength="200" autocomplete="off" placeholder="예: 안전보안/점검표"${edit ? " disabled" : ""}>`}</div>
      <div class="form-row"><label for="ks-tg">화면 › 분류</label><select id="ks-tg"${edit ? " disabled" : ""}><option value="">고르세요</option>${opts}</select></div>
      <div class="form-row"><label for="ks-since">기준일 ${ui.tip("이 날(한국 시각 0시)보다 전에 고친 K 파일은 맞춘 적이 없으면 올리지 않습니다(건수만 셈). 비우면 모두 올립니다. 시작한 뒤에는 더 늦은 날로만 바꿀 수 있습니다.", "기준일 설명")}</label>
        <input id="ks-since" type="date" value="${esc((m && m.since) || "")}"${started && m.since ? ` min="${esc(m.since)}"` : ""}></div>
      <div class="form-grid">
        <div class="form-row"><label for="ks-dir">방향</label><select id="ks-dir">${Object.keys(DIR).map(k => `<option value="${k}"${(m ? m.dir : "both") === k ? " selected" : ""}>${esc(DIR[k])}</option>`).join("")}</select></div>
        <div class="form-row"><label class="au-opt ks-ssi"><input type="checkbox" id="ks-ssi"${m && m.ssi ? " checked" : ""}> 민감보안정보(SSI) 폴더 ${ui.tip("K 에서 온 문서를 민감보안정보로 등록하고(안전보안파트 이상 열람), H:drive 의 SSI 문서도 이 폴더로 보냅니다. SSI 가 아닌 연결은 SSI 문서를 보내지 않습니다.", "SSI 설명")}</label></div>
      </div>
      <div class="form-row"><label for="ks-ex">이 연결에서 뺄 폴더 ${ui.tip("연결 폴더 안의 경로를 한 줄에 하나씩(20개까지). 그 아래는 동기화하지 않고 '모름'으로 둡니다 — 이미 맞춘 H:drive 문서는 지우지 않고 그대로 남습니다.", "뺄 폴더 설명")}</label>
        <textarea id="ks-ex" rows="2" maxlength="4000" placeholder="예: 임시">${esc(((m && m.excludes) || []).join("\n"))}</textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">${edit ? "저장" : "미리보기 요청"}</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    // 목록에서 고르면 직접 적는 칸을 채운다(보낼 때는 그 칸 값 — 비었으면 고른 값)
    const kin = $("#ks-kp-in");
    if (kin) $("#ks-kp").onchange = () => { kin.value = $("#ks-kp").value; };
    $("#modal-box [data-act=ok]").onclick = async () => {
      // 덜 적었거나 없는 날(2025-02-30 등)이면 날짜 칸은 빈 값을 준다 — '기준일 없음'으로 보내지 않고 막는다
      const si = $("#ks-since");
      if (si.validity && si.validity.badInput) { toast(ERR.since, true); si.focus(); return; }
      const p = { dir: $("#ks-dir").value, ssi: $("#ks-ssi").checked };
      const since = String(si.value || "").trim(), ex = lines($("#ks-ex").value);
      if (edit) {
        p.id = m.id; if (since !== (m.since || "")) p.since = since;     // 바꿨을 때만 보낸다(키가 없으면 서버가 그대로 둠)
        if (ex.join("\n") !== ((m.excludes || []).join("\n"))) p.excludes = ex;
      } else {
        if (ex.length) p.excludes = ex;
        const kp = String((kin && kin.value.trim()) || $("#ks-kp").value || "").trim(), tg = String($("#ks-tg").value || "");
        if (!kp) { toast("K 폴더를 고르거나 적으세요.", true); (kin || $("#ks-kp")).focus(); return; }
        if (!tg) { toast("화면 · 분류를 고르세요.", true); $("#ks-tg").focus(); return; }
        Object.assign(p, { k_path: kp, mod: tg.split("|")[0], grp: tg.split("|")[1] });
        if (since) p.since = since;
      }
      const d = await act("semis_logi_ksync_map_save", { p }, edit ? "저장했습니다." : "연결했습니다 — Mac 이 다음에 확인할 때 미리보기 건수가 나옵니다. 건수를 보고 [시작]하세요.");
      if (d) closeModal();
    };
  }

  /* 발급 요청 중 — 창을 닫았다 다시 열어도 두 번째 키를 만들지 않는다(키 창은 응답이 오면 열린다) */
  let issuing = false;
  function keyNew() {
    if (issuing) { toast("키를 발급하는 중입니다 — 잠시 뒤 키 창이 열립니다."); return; }
    openModal(`<h3>에이전트 키 발급</h3>
      <div class="form-row"><label for="ks-kn">이름</label><input id="ks-kn" value="Mac" maxlength="40" autocomplete="off"></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">발급</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const btn = $("#modal-box [data-act=ok]");
    btn.onclick = async () => {
      if (issuing) return;
      issuing = true; btn.disabled = true;     // 두 번 누르면 키가 둘 — 첫 키는 원문을 볼 수 없다
      let d;
      try { d = await rpc("semis_logi_ksync_agent_new", { p_name: $("#ks-kn").value }); } catch (e) { btn.disabled = false; toast(errText(e), true); return; } finally { issuing = false; }
      if (!d || !d.ok || !/^[0-9a-f]{64}$/.test(d.key || "")) { btn.disabled = false; fail(d); return; }
      let key = d.key;
      openModal(`<h3>새 에이전트 키</h3>
        <p class="ks-keywarn">${icon("alert", 16)}<span>이 창을 닫으면 다시 볼 수 없습니다. Mac 에서 <b>tools/ksync/install.sh</b> 를 실행해 키체인에 넣으세요.</span></p>
        <div class="form-row"><label for="ks-key">키</label><input id="ks-key" class="mono" readonly value="${esc(key)}"></div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="copy">${icon("copy", 15)}<span>복사</span></button><button type="button" class="btn btn-primary" data-act="ok">닫기</button></div>`, { sticky: true });
      key = "";
      const inp = $("#ks-key");
      inp.onfocus = () => inp.select();
      $("#modal-box [data-act=copy]").onclick = () => {
        inp.select();
        const done = () => toast("복사했습니다. 붙여 넣은 뒤 클립보드를 비우세요.");
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done).catch(() => toast("직접 선택해 복사하세요.", true));
        else toast("직접 선택해 복사하세요.", true);
      };
      $("#modal-box [data-act=ok]").onclick = () => { inp.value = ""; closeModal(); load(false).then(paint); };
    };
  }
  function keyRevoke(id) {
    confirmModal("이 키를 폐기할까요? 그 키를 쓰는 Mac 은 바로 동기화할 수 없습니다.", () => act("semis_logi_ksync_agent_revoke", { p_id: id }, "폐기했습니다."));
  }
  function keyRevokePick() {
    const live = ((st.s && st.s.agents) || []).filter(a => !a.revoked_at);
    if (!live.length) { toast("사용 중인 키가 없습니다."); return; }
    if (live.length === 1) { keyRevoke(live[0].id); return; }
    st.secTab = "key"; paint();
    toast("폐기할 키를 '보안 › 에이전트 키'에서 고르세요.");
  }
  function dailyForm() {
    const cur = (st.s && st.s.state && st.s.state.daily_at) || "08:30";
    openModal(`<h3>매일 실행 시각</h3>
      <div class="form-row"><label for="ks-dt">매일 실행 시작 시각(30분 안에 시작) ${ui.tip("한국 시각으로 이 시각부터 30분 안에 Mac 이 하루 한 번 동기화합니다. K드라이브에 연결되지 않으면 5분 간격으로 3번 시도하고, 그래도 안 되면 다음 날 같은 때 다시 합니다. 창이 지난 뒤에는 그날 따라잡지 않습니다([지금 동기화 요청]은 언제든).", "시각 설명")}</label><input id="ks-dt" type="time" value="${esc(cur)}"></div>
      <p class="ks-note">Mac 이 시작 시각에 맞춰 깨어나는 것은 설치 때 시각(Mac 의 config.json 의 dailyAt)을 따르므로, 여기서 바꾸면 Mac 에서 그 값도 고치고 install.sh 를 다시 실행하세요(그대로 두어도 10분마다 깨어나 창 안에 시작합니다).</p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = async () => { const d = await act("semis_logi_ksync_settings", { p: { daily_at: $("#ks-dt").value } }, "저장했습니다."); if (d) closeModal(); };
  }
  function limitForm() {
    const ml = (st.s && st.s.state && st.s.state.mass_limit) || { files: 200, ratio: 0.3 };
    openModal(`<h3>대량 변경 한도</h3>
      <p class="ks-note">한 번의 실행에서 한 연결의 변경 · 삭제 대기가 이 한도를 넘으면 그 연결은 멈추고 승인을 기다립니다(비율은 20건 이상일 때만 봅니다).</p>
      <div class="form-grid"><div class="form-row"><label for="ks-lf">건수</label><input id="ks-lf" type="number" min="1" max="100000" value="${esc(String(ml.files))}"></div>
        <div class="form-row"><label for="ks-lr">비율(%)</label><input id="ks-lr" type="number" min="1" max="100" value="${esc(String(Math.round(Number(ml.ratio) * 100)))}"></div></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = async () => {
      const d = await act("semis_logi_ksync_settings", { p: { mass_limit: { files: Math.round(Number($("#ks-lf").value)), ratio: String(Math.round(Number($("#ks-lr").value)) / 100) } } }, "저장했습니다.");
      if (d) closeModal();
    };
  }
  /* 전체 지정 제외 — 공유 뿌리 기준 경로. 동기화도 '연결 안 된 폴더' 보고도 하지 않는다. 비어 있으면 그 전과 같다 */
  function exclForm() {
    const cur = (st.s && st.s.state && st.s.state.excludes) || [];
    openModal(`<h3>지정 제외</h3>
      <p class="ks-note">K드라이브에서 동기화하지도, '연결 안 된 폴더'로 알리지도 않을 폴더입니다. 그 아래에 이미 맞춘 H:drive 문서가 있어도 지우지 않고 그대로 둡니다(모름으로 둠). 연결 폴더 안의 일부만 빼려면 그 연결의 '뺄 폴더'에 넣으세요.</p>
      <div class="form-row"><label for="ks-exg">폴더 경로 ${ui.tip("공유 뿌리 기준 경로를 한 줄에 하나씩(20개까지). 예: 80 개인정보 · 99 보관. 이미 이은 연결 폴더를 덮는 경로는 넣을 수 없습니다.", "지정 제외 설명")}</label>
        <textarea id="ks-exg" rows="4" maxlength="4000" placeholder="80 개인정보&#10;99 보관">${esc(cur.join("\n"))}</textarea></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = async () => { const d = await act("semis_logi_ksync_settings", { p: { excludes: lines($("#ks-exg").value) } }, "저장했습니다."); if (d) closeModal(); };
  }
  function runDetail(id) {
    const r = (st.runs || []).find(x => x.id === id);
    if (!r) return;
    const det = Array.isArray(r.detail) ? r.detail : [];
    const A = { k2h: "K → H:drive", h2k: "H:drive → K", link: "연결만", rename: "이름 바꿈", del_k: "K 에서 지움", del_h: "H:drive 에서 지움", conflict: "충돌", skip: "건너뜀", error: "오류", trash: "휴지통", restore: "복원", held: "보류", drop: "기준선 정리" };
    openModal(`<h3>실행 ${esc(fmt(r.started_at))} · ${esc((RES[r.result || ""] || RES.fail)[0])}</h3>
      ${det.length ? `<div class="table-wrap ks-det"><table class="tbl ks-tbl"><thead><tr><th>파일</th><th>동작</th><th>이유</th></tr></thead><tbody>${det.map(d => `<tr><td data-role="title"><span class="ks-path">${esc(d.f || "")}</span><div class="cell-sub">${esc((mapOf(d.m) || {}).k_path || "")}</div></td><td>${esc(A[d.a] || d.a)}</td><td>${esc(why(d.r, d.m))}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="ks-none">${esc(r.msg || "기록한 줄이 없습니다.")}</p>`}
      <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="ok">닫기</button></div>`, { wide: true });
    $("#modal-box [data-act=ok]").onclick = closeModal;
  }
  /* 카드 하나만 A4 — 화면 인쇄(머리 · 출력일시)를 쓰고 다른 카드는 숨긴다 */
  function printCard(id) {
    const html = document.documentElement;
    const card = $(`[data-ks-card="${id}"]`);
    if (!card) return;
    html.classList.add("ks-printing"); card.classList.add("ks-print-on");
    const done = () => { html.classList.remove("ks-printing"); card.classList.remove("ks-print-on"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    SeMIS.printView("settings");
    const t = $("#print-head .ph-title");
    if (t) t.textContent = "K드라이브 동기화 — " + (id === "runs" ? "실행 기록" : "보안");
    setTimeout(done, 5000);
  }

  SeMIS.onRerender(() => { poll(false); });
  if (!isDom()) setInterval(tick, 10 * 60 * 1000);
  window.SemisKsync = { tab, badge, poll, load, paint, _tick: tick, get _st() { return st; } };
})();
