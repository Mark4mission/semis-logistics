/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 바로가기 (v1.23)
   링크 메뉴(type "link")를 허브별 카드로 한 화면에 모은다. 시스템관리자는 '편집'에서
   추가 · 수정 · 삭제 · 순서 변경 · 사이트 아이콘 일괄 가져오기를 한다.
   - 따로 쌓는 데이터 없음: DATA.menus 의 링크 메뉴가 곧 바로가기(권한표 menus 읽기 1 · 쓰기 4 = 시스템관리자)
   - 아이콘 필드: fav(사이트 아이콘 · 올린 이미지를 64px PNG data URL로) · ico + tone(선 아이콘) · icon(이모지)
     그리기는 SeMIS.linkIconHTML(우선순위 fav → ico → 이모지 → 기본)
   - 추가 · 수정은 시스템 설정의 메뉴 폼(SeMIS.menuForm)을 함께 쓰고, 폼 안의 '아이콘' 칸을 이 파일이 맡는다
   - 사이트 아이콘: SemisSync.favicon(url) → Edge Function semis-logi-favicon 이 사이트의 아이콘 파일을 찾아
     돌려주면 화면에서 64px PNG로 줄여 저장한다. 사내망 주소는 서버가 닿지 않으므로 이미지 파일 · 선 아이콘을 쓴다
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, confirmModal, ui, icon } = SeMIS;
  const MOD = "shortcuts";
  const TITLE = "바로가기";
  const D = () => SeMIS.data;
  const ICON_NAME = {
    link: "링크", globe: "웹사이트", monitor: "업무 시스템", plane: "항공기", box: "화물", truck: "운송", building: "건물 · 기관",
    shield: "보안", scan: "검색", xray: "X-ray", etd: "ETD", chart: "통계", database: "데이터", doc: "문서", folder: "폴더",
    book: "규정", calendar: "일정", clock: "시간", mail: "메일", phone: "전화", users: "조직", user: "사람", shirt: "유니폼",
    star: "즐겨찾기", map: "위치", wrench: "정비", car: "차량", bell: "알림", lock: "잠금", alert: "경고"
  };
  const TONE_NAME = { teal: "청록", blue: "파랑", indigo: "남색", violet: "보라", rose: "빨강", amber: "주황", green: "초록", slate: "회색" };
  let editMode = false, query = "", focusId = "", bulkRunning = false;

  /* ═════════ 이미지 → 64px PNG (사이트 아이콘 · 올린 파일 공통) ═════════
     16px 같은 작은 아이콘은 정수배로 키워(보간 없음) 또렷하게, 큰 이미지는 비율 유지로 줄인다. */
  const SIZE = 64;
  function svgSized(src) {
    /* width/height 없는 SVG(viewBox만)는 브라우저마다 크기가 달라 64px로 고정해 그린다 */
    const m = /^data:image\/svg\+xml(;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(src);
    if (!m) return src;
    let txt;
    try { txt = m[2] ? decodeURIComponent(escape(atob(m[3]))) : decodeURIComponent(m[3]); } catch (e) { return src; }
    const open = /<svg\b[^>]*>/i.exec(txt);
    if (!open) return src;
    let tag = open[0].replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    tag = tag.replace(/^<svg\b/i, '<svg width="' + SIZE + '" height="' + SIZE + '"');
    txt = txt.replace(open[0], tag);
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(txt);
  }
  function toPng64(src) {
    return new Promise((resolve, reject) => {
      if (typeof document === "undefined") { reject(new Error("decode")); return; }
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
          if (!w || !h) { w = SIZE; h = SIZE; }
          const c = document.createElement("canvas");
          c.width = SIZE; c.height = SIZE;
          const g = c.getContext("2d");
          if (!g) { reject(new Error("canvas")); return; }
          const big = Math.max(w, h);
          let dw, dh;
          if (big <= 24) {
            const k = Math.max(1, Math.floor(SIZE / big));
            dw = w * k; dh = h * k;
            g.imageSmoothingEnabled = false;
          } else {
            const k = SIZE / big;
            dw = Math.max(1, Math.round(w * k)); dh = Math.max(1, Math.round(h * k));
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = "high";
          }
          g.drawImage(img, Math.round((SIZE - dw) / 2), Math.round((SIZE - dh) / 2), dw, dh);
          const out = c.toDataURL("image/png");
          if (!SeMIS.favOk(out)) { reject(new Error("canvas")); return; }
          resolve(out);
        } catch (e) { reject(new Error("canvas")); }
      };
      img.onerror = () => reject(new Error("decode"));
      img.src = svgSized(String(src || ""));
    });
  }
  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error("file")); return; }
      if (file.size > 3 * 1024 * 1024) { reject(new Error("too_big")); return; }
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("file"));
      fr.readAsDataURL(file);
    });
  }
  function fetchFav(url) {
    if (!window.SemisSync || typeof SemisSync.favicon !== "function") return Promise.reject(new Error("offline"));
    return SemisSync.favicon(url).then(r => toPng64(r.data).then(png => ({ png, src: r.src })));
  }
  function errText(e) {
    const c = (e && (e.code || e.message)) || "";
    if (/auth/.test(c) || (e && e.status === 401)) return "로그인이 끊겼습니다. 다시 로그인한 뒤 시도하세요.";
    if (/forbidden/.test(c)) return "시스템관리자만 가져올 수 있습니다.";
    if (/blocked/.test(c)) return "사내망 시스템이라 서버에서 가져올 수 없습니다. 아이콘 이미지를 내려받아 '이미지 파일'로 올리거나 기본 아이콘을 쓰세요.";
    if (/url/.test(c)) return "가져올 수 없는 주소입니다.";
    if (/unreachable/.test(c)) return "서버에서 이 사이트에 접속하지 못했습니다(사내망 · 해외 접속 차단 등). 아이콘 이미지를 내려받아 '이미지 파일'로 올리거나 기본 아이콘을 쓰세요.";
    if (/not_found/.test(c)) return "이 사이트에서 아이콘을 찾지 못했습니다. 이미지 파일이나 기본 아이콘을 쓰세요.";
    if (/decode|canvas/.test(c)) return "이미지를 읽지 못했습니다. 다른 파일을 쓰세요.";
    if (/too_big/.test(c)) return "파일이 너무 큽니다(3MB 이하).";
    if (/offline/.test(c)) return "서버에 연결되어 있지 않습니다.";
    return "가져오지 못했습니다. 잠시 뒤 다시 시도하세요.";
  }
  const shortSrc = (u) => { const s = String(u || "").replace(/^https?:\/\//, ""); return s.length > 48 ? s.slice(0, 46) + "…" : s; };

  /* ═════════ 메뉴 폼 안의 '아이콘' 칸 ═════════ */
  let pick = null, busyN = 0;
  function initPick(m) {
    const fav = m && SeMIS.favOk(m.fav) ? m.fav : "";
    const ico = m && m.ico && SeMIS.ICONS[m.ico] ? m.ico : "";
    const emo = m && m.icon && m.icon !== "🔗" ? m.icon : "";
    pick = {
      mode: fav ? "fav" : ico ? "ico" : emo ? "emoji" : "fav",
      fav, ico: ico || "link", emoji: emo,
      tone: m && SeMIS.LINK_TONES.indexOf(m.tone) >= 0 ? m.tone : "teal",
      group: !!(m && m.open === "group")
    };
  }
  function previewHTML() {
    const f = { type: "link", open: pick.group ? "group" : "tab" };
    if (pick.mode === "fav" && pick.fav) f.fav = pick.fav;
    else if (pick.mode === "ico") { f.ico = pick.ico; f.tone = pick.tone; }
    else if (pick.mode === "emoji" && pick.emoji) f.icon = pick.emoji;
    return SeMIS.linkIconHTML(f, "lki-lg");
  }
  function pickerHTML(m) {
    initPick(m);
    const seg = [["fav", "사이트 아이콘"], ["ico", "기본 아이콘"], ["emoji", "이모지"]];
    const hide = (k) => pick.mode === k ? "" : " hidden";
    return `<label>아이콘</label>
      <div class="lkp">
        <div class="lkp-prev" id="lkp-prev">${previewHTML()}</div>
        <div class="lkp-main">
          <div class="seg" role="group" aria-label="아이콘 종류">${seg.map(([k, l]) =>
            `<button type="button" class="seg-btn" data-lkp-mode="${k}" aria-pressed="${pick.mode === k ? "true" : "false"}">${l}</button>`).join("")}</div>
          <div class="lkp-pane" data-lkp-pane="fav"${hide("fav")}>
            <div class="lkp-row">
              <button type="button" class="btn btn-soft btn-sm" id="lkp-fetch">${icon("globe", 16)}<span>사이트에서 가져오기</span></button>
              <label class="btn btn-ghost btn-sm lkp-file">${icon("image", 16)}<span>이미지 파일</span>
                <input type="file" id="lkp-file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/x-icon,.ico"></label>
            </div>
            <p class="lkp-msg" id="lkp-msg" role="status"></p>
          </div>
          <div class="lkp-pane" data-lkp-pane="ico"${hide("ico")}>
            <div class="ico-pick lkp-icos" role="radiogroup" aria-label="아이콘">${SeMIS.LINK_ICONS.map(k =>
              `<label class="ico-opt" title="${esc(ICON_NAME[k] || k)}"><input type="radio" name="lkp-ico" value="${esc(k)}" aria-label="${esc(ICON_NAME[k] || k)}" ${pick.ico === k ? "checked" : ""}>${icon(k, 19)}</label>`).join("")}</div>
            <div class="lkp-tones" role="radiogroup" aria-label="색">${SeMIS.LINK_TONES.map(t =>
              `<label class="lkp-tone t-${t}" title="${TONE_NAME[t]}"><input type="radio" name="lkp-tone" value="${t}" aria-label="${TONE_NAME[t]}" ${pick.tone === t ? "checked" : ""}><span></span></label>`).join("")}</div>
          </div>
          <div class="lkp-pane" data-lkp-pane="emoji"${hide("emoji")}>
            <input id="lkp-emoji" maxlength="4" value="${esc(pick.emoji)}" placeholder="예: ✈️" aria-label="이모지">
          </div>
        </div>
      </div>`;
  }
  function pickerWire(box) {
    if (!box || !pick) return;
    const mine = pick;
    busyN = 0;
    const msg = (t, bad) => { const el = $("#lkp-msg", box); if (el) { el.textContent = t || ""; el.classList.toggle("bad", !!bad); } };
    const paint = () => { const p = $("#lkp-prev", box); if (p && pick === mine) p.innerHTML = previewHTML(); };
    const setMode = (k) => {
      mine.mode = k;
      $$("[data-lkp-mode]", box).forEach(b => b.setAttribute("aria-pressed", b.dataset.lkpMode === k ? "true" : "false"));
      $$("[data-lkp-pane]", box).forEach(p => { p.hidden = p.dataset.lkpPane !== k; });
      paint();
    };
    $$("[data-lkp-mode]", box).forEach(b => { b.onclick = () => setMode(b.dataset.lkpMode); });
    $$('input[name="lkp-ico"]', box).forEach(r => { r.onchange = () => { mine.ico = r.value; paint(); }; });
    $$('input[name="lkp-tone"]', box).forEach(r => { r.onchange = () => { mine.tone = r.value; paint(); }; });
    const em = $("#lkp-emoji", box);
    if (em) em.oninput = () => { mine.emoji = em.value.trim(); paint(); };
    const openSel = document.getElementById("f-open");
    if (openSel) openSel.addEventListener("change", () => { mine.group = openSel.value === "group"; paint(); });
    const btn = $("#lkp-fetch", box);
    const urlEl = document.getElementById("f-url");
    const doFetch = (auto) => {
      const url = urlEl ? urlEl.value.trim() : "";
      if (!/^https?:\/\/[^\s]+$/i.test(url)) { if (!auto) msg("웹주소(https://…)를 먼저 입력하세요.", true); return; }
      if (SeMIS.isIntranet(url)) { if (!auto) msg("사내망 주소는 가져올 수 없습니다. 이미지 파일이나 기본 아이콘을 쓰세요.", true); return; }
      busyN++;
      if (btn) btn.disabled = true;
      msg("가져오는 중…");
      fetchFav(url).then(r => {
        if (pick !== mine) return;
        mine.fav = r.png;
        setMode("fav");
        msg("가져왔습니다 · " + shortSrc(r.src));
      }).catch(e => { if (pick === mine) msg(errText(e), true); })
        .then(() => { busyN = Math.max(0, busyN - 1); if (btn) btn.disabled = false; });
    };
    if (btn) btn.onclick = () => doFetch(false);
    if (urlEl) urlEl.addEventListener("change", () => { if (mine.mode === "fav" && !mine.fav) doFetch(true); });
    const file = $("#lkp-file", box);
    if (file) file.onchange = () => {
      const f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      busyN++;
      msg("이미지를 줄이는 중…");
      readFile(f).then(toPng64).then(png => {
        if (pick !== mine) return;
        mine.fav = png;
        setMode("fav");
        msg("이미지를 적용했습니다 · " + shortSrc(f.name));
      }).catch(e => { if (pick === mine) msg(errText(e), true); })
        .then(() => { busyN = Math.max(0, busyN - 1); });
    };
  }
  function pickerRead() { return pick ? Object.assign({}, pick) : null; }
  /* 저장: 고른 종류의 필드만 남긴다(이모지 icon 은 검색 · 목록용으로 늘 보존) */
  function applyIcon(obj, v) {
    if (!obj || !v) return obj;
    delete obj.fav; delete obj.ico; delete obj.tone;
    if (v.mode === "fav" && SeMIS.favOk(v.fav)) obj.fav = v.fav;
    else if (v.mode === "ico" && SeMIS.ICONS[v.ico]) {
      obj.ico = v.ico;
      obj.tone = SeMIS.LINK_TONES.indexOf(v.tone) >= 0 ? v.tone : "teal";
    } else if (v.mode === "emoji") obj.icon = v.emoji || "🔗";
    return obj;
  }

  /* ═════════ 화면 ═════════ */
  const links = () => SeMIS.sortedMenus().filter(m => m && m.type === "link");
  const shown = (m) => editMode ? SeMIS.canSee(m) : SeMIS.navVisible(m);
  const findMenu = (id) => D().menus.find(x => x && x.id === id);

  function tile(m, sub) {
    if (!editMode) return SeMIS.linkCardHTML(m, sub ? { sub } : null);
    const hid = SeMIS.menuHidden(m);
    return `<div class="sc-item" data-id="${esc(m.id)}">` +
      SeMIS.linkCardHTML(m, { edit: true, dim: hid, tag: hid ? "숨김" : "", sub }) +
      `<div class="sc-acts">
        <button type="button" class="sc-act" data-sc-move="${esc(m.id)}" data-dir="-1" title="앞으로" aria-label="${esc(m.label)} 앞으로">${icon("chevl", 16)}</button>
        <button type="button" class="sc-act" data-sc-move="${esc(m.id)}" data-dir="1" title="뒤로" aria-label="${esc(m.label)} 뒤로">${icon("chevron", 16)}</button>
        <span class="sc-sp"></span>
        <button type="button" class="sc-act danger" data-sc-del="${esc(m.id)}" title="삭제" aria-label="${esc(m.label)} 삭제">${icon("trash", 16)}</button>
      </div></div>`;
  }
  const addTile = (parent, label) =>
    `<button type="button" class="sc-add" data-sc-add="${esc(parent || "")}">${icon("plus", 18)}<span>${esc(label)}</span></button>`;
  function section(id, title, head, list, o) {
    o = o || {};
    return `<section class="sc-sec${o.sub ? " is-sub" : ""}${focusId && focusId === id ? " is-focus" : ""}" data-sec="${esc(id)}">
      <h2 class="sc-h">${head ? `<span class="sc-hico">${head}</span>` : ""}${o.up ? `<span class="sc-up">${esc(o.up)}</span>` : ""}<span class="sc-ht">${esc(title)}</span><span class="sc-n">${list.length}</span></h2>
      <div class="lk-grid sc-grid">${list.map(m => tile(m)).join("")}${editMode ? addTile(o.addTo, o.sub ? "하위 링크 추가" : "추가") : ""}</div>
    </section>`;
  }
  function bodyHTML() {
    const all = links().filter(shown);
    const q = query.toLowerCase();
    if (q) {
      const hit = all.filter(m => {
        const up = m.parent ? findMenu(m.parent) : null;
        return [m.label, m.url, up ? up.label : ""].join(" ").toLowerCase().indexOf(q) >= 0;
      });
      return `<section class="sc-sec"><h2 class="sc-h"><span class="sc-ht">검색 결과</span><span class="sc-n">${hit.length}</span></h2>` +
        (hit.length ? `<div class="lk-grid sc-grid">${hit.map(m => {
          const up = m.parent ? findMenu(m.parent) : null;
          return tile(m, (up ? up.label + " · " : "") + (SeMIS.hostOf(m.url) || "주소 없음"));
        }).join("")}</div>` : ui.empty("검색 결과가 없습니다.")) + `</section>`;
    }
    let html = "";
    const empty = [];
    SeMIS.sortedMenus().filter(g => g.type === "group").forEach(g => {
      if (!editMode && SeMIS.menuHidden(g)) return;
      const tops = all.filter(m => m.parent === g.id);
      if (!tops.length) { if (editMode) empty.push(g); return; }
      html += section(g.id, g.label + (editMode && SeMIS.menuHidden(g) ? " (숨김)" : ""), icon(g.ico, 18), tops, { addTo: g.id });
      if (editMode) tops.filter(m => m.open === "group").forEach(set => {
        html += section(set.id, set.label, SeMIS.linkIconHTML(set, "sc-hlki"), all.filter(k => k.parent === set.id),
          { sub: true, up: g.label, addTo: set.id });
      });
    });
    const loose = all.filter(m => !m.parent || !findMenu(m.parent));
    if (loose.length) html += section("_none", "허브 없음", icon("sliders", 18), loose, { addTo: "" });
    /* 편집 모드: 바로가기가 없는 허브는 한 줄 버튼으로만 */
    if (empty.length) html += `<div class="sc-more"><span class="sc-more-t">다른 허브에 추가</span>${empty.map(g =>
      `<button type="button" class="btn btn-ghost btn-sm" data-sc-add="${esc(g.id)}">${icon("plus", 15)}<span>${esc(g.label)}</span></button>`).join("")}</div>`;
    if (!html) html = ui.empty("등록된 바로가기가 없습니다.",
      SeMIS.isAdmin() ? `<button type="button" class="btn btn-soft btn-sm" data-sc-add="${esc(SeMIS.homeHubId() || "")}">${icon("plus", 16)}<span>추가</span></button>` : "");
    return html;
  }
  const countShown = () => links().filter(m => SeMIS.navVisible(m) && !(m.parent && (findMenu(m.parent) || {}).type === "link")).length;
  const editBtnHTML = () => `${icon(editMode ? "check" : "edit", 17)}<span>${editMode ? "편집 완료" : "편집"}</span>`;
  const toolsHTML = () => editMode
    ? `<button type="button" class="btn btn-ghost btn-sm" id="sc-bulk" ${bulkRunning ? "disabled" : ""}>${icon("globe", 16)}<span>${bulkRunning ? "가져오는 중…" : "사이트 아이콘 일괄 가져오기"}</span></button>` : "";

  function render(root) {
    const admin = SeMIS.isAdmin();
    if (!admin) editMode = false;
    root.innerHTML = ui.head({
      title: TITLE,
      meta: countShown() + "개",
      actions: admin
        ? `<button type="button" class="btn btn-ghost" id="sc-edit" aria-pressed="${editMode ? "true" : "false"}">${editBtnHTML()}</button>` +
          `<button type="button" class="btn btn-primary" id="sc-new">${icon("plus", 17)}<span>추가</span></button>` : ""
    }) +
      `<div class="sc-bar">${ui.search("sc-q", "이름 · 주소 검색", query)}<span class="sc-tools" id="sc-tools">${toolsHTML()}</span></div>
      <div id="sc-body"${editMode ? ' class="is-editing"' : ""}>${bodyHTML()}</div>`;
    const qi = $("#sc-q", root);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === query) return;
      query = v;
      refresh();
    };
    const eb = $("#sc-edit", root);
    if (eb) eb.onclick = () => setEdit(!editMode);
    const nb = $("#sc-new", root);
    if (nb) nb.onclick = () => add(SeMIS.homeHubId());
    wireBody(root);
    if (focusId) {
      const sec = root.querySelector('[data-sec="' + (window.CSS && CSS.escape ? CSS.escape(focusId) : focusId) + '"]');
      if (sec && sec.scrollIntoView) setTimeout(() => { try { sec.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {} }, 60);
      focusId = "";
    }
  }
  /* 머리말(인쇄 버튼 포함)은 그대로 두고 본문 · 도구만 다시 그린다 */
  function refresh() {
    const root = document.getElementById("view");
    const body = root && $("#sc-body", root);
    if (!body) return;
    const eb = $("#sc-edit", root);
    if (eb) { eb.setAttribute("aria-pressed", editMode ? "true" : "false"); eb.innerHTML = editBtnHTML(); }
    const meta = $(".page-head .page-meta", root);
    if (meta) meta.textContent = countShown() + "개";
    const tools = $("#sc-tools", root);
    if (tools) tools.innerHTML = toolsHTML();
    body.className = editMode ? "is-editing" : "";
    body.innerHTML = bodyHTML();
    wireBody(root);
  }
  function wireBody(root) {
    $$("#sc-body [data-go]", root).forEach(el => { el.onclick = () => SeMIS.navigate(el.dataset.go); });
    $$("#sc-body [data-sc-edit]", root).forEach(el => { el.onclick = () => edit(el.dataset.scEdit); });
    $$("#sc-body [data-sc-add]", root).forEach(el => { el.onclick = () => add(el.dataset.scAdd); });
    $$("#sc-body [data-sc-move]", root).forEach(el => { el.onclick = () => move(el.dataset.scMove, Number(el.dataset.dir) || 0); });
    $$("#sc-body [data-sc-del]", root).forEach(el => { el.onclick = () => del(el.dataset.scDel); });
    const bk = $("#sc-bulk", root);
    if (bk) bk.onclick = bulk;
  }
  function setEdit(v) {
    editMode = !!v && SeMIS.isAdmin();
    refresh();
  }
  function afterSave() {
    const r = location.hash.replace(/^#\//, "");
    if (r === MOD) refresh();
    else if (r.indexOf("links/") === 0) SeMIS.renderView();
  }
  function add(parent) {
    if (!SeMIS.isAdmin() || typeof SeMIS.menuForm !== "function") return;
    SeMIS.menuForm(null, { type: "link", parent: parent || null, after: afterSave });
  }
  function edit(id) {
    if (!SeMIS.isAdmin() || typeof SeMIS.menuForm !== "function" || !findMenu(id)) return;
    SeMIS.menuForm(id, { after: afterSave });
  }
  /* 링크 묶음 화면의 '편집' — 이 화면을 편집 모드로 열고 그 묶음 칸으로 이동 */
  function manage(id) {
    if (!SeMIS.isAdmin()) return;
    editMode = true; focusId = id || "";
    const already = location.hash.replace(/^#\//, "") === MOD;
    SeMIS.navigate(MOD);
    if (already) SeMIS.renderView();
  }
  function move(id, dir) {
    const me = findMenu(id);
    if (!me || !dir) return;
    const sib = SeMIS.sortedMenus().filter(x => x.type === "link" && (x.parent || null) === (me.parent || null));
    const i = sib.findIndex(x => x.id === id);
    const o = sib[i + dir] ? findMenu(sib[i + dir].id) : null;
    if (!o) return;
    const a = me.seq || 0, b = o.seq || 0;
    if (a === b) me.seq = b + dir * 0.01;
    else { me.seq = b; o.seq = a; }
    SeMIS.save(); SeMIS.renderNav(); refresh();
    const again = document.querySelector('#sc-body [data-sc-move="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"][data-dir="' + dir + '"]');
    if (again) again.focus();
  }
  function del(id) {
    const m = findMenu(id);
    if (!m) return;
    const kids = D().menus.filter(x => x.parent === m.id).length;
    confirmModal(kids ? `"${m.label}"와 하위 링크 ${kids}개를 모두 삭제하시겠습니까?` : `"${m.label}" 바로가기를 삭제하시겠습니까?`, () => {
      D().menus = D().menus.filter(x => x.id !== m.id && x.parent !== m.id);
      SeMIS.save(); SeMIS.renderNav(); refresh(); toast("삭제되었습니다.");
    });
  }
  /* 사이트 아이콘 일괄 — 사이트 아이콘 · 선 아이콘이 없는 외부 링크만(이모지는 바꾼다) */
  function bulkTargets() {
    return links().filter(m => !SeMIS.favOk(m.fav) && !m.ico && /^https?:\/\/.+/i.test(m.url || "") && !SeMIS.isIntranet(m.url));
  }
  function bulk() {
    if (bulkRunning || !SeMIS.isAdmin()) return;
    const list = bulkTargets();
    if (!list.length) { toast("가져올 대상이 없습니다. 사이트 아이콘이나 기본 아이콘을 이미 쓰고 있습니다."); return; }
    confirmModal(`사이트 아이콘이 없는 바로가기 ${list.length}개에 각 사이트의 파비콘을 가져와 적용합니다. 계속하시겠습니까?`, async () => {
      bulkRunning = true; refresh();
      let ok = 0;
      const miss = [];
      for (const m of list) {
        try {
          const r = await fetchFav(m.url);
          const cur = findMenu(m.id);
          if (cur && !SeMIS.favOk(cur.fav) && !cur.ico) { cur.fav = r.png; ok++; }
        } catch (e) { miss.push(m.label); }
      }
      bulkRunning = false;
      if (ok) { SeMIS.save(); SeMIS.renderNav(); }
      refresh();
      toast(ok + "개 적용" + (miss.length ? " · 찾지 못함 " + miss.length + "개(" + miss.slice(0, 3).join(", ") + (miss.length > 3 ? " 외" : "") + ")" : ""),
        !ok && miss.length > 0);
    });
  }

  SeMIS.registerModule(MOD, { title: TITLE, render });

  window.SemisShortcuts = {
    pickerHTML, pickerWire, pickerRead, applyIcon, busy: () => busyN > 0,
    toPng64, fetchFav, add, edit, manage, setEdit, refresh, bulkTargets,
    get editMode() { return editMode; }
  };
})();
