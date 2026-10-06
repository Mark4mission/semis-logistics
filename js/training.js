/* ═══════════════════════════════════════════════════════
   SeMIS · Logistics — 보안교육 · 자격 관리 (v1.20 → v1.31 재정비, 라우트 training)

   v1.31 — 직무 · 과정 명칭을 현행 법령 · 지침 · 국제 기준으로 정정하고 화면을 사람 중심으로 다시 짰다.
   근거(공개 법령 — 국가법령정보센터 원문 확인 2026-10-01)
   - 항공보안법 제28조(교육훈련) · 시행규칙 제3조의5 · 제15조
   - 국가민간항공보안 교육훈련지침(국토교통부 예규 제379호, 2024-03-15) 제2조 · 제8조 · 제12~29조 · 제32조 · 별표 3~18의4
     · 제13조 정기교육: 수료일(인증일)부터 1년 — 그 날 전후 30일이 이수 기간, 기간 안 이수 시 종전 만료일 다음 날부터 1년,
       못 하면 자격 정지 → 정지 후 6개월 안 정기교육으로 회복
   - 항공안전법 제72조 · 항공위험물운송기술기준 제12조②(24개월 이내 보수교육, 만료 3개월 안 이수 시 기존 만료일 기준 연장)
   - ICAO Annex 17 3.4 · ICAO ASTP · IATA DGR 1.5 · EU 2015/1998 11.2.3.9 · 11.4.3(5년) · TSA 보안프로그램(비공개)

   화면
   - 인원(기본): 사람별 자격 상태 · 다음 갱신 · SSI 서약 (PC는 목록 / 이수 현황표, 모바일은 한 줄 카드)
     이름을 누르면 개인 화면: 자격 현황 · 이수 이력 · SSI 서약 · 직무 · 기본 정보 (뒤로 = 브라우저 뒤로)
   - 교육 기록: 당사 실시(기록 8항목 — 지침 제32조) · 협력사 확인 → 누르면 기록 화면
   - 직무 · 과정: 직무별 근거 · 자격 조건 · 주요 역할 · 과정(구분 · 최소 시간 · 주기 · 법정 여부 · 교육기관)
   - SSI 서약: SeMIS v2 보안서약서 명단 조회(RPC semis_logi_pledges — 사번 · 서명 없음)

   데이터 DATA.training = {
     catVer(과정 정의 판 — 2 = v1.31 정식 명칭),
     courses[{ id, fam, name, kind(초기|직무|인증|정기|1회), cycle(개월, 0 = 영구), rule(kr|dg|""), step(자격을 주지 않는 단계),
               hours, legal(law|intl|own), basis, org, roles[], all, vendor }] — 비면 코드 기본 과정
     people[{ id, name, dept, roles[], left(퇴직일), pledge(SSI 서약일), pledgeFiles[], note }]
     records[{ id, pid, cid, date, expire(비면 규칙으로 계산), hours, score, org, certNo, files[], sessionId, note, src }]
     sessions[{ id, type(own|vendor), cid, title, date, time, hours, place, instructor, evalText, pids[],
                files{ tt[], roster[], eval[] }, vendor, target, done, note, createdAt/By, updatedAt/By }] }
   권한: 열람 mgr(권한표 training 2) · 편집 hq(3). 파일은 비공개 버킷 training/ 폴더(열람 2 · 올리기 3).
   수검 대응 센터 증빙: window.SemisEvidence.training(mid) → { ok, text } (1.1~1.4 · 2.10 · 3.4 · 8.2 · 9.2 · 9.2.1)
   점검 · 교육 대시보드(js/auddash.js)는 window.SemisTraining 의 집계 함수를 쓴다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal, ui, icon } = SeMIS;
  const D = () => SeMIS.data;
  const MOD = "training";
  const KEY = "training";
  const TITLE = "보안교육 · 자격 관리";
  const FOLDER = "training";
  const FILE_MAX = 50 * 1024 * 1024;
  const SOON = 60;                                      // 만료 임박(일)
  const KR_WIN = 30, KR_SUSP = 6;                       // 지침 제13조: 전후 30일 · 정지 후 6개월
  const DG_WIN = 3;                                     // 기술기준 제12조②: 만료 3개월 안
  const KEEP_YEARS = 3, KEEP_LEFT_DAYS = 90;            // 지침 제32조: 기록 3년 · 퇴직 후 90일
  const CAT_VER = 2;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  let fixedToday = "";
  const todayISO = () => fixedToday || toISO(new Date());
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const dot = (s) => String(s || "").replace(/-/g, ".");
  const ymd2 = (s) => (isISO(s) ? s.slice(2).replace(/-/g, ".") : "");
  const md = (s) => (isISO(s) ? s.slice(5).replace(/-/g, ".") : "");
  const me = () => (SeMIS.user && SeMIS.user.name) || "";
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const num = (v) => { const n = Number(v); return v === "" || v == null || !isFinite(n) ? null : n; };
  const addDays = (iso, n) => { const t = new Date(utc(iso) + n * 86400000); return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()); };
  const mob = () => !!(SeMIS.isMobile && SeMIS.isMobile());
  /* 같은 날짜 n개월 뒤(말일 보정) */
  function shiftM(iso, months) {
    const y0 = Number(iso.slice(0, 4)), m0 = Number(iso.slice(5, 7)) - 1, d0 = Number(iso.slice(8, 10));
    const tot = y0 * 12 + m0 + months, y = Math.floor(tot / 12), mo = tot - y * 12;
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    return y + "-" + p2(mo + 1) + "-" + p2(Math.min(d0, dim));
  }
  /* 유효기한: 수료일 + 주기(개월) − 1일 (월말 보정) — SeMIS v2 이수증 관리와 같은 셈 */
  function calcExpire(iso, months) {
    months = Number(months) || 0;
    if (!isISO(iso) || months <= 0) return "";
    return addDays(shiftM(iso, months), -1);
  }

  /* ─────── 직무 기준표 (공개 법령 · 지침 · 국제 기준) ─────── */
  const GROUPS = [["law", "항공보안법 · 교육훈련지침"], ["dg", "위험물 (항공안전법)"], ["intl", "국제 기준 · 항공사 보안프로그램"], ["own", "사내 · 기타"]];
  const ROLE_DEF = [
    { id: "항공사보안책임자", grp: "law", basis: "교육훈련지침 제2조7호 · 제17조, 항공보안법 시행규칙 제3조의5", who: "항공운송사업자가 지정",
      qual: "지정 전 또는 지정 후 6개월 안 초기교육 이수. ICAO · IATA · TSA 항공사 보안관리자 과정 이수는 초기교육으로 인정. 국제 항공보안 세미나 · 회의 2일 이상 참석은 정기교육으로 인정",
      duty: "항공사 보안업무 지도 · 감독 총괄" },
    { id: "항공사보안감독자", grp: "law", basis: "교육훈련지침 제2조8호 · 제17조", who: "항공사보안책임자 추천 → 항공운송사업자 지정",
      qual: "지정 전 또는 지정 후 6개월 안 초기교육(평가 80점 이상) 이수. ICAO · IATA · TSA 보안관리자 과정 이수는 초기교육으로 인정",
      duty: "항공사 보안업무 지도 · 감독 (화물 보안통제 · 협력사 보안 감독 등)" },
    { id: "보안검색감독자", grp: "law", basis: "항공보안법 제28조② · 교육훈련지침 제2조9호 · 제18조", who: "공항운영자 · 항공운송사업자가 지정",
      qual: "보안검색요원 초기교육 이수자가 감독자 초기교육 이수(곤란하면 지정 후 3개월 안). 국토부 지정 보안검색교육기관 위탁 의무",
      duty: "보안검색요원의 업무 수행실태 감독" },
    { id: "보안검색요원", grp: "law", basis: "항공보안법 제28조② · 교육훈련지침 제20조 · 제24조", who: "공항운영자등(보안검색 협력사)",
      qual: "초기교육 → 직무교육(OJT) → 자격인증(OJT 후 3개월 안)을 마친 뒤 검색 업무. 불시평가 불합격 시 8시간 재교육(정기교육 인정)",
      duty: "화물 보안검색 (X-ray · ETD · 개봉검색)" },
    { id: "화물보안 업무요원", grp: "law", basis: "교육훈련지침 제3조8호 · 제24조", who: "공항운영자등",
      qual: "보안검색 외 화물보안 업무를 하기 전 초기교육. 사내보안교관이 자체 교육 가능",
      duty: "보안검색 외 화물보안 업무 (보안통제 · 인수 확인 · 화물 보호 등)" },
    { id: "항공보안장비 유지보수요원", grp: "law", basis: "교육훈련지침 제2조17호 · 제23조, 항공보안장비 종류, 운영 및 유지관리 등에 관한 기준 제9 · 10조", who: "보안검색장비 운용자가 지정",
      qual: "초기교육(제작사 · 설치업체 교육 이수자는 초기 인정) 후 정기교육 연 1회",
      duty: "보안검색장비 관리 · 유지" },
    { id: "보안 유관부서 관리자", grp: "law", basis: "교육훈련지침 제29조①", who: "항공운송사업자 보안 유관 부서의 장 · 중간관리자",
      qual: "초기 · 정기 보안교육", duty: "보안 유관 업무 관리" },
    { id: "보안 유관부서 일반요원", grp: "law", basis: "교육훈련지침 제29조②", who: "화물터미널 운영 요원 · 지상조업 요원 · 무기류 운송 접수 직원 등",
      qual: "초기 · 정기 보안교육", duty: "보안 유관 일반 업무" },
    { id: "전화 접수자 · 안내요원", grp: "law", basis: "교육훈련지침 제28조 · 별표 17", who: "폭발물 위협전화를 받을 수 있는 직원",
      qual: "폭발물 위협대응 교육 1회 (정기교육 없음)", duty: "폭발물 위협전화 접수 · 대응" },
    { id: "항공보안교관", grp: "law", basis: "교육훈련지침 제2조10호 · 제12조의2 · 제14조 · 별표 3", who: "항공훈련기관 · 보안검색교육기관",
      qual: "항공보안 경력 3년 이상 등 + 교관교육과정 이수, 분야별 자격인증. 정기교육 없음 — 인증서에 유효기간이 적혀 있으면 그 날짜로 관리",
      duty: "항공훈련기관 · 보안검색교육기관 강의" },
    { id: "사내보안교관", grp: "law", basis: "교육훈련지침 제2조11호 · 제14조③", who: "소속 기관의 장이 임명",
      qual: "교관과정 이수 + 항공보안 경력 1년 이상, 또는 해당 분야 실무 2년 이상 (보안검색요원 교육은 제외)",
      duty: "자체 보안교육 실시 (화물보안 업무요원 등)" },
    { id: "위험물 취급자", grp: "dg", basis: "항공안전법 제72조 · 항공위험물운송기술기준 제12 · 14조 · IATA DGR 1.5", who: "항공운송사업자 위험물 관련 직원 (직무구분별)",
      qual: "직무 전 초기교육, 24개월 이내 보수교육 (만료 3개월 안 이수 시 기존 만료일 기준 연장), 24개월이 지나면 초기교육 다시",
      duty: "위험물 접수 · 취급 · 보관 · 탑재 (기술기준 표 1-1)" },
    { id: "ACMR", grp: "intl", basis: "TSA 보안프로그램 (미주편, 비공개)", who: "회사 지정",
      qual: "정식 명칭 · 교육 주기는 회사 TSA 보안프로그램 기준으로 확인 필요", duty: "미주행 화물 보안 관리", check: true },
    { id: "ACC3 보안통제 직원", grp: "intl", basis: "EU 시행규정 2015/1998 6.8 · 11.2.3.9 · 11.4.3", who: "EU행 화물 보안통제 직원",
      qual: "직무 전 교육, 5년 이내 재교육 (6개월 넘게 직무를 쉬면 복귀 전 재교육)", duty: "EU행 화물 · 우편물 보안통제 (ACC3)" },
    { id: "SSI 취급자", grp: "own", basis: "자체보안계획 · SSOP 민감보안정보 관리", who: "민감보안정보 열람자",
      qual: "보안서약 (교육 과정이 아니라 서약으로 관리)", duty: "민감보안정보 열람 · 취급", pledge: true }
  ];
  const ROLES = ROLE_DEF.map(r => r.id);
  /* v1.31 옛 직무 이름 → 정식 명칭 (읽을 때 바꾸고, 데이터는 이전(migrate)에서 고친다) */
  const ROLE_ALIAS = { "보안감독자": "항공사보안감독자", "화물보안 요원": "화물보안 업무요원", "장비 운용자": "항공보안장비 유지보수요원" };
  const roleDef = (r) => ROLE_DEF.find(x => x.id === r) || null;
  /* v1.37 직무군 색 (Mark 지정 5군) — 그 밖(위험물 · SSI · ACMR · ACC3 · 사내 직무)은 '기타' 기본색.
     색은 css `.rg-*` (dataviz 검증기 --pairs all 통과 · 상태 색(초록 · 호박 · 빨강 · 틸) 색상 피함), 글자는 본문 잉크 */
  const RGROUPS = [
    { id: "sup", label: "항공사 보안관리", roles: ["항공사보안책임자", "항공사보안감독자"] },
    { id: "scr", label: "보안검색 · 화물보안", roles: ["보안검색감독자", "보안검색요원", "항공보안장비 유지보수요원", "화물보안 업무요원"] },
    { id: "rel", label: "보안 유관부서", roles: ["보안 유관부서 관리자", "보안 유관부서 일반요원"] },
    { id: "tel", label: "전화 접수 · 안내", roles: ["전화 접수자 · 안내요원"] },
    { id: "ins", label: "보안교관", roles: ["항공보안교관", "사내보안교관"] },
    { id: "etc", label: "기타", roles: [] }
  ];
  const rgOf = (r) => { r = ROLE_ALIAS[r] || r; return RGROUPS.find(g => g.roles.indexOf(r) >= 0) || RGROUPS[RGROUPS.length - 1]; };
  const rgById = (id) => RGROUPS.find(g => g.id === id) || null;
  /* 직무 늘어놓는 순서 = 직무군 순서 → 군 안 순서(기타는 기준표 순서 → 이름) */
  const roleRank = (r) => {
    const g = rgOf(r), gi = RGROUPS.indexOf(g), ri = g.roles.indexOf(ROLE_ALIAS[r] || r), di = ROLES.indexOf(ROLE_ALIAS[r] || r);
    return gi * 1000 + (ri >= 0 ? ri : di >= 0 ? di : 900);
  };
  const sortRoles = (rs) => rs.slice().sort((a, b) => roleRank(a) - roleRank(b) || String(a).localeCompare(String(b), "ko"));
  const rgDot = (g) => `<i class="rg-dot rg-${g.id}" aria-hidden="true"></i>`;

  /* ─────── 과정 기준 (코드 기본 — 데이터가 비었을 때 · 이전 때) ─────── */
  const SCR_ORG = "국토부 지정 보안검색교육기관 (위탁 의무)";
  const TRN_ORG = "항공훈련기관 · 보안검색교육기관 (예: 한국공항공사 항공기술훈련원 항공보안교육센터)";
  const DG_BASIS = "항공안전법 제72조 · 항공위험물운송기술기준 제12조② · IATA DGR 1.5";
  const DG_ORG = "국토부 지정 위험물전문교육기관 · ICAO/IATA 인정 기관";
  const INST_BASIS = "교육훈련지침 제14조 · 제12조의2 · 별표 3";
  const INST_ORG = "ICAO · IATA · TSA · 항공훈련기관 · 보안검색교육기관";
  const C = (id, fam, name, kind, cycle, o) => Object.assign({ id, fam, name, kind, cycle, rule: "", hours: "", legal: "law", basis: "", org: "", roles: [] }, o || {});
  const SUP = ["항공사보안책임자", "항공사보안감독자"];
  const DEF_COURSES = [
    C("c-sup-i", "sup", "항공사보안책임자 · 감독자 초기", "초기", 12, { rule: "kr", hours: "16시간↑ (책임자 8시간↑) · 평가", basis: "교육훈련지침 제17조① · 별표 5", org: TRN_ORG, roles: SUP }),
    C("c-sup-r", "sup", "항공사보안책임자 · 감독자 정기", "정기", 12, { rule: "kr", hours: "연 1회 8시간↑ (책임자 4시간↑)", basis: "교육훈련지침 제17조③ · 별표 5의2", org: TRN_ORG, roles: SUP }),
    C("c-scr-i", "scr", "보안검색감독자 초기", "초기", 12, { rule: "kr", hours: "8시간↑ · 평가", basis: "항공보안법 제28조② · 교육훈련지침 제18조① · 별표 6", org: SCR_ORG, roles: ["보안검색감독자"] }),
    C("c-scr-r", "scr", "보안검색감독자 정기", "정기", 12, { rule: "kr", hours: "연 1회 8시간↑", basis: "교육훈련지침 제18조② · 별표 6의2", org: SCR_ORG, roles: ["보안검색감독자"] }),
    C("c-scn-i", "scn", "보안검색요원 초기", "초기", 0, { step: true, hours: "40시간↑ · 평가", basis: "항공보안법 제28조② · 교육훈련지침 제20조① · 별표 8", org: SCR_ORG, roles: ["보안검색요원"] }),
    C("c-scn-o", "scn", "보안검색요원 직무(OJT)", "직무", 0, { step: true, hours: "80시간↑", basis: "교육훈련지침 제20조① · 별표 8의2", org: "소속 공항운영자등", roles: ["보안검색요원"] }),
    C("c-scn-c", "scn", "보안검색요원 자격인증", "인증", 12, { rule: "kr", hours: "OJT 후 3개월 안", basis: "교육훈련지침 제12조의2 · 제20조②", org: SCR_ORG, roles: ["보안검색요원"] }),
    C("c-scn-r", "scn", "보안검색요원 정기", "정기", 12, { rule: "kr", hours: "연 1회 8시간↑", basis: "교육훈련지침 제20조③ · 별표 8의3", org: SCR_ORG, roles: ["보안검색요원"] }),
    C("c-cargo-i", "cargo", "화물보안 업무요원 초기", "초기", 12, { rule: "kr", hours: "8시간↑", basis: "교육훈련지침 제24조 · 별표 13", org: "자체(사내보안교관) 또는 위탁", roles: ["화물보안 업무요원"] }),
    C("c-cargo-r", "cargo", "화물보안 업무요원 정기", "정기", 12, { rule: "kr", hours: "연 1회 2시간↑", basis: "교육훈련지침 제24조 · 별표 13의2", org: "자체 또는 보안검색교육기관", roles: ["화물보안 업무요원"] }),
    C("c-equip", "equip", "항공보안장비 유지보수요원 초기", "초기", 12, { rule: "kr", hours: "40시간↑ (제작사 · 설치업체 교육 이수자는 초기 인정)", basis: "교육훈련지침 제23조 · 별표 12", org: "보안검색교육기관 (예: 한국공항공사 항공기술훈련원)", roles: ["항공보안장비 유지보수요원"] }),
    C("c-mnt-r", "equip", "항공보안장비 유지보수요원 정기", "정기", 12, { rule: "kr", hours: "연 1회 8시간↑", basis: "교육훈련지침 제23조 · 별표 12의2 · 장비 기준 제10조", org: "보안검색교육기관", roles: ["항공보안장비 유지보수요원"] }),
    C("c-mgr-i", "mgr", "보안 유관부서 관리자 초기", "초기", 12, { rule: "kr", hours: "2시간↑", basis: "교육훈련지침 제29조① · 별표 18", org: "자체", roles: ["보안 유관부서 관리자"] }),
    C("c-mgr-r", "mgr", "보안 유관부서 관리자 정기", "정기", 12, { rule: "kr", hours: "연 1회 2시간↑", basis: "교육훈련지침 제29조① · 별표 18의2", org: "자체", roles: ["보안 유관부서 관리자"] }),
    C("c-gen-i", "aware", "보안 유관부서 일반요원 초기", "초기", 12, { rule: "kr", hours: "2시간↑", basis: "교육훈련지침 제29조② · 별표 18의3", org: "자체", roles: ["보안 유관부서 일반요원"] }),
    C("c-aware", "aware", "보안 유관부서 일반요원 정기", "정기", 12, { rule: "kr", hours: "연 1회 2시간↑", basis: "교육훈련지침 제29조② · 별표 18의4", org: "자체", roles: ["보안 유관부서 일반요원"] }),
    C("c-bomb", "bomb", "폭발물 위협대응 교육", "1회", 0, { hours: "2시간↑", basis: "교육훈련지침 제28조 · 별표 17", org: "자체", roles: ["전화 접수자 · 안내요원"] }),
    C("c-inst", "inst", "항공보안교관 과정", "1회", 0, { hours: "40시간↑ · 평가 · 분야별 인증", basis: INST_BASIS, org: INST_ORG, roles: ["항공보안교관"] }),
    C("c-inh", "inh", "사내보안교관 임명", "1회", 0, { hours: "교관과정 + 경력 1년↑ 또는 실무 2년↑", basis: "교육훈련지침 제14조③", org: "소속 기관 (임명)", roles: ["사내보안교관"] }),
    C("c-dg-i", "dgr", "위험물 교육 초기", "초기", 24, { rule: "dg", hours: "직무구분별 (기술기준 표 1-2)", basis: DG_BASIS, org: DG_ORG, roles: ["위험물 취급자"] }),
    C("c-dg-r", "dgr", "위험물 교육 정기", "정기", 24, { rule: "dg", hours: "24개월 이내", basis: DG_BASIS, org: DG_ORG, roles: ["위험물 취급자"] }),
    C("c-acmr-i", "acmr", "ACMR 초기", "초기", 12, { legal: "intl", basis: "TSA 보안프로그램 (미주편) — 정식 명칭 · 주기 확인 필요", org: "사내 · TSA 인정 과정", roles: ["ACMR"] }),
    C("c-acmr-r", "acmr", "ACMR 정기", "정기", 12, { legal: "intl", basis: "TSA 보안프로그램 (미주편) — 정식 명칭 · 주기 확인 필요", org: "사내 · TSA 인정 과정", roles: ["ACMR"] }),
    C("c-acc3", "acc3", "ACC3 화물 보안통제 교육", "정기", 60, { legal: "intl", hours: "직무 전 · 5년 이내 재교육", basis: "EU 시행규정 2015/1998 11.2.3.9 · 11.4.3", org: "사내 · 위탁", roles: ["ACC3 보안통제 직원"] }),
    C("c-icao-c", "icao-c", "ICAO 항공화물 · 우편물 보안 (ASTP)", "1회", 0, { legal: "intl", hours: "5일", basis: "ICAO Aviation Security Training Package · 교육훈련지침 제10조12호", org: "ICAO 인증 교육센터 (ASTC)" }),
    C("c-icao-m", "icao-m", "ICAO 항공보안 관리자 (ASTP)", "1회", 0, { legal: "intl", hours: "7일", basis: "ICAO ASTP — 책임자 · 감독자 초기교육 인정 근거(지침 제17조②)", org: "ICAO 인증 교육센터 (ASTC)" }),
    C("c-iata-c", "iata-c", "IATA 항공화물 · 공급망 보안", "1회", 0, { legal: "intl", hours: "5일", basis: "IATA Training (Air Cargo and Supply Chain Security)", org: "IATA · IATA 인정 교육기관" }),
    C("v-screen", "v-screen", "보안검색요원 교육 · 자격인증 (협력사)", "정기", 12, { rule: "kr", vendor: true, basis: "항공보안법 제28조② · 교육훈련지침 제20조 · 제24조", org: SCR_ORG }),
    C("v-guard", "v-guard", "항공경비요원 교육 (협력사)", "정기", 12, { rule: "kr", vendor: true, basis: "교육훈련지침 제21조 · 별표 9~9의3", org: SCR_ORG }),
    C("v-tsa", "v-tsa", "TSA 보안교육 (미주편, 협력사)", "정기", 12, { vendor: true, legal: "intl", basis: "TSA 보안프로그램 (미주편)", org: "협력사 · 사내" }),
    C("v-drug", "v-drug", "향정신성 물질 절차 교육 (협력사)", "정기", 12, { vendor: true, legal: "own", basis: "회사 보안 절차", org: "협력사 · 사내" }),
    C("v-aware", "v-aware", "보안 유관부서 일반요원 교육 (협력사)", "정기", 12, { rule: "kr", vendor: true, basis: "교육훈련지침 제29조②", org: "협력사 자체" })
  ];
  const KINDS = ["초기", "직무", "인증", "정기", "1회"];
  const LEGAL = { law: ["법정", "blue"], intl: ["국제 기준", "gray"], own: ["사내", "gray"] };
  const RULES = [["kr", "지침 제13조 (1년 · 전후 30일)"], ["dg", "위험물 (24개월 · 만료 3개월 안)"], ["", "주기만"]];

  /* ─────── 데이터 ─────── */
  function T() {
    let t = D()[KEY];
    if (!t || typeof t !== "object" || Array.isArray(t)) t = D()[KEY] = { courses: [], people: [], records: [], sessions: [] };
    ["courses", "people", "records", "sessions"].forEach(k => { if (!Array.isArray(t[k])) t[k] = []; });
    return t;
  }
  const arr = (k) => { const t = D()[KEY]; return t && Array.isArray(t[k]) ? t[k].filter(x => x && typeof x === "object" && x.id) : []; };
  const courses = () => { const c = arr("courses"); return c.length ? c : DEF_COURSES; };
  const people = () => arr("people");
  const records = () => arr("records");
  const sessions = () => arr("sessions");
  const courseOf = (id) => courses().find(c => c.id === id) || null;
  const personOf = (id) => people().find(p => p.id === id) || null;
  const sessionOf = (id) => sessions().find(s => s.id === id) || null;
  const active = (p, t) => !!p && !(isISO(p.left) && p.left <= (t || todayISO()));
  const rolesOf = (p) => (p && Array.isArray(p.roles) ? p.roles : []).map(r => ROLE_ALIAS[r] || r).filter((r, i, a) => r && a.indexOf(r) === i);
  const ownCourses = () => courses().filter(c => !c.vendor);
  const vendorCourses = () => courses().filter(c => c.vendor);
  const filesOf = (x) => (x && Array.isArray(x) ? x : []);
  const sfiles = (s, k) => filesOf(s && s.files && s.files[k]);
  const isPerm = (c) => !!c && !c.step && !(Number(c.cycle) > 0);
  const legalOf = (c) => (c && LEGAL[c.legal] ? c.legal : "law");
  function allRoles() {
    const s = ROLES.slice();
    const add = (r) => { r = norm(ROLE_ALIAS[r] || r); if (r && s.indexOf(r) < 0) s.push(r); };
    courses().forEach(c => (c.roles || []).forEach(add));
    people().forEach(p => rolesOf(p).forEach(add));
    return s;
  }
  const roleGroup = (r) => (roleDef(r) || {}).grp || "own";
  /* 묶음(초기 · 정기 …) — 이름은 첫 과정 이름에서 구분 낱말을 뗀 것 */
  const famName = (c) => norm(String(c.name || "").replace(/\s*(초기|정기|수시|직무\(OJT\)|직무|자격인증|인증|과정|임명)\s*$/, "")) || c.name;
  function fams(vendor) {
    const out = [];
    courses().filter(c => vendor == null || !!c.vendor === !!vendor).forEach(c => {
      const f = c.fam || c.id;
      let g = out.find(x => x.fam === f);
      if (!g) { g = { fam: f, name: famName(c), courses: [], vendor: !!c.vendor }; out.push(g); }
      g.courses.push(c);
    });
    out.forEach(g => {
      const q = g.courses.filter(c => !c.step);
      g.perm = q.length > 0 && q.every(isPerm);
      g.rule = (q.find(c => c.rule) || {}).rule || "";
      g.legal = legalOf(q[0] || g.courses[0]);
      g.roles = Array.from(new Set([].concat.apply([], g.courses.map(c => (c.roles || []).map(r => ROLE_ALIAS[r] || r)))));
      g.all = g.courses.some(c => c.all);
    });
    return out;
  }
  const famOf = (f) => fams().find(g => g.fam === f) || null;
  const needs = (p, g) => !g.vendor && (g.all || g.roles.some(r => rolesOf(p).indexOf(r) >= 0));

  /* ─────── 유효기한 · 상태 ───────
     묶음 안 기록을 날짜순으로 이어 셈한다. 직접 적은 유효기한(이수증 기재)이 있으면 그것.
     kr(지침 제13조): 직전 유효기한 다음 날(=1년이 되는 날) 전후 30일 안 이수 → 직전 유효기한 다음 날부터 주기
     dg(기술기준 제12조②): 직전 유효기한 3개월 전 ~ 유효기한 안 이수 → 직전 유효기한 다음 날부터 주기 */
  function nextExpire(c, date, prev) {
    const m = Number(c && c.cycle) || 0;
    if (!c || m <= 0 || !isISO(date)) return "";
    if (isISO(prev) && c.rule === "kr" && Math.abs(dayDiff(addDays(prev, 1), date)) <= KR_WIN) return calcExpire(addDays(prev, 1), m);
    if (isISO(prev) && c.rule === "dg" && date <= prev && date >= shiftM(prev, -DG_WIN)) return calcExpire(addDays(prev, 1), m);
    return calcExpire(date, m);
  }
  function chain(pid, g) {
    const ids = g.courses.map(c => c.id);
    const rs = records().filter(r => r.pid === pid && ids.indexOf(r.cid) >= 0 && isISO(r.date))
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)));
    let prev = "";
    return rs.map(r => {
      const c = courseOf(r.cid) || {};
      let exp = "";
      if (c.step) exp = "";
      else if (isISO(r.expire)) exp = r.expire;
      else exp = nextExpire(c, r.date, prev);
      if (!c.step) prev = exp;
      return { r, c, exp };
    });
  }
  /* 한 기록의 유효기한(묶음 이어 셈) */
  function expireOf(r) {
    if (!r) return "";
    const c = courseOf(r.cid);
    if (!c) return isISO(r.expire) ? r.expire : "";
    const g = famOf(c.fam || c.id);
    if (!g) return isISO(r.expire) ? r.expire : calcExpire(r.date, c.cycle);
    const x = chain(r.pid, g).find(k => k.r === r || k.r.id === r.id);
    return x ? x.exp : "";
  }
  /* 기록 입력 화면용 — 이 날짜에 이수하면 계산되는 유효기한(같은 묶음의 앞 기록 기준) */
  function previewExpire(pid, cid, date, rid) {
    const c = courseOf(cid);
    if (!c || c.step || !isISO(date)) return "";
    const g = famOf(c.fam || c.id);
    let prev = "";
    if (g) chain(pid, g).filter(k => k.r.id !== rid && !k.c.step && k.r.date <= date).forEach(k => { prev = k.exp; });
    return nextExpire(c, date, prev);
  }
  const ST = {
    ok: { label: "유효", tone: "green", lv: 0 }, perm: { label: "영구", tone: "blue", lv: 0 },
    soon: { label: "임박", tone: "amber", lv: 1 }, win: { label: "이수 기간", tone: "amber", lv: 2 },
    grace: { label: "유예", tone: "amber", lv: 2 }, step: { label: "인증 전", tone: "amber", lv: 2 },
    exp: { label: "만료", tone: "red", lv: 3 }, susp: { label: "자격 정지", tone: "red", lv: 3 },
    lapsed: { label: "회복 기한 경과", tone: "red", lv: 3 }, none: { label: "미이수", tone: "red", lv: 3 }
  };
  const GOOD = ["ok", "perm"], WARN = ["soon", "win", "grace", "step"], BAD = ["exp", "susp", "lapsed", "none"];
  const QUALIFIED = ["ok", "perm", "soon", "win", "grace"];          // 업무 수행 가능(이수 기간 · 유예 포함)
  const needAct = (st) => ST[st] && ST[st].lv >= 2;
  /* 한 사람 · 한 묶음의 상태 */
  function famStatus(p, g, t) {
    t = t || todayISO();
    const ch = chain(p.id, g);
    if (!ch.length) return { st: "none" };
    const q = ch.filter(k => !k.c.step);
    if (!q.length) return { st: "step", r: ch[ch.length - 1].r, at: "" };
    const last = q[q.length - 1], r = last.r, exp = last.exp, rule = last.c.rule || g.rule;
    if (!exp) return { st: "perm", r, exp: "" };
    const d = dayDiff(t, exp);
    if (rule === "kr") {
      const anniv = addDays(exp, 1), winS = addDays(anniv, -KR_WIN), winE = addDays(anniv, KR_WIN);
      if (t < winS) return { st: d <= SOON ? "soon" : "ok", r, exp, d, winS, winE, at: exp };
      if (t <= exp) return { st: "win", r, exp, d, winS, winE, at: winE };
      if (t <= winE) return { st: "grace", r, exp, d, winS, winE, at: winE };
      const suspS = addDays(winE, 1), recE = calcExpire(suspS, KR_SUSP);
      return { st: t <= recE ? "susp" : "lapsed", r, exp, d, winS, winE, suspS, recE, at: recE };
    }
    if (rule === "dg") {
      const winS = shiftM(exp, -DG_WIN);
      if (t > exp) return { st: "exp", r, exp, d, at: exp };
      if (t >= winS) return { st: "win", r, exp, d, winS, winE: exp, at: exp };
      return { st: d <= SOON ? "soon" : "ok", r, exp, d, winS, winE: exp, at: exp };
    }
    return { st: d < 0 ? "exp" : d <= SOON ? "soon" : "ok", r, exp, d, at: exp };
  }
  /* 상태 설명 한 줄 */
  function stText(c, short) {
    if (!c) return "";
    switch (c.st) {
      case "none": return "기록 없음";
      case "step": return "자격인증 전";
      case "perm": return short ? "영구" : "영구 · 1회 이수";
      case "ok": return short ? "~" + ymd2(c.exp) : "유효기한 " + dot(c.exp);
      case "soon": return short ? "D-" + c.d : "유효기한 " + dot(c.exp) + " · D-" + c.d;
      case "win": return short ? "~" + ymd2(c.winE) : "이수 기간 " + md(c.winS) + " ~ " + md(c.winE) + " · 유효기한 " + dot(c.exp);
      case "grace": return short ? "~" + ymd2(c.winE) : "유효기한 " + dot(c.exp) + " 경과 · 이수 기간 ~" + dot(c.winE);
      case "susp": return short ? "회복 ~" + ymd2(c.recE) : "정지 " + dot(c.suspS) + " · 정기교육으로 회복 ~" + dot(c.recE);
      case "lapsed": return short ? "~" + ymd2(c.recE) : "회복 기한 " + dot(c.recE) + " 경과";
      case "exp": return short ? "D+" + (-c.d) : "유효기한 " + dot(c.exp) + " 경과";
      default: return "";
    }
  }
  /* 한 사람의 필수 묶음 상태 · 가장 나쁜 상태 · 다음 할 날짜 */
  function personQuals(p, t) {
    t = t || todayISO();
    const req = fams(false).filter(g => needs(p, g)).map(g => Object.assign({ g, req: true }, famStatus(p, g, t)));
    const held = fams(false).filter(g => !needs(p, g) && records().some(r => r.pid === p.id && g.courses.some(c => c.id === r.cid)))
      .map(g => Object.assign({ g, req: false }, famStatus(p, g, t)));
    const worst = req.reduce((w, c) => (!w || ST[c.st].lv > ST[w.st].lv ? c : w), null);
    const dated = req.filter(c => isISO(c.at) && c.st !== "perm").sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { req, held, worst, next: dated[0] || null };
  }
  /* 이수 현황 표의 칸 — 필요한 사람 × 필요한 묶음 */
  function grid(t) {
    const gs = fams(false);
    const ps = people().filter(p => active(p, t));
    const cells = [];
    ps.forEach(p => gs.forEach(g => { if (needs(p, g)) cells.push(Object.assign({ p, g }, famStatus(p, g, t))); }));
    return { gs: gs.filter(g => cells.some(c => c.g === g)), ps, cells };
  }
  function stats(t) {
    t = t || todayISO();
    const { ps, cells } = grid(t);
    const n = (sts) => cells.filter(c => sts.indexOf(c.st) >= 0).length;
    const ssi = ps.filter(isSSI);
    return { people: ps.length, cells: cells.length, good: n(GOOD), warn: n(WARN), bad: n(BAD),
      ok: n(["ok", "perm"]), soon: n(["soon"]), win: n(["win", "grace"]), step: n(["step"]), susp: n(["susp", "lapsed"]), exp: n(["exp"]), none: n(["none"]),
      act: cells.filter(c => needAct(c.st)).length,
      valid: cells.length ? Math.round(n(QUALIFIED) / cells.length * 100) : null,
      ssi: ssi.length, ssiMiss: ssi.filter(p => !pledged(p)).length };
  }
  /* 직무별 집계(대시보드) — 직무를 가진 재직 인원 × 그 직무의 필수 묶음 */
  function roleStats(t) {
    t = t || todayISO();
    const ps = people().filter(p => active(p, t));
    const out = [];
    allRoles().forEach(r => {
      const holders = ps.filter(p => rolesOf(p).indexOf(r) >= 0);
      if (!holders.length) return;
      const gs = fams(false).filter(g => g.roles.indexOf(r) >= 0);
      if (!gs.length) return;
      const cs = [];
      holders.forEach(p => gs.forEach(g => cs.push(famStatus(p, g, t))));
      const n = (sts) => cs.filter(c => sts.indexOf(c.st) >= 0).length;
      out.push({ role: r, grp: roleGroup(r), people: holders.length, cells: cs.length, good: n(GOOD), warn: n(WARN), bad: n(BAD) });
    });
    return out;
  }
  /* 할 일 목록 — days 안에 갱신해야 하는 칸 + 조치 필요 칸 (날짜순) */
  function dueList(days, t) {
    t = t || todayISO();
    const lim = addDays(t, days == null ? 90 : days);
    return grid(t).cells.filter(c => needAct(c.st) || (c.st !== "perm" && isISO(c.at) && c.at <= lim))
      .sort((a, b) => ST[b.st].lv - ST[a.st].lv || String(a.at || "").localeCompare(String(b.at || "")));
  }
  /* 월별 만료 예정(앞으로 n개월) — 재직 인원 필수 묶음의 유효기한 */
  function expiryByMonth(n, t) {
    t = t || todayISO();
    const out = [];
    for (let i = 0; i < n; i++) { const k = shiftM(t.slice(0, 7) + "-01", i).slice(0, 7); out.push({ key: k, label: Number(k.slice(5)) + "월", y: Number(k.slice(0, 4)), n: 0, names: [] }); }
    grid(t).cells.forEach(c => {
      if (!isISO(c.exp) || c.exp < t) return;
      const m = out.find(x => x.key === c.exp.slice(0, 7));
      if (m) { m.n++; m.names.push(c.p.name + " · " + c.g.name); }
    });
    return out;
  }
  /* 월별 교육 실시(지난 n개월) — 당사 실시 · 협력사 확인 건수 · 당사 교육 시간 */
  function sessionsByMonth(n, t) {
    t = t || todayISO();
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const k = shiftM(t.slice(0, 7) + "-01", -i).slice(0, 7); out.push({ key: k, label: Number(k.slice(5)) + "월", y: Number(k.slice(0, 4)), own: 0, vendor: 0, hours: 0 }); }
    sessions().forEach(s => {
      const m = isISO(s.date) && out.find(x => x.key === s.date.slice(0, 7));
      if (!m) return;
      if (s.type === "vendor") m.vendor++; else { m.own++; m.hours += num(s.hours) || 0; }
    });
    return out;
  }
  /* 교육 기록 8항목(지침 제32조) — 비어 있는 항목 이름 */
  const EIGHT = [
    ["명칭", s => !!norm(s.title)], ["일시", s => isISO(s.date) && !!norm(s.time)], ["장소", s => !!norm(s.place)],
    ["시간", s => num(s.hours) != null && num(s.hours) > 0], ["교관", s => !!norm(s.instructor)], ["시간표", s => sfiles(s, "tt").length > 0],
    ["평가결과", s => !!norm(s.evalText) || sfiles(s, "eval").length > 0], ["참석자 명단 · 서명", s => sfiles(s, "roster").length > 0]
  ];
  const missing = (s) => EIGHT.filter(([, f]) => !f(s)).map(([k]) => k);
  const keepOver = (s, t) => isISO(s.date) && addDays(s.date, KEEP_YEARS * 365) < (t || todayISO());
  const leftOver = (p, t) => isISO(p.left) && addDays(p.left, KEEP_LEFT_DAYS) < (t || todayISO());
  const within12 = (iso, t) => isISO(iso) && dayDiff(iso, t || todayISO()) <= 365 && iso <= (t || todayISO());
  function sessionTitle(s) {
    if (s.type === "vendor") { const c = courseOf(s.cid); return norm([s.vendor, c ? c.name : s.title].filter(Boolean).join(" · ")) || "협력사 교육 확인"; }
    return norm(s.title) || (courseOf(s.cid) || {}).name || "교육";
  }
  function stamp(x) { x.updatedAt = new Date().toISOString(); x.updatedBy = me(); }
  function cycleText(c) {
    if (!c) return "-";
    if (c.step) return "단계 (자격 유효기간 없음)";
    const m = Number(c.cycle) || 0;
    if (m <= 0) return "1회 · 영구";
    if (c.rule === "kr" && m === 12) return "연 1회 · 전후 30일 이수 기간";
    if (c.rule === "dg") return m + "개월 이내 · 만료 3개월 안 이수 시 연장";
    return m % 12 === 0 ? (m / 12) + "년" : m + "개월";
  }

  /* ─────── v1.31 데이터 이전(멱등) — 과정 정식 명칭 · 직무 이름 · v2 고정 유효기한 ───────
     코드 기본 과정 id 는 정식 정의로 바꾸고, 직접 넣은 과정 중 위험물(DGR)은 24개월 · dg 규칙, 교관은 1회(영구)로.
     같은 묶음 · 구분이 없는 기본 과정은 덧붙인다. 옛 직무 이름은 정식 명칭으로.
     SeMIS v2 에서 옮긴 기록(src semis-v2)의 고정 유효기한(13개월 근사)은 지워 규칙으로 다시 셈한다. */
  function migrate(t) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return false;
    if (Number(t.catVer) >= CAT_VER) return false;
    const before = JSON.stringify(t);
    const list = Array.isArray(t.courses) ? t.courses.filter(c => c && c.id) : [];
    if (list.length) {
      const out = [];
      list.forEach(c => {
        const d = DEF_COURSES.find(x => x.id === c.id);
        if (d) { out.push(JSON.parse(JSON.stringify(d))); return; }
        const x = Object.assign({}, c, { roles: (Array.isArray(c.roles) ? c.roles : []).map(r => ROLE_ALIAS[r] || r) });
        if (x.fam === "dgr" || /DGR|위험물/i.test(String(x.name || ""))) {
          Object.assign(x, { fam: "dgr", kind: x.kind === "정기" ? "정기" : "초기", cycle: 24, rule: "dg", legal: "law", basis: DG_BASIS, org: x.org || DG_ORG });
          if (!x.roles.length) x.roles = ["위험물 취급자"];
        } else if (x.fam === "inst" || /교관/.test(String(x.name || ""))) {
          Object.assign(x, { fam: "inst", kind: "1회", cycle: 0, rule: "", legal: "law", basis: INST_BASIS, org: x.org || INST_ORG, hours: x.hours || "40시간↑ · 평가 · 분야별 인증" });
          if (!x.roles.length) x.roles = ["항공보안교관"];
        } else if (!x.legal) x.legal = "own";
        out.push(x);
      });
      DEF_COURSES.forEach(d => {
        if (!out.some(c => c.id === d.id || (c.fam === d.fam && c.kind === d.kind && !!c.vendor === !!d.vendor))) out.push(JSON.parse(JSON.stringify(d)));
      });
      t.courses = out;
    }
    (Array.isArray(t.people) ? t.people : []).forEach(p => {
      if (p && Array.isArray(p.roles)) p.roles = p.roles.map(r => ROLE_ALIAS[r] || r).filter((r, i, a) => r && a.indexOf(r) === i);
    });
    (Array.isArray(t.records) ? t.records : []).forEach(r => { if (r && r.src === "semis-v2" && r.expire) r.expire = ""; });
    t.catVer = CAT_VER;
    return JSON.stringify(t) !== before;
  }

  /* ─────── SSI 서약 — SeMIS v2 보안서약서 명단 (v1.21) ───────
     서버 RPC semis_logi_pledges(manager 이상): 사람별 최신 서약 { name, dept, position, date, state, n } — 사번 · 서명 없음.
     10분 동안 기억하고, 실패하면 1분 동안 다시 부르지 않는다(화면 다시 그리기와 맞물린 반복 호출 방지). */
  const PL = { rows: null, at: 0, busy: null, err: "", failAt: 0 };
  const PL_TTL = 10 * 60000;
  const PL_STATE = { valid: ["유효", "green"], left: ["퇴직 · 전출", "gray"], void: ["무효", "red"] };
  function loadPledges(force) {
    if (!force && PL.rows && Date.now() - PL.at < PL_TTL) return Promise.resolve(false);
    if (!force && PL.failAt && Date.now() - PL.failAt < 60000) return Promise.resolve(false);
    if (PL.busy) return PL.busy;
    const S = typeof window !== "undefined" ? window.SemisSync : null;
    if (!S || !S.rpc) return Promise.resolve(false);
    PL.busy = S.rpc("semis_logi_pledges", {}).then(d => {
      if (!d || !d.ok) throw new Error((d && d.error) || "pledges");
      PL.rows = (Array.isArray(d.rows) ? d.rows : []).filter(r => r && r.name)
        .map(r => ({ name: norm(r.name), dept: norm(r.dept), position: norm(r.position), date: isISO(r.date) ? r.date : "",
                     state: PL_STATE[r.state] ? r.state : "valid", n: Number(r.n) || 1 }));
      PL.at = Date.now(); PL.err = ""; PL.failAt = 0;
      return true;
    }).catch(e => { PL.err = String((e && e.message) || e); PL.failAt = Date.now(); return false; })
      .finally(() => { PL.busy = null; });
    return PL.busy;
  }
  const nkey = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const dkey = (s) => String(s || "").replace(/\s+/g, "");
  /* 인원 ↔ 서약 명단: 이름이 같으면 그 서약, 동명이인이면 소속이 겹치는 한 건만 — 못 가리면 ambiguous */
  function pledgeMatch(p) {
    if (!PL.rows || !p) return null;
    const c = PL.rows.filter(r => nkey(r.name) === nkey(p.name));
    if (c.length <= 1) return c[0] || null;
    const d = dkey(p.dept);
    const b = d ? c.filter(r => { const x = dkey(r.dept); return x && (x.indexOf(d) >= 0 || d.indexOf(x) >= 0); }) : [];
    return b.length === 1 ? b[0] : { ambiguous: true, n: c.length };
  }
  /* 인원의 SSI 서약: SeMIS 명단(유효)과 인원에 입력한 서약일 중 늦은 것 */
  function pledgeInfo(p) {
    const m = pledgeMatch(p);
    const man = p && isISO(p.pledge) ? p.pledge : "";
    const sd = m && !m.ambiguous && m.state === "valid" ? m.date : "";
    if (sd && (!man || sd >= man)) return { date: sd, src: "semis", row: m };
    if (man) return { date: man, src: "manual", row: m && !m.ambiguous ? m : null };
    return { date: "", src: "", ambiguous: !!(m && m.ambiguous), row: m && !m.ambiguous ? m : null };
  }
  const pledged = (p) => !!pledgeInfo(p).date;
  const isSSI = (p) => rolesOf(p).indexOf("SSI 취급자") >= 0;

  /* ─────── 수검 대응 센터 증빙 연결 ───────
     점검 체크리스트 항목 번호 → 이 화면의 실제 기록으로 증빙 여부 판단(없으면 '증빙 없음'). 번호만 쓰고 원문은 쓰지 않는다. */
  function roleValid(roles, t) {
    roles = [].concat(roles);
    const gs = fams(false).filter(g => g.roles.some(r => roles.indexOf(r) >= 0));
    const ps = people().filter(p => active(p, t) && rolesOf(p).some(r => roles.indexOf(r) >= 0));
    const ok = ps.filter(p => gs.filter(g => needs(p, g)).every(g => QUALIFIED.indexOf(famStatus(p, g, t).st) >= 0)).length;
    return { n: ps.length, ok };
  }
  const vendorRecent = (fam, t) => sessions().filter(s => s.type === "vendor" && (!fam || (courseOf(s.cid) || {}).fam === fam) && within12(s.date, t));
  function evidence(mid) {
    const t = todayISO();
    const role = (r, label) => { const v = roleValid(r, t); return { ok: v.n > 0 && v.ok === v.n, text: v.n ? `${label} ${v.ok}/${v.n}명 유효` : `${label} 등록 없음` }; };
    const vend = (fam, label) => { const k = vendorRecent(fam, t).length; return { ok: k > 0, text: k ? `${label} 확인 ${k}건(1년)` : `${label} 확인 없음` }; };
    switch (String(mid || "")) {
      case "1.1": return role(SUP, "항공사보안감독자");
      case "9.2": return role("ACMR", "ACMR");
      case "1.2": { const k = sessions().filter(s => s.type !== "vendor" && within12(s.date, t)).length; return { ok: k > 0, text: k ? `교육 기록 ${k}건(1년)` : "최근 1년 교육 기록 없음" }; }
      case "1.3": return vend("", "협력사 교육");
      case "1.4": { const own = sessions().filter(s => s.type !== "vendor"); const k = own.filter(s => !missing(s).length).length;
        return { ok: own.length > 0 && k === own.length, text: own.length ? `기록 8항목 완비 ${k}/${own.length}` : "교육 기록 없음" }; }
      case "2.10": case "2.10.1": { const ps = people().filter(p => active(p, t) && isSSI(p));
        if (ps.length && !PL.rows) loadPledges(false).then(ch => { if (ch && routeNow() === "audit") SeMIS.renderView(); });
        const k = ps.filter(pledged).length; return { ok: ps.length > 0 && k === ps.length, text: ps.length ? `SSI 서약 ${k}/${ps.length}명` : "SSI 취급자 등록 없음" }; }
      case "3.4": return vend("v-drug", "향정신성 물질 교육");
      case "9.2.1": return vend("v-tsa", "TSA 교육");
      case "8.2": { const v = roleValid("항공보안장비 유지보수요원", t), k = vendorRecent("v-screen", t).length;
        return { ok: (v.n > 0 && v.ok === v.n) || k > 0, text: [v.n ? `유지보수요원 ${v.ok}/${v.n}명 유효` : "", k ? `검색요원 확인 ${k}건(1년)` : ""].filter(Boolean).join(" · ") || "기록 없음" }; }
      default: return null;
    }
  }
  if (typeof window !== "undefined") (window.SemisEvidence = window.SemisEvidence || {})[MOD] = evidence;

  /* ─────── 화면 상태 ─────── */
  let tab = "people", q = "", roleF = "", rgF = "", onlyAct = false, year = "", sType = "all", pState = "active", pView = "list";
  let pid = "", sid = "";                       // 개인 화면 · 교육 기록 화면
  const TABS = [["people", "인원"], ["sessions", "교육 기록"], ["catalog", "직무 · 과정"], ["pledges", "SSI 서약"]];
  let plScope = "team", plState = "valid";
  const routeNow = () => (typeof location !== "undefined" ? location.hash.replace(/^#\//, "") : "") || "dashboard";
  const segHTML = (name, items, cur) => `<div class="seg" role="group" aria-label="${esc(name)}">${items.map(([v, lb]) =>
    `<button type="button" class="seg-btn" data-tseg="${esc(name)}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(lb)}</button>`).join("")}</div>`;
  const hay = (a) => a.map(v => String(v || "")).join(" ").toLowerCase();
  function fileChips(files) {
    return filesOf(files).map(f => `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a>`).join("");
  }
  const stChip = (c) => ui.chip(ST[c.st].label, ST[c.st].tone);
  function cellChip(c) {
    if (!c) return '<span class="tr-na">-</span>';
    const sub = stText(c, true);
    return `<span class="tr-cell" data-st="${c.st}">${stChip(c)}${sub && c.st !== "perm" && c.st !== "none" ? `<small class="mono">${esc(sub)}</small>` : ""}</span>`;
  }
  /* 직무 칩 — 직무군 색 점 + 옅은 바탕(기타는 기본색 · 빈 고리) */
  const roleChip = (r) => { const g = rgOf(r); return `<span class="tr-role rg-${g.id}" title="${esc(g.label)}">${rgDot(g)}${esc(r)}</span>`; };
  const roleChips = (p) => sortRoles(rolesOf(p)).map(roleChip).join("");
  /* 사람이 가진 직무군(순서대로, 중복 없이) */
  const rgsOf = (p) => RGROUPS.filter(g => rolesOf(p).some(r => rgOf(r) === g));
  const legalChip = (k) => ui.chip(LEGAL[k][0], LEGAL[k][1]);

  /* ─────── 화면 이동 (개인 · 교육 기록) — 브라우저 뒤로 = 목록 ─────── */
  function hist(on, kind, id) {
    try {
      if (on) history.pushState({ tr: kind + ":" + id }, "", location.hash);
    } catch (e) { /* noop */ }
  }
  /* 다른 화면(대시보드 · 통합 검색)에서 열 때는 pendingOpen — 도착한 render 가 그 기록을 history 에 얹는다.
     그 밖에 메뉴로 들어오면(history 에 표시 없음) 늘 목록부터 */
  let pendingOpen = false;
  function openPerson(id) {
    if (!personOf(id)) return;
    pid = id; sid = ""; tab = "people";
    if (routeNow() !== MOD) { pendingOpen = true; SeMIS.navigate(MOD); return; }   // hashchange 가 그린다
    hist(true, "p", id); SeMIS.renderView();
  }
  function openSession(id) {
    if (!sessionOf(id)) return;
    sid = id; pid = ""; tab = "sessions";
    if (routeNow() !== MOD) { pendingOpen = true; SeMIS.navigate(MOD); return; }
    hist(true, "s", id); SeMIS.renderView();
  }
  function backToList() {
    const st = typeof history !== "undefined" && history.state && history.state.tr;
    if (st) { try { history.back(); return; } catch (e) { /* 아래로 */ } }
    pid = ""; sid = ""; SeMIS.renderView();
  }
  /* 인쇄 때는 직무 · 과정 기준표의 접힌 줄을 모두 펼친다 */
  if (typeof window !== "undefined") window.addEventListener("beforeprint", () => {
    if (routeNow() === MOD) $$("details.tr-rd").forEach(d => { d.open = true; });
  });
  if (typeof window !== "undefined") window.addEventListener("popstate", () => {
    if (routeNow() !== MOD) return;
    const st = String((history.state && history.state.tr) || "");
    const np = st.indexOf("p:") === 0 ? st.slice(2) : "", ns = st.indexOf("s:") === 0 ? st.slice(2) : "";
    if (np === pid && ns === sid) return;
    pid = np; sid = ns; SeMIS.renderView();
  });

  /* ═════════ 인원 (목록 · 이수 현황표 · 모바일 카드) ═════════ */
  function peopleRows(t) {
    const all = people();
    return all.filter(p => {
      const a = active(p, t);
      if (pState === "active" && !a) return false;
      if (pState === "left" && a) return false;
      if (roleF && rolesOf(p).indexOf(roleF) < 0) return false;
      if (rgF && !rolesOf(p).some(r => rgOf(r).id === rgF)) return false;
      if (onlyAct) { const pq = personQuals(p, t); if (!(pq.worst && needAct(pq.worst.st)) && !(isSSI(p) && !pledged(p))) return false; }
      return !q || hay([p.name, p.dept, rolesOf(p).join(" "), p.note]).indexOf(q.toLowerCase()) >= 0;
    }).map(p => ({ p, pq: personQuals(p, t) }))
      .sort((a, b) => (onlyAct ? (b.pq.worst ? ST[b.pq.worst.st].lv : 0) - (a.pq.worst ? ST[a.pq.worst.st].lv : 0) : 0) || String(a.p.name).localeCompare(String(b.p.name), "ko"));
  }
  function peopleHTML(canW) {
    const t = todayISO(), st = stats(t);
    const all = people();
    const left = all.filter(p => !active(p, t));
    const used = sortRoles(allRoles().filter(r => all.some(p => rolesOf(p).indexOf(r) >= 0)));
    const roleSel = `<select id="tr-role" aria-label="직무"><option value="">전체 직무</option>${RGROUPS.map(g => {
      const rs = used.filter(r => rgOf(r) === g);
      return rs.length ? `<optgroup label="${esc(g.label)}">${rs.map(r => `<option value="${esc(r)}" ${roleF === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</optgroup>` : "";
    }).join("")}</select>`;
    const band = ui.stats([
      { label: "재직 인원", value: st.people, sub: left.length ? "퇴직 · 전출 " + left.length : "" },
      { label: "자격 유효율", value: st.valid == null ? "-" : st.valid + "%", sub: "필수 " + st.cells + "건", tone: st.valid == null ? "muted" : st.valid === 100 ? "ok" : "warn" },
      { label: "갱신 필요", value: st.win + st.step, sub: "이수 기간 · 유예 · 임박 " + st.soon, tone: st.win + st.step ? "warn" : "ok" },
      { label: "정지 · 만료 · 미이수", value: st.bad, sub: [st.susp ? "정지 " + st.susp : "", st.exp ? "만료 " + st.exp : "", st.none ? "미이수 " + st.none : ""].filter(Boolean).join(" · "), tone: st.bad ? "bad" : "ok" },
      { label: "SSI 서약", value: st.ssi ? (st.ssi - st.ssiMiss) + "/" + st.ssi : "-", sub: st.ssiMiss ? "누락 " + st.ssiMiss : "", tone: st.ssiMiss ? "bad" : st.ssi ? "ok" : "muted" }
    ]);
    const tools = `<div class="toolbar">
        ${ui.search("tr-q", "이름 · 소속 · 직무 검색", q)}
        ${used.length > 1 ? `<label class="ck-f"><span class="m-hide">직무</span>${roleSel}</label>` : ""}
        <button type="button" class="pb-chk" id="tr-act" aria-pressed="${onlyAct}">${icon("alert", 14)}<span>조치 필요만</span></button>
        <span class="spacer m-hide"></span>
        <span class="m-hide">${segHTML("pstate", [["active", "재직"], ["left", "퇴직 · 전출"], ["all", "전체"]], pState)}</span>
        ${mob() ? "" : segHTML("pview", [["list", "목록"], ["grid", "이수 현황표"]], pView)}
      </div>`;
    return band + `<section class="card" id="tr-plist">${tools}${all.length ? rgLegend(t) : ""}<div id="tr-pbody">${peopleBody(canW, t)}</div></section>`;
  }
  /* 직무군 범례 = 직무군 걸러 보기(다시 누르면 해제). 숫자 = 지금 재직/퇴직 보기에서 그 군 직무를 가진 사람 수 */
  function rgLegend(t) {
    const base = people().filter(p => { const a = active(p, t); return pState === "all" || (pState === "left" ? !a : a); });
    return `<div class="tr-rglg" role="group" aria-label="직무군">${RGROUPS.map(g => {
      const n = base.filter(p => rolesOf(p).some(r => rgOf(r) === g)).length;
      const on = rgF === g.id;
      return `<button type="button" class="tr-rgb rg-${g.id}${n ? "" : " is-zero"}" data-rgf="${g.id}" aria-pressed="${on}"${n || on ? "" : " disabled"}
        title="${esc(g.roles.length ? g.roles.join(" · ") : "위험물 · SSI · ACMR · ACC3 · 사내 직무")}">${rgDot(g)}<span>${esc(g.label)}</span><b class="mono">${n}</b></button>`;
    }).join("")}</div>`;
  }
  function peopleBody(canW, t) {
    const rows = peopleRows(t);
    if (!people().length) return ui.empty("등록된 인원이 없습니다.", canW ? `<button type="button" class="btn btn-soft btn-sm" data-tpadd>인원 등록</button>` : "");
    if (!rows.length) return ui.empty("조건에 맞는 인원이 없습니다.");
    if (mob()) return `<ul class="tr-mlist">${rows.map(({ p, pq }) => {
      const w = pq.worst, nx = pq.next, a = active(p, t);
      const sub = !a ? "퇴직 · 전출 " + dot(p.left) : nx ? famShort(nx.g) + " " + stText(nx, true) : pq.req.length ? "필수 과정 " + pq.req.length + "건" : "필수 과정 없음";
      const ssiMiss = isSSI(p) && !pledged(p);
      return `<li><button type="button" class="tr-mrow" data-tperson="${esc(p.id)}">
        <span class="tr-mn"><b>${esc(p.name)}</b>${rgsOf(p).length ? `<span class="tr-rdots" role="img" aria-label="${esc("직무: " + sortRoles(rolesOf(p)).join(", "))}">${rgsOf(p).map(rgDot).join("")}</span>` : ""}<small>${esc(p.dept || "")}</small></span>
        <span class="tr-ms">${w ? stChip(w) : ""}${ssiMiss ? ui.chip("서약 누락", "red") : ""}</span>
        <span class="tr-mx mono">${esc(sub)}</span></button></li>`;
    }).join("")}</ul>`;
    if (pView === "grid") return gridTable(rows, canW, t);
    return `<div class="table-wrap"><table class="tbl tbl-cap tr-ptbl" style="--cap:1400px">
      <thead><tr><th>이름</th><th>직무</th><th>자격 상태</th><th>다음 갱신</th><th>SSI 서약</th></tr></thead>
      <tbody>${rows.map(({ p, pq }) => {
        const a = active(p, t), nx = pq.next;
        return `<tr data-tperson="${esc(p.id)}" tabindex="0" class="is-click">
          <td class="c-name" data-role="title"><button type="button" class="tbl-open" data-tperson="${esc(p.id)}">${esc(p.name)}</button><div class="cell-sub">${esc(p.dept || "")}</div></td>
          <td class="c-roles">${roleChips(p) || '<span class="cell-sub">-</span>'}</td>
          <td class="c-q">${!a ? `${leftOver(p, t) ? ui.chip("보관 기한 경과", "amber") : ui.chip("퇴직", "gray")}<div class="cell-sub mono">${esc(dot(p.left))}${leftOver(p, t) ? "" : " · 보관 ~" + esc(dot(addDays(p.left, KEEP_LEFT_DAYS)))}</div>`
            : pq.req.length ? `<div class="tr-qs">${pq.req.map(c => `<span class="tr-qi" data-st="${c.st}" title="${esc(c.g.name + " · " + ST[c.st].label + " · " + stText(c))}"><span class="tr-qn">${esc(famShort(c.g))}</span>${stChip(c)}</span>`).join("")}</div>`
            : '<span class="cell-sub">필수 과정 없음</span>'}</td>
          <td class="c-next mono">${a && nx ? `${esc(dot(nx.at))}<div class="cell-sub">${esc(nx.st === "susp" ? "회복 기한" : nx.st === "win" || nx.st === "grace" ? "이수 기간 끝" : "유효기한")}</div>` : '<span class="cell-sub">-</span>'}</td>
          <td class="c-ssi">${ssiCellText(p)}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }
  const famShort = (g) => String(g.name || "").replace(/\s*\(.*\)\s*$/, "");
  function ssiCellText(p) {
    const pi = pledgeInfo(p);
    if (pi.date) return `<span class="mono">${esc(dot(pi.date))}</span>${pi.src === "semis" ? '<small class="tr-src">SeMIS</small>' : ""}`;
    return isSSI(p) ? ui.chip(pi.ambiguous ? "동명이인 확인" : "누락", pi.ambiguous ? "amber" : "red") : '<span class="cell-sub">-</span>';
  }
  function ssiCell(p) {
    const pi = pledgeInfo(p);
    if (pi.date) return `<span class="tr-cell" data-st="ok" title="${pi.src === "semis" ? "SeMIS 보안서약서 명단" : "인원에 입력한 서약일"}">${ui.chip("서약", "green")}<small class="mono">${esc(ymd2(pi.date))}</small></span>`;
    return `<span class="tr-cell" data-st="none">${ui.chip(pi.ambiguous ? "동명이인" : "누락", pi.ambiguous ? "amber" : "red")}</span>`;
  }
  /* PC 이수 현황표 — 사람 × 필수 묶음 */
  function gridTable(rows, canW, t) {
    const g = grid(t);
    const ids = rows.map(x => x.p.id);
    const gs = g.gs;
    const ps = rows.map(x => x.p).filter(p => active(p, t));
    if (!ps.length) return ui.empty("재직 인원이 없습니다.");
    const ssiCol = ps.some(isSSI);
    return `<div class="table-wrap"><table class="tbl tbl-cap tr-gtbl" data-no-stack style="--cap:1480px">
      <thead><tr><th>이름</th>${gs.map(x => `<th>${esc(famShort(x))}</th>`).join("")}${ssiCol ? "<th>SSI 서약</th>" : ""}</tr></thead>
      <tbody>${ps.filter(p => ids.indexOf(p.id) >= 0).map(p => `<tr data-pid="${esc(p.id)}">
        <td class="c-name"><button type="button" class="tbl-open" data-tperson="${esc(p.id)}">${esc(p.name)}</button><div class="tr-rmini">${sortRoles(rolesOf(p)).map(r => `<span>${rgDot(rgOf(r))}${esc(r)}</span>`).join("")}</div></td>
        ${gs.map(x => { const c = g.cells.find(k => k.p === p && k.g === x);
          return `<td class="c-cell${c ? "" : " is-na"}"${c && canW ? ` data-tcell="${esc(p.id)}|${esc(x.fam)}"` : ""}>${cellChip(c)}</td>`; }).join("")}
        ${ssiCol ? `<td class="c-cell${isSSI(p) ? "" : " is-na"}">${isSSI(p) ? ssiCell(p) : '<span class="tr-na">-</span>'}</td>` : ""}
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ═════════ 개인 화면 ═════════ */
  function personPage(root, canW) {
    const p = personOf(pid);
    const t = todayISO();
    const pq = personQuals(p, t);
    const rs = records().filter(r => r.pid === p.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const pi = pledgeInfo(p);
    const a = active(p, t);
    const head = `<div class="page-head tr-head">
        <button type="button" class="btn btn-ghost btn-sm tr-back" data-keep data-tback aria-label="인원 목록으로">${icon("chevl", 16)}<span>인원</span></button>
        <div class="page-title">${esc(p.name)}</div><span class="page-meta">${esc([p.dept, a ? "" : "퇴직 · 전출 " + dot(p.left)].filter(Boolean).join(" · "))}</span>
        <span class="spacer"></span>
        ${canW ? `<button type="button" class="btn btn-primary btn-sm" id="tr-prec">${icon("plus", 16)}<span>이수 등록</span></button>
          <button type="button" class="btn btn-ghost btn-sm" id="tr-ppl">${icon("shield", 16)}<span>서약 등록</span></button>
          <button type="button" class="btn btn-ghost btn-sm" id="tr-pedit">${icon("edit", 16)}<span>정보 수정</span></button>` : ""}
      </div>`;
    const qual = (c) => {
      const lastC = c.r ? courseOf(c.r.cid) : null;
      const files = c.r ? filesOf(c.r.files) : [];
      const tag = canW ? "button" : "div";
      return `<${tag}${tag === "button" ? ' type="button"' : ""} class="tr-qual" data-st="${c.st}"${canW ? ` data-tqual="${esc(c.g.fam)}"` : ""}>
        <span class="tr-qh"><b>${esc(famShort(c.g))}</b>${stChip(c)}${c.req ? "" : '<small class="tr-src">보유</small>'}</span>
        <span class="tr-qd">${esc(stText(c))}</span>
        ${c.r ? `<span class="tr-qm"><span class="mono">${esc(dot(c.r.date))}</span> ${esc(lastC ? lastC.name : "")}${c.r.org ? " · " + esc(c.r.org) : ""}</span>` : ""}
        ${files.length ? `<span class="au-files">${fileChips(files)}</span>` : ""}
      </${tag}>`;
    };
    const quals = pq.req.concat(pq.held);
    const qualCard = `<section class="card tr-pcard" aria-label="자격 현황">
        <h2 class="card-title">자격 현황<span class="dc-meta">${pq.req.length ? "필수 " + pq.req.length : "필수 과정 없음"}${pq.held.length ? " · 보유 " + pq.held.length : ""}</span></h2>
        ${quals.length ? `<div class="tr-quals">${quals.map(qual).join("")}</div>` : ui.empty(rolesOf(p).length ? "직무에 해당하는 과정이 없습니다." : "직무를 지정하면 필수 과정이 표시됩니다.")}
      </section>`;
    const histCard = `<section class="card tr-pcard" aria-label="이수 이력">
        <h2 class="card-title">이수 이력<span class="dc-meta">${rs.length}건</span></h2>
        ${rs.length ? `<ul class="tr-hist">${rs.map(r => {
          const c = courseOf(r.cid), exp = expireOf(r);
          const tag = canW ? "button" : "div";
          return `<li><${tag}${tag === "button" ? ` type="button" data-rid="${esc(r.id)}"` : ""} class="tr-hrow">
            <span class="tr-hd mono">${esc(dot(r.date))}</span>
            <span class="tr-hn"><b>${esc(c ? c.name : "과정 없음")}</b><small>${esc([c ? c.kind : "", r.hours != null && r.hours !== "" ? r.hours + "시간" : "", r.org, r.certNo ? "No. " + r.certNo : "", r.sessionId ? "당사 교육 기록" : ""].filter(Boolean).join(" · "))}</small></span>
            <span class="tr-he mono">${c && c.step ? "단계" : exp ? "~" + esc(ymd2(exp)) : "영구"}</span>
          </${tag}>${filesOf(r.files).length ? `<div class="au-files">${fileChips(r.files)}</div>` : ""}</li>`;
        }).join("")}</ul>` : ui.empty("등록된 이수 기록이 없습니다.")}
      </section>`;
    const m = pledgeMatch(p);
    const ssiCard = `<section class="card tr-pcard" aria-label="SSI 서약">
        <h2 class="card-title">SSI 서약${isSSI(p) ? "" : '<span class="dc-meta">SSI 취급자 아님</span>'}</h2>
        <dl class="tr-dl">
          <div><dt>서약일</dt><dd>${pi.date ? `<span class="mono">${esc(dot(pi.date))}</span>${pi.src === "semis" ? ' <small class="tr-src">SeMIS</small>' : ' <small class="tr-src">직접 입력</small>'}` : isSSI(p) ? ui.chip(pi.ambiguous ? "동명이인 확인" : "누락", pi.ambiguous ? "amber" : "red") : "-"}</dd></div>
          <div><dt>SeMIS 명단</dt><dd>${!PL.rows ? '<span class="cell-sub">불러오는 중</span>' : !m ? "명단에 없음" : m.ambiguous ? `같은 이름 ${m.n}명 — 소속으로 구분되지 않음` : `${esc(dot(m.date))} · ${esc(m.dept || "-")} · ${esc((PL_STATE[m.state] || PL_STATE.valid)[0])}`}</dd></div>
        </dl>
        ${filesOf(p.pledgeFiles).length ? `<div class="au-files">${fileChips(p.pledgeFiles)}</div>` : ""}
      </section>`;
    const roleCard = `<section class="card tr-pcard" aria-label="직무">
        <h2 class="card-title">직무</h2>
        ${rolesOf(p).length ? `<ul class="tr-roles">${sortRoles(rolesOf(p)).map(r => { const d = roleDef(r), g = rgOf(r);
          return `<li class="rg-${g.id}"><b>${rgDot(g)}${esc(r)}</b><small>${esc(g.id === "etc" ? (d ? d.basis : "사내 직무") : g.label + (d ? " · " + d.basis : ""))}</small></li>`; }).join("")}</ul>` : ui.empty("지정된 직무가 없습니다.")}
      </section>`;
    const infoCard = `<section class="card tr-pcard" aria-label="기본 정보">
        <h2 class="card-title">기본 정보</h2>
        <dl class="tr-dl">
          <div><dt>소속</dt><dd>${esc(p.dept || "-")}</dd></div>
          <div><dt>상태</dt><dd>${a ? "재직" : `퇴직 · 전출 <span class="mono">${esc(dot(p.left))}</span> · 기록 보관 ~<span class="mono">${esc(dot(addDays(p.left, KEEP_LEFT_DAYS)))}</span>`}</dd></div>
          ${p.note ? `<div><dt>메모</dt><dd>${esc(p.note)}</dd></div>` : ""}
        </dl>
      </section>`;
    root.innerHTML = head + `<div class="print-only tr-pcap"><b>개인 교육훈련 기록</b><span>기준일 ${esc(dot(t))}</span></div>
      <div class="tr-pgrid"><div class="tr-pmain">${qualCard}${histCard}</div><div class="tr-pside">${ssiCard}${roleCard}${infoCard}</div></div>`;
    $$("[data-tback]", root).forEach(b => b.onclick = backToList);
    const rb = $("#tr-prec", root); if (rb) rb.onclick = () => recordForm(p.id, "", "");
    const pb = $("#tr-ppl", root); if (pb) pb.onclick = () => pledgeForm(p.id);
    const eb = $("#tr-pedit", root); if (eb) eb.onclick = () => personForm(p.id);
    if (canW) {
      $$("[data-tqual]", root).forEach(b => b.onclick = (ev) => { if (ev.target.closest("a")) return; openCell(p.id + "|" + b.dataset.tqual); });
      $$("[data-rid]", root).forEach(b => b.onclick = (ev) => { if (ev.target.closest("a")) return; recordForm(p.id, b.dataset.rid, ""); });
    }
  }

  /* ═════════ 교육 기록 (목록 · 기록 화면) ═════════ */
  function sessionsHTML(canW) {
    const t = todayISO();
    const all = sessions();
    const years = Array.from(new Set(all.map(s => String(s.date || "").slice(0, 4)).filter(Boolean))).sort().reverse();
    if (year && years.indexOf(year) < 0) year = "";
    const own = all.filter(s => s.type !== "vendor"), ven = all.filter(s => s.type === "vendor");
    const full = own.filter(s => !missing(s).length).length;
    const old = all.filter(s => keepOver(s, t)).length;
    return ui.stats([
      { label: "당사 실시 (1년)", value: own.filter(s => within12(s.date, t)).length, sub: "전체 " + own.length },
      { label: "기록 8항목 완비", value: own.length ? full + "/" + own.length : "-", tone: own.length ? (full === own.length ? "ok" : "warn") : "muted" },
      { label: "협력사 확인 (1년)", value: ven.filter(s => within12(s.date, t)).length, sub: "전체 " + ven.length },
      { label: "보관 " + KEEP_YEARS + "년 경과", value: old, tone: old ? "warn" : "muted" }
    ]) + `<section class="card" id="tr-slist">
      <div class="toolbar">
        ${ui.search("tr-q", "교육명 · 업체 · 교관 검색", q)}
        ${segHTML("stype", [["all", "전체"], ["own", "당사 실시"], ["vendor", "협력사 확인"]], sType)}
        ${years.length ? `<label class="ck-f"><span class="m-hide">연도</span><select id="tr-year" aria-label="연도"><option value="">전체 연도</option>${years.map(y => `<option value="${y}" ${year === y ? "selected" : ""}>${y}</option>`).join("")}</select></label>` : ""}
      </div>
      <div id="tr-sbody">${sessionsBody(t)}</div>
    </section>`;
  }
  function sessionsBody(t) {
    const all = sessions();
    const rows = all.filter(s => {
      if (year && String(s.date || "").slice(0, 4) !== year) return false;
      if (sType === "own" && s.type === "vendor") return false;
      if (sType === "vendor" && s.type !== "vendor") return false;
      return !q || hay([sessionTitle(s), s.place, s.instructor, s.vendor, s.note, s.evalText]).indexOf(q.toLowerCase()) >= 0;
    }).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!rows.length) return ui.empty(all.length ? "조건에 맞는 기록이 없습니다." : "등록된 교육 기록이 없습니다.");
    const recChip = (s) => {
      if (s.type === "vendor") return sfiles(s, "roster").length || sfiles(s, "eval").length ? ui.chip("결과 첨부", "green") : ui.chip("결과 없음", "amber");
      const miss = missing(s);
      return miss.length ? ui.chip("누락 " + miss.length, "amber") : ui.chip("8항목 완비", "green");
    };
    const nOf = (s) => s.type === "vendor" ? (num(s.done) != null ? `${num(s.done)}${num(s.target) != null ? "/" + num(s.target) : ""}명` : num(s.target) != null ? "대상 " + num(s.target) + "명" : "-")
      : (filesOf(s.pids).length ? filesOf(s.pids).length + "명" : "-");
    if (mob()) return `<ul class="tr-mlist">${rows.map(s => `<li><button type="button" class="tr-mrow" data-sid="${esc(s.id)}">
        <span class="tr-mn"><b>${esc(sessionTitle(s))}</b><small>${esc(s.type === "vendor" ? "협력사 확인" : "당사 실시")}</small></span>
        <span class="tr-ms">${recChip(s)}</span>
        <span class="tr-mx mono">${esc(dot(s.date))} · ${esc(nOf(s))}</span></button></li>`).join("")}</ul>`;
    return `<div class="table-wrap"><table class="tbl tbl-cap tr-stbl" style="--cap:1320px">
      <thead><tr><th>일자</th><th>교육</th><th>구분</th><th>인원</th><th>기록</th></tr></thead>
      <tbody>${rows.map(s => {
        const v = s.type === "vendor", miss = v ? [] : missing(s);
        return `<tr data-sid="${esc(s.id)}" tabindex="0" class="is-click">
          <td class="c-date"><span class="mono">${esc(dot(s.date))}</span>${keepOver(s, t) ? `<div class="cell-sub">보관 ${KEEP_YEARS}년 경과</div>` : ""}</td>
          <td class="c-name" data-role="title"><b>${esc(sessionTitle(s))}</b>${!v && (s.place || s.instructor) ? `<div class="cell-sub">${esc([s.place, s.instructor ? "교관 " + s.instructor : ""].filter(Boolean).join(" · "))}</div>` : ""}</td>
          <td class="c-kind">${v ? ui.chip("협력사 확인", "blue") : ui.chip("당사 실시", "gray")}</td>
          <td class="c-n mono">${esc(nOf(s))}</td>
          <td class="c-rec">${miss.length ? `<span class="tr-miss">${recChip(s)}<small>${esc(miss.join(" · "))}</small></span>` : recChip(s)}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function sessionPage(root, canW) {
    const s = sessionOf(sid);
    const v = s.type === "vendor";
    const c = courseOf(s.cid);
    const head = `<div class="page-head tr-head">
        <button type="button" class="btn btn-ghost btn-sm tr-back" data-keep data-tback aria-label="교육 기록 목록으로">${icon("chevl", 16)}<span>교육 기록</span></button>
        <div class="page-title">${esc(sessionTitle(s))}</div><span class="page-meta">${esc((v ? "협력사 확인 · " : "당사 실시 · ") + dot(s.date))}</span>
        <span class="spacer"></span>
        ${canW ? `<button type="button" class="btn btn-primary btn-sm" id="tr-sedit">${icon("edit", 16)}<span>수정</span></button>` : ""}
      </div>`;
    const fileRow = (label, k) => `<div><dt>${esc(label)}</dt><dd>${sfiles(s, k).length ? `<span class="au-files">${fileChips(sfiles(s, k))}</span>` : '<span class="cell-sub">없음</span>'}</dd></div>`;
    let body;
    if (v) {
      body = `<section class="card tr-pcard"><h2 class="card-title">협력사 교육 확인</h2>
        <dl class="tr-dl">
          <div><dt>업체</dt><dd>${esc(s.vendor || "-")}</dd></div>
          <div><dt>과정</dt><dd>${esc(c ? c.name : "-")}${c ? " " + legalChip(legalOf(c)) : ""}</dd></div>
          <div><dt>확인일</dt><dd class="mono">${esc(dot(s.date))}</dd></div>
          ${s.time ? `<div><dt>교육 일자 · 기간</dt><dd>${esc(s.time)}</dd></div>` : ""}
          <div><dt>대상 / 이수</dt><dd class="mono">${esc(num(s.target) != null ? num(s.target) : "-")} / ${esc(num(s.done) != null ? num(s.done) : "-")}</dd></div>
          ${fileRow("결과 · 명단", "roster")}
          ${s.note ? `<div><dt>메모</dt><dd>${esc(s.note)}</dd></div>` : ""}
        </dl></section>`;
    } else {
      const ok = (f) => f(s) ? `<span class="tr-ok">${icon("check", 14)}</span>` : `<span class="tr-no">${ui.chip("누락", "amber")}</span>`;
      const val = { "명칭": esc(sessionTitle(s)), "일시": esc([dot(s.date), s.time].filter(Boolean).join(" ")), "장소": esc(s.place || ""), "시간": s.hours != null && s.hours !== "" ? esc(s.hours + "시간") : "",
        "교관": esc(s.instructor || ""), "시간표": fileChips(sfiles(s, "tt")), "평가결과": esc(s.evalText || "") + (sfiles(s, "eval").length ? " " + fileChips(sfiles(s, "eval")) : ""),
        "참석자 명단 · 서명": fileChips(sfiles(s, "roster")) };
      const att = filesOf(s.pids).map(id => personOf(id)).filter(Boolean);
      body = `<div class="tr-pgrid"><div class="tr-pmain">
        <section class="card tr-pcard"><h2 class="card-title">교육 기록 8항목<span class="dc-meta">교육훈련지침 제32조 · ${EIGHT.length - missing(s).length}/${EIGHT.length}</span></h2>
          <ul class="tr-eight">${EIGHT.map(([k, f]) => `<li>${ok(f)}<b>${esc(k)}</b><span>${val[k] || ""}</span></li>`).join("")}</ul>
        </section></div>
        <div class="tr-pside">
        <section class="card tr-pcard"><h2 class="card-title">참석자<span class="dc-meta">${att.length}명</span></h2>
          ${att.length ? `<p class="tr-att">${att.map(p => `<button type="button" class="tbl-open" data-tperson="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</p>` : ui.empty("참석자가 없습니다.")}
          ${c ? `<p class="tr-semis">과정: ${esc(c.name)} — 참석자 이수 기록에 함께 반영</p>` : ""}
        </section>
        ${s.note ? `<section class="card tr-pcard"><h2 class="card-title">메모</h2><p class="tr-note">${esc(s.note)}</p></section>` : ""}
        </div></div>`;
    }
    root.innerHTML = head + body;
    $$("[data-tback]", root).forEach(b => b.onclick = backToList);
    const eb = $("#tr-sedit", root); if (eb) eb.onclick = () => sessionForm(s.id);
    $$("[data-tperson]", root).forEach(b => b.onclick = () => openPerson(b.dataset.tperson));
  }

  /* ═════════ 직무 · 과정 기준표 ═════════ */
  function catalogHTML(canW) {
    const t = todayISO();
    const ps = people().filter(p => active(p, t));
    const cs = courses();
    const usedRoles = allRoles();
    const courseRows = (list) => `<div class="table-wrap"><table class="tbl tr-cat" data-no-stack>
        <thead><tr><th>과정</th><th>구분</th><th>최소 시간</th><th>주기 · 유효기간</th><th>교육기관</th></tr></thead>
        <tbody>${list.map(c => `<tr><td><b>${esc(c.name)}</b>${c.basis ? `<div class="cell-sub">${esc(c.basis)}</div>` : ""}</td>
          <td class="c-k">${esc(c.kind || "")}</td><td>${esc(c.hours || "-")}</td>
          <td>${isPerm(c) ? ui.chip("영구", "blue") + " " : ""}${esc(isPerm(c) ? "1회" : cycleText(c))}</td><td>${esc(c.org || "-")}</td></tr>`).join("")}</tbody></table></div>`;
    const mList = (list) => `<ul class="tr-catm">${list.map(c => `<li><b>${esc(c.name)}</b>
        <span>${isPerm(c) ? ui.chip("영구", "blue") : ""}${esc([c.kind, c.hours, isPerm(c) ? "1회" : cycleText(c)].filter(Boolean).join(" · "))}</span>
        ${c.basis ? `<small>${esc(c.basis)}</small>` : ""}${c.org ? `<small>${esc(c.org)}</small>` : ""}</li>`).join("")}</ul>`;
    const rows = (list) => (mob() ? mList(list) : courseRows(list));
    /* 직무 한 줄 요약 — 누르면 근거 · 자격 조건 · 주요 역할 · 과정 */
    const cycSum = (list, d) => {
      const q2 = list.filter(c => !c.step);
      if (!q2.length) return d && d.pledge ? "보안서약" : "-";
      if (q2.every(isPerm)) return "1회 · 영구";
      const r = q2.find(c => c.kind === "정기") || q2.find(c => !isPerm(c));
      return cycleText(r);
    };
    const roleRow = (r) => {
      const d = roleDef(r) || { id: r, grp: "own", basis: "", qual: "", duty: "" };
      const list = cs.filter(c => !c.vendor && (c.roles || []).map(x => ROLE_ALIAS[x] || x).indexOf(r) >= 0);
      const n = ps.filter(p => rolesOf(p).indexOf(r) >= 0).length;
      const lg = d.grp === "intl" ? "intl" : d.grp === "own" ? "own" : "law";
      const hit = !!q && hay([r, d.basis, d.qual, d.duty, list.map(c => c.name + " " + (c.org || "")).join(" ")]).indexOf(q.toLowerCase()) >= 0;
      if (q && !hit) return "";
      const g = rgOf(r);
      return `<details class="tr-rd rg-${g.id}"${hit ? " open" : ""}>
        <summary><span class="tr-rn">${rgDot(g)}<b>${esc(r)}</b>${legalChip(lg)}${d.check ? ui.chip("확인 필요", "amber") : ""}</span>
          <span class="tr-rc">${esc(cycSum(list, d))}</span><span class="tr-rp">인원 <b class="mono">${n}</b></span>${icon("chevdown", 18)}</summary>
        <div class="tr-rb">
          <dl class="tr-dl tr-rdl">
            ${d.basis ? `<div><dt>근거</dt><dd>${esc(d.basis)}</dd></div>` : ""}
            ${d.who ? `<div><dt>지정 · 대상</dt><dd>${esc(d.who)}</dd></div>` : ""}
            ${d.qual ? `<div><dt>자격 조건</dt><dd>${esc(d.qual)}</dd></div>` : ""}
            ${d.duty ? `<div><dt>주요 역할</dt><dd>${esc(d.duty)}</dd></div>` : ""}
          </dl>
          ${list.length ? rows(list) : d.pledge ? '<p class="tr-semis">교육 과정 없음 — 개인 화면 · SSI 서약 탭에서 서약으로 관리</p>' : '<p class="tr-semis">연결된 과정 없음</p>'}
        </div></details>`;
    };
    const groups = GROUPS.map(([gk, gl]) => {
      const rs = sortRoles(usedRoles.filter(r => (roleDef(r) ? roleDef(r).grp : "own") === gk));
      const html = rs.map(roleRow).join("");
      return html ? `<section class="card tr-rgcard" aria-label="${esc(gl)}"><h2 class="card-title">${esc(gl)}<span class="dc-meta">${rs.length}개 직무</span></h2><div class="tr-rds">${html}</div></section>` : "";
    }).join("");
    const free = cs.filter(c => !c.vendor && !(c.roles || []).length);
    const ven = cs.filter(c => c.vendor);
    const fq = (list) => list.filter(c => !q || hay([c.name, c.basis, c.org]).indexOf(q.toLowerCase()) >= 0);
    const extra = (title, list, note) => list.length ? `<details class="tr-rd"${q ? " open" : ""}>
        <summary><span class="tr-rn"><b>${esc(title)}</b></span><span class="tr-rc">${list.length}개 과정</span><span class="tr-rp"></span>${icon("chevdown", 18)}</summary>
        <div class="tr-rb">${note ? `<p class="tr-semis">${esc(note)}</p>` : ""}${rows(list)}</div></details>` : "";
    const ex = extra("직무 지정 없는 과정", fq(free), "이수하면 개인 화면에 '보유'로 표시 (영구 과정 포함)") + extra("협력사 교육 확인 과정", fq(ven), "협력사는 개인 명부 없이 업체별 확인 기록으로 관리");
    return `<section class="card tr-rules"${ui.mf("rules", false)}>
        <header class="mf-h tr-rch"><b>공통 규칙</b><span class="dc-meta">국가민간항공보안 교육훈련지침 (국토교통부 예규 제379호)</span></header>
        <ul class="tr-rl">
          <li><b>정기교육</b><span>수료일 · 자격인증일부터 1년 안. 1년이 되는 날 전후 30일이 이수 기간 — 그 안에 이수하면 종전 유효기한 다음 날부터 1년 (제13조①~③)</span></li>
          <li><b>자격 정지</b><span>정기교육을 못 하면 업무 수행자격 정지, 정지 후 6개월 안에 정기교육으로 회복 (제13조④)</span></li>
          <li><b>위탁 의무</b><span>보안검색감독자 · 보안검색요원은 국토부 지정 보안검색교육기관 (항공보안법 제28조② · 제12조①)</span></li>
          <li><b>평가</b><span>출석 90% 이상 · 80점 이상 (교관 · 감독자 초기 · 검색요원 과정 등, 제11조② · 제12조②)</span></li>
          <li><b>기록 보관</b><span>8항목 기록 3년, 퇴직 후 90일 (제32조)</span></li>
          <li><b>위험물</b><span>24개월 이내 보수교육 — 만료 3개월 안 이수 시 기존 만료일 기준 연장 (항공위험물운송기술기준 제12조②)</span></li>
        </ul>
      </section>
      <div class="toolbar tr-ctool">${ui.search("tr-q", "직무 · 과정 · 근거 검색", q)}
        <span class="tr-rglg is-key" aria-label="직무군 색">${RGROUPS.map(g => `<span class="tr-rgk">${rgDot(g)}${esc(g.label)}</span>`).join("")}</span></div>
      <div id="tr-cbody">${groups}${ex ? `<section class="card tr-rgcard" aria-label="그 밖의 과정"><h2 class="card-title">그 밖의 과정</h2><div class="tr-rds">${ex}</div></section>` : ""}
        ${q && !groups && !ex ? ui.empty("검색 결과가 없습니다.") : ""}</div>`;
  }

  /* ═════════ SSI 서약 (SeMIS v2 보안서약서 명단 조회) ═════════ */
  function pledgesHTML(canW) {
    if (!PL.rows) return PL.err
      ? ui.empty("SeMIS 보안서약서 명단을 불러오지 못했습니다.", '<button type="button" class="btn btn-soft btn-sm" data-plretry="1">다시 시도</button>')
      : ui.empty("SeMIS 보안서약서 명단을 불러오는 중입니다.");
    const t = todayISO();
    const team = people().filter(p => active(p, t));
    const ssi = team.filter(isSSI);
    const miss = ssi.filter(p => !pledged(p));
    const mine = new Set(team.map(p => { const m = pledgeMatch(p); return m && !m.ambiguous ? m : null; }).filter(Boolean));
    const inTeam = (r) => mine.has(r) || /인천\s*화물/.test(r.dept);
    const base = PL.rows.filter(r => plScope === "all" || inTeam(r));
    const rows = base.filter(r => (plState === "all" || r.state === "valid")
      && (!q || hay([r.name, r.dept, r.position]).indexOf(q.toLowerCase()) >= 0))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.name).localeCompare(String(b.name), "ko"));
    const valid = PL.rows.filter(r => r.state === "valid").length;
    const scopeLb = plScope === "all" ? "전사" : "인천화물팀";
    const who = (p) => `<button type="button" class="tbl-open" data-tperson="${esc(p.id)}">${esc(p.name)}</button>`;
    return ui.stats([
      { label: "전사 유효 서약자", value: valid, sub: "SeMIS 명단" },
      { label: "인천화물팀 서약", value: PL.rows.filter(r => inTeam(r) && r.state === "valid").length, sub: "명단 대조 · 소속" },
      { label: "SSI 취급자 서약", value: ssi.length ? (ssi.length - miss.length) + "/" + ssi.length : "-", tone: miss.length ? "bad" : ssi.length ? "ok" : "muted" },
      { label: "서약 누락", value: miss.length, sub: "SSI 취급자", tone: miss.length ? "bad" : "ok" }
    ]) + (miss.length ? `<section class="card tr-due no-print"><div class="tr-sh"><h3>서약 누락 — SSI 취급자</h3><span class="tr-cnt mono">${miss.length}</span></div>
        <p class="tr-plmiss">${miss.map(p => `<span>${who(p)}${pledgeInfo(p).ambiguous ? ' <small class="tr-semis is-warn">동명이인</small>' : ""}</span>`).join("")}</p></section>` : "")
      + `<section class="card" id="tr-pllist">
        <div class="toolbar no-print">
          ${ui.search("tr-q", "이름 · 소속 · 직위 검색", q)}
          ${segHTML("plscope", [["team", "인천화물팀"], ["all", "전사"]], plScope)}
          ${segHTML("plstate", [["valid", "유효"], ["all", "전체"]], plState)}
        </div>
        <div id="tr-plbody" class="no-print">${rows.length ? `<div class="table-wrap"><table class="tbl tbl-cap tr-pltbl" style="--cap:1180px">
          <thead><tr><th class="c-no">번호</th><th>서약일</th><th>성명</th><th>소속</th><th>직위</th><th>상태</th></tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td class="c-no mono">${i + 1}</td><td class="c-date mono">${esc(dot(r.date))}</td>
            <td class="c-name"><b>${esc(r.name)}</b>${r.n > 1 ? ` <small class="tr-src" title="서약 ${r.n}회">재서약 ${r.n - 1}</small>` : ""}</td>
            <td class="c-dept">${esc(r.dept || "-")}</td><td class="c-pos">${esc(r.position || "-")}</td>
            <td class="c-st">${ui.chip((PL_STATE[r.state] || PL_STATE.valid)[0], (PL_STATE[r.state] || PL_STATE.valid)[1])}</td></tr>`).join("")}</tbody></table></div>`
          : ui.empty(base.length ? "조건에 맞는 서약이 없습니다." : "서약 기록이 없습니다.")}
          <p class="tr-plnote m-hide">사번 · 서명이 들어간 국토부 제출용 명단은 SeMIS v2 '비밀 취급 / SSI'에서 출력합니다.</p></div>
        <div class="print-only tr-plprint">
          <div class="tr-plcap"><b>보안서약서 작성자 명단 — ${esc(scopeLb)}</b><span>기준일 ${esc(dot(t))} · ${rows.length}명${plState === "all" ? " · 상태 전체" : ""}</span></div>
          <table class="tr-plptbl"><thead><tr><th style="width:9%">번호</th><th style="width:28%">소속</th><th style="width:17%">직위</th><th style="width:18%">성명</th><th style="width:16%">서약일</th><th style="width:12%">상태</th></tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.dept)}</td><td>${esc(r.position)}</td><td><b>${esc(r.name)}</b></td><td class="c">${esc(dot(r.date))}</td><td class="c">${esc((PL_STATE[r.state] || PL_STATE.valid)[0])}</td></tr>`).join("")}</tbody></table>
        </div>
      </section>`;
  }

  /* ═════════ 폼 공통 ═════════ */
  const fld = (idn, label, html, tip) => `<div class="form-row"><label for="${idn}">${esc(label)}${tip ? " " + ui.tip(tip, label + " 설명") : ""}</label>${html}</div>`;
  const dl = (id, vals) => `<datalist id="${id}">${vals.filter(Boolean).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const uniq = (a) => a.map(norm).filter((s, i, all) => s && all.indexOf(s) === i);
  async function uploadInto(files, fileList, done) {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    if (!window.SemisSync || !SemisSync.uploadFile) { toast("오프라인에서는 올릴 수 없습니다.", true); return; }
    for (const file of list) {
      if (file.size > FILE_MAX) { toast(file.name + ": 50MB를 넘습니다.", true); continue; }
      toast("올리는 중: " + file.name);
      try {
        const up = await SemisSync.uploadFile(file, FOLDER);
        files.push({ name: up.name || file.name, size: up.size || file.size || 0, url: up.url });
      } catch (e) { toast("올리지 못했습니다: " + file.name, true); }
    }
    if (done) done();
  }
  function fileBox(prefix, label) {
    return `<div class="form-row"><label>${esc(label)}</label>
      <div class="au-files au-files-edit" id="${prefix}-files"></div>
      <input type="file" id="${prefix}-file" multiple hidden>
      <button type="button" class="btn btn-ghost btn-sm" id="${prefix}-fbtn">${icon("link", 15)}<span>파일 올리기</span></button></div>`;
  }
  function wireFileBox(prefix, files) {
    const paint = () => {
      const box = $("#" + prefix + "-files");
      if (!box) return;
      box.innerHTML = files.map((f, i) => `<span class="au-file"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon("link", 14)}<span>${esc(f.name || "첨부")}</span></a><button type="button" class="mt-btn danger" data-fdel="${i}" aria-label="첨부 빼기">${icon("x", 14)}</button></span>`).join("");
      $$("[data-fdel]", box).forEach(b => b.onclick = () => { files.splice(Number(b.dataset.fdel), 1); paint(); });
    };
    paint();
    const inp = $("#" + prefix + "-file"), btn = $("#" + prefix + "-fbtn");
    if (btn && inp) {
      btn.onclick = () => inp.click();
      inp.onchange = () => { const fl = Array.from(inp.files || []); inp.value = ""; uploadInto(files, fl, paint); };
    }
  }
  const copyFiles = (a) => filesOf(a).map(f => Object.assign({}, f));
  const actions = (canDel) => `<div class="modal-actions">
      ${canDel ? '<button type="button" class="btn btn-danger" data-act="del">삭제</button><span class="spacer" style="flex:1"></span>' : ""}
      <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
      <button type="button" class="btn btn-primary" data-act="ok">저장</button>
    </div>`;
  /* 과정 고르기 — 묶음(법정 · 위험물 · 국제 · 사내)별 */
  function courseSel(id, list, cur, extra) {
    const grpOf = (c) => c.fam === "dgr" ? "dg" : legalOf(c);
    const g = [["law", "법정 (항공보안법 · 지침)"], ["dg", "위험물"], ["intl", "국제 기준"], ["own", "사내 · 기타"]];
    return `<select id="${id}">${extra || ""}${g.map(([k, lb]) => {
      const xs = list.filter(c => grpOf(c) === k || (k === "law" && grpOf(c) === "law"));
      return xs.length ? `<optgroup label="${esc(lb)}">${xs.map(c => `<option value="${esc(c.id)}" ${cur === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</optgroup>` : "";
    }).join("")}</select>`;
  }

  /* ─────── 인원 ─────── */
  function roleChooser(cur) {
    const have = cur.slice();
    const custom = allRoles().filter(r => !roleDef(r));
    const box = (r) => `<label class="ck-rc"><input type="checkbox" value="${esc(r)}" ${have.indexOf(r) >= 0 ? "checked" : ""}><span>${esc(r)}</span></label>`;
    /* 직무군(색)별 — 마지막 '기타'에 사내 직무가 붙는다(직접 입력도 여기로) */
    return RGROUPS.map(g => {
      const rs = g.id === "etc" ? ROLES.filter(r => rgOf(r) === g).concat(custom) : g.roles.slice();
      return `<div class="tr-rgrp rg-${g.id}"><small>${rgDot(g)}${esc(g.label)}</small><div class="ck-rchoose">${rs.map(box).join("")}</div></div>`;
    }).join("");
  }
  function personForm(id) {
    if (!SeMIS.canEdit()) return;
    const x = id ? personOf(id) : null;
    if (id && !x) return;
    const v = Object.assign({ name: "", dept: "인천화물팀", left: "", note: "" }, x || {});
    const rs = x ? records().filter(r => r.pid === x.id) : [];
    const depts = uniq(["인천화물팀"].concat(people().map(p => p.dept)));
    openModal(`<h3>${x ? "인원 정보 수정" : "인원 등록"}</h3>
      <div class="form-grid">
        ${fld("tp-name", "이름", `<input id="tp-name" value="${esc(v.name)}" maxlength="30" autocomplete="off">`)}
        ${fld("tp-dept", "소속", `<input id="tp-dept" value="${esc(v.dept)}" maxlength="40" autocomplete="off" list="tp-dl-dept">`)}
      </div>
      <div class="form-row"><label>직무 ${ui.tip("직무에 맞는 필수 과정이 자격 현황에 표시됩니다. 직무별 근거 · 자격 조건은 '직무 · 과정' 탭에 있습니다.", "직무 설명")}</label>
        <div id="tp-roles">${roleChooser(x ? rolesOf(x) : [])}</div>
        <input id="tp-role-add" class="tr-roleadd" maxlength="20" autocomplete="off" placeholder="사내 직무 직접 입력 후 Enter"></div>
      ${fld("tp-left", "퇴직 · 전출일", `<input type="date" id="tp-left" value="${esc(v.left)}">`, "교육 기록은 퇴직 · 전출 후 " + KEEP_LEFT_DAYS + "일까지 보관합니다(교육훈련지침 제32조).")}
      ${fld("tp-note", "메모", `<input id="tp-note" value="${esc(v.note)}" maxlength="200">`)}
      ${dl("tp-dl-dept", depts)}
      ${actions(!!x && SeMIS.canDelete())}`, { wide: true });
    const ra = $("#tp-role-add");
    ra.onkeydown = (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const r = norm(ROLE_ALIAS[norm(ra.value)] || ra.value);
      if (!r) return;
      const all = $$("#tp-roles input");
      if (!all.some(i => i.value === r)) {
        let own = $("#tp-roles .tr-rgrp:last-child .ck-rchoose");
        if (!own) { $("#tp-roles").insertAdjacentHTML("beforeend", `<div class="tr-rgrp rg-etc"><small>${rgDot(rgById("etc"))}기타</small><div class="ck-rchoose"></div></div>`); own = $("#tp-roles .tr-rgrp:last-child .ck-rchoose"); }
        own.insertAdjacentHTML("beforeend", `<label class="ck-rc"><input type="checkbox" value="${esc(r)}" checked><span>${esc(r)}</span></label>`);
      } else all.forEach(i => { if (i.value === r) i.checked = true; });
      ra.value = "";
    };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      const rec = { name: norm($("#tp-name").value), dept: norm($("#tp-dept").value), roles: $$("#tp-roles input:checked").map(i => i.value),
        left: $("#tp-left").value || "", note: norm($("#tp-note").value) };
      if (!rec.name) { toast("이름을 입력하세요.", true); $("#tp-name").focus(); return; }
      const t = T();
      let p = x;
      if (p) Object.assign(p, rec); else { p = Object.assign({ id: uid("tp"), pledge: "", pledgeFiles: [], createdAt: new Date().toISOString(), createdBy: me() }, rec); t.people.push(p); }
      stamp(p); SeMIS.save(); closeModal(); toast("저장했습니다.");
      if (!x) { openPerson(p.id); return; }
      paint();
    };
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`${x.name} 님과 이수 기록 ${rs.length}건을 삭제합니다.`, () => {
      const t = T();
      t.people = t.people.filter(p => p.id !== x.id);
      t.records = t.records.filter(r => r.pid !== x.id);
      t.sessions.forEach(s => { if (Array.isArray(s.pids)) s.pids = s.pids.filter(i => i !== x.id); });
      SeMIS.save(); toast("삭제했습니다.");
      if (pid === x.id) backToList(); else paint();
    });
  }
  /* SSI 서약 등록 — 명단(SeMIS)에 없는 서약(종이 등)의 날짜 · 서약서 */
  function pledgeForm(id) {
    if (!SeMIS.canEdit()) return;
    const p = personOf(id);
    if (!p) return;
    const pf = copyFiles(p.pledgeFiles);
    openModal(`<h3>SSI 서약 등록 <small class="au-mh">${esc(p.name)}</small></h3>
      ${fld("tp-pledge", "서약일", `<input type="date" id="tp-pledge" value="${esc(p.pledge || "")}">${semisLine(p)}`, "SeMIS 보안서약서 명단에 같은 이름의 서약이 있으면 그 서약일을 씁니다. 명단에 없는 서약(종이 등)만 입력합니다.")}
      ${fileBox("tpf", "서약서")}
      ${isSSI(p) ? "" : `<label class="ck-rc tr-ssiadd"><input type="checkbox" id="tp-ssi" checked><span>직무에 SSI 취급자 추가</span></label>`}
      ${actions(false)}`);
    wireFileBox("tpf", pf);
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    $("#modal-box [data-act=ok]").onclick = () => {
      p.pledge = $("#tp-pledge").value || "";
      p.pledgeFiles = pf.slice();
      const add = $("#tp-ssi");
      if (add && add.checked && !isSSI(p)) p.roles = rolesOf(p).concat(["SSI 취급자"]);
      stamp(p); SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }
  function semisLine(x) {
    if (!x) return "";
    const m = pledgeMatch(x);
    if (!m) return PL.rows ? '<small class="tr-semis">SeMIS 명단에 없음</small>' : "";
    if (m.ambiguous) return `<small class="tr-semis is-warn">SeMIS 명단에 같은 이름 ${m.n}명 — 소속으로 구분되지 않음</small>`;
    return `<small class="tr-semis">SeMIS ${esc(dot(m.date))} · ${esc(m.dept || "-")} · ${esc((PL_STATE[m.state] || PL_STATE.valid)[0])}</small>`;
  }

  /* ─────── 이수 기록 ─────── */
  function recordForm(personId, rid, cidPreset) {
    if (!SeMIS.canEdit()) return;
    const fixedP = !!personId;
    let p = personId ? personOf(personId) : null;
    const x = rid ? records().find(r => r.id === rid) : null;
    if (rid && !x) return;
    const plist = people().filter(k => active(k) || (p && k.id === p.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    if (!p && !plist.length) { toast("인원을 먼저 등록하세요.", true); return; }
    if (!p) p = plist[0];
    const reqCid = () => {
      if (!p) return "";
      const pq = personQuals(p);
      const w = pq.req.slice().sort((a, b) => ST[b.st].lv - ST[a.st].lv)[0];
      if (!w) return "";
      return (w.st !== "none" && (w.g.courses.find(c => c.kind === "정기") || {}).id) || (w.g.courses.find(c => !c.step) || w.g.courses[0]).id;
    };
    const v = Object.assign({ cid: cidPreset || reqCid() || (ownCourses()[0] || {}).id || "", date: "", expire: "", hours: "", score: "", org: "", certNo: "", note: "" }, x || {});
    const files = copyFiles(v.files);
    const orgs = uniq(records().map(r => r.org).concat(courses().map(c => c.org)));
    const calcNow = () => previewExpire(p ? p.id : "", $("#tr-c").value, $("#tr-d").value, x ? x.id : "");
    let expTouched = !!(x && isISO(x.expire));
    openModal(`<h3>${x ? "이수 기록 수정" : "이수 등록"}${fixedP ? ` <small class="au-mh">${esc(p.name)}</small>` : ""}</h3>
      ${fixedP ? "" : fld("tr-p", "인원", `<select id="tr-p">${plist.map(k => `<option value="${esc(k.id)}">${esc(k.name)}${k.dept ? " · " + esc(k.dept) : ""}</option>`).join("")}</select>`)}
      ${fld("tr-c", "과정", courseSel("tr-c", ownCourses(), v.cid))}
      <div class="form-grid">
        ${fld("tr-d", "수료일", `<input type="date" id="tr-d" value="${esc(v.date)}">`)}
        ${fld("tr-e", "유효기한", `<input type="date" id="tr-e" value="${esc(isISO(v.expire) ? v.expire : "")}"><small class="tr-hint" id="tr-eh"></small>`, "과정 주기와 지침 제13조(이수 기간 안 이수 시 종전 유효기한 다음 날부터) 또는 위험물 기준으로 자동 계산합니다. 이수증에 적힌 날짜가 다르면 고쳐 쓰세요. 영구 과정은 비워 둡니다.")}
        ${fld("tr-h", "교육 시간", `<input type="number" id="tr-h" value="${esc(v.hours == null ? "" : v.hours)}" min="0" step="0.5" inputmode="decimal">`)}
        ${fld("tr-s", "평가 점수", `<input type="number" id="tr-s" value="${esc(v.score == null ? "" : v.score)}" min="0" max="100" inputmode="numeric">`)}
        ${fld("tr-o", "교육기관", `<input id="tr-o" value="${esc(v.org)}" maxlength="60" autocomplete="off" list="tr-dl-org">`)}
        ${fld("tr-n", "이수증 번호", `<input id="tr-n" value="${esc(v.certNo)}" maxlength="40" autocomplete="off">`)}
      </div>
      ${fileBox("trf", "이수증")}
      ${fld("tr-m", "메모", `<input id="tr-m" value="${esc(v.note)}" maxlength="200">`)}
      ${dl("tr-dl-org", orgs)}
      ${actions(!!x)}`, { wide: true });
    wireFileBox("trf", files);
    const ps = $("#tr-p");
    let courseTouched = !!cidPreset || !!x;
    if (ps) ps.onchange = () => { p = personOf(ps.value); if (!courseTouched) { const c0 = reqCid(); if (c0) $("#tr-c").value = c0; } autoExp(); };
    const hint = () => {
      const c = courseOf($("#tr-c").value), h = $("#tr-eh");
      if (!h) return;
      const cv = calcNow();
      h.textContent = !c ? "" : c.step ? "단계 과정 — 유효기한 없음" : isPerm(c) ? "영구 · 1회" : cv ? (($("#tr-e").value || "") === cv ? "자동 계산" : "계산값 " + dot(cv)) : "";
    };
    const autoExp = () => { if (!expTouched) $("#tr-e").value = calcNow(); hint(); };
    $("#tr-d").onchange = autoExp; $("#tr-c").onchange = () => { courseTouched = true; autoExp(); };
    $("#tr-e").oninput = () => { expTouched = true; hint(); };
    if (!x || !isISO(x.expire)) $("#tr-e").value = calcNow();
    hint();
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal("이 이수 기록을 삭제합니다.", () => { T().records = T().records.filter(r => r.id !== x.id); SeMIS.save(); toast("삭제했습니다."); paint(); });
    $("#modal-box [data-act=ok]").onclick = () => {
      if (!p) { toast("인원을 고르세요.", true); return; }
      const date = $("#tr-d").value || "";
      if (!isISO(date)) { toast("수료일을 입력하세요.", true); $("#tr-d").focus(); return; }
      const cid = $("#tr-c").value;
      const calc = calcNow(), e = $("#tr-e").value || "";
      const rec = { pid: p.id, cid, date, expire: isISO(e) && e !== calc ? e : "", hours: num($("#tr-h").value), score: num($("#tr-s").value),
        org: norm($("#tr-o").value), certNo: norm($("#tr-n").value), note: norm($("#tr-m").value), files: files.slice() };
      const t = T();
      if (x) Object.assign(x, rec); else t.records.push(Object.assign({ id: uid("tr"), createdAt: new Date().toISOString(), createdBy: me() }, rec));
      SeMIS.save(); closeModal(); toast("저장했습니다."); paint();
    };
  }

  /* ─────── 교육 기록 (당사 실시 · 협력사 확인) ─────── */
  function sessionForm(id, typePreset) {
    if (!SeMIS.canEdit()) return;
    const x = id ? sessionOf(id) : null;
    if (id && !x) return;
    const type = x ? (x.type === "vendor" ? "vendor" : "own") : (typePreset === "vendor" ? "vendor" : "own");
    const v = Object.assign({ cid: "", title: "", date: "", time: "", hours: "", place: "", instructor: "", evalText: "", pids: [],
      vendor: "", target: "", done: "", note: "" }, x || {});
    const fs = { tt: copyFiles(sfiles(v, "tt")), roster: copyFiles(sfiles(v, "roster")), eval: copyFiles(sfiles(v, "eval")) };
    const vendors = uniq(sessions().map(s => s.vendor));
    const pl = people().filter(p => active(p) || filesOf(v.pids).indexOf(p.id) >= 0).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    const body = type === "vendor" ? `
      <div class="form-grid">
        ${fld("ts-vendor", "업체", `<input id="ts-vendor" value="${esc(v.vendor)}" maxlength="40" autocomplete="off" list="ts-dl-v">`)}
        ${fld("ts-c", "과정", courseSel("ts-c", vendorCourses(), v.cid))}
        ${fld("ts-date", "확인일", `<input type="date" id="ts-date" value="${esc(v.date)}">`)}
        ${fld("ts-time", "교육 일자 · 기간", `<input id="ts-time" value="${esc(v.time)}" maxlength="40" placeholder="예: 9월 정기교육">`)}
        ${fld("ts-target", "대상 인원", `<input type="number" id="ts-target" value="${esc(v.target == null ? "" : v.target)}" min="0" inputmode="numeric">`)}
        ${fld("ts-done", "이수 인원", `<input type="number" id="ts-done" value="${esc(v.done == null ? "" : v.done)}" min="0" inputmode="numeric">`)}
      </div>
      ${fileBox("tsr", "결과 · 명단")}
      ${dl("ts-dl-v", vendors)}`
    : `
      <div class="form-grid">
        ${fld("ts-c", "과정", courseSel("ts-c", ownCourses(), v.cid, `<option value="">기타(과정 없음)</option>`))}
        ${fld("ts-title", "교육명", `<input id="ts-title" value="${esc(v.title)}" maxlength="80" autocomplete="off">`)}
        ${fld("ts-date", "일자", `<input type="date" id="ts-date" value="${esc(v.date)}">`)}
        ${fld("ts-time", "시각", `<input id="ts-time" value="${esc(v.time)}" maxlength="30" placeholder="예: 09:00~13:00">`)}
        ${fld("ts-hours", "교육 시간", `<input type="number" id="ts-hours" value="${esc(v.hours == null ? "" : v.hours)}" min="0" step="0.5" inputmode="decimal">`)}
        ${fld("ts-place", "장소", `<input id="ts-place" value="${esc(v.place)}" maxlength="60">`)}
        ${fld("ts-inst", "교관", `<input id="ts-inst" value="${esc(v.instructor)}" maxlength="40">`)}
        ${fld("ts-eval", "평가 결과", `<input id="ts-eval" value="${esc(v.evalText)}" maxlength="120" placeholder="예: 전원 합격(평균 92점)">`)}
      </div>
      <div class="form-row"><label>참석자 ${ui.tip("고른 인원에게 이 과정의 이수 기록이 함께 만들어집니다.", "참석자 설명")}</label>
        ${pl.length ? `<div class="ck-rchoose" id="ts-pids">${pl.map(p => `<label class="ck-rc"><input type="checkbox" value="${esc(p.id)}" ${filesOf(v.pids).indexOf(p.id) >= 0 ? "checked" : ""}><span>${esc(p.name)}</span></label>`).join("")}</div>`
          : '<p class="au-none">인원 탭에서 먼저 인원을 등록하세요.</p>'}</div>
      ${fileBox("tst", "시간표")}
      ${fileBox("tsr", "참석자 명단 · 서명")}
      ${fileBox("tse", "평가 결과")}`;
    openModal(`<h3>${x ? "교육 기록 수정" : type === "vendor" ? "협력사 교육 확인" : "당사 교육 기록"}</h3>
      ${!x ? segHTML("stypeform", [["own", "당사 실시"], ["vendor", "협력사 확인"]], type) : ""}
      ${body}
      ${fld("ts-note", "메모", `<input id="ts-note" value="${esc(v.note)}" maxlength="300">`)}
      ${actions(!!x)}`, { wide: true });
    $$("[data-tseg=stypeform]").forEach(b => b.onclick = () => { if (b.dataset.v !== type) sessionForm("", b.dataset.v); });
    if (type === "vendor") wireFileBox("tsr", fs.roster);
    else {
      wireFileBox("tst", fs.tt); wireFileBox("tsr", fs.roster); wireFileBox("tse", fs.eval);
      const ti = $("#ts-title"), cs = $("#ts-c");
      let titleTouched = !!norm(v.title) && v.title !== ((courseOf(v.cid) || {}).name || "");
      ti.oninput = () => { titleTouched = !!norm(ti.value); };
      cs.onchange = () => { if (!titleTouched) ti.value = (courseOf(cs.value) || {}).name || ""; };
      if (!x && !ti.value) ti.value = (courseOf(cs.value) || {}).name || "";
    }
    $("#modal-box [data-act=cancel]").onclick = closeModal;
    const del = $("#modal-box [data-act=del]");
    if (del) del.onclick = () => confirmModal(`교육 기록 "${sessionTitle(x)}"을(를) 삭제합니다.${x.type !== "vendor" && filesOf(x.pids).length ? " 이 기록으로 만든 참석자 이수 기록도 함께 지워집니다." : ""}`, () => {
      const t = T();
      t.sessions = t.sessions.filter(s => s.id !== x.id);
      t.records = t.records.filter(r => r.sessionId !== x.id);
      SeMIS.save(); toast("삭제했습니다.");
      if (sid === x.id) backToList(); else paint();
    });
    $("#modal-box [data-act=ok]").onclick = () => {
      const val = (i) => norm(($("#" + i) || {}).value);
      const date = ($("#ts-date") || {}).value || "";
      if (!isISO(date)) { toast((type === "vendor" ? "확인일" : "일자") + "을 입력하세요.", true); $("#ts-date").focus(); return; }
      let rec;
      if (type === "vendor") {
        if (!val("ts-vendor")) { toast("업체를 입력하세요.", true); $("#ts-vendor").focus(); return; }
        rec = { type, vendor: val("ts-vendor"), cid: $("#ts-c").value, date, time: val("ts-time"), target: num($("#ts-target").value), done: num($("#ts-done").value),
          files: { roster: fs.roster.slice() }, note: val("ts-note") };
      } else {
        const title = val("ts-title");
        if (!title) { toast("교육명을 입력하세요.", true); $("#ts-title").focus(); return; }
        rec = { type, cid: $("#ts-c").value, title, date, time: val("ts-time"), hours: num($("#ts-hours").value), place: val("ts-place"),
          instructor: val("ts-inst"), evalText: val("ts-eval"), pids: $$("#ts-pids input:checked").map(i => i.value),
          files: { tt: fs.tt.slice(), roster: fs.roster.slice(), eval: fs.eval.slice() }, note: val("ts-note") };
      }
      const t = T();
      let s = x;
      if (s) Object.assign(s, rec); else { s = Object.assign({ id: uid("ts"), createdAt: new Date().toISOString(), createdBy: me() }, rec); t.sessions.push(s); }
      stamp(s);
      syncSessionRecords(s);
      SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
    };
  }
  /* 당사 교육 기록의 참석자 → 개인 이수 기록(sessionId로 연결). 참석자에서 빼면 그 기록도 지운다 */
  function syncSessionRecords(s) {
    const t = T();
    if (s.type === "vendor" || !courseOf(s.cid)) { t.records = t.records.filter(r => r.sessionId !== s.id); return; }
    const pids = filesOf(s.pids);
    t.records = t.records.filter(r => r.sessionId !== s.id || pids.indexOf(r.pid) >= 0);
    pids.forEach(id => {
      let r = t.records.find(k => k.sessionId === s.id && k.pid === id);
      if (!r) { r = { id: uid("tr"), pid: id, sessionId: s.id, expire: "", score: null, org: "", certNo: "", note: "", files: [] }; t.records.push(r); }
      Object.assign(r, { cid: s.cid, date: s.date, hours: num(s.hours) });
    });
  }

  /* ─────── 과정 관리 (hq) — 목록 → 과정 한 개 편집 ─────── */
  function coursesForm() {
    if (!SeMIS.canEdit()) return;
    const list = courses().map(c => JSON.parse(JSON.stringify(c)));
    const used = (id) => records().some(r => r.cid === id) || sessions().some(s => s.cid === id);
    const paintList = () => {
      $("#tc-rows").innerHTML = list.map((c, i) => `<li><button type="button" class="tr-crow" data-ci="${i}">
        <span><b>${esc(c.name || "(이름 없음)")}</b><small>${esc([c.kind, cycleText(c), c.vendor ? "협력사" : (c.roles || []).join(", ") || (c.all ? "전 직원" : "직무 지정 없음")].filter(Boolean).join(" · "))}</small></span>
        ${isPerm(c) ? ui.chip("영구", "blue") : ""}${legalChip(legalOf(c))}</button></li>`).join("");
      $$("[data-ci]").forEach(b => b.onclick = () => editOne(Number(b.dataset.ci)));
    };
    const shell = () => {
      openModal(`<h3>과정 관리</h3>
        <ul class="tr-clist" id="tc-rows"></ul>
        <button type="button" class="btn btn-ghost btn-sm" id="tc-add">${icon("plus", 15)}<span>과정 추가</span></button>
        ${actions(false)}`, { wide: true });
      paintList();
      $("#tc-add").onclick = () => { list.push({ id: uid("c"), name: "", kind: "정기", fam: "", cycle: 12, rule: "kr", legal: "own", roles: [] }); editOne(list.length - 1); };
      $("#modal-box [data-act=cancel]").onclick = closeModal;
      $("#modal-box [data-act=ok]").onclick = () => {
        const out = list.filter(c => norm(c.name));
        if (!out.length) { toast("과정을 하나 이상 두세요.", true); return; }
        out.forEach(c => { if (!c.fam) c.fam = c.id; if (c.vendor) { c.roles = []; c.all = false; } });
        const t = T();
        t.courses = out;
        if (!t.catVer) t.catVer = CAT_VER;
        SeMIS.save(); closeModal(); paint(); toast("저장했습니다.");
      };
    };
    const editOne = (i) => {
      const c = list[i];
      const roleBox = sortRoles(allRoles()).map(r => `<label class="ck-rc rg-${rgOf(r).id}"><input type="checkbox" value="${esc(r)}" ${(c.roles || []).map(x => ROLE_ALIAS[x] || x).indexOf(r) >= 0 ? "checked" : ""}>${rgDot(rgOf(r))}<span>${esc(r)}</span></label>`).join("");
      openModal(`<h3>${c.name ? "과정 수정" : "과정 추가"}</h3>
        ${fld("tc-name", "과정 이름", `<input id="tc-name" value="${esc(c.name || "")}" maxlength="60">`)}
        <div class="form-grid">
          ${fld("tc-kind", "구분", `<select id="tc-kind">${KINDS.map(k => `<option ${c.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>`)}
          ${fld("tc-fam", "묶음", `<input id="tc-fam" value="${esc(c.fam || "")}" maxlength="20" list="tc-dl-fam">`, "초기 · 정기처럼 이어지는 과정은 같은 묶음 이름을 씁니다. 묶음 안의 가장 최근 이수로 유효 여부를 봅니다.")}
          ${fld("tc-cycle", "주기(개월)", `<input type="number" id="tc-cycle" min="0" max="120" value="${esc(Number(c.cycle) || 0)}">`, "0 = 1회 · 영구 (유효기간 없음)")}
          ${fld("tc-rule", "갱신 규칙", `<select id="tc-rule">${RULES.map(([k, lb]) => `<option value="${k}" ${String(c.rule || "") === k ? "selected" : ""}>${esc(lb)}</option>`).join("")}</select>`)}
          ${fld("tc-legal", "구분(근거)", `<select id="tc-legal">${Object.keys(LEGAL).map(k => `<option value="${k}" ${legalOf(c) === k ? "selected" : ""}>${esc(LEGAL[k][0])}</option>`).join("")}</select>`)}
          ${fld("tc-hours", "최소 시간", `<input id="tc-hours" value="${esc(c.hours || "")}" maxlength="60" placeholder="예: 연 1회 8시간↑">`)}
        </div>
        ${fld("tc-basis", "근거", `<input id="tc-basis" value="${esc(c.basis || "")}" maxlength="120">`)}
        ${fld("tc-org", "주요 교육기관", `<input id="tc-org" value="${esc(c.org || "")}" maxlength="120">`)}
        <div class="form-row"><label>대상 직무</label><div class="ck-rchoose" id="tc-roles">${roleBox}</div></div>
        <div class="tr-cflags">
          <label class="ck-rc"><input type="checkbox" id="tc-all" ${c.all ? "checked" : ""}><span>전 직원</span></label>
          <label class="ck-rc"><input type="checkbox" id="tc-vendor" ${c.vendor ? "checked" : ""}><span>협력사 확인용</span></label>
          <label class="ck-rc"><input type="checkbox" id="tc-step" ${c.step ? "checked" : ""}><span>단계 과정(자격을 주지 않음)</span></label>
        </div>
        ${dl("tc-dl-fam", uniq(list.map(k => k.fam)))}
        <div class="modal-actions">
          ${used(c.id) ? "" : '<button type="button" class="btn btn-danger" data-act="del">삭제</button>'}<span class="spacer" style="flex:1"></span>
          <button type="button" class="btn btn-ghost" data-act="cancel">목록</button>
          <button type="button" class="btn btn-primary" data-act="ok">적용</button>
        </div>`, { wide: true });
      $("#modal-box [data-act=cancel]").onclick = () => { if (!norm(c.name)) list.splice(i, 1); shell(); };
      const del = $("#modal-box [data-act=del]");
      if (del) del.onclick = () => { list.splice(i, 1); shell(); };
      $("#modal-box [data-act=ok]").onclick = () => {
        const name = norm($("#tc-name").value);
        if (!name) { toast("과정 이름을 입력하세요.", true); $("#tc-name").focus(); return; }
        Object.assign(c, { name, kind: $("#tc-kind").value, fam: norm($("#tc-fam").value) || c.fam || c.id,
          cycle: Math.max(0, Math.round(Number($("#tc-cycle").value) || 0)), rule: $("#tc-rule").value, legal: $("#tc-legal").value,
          hours: norm($("#tc-hours").value), basis: norm($("#tc-basis").value), org: norm($("#tc-org").value),
          roles: $$("#tc-roles input:checked").map(k => k.value), all: $("#tc-all").checked, vendor: $("#tc-vendor").checked, step: $("#tc-step").checked });
        if (!c.step) delete c.step;
        if (!c.all) delete c.all;
        if (!c.vendor) delete c.vendor;
        shell();
      };
    };
    shell();
  }

  /* ═════════ 렌더 ═════════ */
  function bodyHTML(canW) {
    return tab === "sessions" ? sessionsHTML(canW) : tab === "catalog" ? catalogHTML(canW) : tab === "pledges" ? pledgesHTML(canW) : peopleHTML(canW);
  }
  /* 이수 현황 칸 · 자격 카드 누르기 → 그 묶음의 다음 과정으로 이수 등록 */
  function openCell(key) {
    const [p0, fam] = String(key || "").split("|");
    const g = famOf(fam), p = personOf(p0);
    if (!g || !p) return;
    const has = records().some(r => r.pid === p0 && g.courses.some(c => c.id === r.cid && !c.step));
    const pick = (has && g.courses.find(c => c.kind === "정기")) || g.courses.find(c => !c.step) || g.courses[0];
    recordForm(p0, "", pick && pick.id);
  }
  function inner(canW) {
    if (tab === "people") return document.getElementById("tr-pbody");
    if (tab === "sessions") return document.getElementById("tr-sbody");
    if (tab === "catalog") return document.getElementById("tr-cbody");
    if (tab === "pledges") return document.getElementById("tr-plbody");
    return null;
  }
  function wire(box) {
    const canW = SeMIS.canEdit();
    const qi = $("#tr-q", box);
    if (qi) qi.oninput = () => {
      const v = ui.searchValue(qi.value);
      if (v === q) return;
      q = v;
      const b = document.getElementById("tr-body");
      if (!b || !b.contains(qi)) { paint(); return; }
      ui.repaintKeep(b, bodyHTML(canW), qi);
      wire(b);
    };
    const rs = $("#tr-role", box); if (rs) rs.onchange = () => { roleF = rs.value; if (roleF && rgF && rgOf(roleF).id !== rgF) rgF = ""; paint(); };
    $$("[data-rgf]", box).forEach(b => b.onclick = () => {
      rgF = rgF === b.dataset.rgf ? "" : b.dataset.rgf;
      if (rgF && roleF && rgOf(roleF).id !== rgF) roleF = "";
      paint();
    });
    const yr = $("#tr-year", box); if (yr) yr.onchange = () => { year = yr.value; paint(); };
    const ac = $("#tr-act", box); if (ac) ac.onclick = () => { onlyAct = !onlyAct; paint(); };
    $$("[data-tseg]", box).forEach(b => b.onclick = () => {
      const k = b.dataset.tseg, v = b.dataset.v;
      if (k === "stype") sType = v; else if (k === "pstate") pState = v; else if (k === "pview") pView = v;
      else if (k === "plscope") plScope = v; else if (k === "plstate") plState = v;
      paint();
    });
    $$("[data-tpadd]", box).forEach(b => b.onclick = () => personForm(""));
    $$("[data-plretry]", box).forEach(b => b.onclick = () => { b.disabled = true; loadPledges(true).then(() => paint()); });
    $$("[data-tperson]", box).forEach(el => {
      const open = (ev) => { if (ev && ev.target.closest("a")) return; if (ev) ev.stopPropagation(); openPerson(el.dataset.tperson); };
      el.onclick = open;
      if (el.tagName === "TR") el.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); open(); } };
    });
    $$("[data-sid]", box).forEach(el => {
      el.onclick = (ev) => { if (!ev.target.closest("a")) openSession(el.dataset.sid); };
      if (el.tagName === "TR") el.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); openSession(el.dataset.sid); } };
    });
    if (!canW) return;
    $$("[data-tcell]", box).forEach(el => {
      el.onclick = (ev) => { if (ev.target.closest("[data-tperson]")) return; openCell(el.dataset.tcell); };
    });
  }
  /* 개인 · 기록 화면은 그 자리에서 다시 그린다(스크롤 유지) */
  function repaintSub() {
    const v = document.getElementById("view");
    if (!v) return;
    const canW = SeMIS.canEdit();
    if (pid && !personOf(pid)) pid = "";
    if (sid && !sessionOf(sid)) sid = "";
    if (!pid && !sid) { SeMIS.renderView(); return; }
    if (pid) personPage(v, canW); else sessionPage(v, canW);
    if (SeMIS.attachPrintBtn) SeMIS.attachPrintBtn(v, MOD);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
  }
  function paint() {
    if (routeNow() !== MOD) return;
    if (pid || sid) { repaintSub(); return; }
    const box = document.getElementById("tr-body");
    if (!box) { SeMIS.renderView(); return; }
    box.innerHTML = bodyHTML(SeMIS.canEdit());
    wire(box);
    if (SeMIS.renderNav) try { SeMIS.renderNav(); } catch (e) { /* 메뉴 배지만 영향 */ }
    if (SeMIS.tidyView) try { SeMIS.tidyView(); } catch (e) { /* 정돈만 영향 */ }
  }
  function render(root) {
    const canW = SeMIS.canEdit();
    const st = String((typeof history !== "undefined" && history.state && history.state.tr) || "");
    if (pendingOpen) {
      pendingOpen = false;
      const k = pid ? "p:" + pid : sid ? "s:" + sid : "";
      if (k) try { history.replaceState({ tr: k }, "", location.hash); } catch (e) { /* noop */ }
    } else if (st) { pid = st.indexOf("p:") === 0 ? st.slice(2) : ""; sid = st.indexOf("s:") === 0 ? st.slice(2) : ""; }
    else { pid = ""; sid = ""; }
    if (pid && !personOf(pid)) pid = "";
    if (sid && !sessionOf(sid)) sid = "";
    if (pid) { personPage(root, canW); loadPledges(false).then(ch => { if (ch && routeNow() === MOD && pid) repaintSub(); }); return; }
    if (sid) { sessionPage(root, canW); return; }
    const b = (id, ic, label, primary) => `<button type="button" class="btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm" id="${id}">${icon(ic, 16)}<span>${label}</span></button>`;
    const act = !canW ? "" : tab === "sessions" ? b("tr-sadd", "plus", "교육 기록", true)
      : tab === "catalog" ? b("tr-courses", "sliders", "과정 관리", true)
      : tab === "pledges" ? "" : b("tr-radd", "plus", "이수 등록", true) + b("tr-padd", "user", "인원 등록");
    root.innerHTML = ui.head({ title: TITLE, meta: "교육훈련지침 · 위험물 · 국제 기준", actions: act })
      + `<div class="eq-tabs" role="tablist" aria-label="보안교육 화면">${TABS.map(([id, lb]) =>
        `<button type="button" role="tab" class="eq-tab" data-ttab="${id}" aria-selected="${tab === id}">${esc(lb)}</button>`).join("")}</div>`
      + `<div id="tr-body">${bodyHTML(canW)}</div>`;
    $$("[data-ttab]", root).forEach(x => x.onclick = () => { tab = x.dataset.ttab; q = ""; SeMIS.renderView(); });
    const cb = $("#tr-courses", root); if (cb) cb.onclick = coursesForm;
    const pa = $("#tr-padd", root); if (pa) pa.onclick = () => personForm("");
    const sa = $("#tr-sadd", root); if (sa) sa.onclick = () => sessionForm("", "own");
    const ra = $("#tr-radd", root); if (ra) ra.onclick = () => recordForm("", "", "");
    wire(root);
    /* SSI 서약 대조용 명단 — 받아 오면(바뀌었으면) 다시 그린다 */
    loadPledges(false).then(ch => { if ((ch || (tab === "pledges" && PL.err)) && routeNow() === MOD && !pid && !sid) paint(); });
  }

  SeMIS.registerModule(MOD, {
    title: TITLE,
    navBadge() { const s = stats(); return s.act + s.ssiMiss || ""; },
    render
  });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: TITLE, ico: "users", module: MOD,
    items: () => people().map(p => ({ title: p.name, sub: [p.dept, rolesOf(p).join(" · ")].filter(Boolean).join(" · "),
        text: [p.name, p.dept, rolesOf(p).join(" "), p.note], route: MOD, pick: () => { q = ""; openPerson(p.id); } }))
      .concat(sessions().map(s => ({ title: sessionTitle(s), sub: [s.type === "vendor" ? "협력사 확인" : "당사 실시", dot(s.date)].join(" · "),
        text: [sessionTitle(s), s.place, s.instructor, s.vendor, s.note], route: MOD, pick: () => { q = ""; openSession(s.id); } })))
  });

  window.SemisTraining = {
    DEF_COURSES, ROLES, ROLE_DEF, ROLE_ALIAS, GROUPS, RGROUPS, rgOf, sortRoles, EIGHT, ST, CAT_VER, calcExpire, shiftM, nextExpire, previewExpire,
    courses, fams, famStatus, personQuals, stats, roleStats, dueList, expiryByMonth, sessionsByMonth, grid, missing, evidence, expireOf, stText, cycleText,
    migrate, rolesOf, needAct, loadPledges, pledgeMatch, pledgeInfo, pledgesState: PL,
    syncSessionRecords, personForm, pledgeForm, recordForm, sessionForm, coursesForm, keepOver, leftOver, openPerson, openSession,
    setToday(t) { fixedToday = isISO(t) ? t : ""; },
    getState() { return { tab, q, roleF, rgF, onlyAct, year, sType, pState, pView, pid, sid, plScope, plState }; },
    setState(o) {
      o = o || {};
      if (o.tab) { tab = o.tab === "grid" ? "people" : o.tab; if (o.tab === "grid") pView = "grid"; }
      if (o.q !== undefined) q = String(o.q || "");
      if (o.roleF !== undefined) roleF = String(o.roleF || ""); if (o.onlyAct !== undefined) onlyAct = !!o.onlyAct;
      if (o.rgF !== undefined) rgF = rgById(o.rgF) ? String(o.rgF) : "";
      if (o.year !== undefined) year = String(o.year || ""); if (o.sType) sType = o.sType; if (o.pState) pState = o.pState;
      if (o.pView) pView = o.pView;
      if (o.pid !== undefined || o.sid !== undefined) {
        pid = String(o.pid || ""); sid = String(o.sid || ""); pendingOpen = !!(pid || sid);
        if (!pendingOpen) try { if (history.state && history.state.tr) history.replaceState(null, "", location.hash); } catch (e) { /* noop */ }
      }
      if (o.plScope) plScope = o.plScope; if (o.plState) plState = o.plState;
    }
  };
})();
