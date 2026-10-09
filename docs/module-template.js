/* 새 업무 모듈 템플릿 — 참고용(앱에 로드되지 않음). js/<module>.js 로 복사해 이름만 바꿔 쓴다.
   같은 module id 의 예정 메뉴가 있으면 등록 즉시 운영 메뉴가 되고(허브가 숨어 있었으면 레일에 나타남),
   대시보드 '모듈 구축 현황' · A4 인쇄 버튼 · 모바일 시트 · 권한 · 숨김은 코어가 맞춘다.

   체크리스트
   1) 이 파일 복사 → MOD / KEY / TITLE 수정
   2) js/app.js  defaultMenus() 에 메뉴 한 줄(운영 데이터에 없으면 ensureSeedMenus 가 시드 자리에 넣음)
                 비슷한 화면과 묶으려면 탭 묶음(type "bundle") 아래에 두고 tab(짧은 이름) 지정
                 freshData() 기본값 · normalizeData() 의 obj / rows 표에 KEY 한 줄 · 필요 시 VIEW_WIDTH[MOD]
   3) js/sync.js SYNC_KEYS 에 KEY → tests Y01 갱신 + 서버 권한표 semis_logi_private.key_acl
      (tools/sql/semis-logi-security.sql 에도 같은 줄, 없으면 읽기 2 · 쓰기 3). 파일을 올리면
      tools/edge/semis-logi-files.ts READ_RANK / WRITE_RANK 에 폴더 추가 후 재배포
   4) index.html <script src="js/<module>.js?v=..." defer> → tests FILES 배열에도
   5) npm run bump <ver> → npm test → 배포 (HANDOFF §3)

   디자인: 제목 · 버튼에 이모지 금지(SeMIS.icon) · ui.head → ui.stats → .card(.toolbar + 표), 카드 안에 카드 금지 ·
   숫자 · 날짜만 .mono · 색은 토큰만 · 안내 문구 최소 · 검색칸은 다시 만들지 않는다(ui.searchValue + ui.repaintKeep).
   주석은 '왜'만 — 버전 · 날짜 · 바뀐 내력은 쓰지 않는다 */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "incident";     // 메뉴 module id — 예정 메뉴와 같게 두면 자동으로 실화면 대체
  const KEY = "incidents";    // 데이터 컬렉션 SeMIS.data.incidents
  const TITLE = "사고 · 아차사고 보고";
  const list = () => (Array.isArray(SeMIS.data[KEY]) ? SeMIS.data[KEY] : []);
  const today = () => new Date().toISOString().slice(0, 10);
  let query = "";

  /* 목록 카드(검색줄 + 표) — 검색어 입력 때는 이 카드만 다시 그린다 */
  function listHTML() {
    const rows = list().filter(r => !query || [r.no, r.title].join(" ").toLowerCase().indexOf(query.toLowerCase()) >= 0);
    return `<div class="toolbar">${ui.search("x-q", "번호 · 제목 검색", query)}</div>
      ${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap">
        <thead><tr><th>번호</th><th>제목</th><th>기한</th><th>상태</th></tr></thead>
        <tbody>${rows.map(r => `<tr data-id="${esc(r.id)}">
          <td class="mono">${esc(r.no)}</td><td>${esc(r.title)}</td><td class="mono">${esc(r.due || "-")}</td>
          <td>${ui.chip(r.status === "closed" ? "종결" : "조치 중", r.status === "closed" ? "green" : "amber")}</td></tr>`).join("")}
        </tbody></table></div>`
      : ui.empty(query ? "검색 결과가 없습니다." : "등록된 항목이 없습니다.")}`;
  }

  function render(root) {
    const all = list();
    const late = all.filter(r => r.due && r.due < today() && r.status !== "closed").length;
    const canWrite = SeMIS.canEdit();

    root.innerHTML =
      ui.head({
        title: TITLE,
        desc: "보고 → 조치 → 종결 추적",
        actions: canWrite ? `<button type="button" class="btn btn-primary" id="x-add">${icon("plus", 17)}<span>등록</span></button>` : ""
      }) +
      ui.stats([
        { label: "전체", value: all.length },
        { label: "조치 중", value: all.filter(r => r.status !== "closed").length },
        { label: "기한 경과", value: late, tone: late ? "bad" : "ok" }
      ]) +
      `<section class="card" id="x-list">${listHTML()}</section>`;

    /* 화면을 통째로 다시 그리면 입력칸이 새로 만들어져 한글 조합이 자모로 풀린다 — 목록만 바꾼다 */
    const q = $("#x-q", root);
    if (q) q.oninput = () => {
      const v = ui.searchValue(q.value);
      if (v === query) return;
      query = v;
      ui.repaintKeep($("#x-list", root), listHTML(), q);
    };
    const add = $("#x-add", root);
    if (add) add.onclick = () => toast("등록 폼을 연결하세요.");
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    /* 허브 패널 메뉴 오른쪽 숫자(선택) — 0이면 "" 를 돌려 숨긴다 */
    navBadge() { return list().filter(r => r.status !== "closed").length || ""; },
    render
  });

  /* 통합 검색(Ctrl K) 프로바이더 — ico 는 선 아이콘 키 */
  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "alert", module: MOD,
    items: () => list().map(r => ({ title: r.title, sub: r.no, route: MOD }))
  });
})();
