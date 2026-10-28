/* 허브 홈(#/hub/<허브 id>) — 전용 대시보드가 없는 허브(게시판 · 비상 · 연락 · 규정 · 문서 등)와, 허브 대시보드를 볼 수 없는 계정이
   레일을 누르면 여는 화면. ① 바로가기 칸(이 계정에 보이는 하위 화면 · 게시판 · 외부 사이트) ② 현황 카드(허브별, 2개까지 — 블록 4개 이하) */
"use strict";

(() => {
  const { $$, esc, ui } = SeMIS;
  const icon = (n, z) => SeMIS.icon(n, z);
  const D = () => SeMIS.data;
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const dot = (s) => String(s || "").slice(2, 10).replace(/-/g, ".");
  const ymd = (s) => String(s || "").slice(0, 10);
  const MAX_CARDS = 2;

  /* 화면 칸 아이콘(선 아이콘 키) — 없으면 문서 */
  const MOD_ICO = {
    schedule: "calendar", minutes: "notes", flight: "plane", shortcuts: "link",
    "scr-status": "scan", "scr-equip": "xray", "sec-cases": "doc", "kc-ra": "building", partners: "users",
    inspection: "clipboard", "daily-safety": "patrol", audit: "clipboard", selfcheck: "check", training: "shield", dissem: "megaphone",
    serp: "alert", threat: "phone", phonebook: "phone", contacts: "users", crisis: "users",
    "reg-sec": "book", "reg-safety": "book", "reg-dg": "book", contracts: "doc"
  };
  const REG_SCOPE = { "reg-sec": "sec", "reg-safety": "safety", "reg-dg": "dg" };

  /* 칸 아래 한 줄(상태) — 있으면 { t, tone }. 없으면 메뉴 배지(숫자)를 오른쪽에 */
  const LINES = {
    serp() {
      const S = window.SemisSerp;
      if (S && S.activeRun && S.activeRun()) return { t: "대응 중", tone: "bad" };
      const last = arr(D().serpRuns).filter(r => r.end).sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
      return last ? { t: "최근 " + (last.kind === "drill" ? "훈련 " : "대응 ") + dot(last.start) } : { t: "대응 기록 없음" };
    },
    threat() {
      const T = window.SemisThreat;
      if (T && T.activeRun && T.activeRun()) return { t: "응대 중", tone: "bad" };
      if (!T || !T.phonesStat) return null;
      const p = T.phonesStat();
      if (!p.total) return { t: "녹음 전화 미등록" };
      if (p.ng) return { t: "녹음 전화 이상 " + p.ng, tone: "bad" };
      if (p.none) return { t: "점검 안 한 전화 " + p.none, tone: "warn" };
      return { t: "녹음 전화 " + p.total + "대 정상", tone: "ok" };
    },
    phonebook() {
      const rows = arr((D().phonebook || {}).rows);
      const chk = rows.filter(r => r.check).length;
      return { t: rows.length + "건" + (chk ? " · 확인 필요 " + chk : ""), tone: chk ? "warn" : "" };
    },
    contacts() {
      const c = D().contacts || {};
      const n = arr(c.sections).reduce((s, x) => s + arr(x.rows || x.people || x.items).length, 0);
      return { t: arr(c.sections).length + "개 묶음" + (n ? " · " + n + "명" : "") };
    },
    crisis() {
      const C = window.SemisCrisis;
      const n = C && C.people ? C.people().length : arr((D().crisis || {}).rows).length;
      const miss = C && C.missing ? C.missing().length : 0;
      return { t: n + "명" + (miss ? " · 번호 없음 " + miss : ""), tone: miss ? "warn" : "" };
    },
    contracts() {
      const C = window.SemisContracts;
      if (!C || !C.stats) return null;
      const t = C.stats();
      return { t: t.all + "건" + (t.exp ? " · 만료 " + t.exp : t.soon ? " · 만료 임박 " + t.soon : ""), tone: t.exp ? "bad" : t.soon ? "warn" : "" };
    }
  };
  Object.keys(REG_SCOPE).forEach(r => {
    LINES[r] = () => {
      const R = window.SemisRegs;
      if (!R || !R.stats) return null;
      const s = R.stats(REG_SCOPE[r]);
      return { t: s.total + "건" + (s.latest ? " · 최근 개정 " + dot(s.latest) : "") };
    };
  });
  function lineOf(mod) {
    const f = LINES[mod];
    if (!f) return null;
    try { return f(); } catch (e) { return null; }
  }

  /* ── 바로가기 칸 ── */
  function tileHTML(o) {
    const sub = o.line ? `<small class="hh-s${o.line.tone ? " t-" + esc(o.line.tone) : ""}">${esc(o.line.t)}</small>` : "";
    const badge = !o.line && o.badge ? `<span class="hh-n mono">${esc(o.badge)}</span>` : "";
    const inner = `<span class="hh-ic" aria-hidden="true">${icon(o.ico, 20)}</span>
      <span class="hh-t">${o.grp ? `<i class="hh-g">${esc(o.grp)}</i>` : ""}<b>${esc(o.label)}</b>${sub}</span>${badge}
      <span class="hh-go" aria-hidden="true">${icon(o.href ? "external" : "chevron", 16)}</span>`;
    return o.href
      ? `<a class="hh-tile" href="${esc(o.href)}" target="_blank" rel="noopener">${inner}</a>`
      : `<button type="button" class="hh-tile${o.line && o.line.tone === "bad" ? " is-bad" : ""}" data-hh-go="${esc(o.route)}">${inner}</button>`;
  }
  function tilesOf(hubId) {
    const out = [];
    const modTile = (m, grp) => ({ route: m.module, label: m.label, grp, ico: MOD_ICO[m.module] || "doc", line: lineOf(m.module), badge: SeMIS.navBadgeOf(m) });
    SeMIS.hubEntries(hubId).forEach(m => {
      if (SeMIS.isHubDash(m)) return;
      if (m.type === "bundle") SeMIS.bundleMembers(m).forEach(x => out.push(modTile(x, m.label)));
      else if (m.type === "module") { if (SeMIS.isLive(m)) out.push(modTile(m, "")); }
      else if (m.type === "board") {
        const B = window.SemisBoard;
        const s = B && B.stats && B.stats.boards ? B.stats.boards[m.board] : null;
        out.push({ route: SeMIS.boardRoute(m), label: m.label, ico: "bbs",
          line: s ? { t: (s.total != null ? s.total + "건" : "") + (s.unread ? (s.total != null ? " · " : "") + "새 글 " + s.unread : ""), tone: s.unread ? "warn" : "" } : null });
      } else if (m.type === "link") {
        if (SeMIS.isLinkGroup(m)) out.push({ route: "links/" + m.id, label: m.label, ico: "folder", line: { t: SeMIS.linkChildren(m.id).length + "개 링크" } });
        else if (m.open === "frame") out.push({ route: "embed/" + m.id, label: m.label, ico: "panel", line: { t: SeMIS.hostOf(m.url) } });
        else out.push({ href: m.url, label: m.label, ico: "link", line: { t: SeMIS.hostOf(m.url) || "외부 사이트" } });
      }
    });
    return out;
  }

  /* ── 현황 카드 — 허브별 등록. { id, title, ok(), html(), mount(box), go: { label, route } } ── */
  const CARDS = {};
  function registerCard(hubId, c) { if (hubId && c && c.id) (CARDS[hubId] = CARDS[hubId] || []).push(c); }
  const cardsOf = (hubId) => (CARDS[hubId] || []).filter(c => { try { return !c.ok || c.ok(); } catch (e) { return false; } }).slice(0, MAX_CARDS);
  const canGo = (route) => { const mn = SeMIS.menuOfRoute(route); return !!mn && SeMIS.navVisible(mn); };

  function render(root, hubId) {
    const g = D().menus.find(m => m && m.id === hubId && m.type === "group");
    const tiles = tilesOf(hubId);
    const cs = cardsOf(hubId);
    root.innerHTML = ui.head({ title: g ? g.label : "허브", meta: tiles.length + "개 화면" }) +
      `<section class="card hh-card" aria-label="바로가기"><h2 class="card-title"><span class="ct-t">바로가기</span></h2>
        ${tiles.length ? `<div class="hh-grid">${tiles.map(tileHTML).join("")}</div>` : ui.empty("이 허브에서 볼 수 있는 화면이 없습니다.")}</section>` +
      cs.map(c => {
        const go = c.go && canGo(c.go.route) ? c.go : null;
        let body = "";
        try { body = c.html(); } catch (e) { body = ui.empty("이 카드를 표시하지 못했습니다."); }
        return `<section class="card hh-card" data-hc="${esc(c.id)}" aria-label="${esc(c.title)}">
          <h2 class="card-title"><span class="ct-t">${esc(c.title)}</span><span class="dc-meta" data-hc-meta></span><span class="spacer"></span>
            ${go ? `<button type="button" class="btn btn-ghost btn-sm c-act" data-hh-go="${esc(go.route)}">${esc(go.label || "전체 보기")}</button>` : ""}</h2>
          <div data-hc-body>${body}</div></section>`;
      }).join("");
    $$("[data-hh-go]", root).forEach(b => b.onclick = () => SeMIS.navigate(b.dataset.hhGo));
    cs.forEach(c => {
      const box = root.querySelector('[data-hc="' + c.id + '"]');
      if (box && c.mount) { try { c.mount(box); } catch (e) { /* 카드 하나가 실패해도 화면은 그대로 */ } }
    });
  }

  /* ── 게시판 허브 — 최근 글(세 게시판 합쳐) ── */
  const recent = { key: "", rows: [], at: 0, busy: null, err: false };
  function boardIds() { return SeMIS.hubEntries("hub-bbs").filter(m => m.type === "board").map(m => m.board); }
  function loadRecent(ids) {
    const key = ids.join(",");
    if (recent.key === key && recent.at && Date.now() - recent.at < 60000) return Promise.resolve(recent);
    if (recent.busy) return recent.busy;
    const S = window.SemisSync;
    if (!S || !S.rpc) return Promise.resolve(recent);
    recent.busy = S.rpc("semis_logi_bbs_recent", { p: { b: ids, n: 8 } }).then(d => {
      recent.key = key; recent.at = Date.now(); recent.err = !(d && d.ok);
      recent.rows = d && d.ok ? arr(d.rows) : [];
      return recent;
    }).catch(() => { recent.err = true; recent.at = Date.now(); return recent; }).finally(() => { recent.busy = null; });
    return recent.busy;
  }
  function recentHTML() {
    if (!recent.at) return `<div class="hh-wait" role="status">${icon("refresh", 15)}<span>불러오는 중…</span></div>`;
    if (recent.err && !recent.rows.length) return '<div class="empty">글을 불러오지 못했습니다.</div>';
    if (!recent.rows.length) return '<div class="empty">등록된 글이 없습니다.</div>';
    const nameOf = (id) => { const mn = SeMIS.menuForBoard(id); const bd = SeMIS.boardDef(id); return (mn && mn.label) || (bd && bd.name) || id; };
    return `<div class="hh-list">${recent.rows.map(r => `<a class="hh-row" href="#/board/${esc(r.b)}/${esc(r.id)}">
        <span class="hh-d mono">${esc(dot(r.at))}</span>
        <span class="hh-k">${esc(nameOf(r.b))}</span>
        <span class="hh-x${r.read === false ? " is-unread" : ""}">${r.pin ? '<span class="badge badge-red">고정</span>' : ""}<span>${esc(r.title)}</span></span>
        <span class="hh-m">${esc(r.by || "")}</span></a>`).join("")}</div>`;
  }
  registerCard("hub-bbs", {
    id: "bbs-recent", title: "최근 글",
    ok: () => !!window.SemisBoard && boardIds().length > 0,
    html: recentHTML,
    mount(box) {
      const body = box.querySelector("[data-hc-body]");
      loadRecent(boardIds()).then(() => { if (body && body.isConnected) body.innerHTML = recentHTML(); });
    }
  });

  /* ── 비상 · 연락 허브 — 최근 대응 · 점검(SERP · 위협전화 접수 · 녹음 전화 점검) ── */
  function opsEvents() {
    const out = [];
    const S = window.SemisSerp, T = window.SemisThreat;
    if (S && canGo("serp")) arr(D().serpRuns).forEach(r => out.push({ at: r.start, kind: r.kind === "drill" ? "SERP 훈련" : "SERP 대응", tone: r.kind === "drill" ? "amber" : "red",
      title: r.title || (r.kind === "drill" ? "SERP 훈련" : "위기상황"), live: !r.end, route: "serp" }));
    if (T && canGo("threat")) {
      arr(D().threatRuns).forEach(r => out.push({ at: r.start, kind: r.kind === "drill" ? "위협전화 훈련" : "위협전화 접수", tone: r.kind === "drill" ? "amber" : "red",
        title: (r.recv && r.recv.dept) || "", live: !r.end, route: "threat" }));
      arr(D().threatChecks).forEach(c => { const n = Object.keys(c.rows && typeof c.rows === "object" ? c.rows : {}).length;
        out.push({ at: c.date, kind: "녹음 전화 점검", tone: "gray", title: n ? n + "대 점검" : "녹음 전화 점검", live: false, route: "threat" }); });
    }
    return out.filter(x => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);
  }
  registerCard("hub-ops", {
    id: "ops-recent", title: "최근 대응 · 점검",
    ok: () => canGo("serp") || canGo("threat"),
    go: { label: "전체 보기", route: "serp" },
    html() {
      const ev = opsEvents();
      if (!ev.length) return '<div class="empty">대응 · 점검 기록이 없습니다.</div>';
      return `<div class="hh-list">${ev.map(x => `<button type="button" class="hh-row" data-hh-go="${esc(x.route)}">
          <span class="hh-d mono">${esc(dot(ymd(x.at)))}</span>
          <span class="hh-k">${ui.chip(x.kind, x.tone)}</span>
          <span class="hh-x"><span>${esc(x.title || "-")}</span></span>
          <span class="hh-m">${x.live ? ui.chip("진행 중", "red") : ""}</span></button>`).join("")}</div>`;
    },
    mount(box) { $$("[data-hh-go]", box).forEach(b => b.onclick = () => SeMIS.navigate(b.dataset.hhGo)); }
  });

  /* ── 규정 · 문서 허브 — 최근 등록 · 개정 규정 5건 ── */
  registerCard("hub-doc", {
    id: "doc-recent", title: "최근 등록 · 개정",
    ok: () => !!window.SemisRegs && Object.keys(REG_SCOPE).some(canGo),
    html() {
      const R = window.SemisRegs;
      const ok = Object.keys(REG_SCOPE).filter(canGo).map(r => REG_SCOPE[r]);
      const NAME = { sec: "항공보안", safety: "안전관리", dg: "위험물" };
      const rows = R.list().filter(r => r && ok.indexOf(r.scope) >= 0)
        .sort((a, b) => String(b.date || b.updated || "").localeCompare(String(a.date || a.updated || ""))).slice(0, 5);
      if (!rows.length) return '<div class="empty">등록된 규정이 없습니다.</div>';
      return `<div class="hh-list">${rows.map(r => `<button type="button" class="hh-row" data-hh-reg="${esc(r.scope)}" data-hh-q="${esc(r.title || "")}">
          <span class="hh-d mono">${esc(dot(r.date || ymd(r.updated)))}</span>
          <span class="hh-k">${ui.chip(NAME[r.scope] || r.scope, "blue")}</span>
          <span class="hh-x"><span>${esc(r.title || "-")}</span></span>
          <span class="hh-m">${esc(r.rev || "")}</span></button>`).join("")}</div>`;
    },
    mount(box) {
      $$("[data-hh-reg]", box).forEach(b => b.onclick = () => {
        const R = window.SemisRegs, sc = b.dataset.hhReg;
        if (R && R.setQuery) R.setQuery(sc, b.dataset.hhQ || "");
        SeMIS.navigate(R && R.SCOPES && R.SCOPES[sc] ? R.SCOPES[sc].route : "reg-sec");
      });
      $$("[data-hh-go]", box).forEach(b => b.onclick = () => SeMIS.navigate(b.dataset.hhGo));
    }
  });
  window.SemisHub = { render, registerCard, tilesOf, lineOf, cardsOf, opsEvents, _recent: recent };
})();
