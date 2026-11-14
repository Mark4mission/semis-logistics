/* 교육 전파 · 서명 — 교육 자료를 올려 임직원 · 협력업체가 PC · 휴대폰(learn.html#코드)으로 이수하고 서명한다. 진행률 · 교육 실시 결과 기록부(A4 · 엑셀).
   SeMIS.data.learn = { courses[{ id, code, state(draft|open|closed), title, kind, overview, host, place, start, end, body, minSec, ssi,
     items[{ id, type(doc|image|video), name, size, url, dur, shots[](동영상 장면 그림 주소) }], targets{ groups[], add[], except[] }, excuse{ pid: 사유 }, dissem, createdAt/By, updatedAt/By }] }
   명단은 인원 관리(js/roster.js — SeMIS.data.roster). 그룹 = 에어제타 직원은 파트, 그 밖은 소속. 대상 판정은 서버(semis_logi_private.learn_is_target)와 같다.
   이수 기록 · 서명 그림은 비공개 표 — RPC semis_logi_learn_stats(manager) · _signs(manager) · _admin(hq) */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "learn", KEY = "learn";
  const TITLE = "교육 전파 · 서명";
  const R = () => window.SemisRoster;
  const SELF = "에어제타", TEAM = "인천화물팀";
  const KINDS = ["보안", "안전", "위험물", "기타"];
  const FILE_MAX = 50 * 1024 * 1024;
  const D = () => SeMIS.data;
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const L = () => (isObj(D()[KEY]) ? D()[KEY] : (D()[KEY] = { courses: [] }));
  const P = () => (R() ? R().data() : { people: [], orgs: [] });
  const courses = () => (Array.isArray(L().courses) ? L().courses : (L().courses = [])).filter(isObj);
  const people = () => (R() ? R().people() : []);
  const active = () => people().filter(p => !p.left);
  const md = () => window.SemisLearnMd;
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const p2 = (n) => String(n).padStart(2, "0");
  let fixedToday = "";
  const todayISO = () => fixedToday || (() => { const d = new Date(); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); })();
  const dot = (s) => (isISO(s) ? s.replace(/-/g, ".") : String(s || ""));
  const dayDiff = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
  const addDays = (iso, n) => { const t = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 864e5); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  const span = (a, b) => (a && b && a !== b ? dot(a) + " ~ " + dot(b).slice(5) : dot(a || b));
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const nkey = (s) => String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
  const uid = (p) => (p || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const who = () => (SeMIS.user && SeMIS.user.name) || "";
  const canW = () => SeMIS.canEdit();
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round((n || 0) / 1024)) + "KB");
  const mmss = (s) => { s = Math.round(s || 0); return s >= 60 ? Math.floor(s / 60) + "분" + (s % 60 ? " " + (s % 60) + "초" : "") : s + "초"; };
  /* 학습 주소 코드 — 공개 저장소에서 추측하지 못하게 무작위 12자(서버 형식 [a-z2-9]) */
  function newCode() {
    const A = "abcdefghjkmnpqrstuvwxyz23456789";
    const r = new Uint8Array(12);
    try { crypto.getRandomValues(r); } catch (e) { for (let i = 0; i < 12; i++) r[i] = Math.floor(Math.random() * 256); }
    return Array.from(r, b => A[b % A.length]).join("");
  }
  function learnUrl(code) {
    let base = "https://hdrive.kr/";
    try { if (location.protocol.indexOf("http") === 0) base = location.origin + location.pathname.replace(/[^/]*$/, ""); } catch (e) { /* 기본 주소 */ }
    return base + "learn.html#" + code;
  }

  /* ── 명단 · 그룹 — 인원 관리(js/roster.js)의 명단을 읽는다 ── */
  const groupOf = (p) => (R() ? R().groupOf(p) : "");
  const orgLabel = (p) => (R() ? R().orgLabel(p) : "");
  const groups = () => (R() ? R().groups() : []);
  const arrOf = (v) => (Array.isArray(v) ? v : []);
  function isTarget(c, p) {
    const t = (c && c.targets) || {};
    if (arrOf(t.add).indexOf(p.id) >= 0) return true;
    if (arrOf(t.except).indexOf(p.id) >= 0) return false;
    return arrOf(t.groups).indexOf(groupOf(p)) >= 0;
  }
  const targetCount = (c) => active().filter(p => isTarget(c, p)).length;

  /* ── 이수 기록(서버) ── */
  const S = { rows: null, at: 0, busy: null, err: "", signs: {} };
  const rpc = (name, args) => (window.SemisSync && SemisSync.rpc ? SemisSync.rpc(name, args) : Promise.reject(new Error("offline")));
  function loadStats(force) {
    if (S.busy) return S.busy;
    if (!force && S.rows && Date.now() - S.at < 60000) return Promise.resolve(false);
    if (SeMIS.roleRank() < 2) return Promise.resolve(false);
    S.busy = rpc("semis_logi_learn_stats", { p: {} }).then(d => {
      if (!d || !d.ok) throw new Error((d && d.error) || "stats");
      S.rows = Array.isArray(d.rows) ? d.rows : []; S.at = Date.now(); S.err = ""; return true;
    }).catch(e => { S.err = String((e && e.message) || e); if (!S.rows) S.rows = null; return false; })
      .then(v => { S.busy = null; return v; });
    return S.busy;
  }
  async function loadSigns(cid, force) {
    if (!force && S.signs[cid]) return S.signs[cid];
    const d = await rpc("semis_logi_learn_signs", { p_cid: cid });
    if (!d || !d.ok) throw new Error((d && d.error) || "signs");
    S.signs[cid] = isObj(d.signs) ? d.signs : {};
    return S.signs[cid];
  }
  const rowsOf = (c) => (S.rows || []).filter(r => r.cid === c.id && r.state !== "void");

  /* 진행 — 대상(명단) ∪ 이수한 사람(대상 밖 · 명단 외 포함) */
  function prog(c) {
    const rows = rowsOf(c), byPid = {};
    rows.forEach(r => { if (r.pid) byPid[r.pid] = r; });
    const ex = isObj(c.excuse) ? c.excuse : {};
    const mem = [];
    people().forEach(p => {
      const r = byPid[p.id], tg = !p.left && isTarget(c, p);
      if (!tg && !(r && r.state === "ok")) return;
      mem.push({ key: "p:" + p.id, pid: p.id, name: p.name, org: p.org || "", part: p.part || "", emp: p.emp || "", gender: p.gender || "", title: p.title || "",
        group: groupOf(p), tgt: tg, row: r || null, note: !r || r.state !== "ok" ? norm(ex[p.id]) : "" });
    });
    rows.filter(r => !r.pid || !people().some(p => p.id === r.pid)).forEach(r => {
      mem.push({ key: "r:" + r.rid, pid: "", name: r.name, org: r.org, part: r.part, emp: r.emp, gender: r.gender || "", title: "",
        group: groupOf(r), tgt: false, manual: !!r.manual, row: r, note: "" });
    });
    mem.forEach(m => { m.st = m.row && m.row.state === "ok" ? "ok" : m.note ? "excused" : m.row ? "start" : "todo"; });
    const by = new Map();
    mem.forEach(m => { if (!by.has(m.group)) by.set(m.group, { g: m.group, self: m.org === SELF, mem: [] }); by.get(m.group).mem.push(m); });
    const gl = Array.from(by.values()).sort((a, b) => (b.self - a.self) || a.g.localeCompare(b.g, "ko"));
    gl.forEach(g => { g.n = g.mem.length; g.ok = g.mem.filter(m => m.st === "ok").length; g.pct = g.n ? Math.round(g.ok / g.n * 100) : 0; });
    const ok = mem.filter(m => m.st === "ok").length;
    return { mem, groups: gl, n: mem.length, ok, start: mem.filter(m => m.st === "start").length, manual: mem.filter(m => m.manual).length,
      pct: mem.length ? Math.round(ok / mem.length * 100) : 0, loaded: !!S.rows };
  }
  function statusOf(c, t) {
    t = t || todayISO();
    if (c.state === "draft") return { k: "draft", label: "준비 중", tone: "gray" };
    if (c.state === "closed") return { k: "closed", label: "마감", tone: "gray" };
    if (isISO(c.start) && t < c.start) return { k: "soon", label: "예정", tone: "blue" };
    if (isISO(c.end) && t > c.end) return { k: "ended", label: "기간 끝남", tone: "orange" };
    return { k: "live", label: "진행 중", tone: "green" };
  }

  /* ── 상태 ── */
  let view = "list", sel = "", filt = "live", q = "", dq = "", dfilt = "all", dgrp = "", dtab = "mem";
  let edit = null;
  const memo = {};    // 올린 문서의 글(이 화면에서만 — AI 요약용)
  const cur = () => courses().find(c => c.id === sel) || null;
  function go(v, id) { view = v; if (id !== undefined) sel = id; if (location.hash.replace(/^#\//, "") === MOD) SeMIS.renderView(); else SeMIS.navigate(MOD); }

  /* ═════════ 목록 ═════════ */
  const pgBar = (pct) => `<span class="ln-pg" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`;
  function doneCell(c) {
    if (c.state === "draft") return `<span class="ln-dim">-</span>`;
    if (!S.rows) return `<span class="ln-dim">${S.err ? "불러오지 못함" : "불러오는 중"}</span>`;
    const g = prog(c);
    return `<span class="ln-done">${pgBar(g.pct)}<b class="mono">${g.ok}/${g.n}</b><span class="mono ln-dim">${g.pct}%</span></span>`;
  }
  function listRows() {
    const t = todayISO(), qq = q.toLowerCase();
    return courses().filter(c => {
      const s = statusOf(c, t).k;
      if (filt === "live" && s !== "live") return false;
      if (filt === "soon" && s !== "soon") return false;
      if (filt === "end" && s !== "ended" && s !== "closed") return false;
      if (filt === "draft" && s !== "draft") return false;
      return !qq || [c.title, c.kind, c.host, c.overview].join(" ").toLowerCase().indexOf(qq) >= 0;
    }).sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }
  function listBody() {
    const rs = listRows();
    if (!rs.length) return ui.empty(q ? "검색 결과가 없습니다." : filt === "live" ? "진행 중인 교육이 없습니다." : "해당하는 교육이 없습니다.",
      canW() && !courses().length ? `<button type="button" class="btn btn-primary btn-sm" data-ln-new>${icon("plus", 15)}<span>새 교육</span></button>` : "");
    const t = todayISO();
    return `<div class="table-wrap"><table class="tbl ln-tbl"><thead><tr><th>교육명</th><th>구분</th><th>기간</th><th>대상</th><th>완료</th><th>상태</th></tr></thead><tbody>
      ${rs.map(c => { const s = statusOf(c, t), d = s.k === "live" && isISO(c.end) ? dayDiff(t, c.end) : null;
        return `<tr class="is-click" data-ln="${esc(c.id)}"><td data-role="title"><button type="button" class="ln-tl" data-ln="${esc(c.id)}">${esc(c.title || "(제목 없음)")}</button></td>
          <td>${c.kind ? ui.chip(c.kind, c.kind === "안전" ? "amber" : c.kind === "보안" ? "blue" : "gray") : ""}</td>
          <td class="mono">${esc(span(c.start, c.end))}${d != null && d <= 3 ? ` <span class="ln-dd">${d ? "D-" + d : "오늘 마감"}</span>` : ""}</td>
          <td class="mono">${S.rows && c.state !== "draft" ? prog(c).n : targetCount(c)}</td><td>${doneCell(c)}</td><td>${ui.chip(s.label, s.tone)}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  }
  function listView(root) {
    const t = todayISO(), cs = courses();
    const live = cs.filter(c => statusOf(c, t).k === "live");
    const near = live.filter(c => isISO(c.end) && dayDiff(t, c.end) <= 3).length;
    const pcts = S.rows ? live.map(c => prog(c)) : [];
    const avg = pcts.length ? Math.round(pcts.reduce((n, g) => n + g.ok, 0) / Math.max(1, pcts.reduce((n, g) => n + g.n, 0)) * 100) : null;
    const nog = active().filter(p => !p.gender).length;
    const segs = [["live", "진행 중"], ["soon", "예정"], ["end", "끝남"], ["draft", "준비 중"], ["all", "전체"]];
    root.innerHTML = ui.head({ title: TITLE, meta: "기준 " + dot(t),
      actions: (canW() ? `<button type="button" class="btn btn-primary" data-ln-new>${icon("plus", 17)}<span>새 교육</span></button>` : "")
        + `<button type="button" class="btn btn-ghost ph-rare" id="ln-to-roster">${icon("users", 16)}<span>인원 관리</span></button>` })
      + ui.stats([
        { label: "진행 중", value: live.length, sub: near ? "3일 안 마감 " + near : "" , tone: near ? "warn" : "" },
        { label: "진행 중 완료율", value: avg == null ? "-" : avg + "%", tone: avg == null ? "" : avg >= 90 ? "ok" : "warn" },
        { label: "전체 교육", value: cs.length },
        { label: "명단(인원 관리)", value: active().length + "명", sub: nog ? "성별 미입력 " + nog : "", tone: nog ? "warn" : "" }
      ])
      + `<section class="card" id="ln-list"><div class="toolbar">${ui.search("ln-q", "교육명 검색", q)}
          <div class="seg" role="group" aria-label="상태">${segs.map(([k, lb]) => `<button type="button" class="seg-btn" data-lnf="${k}" aria-pressed="${filt === k}">${lb}</button>`).join("")}</div></div>
        <div id="ln-list-b">${listBody()}</div></section>`;
    const qi = $("#ln-q", root);
    qi.oninput = () => { const v = ui.searchValue(qi.value); if (v === q) return; q = v; $("#ln-list-b", root).innerHTML = listBody(); wireRows(root); };
    $$("[data-lnf]", root).forEach(b => b.onclick = () => { filt = b.dataset.lnf; SeMIS.renderView(); });
    $("#ln-to-roster", root).onclick = () => SeMIS.navigate("roster");
    wireRows(root);
    if (!S.rows || Date.now() - S.at > 60000) loadStats().then(ch => { if (ch && view === "list" && routeIs()) { $("#ln-list-b", root) && SeMIS.renderView(); } });
  }
  const routeIs = () => location.hash.replace(/^#\//, "") === MOD;
  function wireRows(root) {
    $$("[data-ln-new]", root).forEach(b => b.onclick = () => openEdit(""));
    $$("[data-ln]", root).forEach(el => el.onclick = (ev) => { ev.stopPropagation(); go("detail", el.dataset.ln); });
  }

  /* ═════════ 상세 ═════════ */
  const ST_LB = { ok: ["완료", "green"], start: ["진행 중", "blue"], excused: ["사유", "amber"], todo: ["미완료", "gray"] };
  function memRows(c, g) {
    const qq = dq.toLowerCase();
    return g.mem.filter(m => (dfilt === "all" || (dfilt === "ok" && m.st === "ok") || (dfilt === "todo" && m.st !== "ok") || (dfilt === "man" && (m.manual || !m.tgt)))
      && (!dgrp || m.group === dgrp) && (!qq || [m.name, m.org, m.part, m.emp].join(" ").toLowerCase().indexOf(qq) >= 0))
      .sort((a, b) => (a.st === "ok") - (b.st === "ok") || a.group.localeCompare(b.group, "ko") || a.name.localeCompare(b.name, "ko"));
  }
  function memBody(c, g) {
    if (!g.loaded) return ui.empty(S.err ? "이수 기록을 불러오지 못했습니다." : "이수 기록을 불러오는 중입니다.");
    const rs = memRows(c, g), signs = S.signs[c.id] || {};
    if (!rs.length) return ui.empty(g.n ? "조건에 맞는 사람이 없습니다." : "대상이 없습니다. 교육 수정에서 대상을 고르세요.");
    return `<div class="table-wrap"><table class="tbl ln-mem"><thead><tr><th>이름</th><th>소속</th><th>사번</th><th>상태</th><th>완료 일시</th><th>서명</th>${canW() ? "<th></th>" : ""}</tr></thead><tbody>
      ${rs.map(m => { const lb = ST_LB[m.st], r = m.row;
        return `<tr><td data-role="title"><b>${esc(m.name)}</b>${m.manual ? ` ${ui.chip("명단 외", "orange")}` : !m.tgt ? ` ${ui.chip("대상 외", "purple")}` : ""}</td>
          <td>${esc(m.group)}${m.org !== SELF && m.org !== m.group ? "" : ""}</td><td class="mono">${esc(m.emp || "-")}</td>
          <td>${ui.chip(lb[0], lb[1])}${m.note ? ` <span class="ln-dim">${esc(m.note)}</span>` : ""}</td>
          <td class="mono">${esc(r && r.at ? r.at.slice(2).replace(/-/g, ".") : r && r.state === "start" ? "시작 " + String(r.start || "").slice(5).replace(/-/g, ".") : "")}</td>
          <td>${r && r.state === "ok" && signs[r.rid] ? `<img class="ln-sg" src="${esc(signs[r.rid])}" alt="${esc(m.name)} 서명">` : ""}</td>
          ${canW() ? `<td class="td-act"><button type="button" class="mt-btn" data-lnm="${esc(m.key)}" title="${esc(m.name)} 관리" aria-label="${esc(m.name)} 관리">${icon("more", 16)}</button></td>` : ""}</tr>`; }).join("")}
    </tbody></table></div>`;
  }
  function grpBody(g) {
    if (!g.loaded) return ui.empty("이수 기록을 불러오는 중입니다.");
    if (!g.groups.length) return ui.empty("대상이 없습니다.");
    return `<div class="table-wrap"><table class="tbl ln-grp"><thead><tr><th>파트 · 소속</th><th>대상</th><th>완료</th><th>진행 중</th><th>미완료</th><th>완료율</th></tr></thead><tbody>
      ${g.groups.map(x => { const st = x.mem.filter(m => m.st === "start").length;
        return `<tr class="is-click" data-lng="${esc(x.g)}"><td data-role="title"><button type="button" class="ln-tl" data-lng="${esc(x.g)}">${esc(x.g)}</button></td><td class="mono">${x.n}</td><td class="mono">${x.ok}</td><td class="mono">${st}</td>
          <td class="mono">${x.n - x.ok - st}</td><td><span class="ln-done">${pgBar(x.pct)}<span class="mono">${x.pct}%</span></span></td></tr>`; }).join("")}
    </tbody></table></div>`;
  }
  function itemLine(it) {
    const tp = { doc: "문서", image: "사진", video: "동영상" }[it.type] || "파일";
    return `<li><span class="ln-it-k">${tp}</span><a class="nb-file" href="${esc(it.url)}" target="_blank" rel="noopener" data-name="${esc(it.name)}">${esc(it.name)}</a><span class="ln-dim mono">${kb(it.size)}${it.dur ? " · " + mmss(it.dur) : ""}</span></li>`;
  }
  function detailView(root) {
    const c = cur();
    if (!c) { view = "list"; listView(root); return; }
    const t = todayISO(), s = statusOf(c, t), g = prog(c);
    const dv = c.dissem && window.SemisDissem && arrOf(D().dissem && D().dissem.events).find(e => e && e.id === c.dissem);
    const rare = (id, ic, lb) => `<button type="button" class="btn btn-ghost ph-rare" data-lnx="${id}">${icon(ic, 16)}<span>${lb}</span></button>`;
    root.innerHTML = ui.head({ title: c.title || "(제목 없음)", meta: [c.kind ? c.kind + " 교육" : "", span(c.start, c.end)].filter(Boolean).join(" · "),
      actions: `<button type="button" class="btn btn-ghost" id="ln-back">${icon("chevl", 16)}<span>목록</span></button>`
        + (canW() ? `<button type="button" class="btn btn-primary" data-lnx="link">${icon("link", 17)}<span>주소 · QR</span></button>` : "")
        + (canW() ? rare("edit", "edit", "수정") : "")
        + rare("xlsx", "down", "기록부 엑셀")
        + (canW() && c.state === "open" ? rare("close", "lock", "마감") : "")
        + (canW() && c.state === "closed" ? rare("reopen", "refresh", "다시 열기") : "")
        + (canW() ? rare("del", "trash", "삭제") : "")
        + `<button type="button" class="btn btn-ghost btn-sm no-print" data-print-btn="1" id="ln-print">${icon("print", 17)}<span>인쇄</span></button>` })
      + ui.stats([
        { label: "상태", value: s.label, sub: s.k === "live" && isISO(c.end) ? "마감 " + dot(c.end).slice(5) : "" },
        { label: "대상", value: g.loaded ? g.n + "명" : "-", sub: g.loaded && g.manual ? "명단 외 " + g.manual : "" },
        { label: "완료", value: g.loaded ? g.ok + "명" : "-", sub: g.loaded && g.start ? "진행 중 " + g.start : "", tone: g.loaded ? (g.ok === g.n && g.n ? "ok" : "") : "" },
        { label: "완료율", value: g.loaded ? g.pct + "%" : "-", tone: g.loaded && g.n ? (g.pct >= 90 ? "ok" : "warn") : "" }
      ])
      + `<section class="card" id="ln-prog"><h2 class="card-title"><span class="ct-t">진행 현황</span></h2>
          ${ui.tabs("lnd", [["mem", "대상자"], ["grp", "파트 · 소속별"]], dtab)}
          ${ui.pane("lnd", "mem", dtab, `<div class="toolbar">${ui.search("ln-dq", "이름 · 사번 검색", dq)}
              <div class="seg" role="group" aria-label="상태">${[["all", "전체"], ["ok", "완료"], ["todo", "미완료"], ["man", "명단 · 대상 외"]].map(([k, lb]) => `<button type="button" class="seg-btn" data-lndf="${k}" aria-pressed="${dfilt === k}">${lb}</button>`).join("")}</div>
              <label class="ck-f"><span class="m-hide">파트</span><select id="ln-dgrp" aria-label="파트 · 소속"><option value="">전체</option>${g.groups.map(x => `<option ${x.g === dgrp ? "selected" : ""}>${esc(x.g)}</option>`).join("")}</select></label></div>
            <div id="ln-mem-b">${memBody(c, g)}</div>`)}
          ${ui.pane("lnd", "grp", dtab, grpBody(g))}
        </section>
        <section class="card ln-info"><h2 class="card-title"><span class="ct-t">교육 내용</span>${c.ssi ? ` ${ui.chip("민감보안정보", "red")}` : ""}</h2>
          <dl class="ln-dl"><dt>교육 주관</dt><dd>${esc(c.host || "-")}</dd><dt>장소</dt><dd>${esc(c.place || "-")}</dd>${c.offline ? "<dt>방식</dt><dd>집체 교육 · 서명만</dd>" : `<dt>최소 학습 시간</dt><dd>${mmss(c.minSec || 0)}</dd>`}
            ${dv ? `<dt>보안 전파교육</dt><dd>${esc(dot(dv.date) + " " + (dv.title || ""))}</dd>` : ""}</dl>
          ${c.overview ? `<p class="ln-ov">${esc(c.overview)}</p>` : ""}
          <div class="ln-sum">${md() ? md().html(RC(c).body || "") : esc(RC(c).body || "")}</div>
          ${arrOf(RC(c).items).length ? `<ul class="ln-items">${arrOf(RC(c).items).map(itemLine).join("")}</ul>` : ""}
          ${arrOf(c.photos).length ? `<p class="ln-dim">교육 장면 사진 ${arrOf(c.photos).length}장(기록부에 들어갑니다)</p>` : ""}
        </section>`;
    $("#ln-back", root).onclick = () => go("list");
    $("#ln-print", root).onclick = () => printRecord(c);
    $$("[data-lnx]", root).forEach(b => b.onclick = () => act(c, b.dataset.lnx));
    ui.wireTabs(root, "lnd", (id) => { dtab = id; });
    const di = $("#ln-dq", root);
    const repaint = () => { const box = $("#ln-mem-b", root); if (box) { box.innerHTML = memBody(c, prog(c)); wireMem(root, c); } };
    di.oninput = () => { const v = ui.searchValue(di.value); if (v === dq) return; dq = v; repaint(); };
    $$("[data-lndf]", root).forEach(b => b.onclick = () => { dfilt = b.dataset.lndf; $$("[data-lndf]", root).forEach(x => x.setAttribute("aria-pressed", String(x === b))); repaint(); });
    $("#ln-dgrp", root).onchange = (ev) => { dgrp = ev.target.value; repaint(); };
    $$("[data-lng]", root).forEach(el => el.onclick = (ev) => { ev.stopPropagation(); dgrp = el.dataset.lng; dtab = "mem"; SeMIS.renderView(); });
    wireMem(root, c);
    const need = !S.rows || Date.now() - S.at > 60000;
    Promise.all([need ? loadStats() : Promise.resolve(false), c.state !== "draft" && !S.signs[c.id] ? loadSigns(c.id).then(() => true, () => false) : Promise.resolve(false)])
      .then(([a, b]) => { if ((a || b) && view === "detail" && sel === c.id && routeIs()) SeMIS.renderView(); });
  }
  function wireMem(root, c) {
    $$("[data-lnm]", root).forEach(b => b.onclick = () => memMenu(c, b.dataset.lnm));
  }
  function memMenu(c, key) {
    const m = prog(c).mem.find(x => x.key === key);
    if (!m || !canW()) return;
    const r = m.row;
    const opts = [];
    if (m.pid && m.st !== "ok") opts.push(["note", m.note ? "미실시 사유 고치기" : "미실시 사유 적기"]);
    if (r && r.state === "ok") opts.push(["void", "이수 무효(다시 받기)"]);
    if (r && !m.pid) opts.push(["link", "명단 사람과 연결"]);
    if (!opts.length) { toast("할 수 있는 작업이 없습니다."); return; }
    openModal(`<h3>${esc(m.name)} <small class="ln-dim">${esc(m.group)}</small></h3>
      <div class="ln-acts">${opts.map(([k, lb]) => `<button type="button" class="btn btn-ghost" data-mk="${k}">${esc(lb)}</button>`).join("")}</div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $$("#modal-box [data-mk]").forEach(b => b.onclick = () => {
      const k = b.dataset.mk;
      if (k === "note") return noteForm(c, m);
      if (k === "void") return confirmModal(m.name + "님의 이수를 무효로 할까요? 다시 학습 · 서명해야 완료됩니다.", () => adminAct({ act: "void", rid: r.rid }));
      if (k === "link") return linkPerson(c, m);
    });
  }
  function noteForm(c, m) {
    const ex = isObj(c.excuse) ? c.excuse : {};
    openModal(`<h3>미실시 사유 — ${esc(m.name)}</h3>
      <div class="form-row"><label for="ln-note">사유</label><input id="ln-note" maxlength="20" placeholder="예: 병가 · 출장 · 휴직" value="${esc(ex[m.pid] || "")}"></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">저장</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const v = norm($("#ln-note").value).slice(0, 20);
      if (!isObj(c.excuse)) c.excuse = {};
      if (v) c.excuse[m.pid] = v; else delete c.excuse[m.pid];
      c.updatedAt = new Date().toISOString(); c.updatedBy = who();
      SeMIS.save(); closeModal(); SeMIS.renderView();
    };
  }
  function linkPerson(c, m) {
    const cand = active().filter(p => nkey(p.name) === nkey(m.name)).concat(active().filter(p => nkey(p.name) !== nkey(m.name) && p.org === m.org).slice(0, 30));
    openModal(`<h3>명단 사람과 연결 — ${esc(m.name)}</h3>
      <div class="form-row"><label for="ln-lk">명단</label><select id="ln-lk">${cand.map(p => `<option value="${esc(p.id)}">${esc(p.name + " · " + orgLabel(p) + (p.emp ? " · " + p.emp : ""))}</option>`).join("") || '<option value="">맞는 사람이 없습니다</option>'}</select></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok" ${cand.length ? "" : "disabled"}>연결</button></div>`);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => { const pid = $("#ln-lk").value; if (pid) adminAct({ act: "link", rid: m.row.rid, pid }); };
  }
  async function adminAct(p) {
    try {
      const d = await rpc("semis_logi_learn_admin", { p });
      if (!d || !d.ok) throw new Error((d && d.error) || "admin");
      closeModal(); toast("반영했습니다.");
      S.at = 0; delete S.signs[sel];
      await loadStats(true);
      SeMIS.renderView();
    } catch (e) { toast(String(e.message) === "dup" ? "그 사람은 이미 이수 기록이 있습니다." : "반영하지 못했습니다.", true); }
  }
  function act(c, k) {
    if (k === "link") return linkModal(c);
    if (k === "edit") return openEdit(c.id);
    if (k === "xlsx") return exportXlsx(c);
    if (k === "dissem") return dissemApply(c);
    if (k === "close") return confirmModal("교육을 마감할까요? 학습 주소로 더 이상 이수할 수 없습니다.", () => { setState(c, "closed"); });
    if (k === "reopen") return setState(c, "open");
    if (k === "del") return confirmModal("이 교육을 지울까요? 이수 기록 · 서명도 함께 지워집니다.", async () => {
      const id = c.id;
      L().courses = courses().filter(x => x.id !== id);
      SeMIS.save();
      try { await rpc("semis_logi_learn_admin", { p: { act: "purge", cid: id } }); } catch (e) { /* 다음에 다시 정리 */ }
      go("list", "");
    });
  }
  function setState(c, st) {
    if (!canW()) return;
    c.state = st; c.updatedAt = new Date().toISOString(); c.updatedBy = who();
    SeMIS.save(); toast(st === "open" ? "교육을 열었습니다." : st === "closed" ? "교육을 마감했습니다." : "저장했습니다."); SeMIS.renderView();
  }

  /* 주소 · QR */
  function linkModal(c) {
    if (!canW()) return;
    const url = learnUrl(c.code), Q = window.SemisQR;
    openModal(`<h3>교육 주소 · QR <small class="ln-dim">${esc(c.title)}</small></h3>
      ${c.state !== "open" ? `<p class="ln-warn">${c.state === "draft" ? "아직 준비 중입니다. 교육을 열어야 이 주소로 들어올 수 있습니다." : "마감된 교육입니다."}</p>` : ""}
      <div class="ln-link"><div class="ln-qr">${Q ? Q.svg(url, { ecc: "M", size: 200, margin: 2 }) : ""}</div>
        <div class="ln-link-r"><code class="ln-url mono" id="ln-url">${esc(url)}</code>
          <div class="ln-acts"><button type="button" class="btn btn-ghost btn-sm" id="ln-copy">${icon("copy", 15)}<span>주소 복사</span></button>
            <a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">${icon("external", 15)}<span>이 기기에서 교육 받기</span></a>
            <button type="button" class="btn btn-ghost btn-sm" id="ln-qrp">${icon("print", 15)}<span>QR 안내문 인쇄</span></button></div>
          <p class="ln-dim">${esc(span(c.start, c.end))} · 대상 ${targetCount(c)}명</p></div></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">닫기</button>
        ${c.state === "draft" ? `<button type="button" class="btn btn-primary" id="ln-open">교육 열기</button>` : ""}</div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#ln-copy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("주소를 복사했습니다."); } catch (e) { toast("복사하지 못했습니다. 주소를 직접 선택해 복사하세요.", true); } };
    $("#ln-qrp").onclick = () => printQR(c, url);
    const op = $("#ln-open");
    if (op) op.onclick = () => {
      if (!isISO(c.start) || !isISO(c.end)) { toast("교육 기간을 먼저 정하세요.", true); return; }
      if (!c.offline && !String(c.body || "").trim() && !arrOf(c.items).length) { toast("교육 내용을 먼저 넣으세요.", true); return; }
      c.state = "open"; c.updatedAt = new Date().toISOString(); c.updatedBy = who();
      SeMIS.save(); toast("교육을 열었습니다."); linkModal(c); SeMIS.renderView();
    };
  }

  /* 보안 전파교육 이행표 — 파트별 완료 현황을 전파교육 건의 파트 칸으로 */
  const DV_KEY = (g) => { const m = /\(([^)]+)\)\s*$/.exec(g); return norm(m ? m[1] : g).replace(/파트$|팀$/, ""); };
  function dvGuess(g, depts) {
    const k = DV_KEY(g);
    const hit = depts.find(d => norm(d.label).replace(/\s*\(.*\)$/, "") === k) || depts.find(d => k && (norm(d.label).indexOf(k) >= 0 || k.indexOf(norm(d.label).replace(/\s*\(.*\)$/, "")) >= 0));
    return hit ? hit.id : "";
  }
  function dissemApply(c) {
    const ev = arrOf(D().dissem && D().dissem.events).find(e => e && e.id === c.dissem);
    if (!ev || !canW()) return;
    const depts = (window.SemisDissem && arrOf(D().dissem.depts).length ? D().dissem.depts : (window.SemisDissem ? SemisDissem.DEF_DEPTS : [])).filter(Boolean);
    const g = prog(c);
    const gs = g.groups.filter(x => x.ok);
    if (!gs.length) { toast("아직 완료한 사람이 없습니다.", true); return; }
    openModal(`<h3>전파교육 이행표 반영 <small class="ln-dim">${esc(ev.title || "")}</small></h3>
      <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>파트 · 소속</th><th>완료</th><th>이행표 칸</th></tr></thead><tbody>
      ${gs.map((x, i) => `<tr><td><input type="checkbox" data-dvi="${i}" ${x.ok === x.n ? "checked" : ""} aria-label="${esc(x.g)} 반영"></td><td>${esc(x.g)}</td><td class="mono">${x.ok}/${x.n}</td>
        <td><select data-dvs="${i}" aria-label="${esc(x.g)} 이행표 칸"><option value="">-</option>${depts.map(d => `<option value="${esc(d.id)}" ${dvGuess(x.g, depts) === d.id ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select></td></tr>`).join("")}
      </tbody></table></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-act="cancel">취소</button><button type="button" class="btn btn-primary" data-act="ok">반영</button></div>`, { wide: true });
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      let n = 0;
      if (!isObj(ev.res)) ev.res = {};
      gs.forEach((x, i) => {
        const on = $(`#modal-box [data-dvi="${i}"]`).checked, d = $(`#modal-box [data-dvs="${i}"]`).value;
        if (!on || !d) return;
        const last = x.mem.filter(m => m.st === "ok" && m.row && m.row.at).map(m => m.row.at.slice(0, 10)).sort().pop() || todayISO();
        const prev = isObj(ev.res[d]) ? ev.res[d] : {};
        ev.res[d] = Object.assign({}, prev, { date: last, note: "온라인 이수 " + x.ok + "/" + x.n + " (H:drive 교육 전파)", files: arrOf(prev.files) });
        if (arrOf(ev.targets).length && ev.targets.indexOf(d) < 0) ev.targets.push(d);
        n++;
      });
      if (!n) { toast("반영할 칸을 고르세요.", true); return; }
      SeMIS.save(); closeModal(); toast("이행표 " + n + "칸에 반영했습니다.");
    };
  }

  /* ═════════ 만들기 · 고치기 ═════════ */
  /* 집체 교육(offline) — 학습 화면에는 내용을 보내지 않고(body · items 비움 → 이름 확인 뒤 바로 서명),
     기록부에 넣을 내용은 recBody · recItems 에 둔다. 화면 · 기록부는 RC(c) 로 읽는다 */
  const RC = (c) => (c && c.offline ? Object.assign({}, c, { body: c.recBody || "", items: arrOf(c.recItems) }) : c);
  function blank() {
    const t = todayISO();
    return { id: "", code: "", state: "draft", title: "", kind: "보안", overview: "", host: "안전보안파트", place: "온라인(H:drive)", start: t, end: addDays(t, 7),
      body: "", minSec: 0, ssi: false, offline: false, items: [], photos: [], targets: { groups: [], add: [], except: [] }, excuse: {}, dissem: "" };
  }
  function openEdit(id) {
    if (!canW()) return;
    const c = id ? courses().find(x => x.id === id) : null;
    edit = JSON.parse(JSON.stringify(c || blank()));
    edit.targets = isObj(edit.targets) ? edit.targets : { groups: [], add: [], except: [] };
    ["groups", "add", "except"].forEach(k => { edit.targets[k] = arrOf(edit.targets[k]).slice(); });
    if (edit.offline) { edit.body = edit.recBody || ""; edit.items = arrOf(edit.recItems); }
    delete edit.recBody; delete edit.recItems;
    edit.items = arrOf(edit.items).slice();
    edit.photos = arrOf(edit.photos).slice();
    edit._auto = !c || !c.minSec;
    go("edit", id || "");
  }
  const autoMin = (e) => {
    const vid = arrOf(e.items).filter(i => i.type === "video").reduce((n, i) => n + (Number(i.dur) || 0), 0);
    const rd = md() ? md().readSec(e.body || "") : 30;
    // 동영상은 1.2배속 시청을 허용하므로 길이의 80% 만 센다(서버는 최소 시간의 90% 를 확인)
    return Math.min(3600, Math.ceil((rd + vid * 0.8) / 10) * 10);
  };
  function tgtSummary(e) {
    const n = active().filter(p => isTarget(e, p)).length;
    return `대상 <b class="mono">${n}</b>명` + (e.targets.add.length ? ` · 개별 추가 ${e.targets.add.length}` : "") + (e.targets.except.length ? ` · 제외 ${e.targets.except.length}` : "");
  }
  let tq = "";
  function tgtPeople(e) {
    const qq = nkey(tq);
    if (!qq) return "";
    const ps = active().filter(p => [p.name, p.org, p.part, p.emp].map(nkey).join(" ").indexOf(qq) >= 0).slice(0, 30);
    if (!ps.length) return `<p class="ln-dim">찾는 사람이 없습니다.</p>`;
    return `<ul class="ln-tp">${ps.map(p => `<li><label><input type="checkbox" data-tp="${esc(p.id)}" ${isTarget(e, p) ? "checked" : ""}> <b>${esc(p.name)}</b> <span class="ln-dim">${esc(orgLabel(p))}${p.emp ? " · " + esc(p.emp) : ""}</span></label></li>`).join("")}</ul>`;
  }
  function itemRow(it, i) {
    const tp = { doc: "문서", image: "사진", video: "동영상" }[it.type] || "파일";
    return `<li><span class="ln-it-k">${tp}</span><span class="ln-it-n">${esc(it.name)}</span><span class="ln-dim mono">${kb(it.size)}${it.dur ? " · " + mmss(it.dur) : ""}</span>
      <span class="ln-it-a">${i ? `<button type="button" class="mt-btn" data-iu="${i}" title="위로" aria-label="${esc(it.name)} 위로">${icon("chevup", 15)}</button>` : ""}<button type="button" class="mt-btn" data-ix="${i}" title="빼기" aria-label="${esc(it.name)} 빼기">${icon("x", 15)}</button></span></li>`;
  }
  const photoRow = (it, i) => `<li><span class="ln-it-k">사진</span><span class="ln-it-n">${esc(it.name)}</span><span class="ln-dim mono">${kb(it.size)}</span>
      <span class="ln-it-a"><button type="button" class="mt-btn" data-px="${i}" title="빼기" aria-label="${esc(it.name)} 빼기">${icon("x", 15)}</button></span></li>`;
  function paintPhotos(root) {
    const ul = $("#le-photos", root); if (!ul) return;
    ul.innerHTML = edit.photos.map(photoRow).join("");
    $$("[data-px]", ul).forEach(b => b.onclick = () => { edit.photos.splice(Number(b.dataset.px), 1); paintPhotos(root); });
  }
  async function addPhotos(root, files) {
    if (!files.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const f of files) {
      if (edit.photos.length >= 4) { toast("사진은 4장까지 넣습니다.", true); break; }
      if (typeOf(f) !== "image") { toast(f.name + " — 사진 파일만 넣습니다.", true); continue; }
      if (f.size > FILE_MAX) { toast(f.name + " — 50MB 를 넘습니다.", true); continue; }
      toast(f.name + " 올리는 중…");
      try { const up = await SemisSync.uploadFile(f, "learn"); edit.photos.push({ id: uid("lp"), name: up.name, size: up.size, url: up.url }); paintPhotos(root); }
      catch (e) { toast(f.name + " — 올리지 못했습니다.", true); }
    }
  }
  function editView(root) {
    const e = edit;
    if (!e) { view = "list"; listView(root); return; }
    const gs = groups();
    const dvs = arrOf(D().dissem && D().dissem.events).filter(Boolean).sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 60);
    const am = autoMin(e);
    root.innerHTML = ui.head({ title: e.id ? "교육 수정" : "새 교육", meta: e.id ? e.title : "",
      actions: `<button type="button" class="btn btn-ghost" id="ln-ecancel">취소</button><button type="button" class="btn btn-primary" id="ln-esave">${icon("check", 17)}<span>저장</span></button>` })
      + `<section class="card ln-form"><h2 class="card-title"><span class="ct-t">기본 정보</span></h2>
        <div class="ln-grid">
          <div class="form-row ln-span2"><label for="le-title">교육명</label><input id="le-title" maxlength="80" value="${esc(e.title)}" placeholder="예: 11월 협력업체 합동안전보건협의체 결과"></div>
          <div class="form-row"><label>구분</label><div class="seg" role="group" aria-label="구분">${KINDS.map(k => `<button type="button" class="seg-btn" data-lek="${k}" aria-pressed="${e.kind === k}">${k}</button>`).join("")}</div></div>
          <div class="form-row"><label>방식 ${ui.tip ? ui.tip("집체 교육은 교육장에서 QR 로 이름 확인 뒤 바로 서명만 받습니다. 교육 내용 · 사진은 끝난 뒤에 넣어 기록부로 인쇄합니다.") : ""}</label><div class="seg" role="group" aria-label="방식"><button type="button" class="seg-btn" data-lem="0" aria-pressed="${!e.offline}">온라인 학습</button><button type="button" class="seg-btn" data-lem="1" aria-pressed="${!!e.offline}">집체 교육(서명만)</button></div></div>
          <div class="form-row"><label for="le-start">교육 기간</label><div class="ln-dates"><input type="date" id="le-start" value="${esc(e.start)}"><span>~</span><input type="date" id="le-end" value="${esc(e.end)}" aria-label="마감일"></div></div>
          <div class="form-row"><label for="le-host">교육 주관</label><input id="le-host" maxlength="60" value="${esc(e.host)}"></div>
          <div class="form-row"><label for="le-place">장소</label><input id="le-place" maxlength="60" value="${esc(e.place)}"></div>
          <div class="form-row ln-span2"><label for="le-ov">개요 ${ui.tip ? ui.tip("학습 첫 화면에 제목과 함께 보이는 2~3줄 안내입니다.") : ""}</label><textarea id="le-ov" rows="3" maxlength="600">${esc(e.overview)}</textarea></div>
          <label class="ln-ck ln-span2"><input type="checkbox" id="le-ssi" ${e.ssi ? "checked" : ""}> 민감보안정보(SSI) — AI 요약을 쓰지 않고 직접 작성</label>
        </div></section>
      <section class="card ln-form"><h2 class="card-title"><span class="ct-t">${e.offline ? "교육 내용(기록부용)" : "교육 자료 · 요약"}</span></h2>
        ${e.offline ? `<p class="ln-dim ln-note">집체 교육 — 아래 내용은 학습 화면에 나오지 않고 기록부 '교육 내용' 칸에만 들어갑니다. 교육이 끝난 뒤에 고쳐도 됩니다.</p>` : ""}
        <label class="ln-drop" id="le-drop"><input type="file" id="le-file" multiple hidden accept=".pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*,video/mp4,video/webm,video/quicktime">
          ${icon("clip", 22)}<span><b>파일을 끌어다 놓거나 눌러서 고르기</b><small>${e.offline ? "공문 · 보고서 · 규정 등 문서를 올리면 AI 가 기록부에 들어갈 분량으로 정리합니다" : "문서 · 사진 · 동영상(50MB 이하) — 문서는 아래 요약으로 보여 줍니다"}</small></span></label>
        <ul class="ln-items" id="le-items">${e.items.map(itemRow).join("")}</ul>
        <div class="ln-sumbar"><b>교육 내용(한 쪽 요약)</b><span class="spacer"></span>
          ${e.ssi ? "" : `<button type="button" class="btn btn-ghost btn-sm" id="le-ai">${icon("star", 15)}<span>AI 요약 만들기</span></button>`}</div>
        <p class="ln-dim ln-note">문서(PDF · HWPX · DOCX · PPTX · XLSX) · 사진을 올리고 [AI 요약 만들기]를 누르면 기록부 한 칸 분량으로 정리해 왼쪽에 넣고, 오른쪽에 미리 보여 줍니다. 표는 <span class="mono">| 칸 | 칸 |</span>, 흐름은 <span class="mono">[접수] -&gt; [보고]</span> 로 적습니다.</p>
        <div class="ln-ed"><textarea id="le-body" rows="14" maxlength="20000" placeholder="## 소제목&#10;- 실무자가 지킬 것&#10;**강조**">${esc(e.body)}</textarea>
          <div class="ln-sum ln-prev" id="le-prev" aria-label="미리보기">${md() ? md().html(e.body) : ""}</div></div>
        <div class="ln-sumbar"><b>교육 장면 사진</b><small class="ln-dim">기록부에만 들어갑니다(4장까지) — 교육이 끝난 뒤 추가</small><span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-sm" id="le-photo-btn">${icon("plus", 15)}<span>사진 추가</span></button><input type="file" id="le-photo" multiple hidden accept="image/*"></div>
        <ul class="ln-items" id="le-photos">${e.photos.map(photoRow).join("")}</ul>
        <div class="form-row ln-min"${e.offline ? " hidden" : ""}><label for="le-min">최소 학습 시간</label><div class="ln-dates"><input type="number" id="le-min" min="0" max="3600" step="10" value="${e._auto ? am : Number(e.minSec) || 0}"><span>초</span>
          <button type="button" class="link-btn" id="le-auto">자동(${mmss(am)})</button></div></div>
      </section>
      <section class="card ln-form"><h2 class="card-title"><span class="ct-t">대상</span><span class="dc-meta" id="le-tsum">${tgtSummary(e)}</span></h2>
        <div class="ln-gs">${gs.map(x => `<label class="ln-g${x.self ? "" : " v"}"><input type="checkbox" data-tg="${esc(x.g)}" ${e.targets.groups.indexOf(x.g) >= 0 ? "checked" : ""}> ${esc(x.g)} <small class="mono">${x.n}</small></label>`).join("") || `<p class="ln-dim">명단이 비어 있습니다. 비상 · 연락 › 인원 관리에서 먼저 등록하세요.</p>`}</div>
        <div class="ln-tq"><span class="ln-l" id="le-tql">개별 추가 · 제외</span>${ui.search("le-tq", "이름 · 사번으로 찾기", tq)}</div>
        <div id="le-tp">${tgtPeople(e)}</div>
      </section>`;
    wireEdit(root);
  }
  function pullForm(root) {
    const e = edit, v = (id) => { const x = $("#" + id, root); return x ? x.value : ""; };
    e.title = norm(v("le-title")).slice(0, 80); e.host = norm(v("le-host")).slice(0, 60); e.place = norm(v("le-place")).slice(0, 60);
    e.overview = String(v("le-ov")).trim().slice(0, 600); e.start = v("le-start"); e.end = v("le-end");
    e.body = String(v("le-body")).replace(/\s+$/, "").slice(0, 20000);
    const ssi = $("#le-ssi", root); e.ssi = !!(ssi && ssi.checked);
    const mn = Number(v("le-min")); e.minSec = isFinite(mn) ? Math.max(0, Math.min(3600, Math.round(mn))) : 0;

  }
  function wireEdit(root) {
    const e = edit;
    $("#ln-ecancel", root).onclick = () => { edit = null; go(e.id ? "detail" : "list", e.id || sel); };
    $("#ln-esave", root).onclick = () => saveEdit(root);
    $$("[data-lek]", root).forEach(b => b.onclick = () => { e.kind = b.dataset.lek; $$("[data-lek]", root).forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
    const body = $("#le-body", root), prev = $("#le-prev", root), mn = $("#le-min", root);
    body.oninput = () => { e.body = body.value; if (prev && md()) prev.innerHTML = md().html(body.value); if (e._auto) mn.value = autoMin(e); $("#le-auto", root).textContent = "자동(" + mmss(autoMin(e)) + ")"; };
    mn.oninput = () => { e._auto = false; };
    $("#le-auto", root).onclick = () => { e._auto = true; mn.value = autoMin(e); };
    $("#le-ssi", root).onchange = () => { pullForm(root); SeMIS.renderView(); };
    $$("[data-lem]", root).forEach(b => b.onclick = () => {
      pullForm(root); e.offline = b.dataset.lem === "1";
      if (e.offline && (!e.place || e.place === "온라인(H:drive)")) e.place = "";
      if (!e.offline && !e.place) e.place = "온라인(H:drive)";
      SeMIS.renderView();
    });
    const pb = $("#le-photo-btn", root); if (pb) pb.onclick = () => { const x = $("#le-photo", root); if (x) x.click(); };
    const ph = $("#le-photo", root); if (ph) ph.onchange = () => { const fs = Array.from(ph.files || []); ph.value = ""; addPhotos(root, fs); };
    paintPhotos(root);
    $$("[data-tg]", root).forEach(cb => cb.onchange = () => {
      const g = cb.dataset.tg, gs = e.targets.groups;
      if (cb.checked) { if (gs.indexOf(g) < 0) gs.push(g); } else e.targets.groups = gs.filter(x => x !== g);
      const inG = new Set(active().filter(p => groupOf(p) === g).map(p => p.id));
      e.targets.add = e.targets.add.filter(id => !inG.has(id)); e.targets.except = e.targets.except.filter(id => !inG.has(id));
      $("#le-tsum", root).innerHTML = tgtSummary(e); paintTp(root);
    });
    const tqi = $("#le-tq", root);
    tqi.oninput = () => { const v = ui.searchValue(tqi.value); if (v === tq) return; tq = v; paintTp(root); };
    paintTp(root);
    const fi = $("#le-file", root), drop = $("#le-drop", root);
    fi.onchange = () => { addFiles(root, Array.from(fi.files || [])); fi.value = ""; };
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("on"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("on"));
    drop.addEventListener("drop", (ev) => { ev.preventDefault(); ev.stopPropagation(); drop.classList.remove("on"); addFiles(root, Array.from((ev.dataTransfer && ev.dataTransfer.files) || [])); });
    wireItems(root);
    const ai = $("#le-ai", root); if (ai) ai.onclick = () => aiSum(root);
  }
  function paintTp(root) {
    const box = $("#le-tp", root);
    if (!box) return;
    box.innerHTML = tgtPeople(edit);
    $$("[data-tp]", box).forEach(cb => cb.onchange = () => {
      const e = edit, p = people().find(x => x.id === cb.dataset.tp);
      if (!p) return;
      const inG = e.targets.groups.indexOf(groupOf(p)) >= 0;
      e.targets.add = e.targets.add.filter(x => x !== p.id); e.targets.except = e.targets.except.filter(x => x !== p.id);
      if (cb.checked && !inG) e.targets.add.push(p.id);
      if (!cb.checked && inG) e.targets.except.push(p.id);
      $("#le-tsum", root).innerHTML = tgtSummary(e);
    });
  }
  function wireItems(root) {
    $$("[data-ix]", root).forEach(b => b.onclick = () => { edit.items.splice(Number(b.dataset.ix), 1); paintItems(root); });
    $$("[data-iu]", root).forEach(b => b.onclick = () => { const i = Number(b.dataset.iu); const x = edit.items.splice(i, 1)[0]; edit.items.splice(i - 1, 0, x); paintItems(root); });
  }
  function paintItems(root) {
    $("#le-items", root).innerHTML = edit.items.map(itemRow).join("");
    const mn = $("#le-min", root); if (edit._auto && mn) mn.value = autoMin(edit);
    const au = $("#le-auto", root); if (au) au.textContent = "자동(" + mmss(autoMin(edit)) + ")";
    wireItems(root);
  }
  const typeOf = (f) => (/^video\//.test(f.type || "") || /\.(mp4|webm|mov|m4v)$/i.test(f.name || "") ? "video" : /^image\//.test(f.type || "") || /\.(jpe?g|png|gif|webp|heic)$/i.test(f.name || "") ? "image" : "doc");
  function videoDur(file) {
    return new Promise((res) => {
      let done = false;
      const fin = (v) => { if (done) return; done = true; try { URL.revokeObjectURL(u); } catch (e) { /* 없음 */ } res(v); };
      let u = "";
      try {
        u = URL.createObjectURL(file);
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => fin(isFinite(v.duration) ? Math.round(v.duration) : 0);
        v.onerror = () => fin(0);
        v.src = u;
        setTimeout(() => fin(0), 8000);
      } catch (e) { fin(0); }
    });
  }
  /* 동영상 주요 장면 — 길이를 n 등분한 가운데 장면을 JPEG(data URL)로. 실패하면 받은 만큼만 */
  function frames(src, n, cross) {
    return new Promise((res) => {
      const out = []; let done = false, k = 0, ts = [];
      let v = null;
      const fin = () => { if (done) return; done = true; try { v.removeAttribute("src"); v.load(); } catch (e) { /* 없음 */ } res(out); };
      try {
        v = document.createElement("video");
        if (cross) v.crossOrigin = "anonymous";
        v.muted = true; v.playsInline = true; v.preload = "auto";
        const next = () => { if (k >= ts.length) return fin(); try { v.currentTime = ts[k]; } catch (e) { fin(); } };
        v.onloadedmetadata = () => {
          const d = isFinite(v.duration) ? v.duration : 0;
          if (!d || !v.videoWidth) return fin();
          ts = Array.from({ length: n }, (_, i) => d * (i + 0.5) / n); next();
        };
        v.onseeked = () => {
          try {
            const W = 480, H = Math.max(1, Math.round(W * v.videoHeight / v.videoWidth));
            const c = document.createElement("canvas"); c.width = W; c.height = H;
            c.getContext("2d").drawImage(v, 0, 0, W, H);
            out.push(c.toDataURL("image/jpeg", 0.72));
          } catch (e) { return fin(); }
          k++; next();
        };
        v.onerror = fin;
        setTimeout(fin, 20000);
        v.src = src;
      } catch (e) { fin(); }
    });
  }
  const dataFile = (d, name) => { const m = /^data:([^;]+);base64,(.*)$/.exec(d); return m ? new File([b64u8(m[2])], name, { type: m[1] }) : null; };
  /* 올릴 때 장면 4장을 저장소에 같이 둔다(기록부 '교육 내용' 칸) */
  async function videoShots(file) {
    let u = "";
    try {
      u = URL.createObjectURL(file);
      const fs = await frames(u, 4, false), out = [];
      for (let i = 0; i < fs.length; i++) {
        const f = dataFile(fs[i], "shot" + (i + 1) + ".jpg");
        if (!f) continue;
        const up = await SemisSync.uploadFile(f, "learn");
        if (up && up.url) out.push(up.url);
      }
      return out;
    } catch (e) { return []; } finally { try { URL.revokeObjectURL(u); } catch (e) { /* 없음 */ } }
  }
  async function addFiles(root, files) {
    if (!files.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    pullForm(root);
    for (const f of files) {
      if (f.size > FILE_MAX) { toast(f.name + " — 50MB 를 넘습니다. 줄여서 다시 올려 주세요.", true); continue; }
      const type = typeOf(f);
      toast(f.name + " 올리는 중…");
      try {
        const up = await SemisSync.uploadFile(f, "learn");
        const it = { id: uid("li"), type, name: up.name, size: up.size, url: up.url };
        if (type === "video") { it.dur = await videoDur(f); const sh = await videoShots(f); if (sh.length) it.shots = sh; }
        if (type === "doc" && window.SemisDocRead) {
          try { const x = await SemisDocRead.extract(f); if (x && x.mode === "text" && x.text) memo[up.url] = x.text; } catch (e) { /* 요약 때 다시 */ }
        }
        edit.items.push(it);
        paintItems(root);
      } catch (e) { toast(f.name + " — 올리지 못했습니다.", true); }
    }
    if (!edit.title) { const d = edit.items.find(i => i.type === "doc"); if (d) { const tl = $("#le-title", root); if (tl && !tl.value) tl.value = d.name.replace(/\.[^.]+$/, "").slice(0, 80); } }
    toast("올렸습니다.");
  }
  /* AI 요약 — PDF · 사진은 저장소 원본, 그 밖 문서는 글을 뽑아 보낸다 */
  async function partOf(it) {
    const path = String(it.url || "").replace(/^.*\/object\/public\/semis-logi-files\//, "");
    if (/\.pdf$/i.test(it.name) || it.type === "image") return { name: it.name, path };
    if (memo[it.url]) return { name: it.name, text: memo[it.url] };
    const DR = window.SemisDocRead, FA = window.SemisFileAuth;
    if (!DR || !FA) return null;
    const u = await FA.resolve(it.url);
    const r = await fetch(u);
    if (!r.ok) return null;
    const t = await DR.textOf(it.name, new Uint8Array(await r.arrayBuffer()));
    if (t) memo[it.url] = t;
    return t ? { name: it.name, text: t } : null;
  }
  async function aiSum(root) {
    pullForm(root);
    const e = edit;
    if (e.ssi) return;
    const docs = e.items.filter(i => i.type !== "video").slice(0, 4);
    if (!docs.length) { toast("요약할 문서나 사진을 먼저 올리세요(동영상은 요약하지 않습니다).", true); return; }
    const go2 = async () => {
      const btn = $("#le-ai", root); if (btn) btn.disabled = true;
      toast("자료를 읽고 요약하는 중… (30초 안팎)");
      try {
        const parts = (await Promise.all(docs.map(it => partOf(it).catch(() => null)))).filter(Boolean);
        if (!parts.length) throw new Error("read");
        const res = await fetch(SemisSync.URL + "/functions/v1/semis-logi-learn", { method: "POST",
          headers: { "Content-Type": "application/json", "x-semis-token": SemisSync.auth.token() },
          body: JSON.stringify({ op: "sum", name: docs[0].name, title: e.title, parts }) });
        let d = null;
        try { d = await res.json(); } catch (x) { d = null; }
        if (!d || !d.ok || !d.data) throw new Error((d && d.error) || "ai");
        if (!e.title && d.data.title) e.title = d.data.title;
        if (!e.overview && d.data.overview) e.overview = d.data.overview;
        e.body = d.data.body || e.body;
        if (e._auto) e.minSec = autoMin(e);
        toast("요약을 넣었습니다. 내용을 확인하고 고치세요.");
        if (view === "edit" && edit === e) SeMIS.renderView();
      } catch (x) {
        const m = String(x.message || x);
        toast(m === "read" ? "문서 글을 읽지 못했습니다. PDF 로 저장해 다시 올려 주세요." : m === "busy" ? "AI 가 바쁩니다. 잠시 뒤 다시 눌러 주세요." : m === "too_large" ? "파일이 커서 요약하지 못했습니다." : "요약하지 못했습니다.", true);
        if (btn) btn.disabled = false;
      }
    };
    if (String(e.body || "").trim()) confirmModal("지금 적힌 교육 내용을 AI 요약으로 바꿀까요?", go2); else go2();
  }
  function saveEdit(root) {
    pullForm(root);
    const e = edit;
    if (!e.title) { toast("교육명을 적으세요.", true); $("#le-title", root).focus(); return; }
    if (!isISO(e.start) || !isISO(e.end) || e.start > e.end) { toast("교육 기간을 확인하세요.", true); $("#le-start", root).focus(); return; }
    if (!e.offline && !String(e.body || "").trim() && !e.items.length) { toast("교육 내용(요약)이나 자료를 넣으세요.", true); return; }
    const now = new Date().toISOString();
    const out = { id: e.id || uid("lc"), code: e.code || newCode(), state: e.state || "draft", title: e.title, kind: KINDS.indexOf(e.kind) >= 0 ? e.kind : "기타",
      overview: e.overview, host: e.host, place: e.place, start: e.start, end: e.end, body: e.body, minSec: e.minSec, ssi: !!e.ssi,
      items: e.items.map(i => Object.assign({ id: i.id, type: i.type, name: i.name, size: i.size, url: i.url }, i.dur ? { dur: i.dur } : {}, arrOf(i.shots).length ? { shots: arrOf(i.shots).slice(0, 4) } : {})),
      photos: arrOf(e.photos).slice(0, 4).map(i => ({ id: i.id, name: i.name, size: i.size, url: i.url })),
      targets: { groups: e.targets.groups.slice(), add: e.targets.add.slice(), except: e.targets.except.slice() },
      excuse: isObj(e.excuse) ? e.excuse : {}, dissem: e.dissem || "",
      createdAt: e.createdAt || now, createdBy: e.createdBy || who(), updatedAt: now, updatedBy: who() };
    if (e.offline) { out.offline = true; out.recBody = out.body; out.recItems = out.items; out.body = ""; out.items = []; out.minSec = 0; }
    const i = courses().findIndex(x => x.id === out.id);
    if (i >= 0) L().courses.splice(L().courses.indexOf(courses()[i]), 1, out); else L().courses.push(out);
    SeMIS.save();
    edit = null;
    toast(out.state === "draft" ? "저장했습니다. 주소 · QR 에서 교육을 열면 학습할 수 있습니다." : "저장했습니다.");
    go("detail", out.id);
  }

  /* ═════════ 교육 실시 결과 기록부 — A4 · 엑셀(종이 양식과 같은 칸) ═════════ */
  /* 회사 로고(순찰일지 인쇄와 같은 그림) — 인쇄물 아래쪽에 작게 */
  const LG_A = [[0.846, 0.151], [0.613, 0.151], [0.109, 0.551], [0.372, 0.551], [0.372, 0.389], [0.65, 0.389]];
  const LG_B = [[0.861, 0.418], [0.673, 0.418], [0.673, 0.632], [0.395, 0.632], [0.126, 0.879], [0.524, 0.879]];
  const lgPts = (a) => a.map(([x, y]) => (x * 30).toFixed(1) + "," + (y * 30).toFixed(1)).join(" ");
  const LOGO_SVG = `<svg viewBox="0 0 156 30" aria-label="AIRZETA" role="img"><text x="1" y="24.5" textLength="118" lengthAdjust="spacingAndGlyphs" font-family="'Arial Black','Helvetica Neue',Arial,sans-serif" font-weight="900" font-style="italic" font-size="25" fill="#111">AIRZETA</text><g transform="translate(123 -1)"><polygon points="${lgPts(LG_A)}" fill="#5a5a5a"/><polygon points="${lgPts(LG_B)}" fill="#111"/></g></svg>`;
  const yy = (iso) => (isISO(iso) ? "'" + iso.slice(2, 4) + ". " + Number(iso.slice(5, 7)) + ". " + Number(iso.slice(8, 10)) : "");
  const md2 = (iso) => (isISO(iso) ? Number(iso.slice(5, 7)) + ". " + Number(iso.slice(8, 10)) : "");
  const period = (c) => (c.start && c.end && c.start !== c.end ? yy(c.start) + " ~ " + (c.start.slice(0, 4) === c.end.slice(0, 4) ? md2(c.end) : yy(c.end)) : yy(c.start || c.end));
  function sheetData(c) {
    const g = prog(c);
    return g.groups.map(x => {
      const cnt = (arr) => ({ n: arr.length, m: arr.filter(m => m.gender === "M").length, f: arr.filter(m => m.gender === "F").length });
      const done = x.mem.filter(m => m.st === "ok"), miss = x.mem.filter(m => m.st !== "ok");
      const why = {}; miss.forEach(m => { const k = m.note || "미이수"; why[k] = (why[k] || 0) + 1; });
      const mem = x.mem.slice().sort((a, b) => a.name.localeCompare(b.name, "ko"));
      return { g: x.g, team: x.self ? (P().team || TEAM) : x.g, part: x.self ? x.g : "-", tgt: cnt(x.mem), done: cnt(done), miss: cnt(miss),
        why: Object.keys(why).map(k => k + (why[k] > 1 || Object.keys(why).length > 1 ? " " + why[k] : "")).join(", "), mem };
    });
  }
  const signOf = (m, signs) => (m.st === "ok" && m.row && signs[m.row.rid] ? signs[m.row.rid] : "");
  const P1 = 18, PN = 50;   // 쪽당 대상자 수(첫 쪽 · 다음 쪽) — 두 사람씩 한 줄
  function chunks(mem) { const out = [mem.slice(0, P1)]; for (let i = P1; i < mem.length; i += PN) out.push(mem.slice(i, i + PN)); return out; }
  const PRINT_CSS = `* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 12mm 12mm; }
  body { font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif; color: #000; margin: 0; font-size: 10.5pt; }
  .pg { page-break-after: always; }
  .pg:last-child { page-break-after: auto; }
  h1 { text-align: center; font-size: 18pt; letter-spacing: .3em; margin: 0 0 6mm; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td, th { border: 1px solid #000; padding: 1.2mm 1.6mm; text-align: center; vertical-align: middle; font-weight: 400; height: 7.4mm; word-break: keep-all; }
  th { background: #f2f2f2; }
  .gap td { border: 0; height: 2.5mm; padding: 0; }
  .ow { border-width: 1.6px; }
  .tl { text-align: left; }
  .bd { height: 84mm; vertical-align: top; text-align: left; padding: 2.5mm 3mm; overflow: hidden; font-size: 9.5pt; line-height: 1.5; }
  .bd .in { height: 78mm; overflow: hidden; display: flex; flex-direction: column; gap: 1.5mm; }
  .bd .tx { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .bd table { width: 100%; margin: 1.5mm 0; font-size: 9pt; } .bd table th, .bd table td { height: auto; padding: .8mm 1.5mm; text-align: left; border: .4px solid #555; } .bd table th { background: #f1f1f1; }
  .bd .md-flow { display: flex; flex-wrap: wrap; gap: 1mm 1.5mm; align-items: center; margin: 1.5mm 0; } .bd .md-flow span { border: .4px solid #555; border-radius: 1.5mm; padding: .6mm 2mm; } .bd .md-flow i { font-style: normal; }
  .bd .mr { flex: none; display: flex; gap: 1.5mm; justify-content: center; align-items: center; }
  .bd .mr span { flex: 1 1 0; min-width: 0; display: block; text-align: center; }
  .bd .mr img { display: inline-block; max-width: 100%; object-fit: contain; border: .3px solid #999; vertical-align: top; }
  .bd .mr.vd img { width: 100%; height: auto; max-height: 30mm; }
  .lgf { position: fixed; right: 0; bottom: 0; width: 26mm; height: 5mm; } .lgf svg { display: block; width: 100%; height: 100%; }
  .bd h3 { font-size: 10pt; margin: 2mm 0 1mm; } .bd h3:first-child { margin-top: 0; } .bd h4 { font-size: 9.5pt; margin: 1.5mm 0 .5mm; }
  .bd p { margin: .8mm 0; } .bd ul, .bd ol { margin: .5mm 0 1mm 5mm; padding: 0; } .bd li { margin: .3mm 0; }
  .sg { height: 9mm; padding: .5mm; } .sg img { max-height: 8mm; max-width: 100%; display: block; margin: 0 auto; }
  .nt { font-size: 9pt; color: #333; }
  .cont { font-size: 9pt; color: #333; margin: 0 0 2mm; }`;
  function memRowsHTML(list, signs) {
    let h = "";
    for (let i = 0; i < list.length; i += 2) {
      const a = list[i], b = list[i + 1];
      const cell = (m, w) => `<td${w > 1 ? ` colspan="${w}"` : ""}>${m ? esc(m.name) : ""}</td><td colspan="2" class="sg">${m && signOf(m, signs) ? `<img src="${esc(signOf(m, signs))}" alt="">` : m && m.st !== "ok" && m.note ? `<span class="nt">${esc(m.note)}</span>` : ""}</td>`;
      h += `<tr>${cell(a, 1)}${cell(b, 2)}</tr>`;
    }
    return h;
  }
  /* 교육 내용 칸 — 요약 글 + 사진(칸에 맞춤) + 동영상 주요 장면(나란히) */
  function contentHTML(c0, media) {
    const c = RC(c0);
    const txt = String(c.body || c.overview || "").trim();
    const body = txt ? (md() ? md().html(txt) : esc(txt)) : "";
    const m = media || {}, imgs = arrOf(m.images).slice(0, 4), vids = arrOf(m.videos).filter(v => v && v.length).slice(0, 2);
    const ih = (txt ? 28 : 70) - (imgs.length ? vids.length * (txt ? 8 : 26) : 0);
    return `<div class="in">${body ? `<div class="tx">${body}</div>` : ""}
      ${imgs.length ? `<div class="mr">${imgs.map(u => `<span><img src="${esc(u)}" alt="" style="max-height:${Math.max(18, ih)}mm"></span>`).join("")}</div>` : ""}
      ${vids.map(v => `<div class="mr vd">${v.slice(0, 4).map(u => `<span><img src="${esc(u)}" alt=""></span>`).join("")}</div>`).join("")}</div>`;
  }
  function recordHTML(c, signs, media) {
    const sh = sheetData(c);
    const cols = `<colgroup><col style="width:13%"><col style="width:17%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:10%"><col style="width:15%"></colgroup>`;
    const body = contentHTML(c, media);
    const pages = sh.map(s => chunks(s.mem).map((part, pi, all) => {
      const n = Math.max(1, Math.ceil(part.length / 2));
      if (pi > 0) return `<section class="pg"><p class="cont">교육 실시 결과 기록부 — ${esc(s.part !== "-" ? s.part : s.team)} · ${esc(c.title)} (${pi + 1}/${all.length})</p><table>${cols}
        <tr><th rowspan="${n + 1}">교육 대상자</th><th>대상자명</th><th colspan="2">서명</th><th colspan="2">대상자명</th><th colspan="2">서명</th></tr>${memRowsHTML(part, signs)}</table></section>`;
      return `<section class="pg"><h1>교육 실시 결과 기록부</h1><table>${cols}
        <tr><th>팀명</th><td colspan="2">${esc(s.team)}</td><td colspan="5" style="border:0"></td></tr>
        <tr><th>파트명·소속</th><td colspan="2">${esc(s.part)}</td><td colspan="5" style="border:0"></td></tr>
        <tr class="gap"><td colspan="8"></td></tr>
        <tr><th>교육명</th><td colspan="7" class="tl">${esc(c.title)}</td></tr>
        <tr><th rowspan="4">인원<br>(명)</th><th>구 분</th><th>계</th><th>남</th><th>여</th><th colspan="3">미실시 사유</th></tr>
        <tr><th>교육대상</th><td>${s.tgt.n}</td><td>${s.tgt.m}</td><td>${s.tgt.f}</td><td colspan="3"></td></tr>
        <tr><th>교육실시</th><td>${s.done.n}</td><td>${s.done.m}</td><td>${s.done.f}</td><td colspan="3"></td></tr>
        <tr><th>교육미실시</th><td>${s.miss.n}</td><td>${s.miss.m}</td><td>${s.miss.f}</td><td colspan="3">${esc(s.miss.n ? s.why : "")}</td></tr>
        <tr><th rowspan="2">교육 진행</th><th>교육 주관</th><th colspan="3">교육 장소</th><th colspan="3">교육 일시</th></tr>
        <tr><td>${esc(c.host || "")}</td><td colspan="3">${esc(c.place || "")}</td><td colspan="3">${esc(period(c))}</td></tr>
        <tr><th>교육 내용</th><td colspan="7" class="bd">${body}</td></tr>
        <tr><th rowspan="${n + 1}">교육 대상자</th><th>대상자명</th><th colspan="2">서명</th><th colspan="2">대상자명</th><th colspan="2">서명</th></tr>${memRowsHTML(part, signs)}
      </table></section>`;
    }).join("")).join("");
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>교육 실시 결과 기록부 — ${esc(c.title)}</title><style>${PRINT_CSS}</style></head><body><div class="lgf">${LOGO_SVG}</div>${pages || "<p>대상이 없습니다.</p>"}</body></html>`;
  }
  async function getSigns(c) {
    if (c.state === "draft") return {};
    try { await loadStats(true); return await loadSigns(c.id, true); } /* 늘 새로 — 방금 서명한 사람이 빠지지 않게 */ catch (e) { toast("서명을 불러오지 못했습니다. 서명 없이 만듭니다.", true); return {}; }
  }
  /* 기록부에 넣을 사진 · 동영상 장면 — 서명 주소로 바꿔서. 장면이 저장돼 있지 않은 옛 동영상은 그 자리에서 뽑는다 */
  async function recordMedia(c) {
    const FA = window.SemisFileAuth, sign = async (u) => { try { return FA && FA.resolve ? (await FA.resolve(u)) || u : u; } catch (e) { return u; } };
    const out = { images: [], videos: [] };
    for (const ph of arrOf(c.photos)) { if (out.images.length < 4) { try { out.images.push(await sign(ph.url)); } catch (e) { /* 그 사진만 빼고 */ } } }
    for (const it of arrOf(RC(c).items)) {
      try {
        if (it.type === "image" && out.images.length < 4) out.images.push(await sign(it.url));
        else if (it.type === "video" && out.videos.length < 2) {
          let sh = [];
          if (arrOf(it.shots).length) for (const u of it.shots) sh.push(await sign(u));
          else sh = await frames(await sign(it.url), 4, true);
          if (sh.length) out.videos.push(sh);
        }
      } catch (e) { /* 그 자료만 빼고 */ }
    }
    return out;
  }
  /* '교육 내용' 칸에 글이 다 들어가게 — 넘치면 사진을 먼저 줄이고(18mm 까지), 그래도 넘치면 글자를 줄인다(7pt 까지) */
  function fitRecord(doc) {
    try {
      Array.from(doc.querySelectorAll(".bd .in")).forEach(box => {
        const tx = box.querySelector(".tx");
        if (!tx) return;
        const over = () => tx.scrollHeight > tx.clientHeight + 1;
        const imgs = Array.from(box.querySelectorAll(".mr:not(.vd) img"));
        let h = 28;
        while (over() && imgs.length && h > 18) { h -= 2; imgs.forEach(im => { im.style.maxHeight = h + "mm"; }); }
        const vd = Array.from(box.querySelectorAll(".mr.vd img"));
        let vh = 30;
        while (over() && vd.length && vh > 16) { vh -= 2; vd.forEach(im => { im.style.maxHeight = vh + "mm"; im.style.width = "auto"; }); }
        let fs = 10.5;
        while (over() && fs > 7) { fs -= 0.5; tx.style.fontSize = fs + "pt"; tx.style.lineHeight = fs < 9 ? "1.35" : "1.45"; }
      });
    } catch (e) { /* 맞추지 못하면 그대로 인쇄 */ }
  }
  /* 전파교육 화면(js/dissem.js)이 읽는 교육별 · 그룹별 이행 — 준비 중 교육은 빼고 */
  function dissemRows() {
    return courses().filter(c => c.state !== "draft").map(c => {
      const g = prog(c);
      const last = (x) => x.mem.filter(m => m.st === "ok" && m.row && m.row.at).map(m => String(m.row.at).slice(0, 10)).sort().pop() || "";
      return { id: c.id, date: c.start || "", end: c.end || "", title: c.title || "", kind: c.kind || "", offline: !!c.offline, state: c.state, loaded: g.loaded, n: g.n, ok: g.ok,
        groups: g.groups.filter(x => x.mem.some(m => m.tgt) || x.ok).map(x => ({ g: x.g, self: !!x.self, n: x.n, ok: x.ok, last: last(x) })) };
    });
  }
  async function printRecord(c) {
    const signs = await getSigns(c);
    let media = null;
    if (arrOf(c.photos).length || arrOf(RC(c).items).some(i => i.type === "image" || i.type === "video")) { toast("기록부를 만드는 중…"); try { media = await recordMedia(c); } catch (e) { media = null; } }
    try {
      const html = recordHTML(c, signs, media);
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;left:-10000px;top:0;width:186mm;height:200px;border:0;visibility:hidden";   // 인쇄 폭(A4 − 여백)으로 놓아야 글 맞춤을 잴 수 있다
      document.body.appendChild(fr);
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fire = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } };
      const imgs = Array.from(doc.images || []).filter(i => !i.complete);
      const ready = Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; })));
      Promise.race([ready, new Promise(r => setTimeout(r, 8000))]).then(() => { fitRecord(doc); setTimeout(fire, 300); });
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) { toast("인쇄 대화상자를 열 수 없습니다.", true); }
  }
  function printQR(c, url) {
    const Q = window.SemisQR;
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>@page { size: A4 portrait; margin: 18mm; }
      body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; text-align: center; color: #0e1a1f; } h1 { font-size: 22pt; margin: 18mm 0 4mm; } .k { color: #b45309; font-weight: 700; font-size: 13pt; }
      .p { font-size: 13pt; color: #333; margin: 2mm 0 10mm; } .qr svg { width: 92mm; height: 92mm; } .u { font-family: monospace; font-size: 11pt; margin-top: 6mm; word-break: break-all; }
      ol { text-align: left; display: inline-block; font-size: 13pt; line-height: 1.9; margin-top: 10mm; }
      .lgf { position: fixed; left: 50%; bottom: 0; width: 34mm; height: 6.5mm; margin-left: -17mm; } .lgf svg { display: block; width: 100%; height: 100%; }</style></head><body>
      <div class="k">${esc((c.kind || "") + " 교육")}</div><h1>${esc(c.title)}</h1><p class="p">교육 기간 ${esc(span(c.start, c.end))}</p>
      <div class="qr">${Q ? Q.svg(url, { ecc: "M", size: 340, margin: 2 }) : ""}</div><div class="u">${esc(url)}</div>
      <ol><li>휴대폰 카메라로 QR 을 비춥니다.</li><li>이름을 넣고 사번을 확인합니다.</li><li>교육 내용을 끝까지 보고 서명합니다.</li></ol><div class="lgf">${LOGO_SVG}</div></body></html>`;
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
    document.body.appendChild(fr);
    const doc = fr.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } }, 300);
    setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
  }

  /* 엑셀 — 그룹마다 시트 하나, 종이 양식 칸(B~I) 그대로 + 서명 그림 */
  const xesc = (v) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const b64u8 = (s) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const pngSize = (u8) => (u8.length > 24 && u8[1] === 0x50 ? { w: (u8[16] << 24 | u8[17] << 16 | u8[18] << 8 | u8[19]) >>> 0, h: (u8[20] << 24 | u8[21] << 16 | u8[22] << 8 | u8[23]) >>> 0 } : { w: 480, h: 200 });
  /* 셀 모양: 0 기본 · 1 제목 · 2 머리(회색 · 가운데) · 3 값(가운데) · 4 값(왼쪽) · 5 내용(왼쪽 위 · 줄바꿈) · 6 빈 칸(테두리 없음) */
  function recordBook(c, signs) {
    const sheets = sheetData(c).map(s => {
      const cells = {}, merges = [], heights = {}, imgs = [];
      const put = (ref, v, st) => { cells[ref] = { v, s: st }; };
      const box = (r1, c1, r2, c2, st) => { for (let r = r1; r <= r2; r++) for (let k = c1; k <= c2; k++) { const ref = "ABCDEFGHIJ"[k] + r; if (!cells[ref]) cells[ref] = { v: "", s: st }; } };
      const mg = (a, b) => merges.push(a + ":" + b);
      put("B4", "교육 실시 결과 기록부", 1); mg("B4", "I4"); heights[4] = 30;
      put("B6", "팀명", 2); put("C6", s.team, 3); box(6, 3, 6, 3, 3); mg("C6", "D6");
      put("B7", "파트명*소속", 2); put("C7", s.part, 3); box(7, 3, 7, 3, 3); mg("C7", "D7");
      put("B9", "교육명", 2); put("C9", c.title, 4); box(9, 3, 9, 8, 4); mg("C9", "I9");
      put("B10", "인원\n(명)", 2); box(11, 1, 13, 1, 2); mg("B10", "B13");
      ["구 분", "계", "남", "여"].forEach((v, i) => put("CDEF"[i] + "10", v, 2)); put("G10", "미실시 사유", 2); box(10, 7, 10, 8, 2); mg("G10", "I10");
      [["교육대상", s.tgt, ""], ["교육실시", s.done, ""], ["교육미실시", s.miss, s.miss.n ? s.why : ""]].forEach(([lb, x, w], i) => {
        const r = 11 + i; put("C" + r, lb, 2); put("D" + r, x.n, 3); put("E" + r, x.m, 3); put("F" + r, x.f, 3); put("G" + r, w, 3); box(r, 7, r, 8, 3); mg("G" + r, "I" + r);
      });
      put("B14", "교육 진행", 2); box(15, 1, 15, 1, 2); mg("B14", "B15");
      put("C14", "교육 주관", 2); put("D14", "교육 장소", 2); box(14, 4, 14, 5, 2); mg("D14", "F14"); put("G14", "교육 일시", 2); box(14, 7, 14, 8, 2); mg("G14", "I14");
      put("C15", c.host || "", 3); put("D15", c.place || "", 3); box(15, 4, 15, 5, 3); mg("D15", "F15"); put("G15", period(c), 3); box(15, 7, 15, 8, 3); mg("G15", "I15");
      heights[15] = 27;
      put("B16", "교육 내용", 2); box(17, 1, 36, 1, 2); mg("B16", "B36");
      put("C16", md() ? md().plain(RC(c).body || c.overview || "") : String(RC(c).body || ""), 5); box(16, 2, 36, 8, 5); mg("C16", "I36");
      for (let r = 16; r <= 36; r++) heights[r] = 17.25;
      const n = Math.max(1, Math.ceil(s.mem.length / 2)), r0 = 37, rn = r0 + n;
      put("B37", "교육 대상자", 2); box(38, 1, rn, 1, 2); mg("B37", "B" + rn);
      put("C37", "대상자명", 2); put("D37", "서명", 2); box(37, 4, 37, 4, 2); mg("D37", "E37"); put("F37", "대상자명", 2); box(37, 6, 37, 6, 2); mg("F37", "G37"); put("H37", "서명", 2); box(37, 8, 37, 8, 2); mg("H37", "I37");
      for (let i = 0; i < n; i++) {
        const r = r0 + 1 + i; heights[r] = 30;
        [[s.mem[i * 2], "C", "D", "E", 3], [s.mem[i * 2 + 1], "F", "H", "I", 7]].forEach(([m, nc, sc, ec, col]) => {
          if (nc === "F") { put("F" + r, m ? m.name : "", 3); box(r, 6, r, 6, 3); mg("F" + r, "G" + r); }
          else put("C" + r, m ? m.name : "", 3);
          const sg = m ? signOf(m, signs) : "";
          put(sc + r, !sg && m && m.st !== "ok" ? m.note || "" : "", 3); box(r, sc === "D" ? 4 : 8, r, sc === "D" ? 4 : 8, 3); mg(sc + r, ec + r);
          if (sg) imgs.push({ col, row: r - 1, b64: sg.replace(/^data:image\/png;base64,/, "") });
        });
      }
      return { name: (s.part !== "-" ? s.part : s.team).replace(/[\\/?*[\]:]/g, " ").slice(0, 31), cells, merges, heights, imgs, last: rn };
    });
    return sheets;
  }
  function bookParts(sheets) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const NSM = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", NSR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", PR = "http://schemas.openxmlformats.org/package/2006/relationships";
    const te = new TextEncoder();
    const font = (b, sz) => `<font>${b ? "<b/>" : ""}<sz val="${sz}"/><name val="맑은 고딕"/><family val="3"/></font>`;
    const bd = '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>';
    const xf = (f, fill, b, al) => `<xf numFmtId="0" fontId="${f}" fillId="${fill}" borderId="${b}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment ${al}/></xf>`;
    const CC = 'horizontal="center" vertical="center" wrapText="1"';
    const xfs = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`, xf(1, 0, 0, 'horizontal="center" vertical="center"'), xf(0, 2, 1, CC), xf(0, 0, 1, CC),
      xf(0, 0, 1, 'horizontal="left" vertical="center" wrapText="1"'), xf(2, 0, 1, 'horizontal="left" vertical="top" wrapText="1"'), xf(0, 0, 0, CC)];
    const styles = X + `<styleSheet xmlns="${NSM}"><fonts count="3">${font(false, 11)}${font(true, 16)}${font(false, 10)}</fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${bd}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const parts = [], media = [];
    const widths = { A: 1.1, B: 12.4, C: 15.1, D: 11.4, E: 9, F: 9, G: 3.5, H: 10.8, I: 12.1, J: 1 };
    sheets.forEach((sh, si) => {
      const rowsN = Math.max(sh.last, 45);
      const byRow = {};
      Object.keys(sh.cells).forEach(ref => { const m = /^([A-J])(\d+)$/.exec(ref); (byRow[m[2]] = byRow[m[2]] || []).push([m[1], sh.cells[ref]]); });
      let data = "";
      for (let r = 1; r <= rowsN; r++) {
        const cs = (byRow[r] || []).sort((a, b) => a[0].localeCompare(b[0]));
        const ht = sh.heights[r] ? ` ht="${sh.heights[r]}" customHeight="1"` : "";
        if (!cs.length && !ht) continue;
        data += `<row r="${r}"${ht}>${cs.map(([col, o]) => {
          const ref = col + r, st = o.s ? ` s="${o.s}"` : "";
          if (typeof o.v === "number") return `<c r="${ref}"${st}><v>${o.v}</v></c>`;
          if (o.v === "" || o.v == null) return `<c r="${ref}"${st}/>`;
          return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xesc(o.v)}</t></is></c>`;
        }).join("")}</row>`;
      }
      const hasImg = sh.imgs.length > 0;
      parts.push({ name: `xl/worksheets/sheet${si + 1}.xml`, text: X + `<worksheet xmlns="${NSM}" xmlns:r="${NSR}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="16.5"/><cols>${Object.keys(widths).map((k, i) => `<col min="${i + 1}" max="${i + 1}" width="${widths[k]}" customWidth="1"/>`).join("")}</cols><sheetData>${data}</sheetData><mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>${hasImg ? '<drawing r:id="rId1"/>' : ""}</worksheet>` });
      if (!hasImg) return;
      parts.push({ name: `xl/worksheets/_rels/sheet${si + 1}.xml.rels`, text: X + `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${NSR}/drawing" Target="../drawings/drawing${si + 1}.xml"/></Relationships>` });
      const rels = [], anchors = [];
      sh.imgs.forEach((im, k) => {
        const u8 = b64u8(im.b64), sz = pngSize(u8);
        media.push({ name: `xl/media/sign${si + 1}_${k + 1}.png`, data: u8 });
        rels.push(`<Relationship Id="rId${k + 1}" Type="${NSR}/image" Target="../media/sign${si + 1}_${k + 1}.png"/>`);
        const hpx = 34, wpx = Math.max(20, Math.min(140, Math.round(hpx * sz.w / Math.max(1, sz.h)))), E = 9525;
        anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>${E * 6}</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>${E * 3}</xdr:rowOff></xdr:from><xdr:ext cx="${wpx * E}" cy="${hpx * E}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="서명 ${k + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wpx * E}" cy="${hpx * E}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
      });
      parts.push({ name: `xl/drawings/drawing${si + 1}.xml`, text: X + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NSR}">${anchors.join("")}</xdr:wsDr>` });
      parts.push({ name: `xl/drawings/_rels/drawing${si + 1}.xml.rels`, text: X + `<Relationships xmlns="${PR}">${rels.join("")}</Relationships>` });
    });
    const used = new Set();
    const names = sheets.map((s, i) => { let n = s.name || "시트" + (i + 1), k = 2; while (used.has(n)) n = (s.name || "시트").slice(0, 28) + " " + k++; used.add(n); return n; });
    const head = [
      { name: "[Content_Types].xml", text: X + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${s.imgs.length ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : ""}`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: "_rels/.rels", text: X + `<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${NSR}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", text: X + `<workbook xmlns="${NSM}" xmlns:r="${NSR}"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames>${names.map((n, i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${xesc(n.replace(/'/g, "''"))}'!$A$1:$J$${Math.max(sheets[i].last, 45)}</definedName>`).join("")}</definedNames></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", text: X + `<Relationships xmlns="${PR}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NSR}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="${NSR}/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", text: styles }
    ];
    return head.concat(parts).map(p => ({ name: p.name, data: te.encode(p.text) })).concat(media);
  }
  async function xlsxBytes(c, signs) {
    const Z = window.SemisHwpx;
    if (!Z || !Z.zip) throw new Error("zip");
    const sh = recordBook(c, signs);
    if (!sh.length) throw new Error("empty");
    return Z.zip(bookParts(sh));
  }
  async function exportXlsx(c) {
    try {
      const signs = await getSigns(c);
      const u8 = await xlsxBytes(c, signs);
      const blob = new Blob([u8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "교육실시결과기록부_" + String(c.title || "교육").replace(/[\\/:*?"<>|]/g, " ").slice(0, 40) + ".xlsx"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { toast(String(e.message) === "empty" ? "대상이 없습니다." : "엑셀을 만들지 못했습니다.", true); }
  }

  /* ═════════ 일정관리 · 대시보드 · 검색 ═════════ */
  function calItems(from, to, today) {
    const t = today || todayISO();
    return courses().filter(c => c.state !== "draft" && isISO(c.start) && isISO(c.end) && c.start <= to && c.end >= from).map(c => {
      const g = S.rows ? prog(c) : null;
      return { ik: "ln:" + c.id, start: c.start, end: c.end, title: "[교육] " + c.title, color: "green",
        done: c.state === "closed" || c.end < t || !!(g && g.n && g.ok === g.n), late: false,
        sub: [TITLE, span(c.start, c.end), g ? "완료 " + g.ok + "/" + g.n : ""].filter(Boolean).join(" · "),
        go: [{ lb: TITLE, ico: "notes", run: () => go("detail", c.id) }] };
    });
  }
  function liveList(t) {
    t = t || todayISO();
    return courses().filter(c => statusOf(c, t).k === "live").sort((a, b) => String(a.end).localeCompare(String(b.end)));
  }
  function todayData(t) {
    const ls = liveList(t);
    if (!ls.length) return null;
    const gs = S.rows ? ls.map(prog) : null;
    const n = gs ? gs.reduce((s, g) => s + g.n, 0) : 0, ok = gs ? gs.reduce((s, g) => s + g.ok, 0) : 0;
    return { n: ls.length, first: ls[0], pct: gs && n ? Math.round(ok / n * 100) : null, near: ls.filter(c => dayDiff(t || todayISO(), c.end) <= 3).length };
  }
  function todaySub(d) { return esc(d.first.title) + (d.n > 1 ? " 외 " + (d.n - 1) + "건" : "") + " · 마감 " + esc(dot(d.first.end).slice(5)) + (d.near ? " · <em>3일 안 마감 " + d.near + "</em>" : ""); }
  function mountToday() {
    const el = document.getElementById("td-ln");
    if (!el) return;
    loadStats().then(() => {
      const d = todayData(), v = el.querySelector(".td-v");
      if (d && v) v.innerHTML = `<b class="mono">${d.pct == null ? "-" : d.pct + "%"}</b>`;
    });
  }
  function dashPane(t) {
    const ls = liveList(t);
    const near = courses().filter(c => statusOf(c, t).k === "soon").slice(0, 2);
    if (!ls.length && !near.length) return `<p class="ie-ok">${icon("check", 16)}<span>진행 중인 교육 전파가 없습니다.</span></p>`;
    const row = (c) => {
      const g = S.rows ? prog(c) : null, d = isISO(c.end) ? dayDiff(t, c.end) : null, s = statusOf(c, t);
      return `<button type="button" class="ln-dash-r" data-ln-open="${esc(c.id)}"><span class="ln-dash-t"><b>${esc(c.title)}</b><small>${esc(s.k === "soon" ? "시작 " + dot(c.start).slice(5) : span(c.start, c.end))}${s.k === "live" && d != null ? " · " + (d ? "D-" + d : "오늘 마감") : ""}</small></span>
        <span class="ln-done">${g ? pgBar(g.pct) + `<b class="mono">${g.ok}/${g.n}</b><span class="mono ln-dim">${g.pct}%</span>` : `<span class="ln-dim">${s.k === "soon" ? "예정" : "…"}</span>`}</span></button>`;
    };
    return `<div class="ln-dash">${ls.slice(0, 5).map(row).join("")}${near.map(row).join("")}</div>`;
  }
  function wireDash(root, rerender) {
    $$("[data-ln-open]", root).forEach(b => b.onclick = () => go("detail", b.dataset.lnOpen));
    if (!S.rows || Date.now() - S.at > 60000) loadStats().then(ch => { if (ch && typeof rerender === "function") rerender(); });
  }
  function remote() {
    S.at = 0;
    delete S.signs[sel];
    loadStats(true).then(ch => {
      const r = location.hash.replace(/^#\//, "") || "dashboard";
      if (!ch) return;
      if ((r === MOD && view !== "edit") || r === "aud-dash") SeMIS.renderView();
      else if (r === "dashboard") mountToday();
    });
  }

  function render(root) {
    if (view === "detail") return detailView(root);
    if (view === "edit") return editView(root);
    view = "list";
    return listView(root);
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const d = todayData(); return d && d.near ? d.near : ""; },
    render
  });
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "notes", module: MOD,
    items: () => courses().map(c => ({ title: c.title, sub: [c.kind ? c.kind + " 교육" : "", span(c.start, c.end), statusOf(c).label].filter(Boolean).join(" · "),
      text: [c.title, c.kind, c.overview], route: MOD, pick: () => { view = "detail"; sel = c.id; } }))
  });

  window.SemisLearn = {
    TITLE, SELF, KINDS, groupOf, groups, isTarget, prog, statusOf, loadStats, loadSigns, calItems, todayData, todaySub, mountToday, dashPane, wireDash, remote,
    RC, dissemRows, fitRecord, recordHTML, contentHTML, recordMedia, frames, LOGO_SVG, recordBook, bookParts, xlsxBytes, sheetData, learnUrl, newCode, autoMin, period,
    open(id) { go("detail", id); }, openEdit, go,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    setState(o) { o = o || {}; if (o.view) view = o.view; if (o.sel !== undefined) sel = o.sel; if (o.filt) filt = o.filt; if (o.q !== undefined) q = o.q; if (o.dfilt) dfilt = o.dfilt; if (o.dtab) dtab = o.dtab; if (o.dgrp !== undefined) dgrp = o.dgrp; if (o.reset) { view = "list"; sel = ""; filt = "live"; q = ""; dq = ""; dfilt = "all"; dgrp = ""; dtab = "mem"; edit = null; } },
    _S: S, _setRows(rows) { S.rows = rows; S.at = rows ? Date.now() : 0; }, _setSigns(cid, m) { S.signs[cid] = m; }, _edit: () => edit
  };
})();
