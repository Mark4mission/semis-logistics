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
     flows (v1.10 보고 체계도): [{ id, title, short, ver, steps, memo, fileUrl, fileName, imgUrl, thumbUrl,
                                  rows: [{ id, grp, role, office, mobile, note }] }]
   ※ 연락처 실데이터·파일 주소는 코드에 시드하지 않음(개인정보) — 공용 DB(semis_logi_store "contacts")에서 동기화.
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
    // "032-000-1000~2" 같은 범위 표기도 첫 번호로
    const s = String(num || "").split(/[,/~]/)[0].trim();
    const d = s.replace(/[^\d]/g, "");
    if (!d) return "";
    if (/^\+/.test(s)) return "tel:+" + d;               // 국제번호 (+1-…, +65-…)
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
    const flowPart = flowsHTML(q, canWrite);
    if (!list.length) {
      return flowPart + `<div class="card"><div class="empty" style="padding:32px 10px">
        ☁️ 아직 등록된 연락망이 없습니다.<br>
        <span style="font-size:.8rem;color:var(--text-3)">공용 DB에 데이터가 있으면 연결 시 자동으로 표시됩니다.${canWrite ? " 아래 버튼으로 화물팀 기본 구성(빈 서식)을 만들고 각 섹션의 ✎ 로 내용을 채워 주세요." : ""}</span>
        ${canWrite ? '<div style="margin-top:14px"><button class="btn btn-primary btn-sm" id="ct-seed">🧩 기본 구성 만들기</button></div>' : ""}</div></div>`;
    }
    const wide = list.filter(s => s.type === "procedure" || s.type === "incidents");
    const grid = list.filter(s => s.type !== "procedure" && s.type !== "incidents");
    const wideHTML = wide.map(s => sectionHTML(s, q, canWrite)).join("");
    const gridHTML = grid.map(s => sectionHTML(s, q, canWrite)).join("");
    const out = flowPart + wideHTML + (gridHTML ? `<div class="ct-grid">${gridHTML}</div>` : "");
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
      /* 검색 중이면 새 섹션이 목록에서 빠져 보이지 않는다 — 검색어를 풀고 전체를 보여 준다 */
      const hadQ = !!query; if (hadQ) query = "";
      SeMIS.save(); closeModal(); SeMIS.renderView();
      toast("섹션이 추가되었습니다. ✎ 로 내용을 채워 주세요." + (hadQ ? " (검색어 해제)" : ""));
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

  /* 행 편집기 — 연락처 섹션 · 보고 체계도 공용. rows 배열을 제자리에서 고친다. */
  function rowEditor(listSel, defs, rows) {
    let hits = new Set();   // 방금 바뀐 행(개정 비교 반영) 강조
    const rowBlock = (r, i) => `<div class="ct-editrow${hits.has(r.id) ? " ct-editrow-hit" : ""}" data-row="${i}">
      <div class="ct-editfields">
        ${defs.map(([f, label, kind]) => kind === "textarea"
          ? `<label class="ct-ef ct-ef-wide"><span>${label}</span><textarea data-i="${i}" data-f="${f}" rows="3">${esc(r[f] || "")}</textarea></label>`
          : `<label class="ct-ef${kind === "input-sm" ? " ct-ef-sm" : kind === "input-md" ? " ct-ef-md" : ""}"><span>${label}</span><input data-i="${i}" data-f="${f}" value="${esc(r[f] || "")}"></label>`).join("")}
      </div>
      <div class="ct-editrow-btns">
        <button type="button" class="btn btn-ghost btn-sm" data-mv="-1" data-row-i="${i}" title="위로">↑</button>
        <button type="button" class="btn btn-ghost btn-sm" data-mv="1" data-row-i="${i}" title="아래로">↓</button>
        <button type="button" class="btn btn-ghost btn-sm ct-delrow" data-del="${i}" title="삭제">🗑</button>
      </div>
    </div>`;
    function collect() {
      $$(listSel + " [data-i]").forEach(inp => { rows[Number(inp.dataset.i)][inp.dataset.f] = inp.value; });
    }
    function paint() {
      $(listSel).innerHTML = rows.map(rowBlock).join("") || '<div class="empty">항목이 없습니다. 아래에서 추가하세요.</div>';
      $$(listSel + " [data-del]").forEach(b => b.onclick = () => {
        collect(); rows.splice(Number(b.dataset.del), 1); paint();
      });
      $$(listSel + " [data-mv]").forEach(b => b.onclick = () => {
        collect();
        const i = Number(b.dataset.rowI), j = i + Number(b.dataset.mv);
        if (j < 0 || j >= rows.length) return;
        const t = rows[i]; rows[i] = rows[j]; rows[j] = t;
        paint();
      });
    }
    function add() {
      collect();
      const r = { id: uid("ct") };
      defs.forEach(([f]) => { r[f] = ""; });
      rows.push(r); paint();
      const list = $(listSel); list.scrollTop = list.scrollHeight;
    }
    function mark(ids) { hits = new Set(ids || []); paint(); }
    return { collect, paint, add, mark };
  }

  function editSection(secId) {
    const sec = secs().find(s => s.id === secId);
    if (!sec) return;
    const defs = FIELD_DEFS[sec.type] || FIELD_DEFS.people;
    const rows = (sec.rows || []).map(r => Object.assign({}, r));
    const ed = rowEditor("#cte-rows", defs, rows);

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

    ed.paint();
    const delSec = $("#cte-delsec");
    if (delSec) delSec.onclick = () => {
      closeModal();
      SeMIS.confirmModal(`섹션 "${sec.title}"과 그 안의 항목이 모두 삭제됩니다. 계속하시겠습니까?`, () => {
        D().contacts.sections = secs().filter(x => x.id !== sec.id);
        SeMIS.save(); SeMIS.renderView(); toast("섹션이 삭제되었습니다.");
      });
    };
    $("#cte-add").onclick = ed.add;
    $("#cte-cancel").onclick = closeModal;
    $("#cte-save").onclick = () => {
      ed.collect();
      sec.rows = rows.filter(r => defs.some(([f]) => String(r[f] || "").trim()));
      sec.note = $("#cte-note").value.trim();
      const dutyEl = $("#cte-duty");
      if (dutyEl) sec.duty = dutyEl.value.trim();
      /* 검색 중이면 방금 입력한 행이 검색어에 안 걸려 보이지 않을 수 있다 → 검색어 해제 */
      const hadQ = !!query; if (hadQ) query = "";
      SeMIS.save(); closeModal(); SeMIS.renderView();
      toast("저장되었습니다. (실시간 공유)" + (hadQ ? " 검색어를 지웠습니다." : ""));
    };
  }

  /* ═════════ 보고 체계도 (v1.10) ═════════
     사고 유형별 탭(보안사고 · 안전사고 · 위험물사고 …) — 탭마다 체계도 미리보기(누르면 전체 화면 뷰어),
     보고 순서, 구분별 연락처(원터치 전화·문자·복사). 파일은 semis-logi-files/contacts/ (공개 URL). */
  const flows = () => (Array.isArray(C().flows) ? C().flows : []);
  const flowRows = (f) => (f && Array.isArray(f.rows) ? f.rows : []);
  let flowTab = "";      // 선택한 체계도 id (모듈 내 상태)
  const FLOW_DEFS = [["grp", "구분", "input-md"], ["role", "기관 · 직책", "input"], ["office", "유선", "input"],
                     ["mobile", "휴대전화(SMS)", "input"], ["note", "비고", "input"]];
  const FILE_MAX = 25 * 1024 * 1024;

  /* 검색: 체계도 제목·탭 이름이 맞으면 그 체계도 전체, 아니면 맞는 행만 */
  function flowVisibleRows(f, q) {
    const all = flowRows(f);
    if (!q || matches([f.title, f.short].join(" "), q)) return all;
    return all.filter(r => matches([r.grp, r.role, r.office, r.mobile, r.note].join(" "), q));
  }
  function groupRows(rows) {
    const out = [], by = {};
    rows.forEach(r => {
      const k = String(r.grp || "").trim();
      if (!by[k]) { by[k] = { title: k, rows: [] }; out.push(by[k]); }
      by[k].rows.push(r);
    });
    return out;
  }
  function flowRowHTML(r, q) {
    return `<div class="ct-row ct-frow">
      <div class="ct-who"><b class="ct-name">${hl(r.role || "", q)}</b>${r.note ? `<span class="ct-dutytxt">${hl(r.note, q)}</span>` : ""}</div>
      <div class="ct-nums">${numHTML(r.office, "office", q)}${numHTML(r.mobile, "mobile", q)}</div>
    </div>`;
  }
  function stepsHTML(f, q) {
    const st = String(f.steps || "").split(/\n+/).map(x => x.trim()).filter(Boolean);
    if (!st.length) return "";
    return `<ol class="ct-fsteps" aria-label="보고 순서">${st.map(x => `<li>${hl(x, q)}</li>`).join("")}</ol>`;
  }
  function flowPanelHTML(f, q, canWrite, active) {
    const rows = flowVisibleRows(f, q);
    const thumb = f.thumbUrl || f.imgUrl;
    const hasDoc = !!(f.imgUrl || f.fileUrl);
    const groups = groupRows(rows);
    return `<div class="ct-fpanel" role="tabpanel" id="ctf-panel-${esc(f.id)}" aria-labelledby="ctf-tab-${esc(f.id)}" data-ctf-panel="${esc(f.id)}"${active ? "" : " hidden"}>
      <div class="ct-fgrid${hasDoc ? "" : " no-doc"}">
        ${hasDoc ? `<button type="button" class="ct-fthumb" data-ctf-view="${esc(f.id)}" aria-label="${esc(f.title || "")} 체계도 크게 보기">
          ${thumb ? `<img src="${esc(thumb)}" alt="" decoding="async" width="640" height="906">`
                  : `<span class="ct-fthumb-pdf">${SeMIS.icon("doc", 34)}<span>PDF</span></span>`}
          <span class="ct-fzoom">${SeMIS.icon("eye", 16)}<span>크게 보기</span></span>
        </button>` : ""}
        <div class="ct-fbody">
          <div class="ct-fmeta">
            <h3 class="ct-ftitle">${hl(f.title || "", q)}</h3>
            ${f.ver ? `<span class="ct-fver mono">Ver.${esc(f.ver)}</span>` : ""}
            <span class="spacer"></span>
            ${f.fileUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(f.fileUrl)}" target="_blank" rel="noopener">${SeMIS.icon("external", 15)}<span>PDF 원본</span></a>` : ""}
            ${canWrite ? `<button type="button" class="btn btn-ghost btn-sm" data-ctf-edit="${esc(f.id)}" title="체계도 편집">✎ 편집</button>` : ""}
          </div>
          ${stepsHTML(f, q)}
          <div class="ct-fgroups">${groups.map(g => `<div class="ct-fgrp">
            ${g.title ? `<div class="ct-fgrp-t">${hl(g.title, q)}</div>` : ""}
            ${g.rows.map(r => flowRowHTML(r, q)).join("")}</div>`).join("") || '<div class="empty">등록된 연락처가 없습니다.</div>'}</div>
          ${f.memo ? `<details class="ct-acc ct-fmemo"${q && matches(f.memo, q) ? " open" : ""}>
            <summary>조치 사항</summary><div class="ct-acc-body">${nl2br(f.memo, q)}</div></details>` : ""}
        </div>
      </div>
    </div>`;
  }
  function flowsHTML(q, canWrite) {
    const list = flows();
    if (!list.length) return "";
    const counts = list.map(f => flowVisibleRows(f, q).length);
    if (q && counts.every(n => !n) && !list.some(f => matches(f.memo || "", q))) return "";
    let act = list.some(f => f.id === flowTab) ? flowTab : list[0].id;
    if (q && !counts[list.findIndex(f => f.id === act)]) {
      const i = counts.findIndex(n => n > 0);
      if (i >= 0) act = list[i].id;
    }
    return `<section class="card ct-flow" aria-labelledby="ctf-h">
      <div class="ct-fhead">
        <h2 class="card-title" id="ctf-h">보고 체계도</h2>
        <div class="ct-ftabs" role="tablist" aria-label="사고 유형">
          ${list.map((f, i) => `<button type="button" role="tab" class="ct-ftab" id="ctf-tab-${esc(f.id)}" data-ctf-tab="${esc(f.id)}"
            aria-controls="ctf-panel-${esc(f.id)}" aria-selected="${f.id === act}" tabindex="${f.id === act ? 0 : -1}">${esc(f.short || f.title || "체계도")}${q ? `<span class="ct-fcount">${counts[i]}</span>` : ""}</button>`).join("")}
        </div>
      </div>
      ${list.map(f => flowPanelHTML(f, q, canWrite, f.id === act)).join("")}
    </section>`;
  }
  function selectFlowTab(id, focus) {
    const root = $("#ct-body");
    if (!root || !flows().some(f => f.id === id)) return;
    flowTab = id;
    $$(".ct-ftab", root).forEach(b => {
      const on = b.dataset.ctfTab === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    $$(".ct-fpanel", root).forEach(p => { p.hidden = p.dataset.ctfPanel !== id; });
  }
  function wireFlows(canWrite) {
    const root = $("#ct-body");
    if (!root) return;
    const tabs = $$(".ct-ftab", root);
    tabs.forEach((b, i) => {
      b.onclick = () => selectFlowTab(b.dataset.ctfTab);
      b.onkeydown = (ev) => {
        const n = tabs.length;
        const j = ev.key === "ArrowRight" ? (i + 1) % n : ev.key === "ArrowLeft" ? (i - 1 + n) % n
          : ev.key === "Home" ? 0 : ev.key === "End" ? n - 1 : -1;
        if (j < 0) return;
        ev.preventDefault();
        selectFlowTab(tabs[j].dataset.ctfTab, true);
      };
    });
    $$("[data-ctf-view]", root).forEach(b => b.onclick = () => openViewer(b.dataset.ctfView));
    if (canWrite) $$("[data-ctf-edit]", root).forEach(b => b.onclick = () => editFlow(b.dataset.ctfEdit));
  }

  /* ─────── 체계도 전체 화면 뷰어 (<dialog> · 이미지 우선, 없으면 PDF) ───────
     누르면 확대(누른 지점 기준) · 다시 누르면 화면 맞춤 · ←/→ 로 다른 체계도 · Esc/바깥 누르면 닫기 */
  let vwId = "", vwZoom = false, vwPushed = false;   // vwPushed: 휴대폰 '뒤로'로 닫기 위해 넣은 기록 1칸
  const viewable = () => flows().filter(f => f.imgUrl || f.fileUrl);
  function viewerEl() {
    let d = document.getElementById("ct-viewer");
    if (d) return d;
    d = document.createElement("dialog");
    d.id = "ct-viewer";
    d.className = "ct-viewer";
    d.setAttribute("closedby", "any");
    d.setAttribute("aria-labelledby", "ctv-title");
    d.innerHTML = `
      <div class="ctv-bar">
        <div class="ctv-t"><b id="ctv-title"></b><span class="ctv-ver mono"></span></div>
        <div class="ctv-acts">
          <button type="button" class="ctv-btn ctv-ico ctv-prev" data-ctv="prev" aria-label="이전 체계도">${SeMIS.icon("chevron", 20)}</button>
          <span class="ctv-pos mono" aria-live="polite"></span>
          <button type="button" class="ctv-btn ctv-ico" data-ctv="next" aria-label="다음 체계도">${SeMIS.icon("chevron", 20)}</button>
          <button type="button" class="ctv-btn ctv-zoombtn" data-ctv="zoom" aria-pressed="false">${SeMIS.icon("search", 17)}<span>확대</span></button>
          <a class="ctv-btn ctv-pdf" target="_blank" rel="noopener">${SeMIS.icon("external", 16)}<span>PDF 원본</span></a>
          <button type="button" class="ctv-btn ctv-ico ctv-close" data-ctv="close" aria-label="닫기" autofocus>${SeMIS.icon("x", 20)}</button>
        </div>
      </div>
      <div class="ctv-stage" data-ctv-stage></div>`;
    document.body.appendChild(d);
    d.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-ctv]");
      if (b) {
        const a = b.dataset.ctv;
        if (a === "close") closeViewer();
        else if (a === "prev") stepViewer(-1);
        else if (a === "next") stepViewer(1);
        else if (a === "zoom") setZoom(!vwZoom);
        return;
      }
      const stage = d.querySelector("[data-ctv-stage]");
      if (ev.target.classList && ev.target.classList.contains("ctv-img")) { setZoom(!vwZoom, ev); return; }
      // 바깥(배경) 누르면 닫기 — closedby 미지원 브라우저(Safari) 대비 + 이미지 둘레 빈 곳
      if (ev.target === d || (ev.target === stage && !vwZoom)) closeViewer();
    });
    d.addEventListener("keydown", (ev) => {
      if (vwZoom || ev.target.closest("a,input,textarea")) return;
      if (ev.key === "ArrowRight") { ev.preventDefault(); stepViewer(1); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); stepViewer(-1); }
    });
    d.addEventListener("close", resetViewer);
    window.addEventListener("popstate", () => {
      const v = document.getElementById("ct-viewer");
      if (vwPushed) { vwPushed = false; if (v && (v.open || v.hasAttribute("open"))) closeViewer(); }
    });
    return d;
  }
  function paintViewer() {
    const d = viewerEl(), list = viewable();
    const i = Math.max(0, list.findIndex(f => f.id === vwId));
    const f = list[i];
    if (!f) return;
    vwId = f.id;
    $("#ctv-title", d).textContent = f.title || "보고 체계도";
    $(".ctv-ver", d).textContent = f.ver ? "Ver." + f.ver : "";
    $(".ctv-pos", d).textContent = list.length > 1 ? (i + 1) + " / " + list.length : "";
    $$("[data-ctv=prev],[data-ctv=next],.ctv-pos", d).forEach(el => { el.hidden = list.length < 2; });
    const pdf = $(".ctv-pdf", d);
    pdf.hidden = !f.fileUrl;
    if (f.fileUrl) pdf.href = f.fileUrl; else pdf.removeAttribute("href");
    $("[data-ctv=zoom]", d).hidden = !f.imgUrl;
    const stage = $("[data-ctv-stage]", d);
    setZoom(false);
    if (f.imgUrl) {
      stage.innerHTML = `<img class="ctv-img" alt="${esc(f.title || "")} 체계도" src="${esc(f.thumbUrl || f.imgUrl)}">`;
      if (f.thumbUrl && f.thumbUrl !== f.imgUrl) {           // 미리보기로 먼저 띄우고 원본으로 교체
        const full = new Image();
        full.onload = () => { const img = $(".ctv-img", stage); if (img && vwId === f.id) img.src = f.imgUrl; };
        full.src = f.imgUrl;
      }
    } else {
      stage.innerHTML = `<iframe class="ctv-frame" src="${esc(f.fileUrl)}" title="${esc(f.title || "")} 체계도"></iframe>`;
    }
  }
  function openViewer(id) {
    if (!viewable().some(f => f.id === id)) return;
    vwId = id;
    const d = viewerEl();
    paintViewer();
    if (!d.open && !d.hasAttribute("open")) {
      try { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
      catch (e) { d.setAttribute("open", ""); }
      try { history.pushState({ ctViewer: 1 }, ""); vwPushed = true; } catch (e) { /* noop */ }
    }
    document.documentElement.classList.add("ct-viewing");
  }
  function closeViewer() {
    const d = document.getElementById("ct-viewer");
    if (!d) return;
    try { if (typeof d.close === "function" && d.open) d.close(); } catch (e) { /* noop */ }
    d.removeAttribute("open");
    resetViewer();
  }
  function resetViewer() {
    const d = document.getElementById("ct-viewer");
    document.documentElement.classList.remove("ct-viewing");
    vwZoom = false;
    if (vwPushed) { vwPushed = false; try { history.back(); } catch (e) { /* noop */ } }
    if (d && !d.open) { const st = $("[data-ctv-stage]", d); if (st) st.innerHTML = ""; }
  }
  function stepViewer(dir) {
    const list = viewable();
    if (list.length < 2) return;
    const i = list.findIndex(f => f.id === vwId);
    vwId = list[(i + dir + list.length) % list.length].id;
    paintViewer();
    if (flows().some(f => f.id === vwId)) selectFlowTab(vwId);
  }
  function setZoom(on, ev) {
    const d = document.getElementById("ct-viewer");
    if (!d) return;
    const stage = $("[data-ctv-stage]", d), img = $(".ctv-img", stage), btn = $("[data-ctv=zoom]", d);
    vwZoom = !!(on && img);
    if (btn) {
      btn.setAttribute("aria-pressed", String(vwZoom));
      btn.lastElementChild.textContent = vwZoom ? "화면 맞춤" : "확대";
    }
    if (!img) return;
    if (vwZoom) {
      const r = img.getBoundingClientRect();
      const fx = ev && r.width ? (ev.clientX - r.left) / r.width : 0.5;
      const fy = ev && r.height ? (ev.clientY - r.top) / r.height : 0;
      const W = Math.max(stage.clientWidth, Math.min(1800, Math.round((r.width || stage.clientWidth) * 2.2)));
      stage.classList.add("zoomed");
      img.style.width = W + "px";
      stage.scrollLeft = Math.max(0, W * fx - stage.clientWidth / 2);
      stage.scrollTop = Math.max(0, img.offsetHeight * fy - stage.clientHeight / 2);
    } else {
      stage.classList.remove("zoomed");
      img.style.width = "";
      stage.scrollTop = 0; stage.scrollLeft = 0;
    }
  }

  /* ─────── 체계도 추가 · 편집 (hq+) ─────── */
  async function uploadTo(file, kind) {
    const ok = kind === "pdf"
      ? (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""))
      : (/^image\/(png|jpeg|webp)$/.test(file.type || "") || /\.(png|jpe?g|webp)$/i.test(file.name || ""));
    if (!ok) { toast(kind === "pdf" ? "PDF 파일만 올릴 수 있습니다." : "PNG · JPG · WebP 이미지만 올릴 수 있습니다.", true); return null; }
    if (file.size > FILE_MAX) { toast(file.name + ": 25MB를 초과합니다.", true); return null; }
    if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 올릴 수 없습니다.", true); return null; }
    toast("올리는 중: " + file.name);
    try {
      const up = await SemisSync.uploadFile(file, "contacts");
      toast("올렸습니다: " + file.name);
      return { url: up.url, name: file.name };
    } catch (e) { toast("업로드 실패 — 네트워크를 확인하세요.", true); return null; }
  }
  function editFlow(id) {
    const isNew = !id;
    const f = isNew ? { id: uid("cf"), title: "", short: "", ver: "", steps: "", memo: "", rows: [] }
                    : flows().find(x => x.id === id);
    if (!f) return;
    const rows = flowRows(f).map(r => Object.assign({}, r));
    let file = f.fileUrl ? { url: f.fileUrl, name: f.fileName || "체계도.pdf" } : null;
    let img = f.imgUrl ? { url: f.imgUrl, thumb: f.thumbUrl || f.imgUrl, name: f.imgName || "미리보기 이미지" } : null;
    let imgFresh = false;   // 이번 편집에서 이미지를 새로 올렸는지 (PDF만 바꾸면 옛 이미지는 뗀다)
    const tip = SeMIS.ui.tip;

    openModal(`<div class="cfe">
      <div class="cfe-body">
        <h3>${isNew ? "보고 체계도 추가" : "보고 체계도 편집"}</h3>
        <div class="cfe-grid3">
          <div class="form-row"><label for="cfe-title">제목</label><input id="cfe-title" maxlength="40" value="${esc(f.title || "")}" placeholder="예: 보안사고 비상 연락망"></div>
          <div class="form-row"><label for="cfe-short">탭 이름</label><input id="cfe-short" maxlength="12" value="${esc(f.short || "")}" placeholder="예: 보안사고"></div>
          <div class="form-row"><label for="cfe-ver">버전</label><input id="cfe-ver" maxlength="12" value="${esc(f.ver || "")}" placeholder="예: 26.09"></div>
        </div>
        <div class="cfe-sec"><div class="cfe-sec-t">체계도 파일 ${tip("개정 PDF를 올리면 미리보기 이미지를 자동으로 만들고, 등록된 번호와 대조해 바뀐 번호를 보여 줍니다. 반영할 항목을 골라 반영한 뒤 저장합니다.", "체계도 파일 설명")}</div>
          <div id="cfe-files" class="cfe-files"></div>
          <div class="cfe-upbtns">
            <label class="btn btn-ghost btn-sm">${SeMIS.icon("doc", 16)}<span>PDF 올리기</span><input type="file" id="cfe-pdf" accept="application/pdf,.pdf" hidden></label>
            <label class="btn btn-ghost btn-sm">${SeMIS.icon("eye", 16)}<span>이미지 올리기</span><input type="file" id="cfe-img" accept="image/png,image/jpeg,image/webp" hidden></label>
          </div>
          <div id="cfe-review" class="cfe-review" aria-live="polite" hidden></div></div>
        <div class="form-row"><label class="cfe-label" for="cfe-steps">보고 순서 ${tip("최초 발견자부터 한 줄에 한 단계씩 적습니다.", "보고 순서 설명")}</label>
          <textarea id="cfe-steps" rows="4">${esc(f.steps || "")}</textarea></div>
        <div class="cfe-sec"><div class="cfe-sec-t">연락처</div>
          <div id="cfe-rows" class="ct-editlist"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="cfe-add">+ 행 추가</button></div>
        <div class="form-row"><label for="cfe-memo">조치 사항 (선택)</label>
          <textarea id="cfe-memo" rows="3">${esc(f.memo || "")}</textarea></div>
      </div>
      <div class="modal-actions">
        ${!isNew && SeMIS.canDelete() ? '<button type="button" class="btn btn-danger btn-sm" id="cfe-del" style="margin-right:auto">체계도 삭제</button>' : ""}
        <button type="button" class="btn btn-ghost" id="cfe-cancel">취소</button>
        <button type="button" class="btn btn-primary" id="cfe-save">저장</button>
      </div></div>`, { wide: true });

    const ed = rowEditor("#cfe-rows", FLOW_DEFS, rows);
    ed.paint();
    function paintFiles() {
      const box = $("#cfe-files");
      if (!box) return;
      box.innerHTML = (file ? `<div class="cfe-file">${SeMIS.icon("doc", 16)}<a href="${esc(file.url)}" target="_blank" rel="noopener">${esc(file.name)}</a>
          <button type="button" class="link-btn" data-cfe-rm="pdf">빼기</button></div>` : "") +
        (img ? `<div class="cfe-file">${img.thumb ? `<img src="${esc(img.thumb)}" alt="" width="34" height="48">` : ""}<a href="${esc(img.url)}" target="_blank" rel="noopener">${esc(img.name || "미리보기 이미지")}</a>
          <button type="button" class="link-btn" data-cfe-rm="img">빼기</button></div>` : "") ||
        '<div class="cfe-none">올린 파일이 없습니다.</div>';
      $$("#cfe-files [data-cfe-rm]").forEach(b => b.onclick = () => {
        if (b.dataset.cfeRm === "pdf") file = null; else { img = null; imgFresh = false; }
        paintFiles();
      });
    }
    paintFiles();
    /* ── 개정 PDF: 올리기 + 읽기(번호·미리보기 이미지) → 비교 목록 → 고른 항목만 반영 ── */
    let review = null;
    const FL = { office: "유선", mobile: "휴대전화" };
    const reviewBox = () => $("#cfe-review");
    function setBusy(msg) {
      const sv = $("#cfe-save");
      if (sv) sv.disabled = !!msg;
      const box = reviewBox();
      if (box && msg) { box.hidden = false; box.innerHTML = `<div class="cfe-rv-wait"><span class="cfe-spin" aria-hidden="true"></span>${esc(msg)}</div>`; }
    }
    function showReview(an) {
      const box = reviewBox();
      if (!box) return;
      box.hidden = false;
      if (!an) { review = null; box.innerHTML = '<div class="cfe-rv-note">PDF를 읽지 못해 번호 대조는 건너뛰었습니다.</div>'; return; }
      ed.collect();
      const P = window.SemisFlowPdf;
      const d = P.diffRows(rows, an.phones || []);
      const items = [];
      d.changed.forEach(c => items.push({ kind: "chg", rowId: rows[c.ri].id, role: rows[c.ri].role, f: c.f, old: c.old, num: c.num, on: true }));
      d.added.forEach(a => items.push({ kind: "add", num: a.num, label: a.label, note: a.note, grp: a.grp, mobile: a.mobile, on: true }));
      d.missing.forEach(m => items.push({ kind: "miss", rowId: rows[m.ri].id, role: rows[m.ri].role, f: m.f, old: m.old, on: false }));
      const cur = $("#cfe-ver").value.trim();
      review = { items, same: d.same.length, total: (an.phones || []).length, pages: an.pages || 1,
                 ver: an.ver && an.ver !== cur ? an.ver : "", curVer: cur, verOn: true };
      paintReview();
    }
    function missAction(it) {
      const r = rows.find(x => x.id === it.rowId);
      const other = it.f === "office" ? "mobile" : "office";
      return r && SemisFlowPdf.keyOf(r[other]) ? FL[it.f] + " 번호 비우기" : "행 삭제";
    }
    function rvItem(it, i) {
      const cb = `<input type="checkbox" data-rv="${i}"${it.on ? " checked" : ""}>`;
      if (it.kind === "chg") return `<li class="rv-chg"><label class="rv-main">${cb}<span class="rv-tag">${it.old ? "바뀜" : "추가"}</span>
        <b>${esc(it.role || "")}</b> <span class="rv-f">${FL[it.f]}</span> ${it.old ? `<s class="mono">${esc(it.old)}</s> →` : ""} <b class="mono">${esc(it.num)}</b></label></li>`;
      if (it.kind === "add") return `<li class="rv-add"><label class="rv-main">${cb}<span class="rv-tag">새 번호</span>
        <b class="mono">${esc(it.num)}</b>${it.note ? ` <span class="rv-f">(${esc(it.note)})</span>` : ""}</label>
        <div class="rv-fields"><input data-rv-name="${i}" value="${esc(it.label || "")}" placeholder="기관 · 직책" aria-label="기관 · 직책">
          <input data-rv-grp="${i}" value="${esc(it.grp || "")}" list="cfe-grps" placeholder="구분" aria-label="구분"></div></li>`;
      return `<li class="rv-miss"><label class="rv-main">${cb}<span class="rv-tag">PDF에 없음</span>
        <b>${esc(it.role || "")}</b> <span class="rv-f">${FL[it.f]}</span> <span class="mono">${esc(it.old)}</span> — ${missAction(it)}</label></li>`;
    }
    function paintReview() {
      const box = reviewBox(), r = review;
      if (!box || !r) return;
      const n = (k) => r.items.filter(i => i.kind === k).length;
      const chip = SeMIS.ui.chip;
      if (!r.total) {
        box.innerHTML = '<div class="cfe-rv-note">PDF에서 전화번호를 찾지 못했습니다(스캔 이미지일 수 있음). 번호는 직접 확인해 주세요.</div>';
        return;
      }
      const grps = Array.from(new Set(rows.map(x => String(x.grp || "").trim()).filter(Boolean)));
      box.innerHTML = `
        <div class="cfe-rv-head"><b>개정 비교</b><span class="cfe-rv-sum">${chip("그대로 " + r.same, "gray")}
          ${n("chg") ? chip("바뀜 " + n("chg"), "amber") : ""}${n("add") ? chip("새 번호 " + n("add"), "blue") : ""}${n("miss") ? chip("PDF에 없음 " + n("miss"), "red") : ""}</span></div>
        ${r.pages > 1 ? '<div class="cfe-rv-note">1쪽만 읽었습니다.</div>' : ""}
        ${!r.items.length && !r.ver ? '<div class="cfe-rv-note">등록된 번호가 모두 PDF와 같습니다.</div>' : ""}
        ${r.items.length || r.ver ? `<ul class="cfe-rv-list">
          ${r.ver ? `<li class="rv-ver"><label class="rv-main"><input type="checkbox" data-rv-ver${r.verOn ? " checked" : ""}><span class="rv-tag">버전</span>
            ${r.curVer ? `<s class="mono">${esc(r.curVer)}</s> →` : ""} <b class="mono">${esc(r.ver)}</b></label></li>` : ""}
          ${r.items.map(rvItem).join("")}</ul>
          <datalist id="cfe-grps">${grps.map(g => `<option value="${esc(g)}">`).join("")}</datalist>
          <div class="cfe-rv-acts"><button type="button" class="btn btn-primary btn-sm" id="cfe-rv-apply">선택한 항목 반영</button></div>` : ""}`;
      $$("#cfe-review [data-rv]").forEach(c => c.onchange = () => { r.items[Number(c.dataset.rv)].on = c.checked; });
      $$("#cfe-review [data-rv-name]").forEach(c => c.oninput = () => { r.items[Number(c.dataset.rvName)].label = c.value; });
      $$("#cfe-review [data-rv-grp]").forEach(c => c.oninput = () => { r.items[Number(c.dataset.rvGrp)].grp = c.value; });
      const vb = $("#cfe-review [data-rv-ver]");
      if (vb) vb.onchange = () => { r.verOn = vb.checked; };
      const ap = $("#cfe-rv-apply");
      if (ap) ap.onclick = applyReview;
    }
    function applyReview() {
      if (!review) return;
      ed.collect();
      const hit = new Set();
      let n = 0;
      const on = review.items.filter(it => it.on);
      on.filter(it => it.kind === "chg").forEach(it => {
        const r = rows.find(x => x.id === it.rowId);
        if (r) { r[it.f] = it.num; hit.add(r.id); n++; }
      });
      on.filter(it => it.kind === "miss").forEach(it => {
        const r = rows.find(x => x.id === it.rowId);
        if (!r) return;
        const other = it.f === "office" ? "mobile" : "office";
        const otherGone = on.some(o => o.kind === "miss" && o.rowId === r.id && o.f === other);
        if (SemisFlowPdf.keyOf(r[other]) && !otherGone) { r[it.f] = ""; hit.add(r.id); }
        else rows.splice(rows.indexOf(r), 1);
        n++;
      });
      // 새 번호: 유선 먼저, 휴대전화는 이름이 같은 행(방금 추가한 행 포함)의 빈 칸에 합친다
      const same = (a, b) => { const x = String(a || "").replace(/\s+/g, ""), y = String(b || "").replace(/\s+/g, ""); return x && x === y; };
      on.filter(it => it.kind === "add").sort((a, b) => (a.mobile ? 1 : 0) - (b.mobile ? 1 : 0)).forEach(it => {
        const g = String(it.grp || "").trim();
        const name = String(it.label || "").trim();
        const fld = it.mobile ? "mobile" : "office";
        const host = name && rows.find(x => same(x.role, name) && !String(x[fld] || "").trim());
        if (host) { host[fld] = it.num; if (it.note && !host.note) host.note = it.note; hit.add(host.id); n++; return; }
        const r = { id: uid("ct"), grp: g, role: name || "이름 확인 필요",
                    office: it.mobile ? "" : it.num, mobile: it.mobile ? it.num : "", note: it.note || "" };
        let at = -1;
        rows.forEach((x, i) => { if (String(x.grp || "").trim() === g) at = i; });
        rows.splice(at >= 0 ? at + 1 : rows.length, 0, r);
        hit.add(r.id); n++;
      });
      if (review.ver && review.verOn) { $("#cfe-ver").value = review.ver; n++; }
      ed.mark(hit);
      review = null;
      reviewBox().innerHTML = `<div class="cfe-rv-done">${SeMIS.icon("check", 16)}<span>${n}건 반영했습니다. 아래 연락처(강조 표시)를 확인한 뒤 저장하세요.</span></div>`;
      const first = $("#cfe-rows .ct-editrow-hit");
      if (first && first.scrollIntoView) first.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    $("#cfe-pdf").onchange = async (ev) => {
      const fl = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (!fl) return;
      if (!(fl.type === "application/pdf" || /\.pdf$/i.test(fl.name || ""))) { toast("PDF 파일만 올릴 수 있습니다.", true); return; }
      setBusy("PDF를 읽는 중…");
      const P = window.SemisFlowPdf;
      const [up, an] = await Promise.all([
        uploadTo(fl, "pdf"),
        P ? P.analyze(fl).catch(() => null) : Promise.resolve(null)
      ]);
      if (!up) { setBusy(""); const b = reviewBox(); if (b) { b.hidden = true; b.innerHTML = ""; } return; }
      file = up;
      if (an && an.image && an.thumb) {
        setBusy("미리보기 이미지를 올리는 중…");
        try {
          const [a, b] = await Promise.all([SemisSync.uploadFile(an.image, "contacts"), SemisSync.uploadFile(an.thumb, "contacts")]);
          img = { url: a.url, thumb: b.url, name: an.image.name };
          imgFresh = true;
        } catch (e) { if (!imgFresh) img = null; toast("미리보기 이미지를 올리지 못했습니다.", true); }
      } else if (!imgFresh) img = null;
      paintFiles();
      setBusy("");
      showReview(an);
    };
    $("#cfe-img").onchange = async (ev) => {
      const fl = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (!fl) return;
      const up = await uploadTo(fl, "img");
      if (!up) return;
      img = { url: up.url, thumb: up.url, name: up.name };
      imgFresh = true;
      paintFiles();
    };
    $("#cfe-add").onclick = ed.add;
    $("#cfe-cancel").onclick = closeModal;
    const del = $("#cfe-del");
    if (del) del.onclick = () => {
      closeModal();
      SeMIS.confirmModal(`보고 체계도 "${f.title}"와 그 연락처가 모두 삭제됩니다. 계속하시겠습니까?`, () => {
        D().contacts.flows = flows().filter(x => x.id !== f.id);
        if (flowTab === f.id) flowTab = "";
        SeMIS.save(); SeMIS.renderView(); toast("보고 체계도가 삭제되었습니다.");
      });
    };
    $("#cfe-save").onclick = () => {
      ed.collect();
      const title = $("#cfe-title").value.trim();
      if (!title) { toast("제목을 입력하세요.", true); return; }
      f.title = title;
      f.short = $("#cfe-short").value.trim() || title;
      f.ver = $("#cfe-ver").value.trim();
      f.steps = $("#cfe-steps").value.trim();
      f.memo = $("#cfe-memo").value.trim();
      f.rows = rows.filter(r => FLOW_DEFS.some(([k]) => String(r[k] || "").trim()));
      f.fileUrl = file ? file.url : ""; f.fileName = file ? file.name : "";
      f.imgUrl = img ? img.url : ""; f.thumbUrl = img ? (img.thumb || img.url) : ""; f.imgName = img ? (img.name || "") : "";
      if (isNew) {
        if (!Array.isArray(D().contacts.flows)) D().contacts.flows = [];
        D().contacts.flows.push(f);
      }
      flowTab = f.id;
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
          ${canWrite ? '<button class="btn btn-ghost btn-sm" id="ct-addflow">+ 체계도 추가</button>' : ""}
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
    const addFlow = $("#ct-addflow");
    if (addFlow) addFlow.onclick = () => editFlow("");
    wireFlows(canWrite);
  }

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisContacts = { seedSections,
    telHref, smsHref, isMobile, matches, rowText,
    sections: secs, editSection,
    flows, editFlow, openViewer, closeViewer, selectFlowTab, groupRows,
    getFlowTab: () => flowTab, FLOW_DEFS,
    getQuery: () => query, setQuery: (q) => { query = String(q || ""); }
  };
})();
