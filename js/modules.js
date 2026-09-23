/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — Modules
   대시보드(공지 · 안전보안 현황) · 시스템 설정
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, fmtDate, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ════════════════ 대시보드 (v1.8 — Terminal Calm) ════════════════
     구성: 머리말(빠른 실행) · 화물 태그 카드(무재해 경과일 + 국가 항공보안등급) · 다가오는 일정
           · 하단 시트(공지사항 | 회의 결정사항 | 모듈 구축 현황)
     카드별 표시 권한 — 새 카드를 추가할 때는 반드시 여기에 등록하고 vis를 지정할 것.
     vis: "all" | "mgr"(관리자 이상) | "hq"(안전보안파트 이상) | "adm" */
  const DASH_CARDS = {
    status:   "all",  // 무재해 경과일 · 보안등급 (화물 태그 카드)
    notice:   "all",  // 공지사항
    upcoming: "mgr",  // 다가오는 일정
    actions:  "mgr",  // 회의 결정사항 (미완료 · 기한 경과)
    screen:   "mgr",  // 화물 보안검색 요약 띠 (CARES — 검색 라인 · 오늘 점검 · 고장 · 환경)
    build:    "hq"    // 모듈 구축 현황 (허브별 운영/전체)
  };
  const cardVis = (id) => {
    const v = DASH_CARDS[id] || "all";
    const r = SeMIS.roleRank();
    return v === "all" || (v === "mgr" && r >= 2) || (v === "hq" && r >= 3) || (v === "adm" && r >= 4);
  };
  window.SemisDash = { DASH_CARDS, cardVis };
  const ico = (n, z) => SeMIS.icon(n, z);
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const md = (iso) => String(iso || "").slice(5).replace("-", ".");
  const dotDate = (iso) => String(iso || "").replace(/-/g, ".");

  /* 무재해 경과일 — safetyBoard.since(기준일) 로부터 오늘까지 */
  function zeroDays() {
    const sb = D().safetyBoard || {};
    if (!sb.since) return null;
    const n = Math.round((new Date(todayISO()) - new Date(sb.since)) / 86400000);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  /* 회의 결정사항 중 미완료 (열람 가능한 회의록만) */
  function openActions() {
    if (!window.SemisMinutes || !SemisMinutes.visibleAll) return [];
    let list = [];
    try { list = SemisMinutes.visibleAll(); } catch (e) { return []; }
    const out = [];
    list.forEach(m => (m.decisions || []).forEach(d => {
      if (!d || d.done || !String(d.task || "").trim()) return;
      out.push({ task: d.task, owner: d.owner || "", due: d.due || "", from: m.title || "", mid: m.id });
    }));
    const t = todayISO();
    return out.sort((a, b) => {
      const la = a.due && a.due < t, lb = b.due && b.due < t;
      if (la !== lb) return la ? -1 : 1;
      return String(a.due || "9999").localeCompare(String(b.due || "9999"));
    });
  }
  /* 다가오는 일정 (반복 일정은 다음 회차) */
  function upcomingList() {
    const out = [];
    (D().schedules || []).forEach(s => {
      if (window.SemisCalendar && SemisCalendar.canSeePriv && !SemisCalendar.canSeePriv(s)) return;
      const rep = s.repeat && s.repeat.freq && s.repeat.freq !== "none";
      if (rep && window.SemisCalendar) {
        const open = SemisCalendar.nextOpenOccurrence ? SemisCalendar.nextOpenOccurrence(s, todayISO()) : null;
        const occ = open || SemisCalendar.nextOccurrence(s, todayISO());
        if (occ) out.push(Object.assign({}, s, {
          start: occ.start, end: occ.end,
          done: SemisCalendar.occDone ? SemisCalendar.occDone(s, occ.start) : !!s.done
        }));
      } else if ((s.end || s.start) >= todayISO()) out.push(s);
    });
    return out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }
  /* 허브별 모듈 구축 현황 — 화면에 보이는 모듈 메뉴 기준 (운영 = 모듈 js 등록 완료) */
  function buildStatus() {
    const rows = SeMIS.hubList().map(g => {
      const mods = SeMIS.hubEntries(g.id).filter(m => m.type === "module");
      const live = mods.filter(m => SeMIS.hasModule(m.module) || !m.planned).length;
      return { id: g.id, label: g.label, ico: g.ico, live, total: mods.length };
    }).filter(r => r.total);
    const utilMods = SeMIS.utilEntries().filter(m => m.type === "module");
    if (utilMods.length) rows.push({ id: "", label: "관리", ico: "sliders",
      live: utilMods.filter(m => SeMIS.hasModule(m.module) || !m.planned).length, total: utilMods.length });
    return rows;
  }
  /* 화물 보안검색 요약 띠 — 보안검색 현황 메뉴를 볼 수 있을 때만(권한·숨김 따름) */
  function scrVisible() {
    const mn = (D().menus || []).find(m => m.type === "module" && m.module === "scr-status");
    return !!(mn && SeMIS.navVisible(mn) && SeMIS.hasModule("scr-status"));
  }
  const LV_TONE = { "평시": "ok", "관심": "info", "주의": "warn", "경계": "high", "심각": "crit" };
  const lvColor = (l) => ({ "평시": "badge-green", "관심": "badge-blue", "주의": "badge-amber",
    "경계": "badge-orange", "심각": "badge-red" }[l] || "badge-gray");
  const lvRange = (e2) => {
    if (!e2.date) return "";
    if (!e2.end) return e2.date + " ~";
    const sameYear = e2.end.slice(0, 4) === e2.date.slice(0, 4);
    return e2.date + " ~ " + (sameYear ? e2.end.slice(5) : e2.end);
  };

  function ticketHTML(canWrite) {
    const d = D();
    const z = zeroDays();
    const cur = SeMIS.secCurrent();
    const nxt = SeMIS.secNext();
    const li = SeMIS.SEC_LEVELS.indexOf(cur.level);
    return `<section class="ticket tk-hero${z === null ? " no-zero" : ""}" aria-label="안전보안 현황">
      <div class="tk-main">
        <div class="tk-stage no-print" id="dash-3d" aria-hidden="true"></div>
        <div class="tk-top"><span class="tk-label">무재해 경과일</span><span class="tk-code">ICNKF</span></div>
        <div class="zero-n">${z === null ? "—" : "D+" + z}</div>
        <div class="tk-foot">
          <span class="tk-sub">${z === null ? "기준일이 설정되지 않았습니다" : esc(dotDate(d.safetyBoard.since)) + (d.safetyBoard.note ? " · " + esc(d.safetyBoard.note) : "") + " 기준"}</span>
          ${canWrite ? '<button type="button" class="tk-btn" id="btn-edit-zero">기준일 설정</button>' : ""}
        </div>
      </div>
      <div class="tk-perf" aria-hidden="true"></div>
      <div class="tk-side">
        <span class="tk-label">국가 항공보안등급</span>
        <div class="tk-level-wrap">
          <div class="tk-level" data-tone="${esc(LV_TONE[cur.level] || "info")}">${esc(cur.level)}</div>
          <div class="tk-sub">${cur.date ? esc(dotDate(cur.date)) + (cur.end ? " ~ " + esc(dotDate(cur.end)) : " 부터") : ""}</div>
          ${nxt ? `<div class="tk-next">${esc(dotDate(nxt.date))}부터 <b>${esc(nxt.level)}</b> 예약</div>` : ""}
        </div>
        <div class="lv-scale" aria-label="5단계 중 ${li + 1}단계">
          <div class="lv-bars">${SeMIS.SEC_LEVELS.map((l, i) => `<i class="${i === li ? "on" : ""}" data-tone="${esc(LV_TONE[l])}"></i>`).join("")}</div>
          <div class="lv-names">${SeMIS.SEC_LEVELS.map((l, i) => `<span class="${i === li ? "on" : ""}">${esc(l)}</span>`).join("")}</div>
        </div>
        <div class="tk-acts">
          ${SeMIS.roleRank() >= 2 ? '<button type="button" class="tk-btn" id="btn-level-hist">변경 이력</button>' : ""}
          ${canWrite ? '<button type="button" class="tk-btn" id="btn-edit-level">등급 변경</button>' : ""}
        </div>
      </div>
    </section>`;
  }

  function levelHistModal() {
    const canWrite = SeMIS.canEdit();
    const hist = SeMIS.levelSorted().slice().reverse();
    openModal(`
      <h3>국가 항공보안등급 변경 이력</h3>
      <div class="lv-hist" id="level-box">
        ${hist.map(e => `<div class="lv-row${e.end && e.end < todayISO() ? " expired" : ""}">
          <span class="lv-range">${esc(lvRange(e))}</span>
          <span class="badge ${lvColor(e.level)} lv-badge">${esc(e.level)}</span>
          <span class="lv-note">${esc(e.note || "")}</span>
          ${canWrite && hist.length > 1 ? `<button class="mt-btn danger" data-lvdel="${esc(e.id)}" title="삭제" aria-label="삭제">${ico("x", 16)}</button>` : "<span></span>"}
        </div>`).join("")}
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" id="f-cancel">닫기</button></div>`);
    $("#f-cancel").onclick = closeModal;
    $$("#level-box [data-lvdel]").forEach(b => b.onclick = () =>
      confirmModal("이 등급 기록을 삭제하시겠습니까?", () => {
        D().levelHistory = D().levelHistory.filter(x => x.id !== b.dataset.lvdel);
        SeMIS.save(); SeMIS.renderSecBadge(); SeMIS.renderView(); toast("삭제되었습니다.");
      }));
  }

  SeMIS.registerModule("dashboard", {
    title: "대시보드",
    render(root) {
      const d = D();
      const canWrite = SeMIS.canEdit();
      const rank = SeMIS.roleRank();
      const notices = d.notices.slice().sort((a, b) =>
        (b.pinned - a.pinned) || String(b.created).localeCompare(String(a.created)));
      const upcoming = upcomingList();
      const wk = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const soon = upcoming.filter(s => String(s.start) <= wk).length;
      const upShow = upcoming.slice(0, 4);
      const actions = rank >= 2 ? openActions() : [];
      const late = actions.filter(a => a.due && a.due < todayISO()).length;
      const now = new Date();
      const today = todayISO();
      const schedMenu = SeMIS.data.menus.find(m => m.type === "module" && m.module === "schedule");
      const canSched = canWrite && SeMIS.hasModule("schedule") && schedMenu && SeMIS.navVisible(schedMenu);
      const canMinute = window.SemisMinutes && SemisMinutes.canWrite && SemisMinutes.canWrite();

      const acts = [
        canWrite ? `<button type="button" class="btn btn-soft" id="btn-add-notice">${ico("megaphone", 17)}<span>새 공지</span></button>` : "",
        canSched ? `<button type="button" class="btn btn-soft" id="btn-add-sched">${ico("calendar", 17)}<span>일정 추가</span></button>` : "",
        canMinute ? `<button type="button" class="btn btn-soft" id="btn-add-minute">${ico("notes", 17)}<span>회의록 작성</span></button>` : ""
      ].join("");

      const upcomingCard = cardVis("upcoming") ? `<section class="sheet-col dash-up" aria-label="다가오는 일정">
          <div class="dc-head"><h2>다가오는 일정</h2><span class="dc-meta">7일 내 <b class="mono" id="dash-soon">${soon}</b>건</span>
            <span class="spacer"></span><button type="button" class="link-btn" id="btn-go-schedule">일정관리</button></div>
          <div id="upcoming-box" class="up-list">${upShow.length ? upShow.map(s => {
            const dd = new Date(s.start + "T00:00:00");
            const isToday = s.start === today;
            const range = s.end && s.end !== s.start ? md(s.start) + " – " + md(s.end) : "";
            const when = [(!s.allDay && s.time) ? s.time + (s.timeEnd ? "–" + s.timeEnd : "") : "", range].filter(Boolean).join(" · ");
            return `<div class="up-row">
              <div class="up-date"><b class="mono">${esc(md(s.start))}</b><span class="${isToday ? "today" : ""}">${isToday ? "오늘" : (isNaN(dd) ? "" : WEEK[dd.getDay()])}</span></div>
              <div class="up-body"><span class="up-title${s.done ? " done" : ""}">${esc(s.title)}</span>
                ${when || s.assignee ? `<span class="up-sub">${esc([when, s.assignee].filter(Boolean).join(" · "))}</span>` : ""}</div>
              <span class="up-dot ev-${esc(window.SemisCalendar && SemisCalendar.pickColor ? SemisCalendar.pickColor(s.color) : (s.color || "blue"))}" aria-hidden="true"></span>
            </div>`;
          }).join("") : '<div class="empty">예정된 일정이 없습니다.</div>'}</div>
        </section>` : "";

      const noticeCol = `<section class="sheet-col" aria-label="공지사항">
          <div class="dc-head"><h2>공지사항</h2><span class="dc-meta mono">${notices.length}</span></div>
          <div id="notice-list" class="notice-list"></div>
        </section>`;
      const actionCol = cardVis("actions") && window.SemisMinutes ? `<section class="sheet-col" aria-label="회의 결정사항">
          <div class="dc-head"><h2>회의 결정사항</h2><span class="spacer"></span><button type="button" class="link-btn" id="btn-go-minutes">회의록</button></div>
          <div class="dc-nums">
            <div><span>미완료</span><b class="mono" id="dash-open-n">${actions.length}</b></div>
            <div class="${late ? "bad" : ""}"><span>기한 경과</span><b class="mono" id="dash-late-n">${late}</b></div>
          </div>
          <div id="actions-box" class="act-list"></div>
        </section>` : "";
      const build = cardVis("build") ? buildStatus() : [];
      const bLive = build.reduce((n, r) => n + r.live, 0), bTot = build.reduce((n, r) => n + r.total, 0);
      const buildCol = build.length ? `<section class="sheet-col" aria-label="모듈 구축 현황">
          <div class="dc-head"><h2>모듈 구축 현황</h2><span class="spacer"></span><span class="dc-meta mono"><b>${bLive}</b> / ${bTot}</span></div>
          <div class="build-list" id="dash-build">${build.map(r => `
            <button type="button" class="build-row" ${r.id ? `data-dash-hub="${esc(r.id)}"` : ""}>
              <span class="br-l">${esc(r.label)}</span>
              <span class="br-bar"><i style="width:${r.total ? Math.round(r.live / r.total * 100) : 0}%"></i></span>
              <span class="br-n mono">${r.live}/${r.total}</span>
            </button>`).join("")}</div>
        </section>` : "";

      const guest = rank < 2;
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">대시보드</div>
          <span class="page-meta mono">${esc(dotDate(today))} (${WEEK[now.getDay()]})</span>
          <span class="spacer"></span>
          ${acts ? `<div class="head-acts">${acts}</div>` : ""}
        </div>
        ${cardVis("status") ? `<div class="dash-top${guest ? " guest" : ""}">${ticketHTML(canWrite)}</div>` : ""}
        ${!guest && cardVis("screen") && window.SemisScreen && scrVisible() ? SemisScreen.dashHTML() : ""}
        ${guest ? `<section class="dash-card">${noticeCol}</section>`
          : `<div class="dash-sheet-wrap"><div class="dash-sheet cols-${[upcomingCard, noticeCol, actionCol, buildCol].filter(Boolean).length}">${upcomingCard}${noticeCol}${actionCol}${buildCol}</div></div>`}`;
      if (window.SemisHero3D && $("#dash-3d")) SemisHero3D.mount($("#dash-3d"));
      if (window.SemisScreen && $("#dash-scr")) SemisScreen.mountDash();

      // 공지 리스트
      const nl = $("#notice-list");
      if (nl) {
        if (!notices.length) nl.innerHTML = '<div class="empty">등록된 공지가 없습니다.</div>';
        notices.forEach(n => {
          const item = document.createElement("div");
          item.className = "notice-item";
          const filesHtml = (n.files && n.files.length)
            ? `<div class="nb-files-view">${n.files.map(f =>
                `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${ico("link", 14)} ${esc(f.name)}</a>`).join("")}</div>` : "";
          item.innerHTML = `
            <div class="notice-title">${n.pinned ? '<span class="badge badge-red">고정</span>' : ""}<span>${esc(n.title)}</span>${n.files && n.files.length ? `<span class="nt-clip" title="첨부 ${n.files.length}">${ico("link", 14)}</span>` : ""}</div>
            <div class="notice-meta">${esc(n.author)} · ${esc(fmtDate(n.created))}</div>
            <div class="notice-body">${n.bodyHtml ? `<div class="notice-html">${sanitizeHtml(n.bodyHtml)}</div>` : esc(n.body)}${filesHtml}${canWrite ? `<div class="nb-acts"><button class="btn btn-ghost btn-sm" data-edit="${esc(n.id)}">수정</button><button class="btn btn-danger btn-sm" data-del="${esc(n.id)}">삭제</button></div>` : ""}</div>`;
          item.addEventListener("click", (e) => {
            if (e.target.closest("button") || e.target.closest("a")) return;
            item.classList.toggle("open");
          });
          nl.appendChild(item);
        });
        $$("#notice-list [data-edit]").forEach(b => b.onclick = () => noticeForm(b.dataset.edit));
        $$("#notice-list [data-del]").forEach(b => b.onclick = () =>
          confirmModal("이 공지를 삭제하시겠습니까?", () => {
            D().notices = D().notices.filter(x => x.id !== b.dataset.del);
            SeMIS.save(); SeMIS.renderView(); toast("삭제되었습니다.");
          }));
      }

      // 회의 결정사항 미완료
      if ($("#actions-box")) {
        const t = todayISO();
        $("#actions-box").innerHTML = actions.length
          ? actions.slice(0, 5).map(a => `<button type="button" class="act-row" data-mn-open="${esc(a.mid)}" title="${esc(a.from)}">
              <span class="badge ${a.due && a.due < t ? "badge-red" : a.due ? "badge-amber" : "badge-gray"}">${a.due ? esc(md(a.due)) : "기한 없음"}</span>
              <span class="act-t">${esc(a.task)}</span>
              <span class="act-m">${esc(a.owner || a.from)}</span></button>`).join("")
          : `<div class="ok-line">${ico("check", 16)}모든 결정사항 처리 완료</div>`;
        $$("#actions-box [data-mn-open]").forEach(el => el.onclick = () => {
          if (window.SemisMinutes && SemisMinutes.open) SemisMinutes.open(el.dataset.mnOpen);
          else SeMIS.navigate("minutes");
        });
        if ($("#btn-go-minutes")) $("#btn-go-minutes").onclick = () => SeMIS.navigate("minutes");
      }
      if ($("#btn-go-schedule")) $("#btn-go-schedule").onclick = () => SeMIS.navigate("schedule");
      $$("[data-dash-hub]", root).forEach(el => el.onclick = () => SeMIS.openHub(el.dataset.dashHub));

      if ($("#btn-add-notice")) $("#btn-add-notice").onclick = () => noticeForm(null);
      if ($("#btn-edit-level")) $("#btn-edit-level").onclick = levelForm;
      if ($("#btn-edit-zero")) $("#btn-edit-zero").onclick = zeroForm;
      if ($("#btn-level-hist")) $("#btn-level-hist").onclick = levelHistModal;
      if ($("#btn-add-sched")) $("#btn-add-sched").onclick = () => {
        SeMIS.navigate("schedule");
        SeMIS.renderView();
        const b = document.getElementById("cal-add");
        if (b) b.click();
      };
      if ($("#btn-add-minute")) $("#btn-add-minute").onclick = () => SemisMinutes.newMinute();
    }
  });

  /* ───── 공지 HTML 살균 (script/이벤트핸들러/javascript: 제거) ───── */
  function sanitizeHtml(html) {
    const box = document.createElement("div");
    box.innerHTML = String(html || "");
    box.querySelectorAll("script,style,iframe,object,embed,form,link,meta,base").forEach(x => x.remove());
    box.querySelectorAll("*").forEach(el => {
      Array.from(el.attributes).forEach(a => {
        const nm = a.name.toLowerCase();
        if (nm.indexOf("on") === 0) el.removeAttribute(a.name);
        else if ((nm === "href" || nm === "src" || nm === "xlink:href") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
    return box.innerHTML;
  }
  const HTML_TAG_RE = /<\/?(?:b|i|u|s|strong|em|br|p|div|span|ul|ol|li|table|thead|tbody|tr|td|th|a|img|h[1-6]|blockquote|pre|code|hr|font)\b[^>]*>/i;
  function looksLikeHtml(s) { return HTML_TAG_RE.test(String(s || "")); }

  /* 이스케이프된 채 굳어버린 본문 복구 — 요소 노드가 이미 있으면 손대지 않아 멱등 */
  function repairEscapedRich(rec, base) {
    if (!rec) return false;
    const hk = base + "Html";
    const html = String(rec[hk] || "");
    if (!html || html.indexOf("&lt;") < 0) return false;
    const probe = document.createElement("div");
    probe.innerHTML = html;
    if (probe.querySelector("*")) return false;
    const src = probe.textContent || "";
    if (!looksLikeHtml(src)) return false;
    const fixed = sanitizeHtml(src);
    const t = document.createElement("div");
    t.innerHTML = fixed;
    rec[hk] = fixed;
    rec[base] = (t.textContent || "").replace(/ /g, " ").trim();
    return true;
  }

  /* 리치 에디터 공용: 붙여넣기/드래그앤드롭 파일·이미지 삽입 */
  function wireRichMedia(ed, prefix) {
    const insert = (html) => {
      ed.focus();
      try { if (!document.execCommand("insertHTML", false, html)) ed.innerHTML += html; }
      catch (e) { ed.innerHTML += html; }
    };
    async function addFiles(fileList) {
      for (const f of Array.from(fileList || [])) {
        try {
          if (/^image\//.test(f.type)) {
            const slim = await shrinkImage(f, 1400);
            if (window.SemisSync && typeof fetch !== "undefined") {
              const up = await SemisSync.uploadFile(slim, prefix);
              insert(`<img src="${esc(up.url)}" alt="${esc(f.name)}">`);
            } else {
              await new Promise((res) => {
                const r = new FileReader();
                r.onload = () => { insert(`<img src="${r.result}" alt="">`); res(); };
                r.onerror = () => res();
                r.readAsDataURL(slim);
              });
            }
          } else {
            if (f.size > 10 * 1024 * 1024) { toast(f.name + ": 10MB를 초과합니다.", true); continue; }
            if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 파일 첨부가 불가합니다.", true); continue; }
            const up = await SemisSync.uploadFile(f, prefix);
            insert(`<a class="nb-file" href="${esc(up.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>&nbsp;`);
          }
          toast("추가되었습니다: " + f.name);
        } catch (err) { toast("업로드 실패: " + f.name, true); }
      }
    }
    ed.addEventListener("paste", (ev) => {
      const cd = ev.clipboardData;
      const files = cd && cd.files;
      if (files && files.length) { ev.preventDefault(); addFiles(files); return; }
      if (!cd || !cd.getData) return;
      let htmlFlavor = "";
      try { htmlFlavor = cd.getData("text/html") || ""; } catch (e) { /* 일부 브라우저 미지원 */ }
      if (htmlFlavor) return;
      let plain = "";
      try { plain = cd.getData("text/plain") || ""; } catch (e) { return; }
      if (!plain || !looksLikeHtml(plain)) return;
      ev.preventDefault();
      insert(sanitizeHtml(plain));
      toast("붙여넣은 HTML 서식을 적용했습니다. (되돌리기: Ctrl+Z)");
    });
    ed.addEventListener("dragover", (ev) => ev.preventDefault());
    ed.addEventListener("drop", (ev) => {
      const files = ev.dataTransfer && ev.dataTransfer.files;
      if (files && files.length) { ev.preventDefault(); addFiles(files); }
    });
    return { insert, addFiles };
  }

  window.SemisNotice = { sanitizeHtml, shrinkImage, wireRichMedia, looksLikeHtml, repairEscapedRich };

  /* 이미지 축소(1400px, JPEG) — 실패 시 원본 유지 */
  function shrinkImage(file, maxW) {
    return new Promise((resolve) => {
      if (!/^image\//.test(file.type) || /gif|svg/.test(file.type) || file.size < 300 * 1024) return resolve(file);
      let url;
      try { url = URL.createObjectURL(file); } catch (e) { return resolve(file); }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, (maxW || 1400) / img.width);
          const cv = document.createElement("canvas");
          cv.width = Math.round(img.width * scale);
          cv.height = Math.round(img.height * scale);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          cv.toBlob(b => resolve(b ? new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file), "image/jpeg", 0.82);
        } catch (e) { resolve(file); }
      };
      img.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) {} resolve(file); };
      img.src = url;
    });
  }

  function noticeForm(id) {
    const n = id ? D().notices.find(x => x.id === id) : null;
    let files = n && Array.isArray(n.files) ? n.files.slice() : [];
    openModal(`
      <h3>${n ? "공지 수정" : "새 공지 작성"}</h3>
      <div class="form-row"><label>제목</label><input id="f-title" value="${esc(n ? n.title : "")}" maxlength="120"></div>
      <div class="form-row"><label>내용</label>
        <div class="nb-toolbar">
          <button type="button" data-cmd="bold" title="굵게"><b>B</b></button>
          <button type="button" data-cmd="italic" title="기울임"><i>I</i></button>
          <button type="button" data-cmd="underline" title="밑줄"><u>U</u></button>
          <button type="button" data-cmd="strikeThrough" title="취소선"><s>S</s></button>
          <span class="nb-sep"></span>
          <button type="button" data-cmd="insertUnorderedList" title="글머리 목록">•—</button>
          <button type="button" data-cmd="insertOrderedList" title="번호 목록">1.—</button>
          <span class="nb-sep"></span>
          <button type="button" id="nb-table" title="표 삽입 (3×3)">⊞ 표</button>
          <button type="button" id="nb-img" title="이미지 삽입">🖼 이미지</button>
          <button type="button" id="nb-link" title="선택 영역에 링크">🔗 링크</button>
        </div>
        <div id="nb-editor" class="nb-editor" contenteditable="true"></div>
        <input type="file" id="nb-imgfile" accept="image/*" style="display:none">
        <div class="form-hint">서식·표·이미지를 지원합니다. 이미지는 공용 저장소에 업로드되어 모든 사용자에게 표시됩니다.</div></div>
      <div class="form-row"><label>파일 첨부</label>
        <div id="nb-filelist" class="nb-files-view"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer">📎 파일 추가 (10MB 이하)
          <input type="file" id="nb-attach" style="display:none" multiple></label></div>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="f-pinned" style="width:auto" ${n && n.pinned ? "checked" : ""}> 상단 고정</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`, { wide: true });

    const ed = $("#nb-editor");
    ed.innerHTML = n ? (n.bodyHtml || esc(n.body || "").replace(/\n/g, "<br>")) : "";
    wireRichMedia(ed, "notices");

    const exec = (cmd, val) => { ed.focus(); try { document.execCommand(cmd, false, val); } catch (e) {} };
    const insertHTML = (h) => {
      ed.focus();
      try { if (!document.execCommand("insertHTML", false, h)) ed.innerHTML += h; }
      catch (e) { ed.innerHTML += h; }
    };
    $$(".nb-toolbar [data-cmd]").forEach(b => {
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => exec(b.dataset.cmd);
    });
    $("#nb-table").onclick = () => {
      const row = "<tr>" + "<td>&nbsp;</td>".repeat(3) + "</tr>";
      insertHTML(`<table class="nb-table"><tbody>${row.repeat(3)}</tbody></table><p><br></p>`);
    };
    $("#nb-link").onclick = () => {
      let url = "";
      try { url = window.prompt("링크 주소(URL)를 입력하세요", "https://") || ""; } catch (e) {}
      if (/^https?:\/\/.+/.test(url)) exec("createLink", url);
    };
    $("#nb-img").onclick = () => $("#nb-imgfile").click();
    $("#nb-imgfile").onchange = async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (!file) return;
      toast("이미지 처리 중…");
      try {
        const slim = await shrinkImage(file, 1400);
        if (!window.SemisSync) throw new Error("no-sync");
        const up = await SemisSync.uploadFile(slim, "notices");
        insertHTML(`<img src="${esc(up.url)}" alt="${esc(file.name)}">`);
        toast("이미지가 삽입되었습니다.");
      } catch (err) {
        try {
          const slim = await shrinkImage(file, 800);
          if (slim.size > 500 * 1024) throw new Error("too big");
          const reader = new FileReader();
          reader.onload = () => { insertHTML(`<img src="${reader.result}" alt="">`); toast("오프라인: 이미지를 문서에 내장했습니다."); };
          reader.onerror = () => toast("이미지 삽입 실패", true);
          reader.readAsDataURL(slim);
        } catch (e2) { toast("이미지 삽입 실패 — 네트워크를 확인하세요.", true); }
      }
    };

    const renderFileList = () => {
      $("#nb-filelist").innerHTML = files.map((f, i) =>
        `<span class="nb-file">📎 ${esc(f.name)} <button type="button" class="mt-btn danger" data-frm="${i}" title="첨부 삭제">✕</button></span>`).join("") ||
        '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      $$("#nb-filelist [data-frm]").forEach(b => b.onclick = () => { files.splice(Number(b.dataset.frm), 1); renderFileList(); });
    };
    renderFileList();
    $("#nb-attach").onchange = async (ev) => {
      const list = Array.from(ev.target.files || []);
      ev.target.value = "";
      for (const f of list) {
        if (f.size > 10 * 1024 * 1024) { toast(f.name + ": 10MB를 초과합니다.", true); continue; }
        if (!window.SemisSync) { toast("오프라인에서는 파일을 첨부할 수 없습니다.", true); break; }
        try {
          toast("업로드 중: " + f.name);
          const up = await SemisSync.uploadFile(f, "attach");
          files.push(up); renderFileList();
          toast("첨부되었습니다: " + f.name);
        } catch (err) { toast("업로드 실패: " + f.name, true); }
      }
    };

    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const title = $("#f-title").value.trim();
      if (!title) { toast("제목을 입력하세요.", true); return; }
      const bodyHtml = sanitizeHtml(ed.innerHTML);
      const tmp = document.createElement("div");
      tmp.innerHTML = bodyHtml;
      const body = (tmp.textContent || "").trim();
      const pinned = $("#f-pinned").checked;
      if (n) Object.assign(n, { title, body, bodyHtml, pinned, files });
      else D().notices.push({ id: uid("n"), title, body, bodyHtml, pinned, files,
        author: SeMIS.user.name, created: new Date().toISOString() });
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  function levelForm() {
    const cur = SeMIS.secCurrent();
    openModal(`
      <h3>국가 항공보안등급 변경</h3>
      <div class="form-row"><label>등급 (5단계)</label>
        <select id="f-level">${SeMIS.SEC_LEVELS.map(l =>
          `<option ${cur.level === l ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="form-grid">
        <div class="form-row"><label>시작일 (적용일)</label><input type="date" id="f-date" value="${esc(todayISO())}"></div>
        <div class="form-row"><label>종료일 (선택)</label><input type="date" id="f-end"></div>
      </div>
      <div class="form-hint" style="margin:-6px 0 12px">미래 시작일을 지정하면 <b>변경 예약</b>이 됩니다.
        종료일을 지정하면 그 다음 날부터 이전의 무기한 등급으로 자동 복귀하며, 비우면 다음 변경 시까지 적용됩니다.</div>
      <div class="form-row"><label>비고 (근거 등)</label><input id="f-note" maxlength="100" placeholder="예: 국토부 지침 제2026-OO호"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const date = $("#f-date").value;
      const end = $("#f-end").value;
      if (!date) { toast("시작일을 입력하세요.", true); return; }
      if (end && end < date) { toast("종료일이 시작일보다 빠릅니다.", true); return; }
      D().levelHistory.push({
        id: uid("lv"), date, end: end || "", level: $("#f-level").value,
        note: $("#f-note").value.trim(), by: SeMIS.user.name, at: new Date().toISOString()
      });
      SeMIS.save(); closeModal(); SeMIS.renderSecBadge(); SeMIS.renderView();
      toast(date > todayISO() ? "등급 변경이 예약되었습니다." : "보안등급이 변경되었습니다.");
    };
  }

  /* 무재해 기준일 설정 */
  function zeroForm() {
    const sb = D().safetyBoard || { since: "", note: "" };
    openModal(`
      <h3>무재해 기준일 설정</h3>
      <div class="form-row"><label>기준일 (무재해 시작일)</label><input type="date" id="f-since" value="${esc(sb.since || "")}"></div>
      <div class="form-row"><label>비고</label><input id="f-znote" maxlength="80" value="${esc(sb.note || "")}" placeholder="예: 2026년 인천화물터미널 무재해 운동 개시"></div>
      <div class="form-hint">대시보드 상단과 안전보안 현황 카드에 <b>D+경과일</b>로 표시됩니다. 사고 발생 시 기준일을 다시 설정하세요.</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const since = $("#f-since").value;
      if (since && since > todayISO()) { toast("기준일은 오늘 이전이어야 합니다.", true); return; }
      D().safetyBoard = { since: since || "", note: $("#f-znote").value.trim() };
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ════════════════ 시스템 설정 (관리자 전용) ════════════════ */
  SeMIS.registerModule("settings", {
    title: "시스템 설정",
    render(root) {
      if (!SeMIS.isAdmin()) {
        root.innerHTML = '<div class="card"><div class="empty">🔒 시스템관리자 전용 메뉴입니다.</div></div>';
        return;
      }
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">시스템 설정</div>
          <div class="page-desc">메뉴 · 사용자 권한 · 데이터 · 저장소 관리</div>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="menus">메뉴 관리</button>
          <button class="tab" data-tab="users">사용자 / 암호</button>
          <button class="tab" data-tab="assignees">담당자 관리</button>
          <button class="tab" data-tab="data">데이터 관리</button>
          <button class="tab" data-tab="storage">저장소 관리</button>
        </div>
        <div id="tab-body"></div>`;
      const tabs = { menus: renderMenuTab, users: renderUserTab, assignees: renderAssigneeTab,
        data: renderDataTab, storage: renderStorageTab };
      $$(".tab").forEach(t => t.onclick = () => {
        $$(".tab").forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        tabs[t.dataset.tab]($("#tab-body"));
      });
      renderMenuTab($("#tab-body"));
    }
  });

  /* ───── 메뉴 관리 탭 ───── */
  function renderMenuTab(box) {
    const menus = SeMIS.sortedMenus();
    const typeBadge = (m) =>
      m.type === "group" ? '<span class="badge badge-gray mt-type">허브</span>'
      : m.type === "link" ? (m.open === "group"
        ? '<span class="badge badge-blue mt-type">링크 묶음 ⊞</span>'
        : m.open === "frame"
          ? '<span class="badge badge-blue mt-type">링크 ▣ 내부</span>'
          : '<span class="badge badge-blue mt-type">링크 ↗</span>')
      : (m.planned && !SeMIS.hasModule(m.module))
        ? '<span class="badge badge-amber mt-type">예정 모듈</span>'
        : '<span class="badge badge-green mt-type">모듈</span>';

    const row = (m, depth) => `
      <div class="menu-tree-item ${depth ? "is-child" : ""}${depth > 1 ? " is-sub" : ""}${m.hidden ? " is-hidden" : ""}" data-id="${esc(m.id)}">
        <span class="mt-ico">${m.type === "group" ? SeMIS.icon(m.ico, 18) : esc(m.icon || "▪")}</span>
        <span class="mt-label">${esc(m.label)}
          ${m.hidden ? '<span class="badge badge-gray mt-type">숨김</span>' : ""}
          ${m.quick ? '<span class="badge badge-amber mt-type">고정</span>' : ""}</span>
        ${m.type === "link" && m.url
          ? `<span class="mt-url col-ext" title="${esc(m.url)}">${esc(m.url)}</span>`
          : m.type === "module" && m.module
            ? `<span class="mt-url col-ext mt-url-mod" title="라우트 #/${esc(m.module)}">#/${esc(m.module)}</span>`
            : ""}
        ${typeBadge(m)}
        ${m.type === "group" ? "" : `<span class="badge badge-gray mt-type">${esc(SeMIS.VIS_LABEL[m.vis || "all"] || "전체")}</span>`}
        <span class="mt-actions">
          <button class="mt-btn" data-up="${esc(m.id)}" title="위로">▲</button>
          <button class="mt-btn" data-down="${esc(m.id)}" title="아래로">▼</button>
          ${SeMIS.canHide(m)
            ? `<button class="mt-btn${m.hidden ? " on" : ""}" data-hide="${esc(m.id)}" title="${m.hidden ? "다시 표시" : "화면에서 숨기기"}">${m.hidden ? "🙈" : "👁"}</button>`
            : ""}
          <button class="mt-btn" data-edit="${esc(m.id)}" title="수정">✏️</button>
          ${m.module === "settings" || m.module === "dashboard" ? "" :
            `<button class="mt-btn danger" data-del="${esc(m.id)}" title="삭제">🗑</button>`}
        </span>
      </div>`;

    let html = `
      <div class="card">
        <div class="card-title">메뉴 구성 <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" id="btn-add-menu">+ 메뉴 추가</button></div>
        <p class="form-hint" style="margin-bottom:12px"><b>허브</b>는 왼쪽 아이콘 줄에 표시되는 업무 묶음입니다. 허브 없는 항목은 아이콘 줄 아래(관리)에 놓입니다. ▲▼ 순서 · 👁 숨기기(권한과 별개).</p>
        <div id="menu-tree">`;
    const walk = (m, depth) => {
      html += row(m, depth);
      if (depth < 2) menus.filter(c => c.parent === m.id).forEach(c => walk(c, depth + 1));
    };
    menus.filter(m => !m.parent || m.type === "group").forEach(m => walk(m, 0));
    html += `</div></div>`;
    box.innerHTML = html;

    $("#btn-add-menu").onclick = () => menuForm(null);
    $$("#menu-tree [data-edit]").forEach(b => b.onclick = () => menuForm(b.dataset.edit));
    $$("#menu-tree [data-up]").forEach(b => b.onclick = () => moveMenu(b.dataset.up, -1));
    $$("#menu-tree [data-down]").forEach(b => b.onclick = () => moveMenu(b.dataset.down, 1));
    $$("#menu-tree [data-hide]").forEach(b => b.onclick = () => {
      const m = D().menus.find(x => x.id === b.dataset.hide);
      if (!m || !SeMIS.canHide(m)) return;
      if (m.hidden) delete m.hidden; else m.hidden = true;
      SeMIS.save(); SeMIS.renderNav(); renderMenuTab($("#tab-body"));
      toast(m.hidden ? `"${m.label}" 메뉴를 화면에서 숨겼습니다.` : `"${m.label}" 메뉴를 다시 표시합니다.`);
    });
    $$("#menu-tree [data-del]").forEach(b => b.onclick = () => {
      const m = D().menus.find(x => x.id === b.dataset.del);
      const kids = D().menus.filter(x => x.parent === m.id).length;
      const msg = m.type === "group"
        ? `허브 "${m.label}"와 하위 메뉴가 모두 삭제됩니다. 계속하시겠습니까?`
        : kids
          ? `"${m.label}"와 하위 링크 ${kids}개가 모두 삭제됩니다. 계속하시겠습니까?`
          : `메뉴 "${m.label}"을(를) 삭제하시겠습니까?`;
      confirmModal(msg, () => {
        D().menus = D().menus.filter(x => x.id !== m.id && x.parent !== m.id);
        SeMIS.save(); SeMIS.renderNav(); renderMenuTab($("#tab-body")); toast("삭제되었습니다.");
      });
    });
  }

  function moveMenu(id, dir) {
    const menus = SeMIS.sortedMenus();
    const me = menus.find(m => m.id === id);
    const siblings = menus.filter(m =>
      me.parent ? m.parent === me.parent : (!m.parent || m.type === "group"));
    const idx = siblings.findIndex(m => m.id === id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    const real1 = D().menus.find(m => m.id === me.id);
    const real2 = D().menus.find(m => m.id === swap.id);
    const t = real1.seq; real1.seq = real2.seq; real2.seq = t;
    SeMIS.save(); SeMIS.renderNav(); renderMenuTab($("#tab-body"));
  }

  function menuForm(id) {
    const m = id ? D().menus.find(x => x.id === id) : null;
    const groups = SeMIS.sortedMenus().filter(x => x.type === "group");
    const sets = SeMIS.sortedMenus().filter(x => x.type === "link" && x.open === "group" && (!m || x.id !== m.id));
    const isCore = m && m.type === "module";
    const type = m ? m.type : "link";
    openModal(`
      <h3>${m ? "메뉴 수정" : "메뉴 추가"}</h3>
      ${m ? "" : `<div class="form-row"><label>유형</label>
        <select id="f-type">
          <option value="link">외부 링크 (웹주소 등록)</option>
          <option value="group">허브 (업무 묶음)</option>
          <option value="planned">예정 모듈 (준비 중 안내 화면)</option>
        </select></div>`}
      <div class="form-row"><label>이름</label><input id="f-label" value="${esc(m ? m.label : "")}" maxlength="40" placeholder="메뉴 이름"></div>
      <div class="form-row" id="row-icon" ${type === "group" ? 'style="display:none"' : ""}>
        <label>아이콘 (검색·관리 화면용 이모지)</label><input id="f-icon" value="${esc(m ? m.icon || "" : "🔗")}" maxlength="4"></div>
      <div class="form-row" id="row-ico" ${type === "group" ? "" : 'style="display:none"'}>
        <label>허브 아이콘</label>
        <div class="ico-pick">${SeMIS.HUB_ICONS.map(k => `<label class="ico-opt" title="${esc(k)}">
          <input type="radio" name="f-ico" value="${esc(k)}" ${(m && m.ico ? m.ico : "folder") === k ? "checked" : ""}>${SeMIS.icon(k, 20)}</label>`).join("")}</div></div>
      <div class="form-row" id="row-url" ${type !== "link" ? 'style="display:none"' : ""}>
        <label>웹주소 (URL)</label><input id="f-url" value="${esc(m && m.url ? m.url : "")}" placeholder="https://...">
        <div class="form-hint">기존 구글 문서/시트/사이트 등 외부 주소를 그대로 연결합니다.</div></div>
      <div class="form-row" id="row-open" ${type !== "link" ? 'style="display:none"' : ""}>
        <label>열기 방식</label>
        <select id="f-open">
          <option value="tab" ${!m || (m.open !== "frame" && m.open !== "group") ? "selected" : ""}>새 탭(새 창)에서 열기 ↗</option>
          <option value="frame" ${m && m.open === "frame" ? "selected" : ""}>시스템 내부 화면에서 열기 ▣</option>
          <option value="group" ${m && m.open === "group" ? "selected" : ""}>링크 묶음 — 하위 링크 카드 화면 ⊞</option>
        </select>
        <div class="form-hint">일부 사이트는 내부 열기(iframe)를 차단합니다. 화면이 비어 보이면 새 탭 방식으로 변경하세요.<br><b>링크 묶음</b>은 메뉴 한 줄로 두고, 눌렀을 때 하위 링크를 카드로 펼쳐 보여 줍니다. 하위 링크는 아래 '소속'에서 이 묶음을 골라 추가하세요.</div></div>
      <div class="form-row" id="row-route" style="display:none">
        <label>모듈 ID (라우트)</label><input id="f-route" maxlength="30" placeholder="영문 소문자·숫자·하이픈 (예: dg-check)">
        <div class="form-hint">나중에 같은 ID로 모듈 파일이 등록되면 이 메뉴가 실화면으로 연결됩니다.</div></div>
      <div class="form-row" id="row-desc" ${m && m.planned ? "" : 'style="display:none"'}>
        <label>모듈 개요 (준비 중 화면에 표시)</label><textarea id="f-desc" maxlength="400">${esc(m && m.desc ? m.desc : "")}</textarea></div>
      <div class="form-row" id="row-parent" ${type === "group" ? 'style="display:none"' : ""}>
        <label>소속 (허브 · 링크 묶음)</label>
        <select id="f-parent">
          <option value="">(허브 없음 · 아이콘 줄 아래 관리)</option>
          ${groups.map(g => `<option value="${esc(g.id)}" ${m && m.parent === g.id ? "selected" : ""}>${esc(g.label)}</option>`).join("")}
          ${sets.map(g => `<option value="${esc(g.id)}" ${m && m.parent === g.id ? "selected" : ""}>⊞ ${esc(g.label)} (링크 묶음)</option>`).join("")}
        </select>
        <div class="form-hint">링크 묶음을 고르면 사이드바에는 나오지 않고 그 묶음 화면 안의 카드로만 표시됩니다.</div></div>
      <div class="form-row" id="row-vis" ${type === "group" ? 'style="display:none"' : ""}>
        <label>접근 권한</label>
        <select id="f-vis">
          <option value="all" ${!m || m.vis === "all" ? "selected" : ""}>전체 사용자</option>
          <option value="mgr" ${m && m.vis === "mgr" ? "selected" : ""}>화물팀 관리자 이상 (열람그룹)</option>
          <option value="hq" ${m && m.vis === "hq" ? "selected" : ""}>안전보안파트 이상 (편집그룹)</option>
          <option value="admin" ${m && m.vis === "admin" ? "selected" : ""}>시스템관리자만</option>
        </select></div>
      <div class="form-row" id="row-quick" ${type === "group" ? 'style="display:none"' : ""}>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="f-quick" style="width:auto" ${m && m.quick ? "checked" : ""}> 홈 허브 '고정한 메뉴'에 표시</label></div>
      <div class="form-row" id="row-hide" ${m && !SeMIS.canHide(m) ? 'style="display:none"' : ""}>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="f-hidden" style="width:auto" ${m && m.hidden ? "checked" : ""}> 화면에서 숨기기 (모든 권한 공통)</label>
        <div class="form-hint">권한과 별개입니다. 사이드바·통합검색·대시보드 카드에서 사라지며, 기능과 데이터는 그대로 유지됩니다.</div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);

    const typeSel = $("#f-type");
    if (typeSel) typeSel.onchange = () => {
      const t = typeSel.value;
      $("#row-url").style.display = t === "link" ? "" : "none";
      $("#row-open").style.display = t === "link" ? "" : "none";
      $("#row-route").style.display = t === "planned" ? "" : "none";
      $("#row-desc").style.display = t === "planned" ? "" : "none";
      $("#row-parent").style.display = t === "group" ? "none" : "";
      $("#row-vis").style.display = t === "group" ? "none" : "";
      $("#row-quick").style.display = t === "group" ? "none" : "";
      $("#row-icon").style.display = t === "group" ? "none" : "";
      $("#row-ico").style.display = t === "group" ? "" : "none";
    };
    $("#f-cancel").onclick = closeModal;
    const hiddenVal = () => !!($("#f-hidden") && $("#f-hidden").checked);
    const applyHidden = (obj) => { if (hiddenVal() && SeMIS.canHide(obj)) obj.hidden = true; else delete obj.hidden; return obj; };
    $("#f-save").onclick = () => {
      const label = $("#f-label").value.trim();
      if (!label) { toast("이름을 입력하세요.", true); return; }
      const t = m ? m.type : typeSel.value;
      const icon = $("#f-icon") ? $("#f-icon").value.trim() : "";
      if (t === "link") {
        const url = $("#f-url").value.trim();
        const open = ["frame", "group"].indexOf($("#f-open").value) >= 0 ? $("#f-open").value : "tab";
        if (open === "group" ? (url && !/^https?:\/\/.+/.test(url)) : !/^https?:\/\/.+/.test(url)) {
          toast(open === "group" ? "웹주소는 비워 두거나 https:// 형식으로 입력하세요." : "올바른 웹주소(https://...)를 입력하세요.", true); return;
        }
        const par = $("#f-parent").value || null;
        if (m && par === m.id) { toast("자기 자신을 소속으로 지정할 수 없습니다.", true); return; }
        if (m && open !== "group" && D().menus.some(x => x.parent === m.id)) {
          toast("하위 링크가 있는 묶음입니다. 하위 링크를 먼저 옮기거나 지우세요.", true); return;
        }
        if (open === "group" && par) {
          const pp = D().menus.find(x => x.id === par);
          if (pp && pp.type === "link" && pp.parent) { toast("링크 묶음은 두 단계까지만 지원합니다.", true); return; }
        }
        if (m) applyHidden(Object.assign(m, { label, icon, url, open, parent: par, vis: $("#f-vis").value, quick: $("#f-quick").checked }));
        else D().menus.push(applyHidden({ id: uid("mn"), seq: nextSeq(), type: "link", label, icon, url, open,
          parent: par, vis: $("#f-vis").value, quick: $("#f-quick").checked }));
      } else if (t === "group") {
        const pick = document.querySelector('#modal-box input[name="f-ico"]:checked');
        const ico = pick ? pick.value : "folder";
        if (m) applyHidden(Object.assign(m, { label, ico }));
        else D().menus.push(applyHidden({ id: uid("g"), seq: nextSeq(), type: "group", label, ico }));
      } else if (t === "planned") {
        const route = $("#f-route").value.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(route)) { toast("모듈 ID는 영문 소문자·숫자·하이픈 2~30자입니다.", true); return; }
        if (D().menus.some(x => x.type === "module" && x.module === route)) { toast("이미 같은 모듈 ID의 메뉴가 있습니다.", true); return; }
        D().menus.push(applyHidden({ id: uid("mn"), seq: nextSeq(), type: "module", module: route, planned: true,
          desc: $("#f-desc").value.trim(), label, icon, parent: $("#f-parent").value || null,
          vis: $("#f-vis").value, quick: $("#f-quick").checked }));
      } else if (isCore) {
        applyHidden(Object.assign(m, { label, icon, parent: $("#f-parent").value || null, vis: $("#f-vis").value,
          quick: $("#f-quick") ? $("#f-quick").checked : !!m.quick }));
        if (m.planned) m.desc = $("#f-desc").value.trim();
        if (m.module === "dashboard") { m.vis = "all"; m.parent = null; }
        if (m.module === "settings") { m.vis = "admin"; m.parent = null; }
      }
      SeMIS.save(); closeModal(); SeMIS.renderNav(); renderMenuTab($("#tab-body")); toast("저장되었습니다.");
    };
  }
  function nextSeq() {
    return D().menus.reduce((mx, m) => Math.max(mx, m.seq || 0), 0) + 1;
  }

  /* ───── 사용자 / 암호 탭 (admin이 전 계정 완전 관리) ───── */
  const ROLE_BADGE = { admin: "badge-red", hq: "badge-amber", manager: "badge-blue", user: "badge-gray", vendor: "badge-green" };
  const ROLE_OPTS = [
    ["user", "일반사용자 (화물팀 직원·조업사 — 일반·안내 열람)"],
    ["manager", "화물팀 관리자 (관리 항목 열람 전용)"],
    ["hq", "안전보안파트 (파트원 · 편집 가능)"],
    ["vendor", "협력업체 (업체별 허용 메뉴만)"],
    ["admin", "시스템관리자"]];
  const vendorRowHTML = (u) => `
      <div class="form-row" id="row-vendor" ${u && u.role === "vendor" ? "" : 'style="display:none"'}>
        <label>업체명 (협력업체 계정)</label>
        <input id="f-uvendor" maxlength="30" value="${esc(u && u.vendor ? u.vendor : "")}" placeholder="예: ○○조업">
        <div class="form-hint">협력업체 계정은 업체별로 허용된 메뉴(js/app.js VENDOR_ACCESS)만 접근합니다. 레코드 삭제는 항상 차단.${vendorScopeHint()}</div></div>`;
  function vendorScopeHint() {
    const acc = SeMIS.VENDOR_ACCESS || {};
    const rows = Object.keys(acc).map(name => {
      const a = acc[name] || {};
      const names = (a.routes || []).map(r => {
        const mn = D().menus.find(m => m && m.type === "module" && m.module === r);
        return (mn && mn.label) || r;
      }).concat((a.links || []).map(l => l.label));
      return `<br>· ${esc(name)}: ${esc(names.join(" · "))} <b>${a.edit ? "[편집 가능]" : "[열람 전용]"}</b>`;
    });
    return rows.length ? rows.join("") : "<br>· 현재 등록된 업체 프리셋 없음 (기본: 대시보드만)";
  }
  function wireVendorRow() {
    const sel = $("#f-urole");
    if (!sel) return;
    const upd = () => { $("#row-vendor").style.display = sel.value === "vendor" ? "" : "none"; };
    sel.addEventListener("change", upd); upd();
  }
  function renderUserTab(box) {
    const users = SeMIS.allUsers();
    box.innerHTML = `
      <div class="card">
        <div class="card-title">사용자 계정 <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" id="btn-add-user">+ 사용자 추가</button></div>
        <p class="form-hint" style="margin-bottom:12px">
          <b>암호만 입력</b>해 로그인하므로 사용자마다 암호가 달라야 합니다. 암호는 해시로만 저장됩니다.<br>
          최고관리자(mark3464)는 잠금 방지를 위해 권한 변경·삭제가 불가합니다.</p>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>계정</th><th>이름</th><th>권한</th><th style="width:240px">관리</th></tr></thead>
          <tbody>
          ${users.map((u, i) => `<tr>
            <td><b>${esc(u.id)}</b>${u.base ? ' <span style="font-size:.68rem;color:var(--text-3)">기본</span>' : ""}</td>
            <td>${esc(u.name)}${u.vendor ? ` <span class="badge badge-green">${esc(u.vendor)}</span>` : ""}</td>
            <td><span class="badge ${ROLE_BADGE[u.role] || "badge-gray"}">${esc(SeMIS.ROLE_LABEL[u.role] || u.role)}</span></td>
            <td>
              <button class="btn btn-ghost btn-sm" data-edit="${i}">수정</button>
              <button class="btn btn-ghost btn-sm" data-pw="${i}">암호 변경</button>
              ${u.origId === "mark3464" ? "" : `<button class="btn btn-danger btn-sm" data-del="${i}">삭제</button>`}
            </td></tr>`).join("")}
          </tbody></table></div>
      </div>`;
    $("#btn-add-user").onclick = () => userForm();
    $$("[data-edit]", box).forEach(b => b.onclick = () => editUserForm(users[Number(b.dataset.edit)]));
    $$("[data-pw]", box).forEach(b => b.onclick = () => pwForm(users[Number(b.dataset.pw)]));
    $$("[data-del]", box).forEach(b => b.onclick = () => {
      const u = users[Number(b.dataset.del)];
      if (SeMIS.user && u.origId === (SeMIS.user.origId || SeMIS.user.id)) {
        toast("로그인 중인 본인 계정은 삭제할 수 없습니다.", true); return;
      }
      confirmModal(`사용자 "${u.id}" (${u.name})을(를) 삭제하시겠습니까?`, () => {
        if (u.base) {
          D().userOverrides[u.origId] = Object.assign({}, D().userOverrides[u.origId], { deleted: true });
        } else {
          D().customUsers = D().customUsers.filter(x => x.id !== u.origId);
        }
        SeMIS.save(); renderUserTab($("#tab-body")); toast("삭제되었습니다.");
      });
    });
  }

  function editUserForm(u) {
    const lockRole = u.origId === "mark3464";
    openModal(`
      <h3>계정 수정 — ${esc(u.origId)}${u.base ? ' <span class="badge badge-gray">기본 계정</span>' : ""}</h3>
      <div class="form-grid">
        <div class="form-row"><label>계정 ID</label><input id="f-uid" maxlength="20" value="${esc(u.id)}"></div>
        <div class="form-row"><label>이름</label><input id="f-uname" maxlength="20" value="${esc(u.name)}"></div>
      </div>
      <div class="form-row"><label>권한${lockRole ? " (최고관리자 — 변경 불가)" : ""}</label>
        <select id="f-urole" ${lockRole ? "disabled" : ""}>
          ${ROLE_OPTS.map(([v, lb]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${lb}</option>`).join("")}
        </select></div>
      ${vendorRowHTML(u)}
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);
    wireVendorRow();
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const id = $("#f-uid").value.trim(), name = $("#f-uname").value.trim();
      const role = lockRole ? "admin" : $("#f-urole").value;
      const vendor = role === "vendor" ? $("#f-uvendor").value.trim() : "";
      if (role === "vendor" && !vendor) { toast("업체명을 입력하세요.", true); return; }
      if (!/^[A-Za-z0-9_-]{2,20}$/.test(id)) { toast("계정 ID는 영문/숫자 2~20자입니다.", true); return; }
      if (!name) { toast("이름을 입력하세요.", true); return; }
      if (SeMIS.allUsers().some(x => x.id === id && x.origId !== u.origId)) { toast("이미 존재하는 계정 ID입니다.", true); return; }
      if (u.base) {
        const ov = Object.assign({}, D().userOverrides[u.origId]);
        ov.id = id; ov.name = name;
        if (!lockRole) { ov.role = role; ov.vendor = vendor; }
        D().userOverrides[u.origId] = ov;
      } else {
        const cu = D().customUsers.find(x => x.id === u.origId);
        if (cu) { cu.id = id; cu.name = name; cu.role = role; cu.vendor = vendor; }
      }
      SeMIS.save(); closeModal(); renderUserTab($("#tab-body")); toast("계정 정보가 변경되었습니다.");
    };
  }

  function hashInUse(hash, exceptId) {
    return SeMIS.allUsers().some(u => u.hash === hash && u.id !== exceptId);
  }

  function pwForm(u) {
    const userId = u.origId || u.id;
    openModal(`
      <h3>암호 변경 — ${esc(u.id)}</h3>
      <div class="form-row"><label>새 암호</label><input type="password" id="f-pw1" autocomplete="new-password"></div>
      <div class="form-row"><label>새 암호 확인</label><input type="password" id="f-pw2" autocomplete="new-password"></div>
      <div class="form-hint">4자 이상. 다른 사용자와 동일한 암호는 사용할 수 없습니다.</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">변경</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const p1 = $("#f-pw1").value, p2 = $("#f-pw2").value;
      if (p1.length < 4) { toast("암호는 4자 이상이어야 합니다.", true); return; }
      if (p1 !== p2) { toast("암호가 일치하지 않습니다.", true); return; }
      const h = SeMIS.pwHash(p1);
      if (hashInUse(h, userId)) { toast("다른 사용자가 사용 중인 암호입니다.", true); return; }
      const cu = D().customUsers.find(x => x.id === userId);
      if (cu) cu.hash = h;
      else D().pwOverrides[userId] = h;
      SeMIS.save(); closeModal(); toast("암호가 변경되었습니다.");
    };
  }

  function userForm() {
    openModal(`
      <h3>사용자 추가</h3>
      <div class="form-grid">
        <div class="form-row"><label>계정 ID</label><input id="f-uid" maxlength="20" placeholder="영문/숫자"></div>
        <div class="form-row"><label>이름</label><input id="f-uname" maxlength="20" placeholder="표시 이름"></div>
      </div>
      <div class="form-row"><label>권한</label>
        <select id="f-urole">
          ${ROLE_OPTS.map(([v, lb]) => `<option value="${v}">${lb}</option>`).join("")}
        </select></div>
      ${vendorRowHTML(null)}
      <div class="form-row"><label>암호</label><input type="password" id="f-upw" autocomplete="new-password"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">추가</button>
      </div>`);
    wireVendorRow();
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const id = $("#f-uid").value.trim(), name = $("#f-uname").value.trim(), pw = $("#f-upw").value;
      const role = $("#f-urole").value;
      const vendor = role === "vendor" ? $("#f-uvendor").value.trim() : "";
      if (!/^[A-Za-z0-9_-]{2,20}$/.test(id)) { toast("계정 ID는 영문/숫자 2~20자입니다.", true); return; }
      if (SeMIS.allUsers().some(u => u.id === id)) { toast("이미 존재하는 계정입니다.", true); return; }
      if (!name) { toast("이름을 입력하세요.", true); return; }
      if (role === "vendor" && !vendor) { toast("업체명을 입력하세요.", true); return; }
      if (pw.length < 4) { toast("암호는 4자 이상이어야 합니다.", true); return; }
      const h = SeMIS.pwHash(pw);
      if (hashInUse(h, id)) { toast("다른 사용자가 사용 중인 암호입니다.", true); return; }
      D().customUsers.push({ id, name, role, vendor, hash: h });
      SeMIS.save(); closeModal(); renderUserTab($("#tab-body")); toast("사용자가 추가되었습니다.");
    };
  }

  /* 일정의 담당자 문자열(", " 구분 다중) → 이름 배열. calendar.js 와 같은 규칙. */
  const splitNames = (v) => String(v == null ? "" : v).split(/\s*[,、·]\s*/).map(x => x.trim()).filter(Boolean);
  const joinNames = (arr) => Array.from(new Set((arr || []).map(x => String(x).trim()).filter(Boolean))).join(", ");

  /* ═════════════ 담당자 관리 탭 (일정관리 담당자 카테고리) ═════════════
     일정관리의 담당자 칩·필터·선택 버튼에 쓰이는 목록(DATA.assignees)을
     시스템관리자가 직접 관리한다. 여기서 바꾼 내용은 공용 DB로 즉시 공유된다. */
  function renderAssigneeTab(box) {
    const list = SeMIS.assignees();
    const used = {};
    (D().schedules || []).forEach(sc => splitNames(sc && sc.assignee).forEach(n => { used[n] = (used[n] || 0) + 1; }));
    const free = Object.keys(used).filter(n => !list.some(a => a.name === n)).sort();
    box.innerHTML = `
      <div class="card">
        <div class="card-title">🧭 일정 담당자 <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" id="btn-add-as">+ 담당자 추가</button></div>
        <p class="form-hint" style="margin-bottom:12px">
          일정관리의 <b>담당자 선택 버튼 · 필터 · 칩 태그</b>에 쓰이는 목록입니다. 일정 하나에 여러 명을 지정할 수 있습니다.<br>
          목록에 없는 이름을 직접 입력하면 아래 <b>직접 입력된 담당자</b>에 모이고, 담당자를 지워도 기존 일정의 이름은 남습니다.</p>
        <div class="table-wrap"><table class="tbl as-tbl">
          <colgroup><col style="width:70px"><col style="width:84px"><col><col><col style="width:90px"><col style="width:96px"><col style="width:150px"></colgroup>
          <thead><tr><th>순서</th><th>아이콘</th><th>이름</th><th>소속 / 직책</th><th>약칭</th><th>배정 일정</th><th>관리</th></tr></thead>
          <tbody>
          ${list.length ? list.map((a, i) => `<tr>
            <td>
              <button class="mt-btn" data-as-up="${esc(a.id)}" title="위로" ${i === 0 ? "disabled" : ""}>▲</button>
              <button class="mt-btn" data-as-down="${esc(a.id)}" title="아래로" ${i === list.length - 1 ? "disabled" : ""}>▼</button></td>
            <td style="font-size:1.15rem;text-align:center">${esc(a.emoji)}</td>
            <td><b>${esc(a.name)}</b></td>
            <td>${esc(a.title || "-")}</td>
            <td><span class="chip-tag as-chip">${esc(a.short)}</span></td>
            <td>${used[a.name] ? esc(String(used[a.name])) + "건" : '<span style="color:var(--text-3)">-</span>'}</td>
            <td>
              <button class="btn btn-ghost btn-sm" data-as-edit="${esc(a.id)}">수정</button>
              <button class="btn btn-danger btn-sm" data-as-del="${esc(a.id)}">삭제</button></td>
          </tr>`).join("") : '<tr><td colspan="7"><div class="empty">등록된 담당자가 없습니다. [+ 담당자 추가]로 등록하세요.</div></td></tr>'}
          </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title">✍️ 직접 입력된 담당자 <span class="badge badge-gray">${free.length}명</span></div>
        <p class="form-hint" style="margin-bottom:10px">일정에 직접 입력된, 목록에 없는 이름입니다.</p>
        ${free.length ? `<div class="as-free">${free.map(n =>
          `<span class="as-free-item">${esc(n)} <span class="as-free-n">${used[n]}건</span>
            <button class="btn btn-ghost btn-sm" data-as-promote="${esc(n)}">목록에 추가</button></span>`).join("")}</div>`
          : '<div class="empty" style="padding:18px">직접 입력된 담당자가 없습니다.</div>'}
      </div>`;

    $("#btn-add-as").onclick = () => assigneeForm(null);
    $$("[data-as-edit]", box).forEach(b => b.onclick = () => assigneeForm(b.dataset.asEdit));
    $$("[data-as-promote]", box).forEach(b => b.onclick = () => assigneeForm(null, b.dataset.asPromote));
    $$("[data-as-up]", box).forEach(b => b.onclick = () => moveAssignee(b.dataset.asUp, -1));
    $$("[data-as-down]", box).forEach(b => b.onclick = () => moveAssignee(b.dataset.asDown, 1));
    $$("[data-as-del]", box).forEach(b => b.onclick = () => {
      const a = SeMIS.assignees().find(x => x.id === b.dataset.asDel);
      if (!a) return;
      const n = used[a.name] || 0;
      confirmModal(`담당자 "${a.name}"을(를) 목록에서 삭제하시겠습니까?` +
        (n ? ` 배정된 일정 ${n}건의 담당자 이름은 그대로 유지됩니다.` : ""), () => {
        D().assignees = (D().assignees || []).filter(x => x.id !== a.id);
        SeMIS.save(); renderAssigneeTab($("#tab-body")); toast("삭제되었습니다.");
      });
    });
  }

  function moveAssignee(id, dir) {
    const list = SeMIS.assignees();
    const i = list.findIndex(a => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const a = D().assignees.find(x => x.id === list[i].id);
    const b = D().assignees.find(x => x.id === list[j].id);
    const t = a.seq; a.seq = b.seq; b.seq = t;
    SeMIS.save(); renderAssigneeTab($("#tab-body"));
  }

  /* 담당자 추가·수정 폼 (preset: 직접 입력 이름을 목록으로 승격할 때 채워 넣을 이름) */
  function assigneeForm(id, preset) {
    const a = id ? SeMIS.assignees().find(x => x.id === id) : null;
    const nm = a ? a.name : (preset || "");
    openModal(`
      <h3>${a ? "담당자 수정" : "담당자 추가"}</h3>
      <div class="form-grid">
        <div class="form-row"><label>이름</label><input id="f-asname" maxlength="20" value="${esc(nm)}" placeholder="예: 홍길동"></div>
        <div class="form-row"><label>소속 / 직책 (선택)</label><input id="f-astitle" maxlength="30" value="${esc(a ? a.title : "")}" placeholder="예: 안전보안파트"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>아이콘 (이모지)</label><input id="f-asemoji" maxlength="4" value="${esc(a ? a.emoji : "👤")}"></div>
        <div class="form-row"><label>약칭 (일정 칩 표시)</label><input id="f-asshort" maxlength="3" value="${esc(a ? a.short : (nm ? nm.slice(-1) : ""))}" placeholder="예: 홍"></div>
      </div>
      <div class="form-hint">약칭은 캘린더 일정 칩에 표시되는 한두 글자입니다. 비우면 이름 끝 글자가 쓰입니다.</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);
    const nameEl = $("#f-asname"), shortEl = $("#f-asshort");
    nameEl.oninput = () => { if (!shortEl.dataset.touched) shortEl.value = nameEl.value.trim().slice(-1); };
    shortEl.oninput = () => { shortEl.dataset.touched = "1"; };
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const name = nameEl.value.trim();
      if (!name) { toast("이름을 입력하세요.", true); return; }
      if (SeMIS.assignees().some(x => x.name === name && (!a || x.id !== a.id))) {
        toast("이미 등록된 담당자입니다.", true); return;
      }
      const patch = {
        name,
        title: $("#f-astitle").value.trim(),
        emoji: $("#f-asemoji").value.trim() || "👤",
        short: shortEl.value.trim() || name.slice(-1)
      };
      if (a) {
        const rec = D().assignees.find(x => x.id === a.id);
        const oldName = rec.name;
        Object.assign(rec, patch);
        /* 이름을 바꾸면 이미 배정된 일정의 담당자도 함께 바꿔 준다(따로 손대지 않아도 되도록) */
        if (oldName !== name) {
          (D().schedules || []).forEach(sc => {
            if (!sc || !sc.assignee) return;
            const ns = splitNames(sc.assignee);
            if (ns.indexOf(oldName) < 0) return;
            sc.assignee = joinNames(ns.map(n => (n === oldName ? name : n)));
          });
        }
      } else {
        const seq = (D().assignees || []).reduce((mx, x) => Math.max(mx, x.seq || 0), 0) + 1;
        D().assignees.push(Object.assign({ id: uid("as"), seq }, patch));
      }
      SeMIS.save(); closeModal(); renderAssigneeTab($("#tab-body")); toast("저장되었습니다.");
    };
  }

  /* ───── 데이터 관리 탭 ───── */
  function renderDataTab(box) {
    box.innerHTML = `
      <div class="card">
        <div class="card-title">💾 백업 / 복원</div>
        <p class="form-hint" style="margin-bottom:12px">
          모든 데이터는 공용 DB에 실시간 동기화되고, 이 브라우저에도 함께 저장되어 오프라인에서 동작합니다.<br>
          백업 파일은 비상 복구용으로 가끔 내려받아 두시기 바랍니다.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-export">⬇ 백업 파일 다운로드</button>
          <label class="btn btn-ghost" style="cursor:pointer">⬆ 백업 파일 복원
            <input type="file" id="btn-import" accept=".json" style="display:none"></label>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🛟 변경 이력 (서버 자동 백업)</div>
        <p class="form-hint" style="margin-bottom:12px">
          공용 DB의 모든 컬렉션 변경 직전 값이 서버에 자동 보관됩니다(90일).<br>
          실수로 지운 데이터는 아래에서 그 시점으로 되돌릴 수 있습니다.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          <select id="hist-key" class="hist-sel"></select>
          <button class="btn btn-ghost" id="btn-hist-reload">↻ 불러오기</button>
        </div>
        <div id="hist-body" class="form-hint">불러오는 중…</div>
      </div>
      <div class="card">
        <div class="card-title">🧹 초기화</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="btn-reset-menu">메뉴 기본값으로 재설정</button>
          <button class="btn btn-danger" id="btn-reset-all">이 브라우저 로컬 데이터 초기화</button>
        </div>
        <p class="form-hint" style="margin-top:10px">메뉴 재설정은 공지·일정·사용자는 유지합니다. 로컬 초기화 후에는 공용 DB에서 다시 동기화됩니다.</p>
      </div>
      <div class="card">
        <div class="card-title">🔗 구글 캘린더 연동 <span class="badge badge-gray">일정관리</span></div>
        <p class="form-hint" style="margin-bottom:12px">
          <b>Google → SeMIS</b> 공개 캘린더를 일정관리에 겹쳐 보기 · <b>SeMIS → Google</b> 구독 주소(ICS) 제공.<br>
          시스템관리자 전용 설정입니다.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary" id="btn-gcal">🔗 연동 설정 열기</button>
          <span class="form-hint" id="gcal-state"></span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">ℹ️ 시스템 정보</div>
        <table class="tbl">
          <tr><td style="width:140px;color:var(--text-2)">버전</td><td>${esc(SeMIS.APP_NAME)} v${esc(SeMIS.VERSION)}</td></tr>
          <tr><td style="color:var(--text-2)">저장 방식</td><td>Supabase 공용 DB(semis_logi_store) 실시간 동기화 + localStorage 오프라인 폴백</td></tr>
          <tr><td style="color:var(--text-2)">동기화</td><td><span id="sysinfo-sync">-</span> <button class="btn btn-ghost btn-sm" id="btn-sync-now" style="margin-left:8px">지금 동기화</button></td></tr>
          <tr><td style="color:var(--text-2)">인증 방식</td><td>SHA-256 해시 대조 (평문 암호 미저장)</td></tr>
          <tr><td style="color:var(--text-2)">관련 시스템</td><td><a href="https://semis.pe.kr/" target="_blank" rel="noopener">SeMIS v2 (항공보안파트) ↗</a></td></tr>
        </table>
      </div>`;

    $("#btn-export").onclick = () => {
      const blob = new Blob([JSON.stringify(D(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "semis-logistics-backup-" + todayISO().replace(/-/g, "") + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("백업 파일이 다운로드되었습니다.");
    };
    $("#btn-import").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (!obj || !Array.isArray(obj.menus)) throw new Error("형식 오류");
          confirmModal("현재 데이터를 백업 파일 내용으로 교체합니다. 공용 DB에도 복원 내용이 반영됩니다. 계속하시겠습니까?", () => {
            localStorage.setItem(SeMIS.LS_DATA, JSON.stringify(obj));
            localStorage.setItem("semisl:forcePush", "1");
            toast("복원되었습니다. 새로고침합니다.");
            setTimeout(() => location.reload(), 700);
          });
        } catch (err) {
          toast("올바른 백업 파일이 아닙니다.", true);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    };
    $("#btn-reset-menu").onclick = () =>
      confirmModal("메뉴 구성을 기본값으로 재설정합니다. (공지/일정/사용자는 유지)", () => {
        const cur = D();
        localStorage.setItem(SeMIS.LS_DATA, JSON.stringify(Object.assign({}, cur, { menus: null })));
        SeMIS.load();
        SeMIS.renderNav(); renderDataTab($("#tab-body")); toast("메뉴가 재설정되었습니다.");
      });
    $("#btn-reset-all").onclick = () =>
      confirmModal("이 브라우저의 로컬 데이터가 초기화됩니다. (공용 DB에 데이터가 있으면 접속 시 다시 동기화됩니다.) 계속하시겠습니까?", () => {
        localStorage.removeItem(SeMIS.LS_DATA);
        localStorage.removeItem(SeMIS.LS_UI);
        localStorage.removeItem("semisl:pendingSync");
        sessionStorage.removeItem(SeMIS.SS_SESSION);
        location.reload();
      });

    {   /* 변경 이력 */
      const sel = $("#hist-key"), body = $("#hist-body");
      const KEYS = (window.SemisSync && SemisSync.SYNC_KEYS) || [];
      const LABEL = { menus: "메뉴", notices: "공지사항", schedules: "일정", assignees: "담당자",
        minutes: "회의록", minuteFolders: "회의록 폴더", levelHistory: "보안등급 이력",
        safetyBoard: "현황판", contacts: "비상연락망", pwOverrides: "암호", userOverrides: "사용자 설정",
        customUsers: "추가 사용자", gcal: "구글 캘린더", chatRooms: "대화방", assigneesSeeded: "담당자 시드" };
      if (sel) sel.innerHTML = '<option value="">전체 컬렉션</option>'
        + KEYS.map(k => `<option value="${esc(k)}">${esc(LABEL[k] || k)} (${esc(k)})</option>`).join("");
      const fmt = (t) => {
        const d = new Date(t);
        return isNaN(d) ? String(t || "") :
          d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
          + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      };
      const load = () => {
        if (!window.SemisSync || !SemisSync.history) { if (body) body.textContent = "동기화 모듈이 로드되지 않았습니다."; return; }
        if (body) body.textContent = "불러오는 중…";
        SemisSync.history(sel ? sel.value : "", 60).then(rows => {
          if (!body) return;
          if (!rows.length) { body.textContent = "보관된 변경 이력이 없습니다."; return; }
          body.innerHTML = `<table class="tbl"><thead><tr>
              <th style="width:130px">변경 시각</th><th>컬렉션</th>
              <th style="width:110px">건수</th><th>변경자</th><th style="width:90px"></th></tr></thead><tbody>`
            + rows.map(r => {
                const drop = Number(r.old_len) > 0 && Number(r.new_len) === 0;
                return `<tr${drop ? ' style="background:var(--danger-soft,#fef2f2)"' : ""}>
                  <td>${esc(fmt(r.changed_at))}</td>
                  <td>${esc(LABEL[r.key] || r.key)}</td>
                  <td>${r.old_len == null ? "-" : esc(String(r.old_len))} → ${r.new_len == null ? "-" : esc(String(r.new_len))}${drop ? ' <span class="badge badge-red">전량삭제</span>' : ""}</td>
                  <td style="font-size:.85rem;color:var(--text-3)">${esc(r.changed_by || "")}</td>
                  <td><button class="btn btn-ghost btn-sm" data-hist="${esc(String(r.id))}">되돌리기</button></td></tr>`;
              }).join("")
            + "</tbody></table>";
          $$("#hist-body [data-hist]").forEach(b => {
            b.onclick = () => confirmModal("이 시점의 값으로 되돌립니다. 현재 값은 다시 이력에 보관됩니다. 계속하시겠습니까?", () => {
              SemisSync.restoreHistory(b.dataset.hist)
                .then(k => { toast((LABEL[k] || k) + " 데이터를 되돌렸습니다."); load(); })
                .catch(() => toast("되돌리기에 실패했습니다.", true));
            });
          });
        }).catch(() => { if (body) body.textContent = "변경 이력을 불러오지 못했습니다."; });
      };
      if (sel) sel.onchange = load;
      const rb = $("#btn-hist-reload"); if (rb) rb.onclick = load;
      load();
    }

    {
      const g = D().gcal || {};
      const st = $("#gcal-state");
      if (st) st.innerHTML = g.enabled
        ? "현재: <b>사용 중</b>" + (g.calendarId ? " · " + esc(g.calendarId) : " · 캘린더 ID 미입력")
        : "현재: 사용 안 함";
      const gb = $("#btn-gcal");
      if (gb) gb.onclick = () => {
        if (window.SemisCalendar && SemisCalendar.gcalForm) SemisCalendar.gcalForm();
        else toast("일정관리 모듈이 로드되지 않았습니다.", true);
      };
    }

    const syncInfo = $("#sysinfo-sync");
    if (syncInfo) {
      const label = { online: "🟢 연결됨 (실시간)", syncing: "🟡 동기화 중", offline: "🔴 오프라인 (로컬 저장)", init: "⏳ 연결 중" };
      const refresh = () => { syncInfo.textContent = window.SemisSync ? (label[SemisSync.status] || SemisSync.status) : "미사용 (localStorage 전용)"; };
      refresh();
      $("#btn-sync-now").onclick = () => {
        if (!window.SemisSync) { toast("동기화 모듈이 로드되지 않았습니다.", true); return; }
        SemisSync.syncNow().then(() => { refresh(); toast("동기화되었습니다."); })
          .catch(() => { refresh(); toast("동기화 실패 — 네트워크를 확인하세요.", true); });
      };
    }
  }

  /* ═════════════ 저장소 관리 탭 (시스템관리자 전용) ═════════════ */
  const STORE_LIMIT = 1024 * 1024 * 1024;
  const DB_LIMIT = 500 * 1024 * 1024;
  const FRESH_MS = 24 * 3600 * 1000;
  const FOLDER_LABEL = {
    "notices": "공지 이미지", "attach": "공지 첨부", "schedules": "일정 메모 첨부",
    "minutes": "회의록 첨부", "minutes-sign": "회의록 서명", "files": "기타", "": "(루트)"
  };
  const folderName = (f) => FOLDER_LABEL[f] || f || "(루트)";

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }
  const pct = (used, limit) => Math.max(0, Math.min(100, (used / limit) * 100));
  const gaugeTone = (p) => (p >= 85 ? "danger" : p >= 60 ? "warn" : "ok");

  function storeSizes() {
    const d = D();
    const keys = (window.SemisSync && SemisSync.SYNC_KEYS) ? SemisSync.SYNC_KEYS : Object.keys(d);
    const rows = keys.map(k => {
      let bytes = 0;
      try { bytes = JSON.stringify(d[k] === undefined ? null : d[k]).length; } catch (e) { bytes = 0; }
      const v = d[k];
      return { key: k, bytes, count: Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : null) };
    }).sort((a, b) => b.bytes - a.bytes);
    return { rows, total: rows.reduce((s, r) => s + r.bytes, 0) };
  }
  function referencedPaths() {
    const set = new Set();
    let json = "";
    try { json = JSON.stringify(D()); } catch (e) { return set; }
    const base = (window.SemisSync && SemisSync.PUBLIC_PREFIX) || "/object/public/semis-logi-files/";
    const tail = base.slice(base.indexOf("/object/public/"));
    const re = new RegExp(tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([A-Za-z0-9._\\-]+(?:/[A-Za-z0-9._\\-]+)*)", "g");
    let m;
    while ((m = re.exec(json))) set.add(m[1]);
    return set;
  }
  function orphanFiles(files, refs, nowMs) {
    if (!refs || !refs.size) return [];
    const now = nowMs || Date.now();
    return files.filter(f => {
      if (refs.has(f.path)) return false;
      const t = Date.parse(f.updated || "");
      if (Number.isFinite(t) && now - t < FRESH_MS) return false;
      return true;
    });
  }
  function gaugeHTML(label, used, limit, note) {
    const p = pct(used, limit);
    return `<div class="st-gauge">
      <div class="st-gauge-head"><b>${esc(label)}</b>
        <span class="spacer"></span>
        <span class="st-gauge-num">${esc(fmtBytes(used))} <span>/ ${esc(fmtBytes(limit))}</span></span></div>
      <div class="st-bar"><div class="st-bar-fill ${gaugeTone(p)}" style="width:${p.toFixed(1)}%"></div></div>
      <div class="st-gauge-foot">${p.toFixed(1)}% 사용${note ? " · " + esc(note) : ""}</div>
    </div>`;
  }
  function renderStorageTab(box) {
    const ss = storeSizes();
    box.innerHTML = `
      <div class="card">
        <div class="card-title">📦 저장 용량 현황 <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="st-reload">↻ 새로고침</button></div>
        <div class="st-gauges">
          <div id="st-file-gauge">${gaugeHTML("파일 스토리지 (semis-logi-files)", 0, STORE_LIMIT, "불러오는 중…")}</div>
          ${gaugeHTML("데이터베이스 (semis_logi_store)", ss.total, DB_LIMIT, ss.rows.length + "개 컬렉션")}
        </div>
        <p class="form-hint" style="margin-top:10px">무료 플랜 기준(파일 1GB · DB 500MB). 데이터베이스 수치는 컬렉션 JSON 합계의 근사치입니다.</p>
      </div>
      <div class="card">
        <div class="card-title">📂 분류별 파일</div>
        <div id="st-folders" class="st-loading">파일 목록을 불러오는 중…</div>
      </div>
      <div class="card">
        <div class="card-title">🧹 미참조 파일 정리</div>
        <p class="form-hint" style="margin-bottom:12px">어느 기록에서도 참조하지 않는 파일입니다(업로드 24시간 이내 제외). <b>삭제는 되돌릴 수 없습니다.</b></p>
        <div id="st-orphans" class="st-loading">참조 관계를 확인하는 중…</div>
      </div>
      <div class="card">
        <div class="card-title">🗄 컬렉션별 데이터 용량</div>
        <table class="tbl st-tbl">
          <colgroup><col style="width:38%"><col style="width:22%"><col style="width:20%"><col style="width:20%"></colgroup>
          <thead><tr><th>컬렉션</th><th>항목 수</th><th>용량</th><th>비중</th></tr></thead>
          <tbody>${ss.rows.map(r => `<tr>
            <td>${esc(r.key)}</td>
            <td>${r.count === null ? "-" : esc(String(r.count)) + "건"}</td>
            <td>${esc(fmtBytes(r.bytes))}</td>
            <td>${ss.total ? ((r.bytes / ss.total) * 100).toFixed(1) : "0.0"}%</td></tr>`).join("")}
          </tbody>
          <tfoot><tr><th>합계</th><th></th><th>${esc(fmtBytes(ss.total))}</th><th>100%</th></tr></tfoot>
        </table>
      </div>`;
    $("#st-reload").onclick = () => renderStorageTab(box);
    loadStorage(box);
  }
  function loadStorage(box) {
    const fail = (msg) => {
      ["#st-folders", "#st-orphans"].forEach(sel => {
        const el = $(sel); if (el) { el.className = ""; el.innerHTML = `<div class="empty">${esc(msg)}</div>`; }
      });
      const g = $("#st-file-gauge");
      if (g) g.innerHTML = gaugeHTML("파일 스토리지", 0, STORE_LIMIT, "조회 실패");
    };
    if (!window.SemisSync || !SemisSync.listFiles) { fail("동기화 모듈이 로드되지 않아 조회할 수 없습니다."); return; }
    SemisSync.listFiles().then(files => {
      if (!$("#st-folders")) return;
      const total = files.reduce((s, f) => s + f.size, 0);
      $("#st-file-gauge").innerHTML = gaugeHTML("파일 스토리지 (semis-logi-files)", total, STORE_LIMIT, files.length + "개 파일");
      const byFolder = {};
      files.forEach(f => {
        const k = f.folder || "";
        if (!byFolder[k]) byFolder[k] = { files: 0, bytes: 0 };
        byFolder[k].files++; byFolder[k].bytes += f.size;
      });
      const folders = Object.keys(byFolder).sort((a, b) => byFolder[b].bytes - byFolder[a].bytes);
      const fb = $("#st-folders");
      fb.className = "";
      fb.innerHTML = folders.length ? `<table class="tbl st-tbl">
        <colgroup><col style="width:44%"><col style="width:18%"><col style="width:20%"><col style="width:18%"></colgroup>
        <thead><tr><th>분류</th><th>파일 수</th><th>용량</th><th>비중</th></tr></thead>
        <tbody>${folders.map(k => `<tr>
          <td>${esc(folderName(k))} <span class="st-dim">${esc(k || "-")}</span></td>
          <td>${byFolder[k].files}개</td>
          <td>${esc(fmtBytes(byFolder[k].bytes))}</td>
          <td>${total ? ((byFolder[k].bytes / total) * 100).toFixed(1) : "0.0"}%</td></tr>`).join("")}
        </tbody></table>` : '<div class="empty">업로드된 파일이 없습니다.</div>';
      paintOrphans(box, files);
    }).catch(() => fail("파일 목록을 불러오지 못했습니다. 네트워크를 확인하세요."));
  }
  function paintOrphans(box, files) {
    const refs = referencedPaths();
    const ob = $("#st-orphans");
    if (!ob) return;
    ob.className = "";
    if (!files.length) { ob.innerHTML = '<div class="empty">파일이 없습니다.</div>'; return; }
    if (!refs.size) {
      ob.innerHTML = '<div class="empty">⚠️ 참조 관계를 확인하지 못해 정리 기능을 잠갔습니다. (오삭제 방지)</div>';
      return;
    }
    const orphans = orphanFiles(files, refs).sort((a, b) => b.size - a.size);
    if (!orphans.length) { ob.innerHTML = '<div class="empty">✅ 미참조 파일이 없습니다.</div>'; return; }
    const sum = orphans.reduce((s, f) => s + f.size, 0);
    ob.innerHTML = `
      <div class="st-orphan-head">
        미참조 <b>${orphans.length}개</b> · 합계 <b>${esc(fmtBytes(sum))}</b>
        <span class="spacer"></span>
        <label class="st-chk"><input type="checkbox" id="st-all"> 전체 선택</label>
        <button class="btn btn-danger btn-sm" id="st-del" disabled>선택 삭제</button>
      </div>
      <table class="tbl st-tbl">
        <colgroup><col style="width:40px"><col style="width:40%"><col style="width:20%"><col style="width:14%"><col style="width:16%"></colgroup>
        <thead><tr><th></th><th>파일</th><th>분류</th><th>용량</th><th>등록일</th></tr></thead>
        <tbody>${orphans.map(f => `<tr>
          <td><input type="checkbox" class="st-o" data-path="${esc(f.path)}" data-size="${f.size}"></td>
          <td><a href="${esc(f.url)}" target="_blank" rel="noopener" class="st-file">${esc(f.name)}</a></td>
          <td>${esc(folderName(f.folder))}</td>
          <td>${esc(fmtBytes(f.size))}</td>
          <td>${esc(String(f.updated).slice(0, 10))}</td></tr>`).join("")}
        </tbody></table>`;
    const boxes = () => $$("#st-orphans .st-o");
    const picked = () => boxes().filter(c => c.checked);
    const sync = () => {
      const n = picked().length;
      const btn = $("#st-del");
      btn.disabled = !n;
      btn.textContent = n ? "선택 " + n + "개 삭제" : "선택 삭제";
    };
    boxes().forEach(c => c.onchange = sync);
    $("#st-all").onchange = (e) => { boxes().forEach(c => { c.checked = e.target.checked; }); sync(); };
    $("#st-del").onclick = () => {
      const sel = picked();
      if (!sel.length) return;
      const bytes = sel.reduce((s, c) => s + Number(c.dataset.size || 0), 0);
      confirmModal(`파일 ${sel.length}개(${fmtBytes(bytes)})를 영구 삭제합니다. 되돌릴 수 없습니다. 계속하시겠습니까?`, () => {
        const paths = sel.map(c => c.dataset.path);
        Promise.all(paths.map(p => SemisSync.deleteFile(p).then(() => 1).catch(() => 0)))
          .then(res => {
            const ok = res.reduce((a, b) => a + b, 0);
            toast(ok === paths.length ? `${ok}개 파일을 삭제했습니다.` : `${ok}/${paths.length}개 삭제 — 일부는 실패했습니다.`, ok !== paths.length);
            renderStorageTab(box);
          });
      });
    };
  }

  window.SemisStorage = { fmtBytes, storeSizes, referencedPaths, orphanFiles, folderName, STORE_LIMIT, DB_LIMIT, FRESH_MS };
  window.SemisDashFx = { zeroDays, openActions };
})();
