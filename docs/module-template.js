/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 새 업무 모듈 템플릿 (v1.8 "Terminal Calm" 모듈 화면 키트)
   ※ 참고용 파일 — 앱에 로드되지 않는다. js/<module>.js 로 복사해 이름만 바꿔 쓴다.

   이 템플릿대로 만들면 코드 한 줄 더 쓰지 않아도 다음이 자동으로 맞춰진다.
   - 메뉴: 같은 module id의 "예정" 메뉴가 허브 패널의 '준비 중인 모듈'에서 운영 목록으로 올라간다.
   - 대시보드: '모듈 구축 현황'의 해당 허브 막대가 올라간다.
   - 머리말: A4 인쇄 버튼이 .page-head 오른쪽에 자동 부착된다.
   - 모바일: 전체 메뉴 시트·하단 탭·반응형 레이아웃이 그대로 적용된다.
   - 권한·숨김: 메뉴의 vis / hidden 설정을 코어가 처리한다.

   체크리스트 (README "신규 모듈 추가 체크리스트"와 동일)
   1) 이 파일 복사 → MOD / KEY / 제목 수정
   2) js/app.js  freshData()에 KEY 기본값, normalizeData()에 배열 보정(멱등)
                 필요 시 VIEW_WIDTH[MOD] = "mid" | "wide"
   3) js/sync.js SYNC_KEYS에 KEY 추가 → tests Y01 기대 문자열 갱신
   4) index.html <script src="js/<module>.js?v=..."> 추가 → tests FILES 배열에도 추가
   5) npm run bump <ver> → npm test → 배포 (HANDOFF §3)

   디자인 규칙
   - 화면 제목·버튼에 이모지 쓰지 않는다 → SeMIS.icon(name) 선 아이콘 (키 목록: SeMIS.ICONS)
   - 화면 구성 순서: ui.head → ui.stats(선택) → .card( .toolbar + 표 ) — 카드 안에 카드를 넣지 않는다
   - 숫자·날짜·코드만 .mono (IBM Plex Mono). 본문은 기본 글꼴
   - 색은 토큰만: --primary(틸) · --accent(앰버, 강조 1곳) · 상태 배지 badge-green/amber/red/blue/gray
   - 안내 문구는 꼭 필요한 한 줄만 (권한상 자명한 "○○ 전용" 문구 금지)
   - 검색 입력칸은 절대 다시 만들지 않는다 (한글 조합 깨짐) → ui.searchValue + ui.repaintKeep
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const MOD = "car";      // 메뉴 module id — 예정 메뉴와 같게 두면 자동으로 실화면 대체
  const KEY = "cars";     // 데이터 컬렉션 SeMIS.data.cars
  const TITLE = "시정조치 (CAR)";
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
        desc: "점검·감사 부적합 → 조치 → 종결 추적",
        actions: canWrite ? `<button type="button" class="btn btn-primary" id="x-add">${icon("plus", 17)}<span>등록</span></button>` : ""
      }) +
      ui.stats([
        { label: "전체", value: all.length },
        { label: "조치 중", value: all.filter(r => r.status !== "closed").length },
        { label: "기한 경과", value: late, tone: late ? "bad" : "ok" }
      ]) +
      `<section class="card" id="x-list">${listHTML()}</section>`;

    /* 검색: 화면 전체를 다시 그리면 입력칸이 새로 만들어져 한글 조합이 자모로 풀린다(v1.13.1).
       ui.searchValue로 조합 중 자모를 떼고, ui.repaintKeep으로 입력칸은 그대로 둔 채 목록만 바꾼다. */
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
    id: MOD, group: TITLE, ico: "clipboard", module: MOD,
    items: () => list().map(r => ({ title: r.title, sub: r.no, route: MOD }))
  });
})();
