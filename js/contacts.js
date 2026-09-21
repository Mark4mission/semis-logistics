/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 비상연락망 · 보고체계 모듈 (SeMIS v2 contacts 이식)
   기존 구글시트(8개 탭)를 랜딩페이지형 모듈로 내재화:
   30분 이내 SMS 보고 강조 배너 + 보고 절차 + 사건별 보고처 +
   기관별 연락처 카드(전화/문자/메일 원터치, 복사) + 통합 검색 + 관리자 편집

   데이터: DATA.contacts = { sections: [{ id, type, title, icon, duty?, note?, accent?, rows[] }] }
     - type "procedure": rows { id, title, body }
     - type "incidents": rows { id, no, items, to }
     - type "people":    rows { id, role, name, mobile, office, duty, note }
     - type "emails":    rows { id, name, email }
   ※ 연락처 실데이터는 코드에 시드하지 않음(개인정보) — 공용 DB(semis_store "contacts")에서 동기화.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const C = () => (D().contacts && Array.isArray(D().contacts.sections) ? D().contacts : { sections: [] });
  const secs = () => C().sections;

  let query = ""; // 통합 검색어 (모듈 내 상태)

  /* ─────── 전화/문자 링크 ─────── */
  function telHref(num) {
    // "032-740-2107, 2108" 같은 복수 표기는 첫 번호로 연결
    const s = String(num || "").split(/[,/]/)[0].trim();
    const d = s.replace(/[^\d]/g, "");
    if (!d) return "";
    // 미주 번호 (1-8xx-...) → 국제 형식
    if (/^1[-.\s]/.test(s) && d.length === 11 && d[0] === "1") return "tel:+" + d;
    return "tel:" + d;
  }
  function smsHref(num) {
    const d = String(num || "").replace(/[^\d]/g, "");
    return d ? "sms:" + d : "";
  }
  const isMobile = (num) => /^01\d/.test(String(num || "").replace(/[^\d]/g, ""));

  /* ─────── 검색 매칭 / 하이라이트 ─────── */
  function rowText(row) {
    return Object.keys(row).filter(k => k !== "id").map(k => String(row[k] == null ? "" : row[k])).join(" ");
  }
  function matches(text, q) {
    if (!q) return true;
    const t = String(text).toLowerCase(), s = q.toLowerCase();
    if (t.includes(s)) return true;
    // 번호 검색: 하이픈/공백 무시
    const nd = s.replace(/[-\s]/g, "");
    return /\d/.test(nd) && nd.length >= 3 && t.replace(/[-\s]/g, "").includes(nd);
  }
  function hl(text, q) {
    const e = esc(text);
    if (!q) return e;
    try {
      const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      return e.replace(re, "<mark>$1</mark>");
    } catch (err) { return e; }
  }
  const nl2br = (text, q) => hl(text, q).replace(/\n/g, "<br>");

  /* ─────── 복사 ─────── */
  function copyText(txt) {
    const done = () => toast("복사되었습니다: " + (txt.length > 30 ? txt.slice(0, 30) + "…" : txt));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
    } else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove(); done();
    } catch (e) { toast("복사에 실패했습니다.", true); }
  }

  /* ─────── 연락처 액션 버튼 (전화/문자/복사) ─────── */
  function numHTML(num, kind, q) {
    if (!num) return "";
    const icon = kind === "mobile" ? "📱" : kind === "fax" ? "📠" : "☎️";
    const tel = kind === "fax" ? "" : telHref(num);
    const sms = kind === "mobile" && isMobile(num) ? smsHref(num) : "";
    return `<span class="ct-num">
      ${tel ? `<a class="ct-tel" href="${esc(tel)}" title="전화 걸기">${icon} ${hl(num, q)}</a>` : `<span class="ct-tel">${icon} ${hl(num, q)}</span>`}
      ${sms ? `<a class="ct-mini" href="${esc(sms)}" title="문자 보내기">문자</a>` : ""}
      <button class="ct-copy" data-copy="${esc(num)}" title="번호 복사">📋</button></span>`;
  }

  /* ─────── 섹션 렌더 ─────── */
  function peopleRow(r, q) {
    return `<div class="ct-row">
      <div class="ct-who">
        ${r.role ? `<span class="ct-role">${hl(r.role, q)}</span>` : ""}
        ${r.name ? `<b class="ct-name">${hl(r.name, q)}</b>` : ""}
        ${r.duty ? `<span class="ct-dutytxt">${hl(r.duty, q)}</span>` : ""}
      </div>
      <div class="ct-nums">
        ${numHTML(r.mobile, "mobile", q)}
        ${numHTML(r.office, /fax/i.test(r.role || "") ? "fax" : "office", q)}
        ${r.email ? `<span class="ct-num"><a class="ct-tel" href="mailto:${esc(r.email)}">✉️ ${hl(r.email, q)}</a>
          <button class="ct-copy" data-copy="${esc(r.email)}" title="복사">📋</button></span>` : ""}
      </div>
      ${r.note ? `<div class="ct-note">${hl(r.note, q)}</div>` : ""}
    </div>`;
  }
  function emailRow(r, q) {
    return `<div class="ct-row ct-row-mail">
      <div class="ct-who"><b class="ct-name">${hl(r.name || "", q)}</b></div>
      <div class="ct-nums"><span class="ct-num">
        <a class="ct-tel" href="mailto:${esc(r.email || "")}">✉️ ${hl(r.email || "", q)}</a>
        <button class="ct-copy" data-copy="${esc(r.email || "")}" title="복사">📋</button></span></div>
    </div>`;
  }
  function incidentCard(r, q) {
    // 시트 원본 색 단계: ① 노랑 → ② 호박 → ③ 주황 → ④ 짙은 빨강 (중대)
    const lvl = { "①": 1, "②": 2, "③": 3, "④": 4 }[String(r.no || "").trim()] || 0;
    return `<div class="ct-inc${lvl ? " ct-lv" + lvl : ""}">
      <div class="ct-inc-head">
        <span class="ct-inc-no">${esc(r.no || "•")}</span>
        <div class="ct-inc-to"><span class="ct-inc-tolabel">보고처 (SMS)</span>${nl2br(r.to || "", q)}</div>
      </div>
      <div class="ct-inc-items">${nl2br(r.items || "", q)}</div>
    </div>`;
  }
  function procedureCard(r, q, open) {
    return `<details class="ct-acc"${open ? " open" : ""}>
      <summary>${hl(r.title || "", q)}</summary>
      <div class="ct-acc-body">${nl2br(r.body || "", q)}</div>
    </details>`;
  }

  function sectionHTML(sec, q, canWrite) {
    const rows = (sec.rows || []).filter(r => matches(rowText(r), q) || matches(sec.title || "", q));
    if (q && !rows.length) return "";
    const editBtn = canWrite ? `<button class="btn btn-ghost btn-sm ct-edit" data-ct-edit="${esc(sec.id)}" title="편집">✎</button>` : "";
    const duty = sec.duty ? `<a class="ct-duty" href="${esc(telHref(sec.duty))}" title="당직실 전화">🌙 당직실 ${hl(sec.duty, q)}</a>` : "";

    if (sec.type === "procedure") {
      return `<div class="card ct-sec ct-proc" data-ct-sec="${esc(sec.id)}">
        <div class="card-title">${esc(sec.icon || "📋")} ${hl(sec.title || "보고 절차", q)} <span class="spacer"></span>${editBtn}</div>
        ${rows.map((r, i) => procedureCard(r, q, !!q || i === 0)).join("")}
        ${sec.note ? `<div class="ct-secnote">${nl2br(sec.note, q)}</div>` : ""}
      </div>`;
    }
    if (sec.type === "incidents") {
      return `<div class="card ct-sec ct-incsec" data-ct-sec="${esc(sec.id)}">
        <div class="card-title">${esc(sec.icon || "🚨")} ${hl(sec.title || "사건별 보고처", q)} <span class="spacer"></span>${editBtn}</div>
        ${sec.note ? `<div class="ct-secnote" style="margin:0 0 10px">${nl2br(sec.note, q)}</div>` : ""}
        <div class="ct-inc-grid">${rows.map(r => incidentCard(r, q)).join("")}</div>
      </div>`;
    }
    if (sec.type === "emails") {
      const all = (sec.rows || []).map(r => r.email).filter(Boolean);
      return `<div class="card ct-sec" data-ct-sec="${esc(sec.id)}">
        <div class="card-title">${esc(sec.icon || "📧")} ${hl(sec.title || "", q)} <span class="spacer"></span>${editBtn}</div>
        ${rows.map(r => emailRow(r, q)).join("") || '<div class="empty">등록된 항목이 없습니다.</div>'}
        ${all.length ? `<div class="ct-mailall">
          <a class="btn btn-ghost btn-sm" href="mailto:${esc(all.join(","))}">✉️ 전체 메일 작성</a>
          <button class="btn btn-ghost btn-sm" data-copy="${esc(all.join(", "))}" id="ct-copy-all">📋 전체 주소 복사</button></div>` : ""}
        ${sec.note ? `<div class="ct-secnote">${nl2br(sec.note, q)}</div>` : ""}
      </div>`;
    }
    // people (기본)
    return `<div class="card ct-sec${sec.accent === "danger" ? " ct-danger" : ""}" data-ct-sec="${esc(sec.id)}">
      <div class="card-title">${esc(sec.icon || "☎️")} ${hl(sec.title || "", q)} <span class="spacer"></span>${duty}${editBtn}</div>
      ${rows.map(r => peopleRow(r, q)).join("") || '<div class="empty">등록된 항목이 없습니다.</div>'}
      ${sec.note ? `<div class="ct-secnote">${nl2br(sec.note, q)}</div>` : ""}
    </div>`;
  }

  function bodyHTML(q, canWrite) {
    const list = secs();
    if (!list.length) {
      return `<div class="card"><div class="empty" style="padding:32px 10px">
        ☁️ 아직 등록된 연락망이 없습니다.<br>
        <span style="font-size:.8rem;color:var(--text-3)">공용 DB에 데이터가 있으면 연결 시 자동으로 표시됩니다.${canWrite ? " 아래 버튼으로 화물팀 기본 구성(빈 서식)을 만들고 각 섹션의 ✎ 로 내용을 채워 주세요." : ""}</span>
        ${canWrite ? '<div style="margin-top:14px"><button class="btn btn-primary btn-sm" id="ct-seed">🧩 기본 구성 만들기</button></div>' : ""}</div></div>`;
    }
    const wide = list.filter(s => s.type === "procedure" || s.type === "incidents");
    const grid = list.filter(s => s.type !== "procedure" && s.type !== "incidents");
    const wideHTML = wide.map(s => sectionHTML(s, q, canWrite)).join("");
    const gridHTML = grid.map(s => sectionHTML(s, q, canWrite)).join("");
    const out = wideHTML + (gridHTML ? `<div class="ct-grid">${gridHTML}</div>` : "");
    return out.trim() ? out : `<div class="card"><div class="empty">🔍 "${esc(q)}" 검색 결과가 없습니다.</div></div>`;
  }


  /* ─────── 화물팀 기본 구성 (빈 서식 — 개인정보 미포함) ─────── */
  function seedSections() {
    return [
      { id: "cs-proc", type: "procedure", icon: "📋", title: "보고 절차", rows: [
        { id: "cp1", title: "① 최초 보고 (인지 후 30분 이내)", body: "사건 인지 즉시 안전보안파트 담당자에게 SMS로 1차 보고합니다.\n포함 내용: 발생 일시 · 장소 · 사건 개요 · 인명/물적 피해 · 현장 조치 · 보고자 연락처" },
        { id: "cp2", title: "② 서면 보고 (지체 없이)", body: "1차 보고 후 서식에 따라 이메일로 2차 보고합니다. 사진·CCTV 등 증빙을 첨부합니다." },
        { id: "cp3", title: "③ 유관기관 통보", body: "안전보안파트가 사안에 따라 공항공사·지방항공청·경찰·소방 등 유관기관에 통보합니다." }
      ], note: "" },
      { id: "cs-inc", type: "incidents", icon: "🚨", title: "사건별 보고처", rows: [
        { id: "ci1", no: "①", items: "경미한 안전 이슈 · 아차사고(Near-miss)", to: "안전보안파트 담당자" },
        { id: "ci2", no: "②", items: "인적 부상 · 장비 파손 · 화물 손상", to: "안전보안파트 → 인천화물팀장" },
        { id: "ci3", no: "③", items: "보안 위반 · 미검색 화물 · 보호구역 무단 출입", to: "안전보안파트 → 항공보안파트(본사)" },
        { id: "ci4", no: "④", items: "중대재해 · 화재 · 폭발물 의심 · 테러 위협", to: "즉시 119/112 → 안전보안파트 → 팀장 → 안전보안실" }
      ], note: "" },
      { id: "cs-part", type: "people", icon: "🛡️", title: "인천화물팀 안전보안파트", accent: "danger", duty: "", rows: [], note: "" },
      { id: "cs-team", type: "people", icon: "🏢", title: "인천화물팀", duty: "", rows: [], note: "" },
      { id: "cs-hq", type: "people", icon: "🏛", title: "본사 안전보안실 · 항공보안파트", duty: "", rows: [], note: "" },
      { id: "cs-icn", type: "people", icon: "🛫", title: "인천공항공사 · 화물터미널", duty: "", rows: [], note: "" },
      { id: "cs-gov", type: "people", icon: "⚖️", title: "국토부 · 서울지방항공청", duty: "", rows: [], note: "" },
      { id: "cs-emg", type: "people", icon: "🚒", title: "긴급 · 공항경찰 · 소방 · 세관", duty: "", rows: [
        { id: "ce1", role: "긴급", name: "경찰", mobile: "", office: "112", duty: "", note: "" },
        { id: "ce2", role: "긴급", name: "소방·구급", mobile: "", office: "119", duty: "", note: "" }
      ], note: "" },
      { id: "cs-mail", type: "emails", icon: "📧", title: "서면 보고 이메일", rows: [], note: "" }
    ];
  }
  const SEC_TYPES = [["people", "연락처 (기관·담당자)"], ["procedure", "절차 (아코디언)"], ["incidents", "사건별 보고처"], ["emails", "이메일 목록"]];
  function addSectionForm() {
    openModal(`
      <h3>+ 섹션 추가</h3>
      <div class="form-row"><label>유형</label><select id="cs-type">${SEC_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
      <div class="form-grid">
        <div class="form-row"><label>아이콘</label><input id="cs-icon" maxlength="4" value="☎️"></div>
        <div class="form-row"><label>제목</label><input id="cs-title" maxlength="40" placeholder="예: 조업사 ○○ 안전담당"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cs-cancel">취소</button>
        <button class="btn btn-primary" id="cs-save">추가</button>
      </div>`);
    $("#cs-cancel").onclick = closeModal;
    $("#cs-save").onclick = () => {
      const title = $("#cs-title").value.trim();
      if (!title) { toast("제목을 입력하세요.", true); return; }
      const type = $("#cs-type").value;
      secs().push({ id: uid("cs"), type, icon: $("#cs-icon").value.trim(), title, rows: [], note: "", duty: type === "people" ? "" : undefined });
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("섹션이 추가되었습니다. ✎ 로 내용을 채워 주세요.");
    };
  }

  /* ─────── 편집 (hq+) ─────── */
  const FIELD_DEFS = {
    procedure: [["title", "구분", "input"], ["body", "절차 내용", "textarea"]],
    incidents: [["no", "그룹", "input-sm"], ["items", "보고 대상 행위", "textarea"], ["to", "보고처 (SMS)", "textarea"]],
    people: [["role", "직책/구분", "input"], ["name", "성명", "input"], ["mobile", "휴대전화(SMS)", "input"],
             ["office", "사무실/유선", "input"], ["duty", "담당", "input"], ["note", "비고", "input"]],
    emails: [["name", "성명/직책", "input"], ["email", "이메일", "input"]]
  };

  function editSection(secId) {
    const sec = secs().find(s => s.id === secId);
    if (!sec) return;
    const defs = FIELD_DEFS[sec.type] || FIELD_DEFS.people;
    let rows = (sec.rows || []).map(r => Object.assign({}, r));

    const rowBlock = (r, i) => `<div class="ct-editrow" data-row="${i}">
      <div class="ct-editfields">
        ${defs.map(([f, label, kind]) => kind === "textarea"
          ? `<label class="ct-ef ct-ef-wide"><span>${label}</span><textarea data-i="${i}" data-f="${f}" rows="3">${esc(r[f] || "")}</textarea></label>`
          : `<label class="ct-ef${kind === "input-sm" ? " ct-ef-sm" : ""}"><span>${label}</span><input data-i="${i}" data-f="${f}" value="${esc(r[f] || "")}"></label>`).join("")}
      </div>
      <div class="ct-editrow-btns">
        <button type="button" class="btn btn-ghost btn-sm" data-mv="-1" data-row-i="${i}" title="위로">↑</button>
        <button type="button" class="btn btn-ghost btn-sm" data-mv="1" data-row-i="${i}" title="아래로">↓</button>
        <button type="button" class="btn btn-ghost btn-sm ct-delrow" data-del="${i}" title="삭제">🗑</button>
      </div>
    </div>`;

    const bodyEl = () => $("#cte-rows");
    function collect() {
      $$("#cte-rows [data-i]").forEach(inp => { rows[Number(inp.dataset.i)][inp.dataset.f] = inp.value; });
    }
    function paint() {
      bodyEl().innerHTML = rows.map(rowBlock).join("") || '<div class="empty">항목이 없습니다. 아래에서 추가하세요.</div>';
      $$("#cte-rows [data-del]").forEach(b => b.onclick = () => {
        collect(); rows.splice(Number(b.dataset.del), 1); paint();
      });
      $$("#cte-rows [data-mv]").forEach(b => b.onclick = () => {
        collect();
        const i = Number(b.dataset.rowI), j = i + Number(b.dataset.mv);
        if (j < 0 || j >= rows.length) return;
        const t = rows[i]; rows[i] = rows[j]; rows[j] = t;
        paint();
      });
    }

    openModal(`
      <h3>✎ ${esc(sec.title || "")} <span class="badge badge-gray">연락망 편집</span></h3>
      <div id="cte-rows" class="ct-editlist"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="cte-add" style="margin-top:8px">+ 행 추가</button>
      <div class="form-row" style="margin-top:12px"><label>하단 주석 (선택)</label>
        <textarea id="cte-note" rows="2">${esc(sec.note || "")}</textarea></div>
      ${sec.duty !== undefined || sec.type === "people" ? `<div class="form-row"><label>당직실 번호 (선택)</label>
        <input id="cte-duty" value="${esc(sec.duty || "")}" placeholder="예: 032-740-2107, 2108"></div>` : ""}
      <div class="modal-actions">
        ${SeMIS.canDelete() ? '<button class="btn btn-danger btn-sm" id="cte-delsec" style="margin-right:auto">섹션 삭제</button>' : ""}
        <button class="btn btn-ghost" id="cte-cancel">취소</button>
        <button class="btn btn-primary" id="cte-save">저장</button>
      </div>`, { wide: true });

    paint();
    const delSec = $("#cte-delsec");
    if (delSec) delSec.onclick = () => {
      closeModal();
      SeMIS.confirmModal(`섹션 "${sec.title}"과 그 안의 항목이 모두 삭제됩니다. 계속하시겠습니까?`, () => {
        D().contacts.sections = secs().filter(x => x.id !== sec.id);
        SeMIS.save(); SeMIS.renderView(); toast("섹션이 삭제되었습니다.");
      });
    };
    $("#cte-add").onclick = () => {
      collect();
      const r = { id: uid("ct") };
      defs.forEach(([f]) => { r[f] = ""; });
      rows.push(r); paint();
      const list = bodyEl(); list.scrollTop = list.scrollHeight;
    };
    $("#cte-cancel").onclick = closeModal;
    $("#cte-save").onclick = () => {
      collect();
      sec.rows = rows.filter(r => defs.some(([f]) => String(r[f] || "").trim()));
      sec.note = $("#cte-note").value.trim();
      const dutyEl = $("#cte-duty");
      if (dutyEl) sec.duty = dutyEl.value.trim();
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다. (실시간 공유)");
    };
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("contacts", {
    title: "비상연락망 · 보고체계",
    render(root) {
      const canWrite = SeMIS.canEdit();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">비상연락망 · 보고체계</div>
          <span class="spacer"></span>
          ${canWrite && secs().length ? '<button class="btn btn-ghost btn-sm" id="ct-addsec">+ 섹션 추가</button>' : ""}
          <div class="page-desc">화물터미널 안전·보안 사건 발생 시 보고 절차 · 유관기관 비상 연락처</div>
        </div>
        <div class="ct-hero">
          <div class="ct-hero-main">🚨 안전·보안 사건 발생 시 <b>인지 후 30분 이내</b> SMS 최초 보고</div>
          <div class="ct-hero-sub">1차 SMS → 2차 서면 보고(E-MAIL) · 보고 내용은 파트 내 보관</div>
        </div>
        <div class="ct-searchwrap">
          <input id="ct-search" class="ct-search" type="search"
            placeholder="이름 · 기관 · 전화번호 · 담당 통합 검색" value="${esc(query)}" autocomplete="off">
        </div>
        <div id="ct-body">${bodyHTML(query, canWrite)}</div>`;

      const sInput = $("#ct-search");
      sInput.oninput = () => {
        query = sInput.value.trim();
        $("#ct-body").innerHTML = bodyHTML(query, canWrite);
        wireBody(canWrite);
      };
      wireBody(canWrite);
    }
  });

  function wireBody(canWrite) {
    $$("#ct-body [data-copy]").forEach(b => b.onclick = (ev) => { ev.preventDefault(); copyText(b.dataset.copy); });
    if (canWrite) $$("#ct-body [data-ct-edit]").forEach(b => b.onclick = () => editSection(b.dataset.ctEdit));
    const seedBtn = $("#ct-seed");
    if (seedBtn) seedBtn.onclick = () => {
      if (!canWrite) return;
      if (secs().length) { SeMIS.renderView(); return; }
      D().contacts.sections = seedSections();
      SeMIS.save(); SeMIS.renderView(); toast("기본 구성을 만들었습니다. 각 섹션의 ✎ 로 연락처를 채워 주세요.");
    };
    const addBtn = $("#ct-addsec");
    if (addBtn) addBtn.onclick = addSectionForm;
  }

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisContacts = { seedSections,
    telHref, smsHref, isMobile, matches, rowText,
    sections: secs, editSection,
    getQuery: () => query, setQuery: (q) => { query = String(q || ""); }
  };
})();
